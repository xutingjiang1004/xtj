/**
 * 合约测试：用户登录态「30 天有效 + 设备识别」
 *
 * 背景（用户报障，2026-09-22）：
 *   「每次更新网站或者刷新网站都有很大很大的概率要重新登录……我记得之前设置的
 *     好像是七天还是 30 天来着，为什么现在还是失效了？弄一个 30 天的有效期，
 *     识别这个用户本机设备之后，那么 30 天之内都是不用再次登录验证。」
 *
 * 根因（本文件要固化的修复）：
 *   ① 后端 isRefreshTokenRevoked 是 **fail-closed** —— Supabase 查询一抛异常
 *      （冷启动超时 / 网络抖动 / 限流）就 `return true`（认定已撤销），
 *      /api/user/refresh 随即 401 并 **clearCookie 清掉 refresh cookie**，
 *      会话不可恢复 → 用户被永久登出。Render 免费层冷启动叠加 DB 抖动，
 *      命中率极高，正是"很大很大的概率"。
 *   ② 多标签页并发刷新会撞上 jti 重用检测，旧实现同样 401 + 清 cookie。
 *   ③ cookie 用 sameSite:'Strict'，从外链/主屏图标进入时首屏漏发 cookie。
 *   ④ 前端把 5xx / 网络异常一律当成"登录已失效"，直接弹登录框。
 *
 * 本测试把「基础设施抖动不得踢用户」「只有确证失效才清 cookie」
 * 「设备标识参与签发」「刷新重试而非登出」固化成可回归的断言。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const uxSrc = fs.readFileSync(path.join(root, 'js', 'ux-features.js'), 'utf8');

// ── 1) 撤销判定：必须区分「确证撤销」与「查询不可用」 ──────────────────
test('撤销判定：必须存在结构化裁决函数 checkRefreshTokenRevoked', () => {
  assert.match(serverSrc, /async function checkRefreshTokenRevoked\(/,
    '必须存在结构化裁决函数，不能只有一个 fail-closed 的布尔版本');
  const start = serverSrc.indexOf('async function checkRefreshTokenRevoked(');
  const body = serverSrc.slice(start, start + 2000);

  // 查询失败 → uncertain（放行），绝不能 revoked
  assert.match(body, /revoked:\s*false,\s*uncertain:\s*true/,
    'DB 查询失败必须返回 uncertain=true 且 revoked=false（否则一次抖动就踢人）');
  // 明确查不到 → 确证撤销
  assert.match(body, /revoked:\s*true,\s*uncertain:\s*false/,
    '明确查不到 jti 时才是 revoked=true');
  // 必须读取 error，而不是只看 data
  assert.match(body, /var\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/,
    '必须解构 error 字段，旧实现只解构 data 才导致 fail-closed');
  assert.match(body, /if\s*\(error\)/, '必须显式处理 error 分支');
});

test('撤销判定：兼容层 isRefreshTokenRevoked 只表达「确证已撤销」', () => {
  assert.match(serverSrc, /async function isRefreshTokenRevoked\(refreshToken\)\s*\{/,
    '旧调用点仍需兼容');
  const start = serverSrc.indexOf('async function isRefreshTokenRevoked(');
  const body = serverSrc.slice(start, start + 300);
  assert.match(body, /checkRefreshTokenRevoked/, '必须委托给结构化裁决');
  assert.match(body, /return\s*!!verdict\.revoked/, '只返回确证撤销的布尔值');
});

test('refresh 接口：查询不可用（uncertain）时不得清 cookie、不得 401', () => {
  const start = serverSrc.indexOf("app.post('/api/user/refresh'");
  assert.ok(start > 0, 'refresh 路由必须存在');
  const body = serverSrc.slice(start, start + 2600);
  assert.match(body, /checkRefreshTokenRevoked/, 'refresh 必须走结构化裁决');

  const revokedIdx = body.indexOf('revokeVerdict.revoked)');
  assert.ok(revokedIdx > 0, '必须存在确证撤销分支');
  const revokedSeg = body.slice(revokedIdx, revokedIdx + 320);
  assert.match(revokedSeg, /clearCookie/, '确证撤销才清 cookie');

  // uncertain 分支：只告警放行，绝不 clearCookie / 401
  const uncertainIdx = body.indexOf('revokeVerdict.uncertain)');
  assert.ok(uncertainIdx > 0, '必须存在 uncertain 分支');
  const uncertainSeg = body.slice(uncertainIdx, uncertainIdx + 320);
  assert.doesNotMatch(uncertainSeg, /clearCookie/, 'uncertain 绝不能清 cookie');
  assert.doesNotMatch(uncertainSeg, /status\(401\)/, 'uncertain 绝不能 401');
});

test('refresh 接口：jti 重用（多标签并发）不得立刻 401 清 cookie', () => {
  const start = serverSrc.indexOf("app.post('/api/user/refresh'");
  const body = serverSrc.slice(start, start + 3200);
  const reuseIdx = body.indexOf('refreshTokenInUse.has(payload.jti)');
  assert.ok(reuseIdx > 0, '必须存在重用检测');
  const seg = body.slice(reuseIdx, reuseIdx + 900);
  assert.match(seg, /setTimeout/, '必须先短暂等待轮换完成，而不是立刻拒绝');
  assert.match(seg, /status\(409\)/, '仍冲突时返回可重试的 409');
  assert.doesNotMatch(seg, /clearCookie/, '重用冲突不得清 cookie（否则多标签页必掉线）');
  assert.match(seg, /retryable:\s*true/, '必须标记为可重试');
});

// ── 2) 有效期与设备识别 ─────────────────────────────────────────────
test('刷新令牌有效期必须是 30 天', () => {
  assert.match(serverSrc, /USER_REFRESH_TOKEN_EXPIRY_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    'refresh token 必须是 30 天');
  assert.match(coreSrc, /USER_SESSION_TTL_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    '前端本地会话同样必须是 30 天');
});

test('刷新即续期：每次 refresh 都要重新签发 30 天令牌（滑动窗口）', () => {
  const start = serverSrc.indexOf("app.post('/api/user/refresh'");
  const body = serverSrc.slice(start, start + 4200);
  assert.match(body, /signUserRefreshToken\(payload\.user_name,\s*presentedDeviceId\)/,
    'refresh 必须重新签发 refresh token（滑动 30 天，而非固定到期）');
  assert.match(body, /maxAge:\s*USER_REFRESH_TOKEN_EXPIRY_MS/,
    'cookie maxAge 必须同步为 30 天');
});

test('设备识别：令牌里只存设备 ID 的哈希，不得落明文', () => {
  assert.match(serverSrc, /function deviceFingerprint\(/, '必须存在设备指纹函数');
  const start = serverSrc.indexOf('function deviceFingerprint(');
  const body = serverSrc.slice(start, start + 500);
  assert.match(body, /createHash\('sha256'\)/, '必须哈希后写入');
  assert.match(body, /'dev:'/, '必须加盐域分隔，避免与其它哈希混淆');
  // 空值（隐私模式/旧客户端）返回 ''，表示未绑定，不影响登录
  assert.match(body, /return\s*'';/, '取不到设备 ID 时必须返回空串，保证存量会话平滑过渡');
});

test('设备识别：refresh token 签发时必须携带 did', () => {
  const start = serverSrc.indexOf('function signUserRefreshToken(');
  const body = serverSrc.slice(start, start + 700);
  assert.match(body, /deviceId/, '签名函数必须接受设备 ID 参数');
  assert.match(body, /payload\.did\s*=\s*did/, '必须把设备哈希写进令牌');
});

test('设备识别：换设备不得把用户锁在外面（软绑定，只告警重绑）', () => {
  const start = serverSrc.indexOf("app.post('/api/user/refresh'");
  const body = serverSrc.slice(start, start + 3200);
  const idx = body.indexOf('presentedDid !== payload.did');
  assert.ok(idx > 0, '必须存在设备变更分支');
  const seg = body.slice(idx, idx + 320);
  assert.doesNotMatch(seg, /clearCookie/, '设备变更不得清 cookie');
  assert.doesNotMatch(seg, /status\(401\)/, '设备变更不得直接 401（会把清了本地存储的用户锁死）');
  assert.match(body, /重新绑定|重新绑定/, '应记录并重新绑定');
});

test('cookie 必须使用 sameSite Lax（Strict 会在外链/主屏进入时漏发）', () => {
  const cookies = serverSrc.match(/res\.cookie\('xtj_user_refresh'[\s\S]{0,320}?\}\) /g) || [];
  const all = serverSrc.match(/res\.cookie\('xtj_user_refresh'[\s\S]{0,320}?\n\s*\}\)/g) || [];
  const blocks = cookies.concat(all);
  assert.ok(blocks.length >= 2, `至少两处下发 refresh cookie，实际 ${blocks.length} 处`);
  for (const b of blocks) {
    assert.match(b, /sameSite:\s*'Lax'/, 'refresh cookie 必须 sameSite=Lax');
    assert.match(b, /httpOnly:\s*true/, '必须 httpOnly');
    assert.match(b, /secure:\s*true/, '必须 secure');
  }
});

// ── 3) 前端：刷新失败不得直接登出 ────────────────────────────────────
test('前端：必须存在稳定的设备标识 getXtjDeviceId', () => {
  assert.match(coreSrc, /function getXtjDeviceId\(/, '必须存在设备标识函数');
  const declIdx = coreSrc.indexOf("var DEVICE_ID_KEY = 'xtj_device_id'");
  assert.ok(declIdx > 0, '必须有 xtj_device_id 存储键常量');
  const start = coreSrc.indexOf('function getXtjDeviceId(');
  const body = coreSrc.slice(start, start + 1400) + coreSrc.slice(declIdx, declIdx + 120);
  assert.match(body, /xtj_device_id/, '必须有固定的存储键');
  assert.match(body, /randomUUID/, '必须生成不可猜测的随机 ID');
  // 读取失败/写入失败都要有兜底，不能抛异常打断登录流程
  assert.match(body, /catch/, '存储读写必须有兜底');
});

test('前端：登录 / 注册 / 刷新三处都要上报 device_id', () => {
  const loginIdx = coreSrc.indexOf("API_BASE + '/api/user/login'");
  assert.ok(loginIdx > 0, '登录请求必须存在');
  assert.match(coreSrc.slice(loginIdx, loginIdx + 400), /device_id/, '登录必须带 device_id');

  const regIdx = coreSrc.indexOf("API_BASE + '/api/user/register'");
  assert.ok(regIdx > 0, '注册请求必须存在');
  assert.match(coreSrc.slice(regIdx, regIdx + 400), /device_id/, '注册必须带 device_id');

  const refIdx = coreSrc.indexOf("API_BASE + '/api/user/refresh'");
  assert.ok(refIdx > 0, '刷新请求必须存在');
  assert.match(coreSrc.slice(refIdx, refIdx + 400), /device_id/, '刷新必须带 device_id');
});

test('前端：refresh 对 5xx / 网络异常必须退避重试，不得判定为登录失效', () => {
  const start = coreSrc.indexOf('async function refreshUserTokenViaCookie(');
  assert.ok(start > 0, 'refreshUserTokenViaCookie 必须存在');
  const body = coreSrc.slice(start, start + 4800);
  assert.match(body, /while\s*\(attempts\s*<\s*2\)/, '必须至少重试一次');
  assert.match(body, /setTimeout\(r,\s*500\)/, '必须有退避等待');
  // 只有 401/403 才进入冷却（确证失效）
  assert.match(body, /res\.status === 401 \|\| res\.status === 403/, '仅 401/403 视为确证失效');
  assert.match(body, /_refreshCooldownUntil = Date\.now\(\) \+ 30000/, '确证失效才进冷却');
  // 5xx 落到 retryable，不触发登出
  assert.match(body, /reason: 'retryable'/, '可恢复错误必须标记 retryable');
});

test('前端：瞬时失败后不得主动登出（保留本地会话）', () => {
  const start = coreSrc.indexOf('async function refreshUserTokenViaCookie(');
  const body = coreSrc.slice(start, start + 4800);
  const tail = body.slice(body.indexOf('if (attempts < 2)'));
  assert.match(tail, /不主动登出/,
    '重试仍失败时必须保留本地会话，交由下次交互重试');
  // 收尾注释之后就是 return 空 token：不得夹带 clearAllAuthState / 弹登录框
  assert.doesNotMatch(tail, /clearAllAuthState/,
    'refresh 重试失败不得顺手清空登录态');
});

test('前端：设备标识键必须纳入清理白名单（否则每次清理都换设备）', () => {
  const idx = uxSrc.indexOf('^xtj_user$|^xtj_user_session$');
  assert.ok(idx > 0, '必须存在 localStorage 清理白名单');
  const line = uxSrc.slice(idx, idx + 400);
  assert.match(line, /xtj_device_id/, 'xtj_device_id 必须在白名单内，否则会被误删');
});

/* ── 4) 天气工具：必须自带紫外线，且上游抖动要有退避重试 ────────────────
   背景（用户转述 AI 的自白，2026-09-22）：
     「这次成功的方法之前失败时，我用的是专门的天气工具 get_weather —— 但这个
      工具有问题（服务侧故障）。这次我换了策略：用 tavily_search 搜索
      「福州天气 紫外线」，再用 read_web_page 读取中国天气网的页面。」
   两点结论：
     ① 工具当时确实被判定为服务侧故障 —— 上游偶发抖动必须有退避重试兜底；
     ② 即便成功，工具也**根本没有返回紫外线**（请求参数里没有 uv 字段），
        所以问「紫外线」时模型只能绕道去网页里抠，慢且容易抠错。
   本段把「请求必须带 UV」「重试必须退避」「输出必须含 UV 分级」固化成契约。 */
test('天气工具：预报请求必须包含紫外线字段', () => {
  const wSrc = fs.readFileSync(path.join(root, 'render-api', 'weather.js'), 'utf8');
  const urlIdx = wSrc.indexOf('https://api.open-meteo.com/v1/forecast');
  assert.ok(urlIdx > 0, '必须存在 Open-Meteo 预报请求');
  const urlSeg = wSrc.slice(urlIdx, urlIdx + 320);
  assert.match(urlSeg, /uv_index/, 'current 参数必须带 uv_index（否则问紫外线只能绕道搜网页）');
  assert.match(urlSeg, /uv_index_max/, 'daily 参数必须带 uv_index_max');
});

test('天气工具：上游失败必须有退避重试（无间隔连重试会一起失败）', () => {
  const wSrc = fs.readFileSync(path.join(root, 'render-api', 'weather.js'), 'utf8');
  const idx = wSrc.indexOf('for (var attempt = 0; attempt <');
  assert.ok(idx > 0, '必须存在重试循环');
  const seg = wSrc.slice(idx, idx + 700);
  assert.match(seg, /attempt\s*<\s*3/, '重试次数应提升到 3 次');
  assert.match(seg, /setTimeout/, '重试之间必须有退避等待');
});

test('天气工具：输出文本必须带紫外线指数与分级', () => {
  const w = require(path.join(root, 'render-api', 'weather.js'));
  assert.strictEqual(typeof w.describeUvIndex, 'function', '必须导出紫外线分级函数');
  // WHO 分级边界：3 / 6 / 8 / 11
  assert.strictEqual(w.describeUvIndex(1), '低');
  assert.strictEqual(w.describeUvIndex(4), '中等');
  assert.strictEqual(w.describeUvIndex(7), '高');
  assert.strictEqual(w.describeUvIndex(9), '很高');
  assert.strictEqual(w.describeUvIndex(12), '极高');
  const text = w.formatWeatherText({
    city: '福州', condition: '晴', temperature_c: 31, humidity: 60, wind_kmh: 8,
    high_c: 34, low_c: 26, precip_prob: 10,
    uv_index: 7.4, uv_index_max: 10.2, queried_at: 'x'
  });
  assert.match(text, /紫外线指数：7\.4/, '正文必须输出实时紫外线指数');
  assert.match(text, /紫外线峰值：10\.2/, '正文必须输出今日紫外线峰值');
  assert.match(text, /（高）/, '必须带中文分级，方便模型直接回答');
});

test('天气工具：工具描述必须声明支持紫外线（否则模型不会用它查 UV）', () => {
  assert.match(serverSrc, /name: 'get_weather'/);
  const idx = serverSrc.indexOf("name: 'get_weather'");
  const seg = serverSrc.slice(idx, idx + 400);
  assert.match(seg, /紫外线/, '工具描述必须写明支持紫外线，模型才会优先用工具而不是搜网页');
});
