'use strict';
const crypto = require('crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isPublicPhoto(row) {
  if (!row || row.media_type !== '__photo_wall__' || row.is_deleted === true || row.media_url === '__deleted__' || (row.visibility && row.visibility !== 'public')) return false;
  try { return JSON.parse(row.content || '{}').__pw_del__ !== true; } catch (_) { return false; }
}
function installPhotoSocial(app, options) {
  const { supabase, authenticateUser, optionalAuth, rateLimit, userBanError } = options;
  async function photo(id) {
    if (!UUID.test(String(id || ''))) return null;
    const result = await supabase.from('posts').select('id,media_type,media_url,visibility,is_deleted,content').eq('id', id).maybeSingle();
    if (result.error) throw result.error;
    return isPublicPhoto(result.data) ? result.data : null;
  }
  function unavailable(res) { return res.status(503).json({ok:false,error:'照片互动暂不可用，请稍后重试',retryable:true}); }
  app.get('/api/photo/:id/social', optionalAuth, rateLimit(60000,120), async (req,res) => {
    try {
      if (!(await photo(req.params.id))) return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      const id = req.params.id;
      const before = req.query.before;
      if (before && !UUID.test(String(before))) return res.status(400).json({ok:false,error:'评论分页参数无效'});
      let query = supabase.from('comments').select('id,user_name,content,created_at').eq('post_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31);
      // UUID cursor resolves its timestamp within this photo, never another post.
      if (before) {
        const cursor = await supabase.from('comments').select('id,created_at').eq('post_id',id).eq('id',before).maybeSingle();
        if (cursor.error) throw cursor.error;
        if (!cursor.data) return res.status(400).json({ok:false,error:'评论分页位置已失效，请刷新'});
        query = query.or('created_at.lt.' + cursor.data.created_at + ',and(created_at.eq.' + cursor.data.created_at + ',id.lt.' + before + ')');
      }
      const [likes,comments,count,mine,viewers] = await Promise.all([
        supabase.from('likes').select('id',{count:'exact',head:true}).eq('post_id',id), query,
        supabase.from('comments').select('id',{count:'exact',head:true}).eq('post_id',id),
        req.userName ? supabase.from('likes').select('id').eq('post_id',id).eq('user_name',req.userName).limit(1) : Promise.resolve({data:[]}),
        supabase.from('photo_viewers').select('photo_id',{count:'exact',head:true}).eq('photo_id',id)
      ]);
      for (const result of [likes,comments,count,mine,viewers]) if (result.error) throw result.error;
      const rows = comments.data || [], more = rows.length > 30, page = rows.slice(0,30);
      return res.json({ok:true,views:Number(viewers.count)||0,like_count:Number(likes.count)||0,comment_count:Number(count.count)||0,liked:!!(mine.data || []).length,comments:page,has_more:more,next_cursor:more ? page[page.length-1].id : null});
    } catch (_) { return unavailable(res); }
  });
  app.post('/api/photo/:id/like', authenticateUser, rateLimit(60000,60), async (req,res) => {
    try {
      const ban = userBanError(req); if (ban) return res.status(ban.status || 403).json({ok:false,error:ban.message});
      if (typeof (req.body || {}).liked !== 'boolean') return res.status(400).json({ok:false,error:'点赞参数无效'});
      if (!(await photo(req.params.id))) return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      const id=req.params.id, liked=req.body.liked;
      if (liked) {
        const result=await supabase.from('likes').upsert({post_id:id,user_name:req.userName,actor_key:'like_'+id+'_'+req.userName},{onConflict:'post_id,user_name',ignoreDuplicates:true});
        if (result.error) throw result.error;
      } else {
        const result=await supabase.from('likes').delete().eq('post_id',id).eq('user_name',req.userName); if (result.error) throw result.error;
      }
      const count=await supabase.from('likes').select('id',{count:'exact',head:true}).eq('post_id',id); if(count.error)throw count.error;
      return res.json({ok:true,liked,like_count:Number(count.count)||0});
    } catch (_) { return unavailable(res); }
  });
  app.post('/api/photo/:id/comments', authenticateUser, rateLimit(60000,30), async(req,res)=>{
    try {
      const ban=userBanError(req);if(ban)return res.status(ban.status||403).json({ok:false,error:ban.message});
      const content=(req.body || {}).content;
      if(typeof content!=='string'||!content.trim()||content.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content))return res.status(400).json({ok:false,error:'请输入 1–1000 字评论'});
      if(!(await photo(req.params.id)))return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      const result=await supabase.from('comments').insert({post_id:req.params.id,user_name:req.userName,content:content.trim(),actor_key:'comment_'+crypto.randomUUID()}).select('id,user_name,content,created_at').single();
      if(result.error)throw result.error;
      return res.status(201).json({ok:true,comment:result.data});
    }catch(_){return unavailable(res);}
  });
}
module.exports={installPhotoSocial,isPublicPhoto};
