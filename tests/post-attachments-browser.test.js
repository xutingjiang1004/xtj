'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{postBrowserFixture}=require('./helpers/post-browser-fixture');
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
    await card.locator('.content').click();await page.waitForFunction(id=>window.__xtjPostDetailSnapshot?.id===id,post.id);
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
   assert.equal(await firstCard.locator('[data-comment-id]').count(),3);await firstCard.getByRole('button',{name:'查看全部 6 条评论'}).click();await page.waitForFunction(()=>document.querySelectorAll('#postDetailBody [data-comment-id]').length===6);
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
