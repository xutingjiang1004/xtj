'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), express = require('express'), request = require('supertest'), sharp = require('sharp');
const { createMediaPreviews, sourceInfo } = require('../render-api/media-previews');
const { createPhotoAccess, PHOTO_BUCKET } = require('../render-api/photo-access');
const { createMediaTraffic } = require('../render-api/media-traffic');
const { EventEmitter } = require('node:events');
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
  await assert.rejects(()=>p.stream({headers:{},method:'GET'}, new EventEmitter(),{bucket:PHOTO_BUCKET,path:'photos/huge.jpg'}),/unsupported/);assert.equal(calls,0);
});

function previewRequest(previews,path) {
  const res=new EventEmitter();Object.assign(res,{destroyed:false,set(){return this},status(){return this},type(){return this},end(body){this.body=body;return this}});
  const done=previews.stream({headers:{},method:'GET'},res,{bucket:PHOTO_BUCKET,path});
  return {res,done,close(){res.destroyed=true;res.emit('close')}};
}
async function cancellablePreviews(){
  const input=await sharp({create:{width:20,height:10,channels:3,background:'#78bba4'}}).jpeg().toBuffer();
  const started=[],aborted=[],releases=new Map();let encodes=0,disposed=false;
  const supabase={storage:{from:()=>({info:async()=>({data:{size:input.length,etag:'version',content_type:'image/jpeg'}}),createSignedUrl:async path=>({data:{signedUrl:path}})})}};
  const fetchImpl=(path,{signal})=>new Promise((resolve,reject)=>{
    started.push(path);
    if(disposed){resolve(new Response(input,{headers:{ETag:'"version"'}}));return;}
    const cancel=()=>{aborted.push(path);reject(new DOMException('Cancelled','AbortError'))};
    signal.addEventListener('abort',cancel,{once:true});
    releases.set(path,()=>{signal.removeEventListener('abort',cancel);resolve(new Response(input,{headers:{ETag:'"version"'}}))});
  });
  const previews=createMediaPreviews({supabase,sharp:(...args)=>{encodes++;return sharp(...args)},fetchImpl});
  return {previews,started,aborted,releases,cleanup(){disposed=true;for(const release of releases.values())release()},get encodes(){return encodes}};
}
const flush=()=>new Promise(setImmediate);
test('closing a queued preview removes its job without downloading its original',async t=>{
  const f=await cancellablePreviews();t.after(()=>f.cleanup());const first=previewRequest(f.previews,'photos/first.jpg');await flush();
  const abandoned=previewRequest(f.previews,'photos/abandoned.jpg');await flush();
  assert.equal(f.previews.inspect().queued,1);abandoned.close();await flush();
  assert.equal(f.previews.inspect().queued,0,'a cancelled tile must not occupy the decoder queue');
  f.releases.get('photos/first.jpg')();await Promise.all([first.done,abandoned.done]);
  assert.deepEqual(f.started,['photos/first.jpg']);assert.equal(f.encodes,1);assert.equal(abandoned.res.body,undefined);
});
test('abandoning an active preview aborts its source download and frees the queue',async t=>{
  const f=await cancellablePreviews();t.after(()=>f.cleanup());const first=previewRequest(f.previews,'photos/abandoned.jpg');await flush();
  const next=previewRequest(f.previews,'photos/next.jpg');await flush();
  first.close();await flush();
  assert.deepEqual(f.aborted,['photos/abandoned.jpg']);assert.deepEqual(f.started,['photos/abandoned.jpg','photos/next.jpg']);
  f.releases.get('photos/next.jpg')();await Promise.all([first.done,next.done]);
  assert.equal(f.encodes,1);assert.equal(f.previews.inspect().pending,0);
});
test('coalesced preview clients share one download and cancellation only stops it after the last client leaves',async t=>{
  const f=await cancellablePreviews();t.after(()=>f.cleanup());const a=previewRequest(f.previews,'photos/shared.jpg'),b=previewRequest(f.previews,'photos/shared.jpg');await flush();
  a.close();await flush();assert.deepEqual(f.aborted,[]);assert.equal(f.started.length,1);
  f.releases.get('photos/shared.jpg')();await Promise.all([a.done,b.done]);
  assert.equal(a.res.body,undefined);assert.equal((await sharp(b.res.body).metadata()).format,'webp');assert.equal(f.encodes,1);
});
test('the last departing coalesced client cancels the original and a later request can retry normally',async t=>{
  const f=await cancellablePreviews();t.after(()=>f.cleanup());const a=previewRequest(f.previews,'photos/shared.jpg'),b=previewRequest(f.previews,'photos/shared.jpg');await flush();
  a.close();b.close();await Promise.all([a.done,b.done]);await flush();assert.deepEqual(f.aborted,['photos/shared.jpg']);
  const retry=previewRequest(f.previews,'photos/shared.jpg');await flush();f.releases.get('photos/shared.jpg')();await retry.done;
  assert.equal(f.started.length,2);assert.equal(f.encodes,1);assert.ok(retry.res.body.length>0);
});
test('queued previews expire without waiting for another image to finish encoding',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const input=await sharp({create:{width:20,height:10,channels:3,background:'#78bba4'}}).jpeg().toBuffer();
  let release,started,downloads=0;const gate=new Promise(resolve=>release=resolve),encoding=new Promise(resolve=>started=resolve);t.after(()=>release());
  const supabase={storage:{from:()=>({info:async()=>({data:{size:input.length,etag:'version',content_type:'image/jpeg'}}),createSignedUrl:async path=>({data:{signedUrl:path}})})}};
  const previews=createMediaPreviews({supabase,fetchImpl:async()=>{downloads++;return new Response(input,{headers:{ETag:'"version"'}})},sharp:(...args)=>{
    const image=sharp(...args),toBuffer=image.toBuffer.bind(image);image.toBuffer=async()=>{started();await gate;return toBuffer()};return image;
  }});
  const first=previewRequest(previews,'photos/encoding.jpg');await encoding;
  const queued=previewRequest(previews,'photos/queued.jpg'),expired=assert.rejects(queued.done,/preview_busy/);await flush();
  t.mock.timers.tick(30001);await expired;
  assert.equal(downloads,1);assert.equal(previews.inspect().queued,0);
  release();await first.done;
});
test('returning during a cancelled encode reuses its finished preview instead of downloading the original twice',async t=>{
  const input=await sharp({create:{width:20,height:10,channels:3,background:'#78bba4'}}).jpeg().toBuffer();
  let release,started,downloads=0,encodes=0;const gate=new Promise(resolve=>release=resolve),encoding=new Promise(resolve=>started=resolve);t.after(()=>release());
  const supabase={storage:{from:()=>({info:async()=>({data:{size:input.length,etag:'version',content_type:'image/jpeg'}}),createSignedUrl:async path=>({data:{signedUrl:path}})})}};
  const previews=createMediaPreviews({supabase,fetchImpl:async()=>{downloads++;return new Response(input,{headers:{ETag:'"version"'}})},sharp:(...args)=>{
    const image=sharp(...args),toBuffer=image.toBuffer.bind(image);image.toBuffer=async()=>{encodes++;started();await gate;return toBuffer()};return image;
  }});
  const first=previewRequest(previews,'photos/return.jpg');await encoding;first.close();await first.done;
  const retry=previewRequest(previews,'photos/return.jpg');await flush();release();await retry.done;
  assert.equal(downloads,1);assert.equal(encodes,1);assert.equal(first.res.body,undefined);
  assert.equal((await sharp(retry.res.body).metadata()).format,'webp');
});
test('a real HTTP client disconnect stops an original whose body is only partially received', {timeout:5000}, async t=>{
  const http=require('node:http'),input=await sharp({create:{width:20,height:10,channels:3,background:'#78bba4'}}).jpeg().toBuffer();
  let sourceStarted,sourceClosed,origin,previews;
  const started=new Promise(resolve=>sourceStarted=resolve),closed=new Promise(resolve=>sourceClosed=resolve);
  const app=express();
  app.get('/source/:name',(req,res)=>{
    res.set({'Content-Type':'image/jpeg','Content-Length':String(input.length),ETag:'"version"'});
    if(req.params.name==='cancel.jpg'){res.on('close',sourceClosed);res.write(input.subarray(0,5));sourceStarted();}
    else res.end(input);
  });
  app.get('/display/:name',async(req,res)=>{
    try { await previews.stream(req,res,{bucket:PHOTO_BUCKET,path:req.params.name}); }
    catch (_) { if(!res.destroyed)res.status(503).end(); }
  });
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  origin='http://127.0.0.1:'+server.address().port;
  const supabase={storage:{from:()=>({info:async()=>({data:{size:input.length,etag:'version',content_type:'image/jpeg'}}),createSignedUrl:async path=>({data:{signedUrl:origin+'/source/'+path}})})}};
  previews=createMediaPreviews({supabase,sharp});
  const controller=new AbortController(),reading=fetch(origin+'/display/cancel.jpg',{signal:controller.signal});
  await started;controller.abort();await assert.rejects(reading,/abort/i);await closed;
  const next=await fetch(origin+'/display/next.jpg');assert.equal(next.status,200);
  assert.equal((await sharp(Buffer.from(await next.arrayBuffer())).metadata()).format,'webp');
  assert.equal(previews.inspect().pending,0);
});
