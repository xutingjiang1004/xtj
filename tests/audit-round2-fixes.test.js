/**
 * 第二轮审计遗留项修复的回归测试（2026-09-13）
 *
 * 覆盖：
 *  - M-01  错误日志双重转义（后端不再转义，职责收敛到前端）
 *  - M-05  统计与用户列表时间窗统一（统一传 days）
 *  - M-06  截断事实透出（truncated 标记 + 前端提示 + 时间窗控件）
 *  - M-10  管理后台 IP/位置/坐标/邮编默认遮罩 + 按需显示
 *  - M-12  AI 配置表单读取 null 兜底 + 缺失清单提示
 *  - P-12  SSE 残留 buffer 上限（三处）
 *  - P-18  sessionStorage 缓存清理 vision_urls
 *  - P-23  navigator.share 失败不再静默吞掉
 *  - P-29  深研页与主聊天拆分生命周期计数器
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const server = read('render-api/server.js');
const admin = read('js/admin/admin.js');
const aiAgent = read('js/ai-agent.js');

// ---------------------------------------------------------------- M-01

test('M-01: error-logs 接口不再在后端做 HTML 转义（职责收敛到前端）', () => {
  const start = server.indexOf("app.get('/admin/error-logs'");
  assert.notEqual(start, -1, '未找到 /admin/error-logs 路由');
  const end = server.indexOf('// ★ 客户端错误日志自动 TTL 清理', start);
  const body = server.slice(start, end);

  // 断言渲染字段不再被 escapeHtml 包裹（否则前端二次转义会产生 &amp;lt; 字面量）
  assert.doesNotMatch(body, /message:\s*escapeHtml\(/);
  assert.doesNotMatch(body, /stack:\s*escapeHtml\(/);
  assert.doesNotMatch(body, /url:\s*escapeHtml\(/);
  assert.doesNotMatch(body, /user_agent:\s*escapeHtml\(/);
  // 但字段本身必须仍然返回
  assert.match(body, /message:\s*info\.message/);
  assert.match(body, /stack:\s*info\.stack/);
});

test('M-01: 前端渲染错误日志时仍逐字段转义（防存储型 XSS 不失守）', () => {
  const idx = admin.indexOf("escapeHtml(e.message || '-')");
  assert.notEqual(idx, -1, '前端未对错误日志 message 做转义');
  // 同一行内 url 也要转义
  const line = admin.slice(admin.lastIndexOf('h +=', idx), admin.indexOf('\n', idx));
  assert.match(line, /escapeHtml\(e\.url \|\| '-'\)/);
});

test('M-01: 同类接口（audit-logs）保持后端返回原始数据的既有规范', () => {
  const start = server.indexOf("app.get('/admin/audit-logs'");
  const end = server.indexOf('// ===================== 用户访问统计', start);
  const body = server.slice(start, end);
  assert.doesNotMatch(body, /escapeHtml\(/, 'audit-logs 不应在后端转义（由前端负责）');
});

// ------------------------------------------------------------ M-05/M-06

test('M-05: 前端统计与用户列表统一传同一个 days 参数', () => {
  const start = admin.indexOf('async function renderAiAdminUsageSummary');
  const end = admin.indexOf('// ===================== AI 邀请码管理', start);
  const body = admin.slice(start, end);

  assert.match(body, /usage-summary' \+ _q/, 'usage-summary 未带时间窗参数');
  assert.match(body, /ai-agent\/users' \+ _q/, 'users 未带时间窗参数');
  assert.match(body, /var _q = '\?days=' \+ encodeURIComponent\(_win\)/);
});

test('M-06: 后端两个接口都透出 truncated 标记', () => {
  assert.match(server, /truncated:\s*Array\.isArray\(allRows\) && allRows\.length >= 10000/);
  assert.match(server, /truncated:\s*Array\.isArray\(rows\) && rows\.length >= 50000/);
});

test('M-06: 前端提供时间窗下拉控件并绑定 change 事件', () => {
  assert.match(admin, /id="aiUsageDaysSel"/, '缺少时间窗下拉控件');
  assert.match(admin, /_daysSel\.addEventListener\('change'/, '下拉未绑定 change');
  assert.match(admin, /window\._aiUsageDays = _daysSel\.value/);
});

test('M-06: 前端对截断状态给出可见提示', () => {
  const start = admin.indexOf('async function renderAiAdminUsageSummary');
  const end = admin.indexOf('// ===================== AI 邀请码管理', start);
  const body = admin.slice(start, end);
  assert.match(body, /usersTruncated/, '未消费 users 的 truncated 标记');
  assert.match(body, /summaryTruncated/, '未消费 summary 的 truncated 标记');
  assert.ok(body.split('已达单次查询上限').length - 1 >= 2, '截断提示文案应覆盖两个接口');
});

// ----------------------------------------------------------------- M-10

test('M-10: 管理后台提供 IP / 地理 / 邮编遮罩工具', () => {
  assert.match(admin, /function maskIp\(v\)/);
  assert.match(admin, /function maskGeo\(v\)/);
  // 遮罩开关只存内存，不做持久化（避免"上次点过显示"变成永久明文）
  assert.match(admin, /var _showSensitiveInSession = false/);
  assert.doesNotMatch(admin, /localStorage\.setItem\([^)]*_showSensitiveInSession/);
});

test('M-10: 实时在线页与画像页的敏感字段默认走遮罩', () => {
  // 实时在线：IP 与位置
  assert.match(admin, /_showSensitiveInSession \? \(u\.ip \|\| '未记录'\) : maskIp\(u\.ip\)/);
  assert.match(admin, /_showSensitiveInSession \? \(u\.location \|\| '未解析'\) : maskGeo\(u\.location\)/);
  // 画像页：IP
  assert.match(admin, /_showSensitiveInSession \? \(p\.latest_ip \|\| ''\) : maskIp\(p\.latest_ip\)/);
  // 画像页：GPS 坐标必须遮罩
  assert.match(admin, /已遮罩/, 'GPS 坐标未遮罩');
});

test('M-10: 用户列表页区域使用 _geoRaw 统一遮罩', () => {
  assert.match(admin, /var _geoRaw = ''/, '未引入 _geoRaw 中转变量');
  assert.match(admin, /regionCell = escapeHtml\(_showSensitiveInSession \? _geoRaw : maskGeo\(_geoRaw\)\)/);
});

test('M-10: 提供按需显示入口', () => {
  assert.match(admin, /window\.revealSensitive = revealSensitive/);
  assert.match(admin, /onclick="window\.revealSensitive\(\)"/);
});

// ----------------------------------------------------------------- M-12

test('M-12: AI 配置读取提供 cfgVal / cfgChecked / cfgInt 兜底', () => {
  assert.match(admin, /function cfgVal\(id, def\)/);
  assert.match(admin, /function cfgChecked\(id, def\)/);
  assert.match(admin, /function cfgInt\(id, def\)/);
});

test('M-12: 配置组装块内不再有裸 getElementById(...).value / .checked', () => {
  const start = admin.indexOf('var configPayload = {');
  const end = admin.indexOf("if (!configPayload.name || configPayload.name.length > 30)", start);
  const block = admin.slice(start, end);
  assert.doesNotMatch(block, /document\.getElementById\([^)]+\)\.value/);
  assert.doesNotMatch(block, /document\.getElementById\([^)]+\)\.checked/);
  assert.ok(block.split('cfgVal(').length > 10, 'cfgVal 使用点过少，替换可能不完整');
});

test('M-12: 保存后若存在控件缺失，明确告知缺失清单', () => {
  assert.match(admin, /window\.__xtjCfgMissing = \[\]/, '未在保存前清空缺失清单');
  assert.match(admin, /_miss\.length/, '未消费缺失清单');
  assert.match(admin, /个控件未找到/);
});

// ----------------------------------------------------------------- P-12

test('P-12: 三处 SSE 读取循环都有残留 buffer 上限', () => {
  const guardCount = (aiAgent.match(/buffer\.length > /g) || []).length;
  assert.ok(guardCount >= 3, 'SSE buffer 上限守卫少于 3 处，实际 ' + guardCount);
  // 单行上限仍在（不能为了加 buffer 上限把单行上限删掉）
  assert.match(aiAgent, /MAX_EVENT_SIZE = 512 \* 1024/);
});

// ----------------------------------------------------------------- P-18

test('P-18: sessionStorage 缓存清理覆盖 vision_urls（不只 content）', () => {
  const start = aiAgent.indexOf('function sanitizeCacheMsgs(msgs)');
  const end = aiAgent.indexOf('function setAiHistoryCache(', start);
  const body = aiAgent.slice(start, end);

  assert.match(body, /var vus = m\.vision_urls/, '未读取 vision_urls');
  assert.match(body, /hasVisionData/, '未判断 vision_urls 是否含 data URL');
  assert.match(body, /copy\.vision_urls = vus\.map/, '未清理 vision_urls');
  // 保留数组结构（长度/下标），只是内容替换
  assert.match(body, /'\[图片数据\]' : u/);
});

// ----------------------------------------------------------------- P-23

test('P-23: navigator.share 失败不再被静默吞掉', () => {
  assert.match(aiAgent, /function handleShareError\(err, text\)/);
  // 两处调用都要走统一处理
  const calls = aiAgent.match(/\.catch\(function\(err\) \{ handleShareError\(err, t\); \}\)/g) || [];
  assert.equal(calls.length, 2, 'share 调用应有两处走统一错误处理，实际 ' + calls.length);
  // 原静默形态应已消失
  assert.doesNotMatch(aiAgent, /navigator\.share\([\s\S]{0,200}?\.catch\(function\(\) \{\}\)/);
  // 用户主动取消不应打扰（AbortError 静默）
  assert.match(aiAgent, /name === 'AbortError'/);
  // 真实失败要降级到剪贴板
  assert.match(aiAgent, /try \{ doCopy\(text\); \} catch \(e\) \{\}/);
});

// ----------------------------------------------------------------- P-29

test('P-29: 深研页拥有独立生命周期计数器', () => {
  assert.match(aiAgent, /dtLifecycleId: 0/, '未定义 dtLifecycleId');
  // openDeepThinkPage 用独立计数器
  assert.match(aiAgent, /S\.dtLifecycleId\+\+;\s*\n\s*var pageLifecycle = S\.dtLifecycleId;/);
  // 三处守卫都用独立计数器
  const guards = aiAgent.match(/if \(S\.dtLifecycleId !== pageLifecycle \|\| panel\._dtClosed\) return;/g) || [];
  assert.equal(guards.length, 3, '深研页守卫应有三处，实际 ' + guards.length);
});

test('P-29: closeDeepThinkPage 不再递增主聊天计数器（避免误杀主聊天在途流）', () => {
  const start = aiAgent.indexOf('function closeDeepThinkPage()');
  const end = aiAgent.indexOf('var _dtFileData', start);
  const body = aiAgent.slice(start, end);
  assert.match(body, /S\.dtLifecycleId\+\+/);
  assert.doesNotMatch(body, /S\.lifecycleId\+\+/, '仍会误杀主聊天在途回调');
});

test('P-29: 主聊天仍使用原有 lifecycleId（未被反向破坏）', () => {
  assert.match(aiAgent, /var lifecycleId = \+\+S\.lifecycleId;/);
  assert.match(aiAgent, /if \(lifecycleId !== S\.lifecycleId \|\| !S\.active\) return null;/);
});

// ------------------------------------------------------- Dock 红线（持续生效）

test('Dock 红线：本轮修复不得触及 dock / capsule / 底部导航相关代码', () => {
  const pkg = JSON.parse(read('package.json'));
  const scriptsOk = String(pkg.scripts.test || '').indexOf('audit-round2-fixes') >= 0;
  assert.ok(scriptsOk, '新测试未接入 npm test');

  // 本轮改动集中于 admin.js / ai-agent.js / server.js 的指定区块，
  // 不得出现针对 dock 容器的选择器改动
  const dockTouch = /(dock-bar|dock-capsule|dockCapsule|dockBar)[^\n]*\n[^\n]*(maskIp|maskGeo|cfgVal|dtLifecycleId|handleShareError)/;
  assert.doesNotMatch(admin, dockTouch);
  assert.doesNotMatch(aiAgent, dockTouch);
});
