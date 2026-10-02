const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'js', 'login-device.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('safe analytics records aggregate events without raw interaction payloads', () => {
  const segment = client.slice(client.indexOf('function initSafeAnalytics()'), client.indexOf('function getMeaningfulTarget'));
  assert.match(segment, /scroll_depth/);
  assert.match(segment, /session_summary/);
  assert.match(segment, /web_vital/);
  assert.match(segment, /client_error/);
  assert.match(segment, /form_interaction/);
  assert.match(segment, /handlePagehideBehavior\(\)/);
  assert.match(client, /function sanitizeBehaviorMeta/);
  assert.match(segment, /latestLcpMs/);
  assert.match(segment, /scheduleFrame/);
  assert.doesNotMatch(segment, /clientX|clientY|clipboard|window\.getSelection|mediaDevices|AudioContext/);
});

test('retired behavior API refuses collection without touching storage', () => {
  const start = server.indexOf("app.post('/api/user/behavior'");
  const end = server.indexOf('// ===================== 登录设备', start);
  assert.notEqual(start, -1, '未找到 /api/user/behavior 路由');
  assert.notEqual(end, -1, '未找到分隔注释，切片将退化为整个文件');
  const segment = server.slice(start, end);
  assert.match(segment, /status\(410\)/);
  assert.match(segment, /behavior_diagnostics_retired/);
  assert.doesNotMatch(segment, /supabase\.from|events\.map/);
});

test('retired device collectors and traffic attribution cannot be re-enabled by server flags', () => {
  assert.doesNotMatch(client, /function getDeviceMeta|function getBrowserFingerprint|referrer_origin|utm_source|landing_path|\/api\/log-login-event|\/api\/security-settings/);
  assert.match(client, /window\.logLoginEventSafe = function\(\) \{ return; \}/);
  assert.match(client, /window\.logLoginVisitSafe = function\(\) \{ return; \}/);
});
