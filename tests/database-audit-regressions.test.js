'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = (name) => fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8');
const snapshot = migration('001_base_schema_snapshot.sql');
const m017 = migration('017_fix_cat_ai_duplicate.sql');
const m032 = migration('032_security_hardening_fixes.sql');
const m039 = migration('039_fix_rls_and_privilege_gaps.sql');
const m052 = migration('052_cat_ai_hardening.sql');
const m056 = migration('056_fix_increment_post_views_scope.sql');
const m057 = migration('057_remove_consented_collection.sql');
const m058 = migration('058_database_audit_regressions.sql');
const m059 = migration('059_revoke_increment_post_views_anon.sql');

test('base snapshot uses UUID post references compatible with posts.id and RLS comparisons', () => {
  assert.match(snapshot, /CREATE TABLE IF NOT EXISTS public\.posts\s*\([\s\S]*?id uuid PRIMARY KEY/);
  assert.match(snapshot, /CREATE TABLE IF NOT EXISTS public\.likes\s*\([\s\S]*?post_id\s+uuid/);
  assert.match(snapshot, /CREATE TABLE IF NOT EXISTS public\.comments\s*\([\s\S]*?post_id\s+uuid/);
  assert.match(m039, /p\.id = likes\.post_id/);
  assert.match(m039, /p\.id = comments\.post_id/);
});

test('AI reply unique index is not attempted before the 052 deduplication', () => {
  const earlyCleanupAt = m017.indexOf('DELETE FROM public.comments AS c');
  const earlyIndexAt = m017.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply');
  assert.ok(earlyCleanupAt >= 0 && earlyIndexAt > earlyCleanupAt, '017 must deduplicate before its index');
  assert.doesNotMatch(m032, /CREATE\s+UNIQUE\s+INDEX[^;]*idx_comments_unique_ai_reply/i);
  const cleanupAt = m052.indexOf('DELETE FROM public.comments AS c');
  const indexAt = m052.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_unique_ai_reply');
  assert.ok(cleanupAt >= 0 && indexAt > cleanupAt, '052 must deduplicate before creating the index');
});

test('058 forward fix revokes client access granted by 056', () => {
  assert.match(m056, /GRANT EXECUTE ON FUNCTION public\.increment_post_views\(UUID\) TO anon, authenticated, service_role/i);
  assert.match(m058, /REVOKE ALL ON FUNCTION public\.increment_post_views\(uuid\) FROM PUBLIC, anon, authenticated/i);
  assert.match(m058, /GRANT EXECUTE ON FUNCTION public\.increment_post_views\(uuid\) TO service_role/i);
});

test('057 remains verifiable and 058 recursively scrubs unsafe legacy data', () => {
  assert.match(m057, /跳过无法解析为 JSON/);
  assert.match(m057, /jsonb_typeof\(v_content\) <> 'object'/);
  assert.match(m058, /_audit_strip_retired_consent_keys/);
  assert.match(m058, /jsonb_each\(p_value\)/);
  assert.match(m058, /jsonb_array_elements\(p_value\)/);
  assert.match(m058, /EXCEPTION WHEN others THEN\s+DELETE FROM public\.posts WHERE id = v_row\.id/s);
  assert.match(m058, /IF jsonb_typeof\(v_content\) NOT IN \('object', 'array'\) THEN\s+DELETE FROM public\.posts/s);
  assert.match(m058, /SELECT count\(\*\) INTO v_remaining[\s\S]*?IF v_remaining <> 0 THEN\s+RAISE EXCEPTION/);
  assert.match(m058, /DROP FUNCTION public\._audit_strip_retired_consent_keys\(jsonb\)/);
});

test('legacy interaction conversion is idempotent and refuses to guess numeric mappings', () => {
  assert.match(m058, /IF v_type = 'uuid'::regtype THEN\s+CONTINUE/s);
  assert.match(m058, /v_type <> 'bigint'::regtype/);
  assert.match(m058, /IF v_has_values THEN\s+RAISE WARNING[\s\S]*?refusing lossy\/guessed UUID mapping/);
  assert.match(m058, /ALTER TABLE %s ALTER COLUMN post_id TYPE uuid USING post_id::text::uuid/);
  assert.match(m058, /IF to_regclass\('public\.posts'\) IS NULL THEN/);
});

test('059 hardens increment_post_views without re-opening client-role access', () => {
  // 058 already revoked client roles; 059 must not silently re-grant them.
  // A later migration that "fixes" 056 by granting anon/authenticated again would
  // reintroduce the exact audit finding, so this is asserted explicitly.
  assert.doesNotMatch(m059, /GRANT EXECUTE ON FUNCTION public\.increment_post_views\([^)]*\)\s+TO[^;]*\banon\b/i);
  assert.doesNotMatch(m059, /GRANT EXECUTE ON FUNCTION public\.increment_post_views\([^)]*\)\s+TO[^;]*\bauthenticated\b/i);
  assert.match(m059, /REVOKE ALL ON FUNCTION public\.increment_post_views\(uuid\) FROM PUBLIC, anon, authenticated/i);
  assert.match(m059, /GRANT EXECUTE ON FUNCTION public\.increment_post_views\(uuid\) TO service_role/i);

  // The added guard: only public (or legacy NULL-visibility) posts may be counted.
  assert.match(m059, /AND \(visibility IS NULL OR visibility = 'public'\)/);
  // Non-public / missing rows must not leak a precise count.
  assert.match(m059, /RETURN COALESCE\(v_views, 0\)/);
  // SECURITY DEFINER search_path must be re-pinned after CREATE OR REPLACE.
  assert.match(m059, /ALTER FUNCTION public\.increment_post_views\(uuid\) SET search_path = pg_catalog, public/i);
});

test('account deletion is left to a policy-backed, reviewed forward plan', () => {
  assert.match(m058, /Account deletion is deliberately not automated here/);
  assert.match(m058, /reviewed retention policy/);
  assert.doesNotMatch(m058, /DELETE FROM public\.[a-z_]+[^;]*user_name\s*=/i);
});
