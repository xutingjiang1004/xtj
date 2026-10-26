'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');
const id='11111111-1111-4111-8111-000000000001';
const row=f=>({id,user_name:'alice',media_type:'__photo_wall__',media_url:f.origin+'/test-image/0-0.png',visibility:'public',created_at:'2026-10-18T12:00:00Z',content:'{}'});
async function wall(f,read=()=>[]){
 await f.page.route('**/api/photos/public?*',r=>r.fulfill({json:{ok:true,data:read(),sort:'date_desc',has_more:false,next_cursor:null}}));
 await f.page.locator('[data-desktop-tab="ai"], [data-tab="ai"]').filter({visible:true}).first().click();
 // Lazy entry-point functions can exist before the upload component binds its
 // input. This fixture bypasses the chooser, so wait for that binding as well.
 await f.page.waitForFunction(()=>typeof window.triggerPhotoWallUpload==='function'&&typeof window.renderPhotoWallWithoutReload==='function'&&document.getElementById('photoFileInput')?.__xtjUploadBound===true&&!document.querySelector('#photoGrid .pw-wall-loading'));
 // Let the existing navigation transition finish before injecting file events.
 await f.page.waitForFunction(()=>{const panel=document.getElementById('panelAi');return panel&&!panel.getAnimations().some(animation=>animation.pending||animation.playState==='running');});
 await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
for(const stage of ['request','body','malformed','missing_data'])test('create '+stage+' failure stays confirmable and retains the original for status retry',async t=>{
 const f=await postBrowserFixture({counts:[1]});t.after(()=>f.close());const p=f.page;await wall(f);
 await p.route('**/api/photo/upload?*',r=>r.fulfill({json:{ok:true,public_url:f.origin+'/test-image/0-0.png'}}));
 await p.evaluate(stage=>{const fetchBase=window.fetch.bind(window),timeoutBase=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timeoutBase(fn,ms===25000?50:ms,...args);window.statusReads=0;window.fetch=(url,options)=>{const path=new URL(url,location.href).pathname;if(path==='/api/photo/create'){if(stage==='malformed')return Promise.resolve(new Response('{'));if(stage==='missing_data')return Promise.resolve(new Response('{"ok":true}'));if(stage==='body')return Promise.resolve(new Response(new ReadableStream({start(stream){options.signal.addEventListener('abort',()=>stream.error(new DOMException('timeout','AbortError')),{once:true});}})));return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}));}if(path==='/api/photo/status'){window.statusReads++;return Promise.resolve(new Response(JSON.stringify({ok:true,status:'processing'})));}return fetchBase(url,options);};},stage);
 await p.locator('#photoFileInput').setInputFiles({name:'original.png',mimeType:'image/png',buffer:f.png});await p.locator('#pwStartUploadBtn').click();
 await p.waitForFunction(()=>document.getElementById('pwUploadResultTitle')?.textContent==='正在确认上传结果');
 assert.equal(await p.locator('#pwUploadResultRetry').isVisible(),true);assert.match(await p.locator('#pwUploadResultDetail').innerText(),/待确认 1 张/);
 const before=await p.evaluate(()=>window.statusReads);await p.evaluate(()=>window.retryFailedPhotoUploads());assert.ok(await p.evaluate(()=>window.statusReads)>before);
 assert.match(await p.locator('#pwUploadResultDetail').innerText(),/成功 0 张，失败 0 张，待确认 1 张/);
});
test('a mixed retry reports the original batch and confirms processing jobs without duplicate uploads',async t=>{
 const f=await postBrowserFixture({counts:[1]});t.after(()=>f.close());const p=f.page,ids=[];let done=false,uploads=0;
 await wall(f);
 await p.route('**/api/photo/upload?*',r=>{uploads++;return r.fulfill({json:{ok:true,public_url:f.origin+'/test-image/0-0.png'}});});
 await p.route('**/api/photo/create',r=>{ids.push(r.request().postDataJSON().upload_id);return r.fulfill({status:503,json:{error:'临时保存失败'}});});
 await p.route('**/api/photo/cleanup',r=>r.fulfill({json:{ok:true}}));
 await p.route('**/api/photo/status',r=>r.fulfill({json:done||r.request().postDataJSON().upload_id===ids[0]?{ok:true,status:'committed',data:row(f)}:{ok:true,status:'processing'}}));
 await p.locator('#photoFileInput').setInputFiles([1,2].map(n=>({name:n+'.png',mimeType:'image/png',buffer:f.png})));await p.locator('#pwStartUploadBtn').click();
 await p.waitForFunction(()=>document.getElementById('pwUploadResult')?.dataset.state==='error');
 await p.evaluate(()=>window.retryFailedPhotoUploads());
 assert.equal(await p.locator('#pwUploadResultTitle').innerText(),'正在确认上传结果');assert.match(await p.locator('#pwUploadResultDetail').innerText(),/已处理 2\/2 张：成功 1 张，失败 0 张，待确认 1 张/);assert.equal(await p.locator('#pwUploadResultRetry').isVisible(),true);
 done=true;await p.evaluate(()=>window.retryFailedPhotoUploads());assert.equal(await p.locator('#pwUploadResultTitle').innerText(),'上传成功');assert.match(await p.locator('#pwUploadResultDetail').innerText(),/已处理 2\/2 张：成功 2 张/);assert.equal(uploads,2);
});
test('first-page refresh preserves focus and reading position and bridges multiple new-comment gaps',async t=>{
 const f=await postBrowserFixture({counts:[1]});t.after(()=>f.close());const p=f.page;let count=30;
 const rows=Array.from({length:200},(_,i)=>({id:String(i+1),user_name:'alice',content:'评论 '+(i+1),created_at:new Date(Date.UTC(2026,9,18,12,0,i)).toISOString()}));
 await p.route('**/api/photo/*/social*',r=>{const u=new URL(r.request().url()),before=u.searchParams.get('before'),known=(u.searchParams.get('known')||'').split(','),start=before?Number(JSON.parse(before).id)-1:count,comments=rows.slice(Math.max(0,start-30),start).reverse(),more=start>30;return r.fulfill({json:{ok:true,liked:false,like_count:0,views:1,comment_count:count,comments,known_ids:known,retained_comments:rows.slice(0,count).filter(x=>known.includes(x.id)),has_more:more,next_cursor:more?JSON.stringify({id:comments.at(-1).id,at:comments.at(-1).created_at}):null}});});
 await wall(f,()=>[row(f)]);await p.locator('.photo-wall-item').first().click();await p.waitForFunction(()=>document.getElementById('ppCommentCount')?.textContent==='30');await p.locator('#ppCommentBtn').click();
 await p.locator('.pp-comment-row button').nth(12).focus();
 const anchor=await p.locator('#ppCommentsList').evaluate(list=>{list.scrollTop=500;const top=list.getBoundingClientRect().top,node=[...list.children].find(row=>row.getBoundingClientRect().bottom>top);window.savedCommentFocus=document.activeElement;window.savedCommentAnchor=node;return node.getBoundingClientRect().top-top;});
 count=100;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(()=>document.getElementById('ppCommentCount')?.textContent==='100');
 const position=await p.locator('#ppCommentsList').evaluate(list=>({focus:document.activeElement===window.savedCommentFocus,connected:window.savedCommentFocus.isConnected,offset:window.savedCommentAnchor.getBoundingClientRect().top-list.getBoundingClientRect().top}));
 assert.equal(position.connected,true);assert.equal(position.focus,true);assert.ok(Math.abs(position.offset-anchor)<2);
 count=200;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(()=>document.getElementById('ppCommentCount')?.textContent==='200');
 for(let n=0;n<10&&await p.locator('#ppCommentsMore').isVisible();n++){await p.locator('#ppCommentsMore').click();await p.waitForFunction(()=>!document.getElementById('ppCommentsMore').disabled);}
 const ids=await p.locator('.pp-comment-row').evaluateAll(nodes=>nodes.map(n=>n.dataset.commentId));assert.equal(new Set(ids).size,200);assert.equal(ids[0],'200');assert.equal(ids.at(-1),'1');assert.equal(await p.locator('#ppCommentsMore').isVisible(),false);
});
test('an initially empty comment list keeps pagination when its first refresh spans multiple pages',async t=>{
 const f=await postBrowserFixture({counts:[1]});t.after(()=>f.close());const p=f.page;let count=0;
 const rows=Array.from({length:100},(_,i)=>({id:String(i+1),user_name:'alice',content:'评论 '+(i+1),created_at:new Date(Date.UTC(2026,9,18,12,0,i)).toISOString()}));
 await p.route('**/api/photo/*/social*',r=>{const u=new URL(r.request().url()),before=u.searchParams.get('before'),start=before?Number(JSON.parse(before).id)-1:count,comments=rows.slice(Math.max(0,start-30),start).reverse(),more=start>30;return r.fulfill({json:{ok:true,liked:false,like_count:0,views:1,comment_count:count,comments,has_more:more,next_cursor:more?JSON.stringify({id:comments.at(-1).id,at:comments.at(-1).created_at}):null}});});
 await wall(f,()=>[row(f)]);await p.locator('.photo-wall-item').first().click();await p.waitForFunction(()=>document.getElementById('ppCommentCount')?.textContent==='0');await p.locator('#ppCommentBtn').click();
 count=100;await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(()=>document.getElementById('ppCommentCount')?.textContent==='100');
 assert.equal(await p.locator('#ppCommentsMore').isVisible(),true);
 for(let n=0;n<5&&await p.locator('#ppCommentsMore').isVisible();n++){await p.locator('#ppCommentsMore').click();await p.waitForFunction(()=>!document.getElementById('ppCommentsMore').disabled);}
 const ids=await p.locator('.pp-comment-row').evaluateAll(nodes=>nodes.map(n=>n.dataset.commentId));assert.equal(new Set(ids).size,100);assert.equal(ids[0],'100');assert.equal(ids.at(-1),'1');assert.equal(await p.locator('#ppCommentsMore').isVisible(),false);
 assert.deepEqual(f.errors,[]);
});
test('desktop photo double-click and explicit sync bypass the recent-load TTL',async t=>{
 const f=await postBrowserFixture({counts:[1],viewport:{width:1440,height:900}});t.after(()=>f.close());const p=f.page;let reads=0;
 await wall(f,()=>{reads++;return[row(f)];});await p.waitForFunction(()=>document.querySelector('#photoGrid .photo-wall-item img')?.naturalWidth>1);
 const before=reads;await p.locator('[data-desktop-tab="ai"]').dblclick();await p.waitForFunction(()=>!document.querySelector('.pw-wall-loading'));assert.ok(reads>before);
 const previous=reads;await p.evaluate(()=>window.__xtjPhotoWallForceSync());assert.ok(reads>previous);
});

test('a queued forced render bypasses cache and all callers await its completion',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('js/photo-wall/render.js','utf8');
 const a=source.indexOf('  var rendering = false;'),b=source.indexOf('  function renderPhotoWallWithoutReload',a);
 let releaseFirst,releaseSecond,done=false;const calls=[],first=new Promise(r=>{releaseFirst=r;}),second=new Promise(r=>{releaseSecond=r;});
 const c={_pwRenderGeneration:0,document:{getElementById:id=>id==='photoGrid'?{innerHTML:''}:null},sortPhotoWallData:rows=>rows,renderSorted(){},photoWallErrorHtml:()=>'',console,window:{currentUser:'alice',photoWallData:[],loadPhotoWallData:async force=>{calls.push(force);await(calls.length===1?first:second);}}};
 vm.createContext(c);vm.runInContext(source.slice(a,b)+';globalThis.render=renderPhotoWall;',c);
 const old=c.render();await new Promise(r=>setImmediate(r));const refresh=c.render({force:true});old.then(()=>{done=true;});releaseFirst();await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,[false,true]);assert.equal(done,false);releaseSecond();await Promise.all([old,refresh]);assert.equal(done,true);
});

test('desktop refresh releases its lock even when lazy AI refresh hooks are not loaded',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('js/desktop-shell.js','utf8');
 const a=source.indexOf('  var _refreshLocks = {};'),b=source.indexOf('  function init()',a);let starts=0;
 const c={window:{showToast(){starts++;}}};vm.createContext(c);vm.runInContext(source.slice(a,b)+';globalThis.refresh=refreshTab;',c);
 await c.refresh('ai-chat');await c.refresh('ai-chat');assert.equal(starts,2);
 let release;c.window.__xtjRefreshAiSession=()=>new Promise(r=>{release=r;});const first=c.refresh('ai-chat'),second=c.refresh('ai-chat');
 assert.equal(first,second);await new Promise(r=>setImmediate(r));release();await first;assert.equal(starts,3);
});

test('registration resumes a cold wall even when its data module loads after auth-ready',async t=>{
 const f=await postBrowserFixture({user:'',publicPosts:true,counts:[1]});t.after(()=>f.close());const p=f.page;
 let release;const held=new Promise(resolve=>{release=resolve;});t.after(()=>release());let reads=0;
 await p.route('**/js/photo-wall/data.min.js*',async route=>{await held;await route.continue();});
 await p.route('**/api/user/register',route=>route.fulfill({json:{ok:true,token:'test-only-token',user_name:'alice'}}));
 await p.route('**/api/user/refresh',route=>route.fulfill({json:{ok:true,token:'test-only-token',user_name:'alice'}}));
 await p.route('**/api/photos/public?*',route=>{reads++;return route.fulfill({json:{ok:true,data:[row(f)],sort:'date_desc',has_more:false}});});
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.querySelector('#feed .post-media-grid img'));
 await p.locator('[data-tab="ai"]').filter({visible:true}).first().click();await p.getByRole('button',{name:'立即登录',exact:true}).click();await p.locator('#loginModal .af-link').click();
 await p.locator('#regNickInp').fill('alice');await p.locator('#regPwInp').fill('test-only-password');await p.locator('#registerSubmitBtn').click();
 await p.waitForFunction(()=>window.currentUser==='alice'&&window._xtjCanonicalUser==='alice');
 assert.equal(await p.evaluate(()=>typeof window.loadPhotoWallData),'undefined');release();
 await p.waitForFunction(()=>document.querySelector('#photoGrid .photo-wall-item img')?.naturalWidth>0);
 assert.ok(reads>0);assert.equal(await p.getByText('请登录查看所有照片',{exact:true}).isVisible(),false);assert.deepEqual(f.errors,[]);
});
