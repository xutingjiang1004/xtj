'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const read=p=>fs.readFileSync(p,'utf8');
function section(path,start,end){const s=read(path),a=s.indexOf(start);assert.ok(a>=0,start);const b=s.indexOf(end,a);assert.ok(b>=0,end);return s.slice(a,b);}
async function fixture(t){
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(6000);
 await page.setContent('<div id="dockChatMessages"></div><div id="dockChatList"></div>');
 await page.evaluate(()=>{
  window.currentUser='A';window._authStateEpoch=1;window.dockChatActiveUser='peer';window.currentDockTab='chat';
  window._chatHistoryFocus='';window._chatRenderSignature={};window._dockChatMessageLoad=null;window._dockChatLoadSeq=0;window._chatCommittedRevision=0;window._chatCache={};window.avatarCache={};window.calls=[];
  window.getDockChatCacheKey=peer=>currentUser+':'+peer;window.readAvatarCacheFromStorage=()=>({});window.hydrateDockChatAvatars=()=>{};window.patchDockChatMessageAvatars=()=>{};
  window.renderDockMessages=(peer,rows)=>{if(peer===dockChatActiveUser)document.getElementById('dockChatMessages').textContent=rows.map(r=>r.content).join('|');};
  window.mergeDockChatMessages=(peer,rows)=>rows;window.mergeDockChatRowsById=rows=>rows;window.isDmMessageLocallyDeleted=()=>false;window.getDMMessageReadAt=()=>true;
  window.updateUnreadBadge=()=>{};window.scheduleDockChatListRefresh=()=>{};
 });
 await page.addScriptTag({content:section('js/core-parts/06-chat-and-nav.js','            async function loadDockChatMessages(', '            function renderDockMessages(')+'\nwindow.loadMessages=loadDockChatMessages;'});
 return page;
}
test('manual message retry performs a request, removes stale retry UI, and polling cannot supersede it',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{xtjProtectedFetch=async(path,opts)=>{calls.push(opts);return new Response(JSON.stringify({ok:false,error:'offline'}),{status:503});};return loadMessages('peer',true);});
 assert.equal(await p.locator('.chat-load-retry').count(),1);
 await p.evaluate(()=>{_chatHistoryFocus='peer';xtjProtectedFetch=(path,opts)=>{calls.push(opts);return new Promise(resolve=>window.release=()=>resolve(new Response(JSON.stringify({ok:true,data:[{id:'1',content:'已加载'}]}))));};});
 await p.locator('.chat-load-retry').click();
 await p.evaluate(()=>loadMessages('peer',false,true));assert.equal(await p.evaluate(()=>calls.length),2);
 await p.evaluate(()=>release());await p.waitForFunction(()=>document.getElementById('dockChatMessages').textContent==='已加载');
 assert.equal(await p.locator('.chat-load-retry').count(),0);assert.equal(await p.evaluate(()=>_dockChatMessageLoad),null);
 assert.equal(await p.evaluate(()=>calls[1].background),false);
});
test('late message body after A→B→A does not enter the new identity cache',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{xtjProtectedFetch=async()=>({ok:true,json:()=>new Promise(resolve=>window.release=()=>resolve({ok:true,data:[{content:'旧账号数据'}]}))});window.task=loadMessages('peer',true);});
 await p.waitForFunction(()=>window.release);
 await p.evaluate(()=>{currentUser='B';_authStateEpoch++;currentUser='A';_authStateEpoch++;document.getElementById('dockChatMessages').textContent='新会话';release();return task;});
 assert.equal(await p.locator('#dockChatMessages').textContent(),'新会话');assert.deepEqual(await p.evaluate(()=>_chatCache),{});
});
test('chat list retry bypasses shared failure backoff and uses foreground authentication',async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{
  window._dmUnreadFetchedAt=0;window.setUnreadBadgeCount=()=>{};window.observeDmSnapshot=()=>{};
  window._dockChatListRetryTimer=0;window._dockChatConversationOwner='A';window._dockChatConversationStates={};window._dockChatListRenderSignature='';window._dockChatListLoadSeq=0;window._dockChatListEverLoaded=false;window.DOCK_CHAT_CACHE_DURATION=10000;
  for(const name of ['syncDockChatLayoutState','touchDockChatPresence','refreshChatSocialBadge','refreshChatFriendNotes','restoreDockChatContactNames','renderDockChatFixedEntry','cacheDockChatContactNames'])window[name]=()=>{};
  window.dockChatConversationRows=()=>[];
  window.renderChatLoadingState=el=>el.textContent='加载中';window.dockChatActiveUser='';window.failure=true;
  window.xtjProtectedFetch=async(path,opts)=>{calls.push(opts);return new Response(JSON.stringify(failure?{ok:false,error:'offline'}:{ok:true,data:[],conversations:[]}));};
 });
 await p.addScriptTag({content:section('js/core-parts/05-feed-stats.js','            var _dmListShared =', '            async function updateUnreadBadge(')});
 await p.addScriptTag({content:section('js/core-parts/06-chat-and-nav.js','            async function loadDockChatList(', '            var _dockChatListRenderSignature')+'\nwindow.loadList=loadDockChatList;'});
 await p.evaluate(()=>loadList());assert.equal(await p.evaluate(()=>calls.length),1);assert.ok(await p.locator('#dockChatList button').count());
 await p.evaluate(()=>failure=false);await p.locator('#dockChatList button').first().click();
 await p.waitForFunction(()=>document.getElementById('dockChatList').textContent.includes('暂无最近会话'));
 assert.equal(await p.evaluate(()=>calls.length),2);assert.equal(await p.evaluate(()=>calls[1].background),false);
});
