'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');
for(const [name,count] of [['text',0],['three original images',3]])test('phone: confirmed '+name+' fly from composer to the new post without changing the Dock',{timeout:45000},async()=>{
 const f=await postBrowserFixture({counts:[1]});try{
  const {page}=f;
  await page.route('**/test-supabase/storage/v1/object/public/uploads/**',r=>r.fulfill({body:f.png,contentType:'image/png'}));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{
   document.documentElement.setAttribute('data-xtj-motion','full');window.testMotionFrames=[];
   const capture=XtjPostPublishMotion.capture;XtjPostPublishMotion.capture=function(...args){const state=capture(...args);window.testMotionSources=state&&{items:state.items.map(i=>({...i.source,index:i.index})),text:state.text?.source};return state;};
   const play=XtjPostPublishMotion.play;XtjPostPublishMotion.play=function(...args){const result=play(...args);function frame(){const nodes=Array.from(document.querySelectorAll('.post-publish-flight'));testMotionFrames.push(nodes.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,src:e.src||null};}));if(nodes.length)requestAnimationFrame(frame);}requestAnimationFrame(frame);return result;};
   const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.testUrlsCreated=[];window.testUrlsRevoked=[];URL.createObjectURL=function(file){const u=create(file);testUrlsCreated.push(u);return u;};URL.revokeObjectURL=function(u){testUrlsRevoked.push(u);return revoke(u);};
  });
  const dock=await page.locator('#dockBar').evaluate(e=>[e.offsetWidth,e.offsetHeight,e.querySelectorAll('.dock-tab').length]);
  await page.locator('#postInp').fill('从编辑区发送到新帖子');
  if(count)await page.locator('#fileInp').setInputFiles(Array.from({length:count},(_,n)=>({name:n+'.png',mimeType:'image/png',buffer:f.png})));
  await page.locator('#pubBtn').click();await page.waitForFunction(()=>window.testMotionFrames.length>0);await page.waitForFunction(()=>document.querySelectorAll('.post-publish-flight').length===0&&testMotionFrames.length>2);
  const result=await page.evaluate(()=>({frames:testMotionFrames,sources:testMotionSources,created:testUrlsCreated,revoked:testUrlsRevoked,post:document.querySelector('#feed > .post').dataset.postId,images:Array.from(document.querySelectorAll('#feed > .post:first-child .post-media-cell img')).map(e=>({src:e.src,visible:getComputedStyle(e).visibility}))}));
  assert.equal(result.post,'8c1cb02d-74d0-4e45-9e15-000000009999');assert.ok(result.frames.length>=4);
  const first=result.frames.find(frame=>frame.length),last=result.frames.filter(frame=>frame.length).at(-1);assert.ok(first.length>0);
  if(count){assert.equal(result.sources.items.length,count);const initial=first.find(i=>i.src),final=last.find(i=>i.src);assert.ok(initial&&final);assert.ok(Math.abs(initial.top-result.sources.items[0].top)<45);assert.ok(Math.abs(initial.top-final.top)>10||Math.abs(initial.left-final.left)>10);assert.equal(result.images.length,3);assert.ok(result.images.every(i=>i.visible==='visible'));await page.waitForFunction(()=>testUrlsCreated.every(u=>testUrlsRevoked.includes(u)));}
  else{assert.ok(result.sources.text);assert.ok(Math.abs(first[0].top-result.sources.text.top)<45);assert.ok(Math.abs(last[0].top-first[0].top)>10);}
  assert.deepEqual(await page.locator('#dockBar').evaluate(e=>[e.offsetWidth,e.offsetHeight,e.querySelectorAll('.dock-tab').length]),dock);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('reduced motion and failed publishing keep the editing state and never create flight overlays',{timeout:45000},async()=>{
 const f=await postBrowserFixture({counts:[1]});try{const{page}=f;await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#postInp').fill('保留原文');f.setFailCreate(true);await page.locator('#pubBtn').click();await page.waitForFunction(()=>!document.getElementById('pubBtn').disabled);assert.equal(await page.locator('#postInp').inputValue(),'保留原文');assert.equal(await page.locator('.post-publish-flight').count(),0);f.setFailCreate(false);await page.locator('#pubBtn').click();await page.waitForFunction(()=>document.querySelector('#feed > .post').dataset.postId==='8c1cb02d-74d0-4e45-9e15-000000009999');assert.equal(await page.locator('.post-publish-flight').count(),0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
