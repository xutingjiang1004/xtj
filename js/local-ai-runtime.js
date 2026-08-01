(function() {
  'use strict';

  var MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
  var worker = null;
  var ready = false;
  var serial = 0;
  var pending = Object.create(null);

  // ── State machine ────────────────────────────────────────────────
  var _state = 'idle';         // idle | downloading | initializing | ready | failed | cancelled
  var _stateChangedAt = 0;
  var _lastProgressTime = 0;
  var _lastProgressValue = 0;
  var _totalTimeoutId = null;
  var _noProgressTimeoutId = null;
  var _heartbeatIntervalId = null;
  var _initializingPromise = null;   // singleton: shared across multiple ensureReady calls
  var _stopRequested = false;

  var DOWNLOAD_TIMEOUT     = 5 * 60 * 1000;   // 5 min
  var INIT_TIMEOUT         = 30 * 1000;        // 30 sec
  var NO_PROGRESS_TIMEOUT  = 30 * 1000;        // 30 sec
  var HEARTBEAT_INTERVAL   = 10 * 1000;        // 10 sec

  function setState(newState) {
    _state = newState;
    _stateChangedAt = Date.now();
    _notifyStatusListeners();
  }

  function getState() {
    return _state;
  }

  function getStatusText() {
    switch (_state) {
      case 'idle':         return '未启动';
      case 'downloading':  return '下载中';
      case 'initializing': return '初始化中';
      case 'ready':        return '已就绪';
      case 'failed':       return '加载失败';
      case 'cancelled':    return '已取消';
      default:             return _state;
    }
  }

  function getProgressValue() {
    return _lastProgressValue;
  }

  // ── Status listeners (for UI updates) ────────────────────────────
  var _statusListeners = [];

  function onStatusChange(fn) {
    _statusListeners.push(fn);
    return function () {
      var idx = _statusListeners.indexOf(fn);
      if (idx >= 0) _statusListeners.splice(idx, 1);
    };
  }

  function _notifyStatusListeners() {
    var info = { state: _state, text: getStatusText(), progress: _lastProgressValue };
    _statusListeners.forEach(function (fn) { try { fn(info); } catch (_) {} });
  }

  // ── Timeout helpers ──────────────────────────────────────────────
  function clearTimeouts() {
    if (_totalTimeoutId) { clearTimeout(_totalTimeoutId); _totalTimeoutId = null; }
    if (_noProgressTimeoutId) { clearTimeout(_noProgressTimeoutId); _noProgressTimeoutId = null; }
  }

  function setupTimeouts(downloading) {
    clearTimeouts();
    // Total timeout
    var totalMs = downloading ? DOWNLOAD_TIMEOUT : INIT_TIMEOUT;
    _totalTimeoutId = setTimeout(function () {
      _totalTimeoutId = null;
      failWithError('LOCAL_AI_TIMEOUT', '本地模型' + (downloading ? '下载' : '初始化') + '超时（' + (totalMs / 1000) + '秒）');
    }, totalMs);
    // No-progress timeout
    _lastProgressTime = Date.now();
    _noProgressTimeoutId = setInterval(function () {
      if (Date.now() - _lastProgressTime > NO_PROGRESS_TIMEOUT) {
        clearTimeouts();
        failWithError('LOCAL_AI_NO_PROGRESS', '本地模型' + (downloading ? '下载' : '初始化') + '进度停滞超过' + (NO_PROGRESS_TIMEOUT / 1000) + '秒');
      }
    }, 5000);
  }

  // ── Heartbeat ────────────────────────────────────────────────────
  function startHeartbeat() {
    stopHeartbeat();
    _heartbeatIntervalId = setInterval(function () {
      if (!worker) { stopHeartbeat(); return; }
      var rid = 'ping_' + Date.now();
      var timer = setTimeout(function () {
        // Worker unresponsive – treat as failed
        failWithError('LOCAL_AI_WORKER_UNRESPONSIVE', '本地模型工作线程无响应，已终止');
        terminateWorker();
      }, 5000);
      pending[rid] = {
        kind: 'ping',
        resolve: function () { clearTimeout(timer); },
        reject: function () { clearTimeout(timer); }
      };
      try { worker.postMessage({ type: 'ping', requestId: rid }); } catch (_) {
        clearTimeout(timer);
        delete pending[rid];
      }
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    if (_heartbeatIntervalId) { clearInterval(_heartbeatIntervalId); _heartbeatIntervalId = null; }
  }

  // ── Worker termination ───────────────────────────────────────────
  function terminateWorker() {
    stopHeartbeat();
    clearTimeouts();
    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }
    ready = false;
    // Reject all pending tasks
    var err = makeError('LOCAL_AI_CANCELLED', '本地模型已停止');
    Object.keys(pending).forEach(function (key) {
      if (pending[key]) { pending[key].reject(err); delete pending[key]; }
    });
  }

  // ── Core functions ───────────────────────────────────────────────
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

  function failWithError(code, message) {
    if (_state === 'failed' || _state === 'cancelled' || _state === 'ready') return;
    setState('failed');
    clearTimeouts();
    stopHeartbeat();
    var err = makeError(code, message);
    // Reject the singleton promise so all waiters see the failure
    _initializingPromise = null;
    Object.keys(pending).forEach(function (key) {
      if (pending[key] && pending[key].kind === 'init') {
        pending[key].reject(err);
        delete pending[key];
      }
    });
    // Also reject any remaining non-init tasks
    Object.keys(pending).forEach(function (key) {
      if (pending[key]) { pending[key].reject(err); delete pending[key]; }
    });
  }

  function startWorker() {
    if (worker) return worker;
    worker = new Worker('/js/local-ai-worker.min.js', { type: 'module', name: 'xtj-local-qwen' });
    worker.onmessage = function(event) {
      var data = event.data || {};
      var task = pending[data.requestId];
      if (!task) return;

      if (data.type === 'progress' && task.onProgress) {
        _lastProgressTime = Date.now();
        _lastProgressValue = Number(data.progress) || 0;
        if (_state === 'idle' || _state === 'downloading' || _state === 'initializing') {
          setState(_state === 'initializing' ? 'initializing' : 'downloading');
        }
        task.onProgress(data);
      }
      if (data.type === 'status' && data.status === 'loading') {
        setState('downloading');
        setupTimeouts(true);
      }
      if (data.type === 'delta' && task.onDelta) task.onDelta(data.content || '');
      if (data.type === 'ready') {
        ready = true;
        setState('ready');
        clearTimeouts();
        startHeartbeat();
        if (task.kind === 'init') { delete pending[data.requestId]; task.resolve(descriptor()); }
        // Resolve any other init tasks that may be pending
        Object.keys(pending).forEach(function (key) {
          var t = pending[key];
          if (t && t.kind === 'init') { delete pending[key]; t.resolve(descriptor()); }
        });
        _initializingPromise = null;
      }
      if (data.type === 'done') { delete pending[data.requestId]; task.resolve(); }
      if (data.type === 'pong') {
        if (task && task.kind === 'ping') { delete pending[data.requestId]; task.resolve(); }
        return;
      }
      if (data.type === 'error') {
        delete pending[data.requestId];
        var err = makeError(data.code || 'LOCAL_AI_RUNTIME_ERROR', data.message || '本地模型无法启动');
        task.reject(err);
        // If this was an init task, transition to failed
        if (task.kind === 'init') {
          setState('failed');
          clearTimeouts();
          stopHeartbeat();
          _initializingPromise = null;
          // Reject all other init tasks too
          Object.keys(pending).forEach(function (key) {
            var t = pending[key];
            if (t && t.kind === 'init') { delete pending[key]; t.reject(err); }
          });
        }
      }
    };
    worker.onerror = function(event) {
      var error = makeError('LOCAL_AI_WORKER_ERROR', event && event.message || '本地模型工作线程异常');
      setState('failed');
      clearTimeouts();
      stopHeartbeat();
      _initializingPromise = null;
      Object.keys(pending).forEach(function(key) { if (pending[key]) { pending[key].reject(error); delete pending[key]; } });
      worker = null;
      ready = false;
    };
    return worker;
  }

  function taskId() { serial += 1; return 'local_' + Date.now() + '_' + serial; }

  function ensureReady(options) {
    options = options || {};
    if (!supported()) return Promise.reject(makeError('LOCAL_AI_UNSUPPORTED', '当前浏览器不支持 WebGPU；请使用最新版 Edge 或 Chrome，并通过 HTTPS 打开网站。'));
    if (ready) {
      setState('ready');
      return Promise.resolve(descriptor());
    }
    // Singleton: if already initializing, return the same promise
    if (_initializingPromise) return _initializingPromise;

    var requestId = taskId();
    _stopRequested = false;
    setState('downloading');

    _initializingPromise = new Promise(function(resolve, reject) {
      pending[requestId] = { kind: 'init', resolve: resolve, reject: reject, onProgress: options.onProgress };
      startWorker().postMessage({ type: 'init', requestId: requestId });
    });

    return _initializingPromise;
  }

  function stop() {
    if (_state === 'ready' || _state === 'idle' || _state === 'failed') return;
    _stopRequested = true;
    setState('cancelled');
    terminateWorker();
    _initializingPromise = null;
  }

  function streamChat(messages, options) {
    options = options || {};
    var requestId = taskId();
    return ensureReady({ onProgress: options.onProgress }).then(function() {
      if (_stopRequested) return Promise.reject(makeError('ABORTED', '已停止本地回答'));
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

  // ── Reset (for testing / recovery) ────────────────────────────────
  function reset() {
    terminateWorker();
    _state = 'idle';
    _stateChangedAt = 0;
    _lastProgressTime = 0;
    _lastProgressValue = 0;
    _initializingPromise = null;
    _stopRequested = false;
    ready = false;
  }

  // ── Public API ───────────────────────────────────────────────────
  window.__xtjLocalAI = {
    MODEL_ID: MODEL_ID,
    LOCAL_MODEL_ID: descriptor().id,
    getModelDescriptor: descriptor,
    isSupported: supported,
    ensureReady: ensureReady,
    streamChat: streamChat,
    stop: stop,
    reset: reset,
    getState: getState,
    getStatusText: getStatusText,
    getProgressValue: getProgressValue,
    onStatusChange: onStatusChange
  };
})();