'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

test('an avatar image that fails to load is retried instead of being replaced by a letter for good',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:900}});
  try{
    f.posts[0].user_name='bob';
    const url=f.origin+'/test-avatar/bob.png';let hits=0;
    await f.page.route('**/api/avatar/batch',route=>route.fulfill({json:{ok:true,avatars:{bob:url,alice:null}}}));
    // A cold or busy server answers the first two image requests with an error.
    await f.page.route('**/test-avatar/bob.png',route=>++hits<=2?route.fulfill({status:503,body:'busy'}):route.fulfill({status:200,contentType:'image/png',body:f.png}));
    await f.page.evaluate(()=>Object.keys(localStorage).filter(k=>/avatar/i.test(k)).forEach(k=>localStorage.removeItem(k)));
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .post');
    await f.page.waitForFunction(()=>{const img=document.querySelector('#feed .post-header img.avatar-image');return img&&img.complete&&img.naturalWidth>0;},null,{timeout:15000});
    assert.ok(hits>=3,'the image was requested again after the failures');
    assert.equal(await f.page.locator('#feed .post-header .avatar-fallback').evaluate(el=>getComputedStyle(el).visibility!=='visible'||el.closest('.avatar').classList.contains('has-image')),true);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('a multi-megabyte base64 avatar left in local storage by an old version is ignored',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:900}});
  try{
    f.posts[0].user_name='bob';
    const url=f.origin+'/test-avatar/bob2.png';
    await f.page.route('**/api/avatar/batch',route=>route.fulfill({json:{ok:true,avatars:{bob:url,alice:null}}}));
    await f.page.route('**/test-avatar/bob2.png',route=>route.fulfill({status:200,contentType:'image/png',body:f.png}));
    await f.page.evaluate(()=>{const huge='data:image/png;base64,'+'A'.repeat(300000);
      localStorage.setItem('xtj_avatars_v2',JSON.stringify({version:2,data:{bob:{state:'has_avatar',url:huge,fetched_at:Date.now()}}}));});
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .post');
    await f.page.waitForFunction(()=>{const img=document.querySelector('#feed .post-header img.avatar-image');return img&&img.complete&&img.naturalWidth>0;},null,{timeout:15000});
    assert.equal(await f.page.locator('#feed .post-header img.avatar-image').evaluate(img=>img.getAttribute('src').startsWith('data:')),false);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
