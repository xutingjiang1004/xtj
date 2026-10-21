'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {install}=require('../render-api/ai-conversation-features');
const id='12345678-1234-4234-8234-123456789012';
function fixture(result={ok:true,items:[],records:[]}){const calls=[],app=express();app.use(express.json());install(app,{db:{async rpc(name,args){calls.push({name,args});return {data:result};}},authenticateUser(req,res,next){if(!req.headers['x-test-user'])return res.status(401).json({ok:false});req.userName='alice';req.accountId='verified-account-id';next();},rateLimit:()=> (_req,_res,next)=>next()});return {app,calls};}
test('history endpoints authenticate and use the verified account, never a client-supplied owner',async()=>{
  const f=fixture();await request(f.app).get('/api/agent/chat/search').expect(401);assert.equal(f.calls.length,0);
  await request(f.app).post('/api/agent/chat/bookmarks').set('x-test-user','alice').send({conversation_id:'conversation-a',message_id:id,user_name:'bob',account_id:'foreign'}).expect(200);
  assert.equal(f.calls[0].args.p_user_name,'alice');assert.equal(f.calls[0].args.p_account_id,'verified-account-id');
  assert.deepEqual(f.calls[0].args.p_value,{conversation_id:'conversation-a',message_id:id});
});
test('invalid selectors and date intervals fail before querying history; cursors retain database precision',async()=>{
  const f=fixture();for(const query of [{q:'x'.repeat(121)},{mode:'arbitrary'},{date_from:'2026-10-22',date_to:'2026-10-20'},{before:'{bad'}])await request(f.app).get('/api/agent/chat/search').set('x-test-user','alice').query(query).expect(400);
  assert.equal(f.calls.length,0);const cursor={id,at:'2026-10-20T12:00:00.123456+00:00'};
  await request(f.app).get('/api/agent/chat/search').set('x-test-user','alice').query({before:JSON.stringify(cursor),model:'deepseek-flash'}).expect(200);assert.equal(f.calls[0].args.p_value.before_at,cursor.at);
});
test('a stale title is a safe conflict, unavailable database details never leak, inaccessible messages return 404',async()=>{
  const conflict=fixture({ok:false,code:'history_metadata_conflict'});const r=await request(conflict.app).post('/api/agent/chat/metadata').set('x-test-user','alice').send({conversation_id:'conversation-a',title:'新标题',revision:1}).expect(409);assert.match(r.body.error,/另一台设备/);
  await request(fixture().app).get('/api/agent/chat/message/'+id).set('x-test-user','alice').expect(404);
  const failed=fixture();failed.calls.length=0;const r2=await request(fixture(null).app).get('/api/agent/chat/bookmarks').set('x-test-user','alice').expect(503);assert.equal(r2.headers['cache-control'],'no-store');
});
