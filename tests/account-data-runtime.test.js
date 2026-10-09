'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express'),request=require('supertest');
const {createPersonalExport,safeRecord}=require('../render-api/personal-export');
const {createVoiceModelAssets,assetFor,MODEL,REVISION}=require('../render-api/voice-model-assets');
const {recordAccountAuthentication,authenticationEvents}=require('../render-api/account-events');
const mediaSessionFixture={setPhotoSession:require('../render-api/photo-access').setPhotoSession,verifyUserAccessToken:()=>({exp:Date.now()+900000}),verifyUserRefreshToken:()=>({jti:'11111111-1111-4111-8111-111111111111'})};
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
test('post export includes every album attachment, including secondary originals',async()=>{
 const id='11111111-1111-4111-8111-111111111111',urls=[0,1,2].map(i=>'https://xtj.test/storage/v1/object/public/uploads/posts/'+i+'.png');
 const store=db({posts:[{id,user_name:'A',created_at:'2020-01-01',media_type:'image',media_url:urls[0]}],post_attachments:urls.map((media_url,position)=>({id:String(position),post_id:id,media_type:'image',media_url,position}))});const app=express();app.use('/export',createPersonalExport({express,supabase:store,authenticateUser:auth}));
 const r=await request(app).get('/export?kind=posts').set('x-user','A').expect(200);assert.deepEqual(r.body.items[0].media_items.map(x=>x.media_url),urls);
});
test('personal export retains protected photo originals in its portable attachment manifest',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../js/ux-features'),'utf8');
 const id='11111111-1111-4111-8111-111111111111',photo=require('../render-api/photo-access').photoPayload({id,user_name:'A',media_type:'__photo_wall__',media_url:'https://example.supabase.co/storage/v1/object/public/uploads/photos/original.jpg',content:'{"storagePath":"photos/original.jpg"}'});
 let downloaded;class ExportURL extends URL {static createObjectURL(blob){downloaded=blob;return'blob:export';}static revokeObjectURL(){}}
 const button={disabled:false},link={click(){},remove(){}};
 const context=vm.createContext({URL:ExportURL,Blob,Set,Date,setTimeout:fn=>fn(),document:{getElementById:()=>button,createElement:()=>link,body:{appendChild(){}}},window:{currentUser:'A',location:{origin:'https://xtj.test'},showToast(text){assert.doesNotMatch(text,/失败|停止/);},async xtjProtectedFetch(path){const kind=new URL(path,'https://xtj.test').searchParams.get('kind');return{ok:true,json:async()=>({ok:true,items:kind==='photos'?[photo]:[],account:kind==='profile'?{settings:{signature:'my signature',cover_url:'https://xtj.test/cover.png',background_url:'https://xtj.test/background.png'}}:null,snapshot:'2026-10-07',has_more:false})};}}});
 vm.runInContext(source.slice(source.indexOf('  async function exportMyData()'),source.indexOf('  function injectProfileSettings()')),context);
 await context.exportMyData();const output=JSON.parse(await downloaded.text());
 assert.equal(output.counts.photos,1);assert.equal(output.attachments.length,3);
 assert.equal(output.account.settings.signature,'my signature');assert.deepEqual(output.attachments.slice(1).map(x=>x.url),['https://xtj.test/cover.png','https://xtj.test/background.png']);
 assert.equal(output.attachments[0].url,'https://xtj.test/api/photo/'+id+'/media');
 assert.equal(output.data.photos[0].media_url,output.attachments[0].url);
 assert.doesNotMatch(JSON.stringify(output),/storagePath|storage\/v1/);
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

test('retired client telemetry authenticates then returns 410 without database or fingerprint work',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8'),app=express();app.use(express.json());
 const begin=source.indexOf("app.post('/api/log-login-event'"),end=source.indexOf('// ===================== 登录事件查询（管理员）',begin);
 const blocked=new Proxy({}, {get(){throw Error('retired path accessed database');}});
 vm.runInNewContext(source.slice(begin,end),{app,authenticateUser:auth,rateLimit(){return(req,res,next)=>next();},supabase:blocked,getClientIp(){throw Error('retired IP lookup');}});
 await request(app).post('/api/log-login-event').send({device_meta:{password:'secret'}}).expect(401);
 const r=await request(app).post('/api/log-login-event').set('x-user','A').send({browser_fingerprint_hash:'hash',device_meta:{clipboard:'private'}}).expect(410);assert.equal(r.body.code,'client_telemetry_retired');assert.equal(r.headers['cache-control'],'no-store');
 const settings=await request(app).get('/api/security-settings').expect(200);assert(Object.values(settings.body.settings).every(v=>v===false));
});
test('strict personal export fails on a private attachment signing failure while conversation hydration stays available',async()=>{
 const {createDmPrivateStorage}=require('../render-api/dm-private-storage');let fail=true;
 const storage=createDmPrivateStorage({storage:{from(){return{async createSignedUrl(){return fail?{error:{message:'offline'}}:{data:{signedUrl:'https://example.com/signed'}};}};}}});
 const row={id:'message',content:'saved',payload:{media:{bucket:'dm-private',storage_path:'chat/abcdef123456_private_12345_voice.webm',url:'expired'}}};
 const store={async rpc(){return{data:[structuredClone(row)]};}};const app=express();app.use('/export',createPersonalExport({express,supabase:store,authenticateUser:auth,privateStorage:storage}));
 const broken=await request(app).get('/export?kind=messages').set('x-user','A').expect(503);assert.equal(broken.body.code,'export_unavailable');assert.equal(broken.body.items,undefined);
 const conversation=structuredClone(row);await storage.hydrateMessage(conversation);assert.equal(conversation.payload.media.unavailable,true);assert.equal(conversation.payload.media.url,'');
 fail=false;const ok=await request(app).get('/export?kind=messages').set('x-user','A').expect(200);assert.equal(ok.body.items[0].payload.media.url,'https://example.com/signed');
});

test('password and registration routes schedule basic safety checks after committed authentication without blocking login',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8'),app=express();app.use(express.json());
 const events=[],alerts=[],geoWrites=[];let auditUnavailable=false,releaseGeo;
 let geo=new Promise(resolve=>{releaseGeo=resolve;});
 const store={async rpc(name,args){if(name==='record_auth_ip_location'){geoWrites.push(args);return{data:{ok:true,current_updated:true}};}assert.equal(name,'record_user_auth_event');events.push(args);return auditUnavailable?{error:{message:'unavailable'}}:{data:{event_id:'recorded',login_at:'2026-10-02T00:00:00Z',registered_at:'2026-10-01T00:00:00Z'}};},from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:null};},async insert(){return{error:null};}};}};
 const context=vm.createContext({app,supabase:store,ADMIN_USERNAME:'xxz',require(name){if(name==='./account-events')return require('../render-api/account-events');return require(name);},securityRateLimit(){return(req,res,next)=>next();},validateString(v){return typeof v==='string'?v:null;},MAX_USERNAME_LEN:20,AUTH_MARKER:'__auth__',AUTH_VERIFIER_PREFIX:'scrypt:',ADMIN_USERNAME:'xxz',crypto:{randomUUID:()=> 'account-A'},async readAuthRecord(){return{id:'account-A',media_url:'scrypt:valid'};},async readAccountIdentity(){return{id:'account-A',created_at:'2020-01-01T00:00:00Z'};},async verifyAuthPassword(_,password){return password==='realpass';},async deriveAuthVerifier(){return'scrypt:valid';},async loadUserRestrictions(){return{};},_getDeviceIdFromRequest(){return'basic-session-device';},isValidEmailAddress(){return true;},...mediaSessionFixture,async readAccountIdentity(){return{id:'account-A',created_at:'2020-01-01T00:00:00Z'};},signUserAccessToken(){return'access';},signUserRefreshToken(){return'refresh';},async storeRefreshToken(){return true;},USER_REFRESH_TOKEN_EXPIRY_MS:1000,getClientIp(req){req._clientIpSource='express_req_ip';return'8.8.8.8';},detectDeviceTypeFromUA(){return'phone';},detectOSFromUA(){return'iOS';},detectBrowserFromUA(){return'Safari';},resolveIpLocation(){return geo;},async runSecurityChecks(...args){alerts.push(args);},console});
 const begin=source.indexOf('async function issueUserSession('),end=source.indexOf('// 限制状态只通过服务端',begin);vm.runInContext(source.slice(begin,end),context);
 await request(app).post('/api/user/login').send({user_name:'Alice',password:'wrong',browser_fingerprint_hash:'private'}).expect(401);assert.equal(events.length,0);assert.equal(alerts.length,0);
 const login=await request(app).post('/api/user/login').set('User-Agent','Safari').send({user_name:'Alice',password:'realpass',ip:'6.6.6.6',browser_fingerprint_hash:'private',canvas_fingerprint_hash:'private'}).expect(200);
 assert.equal(login.body.authenticated_at,'2026-10-02T00:00:00Z');assert.ok(login.headers['set-cookie'].some(c=>c.startsWith('xtj_photo_session=')&&c.includes('HttpOnly')&&c.includes('Path=/api/photo')));assert.ok(login.headers['set-cookie'].some(c=>c.startsWith('xtj_post_media_session=')&&c.includes('HttpOnly')&&c.includes('Path=/api/post')));assert.equal(events.length,1);assert.equal(alerts.length,0);assert.equal(events[0].p_event.ip,'8.8.8.8');assert.doesNotMatch(JSON.stringify(events),/realpass|private|6\.6\.6\.6/);
 releaseGeo({text:'安全事件IP大致地区'});await new Promise(resolve=>setImmediate(resolve));assert.equal(alerts.length,1);assert.deepEqual(alerts[0].slice(0,3),['Alice','basic-session-device','8.8.8.8']);assert.equal(alerts[0][4],'login_success');assert.equal(alerts[0][5],login.body.authenticated_at);assert.equal(alerts[0][6],null);assert.equal(alerts[0][7],null);assert.equal(geoWrites.length,1);assert.equal(geoWrites[0].p_event_id,'recorded');assert.equal(geoWrites[0].p_ip,'8.8.8.8');
 geo=Promise.reject(Error('IP lookup unavailable'));geo.catch(()=>{});await request(app).post('/api/user/register').send({user_name:'Newbie',password:'realpass'}).expect(201);await new Promise(resolve=>setImmediate(resolve));assert.equal(alerts.length,2);assert.equal(alerts[1][4],'register_success');assert.equal(alerts[1][3],null);
 // Refresh/session reuse has no opts.audit; it cannot create authentication or alerts.
 await context.issueUserSession({cookie(){}},'Alice','basic-session-device');assert.equal(events.length,2);assert.equal(alerts.length,2);
 auditUnavailable=true;await request(app).post('/api/user/login').send({user_name:'Alice',password:'realpass'}).expect(503);await new Promise(resolve=>setImmediate(resolve));assert.equal(alerts.length,2);
});

test('administrator settings cannot re-enable retired precision collectors, while safety alerts remain configurable',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8'),app=express();app.use(express.json());
 let saved={record_device:true,browser_fingerprint:true,canvas_fingerprint:true,webgl_fingerprint:true,webrtc_local_ip:true,advanced_fingerprint:true,security_alerts:true};let fail=false;
 const store={from(){let update;const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:{id:'settings',content:JSON.stringify(saved)}};},update(row){update=JSON.parse(row.content);return q;},then(resolve){if(!fail)saved=update;return Promise.resolve({error:fail?{code:'offline'}:null}).then(resolve);}};return q;}};
 const begin=source.indexOf("app.get('/admin/security-settings'"),end=source.indexOf('// ===================== 日志清理',begin);
 vm.runInNewContext(source.slice(begin,end),{app,supabase:store,verifyToken:auth,rateLimit(){return(req,res,next)=>next();},ADMIN_META_MARKER:'__admin_meta__',ADMIN_USERNAME:'xxz',async logAdminAudit(){},console});
 const current=await request(app).get('/admin/security-settings').set('x-user','xxz').expect(200);assert.equal(current.body.settings.security_alerts,true);for(const [key,value]of Object.entries(current.body.settings))if(key!=='security_alerts')assert.equal(value,false,key);
 const changed=await request(app).post('/admin/security-settings').set('x-user','xxz').send({...saved,security_alerts:false}).expect(200);assert.equal(changed.body.settings.security_alerts,false);for(const [key,value]of Object.entries(saved))assert.equal(value,false,key);
 fail=true;await request(app).post('/admin/security-settings').set('x-user','xxz').send({security_alerts:true}).expect(500);assert.equal(saved.security_alerts,false);
});

test('late authentication geolocation updates its confirmed event but cannot replace a newer login IP region',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8');const events=new Map(),geo=new Map(),releases=new Map();let current={},sequence=0;const alerts=[];
 for(const ip of ['8.8.8.8','1.1.1.1'])geo.set(ip,new Promise(resolve=>releases.set(ip,resolve)));
 const store={async rpc(name,args){
  if(name==='record_user_auth_event'){
   const id='event_'+(++sequence),loginAt='2026-10-02T00:00:0'+sequence+'Z';events.set(id,{...args.p_event,user_name:args.p_user_name,authority:'server_authentication',login_at:loginAt});current={last_auth_event_id:id,last_login:loginAt,last_ip:args.p_event.ip,last_ip_location:null};return{data:{event_id:id,login_at:loginAt}};
  }
  assert.equal(name,'record_auth_ip_location');const event=events.get(args.p_event_id);
  if(!event||event.authority!=='server_authentication'||event.ip!==args.p_ip)return{data:{ok:false,code:'event_mismatch'}};
  event.ip_location=args.p_location;const isCurrent=current.last_auth_event_id===args.p_event_id&&current.last_login===event.login_at&&current.last_ip===args.p_ip;
  if(isCurrent)current.last_ip_location=args.p_location;
  return{data:{ok:true,event_updated:true,current_updated:isCurrent}};
 }};
 const context=vm.createContext({supabase:store,ADMIN_USERNAME:'xxz',require(name){if(name==='./account-events')return require('../render-api/account-events');return require(name);},...mediaSessionFixture,async readAccountIdentity(){return{id:'account-A',created_at:'2020-01-01T00:00:00Z'};},signUserAccessToken(){return'access';},signUserRefreshToken(){return'refresh';},async storeRefreshToken(){return true;},USER_REFRESH_TOKEN_EXPIRY_MS:1000,getClientIp(req){return req.ip;},detectDeviceTypeFromUA(){return'phone';},detectOSFromUA(){return'OS';},detectBrowserFromUA(){return'browser';},resolveIpLocation(ip){return geo.get(ip);},async runSecurityChecks(...args){alerts.push(args);},console});
 const begin=source.indexOf('async function issueUserSession('),end=source.indexOf('// 用户登录/获取 token',begin);vm.runInContext(source.slice(begin,end),context);
 for(const ip of ['8.8.8.8','1.1.1.1'])await context.issueUserSession({cookie(){}},'Alice','device',{audit:{req:{ip,headers:{'user-agent':'Safari'},body:{ip:'spoof',ip_location:'spoof'}},source:'login_success'}});
 assert.equal(current.last_ip,'1.1.1.1');assert.equal(current.last_ip_location,null);
 releases.get('1.1.1.1')({text:'新登录地区',country:'new'});await new Promise(resolve=>setImmediate(resolve));assert.equal(current.last_ip_location.text,'新登录地区');
 releases.get('8.8.8.8')({text:'旧登录地区',country:'old'});await new Promise(resolve=>setImmediate(resolve));assert.equal(current.last_ip_location.text,'新登录地区');assert.equal(current.last_login,'2026-10-02T00:00:02Z');assert.equal(events.get('event_1').ip_location.text,'旧登录地区');assert.equal(events.get('event_2').ip_location.text,'新登录地区');assert.equal(alerts.length,2);
 const {recordAuthenticationIpLocation}=require('../render-api/account-events');
 await assert.rejects(recordAuthenticationIpLocation({supabase:store,eventId:'event_1',ip:'1.1.1.1',location:{text:'伪造地区'}}),/auth_ip_location_store_failed/);assert.equal(current.last_ip_location.text,'新登录地区');
 assert.equal(await recordAuthenticationIpLocation({supabase:store,eventId:'event_1',ip:'unknown',location:{text:'地区'}}),false);
 assert.equal(await recordAuthenticationIpLocation({supabase:store,eventId:'event_1',ip:'8.8.8.8',location:null}),false);
});
