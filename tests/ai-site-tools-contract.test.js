const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
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

test('AI tool registry exposes searches only', () => {
  const registry = server.slice(server.indexOf('const AI_SITE_TOOL_REGISTRY'), server.indexOf('Object.keys(AI_SITE_TOOL_REGISTRY)'));
  assert.doesNotMatch(registry, /send_site_message|create_draft|update_draft|delete_draft|publish_announcement|maintenance_task/);
  assert.match(server, /ai_write_tools_disabled/);
});

test('search cards deduplicate SSE retries and use real application jump handlers', () => {
  assert.match(client, /messagesEl\.__xtjAiCardIds/);
  assert.match(client, /openUserProfile/);
  assert.match(client, /openConversation/);
  assert.match(client, /target\.image_url.*window\.openPhotoPreview/s);
  assert.match(client, /matched_keywords/);
  assert.doesNotMatch(client, /window\.openAiChat/);
});

test('site search preserves source metadata and restored cards without exposing raw tables', () => {
  assert.match(server, /function aiSitePresentResult/);
  assert.match(server, /source_created_at/);
  assert.match(server, /matched_keywords/);
  assert.match(server, /function aiSitePhotoUrl/);
  assert.match(server, /site_cards: Array\.isArray\(m\.site_cards\)/);
  assert.match(server, /siteCards: siteToolCards/);
  assert.match(client, /Array\.isArray\(msg\.site_cards\)/);
  assert.doesNotMatch(server, /schedule_action|cancel_scheduled_action/);
});

test('AI tools keep chat and site search as independent pages instead of changing the Dock tab', () => {
  assert.match(page, /id="panelAiChat"/);
  assert.match(page, /id="aiSiteSearchPanel"/);
  assert.match(client, /function openSiteSearchPage/);
  assert.match(client, /apiRequest\('POST', '\/site-search'/);
  assert.match(client, /openSiteSearch: openSiteSearchPage/);
  const openAiChat = client.slice(client.indexOf('async function openAiChat()'), client.indexOf('function applyConfigToUI'));
  assert.doesNotMatch(openAiChat, /switchDockTab\('chat'/);
  assert.match(openAiChat, /aiPanel\.appendChild\(r\.root\)/);
});

test('normal chat and deep research use separate history modes', () => {
  const historyRoute = server.slice(server.indexOf("app.get('/api/agent/chat/history'"), server.indexOf('// =====================', server.indexOf("app.get('/api/agent/chat/history'")));
  assert.match(historyRoute, /var mode = String\(req\.query\.mode \|\| ''\)\.trim\(\)/);
  assert.match(historyRoute, /mode !== 'normal' && mode !== 'deep_think'/);
  assert.match(historyRoute, /mode === 'deep_think' \? meta\.chat_mode === 'deep_think' : meta\.chat_mode !== 'deep_think'/);
  assert.match(client, /&mode=deep_think/);
  assert.match(client, /qs \+= '&mode=normal'/);
  assert.match(client, /chat\/conversations\?limit=1&mode=normal/);
  const deepPage = client.slice(client.indexOf('async function openDeepThinkPage()'), client.indexOf('function closeDeepThinkPage()'));
  assert.doesNotMatch(deepPage, /apiRequest\('GET', '\/chat\/history\?limit=30'\)/);
});

test('AI tool navigation uses accessible SVG icons and site search has a lightweight loading state', () => {
  assert.match(page, /ai-tools-trigger-icon/);
  assert.doesNotMatch(page, /ai-tools-menu-icon">AI</);
  assert.match(page, /data-ai-search-source="posts"><svg/);
  assert.match(client, /function renderSiteSearchLoading/);
  assert.match(client, /ai-site-search-skeleton/);
});
