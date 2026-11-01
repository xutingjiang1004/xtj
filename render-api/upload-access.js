'use strict';
// 不要在模块顶层解构 streamOriginal：photo-access ↔ upload-access 存在循环依赖，
// 顶层解构时对方还没执行到 module.exports，拿到的是 undefined，
// 结果是 /api/uploads/media 下所有旧图一律失败（报 streamOriginal is not a function）。
const { isNormalPost } = require('./post-query');
function mediaStreamer() { return require('./photo-access').streamOriginal; }
function uploadPath(value, origin) {
  try {
    const url = new URL(value), expected = new URL(origin);
    if (url.origin !== expected.origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/public\/uploads\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (_) { return null; }
}
async function checked(query) { const result = await query; if (!result || result.error) throw result && result.error || Error('upload_access_unavailable'); return result.data; }
function installUploadAccess(app, { supabase, supabaseUrl, optionalAuth, rateLimit, adminName, fetchImpl, previews }) {
  app.get('/api/uploads/media', optionalAuth, rateLimit(60000, 300), async (req,res) => {
    const path = String(req.query.path || '');
    if (!path || path.length > 1024 || /[\\%\u0000-\u001f\u007f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) return res.status(404).end();
    try {
      let allowed = /^(avatars|site-support)\//.test(path);
      if (path.startsWith('profile-images/')) {
        const url = supabase.storage.from('uploads').getPublicUrl(path).data.publicUrl;
        const covers = await checked(supabase.from('account_profile_settings').select('user_name,account_id,settings').eq('settings->>cover_url',url));
        const backgrounds = req.userName ? await checked(supabase.from('account_profile_settings').select('user_name,account_id,settings').eq('user_name',req.userName).eq('settings->>background_url',url)) : [];
        const rows = (covers || []).concat(backgrounds || []);
        for (const row of rows || []) {
          const auth = await checked(supabase.from('posts').select('id').eq('id',row.account_id).eq('user_name',row.user_name).eq('media_type','__auth__').maybeSingle());
          if (auth && (uploadPath(row.settings.cover_url,supabaseUrl) === path || (row.user_name === req.userName && uploadPath(row.settings.background_url,supabaseUrl) === path))) allowed = true;
        }
      } else if (!allowed) {
        // 旧帖的 media_url 直接挂在 uploads 根目录（没有 posts/ 前缀），只能走这里。
        // 原来用 ilike 模糊扫 posts / post_attachments 两张表，数据量一大就慢到超时，
        // 接口只能回 503 —— 用户看到的就是「图片一直转圈，点重试也没用」。
        // 改成按完整 URL 精确匹配，命中就走，不再全表扫描。
        const full = String(supabaseUrl || '').replace(/\/+$/, '') + '/storage/v1/object/public/uploads/' + path;
        const readable = row => isNormalPost(row) && (!row.visibility || row.visibility === 'public' || row.user_name === req.userName || req.userName === adminName);
        const exact = await checked(supabase.from('posts').select('id,user_name,media_type,media_url,visibility,is_deleted').eq('media_url', full).limit(20));
        allowed = (exact || []).some(readable);
        if (!allowed) {
          const linked = await checked(supabase.from('post_attachments').select('post_id').eq('media_url', full).limit(20));
          if (linked && linked.length) {
            const rows = await checked(supabase.from('posts').select('id,user_name,media_type,visibility,is_deleted').in('id', linked.map(x => x.post_id)));
            allowed = (rows || []).some(readable);
          }
        }
        if (!allowed && req.userName && path.startsWith('chat/')) {
          const messages = await checked(supabase.rpc('read_visible_dm_posts',{p_actor:req.userName,p_pattern:'%' + path.replace(/[\\%_]/g,'\\$&') + '%',p_limit:100}));
          allowed = (messages || []).some(row => { try { return uploadPath(JSON.parse(row.content).media.url,supabaseUrl) === path; } catch (_) { return false; } });
        }
      }
      if (!allowed) return res.status(404).end();
      // Avatar paths are unique per upload, so browsers may reuse them for a day without asking again.
      // 帖子媒体仍然保持默认的「每次重新校验」：这里的响应是鉴权后的私有内容，
      // 给它 immutable 等于让浏览器在退出登录后继续复用字节，和 streamOriginal 的约定冲突。
      // 真正要省的重复下载交给「不点播放就不加载」和后续的直链方案处理。
      const cacheControl = /^avatars\//.test(path) ? 'public, max-age=86400, stale-while-revalidate=604800' : undefined;
      const stream = bucket => mediaStreamer()(req,res,{supabase,bucket,path,fetchImpl,allowDownload:path.startsWith('chat/'),cacheControl,previews});
      try {
        await stream('uploads');
      } catch (error) {
        if (res.headersSent || req.destroyed) { if (!res.destroyed) res.destroy(); return; }
        // 老照片有可能已经在私有的 photo-wall 桶里（迁移脚本搬过），
        // 只在 uploads 明确找不到时兜底试一次，不改变任何鉴权判定。
        let recovered = false;
        try {
          const alt = await supabase.storage.from('photo-wall').exists(path);
          if (alt && alt.data === true) { await stream('photo-wall'); recovered = true; }
        } catch (_) {}
        if (recovered || res.headersSent) return;
        // 前端/排查都要能区分「文件真的没了」和「存储临时不可用」，
        // 之前两种情况一律 503，结果既误导用户也误导排查。
        const reason = String((error && error.message) || 'unknown').slice(0, 80);
        const transient = /unavailable|timeout|aborted/i.test(reason) && !/not.?found|missing/i.test(reason);
        res.set('X-XTJ-Media-Error', reason);
        if (transient) return res.status(503).json({ ok:false, code:'media_unavailable', retryable:true });
        return res.status(404).json({ ok:false, code:'media_missing' });
      }
    } catch (_) { if (!res.headersSent) res.status(503).json({ok:false,code:'media_unavailable',retryable:true}); else res.destroy(); }
  });
}
module.exports = { uploadPath, installUploadAccess };
