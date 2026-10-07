'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');
const { renderSharePage } = require('../render-api/photo-access');
const A = '11111111-1111-4111-8111-111111111111';

for (const width of [390,1024]) {
  test(`guest public post originals load through the website and open in preview at ${width}px`,async()=>{
    const f=await postBrowserFixture({user:'',publicPosts:true,counts:[2],viewport:{width,height:844}});
    try {
      const id=f.posts[0].id;
      f.posts[0].media_url=f.origin+'/storage/v1/object/public/uploads/posts/0.png';
      f.posts[0].media_items.forEach((item,i)=>item.media_url=f.origin+'/storage/v1/object/public/uploads/posts/'+i+'.png');
      // Keep this fixture's configured Storage origin stable from bootstrap,
      // just as production does. Its late public-config response uses localhost.
      await f.page.route('**/js/config.min.js*',route=>route.fulfill({contentType:'application/javascript',body:'window.XTJ_CONFIG={API_BASE:location.origin,SUPABASE_URL:location.origin+"/test-supabase"};window.API_BASE=location.origin;'}));
      let rawRequests=0;
      await f.page.route('**/storage/v1/object/public/uploads/posts/*',route=>{rawRequests++;return route.abort();});
      await f.page.route('**/api/post/*/media/*',route=>route.fulfill({contentType:'image/png',body:f.png}));
      await f.page.reload({waitUntil:'domcontentloaded'});
      await f.page.waitForFunction(()=>document.querySelector('#feed .post-media-cell img')?.naturalWidth===1);
      assert.equal(rawRequests,0);
      assert.match(await f.page.locator('#feed .post-media-cell img').first().getAttribute('src'),new RegExp('/api/post/'+id+'/media/0'));
      await f.page.locator('#feed .post-media-cell').first().click();
      await f.page.waitForFunction(()=>document.getElementById('photoPreviewImage')?.naturalWidth===1);
      assert.match(await f.page.locator('#photoPreviewImage').getAttribute('src'),new RegExp('/api/post/'+id+'/media/0'));
      await f.page.evaluate(()=>forceClosePhotoPreview());
      await f.page.evaluate(id=>openPhotoPreview(0,{photos:[{id,imageUrl:location.origin+'/test-image/0-0.png'}]}),A);
      assert.equal(await f.page.locator('#photoPreviewOverlay.active').count(),0);
      assert.equal(await f.page.evaluate(()=>currentUser),'');
      assert.deepEqual(f.errors,[]);
    } finally {await f.close();}
  });
}

test('wall share starts its clipboard gesture before awaiting the grant and cannot copy after logout',async()=>{
  const f=await postBrowserFixture({counts:[1]});let release;
  try {
    const wait=new Promise(resolve=>release=resolve);let hold=false,requests=0;
    await f.page.route('**/api/photo/share',async route=>{
      requests++;assert.deepEqual(route.request().postDataJSON(),{photo_ids:[A]});
      if(hold)await wait;
      await route.fulfill({json:{ok:true,share_path:'/share/photos/opaque-photo-grant',photo_count:1}});
    });
    await f.page.locator('#feed .post-media-cell').first().click();
    await f.page.waitForSelector('#photoPreviewOverlay.active');
    await f.page.evaluate(()=>ensurePhotoWallLoaded());
    await f.page.evaluate(id=>{
      forceClosePhotoPreview();window.copiedLinks=[];
      window.clipboardStarts=0;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{clipboardStarts++;copiedLinks.push(await (await items[0].getType('text/plain')).text());},writeText:async()=>{throw Error('writeText lost user activation');}}});
      const photo={id,cloudId:id,username:'alice',imageUrl:location.origin+'/test-image/0-0.png'};
      window.photoWallData=[photo];window.pwCurrentSortedPhotos=[photo];
      window.saveLocalPhotoWallData();openPhotoPreview(0,{photos:[photo]});
    },A);
    await f.page.waitForFunction(()=>photoPreviewCurrent?.id==='11111111-1111-4111-8111-111111111111');
    await f.page.evaluate(()=>shareCurrentPhoto());
    assert.deepEqual(await f.page.evaluate(()=>copiedLinks),[f.origin+'/share/photos/opaque-photo-grant']);
    hold=true;
    const requested=f.page.waitForRequest('**/api/photo/share');
    const sharing=f.page.evaluate(()=>shareCurrentPhoto());
    await requested;assert.equal(await f.page.evaluate(()=>clipboardStarts),2);
    await f.page.evaluate(()=>doLogout());release();await sharing;
    assert.equal((await f.page.evaluate(()=>copiedLinks)).length,1);
    assert.equal(await f.page.evaluate(()=>photoWallData.length),0);
    assert.equal(await f.page.evaluate(()=>pwCurrentSortedPhotos.length),0);
    assert.equal(await f.page.locator('#photoPreviewOverlay.active').count(),0);
    assert.equal(await f.page.evaluate(()=>localStorage.getItem('xtj_photos')),null);
    await f.page.evaluate(()=>shareCurrentPhoto());assert.equal(requests,2);
    assert.deepEqual(f.errors,[]);
  } finally {if(release)release();await f.close();}
});

test('the standalone website share page shows its author and opens the granted original without login',async()=>{
  const f=await postBrowserFixture({user:'',publicPosts:true,counts:[1]});
  try {
    const html=renderSharePage([{id:A,user_name:'原创作者',created_at:'2026-10-07',content:'{"caption":"分享给你的照片"}'}],'opaque-grant');
    await f.page.route('**/share/photos/opaque-grant',route=>route.fulfill({contentType:'text/html',body:html}));
    await f.page.route('**/api/photo/shared/opaque-grant/*/media',route=>route.fulfill({contentType:'image/png',body:f.png}));
    await f.page.goto(f.origin+'/share/photos/opaque-grant',{waitUntil:'domcontentloaded'});
    await f.page.waitForFunction(()=>document.querySelector('article img')?.naturalWidth===1);
    assert.equal(await f.page.locator('article').count(),1);
    assert.match(await f.page.locator('.author').textContent(),/原创作者/);
    assert.equal(await f.page.getByRole('link',{name:'打开网站'}).getAttribute('href'),'/');
    await f.page.locator('.photo').click();
    await f.page.waitForFunction(()=>document.querySelector('dialog')?.open&&document.querySelector('.viewer img')?.naturalWidth===1);
    assert.match(await f.page.locator('.viewer img').getAttribute('src'),new RegExp('/api/photo/shared/opaque-grant/'+A+'/media'));
    await f.page.getByRole('button',{name:'关闭预览'}).click();
    assert.equal(await f.page.locator('dialog').evaluate(dialog=>dialog.open),false);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});
