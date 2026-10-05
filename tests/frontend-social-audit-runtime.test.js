'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/core-parts/01-bootstrap.js', 'utf8');
const postSource = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((r,j)=>{resolve=r;reject=j;}); return {promise,resolve,reject}; }
function authRuntime(overrides = {}) {
  const calls = [], failures = [];
  const ctx = { currentUser: 'A', _authStateEpoch: 1, navigator: {onLine:true}, Headers, FormData, Date, Error, console,
    getUserToken:()=> 'A_token', ensureUserToken:async()=> 'A_token',
    window:{ API_BASE:'',safeStorage:{get:()=>''},ensureProtectedOperationAuth:async()=>({ok:true,token:'A_token'}),refreshUserToken:async()=> 'renewed_A',handleProtectedAuthFailure:()=>failures.push(true),xtjFetch:async(url,opts)=>{calls.push({url,opts});return {status:200};} }};
  Object.assign(ctx.window, overrides);
  vm.runInNewContext(source.slice(source.indexOf('            function captureAuthRequestFence'),source.indexOf('            // P7: 头像缓存')),ctx);
  return {ctx,calls,failures,switch(owner){ctx.currentUser=owner;ctx._authStateEpoch++;}};
}
for (const name of ['xtjProtectedFetch','xtjOptionalAuthFetch']) {
  test(`${name} rejects delayed A request after A→B→A without refresh, retry or clearing new session`,async()=>{
    const network=deferred();let refreshes=0;const r=authRuntime({xtjFetch:()=>network.promise,refreshUserToken:async()=>{refreshes++;return 'new_A';}});
    const pending=r.ctx.window[name]('/api/post/create',{method:'POST',body:'A draft'});
    await new Promise(resolve=>setImmediate(resolve));r.switch('B');r.switch('A');network.resolve({status:401});
    await assert.rejects(pending,e=>e.code==='identity_changed');assert.equal(refreshes,0);assert.deepEqual(r.failures,[]);
  });
  test(`${name} fences refresh completion before replaying a write`,async()=>{
    const refresh=deferred();let sends=0;const r=authRuntime({xtjFetch:async()=>{sends++;return {status:401};},refreshUserToken:()=>refresh.promise});
    const pending=r.ctx.window[name]('/api/post/comment',{method:'POST',body:'comment_A'});
    await new Promise(resolve=>setImmediate(resolve));r.switch('B');refresh.resolve('B_token');
    await assert.rejects(pending,e=>e.code==='identity_changed');assert.equal(sends,1);assert.deepEqual(r.failures,[]);
  });
}
test('explicit owner/epoch rejects stale callers before authentication starts',async()=>{
  let auth=0;const r=authRuntime({ensureProtectedOperationAuth:async()=>{auth++;return {ok:true,token:'token'};}});
  await assert.rejects(r.ctx.window.xtjProtectedFetch('/write',{authOwner:'A',authEpoch:0}),e=>e.code==='identity_changed');assert.equal(auth,0);
});
test('Headers, lowercase authorization, FormData, abort signals and internal options preserve request semantics',async()=>{
  const r=authRuntime(),form=new FormData(),controller=new AbortController();form.append('file','original');
  await r.ctx.window.xtjProtectedFetch('/write',{method:'POST',body:form,headers:new Headers([['authorization','forged'],['x-test','yes']]),signal:controller.signal,authOwner:'A',authEpoch:1,background:true});
  const options=r.calls[0].opts;assert.equal(options.headers.get('Authorization'),'Bearer A_token');assert.equal(options.headers.get('x-test'),'yes');assert.equal(options.headers.has('Content-Type'),false);assert.equal(options.body,form);assert.equal(options.signal,controller.signal);assert.equal('authOwner' in options,false);assert.equal('authEpoch' in options,false);assert.equal('background' in options,false);
});
function publishRuntime({upload,createJson,snapshot,cleanupFailure}={}) {
  const events={},calls=[],storage=new Map(),resets=[],button={disabled:false,innerHTML:'send',textContent:'send',dataset:{},classList:{add(){},remove(){}},attrs:{},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;}};
  const elements={pubBtn:button,postInp:{value:'A draft'},fileInp:{files:upload?[{name:'a.jpg',type:'image/jpeg',size:12}]:[]},postVisibility:{value:'private'}};
  const ctx={currentUser:'A',_authStateEpoch:1,postLocationData:null,crypto:require('node:crypto').webcrypto,console,Error,JSON,Object,String,encodeURIComponent,document:{hidden:false,getElementById:id=>elements[id],addEventListener:(event,fn)=>events[event]=fn},window:{XtjPostMedia:require('../js/post-media'),safeStorage:{get:k=>storage.get(k),set:(k,v)=>storage.set(k,v)},addEventListener:(event,fn)=>events[event]=fn,xtjProtectedFetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:()=>url.endsWith('prepare')?Promise.resolve({ok:true,storage_path:'posts/a.jpg'}):url.endsWith('cleanup')?(cleanupFailure?Promise.reject(new Error('cleanup network')):Promise.resolve({ok:true})):createJson?(Array.isArray(createJson)?createJson.shift().promise:createJson.promise):Promise.resolve({ok:true,data:{id:'post-id',ip_region_text:'region',ip_region_status:'resolved',location_name:'loc'}})};},resetPostPreview:()=>resets.push('preview')},
  isUserMuted:()=>false,showToast:()=>{},buildStorageUploadPath:()=> 'posts/a.jpg',collectPostMetadata:visibility=>({visibility}),buildPostContentPayload:text=>text,deviceId:'device',normalizePost:x=>x,fetchPostSnapshot:()=>snapshot?snapshot.promise:Promise.resolve(null),touchUserSession(){},resetPostComposer:()=>resets.push('composer'),insertPublishedPostIntoFeed:()=>true,writeFeedCacheSnapshot(){},schedulePublishedPostIpRefresh(){},loadProfileActivity:()=>Promise.resolve(),sb:{storage:{from:()=>({upload:()=>upload.promise,getPublicUrl:()=>({data:{publicUrl:'https://storage/uploads/posts/a.jpg'}})})}}};
  const insert=postSource.slice(postSource.indexOf('            async function insertPostRecord('),postSource.indexOf('            function insertPublishedPostIntoFeed'));
  const publish=postSource.slice(postSource.indexOf('            var postPublishFlight'),postSource.indexOf('            loadFeed = async function',postSource.indexOf('            var postPublishFlight')));
  vm.runInNewContext(insert+publish,ctx);ctx.readPostImageDimensions=async()=>({width:1,height:1});return{ctx,calls,resets,button,elements,events,storage,switch(owner){ctx.currentUser=owner;ctx._authStateEpoch++;events['auth-ready']();}};
}
test('slow uploaded A media never creates a B post or resets B draft',async()=>{
  const upload=deferred(),r=publishRuntime({upload});const task=r.ctx.window.doPublish();await new Promise(resolve=>setImmediate(resolve));r.switch('B');r.elements.postInp.value='B draft';upload.resolve({});await task;
  assert.equal(r.calls.filter(x=>x.url==='/api/post/create').length,0);assert.equal(r.elements.postInp.value,'B draft');assert.deepEqual(r.resets,[]);assert.equal(r.button.disabled,false);
});
test('delayed create JSON cannot reset a switched identity and old finally cannot unlock the new flight',async()=>{
  const first=deferred(),second=deferred(),r=publishRuntime({createJson:[first,second]});const old=r.ctx.window.doPublish();await new Promise(resolve=>setImmediate(resolve));r.switch('B');r.elements.postInp.value='B draft';const fresh=r.ctx.window.doPublish();await new Promise(resolve=>setImmediate(resolve));
  first.resolve({ok:true,data:{id:'id',ip_region_text:'r',ip_region_status:'resolved',location_name:'l'}});await old;
  assert.equal(r.button.disabled,true,'A finally must not unlock B publish');assert.equal(r.elements.postInp.value,'B draft');assert.deepEqual(r.resets,[]);
  second.resolve({ok:true,data:{id:'id-b',ip_region_text:'r',ip_region_status:'resolved',location_name:'l'}});await fresh;
  assert.equal(r.calls.filter(x=>x.url==='/api/post/create').length,2);assert.deepEqual(r.resets,['composer','preview']);assert.equal(r.button.disabled,false);
});
test('create acknowledgement after A→B→A is dropped before cache and composer mutations',async()=>{
  const snapshot=deferred(),json=deferred(),r=publishRuntime({snapshot,createJson:json});const task=r.ctx.window.doPublish();await new Promise(resolve=>setImmediate(resolve));r.switch('B');r.switch('A');r.elements.postInp.value='new A draft';json.resolve({ok:true,data:{id:'id'}});await task;
  assert.deepEqual(r.resets,[]);assert.equal(r.elements.postInp.value,'new A draft');
});
test('failed media publish uses authenticated cleanup and retains retry metadata when cleanup fails',async()=>{
  const upload=deferred(),json=deferred(),r=publishRuntime({upload,createJson:json,cleanupFailure:true});const task=r.ctx.window.doPublish();upload.resolve({});await new Promise(resolve=>setImmediate(resolve));json.resolve({ok:false,error:'DB unavailable'});await task;
  assert.equal(r.calls.filter(x=>x.url==='/api/post/media/cleanup').length,1);assert.equal(r.calls.filter(x=>x.url==='/api/post/media/prepare').length,1);
  const rows=JSON.parse(r.storage.get('xtj_post_media_pending_A'));assert.equal(rows.length,1);assert.equal(rows[0].storage_path,'posts/a.jpg');assert.deepEqual(r.resets,[]);
});
test('actual protected-auth validation rejects epoch changes before handling expiration for the new session',async()=>{
  const token=deferred(),r=authRuntime();r.ctx.ensureUserToken=()=>token.promise;r.ctx._lastRefreshUser='';r.ctx._refreshCooldownUntil=0;r.ctx._lastRefreshAuthResult={reason:'expired'};r.ctx.handleProtectedAuthFailure=()=>r.failures.push(true);
  const start=source.indexOf('            window.ensureProtectedOperationAuth = async function'),end=source.indexOf('            window.ensureRealUserAuth',start);vm.runInNewContext(source.slice(start,end),r.ctx);
  const result=r.ctx.window.ensureProtectedOperationAuth();r.switch('B');r.switch('A');token.resolve('');assert.equal((await result).reason,'identity_changed');assert.deepEqual(r.failures,[]);
});

test('A→B→A does not clean abandoned A paths until the old in-flight upload has drained',async()=>{
  const upload=deferred(),r=publishRuntime({upload});const task=r.ctx.window.doPublish();await new Promise(resolve=>setImmediate(resolve));
  r.switch('B');r.switch('A');await new Promise(resolve=>setImmediate(resolve));assert.equal(r.calls.filter(c=>c.url==='/api/post/media/cleanup').length,0);
  upload.resolve({});await task;await new Promise(resolve=>setImmediate(resolve));assert.equal(r.calls.filter(c=>c.url==='/api/post/media/cleanup').length,1);assert.equal(r.calls.filter(c=>c.url==='/api/post/create').length,0);assert.deepEqual(JSON.parse(r.storage.get('xtj_post_media_pending_A')),[]);
});

 test('existing and newly resolved post IP displays omit cities',()=>{
 const ctx={window:{},escapeHtml:x=>x};
 const start=postSource.indexOf('            function buildPostLocationHtml('),end=postSource.indexOf('            window.buildPostLocationHtml =',start);
 vm.runInNewContext(postSource.slice(start,end),ctx);
 for(const post of [{ip_region_text:'浙江 舟山'},{ip_region_text:'浙江杭州'},{ip_province:'浙江省',ip_city:'湖州',ip_region_text:'浙江 湖州'},{_contentMeta:{ip_region_text:'广东 深圳'}},{ip_region_text:'广西壮族自治区 南宁'}]){
 const html=ctx.buildPostLocationHtml(post);assert.match(html,/IP属地：(浙江|广东|广西)<\/div>/);assert.doesNotMatch(html,/舟山|杭州|湖州|深圳|南宁/);
 }
 assert.match(ctx.buildPostLocationHtml({ip_region_text:'日本'}),/IP属地：日本/);
 });
