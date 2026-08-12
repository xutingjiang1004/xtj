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
  var _draining = false; // 背压模式标志
  var MAX_SSE_BUFFER_BYTES = 4 * 1024 * 1024; // 4MB safety cap per stream
  var closeCallbacks = [];

  function markClosed() {
    if (closed) return; // 幂等：close 事件/aborted/主动 cleanup 可能多次触发
    closed = true;
    _buffer = [];
    _bufferBytes = 0;
    _draining = false;
    // 主动结束响应。注意：不能在此 res.destroy()——正常收尾（finalizeStream 写完
    // done 事件后 cleanup）时 destroy 会用 RST 替代 FIN，把 Node 缓冲中尚未落盘的
    // 终态事件截断，客户端收不到 done/error 而反复重连；悬挂连接由心跳超时兜底。
    try { res.end(); } catch (_) {}
    for (var i = 0; i < closeCallbacks.length; i++) {
      try { closeCallbacks[i](); } catch (_) {}
    }
  }
  function markFinished() { finished = true; _buffer = []; _bufferBytes = 0; _draining = false; }

  if (res.on) {
    res.on('close', markClosed);
    res.on('finish', markFinished);
  }
  if (req && req.on) {
    req.on('aborted', markClosed);
  }

  // 无论 _buffer 是否为空都只注册一次 drain 监听；_draining 在 drain 回调中
  // 复位，避免在未真正 drain 前反复进出背压模式。
  function ensureDrainHandler() {
    if (_drainQueued) return;
    if (!res || typeof res.once !== 'function') return;
    _drainQueued = true;
    res.once('drain', drainFlush);
  }

  function drainFlush() {
    _drainQueued = false;
    _draining = false;
    if (closed || finished || res.writableEnded || res.finished) {
      _buffer = [];
      _bufferBytes = 0;
      return;
    }
    var pending = _buffer.slice();
    _buffer = [];
    _bufferBytes = 0;
    for (var i = 0; i < pending.length; i++) {
      if (closed || finished || res.writableEnded || res.finished) break;
      try {
        if (res.write(pending[i]) === false) {
          // 当前帧已被 Node 接受，只 re-queue 之后的新帧，继续等待下一次 drain
          _buffer = pending.slice(i + 1);
          _bufferBytes = _buffer.reduce(function (n, d) { return n + Buffer.byteLength(d, 'utf8'); }, 0);
          _draining = true;
          ensureDrainHandler();
          break;
        }
      } catch (e) {
        markClosed();
        break;
      }
    }
  }

  function write(data) {
    if (closed || finished) return false;
    if (res.writableEnded || res.finished) {
      markFinished();
      return false;
    }
    // 背压模式：直接入队，不调用 res.write
    if (_draining) {
      if ((_bufferBytes || 0) + Buffer.byteLength(data, 'utf8') > MAX_SSE_BUFFER_BYTES) {
        markClosed();
        return false;
      }
      _buffer.push(data);
      _bufferBytes += Buffer.byteLength(data, 'utf8');
      return true;
    }
    try {
      var ok = res.write(data);
      if (ok !== false) return true;
      // 背压：当前帧已被 Node 内部缓冲，不要重新入队；只缓存之后产生的新帧
      _draining = true;
      ensureDrainHandler();
      // 兜底：Node 内部写缓冲无上限增长时直接销毁连接，防止内存无限膨胀
      if (typeof res.writableLength === 'number' && res.writableLength > MAX_SSE_BUFFER_BYTES) {
        markClosed();
        return false;
      }
      return true;
    } catch (e) {
      markClosed();
      return false;
    }
  }

  function isClosed() { return closed || finished; }

  function onClose(cb) {
    if (typeof cb !== 'function') return;
    if (closed || finished) {
      // 已经关闭：立即回调，保证清理逻辑不丢失
      try { cb(); } catch (_) {}
      return;
    }
    closeCallbacks.push(cb);
  }

  function cleanup() {
    markClosed();
  }

  return {
    write: write,
    isClosed: isClosed,
    cleanup: cleanup,
    onClose: onClose
  };
}

// ── SSE Event Formatting ─────────────────────────────────────────────────
function formatSSEEvent(event) {
  var lines = [];
  // 审计 ⚪ 字段单行化消毒：id/event 若含换行会破坏 SSE 帧结构（可伪造出新的
  // id:/event:/data: 行）。data 字段下方按行前缀 'data: '，天然安全，无需处理。
  if (event.id !== undefined && event.id !== null) {
    lines.push('id: ' + String(event.id).replace(/[\r\n]+/g, ' '));
  }
  var eventName = event.event || event.type;
  if (eventName) lines.push('event: ' + String(eventName).replace(/[\r\n]+/g, ' '));
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
  var closeHooked = false;

  function start() {
    if (timer) return; // 幂等：重复 start 不创建第二个 interval
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
    // 连接关闭时自动停掉心跳：writer 的 onClose 与底层 res 的 close 事件绑定
    if (!closeHooked && writer && typeof writer.onClose === 'function') {
      closeHooked = true;
      writer.onClose(stop);
    }
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
