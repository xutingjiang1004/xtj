'use strict';
const { NORMAL_POST_MEDIA_TYPES, isNormalPost } = require('./post-query');
const { loadPostAttachments } = require('./post-attachments');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const FIELDS = 'id,user_name,content,media_type,media_url,created_at,visibility,is_deleted,is_pinned,pinned_at,updated_at,views,location_name,ip_region_text,ip_region_status';

function createAuthorPosts({ express, supabase, optionalAuth, rateLimit, looksLikeSystemTelemetry = () => false }) {
  const router = express.Router();
  router.use(optionalAuth);
  if (rateLimit) router.use(rateLimit(60000, 90));
  router.get('/:userName', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const author = String(req.params.userName || '');
    const at = req.query.before_at, id = req.query.before_id;
    if (!author || author.length > 100 || /[\x00-\x1f\x7f]/.test(author) || !!at !== !!id ||
        (at && (typeof at !== 'string' || !TIMESTAMP.test(at) || !Number.isFinite(Date.parse(at)) || !UUID.test(id)))) {
      return res.status(400).json({ ok: false, error: '动态参数无效' });
    }
    const limit = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 20));
    // Match /api/post/detail: personal private posts are visible only to their owner.
    const canSeePrivate = req.userName === author;
    const normal = 'media_type.is.null,media_type.eq."",' + NORMAL_POST_MEDIA_TYPES.map(type => 'media_type.eq.' + type).join(',');
    let cursor = at ? { at, id } : null, exhausted = false;
    const visible = [];
    try {
      // Fill bounded pages past legacy telemetry. Preserve PostgreSQL's fractional
      // seconds in the cursor; Date.toISOString() would lose microseconds.
      for (let scan = 0; scan < 8 && visible.length <= limit && !exhausted; scan++) {
        const before = cursor ? 'created_at.lt.' + cursor.at + ',and(created_at.eq.' + cursor.at + ',id.lt.' + cursor.id + ')' : '';
        let query = supabase.from('posts').select(FIELDS).eq('user_name', author).not('is_deleted', 'is', true);
        const filters = ['or(' + normal + ')'];
        if (!canSeePrivate) filters.push('or(visibility.is.null,visibility.eq.public)');
        if (before) filters.push('or(' + before + ')');
        query = query.or('and(' + filters.join(',') + ')');
        const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
        if (!result || result.error) throw Error('author_posts_unavailable');
        const rows = result.data || [];
        exhausted = rows.length < limit + 1;
        for (const post of rows) {
          cursor = { at: post.created_at, id: post.id };
          if (isNormalPost(post) && post.user_name === author && (canSeePrivate || !post.visibility || post.visibility === 'public') && !looksLikeSystemTelemetry(post.content)) visible.push(post);
          if (visible.length > limit) break;
        }
      }
      const hasMore = visible.length > limit || !exhausted;
      const page = visible.slice(0, limit);
      const last = page[page.length - 1];
      // One attachment query for the whole visible page, never one per post.
      const posts = await loadPostAttachments(supabase, page);
      res.json({ ok: true, author, posts, has_more: hasMore,
        next_cursor: hasMore ? (visible.length > limit && last ? { at: last.created_at, id: last.id } : cursor) : null });
    } catch (_) {
      res.status(503).json({ ok: false, retryable: true, error: '动态暂时无法加载，请重试' });
    }
  });
  return router;
}
module.exports = { createAuthorPosts };
