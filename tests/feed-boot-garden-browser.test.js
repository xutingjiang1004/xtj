'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

for (const device of [
  { name: 'mobile', viewport: { width: 390, height: 844 }, ios: true },
  { name: 'tablet desktop layout', viewport: { width: 1180, height: 820 }, ios: 'ipad-desktop' }
]) {
  test(device.name + ': slow first feed shows the photo-wall garden and then real posts', async () => {
    const f = await postBrowserFixture({ ...device, counts: [1], holdFeed: true, waitForPost: false, publicPosts: true });
    try {
      await f.page.locator('#feed .feed-garden-loading .pw-garden svg').waitFor({ state: 'visible' });
      assert.match(await f.page.locator('#feed [role=status]').textContent(), /正在加载帖子/);
      f.releaseFeed();
      await f.page.waitForFunction(() => document.querySelector('#feed .post:not([data-early])'));
      await f.page.waitForFunction(() => getComputedStyle(document.querySelector('#feed .post')).opacity === '1');
      assert.equal(await f.page.locator('#feed .feed-garden-loading').count(), 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

test('an unrelated profile initialization failure does not prevent the feed from booting', async () => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true, breakProfileInit: true, waitForPost: false });
  try {
    await f.page.waitForFunction(() => window.__xtjCoreFeedReady === true && document.querySelector('#feed .post:not([data-early])'));
    assert.equal(await f.page.locator('#feed .post').count(), 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a confirmed background session failure restores public posts and removes the old private view', async () => {
 const f=await postBrowserFixture({counts:[1,1],enforceFeedPrivacy:true});
 try {
  await f.page.waitForFunction(()=>window.__xtjCoreFeedReady===true&&document.querySelectorAll('#feed .post:not([data-early])').length===2);
  f.posts[0].visibility='public';
  await f.page.evaluate(()=>window.handleProtectedAuthFailure({background:true}));
  await f.page.waitForFunction(()=>window.currentUser===''&&window.__xtjCoreFeedReady===true&&document.querySelectorAll('#feed .post').length===1);
  assert.equal(await f.page.locator('#feed .post').first().getAttribute('data-post-id'),f.posts[0].id);
  assert.equal(await f.page.locator('#feed .post[data-post-id="'+f.posts[1].id+'"]').count(),0);
  assert.equal(await f.page.locator('#authUI').evaluate(el=>getComputedStyle(el).display),'none');
  assert.deepEqual(f.errors,[]);
 } finally {await f.close();}
});

test('early feed restores an unexpectedly emptied area without hiding an explicit error', async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const pages=await Promise.all([browser.newPage(),browser.newPage(),browser.newPage()]);
  await Promise.all(pages.map(async page=>{
   await page.setContent('<div id="feed"><div class="xtj-loading-skeleton">正在加载帖子</div></div>');
   await page.evaluate(()=>{window.fetch=async()=>new Response(JSON.stringify({ok:true,posts:[{id:'test-post',user_name:'alice',content:'可见的公开帖子'}]}),{headers:{'Content-Type':'application/json'}});});
   await page.addScriptTag({path:'js/early-feed.js'});await page.waitForSelector('#feed .post');
  }));
  await pages[0].evaluate(()=>document.getElementById('feed').replaceChildren());
  await pages[1].evaluate(()=>document.getElementById('feed').textContent='加载失败，请点击重试');
  await pages[2].evaluate(()=>{window.__xtjEarlyFeed.status='stale';window.__xtjEarlyFeed.data=null;document.getElementById('feed').replaceChildren();});
  await pages[0].waitForSelector('#feed .post',{timeout:4000});await pages[1].waitForTimeout(2700);
  assert.match(await pages[0].locator('#feed').textContent(),/可见的公开帖子/);
  assert.equal(await pages[1].locator('#feed').textContent(),'加载失败，请点击重试');
  assert.equal(await pages[2].locator('#feed .post').count(),0,'an invalidated early snapshot must not repaint after identity reset');
 } finally { await browser.close(); }
});
