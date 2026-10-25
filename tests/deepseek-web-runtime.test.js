'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), dns = require('node:dns');
const web = require('../render-api/deepseek-web');
const providers = require('../render-api/search-providers');
const price = require('../render-api/deepseek-pricing');
function configure(t) {
  const keys = ['DEEPSEEK_WEB_ENABLED','DEEPSEEK_WEB_API_KEY','DEEPSEEK_API_KEY','TAVILY_API_KEY','BRAVE_SEARCH_API_KEY','SERPER_API_KEY','SEARCH_API_URL','DEEPSEEK_WEB_MAX_REQUESTS_PER_TURN','DEEPSEEK_WEB_MAX_COST_CNY'];
  const previous = keys.map(key => [key, process.env[key]]);
  keys.forEach(key => delete process.env[key]); process.env.DEEPSEEK_API_KEY = 'isolated-test-key';
  providers._searchCache.clear();
  t.after(() => { for (const [key,value] of previous) { if(value===undefined)delete process.env[key];else process.env[key]=value; } providers._searchCache.clear(); });
}
test('native Search preserves model summaries, uses fixed authenticated endpoint and records separate fees',async t => {
  configure(t); const context = {}, calls = [];
  t.mock.method(global,'fetch',async (url,options) => { calls.push({url,options}); return new Response(JSON.stringify({results:[{title:'事实来源',url:'https://example.com/a',snippet:'简述',summary:'给模型的完整摘要'.repeat(60),date:'2026-10-17'}]})); });
  const result = await web.search('DeepSeek site:example.com',4,{context});
  assert.equal(calls[0].url,'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[0].options.headers.Authorization,'Bearer isolated-test-key');
  assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].options.body),{query:'DeepSeek site:example.com',count:4,need_content:false});
  assert.ok(result.results[0].summary.length>300); assert.equal(result.results[0].published_at,'2026-10-17');
  const usage = web.enrichUsage({cost:1,currency:'CNY'},context);
  assert.equal(usage.cost,1); assert.equal(usage.web_usage.estimated_cost,.005); assert.equal(usage.web_usage.search,1);
  await assert.rejects(web.search('😀'.repeat(129),2),/128/); assert.equal(calls.length,1);
});
test('search cache separates complete trailing constraints, count and BYOK scope; cache hits incur no provider fee',async t => {
  configure(t); let calls = 0;
  t.mock.method(global,'fetch',async (_url,options) => { calls++; const body=JSON.parse(options.body);return new Response(JSON.stringify({results:Array.from({length:body.count},(_,i)=>({title:body.query,url:'https://example.com/'+calls+'/'+i,snippet:'测试',summary:'完整'}))})); });
  const base='a'.repeat(100), context={};
  const first=await providers.searchWeb(base+' site:alpha.test',1,{context});
  const hit=await providers.searchWeb(base+' site:alpha.test',1,{context});
  const second=await providers.searchWeb(base+' site:beta.test',1,{context});
  const count=await providers.searchWeb(base+' site:alpha.test',2,{context});
  await providers.searchWeb(base+' site:alpha.test',1,{context,deepseekKey:'another-account'});
  assert.equal(calls,4);assert.equal(hit.cache_hit,true);assert.equal(first.used_provider,'DeepSeek');
  assert.notEqual(first.results[0].url,second.results[0].url);assert.equal(count.results.length,2);
  assert.equal(context.webUsage.successful,4);
  for(const key of providers._searchCache.keys()){assert.ok(!key.includes('another-account'));assert.equal(key.length,64);}
});
test('provider timeout aborts the actual request and catches synchronous failures',async () => {
  let aborted=false;
  await assert.rejects(providers.withSearchProviderTimeout(signal=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new Error('stopped'));},{once:true});}),15),{code:'SEARCH_PROVIDER_TIMEOUT'});
  assert.equal(aborted,true);
  await assert.rejects(providers.withSearchProviderTimeout(()=>{throw new Error('sync failure');},15),/sync failure/);
});
test('caller cancellation stops the chain, does not start fallback or cache an incomplete response',async t => {
  configure(t);const controller=new AbortController(),context={};let calls=0,aborted=false,started;const requestStarted=new Promise(resolve=>{started=resolve;});
  t.mock.method(global,'fetch',async (_url,options)=>{calls++;started();return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('cancelled','AbortError'));},{once:true});});});
  const result=providers.searchWeb('cancel this search',2,{signal:controller.signal,context});
  await requestStarted;controller.abort();await assert.rejects(result,{name:'AbortError'});
  assert.equal(aborted,true);assert.equal(calls,1);assert.equal(providers._searchCache.size,0);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(context.webUsage.unknown,1);
});
test('empty responses are unbilled and unreadable successful responses retain unknown billing status',async t=>{
  configure(t);const context={};let calls=0;
  t.mock.method(global,'fetch',async()=>++calls===1?new Response('{"results":[]}'):new Response('x',{headers:{'content-length':String(3*1024*1024)}}));
  await web.search('empty',1,{context});await assert.rejects(web.search('oversize',1,{context}));
  const usage=web.enrichUsage({},context).web_usage;assert.equal(usage.empty,1);assert.equal(usage.unknown,1);assert.equal(usage.estimated_cost,0);
});
test('Fetch rejects internal URLs before any paid request and retains bounded Markdown',async t=>{
  configure(t);let calls=0;
  t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(global,'fetch',async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/v1/tools/fetch');assert.deepEqual(JSON.parse(options.body),{url:'https://example.com/article'});return new Response(JSON.stringify({title:'标题',content:'# 正文\n'+'原文'.repeat(35000)}));});
  await assert.rejects(web.fetchPage('http://127.0.0.1/private'));await assert.rejects(web.fetchPage('https://user:password@example.com/private'));
  assert.equal(calls,0);const page=await web.fetchPage('https://example.com/article');assert.equal(calls,1);assert.ok(page.content.startsWith('# 正文'));assert.equal(page.content.length,24000);assert.equal(page.truncated,true);assert.equal(page.via_deepseek,true);
});
test('bounded rolling-window queue enforces rate, concurrent work and cancellation before transmission',async()=>{
  const limiter=web.createLimiter(2,40),starts=[];let active=0,peak=0,queuedRan=false;
  const work=()=>limiter(async()=>{starts.push(Date.now());active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;});
  const tasks=Array.from({length:5},work),controller=new AbortController();
  const queued=limiter(()=>{queuedRan=true;},controller.signal);controller.abort();await assert.rejects(queued,{name:'AbortError'});await Promise.all(tasks);
  assert.equal(queuedRan,false);assert.ok(peak<=2);assert.ok(starts[2]-starts[0]>=38);assert.ok(starts[4]-starts[2]>=38);
});
test('pricing distinguishes Flash-1017/Pro, Beijing peak boundaries, weekends and official holidays',()=>{
  const usage={prompt_tokens:1e6,completion_tokens:1e6,prompt_cache_hit_tokens:200000};
  const off=price.estimate(usage,'deepseek-flash','2026-10-19T00:59:59Z',{});
  const peak=price.estimate(usage,'DeepSeek-V4.1-Flash-1017','2026-10-19T01:00:00Z',{});
  assert.equal(off.cost,4.804);assert.equal(peak.cost,9.608);assert.equal(peak.pricing.band,'peak');
  assert.equal(price.estimate(usage,'deepseek-v4-pro','2026-10-19T01:00:00Z',{}).cost,34.26);
  for(const at of ['2026-10-19T04:00:00Z','2026-10-19T10:00:00Z','2026-10-18T01:00:00Z','2026-10-01T01:00:00Z'])assert.equal(price.pricing('deepseek-flash',at,{}).band,'off_peak');
  assert.equal(price.pricing('deepseek-flash','2027-01-04T01:00:00Z',{}).calendar_confirmed,false);
});
test('pricing charges missing cache breakdown, honors explicit zero/model overrides and preserves old data',()=>{
  const original={prompt_tokens:1000000,completion_tokens:1000000};
  const off='2026-10-18T01:00:00Z';
  assert.equal(price.estimate(original,'deepseek-flash',off,{}).cost,5);assert.equal(original.cost,undefined);
  assert.equal(price.estimate(original,'deepseek-flash',off,{DEEPSEEK_INPUT_PRICE_PER_1M:'0',DEEPSEEK_OUTPUT_PRICE_PER_1M:'0'}).cost,0);
  assert.equal(price.estimate(original,'deepseek-v4-pro',off,{DEEPSEEK_PRO_INPUT_PRICE_PER_1M:'2',DEEPSEEK_PRO_OUTPUT_PRICE_PER_1M:'3'}).cost,5);
});

test('paid requests respect the per-turn ceiling before transmitting another request',async t=>{
  configure(t);process.env.DEEPSEEK_WEB_MAX_REQUESTS_PER_TURN='1';const context={};let sent=0;
  t.mock.method(global,'fetch',async()=>{sent++;return new Response('{"results":[{"title":"a","url":"https://example.com/"}]}');});
  await web.search('first',1,{context});await assert.rejects(web.search('second',1,{context}),/budget/);
  assert.equal(sent,1);assert.equal(context.webUsage.started,1);assert.equal(context.webUsage.successful,1);
});
test('a fractional cost budget reserves the next paid request before sending it',async t=>{
  configure(t);let sent=0;
  t.mock.method(global,'fetch',async()=>{sent++;return new Response('{"results":[{"title":"a","url":"https://example.com/"}]}');});
  process.env.DEEPSEEK_WEB_MAX_COST_CNY='0.004';
  await assert.rejects(web.search('below one request',1,{context:{}}),/budget/);assert.equal(sent,0);
  process.env.DEEPSEEK_WEB_MAX_COST_CNY='0.009';const context={};
  await web.search('within budget',1,{context});await assert.rejects(web.search('would exceed budget',1,{context}),/budget/);assert.equal(sent,1);
  process.env.DEEPSEEK_WEB_MAX_COST_CNY='0.015';
  await web.search('second',1,{context});await web.search('third',1,{context});await assert.rejects(web.search('fourth',1,{context}),/budget/);assert.equal(sent,3);
});
test('real tool executor gates native Search/Fetch and keeps rich model evidence separate from cards',async t=>{
  configure(t);const fs=require('node:fs'),source=fs.readFileSync('render-api/server.js','utf8');
  const a=source.indexOf('async function executeToolCall('),b=source.indexOf('// 搜索结果自动补全',a);
  let gates=0,allowed=true,localReads=0;
  const execute=new Function('searchWeb','claimSearchSlot','AI_SITE_TOOL_REGISTRY','deepseekWeb','fetchSafeWebPage','aiSiteCard','searchQuotaErrorPayload',source.slice(a,b)+';return executeToolCall;')(
    providers.searchWeb,async()=>{gates++;return{allowed,reason:'search_limit'};},{},web,async url=>{localReads++;return{url,title:'本地来源',content:'备用正文'};},(type,title,data)=>({type,title,data}),()=>({error:'搜索额度已用完'})
  );
  const sent=[];t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(global,'fetch',async(url)=>{sent.push(url);return new Response(JSON.stringify(url.endsWith('/search')?{results:[{title:'恶意协议',url:'javascript:bad',summary:'错误归属'},{title:'实际来源',url:'https://example.com/source',snippet:'界面短摘要',summary:'模型完整证据',date:'2026-10-17'}]}:{title:'实际网页',content:'# 实际正文'}));});
  const context={userName:'alice',signal:new AbortController().signal};
  const search=await execute({function:{name:'search_web',arguments:'{"query":"test"}'}},context);
  const evidence=JSON.parse(search.content);assert.equal(evidence[0].summary,'模型完整证据');assert.equal(evidence[0].published_at,'2026-10-17');
  assert.equal(search.cards[0].data.results[0].snippet,'界面短摘要');assert.equal(search.cards[0].data.results[0].summary,undefined);
  const page=await execute({function:{name:'read_web_page',arguments:'{"url":"https://example.com/source"}'}},context);
  assert.match(page.content,/# 实际正文/);assert.match(page.content,/不可信/);assert.equal(localReads,0);assert.equal(gates,2);assert.equal(sent.length,2);
  allowed=false;const blocked=await execute({function:{name:'search_web',arguments:'{"query":"blocked"}'}},context);assert.match(blocked.error,/额度/);assert.equal(sent.length,2);
  await execute({function:{name:'read_web_page',arguments:'{"url":"https://example.com/source"}'}},context);assert.equal(localReads,1);assert.equal(sent.length,2);
});
test('request-scoped web fees stay isolated and are retained in actual assistant history metadata',async t=>{
  configure(t);const {EventEmitter}=require('node:events'),fs=require('node:fs');
  const source=fs.readFileSync('render-api/server.js','utf8'),a=source.indexOf('function buildMsgMeta('),b=source.indexOf("app.get('/api/agent/profile'",a);
  const build=new Function('deepseekWeb',source.slice(a,b)+';return buildMsgMeta;')(web);
  t.mock.method(global,'fetch',async()=>new Response('{"results":[{"title":"source","url":"https://example.com/"}]}'));
  async function run(query){return new Promise((resolve,reject)=>{const res=new EventEmitter();res.json=body=>body;
    web.middleware({path:'/api/agent/test'},res,()=>{(async()=>{await web.search(query,1);const saved=JSON.parse(build('assistant',query,{cost:2,currency:'CNY'},null,2));const live=res.json({usage:{cost:2,currency:'CNY'}});resolve({saved,live});})().catch(reject);});
  });}
  const turns=await Promise.all([run('owner-a'),run('owner-b')]);
  for(const turn of turns){assert.equal(turn.saved.usage.web_usage.search,1);assert.equal(turn.live.usage.web_usage.estimated_cost,.005);assert.equal(turn.live.usage.cost,2);}
});
test('Flash-1017 version names normalize to the same official request ID in server and client',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),server=fs.readFileSync('render-api/server.js','utf8'),client=fs.readFileSync('js/ai-agent.js','utf8');
 const a=server.indexOf("const DEEPSEEK_MODEL_FLASH ="),b=server.indexOf('function getPreferredDeepSeekModel',a);
 const normalizeServer=vm.runInNewContext(server.slice(a,b)+';normalizeDeepSeekModelName;');
 const x=client.indexOf('  var DEFAULT_AI_MODEL ='),y=client.indexOf('  var ALLOWED_THINKING_MODES',x);
 const normalizeClient=vm.runInNewContext(client.slice(x,y)+';normalizeAiModelId;');
 for(const name of ['DeepSeek-V4.1-Flash-1017','deepseek-v4-1-flash-1017','deepseek-v4-flash','deepseek-chat']){assert.equal(normalizeServer(name),'deepseek-flash');assert.equal(normalizeClient(name),'deepseek-flash');}
});

test('research aggregation preserves per-model and per-time prices instead of repricing the final total',()=>{
 const target={};
 price.accumulate(target,price.estimate({prompt_tokens:1e6,completion_tokens:1e6},'deepseek-flash','2026-10-18T01:00:00Z',{}));
 price.accumulate(target,price.estimate({prompt_tokens:1e6,completion_tokens:1e6},'deepseek-v4-pro','2026-10-19T01:00:00Z',{}));
 assert.equal(target.cost,41);assert.equal(target.pricing.requests,2);assert.equal(target.pricing.parts[0].model_family,'flash');assert.equal(target.pricing.parts[1].band,'peak');assert.equal(target.prompt_cache_miss_tokens,2e6);
 price.accumulate(target,{prompt_tokens:100});assert.equal(target.cost_incomplete,true);assert.equal(target.cost,41);
 price.accumulate(target,{cost:2,currency:'USD'});assert.equal(target.cost,null);assert.equal(target.currency,'mixed');assert.equal(target.costs_by_currency.USD,2);
});

for(const outcome of ['empty','http-error','success'])test('official-only '+outcome+' never calls a third-party provider',async t=>{
 configure(t);process.env.TAVILY_API_KEY='isolated-backup-key';const calls=[];
 t.mock.method(global,'fetch',async(url)=>{calls.push(String(url));assert.equal(String(url),'https://api.deepseek.com/v1/tools/search');return outcome==='http-error'?new Response('{}',{status:503}):new Response(JSON.stringify({results:outcome==='success'?[{title:'官方结果',url:'https://example.com/native',site_name:'站点名'}]:[]}));});
 const result=await providers.searchWeb('仅官方搜索-'+outcome,2,{officialOnly:true,context:{}});
 assert.equal(calls.length,1);assert.ok(result.diagnostics.enabled_providers.every(p=>p==='DeepSeek'));
 if(outcome!=='http-error'){assert.equal(result.used_provider,'DeepSeek');assert.equal(result.error,undefined);assert.equal(result.results.length,outcome==='empty'?0:1);}else{assert.equal(result.code,'official_search_unavailable');assert.match(result.error,/未使用第三方/);}
});
test('official-only cache never reuses a third-party result cached in automatic mode',async t=>{
 configure(t);process.env.TAVILY_API_KEY='isolated-backup-key';const calls=[];
 t.mock.method(global,'fetch',async(url)=>{calls.push(String(url));return String(url).includes('api.deepseek.com')?new Response('{}',{status:503}):new Response(JSON.stringify({results:[{title:'备用搜索',url:'https://example.com/backup',content:'备用摘要'}]}));});
 const automatic=await providers.searchWeb('相同查询的来源隔离',2,{context:{}});assert.equal(automatic.used_provider,'Tavily');
 const strict=await providers.searchWeb('相同查询的来源隔离',2,{officialOnly:true,context:{}});assert.equal(strict.cache_hit,false);assert.equal(strict.code,'official_search_unavailable');assert.equal(calls.length,3);
});
