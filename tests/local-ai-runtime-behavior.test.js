'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'local-ai-runtime.js'),
  'utf8'
);
const workerSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'local-ai-worker.js'),
  'utf8'
);
const aiAgentSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'ai-agent.js'),
  'utf8'
);
const desktopShellSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'desktop-shell.js'),
  'utf8'
);

test('local runtime uses the build-versioned worker URL when available', () => {
  assert.match(runtimeSource, /xtj-module-local-ai-worker/);
  assert.match(runtimeSource, /new Worker\(workerUrl/);
});

test('small-cat local Qwen setup exposes a visible download progress bar', () => {
  assert.match(aiAgentSource, /ai-chat-local-progress/);
  assert.match(aiAgentSource, /ai-chat-local-progress-fill/);
  assert.match(aiAgentSource, /updateLocalProgress\(runtime, progress\)/);
});

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function schedule(fn, delay, repeat) {
    const id = nextId++;
    timers.set(id, {
      fn,
      delay: Math.max(1, Number(delay) || 0),
      due: now + Math.max(1, Number(delay) || 0),
      repeat
    });
    return id;
  }

  function clear(id) {
    timers.delete(id);
  }

  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.due <= target && (!next || timer.due < next.timer.due)) {
          next = { id, timer };
        }
      }
      if (!next) break;

      now = next.timer.due;
      if (next.timer.repeat) {
        next.timer.due += next.timer.delay;
      } else {
        timers.delete(next.id);
      }
      next.timer.fn();
    }
    now = target;
  }

  return {
    now: () => now,
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    clearTimeout: clear,
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: clear,
    advance,
    activeTimerCount: () => timers.size
  };
}

function createRuntimeHarness(options = {}) {
  const clock = createFakeClock();
  const workers = [];
  const behavior = options.behavior || {};
  const fetchCalls = [];

  class FakeWorker {
    constructor(url, workerOptions) {
      this.url = url;
      this.workerOptions = workerOptions;
      this.messages = [];
      this.terminated = false;
      this.terminateCount = 0;
      this.onmessage = null;
      this.onerror = null;
      workers.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
      Promise.resolve().then(() => {
        if (!this.terminated && typeof behavior.onPost === 'function') {
          behavior.onPost(this, message);
        }
      });
    }

    terminate() {
      this.terminateCount += 1;
      this.terminated = true;
    }

    emit(data) {
      if (!this.terminated && typeof this.onmessage === 'function') {
        this.onmessage({ data });
      }
    }

    emitError(message) {
      if (!this.terminated && typeof this.onerror === 'function') {
        this.onerror({ message });
      }
    }
  }

  const windowObject = {
    isSecureContext: options.supported !== false,
    Worker: FakeWorker,
    fetch(...args) {
      fetchCalls.push(args);
      return Promise.reject(new Error('page fetch must not be used by local runtime'));
    }
  };
  const gpu = options.supported === false ? undefined : (options.gpu || {
    requestAdapter() {
      return Promise.resolve({
        limits: {
          maxStorageBuffersPerShaderStage: options.maxStorageBuffersPerShaderStage === undefined
            ? 10
            : options.maxStorageBuffersPerShaderStage
        }
      });
    }
  });
  const context = vm.createContext({
    window: windowObject,
    navigator: { gpu },
    Worker: FakeWorker,
    fetch: windowObject.fetch,
    Date: { now: clock.now },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    AbortController,
    Promise,
    console
  });

  vm.runInContext(runtimeSource, context, { filename: 'local-ai-runtime.js' });

  return {
    api: windowObject.__xtjLocalAI,
    clock,
    workers,
    fetchCalls,
    context,
    reset() {
      if (windowObject.__xtjLocalAI) windowObject.__xtjLocalAI.reset();
    }
  };
}

function createWorkerHarness(createEngine, options = {}) {
  const messages = [];
  const self = {
    onmessage: null,
    postMessage(message) {
      messages.push(message);
    }
  };
  const mockWebLLM = { CreateMLCEngine: createEngine };
  const transformedSource = workerSource.replace(
    "import * as webllm from '/vendor/webllm/index.js';",
    'const webllm = globalThis.__mockWebLLM;'
  );
  if (options.navigator) self.navigator = options.navigator;
  const context = vm.createContext({ self, __mockWebLLM: mockWebLLM, console });
  vm.runInContext(transformedSource, context, { filename: 'local-ai-worker.js' });
  return { self, messages, context };
}

function createChatEngine(chatCalls) {
  return {
    interruptGenerate() {},
    chat: {
      completions: {
        async create(options) {
          chatCalls.push(options);
          return (async function* () {
            yield { choices: [{ delta: { content: '本地' } }] };
            yield { choices: [{ delta: { content: '回答' } }] };
          }());
        }
      }
    }
  };
}

test('local worker classifies WebGPU storage-buffer initialization failures as unsupported', async () => {
  const harness = createWorkerHarness(async function () {
    throw new Error('Cannot initialize runtime because of requested maxStorageBuffersPerShaderStage exceeds limit. requested=10, limit=8.');
  });

  await harness.self.onmessage({ data: { type: 'init', requestId: 'low-limit' } });
  assert.equal(harness.messages.length, 2);
  assert.equal(harness.messages[0].type, 'status');
  assert.equal(harness.messages[0].requestId, 'low-limit');
  assert.equal(harness.messages[0].status, 'loading');
  assert.equal(harness.messages[1].type, 'error');
  assert.equal(harness.messages[1].requestId, 'low-limit');
  assert.equal(harness.messages[1].code, 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED');
  assert.match(harness.messages[1].message, /本地 Qwen.*在线 DeepSeek/);
});

test('local worker retries a Qwen q4f16 shader pipeline failure once with the q4f32 compatibility model', async () => {
  const requestedModels = [];
  const fallbackEngine = createChatEngine([]);
  const harness = createWorkerHarness(async function (modelId) {
    requestedModels.push(modelId);
    if (modelId === 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC') {
      throw new Error('Invalid ShaderModule (unlabeled) is invalid due to a previous error. While validating compute stage ([Invalid ShaderModule], entryPoint: "reshape1_kernel").');
    }
    return fallbackEngine;
  });

  await harness.self.onmessage({ data: { type: 'init', requestId: 'shader-failure' } });
  assert.deepEqual(requestedModels, [
    'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-0.5B-Instruct-q4f32_1-MLC'
  ]);
  const ready = harness.messages.find(message => message.type === 'ready');
  assert.ok(ready);
  assert.equal(ready.modelId, 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC');
  assert.equal(ready.compatibilityFallback, true);
  assert.equal(harness.messages.some(message => message.type === 'error'), false);
});

test('local worker chooses q4f32 before downloading when WebGPU does not expose shader-f16', async () => {
  const requestedModels = [];
  const harness = createWorkerHarness(async function (modelId) {
    requestedModels.push(modelId);
    return createChatEngine([]);
  }, {
    navigator: {
      gpu: {
        async requestAdapter() {
          return { features: new Set(['timestamp-query']) };
        }
      }
    }
  });

  await harness.self.onmessage({ data: { type: 'init', requestId: 'f16-preflight' } });
  assert.deepEqual(requestedModels, ['Qwen2.5-0.5B-Instruct-q4f32_1-MLC']);
  const ready = harness.messages.find(message => message.type === 'ready');
  assert.equal(ready.compatibilityFallback, true);
});

test('local runtime exposes unsupported and not_downloaded availability states', async () => {
  const supportedHarness = createRuntimeHarness();
  assert.equal(supportedHarness.api.getState(), 'idle');
  assert.equal(supportedHarness.api.getAvailabilityState(), 'not_downloaded');
  assert.equal(supportedHarness.api.getModelDescriptor().availability_state, 'not_downloaded');

  const unsupportedHarness = createRuntimeHarness({ supported: false });
  assert.equal(unsupportedHarness.api.getAvailabilityState(), 'unsupported');
  assert.equal(unsupportedHarness.api.getModelDescriptor().availability_state, 'unsupported');
  await assert.rejects(
    unsupportedHarness.api.ensureReady(),
    (error) => error && error.code === 'LOCAL_AI_UNSUPPORTED'
  );
  assert.equal(unsupportedHarness.api.getState(), 'unsupported');
});

test('local runtime rejects a low WebGPU storage-buffer limit before creating a worker or downloading', async () => {
  const harness = createRuntimeHarness({ maxStorageBuffersPerShaderStage: 8 });

  await assert.rejects(
    harness.api.ensureReady(),
    (error) => error && error.code === 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED' && /限制为 8/.test(error.message)
  );
  assert.equal(harness.api.getState(), 'unsupported');
  assert.equal(harness.api.getAvailabilityState(), 'unsupported');
  assert.equal(harness.api.getProgressText().includes('在线 DeepSeek'), true);
  assert.equal(harness.workers.length, 0, 'unsupported adapters must not start a WebLLM worker or download');
});

test('local runtime reaches downloading, initializing and ready states', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') worker.emit({
          type: 'status',
          requestId: message.requestId,
          status: 'loading'
        });
      }
    }
  });
  const init = harness.api.ensureReady();
  init.catch(() => {});
  t.after(() => harness.reset());

  await flushMicrotasks();
  assert.equal(harness.api.getState(), 'downloading');
  const worker = harness.workers[0];
  worker.emit({ type: 'status', requestId: worker.messages[0].requestId, status: 'initializing' });
  assert.equal(harness.api.getState(), 'initializing');
  worker.emit({ type: 'ready', requestId: worker.messages[0].requestId });
  await init;
  assert.equal(harness.api.getState(), 'ready');
});

test('silent worker import fails instead of leaving local Qwen downloading forever', async (t) => {
  const harness = createRuntimeHarness();
  const init = harness.api.ensureReady();
  init.catch(() => {});
  t.after(() => harness.reset());
  await flushMicrotasks();

  assert.equal(harness.api.getState(), 'downloading');
  assert.equal(harness.workers.length, 1);
  harness.clock.advance(125001);
  await assert.rejects(
    init,
    (error) => error && (error.code === 'LOCAL_AI_NO_PROGRESS' || error.code === 'LOCAL_AI_TIMEOUT')
  );
  assert.equal(harness.api.getState(), 'failed');
  assert.equal(harness.workers[0].terminated, true);
  assert.equal(harness.clock.activeTimerCount(), 0);
});

test('download stall timeout fails and terminates the worker', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') worker.emit({
          type: 'status',
          requestId: message.requestId,
          status: 'loading'
        });
      }
    }
  });
  const init = harness.api.ensureReady();
  init.catch(() => {});
  t.after(() => harness.reset());
  await flushMicrotasks();

  harness.clock.advance(125001);
  await assert.rejects(
    init,
    (error) => error && (error.code === 'LOCAL_AI_NO_PROGRESS' || error.code === 'LOCAL_AI_TIMEOUT')
  );
  assert.equal(harness.api.getState(), 'failed');
  assert.equal(harness.workers[0].terminated, true);
  assert.equal(harness.clock.activeTimerCount(), 0);
});

test('a ready worker that stops answering heartbeat pings is failed and terminated', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') {
          worker.emit({ type: 'status', requestId: message.requestId, status: 'loading' });
          worker.emit({ type: 'ready', requestId: message.requestId });
        }
      }
    }
  });
  await harness.api.ensureReady();
  t.after(() => harness.reset());

  harness.clock.advance(15000);
  assert.equal(harness.api.getState(), 'failed');
  assert.equal(harness.workers[0].terminated, true);
});

test('AbortSignal cancels model initialization and terminates its worker', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') worker.emit({
          type: 'status',
          requestId: message.requestId,
          status: 'loading'
        });
      }
    }
  });
  const controller = new AbortController();
  const init = harness.api.ensureReady({ signal: controller.signal });
  init.catch(() => {});
  t.after(() => harness.reset());
  await flushMicrotasks();

  controller.abort();
  await assert.rejects(init, (error) => error && error.code === 'LOCAL_AI_CANCELLED');
  assert.equal(harness.api.getState(), 'cancelled');
  assert.equal(harness.workers[0].terminated, true);
  assert.equal(harness.fetchCalls.length, 0, 'model loading stays inside the mocked Worker path');
});

test('cancelling one shared initialization waiter does not cancel another caller', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') worker.emit({
          type: 'status',
          requestId: message.requestId,
          status: 'loading'
        });
      }
    }
  });
  t.after(() => harness.reset());
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = harness.api.ensureReady({ signal: firstController.signal });
  const second = harness.api.ensureReady({ signal: secondController.signal });
  first.catch(() => {});
  await flushMicrotasks();
  const worker = harness.workers[0];
  firstController.abort();
  await assert.rejects(first, (error) => error && error.code === 'LOCAL_AI_CANCELLED');
  assert.equal(worker.terminated, false);
  worker.emit({ type: 'ready', requestId: worker.messages[0].requestId });
  await second;
  assert.equal(harness.api.getState(), 'ready');
  assert.equal(worker.terminated, false);
});

test('AbortSignal cancels an in-flight chat and sends worker cancel', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') {
          worker.emit({ type: 'status', requestId: message.requestId, status: 'loading' });
          worker.emit({ type: 'ready', requestId: message.requestId });
        }
      }
    }
  });
  await harness.api.ensureReady();
  const controller = new AbortController();
  const chat = harness.api.streamChat([{ role: 'user', content: '测试' }], {
    signal: controller.signal
  });
  chat.catch(() => {});
  await flushMicrotasks();
  controller.abort();
  await assert.rejects(chat, (error) => error && error.code === 'ABORTED');
  assert.ok(harness.workers[0].messages.some((message) => message.type === 'cancel'));
  t.after(() => harness.reset());
});

test('initialization error rejects callers and cleans up the worker', async (t) => {
  const harness = createRuntimeHarness({
    behavior: {
      onPost(worker, message) {
        if (message.type === 'init') {
          worker.emit({ type: 'status', requestId: message.requestId, status: 'loading' });
          worker.emit({
            type: 'error',
            requestId: message.requestId,
            code: 'LOCAL_AI_RUNTIME_ERROR',
            message: 'mock initialization failure'
          });
        }
      }
    }
  });
  const init = harness.api.ensureReady();
  init.catch(() => {});
  t.after(() => harness.reset());
  await flushMicrotasks();

  await assert.rejects(init, (error) => error && error.code === 'LOCAL_AI_RUNTIME_ERROR');
  assert.equal(harness.api.getState(), 'failed');
  assert.equal(harness.workers[0].terminated, true);
});

test('worker serializes CreateMLCEngine and clears the init lock after failure', async () => {
  const gate = deferred();
  const chatCalls = [];
  const engine = createChatEngine(chatCalls);
  let createCalls = 0;
  const harness = createWorkerHarness(() => {
    createCalls += 1;
    return gate.promise;
  });

  const first = harness.self.onmessage({ data: { type: 'init', requestId: 'init-1' } });
  const second = harness.self.onmessage({ data: { type: 'init', requestId: 'init-2' } });
  assert.equal(createCalls, 1);
  await flushMicrotasks();
  assert.deepEqual(
    harness.messages.filter((message) => message.type === 'status').map((message) => message.status),
    ['loading'],
    'the worker must not switch to the short init timeout while CreateMLCEngine is still downloading'
  );
  gate.resolve(engine);
  await Promise.all([first, second]);
  assert.equal(createCalls, 1);
  assert.deepEqual(
    harness.messages.filter((message) => message.type === 'ready').map((message) => message.requestId).sort(),
    ['init-1', 'init-2']
  );

  const firstFailure = deferred();
  let attempts = 0;
  const retryHarness = createWorkerHarness(() => {
    attempts += 1;
    if (attempts === 1) return firstFailure.promise;
    return Promise.resolve(engine);
  });
  const failedInit = retryHarness.self.onmessage({ data: { type: 'init', requestId: 'bad-init' } });
  firstFailure.reject(new Error('mock engine failed'));
  await failedInit;
  assert.equal(retryHarness.messages.at(-1).type, 'error');
  await retryHarness.self.onmessage({ data: { type: 'init', requestId: 'retry-init' } });
  assert.equal(attempts, 2);
  assert.equal(retryHarness.messages.at(-1).type, 'ready');

  await retryHarness.self.onmessage({
    data: {
      type: 'chat',
      requestId: 'chat-1',
      messages: [{ role: 'system', content: 'ignored role' }, { role: 'user', content: '你好' }]
    }
  });
  // Each successful engine initialization now performs one tiny real-token
  // warm-up before reporting ready; the final entry is the user chat.
  assert.equal(chatCalls.length, 3);
  assert.equal(chatCalls[0].max_tokens, 4);
  assert.equal(chatCalls[1].max_tokens, 4);
  assert.equal(chatCalls.at(-1).stream, true);
  assert.deepEqual(chatCalls.at(-1).messages.map((message) => message.role), ['user', 'user']);
  assert.deepEqual(
    retryHarness.messages.filter((message) => message.requestId === 'chat-1').map((message) => message.type),
    ['ready', 'delta', 'delta', 'done']
  );
});

test('Code cleanup is invoked once for repeated navigation away from Code', () => {
  const listeners = Object.create(null);
  const phase = { value: 'posts' };
  let cleanupCalls = 0;
  const panelCode = { id: 'panelCode' };
  const panelPosts = { id: 'panelPosts' };
  const tabButton = {
    classList: { contains: () => false },
    getAttribute(name) { return name === 'data-desktop-tab' ? 'posts' : null; }
  };

  const documentObject = {
    readyState: 'loading',
    addEventListener(type, listener) {
      (listeners[type] || (listeners[type] = [])).push(listener);
    },
    querySelector(selector) {
      if (selector.indexOf('.dock-panel.active') !== -1) {
        return phase.value === 'code' ? panelCode : panelPosts;
      }
      return null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; }
  };
  const windowObject = {
    __xtjCodeWorkspaceAPI: {
      cleanup() {
        cleanupCalls += 1;
        return true;
      }
    },
    switchDockTab(tab) {
      phase.value = tab === 'code' ? 'code' : 'posts';
    },
    requestAnimationFrame() {},
    addEventListener() {}
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    console,
    URL,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(desktopShellSource, context, { filename: 'desktop-shell.js' });
  for (const listener of listeners.DOMContentLoaded || []) listener();

  const click = listeners.click && listeners.click[0];
  assert.equal(typeof click, 'function');
  phase.value = 'code';
  click({
    preventDefault() {},
    target: { closest: () => tabButton }
  });
  phase.value = 'code';
  click({
    preventDefault() {},
    target: { closest: () => tabButton }
  });
  assert.equal(cleanupCalls, 1);
});

test('ai-agent preserves an existing throttleRAF implementation', () => {
  const guardEnd = aiAgentSource.search(/\r?\n\r?\n\(function\(\)/);
  assert.ok(guardEnd > 0, 'ai-agent guard prefix must be discoverable');
  const guardSource = aiAgentSource.slice(0, guardEnd);
  const sentinel = function existingThrottle() {};
  const windowObject = { throttleRAF: sentinel };
  vm.runInNewContext(guardSource, {
    window: windowObject,
    requestAnimationFrame() {}
  });
  assert.equal(windowObject.throttleRAF, sentinel);
});
