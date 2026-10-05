'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const uploadSource = fs.readFileSync(path.join(ROOT, 'js/photo-wall/upload-ui.js'), 'utf8');

function makeElement(id) {
  const classes = new Set();
  const history = [];
  let text = '';
  const element = {
    id: id,
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    listeners: {},
    children: [],
    classList: {
      add: function(name) { classes.add(name); },
      remove: function(name) { classes.delete(name); },
      contains: function(name) { return classes.has(name); },
      toggle: function(name, force) {
        const enabled = force === undefined ? !classes.has(name) : !!force;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      }
    },
    addEventListener: function(type, handler) {
      (this.listeners[type] || (this.listeners[type] = [])).push(handler);
    },
    setAttribute: function(name, value) { this[name] = String(value); },
    getAttribute: function(name) { return this[name] || null; },
    appendChild: function(child) { this.children.push(child); return child; },
    querySelectorAll: function(selector) { return this.children.filter(child => selector === '.pw-upload-sheet-thumb' && child.className === 'pw-upload-sheet-thumb'); },
    querySelector: function(selector) { return this.children.find(child => selector === '.pw-upload-remove' && child.className === 'pw-upload-remove') || null; },
    removeChild: function(child) { this.children = this.children.filter(function(item) { return item !== child; }); },
    focus: function() {},
    click: function() {},
    history: history
  };
  Object.defineProperty(element, 'textContent', {
    get: function() { return text; },
    set: function(value) { text = String(value); history.push(text); }
  });
  return element;
}

function createUploadRuntime() {
  const ids = [
    'pwUploadSheet', 'pwUploadSheetGrid', 'pwUploadSheetTitle', 'pwUploadSheetMeta',
    'pwUploadSheetCount', 'pwUploadSheetSkipped', 'pwUploadResult', 'pwUploadResultTitle',
    'pwUploadResultDetail', 'pwUploadResultClose', 'pwUploadResultActions', 'pwUploadResultRetry',
    'pwUploadProgressOverlay', 'pwUploadProgressText', 'pwUploadProgressStatus',
    'pwUploadProgressTrack', 'pwUploadProgressFill', 'pwUploadProgressStage',
    'pwUploadProgressCancel', 'pwUploadProgressPct', 'pwUploadProgressProcessed',
    'pwUploadProgressOk', 'pwUploadProgressFail', 'pwUploadProgressSkip', 'pwUploadProgressStats',
    'photoFileInput', 'pwStartUploadBtn', 'pwUploadReselectBtn', 'pwUploadSheetClose'
  ];
  const elements = new Map(ids.map(function(id) { return [id, makeElement(id)]; }));
  const requests = [];
  const toasts = [];
  let objectUrlId = 0;
  const document = {
    readyState: 'complete',
    getElementById: function(id) { return elements.get(id) || null; },
    createElement: function(tag) { const el = makeElement(tag); el.tagName = tag.toUpperCase(); return el; },
    addEventListener: function() {}
  };
  const window = {
    currentUser: 'owner',
    photoWallData: [],
    API_BASE: '',
    addEventListener: function() {},
    dispatchEvent: function() {},
    showToast: function(message) { toasts.push(String(message)); },
    getUserAuthHeaders: async function() { return {}; },
    safeStorage: { get: function() { return null; }, set: function() {}, remove: function() {} }
  };
  const url = {
    createObjectURL: function() { objectUrlId += 1; return 'blob:test-' + objectUrlId; },
    revokeObjectURL: function() {}
  };
  function fetch(urlValue, options) {
    requests.push({ url: String(urlValue), signal: options && options.signal });
    return new Promise(function(resolve, reject) {
      const signal = options && options.signal;
      const abort = function() {
        const error = new Error('aborted by test');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal && signal.aborted) abort();
      else if (signal) signal.addEventListener('abort', abort, { once: true });
      else reject(new Error('upload request must receive an abort signal'));
    });
  }
  const context = {
    window: window,
    document: document,
    fetch: fetch,
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {} },
    URL: url,
    crypto: { randomUUID: function() { return 'test-upload-id'; } },
    AbortController: AbortController,
    setTimeout: function(callback, delay) {
      if (delay >= 2000) return 0;
      return setTimeout(callback, delay);
    },
    clearTimeout: clearTimeout,
    setInterval: function() { return 0; },
    clearInterval: function() {},
    requestAnimationFrame: function(callback) { callback(); },
    console: { log: function() {}, warn: function() {}, error: function() {} }
  };
  vm.runInNewContext(uploadSource, context, { filename: 'upload-ui.js' });
  return { window: window, elements: elements, requests: requests, toasts: toasts };
}

async function waitFor(condition) {
  const deadline = Date.now() + 1000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for concurrent uploads');
    await new Promise(function(resolve) { setTimeout(resolve, 2); });
  }
}

async function cancelBatch(fileCount) {
  const runtime = createUploadRuntime();
  const files = Array.from({ length: fileCount }, function(_, index) {
    return { name: 'cat-' + index + '.jpg', size: 100, type: 'image/jpeg' };
  });
  runtime.window.handlePhotoUpload({ target: { files: files } });
  const upload = runtime.window.triggerPhotoWallUpload();

  await waitFor(function() { return runtime.requests.length === 3; });
  runtime.window.cancelPhotoWallUpload();
  await upload;
  return runtime;
}

test('cancelling every in-flight upload reports cancellation instead of success', async function() {
  const runtime = await cancelBatch(3);
  const result = runtime.elements.get('pwUploadResult');
  const summary = runtime.elements.get('pwUploadResultDetail').textContent;

  assert.strictEqual(result.dataset.state, 'partial', 'cancelled state should retain partial-warning styling');
  assert.strictEqual(runtime.elements.get('pwUploadResultTitle').textContent, '上传已取消');
  assert.match(summary, /已处理 3\/3 张/);
  assert.match(summary, /成功 0 张，失败 0 张，取消中止 3 张/);
  assert.notStrictEqual(result.dataset.state, 'success');
  assert.strictEqual(runtime.elements.get('pwUploadResultRetry').hidden, true,
    'cancelled jobs are not retryable failures');
});

test('cancelling a batch reports in-flight and not-started photo counts', async function() {
  const runtime = await cancelBatch(8);
  const summary = runtime.elements.get('pwUploadResultDetail').textContent;
  const result = runtime.elements.get('pwUploadResult');

  assert.strictEqual(runtime.requests.length, 3, 'only the configured concurrent workers should start');
  assert.strictEqual(result.dataset.state, 'partial');
  assert.strictEqual(runtime.elements.get('pwUploadResultTitle').textContent, '上传已取消');
  assert.match(summary, /已处理 3\/8 张/);
  assert.match(summary, /取消中止 3 张/);
  assert.match(summary, /未开始 5 张/);
  assert.ok(runtime.elements.get('pwUploadProgressPct').history.includes('38%'));
  assert.ok(!runtime.elements.get('pwUploadProgressPct').history.includes('100%'));
});

test('cancellation messaging preserves ordinary success and failure result actions', function() {
  const runtime = createUploadRuntime();
  let celebrations = 0;
  runtime.window.__xtjPhotoUploadCelebrate = function() { celebrations += 1; };
  const result = runtime.elements.get('pwUploadResult');
  const title = runtime.elements.get('pwUploadResultTitle');
  const actions = runtime.elements.get('pwUploadResultActions');
  const retry = runtime.elements.get('pwUploadResultRetry');

  runtime.window.setPhotoUploadResult('已处理 2/2 张：成功 2 张，失败 0 张', 'success');
  assert.strictEqual(result.dataset.state, 'success');
  assert.strictEqual(title.textContent, '上传成功');
  assert.strictEqual(actions.hidden, true);
  assert.strictEqual(retry.hidden, true);
  assert.strictEqual(celebrations, 0);

  runtime.window.setPhotoUploadResult('已处理 2/2 张：成功 0 张，失败 2 张', 'error');
  assert.strictEqual(result.dataset.state, 'error');
  assert.strictEqual(title.textContent, '上传失败');
  assert.strictEqual(actions.hidden, false);
  assert.strictEqual(retry.hidden, false);
  assert.strictEqual(celebrations, 0);
});
