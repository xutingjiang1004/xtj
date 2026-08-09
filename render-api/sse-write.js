/** SSE write helper with backpressure protection. */
'use strict';

const MAX_SSE_BUFFER_BYTES = 256 * 1024;
function writeSse(res, payload) {
  try {
    if (res && !res.writableEnded && res.headersSent) {
      // 记录最近一次 SSE 写入时间，供路由级心跳定时器判断"沉默期"
      try { res._sseLastWriteAt = Date.now(); } catch (_) {}
      var data = 'data: ' + JSON.stringify(payload) + '\n\n';
      if (!res._sseBuffer) { res._sseBuffer = []; res._sseBufferBytes = 0; }
      // A slow/disconnected client must not turn one stream into an unbounded
      // in-process queue.  Closing is safer than retaining generated content.
      if ((res._sseBufferBytes || 0) + Buffer.byteLength(data, 'utf8') > MAX_SSE_BUFFER_BYTES) {
        console.warn('[SSE] client backpressure limit exceeded; closing stream');
        try { res.end(); } catch (_) {}
        return false;
      }
      if (res._sseBuffer.length > 0) {
        res._sseBuffer.push(data);
        res._sseBufferBytes += Buffer.byteLength(data, 'utf8');
        return true;
      }
      var ok = res.write(data);
      if (!ok) {
        res._sseBuffer.push(data);
        res._sseBufferBytes += Buffer.byteLength(data, 'utf8');
        if (!res._sseDrainQueued) {
          res._sseDrainQueued = true;
          res.once('drain', function() {
            res._sseDrainQueued = false;
            if (res._sseBuffer && res._sseBuffer.length > 0) {
              var buf = res._sseBuffer.slice();
              res._sseBuffer = [];
              res._sseBufferBytes = 0;
              for (var i = 0; i < buf.length; i++) {
                try {
                  if (res.writableEnded || !res.write(buf[i])) {
                    // Re-queue only the still-pending tail; do not recursively
                    // write after backpressure returns.
                    res._sseBuffer = buf.slice(i + 1);
                    res._sseBufferBytes = res._sseBuffer.reduce(function(n, d) { return n + Buffer.byteLength(d, 'utf8'); }, 0);
                    if (!res.writableEnded && res._sseBuffer.length) {
                      res._sseDrainQueued = true;
                      res.once('drain', arguments.callee);
                    }
                    break;
                  }
                } catch (_) { break; }
              }
            }
          });
        }
      }
      return true;
    }
  } catch (e) {
    console.error('[SSE] write error:', e && e.message);
  }
  return false;
}

module.exports = {
  writeSse: writeSse,
  MAX_SSE_BUFFER_BYTES: MAX_SSE_BUFFER_BYTES
};
