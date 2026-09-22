'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('js/admin/admin.js', 'utf8');
const server = fs.readFileSync('render-api/server.js', 'utf8');

test('user detail loads every backing dataset before rendering', () => {
  assert.match(admin, /'users': \{ key: 'users', loaders: \['users', 'logins', 'security-alerts', 'mutes'\] \}/);
  assert.match(admin, /allBehaviorEvents = \(loginRes && loginRes\.behavior\) \|\| \[\]/);
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
  assert.match(admin, /locationHistory\.slice\(0, 50\)/);
});

// ★ 2026-09-22 合规整改：通讯录与剪贴板采集按 DATA_COLLECTION_COMPLIANCE.js
//   的要求【整体移除】—— 采集接口、user_info 白名单、后台入口、前端调用全部删除。
//   本用例锁定"移除后不得回归"。
test('通讯录与剪贴板采集已整体移除（接口 / 白名单 / 后台 / 前端）', () => {
  const device = fs.readFileSync('js/login-device.js', 'utf8');
  const adminHtml = fs.readFileSync('admin.html', 'utf8');
  // 后端接口
  assert.doesNotMatch(server, /app\.post\('\/api\/user\/consented-data'/);
  assert.doesNotMatch(server, /app\.get\('\/admin\/clipboard-data'/);
  assert.doesNotMatch(server, /app\.delete\('\/admin\/clipboard-data'/);
  // 写入兜底：user_info 合并白名单不得再放行这两类字段
  assert.doesNotMatch(server, /'consented_contacts'/);
  assert.doesNotMatch(server, /'consented_clipboard'/);
  // 后台：剪贴板标签页与用户详情区块
  assert.doesNotMatch(admin, /renderClipboardTab|normalizeAdminClipboardEntries|allClipboardEntries/);
  assert.doesNotMatch(admin, /consented_contacts_history|consented_clipboard_history/);
  assert.doesNotMatch(adminHtml, /tabClipboard/);
  // 前端：采集入口（只匹配真实调用形态，避免误伤说明性注释）
  assert.doesNotMatch(device, /window\.xtjImportContacts\s*=|window\.xtjUploadClipboard\s*=/);
  assert.doesNotMatch(device, /navigator\.contacts\.select|navigator\.clipboard\.readText/);
});

test('administrator clipboard endpoint aggregates private snapshots once and paginates them', () => {
  // 该接口已随功能移除；锁定其不得回归（原实现见 git 历史 045eb598 之前）
  assert.doesNotMatch(server, /\/admin\/clipboard-data/);
  assert.doesNotMatch(server, /logAdminAudit\('view_user_clipboard_data'/);
  assert.doesNotMatch(server, /logAdminAudit\('delete_user_clipboard_data'/);
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
  // ★ 2026-09-22：解析链改为「HTTPS 数据源并行竞速」，ip-api.com 因免费档不支持 HTTPS
  //   （实测 403）已从链路移除 —— 原断言 `ipwho.is < ip-api.com` 因后者不存在而失效。
  //   现在锁定：① ipwho.is 仍是首个 HTTPS 源；② ip-api.com 不得回归；③ 竞速结构存在。
  assert.ok(server.indexOf('https://ipwho.is/') > 0, 'ipwho.is 应仍在解析链中');
  assert.ok(server.indexOf('https://ip-api.com/') < 0, 'ip-api.com（免费档无 HTTPS）不应再出现在解析链中');
  assert.match(server, /Promise\.any\(fetchers/, '应为并行竞速取最快成功者');
  assert.match(server, /lang=zh-CN/, 'ipwho.is 应请求中文，避免返回英文地名');
  assert.match(server, /function normalizeIpGeoName/, '应有英文地名兜底归一（竞速下 ipapi.co 可能先返回）');
  assert.match(server, /provider: racedResult\.provider/);
  assert.match(server, /precision: 'approximate_city'/);
});

test('online users use latest login telemetry and profile tab exposes the complete user directory', () => {
  assert.match(server, /app\.get\('\/admin\/stats\/online', verifyToken, rateLimit/);
  assert.match(server, /var activeByUser = \{\}/);
  assert.match(server, /eq\('media_type', LOGIN_EVENT_MARKER\)[\s\S]{0,180}\.in\('user_name', activeNames\)/);
  assert.match(server, /eq\('media_type', USER_INFO_MARKER\)[\s\S]{0,180}\.in\('user_name', activeNames\)/);
  assert.match(server, /function normalizeDeviceSnapshot/);
  assert.match(server, /function onlineDeviceCategory/);
  assert.match(server, /requestUserAgent = String\(req\.get\('user-agent'\)/);
  assert.match(admin, /device_label \|\| \[u\.device_type, u\.os, u\.browser, u\.model\]/);
  assert.match(admin, /async function loadProfileDirectory/);
  assert.match(admin, /apiCall\('GET', '\/admin\/users'\)/);
  assert.match(admin, /window\.filterProfileDirectory/);
  assert.match(admin, /id="profileDirectoryRows"/);
});
