'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
async function emit(p,event){await p.evaluate(event=>aiPolishEmit(event),event);}
test('tool narration stays with the process while CJK paragraphs, a table and terminal reasoning retain their order',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('核对两个来源后给我一张对比表');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'先核实原始材料。'});await emit(p,{type:'content',text:'我先核对两个来源。'});
  await p.waitForFunction(()=>document.querySelector('.ai-rail-sentence-text')?.textContent.includes('核对两个来源'));
  assert.equal(await p.evaluate(()=>!!document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('核对两个来源')), false);
  await emit(p,{type:'tool_calls',tools:[{id:'verify-one',name:'search_web',args:{query:'原始来源'}}]});
  await p.waitForSelector('.ai-rail-sentence');
  assert.equal(await p.locator('.ai-rail-sentence-text').textContent(),'我先核对两个来源。');
  assert.equal(await p.evaluate(()=>!!document.querySelector('.ai-rail-sentence')?.closest('.ai-thinking')), false);
  assert.equal(await p.locator('.ai-process-rail .ai-tool-step').count(),1);
  await emit(p,{type:'tool_result',call_id:'verify-one',tool_name:'search_web',success:true,count:2,summary:'已核对两个来源'});
  await emit(p,{type:'reasoning',text:'再对照不同统计口径。'});
  const prefix='第一段：已经核对原始材料。\n\n',tail='| 项目 | 结论 |\n| --- | --- |\n| 日期 | 一致 |\n\n最后一段：保留原文顺序。';
  await emit(p,{type:'content',text:prefix});await p.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble:not(.ai-content-segment) p')?.textContent==='第一段：已经核对原始材料。');
  await p.evaluate(()=>window.keptReplyParagraph=document.querySelector('.ai-msg.assistant .ai-msg-bubble:not(.ai-content-segment) p'));
  await emit(p,{type:'content',text:tail});await emit(p,{type:'done',content:prefix+tail,reasoning:'先核实原始材料。再对照不同统计口径。',thinking_elapsed_ms:1234,thinking_mode:'max',complete:true,saved:true,conversation_id:'POLISH01'});
  await p.waitForFunction(()=>{const n=document.querySelector('.ai-msg.assistant');return n&&!n.classList.contains('generating')&&n._msgRef;});
  const result=await p.evaluate(()=>{const n=document.querySelector('.ai-msg.assistant'),b=n.querySelector('.ai-msg-bubble:not(.ai-content-segment)');const sentence=n.querySelector('.ai-rail-sentence');sentence.click();return{stable:b.querySelector('p')===keptReplyParagraph,children:Array.from(b.children).filter(x=>!x.classList.contains('ai-stream-cursor')).map(x=>[x.tagName,x.textContent]),reasoning:n._msgRef.reasoning,time:n._msgRef.thinking_elapsed_ms,label:n.querySelector('.ai-thinking-label')?.textContent,narrationInsideThinking:!!n.querySelector('.ai-thinking .ai-content-segment'),step:n.querySelector('.ai-rail-reason')?.textContent,open:sentence.getAttribute('aria-expanded')};});
  assert.equal(result.stable,true);assert.deepEqual(result.children.map(x=>x[0]),['P','TABLE','P']);assert.match(result.children[2][1],/^最后一段/);assert.equal(result.reasoning,'先核实原始材料。再对照不同统计口径。');assert.equal(result.time,1234);assert.match(result.label,/已思考/);assert.equal(result.narrationInsideThinking,false);assert.match(result.step,/先核实原始材料/);assert.equal(result.open,'true');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('history, context, new chat and research header controls stay actionable through repeated menu transitions',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiPlusBtn').click();await p.locator('#aiPlusBtn').click();
  await p.locator('.ai-chat-hist-btn').click();await p.waitForSelector('.ai-conv-page-shell.is-open');await p.locator('.ai-conv-page-close').click();
  await p.locator('.ai-context-trigger').click();await p.locator('body > .ai-context-popup .ai-context-close').click();
  await p.locator('.ai-chat-new-btn').click();await p.waitForFunction(()=>aiPolish.calls.some(x=>x.path.endsWith('/chat/new')));
  await p.locator('.ai-deep-think-toggle').click();await p.waitForSelector('#panelDeepThink.active');await p.locator('#dtBackBtn').click();
  await p.waitForSelector('#aiChatMsgInput',{state:'visible'});await p.locator('#aiChatMsgInput').fill('顶栏操作之后仍可输入');assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'顶栏操作之后仍可输入');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('a short reply becomes a bubble while streaming and the folded thinking opens after the reply ends',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('你好');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'用户打招呼，直接回应。'});await emit(p,{type:'content',text:'嗯？憋不住了？'});
  await p.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('憋不住了'),null,{timeout:2000});
  assert.equal(await p.evaluate(()=>!!document.querySelector('.ai-msg.assistant .ai-rail-beat.is-provisional')),false);
  await emit(p,{type:'done',content:'嗯？憋不住了？',reasoning:'用户打招呼，直接回应。',thinking_elapsed_ms:2300,complete:true,saved:true,conversation_id:'SHORT01'});
  await p.waitForFunction(()=>{const n=document.querySelector('.ai-msg.assistant');return n&&!n.classList.contains('generating');});
  await p.locator('.ai-msg.assistant .ai-thinking-toggle').click();
  await p.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-thinking-panel')?.getBoundingClientRect().height>10);
  assert.match(await p.locator('.ai-msg.assistant .ai-thinking-body').textContent(),/用户打招呼/);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('reply long-press menu items share one flat list style instead of the global glass-pill buttons',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('你好');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'content',text:'行了。'});await emit(p,{type:'done',content:'行了。',complete:true,saved:true,conversation_id:'MENU01'});
  await p.waitForFunction(()=>{const n=document.querySelector('.ai-msg.assistant');return n&&!n.classList.contains('generating');});
  await p.locator('.ai-msg.assistant .ai-msg-bubble').last().dispatchEvent('contextmenu');await p.waitForSelector('.ai-copy-menu');
  const styles=await p.evaluate(()=>[...document.querySelectorAll('.ai-reply-menu-item')].map(x=>{const c=getComputedStyle(x);return[c.backgroundImage,c.backgroundColor,c.borderTopLeftRadius,c.flexDirection,x.offsetHeight].join('|');}));
  assert.ok(styles.length>=4);assert.equal(new Set(styles).size,1);assert.equal(styles[0],'none|rgba(0, 0, 0, 0)|10px|row|44');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('header buttons have 44px touch targets and delete lives only in the more menu',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  const sizes=await p.evaluate(()=>[...document.querySelectorAll('.ai-chat-header > button')].map(b=>{const r=b.getBoundingClientRect();return[b.className.split(' ')[0],Math.round(r.width),Math.round(r.height)];}));
  for(const [name,w,h] of sizes){if(name==='ai-deep-think-toggle'){assert.ok(h>=40);continue;}assert.ok(w>=44&&h>=44,name+' '+w+'x'+h);}
  assert.equal(await p.locator('.ai-chat-header .ai-chat-del-btn').count(),0);
  assert.equal(await p.locator('.ai-chat-more-menu').isVisible(),false);
  await p.locator('.ai-chat-more-btn').click();await p.waitForFunction(()=>document.querySelector('.ai-chat-more-menu')&&!document.querySelector('.ai-chat-more-menu').hidden);
  assert.equal(await p.locator('.ai-chat-more-btn').getAttribute('aria-expanded'),'true');
  assert.ok(await p.locator('.ai-chat-more-menu .ai-chat-del-btn').isVisible());
  await p.keyboard.press('Escape');await p.waitForFunction(()=>document.querySelector('.ai-chat-more-menu').hidden);
  await p.locator('.ai-chat-more-btn').click();await p.mouse.click(200,500);await p.waitForFunction(()=>document.querySelector('.ai-chat-more-menu').hidden);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('new chat during a streaming reply stops that reply and starts the new conversation',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('第一个问题');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'content',text:'部分回答'});await p.waitForSelector('.ai-msg.assistant .ai-msg-bubble');
  await p.locator('.ai-chat-new-btn').click();
  await p.waitForFunction(()=>aiPolish.calls.some(x=>x.path.endsWith('/chat/new')));
  await p.waitForFunction(()=>aiPolish.streams[0].cancelled===true||aiPolish.streams[0].signal?.aborted);
  await p.waitForFunction(()=>!document.querySelector('.ai-msg'));
  assert.equal(await p.locator('#aiChatSendBtn').isDisabled(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('search rows show the result count inline without an arrow, the query toggles the results, and the summary bar is hidden',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('搜索');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'先搜索。'});await emit(p,{type:'content',text:'我去搜一下。'});
  await emit(p,{type:'tool_calls',tools:[{id:'s1',name:'search_web',args:{query:'泰勒 最新消息'}}]});
  const items=Array.from({length:20},(_,i)=>({title:'标题'+i,url:'https://example.com/'+i,snippet:'摘要'+i}));
  await emit(p,{type:'tool_result',call_id:'s1',tool_name:'search_web',success:true,count:20,items});
  await emit(p,{type:'search',count:20,query:'泰勒',results:items});await emit(p,{type:'content',text:'搜完了。'});
  await emit(p,{type:'done',content:'我去搜一下。搜完了。',complete:true,saved:true,conversation_id:'SRCH01',thinking_elapsed_ms:2000,thinking_mode:'low'});
  await p.waitForFunction(()=>{const n=document.querySelector('.ai-msg.assistant');return n&&!n.classList.contains('generating');});
  await p.locator('.ai-thinking-toggle').first().click();await p.waitForSelector('.ai-process-rail .ai-tool-result-card-title');
  const state=()=>p.evaluate(()=>{const n=document.querySelector('.ai-msg.assistant'),b=n.querySelector('.ai-tool-result-card-title'),bar=n.querySelector('.ai-search-status');return{count:getComputedStyle(b).fontSize,arrow:getComputedStyle(b.querySelector('.ai-search-toggle')).display,text:b.textContent.replace(/[▸▾]/g,'').trim(),expanded:b.getAttribute('aria-expanded'),bar:bar?getComputedStyle(bar).display:'none',panelVisible:!n.querySelector('.ai-search-detail').hidden};});
  let s=await state();assert.equal(s.text,'找到 20 个网页');assert.notEqual(s.count,'0px');assert.equal(s.arrow,'none');assert.equal(s.bar,'none');assert.equal(s.expanded,'false');
  await p.locator('.ai-process-rail .ai-tool-step-detail').first().click();
  s=await state();assert.equal(s.expanded,'true');assert.equal(s.panelVisible,true);
  await p.locator('.ai-process-rail .ai-tool-step-detail').first().click();
  s=await state();assert.equal(s.expanded,'false');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
