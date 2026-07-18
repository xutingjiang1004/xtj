'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

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

test('like UI is optimistic, rolls back, animates both states, and has no success toast', () => {
  const toggle = between(core, 'window.toggleLike = async function', 'function createHeartParticles');
  assert.match(toggle, /updatePostLikeUi\(pid,\s*nextLiked/);
  assert.match(toggle, /xtjProtectedFetch\('\/api\/post\/like'/);
  assert.match(toggle, /JSON\.stringify\(\{ post_id:\s*normalizedPostId,\s*liked:\s*nextLiked \}\)/);
  assert.match(toggle, /updatePostLikeUi\(pid,\s*wasLiked/);
  assert.match(toggle, /animatePostLikeFeedback\(pid,\s*nextLiked\)/);
  assert.doesNotMatch(toggle, /showToast\(nextLiked/);
  assert.doesNotMatch(toggle, /showToast\(['"](?:已点赞|已取消点赞)/);
});

test('like feedback scatters hearts without scaling the action button', () => {
  const toggle = between(core, 'window.toggleLike = async function', 'function createHeartParticles');
  const particles = between(core, 'function createHeartParticles', '// =====================');
  const feedbackCss = between(style, '/* Interaction feedback: like, publish', '#pubBtn.is-loading');
  assert.match(toggle, /if \(nextLiked\) createHeartParticles\(btn\)/);
  assert.doesNotMatch(toggle, /xtjAnimateLikeToggle/);
  assert.match(particles, /prefers-reduced-motion:\s*reduce/);
  assert.match(particles, /--heart-x/);
  assert.match(particles, /--heart-y/);
  assert.match(particles, /animationend/);
  assert.doesNotMatch(feedbackCss, /transform:\s*scale/);
  assert.doesNotMatch(style, /\.action-btn\.liked\s*\{[^}]*animation:/s);
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
