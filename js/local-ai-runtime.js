(function() {
  'use strict';

  var MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
  var worker = null;
  var ready = false;
  var serial = 0;
  var pending = Object.create(null);

  // ── State machine ────────────────────────────────────────────────
  var _state = 'idle';         // idle | downloading | initializing | ready | failed | cancelled
  var _lastErrorCode = '';
  var _lastErrorMessage = '';
  var _activeModelId = MODEL_ID;
  var _usingCompatibilityModel = false;
  var _stateChangedAt = 0;
  var _lastProgressTime = 0;
  var _lastProgressValue = 0;
  var _hasProgressValue = false;
  var _lastProgressText = '';
  var _lastActivityAt = 0;
  var _lastElapsedSeconds = 0;
  var _totalTimeoutId = null;
  var _noProgressTimeoutId = null;
  var _warmupTimeoutId = null;
  var _heartbeatIntervalId = null;
  var _initializingPromise = null;   // singleton: shared across multiple ensureReady calls
  var _initializationWaiters = 0;
  var _stopRequested = false;
  // WebLLM's Qwen graph needs this many storage buffers in a shader stage.
  // Merely having navigator.gpu is not enough: some integrated GPUs expose
  // WebGPU but have a lower adapter limit and will otherwise fail only after
  // WebLLM starts its download/initialization work.
  var REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE = 10;
  var _capabilityCheckPromise = null;
  var _capabilityError = null;

  var DOWNLOAD_TIMEOUT     = 600000;   // 10 min total download timeout
  var INIT_TIMEOUT         = 180000;   // 3 min initialization timeout
  var DOWNLOAD_NO_PROGRESS_TIMEOUT = 120000; // Network gaps during a 1 GB download are normal
  var INIT_NO_PROGRESS_TIMEOUT = 90000;     // WebGPU compilation should still fail promptly
  var WARMUP_TIMEOUT = 45000;               // engine load is not a usable inference proof
  var HEARTBEAT_INTERVAL   = 10000;    // 10 sec heartbeat interval
  // `ready` only proves WebLLM initialized. A driver can still stall on the
  // first inference dispatch while the worker continues answering pings.
  var CHAT_FIRST_TOKEN_TIMEOUT = 90000;
  var CHAT_TOTAL_TIMEOUT = 180000;

  function clearChatTimers(task) {
    if (!task) return;
    if (task.firstTokenTimer) { clearTimeout(task.firstTokenTimer); task.firstTokenTimer = null; }
    if (task.totalTimer) { clearTimeout(task.totalTimer); task.totalTimer = null; }
  }

  function failChatWatchdog(requestId, code, message) {
    var task = pending[requestId];
    if (!task || task.kind !== 'chat') return;
    delete pending[requestId];
    clearChatTimers(task);
    _lastErrorCode = code;
    _lastErrorMessage = message || '';
    try { if (worker) worker.postMessage({ type: 'cancel', requestId: requestId }); } catch (_) {}
    task.reject(makeError(code, message));
    setState('failed');
    terminateWorker();
  }

  function setState(newState) {
    _state = newState;
    _stateChangedAt = Date.now();
    _notifyStatusListeners();
  }

  function getState() {
    return _state;
  }

  function getLastErrorCode() {
    return _lastErrorCode;
  }

  function getLastErrorMessage() {
    return _lastErrorMessage;
  }

  function getAvailabilityState() {
    if (!supported()) return 'unsupported';
    if (_state === 'idle') return 'not_downloaded';
    return _state;
  }

  function getStatusText() {
    switch (_state) {
      case 'not_downloaded': return 'Local model is not downloaded';
      case 'unsupported':  return 'WebGPU is not supported in this browser';
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

  function getProgressText() {
    return _lastProgressText || getStatusText();
  }

  function hasProgressValue() { return _hasProgressValue; }
  function getLastActivityAt() { return _lastActivityAt; }
  function getElapsedSeconds() { return _lastElapsedSeconds; }

  // Keep the browser-local model's state in the same shape that a remote
  // provider status card can consume later.  Callers should not have to
  // reconstruct an actionable error from several independent getters.
  function getStatusSnapshot() {
    var failed = _state === 'failed' || _state === 'unsupported';
    var errorMessage = _lastErrorMessage || (failed ? _lastProgressText : '');
    var recommendation = '';
    if (_lastErrorCode === 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED' ||
        _lastErrorCode === 'LOCAL_AI_UNSUPPORTED' ||
        _lastErrorCode === 'LOCAL_AI_WEBGPU_ADAPTER_UNAVAILABLE' ||
        _lastErrorCode === 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED' ||
        _lastErrorCode === 'LOCAL_AI_INFERENCE_UNUSABLE') {
      recommendation = '切换到在线 DeepSeek，或更新浏览器与显卡驱动后重试';
    } else if (_state === 'failed' || _state === 'cancelled') {
      recommendation = '点击重试，或切换到在线 DeepSeek';
    }
    return {
      provider: 'local',
      modelId: _activeModelId,
      requestedModelId: MODEL_ID,
      state: _state,
      availability: getAvailabilityState(),
      statusText: getStatusText(),
      progressText: getProgressText(),
      progress: _lastProgressValue,
      hasProgress: _hasProgressValue,
      lastActivityAt: _lastActivityAt,
      timeElapsed: _lastElapsedSeconds,
      errorCode: _lastErrorCode || '',
      errorMessage: errorMessage,
      recommendation: recommendation,
      retryable: _state === 'failed' || _state === 'cancelled',
      compatibilityFallback: _usingCompatibilityModel,
      stateChangedAt: _stateChangedAt
    };
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
    var info = getStatusSnapshot();
    // Preserve the legacy listener fields while exposing the normalized
    // snapshot to newer Code/AI status renderers.
    info.text = info.progressText;
    _statusListeners.forEach(function (fn) { try { fn(info); } catch (_) {} });
  }

  // ── Timeout helpers ──────────────────────────────────────────────
  function clearTimeouts() {
    if (_totalTimeoutId) { clearTimeout(_totalTimeoutId); _totalTimeoutId = null; }
    if (_noProgressTimeoutId) { clearInterval(_noProgressTimeoutId); _noProgressTimeoutId = null; }
    if (_warmupTimeoutId) { clearTimeout(_warmupTimeoutId); _warmupTimeoutId = null; }
  }

  function setupTimeouts(downloading) {
    clearTimeouts();
    // Total timeout
    var totalMs = downloading ? DOWNLOAD_TIMEOUT : INIT_TIMEOUT;
    var noProgressMs = downloading ? DOWNLOAD_NO_PROGRESS_TIMEOUT : INIT_NO_PROGRESS_TIMEOUT;
    _totalTimeoutId = setTimeout(function () {
      _totalTimeoutId = null;
      failWithError('LOCAL_AI_TIMEOUT', '本地模型' + (downloading ? '下载' : '初始化') + '超时（' + (totalMs / 1000) + '秒）');
    }, totalMs);
    // No-progress timeout
    _lastProgressTime = Date.now();
    _noProgressTimeoutId = setInterval(function () {
      if (Date.now() - _lastProgressTime > noProgressMs) {
        clearTimeouts();
        failWithError('LOCAL_AI_NO_PROGRESS', '本地模型' + (downloading ? '下载' : '初始化') + '进度停滞超过' + (noProgressMs / 1000) + '秒');
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
      if (pending[key]) { clearChatTimers(pending[key]); pending[key].reject(err); delete pending[key]; }
    });
  }

  // ── Core functions ───────────────────────────────────────────────
  function supported() {
    return !!(window.isSecureContext && navigator.gpu && window.Worker);
  }

  function markUnsupported(code, message) {
    var error = makeError(code, message);
    _capabilityError = error;
    _lastErrorCode = code || '';
    _lastErrorMessage = message || '';
    _lastProgressText = message;
    setState('unsupported');
    return error;
  }

  function verifyWebGpuLimits() {
    if (_capabilityError) return Promise.reject(_capabilityError);
    if (_capabilityCheckPromise) return _capabilityCheckPromise;
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') {
      return Promise.reject(markUnsupported(
        'LOCAL_AI_UNSUPPORTED',
        '当前浏览器无法使用 WebGPU；本地 Qwen 未开始下载。请切换到“在线 DeepSeek”，或使用最新版 Edge/Chrome 并通过 HTTPS 打开网站。'
      ));
    }

    _capabilityCheckPromise = Promise.resolve().then(function() {
      return navigator.gpu.requestAdapter();
    }).then(function(adapter) {
      if (!adapter || !adapter.limits) {
        throw markUnsupported(
          'LOCAL_AI_WEBGPU_ADAPTER_UNAVAILABLE',
          '无法获取可用的 WebGPU 适配器；本地 Qwen 未开始下载。请切换到“在线 DeepSeek”。'
        );
      }
      var limit = Number(adapter.limits.maxStorageBuffersPerShaderStage);
      if (!isFinite(limit) || limit < REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE) {
        throw markUnsupported(
          'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED',
          '此设备的 WebGPU 存储缓冲区限制为 ' + (isFinite(limit) ? limit : '未知') +
            '，本地 Qwen 至少需要 ' + REQUIRED_STORAGE_BUFFERS_PER_SHADER_STAGE +
            '。本地下载已停止，请在模型选择器切换到“在线 DeepSeek”。'
        );
      }
      return adapter;
    }).catch(function(error) {
      _capabilityCheckPromise = null;
      if (error && error.code && error.code.indexOf('LOCAL_AI_') === 0) throw error;
      throw markUnsupported(
        'LOCAL_AI_WEBGPU_ADAPTER_UNAVAILABLE',
        '无法初始化 WebGPU 适配器；本地 Qwen 未开始下载。请切换到“在线 DeepSeek”。'
      );
    });
    return _capabilityCheckPromise;
  }

  function descriptor() {
    var snapshot = getStatusSnapshot();
    var descriptorAvailability = supported() ? 'available' : 'unsupported';
    if (snapshot.state === 'unsupported') descriptorAvailability = 'unsupported';
    if (snapshot.state === 'failed') descriptorAvailability = 'degraded';
    return {
      id: 'local-qwen2.5-0.5b',
      name: _usingCompatibilityModel ? '本地离线 · Qwen 2.5 0.5B（兼容版）' : '本地离线 · Qwen 2.5 0.5B',
      description: _usingCompatibilityModel ? '已自动切换到 q4f32 WebGPU 兼容模型；下载后可离线纯文本问答，不调用工具或文件。' : '首次联网下载约 1GB；下载后可离线纯文本问答，不调用工具或文件。',
      supports_tools: false,
      supports_thinking: false,
      supported_thinking_modes: ['off'],
      availability: descriptorAvailability,
      availability_state: snapshot.availability,
      state: snapshot.state,
      active_model_id: snapshot.modelId,
      compatibility_fallback: snapshot.compatibilityFallback,
      error_code: snapshot.errorCode,
      error_message: snapshot.errorMessage,
      recommendation: snapshot.recommendation,
      enabled: true,
      local: true
    };
  }

  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function waitForInitialization(promise, signal) {
    _initializationWaiters += 1;
    return new Promise(function(resolve, reject) {
      var settled = false;
      function release() {
        if (settled) return false;
        settled = true;
        _initializationWaiters = Math.max(0, _initializationWaiters - 1);
        if (signal) signal.removeEventListener('abort', onAbort);
        return true;
      }
      function onAbort() {
        if (!release()) return;
        // A caller leaving a shared initialization must not cancel other
        // callers. Only stop the worker when this was the last waiter.
        if (_initializationWaiters === 0 && _initializingPromise === promise) stop();
        reject(makeError('LOCAL_AI_CANCELLED', 'Local model loading was cancelled'));
      }
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      promise.then(function(value) {
        if (!release()) return;
        resolve(value);
      }, function(error) {
        if (!release()) return;
        reject(error);
      });
    });
  }

  function failWithError(code, message) {
    if (_state === 'failed' || _state === 'cancelled') return;
    _lastErrorCode = code || '';
    _lastErrorMessage = message || '';
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
    // A timeout or stalled worker must release the Worker as well as the
    // promises, otherwise a late event can resurrect a failed runtime.
    terminateWorker();
  }

  function startWorker() {
    if (worker) return worker;
    var workerUrl = '/js/local-ai-worker.min.js';
    try {
      var workerMeta = document.querySelector('meta[name="xtj-module-local-ai-worker"]');
      if (workerMeta && workerMeta.content) workerUrl = workerMeta.content;
    } catch (_) {}
    worker = new Worker(workerUrl, { type: 'module', name: 'xtj-local-qwen' });
    worker.onmessage = function(event) {
      var data = event.data || {};
      var task = pending[data.requestId];
      if (!task) return;

      if (data.type === 'progress') {
        _lastProgressTime = Date.now();
        _lastActivityAt = _lastProgressTime;
        var nextProgress = Number(data.progress);
        if (isFinite(nextProgress)) {
          _lastProgressValue = Math.max(0, Math.min(1, nextProgress));
          _hasProgressValue = true;
        }
        _lastProgressText = String(data.text || '');
        var elapsed = Number(data.timeElapsed);
        if (isFinite(elapsed) && elapsed >= 0) _lastElapsedSeconds = elapsed;
        if (_state === 'idle' || _state === 'downloading' || _state === 'initializing') {
          setState(_state === 'initializing' ? 'initializing' : 'downloading');
        }
        if (task.onProgress) task.onProgress(data);
      }
      if (data.type === 'status') {
        _lastActivityAt = Date.now();
        if (data.status === 'loading') {
          setState('downloading');
          setupTimeouts(true);
        } else if (data.status === 'initializing') {
          setState('initializing');
          setupTimeouts(false);
        } else if (data.status === 'warming') {
          clearTimeouts();
          _lastProgressText = '本地 Qwen 正在验证实际推理能力…';
          setState('initializing');
          _warmupTimeoutId = setTimeout(function() {
            failWithError('LOCAL_AI_INFERENCE_UNUSABLE', '本地 Qwen 模型已加载，但 45 秒内无法完成实际 WebGPU 推理。无需重新下载；请切换到“在线 DeepSeek”或更新浏览器与显卡驱动。');
          }, WARMUP_TIMEOUT);
        }
      }
      if (data.type === 'delta') {
        if (task.kind === 'chat' && !task.receivedFirstToken) {
          task.receivedFirstToken = true;
          if (task.firstTokenTimer) { clearTimeout(task.firstTokenTimer); task.firstTokenTimer = null; }
        }
        if (task.onDelta) task.onDelta(data.content || '');
      }
      if (data.type === 'ready') {
        ready = true;
        _activeModelId = data.modelId || MODEL_ID;
        _usingCompatibilityModel = !!data.compatibilityFallback;
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
      if (data.type === 'done') { delete pending[data.requestId]; clearChatTimers(task); task.resolve(); }
      if (data.type === 'pong') {
        if (task && task.kind === 'ping') { delete pending[data.requestId]; task.resolve(); }
        return;
      }
      if (data.type === 'error') {
        delete pending[data.requestId];
        clearChatTimers(task);
        var err = makeError(data.code || 'LOCAL_AI_RUNTIME_ERROR', data.message || '本地模型无法启动');
        _lastErrorCode = err.code || '';
        _lastErrorMessage = err.message || '';
        task.reject(err);
        // If this was an init task, transition to failed
        if (task.kind === 'init') {
          failWithError(err.code, err.message);
        } else {
          setState('failed');
          _initializingPromise = null;
          terminateWorker();
        }
      }
    };
    worker.onerror = function(event) {
      var failedWorker = worker;
      var error = makeError('LOCAL_AI_WORKER_ERROR', event && event.message || '本地模型工作线程异常');
      _lastErrorCode = error.code;
      _lastErrorMessage = error.message;
      setState('failed');
      clearTimeouts();
      stopHeartbeat();
      _initializingPromise = null;
      Object.keys(pending).forEach(function(key) { if (pending[key]) { pending[key].reject(error); delete pending[key]; } });
      try { if (failedWorker) failedWorker.terminate(); } catch (_) {}
      worker = null;
      ready = false;
    };
    return worker;
  }

  function taskId() { serial += 1; return 'local_' + Date.now() + '_' + serial; }

  function ensureReady(options) {
    options = options || {};
    if (options.signal && options.signal.aborted) {
      _lastErrorCode = 'LOCAL_AI_CANCELLED';
      _lastErrorMessage = '本地模型加载已取消';
      setState('cancelled');
      return Promise.reject(makeError('LOCAL_AI_CANCELLED', 'Local model loading was cancelled'));
    }
    if (!supported()) {
      return Promise.reject(markUnsupported(
        'LOCAL_AI_UNSUPPORTED',
        '当前浏览器不支持 WebGPU；本地 Qwen 未开始下载。请切换到“在线 DeepSeek”，或使用最新版 Edge/Chrome 并通过 HTTPS 打开网站。'
      ));
    }
    if (ready) {
      setState('ready');
      return Promise.resolve(descriptor());
    }
    return verifyWebGpuLimits().then(function() {
      // Singleton: if already initializing, return the same promise.
      if (_initializingPromise) return waitForInitialization(_initializingPromise, options.signal);

      var requestId = taskId();
      _stopRequested = false;
      _lastProgressValue = 0;
      _hasProgressValue = false;
      _lastProgressText = '';
      _lastErrorCode = '';
      _lastErrorMessage = '';
      _lastActivityAt = Date.now();
      _lastElapsedSeconds = 0;
      setState('downloading');

      _initializingPromise = new Promise(function(resolve, reject) {
        pending[requestId] = { kind: 'init', resolve: resolve, reject: reject, onProgress: options.onProgress };
        // Start the watchdog before waiting for the first Worker message. A
        // silently hung module import or CSP-blocked Worker must not leave the
        // UI in `downloading` forever.
        setupTimeouts(true);
        try {
          startWorker().postMessage({ type: 'init', requestId: requestId });
        } catch (error) {
          failWithError('LOCAL_AI_WORKER_START_FAILED', error && error.message || 'Local model worker failed to start');
        }
      });

      return waitForInitialization(_initializingPromise, options.signal);
    });
  }

  function stop() {
    if (_state === 'ready' || _state === 'idle' || _state === 'failed') return;
    _stopRequested = true;
    _lastErrorCode = 'LOCAL_AI_CANCELLED';
    _lastErrorMessage = '本地模型已停止';
    setState('cancelled');
    terminateWorker();
    _initializingPromise = null;
    _initializationWaiters = 0;
  }

  function streamChat(messages, options) {
    options = options || {};
    var requestId = taskId();
    return ensureReady({ onProgress: options.onProgress, signal: options.signal }).then(function() {
      if (options.signal && options.signal.aborted) {
        throw makeError('LOCAL_AI_CANCELLED', 'Local chat was cancelled');
      }
      if (_stopRequested) return Promise.reject(makeError('ABORTED', '已停止本地回答'));
      return new Promise(function(resolve, reject) {
        var chatTask = pending[requestId] = { kind: 'chat', resolve: resolve, reject: reject, onDelta: options.onDelta, receivedFirstToken: false, firstTokenTimer: null, totalTimer: null };
        if (typeof options.onProgress === 'function') {
          try { options.onProgress({ state: 'generating', text: '本地 Qwen 已就绪，正在生成回复…' }); } catch (_) {}
        }
        chatTask.firstTokenTimer = setTimeout(function() {
          failChatWatchdog(requestId, 'LOCAL_AI_FIRST_TOKEN_TIMEOUT', '本地 Qwen 已就绪，但 90 秒内未开始生成。已安全重置本地推理，请再试一次。');
        }, CHAT_FIRST_TOKEN_TIMEOUT);
        chatTask.totalTimer = setTimeout(function() {
          failChatWatchdog(requestId, 'LOCAL_AI_GENERATION_TIMEOUT', '本地 Qwen 生成超过 180 秒，已安全停止本次回复，请简化问题后重试。');
        }, CHAT_TOTAL_TIMEOUT);
        if (options.signal) {
          options.signal.addEventListener('abort', function() {
            if (worker) worker.postMessage({ type: 'cancel', requestId: requestId });
            if (pending[requestId]) clearChatTimers(pending[requestId]);
            if (pending[requestId]) { delete pending[requestId]; reject(makeError('ABORTED', '已停止本地回答')); }
          }, { once: true });
        }
        try {
          startWorker().postMessage({ type: 'chat', requestId: requestId, messages: messages });
        } catch (error) {
          delete pending[requestId];
          clearChatTimers(chatTask);
          reject(makeError('LOCAL_AI_WORKER_SEND_FAILED', error && error.message || 'Local chat could not start'));
        }
      });
    });
  }

  // ── Reset (for testing / recovery) ────────────────────────────────
  function reset() {
    terminateWorker();
    _state = 'idle';
    _lastErrorCode = '';
    _lastErrorMessage = '';
    _activeModelId = MODEL_ID;
    _usingCompatibilityModel = false;
    _stateChangedAt = 0;
    _lastProgressTime = 0;
    _lastProgressValue = 0;
    _lastProgressText = '';
    _initializingPromise = null;
    _stopRequested = false;
    _capabilityCheckPromise = null;
    _capabilityError = null;
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
    getLastErrorCode: getLastErrorCode,
    getLastErrorMessage: getLastErrorMessage,
    getStatusSnapshot: getStatusSnapshot,
    getActiveModelId: function() { return _activeModelId; },
    isUsingCompatibilityModel: function() { return _usingCompatibilityModel; },
    getAvailabilityState: getAvailabilityState,
    getStatusText: getStatusText,
    getProgressValue: getProgressValue,
    getProgressText: getProgressText,
    hasProgressValue: hasProgressValue,
    getLastActivityAt: getLastActivityAt,
    getElapsedSeconds: getElapsedSeconds,
    onStatusChange: onStatusChange
  };
})();
