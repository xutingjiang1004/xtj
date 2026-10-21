'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { probeCapabilities, thinkingParameters } = require('../render-api/ai-model-capabilities');
const { createResearchCheckpoints } = require('../render-api/research-checkpoints');
const source = fs.readFileSync('render-api/server.js','utf8');
const config = {provider:'custom',model:'fixture-model',api_key:'isolated-only-key',base_url:'https://fixture.test/v1'};
function probeFixture(reply) {
  const requests = [];
  return {requests, safeUrl:async url => ({parsed:new URL(url),addresses:['93.184.216.34']}), transport:async (url,addresses,options) => {
    assert.equal(url.href,'https://fixture.test/v1/chat/completions'); assert.deepEqual(addresses,['93.184.216.34']);
    assert.ok(options.maxBytes <= 128*1024); assert.ok(options.timeoutMs <= 15000);
    const payload = JSON.parse(options.body); requests.push(payload); return reply(payload,requests.length);
  }};
}
test('capability checks require genuine output and never infer tools or thinking from HTTP 200',async () => {
  const f = probeFixture(() => ({status:200,text:JSON.stringify({choices:[{message:{content:'OK'}}]})}));
  const result = await probeCapabilities(config,f);
  assert.equal(f.requests.length,5); assert.equal(result.results[0].status,'passed');
  assert.ok(result.results.slice(1).every(row => row.status === 'unconfirmed'));
  assert.ok(!JSON.stringify(result).includes(config.api_key)); assert.ok(result.usage.total_tokens > 0);
});
test('capability checks observe schema-valid tools, actual image colors, reasoning and terminal SSE',async () => {
  const f = probeFixture(payload => {
    let message = {content:'OK'};
    if (payload.tools) message = {tool_calls:[{function:{name:'xtj_model_test',arguments:'{"answer":"OK"}'}}]};
    if (Array.isArray(payload.messages[0].content)) message = {content:'红色'};
    if (payload.reasoning_effort) message = {content:'OK',reasoning_content:'actual thought'};
    if (payload.stream) return {status:200,text:'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n'};
    return {status:200,text:JSON.stringify({choices:[{message}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}})};
  });
  const result = await probeCapabilities(config,f); assert.ok(result.results.every(row => row.status === 'passed'));
  assert.equal(result.usage.total_tokens,15,'authoritative usage is not double counted with fallback estimates');
});
for (const status of [401,403,404,429]) test('capability checks stop after a rejected basic call: '+status,async () => {
  const f = probeFixture(() => ({status,text:'{}'})), result = await probeCapabilities(config,f);
  assert.equal(f.requests.length,1); assert.equal(result.results[0].status,'failed'); assert.ok(result.results.slice(1).every(row => row.status === 'unconfirmed'));
});
test('capability cancellation retains already incurred usage and does not send further probes',async () => {
  const controller = new AbortController();
  const f = probeFixture(() => { controller.abort(); return {status:200,text:JSON.stringify({choices:[{message:{content:'OK'}}],usage:{total_tokens:12}})}; });
  const result = await probeCapabilities(config,{...f,signal:controller.signal}); assert.equal(f.requests.length,1); assert.equal(result.usage.total_tokens,12);
});
test('ordinary non-reasoning models do not receive unsupported effort parameters',() => {
  assert.deepEqual(thinkingParameters('openai','gpt-4o-mini','high'),{});
  assert.deepEqual(thinkingParameters('custom','unknown-model','high'),{});
  assert.equal(thinkingParameters('openai','gpt-5','high').reasoning_effort,'high');
  assert.equal(thinkingParameters('custom','checked-model','low',true).reasoning_effort,'low');
});
test('checkpoint snapshots serialize parallel completions and finish with the latest frontier',async () => {
  const calls = [], state = {version:1,workers:[]};
  const store = createResearchCheckpoints({rpc:async (_name,params) => {
    calls.push(params); if (params.p_op === 'save') await new Promise(resolve => setTimeout(resolve,params.p_state.workers.length === 1 ? 20 : 1));
    return {data:{ok:true,row:{id:'11111111-1111-4111-8111-111111111111',state}},error:null};
  }});
  const job = await store.begin({userName:'alice',accountId:'account-1'},{query:'question'});
  const first = job.save({...state,workers:[{status:'success',content:'A'}]});
  const second = job.save({...state,workers:[{status:'success',content:'A'},{status:'success',content:'B'}]});
  await Promise.all([first,second]); await job.finish('interrupted');
  assert.deepEqual(calls.map(row => row.p_op),['start','save','save','finish']);
  assert.equal(calls.at(-1).p_state.workers.length,2); assert.ok(calls.every(row => row.p_account_id === 'account-1'));
});
function researchFlowFixture({synthesisFails=false}={}) {
  const saved = [], workers = [], planning = [], usage = {prompt_tokens:3,completion_tokens:7,total_tokens:10};
  let interrupt = true;
  const a = source.indexOf('async function runSelfResearchFlow('), b = source.indexOf("require('./ai-model-capabilities').installModelCapabilities",a);
  const run = vm.runInNewContext('(function(){'+source.slice(a,b)+';return runSelfResearchFlow;})()',{
    deepSeekPricing:require('../render-api/deepseek-pricing'),require:name => require('../render-api/'+name.replace('./','')), AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    buildAiCorePrompt:()=> 'prompt',getPreferredDeepSeekModel:model=>model,DEEPSEEK_MODEL_REASONER:'selected-pro',DEEPSEEK_MODEL_FLASH:'selected-flash',
    SELF_RESEARCH_PLANNER_PROMPT:'planner',SELF_RESEARCH_SYNTH_PROMPT_FAST:'synth {{AGENT_COUNT}}',SELF_RESEARCH_SYNTH_PROMPT_DEEP:'synth',
    writeSse() {}, buildDefaultAgents:()=>[],cleanSearchResults:rows=>rows,
    callDeepSeek:async () => { planning.push(1); return {content:JSON.stringify({agents:[{role:'A',task_description:'A'},{role:'B',task_description:'B'}]}),usage}; },
    runResearchSubAgent:async opts => {
      workers.push(opts.agent.role); opts.onSearch();
      if (opts.agent.role === 'B' && interrupt) { while (!saved.some(s => s.workers[0]?.status === 'success')) await new Promise(r => setTimeout(r,1)); opts.cancelToken.cancelled = true; return {content:'',sources:[],usage}; }
      return {content:'finished '+opts.agent.role,sources:[{url:'https://source.test/'+opts.agent.role}],queries:[opts.agent.role],usage};
    },
    callDeepSeekViaResponses:async (_messages,options) => { if(synthesisFails)throw Error('isolated failure');options.onContentChunk('FINAL REPORT'); return {content:'FINAL REPORT',usage}; },
    console:{warn(){},error(){},log(){}}
  });
  return {saved,workers,planning,run,continue:()=>{interrupt=false;}};
}
test('real research continuation reuses the plan, completed worker and sources without rebilling old work',async () => {
  const f = researchFlowFixture(), opts = {res:{},query:'research topic',model:'mini',userName:'alice',config:{},rewrite:false, cancelToken:{cancelled:false},
    checkpointState:{version:1,request:{query:'research topic'},workers:[]},onCheckpoint:async state => {f.saved.push(JSON.parse(JSON.stringify(state)));}};
  const first = await f.run(opts); assert.equal(first.answer,''); assert.equal(first.usage.total_tokens,30);
  const frontier = f.saved.at(-1); assert.equal(frontier.workers[0].status,'success');
  f.continue(); const second = await f.run({...opts,checkpointState:frontier,cancelToken:{cancelled:false},resumed:true});
  assert.equal(second.answer,'FINAL REPORT'); assert.deepEqual(f.workers,['A','B','B']); assert.equal(f.planning.length,1);
  assert.equal(second.usage.total_tokens,20,'only the unfinished worker and new synthesis are charged'); assert.equal(second.search_count,1);
  assert.ok(second.sources.some(row => row.url === 'https://source.test/A'));
});
test('a failed synthesis preserves real worker materials without marking the research complete',async()=>{
  const f=researchFlowFixture({synthesisFails:true});f.continue();
  const result=await f.run({res:{},query:'topic',model:'mini',userName:'alice',config:{},rewrite:false,cancelToken:{cancelled:false}});
  assert.equal(result.complete,false);assert.match(result.answer,/finished A/);
});
test('research resume binds the stored model and conversation, and synthesis-only work does not rebill old searches',async()=>{
  const {EventEmitter}=require('node:events');let handler,captured;const charges=[],finishes=[],gates=[];
  const state={version:1,stage:'synthesize',agents:[{role:'A'}],workers:[{status:'success',content:'saved work'}],request:{query:'ORIGINAL QUESTION',conversation_id:'ORIGINAL01',model:'mini',research_model:'flash',refresh:true,rewrite:false}};
  const c={app:{post(...args){handler=args.at(-1);}},express:{json:()=>null},fetchSafeWebPage:async()=>null,authenticateUser(){},aiChatConcurrencyGate(){},aiRequestMiddleware(){},rateLimit(){},AbortController,Date,
    researchCheckpoints:{begin:async()=>({id:'11111111-1111-4111-8111-111111111111',state,resumed:true,save:async()=>{},finish:async status=>finishes.push(status)})},
    tryAcquireDeepResearch:()=>()=>{},enforceAiChatAccess:async(_user,opts)=>{gates.push(opts);return{allowed:true};},measureSearchQuota:async()=>({allowed:false,reason:'search_limit'}),
    validateString:value=>value,genConvId:()=> 'NEWCONV01',researchCacheKey:()=> 'isolated',researchCacheGet:()=>null,researchCacheSet(){},researchCache:new Map(),
    getAiConfig:async()=>({}),runSelfResearchFlow:async opts=>{captured=opts;return{answer:'RESUMED REPORT',complete:true,usage:{total_tokens:12},search_count:0,sources:[{url:'https://old-source.test/'}]};},
    persistResearchRecord:async()=> 'saved-report',recordAiTurnUsage:async(_user,usage,opts)=>{charges.push({usage,opts});return{};},
    setInterval:()=>1,clearInterval(){},writeSse:(res,event)=>res.events.push(event),console:{error(){},warn(){}}
  };
  const a=source.indexOf("app.post('/api/agent/research/stream'"),b=source.indexOf('// GET /api/agent/research/history',a);vm.runInNewContext(source.slice(a,b),c);
  const req=new EventEmitter();Object.assign(req,{userName:'alice',accountId:'account',body:{checkpoint_id:'11111111-1111-4111-8111-111111111111',query:'EDITED QUESTION',conversation_id:'WRONGCONV',research_model:'pro',model:'pro'}});
  const res=new EventEmitter();Object.assign(res,{events:[],setHeader(){},flushHeaders(){},end(){this.writableEnded=true;}});await handler(req,res);
  assert.equal(captured.query,'ORIGINAL QUESTION');assert.equal(captured.convId,'ORIGINAL01');assert.equal(captured.researchModel,'flash');assert.equal(captured.model,'mini');
  assert.equal(gates[0].needSearch,false);assert.equal(charges[0].opts.search_count,0);assert.equal(charges[0].usage.total_tokens,12);
  assert.deepEqual(finishes,['complete']);assert.equal(res.events.at(-1).type,'research_done');
});
