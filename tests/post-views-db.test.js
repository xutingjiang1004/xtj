'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{randomUUID}=require('node:crypto');
const dbUrl=process.env.XTJ_TEST_DATABASE_URL;
test('PostgreSQL view transaction: concurrent deduplication, privacy, rollback and service-only privileges',{skip:!dbUrl,timeout:30000},async()=>{
 const base=new URL(dbUrl);assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(base.hostname));
 const admin=new Client({connectionString:dbUrl});await admin.connect();const name='xtj_views_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);base.pathname='/'+name;
 const db=new Client({connectionString:base.href}),other=new Client({connectionString:base.href});await db.connect();await other.connect();
 try{
  await db.query(fs.readFileSync('tests/helpers/post-attachments-db-fixture.sql','utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261004010202_atomic_post_views.sql','utf8'));
  const seed=async(type='album',visibility='public',deleted=false)=>(await db.query('INSERT INTO posts(user_name,media_type,visibility,is_deleted,content) VALUES(\'alice\',$1,$2,$3,$4) RETURNING id',[type,visibility,deleted,JSON.stringify({__type:'__xtj_post_v2__',text:'真实正文'})])).rows[0].id;
  const view=async(id,actor,client=db)=>(await client.query('SELECT record_post_view($1,$2) result',[id,actor])).rows[0].result;
  const id=await seed();const results=await Promise.all(Array.from({length:12},(_,n)=>view(id,'bob',n%2?db:other)));
  assert.equal(results.filter(r=>r.recorded).length,1);assert.ok(results.every(r=>r.views===1));
  assert.equal((await db.query('SELECT count(*)::int n FROM posts WHERE media_type=\'__post_view__\' AND media_url=$1',[id])).rows[0].n,1);
  const history=(await db.query('SELECT actor_key,content::jsonb body FROM posts WHERE media_type=\'__post_view__\' AND media_url=$1',[id])).rows[0];
  assert.match(history.actor_key,/^pview_.*_bob_\d{4}-\d{2}-\d{2}$/);assert.equal(history.body.post_content,'真实正文');
  assert.equal((await view(id,'carol')).views,2);assert.equal((await view(id,'alice')).reason,'self_view');assert.equal((await view(id,'alice')).views,2);
  for(const invisible of [await seed('image','private'),await seed('image','public',true),await seed('__auth__')])assert.equal((await view(invisible,'bob')).code,'post_not_found');
  const old=await seed('text');const key='pview_'+old+'_bob_'+new Date().toISOString().slice(0,10);await db.query("INSERT INTO posts(user_name,media_type,media_url,actor_key) VALUES('bob','__post_view__',$1,$2)",[old,key]);await db.query('UPDATE posts SET views=7 WHERE id=$1',[old]);assert.equal((await view(old,'bob')).views,7);assert.equal((await view(old,'bob')).recorded,false);
  const rollback=await seed();await db.query("CREATE FUNCTION fail_view_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.views IS DISTINCT FROM OLD.views THEN RAISE EXCEPTION 'injected_view_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_view_update BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION fail_view_update();");
  await assert.rejects(view(rollback,'bob'),/injected_view_failure/);assert.equal((await db.query('SELECT count(*)::int n FROM posts WHERE media_type=\'__post_view__\' AND media_url=$1',[rollback])).rows[0].n,0);assert.equal((await db.query('SELECT views FROM posts WHERE id=$1',[rollback])).rows[0].views,0);
  await db.query('DROP TRIGGER fail_view_update ON posts; DROP FUNCTION fail_view_update()');assert.equal((await view(rollback,'bob')).views,1);
  for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);await assert.rejects(view(id,'eve'),e=>e.code==='42501');await db.query('RESET ROLE');}
  await db.query('SET ROLE service_role');assert.equal((await view(id,'eve')).views,3);await db.query('RESET ROLE');
 }finally{await Promise.all([db.end(),other.end()]);await admin.query('DROP DATABASE '+name+' WITH (FORCE)');await admin.end();}
});
