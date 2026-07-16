const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const device = fs.readFileSync('js/login-device.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const admin = fs.readFileSync('js/admin/admin.js', 'utf8');

test('precise geolocation is user initiated and can be stopped', () => {
  assert.match(html, /id="profileLocationToggle"[^>]+onchange="xtjSetLocationSharing\(this\.checked\)"/);
  assert.match(device, /window\.xtjSetLocationSharing\s*=\s*function/);
  assert.match(device, /navigator\.geolocation\.watchPosition/);
  assert.match(device, /navigator\.geolocation\.clearWatch/);
  assert.match(device, /window\.addEventListener\('pagehide'/);
  assert.match(device, /xtj_location_sharing_enabled/);
  assert.match(device, /window\.confirm\('将打开系统联系人选择器/);
  assert.match(device, /window\.confirm\('剪贴板可能包含敏感信息/);
});

test('location endpoint validates coordinates and stores only the latest fix', () => {
  assert.match(server, /app\.post\('\/api\/user\/location',[\s\S]*?authenticateUser/);
  assert.match(server, /latitude < -90 \|\| latitude > 90/);
  assert.match(server, /longitude < -180 \|\| longitude > 180/);
  assert.match(server, /info\.last_precise_location = preciseLocation/);
  assert.doesNotMatch(server, /precise_location_history/);
  assert.match(server, /geolocation=\(self\)/);
});

test('device telemetry includes bounded network and capability metadata', () => {
  for (const token of ['hardware_concurrency', 'device_memory_gb', 'color_depth', 'effective_type', 'downlink_mbps', 'rtt_ms', 'save_data']) {
    assert.ok(device.includes(token), `missing ${token}`);
  }
  assert.match(server, /if \(ip\.indexOf\('::ffff:'\) === 0\) ip = ip\.slice\(7\)/);
  assert.match(admin, /用户授权定位/);
  assert.match(admin, /openstreetmap\.org/);
  assert.match(server, /app\.post\('\/api\/user\/consented-data'/);
  assert.match(server, /app\.post\('\/api\/user\/behavior'/);
  assert.match(server, /USER_BEHAVIOR_MARKER/);
  assert.match(admin, /用户明确授权的数据/);
  assert.match(admin, /最近用户行为/);
});
