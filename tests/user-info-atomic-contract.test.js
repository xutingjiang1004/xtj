'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const server = fs.readFileSync(path.join(ROOT, 'render-api/server.js'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/014_atomic_user_info_merge.sql'), 'utf8');
const privacyMigration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/015_lock_private_post_markers.sql'), 'utf8');
const authEvents = fs.readFileSync(path.join(ROOT, 'render-api/account-events.js'), 'utf8');
const authMigration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261001040358_authoritative_account_events.sql'), 'utf8');
const authGeoMigration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261002012142_atomic_audit_operations.sql'), 'utf8');

test('private user info has one row and a service-role-only atomic merge', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS posts_one_user_info_per_user/);
  assert.match(migration, /WHERE media_type = '__user_info__'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.merge_user_info/);
  assert.match(migration, /ON CONFLICT \(user_name\) WHERE media_type = '__user_info__'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.merge_user_info\(TEXT, JSONB\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.merge_user_info\(TEXT, JSONB\) TO service_role/);
});

test('active profile writers use atomic merge or service-only confirmed authentication RPCs', () => {
  assert.match(server, /async function mergeUserInfo/);
  for (const token of [
    "mergeUserInfo(userNameVal, { last_visit: now })",
    'mergeUserInfo(req.userName, {',
    'mergeUserInfo(ADMIN_USERNAME, adminInfoPatch)'
  ]) assert.ok(server.includes(token), `missing atomic writer: ${token}`);
  // The removed client telemetry writer must remain retired. Its replacement
  // authenticates on the server and merges profile facts in a DB transaction.
  const begin=server.indexOf("app.post('/api/log-login-event'"),end=server.indexOf("app.get('/api/security-settings'",begin);
  assert.ok(begin>0&&end>begin);
  const retired=server.slice(begin,end);
  assert.match(retired,/authenticateUser/);assert.match(retired,/status\(410\)/);
  assert.doesNotMatch(retired,/mergeUserInfo|supabase|resolveIpLocation/);
  assert.match(authEvents,/supabase\.rpc\('record_user_auth_event'/);
  assert.match(authEvents,/supabase\.rpc\('record_auth_ip_location'/);
  assert.match(authMigration,/REVOKE ALL ON FUNCTION public\.record_user_auth_event\(text,text,jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.match(authGeoMigration,/ON CONFLICT\(user_name\) WHERE media_type='__user_info__' DO UPDATE SET content=/);
  assert.match(authGeoMigration,/'last_ip_location',NULL/);
  assert.match(authGeoMigration,/last_auth_event_id'=p_event_id::text/);
  assert.match(authGeoMigration,/last_login'=v_body->>'login_at'/);
  assert.match(authGeoMigration,/last_ip'=p_ip/);
  assert.match(authGeoMigration,/REVOKE ALL ON FUNCTION public\.record_auth_ip_location\(uuid,text,jsonb\) FROM PUBLIC,anon,authenticated/);
  assert.match(authGeoMigration,/GRANT EXECUTE ON FUNCTION public\.record_auth_ip_location\(uuid,text,jsonb\) TO service_role/);
});

test('administrator sensitive reads are scoped, authenticated and audited', () => {
  assert.match(server, /app\.get\('\/admin\/user-data', verifyToken/);
  assert.match(server, /\.eq\('user_name', userName\)[\s\S]*?USER_INFO_MARKER/);
  assert.match(server, /logAdminAudit\('view_user_sensitive_data'/);
  // ★ 2026-09-22：审计明细中的 contacts/clipboard 已随采集功能移除
  assert.match(server, /fields=ip,location,device,behavior/);
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
