const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
// 2026-09-22：Vercel 已弃用（生产只用 Render + Supabase），原先对 vercel.json 的断言随之移除。
const source = fs.readFileSync(path.join(ROOT, 'render-api/server.js'), 'utf8');
const workbench = fs.readFileSync(path.join(ROOT, 'js/code-workbench.js'), 'utf8');
const webFetch = fs.readFileSync(path.join(ROOT, 'render-api/web-fetch.js'), 'utf8');
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

// ---------------------------------------------------------------------------
// P2-12 / P2-11 的执行式回归：把 server.js 里真实的顶层辅助函数**整段抽出来执行**
// （项目先例见 tests/read-zip-bomb-contract.test.js）。并发闸与串行锁的价值在于
// 「运行时行为」，只做源码正则断言无法证明名额一定会归还、任务一定不重叠。
// 注意：不能 require('render-api/server.js')（会真的起 HTTP 服务），只能读源码文本。
// ---------------------------------------------------------------------------

// 从 startMarker 起，截取到 endFuncName 这个函数体结束为止的完整分隔符区域
function extractRegion(startMarker, endFuncName) {
  const from = source.indexOf(startMarker);
  assert.notEqual(from, -1, `missing ${startMarker}`);
  const fnAt = source.indexOf('function ' + endFuncName, from);
  assert.notEqual(fnAt, -1, `missing function ${endFuncName}`);
  const open = source.indexOf('{', fnAt) + 1;
  let depth = 1;
  let i = open;
  while (depth > 0 && i < source.length) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces after ${endFuncName}`);
  return source.slice(from, i);
}

// P2-12：照片上传配额 + 并发解码闸（同一份进程内 Map，不另起一套）
// setInterval 需要注入桩：源码挂载了一个 5 分钟清理定时器，测试里不能真的留句柄。
function loadPhotoUploadGuards() {
  const region = extractRegion('const PHOTO_UPLOAD_QUOTA_BYTES', 'acquirePhotoDecodeSlot');
  /* eslint-disable no-new-func */
  const factory = new Function('setInterval', region + '\nreturn { tryConsumePhotoUploadQuota: tryConsumePhotoUploadQuota, refundPhotoUploadQuota: refundPhotoUploadQuota, photoUploadQuotaRemainingBytes: photoUploadQuotaRemainingBytes, acquirePhotoDecodeSlot: acquirePhotoDecodeSlot, photoDecodeInflight: photoDecodeInflight, photoUploadQuotaStore: photoUploadQuotaStore, PHOTO_UPLOAD_QUOTA_BYTES: PHOTO_UPLOAD_QUOTA_BYTES, PHOTO_UPLOAD_MAX_SINGLE_BYTES: PHOTO_UPLOAD_MAX_SINGLE_BYTES, PHOTO_DECODE_MAX_INFLIGHT_PER_USER: PHOTO_DECODE_MAX_INFLIGHT_PER_USER };');
  return factory(function fakeSetInterval() { return { unref: function unrefStub() {} }; });
  /* eslint-enable no-new-func */
}

// P2-11：per-user 头像更新串行锁。waitMs 可选，用于把等待上限调小做超时行为测试
// （生产值 8s，测试里不能真的睡 8 秒）。
function loadAvatarUpdateLock(waitMs) {
  let region = extractRegion('const AVATAR_UPDATE_LOCK_WAIT_MS', 'runAvatarUpdateSerialized');
  if (typeof waitMs === 'number') {
    region = region.replace(/const AVATAR_UPDATE_LOCK_WAIT_MS = \d+;/, 'const AVATAR_UPDATE_LOCK_WAIT_MS = ' + waitMs + ';');
  }
  /* eslint-disable no-new-func */
  const factory = new Function(region + '\nreturn { runAvatarUpdateSerialized: runAvatarUpdateSerialized, avatarUpdateLocks: avatarUpdateLocks, AVATAR_UPDATE_LOCK_WAIT_MS: AVATAR_UPDATE_LOCK_WAIT_MS };');
  return factory();
  /* eslint-enable no-new-func */
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

test('CSP font-src 只放行本站（站点无外链字体）', () => {
  const fontSrc = csp.split(';').find(function(d) { return d.trim().startsWith('font-src'); });
  assert.ok(fontSrc, 'font-src directive must exist');
  assert.match(fontSrc, /'self'/);
  // ★ 2026-09-23 收敛：font-src 收窄为仅 'self'。依据：
  //   ① css/ 下无任何 @font-face / @import；
  //   ② 全站 font-family 为系统字体栈（-apple-system / "PingFang SC" / sans-serif）；
  //   ③ 唯一提及 Google Fonts 的是 core-parts/06-chat-and-nav.js:3252 的一行更新日志
  //      文本，而 `Great Vibes` 字体引用与 `.idol-` 命名空间均已从代码库移除。
  //   冗余放行即攻击面：白名单里的来源被投毒时可直接加载样式/字体。
  assert.doesNotMatch(fontSrc, /npmmirror/, 'npmmirror 属已清理的冗余放行，不得回归');
  assert.doesNotMatch(fontSrc, /googleapis|gstatic/, 'Google Fonts 未被使用，不得回归');
  assert.doesNotMatch(fontSrc, /cdn\.jsdelivr\.net/, 'jsdelivr 仅承载 gsap 脚本，与字体无关');
  assert.doesNotMatch(fontSrc, /\bhttps:\s*(?:;|$)/, 'font-src must not be widened to every HTTPS origin');
  // 除 'self' 外不应有任何其他来源
  assert.doesNotMatch(fontSrc, /https?:\/\//, 'font-src 不应放行任何外部来源');
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

test('read_document 使用限大小、拒绝重定向的 DNS 固定下载器', () => {
  const block = routeBlock("case 'read_document':", "case 'make_file':");
  assert.match(block, /fetchSafeBuffer\(docUrl/);
  assert.match(block, /maxBytes: MAX_DOC_BYTES/);
  assert.match(block, /signal: \(context && context\.signal\)/);
  assert.doesNotMatch(block, /await fetch\(docUrl/);
  assert.match(webFetch, /async function fetchSafeBuffer/);
  assert.match(webFetch, /status >= 300 && status < 400/);
  assert.match(webFetch, /headers: \{[\s\S]*?get: function\(key\)/);
});

test('带会话 Cookie 且缺失来源证明时不得用 X-Requested-With 绕过 CSRF', () => {
  const from = source.indexOf('// 访问记录 + CSRF 防护');
  const to = source.indexOf('// 阻止敏感路径被静态文件服务泄露', from);
  assert.notEqual(from, -1);
  assert.notEqual(to, -1);
  const middleware = source.slice(from, to);
  assert.match(middleware, /if \(hasSessionCookie && !origin && !refererSameSite\)/);
  assert.doesNotMatch(middleware, /x-requested-with/i);
});

test('工作台 AI 输出路径校验并要求所有批量提交显式确认', () => {
  assert.match(workbench, /function isSafeAiTargetPath\(p\)/);
  assert.match(workbench, /part === '\.\.'/);
  assert.match(workbench, /part\.toLowerCase\(\) === '\.git' \|\| part\.toLowerCase\(\) === '\.github'/);
  assert.match(workbench, /if \(!isSafeAiTargetPath\(path\)\)/);
  const batch = workbench.slice(workbench.indexOf('async function commitAllGroups'), workbench.indexOf('// 从 AI 输出的代码块首行解析目标文件路径'));
  assert.match(batch, /groups\.some\(function \(g\) \{ return !isSafeAiTargetPath\(g\.path\); \}\)/);
  assert.match(batch, /window\.confirm\('即将一次性提交/);
  assert.doesNotMatch(batch, /if \(br === state\.repo\.default_branch\)/);
});

test('GitHub 代理按规范化路径鉴权：`..` 路径遍历不得绕过 DELETE/PATCH 最小授权', () => {
  // 回归背景（第三轮审计）：白名单此前比对 parsed.pathname（字面值），而实际请求
  // 拼接进 fetch('https://api.github.com' + upstreamPath) 时会被 URL 规范化。
  // 两者不一致 → `/repos/o/r/contents/../../git/refs/heads/main` 字面匹配
  // DELETE 白名单（以 contents/ 开头），实际却请求到 /repos/o/git/refs/heads/main，
  // 使"禁止删分支/标签/仓库"的约束失效。
  // normalizeGhPath 定义在 proxyGithubApi 之前，故断言范围从它开始
  const proxy = routeBlock('function normalizeGhPath', 'app.post(\'/api/code/gh-proxy\'');
  // 必须存在规范化步骤，且全部白名单校验都作用于规范化结果
  assert.match(proxy, /function normalizeGhPath/, '必须定义路径规范化函数');
  assert.match(proxy, /var safePath = normalizeGhPath\(parsed\.pathname\)/);
  assert.match(proxy, /CODE_GH_PATH_OK\.test\(safePath\)/);
  assert.match(proxy, /CODE_GH_DELETE_PATH_OK\.test\(safePath\)/);
  assert.match(proxy, /CODE_GH_PATCH_PATH_OK\.test\(safePath\)/);
  assert.match(source, /CODE_GH_PATCH_PATH_OK = .*heads/,'PATCH 仅允许更新分支 ref');
  assert.match(proxy, /ghBody\.force = false/, '服务端必须强制禁止 force push');
  assert.match(proxy, /isBlockedCodeWritePath\(safePath\)/, '禁止代理写入 Git 元数据或 GitHub 配置路径');
  assert.match(proxy, /ghBody\.tree\.some[\s\S]*isBlockedCodeWritePath\(item\.path\)/, '禁止 Git tree 写入敏感路径');
  // 不得再对未规范化的 parsed.pathname 做授权判断
  assert.doesNotMatch(proxy, /_PATH_OK\.test\(parsed\.pathname\)/);
  // 上游请求路径必须用 safePath，保证"校验的"与"请求的"一致
  assert.match(proxy, /var upstreamPath = safePath \+ parsed\.search/);
  assert.doesNotMatch(proxy, /var upstreamPath = parsed\.pathname/);
  // 拒绝 `.` / `..` 段与编码绕过
  assert.match(proxy, /segs\[i\] === '\.' \|\| segs\[i\] === '\.\.'/);
  assert.match(proxy, /%2e\|%2f\|%5c/i);
});

// ===================== P2-12：照片上传并发解码闸 + 配额预占 =====================
// 原实现的问题：express.raw 允许约 55MB body，500MB/小时的用户配额却是在 sharp
// **解码之后**才扣——多个并发大请求可以同时各自持有一份完整 body 缓冲（+ 解码缓冲），
// 进程内存峰值与「用户小时配额」完全无关，配额只是事后算账，起不到闸门作用。

test('P2-12: 同一用户在途解码数达到上限后，后续请求被立即拒绝而非排队', () => {
  const g = loadPhotoUploadGuards();
  const limit = g.PHOTO_DECODE_MAX_INFLIGHT_PER_USER;
  // 上限必须足以容纳前端批量上传的并发 worker（js/photo-wall/upload-ui.js CONCURRENCY = 3）
  assert.ok(limit >= 3, '并发上限不得低于前端批量上传并发数，否则会误伤普通上传: ' + limit);
  const held = [];
  for (let i = 0; i < limit; i++) {
    const release = g.acquirePhotoDecodeSlot('alice');
    assert.ok(typeof release === 'function', `第 ${i + 1} 个请求必须能拿到解码名额`);
    held.push(release);
  }
  assert.equal(g.acquirePhotoDecodeSlot('alice'), null, '第 limit+1 个请求必须立即返回 null（不排队、不挂起）');
  assert.equal(g.photoDecodeInflight.get('alice'), limit, '在途计数应与实际持有数一致');
  // 释放一个名额后应立刻可被新请求使用（证明闸门是"计数"而非"一次性熔断"）
  held[0]();
  assert.ok(g.acquirePhotoDecodeSlot('alice'), '释放后必须能重新拿到名额');
  assert.equal(g.photoDecodeInflight.get('alice'), limit);
});

test('P2-12: 并发请求同时进入解码的数量不超过上限，结束后名额全部归还', async () => {
  const g = loadPhotoUploadGuards();
  const limit = g.PHOTO_DECODE_MAX_INFLIGHT_PER_USER;
  let inFlight = 0;
  let peak = 0;
  let ok = 0;
  let busy = 0;
  async function simulateRequest() {
    const release = g.acquirePhotoDecodeSlot('bob');
    if (!release) { busy++; return; }
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise(function (r) { setTimeout(r, 5); }); // 模拟 sharp 解码耗时
      ok++;
    } finally {
      inFlight--;
      release(); // 与路由里的 try/finally 同结构：任何路径（含异常）都释放
    }
  }
  await Promise.all(Array.from({ length: 20 }, simulateRequest));
  assert.ok(peak > 1, '并发必须真的发生了（否则本用例没有证明力）');
  assert.ok(peak <= limit, `同时解码的数量不得超过上限 ${limit}，实际峰值 ${peak}`);
  assert.equal(ok + busy, 20, '每个请求必须有明确归宿（要么通过要么被拒），不能静默丢弃');
  assert.equal(g.photoDecodeInflight.get('bob'), undefined, '全部结束后 Map 中不得残留该用户的在途计数');
  assert.equal(g.photoDecodeInflight.size, 0, '名额泄漏会让该用户永久无法上传');
});

test('P2-12: release 是幂等的，重复释放不得把别人的名额减掉', () => {
  const g = loadPhotoUploadGuards();
  const first = g.acquirePhotoDecodeSlot('cindy');
  const second = g.acquirePhotoDecodeSlot('cindy');
  first();
  first(); // 重复释放（对应 try/finally 与其它路径同时触发的极端情况）
  assert.equal(g.photoDecodeInflight.get('cindy'), 1, '重复释放只应生效一次');
  second();
  assert.equal(g.photoDecodeInflight.get('cindy'), undefined);
  // 不同用户互不影响：同一 userName 才是闸门的 key
  assert.ok(g.acquirePhotoDecodeSlot('dave'), 'per-user 闸门不得影响其它用户');
});

test('P2-12: 配额预占后回滚必须完全归还，超限请求不得扣任何额度', () => {
  const g = loadPhotoUploadGuards();
  assert.equal(g.tryConsumePhotoUploadQuota('erin', 1024), true);
  assert.equal(g.photoUploadQuotaRemainingBytes('erin'), g.PHOTO_UPLOAD_QUOTA_BYTES - 1024);
  g.refundPhotoUploadQuota('erin', 1024); // 对应"解码失败 / 类型不符 / 429 拒绝"的回滚
  assert.equal(g.photoUploadQuotaRemainingBytes('erin'), g.PHOTO_UPLOAD_QUOTA_BYTES, '回滚后剩余额度必须完全恢复');

  assert.equal(g.tryConsumePhotoUploadQuota('frank', g.PHOTO_UPLOAD_QUOTA_BYTES), true, '刚好等于上限应放行');
  assert.equal(g.tryConsumePhotoUploadQuota('frank', 1), false, '超过上限应拒绝');
  assert.equal(g.photoUploadQuotaRemainingBytes('frank'), 0, '被拒的请求不得扣减额度（避免"拒了也扣"）');
  // 回滚用减法而非写回快照：并发占用的额度不能被后来的回滚抹掉
  g.refundPhotoUploadQuota('frank', 0);
  assert.equal(g.photoUploadQuotaRemainingBytes('frank'), 0, '空回滚不得凭空产生额度');
});

test('P2-12: 配额跨窗口重置，且预算预检是只读的', () => {
  const g = loadPhotoUploadGuards();
  assert.equal(g.photoUploadQuotaRemainingBytes('grace'), g.PHOTO_UPLOAD_QUOTA_BYTES, '未知用户应返回满额');
  assert.equal(g.photoUploadQuotaStore.has('grace'), false, '预检只读，不得创建记账记录');
  assert.equal(g.tryConsumePhotoUploadQuota('grace', 2048), true);
  // 窗口过期后重新计数（既有语义：新窗口从当前时刻起算）
  const rec = g.photoUploadQuotaStore.get('grace');
  rec.windowStart = Date.now() - 60 * 60 * 1000 - 1;
  assert.equal(g.photoUploadQuotaRemainingBytes('grace'), g.PHOTO_UPLOAD_QUOTA_BYTES, '窗口过期后额度应恢复');
});

test('P2-12: 路由在第 N 句中的接线（静态契约）', () => {
  const upload = routeBlock("app.post('/api/photo/upload'", '// ===================== 用户照片删除 API');
  // ① 预算预检必须排在 express.raw 之前 —— 否则仍是"先把 50MB 缓冲进内存再拒绝"
  const precheckAt = upload.indexOf('photoUploadBudgetPrecheck, express.raw(');
  assert.notEqual(precheckAt, -1, '预算预检中间件必须排在 express.raw 之前');
  // ② 配额必须在 sharp 解码之前预占
  const consumeAt = upload.indexOf('tryConsumePhotoUploadQuota(userName, buf.length)');
  const sharpAt = upload.indexOf('sharp(buf');
  assert.ok(consumeAt > -1 && sharpAt > -1 && consumeAt < sharpAt, '配额必须先于 sharp 解码扣除');
  // ③ 并发闸：拿不到名额立即 429
  assert.match(upload, /releaseDecodeSlot = acquirePhotoDecodeSlot\(userName\)/);
  assert.doesNotMatch(upload, /acquirePhotoDecodeSlot\(userName\)\s*;\s*await/, '拿名额这一步不能 await（否则等于排队，缓冲仍留在内存里）');
  assert.match(upload, /code: 'photo_decode_busy'/);
  // ④ 释放与回滚挂在 finally 上（写在各 return 分支里必漏）
  assert.match(upload, /\} finally \{[\s\S]*releaseDecodeSlot\(\)[\s\S]*refundPhotoUploadQuota\(userName, quotaCharged\)/);
  // ⑤ 只有字节真正落到 Storage 才记账不回滚
  const commitAt = upload.indexOf('quotaCommitted = true');
  const uploadAt = upload.indexOf("supabase.storage.from('uploads').upload(");
  assert.ok(commitAt > uploadAt, '只有在上传成功之后才确认记账');
  // ⑥ 预占失败时不记账（quotaCharged 保持 0），避免"没扣却退"
  assert.match(upload, /if \(!tryConsumePhotoUploadQuota\(userName, buf\.length\)\) \{[\s\S]*?return res\.status\(429\)[\s\S]*?\}\s*\n\s*quotaCharged = buf\.length;/);
  assert.match(source, /PHOTO_DECODE_MAX_INFLIGHT_PER_USER = \d+/, '并发上限必须是具名常量');
});

// ===================== P2-11：头像更新按用户串行化 =====================
// 原实现的问题：insert 新头像 → 查询并删除"其它"头像记录 → 删除 Storage 文件，
// 三步之间没有原子性。同一账号两个更新交错时，较早请求的清理查询可能命中较晚请求
// 刚插入的行，把用户刚换上的新头像记录与文件一起删掉。

test('P2-11: 同一用户的头像更新严格串行，不得重叠执行', async () => {
  const m = loadAvatarUpdateLock();
  let active = 0;
  let overlapped = false;
  const order = [];
  async function update(tag) {
    active++;
    if (active > 1) overlapped = true;
    order.push('start' + tag);
    await new Promise(function (r) { setTimeout(r, 10); });
    order.push('end' + tag);
    active--;
    return tag;
  }
  const results = await Promise.all([
    m.runAvatarUpdateSerialized('alice', function () { return update(1); }),
    m.runAvatarUpdateSerialized('alice', function () { return update(2); })
  ]);
  assert.equal(overlapped, false, '同一用户的两次头像更新不得重叠（否则清理查询会看到对方刚插入的行）');
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2'], '必须按到达顺序执行完毕');
  assert.deepEqual(results, [1, 2]);
  await new Promise(function (r) { setImmediate(r); });
  assert.equal(m.avatarUpdateLocks.size, 0, '任务结束后 Map 必须清空，不能随用户数增长');
});

test('P2-11: 锁是 per-user 的，不同用户的更新互不阻塞', async () => {
  const m = loadAvatarUpdateLock();
  let releaseFirst = null;
  const gate = new Promise(function (r) { releaseFirst = r; });
  const first = m.runAvatarUpdateSerialized('u1', function () { return gate; });
  let secondRan = false;
  const second = m.runAvatarUpdateSerialized('u2', async function () { secondRan = true; return 'u2'; });
  assert.equal(await second, 'u2');
  assert.equal(secondRan, true, '不同用户不得被前一个人的锁串行化');
  releaseFirst('u1');
  assert.equal(await first, 'u1');
});

test('P2-11: 前一个更新抛异常不得让后续请求永久排队', async () => {
  const m = loadAvatarUpdateLock();
  await assert.rejects(
    m.runAvatarUpdateSerialized('u3', async function () { throw new Error('insert boom'); }),
    /insert boom/
  );
  // 异常任务的链尾必须已 settle —— 否则下一个请求会一直排在一个已失败的锁后面
  const next = await m.runAvatarUpdateSerialized('u3', async function () { return 'next'; });
  assert.equal(next, 'next', '异常不得让后续请求永久排队（等价保证：锁在 finally 释放）');
  await new Promise(function (r) { setImmediate(r); });
  assert.equal(m.avatarUpdateLocks.size, 0);
});

test('P2-11: 排队超过等待上限立即失败退出，既不挂起也不占着队列', async () => {
  const m = loadAvatarUpdateLock(60); // 生产值 8s，此处压缩以便行为测试
  let releaseFirst = null;
  const gate = new Promise(function (r) { releaseFirst = r; });
  const holder = m.runAvatarUpdateSerialized('u4', function () { return gate; });
  let waiterRan = false;
  const waiter = m.runAvatarUpdateSerialized('u4', async function () { waiterRan = true; return 'late'; });
  await assert.rejects(waiter, function (err) {
    return !!(err && err.avatarBusy === true);
  });
  assert.equal(waiterRan, false, '超时的请求不得再执行更新逻辑');
  releaseFirst('holder-done');
  assert.equal(await holder, 'holder-done', '持锁者本身不受后续排队者影响');
  const after = await m.runAvatarUpdateSerialized('u4', async function () { return 'after'; });
  assert.equal(after, 'after', '超时者已让出队列位置，后续请求不会被卡死');
  await new Promise(function (r) { setImmediate(r); });
  assert.equal(m.avatarUpdateLocks.size, 0, '链尾清理回调必须回收最后一个 key');
});

test('P2-11: 头像更新路由的接线与"按引用确认后才删文件"（静态契约）', () => {
  const block = routeBlock("app.post('/api/avatar'", "app.post('/api/avatar/status'");
  assert.match(block, /runAvatarUpdateSerialized\(userName, async function\(\) \{/);
  // 插入新记录必须发生在锁内、且在清理旧记录之前
  const lockAt = block.indexOf('runAvatarUpdateSerialized(userName');
  const insertAt = block.indexOf("supabase.from('posts').insert");
  assert.ok(lockAt > -1 && insertAt > lockAt, '插入与清理必须都在锁的作用域内');
  // 等待超时 → 429 而非 500，明确告知用户"稍后重试"
  assert.match(block, /e && e\.avatarBusy/);
  assert.match(block, /code: 'avatar_update_busy'/);
  // 只清理严格早于本次插入的行：更新（并发写入）的记录必须保留
  assert.match(block, /if \(rowCreated && ourCreated && rowCreated > ourCreated\) return false;/);
  assert.match(block, /if \(Number\(row\.id\) > Number\(ourRow\.id\)\) return false;/);
  // 删除要回读确认：只处理确实被删掉的行
  assert.match(block, /\.delete\(\)\.in\('id', staleIds\)\.select\('id'\)/);
  assert.match(block, /deletedIds\[String\(row\.id\)\] === true/);
  // 删文件前确认无引用（含其它用户）：查询失败一律跳过
  assert.match(block, /\.ilike\('media_url', '%' \+ avEscaped \+ '%'\)/);
  assert.match(block, /if \(stillRefRes\.data && stillRefRes\.data\.length > 0\) continue;/);
  assert.match(block, /supabase\.storage\.from\('uploads'\)\.remove\(safeToRemove\)/);
  // 旧写法：无条件用"查询到的 id 列表"去删文件，删记录失败也照删不误
  assert.doesNotMatch(block, /var oldIds = oldRows\.map/);
  assert.doesNotMatch(block, /\.delete\(\)\.in\('id', oldIds\);/);
  assert.doesNotMatch(block, /remove\(stalePaths\)/);
  // 单次清理必须有行数上限，防止 N+1 次引用查询被放大
  assert.match(block, /limit\(AVATAR_CLEANUP_MAX_ROWS\)/);
  assert.match(source, /AVATAR_UPDATE_LOCK_WAIT_MS = \d+/);
});
