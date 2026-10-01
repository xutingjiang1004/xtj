'use strict';
async function account(supabase,actor){return require('./auth-record').readAuthRecord(supabase,actor,'__auth__','id');}
async function behaviorAllowed(supabase,actor){
 const auth=await account(supabase,actor);if(!auth)return false;
 const r=await supabase.from('user_behavior_consents').select('enabled').eq('user_name',actor).eq('account_id',auth.id).maybeSingle();
 if(!r||r.error)throw new Error('consent_unavailable');return !!(r.data&&r.data.enabled);
}
function createBehaviorConsent({express,supabase,authenticateUser,rateLimit}){
 const router=express.Router();router.use(authenticateUser);if(rateLimit)router.use(rateLimit(60000,30));
 router.get('/',async(req,res)=>{res.set('Cache-Control','no-store');try{res.json({ok:true,enabled:await behaviorAllowed(supabase,req.userName)});}catch(_){res.status(503).json({ok:false,error:'诊断设置暂不可用'});}});
 router.post('/',async(req,res)=>{
  if(typeof req.body.enabled!=='boolean')return res.status(400).json({ok:false,error:'设置无效'});
  let auth;try{auth=await account(supabase,req.userName);}catch(_){return res.status(503).json({ok:false,error:'设置未保存，请重试'});}
  if(!auth)return res.status(401).json({ok:false,error:'账号不可用'});
  const result=await supabase.from('user_behavior_consents').upsert({account_id:auth.id,user_name:req.userName,enabled:req.body.enabled,updated_at:new Date().toISOString()},{onConflict:'user_name'});
  if(result.error)return res.status(503).json({ok:false,error:'设置未保存，请重试'});
  res.json({ok:true,enabled:req.body.enabled});
 });return router;
}
module.exports={behaviorAllowed,createBehaviorConsent};
