'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createChatFeatures } = require('../render-api/chat-features');
const { validateDmMediaKind } = require('../render-api/dm-media');
const { sniffDocument } = require('../render-api/dm-file-magic');
const id = n => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');
function query(rows, config = {}) {
  const filters = []; let change = null, cap = Infinity, orders = [];
  const q = {
    select() { return this; },
    eq(k,v) { filters.push(r => r[k] === v); return this; },
    is(k,v) { filters.push(r => (r[k] == null ? null : r[k]) === v); return this; },
    not(k,op,v) { assert.equal(op, 'is'); filters.push(r => (r[k] == null ? null : r[k]) !== v); return this; },
    in(k,v) { filters.push(r => v.includes(r[k])); return this; },
    gt(k,v) { filters.push(r => r[k] > v); return this; },
    or(value) {
      const match = value.match(/^sent_at\.(lt|gt)\.([^,]+),and\(sent_at\.eq\.([^,]+),id\.(lt|gt)\.([^)]+)\)$/);
      assert.ok(match); const [,op,time,,idOp,key] = match;
      filters.push(r => op === 'lt' ? r.sent_at < time || (r.sent_at === time && r.id < key) : r.sent_at > time || (r.sent_at === time && r.id > key));
      assert.equal(op, idOp); return this;
    },
    order(k,v) { orders.push([k,v.ascending]); return this; },
    limit(n) { cap=n; return this; },
    update(v) { change=v; return this; },
    delete() { change='delete'; return this; },
    async upsert(v) {
      const found = rows.find(r => r.message_id === v.message_id && r.user_id === v.user_id);
      if (found) Object.assign(found,v); else rows.push(v);
      return { data: v, error: null };
    },
    result() {
      let found = rows.filter(r=>filters.every(f=>f(r)));
      orders.slice().reverse().forEach(([k,asc])=> { found=found.slice().sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(asc?1:-1)); });
      found=found.slice(0,cap);
      if (change && config.conflict) found=[];
      else if (change === 'delete') found.forEach(r=>rows.splice(rows.indexOf(r),1));
      else if (change) found.forEach(r=>Object.assign(r,change));
      return found;
    },
    async maybeSingle() { return { data: this.result()[0] || null, error: null }; },
    then(resolve,reject) { return Promise.resolve({ data:this.result(), error:null }).then(resolve,reject); }
  }; return q;
}
function fixture(config = {}) {
  const now = new Date(Date.now()-60000).toISOString();
  const rows = config.messages || [{ id:id(4), legacy_post_id:id(4), conversation_id:id(3), sender_name_snapshot:'actor', message_type:'text', body:'original', sent_at:now, withdrawn_at:null }];
  const posts = rows.map(m=>({ id:m.legacy_post_id,user_name:'actor',media_url:'peer',media_type:'__dm__',created_at:m.sent_at,content:JSON.stringify({text:'original'}) }));
  const states=config.hidden || [], reactions=[], calls=[];
  const supabase = {
    async rpc(n,args) { calls.push({n,args}); if(n==='chat_get_conversation_state') return {data:config.state || {status:'ok',conversation_id:id(3),deleted:false},error:null};
      return config.searchError ? {data:null,error:{code:'test_error'}} : {data:{status:'ok',items:[],has_more:false},error:null}; },
    from(n) { return query(n==='chat_users' ? [{id:id(1),user_name:'actor',is_registered:true,deleted_at:null}] :
      n==='chat_messages' ? rows : n==='posts' ? posts : n==='chat_message_user_state' ? states : reactions, {conflict:config.conflict && n==='posts'}); }
  };
  const app=express();app.use(express.json());
  const features=createChatFeatures({express,supabase,env:{},privateStorage:config.privateStorage,authenticateUser(req,res,next){if(req.headers.authorization!=='Bearer test')return res.sendStatus(401);req.userName='actor';next();}});
  app.use('/api/chat',features.router);return {app,rows,posts,reactions,calls,features};
}
const auth = { Authorization:'Bearer test' };
test('voice URL renewal checks conversation, clear boundary and hidden state before signing',async()=>{
  const calls=[];
  const message={id:id(4),legacy_post_id:id(4),conversation_id:id(3),sender_name_snapshot:'peer',message_type:'audio',sent_at:new Date().toISOString(),withdrawn_at:null,payload:{media:{bucket:'dm-private',storage_path:'chat/private_voice.m4a'}}};
  const privateStorage={async sign(path,refresh){calls.push({path,refresh});return 'https://storage.example/renewed';}};
  const f=fixture({messages:[message],privateStorage});
  await request(f.app).get('/api/chat/voice-url?peer=peer&message_id='+id(4)).set(auth).expect(200);
  assert.equal(calls.length,1);assert.equal(calls[0].refresh,true);
  await request(f.app).get('/api/chat/voice-url?peer=peer&message_id='+id(4)).expect(401);
  for(const override of [{hidden:[{message_id:id(4),user_id:id(1),hidden_at:new Date().toISOString()}]},{state:{status:'ok',conversation_id:id(3),deleted:true}},{state:{status:'ok',conversation_id:id(3),cleared_before:'2100-01-01T00:00:00Z'}}]){
    const denied=fixture({messages:[message],privateStorage,...override});
    await request(denied.app).get('/api/chat/voice-url?peer=peer&message_id='+id(4)).set(auth).expect(404);
  }
  assert.equal(calls.length,1);
});
test('search uses signed identity, validates inputs and bounds server pagination',async()=>{
  const f=fixture();
  assert.equal((await request(f.app).get('/api/chat/history/search?q=hello')).status,401);
  for(const qs of ['q=x','q=hello&from=2026-02-31','q=hello&cursor_id='+id(4),'q=hello&kind=unexpected'])
    assert.equal((await request(f.app).get('/api/chat/history/search?'+qs).set(auth)).status,400);
  const r=await request(f.app).get('/api/chat/history/search?q=hello&actor=victim&peer=peer&limit=1000').set(auth);
  assert.equal(r.status,200);assert.equal(f.calls[0].args.p_actor_name,'actor');assert.equal(f.calls[0].args.p_limit,50);
  assert.equal((await request(fixture({searchError:true}).app).get('/api/chat/history/search?q=hello').set(auth)).status,503);
});
test('edit preserves legacy projection and rejects ownership, expiry and conflict',async()=>{
  const f=fixture();assert.equal((await request(f.app).post('/api/chat/messages/edit').set(auth).send({peer:'peer',message_id:id(4),text:'edited'})).status,200);
  assert.equal(JSON.parse(f.posts[0].content).text,'edited');assert.ok(JSON.parse(f.posts[0].content).edited_at);
  for(const override of [{sender_name_snapshot:'peer'},{message_type:'audio'},{withdrawn_at:new Date().toISOString()}]){
    const g=fixture();Object.assign(g.rows[0],override);
    assert.equal((await request(g.app).post('/api/chat/messages/edit').set(auth).send({peer:'peer',message_id:id(4),text:'hijack'})).status,404);
  }
  const old=fixture();old.rows[0].sent_at=new Date(Date.now()-1000000).toISOString();
  assert.equal((await request(old.app).post('/api/chat/messages/edit').set(auth).send({peer:'peer',message_id:id(4),text:'late'})).status,409);
  const conflict=fixture({conflict:true});assert.equal((await request(conflict.app).post('/api/chat/messages/edit').set(auth).send({peer:'peer',message_id:id(4),text:'race'})).status,409);
});
test('reply and reactions enforce conversation membership, per-user hidden state and clear cutoff',async()=>{
  for(const cfg of [
    {state:{status:'ok',conversation_id:id(8),deleted:false}},
    {state:{status:'ok',conversation_id:id(3),deleted:false,cleared_before:new Date().toISOString()}},
    {hidden:[{message_id:id(4),user_id:id(1),hidden_at:new Date().toISOString()}]}
  ]){
    const f=fixture(cfg);assert.equal(await f.features.validateReply('actor','peer',id(4)),null);
    assert.equal((await request(f.app).post('/api/chat/messages/reactions').set(auth).send({peer:'peer',message_id:id(4),emoji:'👍'})).status,404);
    const r=await request(f.app).get('/api/chat/messages/reactions?peer=peer&ids='+id(4)).set(auth);assert.deepEqual(r.body.items,{});
  }
  const f=fixture();assert.equal((await request(f.app).post('/api/chat/messages/reactions').set(auth).send({peer:'peer',message_id:id(4),emoji:'👍',user_id:id(9)})).status,200);
  assert.equal(f.reactions[0].user_id,id(1));
  assert.equal((await request(f.app).post('/api/chat/messages/reactions').set(auth).send({peer:'peer',message_id:id(4),emoji:'<script>'})).status,400);
});
test('history context excludes withdrawn and hidden neighbors',async()=>{
  const messages=[1,2,3,4].map(n=>({id:id(n+10),legacy_post_id:id(n+10),conversation_id:id(3),sender_name_snapshot:'actor',message_type:'text',body:'message',sent_at:'2026-09-29T10:0'+n+':00Z',withdrawn_at:n===1?'2026-09-29T11:00:00Z':null}));
  const f=fixture({messages,hidden:[{message_id:id(12),user_id:id(1),hidden_at:'2026-09-29T11:00:00Z'}]});
  const r=await request(f.app).get('/api/chat/history/context?peer=peer&message_id='+id(13)).set(auth);
  assert.equal(r.status,200);assert.deepEqual(r.body.data.map(m=>m.id),[id(13),id(14)]);
});
test('restricted documents and recorded WebM have an explicit type boundary',()=>{
  assert.equal(validateDmMediaKind('file','application/pdf').ok,true);
  for(const mime of ['text/html','image/svg+xml','application/javascript','application/octet-stream']) assert.equal(validateDmMediaKind('file',mime).ok,false);
  assert.equal(validateDmMediaKind('__proto__','text/plain').ok,false);
  assert.equal(sniffDocument(Buffer.from('%PDF-1.7\n'),'application/pdf').ok,true);
  assert.equal(sniffDocument(Buffer.from('<html>unsafe'),'text/plain').ok,false);
  assert.equal(sniffDocument(Buffer.from('hello,world\n'),'text/csv').ok,true);
});
test('legacy message IDs resolve to canonical replies and hidden state uses the canonical ID',async()=>{
  const f=fixture();f.rows[0].legacy_post_id=id(9);f.posts[0].id=id(9);
  const result=await request(f.app).post('/api/chat/messages/reply/validate').set(auth).send({peer:'peer',message_id:id(9)});
  assert.equal(result.status,200);assert.equal(result.body.reply_to.id,id(4));
  const hidden=fixture({hidden:[{message_id:id(4),user_id:id(1),hidden_at:new Date().toISOString()}]});hidden.rows[0].legacy_post_id=id(9);
  assert.equal(await hidden.features.validateReply('actor','peer',id(9)),null);
  const other=fixture({state:{status:'ok',conversation_id:id(8),deleted:false}});other.rows[0].legacy_post_id=id(9);
  assert.equal(await other.features.validateReply('actor','other-peer',id(9)),null);
});
