/** SSE write helper with backpressure protection. */
'use strict';

// 审计 ⚪：本项目存在两套 SSE writer——本模块（sse-write.js，缓冲上限 256KB）与
// ai-core/sse.js 的 createSSEWriter（上限 4MB，含连接关闭/心跳管理）。两者实现近似
// 但缓冲上限与关闭语义不同，长期维护易漂移。本模块服务于较旧路由；新代码应优先
// 使用 ai-core/sse.js。统一为单一时需按"路由实际事件量级"确认上限，此处暂不合并。

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
