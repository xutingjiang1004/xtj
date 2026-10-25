'use strict';
// Optional capture hook: the tests retain their assertions and lifecycle. Each
// page is captured immediately before teardown, tagged with its owning test.
const output=process.env.XTJ_FEATURE_SCREENSHOTS;
if(output){
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{AsyncLocalStorage}=require('node:async_hooks'),{createHash}=require('node:crypto');
 const scope=new AsyncLocalStorage(),wrappedTests=new WeakMap(),types=new WeakSet(),pages=new WeakSet(),captured=new WeakSet();let serial=0;
 fs.mkdirSync(output,{recursive:true});
 function testWrapper(fn){
  if(wrappedTests.has(fn))return wrappedTests.get(fn);
  const proxy=new Proxy(fn,{apply(target,receiver,args){
   const callback=args.at(-1);if(typeof callback==='function'){
    const original=callback,fallback=typeof args[0]==='string'?args[0]:'browser scenario';
    const run=function(...values){const name=values[0]?.fullName||values[0]?.name||fallback;return scope.run({name},()=>original.apply(this,values));};Object.defineProperty(run,'length',{value:original.length});args=[...args.slice(0,-1),run];
   }
   return Reflect.apply(target,receiver,args);
  },get(target,key){const value=Reflect.get(target,key);return ['test','it','describe','only','skip','todo'].includes(key)&&typeof value==='function'?testWrapper(value):value;}});
  wrappedTests.set(fn,proxy);return proxy;
 }
 function track(page,owner){
  if(pages.has(page))return;pages.add(page);const original=page.close;
  page.close=async function(...args){await capture(page,owner);return original.apply(this,args);};
 }
 async function capture(page,owner){
  if(captured.has(page)||page.isClosed())return;captured.add(page);
  const name=owner?.name||'browser scenario',id=++serial,hash=createHash('sha256').update(name).digest('hex').slice(0,10),filename=hash+'-'+process.pid+'-'+id+'.png';
  const record={test:name,file:filename,viewport:page.viewportSize(),url:page.url().split('?')[0],ok:false};
  try{await page.screenshot({path:path.join(output,filename),fullPage:false,animations:'disabled',timeout:10000});record.ok=true;}
  catch(error){record.error=String(error.message).slice(0,300);}
  fs.appendFileSync(path.join(output,'manifest.jsonl'),JSON.stringify(record)+'\n');
 }
 function instrument(api){
  for(const name of ['chromium','webkit','firefox']){
   const type=api[name];if(!type||types.has(type))continue;types.add(type);const launch=type.launch;
   type.launch=async function(...args){
    const owner=scope.getStore(),browser=await launch.apply(this,args),newPage=browser.newPage,newContext=browser.newContext,close=browser.close;
    browser.newPage=async function(...values){const page=await newPage.apply(this,values);track(page,scope.getStore()||owner);return page;};
    browser.newContext=async function(...values){const context=await newContext.apply(this,values),current=scope.getStore()||owner;context.on('page',page=>track(page,current));return context;};
    browser.close=async function(...values){for(const context of browser.contexts())for(const page of context.pages())await capture(page,owner);return close.apply(this,values);};
    return browser;
   };
  }
 }
 const load=Module._load;
 Module._load=function(name,...args){const value=load.call(this,name,...args);if(name==='node:test')return testWrapper(value);if(name==='playwright'||name==='playwright-core')instrument(value);return value;};
}
