'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),request=require('supertest'),sharp=require('sharp');
const {avatarImageUrl,registerAvatarImage,version}=require('../render-api/avatar-image');

const origin='https://storage.test',photoUrl=origin+'/storage/v1/object/public/uploads/avatars/bob_1_abc_photo.jpg';
async function jpeg(width,height,color){return sharp({create:{width,height,channels:3,background:color}}).jpeg().toBuffer();}

async function fixture(){
  const big=await jpeg(1600,1200,{r:200,g:80,b:60}),stored=await jpeg(900,900,{r:30,g:120,b:200});
  const dataUrl='data:image/jpeg;base64,'+big.toString('base64');
  const rows={alice:[{media_url:dataUrl}],bob:[{media_url:photoUrl}],evil:[{media_url:'https://evil.test/storage/v1/object/public/uploads/avatars/x.jpg'}]};
  let storageReads=0;
  const db={
    from(){let name='';const q={select(){return q;},eq(key,value){if(key==='user_name')name=value;return q;},order(){return q;},limit(){return Promise.resolve({data:rows[name]||[],error:null});}};return q;},
    storage:{from(){return{async createSignedUrl(path){return{data:{signedUrl:origin+'/signed/'+path},error:null};}};}}
  };
  const app=express();
  registerAvatarImage(app,{supabase:db,supabaseUrl:origin,sharp,rateLimit:()=>((_q,_s,n)=>n()),fetchImpl:async()=>{storageReads++;return new Response(stored);}});
  return{app,dataUrl,rows,get storageReads(){return storageReads;}};
}
const binary=res=>{res.buffer=true;res.parse=(r,cb)=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>cb(null,Buffer.concat(c)));};};

test('the avatar URL names the avatar version and never carries image bytes',()=>{
  const url=avatarImageUrl('徐廷江','data:image/jpeg;base64,'+'A'.repeat(3_000_000));
  assert.ok(url.length<120,'a multi-megabyte data URL must not travel in API responses');
  assert.match(url,/^\/api\/avatar\/image\/%E5%BE%90%E5%BB%B7%E6%B1%9F\?v=[0-9a-f]{10}$/);
  assert.equal(avatarImageUrl('x',''),null);
  assert.notEqual(version('a'),version('b'));
});

test('a base64 avatar and a storage avatar are both served as small immutable WebP images',async()=>{
  const f=await fixture();
  for(const [user,mediaUrl] of [['alice',f.dataUrl],['bob',photoUrl]]){
    const v=version(mediaUrl);
    const res=await request(f.app).get('/api/avatar/image/'+user+'?v='+v).buffer(true).parse((r,cb)=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>cb(null,Buffer.concat(c)));}).expect(200);
    assert.equal(res.headers['content-type'],'image/webp');
    assert.match(res.headers['cache-control'],/immutable/);
    const meta=await sharp(res.body).metadata();
    assert.deepEqual([meta.width,meta.height],[192,192],user);
    assert.ok(res.body.length<20000,user+' is '+res.body.length+' bytes');
    const again=await request(f.app).get('/api/avatar/image/'+user+'?v='+v).set('If-None-Match',res.headers.etag).expect(304);
    assert.equal(again.text||'', '');
  }
  assert.equal(f.storageReads,1,'a rendered avatar is reused, not downloaded again');
});

test('a stale version link gets a short cache, unknown and foreign avatars are refused',async()=>{
  const f=await fixture();
  const stale=await request(f.app).get('/api/avatar/image/bob?v=0000000000').expect(200);
  assert.match(stale.headers['cache-control'],/max-age=60/);assert.doesNotMatch(stale.headers['cache-control'],/immutable/);
  await request(f.app).get('/api/avatar/image/nobody?v=x').expect(404);
  await request(f.app).get('/api/avatar/image/evil?v=x').expect(503);
});
