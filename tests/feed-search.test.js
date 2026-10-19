'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express'),request=require('supertest');
const {readFeedSearch}=require('../render-api/feed-search');
const {isNormalPost}=require('../render-api/post-query');
const id=n=>'dddddddd-dddd-4ddd-8ddd-'+String(n).padStart(12,'0');
test('search validates date ranges, timezones and complete cursors before calling PostgreSQL',async()=>{
  let calls=0;const db={rpc(){calls++;throw Error('must not run');}};
  for(const query of [{q:'x',from:'2026-10-02T00:00:00Z',to:'2026-10-01T00:00:00Z'},{q:'x',cursor_id:id(1)},{q:'x',cursor_created_at:'bad',cursor_id:id(1)},{q:'x',timezone:'invalid/timezone'},{q:'x'.repeat(201)},{q:'x',visibility:'admin'}])await assert.rejects(readFeedSearch(db,query,'alice','*'),error=>error.status===400);
  assert.equal(calls,0);
});
test('search passes actor-bound criteria and reads one extra result for a stable compound cursor',async()=>{
  let args,fields;const rows=[1,2,3].map(n=>({id:id(n),created_at:'2026-10-01T00:00:00.123456+00:00'}));
  const db={rpc(name,a){assert.equal(name,'xtj_search_feed');args=a;return{select(f){fields=f;return Promise.resolve({data:rows});}};}};
  const result=await readFeedSearch(db,{q:'%_quoted',limit:'2',only_mine:'true',author:'Bob',visibility:'private',timezone:'Asia/Shanghai'},'alice','id,created_at');
  assert.equal(args.p_actor,'alice');assert.equal(args.p_only_mine,true);assert.equal(args.p_author,'Bob');assert.equal(args.p_query,'%_quoted');assert.equal(args.p_limit,3);assert.equal(fields,'id,created_at');assert.equal(result.posts.length,2);assert.equal(result.endReached,false);assert.deepEqual(result.nextCursor,{created_at:rows[1].created_at,id:id(2)});
  await assert.rejects(readFeedSearch({rpc(){return{select(){return{error:{message:'missing migration'}};}};}},{q:'x'},'alice','*'),error=>error.status===503&&error.retryable===true);
});
test('the actual feed search route ignores forged actors and does not expose private or system rows from an invalid projection',async()=>{
  const app=express();let actor;
  const rows=[{id:id(1),user_name:'bob',media_type:'text',content:'visible',visibility:'public'}, {id:id(2),user_name:'bob',media_type:'text',content:'private',visibility:'private'}, {id:id(3),user_name:'alice',media_type:'__dm__',content:'system',visibility:'public'}];
  const source=fs.readFileSync('render-api/server.js','utf8'),a=source.indexOf("app.get('/api/feed',"),b=source.indexOf('// ===================== 照片墙接口',a);
  const context={app,optionalAuth(req,res,next){req.userName=req.get('x-user')||undefined;next();},rateLimit:()=>((_req,_res,next)=>next()),ADMIN_USERNAME:'xxz',supabase:{},isNormalPost,looksLikeSystemTelemetry:()=>false,loadPostAttachments:async(_db,posts)=>posts,readFeedEngagement:async(_db,posts)=>({posts,comments:[],likes:[]}),console,
    require(name){assert.equal(name,'./feed-search');return{async readFeedSearch(_db,_q,name){actor=name;return{posts:rows,endReached:true,nextCursor:null};}};}};
  vm.createContext(context);vm.runInContext(source.slice(a,b),context);
  const response=await request(app).get('/api/feed?q=needle&actor=xxz').set('x-user','alice').expect(200);assert.equal(actor,'alice');assert.deepEqual(response.body.posts.map(p=>p.id),[id(1)]);
  await request(app).get('/api/feed?q=needle&actor=alice').expect(200);assert.equal(actor,undefined);
});
