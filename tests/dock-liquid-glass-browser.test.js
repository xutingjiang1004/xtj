'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
const artifacts=process.env.XTJ_DOCK_SCREENSHOTS||path.resolve('../scratch/xtj-dock-liquid');
const selector=tab=>'#dockBar .dock-tab[data-tab="'+tab+'"]';
async function settled(p){await p.waitForFunction(()=>!document.querySelector('#dockIndicator.is-moving')&&document.getElementById('dockIndicator').style.opacity==='1');}
async function fixture(t,options={}){
 const f=await postBrowserFixture({counts:[3],publicPosts:true,...options});t.after(()=>f.close());
 const p=f.page;
 await p.evaluate(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,value:8});
  Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:8});
  window.dispatchEvent(new Event('resize'));
  window.dockCalls=[];const original=window.switchDockTab;
  window.switchDockTab=function(tab,skip,options){dockCalls.push({tab,skip,source:options?.source});return original(tab,skip,options);};
 });
 await p.waitForFunction(()=>document.documentElement.classList.contains('perf-full'));
 await p.waitForFunction(()=>/perf-hz-/.test(document.documentElement.className));
 if(await p.locator('#dockBar').isVisible())await settled(p);
 return f;
}
async function center(p,tab){const r=await p.locator(selector(tab)).boundingBox();return{x:r.x+r.width/2,y:r.y+r.height/2};}
async function aligned(p){
 const d=await p.evaluate(()=>{
  const glass=dockIndicator.getBoundingClientRect(),tab=document.querySelector('#dockBar .active').getBoundingClientRect(),matrix=new DOMMatrix(getComputedStyle(dockIndicator).transform);
  return{dx:Math.abs(glass.x-tab.x),dy:Math.abs(glass.y-tab.y),dw:Math.abs(glass.width-tab.width),dh:Math.abs(glass.height-tab.height),sx:matrix.a,sy:matrix.d};
 });
 for(const key of ['dx','dy','dw','dh'])assert.ok(d[key]<.65,key+': '+JSON.stringify(d));
 assert.equal(d.sx,1);assert.equal(d.sy,1);
}
async function snapshot(p,name){fs.mkdirSync(artifacts,{recursive:true});await p.screenshot({path:path.join(artifacts,name+'.png')});}

for(const theme of ['light','dark'])test(theme+': selected glass stays elliptical and the entire outer Dock remains transparent and click-through',{timeout:30000},async t=>{
 const f=await fixture(t,{theme}),p=f.page;
 const material=await p.evaluate(()=>{
  const s=getComputedStyle(dockIndicator),outer=getComputedStyle(dockBar);
  return{radius:s.borderRadius,clip:s.clipPath,outerBackground:outer.backgroundColor,outerFilter:outer.backdropFilter,outerPointer:outer.pointerEvents,glassPointer:s.pointerEvents,filter:s.backdropFilter};
 });
 assert.equal(material.radius,'50%');assert.equal(material.clip,'none');assert.equal(material.outerBackground,'rgba(0, 0, 0, 0)');assert.equal(material.outerFilter,'none');assert.equal(material.outerPointer,'none');assert.equal(material.glassPointer,'none');
 assert.match(material.filter,/xtj-liquid-refract/);
 await aligned(p);await snapshot(p,'after-'+theme);
 await p.evaluate(()=>{
  const target=document.createElement('button');target.id='underDock';target.textContent='下面的真实控件';
  Object.assign(target.style,{position:'fixed',inset:'auto auto 0 0',width:'390px',height:'110px',zIndex:String(Number(getComputedStyle(dockBar).zIndex)-1)});
  target.addEventListener('click',()=>target.dataset.clicked='yes');document.body.append(target);
 });
 const r=await p.locator('#dockBar').boundingBox();await p.mouse.click(2,r.y+15);
 assert.equal(await p.locator('#underDock').getAttribute('data-clicked'),'yes');assert.deepEqual(f.errors,[]);
});

test('all five existing entries retain SVGs, icon animations, AI overlay, photo-wall ai mapping and chat badge',{timeout:40000},async t=>{
 const f=await fixture(t),p=f.page;
 await wireAiChat(p);await p.evaluate(()=>__xtjCloseAiChat());
 const original=await p.locator('#dockBar .dt-svg').evaluateAll(nodes=>nodes.map(n=>n.outerHTML));
 assert.deepEqual(await p.locator('#dockBar .dock-tab').evaluateAll(nodes=>nodes.map(n=>n.dataset.tab)),['posts','chat','ai-chat','ai','profile']);
 for(const [tab,animation]of [['chat','anim-chat'],['ai-chat','anim-brain'],['ai','anim-ai'],['profile','anim-profile'],['posts','anim-post']]){
  await p.locator(selector(tab)).click();await p.waitForFunction(([tab,animation])=>document.querySelector('#dockBar [data-tab="'+tab+'"]').classList.contains(animation),[tab,animation]);
  assert.equal(await p.locator('#dockBar .dock-tab.active').getAttribute('data-tab'),tab);
  if(tab==='ai-chat')assert.equal(await p.locator('#panelAiChat').isVisible(),true);
  else assert.equal(await p.locator('#panel'+tab[0].toUpperCase()+tab.slice(1)).isVisible(),true);
 }
 assert.deepEqual(await p.locator('#dockBar .dt-svg').evaluateAll(nodes=>nodes.map(n=>n.outerHTML)),original);
 assert.equal(await p.locator('#navChatBadge').count(),1);assert.equal(await p.locator(selector('ai')+' .dt-svg').count(),1);assert.deepEqual(f.errors,[]);
});

test('drag stretches and tracks the touch highlight, reads no layout during moves, snaps once and permits an immediate intentional tap',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,a=await center(p,'posts'),b=await center(p,'profile');
 await p.mouse.move(a.x,a.y);await p.mouse.down();
 await p.evaluate(()=>{window.dockReads=0;window.originalDockRect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(this.id==='dockBar'||this.classList.contains('dock-tab'))dockReads++;return originalDockRect.call(this);};});
 await p.mouse.move(a.x+65,a.y-4,{steps:5});await p.waitForFunction(()=>dockBar.classList.contains('is-dragging'));
 await p.mouse.move(b.x-30,b.y,{steps:8});
 const state=await p.evaluate(()=>({stretch:new DOMMatrix(getComputedStyle(dockIndicator).transform).a,light:dockIndicator.style.getPropertyValue('--dock-light-x'),reads:dockReads}));
 assert.ok(state.stretch>1.001);assert.notEqual(state.light,'50.0%');assert.equal(state.reads,0);
 await snapshot(p,'dragging-light');
 await p.waitForFunction(({x,y})=>{
  const r=dockIndicator.getBoundingClientRect(),expected=Math.max(6,Math.min(94,(x-r.x)/r.width*100));
  return Math.abs(parseFloat(dockIndicator.style.getPropertyValue('--dock-light-x'))-expected)<1.5;
 },{x:b.x-30,y:b.y});
 await p.mouse.move(b.x,b.y,{steps:3});await p.mouse.up();await settled(p);
 await p.evaluate(()=>Element.prototype.getBoundingClientRect=originalDockRect);
 assert.deepEqual(await p.evaluate(()=>dockCalls.map(c=>[c.tab,c.source])),[['profile','dock-drag']]);await aligned(p);
 await p.evaluate(()=>{window.idleChanges=0;const observer=new MutationObserver(items=>idleChanges+=items.length);observer.observe(dockIndicator,{attributes:true,attributeFilter:['style']});});
 await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>idleChanges),0);
 await p.locator(selector('chat')).click();assert.equal(await p.locator('#dockBar .active').getAttribute('data-tab'),'chat');assert.equal(await p.evaluate(()=>dockCalls.length),2);assert.deepEqual(f.errors,[]);
});

test('a three-pixel tap still clicks normally; cancellation and another pointer never navigate',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,b=await center(p,'chat');await p.mouse.move(b.x,b.y);await p.mouse.down();await p.mouse.move(b.x+3,b.y+1);await p.mouse.up();await settled(p);
 assert.deepEqual(await p.evaluate(()=>dockCalls.map(c=>c.source)),['dock-click']);
 await p.evaluate(()=>{const b=document.querySelector('#dockBar .active'),r=b.getBoundingClientRect(),props={bubbles:true,pointerId:51,isPrimary:true,pointerType:'touch',button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2};b.dispatchEvent(new PointerEvent('pointerdown',props));b.dispatchEvent(new PointerEvent('pointermove',{...props,clientX:props.clientX+90}));b.dispatchEvent(new PointerEvent('pointerup',{...props,pointerId:52}));b.dispatchEvent(new PointerEvent('pointercancel',props));});
 await settled(p);assert.equal(await p.evaluate(()=>dockCalls.length),1);await aligned(p);assert.deepEqual(f.errors,[]);
});

test('release uses its final coordinates even before a queued animation frame, with no synthetic click replay',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page;
 await p.evaluate(()=>{const b=document.querySelector('#dockBar .active'),a=b.getBoundingClientRect(),end=document.querySelector('#dockBar [data-tab="profile"]').getBoundingClientRect(),props={bubbles:true,pointerId:71,isPrimary:true,pointerType:'touch',button:0,clientX:a.x+a.width/2,clientY:a.y+a.height/2};b.dispatchEvent(new PointerEvent('pointerdown',props));b.dispatchEvent(new PointerEvent('pointerup',{...props,clientX:end.x+end.width/2,clientY:end.y+end.height/2}));b.dispatchEvent(new PointerEvent('click',{...props,detail:1}));});
 await settled(p);assert.deepEqual(await p.evaluate(()=>dockCalls.map(c=>c.tab)),['profile']);await aligned(p);assert.deepEqual(f.errors,[]);
});

test('iPhone Safari fallback handles a real touch gesture and keeps native-like lens geometry without SVG filtering',{timeout:30000},async t=>{
 const f=await fixture(t,{ios:true}),p=f.page,cdp=await p.context().newCDPSession(p),a=await center(p,'posts'),b=await center(p,'profile');
 assert.equal(await p.locator('#dockBar').getAttribute('data-dock-refraction'),'false');assert.match(await p.locator('#dockIndicator').evaluate(n=>getComputedStyle(n).backdropFilter),/blur\(1\.5px\)/);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settled(p);
 assert.equal(await p.locator('#dockBar .active').getAttribute('data-tab'),'profile');await aligned(p);assert.deepEqual(f.errors,[]);
});

test('rotation cancels a gesture, recenters the existing selection and ignores its late release',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,a=await center(p,'posts');await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x+90,a.y,{steps:5});
 await p.setViewportSize({width:844,height:390});await p.waitForFunction(()=>!dockBar.classList.contains('is-dragging'));await p.mouse.up();await settled(p);
 assert.equal(await p.locator('#dockBar .active').getAttribute('data-tab'),'posts');assert.equal(await p.evaluate(()=>dockCalls.length),0);await aligned(p);await snapshot(p,'landscape-light');
 await p.setViewportSize({width:320,height:740});await settled(p);await aligned(p);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(f.errors,[]);
});

test('dragging from an inactive entry follows the finger and selects the real photo-wall ai entry',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,a=await center(p,'chat'),b=await center(p,'ai');
 await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:9});await p.mouse.up();await settled(p);
 assert.deepEqual(await p.evaluate(()=>dockCalls.map(c=>[c.tab,c.source])),[['ai','dock-drag']]);await aligned(p);assert.equal(await p.locator('#panelAi').isVisible(),true);assert.deepEqual(f.errors,[]);
});

test('page suspension cleans up a held touch, performs no background writes and resumes on the same entry',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,a=await center(p,'profile');await p.mouse.move(a.x,a.y);await p.mouse.down();
 await p.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.hiddenWrites=0;new MutationObserver(items=>hiddenWrites+=items.length).observe(dockIndicator,{attributes:true,attributeFilter:['style']});});
 await p.mouse.move(a.x-150,a.y,{steps:3});await p.mouse.up();await p.waitForTimeout(100);
 assert.equal(await p.evaluate(()=>hiddenWrites),0);assert.equal(await p.evaluate(()=>dockCalls.length),0);
 await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await settled(p);await aligned(p);assert.deepEqual(f.errors,[]);
});

test('Reduced Motion, Reduced Transparency and low-performance fallbacks retain selection and stop idle rendering',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,cdp=await p.context().newCDPSession(p);
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
 await p.waitForFunction(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches);await p.locator(selector('profile')).click();await settled(p);await aligned(p);
 assert.equal(await p.locator('#dockIndicator').evaluate(n=>getComputedStyle(n).backdropFilter),'none');assert.equal(await p.locator('#dockBar').getAttribute('data-dock-refraction'),'false');
 assert.equal(await p.locator('#dockIndicator').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(237, 247, 242)');
 await snapshot(p,'reduced-transparency');
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});
 await p.evaluate(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,value:2});window.dispatchEvent(new Event('resize'));});
 await p.waitForFunction(()=>document.documentElement.classList.contains('perf-lite'));await settled(p);
 assert.equal(await p.locator('#dockIndicator').evaluate(n=>getComputedStyle(n).backdropFilter),'none');
 await p.evaluate(()=>{window.glassMutations=0;window.glassObserver=new MutationObserver(list=>glassMutations+=list.length);glassObserver.observe(dockIndicator,{attributes:true,attributeFilter:['style']});});
 await p.waitForTimeout(180);assert.equal(await p.evaluate(()=>glassMutations),0);assert.deepEqual(f.errors,[]);
});

test('iPad and wide desktop preserve the existing sidebar, Dock visibility and five-entry navigation state',{timeout:30000},async t=>{
 const f=await fixture(t,{viewport:{width:820,height:1180},ios:'ipad-desktop'}),p=f.page;
 assert.equal(await p.locator('#dockBar').isVisible(),false);
 await p.locator('[data-desktop-tab="profile"]').click();assert.equal(await p.locator('#panelProfile').isVisible(),true);await snapshot(p,'ipad-sidebar-light');
 await p.setViewportSize({width:1440,height:1000});assert.equal(await p.locator('#dockBar').isVisible(),false);assert.equal(await p.locator('#dockBar .dock-tab').count(),5);assert.deepEqual(f.errors,[]);
});

test('the static lens actually bends background detail near its edge while leaving the center clear',{timeout:30000},async t=>{
 const f=await fixture(t),p=f.page,sharp=require('sharp');
 await p.evaluate(()=>{
  const probe=document.createElement('div');
  Object.assign(probe.style,{position:'fixed',bottom:'0',left:'0',width:'100%',height:'110px',zIndex:String(Number(getComputedStyle(dockBar).zIndex)-1),pointerEvents:'none',color:'#162c25',font:'12px/16px sans-serif',background:'repeating-linear-gradient(90deg,#fff 0 5px,#b5cbbf 5px 6px)'});
  probe.textContent='背景文字 Liquid Glass 0123456789 · '.repeat(25);document.body.append(probe);
 });
 await p.waitForTimeout(90);
 const r=await p.locator('#dockIndicator').boundingBox(),clip={x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width)+1,height:Math.ceil(r.height)+1};
 const refracted=await p.screenshot({clip});await snapshot(p,'edge-refraction-light');
 await p.evaluate(()=>{dockIndicator.style.setProperty('backdrop-filter','blur(.35px) saturate(135%) brightness(1.015)','important');});
 await p.waitForTimeout(90);const flat=await p.screenshot({clip});
 const a=await sharp(refracted).removeAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(flat).removeAlpha().raw().toBuffer();
 let edge=0,center=0,edges=0,centers=0;
 for(let y=0;y<a.info.height;y++)for(let x=0;x<a.info.width;x++){
  const nx=(x+clip.x-r.x+.5)/r.width*2-1,ny=(y+clip.y-r.y+.5)/r.height*2-1,radius=Math.hypot(nx,ny),i=(y*a.info.width+x)*3;
  const difference=(Math.abs(a.data[i]-b[i])+Math.abs(a.data[i+1]-b[i+1])+Math.abs(a.data[i+2]-b[i+2]))/3;
  if(radius>.6&&radius<.92){edge+=difference;edges++;}else if(radius<.27){center+=difference;centers++;}
 }
 const edgeMean=edge/edges,centerMean=center/centers;
 assert.ok(edgeMean>3&&edgeMean>centerMean+2,JSON.stringify({edgeMean,centerMean}));assert.deepEqual(f.errors,[]);
});
