'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {createAuthorPosts}=require('../render-api/author-posts');
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
function fixture(){
 const posts=Array.from({length:6},(_,i)=>({id:id(6-i),user_name:'alice',media_type:'album',content:'动态',visibility:i===0?'private':'public',created_at:'2026-10-04T00:25:36.729451+00:00'}));
 posts.push({id:id(0),user_name:'alice',media_type:'__auth__',content:'secret',visibility:'public',created_at:'2026-10-04T00:25:35.729451+00:00'});
 const reads=[],attachmentReads=[];let fail=false;
 const db={from(table){const eqs={},ops={table};let cursor=null,limit=99,ids=[],publicOnly=false;
  const q={select(fields){ops.fields=fields;return q},eq(k,v){eqs[k]=v;return q},not(){return q},order(){return q},limit(n){limit=n;return q},in(k,v){ids=v;return q},or(s){assert.equal(ops.or,undefined,'combine cursor and media allowlist in one OR');ops.or=s;publicOnly=s.includes('visibility.eq.public');const match=s.match(/created_at.lt.([^,]+),and\(created_at.eq.[^,]+,id.lt.([\w-]+)/);if(match)cursor={at:match[1],id:match[2]};return q},then(resolve,reject){let rows;if(table==='post_attachments'){attachmentReads.push(ids);rows=ids.flatMap(post=>Array.from({length:15},(_,i)=>({id:'a-'+post+'-'+i,post_id:post,position:i,media_type:'image',media_url:'https://example.com/'+post+'/'+i+'.png',width:400,height:300,storage_path:'never-public'})));}else{reads.push(ops);rows=posts.filter(p=>Object.entries(eqs).every(([k,v])=>p[k]===v)&&!p.is_deleted&&(!publicOnly||!p.visibility||p.visibility==='public')&&!String(p.media_type).startsWith('__')).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));if(cursor)rows=rows.filter(p=>p.created_at<cursor.at||p.created_at===cursor.at&&p.id<cursor.id);rows=rows.slice(0,limit)}rows=rows.map(row=>Object.fromEntries(ops.fields.split(',').filter(k=>k in row).map(k=>[k,row[k]])));return Promise.resolve(fail?{error:{message:'offline'}}:{data:rows}).then(resolve,reject)}};return q;}};
 const app=express();app.use('/api/profile/posts',createAuthorPosts({express,supabase:db,optionalAuth:(req,res,next)=>{req.userName=req.headers['x-user']||'';next()},looksLikeSystemTelemetry:content=>content==='telemetry'}));return{app,posts,reads,attachmentReads,setFail(v){fail=v}};
}
test('author pages apply verified viewer privacy before a single batched attachment read',async()=>{
 const f=fixture();for(const actor of ['', 'bob','admin']){const r=await request(f.app).get('/api/profile/posts/alice').set('x-user',actor).expect(200);assert.equal(r.body.posts.length,5);assert.ok(r.body.posts.every(p=>p.visibility==='public'));assert.equal(r.body.posts[0].media_items.length,15);assert.ok(r.body.posts[0].media_items.every(p=>!('storage_path'in p)));assert.equal(r.headers['cache-control'],'no-store');}
 const own=await request(f.app).get('/api/profile/posts/alice').set('x-user','alice').expect(200);assert.equal(own.body.posts.length,6);assert.equal(f.attachmentReads.length,4);assert.equal(f.attachmentReads.at(-1).length,6);assert.ok(f.reads.every(q=>!q.fields.includes('actor_key')));
});
test('equal-time author pagination preserves microseconds without losing or repeating posts',async()=>{
 const f=fixture(),seen=[];let cursor;for(let i=0;i<4;i++){const r=await request(f.app).get('/api/profile/posts/alice').set('x-user','alice').query({limit:2,...(cursor?{before_at:cursor.at,before_id:cursor.id}:{})}).expect(200);seen.push(...r.body.posts.map(p=>p.id));cursor=r.body.next_cursor;if(!cursor)break;assert.equal(cursor.at,'2026-10-04T00:25:36.729451+00:00');}
 assert.deepEqual(seen,f.posts.slice(0,6).map(p=>p.id));assert.equal(new Set(seen).size,6);assert.equal(f.attachmentReads.length,3);
});
test('author pages exclude deleted/system/telemetry rows, fill a page and fail honestly',async()=>{
 const f=fixture();f.posts[1].is_deleted=true;f.posts[2].content='telemetry';const r=await request(f.app).get('/api/profile/posts/alice').query({limit:2}).expect(200);assert.equal(r.body.posts.length,2);assert.ok(r.body.posts.every(p=>p.content!=='telemetry'&&!p.is_deleted));await request(f.app).get('/api/profile/posts/ghost').expect(200).then(r=>assert.equal(r.body.posts.length,0));f.setFail(true);await request(f.app).get('/api/profile/posts/alice').expect(503);
});
test('author cursor validation rejects malformed filters before querying',async()=>{
 const f=fixture();for(const query of [{before_at:'2026-10-04T00:00:00Z'},{before_at:'2026-10-04T00:00:00Z),visibility.eq.private',before_id:id(1)},{before_at:'2026-10-04T00:00:00Z',before_id:'bad'}])await request(f.app).get('/api/profile/posts/alice').query(query).expect(400);assert.equal(f.reads.length,0);
});

test('legacy public posts without visibility remain visible; private posts are never hydrated for another viewer',async()=>{const f=fixture();f.posts[1].visibility=null;const r=await request(f.app).get('/api/profile/posts/alice').set('x-user','bob').expect(200);assert.equal(r.body.posts.length,5);assert.ok(r.body.posts.some(p=>p.visibility===null));assert.ok(!f.attachmentReads[0].includes(f.posts[0].id));});
