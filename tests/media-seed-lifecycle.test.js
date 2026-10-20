'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const {matches}=require('../media-digest');
const file=new Blob(['test-only-image-bytes'],{type:'image/png'}),path='/api/photo/11111111-1111-4111-8111-111111111111/media';
function fixture(){
  const handlers={},timers=new Map(),requests=[],saved=new Map();let timerId=0;
  const cache={keys:async()=>Array.from(saved.keys()),match:async key=>saved.get(key.url||key),put:async(key,value)=>saved.set(key.url,value),delete:async key=>saved.delete(key.url||key)};
  const context={self:{location:{origin:'https://xtj.test'},addEventListener:(type,fn)=>handlers[type]=fn},importScripts(){},Request,Response,Headers,Blob,URL,AbortController,Date,Promise,XtjMediaDigest:{matches},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),caches:{open:async()=>cache,delete:async()=>{saved.clear();return true}},
    fetch:request=>{requests.push(request);if(requests.length===1)return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
      return Promise.resolve(new Response(null,{headers:{ETag:'"'+crypto.createHash('md5').update('test-only-image-bytes').digest('hex')+'"','Content-Length':String(file.size),'Content-Type':'image/png'}}));}};
  vm.runInNewContext(fs.readFileSync('media-originals-sw.js','utf8'),context);
  function message(data){let work;const replies=[];handlers.message({source:{url:'https://xtj.test/'},data,ports:[{postMessage:r=>replies.push(r)}],waitUntil:p=>work=p});return{replies,done:()=>work}}
  return{timers,requests,saved,message,seed:()=>message({type:'XTJ_SEED_ORIGINAL_MEDIA',url:path,blob:file})};
}
const flush=()=>new Promise(setImmediate);
test('a cache seed HEAD has a deadline and a stalled first request cannot permanently block following uploads',async()=>{
  const f=fixture(),first=f.seed();await flush();assert.equal(f.requests.length,1);
  assert.equal(f.timers.size,1,'the worker must bound its own validation request, not only the page message wait');
  const timer=Array.from(f.timers.values())[0];assert.ok(timer.ms>0&&timer.ms<=30000);timer.fn();
  await first.done();assert.equal(first.replies[0].ok,false);assert.equal(f.requests[0].signal.aborted,true);
  const next=f.seed();await next.done();assert.equal(next.replies[0].ok,true);assert.equal(f.saved.size,1);assert.equal(f.timers.size,0);
});
test('logout clears and aborts an in-flight seed so a new account is not stuck behind the old HEAD',async()=>{
  const f=fixture(),first=f.seed();await flush();
  const clear=f.message({type:'XTJ_CLEAR_ORIGINAL_MEDIA'});await clear.done();
  assert.equal(f.requests[0].signal.aborted,true,'clearing private files also cancels their pending validation');
  await first.done();assert.equal(first.replies[0].ok,false);
  const next=f.seed();await next.done();assert.equal(next.replies[0].ok,true);assert.equal(f.requests.length,2);
});
