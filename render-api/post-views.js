'use strict';

const { isNormalPost } = require('./post-query');
const { canUserViewPost } = require('./post-visibility');

// The authenticated server owns p_actor. History and counter updates are one
// database transaction, including deduplication across server instances.
function installPostViews(app, { supabase, authenticateUser, rateLimit, normalizePostId }) {
  app.post('/api/post/view', authenticateUser, rateLimit(60000, 120), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const postId = normalizePostId(req.body && req.body.post_id);
    if (!postId) return res.status(400).json({ error: '帖子参数无效', code: 'invalid_post_id' });
    try {
      // 先按完整权限模型（含 allow_list / deny_list）把关，避免未授权用户探测或刷浏览量。
      let postRow = null;
      if (typeof supabase.from === 'function') {
        const lookup = await supabase.from('posts')
          .select('id,user_name,media_type,visibility,is_deleted,content,views')
          .eq('id', postId).maybeSingle();
        if (lookup && lookup.error) throw new Error('post_view_lookup_failed');
        postRow = lookup && lookup.data ? lookup.data : null;
        if (!postRow || !isNormalPost(postRow) || !canUserViewPost(postRow, req.userName)) {
          return res.status(404).json({ error: '帖子不存在或无法查看', code: 'post_not_found' });
        }
      }

      // 公开帖或作者本人继续走原原子事务 RPC；受众定向帖（visibility='unlisted'）的非作者合法浏览者
      // 不能命中原 RPC 的 visibility='public' 过滤，由服务端直接按 UTC 日去重记录。
      if (!postRow || !postRow.visibility || postRow.visibility === 'public' || postRow.user_name === req.userName) {
        const result = await supabase.rpc('record_post_view', { p_post_id: postId, p_actor: req.userName });
        if (!result || result.error || !result.data) throw new Error('post_view_transaction_failed');
        if (!result.data.ok) return res.status(result.data.code === 'post_not_found' ? 404 : 400)
          .json({ error: '帖子不存在或无法查看', code: result.data.code || 'post_not_found' });
        return res.json(result.data);
      }

      const utcDay = new Date().toISOString().slice(0, 10);
      const actorKey = 'view:' + postId + ':' + req.userName + ':' + utcDay;
      const existing = await supabase.from('posts')
        .select('id').eq('media_type', '__post_view__').eq('actor_key', actorKey).maybeSingle();
      if (existing && existing.error) throw new Error('post_view_dedup_failed');
      let currentViews = Number(postRow.views) || 0;
      if (existing && existing.data) {
        return res.json({ ok: true, views: currentViews, counted: false });
      }
      const ins = await supabase.from('posts').insert({
        user_name: req.userName,
        media_type: '__post_view__',
        media_url: String(postId),
        actor_key: actorKey,
        visibility: 'private',
        content: JSON.stringify({ post_id: postId, post_author: postRow.user_name, day: utcDay })
      });
      if (ins && ins.error && ins.error.code !== '23505') throw new Error('post_view_insert_failed');
      if (ins && ins.error && ins.error.code === '23505') {
        return res.json({ ok: true, views: currentViews, counted: false });
      }
      const nextViews = currentViews + 1;
      const upd = await supabase.from('posts').update({ views: nextViews }).eq('id', postId).select('views').maybeSingle();
      if (upd && !upd.error && upd.data && Number.isFinite(Number(upd.data.views))) {
        currentViews = Number(upd.data.views);
      } else {
        currentViews = nextViews;
      }
      return res.json({ ok: true, views: currentViews, counted: true });
    } catch (_) {
      return res.status(503).json({ error: '浏览记录暂时无法更新，请重试', code: 'post_view_record_failed' });
    }
  });
}
module.exports = { installPostViews };
