'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express'), request = require('supertest');
const { createHash } = require('node:crypto');
const { PHOTO_BUCKET, PHOTO_COOKIE, POST_MEDIA_COOKIE, createPhotoAccess, shareCodec, photoPayload, setPhotoSession, protectPhotoPath, migratePhotoStorage } = require('../render-api/photo-access');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const origin = 'https://example.supabase.co';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxkAAAAASUVORK5CYII=','base64');
function fixture() {
  const photos = [A,B,C].map((id,i) => ({ id,user_name:'owner',media_type:'__photo_wall__',media_url:origin+'/storage/v1/object/public/uploads/photos/'+i+'.png',visibility:'public',content:JSON.stringify({caption:'作者的照片 '+i,storagePath:'photos/'+i+'.png',thumb:origin+'/storage/v1/object/public/uploads/thumbs/'+i+'.png'}),created_at:'2026-10-07T00:00:00Z' }));
  const publicPost = {id:'55555555-5555-4555-8555-555555555555',user_name:'owner',media_type:'album',media_url:origin+'/storage/v1/object/public/uploads/posts/one.png',visibility:'public',content:'公开帖子'};
  const attachments = [{post_id:publicPost.id,position:0,media_type:'image',media_url:publicPost.media_url}, {post_id:publicPost.id,position:1,media_type:'image',media_url:origin+'/storage/v1/object/public/uploads/posts/two.png'}];
  const rows = [...photos,publicPost], objects = new Map(), storageCalls = [], reads = [], downloads = [];
  for (let i=0;i<3;i++) { objects.set('uploads/photos/'+i+'.png',png); objects.set('uploads/thumbs/'+i+'.png',png); }
  objects.set('uploads/posts/one.png',png); objects.set('uploads/posts/two.png',png);
  let dbFailed = false, moveFailed = false, active = true, mimeType = 'image/png', dbDelay = 0, attachmentGate = null;
  async function result(data,table) { reads.push(table); if(dbDelay)await new Promise(resolve=>setTimeout(resolve,dbDelay));if(table==='post_attachments'&&attachmentGate)await attachmentGate;return {data,error:dbFailed?Error('db'):null}; }
  const supabase = {
    from(table) {
      let filtered = table === 'post_attachments' ? attachments.slice() : rows.slice();
      const q = { select(){return this;}, eq(k,v){filtered=filtered.filter(row=>row[k]===v);return this;}, in(k,values){filtered=filtered.filter(row=>values.includes(row[k]));return this;}, order(){return this;},
        maybeSingle:()=>result(filtered[0] || null,table), then(resolve,reject){return result(filtered,table).then(resolve,reject);} };
      return q;
    },
    storage:{from(bucket) {
      return {
        async exists(path) {storageCalls.push(['exists',bucket,path]);const present=objects.has(bucket+'/'+path);return {data:present,error:present?null:{status:404}};},
        async info(path) {const value=objects.get(bucket+'/'+path);return value?{data:{size:value.length},error:null}:{error:Error('not found')};},
        async download(path) {const value=objects.get(bucket+'/'+path);return value?{data:new Blob([value]),error:null}:{error:Error('not found')};},
        async move(path,dest,options) {storageCalls.push(['move',bucket,path,options.destinationBucket]);if(moveFailed)return {error:Error('move')};const value=objects.get(bucket+'/'+path);if(!value || objects.has(options.destinationBucket+'/'+dest))return {error:Error('exists')};objects.set(options.destinationBucket+'/'+dest,value);objects.delete(bucket+'/'+path);return {data:{},error:null};},
        async remove(paths) {storageCalls.push(['remove',bucket,paths]);paths.forEach(path=>objects.delete(bucket+'/'+path));return {data:paths.map(name=>({name})),error:null};},
        async list(folder,options={}) {const prefix=bucket+'/'+folder+'/',entries=new Map();for(const key of objects.keys()){if(!key.startsWith(prefix))continue;const rest=key.slice(prefix.length),name=rest.split('/')[0];entries.set(name,{name,id:rest.includes('/')?null:key});}const data=Array.from(entries.values()).sort((a,b)=>a.name.localeCompare(b.name));return {data:data.slice(options.offset||0,(options.offset||0)+(options.limit||100)),error:null};},
        async createSignedUrl(path) {storageCalls.push(['sign',bucket,path]);return {data:{signedUrl:'https://internal-storage.test/'+bucket+'/'+path},error:null};}
      };
    }}
  };
  const app = express(); app.use(express.json());
  app.use((req,res,next)=>{req.cookies=Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(pair=>{const i=pair.indexOf('=');return [pair.slice(0,i).trim(),pair.slice(i+1).trim()];}));next();});
  const authenticateUser=(req,res,next)=>{const token=String(req.headers.authorization || '').replace('Bearer ','');if(!['owner','other','xxz'].includes(token))return res.status(401).json({ok:false,code:'auth_expired'});req.userName=token;next();};
  const optionalAuth=(req,res,next)=>{const token=String(req.headers.authorization || '').replace('Bearer ','');if(['owner','other','xxz'].includes(token))req.userName=token;next();};
  const verifyToken=(req,res,next)=>{if(req.cookies.xtj_admin_token!=='admin')return res.status(401).end();req.adminName='xxz';next();};
  const api = createPhotoAccess({app,supabase,supabaseUrl:origin,secret:'test-only-shared-secret',authenticateUser,optionalAuth,verifyToken,rateLimit:()=>((req,res,next)=>next()),activeSession:async(id,actor)=>active&&id===SESSION&&actor==='owner',
    fetchImpl:async(url,options)=>{
      const u=new URL(url),value=objects.get(decodeURIComponent(u.pathname.slice(1)));if(!value)return new Response(null,{status:404});
      downloads.push({path:u.pathname,headers:{...options.headers},method:options.method});
      const etag='"'+createHash('sha256').update(value).digest('hex')+'"',modified='Wed, 07 Oct 2026 00:00:00 GMT';
      let bytes=value,status=200,headers={'Content-Type':mimeType,'Content-Length':String(value.length),'Accept-Ranges':'bytes',ETag:etag,'Last-Modified':modified};
      if(!options.headers.Range&&(options.headers['If-None-Match']===etag||(!options.headers['If-None-Match']&&options.headers['If-Modified-Since']===modified)))return new Response(null,{status:304,headers:{ETag:etag,'Last-Modified':modified}});
      if(options.headers.Range&&(!options.headers['If-Range']||options.headers['If-Range']===etag)){const [,start,end]=options.headers.Range.match(/^bytes=(\d+)-(\d*)$/) || [];const a=Number(start),b=end?Number(end):value.length-1;bytes=value.subarray(a,b+1);status=206;headers['Content-Range']=`bytes ${a}-${b}/${value.length}`;headers['Content-Length']=String(bytes.length);}
      return new Response(options.method==='HEAD'?null:bytes,{status,headers});
    }});
  return {app,api,photos,publicPost,objects,storageCalls,reads,downloads,supabase,setAttachmentGate(v){attachmentGate=v;},setDbDelay(v){dbDelay=v;},setDbFailed(v){dbFailed=v;},setMoveFailed(v){moveFailed=v;},setActive(v){active=v;},setMime(v){mimeType=v;}};
}
function body(response) { return Buffer.isBuffer(response.body)?response.body:Buffer.from(response.text || ''); }

test('wall bytes deny anonymous/forged requests and preserve authenticated original bytes, HEAD and range',async()=>{
  const f=fixture();await request(f.app).get('/api/photo/'+A+'/media').expect(401);assert.equal(f.storageCalls.length,0);
  await request(f.app).get('/api/photo/'+A+'/media?user_name=owner').set('Authorization','Bearer forged').expect(401);
  const response=await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer other').expect(200);
  assert.deepEqual(body(response),png);assert.equal(response.headers['cache-control'],'private, no-cache, must-revalidate');assert.equal(f.objects.has('uploads/photos/0.png'),false);assert.deepEqual(f.objects.get(PHOTO_BUCKET+'/photos/0.png'),png);
  const head=await request(f.app).head('/api/photo/'+A+'/media').set('Authorization','Bearer other').expect(200);assert.equal(head.headers['content-length'],String(png.length));
  const range=await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer other').set('Range','bytes=0-3').expect(206);assert.deepEqual(body(range),png.subarray(0,4));
  await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer other').set('Range','bytes=0-3,8-10').expect(416);
});
test('media cookies bind to active login sessions; revoked and late old cookies cannot regain access',async()=>{
  const f=fixture(),cookie=PHOTO_COOKIE+'=owner~'+SESSION;
  await request(f.app).get('/api/photo/'+A+'/media').set('Cookie',cookie).expect(200);
  f.setActive(false);await request(f.app).get('/api/photo/'+A+'/media').set('Cookie',cookie).expect(401);
  await request(f.app).get('/api/photo/'+A+'/media').set('Cookie',PHOTO_COOKIE+'=owner').expect(401);
  f.photos[0].visibility='private';await request(f.app).get('/api/photo/'+A+'/media').set('Cookie','xtj_admin_token=admin').expect(200);
  const cookies=[];setPhotoSession({cookie:(name,value,opts)=>cookies.push({name,value,opts})},'access-token',Date.now()+10000,SESSION);
  assert.equal(cookies.length,3);assert.ok(cookies.every(c=>c.opts.httpOnly&&c.opts.secure&&c.opts.sameSite==='Lax'));assert.deepEqual(cookies.map(c=>c.opts.path),['/api/photo','/api/post','/api/uploads']);
});
test('accepted TIFF MIME remains readable while active SVG content is refused',async()=>{
  const f=fixture();f.setMime('image/tif');
  const response=await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer owner').expect(200);
  assert.equal(response.headers['content-type'],'image/tif');assert.deepEqual(body(response),png);
  const shared=await request(f.app).post('/api/photo/share').set('Authorization','Bearer owner').send({photo_ids:[A]}).expect(200),token=shared.body.share_path.split('/').at(-1);
  assert.deepEqual(body(await request(f.app).get('/api/photo/shared/'+token+'/'+A+'/media').expect(200)),png);
  f.setMime('image/svg+xml');await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer owner').expect(503);
});
test('website share grants exactly selected photos; tampering or substituting another ID cannot enumerate the wall',async()=>{
  const f=fixture();await request(f.app).post('/api/photo/share').send({photo_ids:[A]}).expect(401);
  const shared=await request(f.app).post('/api/photo/share').set('Authorization','Bearer other').send({photo_ids:[A,B]}).expect(200);
  assert.match(shared.body.share_path,/^\/share\/photos\/[A-Za-z0-9_-]+$/);assert.equal(shared.body.photo_count,2);assert.doesNotMatch(shared.body.share_path,/supabase|11111111/);
  const token=shared.body.share_path.split('/').at(-1),page=await request(f.app).get(shared.body.share_path).expect(200);
  assert.ok(page.text.includes(A)&&page.text.includes(B));assert.ok(!page.text.includes(C));assert.doesNotMatch(page.text,/storage\/v1|storagePath/);assert.match(page.text,/XTJ.*照片分享/);
  for(const id of [A,B])assert.deepEqual(body(await request(f.app).get('/api/photo/shared/'+token+'/'+id+'/media').expect(200)),png);
  await request(f.app).get('/api/photo/shared/'+token+'/'+C+'/media').expect(404);
  const changed=(token[0]==='a'?'b':'a')+token.slice(1);await request(f.app).get('/api/photo/shared/'+changed+'/'+A+'/media').expect(404);
  await request(f.app).get('/api/photo/'+C+'/media').expect(401);
  f.photos[0].visibility='private';await request(f.app).get('/api/photo/shared/'+token+'/'+A+'/media').expect(404);
  f.photos[1].is_deleted=true;await request(f.app).get('/api/photo/shared/'+token+'/'+B+'/media').expect(404);
});
test('private, deleted, wrong-type and unknown photos fail closed; private shares require their author',async()=>{
  const f=fixture();f.photos[0].visibility='private';
  await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer other').expect(404);
  await request(f.app).post('/api/photo/share').set('Authorization','Bearer other').send({photo_ids:[A]}).expect(404);
  const shared=await request(f.app).post('/api/photo/share').set('Authorization','Bearer owner').send({photo_ids:[A]}).expect(200),token=shared.body.share_path.split('/').at(-1);
  await request(f.app).get('/api/photo/shared/'+token+'/'+A+'/media').expect(200);f.photos[0].user_name='other';await request(f.app).get('/api/photo/shared/'+token+'/'+A+'/media').expect(404);
  for(const patch of [{is_deleted:true},{media_type:'__dm__'},{media_url:'__deleted__'},{content:'{"__pw_del__":true}'}]) {Object.assign(f.photos[1],{is_deleted:false,media_type:'__photo_wall__',media_url:origin+'/storage/v1/object/public/uploads/photos/1.png',content:'{}'},patch);await request(f.app).get('/api/photo/'+B+'/media').set('Authorization','Bearer owner').expect(404);}
  f.setDbFailed(true);await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer owner').expect(503);
});
test('share expiry and metadata projection never expose reusable storage originals or derivatives',()=>{
  let now=1000;const codec=shareCodec('test-secret',()=>now),f=fixture(),token=codec.issue([f.photos[0]],'owner');assert.deepEqual(codec.read(token).ids,[A]);now+=30*86400000;assert.equal(codec.read(token),null);
  const projected=JSON.stringify(photoPayload(f.photos[0]));assert.match(projected,/\/api\/photo/);assert.doesNotMatch(projected,/storagePath|storage\/v1|photos\/0/);
});
test('migration moves historical originals and thumbnails, preserves bytes, retries errors and rejects collisions',async()=>{
  const f=fixture();f.objects.set('uploads/photos/legacy-folder/original.png',png);f.objects.set('uploads/photos/thumbs/deep/small.png',png);
  f.setMoveFailed(true);await assert.rejects(migratePhotoStorage(f.supabase));assert.deepEqual(f.objects.get('uploads/photos/0.png'),png);
  f.setMoveFailed(false);assert.equal(await migratePhotoStorage(f.supabase),8);assert.equal(await migratePhotoStorage(f.supabase),0);assert.equal([...f.objects.keys()].filter(key=>/^uploads\/(photos|thumbs)\//.test(key)).length,0);assert.deepEqual(f.objects.get('uploads/posts/one.png'),png);assert.deepEqual(f.objects.get(PHOTO_BUCKET+'/photos/legacy-folder/original.png'),png);
  f.objects.set('uploads/photos/0.png',png);await protectPhotoPath(f.supabase,'photos/0.png');assert.equal(f.objects.has('uploads/photos/0.png'),false);
  f.objects.set('uploads/photos/0.png',Buffer.alloc(png.length,5));await assert.rejects(protectPhotoPath(f.supabase,'photos/0.png'),/collision/);assert.ok(f.objects.has('uploads/photos/0.png'));assert.deepEqual(f.objects.get(PHOTO_BUCKET+'/photos/0.png'),png);
});
test('real storage-js missing-object HEAD errors permit migration; authorization and server failures never do',async()=>{
  const { createClient } = require('@supabase/supabase-js');
  for (const absentStatus of [400,404]) {
    const objects = new Map([['uploads/photos/sdk.png',png]]);
    let rejectedStatus = 0, moves = 0;
    const client = createClient(origin,'test-only-service-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options={})=>{
      const path = new URL(url).pathname.replace('/storage/v1/object/','');
      if (options.method === 'HEAD') return new Response(null,{status:rejectedStatus || (objects.has(path)?200:absentStatus)});
      assert.equal(path,'move');assert.equal(options.method,'POST');
      const action=JSON.parse(options.body),key=action.bucketId+'/'+action.sourceKey;
      moves++;objects.set(action.destinationBucket+'/'+action.destinationKey,objects.get(key));objects.delete(key);
      return Response.json({message:'Successfully moved'});
    }}});
    const missing=await client.storage.from(PHOTO_BUCKET).exists('photos/sdk.png');
    assert.equal(missing.data,false);assert.equal(missing.error.status,absentStatus);
    await protectPhotoPath(client,'photos/sdk.png');
    assert.equal(moves,1);assert.equal(objects.has('uploads/photos/sdk.png'),false);assert.deepEqual(objects.get(PHOTO_BUCKET+'/photos/sdk.png'),png);
    await protectPhotoPath(client,'photos/sdk.png');assert.equal(moves,1);
    objects.set('uploads/photos/sdk.png',png);
    for (const status of [401,403,503]) {
      rejectedStatus=status;await assert.rejects(protectPhotoPath(client,'photos/sdk.png'));
      assert.equal(moves,1);assert.deepEqual(objects.get('uploads/photos/sdk.png'),png);
    }
  }
});
test('authenticated and shared historical derivatives resolve to the original bytes without accepting request paths',async()=>{
  const f=fixture(),original=Buffer.from('AUTHOR-ORIGINAL-BYTES');
  f.photos[0].media_url=origin+'/storage/v1/object/public/uploads/photos/rotated/old.png';
  f.photos[0].content=JSON.stringify({storage_path:'photos/original.png'});
  f.objects.set('uploads/photos/rotated/old.png',png);f.objects.set('uploads/photos/original.png',original);
  const own=await request(f.app).get('/api/photo/'+A+'/media?storagePath=photos/rotated/old.png').set('Authorization','Bearer owner').expect(200);
  assert.deepEqual(body(own),original);
  const shared=await request(f.app).post('/api/photo/share').set('Authorization','Bearer owner').send({photo_ids:[A]}).expect(200),token=shared.body.share_path.split('/').at(-1);
  assert.deepEqual(body(await request(f.app).get('/api/photo/shared/'+token+'/'+A+'/media').expect(200)),original);
  assert.deepEqual(f.storageCalls.filter(c=>c[0]==='sign').map(c=>c.slice(1)),[['photo-wall','photos/original.png'],['photo-wall','photos/original.png']]);
  f.photos[0].media_url='https://other.example/storage/v1/object/public/uploads/photos/rotated/old.png';
  await request(f.app).get('/api/photo/'+A+'/media').set('Authorization','Bearer owner').expect(404);
});
test('public post albums and website share pages remain readable by guests; private posts and wall IDs are denied',async()=>{
  const f=fixture(),path='/api/post/'+f.publicPost.id+'/media/';
  for(const position of [0,1])assert.deepEqual(body(await request(f.app).get(path+position).expect(200)),png);
  const page=await request(f.app).get('/share/posts/'+f.publicPost.id).expect(200);assert.match(page.text,/公开帖子/);assert.ok(!page.text.includes(A));
  await request(f.app).get('/api/post/'+A+'/media/0').expect(404);await request(f.app).get(path+'2').expect(404);await request(f.app).get(path+'0?storage_path=photos/0.png').expect(200);
  f.publicPost.visibility='private';await request(f.app).get(path+'0').expect(404);await request(f.app).get('/share/posts/'+f.publicPost.id).expect(404);
  await request(f.app).get(path+'0').set('Cookie',POST_MEDIA_COOKIE+'=owner~'+SESSION).expect(200);f.setActive(false);await request(f.app).get(path+'0').set('Cookie',POST_MEDIA_COOKIE+'=owner~'+SESSION).expect(404);
});

test('conditional originals reuse unchanged bytes only after fresh authorization, visibility and deletion checks',async()=>{
  const f=fixture(),path='/api/post/'+f.publicPost.id+'/media/0';
  const first=await request(f.app).get(path).expect(200),etag=first.headers.etag;
  assert.ok(etag);assert.deepEqual(body(first),png);
  const cached=await request(f.app).get(path).set('If-None-Match',etag).expect(304);
  assert.equal(cached.text,'');assert.equal(cached.headers.etag,etag);assert.equal(cached.headers['cache-control'],'private, no-cache, must-revalidate');
  await request(f.app).head(path).set('If-Modified-Since',first.headers['last-modified']).expect(304);
  f.objects.set('uploads/posts/one.png',Buffer.concat([png,Buffer.from('changed')]));
  const changed=await request(f.app).get(path).set('If-None-Match',etag).expect(200);assert.notEqual(changed.headers.etag,etag);
  f.publicPost.visibility='private';const before=f.downloads.length;
  await request(f.app).get(path).set('If-None-Match',changed.headers.etag).expect(404);assert.equal(f.downloads.length,before);
  const cookie=POST_MEDIA_COOKIE+'=owner~'+SESSION;
  await request(f.app).get(path).set('Cookie',cookie).set('If-None-Match',changed.headers.etag).expect(304);
  f.setActive(false);await request(f.app).get(path).set('Cookie',cookie).set('If-None-Match',changed.headers.etag).expect(404);
  f.publicPost.is_deleted=true;await request(f.app).get(path).set('Authorization','Bearer owner').set('If-None-Match',changed.headers.etag).expect(404);
  f.setDbFailed(true);await request(f.app).get(path).set('If-None-Match',changed.headers.etag).expect(503);
});

test('cached wall/share originals cannot revalidate after logout, unsharing or author deletion',async()=>{
  const f=fixture(),path='/api/photo/'+A+'/media',cookie=PHOTO_COOKIE+'=owner~'+SESSION;
  const first=await request(f.app).get(path).set('Cookie',cookie).expect(200);
  await request(f.app).get(path).set('Cookie',cookie).set('If-None-Match',first.headers.etag).expect(304);
  await request(f.app).get(path).set('If-None-Match',first.headers.etag).expect(401);
  f.setActive(false);await request(f.app).get(path).set('Cookie',cookie).set('If-None-Match',first.headers.etag).expect(401);
  const share=await request(f.app).post('/api/photo/share').set('Authorization','Bearer owner').send({photo_ids:[A]}).expect(200);
  const shared='/api/photo/shared/'+share.body.share_path.split('/').at(-1)+'/'+A+'/media';
  await request(f.app).get(shared).set('If-None-Match',first.headers.etag).expect(304);
  f.photos[0].visibility='private';await request(f.app).get(shared).set('If-None-Match',first.headers.etag).expect(404);
  f.photos[0].visibility='public';f.photos[0].is_deleted=true;await request(f.app).get(shared).set('If-None-Match',first.headers.etag).expect(404);
});

test('range revalidation preserves bytes and returns the full changed original for a stale If-Range',async()=>{
  const f=fixture(),path='/api/post/'+f.publicPost.id+'/media/0',first=await request(f.app).get(path).expect(200);
  const range=await request(f.app).get(path).set('Range','bytes=0-3').set('If-Range',first.headers.etag).set('If-None-Match',first.headers.etag).expect(206);
  assert.deepEqual(body(range),png.subarray(0,4));assert.equal(f.downloads.at(-1).headers['If-None-Match'],undefined);
  const full=await request(f.app).get(path).set('Range','bytes=0-3').set('If-Range','"old"').expect(200);assert.deepEqual(body(full),png);
});

test('simultaneous album cells share only pending reads; the next request observes changed privacy',async()=>{
  const f=fixture(),path='/api/post/'+f.publicPost.id+'/media/';f.setDbDelay(20);
  await Promise.all([request(f.app).get(path+'0').expect(200),request(f.app).get(path+'1').expect(200)]);
  assert.deepEqual(f.reads,['posts','post_attachments']);
  f.publicPost.visibility='private';await request(f.app).get(path+'0').expect(404);
  assert.deepEqual(f.reads,['posts','post_attachments','posts']);
});

test('a stalled attachment read cannot keep an old public permission alive for later requests',async()=>{
  const f=fixture(),path='/api/post/'+f.publicPost.id+'/media/';let release,timer;
  f.setAttachmentGate(new Promise(resolve=>release=resolve));
  const first=request(f.app).get(path+'0').then(response=>response);
  try{
    for(let i=0;i<100&&!f.reads.includes('post_attachments');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(f.reads.includes('post_attachments'));
    f.publicPost.visibility='private';
    const second=await Promise.race([request(f.app).get(path+'1').then(response=>response),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('later request reused a completed permission read')),1000);})]);
    assert.equal(second.status,404);assert.deepEqual(f.reads,['posts','post_attachments','posts']);
  }finally{clearTimeout(timer);release();await first;}
});
