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
const smooth = require('./sse-smooth');

const MAX_SSE_BUFFER_BYTES = 256 * 1024;
// 2026 修复：「文字一块一块蹦出来 / 卡顿感」：上游常把 content / reasoning 按
// 200-800 字符一次性推下来，前端在同一个 rAF 里整块渲染。这里在服务端只对「大块」
// 拆帧（~16ms 一帧、每帧 ~32 字符），小块照旧同步写——不是逐字打字机，不会把稳态
// 输出拖慢。文字队列在任何非文字事件（done/error/meta/tool_* /心跳）之前同步 flush，
// 所以 done 绝不会越过正文；每束最多平滑 160ms，队列过长时自动放大分片或整体 flush。
// 关闭开关：XTJ_SSE_SMOOTH=0。
const SSE_SMOOTH_ENABLED = String(process.env.XTJ_SSE_SMOOTH || '') !== '0';
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
// 正文类事件（可拆分）与其它事件（必须排在正文之后）。
function textKeyOf(payload) {
  if (!payload) return null;
  const type = payload.type;
  if (type !== 'content' && type !== 'reasoning' && type !== 'answer_chunk') return null;
  if (typeof payload.text === 'string') return 'text';
  if (typeof payload.chunk === 'string') return 'chunk';
  if (typeof payload.content === 'string') return 'content';
  return null;
}
// 每个响应一个限速队列，惰性创建；非 SSE 响应直接返回 null（照旧同步写）。
function pacerFor(res) {
  if (res._ssePacer) return res._ssePacer;
  if (!SSE_SMOOTH_ENABLED || !smooth.isStreamingSse(res)) return null;
  res._ssePacer = smooth.createTextPacer({
    res: res,
    write: function (payload, eventName) { return writeSseRaw(res, payload, eventName); },
    // 背压期间不继续写：文字留在 pacer 里，而不是把 256KB SSE 缓冲撑大。
    canWrite: function () {
      return !res._sseDrainQueued && !res.writableEnded && !res.destroyed &&
        !(res._sseState && (res._sseState.ending || res._sseState.closed));
    }
  });
  return res._ssePacer;
}
function flushSseText(res) {
  const pacer = res && res._ssePacer;
  if (!pacer) return;
  try { pacer.flush(); } catch (e) { console.error('[SSE] text flush error:', e && e.message); }
}
// 文字走队列；其它事件先同步 flush 全部排队文字，再写。
function writeSseNow(res, payload, eventName) {
  const key = textKeyOf(payload);
  if (!key) { flushSseText(res); return writeSseRaw(res, payload, eventName); }
  let pacer = null;
  try { pacer = pacerFor(res); } catch (e) { pacer = null; }
  if (pacer && pacer.push(payload, key, eventName)) return true;
  return writeSseRaw(res, payload, eventName);
}
function endSse(res, options = {}) {
  if (!res) return Promise.resolve(false);
  // 必须先 flush：writeSseRaw 一旦进入 ending 就拒绝写入，排队的尾巴会丢失。
  flushSseText(res);
  if (res._ssePacer) res._ssePacer.dispose(false);
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

function writeSseComment(res, text) {
  try {
    if (!res || res.writableEnded || res.destroyed || !res.headersSent) return false;
    const state = sseState(res);
    if (state.ending || state.closed) return false;
    const data = ': ' + String(text || 'ping').replace(/[\r\n]/g, ' ') + '\n\n';
    res._sseLastWriteAt = Date.now();
    res._sseBuffer.push(data);
    res._sseBufferBytes += Buffer.byteLength(data, 'utf8');
    state.pump();
    return !state.closed;
  } catch (e) { return false; }
}

function writeSse(res,payload,eventName){
  if(!res||!payload)return writeSseRaw(res,payload,eventName);
  if(!res._aiFollowupEnabled||eventName)return writeSseNow(res,payload,eventName);
  if(payload.type==='content'||payload.type==='answer_chunk'){
    const key=typeof payload.text==='string'?'text':typeof payload.chunk==='string'?'chunk':typeof payload.content==='string'?'content':null;
    if(key){
      // 尾巴（被 followup 流扣住的最后 15 字符）也走同一个队列，保证顺序。
      if(!res._aiFollowupStream)res._aiFollowupStream=assistantOutput.createFollowupStream(text=>writeSseNow(res,{...payload,[key]:text},eventName));
      res._aiFollowupStream.push(payload[key]);return true;
    }
  }
  if(payload.type==='done'){
    // 先同步写完已排队的正文，finish() 释放的尾巴才会接在正文之后。
    flushSseText(res);
    const parsed=res._aiFollowupStream?res._aiFollowupStream.finish(typeof payload.content==='string'?payload.content:undefined):assistantOutput.splitFollowups(payload.content||'');
    payload={...payload,content:parsed.text};
    if(typeof payload.sanitized_content==='string')payload.sanitized_content=assistantOutput.splitFollowups(payload.sanitized_content).text;
    payload.followups=payload.complete!==false&&parsed.text.trim()
      ? assistantOutput.normalizeFollowups([payload.followups,parsed.followups,res._aiFollowups].find(value=>Array.isArray(value)&&value.length),res._aiFollowupQuestion)
      : [];
  }
  return writeSseNow(res,payload,eventName);
}

module.exports = {
  writeSse: writeSse,
  writeSseComment: writeSseComment,
  endSse,
  MAX_SSE_BUFFER_BYTES: MAX_SSE_BUFFER_BYTES
};
