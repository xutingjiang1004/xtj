'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { Client } = require('pg'), { randomUUID } = require('node:crypto');
const { aiConversationActorPattern, parseAiHistoryCursor, applyAiHistoryCursor } = require('../render-api/ai-history');
const { saveDeepThinkChatTurn, saveInterruptedChatTurn } = require('../render-api/ai-chat-save');
const connectionString = process.env.XTJ_TEST_DATABASE_URL;
test('PostgreSQL AI conversation isolation, history completeness and atomic deletion', { skip: !connectionString, timeout: 30000 }, async t => {
  const url = new URL(connectionString); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  const admin = new Client({ connectionString }); await admin.connect();
  const name = 'xtj_ai_history_' + randomUUID().replaceAll('-', ''); await admin.query('CREATE DATABASE ' + name); url.pathname = '/' + name;
  const db = new Client({ connectionString: url.href }); await db.connect();
  const migration = fs.readdirSync('supabase/migrations').find(n => n.endsWith('_chat_ai_history_boundary.sql'));
  try {
    await db.query(fs.readFileSync('tests/helpers/post-attachments-db-fixture.sql', 'utf8'));
    await db.query(fs.readFileSync('supabase/migrations/' + migration, 'utf8'));
    const previewMigration=fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_chat_ai_history_preview_order.sql'));
    assert.ok(previewMigration);await db.query(fs.readFileSync('supabase/migrations/'+previewMigration,'utf8'));
    await db.query("ALTER TABLE posts ENABLE ROW LEVEL SECURITY; SET TIME ZONE 'UTC'");
    const insert = async (actor, conv, meta = {}, content = 'question') => (await db.query(`INSERT INTO posts(user_name,media_type,actor_key,media_url,content,created_at)
      VALUES($1,'__ai_agent_msg__',$2,$3,$4,'2026-10-12T08:00:00.123456Z') RETURNING id`,
      [actor, 'ai_msg_conv_' + conv + '_user_' + actor + '_' + randomUUID(), JSON.stringify({ role: 'user', convId: conv, ...meta }), content])).rows[0].id;
    const a = await insert('alice','ABCDEF'), longer = await insert('alice','ABCDEF-other'), b = await insert('bob','ABCDEF');
    await t.test('literal LIKE delimiters select only the exact conversation and owner', async () => {
      const old = await db.query("SELECT id FROM posts WHERE user_name='alice' AND actor_key LIKE $1", ['ai_msg_conv_ABCDEF_%']);
      assert.equal(old.rowCount, 2, 'the former query also matches ABCDEF-other');
      const fixed = await db.query("SELECT id FROM posts WHERE user_name='alice' AND actor_key LIKE $1", [aiConversationActorPattern('ABCDEF')]);
      assert.deepEqual(fixed.rows.map(r => r.id), [a]);
    });
    await t.test('same-timestamp pages preserve every UUID and microseconds', async () => {
      for (let n = 0; n < 26; n++) await insert('alice','PAGING');
      const found = []; let cursor;
      do {
        const q = { predicate:'true', values:[], lt(_k,v) { this.predicate = 'created_at < $2'; this.values = [v]; return this; },
          or(value) { const m = value.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^\)]+)\)$/); assert.ok(m);
            this.predicate = '(created_at < $2 OR (created_at = $2 AND id < $3::uuid))'; this.values = [m[1],m[3]]; return this; } };
        applyAiHistoryCursor(q,cursor);
        const rows = (await db.query(`SELECT id,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at FROM posts
          WHERE user_name='alice' AND actor_key LIKE $1 AND ${q.predicate} ORDER BY created_at DESC,id DESC LIMIT 10`,
          [aiConversationActorPattern('PAGING'),...q.values])).rows;
        found.push(...rows.map(r => r.id)); if (rows.length < 10) break;
        assert.match(rows.at(-1).created_at,/\.123456Z$/); cursor = parseAiHistoryCursor(JSON.stringify({ at: rows.at(-1).created_at, id: rows.at(-1).id }));
      } while (true);
      assert.equal(found.length,26); assert.equal(new Set(found).size,26);
    });
    await t.test('SQL summaries count long histories and paginate complete conversations', async () => {
      await db.query(`INSERT INTO posts(user_name,media_type,actor_key,media_url,content,created_at)
        SELECT 'alice','__ai_agent_msg__','ai_msg_conv_LONGER_user_alice_'||i,'{"convId":"LONGER","role":"user"}','turn '||i,'2026-10-12T09:00:00Z' FROM generate_series(1,1205) i`);
      const first = (await db.query("SELECT list_ai_conversations('alice','normal',2) AS result")).rows[0].result;
      assert.equal(first.conversations[0].message_count,1205); assert.equal(first.has_more,true);
      const cursor = parseAiHistoryCursor(first.next_cursor,true);
      const next = (await db.query("SELECT list_ai_conversations('alice','normal',2,$1,$2) AS result",[cursor.at,cursor.id])).rows[0].result;
      const ids = first.conversations.concat(next.conversations).map(r => r.conversation_id);
      assert.equal(ids.length,4); assert.equal(new Set(ids).size,4);
      const deleted = await insert('alice','DELETED',{deleted:true});
      const deep = await insert('alice','RESEARCH',{role:'assistant',type:'tavily_research'},JSON.stringify({type:'tavily_research',query:'topic',answer:'private research',sources:[]}));
      const normal = (await db.query("SELECT list_ai_conversations('alice','normal',100) AS result")).rows[0].result;
      assert.equal(normal.conversations.some(r => r.conversation_id === 'DELETED' || r.conversation_id === 'RESEARCH'),false);
      const research = (await db.query("SELECT list_ai_research_records('alice',10) AS result")).rows[0].result;
      assert.equal(research.items[0].id,deep); assert.equal(research.items[0].conversation_id,'RESEARCH');
      const deepList = (await db.query("SELECT list_ai_conversations('alice','deep_think',100) AS result")).rows[0].result;
      assert.equal(deepList.conversations[0].last_message,'private research');
      await db.query("SELECT soft_delete_ai_conversation('alice','RESEARCH')");
      assert.equal((await db.query("SELECT list_ai_research_records('alice',10) AS result")).rows[0].result.items.length,0);
      assert.ok(deleted);
    });
    await t.test('conversation previews preserve the text inside historical JSON replies', async () => {
      await insert('alice','WRAPPED',{role:'assistant'},JSON.stringify({reply:'Actual answer, not serialized JSON'}));
      const result = (await db.query("SELECT list_ai_conversations('alice','normal',100,NULL,NULL,'WRAPPED') AS result")).rows[0].result;
      assert.equal(result.conversations.length,1);assert.equal(result.conversations[0].last_message,'Actual answer, not serialized JSON');
    });
    await t.test('same-transaction previews use message sequence before UUID order',async()=>{
      await db.query(`INSERT INTO posts(id,user_name,media_type,actor_key,media_url,content,created_at) VALUES
        ('ffffffff-ffff-4fff-afff-ffffffffffff','alice','__ai_agent_msg__','ai_msg_conv_SEQPAIR_user_alice_1','{"convId":"SEQPAIR","role":"user","seq":1}','Question','2026-10-12T11:00:00Z'),
        ('00000000-0000-4000-8000-000000000001','alice','__ai_agent_msg__','ai_msg_conv_SEQPAIR_agent_alice_2','{"convId":"SEQPAIR","role":"assistant","seq":2}','Answer','2026-10-12T11:00:00Z')`);
      const result=(await db.query("SELECT list_ai_conversations('alice','normal',100,NULL,NULL,'SEQPAIR') AS result")).rows[0].result;
      assert.equal(result.conversations[0].title,'Question');assert.equal(result.conversations[0].last_message,'Answer');
    });
    await t.test('completed and paused research turn writes are atomic, truthful and discoverable in the deep history', async () => {
      const adapter = { from() { return { async insert(rows) {
        try { const result = await db.query(`INSERT INTO posts(user_name,media_type,actor_key,media_url,content,created_at)
          SELECT user_name,media_type,actor_key,media_url,content,COALESCE(created_at,now()) FROM jsonb_to_recordset($1::jsonb)
          AS x(user_name text,media_type text,actor_key text,media_url text,content text,created_at timestamptz) RETURNING id`, [JSON.stringify(rows)]);
          return { data: result.rows, error: null }; } catch (error) { return { data: null, error }; }
      } }; } };
      const options = { db: adapter, userName: 'alice', convId: 'DEEPSAVE', message: 'REAL QUESTION', content: 'REAL ANSWER', marker: '__ai_agent_msg__', requestId: 'deep-original',
        userExtra: { vision_urls: ['data:image/png;base64,QUJD'] }, buildMeta: (role,conv,_u,_r,seq,_s,_elapsed,extra) => JSON.stringify({role,convId:conv,seq,...extra}) };
      assert.equal(await saveDeepThinkChatTurn(options),true);
      assert.equal(await saveInterruptedChatTurn({...options,convId:'PAUSE111',requestId:'deep-paused',chatMode:'deep_think'}),true);
      const list=(await db.query("SELECT list_ai_conversations('alice','deep_think',100) AS result")).rows[0].result;
      assert.ok(list.conversations.some(c=>c.conversation_id==='DEEPSAVE'&&c.message_count===2));
      assert.ok(list.conversations.some(c=>c.conversation_id==='PAUSE111'&&c.message_count===2));
      await db.query("CREATE FUNCTION refuse_deep_pair() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.actor_key LIKE '%REJECT11%' AND NEW.media_url::jsonb->>'role'='assistant' THEN RAISE EXCEPTION 'pair refused'; END IF; RETURN NEW; END$$; CREATE TRIGGER refuse_deep_pair BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION refuse_deep_pair()");
      assert.equal(await saveDeepThinkChatTurn({...options,convId:'REJECT11'}),false);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM posts WHERE actor_key LIKE '%REJECT11%'")).rows[0].n,0);
    });
    await t.test('deletion is owner-scoped, idempotent, and preserves concurrent metadata', async () => {
      const other = new Client({connectionString:url.href}); await other.connect();
      try {
        await other.query('BEGIN'); await other.query("UPDATE posts SET media_url=(media_url::jsonb||'{\"reasoning\":\"newly saved\"}')::text WHERE id=$1",[a]);
        const pending = db.query("SELECT soft_delete_ai_conversation('alice','ABCDEF') AS result"); await other.query('COMMIT');
        assert.equal((await pending).rows[0].result.deleted,1);
        const meta = JSON.parse((await db.query('SELECT media_url FROM posts WHERE id=$1',[a])).rows[0].media_url);
        assert.equal(meta.deleted,true); assert.equal(meta.reasoning,'newly saved');
        assert.equal((await db.query("SELECT soft_delete_ai_conversation('alice','ABCDEF') AS result")).rows[0].result.deleted,0);
        const intact = (await db.query('SELECT media_url FROM posts WHERE id IN ($1,$2)',[longer,b])).rows;
        assert.equal(intact.some(r => JSON.parse(r.media_url).deleted),false);
      } finally { await other.end(); }
    });
    await t.test('failed deletion rolls back every row and browser roles cannot call any history RPC', async () => {
      await insert('alice','ROLLBACK'); await insert('alice','ROLLBACK');
      await db.query("CREATE FUNCTION fail_ai_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.media_url::jsonb->>'deleted'='true' AND NEW.actor_key LIKE '%ROLLBACK%' THEN RAISE EXCEPTION 'fixture refusal'; END IF; RETURN NEW; END$$; CREATE TRIGGER fail_ai_delete BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION fail_ai_delete()");
      await assert.rejects(db.query("SELECT soft_delete_ai_conversation('alice','ROLLBACK')"),/fixture refusal/);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM posts WHERE actor_key LIKE '%ROLLBACK%' AND media_url::jsonb->>'deleted'='true'")).rows[0].n,0);
      for (const role of ['anon','authenticated']) {
        await db.query('SET ROLE ' + role);
        try {
          for (const sql of ["SELECT soft_delete_ai_conversation('alice','ABCDEF')","SELECT list_ai_conversations('alice')","SELECT list_ai_research_records('alice')"])
            await assert.rejects(db.query(sql),e => e.code === '42501');
        } finally { await db.query('RESET ROLE'); }
      }
      await db.query('SET ROLE service_role');
      try { assert.equal((await db.query("SELECT list_ai_conversations('alice') AS result")).rows[0].result.ok,true); }
      finally { await db.query('RESET ROLE'); }
    });
  } finally { await db.end(); await admin.query('DROP DATABASE ' + name); await admin.end(); }
});
