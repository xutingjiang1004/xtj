'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const persistentIndex = require('../render-api/ai-core/persistent-index.js');

const read = file => fs.readFileSync(file, 'utf8');

test('DOCX replacement inserts longer text once across multiple runs', () => {
  const source = read('render-api/code-agent.js');
  assert.match(source, /var replacementInserted = false/);
  assert.match(source, /!replacementInserted && ci2 === Math\.max\(tnStart, startCharIdx\)/);
  assert.doesNotMatch(source, /offsetInNew < newText\.length/);
});

test('SSE writer has a bounded backpressure buffer and deep-think cleanup', () => {
  const source = read('render-api/server.js');
  assert.match(source, /MAX_SSE_BUFFER_BYTES/);
  assert.match(source, /_sseBufferBytes/);
  assert.match(source, /activeDeepThinkJobs\.delete\(convId\)/);
});

test('Code chat timeout does not outlive a settled request', () => {
  const source = read('js/code-workspace.js');
  assert.match(source, /Promise\.race\(\[apiCall\.then\(decodeCodeChatResponse\), timeoutPromise\]\)/);
  assert.ok((source.match(/clearTimeout\(ctx\.timeoutTimer\)/g) || []).length >= 2);
});

test('stream session RLS and legacy RPCs use safe identity/search paths', () => {
  const sessions = read('supabase/migrations/028_code_stream_sessions.sql');
  const rpc = read('supabase/migrations/005_harden_rpc_rls.sql');
  const hardening = read('supabase/migrations/031_harden_stream_identity_and_photo_views.sql');
  assert.match(sessions, /user_id = \(SELECT auth\.uid\(\)::text\)/);
  assert.match(hardening, /auth\.jwt\(\) ->> 'user_name'/);
  assert.match(rpc, /SET search_path = public, pg_temp/);
  assert.match(hardening, /increment_post_views\(p_post_id UUID\)/);
});

test('CORS supports the authenticated cross-origin browser requests', () => {
  const server = read('render-api/server.js');
  const headers = read('render-api/security-headers.js');
  assert.match(server, /app\.use\(cors\(\{[\s\S]*?credentials:\s*true/);
  assert.doesNotMatch(headers, /interest-cohort/);
});

test('persistent index RLS accepts both UUID and username JWT identities', () => {
  const hardening = read('supabase/migrations/032_security_hardening_fixes.sql');
  for (const table of ['code_workspaces', 'code_index_files', 'code_index_chunks', 'code_index_builds']) {
    assert.match(hardening, new RegExp(`ON public\\.${table}[\\s\\S]*?auth\\.jwt\\(\\)`, 'm'));
  }
  assert.match(hardening, /user_id = auth\.uid\(\)::text/);
  assert.match(hardening, /user_id = NULLIF\(auth\.jwt\(\) ->> 'user_name', ''\)/);
  assert.match(hardening, /auth\.jwt\(\) -> 'app_metadata' ->> 'user_name'/);
  assert.doesNotMatch(hardening, /auth\.jwt\(\) -> 'user_metadata'/);
  assert.doesNotMatch(read('supabase/migrations/031_harden_stream_identity_and_photo_views.sql'), /auth\.jwt\(\) -> 'user_metadata'/);
});

test('photo cleanup uses the generated webp thumbnail path', () => {
  const migration = read('supabase/migrations/013_hard_delete_content_and_photo_cleanup.sql');
  const repair = read('supabase/migrations/031_harden_stream_identity_and_photo_views.sql');
  assert.match(migration, /photos\/thumbs\/.*digest\(.*sha256/);
  assert.doesNotMatch(migration, /_thumb\\1/);
  assert.match(repair, /photos\/thumbs\/' \|\| encode\(digest/);
});

test('normal post filters encode an empty media type explicitly', () => {
  const source = read('render-api/server.js');
  assert.match(source, /NORMAL_POST_EMPTY_MEDIA_FILTER\s*=\s*'media_type\.eq\.""'/);
  assert.doesNotMatch(source, /t === '' \? 'media_type\.eq\.'/);
  assert.doesNotMatch(source, /media_type\.is\.null,media_type\.eq\.,/);
});

test('MCP admin server is intentionally launched as ESM', () => {
  const pkg = JSON.parse(read('mcp-servers/xtj-admin/package.json'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'server.js');
  assert.match(read('mcp-servers/xtj-admin/server.js'), /from "@modelcontextprotocol\/sdk/);
});

function queryBuilder(result) {
  return {
    delete() { return queryBuilder({ error: null }); },
    upsert() { return queryBuilder(result); },
    select() { return this; },
    eq() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
  };
}

test('persistent chunk failures reject and null mtimes do not suppress changed files', async () => {
  persistentIndex.setPersistEnabledForTests(true);
  try {
    const failingSupabase = { from: () => queryBuilder({ error: { message: 'chunk write failed' } }) };
    await assert.rejects(
      persistentIndex.upsertChunks(failingSupabase, 'user', 'workspace', 'file', [{ chunkKey: 'c1', content: 'x' }]),
      /chunk write failed/
    );

    const stored = [{ path: 'src/a.js', size_bytes: 10, modified_at: null, sha256: '' }];
    const manifestSupabase = {
      from: () => queryBuilder({ data: stored, error: null })
    };
    const comparison = await persistentIndex.compareManifest(manifestSupabase, 'workspace', [
      { path: 'src/a.js', size: '10', modifiedAt: null, sha256: '' }
    ]);
    assert.deepEqual(comparison.unchangedPaths, []);
    assert.deepEqual(comparison.uploadPaths, ['src/a.js']);
  } finally {
    persistentIndex.setPersistEnabledForTests(false);
  }
});
