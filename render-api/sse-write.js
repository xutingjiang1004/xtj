/** SSE write helper with backpressure protection. */
'use strict';

// 审计 ⚪：本项目存在两套 SSE writer——本模块（sse-write.js，缓冲上限 256KB）与
// ai-core/sse.js 的 createSSEWriter（上限 4MB，含连接关闭/心跳管理）。两者实现近似
// 但缓冲上限与关闭语义不同，长期维护易漂移。本模块服务于较旧路由；新代码应优先
// 使用 ai-core/sse.js。统一为单一时需按"路由实际事件量级"确认上限，此处暂不合并。
// 2026-08-12 修复：drain 回调改为命名函数 onDrain（原 arguments.callee 在严格模式
// 下同步抛 TypeError，导致二次背压时监听器未注册、缓冲永不复排）。

const MAX_SSE_BUFFER_BYTES = 256 * 1024;
// ★ 2026 修复：支持可选 event 名（此前只写 'data: ' 帧，带事件名的路由只能裸 res.write
// 绕过背压上限）。向后兼容：未传 eventName 时行为与旧版完全一致。
function writeSse(res, payload, eventName) {
  try {
    if (res && !res.writableEnded && res.headersSent) {
      // 记录最近一次 SSE 写入时间，供路由级心跳定时器判断"沉默期"
      try { res._sseLastWriteAt = Date.now(); } catch (_) {}
      var data = eventName
        ? 'event: ' + eventName + '\ndata: ' + JSON.stringify(payload) + '\n\n'
        : 'data: ' + JSON.stringify(payload) + '\n\n';
      if (!res._sseBuffer) { res._sseBuffer = []; res._sseBufferBytes = 0; }
      // A slow/disconnected client must not turn one stream into an unbounded
      // in-process queue.  Closing is safer than retaining generated content.
      if ((res._sseBufferBytes || 0) + Buffer.byteLength(data, 'utf8') > MAX_SSE_BUFFER_BYTES) {
        console.warn('[SSE] client backpressure limit exceeded; closing stream');
        try { res.end(); } catch (_) {}
        return false;
      }
      // 注意：命名函数 onDrain 代替 arguments.callee（后者在 'use strict' 下访问会同步抛
      // TypeError，导致二次背压时 drain 监听器未注册、缓冲永不复排、连接关闭时静默丢失）。
      function onDrain() {
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
                  res.once('drain', onDrain);
                }
                break;
              }
            } catch (_) { break; }
          }
          // ★ 2026-09-11：背压恢复后重新排出的这批帧同样需要主动 flush，
          //   否则会再次被 socket/代理缓冲压住（与上面的首帧 flush 同一根因）。
          try { if (typeof res.flush === 'function') res.flush(); } catch (_flushErr) {}
        }
      }
      // 已处于背压排队态（缓冲区非空或正等待 drain）：本帧入队，由 onDrain 统一写出，
      // 这样 MAX_SSE_BUFFER_BYTES 内存上限才能兜住慢客户端。
      if (res._sseBuffer.length > 0 || res._sseDrainQueued) {
        res._sseBuffer.push(data);
        res._sseBufferBytes += Buffer.byteLength(data, 'utf8');
        if (!res._sseDrainQueued) {
          res._sseDrainQueued = true;
          res.once('drain', onDrain);
        }
        return true;
      }
      var ok = res.write(data);
      // ★ 2026-09-11 修复（深度研究"连接中断"根因之一）：此前 writeSse 只调用 res.write()
      //   而从不 flush。Node 会先写入 socket 缓冲，配合 CDN/反向代理（Render 前置代理）
      //   的响应缓冲，SSE 首帧可能被压住数十秒才下发 —— 前端因此看到"长时间无数据"
      //   并在 idle watchdog 触发后渲染「连接中断」。
      //   res.flushHeaders() 只在 headers 未发送时有效；此处需用 flush() 主动把
      //   chunked 编码的当前帧推出去（Node >= 12 的 http.ServerResponse#flush）。
      try { if (typeof res.flush === 'function') res.flush(); } catch (_flushErr) {}
      if (!ok) {
        // write()===false 仅表示数据已排入 Node 内部缓冲（随后会自动 flush），并非"写入失败"。
        // 当前帧已被接受，绝不能重复入队（否则 drain 时重复写出，客户端收到重复事件）。
        // 仅登记 drain 标记，使后续帧走上面的排队分支，从而保留背压下的内存上限保护。
        res._sseDrainQueued = true;
        res.once('drain', onDrain);
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
