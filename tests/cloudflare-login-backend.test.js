'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createLoginBackend } = require('../cloudflare/login-backend');
const {createIpLocationTools} = require('../js/ip-location');
const {createAdminLoginStore} = require('../render-api/admin-login-ip');
const { createPreviewWorker } = require('../cloudflare/pages-worker');
const { createAdminVerifier } = require('../cloudflare/admin-verifier');
const { REVOKED_TOKEN_MARKER } = require('../render-api/post-markers');

const ORIGIN = 'https://preview.example', DB = 'https://fixture.supabase.co';
const ENV = { API_SECRET: 'fixture-original-signing-key', SUPABASE_URL: DB, SUPABASE_SERVICE_KEY: 'sb_secret_fixture', ADMIN_PASSWORD: 'fixture-admin-password' };
const PASSWORD = 'fixture-password';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function signed(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b64 + '.' + crypto.createHmac('sha256', ENV.API_SECRET).update(b64).digest('base64url');
}
const claims = token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url'));
function fixture(options = {}) {
  const records = [{ id: 'account-1', user_name: 'alice', media_type: '__auth__', media_url: options.verifier || sha(PASSWORD), created_at: '2020-01-01T00:00:00Z' }];
  const calls = [], receipts = new Map();let lostRotationResponse=false;
  const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  async function fetcher(input, init) {
    const url = new URL(input), body = init.body && JSON.parse(init.body);
    assert.equal(url.origin, DB);
    assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_KEY);
    assert.equal(init.headers.Authorization, undefined, 'new secret key is not a bearer JWT');
    assert.equal(init.redirect, 'manual');
    calls.push({ url, ...init, body });
    if (options.fail?.(url, init, body)) return new Response('private provider error', { status: 503 });
    if (url.pathname.endsWith('/rpc/get_user_restrictions')) return response(options.restrictions || { is_banned: false, is_muted: false, is_blacklisted: false });
    if (url.pathname.endsWith('/rpc/record_user_auth_event')) return response({ event_id: 'event-1', login_at: new Date().toISOString(), registered_at: '2020-01-01T00:00:00Z' });
    if (url.pathname.endsWith('/rpc/record_auth_ip_location')) return response({ok:true,event_updated:true,current_updated:true});
    if (url.pathname.endsWith('/rpc/merge_user_info')) return response({ ok: true });
    if (url.pathname.endsWith('/rpc/revoke_user_refresh_session')) {
      const receipt=receipts.get(body.p_jti), ids=[body.p_jti,receipt?.successor.jti];
      for(let i=records.length-1;i>=0;i--)if(records[i].user_name===body.p_user_name&&records[i].media_type==='__refresh_token__'&&ids.includes(records[i].media_url))records.splice(i,1);
      receipts.delete(body.p_jti);return response(true);
    }
    if (url.pathname.endsWith('/rpc/rotate_user_refresh_token_v2')) {
      const receipt=receipts.get(body.p_old_jti);
      if(receipt)return response(receipt.hash===body.p_request_hash&&records.some(r=>r.media_type==='__refresh_token__'&&r.media_url===receipt.successor.jti)?{ok:true,recovered:true,successor:receipt.successor}:{ok:false});
      const old=records.find(r=>r.media_type==='__refresh_token__'&&r.media_url===body.p_old_jti&&r.user_name===body.p_user_name);
      if(!old||options.rotationConflict)return response({ok:false});records.splice(records.indexOf(old),1);
      records.push({id:crypto.randomUUID(),user_name:body.p_user_name,media_type:'__refresh_token__',media_url:body.p_successor.jti});
      receipts.set(body.p_old_jti,{hash:body.p_request_hash,successor:body.p_successor});
      if(options.loseRotationResponse&&!lostRotationResponse){lostRotationResponse=true;return new Response('{}',{status:503});}
      return response({ok:true,recovered:false,successor:body.p_successor});
    }
    if (url.pathname.endsWith('/rpc/rotate_user_refresh_token')) {
      const old = records.find(r => r.media_type === '__refresh_token__' && r.media_url === body.p_old_jti);
      if (!old || options.rotationConflict) return response({ ok: false });
      records.splice(records.indexOf(old), 1);
      records.push({ id: crypto.randomUUID(), user_name: body.p_user_name, media_type: '__refresh_token__', media_url: body.p_new_jti });
      return response({ ok: true });
    }
    assert.equal(url.pathname, '/rest/v1/posts');
    const matches = row => [...url.searchParams].every(([key, value]) => {
      if (['select', 'order', 'limit'].includes(key)) return true;
      if (value.startsWith('eq.')) return row[key] != null && String(row[key]) === value.slice(3);
      if (value === 'is.null') return row[key] == null;
      if (value.startsWith('gt.')) return String(row[key]) > value.slice(3);
      assert.fail('unexpected filter ' + key);
    });
    if (init.method === 'POST') {
      if (body.media_type === '__rate_limit__' && records.some(r => r.media_type === body.media_type && r.media_url === body.media_url)) return new Response('{}', { status: 409 });
      const inserted = (Array.isArray(body) ? body : [body]).map(value=>({id:crypto.randomUUID(),...value}));
      records.push(...inserted);return response(inserted);
    }
    let found = records.filter(matches);
    if ((url.searchParams.get('order') || '').startsWith('created_at.')) found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (url.searchParams.get('order').endsWith('desc') ? -1 : 1));
    found = found.slice(0, Number(url.searchParams.get('limit') || 100));
    if (init.method === 'PATCH') {
      if (options.casConflict && found[0]?.media_type === '__rate_limit__') found = [];
      for (const row of found) Object.assign(row, body);
    } else if (init.method === 'DELETE') for (const row of found) records.splice(records.indexOf(row), 1);
    return response(found);
  }
  const backend = createLoginBackend(DB, REVOKED_TOKEN_MARKER, crypto, Buffer, { fetch: fetcher, ...options.runtime });
  const worker = createPreviewWorker({}, DB, null, backend);
  async function request(path, body, headers = {}, env = ENV) {
    const method = body === undefined ? 'GET' : 'POST';
    const req=new Request(ORIGIN + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: ORIGIN }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if(options.cf)Object.defineProperty(req,'cf',{value:options.cf});
    return worker.fetch(req, env);
  }
  return { records, calls, backend, worker, request, fetcher };
}

test('edge login stores platform city evidence for its canonical IP and never uses body or forged city headers',async()=>{
 const f=fixture({cf:{country:'CN',region:'Zhejiang',regionCode:'ZJ',city:'Huzhou',colo:'HKG'}});
 const res=await f.request('/api/user/login',{user_name:'alice',password:PASSWORD,ip:'1.1.1.1',city:'ForgedCity'}, {'cf-connecting-ip':'::ffff:808:808','cf-ipcity':'ForgedCity'});
 assert.equal(res.status,200);
 const facts=f.calls.find(call=>call.url.pathname.endsWith('/rpc/record_user_auth_event')).body.p_event;
 const saved=f.calls.find(call=>call.url.pathname.endsWith('/rpc/record_auth_ip_location')).body;
 assert.equal(facts.ip,'8.8.8.8');assert.equal(facts.ip_version,4);assert.equal(saved.p_ip,'8.8.8.8');assert.equal(saved.p_location.city,'湖州');assert.equal(saved.p_location.city_confidence,'single_source');assert.deepEqual(saved.p_location.providers,['cloudflare']);
});
test('edge Pseudo IPv4 login records original IPv6, while anonymous cross-zone relays stay unknown',async()=>{
 for(const relay of [false,true]){
  const f=fixture({cf:{country:'CN',region:'Anhui',regionCode:'AH',city:'Suzhou'}});
  const res=await f.request('/api/user/login',{user_name:'alice',password:PASSWORD},{'cf-connecting-ip':relay?'2a06:98c0:3600::103':'241.1.1.1','cf-connecting-ipv6':'2001:4860:4860::8888'});
  assert.equal(res.status,200);
  const facts=f.calls.find(call=>call.url.pathname.endsWith('/rpc/record_user_auth_event')).body.p_event;
  const geo=f.calls.find(call=>call.url.pathname.endsWith('/rpc/record_auth_ip_location'));
  assert.equal(facts.ip,relay?'':'2001:4860:4860::8888');if(relay)assert.equal(geo,undefined);else assert.equal(geo.body.p_location.city,'宿州');
 }
});
test('edge administrator profile uses shared CAS, overwrites SQL NULL, and clears stale city on unavailable metadata',async()=>{
 const cf={country:'CN',region:'Zhejiang',regionCode:'ZJ',city:'Huzhou'},f=fixture({cf});
 f.records.push({id:'admin-info',user_name:'xxz',media_type:'__user_info__',content:null});
 const first=await f.request('/admin/login',{username:'xxz',password:ENV.ADMIN_PASSWORD},{'cf-connecting-ip':'8.8.8.8'});assert.equal(first.status,200);
 const read=()=>JSON.parse(f.records.find(row=>row.id==='admin-info').content);
 assert.equal(read().last_ip,'8.8.8.8');assert.equal(read().last_ip_location.city,'湖州');assert.equal(read().last_ip_location_ip,'8.8.8.8');assert.ok(read().last_auth_event_id);
 cf.country=null;
 const second=await f.request('/admin/login',{username:'xxz',password:ENV.ADMIN_PASSWORD},{'cf-connecting-ip':'1.1.1.1'});assert.equal(second.status,200);
 assert.equal(read().last_ip,'1.1.1.1');assert.equal(read().last_ip_location,null);assert.equal(read().last_ip_location_ip,null);
});
function cookieHeader(response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
async function login(f, user = 'alice', password = PASSWORD) {
  const res = await f.request('/api/user/login', { user_name: user, password, device_id: 'fixture-device' });
  return { res, data: await res.json(), cookie: cookieHeader(res) };
}

test('password login upgrades legacy verifier, commits real authentication event and issues original-format secure sessions', async () => {
  const f = fixture(), { res, data, cookie } = await login(f);
  assert.equal(res.status, 200);
  assert.equal(data.user_name, 'alice'); assert.ok(data.authenticated_at); assert.ok(data.registered_at);
  assert.match(f.records[0].media_url, /^scrypt:v1:32768:4:1:/);
  assert.equal(claims(data.token).account_id, 'account-1');
  const [b64, sig] = data.token.split('.');
  assert.equal(sig, crypto.createHmac('sha256', ENV.API_SECRET).update(b64).digest('base64url'));
  assert.match(cookie, /xtj_user_refresh=/);
  for (const value of res.headers.getSetCookie()) assert.match(value, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(res.headers.getSetCookie().length, 4);
  assert.match(res.headers.get('Cache-Control'), /no-store/);
  assert.equal(f.calls.filter(c => c.url.pathname.includes('/rpc/record_user_auth_event')).length, 1);
  assert.equal(f.calls.some(c => c.url.hostname.includes('render')), false);
});

test('all retained password formats agree with the original Render verifier, including historical scrypt parameters', async () => {
  const server = fs.readFileSync(require.resolve('../render-api/server.js'), 'utf8');
  const original = vm.runInNewContext(server.slice(server.indexOf("const AUTH_VERIFIER_PREFIX ="), server.indexOf('// ★ M23：refresh token 持久化失败时返回 null')) + '\nverifyAuthPassword;', { crypto, Buffer });
  const salt = 'fixture-salt', legacySalt = 'a'.repeat(32);
  const verifiers = [
    'scrypt:v1:32768:4:1:' + salt + ':' + crypto.scryptSync(PASSWORD, salt, 32, { N: 32768, r: 4, p: 1 }).toString('base64url'),
    'scrypt:v1:' + salt + ':' + crypto.scryptSync(PASSWORD, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url'),
    legacySalt + ':' + crypto.pbkdf2Sync(PASSWORD, legacySalt, 100000, 32, 'sha256').toString('hex'), sha(PASSWORD), sha('alice:' + PASSWORD)
  ];
  for (const verifier of verifiers) {
    assert.equal(await original(verifier, PASSWORD, 'alice'), true);
    const f = fixture({ verifier });
    assert.equal((await login(f)).res.status, 200);
    assert.equal((await login(f, 'alice', 'wrong')).res.status, 401);
  }
});

test('database/restriction/session/audit failures never mint cookies or expose provider errors', async () => {
  for (const fail of [
    url => url.searchParams.get('media_type') === 'eq.__auth__',
    url => url.pathname.endsWith('/rpc/get_user_restrictions'),
    (url, init, body) => body?.media_type === '__refresh_token__',
    url => url.pathname.endsWith('/rpc/record_user_auth_event')
  ]) {
    const f = fixture({ fail }), { res, data } = await login(f);
    assert.equal(res.status, 503); assert.equal(res.headers.has('Set-Cookie'), false);
    assert.equal(data.retryable, true); assert.equal(JSON.stringify(data).includes('private provider'), false);
  }
  const banned = fixture({ restrictions: { is_banned: true } });
  assert.equal((await login(banned)).res.status, 403);
  assert.equal(banned.records.some(r => r.media_type === '__refresh_token__'), false);
});

test('persistent limits combine case/trailing-slash variants and fail closed on CAS contention', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 16 }, (_, i) => f.request(i % 2 ? '/API/USER/LOGIN/' : '/api/user/login', { user_name: 'alice', password: 'wrong' })));
  assert.equal(responses.filter(r => r.status === 401).length <= 10, true);
  assert.equal(responses.every(r => [401, 429, 503].includes(r.status)), true);
  let saturated;
  for (let i = 0; i < 11; i++) saturated = await f.request('/api/user/login', { user_name: 'alice', password: 'wrong' });
  assert.equal(saturated.status, 429); assert.ok(saturated.headers.get('Retry-After'));
  const conflict = fixture({ casConflict: true });
  conflict.records.push({ id: 'limit-1', media_type: '__rate_limit__', media_url: 'rl_' + sha(':/api/user/login').slice(0, 32), content: JSON.stringify({ count: 1, resetAt: Date.now() + 60000 }) });
  assert.equal((await login(conflict)).res.status, 503);
  const persisted = fixture();
  for (let i = 0; i < 10; i++) assert.equal((await login(persisted, 'alice', 'wrong')).res.status, 401);
  const coldBackend = createLoginBackend(DB, REVOKED_TOKEN_MARKER, crypto, Buffer, { fetch: persisted.fetcher });
  const cold = await coldBackend(new Request(ORIGIN + '/api/user/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ user_name: 'alice', password: 'wrong' }) }), ENV);
  assert.equal(cold.status, 429, 'a new isolate must still enforce the stored counter');
});

test('historical numeric RPC counters retain active windows and only expire using their saved server timestamp', async () => {
  for (const expired of [false, true]) {
    const f = fixture();
    f.records.push({ id: 'numeric-limit', media_type: '__rate_limit__', media_url: 'rl_' + sha(':/api/user/login').slice(0, 32), content: '10', updated_at: new Date(Date.now() - (expired ? 120000 : 1000)).toISOString() });
    assert.equal((await login(f, 'alice', 'wrong')).res.status, expired ? 401 : 429);
  }
});

test('CSRF, malformed bodies, wrong database bindings and unsupported routes stop before database access', async () => {
  const f = fixture();
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '', Cookie: 'xtj_user_refresh=fixture' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.request('/api/user/login', {}, headers)).status, 403);
  }
  assert.equal((await f.request('/api/user/login', [] )).status, 400);
  assert.equal((await f.request('/api/user/login', { password: 'x'.repeat(9000) })).status, 400);
  assert.equal((await f.request('/api/user/login', {}, {}, { ...ENV, SUPABASE_URL: 'https://other.example' })).status, 503);
  assert.equal((await f.request('/api/user/register', {})).status, 503);
  assert.equal(f.calls.length, 0);
  const stream = new ReadableStream({ start() {} });
  const stalled = fixture({ runtime: { timeoutMs: 20 } });
  const response = await stalled.worker.fetch(new Request(ORIGIN + '/api/user/login', { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'application/json' } }), ENV);
  assert.equal(response.status, 503); assert.equal(stalled.calls.length, 0);
});

test('refresh rotates atomically once, rejects replay without clearing successor cookies, and retains account lifecycle', async () => {
  const f = fixture(), initial = await login(f);
  const res = await f.request('/api/user/refresh', { device_id: 'changed-device' }, { Cookie: initial.cookie });
  assert.equal(res.status, 200);
  assert.notEqual(cookieHeader(res), initial.cookie);
  const refreshed = await res.json(); assert.equal(claims(refreshed.token).account_id, 'account-1');
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/rpc/record_user_auth_event')).length, 1, 'refresh is not a password login event');
  const replay = await f.request('/api/user/refresh', {}, { Cookie: initial.cookie });
  assert.equal(replay.status, 409); assert.equal(replay.headers.has('Set-Cookie'), false);
  f.records[0].id = 'recreated-account';
  const expired = await f.request('/api/user/refresh', {}, { Cookie: cookieHeader(res) });
  assert.equal(expired.status, 401); assert.equal(expired.headers.has('Set-Cookie'), false);
});

test('logout persists revocation, protects a different account cookie, and authenticated reads never write', async () => {
  const f = fixture(), initial = await login(f);
  const headers = { Authorization: 'Bearer ' + initial.data.token, Cookie: initial.cookie };
  const before = f.calls.length;
  assert.equal((await f.request('/api/user/profile', undefined, headers)).status, 200);
  const restrictions = await f.request('/api/user/restrictions', undefined, headers);
  assert.equal((await restrictions.json()).is_admin, false);
  assert.equal(f.calls.slice(before).every(c => c.method === 'GET' || c.url.pathname.endsWith('/rpc/get_user_restrictions')), true);
  const bob = signed({ exp: Date.now() + 60000, type: 'user_refresh', user_name: 'bob', account_id: 'bob-1', jti: crypto.randomUUID() });
  const preserved = await f.request('/api/user/logout', {}, { Authorization: headers.Authorization, Cookie: 'xtj_user_refresh=' + bob });
  assert.equal((await preserved.json()).preserved_other_session, true); assert.equal(preserved.headers.has('Set-Cookie'), false);
  const out = await f.request('/api/user/logout', {}, headers);
  assert.equal(out.status, 200); assert.equal(out.headers.getSetCookie().length, 4);
  assert.equal(f.records.some(r => r.media_type === '__refresh_token__'), false);
  assert.equal((await f.request('/api/user/profile', undefined, headers)).status, 401);
});

test('admin-only credentials preserve companion session and durable admin logout', async () => {
  for (const env of [ENV, { ...ENV, ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: 'sha256:' + sha(ENV.ADMIN_PASSWORD) }]) {
    const f = fixture();
    const res = await f.request('/admin/login', { username: 'xxz', password: ENV.ADMIN_PASSWORD }, {}, env);
    const data = await res.json(); assert.equal(res.status, 200); assert.ok(data.user_token);
    assert.equal(claims(data.token).user, 'xxz'); assert.equal(claims(data.token).type, undefined);
    assert.match(res.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Strict/);
    const logout = await f.request('/admin/logout', {}, { Cookie: cookieHeader(res) }, env);
    assert.equal(logout.status, 200);
    assert.equal(f.records.some(r => r.media_type === REVOKED_TOKEN_MARKER && r.media_url === sha(data.token)), true);
  }
});

test('admin login survives companion identity failures, and profile returns the earliest retained registration time', async () => {
  const unavailable = fixture({ fail: url => url.searchParams.get('media_type') === 'eq.__auth__' });
  const res = await unavailable.request('/admin/login', { username: 'xxz', password: ENV.ADMIN_PASSWORD });
  const data = await res.json();
  assert.equal(res.status, 200); assert.equal(data.user_token, null); assert.ok(data.user_session_error);
  assert.equal(res.headers.getSetCookie().length, 1);
  const f = fixture(), initial = await login(f);
  f.records.push({ ...f.records[0], id: 'older-legacy-record', created_at: '2019-01-01T00:00:00Z' });
  const profile = await f.request('/api/user/profile', undefined, { Authorization: 'Bearer ' + initial.data.token });
  assert.equal((await profile.json()).registered_at, '2019-01-01T00:00:00Z');
});

test('refresh and logout infrastructure failures preserve browser credentials', async () => {
  for (const route of ['/api/user/refresh', '/api/user/logout']) {
    let fail = false;
    const f = fixture({ fail: () => fail }), initial = await login(f); fail = true;
    const res = await f.request(route, {}, { Cookie: initial.cookie, Authorization: 'Bearer ' + initial.data.token });
    assert.equal(res.status, 503); assert.equal(res.headers.has('Set-Cookie'), false);
  }
});

test('workerd executes native scrypt, login, cookie headers and atomic refresh against isolated outbound data', async () => {
  const { Miniflare, Response: WorkerResponse } = require('miniflare');
  const f = fixture();
  const script = `import * as nativeCrypto from 'node:crypto';
    import { Buffer } from 'node:buffer';
    const ipTools = (${createIpLocationTools.toString()})(${JSON.stringify(require('../js/ip-city-data'))});
    const adminIpStore = (${createAdminLoginStore.toString()})(nativeCrypto, ipTools);
    const backend = (${createLoginBackend.toString()})(${JSON.stringify(DB)}, ${JSON.stringify(REVOKED_TOKEN_MARKER)}, nativeCrypto, Buffer, {}, ipTools, adminIpStore);
    const verifyAdmin = (${createAdminVerifier.toString()})(${JSON.stringify(DB)}, ${JSON.stringify(REVOKED_TOKEN_MARKER)});
    export default (${createPreviewWorker.toString()})({}, ${JSON.stringify(DB)}, verifyAdmin, backend);`;
  const mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-07-30', compatibilityFlags: ['nodejs_compat'], bindings: ENV,
    outboundService: async request => {
      const response = await f.fetcher(request.url, { method: request.method, headers: Object.fromEntries(request.headers),
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(), redirect: 'manual' });
      return new WorkerResponse(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
    }
  });
  try {
    const res = await mf.dispatchFetch(ORIGIN + '/api/user/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ user_name: 'alice', password: PASSWORD }) });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const data = await res.json(); assert.equal(claims(data.token).account_id, 'account-1');
    assert.equal(res.headers.getSetCookie().length, 4);
    assert.match(f.records[0].media_url, /^scrypt:v1:32768:4:1:/);
    // The verifier just derived inside workerd must validate in Node/Render.
    assert.equal((await login(f)).res.status, 200);
    const refresh = await mf.dispatchFetch(ORIGIN + '/api/user/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookieHeader(res) }, body: '{}' });
    assert.equal(refresh.status, 200);
    const adminToken = signed({ exp: Date.now() + 60000, user: 'xxz' });
    const verified = await mf.dispatchFetch(ORIGIN + '/admin/verify', { headers: { Authorization: 'Bearer ' + adminToken } });
    assert.equal(verified.status, 200);
    assert.deepEqual(await verified.json(), { ok: true });
  } finally { await mf.dispose(); }
});

test('database redirects are rejected without forwarding service credentials', async () => {
  let calls = 0;
  const fetcher = async (url, init) => {
    calls++; assert.equal(new URL(url).origin, DB); assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
  };
  const f = fixture({ runtime: { fetch: fetcher } });
  assert.equal((await login(f)).res.status, 503);
  assert.equal(calls, 1);
});

test('Supabase egress restrictions retain the existing 402 contract and do not clear refresh cookies', async () => {
  for (const path of ['/api/user/login', '/api/user/refresh']) {
    const f = fixture({ runtime: { fetch: async () => new Response('{"code":"exceed_egress_quota","private":"fixture-provider-secret"}', { status: 402 }) } });
    const response = await f.request(path, { user_name: 'alice', password: PASSWORD }, { Cookie: 'xtj_user_refresh=fixture' });
    const data = await response.json();
    assert.equal(response.status, 402); assert.equal(data.code, 'egress_quota_exceeded');
    assert.equal(data.retryable, false); assert.equal(response.headers.has('Set-Cookie'), false);
    assert.equal(JSON.stringify(data).includes('fixture-provider-secret'), false);
  }
});

test('edge lost rotation acknowledgement recovers the exact signed successor and logout with the predecessor revokes it',async()=>{
 const f=fixture({loseRotationResponse:true}),login=await f.request('/api/user/login',{user_name:'alice',password:PASSWORD});assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().find(s=>s.startsWith('xtj_user_refresh=')).split(';')[0],nonce=crypto.randomUUID();
 assert.equal((await f.request('/api/user/refresh',{refresh_request_id:nonce},{cookie})).status,503);
 const recovered=await f.request('/api/user/refresh',{refresh_request_id:nonce},{cookie});assert.equal(recovered.status,200);const saved=recovered.headers.getSetCookie().find(s=>s.startsWith('xtj_user_refresh=')).split(';')[0].split('=')[1];assert.equal(claims(saved).user_name,'alice');assert.notEqual(saved,cookie.split('=')[1]);
 const repeated=await f.request('/api/user/refresh',{refresh_request_id:nonce},{cookie});assert.equal(repeated.headers.getSetCookie().find(s=>s.startsWith('xtj_user_refresh=')).split(';')[0],'xtj_user_refresh='+saved);
 for(const body of [{refresh_request_id:crypto.randomUUID()},{}]){const denied=await f.request('/api/user/refresh',body,{cookie});assert.equal(denied.status,409);assert.deepEqual(denied.headers.getSetCookie(),[]);}
 assert.equal((await f.request('/api/user/refresh',{refresh_request_id:'invalid'},{cookie})).status,400);
 const logout=await f.request('/api/user/logout',{}, {cookie});assert.equal(logout.status,200);assert.equal((await f.request('/api/user/refresh',{refresh_request_id:nonce},{cookie})).status,409);
});

test('edge logout revokes a recovered successor even when its signed predecessor has no account_id',async()=>{
 const f=fixture(),login=await f.request('/api/user/login',{user_name:'alice',password:PASSWORD});assert.equal(login.status,200);
 const modern=login.headers.getSetCookie().find(s=>s.startsWith('xtj_user_refresh=')).split(';')[0].split('=')[1],legacyClaims=claims(modern);delete legacyClaims.account_id;
 const cookie='xtj_user_refresh='+signed(legacyClaims),nonce=crypto.randomUUID();assert.equal((await f.request('/api/user/refresh',{refresh_request_id:nonce},{cookie})).status,200);
 assert.equal((await f.request('/api/user/logout',{}, {cookie})).status,200);assert.equal((await f.request('/api/user/refresh',{refresh_request_id:nonce},{cookie})).status,409);
 const revoke=f.calls.find(call=>call.url.pathname.endsWith('/rpc/revoke_user_refresh_session'));assert.equal(revoke.body.p_account_id,null);
});
