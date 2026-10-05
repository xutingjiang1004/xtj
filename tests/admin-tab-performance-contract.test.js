const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('js/admin/admin.js', 'utf8');
const css = fs.readFileSync('css/admin.css', 'utf8');

test('admin tab switch activates and paints loading state before awaiting data', () => {
  const start = source.indexOf('window.switchTab = async function(tab)');
  const end = source.indexOf('window.renderTab = function(tab)', start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(body.indexOf('panel.classList.add(\'active\')') < body.indexOf('await loadTabDataIfNeeded(normalized)'));
  assert.ok(body.indexOf('renderAdminTabLoading(panel, normalized)') < body.indexOf('await loadTabDataIfNeeded(normalized)'));
  assert.doesNotMatch(body, /await markRegisterAlertsRead\(\)/);
});

test('admin data loaders use cache, concurrent request deduplication, and parallel tab dependencies', () => {
  assert.match(source, /if \(adminTabDataLoaded\[dataType\]\) return;/);
  assert.match(source, /if \(adminDataLoadPromises\[dataType\]\) return adminDataLoadPromises\[dataType\];/);
  assert.match(source, /await Promise\.all\(info\.loaders\.map/);
  assert.match(source, /adminTabDataLoaded\.logins = true;/);
  const finalReportsRenderer = source.slice(source.lastIndexOf('renderReportsTab = async function(el)'), source.indexOf('window.handleReportDetail', source.lastIndexOf('renderReportsTab = async function(el)')));
  assert.doesNotMatch(finalReportsRenderer, /await loadReportsData\(\)/);
});

test('admin loading placeholder is stable and reduced-motion safe', () => {
  assert.match(css, /\.admin-tab-loading\s*\{[^}]*min-height:\s*220px/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.skeleton-pulse\s*\{\s*animation:\s*none/);
});
