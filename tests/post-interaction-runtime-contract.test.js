const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

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

test('comment keeps its target id and patches only the affected card after success', () => {
  assert.match(core, /var targetPostId = String\(postId \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(core, /JSON\.stringify\(\{ post_id: targetPostId, content: content \}\)/);
  assert.match(core, /result\.data && String\(result\.data\.post_id\) === targetPostId/);
  assert.match(core, /feedAllComments[\s\S]*window\.__xtjSchedulePostCardPatch\(targetPostId\)/);
  const commentSubmit = between('var insertedComment = result.data', 'requestAnimationFrame(function() {');
  assert.doesNotMatch(commentSubmit, /await renderFeedFromMemoryState\(\)/);
  // ★ 2026-09-27：P12 修复后，评论节点不再用 `data-post-id="' + targetPostId` 裸拼选择器
  //   （未校验的 id 拼进 querySelector 会抛 SyntaxError 或命中错误元素），改为经
  //   findBySafePostSelector(targetPostId)（内部走 CSS.escape + 手工转义兜底）。
  //   断言意图不变：插入的评论必须绑定到正确的帖子卡片。
  assert.match(core, /feedAllComments[\s\S]*findBySafePostSelector\(targetPostId\)/);
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
  assert.match(like, /operation\.desired = operation\.confirmed;\s*operation\.requested = operation\.confirmed;/);
});

test('like failure followed by another tap sends the intended like state', async () => {
  const likeRuntime = between('var likeOperations = Object.create(null);', 'var likeBlossomSequence = 0;');
  const requests = [];
  const classNames = new Set();
  const button = {
    classList: {
      contains(name) { return classNames.has(name); },
      toggle(name, force) { if (force) classNames.add(name); else classNames.delete(name); },
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); }
    },
    setAttribute() {}
  };
  const runtime = {
    window: {
      xtjProtectedFetch: async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (requests.length === 1) {
          return { ok: false, json: async () => ({ ok: false, error: 'temporary_failure' }) };
        }
        return { ok: true, json: async () => ({ ok: true, liked: true, like_count: 1 }) };
      }
    },
    currentUser: 'alice',
    currentDockTab: 'feed',
    deviceId: 'device-a',
    isUserMuted: () => false,
    showToast() {},
    getPostLikeButtons: () => [button],
    setPostLikePending() {},
    updatePostLikeUi(_postId, liked) {
      button.classList.toggle('liked', liked);
    },
    updatePostLikeCount() {},
    updateFeedStats() {},
    touchUserSession() {},
    scheduleLikeStatRefresh() {},
    createLikeBlossom() {},
    console: { error() {}, warn() {} },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(likeRuntime + '\nfunction createLikeBlossom() {}', runtime);
  const postId = '8c1cb02d-74d0-4e45-9e15-17f5cf3aa812';
  await runtime.window.toggleLike(button, postId);
  assert.equal(button.classList.contains('liked'), false, 'failed optimistic like rolls back');
  await runtime.window.toggleLike(button, postId);
  assert.deepEqual(requests.map((request) => request.liked), [true, true]);
  assert.equal(button.classList.contains('liked'), true, 'retry leaves the UI in the confirmed liked state');
});

test('post card comment patch preserves the root node and updates only stats/comments', () => {
  const patch = between('function patchSinglePostCard(postId)', 'window.__xtjPatchSinglePostCard = patchSinglePostCard;');
  assert.match(patch, /oldStats\.innerHTML = newStats\.innerHTML/);
  assert.match(patch, /oldComments\.replaceWith\(newComments\)/);
  assert.doesNotMatch(patch, /card\.parentNode\.replaceChild/);
});

test('feed page requests use an authenticated keyset cursor after the first page', () => {
  assert.match(core, /mayReuseAnonymousEarlyFeed = !knownUser && !hasToken/);
  assert.match(core, /page === 0 && mayReuseAnonymousEarlyFeed/);
  assert.match(core, /feedPath \+= '&cursor_created_at=' \+ encodeURIComponent\(requestCursor\.created_at\)/);
  assert.match(core, /'&cursor_id=' \+ encodeURIComponent\(requestCursor\.id\) \+ '&offset=' \+ start/);
  assert.match(server, /cursorTimestampValid = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T/);
  assert.match(server, /created_at\.lt\.' \+ after\.created_at \+ ',and\(created_at\.eq\.' \+ after\.created_at \+ ',id\.lt\.' \+ after\.id/);
  assert.match(server, /next_cursor: nextCursor/);
  assert.match(server, /query = query\.or\('is_deleted\.is\.null,is_deleted\.eq\.false'\)/);
});

test('private detail requests use optional auth and detail data carries complete counts/IP fields', () => {
  const detail = fs.readFileSync(path.join(__dirname, '..', 'js', 'core-parts', '06-chat-and-nav.js'), 'utf8');
  assert.match(detail, /xtjOptionalAuthFetch\(detailPath/);
  assert.match(server, /select\('id,user_name,created_at', \{ count: 'exact' \}\)/);
  assert.match(server, /ip_province: post\.ip_province/);
  assert.match(server, /ip_lookup_started_at: post\.ip_lookup_started_at/);
});

test('IP retry remains pending until durable backend retries finish and refreshes only IP DOM', () => {
  const ip = between('function refreshPublishedPostCard(post)', 'function schedulePublishedPostIpRefresh(postId)');
  assert.match(ip, /oldIp\.textContent = nextIp\.textContent/);
  assert.doesNotMatch(ip, /existing\.replaceWith/);
  const refresh = between('function schedulePublishedPostIpRefresh(postId)', 'function refreshPendingFeedIpPosts(posts)');
  assert.match(refresh, /var maxAttempts = 19;/);
  const delayMatch = refresh.match(/var attemptDelaysMs = \[([^\]]+)\]/);
  assert.ok(delayMatch, 'IP refresh delay schedule is missing');
  const delayWindow = delayMatch[1].split(',').map(Number).reduce((sum, value) => sum + value, 450);
  assert.ok(delayWindow > 360000, 'IP refresh window must outlast backend retries and resolver time');
  assert.match(server, /ip_next_retry_at/);
  assert.match(server, /ip_lookup_ip_enc/);
  assert.match(server, /setInterval\(function\(\) \{\s*processDueIpRegionRetries/);
  assert.doesNotMatch(server, /超过 2 分钟未解析的转为 failed/);
});

test('feed load-more failure shows a retry entry and pauses the sentinel loop', () => {
  const loadMore = between('loadMoreFeedPosts = async function', 'appendMorePosts = function');
  // 失败后置位 feedLoadMoreFailed，哨兵不再自动重复触发
  assert.match(loadMore, /feedLoadMoreFailed = true;/);
  assert.match(loadMore, /加载更多失败，点击重试/);
  assert.match(loadMore, /feedLoadMoreFailed = false;[\s\S]*?loadMoreFeedPosts\(\)/);
  // 入口处与哨兵回调都检查失败标记
  assert.match(core, /feedPageFetchPending \|\| feedLoadMoreFailed\) return;/);
  assert.match(core, /entry\.isIntersecting && !feedLoadMoreFailed &&/);
  assert.match(core, /!feedEndReached \|\| getFeedRenderedSliceStart\(\) < getFilteredPosts/);
});

test('like button uses the same SVG on initial render and subsequent toggles', () => {
  const actions = between('function buildPostActionHtml(post, isLiked, canDelete)', 'var activePostToolsMenu = null;');
  assert.match(actions, /buildLikeButtonContent\(isLiked\)/);
  const state = between('function buildLikeButtonContent(liked)', '// ★ 2026-09-27');
  assert.match(state, /class="post-like-icon"/);
  assert.match(state, /btn\.innerHTML = buildLikeButtonContent\(liked\)/);
  assert.match(state, /label\.textContent = liked \? '已赞' : '点赞'/);
  assert.match(state, /btn\.setAttribute\('aria-label', liked \? '取消点赞' : '点赞'\)/);
});

test('geolocation fallback button text is not mojibake', () => {
  // 修复前：备用定位失败后按钮显示乱码"馃搷 娣诲姞浣嶇疆"
  assert.doesNotMatch(core, /馃搷/);
  assert.match(core, /restorePostLocationButton/);
});
