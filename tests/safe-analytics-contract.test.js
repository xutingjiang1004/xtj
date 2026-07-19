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
  assert.doesNotMatch(segment, /clientX|clientY|clipboard|window\.getSelection|mediaDevices|AudioContext/);
});

test('behavior API accepts only bounded aggregate metadata', () => {
  const start = server.indexOf("app.post('/api/user/behavior'");
  const end = server.indexOf('// ===================== 登录设备', start);
  const segment = server.slice(start, end);
  assert.match(segment, /scroll_depth/);
  assert.match(segment, /session_summary/);
  assert.match(segment, /web_vital/);
  assert.match(segment, /Math\.min\(120000/);
  assert.doesNotMatch(segment, /selectedText|stack|clipboard_text|contacts/);
});

test('traffic attribution retains only origin, UTM labels, and landing path', () => {
  const meta = client.slice(client.indexOf('function getDeviceMeta()'), client.indexOf('function getBrowserFingerprint'));
  assert.match(meta, /referrer_origin/);
  assert.match(meta, /utm_source/);
  assert.match(meta, /landing_path/);
  assert.doesNotMatch(meta, /searchParams\.get\('email'\)/);
});
