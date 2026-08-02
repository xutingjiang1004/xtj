const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

const source = fs.readFileSync('render-api/server.js', 'utf8');
const authMigration = fs.readFileSync('supabase/migrations/011_auth_record_uniqueness.sql', 'utf8');
// CSP 已统一收敛到共享模块 security-headers.js（server.js 与 serve-static.js 共用一份）
const sharedSecurityHeaders = require('../render-api/security-headers.js');
const csp = sharedSecurityHeaders.CSP;

function routeBlock(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('protected user middleware accepts tokens only and rejects body credential fallback', () => {
  const block = routeBlock('async function authenticateUser', '// 用户登录/获取 token');
  assert.doesNotMatch(block, /body\.password_hash|body\.reporter_name|eq\('media_url'/);
  assert.match(block, /verifyUserAccessToken/);
  assert.match(block, /isTokenRevoked\(token\)/);
  assert.match(block, /code: 'auth_expired'/);
});

test('stored auth credentials use scrypt and legacy records upgrade atomically', () => {
  assert.match(source, /AUTH_VERIFIER_PREFIX = 'scrypt:v1:'/);
  assert.match(source, /crypto\.scrypt/);
  const login = routeBlock("app.post('/api/user/login'", '// 刷新用户 access token');
  assert.match(login, /verifyAuthPassword/);
  assert.match(login, /var \{ user_name, password \} = req\.body/);
  assert.doesNotMatch(login, /password_hash/);
  assert.match(login, /update\(\{ media_url: verifier \}\)/);
  assert.match(login, /eq\('media_url', authRec\.media_url\)/);
});

test('registration stores only a server-derived scrypt verifier', () => {
  const register = routeBlock("app.post('/api/user/register'", '// 刷新用户 access token');
  assert.match(register, /deriveAuthVerifier\(password\)/);
  assert.match(register, /media_url: verifier/);
  assert.doesNotMatch(register, /password_hash/);
});

test('authentication migration deduplicates before enforcing one record per user', () => {
  assert.match(authMigration, /DELETE FROM public\.posts AS older[\s\S]*older\.media_type = '__auth__'/);
  assert.match(authMigration, /CREATE UNIQUE INDEX IF NOT EXISTS posts_one_auth_record_per_user/);
  assert.match(authMigration, /ON public\.posts \(user_name\)[\s\S]*WHERE media_type = '__auth__'/);
});

test('access tokens have jti and logout persistently revokes the presented token', () => {
  assert.match(source, /type: 'user_access', jti: crypto\.randomUUID\(\)/);
  const logout = routeBlock("app.post('/api/user/logout'", '// 验证 token 是否有效');
  assert.match(logout, /_getTokenFromRequest\(req\)/);
  assert.match(logout, /persistRevokedToken\(accessToken, accessPayload\.exp\)/);
  assert.match(logout, /status\(503\)/);
});

test('admin and user auth wait for persistent revocation state before accepting requests', () => {
  assert.match(source, /revokedTokenHashesReadyPromise/);
  assert.match(source, /async function loadRevokedTokenHashesWithRetry\(\)/);
  assert.match(source, /token state retry/);
  assert.match(source, /async function waitForRevocationState/);
  assert.match(source, /async function verifyToken[\s\S]*?await waitForRevocationState/);
  assert.match(source, /async function authenticateUser[\s\S]*?await waitForRevocationState/);
});

test('admin conversation rejects LIKE wildcard identifiers before query construction', () => {
  const block = routeBlock("app.get('/admin/ai-agent/conversation'", "console.log(`[xtj-admin-api]");
  assert.match(block, /convId !== 'legacy' && !\/\^\[A-Z0-9\\-\]\{6,\}\$\/i\.test\(convId\)/);
  assert.match(block, /filter\('actor_key', 'like', 'ai_msg_conv_' \+ convId \+ '_%'\)/);
});

test('admin type filters are constrained before Supabase equality filters', () => {
  assert.match(source, /var alertType = validateString\(req\.query\.type, 50, '提醒类型'\)/);
  assert.match(source, /var logType = validateString\(req\.query\.type, 50, '日志类型'\)/);
  assert.match(source, /!\/\^\[a-z0-9_\\-\]\+\$\/i\.test\(alertType\)/);
  assert.match(source, /!\/\^\[a-z0-9_\\-\]\+\$\/i\.test\(logType\)/);
});

test('CSP must not contain strict-dynamic without nonce/hash coverage for all scripts', () => {
  assert.ok(csp && csp.length, 'Content-Security-Policy must be defined in security-headers.js');
  assert.doesNotMatch(csp, /'strict-dynamic'/, "CSP script-src MUST NOT contain 'strict-dynamic' without per-script nonces/hashes (PR #366 production outage)");
  // 服务端必须实际挂载共享安全头模块
  assert.match(source, /require\('\.\/security-headers'\)/);
  assert.match(source, /applySecurityHeaders/);
});

test('CSP script-src allows self, unsafe-inline, Supabase CDN, and jsDelivr', () => {
  const scriptSrc = csp.split(';').find(function(d) { return d.trim().startsWith('script-src'); });
  assert.ok(scriptSrc, 'script-src directive must exist');
  assert.match(scriptSrc, /'self'/);
  assert.match(scriptSrc, /'unsafe-inline'/);
  assert.match(scriptSrc, /'unsafe-eval'/, 'WebLLM requires eval in its worker runtime');
  assert.match(scriptSrc, /'wasm-unsafe-eval'/, 'WebLLM requires WebAssembly compilation');
  assert.match(scriptSrc, /https:\/\/ithowxqignlhkwaykglt\.supabase\.co/);
  assert.match(scriptSrc, /https:\/\/cdn\.jsdelivr\.net/);
});

test('CSP gives WebLLM workers an explicit same-origin/blob execution scope', () => {
  const workerSrc = csp.split(';').find(function(d) { return d.trim().startsWith('worker-src'); });
  assert.ok(workerSrc, 'worker-src directive must exist');
  assert.match(workerSrc, /'self'/);
  assert.match(workerSrc, /blob:/);
});

test('CSP style-src allows self, unsafe-inline, and jsDelivr', () => {
  const styleSrc = csp.split(';').find(function(d) { return d.trim().startsWith('style-src'); });
  assert.ok(styleSrc, 'style-src directive must exist');
  assert.match(styleSrc, /'self'/);
  assert.match(styleSrc, /'unsafe-inline'/);
  assert.match(styleSrc, /https:\/\/cdn\.jsdelivr\.net/);
});

test('CSP font-src allows self and jsDelivr', () => {
  const fontSrc = csp.split(';').find(function(d) { return d.trim().startsWith('font-src'); });
  assert.ok(fontSrc, 'font-src directive must exist');
  assert.match(fontSrc, /'self'/);
  assert.match(fontSrc, /https:\/\/cdn\.jsdelivr\.net/);
});

test('CSP includes security hardening directives', () => {
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /default-src 'self'/);
});

test('CSP permits only WebLLM Qwen download origins needed by the installed runtime', () => {
  const connectSrc = csp.split(';').find(function(d) { return d.trim().startsWith('connect-src'); });
  assert.ok(connectSrc, 'connect-src directive must exist');
  assert.match(connectSrc, /https:\/\/huggingface\.co/);
  assert.match(connectSrc, /https:\/\/\*\.hf\.co/);
  assert.match(connectSrc, /https:\/\/raw\.githubusercontent\.com/);
  assert.doesNotMatch(connectSrc, /\bhttps:\s*(?:;|$)/, 'connect-src must not be widened to every HTTPS origin');
});

test('photo cleanup validates generated paths and fails closed on reference lookup errors', () => {
  const cleanup = routeBlock("app.post('/api/photo/cleanup'", 'function collectPhotoStoragePaths');
  assert.match(cleanup, /typeof path !== 'string'/);
  assert.match(cleanup, /typeof uploadId !== 'string'/);
  assert.match(cleanup, /path\.indexOf\('photos\/' \+ uploadId \+ '_'\) !== 0/);
  assert.match(cleanup, /\^photos\\\/\[a-z0-9_-\]\{8,64\}_/);
  assert.match(cleanup, /\.ilike\('content'/);
  assert.match(cleanup, /\.ilike\('media_url'/);
  assert.match(cleanup, /refChecks\.some\(function\(result\) \{ return !result \|\| result\.error; \}\)/);
  assert.match(cleanup, /status\(503\)/);
  assert.doesNotMatch(cleanup, /var refCheck = null/);
});

test('Vercel forwards frontend API and admin requests to the Render backend', () => {
  const rewrites = vercel.rewrites || [];
  for (const sourcePath of ['/api/(.*)', '/admin/(.*)']) {
    const rule = rewrites.find(item => item.source === sourcePath);
    assert.ok(rule, `missing rewrite for ${sourcePath}`);
    assert.match(rule.destination, /^https:\/\/xtj\.onrender\.com\/(api|admin)\//);
  }
});
