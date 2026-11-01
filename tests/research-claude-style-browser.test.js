'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
const emit=(p,e)=>p.evaluate(e=>aiPolishEmit(e),e);
const sources=(domain,count)=>Array.from({length:count},(_,i)=>({title:domain+' 页面 '+i,url:'https://'+domain+'/p/'+i,snippet:'摘要'}));
const ALL=[...sources('dategom.com',7),...sources('en.wikipedia.org',7),...sources('thetvdb.com',5),...sources('www.joynews24.com',3)];
async function start(page,question='《末路兼职》结局与剧情解析'){
  await page.locator('.ai-deep-think-toggle').click();await page.waitForSelector('#panelDeepThink.active');
  await page.locator('#dtInput').fill(question);await page.locator('#dtSendBtn').click();await page.waitForFunction(()=>aiPolish.streams.length>=1);
}
test('a research run shows a compact card with sources and time, and opens a sheet with the timeline and main sources',{timeout:60000},async()=>{
  const f=await aiPolishFixture(),p=f.page;
  try{
    // the strength/model controls are collapsed into one summary line
    await p.locator('.ai-deep-think-toggle').click();await p.waitForSelector('#panelDeepThink.active');
    assert.match(await p.locator('.dt-research-options-label').textContent(),/深度 · /);
    assert.equal(await p.locator('.dt-research-model-select').isVisible(),false);
    await p.locator('.dt-research-options-toggle').click();assert.equal(await p.locator('.dt-research-model-select').isVisible(),true);
    await p.locator('.dt-research-options-toggle').click();await p.waitForFunction(()=>getComputedStyle(document.querySelector('.dt-research-options-pop')).visibility==='hidden');assert.equal(await p.locator('.dt-research-model-select').isVisible(),false);
    await p.locator('#dtInput').fill('《末路兼职》结局与剧情解析');await p.locator('#dtSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length>=1);
    await emit(p,{type:'research_stage',stage:'rewrite',message:'正在优化研究问题…'});
    await emit(p,{type:'research_stage',stage:'rewrite_done',message:'任务已拆解'});await emit(p,{type:'research_stage',stage:'collect',message:'并行研究中'});
    await emit(p,{type:'research_sources',sources:ALL});
    await p.waitForFunction(()=>/22 个来源/.test(document.querySelector('.ai-rc-meta-line')?.textContent||''));
    assert.match(await p.locator('.ai-rc-intro').textContent(),/正在启动深入研究[\s\S]*我先启动深入研究/);
    assert.equal(await p.locator('.ai-rc-topic').textContent(),'《末路兼职》结局与剧情解析');
    assert.equal(await p.locator('.ai-rc-favs .ai-rc-fav').count(),3);
    assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.ai-research-card .ai-research-particles')).display),'none');
    assert.equal(await p.evaluate(()=>document.querySelector('.ai-rc').getAttribute('data-rc-state')),'running');
    await p.locator('.ai-research-header').click();await p.waitForSelector('.ai-rs-overlay.is-open');
    const state=await p.evaluate(()=>({title:document.querySelector('.ai-rs-title').textContent,steps:[...document.querySelectorAll('.ai-rs-step')].map(s=>[s.className.replace('ai-rs-step ',''),s.querySelector('.ai-rs-step-text').textContent]),domains:[...document.querySelectorAll('.ai-rs-domain')].map(r=>[r.querySelector('.ai-rs-domain-name').textContent,r.querySelector('.ai-rs-domain-count').textContent,r.querySelector('.ai-rs-domain-bar').style.width]),zOverlay:Number(getComputedStyle(document.querySelector('.ai-rs-overlay')).zIndex),zPanel:Number(getComputedStyle(document.getElementById('panelDeepThink')).zIndex),stop:!!document.querySelector('.ai-rs-actions .ai-research-stop')}));
    assert.equal(state.title,'《末路兼职》结局与剧情解析');
    assert.deepEqual(state.steps.map(s=>s[0]),['is-done','is-active']);assert.equal(state.steps[0][1],'研究计划已创建');assert.equal(state.steps[1][1],'已收集 22 个来源，仍在继续…');
    assert.deepEqual(state.domains.map(d=>d.slice(0,2)),[['dategom.com','7'],['en.wikipedia.org','7'],['thetvdb.com','5'],['joynews24.com','3']]);
    assert.equal(state.domains[0][2],'100%');assert.ok(parseInt(state.domains[3][2])<50);
    assert.ok(state.zOverlay>state.zPanel,'the sheet must sit above the research page');assert.equal(state.stop,true);
    // a live update reaches the open sheet
    await emit(p,{type:'research_sources',sources:[...ALL,...sources('example.org',4)]});
    await p.waitForFunction(()=>/26 个来源/.test(document.querySelector('.ai-rs-step.is-active .ai-rs-step-text')?.textContent||''));
    // every source link is a safe external link
    await p.locator('.ai-rs-all > summary').click();
    const links=await p.evaluate(()=>[...document.querySelectorAll('.ai-rs-all-item a')].map(a=>[a.href.startsWith('https://'),a.rel,a.target]));
    assert.ok(links.length>=20);assert.ok(links.every(l=>l[0]&&/noopener/.test(l[1])&&l[2]==='_blank'));
    await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.ai-rs-overlay'));
    assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('ai-research-header')),true);
    assert.equal(await p.evaluate(()=>document.body.classList.contains('xtj-rs-open')),false);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('a finished report sits under the card without an inline source list, and the source button reopens the sheet with a finished timeline',{timeout:60000},async()=>{
  const f=await aiPolishFixture(),p=f.page;
  try{
    await start(p);
    await emit(p,{type:'research_stage',stage:'collect',message:'并行研究中'});await emit(p,{type:'research_sources',sources:ALL});
    await emit(p,{type:'research_stage',stage:'synthesize',message:'正在综合生成中文报告…'});
    const report='## 《末路兼职》结局解析\n\n第二季已确认续订。\n\n- 要点一\n- 要点二';
    await emit(p,{type:'research_content',content:report});await emit(p,{type:'research_done',answer:report,sources:ALL,message_id:'m1',conversation_id:'RCS1',saved:true});
    await p.waitForFunction(()=>document.querySelector('.ai-rc')?.getAttribute('data-rc-state')==='done');
    assert.equal(await p.locator('.ai-rc-topic').textContent(),'《末路兼职》结局解析');
    assert.match(await p.locator('.ai-rc-meta-line').textContent(),/^22 个来源/);
    assert.equal(await p.locator('.ai-think-answer').isVisible(),true);assert.match(await p.locator('.ai-think-answer').textContent(),/第二季已确认续订/);
    assert.equal(await p.locator('.ai-tavily-sources').count(),0);
    // actions are rounded rectangles, never inline capsules
    const radii=await p.evaluate(()=>[...document.querySelectorAll('.ai-rc .ai-msg-footer button')].map(b=>[b.textContent,getComputedStyle(b).borderTopLeftRadius,b.getAttribute('style')]));
    assert.ok(radii.length>=3);for(const [text,radius,inline] of radii){assert.ok(parseFloat(radius)<=12,text+' '+radius);assert.equal(inline,null,text+' keeps no inline style');}
    await p.locator('.ai-rc-sources-btn').click();await p.waitForSelector('.ai-rs-overlay.is-open');
    const steps=await p.evaluate(()=>[...document.querySelectorAll('.ai-rs-step')].map(s=>[s.classList.contains('is-done'),s.querySelector('.ai-rs-step-text').textContent]));
    assert.deepEqual(steps.map(s=>s[1]).slice(0,3),['研究计划已创建','已收集 22 个来源','报告已生成']);assert.ok(steps.every(s=>s[0]));assert.match(steps.at(-1)[1],/^研究完成/);
    assert.equal(await p.locator('.ai-rs-actions .ai-research-stop').isVisible(),false);// nothing left to stop
    await p.locator('.ai-rs-close').click();await p.waitForFunction(()=>!document.querySelector('.ai-rs-overlay'));
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('a failed run keeps a retry on the card and marks the last timeline step as failed',{timeout:60000},async()=>{
  const f=await aiPolishFixture(),p=f.page;
  try{
    await start(p);await emit(p,{type:'research_stage',stage:'collect',message:'并行研究中'});await emit(p,{type:'research_sources',sources:ALL.slice(0,6)});
    await emit(p,{type:'error',error:'quota_exceeded',code:'quota_exceeded',message:'今日研究次数已达上限'});
    await p.waitForFunction(()=>document.querySelector('.ai-rc')?.getAttribute('data-rc-state')==='failed');
    assert.equal(await p.locator('.ai-rc .ai-research-retry').isVisible(),true);
    await p.locator('.ai-research-header').click();await p.waitForSelector('.ai-rs-overlay.is-open');
    const last=await p.evaluate(()=>{const s=[...document.querySelectorAll('.ai-rs-step')].at(-1);return [s.className,s.querySelector('.ai-rs-step-text').textContent];});
    assert.match(last[0],/is-error/);assert.ok(last[1].length>0);
    assert.equal(await p.evaluate(()=>document.querySelector('.ai-rs-step.is-active')),null);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('reduced motion removes the sheet and dot animations, and dragging the handle down closes the sheet on phones',{timeout:60000},async()=>{
  const f=await aiPolishFixture(),p=f.page;
  try{
    await p.evaluate(()=>document.documentElement.setAttribute('data-xtj-motion','off'));
    await start(p);await emit(p,{type:'research_sources',sources:ALL.slice(0,5)});await p.waitForSelector('.ai-rc-wait',{state:'attached'});
    assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.ai-rc-wait i')).animationName),'none');
    await p.locator('.ai-research-header').click();await p.waitForSelector('.ai-rs-overlay.is-open');
    assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.ai-rs-sheet')).transitionDuration),'0s');
    await p.evaluate(()=>document.documentElement.removeAttribute('data-xtj-motion'));
    const box=await p.locator('.ai-rs-handle').boundingBox();
    await p.mouse.move(box.x+box.width/2,box.y+4);await p.mouse.down();await p.mouse.move(box.x+box.width/2,box.y+160,{steps:6});await p.mouse.up();
    await p.waitForFunction(()=>!document.querySelector('.ai-rs-overlay'));
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('a research report restored from history shows the same card with its topic, sources and sheet',{timeout:60000},async()=>{
  const f=await aiPolishFixture({history:[
    {role:'user',content:'《末路兼职》结局与剧情解析',created_at:'2026-10-30T10:00:00Z',id:'u1'},
    {role:'assistant',deep_think:true,is_research:true,research_query:'《末路兼职》结局与剧情解析',research_sources:ALL,think_duration_ms:130000,created_at:'2026-10-30T10:02:10Z',id:'a1',content:'## 结局解析\n\n第二季已确认续订。'}
  ]}),p=f.page;
  try{
    await p.evaluate(()=>__xtjAiAgent.openConversation('RESEARCH01','deep_think'));await p.waitForSelector('#panelDeepThink.active');
    await p.waitForSelector('.ai-research-card.ai-rc');
    assert.equal(await p.locator('.ai-rc-topic').first().textContent(),'结局解析');
    assert.match(await p.locator('.ai-rc-meta-line').first().textContent(),/^22 个来源 · 2分10秒$/);
    assert.equal(await p.locator('.ai-rc').first().locator('.ai-rc-fav').count(),3);
    assert.match(await p.locator('.ai-think-answer').first().textContent(),/第二季已确认续订/);
    await p.locator('.ai-rc-sources-btn').first().click();await p.waitForSelector('.ai-rs-overlay.is-open');
    assert.equal(await p.locator('.ai-rs-domain').count(),4);assert.equal(await p.locator('.ai-rs-step.is-done').count(),await p.locator('.ai-rs-step').count());
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('live activity: searches and pages show on the card without opening the sheet, keep the latest 4, and collapse when the report starts',{timeout:60000},async()=>{
  const f=await aiPolishFixture(),p=f.page;
  try{
    await start(p);
    await emit(p,{type:'research_stage',stage:'collect',message:'并行研究中'});
    await emit(p,{type:'research_activity',kind:'search',text:'末路兼职 结局 解析',role:'剧情'});
    await emit(p,{type:'research_activity',kind:'read',host:'en.wikipedia.org',url:'https://en.wikipedia.org/wiki/X',title:'末路兼职 - 维基百科',role:'剧情'});
    await p.waitForFunction(()=>document.querySelectorAll('.ai-rc-live-item').length===2);
    const rows=await p.evaluate(()=>[...document.querySelectorAll('.ai-rc-live-item')].map(li=>[li.className,li.querySelector('.ai-rc-live-verb').textContent,li.querySelector('.ai-rc-live-main').textContent]));
    assert.deepEqual(rows.map(r=>r.slice(1)),[['搜索','末路兼职 结局 解析'],['读取','末路兼职 - 维基百科']]);
    assert.match(rows[1][0],/is-active/);assert.doesNotMatch(rows[0][0],/is-active/);
    assert.equal(await p.locator('.ai-rc-live').isVisible(),true);assert.equal(await p.locator('.ai-rs-overlay').count(),0);
    // duplicates are ignored; only the newest four stay
    await emit(p,{type:'research_activity',kind:'search',text:'末路兼职 结局 解析'});
    for(const t of ['第二季 续订','演员 采访','收视率','导演 访谈'])await emit(p,{type:'research_activity',kind:'search',text:t});
    await p.waitForFunction(()=>document.querySelectorAll('.ai-rc-live-item:not(.is-leaving)').length===4&&document.querySelectorAll('.ai-rc-live-item').length<=5);
    await p.waitForFunction(()=>document.querySelectorAll('.ai-rc-live-item').length===4);
    assert.equal(await p.evaluate(()=>[...document.querySelectorAll('.ai-rc-live-main')].pop().textContent),'导演 访谈');
    // unsafe or odd input is rendered as text only
    await emit(p,{type:'research_activity',kind:'search',text:'<img src=x onerror=alert(1)>'});
    assert.equal(await p.locator('.ai-rc-live img').count(),0);
    await emit(p,{type:'research_stage',stage:'synthesize',message:'正在综合生成中文报告…'});await emit(p,{type:'research_content',content:'## 结论\n\n正文'});
    await p.waitForFunction(()=>!document.querySelector('.ai-rc-live'));
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('the strength and model chooser is a floating panel that closes by itself after a pick, outside click or Escape, and the old research board is gone',{timeout:60000},async()=>{
  const f=await aiPolishFixture(),p=f.page;
  try{
    await p.locator('.ai-deep-think-toggle').click();await p.waitForSelector('#panelDeepThink.active');
    const open=()=>p.locator('.dt-research-options').evaluate(n=>n.classList.contains('is-open'));
    const before=await p.locator('#dtInput').boundingBox();
    await p.locator('.dt-research-options-toggle').click();assert.equal(await open(),true);
    assert.equal(await p.locator('.dt-research-mode-bar').isVisible(),true);
    const after=await p.locator('#dtInput').boundingBox();assert.equal(after.y,before.y,'opening must not push the input');
    await p.locator('.dt-research-mode-opt').first().click();
    await p.waitForFunction(()=>!document.querySelector('.dt-research-options').classList.contains('is-open'));
    assert.match(await p.locator('.dt-research-options-label').textContent(),/快速 · /);
    assert.equal(await p.locator('.dt-research-options-toggle').getAttribute('aria-expanded'),'false');
    await p.locator('.dt-research-options-toggle').click();assert.equal(await open(),true);
    await p.locator('.dt-research-model-select').selectOption('flash');
    await p.waitForFunction(()=>!document.querySelector('.dt-research-options').classList.contains('is-open'));
    assert.match(await p.locator('.dt-research-options-label').textContent(),/Flash/);
    await p.locator('.dt-research-options-toggle').click();assert.equal(await open(),true);
    await p.mouse.click(40,300);await p.waitForFunction(()=>!document.querySelector('.dt-research-options').classList.contains('is-open'));
    await p.locator('.dt-research-options-toggle').click();assert.equal(await open(),true);
    await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.dt-research-options').classList.contains('is-open'));
    // a research run never renders the old board, even when the server sends it
    await p.locator('.dt-research-options-toggle').click();await p.locator('.dt-research-mode-opt').nth(1).click();await p.waitForFunction(()=>!document.querySelector('.dt-research-options').classList.contains('is-open'));
    await p.locator('#dtInput').fill('测试深入研究看板是否出现');await p.locator('#dtSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length>=1);
    await emit(p,{type:'research_board',directions:[{id:'a',role:'方向一',status:'running'}],search_calls:2,usage:{}});
    await emit(p,{type:'research_sources',sources:ALL.slice(0,3)});
    await p.waitForFunction(()=>/3 个来源/.test(document.querySelector('.ai-rc-meta-line')?.textContent||''));
    assert.equal(await p.locator('.ai-research-board').count(),0);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('a rate-limit or busy 429 on the research route is explained honestly and never shown as an exhausted quota or a dropped connection',{timeout:60000},async()=>{
  for(const [status,body,expected] of [[429,{error:'请求过于频繁，请稍后再试',code:'RATE_LIMITED',retry_after:45},/请求过于频繁/],[429,{error:'已有进行中的 AI 请求，请等它完成后再发下一条',code:'ai_concurrent_limit',retry_after:5},/仍在进行中/]]){
    const f=await aiPolishFixture(),p=f.page;
    try{
      await p.locator('.ai-deep-think-toggle').click();await p.waitForSelector('#panelDeepThink.active');
      await p.evaluate(([status,body])=>{const base=window.fetch;window.fetch=async(url,opts={})=>{if(new URL(url,location.href).pathname.endsWith('/research/stream')){window.__researchHits=(window.__researchHits||0)+1;return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}return base(url,opts);};},[status,body]);
      await p.locator('#dtInput').fill('测试额度提示是否如实显示');await p.locator('#dtSendBtn').click();
      await p.waitForFunction(()=>document.querySelector('.ai-rc')?.getAttribute('data-rc-state')==='failed');
      const meta=await p.locator('.ai-rc-meta-line').textContent();
      assert.match(meta,expected);assert.doesNotMatch(meta,/额度已达上限|开通 Pro|连接中断/);
      assert.equal(await p.evaluate(()=>window.__researchHits),1,'a 429 must not trigger the legacy deep-think fallback');
      assert.equal(await p.evaluate(()=>aiPolish.streams.length),0,'no second request is made');
    }finally{await f.close();}
  }
});
