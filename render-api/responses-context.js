'use strict';

// Provider reasoning items are protocol data. Keep their content, IDs and
// encrypted fields intact across tool rounds; display text is derived separately.
function reasoningText(item) {
  if (!item) return '';
  if (Array.isArray(item.content)) {
    const text = item.content.map(part => part && typeof part.text === 'string' ? part.text : '').join('');
    if (text) return text;
  }
  if (typeof item.reasoning_text === 'string') return item.reasoning_text;
  if (typeof item.text === 'string') return item.text;
  return Array.isArray(item.summary) ? item.summary.map(part => part && part.text || '').join('') : '';
}
function createReasoningCollector() {
  const items = [], indices = new Map();
  function find(id, index) {
    if (id) { const found = items.find(item => item.id === id); if (found) return found; }
    return index != null ? indices.get(index) : items[items.length - 1];
  }
  function add(item, index) {
    if (!item || item.type !== 'reasoning') return;
    let existing = find(item.id, index);
    if (existing && item.id && existing.id && item.id !== existing.id) existing = null;
    const copy = JSON.parse(JSON.stringify(item));
    if (!existing) { existing = copy; items.push(existing); }
    else {
      // A terminal item may omit content already delivered as deltas.
      if (Array.isArray(copy.content) && !copy.content.some(part => part && part.text) && reasoningText(existing)) delete copy.content;
      Object.assign(existing, copy);
    }
    if (index != null) indices.set(index, existing);
    return existing;
  }
  function delta(event) {
    let item = find(event.item_id, event.output_index);
    if (!item) item = add(Object.assign({ type: 'reasoning', content: [] }, event.item_id ? { id: event.item_id } : {}), event.output_index);
    const index = Number.isInteger(event.content_index) && event.content_index >= 0 && event.content_index < 100 ? event.content_index : 0;
    if (!Array.isArray(item.content)) item.content = [];
    if (!item.content[index]) item.content[index] = { type: 'reasoning_text', text: '' };
    item.content[index].text = String(item.content[index].text || '') + String(event.delta || '');
    return item;
  }
  function complete(event) {
    let item = find(event.item_id, event.output_index);
    if (!item) item = add(Object.assign({type:'reasoning',content:[]},event.item_id?{id:event.item_id}:{}),event.output_index);
    const index = Number.isInteger(event.content_index) && event.content_index >= 0 && event.content_index < 100 ? event.content_index : 0;
    if (!Array.isArray(item.content)) item.content=[];
    if (typeof event.text === 'string' && event.text) item.content[index]={type:'reasoning_text',text:event.text};
    return item;
  }
  return { items, add, delta, complete };
}
function createOutputCollector() {
  const entries = [], indices = new Map();
  function add(item, index) {
    if (!item || !item.type) return;
    let entry = item.id && entries.find(row => row.item.id === item.id);
    if (!entry && index != null) entry = indices.get(index);
    if (entry && (entry.item.type !== item.type || item.id && entry.item.id && item.id !== entry.item.id)) entry = null;
    const copy = JSON.parse(JSON.stringify(item));
    if (!entry) { entry = { item: copy, index: index, order: entries.length }; entries.push(entry); }
    else {
      if (Array.isArray(copy.content) && !copy.content.length && Array.isArray(entry.item.content) && entry.item.content.length) delete copy.content;
      Object.assign(entry.item, copy);
      if (index != null) entry.index = index;
    }
    if (index != null) indices.set(index, entry);
  }
  return { add, values: () => entries.slice().sort((a,b) => (a.index == null ? a.order : a.index) - (b.index == null ? b.order : b.index)).map(row => row.item) };
}

// Replay actual model output in protocol order. Inserting a synthetic assistant
// message before a reasoning item creates a new assistant turn, so its tool calls
// no longer have the original reasoning context required by the provider.
function replayOutput(output, reasoning, calls, content, useThinking) {
  const result = [], usedReasoning = new Set(), usedCalls = new Set();
  function addReasoning(raw) {
    if (!useThinking) return;
    const item = reasoning.find(value => raw.id && value.id === raw.id) || reasoning.find(value => !usedReasoning.has(value)) || raw;
    if (usedReasoning.has(item)) return;
    usedReasoning.add(item); result.push(JSON.parse(JSON.stringify(item)));
  }
  function addCall(raw) {
    const call = calls.find(value => raw.call_id && value.id === raw.call_id || raw.id && value.itemId === raw.id) || calls.find(value => !usedCalls.has(value));
    if (!call || usedCalls.has(call)) return;
    usedCalls.add(call);
    result.push(Object.assign({}, raw, { type:'function_call', id:call.itemId || call.id, call_id:call.id, name:call.name, arguments:call.arguments || '{}' }));
  }
  for (const item of output) {
    if (item.type === 'reasoning') addReasoning(item);
    else if (item.type === 'function_call') addCall(item);
    else if (item.type === 'message' && item.role === 'assistant' && (Array.isArray(item.content) ? item.content.some(part => part && (typeof part.text === 'string' ? part.text.trim() : !['output_text','input_text'].includes(part.type))) : String(item.content || '').trim())) result.push(JSON.parse(JSON.stringify(item)));
  }
  // Delta-only reasoning has no output_item snapshot on some compatible streams.
  const missing = useThinking ? reasoning.filter(item => !usedReasoning.has(item)) : [];
  if (missing.length) result.unshift(...missing.map(item => JSON.parse(JSON.stringify(item))));
  if (!result.some(item => item.type === 'message') && content && String(content).trim()) {
    const firstCall = result.findIndex(item => item.type === 'function_call');
    result.splice(firstCall < 0 ? result.length : firstCall,0,{type:'message',role:'assistant',content:String(content)});
  }
  for (const call of calls) if (!usedCalls.has(call)) addCall({call_id:call.id});
  return result;
}

module.exports = { createReasoningCollector, createOutputCollector, replayOutput, reasoningText };
