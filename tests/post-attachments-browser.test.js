'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
for(const [name,viewport] of [['390px',{width:390,height:844}],['desktop',{width:1280,height:900}]])for(const theme of ['light','dark']){
 test(`${name} ${theme}: real homepage grids, full Detail, ordered viewer and existing interactions`,{timeout:60000},async()=>{
  const f=await postBrowserFixture({viewport,theme});try{
   const {page}=f;const dockBefore=await page.locator('#dockBar').evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,buttons:el.querySelectorAll('.dock-tab').length}));
   for(const [n,post] of f.posts.entries()){
    const card=page.locator(`#feed .post[data-post-id="${post.id}"]`);await card.scrollIntoViewIfNeeded();
    assert.equal(await card.locator('.post-media-cell').count(),Math.min(post.media_items.length,9));
    const grid=card.locator('.post-media-grid'),box=await grid.boundingBox();assert.ok(box.width<=560.1&&box.width>200);
    const cols=await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(cols,post.media_items.length===2||post.media_items.length===4?2:3);
    assert.equal(await card.evaluate(el=>getComputedStyle(el).borderRadius),'0px');
    if(post.media_items.length>9)assert.equal(await card.locator('.post-media-overflow').textContent(),'+'+(post.media_items.length-9));
    await card.locator('.content').click();
    if(post.media_items.length<=9){assert.equal(await page.locator('#postDetailModal').evaluate(el=>el.classList.contains('active')),false);continue;}
    await page.waitForFunction(id=>window.__xtjPostDetailSnapshot?.id===id,post.id);
    assert.equal(await page.locator('#postDetailBody .post-media-cell').count(),post.media_items.length);
    await page.evaluate(()=>closeModal('postDetailModal'));await page.waitForFunction(()=>!document.getElementById('postDetailModal').classList.contains('active'));
   }
   const post=f.posts.find(p=>p.media_items.length===15),card=page.locator(`#feed .post[data-post-id="${post.id}"]`);await card.scrollIntoViewIfNeeded();
   await card.locator('.post-media-cell').nth(3).click();await page.waitForFunction(()=>document.getElementById('photoPreviewOverlay')?.classList.contains('active')&&window.photoPreviewCurrent?.__xtjMediaIndex===3);
   assert.equal(await page.evaluate(()=>window.__xtjPreviewExplicitPhotos.length),15);
   await page.evaluate(()=>ppNextPhoto());await page.waitForFunction(()=>window.photoPreviewCurrent?.__xtjMediaIndex===4);
   await page.evaluate(()=>ppPrevPhoto());await page.waitForFunction(()=>window.photoPreviewCurrent?.__xtjMediaIndex===3);
   await page.waitForTimeout(500);assert.equal(await page.locator('#ppDeleteBtn').getAttribute('aria-label'),'删除帖子');
   await page.evaluate(()=>closePhotoPreview());await page.waitForFunction(()=>!document.getElementById('photoPreviewOverlay').classList.contains('active'));
   const first=f.posts[0],firstCard=page.locator(`#feed .post[data-post-id="${first.id}"]`);await firstCard.scrollIntoViewIfNeeded();
   assert.equal(await firstCard.locator('[data-comment-id]').count(),3);await firstCard.getByRole('button',{name:'查看全部 6 条评论'}).click();await page.waitForFunction(()=>document.querySelectorAll('#feed .post:first-child [data-comment-id]').length===6);assert.equal(await page.locator('#postDetailModal').evaluate(el=>el.classList.contains('active')),false);await page.evaluate(id=>openPostDetail(id),first.id);await page.waitForFunction(()=>document.querySelectorAll('#postDetailBody [data-comment-id]').length===6);
   await page.locator('#postDetailBody .like-btn').click();await page.waitForFunction(()=>document.querySelector('#postDetailBody .like-btn').getAttribute('aria-busy')!=='true');assert.equal(await page.locator('#postDetailBody .like-btn').getAttribute('aria-pressed'),'true');
   await page.locator('#postDetailBody').getByRole('button',{name:'评论',exact:true}).click();await page.locator('#postDetailBody .inline-comment-inp').fill('详情发表评论');await page.locator('#postDetailBody .inline-comment-inp').press('Enter');await page.waitForFunction(()=>document.querySelector('#postDetailBody .comments')?.textContent.includes('详情发表评论'));
   assert.equal(await page.locator('#postDetailBody [data-comment-id]').count(),7);
   await page.evaluate(id=>__xtjApplyPostDetailComment('INSERT',{id:'realtime-ai',post_id:id,user_name:'cat_ai',generated_by_ai:true,parent_comment_id:'33333333-3333-4333-8333-000000000001',content:'Realtime 小猫回复'}),first.id);assert.ok((await page.locator('#postDetailBody .comments').textContent()).includes('Realtime 小猫回复'));
   await page.evaluate(id=>__xtjMergePostDetailComments(id,[{id:'polled-ai',post_id:id,user_name:'cat_ai',generated_by_ai:true,parent_comment_id:'33333333-3333-4333-8333-000000000001',content:'轮询恢复的小猫回复'}]),first.id);assert.ok((await page.locator('#postDetailBody .comments').textContent()).includes('轮询恢复的小猫回复'));
   assert.deepEqual(await page.locator('#dockBar').evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,buttons:el.querySelectorAll('.dock-tab').length})),dockBefore);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
 });
}
test('real composer appends, removes, rejects mixing; upload/create failures retain draft and clean all paths; retry succeeds',{timeout:60000},async()=>{
 const f=await postBrowserFixture({counts:[2]});try{
  const {page}=f;await page.evaluate(()=>{window.revokedPostUrls=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(url){revokedPostUrls.push(url);return revoke.call(URL,url);};});
  const images=[0,1,2,3,4].map(n=>({name:`original-${n}.png`,mimeType:'image/png',buffer:f.png}));
  await page.locator('#fileInp').setInputFiles(images.slice(0,2));await page.locator('#fileInp').setInputFiles(images.slice(2));assert.equal(await page.evaluate(()=>selectedPostMedia.length),5);
  await page.locator('#postMediaPreviewGrid .post-media-remove').nth(1).click();assert.deepEqual(await page.evaluate(()=>selectedPostMedia.map(f=>f.name)),['original-0.png','original-2.png','original-3.png','original-4.png']);
  await page.locator('#fileInp').setInputFiles({name:'video.mp4',mimeType:'video/mp4',buffer:Buffer.from('fake-video')});assert.equal(await page.evaluate(()=>selectedPostMedia.length),4);
  await page.locator('#postInp').fill('发布失败也要保留我的正文');f.setFailUploadAt(2);await page.locator('#pubBtn').click();await page.waitForFunction(()=>!document.getElementById('pubBtn').disabled);
  assert.equal(f.calls.filter(c=>c.path==='/api/post/create').length,0);assert.equal(f.uploads.size,0);assert.equal(await page.evaluate(()=>selectedPostMedia.length),4);assert.equal(await page.locator('#postInp').inputValue(),'发布失败也要保留我的正文');
  f.setFailUploadAt(0);f.setFailCreate(true);await page.locator('#pubBtn').click();await page.waitForFunction(()=>!document.getElementById('pubBtn').disabled);
  assert.equal(f.uploads.size,0);assert.equal(await page.evaluate(()=>selectedPostMedia.length),4);assert.ok(f.calls.some(c=>c.path==='/api/post/create'));
  f.setFailCreate(false);await page.locator('#pubBtn').click();await page.waitForFunction(()=>!document.getElementById('pubBtn').disabled&&selectedPostMedia.length===0);
  const created=f.getCreated();assert.equal(created.attachments.length,4);assert.deepEqual(created.attachments.map(a=>a.position),[0,1,2,3]);assert.equal(new Set(created.attachments.map(a=>a.upload_id)).size,4);assert.equal(new Set(created.attachments.map(a=>a.storage_path)).size,4);assert.ok(created.attachments.every(a=>a.width===1&&a.height===1));assert.equal(created.media_type,'album');
  assert.equal(await page.locator('#postInp').inputValue(),'');assert.equal(await page.locator(`#feed .post[data-post-id="${created.id}"] .post-media-cell`).count(),4);assert.ok(await page.evaluate(()=>revokedPostUrls.length>=9));assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('delayed image decoding reserves grid heights and does not move the next post', {timeout:30000}, async()=>{
 const f=await postBrowserFixture({holdImages:true,counts:[2,4,15]});try{
  const page=f.page;await page.waitForFunction(()=>getComputedStyle(document.querySelector('#feed .post-media-grid')).display==='grid');
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
  const before=await page.locator('#feed .post-media-grid').evaluateAll(nodes=>nodes.map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));
  assert.ok(before.every(box=>box.height>0));f.releaseImages();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#feed .post-media-grid img')).filter(el=>el.loading!=='lazy'||el.getBoundingClientRect().top<innerHeight).every(el=>el.complete&&el.naturalWidth>0));
  const after=await page.locator('#feed .post-media-grid').evaluateAll(nodes=>nodes.map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})));
  before.forEach((box,index)=>{assert.ok(Math.abs(box.height-after[index].height)<.5);assert.ok(Math.abs(box.top-after[index].top)<.5);});
 }finally{f.releaseImages();await f.close();}
});
for(const kind of ['video','audio'])test(`real composer keeps ${kind} to one file and publishes through the existing single-media path`,{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[2]});try{
  const {page}=f,payload={name:kind+'.mp4',mimeType:kind+'/mp4',buffer:Buffer.from('test-only-media')};
  await page.locator('#fileInp').setInputFiles(payload);assert.equal(await page.evaluate(()=>selectedPostMedia.length),1);
  await page.locator('#fileInp').setInputFiles({...payload,name:'second-'+kind+'.mp4'});assert.equal(await page.evaluate(()=>selectedPostMedia.length),1);
  await page.locator('#postInp').fill('单个'+kind);await page.locator('#pubBtn').click();await page.waitForFunction(()=>!document.getElementById('pubBtn').disabled&&selectedPostMedia.length===0);
  assert.equal(f.getCreated().media_type,kind);assert.equal(f.getCreated().attachments,undefined);assert.ok(f.getCreated().media_upload_id);assert.ok(f.getCreated().media_storage_path);assert.equal(f.uploads.size,1);
 }finally{await f.close();}
});

test('Linux WebKit tablet viewport: original gallery opens, switches and closes', {skip:!process.env.XTJ_TEST_WEBKIT,timeout:60000}, async()=>{
 const f=await postBrowserFixture({engine:'webkit',viewport:{width:820,height:1180},counts:[2,4,15]});try{
  const {page}=f;await page.locator('#feed .post-media-cell').first().click();await page.waitForFunction(()=>document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
  await page.evaluate(()=>ppNextPhoto());await page.waitForFunction(()=>window.photoPreviewCurrent?.__xtjMediaIndex===1);await page.evaluate(()=>closePhotoPreview());await page.waitForFunction(()=>!document.getElementById('photoPreviewOverlay').classList.contains('active'));assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const source of ['detail','gallery'])test(`deleting from ${source} removes the whole post and closes stale Detail content`, {timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[15]});try{
  const {page}=f,id=f.posts[0].id;await page.locator('#feed .content').click();await page.waitForFunction(()=>document.querySelector('#postDetailBody .post-media-cell'));
  if(source==='gallery'){
    await page.locator('#postDetailBody .post-media-cell').nth(2).click();await page.waitForFunction(()=>window.photoPreviewCurrent?.__xtjMediaIndex===2);await page.waitForTimeout(500);
    assert.equal(await page.locator('#ppDeleteBtn').getAttribute('aria-label'),'删除帖子');await page.locator('#ppDeleteBtn').click();
  }else await page.locator('#postDetailBody .action-btn.del').click();
  await page.locator('#delBtn').click();await page.waitForFunction(id=>!document.querySelector(`#feed .post[data-post-id="${id}"]`),id);
  assert.equal(await page.locator('#postDetailModal').evaluate(el=>el.classList.contains('active')),false);assert.equal(await page.locator('#postDetailBody').textContent(),'');assert.equal(f.calls.filter(c=>c.path==='/api/post/delete').length,1);assert.equal(f.calls.find(c=>c.path==='/api/post/delete').body.post_id,id);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});


test('opening a wall photo after a post gallery restores the wall delete semantics', {timeout:30000}, async()=>{
 const f=await postBrowserFixture({counts:[2]});try{
  const {page}=f;await page.locator('#feed .post-media-cell').first().click();await page.waitForFunction(()=>document.getElementById('ppDeleteBtn')?.__xtjPostDeleteBound);
  await page.evaluate(()=>closePhotoPreview());await page.waitForFunction(()=>!document.getElementById('photoPreviewOverlay').classList.contains('active'));
  await page.evaluate(()=>{window.wallDeleteCalls=0;window.deletePhotoFromPreview=()=>{window.wallDeleteCalls++;};openPhotoPreview(0,{photos:[{id:'wall-photo',username:'alice',imageUrl:document.querySelector('#feed .post-media-cell img').src,timestamp:Date.now(),views:2}]});});
  await page.waitForFunction(()=>document.getElementById('photoPreviewOverlay').classList.contains('active')&&document.getElementById('ppDeleteBtn').getAttribute('aria-label')==='删除');
  await page.locator('#ppDeleteBtn').click();assert.equal(await page.evaluate(()=>wallDeleteCalls),1);assert.equal(f.calls.filter(c=>c.path==='/api/post/delete').length,0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('portrait originals fill their own Feed frame and scale to the gallery viewport without stretching',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1,3]});try{
  const {page}=f;
  const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#8bbcab"/></svg>');
  await page.evaluate(src=>{const img=document.querySelector('#feed .post-media-grid--single img');img.src=src;img.setAttribute('data-src',src);},src);
  await page.waitForFunction(()=>document.querySelector('#feed .post-media-grid--single img').naturalHeight===400);
  const frame=await page.locator('#feed .post-media-grid--single .post-media-cell').boundingBox();assert.ok(Math.abs(frame.width/frame.height-.75)<.01);
  await page.evaluate(src=>{openPhotoPreview(0,{photos:[{id:'ratio-check',imageUrl:src,thumbUrl:src,username:'alice'}]});},src);
  await page.waitForFunction(()=>document.getElementById('photoPreviewImage')?.naturalHeight===400&&parseFloat(getComputedStyle(document.getElementById('photoPreviewImage')).opacity)===1);
  const image=await page.locator('#photoPreviewImage').boundingBox();assert.ok(Math.abs(image.width/image.height-.75)<.01);assert.ok(image.width>=389&&image.height<=844);
  assert.equal(await page.locator('#photoPreviewImage').evaluate(img=>img.parentElement.querySelector('.pp-image-loading').hidden),true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('tablet keyboard preserves desktop media rules until the keyboard closes; page gesture guard allows photo zoom',{timeout:30000},async()=>{
 const f=await postBrowserFixture({viewport:{width:1024,height:768},ios:'ipad-desktop',counts:[1]});try{
  const {page}=f;await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{const match=window.matchMedia.bind(window);window.matchMedia=q=>q==='(pointer:coarse)'?{matches:true}:match(q);document.getElementById('postInp').focus();});
  await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-tablet-layout'));
  await page.setViewportSize({width:1024,height:350});
  assert.equal(await page.locator('#dockBar').isVisible(),false);
  assert.equal(await page.locator('link[href*="desktop.min.css"]').getAttribute('media'),'(min-width:768px)');
  await page.evaluate(()=>document.activeElement.blur());await page.waitForTimeout(150);
  assert.equal(await page.locator('#dockBar').isVisible(),false);
  await page.setViewportSize({width:1024,height:768});assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('xtj-tablet-layout')),true);
  assert.equal(await page.locator('link[href*="desktop.min.css"]').getAttribute('media'),'(min-width:768px)');
  const gestures=await page.evaluate(()=>{function probe(el){const event=new Event('gesturestart',{bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented;}const blocked=probe(document.body);const viewer=document.getElementById('photoPreviewOverlay');viewer.classList.add('active');const own=probe(viewer);viewer.classList.remove('active');return{blocked,own};});assert.deepEqual(gestures,{blocked:true,own:false});
 }finally{await f.close();}
});

test('new wall upload shows the original local File while the server image is pending and switches after decode',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]});let release;try{
  const {page}=f;await page.addScriptTag({path:'js/photo-wall/render.js'});const pending=new Promise(resolve=>release=resolve);
  await page.route('**/new-wall-original.svg',async route=>{await pending;await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#84c2aa"/></svg>'});});
  await page.evaluate(async()=>{
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#84c2aa"/></svg>';
   const file=new File([svg],'original.svg',{type:'image/svg+xml'});
   const photo={id:'instant-upload',imageUrl:location.origin+'/new-wall-original.svg',username:'alice',timestamp:Date.now(),width:300,height:400};
   photoWallData=[photo];registerRecentlyUploadedPhoto(photo,file);renderPhotoWallWithoutReload();
  });
  const img=page.locator('#photoGrid img[data-recent-upload-id="instant-upload"]');await page.waitForFunction(()=>document.querySelector('#photoGrid img[data-recent-upload-id]')?.naturalHeight===400);
  assert.match(await img.getAttribute('src'),/^blob:/);assert.equal(await img.getAttribute('data-src'),null);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('auth-ready')));assert.match(await img.getAttribute('src'),/^blob:/,'same-user token refresh keeps local image');
  release();await page.waitForFunction(()=>{const img=document.querySelector('#photoGrid img');return img?.src.endsWith('/new-wall-original.svg')&&!img.hasAttribute('data-recent-upload-id')&&img.naturalHeight===400;});assert.deepEqual(f.errors,[]);
 }finally{if(release)release();await f.close();}
});

test('gallery uses a small botanical loading indicator only while the original image is pending',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3],holdImages:true});try{
  const {page}=f;page.setDefaultTimeout(6000);await page.locator('#feed .post-media-cell').first().click();
  await page.waitForFunction(()=>document.getElementById('photoPreviewImage')?.parentElement.querySelector('.pp-image-loading:not([hidden])'));
  assert.equal(await page.locator('.pp-slide-slot:has(#photoPreviewImage) .pp-image-loading svg').count(),1);
  assert.equal(await page.locator('.pp-slide-slot:has(#photoPreviewImage)').evaluate(el=>getComputedStyle(el,'::before').content),'none');
  f.releaseImages();await page.waitForFunction(()=>document.getElementById('photoPreviewImage')?.naturalWidth>0&&document.getElementById('photoPreviewImage').parentElement.querySelector('.pp-image-loading').hidden);
  assert.deepEqual(f.errors,[]);
 }finally{f.releaseImages();await f.close();}
});

test('the gallery still pinches the photo in and out while the page scale remains unchanged',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]});try{
  const {page}=f;await page.locator('#feed .post-media-cell').click();await page.waitForFunction(()=>document.getElementById('photoPreviewImage')?.naturalWidth>0);
  await page.evaluate(()=>{
   window.testPhotoPointer=function(type,id,x){document.getElementById('photoPreviewImage').dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:x,clientY:400,buttons:type==='pointerup'?0:1}));};
   testPhotoPointer('pointerdown',1,120);testPhotoPointer('pointerdown',2,220);testPhotoPointer('pointermove',1,80);testPhotoPointer('pointermove',2,260);
  });
  await page.waitForFunction(()=>parseFloat(document.getElementById('photoPreviewOverlay').style.getPropertyValue('--pp-scale'))>1.5);
  await page.evaluate(()=>{testPhotoPointer('pointerup',1,80);testPhotoPointer('pointerup',2,260);testPhotoPointer('pointerdown',3,80);testPhotoPointer('pointerdown',4,260);testPhotoPointer('pointermove',3,170);testPhotoPointer('pointermove',4,220);});
  await page.waitForFunction(()=>parseFloat(document.getElementById('photoPreviewOverlay').style.getPropertyValue('--pp-scale'))<=1);
  await page.evaluate(()=>{testPhotoPointer('pointerup',3,170);testPhotoPointer('pointerup',4,220);});
  assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('iOS keyboard uses one viewport owner, hides rather than lifts the Dock and restores the full page after blur',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3],ios:true});try{
  const {page}=f;await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-ios-viewport'));
  const dock=await page.locator('#dockBar').boundingBox();
  async function keyboard(input){
   await input.focus();await page.evaluate(()=>{testKeyboardViewport.height=420;testKeyboardViewport.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-keyboard-open'));
   assert.equal(await page.locator('#dockBar').isVisible(),false);
   assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-visual-bottom')),'0px');
   assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-app-height')),'420px');
   await input.evaluate(el=>el.blur());await page.waitForFunction(()=>!document.documentElement.classList.contains('xtj-keyboard-open'));
   assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-app-height')),'844px','blur restores height even before Safari reports the final viewport event');
   await page.evaluate(()=>{testKeyboardViewport.height=844;testKeyboardViewport.dispatchEvent(new Event('resize'));});
   assert.deepEqual(await page.locator('#dockBar').boundingBox(),dock);
  }
  await keyboard(page.locator('#postInp'));
  await page.evaluate(()=>__xtjOpenAiChat());await page.waitForSelector('#aiChatMsgInput');
  await page.locator('#aiChatMsgInput').focus();await page.evaluate(()=>{testKeyboardViewport.height=420;testKeyboardViewport.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-keyboard-open'));
  const bar=page.locator('.ai-chat-input-bar');assert.equal(await bar.evaluate(el=>el.style.bottom),'');assert.equal(await bar.evaluate(el=>el.style.position),'');
  const geometry=await bar.boundingBox();assert.ok(geometry.y+geometry.height<=421,JSON.stringify(geometry));assert.equal(await page.locator('#dockBar').isVisible(),false);
  await page.locator('#aiChatMsgInput').evaluate(el=>el.blur());await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--xtj-app-height')==='844px');
  await page.evaluate(()=>{testKeyboardViewport.height=844;testKeyboardViewport.dispatchEvent(new Event('resize'));});assert.equal(await page.locator('#dockBar').isVisible(),true);
 }finally{await f.close();}
});

for(const theme of ['light','dark'])test(theme+': Feed comments use compact transparent rows and retain inline expansion',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3],theme});try{
  const row=f.page.locator('#feed .comment-item').first();const style=await row.evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,shadow:s.boxShadow,blur:s.backdropFilter,height:el.offsetHeight,padding:s.paddingTop};});
  assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.shadow,'none');assert.equal(style.blur,'none');assert.ok(style.height<=40,JSON.stringify(style));
  await f.page.locator('#feed .post-all-comments').click();await f.page.waitForFunction(()=>document.querySelectorAll('#feed [data-comment-id]').length===6);assert.equal(await f.page.locator('#postDetailModal').evaluate(el=>el.classList.contains('active')),false);
 }finally{await f.close();}
});

for (const [device,viewport] of [['phone',{width:390,height:844}],['tablet',{width:1024,height:768}]]) {
 test(device+': Safari keyboard pan aligns both edges, clears Dock reserve, and recovers while input remains focused',{timeout:30000},async()=>{
  const f=await postBrowserFixture({counts:[3],ios:device==='tablet'?'ipad-desktop':true,viewport});try{
   const {page}=f;const dockWasVisible=await page.locator('#dockBar').isVisible();await page.evaluate(()=>__xtjOpenAiChat());await page.waitForSelector('#aiChatMsgInput');await page.waitForTimeout(350);
   await page.locator('#aiChatMsgInput').focus();
   await page.evaluate(()=>{testKeyboardViewport.height=360;testKeyboardViewport.offsetTop=86;testKeyboardViewport.dispatchEvent(new Event('resize'));testKeyboardViewport.dispatchEvent(new Event('scroll'));});
   await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--xtj-visual-top')==='86px');
   let bounds=await page.evaluate(()=>({top:document.querySelector('.ai-chat-header').getBoundingClientRect().top,bottom:document.querySelector('.ai-chat-input-bar').getBoundingClientRect().bottom,padding:getComputedStyle(document.getElementById('aiChatRoot')).paddingBottom,hidden:!document.getElementById('dockBar').getClientRects().length}));
   const content=await page.locator('#dockPanels').boundingBox();
   assert.ok(Math.abs(bounds.top-(device==='tablet'?content.y:86))<=2,JSON.stringify(bounds));assert.ok(Math.abs(bounds.bottom-(device==='tablet'?content.y+content.height:446))<=2,JSON.stringify(bounds));assert.equal(bounds.padding,'0px');assert.equal(bounds.hidden,true);
   // Keyboard moves both coordinate origins, then Safari retains a stale
   // innerHeight even though VisualViewport has already expanded.
   await page.evaluate(()=>{Object.defineProperty(window,'innerHeight',{value:360,configurable:true});testKeyboardViewport.offsetTop=120;testKeyboardViewport.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--xtj-visual-top')==='120px');
   const panned=await page.locator('#dockPanels').boundingBox();
   assert.ok(Math.abs((await page.locator('.ai-chat-input-bar').boundingBox()).y+(await page.locator('.ai-chat-input-bar').boundingBox()).height-(device==='tablet'?panned.y+panned.height:480))<=2);
   await page.evaluate(height=>{testKeyboardViewport.height=height;testKeyboardViewport.offsetTop=0;testKeyboardViewport.dispatchEvent(new Event('resize'));},viewport.height);
   await page.waitForFunction(()=>!document.documentElement.classList.contains('xtj-keyboard-open'));
   assert.equal(await page.locator('#dockBar').isVisible(),dockWasVisible);assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-app-height')),viewport.height+'px');
   assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-visual-top')),'0px');assert.equal(await page.evaluate(()=>document.activeElement.id),'aiChatMsgInput');
   await page.locator('#aiChatMsgInput').evaluate(el=>el.blur());await page.waitForTimeout(250);
   assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-app-height')),viewport.height+'px');assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
 });
}

test('Safari post comment focus stays inside its own scroll panel as the keyboard opens and closing restores the full shell',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3],ios:true});try{
  const {page}=f;await page.locator('#feed .actions').getByRole('button',{name:'评论',exact:true}).click();const input=page.locator('#feed .inline-comment-inp');await input.focus();
  await page.evaluate(()=>{testKeyboardViewport.height=360;testKeyboardViewport.offsetTop=80;testKeyboardViewport.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--xtj-visual-top')==='80px');
  const rect=await input.boundingBox();assert.ok(rect.y>=80&&rect.y+rect.height<=440,JSON.stringify(rect));assert.equal(await page.evaluate(()=>scrollY),0);assert.equal(await page.locator('#dockBar').isVisible(),false);
  await input.evaluate(el=>el.blur());await page.evaluate(()=>{testKeyboardViewport.height=844;testKeyboardViewport.offsetTop=0;testKeyboardViewport.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('xtj-keyboard-open'));assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-app-height')),'844px');assert.equal(await page.locator('#dockBar').isVisible(),true);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const actor of ['alice','bob'])test(actor+': a public three-image post keeps its complete gallery through API fallback and ignores old cover-only caches',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3],user:actor,publicPosts:true,feedUnavailable:true,legacyCoverCache:true});try{
  const {page}=f;assert.equal(await page.locator('#feed .post-media-cell').count(),3);
  assert.ok(f.calls.some(c=>c.path==='/api/post/media/batch'));assert.equal(f.calls.filter(c=>c.path.startsWith('/api/post/detail/')).length,0);
  await page.locator('#feed .post-media-cell').nth(2).click();await page.waitForFunction(()=>window.photoPreviewCurrent?.__xtjMediaIndex===2);assert.equal(await page.evaluate(()=>__xtjPreviewExplicitPhotos.length),3);
  await page.evaluate(()=>closePhotoPreview());await page.waitForFunction(()=>!document.getElementById('photoPreviewOverlay').classList.contains('active'));
  f.setFailMediaBatch(true);await page.evaluate(()=>loadFeed(true));assert.equal(await page.locator('#feed .post-media-cell').count(),3,'failed attachment refresh retains a complete gallery');
  f.setFailMediaBatch(false);await page.evaluate(()=>loadFeed(true));assert.equal(await page.locator('#feed .post-media-cell').count(),3);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for(const auth of [['loginModal','loginPwInp'],['registerModal','regPwInp']])test(auth[0]+': Safari keyboard keeps the focused auth field inside a local scroll region and restores the shell',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3],ios:true});try{
  const {page}=f;await page.evaluate(id=>openAuthModal(id==='loginModal'?'login':'register'),auth[0]);await page.waitForTimeout(260);
  await page.locator('#'+auth[1]).focus();await page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:300,offsetTop:90});testKeyboardViewport.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-keyboard-open'));
  const box=page.locator('#'+auth[0]+' .modal-box');const rect=await box.boundingBox();assert.ok(rect.y>=90&&rect.y+rect.height<=390.5,JSON.stringify(rect));
  const input=await page.locator('#'+auth[1]).boundingBox();assert.ok(input.y>=90&&input.y+input.height<=390.5,JSON.stringify(input));assert.equal(await page.locator('#dockBar').isVisible(),false);
  const first=auth[0]==='loginModal'?'loginNickInp':'regNickInp';await page.locator('#'+first).focus();await page.waitForTimeout(50);const nick=await page.locator('#'+first).boundingBox();assert.ok(nick.y>=90&&nick.y+nick.height<=390.5,JSON.stringify(nick));
  await page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:844,offsetTop:0});testKeyboardViewport.dispatchEvent(new Event('resize'));});await page.waitForFunction(()=>!document.documentElement.classList.contains('xtj-keyboard-open'));
  assert.equal(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--xtj-app-height')),'844px');await page.evaluate(id=>closeModal(id),auth[0]);assert.equal(await page.locator('#dockBar').isVisible(),true);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

for(const viewport of [{width:390,height:844},{width:1280,height:800}])test(viewport.width+'px: real AI replies have one paragraph gap, compact loose lists and matching footer text sizes',{timeout:30000},async()=>{
 const f=await postBrowserFixture({viewport,counts:[3],ios:viewport.width>1000?'ipad-desktop':true});try{
  const {page}=f;await wireAiChat(page);await page.locator('#aiChatMsgInput').fill('天气');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>window.testStream);
  const liveFont=await page.locator('.ai-msg.assistant .ai-msg-bubble').last().evaluate(el=>({size:getComputedStyle(el).fontSize,lineHeight:getComputedStyle(el).lineHeight}));
  const text='\n\n\n查到了，数据可靠。\n\n\n**明天上海天气：**\n\n- 天气：阴雨\n\n- 气温：20～24°C\n\n- 降水量：3～8mm\n\n- 风力：偏北风4～5级，阵风6级\n\n\n请带一把伞。';
  await page.evaluate(text=>{testEmit({type:'tool_calls',tools:[{id:'1',name:'get_weather',args:{location:'上海'}}]});testEmit({type:'tool_result',call_id:'1',tool_name:'get_weather',success:true});testEmit({type:'content',text});testEmit({type:'done',content:text,thinking_mode:'max',complete:true,saved:true});testStream.close();},text);
  await page.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));await page.waitForTimeout(1000);
  const finalFont=await page.locator('.ai-msg.assistant .ai-msg-bubble').last().evaluate(el=>({size:getComputedStyle(el).fontSize,lineHeight:getComputedStyle(el).lineHeight}));assert.deepEqual(finalFont,liveFont,'completion must not change mobile typography or rewrap existing lines');
  const metrics=await page.locator('.ai-msg.assistant .ai-msg-bubble').last().evaluate(el=>{const rect=el.getBoundingClientRect(),first=el.firstElementChild.getBoundingClientRect(),list=Array.from(el.querySelectorAll('li')).map(n=>n.getBoundingClientRect());return{html:el.innerHTML,height:rect.height,firstGap:first.top-rect.top,whiteSpace:getComputedStyle(el).whiteSpace,lists:el.querySelectorAll('ul').length,listGaps:list.slice(1).map((box,i)=>box.top-list[i].bottom)};});
  assert.equal(metrics.whiteSpace,'normal');assert.equal(metrics.lists,1);assert.ok(metrics.firstGap<=16,JSON.stringify(metrics));assert.ok(metrics.height<350,JSON.stringify(metrics));assert.ok(metrics.listGaps.every(gap=>gap>=0&&gap<=8),JSON.stringify(metrics));assert.doesNotMatch(metrics.html,/<br><br>|<ul><br>/);
  const sizes=await page.locator('.ai-msg.assistant .ai-msg-footer').last().evaluate(el=>['.ai-msg-time','.ai-msg-agent-badge','.ai-msg-thinking-badge'].map(s=>getComputedStyle(el.querySelector(s)).fontSize));assert.deepEqual(sizes,['11px','11px','11px']);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('desktop-UA iPad with a fine pointer freezes desktop layout during an actual landscape resize and never reveals the Dock above the keyboard',{timeout:30000},async()=>{
 const f=await postBrowserFixture({viewport:{width:1280,height:800},ios:'ipad-desktop',counts:[3]});try{
  const {page}=f;await wireAiChat(page);const dockBefore=await page.locator('#dockBar').isVisible();await page.locator('#aiChatMsgInput').focus();await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-tablet-layout'));
  await page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:310,offsetTop:20});testKeyboardViewport.dispatchEvent(new Event('resize'));});await page.setViewportSize({width:1280,height:340});await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-keyboard-open'));
  assert.equal(await page.locator('#dockBar').isVisible(),false);assert.equal(await page.locator('link[href*="desktop.min.css"]').getAttribute('media'),'(min-width:768px)');assert.equal(await page.locator('#desktopWorkbenchSidebar').isVisible().catch(()=>false),true);
  const composer=await page.locator('.ai-chat-input-bar').boundingBox();const content=await page.locator('#dockPanels').boundingBox();assert.ok(Math.abs(composer.y+composer.height-content.y-content.height)<=2,JSON.stringify({composer,content}));
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:800,offsetTop:0});testKeyboardViewport.dispatchEvent(new Event('resize'));});await page.waitForFunction(()=>!document.documentElement.classList.contains('xtj-keyboard-open'));
  assert.equal(await page.locator('#dockBar').isVisible(),dockBefore);await page.locator('#aiChatMsgInput').evaluate(el=>el.blur());assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('xtj-tablet-layout')),true);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('a failed Feed original retries in place without opening Detail or the gallery and preserves adjacent photos',async()=>{
 const f=await postBrowserFixture({counts:[3]});try{
  const {page}=f,cell=page.locator('#feed .post-media-cell').first();await page.locator('#feed .post-media-cell img').first().waitFor();
  await page.route('**/test-image/*?offline',route=>route.fulfill({status:503,body:'temporary outage'}));
  await cell.locator('img').evaluate(img=>{window.adjacentPhoto=document.querySelectorAll('#feed .post-media-cell img')[1];window.failedCell=img.closest('button');img.src=img.dataset.mediaUrl+'?offline';});
  await page.waitForFunction(()=>document.querySelector('#feed .post-media-cell').classList.contains('post-image-failed'));const before=await cell.boundingBox();await cell.click();
  await page.waitForFunction(()=>!document.querySelector('#feed .post-media-cell').classList.contains('post-image-failed')&&document.querySelector('#feed .post-media-cell img').naturalWidth>0);
  assert.deepEqual(await cell.boundingBox(),before);assert.equal(await page.evaluate(()=>document.querySelector('#feed .post-media-cell')===failedCell&&document.querySelectorAll('#feed .post-media-cell img')[1]===adjacentPhoto),true);
  assert.equal(await page.locator('#photoPreviewOverlay.active').count(),0);assert.equal(await page.locator('#postDetailModal.active').count(),0);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('photo preview offers a working original-image retry after all automatic attempts fail', {timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[3]});try{
  const {page}=f,url=f.origin+'/test-preview-original.png';let failed=true;
  await page.route(url,route=>failed?route.fulfill({status:503,body:'temporary outage'}):route.fulfill({contentType:'image/png',body:f.png}));
  await page.locator('#feed .post-media-cell').first().click();await page.waitForFunction(()=>document.querySelector('#photoPreviewOverlay.active'));
  await page.evaluate(url=>openPhotoPreview(0,{photos:[{id:'retry-wall',imageUrl:url,thumbUrl:url,username:'alice',date:'2026-10-03T12:00:00Z'}]}),url);
  const retry=page.locator('.pp-error-retry');await retry.waitFor({state:'visible'});failed=false;await retry.click();
  await page.waitForFunction(()=>document.getElementById('photoPreviewImage').naturalWidth>0&&getComputedStyle(document.getElementById('photoPreviewImage')).opacity==='1');
  assert.equal(await page.locator('.pp-error-placeholder').count(),0);assert.equal(await page.locator('#photoPreviewOverlay.active').count(),1);assert.equal(await page.locator('#photoPreviewImage').getAttribute('src'),url);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('iPad keyboard shrinking before focus keeps the sidebar and hides the Dock until the closing resize finishes',{timeout:30000},async()=>{
 const f=await postBrowserFixture({viewport:{width:1280,height:800},ios:'ipad-desktop',counts:[3]});try{
  const {page}=f;await wireAiChat(page);await page.locator('#aiChatMsgInput').evaluate(el=>el.blur());
  await page.setViewportSize({width:1280,height:340});await page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:310,offsetTop:20});testKeyboardViewport.dispatchEvent(new Event('resize'));});
  await page.locator('#aiChatMsgInput').focus();await page.waitForFunction(()=>document.documentElement.classList.contains('xtj-tablet-layout'));
  assert.equal(await page.locator('#dockBar').isVisible(),false);assert.equal(await page.locator('#desktopWorkbenchSidebar').isVisible(),true);
  await page.locator('#aiChatMsgInput').evaluate(el=>el.blur());await page.waitForTimeout(200);
  assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('xtj-tablet-layout')),true);assert.equal(await page.locator('#dockBar').isVisible(),false);
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:800,offsetTop:0});testKeyboardViewport.dispatchEvent(new Event('resize'));});
  assert.equal(await page.locator('html').evaluate(n=>n.classList.contains('xtj-tablet-layout')),true);
  assert.equal(await page.locator('#desktopWorkbenchSidebar').isVisible(),true);assert.equal(await page.locator('#dockBar').isVisible(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('rotating a portrait phone does not activate the tablet layout when its keyboard opens',{timeout:30000},async()=>{
 const f=await postBrowserFixture({viewport:{width:390,height:844},ios:true,counts:[1]});try{
  const {page}=f;await page.setViewportSize({width:844,height:390});await page.evaluate(()=>{testKeyboardViewport.height=390;testKeyboardViewport.dispatchEvent(new Event('resize'));});
  await page.locator('#postInp').focus();await page.setViewportSize({width:844,height:250});await page.evaluate(()=>{testKeyboardViewport.height=250;testKeyboardViewport.dispatchEvent(new Event('resize'));});
  assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('xtj-tablet-layout')),false);assert.match(await page.locator('link[href*="desktop.min.css"]').getAttribute('media'),/min-height/);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
