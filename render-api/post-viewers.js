'use strict';

// Distinct viewers of a post for the stats panel. record_post_view stores one
// '__post_view__' row per (viewer, post, day); the panel wants people, so the
// rows are collapsed per viewer (latest visit wins) before paging. No schema
// change: it reads the rows the existing transaction already writes.
const VIEW_SCAN_LIMIT = 5000;
const MAX_PAGE = 50;
const PAGE_SIZE = 1000;

function parseViewerOffset(value) {
  if (value == null || value === '') return 0;
  const text = String(value);
  if (!/^\d{1,6}$/.test(text)) throw new Error('invalid_cursor');
  return Number(text);
}

async function readPostViewers(db, postId, options = {}) {
  const offset = parseViewerOffset(options.cursor);
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(options.limit) || 30));
  // Supabase 的 API 不管 limit 要多少，单次最多只给 1000 行（db-max-rows），所以按页读，别指望一次 limit(5000)。
  const scanned = [];
  for (let from = 0; from < VIEW_SCAN_LIMIT; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, VIEW_SCAN_LIMIT) - 1;
    const result = await db.from('posts').select('user_name,created_at')
      .eq('media_type', '__post_view__').eq('media_url', String(postId))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
    if (result.error) return result;
    const rows = result.data || [];
    scanned.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  const seen = new Set();
  const viewers = [];
  for (const row of scanned) {
    const name = row && typeof row.user_name === 'string' ? row.user_name.trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    viewers.push({ id: key, user_name: name, created_at: row.created_at });
  }
  const data = viewers.slice(offset, offset + limit);
  const hasMore = offset + limit < viewers.length;
  return { data, count: viewers.length, has_more: hasMore, next_cursor: hasMore ? String(offset + limit) : null,
    truncated: scanned.length >= VIEW_SCAN_LIMIT };
}

module.exports = { readPostViewers, parseViewerOffset, VIEW_SCAN_LIMIT };
