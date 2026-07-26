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
