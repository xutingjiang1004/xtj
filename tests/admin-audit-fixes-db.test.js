'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('pg'),{randomUUID}=require('node:crypto');
const connectionString=process.env.XTJ_TEST_DATABASE_URL;
const read=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
test('administrator audit database boundaries, concurrent merges and durable email reservations',{skip:!connectionString,timeout:30000},async t=>{
 const url=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
 const admin=new Client({connectionString});await admin.connect();const name='xtj_admin_audit_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const connect=async()=>{const client=new Client({connectionString:url.href});await client.connect();return client;};const db=await connect();
 try{
  await db.query(fs.readFileSync('tests/helpers/post-attachments-db-fixture.sql','utf8'));
  await db.query("GRANT SELECT ON posts TO anon,authenticated;ALTER TABLE posts ENABLE ROW LEVEL SECURITY;CREATE POLICY public_posts ON posts FOR SELECT TO anon,authenticated USING(visibility='public' AND is_deleted IS NOT TRUE);GRANT SELECT ON likes,comments TO anon,authenticated;ALTER TABLE likes ENABLE ROW LEVEL SECURITY;ALTER TABLE comments ENABLE ROW LEVEL SECURITY;CREATE POLICY likes_select_all ON likes FOR SELECT USING(true);CREATE POLICY comments_select_all ON comments FOR ALL USING(true) WITH CHECK(true)");
  await db.query(read('20261012023234_audit_interaction_read_boundary.sql'));
  await db.query(read('20261012023316_audit_atomic_reports_and_email.sql'));
  await db.query(read('20261021160504_admin_management_consistency.sql'));
  const atomic=read('20261002012142_atomic_audit_operations.sql');await db.query(atomic.slice(atomic.indexOf('CREATE FUNCTION public.record_auth_ip_location'),atomic.indexOf('COMMIT;',atomic.indexOf('CREATE FUNCTION public.record_auth_ip_location'))));
  await t.test('report pagination reaches old pending records beyond 500 with independent counts and equal-timestamp tie breaks',async()=>{
   await db.query("INSERT INTO posts(user_name,media_type,content,created_at) SELECT 'reporter','__report__',jsonb_build_object('status','reviewed','target_user','alice')::text,'2026-10-20T12:00:00.123456Z'::timestamptz FROM generate_series(1,601)");
   const old=(await db.query("INSERT INTO posts(user_name,media_type,content,created_at) VALUES('reporter','__report__','{\"review_status\":\"pending\"}','2026-01-01') RETURNING id")).rows[0].id;
   const page=(status='all',cursor=null)=>db.query('SELECT admin_report_page($1,$2,$3,$4) result',[status,cursor?.before_at||null,cursor?.before_id||null,37]).then(r=>r.rows[0].result);
   const first=await page();assert.equal(first.total,602);assert.equal(first.pending_count,1);assert.equal(first.rows.length,37);assert.match(first.next_cursor.before_at,/123456/);
   const pending=await page('pending');assert.equal(pending.rows[0].id,old);assert.equal(pending.filtered_total,1);assert.equal(pending.total,602);
   let current=first;const ids=[];do{ids.push(...current.rows.map(row=>row.id));if(!current.has_more)break;current=await page('all',current.next_cursor);}while(true);
   assert.equal(ids.length,602);assert.equal(new Set(ids).size,602);assert.equal(ids.at(-1),old);
   assert.equal((await db.query("SELECT admin_report_page('invalid',NULL,NULL,1) result")).rows[0].result.code,'invalid_request');
   await db.query("DELETE FROM posts WHERE media_type='__report__'");
  });
  await t.test('concurrent read and false-positive reviews preserve flags, other fields and review attribution',async()=>{
   const other=await connect();try{
    for(const firstStatus of ['read','false_positive']){
     const id=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__security_alert__','{\"reason\":\"keep this evidence\",\"related_users\":[\"alice\"]}') RETURNING id")).rows[0].id;
     await db.query('BEGIN');await db.query('SELECT review_security_alert($1,$2,$3)',[id,'reviewer',firstStatus]);
     const waiting=other.query('SELECT review_security_alert($1,$2,$3)',[id,'reader',firstStatus==='read'?'false_positive':'read']);
     await db.query('COMMIT');assert.equal((await waiting).rows[0].review_security_alert.ok,true);
     const info=JSON.parse((await db.query('SELECT content FROM posts WHERE id=$1',[id])).rows[0].content);
     assert.equal(info.is_read,true);assert.equal(info.false_positive,true);assert.equal(info.ignored,true);assert.equal(info.reason,'keep this evidence');assert.deepEqual(info.related_users,['alice']);assert.equal(info.reviewed_by,firstStatus==='read'?'reader':'reviewer');
     await db.query('SELECT review_security_alert($1,$2,$3)',[id,'late-reader','read']);assert.equal(JSON.parse((await db.query('SELECT content FROM posts WHERE id=$1',[id])).rows[0].content).reviewed_at,info.reviewed_at);
    }
   }finally{await other.end();}
  });
  await t.test('new administrator RPCs are service-only and reject invalid or wrong-marker targets',async()=>{
   for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);try{await assert.rejects(db.query("SELECT admin_report_page('all',NULL,NULL,10)"),e=>e.code==='42501');await assert.rejects(db.query("SELECT review_security_alert($1,'xxz','read')",[randomUUID()]),e=>e.code==='42501');}finally{await db.query('RESET ROLE');}}
   await db.query('SET ROLE service_role');try{assert.equal((await db.query("SELECT admin_report_page('all',NULL,NULL,10) result")).rows[0].result.ok,true);assert.equal((await db.query("SELECT review_security_alert($1,'xxz','read') result",[randomUUID()])).rows[0].result.code,'not_found');}finally{await db.query('RESET ROLE');}
   const normal=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','text','hello') RETURNING id")).rows[0].id;assert.equal((await db.query("SELECT review_security_alert($1,'xxz','read') result",[normal])).rows[0].result.code,'not_found');await db.query('DELETE FROM posts WHERE id=$1',[normal]);
   const broken=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__security_alert__','broken evidence') RETURNING id")).rows[0].id;assert.equal((await db.query("SELECT review_security_alert($1,'xxz','read') result",[broken])).rows[0].result.code,'invalid_record');assert.equal((await db.query('SELECT content FROM posts WHERE id=$1',[broken])).rows[0].content,'broken evidence');
  });
  await t.test('anon and authenticated can only read interactions on public nondeleted normal parent posts',async()=>{
   const parents=[];for(const [visibility,deleted,type] of [['public',false,'image'],['private',false,'image'],['public',true,'image'],['public',false,'__report__']])parents.push((await db.query("INSERT INTO posts(user_name,visibility,is_deleted,media_type) VALUES('alice',$1,$2,$3) RETURNING id",[visibility,deleted,type])).rows[0].id);
   for(const id of parents){await db.query('INSERT INTO likes VALUES($1,$2)',[randomUUID(),id]);await db.query('INSERT INTO comments VALUES($1,$2)',[randomUUID(),id]);}
   for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);try{for(const table of ['likes','comments']){assert.deepEqual((await db.query('SELECT post_id FROM '+table)).rows.map(r=>r.post_id),[parents[0]]);await assert.rejects(db.query('INSERT INTO '+table+' VALUES($1,$2)',[randomUUID(),parents[0]]),e=>e.code==='42501');}}finally{await db.query('RESET ROLE');}}
   await db.query('SET ROLE service_role');try{assert.equal((await db.query('SELECT * FROM comments')).rowCount,4);}finally{await db.query('RESET ROLE');}
   assert.equal((await db.query("SELECT * FROM pg_policies WHERE tablename IN ('likes','comments') AND policyname LIKE '%select_all'")).rowCount,0);
  });
  await t.test('notification append, review and mark-read serialize without overwriting replies or unread new notices',async()=>{
   const id=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__report__','{\"status\":\"pending\"}') RETURNING id")).rows[0].id;
   const other=await connect();try{
    const sql='SELECT mutate_report_record($1,$2,$3,$4,$5) result';
    await Promise.all([db.query(sql,[id,{status:'actioned'}, {action:'first',created_at:'2026-10-11T01:00:00.000Z'},null,null]),other.query(sql,[id,{admin_response:'reply'}, {action:'second',created_at:'2026-10-11T01:01:00.000Z'},null,null])]);
    await Promise.all([db.query(sql,[id,{},null,'alice','2026-10-11T01:02:00.000Z']),other.query(sql,[id,{}, {action:'new',created_at:'2026-10-11T01:03:00.000Z'},null,null])]);
    const body=JSON.parse((await db.query('SELECT content FROM posts WHERE id=$1',[id])).rows[0].content);assert.equal(body.status,'actioned');assert.equal(body.admin_response,'reply');assert.equal(body.notifications.length,3);assert.equal(body.notifications.filter(n=>n.is_read).length,2);assert.equal(body.notifications.find(n=>n.action==='new').is_read,false);assert.equal(new Set(body.notifications.map(n=>n.id)).size,3);
    assert.equal((await db.query(sql,[id,{},null,'bob','2026-10-11T02:00:00.000Z'])).rows[0].result.ok,false);
   }finally{await other.end();}
  });
  await t.test('IP enrichment merges only guarded fields and cannot roll back a newer login or email',async()=>{
   const account=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__auth__','verifier') RETURNING id")).rows[0].id;
   const login='2026-10-11T01:00:00.000Z';const event=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__login_event__',$1) RETURNING id",[JSON.stringify({authority:'server_authentication',method:'password',source:'login_success',ip:'1.1.1.1',login_at:login})])).rows[0].id;
   const info={last_auth_event_id:event,last_login:login,last_ip:'1.1.1.1',email:'new@example.invalid',account_id:account};await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('alice','__user_info__',$1)",[JSON.stringify(info)]);
   assert.equal((await db.query('SELECT record_auth_ip_location($1,$2,$3) result',[event,'1.1.1.1',{text:'region'}])).rows[0].result.current_updated,true);
   assert.equal(JSON.parse((await db.query("SELECT content FROM posts WHERE user_name='alice' AND media_type='__user_info__'")).rows[0].content).email,'new@example.invalid');
   await db.query("UPDATE posts SET content=(content::jsonb||'{\"last_ip\":\"2.2.2.2\",\"last_auth_event_id\":\"new-event\"}')::text WHERE media_type='__user_info__'");
   assert.equal((await db.query('SELECT record_auth_ip_location($1,$2,$3) result',[event,'1.1.1.1',{text:'late'}])).rows[0].result.current_updated,false);
  });
  const fingerprint='f'.repeat(64),reserveSql='SELECT reserve_admin_email_job($1,$2,$3,$4,$5,$6) result';
  const recipients=(n,prefix)=>Array.from({length:n},(_,i)=>({email:prefix+i+'@example.invalid',user_name:prefix+i}));
  await t.test('concurrent 100-person batches cannot exceed a shared day budget seeded from legacy history',async()=>{
   await db.query("INSERT INTO posts(user_name,media_type,content,visibility) VALUES('xxz','__email_sent__','{\"sent_count\":400}','private')");
   const other=await connect();try{
    const jobs=[randomUUID(),randomUUID()],args=id=>[id,'xxz',fingerprint,JSON.stringify(recipients(100,id.slice(0,5))),'hello',500];
    const result=await Promise.all([db.query(reserveSql,args(jobs[0])),other.query(reserveSql,args(jobs[1]))]);assert.equal(result.filter(r=>r.rows[0].result.ok).length,1);assert.equal(result.find(r=>!r.rows[0].result.ok).rows[0].result.code,'email_daily_limit');assert.equal((await db.query('SELECT occupied FROM admin_email_daily_quota')).rows[0].occupied,500);
    const accepted=result.find(r=>r.rows[0].result.ok).rows[0].result;const same=await db.query(reserveSql,args(accepted.id));assert.equal(same.rows[0].result.created,false);assert.equal((await db.query('SELECT occupied FROM admin_email_daily_quota')).rows[0].occupied,500);
    const conflict=await db.query(reserveSql,[accepted.id,'xxz','e'.repeat(64),JSON.stringify(recipients(100,'changed')),'hello',500]);assert.equal(conflict.rows[0].result.code,'idempotency_conflict');
    await db.query('SELECT finish_admin_email_job($1,$2)',[accepted.id,'from@example.invalid']);assert.equal((await db.query('SELECT occupied FROM admin_email_daily_quota')).rows[0].occupied,400);
   }finally{await other.end();}
  });
  await t.test('only one caller claims a recipient; duplicate outcomes release quota once; unknown sends remain charged',async()=>{
   const id=randomUUID(),list=recipients(3,'settle');await db.query(reserveSql,[id,'xxz',fingerprint,JSON.stringify(list),'test',500]);
   const other=await connect();try{
    const claims=await Promise.all([db.query('SELECT claim_admin_email_delivery($1,$2) result',[id,list[0].email]),other.query('SELECT claim_admin_email_delivery($1,$2) result',[id,list[0].email])]);assert.equal(claims.filter(r=>r.rows[0].result.claimed).length,1);
    await db.query('SELECT settle_admin_email_delivery($1,$2,$3,$4)',[id,list[0].email,'sent',null]);
    await db.query('SELECT claim_admin_email_delivery($1,$2)',[id,list[1].email]);await db.query('SELECT settle_admin_email_delivery($1,$2,$3,$4)',[id,list[1].email,'failed','rejected']);await db.query('SELECT settle_admin_email_delivery($1,$2,$3,$4)',[id,list[1].email,'failed','retry']);
    await db.query('SELECT claim_admin_email_delivery($1,$2)',[id,list[2].email]);
    const finished=(await db.query('SELECT finish_admin_email_job($1,$2) result',[id,'from@example.invalid'])).rows[0].result;assert.equal(finished.status,'uncertain');assert.deepEqual(finished.deliveries.map(r=>r.status),['sent','failed','unknown']);assert.equal((await db.query('SELECT occupied FROM admin_email_daily_quota')).rows[0].occupied,402);
    await db.query('SELECT finish_admin_email_job($1,$2)',[id,'from@example.invalid']);assert.equal((await db.query("SELECT count(*)::int n FROM posts WHERE actor_key=$1",['email_job_'+id])).rows[0].n,1);
   }finally{await other.end();}
  });
  await t.test('history write failure rolls back finish and can be retried without repeating delivery or quota consumption',async()=>{
   const id=randomUUID(),list=recipients(1,'ledger');await db.query(reserveSql,[id,'xxz',fingerprint,JSON.stringify(list),'ledger',500]);await db.query('SELECT claim_admin_email_delivery($1,$2)',[id,list[0].email]);await db.query('SELECT settle_admin_email_delivery($1,$2,$3,$4)',[id,list[0].email,'sent',null]);
   await db.query("CREATE FUNCTION fail_email_ledger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.actor_key='email_job_"+id+"' THEN RAISE EXCEPTION 'ledger denied';END IF;RETURN NEW;END$$;CREATE TRIGGER fail_ledger BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION fail_email_ledger()");
   await assert.rejects(db.query('SELECT finish_admin_email_job($1,$2)',[id,'from@example.invalid']),/ledger denied/);assert.equal((await db.query('SELECT status FROM admin_email_deliveries WHERE job_id=$1',[id])).rows[0].status,'sent');assert.equal((await db.query('SELECT ledger_record_id FROM admin_email_jobs WHERE id=$1',[id])).rows[0].ledger_record_id,null);
   await db.query('DROP TRIGGER fail_ledger ON posts');assert.equal((await db.query('SELECT finish_admin_email_job($1,$2) result',[id,'from@example.invalid'])).rows[0].result.status,'completed');
  });
  await t.test('browser roles cannot invoke report mutation or email quota/delivery RPCs; service role can',async()=>{
   const id=randomUUID();for(const role of ['anon','authenticated']){await db.query('SET ROLE '+role);try{await assert.rejects(db.query('SELECT mutate_report_record($1)',[id]),e=>e.code==='42501');await assert.rejects(db.query('SELECT admin_email_job_snapshot($1)',[id]),e=>e.code==='42501');await assert.rejects(db.query('SELECT * FROM admin_email_daily_quota'),e=>e.code==='42501');}finally{await db.query('RESET ROLE');}}
   await db.query('SET ROLE service_role');try{assert.equal((await db.query('SELECT admin_email_job_snapshot($1) result',[id])).rows[0].result.code,'not_found');}finally{await db.query('RESET ROLE');}
  });
  await t.test('service role can commit report mutation and the full reserved-delivery-ledger transaction',async()=>{
   const report=(await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('service-fixture','__report__','{\"status\":\"pending\"}') RETURNING id")).rows[0].id;
   const id=randomUUID(),list=recipients(1,'service');await db.query('SET ROLE service_role');try{
    assert.equal((await db.query('SELECT mutate_report_record($1,$2,$3) result',[report,{status:'actioned'},{action:'reviewed'}])).rows[0].result.ok,true);
    assert.equal((await db.query(reserveSql,[id,'xxz',fingerprint,JSON.stringify(list),'service-role-check',500])).rows[0].result.created,true);
    assert.equal((await db.query('SELECT claim_admin_email_delivery($1,$2) result',[id,list[0].email])).rows[0].result.claimed,true);
    assert.equal((await db.query('SELECT settle_admin_email_delivery($1,$2,$3,$4) result',[id,list[0].email,'sent',null])).rows[0].result.ok,true);
    const finished=(await db.query('SELECT finish_admin_email_job($1,$2) result',[id,'from@example.invalid'])).rows[0].result;assert.equal(finished.ok,true);assert.equal(finished.status,'completed');assert.equal(finished.deliveries[0].status,'sent');
   }finally{await db.query('RESET ROLE');}
   assert.equal(JSON.parse((await db.query('SELECT content FROM posts WHERE id=$1',[report])).rows[0].content).status,'actioned');assert.equal((await db.query("SELECT count(*)::int n FROM posts WHERE actor_key=$1",['email_job_'+id])).rows[0].n,1);
  });
 }finally{await db.end();await admin.query('DROP DATABASE '+name);await admin.end();}
});
