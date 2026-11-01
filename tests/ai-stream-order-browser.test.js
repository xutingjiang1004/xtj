'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
async function emit(p,event){await p.evaluate(event=>aiPolishEmit(event),event);}
test('tool narration stays with the process while CJK paragraphs, a table and terminal reasoning retain their order',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('核对两个来源后给我一张对比表');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'先核实原始材料。'});await emit(p,{type:'content',text:'我先核对两个来源。'});
  // 2026-10-31：正文第一个字就直接进气泡；紧跟着出现工具调用时，这句话再收回时间轴当过渡句。
  await p.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('核对两个来源'));
  assert.equal(await p.evaluate(()=>!!document.querySelector('.ai-rail-beat.is-provisional')), false);
  await emit(p,{type:'tool_calls',tools:[{id:'verify-one',name:'search_web',args:{query:'原始来源'}}]});
  await p.waitForSelector('.ai-rail-sentence');
  assert.equal(await p.evaluate(()=>!!document.querySelector('.ai-msg.assistant .ai-msg-bubble:not(.ai-content-segment)')?.textContent.includes('核对两个来源')), false);
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
  await p.locator('#aiChatMsgInput').fill('带草稿时新对话要真的新建');await p.locator('.ai-chat-new-btn').click();await p.waitForFunction(()=>aiPolish.calls.some(x=>x.path.endsWith('/chat/new')));
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

test('new chat on an already empty conversation does not create another one, and a slow creation shows a busy state without piling up requests',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  const newCalls=()=>p.evaluate(()=>aiPolish.calls.filter(x=>x.path.endsWith('/chat/new')).length);
  await p.locator('.ai-chat-new-btn').click();await p.waitForTimeout(300);
  assert.equal(await newCalls(),0);assert.equal(await p.locator('#aiChatMsgInput').evaluate(n=>n===document.activeElement),true);
  // slow creation: busy state, extra clicks are acknowledged but do not send more requests
  await p.evaluate(()=>{const base=window.fetch;window.fetch=async(u,o)=>{if(String(u).includes('/chat/new')){await new Promise(r=>setTimeout(r,1500));}return base(u,o);};});
  await p.locator('#aiChatMsgInput').fill('草稿');await p.locator('.ai-chat-new-btn').click();
  await p.waitForSelector('.ai-chat-new-btn.is-busy');
  await p.locator('.ai-chat-new-btn').click();await p.locator('.ai-chat-new-btn').click();
  assert.equal(await p.locator('.ai-chat-new-btn').isDisabled(),false);
  await p.waitForFunction(()=>!document.querySelector('.ai-chat-new-btn.is-busy'));
  assert.equal(await newCalls(),1);assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('the answer enters the bubble on its first characters and no stray cursor is left between thinking and the bubble',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('老公好想你');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await p.evaluate(()=>{window.__seen={prov:false,cursorWithBubble:false};(function tick(){const m=document.querySelector('.ai-msg.assistant');if(m){if(m.querySelector('.ai-rail-beat.is-provisional'))__seen.prov=true;const b=m.querySelector('.ai-msg-bubble');if(b&&b.textContent.trim()&&m.querySelector('.ai-thinking-body .ai-stream-cursor'))__seen.cursorWithBubble=true;}requestAnimationFrame(tick);})();});
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'用户撒娇，简短回应。'});await p.waitForTimeout(100);
  await emit(p,{type:'content',text:'哟，'});await p.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('哟'),null,{timeout:1000});
  await emit(p,{type:'content',text:'一上来就发糖。'});await p.waitForTimeout(300);
  await emit(p,{type:'done',content:'哟，一上来就发糖。',reasoning:'用户撒娇，简短回应。',complete:true,saved:true,conversation_id:'CUR01',thinking_elapsed_ms:1000,thinking_mode:'max'});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
  const seen=await p.evaluate(()=>window.__seen);assert.equal(seen.prov,false);assert.equal(seen.cursorWithBubble,false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('web search rows never name the search vendor, and other tool rows expand by clicking what was called',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('福州天气');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'先查。'});await emit(p,{type:'content',text:'我查一下。'});
  await emit(p,{type:'tool_calls',tools:[{id:'w',name:'get_weather',args:{location:'福州'}},{id:'s',name:'search_web',args:{query:'福州旅游'}}]});
  await emit(p,{type:'tool_result',call_id:'w',tool_name:'get_weather',success:true,summary:'福州 · 晴 · 26°C',location:'福州'});
  await emit(p,{type:'card',card:{protocol:'xtj.ai.ui.v1',id:'cw',type:'weather',title:'天气',tool_call_id:'w',data:{city:'福州',condition:'晴',temperature_c:26}}});
  await emit(p,{type:'tool_result',call_id:'s',tool_name:'search_web',success:true,count:5,items:[{title:'a',url:'https://example.com/a'}],summary:'找到 5 个网页 · DeepSeek 官方搜索',provider:'DeepSeek'});
  await emit(p,{type:'content',text:'好了。'});await emit(p,{type:'done',content:'我查一下。好了。',complete:true,saved:true,conversation_id:'ROW01',thinking_elapsed_ms:1000,thinking_mode:'low'});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));await p.locator('.ai-thinking-toggle').first().click();await p.waitForSelector('.ai-process-rail .ai-tool-step');
  const text=await p.locator('.ai-process-rail').innerText();assert.doesNotMatch(text,/DeepSeek|Tavily|官方搜索/);assert.match(text,/找到 5 个网页/);assert.doesNotMatch(text,/查看数据/);
  const row=p.locator('.ai-process-rail [data-tool-call-id="w"] .ai-tool-step-detail');assert.equal(await p.locator('.ai-tool-card--weather').isVisible(),false);
  await row.click();assert.equal(await p.locator('.ai-tool-card--weather').isVisible(),true);await row.click();assert.equal(await p.locator('.ai-tool-card--weather').isVisible(),false);
  await row.focus();await p.keyboard.press('Enter');assert.equal(await p.locator('.ai-tool-card--weather').isVisible(),true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('site search results collapse into one row with a count and expand on click instead of filling the chat',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('搜我的聊天');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'站内搜索。'});await emit(p,{type:'content',text:'我搜一下。'});
  await emit(p,{type:'tool_calls',tools:[{id:'ss',name:'search_everything',args:{query:'喵喵喵'}}]});
  const results=Array.from({length:20},(_,i)=>({title:'小猫对话'+i,snippet:'喵喵喵 '+i,source:'ai_history',created_at:'2026-10-31T12:00:0'+(i%10)+'Z'}));
  await emit(p,{type:'tool_result',call_id:'ss',tool_name:'search_everything',success:true,summary:'已搜索站内',query:'喵喵喵'});
  await emit(p,{type:'card',card:{protocol:'xtj.ai.ui.v1',id:'site1',type:'search_results',title:'站内搜索结果',tool_call_id:'ss',data:{results}}});
  await emit(p,{type:'content',text:'找到了。'});await emit(p,{type:'done',content:'我搜一下。找到了。',complete:true,saved:true,conversation_id:'SITE01',thinking_elapsed_ms:1000,thinking_mode:'low'});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));await p.locator('.ai-thinking-toggle').first().click();await p.waitForSelector('.ai-process-rail .ai-tool-data-details');
  assert.match(await p.locator('.ai-process-rail .ai-tool-data-details > summary').innerText(),/找到 20 条站内结果/);
  assert.equal(await p.locator('.ai-tool-card--search_results').isVisible(),false);
  await p.locator('.ai-process-rail [data-tool-call-id="ss"] .ai-tool-step-detail').click();
  assert.equal(await p.locator('.ai-tool-card--search_results').isVisible(),true);
  await p.locator('.ai-process-rail [data-tool-call-id="ss"] .ai-tool-step-detail').click();assert.equal(await p.locator('.ai-tool-card--search_results').isVisible(),false);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('interrupting a reply with a new message leaves no empty bubble, and the continue button is a rounded rectangle',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('泰勒最新消息');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'reasoning_start'});await emit(p,{type:'reasoning',text:'先搜索。'});await emit(p,{type:'content',text:'我搜一下。'});
  await emit(p,{type:'tool_calls',tools:[{id:'s1',name:'search_web',args:{query:'Taylor Swift news'}}]});await p.waitForTimeout(300);
  await p.locator('#aiChatMsgInput').fill('换个问题');await p.locator('#aiChatSendBtn').click();await p.waitForSelector('.ai-msg.assistant .ai-continue-btn');
  const state=await p.evaluate(()=>{const n=document.querySelector('.ai-msg.assistant'),b=n.querySelector('.ai-msg-bubble:not(.ai-content-segment)'),btn=n.querySelector('.ai-continue-btn'),cs=getComputedStyle(btn),icon=getComputedStyle(n.querySelector('.ai-tool-step.is-error'),'::after');return{bubble:!!b&&getComputedStyle(b).display!=='none'&&b.getBoundingClientRect().height>0,radius:cs.borderTopLeftRadius,height:btn.getBoundingClientRect().height,iconBg:icon.backgroundColor};});
  assert.equal(state.bubble,false);assert.equal(state.radius,'12px');assert.ok(state.height>=36);assert.equal(state.iconBg,'rgba(0, 0, 0, 0)');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('a clarification card sends the chosen option as the next message, locks afterwards, and never overwrites a draft',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('帮我订个行程');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,{type:'tool_calls',tools:[{id:'ask1',name:'ask_user',args:{question:'去哪个城市？',options:['福州','厦门','泉州']}}]});
  await emit(p,{type:'tool_result',call_id:'ask1',tool_name:'ask_user',success:true,summary:'已向你确认'});
  await emit(p,{type:'card',card:{protocol:'xtj.ai.ui.v1',id:'clarify1',type:'clarify',title:'需要你确认',tool_call_id:'ask1',data:{question:'去哪个城市？',options:['福州','厦门','泉州']}}});
  await emit(p,{type:'content',text:'我需要确认一下目的地。'});await emit(p,{type:'done',content:'我需要确认一下目的地。',complete:true,saved:true,conversation_id:'CLR01',thinking_elapsed_ms:500,thinking_mode:'low'});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));await p.waitForSelector('.ai-clarify-card .ai-clarify-option');
  assert.equal(await p.locator('.ai-clarify-card .ai-clarify-option').count(),3);
  assert.match(await p.locator('.ai-clarify-question').textContent(),/去哪个城市/);
  // a draft in the composer is protected
  await p.locator('#aiChatMsgInput').fill('我正在写的内容');await p.locator('.ai-clarify-option').nth(1).click();
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'我正在写的内容');assert.equal(await p.evaluate(()=>aiPolish.streams.length),1);
  await p.locator('#aiChatMsgInput').fill('');await p.locator('.ai-clarify-option').nth(1).click();
  await p.waitForFunction(()=>aiPolish.streams.length===2);
  assert.equal(await p.evaluate(()=>aiPolish.streams[1].body.message),'厦门');
  assert.equal(await p.locator('.ai-clarify-option.is-chosen').textContent(),'厦门');
  assert.equal(await p.locator('.ai-clarify-option:not(:disabled)').count(),0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

const flights=p=>p.evaluate(()=>[...document.querySelectorAll('.ai-msg.user')].map(n=>n.getAnimations().filter(a=>!(a instanceof CSSAnimation)).map(a=>({keyframes:a.effect.getKeyframes().map(k=>k.transform),duration:a.effect.getTiming().duration}))));
test('a sent message flies from the composer to its place as one unit and ends at rest',{timeout:45000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('从输入框飞过来');await p.locator('#aiChatSendBtn').click();
  await p.waitForFunction(()=>document.querySelector('.ai-msg.user')?.getAnimations().some(a=>!(a instanceof CSSAnimation)));
  const [list]=await flights(p),flight=list[0];
  assert.match(flight.keyframes[0],/^translate\(-?[\d.]+px, [\d.]+px\) scale\(0?\.94\)$/);// starts below (the composer) and a little smaller
  assert.equal(flight.keyframes.at(-1),'translate(0px, 0px) scale(1)');assert.ok(flight.duration>=300&&flight.duration<=460,'duration '+flight.duration);
  assert.equal(await p.evaluate(()=>document.querySelector('.ai-msg.user').classList.contains('entering')),false);
  await p.waitForFunction(()=>document.querySelector('.ai-msg.user').getAnimations().every(a=>a instanceof CSSAnimation));
  assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.ai-msg.user')).transform),'none');
  const box=await p.locator('.ai-msg.user').boundingBox();assert.ok(box.y>=0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('reduced motion, regeneration-style sends and the continue button do not fly; a chosen clarification option flies from the option',{timeout:60000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.evaluate(()=>document.documentElement.setAttribute('data-xtj-motion','off'));
  await p.locator('#aiChatMsgInput').fill('减少动态效果');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);await p.waitForTimeout(150);
  assert.deepEqual((await flights(p))[0],[]);
  await p.evaluate(()=>document.documentElement.removeAttribute('data-xtj-motion'));
  await emit(p,{type:'content',text:'部分回答'});await p.locator('.ai-chat-pause').click();await p.waitForSelector('.ai-continue-btn');
  await p.locator('.ai-continue-btn').click();await p.waitForFunction(()=>aiPolish.streams.length===2);await p.waitForTimeout(200);
  assert.deepEqual((await flights(p)).at(-1),[],'the continue button must not fly from the composer');
  // a clarification option: the new message starts at the option, not at the composer
  await emit(p,{type:'card',card:{protocol:'xtj.ai.ui.v1',id:'c9',type:'clarify',title:'需要你确认',data:{question:'去哪？',options:['福州','厦门']}}});
  await emit(p,{type:'content',text:'请选择。'});await emit(p,{type:'done',content:'请选择。',complete:true,saved:true,conversation_id:'FLY01'});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));await p.waitForSelector('.ai-clarify-option');
  const before=await p.evaluate(()=>aiPolish.streams.length);await p.locator('.ai-clarify-option').first().click();await p.waitForFunction(n=>aiPolish.streams.length>n,before);
  await p.waitForFunction(()=>[...document.querySelectorAll('.ai-msg.user')].at(-1).getAnimations().some(a=>!(a instanceof CSSAnimation)));
  assert.equal((await flights(p)).at(-1).length,1);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
