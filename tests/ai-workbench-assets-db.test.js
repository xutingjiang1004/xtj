'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const connectionString=process.env.XTJ_TEST_DATABASE_URL;
test('private artifacts isolate accounts, bound storage, resolve concurrent edits and erase deleted identities',{skip:!connectionString,timeout:45000},async t=>{
 const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const admin=new Client({connectionString});await admin.connect();const name='xtj_assets_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const db=new Client({connectionString:url.href});await db.connect();
 const sql='SELECT manage_ai_workbench_asset($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS value';
 try{
  await db.query(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE TABLE posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_name text,media_type text); GRANT SELECT,UPDATE ON posts TO service_role;`);
  await db.query(fs.readFileSync('supabase/migrations/20261014052913_ai_workbench_assets.sql','utf8'));
  const alice=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('alice','__auth__') RETURNING id")).rows[0].id;
  const bob=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('bob','__auth__') RETURNING id")).rows[0].id;
  const params=(op,v={})=>[v.user||'alice',v.account||alice,op,v.id||null,v.kind||'note',v.title||'我的成果',v.data?JSON.stringify(v.data):null,v.updated_at||null];
  const call=async(op,v={})=>(await db.query(sql,params(op,v))).rows[0].value;
  const record=(await call('save',{data:{text:'private original'}})).record;
  await t.test('RLS table and RPC privileges are only available to the authenticated server',async()=>{
   assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='ai_workbench_assets'")).rows[0].relrowsecurity,true);
   for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);try{await assert.rejects(db.query('SELECT * FROM ai_workbench_assets'),/permission denied/);await assert.rejects(call('list'),/permission denied/);}finally{await db.query('RESET ROLE');}}
   await db.query('SET ROLE service_role');try{assert.equal((await call('get',{id:record.id})).record.data.text,'private original');}finally{await db.query('RESET ROLE');}
  });
  await t.test('metadata listing avoids returning all private bodies, and owner substitution fails',async()=>{
   assert.equal((await call('list')).records[0].data,undefined);
   assert.equal((await call('get',{id:record.id,user:'bob',account:bob})).error,'asset_not_found');
   assert.equal((await call('list',{account:bob})).error,'asset_identity_changed');
   assert.equal((await call('save',{id:record.id,data:{text:'x'},account:'admin:alice'})).error,'asset_identity_changed');
  });
  await t.test('concurrent devices cannot overwrite the same saved revision',async()=>{
   const peers=await Promise.all(Array.from({length:3},async()=>{const c=new Client({connectionString:url.href});await c.connect();return c;}));
   try{const results=await Promise.all(peers.map((c,i)=>c.query(sql,params('save',{id:record.id,updated_at:record.updated_at,data:{text:'edit '+i}}))));assert.equal(results.filter(r=>r.rows[0].value.ok).length,1);assert.equal(results.filter(r=>r.rows[0].value.error==='asset_conflict').length,2);}finally{await Promise.all(peers.map(c=>c.end()));}
  });
  await t.test('50-record and 10MiB limits are atomic while existing records remain editable',async()=>{
   for(let i=0;i<49;i++)assert.equal((await call('save',{data:{text:'small '+i}})).ok,true);
   assert.equal((await call('save',{data:{text:'overflow'}})).error,'asset_limit');
   assert.equal((await call('save',{id:record.id,data:{text:'valid replacement'}})).ok,true);
   const large={text:'x'.repeat(1024*1024-30)};
   for(let i=0;i<10;i++)assert.equal((await call('save',{user:'bob',account:bob,data:large})).ok,true);
   assert.equal((await call('save',{user:'bob',account:bob,data:{text:'x'.repeat(400)}})).error,'asset_limit');
   assert.equal((await call('save',{data:{text:'x'.repeat(1024*1024)}})).error,'asset_invalid');
  });
  await t.test('account deletion and nickname reuse never restore earlier private assets',async()=>{
   await db.query('DELETE FROM posts WHERE id=$1',[alice]);const next=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('alice','__auth__') RETURNING id")).rows[0].id;
   assert.equal((await call('list',{account:next})).records.length,0);assert.equal((await call('list')).error,'asset_identity_changed');
   const env=(await call('save',{user:'fixture-admin',account:'admin:fixture-admin',data:{text:'prior'}}));assert.equal(env.ok,true);
   const persistent=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('fixture-admin','__admin_auth__') RETURNING id")).rows[0].id;
   assert.equal((await call('list',{user:'fixture-admin',account:persistent})).records.length,0);
  });
 } finally{await db.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
