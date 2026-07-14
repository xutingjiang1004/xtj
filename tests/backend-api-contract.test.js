'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

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

test('DM messages uses exact two-way participant filters and after_id', () => {
  const source = routeSource('get', '/api/dm/messages', "app.get('/admin/bans'");
  assert.match(source, /buildDirectionQuery\(req\.userName, targetUser\)/);
  assert.match(source, /buildDirectionQuery\(targetUser, req\.userName\)/);
  assert.match(source, /\.eq\('user_name', sender\)\.eq\('media_url', recipient\)/);
  assert.match(source, /query = query\.gt\('id', afterId\)/);
  assert.match(source, /new Map\(\)/);
  assert.doesNotMatch(source, /\.or\(`/);
});

test('atomic like endpoint validates types and returns authoritative final count', () => {
  const source = routeSource('post', '/api/post/like', "app.get('/api/stats/snapshot'");
  assert.match(source, /authenticateUser/);
  assert.match(source, /typeof rawPostId === 'number' && Number\.isInteger\(rawPostId\)/);
  assert.match(source, /typeof liked !== 'boolean'/);
  assert.match(source, /upsert\([\s\S]*onConflict: 'post_id,user_name'/);
  assert.match(source, /String\(likeError\.code \|\| ''\) !== '23505'/);
  assert.match(source, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(source, /post_id: postId, liked: liked, like_count:/);
});

test('statistics snapshot is authenticated and excludes system markers from feed posts', () => {
  const source = routeSource('get', '/api/stats/snapshot', "app.get('/api/photos/wall/");
  assert.match(source, /authenticateUser/);
  assert.match(source, /applyPublicPostExclusions\(supabase\.from\('posts'\)/);
  assert.match(source, /\.eq\('media_type', VISIT_MARKER\)/);
  assert.match(source, /post\.visibility === 'public' \|\| post\.user_name === req\.userName/);
  assert.match(source, /view_events: viewEvents/);
  assert.match(source, /totals:/);
});

test('pin endpoint rejects coerced ids and reports readable validation codes', () => {
  const source = routeSource('post', '/api/post/pin', "app.post('/api/post/delete'");
  assert.match(source, /typeof rawPostId === 'number' && Number\.isInteger\(rawPostId\)/);
  assert.match(source, /code: 'invalid_post_id'/);
  assert.match(source, /typeof isPinned !== 'boolean'/);
  assert.match(source, /code: 'invalid_pin_state'/);
});
