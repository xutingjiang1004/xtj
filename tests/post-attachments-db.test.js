'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{randomUUID}=require('node:crypto');
const {MAX_POST_IMAGES}=require('../js/post-media');
const dbUrl=process.env.XTJ_TEST_DATABASE_URL;
const migration=fs.readFileSync('supabase/migrations/20261003063955_post_attachments.sql','utf8');
test('PostgreSQL: atomic attachments, cleanup races, deletion rollback and privileges', {skip:!dbUrl,timeout:30000}, async t=>{
  const base=new URL(dbUrl);assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(base.hostname),'Database tests must use a local disposable database');
  const dbName='xtj_attachments_'+randomUUID().replaceAll('-','');const admin=new Client({connectionString:dbUrl});await admin.connect();await admin.query('CREATE DATABASE '+dbName);
  const url=new URL(dbUrl);url.pathname='/'+dbName;
  const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();return c;};const db=await connect();
  try {
    await db.query(fs.readFileSync('tests/helpers/post-attachments-db-fixture.sql','utf8'));
    const atomic=fs.readFileSync('supabase/migrations/20261002012142_atomic_audit_operations.sql','utf8');
    let a=atomic.indexOf('CREATE OR REPLACE FUNCTION public.enqueue_storage_cleanup');if(a<0)a=atomic.indexOf('CREATE FUNCTION public.enqueue_storage_cleanup');
    await db.query(atomic.slice(a,atomic.indexOf('-- Deny remains',a)));await db.query(migration);
    async function seed(count,actor='alice') {
      const prefix=randomUUID();const items=Array.from({length:count},(_,n)=>({position:n,media_type:'image',storage_path:`posts/${prefix}-${n}.png`,upload_id:randomUUID(),media_url:`https://project.supabase.co/storage/v1/object/public/uploads/posts/${prefix}-${n}.png`,width:400,height:300,file_size:100}));
      for(const x of items){await db.query('INSERT INTO post_media_uploads(storage_path,user_name,upload_id) VALUES($1,$2,$3)',[x.storage_path,actor,x.upload_id]);await db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('uploads',$1,$2)",[x.storage_path,{size:100,mimetype:'image/png'}]);}return items;
    }
    const create=async(items,actor='alice',client=db)=> (await client.query('SELECT create_post_with_attachments($1,$2,$3,$4) AS result',[actor,{user_name:actor,content:'正文',actor_key:'same-device',visibility:'private'},JSON.stringify(items),MAX_POST_IMAGES])).rows[0].result;
    const count=async table=>(await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n;
    for(const n of [1,2,3,4,6,9,15,18])await t.test(`${n} originals attach atomically with an ordered cover and a retry creates no duplicate`,async()=>{
      const items=await seed(n),saved=await create(items);assert.equal(saved.ok,true);assert.equal(saved.attachments.length,n);assert.equal(saved.post.media_url,items[0].media_url);assert.equal(saved.post.media_type,n>1?'album':'image');assert.equal(saved.post.visibility,'private');
      assert.deepEqual(saved.attachments.map(x=>x.position),items.map(x=>x.position));assert.ok(saved.attachments.every(x=>!('storage_path' in x)));assert.equal((await create(items)).post.id,saved.post.id);
      assert.equal((await db.query('SELECT count(*)::int n FROM post_media_uploads WHERE attached_post_id=$1 AND status=\'attached\'',[saved.post.id])).rows[0].n,n);
    });
    await t.test('too many files, ownership theft, mixed files and missing Nth upload create nothing',async()=>{
      const before=await count('posts');const tooMany=await seed(MAX_POST_IMAGES+1);assert.equal((await create(tooMany)).ok,false);
      const stolen=await seed(2,'bob');assert.equal((await create(stolen)).code,'media_ownership');
      const mixed=await seed(2);mixed[1].media_type='video';assert.equal((await create(mixed)).ok,false);
      const incomplete=await seed(6);await db.query('DELETE FROM storage.objects WHERE name=$1',[incomplete[3].storage_path]);assert.equal((await create(incomplete)).code,'media_not_uploaded');assert.equal(await count('posts'),before);
      assert.equal((await db.query('SELECT count(*)::int n FROM post_media_uploads WHERE storage_path=ANY($1) AND status=\'pending\'',[incomplete.map(x=>x.storage_path)])).rows[0].n,6);
    });
    await t.test('a database failure on attachment N rolls back post, earlier attachments and all registration updates',async()=>{
      const items=await seed(6),before=await count('posts');await db.query("CREATE FUNCTION fail_attachment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.position=3 THEN RAISE EXCEPTION 'injected_attachment_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_attachment BEFORE INSERT ON post_attachments FOR EACH ROW EXECUTE FUNCTION fail_attachment();");
      await assert.rejects(create(items),/injected_attachment_failure/);assert.equal(await count('posts'),before);assert.equal((await db.query('SELECT count(*)::int n FROM post_attachments WHERE storage_path=ANY($1)',[items.map(x=>x.storage_path)])).rows[0].n,0);
      assert.equal((await db.query('SELECT count(*)::int n FROM post_media_uploads WHERE storage_path=ANY($1) AND status=\'pending\'',[items.map(x=>x.storage_path)])).rows[0].n,6);await db.query('DROP TRIGGER fail_attachment ON post_attachments;DROP FUNCTION fail_attachment()');
    });
    await t.test('failed deletion retains post/media and rolls back cleanup; successful deletion queues every original',async()=>{
      const items=await seed(18),saved=await create(items);await db.query("CREATE FUNCTION fail_post_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_delete_failure'; END $$; CREATE TRIGGER zzz_fail_delete BEFORE DELETE ON posts FOR EACH ROW EXECUTE FUNCTION fail_post_delete();");
      await assert.rejects(db.query('SELECT hard_delete_content($1,$2,false,false,NULL,$3)',[saved.post.id,'alice',JSON.stringify([items[0].storage_path])]),/injected_delete_failure/);
      assert.equal((await db.query('SELECT count(*)::int n FROM post_attachments WHERE post_id=$1',[saved.post.id])).rows[0].n,18);assert.equal((await db.query('SELECT count(*)::int n FROM storage_cleanup_jobs WHERE photo_id=$1',[saved.post.id])).rows[0].n,0);
      await db.query('DROP TRIGGER zzz_fail_delete ON posts; DROP FUNCTION fail_post_delete()');
      const forbidden=(await db.query("SELECT hard_delete_content($1,'bob',false,false,NULL,'[]') result",[saved.post.id])).rows[0].result;assert.equal(forbidden.code,'forbidden');
      const deleted=(await db.query('SELECT hard_delete_content($1,$2,false,false,NULL,$3) result',[saved.post.id,'alice',JSON.stringify([items[0].storage_path])])).rows[0].result;assert.equal(deleted.ok,true);
      const job=(await db.query('SELECT paths,status FROM storage_cleanup_jobs WHERE photo_id=$1',[saved.post.id])).rows[0];assert.deepEqual(new Set(job.paths),new Set(items.map(x=>x.storage_path)));assert.equal(job.status,'pending');
      assert.equal((await db.query('SELECT count(*)::int n FROM post_attachments WHERE post_id=$1',[saved.post.id])).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects WHERE name=ANY($1)',[items.map(x=>x.storage_path)])).rows[0].n,18,'Deletion queues Storage work, never removes objects before DB commit');
    });
    await t.test('legacy registered video and unregistered cover deletion still use durable cleanup',async()=>{
      const items=await seed(1);const row=(await db.query("INSERT INTO posts(user_name,media_type,media_url) VALUES('alice','video',$1) RETURNING id",[items[0].media_url])).rows[0];await db.query("UPDATE post_media_uploads SET attached_post_id=$1,status='attached',media_url=$2 WHERE storage_path=$3",[row.id,items[0].media_url,items[0].storage_path]);await db.query('DELETE FROM posts WHERE id=$1',[row.id]);assert.deepEqual((await db.query('SELECT paths FROM storage_cleanup_jobs WHERE photo_id=$1',[row.id])).rows[0].paths,[items[0].storage_path]);
      const old=(await db.query("INSERT INTO posts(user_name,media_type,media_url) VALUES('alice','image','https://project.supabase.co/storage/v1/object/public/uploads/posts/legacy.jpg') RETURNING id")).rows[0];await db.query("SELECT hard_delete_content($1,'alice',false,false,NULL,'[\"posts/legacy.jpg\"]')",[old.id]);assert.deepEqual((await db.query('SELECT paths FROM storage_cleanup_jobs WHERE photo_id=$1',[old.id])).rows[0].paths,['posts/legacy.jpg']);
    });
    await t.test('concurrent attach and cleanup serialize on each registration; committed media cannot be cleaned',async()=>{
      const items=await seed(3),other=await connect();try{await db.query('BEGIN');const saved=await create(items);let resolved=false;const cleanup=other.query('SELECT claim_post_media_cleanup($1,$2,$3) result',['alice',items[1].storage_path,items[1].upload_id]).then(r=>{resolved=true;return r.rows[0].result});await new Promise(r=>setTimeout(r,40));assert.equal(resolved,false);await db.query('COMMIT');assert.equal((await cleanup).referenced,true);assert.equal(saved.ok,true);}finally{await db.query('ROLLBACK');await other.end();}
      const pending=await seed(2);assert.equal((await db.query('SELECT claim_post_media_cleanup($1,$2,$3) result',['alice',pending[1].storage_path,pending[1].upload_id])).rows[0].result.referenced,false);assert.equal((await create(pending)).code,'media_cleanup');
    });
    await t.test('anonymous and browser authenticated roles cannot read private attachments or write/invoke the service RPC',async()=>{
      for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);for(const query of ['SELECT * FROM post_attachments','INSERT INTO post_attachments(post_id,position,media_type,media_url,storage_path,file_size) VALUES(gen_random_uuid(),0,\'image\',\'https://x\',\'posts/a.png\',1)',"SELECT create_post_with_attachments('alice','{}','[]',18)"])await assert.rejects(db.query(query),e=>e.code==='42501');await db.query('RESET ROLE');}
      const rows=(await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='post_attachments'::regclass")).rows;assert.equal(rows[0].relrowsecurity,true);
    });
  } finally {await db.end();await admin.query('DROP DATABASE '+dbName+' WITH (FORCE)');await admin.end();}
});
