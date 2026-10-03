'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {saveCustomChatTurn}=require('../render-api/ai-chat-save');
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
  enforceAiChatAccess:async()=>({allowed:true}),getAiQuotaErrorMessage:()=>'',assertSafeWebUrl:async url=>({parsed:new URL(url),addresses:['93.184.216.34']}),extractVisionImageUrls:()=>[],getAiConfig:async()=>({name:'configured'}),buildAiCorePrompt:config=>'Configured '+config.name,aiToolsForWorkMode:()=>[{type:'function',function:{name:'get_weather'}}],toolFeedback,runRequiredSearch,normalizeToolResultItems:normalize,saveCustomChatTurn,buildMsgMeta:buildMeta,getProcessEvents,
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
 const result=await routeFixture({disconnect:true});assert.equal(result.signal.aborted,true);assert.equal(result.frames.some(frame=>frame.type==='done'),false);assert.equal(result.stored.length,0);assert.equal(result.req.listenerCount('aborted'),1);assert.equal(result.res.listenerCount('close'),1);
});
