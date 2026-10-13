'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
const id=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function use(fn,options={}){const f=await postBrowserFixture({counts:[4],publicPosts:true,...options});try{await fn(f);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
function message(n,peer='bob',owner='alice'){return {id:id(n),media_type:'__dm__',user_name:owner,media_url:peer,created_at:new Date(Date.UTC(2026,9,12,12,n)).toISOString(),content:JSON.stringify({type:'dm',text:peer+' message '+n})};}
async function chat(f,rows){await f.page.route('**/api/chat/relationship?**',r=>r.fulfill({json:{ok:true,relationship:{status:'friends',can_message:true}}}));await f.page.route('**/api/dm/messages?**',r=>r.fulfill({json:{ok:true,data:typeof rows==='function'?rows(new URL(r.request().url()).searchParams.get('target')):rows}}));await f.page.evaluate(()=>openChat('bob'));if(!Array.isArray(rows)||rows.length)await f.page.waitForSelector('#dockChatMessages [data-message-id]');}
async function wall(f,count=12,social){const rows=Array.from({length:count},(_,i)=>({id:id(i+1),user_name:i%2?'bob':'alice',media_url:f.origin+'/test-image/wall-'+i+'.png',created_at:new Date(Date.UTC(2026,9,12,12)-i*86400000).toISOString(),views:i,content:JSON.stringify({caption:'照片 '+i,fileSize:(i+1)*1024})}));
 await f.page.route('**/api/photos/public?**',r=>{const u=new URL(r.request().url()),sort=u.searchParams.get('sort'),limit=Number(u.searchParams.get('limit'));let sorted=rows.slice();if(sort==='date_asc')sorted.reverse();if(sort==='name')sorted.sort((a,b)=>a.user_name.localeCompare(b.user_name)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));if(sort==='views'||sort==='size')sorted.reverse();const cursor=u.searchParams.get('cursor'),start=cursor?sorted.findIndex(p=>p.id===JSON.parse(cursor).id)+1:Number(u.searchParams.get('page'))*limit,page=sorted.slice(start,start+limit),more=start+limit<rows.length,last=page.at(-1);return r.fulfill({json:{ok:true,data:page,sort,has_more:more,next_cursor:more?{sort,id:last.id,at:last.created_at,value:sort==='name'?last.user_name:sort==='views'?String(last.views):String(JSON.parse(last.content).fileSize)}:null}});});
 await f.page.route(/\/api\/photo\/[^/]+\/social(?:\?|$)/,r=>r.fulfill({json:social?social(new URL(r.request().url())):{ok:true,comments:[],comment_count:0,like_count:0,views:0,liked:false,has_more:false}}));await f.page.locator('.dock-tab[data-tab="ai"]').click();await f.page.waitForSelector('#photoGrid .photo-wall-item');return rows;}
async function preview(f){await f.page.locator('#photoGrid .photo-wall-item').first().click();await f.page.waitForSelector('#photoPreviewOverlay.active');await f.page.waitForFunction(()=>document.getElementById('ppLikeBtn')&&!document.getElementById('ppLikeBtn').disabled);}

test('withdrawal body cannot cross a peer switch, including its success toast',{timeout:45000},()=>use(async f=>{
 const old=message(1),other=message(2,'carol');await chat(f,peer=>peer==='bob'?[old]:[other]);
 await f.page.evaluate(()=>{const base=fetch;window.__withdrawToasts=[];const toast=showToast;window.showToast=t=>{__withdrawToasts.push(t);toast(t);};window.fetch=(url,opts)=>new URL(url,location.href).pathname==='/api/dm/withdraw'?Promise.resolve(new Response(new ReadableStream({start(c){window.__withdrawBody=c;}}),{headers:{'Content-Type':'application/json'}})):base(url,opts);});
 await f.page.evaluate(x=>{window.__withdrawTask=withdrawDMMessage(x);},old.id);await f.page.waitForFunction(()=>!!window.__withdrawBody);
 await f.page.evaluate(()=>openChat('carol'));await f.page.waitForFunction(()=>document.getElementById('dockChatMessages').textContent.includes('carol message'));
 await f.page.evaluate(row=>{__withdrawBody.enqueue(new TextEncoder().encode(JSON.stringify({ok:true,message:{...row,content:JSON.stringify({type:'dm',withdrawn:true,text:''})}})));__withdrawBody.close();},old);await f.page.evaluate(()=>__withdrawTask);
 assert.equal(await f.page.locator('#dockChatMessages [data-message-id="'+old.id+'"]').count(),0);assert.deepEqual(await f.page.evaluate(()=>__withdrawToasts),[]);
}));
test('withdrawal JSON after logout/login never enters the new account cache',{timeout:45000},()=>use(async f=>{
 const old=message(3),fresh=message(4,'carol','bob');await chat(f,peer=>peer==='bob'?[old]:[fresh]);
 await f.page.evaluate(()=>{const base=fetch;window.fetch=(url,opts)=>new URL(url,location.href).pathname==='/api/dm/withdraw'?Promise.resolve(new Response(new ReadableStream({start(c){window.__withdrawBody=c;}}),{headers:{'Content-Type':'application/json'}})):base(url,opts);});
 await f.page.evaluate(x=>{window.__withdrawTask=withdrawDMMessage(x);},old.id);await f.page.waitForFunction(()=>!!window.__withdrawBody);
 for(const action of ['login','refresh'])await f.page.route('**/api/user/'+action,r=>r.fulfill({json:{ok:true,user_name:'bob',token:'isolated-bob'}}));
 await f.page.evaluate(()=>doLogout());await f.page.evaluate(async()=>{document.getElementById('loginNickInp').value='bob';document.getElementById('loginPwInp').value='isolated-password';await doLogin();});await f.page.waitForFunction(()=>currentUser==='bob');
 await f.page.evaluate(()=>openChat('carol'));await f.page.waitForFunction(()=>document.getElementById('dockChatMessages').textContent.includes('carol message'));
 await f.page.evaluate(row=>{__withdrawBody.enqueue(new TextEncoder().encode(JSON.stringify({ok:true,message:{...row,content:JSON.stringify({withdrawn:true,text:''})}})));__withdrawBody.close();},old);assert.equal(await f.page.evaluate(()=>__withdrawTask),false);
 assert.equal(await f.page.locator('#dockChatMessages [data-message-id="'+old.id+'"]').count(),0);
}));
test('committed withdrawal with cleanup failure removes original content and explains the partial result',{timeout:45000},()=>use(async f=>{
 const row=message(5);await chat(f,[row]);await f.page.route('**/api/dm/withdraw',r=>r.fulfill({status:503,json:{ok:false,withdrawn:true,code:'DM_CLEANUP_QUEUE_FAILED',error:'Message withdrawn but cleanup failed',retryable:true}}));
 assert.equal(await f.page.evaluate(x=>withdrawDMMessage(x),row.id),true);assert.ok(!(await f.page.locator('#dockChatMessages').textContent()).includes('bob message 5'));assert.ok((await f.page.locator('.toast').allTextContents()).some(t=>t.includes('消息已撤回')));
}));
test('detail snapshot started before the like ACK is re-read instead of reverting it',{timeout:45000},()=>use(async f=>{
 const like=deferred(),detail=deferred(),likeStarted=deferred(),detailStarted=deferred();let reads=0;
 await f.page.route('**/api/post/like',async r=>{likeStarted.resolve();await like.promise;return r.fulfill({json:{ok:true,liked:true,like_count:1}});});
 await f.page.route('**/api/post/detail/*',async r=>{reads++;if(reads===1){detailStarted.resolve();await detail.promise;}return r.fulfill({json:{ok:true,post:{...f.posts[0],like_count:reads===1?0:1,comment_count:0,liked_by_me:reads>1},likes:reads>1?[{id:91,user_name:'alice',created_at:'2026-10-12T12:00:00Z'}]:[],comments:[]}});});
 await f.page.evaluate(x=>{window.__likeTask=toggleLike(document.querySelector('#feed .like-btn'),x);},f.posts[0].id);await likeStarted.promise;
 await f.page.evaluate(x=>{window.__detailTask=openPostDetail(x);},f.posts[0].id);await detailStarted.promise;like.resolve();await f.page.evaluate(()=>__likeTask);detail.resolve();await f.page.evaluate(()=>__detailTask);
 assert.equal(await f.page.locator('#postDetailBody .like-btn').getAttribute('aria-pressed'),'true');assert.match(await f.page.locator('#postDetailBody .post-stats-text').textContent(),/点赞 1/);assert.equal(reads,2);
}));
test('parent deletion removes descendant rows and counts without waiting for Realtime',{timeout:45000},()=>use(async f=>{
 const parent=f.comments[0],child=f.comments[1];f.posts[0].comment_count=2;await f.page.evaluate(()=>loadFeed(true));
 await f.page.route('**/api/post/comment/*',r=>r.fulfill({json:{ok:true,post_id:parent.post_id,deleted_comment_ids:[parent.id,child.id],comment_count:0}}));
 await f.page.evaluate(x=>{window.confirm=()=>true;return deleteFeedComment(x);},parent.id);
 await f.page.waitForFunction(x=>!document.querySelector('#feed [data-comment-id="'+x+'"]'),child.id);
 assert.equal(await f.page.locator('#feed [data-comment-id="'+parent.id+'"]').count(),0);assert.match(await f.page.locator('#feed .post-stats-text').first().textContent(),/评论 0/);
}));
test('post comment retries preserve one intent key and a repeated new intent uses a new key',{timeout:45000},()=>use(async f=>{
 const bodies=[],receipts=new Map();let lost=true;
 await f.page.route('**/api/post/comment',r=>{const body=r.request().postDataJSON();bodies.push(body);if(!receipts.has(body.client_request_id))receipts.set(body.client_request_id,{id:700+receipts.size,post_id:body.post_id,user_name:'alice',content:body.content,created_at:new Date().toISOString()});if(lost){lost=false;return r.fulfill({status:503,json:{ok:false,error:'确认丢失'}});}return r.fulfill({json:{ok:true,data:receipts.get(body.client_request_id)}});});
 const send=f.page.locator('.inline-comment-box button').filter({hasText:'发送'});
 await f.page.evaluate(x=>openComment(x),f.posts[0].id);await f.page.locator('.inline-comment-inp').fill('同一内容');await send.click();await f.page.waitForFunction(()=>document.querySelector('.inline-comment-box button').textContent==='发送');await send.click();await f.page.waitForFunction(()=>document.querySelector('.inline-comment-box').style.opacity==='0');
 await f.page.waitForFunction(()=>!document.querySelector('.inline-comment-box'));await f.page.evaluate(x=>openComment(x),f.posts[0].id);await f.page.locator('.inline-comment-inp').fill('同一内容');await send.click();
 assert.equal(bodies.length,3);assert.equal(bodies[0].client_request_id,bodies[1].client_request_id);assert.notEqual(bodies[1].client_request_id,bodies[2].client_request_id);assert.equal(receipts.size,2);
}));
test('DM history follows compound cursors beyond 180 and retains an anchored bounded window through refresh',{timeout:45000},()=>use(async f=>{
 const rows=Array.from({length:620},(_,n)=>({...message(n+1),created_at:'2026-10-12T12:00:00.123456Z'}));const cursors=[];
 await chat(f,[]);
 await f.page.route('**/api/dm/messages?**',r=>{const u=new URL(r.request().url()),cursor=u.searchParams.get('cursor');if(cursor)cursors.push(cursor);let end=cursor?rows.findIndex(row=>row.id===cursor.split('|')[1]):rows.length;const page=rows.slice(Math.max(0,end-180),end);return r.fulfill({json:{ok:true,data:page,has_more:end>180,next_cursor:page.length?page[0].created_at+'|'+page[0].id:null}});});
 await f.page.route('**/api/dm/messages/loaded',r=>{const ids=new Set(r.request().postDataJSON().ids);return r.fulfill({json:{ok:true,data:rows.filter(row=>ids.has(row.id)).map(row=>row.id===rows[0].id?{...row,content:JSON.stringify({type:'dm',text:'history-authority-proof'})}:row)}});});
 await f.page.evaluate(()=>loadDockChatMessages('bob',true,true,true));await f.page.waitForSelector('.chat-history-more');
 for(let i=0;i<3;i++){await f.page.locator('.chat-history-more').click();await f.page.waitForFunction(()=>!document.querySelector('.chat-history-more')||!document.querySelector('.chat-history-more').disabled);}
 assert.equal(await f.page.locator('#dockChatMessages [data-message-id="'+rows[0].id+'"]').count(),1);assert.ok(await f.page.locator('#dockChatMessages .chat-msg-row').count()<=360);assert.deepEqual(cursors,[440,260,80].map(n=>rows[n].created_at+'|'+rows[n].id));
 await f.page.evaluate(()=>loadDockChatMessages('bob',false,true));await f.page.waitForFunction(()=>document.getElementById('dockChatMessages').textContent.includes('history-authority-proof'));
 assert.equal(await f.page.locator('.chat-history-more').count(),0);
}));
test('photo sorting starts a fresh global page and preserves the selected cursor order',{timeout:45000},()=>use(async f=>{
 const rows=await wall(f,125);await f.page.locator('#pwAlbumSort').selectOption('date_asc');await f.page.waitForFunction(x=>pwCurrentSortedPhotos[0].id===x,rows.at(-1).id);
 assert.equal(await f.page.evaluate(()=>photoWallData.length),60);await f.page.evaluate(()=>loadMorePhotos());await f.page.evaluate(()=>renderPhotoWallWithoutReload());
 const loaded=await f.page.evaluate(()=>pwCurrentSortedPhotos.map(p=>p.id));assert.deepEqual(loaded,rows.slice().reverse().slice(0,120).map(row=>row.id));
 await f.page.locator('#pwAlbumSort').selectOption('views');await f.page.waitForFunction(()=>document.getElementById('pwSyncLabel').textContent==='已同步');assert.equal(await f.page.evaluate(()=>photoWallData.length),60);
}));
test('photo social refresh preserves loaded pages and removes remotely deleted known rows',{timeout:45000},()=>use(async f=>{
 let rows=Array.from({length:65},(_,i)=>({id:500+i,user_name:'bob',content:'照片评论 '+i,created_at:new Date(Date.UTC(2026,9,12,12)-i*60000).toISOString()}));let refreshes=0;
 await wall(f,12,u=>{if(u.searchParams.has('known'))refreshes++;const before=u.searchParams.get('before'),start=before?rows.findIndex(row=>String(row.id)===before)+1:0,page=rows.slice(start,start+30),known=(u.searchParams.get('known')||'').split(',').filter(Boolean);return {ok:true,liked:false,like_count:0,views:0,comment_count:rows.length,comments:page,has_more:start+30<rows.length,next_cursor:start+30<rows.length?String(page.at(-1).id):null,known_ids:known,retained_comments:rows.filter(row=>known.includes(String(row.id)))};});
 await preview(f);await f.page.locator('#ppCommentBtn').click();await f.page.locator('#ppCommentsMore').click();await f.page.waitForFunction(()=>document.querySelectorAll('.pp-comment-row').length===60);
 rows=rows.filter(row=>row.id!==550);await f.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await f.page.waitForFunction(()=>document.querySelectorAll('.pp-comment-row').length===59);
 assert.ok(refreshes>0);assert.ok(!(await f.page.locator('#ppCommentsList').textContent()).includes('照片评论 50'));assert.equal(await f.page.locator('#ppCommentCount').textContent(),'64');
 await f.page.locator('#ppCommentsMore').click();await f.page.waitForFunction(()=>document.querySelectorAll('.pp-comment-row').length===64);
}));
test('a pending old-photo comment page cannot keep the next-photo button disabled',{timeout:45000},()=>use(async f=>{
 await wall(f,12,()=>({ok:true,comments:[{id:10,user_name:'bob',content:'第一页',created_at:'2026-10-12T12:00:00Z'}],comment_count:60,like_count:0,views:0,liked:false,has_more:true,next_cursor:'10'}));await preview(f);await f.page.locator('#ppCommentBtn').click();
 await f.page.evaluate(()=>{const base=fetch;window.fetch=(url,opts)=>new URL(url,location.href).pathname.endsWith('/social')&&new URL(url,location.href).searchParams.has('before')?new Promise(resolve=>{window.__releaseMore=()=>resolve(new Response(JSON.stringify({ok:true,comments:[],has_more:false,next_cursor:null}),{headers:{'Content-Type':'application/json'}}));}):base(url,opts);});
 await f.page.locator('#ppCommentsMore').click();await f.page.waitForFunction(()=>!!window.__releaseMore);await f.page.evaluate(()=>ppNextPhoto());await f.page.waitForFunction(()=>!document.getElementById('ppLikeBtn').disabled);await f.page.locator('#ppCommentBtn').click();await f.page.evaluate(()=>__releaseMore());
 assert.equal(await f.page.locator('#ppCommentsMore').isDisabled(),false);
}));
test('detail comment and like pagination has accurate totals and bounded DOM',{timeout:45000},()=>use(async f=>{
 const comments=Array.from({length:5000},(_,i)=>({id:i+1,post_id:f.posts[0].id,user_name:'bob',content:'comment '+i,created_at:'2026-10-12T12:00:00.123456Z'})),likes=Array.from({length:151},(_,i)=>({id:i+1,post_id:f.posts[0].id,user_name:'user'+i,created_at:'2026-10-12T12:00:00.123456Z'}));
 await f.page.route('**/api/post/detail/*',r=>r.fulfill({json:{ok:true,post:{...f.posts[0],comment_count:5000,like_count:151,liked_by_me:false},comments:comments.slice(0,30),likes:likes.slice(0,50),comments_page:{has_more:true,next_cursor:'30'},likes_page:{has_more:true,next_cursor:'50'}}}));
 await f.page.route('**/api/post/detail/*/relations/*?**',r=>{const u=new URL(r.request().url()),kind=u.pathname.split('/').at(-1),start=Number(u.searchParams.get('cursor')),limit=Number(u.searchParams.get('limit')),rows=kind==='comments'?comments:likes;return r.fulfill({json:{ok:true,data:rows.slice(start,start+limit),has_more:start+limit<rows.length,next_cursor:String(start+limit)}});});
 await f.page.evaluate(x=>openPostDetail(x),f.posts[0].id);assert.equal(await f.page.locator('#postDetailBody .comment-item').count(),30);assert.equal(await f.page.locator('#postDetailBody .post-detail-mini-row').count(),50);
 await f.page.locator('.post-detail-comments-panel').getByRole('button',{name:'下一页'}).click();await f.page.waitForFunction(()=>document.querySelector('.post-detail-comments-panel').textContent.includes('31–60'));assert.equal(await f.page.locator('#postDetailBody .comment-item').count(),30);
 await f.page.locator('.post-detail-likes-panel').getByRole('button',{name:'下一页'}).click();await f.page.waitForFunction(()=>document.querySelector('.post-detail-likes-panel').textContent.includes('51–100'));assert.equal(await f.page.locator('#postDetailBody .post-detail-mini-row').count(),50);
 assert.match(await f.page.locator('#postDetailBody .post-stats-text').textContent(),/点赞 151 \| 评论 5000/);
 await f.page.route('**/api/post/comment',r=>r.fulfill({json:{ok:true,data:{id:5001,post_id:f.posts[0].id,user_name:'alice',content:'visible after a paginated submit',created_at:'2026-10-13T12:00:00Z'},comment_count:5001}}));
 await f.page.locator('#postDetailBody').getByRole('button',{name:'评论',exact:true}).click();await f.page.locator('#postDetailBody .inline-comment-inp').fill('visible after a paginated submit');await f.page.locator('#postDetailBody .inline-comment-inp').press('Enter');
 await f.page.waitForFunction(()=>document.querySelector('.post-detail-recent-comments')?.textContent.includes('visible after a paginated submit'));assert.ok(await f.page.locator('#postDetailBody .comment-item').count()<=35);
 await f.page.locator('.post-detail-comments-panel').getByRole('button',{name:'下一页'}).click();await f.page.waitForFunction(()=>document.querySelector('.post-detail-comments-panel').textContent.includes('61–90'));assert.ok(await f.page.locator('#postDetailBody .comment-item').count()<=35);
 await f.page.route('**/api/post/comment/5001',r=>r.fulfill({json:{ok:true,deleted_comment_ids:[5001],comment_count:5000,post_id:f.posts[0].id}}));await f.page.evaluate(()=>{window.confirm=()=>true;return deleteFeedComment('5001');});await f.page.waitForFunction(()=>!document.querySelector('#postDetailBody [data-comment-id="5001"]'));assert.match(await f.page.locator('#postDetailBody .post-stats-text').textContent(),/评论 5000/);
}));
test('photo keyboard activation, modal Tab containment, focus return and inactive panels',{timeout:45000},()=>use(async f=>{
 await wall(f);const card=f.page.locator('#photoGrid .photo-wall-item').first();await f.page.locator('#photoUploadBtn').focus();await f.page.keyboard.press('Tab');assert.equal(await f.page.evaluate(()=>document.activeElement.closest('.photo-wall-item')!==null),true);
 await f.page.keyboard.press('Enter');await f.page.waitForSelector('#photoPreviewOverlay.active');for(let i=0;i<25;i++){await f.page.keyboard.press(i%5===0?'Shift+Tab':'Tab');assert.equal(await f.page.evaluate(()=>document.getElementById('photoPreviewOverlay').contains(document.activeElement)),true);}
 await f.page.keyboard.press('Escape');await f.page.waitForFunction(()=>!document.getElementById('photoPreviewOverlay').classList.contains('active'));assert.equal(await card.evaluate(e=>e===document.activeElement),true);
 assert.equal(await f.page.locator('#panelProfile').evaluate(e=>e.inert),true);assert.equal(await f.page.locator('#pwUploadSheet').evaluate(e=>e.inert),true);assert.equal(await f.page.locator('#photoFileInput').getAttribute('tabindex'),'-1');
}));
test('research records scroll by keyboard, image attachments have alt text, and page magnification reaches 200 percent',{timeout:45000},()=>use(async f=>{
 await wireAiChat(f.page);await f.page.evaluate(()=>__xtjAiAgent.openConversation('REPAIRDEEP1','deep_think'));await f.page.waitForSelector('#dtInput');
 await f.page.locator('#dtFileInp').setInputFiles({name:'original-repair.png',mimeType:'image/png',buffer:f.png});await f.page.waitForSelector('#dtFilePreview img');assert.equal(await f.page.locator('#dtFilePreview img').getAttribute('alt'),'');
 await f.page.evaluate(()=>{const region=document.getElementById('dtMessages');region.replaceChildren();for(let i=0;i<100;i++){const row=document.createElement('p');row.textContent='本地研究历史 '+i+'，检查真实键盘滚动。'.repeat(8);region.appendChild(row);}region.scrollTop=0;});
 await f.page.locator('#dtMessages').focus();await f.page.keyboard.press('PageDown');await f.page.waitForFunction(()=>document.getElementById('dtMessages').scrollTop>0);assert.equal(await f.page.locator('#dtMessages').getAttribute('aria-label'),'深入研究记录');
 const session=await f.page.context().newCDPSession(f.page);await session.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});assert.equal(await f.page.evaluate(()=>visualViewport.scale),2);
 const gestures=await f.page.evaluate(()=>{const e=new Event('gesturestart',{bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented;});assert.equal(gestures,false);
}));
