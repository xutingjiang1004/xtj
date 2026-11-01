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
test('the cat is told when a post carries media it cannot see, so it does not invent what is in the picture', () => {
  assert.match(block('const CAT_AI_COMMENT_PROMPT', 1600), /看不到画面[\s\S]*绝不编造画面内容/);
  const context = block('async function getCatPostContext(', 700);
  assert.match(context, /select\('id, content, user_name, media_type'\)/);
  assert.match(block('async function getCatPostContext(', 3200), /attachment_kind/);
});
