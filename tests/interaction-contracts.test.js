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

test('like UI is optimistic, coalesces rapid toggles, and keeps the control interactive', () => {
  const toggle = between(core, 'window.toggleLike = function', 'function createLikeParticles');
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

test('like feedback uses lightweight particles without heart shaking', () => {
  const toggle = between(core, 'window.toggleLike = function', 'function createLikeParticles');
  const feedback = between(core, 'function animatePostLikeFeedback', 'function applyPostLikeIntent');
  const particles = between(core, 'function createLikeParticles', '// =====================');
  const feedbackCss = between(style, '/* Interaction feedback: like, publish', '#pubBtn.is-loading');
  assert.match(toggle, /applyPostLikeIntent\(pid,\s*nextLiked,\s*btn\)/);
  assert.doesNotMatch(feedback, /offsetWidth|like-heart-anim/);
  assert.doesNotMatch(toggle, /xtjAnimateLikeToggle/);
  assert.match(particles, /prefers-reduced-motion:\s*reduce/);
  assert.match(particles, /like-particle/);
  assert.match(particles, /--like-particle-x/);
  assert.match(particles, /--like-particle-y/);
  assert.match(particles, /animationend/);
  assert.doesNotMatch(feedbackCss, /transform:\s*scale/);
  assert.doesNotMatch(style, /\.action-btn\.liked\s*\{[^}]*animation:/s);
  assert.doesNotMatch(core, /heart-particle|like-heart-anim/);
});

test('header avatar keeps a fixed circular 24px footprint', () => {
  assert.match(style, /#authUI \.user-pill #myAvatar\s*\{[\s\S]*?inline-size:\s*24px !important;[\s\S]*?block-size:\s*24px !important;[\s\S]*?flex:\s*0 0 24px !important;[\s\S]*?aspect-ratio:\s*1 \/ 1;/);
  assert.match(style, /#authUI \.user-pill #myAvatar > img\s*\{[\s\S]*?object-fit:\s*cover !important;/);
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
