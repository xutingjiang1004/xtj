/**
 * 2026-09-26 深度审计修复的回归契约。
 * 对应报告：audit-reports/2026-09-26-全栈深度审计报告.md
 * 目的：把本轮修复钉住，防止后续改动把已修的问题改回去。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const server = read('render-api/server.js');
const sandbox = read('render-api/sandbox.js');
const markers = read('render-api/post-markers.js');
const postQuery = read('render-api/post-query.js');
const chatNav = read('js/core-parts/06-chat-and-nav.js');
const bootstrap = read('js/core-parts/01-bootstrap.js');
const authRestrictions = read('js/core-parts/02-auth-restrictions.js');
const feedStats = read('js/core-parts/05-feed-stats.js');
const aiAgent = read('js/ai-agent.js');
const styleCss = read('css/style.css');
const renderYaml = read('render.yaml');

// ---------------------------------------------------------------- P0-1 沙箱 fail-closed
test('P0-1 沙箱 fail-closed：不降级到 vm，且启动/健康检查暴露状态', () => {
  assert.doesNotMatch(sandbox, /function runInVmFallback/, '不得保留 vm 降级实现');
  assert.doesNotMatch(sandbox, /^\s*(?:const|let|var)\s+\w+\s*=\s*require\(['"]vm['"]\)/m, '不得 require vm');
  assert.match(sandbox, /if \(!ivm\) throw sandboxUnavailableError\(\);/, 'ivm 缺失必须拒绝执行');
  assert.match(sandbox, /enabled: !!ivm/, 'sandboxInfo 必须暴露 enabled');
  assert.match(server, /SANDBOX]\[CRITICAL\]/, '启动日志必须显式报告沙箱不可用');
  assert.match(server, /SANDBOX_UNAVAILABLE/, 'run_code 必须识别沙箱不可用错误');
});

// ---------------------------------------------------------------- P1-2 限流键归一化
test('P1-2 限流键必须归一化（大小写/尾斜杠变体共用同一计数桶）', () => {
  assert.match(server, /function rateLimitPathKey\(req\)/, '必须有归一化函数');
  assert.match(server, /req\.route\.path/, '应优先使用 Express 路由模板');
  assert.match(server, /\.toLowerCase\(\)\.replace\(\/\\\/\+\$\/, ''\)/, '应小写化并去尾斜杠');
  const localLimiter = server.slice(server.indexOf('function rateLimit(windowMs, maxRequests)'), server.indexOf('function rateLimit(windowMs, maxRequests)') + 900);
  assert.match(localLimiter, /rateLimitPathKey\(req\)/, '本地限流层必须使用归一化键');
  assert.doesNotMatch(localLimiter, /getRealIp\(req\) \+ ':' \+ req\.path/, '不得再用原始 req.path 作为键');
  const persistent = server.slice(server.indexOf('async function checkPersistentRateLimit'), server.indexOf('async function checkPersistentRateLimit') + 400);
  assert.doesNotMatch(persistent, /req\.path/, '持久化层的键由调用方归一化后传入');
  const securityLimiter = server.slice(server.indexOf('function securityRateLimit(windowMs, maxRequests)'), server.indexOf('function securityRateLimit(windowMs, maxRequests)') + 900);
  assert.match(securityLimiter, /rateLimitPathKey\(req\)/, '持久化限流层必须使用同一归一化键');
});

// ---------------------------------------------------------------- P1-3 生图接口鉴权
test('P1-3 /api/agent/image 必须要求登录且复核重定向地址', () => {
  assert.match(server, /app\.get\('\/api\/agent\/image', authenticateUser,/, '必须补 authenticateUser');
  assert.match(server, /image_upstream_blocked/, '必须校验重定向后的最终地址');
});

// ---------------------------------------------------------------- P1-4 配额并发闸
test('P1-4 AI 聊天链路必须有每用户并发闸与单请求预估值校验', () => {
  assert.match(server, /function aiChatConcurrencyGate\(req, res, next\)/, '必须有并发闸');
  assert.match(server, /ai_concurrent_limit/, '超限必须返回明确错误码');
  const gateUses = (server.match(/authenticateUser, aiChatConcurrencyGate,/g) || []).length;
  assert.ok(gateUses >= 6, '至少 6 条 AI 写/流式路由必须挂并发闸，实际 ' + gateUses);
  assert.match(server, /estimated_exceeds_remaining/, '超长 prompt 必须按剩余额度提前拒绝');
});

// ---------------------------------------------------------------- P1-5 前端权限位
test('P1-5 isAdmin() 必须以服务端下发的标志优先', () => {
  assert.match(bootstrap, /__xtjServerIsAdmin/, '前端必须读取服务端权威标志');
  assert.match(authRestrictions, /result\.is_admin/, '限制状态接口的 is_admin 必须被消费');
  assert.match(server, /is_admin: String\(req\.userName \|\| ''\) === String\(ADMIN_USERNAME \|\| ''\)/, '服务端必须下发 is_admin');
  assert.match(authRestrictions, /function isUserMuted\(\)[\s\S]{0,220}?isAdmin\(\)/, '禁言豁免应走 isAdmin()');
});

// ---------------------------------------------------------------- P1-7 媒体协议白名单
test('P1-7 私信媒体与举报缩略图必须过 sanitizeUrl', () => {
  assert.match(chatNav, /var safeSrc = \(typeof sanitizeUrl === 'function'\) \? sanitizeUrl\(resolvedImageSrc\) : ''/, '私信图片必须过 sanitizeUrl');
  assert.match(chatNav, /sanitizeUrl\(String\(media\.src \|\| ''\)\)/, '视频/音频必须过 sanitizeUrl');
  assert.match(chatNav, /sanitizeUrl\(item\.thumb\)/, '举报缩略图必须过 sanitizeUrl');
  assert.match(feedStats, /if \(s\.length > 2 \* 1024 \* 1024\) return '';/, 'sanitizeUrl 必须有长度上限');
  assert.match(chatNav, /escapeHtml\(String\(message\.__tempId\)\)/, 'data-temp-id 必须转义');
});

// ---------------------------------------------------------------- P1-8 / P2-5 假成功
test('P1-8 photo/delete 与 delete-status 必须 fail-closed', () => {
  assert.match(server, /photoLookupError/, 'photo/delete 必须解构 error');
  assert.match(server, /delete_lookup_failed/, 'photo/delete 查询失败必须 503');
  assert.match(server, /statusLookupError/, 'delete-status 必须解构 error');
  assert.match(server, /feed_relations_failed/, 'feed 互动子查询失败必须 503 而不是"0 评论"');
});

// ---------------------------------------------------------------- P2-2 / P2-3 查询语义
test('P2-2 /api/photo/view 不得再混用白名单与照片标记', () => {
  const start = server.indexOf("app.post('/api/photo/view'");
  const body = server.slice(start, start + 1800);
  assert.doesNotMatch(body, /applyPublicPostExclusions\(supabase/, 'photo/view 不得再用普通帖白名单（恒 false）');
  assert.match(body, /\.eq\('media_type', '__photo_wall__'\)/, '应直接按照片标记查询');
  assert.match(body, /photo\.is_deleted === true/, '必须过滤软删照片');
});

test('P2-3 软删墓碑不得出现在公开可见面', () => {
  assert.match(postQuery, /if \(row\.is_deleted === true\) return false;/, 'isNormalPost 必须拒绝软删行');
  const feed = server.slice(server.indexOf("app.get('/api/feed'"), server.indexOf("app.get('/api/feed'") + 6000);
  assert.match(feed, /p\.is_deleted === true/, 'feed 必须过滤软删帖子');
});

test('P2-6 /api/post/detail 私密帖返回 404 且返回真实 views', () => {
  const start = server.indexOf("app.get('/api/post/detail/:id'");
  const body = server.slice(start, start + 2500);
  assert.doesNotMatch(body, /post_not_visible/, '私密帖不得用 403 暴露存在性');
  assert.match(body, /views: Number\(post\.views\) \|\| 0/, '必须返回真实 views');
});

// ---------------------------------------------------------------- P1-6 私信删除账号级同步
test('P1-6 私信「删除」必须同步到账号（服务端墓碑 + 前端回推）', () => {
  assert.match(markers, /DM_DELETED_MARKER/, '必须有服务端墓碑标记');
  assert.match(server, /app\.get\('\/api\/dm\/deleted', authenticateUser/, '必须有读取接口');
  assert.match(server, /app\.post\('\/api\/dm\/deleted', authenticateUser/, '必须有写入接口');
  assert.match(chatNav, /function syncDmDeletedWithServer\(/, '前端必须与服务端合并墓碑');
  assert.match(chatNav, /function pushDmDeletedToServer\(/, '前端必须回推墓碑');
  assert.match(chatNav, /已同步到账号/, '提示文案必须反映真实语义');
  assert.doesNotMatch(chatNav, /showToast\('已删除（仅本机）'\)/, '不得再无条件宣称"仅本机"');
  // 公开 feed 白名单不得包含该标记
  assert.doesNotMatch(markers, /PUBLIC_POST_MEDIA_TYPES = \[[^\]]*__dm_deleted__/, '墓碑标记不得进公开白名单');
});

// ---------------------------------------------------------------- P1-9 测试清单
test('P1-9 package.json 不得再漏跑测试文件', () => {
  const pkg = JSON.parse(read('package.json'));
  const listed = new Set((pkg.scripts.test.match(/tests\/[A-Za-z0-9_.\-]+\.test\.js/g) || []).map((s) => path.basename(s)));
  const actual = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js'));
  const missing = actual.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], '以下测试文件未被执行：' + missing.join(', '));
  assert.match(pkg.scripts['test:syntax'], /render-api\/sandbox\.js/, '语法检查清单应包含关键后端模块');
});

// ---------------------------------------------------------------- P2-31 构建门禁
test('P2-31 构建门禁必须包含一致性校验', () => {
  assert.match(renderYaml, /buildCommand:.*test:consistency/, 'render.yaml 构建阶段必须跑产物一致性检查');
});

// ---------------------------------------------------------------- AI 前端专项
test('AI 前端：SVG 白名单重建、下载链接协议白名单、光标与 EOF 修复', () => {
  assert.match(aiAgent, /function sanitizeSvgMarkup\(/, '必须有 SVG 白名单重建');
  assert.match(aiAgent, /SVG_ALLOWED_TAGS/, '必须有元素白名单');
  assert.match(aiAgent, /var safeSvg = sanitizeSvgMarkup\(String\(data\.svg\)\)/, '图表卡必须走白名单');
  assert.match(aiAgent, /var urlOk = \/\^\(https\?:\|blob:\|data:\)\/i\.test\(rawUrl\)/, '下载链接必须校验协议');
  assert.match(aiAgent, /ai-stream-cursor'\)\) continue;/, '增量补丁必须忽略打字光标节点');
  assert.match(aiAgent, /if \(cursor && cursor\.parentNode !== targetEl\) cursor = null;/, '光标必须能在被抹掉后重挂');
  assert.match(aiAgent, /if \(buffer && buffer\.charAt\(buffer\.length - 1\) !== '\\n'\) buffer \+= '\\n';/, 'EOF 半行必须派发');
  assert.match(aiAgent, /typeof renderMarkdown === 'function'\) \? renderMarkdown/, '不得再委托可变全局 renderMarkdown');
});

// ---------------------------------------------------------------- 性能档位
test('P2-24 perf-lite 档位必须有 CSS 降级', () => {
  assert.match(styleCss, /html\.perf-lite \.ai-chat-container/, 'perf-lite 必须关闭模糊');
  assert.match(styleCss, /animation-iteration-count: 1 !important/, 'perf-lite 必须收敛常驻动画');
});

test('P2-30 必须处理离线状态', () => {
  assert.match(feedStats, /addEventListener\('offline'/, '必须有 offline 提示');
  assert.match(bootstrap, /navigator\.onLine === false/, '写操作在离线时应立即给出明确文案');
});
