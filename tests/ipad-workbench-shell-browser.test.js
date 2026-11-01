'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');

test('the tablet workbench fills the window instead of floating inside a square frame',{timeout:60000},async()=>{
  for(const theme of ['light','dark']){
    const f=await postBrowserFixture({counts:[1],publicPosts:true,theme,ios:'ipad-desktop',viewport:{width:1288,height:770}});
    try{
      const box=await f.page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return{left:b.left,top:b.top,right:b.right,bottom:b.bottom};};
        return{sidebar:r('#desktopWorkbenchSidebar'),panels:r('#dockPanels'),padding:getComputedStyle(document.querySelector('.app-container')).padding,w:innerWidth,h:innerHeight};});
      assert.equal(box.padding,'0px',theme);
      assert.ok(box.sidebar.left<=1&&box.sidebar.top<=1,theme+' '+JSON.stringify(box.sidebar));
      assert.ok(box.panels.right>=box.w-1&&box.panels.bottom>=box.h-1,theme+' '+JSON.stringify(box.panels));
    }finally{await f.close();}
  }
});

// <nav> inherits the site-wide "nav { flex-wrap: wrap }". When the on-screen keyboard made the sidebar short,
// the five navigation items wrapped into extra columns and spilled over the workspace.
test('opening the iPad keyboard keeps the sidebar navigation in one column inside the sidebar',{timeout:60000},async()=>{
  const f=await postBrowserFixture({counts:[1],publicPosts:true,ios:'ipad-desktop',viewport:{width:1000,height:700}});
  try{
    await f.page.locator('#postInp').focus();
    await f.page.setViewportSize({width:1000,height:380});
    await f.page.evaluate(()=>{Object.assign(testKeyboardViewport,{height:380,offsetTop:0});testKeyboardViewport.dispatchEvent(new Event('resize'));});
    await f.page.waitForFunction(()=>document.documentElement.classList.contains('xtj-keyboard-open'));
    const layout=await f.page.evaluate(()=>{const side=document.getElementById('desktopWorkbenchSidebar').getBoundingClientRect();
      return{sideRight:side.right,items:Array.from(document.querySelectorAll('.desktop-nav-item')).map(e=>{const b=e.getBoundingClientRect();return{left:b.left,right:b.right};}),
        scrollable:getComputedStyle(document.getElementById('desktopWorkbenchSidebar')).overflowY};});
    assert.equal(layout.items.length,5);
    assert.equal(new Set(layout.items.map(i=>Math.round(i.left))).size,1,'all items share one column: '+JSON.stringify(layout.items));
    assert.ok(layout.items.every(i=>i.right<=layout.sideRight+1),'no item spills over the workspace');
    assert.equal(layout.scrollable,'auto','a short sidebar scrolls inside itself');
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
