'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const server = fs.readFileSync('render-api/server.js', 'utf8');
const block = (name, length = 1400) => { const at = server.indexOf(name); assert.ok(at > 0, name + ' exists'); return server.slice(at, at + length); };
test('the cat reply lookup only reads comment columns that exist in the deployed table', () => {
  // Production comments: id, post_id, user_name, actor_key, content, created_at, generated_by_ai, parent_comment_id, client_request_id.
  const lookup = block('async function fetchCatReplyByParent(');
  const select = (lookup.match(/\.select\('([^']+)'\)/) || [])[1] || '';
  const deployed = new Set(['id', 'post_id', 'user_name', 'actor_key', 'content', 'created_at', 'generated_by_ai', 'parent_comment_id', 'client_request_id']);
  for (const column of select.split(',').map(x => x.trim().replace(/::.*$/, ''))) assert.ok(deployed.has(column), 'comments.' + column + ' is not a deployed column');
});
test('the job queue poll relies on the retry-backoff migration being present in the repo', () => {
  assert.match(block('async function processNextCatJob(', 900), /next_retry_at/);
  assert.ok(fs.readFileSync('supabase/migrations/038_cat_ai_retry_backoff.sql', 'utf8').includes('ADD COLUMN IF NOT EXISTS next_retry_at'));
});
