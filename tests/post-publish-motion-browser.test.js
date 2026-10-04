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
   const play=XtjPostPublishMotion.play;XtjPostPublishMotion.play=function(...args){const result=play(...args);function frame(){const nodes=Array.from(document.querySelectorAll('.post-publish-flight'));testMotionFrames.push(nodes.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,src:e.querySelector('img')?.src||null};}));if(nodes.length)requestAnimationFrame(frame);}requestAnimationFrame(frame);return result;};
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

for (const [name,viewport,count,engine] of [
 ['portrait original',{width:390,height:844},1,'chromium'],
 ['three large originals',{width:1024,height:768},3,'chromium'],
 ...(process.env.XTJ_TEST_WEBKIT==='1'?[['WebKit portrait original',{width:390,height:844},1,'webkit']]:[])
]) test(name+': decoded previews follow a shared clock into stable targets and survive a slow server image', {timeout:45000}, async t => {
 const sharp=require('sharp');
 const original=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3200"><rect width="2400" height="3200" fill="#d5eae1"/><path d="M0 3200L1200 500L2400 3200" fill="#77ac99"/><circle cx="1850" cy="500" r="230" fill="#fff3d8"/></svg>')).jpeg({quality:95}).toBuffer();
 const f=await postBrowserFixture({counts:[3],viewport,engine});let releaseRemote;
 const remoteWait=new Promise(resolve=>releaseRemote=resolve);
 try {
  const {page}=f;
  await page.route('**/test-supabase/storage/v1/object/public/uploads/**',async route=>{await remoteWait;await route.fulfill({body:original,contentType:'image/jpeg'}).catch(()=>{});});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{
   document.documentElement.setAttribute('data-xtj-motion','full'); window.testMotionSamples=[];window.testUrlsCreated=[];window.testUrlsRevoked=[];
   const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
   URL.createObjectURL=file=>{const u=create(file);testUrlsCreated.push(u);return u};URL.revokeObjectURL=u=>{testUrlsRevoked.push(u);return revoke(u)};
   const capture=XtjPostPublishMotion.capture;XtjPostPublishMotion.capture=function(...args){const before=testUrlsCreated.length,state=capture(...args);window.testCapture={createdBefore:before,createdAfter:testUrlsCreated.length,borrowed:state.items.map(i=>window.testOriginalNodes.includes(i.image)),urls:state.items.map(i=>i.url)};return state};
   const play=XtjPostPublishMotion.play;XtjPostPublishMotion.play=function(state,post){const result=play(state,post);
    window.testCreatedAtPlay=testUrlsCreated.length;
    function frame(time){if(!window.testAnimationStarts)window.testAnimationStarts=state.animations.map(a=>a.startTime);const ghosts=Array.from(document.querySelectorAll('.post-publish-flight')).filter(e=>e.querySelector('img'));const targets=Array.from(post.querySelectorAll('.post-media-cell img'));
     testMotionSamples.push({time,targets:targets.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}}),ghosts:ghosts.map(e=>{const r=e.getBoundingClientRect(),a=new DOMMatrixReadOnly(getComputedStyle(e).transform),b=new DOMMatrixReadOnly(getComputedStyle(e.querySelector('img')).transform);return{x:r.x,y:r.y,w:r.width,h:r.height,sx:a.a*b.a,sy:a.d*b.d}})});
     if(ghosts.length)requestAnimationFrame(frame);
    }requestAnimationFrame(frame);return result;
   };
  });
  await page.locator('#postInp').fill('原图从发布位置流畅移入新帖子');
  await page.locator('#fileInp').setInputFiles(Array.from({length:count},(_,i)=>({name:'original-'+i+'.jpg',mimeType:'image/jpeg',buffer:original})));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#postMediaPreviewGrid img')).every(i=>i.complete&&i.naturalWidth===2400));
  await page.evaluate(()=>{window.testOriginalNodes=Array.from(document.querySelectorAll('#postMediaPreviewGrid img'))});
  await page.locator('#pubBtn').click();
  await page.waitForFunction(()=>window.testMotionSamples?.length>=3&&!document.querySelector('.post-publish-flight'));
  const result=await page.evaluate(()=>({capture:testCapture,starts:testAnimationStarts,createdAtPlay:testCreatedAtPlay,frames:testMotionSamples,revoked:testUrlsRevoked,
   images:Array.from(document.querySelectorAll('#feed > .post:first-child .post-media-cell img')).map(e=>({src:e.src,width:e.naturalWidth,complete:e.complete,visibility:getComputedStyle(e).visibility}))}));
  assert.equal(result.capture.borrowed.length,count);assert.ok(result.capture.borrowed.every(Boolean),'must reuse the original decoded DOM images');
  assert.equal(result.capture.createdAfter,result.capture.createdBefore);assert.equal(result.createdAtPlay,result.capture.createdBefore,'starting the transition must not create or decode new Blob URLs');
  assert.ok(result.starts.length>=2);assert.ok(result.starts.every(s=>typeof s==='number'&&s===result.starts[0]),'card, crop and picture flights must share one timeline');
  const moving=result.frames.filter(frame=>frame.ghosts.length);assert.ok(moving.length>=4);
  for(let i=0;i<count;i++){
   const positions=result.frames.map(frame=>frame.targets[i]);assert.ok(Math.max(...positions.map(p=>p.y))-Math.min(...positions.map(p=>p.y))<1,'the destination must stay still throughout the flight');
   assert.ok(moving.every(frame=>Math.abs(frame.ghosts[i].sx-frame.ghosts[i].sy)/Math.max(frame.ghosts[i].sx,frame.ghosts[i].sy)<.012),'single-picture crop must never stretch the original');
  }
  assert.ok(result.images.every(i=>i.src.startsWith('blob:')&&i.width===2400&&i.complete&&i.visibility==='visible'),'slow Storage downloads must not make the sent originals disappear');
  assert.ok(result.capture.urls.every(u=>!result.revoked.includes(u)),'original URLs stay alive until the remote handoff');
  const intervals=moving.slice(1).map((frame,i)=>frame.time-moving[i].time).sort((a,b)=>a-b);
  t.diagnostic(moving.length+' moving frames; median frame interval '+intervals[Math.floor(intervals.length/2)].toFixed(1)+'ms in '+engine);
  releaseRemote();
  await page.waitForFunction(()=>testUrlsCreated.every(u=>testUrlsRevoked.includes(u))&&Array.from(document.querySelectorAll('#feed > .post:first-child .post-media-cell img')).every(e=>!e.src.startsWith('blob:')&&e.complete&&e.naturalWidth===2400));
  assert.deepEqual(f.errors,[]);
 } finally {releaseRemote();await f.close()}
});

test('account change during a picture flight removes overlays and releases borrowed originals', {timeout:45000}, async()=>{
 const f=await postBrowserFixture({counts:[3]});
 try{const{page}=f;await page.route('**/test-supabase/storage/v1/object/public/uploads/**',r=>r.fulfill({body:f.png,contentType:'image/png'}));await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{document.documentElement.setAttribute('data-xtj-motion','full');const play=XtjPostPublishMotion.play;XtjPostPublishMotion.play=function(...args){const result=play(...args);window.__xtjBeginAuthIdentityChange();window.dispatchEvent(new Event('auth-ready'));window.testFlightAfterReset=document.querySelectorAll('.post-publish-flight').length;return result;};});
  await page.locator('#fileInp').setInputFiles({name:'original.png',mimeType:'image/png',buffer:f.png});await page.locator('#pubBtn').click();
  await page.waitForFunction(()=>window.testFlightAfterReset===0);assert.equal(await page.locator('.post-publish-flight').count(),0);assert.deepEqual(f.errors,[]);
 }finally{await f.close()}
});
