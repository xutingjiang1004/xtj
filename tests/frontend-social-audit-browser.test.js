'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const browserOptions={executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']};
test('real UI modules preserve user literals, release a pressed button outside and degrade GSAP safely',async()=>{
  const browser=await chromium.launch(browserOptions);try{
    const page=await browser.newPage();
    await page.setContent('<button id="button">按住后移出</button><main id="outside">外部</main><div id="feed"><article class="post"><div class="content">测试原文：鍒嗕韩 与 鍔犺浇</div></article></div><h2 data-xtj-legacy-text>鍔犺浇</h2><div id="modal"><div class="modal-box">对话框</div></div>');
    await page.addScriptTag({path:'js/ux-features.js'});
    const rect=await page.locator('#button').boundingBox();await page.mouse.move(rect.x+5,rect.y+5);await page.mouse.down();assert.equal(await page.locator('#button').evaluate(n=>n.classList.contains('xtj-pressing')),true);await page.mouse.move(500,200);await page.mouse.up();assert.equal(await page.locator('#button').evaluate(n=>n.classList.contains('xtj-pressing')),false);
    await page.addScriptTag({path:'js/features.js'});await page.waitForFunction(()=>document.querySelector('h2').textContent==='加载');assert.equal(await page.locator('.content').innerText(),'测试原文：鍒嗕韩 与 鍔犺浇');
    await page.evaluate(()=>{window.ensureGsap=()=>{window.gsapCalls++;return Promise.reject(new Error('cdn unavailable'));};window.gsapCalls=0;window.rejections=[];window.addEventListener('unhandledrejection',e=>{window.rejections.push(String(e.reason));e.preventDefault();});window.openModal=id=>document.getElementById(id).classList.add('active');});
    await page.addScriptTag({path:'js/core-animations.js'});await page.evaluate(()=>window.openModal('modal'));await page.waitForTimeout(100);await page.evaluate(()=>window.openModal('modal'));assert.deepEqual(await page.evaluate(()=>window.rejections),[]);assert.equal(await page.evaluate(()=>window.gsapCalls),1);assert.equal(await page.locator('#modal').evaluate(n=>n.classList.contains('active')),true);
  }finally{await browser.close();}
});
test('page retains native text zoom and media viewers remain responsible for their pinch gestures',async()=>{
  const browser=await chromium.launch(browserOptions);try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
    const meta=fs.readFileSync('index.html','utf8').match(/<meta name="viewport"[^>]*>/)[0];await page.setContent(meta+'<main>正常文本</main>');await page.addScriptTag({path:'js/desktop-shell.js'});
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.25});assert.equal(await page.evaluate(()=>visualViewport.scale),1.25);await context.close();
  }finally{await browser.close();}
});
test('profile avatar revalidates local cache and ignores a late decode/response after identity changes',async()=>{
  const browser=await chromium.launch(browserOptions);try{
    const page=await browser.newPage();await page.setContent('<div id="profileDetailAvatar"></div>');
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#f00';ctx.fillRect(0,0,2,2);const old=canvas.toDataURL();ctx.fillStyle='#00f';ctx.fillRect(0,0,2,2);window.newAvatarUrl=canvas.toDataURL();
      window.currentUser='A';window._authStateEpoch=1;window.avatarCache={};window.localAvatars={A:{url:old,state:'has_avatar',fetched_at:Date.now()-360000}};window.fetches=0;window.readAvatarCacheFromStorage=()=>window.localAvatars;window.writeAvatarCacheToStorage=data=>window.localAvatars=data;window.getAvatarUrl=name=>window.avatarCache[name]?.url;window.sanitizeUrl=url=>url;
      window.fetchAvatarUrl=async name=>{window.fetches++;window.avatarCache[name]={url:window.newAvatarUrl,state:'has_avatar',fetched_at:Date.now()};return window.newAvatarUrl;};
    });
    const src=fs.readFileSync('js/core-parts/03-profile-report-ai.js','utf8'),from=src.indexOf('            var profileAvatarRequestSeq'),to=src.indexOf('\n            }',from)+14;
    await page.addScriptTag({content:src.slice(from,to)});await page.evaluate(()=>loadProfileAvatar());assert.equal(await page.evaluate(()=>fetches),1);assert.equal(await page.locator('#profileDetailAvatar img').getAttribute('src'),await page.evaluate(()=>newAvatarUrl));
    await page.evaluate(()=>{window.fetchAvatarUrl=()=>new Promise(resolve=>window.releaseAvatar=resolve);window.avatarCache={};window.localAvatars={};window.avatarTask=loadProfileAvatar();});
    await page.waitForFunction(()=>!!window.releaseAvatar);await page.evaluate(()=>{currentUser='B';_authStateEpoch++;document.getElementById('profileDetailAvatar').textContent='B';releaseAvatar(newAvatarUrl);});await page.evaluate(()=>window.avatarTask);assert.equal(await page.locator('#profileDetailAvatar').innerText(),'B');
  }finally{await browser.close();}
});
test('an old failed user-profile request cannot overwrite the new target',async()=>{
  const browser=await chromium.launch(browserOptions);try{
    const page=await browser.newPage();await page.setContent('<div id="userProfileModal"><span id="upcName"></span><span id="upcLogin"></span><button id="upcMsgBtn"></button><div id="upcAvatar"></div></div>');
    await page.evaluate(()=>{window.upcTargetUser='';window.upcRequestSeq=0;window.currentUser='viewer';window.getAvatarUrl=()=>null;window.escapeHtml=String;window.sanitizeUrl=String;window.openModal=id=>document.getElementById(id).classList.add('active');window.fetchAvatarUrl=name=>name==='A'?new Promise((r,j)=>window.rejectA=j):Promise.resolve(null);});
    const src=fs.readFileSync('js/core-parts/03-profile-report-ai.js','utf8'),from=src.indexOf('            window.openUserProfile = async function'),to=src.indexOf('            window.upcSendMessage',from);await page.addScriptTag({content:src.slice(from,to)});
    await page.evaluate(()=>{window.aProfileTask=openUserProfile('A');});await page.evaluate(()=>openUserProfile('B'));assert.equal(await page.locator('#upcLogin').innerText(),'最近登录：-');await page.evaluate(()=>{rejectA(new Error('late A failure'));});await page.evaluate(()=>aProfileTask);assert.equal(await page.locator('#upcLogin').innerText(),'最近登录：-');
  }finally{await browser.close();}
});
