'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const {createToolRetryStore}=require('../render-api/ai-tool-retry-store');
const connectionString=process.env.XTJ_TEST_DATABASE_URL;
test('PostgreSQL tool retry results preserve ownership, sibling updates, deletion and durable artifacts',{skip:!connectionString,timeout:30000},async t=>{
 const url=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
 const admin=new Client({connectionString});await admin.connect();const name='xtj_retry_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const db=new Client({connectionString:url.href}),other=new Client({connectionString:url.href});await db.connect();await other.connect();
 try{
  await db.query(fs.readFileSync('tests/helpers/post-attachments-db-fixture.sql','utf8'));
  await db.query(fs.readFileSync('supabase/migrations/20261012095854_chat_ai_history_boundary.sql','utf8'));
  await db.query(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_ai_tool_retry_results.sql')),'utf8'));
  await db.query('ALTER TABLE posts ENABLE ROW LEVEL SECURITY');
  const account=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('alice','__auth__') RETURNING id")).rows[0].id;
  const owner={userName:'alice',accountId:account},turn={conversationId:'RETRY01',requestId:'request-1'};
  const base={role:'assistant',convId:turn.conversationId,client_request_id:turn.requestId,followups:['keep'],context_memory:{summary:'keep'},site_cards:[{protocol:'xtj.ai.ui.v1',id:'original',type:'calculate',tool_call_id:'original-step',data:{result:1}}],process_events:[{type:'reasoning',text:'original reasoning'},{type:'tools',tools:['one','two'].map(call_id=>({call_id,tool_name:'calculate',status:'error',error:'original failure',retry_token:'private-token'}))}]};
  const id=(await db.query("INSERT INTO posts(user_name,media_type,actor_key,media_url,content) VALUES('alice','__ai_agent_msg__','ai_msg_conv_RETRY01_agent_alice_1',$1,'original answer') RETURNING id",[JSON.stringify(base)])).rows[0].id;
  function adapter(client){return {rpc(_name,p){return client.query('SELECT save_ai_tool_retry_result($1,$2,$3,$4,$5,$6,$7) AS result',[p.p_user_name,p.p_account_id,p.p_conversation_id,p.p_request_id,p.p_call_id,p.p_feedback?JSON.stringify(p.p_feedback):null,p.p_cards?JSON.stringify(p.p_cards):null]).then(r=>({data:r.rows[0].result,error:null}),error=>({data:null,error}));}};}
  const store=createToolRetryStore(adapter(db)),second=createToolRetryStore(adapter(other));
  const feedback=call_id=>({type:'tool_result',call_id,tool_name:'calculate',success:true,error:null,summary:'4'}),cards=call_id=>[{protocol:'xtj.ai.ui.v1',id:call_id,type:'calculate',data:{result:4}}];
  await t.test('forged account, request, step and a different owner cannot read or update the original',async()=>{
    for(const [who,which,step] of [[{userName:'bob',accountId:account},turn,'one'],[{...owner,accountId:randomUUID()},turn,'one'],[owner,{...turn,requestId:'other-request'},'one'],[owner,turn,'unknown-step']])await assert.rejects(store.inspect(who,which,step));
    await db.query('SET ROLE anon');await assert.rejects(db.query('SELECT save_ai_tool_retry_result($1,$2,$3,$4,$5,NULL,NULL)',['alice',account,'RETRY01','request-1','one']),error=>error.code==='42501');await db.query('RESET ROLE');
    await db.query('SET ROLE authenticated');await assert.rejects(db.query('SELECT save_ai_tool_retry_result($1,$2,$3,$4,$5,NULL,NULL)',['alice',account,'RETRY01','request-1','one']),error=>error.code==='42501');await db.query('RESET ROLE');
  });
  await t.test('ambiguous turn identities and malformed persistence payloads fail before any artifact is changed',async()=>{
    const duplicate=(await db.query("INSERT INTO posts(user_name,media_type,actor_key,media_url,content) VALUES('alice','__ai_agent_msg__','ai_msg_conv_RETRY01_agent_alice_2',$1,'another answer') RETURNING id",[JSON.stringify(base)])).rows[0].id;
    await assert.rejects(store.inspect(owner,turn,'one'));await db.query('DELETE FROM posts WHERE id=$1',[duplicate]);
    for(const [f,c] of [[{tool_name:'calculate'},[]],[{...feedback('one'),tool_name:'make_chart'},[]],[feedback('one'),null]]){
      const result=(await db.query('SELECT save_ai_tool_retry_result($1,$2,$3,$4,$5,$6,$7) AS result',['alice',account,'RETRY01','request-1','one',JSON.stringify(f),c===null?null:JSON.stringify(c)])).rows[0].result;assert.equal(result.ok,false);
    }
    assert.equal(JSON.parse((await db.query('SELECT media_url FROM posts WHERE id=$1',[id])).rows[0].media_url).site_cards.length,1);
  });
  await t.test('concurrent sibling results merge under the row lock and repeated acknowledgement stays idempotent',async()=>{
    await db.query('SET ROLE service_role');
    const inspect=await store.inspect(owner,turn,'one');assert.equal(inspect.completed,false);
    await db.query('RESET ROLE');
    await Promise.all([store.save(owner,turn,'one',feedback('one'),cards('one')),second.save(owner,turn,'two',feedback('two'),cards('two'))]);
    const again=await store.save(owner,turn,'one',feedback('one'),cards('one'));assert.equal(again.completed,true);assert.equal(again.record.site_cards.length,3);assert.equal(again.record.tool_retry_revision,2);
    const row=(await other.query('SELECT content,media_url FROM posts WHERE id=$1',[id])).rows[0],meta=JSON.parse(row.media_url);
    assert.equal(row.content,'original answer');assert.deepEqual(meta.followups,['keep']);assert.equal(meta.context_memory.summary,'keep');assert.equal(meta.process_events[0].text,'original reasoning');assert.ok(meta.process_events[1].tools.every(s=>s.status==='done'&&!s.retry_token&&s.retry_completed_at));assert.ok(meta.site_cards.some(c=>c.id==='original'));assert.ok(meta.tool_retry_updated_at);
  });
  await t.test('soft deletion wins over a retry waiting for the same row and never resurrects a conversation',async()=>{
    await db.query('BEGIN');await db.query("SELECT soft_delete_ai_conversation('alice','RETRY01')");const pending=second.save(owner,turn,'one',feedback('one'),cards('one'));const rejected=assert.rejects(pending);await new Promise(r=>setTimeout(r,30));await db.query('COMMIT');await rejected;
    assert.equal(JSON.parse((await db.query('SELECT media_url FROM posts WHERE id=$1',[id])).rows[0].media_url).deleted,true);
  });
  await t.test('a recreated nickname cannot inherit an old turn even if the legacy row remains',async()=>{
    await db.query('DELETE FROM posts WHERE id=$1',[account]);const newId=(await db.query("INSERT INTO posts(user_name,media_type) VALUES('alice','__auth__') RETURNING id")).rows[0].id;
    await assert.rejects(store.inspect(owner,turn,'one'));await assert.rejects(store.inspect({...owner,accountId:newId},turn,'one'));
  });
 }finally{await db.query('ROLLBACK').catch(()=>{});await Promise.all([db.end(),other.end()]);await admin.query('DROP DATABASE '+name+' WITH (FORCE)');await admin.end();}
});
