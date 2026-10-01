'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {recordLocationFix,createLocationHistory}=require('../render-api/location-history');
const {browserContext,createBrowserContext}=require('../render-api/browser-context');
test('GPS record binds the authenticated actor and account; duplicate retries do not overwrite evidence',async()=>{
 const writes=[];const db={from(table){if(table==='posts')return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{id:'account-A'}};}};return{async upsert(row,options){writes.push({row,options});return{error:null};}};}};
 await recordLocationFix({supabase:db,actor:'A',body:{user_name:'B',latitude:26,longitude:119,accuracy:0,captured_at:new Date().toISOString(),capture_id:'post_one'},reason:'post_location',ip:'1.2.3.4'});
 assert.equal(writes[0].row.user_name,'A');assert.equal(writes[0].row.account_id,'account-A');assert.equal(writes[0].row.accuracy_m,0);assert.equal(writes[0].options.ignoreDuplicates,true);assert.equal(writes[0].row.capture_reason,'post_location');
 await assert.rejects(recordLocationFix({supabase:db,actor:'A',body:{latitude:200,longitude:119},reason:'post_location'}));assert.equal(writes.length,1);
});
test('location history requires admin credentials or reads only the current actor, and rejects invalid cursors',async()=>{
 const calls=[];const db={from(){const q={select(){return q;},eq(k,v){calls.push([k,v]);return q;},or(){return q;},order(){return q;},limit(){return q;},then(resolve){return Promise.resolve({data:Array.from({length:51},(_,i)=>({id:'123e4567-e89b-42d3-a456-'+String(i).padStart(12,'0'),received_at:'2026-10-01T00:00:00Z',latitude:26,longitude:119}))}).then(resolve);}};return q;}};
 const app=express();app.use(createLocationHistory({express,supabase:db,verifyToken(req,res,next){if(req.get('Authorization')==='admin')next();else res.sendStatus(403);},authenticateUser(req,res,next){if(req.get('Authorization')==='A'){req.userName='A';next();}else res.sendStatus(401);}}));
 await request(app).get('/admin/user-location-history?user_name=B').set('Authorization','A').expect(403);
 const r=await request(app).get('/api/user/location-history?user_name=B').set('Authorization','A').expect(200);assert.equal(r.body.items.length,50);assert.equal(r.body.has_more,true);assert.deepEqual(calls.at(-1),['user_name','A']);
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
 assert.equal(writes.length,1);assert.equal(merges.length,0);
 fail=true;await assert.rejects(context.mergeResolvedPreciseLocation('A','page_same',resolved,'new'),/unavailable/);assert.equal(merges.length,0);
 fail=false;await context.mergeResolvedPreciseLocation('A','page_same',resolved,'new');assert.equal(merges.length,1);assert.equal(merges[0].patch.last_precise_location.capture_id,'new');
});
