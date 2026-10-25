'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture'),{DEFAULTS}=require('../render-api/profile-settings');
const cases=process.env.XTJ_SCREENSHOT_SMOKE?[['phone',390,844,'light']]:[['phone',390,844,'light'],['phone',390,844,'dark'],['tablet',820,1180,'light'],['tablet',820,1180,'dark'],['desktop',1440,1000,'light'],['desktop',1440,1000,'dark']];
for(const [device,width,height,theme]of cases)test(`${device} ${theme}: all active product panels, records, dialogs and authenticated rendering`,{timeout:120000},async t=>{
 const chatId='44444444-4444-4444-8444-000000000001',messages=[{id:chatId,user_name:'bob',media_url:'alice',media_type:'__dm__',created_at:'2026-10-24T10:00:00Z',content:JSON.stringify({type:'dm',text:'已确认的聊天消息'})}];
 const f=await postBrowserFixture({viewport:{width,height},theme,counts:[1,3],publicPosts:true,dmMessages:messages}),page=f.page;
 const snapshot=async name=>{
  await page.waitForFunction(()=>Array.from(document.images).filter(img=>{const r=img.getBoundingClientRect();return img.src.startsWith(location.origin+'/test-image/')&&r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0;}).every(img=>img.complete&&img.naturalWidth>0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' must fit the viewport');
  const directory=process.env.XTJ_FEATURE_SCREENSHOTS;if(!directory)return;fs.mkdirSync(directory,{recursive:true});const file=device+'-'+theme+'-'+name+'.png';await page.screenshot({path:path.join(directory,file),animations:'disabled',fullPage:false});
  fs.appendFileSync(path.join(directory,'manifest.jsonl'),JSON.stringify({test:t.name,step:name,file,viewport:{width,height},ok:true})+'\n');
 };
 try{
  const settings={...DEFAULTS,theme,signature:'截图核对签名'};
  await page.route('**/api/profile/settings**',r=>{if(r.request().method()==='PATCH')Object.assign(settings,r.request().postDataJSON());return r.fulfill({json:{ok:true,settings}})});
  await page.route('**/api/profile/records/summary',r=>r.fulfill({json:{ok:true,totals:{posts:2,views:4,likes:0,comments:6}}}));
  await page.route('**/api/profile/records?**',r=>r.fulfill({json:{ok:true,items:[{id:'9223372036854775807',post_id:f.posts[0].id,created_at:'2026-10-24T10:00:00Z',author:'alice',text:'已确认的记录内容',available:true}],has_more:false,total:1}}));
  await page.route('**/test-supabase/rest/v1/posts?**',r=>new URL(r.request().url()).searchParams.get('media_type')==='eq.__report__'?r.fulfill({json:[{id:chatId,created_at:'2026-10-24T10:00:00Z',content:JSON.stringify({target_type:'post',target_id:f.posts[0].id,report_reason:'隔离测试举报内容',status:'pending'})}]}):r.fallback());
  await page.route('**/api/photos/public?**',r=>r.fulfill({json:{ok:true,data:[{id:chatId,user_name:'alice',media_type:'__photo_wall__',media_url:f.origin+'/test-image/wall-0.png',created_at:'2026-10-24T10:00:00Z',views:4,content:JSON.stringify({caption:'隔离测试原图',fileSize:1000})}],has_more:false,total:1}}));
  await page.route('**/api/photo/*/social*',r=>r.fulfill({json:{ok:true,views:4,like_count:2,comment_count:1,liked:false,comments:[{id:'9223372036854775807',user_name:'bob',content:'隔离测试照片评论',created_at:'2026-10-24T10:00:00Z'}],has_more:false}}));
  await page.route('**/api/chat/relationship?**',r=>r.fulfill({json:{ok:true,relationship:{status:'friends',can_message:true}}}));
  await page.route('**/api/dm/messages?**',r=>r.fulfill({json:{ok:true,data:messages,has_more:false}}));
  assert.equal(await page.locator('#feed .post').count(),2);await snapshot('posts');
  await page.evaluate(id=>openPostDetail(id),f.posts[0].id);await page.waitForSelector('#postDetailModal.active');await page.waitForFunction(()=>document.getElementById('postDetailBody')?.textContent.includes('正文和媒体排版'));await snapshot('post-detail');await page.evaluate(()=>closeModal('postDetailModal'));
  await page.evaluate(()=>openAnnouncementModal());await page.waitForSelector('#announcementModal.active');await snapshot('announcements');await page.evaluate(()=>closeAnnouncementModal());
  await page.evaluate(()=>openReportModal());await page.waitForSelector('#reportModal.active');await snapshot('report-form');await page.evaluate(()=>toggleReportRecords());await page.waitForFunction(()=>document.getElementById('reportHistoryList')?.textContent.includes('隔离测试举报内容'));await snapshot('report-records');await page.evaluate(()=>{closeReportHistoryModal();closeReportModal()});
  await page.evaluate(()=>switchDockTab('chat',true));await page.waitForSelector('#panelChat.active');await snapshot('chat-list');await page.evaluate(()=>openChat('bob'));await page.waitForFunction(()=>document.getElementById('dockChatMessages').textContent.includes('已确认的聊天消息'));await snapshot('chat-messages');
  await page.evaluate(()=>switchDockTab('ai',true));await page.waitForSelector('#photoGrid .photo-wall-item');assert.equal(await page.locator('#photoGrid .photo-wall-item').count(),1);await snapshot('photos');await page.locator('#photoGrid .photo-wall-item').click();await page.waitForSelector('#photoPreviewOverlay.active');await page.waitForFunction(()=>document.querySelector('#photoPreviewImage')?.naturalWidth>0);await snapshot('photo-preview');await page.keyboard.press('Escape');
  await page.evaluate(()=>switchDockTab('profile',true));await page.evaluate(()=>__xtjReloadProfileSettings());await page.waitForFunction(()=>document.getElementById('profilePreferences').dataset.syncState==='synced');await page.waitForFunction(()=>document.getElementById('profilePostsCount')?.textContent==='2'&&document.getElementById('profileViewsCount')?.textContent==='4');await snapshot('profile');
  await page.locator('#profileGeneralTitle').scrollIntoViewIfNeeded();assert.equal(await page.locator('[name=signature]').inputValue(),'截图核对签名');await snapshot('profile-general');
  await page.evaluate(()=>toggleProfileActivity('posts'));await page.waitForSelector('#profileActivityModal.active');await page.waitForFunction(()=>document.getElementById('profileActivityModalList')?.textContent.includes('已确认的记录内容'));await snapshot('profile-records');await page.evaluate(()=>closeProfileActivityModal());
  await wireAiChat(page);await page.locator('#aiChatMsgInput').fill('核对两条帖子');await page.locator('#aiChatSendBtn').click();await page.waitForFunction(()=>!!window.testStream);await page.evaluate(()=>{testEmit({type:'content',text:'已核对 2 条帖子，原图保持。'});testEmit({type:'done',complete:true,saved:true,content:'已核对 2 条帖子，原图保持。',message_id:'44444444-4444-4444-8444-000000000002'});testStream.close();});await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ai-msg.assistant')).some(n=>n.textContent.includes('已核对 2 条帖子')));await snapshot('ai-chat');
  await page.evaluate(()=>__xtjAiAgent.openDeepThink());await page.waitForSelector('#panelDeepThink.active');await snapshot('ai-research');
  await page.evaluate(()=>doLogout());await page.evaluate(()=>openModal('loginModal'));await page.waitForSelector('#loginModal.active');await snapshot('login');await page.evaluate(()=>{closeModal('loginModal');openModal('registerModal')});await page.waitForSelector('#registerModal.active');await snapshot('register');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('built browser refresh reuses a failed intent after page reload and acknowledges it without losing the active user',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]}),p=f.page,ids=[];let failures=2;
 try{
  await p.route('**/api/user/refresh',route=>{const body=route.request().postDataJSON();ids.push(body.refresh_request_id);if(failures-->0)return route.abort('failed');return route.fulfill({json:{ok:true,token:'recovered-test-access-token',user_name:'alice'}})});
  await p.evaluate(()=>{clearUserToken();return refreshUserToken(true)});
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.match(ids[0],/^[a-f0-9-]{36}$/);
  assert.equal(await p.evaluate(()=>localStorage.getItem('xtj_pending_refresh_request')),ids[0]);
  await p.reload();await p.waitForFunction(()=>getUserToken()==='recovered-test-access-token');assert.equal(ids[2],ids[0]);assert.equal(await p.evaluate(()=>localStorage.getItem('xtj_pending_refresh_request')),null);assert.equal(await p.evaluate(()=>currentUser),'alice');
  assert.equal(await p.evaluate(()=>Object.values(localStorage).some(value=>value==='recovered-test-access-token')),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
