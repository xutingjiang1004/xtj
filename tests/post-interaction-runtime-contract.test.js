const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

function between(start, end) {
  const startIndex = core.indexOf(start);
  const endIndex = core.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return core.slice(startIndex, endIndex);
}

test('publish and comment handlers reject duplicate in-flight submissions', () => {
  const publish = between('window.doPublish = async function', 'loadFeed = async function');
  assert.match(publish, /btn\.disabled\s*\|\|\s*btn\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(core, /btn\.onclick = async function\(\) \{[\s\S]*?if \(btn\.disabled\) return/);
});

test('comment keeps its target id and inserts the canonical response locally', () => {
  assert.match(core, /var targetPostId = String\(postId \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(core, /JSON\.stringify\(\{ post_id: targetPostId, content: content \}\)/);
  assert.match(core, /result\.data && String\(result\.data\.post_id\) === targetPostId/);
  assert.match(core, /feedAllComments[\s\S]*await renderFeedFromMemoryState\(\)/);
  assert.match(core, /data-post-id="' \+ targetPostId/);
});

test('delete timeout aborts the request and confirms authoritative server state', () => {
  const deletion = between('async function confirmPostDeleteStatus', 'window.openModal = function');
  assert.match(deletion, /AbortController/);
  assert.match(deletion, /\/api\/post\/delete-status/);
  assert.match(deletion, /delete request timed out; checking locally/);
  assert.match(deletion, /result\.deleted === true && result\.exists === false/);
  assert.doesNotMatch(deletion, /Promise\.race\(\[deletePromise, requestTimeout\]\)/);
});

test('pin transition scrolls the actual posts panel before rebuilding and animates the replacement card', () => {
  const pin = between('function pinMotionReduced', 'window.togglePostVisibility = async function');
  assert.match(pin, /document\.getElementById\('panelPosts'\)/);
  assert.match(pin, /actualSurface\.scrollTo\(\{ top: targetTop, behavior: 'smooth' \}\)/);
  assert.match(pin, /waitForPinScroll\(surface, targetTop, 620\)/);
  assert.match(pin, /post-pin-departing/);
  assert.match(pin, /post-pin-arriving/);
  assert.match(pin, /await rebuildFeedFromCurrentState\(\)[\s\S]*?await refreshPostDetailIfActive\(normalizedPostId\)[\s\S]*?completePinnedPostTransition\(normalizedPostId\)/);
  assert.doesNotMatch(pin, /window\.scrollTo\(/);
});

test('pin transition handles edge cases like concurrent requests and animation cleanup', () => {
  const pin = between('function pinMotionReduced', 'window.togglePostVisibility = async function');
  
  // Check for in-flight lock
  assert.match(pin, /window\.isPinningPost/);
  // Check for finally block cleanup
  assert.match(pin, /finally\s*\{[\s\S]*?postEl\.classList\.remove\('post-pin-departing'\)/);
  // Check for scroll completion logic
  assert.match(pin, /Math\.abs\(getScroll\(\) - targetTop\) <= 2/);
  assert.match(pin, /addEventListener\('scrollend'/);
  // Check for frontend failure differentiation
  assert.match(pin, /serverSucceeded/);
});

test('post tools menu closes when any scroll container, viewport, or page visibility changes', () => {
  const tools = between('var activePostToolsMenu = null;', 'var activePostAiSession = null;');
  assert.match(tools, /document\.addEventListener\('scroll',\s*closePostToolsMenu,\s*\{ capture: true, passive: true \}\)/);
  assert.match(tools, /window\.addEventListener\('resize',\s*closePostToolsMenu/);
  assert.match(tools, /visualViewport\.addEventListener\('scroll',\s*closePostToolsMenu/);
  assert.match(tools, /document\.hidden\) closePostToolsMenu\(\)/);
});

test('like operation resets running flag so a failed sync never locks the button permanently', () => {
  const like = between('function flushPostLikeOperation(postId, operation)', 'window.toggleLike = function');
  // 修复前：operation.running 仅在 desired===confirmed 删除条目时隐式存在，失败竞态下永不复位，
  // 导致该帖子点赞从此不再发请求（与服务器永久失同步）。
  assert.match(like, /operation\.running = false;/);
  assert.match(like, /setPostLikePending\(postId, false\);/);
  assert.match(like, /if \(likeOperations\[postId\] === operation &&\s*operation\.desired === operation\.confirmed &&\s*operation\.requested === operation\.confirmed\) \{[\s\S]*?delete likeOperations\[postId\];/);
  // 失败路径回滚 UI 后仍可重试（下次点击重新 flush）
  assert.match(like, /if \(operation\.desired !== operation\.confirmed\) \{[\s\S]*?applyPostLikeIntent\(postId, operation\.confirmed\);/);
});

test('feed load-more failure shows a retry entry and pauses the sentinel loop', () => {
  const loadMore = between('loadMoreFeedPosts = async function', 'appendMorePosts = function');
  // 失败后置位 feedLoadMoreFailed，哨兵不再自动重复触发
  assert.match(loadMore, /feedLoadMoreFailed = true;/);
  assert.match(loadMore, /加载更多失败，点击重试/);
  assert.match(loadMore, /feedLoadMoreFailed = false;[\s\S]*?loadMoreFeedPosts\(\)/);
  // 入口处与哨兵回调都检查失败标记
  assert.match(core, /feedPageFetchPending \|\| feedLoadMoreFailed\) return;/);
  assert.match(core, /!feedEndReached && !feedLoadMoreFailed/);
});

test('like button keeps the same emoji shape between first render and toggles', () => {
  const actions = between('function buildPostActionHtml(post, isLiked, canDelete)', 'var activePostToolsMenu = null;');
  // 初次渲染与 setLikeButtonState 统一使用 emoji（修复前初渲染是中文"点赞/已赞"，点击后变 emoji）
  assert.match(actions, /isLiked \? '❤️' : '🤍'/);
  assert.match(core, /btn\.textContent = liked \? '❤️' : '🤍'/);
});

test('geolocation fallback button text is not mojibake', () => {
  // 修复前：备用定位失败后按钮显示乱码"馃搷 娣诲姞浣嶇疆"
  assert.doesNotMatch(core, /馃搷/);
  assert.match(core, /📍 添加位置/);
});
