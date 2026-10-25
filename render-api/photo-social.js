'use strict';
const { createComment, parseRelationCursor, ROW_ID } = require('./post-interactions');
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
  app.get('/api/photo/:id/social', authenticateUser, rateLimit(60000,120), async (req,res) => {
    try {
      if (!(await photo(req.params.id))) return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      const id = req.params.id;
      const before = req.query.before;
      const known = String(req.query.known || '').split(',').filter(Boolean);
      if (known.length > 500 || known.some(value=>!ROW_ID.test(value))) return res.status(400).json({ok:false,error:'评论同步参数无效'});
      if (before && !ROW_ID.test(String(before)) && !String(before).startsWith('{')) return res.status(400).json({ok:false,error:'评论分页参数无效'});
      let query = supabase.from('comments').select('id::text,user_name,content,created_at').eq('post_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31);
      // UUID cursor resolves its timestamp within this photo, never another post.
      if (before) {
        let cursor;
        if (String(before).startsWith('{')) {
          try { cursor=parseRelationCursor(before); } catch (_) { return res.status(400).json({ok:false,error:'评论分页参数无效'}); }
        } else {
          const saved = await supabase.from('comments').select('id::text,created_at').eq('post_id',id).eq('id',before).maybeSingle();
          if (saved.error) throw saved.error;
          if (!saved.data) return res.status(400).json({ok:false,error:'评论分页位置已失效，请刷新'});
          cursor={id:String(saved.data.id),at:saved.data.created_at};
        }
        query = query.or('created_at.lt.' + cursor.at + ',and(created_at.eq.' + cursor.at + ',id.lt.' + cursor.id + ')');
      }
      const [likes,comments,count,mine,viewers,retained] = await Promise.all([
        supabase.from('likes').select('id::text',{count:'exact',head:true}).eq('post_id',id), query,
        supabase.from('comments').select('id::text',{count:'exact',head:true}).eq('post_id',id),
        req.userName ? supabase.from('likes').select('id::text').eq('post_id',id).eq('user_name',req.userName).limit(1) : Promise.resolve({data:[]}),
        supabase.from('photo_viewers').select('photo_id',{count:'exact',head:true}).eq('photo_id',id),
        known.length ? supabase.from('comments').select('id::text,user_name,content,created_at').eq('post_id',id).in('id',known).limit(500) : Promise.resolve({data:[]})
      ]);
      for (const result of [likes,comments,count,mine,viewers,retained]) if (result.error) throw result.error;
      const rows = comments.data || [], more = rows.length > 30, page = rows.slice(0,30);
      return res.json({ok:true,views:Number(viewers.count)||0,like_count:Number(likes.count)||0,comment_count:Number(count.count)||0,liked:!!(mine.data || []).length,comments:page,retained_comments:retained.data||[],known_ids:known,has_more:more,next_cursor:more ? JSON.stringify({at:page[page.length-1].created_at,id:String(page[page.length-1].id)}) : null});
    } catch (_) { return unavailable(res); }
  });
  app.post('/api/photo/:id/like', authenticateUser, rateLimit(60000,60), async (req,res) => {
    try {
      const ban = userBanError(req); if (ban) return res.status(ban.status || 403).json({ok:false,error:ban.message});
      if (typeof (req.body || {}).liked !== 'boolean') return res.status(400).json({ok:false,error:'点赞参数无效'});
      if (!(await photo(req.params.id))) return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      const id=req.params.id, liked=req.body.liked;
      const result=await supabase.rpc('xtj_set_post_like',{p_post_id:id,p_owner:req.userName,p_liked:liked,p_kind:'photo'});
      if(result.error||!result.data)throw result.error||new Error('unavailable');
      if(!result.data.ok)return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      return res.json(result.data);
    } catch (_) { return unavailable(res); }
  });
  app.post('/api/photo/:id/comments', authenticateUser, rateLimit(60000,30), async(req,res)=>{
    try {
      const ban=userBanError(req);if(ban)return res.status(ban.status||403).json({ok:false,error:ban.message});
      const content=(req.body || {}).content;
      if(typeof content!=='string'||!content.trim()||content.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content))return res.status(400).json({ok:false,error:'请输入 1–1000 字评论'});
      if(!(await photo(req.params.id)))return res.status(404).json({ok:false,error:'照片不存在或不可查看'});
      const result=await createComment(supabase,req.params.id,req.userName,content.trim(),(req.body||{}).client_request_id,'photo');
      return res.status(result.created?201:200).json({ok:true,comment:result.data,comment_count:result.comment_count,replayed:!result.created});
    }catch(error){if(error.status)return res.status(error.status).json({ok:false,error:error.message,code:error.code});return unavailable(res);}
  });
}
module.exports={installPhotoSocial,isPublicPhoto};
