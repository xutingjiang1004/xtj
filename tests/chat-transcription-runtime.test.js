'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createChatTranscription}=require('../render-api/chat-transcription');
function fixture({withdrawn=false,providerError=false,conflict=false}={}){
 const job={message_id:'message',attempts:1,lease_token:'lease'};
 const posts=[{id:'post',content:JSON.stringify({text:'caption',media:{kind:'audio'},read_at:null}),user_name:'actor',media_url:'peer'}];
 const updates=[],events=[],requests=[];let claim=true,cas=0;
 const supabase={async rpc(){if(claim){claim=false;return{data:[job]};}return{data:[]};},
 storage:{from(bucket){assert.equal(bucket,'uploads');return{async download(path){assert.equal(path,'chat/owned.webm');return{data:new Blob(['audio'],{type:'audio/webm'})};}};}},
 from(table){let filter=[],patch;const q={select(){return this;},eq(k,v){filter.push([k,v]);return this;},update(v){patch=v;return this;},async maybeSingle(){
 if(table==='chat_messages')return{data:{legacy_post_id:'post',message_type:'audio',withdrawn_at:withdrawn?'now':null}};
 if(table==='dm_media_uploads'){assert.ok(filter.some(([k,v])=>k==='message_id'&&v==='post'));return{data:{storage_path:'chat/owned.webm',mime_type:'audio/webm',size_bytes:5}};}
 if(table==='posts'){
 if(patch){cas++;if(conflict&&cas===1){const next=JSON.parse(posts[0].content);next.read_at='new-receipt';posts[0].content=JSON.stringify(next);return{data:null};}Object.assign(posts[0],patch);return{data:{id:'post'}};}return{data:posts[0]};}
 return{data:null};},then(resolve,reject){updates.push({table,patch,filter});return Promise.resolve({data:[]}).then(resolve,reject);}};return q;}};
 const worker=createChatTranscription({supabase,env:{CHAT_TRANSCRIPTION_API_KEY:'test-key'},publishChatEvent(...e){events.push(e);},async fetchImpl(url,options){requests.push({url,options});if(providerError)return{ok:false};return{ok:true,async json(){return{text:'transcribed words'};}};}});
 worker.stop();return{worker,posts,updates,events,requests,job};
}
test('transcription downloads only the authoritative registry object and preserves concurrent receipts',async()=>{
 const f=fixture({conflict:true});await f.worker.processJob(f.job);const payload=JSON.parse(f.posts[0].content);
 assert.equal(payload.transcript,'transcribed words');assert.equal(payload.text,'caption');assert.equal(payload.read_at,'new-receipt');
 assert.equal(f.events.length,2);assert.equal(f.requests[0].options.headers.Authorization,'Bearer test-key');
 assert.equal(f.updates[0].patch.status,'completed');assert.ok(f.updates[0].filter.some(([k,v])=>k==='lease_token'&&v==='lease'));
});
test('withdrawn voice messages are never sent to the transcription provider',async()=>{
 const f=fixture({withdrawn:true});await assert.rejects(f.worker.processJob(f.job),/message_unavailable/);assert.equal(f.requests.length,0);
});
test('provider failures retry through the durable queue without replacing messages',async()=>{
 const f=fixture({providerError:true});await f.worker.tick();assert.equal(f.updates[0].patch.status,'queued');assert.equal(f.updates[0].patch.last_error,'provider_error');assert.ok(f.updates[0].patch.available_at);assert.equal(JSON.parse(f.posts[0].content).transcript,undefined);
});
test('unconfigured transcription remains unavailable and never touches storage',async()=>{
 const worker=createChatTranscription({supabase:{},env:{}});assert.equal(worker.enabled,false);assert.deepEqual(await worker.enqueue('message'),{status:'unavailable'});worker.stop();
});
test('reopening a conversation restores completed text, preserves current text and respects withdrawal',async()=>{
 const rows=[
  {id:'voice',content:JSON.stringify({media:{kind:'audio',storage_path:'chat/a.webm'}})},
  {id:'current',content:JSON.stringify({kind:'audio',transcript:'already persisted'})},
  {id:'withdrawn',content:JSON.stringify({kind:'audio',withdrawn:true})},
  {id:'text',content:JSON.stringify({text:'hello'})}
 ];
 let queried=0;
 const supabase={from(table){assert.equal(table,'chat_transcription_jobs');queried++;return {
  select(){return this;},in(key,ids){assert.equal(key,'message_id');assert.deepEqual(ids,['voice']);return this;},
  eq(key,value){assert.equal(key,'status');assert.equal(value,'completed');return Promise.resolve({data:[{message_id:'voice',transcript:'saved words'}]});}
 };}};
 const worker=createChatTranscription({supabase,env:{}});
 await worker.restore(rows);
 assert.equal(JSON.parse(rows[0].content).transcript,'saved words');
 assert.equal(JSON.parse(rows[1].content).transcript,'already persisted');
 assert.equal(JSON.parse(rows[2].content).transcript,undefined);
 assert.equal(JSON.parse(rows[3].content).transcript,undefined);assert.equal(queried,1);
});
test('a queue outage does not turn readable messages into a load failure',async()=>{
 const rows=[{id:'voice',content:JSON.stringify({kind:'audio',text:'caption'})}];
 const supabase={from(){return {select(){return this;},in(){return this;},eq(){return Promise.resolve({error:{message:'offline'}});}};}};
 const worker=createChatTranscription({supabase,env:{}});
 assert.equal(await worker.restore(rows),rows);assert.equal(JSON.parse(rows[0].content).text,'caption');
});
