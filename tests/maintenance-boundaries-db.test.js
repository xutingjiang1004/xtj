'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const { Client }=require('pg'),{randomUUID}=require('node:crypto');
const connectionString=process.env.XTJ_TEST_DATABASE_URL;
test('PostgreSQL: account recreation, refresh rotation, hidden messages and photo cleanup serialize across connections',{skip:!connectionString,timeout:30000},async t=>{
 const url=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
 const admin=new Client({connectionString});await admin.connect();const name='xtj_boundaries_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();return c;};const db=await connect();
 try{
  await db.query(fs.readFileSync('tests/helpers/post-attachments-db-fixture.sql','utf8'));
  await db.query(fs.readFileSync('supabase/migrations/033_dm_media_upload_registry.sql','utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20260929133813_chat_core_foundation_v1.sql','utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261005013533_atomic_custom_model_sync.sql','utf8'));
  await db.query('CREATE TABLE photo_upload_registry(storage_path text PRIMARY KEY,user_name text NOT NULL,upload_id text NOT NULL,created_at timestamptz DEFAULT now())');
  await db.query(fs.readFileSync('supabase/migrations/20261009102404_account_sessions_and_atomic_visibility.sql','utf8'));
  const account=async actor=>(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES($1,'__auth__','verifier') RETURNING id",[actor])).rows[0].id;
  const alice=await account('alice');await account('bob');
  await t.test('exactly one connection consumes an old refresh token and failed insert rolls back consumption',async()=>{
   await db.query("INSERT INTO posts(user_name,media_type,media_url,content) VALUES('alice','__refresh_token__','old',$1)",[JSON.stringify({account_id:alice})]);
   const other=await connect();try{
    const rotate=(client,jti)=>client.query("SELECT rotate_user_refresh_token('alice',$1,'old',$2,now()+interval '90 days') result",[alice,jti]);
    const results=await Promise.all([rotate(db,'next-A'),rotate(other,'next-B')]);assert.equal(results.filter(r=>r.rows[0].result.ok).length,1);
    assert.equal((await db.query("SELECT count(*)::int n FROM posts WHERE media_type='__refresh_token__'")).rows[0].n,1);
    await db.query("CREATE UNIQUE INDEX refresh_unique ON posts(media_url) WHERE media_type='__refresh_token__'");
    const existing=(await db.query("SELECT media_url FROM posts WHERE media_type='__refresh_token__'")).rows[0].media_url;
    await db.query("INSERT INTO posts(user_name,media_type,media_url,content) VALUES('alice','__refresh_token__','retry-old',$1)",[JSON.stringify({account_id:alice})]);
    await assert.rejects(db.query("SELECT rotate_user_refresh_token('alice',$1,'retry-old',$2,now()+interval '90 days')",[alice,existing]),e=>e.code==='23505');
    assert.equal((await db.query("SELECT count(*)::int n FROM posts WHERE media_url='retry-old'")).rows[0].n,1);
   }finally{await other.end();}
  });
  await t.test('concurrent hide appends retain both messages and canonical visibility precedes LIMIT',async()=>{
   const ids=[];for(let i=0;i<3;i++)ids.push((await db.query("INSERT INTO posts(user_name,media_url,media_type,content) VALUES('alice','bob','__dm__',$1) RETURNING id",[JSON.stringify({type:'text',text:'private '+i})])).rows[0].id);
   const other=await connect();try{await Promise.all([db.query("SELECT merge_dm_deleted_ids('alice',$1)",[JSON.stringify([ids[0]])]),other.query("SELECT merge_dm_deleted_ids('alice',$1)",[JSON.stringify([ids[1]])])]);}finally{await other.end();}
   const visible=(await db.query("SELECT id FROM read_visible_dm_posts('alice',NULL,NULL,NULL,1)")).rows;assert.equal(visible.length,1);assert.equal(visible[0].id,ids[2]);
   assert.equal((await db.query("SELECT id FROM read_visible_dm_posts('bob')")).rowCount,3);
   await db.query("INSERT INTO chat_message_user_state(message_id,user_id,hidden_at) SELECT $1,id,now() FROM chat_users WHERE user_name='alice' ON CONFLICT(message_id,user_id) DO UPDATE SET hidden_at=now()",[ids[2]]);
   await db.query("SELECT merge_dm_deleted_ids('alice',$1)",[JSON.stringify([ids[0]])]);assert.equal((await db.query("SELECT id FROM read_visible_dm_posts('alice')")).rowCount,0);
  });
  await t.test('publish blocks a racing cleanup; cleanup first permanently fences a later publish',async()=>{
   const path='photos/upload_123456_original.jpg';await db.query("INSERT INTO photo_upload_registry(storage_path,user_name,upload_id) VALUES($1,'alice','upload_123456')",[path]);
   const other=await connect();try{
    await db.query('BEGIN');await db.query("INSERT INTO posts(user_name,media_type,media_url,content) VALUES('alice','__photo_wall__','https://storage/photo',$1)",[JSON.stringify({storagePath:path})]);
    let completed=false;const cleanup=other.query('SELECT claim_photo_cleanup_paths($1) result',[[path]]).then(r=>(completed=true,r));await new Promise(r=>setTimeout(r,50));assert.equal(completed,false);await db.query('COMMIT');assert.deepEqual((await cleanup).rows[0].result.paths,[]);
    const orphan='photos/orphan_123456_original.jpg';await db.query("INSERT INTO photo_upload_registry(storage_path,user_name,upload_id) VALUES($1,'alice','orphan_123456')",[orphan]);assert.deepEqual((await db.query('SELECT claim_photo_cleanup_paths($1) result',[[orphan]])).rows[0].result.paths,[orphan]);
    await assert.rejects(db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__photo_wall__',$1)",[JSON.stringify({storagePath:orphan})]),/cleanup_or_ownership/);
   }finally{await db.query('ROLLBACK');await other.end();}
  });
  await t.test('same-name recreation gets a fresh chat graph and cannot inherit model secrets or old refresh tokens',async()=>{
   const oldChat=(await db.query("SELECT id FROM chat_users WHERE user_name='alice'")).rows[0].id;
   await db.query("SELECT save_ai_custom_models_snapshot('alice',$1,'[]','{}',true,$2)",[JSON.stringify([{uid:'secret-model',api_key_enc:{data:'secret'}}]),alice]);
   await db.query('DELETE FROM posts WHERE id=$1',[alice]);const next=await account('alice');
   assert.notEqual((await db.query("SELECT id FROM chat_users WHERE user_name='alice'")).rows[0].id,oldChat);
   assert.equal((await db.query("SELECT * FROM posts WHERE user_name='alice' AND media_type IN ('__refresh_token__','__custom_ai_models__')")).rowCount,0);
   await assert.rejects(db.query("SELECT save_ai_custom_models_snapshot('alice','[]','[]','{}',true,$1)",[alice]),/account_changed/);
   assert.equal((await db.query("SELECT save_ai_custom_models_snapshot('alice','[]','[]','{}',true,$1) result",[next])).rows[0].result.models.length,0);
   assert.equal((await db.query("SELECT * FROM read_visible_dm_posts('alice')")).rowCount,0);
  });
  await t.test('browser roles cannot invoke service transaction functions',async()=>{for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);await assert.rejects(db.query("SELECT merge_dm_deleted_ids('alice','[]')"),e=>e.code==='42501');await assert.rejects(db.query("SELECT claim_photo_cleanup_paths(ARRAY['photos/x'])"),e=>e.code==='42501');await db.query('RESET ROLE');}});
  await t.test('private uploads remain unreadable despite a legacy permissive storage policy',async()=>{
   await db.query("CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT ON storage.objects TO anon,authenticated;CREATE POLICY legacy_public_read ON storage.objects FOR SELECT TO anon,authenticated USING(true);INSERT INTO storage.buckets VALUES('uploads',true);INSERT INTO storage.objects(bucket_id,name) VALUES('uploads','private.jpg'),('other','public.jpg')");
   await db.query(fs.readFileSync('supabase/migrations/20261009103334_private_uploads_read_boundary.sql','utf8'));
   assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id='uploads'")).rows[0].public,false);
   for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);assert.deepEqual((await db.query('SELECT name FROM storage.objects')).rows.map(x=>x.name),['public.jpg']);await db.query('RESET ROLE');}
  });
 }finally{await db.end();await admin.query('DROP DATABASE '+name+' WITH (FORCE)');await admin.end();}
});
