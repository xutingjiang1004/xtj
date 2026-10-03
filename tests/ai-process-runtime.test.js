'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require('playwright');
const { appendProcessEvent, getProcessEvents } = require('../render-api/ai-process-events');
const read = path => fs.readFileSync(path, 'utf8');
async function fixture(t, effort='max', model='deepseek-flash') {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox']}); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://process.test/**', route => route.fulfill({contentType:'text/html',body:'<div class="app-container"><div id="panelAiChat"></div><div id="panelDeepThink" class="hidden"><div id="dtMessages"></div><textarea id="dtInput"></textarea><button id="dtSendBtn"></button><button id="dtPauseBtn"></button><button id="dtNewBtn"></button><button id="dtDelBtn"></button></div></div>'}));
  await page.goto('https://process.test/');
  await page.addStyleTag({content:'.hidden {display:none!important}'});
  for (const file of ['css/ai-agent.css','css/ui-enhance.css']) await page.addStyleTag({content:read(file)});
  await page.evaluate(({effort,model}) => {
    window.testEffort=effort;localStorage.setItem('xtj_ai_thinking_mode',effort);
    localStorage.setItem('xtj_ai_work_mode','false');localStorage.setItem('xtj_ai_think_max','false');
    localStorage.setItem('xtj_ai_model',model);
    window.mockModels=model.startsWith('custom:')?[{uid:'test-custom',label:'第三方模型',provider:'openai',model:'test-model',base_url:'https://provider.test/v1',api_key:'test-key'}]:[];
    localStorage.setItem('xtj_ai_custom_models__tester',JSON.stringify(mockModels));
    window.currentUser = 'tester'; window._authStateEpoch = 1;
    window.ensureProtectedOperationAuth = async () => ({ok:true,token:'test-token'});
    window.ensureUserToken = async () => 'test-token';
    window.showToast = message => (window.notices || (window.notices=[])).push(message);
    window.frames = []; window.failHistoryList = false; window.failDeepHistory = false;
    window.fetch = async (url, options={}) => {
      const path = new URL(url,location.href).pathname;
      let body={ok:true};
      if (path.endsWith('/config')) body={enabled:true,thinking_mode:testEffort,name:'小猫'};
      if (path.endsWith('/quota')) body={ok:true,quota:{can_chat:true,tokens_remaining:100000,search_remaining:100}};
      if (path.endsWith('/custom-models')) body={ok:true,models:mockModels};
      if (path.endsWith('/chat/conversations')) body=failHistoryList?{ok:false,error:'offline'}:{ok:true,conversations:[]};
      if (path.endsWith('/chat/history')) body=failDeepHistory&&String(url).includes('deep_think')?{ok:false,error:'offline'}:{ok:true,conversation_id:'test-cid',messages:[],has_more:false};
      if (path.endsWith('/chat/new')) {window.newCalls=(window.newCalls||0)+1;body={ok:true,conversation_id:'new-cid'};}
      if (path.endsWith('/chat/stream') || path.endsWith('/custom-chat/stream')) {
        window.sentURL=path;
        window.sent = JSON.parse(options.body);
        return new Response(new ReadableStream({start(controller){window.stream=controller;}}),{headers:{'Content-Type':'text/event-stream'}});
      }
      return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    };
    window.emit = event => {frames.push(event);stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));};
  },{effort,model});
  await page.addScriptTag({content:read('js/ai-agent.js')});
  await page.evaluate(() => __xtjAiAgent.open());
  await page.waitForFunction(() => document.querySelector('.ai-chat-empty')).catch(error=>{throw new Error(error.message+' '+JSON.stringify(errors));});
  return page;
}
test('tool completions preserve invocation IDs, order, duplicate pending state and bounded history', () => {
  const res={};
  const events=[{type:'reasoning',text:'先思考'}, {type:'tool_calls',tools:[{id:'a',name:'get_weather',args:{location:'北京',api_key:'never-store'}},{id:'b',name:'get_weather',args:{location:'上海'}}]}, {type:'tool_result',call_id:'b',tool_name:'get_weather',success:true}, {type:'tool_result',call_id:'a',tool_name:'get_weather',success:true}, {type:'tool_pending',call_id:'a',tool_name:'get_weather'}, {type:'reasoning',text:'再思考'}];
  events.forEach(e=>appendProcessEvent(res,e));
  const result=getProcessEvents(res);
  assert.deepEqual(result.map(e=>e.type),['reasoning','tools','reasoning']);
  assert.deepEqual(result[1].tools.map(t=>[t.call_id,t.detail,t.status]),[['a','北京','done'],['b','上海','done']]);
  assert.doesNotMatch(JSON.stringify(result),/never-store|api_key/);
  appendProcessEvent(res,{type:'reasoning',text:'x'.repeat(100000)});
  assert.ok(getProcessEvents(res).reduce((n,e)=>n+(e.text||'').length,0)<=64000);
});
test('live reasoning and tools remain in chronological order; completed calls stop and each result expands independently', async t => {
  const page = await fixture(t);
  await page.locator('#aiChatMsgInput').fill('查一下天气'); await page.locator('#aiChatSendBtn').click();
  await page.waitForFunction(()=>window.stream);
  await page.evaluate(()=>{
    emit({type:'reasoning',text:'先比较两座城市。'});
    emit({type:'tool_calls',tools:[{id:'a',name:'get_weather',args:{location:'北京'}},{id:'b',name:'get_weather',args:{location:'上海'}}]});
    emit({type:'tool_result',call_id:'b',tool_name:'get_weather',success:true,items:[{title:'上海结果',url:'https://example.com/sh'}]});
    emit({type:'tool_result',call_id:'a',tool_name:'get_weather',success:true,items:[{title:'北京结果',url:'https://example.com/bj'}]});
    emit({type:'tool_pending',call_id:'a',tool_name:'get_weather'});
    emit({type:'reasoning',text:'再结合工具结果判断。'});
  });
  await page.waitForFunction(()=>document.querySelectorAll('.ai-tool-step.is-done').length===2);
  assert.equal(await page.locator('.ai-tool-step.is-running').count(),0);
  assert.deepEqual(await page.locator('.ai-thinking-body').evaluate(body=>Array.from(body.children).map(n=>n.classList.contains('ai-process-timeline')?'tools':'reasoning')),['reasoning','tools','reasoning']);
  assert.equal(await page.locator('.ai-tool-result-card').count(),2);
  assert.ok(await page.locator('.ai-tool-step').first().isVisible());
  await page.locator('[data-tool-call-id="a"] .ai-tool-result-card > button').click();
  assert.equal(await page.locator('[data-tool-call-id="a"] .ai-search-detail').isVisible(),true);
  assert.equal(await page.locator('[data-tool-call-id="b"] .ai-search-detail').isVisible(),false);
  await page.locator('[data-tool-call-id="b"] .ai-tool-result-card > button').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-tool-call-id="b"] .ai-search-detail').isVisible(),true);
  await page.evaluate(()=>{emit({type:'content',text:'两座城市天气如下。'});emit({type:'done',content:'两座城市天气如下。',reasoning:'先比较两座城市。再结合工具结果判断。',thinking_mode:'max',complete:true,saved:true});stream.close();});
  await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
  assert.equal(await page.locator('.ai-thinking-body .ai-tool-step').count(),2);
  await page.evaluate(()=>__xtjAiAgent.close()); await page.evaluate(()=>__xtjAiAgent.open());
  await page.waitForFunction(()=>document.querySelectorAll('.ai-thinking-body .ai-tool-step').length===2);
  assert.deepEqual(await page.locator('.ai-thinking-body').evaluate(body=>Array.from(body.children).map(n=>n.classList.contains('ai-process-timeline')?'tools':'reasoning')),['reasoning','tools','reasoning']);
});
test('history list failure offers retry and upload folder is absent', async t => {
  const page=await fixture(t);
  await page.evaluate(()=>failHistoryList=true);await page.locator('.ai-chat-hist-btn').click();
  await page.waitForSelector('.ai-history-retry');
  assert.doesNotMatch(await page.locator('.ai-conv-list').textContent().catch(()=>''),/加载中/);
  await page.evaluate(()=>failHistoryList=false);await page.locator('.ai-history-retry').click();
  await page.waitForSelector('.ai-history-retry',{state:'detached'});
  await page.locator('.ai-chat-hist-btn').click();await page.locator('#aiPlusBtn').click();
  assert.equal(await page.locator('[data-action="upload-folder"]').count(),0);
  assert.equal(await page.locator('input[webkitdirectory]').count(),0);
});

for (const effort of ['low','medium','high','max']) test(effort+': tools appear between reasoning segments and an error settles only its own invocation',async t=>{
  const page=await fixture(t,effort);
  await page.locator('#aiChatMsgInput').fill('查询');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
  await page.evaluate(()=>{
    emit({type:'reasoning',text:'开始分析。'});
    emit({type:'tool_calls',tools:[{id:'x',name:'read_web_page',args:{url:'https://example.com/'}},{id:'y',name:'search_web',args:{query:'资料'}}]});
    emit({type:'tool_error',call_id:'x',tool_name:'read_web_page',error:'网页暂时不可用'});
  });
  await page.waitForFunction(()=>document.querySelector('.ai-tool-step.is-error'));
  assert.equal(await page.locator('[data-tool-call-id="y"].is-running').count(),1);
  await page.evaluate(()=>{emit({type:'tool_result',call_id:'y',tool_name:'search_web',success:true});emit({type:'reasoning',text:'继续分析。'});});
  await page.waitForFunction(()=>document.querySelectorAll('.ai-reasoning-segment').length===2);
  assert.equal(await page.locator('.ai-thinking-body .ai-tool-step').count(),2);
  assert.equal(await page.locator('.ai-tool-step.is-running').count(),0);
  assert.equal(await page.evaluate(()=>sent.thinking_mode),effort);
  await page.evaluate(()=>{emit({type:'done',content:'结论',thinking_mode:testEffort,complete:true,saved:true});stream.close();});
});
test('changing effort during auth applies to the next send without hiding the current reasoning',async t=>{
  const page=await fixture(t,'high');
  await page.evaluate(()=>{ensureProtectedOperationAuth=()=>new Promise(resolve=>window.releaseAuth=()=>resolve({ok:true,token:'test-token'}));});
  await page.locator('#aiChatMsgInput').fill('先按深度回答');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.releaseAuth);
  await page.locator('#aiPlusBtn').click();await page.locator('[data-action="open-think"]').click();
  await page.getByRole('option',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>releaseAuth());await page.waitForFunction(()=>window.stream);
  assert.equal(await page.evaluate(()=>sent.thinking_mode),'high');
  await page.evaluate(()=>{emit({type:'reasoning',text:'本次仍然思考。'});emit({type:'done',content:'本次回答',reasoning:'本次仍然思考。',thinking_mode:'high',complete:true,saved:true});stream.close();});
  await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
  assert.match(await page.locator('.ai-thinking-body').textContent(),/本次仍然思考/);
});
test('deep history failure retains its conversation and retries the same ID',async t=>{
  const page=await fixture(t);
  await page.evaluate(()=>{localStorage.setItem('xtj_ai_dt_conversation_id','existing-deep');failDeepHistory=true;return __xtjAiAgent.openDeepThink();});
  assert.equal(await page.locator('.dt-history-error').count(),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('xtj_ai_dt_conversation_id')),'existing-deep');
  assert.equal(await page.evaluate(()=>window.newCalls||0),0);
  await page.evaluate(()=>{failDeepHistory=false;const original=fetch;fetch=async(url,opts)=>String(url).includes('mode=deep_think')?new Response(JSON.stringify({ok:true,messages:[{role:'user',content:'原来的研究问题'}],has_more:false})):original(url,opts);});
  await page.locator('#panelDeepThink .ai-history-retry').click();await page.waitForFunction(()=>document.getElementById('dtMessages').textContent.includes('原来的研究问题'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('xtj_ai_dt_conversation_id')),'existing-deep');
});
test('SSE accepted events persist the same ordered process in assistant metadata',()=>{
  const {writeSse}=require('../render-api/sse-write');
  const frames=[],res={headersSent:true,writableEnded:false,write:frame=>{frames.push(frame);return true;},flush(){}};
  writeSse(res,{type:'reasoning',text:'先思考'});
  writeSse(res,{type:'tool_calls',tools:[{id:'one',name:'search_web',args:{query:'资料'}}]});
  writeSse(res,{type:'tool_result',call_id:'one',tool_name:'search_web',success:true,items:[{title:'来源',url:'https://example.com/'}]});
  writeSse(res,{type:'reasoning',text:'再分析'});
  const source=read('render-api/server.js'),start=source.indexOf('function buildMsgMeta('),end=source.indexOf("app.get('/api/agent/profile'",start);
  const build=new Function(source.slice(start,end)+'\nreturn buildMsgMeta;')();
  const meta=JSON.parse(build('assistant','cid',null,'先思考再分析',2,null,0,{process_events:getProcessEvents(res)}));
  assert.deepEqual(meta.process_events.map(event=>event.type),['reasoning','tools','reasoning']);
  assert.equal(meta.process_events[1].tools[0].status,'done');
  assert.equal(meta.process_events[1].tools[0].items[0].url,'https://example.com/');
  assert.equal(frames.length,4);
});

for(const model of ['deepseek-flash','deepseek-v4-pro','custom:test-custom']) test(model+': normal chat exposes tools by default and compact result counts survive history',async t=>{
 const page=await fixture(t,'off',model);await page.setViewportSize({width:390,height:844});
 await page.locator('#aiPlusBtn').click();assert.equal(await page.locator('[data-action="work-mode"]').count(),0);await page.locator('[data-action="search"]').click();
 await page.locator('#aiChatMsgInput').fill('查最新资料');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
 const sent=await page.evaluate(()=>({body:sent,url:sentURL}));assert.equal(sent.body.work_mode,true);assert.equal(sent.body.web_search,true);
 if(model.startsWith('custom:')) {assert.equal(sent.body.tools_enabled,true);assert.match(sent.url,/custom-chat/);}
 else assert.equal(sent.body.model,model);
 await page.evaluate(()=>{
  emit({type:'tool_calls',tools:[{id:'search',name:'search_web',args:{query:'最新资料'}}]});
  emit({type:'tool_result',call_id:'search',tool_name:'search_web',success:true,count:5,summary:'找到 5 个网页',items:[{title:'资料一',url:'https://example.com/a',snippet:'摘要'}]});
  emit({type:'card',call_id:'search',card:{protocol:'xtj.ai.ui.v1',id:'web-card',type:'web_search',title:'检索结果',data:{results:[{url:'https://example.com/a',title:'资料一'}]}}});
 });
 await page.waitForFunction(()=>document.querySelector('.ai-tool-step.is-done'));
 assert.match(await page.locator('.ai-tool-step-status').textContent(),/找到 5 个网页/);assert.equal(await page.locator('.ai-tool-card--web_search').count(),0);
 assert.equal(await page.locator('.ai-search-detail').isVisible(),false);
 const heading=page.locator('.ai-tool-result-card-title');assert.match(await heading.textContent(),/找到 5 个网页/);
 const row=await page.locator('.ai-tool-step-title').boundingBox(),countBox=await heading.boundingBox();assert.ok(Math.abs(row.y-countBox.y)<8,'result count stays on the search row');
 const queryBox=await page.locator('.ai-tool-step-detail').boundingBox();assert.ok(countBox.x-queryBox.x-queryBox.width>=0&&countBox.x-queryBox.x-queryBox.width<=8,'result follows the query closely '+JSON.stringify({queryBox,countBox}));
 const before=await heading.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.ai-tool-step-body').getBoundingClientRect();return{x:a.x-b.x,y:a.y-b.y};});await page.locator('.ai-tool-inline-result > button').click();assert.equal(await page.locator('.ai-search-detail').isVisible(),true);
 const after=await heading.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.ai-tool-step-body').getBoundingClientRect();return{x:a.x-b.x,y:a.y-b.y};}),result=await page.locator('.ai-search-detail').boundingBox();
 assert.ok(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,'count heading must not drift on expansion');
 assert.ok(result.width>200&&result.x+result.width<=390,'mobile results use a readable full-width column '+JSON.stringify({before,after,result}));
 assert.doesNotMatch(await page.locator('.ai-tool-step').textContent(),/查看结果/);
 await page.evaluate(()=>{emit({type:'done',content:'已找到相关资料。',thinking_mode:'off',complete:true,saved:true});stream.close();});await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
 const geometry=await page.evaluate(()=>{const b=document.querySelector('.ai-msg.assistant .ai-msg-bubble').getBoundingClientRect(),a=document.querySelector('.ai-msg-actions').getBoundingClientRect();return{left:a.left-b.left,below:a.top>=b.bottom,width:a.width,view:innerWidth};});
 assert.ok(geometry.below);assert.ok(Math.abs(geometry.left)<10,JSON.stringify(geometry));assert.ok(geometry.width<geometry.view);
 await page.evaluate(()=>__xtjAiAgent.close());await page.evaluate(()=>__xtjAiAgent.open());await page.waitForFunction(()=>document.querySelector('.ai-tool-step-status'));
 assert.match(await page.locator('.ai-tool-step-status').textContent(),/找到 5 个网页/);assert.equal(await page.locator('.ai-tool-card--web_search').count(),0);
 const restored=page.locator('.ai-tool-inline-result');assert.match(await restored.locator('button').textContent(),/找到 5 个网页/);
 assert.equal(await restored.locator('.ai-search-toggle').textContent(),' ▸');await restored.locator('button').click();
 assert.equal(await restored.locator('.ai-search-detail').isVisible(),true);assert.equal(await restored.locator('.ai-search-toggle').textContent(),' ▾');
});
test('weather feedback has actual facts and optional data stays collapsed in its own tool row',async t=>{
 const page=await fixture(t);
 await page.locator('#aiChatMsgInput').fill('福州天气');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
 await page.evaluate(()=>{
  emit({type:'tool_calls',tools:[{id:'weather',name:'get_weather',args:{location:'福州'}}]});
  emit({type:'tool_result',call_id:'weather',tool_name:'get_weather',success:true,summary:'已查询天气 · 福州 · 晴 · 26.7°C'});
  emit({type:'card',call_id:'weather',card:{protocol:'xtj.ai.ui.v1',id:'weather-card',type:'weather',title:'福州天气',data:{city:'福州',condition:'晴',temperature_c:26.7}}});
 });
 await page.waitForSelector('.ai-tool-data-details');assert.match(await page.locator('.ai-tool-step-status').textContent(),/晴.*26.7/);
 assert.equal(await page.locator('.ai-thinking-body [data-tool-call-id="weather"] .ai-tool-data-details').count(),1);assert.equal(await page.locator('.ai-tool-card--weather').isVisible(),false);
 await page.locator('.ai-tool-data-details > summary').click();assert.equal(await page.locator('.ai-tool-card--weather').isVisible(),true);
 await page.evaluate(()=>{emit({type:'done',content:'福州晴。',reasoning:'',thinking_mode:'max',complete:true,saved:true});stream.close();});
});
test('answer flow animates new text only, keeps complete copyable text and removes temporary spans',async t=>{
 const page=await fixture(t,'off');
 await page.locator('#aiChatMsgInput').fill('回答');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
 await page.evaluate(()=>{emit({type:'content',text:'第一段回答。'});});await page.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble').textContent.includes('第一段回答。'));
 const old=await page.locator('.ai-msg.assistant .ai-msg-bubble').evaluate(n=>{window.answerFirstNode=n.firstElementChild;return n.firstElementChild.textContent;});
 await page.evaluate(()=>{emit({type:'done',content:'第一段回答。\n\n第二段回答，包含 **加粗内容** 和完整的数据说明。',thinking_mode:'off',complete:true,saved:true});stream.close();});
 await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
 const state=await page.locator('.ai-msg.assistant .ai-msg-bubble').evaluate(n=>({preserved:n.firstElementChild===answerFirstNode,first:n.firstElementChild.textContent,animated:n.querySelectorAll('.ai-stream-reveal').length,text:n.textContent,animation:n.querySelector('.ai-stream-reveal')&&getComputedStyle(n.querySelector('.ai-stream-reveal')).animationName}));
 assert.equal(state.preserved,true);assert.equal(state.first,old);assert.ok(state.animated>0);assert.match(state.text,/完整的数据说明/);assert.equal(state.animation,'aiTextFlow');
 await page.waitForTimeout(380);assert.equal(await page.locator('.ai-msg-bubble .ai-stream-reveal').count(),0);assert.equal(await page.locator('.ai-msg-bubble .ai-stream-cursor').count(),0);
});

test('older card-only search results stay compact, counted and available after reopening history',async t=>{
 const page=await fixture(t,'off');
 await page.locator('#aiChatMsgInput').fill('搜索资料');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
 await page.evaluate(()=>{emit({type:'card',card:{protocol:'xtj.ai.ui.v1',id:'old-search-card',type:'web_search',title:'搜索资料',data:{query:'资料',results:[{title:'网页一',url:'https://example.com/1'},{title:'网页二',url:'https://example.com/2'}]}}});emit({type:'done',content:'检索完成。',thinking_mode:'off',complete:true,saved:true});stream.close();});
 await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
 assert.match(await page.locator('.ai-tool-data-details summary').textContent(),/2 个网页/);assert.equal(await page.locator('.ai-tool-card--web_search').isVisible(),false);
 await page.locator('.ai-tool-data-details summary').click();assert.equal(await page.locator('.ai-tool-card--web_search a').count(),2);
 await page.evaluate(()=>__xtjAiAgent.close());await page.evaluate(()=>__xtjAiAgent.open());await page.waitForSelector('.ai-tool-data-details');assert.equal(await page.locator('.ai-tool-card--web_search').isVisible(),false);
});

test('tool rows have a real entrance, nearby result receipts and reversible result transitions',async t=>{
 const page=await fixture(t,'max');await page.setViewportSize({width:390,height:844});
 await page.locator('#aiChatMsgInput').fill('搜索资料');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
 await page.evaluate(()=>emit({type:'tool_calls',tools:[{id:'motion',name:'search_web',args:{query:'资料'}}]}));
 await page.waitForSelector('[data-tool-call-id="motion"]');
 const motion=await page.locator('[data-tool-call-id="motion"]').evaluate(node=>({animations:node.getAnimations().map(a=>a.effect.getKeyframes()),opacity:getComputedStyle(node).opacity}));
 assert.ok(motion.animations.some(frames=>frames.some(frame=>frame.opacity==='0')&&frames.some(frame=>frame.opacity==='1')),JSON.stringify(motion));
 await page.evaluate(()=>emit({type:'tool_result',call_id:'motion',tool_name:'search_web',success:true,count:3,items:[{url:'https://example.com/one',title:'结果一'}]}));
 const receipt=page.locator('[data-tool-call-id="motion"] .ai-tool-result-card-title'),panel=page.locator('[data-tool-call-id="motion"] .ai-search-detail');await receipt.waitFor();
 const coords=await page.locator('[data-tool-call-id="motion"]').evaluate(node=>{const query=node.querySelector('.ai-tool-step-detail').getBoundingClientRect(),count=node.querySelector('.ai-tool-result-card-title').getBoundingClientRect();return{gap:count.left-query.right,dy:Math.abs(count.top-query.top)};});
 assert.ok(coords.gap<=8&&coords.gap>=0&&coords.dy<8,JSON.stringify(coords));
 await receipt.click();assert.ok(await panel.evaluate(node=>node.getAnimations().length>0));
 await receipt.click();assert.equal(await receipt.getAttribute('aria-expanded'),'false');
 await receipt.click();assert.equal(await receipt.getAttribute('aria-expanded'),'true');await page.waitForTimeout(190);assert.equal(await panel.isVisible(),true);
 await receipt.click();await panel.waitFor({state:'hidden'});assert.equal(await receipt.getAttribute('aria-expanded'),'false');
 await page.evaluate(()=>{document.documentElement.setAttribute('data-xtj-motion','off');});await receipt.click();assert.equal(await panel.evaluate(node=>node.getAnimations().length),0);
 await page.evaluate(()=>{emit({type:'done',content:'检索完成。',thinking_mode:'max',complete:true,saved:true});stream.close();});
});

test('a sanitized final answer keeps the existing prefix and reveals new text in reading order instead of flashing a full replacement',async t=>{
 const page=await fixture(t,'off');await page.locator('#aiChatMsgInput').fill('详细回答');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.stream);
 await page.evaluate(()=>emit({type:'content',text:'先到的正文。'}));await page.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble').textContent.includes('先到的正文。'));
 await page.evaluate(()=>{window.originalAnswerParagraph=document.querySelector('.ai-msg.assistant .ai-msg-bubble').firstElementChild;window.testFinalAnswer='先到的正文。\n\n'+('后续内容自然出现，保持从左到右的阅读顺序。'.repeat(18));emit({type:'done',content:'需要被替换的旧正文',sanitized_content:testFinalAnswer,complete:true,saved:true});stream.close();});
 await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
 const state=await page.locator('.ai-msg.assistant .ai-msg-bubble').evaluate(node=>{const runs=Array.from(node.querySelectorAll('.ai-stream-reveal'));return{prefix:node.firstElementChild===originalAnswerParagraph,text:node.textContent,starts:runs.map(run=>run.__aiRevealAt),tailOpacity:getComputedStyle(runs.at(-1)).opacity};});
 assert.equal(state.prefix,true);assert.equal(state.text,(await page.evaluate(()=>testFinalAnswer)).replace(/\n/g,''));assert.ok(state.starts.length>20);assert.ok(state.starts.every((x,i)=>i===0||x>state.starts[i-1]));assert.ok(Number(state.tailOpacity)<0.5,state.tailOpacity);
 await page.waitForFunction(()=>document.querySelectorAll('.ai-msg-bubble .ai-stream-reveal').length===0);assert.equal(await page.locator('.ai-msg.assistant .ai-msg-bubble').textContent(),(await page.evaluate(()=>testFinalAnswer)).replace(/\n/g,''));
});

test('plus menu removes quick commands and both model/effort popups provide a close button without changing the choice',async t=>{
 const page=await fixture(t);await page.locator('#aiPlusBtn').click();assert.equal(await page.locator('#aiQuickGrid,.ai-panel-group--quick').count(),0);assert.doesNotMatch(await page.locator('.ai-plus-panel-content').textContent(),/快捷指令/);
 for(const action of ['open-model','open-think']){
  const row=page.locator('[data-action="'+action+'"]');const before=await row.textContent();await row.click();const popup=page.locator('.ai-select-pop:not(.is-closing)');await popup.waitFor();const close=popup.getByRole('button',{name:'关闭',exact:true});assert.equal(await close.isVisible(),true);const size=await close.boundingBox();assert.ok(size.width>=44&&size.height>=44);
  await close.click();await popup.waitFor({state:'detached'});assert.equal(await row.textContent(),before);assert.equal(await row.evaluate(el=>el===document.activeElement),true);
 }
});
