'use strict';

const CONVERSATION_ID = /^[A-Za-z0-9-]{6,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function aiConversationActorPattern(id) {
  if (!CONVERSATION_ID.test(String(id || ''))) throw new Error('invalid_conversation_id');
  // SQL LIKE treats every underscore as a wildcard, including the delimiter.
  return 'ai\\_msg\\_conv\\_' + id + '\\_%';
}
function parseAiHistoryCursor(raw, conversationList = false) {
  if (!raw) return null;
  let cursor;
  try { cursor = String(raw).startsWith('{') ? JSON.parse(raw) : { at: raw }; }
  catch (_) { throw new Error('invalid_history_cursor'); }
  if (!cursor || typeof cursor.at !== 'string' || !TIME.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at)) ||
      (cursor.id !== undefined && !(conversationList ? CONVERSATION_ID : UUID).test(String(cursor.id)))) throw new Error('invalid_history_cursor');
  return { at: cursor.at, id: cursor.id || null };
}
function applyAiHistoryCursor(query, cursor) {
  if (!cursor) return query;
  return cursor.id ? query.or('created_at.lt.' + cursor.at + ',and(created_at.eq.' + cursor.at + ',id.lt.' + cursor.id + ')') :
    query.lt('created_at', cursor.at);
}
async function queryAiHistoryPage(db, options) {
  const { userName, marker, convId, limit, parseMeta } = options;
  const pageSize = Math.min(limit + 24, 100), visible = [];
  let cursor = options.cursor, exhausted = false;
  // Keep individual transfers small while stepping over old soft-deleted rows.
  // A budget failure is explicit, never a successful empty/partial history.
  for (let page = 0; page < 64; page++) {
    const query = db.from('posts').select('id,user_name,actor_key,content,media_url,created_at')
      .eq('user_name', userName).eq('media_type', marker)
      .filter('actor_key', 'like', aiConversationActorPattern(convId))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize);
    const result = await applyAiHistoryCursor(query, cursor);
    if (!result || result.error) throw result && result.error || new Error('history_unavailable');
    const rows = result.data || [];
    for (const row of rows) if (!(parseMeta(row) || {}).deleted) {
      visible.push(row); if (visible.length > limit) break;
    }
    exhausted = rows.length < pageSize;
    if (visible.length > limit || exhausted) break;
    const last = rows[rows.length - 1];
    if (!last || !UUID.test(last.id) || !TIME.test(last.created_at)) throw new Error('invalid_history_page');
    cursor = { at: last.created_at, id: last.id };
    if (page === 63) throw new Error('history_scan_limit');
  }
  return { rows: visible.slice(0, limit), hasMore: visible.length > limit || !exhausted };
}
module.exports = { aiConversationActorPattern, parseAiHistoryCursor, applyAiHistoryCursor, queryAiHistoryPage };
