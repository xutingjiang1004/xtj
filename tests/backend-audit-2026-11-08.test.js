'use strict';
// 2026-11-08 后端审计修复的回归测试。每一条在修复前都会失败。
// 其中 HTTP 层的几条会真实启动 render-api/server.js，数据库指向测试内起的假 PostgREST，不触达任何线上服务。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');

function withOssEnv(fn) {
  const keys = ['OSS_BUCKET', 'OSS_ENDPOINT', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'];
  const saved = keys.map(key => process.env[key]);
  process.env.OSS_BUCKET = 'test-bucket';
  process.env.OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
  process.env.OSS_ACCESS_KEY_ID = 'LTAItestkeyid';
  process.env.OSS_ACCESS_KEY_SECRET = 'test-secret';
  const restore = () => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  let result;
  try { result = fn(); } catch (error) { restore(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}
const oss = file => 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/' + file;
const THUMB = 'posts/thumb_0123456789abcdef0123456789abcdef.jpg';
const OTHER_THUMB = 'posts/thumb_fedcba9876543210fedcba9876543210.jpg';

// ───────── 1. 删帖不能误删别人的 OSS 媒体（审计 H1）─────────

test('H1 伪造的 meta 不能让删帖带走别人的原图、视频和缩略图', () => withOssEnv(() => {
  const { collectPostOssPaths } = require('../render-api/oss-cleanup');
  const attacker = {
    user_name: 'mallory', media_type: 'text', media_url: '',
    content: JSON.stringify({ __type: '__xtj_post_v2__', text: 'x', meta: {
      // 别人的原图、视频：不是缩略图格式，必须被拒绝
      thumbs: [oss('posts/victim_1_a_photo.jpg'), oss('posts/victim_2_b_video.mp4')],
      // 别人的封面：不以攻击者自己的名字开头
      poster_url: oss('posters/victim_3_c_poster-1.jpg') } })
  };
  assert.deepEqual(collectPostOssPaths(attacker, []), []);
}));

// 只模拟 posts 表「别的帖子内容里是否提到某个文件名」的查询（与 main 的 unreferencedElsewhere 一致）。
function contentDb(others, fail) {
  return { from(table) {
    let notId = null, like = null;
    const q = { select() { return q; }, neq(_c, v) { notId = v; return q; }, ilike(_c, v) { like = v.slice(1, -1); return q; }, eq() { return q; }, limit() { return q; },
      then(resolve, reject) {
        if (fail) return Promise.resolve({ data: null, error: new Error('offline') }).then(resolve, reject);
        if (table === 'post_attachments') return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        return Promise.resolve({ data: others.filter(o => o.id !== notId && o.content.includes(like)).map(o => ({ id: o.id })), error: null }).then(resolve, reject);
      } };
    return q;
  } };
}

test('H1 缩略图格式合法也不能删：别人的帖子还在引用它时一律保留', async () => withOssEnv(async () => {
  const { readPostCleanupPaths } = require('../render-api/oss-cleanup');
  const victim = [{ id: 'victim-post', content: JSON.stringify({ __type: '__xtj_post_v2__', text: 'v', meta: { thumbs: [oss(OTHER_THUMB)] } }) }];
  const attacker = { user_name: 'mallory', media_url: '', content: JSON.stringify({ __type: '__xtj_post_v2__', meta: { thumbs: [oss(OTHER_THUMB), oss(THUMB)] } }) };
  const result = await readPostCleanupPaths(contentDb(victim), attacker, 'attacker-post', {});
  assert.deepEqual(result.oss, [THUMB], 'only the object nobody else references may be deleted');
}));

test('H1 引用检查失败时元数据里的对象一个都不删（宁可留孤儿，也不冒险误删），帖子自己的媒体照旧', async () => withOssEnv(async () => {
  const { readPostCleanupPaths } = require('../render-api/oss-cleanup');
  const own = { user_name: 'alice', media_url: oss('posts/alice_1_a.jpg'), content: JSON.stringify({ __type: '__xtj_post_v2__', meta: { thumbs: [oss(THUMB)] } }) };
  const result = await readPostCleanupPaths(contentDb([], true), own, 'post-1', {});
  assert.deepEqual(result.oss, ['posts/alice_1_a.jpg']);
}));

test('H1 自己的原图、缩略图、封面在没人引用时仍会被清理', async () => withOssEnv(async () => {
  const { readPostCleanupPaths } = require('../render-api/oss-cleanup');
  const own = { user_name: '小明 alice', media_url: oss('posts/x_1_v.mp4'), content: JSON.stringify({ __type: '__xtj_post_v2__', meta: {
    thumbs: [oss(THUMB)], poster_url: oss('posters/' + encodeURIComponent('小明_alice') + '_1_a_poster-1.jpg') } }) };
  const result = await readPostCleanupPaths(contentDb([]), own, 'post-1', {});
  assert.equal(result.oss.length, 3, JSON.stringify(result.oss));
  assert.ok(result.oss.includes(THUMB) && result.oss.includes('posts/x_1_v.mp4'));
}));

test('H1 管理员按举报删帖时同样带着作者名，封面归属才能核对', () => {
  assert.match(SERVER_SOURCE, /\.select\('id, user_name, actor_key, media_type, media_url, content'\)\.eq\('id', normalizedTargetId\)/);
});

// ───────── 2. 帖子元数据清洗 ─────────

test('帖子元数据里只保留本站自己的缩略图/封面地址，外链被清掉，没问题时内容原样不动', () => withOssEnv(() => {
  const { sanitizePostContent } = require('../render-api/post-meta');
  const ctx = { supabaseUrl: 'https://project.supabase.co', hosts: ['xtj.onrender.com'] };
  const good = JSON.stringify({ __type: '__xtj_post_v2__', text: 'hi', meta: { thumbs: [oss(THUMB), null, '/api/uploads/media?path=posts%2Fthumb_a.jpg',
    'https://xtj.onrender.com/api/uploads/media?path=posts%2Fthumb_b.jpg'], poster_url: 'https://project.supabase.co/storage/v1/object/public/uploads/posters/a_poster.jpg' } });
  const unchanged = sanitizePostContent(good, ctx);
  assert.equal(unchanged.changed, false); assert.equal(unchanged.content, good);
  const bad = JSON.stringify({ __type: '__xtj_post_v2__', text: 'hi', meta: { thumbs: [oss(THUMB), 'https://tracker.example/pixel.gif', 'https://evil.example/api/uploads/media?path=posts%2Fx.jpg', '//evil.example/x.jpg'],
    poster_url: 'https://tracker.example/p.jpg', w: 10 } });
  const cleaned = JSON.parse(sanitizePostContent(bad, ctx).content);
  assert.deepEqual(cleaned.meta.thumbs, [oss(THUMB), null, null, null]);
  assert.equal('poster_url' in cleaned.meta, false);
  assert.equal(cleaned.meta.w, 10, 'unrelated metadata survives');
  assert.equal(cleaned.text, 'hi');
  // 普通文本、别的 JSON 都不碰
  for (const plain of ['hello', '{"a":1}', '', '{not json']) assert.deepEqual(sanitizePostContent(plain, ctx), { content: plain, changed: false });
  // 超过 9 张的缩略图数组被截断
  const many = JSON.stringify({ __type: '__xtj_post_v2__', meta: { thumbs: Array.from({ length: 20 }, () => oss(THUMB)) } });
  assert.equal(JSON.parse(sanitizePostContent(many, ctx).content).meta.thumbs.length, 9);
}));

test('发帖和改帖都经过元数据清洗', () => {
  assert.match(SERVER_SOURCE, /content = sanitizePostContent\(content, \{ supabaseUrl: SUPABASE_URL, hosts: \[SERVER_HOSTNAME, req\.headers\.host\] \}\)\.content/);
  assert.match(SERVER_SOURCE, /updates\.content = sanitizePostContent\(contentStr,/);
});

// ───────── 3. OSS 对象核对与签名配额（审计 M1）─────────

test('M1 发帖前核对 OSS 对象：不存在、大小不符、超 50MB、类型不对都拒绝，校验服务异常返回可重试 503', async () => {
  const { verifyPostOssMedia, MAX_MEDIA_BYTES } = require('../render-api/oss-sign');
  const run = (meta, item) => verifyPostOssMedia([item], { headObject: async () => meta });
  const ok = await run({ exists: true, size: 1000, contentType: 'image/jpeg' }, { path: 'posts/a.jpg', size: 1000, kind: 'image' });
  assert.deepEqual(ok, { ok: true });
  assert.equal((await run({ exists: false, size: 0, contentType: '' }, { path: 'posts/a.jpg', size: 1, kind: 'image' })).code, 'media_not_uploaded');
  assert.equal((await run({ exists: true, size: 2000, contentType: 'image/jpeg' }, { path: 'posts/a.jpg', size: 1000, kind: 'image' })).code, 'invalid_attachment_size');
  assert.equal((await run({ exists: true, size: MAX_MEDIA_BYTES + 1, contentType: 'video/mp4' }, { path: 'posts/a.mp4', kind: 'video' })).code, 'invalid_attachment_size');
  assert.equal((await run({ exists: true, size: 10, contentType: 'image/svg+xml' }, { path: 'posts/a.svg', size: 10, kind: 'image' })).code, 'invalid_media_type');
  assert.equal((await run({ exists: true, size: 10, contentType: 'text/html' }, { path: 'posts/a.jpg', size: 10, kind: 'image' })).code, 'invalid_media_type');
  assert.equal((await run({ exists: true, size: 10, contentType: 'audio/webm' }, { path: 'posts/a.webm', kind: 'video' })).code, 'invalid_media_type');
  const down = await verifyPostOssMedia([{ path: 'posts/a.jpg', size: 1, kind: 'image' }], { headObject: async () => { throw new Error('oss_head_failed 503'); } });
  assert.equal(down.status, 503); assert.equal(down.retryable, true);
});

test('M1 headObject 用 HEAD 读公共读桶，404 表示不存在，其余非 2xx 抛错', async () => withOssEnv(async () => {
  const oss_ = require('../render-api/oss-media');
  const seen = [];
  const make = status => async (url, init) => { seen.push([url, init.method]); return { status, ok: status >= 200 && status < 300, headers: { get: name => ({ 'content-length': '123', 'content-type': 'Image/JPEG' }[name]) } }; };
  assert.deepEqual(await oss_.headObject('posts/a.jpg', { fetchImpl: make(200) }), { exists: true, size: 123, contentType: 'image/jpeg' });
  assert.equal((await oss_.headObject('posts/a.jpg', { fetchImpl: make(404) })).exists, false);
  await assert.rejects(oss_.headObject('posts/a.jpg', { fetchImpl: make(503) }), /oss_head_failed 503/);
  assert.deepEqual(seen[0], ['https://test-bucket.oss-cn-hangzhou.aliyuncs.com/posts/a.jpg', 'HEAD']);
}));

test('M1 发帖路由对 OSS 附件和单个媒体都先核对对象', () => {
  const create = SERVER_SOURCE.slice(SERVER_SOURCE.indexOf("app.post('/api/post/create'"), SERVER_SOURCE.indexOf("app.post('/api/post/update'"));
  assert.match(create, /isOssMediaUrl\(item\.media_url\)/);
  assert.match(create, /isOssMediaUrl\(mediaUrl\)/);
  assert.match(create, /await verifyPostOssMedia\(ossToVerify\)/);
  assert.ok(create.indexOf('verifyPostOssMedia(ossToVerify)') < create.indexOf("createPostWithAttachments(supabase"), 'verification precedes the insert');
});

test('M1 每个账号每小时的签名总量有上限，超出返回 429，换个人不受影响，窗口过后恢复', async () => withOssEnv(async () => {
  const { installOssSign, createSignQuota } = require('../render-api/oss-sign');
  let clock = 1000;
  const quota = createSignQuota({ now: () => clock, limit: () => 100 * 1024 * 1024 });
  assert.equal(quota.take('alice', 60 * 1024 * 1024), true);
  assert.equal(quota.take('alice', 60 * 1024 * 1024), false);
  assert.equal(quota.take('bob', 60 * 1024 * 1024), true);
  clock += 60 * 60 * 1000 + 1;
  assert.equal(quota.take('alice', 60 * 1024 * 1024), true);
  assert.equal(createSignQuota({ limit: () => 0 }).take('x', 1e12), true, '0 means unlimited');

  let handler;
  const app = { post(route, ...stack) { if (route === '/api/oss/sign') handler = stack[stack.length - 1]; } };
  const pass = (req, res, next) => next();
  installOssSign(app, { authenticateUser: pass, rateLimit: () => pass, signQuota: createSignQuota({ limit: () => 5 * 1024 * 1024 }) });
  const call = async size => {
    let status = 200, payload; const headers = {};
    const res = { set(k, v) { headers[k] = v; return this; }, status(n) { status = n; return this; }, json(body) { payload = body; return this; } };
    await handler({ userName: 'alice', body: { path: 'posts/alice_1_abc_photo.jpg', content_type: 'image/jpeg', size } }, res);
    return { status, payload, headers };
  };
  assert.equal((await call(3 * 1024 * 1024)).payload.ok, true);
  const limited = await call(3 * 1024 * 1024);
  assert.equal(limited.status, 429); assert.equal(limited.payload.code, 'oss_quota_exceeded'); assert.ok(limited.headers['Retry-After']);
}));

test('M1 放弃的登记上传：清理时同步回收 OSS 对象，404 算已删除，其他失败保留墓碑等待重试', async () => withOssEnv(async () => {
  const { removeOssUpload, sweepPostMediaUploads } = require('../render-api/post-media');
  const requests = [];
  const originalFetch = global.fetch;
  let status = 204;
  global.fetch = async (url, init) => { requests.push([init.method, String(url)]); return { ok: status < 400, status, text: async () => '' }; };
  try {
    assert.equal(await removeOssUpload('posts/a.jpg'), true);
    assert.deepEqual(requests.at(-1), ['DELETE', 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/posts/a.jpg']);
    status = 404; assert.equal(await removeOssUpload('posts/a.jpg'), true);
    status = 403; await assert.rejects(removeOssUpload('posts/a.jpg'), /oss_delete_failed 403/);
    assert.equal(await removeOssUpload('photos/not-a-post-path.jpg'), false, 'only post media paths');
    assert.equal(await removeOssUpload('posts/a.jpg', { enabled: () => false }), false);

    // 清理流程：claim 成功且未被引用 → 先排队 Supabase 删除，再删 OSS，最后才标记 cleaned_at。
    const row = { storage_path: 'posts/00000.jpg', user_name: 'A', upload_id: 'upload-0000', status: 'pending', created_at: '2020-01-01', cleaned_at: null };
    const marks = [];
    const db = { from(name) { let filters = [], patch = null, removing = false;
      const q = { select() { return q; }, in() { return q; }, lt() { return q; }, gt() { return q; }, order() { return q; }, limit() { return q; }, eq(k, v) { filters.push([k, v]); return q; },
        update(value) { patch = value; return q; }, delete() { removing = true; return q; }, maybeSingle: async () => ({ data: name === 'posts' ? { id: 'auth' } : null }),
        then(resolve, reject) { if (patch) marks.push(patch); const data = patch || removing ? null : (name === 'post_media_uploads' ? [row] : []); return Promise.resolve({ data, error: null }).then(resolve, reject); } };
      return q; },
      storage: { from() { return { remove: async paths => ({ data: paths.map(n => ({ name: n })) }) }; } },
      async rpc(fn, args) { if (fn === 'enqueue_storage_cleanup') return { data: { ok: true, queued: true, paths: args.p_paths } }; return { data: { ok: true, referenced: false } }; } };
    requests.length = 0; status = 403;
    await sweepPostMediaUploads(db);
    assert.ok(requests.some(r => r[0] === 'DELETE'), 'sweep deletes the OSS object');
    assert.equal(marks.some(p => p.cleaned_at), false, 'a failed OSS delete must not mark the registry row cleaned');
    requests.length = 0; marks.length = 0; status = 204;
    await sweepPostMediaUploads(db);
    assert.equal(marks.some(p => p.cleaned_at), true, 'after OSS confirms, the row is marked cleaned');
  } finally { global.fetch = originalFetch; }
}));

// ───────── 4. AI 大请求体的全局内存预算（审计 M4）─────────

test('M4 大请求体按声明长度占用全局预算，超出返回可重试 429，结束后归还，小请求不受影响', () => {
  const { createBodyBudget, withBodyBudget } = require('../render-api/body-budget');
  const budget = createBodyBudget({ maxBytes: 100 * 1024 * 1024, parserLimit: 80 * 1024 * 1024 });
  const mk = length => {
    const handlers = {}; let statusCode = 200, body, nextCalled = false;
    const res = { set() { return this; }, status(n) { statusCode = n; return this; }, json(b) { body = b; return this; }, once(event, fn) { handlers[event] = fn; return this; } };
    const req = { headers: length === undefined ? {} : { 'content-length': String(length) } };
    budget(req, res, () => { nextCalled = true; });
    return { get status() { return statusCode; }, get body() { return body; }, get next() { return nextCalled; }, finish: () => handlers.finish && handlers.finish(), close: () => handlers.close && handlers.close() };
  };
  const a = mk(60 * 1024 * 1024);
  assert.equal(a.next, true); assert.equal(budget.reserved(), 60 * 1024 * 1024);
  const b = mk(60 * 1024 * 1024);
  assert.equal(b.next, false); assert.equal(b.status, 429); assert.equal(b.body.code, 'ai_body_busy'); assert.equal(b.body.retryable, true);
  assert.equal(mk(4096).next, true, 'small chat requests are never blocked');
  assert.equal(budget.reserved(), 60 * 1024 * 1024, 'small requests reserve nothing');
  const chunked = mk(undefined);
  assert.equal(chunked.next, false, 'a body without Content-Length reserves the full parser limit');
  a.finish(); a.close();
  assert.equal(budget.reserved(), 0, 'released exactly once on finish and close');
  const c = mk(60 * 1024 * 1024); assert.equal(c.next, true); c.close(); assert.equal(budget.reserved(), 0);

  let parsed = 0;
  const chain = withBodyBudget((req, res, next) => { parsed++; next(); }, { maxBytes: 10 * 1024 * 1024, parserLimit: 8 * 1024 * 1024 });
  let ran = false;
  chain({ headers: { 'content-length': '2000000' } }, { once() { return this; } }, () => { ran = true; });
  assert.equal(parsed, 1); assert.equal(ran, true);
});

test('M4 所有 AI 大请求体路由都先过预算，不再各自直接挂 80MB 解析器', () => {
  assert.equal((SERVER_SOURCE.match(/express\.json\(\s*\{\s*limit:\s*'80mb'\s*\}\s*\)/g) || []).length, 1, 'only the budgeted wrapper constructs the 80mb parser');
  assert.match(SERVER_SOURCE, /const aiLargeJson = require\('\.\/body-budget'\)\.withBodyBudget\(express\.json\(\{ limit: '80mb' \}\)\)/);
  for (const route of ['/api/agent/chat', '/api/agent/custom-chat/stream', '/api/agent/custom-chat/deep-stream', '/api/agent/chat/stream', '/api/agent/research/stream']) {
    const line = SERVER_SOURCE.split('\n').find(row => row.startsWith("app.post('" + route + "'"));
    assert.ok(line && line.includes('aiLargeJson'), route + ' parses its body through the budget');
  }
  assert.match(SERVER_SOURCE, /jsonMiddleware:aiLargeJson/, 'attachment uploads share the same budget');
});

// ───────── 5. 日志清理（审计 M5）─────────

function extractFunction(name, nextMarker) {
  const start = SERVER_SOURCE.indexOf(name);
  assert.ok(start >= 0, name + ' exists');
  return SERVER_SOURCE.slice(start, SERVER_SOURCE.indexOf(nextMarker, start));
}

test('M5 旧日志清理按页循环：积压超过 1000 行也能清完，一页删除失败就停', async () => {
  const code = extractFunction('async function cleanupOldLogs(type)', '// 检查同 IP 24h 内多账号登录');
  const rows = Array.from({ length: 1234 }, (_, i) => ({ id: 'row-' + i }));
  let selects = 0, failDelete = false;
  const db = { from() { let ids = null, removing = false, limit = Infinity;
    const q = { select() { return q; }, eq() { return q; }, lt() { return q; }, order() { return q; }, limit(n) { limit = n; return q; },
      delete() { removing = true; return q; }, in(_k, values) { ids = values; return q; },
      then(resolve, reject) {
        if (removing) {
          if (failDelete) return Promise.resolve({ data: null, error: { message: 'delete failed', code: '57014' } }).then(resolve, reject);
          const gone = rows.filter(r => ids.includes(r.id)); gone.forEach(r => rows.splice(rows.indexOf(r), 1));
          return Promise.resolve({ data: gone, error: null }).then(resolve, reject);
        }
        selects++;
        return Promise.resolve({ data: rows.slice(0, Math.min(limit, 1000)).map(r => ({ id: r.id })), error: null }).then(resolve, reject);
      } };
    return q; } };
  const context = vm.createContext({ supabase: db, console: { warn() {}, error() {}, log() {} },
    ERROR_LOG_RETENTION_DAYS: 30, LOGIN_LOG_RETENTION_DAYS: 90, LOGIN_EVENT_MARKER: 'l', SECURITY_ALERT_MARKER: 's', CLIENT_ERROR_MARKER: 'e', USER_BEHAVIOR_MARKER: 'b', VISIT_MARKER: 'v', ATTACK_MARKER: 'a',
    _dbResult: (operation, attempted, succeeded, failed, extra) => Object.assign({ operation, attempted, succeeded, failed }, extra),
    _classifySupabaseError: error => ({ retryable: true, error: { code: error.code, message: error.message } }) });
  vm.runInContext(code, context);
  const result = await context.cleanupOldLogs('login');
  assert.equal(result.succeeded, 1234, JSON.stringify(result)); assert.equal(rows.length, 0); assert.ok(selects >= 3);
  rows.push(...Array.from({ length: 700 }, (_, i) => ({ id: 'again-' + i })));
  failDelete = true; selects = 0;
  const failed = await context.cleanupOldLogs('login');
  assert.equal(failed.succeeded, 0); assert.ok(failed.failed > 0); assert.equal(selects, 1, 'does not spin on rows it cannot delete');
});

test('M5 清理任务在启动后先跑一次，之后每 24 小时一次（不再只靠 24 小时定时器）', () => {
  assert.match(SERVER_SOURCE, /async function runScheduledLogCleanup\(\)/);
  assert.match(SERVER_SOURCE, /setTimeout\(function\(\) \{ runScheduledLogCleanup\(\)\.catch\(function\(\) \{\}\); \}, 2 \* 60 \* 1000\)\.unref\(\)/);
  assert.match(SERVER_SOURCE, /setInterval\(function\(\) \{ runScheduledLogCleanup\(\)\.catch\(function\(\) \{\}\); \}, 24 \* 60 \* 60 \* 1000\)\.unref\(\)/);
  const body = extractFunction('async function runScheduledLogCleanup()', 'setInterval(function() { runScheduledLogCleanup');
  for (const type of ['login', 'security', 'error', 'behavior', 'visit', 'attack']) assert.ok(body.includes("'" + type + "'"), type);
  assert.match(body, /cleanupExpiredRateLimitRows\(\)/);
});

// ───────── 6. 限流存储不可用时返回 503 而不是 429（审计 M2）─────────

test('M2 持久限流读写失败是「服务不可用」，必须带 unavailable 标记（调用方据此回 503）', async () => {
  const code = extractFunction('async function checkPersistentRateLimit(key, windowMs, maxRequests)', '// 组合限流：第一层本地');
  const build = behavior => {
    const db = { from() { const q = { select() { return q; }, eq() { return q; }, maybeSingle() { return q; }, insert() { return q; }, update() { return q; }, neq() { return q; },
      then(resolve, reject) { return Promise.resolve(behavior(q)).then(resolve, reject); } }; return q; },
      async rpc() { return behavior.rpc ? behavior.rpc() : { data: null, error: { message: 'offline' } }; } };
    return vm.createContext({ supabase: db, crypto: require('node:crypto'), persistenceRateLimitCache: new Map(), DB_RATE_LIMIT_MARKER: '__rate_limit__', isDuplicateKeyError: e => e && e.code === '23505', Date, Math, JSON });
  };
  const offline = { data: null, error: { message: 'exceed_egress_quota', code: '' } };
  for (const behavior of [() => offline]) {
    const context = build(behavior); vm.runInContext(code, context);
    const result = await context.checkPersistentRateLimit('1.2.3.4:/admin/login', 60000, 10);
    assert.equal(result.limited, true); assert.equal(result.unavailable, true, 'outage must not look like throttling: ' + JSON.stringify(result));
  }
  // 读成功、写失败（非重复键）同样是不可用
  let calls = 0;
  const writeFails = build(() => { calls++; return calls === 1 ? { data: null, error: null } : { data: null, error: { message: 'boom', code: '08006' } }; });
  vm.runInContext(code, writeFails);
  assert.equal((await writeFails.checkPersistentRateLimit('k', 60000, 10)).unavailable, true);
  // 真正超限仍然是 429 语义（不带 unavailable）
  const full = build(() => ({ data: { id: 1, content: JSON.stringify({ count: 10, resetAt: Date.now() + 60000 }) }, error: null }));
  vm.runInContext(code, full);
  const limited = await full.checkPersistentRateLimit('k2', 60000, 10);
  assert.equal(limited.limited, true); assert.equal(limited.unavailable, undefined);
});

// ───────── 7. 额度受限提示覆盖更多接口（审计 L2）─────────

test('L2 额度受限时聊天、私信、举报、评论、点赞、统计等接口也转成明确的 402 提示；AI 接口不被误标', async () => {
  const express = require('express'); const request = require('supertest');
  const { createSupabaseAvailability } = require('../render-api/supabase-availability');
  const availability = createSupabaseAvailability({ fetchImpl: async () => new Response('{"message":"exceed_egress_quota"}', { status: 402 }), now: () => 1000 });
  const app = express(); app.use(availability.middleware);
  const paths = ['/api/dm/list', '/api/chat/conversations', '/api/report', '/api/my-reports', '/api/comments/user/a', '/api/likes/user/a', '/api/stats/snapshot', '/api/avatar/batch', '/api/oss/sign', '/api/announcements/read', '/api/location/reverse', '/api/agent/chat'];
  for (const p of paths) app.all(p, async (req, res) => { await availability.transport('https://supabase.test/rest/v1/posts'); res.status(503).json({ ok: false, error: 'generic failure' }); });
  for (const p of paths.filter(p => !p.startsWith('/api/agent'))) assert.equal((await request(app).get(p).expect(402)).body.code, 'egress_quota_exceeded', p);
  assert.equal((await request(app).get('/api/agent/chat').expect(503)).body.error, 'generic failure');
});

// ───────── 8. HTTP 层：畸形请求、静态文件、限流存储故障（审计 L1 / M6 / M2）─────────

function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('真实服务：畸形登录请求回 400、仓库内部文件不对外、数据库故障时登录回 503 而不是 429', { timeout: 90000 }, async () => {
  let outage = false;
  const stub = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      if (outage) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"message":"down"}'); }
      const accept = String(req.headers.accept || '');
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (accept.includes('pgrst.object')) { res.writeHead(406, { 'content-type': 'application/json' }); return res.end('{"code":"PGRST116","details":"0 rows","hint":null,"message":"none"}'); }
        res.writeHead(200, { 'content-type': 'application/json', 'content-range': '0-0/0' }); return res.end('[]');
      }
      if (req.method === 'POST') { res.writeHead(201, { 'content-type': 'application/json' }); return res.end('[{"content":"{}","id":"00000000-0000-4000-8000-000000000000"}]'); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]');
    });
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), API_SECRET: 'audit-secret-0123456789abcdef0123456789', ADMIN_PASSWORD: 'audit-admin-password',
    SUPABASE_URL: 'http://127.0.0.1:' + stub.address().port, SUPABASE_SERVICE_KEY: 'not-real-service-key', SUPABASE_ANON_KEY: 'not-real-anon-key', DEEPSEEK_API_KEY: '', OPENROUTER_API_KEY: '' };
  const child = spawn(process.execPath, [path.join(ROOT, 'render-api', 'server.js')], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = false; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; }); child.on('exit', () => { exited = true; });
  const base = 'http://127.0.0.1:' + port;
  const post = (route, init) => fetch(base + route, { method: 'POST', ...init });
  const json = { headers: { 'content-type': 'application/json' } };
  try {
    let up = false;
    for (let i = 0; i < 100 && !exited; i++) { try { await fetch(base + '/health'); up = true; break; } catch (_) { await sleep(200); } }
    assert.ok(up, 'server must start: ' + log.slice(-400));
    // L1：没有请求体 / 不是 JSON → 400，而不是解构 undefined 变 500
    assert.equal((await post('/api/user/login')).status, 400);
    assert.equal((await post('/api/user/login', { headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 400);
    assert.equal((await post('/api/user/login', { ...json, body: '{}' })).status, 400);
    // 管理员登录：账号/密码必须是字符串
    for (const body of ['{"username":"xxz","password":123456}', '{"username":"xxz","password":{"length":3}}', '{"username":["xxz"],"password":"x"}']) {
      assert.equal((await post('/admin/login', { ...json, body })).status, 400, body);
    }
    assert.equal((await post('/admin/login', { ...json, body: '{"username":"xxz","password":"wrong"}' })).status, 401);
    // M6：仓库里的内部文件不能被当作静态资源托管
    for (const file of ['/cloudflare/login-backend.js', '/cloudflare/pages-worker.js', '/wrangler.jsonc', '/project.config.json', '/package.json', '/render-api/server.js']) {
      assert.equal((await fetch(base + file)).status, 404, file);
    }
    assert.equal((await fetch(base + '/index.html')).status, 200, 'the site itself is still served');
    assert.equal((await fetch(base + '/js/config.js')).status, 200);
    // M2：数据库故障时，口令类接口回 503（服务不可用），不能回 429「请求过于频繁」
    outage = true;
    const down = await post('/api/user/login', { ...json, body: '{"user_name":"alice","password":"secret1"}' });
    assert.equal(down.status, 503, await down.clone().text());
    assert.equal((await down.json()).code, 'RATE_LIMIT_UNAVAILABLE');
    const adminDown = await post('/admin/login', { ...json, body: '{"username":"xxz","password":"audit-admin-password"}' });
    assert.equal(adminDown.status, 503);
  } finally {
    child.kill('SIGKILL'); stub.close();
  }
});
