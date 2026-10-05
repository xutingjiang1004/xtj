const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('js/core.js', 'utf8');

test('doLogin uses server-returned user_name, not input-box name', () => {
  // 必须使用 tokenData.user_name 而非 name
  assert.match(core, /tokenData\.user_name/);
  assert.match(core, /var serverUserName = \(tokenData\.user_name/);
  // 不允许直接使用输入框的 name 作为最终身份
  assert.match(core, /serverUserName !== name/);
  assert.match(core, /账号认证状态异常，请重新登录/);
});

test('doRegister uses server-returned user_name, not input-box name', () => {
  assert.match(core, /registerData\.user_name/);
  assert.match(core, /var serverUserName = \(registerData\.user_name/);
  assert.match(core, /serverUserName !== name/);
});

test('refreshUserTokenViaCookie returns token and user_name object', () => {
  assert.match(core, /return \{ token: data\.token, user_name:/);
  assert.match(core, /_lastRefreshUser = serverUserName/);
});

test('ensureUserToken extracts token from refresh result object', () => {
  assert.match(core, /var result = await refreshUserTokenViaCookie/);
  assert.match(core, /return \(result && result\.token\)/);
});

test('restoreCurrentUserFromSession validates with server on startup', () => {
  assert.match(core, /_startupAuthVerified/);
  assert.match(core, /refreshUserTokenViaCookie/);
  assert.match(core, /serverUser !== currentUser/);
  assert.match(core, /clearAllAuthState/);
});

test('clearAllAuthState cleans AI, chat, and profile caches', () => {
  assert.match(core, /xtj_ai_history/);
  assert.match(core, /xtj_profile_cache/);
  assert.match(core, /avatarCache = \{\}/);
});

test('BroadcastChannel multi-tab auth sync exists', () => {
  assert.match(core, /BroadcastChannel\('xtj_auth_sync'\)/);
  assert.match(core, /account_switched/);
  assert.match(core, /__xtjBroadcastAuthChange/);
  assert.match(core, /__xtjBroadcastLogout/);
});

test('ensureProtectedOperationAuth verifies token identity matches UI', () => {
  assert.match(core, /_lastRefreshUser && _lastRefreshUser !== userName/);
  assert.match(core, /identity_mismatch/);
});

test('login success broadcasts to other tabs', () => {
  assert.match(core, /__xtjBroadcastAuthChange\(confirmedUser\)/);
});

test('logout broadcasts to other tabs', () => {
  assert.match(core, /__xtjBroadcastLogout\(/);
});

test('currentUser set from server-confirmed identity, not input box', () => {
  assert.match(core, /var confirmedUser = \(name === ADMIN_NAME\)/);
  assert.match(core, /currentUser = confirmedUser/);
  assert.match(core, /window\._lastKnownUser = currentUser/);
});

test('account switch clears all auth state before new login', () => {
  assert.match(core, /revokeRemote/);
  assert.match(core, /clearAllAuthState/);
});