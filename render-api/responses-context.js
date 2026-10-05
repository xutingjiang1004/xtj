'use strict';

// Provider reasoning items are protocol data. Keep their content, IDs and
// encrypted fields intact across tool rounds; display text is derived separately.
function reasoningText(item) {
  if (!item) return '';
  if (Array.isArray(item.content)) return item.content.map(part => part && typeof part.text === 'string' ? part.text : '').join('');
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
      if (Array.isArray(copy.content) && !copy.content.length && reasoningText(existing)) delete copy.content;
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
  }
  return { items, add, delta };
}
module.exports = { createReasoningCollector, reasoningText };
