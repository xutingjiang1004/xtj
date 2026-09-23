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
    '    loadRemember: loadRemember,',
    '    saveRemember: saveRemember,',
    '    storageScopeName: storageScopeName,',
    '    createStreamRenderer: createStreamRenderer,',
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

// ★ P2-21：文案必须与「只写 sessionStorage」的实际生命周期一致。
// 旧断言命中的旧文案只写了「当前标签页会话内保留」，仍挂着「记住 Token」的长期保存暗示，
// 现更新为明确说明「仅当前标签页有效 / 关闭标签页即清除」的文案。
test('remember-token UI text describes session-only retention and unchecked behavior', () => {
  assert.match(source, /记住 Token（仅当前标签页有效：刷新页面保留，关闭标签页即清除；取消勾选则关闭工作区后不保留）/);
  assert.match(source, /state\.token = ''; \/\/ 关闭工作区后不在闭包内继续保留明文凭据/);
  // 连接页提示不再声称「保存在你的浏览器本地」（易被理解为长期保存）
  assert.doesNotMatch(source, /Token 仅保存在你的浏览器本地/);
  assert.match(source, /Token 仅保存在当前标签页会话（刷新保留，关闭标签页即清除），并按登录账号隔离/);
  // 默认仍是 sessionStorage：勾选与否只影响是否保存，不影响保存位置
  assert.match(source, /if \(rememberOn\) saveToken\(state\.token\); else saveToken\(''\);/);
  assert.doesNotMatch(source, /localStorage\.setItem\(LS_TOKEN/);
});

// ★ P2-20：Token 与「记住 Token」偏好都必须按当前 XTJ 用户隔离；
// 取不到用户标识时用明确的 guest 兜底键，绝不退化成所有账号共用的裸键。
test('token and remember-preference keys are user-scoped with an explicit guest fallback', () => {
  const fixture = makeWorkbench(() => Promise.reject(new Error('unexpected fetch')));
  const { api, window, session, local } = fixture;

  // ① 复用项目统一的用户标识入口 window.getCanonicalUser()（core.js 提供）
  assert.match(source, /typeof window\.getCanonicalUser === 'function'/);
  window.getCanonicalUser = function () { return 'zoe'; };
  assert.equal(api.storageScopeName(), 'zoe');
  api.saveToken('zoe-token');
  assert.equal(session.xtj_code_token__zoe, 'zoe-token');

  // ② 取不到任何用户标识 → 明确兜底 guest，不写裸 xtj_code_token / 不抛错
  delete window.getCanonicalUser;
  delete window.currentUser;
  assert.equal(api.storageScopeName(), 'guest');
  api.saveToken('guest-token');
  assert.equal(session.xtj_code_token__guest, 'guest-token');
  assert.equal(session.xtj_code_token, undefined);

  // ③ 记住偏好同样按账号隔离（只存 0/1 开关，绝不存 Token 本身）
  api.saveRemember(false);
  assert.equal(local.xtj_code_remember__guest, '0');
  assert.equal(api.loadRemember(), false);
  window.currentUser = 'alice';
  assert.equal(api.storageScopeName(), 'alice');
  assert.equal(api.loadRemember(), true); // alice 未存过 → 默认记住
  api.saveRemember(true);
  assert.equal(local.xtj_code_remember__alice, '1');
  assert.equal(local.xtj_code_remember__guest, '0'); // 互不干扰
});

// ★ P2-8：流式增量必须按帧合并渲染，且流结束后补一次完整渲染。
test('streaming output renders at most once per frame and flushes the final text', () => {
  const fixture = makeWorkbench(() => Promise.reject(new Error('unexpected fetch')));
  const { api, window } = fixture;
  const renders = [];
  // 模拟真实 rAF 语义：排帧入表，cancel 后回调不再执行
  const frames = new Map();
  let nextId = 1;
  window.requestAnimationFrame = function (fn) { var id = nextId++; frames.set(id, fn); return id; };
  window.cancelAnimationFrame = function (id) { frames.delete(id); };
  function runFrame(id) { var fn = frames.get(id); if (!fn) return false; frames.delete(id); fn(); return true; }
  window.XtjAiCore = { Markdown: { render: function (t) { renders.push(t); return '<p>' + t + '</p>'; } } };
  const node = { innerHTML: '', textContent: '' };
  const view = api.createStreamRenderer(node);

  // 同一帧内多次增量只排一次渲染任务
  view.setText('a');
  view.setText('ab');
  view.setText('abc');
  assert.equal(frames.size, 1);
  assert.equal(renders.length, 0, '增量不得同步触发渲染');

  runFrame(1); // 帧回调：渲染一次，内容为最新全文
  assert.equal(renders.length, 1);
  assert.equal(renders[0], 'abc');
  assert.equal(node.innerHTML, '<p>abc</p>');

  // 流结束：flush 取消待执行帧并同步渲染最终态，保证内容完整
  view.setText('abcd');
  view.flush();
  assert.equal(frames.size, 0, 'flush 必须撤销已排的帧');
  assert.equal(renders.length, 2);
  assert.equal(renders[1], 'abcd');
  assert.equal(node.innerHTML, '<p>abcd</p>');

  // 状态文案会撤销待执行帧，避免被上一次流式的残留帧覆盖
  view.setText('abcde');
  view.setStatus('正在继续生成余下部分…');
  assert.equal(frames.size, 0);
  assert.equal(node.textContent, '正在继续生成余下部分…');
  assert.equal(renders.length, 2, '状态文案后不得再渲染旧流式内容');
});

test('every streaming onContent handler feeds the frame-coalesced renderer', () => {
  // 三处（主轮 / 自动续写 / 自动工具调用）都不再「每片段整体替换 innerHTML」
  assert.doesNotMatch(source, /onContent: function \(chunk\) \{\s*\n?\s*accumulated \+= chunk;\s*\n?\s*var shown/);
  assert.doesNotMatch(source, /stripToolMarkers\(accumulated\)/);
  // 全文→HTML 的转换只剩渲染器内部一处（定义 + paint 各一次）
  assert.equal((source.match(/stripToolMarkers\(/g) || []).length, 2);
  const setTextCalls = source.match(/streamView\.setText\(accumulated\);/g) || [];
  assert.equal(setTextCalls.length, 3, '主轮/续写轮/工具轮的 onContent 都要走按帧渲染');
  assert.match(source, /function createStreamRenderer\(node\)/);
  assert.match(source, /requestAnimationFrame/);
  // 流正常结束后必须补一次完整渲染，失败/中止则取消，避免覆盖错误提示
  assert.match(source, /if \(!done\) streamView\.flush\(\); else streamView\.cancel\(\);/);
  assert.match(source, /streamView\.flush\(\); return true;/, '续写/工具轮成功后也要 flush');
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
