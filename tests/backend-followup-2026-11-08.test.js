'use strict';
// 2026-11-08 审计后续：认证缓存、无盐 SHA-256 口令封装、放弃发布留下的缩略图/封面回收。每条在修复前都会失败。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function withOssEnv(fn) {
  const keys = ['OSS_BUCKET', 'OSS_ENDPOINT', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'];
  const saved = keys.map(key => process.env[key]);
  process.env.OSS_BUCKET = 'test-bucket'; process.env.OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
  process.env.OSS_ACCESS_KEY_ID = 'LTAItestkeyid'; process.env.OSS_ACCESS_KEY_SECRET = 'test-secret';
  const restore = () => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  let result;
  try { result = fn(); } catch (error) { restore(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}
const oss = file => 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/' + file;
const THUMB = 'posts/thumb_0123456789abcdef0123456789abcdef.jpg';
const THUMB2 = 'posts/thumb_fedcba9876543210fedcba9876543210.jpg';

// ───────── 一、认证缓存 ─────────

test('认证缓存：命中期内只查一次，过期后重查，并发请求合并成一次查询', async () => {
  const { createAuthCache } = require('../render-api/auth-cache');
  let clock = 1000, loads = 0;
  const cache = createAuthCache({ now: () => clock, ttlMs: 15000 });
  const loader = async () => { loads++; await new Promise(r => setImmediate(r)); return { id: 'a1', created_at: '2020' }; };
  const results = await Promise.all([cache.identity('alice', loader), cache.identity('alice', loader), cache.identity('alice', loader)]);
  assert.equal(loads, 1, 'concurrent lookups share one query'); assert.equal(results[0].id, 'a1');
  assert.equal((await cache.identity('alice', loader)).id, 'a1'); assert.equal(loads, 1, 'cache hit');
  clock += 14999; await cache.identity('alice', loader); assert.equal(loads, 1);
  clock += 2; await cache.identity('alice', loader); assert.equal(loads, 2, 'expired entries are reloaded');
  await cache.identity('bob', loader); assert.equal(loads, 3, 'users do not share entries');
});

test('认证缓存：查不到的账号、查询失败、限制状态 unavailable 都不缓存（新账号马上可用，写接口仍 fail-closed）', async () => {
  const { createAuthCache } = require('../render-api/auth-cache');
  const cache = createAuthCache({ now: () => 1, ttlMs: 15000 });
  let identity = null, identityLoads = 0;
  const loadIdentity = async () => { identityLoads++; return identity; };
  assert.equal(await cache.identity('newbie', loadIdentity), null);
  identity = { id: 'n1' };
  assert.equal((await cache.identity('newbie', loadIdentity)).id, 'n1', 'a freshly registered account is visible immediately');
  await cache.identity('newbie', loadIdentity); assert.equal(identityLoads, 2, 'only the positive result is cached');
  let failing = true, loads = 0;
  const flaky = async () => { loads++; if (failing) throw new Error('offline'); return { id: 'x' }; };
  await assert.rejects(cache.identity('flaky', flaky), /offline/);
  failing = false; assert.equal((await cache.identity('flaky', flaky)).id, 'x'); assert.equal(loads, 2);
  let state = { is_banned: false, unavailable: true };
  const loadState = async () => state;
  assert.equal((await cache.restrictions('u', loadState)).unavailable, true);
  state = { is_banned: true, is_muted: false, is_blacklisted: false };
  assert.equal((await cache.restrictions('u', loadState)).is_banned, true, 'an unavailable answer was not remembered');
  state = { is_banned: false }; assert.equal((await cache.restrictions('u', loadState)).is_banned, true, 'the real answer is cached');
});

test('认证缓存：清空/失效后立刻重查，清空前发起的慢查询不会把旧状态写回', async () => {
  const { createAuthCache } = require('../render-api/auth-cache');
  const cache = createAuthCache({ now: () => 1, ttlMs: 15000 });
  let state = { is_banned: false }, release;
  // 慢查询在发起时读到的是封禁前的状态（数据库那一刻的快照），返回得晚。
  const slow = () => { const snapshot = { ...state }; return new Promise(resolve => { release = () => resolve(snapshot); }); };
  const pending = cache.restrictions('victim', slow);
  state = { is_banned: true };           // 管理员在此期间封禁了该用户
  cache.clear();                         // 管理员写操作结束 → 清空
  release();
  assert.equal((await pending).is_banned, false, 'the in-flight caller still gets what it loaded');
  let loads = 0;
  const fresh = async () => { loads++; return { is_banned: true }; };
  assert.equal((await cache.restrictions('victim', fresh)).is_banned, true, 'the stale answer was not written back');
  assert.equal(loads, 1);
  cache.invalidate('victim'); await cache.restrictions('victim', fresh); assert.equal(loads, 2, 'invalidate drops one user');
});

test('认证缓存：条目数有上限，不随用户数无限增长', async () => {
  const { createAuthCache } = require('../render-api/auth-cache');
  const cache = createAuthCache({ now: () => 1, ttlMs: 15000, maxEntries: 50 });
  for (let i = 0; i < 400; i++) await cache.identity('u' + i, async () => ({ id: i }));
  assert.ok(cache.size() <= 51, 'size ' + cache.size());
});

test('认证中间件走缓存，且管理员写操作结束后清空缓存（401/403/429 与登录不清空）', () => {
  const auth = SERVER.slice(SERVER.indexOf('async function authenticateUser('), SERVER.indexOf('const dmPrivateStorage = createDmPrivateStorage('));
  assert.match(auth, /authCache\.identity\(payload\.user_name,/);
  assert.match(auth, /authCache\.restrictions\(req\.userName,/);
  assert.doesNotMatch(auth, /await readAccountIdentity\(supabase/, 'no direct per-request identity query');
  assert.doesNotMatch(auth, /await loadUserRestrictions\(req\.userName\)/, 'no direct per-request restrictions query');
  const optional = SERVER.slice(SERVER.indexOf('async function optionalAuth('), SERVER.indexOf("const AUTH_VERIFIER_PREFIX ="));
  assert.match(optional, /authCache\.identity\(/);

  const code = SERVER.slice(SERVER.indexOf('function clearAuthCacheAroundAdminWrite('), SERVER.indexOf("app.use('/admin', clearAuthCacheAroundAdminWrite);"));
  let clears = 0;
  const context = vm.createContext({ authCache: { clear() { clears++; } } });
  vm.runInContext(code, context);
  const run = (method, route, statusCode) => {
    const handlers = {}; const res = { statusCode, once(event, fn) { handlers[event] = fn; return this; } };
    let nextCalled = false;
    context.clearAuthCacheAroundAdminWrite({ method, path: route }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    if (handlers.finish) handlers.finish();
    return clears;
  };
  assert.equal(run('GET', '/data', 200), 0, 'reads never clear');
  assert.equal(run('POST', '/ban', 200), 1, 'a successful admin write clears');
  assert.equal(run('DELETE', '/user/alice', 200), 2);
  assert.equal(run('PUT', '/ban/1/lift', 500), 3, 'a failed write may have partly changed state, so it clears too');
  assert.equal(run('POST', '/ban', 401), 3, 'unauthenticated requests change nothing and cannot thrash the cache');
  assert.equal(run('POST', '/ban', 403), 3); assert.equal(run('POST', '/ban', 429), 3);
  assert.equal(run('POST', '/login', 200), 3, 'admin login does not clear');
  assert.match(SERVER, /app\.use\('\/admin', clearAuthCacheAroundAdminWrite\);\s*app\.use\('\/api\/admin', clearAuthCacheAroundAdminWrite\);/);
  assert.ok(SERVER.indexOf("app.use('/admin', clearAuthCacheAroundAdminWrite)") < SERVER.indexOf("app.post('/admin/ban'"), 'registered before the admin routes');
});

// ───────── 二、无盐 SHA-256 口令封装 ─────────

test('封装后的旧口令：两种旧写法都能用同一个密码登录，错误密码、被篡改的值都不行', async () => {
  const pv = require('../render-api/password-verifier');
  const rawPlain = sha('correct horse'), rawNamed = sha('alice:correct horse');
  const wrappedPlain = await pv.wrapLegacyVerifier(rawPlain), wrappedNamed = await pv.wrapLegacyVerifier(rawNamed);
  for (const wrapped of [wrappedPlain, wrappedNamed]) {
    assert.match(wrapped, /^scrypt:v1w:32768:4:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.equal(wrapped.indexOf('scrypt:v1:'), -1, 'must not look like a standard scrypt verifier');
    assert.ok(!wrapped.includes(rawPlain) && !wrapped.includes(rawNamed), 'the raw SHA-256 is no longer stored');
    assert.equal(await pv.verifyWrappedLegacy(wrapped, 'correct horse', 'alice'), true);
    assert.equal(await pv.verifyWrappedLegacy(wrapped, 'wrong horse', 'alice'), false);
  }
  assert.equal(await pv.verifyWrappedLegacy(wrappedNamed, 'correct horse', 'mallory'), false, 'a username:password verifier is bound to that username');
  const fields = wrappedPlain.split(':'); fields[6] = fields[6].replace(/.$/, c => c === 'A' ? 'B' : 'A');
  assert.equal(await pv.verifyWrappedLegacy(fields.join(':'), 'correct horse', 'alice'), false);
  for (const bad of ['scrypt:v1w:1:1:1:salt:key', 'scrypt:v1w:32768:4:1:salt', 'scrypt:v1w:99999999999:4:1:salt:key', 'scrypt:v1w:20000:4:1:salt:key', 'scrypt:v1w:32768:0:1:salt:key', 'scrypt:v1w::::', '']) {
    assert.equal(await pv.verifyWrappedLegacy(bad, 'x', 'alice'), false, bad);
  }
  await assert.rejects(pv.wrapLegacyVerifier('not-hex'), /not_a_raw_sha256_verifier/);
  await assert.rejects(pv.wrapLegacyVerifier('scrypt:v1:32768:4:1:s:k'), /not_a_raw_sha256_verifier/);
  assert.notEqual(await pv.wrapLegacyVerifier(rawPlain), wrappedPlain, 'salts are random');
});

test('服务端 verifyAuthPassword 认得封装值，并且旧写法与新旧 scrypt 仍然都认', async () => {
  const pv = require('../render-api/password-verifier');
  const code = SERVER.slice(SERVER.indexOf("const AUTH_VERIFIER_PREFIX ="), SERVER.indexOf('// ★ M23：refresh token 持久化失败时返回 null'));
  const verify = vm.runInNewContext(code + '\nverifyAuthPassword;', { crypto, Buffer, passwordVerifier: pv });
  const wrapped = await pv.wrapLegacyVerifier(sha('s3cret!'));
  assert.equal(await verify(wrapped, 's3cret!', 'alice'), true);
  assert.equal(await verify(wrapped, 's3cret?', 'alice'), false);
  assert.equal(await verify(sha('s3cret!'), 's3cret!', 'alice'), true, 'not-yet-wrapped records still log in (and are upgraded)');
  // 登录路由：封装值不是 scrypt:v1: 开头，成功登录后会升级成标准 scrypt。
  const login = SERVER.slice(SERVER.indexOf("app.post('/api/user/login'"), SERVER.indexOf('// 刷新用户 access token'));
  assert.match(login, /indexOf\(AUTH_VERIFIER_PREFIX\) !== 0/);
  assert.equal(wrapped.indexOf('scrypt:v1:'), -1);
});

test('封装脚本：演练只统计不写库；--apply 只封装无盐 SHA-256，条件写入，不碰其他格式，输出里没有校验值', async () => {
  const m = require('../scripts/wrap-legacy-password-hashes');
  const pv = require('../render-api/password-verifier');
  assert.equal(m.classifyVerifier(sha('x')), 'raw_sha256');
  assert.equal(m.classifyVerifier('scrypt:v1:32768:4:1:salt:key'), 'scrypt');
  assert.equal(m.classifyVerifier('scrypt:v1:salt:key'), 'scrypt_legacy_params');
  assert.equal(m.classifyVerifier('scrypt:v1w:32768:4:1:salt:key'), 'wrapped');
  assert.equal(m.classifyVerifier('a'.repeat(32) + ':' + 'b'.repeat(64)), 'pbkdf2');
  assert.equal(m.classifyVerifier(''), 'empty'); assert.equal(m.classifyVerifier('whatever'), 'other');
  assert.throws(() => m.parseArgs(['--delete-everything']), /未知参数/);
  assert.deepEqual(m.parseArgs(['--apply', '--limit=3']), { apply: true, limit: 3 });

  const makeWorld = () => {
    const rows = [];
    for (let i = 0; i < 1203; i++) rows.push({ id: 'id-' + String(i).padStart(5, '0'), media_url: i % 3 === 0 ? sha('pw' + i) : 'scrypt:v1:32768:4:1:salt:key' });
    rows.push({ id: 'id-99998', media_url: 'a'.repeat(32) + ':' + 'b'.repeat(64) }, { id: 'id-99999', media_url: 'scrypt:v1w:32768:4:1:salt:key' });
    const writes = [];
    const deps = {
      async listAuthRows(after, limit) { return rows.filter(r => r.id > after).slice(0, limit).map(r => ({ ...r })); },
      wrap: pv.wrapLegacyVerifier,
      async swap(id, from, to) { writes.push(id); const row = rows.find(r => r.id === id); if (!row || row.media_url !== from) return false; row.media_url = to; return true; }
    };
    return { rows, writes, deps };
  };
  const dry = makeWorld();
  const dryResult = await m.run(dry.deps, { apply: false });
  assert.equal(dry.writes.length, 0, 'dry run never writes');
  assert.equal(dryResult.counts.total, 1205); assert.equal(dryResult.counts.raw_sha256, 401); assert.equal(dryResult.counts.scrypt, 802);
  assert.equal(dryResult.counts.pbkdf2, 1); assert.equal(dryResult.counts.wrapped, 1); assert.equal(dryResult.remaining_raw_sha256, 401);

  const real = makeWorld();
  const result = await m.run(real.deps, { apply: true });
  assert.equal(result.wrapped_now, 401); assert.equal(result.remaining_raw_sha256, 0); assert.equal(result.failed, 0);
  assert.equal(real.rows.filter(r => m.classifyVerifier(r.media_url) === 'raw_sha256').length, 0);
  assert.equal(real.rows.filter(r => r.media_url.indexOf('scrypt:v1:') === 0).length, 802, 'standard scrypt rows untouched');
  assert.equal(real.rows[0].media_url.indexOf('scrypt:v1w:'), 0);
  assert.equal(await pv.verifyWrappedLegacy(real.rows[0].media_url, 'pw0', 'anyone'), true, 'the same password still works after wrapping');
  assert.doesNotMatch(JSON.stringify(result), /scrypt:v1|[a-f0-9]{64}/, 'the report contains no verifier values');

  // 并发的登录升级先改了这一行：条件写入失败，不覆盖。
  const raced = makeWorld(); const original = raced.deps.swap;
  raced.deps.swap = async (id, from, to) => { if (id === 'id-00000') raced.rows[0].media_url = 'scrypt:v1:32768:4:1:upgraded:key'; return original(id, from, to); };
  const racedResult = await m.run(raced.deps, { apply: true });
  assert.equal(racedResult.skipped_changed, 1); assert.equal(raced.rows[0].media_url, 'scrypt:v1:32768:4:1:upgraded:key');
  // --limit 与写库失败
  const limited = makeWorld(); const limitedResult = await m.run(limited.deps, { apply: true, limit: 5 });
  assert.equal(limitedResult.wrapped_now, 5); assert.equal(limitedResult.limited, true);
  const broken = makeWorld(); broken.deps.swap = async () => { throw new Error('offline'); };
  assert.equal((await m.run(broken.deps, { apply: true })).failed, 401);
});

// ───────── 三、放弃发布留下的缩略图/封面 ─────────

function auxDb(options) {
  const opts = options || {}; const rows = opts.rows || []; const log = [];
  const db = { from(table) {
    let filters = [], patch = null, op = 'select', payload = null, inValues = null, likeValue = null;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, neq() { return q; }, limit() { return q; }, or() { return q; },
      in(k, v) { inValues = [k, v]; return q; }, like(k, v) { likeValue = [k, v]; return q; }, maybeSingle() { op = 'single'; return q; },
      insert(value) { op = 'insert'; payload = value; return q; }, update(value) { op = 'update'; patch = value; return q; }, delete() { op = 'delete'; return q; },
      then(resolve, reject) {
        log.push({ table, op, filters: filters.slice(), patch, payload, inValues, likeValue });
        let out = { data: [], error: null };
        if (table === 'post_media_uploads') {
          if (op === 'insert') {
            const dup = rows.find(r => r.storage_path === payload.storage_path);
            if (dup || opts.insertError) out = { data: null, error: dup ? { code: '23505', message: 'duplicate' } : { code: '08006', message: 'down' } };
            else { rows.push({ ...payload, status: 'pending', created_at: new Date().toISOString() }); out = { data: null, error: null }; }
          } else if (op === 'single') {
            const row = rows.find(r => filters.every(([k, v]) => r[k] === v)); out = { data: row ? { ...row } : null, error: null };
          } else if (op === 'update') {
            if (opts.updateError) out = { data: null, error: { message: 'update failed' } };
            else { for (const r of rows) if (filters.every(([k, v]) => r[k] === v) && (!inValues || inValues[1].includes(r[inValues[0]]))) Object.assign(r, patch); out = { data: null, error: null }; }
          } else if (op === 'delete') {
            if (opts.deleteError) out = { data: null, error: { message: 'delete failed' } };
            else { for (let i = rows.length - 1; i >= 0; i--) if (filters.every(([k, v]) => rows[i][k] === v)) rows.splice(i, 1); out = { data: null, error: null }; }
          }
        } else if (opts.referenced && (table === 'posts' || table === 'post_attachments')) {
          out = { data: opts.referenced(table), error: null };
        }
        return Promise.resolve(out).then(resolve, reject);
      } };
    return q; } };
  return { db, rows, log };
}

test('缩略图/封面签名前登记；已被别的账号登记的路径返回 409；登记出错也照常签名；原图路径不登记', async () => withOssEnv(async () => {
  const { installOssSign } = require('../render-api/oss-sign');
  const pass = (req, res, next) => next();
  const call = async (supabase, user, body) => {
    let handler; const app = { post(route, ...stack) { if (route === '/api/oss/sign') handler = stack[stack.length - 1]; } };
    installOssSign(app, { authenticateUser: pass, rateLimit: () => pass, supabase });
    let status = 200, payload; const res = { set() { return this; }, status(n) { status = n; return this; }, json(b) { payload = b; return this; } };
    await handler({ userName: user, body }, res); return { status, payload };
  };
  const sign = { content_type: 'image/jpeg', size: 20000 };
  const a = auxDb();
  const first = await call(a.db, 'alice', { ...sign, path: THUMB });
  assert.equal(first.payload.ok, true);
  assert.equal(a.rows.length, 1); assert.equal(a.rows[0].user_name, 'alice'); assert.match(a.rows[0].upload_id, /^aux_[0-9a-f]{32}$/); assert.equal(a.rows[0].status, 'pending');
  assert.equal((await call(a.db, 'alice', { ...sign, path: THUMB })).payload.ok, true, 'the same account may sign the same path again (retry)');
  assert.equal(a.rows.length, 1);
  const stolen = await call(a.db, 'mallory', { ...sign, path: THUMB });
  assert.equal(stolen.status, 409); assert.equal(stolen.payload.code, 'media_path_exists');
  const poster = await call(a.db, 'alice', { ...sign, path: 'posters/alice_1_abc_poster-1.jpg' });
  assert.equal(poster.payload.ok, true); assert.equal(a.rows.length, 2);
  const original = await call(a.db, 'alice', { ...sign, path: 'posts/alice_1_abc_photo.jpg' });
  assert.equal(original.payload.ok, true); assert.equal(a.rows.length, 2, 'originals are registered by prepare, not here');
  const broken = auxDb({ insertError: true });
  assert.equal((await call(broken.db, 'alice', { ...sign, path: THUMB2 })).payload.ok, true, 'a registry hiccup never blocks an upload');
  assert.equal((await call(undefined, 'alice', { ...sign, path: THUMB2 })).payload.ok, true);
}));

test('发帖成功后，帖子引用的缩略图/封面标记为已使用；别人的、失败的情况不影响发帖', async () => withOssEnv(async () => {
  const aux = require('../render-api/aux-media');
  const content = JSON.stringify({ __type: '__xtj_post_v2__', text: 'hi', meta: { thumbs: [oss(THUMB), null, 'https://evil.example/x.jpg'], poster_url: oss('posters/alice_1_a_poster-1.jpg') } });
  assert.deepEqual(aux.auxPathsInContent(content).sort(), ['posters/alice_1_a_poster-1.jpg', THUMB]);
  assert.deepEqual(aux.auxPathsInContent('plain text'), []);
  assert.deepEqual(aux.auxPathsInContent(JSON.stringify({ __type: '__xtj_post_v2__', meta: { thumbs: [oss('posts/alice_1_original.jpg')] } })), [], 'only thumbnail/poster paths');
  const f = auxDb({ rows: [
    { storage_path: THUMB, user_name: 'alice', upload_id: 'aux_1', status: 'pending' },
    { storage_path: 'posters/alice_1_a_poster-1.jpg', user_name: 'alice', upload_id: 'aux_2', status: 'pending' },
    { storage_path: THUMB2, user_name: 'alice', upload_id: 'aux_3', status: 'pending' }
  ] });
  assert.equal(await aux.markAuxAttached(f.db, 'alice', 'post-1', content), 2);
  assert.deepEqual(f.rows.map(r => r.status), ['attached', 'attached', 'pending'], 'only what this post uses');
  assert.equal(f.rows[0].attached_post_id, 'post-1');
  const other = auxDb({ rows: [{ storage_path: THUMB, user_name: 'bob', upload_id: 'aux_9', status: 'pending' }] });
  await aux.markAuxAttached(other.db, 'alice', 'post-2', content); assert.equal(other.rows[0].status, 'pending', 'never marks another account\'s upload');
  const failing = auxDb({ rows: [], updateError: true }); const warn = console.warn; console.warn = () => {};
  try { assert.equal(await aux.markAuxAttached(failing.db, 'alice', 'post-3', content), 0); } finally { console.warn = warn; }
  assert.match(SERVER, /markAuxAttached\(supabase, req\.userName, inserted\.data && inserted\.data\.id, payload\.content\)\.catch\(/);
}));

test('回收放弃的缩略图/封面：2 天内不动；被引用只改标记；没人引用才删 OSS 对象和登记行；删除失败保留登记行', async () => withOssEnv(async () => {
  const aux = require('../render-api/aux-media');
  const DAY = 86400000, now = Date.parse('2026-11-08T00:00:00Z');
  const row = (age, extra) => ({ storage_path: THUMB, user_name: 'alice', upload_id: 'aux_abc', status: 'pending', created_at: new Date(now - age).toISOString(), ...extra });
  const deleted = [];
  const deps = (extra) => ({ now, deleteObject: async p => { deleted.push(p); }, referencedElsewhere: async () => new Set(), ...extra });
  const young = auxDb({ rows: [row(DAY)] });
  assert.equal(await aux.reclaimAuxUpload(young.db, young.rows[0], deps()), 'young'); assert.equal(deleted.length, 0); assert.equal(young.rows.length, 1);
  const used = auxDb({ rows: [row(3 * DAY)] });
  assert.equal(await aux.reclaimAuxUpload(used.db, used.rows[0], deps({ referencedElsewhere: async (_db, paths, post) => { assert.deepEqual(paths, [THUMB]); assert.match(post, /^0{8}-/); return new Set([THUMB]); } })), 'referenced');
  assert.equal(used.rows[0].status, 'attached'); assert.equal(deleted.length, 0, 'a referenced thumbnail is never deleted');
  const orphan = auxDb({ rows: [row(3 * DAY)] });
  assert.equal(await aux.reclaimAuxUpload(orphan.db, orphan.rows[0], deps()), 'reclaimed');
  assert.deepEqual(deleted, [THUMB]); assert.equal(orphan.rows.length, 0);
  deleted.length = 0;
  const failing = auxDb({ rows: [row(3 * DAY)] });
  await assert.rejects(aux.reclaimAuxUpload(failing.db, failing.rows[0], deps({ deleteObject: async () => { throw new Error('oss_delete_failed 403'); } })), /403/);
  assert.equal(failing.rows.length, 1, 'registry row kept for retry');
  const checkFails = auxDb({ rows: [row(3 * DAY)] });
  await assert.rejects(aux.reclaimAuxUpload(checkFails.db, checkFails.rows[0], deps({ referencedElsewhere: async () => { throw new Error('offline'); } })), /offline/);
  assert.equal(deleted.length, 0, 'when references cannot be checked nothing is deleted');
  assert.equal(await aux.reclaimAuxUpload(young.db, row(3 * DAY, { upload_id: '11111111-1111-4111-8111-111111111111' }), deps()), 'skipped', 'ordinary uploads are not handled here');
  assert.equal(await aux.reclaimAuxUpload(young.db, row(3 * DAY), deps({ enabled: () => false })), 'disabled');
}));

test('清理任务对 aux 登记行走自己的流程，真实引用检查拦住仍在使用的缩略图；账号注销流程不再被封面路径卡住', async () => withOssEnv(async () => {
  const { sweepPostMediaUploads, retireAccountPostMediaUploads } = require('../render-api/post-media');
  const originalFetch = global.fetch; const requests = [];
  global.fetch = async (url, init) => { requests.push([init.method, String(url)]); return { ok: true, status: 204, text: async () => '' }; };
  try {
    const old = '2026-01-01T00:00:00Z';
    const live = oss(THUMB), liveContent = JSON.stringify({ __type: '__xtj_post_v2__', meta: { thumbs: [live] } });
    const f = auxDb({ rows: [
      { storage_path: THUMB, user_name: 'alice', upload_id: 'aux_live', status: 'pending', created_at: old },
      { storage_path: THUMB2, user_name: 'alice', upload_id: 'aux_dead', status: 'pending', created_at: old }
    ], referenced: table => table === 'posts' && true ? [{ id: 'p1', media_url: '', content: liveContent }] : [] });
    // sweep 的查询要返回登记行：给 select 链补一个按 status 过滤的读取
    const realFrom = f.db.from.bind(f.db);
    f.db.from = table => {
      const q = realFrom(table);
      if (table !== 'post_media_uploads') return q;
      const originalThen = q.then;
      let isSweepRead = false;
      const origSelect = q.select; q.select = function (...a) { isSweepRead = true; return origSelect.apply(q, a); };
      const origOrder = q.order; q.order = () => q; q.gt = () => q; q.lt = () => q; q.limit = () => q;
      q.in = function (k, v) { if (k === 'status') return q; return q; };
      q.then = function (resolve, reject) {
        if (isSweepRead && !q._mut) return Promise.resolve({ data: f.rows.filter(r => r.status === 'pending' || r.status === 'cleanup').map(r => ({ ...r })), error: null }).then(resolve, reject);
        return originalThen.call(q, resolve, reject);
      };
      for (const m of ['update', 'delete', 'insert']) { const orig = q[m]; q[m] = function (...a) { q._mut = true; return orig.apply(q, a); }; }
      return q;
    };
    await sweepPostMediaUploads(f.db, { now: Date.parse('2026-11-08T00:00:00Z') });
    assert.equal(f.rows.find(r => r.upload_id === 'aux_live').status, 'attached', 'a thumbnail a live post still uses is kept');
    assert.equal(f.rows.some(r => r.upload_id === 'aux_dead'), false, 'the abandoned one is gone');
    const deletes = requests.filter(r => r[0] === 'DELETE').map(r => r[1]);
    assert.deepEqual(deletes, [oss(THUMB2)]);
  } finally { global.fetch = originalFetch; }

  // 账号注销：aux 登记行（封面不在 posts/ 下）不能让 retire 抛 unsafe_account_media_path，也不进 Supabase 清理队列。
  const queued = [];
  const rows = [
    { storage_path: 'posters/alice_1_a_poster-1.jpg', upload_id: 'aux_1' }, { storage_path: THUMB, upload_id: 'aux_2' }, { storage_path: 'posts/alice_1_a_photo.jpg', upload_id: 'u-1' }
  ];
  const db = { from() { let patchMode = false; const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, gt() { return q; }, in() { return q; }, update() { patchMode = true; return q; },
      then(resolve, reject) { return Promise.resolve({ data: patchMode ? null : rows, error: null }).then(resolve, reject); } }; return q; },
    async rpc(name, args) { if (name === 'enqueue_storage_cleanup') { queued.push(...args.p_paths); return { data: { ok: true, queued: true, paths: args.p_paths } }; } return { data: null }; } };
  const retired = await retireAccountPostMediaUploads(db, 'alice');
  assert.deepEqual(retired, ['posts/alice_1_a_photo.jpg']); assert.deepEqual(queued, ['posts/alice_1_a_photo.jpg']);
}));
