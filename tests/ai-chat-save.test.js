'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {saveCustomChatTurn,saveInterruptedChatTurn}=require('../render-api/ai-chat-save');
const {toolFeedback,runRequiredSearch}=require('../render-api/ai-tool-feedback');
const {appendProcessEvent,getProcessEvents}=require('../render-api/ai-process-events');
const source=fs.readFileSync('render-api/server.js','utf8');
const startMeta=source.indexOf('function buildMsgMeta(');
const buildMeta=new Function(source.slice(startMeta,source.indexOf("app.get('/api/agent/profile'",startMeta))+'return buildMsgMeta;')();
const normalize=new Function(source.slice(source.indexOf('function normalizeToolResultItems('),source.indexOf("const { getMailTransporter"))+'return normalizeToolResultItems;')();
const args={userName:'A',convId:'ABCDEF-1234',message:'查天气',content:'福州晴',reasoning:'先查证',model:'third-party',thinkingMode:'high',webSearch:false,processEvents:[{type:'reasoning',text:'先查证'}],cards:[{id:'weather',type:'weather'}],buildMeta,marker:'ai-message'};
for(const status of ['ok','error','throw'])test('third-party chat reports actual cloud persistence: '+status,async()=>{
 let inserted;const db={from(table){assert.equal(table,'posts');return {async insert(rows){inserted=rows;if(status==='throw')throw Error('offline');return status==='error'?{error:{message:'offline'}}:{error:null};}};}};
 assert.equal(await saveCustomChatTurn({...args,db}),status==='ok');assert.equal(inserted.length,2);assert.ok(inserted.every(row=>row.user_name==='A'));
 const saved=JSON.parse(inserted[1].media_url);assert.equal(saved.convId,args.convId);assert.equal(saved.usage.model,'third-party');assert.equal(saved.usage.thinking_mode,'high');assert.equal(saved.site_cards[0].id,'weather');assert.equal(saved.process_events[0].text,'先查证');assert.doesNotMatch(JSON.stringify(inserted),/api_key|Authorization/);
});
async function routeFixture({failSave=false,disconnect=false}={}){
 const frames=[],stored=[],payloads=[];let handler,calls=0,signal;
 const c={app:{post(...args){handler=args.at(-1);}},authenticateUser(){},aiChatConcurrencyGate(){},rateLimit:()=>null,express:{json:()=>null},AI_CHAT_HOURLY_IP_LIMIT:100,AI_CHAT_MESSAGE_MAX_LEN:12000,ADMIN_USERNAME:'admin',validateString:value=>value,genConvId:()=>'ABCDEF-NEW',AI_AGENT_MESSAGE_MARKER:'ai-message',URL,AbortController,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console,
  aiTaskPolicy:require('../render-api/ai-task-policy'),enforceAiChatAccess:async()=>({allowed:true}),getAiQuotaErrorMessage:()=>'',assertSafeWebUrl:async url=>({parsed:new URL(url),addresses:['93.184.216.34']}),extractVisionImageUrls:()=>[],getAiConfig:async()=>({name:'configured'}),buildAiCorePrompt:config=>'Configured '+config.name,aiToolsForWorkMode:()=>[{type:'function',function:{name:'get_weather'}}],toolFeedback,runRequiredSearch,normalizeToolResultItems:normalize,saveCustomChatTurn,saveInterruptedChatTurn,buildMsgMeta:buildMeta,getProcessEvents,
  executeToolCall:async()=>({tool_name:'get_weather',location:'福州',content:'福州晴',cards:[{protocol:'xtj.ai.ui.v1',id:'weather',type:'weather',data:{city:'福州',condition:'晴',temperature_c:26.7}}]}),parseDsmlToolCallsGlobal:()=>({calls:[]}),finalReplyContainsInternalProtocolGlobal:()=>false,looksLikeToolArgsFragment:()=>false,recordAiTurnUsage:async()=>{},
  supabase:{from(){return {async insert(rows){stored.push(...rows);return failSave?{error:{}}:{error:null};}};}},writeSse(res,event){if(res.writableEnded)return false;frames.push(event);appendProcessEvent(res,event);return true;},
  requestPinnedStream:async(url,addresses,options)=>{payloads.push(JSON.parse(options.body));signal=options.signal;if(disconnect){res.emit('close');throw Object.assign(Error('closed'),{name:'AbortError'});}const delta=calls++===0?{reasoning_content:'先查证',tool_calls:[{index:0,id:'weather',function:{name:'get_weather',arguments:'{"location":"福州"}'}}]}:{content:'福州晴。'};return new Response('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n');}};
 const req=new EventEmitter();req.userName='A';req.body={provider:'openai',api_key:'private-key',model:'chosen-model',message:'福州天气',conversation_id:'ABCDEF-SHARED',work_mode:false,tools_enabled:false,thinking_mode:'high'};
 const res=new EventEmitter();res.writableEnded=false;res.setHeader=()=>{};res.flushHeaders=()=>{};res.end=()=>{res.writableEnded=true;};
 const a=source.indexOf("app.post('/api/agent/custom-chat/stream'");const b=source.indexOf("app.post('/api/agent/custom-chat/deep-stream'",a);const code=source.slice(a,b);vm.runInNewContext(code.slice(0,code.lastIndexOf('\n});')+4),c);
 await handler(req,res);return {frames,stored,payloads,signal,req,res};
}
for(const failSave of [false,true])test('actual third-party route shares conversation, full tools, ordered feedback and honest save state ('+failSave+')',async()=>{
 const result=await routeFixture({failSave});assert.equal(result.payloads.length,2);assert.ok(result.payloads.every(payload=>payload.model==='chosen-model'&&payload.tools[0].function.name==='get_weather'));
 assert.equal(result.payloads[0].messages[0].content.startsWith('Configured configured'),true);
 assert.equal(result.frames[0].conversation_id,'ABCDEF-SHARED');const done=result.frames.find(frame=>frame.type==='done');assert.equal(done.saved,!failSave);assert.equal(done.content,'福州晴。');assert.equal(done.thinking_mode,'high');
 const feedback=result.frames.find(frame=>frame.type==='tool_result');assert.equal(feedback.call_id,'weather');assert.match(feedback.summary,/晴.*26.7/);
 const saved=JSON.parse(result.stored[1].media_url);assert.deepEqual(saved.process_events.map(event=>event.type),['reasoning','tools']);assert.equal(saved.site_cards[0].tool_call_id,'weather');assert.doesNotMatch(JSON.stringify(result.stored),/private-key/);
});
test('closing a third-party stream aborts the upstream and clears cancellation listeners',async()=>{
 const result=await routeFixture({disconnect:true});assert.equal(result.signal.aborted,true);assert.equal(result.frames.some(frame=>frame.type==='done'),false);assert.equal(result.stored.length,1);assert.equal(result.stored[0].content,'福州天气');assert.equal(JSON.parse(result.stored[0].media_url).interrupted,true);assert.equal(result.req.listenerCount('aborted'),1);assert.equal(result.res.listenerCount('close'),1);
});

test('thinking duration stops at the first answer and survives third-party cloud metadata, including zero',async(t)=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const res={};appendProcessEvent(res,{type:'reasoning_start'});now=10000;appendProcessEvent(res,{type:'content',text:'答案'});now=90000;appendProcessEvent(res,{type:'done'});assert.equal(res._aiThinkingElapsedMs,9000);
 for(const duration of [9000,0]){let rows;const db={from(){return{async insert(value){rows=value;return{error:null}}}}};assert.equal(await saveCustomChatTurn({...args,db,thinkingElapsedMs:duration}),true);assert.equal(JSON.parse(rows[1].media_url).thinking_elapsed_ms,duration)}
});

test('interrupted saves preserve unanswered questions, partial output, reasoning and tool context with stable timestamps',async()=>{
 for(const output of [{content:'',reasoning:'',processEvents:[]},{content:'尚未完成的答案',reasoning:'还在思考',processEvents:[{type:'reasoning',text:'还在思考'}]}]){
  const stored=[];const db={from(){return{async insert(rows){stored.push(...rows);return{error:null}}}}};
  assert.equal(await saveInterruptedChatTurn({...args,db,...output,startedAt:1000,requestId:'request-1'}),true);
  assert.equal(stored[0].content,args.message);assert.equal(stored[0].created_at,'1970-01-01T00:00:01.000Z');assert.equal(JSON.parse(stored[0].media_url).interrupted,true);
  assert.equal(stored.length,output.content?2:1);
  if(output.content){assert.equal(stored[1].content,output.content);assert.equal(JSON.parse(stored[1].media_url).reasoning,output.reasoning);assert.equal(stored[1].created_at,'1970-01-01T00:00:01.001Z');}
 }
});

for(const requestId of ['new-send',''])test('built-in chat preserves a disconnected accepted question in cloud history ('+requestId+')',async()=>{
 const stored=[],req=new EventEmitter(),res=new EventEmitter();let handler;
 req.userName='A';req.body={message:'还没回答完的问题',conversation_id:'ABCDEF-SHARED',client_request_id:requestId,thinking_mode:'high'};
 res.writableEnded=false;res.setHeader=()=>{};res.flushHeaders=()=>{};res.end=()=>{res.writableEnded=true;};
 const c={app:{post(...args){handler=args.at(-1);}},global:{},authenticateUser(){},aiChatConcurrencyGate(){},rateLimit:()=>null,express:{json:()=>null},AI_CHAT_HOURLY_IP_LIMIT:100,AI_CHAT_MESSAGE_MAX_LEN:12000,AI_AGENT_MESSAGE_MARKER:'ai-message',AbortController,setTimeout,clearTimeout,setInterval,clearInterval,console:{log(){},warn(){},error(){}},
  validateString:v=>v,extractVisionImageUrls:()=>[],genConvId:()=>'ABCDEF-NEW',writeSse:()=>true,enforceAiChatAccess:async()=>({allowed:true}),normalizeDeepSeekModelName:()=>null,DEEPSEEK_MODEL_FLASH:'flash',DEEPSEEK_MODEL_PRO:'pro',DEEPSEEK_MODEL_REASONER:'reasoner',DEEPSEEK_MODEL_VISION:'vision',
  extractChatAttachments:async message=>({text:message,cards:[]}),unwrapAttachmentExtract:value=>value,loadAiContext:async()=>[],getAiConfig:async()=>{res.emit('close');return{};},
  saveInterruptedChatTurn,buildMsgMeta:buildMeta,getProcessEvents,sanitizeAssistantVisibleText:text=>text,supabase:{from(){return{async insert(rows){stored.push(...rows);return{error:null}}}}}};
 const a=source.indexOf("app.post('/api/agent/chat/stream'");const b=source.indexOf("app.get('/api/agent/chat/conversations'",a);vm.runInNewContext(source.slice(a,b),c);
 await handler(req,res);assert.equal(stored.length,1);assert.equal(stored[0].content,req.body.message);assert.equal(JSON.parse(stored[0].media_url).interrupted,true);assert.equal(req._searchApiCalls.signal.aborted,true);assert.equal(c.global.__inFlightStreams.size,0);
});

test('custom model route saves an encrypted mutation atomically for its authenticated account and echoes permanent deletions',async()=>{
 let handler,mutation;const c={app:{put(...args){handler=args.at(-1);}},authenticateUser(){},rateLimit:()=>null,
  cleanAiModelIn:m=>({...m,api_key:undefined,api_key_enc:'encrypted-fixture'}),cleanDeletedUidList:uids=>uids||[],cleanAiPrefs:prefs=>prefs||{},decryptAiModelSecret:()=> 'fixture-key',console,
  supabase:{async rpc(name,args){assert.equal(name,'save_ai_custom_models_snapshot');mutation=args;return{data:{ok:true,models:[],deleted_uids:['last'],ai_prefs:{research_model:'flash'}}}}}};
 const a=source.indexOf("app.put('/api/agent/custom-models'");const b=source.indexOf("app.get('/api/agent/image'",a);const snippet=source.slice(a,b);vm.runInNewContext(snippet.slice(0,snippet.lastIndexOf('\n});')+4),c);
 let output;const res={json:value=>{output=value;},status(){return this}};
 await handler({userName:'A',body:{user_name:'B',merge:true,models:[{uid:'last',api_key:'fixture-key'}],deleted_uids:['last'],ai_prefs:{research_model:'flash'}}},res);
 assert.equal(mutation.p_user_name,'A');assert.equal(mutation.p_replace,false);assert.equal(mutation.p_models[0].api_key,undefined);assert.equal(mutation.p_models[0].api_key_enc,'encrypted-fixture');assert.equal(output.models.length,0);assert.deepEqual(output.deleted_uids,['last']);
});
