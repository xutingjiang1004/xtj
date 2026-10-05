'use strict';
// Runs only against a disposable local PostgreSQL database. No production URL.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {Client,Pool}=require('pg');
const root=path.resolve(__dirname,'..');
async function main(){
 const raw=process.env.AUDIT_DATABASE_URL;
 if(!raw)throw new Error('AUDIT_DATABASE_URL must point to a disposable local PostgreSQL server');
 const url=new URL(raw);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Refusing a non-local database');
 const db='xtj_audit_'+process.pid+'_'+crypto.randomBytes(3).toString('hex');const admin=new Client({connectionString:url.toString()});await admin.connect();
 let c,pool;let checks=0;
 try{
  await admin.query('CREATE DATABASE '+db);url.pathname='/'+db;c=new Client({connectionString:url.toString()});await c.connect();
  await c.query(`DO $$ BEGIN CREATE ROLE anon;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   DO $$ BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   DO $$ BEGIN CREATE ROLE service_role BYPASSRLS;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   CREATE EXTENSION pgcrypto;CREATE SCHEMA extensions;CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
   CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   CREATE PUBLICATION supabase_realtime;`);
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
  for(const f of migrations){try{await c.query(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8').replace(/^\uFEFF/,''));}catch(e){throw new Error('Migration '+f+' failed: '+e.message,{cause:e});}}
  console.log('PASS clean PostgreSQL migration replay ('+migrations.length+' files)');checks++;
  await c.query(`INSERT INTO public.posts(user_name,media_type,content) VALUES ('audit_a','__auth__','{}'),('audit_b','__auth__','{}');`);
  pool=new Pool({connectionString:url.toString(),max:12});
  const modelSql='SELECT public.save_ai_custom_models_snapshot($1,$2::jsonb,$3::jsonb,$4::jsonb,$5) AS result';
  const modelParams=(models=[],deleted=[],prefs={},replace=false)=>['audit_a',JSON.stringify(models),JSON.stringify(deleted),JSON.stringify(prefs),replace];
  const modelSave=async(models=[],deleted=[],prefs={},replace=false)=>(await pool.query(modelSql,modelParams(models,deleted,prefs,replace))).rows[0].result;
  const model=uid=>({uid,model:'fixture',api_key_enc:'encrypted-fixture'});
  await modelSave([model('last')]);let snap=await modelSave([],['last']);assert.equal(snap.models.length,0);
  snap=await modelSave([model('last')],[],{},true);assert.equal(snap.models.length,0);assert.ok(snap.deleted_uids.includes('last'));checks++;console.log('PASS deleting the final model survives stale and legacy snapshots');
  await Promise.all(Array.from({length:8},(_,i)=>modelSave([model('new-'+i)])));
  snap=await modelSave([],[],{research_model:'flash'});assert.equal(snap.models.length,8);assert.equal(snap.ai_prefs.research_model,'flash');
  await Promise.all([modelSave([],['new-0']),modelSave([model('new-0')]),modelSave([model('extra')])]);
  snap=await modelSave();assert.equal(snap.models.length,8);assert.ok(snap.deleted_uids.includes('new-0'));assert.ok(!snap.models.some(m=>m.uid==='new-0'));checks++;console.log('PASS concurrent device mutations preserve all additions and permanent deletions');
  await c.query('BEGIN');await c.query(modelSql,modelParams([model('rolled-back')],['extra']));await c.query('ROLLBACK');
  snap=await modelSave();assert.ok(snap.models.some(m=>m.uid==='extra'));assert.ok(!snap.models.some(m=>m.uid==='rolled-back'));assert.equal((await c.query("SELECT count(*)::int AS count FROM public.posts WHERE user_name='audit_a' AND media_type='__custom_ai_models__'")).rows[0].count,1);checks++;console.log('PASS model snapshot rollback is atomic and leaves exactly one account snapshot');
  for(const role of ['anon','authenticated']){await c.query('SET ROLE '+role);try{await assert.rejects(c.query(modelSql,modelParams()),/permission denied/);}finally{await c.query('RESET ROLE');}}
  await c.query('SET ROLE service_role');try{assert.equal((await c.query(modelSql,modelParams())).rows[0].result.ok,true);}finally{await c.query('RESET ROLE');}checks++;console.log('PASS model mutation RPC is restricted to the server service role');
  const profileOwner=(await c.query("SELECT id FROM public.posts WHERE user_name='audit_a' AND media_type='__auth__'")).rows[0].id;
  const profileSql='SELECT public.save_account_profile_settings($1,$2,$3::jsonb) AS saved';
  const profileSave=async patch=>(await pool.query(profileSql,['audit_a',profileOwner,JSON.stringify(patch)])).rows[0].saved;
  await Promise.all([profileSave({signature:'first'}),profileSave({accent:'blue'}),profileSave({timeline_visible:false}),profileSave({default_visibility:'private'})]);
  const profile=await profileSave({font_size:'large'});assert.equal(profile.signature,'first');assert.equal(profile.accent,'blue');assert.equal(profile.timeline_visible,false);assert.equal(profile.default_visibility,'private');
  await assert.rejects(c.query(profileSql,['audit_b',profileOwner,'{}']),/invalid profile owner/);
  for(const role of ['anon','authenticated']){await c.query('SET ROLE '+role);try{await assert.rejects(c.query('SELECT * FROM public.account_profile_settings'),/permission denied/);await assert.rejects(c.query(profileSql,['audit_a',profileOwner,'{}']),/permission denied/);}finally{await c.query('RESET ROLE');}}
  await c.query('SET ROLE service_role');try{assert.equal((await c.query(profileSql,['audit_a',profileOwner,'{"density":"compact"}'])).rows[0].saved.density,'compact');}finally{await c.query('RESET ROLE');}
  checks++;console.log('PASS account profile settings merge concurrently, verify account identity and deny direct client reads/writes');
  const sqlClaim='SELECT public.claim_ai_search_credit($1,$2,$3,100000::bigint,1000000::bigint,$4) AS result';
  const claim=async(user,id,limit=3)=> (await pool.query(sqlClaim,[user,id,id,limit])).rows[0].result;
  const claims=await Promise.all(Array.from({length:20},()=>claim('audit_a',crypto.randomUUID())));
  assert.equal(claims.filter(x=>x.allowed).length,3);assert.equal((await c.query("SELECT search_used FROM public.ai_user_quota_daily WHERE user_name='audit_a'")).rows[0].search_used,3);checks++;console.log('PASS atomic search budget: 20 concurrent requests grant exactly 3');
  const id=crypto.randomUUID();const once=await claim('audit_b',id);const twice=await claim('audit_b',id);assert.equal(once.allowed,true);assert.equal(twice.duplicate,true);
  await c.query('SELECT public.release_ai_search_credit($1,$2)',['audit_b',id]);await c.query('SELECT public.release_ai_search_credit($1,$2)',['audit_b',id]);assert.equal((await c.query("SELECT search_used FROM public.ai_user_quota_daily WHERE user_name='audit_b'")).rows[0].search_used,0);assert.equal((await claim('audit_b',id)).allowed,false);checks++;console.log('PASS claim retry and refund are idempotent');
  await c.query('BEGIN');await c.query(sqlClaim,['audit_b',crypto.randomUUID(),crypto.randomUUID(),3]);await c.query('ROLLBACK');assert.equal((await c.query("SELECT search_used FROM public.ai_user_quota_daily WHERE user_name='audit_b'")).rows[0].search_used,0);checks++;console.log('PASS rolled-back search claims leave the budget unchanged');
  const job=crypto.randomUUID(),paths=Array.from({length:12},(_,i)=>'photos/a_'+i+'.jpg');
  await Promise.all(paths.map(p=>pool.query('SELECT public.enqueue_storage_cleanup($1,$2,$3,$4)',[job,'uploads',[p],''])));
  const queued=(await c.query('SELECT * FROM public.storage_cleanup_jobs WHERE photo_id=$1',[job])).rows[0];assert.deepEqual([...queued.paths].sort(),[...paths].sort());
  await c.query("UPDATE public.storage_cleanup_jobs SET status='processing',attempts=2,claim_token='stale',lease_until=now()+interval '1 hour' WHERE photo_id=$1",[job]);
  await c.query('SELECT public.enqueue_storage_cleanup($1,$2,$3,$4)',[job,'uploads',['photos/late.jpg'],'']);
  assert.equal((await c.query("UPDATE public.storage_cleanup_jobs SET status='completed' WHERE photo_id=$1 AND claim_token='stale' RETURNING id",[job])).rowCount,0);
  const q2=(await c.query('SELECT * FROM public.storage_cleanup_jobs WHERE photo_id=$1',[job])).rows[0];assert.equal(q2.attempts,2);assert.equal(q2.claim_token,null);assert.equal(q2.paths.length,13);checks++;console.log('PASS concurrent cleanup union and stale-worker lease invalidation');
  await assert.rejects(c.query('SELECT public.enqueue_storage_cleanup($1,$2,$3,$4)',[job,'another-bucket',['x.jpg'],'']),/cleanup_bucket_conflict/);checks++;
  async function register(actor,label){const storage='posts/'+actor+'/'+label+'.jpg',upload=crypto.randomUUID();await c.query('INSERT INTO public.post_media_uploads(storage_path,user_name,upload_id) VALUES($1,$2,$3)',[storage,actor,upload]);return {storage,upload,actor,payload:{user_name:actor,content:'audit',media_url:'https://example.invalid/storage/v1/object/public/uploads/'+storage.split('/').map(encodeURIComponent).join('/'),media_type:'image',actor_key:'shared-device',visibility:'public'}};}
  const postSql='SELECT public.create_post_with_media($1,$2,$3,$4) AS result';const params=u=>[u.actor,u.storage,u.upload,u.payload];
  const u1=await register('audit_a','one'),u2=await register('audit_a','two'),u3=await register('audit_b','three');const posts=[];
  for(const u of [u1,u2,u3]){const r=(await c.query(postSql,params(u))).rows[0].result;assert.equal(r.ok,true);assert.equal(r.duplicate,false);posts.push(r.post.id);}
  assert.equal(new Set(posts).size,3);assert.equal((await c.query(postSql,params(u1))).rows[0].result.post.id,posts[0]);checks++;console.log('PASS same-device multiple posts, shared-device actors, and upload-bound retry');
  const createFirst=await register('audit_a','race-create'),lock=await pool.connect(),next=await pool.connect();
  try{await lock.query('BEGIN');await lock.query(postSql,params(createFirst));const cleanup=next.query('SELECT public.claim_post_media_cleanup($1,$2,$3) AS result',[createFirst.actor,createFirst.storage,createFirst.upload]);await lock.query('COMMIT');assert.equal((await cleanup).rows[0].result.referenced,true);}finally{lock.release();next.release();}
  const cleanupFirst=await register('audit_a','race-cleanup');await c.query('SELECT public.claim_post_media_cleanup($1,$2,$3)',[cleanupFirst.actor,cleanupFirst.storage,cleanupFirst.upload]);assert.equal((await c.query(postSql,params(cleanupFirst))).rows[0].result.code,'media_cleanup');checks++;console.log('PASS cleanup/create transitions are serialized in both orderings');
  const unicode=await register('audit_a','中文');const un=(await c.query(postSql,params(unicode))).rows[0].result;assert.equal(un.ok,true);assert.equal((await c.query('SELECT public.claim_post_media_cleanup($1,$2,$3) AS result',[unicode.actor,unicode.storage,unicode.upload])).rows[0].result.referenced,true);checks++;console.log('PASS encoded Unicode media URLs remain referenced');
  const postRollback=await register('audit_a','rollback');await c.query('BEGIN');await c.query(postSql,params(postRollback));await c.query('ROLLBACK');assert.equal((await c.query('SELECT status FROM public.post_media_uploads WHERE storage_path=$1',[postRollback.storage])).rows[0].status,'pending');checks++;
  const auth=async(ip)=>(await c.query("SELECT public.record_user_auth_event('audit_a','login_success',$1) AS result",[{ip}])).rows[0].result;
  const e1=await auth('1.1.1.1');const geoSql='SELECT public.record_auth_ip_location($1,$2,$3) AS result';assert.equal((await c.query(geoSql,[e1.event_id,'1.1.1.1',{text:'old'}])).rows[0].result.current_updated,true);
  const e2=await auth('2.2.2.2');let info=JSON.parse((await c.query("SELECT content FROM public.posts WHERE user_name='audit_a' AND media_type='__user_info__'")).rows[0].content);assert.equal(info.last_ip_location,null);
  assert.equal((await c.query(geoSql,[e2.event_id,'2.2.2.2',{text:'new'}])).rows[0].result.current_updated,true);assert.equal((await c.query(geoSql,[e1.event_id,'1.1.1.1',{text:'late-old'}])).rows[0].result.current_updated,false);
  info=JSON.parse((await c.query("SELECT content FROM public.posts WHERE user_name='audit_a' AND media_type='__user_info__'")).rows[0].content);assert.equal(info.last_ip_location.text,'new');assert.equal((await c.query(geoSql,[e2.event_id,'9.9.9.9',{text:'spoof'}])).rows[0].result.ok,false);
  const fake=(await c.query("INSERT INTO public.posts(user_name,media_type,content) VALUES('audit_a','__login_event__',$1) RETURNING id",[JSON.stringify({ip:'1.1.1.1',source:'page_visit'})])).rows[0].id;assert.equal((await c.query(geoSql,[fake,'1.1.1.1',{text:'fake'}])).rows[0].result.ok,false);await c.query('DELETE FROM public.posts WHERE id=$1',[e1.event_id]);assert.equal((await c.query(geoSql,[e1.event_id,'1.1.1.1',{text:'deleted'}])).rows[0].result.ok,false);checks++;console.log('PASS authenticated IP history and late geolocation identity fences');
  await c.query('SET ROLE anon');try{await assert.rejects(c.query(sqlClaim,['audit_a',crypto.randomUUID(),crypto.randomUUID(),3]),/permission denied/);await assert.rejects(c.query('SELECT * FROM public.post_media_uploads'),/permission denied/);await assert.rejects(c.query(geoSql,[e2.event_id,'2.2.2.2',{}]),/permission denied/);}finally{await c.query('RESET ROLE');}
  await c.query('SET ROLE service_role');try{assert.equal((await c.query('SELECT public.get_ai_user_quota($1) AS q',['audit_a'])).rows[0].q.ok,true);const sr=await registerService(c);assert.equal(sr.ok,true);}finally{await c.query('RESET ROLE');}checks++;console.log('PASS browser roles denied and service role can execute atomic APIs');
  console.log('DATABASE CHECKS PASSED: '+checks);
 }finally{if(pool)await pool.end();if(c)await c.end();await admin.query('DROP DATABASE IF EXISTS '+db+' WITH (FORCE)');await admin.end();}
}
async function registerService(c){return (await c.query('SELECT public.enqueue_storage_cleanup($1,$2,$3,$4) AS result',[crypto.randomUUID(),'uploads',['photos/service.jpg'],''])).rows[0].result;}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
