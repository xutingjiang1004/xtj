'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const core = fs.readFileSync('js/core.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/012_harden_pro_claim_and_interactions.sql', 'utf8');

function routeBlock(start, end) {
  const from = server.indexOf(start);
  const to = server.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.ok(to > from, `missing end marker ${end}`);
  return server.slice(from, to);
}

test('legacy caller-controlled Pro RPC overloads are removed', () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.claim_pro_gift\(TEXT, TEXT\)/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.claim_pro_gift\(TEXT, TEXT, TEXT, TEXT, TEXT\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_pro_gift_for_user\(TEXT, UUID\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_pro_gift_for_user\(TEXT, UUID\) TO service_role/);
});

test('Pro claim uses UUID from HTTP boundary through database lookup', () => {
  const route = routeBlock("app.post('/api/pro-gifts/claim'", "app.post('/admin/pro-gifts/manual-gift'");
  assert.match(route, /authenticateUser/);
  assert.match(route, /normalizePostId\(giftId\)/);
  assert.match(route, /rpc\('claim_pro_gift_for_user'/);
  assert.doesNotMatch(route, /\^\\d\+\$/);
  assert.match(migration, /p_gift_id UUID/);
  assert.match(migration, /WHERE id = p_gift_id AND media_type = '__pro_gift__'/);
  assert.doesNotMatch(migration, /p_gift_id::bigint/);
});

test('anonymous likes and comments cannot impersonate a username', () => {
  for (const table of ['likes', 'comments']) {
    assert.match(migration, new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table} FROM PUBLIC, anon, authenticated`));
    assert.match(migration, new RegExp(`DROP POLICY IF EXISTS anon_${table}_insert`));
  }
});

test('comment writes derive identity from the authenticated server session', () => {
  const create = routeBlock("app.post('/api/post/comment'", "app.delete('/api/post/comment/:commentId'");
  assert.match(create, /authenticateUser/);
  assert.match(create, /user_name: req\.userName/);
  assert.doesNotMatch(create, /req\.body\.user_name/);

  const remove = routeBlock("app.delete('/api/post/comment/:commentId'", '// Set the authenticated user');
  assert.match(remove, /existing\.data\.user_name !== req\.userName/);
  assert.match(core, /xtjProtectedFetch\('\/api\/post\/comment'/);
  assert.doesNotMatch(core, /sb\.from\(["']comments["']\)\.insert/);
});

test('profile interactions use protected APIs instead of anonymous Data API writes', () => {
  assert.match(core, /xtjProtectedFetch\('\/api\/likes\/user\/'/);
  assert.match(core, /xtjProtectedFetch\('\/api\/comments\/user\/'/);
  assert.doesNotMatch(core, /sb\.from\(["']likes["']\)\.(?:insert|update|delete)/);
  assert.doesNotMatch(core, /sb\.from\(["']comments["']\)\.(?:insert|update|delete)/);
});
