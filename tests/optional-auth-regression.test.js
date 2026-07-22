const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'js', 'admin', 'admin.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start: ${start}`);
  assert.notEqual(to, -1, `missing end: ${end}`);
  return source.slice(from, to);
}

test('admin health check uses apiCall with a separately scoped user access token', () => {
  const health = between(admin, 'async function checkSearchHealth()', 'window.checkSearchHealth = checkSearchHealth');
  const api = between(admin, 'async function apiCall', 'function showToast');
  assert.match(health, /encodeURIComponent\('测试搜索健康'\)/);
  assert.match(health, /apiCall\('GET', '\/api\/agent\/search-health\?q=' \+ query, null, \{ authMode: 'user_access' \}\)/);
  assert.match(health, /finally\s*\{\s*_searchHealthChecking = false/);
  assert.doesNotMatch(health, /fetch\(/);
  assert.match(api, /credentials: 'include'/);
  assert.match(api, /options\.authMode === 'user_access'/);
  assert.match(api, /refreshUserAccessToken\(\)/);
  assert.match(admin, /USER_ACCESS_TOKEN_KEY/);
  assert.match(admin, /sessionStorage\.getItem\(USER_ACCESS_TOKEN_KEY\)/);
});

test('admin verification rejects ordinary user access tokens', () => {
  const verify = between(server, 'async function verifyToken', '// =====================');
  assert.match(verify, /payload\.user === ADMIN_USERNAME && !payload\.type/);
  assert.match(server, /return res\.json\(\{ ok: true, username: ADMIN_USERNAME, user_token:/);
});

test('feed requests attach identity when available but keep anonymous fallback non-interactive', () => {
  const optional = between(core, 'window.xtjOptionalAuthFetch = async function', 'let avatarCache');
  const feed = between(core, 'async function fetchFeedPageChunk', 'function hydrateDeferredFeedRelations');
  const authors = between(core, 'async function loadPostFilterUsers', 'window.selectPostFilterUser');
  assert.match(optional, /ensureUserToken\(\)/);
  assert.match(optional, /headers\.Authorization = 'Bearer ' \+ token/);
  assert.match(optional, /response\.status === 401/);
  assert.match(optional, /refreshUserToken\(true\)/);
  assert.doesNotMatch(optional, /handleProtectedAuthFailure/);
  assert.match(feed, /xtjOptionalAuthFetch\('\/api\/feed\?page='/);
  assert.match(authors, /xtjOptionalAuthFetch\('\/api\/feed\/authors'\)/);
});
