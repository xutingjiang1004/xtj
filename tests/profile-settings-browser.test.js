'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
const {DEFAULTS}=require('../render-api/profile-settings');
async function preferences(f){
 const settings={...DEFAULTS,signature:'账号中的签名',cover_url:f.origin+'/test-image/cover-0.png'};let last;
 await f.page.route('**/api/profile/settings**',async route=>{const req=route.request();if(req.method()==='PATCH'){last=req.postDataJSON();Object.assign(settings,last);}if(req.method()==='POST')settings.cover_url=f.origin+'/test-image/new-cover-1.png';await route.fulfill({json:{ok:true,settings}});});
 await f.page.evaluate(()=>{switchDockTab('profile',true);return __xtjReloadProfileSettings();});await f.page.waitForFunction(()=>document.getElementById('profileSettingsStatus').textContent==='设置已同步到账号');return{settings,last:()=>last};
}
test('personal settings save account preferences, publish cover to author page, and avoid stale privacy markers',{timeout:45000},async()=>{
 const f=await postBrowserFixture({viewport:{width:1280,height:880},counts:[3]});try{
 const {page}=f,p=await preferences(f);const dock=await page.locator('#dockBar').evaluate(n=>[n.offsetWidth,n.offsetHeight]);
 await page.locator('[name=signature]').fill('新的个性签名');await page.locator('[name=accent]').selectOption('violet');await page.locator('[name=font_size]').selectOption('large');await page.locator('[name=default_visibility]').selectOption('private');await page.locator('#profilePreferences button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('profileSettingsStatus').textContent.startsWith('已保存'));
 assert.equal(p.last().signature,'新的个性签名');assert.equal(p.last().default_visibility,'private');assert.equal(await page.locator('#postVisibility').inputValue(),'private');assert.equal(await page.locator('html').getAttribute('data-profile-accent'),'violet');
 await page.route('**/api/profile/posts/**',route=>route.fulfill({json:{ok:true,profile:p.settings,posts:f.posts,has_more:false}}));await page.evaluate(()=>openUserProfile('alice'));await page.waitForSelector('#authorPostsCover img');assert.equal(await page.locator('#authorPostsCover img').getAttribute('src'),p.settings.cover_url);assert.equal(await page.locator('#authorPostsSignature').textContent(),'新的个性签名');
 await page.evaluate(post=>__xtjUpdateAuthorPost({...post,visibility:'private'}),f.posts[0]);assert.match(await page.locator('.author-post-meta').textContent(),/仅自己可见/);
 await page.evaluate(()=>closeModal('userProfileModal'));assert.deepEqual(await page.locator('#dockBar').evaluate(n=>[n.offsetWidth,n.offsetHeight]),dock);assert.deepEqual(f.errors,[]);
 }finally{await f.close()}
});
test('late settings response cannot apply account A preferences to account B',{timeout:45000},async()=>{
 const f=await postBrowserFixture({counts:[3]});try{await preferences(f);let release;const held=new Promise(r=>release=r);await f.page.route('**/api/profile/settings',async route=>{await held;await route.fulfill({json:{ok:true,settings:{...DEFAULTS,signature:'过期的甲账号',accent:'rose'}}});});await f.page.evaluate(()=>{window.pendingSettings=__xtjReloadProfileSettings();});await f.page.waitForTimeout(50);await f.page.evaluate(()=>{currentUser='bob';_authStateEpoch++;});release();await f.page.evaluate(()=>pendingSettings);assert.notEqual(await f.page.locator('#profileOwnSignature').textContent(),'过期的甲账号');assert.notEqual(await f.page.locator('html').getAttribute('data-profile-accent'),'rose');}finally{await f.close()}
});
test('iPad research remains the top page while keyboard shrinks and closes without exposing main chat',{timeout:45000},async()=>{
 const f=await postBrowserFixture({viewport:{width:1280,height:880},ios:'ipad-desktop',counts:[3]});try{const {page}=f;await wireAiChat(page);await page.evaluate(()=>__xtjAiAgent.openDeepThink());await page.locator('#dtInput').fill('新的研究问题');await page.evaluate(()=>{testKeyboardViewport.height=380;testKeyboardViewport.dispatchEvent(new Event('resize'));});await page.setViewportSize({width:1280,height:380});await page.waitForTimeout(100);assert.equal(await page.locator('#panelAiChat').evaluate(n=>getComputedStyle(n).visibility),'hidden');assert.equal(await page.evaluate(()=>document.elementFromPoint(600,200).closest('#panelDeepThink')?.id),'panelDeepThink');assert.equal(await page.locator('#dtInput').inputValue(),'新的研究问题');assert.equal(await page.locator('#dockBar').evaluate(n=>getComputedStyle(n).display),'none');await page.locator('#dtInput').blur();await page.setViewportSize({width:1280,height:880});await page.evaluate(()=>{testKeyboardViewport.height=880;testKeyboardViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(150);assert.ok(await page.locator('#panelDeepThink').isVisible());assert.equal(await page.locator('.dt-title').textContent(),'深入研究');await page.locator('#dtBackBtn').click();await page.waitForFunction(()=>!document.body.classList.contains('xtj-research-open'));assert.ok(await page.locator('#panelAiChat').isVisible());assert.deepEqual(f.errors,[]);}finally{await f.close()}
});

test('theme auto-save preserves an unsaved signature and resetting cover stays cleared on author pages',{timeout:45000},async()=>{
 const f=await postBrowserFixture({counts:[3]});try{const p=await preferences(f),page=f.page;
 await page.locator('[name=signature]').fill('尚未保存的签名');await page.evaluate(()=>XTJThemeController.setMode('dark'));await page.waitForFunction(()=>document.getElementById('profileSettingsStatus').textContent.startsWith('已保存'));assert.equal(await page.locator('[name=signature]').inputValue(),'尚未保存的签名');assert.equal(p.settings.signature,'账号中的签名');
 await page.locator('[data-image-clear=cover]').click();await page.waitForFunction(()=>!document.querySelector('#profileOwnCover img'));assert.equal(await page.locator('[name=signature]').inputValue(),'尚未保存的签名');
 await page.route('**/api/profile/posts/**',route=>route.fulfill({json:{ok:true,profile:p.settings,posts:f.posts,has_more:false}}));await page.evaluate(()=>openUserProfile('alice'));await page.waitForSelector('.author-post-row');assert.equal(await page.locator('#authorPostsCover img').count(),0);
 }finally{await f.close()}
});
