'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const connectionString=process.env.XTJ_TEST_DATABASE_URL;
test('research frontiers enforce account identity, privacy, bounded storage and exclusive leases',{skip:!connectionString,timeout:45000},async t=>{
  const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  const admin=new Client({connectionString});await admin.connect();const name='xtj_checkpoint_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;const db=new Client({connectionString:url.href});await db.connect();
  try {
    await db.query(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA xtj_private; CREATE FUNCTION xtj_private.safe_jsonb(text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN $1::jsonb; EXCEPTION WHEN OTHERS THEN RETURN '{}'::jsonb; END $$; CREATE TABLE posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_name text,media_type text,media_url text); GRANT SELECT, UPDATE ON posts TO service_role;`);
    await db.query(fs.readFileSync('supabase/migrations/20261013121100_ai_research_checkpoints.sql','utf8'));
    const alice=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('alice','__auth__') RETURNING id")).rows[0].id;
    const bob=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('bob','__auth__') RETURNING id")).rows[0].id;
    const sql='SELECT manage_ai_research_checkpoint($1,$2,$3,$4,$5,$6::jsonb,$7) AS value';
    const call=async(op,{user='alice',account=alice,id=null,lease=null,state=null,status=null}={})=>(await db.query(sql,[user,account,op,id,lease,state&&JSON.stringify(state),status])).rows[0].value;
    const state={version:1,request:{query:'private question'},workers:[]},lease=randomUUID();
    const started=await call('start',{lease,state});assert.equal(started.ok,true);const id=started.row.id;
    await t.test('anon and authenticated cannot read private contexts or invoke frontier mutation',async()=>{
      for(const role of ['anon','authenticated']) { await db.query('SET ROLE '+role);try {
        await assert.rejects(db.query('SELECT * FROM ai_research_checkpoints'),/permission denied/);
        await assert.rejects(call('list'),/permission denied/);
      } finally {await db.query('RESET ROLE');} }
      await db.query('SET ROLE service_role');try {assert.equal((await call('list')).rows.length,1);}finally {await db.query('RESET ROLE');}
    });
    await t.test('other users and forged account incarnations cannot claim an existing frontier',async()=>{
      assert.equal((await call('claim',{user:'bob',account:bob,id,lease:randomUUID()})).error,'checkpoint_not_found');
      assert.equal((await call('list',{account:bob})).error,'checkpoint_identity_changed');
      assert.equal((await call('list',{account:'admin:alice'})).error,'checkpoint_identity_changed');
      assert.equal((await call('claim',{id,lease:randomUUID()})).error,'checkpoint_running');
      assert.equal((await call('save',{id,lease:randomUUID(),state})).error,'checkpoint_lease_lost');
    });
    await t.test('only one active frontier exists per account and a crash becomes resumable after lease expiry',async()=>{
      assert.equal((await call('start',{state,lease:randomUUID()})).error,'checkpoint_running');
      await db.query("UPDATE ai_research_checkpoints SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
      const newerLease=randomUUID(),claimed=await call('claim',{id,lease:newerLease});assert.equal(claimed.ok,true);
      assert.equal((await call('save',{id,lease,state})).error,'checkpoint_lease_lost');
      assert.equal((await call('finish',{id,lease:newerLease,state,status:'interrupted'})).ok,true);
    });
    await t.test('state mutations are atomic and oversized or malformed snapshots are rejected',async()=>{
      const token=randomUUID();await call('claim',{id,lease:token});
      assert.equal((await call('save',{id,lease:token,state:{}})).error,'checkpoint_invalid');
      await assert.rejects(call('save',{id,lease:token,state:{...state,blob:'x'.repeat(2100000)}}),/check constraint/);
      assert.equal((await call('list')).rows[0].state.request.query,'private question');
      await call('finish',{id,lease:token,state,status:'interrupted'});
    });
    await t.test('concurrent devices grant exactly one resume lease',async()=>{
      const peers=await Promise.all(Array.from({length:4},async()=>{const c=new Client({connectionString:url.href});await c.connect();return c;}));
      const tokens=peers.map(()=>randomUUID());
      try {
        const results=await Promise.all(peers.map((c,i)=>c.query(sql,['alice',alice,'claim',id,tokens[i],null,null])));
        assert.equal(results.filter(result=>result.rows[0].value.ok).length,1);
        const winner=results.findIndex(result=>result.rows[0].value.ok);await call('finish',{id,lease:tokens[winner],state,status:'interrupted'});
      } finally {await Promise.all(peers.map(c=>c.end()));}
    });
    await t.test('soft-deleting a conversation erases its resumable private context',async()=>{
      const token=randomUUID(),context={...state,request:{query:'private',conversation_id:'DELETE001'}};
      const row=(await call('start',{state:context,lease:token})).row;await call('finish',{id:row.id,lease:token,state:context,status:'interrupted'});
      const message=(await db.query("INSERT INTO posts(user_name,media_type,media_url) VALUES('alice','__ai_agent_msg__','{\"convId\":\"DELETE001\"}') RETURNING id")).rows[0].id;
      await db.query("UPDATE posts SET media_url='{\"convId\":\"DELETE001\",\"deleted\":true}' WHERE id=$1",[message]);
      assert.equal((await call('claim',{id:row.id,lease:randomUUID()})).error,'checkpoint_not_found');
    });
    await t.test('eight-job limit and seven-day expiry bound retained private research',async()=>{
      for(let i=0;i<12;i++) { const token=randomUUID(),row=(await call('start',{lease:token,state:{...state,request:{query:'task '+i}}})).row;await call('finish',{id:row.id,lease:token,state,status:'interrupted'}); }
      assert.equal((await call('list')).rows.length,8);
      await db.query("UPDATE ai_research_checkpoints SET expires_at=now()-interval '1 second' WHERE account_id=$1",[alice]);assert.equal((await call('list')).rows.length,0);
    });
    await t.test('the authenticated environment-backed administrator can research without a physical auth row',async()=>{
      const token=randomUUID(),row=await call('start',{user:'fixture-admin',account:'admin:fixture-admin',lease:token,state});assert.equal(row.ok,true);
      assert.equal((await call('finish',{user:'fixture-admin',account:'admin:fixture-admin',id:row.row.id,lease:token,state,status:'complete'})).ok,true);
    });
    await t.test('deleting and recreating a nickname cannot inherit its earlier research',async()=>{
      const token=randomUUID(),row=(await call('start',{state,lease:token})).row;await call('finish',{id:row.id,lease:token,state,status:'interrupted'});
      await db.query('DELETE FROM posts WHERE id=$1',[alice]);const recreated=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('alice','__auth__') RETURNING id")).rows[0].id;
      assert.equal((await call('list',{account:recreated})).rows.length,0);assert.equal((await call('claim',{account:recreated,id:row.id,lease:randomUUID()})).error,'checkpoint_not_found');
      assert.equal((await call('list')).error,'checkpoint_identity_changed');
    });
  } finally {await db.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
