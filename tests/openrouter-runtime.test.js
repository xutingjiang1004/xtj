'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const express = require('express'), request = require('supertest');
const openRouter = require('../render-api/openrouter');
const {probeCapabilities} = require('../render-api/ai-model-capabilities');
const assistantOutput = require('../render-api/ai-assistant-output');
const {saveCustomChatTurn,saveInterruptedChatTurn,saveDeepThinkChatTurn} = require('../render-api/ai-chat-save');
const {toolFeedback} = require('../render-api/ai-tool-feedback');
const server = fs.readFileSync('render-api/server.js','utf8');
const TEST_KEY = 'isolated-openrouter-test-key';
function configure(t) {
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = TEST_KEY;
  t.after(() => { if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; });
}
const body = () => ({provider:'openrouter',model:openRouter.MODEL,model_uid:openRouter.MODEL_UID,base_url:openRouter.BASE_URL,
  message:'原始问题',conversation_id:'OPENROUTER01',client_request_id:'test-request',thinking_mode:'off',web_search:false,messages_include_current:false});
function freeRequest(payload) {
  assert.equal(payload.model,openRouter.MODEL);
  assert.deepEqual(payload.provider,{allow_fallbacks:false,require_parameters:true,max_price:{prompt:0,completion:0,request:0,image:0}});
  assert.ok(payload.plugins.every(plugin=>plugin.enabled===false));assert.deepEqual(payload.plugins.map(plugin=>plugin.id),['web','file-parser','response-healing','fusion','pareto-router']); assert.equal(payload.models,undefined); assert.equal(payload.route,undefined);
}
function frame(packet) { return 'data: ' + JSON.stringify(packet) + '\r\n\r\n'; }
function stream(text, split = false) {
  const bytes = new TextEncoder().encode(text); let offset=0;
  return new Response(new ReadableStream({pull(c) { if(offset>=bytes.length)return c.close(); const count=split?3:bytes.length; c.enqueue(bytes.slice(offset,offset+count)); offset+=count; }}));
}
function routeFixture(options={}) {
  const events=[],calls=[],rows=[],toolContexts=[],usage=[],timers=[]; let handler;
  const req=new EventEmitter(),res=new EventEmitter(); req.userName=options.userName===undefined?'xxz':options.userName; req.body={...body(),...options.body};
  Object.assign(res,{writableEnded:false,headers:{},setHeader(k,v){this.headers[k]=v;},flushHeaders(){},end(){this.writableEnded=true;}});
  const c={app:{post(_path,...handlers){handler=handlers.at(-1);}},express:{json(){}},authenticateUser(){},aiChatConcurrencyGate(){},aiRequestMiddleware(){},resolveAiModelReference(){},rateLimit(){},
    openRouter,ADMIN_USERNAME:'xxz',AI_CHAT_HOURLY_IP_LIMIT:10,AI_CHAT_MESSAGE_MAX_LEN:60000,AI_AGENT_MESSAGE_MARKER:'__ai_agent_msg__',
    URL,TextDecoder,AbortController,Date,console:{log(){},warn(){},error(){}},require:n=>require('../render-api/'+n.slice(2)),
    setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){if(t)t.cleared=true;},setInterval(){return 1;},clearInterval(){},
    validateString:x=>x,genConvId:()=> 'NEWCONV01',getAiConfig:async()=>({}),buildAiCorePrompt:()=> '真实系统提示',
    assertSafeWebUrl:async url=>({parsed:new URL(url),addresses:[{address:'93.184.216.34',family:4}]}),
    extractVisionImageUrls:attachments=>(attachments||[]).filter(a=>String(a.type).startsWith('image/')).map(a=>a.data_url),
    extractChatAttachments:async text=>({text:text+'\n真实文件段落'}),unwrapAttachmentExtract:x=>x,createAiHistoryAttachmentBudget:()=>({}),
    prepareAiHistoryMessage:async m=>({...m,vision_urls:[]}),enforceAiChatAccess:async()=>({allowed:true}),
    aiTaskPolicy:{MAX_TOOL_ROUNDS:3},aiToolsForWorkMode:()=>[{type:'function',function:{name:'get_weather',parameters:{type:'object',properties:{}}}}],
    runRequiredSearch:async()=>{},assistantOutput,finalReplyContainsInternalProtocolGlobal:()=>false,looksLikeToolArgsFragment:()=>false,parseDsmlToolCallsGlobal:()=>({calls:[]}),
    executeToolCall:async(_call,context)=>{toolContexts.push(context);return {tool_name:'get_weather',content:'真实工具结果',cards:[]};},
    toolFeedback,normalizeToolResultItems:()=>[],getProcessEvents:()=>[],
    saveCustomChatTurn,saveInterruptedChatTurn,saveDeepThinkChatTurn,
    buildMsgMeta:(role,convId,usage,reasoning,seq,_search,_elapsed,extra)=>JSON.stringify({role,convId,usage,reasoning,seq,...extra}),
    supabase:{from:()=>({insert:async value=>{rows.push(...value);return{error:null};}})},
    recordAiTurnUsage:async(_name,value)=>usage.push(value),
    writeSse:(_res,event)=>{events.push(event);if(options.cancelOnContent&&event.type==='content')req.emit('aborted');return true;},
    requestPinnedStream:async(url,addresses,init)=>{
      assert.equal(url.href,openRouter.BASE_URL+'/chat/completions');assert.equal(addresses[0].address,'93.184.216.34');
      assert.equal(init.headers.Authorization,'Bearer '+TEST_KEY); const payload=JSON.parse(init.body);freeRequest(payload);calls.push({payload,signal:init.signal});
      if(options.respond)return options.respond(payload,calls.length,init,c);
      return stream(': OPENROUTER PROCESSING\r\n\r\n'+frame({choices:[{delta:{content:'你好，真实回复。'}}]})+frame({choices:[{delta:{},finish_reason:'stop'}]})+frame({choices:[],usage:{prompt_tokens:7,completion_tokens:4,total_tokens:11}})+'data: [DONE]\n\n',true);
    }};
  const start=options.deep?"app.post('/api/agent/custom-chat/deep-stream'":"app.post('/api/agent/custom-chat/stream'";
  const end=options.deep?'// ── 自定义第三方 AI 模型':"// ─────────────────────────────────────────────────────────────\n// POST /api/agent/custom-chat/deep-stream";
  const a=server.indexOf(start),b=server.indexOf(end,a);assert.ok(a>=0&&b>a);vm.runInNewContext(server.slice(a,b),c);
  return {req,res,events,calls,rows,toolContexts,usage,timers,run:()=>handler(req,res)};
}
test('managed credentials are owner-only, origin/model fixed, and nonserializable',()=>{
  const env={OPENROUTER_API_KEY:TEST_KEY};
  for(const user of ['',undefined,'alice'])assert.throws(()=>openRouter.resolveConfig(user,'xxz',{},env),{code:'OPENROUTER_OWNER_ONLY'});
  assert.throws(()=>openRouter.resolveConfig('xxz','xxz',{},{}),{code:'OPENROUTER_NOT_CONFIGURED'});
  for(const override of [{model:'minimax/minimax-m3.1-flash'},{model:'openrouter/free'},{base_url:'https://evil.example/v1'},{model_uid:'other'},{api_key:'browser-key'}])
    assert.throws(()=>openRouter.resolveConfig('xxz','xxz',override,env),{code:'OPENROUTER_FIXED_FREE_MODEL'});
  const config=openRouter.resolveConfig('xxz','xxz',body(),env);assert.equal(config.api_key,TEST_KEY);
  assert.doesNotMatch(JSON.stringify(config),/api_key|isolated-openrouter/);assert.equal(openRouter.catalog('alice','xxz',env).length,0);
  assert.equal(openRouter.catalog('xxz','xxz',env)[0].model,openRouter.MODEL);
  assert.doesNotMatch(JSON.stringify(openRouter.catalog('xxz','xxz',env)),/api_key|isolated-openrouter/);
  freeRequest(openRouter.freePayload({models:['paid'],route:'fallback',plugins:[{id:'web'}],model:'paid',provider:{allow_fallbacks:true}}));
});
for(const deep of [false,true])for(const userName of ['', 'alice'])test('existing '+(deep?'research':'chat')+' route refuses shared credentials for '+(userName||'anonymous'),async t=>{
  configure(t);const f=routeFixture({deep,userName});await f.run();assert.equal(f.calls.length,0);assert.equal(f.events.at(-1).code,'OPENROUTER_OWNER_ONLY');assert.equal(f.rows.length,0);
});
test('existing chat forwards context, parsed files, native images and persists streamed history without Key',async t=>{
  configure(t);const f=routeFixture({body:{messages:[{role:'user',content:'先前问题'},{role:'assistant',content:'先前回答'}],attachments:[{type:'image/png',data_url:'data:image/png;base64,AA=='}]}});await f.run();
  assert.deepEqual(f.calls[0].payload.messages.map(m=>m.role),['system','user','assistant','user']);
  assert.match(f.calls[0].payload.messages.at(-1).content[0].text,/真实文件段落/);assert.equal(f.calls[0].payload.messages.at(-1).content[1].type,'image_url');
  const done=f.events.find(e=>e.type==='done');assert.equal(done.saved,true);assert.equal(done.model,openRouter.MODEL);assert.equal(done.usage.total_tokens,11);
  assert.equal(f.events.filter(e=>e.type==='content').map(e=>e.text).join(''),'你好，真实回复。');assert.equal(f.rows.length,2);
  assert.equal(JSON.parse(f.rows[1].media_url).usage.model,openRouter.MODEL);assert.doesNotMatch(JSON.stringify([f.rows,f.events,f.usage]),new RegExp(TEST_KEY));
  assert.ok(f.timers.every(t=>t.cleared));
});
for(const [status,code] of [[401,'OPENROUTER_AUTH'],[403,'OPENROUTER_PERMISSION'],[402,'OPENROUTER_BALANCE'],[429,'OPENROUTER_FREE_LIMIT'],[404,'OPENROUTER_MODEL_UNAVAILABLE'],[503,'OPENROUTER_MODEL_UNAVAILABLE'],[400,'OPENROUTER_CAPABILITY'],[504,'OPENROUTER_TIMEOUT']])
 test('HTTP '+status+' is precise and never strips attachments/tools or falls back',async t=>{
  configure(t);const f=routeFixture({body:{attachments:[{type:'image/png',data_url:'data:image/png;base64,AA=='}]},respond:()=>new Response(JSON.stringify({error:{message:TEST_KEY}}),{status,headers:{'Retry-After':'30'}})});
  await f.run();assert.equal(f.calls.length,1);assert.equal(f.events.find(e=>e.type==='error').code,code);assert.equal(f.events.some(e=>e.type==='done'),false);assert.doesNotMatch(JSON.stringify(f.events),new RegExp(TEST_KEY));
  if(status===429)assert.equal(f.events.find(e=>e.type==='error').retry_after,30);
 });
for(const terminal of ['error','eof'])test('HTTP 200 '+terminal+' keeps partial history without fake completion',async t=>{
  configure(t);const f=routeFixture({respond:()=>stream(frame({choices:[{delta:{content:'已收到的正文'}}]})+(terminal==='error'?frame({error:{code:429,message:TEST_KEY},choices:[{finish_reason:'error',delta:{}}]}):''))});await f.run();
  assert.equal(f.events.some(e=>e.type==='done'),false);assert.equal(f.rows[1].content,'已收到的正文');assert.equal(JSON.parse(f.rows[1].media_url).complete,false);
  assert.equal(f.events.find(e=>e.type==='error').code,terminal==='error'?'OPENROUTER_FREE_LIMIT':'CUSTOM_STREAM_ERROR');assert.doesNotMatch(JSON.stringify(f.events),new RegExp(TEST_KEY));
});
test('stop aborts the upstream connection and saves an interrupted turn',async t=>{
  configure(t);const f=routeFixture({cancelOnContent:true});await f.run();assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.events.some(e=>e.type==='done'),false);assert.equal(JSON.parse(f.rows[0].media_url).finish_reason,'cancelled');assert.equal(f.rows[1].content,'你好，真实回复。');
});
test('timeout is distinguished from user stop',async t=>{
  configure(t);const f=routeFixture({respond:(_p,_n,init,c)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));c.setTimeout(()=>{},1);})});
  const running=f.run();await new Promise(setImmediate);f.timers.find(t=>t.ms===180000).fn();await running;
  assert.equal(f.events.find(e=>e.type==='error').code,'OPENROUTER_TIMEOUT');assert.equal(JSON.parse(f.rows[0].media_url).finish_reason,'upstream_error');
});
test('tool rounds preserve actual tool results and reasoning details with zero-price policy each time',async t=>{
  configure(t);const f=routeFixture({respond:(_payload,n)=>n===1?stream(frame({choices:[{delta:{reasoning_details:[{index:0,type:'reasoning.text',text:'第一段'}],tool_calls:[{index:0,id:'weather1',function:{name:'get_weather',arguments:'{}'}}]}}]})+frame({choices:[{delta:{reasoning_details:[{index:0,type:'reasoning.text',text:'第二段'}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n'):stream(frame({choices:[{delta:{content:'工具查询完成'},finish_reason:'stop'}]})+'data: [DONE]\n\n')});
  await f.run();assert.equal(f.calls.length,2);assert.equal(f.toolContexts[0].freeOnly,true);assert.equal(f.toolContexts[0].deepseekKey,undefined);
  const messages=f.calls[1].payload.messages;assert.equal(messages.at(-1).role,'tool');assert.equal(messages.at(-1).content,'真实工具结果');assert.equal(messages.at(-2).reasoning_details[0].text,'第一段第二段');
  assert.equal(f.events.find(e=>e.type==='done').content,'工具查询完成');
});
test('custom research reuses parsed files/native images and exactly the free model in all phases',async t=>{
  configure(t);const f=routeFixture({deep:true,body:{attachments:[{type:'image/png',data_url:'data:image/png;base64,AA=='}]},respond:(payload,n)=>payload.stream?stream(frame({choices:[{delta:{content:'真实研究结果'},finish_reason:'stop'}]})):new Response(JSON.stringify({choices:[{message:{content:n===1?JSON.stringify({agents:[{role:'研究员',task_description:'对照图片与文件',need_search:false}]}):'图片与文件分析'}}]}))});
  await f.run();assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>c.payload.messages.at(-1).content[1].type==='image_url'));assert.equal(f.events.find(e=>e.type==='done').saved,true);assert.equal(f.rows[1].content,'真实研究结果');
});
test('research stops on a free quota error during planning and never calls workers or paid DeepSeek',async t=>{
  configure(t);const f=routeFixture({deep:true,respond:()=>new Response('{}',{status:429})});await f.run();assert.equal(f.calls.length,1);assert.equal(f.events.find(e=>e.type==='error').code,'OPENROUTER_FREE_LIMIT');assert.equal(f.events.some(e=>e.type==='done'),false);
});
test('capability checks verify actual protocol results and reject in-band SSE errors',async()=>{
  const config=openRouter.resolveConfig('xxz','xxz',body(),{OPENROUTER_API_KEY:TEST_KEY}),calls=[];
  const deps={safeUrl:async u=>({parsed:new URL(u),addresses:[]}),transport:async(url,_addresses,init)=>{
    assert.equal(url.href,openRouter.BASE_URL+'/chat/completions');const p=JSON.parse(init.body);freeRequest(p);calls.push(p);
    const message=p.tools?{tool_calls:[{function:{name:'xtj_model_test',arguments:'{"answer":"OK"}'}}]}:{content:p.messages[0].content instanceof Array?'红色':'OK',reasoning:p.reasoning?'真实思考':undefined};
    return {status:200,text:p.stream?frame({choices:[{delta:{content:'OK'}}]})+frame({error:{code:429},choices:[{finish_reason:'error'}]}):JSON.stringify({choices:[{message}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}})};
  }};
  const result=await probeCapabilities(config,deps);assert.equal(calls.length,5);assert.equal(result.results.filter(r=>r.status==='passed').length,4);assert.equal(result.results.find(r=>r.name==='streaming').category,'OPENROUTER_FREE_LIMIT');
  assert.doesNotMatch(JSON.stringify(result),new RegExp(TEST_KEY));
});
test('capability API authenticates before resolving the owner-only backend key',async t=>{
  configure(t);let probes=0;const source=fs.readFileSync('render-api/ai-model-capabilities.js','utf8');const a=source.indexOf('function installModelCapabilities('),b=source.indexOf('\nmodule.exports',a);
  const install=vm.runInNewContext('('+source.slice(a,b).trim()+')',{openRouter,ENDPOINTS:{},AbortController,setTimeout,clearTimeout,
    probeCapabilities:async config=>{probes++;assert.equal(config.api_key,TEST_KEY);return{results:[],usage:{total_tokens:1}};}});
  const app=express();app.use(express.json());install(app,{ownerName:'xxz',authenticateUser(req,res,next){const user=req.headers['x-test-auth'];if(!user)return res.status(401).json({ok:false});req.userName=user;next();},rateLimit:()=> (_req,_res,next)=>next(),gate:async()=>({allowed:true}),record:async()=>{}});
  await request(app).post('/api/agent/models/check').send(body()).expect(401);
  const denied=await request(app).post('/api/agent/models/check').set('X-Test-Auth','alice').send({...body(),userName:'xxz'}).expect(403);assert.equal(denied.body.code,'OPENROUTER_OWNER_ONLY');assert.equal(probes,0);
  const allowed=await request(app).post('/api/agent/models/check').set('X-Test-Auth','xxz').send(body()).expect(200);assert.equal(probes,1);assert.doesNotMatch(JSON.stringify(allowed.body),new RegExp(TEST_KEY));
});
test('managed research reference cannot fall back to built-in DeepSeek when its backend key is missing',async()=>{
  const a=server.indexOf('  var researchModelSpec ='),b=server.indexOf('  // 统一取模型标识',a);let lookups=0;
  const source=server.slice(a,b),context={opts:{researchModel:'custom:'+openRouter.MODEL_UID},userName:'xxz',ADMIN_USERNAME:'xxz',openRouter:{...openRouter,resolveConfig:(...args)=>openRouter.resolveConfig(...args,{})},fetchLatestAiModelsSnapshot:async()=>{lookups++;throw Error('should not access snapshots');}};
  await assert.rejects(vm.runInNewContext('(async()=>{'+source+'})()',context),{code:'OPENROUTER_NOT_CONFIGURED'});assert.equal(lookups,0);
});
test('saved free model history retains the exact model identifier even when DeepSeek catalog is loaded',()=>{
  const a=server.indexOf('function normalizeDeepSeekUsageModel('),b=server.indexOf('\nfunction ',a+1);let fallback=0;
  const normalize=vm.runInNewContext('('+server.slice(a,b).trim()+')',{getPreferredDeepSeekModel:()=>{fallback++;return'deepseek-flash';},normalizeDeepSeekModelName:x=>x});
  assert.equal(normalize(openRouter.MODEL),openRouter.MODEL);assert.equal(fallback,0);
});
test('model catalog API never decrypts managed keys or caches any secret response',async t=>{
  configure(t);let handler,decrypts=0;
  const a=server.indexOf("app.get('/api/agent/custom-models'"),b=server.indexOf('// PUT /api/agent/custom-models',a);
  vm.runInNewContext(server.slice(a,b),{app:{get(_path,...h){handler=h.at(-1);}},authenticateUser(){},rateLimit(){},openRouter,ADMIN_USERNAME:'xxz',
    fetchLatestAiModelsSnapshot:async()=>({models:[{uid:'old',provider:'openrouter',api_key_enc:'legacy-cipher'},{uid:'personal',provider:'qwen',api_key_enc:'personal-cipher'}],deletedUids:[]}),
    publicAiModel:vm.runInNewContext('('+server.slice(server.indexOf('function publicAiModel('),server.indexOf('async function resolveAiModelReference(')).trim()+')'),
    decryptAiModelSecret(){decrypts++;return'personal-test-only-key';},console:{error(){}}});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},json(value){this.body=value;return this;}};await handler({userName:'xxz'},res);
  assert.equal(decrypts,0);assert.equal(res.body.models[0].api_key,undefined);assert.equal(res.body.models[0].api_key_enc,undefined);assert.equal(res.body.models[0].stored_reference,true);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.body.models.length,1);assert.equal(res.body.server_models[0].uid,openRouter.MODEL_UID);assert.equal(res.body.server_models[0].api_key,undefined);assert.doesNotMatch(JSON.stringify(res.body),new RegExp(TEST_KEY));
  await handler({userName:'alice'},res);assert.equal(res.body.server_models.length,0);
});
test('the free search path skips paid providers even when their keys are configured',async t=>{
  const providers=require('../render-api/search-providers');const names=['DEEPSEEK_API_KEY','TAVILY_API_KEY','BRAVE_SEARCH_API_KEY','SERPER_API_KEY','SEARCH_API_URL'];const old=names.map(name=>[name,process.env[name]]);
  for(const name of names)process.env[name]=name==='SEARCH_API_URL'?'https://paid-search.example':TEST_KEY;
  providers._searchCache.clear();t.after(()=>{for(const [name,value]of old){if(value===undefined)delete process.env[name];else process.env[name]=value;}providers._searchCache.clear();});
  const requests=[];t.mock.method(global,'fetch',async url=>{requests.push(String(url));assert.equal(new URL(url).hostname,'www.bing.com');return new Response('<li class="b_algo"><h2><a href="https://example.com/free-result">免费资料</a></h2><div class="b_caption"><p>真实模拟摘要</p></div></li>');});
  const result=await providers.searchWeb('免费路径独立测试',3,{freeOnly:true});assert.equal(result.results[0].url,'https://example.com/free-result');assert.equal(requests.length,1);
  assert.ok(result.diagnostics.enabled_providers.every(name=>['BingHtml','SearXNG'].includes(name)));
});
function nativeTransport(respond) {
  const calls=[],timers=[];
  const a=server.indexOf('async function callCustomModelOnce('),b=server.indexOf('async function runSelfResearchFlow(',a);
  const once=vm.runInNewContext('('+server.slice(a,b).trim()+')',{openRouter,CUSTOM_RESEARCH_ENDPOINTS:{},URL,TextDecoder,AbortController,
    setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;},clearTimeout(t){t.cleared=true;},
    assertSafeWebUrl:async url=>({parsed:new URL(url),addresses:[{address:'93.184.216.34',family:4}]}),
    requestPinnedStream:async(url,_addresses,init)=>{assert.equal(url.href,openRouter.BASE_URL+'/chat/completions');assert.equal(init.headers.Authorization,'Bearer '+TEST_KEY);const payload=JSON.parse(init.body);freeRequest(payload);calls.push(payload);return respond(payload,init);}});
  const config=openRouter.resolveConfig('xxz','xxz',body(),{OPENROUTER_API_KEY:TEST_KEY});
  return {calls,timers,run:(options={})=>once(config,[{role:'user',content:'原生深入研究的真实资料'}],options)};
}
test('the existing native research transport uses nonserializable credentials and zero-price requests for planning and synthesis',async()=>{
  const f=nativeTransport(payload=>payload.stream?stream(': processing\n\n'+frame({choices:[{delta:{reasoning:'实际思考',content:'实际综合结论'}}]})+frame({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:3,total_tokens:8}})+'data: [DONE]\n\n',true):new Response(JSON.stringify({choices:[{message:{content:'实际研究规划'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}})));
  assert.equal((await f.run()).content,'实际研究规划');const pieces=[],thoughts=[];const result=await f.run({stream:true,onContentChunk:c=>pieces.push(c),onThinkingChunk:c=>thoughts.push(c)});
  assert.equal(result.content,'实际综合结论');assert.equal(result.usage.total_tokens,8);assert.equal(pieces.join(''),'实际综合结论');assert.equal(thoughts.join(''),'实际思考');assert.equal(f.calls.length,2);assert.ok(f.timers.every(t=>t.cleared));
});
for(const status of [402,429])test('native research propagates '+status+' without swallowing SSE or HTTP errors',async()=>{
  const f=nativeTransport(payload=>payload.stream?stream(frame({choices:[{delta:{content:'保留的部分'}}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}})+frame({error:{code:status,message:TEST_KEY},choices:[{finish_reason:'error'}]})):new Response(JSON.stringify({error:{message:TEST_KEY}}),{status}));
  const code=status===402?'OPENROUTER_BALANCE':'OPENROUTER_FREE_LIMIT';await assert.rejects(f.run(),{code});const partial=[];
  await assert.rejects(f.run({stream:true,onContentChunk:c=>partial.push(c)}),e=>{assert.equal(e.code,code);assert.equal(e.usage.total_tokens,4);assert.doesNotMatch(e.message,new RegExp(TEST_KEY));return true;});assert.equal(partial.join(''),'保留的部分');
});
test('native research distinguishes its response timeout from user cancellation',async()=>{
  const f=nativeTransport((_payload,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))));
  const pending=f.run();await new Promise(setImmediate);f.timers[0].fn();await assert.rejects(pending,{code:'OPENROUTER_TIMEOUT'});assert.ok(f.timers[0].cleared);
});
test('a page refresh preserves the chosen free reference while its private catalog is still loading',()=>{
 const source=fs.readFileSync('js/ai-agent.js','utf8'),a=source.indexOf('  function resolveInitialModel()'),b=source.indexOf('\n  var S =',a);
 const initial=vm.runInNewContext('('+source.slice(a,b).trim()+')',{localStorage:{getItem:()=> 'custom:'+openRouter.MODEL_UID},normalizeAiModelId:x=>x,ALLOWED_AI_MODELS:['deepseek-flash'],isCustomModelId:x=>x.startsWith('custom:'),CUSTOM_MODEL_PREFIX:'custom:',OPENROUTER_MODEL_UID:openRouter.MODEL_UID,findCustomModel:()=>null,DEFAULT_AI_MODEL:'deepseek-flash'});
 assert.equal(initial(),'custom:'+openRouter.MODEL_UID);
});
