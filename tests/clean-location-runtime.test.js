'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {recordLocationFix,createLocationHistory}=require('../render-api/location-history');
const {browserContext,createBrowserContext}=require('../render-api/browser-context');
test('GPS record binds the authenticated actor and account; duplicate retries do not overwrite evidence',async()=>{
 const writes=[];let stored;const db={from(table){if(table==='posts')return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{id:'account-A'}};}};return{async upsert(row,options){writes.push({row,options});stored={...row,received_at:new Date().toISOString(),resolution_status:'pending'};return{error:null};},select(){return this;},eq(){return this;},async maybeSingle(){return{data:stored};}};}};
 await recordLocationFix({supabase:db,actor:'A',body:{user_name:'B',latitude:26,longitude:119,accuracy:0,captured_at:new Date().toISOString(),capture_id:'post_one'},reason:'post_location',ip:'1.2.3.4'});
 assert.equal(writes[0].row.user_name,'A');assert.equal(writes[0].row.account_id,'account-A');assert.equal(writes[0].row.accuracy_m,0);assert.equal(writes[0].options.ignoreDuplicates,true);assert.equal(writes[0].row.capture_reason,'post_location');
 await assert.rejects(recordLocationFix({supabase:db,actor:'A',body:{latitude:200,longitude:119},reason:'post_location'}));assert.equal(writes.length,1);
});
test('location history requires admin credentials or reads only the current actor, and rejects invalid cursors',async()=>{
 const calls=[];const db={from(){const q={select(){return q;},eq(k,v){calls.push([k,v]);return q;},or(){return q;},order(){return q;},limit(n){calls.push(['limit',n]);return q;},then(resolve){return Promise.resolve({data:Array.from({length:51},(_,i)=>({id:'123e4567-e89b-42d3-a456-'+String(i).padStart(12,'0'),received_at:'2026-10-01T00:00:00Z',latitude:26,longitude:119}))}).then(resolve);}};return q;}};
 const app=express();app.use(createLocationHistory({express,supabase:db,verifyToken(req,res,next){if(req.get('Authorization')==='admin')next();else res.sendStatus(403);},authenticateUser(req,res,next){if(req.get('Authorization')==='A'){req.userName='A';next();}else res.sendStatus(401);}}));
 await request(app).get('/admin/user-location-history?user_name=B').set('Authorization','A').expect(403);
 const r=await request(app).get('/api/user/location-history?user_name=B').set('Authorization','A').expect(200);assert.equal(r.body.items.length,50);assert.equal(r.body.has_more,true);assert.ok(calls.some(c=>c[0]==='user_name'&&c[1]==='A'));assert.deepEqual(calls.at(-1),['limit',51]);
 const admin=await request(app).get('/admin/user-location-history?user_name=B').set('Authorization','admin').expect(200);assert.equal(admin.body.items.length,50);assert.equal(admin.body.has_more,false);assert.equal(admin.body.next_cursor,null);assert.deepEqual(calls.at(-1),['limit',50]);
 await request(app).get('/api/user/location-history?cursor=forged').set('Authorization','A').expect(400);
});
test('browser context saves only bounded supported facts and does not claim unavailable Safari network data',async()=>{
 const clean=browserContext({language:'zh-CN',timezone:'Asia/Shanghai',languages:['zh-CN','<script>'],network:{supported:false},password:'secret',user_name:'B'});
 assert.equal(clean.timezone,'Asia/Shanghai');assert.deepEqual(clean.network,{supported:false});assert.deepEqual(clean.languages,['zh-CN']);assert.equal(clean.password,undefined);
 const invalid=browserContext({timezone:'invalid',network:{supported:true,downlink_mbps:-1,rtt_ms:Infinity,effective_type:'fake'}});assert.equal(invalid.timezone,null);assert.equal(invalid.network.downlink_mbps,null);assert.equal(invalid.network.effective_type,null);
 const calls=[];let failed=false;const app=express();app.use(express.json());app.use(createBrowserContext({express,supabase:{async rpc(name,params){calls.push({name,params});return failed?{error:{code:'timeout'}}:{data:true};}},authenticateUser(req,res,next){req.userName='A';next();},rateLimit(){return(req,res,next)=>next();}}));
 await request(app).post('/api/user/browser-context').send({user_name:'B',language:'zh-CN',timezone:'Asia/Shanghai'}).expect(200);assert.equal(calls[0].params.p_actor,'A');assert.equal(calls[0].params.p_context.user_name,undefined);failed=true;await request(app).post('/api/user/browser-context').send({}).expect(503);
});
test('late GPS resolution updates only its own capture and cannot overwrite a newer fix on the same page',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require.resolve('../render-api/server'),'utf8');
 const begin=source.indexOf('async function mergeResolvedPreciseLocation(');
 const end=source.indexOf("app.post('/api/user/location'",begin);
 const writes=[],merges=[];let fail=false;
 const latest={last_precise_location:{page_load_id:'page_same',capture_id:'new'},precise_location_history:[{page_load_id:'page_same',capture_id:'new'}]};
 const db={from(table){if(table==='user_location_history'){const write={};const q={update(p){write.patch=p;return q;},eq(k,v){write[k]=v;return q;},then(resolve){writes.push(write);return Promise.resolve({error:fail?new Error('unavailable'):null}).then(resolve);}};return q;}
 const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},async maybeSingle(){return{data:{content:JSON.stringify(latest)}};}};return q;}};
 const context=vm.createContext({supabase:db,USER_INFO_MARKER:'__user_info__',async mergeUserInfo(actor,patch){merges.push({actor,patch});}});
 vm.runInContext(source.slice(begin,end),context);
 const resolved={resolution_status:'resolved',resolved_address:'old address',resolved_at:new Date().toISOString()};
 await context.mergeResolvedPreciseLocation('A','page_same',resolved,'old');
 assert.equal(writes[0].user_name,'A');assert.equal(writes[0].capture_id,'old');assert.equal(merges.length,0);
 await context.mergeResolvedPreciseLocation('A','page_same',resolved);
 assert.equal(writes.length,2);assert.equal(writes[1].capture_reason,'legacy_retained');assert.equal(merges.length,0);
 fail=true;await assert.rejects(context.mergeResolvedPreciseLocation('A','page_same',resolved,'new'),/unavailable/);assert.equal(merges.length,0);
 fail=false;await context.mergeResolvedPreciseLocation('A','page_same',resolved,'new');assert.equal(merges.length,1);assert.equal(merges[0].patch.last_precise_location.capture_id,'new');
});
test('GPS worker reaches pending fixes beyond 150 completed rows and emits valid PostgREST pagination',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8');
 const rows=Array.from({length:201},(_,i)=>({id:'123e4567-e89b-42d3-a456-'+String(i).padStart(12,'0'),user_name:'A',created_at:'2026-10-01T00:00:00Z',content:JSON.stringify({status:i===200?'pending':'completed',page_load_id:'page_old_sample',latitude:26,longitude:119,retry_count:0,max_retries:5})}));
 let resolved=0;const updates=[];
 const db={from(){let cursor='',excluded=[],limit=50,update=null;const q={select(){return q;},eq(){return q;},not(k,op,value){assert.equal(typeof value,'string');assert.match(value,/^\([a-f0-9,-]+\)$/);excluded=value.slice(1,-1).split(',');return q;},or(value){cursor=value.match(/id\.gt\.([a-f0-9-]+)/)[1];return q;},order(){return q;},limit(n){limit=n;return q;},update(value){update=value;return q;},then(resolve){if(update){updates.push(update);return Promise.resolve({error:null}).then(resolve);}return Promise.resolve({data:limit===200?[]:rows.filter(r=>(!cursor||r.id>cursor)&&!excluded.includes(r.id)).slice(0,limit)}).then(resolve);}};return q;}};
 const ctx=vm.createContext({supabase:db,LOCATION_TASK_MARKER:'__location_task__',locationTaskRunning:false,locationTaskScanCursor:null,console:{error(){},warn(){}},require(){return{async resolvePendingHistory(){}};},async resolveLatLngToAddress(){resolved++;return{address:'saved address'};},async mergeResolvedPreciseLocation(){},deobfuscateCoord(){return null;}});
 vm.runInContext(source.slice(source.indexOf('async function processLocationTasks()'),source.indexOf('var locationTaskRunning = false;')),ctx);
 await ctx.processLocationTasks();assert.equal(resolved,0);await ctx.processLocationTasks();assert.equal(resolved,1);assert(updates.some(u=>JSON.parse(u.content).status==='completed'));
});
test('admin GPS retry resolves the specified owned record, rejects mismatched user and does not trust client coordinates',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8'),savedId='123e4567-e89b-42d3-a456-000000000222';let actor='',lookupId='',update;
 const db={from(){const q={select(){return q;},update(value){update=value;return q;},eq(k,v){if(k==='user_name')actor=v;if(k==='id')lookupId=v;return q;},async maybeSingle(){return{data:actor==='A'&&lookupId===savedId?{account_id:'account-A',capture_id:'saved_fix',latitude:26,longitude:119}:null};},then(resolve){return Promise.resolve({error:null}).then(resolve);}};return q;}};
 const app=express();app.use(express.json());const router=express.Router();const ctx=vm.createContext({app:router,supabase:db,verifyToken(req,res,next){if(req.get('Authorization')==='admin')next();else res.sendStatus(403);},rateLimit(){return(req,res,next)=>next();},USER_INFO_MARKER:'__user_info__',async resolveLatLngToAddress(lat,lng){assert.equal(lat,26);assert.equal(lng,119);return{address:'saved address'};},require:module=>require('../render-api/'+module.replace('./','')),async logAdminAudit(){},console,sanitizeError(){return'failed';}});
 const start=source.indexOf("app.post('/admin/user/resolve-location'");vm.runInContext(source.slice(start,source.indexOf('// POST /admin/user/resolve-ip',start)),ctx);app.use(router);
 await request(app).post('/admin/user/resolve-location').send({user_name:'A',location_id:savedId}).expect(403);
 await request(app).post('/admin/user/resolve-location').set('Authorization','admin').send({user_name:'B',location_id:savedId}).expect(404);
 const res=await request(app).post('/admin/user/resolve-location').set('Authorization','admin').send({user_name:'A',location_id:savedId,latitude:50,longitude:80}).expect(200);assert.equal(res.body.address,'saved address');assert.equal(update.resolution_status,'resolved');
});

test('orphaned GPS history is resolved or marked failed instead of remaining pending without a job',async()=>{
 const {resolvePendingHistory}=require('../render-api/location-history');const writes=[];let filters={};
 const rows=[{account_id:'A',capture_id:'legacy_one',latitude:26,longitude:119},{account_id:'B',capture_id:'legacy_two',latitude:27,longitude:120}];
 const db={from(){let patch=null;const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(){return q;},update(value){patch=value;filters={};return q;},then(resolve){if(patch)writes.push({patch,filters:{...filters}});return Promise.resolve({data:patch?null:rows,error:null}).then(resolve);}};return q;}};
 await resolvePendingHistory({supabase:db,async resolver(lat){return lat===26?{address:'resolved address'}:{error:'rate_limited'};}});
 assert.equal(writes[0].patch.resolution_status,'resolved');assert.equal(writes[0].filters.account_id,'A');assert.equal(writes[1].patch.resolution_status,'failed');assert.equal(writes[1].filters.capture_id,'legacy_two');
});

function immutableLocationStore(){
 const facts=new Map();let writes=0;
 return {facts,get writes(){return writes;},from(table){
  if(table==='posts')return{select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},async maybeSingle(){return{data:{id:'account-A'}};}};
  const filters={};const q={select(){return q;},eq(k,v){filters[k]=v;return q;},async upsert(row){writes++;const key=row.account_id+':'+row.capture_id;if(!facts.has(key))facts.set(key,{...row,received_at:new Date().toISOString(),resolution_status:'pending'});return{error:null};},async maybeSingle(){return{data:facts.get(filters.account_id+':'+filters.capture_id)};}};return q;
 }};
}
test('GPS ids are immutable across retries and competing writes, including accuracy/page identity',async()=>{
 const db=immutableLocationStore(),body={latitude:30,longitude:120,accuracy:20,capture_id:'same',page_load_id:'page_12345678',captured_at:new Date(Date.now()-3600000).toISOString()};
 const fix=await recordLocationFix({supabase:db,actor:'A',body,reason:'post_location'});
 const duplicate=await recordLocationFix({supabase:db,actor:'A',body:{...body,captured_at:new Date().toISOString()},reason:'post_location'});
 assert.equal(duplicate.location.captured_at,fix.location.captured_at);assert.equal(duplicate.location.received_at,fix.location.received_at);
 for(const patch of [{latitude:40,longitude:116},{accuracy:0},{page_load_id:'page_other123'}])await assert.rejects(recordLocationFix({supabase:db,actor:'A',body:{...body,...patch},reason:'post_location'}),e=>e.status===409&&e.code==='location_capture_conflict');
 const row=db.facts.get('account-A:same');assert.equal(row.latitude,30);assert.equal(row.longitude,120);assert.equal(row.accuracy_m,20);
 const outcomes=await Promise.allSettled([30,40].map(latitude=>recordLocationFix({supabase:db,actor:'A',body:{latitude,longitude:120,capture_id:'race'},reason:'post_location'})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);
});
test('GPS rejects coercible strings/booleans and capture id truncation before any ledger write',async()=>{
 const db=immutableLocationStore();
 for(const patch of [{latitude:''},{longitude:false},{accuracy:''},{latitude:'30'},{capture_id:'x'.repeat(161)},{capture_id:123},{capture_id:' '}])await assert.rejects(recordLocationFix({supabase:db,actor:'A',body:{latitude:30,longitude:120,accuracy:0,...patch},reason:'post_location'}),e=>e.status===400);
 assert.equal(db.writes,0);
 const fix=await recordLocationFix({supabase:db,actor:'A',body:{latitude:0,longitude:0,accuracy:0},reason:'post_location'});assert.equal(fix.location.latitude,0);assert.equal(fix.location.accuracy_m,0);
});
test('real GPS routes reject invalid types and duplicate id conflicts before reverse geocoding',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../render-api/server'),'utf8');
 const db=immutableLocationStore(),app=express();app.use(express.json());let geocodes=0;let merged;
 const context={app,supabase:db,authenticateUser(req,res,next){req.userName='A';next();},rateLimit(){return(req,res,next)=>next();},getClientIp(){return'8.8.8.8';},require(name){if(name==='./location-history')return require('../render-api/location-history');return require(name);},console,async fetch(){geocodes++;return{ok:true,async json(){return{display_name:'原始地址',address:{city:'城市'}};}};},AbortController,setTimeout,clearTimeout,USER_INFO_MARKER:'__user_info__',async mergeUserInfo(actor,patch){merged=patch;},async createLocationTask(){},sanitizeError(){return'error';}};
 let start=source.indexOf("app.post('/api/location/reverse'");vm.runInNewContext(source.slice(start,source.indexOf("app.post('/api/post/update'",start)),context);
 // Test the conflict before the route's address update and avoid external traffic.
 await recordLocationFix({supabase:db,actor:'A',body:{latitude:30,longitude:120,accuracy:0,capture_id:'same'},reason:'post_location'});
 await request(app).post('/api/location/reverse').send({latitude:40,longitude:116,accuracy:0,capture_id:'same'}).expect(409);
 await request(app).post('/api/location/reverse').send({latitude:'30',longitude:120}).expect(400);assert.equal(geocodes,0);
 start=source.indexOf("app.post('/api/user/location'");vm.runInNewContext(source.slice(start,source.indexOf('// GET /api/user/location/status',start)),context);
 await request(app).post('/api/user/location').send({latitude:'',longitude:false,accuracy:'',page_load_id:'page_12345678'}).expect(400);
 await request(app).post('/api/user/location').send({latitude:40,longitude:116,accuracy:0,page_load_id:'page_12345678',capture_id:'same'}).expect(409);
 // The account query doubles as an empty user-info row in this isolated DB.
 const captured=new Date(Date.now()-3600000).toISOString();const r=await request(app).post('/api/user/location').send({latitude:30,longitude:120,accuracy:0,page_load_id:'page_12345678',capture_id:'hour_old',captured_at:captured}).expect(200);
 assert.equal(r.body.location.captured_at,captured);assert.equal(merged.last_precise_location.captured_at,db.facts.get('account-A:hour_old').captured_at);assert.equal(r.body.location.received_at,db.facts.get('account-A:hour_old').received_at);
});
