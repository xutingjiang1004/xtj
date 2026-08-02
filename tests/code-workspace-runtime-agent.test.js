'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'code-workspace.js'),
  'utf8'
);

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text() {
      return Promise.resolve(JSON.stringify(payload));
    }
  };
}

class FakeFormData {
  constructor() {
    this.fields = [];
  }
  append(name, value, fileName) {
    this.fields.push({ name, value, fileName });
  }
}

function loadWorkspace(protectedFetch, codeFS) {
  const windowObject = {
    __XTJ_TEST_MODE__: true,
    xtjProtectedFetch: protectedFetch,
    __xtjCodeFS: codeFS || {},
    addEventListener() {},
    removeEventListener() {}
  };
  const documentObject = {
    addEventListener() {},
    getElementById() { return null; },
    documentElement: {
      getAttribute() { return 'light'; }
    }
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    console,
    fetch: protectedFetch,
    AbortController,
    FormData: FakeFormData,
    Blob,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Promise,
    Object,
    Array,
    String,
    Number,
    JSON,
    Date,
    Math,
    RegExp,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: 'code-workspace.js' });
  return {
    hooks: windowObject.__xtjCodeWorkspaceTestHooks,
    state: windowObject.__xtjCodeWorkspaceTestHooks.getState()
  };
}

test('chat request carries scoped workspace, prioritized open files and extracted attachments', () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  const state = loaded.state;
  state.workspaceMode = 'local';
  state.workspaceName = 'travel-project';
  state.workspaceGeneration = 7;
  state.activePath = 'src/active.js';
  state.pinnedFiles = ['notes/plan.md'];
  state.openTabs = [
    { path: 'notes/plan.md', name: 'plan.md', content: 'saved', _currentContent: 'unsaved travel plan', sha256: 'plan-sha', type: 'text' },
    { path: 'src/active.js', name: 'active.js', content: 'active code', sha256: 'active-sha', type: 'text' },
    { path: 'guide.docx', name: 'guide.docx', _extractedText: '广州三日路线', sha256: 'doc-sha', mimeType: 'application/docx', type: 'document' },
    { path: '.env', name: '.env', content: 'SECRET=1', type: 'text' }
  ];
  state.attachments = [{
    name: '酒店清单.pdf',
    path: 'attachments/酒店清单.pdf',
    mimeType: 'application/pdf',
    content: '酒店 A\n酒店 B',
    sha256: 'attachment-sha',
    source: 'attachment'
  }];

  const body = loaded.hooks.buildChatRequestBody('帮我安排旅游攻略', []);
  assert.equal(body.workspace_id, 'local:travel-project');
  assert.equal(body.workspace_generation, 7);
  assert.equal(body.active_path, 'src/active.js');
  assert.deepEqual(Array.from(body.pinned_paths), ['notes/plan.md']);
  assert.equal(body.open_files[0].path, 'src/active.js');
  assert.equal(body.open_files[1].path, 'notes/plan.md');
  assert.equal(body.open_files[1].content, 'unsaved travel plan');
  assert.equal(body.open_files[2].content, '广州三日路线');
  assert.ok(!body.open_files.some((item) => item.path === '.env'));
  assert.deepEqual(
    JSON.parse(JSON.stringify(body.attachments[0])),
    {
      name: '酒店清单.pdf',
      path: 'attachments/酒店清单.pdf',
      mimeType: 'application/pdf',
      content: '酒店 A\n酒店 B',
      sha256: 'attachment-sha',
      source: 'attachment'
    }
  );
});

test('safe markdown fallback renders headings, lists, code and tables without raw HTML', () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  const html = loaded.hooks.parseSimpleMarkdown('# 行程\n- 机场\n\n| 城市 | 天数 |\n| --- | --- |\n| 深圳 | 2 |\n\n```js\nconst ok = true;\n```\n<script>alert(1)</script>');
  assert.match(html, /<h1>行程<\/h1>/);
  assert.match(html, /<ul><li>机场<\/li><\/ul>/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre><code>const ok = true;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>/i);
});

test('AI context waits for an in-flight document extraction before sending', async () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  let resolveExtraction;
  const extraction = new Promise((resolve) => { resolveExtraction = resolve; });
  loaded.state.openTabs = [{
    path: 'guide.docx',
    name: 'guide.docx',
    type: 'document',
    _docState: 'extracting',
    _extractId: 'fixture-extraction-1',
    _extractGeneration: loaded.state.workspaceGeneration,
    _extractPromise: extraction
  }];

  let settled = false;
  const waiting = loaded.hooks.ensureOpenFileContexts().then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);
  resolveExtraction({ text: '广州路线' });
  await waiting;
  assert.equal(settled, true);
});

test('AI context refuses to send silently when an open document extraction failed', async () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  loaded.state.openTabs = [{
    path: 'guide.docx',
    name: 'guide.docx',
    type: 'document',
    _extractError: '文件格式无效'
  }];
  await assert.rejects(
    loaded.hooks.ensureOpenFileContexts(),
    /文件格式无效/
  );
});

test('attachment extraction recovers after an error and sends the supported document through existing endpoint', async () => {
  let attempt = 0;
  const calls = [];
  const loaded = loadWorkspace(async (url, options) => {
    calls.push({ url, options });
    attempt++;
    if (attempt === 1) return response(500, { error: '解析器暂时不可用' });
    return response(200, {
      ok: true,
      text: '第一天：广州塔\n第二天：沙面',
      fileName: '广州攻略.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      metadata: { pages: 2 }
    });
  }, {
    getSHA256() { return Promise.resolve('sha256-document'); }
  });
  const file = {
    name: '广州攻略.docx',
    size: 1024,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };

  await assert.rejects(loaded.hooks.processAttachmentFile(file), /解析器暂时不可用/);
  assert.equal(loaded.state.attachmentProcessing, false);
  assert.equal(loaded.state.attachments.length, 0);
  assert.match(loaded.state.attachmentError, /解析器暂时不可用/);

  const attachment = await loaded.hooks.processAttachmentFile(file);
  assert.equal(loaded.state.attachmentProcessing, false);
  assert.equal(loaded.state.attachmentError, '');
  assert.equal(loaded.state.attachments.length, 1);
  assert.equal(attachment.path, 'attachments/广州攻略.docx');
  assert.equal(attachment.content, '第一天：广州塔\n第二天：沙面');
  assert.equal(attachment.sha256, 'sha256-document');
  assert.ok(calls.every((call) => call.url === '/api/code/document/extract'));
  assert.ok(calls.every((call) => call.options.body instanceof FakeFormData));

  loaded.hooks.removeAttachment(0);
  assert.equal(loaded.state.attachments.length, 0);
});

test('attachment size limit matches the backend 20MB multipart limit', async () => {
  let called = false;
  const loaded = loadWorkspace(async () => {
    called = true;
    return response(200, { ok: true, text: 'unexpected' });
  });
  await assert.rejects(
    loaded.hooks.processAttachmentFile({
      name: 'oversized.pdf',
      size: 20 * 1024 * 1024 + 1,
      type: 'application/pdf'
    }),
    /20MB/
  );
  assert.equal(called, false);
  assert.equal(loaded.state.attachments.length, 0);
});

test('GitHub selector is single-flight and uses only same-origin authenticated proxy paths', async () => {
  const calls = [];
  const loaded = loadWorkspace(async (url, options) => {
    calls.push({ url, options });
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (url.endsWith('/branches')) {
      return response(200, { ok: true, branches: [{ name: 'xtj-hotfix' }] });
    }
    return response(200, {
      ok: true,
      repo: { full_name: 'xutingjiang1004/xtj', default_branch: 'xtj-hotfix', private: true }
    });
  });

  const first = loaded.hooks.loadGitHubRepositoryInfo('xutingjiang1004/xtj');
  const second = loaded.hooks.loadGitHubRepositoryInfo('xutingjiang1004/xtj');
  assert.equal(first, second);
  const result = await first;

  assert.equal(result.repo.private, true);
  assert.deepEqual(Array.from(result.branches, (branch) => branch.name), ['xtj-hotfix']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.startsWith('/api/code/github/repos/xutingjiang1004/xtj')));
  assert.ok(calls.every((call) => !/^https?:/i.test(call.url)));
  assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
});

test('project index build is single-flight and sends workspace scope with file content', async () => {
  const calls = [];
  const codeFS = {
    listAllFilesWithMetadata() {
      return new Promise((resolve) => {
        setTimeout(() => resolve({
          files: [{ path: 'src/app.js', name: 'app.js', type: 'text', content: 'console.log(1)', sha256: 'sha' }]
        }), 10);
      });
    }
  };
  const loaded = loadWorkspace(async (url, options) => {
    calls.push({ url, options });
    return response(200, { ok: true, totalFiles: 1, totalChunks: 1, builtAt: 123, workspaceId: 'local:trip', generation: 4 });
  }, codeFS);
  loaded.state.workspaceName = 'trip';
  loaded.state.workspaceMode = 'local';
  loaded.state.workspaceGeneration = 4;

  const first = loaded.hooks.buildProjectIndex();
  const second = loaded.hooks.buildProjectIndex();
  assert.equal(first, second);
  await first;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/code/index/build');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.workspaceId, 'local:trip');
  assert.equal(body.workspaceGeneration, 4);
  assert.equal(body.files[0].path, 'src/app.js');
  assert.equal(body.files[0].content, 'console.log(1)');
  assert.equal(loaded.state.projectIndexStatus.indexed, true);
});

test('project index uploads oversized workspaces sequentially and finalizes the last batch', async () => {
  const calls = [];
  const large = 'x'.repeat(2 * 1024 * 1024);
  const codeFS = {
    listAllFilesWithMetadata() {
      return Promise.resolve({ files: [
        { path: 'a.txt', name: 'a.txt', type: 'text', content: large },
        { path: 'b.txt', name: 'b.txt', type: 'text', content: large }
      ] });
    }
  };
  const loaded = loadWorkspace(async (url, options) => {
    calls.push({ url, options });
    return response(200, { ok: true, status: 'building', totalFiles: 2, totalChunks: 2, builtAt: 123 });
  }, codeFS);
  loaded.state.workspaceName = 'large-trip';
  loaded.state.workspaceMode = 'local';
  loaded.state.workspaceGeneration = 2;

  await loaded.hooks.buildProjectIndex();
  assert.ok(calls.length >= 2);
  const bodies = calls.map((call) => JSON.parse(call.options.body));
  assert.ok(bodies.every((body) => body.append === true));
  assert.equal(bodies[0].finalize, false);
  assert.equal(bodies[bodies.length - 1].finalize, true);
});

test('opening the same file is single-flight and stale workspace reads are discarded', async () => {
  let resolveRead;
  let reads = 0;
  const loaded = loadWorkspace(async () => response(200, {}), {
    readFileByPath() {
      reads++;
      return new Promise((resolve) => { resolveRead = resolve; });
    }
  });
  loaded.state.active = true;
  loaded.state.workspaceGeneration = 3;

  const first = loaded.hooks.openFile('guide.md');
  const second = loaded.hooks.openFile('guide.md');
  assert.equal(first, second);
  assert.equal(reads, 1);

  loaded.state.workspaceGeneration = 4;
  resolveRead({ type: 'text', content: '# stale guide', sha256: 'old' });
  assert.equal(await first, null);
  assert.equal(loaded.state.openTabs.length, 0);
});

test('tab restore retains unsaved content when the backing file read fails transiently', async () => {
  const loaded = loadWorkspace(async () => response(200, {}), {
    readFileByPath() {
      const error = new Error('permission temporarily unavailable');
      error.name = 'NotAllowedError';
      return Promise.reject(error);
    }
  });
  loaded.state.active = true;
  loaded.state.workspaceGeneration = 8;
  loaded.state.activePath = 'trip.md';
  loaded.state.openTabs = [{
    path: 'trip.md',
    name: 'trip.md',
    type: 'text',
    content: 'saved',
    _currentContent: 'unsaved itinerary',
    modified: true
  }];

  await loaded.hooks.restoreTabs();
  assert.equal(loaded.state.openTabs.length, 1);
  assert.equal(loaded.state.openTabs[0]._currentContent, 'unsaved itinerary');
  assert.equal(loaded.state.openTabs[0].modified, true);
});

test('beforeunload does not eagerly cleanup a workspace when navigation can be cancelled', () => {
  const handler = source.match(/window\.addEventListener\('beforeunload',[\s\S]*?\n  \}\);/);
  assert.ok(handler);
  assert.doesNotMatch(handler[0], /\bcleanup\s*\(/);
});

test('saveFile coalesces duplicate writes and preserves edits made during an in-flight save', async () => {
  let resolveWrite;
  let writes = 0;
  const codeFS = {
    writeFileByPath(path, content) {
      writes++;
      assert.equal(path, 'src/app.js');
      assert.equal(content, 'v1');
      return new Promise((resolve) => { resolveWrite = () => resolve({ sha256: 'sha-v1' }); });
    }
  };
  const loaded = loadWorkspace(async () => response(200, {}), codeFS);
  loaded.state.active = true;
  loaded.state.openTabs = [{ path: 'src/app.js', type: 'text', content: 'old', _currentContent: 'v1', modified: true }];
  loaded.state.activePath = 'src/app.js';

  const first = loaded.hooks.saveFile('src/app.js');
  const second = loaded.hooks.saveFile('src/app.js');
  assert.equal(first, second);
  loaded.state.openTabs[0]._currentContent = 'v2';
  resolveWrite();
  assert.equal(await first, true);
  assert.equal(writes, 1);
  assert.equal(loaded.state.openTabs[0].modified, true);
  assert.equal(loaded.state.openTabs[0]._currentContent, 'v2');
});

test('undoOperations ignores duplicate clicks while the first undo is running', async () => {
  let resolveWrite;
  let writes = 0;
  const codeFS = {
    readFileByPath() { return Promise.resolve({ sha256: 'after-sha' }); },
    writeFileByPath() {
      writes++;
      return new Promise((resolve) => { resolveWrite = resolve; });
    }
  };
  const loaded = loadWorkspace(async () => response(200, {}), codeFS);
  loaded.state.active = true;
  loaded.state.workspaceGeneration = 3;
  loaded.state.snapshots = { 'src/app.js': { existed: true, beforeContent: 'old', beforeSha256: 'old-sha', afterSha256: 'after-sha' } };
  const first = loaded.hooks.undoOperations();
  const second = await loaded.hooks.undoOperations();
  assert.equal(second, false);
  assert.equal(writes, 1);
  resolveWrite({ sha256: 'old-sha' });
  assert.equal(await first, true);
  assert.equal(Object.keys(loaded.state.snapshots).length, 0);
});

test('attachment lifecycle consumes transient context but retains pinned context', () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  const revoked = [];
  loaded.state.attachments = [
    { name: 'one.md', content: 'one', pinned: false, objectUrl: 'blob:one' },
    { name: 'plan.docx', content: 'plan', pinned: true, objectUrl: 'blob:plan' }
  ];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    loaded.hooks.consumeTransientAttachments();
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
  assert.deepEqual(Array.from(loaded.state.attachments, (item) => item.name), ['plan.docx']);
  assert.deepEqual(revoked, ['blob:one']);
  assert.equal(loaded.state.attachments[0].content, 'plan');
});

test('removing or clearing attachments releases object URLs and content', () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  const revoked = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => revoked.push(url);
  loaded.state.attachments = [{ name: 'guide.pdf', content: 'guide', objectUrl: 'blob:guide' }];
  try {
    loaded.hooks.removeAttachment(0);
    loaded.state.attachments = [{ name: 'trip.md', content: 'trip', objectUrl: 'blob:trip' }];
    loaded.hooks.clearAttachments();
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
  assert.deepEqual(revoked, ['blob:guide', 'blob:trip']);
  assert.equal(loaded.state.attachments.length, 0);
});

test('late attachment extraction cannot leak into a replaced workspace', async () => {
  let resolveExtract;
  const loaded = loadWorkspace(async () => new Promise((resolve) => { resolveExtract = resolve; }), {
    getSHA256() { return Promise.resolve('sha'); }
  });
  loaded.state.workspaceGeneration = 4;
  const pending = loaded.hooks.processAttachmentFile({ name: 'old.md', size: 10, type: 'text/markdown' });
  loaded.state.workspaceGeneration = 5;
  resolveExtract(response(200, { text: 'old workspace content', fileName: 'old.md', mimeType: 'text/plain' }));
  await assert.rejects(pending, (error) => error && error.name === 'AbortError');
  assert.equal(loaded.state.attachments.length, 0);
});

test('undo refuses to overwrite a file changed after the AI apply', async () => {
  let writes = 0;
  const codeFS = {
    readFileByPath() { return Promise.resolve({ sha256: 'user-edit-sha' }); },
    writeFileByPath() { writes++; return Promise.resolve({ sha256: 'old-sha' }); }
  };
  const loaded = loadWorkspace(async () => response(200, {}), codeFS);
  loaded.state.active = true;
  loaded.state.workspaceGeneration = 4;
  loaded.state.snapshots = { 'src/app.js': { existed: true, beforeContent: 'old', beforeSha256: 'old-sha', afterSha256: 'ai-sha' } };
  assert.equal(await loaded.hooks.undoOperations(), false);
  assert.equal(writes, 0);
  assert.equal(Object.keys(loaded.state.snapshots).length, 1);
});

test('cancelCurrentRequest aborts the active request and restores idle state', () => {
  const loaded = loadWorkspace(async () => response(200, {}));
  let aborted = 0;
  loaded.state.sending = true;
  loaded.state._abortController = { abort() { aborted++; } };
  const before = loaded.state._requestId;
  assert.equal(loaded.hooks.cancelCurrentRequest(), true);
  assert.equal(aborted, 1);
  assert.equal(loaded.state.sending, false);
  assert.equal(loaded.state._abortController, null);
  assert.equal(loaded.state._requestId, before + 1);
  assert.equal(loaded.hooks.cancelCurrentRequest(), false);
});
