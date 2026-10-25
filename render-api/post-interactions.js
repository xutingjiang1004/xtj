'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_ID = /^(?:\d{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function commentRequestId(value) {
  if (value == null || value === '') return null;
  if (!UUID.test(String(value))) throw Object.assign(new Error('评论请求标识无效'), { status: 400, code: 'invalid_request_id' });
  return String(value).toLowerCase();
}

async function createComment(db, postId, owner, content, requestId, kind = 'post') {
  const result = await db.rpc('xtj_create_comment', {
    p_post_id: postId, p_owner: owner, p_content: content,
    p_request_id: commentRequestId(requestId), p_kind: kind
  });
  if (result.error) throw Object.assign(new Error('评论暂未确认，请重试'), { status: 503, code: 'comment_unavailable' });
  const body = result.data;
  if (!body || !body.ok) throw Object.assign(new Error(body && body.code === 'idempotency_conflict' ? '这次评论的内容已改变，请重新提交' : '内容不存在、已删除或不可评论'), {
    status: body && body.code === 'idempotency_conflict' ? 409 : 404, code: body && body.code || 'not_found'
  });
  if (!body.comment || String(body.comment.post_id) !== String(postId) || body.comment.user_name !== owner || body.comment.id == null) {
    throw Object.assign(new Error('评论暂未确认，请重试'), { status: 503, code: 'comment_unavailable' });
  }
  return { data: body.comment, created: body.created === true, comment_count: body.comment_count };
}

function parseRelationCursor(value) {
  if (!value) return null;
  let cursor;
  try { cursor = typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { throw new Error('invalid_cursor'); }
  if (!cursor || (typeof cursor.id === 'number' && !Number.isSafeInteger(cursor.id)) || !ROW_ID.test(String(cursor.id || '')) || !TIMESTAMP.test(String(cursor.at || '')) || !Number.isFinite(Date.parse(cursor.at))) throw new Error('invalid_cursor');
  return { at: cursor.at, id: String(cursor.id) };
}

async function readRelationPage(db, postId, kind, options = {}) {
  const table = kind === 'likes' ? 'likes' : 'comments';
  const columns = table === 'likes' ? 'id::text,post_id,user_name,created_at' : 'id::text,post_id,user_name,content,parent_comment_id::text,generated_by_ai,created_at';
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 30));
  const ascending = table === 'comments';
  const cursor = parseRelationCursor(options.cursor);
  let query = db.from(table).select(columns, { count: 'exact' }).eq('post_id', postId);
  if (cursor) {
    const compare = ascending ? 'gt' : 'lt';
    query = query.or('created_at.' + compare + '.' + cursor.at + ',and(created_at.eq.' + cursor.at + ',id.' + compare + '.' + cursor.id + ')');
  }
  const result = await query.order('created_at', { ascending }).order('id', { ascending }).limit(limit + 1);
  if (result.error) return result;
  const rows = result.data || [], data = rows.slice(0, limit), last = data[data.length - 1];
  return { data, count: result.count, has_more: rows.length > limit,
    next_cursor: rows.length > limit && last ? JSON.stringify({ at: last.created_at, id: String(last.id) }) : null };
}

async function readFeedEngagement(db, posts, owner) {
  if (!posts.length) return { posts, comments: [], likes: [] };
  const result = await db.rpc('xtj_feed_engagement', { p_post_ids: posts.map(p => p.id), p_owner: owner || '' });
  if (result.error || !result.data || !Array.isArray(result.data.posts) || !Array.isArray(result.data.comments) || !Array.isArray(result.data.likes)) throw new Error('feed_relations_failed');
  const stats = new Map((result.data.posts || []).map(p => [String(p.id), p]));
  return { posts: posts.filter(p => stats.has(String(p.id))).map(p => Object.assign({}, p, stats.get(String(p.id)))), comments: result.data.comments, likes: result.data.likes };
}

module.exports = { commentRequestId, createComment, parseRelationCursor, readRelationPage, readFeedEngagement, ROW_ID, TIMESTAMP };
