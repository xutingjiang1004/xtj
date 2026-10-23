'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {recordAdminLogin, refreshAdminLoginLocation} = require('../render-api/admin-login-ip');
const server = fs.readFileSync('render-api/server.js','utf8');
const LOGIN = '__login_event__', INFO = '__user_info__';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise,resolve}; }
function section(start,end) { const a = server.indexOf(start), b = server.indexOf(end,a); assert.ok(a >= 0 && b > a); return server.slice(a,b); }
function store(initial = []) {
  const rows = structuredClone(initial), calls = [];
  const db = {rows,calls,hook:null,from() {
    const q = {op:'select',filters:[],returning:false};
    const chain = {
      select() {q.returning = true; return chain;},
      insert(payload) {q.op = 'insert'; q.payload = payload; return chain;},
      update(payload) {q.op = 'update'; q.payload = payload; return chain;},
      eq(key,value) {q.filters.push([key,value]); return chain;},
      is(key,value) {q.filters.push([key,value,'is']); return chain;},
      lte(key,value) {q.filters.push([key,value,'lte']); return chain;},
      order() {return chain;}, limit() {return chain;},
      maybeSingle() {q.single = true; return chain;},
      async then(ok,bad) {
        try {
          calls.push(structuredClone(q));
          const error = db.hook && await db.hook(q);
          if (error) return ok({error,data:null});
          let data;
          if (q.op === 'insert') {
            if (q.payload.some(p => p.media_type === INFO && rows.some(r => r.media_type === INFO && r.user_name === p.user_name))) return ok({error:{code:'23505'},data:null});
            data = q.payload.map(p => ({id:'row-'+rows.length,...p})); rows.push(...data);
          } else {
            data = rows.filter(r => q.filters.every(([k,v,op]) => op === 'lte' ? r[k] != null && r[k] <= v : op === 'is' ? r[k] === v : v !== null && r[k] === v));
            if (q.op === 'update') for (const row of data) Object.assign(row,q.payload);
          }
          data = q.returning ? structuredClone(q.single ? data[0] || null : data) : null;
          return ok({error:null,data});
        } catch(error) {return bad(error);}
      }
    };
    return chain;
  }};
  return db;
}
const ipA = '8.8.8.8', ipB = '1.1.1.1', userName = 'xxz';
const atA = '2026-10-23T01:00:00.000Z', atB = '2026-10-23T01:00:01.000Z';
const event = ip => ({ip,device_id:'device-'+ip,device_type:'desktop',os:'Linux',browser:'Chromium'});
const location = (ip,stamp = atA) => ({source_ip:ip,city:ip === ipA ? '杭州' : '深圳',resolved_at:stamp});
const info = db => JSON.parse(db.rows.find(row => row.media_type === INFO).content);

test('administrator login facts precede lookup and late results preserve the newest login IP',async()=>{
  const db = store([{id:'info',user_name:userName,media_type:INFO,content:'{"email":"keep@example.invalid"}'}]);
  const a = deferred(), b = deferred();
  const first = recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:()=>a.promise});
  await tick(); assert.equal(info(db).last_ip,ipA); assert.equal(info(db).last_ip_location,null);
  const second = recordAdminLogin({db,userName,event:event(ipB),loginAt:atB,resolve:()=>b.promise});
  await tick(); assert.equal(info(db).last_ip,ipB); assert.equal(info(db).last_login,atB);
  b.resolve(location(ipB,atB)); await second;
  a.resolve(location(ipA,atA)); await first;
  assert.equal(info(db).last_ip,ipB); assert.equal(info(db).last_ip_location.city,'深圳'); assert.equal(info(db).last_ip_location_ip,ipB);
  assert.equal(info(db).email,'keep@example.invalid');
  const events = db.rows.filter(row => row.media_type === LOGIN);
  assert.deepEqual(events.map(row => row.created_at),[atA,atB]);
  assert.equal(JSON.parse(events[0].content).ip_location.city,'杭州');
});

test('cross-instance compare-and-swap rejects a stale profile write after a newer login commits',async()=>{
  const db = store([{id:'info',user_name:userName,media_type:INFO,content:'{}'}]), blocked = deferred(), release = deferred();
  let paused = false;
  db.hook = async q => {
    if (!paused && q.op === 'update' && JSON.parse(q.payload.content).last_login === atA) {paused = true; blocked.resolve(); await release.promise;}
  };
  const older = recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:async()=>location(ipA)});
  await blocked.promise;
  await recordAdminLogin({db,userName,event:event(ipB),loginAt:atB,resolve:async()=>location(ipB,atB)});
  release.resolve(); await older;
  assert.equal(info(db).last_ip,ipB); assert.equal(info(db).last_ip_location.city,'深圳');
});

test('concurrent first logins handle the unique profile insert and preserve unrelated concurrent edits',async()=>{
  const db = store(), blocked = deferred(), release = deferred(); let paused = false;
  db.hook = async q => {if (!paused && q.op === 'insert' && q.payload[0].media_type === INFO) {paused = true; blocked.resolve(); await release.promise;}};
  const older = recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:async()=>null});
  await blocked.promise;
  await recordAdminLogin({db,userName,event:event(ipB),loginAt:atB,resolve:async()=>null});
  db.rows.find(row => row.media_type === INFO).content = JSON.stringify({...info(db),email:'concurrent@example.invalid'});
  release.resolve(); await older;
  assert.equal(db.rows.filter(row => row.media_type === INFO).length,1); assert.equal(info(db).last_ip,ipB); assert.equal(info(db).email,'concurrent@example.invalid');
});

test('manual administrator refresh wins over initial lookup, supports mapped addresses and rejects wrong events',async()=>{
  const db = store(), delayed = deferred();
  const pending = recordAdminLogin({db,userName,event:event('::ffff:808:808'),loginAt:atA,resolve:()=>delayed.promise});
  await tick(); const id = db.rows.find(row => row.media_type === LOGIN).id;
  const refreshed = {...location(ipA,atB),city:'已重新核对'};
  assert.equal((await refreshAdminLoginLocation({db,userName,eventId:id,ip:'::ffff:808:808',location:refreshed})).current_updated,true);
  delayed.resolve(location(ipA)); await pending;
  assert.equal(info(db).last_ip_location.city,'已重新核对'); assert.equal(JSON.parse(db.rows.find(row => row.id === id).content).ip_location.city,'已重新核对');
  await assert.rejects(refreshAdminLoginLocation({db,userName,eventId:id,ip:ipB,location:location(ipB)}),/event_mismatch/);
  await assert.rejects(refreshAdminLoginLocation({db,userName:'another',eventId:id,ip:'::ffff:808:808',location:location(ipA)}),/event_mismatch/);
});

test('legacy administrator events can refresh their history without overwriting an unbound current profile',async()=>{
  const db = store([{id:'legacy',user_name:userName,media_type:LOGIN,content:JSON.stringify({source:'admin_login',is_admin:true,ip:ipA,login_at:atA})},
    {id:'info',user_name:userName,media_type:INFO,content:JSON.stringify({last_ip:ipB,last_login:atB})}]);
  const result = await refreshAdminLoginLocation({db,userName,eventId:'legacy',ip:ipA,location:location(ipA)});
  assert.equal(result.event_updated,true); assert.equal(result.current_updated,false); assert.equal(info(db).last_ip,ipB);
});

test('profile storage failures are surfaced and cannot silently overwrite location metadata',async()=>{
  const db = store(); db.hook = q => q.op === 'select' ? {code:'08006'} : null;
  await assert.rejects(recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:async()=>assert.fail('lookup must follow durable profile')}),error=>error.code === '08006');
});

test('a legacy SQL NULL profile uses IS NULL rather than an equality that never matches',async()=>{
  const db = store([{id:'info',user_name:userName,media_type:INFO,content:null}]);
  await recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:async()=>location(ipA)});
  assert.equal(info(db).last_ip,ipA); assert.equal(info(db).last_ip_location.source_ip,ipA);
  assert.ok(db.calls.some(q=>q.filters.some(([key,value,op])=>key === 'content' && value === null && op === 'is')));
});

function retryContext(db,extra = {}) {
  const context = vm.createContext({supabase:db,Date,console:{warn(){}},...extra});
  vm.runInContext(section('async function setIpRegionFailed(', '// ===================== 安全检测逻辑'),context);
  return context;
}
test('old retry failure cannot overwrite a resolved post or another worker lease',async()=>{
  for (const patch of [{ip_region_status:'resolved'},{ip_last_attempt_at:atB}]) {
    const db = store([{id:'post',ip_region_status:'pending',ip_last_attempt_at:atA,ip_lookup_ip_enc:'new-address',ip_city:'新城市',...patch}]);
    await retryContext(db).setIpRegionFailed('post','retry_ip_unavailable',atA);
    assert.equal(db.rows[0].ip_lookup_ip_enc,'new-address'); assert.equal(db.rows[0].ip_city,'新城市');
  }
});
test('owned terminal failure atomically clears stale geography and encrypted retry IP',async()=>{
  const db = store([{id:'post',ip_region_status:'pending',ip_last_attempt_at:atA,ip_lookup_ip_enc:'address',ip_next_retry_at:atB,ip_city:'旧城市',ip_province:'旧省份',ip_resolved_at:atA}]);
  await retryContext(db).setIpRegionFailed('post','retry_ip_unavailable',atA);
  assert.equal(db.rows[0].ip_region_status,'failed');
  for (const field of ['ip_lookup_ip_enc','ip_next_retry_at','ip_city','ip_province','ip_resolved_at']) assert.equal(db.rows[0][field],null);
  assert.equal(db.calls.length,1);
});
test('retry failure falls back only for missing legacy columns and surfaces write outages',async()=>{
  const db = store([{id:'post',ip_region_status:'pending'}]);
  db.hook = q => Object.hasOwn(q.payload,'ip_lookup_ip_enc') ? {code:'PGRST204'} : null;
  await retryContext(db).setIpRegionFailed('post','failed'); assert.equal(db.rows[0].ip_region_status,'failed');
  const unavailable = store(); unavailable.hook = () => ({code:'08006'});
  await assert.rejects(retryContext(unavailable).setIpRegionFailed('post','failed'),error=>error.code === '08006');
});
test('persistent worker passes its lease to terminal failure so a newer worker remains untouched',async()=>{
  const db = store([{id:'post',ip_region_status:'pending',ip_retry_count:0,ip_next_retry_at:atA,ip_lookup_ip_enc:'bad-address'}]);
  const context = retryContext(db,{
    decryptIpRetryAddress(){Object.assign(db.rows[0],{ip_region_status:'resolved',ip_city:'新城市',ip_lookup_ip_enc:null}); return null;},
    isPrivateOrReservedIp:()=>false
  });
  vm.runInContext(section('var ipRetryWorkerRunning = false;', '// This poller discovers'),context);
  await context.processDueIpRegionRetries();
  assert.equal(db.rows[0].ip_region_status,'resolved'); assert.equal(db.rows[0].ip_city,'新城市');
});
test('legacy success never overwrites resolved rows and a failed save triggers a retry',async()=>{
  for (const fail of [false,true]) {
    const db = store([{id:'post',ip_region_status:'resolved',ip_city:'新城市'}]), timers = [];
    if (fail) db.hook = () => ({code:'08006'});
    const context = retryContext(db,{isPrivateOrReservedIp:()=>false,resolveIpRegion:async()=>({status:'resolved',city:'旧城市'}),setTimeout(fn,delay){timers.push(delay);return{unref(){}};}});
    vm.runInContext(section('async function retryIpRegionAsync(', 'async function queuePersistentIpRegionRetry('),context);
    await context.retryIpRegionAsync('post',ipA,1); assert.equal(db.rows[0].ip_city,'新城市'); assert.equal(timers.length,fail ? 1 : 0);
  }
});

function manualRoute(db,extra = {}) {
  let handler;
  const context = vm.createContext({
    app:{post(_path,...handlers){handler = handlers.at(-1);}},verifyToken(){},rateLimit:()=>()=>{},
    supabase:db,ADMIN_USERNAME:userName,LOGIN_EVENT_MARKER:LOGIN,USER_INFO_MARKER:INFO,require:name=>name==='../js/ip-location'?require('../js/ip-location'):require('../render-api/'+name.slice(2)),
    normalizeClientIpValue:require('../render-api/ip-geolocation').normalizeIpAddress,
    isPrivateOrReservedIp:()=>false,resolveIpLocation:async ip=>location(ip,atB),logAdminAudit:async()=>{},
    console:{error(){}},sanitizeError:String,...extra
  });
  vm.runInContext(section("app.post('/admin/user/resolve-ip'", '// Sensitive per-user data'),context);
  return handler;
}
const response = () => ({statusCode:200,status(n){this.statusCode = n;return this;},json(body){this.body = body;return this;}});
test('manual HTTP route refreshes administrator events without calling the incompatible user-auth RPC',async()=>{
  const db = store(); await recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:async()=>null});
  const res = response(), lookups = [];
  await manualRoute(db,{checkedRpc(){assert.fail('admin event is not an ordinary password-account event');},resolveIpLocation:async(ip,options)=>{lookups.push(options);return location(ip,atB);}})({body:{user_name:userName}},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.current_updated,true); assert.equal(info(db).last_ip_location.source_ip,ipA); assert.equal(lookups[0].forceRefresh,true);
});
test('manual HTTP route rejects untrusted legacy events and invalid IPs before contacting providers',async()=>{
  for (const [body,code] of [[{ip:ipA,source:'page_visit'},'unsupported_login_event'],[{...event('unknown'),source:'admin_login',is_admin:true},'invalid_ip']]) {
    const db = store([{id:'legacy',user_name:userName,media_type:LOGIN,content:JSON.stringify(body)}]), res = response();
    await manualRoute(db,{resolveIpLocation(){assert.fail('unsupported event must not contact providers');}})({body:{user_name:userName}},res);
    assert.equal(res.statusCode,422); assert.equal(res.body.code,code);
  }
});

test('manual refresh chooses the current bound event when same-millisecond login ordering is ambiguous',async()=>{
 const db=store();
 await recordAdminLogin({db,userName,event:event(ipA),loginAt:atA,resolve:async()=>null});
 await recordAdminLogin({db,userName,event:event(ipB),loginAt:atA,resolve:async()=>null});
 const lookedUp=[],res=response();
 await manualRoute(db,{resolveIpLocation:async ip=>{lookedUp.push(ip);return location(ip,atB);}})({body:{user_name:userName}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.current_updated,true);assert.deepEqual(lookedUp,[ipB]);
});
