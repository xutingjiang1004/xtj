const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('js/core.js', 'utf8');
const device = fs.readFileSync('js/login-device.js', 'utf8');
const ai = fs.readFileSync('js/ai-agent.js', 'utf8');

test('login and registration send the user-entered password only to dedicated auth APIs', () => {
  // M48：登录请求走带超时的 fetchWithTimeout（密码仍只发往专属认证接口）
  // ★ 2026-09-22：新增 device_id（30 天本机免登录的设备锚点），请求体可携带可选 device_id。
  assert.match(core, /fetch(?:WithTimeout)?\(API_BASE \+ '\/api\/user\/login'[\s\S]*?JSON\.stringify\(\{ user_name: name, password: pw(?:, device_id:[^}]*)? \}\)/);
  // 注册可附带可选 email（后端校验格式并原子写入 user_info），密码仅发往注册接口
  assert.match(core, /fetch(?:WithTimeout)?\(API_BASE \+ '\/api\/user\/register'[\s\S]*?JSON\.stringify\(\{ user_name: name, password: pw, email: email \|\| undefined(?:, device_id:[^}]*)? \}\)/);
  // 设备识别必须真正随登录/注册发出（否则 30 天免登录无法落地）
  assert.match(core, /JSON\.stringify\(\{ user_name: name, password: pw, device_id:/);
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
  assert.match(core, /setUserToken\(loginRes\.user_token, name\)/);
  assert.doesNotMatch(core, /ADMIN_TOKEN_KEY/);
});

test('logout presents the access token before clearing local state', () => {
  assert.match(core, /var tokenForRevocation = getUserToken\(\);[\s\S]*?clearUserToken\(\)/);
  assert.match(core, /logoutHeaders\.Authorization = 'Bearer ' \+ tokenForRevocation/);
});

test('a refresh response arriving after explicit logout cannot restore the previous token', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync('js/core-parts/01-bootstrap.js','utf8');
  const start = source.indexOf('            var _authStateEpoch = 0;');
  const end = source.indexOf('            /**', start);
  let deliver, saved = '';
  const sandbox = {
    window: {}, API_BASE: '', getXtjDeviceId: () => 'test-device',
    fetch: () => new Promise(resolve => {deliver = resolve;}),
    setUserToken: token => {saved = token;},
    Date, Promise, setTimeout, clearTimeout,
    _lastRefreshAuthResult: {}, _lastRefreshUser: ''
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start,end),sandbox);
  const pending = sandbox.refreshUserTokenViaCookie();
  await Promise.resolve();
  vm.runInContext('_authStateEpoch++;',sandbox);
  deliver({ok:true,status:200,json:async()=>({token:'previous-token',user_name:'previous-user'})});
  const result = await pending;
  assert.equal(result.token,'');
  assert.equal(saved,'');
});
