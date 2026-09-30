'use strict';
const { NORMAL_POST_MEDIA_TYPES, isNormalPost } = require('./post-query');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['posts', 'views', 'likes', 'comments'];
const FIELDS = 'id,user_name,content,media_type,media_url,created_at,visibility,is_deleted';
async function result(query) {
  const value = await query;
  if (!value || value.error) throw new Error('records_unavailable');
  return value;
}
function textOf(post) {
  let text = String(post.content || '');
  try { const body = JSON.parse(text); if (body && body.__type === '__xtj_post_v2__') text = String(body.text || ''); } catch (_) {}
  return text.slice(0, 240);
}
function createProfileRecords({ express, supabase, authenticateUser, rateLimit }) {
  const router = express.Router();
  router.use(authenticateUser);
  if (rateLimit) router.use(rateLimit(60000, 60));
  function query(actor, kind, count, cursor) {
    const opts = count ? { count: 'exact', head: true } : { count: 'exact' };
    let q;
    if (kind === 'likes' || kind === 'comments') q = supabase.from(kind)
      .select(count ? 'id' : (kind === 'comments' ? 'id,post_id,content,created_at' : 'id,post_id,created_at'), opts).eq('user_name', actor);
    else q = supabase.from('posts').select(count ? 'id' : (kind === 'views' ? 'id,media_url,created_at' : FIELDS), opts).eq('user_name', actor);
    if (kind === 'views') q = q.eq('media_type', '__post_view__');
    if (kind === 'posts') {
      const normal = 'media_type.is.null,media_type.eq."",' + NORMAL_POST_MEDIA_TYPES.map(type => 'media_type.eq.' + type).join(',');
      q = q.not('is_deleted', 'is', true).or(cursor ? 'and(or(' + normal + '),or(' + cursor + '))' : normal);
    } else if (cursor) q = q.or(cursor);
    return q;
  }
  router.get('/summary', async (req, res) => {
    try {
      const values = await Promise.all(KINDS.map(kind => result(query(req.userName, kind, true))));
      res.json({ ok: true, totals: Object.fromEntries(KINDS.map((kind, i) => [kind, values[i].count || 0])) });
    } catch (_) { res.status(503).json({ ok: false, error: '记录暂时无法加载，请重试' }); }
  });
  router.get('/', async (req, res) => {
    const kind = String(req.query.kind || ''), at = req.query.before_at, id = req.query.before_id;
    if (!KINDS.includes(kind) || !!at !== !!id || (at && (!/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at)) || !UUID.test(id)))) {
      return res.status(400).json({ ok: false, error: '记录参数无效' });
    }
    const limit = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 20));
    try {
      // Match timestamps AND ids so equal-time rows do not disappear between pages.
      const cursor = at ? 'created_at.lt.' + new Date(at).toISOString() + ',and(created_at.eq.' + new Date(at).toISOString() + ',id.lt.' + id + ')' : '';
      let q = query(req.userName, kind, false, cursor);
      const page = await result(q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1));
      const all = page.data || [], rows = all.slice(0, limit);
      let posts = rows;
      if (kind !== 'posts') {
        const ids = [...new Set(rows.map(row => kind === 'views' ? row.media_url : row.post_id).filter(value => UUID.test(String(value))))];
        posts = ids.length ? (await result(supabase.from('posts').select(FIELDS).in('id', ids))).data || [] : [];
      }
      const visible = new Map(posts.filter(post => isNormalPost(post) && (post.visibility !== 'private' || post.user_name === req.userName)).map(post => [String(post.id), post]));
      const items = rows.map(row => {
        const postId = String(kind === 'posts' ? row.id : kind === 'views' ? row.media_url : row.post_id);
        const post = visible.get(postId);
        return { id: row.id, post_id: post ? postId : null, created_at: row.created_at,
          author: post ? post.user_name : '', text: post ? textOf(post) : '这条动态已删除或暂时不可查看',
          media_type: post ? post.media_type : '', comment: kind === 'comments' ? String(row.content || '').slice(0, 240) : '', available: !!post };
      });
      const last = rows[rows.length - 1];
      res.json({ ok: true, items, total: page.count || 0, has_more: all.length > limit,
        next_cursor: all.length > limit && last ? { at: last.created_at, id: last.id } : null });
    } catch (_) { res.status(503).json({ ok: false, error: '记录暂时无法加载，请重试' }); }
  });
  return router;
}
module.exports = { createProfileRecords, textOf };
