'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),express=require('express'),request=require('supertest');
const attachments=require('../render-api/post-attachments'),{parsePostMediaUrl,isLocalUploadUrl}=require('../render-api/post-media'),{isNormalPost}=require('../render-api/post-query');
const source=fs.readFileSync('render-api/server.js','utf8'),origin='https://project.supabase.co';
const id=n=>`8c1cb02d-74d0-4e45-9e15-${String(n).padStart(12,'0')}`;
const picture=(post,n)=>({id:'media-'+post+'-'+n,post_id:post,position:n,media_type:'image',media_url:origin+`/storage/v1/object/public/uploads/posts/${post}-${n}.png`,storage_path:`posts/${post}-${n}.png`,upload_id:'upload-id-'+post+'-'+n,width:400,height:300,file_size:100});
function fixture(){
 const posts=[{id:id(1),user_name:'alice',content:'公开',visibility:'public',media_type:'album',media_url:picture(id(1),0).media_url,created_at:'2026-10-03T00:00:00Z',views:7},{id:id(2),user_name:'alice',content:'私密',visibility:'private',media_type:'album',media_url:picture(id(2),0).media_url,created_at:'2026-10-02T00:00:00Z'},{id:id(3),user_name:'alice',content:'已删除',visibility:'public',media_type:'album',is_deleted:true,created_at:'2026-10-01T00:00:00Z'},{id:id(4),user_name:'alice',media_type:'__dm__',visibility:'public',created_at:'2026-10-01T00:00:00Z'}];
 const media=posts.flatMap(p=>[picture(p.id,0),picture(p.id,1)]),comments=Array.from({length:501},(_,n)=>({id:'c-'+String(n).padStart(4,'0'),post_id:id(1),user_name:n===500?'cat_ai':'alice',content:'comment-'+n,parent_comment_id:n>0?'c-0000':null,generated_by_ai:n===500,created_at:'2026-10-03'})),likes=Array.from({length:55},(_,n)=>({id:'l-'+n,post_id:id(1),user_name:n===54?'alice':'bob-'+n,created_at:String(n)}));
 const reads=[],rpc=[];let failAttachments=false;const db={from(table){let predicates=[],lo=0,hi=Infinity,fields='*',single=false;const q={select(f){fields=f;return q;},eq(k,v){predicates.push(r=>r[k]===v);return q;},in(k,values){if(table==='post_attachments')reads.push(Array.from(values));predicates.push(r=>values.includes(r[k]));return q;},or(expr){if(expr.startsWith('media_type.'))predicates.push(isNormalPost);else if(expr.startsWith('is_deleted.'))predicates.push(r=>r.is_deleted!==true);else if(expr.startsWith('visibility.')){const user=expr.match(/user_name\.eq\."?([^" ,]+)"?/)[1];predicates.push(r=>r.visibility==='public'||r.user_name===user);}return q;},order(){return q;},limit(n){hi=n-1;return q;},range(a,b){lo=a;hi=b;return q;},maybeSingle(){single=true;return q;},then(a,b){if(table==='post_attachments'&&failAttachments)return Promise.resolve({error:Error('offline')}).then(a,b);const all=({posts,post_attachments:media,comments,likes}[table]||[]).filter(r=>predicates.every(f=>f(r)));let data=all.slice(lo,hi+1).map(r=>fields==='*'?{...r}:Object.fromEntries(fields.split(',').map(k=>k.trim()).map(k=>[k,r[k]])));if(single)data=data[0]||null;return Promise.resolve({data,count:all.length}).then(a,b);}};return q;},async rpc(name,args){rpc.push({name,args});return{data:{ok:true,post:{id:id(9),...args.p_payload},attachments:args.p_attachments.map(x=>({...x,post_id:id(9)}))}};}};
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.userName=req.get('x-user')||'';next();};
 const context={console,app,supabase:db,optionalAuth:auth,authenticateUser:(req,res,next)=>req.get('x-user')?auth(req,res,next):res.sendStatus(401),rateLimit:()=>auth,userBanError:()=>null,...attachments,parsePostMediaUrl,isLocalUploadUrl,isNormalPost,SUPABASE_URL:origin,ADMIN_USERNAME:'xxz',pgrstQuote:v=>'"'+v+'"',looksLikeSystemTelemetry:()=>false,getClientIp:()=>'',isPrivateOrReservedIp:()=>false,resolveIpRegion:async()=>({status:'pending'}),sanitizeError:e=>e.message};vm.createContext(context);
 const start=source.indexOf('async function readPostDetailComments('),end=source.indexOf('async function aiSiteCreateConfirmation(',start);vm.runInContext(source.slice(start,end),context);
 const feed=source.indexOf("app.get('/api/feed'"),feedEnd=source.indexOf('// ===================== 照片墙接口',feed);vm.runInContext(source.slice(feed,feedEnd),context);
 const create=source.indexOf("app.post('/api/post/create'"),createEnd=source.indexOf("app.post('/api/post/update'",create);vm.runInContext(source.slice(create,createEnd),context);
 return{app,reads,rpc,posts,media,comments,setFailAttachments(v){failAttachments=v;}};
}
test('real Detail route never queries or exposes private, deleted or system attachments to an unauthorized caller',async()=>{
 const f=fixture();for(const actor of ['', 'bob'])await request(f.app).get('/api/post/detail/'+id(2)).set('x-user',actor).expect(404);assert.deepEqual(f.reads,[]);
 await request(f.app).get('/api/post/detail/'+id(3)).expect(422);await request(f.app).get('/api/post/detail/'+id(4)).expect(422);assert.deepEqual(f.reads,[]);
 const own=await request(f.app).get('/api/post/detail/'+id(2)).set('x-user','alice').expect(200);assert.equal(own.body.post.media_items.length,2);assert.deepEqual(f.reads,[[id(2)]]);assert.ok(own.body.post.media_items.every(x=>!('storage_path'in x)&&!('upload_id'in x)));
});
test('real Feed route batches only public/own attachments and fails explicitly on attachment outage',async()=>{
 const f=fixture();const anon=await request(f.app).get('/api/feed').expect(200);assert.deepEqual(anon.body.posts.map(p=>p.id),[id(1)]);assert.deepEqual(f.reads,[[id(1)]]);
 const own=await request(f.app).get('/api/feed').set('x-user','alice').expect(200);assert.deepEqual(own.body.posts.map(p=>p.id),[id(1),id(2)]);assert.deepEqual(f.reads.at(-1),[id(1),id(2)]);
 f.setFailAttachments(true);const unavailable=await request(f.app).get('/api/feed').expect(503);assert.equal(unavailable.body.retryable,true);await request(f.app).get('/api/post/detail/'+id(1)).expect(503);
});
test('Detail paginates complete replies past 500 and preserves AI/parent fields, actual views and older own-like state',async()=>{
 const f=fixture();const res=await request(f.app).get('/api/post/detail/'+id(1)).set('x-user','alice').expect(200);
 assert.equal(res.body.comments.length,501);assert.equal(res.body.comments.at(-1).generated_by_ai,true);assert.equal(res.body.comments.at(-1).parent_comment_id,'c-0000');assert.equal(res.body.post.views,7);assert.equal(res.body.post.like_count,55);assert.equal(res.body.post.liked_by_me,true);assert.equal(res.body.post.comment_count,501);
});
test('real Create route derives author and cover server-side and rejects oversized/mixed/duplicate attachment sets',async()=>{
 const f=fixture(),items=[picture(id(1),0),picture(id(1),1)];
 await request(f.app).post('/api/post/create').send({attachments:items}).expect(401);
 const res=await request(f.app).post('/api/post/create').set('x-user','alice').send({user_name:'xxz',content:'真正多图',media_url:'https://evil.example/cover',media_type:'album',visibility:'private',attachments:items}).expect(201);
 assert.equal(res.body.data.user_name,'alice');assert.equal(res.body.data.media_url,items[0].media_url);assert.equal(f.rpc.length,1);assert.equal(f.rpc[0].name,'create_post_with_attachments');assert.equal(f.rpc[0].args.p_attachments.length,2);
 for(const body of [{attachments:Array.from({length:19},(_,n)=>picture(id(1),n))},{attachments:items,media_type:'video'},{attachments:[items[0],items[0]]}])await request(f.app).post('/api/post/create').set('x-user','alice').send(body).expect(400);
 assert.equal(f.rpc.length,1);
});
