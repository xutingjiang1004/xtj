'use strict';
// Authoritative actions only. Never copy request bodies, query strings or user-provided targets.
const ROUTES=new Map([
 ['POST /api/dm/send','message_send'],['POST /api/chat/flash/send','flash_send'],['POST /api/chat/flash/open','flash_open'],
 ['POST /api/posts','post_create'],['POST /api/post/create','post_create'],['POST /api/photo/create','photo_upload'],
 ['POST /api/photo/view','photo_view'],['POST /api/avatar','avatar_upload'],['POST /api/post/delete','post_delete'],['POST /api/photo/delete','photo_delete'],['POST /api/post/update','post_update'],['POST /api/post/like','post_like'],['POST /api/post/comment','post_comment'],['POST /api/dm/withdraw','message_withdraw'],['POST /api/report','report'],
 ['POST /api/user/logout','logout'],['GET /api/user/export','data_export'],['POST /api/agent/chat','ai_chat'],
 ['POST /api/location/reverse','location_authorized'],['POST /api/user/location','location_authorized'],['POST /api/agent/chat/stream','ai_chat']
]);
function classify(req){let type=ROUTES.get(req.method+' '+req.path);if(!type&&/^(POST|DELETE)$/.test(req.method)&&/^\/api\/(?:post|posts|photo)\/[a-f0-9-]{36}\/(?:delete|like|comments)$/.test(req.path))type=req.path.endsWith('/delete')?'content_delete':req.path.endsWith('/like')?'content_like':'content_comment';if(!type&&req.method==='DELETE'&&/^\/api\/(?:post\/comment|photo\/comments)\/[a-f0-9-]{36}$/.test(req.path))type='comment_delete';return type;}
function createSecurityActivity({supabase,getClientIp}){
 const recent=new Map();
 return(req,res,next)=>{const type=classify(req);if(type)res.once('finish',()=>{
  if(!req.userName||res.statusCode>=500)return;
  const key=req.userName+':'+type+':'+res.statusCode,now=Date.now();
  // Views/export pages are coalesced; writes and rejected authenticated actions remain distinct.
  if(['photo_view','data_export','ai_chat'].includes(type)&&now-(recent.get(key)||0)<10000)return;
  recent.set(key,now);if(recent.size>2000)recent.delete(recent.keys().next().value);
  const event={type:res.statusCode<400?type:'action_denied',target:type,at:new Date(now).toISOString(),authority:'server_action',method:req.method,status:res.statusCode,ip:getClientIp(req),ip_source:req._clientIpSource||'unknown'};
  void Promise.resolve(supabase.from('posts').insert({user_name:req.userName,media_type:'__user_behavior__',media_url:'security_action',actor_key:'security_'+require('crypto').randomUUID(),content:JSON.stringify({source:'server_security',events:[event]})})).then(result=>{if(!result||result.error)console.warn('[security-activity] save failed');}).catch(()=>console.warn('[security-activity] save failed'));
 });next();};
}
module.exports={createSecurityActivity,classify};
