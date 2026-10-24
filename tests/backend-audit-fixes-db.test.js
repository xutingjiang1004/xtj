'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Client,Pool}=require('pg');
const connectionString=process.env.XTJ_TEST_DATABASE_URL;
test('backend audit fixes on PostgreSQL with all migrations', {skip:!connectionString,timeout:60000},async t=>{
 const url=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
 const admin=new Client({connectionString});await admin.connect();const name='xtj_backend_fix_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const db=new Client({connectionString:url.href});await db.connect();const pool=new Pool({connectionString:url.href,max:4});
 try{
  await db.query(`DO $$ BEGIN CREATE ROLE anon;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   DO $$ BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   DO $$ BEGIN CREATE ROLE service_role BYPASSRLS;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   CREATE EXTENSION pgcrypto;CREATE SCHEMA extensions;CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
   CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid,created_at timestamptz DEFAULT now());ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   CREATE PUBLICATION supabase_realtime;`);
  const migrationDir=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(migrationDir).filter(f=>f.endsWith('.sql')).sort()){
   if(file.endsWith('_backend_account_isolation.sql'))await db.query("INSERT INTO posts(user_name,media_type,actor_key,content,media_url) VALUES ('legacy','__ai_agent_msg__','ai_msg_conv_LEGACY_user_legacy_1','private legacy','{\"role\":\"user\",\"convId\":\"LEGACY\"}')");
   await db.query(fs.readFileSync(path.join(migrationDir,file),'utf8').replace(/^\uFEFF/,''));
  }
  const auth=async user=>(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES($1,'__auth__','{}') RETURNING id",[user])).rows[0].id;
  const insert=async(c,user,owner,conv='ABCDEF',text='private')=>(await c.query("INSERT INTO posts(user_name,ai_account_id,media_type,actor_key,content,media_url) VALUES($1,$2,'__ai_agent_msg__',$3,$4,$5) RETURNING id",[user,owner,'ai_msg_conv_'+conv+'_user_'+user+'_'+randomUUID(),text,JSON.stringify({role:'user',convId:conv})])).rows[0].id;
  await t.test('F7 old account deletion, same-name recreation, search/history/export RPCs and stale writes',async()=>{
   const old=await auth('victim');const id=await insert(db,'victim',old);
   await db.query("INSERT INTO posts(user_name,ai_account_id,media_type,content,media_url) VALUES('victim',$1,'**ai_agent_conv_summary**','private summary','ABCDEF')",[old]);
   await db.query("INSERT INTO ai_search_results(owner_name,ai_account_id,source,source_id,title,snippet,query_hash,search_batch_id) VALUES('victim',$1,'ai_history',$2,'private','private copy','batch','batch')",[old,id]);
   const list=async owner=>(await db.query("SELECT list_ai_conversations('victim',NULL,50,NULL,NULL,NULL,$1) result",[owner])).rows[0].result;
   assert.equal((await list(old)).conversations.length,1);
   await db.query('DELETE FROM posts WHERE id=$1',[old]);const successor=await auth('victim');
   assert.equal((await list(successor)).conversations.length,0);assert.equal((await list(old)).conversations.length,0);
   assert.equal((await db.query("SELECT count(*)::int n FROM posts WHERE ai_account_id=$1",[old])).rows[0].n,0);
   assert.equal((await db.query("SELECT count(*)::int n FROM ai_search_results WHERE owner_name='victim'")).rows[0].n,0);
   for(const op of ['search','export','message','bookmarks_export']){
    const result=(await db.query("SELECT ai_conversation_features('victim',$1,$2,$3) result",[successor,op,JSON.stringify({conversation_id:'ABCDEF',message_id:id})])).rows[0].result;
    assert.deepEqual(result.items||[],[]);
   }
   await assert.rejects(insert(db,'victim',old),/ai_account_changed/);
   await assert.rejects(insert(db,'victim',null),/ai_account_changed/);
   const current=await insert(db,'victim',successor);assert.equal((await list(successor)).conversations[0].message_count,1);
   await assert.rejects(db.query('UPDATE posts SET ai_account_id=$1 WHERE id=$2',[old,current]),/ai_owner_immutable/);
   const legacy=await auth('legacy');assert.equal((await db.query("SELECT list_ai_conversations('legacy',NULL,50,NULL,NULL,NULL,$1) result",[legacy])).rows[0].result.conversations.length,0);
   assert.equal((await db.query("SELECT count(*)::int n FROM posts WHERE user_name='legacy' AND media_type='__ai_agent_msg__' AND ai_account_id IS NULL")).rows[0].n,1,'unattributed data retained');
   assert.ok(await insert(db,'admin-fixture','admin:admin-fixture'));
  });
  await t.test('F7 deletion and writes serialize in both lock orders',async()=>{
   for(const writeFirst of [true,false]){
    const user='race'+writeFirst,owner=await auth(user),a=await pool.connect(),b=await pool.connect();
    try{
     await a.query('BEGIN');
     if(writeFirst){
      await insert(a,user,owner);const deleting=b.query('DELETE FROM posts WHERE id=$1',[owner]);
      await a.query('COMMIT');await deleting;
     }else{
      await a.query('DELETE FROM posts WHERE id=$1',[owner]);const writing=insert(b,user,owner);const rejected=assert.rejects(writing,/ai_account_changed/);
      await a.query('COMMIT');await rejected;
     }
     assert.equal((await db.query('SELECT count(*)::int n FROM posts WHERE ai_account_id=$1',[owner])).rows[0].n,0);
    }finally{await a.query('ROLLBACK');a.release();b.release();}
   }
  });
  const qr=(provider)=>'site-support/'+provider+'_'+randomUUID()+'.png';
  const reg=async p=>db.query('SELECT register_managed_image($1)',[p]);
  const update=async(c,provider,p)=>c.query("SELECT update_author_support('xxz',$1,$2) codes",[provider,p]);
  const claim=async paths=>(await db.query('SELECT claim_managed_image_cleanup($1) result',[paths])).rows[0].result.paths;
  await t.test('F3/F4 first creation and concurrent cross-instance provider updates never lose either channel',async()=>{
   const wechat=qr('wechat'),alipay=qr('alipay');await reg(wechat);await reg(alipay);
   await Promise.all([update(pool,'wechat',wechat),update(pool,'alipay',alipay)]);
   let codes=JSON.parse((await db.query("SELECT content FROM posts WHERE media_type='__admin_meta__' AND media_url='author_support'")).rows[0].content);
   assert.deepEqual(codes,{wechat,alipay});assert.deepEqual(await claim([wechat,alipay]),[]);
   const next=qr('wechat');await reg(next);await update(db,'wechat',next);
   assert.deepEqual(await claim([wechat,next,alipay]),[wechat]);
   await assert.rejects(update(db,'wechat',wechat),/image_retired/);
   codes=JSON.parse((await db.query("SELECT content FROM posts WHERE media_type='__admin_meta__' AND media_url='author_support'")).rows[0].content);assert.deepEqual(codes,{wechat:next,alipay});
   assert.equal((await db.query("SELECT count(*)::int n FROM storage_cleanup_jobs WHERE paths @> to_jsonb($1::text[])",[[wechat]])).rows[0].n,1);
  });
  await t.test('F6 cover/background replacement, clearing and account deletion atomically queue only retired images',async()=>{
   const owner=await auth('profile'),image=()=> 'profile-images/'+('a'.repeat(20))+'/'+randomUUID()+'.png';
   const first=image(),second=image();await reg(first);await reg(second);
   const save=patch=>db.query("SELECT save_account_profile_settings('profile',$1,$2)",[owner,patch]);
   await save({cover_url:'https://fixture/storage/v1/object/public/uploads/'+first,background_url:'https://fixture/storage/v1/object/public/uploads/'+first});
   await save({cover_url:'https://fixture/storage/v1/object/public/uploads/'+second});
   assert.deepEqual(await claim([first,second]),[],'shared background protects first image');
   await save({background_url:''});assert.deepEqual(await claim([first,second]),[first]);
   await db.query('DELETE FROM posts WHERE id=$1',[owner]);assert.deepEqual(await claim([second]),[second]);
   assert.equal((await db.query("SELECT count(*)::int n FROM storage_cleanup_jobs WHERE paths ?| $1::text[]",[[first,second]])).rows[0].n,2);
   const replacement=await auth('profile');await assert.rejects(save({cover_url:'late'}),/invalid profile owner/);assert.notEqual(owner,replacement);
  });
  await t.test('F6 legacy/failed uploads swept without touching referenced or recent objects',async()=>{
   const orphan='profile-images/'+('b'.repeat(20))+'/'+randomUUID()+'.png',recent=qr('alipay');
   await db.query("INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('uploads',$1,now()-interval '2 days'),('uploads',$2,now())",[orphan,recent]);
   const n=(await db.query('SELECT enqueue_managed_image_orphans() n')).rows[0].n;assert.equal(n,1);
   assert.deepEqual(await claim([orphan]),[orphan]);assert.equal((await db.query('SELECT enqueue_managed_image_orphans() n')).rows[0].n,0);
  });
  await t.test('D1 report paging and alert review work and server-only RPC grants remain intact',async()=>{
   const empty=(await db.query("SELECT admin_report_page('pending',NULL,NULL,10) r")).rows[0].r;assert.equal(empty.ok,true);
   const id=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('fixture','__security_alert__','{}') RETURNING id")).rows[0].id;
   await db.query("SELECT review_security_alert($1,'admin','false_positive')",[id]);await db.query("SELECT review_security_alert($1,'admin2','read')",[id]);
   const content=JSON.parse((await db.query('SELECT content FROM posts WHERE id=$1',[id])).rows[0].content);assert.equal(content.false_positive,true);assert.equal(content.reviewed_by,'admin');
   for(const role of ['anon','authenticated']){
    await db.query('SET ROLE '+role);
    try{await assert.rejects(db.query("SELECT update_author_support('xxz','wechat',$1)",[qr('wechat')]),/permission denied/);await assert.rejects(db.query("SELECT list_ai_conversations('victim')"),/permission denied/);await assert.rejects(db.query('SELECT * FROM managed_image_objects'),/permission denied/);}finally{await db.query('RESET ROLE');}
   }
  });
 }finally{await pool.end();await db.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
