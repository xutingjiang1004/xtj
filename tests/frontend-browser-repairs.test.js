'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');
const id=n=>'dddddddd-dddd-4ddd-8ddd-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function use(fn,options={}){const f=await postBrowserFixture({counts:[1,3],publicPosts:true,...options});try{await fn(f);assert.deepEqual(f.errors,[]);}finally{await f.close();}}
function message(n,peer='bob',text='原消息'){return{id:id(n),user_name:'alice',media_url:peer,media_type:'__dm__',content:JSON.stringify({type:'dm',text}),created_at:new Date(Date.now()-60000+n).toISOString()};}
async function chat(f,rows=[message(1)]){
  const states=new Map();
  await f.page.route('**/api/chat/relationship?**',r=>r.fulfill({json:{ok:true,relationship:{status:'friends',can_message:true}}}));
  await f.page.route('**/api/chat/conversations/*',r=>{const peer=new URL(r.request().url()).pathname.split('/').at(-1),state=states.get(peer)||{status:'ok',draft_text:'',draft_revision:0};if(r.request().method()==='PATCH'){state.draft_text=r.request().postDataJSON().draft_text;state.draft_revision++;states.set(peer,state);}return r.fulfill({json:{ok:true,state}});});
  await f.page.route('**/api/dm/messages?**',r=>r.fulfill({json:{ok:true,data:rows,has_more:false}}));
  await f.page.evaluate(()=>openChat('bob'));await f.page.waitForSelector('#dockChatMessages [data-message-id]');
}
async function wall(f,count=1){
  const rows=Array.from({length:count},(_,i)=>({id:id(80+i),user_name:'alice',media_url:f.origin+'/test-image/wall-'+i+'.png',created_at:'2026-10-01T12:00:00Z',views:0,content:JSON.stringify({caption:'隔离照片 '+i,fileSize:1})}));
  await f.page.route('**/api/photos/public?**',r=>r.fulfill({json:{ok:true,data:rows,sort:new URL(r.request().url()).searchParams.get('sort'),has_more:false}}));
  await f.page.route(/\/api\/photo\/[^/]+\/social(?:\?|$)/,r=>r.fulfill({json:{ok:true,comments:[],comment_count:0,like_count:0,views:0,liked:false,has_more:false}}));
  await f.page.locator('.dock-tab[data-tab="ai"]').click();await f.page.waitForSelector('#photoGrid .photo-wall-item');
  return rows;
}
async function preview(f){await f.page.locator('#photoGrid .photo-wall-item').first().click();await f.page.waitForFunction(()=>document.getElementById('ppLikeBtn')&&!document.getElementById('ppLikeBtn').disabled);await f.page.locator('#ppCommentBtn').click();}

test('IME confirmation never sends; ordinary Enter sends once and Shift Enter stays in the composer',()=>use(async f=>{
  await chat(f);const p=f.page,sends=[];
  await p.route('**/api/dm/send',r=>{const b=r.request().postDataJSON();sends.push(b);return r.fulfill({json:{ok:true,message:{...message(2),content:b.content}}});});
  const input=p.locator('#dockChatInput');await input.fill('中文候选');
  await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});
  await p.waitForTimeout(100);assert.equal(sends.length,0);assert.equal(await input.inputValue(),'中文候选');
  await input.dispatchEvent('compositionend');await input.press('Shift+Enter');assert.equal(sends.length,0);
  await input.press('Enter');await p.waitForFunction(()=>document.querySelectorAll('#dockChatMessages .chat-msg-row').length===2);assert.equal(sends.length,1);
}));

test('drop replaces the picker queue and sends exactly the previewed file bytes',()=>use(async f=>{
  await chat(f);const p=f.page,uploads=[],sends=[];
  await p.route('**/api/dm/upload?**',r=>{uploads.push(r.request().postDataBuffer());return r.fulfill({json:{ok:true,storage_path:new URL(r.request().url()).searchParams.get('path'),public_url:f.origin+'/test-image/file.png'}});});
  await p.route('**/api/dm/send',r=>{const b=r.request().postDataJSON();sends.push(b);return r.fulfill({json:{ok:true,message:{...message(2),content:b.content}}});});
  await p.locator('#dockChatFileInp').setInputFiles(['A','B'].map(n=>({name:n+'.txt',mimeType:'text/plain',buffer:Buffer.from(n)})));
  await p.evaluate(()=>{var data=new DataTransfer();data.items.add(new File(['C-bytes'],'C.txt',{type:'text/plain'}));document.querySelector('#dockChatDetailView .chat-input-area').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});
  assert.equal(await p.locator('#dockCfpName').textContent(),'C.txt');assert.equal(await p.locator('#chatAttachmentQueue').count(),0);
  assert.deepEqual(await p.locator('#dockChatFileInp').evaluate(n=>Array.from(n.files,f=>f.name)),['C.txt']);
  await p.getByRole('button',{name:'发送消息',exact:true}).click();await p.waitForSelector('[data-message-id="'+id(2)+'"]');
  assert.equal(sends.length,1);assert.equal(sends[0].file_name,'C.txt');assert.equal(uploads.length,1);assert.deepEqual(uploads[0],Buffer.from('C-bytes'));
}));

test('unstarted batch attachments survive a peer switch and resume without duplicating the first send',()=>use(async f=>{
  await chat(f);const p=f.page,started=deferred(),finish=deferred(),sends=[];
  await p.route('**/api/dm/upload?**',r=>r.fulfill({json:{ok:true,storage_path:new URL(r.request().url()).searchParams.get('path'),public_url:f.origin+'/test-image/file.png'}}));
  await p.route('**/api/dm/send',async r=>{const b=r.request().postDataJSON();sends.push(b);if(sends.length===1){started.resolve();await finish.promise;}await r.fulfill({json:{ok:true,message:{...message(2+sends.length,b.target_user),content:b.content}}});});
  await p.locator('#dockChatFileInp').setInputFiles(['first','second','third'].map(n=>({name:n+'.txt',mimeType:'text/plain',buffer:Buffer.from(n)})));
  await p.getByRole('button',{name:'发送消息',exact:true}).click();await started.promise;
  await p.locator('#dockChatFileInp').setInputFiles({name:'unseen.txt',mimeType:'text/plain',buffer:Buffer.from('must not send')});assert.equal(await p.locator('#dockChatFileInp').evaluate(n=>n.files.length),0);
  await p.evaluate(()=>openChat('carol'));finish.resolve();await p.waitForTimeout(150);
  assert.equal(sends.length,1);await p.evaluate(()=>openChat('bob'));await p.waitForFunction(()=>document.getElementById('dockCfpName').textContent==='second.txt');
  assert.deepEqual(await p.locator('#dockChatFileInp').evaluate(n=>Array.from(n.files,f=>f.name)),['second.txt','third.txt']);
  await p.getByRole('button',{name:'发送消息',exact:true}).click();await p.waitForFunction(()=>document.getElementById('dockChatFilePreview').classList.contains('hidden'));await p.waitForTimeout(250);
  assert.deepEqual(sends.map(b=>b.file_name),['first.txt','second.txt','third.txt']);assert.ok(sends.every(b=>b.target_user==='bob'));
}));

test('editing has a separate draft, restores the normal draft on cancel and keeps text entered during save',()=>use(async f=>{
  await chat(f);const p=f.page,input=p.locator('#dockChatInput');await input.fill('未发送草稿');
  await p.locator('#dockChatMessages [data-message-id]').click({button:'right'});await p.getByRole('button',{name:'编辑',exact:true}).click();await input.fill('编辑中的消息');
  await p.locator('#chatMessageContextClose').click();assert.equal(await input.inputValue(),'未发送草稿');
  await p.evaluate(()=>openChat('carol'));await p.evaluate(()=>openChat('bob'));assert.equal(await input.inputValue(),'未发送草稿');
  await p.locator('#dockChatMessages [data-message-id]').click({button:'right'});await p.getByRole('button',{name:'编辑',exact:true}).click();await input.fill('保存编辑');
  await p.locator('#dockChatFileInp').setInputFiles(['draft-one','draft-two'].map(n=>({name:n+'.txt',mimeType:'text/plain',buffer:Buffer.from(n)})));
  const started=deferred(),finish=deferred();await p.route('**/api/chat/messages/edit',async r=>{started.resolve();await finish.promise;return r.fulfill({json:{ok:true,message:message(1,'bob','保存编辑')}});});
  await p.getByRole('button',{name:'发送消息',exact:true}).click();await started.promise;await input.fill('等待期间写的新草稿');finish.resolve();await p.waitForTimeout(200);assert.equal(await input.inputValue(),'等待期间写的新草稿');assert.equal(await p.locator('#chatMessageContext').isHidden(),true);
  assert.deepEqual(await p.locator('#dockChatFileInp').evaluate(n=>Array.from(n.files,f=>f.name)),['draft-one.txt','draft-two.txt']);assert.equal(f.calls.filter(c=>c.path==='/api/dm/upload').length,0);
  await p.evaluate(()=>openChat('carol'));await p.evaluate(()=>openChat('bob'));assert.equal(await input.inputValue(),'等待期间写的新草稿');
}));

test('the latest history jump wins when same-peer context requests finish out of order',()=>use(async f=>{
  await chat(f);const p=f.page,requests=[];
  await p.route('**/api/chat/history/context?**',r=>requests.push(r));
  await p.evaluate(([a,b])=>{jumpChatHistory('bob',a);jumpChatHistory('bob',b);},[id(10),id(11)]);
  await p.waitForTimeout(100);assert.equal(requests.length,2);
  await requests[1].fulfill({json:{ok:true,focus_id:id(11),data:[message(11,'bob','后选中的消息')]}});await p.waitForSelector('[data-message-id="'+id(11)+'"]');
  await requests[0].fulfill({json:{ok:true,focus_id:id(10),data:[message(10,'bob','已过期定位')]}});await p.waitForTimeout(150);
  assert.equal(await p.locator('[data-message-id="'+id(11)+'"]').count(),1);assert.equal(await p.locator('[data-message-id="'+id(10)+'"]').count(),0);
}));

test('a keyboard user can select text messages, open actions, traverse them and return focus',()=>use(async f=>{
  await chat(f,[message(1),message(2)]);const p=f.page;await p.locator('#dockChatMessages').focus();await p.keyboard.press('ArrowUp');
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.messageId),id(2));await p.keyboard.press('Shift+F10');
  await p.waitForSelector('.dm-action-overlay.active');assert.equal(await p.evaluate(()=>document.activeElement.closest('.dm-action-panel')!==null),true);
  await p.keyboard.press('End');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement===document.querySelector('.dm-action-panel button')),true);
  await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.dataset.messageId),id(2));
  assert.equal(await p.locator('.chat-msg-row[tabindex="0"]').count(),0);
}));

test('post publishing preserves a newer draft and filters have named dates with reversed-range feedback',()=>use(async f=>{
  const p=f.page,started=deferred(),finish=deferred();
  await p.route('**/api/post/create',async r=>{const b=r.request().postDataJSON();started.resolve();await finish.promise;return r.fulfill({json:{ok:true,data:{...b,id:id(70),user_name:'alice',created_at:new Date().toISOString()}}});});
  await p.locator('#postInp').fill('本次发布');await p.getByRole('button',{name:'发动态',exact:true}).click();await started.promise;
  await p.locator('#postInp').fill('下一条草稿');finish.resolve();await p.waitForFunction(()=>!document.getElementById('pubBtn').disabled);assert.equal(await p.locator('#postInp').inputValue(),'下一条草稿');
  await p.evaluate(()=>toggleFilterPanel());await p.locator('#postFilterPanel').getByLabel('开始日期',{exact:true}).fill('2026-10-15');await p.locator('#postFilterPanel').getByLabel('结束日期',{exact:true}).fill('2026-10-01');
  await p.waitForFunction(()=>!document.getElementById('postDateError').hidden);assert.equal(await p.locator('#postFilterPanel').getByLabel('结束日期',{exact:true}).getAttribute('aria-invalid'),'true');assert.ok(await p.getByLabel('帖子可见状态').count());
  assert.equal(await p.locator('#postFilterSummary').textContent(),'请调整日期范围');assert.ok(await p.locator('#postStartDate').evaluate(n=>n.getBoundingClientRect().height<60));
  await p.evaluate(()=>clearPostFilters());assert.equal(await p.locator('#postDateError').isHidden(),true);
}));

test('comment-only feed search uses server matches beyond previews and a failed search offers retry',()=>use(async f=>{
  const p=f.page,queries=[];let fail=false;
  await p.route('**/api/feed?**',r=>{const q=new URL(r.request().url()).searchParams;queries.push(Object.fromEntries(q));if(q.has('q')&&fail)return r.fulfill({status:503,json:{ok:false,error:'隔离搜索失败'}});return r.fulfill({json:{ok:true,posts:f.posts,comments:f.comments.slice(0,3),likes:[],next_offset:2,endReached:true}});});
  await p.evaluate(()=>toggleFilterPanel());await p.locator('#postSearchInput').fill('第1505条评论中的唯一文字');await p.waitForFunction(()=>document.querySelector('#feed .post'));
  await p.waitForTimeout(450);assert.ok(queries.some(q=>q.q==='第1505条评论中的唯一文字'));assert.equal(await p.locator('#feed > .post').count(),2);
  fail=true;await p.locator('#postSearchInput').fill('失败搜索');await p.waitForSelector('#feedBootError');assert.match(await p.locator('#feedBootError').innerText(),/重试/);
}));

test('guest chat exposes the existing login flow and returns to chat after login',()=>use(async f=>{
  const p=f.page;await p.evaluate(()=>{doLogout();switchDockTab('chat',true);});await p.locator('.chat-guest-login').click();await p.waitForSelector('#loginModal.active');
  await p.route('**/api/user/login',r=>r.fulfill({json:{ok:true,user_name:'alice',token:'local-test-login'}}));
  await p.evaluate(async()=>{loginNickInp.value='alice';loginPwInp.value='test-only';await doLogin();});assert.equal(await p.locator('#panelChat').evaluate(n=>n.classList.contains('active')),true);
}));

test('photo comment draft and uncertain request identity survive close, photo switch and retry',()=>use(async f=>{
  await wall(f,2);const p=f.page,keys=[];let committed=null;
  await p.route(/\/api\/photo\/[^/]+\/comments$/,r=>{const b=r.request().postDataJSON();keys.push(b.client_request_id);committed||={id:'810',user_name:'alice',content:b.content,created_at:new Date().toISOString()};return keys.length===1?r.fulfill({status:503,json:{ok:false,error:'已提交但响应丢失'}}):r.fulfill({json:{ok:true,comment:committed,comment_count:1}});});
  await preview(f);await p.locator('#ppCommentInput').fill('保留的照片评论');await p.locator('#ppCommentSend').click();await p.waitForFunction(()=>document.getElementById('ppCommentError').textContent.includes('响应丢失'));
  await p.evaluate(()=>forceClosePhotoPreview());await p.waitForTimeout(50);
  await p.locator('#photoGrid .photo-wall-item').nth(1).click();await p.locator('#ppCommentBtn').click();assert.equal(await p.locator('#ppCommentInput').inputValue(),'');await p.locator('#ppCommentInput').fill('另一张照片草稿');
  await p.evaluate(()=>forceClosePhotoPreview());await p.waitForTimeout(50);await preview(f);assert.equal(await p.locator('#ppCommentInput').inputValue(),'保留的照片评论');
  await p.locator('#ppCommentSend').click();await p.waitForFunction(()=>document.getElementById('ppCommentInput').value==='');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  await p.locator('#ppCommentInput').fill('保留的照片评论');await p.locator('#ppCommentSend').click();await p.waitForFunction(()=>document.getElementById('ppCommentInput').value==='');assert.notEqual(keys[2],keys[1]);
  await p.locator('#ppCommentInput').fill('仅此登录可见');await p.evaluate(()=>{forceClosePhotoPreview();doLogout();});
  await p.route('**/api/user/login',r=>r.fulfill({json:{ok:true,user_name:'alice',token:'new-isolated-session'}}));await p.evaluate(async()=>{loginNickInp.value='alice';loginPwInp.value='test';await doLogin();});await p.waitForSelector('#photoGrid .photo-wall-item');await preview(f);assert.equal(await p.locator('#ppCommentInput').inputValue(),'');
}));

test('wall failure with cached photos exposes retry, restores the confirmed sort and hides nonretryable actions',()=>use(async f=>{
  await wall(f);const p=f.page;let retryable=true;
  await p.route('**/api/photos/public?**',r=>r.fulfill({status:503,json:{ok:false,error:'隔离服务不可用',retryable}}));
  await p.locator('#pwAlbumSort').selectOption('views');await p.waitForFunction(()=>document.getElementById('pwSyncStatus').classList.contains('is-error'));
  assert.equal(await p.locator('#pwSyncStatus').isVisible(),true);assert.match(await p.locator('#pwSyncLabel').innerText(),/缓存/);assert.equal(await p.locator('#pwAlbumSort').inputValue(),'date_desc');assert.equal(await p.locator('#photoGrid .photo-wall-item').count(),1);assert.equal(await p.locator('#pwSyncRetry').isVisible(),true);
  retryable=false;await p.locator('#pwSyncRetry').click();
  // The syncing state also hides Retry. Wait for this request's final error,
  // rather than observing the transient start of the retry as its completion.
  await p.waitForFunction(()=>window.photoWallLoadError?.retryable===false && document.getElementById('pwSyncStatus').classList.contains('is-error') && document.getElementById('pwSyncRetry').hidden);
  assert.equal(await p.locator('#pwSyncStatus').isVisible(),true);
}));

test('closing and reopening a photo during comment submission retains the in-flight operation and its acknowledgement',()=>use(async f=>{
  await wall(f);const p=f.page,started=deferred(),finish=deferred();let sends=0;
  await p.route(/\/api\/photo\/[^/]+\/comments$/,async r=>{sends++;const b=r.request().postDataJSON();started.resolve();await finish.promise;return r.fulfill({json:{ok:true,comment:{id:'900',user_name:'alice',content:b.content,created_at:new Date().toISOString()},comment_count:1}});});
  await preview(f);await p.locator('#ppCommentInput').fill('在途评论');await p.locator('#ppCommentSend').click();await started.promise;
  await p.evaluate(()=>forceClosePhotoPreview());await p.waitForTimeout(30);await preview(f);assert.equal(await p.locator('#ppCommentInput').inputValue(),'在途评论');assert.equal(await p.locator('#ppCommentSend').isDisabled(),true);
  finish.resolve();await p.waitForFunction(()=>!document.getElementById('ppCommentSend').disabled);assert.equal(await p.locator('#ppCommentInput').inputValue(),'');assert.equal(sends,1);
}));

test('dark file links and message metadata reach WCAG AA contrast inside and outside bubbles',()=>use(async f=>{
  const rows=[message(1),{...message(2),content:JSON.stringify({type:'dm',text:'',read_at:'2026-10-01T12:00:00Z',media:{kind:'file',name:'document.txt',url:f.origin+'/test-image/file.png'}})},{...message(3),content:JSON.stringify({type:'dm',text:'',media:{kind:'image',url:f.origin+'/test-image/photo.png'}})}];
  await chat(f,rows);await f.page.waitForTimeout(400);
  const ratios=await f.page.evaluate(()=>{
    function color(s){return(s.match(/[\d.]+/g)||[]).map(Number);}
    function over(a,b){var alpha=a.length>3?a[3]:1;return[0,1,2].map(i=>a[i]*alpha+b[i]*(1-alpha));}
    function background(node){var chain=[];while(node){chain.unshift(node);node=node.parentElement;}return chain.reduce((c,n)=>over(color(getComputedStyle(n).backgroundColor),c),[255,255,255]);}
    function lum(c){var a=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*a[0]+.7152*a[1]+.0722*a[2];}
    return Array.from(document.querySelectorAll('#dockChatMessages .chat-file-link,#dockChatMessages .msg-time,#dockChatMessages .msg-read-status')).map(n=>{var bg=background(n),fg=over(color(getComputedStyle(n).color),bg),a=lum(fg),b=lum(bg);return{text:n.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  });
  assert.ok(ratios.length>=4);for(const item of ratios)assert.ok(item.ratio>=4.5,JSON.stringify(item));
},{theme:'dark'}));
