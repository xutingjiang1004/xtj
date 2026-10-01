'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express'),request=require('supertest');
const {createPersonalExport,safeRecord}=require('../render-api/personal-export');
const {createVoiceModelAssets,assetFor,MODEL,REVISION}=require('../render-api/voice-model-assets');
const {recordAccountAuthentication,authenticationEvents}=require('../render-api/account-events');
function db(rows){
 let fail=false;const calls=[];
 return {calls,setFail(){fail=true;},from(table){const conditions=[],ordering=[];let count=201;
 const q={select(){return q;},eq(k,v){conditions.push(r=>r[k]===v);calls.push([table,k,v]);return q;},in(k,v){conditions.push(r=>v.includes(r[k]));return q;},or(){return q;},lte(k,v){conditions.push(r=>r[k]<=v);return q;},gt(k,v){conditions.push(r=>typeof r[k]==='number'?r[k]>Number(v):r[k]>v);return q;},order(k){ordering.push(k);return q;},limit(n){count=n;return q;},then(resolve){let data=(rows[table]||[]).filter(r=>conditions.every(f=>f(r)));data.sort((a,b)=>a[ordering[0]]>b[ordering[0]]?1:-1);return Promise.resolve({data:data.slice(0,count),error:fail?{code:'timeout'}:null}).then(resolve);}};return q;},async rpc(_,args){calls.push(args);return {data:[],error:fail?{}:null};}};
}
function auth(req,res,next){if(!req.headers['x-user'])return res.status(401).end();req.userName=req.headers['x-user'];next();}
test('personal export paginates all records, scopes every page to its authenticated actor and excludes credentials',async()=>{
 const rows=Array.from({length:451},(_,i)=>({id:i+1,user_name:i%2?'B':'A',post_id:'photo',created_at:'2020-01-01',content:'正文'}));const store=db({comments:rows});const app=express();app.use('/export',createPersonalExport({express,supabase:store,authenticateUser:auth}));
 assert.equal((await request(app).get('/export?kind=comments')).status,401);
 let cursor='',all=[];
 do{const r=await request(app).get('/export?kind=comments&user_name=B'+(cursor?'&after='+cursor:'')).set('x-user','A');assert.equal(r.status,200);all.push(...r.body.items);cursor=r.body.next_cursor||'';}while(cursor);
 assert.equal(all.length,226);assert.equal(new Set(all.map(r=>r.id)).size,226);assert.ok(all.every(r=>r.user_name==='A'));
 assert.equal((await request(app).get('/export?kind=__auth__').set('x-user','A')).status,400);
 const safe=safeRecord({actor_key:'secret',content:JSON.stringify({text:'正文',api_key:'secret',encrypted_key:'secret',models:[{name:'tiny',password:'secret'}]})});assert.deepEqual(safe,{content:{text:'正文',models:[{name:'tiny'}]}});
 store.setFail();assert.equal((await request(app).get('/export?kind=comments').set('x-user','A')).status,503);
});
test('chat export passes only token actor into visibility-filtered service RPC',async()=>{
 const store=db({});const app=express();app.use('/export',createPersonalExport({express,supabase:store,authenticateUser:auth}));await request(app).get('/export?kind=messages&user_name=B').set('x-user','A');assert.equal(store.calls[0].p_actor,'A');assert.equal(store.calls[0].p_kind,'messages');
});
test('authentication audit uses request IP and server method, fails if no event was committed, and excludes visits from login counts',async()=>{
 let args;const common={supabase:{async rpc(name,value){args=value;return {data:{event_id:'event',login_at:'now',registered_at:'before'}};}},req:{headers:{'user-agent':'Safari'},body:{ip:'6.6.6.6'}},userName:'A',source:'login_success',getClientIp(req){req._clientIpSource='express_req_ip';return '8.8.8.8';},detectDeviceTypeFromUA:()=> 'tablet',detectOSFromUA:()=> 'iOS',detectBrowserFromUA:()=> 'Safari'};
 await recordAccountAuthentication(common);assert.equal(args.p_user_name,'A');assert.equal(args.p_event.ip,'8.8.8.8');assert.equal(args.p_event.ip_source,'express_req_ip');assert.equal(args.p_event.user_agent,'Safari');
 await assert.rejects(()=>recordAccountAuthentication({...common,supabase:{async rpc(){return {error:{code:'timeout'}};}}}),/auth_event_store_failed/);
 assert.equal(authenticationEvents([{source:'page_visit'},{authority:'client_telemetry',reported_source:'login_success'},{source:'admin_login'},{authority:'server_authentication'}]).length,2);
});
test('immutable model gateway rejects arbitrary paths, coalesces downloads, never caches errors, and repairs damaged cached files',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtj-asr-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let calls=0,unavailable=false;
 const app=express();app.use('/model',createVoiceModelAssets({express,cacheDir:dir,fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return unavailable?new Response('error',{status:503}):new Response('{"model_type":"whisper"}');}}));
 const url='/model/'+MODEL+'/resolve/'+REVISION+'/config.json';
 await Promise.all([request(app).get(url).expect(200),request(app).get(url).expect(200)]);assert.equal(calls,1);await request(app).get('/model/runtime/not-allowed.wasm').expect(404);assert.equal(calls,1);
 fs.writeFileSync(path.join(dir,'model-config.json'),'damaged');await request(app).get(url).expect(200);assert.equal(calls,2);
 fs.rmSync(path.join(dir,'model-config.json'));unavailable=true;await request(app).get(url).expect(503);unavailable=false;await request(app).get(url).expect(200);assert.equal(calls,4);
 assert.equal(assetFor(MODEL+'/resolve/main/config.json'),null);assert.equal(assetFor('https://localhost/admin'),null);
});
test('model gateway refuses corrupt weight or wasm bytes and does not install a verified cache entry',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtj-asr-bad-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const app=express();app.use('/model',createVoiceModelAssets({express,cacheDir:dir,fetchImpl:async()=>new Response('bad bytes')}));
 await request(app).get('/model/runtime/ort-wasm-simd-threaded.jsep.wasm').expect(503);assert.deepEqual(fs.readdirSync(dir),[]);
 await request(app).get('/model/'+MODEL+'/resolve/'+REVISION+'/onnx/encoder_model_quantized.onnx').expect(503);assert.deepEqual(fs.readdirSync(dir),[]);
});
test('Render and Cloudflare proxy chain resolves the client and cannot accept spoofed left-hand IPs',async()=>{
 const {isCloudflareProxy}=require('../render-api/trusted-proxies');
 assert.equal(isCloudflareProxy('172.71.151.223'),true);assert.equal(isCloudflareProxy('2606:4700::1'),true);assert.equal(isCloudflareProxy('8.8.8.8'),false);
 const app=express();app.set('trust proxy',ip=>isCloudflareProxy(ip)||ip==='::ffff:127.0.0.1'||ip==='127.0.0.1'||ip==='::1'||ip.startsWith('10.'));
 app.get('/',(req,res)=>res.json({ip:req.ip}));
 const valid=await request(app).get('/').set('X-Forwarded-For','6.6.6.6, 8.8.8.8, 172.71.151.223, 10.196.83.173').set('CF-Connecting-IP','6.6.6.6');assert.equal(valid.body.ip,'8.8.8.8');
 const arbitrary=await request(app).get('/').set('X-Forwarded-For','6.6.6.6, 8.8.8.8').set('CF-Connecting-IP','6.6.6.6');assert.equal(arbitrary.body.ip,'8.8.8.8');
 const ipv6=await request(app).get('/').set('X-Forwarded-For','2001:4860:4860::8888, 2606:4700::1, 10.1.1.1');assert.equal(ipv6.body.ip,'2001:4860:4860::8888');
});
