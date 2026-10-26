'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
const context=require('../render-api/ai-context-window');
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const emit=(p,event)=>p.evaluate(event=>aiPolishEmit(event),event);
for(const [width,height,theme] of [[320,568,'light'],[390,844,'dark'],[820,1180,'light']])test(width+'px context ring stays inside the text field before the microphone without taking another row',{timeout:30000},async()=>{
 const f=await aiPolishFixture({viewport:{width,height},theme}),p=f.page;
 try{
  const geometry=await p.evaluate(()=>{const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};return{field:box(document.getElementById('aiChatMsgInput')),ring:box(document.querySelector('.ai-context-trigger')),mic:box(document.getElementById('aiChatVoiceBtn')),bar:box(document.getElementById('aiChatInputBar')),parent:document.getElementById('aiContextCapacity').parentNode.className};});
  assert.equal(geometry.parent,'ai-chat-input-field');assert.ok(geometry.ring.x>=geometry.field.x&&geometry.ring.x+geometry.ring.w<=geometry.field.x+geometry.field.w+1);assert.ok(geometry.ring.x+geometry.ring.w<geometry.mic.x);assert.ok(geometry.bar.h<90,JSON.stringify(geometry));
  await p.locator('.ai-context-trigger').click();const popup=p.locator('body > .ai-context-popup');await popup.waitFor({state:'visible'});const b=await popup.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width&&b.y>=0&&b.y+b.height<=geometry.bar.y+1);await p.keyboard.press('Escape');assert.equal(await p.locator('.ai-context-trigger').evaluate(n=>n===document.activeElement),true);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('real prompt compaction has a persistent receipt even when progress and completion arrive together',{timeout:45000},async()=>{
 const history=Array.from({length:6},(_,i)=>({id:'old-'+i,role:i%2?'assistant':'user',content:(i===0?'必须保留原图，预算200元。\n':'')+'真实研究资料。'.repeat(1000)}));
 const f=await aiPolishFixture({history}),p=f.page;
 try{
  await p.locator('#aiChatMsgInput').fill('继续研究');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const request=await p.evaluate(()=>aiPolish.streams[0].body),cid=request.conversation_id||'POLISH01';
  const prepared=context.prepareContext({history:request.messages,fixed:[{role:'system',content:'真实规则'},{role:'user',content:request.message}],conversationId:cid,windowTokens:request.context_window_tokens});
  assert.ok(prepared.budget.saved_tokens>0);assert.ok(prepared.messages.length<request.messages.length);assert.match(prepared.memory.summary,/必须保留原图/);
  await p.evaluate(({cid,prepared})=>{for(const event of [{type:'context_status',stage:'compacting'},{type:'meta',conversation_id:cid,context_budget:prepared.budget,context_memory:prepared.memory},{type:'context_status',stage:'compressed',receipt:prepared.budget.last_compaction},{type:'done',conversation_id:cid,content:'已按原要求继续。',complete:true,saved:true,context_budget:prepared.budget,context_memory:prepared.memory}])aiPolishEmit(event);},{cid,prepared});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.assistant.generating'));
  await p.locator('#aiChatMsgInput').fill('下一次的草稿');assert.equal(await p.locator('#aiContextCapacity').getAttribute('data-status'),'compressed');
  await p.locator('.ai-context-trigger').click();const receipt=p.locator('.ai-context-receipt');await receipt.waitFor({state:'visible'});const text=await receipt.textContent();assert.ok(text.includes(prepared.budget.previous_estimated_tokens.toLocaleString()));assert.ok(text.includes(prepared.budget.estimated_tokens.toLocaleString()));assert.match(text,/提取摘要/);await p.keyboard.press('Escape');
  await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===2);const next=await p.evaluate(()=>aiPolish.streams[1].body);assert.deepEqual(next.context_memory.last_compaction,prepared.memory.last_compaction);
  const reused=context.prepareContext({history:next.messages,fixed:[{role:'system',content:'真实规则'},{role:'user',content:next.message}],conversationId:cid,memory:next.context_memory});assert.equal(reused.budget.compressed_this_request,0);assert.equal(reused.budget.compaction_status,'summary_reused');
  await emit(p,{type:'done',content:'继续完成。',conversation_id:cid,complete:true,saved:true,context_budget:reused.budget,context_memory:reused.memory});await p.waitForFunction(()=>!document.querySelector('.ai-msg.assistant.generating'));
  await p.locator('.ai-chat-new-btn').click();await p.waitForFunction(()=>document.querySelector('#aiContextCapacity').dataset.status!=='compressed');await p.locator('.ai-context-trigger').click();assert.equal(await p.locator('.ai-context-receipt').isVisible(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('a delayed optional quota refresh cannot delay dispatch or the first real reasoning packet',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.evaluate(()=>{const previous=fetch,realNow=Date.now;Date.now=()=>realNow()+121000;window.fetch=(url,opts)=>new URL(url,location.href).pathname.endsWith('/quota')?new Promise(resolve=>{window.releaseDelayedQuota=()=>resolve(new Response(JSON.stringify({ok:true,quota:{can_chat:true,tokens_remaining:100000,can_search:true,search_remaining:10}}),{headers:{'Content-Type':'application/json'}}));}):previous(url,opts);document.getElementById('aiChatMsgInput').value='直接显示收到的思考';document.getElementById('aiChatSendBtn').click();});
  await p.waitForFunction(()=>aiPolish.streams.length===1);assert.equal(await p.evaluate(()=>typeof releaseDelayedQuota),'function');
  await frames(p);const label=p.locator('.ai-msg.assistant .ai-thinking-label');assert.match(await label.textContent(),/等待模型/);assert.equal(await label.isVisible(),true);
  await emit(p,{type:'reasoning_start',early:true,phase:'preparing'});assert.equal(await p.locator('.ai-msg.assistant .ai-thinking.is-thinking').count(),0);
  await emit(p,{type:'reasoning',text:'真实思考首段。'});await frames(p);assert.equal(await p.locator('.ai-reasoning-segment').textContent(),'真实思考首段。');assert.match(await label.textContent(),/正在思考/);
  await p.evaluate(()=>releaseDelayedQuota());await emit(p,{type:'done',content:'实际回复。',reasoning:'真实思考首段。',thinking_elapsed_ms:10,thinking_mode:'max',complete:true,saved:true});assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for(const touch of [false,true])test((touch?'touch':'pointer')+' thinking detents preview horizontally and apply one model-native effort at release',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiPlusBtn').click();await p.locator('[data-action="open-think"]').click();const rail=p.locator('.ai-thinking-rail');assert.equal(await rail.getAttribute('aria-orientation'),'horizontal');
  const [a,b]=await p.evaluate(()=>['max','low'].map(value=>{const r=document.querySelector('[role="option"][data-value="'+value+'"]').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));assert.ok(Math.abs(a.y-b.y)<2);
  const from={x:a.x+a.width/2,y:a.y+a.height/2},to={x:b.x+b.width/2,y:b.y+b.height/2};
  if(touch){const cdp=await p.context().newCDPSession(p);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});for(const [type,point] of [['touchStart',from],['touchMove',{x:(from.x+to.x)/2,y:from.y}],['touchMove',to],['touchEnd',null]]){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1}]:[]});await frames(p);}await cdp.detach();}
  else{await p.mouse.move(from.x,from.y);await p.mouse.down();await p.mouse.move(to.x,to.y,{steps:6});await frames(p);assert.equal(await p.locator('#aiThinkSummary').textContent(),'极致');await p.mouse.up();}
  await p.locator('#aiSelectPopup').waitFor({state:'detached'});assert.equal(await p.locator('#aiThinkSummary').textContent(),'轻度');assert.equal(await p.evaluate(()=>localStorage.getItem('xtj_ai_thinking_mode')),'low');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
