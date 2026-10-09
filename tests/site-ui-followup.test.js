'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright'),express=require('express'),request=require('supertest');
const read=p=>fs.readFileSync(p,'utf8');
async function pageFor(t,html,viewport={width:1024,height:768}) {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (require('node:fs').existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});t.after(()=>browser.close());
 const page=await browser.newPage({viewport});await page.route('https://ui.test/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://ui.test/');return page;
}
function slice(file,from,to){const s=read(file),a=s.indexOf(from);assert.ok(a>=0);return s.slice(a,s.indexOf(to,a));}
test('profile endpoint reads only the authenticated account creation fact and reports failures',async()=>{
 const {installAccountProfile}=require('../render-api/account-events');let fail=false,actor='',selected='',order;
 const supabase={from(){return {select(v){selected=v;return this;},eq(k,v){if(k==='user_name')actor=v;return this;},order(k,v){order=v;return this;},limit(){return Promise.resolve(fail?{error:{}}:{data:[{created_at:'2024-01-02T03:04:05Z'}]});}};}};
 const app=express();installAccountProfile(app,{supabase,authenticateUser(req,res,next){req.userName='A';next();},rateLimit:()=>((req,res,next)=>next())});
 const response=await request(app).get('/api/user/profile?user_name=B');assert.equal(response.body.registered_at,'2024-01-02T03:04:05Z');assert.equal(actor,'A');assert.equal(selected,'created_at');assert.equal(order.ascending,true);assert.equal(response.headers['cache-control'],'no-store');
 fail=true;assert.equal((await request(app).get('/api/user/profile')).status,503);
});
test('personal detail renders server registration time and fences an A to B to A response',async t=>{
 const p=await pageFor(t,'<div id="profileDetailRegTime"></div><div id="profileDetailName"></div><div id="profileDetailId"></div>');
 await p.evaluate(()=>{window.currentUser='A';window._authStateEpoch=1;window.openModal=()=>{};window.loadProfileAvatar=()=>{};window.xtjProtectedFetch=async()=>new Response(JSON.stringify({ok:true,registered_at:'2024-01-02T03:04:05Z'}));});
 await p.addScriptTag({content:slice('js/core-parts/03-profile-report-ai.js','            window.openProfileDetail = async function','            var profileAvatarRequestSeq')});await p.evaluate(()=>openProfileDetail());assert.match(await p.locator('#profileDetailRegTime').textContent(),/2024/);
 await p.evaluate(()=>{xtjProtectedFetch=()=>new Promise(r=>window.release=()=>r(new Response(JSON.stringify({ok:true,registered_at:'1999-01-01'}))));window.task=openProfileDetail();});
 await p.evaluate(()=>{currentUser='B';_authStateEpoch++;currentUser='A';_authStateEpoch++;document.getElementById('profileDetailRegTime').textContent='新会话';release();});await p.evaluate(()=>task);assert.equal(await p.locator('#profileDetailRegTime').textContent(),'新会话');
});
test('hidden theme control uses live colors, rapid reversal finishes and removes temporary paint',async t=>{
 const p=await pageFor(t,'<button id="themeToggle" hidden><span class="theme-toggle-orb"></span></button><div style="background:var(--test-color)">资料</div>');
 await p.addStyleTag({content:'html[data-theme="light"]{--test-color:#fff}html[data-theme="dark"]{--test-color:#111}'});
 await p.evaluate(()=>{window.snapshots=0;document.startViewTransition=()=>{snapshots++;throw Error('hidden orb must not be captured');};});await p.addScriptTag({path:'js/theme-toggle.js'});
 await p.evaluate(()=>{XTJThemeController.setMode('dark');XTJThemeController.setMode('light');XTJThemeController.setMode('dark');});await p.waitForFunction(()=>!document.documentElement.classList.contains('theme-switching'));
 assert.equal(await p.evaluate(()=>snapshots),0);assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');assert.equal(await p.locator('[data-xtj-theme-paint]').count(),0);assert.equal(await p.locator('style[data-xtj-theme-palette]').count(),0);
});
async function dm(p) {
 await p.evaluate(()=>{window.currentUser='A';window._authStateEpoch=1;window.currentDockTab='posts';window.dockChatActiveUser='B';window.DM_MARKER='__dm__';window.__xtjDmMuteReady=true;window.__xtjMutedChatPeers={};window.safeStorage={get:()=>null};window.getAvatarUrl=()=>null;window.escapeHtml=String;window.sanitizeUrl=String;window.getDockChatMessagePreview=m=>m.content;window.getDMMessageReadAt=m=>m.read_at;window.upsertDockChatCacheMessage=()=>{};window.applyDockChatConversationPreview=()=>{};window.updateUnreadBadge=()=>{};window.authoritativeDmUnread=rows=>{window.__xtjDmMuteReady=true;window.__xtjMutedChatPeers={};rows.forEach(r=>{if(r.muted_until)window.__xtjMutedChatPeers[r.peer_name]=true;});};});
 await p.addScriptTag({content:slice('js/core-parts/05-feed-stats.js','            let activeNotifications','            // ==== 测试通知')+'\nwindow.observeSnapshot=observeDmSnapshot;'});
 await p.addScriptTag({content:slice('js/core-parts/05-feed-stats.js','            function applyRealtimeDmMessage','            async function subscribeToDmBroadcast')});
}
test('incoming messages notify across all other panels even with that conversation retained',async t=>{
 const p=await pageFor(t,'<div id="notificationContainer"></div><div id="dockChatList"></div>');await dm(p);
 for(const tab of ['posts','ai','profile','settings'])await p.evaluate(tab=>{currentDockTab=tab;applyRealtimeDmMessage({id:tab,media_type:'__dm__',user_name:'B',media_url:'A',content:'新消息'});},tab);
 assert.equal(await p.locator('.notification-bubble').count(),4);
 await p.evaluate(()=>{applyRealtimeDmMessage({id:'posts',media_type:'__dm__',user_name:'B',media_url:'A',content:'重复'});applyRealtimeDmMessage({id:'own',media_type:'__dm__',user_name:'A',media_url:'B',content:'自己'});});assert.equal(await p.locator('.notification-bubble').count(),4);
});
test('poll fallback skips initial history, muted peers and duplicate realtime messages',async t=>{
 const p=await pageFor(t,'<div id="notificationContainer"></div><div id="dockChatList"></div>');await dm(p);
 await p.evaluate(()=>{window.row=id=>({id,user_name:'B',media_url:'A',content:'消息',created_at:'2026-10-02'});observeSnapshot({data:[row('old')],conversations:[]});observeSnapshot({data:[row('old'),row('new')],conversations:[]});applyRealtimeDmMessage({...row('new'),media_type:'__dm__'});observeSnapshot({data:[row('muted')],conversations:[{peer_name:'B',muted_until:'infinity'}]});});assert.equal(await p.locator('.notification-bubble').count(),1);
 await p.evaluate(()=>{currentUser='C';_authStateEpoch++;observeSnapshot({data:[],conversations:[]});});assert.equal(await p.locator('.notification-bubble').count(),0);
});
test('prefetched social counts render synchronously and refresh without dashes',async t=>{
 const p=await pageFor(t,'<div id="photoPreviewOverlay" class="active"><div class="photo-preview-info"><span id="photoPreviewUser"></span><time id="photoPreviewTime"></time><span id="photoPreviewViews"><span id="photoPreviewViewsCount"></span></span></div></div>');
 await p.evaluate(()=>{window.currentUser='A';window.__xtjGetAuthEpoch=()=>1;window.xtjFetchAvatarUrl=async()=>'';window.calls=0;window.xtjProtectedFetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,liked:false,like_count:7,comment_count:3,views:2,comments:[]}));};window.photo={cloudId:'123e4567-e89b-42d3-a456-000000000071',username:'B',imageUrl:'https://ui.test/photo.jpg'};});await p.addScriptTag({path:'js/photo-wall/story.js'});
 await p.evaluate(()=>preloadPhotoStorySocial([photo]));await p.waitForFunction(()=>calls===1);await p.waitForTimeout(30);
 const immediate=await p.evaluate(()=>{renderPhotoStory(photo);return [document.getElementById('ppLikeCount').textContent,document.getElementById('ppCommentCount').textContent];});assert.deepEqual(immediate,['7','3']);await p.waitForFunction(()=>calls===2);assert.doesNotMatch(await p.locator('.pp-story-stats').textContent(),/—/);
});
test('contact slider reverses, cancels on resize and allows immediate keyboard activation',async t=>{
 const p=await pageFor(t,'<div id="panelChat"><div id="dockChatSocialTabs"><span class="chat-social-slider"></span>'+['search','friends','requests','blocks'].map(tab=>'<button data-chat-social-tab="'+tab+'">'+tab+'</button>').join('')+'</div><div id="dockChatSocialContent"></div></div>');await p.addStyleTag({path:'css/ui-shell.css'});
 await p.evaluate(()=>{window._dockChatSocialTab='friends';window.transitions=[];window.renderDockChatSocialTab=tab=>{transitions.push(tab);setDockChatSocialTabState(tab);};});await p.addScriptTag({content:slice('js/core-parts/06-chat-and-nav.js','            function bindDockChatSocialSlider','            function chatSocialActionButton')});await p.evaluate(()=>setDockChatSocialTabState('friends'));
 const box=await p.locator('[data-chat-social-tab="friends"]').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+box.width,y);await p.mouse.move(x-box.width,y);await p.mouse.up();assert.equal(await p.evaluate(()=>_dockChatSocialTab),'search');
 await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+box.width,y);await p.setViewportSize({width:900,height:768});await p.waitForTimeout(30);await p.mouse.up();assert.equal(await p.evaluate(()=>_dockChatSocialTab),'search');assert.equal(await p.locator('#dockChatSocialTabs').evaluate(n=>n.classList.contains('is-dragging')),false);
 await p.locator('[data-chat-social-tab="search"]').focus();await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>_dockChatSocialTab),'friends');
 const clicked=await p.evaluate(()=>{var result=false,button=document.querySelector('[data-chat-social-tab="requests"]');button.addEventListener('click',()=>result=true);button.click();return result;});assert.equal(clicked,true);
});
test('panel transition animates all content, rapid switches cancel and motion-off skips animation',async t=>{
 const p=await pageFor(t,'<div id="panelPosts" class="dock-panel active"><nav>工具</nav><main>帖子</main></div><div id="panelChat" class="dock-panel"><header>聊天</header><main>消息</main></div><div id="panelProfile" class="dock-panel"><main>我的</main></div>');
 await p.evaluate(()=>{window.currentUser='A';window.currentDockTab='posts';window.safeStorage={set:()=>{}};window.startDMPolling=()=>{};window.dockPanelTransitionTimer=0;window.dockPanelAnimation=null;});
 const code=slice('js/core-parts/06-chat-and-nav.js',"                var previousPanel = document.querySelector('.dock-panel.active');",'                const tabBtn =');await p.addScriptTag({content:'window.changePanel=function(tab){'+code+'};'});
 await p.evaluate(()=>changePanel('chat'));assert.equal(await p.evaluate(()=>dockPanelAnimation.effect.target.id),'panelChat');
 await p.evaluate(async()=>{changePanel('profile');await dockPanelAnimation.finished;});assert.equal(await p.locator('.dock-panel.active').getAttribute('id'),'panelProfile');assert.equal(await p.evaluate(()=>document.getAnimations().length),0);
 await p.evaluate(()=>{document.documentElement.setAttribute('data-xtj-motion','off');changePanel('posts');});assert.equal(await p.evaluate(()=>document.getAnimations().length),0);
});
test('original photo stays bright after opening and navigation, and toolbar geometry stays fixed',async t=>{
 const p=await pageFor(t,'<html class="xtj-photo-preview-ready"><body></body></html>');await p.addStyleTag({path:'css/style.css'});await p.addStyleTag({path:'css/ui-shell.css'});await p.addStyleTag({path:'css/photo-preview.css'});
 await p.evaluate(()=>{window.currentUser='A';window.isAdmin=()=>false;window.sanitizeUrl=s=>s;window.escapeHtml=String;window.photos=['#ff0000','#00ff00','#0000ff'].map((color,i)=>{const c=document.createElement('canvas');c.width=200;c.height=100;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,200,100);return {id:String(i),username:'A',imageUrl:c.toDataURL(),date:'2026-10-02',views:2};});});
 await p.addScriptTag({path:'js/photo-wall/preview.js'});await p.addScriptTag({path:'js/photo-wall/preview-hotfix.js'});await p.evaluate(()=>openPhotoPreview(0,{photos}));await p.waitForFunction(()=>document.getElementById('photoPreviewImage').naturalWidth>0);
 const sharp=require('sharp');
 async function pixel(){return Array.from(await sharp(await p.screenshot()).extract({left:510,top:382,width:1,height:1}).removeAlpha().raw().toBuffer());}
 await p.waitForTimeout(300);const before=await p.locator('#ppDeleteBtn').boundingBox();assert.deepEqual(await pixel(),[255,0,0]);await p.waitForTimeout(1200);assert.deepEqual(await pixel(),[255,0,0]);assert.deepEqual(await p.locator('#ppDeleteBtn').boundingBox(),before);
 await p.evaluate(()=>ppNextPhoto());await p.waitForFunction(()=>photoPreviewCurrent.id==='1');await p.waitForTimeout(1400);assert.deepEqual(await pixel(),[0,255,0]);
 const computed=await p.evaluate(()=>['photoPreviewOverlay','ppImageWrapper','ppSlideTrack','photoPreviewImage'].map(id=>{const s=getComputedStyle(document.getElementById(id));return {transform:s.transform,filter:s.filter,willChange:s.willChange};}));assert.ok(computed.every(s=>s.filter==='none'&&s.willChange==='auto'),JSON.stringify(computed));assert.equal(computed[0].transform,'none');assert.equal(computed[2].transform,'matrix(1, 0, 0, 1, -1024, 0)');
 await p.evaluate(()=>ppRotatePhoto());assert.notEqual(await p.locator('#photoPreviewImage').evaluate(n=>getComputedStyle(n).transform),'none');
});
for(const viewport of [{width:390,height:844},{width:1024,height:768},{width:1440,height:900}])test('photo opening/return/slide retain native motion and stable author metadata at '+viewport.width+'px',async t=>{
 const p=await pageFor(t,'<html class="xtj-photo-preview-ready"><body><div id="photoGrid"><div class="photo-wall-item" data-photo-id="0"><img id="origin" style="position:absolute;left:30px;top:50px;width:180px;height:90px"></div></div></body></html>',viewport);
 p.setDefaultTimeout(6000);
 for(const path of ['css/style.css','css/ui-shell.css','css/photo-preview.css'])await p.addStyleTag({path});
 await p.evaluate(()=>{window.currentUser='A';window.isAdmin=()=>false;window.sanitizeUrl=s=>s;window.escapeHtml=String;window.xtjFetchAvatarUrl=async()=>'';const c=document.createElement('canvas');c.width=200;c.height=100;c.getContext('2d').fillRect(0,0,200,100);window.photos=[0,1].map(i=>({id:String(i),username:'A',timestamp:1760000000000,views:12+i,imageUrl:c.toDataURL(),width:200,height:100}));document.getElementById('origin').src=photos[0].imageUrl;});
 for(const path of ['js/photo-wall/preview.js','js/photo-wall/story.js','js/photo-wall/preview-hotfix.js'])await p.addScriptTag({path});
 const opening=await p.evaluate(()=>{
   openPhotoPreview(0,{photos,originEl:document.getElementById('origin')});
   var wrap=document.getElementById('ppImageWrapper'), motion=wrap.getAnimations()[0];
   motion.pause();motion.currentTime=100;
   var author=document.querySelector('.photo-preview-info');window.metadataMutations=0;
   window.metadataObserver=new MutationObserver(records=>{metadataMutations+=records.filter(r=>r.target.closest&&r.target.closest('#photoPreviewUser,#photoPreviewTime,#photoPreviewViewsCount')).length;});
   metadataObserver.observe(author,{childList:true,subtree:true,characterData:true});
   window.metadataRects=['photoPreviewUser','photoPreviewTime','photoPreviewViewsCount','ppDeleteBtn'].map(id=>{var r=document.getElementById(id).getBoundingClientRect();return[r.x,r.y,r.width,r.height];});
   return {transform:getComputedStyle(wrap).transform,frames:motion.effect.getKeyframes().map(k=>k.transform),duration:motion.effect.getTiming().duration};
 });
 assert.notEqual(opening.transform,'none');assert.ok(opening.frames[0].includes('scale('));assert.equal(opening.duration,240);
 await p.evaluate(()=>document.getElementById('ppImageWrapper').getAnimations()[0].finish());await p.waitForFunction(()=>document.getElementById('photoPreviewImage').naturalWidth>0);await p.waitForTimeout(300);
 assert.equal(await p.evaluate(()=>metadataMutations),0);
 assert.deepEqual(await p.evaluate(()=>['photoPreviewUser','photoPreviewTime','photoPreviewViewsCount','ppDeleteBtn'].map(id=>{var r=document.getElementById(id).getBoundingClientRect();return[r.x,r.y,r.width,r.height];})),await p.evaluate(()=>metadataRects));
 const slide=await p.evaluate(()=>{ppNextPhoto();var track=document.getElementById('ppSlideTrack');return{property:getComputedStyle(track).transitionProperty,active:track.classList.contains('snapping')};});assert.equal(slide.property,'transform');assert.equal(slide.active,true);
 await p.waitForFunction(()=>photoPreviewCurrent.id==='1');await p.evaluate(()=>ppPrevPhoto());await p.waitForFunction(()=>photoPreviewCurrent.id==='0');
 const closing=await p.evaluate(()=>{closePhotoPreview();var wrap=document.getElementById('ppImageWrapper'),a=wrap.getAnimations()[0];a.pause();a.currentTime=100;return{transform:getComputedStyle(wrap).transform,frames:a.effect.getKeyframes().map(k=>k.transform)};});
 assert.notEqual(closing.transform,'none');assert.ok(closing.frames[1].includes('scale('));
 await p.evaluate(()=>document.getElementById('ppImageWrapper').getAnimations()[0].finish());await p.waitForFunction(()=>!document.getElementById('photoPreviewOverlay').classList.contains('active'));
});

test('photo root fades over unchanged page paint and Dock without premature close cleanup', async t => {
 const p=await pageFor(t,'<html class="xtj-photo-preview-ready"><body style="background:rgb(12,34,56)"><header id="top">顶部</header><nav id="dockBar" class="dock-bar">导航</nav><div id="photoGrid"><div class="photo-wall-item" data-photo-id="0"><img id="origin" style="position:absolute;left:30px;top:50px;width:180px;height:90px"></div></div></body></html>');
 for(const path of ['css/style.css','css/ui-shell.css','css/photo-preview.css'])await p.addStyleTag({path});
 await p.evaluate(()=>{window.currentUser='A';window.isAdmin=()=>false;window.sanitizeUrl=s=>s;window.escapeHtml=String;const c=document.createElement('canvas');c.width=200;c.height=100;c.getContext('2d').fillRect(0,0,200,100);window.photos=[{id:'0',username:'A',imageUrl:c.toDataURL(),width:200,height:100}];origin.src=photos[0].imageUrl;window.readPaint=()=>[getComputedStyle(document.body).backgroundColor,getComputedStyle(dockBar).display,getComputedStyle(dockBar).opacity,getComputedStyle(dockBar).visibility,getComputedStyle(document.querySelector('.photo-wall-item')).opacity];window.paintBefore=readPaint();});
 for(const path of ['js/photo-wall/preview.js','js/photo-wall/preview-hotfix.js'])await p.addScriptTag({path});
 await p.evaluate(()=>openPhotoPreview(0,{photos,originEl:origin}));
 assert.deepEqual(await p.evaluate(()=>readPaint()),await p.evaluate(()=>paintBefore));
 await p.waitForTimeout(320);
 const closing=await p.evaluate(()=>{closePhotoPreview();var root=photoPreviewOverlay,wrap=ppImageWrapper;var rootMotion=root.getAnimations()[0],wrapMotion=wrap.getAnimations()[0];rootMotion.pause();rootMotion.currentTime=120;wrapMotion.finish();return {root:root.classList.contains('active'),opacity:getComputedStyle(root).opacity};});
 assert.equal(closing.root,true);assert.ok(Number(closing.opacity)>0&&Number(closing.opacity)<1);
 await p.waitForTimeout(30);assert.equal(await p.locator('#photoPreviewOverlay').evaluate(n=>n.classList.contains('active')),true);
 await p.evaluate(()=>photoPreviewOverlay.getAnimations()[0].finish());await p.waitForFunction(()=>!photoPreviewOverlay.classList.contains('active'));
 assert.deepEqual(await p.evaluate(()=>readPaint()),await p.evaluate(()=>paintBefore));assert.equal(await p.locator('#photoPreviewOverlay').evaluate(n=>n.getAnimations().length),0);
});
