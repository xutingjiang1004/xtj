'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),request=require('supertest');
const {installUploadAccess}=require('../render-api/upload-access');
const {setPhotoSession}=require('../render-api/photo-access');
const origin='https://storage.test',url=path=>origin+'/storage/v1/object/public/uploads/'+path;
function fixture(){
 const rows={posts:[],post_attachments:[],account_profile_settings:[]};let messages=[],fail=false,reads=0;
 const db={from(table){const filters=[];let single=false;const q={select(){return q;},eq(key,value){filters.push(row=>key.includes('->>')?row.settings[key.split('->>')[1]]===value:row[key]===value);return q;},in(key,values){filters.push(row=>values.includes(row[key]));return q;},ilike(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},then(resolve){const data=rows[table].filter(row=>filters.every(f=>f(row)));return Promise.resolve({data:single?data[0]||null:data,error:fail?Error('offline'):null}).then(resolve);}};return q;},async rpc(){return {data:messages,error:fail?Error('offline'):null};},storage:{from(){return {getPublicUrl:path=>({data:{publicUrl:url(path)}}),createSignedUrl:async()=>({data:{signedUrl:'https://storage.test/internal-signed'}})};}}};
 const app=express();installUploadAccess(app,{supabase:db,supabaseUrl:origin,adminName:'admin',optionalAuth(req,res,next){req.userName=req.get('x-user');next();},rateLimit:()=>((req,res,next)=>next()),fetchImpl:async()=>{reads++;return new Response(Buffer.from('original bytes'),{headers:{'content-type':'image/png'}});}});
 return {app,rows,get reads(){return reads;},setMessages(value){messages=value;},fail(){fail=true;}};
}
test('legacy uploads enforce post visibility and deletion while preserving public originals',async()=>{
 const f=fixture(),path='posts/secret.png';f.rows.posts.push({id:'post',user_name:'alice',media_type:'image',media_url:url(path),visibility:'private'});
 await request(f.app).get('/api/uploads/media').query({path}).expect(404);await request(f.app).get('/api/uploads/media').query({path}).set('x-user','bob').expect(404);assert.equal(f.reads,0);
 const response=await request(f.app).get('/api/uploads/media').query({path}).set('x-user','alice').expect(200);assert.equal(response.body.toString(),'original bytes');assert.match(response.headers['cache-control'],/must-revalidate/);
 f.rows.posts[0].visibility='public';await request(f.app).get('/api/uploads/media').query({path}).expect(200);
 f.rows.posts[0].is_deleted=true;await request(f.app).get('/api/uploads/media').query({path}).set('x-user','alice').expect(404);
});
test('a foreign URL with the same filename cannot grant access; all album attachments remain readable',async()=>{
 const f=fixture(),path='posts/second.png';f.rows.posts.push({id:'post',user_name:'alice',media_type:'text',visibility:'public',media_url:'https://evil.test/'+path});
 await request(f.app).get('/api/uploads/media').query({path}).expect(404);
 f.rows.post_attachments.push({post_id:'post',media_url:url(path)});await request(f.app).get('/api/uploads/media').query({path}).expect(200);
 f.fail();await request(f.app).get('/api/uploads/media').query({path}).expect(503);
});
test('profile covers are public, backgrounds need their current owner, and retired identities cannot grant either',async()=>{
 const f=fixture();f.rows.posts.push({id:'account',user_name:'alice',media_type:'__auth__'});f.rows.account_profile_settings.push({user_name:'alice',account_id:'account',settings:{cover_url:url('profile-images/cover.png'),background_url:url('profile-images/bg.png')}});
 await request(f.app).get('/api/uploads/media?path=profile-images%2Fcover.png').expect(200);await request(f.app).get('/api/uploads/media?path=profile-images%2Fbg.png').expect(404);await request(f.app).get('/api/uploads/media?path=profile-images%2Fbg.png').set('x-user','alice').expect(200);
 f.rows.posts.length=0;await request(f.app).get('/api/uploads/media?path=profile-images%2Fcover.png').expect(404);
});
test('legacy chat reads require a visible message attachment, not a mention of its path',async()=>{
 const f=fixture(),path='chat/file.png';f.setMessages([{content:JSON.stringify({text:path})}]);await request(f.app).get('/api/uploads/media').query({path}).set('x-user','bob').expect(404);
 f.setMessages([{content:JSON.stringify({media:{url:url(path)}})}]);await request(f.app).get('/api/uploads/media').query({path}).expect(404);await request(f.app).get('/api/uploads/media').query({path}).set('x-user','bob').expect(200);
 f.setMessages([]);await request(f.app).get('/api/uploads/media').query({path}).set('x-user','bob').expect(404);
 for(const path of ['../secret','posts/%2Fsecret','posts\\secret'])await request(f.app).get('/api/uploads/media').query({path}).expect(404);
});
test('cookie sessions cover the uploads route with the same scoped expiry and HttpOnly protection',()=>{
 const cookies=[];setPhotoSession({cookie:(...args)=>cookies.push(args)},'signed-access',Date.now()+900000,'11111111-1111-4111-8111-111111111111');
 const cookie=cookies.find(c=>c[2].path==='/api/uploads');assert.ok(cookie);assert.equal(cookie[2].httpOnly,true);assert.equal(cookie[2].secure,true);
});
