(function() {
  'use strict';

  var MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
  var worker = null;
  var ready = false;
  var serial = 0;
  var pending = Object.create(null);

  function supported() {
    return !!(window.isSecureContext && navigator.gpu && window.Worker);
  }

  function descriptor() {
    return {
      id: 'local-qwen2.5-0.5b',
      name: '本地离线 · Qwen 2.5 0.5B',
      description: '首次联网下载约 1GB；下载后可离线纯文本问答，不调用工具或文件。',
      supports_tools: false,
      supports_thinking: false,
      supported_thinking_modes: ['off'],
      availability: supported() ? 'available' : 'unsupported',
      enabled: true,
      local: true
    };
  }

  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function startWorker() {
    if (worker) return worker;
    worker = new Worker('/js/local-ai-worker.min.js', { type: 'module', name: 'xtj-local-qwen' });
    worker.onmessage = function(event) {
      var data = event.data || {};
      var task = pending[data.requestId];
      if (!task) return;
      if (data.type === 'progress' && task.onProgress) task.onProgress(data);
      if (data.type === 'delta' && task.onDelta) task.onDelta(data.content || '');
      if (data.type === 'ready') {
        ready = true;
        if (task.kind === 'init') { delete pending[data.requestId]; task.resolve(descriptor()); }
      }
      if (data.type === 'done') { delete pending[data.requestId]; task.resolve(); }
      if (data.type === 'error') {
        delete pending[data.requestId];
        task.reject(makeError(data.code || 'LOCAL_AI_RUNTIME_ERROR', data.message || '本地模型无法启动'));
      }
    };
    worker.onerror = function(event) {
      var error = makeError('LOCAL_AI_WORKER_ERROR', event && event.message || '本地模型工作线程异常');
      Object.keys(pending).forEach(function(key) { pending[key].reject(error); delete pending[key]; });
      worker = null;
      ready = false;
    };
    return worker;
  }

  function taskId() { serial += 1; return 'local_' + Date.now() + '_' + serial; }

  function ensureReady(options) {
    options = options || {};
    if (!supported()) return Promise.reject(makeError('LOCAL_AI_UNSUPPORTED', '当前浏览器不支持 WebGPU；请使用最新版 Edge 或 Chrome，并通过 HTTPS 打开网站。'));
    if (ready) return Promise.resolve(descriptor());
    var requestId = taskId();
    return new Promise(function(resolve, reject) {
      pending[requestId] = { kind: 'init', resolve: resolve, reject: reject, onProgress: options.onProgress };
      startWorker().postMessage({ type: 'init', requestId: requestId });
    });
  }

  function streamChat(messages, options) {
    options = options || {};
    var requestId = taskId();
    return ensureReady({ onProgress: options.onProgress }).then(function() {
      return new Promise(function(resolve, reject) {
        pending[requestId] = { kind: 'chat', resolve: resolve, reject: reject, onDelta: options.onDelta };
        if (options.signal) {
          options.signal.addEventListener('abort', function() {
            if (worker) worker.postMessage({ type: 'cancel', requestId: requestId });
            if (pending[requestId]) { delete pending[requestId]; reject(makeError('ABORTED', '已停止本地回答')); }
          }, { once: true });
        }
        startWorker().postMessage({ type: 'chat', requestId: requestId, messages: messages });
      });
    });
  }

  window.__xtjLocalAI = {
    MODEL_ID: MODEL_ID,
    LOCAL_MODEL_ID: descriptor().id,
    getModelDescriptor: descriptor,
    isSupported: supported,
    ensureReady: ensureReady,
    streamChat: streamChat
  };
})();
