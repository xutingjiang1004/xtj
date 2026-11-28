'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_ID = /^(?:\d{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function commentRequestId(value) {
  if (value == null || value === '') return null;
  if (!UUID.test(String(value))) throw Object.assign(new Error('评论请求标识无效'), { status: 400, code: 'invalid_request_id' });
  return String(value).toLowerCase();
}

async function createComment(db, postId, owner, content, requestId, kind = 'post', parentCommentId = null) {
  // Only send the parent when replying: plain comments keep the original RPC
  // arguments, so they work before and after the reply migration.
  const args = {
    p_post_id: postId, p_owner: owner, p_content: content,
    p_request_id: commentRequestId(requestId), p_kind: kind
  };
  if (parentCommentId != null) args.p_parent_comment_id = parentCommentId;
  const result = await db.rpc('xtj_create_comment', args);
  if (result.error) throw Object.assign(new Error('评论暂未确认，请重试'), { status: 503, code: 'comment_unavailable' });
  const body = result.data;
  if (!body || !body.ok) {
    if (body && body.code === 'parent_not_found') throw Object.assign(new Error('要回复的评论不存在或已被删除'), { status: 404, code: 'parent_not_found' });
    throw Object.assign(new Error(body && body.code === 'idempotency_conflict' ? '这次评论的内容已改变，请重新提交' : '内容不存在、已删除或不可评论'), {
      status: body && body.code === 'idempotency_conflict' ? 409 : 404, code: body && body.code || 'not_found'
    });
  }
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
  const actor = owner || '';
  const standardPosts = [];
  const audiencePosts = [];
  for (const post of posts) {
    if (!post.visibility || post.visibility === 'public' || post.user_name === actor) {
      standardPosts.push(post);
    } else {
      audiencePosts.push(post);
    }
  }
  const stats = new Map();
  let comments = [];
  let likes = [];

  if (standardPosts.length) {
    const result = await db.rpc('xtj_feed_engagement', { p_post_ids: standardPosts.map(p => p.id), p_owner: actor });
    if (result.error || !result.data || !Array.isArray(result.data.posts) || !Array.isArray(result.data.comments) || !Array.isArray(result.data.likes)) throw new Error('feed_relations_failed');
    (result.data.posts || []).forEach(p => stats.set(String(p.id), p));
    comments = comments.concat(result.data.comments || []);
    likes = likes.concat(result.data.likes || []);
  }

  // 仅谁可见 / 仅谁不可见 帖子在库中为 visibility='unlisted'，原 xtj_feed_engagement RPC 只收
  // public 或本人帖；这里对已通过 canUserViewPost 鉴权的非本人受众帖直接读 service_role 互动数据。
  if (audiencePosts.length) {
    const extraIds = audiencePosts.map(p => p.id);
    const [likesRes, commentsRes] = await Promise.all([
      db.from('likes').select('id::text,post_id,user_name,created_at').in('post_id', extraIds),
      db.from('comments').select('id::text,post_id,user_name,content,parent_comment_id::text,generated_by_ai,created_at').in('post_id', extraIds).order('created_at', { ascending: true }).order('id', { ascending: true })
    ]);
    if (!likesRes || likesRes.error || !commentsRes || commentsRes.error) throw new Error('feed_relations_failed');
    const likesByPost = new Map();
    const commentsByPost = new Map();
    for (const row of (likesRes.data || [])) {
      const k = String(row.post_id);
      if (!likesByPost.has(k)) likesByPost.set(k, []);
      likesByPost.get(k).push(row);
    }
    for (const row of (commentsRes.data || [])) {
      const k = String(row.post_id);
      if (!commentsByPost.has(k)) commentsByPost.set(k, []);
      commentsByPost.get(k).push(row);
    }
    for (const post of audiencePosts) {
      const k = String(post.id);
      const pLikes = likesByPost.get(k) || [];
      const pComments = commentsByPost.get(k) || [];
      const myLike = actor ? pLikes.find(r => r.user_name === actor) : null;
      stats.set(k, {
        id: post.id,
        like_count: pLikes.length,
        comment_count: pComments.length,
        liked_by_me: !!myLike
      });
      if (myLike) likes.push(myLike);
      // 保留前 5 条预览评论（与 xtj_feed_engagement 口径一致）
      comments = comments.concat(pComments.slice(0, 5));
    }
  }

  return {
    posts: posts.filter(p => stats.has(String(p.id))).map(p => Object.assign({}, p, stats.get(String(p.id)))),
    comments,
    likes
  };
}

module.exports = { commentRequestId, createComment, parseRelationCursor, readRelationPage, readFeedEngagement, ROW_ID, TIMESTAMP };
