'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
async function center(page,selector){const r=await page.locator(selector).boundingBox();assert.ok(r&&r.width&&r.height,selector);return{x:r.x+r.width/2,y:r.y+r.height/2};}
async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function drag(page,from,to){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await frames(page);await page.mouse.up();}
async function active(page,tab){await page.waitForFunction(tab=>document.getElementById('panel'+tab[0].toUpperCase()+tab.slice(1)).classList.contains('active'),tab);}
test('mobile taps tolerate natural finger drift and never inherit another gesture click lock',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]}),p=f.page;
 try{
  const point=await center(p,'#dockBar [data-tab="chat"]');
  await p.mouse.move(point.x,point.y);await p.mouse.down();await p.mouse.move(point.x+3,point.y+2);await p.mouse.up();await active(p,'chat');
  for(const tab of ['posts','chat','profile','chat']){await p.locator('#dockBar [data-tab="'+tab+'"]').click();await active(p,tab);}
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('mobile drag selects once at release and an immediate fresh click is accepted',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]}),p=f.page;
 try{
  const a=await center(p,'#dockBar [data-tab="posts"]'),b=await center(p,'#dockBar [data-tab="profile"]');
  await drag(p,a,b);await active(p,'profile');
  assert.equal(await p.locator('#dockBar .dock-tab.active').getAttribute('data-tab'),'profile');
  await p.locator('#dockBar [data-tab="chat"]').click();await active(p,'chat');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for(const width of [820,1280])test(width+'px sidebar capsule follows vertical dragging and preserves all five routes',{timeout:45000},async()=>{
 const f=await postBrowserFixture({viewport:{width,height:1000},counts:[1],publicPosts:true}),p=f.page;
 try{
  await p.waitForSelector('.desktop-workbench-nav.has-selection-indicator');
  const a=await center(p,'.desktop-nav-item[data-desktop-tab="posts"]'),b=await center(p,'.desktop-nav-item[data-desktop-tab="profile"]');
  await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x,a.y+38);await frames(p);
  const pose=await p.locator('.desktop-nav-indicator').boundingBox();assert.ok(Math.abs(pose.y+pose.height/2-(a.y+38))<3,'capsule follows the pointer');
  assert.equal(await p.locator('.desktop-nav-item.is-active').getAttribute('data-desktop-tab'),'posts','drag preview does not navigate early');
  await p.mouse.move(b.x,b.y);await p.mouse.up();await active(p,'profile');
  await p.locator('.desktop-nav-item[data-desktop-tab="chat"]').click();await active(p,'chat');
  await wireAiChat(p);await p.waitForFunction(()=>document.querySelector('.desktop-nav-item[data-desktop-action="ai-chat"]').classList.contains('is-active'));
  const ai=await center(p,'.desktop-nav-item[data-desktop-action="ai-chat"]'),photos=await center(p,'.desktop-nav-item[data-desktop-tab="ai"]');
  await drag(p,ai,photos);await active(p,'ai');await p.waitForFunction(()=>!window.__xtjAiChatActive);
  assert.equal(await p.locator('.desktop-nav-item.is-active').getAttribute('data-desktop-tab'),'ai');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('cancelled sidebar gestures restore selection and never block keyboard or fresh pointer activation',{timeout:30000},async()=>{
 const f=await postBrowserFixture({viewport:{width:1280,height:900},counts:[1]}),p=f.page;
 try{
  const a=await center(p,'.desktop-nav-item[data-desktop-tab="posts"]');
  await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x,a.y+55);await frames(p);
  await p.evaluate(()=>dispatchEvent(new Event('blur')));await p.mouse.up();await frames(p);
  assert.equal(await p.locator('.desktop-nav-item.is-active').getAttribute('data-desktop-tab'),'posts');
  const chat=p.locator('.desktop-nav-item[data-desktop-tab="chat"]');await chat.focus();await p.keyboard.press('Enter');await active(p,'chat');
  await p.locator('.desktop-nav-item[data-desktop-tab="posts"]').click();await active(p,'posts');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('context details stay visible outside the glass composer and survive browser page restoration',{timeout:30000},async()=>{
 const {aiPolishFixture}=require('./helpers/ai-polish-fixture');const f=await aiPolishFixture({viewport:{width:390,height:844},ios:true}),p=f.page;
 try{
  const trigger=p.locator('.ai-context-trigger');await trigger.click();
  const popup=p.locator('.ai-context-popup');await popup.waitFor({state:'visible'});
  const bounds=await popup.boundingBox(),composer=await p.locator('#aiChatInputBar').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=composer.y,'context details fit above the composer');
  assert.equal(await popup.evaluate(n=>n.parentNode===document.body),true);
  await popup.locator('select').selectOption('32768');assert.equal(await trigger.getAttribute('aria-expanded'),'true','inside pointer events do not dismiss the portal');
  await popup.locator('.ai-context-close').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await p.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await trigger.click();await popup.waitFor({state:'visible'});await p.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await p.evaluate(()=>__xtjCloseAiChat());assert.equal(await p.locator('body > .ai-context-popup').count(),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('real browser touch events drag the iPad sidebar vertically and the network detents horizontally',{timeout:45000},async()=>{
 const f=await postBrowserFixture({viewport:{width:820,height:1180},ios:'ipad-desktop',counts:[1]}),p=f.page;
 try{
  const cdp=await p.context().newCDPSession(p);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  async function touch(type,point){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:point.x,y:point.y,radiusX:4,radiusY:4,force:1,id:1}]:[]});}
  const a=await center(p,'.desktop-nav-item[data-desktop-tab="posts"]'),b=await center(p,'.desktop-nav-item[data-desktop-tab="chat"]');
  await touch('touchStart',a);await touch('touchMove',{x:a.x,y:a.y+20});await frames(p);await touch('touchMove',b);await touch('touchEnd');await active(p,'chat');
  await wireAiChat(p);await p.locator('#aiPlusBtn').click();await p.locator('[data-network-mode="off"]').click();
  const from=await center(p,'[data-network-mode="off"]'),to=await center(p,'[data-network-mode="required"]');
  await touch('touchStart',from);await touch('touchMove',{x:(from.x+to.x)/2,y:from.y});await frames(p);await touch('touchMove',to);await touch('touchEnd');
  await p.waitForFunction(()=>document.querySelector('[data-network-mode="required"]').getAttribute('aria-checked')==='true');
  assert.deepEqual(f.errors,[]);await cdp.detach();
 }finally{await f.close();}
});

test('an initial resize observation cannot cancel an in-progress rail gesture, while a real resize does',{timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]}),p=f.page;
 try{
  await p.evaluate(()=>{const original=ResizeObserver;window.ResizeObserver=class{constructor(callback){window.selectionResize=callback;}observe(){}disconnect(){}};const rail=document.createElement('div');rail.id='resizeGestureRail';rail.style.cssText='position:fixed;top:100px;left:10px;width:300px;height:50px;display:flex;z-index:99999;background:white';rail.innerHTML='<span style="position:absolute;pointer-events:none"></span><button style="width:100px;height:50px">一</button><button style="width:100px;height:50px">二</button><button style="width:100px;height:50px">三</button>';document.body.append(rail);window.selectionChanges=[];window.selectionApi=xtjInstallSelectionRail({rail,indicator:rail.firstChild,buttons:'button',selected:()=>rail.querySelector('button'),select:button=>selectionChanges.push(button.textContent)});window.ResizeObserver=original;});
  await p.mouse.move(60,125);await p.mouse.down();await p.mouse.move(160,125);await p.evaluate(()=>selectionResize([{target:document.getElementById('resizeGestureRail')}]));await p.mouse.move(260,125);await p.mouse.up();assert.deepEqual(await p.evaluate(()=>selectionChanges),['三']);
  await p.mouse.move(60,125);await p.mouse.down();await p.mouse.move(160,125);await p.evaluate(()=>{const rail=document.getElementById('resizeGestureRail');rail.style.width='280px';selectionResize([{target:rail}]);});await p.mouse.up();assert.deepEqual(await p.evaluate(()=>selectionChanges),['三']);await p.evaluate(()=>selectionApi.dispose());assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
