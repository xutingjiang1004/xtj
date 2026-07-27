// ==================== AI Core: SSE Helpers ====================
// Shared SSE response setup, event formatting, heartbeat, and safe write.
'use strict';

// ── SSE Response Setup ───────────────────────────────────────────────────
function setupSSE(res, req) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
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
function createSSEWriter(res, req) {
  var closed = false;
  var finished = false;

  function markClosed() { closed = true; }
  function markFinished() { finished = true; }

  if (res.on) {
    res.on('close', markClosed);
    res.on('finish', markFinished);
  }
  if (req && req.on) {
    req.on('aborted', markClosed);
    req.on('close', markClosed);
  }

  function write(data) {
    if (closed || finished) return false;
    if (res.writableEnded || res.finished) {
      markFinished();
      return false;
    }
    try {
      res.write(data);
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
  if (event.id) lines.push('id: ' + event.id);
  if (event.event) lines.push('event: ' + event.event);
  if (event.data !== undefined) {
    var data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    lines.push('data: ' + data);
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
function createHeartbeat(writer, getBase, intervalMs) {
  intervalMs = intervalMs || 10000; // 10 seconds default
  var timer = null;
  var stopped = false;

  function start() {
    if (stopped) return;
    timer = setInterval(function () {
      if (stopped) return;
      var event = buildSSEEvent(getBase ? getBase() : {}, 'heartbeat', {
        elapsed_ms: Date.now() - (getBase ? getBase().startTime || 0 : 0)
      });
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