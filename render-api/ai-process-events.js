'use strict';

// Store the visible order of a turn without retaining tool arguments or raw output.
const MAX_EVENTS = 128;
const MAX_TEXT = 64000;
function appendProcessEvent(res, event) {
  if (event && ['reasoning_start', 'reasoning', 'tool_calls'].includes(event.type) && !event.early && event.phase !== 'preparing' && event.phase !== 'waiting') {
    if (res._aiThinkingStartedAt == null) res._aiThinkingStartedAt = Date.now();
    if (res._aiThinkingActiveAt == null) res._aiThinkingActiveAt = Date.now();
  }
  // A later tool/reasoning round can resume after progress narration. Sum its
  // active phases; final prose, persistence and duplicate terminal events do not
  // extend the timer. A genuine zero remains a valid measurement.
  if (event && event.type === 'content') {
    const piece = String(event.text || '');
    if (piece) res._aiPendingNarration = (res._aiPendingNarration || '') + piece;
  }
  if (event && event.type === 'content' && String(event.text || '').trim() && res._aiThinkingActiveAt != null) {
    res._aiThinkingElapsedMs = (res._aiThinkingElapsedMs || 0) + Math.max(0, Date.now() - res._aiThinkingActiveAt);
    res._aiThinkingActiveAt = null;
  }
  if (!event || !['reasoning', 'tool_calls', 'tool_pending', 'tool_result', 'tool_error'].includes(event.type)) return;
  const events = res._aiProcessEvents || (res._aiProcessEvents = []);
  if (event.type === 'reasoning') {
    const room = MAX_TEXT - (res._aiProcessTextSize || 0);
    const text = String(event.text || '').slice(0, Math.max(0, room));
    if (!text) return;
    res._aiReasonSinceNarration = (res._aiReasonSinceNarration || '') + text;
    const last = events[events.length - 1];
    if (last && last.type === 'reasoning') last.text += text;
    else if (events.length < MAX_EVENTS) events.push({ type: 'reasoning', text });
    else return;
    res._aiProcessTextSize = (res._aiProcessTextSize || 0) + text.length;
    return;
  }
  function find(id, name, pending) {
    for (const group of events) {
      if (group.type !== 'tools') continue;
      for (const tool of group.tools) {
        if (id ? tool.call_id === id : tool.tool_name === name && (!pending || tool.status === 'running')) return tool;
      }
    }
    return null;
  }
  function add(id, name, args) {
    const known = find(id, name, true);
    if (known) return known;
    let group = events[events.length - 1];
    if (!group || group.type !== 'tools') {
      if (events.length >= MAX_EVENTS) return null;
      group = { type: 'tools', tools: [] }; events.push(group);
    }
    if (group.tools.length >= 32 || (res._aiProcessToolCount || 0) >= 128) return null;
    res._aiProcessToolCount = (res._aiProcessToolCount || 0) + 1;
    const detail = args && (args.query || args.url || args.location || args.city);
    const tool = { call_id: id, tool_name: name.slice(0, 80), detail: String(detail || '').slice(0, 240), status: 'running' };
    group.tools.push(tool); return tool;
  }
  if (event.type === 'tool_calls') {
    const narration = String(res._aiPendingNarration || '').trim();
    res._aiPendingNarration = '';
    if (narration && events.length < MAX_EVENTS) {
      const room = MAX_TEXT - (res._aiProcessTextSize || 0);
      const text = narration.slice(0, Math.max(0, room));
      if (text) {
        events.push({ type: 'narration', text, reasoning: String(res._aiReasonSinceNarration || '').slice(0, 8000) });
        res._aiProcessTextSize = (res._aiProcessTextSize || 0) + text.length;
      }
    }
    res._aiReasonSinceNarration = '';
    for (const call of (Array.isArray(event.tools) ? event.tools : []).slice(0, 32)) {
      add(String(call.id || call.call_id || '').slice(0, 160), String(call.name || ''), call.args);
    }
    return;
  }
  const id = String(event.call_id || event.tool_call_id || '').slice(0, 160);
  const name = String(event.tool_name || '');
  const tool = find(id, name, !id) || add(id, name, event);
  if (!tool || event.type === 'tool_pending') return;
  tool.status = event.type === 'tool_result' && event.success === true && !event.error ? 'done' : 'error';
  if(tool.status==='done'){delete tool.error;delete tool.retry_token;}
  else if(typeof event.retry_token==='string')tool.retry_token=event.retry_token;
  if (event.error) tool.error = String(event.error).slice(0, 240);
  if (event.summary) tool.summary = String(event.summary).slice(0, 160);
  if (Number.isInteger(event.count) && event.count >= 0) tool.count = event.count;
  if (Number.isInteger(event.items_total) && event.items_total >= 0) tool.items_total = event.items_total;
  if (Array.isArray(event.items)) tool.items = event.items.slice(0, 10).map(item => ({
    title: String(item && item.title || '').slice(0, 240),
    url: String(item && item.url || '').slice(0, 2048),
    snippet: String(item && item.snippet || '').slice(0, 200)
  }));
}
function getProcessEvents(res) {
  return (res._aiProcessEvents || []).map(event => event.type === 'reasoning'
    ? { type: 'reasoning', text: event.text }
    : event.type === 'narration'
      ? { type: 'narration', text: event.text, reasoning: event.reasoning || '' }
      : { type: 'tools', tools: event.tools.map(tool => Object.assign({}, tool, { status: tool.status === 'running' ? 'interrupted' : tool.status })) });
}
// ★ 2026-10-29：收尾结算。
//   思考耗时只在「正文 content 到达」时结算（见上面 appendProcessEvent 的 content 分支）。
//   如果整轮只有思考、没有正文（thinking-only / 被中断在思考阶段），_aiThinkingActiveAt
//   永远不会被清零，_aiThinkingElapsedMs 保持 undefined，最终下发 0，前端就显示
//   「已思考 0s」。构造 done 事件前补结算一次即可；正文已到达时 activeAt 为 null，
//   本函数是空操作，不会重复累加。
function settleThinkingElapsed(res) {
  if (!res || res._aiThinkingActiveAt == null) return;
  res._aiThinkingElapsedMs = (res._aiThinkingElapsedMs || 0) + Math.max(0, Date.now() - res._aiThinkingActiveAt);
  res._aiThinkingActiveAt = null;
}
module.exports = { appendProcessEvent, getProcessEvents, settleThinkingElapsed };
