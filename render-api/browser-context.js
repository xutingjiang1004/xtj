'use strict';
function browserContext(body){
 body=body&&typeof body==='object'?body:{};
 const language=typeof body.language==='string'&&/^[a-z0-9-]{2,35}$/i.test(body.language)?body.language:null;
 let timezone=null;if(typeof body.timezone==='string'&&body.timezone.length<80)try{timezone=new Intl.DateTimeFormat('en',{timeZone:body.timezone}).resolvedOptions().timeZone;}catch(_){}
 const raw=body.network&&typeof body.network==='object'?body.network:null;
 function number(value,max){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;}
 return {language,languages:Array.isArray(body.languages)?body.languages.filter(v=>typeof v==='string'&&/^[a-z0-9-]{2,35}$/i.test(v)).slice(0,5):[],timezone,online:typeof body.online==='boolean'?body.online:null,
  network:raw&&raw.supported===true?{supported:true,effective_type:['slow-2g','2g','3g','4g'].includes(raw.effective_type)?raw.effective_type:null,downlink_mbps:number(raw.downlink_mbps,100000),rtt_ms:number(raw.rtt_ms,120000),save_data:raw.save_data===true}:{supported:false},
  source:'browser_report',received_at:new Date().toISOString()};
}
function createBrowserContext({express,authenticateUser,rateLimit,supabase}){
 const router=express.Router();router.post('/api/user/browser-context',authenticateUser,rateLimit(60000,5),async(req,res)=>{
  try{const context=browserContext(req.body);const saved=await supabase.rpc('record_browser_context',{p_actor:req.userName,p_context:context});if(!saved||saved.error||saved.data!==true)throw new Error('context_store_failed');res.set('Cache-Control','no-store').json({ok:true});}
  catch(_){res.status(503).json({error:'设备上下文暂时无法保存',retryable:true});}
 });return router;
}
module.exports={browserContext,createBrowserContext};
