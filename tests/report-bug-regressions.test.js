'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
