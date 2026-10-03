'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {toolFeedback,runRequiredSearch}=require('../render-api/ai-tool-feedback');
const {appendProcessEvent,getProcessEvents}=require('../render-api/ai-process-events');
const source=fs.readFileSync('render-api/server.js','utf8');
const normalize=new Function(source.slice(source.indexOf('function normalizeToolResultItems('),source.indexOf("const { getMailTransporter"))+'return normalizeToolResultItems;')();
test('all model tool results use bounded sources, exact zero/unknown counts and human outcomes',()=>{
 const rows=Array.from({length:18},(_,i)=>({title:'网页 '+i,url:'https://example.com/'+i,snippet:'说明'}));
 const result=toolFeedback({tool_name:'search_web',results_count:18,content:JSON.stringify(rows)},'search',normalize);
 assert.equal(result.count,18);assert.equal(result.items.length,12);assert.equal(result.items_total,18);assert.equal(result.items_truncated,true);assert.equal(result.summary,'找到 18 个网页');
 assert.equal(toolFeedback({tool_name:'search_social',results_count:0},'zero',normalize).summary,'找到 0 个网页');
 const unknown=toolFeedback({tool_name:'search_web',content:'api_key secret, not an array'},'unknown',normalize);assert.equal(unknown.count,undefined);assert.match(unknown.summary,/未提供/);assert.equal(unknown.items,null);
 const weather=toolFeedback({tool_name:'get_weather',location:'福州',cards:[{data:{city:'福州',condition:'晴',temperature_c:0}}]},'weather',normalize);assert.match(weather.summary,/福州.*晴.*0°C/);
 assert.equal(toolFeedback({tool_name:'publish_post',pending_confirmation_id:'confirmation'},'draft',normalize).summary,'已准备操作，等待确认');
 const res={};appendProcessEvent(res,{type:'tool_calls',tools:[{id:'search',name:'search_web',args:{query:'资料'}}]});appendProcessEvent(res,result);
 const saved=getProcessEvents(res)[0].tools[0];assert.equal(saved.count,18);assert.equal(saved.summary,result.summary);assert.equal(saved.items.length,10);
});
for(const outcome of ['success','zero','failed'])test('force search actually executes once and gives the model its '+outcome+' result',async()=>{
 const frames=[],messages=[{role:'user',content:'福州最新消息'},{role:'assistant',content:'之前的回复'},{role:'user',content:'重新'}];const context={userName:'A',signal:new AbortController().signal};let calls=0;
 const result=await runRequiredSearch({enabled:true,text:'重新',messages,context,normalizeItems:normalize,write:e=>{frames.push(e);return true;},execute:async(call,ctx)=>{calls++;assert.equal(ctx,context);assert.equal(JSON.parse(call.function.arguments).query,'福州最新消息');return outcome==='failed'?{tool_name:'search_web',error:'服务暂不可用'}:{tool_name:'search_web',results_count:outcome==='zero'?0:1,content:outcome==='zero'?'[]':'[{"title":"资料","url":"https://example.com/"}]'};}});
 assert.equal(calls,1);assert.deepEqual(frames.map(e=>e.type),['tool_calls','tool_pending','tool_result']);assert.equal(frames[2].call_id,frames[0].tools[0].id);assert.equal(frames[2].success,outcome!=='failed');assert.equal(messages.at(-1).role,'user');assert.match(messages.at(-2).content,/失败或无结果时明确说明/);assert.ok(result);
});
test('automatic search remains the model choice, and cancelled/backpressured requests do no extra work',async()=>{
 let calls=0;const controller=new AbortController();const options={enabled:false,text:'你好',messages:[],context:{signal:controller.signal},execute:async()=>{calls++;return {};},write:()=>true,normalizeItems:normalize};
 assert.equal(await runRequiredSearch(options),null);assert.equal(calls,0);controller.abort();assert.equal(await runRequiredSearch({...options,enabled:true}),null);assert.equal(calls,0);
 assert.equal(await runRequiredSearch({...options,enabled:true,context:{},write:()=>false}),null);assert.equal(calls,0);
});
test('both built-in transports and third-party protocol adapters use the same server tool set and feedback',()=>{
 assert.equal((source.match(/var workModeEnabled = true;/g)||[]).length,2);
 const custom=source.slice(source.indexOf("app.post('/api/agent/custom-chat/stream'"),source.indexOf("app.post('/api/agent/custom-chat/deep-stream'"));
 assert.match(custom,/var customTools = aiToolsForWorkMode\(\)/);assert.doesNotMatch(custom,/CUSTOM_TOOL_NAMES/);
 assert.match(custom,/toolFeedback\(dRes/);assert.match(custom,/toolFeedback\(tRes/);assert.match(custom,/type: 'card', call_id:/);
 assert.match(custom,/runRequiredSearch\(\{ enabled: _webSearch/);
 const builtin=source.slice(source.indexOf("app.post('/api/agent/chat/stream'"));assert.match(builtin,/runRequiredSearch\(\{ enabled: webSearchEnabled/);assert.match(builtin,/apiBody.tools = aiToolsForWorkMode\(\)/);
 assert.doesNotMatch(builtin,/validatedModel = DEEPSEEK_RESPONSES_MODEL;/);
});

test('real search executor distinguishes provider outage, successful zero and denied quota',async()=>{
 const start=source.indexOf("    case 'search_web': {"),end=source.indexOf("    case 'tavily_search': {",start);
 const body=source.slice(start+"    case 'search_web': {".length,end).replace(/\s*}\s*$/, '');
 let calls=0,allowed=true,result={results:[],diagnostics:{provider_errors:[{error:'private provider detail'}],provider_results:[]}};
 const execute=new Function('searchWeb','claimSearchSlot','searchQuotaErrorPayload','aiSiteCard','return async function(args,context){var name="search_web";'+body+'}')(async()=>{calls++;return result;},async()=>({allowed,reason:'search_limit'}),()=>({error:'搜索额度已用完'}),(type,title,data)=>({type,title,data}));
 const outage=await execute({query:'福州'},{});assert.match(outage.error,/暂时不可用/);assert.doesNotMatch(JSON.stringify(outage),/private provider detail/);
 result={results:[],diagnostics:{provider_errors:[],provider_results:[{count:0}]}};
 const zero=await execute({query:'福州'},{});assert.equal(zero.error,undefined);assert.equal(zero.results_count,0);assert.equal(toolFeedback(zero,'zero',normalize).summary,'找到 0 个网页');
 allowed=false;const denied=await execute({query:'福州'},{});assert.match(denied.error,/额度/);assert.equal(calls,2);
});
