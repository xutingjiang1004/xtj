'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest'),fs=require('node:fs'),vm=require('node:vm');
const {installPostViews}=require('../render-api/post-views');
test('view API uses only the authenticated actor and the atomic RPC; database failures are retryable',async()=>{
 const calls=[];let result={data:{ok:true,recorded:true,views:5}};const app=express();app.use(express.json());
 installPostViews(app,{supabase:{async rpc(name,args){calls.push({name,args});return result;}},authenticateUser(req,res,next){req.userName='bob';next();},rateLimit(){return(req,res,next)=>next();},normalizePostId(x){return typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)?x:null;}});
 const id='123e4567-e89b-42d3-a456-426614174000';assert.equal((await request(app).post('/api/post/view').send({post_id:id,user_name:'alice'}).expect(200)).body.views,5);
 assert.deepEqual(calls,[{name:'record_post_view',args:{p_post_id:id,p_actor:'bob'}}]);
 result={data:{ok:false,code:'post_not_found'}};await request(app).post('/api/post/view').send({post_id:id}).expect(404);
 result={error:{code:'unavailable'}};await request(app).post('/api/post/view').send({post_id:id}).expect(503);await request(app).post('/api/post/view').send({post_id:'bad'}).expect(400);
});
test('view throttle is per account, pending requests cannot cross identities, and detail keeps authoritative views',async()=>{
 const source=fs.readFileSync('js/core-parts/04-posts-interactions.js','utf8'),start=source.indexOf('            function canTrackViewNow('),end=source.indexOf('            window.xtjTrackPostView',start);
 const tasks=[],storage=new Map(),calls=[],context={currentUser:'alice',_authStateEpoch:1,Date,Number,encodeURIComponent,Set,viewTracked:new Set(),VIEW_TRACK_TTL:300000,setTimeout(fn){tasks.push(fn);},window:{safeStorage:{get:k=>storage.get(k),set:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},async xtjProtectedFetch(url,options){calls.push(options);return{ok:true,json:async()=>({ok:true,views:9})};},__xtjPostDetailSnapshot:{id:'one',views:0}},document:{getElementById(){return null;},querySelector(){return null;}},findBySafePostSelector(){return null;},feedAllPosts:[{id:'one',views:0}],postInfoCache:{one:{views:0}},writeFeedCacheSnapshot(){},updateFeedStats(){},console};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.trackView('one');assert.equal(tasks.length,1);context.currentUser='bob';context._authStateEpoch++;assert.equal(context.canTrackViewNow('one'),true);await tasks.shift()();assert.equal(calls.length,0);
 context.trackView('one');await tasks.shift()();assert.equal(calls.length,1);assert.equal(calls[0].authOwner,'bob');assert.equal(context.feedAllPosts[0].views,9);assert.equal(context.window.__xtjPostDetailSnapshot.views,9);
 assert.equal(context.canTrackViewNow('one'),false);context.currentUser='carol';context._authStateEpoch++;assert.equal(context.canTrackViewNow('one'),true);
});
