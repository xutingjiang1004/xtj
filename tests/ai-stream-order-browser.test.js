'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
async function emit(p,event){await p.evaluate(event=>aiPolishEmit(event),event);}
test('tool narration stays with the process while CJK paragraphs, a table and terminal reasoning retain their order',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('核对两个来源后给我一张对比表');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'先核实原始材料。'});await emit(p,{type:'content',text:'我先核对两个来源。'});
  await p.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('核对两个来源'));
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
