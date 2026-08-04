// ==================== AI Core: SSE Helpers ====================
// Shared SSE response setup, event formatting, heartbeat, and safe write.
'use strict';

// ── SSE Response Setup ───────────────────────────────────────────────────
function setupSSE(res, req) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Flush headers immediately
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

// ── Safe SSE Write ───────────────────────────────────────────────────────
// Prevents writing after response is closed/finished.
// Node's res.write returns false when the output buffer reaches the
// high-water mark. That is normal backpressure, not a disconnect: we queue
// the pending frames and flush them on 'drain' instead of dropping the
// stream. Only an actual close/finish (or an unbounded buffer over the
// safety cap) returns false.
function createSSEWriter(res, req) {
  var closed = false;
  var finished = false;
  var _buffer = [];
  var _bufferBytes = 0;
  var _drainQueued = false;
  var MAX_SSE_BUFFER_BYTES = 4 * 1024 * 1024; // 4MB safety cap per stream

  function markClosed() { closed = true; _buffer = []; _bufferBytes = 0; }
  function markFinished() { finished = true; _buffer = []; _bufferBytes = 0; }

  if (res.on) {
    res.on('close', markClosed);
    res.on('finish', markFinished);
  }
  if (req && req.on) {
    req.on('aborted', markClosed);
  }

  function flushBuffer() {
    if (_drainQueued) return;
    if (_buffer.length === 0) return;
    if (closed || finished || res.writableEnded || res.finished) {
      _buffer = [];
      _bufferBytes = 0;
      return;
    }
    _drainQueued = true;
    res.once('drain', function () {
      _drainQueued = false;
      var pending = _buffer.slice();
      _buffer = [];
      _bufferBytes = 0;
      for (var i = 0; i < pending.length; i++) {
        if (closed || finished || res.writableEnded || res.finished) break;
        try {
          if (res.write(pending[i]) === false) {
            // Re-queue only the still-pending tail
            _buffer = pending.slice(i + 1);
            _bufferBytes = _buffer.reduce(function (n, d) { return n + Buffer.byteLength(d, 'utf8'); }, 0);
            flushBuffer();
            break;
          }
        } catch (e) {
          markClosed();
          break;
        }
      }
    });
  }

  function write(data) {
    if (closed || finished) return false;
    if (res.writableEnded || res.finished) {
      markFinished();
      return false;
    }
    try {
      var ok = res.write(data);
      if (ok !== false) return true;
      // Backpressure: queue the frame and flush on drain. Return true so the
      // caller keeps producing content instead of aborting the stream.
      if ((_bufferBytes || 0) + Buffer.byteLength(data, 'utf8') > MAX_SSE_BUFFER_BYTES) {
        // Safety cap: a client that cannot keep up for this long is effectively
        // disconnected; stop rather than buffer unboundedly.
        markClosed();
        return false;
      }
      _buffer.push(data);
      _bufferBytes += Buffer.byteLength(data, 'utf8');
      flushBuffer();
      return true;
    } catch (e) {
      markClosed();
      return false;
    }
  }

  function isClosed() { return closed || finished; }

  function cleanup() {
    markClosed();
  }

  return {
    write: write,
    isClosed: isClosed,
    cleanup: cleanup
  };
}

// ── SSE Event Formatting ─────────────────────────────────────────────────
function formatSSEEvent(event) {
  var lines = [];
  if (event.id !== undefined && event.id !== null) lines.push('id: ' + event.id);
  var eventName = event.event || event.type;
  if (eventName) lines.push('event: ' + eventName);
  if (event.data !== undefined) {
    // Structured AI events are consumed from data.type/data.data by the Code
    // client. Keep the legacy { event, data } shape as a payload-only event.
    var payload = event.type && !event.event ? event : event.data;
    var data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    String(data).split(/\r?\n/).forEach(function(line) {
      lines.push('data: ' + line);
    });
  }
  return lines.join('\n') + '\n\n';
}

// ── Structured SSE Event ─────────────────────────────────────────────────
function buildSSEEvent(base, type, data) {
  base = base || {};
  return {
    event_id: base.event_id || 0,
    stream_id: base.stream_id || '',
    request_id: base.request_id || '',
    client_request_id: base.client_request_id || '',
    conversation_id: base.conversation_id || '',
    timestamp: new Date().toISOString(),
    type: type,
    data: data || {}
  };
}

// ── Heartbeat Manager ────────────────────────────────────────────────────
function createHeartbeat(writer, getBase, intervalMs, getData) {
  intervalMs = intervalMs || 10000; // 10 seconds default
  var timer = null;
  var stopped = false;

  function start() {
    if (stopped) return;
    timer = setInterval(function () {
      if (stopped) return;
      var base = getBase ? getBase() : {};
      var data = Object.assign({
        elapsed_ms: Date.now() - (base.startTime || 0)
      }, getData && typeof getData === 'function' ? getData() : {});
      var event = buildSSEEvent(base, 'heartbeat', data);
      var ok = writer.write(formatSSEEvent(event));
      if (!ok) stop();
    }, intervalMs);
    if (timer && timer.unref) timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function isRunning() { return !stopped && timer !== null; }

  return {
    start: start,
    stop: stop,
    isRunning: isRunning
  };
}

module.exports = {
  setupSSE: setupSSE,
  createSSEWriter: createSSEWriter,
  formatSSEEvent: formatSSEEvent,
  buildSSEEvent: buildSSEEvent,
  createHeartbeat: createHeartbeat
};
