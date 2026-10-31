'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

// Avatar URLs arrive asynchronously. A card created after the first feed render (a post you just
// published, a comment that just arrived) used to keep its placeholder letter forever when the
// author's avatar was not already cached.
test('a freshly published post gets its author avatar even when it was not cached',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:1200}});
  try{
    const avatar=f.origin+'/test-image/1-0.png';
    await f.page.route('**/api/avatar/batch',route=>route.fulfill({json:{ok:true,avatars:{alice:avatar,bob:null}}}));
    // The existing post belongs to someone else, so alice's avatar is unknown when she publishes.
    f.posts[0].user_name='bob';
    await f.page.evaluate(()=>{localStorage.removeItem('xtj_avatar_cache_v3');Object.keys(localStorage).filter(k=>/avatar/i.test(k)).forEach(k=>localStorage.removeItem(k));});
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .post');
    await f.page.fill('#postInp','我刚发的帖子');
    await f.page.locator('#pubBtn').click();
    const mine=f.page.locator('#feed .post',{hasText:'我刚发的帖子'});
    await mine.waitFor();
    await mine.locator('.post-header img.avatar-image').waitFor({timeout:8000});
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('a comment added to a post in place shows its author avatar instead of a permanent letter',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:1200}});
  try{
    const avatar=f.origin+'/test-image/1-0.png';
    // The avatar service is down while the page loads (a failed lookup is retried after 5s), then recovers.
    let up=false;
    await f.page.route('**/api/avatar/batch',route=>up?route.fulfill({json:{ok:true,avatars:{alice:avatar,bob:null}}}):route.fulfill({status:503,json:{ok:false}}));
    f.posts[0].user_name='bob';f.comments.splice(0,f.comments.length);
    await f.page.evaluate(()=>Object.keys(localStorage).filter(k=>/avatar/i.test(k)).forEach(k=>localStorage.removeItem(k)));
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .post');
    await f.page.waitForTimeout(6000);up=true;
    await f.page.locator('#feed .actions .action-btn',{hasText:'评论'}).first().click();
    await f.page.locator('#feed .inline-comment-inp').fill('我的评论');
    await f.page.locator('#feed .inline-comment-box button',{hasText:'发送'}).click();
    const mine=f.page.locator('#feed .comment-item',{hasText:'我的评论'});
    await mine.waitFor();
    await mine.locator('img.avatar-image').waitFor({timeout:8000});
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
