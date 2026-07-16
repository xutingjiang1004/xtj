'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
const likeMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '009_atomic_post_like.sql'), 'utf8');
const pinUuidMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '010_fix_post_pin_uuid.sql'), 'utf8');

function routeSource(method, route, nextRoute) {
  const startToken = `app.${method}('${route}'`;
  const start = server.indexOf(startToken);
  assert.notEqual(start, -1, `missing ${method.toUpperCase()} ${route}`);
  const end = nextRoute ? server.indexOf(nextRoute, start + startToken.length) : server.length;
  assert.ok(end > start, `could not isolate ${route}`);
  return server.slice(start, end);
}

test('DM list queries both sender and recipient fields and merges by message id', () => {
  const source = routeSource('get', '/api/dm/list', "app.get('/api/dm/messages'");
  assert.match(source, /\.eq\('user_name', req\.userName\)/);
  assert.match(source, /\.eq\('media_url', req\.userName\)/);
  assert.match(source, /new Map\(\)/);
  assert.match(source, /created_at[\s\S]*localeCompare/);
  assert.doesNotMatch(source, /actor_key', 'dm_/);
});

test('DM messages uses exact two-way participant filters and UUID-safe ordering', () => {
  const source = routeSource('get', '/api/dm/messages', "app.post('/api/dm/read'");
  assert.match(source, /buildDirectionQuery\(req\.userName, targetUser\)/);
  assert.match(source, /buildDirectionQuery\(targetUser, req\.userName\)/);
  assert.match(source, /\.eq\('user_name', sender\)\.eq\('media_url', recipient\)/);
  assert.match(source, /order\('created_at', \{ ascending: true \}\)/);
  assert.doesNotMatch(source, /parseInt\(req\.query\.after_id|\.gt\('id'/);
  assert.match(source, /new Map\(\)/);
  assert.doesNotMatch(source, /\.or\(`/);
});

test('DM read state is authenticated, recipient-scoped, and returned authoritatively', () => {
  const source = routeSource('post', '/api/dm/read', "app.get('/admin/bans'");
  assert.match(source, /authenticateUser/);
  assert.match(source, /\.eq\('media_type', DM_MARKER\)/);
  assert.match(source, /\.eq\('media_url', req\.userName\)/);
  assert.match(source, /payload\.read_at = now/);
  assert.match(source, /partial: failedIds\.length > 0/);
  assert.match(source, /data: updated/);
});

test('report notifications use authenticated server identity and do not hide mark-read failures', () => {
  const listSource = routeSource('get', '/api/report/notifications', "app.post('/api/report/notifications/mark-read'");
  const markSource = routeSource('post', '/api/report/notifications/mark-read', "app.get('/admin/photos'");
  assert.match(listSource, /authenticateUser/);
  assert.match(listSource, /const userName = req\.userName/);
  assert.doesNotMatch(listSource, /req\.query\.user|req\.body\.user/);
  assert.match(markSource, /authenticateUser/);
  assert.match(markSource, /\.eq\('user_name', userName\)/);
  assert.match(markSource, /if \(updateResult\.error\) failed\+\+/);
  assert.match(markSource, /res\.status\(500\)[\s\S]*report_mark_read_partial/);
});

test('report notification UI uses protected fetch without anon Supabase fallback', () => {
  const start = core.indexOf('async function checkReportReplies()');
  const end = core.indexOf('let refreshTimeout = null;', start);
  assert.ok(start >= 0 && end > start);
  const source = core.slice(start, end);
  assert.match(source, /xtjProtectedFetch\('\/api\/report\/notifications'\)/);
  assert.match(source, /xtjProtectedFetch\('\/api\/report\/notifications\/mark-read'/);
  assert.doesNotMatch(source, /sb\.from\('posts'\)/);
  assert.doesNotMatch(source, /fetch\(API_BASE \+ '\/api\/report\/notifications/);
  assert.match(source, /if \(!response\.ok\) throw new Error\('report_mark_read_failed'\)/);
});

test('atomic like endpoint validates types and returns authoritative final count', () => {
  const source = routeSource('post', '/api/post/like', "app.get('/api/stats/snapshot'");
  assert.match(source, /authenticateUser/);
  assert.match(source, /normalizePostId\(rawPostId\)/);
  assert.match(source, /typeof liked !== 'boolean'/);
  assert.match(source, /existingLike[\s\S]*\.eq\('post_id', postId\)[\s\S]*\.eq\('user_name', req\.userName\)/);
  assert.match(source, /if \(!existingLike\.data\)[\s\S]*\.insert\(/);
  assert.match(source, /String\(likeError\.code \|\| ''\) !== '23505'/);
  assert.match(source, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(source, /post_id: postId, liked: liked, like_count:/);
});

test('atomic like migration cleans legacy duplicates and enforces one user like per post', () => {
  assert.match(likeMigration, /DELETE FROM public\.likes AS older/);
  assert.match(likeMigration, /CREATE UNIQUE INDEX IF NOT EXISTS likes_one_user_per_post/);
  assert.match(likeMigration, /\(post_id, user_name\)/);
});

test('statistics snapshot is authenticated and excludes system markers from feed posts', () => {
  const source = routeSource('get', '/api/stats/snapshot', "app.get('/api/photos/wall/");
  assert.match(source, /authenticateUser/);
  assert.match(source, /applyPublicPostExclusions\(supabase\.from\('posts'\)/);
  assert.match(source, /\.eq\('media_type', POST_VIEW_MARKER\)/);
  assert.match(source, /post\.visibility === 'public' \|\| post\.user_name === req\.userName/);
  assert.match(source, /view_events: viewEvents/);
  assert.match(source, /totals:/);
});

test('pin endpoint requires UUID ids and reports readable validation codes', () => {
  const source = routeSource('post', '/api/post/pin', "app.post('/api/post/delete'");
  assert.match(source, /normalizePostId\(rawPostId\)/);
  assert.match(source, /code: 'invalid_post_id'/);
  assert.match(source, /typeof isPinned !== 'boolean'/);
  assert.match(source, /code: 'invalid_pin_state'/);
});

test('deployed pin migration replaces the invalid bigint RPC with a service-role UUID RPC', () => {
  assert.match(pinUuidMigration, /DROP FUNCTION IF EXISTS public\.set_post_pin\(BIGINT/);
  assert.match(pinUuidMigration, /p_post_id UUID/);
  assert.match(pinUuidMigration, /v_unpinned_ids UUID\[\]/);
  assert.match(pinUuidMigration, /GRANT EXECUTE[\s\S]*TO service_role/);
});
