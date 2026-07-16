'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/014_atomic_user_info_merge.sql', 'utf8');
const privacyMigration = fs.readFileSync('supabase/migrations/015_lock_private_post_markers.sql', 'utf8');

test('private user info has one row and a service-role-only atomic merge', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS posts_one_user_info_per_user/);
  assert.match(migration, /WHERE media_type = '__user_info__'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.merge_user_info/);
  assert.match(migration, /ON CONFLICT \(user_name\) WHERE media_type = '__user_info__'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.merge_user_info\(TEXT, JSONB\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.merge_user_info\(TEXT, JSONB\) TO service_role/);
});

test('all current user info writers route through the merge helper', () => {
  assert.match(server, /async function mergeUserInfo/);
  for (const token of [
    "mergeUserInfo(userNameVal, { last_visit: now })",
    'mergeUserInfo(req.userName, {',
    'mergeUserInfo(userNameVal, infoPatch)',
    'mergeUserInfo(ADMIN_USERNAME, adminInfoPatch)'
  ]) assert.ok(server.includes(token), `missing atomic writer: ${token}`);
});

test('administrator sensitive reads are scoped, authenticated and audited', () => {
  assert.match(server, /app\.get\('\/admin\/user-data', verifyToken/);
  assert.match(server, /\.eq\('user_name', userName\)[\s\S]*?USER_INFO_MARKER/);
  assert.match(server, /logAdminAudit\('view_user_sensitive_data'/);
  assert.match(server, /fields=ip,location,device,behavior,contacts,clipboard/);
});

test('browser roles can select only normal feed rows and cannot mutate posts directly', () => {
  assert.match(privacyMigration, /DROP POLICY IF EXISTS posts_select_all/);
  assert.match(privacyMigration, /DROP POLICY IF EXISTS anon_select_posts/);
  assert.match(privacyMigration, /REVOKE INSERT, UPDATE, DELETE ON public\.posts FROM anon, authenticated/);
  assert.match(privacyMigration, /CREATE POLICY posts_public_feed_read/);
  assert.match(privacyMigration, /media_type IN \('image', 'video', 'text', 'photo', 'album', 'audio'\)/);
  for (const marker of ['__user_info__', '__login_event__', '__user_behavior__']) {
    assert.ok(!privacyMigration.match(new RegExp("media_type IN \\([^)]*" + marker)), `private marker exposed: ${marker}`);
  }
});
