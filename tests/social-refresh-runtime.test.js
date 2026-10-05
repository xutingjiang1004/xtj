'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const { createProfileRecords } = require('../render-api/profile-records');
const id = n => '123e4567-e89b-42d3-a456-' + String(n).padStart(12,'0');
const at = '2026-09-30T07:00:00.000Z';
function fixture() {
  const rows = {
    posts: [
      { id:id(1),user_name:'alice',content:'my post',created_at:at,media_type:'text',visibility:'private' },
      { id:id(2),user_name:'bob',content:'private secret',created_at:at,media_type:'text',visibility:'private' },
      { id:id(3),user_name:'bob',content:'public post',created_at:at,media_type:'text',visibility:'public' },
      { id:id(4),user_name:'alice',content:'hidden auth',created_at:at,media_type:'__auth__' },
      { id:id(5),user_name:'alice',created_at:at,media_type:'__post_view__',media_url:id(2) },
      { id:id(6),user_name:'alice',created_at:at,media_type:'__post_view__',media_url:id(3) },
      { id:id(7),user_name:'bob',created_at:at,media_type:'__post_view__',media_url:id(1) }
    ],
    likes:[{id:id(8),user_name:'alice',post_id:id(3),created_at:at},{id:id(9),user_name:'bob',post_id:id(1),created_at:at}],
    comments:[{id:id(10),user_name:'alice',post_id:id(2),content:'own comment',created_at:at}]
  };
  let fail = false;
  const calls = [];
  const supabase = { from(table) {
    const filters = []; let cap = Infinity, head = false; const orders=[];
    return {
      select(_,options){head=options?.head; return this;},
      eq(k,v){filters.push(r=>r[k]===v);return this;},
      not(k,_,v){filters.push(r=>r[k]!==v);return this;},
      in(k,v){filters.push(r=>v.includes(r[k]));return this;},
      or(value){
        calls.push(value);
        if(value.includes('media_type.is.null')) filters.push(r=> !r.media_type || ['text','image','video','audio','photo','album'].includes(r.media_type));
        const match = value.match(/created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)/);
        if(match) filters.push(r=>r.created_at<match[1] || r.created_at===match[2] && r.id<match[3]);
        return this;
      },
      order(k,options){orders.push([k,options.ascending]);return this;},limit(n){cap=n;return this;},
      then(resolve,reject){
        let found = rows[table].filter(r=>filters.every(f=>f(r)));
        orders.slice().reverse().forEach(([k,asc])=>found.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(asc?1:-1)));
        return Promise.resolve(fail ? {error:{code:'database_error'}} : {data:head?null:found.slice(0,cap),count:found.length}).then(resolve,reject);
      }
    };
  }};
  const app=express();
  app.use('/records',createProfileRecords({express,supabase,authenticateUser(req,res,next){if(req.headers['x-test-user']!=='alice')return res.sendStatus(401);req.userName='alice';next();}}));
  return {app,rows,calls,setFail(){fail=true;}};
}
test('personal summaries count only authenticated actor and exclude system posts',async()=>{
  const f=fixture();const res=await request(f.app).get('/records/summary?user=bob').set('x-test-user','alice').expect(200);
  assert.deepEqual(res.body.totals,{posts:1,views:2,likes:1,comments:1});
  await request(f.app).get('/records/summary').expect(401);
});
test('view and comment history cannot reveal another owner’s private post',async()=>{
  const f=fixture();for(const kind of ['views','comments']){
    const res=await request(f.app).get('/records?kind='+kind).set('x-test-user','alice').expect(200);
    assert.ok(!JSON.stringify(res.body).includes('private secret'));
    const unavailable=res.body.items.find(row=>!row.available);assert.equal(unavailable.post_id,null);assert.equal(unavailable.author,'');
  }
});
test('equal timestamp pagination uses the row id and never repeats a row',async()=>{
  const f=fixture();const first=await request(f.app).get('/records?kind=views&limit=1').set('x-test-user','alice').expect(200);
  assert.equal(first.body.has_more,true);
  const c=first.body.next_cursor;
  const second=await request(f.app).get('/records?kind=views&limit=1&before_at='+encodeURIComponent(c.at)+'&before_id='+c.id).set('x-test-user','alice').expect(200);
  assert.notEqual(first.body.items[0].id,second.body.items[0].id);assert.equal(second.body.has_more,false);
});
test('post pagination keeps the normal-post filter inside one OR expression',async()=>{
  const f=fixture();await request(f.app).get('/records?kind=posts&before_at='+at+'&before_id='+id(8)).set('x-test-user','alice').expect(200);
  assert.equal(f.calls.length,1);assert.match(f.calls[0],/^and\(or\(media_type/);assert.match(f.calls[0],/or\(created_at/);
});
test('invalid record cursor and database failures fail explicitly',async()=>{
  const f=fixture();await request(f.app).get('/records?kind=views&before_id=bad').set('x-test-user','alice').expect(400);
  f.setFail();await request(f.app).get('/records?kind=likes').set('x-test-user','alice').expect(503);
});
test('retired Code cannot be loaded, served or routed, while normal AI is retained',()=>{
  assert.equal(fs.existsSync('js/code-workbench.js'),false);assert.equal(fs.existsSync('js/code-workbench.min.js'),false);
  for(const file of ['index.html','js/ai-agent.js','scripts/build.js','js/core-parts/01-bootstrap.js','render-api/server.js']) assert.doesNotMatch(fs.readFileSync(file,'utf8'),/code-workbench|\/api\/code\/|aiCodeToggle|AI_CODE_ICON/);
  assert.match(fs.readFileSync('js/ai-agent.js','utf8'),/function toggleDeepThink/);
});
