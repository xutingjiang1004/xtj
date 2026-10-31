'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

// xtjConfirm is stubbed by most other browser tests; this one drives the real dialog.
async function ask(f){
  await f.page.evaluate(()=>{window.__confirmResult='pending';xtjConfirm('删除评论','确定要永久删除这条评论吗？','删除').then(v=>{window.__confirmResult=v;});});
  await f.page.waitForSelector('#ppConfirmOkBtn',{state:'visible'});
}
const settle=f=>f.page.waitForFunction(()=>window.__confirmResult!=='pending',null,{timeout:3000}).then(()=>f.page.evaluate(()=>window.__confirmResult));

test('the site confirm dialog resolves true only after Delete and false for every dismissal',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true});
  try{
    await ask(f);await f.page.click('#ppConfirmOkBtn');
    assert.equal(await settle(f),true,'confirming must not be reported as a cancel while the closing animation runs');
    await ask(f);await f.page.click('.pp-confirm-cancel');
    assert.equal(await settle(f),false);
    await ask(f);await f.page.keyboard.press('Escape');
    assert.equal(await settle(f),false);
    // The visible dialog must be gone and reusable after each outcome.
    await f.page.waitForFunction(()=>!document.getElementById('ppConfirmOverlay').classList.contains('active')&&!document.getElementById('ppConfirmOverlay').classList.contains('closing'));
  }finally{await f.close();}
});

test('deleting a comment from the feed sends the delete request once the user confirms',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true});
  try{
    const postId=f.posts[0].id,now=Date.now();
    f.comments.splice(0,f.comments.length,
      {id:'1',post_id:postId,user_name:'alice',content:'root',parent_comment_id:null,generated_by_ai:false,created_at:new Date(now-6e4).toISOString()},
      {id:'2',post_id:postId,user_name:'bob',content:'child',parent_comment_id:'1',generated_by_ai:false,created_at:new Date(now-3e4).toISOString()});
    await f.page.route('**/api/post/comment/1',route=>route.fulfill({json:{ok:true,deleted_comment_ids:['1','2'],comment_count:0,post_id:postId}}));
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .comment-item');
    await f.page.locator('#feed .comment-del-btn').first().click();
    await f.page.click('#ppConfirmOkBtn');
    await f.page.waitForFunction(()=>!document.querySelector('#feed .comment-item'),null,{timeout:4000});
    assert.match(await f.page.locator('#feed .post-stats-text').textContent(),/评论 0/);
  }finally{await f.close();}
});
