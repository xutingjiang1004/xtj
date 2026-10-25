'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');

// These regressions exercise the rendered menu. The user replaced the old
// mandatory clip/sweep design, so literal keyframe names no longer define UX.
test('a throttled JavaScript animation frame cannot strand the menu in an invisible opening state',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.evaluate(()=>{window.savedMenuRAF=requestAnimationFrame;window.savedMenuCancel=cancelAnimationFrame;window.requestAnimationFrame=()=>123456;window.cancelAnimationFrame=()=>{};});
  await p.locator('#aiPlusBtn').click();
  assert.equal(await p.locator('#aiPlusPanelShell').evaluate(n=>n.classList.contains('open')&&!n.inert),true);
  await p.locator('[data-action="open-model"]').click();await p.locator('#aiSelectPopup').waitFor({state:'visible'});
  await p.locator('#aiSelectPopup .ai-select-pop-close').click();await p.locator('#aiSelectPopup').waitFor({state:'detached'});
  await p.locator('.ai-menu-close').click();assert.equal(await p.locator('#aiPlusBtn').getAttribute('aria-expanded'),'false');
  await p.evaluate(()=>{window.requestAnimationFrame=savedMenuRAF;window.cancelAnimationFrame=savedMenuCancel;});
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('reduced motion and the site motion preference remove menu motion while choices still work',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#aiPlusBtn').click();
  assert.equal(await p.locator('#aiPlusPanelShell').evaluate(n=>getComputedStyle(n).transitionDuration.split(',').every(s=>parseFloat(s)<=.01)),true);
  await p.locator('[data-action="open-think"]').click();await p.locator('#aiSelectPopup [data-value="medium"]').click();assert.equal(await p.locator('#aiThinkSummary').textContent(),'中度');
  await p.emulateMedia({reducedMotion:'no-preference'});await p.evaluate(()=>document.documentElement.setAttribute('data-xtj-motion','off'));
  await p.locator('[data-action="open-model"]').click();assert.equal(await p.locator('#aiSelectPopup').evaluate(n=>getComputedStyle(n).transitionDuration.split(',').every(s=>parseFloat(s)<=.01)),true);
  await p.keyboard.press('Escape');await p.locator('#aiSelectPopup').waitFor({state:'detached'});assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('closing AI during menu dismissal leaves one fresh actionable menu when reopened',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await p.locator('#aiPlusBtn').click();await p.locator('#aiPlusBtn').click();
  await p.evaluate(()=>__xtjCloseAiChat());await p.evaluate(()=>__xtjOpenAiChat());await p.waitForSelector('#aiChatMsgInput');
  assert.equal(await p.locator('#aiPlusPanelShell').count(),1);await p.locator('#aiPlusBtn').click();
  await p.locator('[data-action="open-think"]').click();await p.locator('#aiSelectPopup [data-value="high"]').click();
  assert.equal(await p.locator('#aiThinkSummary').textContent(),'深度');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
