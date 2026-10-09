'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const {createAuthorSupport, DISCLAIMER} = require('../render-api/author-support');

function fixture() {
  let row=null, failWrite=false;
  const uploaded=new Map(), removed=[];
  const supabase={storage:{from(bucket){assert.equal(bucket,'uploads');return {
    getPublicUrl(path){return {data:{publicUrl:'https://example.test/storage/'+path}};},
    async upload(path,bytes,options){assert.equal(options.upsert,false);uploaded.set(path,Buffer.from(bytes));return {data:{path}};},
    async remove(paths){removed.push(...paths);paths.forEach(path=>uploaded.delete(path));return {data:[]};}
  };}},from(table){assert.equal(table,'posts');let patch=null,insert=false;
    const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},
      update(value){patch=value;return q;},insert(value){patch=value;insert=true;return q;},
      then(resolve,reject){
        if(patch && failWrite)return Promise.resolve({error:{message:'temporary database failure'}}).then(resolve,reject);
        if(patch)row=insert?{id:'support-config',...patch}:{...row,...patch};
        return Promise.resolve({data:patch?null:row?[row]:[]}).then(resolve,reject);
      }};return q;}};
  const app=express();app.use(express.json({limit:'3mb'}));
  app.use(createAuthorSupport({express,supabase,sharp,adminName:'xxz',
    authenticateUser(req,res,next){if(req.get('Authorization')==='Bearer viewer'){req.userName='viewer';next();}else res.sendStatus(401);},
    verifyToken(req,res,next){if(req.get('Authorization')==='Bearer admin'){req.adminName='xxz';next();}else res.sendStatus(401);},
    rateLimit(){return (req,res,next)=>next();}}));
  return {app,uploaded,removed,setFailWrite(value){failWrite=value;},getRow(){return row;}};
}
async function png(color='#446c5a'){return sharp({create:{width:160,height:160,channels:3,background:color}}).png().toBuffer();}
test('author codes require login and configuration requires administrator credentials',async()=>{
  const f=fixture(),image=(await png()).toString('base64');
  await request(f.app).get('/api/chat/author-support').expect(401);
  await request(f.app).post('/admin/author-support').set('Authorization','Bearer viewer').send({provider:'wechat',image}).expect(401);
  const r=await request(f.app).get('/api/chat/author-support').set('Authorization','Bearer viewer').expect(200);
  assert.deepEqual(r.body,{ok:true,author:'xxz',disclaimer:DISCLAIMER,wechat_url:null,alipay_url:null});
  assert.equal(f.uploaded.size,0);
});
test('both QR codes retain original bytes and concurrent saves retain the other provider',async()=>{
  const f=fixture(),wechat=await png(),alipay=await png('#4061b9');
  await Promise.all([['wechat',wechat],['alipay',alipay]].map(([provider,bytes])=>
    request(f.app).post('/admin/author-support').set('Authorization','Bearer admin').send({provider,image:bytes.toString('base64')}).expect(200)));
  const r=await request(f.app).get('/api/chat/author-support').set('Authorization','Bearer viewer').expect(200);
  assert.equal(r.headers['cache-control'],'no-store');
  assert.match(new URL(r.body.wechat_url,'https://xtj.test').searchParams.get('path'),/site-support\/wechat_/);assert.match(new URL(r.body.alipay_url,'https://xtj.test').searchParams.get('path'),/site-support\/alipay_/);
  const codes=JSON.parse(f.getRow().content);
  assert.ok(f.uploaded.get(codes.wechat).equals(wechat));assert.ok(f.uploaded.get(codes.alipay).equals(alipay));
  assert.deepEqual(Object.keys(r.body).sort(),['ok','author','disclaimer','wechat_url','alipay_url'].sort());
});
test('failed QR replacement preserves the published code and removes the uncommitted object',async()=>{
  const f=fixture(),image=(await png()).toString('base64');
  const save=()=>request(f.app).post('/admin/author-support').set('Authorization','Bearer admin').send({provider:'wechat',image});
  const original=(await save().expect(200)).body.wechat_url;
  f.setFailWrite(true);await save().expect(503);
  const r=await request(f.app).get('/api/chat/author-support').set('Authorization','Bearer viewer').expect(200);
  assert.equal(r.body.wechat_url,original);assert.equal(f.uploaded.size,1);assert.equal(f.removed.length,1);
  f.setFailWrite(false);const replaced=(await save().expect(200)).body.wechat_url;
  assert.notEqual(replaced,original);assert.equal(f.uploaded.size,1);assert.equal(f.removed.length,2);
});
test('executable content and invalid providers cannot become published QR images',async()=>{
  const f=fixture();
  await request(f.app).post('/admin/author-support').set('Authorization','Bearer admin').send({provider:'other',image:(await png()).toString('base64')}).expect(400);
  await request(f.app).post('/admin/author-support').set('Authorization','Bearer admin').send({provider:'wechat',image:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>alert(1)</script></svg>').toString('base64')}).expect(400);
  assert.equal(f.uploaded.size,0);
});
