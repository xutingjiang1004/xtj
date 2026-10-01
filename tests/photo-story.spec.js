const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const ids=['123e4567-e89b-42d3-a456-000000000091','123e4567-e89b-42d3-a456-000000000092'];
async function storyFixture(page,avatarURL){
 await page.route('**/story-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="photoGrid"></div>'}));await page.goto('/story-fixture');
 await page.addStyleTag({content:source('css/style.css')+source('css/ui-shell.css')+source('css/photo-preview.css')});
 const image=await sharp({create:{width:1600,height:900,channels:3,background:'#608b80'}}).jpeg().toBuffer();await page.route('**/story-*.jpg',r=>r.fulfill({contentType:'image/jpeg',body:image}));await page.route('**/api/avatar/public/*',r=>r.fulfill({json:{avatar_url:avatarURL||'http://127.0.0.1:4176/story-0.jpg'}}));
 await page.addScriptTag({content:'window.currentUser="B";window.showToast=function(){};window.updateAmbientBackground=function(){};window.__socialCalls=[];window.__views={};window.__liked={};window.__comments={};window.xtjProtectedFetch=async function(url,options={}){window.__socialCalls.push({url,body:options.body});let body={ok:true};let id=url.match(/photo\\/([^/]+)\\//)?.[1]||"";if(url.endsWith("/social"))body={ok:true,like_count:window.__liked[id]?1:0,liked:!!window.__liked[id],comment_count:(window.__comments[id]||[]).length,views:window.__views[id]?1:0,comments:window.__comments[id]||[],has_more:false};else if(url.endsWith("/like")){window.__liked[id]=JSON.parse(options.body).liked;body={ok:true,like_count:window.__liked[id]?1:0,liked:window.__liked[id]};}else if(url.endsWith("/comments")){const text=JSON.parse(options.body).content;body={ok:true,comment:{id:"123e4567-e89b-42d3-a456-000000000099",user_name:"B",content:text,created_at:new Date().toISOString()}};(window.__comments[id]||(window.__comments[id]=[])).unshift(body.comment);}else if(url==="/api/photo/view"){id=JSON.parse(options.body).photo_id;window.__views[id]=1;body={ok:true,views:1,recorded:true};}return new Response(JSON.stringify(body),{status:200});};'+source('js/photo-wall/data.js')+source('js/photo-wall/story.js')+source('js/photo-wall/preview.js')+source('js/photo-wall/preview-hotfix.js')});
 await page.evaluate(ids=>{window.__photos=ids.map((id,i)=>({id,cloudId:id,username:'A',imageUrl:location.origin+'/story-'+i+'.jpg',timestamp:Date.now(),views:0,caption:i?'第二张照片':'雪山下的一天\n<img src=x onerror=alert(1)>只是文字'}));window.openPhotoPreview(0,window.__photos);},ids);
 await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity','1');await expect(page.locator('#ppLikeBtn')).toBeEnabled();
}
test('photo story uses bare arrows, transparent close, lower-corner icons and safe caption text',async({page})=>{
 await page.setViewportSize({width:390,height:844});await storyFixture(page);await expect(page.locator('#ppStoryCaption')).toContainText('<img src=x');expect(await page.locator('#ppStoryCaption img').count()).toBe(0);
 for(const selector of ['#ppPrevBtn','#ppNextBtn','#ppInfoBtn','#ppShareBtn','#ppRotateBtn']){const style=await page.locator(selector).evaluate(el=>{let s=getComputedStyle(el),r=el.getBoundingClientRect();return {bg:s.backgroundColor,shadow:s.boxShadow,width:r.width,height:r.height};});expect(style.bg,selector).toBe('rgba(0, 0, 0, 0)');expect(style.shadow).toBe('none');expect(style.width).toBeGreaterThanOrEqual(44);expect(style.height).toBeGreaterThanOrEqual(44);}
 const close=await page.locator('.photo-preview-close').evaluate(el=>({width:el.getBoundingClientRect().width,blur:getComputedStyle(el).backdropFilter||getComputedStyle(el).webkitBackdropFilter}));expect(close.width).toBe(44);expect(close.blur).toContain('3px');
 const toolbar=await page.locator('.pp-preview-toolbar').boundingBox();expect(toolbar.x+toolbar.width).toBeGreaterThan(350);expect(toolbar.y).toBeGreaterThan(740);await expect(page.locator('#ppDeleteBtn')).toBeHidden();await expect(page.locator('#ppStoryAvatar img')).toBeVisible();await page.evaluate(()=>window.renderPhotoStory(window.__photos[0]));await expect(page.locator('#ppStoryAvatar img')).toBeVisible();await page.screenshot({path:'/workspace/scratch/photo-story-'+test.info().project.name+'.png'});
});
test('photo likes and comments persist across switching, failures preserve input and caption stays per-photo',async({page})=>{
 await storyFixture(page);await page.locator('#ppLikeBtn').click();await expect(page.locator('#ppLikeBtn')).toHaveAttribute('aria-pressed','true');await page.locator('#ppCommentBtn').click();await page.locator('#ppCommentInput').fill('<script>只是评论</script>');await page.locator('#ppCommentSend').click();await expect(page.locator('.pp-comment-row')).toContainText('<script>只是评论</script>');expect(await page.locator('.pp-comment-row script').count()).toBe(0);await expect(page.locator('#ppCommentCount')).toHaveText('1');
 await page.locator('#ppCommentsClose').click();await page.locator('#ppNextBtn').click();await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');await expect(page.locator('#ppLikeCount')).toHaveText('0');await page.locator('#ppPrevBtn').click();await expect(page.locator('#ppLikeCount')).toHaveText('1');await page.locator('#ppCommentBtn').click();await expect(page.locator('.pp-comment-row')).toHaveCount(1);
 await page.evaluate(()=>{const original=window.xtjProtectedFetch;window.xtjProtectedFetch=(url,options)=>url.endsWith('/comments')?Promise.resolve(new Response(JSON.stringify({ok:false,error:'暂时无法发送'}),{status:503})):original(url,options);});await page.locator('#ppCommentInput').fill('保留这条评论');await page.locator('#ppCommentSend').click();await expect(page.locator('#ppCommentError')).toHaveText('暂时无法发送');await expect(page.locator('#ppCommentInput')).toHaveValue('保留这条评论');await expect(page.locator('#ppCommentSend')).toBeEnabled();
});
test('repeat views of one account count once and preloading never records a neighbouring photo',async({page})=>{
 await storyFixture(page);await expect(page.locator('#photoPreviewViewsCount')).toHaveText('1');let calls=await page.evaluate(()=>window.__socialCalls.filter(c=>c.url==='/api/photo/view'));expect(calls).toHaveLength(1);expect(JSON.parse(calls[0].body).photo_id).toBe(ids[0]);
 await page.locator('#ppNextBtn').click();await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');await expect(page.locator('#photoPreviewViewsCount')).toHaveText('1');await page.locator('#ppPrevBtn').click();await expect(page.locator('#ppStoryCaption')).toContainText('雪山');calls=await page.evaluate(()=>window.__socialCalls.filter(c=>c.url==='/api/photo/view'));expect(calls).toHaveLength(2);
 await page.evaluate(()=>{window.forceClosePhotoPreview();window.openPhotoPreview(0,window.__photos);});await expect(page.locator('#photoPreviewViewsCount')).toHaveText('1');calls=await page.evaluate(()=>window.__socialCalls.filter(c=>c.url==='/api/photo/view'));expect(calls).toHaveLength(2);
});
test('slide frames never shrink and then enlarge the incoming image',async({page})=>{
 await storyFixture(page);await expect(page.locator('#ppNextImg')).toHaveJSProperty('naturalWidth',1600);
 const widths=await page.evaluate(async()=>{let values=[document.getElementById('ppNextImg').getBoundingClientRect().width];window.ppNextPhoto();let begin=performance.now();while(performance.now()-begin<550){await new Promise(requestAnimationFrame);for(const img of document.querySelectorAll('.pp-slide-img')){if(img.src.endsWith('story-1.jpg')&&getComputedStyle(img).opacity==='1')values.push(img.getBoundingClientRect().width);}}values.push(document.getElementById('photoPreviewImage').getBoundingClientRect().width);return values;});expect(widths.length).toBeGreaterThan(2);expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(1);
});
async function fullPage(page){await page.addInitScript(()=>localStorage.setItem('xtj_user','A'));await page.route('**/*.supabase.co/**',r=>r.fulfill({json:[]}));await page.route('**/api/**',r=>r.fulfill({json:{ok:true,user_name:'A',token:'signed-A',is_admin:false,restrictions:{},data:[],items:[],conversations:[],friends:[],users:[]}}));await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window._xtjAuthState==='authenticated');}
test('iPad visual viewport, restored outer scroll and orientation keep top controls reachable',async({page})=>{
 await page.setViewportSize({width:1180,height:820});await page.addInitScript(()=>{Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});const vv=new EventTarget();Object.assign(vv,{width:1180,height:680,offsetTop:40,offsetLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{value:vv});window.__vv=vv;});await fullPage(page);await expect(page.locator('html')).toHaveClass(/xtj-ios-viewport/);
 for(const [height,top,width]of [[680,40,1180],[700,0,1180],[960,0,820]]){await page.setViewportSize({width,height:height+80});await page.evaluate(({height,top,width})=>{Object.assign(window.__vv,{height,offsetTop:top,width});window.__vv.dispatchEvent(new Event('resize'));}, {height,top,width});await page.waitForTimeout(100);const rect=await page.locator('.app-container').boundingBox();expect(Math.abs(rect.y-top)).toBeLessThan(1);expect(Math.abs(rect.height-height)).toBeLessThan(1);const button=page.locator('.desktop-nav-item[data-desktop-tab="chat"]');await expect(button).toBeVisible();expect(await button.evaluate(el=>{let r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);}
 await page.evaluate(()=>window.scrollTo(0,100));expect(await page.evaluate(()=>window.scrollY)).toBe(0);
});
test('chat list retries transient errors without repeated global refresh toasts and keeps cached contacts',async({page})=>{
 await fullPage(page);await page.evaluate(()=>window.switchDockTab('chat'));await expect.poll(()=>page.evaluate(()=>window.dockChatListCacheTime||0)).toBeGreaterThan(0);let attempts=0;await page.evaluate(()=>{window.__chatAttempts=0;window.dockChatListCacheTime=0;const list=document.getElementById('dockChatList');list.setAttribute('data-list-owner','A');list.innerHTML='<div class="chat-list-item" data-chat-user="B">保留的会话</div>';window.__xtjInvalidateDmListShared();const old=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>url.startsWith('/api/dm/list')?(window.__chatAttempts++,new Response(JSON.stringify({ok:false,error:'temporary'}),{status:503})):old(url,options);});
 await page.evaluate(()=>window.switchDockTab('chat'));await expect.poll(()=>page.evaluate(()=>window.__chatAttempts)).toBe(2);await expect(page.locator('#dockChatList')).toContainText('保留的会话');await page.waitForTimeout(100);await expect(page.locator('#toastContainer')).not.toContainText('消息列表刷新失败');await page.evaluate(()=>window.fetchDmListShared(180));expect(await page.evaluate(()=>window.__chatAttempts)).toBe(2);
});

test('delete shares the lower-right tool row before information and detail close reaches its button',async({page})=>{
 await storyFixture(page);await page.evaluate(()=>{window.currentUser='A';window.dispatchEvent(new CustomEvent('xtj:permissions-ready'));});await expect(page.locator('#ppDeleteBtn')).toBeVisible();
 const boxes=await Promise.all(['#ppDeleteBtn','#ppInfoBtn','#ppShareBtn','#ppRotateBtn'].map(s=>page.locator(s).boundingBox()));for(let k=1;k<boxes.length;k++){expect(Math.abs(boxes[k].y-boxes[0].y)).toBeLessThan(1);expect(boxes[k].x).toBeGreaterThanOrEqual(boxes[k-1].x+boxes[k-1].width);}
 const storyBox=await page.locator('.pp-story').boundingBox();expect(storyBox.x).toBeGreaterThanOrEqual(15);expect(storyBox.x).toBeLessThan(18);await expect(page.locator('.pp-story')).toHaveCSS('opacity','1');await expect(page.locator('#ppStoryAvatar')).toBeInViewport();await page.screenshot({path:'/workspace/scratch/photo-tools-'+test.info().project.name+'.png'});await page.locator('#ppInfoBtn').click();await expect(page.locator('#ppInfoModal')).toHaveClass(/active/);await page.locator('.pp-info-modal-close').click();await expect(page.locator('#ppInfoModal')).not.toHaveClass(/active/);await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);
});
test('single taps never dismiss, double tap still zooms and a deliberate downward drag closes',async({page})=>{
 await storyFixture(page);await page.evaluate(()=>{const root=document.getElementById('photoPreviewOverlay');function tap(x,y,id){for(const type of ['pointerdown','pointerup'])root.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,clientX:x,clientY:y}));}tap(160,250,10);});await page.waitForTimeout(450);await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);
 await page.evaluate(()=>{const root=document.getElementById('photoPreviewOverlay');for(let id=11;id<13;id++)for(const type of ['pointerdown','pointerup'])root.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,clientX:160,clientY:250}));});await expect(page.locator('#photoPreviewImage')).toHaveClass(/zoomed/);
 await page.evaluate(()=>{window.zoomOut();window.zoomOut();});await page.evaluate(()=>{const root=document.getElementById('photoPreviewOverlay');for(const [type,y]of [['pointerdown',220],['pointermove',310],['pointermove',410],['pointerup',410]])root.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:14,clientX:160,clientY:y}));});await expect(page.locator('#photoPreviewOverlay')).not.toHaveClass(/active/);
});
test('likes respond before a slow server, animate once, serialize rapid toggles and roll back failure',async({page})=>{
 await storyFixture(page);await page.evaluate(()=>{const old=window.xtjProtectedFetch;window.__likeReleases=[];window.__pendingLikes=[];window.xtjProtectedFetch=(url,options)=>url.endsWith('/like')?new Promise(resolve=>{const liked=JSON.parse(options.body).liked;window.__pendingLikes.push(liked);window.__likeReleases.push(()=>resolve(new Response(JSON.stringify({ok:true,liked,like_count:liked?1:0}),{status:200})));}):old(url,options);});
 await page.locator('#ppLikeBtn').click();await expect(page.locator('#ppLikeBtn')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#ppLikeCount')).toHaveText('1');expect(await page.locator('#ppLikeBtn svg').evaluate(el=>el.getAnimations().length)).toBeGreaterThan(0);await expect(page.locator('#ppSocialStatus')).toBeEmpty();
 await page.locator('#ppLikeBtn').click();await expect(page.locator('#ppLikeCount')).toHaveText('0');expect(await page.evaluate(()=>window.__pendingLikes)).toEqual([true]);await page.evaluate(()=>window.__likeReleases.shift()());await expect.poll(()=>page.evaluate(()=>window.__pendingLikes.length)).toBe(2);await page.evaluate(()=>window.__likeReleases.shift()());await expect(page.locator('#ppLikeBtn')).toHaveAttribute('aria-pressed','false');
 await page.evaluate(()=>{window.xtjProtectedFetch=async()=>new Response(JSON.stringify({ok:false,error:'offline'}),{status:503});});await page.locator('#ppLikeBtn').click();await expect(page.locator('#ppSocialStatus')).toContainText('点赞未保存');await expect(page.locator('#ppLikeCount')).toHaveText('0');await expect(page.locator('#ppLikeBtn')).toHaveAttribute('aria-pressed','false');
});
test('rapid navigation and pointer cancellation do not close or restore an older photo',async({page})=>{
 await storyFixture(page);await page.evaluate(()=>{window.ppNextPhoto();window.ppPrevPhoto();window.ppNextPhoto();});await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');await page.waitForTimeout(900);await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);
 await page.evaluate(()=>{const root=document.getElementById('photoPreviewOverlay');for(const [type,x,y]of [['pointerdown',240,300],['pointermove',170,305],['pointercancel',150,330]])root.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:19,clientX:x,clientY:y}));});await page.waitForTimeout(350);await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);const track=await page.locator('#ppSlideTrack').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41);expect(Math.abs(track+await page.evaluate(()=>innerWidth))).toBeLessThan(1);
});
test('entry and exit animate to the current wall tile and reopening cancels old cleanup',async({page})=>{
 await storyFixture(page);await page.evaluate(()=>{window.forceClosePhotoPreview();const grid=document.getElementById('photoGrid');window.__photos.forEach((photo,k)=>{const card=document.createElement('div');card.className='photo-wall-item';card.dataset.photoId=photo.id;card.style.cssText='position:fixed;left:'+(20+k*125)+'px;top:100px;width:100px;height:75px';const img=document.createElement('img');img.src=photo.imageUrl;img.style.cssText='width:100px;height:75px';card.append(img);grid.append(card);});});await expect(page.locator('#photoGrid img').first()).toHaveJSProperty('naturalWidth',1600);
 const entry=await page.evaluate(()=>{window.openPhotoPreview(0,window.__photos);const wrap=document.getElementById('ppImageWrapper');window.__entryWidth=wrap.getBoundingClientRect().width;return wrap.getAnimations()[0].effect.getKeyframes()[0].transform;});expect(entry).toContain('translate3d');expect(await page.evaluate(()=>window.__entryWidth)).toBeLessThan(await page.evaluate(()=>innerWidth));await page.waitForTimeout(280);await page.locator('#ppNextBtn').click();await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');
 const target=await page.evaluate(()=>{window.closePhotoPreview();return document.getElementById('ppImageWrapper').getAnimations()[0].effect.getKeyframes().at(-1).transform;});expect(target).toContain('translate3d');expect(target).not.toBe(entry);await page.evaluate(()=>window.openPhotoPreview(0,window.__photos));await page.waitForTimeout(650);await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);await expect(page.locator('#ppStoryCaption')).toContainText('雪山');await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src',/story-0.jpg$/);
});

test('lifting one pinch finger cannot turn its remaining downward movement into dismissal',async({page})=>{
 await storyFixture(page);await page.evaluate(()=>{const root=document.getElementById('photoPreviewOverlay');const send=(type,id,x,y)=>root.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,clientX:x,clientY:y}));send('pointerdown',21,100,260);send('pointerdown',22,220,260);send('pointermove',22,225,260);send('pointerup',22,225,260);send('pointermove',21,100,480);send('pointerup',21,100,480);});await page.waitForTimeout(450);await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);
});

test('decoded author avatar persists across same-author switches without another request',async({page})=>{
 await storyFixture(page);await expect(page.locator('#ppStoryAvatar img')).toHaveCount(1);await expect(page.locator('#ppStoryAvatar img')).toHaveJSProperty('naturalWidth',1600);
 const original=await page.locator('#ppStoryAvatar img').evaluate(img=>{window.__avatarNode=img;return img.src;});
 await page.evaluate(()=>window.ppNextPhoto());await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');expect(await page.locator('#ppStoryAvatar img').evaluate(img=>img===window.__avatarNode)).toBe(true);await expect(page.locator('#ppStoryAvatar img')).toHaveAttribute('src',original);
});
test('comments have 80 percent transparent glass and reversible entrance and exit',async({page})=>{
 await storyFixture(page);await page.locator('#ppCommentBtn').click();const panel=page.locator('#ppCommentsPanel');await expect(panel).toBeVisible();
 expect(await panel.evaluate(el=>getComputedStyle(el).backgroundColor)).toMatch(/0\.2\)/);expect(await panel.evaluate(el=>el.getAnimations().length)).toBeGreaterThan(0);
 await page.locator('#ppCommentsClose').click();await expect(panel).toBeHidden();
 await page.evaluate(()=>{document.getElementById('ppCommentBtn').click();document.getElementById('ppCommentsClose').click();document.getElementById('ppCommentBtn').click();});await page.waitForTimeout(300);await expect(panel).toBeVisible();
 await page.evaluate(()=>window.ppNextPhoto());await expect(page.locator('#ppStoryCaption')).toHaveText('第二张照片');await expect(panel).toBeHidden();
});

test('delete confirmation stays readable over bright and dark photo backgrounds',async({page})=>{
 await fullPage(page);await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<div id="contrastPhoto" style="position:fixed;inset:0;background:repeating-linear-gradient(45deg,#fff 0 70px,#172a24 70px 140px);z-index:10000"></div>');window.showConfirm('删除照片','删除后无法恢复，确定要删除吗？','删除',function(){});});
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);await page.waitForTimeout(150);
  const style=await page.locator('.pp-confirm-dialog').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,text:getComputedStyle(document.getElementById('ppConfirmMsg')).color}));expect(style.bg).toContain('0.5');expect(style.text).toBe('rgb(38, 58, 48)');
  if(page.context().browser().browserType().name()==='chromium')await page.screenshot({path:'/workspace/scratch/delete-confirm-'+theme+'.png'});
 }
});

test('retired behavior diagnostic has no profile control and ignores legacy consent events',async({page})=>{
 const batches=[];await fullPage(page);await page.route('**/api/user/behavior',async r=>{batches.push(r.request().postDataJSON());await r.fulfill({json:{ok:true}});});
 await page.evaluate(()=>{window.currentUser='A';window.dispatchEvent(new Event('auth-ready'));window.dispatchEvent(new CustomEvent('xtj:behavior-consent',{detail:{owner:'A',enabled:true}}));});
 await expect(page.locator('#xtjBehaviorConsent')).toHaveCount(0);await page.locator('#postInp').fill('不采集正文');await page.waitForTimeout(1200);expect(batches).toEqual([]);
});

test('photos keep their brightness on opening and switching, with no full-image dark scrim',async({page})=>{
 await page.setViewportSize({width:390,height:844});await storyFixture(page);await page.waitForTimeout(300);
 for(let i=0;i<2;i++){const raw=await sharp(await page.screenshot()).raw().toBuffer({resolveWithObject:true});const scale=raw.info.width/390;const index=(Math.round(472*scale)*raw.info.width+Math.round(195*scale))*raw.info.channels;expect(raw.data[index]).toBeGreaterThan(90);expect(raw.data[index+1]).toBeGreaterThan(130);expect(raw.data[index+2]).toBeGreaterThan(120);if(!i){await page.evaluate(()=>window.ppNextPhoto());await page.waitForTimeout(500);}}
});
test('compact composer removes the default filter card and deletion pills in both themes',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await fullPage(page);await expect(page.locator('#postFilterBar')).toHaveCount(0);await expect(page.locator('#postFilterPanel')).toBeHidden();await expect(page.locator('#postLocationAddBtn svg')).toBeVisible();await expect(page.locator('.compose-tool svg')).toHaveCount(2);
 expect((await page.locator('#publishBox').boundingBox()).height).toBeLessThan(260);await page.screenshot({path:info.outputPath('compact-composer.png')});
 await page.locator('#filterToggleBtn').click();await expect(page.locator('#postFilterPanel')).toBeVisible();await page.locator('#filterToggleBtn').click();
 for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.getElementById('delModal').style.display='flex';document.getElementById('delModal').classList.add('active');},theme);await expect(page.locator('#delModal .post-delete-modal')).toHaveCSS('background-color','rgba(248, 253, 250, 0.7)');for(const selector of ['#delModal .post-delete-message','#delModal .post-delete-cancel','#delModal .post-delete-confirm']){await expect(page.locator(selector)).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(page.locator(selector)).toHaveCSS('box-shadow','none');}await page.screenshot({path:info.outputPath('post-delete-'+theme+'.png')});}
});
test('explicit post GPS carries accuracy and capture identity, while stale account callbacks cannot send',async({page})=>{
 await fullPage(page);await page.evaluate(()=>{window.__gpsCalls=[];Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){window.__gpsSuccess=success;}}});window.xtjProtectedFetch=async(url,init)=>{window.__gpsCalls.push({url,body:init&&init.body});return new Response(JSON.stringify({ok:true,province:'福建省',city:'福州市',options:[{level:'city',name:'福建省福州市',province:'福建省',city:'福州市'}]}));};});
 await page.locator('#postLocationAddBtn').click();await page.evaluate(()=>window.__gpsSuccess({timestamp:Date.now(),coords:{latitude:26.1,longitude:119.2,accuracy:0}}));await page.locator('.post-location-option').first().click();await expect(page.locator('#postLocationPreview')).toBeVisible();const call=await page.evaluate(()=>window.__gpsCalls.find(c=>c.url==='/api/location/reverse'));const body=JSON.parse(call.body);expect(body.latitude).toBe(26.1);expect(body.accuracy).toBe(0);expect(body.capture_id).toMatch(/^post_/);expect(body.captured_at).toBeTruthy();
 await page.evaluate(()=>window.removePostLocation());await page.locator('#postLocationAddBtn').click();const before=await page.evaluate(()=>window.__gpsCalls.length);await page.evaluate(()=>{window.currentUser='another';window.__gpsSuccess({timestamp:Date.now(),coords:{latitude:26,longitude:119,accuracy:10}});});expect(await page.evaluate(()=>window.__gpsCalls.length)).toBe(before);await expect(page.locator('#postLocationAddBtn')).toBeEnabled();await expect(page.locator('#postLocationAddBtn svg')).toBeVisible();
});

test('ordinary users with legacy inline JPEG avatars display the saved image and replace it immediately after upload',async({page})=>{
 const one='data:image/jpeg;base64,'+(await sharp({create:{width:96,height:96,channels:3,background:'#a23f68'}}).jpeg().toBuffer()).toString('base64');
 const two='data:image/png;base64,'+(await sharp({create:{width:96,height:96,channels:3,background:'#379c70'}}).png().toBuffer()).toString('base64');
 await storyFixture(page,one);await page.evaluate(()=>{window.__photos[0].username='xtj';window.renderPhotoStory(window.__photos[0]);});await expect(page.locator('#ppStoryAvatar img')).toHaveAttribute('src',one);await expect(page.locator('#ppStoryAvatar img')).toHaveJSProperty('naturalWidth',96);
 await page.evaluate(({one,two})=>{window.xtjFetchAvatarUrl=async()=>two;window.dispatchEvent(new CustomEvent('xtj:avatar-updated',{detail:{username:'xtj',url:two}}));},{one,two});await expect(page.locator('#ppStoryAvatar img')).toHaveAttribute('src',two);
 await page.evaluate(()=>{window.__photos[1].username='xtj';window.ppNextPhoto();});await expect(page.locator('#ppStoryAvatar img')).toHaveAttribute('src',two);
});
test('a delayed old avatar cannot replace an uploaded avatar, and SVG inline avatars stay rejected',async({page})=>{
 await storyFixture(page);await expect(page.locator('#ppStoryAvatar img')).toBeVisible();
 const two='data:image/png;base64,'+(await sharp({create:{width:96,height:96,channels:3,background:'#379c70'}}).png().toBuffer()).toString('base64');
 await page.evaluate(two=>{window.xtjFetchAvatarUrl=()=>new Promise(resolve=>window.__releaseOldAvatar=resolve);window.dispatchEvent(new CustomEvent('xtj:avatar-updated',{detail:{username:'A',url:'old'}}));window.xtjFetchAvatarUrl=async()=>two;window.dispatchEvent(new CustomEvent('xtj:avatar-updated',{detail:{username:'A',url:two}}));},two);
 await expect(page.locator('#ppStoryAvatar img')).toHaveAttribute('src',two);await page.evaluate(()=>window.__releaseOldAvatar(location.origin+'/story-0.jpg'));await expect(page.locator('#ppStoryAvatar img')).toHaveAttribute('src',two);
 await page.evaluate(()=>{window.xtjFetchAvatarUrl=async()=> 'data:image/svg+xml;base64,PHN2Zy8+';window.__photos[1].username='unsafe';window.ppNextPhoto();});await expect(page.locator('#ppStoryAvatar img')).toHaveCount(0);
});

test('view, like and comment icons never inherit square glass backgrounds in either theme',async({page},info)=>{
 await storyFixture(page);
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const selector of ['.pp-views','#ppLikeBtn','#ppCommentBtn']){
   const layers=await page.locator(selector).evaluate(el=>[el,...el.querySelectorAll('svg,span')].map(node=>({bg:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage,before:getComputedStyle(node,'::before').content,after:getComputedStyle(node,'::after').content})));
   for(const layer of layers){expect(layer.bg).toBe('rgba(0, 0, 0, 0)');expect(layer.image).toBe('none');expect(['none','normal']).toContain(layer.before);expect(['none','normal']).toContain(layer.after);}
  }
  await page.screenshot({path:info.outputPath('photo-icons-'+theme+'.png')});
 }
 await page.locator('#ppLikeBtn').click();await expect(page.locator('#ppLikeBtn')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#ppLikeBtn')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
});

test('photo deletion glass stays fixed from the first frame and cancel never deletes',async({page})=>{
 await fullPage(page);
 const samples=await page.evaluate(async()=>{
  window.__confirmDeletes=0;window._confirmOrigin={btnCx:350,btnCy:700,btnWidth:40,btnHeight:40};
  window.showConfirm('删除照片','删除后无法恢复，确定删除吗？','确定删除',()=>window.__confirmDeletes++);
  const overlay=document.getElementById('ppConfirmOverlay'),dialog=overlay.querySelector('.pp-confirm-dialog'),samples=[];
  const started=performance.now();do {const o=getComputedStyle(overlay),d=getComputedStyle(dialog);samples.push({opacity:o.opacity,dialogOpacity:d.opacity,transform:d.transform,blur:d.backdropFilter||d.webkitBackdropFilter});await new Promise(requestAnimationFrame);}while(performance.now()-started<650);
  return samples;
 });
 for(const sample of samples){expect(sample.opacity).toBe('1');expect(sample.dialogOpacity).toBe('1');expect(sample.transform).toBe('none');expect(sample.blur).toContain('blur(12px)');}
 await page.locator('.pp-confirm-cancel').click();await expect(page.locator('#ppConfirmOverlay')).not.toHaveClass(/active|closing/);expect(await page.evaluate(()=>window.__confirmDeletes)).toBe(0);
 await page.evaluate(()=>window.showConfirm('删除照片','删除后无法恢复，确定删除吗？','确定删除',()=>window.__confirmDeletes++));
 await page.locator('#ppConfirmOkBtn').click();await expect.poll(()=>page.evaluate(()=>window.__confirmDeletes)).toBe(1);
});
