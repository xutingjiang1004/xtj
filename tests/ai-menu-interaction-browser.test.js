'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
async function frames(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function opened(p){await p.locator('#aiPlusBtn').click();await p.waitForFunction(()=>document.getElementById('aiPlusPanelShell').classList.contains('open'));}
async function center(p,selector){const r=await p.locator(selector).boundingBox();return{x:r.x+r.width/2,y:r.y+r.height/2};}
async function finished(p,selector){await p.locator(selector).evaluate(n=>Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));}
test('plus menu reverses a closing transition, remains actionable and closes without a leftover input blocker',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await opened(p);await frames(p);await p.locator('#aiPlusBtn').click();await frames(p);await p.locator('#aiPlusBtn').click();
  await finished(p,'#aiPlusPanelShell');assert.equal(await p.locator('#aiPlusPanelShell').evaluate(n=>getComputedStyle(n).clipPath),'none');
  await p.locator('[data-action="open-model"]').click();await p.locator('#aiSelectPopup').waitFor({state:'visible'});
  await p.locator('#aiSelectPopup .ai-select-pop-close').click();await p.locator('#aiSelectPopup').waitFor({state:'detached'});
  await p.locator('.ai-menu-close').click();await p.locator('#aiChatMsgInput').fill('关闭菜单后的草稿');
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'关闭菜单后的草稿');assert.equal(await p.locator('#aiPlusBtn').getAttribute('aria-expanded'),'false');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
for(const theme of ['light','dark'])test(theme+' model and effort lists fit above the composer, keep a readable hierarchy and apply the real selection',{timeout:30000},async()=>{
 const f=await aiPolishFixture({theme,viewport:{width:390,height:844}}),p=f.page;
 try{
  await opened(p);await p.locator('[data-action="open-think"]').click();await finished(p,'#aiSelectPopup');
  const bounds=await p.locator('#aiSelectPopup').boundingBox(),composer=await p.locator('#aiChatInputBar').boundingBox();
  assert.ok(bounds.y>=0&&bounds.y+bounds.height<=composer.y,'choices remain in the available conversation region');
  const rows=p.locator('#aiSelectPopup [role="option"]');assert.equal(await rows.count(),5);
  assert.equal(await rows.first().locator('.ai-select-option-description').count(),1);
  assert.equal(await rows.locator('.ai-select-option-icon').count(),0);
  const color=await p.locator('.ai-select-pop-heading').evaluate(n=>getComputedStyle(n).color);if(theme==='dark')assert.notEqual(color,'rgb(34, 49, 48)');
  await p.locator('#aiSelectPopup [data-value="low"]').click();assert.equal(await p.locator('#aiThinkSummary').textContent(),'轻度');
  await p.locator('#aiSelectPopup').waitFor({state:'detached'});
  await p.locator('[data-action="open-model"]').click();assert.equal(await p.locator('#aiSelectPopup .ai-select-option-icon').count(),0);await p.locator('#aiSelectPopup [data-value="deepseek-v4-pro"]').click();
  await p.locator('#aiSelectPopup').waitFor({state:'detached'});await p.locator('.ai-menu-close').click();
  await p.locator('#aiChatMsgInput').fill('核对实际选择');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const body=await p.evaluate(()=>aiPolish.streams[0].body);assert.equal(body.thinking_mode,'low');assert.equal(body.model,'deepseek-v4-pro');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('visible network detents follow horizontal dragging and send the chosen mode instead of cycling implicitly',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;
 try{
  await opened(p);const off=p.locator('[data-network-mode="off"]');await off.click();
  const a=await center(p,'[data-network-mode="off"]'),b=await center(p,'[data-network-mode="required"]');
  await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:7});await frames(p);
  assert.equal(await off.getAttribute('aria-checked'),'true','preview does not change the request before release');
  await p.mouse.up();await p.waitForFunction(()=>document.querySelector('[data-network-mode="required"]').getAttribute('aria-checked')==='true');
  await p.locator('[data-network-mode="auto"]').focus();await p.keyboard.press('Home');assert.equal(await off.getAttribute('aria-checked'),'true');
  await p.keyboard.press('End');assert.equal(await p.locator('[data-network-mode="required"]').getAttribute('aria-checked'),'true');
  await p.locator('.ai-menu-close').click();await p.locator('#aiChatMsgInput').fill('查询后核对');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const body=await p.evaluate(()=>aiPolish.streams[0].body);assert.equal(body.network_mode,'required');assert.equal(body.web_search,true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('enabling search capability keeps a fresh conversation automatic rather than forcing every turn to pre-search',{timeout:30000},async()=>{
 const f=await aiPolishFixture({config:{allow_web_search:true}}),p=f.page;
 try{
  await opened(p);assert.equal(await p.locator('[data-network-mode="auto"]').getAttribute('aria-checked'),'true');await p.locator('.ai-menu-close').click();
  await p.locator('#aiChatMsgInput').fill('你好');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const body=await p.evaluate(()=>aiPolish.streams[0].body);assert.equal(body.network_mode,'auto');assert.equal(body.web_search,false);assert.equal(body.thinking_mode,'max');
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('quota-exhausted network detents keep the safe choices available and never claim that required search was selected',{timeout:30000},async()=>{
 const f=await aiPolishFixture({quota:{can_search:false,search_used:10,search_remaining:0}}),p=f.page;
 try{
  await opened(p);const required=p.locator('[data-network-mode="required"]');assert.equal(await required.getAttribute('aria-disabled'),'true');
  await p.locator('[data-network-mode="off"]').click();
  const a=await center(p,'[data-network-mode="off"]'),b=await center(p,'[data-network-mode="required"]');
  await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:6});await p.mouse.up();assert.equal(await required.getAttribute('aria-checked'),'false');
  await p.locator('[data-network-mode="off"]').click();assert.equal(await p.locator('[data-network-mode="off"]').getAttribute('aria-checked'),'true');
  await p.locator('[data-network-mode="auto"]').click();assert.equal(await p.locator('[data-network-mode="auto"]').getAttribute('aria-checked'),'true');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
