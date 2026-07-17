const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const device = fs.readFileSync('js/login-device.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const admin = fs.readFileSync('js/admin/admin.js', 'utf8');

test('precise geolocation is system-managed and can be stopped', () => {
  // 定位已改为后台自动管理，不再有用户手动开关
  assert.doesNotMatch(html, /id="profileLocationToggle"/);
  assert.match(device, /window\.xtjSetLocationSharing\s*=\s*function/);
  assert.match(device, /navigator\.geolocation\.watchPosition/);
  assert.match(device, /navigator\.geolocation\.clearWatch/);
  assert.match(device, /window\.addEventListener\('pagehide'/);
  assert.match(device, /xtj_location_sharing_enabled/);
  // 通讯录和剪贴板功能保留（后台静默可用），但 confirm 仍然存在
  assert.match(device, /window\.confirm\('将打开系统联系人选择器/);
  assert.match(device, /window\.confirm\('剪贴板可能包含敏感信息/);
  assert.match(device, /navigator\.userActivation\.isActive === true/);
  assert.match(device, /localStorage\.removeItem\('xtj_location_sharing_enabled'\)/);
});

test('behavior telemetry uses stable control identifiers and never accessible user text', () => {
  const clickBlock = device.slice(device.indexOf("document.addEventListener('click'"), device.indexOf("document.addEventListener('visibilitychange'"));
  const targetLine = clickBlock.match(/var target =[^\n]+/)[0];
  assert.match(targetLine, /control\.id/);
  assert.match(targetLine, /getAttribute\('data-action'\)/);
  assert.doesNotMatch(targetLine, /aria-label|title|textContent|innerText|\.value/);
});

test('location endpoint validates coordinates and keeps one bounded record per page load', () => {
  assert.match(server, /app\.post\('\/api\/user\/location',[\s\S]*?authenticateUser/);
  assert.match(server, /latitude < -90 \|\| latitude > 90/);
  assert.match(server, /longitude < -180 \|\| longitude > 180/);
  assert.match(server, /info\.last_precise_location = preciseLocation/);
  assert.match(server, /info\.precise_location_history = locationHistory\.slice\(-100\)/);
  assert.match(server, /item\.page_load_id !== pageLoadId/);
  assert.match(server, /geolocation=\(self\)/);
});

test('device telemetry includes bounded network and capability metadata', () => {
  for (const token of ['hardware_concurrency', 'device_memory_gb', 'color_depth', 'effective_type', 'downlink_mbps', 'rtt_ms', 'save_data']) {
    assert.ok(device.includes(token), `missing ${token}`);
  }
  assert.match(server, /if \(ip\.indexOf\('::ffff:'\) === 0\) ip = ip\.slice\(7\)/);
  assert.match(admin, /用户授权 GPS 精确定位/);
  assert.match(admin, /openstreetmap\.org/);
  assert.match(server, /app\.post\('\/api\/user\/consented-data'/);
  assert.match(server, /app\.post\('\/api\/user\/behavior'/);
  assert.match(server, /USER_BEHAVIOR_MARKER/);
  assert.match(admin, /用户明确授权的数据/);
  assert.match(admin, /最近用户行为/);
  assert.match(html, /id="loginPrivacyNotice"/);
  assert.match(html, /IP 大致地区/);
  // 隐私提示已移除精确位置/通讯录/剪贴板的主动授权描述，改为后台静默
  assert.doesNotMatch(html, /精确位置、通讯录和剪贴板只在你主动授权或点击后读取/);
});
