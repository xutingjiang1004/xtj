'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require('playwright');
const { appendProcessEvent, getProcessEvents } = require('../render-api/ai-process-events');
const read = path => fs.readFileSync(path, 'utf8');
async function fixture(t, effort='max') {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox']}); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://process.test/**', route => route.fulfill({contentType:'text/html',body:'<div class="app-container"><div id="panelAiChat"></div><div id="panelDeepThink" class="hidden"><div id="dtMessages"></div><textarea id="dtInput"></textarea><button id="dtSendBtn"></button><button id="dtPauseBtn"></button><button id="dtNewBtn"></button><button id="dtDelBtn"></button></div></div>'}));
  await page.goto('https://process.test/');
  await page.addStyleTag({content:'.hidden {display:none!important}'});
  for (const file of ['css/ai-agent.css','css/ui-enhance.css']) await page.addStyleTag({content:read(file)});
  await page.evaluate(effort => {
    window.testEffort=effort;localStorage.setItem('xtj_ai_thinking_mode',effort);
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
      if (path.endsWith('/custom-models')) body={ok:true,models:[]};
      if (path.endsWith('/chat/conversations')) body=failHistoryList?{ok:false,error:'offline'}:{ok:true,conversations:[]};
      if (path.endsWith('/chat/history')) body=failDeepHistory&&String(url).includes('deep_think')?{ok:false,error:'offline'}:{ok:true,conversation_id:'test-cid',messages:[],has_more:false};
      if (path.endsWith('/chat/new')) {window.newCalls=(window.newCalls||0)+1;body={ok:true,conversation_id:'new-cid'};}
      if (path.endsWith('/chat/stream')) {
        window.sent = JSON.parse(options.body);
        return new Response(new ReadableStream({start(controller){window.stream=controller;}}),{headers:{'Content-Type':'text/event-stream'}});
      }
      return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    };
    window.emit = event => {frames.push(event);stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));};
  },effort);
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
  await page.locator('[data-tool-call-id="a"] .ai-tool-result-card').click();
  assert.equal(await page.locator('[data-tool-call-id="a"] .ai-search-detail').isVisible(),true);
  assert.equal(await page.locator('[data-tool-call-id="b"] .ai-search-detail').isVisible(),false);
  await page.locator('[data-tool-call-id="b"] .ai-tool-result-card').focus(); await page.keyboard.press('Enter');
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
