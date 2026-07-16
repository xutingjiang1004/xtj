const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('js/core.js', 'utf8');
const device = fs.readFileSync('js/login-device.js', 'utf8');
const ai = fs.readFileSync('js/ai-agent.js', 'utf8');

test('login and registration send the user-entered password only to dedicated auth APIs', () => {
  assert.match(core, /fetch\(API_BASE \+ '\/api\/user\/login'[\s\S]*?JSON\.stringify\(\{ user_name: name, password: pw \}\)/);
  assert.match(core, /fetch\(API_BASE \+ '\/api\/user\/register'[\s\S]*?JSON\.stringify\(\{ user_name: name, password: pw \}\)/);
  assert.doesNotMatch(core, /findAuthRecord|hashPasswordWithSalt|verifyPassword|authPasswordHash/);
  assert.doesNotMatch(core, /\.insert\(\[\{[\s\S]{0,200}media_type:\s*AUTH_MARKER/);
});

test('runtime modules never read or send password-equivalent hashes', () => {
  [device, ai].forEach((source) => {
    assert.doesNotMatch(source, /password_hash|xtj_pw_hash|xtj_password_hash/);
  });
  // Core retains removeItem calls solely to purge values left by old clients.
  assert.doesNotMatch(core, /getItem\(['"]xtj_pw_hash|setItem\(['"]xtj_pw_hash/);
  assert.doesNotMatch(core, /password_hash\s*:/);
});

test('access tokens remain in memory and are not persisted in Web Storage', () => {
  assert.match(core, /var memoryUserToken = ''/);
  assert.match(core, /memoryUserToken = String\(token\)/);
  assert.doesNotMatch(core, /(?:localStorage|sessionStorage)\.setItem\(USER_TOKEN_KEY/);
  assert.doesNotMatch(core, /(?:localStorage|sessionStorage)\.getItem\(USER_TOKEN_KEY/);
});

test('device telemetry is token authenticated and can refresh via the shared helper', () => {
  assert.match(device, /window\.ensureUserToken/);
  assert.match(device, /Authorization.*Bearer/);
  assert.match(device, /credentials:\s*'include'/);
});

test('administrator login receives a separate user access session without browser hash storage', () => {
  assert.match(core, /setUserToken\(loginRes\.user_token\)/);
  assert.doesNotMatch(core, /ADMIN_TOKEN_KEY/);
});

test('logout presents the access token before clearing local state', () => {
  assert.match(core, /var tokenForRevocation = getUserToken\(\);[\s\S]*?clearUserToken\(\)/);
  assert.match(core, /logoutHeaders\.Authorization = 'Bearer ' \+ tokenForRevocation/);
});
