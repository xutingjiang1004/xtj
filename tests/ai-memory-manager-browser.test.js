'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');
const {DEFAULTS}=require('../render-api/profile-settings');
async function fixture(initial={}){
  const f=await postBrowserFixture({counts:[1]}),page=f.page;
  const settings={...DEFAULTS},patches=[],calls=[];
  const memories=initial.items||[{id:'11111111-1111-1111-1111-111111111111',content:'用户喜欢被叫小徐',kind:'preference',updated_at:'2026-10-31T10:00:00Z'},{id:'22222222-2222-2222-2222-222222222222',content:'用户是后端工程师',kind:'fact',updated_at:'2026-10-30T10:00:00Z'}];
  await page.route('**/api/profile/settings**',async route=>{const r=route.request();if(r.method()==='PATCH'){const p=r.postDataJSON();patches.push(p);if(initial.failPatch)return route.fulfill({status:503,json:{ok:false,error:'设置未保存，请重试'}});Object.assign(settings,p);}await route.fulfill({json:{ok:true,settings}});});
  await page.route('**/api/user/ai-memory**',async route=>{
    const r=route.request(),url=new URL(r.url()),method=r.method();calls.push({method,path:url.pathname,body:r.postData()?r.postDataJSON():null});
    if(initial.failList&&method==='GET')return route.fulfill({status:503,json:{ok:false,error:'记忆暂时无法读取，请稍后重试'}});
    if(method==='GET')return route.fulfill({json:{ok:true,enabled:settings.ai_memory_enabled!==false,limit:50,items:memories.map(x=>({...x}))}});
    if(method==='POST'){const b=r.postDataJSON();if(/密码/.test(b.content))return route.fulfill({status:400,json:{ok:false,error:'内容疑似包含密码，出于安全不保存。'}});memories.unshift({id:'33333333-3333-3333-3333-333333333333',content:b.content,kind:'fact',updated_at:new Date().toISOString()});return route.fulfill({json:{ok:true,item:{content:b.content,kind:'fact'}}});}
    if(method==='DELETE'){if(url.pathname.endsWith('/ai-memory')||url.pathname.endsWith('/ai-memory/')){memories.length=0;}else{const id=url.pathname.split('/').pop();const i=memories.findIndex(x=>x.id===id);if(i>=0)memories.splice(i,1);}return route.fulfill({json:{ok:true}});}
    route.fulfill({status:405,json:{ok:false}});
  });
  await page.evaluate(()=>{switchDockTab('profile',true);return __xtjReloadProfileSettings();});
  await page.waitForSelector('#xtjAiMemoryBtn');
  return {f,page,patches,calls,memories,settings};
}
test('the profile page has an AI memory row that lists memories, deletes one on a second tap, adds, and clears with a site dialog',{timeout:60000},async()=>{
  const {f,page,calls,memories}=await fixture();
  try{
    assert.match(await page.locator('.profile-setting-item:has(#xtjAiMemoryBtn) .profile-setting-text').textContent(),/AI 记忆/);
    await page.locator('#xtjAiMemoryBtn').click();await page.waitForSelector('.xtj-memory-dialog .xtj-memory-item');
    assert.equal(await page.locator('.xtj-memory-item').count(),2);assert.match(await page.locator('.xtj-memory-count').textContent(),/2 \/ 50/);
    assert.match(await page.locator('.xtj-memory-list').textContent(),/小徐/);
    const shapes=await page.evaluate(()=>['.xtj-memory-del','.xtj-memory-add button','.xtj-memory-close','.xtj-memory-clear'].map(sel=>{const c=getComputedStyle(document.querySelector(sel));return [sel,c.borderTopLeftRadius,c.boxShadow,c.backgroundImage];}));
    for(const [sel,radius,shadow,image] of shapes){assert.ok(parseFloat(radius)<=14,sel+' radius '+radius);assert.equal(shadow,'none',sel+' shadow');assert.equal(image,'none',sel+' image');}
    // first tap only arms the button, second tap deletes
    const del=page.locator('.xtj-memory-item').first().locator('.xtj-memory-del');await del.click();assert.equal(await del.textContent(),'确认删除');
    assert.equal(calls.filter(c=>c.method==='DELETE').length,0);await del.click();
    await page.waitForFunction(()=>document.querySelectorAll('.xtj-memory-item').length===1);
    assert.ok(calls.some(c=>c.method==='DELETE'&&c.path.endsWith('/11111111-1111-1111-1111-111111111111')));
    // add, including a refused one
    await page.locator('.xtj-memory-add input').fill('我的密码是 abc123');await page.locator('.xtj-memory-add button').click();
    await page.waitForFunction(()=>/不保存/.test(document.body.innerText));assert.equal(await page.locator('.xtj-memory-item').count(),1);
    await page.locator('.xtj-memory-add input').fill('用户喜欢简短的回答');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelectorAll('.xtj-memory-item').length===2);assert.match(await page.locator('.xtj-memory-list').textContent(),/简短的回答/);
    // clear everything through the in-site confirm dialog, not a native one
    page.once('dialog',()=>{throw new Error('native dialog used');});
    await page.locator('.xtj-memory-clear').click();await page.waitForSelector('#ppConfirmOverlay.active .pp-confirm-dialog');
    // the confirm dialog must sit above the memory dialog, otherwise it could not be clicked
    assert.equal(await page.evaluate(()=>{const o=document.querySelector('#ppConfirmOverlay'),m=document.querySelector('.xtj-memory-overlay');return Number(getComputedStyle(o).zIndex)>Number(getComputedStyle(m).zIndex);}),true);
    await page.locator('#ppConfirmOkBtn').click();
    await page.waitForFunction(()=>!document.querySelector('.xtj-memory-item')&&/还没有记忆/.test(document.body.innerText));
    assert.ok(calls.some(c=>c.method==='DELETE'&&c.body&&c.body.confirm===true));assert.equal(memories.length,0);
    // Esc closes and focus returns to the row button
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.xtj-memory-overlay'));
    assert.equal(await page.evaluate(()=>document.activeElement&&document.activeElement.id),'xtjAiMemoryBtn');
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('the use-memory switch is stored as an account setting and rolls back when saving fails',{timeout:60000},async()=>{
  const ok=await fixture();
  try{
    await ok.page.locator('#xtjAiMemoryBtn').click();await ok.page.waitForSelector('#xtjMemoryToggle');
    assert.equal(await ok.page.locator('#xtjMemoryToggle').getAttribute('aria-checked'),'true');
    await ok.page.locator('#xtjMemoryToggle').click();await ok.page.waitForFunction(()=>document.querySelector('#xtjMemoryToggle').getAttribute('aria-checked')==='false'&&!document.querySelector('#xtjMemoryToggle').disabled);
    assert.deepEqual(ok.patches.at(-1),{ai_memory_enabled:false});assert.equal(await ok.page.locator('#xtjMemoryToggle').getAttribute('role'),'switch');
    assert.deepEqual(ok.f.errors,[]);
  }finally{await ok.f.close();}
  const bad=await fixture({failPatch:true});
  try{
    await bad.page.locator('#xtjAiMemoryBtn').click();await bad.page.waitForSelector('#xtjMemoryToggle');
    await bad.page.locator('#xtjMemoryToggle').click();await bad.page.waitForFunction(()=>/未保存/.test(document.body.innerText));
    await bad.page.waitForFunction(()=>document.querySelector('#xtjMemoryToggle').getAttribute('aria-checked')==='true');
  }finally{await bad.f.close();}
});
test('a failed read shows a retry, and an empty list explains how memories are made',{timeout:60000},async()=>{
  const failed=await fixture({failList:true});
  try{
    await failed.page.locator('#xtjAiMemoryBtn').click();await failed.page.waitForSelector('.xtj-memory-retry');
    assert.match(await failed.page.locator('.xtj-memory-empty').textContent(),/暂时无法读取/);
  }finally{await failed.f.close();}
  const empty=await fixture({items:[]});
  try{
    await empty.page.locator('#xtjAiMemoryBtn').click();await empty.page.waitForSelector('.xtj-memory-empty');
    assert.match(await empty.page.locator('.xtj-memory-body').textContent(),/记住/);assert.equal(await empty.page.locator('.xtj-memory-clear').isHidden(),true);
  }finally{await empty.f.close();}
});
