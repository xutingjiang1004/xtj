'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withBackendDatabase}=require('./helpers/backend-database-fixture');
test('exact administrative statistics aggregate complete data and valid UTC dates',{skip:!process.env.XTJ_TEST_DATABASE_URL,timeout:60000},()=>withBackendDatabase(async({db})=>{
 await db.query(`INSERT INTO posts(user_name,media_type,content,created_at) SELECT 'author','text','post','2026-10-23T23:59:59.999999Z' FROM generate_series(1,21005);
  INSERT INTO posts(user_name,media_type,content,created_at,is_deleted) VALUES('author','text','deleted','2026-10-23',true);
  INSERT INTO posts(user_name,media_type,content,created_at) VALUES('author','text','{"target_type":"post"}','2026-10-23');
  INSERT INTO posts(user_name,media_type,content,created_at) VALUES('registered','__auth__','{}','2026-10-23T23:59:59.999999Z');
  INSERT INTO posts(user_name,media_type,media_url,content,created_at) VALUES
   ('visitor','__visit__','2026-10-23','{}','2026-10-24'),('visitor','__visit__','','{"date":"2026-10-23"}','2026-10-24'),
   ('attacker','__attack__','CORS','{}','2026-10-23'),('attacker','__attack__','constructor','{"date":"2026-02-30"}','2026-10-23'),
   ('author','__photo_wall__','photos/retained','{}','2026-10-23'),('author','__photo_wall__','photos/deleted','{"__pw_del__":true}','2026-10-23');
  INSERT INTO comments(post_id,user_name,content,created_at) SELECT id,'commenter','comment','2026-10-23' FROM posts WHERE media_type='text' LIMIT 1205;
  INSERT INTO likes(post_id,user_name,created_at) SELECT id,'liker','2026-10-23' FROM posts WHERE media_type='text' LIMIT 1205;`);
 const result=(await db.query("SELECT admin_statistics('2026-10-23','2026-10-23') body")).rows[0].body;
 assert.equal(result.summary.total_posts,21005);assert.equal(result.summary.total_likes,1205);assert.equal(result.summary.total_comments,1205);assert.equal(result.summary.total_users,1);assert.equal(result.summary.total_photos,1);
 assert.equal(result.summary.total_visits,2);assert.equal(result.summary.total_attacks,2);assert.equal(result.summary.firewall_intercepts,1);assert.equal(result.summary.attack_types.constructor,1);assert.equal(result.summary.truncated,false);
 assert.deepEqual(result.daily,[{date:'2026-10-23',posts:21005,likes:1205,comments:1205,new_users:1,visits:2,attacks:2}]);
 for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);try{await assert.rejects(db.query('SELECT admin_statistics()'),/permission denied/);}finally{await db.query('RESET ROLE');}}
 await db.query('SET ROLE service_role');try{assert.equal((await db.query("SELECT admin_statistics('2026-10-24','2026-10-24') body")).rows[0].body.summary.total_visits,0);}finally{await db.query('RESET ROLE');}
}));

test('bigint interaction RPCs preserve exact identifiers across create, preview, replies and cascade',{skip:!process.env.XTJ_TEST_DATABASE_URL,timeout:60000},()=>withBackendDatabase(async({db})=>{
 const post=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','text','hello') RETURNING id")).rows[0].id;
 await db.query("SELECT setval(pg_get_serial_sequence('comments','id'),9007199254740992,true)");
 const key=require('node:crypto').randomUUID(),call=async()=> (await db.query('SELECT xtj_create_comment($1,$2,$3,$4) body',[post,'alice','exact',key])).rows[0].body;
 const first=await call(),replay=await call();assert.equal(first.comment.id,'9007199254740993');assert.equal(replay.comment.id,first.comment.id);assert.equal(replay.created,false);
 await db.query("INSERT INTO comments(id,post_id,user_name,content,parent_comment_id) VALUES(9223372036854775807,$1,'bob','reply',$2)",[post,first.comment.id]);
 await db.query("SELECT setval(pg_get_serial_sequence('likes','id'),9007199254740992,true)");
 const liked=(await db.query('SELECT xtj_set_post_like($1,$2,true) body',[post,'alice'])).rows[0].body;assert.equal(liked.my_like.id,'9007199254740993');
 const snapshot=(await db.query('SELECT xtj_feed_engagement(ARRAY[$1::uuid],$2) body',[post,'alice'])).rows[0].body;
 assert.deepEqual(snapshot.comments.map(c=>c.id),['9007199254740993','9223372036854775807']);assert.equal(snapshot.comments[1].parent_comment_id,first.comment.id);assert.equal(snapshot.likes[0].id,liked.my_like.id);
 const deleted=(await db.query('SELECT xtj_delete_comment($1,$2) body',[first.comment.id,'alice'])).rows[0].body;
 assert.equal(deleted.deleted_comment_id,first.comment.id);assert.deepEqual(deleted.deleted_comment_ids,['9007199254740993','9223372036854775807']);assert.equal((await db.query('SELECT count(*) FROM comments')).rows[0].count,'0');
 assert.equal((await db.query('SELECT xtj_delete_comment($1,$2) body',[first.comment.id,'alice'])).rows[0].body.deleted_comment_ids[0],first.comment.id);
}));

test('lost refresh responses recover only the same request while logout, consumption, expiry and account deletion invalidate receipts',{skip:!process.env.XTJ_TEST_DATABASE_URL,timeout:60000},()=>withBackendDatabase(async({db,pool})=>{
 const {randomUUID,createHash}=require('node:crypto');
 const account=(await db.query("INSERT INTO posts(user_name,media_type,content,created_at) VALUES('alice','__auth__','{}',now()-interval '1 day') RETURNING id")).rows[0].id;
 const hash=()=>createHash('sha256').update(randomUUID()).digest('hex');
 async function seed(){const jti=randomUUID();await db.query("INSERT INTO posts(user_name,media_type,media_url,actor_key,content) VALUES('alice','__refresh_token__',$1,$2,$3)",[jti,'rt_'+jti,JSON.stringify({jti,account_id:account,expires_at:new Date(Date.now()+86400000).toISOString()})]);return jti;}
 const candidate=()=>({type:'user_refresh',user_name:'alice',account_id:account,jti:randomUUID(),exp:Date.now()+86400000});
 const rotate=async(old,nonce,payload=candidate(),client=db)=>(await client.query('SELECT rotate_user_refresh_token_v2($1,$2,$3,$4,$5) body',['alice',account,old,nonce,payload])).rows[0].body;
 const legacy=await seed(),legacyNext=candidate();assert.equal((await db.query('SELECT rotate_user_refresh_token($1,$2,$3,$4,$5) body',['alice',account,legacy,legacyNext.jti,new Date(legacyNext.exp)])).rows[0].body.ok,true);
 assert.equal((await db.query('SELECT rotate_user_refresh_token($1,$2,$3,$4,$5) body',['alice',account,legacy,randomUUID(),new Date(legacyNext.exp)])).rows[0].body.code,'token_reused','legacy committed response loss is unrecoverable');
 const old=await seed(),nonce=hash(),first=await rotate(old,nonce);assert.equal(first.ok,true);assert.equal(first.recovered,false);
 const recovered=await rotate(old,nonce);assert.equal(recovered.recovered,true);assert.deepEqual(recovered.successor,first.successor);
 assert.equal((await rotate(old,hash())).ok,false,'a valid old Cookie alone or a different nonce cannot recover');
 assert.equal((await db.query("SELECT count(*) FROM posts WHERE media_type='__refresh_token__' AND media_url=$1",[first.successor.jti])).rows[0].count,'1');
 const concurrentOld=await seed(),concurrentNonce=hash(),both=await Promise.all([rotate(concurrentOld,concurrentNonce,candidate(),pool),rotate(concurrentOld,concurrentNonce,candidate(),pool)]);assert.equal(new Set(both.map(r=>r.successor.jti)).size,1);assert.equal(both.filter(r=>r.recovered).length,1);
 await db.query('SELECT revoke_user_refresh_session($1,$2,$3)',['alice',account,old]);assert.equal((await rotate(old,nonce)).ok,false,'logout with the lost-response predecessor revokes its successor');
 const consumedOld=await seed(),consumedNonce=hash(),consumed=await rotate(consumedOld,consumedNonce);await rotate(consumed.successor.jti,hash());assert.equal((await rotate(consumedOld,consumedNonce)).ok,false,'cannot rewind to a consumed successor');
 const expiredOld=await seed(),expiredNonce=hash();await rotate(expiredOld,expiredNonce);await db.query("UPDATE xtj_private.refresh_rotation_receipts SET expires_at=now()-interval '1 second' WHERE old_jti=$1",[expiredOld]);assert.equal((await rotate(expiredOld,expiredNonce)).ok,false);
 for(const rotationFirst of [true,false]){
  const racedOld=await seed(),racedNonce=hash(),holder=await pool.connect();
  try{
   await holder.query('BEGIN');
   if(rotationFirst)await rotate(racedOld,racedNonce,candidate(),holder);else await holder.query('SELECT revoke_user_refresh_session($1,$2,$3)',['alice',account,racedOld]);
   let settled=false;const waiting=(rotationFirst?pool.query('SELECT revoke_user_refresh_session($1,$2,$3) body',['alice',account,racedOld]):rotate(racedOld,racedNonce,candidate(),pool)).then(value=>{settled=true;return value});
   await new Promise(r=>setTimeout(r,30));assert.equal(settled,false,'opposite operation waits for the predecessor transaction');await holder.query('COMMIT');const result=await waiting;if(!rotationFirst)assert.equal(result.ok,false);
   assert.equal((await rotate(racedOld,racedNonce)).ok,false,'logout wins in both transaction orderings');
  }finally{await holder.query('ROLLBACK');holder.release();}
 }
 for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);try{await assert.rejects(rotate(concurrentOld,concurrentNonce),/permission denied/);await assert.rejects(db.query('SELECT * FROM xtj_private.refresh_rotation_receipts'),/permission denied/);}finally{await db.query('RESET ROLE');}}
 await db.query('DELETE FROM posts WHERE id=$1',[account]);assert.equal((await db.query('SELECT count(*) FROM xtj_private.refresh_rotation_receipts')).rows[0].count,'0');
 assert.equal((await rotate(concurrentOld,concurrentNonce)).ok,false);
}));

test('real capped PostgREST and HTTP routes preserve full statistics, bigint pages and lost-refresh acknowledgements',{skip:!process.env.XTJ_TEST_POSTGREST||!process.env.XTJ_TEST_DATABASE_URL,timeout:60000},()=>withBackendDatabase(async({db,connectionString})=>{
 const {withLocalPostgrest}=require('./helpers/backend-postgrest-fixture');
 await withLocalPostgrest(connectionString,async sb=>{
  const express=require('express'),request=require('supertest'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
  await db.query("INSERT INTO posts(user_name,media_type,content) SELECT 'author','text','hello' FROM generate_series(1,21005)");
  const raw=await sb.from('posts').select('id').eq('media_type','text').limit(20000);assert.equal(raw.data.length,1000);
  const stats=await sb.rpc('admin_statistics',{p_start:null,p_end:null});assert.equal(stats.error,null);assert.equal(stats.data.summary.total_posts,21005);
  const post=(await db.query('SELECT id FROM posts LIMIT 1')).rows[0].id;
  await db.query("INSERT INTO comments(id,post_id,user_name,content,created_at) SELECT 9007199254740992+i,$1,'author','comment '||i,'2026-10-24' FROM generate_series(0,2) i",[post]);
  const {readRelationPage}=require('../render-api/post-interactions');let cursor=null;const seen=[];
  for(let i=0;i<3;i++){const p=await readRelationPage(sb,post,'comments',{limit:1,cursor});assert.equal(p.error,undefined);seen.push(p.data[0].id);cursor=p.next_cursor;}assert.deepEqual(seen,['9007199254740992','9007199254740993','9007199254740994']);assert.equal(cursor,null);
  const photo=(await db.query("INSERT INTO posts(user_name,media_type,content,visibility,media_url) VALUES('alice','__photo_wall__','{}','public','photos/original') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO comments(id,post_id,user_name,content,created_at) SELECT 9223372036854775807-i,$1,'author','photo '||i,'2026-10-24' FROM generate_series(0,31) i",[photo]);
  const app=express();app.use(express.json());require('../render-api/photo-social').installPhotoSocial(app,{supabase:sb,authenticateUser(req,res,next){req.userName='alice';next()},rateLimit:()=> (req,res,next)=>next(),userBanError:()=>null});
  const first=(await request(app).get('/api/photo/'+photo+'/social').expect(200)).body;assert.equal(first.comments[0].id,'9223372036854775807');
  const second=(await request(app).get('/api/photo/'+photo+'/social').query({before:first.next_cursor,known:first.comments[0].id}).expect(200)).body;assert.equal(second.comments.length,2);assert.equal(second.retained_comments[0].id,'9223372036854775807');assert.equal(new Set([...first.comments,...second.comments].map(r=>r.id)).size,32);
  const auth=(await db.query("INSERT INTO posts(user_name,media_type,content,created_at) VALUES('alice','__auth__','{}',now()-interval '1 day') RETURNING id,created_at")).rows[0];
  let loseResponse=true;const backing=sb.rpc.bind(sb);sb.rpc=async(...args)=>{const result=await backing(...args);if(args[0]==='rotate_user_refresh_token_v2'&&loseResponse){assert.equal(result.error,null);assert.equal(result.data.ok,true);loseResponse=false;return{error:{code:'08006'}};}return result;};
  const source=fs.readFileSync('render-api/server.js','utf8'),context=vm.createContext({app,supabase:sb,crypto,Buffer,API_SECRET:'local-test-signing-key',ADMIN_USERNAME:'xxz',securityRateLimit:()=> (req,res,next)=>next(),refreshTokenInUse:new Set(),console,
   verifyUserRefreshToken:undefined,async loadUserRestrictions(){return{}},async readAccountIdentity(){return auth},matchesAccount:require('../render-api/account-identity').matchesAccount,_getDeviceIdFromRequest:()=>'',setPhotoSession(){},
   async checkRefreshTokenRevoked(token){const p=context.verifyUserRefreshToken(token),r=await sb.from('posts').select('id').eq('media_type','__refresh_token__').eq('media_url',p.jti);return{revoked:!r.data?.length,uncertain:!!r.error};}});
  vm.runInContext(source.slice(source.indexOf('function _signPayload('),source.indexOf('// ===== Refresh Token 持久化存储')),context);
  const start=source.indexOf("app.post('/api/user/refresh',");vm.runInContext(source.slice(start,source.indexOf('// 用户登出',start)),context);
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  // The mounted real refresh route reads Cookies; populate them before calling
  // its final handler to retain the actual Express response implementation.
  const route=app.router.stack.find(layer=>layer.route?.path==='/api/user/refresh').route.stack.at(-1).handle;
  const handler=async(token,nonce)=>{const response={statusCode:200,cookies:[],status(n){this.statusCode=n;return this},clearCookie(){throw Error('must not clear a successor Cookie')},cookie(name,value){this.cookies.push({name,value});return this},json(body){this.body=body;return this}};await route({body:{refresh_request_id:nonce},cookies:{xtj_user_refresh:token}},response);return response};
  const old=context.signUserRefreshToken('alice','',auth.id),oldClaims=context.verifyUserRefreshToken(old);
  await db.query("INSERT INTO posts(user_name,media_type,media_url,content,actor_key) VALUES('alice','__refresh_token__',$1,$2,$3)",[oldClaims.jti,JSON.stringify({account_id:auth.id,expires_at:new Date(oldClaims.exp).toISOString()}),'rt_'+oldClaims.jti]);
  const nonce=crypto.randomUUID();assert.equal((await handler(old,nonce)).statusCode,503);const recovered=await handler(old,nonce);assert.equal(recovered.statusCode,200);assert.equal(recovered.body.user_name,'alice');assert.equal((await handler(old,crypto.randomUUID())).statusCode,409);assert.equal((await handler(old,undefined)).statusCode,409);
  Object.assign(context,{rateLimit:()=> (req,res,next)=>next(),_getTokenFromRequest:()=>'',PHOTO_COOKIE:'xtj_photo_session',POST_MEDIA_COOKIE:'xtj_post_media_session',REFRESH_TOKEN_MARKER:'__refresh_token__'});
  const logoutStart=source.indexOf("app.post('/api/user/logout',");vm.runInContext(source.slice(logoutStart,source.indexOf('// 验证 token 是否有效',logoutStart)),context);
  const logoutRoute=app.router.stack.find(layer=>layer.route?.path==='/api/user/logout').route.stack.at(-1).handle;
  const legacyClaims={user_name:'alice',type:'user_refresh',jti:crypto.randomUUID(),exp:Date.now()+90*86400000},legacy=context._signPayload(legacyClaims),legacyNonce=crypto.randomUUID();
  await db.query("INSERT INTO posts(user_name,media_type,media_url,content,actor_key) VALUES('alice','__refresh_token__',$1,$2,$3)",[legacyClaims.jti,JSON.stringify({expires_at:new Date(legacyClaims.exp).toISOString()}),'rt_'+legacyClaims.jti]);
  assert.equal((await handler(legacy,legacyNonce)).statusCode,200,'legacy sessions may rotate without losing account identity');
  const out={statusCode:200,status(n){this.statusCode=n;return this},clearCookie(){return this},json(body){this.body=body;return this}};
  await logoutRoute({body:{},cookies:{xtj_user_refresh:legacy}},out);assert.equal(out.statusCode,200);assert.equal((await handler(legacy,legacyNonce)).statusCode,409,'logout must invalidate even an accountless legacy predecessor receipt');
  const saved=context.verifyUserRefreshToken(recovered.cookies.find(c=>c.name==='xtj_user_refresh').value);assert.equal((await db.query("SELECT count(*) FROM posts WHERE media_type='__refresh_token__' AND media_url=$1",[saved.jti])).rows[0].count,'1');
 });
}));
