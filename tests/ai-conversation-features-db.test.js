'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const container=process.env.XTJ_AI_FEATURES_TEST_PG_CONTAINER;
test('PostgreSQL AI history features enforce ownership, lifecycle, paging, concurrent titles, deletion and secret preservation',{skip:!container},async t=>{
  assert.match(container,/^xtj-ai-features-pg$/);
  const database='xtj_ai_features_'+process.pid;
  const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
  function sql(text,db=database){
    const r=spawnSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',container,'psql','-U','postgres','-d',db,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',env,maxBuffer:4*1024*1024});
    if(r.status!==0)throw Error((r.stderr||'local database failed').slice(0,3000));return r.stdout.trim();
  }
  sql('CREATE DATABASE '+database+';','postgres');t.after(()=>sql('DROP DATABASE '+database+' WITH (FORCE);','postgres'));
  sql(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$;
    CREATE TABLE public.posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_name text,media_type text,content text,media_url text,actor_key text,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE SCHEMA xtj_private;CREATE FUNCTION xtj_private.safe_jsonb(value text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN value::jsonb;EXCEPTION WHEN OTHERS THEN RETURN '{}'::jsonb;END $$;
    GRANT USAGE ON SCHEMA public,xtj_private TO service_role;GRANT ALL ON public.posts TO service_role;GRANT EXECUTE ON FUNCTION xtj_private.safe_jsonb(text) TO service_role;`);
  sql(fs.readFileSync('supabase/migrations/20261021055009_ai_conversation_features.sql','utf8'));
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',m='33333333-3333-4333-8333-333333333333',foreign='44444444-4444-4444-8444-444444444444';
  sql(`INSERT INTO public.posts(id,user_name,media_type,content,created_at) VALUES('${a}','alice','__auth__','{}','2026-01-01'),('${b}','bob','__auth__','{}','2026-01-01');
    INSERT INTO public.posts(id,user_name,media_type,content,media_url,actor_key,created_at) VALUES
    ('${m}','alice','__ai_agent_msg__','{"reply":"可核对的退款结论"}','{"role":"assistant","convId":"conversation-a","usage":{"model":"deepseek-flash"},"client_request_id":"verified-request-one"}','ai_msg_conv_conversation-a_assistant','2026-10-20 12:00:00.000002+00'),
    ('${foreign}','bob','__ai_agent_msg__','别人的私有结论','{"role":"assistant","convId":"conversation-b"}','ai_msg_conv_conversation-b_assistant','2026-10-20 12:00:00.000002+00');`);
  function call(op,value={},owner='alice',id=a){return JSON.parse(sql('SELECT public.ai_conversation_features('+[owner,id,op,JSON.stringify(value)].map(x=>"'"+x.replace(/'/g,"''")+"'").join(',')+'::jsonb);'));}
  await t.test('titles synchronize and stale writers cannot overwrite a newer title',()=>{
    const first=call('set_title',{conversation_id:'conversation-a',title:'我的退款研究',revision:0});assert.equal(first.ok,true);assert.equal(first.record.revision,1);
    assert.equal(call('set_title',{conversation_id:'conversation-a',title:'过期修改',revision:0}).code,'history_metadata_conflict');
    assert.equal(call('metadata',{conversation_ids:['conversation-a']}).records[0].title,'我的退款研究');
    assert.equal(call('metadata',{conversation_ids:['conversation-a']},'bob',b).records.length,0);
  });
  await t.test('search is literal, model filtered, returns text only and does not return another account',()=>{
    const found=call('search',{query:'退款',model:'flash'});assert.equal(found.items.length,1);assert.equal(found.items[0].id,m);assert.equal(found.items[0].model,'deepseek-flash');
    assert.equal(call('search',{query:'别人的'}).items.length,0);assert.equal(call('search',{query:'%'}).items.length,0);
    assert.equal(call('search',{query:'我的退款研究'}).items.length,1);
  });
  await t.test('bookmarks are idempotent and foreign message IDs cannot be saved',()=>{
    assert.equal(call('bookmark',{conversation_id:'conversation-a',client_request_id:'verified-request-one'}).message_id,m);
    assert.equal(call('bookmark',{conversation_id:'conversation-a',message_id:m}).ok,true);assert.equal(call('bookmark',{conversation_id:'conversation-a',message_id:m}).ok,true);
    assert.equal(call('bookmark',{conversation_id:'conversation-b',message_id:foreign}).code,'conversation_missing');
    assert.equal(call('bookmarks').items.length,1);assert.equal(call('bookmarks').items[0].excerpt,'可核对的退款结论');assert.equal(call('bookmarks_export').items[0].text,'可核对的退款结论');assert.equal(call('bookmarks_export',{model:'other'}).items.length,0);
  });
  await t.test('compound cursors preserve microsecond ordering and export keeps the actual answer',()=>{
    sql(`INSERT INTO public.posts(user_name,media_type,content,media_url,actor_key,created_at) SELECT 'alice','__ai_agent_msg__','问题 '||g,'{"role":"user","convId":"conversation-a"}','ai_msg_conv_conversation-a_user_'||g,'2026-10-20 12:00:00.000001+00'::timestamptz FROM generate_series(1,4) g;`);
    const first=call('search',{query:'',limit:2}),cursor=JSON.parse(first.next_cursor),second=call('search',{query:'',limit:2,before_at:cursor.at,before_id:cursor.id});
    assert.equal(new Set(first.items.concat(second.items).map(r=>r.id)).size,4);assert.equal(first.items[0].id,m);
    assert.match(call('export',{conversation_id:'conversation-a'}).items.find(r=>r.id===m).text,/退款结论/);
  });
  await t.test('an exact original message is available only to its owner and excludes inline binary data',()=>{
    const binary='77777777-7777-4777-8777-777777777777';sql(`INSERT INTO public.posts(id,user_name,media_type,content,media_url,actor_key) VALUES('${binary}','alice','__ai_agent_msg__','问题 data:text/plain;charset=utf-8;base64,cHJpdmF0ZSBieXRlcw==','{"role":"user","convId":"binary-test"}','ai_msg_conv_binary-test_user_1');`);
    const stripped=call('message',{message_id:binary}).items[0].text;assert.match(stripped,/\[附件\]/);assert.doesNotMatch(stripped,/cHJpdmF0ZSBieXRlcw/);sql("DELETE FROM public.posts WHERE id='"+binary+"';");
    const detail=call('message',{message_id:m});assert.equal(detail.items[0].text,'可核对的退款结论');assert.equal(detail.items[0].truncated,false);assert.equal(call('message',{message_id:foreign}).items.length,0);
  });
  await t.test('all added tables and functions deny browser roles',()=>{
    assert.throws(()=>sql("SET ROLE anon; SELECT public.ai_conversation_features('alice','"+a+"','search','{}');"),/permission denied/);
    assert.throws(()=>sql('SET ROLE authenticated; SELECT * FROM public.ai_message_bookmarks;'),/permission denied/);
    assert.equal(sql("SELECT count(*) FROM pg_class WHERE relname IN ('ai_message_bookmarks','ai_conversation_preferences') AND relrowsecurity;"),'2');
  });
  await t.test('saved key preservation reads the latest ciphertext and rejects a changed provider endpoint',()=>{
    const save=model=>JSON.parse(sql("SELECT public.save_ai_custom_models_snapshot('alice','"+JSON.stringify([model]).replace(/'/g,"''")+"','[]','{}',false,'"+a+"');"));
    save({uid:'model-a',provider:'custom',model:'test-model',base_url:'https://provider.example/v1',api_key_enc:{version:2,data:'first'}});
    save({uid:'model-a',provider:'custom',model:'test-model',base_url:'https://provider.example/v1',api_key_enc:{version:2,data:'rotated'}});
    const kept=save({uid:'model-a',provider:'custom',model:'new-model',base_url:'https://provider.example/v1/',key_unchanged:true});
    assert.equal(kept.models[0].api_key_enc.data,'rotated');assert.equal(kept.models[0].key_unchanged,undefined);
    assert.throws(()=>save({uid:'model-a',provider:'custom',model:'test-model',base_url:'https://another.example/v1',key_unchanged:true}),/model_endpoint_key_required/);
  });
  await t.test('account recreation cannot inherit titles, bookmarks or search results',()=>{
    const newer='55555555-5555-4555-8555-555555555555';sql(`INSERT INTO public.posts(id,user_name,media_type,content,created_at) VALUES('${newer}','alice','__auth__','{}','2026-10-21');`);
    assert.equal(call('search').code,'account_changed');assert.equal(call('search',{},'alice',newer).items.length,0);assert.equal(call('bookmarks',{},'alice',newer).items.length,0);
    sql("DELETE FROM public.posts WHERE id='"+newer+"';");
  });
  await t.test('conversation deletion atomically removes its private metadata and bookmarks',()=>{
    assert.equal(JSON.parse(sql("SELECT public.soft_delete_ai_conversation('alice','conversation-a');")).ok,true);
    assert.equal(call('search').items.length,0);assert.equal(call('bookmarks').items.length,0);assert.equal(call('metadata',{conversation_ids:['conversation-a']}).records.length,0);
    assert.equal(sql("SELECT count(*) FROM public.ai_conversation_preferences WHERE account_id='"+a+"';"),'0');
  });
});
