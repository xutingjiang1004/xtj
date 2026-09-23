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

test('admin login request is bounded by a named timeout, rejects duplicates, and always unlocks its submit button', () => {
  const login = sourceBetween(js, 'window.doAdminLogin = async function()', 'window.confirmLogout = function()');
  assert.match(login, /if \(btn\.disabled\) return;/);
  assert.match(login, /new AbortController\(\)/);
  // ★ P2-23：超时值必须是具名常量，不再散落魔法数
  assert.match(login, /setTimeout\(function\(\) \{ loginAbortController\.abort\(\); \}, ADMIN_LOGIN_TIMEOUT_MS\)/);
  assert.match(js, /var ADMIN_LOGIN_TIMEOUT_MS = 15 \* 1000;/);
  assert.doesNotMatch(login, /abort\(\); \}, \d+\)/);
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

test('report load failures record an error state without clearing the last successful report list', () => {
  const reports = sourceBetween(js, 'window.loadReportsData = async function()', 'window.loadUserVisitStats = async function');
  assert.match(reports, /var data = await apiCall\('GET', '\/admin\/reports'\);/);
  assert.match(reports, /if \(!data \|\| !Array\.isArray\(data\.data\)\) throw new Error/);
  assert.doesNotMatch(reports, /reportsData = \[\]/);
  assert.doesNotMatch(reports, /reportsData\.length = 0/);
  assert.doesNotMatch(reports, /reportsData = data \|\| \[\]/);
  // ★ P2-5：失败只记录错误态并继续上抛，绝不吞异常、绝不覆盖上次成功的数据
  assert.match(reports, /reportsLoading = true;/);
  assert.match(reports, /\} catch \(e\) \{[\s\S]*?reportsLoadError = [\s\S]*?throw e;/);
  assert.match(reports, /\} finally \{[\s\S]*?reportsLoading = false;/);
  // 成功路径才清空错误态并刷新徽标
  assert.match(reports, /reportsLoadError = '';/);
  assert.match(reports, /updateReportBadge\(\);/);
  assert.match(js, /var reportsLoading = false;/);
  assert.match(js, /var reportsLoadError = '';/);
});

test('reports tab separates loading, error and empty states instead of faking an empty list', () => {
  const render = sourceBetween(js, 'window.renderReportsTab = async function(el)', 'window.handleReportDetail = function(id)');
  assert.match(render, /if \(reportsLoading\) \{ renderAdminTabLoading\(el, 'reports'\); return; \}/);
  assert.match(render, /if \(reportsLoadError && !reportsData\.length\)/);
  assert.match(render, /renderAdminTabLoadError\(el, 'reports', reportsLoadError\)/);
  // 失败态必须有可重试入口（沿用后台统一的 refreshAdminTab 重试），且两者都要提前 return
  assert.match(render, /onclick="refreshAdminTab\(\\'reports\\'\)"/);
  const errorBranch = sourceBetween(render, "if (reportsLoadError && !reportsData.length)", "var pending");
  assert.match(errorBranch, /return;/);
  const catchBranch = sourceBetween(render, '} catch (e) {', 'if (reportsLoading)');
  assert.match(catchBranch, /renderAdminTabLoadError\(el, 'reports'/);
  assert.match(catchBranch, /return;/);
  // "暂无举报"只允许出现在失败态判定之后（成功且为空才展示）
  assert.match(render, /if \(!reportsData\.length\) \{\s*h \+= '<div class="empty">暂无举报<\/div>';/);
  assert.ok(render.indexOf('renderAdminTabLoadError(el, \'reports\', reportsLoadError)') < render.indexOf('<div class="empty">暂无举报</div>'));
  // 有旧数据 + 刷新失败：保留旧列表并在顶部提示，不能静默显示成"没有举报"
  assert.match(render, /if \(reportsLoadError\) \{[\s\S]*?最后一次成功获取的举报[\s\S]*?onclick="refreshAdminTab\(\\'reports\\'\)"/);
  assert.doesNotMatch(render, /reportsData = \[\]/);
});

test('report lazy loader and polling reuse the same failure-safe reports path', () => {
  const lazy = sourceBetween(js, "} else if (dataType === 'reports') {", "} else if (dataType === 'mutes') {");
  assert.match(lazy, /await loadReportsData\(\);/);
  assert.doesNotMatch(lazy, /reportsData = reportRes\.data \|\| \[\]/);
  assert.match(lazy, /adminTabDataLoaded\.reports = true;/);
  const poll = sourceBetween(js, '_adminReportPollTimer = setInterval', '}, 30000)');
  assert.match(poll, /await loadReportsData\(\);/);
  // 轮询失败不再完全静默：停留在举报 Tab 时刷新出失败提示与重试入口
  assert.match(poll, /\} catch \(e\) \{[\s\S]*?renderReportsTab\(errEl\)/);
  assert.doesNotMatch(poll, /reportsData = \[\]/);
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
