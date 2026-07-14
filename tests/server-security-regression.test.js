const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('render-api/server.js', 'utf8');
const authMigration = fs.readFileSync('supabase/migrations/011_auth_record_uniqueness.sql', 'utf8');

function routeBlock(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('protected user middleware accepts tokens only and rejects body credential fallback', () => {
  const block = routeBlock('async function authenticateUser', '// 用户登录/获取 token');
  assert.doesNotMatch(block, /body\.password_hash|body\.reporter_name|eq\('media_url'/);
  assert.match(block, /verifyUserAccessToken/);
  assert.match(block, /isTokenRevoked\(token\)/);
  assert.match(block, /code: 'auth_expired'/);
});

test('stored auth credentials use scrypt and legacy records upgrade atomically', () => {
  assert.match(source, /AUTH_VERIFIER_PREFIX = 'scrypt:v1:'/);
  assert.match(source, /crypto\.scrypt/);
  const login = routeBlock("app.post('/api/user/login'", '// 刷新用户 access token');
  assert.match(login, /verifyAuthPassword/);
  assert.match(login, /var \{ user_name, password \} = req\.body/);
  assert.doesNotMatch(login, /password_hash/);
  assert.match(login, /update\(\{ media_url: verifier \}\)/);
  assert.match(login, /eq\('media_url', authRec\.media_url\)/);
});

test('registration stores only a server-derived scrypt verifier', () => {
  const register = routeBlock("app.post('/api/user/register'", '// 刷新用户 access token');
  assert.match(register, /deriveAuthVerifier\(password\)/);
  assert.match(register, /media_url: verifier/);
  assert.doesNotMatch(register, /password_hash/);
});

test('authentication migration deduplicates before enforcing one record per user', () => {
  assert.match(authMigration, /DELETE FROM public\.posts AS older[\s\S]*older\.media_type = '__auth__'/);
  assert.match(authMigration, /CREATE UNIQUE INDEX IF NOT EXISTS posts_one_auth_record_per_user/);
  assert.match(authMigration, /ON public\.posts \(user_name\)[\s\S]*WHERE media_type = '__auth__'/);
});

test('access tokens have jti and logout persistently revokes the presented token', () => {
  assert.match(source, /type: 'user_access', jti: crypto\.randomUUID\(\)/);
  const logout = routeBlock("app.post('/api/user/logout'", '// 验证 token 是否有效');
  assert.match(logout, /_getTokenFromRequest\(req\)/);
  assert.match(logout, /persistRevokedToken\(accessToken, accessPayload\.exp\)/);
  assert.match(logout, /status\(503\)/);
});

test('admin and user auth wait for persistent revocation state before accepting requests', () => {
  assert.match(source, /revokedTokenHashesReadyPromise/);
  assert.match(source, /async function waitForRevocationState/);
  assert.match(source, /async function verifyToken[\s\S]*?await waitForRevocationState/);
  assert.match(source, /async function authenticateUser[\s\S]*?await waitForRevocationState/);
});

test('admin conversation rejects LIKE wildcard identifiers before query construction', () => {
  const block = routeBlock("app.get('/admin/ai-agent/conversation'", "console.log(`[xtj-admin-api]");
  assert.match(block, /convId !== 'legacy' && !\/\^\[A-Z0-9\\-\]\{6,\}\$\/i\.test\(convId\)/);
  assert.match(block, /filter\('actor_key', 'like', 'ai_msg_conv_' \+ convId \+ '_%'\)/);
});

test('admin type filters are constrained before Supabase equality filters', () => {
  assert.match(source, /var alertType = validateString\(req\.query\.type, 50, '提醒类型'\)/);
  assert.match(source, /var logType = validateString\(req\.query\.type, 50, '日志类型'\)/);
  assert.match(source, /!\/\^\[a-z0-9_\\-\]\+\$\/i\.test\(alertType\)/);
  assert.match(source, /!\/\^\[a-z0-9_\\-\]\+\$\/i\.test\(logType\)/);
});
