'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');
async function fixture(options={}) {
  const f=await postBrowserFixture({counts:[1],publicPosts:true,...options});
  await f.page.addStyleTag({path:path.resolve('css/ai-reading.css')});await f.page.addScriptTag({path:path.resolve('js/ai-core/reading-tools.js')});
  await f.page.evaluate(()=>{
    const host=document.createElement('section');host.id='readingTestHost';host.style.cssText='position:fixed;inset:12px 10px auto;max-width:650px;height:calc(100dvh - 24px);display:flex;flex-direction:column;z-index:9500;background:var(--bg-color,#fff);border:1px solid #cee3d6;overflow:hidden';
    const list=document.createElement('div');list.id='readingTestList';list.style.cssText='overflow:auto;min-height:0;flex:1;padding:8px;overflow-anchor:none';const input=document.createElement('textarea');input.id='readingTestInput';input.setAttribute('aria-label','阅读测试输入');input.style.cssText='flex:0 0 56px;min-height:56px;max-height:56px';host.append(list,input);document.body.append(host);
    window.readingCurrent=true;window.readingRenders=[];window.readingMessages=Array.from({length:120},(_,i)=>({id:'real-'+i,role:i%2?'assistant':'user',content:'第 '+i+' 条真实历史。\n'+('这一段实际文字用于检查可见性、选择和复制。\n'.repeat(8))}));
    window.readingFactory=(msg,index)=>{readingRenders.push(index);const root=document.createElement('article');root.className='readingActualMessage';root.dataset.messageId=msg.id;const body=document.createElement('div');body.className='ai-msg-bubble';body.style.cssText='white-space:pre-wrap;min-height:150px;padding:12px';body.textContent=msg.content;const action=document.createElement('button');action.textContent='操作 '+index;root.append(body,action);return root;};
    window.openReading=(key='local-session')=>window.reading=XtjAiCore.ReadingTools.create({container:list,scrollBox:list,owner:'alice-account',key,current:()=>readingCurrent,renderMessage:readingFactory,input,viewportHost:host});
    openReading();readingMessages.forEach((msg,i)=>list.append(reading.makeMessage(msg,i,readingMessages.length)));reading.refresh();
  });
  await f.page.waitForTimeout(120);
  return f;
}
test('factory history parses only nearby messages, preserves all authoritative data, and restores on scroll',async()=>{
  const f=await fixture();try{
    const initial=await f.page.evaluate(()=>({rendered:document.querySelectorAll('.readingActualMessage').length,calls:readingRenders.length,messages:readingMessages.length}));assert.ok(initial.rendered<20);assert.equal(initial.messages,120);
    await f.page.evaluate(()=>{const list=document.querySelector('#readingTestList');list.scrollTop=list.scrollHeight;reading.refresh();});await f.page.waitForTimeout(150);const end=await f.page.evaluate(()=>({rendered:document.querySelectorAll('.readingActualMessage').length,last:!!document.querySelector('[data-message-id="real-119"]'),first:!!document.querySelector('[data-message-id="real-0"]')}));assert.equal(end.last,true);assert.equal(end.first,false);assert.ok(end.rendered<20);
    const full=await f.page.evaluate(()=>reading.getFullText(document.querySelectorAll('.ai-reading-shell')[0]));assert.match(full,/第 0 条真实历史/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('focused and selected messages stay intact; full-history selection restores lazy messages before copy',async()=>{
  const f=await fixture();try{
    await f.page.getByRole('button',{name:'操作 0',exact:true}).focus();await f.page.evaluate(()=>{readingTestList.scrollTop=readingTestList.scrollHeight;reading.refresh();});await f.page.waitForTimeout(100);assert.equal(await f.page.locator('[data-message-id="real-0"]').count(),1);
    await f.page.evaluate(()=>{readingTestInput.focus();readingTestList.scrollTop=0;reading.refresh();});await f.page.waitForTimeout(100);await f.page.evaluate(()=>{const node=document.querySelector('[data-message-id="real-0"] .ai-msg-bubble');const selection=getSelection(),range=document.createRange();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);readingTestList.scrollTop=readingTestList.scrollHeight;reading.refresh();});await f.page.waitForTimeout(100);assert.equal(await f.page.locator('[data-message-id="real-0"]').count(),1);
    await f.page.evaluate(()=>{getSelection().removeAllRanges();const list=readingTestList;list.tabIndex=0;list.focus();});await f.page.keyboard.press('Control+A');assert.equal(await f.page.locator('.readingActualMessage').count(),120);const selected=await f.page.evaluate(()=>getSelection().toString());assert.match(selected,/第 0 条真实历史/);assert.match(selected,/第 119 条真实历史/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('reading position is tied to authenticated owner, session and real message, not stale absolute pixels',async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>{readingTestList.scrollTop=11000;reading.refresh();});await f.page.waitForTimeout(100);const saved=await f.page.evaluate(()=>{reading.remember();return JSON.parse(localStorage.getItem(XtjAiCore.ReadingTools.positionKey('alice-account','local-session')));});assert.ok(saved.anchor.id.includes('real-'));assert.equal(saved.owner,'alice-account');
    const result=await f.page.evaluate(async()=>{reading.dispose();readingTestList.replaceChildren();openReading();readingMessages.forEach((msg,i)=>readingTestList.append(reading.makeMessage(msg,i,readingMessages.length)));readingTestList.scrollTop=0;return reading.restore();});assert.equal(result,true);const after=await f.page.evaluate(()=>{const key=JSON.parse(localStorage.getItem(XtjAiCore.ReadingTools.positionKey('alice-account','local-session'))).anchor.id;const node=Array.from(readingTestList.children).find(n=>n.dataset.readingId===key);return {offset:node.getBoundingClientRect().top-readingTestList.getBoundingClientRect().top};});assert.ok(Math.abs(after.offset-saved.anchor.offset)<5);
    const missing=await f.page.evaluate(async()=>{reading.dispose();readingTestList.replaceChildren();openReading();const msg={id:'new-unrelated-id',role:'assistant',content:'新会话内容'};readingTestList.append(reading.makeMessage(msg,0,1));readingTestList.scrollTop=0;return reading.restore();});assert.equal(missing,false);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('track unloads only heavy historical body and restores interactive turn shell without losing buttons',async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>{reading.dispose();readingTestList.replaceChildren();openReading('tracked');for(let i=0;i<50;i++){const msg={id:'tracked-'+i,role:'assistant',content:'真实长正文 '+i},node=readingFactory(msg,i);readingTestList.append(node);reading.track(node,msg,{heavyNode:node.querySelector('.ai-msg-bubble')});}readingTestList.scrollTop=readingTestList.scrollHeight;reading.refresh();});await f.page.waitForTimeout(120);
    assert.equal(await f.page.locator('[data-message-id="tracked-0"] > button').count(),1);assert.equal(await f.page.locator('[data-message-id="tracked-0"] .ai-reading-placeholder').count(),1);
    await f.page.evaluate(()=>{readingTestList.scrollTop=0;reading.refresh();});await f.page.waitForTimeout(120);assert.equal(await f.page.locator('[data-message-id="tracked-0"] .ai-reading-placeholder').count(),0);assert.match(await f.page.locator('[data-message-id="tracked-0"] .ai-msg-bubble').textContent(),/真实长正文 0/);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('report directory uses actual nested headings and retains full authoritative report for export',async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>{reading.dispose();readingTestList.replaceChildren();openReading('report');const outer=document.createElement('article'),nested=document.createElement('div'),content=document.createElement('div');outer.id='actualReport';content.id='actualReportContent';for(let i=0;i<6;i++){const h=document.createElement(i?'h2':'h1');h.textContent='真实章节 '+i;const p=document.createElement('p');p.style.cssText='height:230px';p.textContent='实际报告内容 '+i;content.append(h,p);}nested.append(content);outer.append(nested);readingTestList.append(outer);reading.track(outer,{id:'report-turn',role:'assistant',content:'完整报告权威文字'}, {heavyNode:content,pin:true});reading.decorateReport({node:outer,contentEl:content,text:'完整报告权威文字，复制与导出不能遗漏屏外章节。'});});
    await f.page.locator('.ai-reading-toc summary').click();assert.equal(await f.page.getByRole('navigation',{name:'报告目录',exact:true}).getByRole('button').count(),6);await f.page.getByRole('button',{name:'真实章节 4',exact:true}).click();await f.page.waitForTimeout(350);assert.ok(await f.page.evaluate(()=>readingTestList.scrollTop)>600);assert.equal(await f.page.evaluate(()=>document.activeElement.textContent),'真实章节 4');assert.match(await f.page.evaluate(()=>reading.getFullText(actualReport)),/不能遗漏/);assert.equal(await f.page.locator('#actualReportContent h2').count(),5);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('compressed visual viewport constrains only AI host without changing Dock or stealing composer focus',async()=>{
  const f=await fixture();try{
    const before=await f.page.evaluate(()=>({dock:document.querySelector('.dock')?.getAttribute('style')||'',focus:document.activeElement.id}));
    await f.page.evaluate(()=>{reading.dispose();const viewport=new EventTarget();Object.assign(viewport,{height:340,width:390,offsetTop:12});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});openReading('viewport');viewport.dispatchEvent(new Event('resize'));});await f.page.waitForTimeout(50);
    const after=await f.page.evaluate(()=>({dock:document.querySelector('.dock')?.getAttribute('style')||'',focus:document.activeElement.id,rect:readingTestHost.getBoundingClientRect().toJSON(),height:getComputedStyle(readingTestHost).maxHeight}));assert.equal(after.dock,before.dock);assert.equal(after.focus,before.focus);assert.ok(after.rect.height<=342);assert.equal(after.height,'340px');assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('account disposal invalidates queued restore/observers and removes the private reading anchor',async()=>{
  const f=await fixture();try{
    const result=await f.page.evaluate(async()=>{reading.remember();const key=XtjAiCore.ReadingTools.positionKey('alice-account','local-session');const pending=reading.restore();readingCurrent=false;window.dispatchEvent(new Event('xtj:auth-changed'));return {restored:await pending,anchor:localStorage.getItem(key),text:reading.getFullText(readingTestList.firstElementChild)};});assert.deepEqual(result,{restored:false,anchor:null,text:''});assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
