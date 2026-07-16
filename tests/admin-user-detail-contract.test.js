'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('js/admin/admin.js', 'utf8');
const server = fs.readFileSync('render-api/server.js', 'utf8');

test('user detail loads every backing dataset before rendering', () => {
  assert.match(admin, /'users': \{ key: 'users', loaders: \['users', 'logins', 'security-alerts', 'mutes'\] \}/);
  assert.match(admin, /allBehaviorEvents = loginRes\.behavior \|\| \[\]/);
  assert.match(admin, /window\.showUserDetailModal = async function/);
  assert.match(admin, /\/admin\/user-data\?user_name=/);
  assert.match(server, /app\.get\('\/admin\/user-data', verifyToken/);
  assert.match(server, /logAdminAudit\('view_user_sensitive_data'/);
});

test('user detail exposes collected device and network metadata safely', () => {
  for (const token of ['latestDeviceMeta.network', 'screen_width', 'device_pixel_ratio', 'language', 'timezone', 'hardware_concurrency', 'device_memory_gb', 'user_agent']) assert.ok(admin.includes(token), `missing ${token}`);
  assert.match(admin, /escapeHtml\(networkText\)/);
  assert.match(admin, /escapeHtml\(String\(latestDeviceMeta\.user_agent/);
});

test('consented location and contacts remain in user detail while clipboard has its own tab', () => {
  assert.match(server, /precise_location_history[\s\S]{0,240}slice\(-100\)/);
  assert.match(server, /consented_contacts_history[\s\S]{0,220}slice\(-20\)/);
  assert.match(server, /consented_clipboard_history[\s\S]{0,220}slice\(-20\)/);
  assert.match(admin, /locationHistory\.slice\(0, 50\)/);
  assert.match(admin, /contactsHistory\.slice\(0, 20\)/);
  assert.match(admin, /function normalizeAdminClipboardEntries/);
  assert.match(admin, /function renderClipboardTab/);
  assert.match(admin, /\/admin\/clipboard-data\?page=/);
  assert.match(admin, /escapeHtml\(entry\.text\.slice\(0, 10000\)\)/);
});

test('administrator clipboard endpoint aggregates private snapshots once and paginates them', () => {
  assert.match(server, /app\.get\('\/admin\/clipboard-data', verifyToken, rateLimit/);
  assert.match(server, /fetchAllPostsByMediaType\(USER_INFO_MARKER, 'user_name, content, created_at'\)/);
  assert.match(server, /consented_clipboard_history/);
  assert.match(server, /var seenSnapshots = new Set\(\)/);
  assert.match(server, /if \(seenSnapshots\.has\(snapshotKey\)\) return/);
  assert.match(server, /snapshots\.slice\(offset, offset \+ limit\)/);
  assert.match(server, /return res\.json\(\{ data: data, total: total, page: page, limit: limit, pages:/);
  assert.match(server, /logAdminAudit\('view_user_clipboard_data'/);
});

test('reverse geocode result is merged into its matching page load only', () => {
  assert.match(server, /async function mergeResolvedPreciseLocation/);
  assert.match(server, /item\.page_load_id !== pageLoadId/);
  assert.match(server, /lastLocation\.page_load_id === pageLoadId/);
  assert.doesNotMatch(server, /if \(existing\.data\) \{\s*info\.last_precise_location = preciseLocation/);
});

test('IP geolocation prefers TLS providers and de-duplicates repeated lookups', () => {
  assert.match(server, /const ipLocationCache = new Map\(\)/);
  assert.match(server, /const ipLocationInflight = new Map\(\)/);
  assert.match(server, /if \(ipLocationInflight\.has\(normalizedIp\)\) return ipLocationInflight\.get\(normalizedIp\)/);
  assert.ok(server.indexOf("https://ipwho.is/") < server.indexOf("http://ip-api.com/"));
  assert.match(server, /provider: result\.provider/);
  assert.match(server, /precision: 'approximate_city'/);
});
