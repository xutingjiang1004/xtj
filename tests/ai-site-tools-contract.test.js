const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const features = fs.readFileSync(path.join(root, 'js', 'features.js'), 'utf8');
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
  // DM 搜索的 or() 过滤用 pgrstQuote 转义用户名，防止注入过滤条件
  assert.match(server, /user_name\.eq\.' \+ pgrstQuote\(userName\)/);
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
  // Confirm/cancel writes are server-protected: routes require authenticateUser
  assert.match(server, /app\.post\('\/api\/agent\/actions\/:id\/confirm', authenticateUser/);
  assert.match(server, /app\.post\('\/api\/agent\/actions\/:id\/cancel', authenticateUser/);
  // Client-side protected fetch wrapper exists for authenticated writes
  assert.match(core, /window\.xtjProtectedFetch = async function\(path, options\)/);
  // No unauthenticated/bogus client-side actions call (dead if(false) block removed)
  assert.doesNotMatch(client, /apiRequest\('POST', '\/actions\/'/);
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

test('normal chat and deep research keep complete conversations in separate history modes', () => {
  const historyRoute = server.slice(server.indexOf("app.get('/api/agent/chat/history'"), server.indexOf('// =====================', server.indexOf("app.get('/api/agent/chat/history'")));
  assert.match(historyRoute, /var mode = String\(req\.query\.mode \|\| ''\)\.trim\(\)/);
  assert.match(historyRoute, /mode !== 'normal' && mode !== 'deep_think'/);
  assert.match(server, /function getConversationStorageMode\(rows\)/);
  assert.match(historyRoute, /getConversationStorageMode\(recentConversations\[candidateId\]\)/);
  assert.match(historyRoute, /var conversationMode = getConversationStorageMode\(rows \|\| \[\]\)/);
  assert.doesNotMatch(historyRoute, /matchesMode\(r2\)/);
  assert.match(client, /&mode=deep_think/);
  assert.match(client, /qs \+= '&mode=normal'/);
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

// ===================== 新增回归测试 =====================

test('aiSiteText extracts text from JSON-wrapped content', () => {
  assert.match(server, /extractPostPlainText/);
  assert.match(server, /parsed\.text/);
  assert.match(server, /parsed\.content/);
  assert.match(server, /parsed\.body/);
  assert.match(server, /function aiSiteContainsText/);
  assert.match(server, /function aiSiteMatchScore/);
  assert.match(server, /function parseSearchQuery/);
});

test('aiSiteSearch checks query errors on all sources', () => {
  assert.match(server, /if \(postRes\.error\)/);
  assert.match(server, /if \(commentRes\.error\)/);
  assert.match(server, /if \(photoRes\.error\)/);
  assert.match(server, /if \(dmRes\.error\)/);
  assert.match(server, /if \(aiRes\.error\)/);
  assert.match(server, /if \(userRes\.error\)/);
});

test('aiSiteSearch deduplicates by source_id', () => {
  assert.match(server, /var seen = \{\}/);
  assert.match(server, /var key = r\.source \+ ':' \+ r\.source_id/);
  assert.match(server, /if \(seen\[key\]\) return false/);
});

test('aiSiteMatchScore calculates real relevance with multi-keyword scoring', () => {
  assert.match(server, /function aiSiteMatchScore/);
  assert.match(server, /exactPhrase/);
  assert.match(server, /allKeywords/);
  assert.match(server, /matchedCount/);
  assert.doesNotMatch(server, /relevance: 1\b/);
});

test('aiSiteNormalizeQuery normalizes input: full-width spaces, punctuation, whitespace', () => {
  assert.match(server, /function aiSiteNormalizeQuery/);
  assert.match(server, /\\u3000/);
  assert.match(server, /\\s\+/);
});

test('site-search route uses Promise.allSettled for partial failure tolerance', () => {
  assert.match(server, /Promise\.allSettled/);
  assert.match(server, /source_errors/);
  assert.match(server, /s\.status === 'fulfilled'/);
});

test('site-search route persists results asynchronously without blocking response', () => {
  assert.match(server, /aiSitePersistResults\(req\.userName, results\)\.catch/);
  // route handler should call persist in a fire-and-forget pattern, not await it
  assert.match(server, /aiSitePersistResults\(req\.userName, results\)\s*\.catch/);
});

test('aiSitePersistResults does not throw on error, returns original results', () => {
  assert.match(server, /async function aiSitePersistResults/);
  // extract the function body and verify it catches errors
  var fnStart = server.indexOf('async function aiSitePersistResults');
  var fnEnd = server.indexOf('\n}', fnStart);
  var fnNext = server.indexOf('\n}', fnEnd + 1);
  var fnBody = server.slice(fnStart, fnNext + 1);
  assert.doesNotMatch(fnBody, /throw new Error\('AI 工具数据表尚未迁移'\)/);
  assert.match(fnBody, /catch \(e\)/);
  assert.match(fnBody, /return results/);
});

test('patchToast skips empty messages instead of showing "操作成功"', () => {
  assert.match(features, /function patchToast/);
  assert.doesNotMatch(features, /\|\| '操作成功'/);
  assert.match(features, /if \(!args\[0\]\) return/);
});

test('scheduleAiPreload is defined and called for lazy AI module loading', () => {
  assert.match(core, /function scheduleAiPreload/);
  assert.match(core, /scheduleAiPreload\(\);/);
  assert.match(core, /requestIdleCallback/);
});

test('openSiteSearchPage shows page immediately before auth check', () => {
  assert.match(client, /function openSiteSearchPage/);
  // page is shown before auth check
  const siteSearchFn = client.slice(client.indexOf('async function openSiteSearchPage()'), client.indexOf('function bindTopAiTools()'));
  // panel must be shown before ensureUserAuthOrNotify
  const panelShowIdx = siteSearchFn.indexOf('panel.classList.remove');
  const authIdx = siteSearchFn.indexOf('ensureUserAuthOrNotify');
  assert.ok(panelShowIdx > 0, 'panel should be shown');
  assert.ok(authIdx > 0, 'auth check should be called');
  assert.ok(panelShowIdx < authIdx, 'panel should be shown BEFORE auth check');
});

test('site search results remain navigable to posts, photos, chat and AI history', () => {
  assert.match(client, /function openAiSearchTarget/);
  assert.match(client, /target\.type === 'post'/);
  assert.match(client, /target\.type === 'photo'/);
  assert.match(client, /openConversation/);
  assert.match(client, /openUserProfile/);
});

test('history query no longer performs client-side fallback to avoid wiping new conversations', () => {
  const loadHistoryStr = client.slice(client.indexOf('async function loadHistory'), client.indexOf('async function fetchConversations'));
  assert.doesNotMatch(loadHistoryStr, /\/chat\/conversations.*mode=normal/);
  // Ensure we just return if no messages and no fallback
  assert.match(loadHistoryStr, /S\.messages = \[\];\s*messagesEl\.innerHTML = '';\s*appendEmptyState/);
});

test('openAiChat initiates with no conversationId to allow backend to find the latest', () => {
  const openChatStr = client.slice(client.indexOf('async function openAiChat()'), client.indexOf('Promise.allSettled'));
  assert.doesNotMatch(openChatStr, /S\.conversationId = readConvId\(\)/);
});

test('server history uses a bounded filter buffer instead of transferring 200 full messages', () => {
  const historyRoute = server.slice(server.indexOf("app.get('/api/agent/chat/history'"), server.indexOf('// =====================', server.indexOf("app.get('/api/agent/chat/history'")));
  assert.match(historyRoute, /\.limit\(Math\.min\(limit \+ AI_CHAT_HISTORY_FETCH_BUFFER, 100\)\)/);
  assert.match(historyRoute, /filteredRows\.push\(r2\);\s*if \(filteredRows\.length > limit\) break;/);
});

test('cache writes and reads are fully isolated by encoding currentUser', () => {
  const cacheFn = client.slice(client.indexOf('function getAiHistoryCacheUserKey'), client.indexOf('function getAiHistoryCacheKey'));
  assert.match(cacheFn, /readUserName/);
  
  const clearFn = client.slice(client.indexOf('function clearAiHistoryCacheForUser'), client.indexOf('window\.clearAiHistoryCacheForUser'));
  assert.match(clearFn, /sessionStorage\.removeItem\(k\)/);
  assert.match(clearFn, /xtj_ai_history:/);
});

test('renderHistoryUnavailable receives error_code and preserves cache', () => {
  assert.match(client, /renderHistoryUnavailable\(messagesEl, r, \{ preserveExistingMessages: hasCache \}\)/);
  const renderFn = client.slice(client.indexOf('function renderHistoryUnavailable'), client.indexOf('function appendMessage'));
  assert.match(renderFn, /opts\.preserveExistingMessages/);
  assert.match(renderFn, /ai-history-cache-banner/);
  assert.doesNotMatch(renderFn, /notify/);
});
