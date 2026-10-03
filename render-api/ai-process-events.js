'use strict';

// Store the visible order of a turn without retaining tool arguments or raw output.
const MAX_EVENTS = 128;
const MAX_TEXT = 64000;
function appendProcessEvent(res, event) {
  if (!event || !['reasoning', 'tool_calls', 'tool_pending', 'tool_result', 'tool_error'].includes(event.type)) return;
  const events = res._aiProcessEvents || (res._aiProcessEvents = []);
  if (event.type === 'reasoning') {
    const room = MAX_TEXT - (res._aiProcessTextSize || 0);
    const text = String(event.text || '').slice(0, Math.max(0, room));
    if (!text) return;
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
    : { type: 'tools', tools: event.tools.map(tool => Object.assign({}, tool, { status: tool.status === 'running' ? 'interrupted' : tool.status })) });
}
module.exports = { appendProcessEvent, getProcessEvents };
