'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'code-file-system.js'),
  'utf8'
);

function loadCodeFileSystem(overrides) {
  const windowObject = Object.assign({}, overrides || {});
  const context = vm.createContext({
    window: windowObject,
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Blob,
    Buffer,
    DOMException,
    URL,
    Promise,
    Map,
    Set,
    Number,
    Object,
    String,
    JSON,
    Date,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: 'code-file-system.js' });
  return windowObject.__xtjCodeFS;
}

function delayedTextHandle(name, content, delayMs) {
  return {
    kind: 'file',
    name,
    getFile() {
      return Promise.resolve({
        name,
        size: Buffer.byteLength(content),
        text() {
          return new Promise((resolve) => {
            setTimeout(() => resolve(content), delayMs);
          });
        }
      });
    }
  };
}

function directoryHandle(name, children) {
  return {
    kind: 'directory',
    name,
    values() {
      let index = 0;
      return {
        next() {
          if (index >= children.length) {
            return Promise.resolve({ done: true });
          }
          return Promise.resolve({ value: children[index++], done: false });
        }
      };
    }
  };
}

test('listAllFilesWithMetadata keeps path/name/content paired under delayed out-of-order reads', async () => {
  const codeFS = loadCodeFileSystem();
  const root = directoryHandle('workspace', [
    delayedTextHandle('first.js', 'FIRST_CONTENT', 35),
    delayedTextHandle('second.js', 'SECOND_CONTENT', 1),
    delayedTextHandle('third.js', 'THIRD_CONTENT', 12)
  ]);
  codeFS.setDirHandle(root);

  const result = await codeFS.listAllFilesWithMetadata(4, 500);
  const byPath = Object.fromEntries(result.files.map((entry) => [entry.path, entry]));

  assert.equal(result.files.length, 3);
  assert.equal(byPath['first.js'].name, 'first.js');
  assert.equal(byPath['first.js'].content, 'FIRST_CONTENT');
  assert.equal(byPath['second.js'].name, 'second.js');
  assert.equal(byPath['second.js'].content, 'SECOND_CONTENT');
  assert.equal(byPath['third.js'].name, 'third.js');
  assert.equal(byPath['third.js'].content, 'THIRD_CONTENT');
  assert.notEqual(byPath['first.js'].sha256, byPath['second.js'].sha256);
  assert.equal(result.files.map((entry) => entry.path).join(','), 'first.js,second.js,third.js');
});

test('listAllFilesWithMetadata bounds discovery and read queue by maxFiles', async () => {
  let reads = 0;
  const children = Array.from({ length: 40 }, (_, index) => {
    const handle = delayedTextHandle('file-' + index + '.js', 'content-' + index, 1);
    const originalGetFile = handle.getFile;
    handle.getFile = function () { reads++; return originalGetFile(); };
    return handle;
  });
  const codeFS = loadCodeFileSystem();
  codeFS.setDirHandle(directoryHandle('workspace', children));

  const result = await codeFS.listAllFilesWithMetadata(4, 5);
  assert.equal(result.files.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(reads, 5);
});

test('single-file workspace exposes one readable and writable file through the normal adapter', async () => {
  const codeFS = loadCodeFileSystem({
    showOpenFilePicker: async () => [{
      kind: 'file',
      name: 'trip.md',
      async queryPermission() { return 'granted'; },
      async getFile() {
        return { name: 'trip.md', size: 10, text: async () => '# Guangzhou' };
      },
      async createWritable() {
        return { write: async () => {}, close: async () => {} };
      }
    }]
  });

  const root = await codeFS.selectFile();
  assert.equal(root.kind, 'directory');
  assert.equal(root._isSingleFileRoot, true);
  assert.equal(codeFS.getWorkspaceKind(), 'file');

  const listing = await codeFS.listAllFilesWithMetadata(4, 10);
  assert.equal(listing.files.map((file) => file.path).join(','), 'trip.md');
  assert.equal(listing.files[0].content, '# Guangzhou');

  const read = await codeFS.readFileByPath('trip.md');
  assert.equal(read.content, '# Guangzhou');
  await assert.rejects(root.getFileHandle('other.md'), /File not found/);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json() {
      return Promise.resolve(payload);
    },
    text() {
      return Promise.resolve(JSON.stringify(payload));
    }
  };
}

test('GitHub adapter reads a nested repository only through same-origin proxy routes', async () => {
  const calls = [];
  const files = {
    'README.md': '# XTJ\ntravel notes',
    'src/lib/guide.js': 'export const city = "广州";'
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.match(url, /^\/api\/code\/github\/repos\/xutingjiang1004\/xtj\//);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include');

    if (url.includes('/tree?')) {
      return jsonResponse(200, {
        data: {
          tree: [
            { path: 'README.md', type: 'blob', sha: 'readme-sha', size: files['README.md'].length },
            { path: 'src', type: 'tree' },
            { path: 'src/lib', type: 'tree' },
            { path: 'src/lib/guide.js', type: 'blob', sha: 'guide-sha', size: Buffer.byteLength(files['src/lib/guide.js']) }
          ]
        }
      });
    }

    const parsed = new URL(url, 'https://xtj.example');
    const filePath = parsed.searchParams.get('path');
    const content = files[filePath];
    if (content === undefined) {
      return jsonResponse(404, { error: '文件不存在' });
    }
    return jsonResponse(200, {
      content: Buffer.from(content, 'utf8').toString('base64'),
      encoding: 'base64',
      sha: filePath === 'README.md' ? 'readme-sha' : 'guide-sha',
      size: Buffer.byteLength(content),
      mimeType: filePath.endsWith('.md') ? 'text/markdown' : 'text/javascript'
    });
  };

  const codeFS = loadCodeFileSystem();
  const adapter = await codeFS.createGitHubFileSystemAdapter({
    repo: 'xutingjiang1004/xtj',
    branch: 'xtj-hotfix',
    fetchImpl
  });
  codeFS.setDirHandle(adapter);

  assert.equal(adapter.kind, 'directory');
  assert.equal(adapter._repo, 'xutingjiang1004/xtj');
  assert.equal(adapter._branch, 'xtj-hotfix');

  const rootValues = adapter.values();
  const firstRootEntry = await rootValues.next();
  const secondRootEntry = await rootValues.next();
  assert.equal(firstRootEntry.value.name, 'src');
  assert.equal(secondRootEntry.value.name, 'README.md');

  const src = await adapter.getDirectoryHandle('src');
  const lib = await src.getDirectoryHandle('lib');
  const guideHandle = await lib.getFileHandle('guide.js');
  const guideFile = await guideHandle.getFile();
  assert.equal(guideFile.sha, 'guide-sha');
  assert.equal(guideFile.type, 'text/javascript');
  assert.equal(await guideFile.text(), files['src/lib/guide.js']);

  const readResult = await codeFS.readFileByPath('src/lib/guide.js');
  assert.equal(readResult.type, 'text');
  assert.equal(readResult.content, files['src/lib/guide.js']);
  assert.equal(readResult.size, Buffer.byteLength(files['src/lib/guide.js']));

  const entries = adapter.entries();
  const firstNamedEntry = await entries.next();
  assert.equal(firstNamedEntry.value[0], 'src');
  assert.equal(firstNamedEntry.value[1].kind, 'directory');

  await assert.rejects(
    adapter.getFileHandle('new.js', { create: true }),
    (error) => error && error.name === 'NotAllowedError'
  );
  await assert.rejects(
    guideHandle.createWritable(),
    (error) => error && error.name === 'NotAllowedError'
  );

  assert.equal(calls.filter((call) => call.url.includes('/tree?')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/file?')).length, 2);
  assert.ok(calls.every((call) => !/^https?:/i.test(call.url)));
});

test('GitHub adapter rejects traversal paths and preserves proxy status errors', async () => {
  const codeFS = loadCodeFileSystem();

  await assert.rejects(
    codeFS.createGitHubFileSystemAdapter({
      owner: 'xutingjiang1004',
      repo: 'xtj',
      tree: [{ path: '../secret.txt', type: 'blob' }],
      fetchImpl: async () => jsonResponse(500, {})
    }),
    /invalid path/
  );

  await assert.rejects(
    codeFS.createGitHubFileSystemAdapter({
      owner: 'xutingjiang1004',
      repo: 'xtj',
      fetchImpl: async () => jsonResponse(403, { error: '仓库访问被拒绝' })
    }),
    (error) => error && error.status === 403 && /仓库访问被拒绝/.test(error.message)
  );
});
