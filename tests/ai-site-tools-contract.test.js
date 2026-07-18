const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '018_ai_site_tools.sql'), 'utf8');

test('AI site-tool registry keeps scheduling out of scope', () => {
  assert.match(server, /const AI_SITE_TOOL_REGISTRY/);
  assert.doesNotMatch(server, /schedule_action|cancel_scheduled_action/);
});

test('AI site tools require server context and confirmation for writes', () => {
  assert.match(server, /缺少用户上下文/);
  assert.match(server, /aiSiteCreateConfirmation/);
  assert.match(server, /eq\('status', 'pending'\)/);
  assert.match(server, /gt\('expires_at', now\)/);
});

test('search scopes protect private records and direct messages', () => {
  assert.match(server, /p\.visibility !== 'private' \|\| p\.user_name === userName/);
  assert.match(server, /visibleCommentPosts/);
  assert.match(server, /media_type', DM_MARKER/);
  assert.match(server, /user_name\.eq\.' \+ userName/);
});

test('new AI tables are RLS protected and service-role only', () => {
  ['ai_search_results', 'ai_drafts', 'ai_action_confirmations', 'ai_maintenance_tasks'].forEach((table) => {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  });
  assert.match(migration, /REVOKE ALL ON TABLE.*anon, authenticated/);
  assert.match(migration, /TO service_role/);
});

test('AI cards are DOM-built and confirmation actions are protected API calls', () => {
  assert.match(client, /function renderAiToolCard/);
  assert.match(client, /evt\.type === 'card'/);
  assert.match(client, /apiRequest\('POST', '\/actions\/'/);
  assert.doesNotMatch(client, /card\.title\s*\+/);
});
