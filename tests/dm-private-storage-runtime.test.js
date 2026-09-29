'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDmPrivateStorage, dmStorageBucket } = require('../render-api/dm-private-storage');
const { verifyStorageObject } = require('../render-api/dm-media');
const path = 'chat/abcdef123456_private_12345_voice.webm';
test('private attachment signing refreshes only authorized response rows and coalesces repeated paths', async () => {
  let calls = 0;
  const media = createDmPrivateStorage({ storage: { from(bucket) { assert.equal(bucket, 'dm-private'); return { async createSignedUrl(p, ttl) { calls++; assert.equal(p,path); assert.equal(ttl,3600); return {data:{signedUrl:'https://example.com/signed'}}; } }; } } });
  const payload = {text:'voice',media:{bucket:'dm-private',storage_path:path,url:'expired'}};
  const body = {ok:true,data:[{content:JSON.stringify(payload)}],items:[{payload}],message:{content:JSON.stringify(payload)}};
  await media.hydrateBody(body);
  assert.equal(calls,1); assert.equal(JSON.parse(body.data[0].content).media.url,'https://example.com/signed');
  assert.equal(body.items[0].payload.media.url,'https://example.com/signed');
  await media.hydrateBody({ok:false,items:[{payload}]}); assert.equal(calls,1);
  await assert.rejects(media.sign('chat/other/public.webm'),/invalid_private_path/);
  await assert.rejects(media.sign('chat/abcdef123456_private_../voice.webm'),/invalid_private_path/);
  assert.equal(dmStorageBucket('chat/legacy.jpg'),'uploads');
});
test('private signing fails closed instead of falling back to public URLs', async () => {
  const media = createDmPrivateStorage({storage:{from(){return{async createSignedUrl(){return{error:{message:'offline'}};}};}}});
  await assert.rejects(media.hydrateBody({ok:true,data:[{content:JSON.stringify({media:{bucket:'dm-private',storage_path:path}})}]}),/private_media_sign_failed/);
});
test('document registry verification accepts the restricted MIME set and uses the private bucket', async () => {
  const supabase = {storage:{from(bucket){assert.equal(bucket,'dm-private');return{async list(){return{data:[{name:'abcdef123456_private_12345_file.pdf',metadata:{size:9,mimetype:'application/pdf'}}]};}};}}};
  const valid=await verifyStorageObject(supabase,'chat/abcdef123456_private_12345_file.pdf',{kind:'file',mimeType:'application/pdf',sizeBytes:9});
  assert.equal(valid.ok,true);
  const bad={storage:{from(){return{async list(){return{data:[{name:'abcdef123456_private_12345_file.pdf',metadata:{size:9,mimetype:'text/html'}}]};}};}}};
  assert.equal((await verifyStorageObject(bad,'chat/abcdef123456_private_12345_file.pdf',{kind:'file',mimeType:'text/html',sizeBytes:9})).ok,false);
});
