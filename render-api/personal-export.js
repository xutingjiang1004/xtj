'use strict';
const {PUBLIC_POST_MEDIA_TYPES}=require('./post-markers');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CATEGORIES=['profile','posts','photos','likes','comments','photo_views','ai_history','activity','messages','chat_contacts','chat_preferences','locations'];
const PROFILE=['__user_info__','__avatar__','__user_style__','__ai_agent_profile__','__ann_read__','__vip__','__vip_order__','__dm_deleted__','__custom_ai_models__'];
const ACTIVITY=['__post_view__','__user_visit__','__login_event__','__user_behavior__','__client_error__'];
const FIELDS='id,user_name,content,media_type,media_url,created_at,updated_at,visibility,views,is_deleted,deleted_at,location_name,location_province,location_city,ip_province,ip_city,ip_region_text';
const FORBIDDEN=/password|verifier|refresh.?token|access.?token|api.?key|encrypted.?key|secret|authorization|credential/i;
function clean(value,depth=0){
 if(depth>30)return null;
 if(Array.isArray(value))return value.map(v=>clean(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!FORBIDDEN.test(key)).map(([key,v])=>[key,clean(v,depth+1)]));
 return value;
}
function safeRecord(row){
 const result=clean(row);delete result.actor_key;
 if(typeof result.content==='string'){try{result.content=clean(JSON.parse(result.content));}catch(_){}}
 return result;
}
async function checked(query){const r=await query;if(!r||r.error)throw new Error('export_query_failed');return r.data||[];}
function createPersonalExport({express,supabase,authenticateUser,rateLimit,privateStorage}) {
 const router=express.Router();router.use(authenticateUser);if(rateLimit)router.use(rateLimit(60000,120));
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 router.get('/',async(req,res)=>{
  const kind=String(req.query.kind||''),after=req.query.after?String(req.query.after):null;
  const snapshot=req.query.snapshot?new Date(req.query.snapshot):new Date();
  if(!CATEGORIES.includes(kind)||!Number.isFinite(snapshot.getTime())||snapshot.getTime()>Date.now()+60000||after&&after.length>160)return res.status(400).json({ok:false,error:'导出参数无效'});
  if(after&&!kind.startsWith('chat_')&&kind!=='messages'&&(['likes','comments'].includes(kind)?!/^\d{1,20}$/.test(after):!UUID.test(after)))return res.status(400).json({ok:false,error:'导出游标无效'});
  const actor=req.userName,at=snapshot.toISOString();
  try{
   let rows;
   if(['messages','chat_contacts','chat_preferences'].includes(kind)) {
    rows=await checked(supabase.rpc('export_personal_chat',{p_actor:actor,p_kind:kind,p_after:after,p_snapshot:at}));
   } else {
    let q;
    if(kind==='locations')q=supabase.from('user_location_history').select('id,latitude,longitude,accuracy_m,captured_at,received_at,source,capture_reason,resolution_status,resolved_address,resolve_error,resolved_at').eq('user_name',actor);
    else if(kind==='likes'||kind==='comments')q=supabase.from(kind).select(kind==='likes'?'id,post_id,user_name,created_at':'id,post_id,user_name,content,created_at,parent_comment_id').eq('user_name',actor);
    else if(kind==='photo_views')q=supabase.from('photo_viewers').select('photo_id,first_viewed_at').eq('viewer_name',actor);
    else {
     q=supabase.from('posts').select(FIELDS).eq('user_name',actor);
     if(kind==='posts')q=q.or('media_type.is.null,media_type.eq."",media_type.in.('+PUBLIC_POST_MEDIA_TYPES.join(',')+')');
     if(kind==='photos')q=q.eq('media_type','__photo_wall__');
     if(kind==='profile')q=q.in('media_type',PROFILE);
     if(kind==='activity')q=q.in('media_type',ACTIVITY);
     if(kind==='ai_history')q=q.in('media_type',['__ai_agent_msg__','**ai_agent_conv_summary**']);
    }
    const key=kind==='photo_views'?'photo_id':'id',time=kind==='locations'?'received_at':kind==='photo_views'?'first_viewed_at':'created_at';
    q=q.lte(time,at);if(after)q=q.gt(key,after);rows=await checked(q.order(key,{ascending:true}).limit(201));
    if(kind==='photo_views')rows=rows.map(r=>({...r,id:r.photo_id}));
   }
   const hasMore=rows.length>200,items=rows.slice(0,200).map(safeRecord);
   if(kind==='messages'&&privateStorage){for(let i=0;i<items.length;i+=8)await Promise.all(items.slice(i,i+8).map(async row=>{if(row.withdrawn_at)return;await privateStorage.hydrateMessage(row);}));}
   // Profile identity timestamps come from the authentication record, never browser input.
   let account=null;
   if(kind==='profile'){
    const auth=await checked(supabase.from('posts').select('created_at').eq('user_name',actor).eq('media_type','__auth__').order('created_at',{ascending:true}).limit(1));
    const consent=await checked(supabase.from('user_behavior_consents').select('enabled,updated_at').eq('user_name',actor));
    account={user_name:actor,registered_at:auth[0]&&auth[0].created_at||null,behavior_consent:consent[0]||{enabled:false}};
   }
   res.json({ok:true,kind,snapshot:at,account,items,has_more:hasMore,next_cursor:hasMore?String(items.at(-1).id):null});
  }catch(_){res.status(503).json({ok:false,error:'个人数据暂时无法完整读取，请重试',code:'export_unavailable'});}
 });
 return router;
}
module.exports={createPersonalExport,safeRecord,CATEGORIES};
