'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const uiShell = fs.readFileSync(path.join(root, 'css', 'ui-shell.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const aiAgent = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const aiHistoryIndexes = fs.readFileSync(path.join(root, 'supabase', 'migrations', '023_ai_history_query_indexes.sql'), 'utf8');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('protected requests attach Bearer auth and retry only once after 401', () => {
  const block = between(core, 'window.xtjProtectedFetch = async function', 'let avatarCache');
  assert.match(block, /headers\.Authorization\s*=\s*'Bearer '\s*\+\s*token/);
  assert.match(block, /if \(response\.status === 401\)[\s\S]*refreshUserToken\(true\)/);
  assert.match(block, /credentials:\s*'include'/);
});

test('feed refresh preserves visible posts while reconciliation is pending', () => {
  const loadFeed = between(core, 'loadFeed = async function(forceRefresh)', 'window.loadFeed = loadFeed');
  const refreshSetup = between(loadFeed, 'if (forceRefresh)', 'bindPostFilterEvents');
  assert.match(loadFeed, /var hadLiveFeed = Array\.isArray\(feedAllPosts\) && feedAllPosts\.length > 0/);
  assert.doesNotMatch(refreshSetup, /feedAllPosts\s*=\s*\[\]/);
  assert.match(loadFeed, /if \(!chunk\.posts\.length && hadLiveFeed\)/);
  assert.match(loadFeed, /if \(!hadLiveFeed && feed\) feed\.innerHTML/);
});

test('AI tools prewarm, render immediately, and bound history requests', () => {
  const launcher = between(core, 'function bindTopAiToolsLauncher()', 'bindTopAiToolsLauncher();');
  const openChat = between(aiAgent, 'async function openAiChat()', 'function applyConfigToUI');
  const openResearch = between(aiAgent, 'async function openDeepThinkPage()', 'function closeDeepThinkPage');
  const history = between(aiAgent, 'async function loadHistory(messagesEl, before)', 'async function fetchConversations');
  assert.match(launcher, /if \(open\) ensureAiAgentLoaded\(\)\.catch/);
  assert.match(launcher, /nav\.addEventListener\('pointerenter'/);
  assert.match(uiShell, /ai-tools-menu button:hover,[\s\S]*?filter: none !important;[\s\S]*?transform: none !important;/);
  assert.ok(openChat.indexOf("aiPanel.classList.add('active')") < openChat.indexOf('ensureUserAuthOrNotify()'));
  assert.ok(openResearch.indexOf("panel.classList.add('active')") < openResearch.indexOf('ensureUserAuthOrNotify()'));
  assert.match(history, /timeoutMs:\s*8000/);
  assert.match(openResearch, /mode=deep_think', null, \{ timeoutMs: 8000 \}/);
});

test('AI history prioritizes a small first payload, cache paint, and indexed queries', () => {
  const historyRoute = between(server, "app.get('/api/agent/chat/history'", '// =====================');
  assert.match(aiAgent, /var HISTORY_PAGE_SIZE = 10/);
  assert.match(aiAgent, /var latestKey = getAiHistoryCacheKey\(null(?:, mode)?\)/);
  assert.match(historyRoute, /\.limit\(AI_CHAT_LATEST_CONVERSATION_SCAN_LIMIT\)/);
  assert.match(historyRoute, /\.limit\(Math\.min\(limit \+ AI_CHAT_HISTORY_FETCH_BUFFER, 100\)\)/);
  assert.match(aiHistoryIndexes, /posts_ai_agent_history_user_created_idx/);
  assert.match(aiHistoryIndexes, /posts_ai_agent_history_user_actor_prefix_idx/);
  assert.match(aiHistoryIndexes, /actor_key text_pattern_ops/);
});

test('AI history keeps each conversation pair in one mode', () => {
  const historyRoute = between(server, "app.get('/api/agent/chat/history'", '// =====================');
  assert.match(server, /function getConversationStorageMode\(rows\)/);
  assert.match(historyRoute, /Filter only deleted rows\. Mode is resolved once/);
  assert.match(server, /buildMsgMeta\('user', convId, null, null, 1, null, 0, \{ chat_mode: chatMode \}\)/);
});

test('DM APIs are authenticated and select both sides of a conversation', () => {
  const list = between(server, "app.get('/api/dm/list'", "app.get('/api/dm/messages'");
  const messages = between(server, "app.get('/api/dm/messages'", '// =====================');
  assert.match(list, /authenticateUser/);
  assert.match(list, /\.eq\('user_name',\s*req\.userName\)/);
  assert.match(list, /\.eq\('media_url',\s*req\.userName\)/);
  assert.doesNotMatch(list, /\.eq\('actor_key',\s*'dm_'/);
  assert.match(messages, /authenticateUser/);
  assert.match(messages, /targetUser/);
  assert.match(messages, /user_name/);
  assert.match(messages, /media_url/);
  assert.match(messages, /Map|Set|dedup|seen/i);
});

test('atomic like endpoint validates exact types and returns canonical state', () => {
  const endpoint = between(server, "app.post('/api/post/like'", '// ===================== 照片墙接口');
  assert.match(endpoint, /authenticateUser/);
  assert.match(endpoint, /normalizePostId\(rawPostId\)/);
  assert.match(endpoint, /typeof liked !== 'boolean'/);
  assert.match(endpoint, /post_id:\s*postId,\s*liked:\s*liked,\s*like_count:/);
  assert.match(endpoint, /\.eq\('post_id',\s*postId\)\.eq\('user_name',\s*req\.userName\)/);
});

test('like UI is optimistic, coalesces rapid toggles, and keeps the control interactive', () => {
  const toggle = between(core, 'window.toggleLike = function', 'function createLikeBlossom');
  const flush = between(core, 'function flushPostLikeOperation', 'window.toggleLike = function');
  assert.match(toggle, /operation\.desired\s*=\s*nextLiked/);
  assert.match(toggle, /applyPostLikeIntent\(pid,\s*nextLiked,\s*btn\)/);
  assert.match(toggle, /if \(!operation\.running\) operation\.promise = flushPostLikeOperation/);
  assert.match(flush, /xtjProtectedFetch\('\/api\/post\/like'/);
  assert.match(flush, /JSON\.stringify\(\{ post_id:\s*normalizedPostId,\s*liked:\s*requestedLiked \}\)/);
  assert.match(flush, /operation\.desired !== operation\.confirmed/);
  assert.match(flush, /updatePostLikeCount\(postId, likeResult\.like_count\)/);
  assert.match(core, /likeBtn\.disabled\s*=\s*false/);
  assert.doesNotMatch(toggle, /showToast\(nextLiked/);
});

test('like feedback uses a single removable cherry blossom without forced reflow', () => {
  const toggle = between(core, 'window.toggleLike = function', 'function createLikeBlossom');
  const applyIntent = between(core, 'function applyPostLikeIntent', 'function flushPostLikeOperation');
  const blossom = between(core, 'function createLikeBlossom', '// =====================');
  assert.match(toggle, /applyPostLikeIntent\(pid,\s*nextLiked,\s*btn\)/);
  assert.match(applyIntent, /if \(liked && sourceButton\) createLikeBlossom\(sourceButton\);/);
  assert.doesNotMatch(toggle, /xtjAnimateLikeToggle/);
  assert.match(blossom, /prefers-reduced-motion:\s*reduce/);
  assert.match(blossom, /like-blossom/);
  assert.match(blossom, /xtj-like-blossom-gradient-/);
  assert.match(blossom, /animationend/);
  assert.match(blossom, /btn\._likeBlossom/);
  assert.doesNotMatch(blossom, /offsetWidth|like-heart-anim/);
  assert.match(style, /\.actions \.like-blossom\s*\{[\s\S]*?z-index:\s*2;[\s\S]*?will-change:\s*transform, opacity;[\s\S]*?animation:\s*xtj-like-blossom/);
  assert.match(style, /@keyframes xtj-like-blossom[\s\S]*?transform:/);
  assert.doesNotMatch(style, /\.action-btn\.liked\s*\{[^}]*animation:/s);
  assert.doesNotMatch(core, /heart-particle|like-heart-anim|like-particle|createLikeParticles|animatePostLikeFeedback/);
  assert.doesNotMatch(style, /like-particle|likeParticleFly|like-feedback-add|like-feedback-remove|xtj-like-add|xtj-like-remove/);
});

test('header avatar keeps a fixed circular 24px footprint', () => {
  assert.match(style, /#authUI \.user-pill #myAvatar\s*\{[\s\S]*?inline-size:\s*24px !important;[\s\S]*?block-size:\s*24px !important;[\s\S]*?flex:\s*0 0 24px !important;[\s\S]*?aspect-ratio:\s*1 \/ 1;/);
  assert.match(style, /#authUI \.user-pill #myAvatar > img\s*\{[\s\S]*?object-fit:\s*cover !important;/);
});

test('iOS visual viewport reserves status-bar and Dock space without changing Dock structure', () => {
  assert.match(index, /viewport-fit=cover/);
  assert.match(core, /root\.classList\.add\('xtj-ios-viewport'\)/);
  assert.match(core, /--xtj-visual-bottom/);
  assert.match(core, /--xtj-dock-reserve/);
  assert.match(uiShell, /html\.xtj-ios-viewport \.dock-bar\s*\{[\s\S]*?bottom:\s*max\(var\(--xtj-visual-bottom\), env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(uiShell, /html\.xtj-ios-viewport \.dock-panel\s*\{[\s\S]*?padding-bottom:\s*calc\(var\(--xtj-dock-reserve\) \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(uiShell, /#panelPosts \.posts-nav\.sticky-header\s*\{[\s\S]*?env\(safe-area-inset-top, 0px\)/);
});

test('pin request serializes a UUID string and a boolean', () => {
  const pin = between(core, "window.togglePostPin = async function(postId, btn)", 'window.togglePostVisibility');
  assert.match(pin, /xtjProtectedFetch\('\/api\/post\/pin'/);
  assert.match(pin, /JSON\.stringify\(\{ post_id:\s*normalizedPostId,\s*is_pinned:\s*(?:!!|Boolean\()nextPinned\)? \}\)/);
});

test('AI stays in the homepage tools center instead of the direct-message list', () => {
  const loader = between(core, 'function loadXtjModule(name)', 'function ensurePhotoWallLoaded');
  assert.match(loader, /delete xtjModulePromises\[moduleName\]/);
  const entry = between(core, 'function renderDockChatFixedEntry', 'async function loadDockChatMessages');
  assert.match(entry, /administrator contact remains a normal direct-message entry/);
  assert.doesNotMatch(entry, /__ai_agent__/);
  assert.match(core, /bindTopAiToolsLauncher/);
});

test('publishing exposes busy state and inserts the created post without full feed reload', () => {
  const publish = between(core, 'window.doPublish = async function', 'loadFeed = async function');
  assert.match(publish, /setAttribute\(['"]aria-busy['"],\s*['"]true['"]\)/);
  assert.match(publish, /insertPublishedPostIntoFeed\(insertRes\.data\)/);
  const insertion = between(core, 'function insertPublishedPostIntoFeed', 'window.doPublish = async function');
  assert.match(insertion, /insertBefore|prepend/);
  assert.match(publish, /await loadFeed\(true\)/, 'a failed local insertion retains a safe full-feed fallback');
  assert.match(publish, /setAttribute\(['"]aria-busy['"],\s*['"]false['"]\)|removeAttribute\(['"]aria-busy['"]\)/);
});
