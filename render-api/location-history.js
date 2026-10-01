'use strict';
const {readAuthRecord}=require('./auth-record');
const crypto=require('node:crypto');
const TABLE='user_location_history';
async function recordLocationFix({supabase,actor,body,reason,ip}){
 const account=await readAuthRecord(supabase,actor,'__auth__');if(!account)throw new Error('location_account_unavailable');
 const latitude=Number(body.latitude),longitude=Number(body.longitude);
 if(body.latitude==null||body.longitude==null||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('invalid_location');
 const accuracy=body.accuracy==null?null:Number(body.accuracy);if(accuracy!==null&&(!Number.isFinite(accuracy)||accuracy<0||accuracy>100000))throw new Error('invalid_location');
 const captured=new Date(body.captured_at||'');const capturedAt=Number.isFinite(captured.getTime())&&Math.abs(Date.now()-captured.getTime())<=86400000?captured.toISOString():new Date().toISOString();
 const captureId=String(body.capture_id||((body.page_load_id||'fix_'+crypto.randomUUID())+'_'+capturedAt)).slice(0,160);
 const row={account_id:account.id,user_name:actor,capture_id:captureId,latitude,longitude,accuracy_m:accuracy,captured_at:capturedAt,capture_reason:String(reason||'user_location').slice(0,40),ip:String(ip||'unknown').slice(0,80)};
 const result=await supabase.from(TABLE).upsert(row,{onConflict:'account_id,capture_id',ignoreDuplicates:true});if(!result||result.error)throw new Error('location_history_save_failed');
 return {accountId:account.id,captureId};
}
async function resolveLocationFix(supabase,fix,address,error){
 const result=await supabase.from(TABLE).update({resolution_status:address?'resolved':'failed',resolved_address:address?String(address).slice(0,1000):null,resolve_error:error?String(error).slice(0,160):null,resolved_at:new Date().toISOString()}).eq('account_id',fix.accountId).eq('capture_id',fix.captureId);
 if(!result||result.error)throw new Error('location_resolution_save_failed');
}
function cursorFor(row){return Buffer.from(JSON.stringify({at:row.received_at,id:row.id})).toString('base64url');}
function createLocationHistory({express,supabase,verifyToken,authenticateUser,rateLimit,audit}){
 const router=express.Router();
 function handler(own){return async(req,res)=>{
  res.set('Cache-Control','no-store');const actor=own?req.userName:String(req.query.user_name||'').trim();if(!actor||actor.length>100)return res.status(400).json({error:'用户参数无效'});
  let cursor=null;if(req.query.cursor){try{if(String(req.query.cursor).length>256)throw new Error();cursor=JSON.parse(Buffer.from(String(req.query.cursor),'base64url').toString());if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor.id)||!Number.isFinite(new Date(cursor.at).getTime()))throw new Error();cursor.at=new Date(cursor.at).toISOString();}catch(_){return res.status(400).json({error:'分页参数无效'});}}
  try{let q=supabase.from(TABLE).select('id,latitude,longitude,accuracy_m,captured_at,received_at,source,capture_reason,resolution_status,resolved_address,resolve_error,resolved_at').eq('user_name',actor);
   if(cursor)q=q.or('received_at.lt.'+cursor.at+',and(received_at.eq.'+cursor.at+',id.lt.'+cursor.id+')');
   const result=await q.order('received_at',{ascending:false}).order('id',{ascending:false}).limit(51);if(!result||result.error)throw new Error();
   const items=(result.data||[]).slice(0,50);if(!own&&audit)await audit('view_user_gps_history',req.adminName||'admin','target_user='+actor);res.json({ok:true,items,has_more:(result.data||[]).length>50,next_cursor:(result.data||[]).length>50?cursorFor(items.at(-1)):null});
  }catch(_){res.status(503).json({error:'定位历史暂时无法读取，请重试'});}
 };}
 const limit=rateLimit?rateLimit(60000,60):(req,res,next)=>next();router.get('/admin/user-location-history',verifyToken,limit,handler(false));router.get('/api/user/location-history',authenticateUser,limit,handler(true));return router;
}
module.exports={recordLocationFix,resolveLocationFix,createLocationHistory,cursorFor};
