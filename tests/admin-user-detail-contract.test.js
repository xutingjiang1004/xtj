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

test('consented location contacts and clipboard retain bounded history', () => {
  assert.match(server, /precise_location_history[\s\S]{0,240}slice\(-100\)/);
  assert.match(server, /consented_contacts_history[\s\S]{0,220}slice\(-20\)/);
  assert.match(server, /consented_clipboard_history[\s\S]{0,220}slice\(-20\)/);
  assert.match(admin, /locationHistory\.slice\(0, 50\)/);
  assert.match(admin, /contactsHistory\.slice\(0, 20\)/);
  assert.match(admin, /clipboardHistory\.slice\(0, 20\)/);
  assert.match(admin, /escapeHtml\(String\(snapshot\.text\)\.slice\(0, 10000\)\)/);
});
