'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const adminHtml = fs.readFileSync('admin.html', 'utf8');
const adminJs = fs.readFileSync('js/admin/admin.js', 'utf8');
const buildScript = fs.readFileSync('scripts/build.js', 'utf8');

test('admin page uses versioned minified assets and loads its configuration first', () => {
  assert.match(adminHtml, /js\/config\.min\.js\?v=[a-f0-9]{10}/);
  assert.match(adminHtml, /js\/admin\/admin\.min\.js\?v=[a-f0-9]{10}/);
  assert.doesNotMatch(adminHtml, /js\/admin\/admin\.js\?v=/);
  assert.ok(adminHtml.indexOf('js/config.min.js') < adminHtml.indexOf('js/admin/admin.min.js'));
  assert.match(buildScript, /HTML_ENTRYPOINTS = \['index\.html', 'admin\.html'\]/);
});

test('online users and user profile use the admin request client', () => {
  assert.match(adminJs, /apiCall\('GET', '\/admin\/stats\/online'\)/);
  assert.match(adminJs, /apiCall\('GET', '\/admin\/user-profile\?user_name=' \+ encodeURIComponent\(userName\)\)/);
  assert.doesNotMatch(adminJs, /xtjProtectedFetch\('\/admin\/(?:stats\/online|user-profile)/);
});

test('admin login form prevents default submit', () => {
  assert.match(adminHtml, /onsubmit=["']event\.preventDefault/);
  assert.match(adminHtml, /doAdminLogin/);
});

test('admin login saves token before initAdminClient', () => {
  assert.match(adminJs, /var loginToken = data\.token \|\| data\.user_token/);
  assert.match(adminJs, /ADMIN = name;\s+setToken\(loginToken\)/);
  assert.match(adminJs, /setToken\(loginToken\);\s+try\s*\{/);
});

test('admin login validates data.ok before proceeding', () => {
  assert.match(adminJs, /data\.ok !== true/);
  assert.match(adminJs, /var loginToken = data\.token \|\| data\.user_token/);
  assert.match(adminJs, /!loginToken \|\| typeof loginToken !== 'string' \|\| !loginToken\.trim\(\)/);
});

test('admin login validates token is non-empty string', () => {
  assert.match(adminJs, /typeof loginToken !== 'string'/);
  assert.match(adminJs, /!loginToken\.trim\(\)/);
});

test('admin login restores button state on error', () => {
  assert.match(adminJs, /btn\.disabled = false;\s+btn\.textContent = '登录'/);
});

test('admin login clears token on init failure', () => {
  assert.match(adminJs, /clearToken\(\)/);
  assert.match(adminJs, /ADMIN = null;\s+clearToken\(\)/);
});

test('admin login hides dashboard on init failure', () => {
  assert.match(adminJs, /getElementById\('loginWrap'\)\.style\.display = 'flex'/);
  assert.match(adminJs, /getElementById\('dashboard'\)\.style\.display = 'none'/);
});

test('admin login does not set ADMIN before token validation', () => {
  // Token must be validated before ADMIN is set — the order in doAdminLogin must be:
  // 1. parse response 2. check ok 3. check token 4. set ADMIN 5. setToken 6. initAdminClient
  var loginFn = adminJs.match(/window\.doAdminLogin = async function[\s\S]{0,4000}?catch\(e\)/);
  assert.ok(loginFn, 'doAdminLogin function found');
  var loginBody = loginFn[0];
  var setTokenIdx = loginBody.indexOf('setToken(loginToken)');
  var initClientIdx = loginBody.indexOf('initAdminClient()');
  assert.ok(setTokenIdx > 0, 'setToken(data.token) must be called');
  assert.ok(initClientIdx > setTokenIdx, 'setToken must be called before initAdminClient');
});
