'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

// Product decision: every site dialog sits on one scrim (light 40%, dark 62%, no blur). Older id+class rules used to win for these.
const IDS=['delModal','ppConfirmOverlay','statModal','loginModal','registerModal','postDetailModal','profileActivityModal','profileDetailModal','userProfileModal'];
async function scrims(page){
  return page.evaluate(async ids=>{
    const out={};
    for(const id of ids){
      const el=document.getElementById(id);if(!el){out[id]=null;continue;}
      el.style.transition='none';el.classList.add('active');
      const cs=getComputedStyle(el);out[id]={bg:cs.backgroundColor,blur:cs.backdropFilter};
      el.classList.remove('active');el.style.transition='';
    }
    return out;
  },IDS);
}
for(const [theme,expected] of [['light','rgba(10, 25, 18, 0.4)'],['dark','rgba(0, 0, 0, 0.62)']]){
  test(`every site dialog uses the one ${theme} scrim without blur`,{timeout:60000},async()=>{
    const f=await postBrowserFixture({counts:[1],publicPosts:true});
    try{
      await f.page.evaluate(t=>{document.documentElement.setAttribute('data-theme',t);},theme);
      const result=await scrims(f.page);
      for(const id of IDS){
        if(!result[id])continue;
        assert.equal(result[id].bg,expected,`${id} scrim in ${theme} mode`);
        assert.equal(result[id].blur,'none',`${id} must not blur the page behind it`);
      }
      assert.ok(result.ppConfirmOverlay&&result.delModal,'confirm and delete dialogs exist on the page');
    }finally{await f.close();}
  });
}
