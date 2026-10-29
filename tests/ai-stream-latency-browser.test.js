'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
const emit=(page,event)=>page.evaluate(event=>aiPolishEmit(event),event);
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function send(page){await page.locator('#aiChatMsgInput').fill('核对以后再答复');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>aiPolish.streams.length===1);}

for(const mode of ['low','max'])test(mode+': empty and leading-whitespace content packets cannot hide the live thinking process',{timeout:30000},async t=>{
 const f=await aiPolishFixture();t.after(()=>f.close());const p=f.page;
 await p.locator('#aiPlusBtn').click();await p.locator('[data-action="open-think"]').click();await p.locator('#aiSelectPopup [data-value="'+mode+'"]').click();await p.locator('.ai-menu-close').click();
 await send(p);const thought=p.locator('.ai-msg.assistant .ai-thinking');
 await emit(p,{type:'content',text:''});await frames(p);
 assert.equal(await thought.count(),1,'an empty body packet removed immediate thinking feedback');
 await emit(p,{type:'reasoning',text:'真实思考首段。'});await frames(p);
 await emit(p,{type:'content',text:'  \n'});await frames(p);
 assert.equal(await thought.getAttribute('class').then(value=>value.includes('expanded')),false,'live reasoning stays collapsed until the reader opens it');
 assert.equal(await thought.getAttribute('class').then(value=>value.includes('is-thinking')),true);
 await emit(p,{type:'reasoning',text:'继续核对。'});await frames(p);
 assert.equal(await p.locator('.ai-reasoning-segment').textContent(),'真实思考首段。继续核对。');
 await emit(p,{type:'content',text:'正文保持原有顺序。'});await emit(p,{type:'done',complete:true,saved:true,content:'  \n正文保持原有顺序。',reasoning:'真实思考首段。继续核对。',thinking_elapsed_ms:100});
 await p.waitForFunction(()=>!document.querySelector('.ai-msg.assistant.generating'));assert.match(await p.locator('.ai-msg.assistant .ai-msg-bubble').textContent(),/正文保持原有顺序/);assert.deepEqual(f.errors,[]);
});

test('manual collapse remains respected when more reasoning packets arrive',{timeout:30000},async t=>{
 const f=await aiPolishFixture();t.after(()=>f.close());const p=f.page;await send(p);
 await emit(p,{type:'reasoning',text:'首段思考。'});await frames(p);
 const toggle=p.locator('.ai-thinking-toggle');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await emit(p,{type:'reasoning',text:'后续思考。'});await frames(p);
 assert.equal(await toggle.getAttribute('aria-expanded'),'false','a stream packet opened the panel against the collapsed default');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 assert.equal(await p.locator('.ai-reasoning-segment').textContent(),'首段思考。后续思考。');assert.deepEqual(f.errors,[]);
});

test('thinking deltas delivered in one browser packet are visible by the next display frame',{timeout:30000},async t=>{
 const f=await aiPolishFixture();t.after(()=>f.close());const p=f.page;await send(p);
 const expected='真实中文思考🐈，按到达顺序展示。'.repeat(300);
 await emit(p,{type:'reasoning',text:expected});await frames(p);
 assert.equal(await p.locator('.ai-reasoning-segment').textContent().then(value=>value.length),expected.length,'received reasoning is still waiting in an artificial typing queue');
 await emit(p,{type:'done',complete:true,saved:true,content:'已完成核对。',reasoning:expected});await p.waitForFunction(()=>!document.querySelector('.ai-msg.assistant.generating'));assert.deepEqual(f.errors,[]);
});

test('real thinking and answer streams show text immediately without an ink wash',{timeout:30000},async t=>{
 const f=await aiPolishFixture();t.after(()=>f.close());const p=f.page;
 await p.evaluate(()=>{
  document.documentElement.removeAttribute('data-perf');document.documentElement.removeAttribute('data-xtj-motion');
  window.inkSurfaces=[];const original=CSS.highlights.set.bind(CSS.highlights);
  CSS.highlights.set=function(name,highlight){
   if(name.startsWith('xtj-ai-ink-'))for(const range of highlight){
    const parent=range.startContainer.parentElement;
    inkSurfaces.push({thinking:!!parent.closest('.ai-reasoning-segment'),answer:!!parent.closest('.ai-msg-bubble')});
   }
   return original(name,highlight);
  };
 });
 await send(p);await emit(p,{type:'reasoning',text:'真实思考逐字柔和出现。'});await frames(p);
 assert.equal(await p.locator('.ai-reasoning-segment').textContent(),'真实思考逐字柔和出现。');
 await emit(p,{type:'content',text:'正文也按原有顺序柔和出现。'});await frames(p);
 assert.match(await p.locator('.ai-rail-sentence-text').textContent(),/正文也按原有顺序柔和出现。/);
 assert.equal(await p.evaluate(()=>!!document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('正文也按原有顺序柔和出现')), false);
 const surfaces=await p.evaluate(()=>inkSurfaces);assert.deepEqual(surfaces,[]);
 await emit(p,{type:'done',complete:true,saved:true,content:'正文也按原有顺序柔和出现。',reasoning:'真实思考逐字柔和出现。'});
 await p.waitForFunction(()=>!document.querySelector('.ai-msg.assistant.generating'));assert.deepEqual(f.errors,[]);
});

test('research thinking and report streams show text immediately without an ink wash',{timeout:45000},async t=>{
 const f=await aiPolishFixture();t.after(()=>f.close());const p=f.page;
 await p.evaluate(()=>{
  window.inkResearch=[];const original=CSS.highlights.set.bind(CSS.highlights);
  CSS.highlights.set=function(name,highlight){
   if(name.startsWith('xtj-ai-ink-'))for(const range of highlight){
    const parent=range.startContainer.parentElement;
    inkResearch.push({thinking:!!parent.closest('.ai-thought-chunk'),answer:!!parent.closest('.ai-think-answer')});
   }
   return original(name,highlight);
  };
 });
 await p.evaluate(()=>__xtjAiAgent.openDeepThink());await p.locator('#dtInput').fill('核对研究材料');await p.locator('#dtSendBtn').click();
 await p.waitForFunction(()=>aiPolish.streams.length===1);
 assert.match(await p.evaluate(()=>aiPolish.streams[0].path),/research\/stream$/);
 await emit(p,{type:'research_thinking',agent_role:'研究员',chunk:'逐项核实原始资料。'});await frames(p);
 await emit(p,{type:'research_content',content:'研究结论按顺序显示。'});await frames(p);
 assert.equal(await p.locator('.ai-thought-chunk').filter({hasText:'逐项核实原始资料。'}).count(),1);
 assert.match(await p.locator('.ai-think-answer').last().textContent(),/研究结论按顺序显示。/);
 const surfaces=await p.evaluate(()=>inkResearch);assert.deepEqual(surfaces,[]);
 await emit(p,{type:'research_done',answer:'研究结论按顺序显示。',conversation_id:'POLISH01',saved:true});
 await p.waitForFunction(()=>!document.querySelector('.ai-research-card.generating'));assert.deepEqual(f.errors,[]);
});
