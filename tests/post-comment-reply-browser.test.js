'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

function seed(f){
  const postId=f.posts[0].id,now=Date.now();
  f.comments.splice(0,f.comments.length,
    {id:'11',post_id:postId,user_name:'bob',content:'bob 的评论',parent_comment_id:null,generated_by_ai:false,created_at:new Date(now-6e4).toISOString()},
    {id:'12',post_id:postId,user_name:'carol',content:'carol 的评论',parent_comment_id:null,generated_by_ai:false,created_at:new Date(now-5e4).toISOString()});
  return postId;
}
// The fixture echoes comments without a parent; echo the one the page sent, as the real server does.
async function echoReplies(f,sent){
  await f.page.route('**/api/post/comment',async route=>{
    const body=route.request().postDataJSON();sent.push(body);
    const comment={id:String(900+sent.length),post_id:body.post_id,user_name:'alice',content:body.content,parent_comment_id:body.parent_comment_id||null,generated_by_ai:false,created_at:new Date().toISOString()};
    f.comments.push(comment);
    await route.fulfill({json:{ok:true,data:comment,comment_count:f.comments.length}});
  });
}

test('replying to a comment opens the box under that comment and sends its id',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:1200}});
  try{
    const postId=seed(f),sent=[];await echoReplies(f,sent);
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .comment-item');
    const bob=f.page.locator('#feed .comment-item[data-comment-id="11"]');
    await bob.locator('> .comment-row .comment-reply-btn').click();
    const box=bob.locator('> .inline-reply-box');await box.waitFor();
    assert.equal(await box.locator('input').getAttribute('placeholder'),'回复 @bob…');
    // The box sits directly below bob's row and not under carol's comment or the post actions.
    const rowBox=await bob.locator('> .comment-row').boundingBox(),boxBox=await box.boundingBox();
    assert.ok(boxBox.y>=rowBox.y+rowBox.height-1&&boxBox.y<rowBox.y+rowBox.height+40,JSON.stringify({rowBox,boxBox}));
    // Clicking Reply on another comment moves the box instead of stacking two.
    await f.page.locator('#feed .comment-item[data-comment-id="12"] > .comment-row .comment-reply-btn').click();
    await f.page.locator('#feed .comment-item[data-comment-id="12"] > .inline-reply-box').waitFor();
    await f.page.waitForFunction(()=>document.querySelectorAll('#feed .inline-comment-box').length===1);
    await f.page.locator('#feed .comment-item[data-comment-id="11"] > .comment-row .comment-reply-btn').click();
    const again=f.page.locator('#feed .comment-item[data-comment-id="11"] > .inline-reply-box input');await again.waitFor();
    await again.fill('收到，谢谢你的评论');
    await f.page.locator('#feed .comment-item[data-comment-id="11"] > .inline-reply-box button',{hasText:'发送'}).click();
    await f.page.waitForFunction(()=>document.querySelector('#feed .comment-item[data-comment-id="11"] .comment-replies .comment-item'));
    assert.deepEqual(sent.map(b=>({post_id:b.post_id,content:b.content,parent:b.parent_comment_id})),[{post_id:postId,content:'收到，谢谢你的评论',parent:'11'}]);
    const nested=f.page.locator('#feed .comment-item[data-comment-id="11"] .comment-replies .comment-item');
    assert.equal(await nested.count(),1);assert.match(await nested.innerText(),/收到，谢谢你的评论/);
    await f.page.waitForFunction(()=>!document.querySelector('#feed .inline-comment-box'));
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('the reply draft survives a realtime refresh of the comments and a plain comment still has no parent',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:1200}});
  try{
    const postId=seed(f),sent=[];await echoReplies(f,sent);
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .comment-item');
    await f.page.locator('#feed .comment-item[data-comment-id="12"] > .comment-row .comment-reply-btn').click();
    const input=f.page.locator('#feed .inline-reply-box input');await input.fill('写了一半的回复');
    // Another user comments: the feed re-renders the comments block for this post.
    await f.page.evaluate(id=>{window.__xtjSchedulePostCardPatch(id);},postId);
    await f.page.waitForTimeout(400);
    assert.equal(await f.page.locator('#feed .comment-item[data-comment-id="12"] > .inline-reply-box input').inputValue(),'写了一半的回复');
    assert.equal(await f.page.locator('#feed .inline-comment-box').count(),1);
    // Normal post-level comment: no parent id is sent.
    await f.page.locator('#feed .actions .action-btn',{hasText:'评论'}).first().click();
    await f.page.waitForFunction(()=>document.querySelectorAll('#feed .inline-comment-box').length===1&&!document.querySelector('#feed .inline-reply-box'));
    await f.page.locator('#feed .inline-comment-inp').fill('普通评论');
    await f.page.locator('#feed .inline-comment-box button',{hasText:'发送'}).click();
    await f.page.waitForFunction(()=>document.body.innerText.includes('普通评论'));
    assert.equal(sent.length,1);assert.equal('parent_comment_id' in sent[0],false);
  }finally{await f.close();}
});

test('replying also works from the post detail dialog',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,viewport:{width:390,height:1200}});
  try{
    const postId=seed(f),sent=[];await echoReplies(f,sent);
    await f.page.reload({waitUntil:'domcontentloaded'});await f.page.waitForSelector('#feed .comment-item');
    await f.page.evaluate(id=>openPostDetail(id),postId);
    const bob=f.page.locator('#postDetailBody .comment-item[data-comment-id="11"]');await bob.waitFor();
    await bob.locator('> .comment-row .comment-reply-btn').click();
    await bob.locator('> .inline-reply-box input').fill('在详情页回复');
    await bob.locator('> .inline-reply-box button',{hasText:'发送'}).click();
    await f.page.waitForFunction(()=>document.querySelector('#postDetailBody .comment-item[data-comment-id="11"] .comment-replies'));
    assert.equal(sent[0].parent_comment_id,'11');
    assert.match(await f.page.locator('#postDetailBody .comment-item[data-comment-id="11"] .comment-replies').innerText(),/在详情页回复/);
  }finally{await f.close();}
});
