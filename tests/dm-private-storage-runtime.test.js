'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDmPrivateStorage, dmStorageBucket } = require('../render-api/dm-private-storage');
const { verifyStorageObject } = require('../render-api/dm-media');
const express = require('express'), request = require('supertest');
const path = 'chat/abcdef123456_private_12345_voice.webm';
test('loaded historical message synchronization renews authorized private attachments without signing failed responses', async () => {
  const signed = [], media = createDmPrivateStorage({ storage: { from(bucket) {
    return { async createSignedUrl(storagePath) { signed.push({ bucket, storagePath }); return { data: { signedUrl: 'https://storage.example/renewed-history' } }; } };
  } } });
  const app = express(); app.use(express.json()); app.use(media.middleware);
  app.post('/api/dm/messages/loaded', (req, res) => {
    if (req.headers.authorization !== 'Bearer isolated-test') return res.status(401).json({ ok: false });
    res.json({ ok: true, data: [{ id: 'history-message', content: JSON.stringify({ text: '历史语音', transcript: '保留的转写',
      media: { kind: 'audio', bucket: 'dm-private', storage_path: path, url: 'https://storage.example/expired' } }) }] });
  });
  await request(app).post('/api/dm/messages/loaded').send({ ids: ['history-message'] }).expect(401);
  assert.equal(signed.length, 0);
  const response = await request(app).post('/api/dm/messages/loaded').set('Authorization', 'Bearer isolated-test').send({ ids: ['history-message'] }).expect(200);
  const payload = JSON.parse(response.body.data[0].content);
  assert.equal(payload.media.url, 'https://storage.example/renewed-history');
  assert.equal(payload.transcript, '保留的转写');
  assert.deepEqual(signed, [{ bucket: 'dm-private', storagePath: path }]);
});
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
  const body={ok:true,data:[{content:JSON.stringify({transcript:'saved words',media:{bucket:'dm-private',storage_path:path,url:'https://public.invalid/voice'}})}]};
  await media.hydrateBody(body);
  const payload=JSON.parse(body.data[0].content);
  assert.equal(body.ok,true);assert.equal(payload.transcript,'saved words');assert.equal(payload.media.url,'');assert.equal(payload.media.unavailable,true);
});
test('legacy uploads attachments are renewed through the private bucket boundary', async () => {
  const signed = [], media = createDmPrivateStorage({ storage: { from(bucket) {
    return { async createSignedUrl(path) { signed.push({ bucket, path }); return { data: { signedUrl: 'https://storage.example/private-legacy' } }; } };
  } } }, { supabaseUrl: 'https://project.supabase.co' });
  const body = { ok: true, data: [{ actor_key: '__dm_aud__chat/legacy.m4a', content: JSON.stringify({
    transcript: 'saved words', media: { kind: 'audio', url: 'https://project.supabase.co/storage/v1/object/public/uploads/chat/legacy.m4a' }
  }) }] };
  await media.hydrateBody(body);
  assert.deepEqual(signed, [{ bucket: 'uploads', path: 'chat/legacy.m4a' }]);
  assert.equal(JSON.parse(body.data[0].content).media.url, 'https://storage.example/private-legacy');
  assert.equal(JSON.parse(body.data[0].content).transcript, 'saved words');
  const invalid = { ok: true, data: [{ actor_key: '__dm_aud__chat/legacy.m4a', content: JSON.stringify({
    media: { url: 'https://attacker.example/storage/v1/object/public/uploads/chat/legacy.m4a' }
  }) }] };
  await media.hydrateBody(invalid); assert.equal(signed.length, 1);
  assert.equal(JSON.parse(invalid.data[0].content).media.url, '');
  const plain = { ok: true, data: [{ actor_key: '__dm_aud__chat/legacy.m4a', content: 'original caption' }] };
  await media.hydrateBody(plain);
  const legacy = JSON.parse(plain.data[0].content);
  assert.equal(legacy.text, 'original caption'); assert.equal(legacy.media.kind, 'audio');
  assert.equal(legacy.media.url, 'https://storage.example/private-legacy');
  for (const content of ['123','null','[]','{"text":"JSON caption"}']) {
    const row={actor_key:'__dm_img__chat/legacy.jpg',content};await media.hydrateMessage(row);
    const hydrated=JSON.parse(row.content);assert.equal(hydrated.media.url,'https://storage.example/private-legacy');
    assert.equal(hydrated.text,content.startsWith('{')?'JSON caption':content);
  }
  const before=signed.length,withdrawn={actor_key:'__dm_img__chat/withdrawn.jpg',content:'{"withdrawn":true,"text":""}'};
  await media.hydrateMessage(withdrawn);assert.equal(signed.length,before);assert.equal(JSON.parse(withdrawn.content).media,undefined);
});
test('document registry verification accepts the restricted MIME set and uses the private bucket', async () => {
  const supabase = {storage:{from(bucket){assert.equal(bucket,'dm-private');return{async list(){return{data:[{name:'abcdef123456_private_12345_file.pdf',metadata:{size:9,mimetype:'application/pdf'}}]};}};}}};
  const valid=await verifyStorageObject(supabase,'chat/abcdef123456_private_12345_file.pdf',{kind:'file',mimeType:'application/pdf',sizeBytes:9});
  assert.equal(valid.ok,true);
  const bad={storage:{from(){return{async list(){return{data:[{name:'abcdef123456_private_12345_file.pdf',metadata:{size:9,mimetype:'text/html'}}]};}};}}};
  assert.equal((await verifyStorageObject(bad,'chat/abcdef123456_private_12345_file.pdf',{kind:'file',mimeType:'text/html',sizeBytes:9})).ok,false);
});
