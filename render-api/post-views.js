'use strict';

// The authenticated server owns p_actor. History and counter updates are one
// database transaction, including deduplication across server instances.
function installPostViews(app, { supabase, authenticateUser, rateLimit, normalizePostId }) {
  app.post('/api/post/view', authenticateUser, rateLimit(60000, 120), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const postId = normalizePostId(req.body && req.body.post_id);
    if (!postId) return res.status(400).json({ error: '帖子参数无效', code: 'invalid_post_id' });
    try {
      const result = await supabase.rpc('record_post_view', { p_post_id: postId, p_actor: req.userName });
      if (!result || result.error || !result.data) throw new Error('post_view_transaction_failed');
      if (!result.data.ok) return res.status(result.data.code === 'post_not_found' ? 404 : 400)
        .json({ error: '帖子不存在或无法查看', code: result.data.code || 'post_not_found' });
      return res.json(result.data);
    } catch (_) {
      return res.status(503).json({ error: '浏览记录暂时无法更新，请重试', code: 'post_view_record_failed' });
    }
  });
}
module.exports = { installPostViews };
