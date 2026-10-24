'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const express=require('express'),request=require('supertest');
const {createAttachmentStore}=require('../render-api/ai-request-features');
const {classifySupabaseError}=require('../render-api/db-result');
const {writeSse,endSse,MAX_SSE_BUFFER_BYTES}=require('../render-api/sse-write');
const {createAiQuota}=require('../render-api/ai-quota');
const {runAsAccount,bindAccount,bindPrivateAiData}=require('../render-api/ai-private-data');
const {createClient}=require('@supabase/supabase-js');
const {createProfileRecords}=require('../render-api/profile-records');
const accountId='11111111-1111-4111-8111-111111111111';
test('F1 likes/comments paginate exact bigint cursors and reject malformed or out-of-range ids',async()=>{
 for(const kind of ['likes','comments']){
  const rows=Array.from({length:23},(_,i)=>({id:String(9223372036854775807n-BigInt(i)),created_at:'2026-10-24T00:00:00.123456Z',post_id:accountId}));
  const db={from(table){let before=null,size=20;const q={select(fields){if(table===kind)assert.match(fields,/id::text/);return q},eq(){return q},or(value){before=value.match(/id.lt.([0-9]+)/)[1];return q},order(){return q},limit(n){size=n;return q},in(){return q},then(resolve,reject){return Promise.resolve({data:table===kind?rows.filter(r=>!before||BigInt(r.id)<BigInt(before)).slice(0,size):[],count:23}).then(resolve,reject)}};return q}};
  const app=express();app.use(createProfileRecords({express,supabase:db,authenticateUser(req,res,next){req.userName='alice';next()}}));
  const first=(await request(app).get('/').query({kind,limit:20}).expect(200)).body;
  assert.equal(first.next_cursor.id,rows[19].id);
  const next=(await request(app).get('/').query({kind,before_at:first.next_cursor.at,before_id:first.next_cursor.id}).expect(200)).body;
  assert.equal(next.has_more,false);assert.deepEqual([...first.items,...next.items].map(r=>r.id),rows.map(r=>r.id));
  for(const id of ['-1','1e2','9223372036854775808','1,or(id.gt.0)','1.5',accountId])await request(app).get('/').query({kind,before_at:rows[0].created_at,before_id:id}).expect(400);
 }
});
test('F2 interleaved owners, LRU access, duplicate reuse, entry budget and expiry stay bounded',()=>{
 let now=0;const cache=createAttachmentStore({maxBytes:64,ownerBytes:54,now:()=>now,ttl:50});
 const add=(owner,size,name=owner+'-'+size)=>cache.add(owner,'conv-123',{name:name+'.txt',data_url:'data:text/plain;base64,'+Buffer.alloc(size,'x').toString('base64')});
 add('b',34);add('a',30);add('a',40);assert.ok(cache.stats().bytes<=64);
 for(let i=0;i<100;i++){const owner=String(i%3),r=add(owner,i%20+1,String(i));cache.get(owner,'conv-123',r.attachment_ref);assert.equal(add(owner,i%20+1,String(i)).attachment_ref,r.attachment_ref);assert.ok(cache.stats().bytes<=64);now++;}
 now+=51;assert.deepEqual(cache.stats(),{entries:0,bytes:0});
 const tiny=createAttachmentStore({maxBytes:1024,ownerBytes:1024});
 for(let i=0;i<140;i++)tiny.add(String(i),'conv-123',{name:i+'.txt',data_url:'data:text/plain;base64,eA=='});
 assert.equal(tiny.stats().entries,128);
});
test('F5 real PostgREST codes take precedence over misleading HTTP status and messages',()=>{
 for(const code of ['PGRST000','PGRST001','PGRST002','PGRST003'])assert.equal(classifySupabaseError({code,status:400}).retryable,true);
 for(const code of ['PGRST100','PGRST102','PGRST205','PGRST116','PGRST301','23505','42501'])assert.equal(classifySupabaseError({code,status:503,message:'timeout'}).retryable,false);
 for(const status of [408,429,500,503,504])assert.equal(classifySupabaseError({status}).retryable,true);
});
test('F8 special usernames serialize concurrent quota checks and recover after a failed task',async()=>{
 let active=0,max=0,calls=0;const quota=createAiQuota({async rpc(){calls++;active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;if(calls===1)throw Error('fixture failure');return{data:{allowed:true,quota:{can_chat:true}}}},from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null})};return q}});
 for(const name of ['constructor','__proto__','toString','alice']){
  await Promise.all(Array.from({length:3},()=>quota.checkBeforeChat(name,false)));
 }
 assert.equal(calls,12);assert.equal(max,1);
});
function response(pattern=[]){const res=new EventEmitter();Object.assign(res,{headersSent:true,writableEnded:false,frames:[],write(data){this.frames.push(data);return pattern.length?pattern.shift():true},end(){this.writableEnded=true;this.emit('finish')},destroy(){this.destroyed=true;this.emit('close')}});return res}
test('F9 normal ending drains repeated backpressure in order, once, including done',async()=>{
 const res=response([false,false,true]);writeSse(res,{type:'content',text:'first'});writeSse(res,{type:'content',text:'tail'});writeSse(res,{type:'done'});
 const ended=endSse(res);assert.equal(endSse(res),ended);assert.equal(res.writableEnded,false);assert.equal(writeSse(res,{type:'content',text:'late'}),false);
 res.emit('drain');assert.equal(res.writableEnded,false);res.emit('drain');assert.equal(await ended,true);
 assert.equal(res.frames.length,3);assert.match(res.frames[1],/tail/);assert.match(res.frames[2],/done/);assert.equal(res.writableEnded,true);assert.equal(res.listenerCount('drain'),0);
});
test('F9 disconnect, overflow and timeout release queued frames/listeners',async()=>{
 const closed=response([false]);writeSse(closed,{type:'content',text:'first'});writeSse(closed,{type:'done'});const pending=endSse(closed);closed.destroy();assert.equal(await pending,false);assert.equal(closed._sseBufferBytes,0);
 const overflow=response([false]);writeSse(overflow,{type:'content',text:'first'});assert.equal(writeSse(overflow,{type:'content',text:'x'.repeat(MAX_SSE_BUFFER_BYTES)}),false);assert.equal(overflow.destroyed,true);assert.equal(overflow.listenerCount('drain'),0);
 const stalled=response([false]);writeSse(stalled,{type:'content',text:'first'});const keepAlive=setTimeout(()=>{},50);assert.equal(await endSse(stalled,{timeoutMs:5}),false);clearTimeout(keepAlive);assert.equal(stalled.destroyed,true);assert.equal(stalled.listenerCount('close'),0);
});
test('F7 actual Supabase query serialization scopes history/research/export/update/copies and stamps all async writes',async()=>{
 const requests=[];const db=bindPrivateAiData(createClient('https://fixture.supabase.co','fixture-key',{global:{fetch:async(url,opts)=>{requests.push({url:new URL(url),body:opts.body?JSON.parse(opts.body):null});return new Response('[]',{status:200,headers:{'content-type':'application/json'}})}}}));
 await runAsAccount({userName:'alice',accountId},async()=>{
  await Promise.all(['__ai_agent_msg__','**ai_agent_conv_summary**','__ai_agent_profile__'].map(marker=>db.from('posts').select('*').eq('media_type',marker).eq('user_name','alice')));
  await db.from('posts').select('*').in('media_type',['__ai_agent_msg__','**ai_agent_conv_summary**']);
  await db.from('posts').update({content:'edited'}).eq('media_type','__ai_agent_msg__');
  await db.from('ai_search_results').select('*').eq('owner_name','alice');
  await new Promise(r=>setImmediate(r));
  await db.from('posts').insert({user_name:'alice',media_type:'__ai_agent_msg__',ai_account_id:'spoofed'});
  await db.from('ai_search_results').upsert({owner_name:'alice',snippet:'private'}).select('id');
  await db.rpc('list_ai_conversations',{p_user_name:'alice',p_account_id:'spoofed'});
  assert.throws(()=>db.from('posts').insert({user_name:'bob',media_type:'__ai_agent_msg__'}),/ai_account_required/);
 });
 for(const r of requests.slice(0,5))assert.ok(r.url.searchParams.get('or').includes('ai_account_id.eq.'+accountId));
 assert.equal(requests[5].url.searchParams.get('ai_account_id'),'eq.'+accountId);
 assert.equal(requests[6].body.ai_account_id,accountId);assert.equal(requests[7].body.ai_account_id,accountId);assert.equal(requests[8].body.p_account_id,accountId);
 assert.throws(()=>db.from('posts').insert({user_name:'alice',media_type:'__ai_agent_msg__'}),/ai_account_required/);
 await runAsAccount({userName:'alice',accountId},()=>db.from('posts').select('*').eq('media_type','text'));
 assert.equal(requests.at(-1).url.searchParams.get('or'),null,'public posts stay available');
});

test('dependency regression: compressed trailing bytes cannot terminate the Express process',async()=>{
 const zlib=require('node:zlib'),app=express();app.use(express.json());app.post('/body',(req,res)=>res.json({ok:true}));app.get('/health',(req,res)=>res.sendStatus(200));app.use((error,req,res,next)=>res.status(error.status||400).json({ok:false}));
 const bytes=Buffer.concat([zlib.gzipSync(Buffer.from('{"ok":true}')),Buffer.from('trailing garbage')]);
 const response=await request(app).post('/body').set('Content-Type','application/json').set('Content-Encoding','gzip').send(bytes);
 assert.ok([200,400].includes(response.status));await request(app).get('/health').expect(200);
});

test('F7 native HTTP disconnect keeps the captured owner for interrupted history persistence',async()=>{
 const http=require('node:http');let finishSave,inserted;
 const saved=new Promise(resolve=>finishSave=resolve);
 const db=bindPrivateAiData(createClient('https://fixture.supabase.co','fixture-key',{global:{fetch:async(url,opts)=>{inserted=JSON.parse(opts.body);return new Response('[]',{status:200,headers:{'content-type':'application/json'}})}}}));
 const app=express();app.get('/',(req,res)=>{req.userName='alice';req.accountId=accountId;runAsAccount(req,()=>{
  const save=bindAccount(()=>require('../render-api/ai-chat-save').saveInterruptedChatTurn({db,userName:req.userName,convId:'ABCDEF',message:'keep my question',marker:'__ai_agent_msg__',buildMeta:()=>'{"role":"user"}'}).then(finishSave));
  res.on('close',save);res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');
 });});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  await new Promise((resolve,reject)=>{const request=http.get('http://127.0.0.1:'+server.address().port,response=>{response.once('data',()=>{request.destroy();resolve()})});request.on('error',error=>{if(error.code!=='ECONNRESET')reject(error)});});
  assert.equal(await saved,true);assert.equal(inserted[0].ai_account_id,accountId);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
