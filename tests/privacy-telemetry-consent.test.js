const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'login-device.js'), 'utf8');

function section(start, end) {
  const from = client.indexOf(start);
  const to = client.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return client.slice(from, to);
}

test('behavior telemetry is fail-closed when no explicit consent control exists', () => {
  assert.match(client, /var behaviorTelemetryEnabled = false;/);
  assert.match(client, /if \(!behaviorTelemetryEnabled\) return;[\s\S]*?behaviorQueue\.push\(/);
  assert.match(client, /if \(behaviorTelemetryEnabled\) initSafeAnalytics\(\);/);
  assert.match(client, /if \(behaviorTelemetryEnabled\) \{\s*document\.addEventListener\('change'/);

  const listeners = section('if (behaviorTelemetryEnabled) {\n    // 全局行为追踪', '// 自动后台触发定位');
  assert.match(listeners, /document\.addEventListener\('click'/);
  assert.match(listeners, /document\.addEventListener\('visibilitychange'/);
  assert.match(listeners, /window\.addEventListener\('pageshow'/);
  assert.match(listeners, /document\.addEventListener\('scroll'/);
});

test('legacy queued behavior is deleted, never restored or sent by lifecycle hooks', () => {
  const restore = section('function restorePendingBehavior()', '// Aggregated diagnostics');
  assert.match(restore, /safeStorage\.remove\('xtj_pending_behavior'\)/);
  assert.match(restore, /if \(!behaviorTelemetryEnabled\) return;/);

  const flush = section('async function flushBehavior()', 'function removeSentBehaviors');
  assert.match(flush, /if \(!behaviorTelemetryEnabled\)[\s\S]*?behaviorQueue\.length = 0;[\s\S]*?return;/);
  const pagehide = section('function handlePagehideBehavior()', '// 页面加载时恢复上次未发送的行为');
  assert.match(pagehide, /if \(!behaviorTelemetryEnabled\)[\s\S]*?safeStorage\.remove\('xtj_pending_behavior'\)[\s\S]*?return;/);
});

test('behavior-consent change does not disable explicit GPS consent or client-error reporting', () => {
  assert.match(client, /xtj_location_sharing_enabled/);
  assert.match(client, /function sendClientError\(/);
  assert.match(client, /xhr\.open\('POST', API_BASE \+ '\/api\/client-error-log'/);
});
