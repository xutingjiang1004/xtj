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
    await f.page.route('**/api/photo/shared/opaque-grant/*/media',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#17836d"/></svg>'}));
    await f.page.goto(f.origin+'/share/photos/opaque-grant',{waitUntil:'domcontentloaded'});
    await f.page.waitForFunction(()=>document.querySelector('article img')?.naturalWidth===640);
    assert.equal(await f.page.locator('article').count(),1);
    assert.match(await f.page.locator('.author').textContent(),/原创作者/);
    assert.equal(await f.page.getByRole('link',{name:'打开网站'}).getAttribute('href'),'/');
    assert.equal(await f.page.locator('footer').textContent(),'本次分享包含1张照片，更多照片需登录网站查看。');
    await f.page.locator('.photo').click();
    await f.page.waitForFunction(()=>document.querySelector('dialog')?.open&&document.querySelector('.viewer img')?.naturalWidth===640);
    assert.match(await f.page.locator('.viewer img').getAttribute('src'),new RegExp('/api/photo/shared/opaque-grant/'+A+'/media'));
    const box=await f.page.locator('.viewer').boundingBox();
    await f.page.mouse.move(box.x+box.width/2,box.y+box.height/3);
    await f.page.mouse.down();await f.page.mouse.move(box.x+box.width/2,box.y+box.height/3+160,{steps:8});await f.page.mouse.up();
    assert.equal(await f.page.locator('dialog').evaluate(dialog=>dialog.open),false);
    await f.page.locator('.photo').click();
    await f.page.waitForFunction(()=>document.querySelector('dialog')?.open);
    await f.page.getByRole('button',{name:'关闭预览'}).click();
    assert.equal(await f.page.locator('dialog').evaluate(dialog=>dialog.open),false);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('guest photo wall shows the login gate rather than an empty upload invitation',async()=>{
  const f=await postBrowserFixture({user:'',publicPosts:true,counts:[1]});
  try{
    await f.page.locator('[data-tab="ai"]').filter({visible:true}).first().click();
    await f.page.getByText('请登录查看所有照片',{exact:true}).waitFor({state:'visible'});
    assert.equal(await f.page.getByText('成为第一个分享照片的人',{exact:true}).isVisible(),false);
    await f.page.getByRole('button',{name:'立即登录',exact:true}).click();
    assert.equal(await f.page.locator('#loginModal').isVisible(),true);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

for(const mode of ['login','register'])test(`${mode} from the locked wall resumes photos without a tab switch and broadcasts the confirmed owner`,async()=>{
  const f=await postBrowserFixture({user:'',publicPosts:true,counts:[1]});
  try{
    const {page}=f;let photoReads=0;
    await page.route('**/api/user/'+mode,route=>route.fulfill({json:{ok:true,token:'test-only-token',user_name:'alice'}}));
    await page.route('**/api/photos/public?*',route=>{photoReads++;return route.fulfill({json:{ok:true,data:[{id:A,user_name:'alice',media_type:'__photo_wall__',media_url:f.origin+'/test-image/0-0.png',content:'{}',visibility:'public',created_at:'2026-10-08T12:00:00Z'}]}});});
    await page.evaluate(mode=>{window.confirmedOwners=[];window.confirmingLogin=false;document.getElementById(mode==='login'?'loginSubmitBtn':'registerSubmitBtn').addEventListener('click',()=>window.confirmingLogin=true,{capture:true,once:true});window.addEventListener('auth-ready',e=>{if(window.confirmingLogin)confirmedOwners.push({owner:window.currentUser,canonical:window._xtjCanonicalUser,eventOwner:e.detail.user_name});});},mode);
    await page.locator('[data-tab="ai"]').filter({visible:true}).first().click();
    await page.getByRole('button',{name:'立即登录',exact:true}).click();
    if(mode==='register')await page.locator('#loginModal .af-link').click();
    await page.locator(mode==='login'?'#loginNickInp':'#regNickInp').fill('alice');
    await page.locator(mode==='login'?'#loginPwInp':'#regPwInp').fill('test-only-password');
    await page.locator(mode==='login'?'#loginSubmitBtn':'#registerSubmitBtn').click();
    await page.waitForFunction(()=>document.querySelector('#photoGrid .photo-wall-item img')?.naturalWidth>0);
    assert.ok(photoReads>0);assert.equal(await page.getByText('请登录查看所有照片',{exact:true}).isVisible(),false);
    const owners=await page.evaluate(()=>confirmedOwners);assert.ok(owners.length>0);assert.ok(owners.every(e=>e.owner==='alice'&&e.canonical==='alice'&&e.eventOwner==='alice'),JSON.stringify(owners));
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('guest AI startup cannot clear public posts or open a login dialog',async()=>{
  const f=await postBrowserFixture({user:'',publicPosts:true,counts:[1]});
  try{
    let requests=0;await f.page.route('**/api/agent/config',route=>{requests++;return route.fulfill({status:401,json:{error:'unauthorized'}});});
    await f.page.reload({waitUntil:'domcontentloaded'});
    await f.page.waitForFunction(()=>typeof window.__xtjOpenAiChat==='function'&&document.getElementById('aiToolsNav').__xtjAiToolsBound&&document.querySelector('#feed .post'));
    await f.page.locator('[data-tab="ai"]').filter({visible:true}).click();
    await f.page.getByText('请登录查看所有照片',{exact:true}).waitFor({state:'visible'});
    await f.page.locator('[data-tab="posts"]').filter({visible:true}).click();
    assert.equal(await f.page.locator('#feed .post').count(),1);
    assert.equal(await f.page.locator('#loginModal.active').count(),0);
    assert.equal(requests,0);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('an authenticated post image renews a missing scoped cookie and retries the original',async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try{
    let refreshes=0,failures=0;
    await f.page.route('**/api/user/refresh',async route=>{
      refreshes++;await route.fulfill({headers:{'set-cookie':'xtj_post_media_session=fixture; Path=/api/post; HttpOnly; SameSite=Lax'},json:{token:'test-only-token',user_name:'alice'}});
    });
    await f.page.route('**/api/post/*/media/*',async route=>{
      const headers=await route.request().allHeaders();
      if(!headers.cookie?.includes('xtj_post_media_session=fixture')){failures++;await route.fulfill({status:401,json:{error:'unauthorized'}});return;}
      await route.fulfill({contentType:'image/png',body:f.png});
    });
    await f.page.context().clearCookies();
    await f.page.evaluate(id=>{
      const img=document.querySelector('#feed .post-media-cell img');
      const original=location.origin+'/api/post/'+id+'/media/0';
      img.setAttribute('data-media-url',original);img.src=original;
    },f.posts[0].id);
    await f.page.waitForFunction(()=>document.querySelector('#feed .post-media-cell img')?.naturalWidth===1);
    assert.ok(failures>=1);assert.equal(refreshes,1);
    assert.match(await f.page.locator('#feed .post-media-cell img').getAttribute('src'),/xtj_retry=/);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('chat contacts and history switch without leaving two interactive panels stacked',async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try{
    await f.page.locator('[data-tab="chat"]').filter({visible:true}).click();
    await f.page.locator('#dockChatSocialBtn').click();
    await f.page.locator('#dockChatSocialSheet').waitFor({state:'visible'});
    await f.page.locator('#chatSearchButton').click();
    await f.page.locator('#chatHistoryPanel').waitFor({state:'visible'});
    assert.equal(await f.page.locator('#dockChatSocialSheet').evaluate(e=>e.inert),true);
    await f.page.locator('#dockChatSocialBtn').click();
    await f.page.locator('#dockChatSocialSheet').waitFor({state:'visible'});
    assert.equal(await f.page.locator('#chatHistoryPanel').evaluate(e=>e.inert),true);
    await f.page.locator('#dockChatSocialClose').click();
    await f.page.locator('#dockChatSocialSheet').waitFor({state:'hidden'});
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('a relationship notification resumes pending user search while retaining the form and ignoring the old result',async()=>{
  const f=await postBrowserFixture({counts:[1]});let release;
  try{
    const {page}=f;let searches=0;const held=new Promise(resolve=>release=resolve);
    await page.route('**/api/chat/users/search?*',async route=>{
      const old=++searches===1;if(old)await held;
      await route.fulfill({json:{ok:true,users:[{user_name:'peer',relationship:old?'none':'request_sent'}]}});
    });
    await page.locator('[data-tab="chat"]').filter({visible:true}).click();await page.locator('#dockChatSocialBtn').click();await page.locator('#social-tab-search').click();
    await page.locator('#dockChatSocialSearchForm input').fill('peer');const requested=page.waitForRequest('**/api/chat/users/search?*');await page.locator('#dockChatSocialSearchForm button').click();await requested;
    await page.locator('#dockChatSocialSearchForm input').fill('peer draft');
    await page.evaluate(()=>__xtjRefreshChatSocialState());
    await page.getByText('等待对方处理',{exact:true}).waitFor({state:'visible'});assert.equal(searches,2);
    assert.equal(await page.locator('#dockChatSocialSearchForm input').inputValue(),'peer draft');
    release();await page.waitForTimeout(100);assert.equal(await page.locator('#dockChatSocialResults [data-chat-social-action="friend-request"]').count(),0);
    await page.locator('#social-tab-friends').click();await page.locator('#social-tab-search').click();await page.getByText('等待对方处理',{exact:true}).waitFor({state:'visible'});
    assert.equal(await page.locator('#dockChatSocialSearchForm input').inputValue(),'peer draft');assert.deepEqual(f.errors,[]);
  }finally{if(release)release();await f.close();}
});
