'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('admin.html', 'utf8');
const js = fs.readFileSync('js/admin/admin.js', 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `source section exists: ${start}`);
  return source.slice(startIndex, endIndex);
}

test('admin login request is bounded, rejects duplicates, and always unlocks its submit button', () => {
  const login = sourceBetween(js, 'window.doAdminLogin = async function()', 'window.confirmLogout = function()');
  assert.match(login, /if \(btn\.disabled\) return;/);
  assert.match(login, /new AbortController\(\)/);
  assert.match(login, /setTimeout\(function\(\) \{ loginAbortController\.abort\(\); \}, 20000\)/);
  assert.match(login, /signal: loginAbortController\.signal/);
  assert.match(login, /finally\s*\{\s*clearTimeout\(loginTimeout\);\s*btn\.disabled = false;\s*btn\.textContent = '登录';/);
  assert.match(html, /id="loginErr" role="alert" aria-live="assertive"/);
});

test('loadAllData timeout invalidates and aborts stale requests before they can commit', () => {
  const loader = sourceBetween(js, 'async function loadAllData(keepTab)', 'async function loadTabDataIfNeeded(tab)');
  assert.match(loader, /var generation = \+\+_allDataLoadGeneration/);
  assert.match(loader, /var controller = new AbortController\(\)/);
  assert.match(loader, /_allDataLoadGeneration\+\+;[\s\S]*?controller\.abort\(\)/);
  assert.match(loader, /apiCall\('GET', '\/admin\/data', null, \{ signal: controller\.signal \}\)/);
  assert.match(loader, /if \(generation !== _allDataLoadGeneration\) return;/);
  assert.match(js, /if \(_allDataAbortController\) \{\s*_allDataAbortController\.abort\(\);/);
  const api = sourceBetween(js, 'async function apiCall(method, path, body, options)', 'function showToast');
  assert.match(api, /externalSignal\.addEventListener\('abort', forwardAbort/);
});

test('report load failures propagate without clearing the last successful report list', () => {
  const reports = sourceBetween(js, 'window.loadReportsData = async function()', 'window.loadUserVisitStats = async function');
  assert.match(reports, /var data = await apiCall\('GET', '\/admin\/reports'\);/);
  assert.match(reports, /if \(!data \|\| !Array\.isArray\(data\.data\)\) throw new Error/);
  assert.doesNotMatch(reports, /catch\s*\(/);
  assert.doesNotMatch(reports, /reportsData = \[\];/);
});

test('admin tabs expose tab semantics, keyboard navigation, and active selection', () => {
  assert.match(html, /role="tablist" aria-label="管理后台功能"/);
  assert.match(html, /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="tabAnn"[^>]*id="tabAnnBtn"/);
  assert.match(html, /id="tabAnn" role="tabpanel" aria-labelledby="tabAnnBtn"/);
  assert.match(js, /e\.key === 'ArrowRight' \|\| e\.key === 'ArrowDown'/);
  assert.match(js, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowUp'/);
  assert.match(js, /syncAdminTabSemantics\(normalized\)/);
  assert.match(js, /button\.setAttribute\('aria-selected', tab === selectedTab \? 'true' : 'false'\)/);
});

test('confirmation modal supports accessible naming, escape, focus restoration, and retry alerts', () => {
  assert.match(html, /id="confirmModal" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMsg" aria-hidden="true"/);
  assert.match(js, /_modal\.setAttribute\('aria-hidden', 'false'\)/);
  assert.match(js, /_okBtn\.focus\(\)/);
  assert.match(js, /if \(e\.key === 'Escape'\)[\s\S]*?window\.closeConfirm\(\)/);
  assert.match(js, /restoreConfirmFocus\(\)/);
  assert.match(js, /role="alert" aria-live="assertive"/);
  assert.match(js, /onclick="refreshAdminTab\(/);
});
