'use strict';
const {randomUUID}=require('node:crypto');
const SAFE=new Set(['search_web','tavily_search','search_social','read_web_page','web_extract','get_weather','get_current_time','calculate','convert_units','get_exchange_rate','get_stock_quote','text_stats','diff_text','sort_filter','date_calc','make_chart','make_file','generate_pdf','process_json','extract_links','page_meta','qr_code']);
const entries=new Map(),TTL=10*60*1000;
function clean(){const now=Date.now();for(const [id,entry]of entries)if(entry.expires<=now&&!entry.busy)entries.delete(id);}
const expiryTimer=setInterval(clean,60000);if(expiryTimer.unref)expiryTimer.unref();
function observe(res,payload){
 if(!res||!res._aiRetryOwner||!res._aiRetryOwner.accountId||!payload)return;
 if(payload.type==='tool_calls'){
  if(!res._aiRetryCalls)res._aiRetryCalls=new Map();
  for(const call of payload.tools||[]){if(!call||typeof call!=='object')continue;const name=call.name||call.tool_name||call.function&&call.function.name;if(!SAFE.has(name))continue;const raw=call.args||call.arguments||call.function&&call.function.arguments;let args;try{args=typeof raw==='string'?JSON.parse(raw):raw;}catch(_){continue;}if(!args||typeof args!=='object'||Array.isArray(args))continue;
   const encoded=JSON.stringify(args);if(Buffer.byteLength(encoded)>64*1024||/"(?:api_key|authorization|access_token)"\s*:/i.test(encoded))continue;
   const id=String(call.id||call.call_id||'');if(id&&res._aiRetryCalls.size<100)res._aiRetryCalls.set(id,{name,args:JSON.parse(encoded)});
  }
 }
 if((payload.type==='tool_result'&&payload.success===false||payload.type==='tool_error')&&payload.call_id){
  const call=res._aiRetryCalls&&res._aiRetryCalls.get(String(payload.call_id));if(!call)return;
  clean();const owner=res._aiRetryOwner;const owned=[...entries].filter(([,entry])=>entry.owner.accountId===owner.accountId);
  if(owned.length>=25)entries.delete(owned[0][0]);if(entries.size>=250)entries.delete(entries.keys().next().value);
  const token=randomUUID();entries.set(token,{owner:{...owner},call,expires:Date.now()+TTL,attempts:0,busy:false});payload.retry_token=token;
 }
}
function installToolRetry(app,deps){
 app.post('/api/agent/tools/retry',deps.authenticateUser,deps.rateLimit(60000,20),async(req,res)=>{
  const token=String(req.body&&req.body.retry_token||'');clean();const entry=entries.get(token);
  if(!entry||entry.owner.accountId!==String(req.accountId)||entry.owner.userName!==req.userName)return res.status(404).json({ok:false,error:'这一步的重试已过期或不属于当前账号，请重新运行工具'});
  if(entry.busy)return res.status(409).json({ok:false,error:'这一步正在重试，请稍候'});
  if(entry.attempts>=3)return res.status(429).json({ok:false,error:'这一步已重试三次，请检查参数后重新运行工具'});
  const abort=new AbortController(),cancel=()=>abort.abort();req.once('aborted',cancel);res.once('close',cancel);const timer=setTimeout(()=>{cancel();if(!res.headersSent&&!res.destroyed)res.status(504).json({ok:false,error:'这一步执行超时，可以稍后重试'});},45000);entry.busy=true;entry.attempts++;
  try{
   const gate=await deps.gate(req.userName,{needSearch:/search/.test(entry.call.name)});if(!gate.allowed)return res.status(429).json({ok:false,error:'当前模型或搜索额度不足，请稍后重试'});
   if(abort.signal.aborted)return;
   const context={userName:req.userName,accountId:req.accountId,signal:abort.signal,searchConsumed:0};
   const result=await deps.execute({id:'retry',function:{name:entry.call.name,arguments:JSON.stringify(entry.call.args)}},context);
   if(context.searchConsumed>0&&deps.record)await deps.record(req.userName,null,{source:'tool_step_retry',model:'tool',search_count:context.searchConsumed,did_search:true});
   if(abort.signal.aborted||res.writableEnded)return;
   const feedback=deps.feedback(result,'retry',deps.normalize,entry.call.name);
   if(!result.error)entries.delete(token);res.json({ok:true,result,feedback});
  }catch(error){if(!abort.signal.aborted&&!res.headersSent)res.status(503).json({ok:false,error:'这一步暂时无法完成，原有结果已保留'});}
  finally{entry.busy=false;clearTimeout(timer);req.removeListener('aborted',cancel);res.removeListener('close',cancel);}
 });
}
module.exports={observe,installToolRetry,SAFE};
