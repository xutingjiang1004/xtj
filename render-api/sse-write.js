/** SSE write helper with backpressure protection. */
'use strict';

// 审计 ⚪：本项目存在两套 SSE writer——本模块（sse-write.js，缓冲上限 256KB）与
// ai-core/sse.js 的 createSSEWriter（上限 4MB，含连接关闭/心跳管理）。两者实现近似
// 但缓冲上限与关闭语义不同，长期维护易漂移。本模块服务于较旧路由；新代码应优先
// 使用 ai-core/sse.js。统一为单一时需按"路由实际事件量级"确认上限，此处暂不合并。
// 2026-08-12 修复：drain 回调改为命名函数 onDrain（原 arguments.callee 在严格模式
// 下同步抛 TypeError，导致二次背压时监听器未注册、缓冲永不复排）。

const { appendProcessEvent } = require('./ai-process-events');
const assistantOutput = require('./ai-assistant-output');
const deepseekWeb = require('./deepseek-web');

const MAX_SSE_BUFFER_BYTES = 256 * 1024;
// ★ 2026 修复：支持可选 event 名（此前只写 'data: ' 帧，带事件名的路由只能裸 res.write
// 绕过背压上限）。向后兼容：未传 eventName 时行为与旧版完全一致。
function sseState(res) {
  if (res._sseState) return res._sseState;
  const state = { ending: false, closed: false, resolve: null, timer: null };
  res._sseBuffer = []; res._sseBufferBytes = 0;
  function finish(ok) {
    if (state.closed) return;
    state.closed = true;
    clearTimeout(state.timer);
    res.removeListener?.('drain', onDrain);
    res.removeListener?.('close', onClose);
    res.removeListener?.('error', onClose);
    res._sseBuffer = []; res._sseBufferBytes = 0; res._sseDrainQueued = false;
    if (state.resolve) state.resolve(ok);
  }
  function onClose() { finish(false); }
  function endIfReady() {
    if (state.ending && !state.closed && !res._sseDrainQueued && !res._sseBuffer.length) {
      try { if (!res.writableEnded && !res.destroyed) res.end(); finish(true); }
      catch (_) { finish(false); }
    }
  }
  function pump() {
    while (!state.closed && !res._sseDrainQueued && res._sseBuffer.length) {
      if (res.writableEnded || res.destroyed) { finish(false); break; }
      const data = res._sseBuffer.shift();
      res._sseBufferBytes -= Buffer.byteLength(data, 'utf8');
      try {
        // false means accepted by Node; only the remaining tail stays queued.
        if (!res.write(data)) { res._sseDrainQueued = true; res.once('drain', onDrain); }
        if (typeof res.flush === 'function') res.flush();
      } catch (_) { finish(false); }
    }
    endIfReady();
  }
  function onDrain() { res._sseDrainQueued = false; pump(); }
  state.pump = pump; state.finish = finish; state.endIfReady = endIfReady;
  res.once?.('close', onClose); res.once?.('error', onClose);
  res._sseState = state;
  return state;
}
function endSse(res, options = {}) {
  if (!res) return Promise.resolve(false);
  const state = sseState(res);
  if (state.promise) return state.promise;
  if (state.closed || res.writableEnded || res.destroyed) { state.finish(false); return Promise.resolve(false); }
  state.ending = true;
  state.promise = new Promise(resolve => { state.resolve = resolve; });
  // Never retain a stalled client indefinitely. Normal completion waits for
  // both the application tail and the outstanding Node drain, in order.
  state.timer = setTimeout(() => {
    state.finish(false);
    try { if (typeof res.destroy === 'function') res.destroy(); else res.end(); } catch (_) {}
  }, options.timeoutMs ?? 10000);
  state.timer.unref?.();
  state.endIfReady();
  return state.promise;
}
function writeSseRaw(res, payload, eventName) {
  if(payload && payload.type === 'done') payload = Object.assign({},payload,{usage:deepseekWeb.enrichUsage(payload.usage)});
  try {
    if (!res || res.writableEnded || res.destroyed || !res.headersSent) return false;
    const state = sseState(res);
    if (state.ending || state.closed) return false;
    require('./ai-tool-retry').observe(res,payload);
    res._sseLastWriteAt = Date.now();
    const data = (eventName ? 'event: ' + eventName + '\n' : '') + 'data: ' + JSON.stringify(payload) + '\n\n';
    if (res._sseBufferBytes + Buffer.byteLength(data, 'utf8') > MAX_SSE_BUFFER_BYTES) {
      console.warn('[SSE] client backpressure limit exceeded; closing stream');
      state.finish(false);
      if (typeof res.destroy === 'function') res.destroy(); else res.end();
      return false;
    }
    appendProcessEvent(res, payload);
    res._sseBuffer.push(data); res._sseBufferBytes += Buffer.byteLength(data, 'utf8');
    state.pump();
    return !state.closed;
  } catch (e) { console.error('[SSE] write error:', e && e.message); }
  return false;
}

function writeSse(res,payload,eventName){
  if(!res||!res._aiFollowupEnabled||!payload||eventName)return writeSseRaw(res,payload,eventName);
  if(payload.type==='content'||payload.type==='answer_chunk'){
    const key=typeof payload.text==='string'?'text':typeof payload.chunk==='string'?'chunk':typeof payload.content==='string'?'content':null;
    if(key){
      if(!res._aiFollowupStream)res._aiFollowupStream=assistantOutput.createFollowupStream(text=>writeSseRaw(res,{...payload,[key]:text}));
      res._aiFollowupStream.push(payload[key]);return true;
    }
  }
  if(payload.type==='done'){
    const parsed=res._aiFollowupStream?res._aiFollowupStream.finish(typeof payload.content==='string'?payload.content:undefined):assistantOutput.splitFollowups(payload.content||'');
    payload={...payload,content:parsed.text};
    if(typeof payload.sanitized_content==='string')payload.sanitized_content=assistantOutput.splitFollowups(payload.sanitized_content).text;
    if(payload.complete!==false&&parsed.text.trim())payload.followups=assistantOutput.normalizeFollowups([payload.followups,parsed.followups,res._aiFollowups].find(value=>Array.isArray(value)&&value.length));
    if(payload.complete!==false&&parsed.text.trim()&&(!payload.followups||payload.followups.length!==3))payload.followups=assistantOutput.contextualFollowups(res._aiFollowupQuestion,parsed.text);
  }
  return writeSseRaw(res,payload,eventName);
}

module.exports = {
  writeSse: writeSse,
  endSse,
  MAX_SSE_BUFFER_BYTES: MAX_SSE_BUFFER_BYTES
};
