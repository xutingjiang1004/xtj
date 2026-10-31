'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express'),request=require('supertest');
const {isNormalPost}=require('../render-api/post-query');
const {createComment,readRelationPage,parseRelationCursor,readFeedEngagement}=require('../render-api/post-interactions');
const {readPhotoWallPage}=require('../render-api/photo-wall-page');
const {installPhotoSocial}=require('../render-api/photo-social');
const source=fs.readFileSync('render-api/server.js','utf8'),id='123e4567-e89b-42d3-a456-000000000081',key='123e4567-e89b-42d3-a456-000000000082';
function fixture(patch={}){
  const posts=[{id,user_name:'alice',media_type:'text',visibility:'public',content:'post',is_deleted:false,...patch}],comments=[{id:10,post_id:id,user_name:'alice',content:'old',generated_by_ai:false}];
  const calls=[],writes=[];let rpcError=null;
  const db={from(table){let fields='*',predicates=[];const q={select(f){fields=f;return q;},eq(k,v){predicates.push(row=>String(row[k])===String(v));return q;},order(){return q;},limit(){return q;},insert(row){writes.push(row);return q;},delete(){writes.push('delete');return q;},
    async maybeSingle(){const row=(table==='posts'?posts:table==='comments'?comments:[]).find(row=>predicates.every(fn=>fn(row)));return{data:row?fields==='*'?row:Object.fromEntries(fields.split(',').map(k=>[k.trim(),row[k.trim()]])):null};},async single(){return{data:{id:99,post_id:id,user_name:'alice',content:'hello'}};},then(resolve){return Promise.resolve({data:[],count:0}).then(resolve);}};return q;},
    async rpc(name,args){calls.push({name,args});if(rpcError)return{error:rpcError};if(name==='xtj_create_comment')return{data:{ok:true,created:true,comment:{id:99,post_id:id,user_name:args.p_owner,content:args.p_content},comment_count:2}};
      if(name==='xtj_set_post_like')return{data:{ok:true,liked:args.p_liked,like_count:1,post_id:id}};
      if(name==='xtj_delete_comment')return{data:{ok:true,post_id:id,deleted_comment_ids:[10,11,12],comment_count:4}};
      return{data:{}};}};
  const app=express();app.use(express.json());const auth=(req,res,next)=>{const user=req.get('x-user');if(!user)return res.sendStatus(401);req.userName=user;next();};
  const context={app,supabase:db,authenticateUser:auth,rateLimit:()=>((_req,_res,next)=>next()),userBanError:()=>null,normalizePostId:value=>/^[a-f0-9-]{36}$/i.test(value)?value:null,isNormalPost,createComment,crypto:require('node:crypto'),ADMIN_USERNAME:'xxz',CAT_AI_USERNAME:'cat_ai',isValidCatTrigger:()=>false,sanitizeError:()=> 'database error',console,
    blockCatJobAfterCommentDelete:async()=>({}),logCatCAS:()=>{}};vm.createContext(context);
  const a=source.indexOf('function normalizeInteractionId('),b=source.indexOf('// Authenticated feed statistics snapshot',a);vm.runInContext(source.slice(a,b),context);
  installPhotoSocial(app,{supabase:db,authenticateUser:auth,rateLimit:context.rateLimit,userBanError:context.userBanError});
  return{app,calls,writes,posts,comments,setRpcError(error){rpcError=error;}};
}
test('the actual post write routes reject soft-deleted projections before any interaction write',async()=>{
 const f=fixture({is_deleted:true});const like=await request(f.app).post('/api/post/like').set('x-user','alice').send({post_id:id,liked:true});assert.equal(like.status,404);
 const comment=await request(f.app).post('/api/post/comment').set('x-user','alice').send({post_id:id,content:'hello',client_request_id:key});assert.ok([404,422].includes(comment.status));assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
test('the actual routes bind RPC ownership and request identity to the authenticated actor',async()=>{
 const f=fixture();await request(f.app).post('/api/post/comment').send({post_id:id,content:'hello'}).expect(401);
 const comment=await request(f.app).post('/api/post/comment').set('x-user','alice').send({post_id:id,content:'hello',client_request_id:key,user_name:'xxz'}).expect(201);
 assert.equal(comment.body.data.user_name,'alice');assert.equal(comment.body.comment_count,2);assert.deepEqual(f.calls[0].args,{p_post_id:id,p_owner:'alice',p_content:'hello',p_request_id:key,p_kind:'post'});
 await request(f.app).post('/api/post/like').set('x-user','alice').send({post_id:id,liked:true,user_name:'xxz'}).expect(200);assert.equal(f.calls[1].args.p_owner,'alice');assert.equal(f.writes.length,0);
 await request(f.app).post('/api/post/comment').set('x-user','alice').send({post_id:id,content:'hello',client_request_id:'unsafe'}).expect(400);
});
test('RPC outages fail explicitly instead of falling back to an unchecked insert or returning a false success',async()=>{
 const f=fixture();f.setRpcError({code:'PGRST202'});
 await request(f.app).post('/api/post/comment').set('x-user','alice').send({post_id:id,content:'hello',client_request_id:key}).expect(503);
 await request(f.app).post('/api/post/like').set('x-user','alice').send({post_id:id,liked:true}).expect(503);assert.equal(f.writes.length,0);
});
test('the actual delete route preserves permissions and returns complete cascade metadata',async()=>{
 const f=fixture();await request(f.app).delete('/api/post/comment/10').set('x-user','bob').expect(403);assert.equal(f.calls.length,0);
 const result=await request(f.app).delete('/api/post/comment/10').set('x-user','alice').expect(200);assert.deepEqual(result.body.deleted_comment_ids,[10,11,12]);assert.equal(result.body.comment_count,4);assert.equal(result.body.post_id,id);assert.equal(f.calls[0].args.p_owner,'alice');
});
test('photo comment routes pass the same stable retry ID and actor to the shared transaction',async()=>{
 const f=fixture({media_type:'__photo_wall__',content:'{}'});
 const first=await request(f.app).post('/api/photo/'+id+'/comments').set('x-user','bob').send({content:'hello',client_request_id:key,user_name:'alice'}).expect(201);
 assert.equal(first.body.comment.user_name,'bob');assert.equal(f.calls[0].args.p_request_id,key);assert.equal(f.calls[0].args.p_kind,'photo');assert.equal(f.writes.length,0);
});
test('relation cursors preserve numeric IDs and microseconds and reject filter injection',async()=>{
 const token=JSON.stringify({id:'9223372036854775806',at:'2026-10-13T00:00:00.123456Z'});
 assert.deepEqual(parseRelationCursor(token),{id:'9223372036854775806',at:'2026-10-13T00:00:00.123456Z'});
 for(const bad of [JSON.stringify({id:'1),id.gt.0',at:'2026-10-13T00:00:00Z'}),JSON.stringify({id:1,at:'2026-10-13T00:00:00Z),id.gt.0'}),'bad-json'])assert.throws(()=>parseRelationCursor(bad));
 const log=[];const db={from(table){log.push(table);const q={select(columns,options){log.push({columns,options});return q;},eq(){return q;},or(value){log.push(value);return q;},order(key,value){log.push({key,...value});return q;},limit(value){log.push(value);return Promise.resolve({data:Array.from({length:31},(_,n)=>({id:n+1,created_at:'2026-10-13T00:00:00.123456Z'})),count:5000});}};return q;}};
 const page=await readRelationPage(db,id,'comments',{cursor:token});assert.equal(page.data.length,30);assert.equal(page.count,5000);assert.equal(page.has_more,true);assert.equal(JSON.parse(page.next_cursor).id,'30');assert.ok(log.includes('created_at.gt.2026-10-13T00:00:00.123456Z,and(created_at.eq.2026-10-13T00:00:00.123456Z,id.gt.9223372036854775806)'));
});
test('global sort and pagination are validated before calling the photo page transaction',async()=>{
 const calls=[],db={rpc:async(name,args)=>{calls.push({name,args});return{data:{data:[],has_more:false,next_cursor:null,sort:args.p_sort}};}};
 await readPhotoWallPage(db,{sort:'date_asc',limit:'60',cursor:JSON.stringify({sort:'date_asc',id,at:'2026-10-13T00:00:00.123456Z'})});assert.equal(calls[0].args.p_offset,0);assert.equal(calls[0].args.p_sort,'date_asc');assert.equal(calls[0].args.p_cursor.at,'2026-10-13T00:00:00.123456Z');
 for(const query of [{sort:'id;DROP TABLE posts'},{sort:'name',cursor:'{}'},{sort:'views',cursor:JSON.stringify({sort:'views',id,at:'2026-10-13T00:00:00Z',value:'0),id.gt.0'})}])await assert.rejects(readPhotoWallPage(db,query),error=>error.status===400);assert.equal(calls.length,1);
});
test('feed totals and my-like do not derive from capped relation arrays',async()=>{
 const db={rpc:async()=>({data:{posts:[{id,like_count:2500,comment_count:5000,liked_by_me:true}],comments:[{id:1,post_id:id}],likes:[{id:1,post_id:id,user_name:'alice'}]}})};
 const snapshot=await readFeedEngagement(db,[{id,user_name:'alice'}],'alice');assert.equal(snapshot.posts[0].like_count,2500);assert.equal(snapshot.posts[0].comment_count,5000);assert.equal(snapshot.posts[0].liked_by_me,true);assert.equal(snapshot.comments.length,1);assert.equal(snapshot.likes.length,1);
});

test('replying forwards a validated parent id; plain comments keep the original RPC arguments',async()=>{
 const f=fixture();
 const reply=await request(f.app).post('/api/post/comment').set('x-user','bob').send({post_id:id,content:'reply',client_request_id:key,parent_comment_id:'10'}).expect(201);
 assert.equal(reply.body.data.user_name,'bob');assert.deepEqual(f.calls[0].args,{p_post_id:id,p_owner:'bob',p_content:'reply',p_request_id:key,p_kind:'post',p_parent_comment_id:'10'});
 for(const bad of ['abc','-1','1.5','12345678901234567890','1 OR 1=1',{}]){
  const before=f.calls.length;
  await request(f.app).post('/api/post/comment').set('x-user','bob').send({post_id:id,content:'reply',client_request_id:key,parent_comment_id:bad}).expect(400);
  assert.equal(f.calls.length,before,'a malformed parent must be rejected before any write');
 }
 await request(f.app).post('/api/post/comment').set('x-user','bob').send({post_id:id,content:'plain',client_request_id:key,parent_comment_id:null}).expect(201);
 assert.equal('p_parent_comment_id' in f.calls.at(-1).args,false);
});
test('a missing parent surfaces as 404 parent_not_found, never as a top-level comment',async()=>{
 const db={async rpc(){return{data:{ok:false,code:'parent_not_found'}};}};
 await assert.rejects(createComment(db,id,'bob','x',key,'post','10'),error=>error.status===404&&error.code==='parent_not_found'&&/回复的评论/.test(error.message));
});
