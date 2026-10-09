'use strict';
const { streamOriginal } = require('./photo-access');
const { isNormalPost } = require('./post-query');
function uploadPath(value, origin) {
  try {
    const url = new URL(value), expected = new URL(origin);
    if (url.origin !== expected.origin) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/public\/uploads\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (_) { return null; }
}
async function checked(query) { const result = await query; if (!result || result.error) throw result && result.error || Error('upload_access_unavailable'); return result.data; }
function installUploadAccess(app, { supabase, supabaseUrl, optionalAuth, rateLimit, adminName, fetchImpl }) {
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
        const pattern = '%/' + path.replace(/[\\%_]/g,'\\$&');
        const attachments = await checked(supabase.from('post_attachments').select('post_id,media_url').ilike('media_url',pattern).limit(100));
        const direct = await checked(supabase.from('posts').select('id,user_name,media_type,media_url,visibility,is_deleted').ilike('media_url',pattern).limit(100));
        const matchingAttachments = (attachments || []).filter(row => uploadPath(row.media_url,supabaseUrl) === path);
        const rows = (direct || []).filter(row => uploadPath(row.media_url,supabaseUrl) === path).concat(matchingAttachments.length ? await checked(supabase.from('posts').select('id,user_name,media_type,visibility,is_deleted').in('id',matchingAttachments.map(x=>x.post_id))) : []);
        allowed = rows.some(row => isNormalPost(row) && (!row.visibility || row.visibility === 'public' || row.user_name === req.userName || req.userName === adminName));
        if (!allowed && req.userName && path.startsWith('chat/')) {
          const messages = await checked(supabase.rpc('read_visible_dm_posts',{p_actor:req.userName,p_pattern:'%' + path.replace(/[\\%_]/g,'\\$&') + '%',p_limit:100}));
          allowed = (messages || []).some(row => { try { return uploadPath(JSON.parse(row.content).media.url,supabaseUrl) === path; } catch (_) { return false; } });
        }
      }
      if (!allowed) return res.status(404).end();
      await streamOriginal(req,res,{supabase,bucket:'uploads',path,fetchImpl,allowDownload:path.startsWith('chat/')});
    } catch (_) { if (!res.headersSent) res.status(503).json({ok:false,code:'media_unavailable',retryable:true}); else res.destroy(); }
  });
}
module.exports = { uploadPath, installUploadAccess };
