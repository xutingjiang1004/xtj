'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), express = require('express'), request = require('supertest'), sharp = require('sharp');
const { createMediaPreviews, sourceInfo } = require('../render-api/media-previews');
const { createPhotoAccess, PHOTO_BUCKET } = require('../render-api/photo-access');
const { createMediaTraffic } = require('../render-api/media-traffic');
const A='11111111-1111-4111-8111-111111111111', origin='https://project.supabase.test';
async function fixture() {
  const input = await sharp({ create:{ width:2800,height:1800,channels:3,background:'#78bba4' } }).jpeg({quality:98}).toBuffer();
  let body=input, unavailable=false, downloads=0, probes=0;
  const row={id:A,user_name:'owner',media_type:'__photo_wall__',media_url:origin+'/storage/v1/object/public/photo-wall/photos/a.jpg',content:'{}',visibility:'public'};
  const tag=()=>crypto.createHash('md5').update(body).digest('hex');
  const db={from(table){const q={select(){return q},eq(){return q},in(){return q},order(){return q},maybeSingle:async()=>unavailable?{error:Error('quota')}:{data:row},then(resolve,reject){return Promise.resolve(unavailable?{error:Error('quota')}:{data:table==='posts'?[row]:[]}).then(resolve,reject)}};return q},
    storage:{from(bucket){return {
      exists:async()=>({data:bucket===PHOTO_BUCKET}),
      info:async()=>{probes++;return unavailable?{error:Error('quota')}:{data:{size:body.length,etag:tag(),content_type:'image/jpeg'}}},
      createSignedUrl:async path=>({data:{signedUrl:origin+'/'+bucket+'/'+path}})
    };}}};
  const fetchImpl=async()=>{downloads++;return new Response(body,{headers:{'Content-Type':'image/jpeg','Content-Length':body.length,ETag:'"'+tag()+'"'}})};
  const traffic=createMediaTraffic(), create=()=>createMediaPreviews({supabase:db,sharp,fetchImpl,traffic});
  let previews=create();
  const delegate={stream:(...args)=>previews.stream(...args)};
  const app=express();app.use(express.json());
  const auth=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).end();req.userName=req.headers.authorization;next()};
  createPhotoAccess({app,supabase:db,supabaseUrl:origin,secret:'local-test',authenticateUser:auth,optionalAuth:(req,res,next)=>{req.userName=req.headers.authorization;next()},rateLimit:()=> (req,res,next)=>next(),previews:delegate,fetchImpl});
  return {app,input,row,db,traffic,get previews(){return previews},replacePreviewProcess(){previews=create()},get downloads(){return downloads},get probes(){return probes},setBody:b=>body=b,fail:v=>unavailable=v};
}
test('high-quality display copies preserve originals, bound dimensions and share a single cold download',async()=>{
  const f=await fixture(), route='/api/photo/'+A+'/media?preview=1';
  await request(f.app).get(route).expect(401);assert.equal(f.downloads,0);
  const [a,b]=await Promise.all([request(f.app).get(route).set('Authorization','reader'),request(f.app).get(route).set('Authorization','reader')]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(f.downloads,1);
  const meta=await sharp(a.body).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,1920);assert.ok(meta.height>1000);
  assert.equal(a.headers.etag,b.headers.etag);assert.equal(a.headers['cache-control'],'private, no-cache, must-revalidate');
  const decoded=await sharp(a.body).raw().toBuffer();assert.ok(Math.abs(decoded[0]-0x78)<8&&Math.abs(decoded[1]-0xbb)<8&&Math.abs(decoded[2]-0xa4)<8,'preview retains the source colors');
  const original=await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','reader').expect(200);assert.deepEqual(original.body,f.input);
  const before=f.downloads;await request(f.app).get(route).set('Authorization','reader').expect(200);assert.equal(f.downloads,before);
  assert.ok(f.previews.inspect().bytes<=24*1024*1024);
});
test('validators survive preview-process restart but never outlive fresh permissions, source versions or database availability',async()=>{
  const f=await fixture(), route='/api/photo/'+A+'/media?preview=1';
  const first=await request(f.app).get(route).set('Authorization','reader').expect(200), before=f.downloads;
  f.replacePreviewProcess();await request(f.app).get(route).set('Authorization','reader').set('If-None-Match',first.headers.etag).expect(304);assert.equal(f.downloads,before);
  f.row.visibility='private';await request(f.app).get(route).set('Authorization','reader').set('If-None-Match',first.headers.etag).expect(404);assert.equal(f.downloads,before);
  f.row.visibility='public';f.row.is_deleted=true;await request(f.app).get(route).set('Authorization','reader').set('If-None-Match',first.headers.etag).expect(404);
  f.row.is_deleted=false;f.fail(true);await request(f.app).get(route).set('Authorization','reader').set('If-None-Match',first.headers.etag).expect(503);assert.equal(f.downloads,before);
  f.fail(false);f.setBody(await sharp({create:{width:400,height:300,channels:3,background:'#164a73'}}).jpeg().toBuffer());
  const changed=await request(f.app).get(route).set('Authorization','reader').set('If-None-Match',first.headers.etag).expect(200);assert.notEqual(changed.headers.etag,first.headers.etag);
  assert.equal((await sharp(changed.body).metadata()).width,400,'small originals are not enlarged');
});
test('fresh upload metadata and display copies reuse received bytes without a Storage body download',async()=>{
  const f=await fixture(), metadata=await sharp(f.input).metadata();
  await f.previews.rememberUpload({bucket:PHOTO_BUCKET,path:'photos/a.jpg',owner:'owner',input:f.input,metadata});
  const info=await f.previews.inspectedUpload(PHOTO_BUCKET,'photos/a.jpg','owner');assert.equal(info.fileSize,f.input.length);assert.equal(info.width,2800);
  assert.equal(await f.previews.inspectedUpload(PHOTO_BUCKET,'photos/a.jpg','another'),null);
  await request(f.app).get('/api/photo/'+A+'/media?preview=1').set('Authorization','reader').expect(200);assert.equal(f.downloads,0);
  f.fail(true);await assert.rejects(()=>f.previews.inspectedUpload(PHOTO_BUCKET,'photos/a.jpg','owner'),error=>error.transient===true);f.fail(false);
  f.setBody(Buffer.from('replaced'));assert.equal(await f.previews.inspectedUpload(PHOTO_BUCKET,'photos/a.jpg','owner'),null);
});
test('a shared preview is bound to the exact live grant and still opens the separate original URL',async()=>{
  const f=await fixture();
  const share=await request(f.app).post('/api/photo/share').set('Authorization','owner').send({photo_ids:[A]}).expect(200);
  const token=share.body.share_path.split('/').at(-1),route='/api/photo/shared/'+token+'/'+A+'/media?preview=1';
  const first=await request(f.app).get(route).expect(200);
  const page=await request(f.app).get(share.body.share_path).expect(200);assert.match(page.text,/data-original=/);assert.match(page.text,/preview=1/);
  f.row.visibility='private';await request(f.app).get(route).set('If-None-Match',first.headers.etag).expect(404);
});
test('metadata accepts SDK info shapes; oversized, active content and inconsistent bodies fail without an original fallback',async()=>{
  assert.deepEqual(sourceInfo({metadata:{eTag:'"abc"',size:12,mimetype:'image/png'}}),{tag:'abc',size:12,type:'image/png'});
  let calls=0;const db={storage:{from:()=>({info:async()=>({data:{size:51*1024*1024,etag:'version',content_type:'image/jpeg'}})})}};
  const p=createMediaPreviews({supabase:db,sharp,fetchImpl:async()=>{calls++;throw Error('unexpected')}});
  await assert.rejects(()=>p.stream({headers:{},method:'GET'}, {},{bucket:PHOTO_BUCKET,path:'photos/huge.jpg'}),/unsupported/);assert.equal(calls,0);
});
