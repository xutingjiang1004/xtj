const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('publish is authenticated and the server ignores client ownership', () => {
  const client = between(core, 'async function insertPostRecord', 'function insertPublishedPostIntoFeed');
  assert.match(client, /xtjProtectedFetch\('\/api\/post\/create'/);
  assert.doesNotMatch(client, /sb\.from\("posts"\)\.insert/);

  const route = between(server, "app.post('/api/post/create'", "app.post('/api/post/update'");
  assert.match(route, /authenticateUser/);
  assert.match(route, /user_name: req\.userName/);
  assert.match(route, /status\(201\)\.json\(\{\s*ok: true,\s*data: inserted\.data/);
});

test('edit does not accidentally invoke the dedicated pin contract', () => {
  const client = between(core, 'async function updatePostRecord', 'function getRenderableComments');
  const payload = between(client, 'var updatePayload = {', '};');
  assert.match(payload, /post_id: post\.id/);
  assert.match(payload, /content: newContent/);
  assert.match(payload, /visibility: nextVisibility/);
  assert.doesNotMatch(payload, /is_pinned|pinned_at/);
  assert.match(client, /xtjProtectedFetch\('\/api\/post\/update'/);
});

test('all post mutations preserve production UUID identifiers', () => {
  assert.match(server, /function normalizePostId[\s\S]*\[0-9a-f\]\{8\}/);
  for (const endpoint of ['/api/post/update', '/api/post/pin', '/api/post/delete', '/api/post/like', '/api/post/view']) {
    const start = server.indexOf(`app.post('${endpoint}'`);
    assert.notEqual(start, -1, `missing ${endpoint}`);
    const next = server.indexOf('\napp.', start + 10);
    const route = server.slice(start, next < 0 ? server.length : next);
    assert.match(route, /normalizePostId\(/, `${endpoint} must validate a UUID without numeric coercion`);
    assert.doesNotMatch(route, /parseInt\([^\n]*post_id|Number\([^\n]*post_id/);
  }
  assert.match(core, /post_id: normalizedPostId, liked: nextLiked/);
  assert.match(core, /post_id: normalizedPostId, is_pinned: Boolean\(nextPinned\)/);
});

test('like reaches the requested state even before the optional unique migration', () => {
  const route = between(server, "app.post('/api/post/like'", "app.get('/api/stats/snapshot'");
  assert.match(route, /existingLike[\s\S]*maybeSingle/);
  assert.match(route, /if \(!existingLike\.data\)[\s\S]*insert/);
  assert.match(route, /delete\(\)\.eq\('post_id', postId\)\.eq\('user_name', req\.userName\)/);
  assert.doesNotMatch(route, /like_constraint_required/);
});

test('pin has an authenticated service-role compatibility path when RPC is absent', () => {
  const route = between(server, "app.post('/api/post/pin'", "app.post('/api/post/delete'");
  assert.match(route, /authenticateUser/);
  assert.match(route, /migrationMissing/);
  assert.match(route, /clearResult[\s\S]*pinResult/);
  assert.match(route, /unpinResult/);
});
