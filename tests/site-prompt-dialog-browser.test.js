'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

test('xtjPrompt is a named dialog and keeps Tab / Shift+Tab inside it',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true});
  try{
    const p=f.page;
    await p.evaluate(()=>{window.__promptResult='pending';xtjPrompt('备注名','给这位好友起个名字','abc',20).then(v=>{window.__promptResult=v;});});
    await p.waitForSelector('.xtj-prompt-dialog input');await p.waitForFunction(()=>document.activeElement&&document.activeElement.tagName==='INPUT');
    const name=await p.evaluate(()=>{const d=document.querySelector('.xtj-prompt-dialog'),h=document.getElementById(d.getAttribute('aria-labelledby')||'_');return h&&h.textContent;});
    assert.equal(name,'备注名','the dialog must be labelled by its heading');
    const inside=()=>p.evaluate(()=>!!document.activeElement.closest('.xtj-prompt-overlay'));
    for(let i=0;i<7;i++){await p.keyboard.press('Tab');assert.equal(await inside(),true,'Tab '+(i+1)+' left the dialog');}
    for(let i=0;i<7;i++){await p.keyboard.press('Shift+Tab');assert.equal(await inside(),true,'Shift+Tab '+(i+1)+' left the dialog');}
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(()=>window.__promptResult),null);
  }finally{await f.close();}
});
