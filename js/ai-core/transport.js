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

    return fetch(url, fetchOptions).then(function (resp) {
      if (!resp.ok) {
        return decodeErrorResponse(resp, requestOptions).then(function (err) {
          throw err;
        });
      }
      return resp.json();
    }).catch(function (err) {
      // Already structured
      if (err && err.code) throw err;
      // Network error
      if (err && (err.name === 'TypeError' || err.message === 'Failed to fetch')) {
        throw Errors.build(Errors.CODES.NETWORK_ERROR, Errors.MESSAGES[Errors.CODES.NETWORK_ERROR], true, requestOptions);
      }
      throw Errors.classify(err, requestOptions);
    });
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

    function cancel() {
      aborted = true;
      try { reader.cancel(); } catch (e) {}
    }

    if (signal) {
      if (signal.aborted) {
        cancel();
        return Promise.resolve();
      }
      signal.addEventListener('abort', cancel, { once: true });
    }

    function cleanup() {
      if (signal) {
        try { signal.removeEventListener('abort', cancel); } catch (e) {}
      }
      try { reader.cancel(); } catch (e) {}
    }

    function pump() {
      if (aborted) return Promise.resolve();

      return reader.read().then(function (result) {
        if (aborted) return;
        if (result.done) {
          // Process remaining buffer
          if (buffer.trim()) {
            processSSEBuffer(buffer, onEvent, options);
          }
          cleanup();
          return;
        }

        buffer += decoder.decode(result.value, { stream: true });
        processSSEBuffer(buffer, onEvent, options);
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

  function processSSEBuffer(rawBuffer, onEvent, options) {
    var lines = rawBuffer.split('\n');
    // Keep the last partial line in the buffer
    var lastLine = lines[lines.length - 1];
    var completeLines = lines.slice(0, -1);

    var currentEvent = null;
    for (var i = 0; i < completeLines.length; i++) {
      var line = completeLines[i];
      if (line === '') {
        // Empty line = end of event
        if (currentEvent) {
          try { onEvent(currentEvent); } catch (e) {}
          currentEvent = null;
        }
        continue;
      }
      if (line.startsWith('data: ')) {
        var data = line.slice(6);
        if (!currentEvent) currentEvent = { type: 'message', data: '' };
        try {
          var parsed = JSON.parse(data);
          if (parsed && typeof parsed === 'object' && parsed.type) {
            // Structured SSE event: { type: "answer_delta", data: { ... } }
            currentEvent = parsed;
          } else {
            currentEvent.data = data;
          }
        } catch (e) {
          // Not JSON - treat as raw data
          currentEvent.data = data;
        }
      } else if (line.startsWith('event: ')) {
        if (!currentEvent) currentEvent = { type: 'message', data: '' };
        currentEvent.type = line.slice(7).trim();
      } else if (line.startsWith('id: ')) {
        if (!currentEvent) currentEvent = { type: 'message', data: '' };
        currentEvent.id = line.slice(4).trim();
      }
    }

    return lastLine; // Return remaining buffer
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.Transport = {
    fetchJson: fetchJson,
    readSSEStream: readSSEStream,
    decodeErrorResponse: decodeErrorResponse
  };

})();