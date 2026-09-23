'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'js', 'code-workbench.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function makeWorkbench(fetchImpl) {
  const local = Object.create(null);
  const session = Object.create(null);
  const storage = (store) => ({
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; }
  });
  const win = {
    __xtjCodeWorkbenchLoaded: false,
    currentUser: 'alice',
    location: { origin: 'https://example.test' },
    localStorage: storage(local),
    sessionStorage: storage(session)
  };
  const instrumented = source.replace(/\}\)\(\);\s*$/, [
    '  window.__audit = {',
    '    streamAi: streamAi,',
    '    isSensitiveFilePath: isSensitiveFilePath,',
    '    isCodeFileForBulk: isCodeFileForBulk,',
    '    collectMentionedFiles: collectMentionedFiles,',
    '    buildFileTreeText: buildFileTreeText,',
    '    fetchToolFileText: fetchToolFileText,',
    '    loadToken: loadToken,',
    '    saveToken: saveToken,',
    '    ghRequest: ghRequest,',
    '    state: state,',
    '    ui: ui',
    '  };',
    '})();'
  ].join('\n'));
  assert.notEqual(instrumented, source, 'test harness must instrument the workbench IIFE');
  const context = {
    window: win,
    document: {},
    console,
    fetch: fetchImpl,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Math,
    RegExp,
    isNaN
  };
  vm.runInNewContext(instrumented, context, { filename: sourcePath });
  return { api: win.__audit, window: win, local, session };
}

function streamResponse(chunks) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (index < chunks.length) return Promise.resolve({ done: false, value: Buffer.from(chunks[index++]) });
            return Promise.resolve({ done: true });
          }
        };
      }
    }
  };
}

function runStream(chunks) {
  const fixture = makeWorkbench(() => Promise.resolve(streamResponse(chunks)));
  const content = [];
  return fixture.api.streamAi({ url: '/stream', body: {} }, {
    onContent(chunk) { content.push(chunk); }
  }).then((result) => ({ result, content }), (error) => ({ error, content }));
}

test('SSE parser accepts LF and CRLF frame boundaries, including split chunks', async () => {
  const lf = await runStream([
    'data: {"type":"content","text":"hello"}\n\n',
    'data: {"type":"done"}\n\n'
  ]);
  const crlf = await runStream([
    'data: {"type":"content","text":"hel',
    'lo"}\r\n\r\ndata: {"type":"done"}\r\n\r\n'
  ]);
  assert.equal(lf.result, 'hello');
  assert.deepEqual(lf.content, ['hello']);
  assert.equal(crlf.result, 'hello');
  assert.deepEqual(crlf.content, ['hello']);
});

test('SSE EOF flushes the final unterminated done frame', async () => {
  const result = await runStream([
    'data: {"type":"content","text":"tail"}\n\n',
    'data: {"type":"done"}'
  ]);
  assert.equal(result.result, 'tail');
  assert.deepEqual(result.content, ['tail']);
});

test('SSE EOF without done rejects instead of reporting success', async () => {
  const result = await runStream(['data: {"type":"content","text":"partial"}\n\n']);
  assert.equal(result.result, undefined);
  assert.equal(result.error.code, 'INCOMPLETE');
  assert.match(result.error.error, /缺少完成信号/);
});

test('GitHub token session storage is scoped to the current XTJ user', () => {
  const fixture = makeWorkbench(() => Promise.reject(new Error('unexpected fetch')));
  const { api, window, session } = fixture;
  session.xtj_code_token = 'legacy-shared-token';
  assert.equal(api.loadToken(), '');
  assert.equal(session.xtj_code_token, undefined);

  api.saveToken('alice-token');
  assert.equal(session.xtj_code_token__alice, 'alice-token');
  window.currentUser = 'bob';
  assert.equal(api.loadToken(), '');
  api.saveToken('bob-token');
  assert.equal(session.xtj_code_token__bob, 'bob-token');
  window.currentUser = 'alice';
  assert.equal(api.loadToken(), 'alice-token');

  api.state.token = 'alice-token';
  api.state.tokenUser = 'alice';
  window.currentUser = 'bob';
  return api.ghRequest('GET', '/repos/o/r').then((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(api.state.token, '');
    assert.equal(api.state.repo, null);
  });
});

test('remember-token UI text describes session-only retention and unchecked behavior', () => {
  assert.match(source, /当前标签页会话内保留；取消勾选则关闭工作区后不保留/);
  assert.match(source, /state\.token = ''; \/\/ 关闭工作区后不在闭包内继续保留明文凭据/);
});

test('bulk and named-file auto-read exclude environment, credentials, and key files', async () => {
  let fetchCalls = 0;
  const { api } = makeWorkbench(() => { fetchCalls++; return Promise.reject(new Error('unexpected fetch')); });
  const sensitive = [
    '.env', '.env.production', 'config/.ENV.local', '.netrc', '.npmrc',
    'credentials.json', 'secrets.yaml', 'id_rsa', 'keys/server.pem',
    'certs/client.p12', 'private.key'
  ];
  sensitive.forEach((file) => {
    assert.equal(api.isSensitiveFilePath(file), true, file);
    assert.equal(api.isCodeFileForBulk(file), false, file);
  });
  ['src/app.js', 'README.md'].forEach((file) => {
    assert.equal(api.isSensitiveFilePath(file), false, file);
  });

  api.state.repo = { owner: 'o', repo: 'r', branch: 'main' };
  api.state.tree = sensitive.map((file) => ({ type: 'blob', path: file, size: 20 }));
  assert.equal(api.buildFileTreeText(), '');
  const mentioned = await api.collectMentionedFiles(sensitive.join(' '));
  assert.equal(Object.keys(mentioned.texts).length, 0);
  assert.equal(mentioned.images.length, 0);
  assert.equal(fetchCalls, 0);
  assert.match((await api.fetchToolFileText('.env')).error, /禁止自动读取敏感文件/);
  assert.equal(fetchCalls, 0);

  assert.match(source, /Object\.keys\(state\.bulkFiles\)\.filter\(function \(p\) \{ return !isSensitiveFilePath\(p\); \}\)/);
});
