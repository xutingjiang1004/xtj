// ==================== AI Core: Transport ====================
// Unified fetch/SSE transport with structured error decoding.
// Supports both JSON and SSE endpoints.
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};
  var Errors = CORE.Errors;

  // ── Decode a structured error from an HTTP response ────────────────────
  function decodeErrorResponse(resp, options) {
    options = options || {};
    return resp.text().then(function (text) {
      var json = null;
      try { json = JSON.parse(text); } catch (e) {}

      // Backend structured error
      if (json && json.code && json.error) {
        return Errors.build(json.code, json.error, json.retryable === true, {
          requestId: json.requestId || '',
          clientRequestId: options.clientRequestId || '',
          phase: json.phase || '',
          httpStatus: resp.status,
          toolTrace: json.tool_trace || null
        });
      }

      // Fallback: classify by HTTP status
      return Errors.classify(new Error(json && json.error ? json.error : text), {
        httpStatus: resp.status,
        requestId: options.requestId || '',
        clientRequestId: options.clientRequestId || '',
        phase: 'http_response'
      });
    });
  }

  // ── Fetch with unified error handling ──────────────────────────────────
  // Returns a Promise that resolves with parsed JSON or rejects with a structured error.
  function fetchJson(url, fetchOptions, requestOptions) {
    requestOptions = requestOptions || {};
    var signal = requestOptions.signal;
    if (fetchOptions && fetchOptions.signal) signal = fetchOptions.signal;
    var timeoutMs = Number(requestOptions.timeoutMs) || 0;
    var timer = null;
    var externalAbortHandler = null;
    if (timeoutMs > 0 && typeof AbortController === 'function') {
      var controller = new AbortController();
      var external = signal;
      timer = setTimeout(function () { try { controller.abort('timeout'); } catch (_) {} }, timeoutMs);
      if (external) {
        if (external.aborted) { try { controller.abort(external.reason || 'aborted'); } catch (_) {} }
        else if (typeof external.addEventListener === 'function') {
          // 具名 handler：请求结束（含成功/失败/超时）时必须解绑，避免外部 signal
          // 长期存活时监听器累积、以及完成后再次触发 abort 造成重复中止。
          externalAbortHandler = function () { try { controller.abort(external.reason || 'aborted'); } catch (_) {} };
          external.addEventListener('abort', externalAbortHandler, { once: true });
        }
      }
      signal = controller.signal;
    }
    function clearTimeoutTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (externalAbortHandler) {
        // 对齐 readSSEStream 的 cleanup：external 在上方 var 声明（函数作用域），此处仍可读。
        try { external.removeEventListener('abort', externalAbortHandler); } catch (_) {}
        externalAbortHandler = null;
      }
    }

    var gotResponse = false;
    return fetch(url, Object.assign({}, fetchOptions, { signal: signal })).then(function (resp) {
      gotResponse = true;
      if (!resp.ok) {
        return decodeErrorResponse(resp, requestOptions).then(function (err) {
          throw err;
        });
      }
      return resp.json();
    }).catch(function (err) {
      // Already structured
      if (err && err.code) throw err;
      // Network error：fetch 抛出的 TypeError 且未收到 HTTP 响应
      if (err instanceof TypeError && !gotResponse) {
        throw Errors.build(Errors.CODES.NETWORK_ERROR, Errors.MESSAGES[Errors.CODES.NETWORK_ERROR], true, requestOptions);
      }
      throw Errors.classify(err, requestOptions);
    }).finally(clearTimeoutTimer);
  }

  // ── SSE Stream reader ──────────────────────────────────────────────────
  // Reads SSE events from a Response body, calling onEvent for each parsed event.
  // Returns a Promise that resolves when the stream ends or is cancelled.
  function readSSEStream(response, onEvent, options) {
    options = options || {};
    if (!response.body) {
      return Promise.reject(Errors.build(Errors.CODES.STREAM_INTERRUPTED, '响应体为空', false, options));
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var signal = options.signal;
    var aborted = false;
    // SSE 事件状态提升为 readSSEStream 闭包级：跨 chunk 不重置，
    // 未派发完的 data 行一直累积到出现空行（或流结束）才派发
    var sseState = { currentEvent: null, dataLines: [] };

    function cleanup() {
      if (signal) {
        try { signal.removeEventListener('abort', cancel); } catch (e) {}
      }
      cancelReader(reader);
    }

    function cancel() {
      aborted = true;
      cleanup(); // abort 路径同样释放监听与 reader
    }

    if (signal) {
      if (signal.aborted) {
        cancel();
        return Promise.resolve();
      }
      signal.addEventListener('abort', cancel, { once: true });
    }

    // 流结束/中断时，把未遇到空行的事件补发出去
    function flushPendingEvent() {
      if (!sseState.currentEvent) return;
      if (sseState.dataLines.length) {
        sseState.currentEvent.data = sseState.dataLines.join('\n');
        sseState.dataLines = [];
      }
      try { onEvent(sseState.currentEvent); } catch (e) {}
      sseState.currentEvent = null;
    }

    function pump() {
      if (aborted) return Promise.resolve();

      return reader.read().then(function (result) {
        if (aborted) return;
        if (result.done) {
          // 先解码剩余字节，再做尾部 flush
          buffer += decoder.decode();
          if (buffer) {
            buffer = processSSEBuffer(buffer, onEvent, options, sseState) || '';
          }
          // M59：processSSEBuffer 会把末行当作“未完成行”留在 buffer 里直接丢弃，
          // 流结束时应把残余行补一个换行再送进处理，避免最后一条事件（不带
          // 结尾换行的 data/event 行）被截断。
          if (buffer) {
            buffer = processSSEBuffer(buffer + '\n', onEvent, options, sseState) || '';
          }
          flushPendingEvent();
          cleanup();
          return;
        }

        buffer += decoder.decode(result.value, { stream: true });
        buffer = processSSEBuffer(buffer, onEvent, options, sseState) || '';
        return pump();
      }).catch(function (err) {
        cleanup();
        if (aborted) return;
        if (onEvent) {
          try {
            onEvent({
              type: 'error',
              data: Errors.classify(err, options)
            });
          } catch (e) {}
        }
      });
    }

    return pump();
  }

  // Cancelling an already errored native stream rejects asynchronously. Every
  // cleanup path must consume that rejection as well as synchronous failures.
  function cancelReader(reader) {
    try { return Promise.resolve(reader && reader.cancel()).catch(function() {}); }
    catch (e) { return Promise.resolve(); }
  }

  function processSSEBuffer(rawBuffer, onEvent, options, sseState) {
    sseState = sseState || { currentEvent: null, dataLines: [] };
    // Retain a trailing CR until the next chunk so split CRLF is one delimiter.
    var trailingCR = /\r$/.test(rawBuffer);
    var lines = (trailingCR ? rawBuffer.slice(0, -1) : rawBuffer).split(/\r\n|\n|\r/);
    // Keep the last partial line in the buffer
    var lastLine = lines[lines.length - 1];
    var completeLines = lines.slice(0, -1);

    for (var i = 0; i < completeLines.length; i++) {
      var line = completeLines[i].replace(/\r$/, ''); // CRLF 兼容：\r\n / \r 均视作行结束
      if (line === '') {
        // Empty line = end of event
        if (sseState.currentEvent) {
          if (sseState.dataLines.length) {
            sseState.currentEvent.data = sseState.dataLines.join('\n');
            sseState.dataLines = [];
          }
          try { onEvent(sseState.currentEvent); } catch (e) {}
          sseState.currentEvent = null;
        }
        continue;
      }
      if (/^data:/.test(line)) {
        var data = line.slice(5);
        if (data.charAt(0) === ' ') data = data.slice(1); // 支持 data: 无空格前缀
        var parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        if (parsed && typeof parsed === 'object' && parsed.type) {
          // 带 type 的 JSON 行是一个自包含事件（后端 writeSse 每事件仅一条 data 行）。
          // 必须逐条独立派发，不可 Object.assign 合并到 currentEvent：同一事件内
          // 多行同名 type/data 会互相覆盖，导致前一条事件被吞掉。
          // 先丢弃可能由 event:/id:/原始 data 行累积的状态，避免空行再次派发空事件。
          sseState.currentEvent = null;
          sseState.dataLines = [];
          try { onEvent(parsed); } catch (eDispatch) {}
        } else {
          // 非结构化数据按 SSE 规范累积，遇到空行/流结束时 join 后派发
          if (!sseState.currentEvent) sseState.currentEvent = { type: 'message', data: '' };
          sseState.dataLines.push(data);
        }
      } else if (/^event:/.test(line)) {
        if (!sseState.currentEvent) sseState.currentEvent = { type: 'message', data: '' };
        sseState.currentEvent.type = line.slice(6).trim();
      } else if (/^id:/.test(line)) {
        if (!sseState.currentEvent) sseState.currentEvent = { type: 'message', data: '' };
        sseState.currentEvent.id = line.slice(3).trim();
      }
    }

    return lastLine + (trailingCR ? '\r' : ''); // Return remaining buffer
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.Transport = {
    fetchJson: fetchJson,
    readSSEStream: readSSEStream,
    decodeErrorResponse: decodeErrorResponse
  };

})();
