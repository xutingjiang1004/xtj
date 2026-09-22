const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
// 2026-09-22：Vercel 已弃用（生产只用 Render + Supabase），原先对 vercel.json 的断言随之移除。
const source = fs.readFileSync(path.join(ROOT, 'render-api/server.js'), 'utf8');
const authMigration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/011_auth_record_uniqueness.sql'), 'utf8');
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

test('CSP script-src allows self, unsafe-inline, jsDelivr, and excludes user-writable Supabase origin', () => {
  const scriptSrc = csp.split(';').find(function(d) { return d.trim().startsWith('script-src'); });
  assert.ok(scriptSrc, 'script-src directive must exist');
  assert.match(scriptSrc, /'self'/);
  assert.match(scriptSrc, /'unsafe-inline'/);
  // H-16: 'unsafe-eval' 已移除（WebLLM 的 WASM 编译由 'wasm-unsafe-eval' 覆盖），
  // 前端 js/ 与 index.html/admin.html 无 eval()/new Function 使用
  assert.match(scriptSrc, /'wasm-unsafe-eval'/, 'WebLLM requires WebAssembly compilation');
  assert.match(scriptSrc, /https:\/\/cdn\.jsdelivr\.net/);
  // H-9: script-src 不得放行 supabase.co——public 桶是用户可写源，可上传 JS 当
  // "白名单源"加载；supabase 仅 API 调用，由 connect-src 放行
  assert.doesNotMatch(scriptSrc, /supabase\.co/, 'script-src must not allow the user-writable Supabase origin');
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
  assert.match(styleSrc, /https:\/\/cdn\.jsdelivr\.net/);
  // ★ 2026-09-13（M-2）：'unsafe-inline' 是已知的待收敛项，而非期望的长期状态。
  // 前端 index.html/admin.html 与 13 个 JS 模块共约 230 处动态 on* 属性 + 内联脚本，
  // 移除需先把它们全部改为事件委托/外置文件。此处仍断言其存在，是为了让"被移除"
  // 这件事必须显式改测试（即显式决策），而不是悄悄生效；一旦完成收敛，
  // 应把本条改为 doesNotMatch 并把下方 TODO 一并删除。
  // TODO(M-2): 完成内联脚本外置 + on* 属性事件委托改造后，收紧此处断言。
  assert.match(styleSrc, /'unsafe-inline'/);
});

test('CSP font-src permits the exact font origins', () => {
  const fontSrc = csp.split(';').find(function(d) { return d.trim().startsWith('font-src'); });
  assert.ok(fontSrc, 'font-src directive must exist');
  assert.match(fontSrc, /'self'/);
  assert.match(fontSrc, /https:\/\/cdn\.jsdelivr\.net/);
  // ★ 2026-09-23 收敛：registry.npmmirror.com 已从 font-src（及 script-src/style-src）移除。
  //   原注释理由「Monaco loads its codicon font」不成立 —— monaco 全仓 0 命中，
  //   该域名只剩 mcp-servers/xtj-admin/package-lock.json（构建期产物，与 CSP 无关）。
  //   冗余放行即攻击面：任何来源只要出现在 CSP 白名单里，就多一条被利用的路径。
  assert.doesNotMatch(fontSrc, /npmmirror/, 'npmmirror 属已清理的冗余放行，不得回归');
  assert.doesNotMatch(fontSrc, /\bhttps:\s*(?:;|$)/, 'font-src must not be widened to every HTTPS origin');
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
  assert.match(cleanup, /\^photos\\\/\[a-z0-9_-\]\{6,128\}_/);
  assert.match(cleanup, /\.ilike\('content'/);
  assert.match(cleanup, /\.ilike\('media_url'/);
  assert.match(cleanup, /refChecks\.some\(function\(result\) \{ return !result \|\| result\.error; \}\)/);
  assert.match(cleanup, /status\(503\)/);
  assert.doesNotMatch(cleanup, /var refCheck = null/);
});
