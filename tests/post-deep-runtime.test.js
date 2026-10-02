'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
const detail = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');
const profile = fs.readFileSync('js/core-parts/03-profile-report-ai.js', 'utf8');
const id = '8c1cb02d-74d0-4e45-9e15-17f5cf3aa812';
function between(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing runtime markers ${start}`);
  return source.slice(from, to);
}
function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
const turn = () => new Promise(resolve => setImmediate(resolve));
function likeRuntime() {
  const requests = [], counts = [], toasts = [], names = new Set();
  const button = { classList: { contains: n => names.has(n), toggle(n, on) { on ? names.add(n) : names.delete(n); } } };
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, currentDockTab: 'feed', deviceId: 'device', console: { error() {} },
    window: { xtjProtectedFetch(_path, options) { const body = deferred(); requests.push({ options, body }); return Promise.resolve({ ok: true, json: () => body.promise }); } },
    isUserMuted: () => false, showToast: t => toasts.push(t), getPostLikeButtons: () => [button], setPostLikePending() {},
    updatePostLikeUi(_id, on) { button.classList.toggle('liked', on); }, updatePostLikeCount(_id, n) { counts.push(n); },
    updateFeedStats() {}, touchUserSession() {}, scheduleLikeStatRefresh() {}, createLikeBlossom() {} };
  vm.runInNewContext(between(posts, '            var likeOperations', '            var likeBlossomSequence'), ctx);
  return { ctx, requests, counts, toasts, button };
}
test('rapid unlike keeps its optimistic count while the first like response arrives', async () => {
  const r = likeRuntime(); const task = r.ctx.window.toggleLike(r.button, id); await turn();
  r.ctx.window.toggleLike(r.button, id); r.requests[0].body.resolve({ ok: true, liked: true, like_count: 1 }); await turn();
  assert.equal(r.counts.at(-1), 0);
  r.requests[1].body.resolve({ ok: true, liked: false, like_count: 0 }); await task;
  assert.equal(r.button.classList.contains('liked'), false); assert.deepEqual(r.counts, [0, 0]);
});
test('late like JSON after A→B→A cannot send the queued intent or alter the new UI', async () => {
  const r = likeRuntime(); const old = r.ctx.window.toggleLike(r.button, id); await turn();
  r.ctx.window.toggleLike(r.button, id); r.ctx.currentUser = 'bob'; r.ctx._authStateEpoch++; r.ctx.currentUser = 'alice'; r.ctx._authStateEpoch++;
  r.requests[0].body.resolve({ ok: true, liked: true, like_count: 1 }); await turn();
  if (r.requests[1]) r.requests[1].body.resolve({ ok: true, liked: false, like_count: 0 }); await old;
  assert.equal(r.requests.length, 1); assert.deepEqual(r.counts, []); assert.deepEqual(r.toasts, []);
  const fresh = r.ctx.window.toggleLike(r.button, id); await turn(); assert.equal(r.requests.length, 2);
  r.requests[1].body.resolve({ ok: true, liked: true, like_count: 1 }); await fresh;
});
test('a failed old-account like cannot roll back a new-account like', async () => {
  const r = likeRuntime(); const old = r.ctx.window.toggleLike(r.button, id); await turn();
  r.ctx.currentUser = 'bob'; r.ctx._authStateEpoch++; r.button.classList.toggle('liked', false);
  const fresh = r.ctx.window.toggleLike(r.button, id); await turn(); assert.equal(r.requests.length, 2);
  r.requests[0].body.reject(new Error('old failure')); await old;
  assert.equal(r.button.classList.contains('liked'), true); assert.deepEqual(r.toasts, []);
  r.requests[1].body.resolve({ ok: true, liked: true, like_count: 1 }); await fresh;
});
test('comment patch coalescing renders the final burst state and leaves unrelated cards alone', () => {
  let version = 1, timerId = 0; const timers = new Map(), patches = [];
  const ctx = { window: {}, currentUser: 'alice', _authStateEpoch: 1, document: { getElementById: () => ({querySelector: () => ({})}) }, safePostSelector: () => '.post',
    patchSinglePostCard: key => { patches.push([key, version]); return true; },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(key) { timers.delete(key); } };
  vm.runInNewContext(between(posts, '            var _pendingCardPatchTimers', '            function hydrateCachedAvatarsForUsers'), ctx);
  ctx.window.__xtjSchedulePostCardPatch(id); version = 2; ctx.window.__xtjSchedulePostCardPatch(id); version = 3; ctx.window.__xtjSchedulePostCardPatch(id);
  for (const fn of timers.values()) fn(); assert.deepEqual(patches, [[id, 1], [id, 3]]);
});
function detailRuntime() {
  const body = { innerHTML: '' }, modal = { classList: { contains: () => true, add() {} } }, json = deferred(), rendered = [];
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, console: { error() {} }, encodeURIComponent,
    document: { getElementById: key => key === 'postDetailBody' ? body : key === 'postDetailModal' ? modal : {} },
    window: { xtjOptionalAuthFetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: () => json.promise }) },
    getXtjLoadingHtml: () => 'loading', escapeHtml: String, trackView() {}, renderPostDetail: post => rendered.push(post) };
  vm.runInNewContext(detail.slice(detail.indexOf('            var _postDetailReqSeq'), detail.lastIndexOf('        })();')), ctx);
  return { ctx, json, rendered, body };
}
test('private detail body arriving after identity changes is discarded', async () => {
  const r = detailRuntime(); const pending = r.ctx.window.openPostDetail(id); await turn();
  r.ctx.currentUser = 'bob'; r.ctx._authStateEpoch++; r.body.innerHTML = 'bob content';
  r.json.resolve({ ok: true, post: { id, user_name: 'alice', created_at: '2026-10-01', content: 'private' } }); await pending;
  assert.deepEqual(r.rendered, []); assert.equal(r.body.innerHTML, 'bob content');
});
test('closed details cannot be repopulated by a late request', async () => {
  const r = detailRuntime(); const pending = r.ctx.window.openPostDetail(id); await turn();
  r.ctx.window.__xtjPostDetailCurrentId = ''; r.ctx.document.getElementById('postDetailModal').classList.contains = () => false;
  r.json.resolve({ ok: true, post: { id, user_name: 'alice', created_at: '2026-10-01' } }); await pending; assert.deepEqual(r.rendered, []);
});
function scrollRuntime() {
  const appended = [], nodes = [], feed = { children: nodes, insertBefore() {}, appendChild() {} };
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: String(i) }));
  const ctx = { feedEndReached: true, feedPageFetchPending: false, feedLoadMoreFailed: false, feedAllPosts: rows,
    feedAllComments: [], feedAllLikes: [], feedPage: 1, FEED_PAGE_SIZE: 20, feedLoadRequestId: 1, _authStateEpoch: 1, currentUser: 'alice', console,
    document: { getElementById: key => key === 'feed' ? feed : null, createElement: () => ({ setAttribute() {}, remove() {}, style: {} }) },
    getFeedRenderedSliceStart: () => 20 + appended.length, getFilteredPosts: p => p, getRenderableComments: () => [],
    appendMorePosts: p => appended.push(...p), writeFeedCacheSnapshot() {}, ensureFeedCoverageForVisibleSlice: async () => { throw new Error('must not fetch exhausted feed'); } };
  vm.runInNewContext(between(posts, '            loadMoreFeedPosts = async function', '            appendMorePosts = function'), ctx);
  return { ctx, appended };
}
test('cached posts beyond the first visible page remain expandable after the server reaches its end', async () => {
  const r = scrollRuntime(); await r.ctx.loadMoreFeedPosts(); await r.ctx.loadMoreFeedPosts();
  assert.equal(r.appended.length, 25); assert.deepEqual(r.appended.map(p => p.id), Array.from({ length: 25 }, (_, i) => String(i + 20)));
});
test('late comment deletion cannot mutate a switched account or trigger a full feed rebuild', async () => {
  const json = deferred(), patches = [], writes = [], renders = [];
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, feedAllComments: [{ id: 'c', post_id: id }], confirm: () => true, AbortController, setTimeout, clearTimeout,
    console: { error() {} }, window: { xtjProtectedFetch: async () => ({ ok: true, json: () => json.promise }), __xtjSchedulePostCardPatch: p => patches.push(p) },
    writeFeedCacheSnapshot: () => writes.push(true), renderFeedFromMemoryState: () => { renders.push(true); return Promise.resolve(); }, loadPersonalRecordSummary() {}, showToast() {} };
  vm.runInNewContext(between(profile, '            window.deleteFeedComment', '            window.deleteProfileComment'), ctx);
  const task = ctx.window.deleteFeedComment('c', { disabled: false, textContent: '删除' }); await turn(); ctx.currentUser = 'bob'; ctx._authStateEpoch++;
  ctx.feedAllComments = [{ id: 'c', post_id: id, content: 'bob state' }]; json.resolve({ ok: true }); await task;
  assert.equal(ctx.feedAllComments.length, 1); assert.deepEqual(writes, []); assert.deepEqual(renders, []);
});
test('successful comment deletion patches its card without discarding other drafts', async () => {
  const patches = [], renders = [];
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, feedAllComments: [{ id: 'c', post_id: id }], confirm: () => true, AbortController, setTimeout, clearTimeout,
    console, window: { xtjProtectedFetch: async () => ({ ok: true, json: async () => ({ ok: true }) }), __xtjSchedulePostCardPatch: p => patches.push(p) },
    writeFeedCacheSnapshot() {}, renderFeedFromMemoryState: () => { renders.push(true); return Promise.resolve(); }, loadPersonalRecordSummary() {}, showToast() {} };
  vm.runInNewContext(between(profile, '            window.deleteFeedComment', '            window.deleteProfileComment'), ctx);
  await ctx.window.deleteFeedComment('c', { textContent: '删除' }); assert.deepEqual(patches, [id]); assert.deepEqual(renders, []); assert.equal(ctx.feedAllComments.length, 0);
});

test('a shared device cannot make another account’s like appear as mine or remove its record', () => {
  const ctx = { window: {}, currentUser: 'bob', deviceId: 'shared-device' };
  vm.runInNewContext(between(posts, '            function getCurrentLikeIdentityValues', '            function buildLikeButtonContent'), ctx);
  assert.equal(ctx.isLikeOwnedByCurrentUser({ post_id: id, user_name: 'alice', actor_key: 'shared-device' }, id), false);
  assert.equal(ctx.isPostLikedByCurrentUser({ [id + '|shared-device']: true, [id + '|alice']: true }, id), false);
  assert.equal(ctx.isPostLikedByCurrentUser({ [id + '|bob']: true }, id), true);
});

test('late load-more completion after a refresh cannot unlock a new request or append stale cards', async () => {
  const r = scrollRuntime(), coverage = deferred();
  r.ctx.feedEndReached = false; r.ctx.feedAllPosts = r.ctx.feedAllPosts.slice(0, 20);
  r.ctx.ensureFeedCoverageForVisibleSlice = () => coverage.promise;
  const old = r.ctx.loadMoreFeedPosts(); await turn();
  r.ctx.feedLoadRequestId++; r.ctx.feedPageFetchPending = true;
  coverage.resolve(); await old;
  assert.equal(r.ctx.feedPageFetchPending, true); assert.deepEqual(r.appended, []);
});

test('comment updates for off-screen cards leave all visible drafts alone', () => {
  let timer, patches = 0, renders = 0;
  const ctx = { window: {}, currentUser: 'alice', _authStateEpoch: 1,
    document: { getElementById: () => ({ querySelector: () => null }) }, safePostSelector: () => '.post',
    patchSinglePostCard: () => { patches++; return false; }, renderFeedFromMemoryState: async () => renders++,
    setTimeout: fn => { timer = fn; return 1; } };
  vm.runInNewContext(between(posts, '            var _pendingCardPatchTimers', '            function hydrateCachedAvatarsForUsers'), ctx);
  ctx.window.__xtjSchedulePostCardPatch(id); ctx.window.__xtjSchedulePostCardPatch(id); timer();
  assert.equal(patches, 0); assert.equal(renders, 0);
});

test('a pin waiting for auth must not send under the new account', async () => {
  const auth = deferred(), requests = [], toasts = [];
  const ctx = { window: { ensureProtectedOperationAuth: () => auth.promise, xtjProtectedFetch: async () => requests.push(true) },
    currentUser: 'alice', _authStateEpoch: 1, showToast: t => toasts.push(t), console };
  vm.runInNewContext(between(posts, '            function capturePostActionIdentity', '            function applyPostLikeIntent') +
    between(posts, '            // Final pin action:', '            // G10 修复'), ctx);
  const task = ctx.window.togglePostPin(id, { textContent: '置顶' }); await turn();
  ctx.currentUser = 'bob'; ctx._authStateEpoch++;
  auth.resolve({ ok: true }); await task;
  assert.deepEqual(requests, []); assert.deepEqual(toasts, []); assert.equal(ctx.window.isPinningPost, false);
});

test('late visibility update JSON is rejected before verification and cache/UI writes', async () => {
  const json = deferred();
  const ctx = { window: { xtjProtectedFetch: async () => ({ ok: true, json: () => json.promise }) }, currentUser: 'alice', _authStateEpoch: 1,
    normalizePost: p => p, buildPostStorageContent: (_p, text) => text };
  vm.runInNewContext(between(posts, '            function capturePostActionIdentity', '            function applyPostLikeIntent') +
    between(posts, '            async function updatePostRecord', '            function getRenderableComments'), ctx);
  const task = ctx.updatePostRecord({ id, content: 'secret', visibility: 'public' }, { visibility: 'private' }); await turn();
  ctx.currentUser = 'bob'; ctx._authStateEpoch++; json.resolve({ ok: true, data: { id, visibility: 'private' } });
  await assert.rejects(task, error => error.code === 'identity_changed');
});

test('logout clears private feed memory, cached detail and pending repaint tasks immediately', () => {
  const nodes = { feed: { textContent: 'private feed' } }, cancelled = [];
  const ctx = { currentUser: '', _authStateEpoch: 2, window: { _xtjFeedDomTrimmed: 12, __xtjCancelPostDetail: () => cancelled.push('detail'),
    __xtjRunMentionCleanups: () => cancelled.push('mention') },
    likeOperations: { old: {} }, _persistLikesTimer: 10, feedCacheWriteTimer: null, _pendingCardPatchTimers: { [id]: { timer: 11 } },
    postInfoCache: { [id]: { content: 'private' } }, clearTimeout: value => cancelled.push(value),
    document: { getElementById: key => nodes[key], querySelectorAll: () => [] }, closePostToolsMenu() {}, resetPostActionModals: () => cancelled.push('modal'),
    resetFeedDomTrimmed() { ctx.window._xtjFeedDomTrimmed = 0; }, markFeedStateChanged() {} };
  vm.runInNewContext(between(posts, '            let feedPage = 1;', '            function markFeedStateChanged()') +
    `\nfeedAllPosts = [{id: '${id}', content: 'private'}]; feedAllComments = [{content:'private comment'}]; feedLoadRequestId = 5; feedPageFetchPending = true;`, ctx);
  ctx.window.__xtjResetPostState();
  assert.equal(vm.runInNewContext('feedAllPosts.length + feedAllComments.length + feedAllLikes.length', ctx), 0);
  assert.equal(vm.runInNewContext('feedLoadRequestId', ctx), 6); assert.equal(vm.runInNewContext('feedPageFetchPending', ctx), false);
  assert.equal(nodes.feed.textContent, ''); assert.equal(Object.keys(ctx.postInfoCache).length, 0); assert.equal(ctx.window._xtjFeedDomTrimmed, 0);
  assert.ok(cancelled.includes('detail') && cancelled.includes('mention') && cancelled.includes(10) && cancelled.includes(11));
});

function cacheRuntime() {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: String(i).padStart(3, '0'), created_at: new Date(Date.UTC(2026, 9, 2, 12, 0, 0) - i * 1000).toISOString(), content: 'post', user_name: 'alice' }));
  let saved;
  const ctx = { window: {}, CACHE_KEY: 'cache', FEED_PAGE_SIZE: 20, feedAllPosts: rows, feedAllComments: [], feedAllLikes: [], feedEndReached: true,
    feedLoadedPages: [{ offset: 0, postIds: rows.slice(0, 20).map(p => p.id), nextOffset: 20, nextCursor: { created_at: rows[19].created_at, id: rows[19].id } }],
    feedNextCursor: { created_at: rows[44].created_at, id: rows[44].id }, normalizePosts: p => p, isSystemPost: () => false,
    toLightweightFeedPost: p => p, localStorage: { setItem: (_key, value) => { saved = JSON.parse(value); } }, console };
  vm.runInNewContext(between(posts, '            function getFeedResumeCursor', '            function writeFeedCacheSnapshot') +
    between(posts, '            function normalizeFeedSnapshotCache', '            function hydrateFeedStateFromSnapshot'), ctx);
  return { ctx, rows, saved: () => saved };
}
test('first-page-only cache never stores the final loaded page’s resume cursor or end state', () => {
  const r = cacheRuntime(); r.ctx.persistFeedCacheSnapshotNow(); const snapshot = r.saved();
  assert.equal(snapshot.data.posts.length, 20); assert.equal(snapshot.data.nextCursor.id, '019'); assert.equal(snapshot.data.nextOffset, 20); assert.equal(snapshot.data.endReached, false);
  const hydrated = r.ctx.normalizeFeedSnapshotCache(snapshot); const nextPage = r.rows.filter(p => p.created_at < hydrated.data.nextCursor.created_at).slice(0, 20);
  assert.equal(nextPage[0].id, '020'); assert.equal(nextPage.at(-1).id, '039');
});
test('older v7 caches with mismatched cursors resume after the oldest cached post, including pinned ordering', () => {
  const r = cacheRuntime(); const cached = r.rows.slice(0, 20); cached.unshift(cached.pop());
  const snapshot = r.ctx.normalizeFeedSnapshotCache({ version: 7, data: { posts: cached, nextCursor: r.ctx.feedNextCursor, nextOffset: 20, endReached: false } });
  assert.equal(snapshot.data.nextCursor.id, '019');
});

test('post tool JSON cannot reveal a previous account’s private text after a switch', async () => {
  const json = deferred();
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, window: { xtjProtectedFetch: async () => ({ ok: true, json: () => json.promise }) } };
  vm.runInNewContext(between(posts, '            function capturePostActionIdentity', '            function applyPostLikeIntent') +
    between(posts, '            function postToolFetch(body)', '            window.requestPostTranslation'), ctx);
  const pending = ctx.postToolFetch({ post_id: id, action: 'translate' }); await turn();
  ctx.currentUser = 'bob'; ctx._authStateEpoch++; json.resolve({ translation: 'private translation' });
  await assert.rejects(pending, error => error.code === 'identity_changed');
});

test('post AI stream stops reading when the account changes, before rendering a late chunk', async () => {
  const chunk = deferred(); let cancelled = 0;
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, TextDecoder, AbortController,
    window: { xtjProtectedFetch: async () => ({ ok: true, body: { getReader: () => ({ read: () => chunk.promise, cancel: async () => cancelled++ }) } }) } };
  vm.runInNewContext(between(posts, '            function capturePostActionIdentity', '            function applyPostLikeIntent') +
    between(posts, '            function runPostAiRequest', '            window.openPostAiChat'), ctx);
  const session = { output: { textContent: '', classList: { remove() {}, add() {} }, isConnected: true }, controller: new AbortController(), requestId: 0, isClosed: false };
  ctx.runPostAiRequest(session, { post_id: id }); await turn(); ctx.currentUser = 'bob'; ctx._authStateEpoch++;
  session.output.textContent = 'new account'; chunk.resolve({ value: new TextEncoder().encode('event: delta\ndata: {"content":"private"}\n\n'), done: false }); await turn();
  assert.equal(session.output.textContent, 'new account'); assert.equal(cancelled, 1);
});

test('a bounded filter scan exposes a continuation when the sentinel remains visible', async () => {
  const r = scrollRuntime(), controls = [];
  r.ctx.feedEndReached = false; r.ctx.feedAllPosts = r.ctx.feedAllPosts.slice(0, 20);
  r.ctx.ensureFeedCoverageForVisibleSlice = async () => true;
  r.ctx.showFeedSearchContinueControl = () => controls.push(true);
  await r.ctx.loadMoreFeedPosts(); assert.deepEqual(controls, [true]); assert.equal(r.ctx.feedPage, 1);
});

test('old pin completion cannot release a newer account’s pin lock', async () => {
  const first = deferred(), second = deferred(), requests = [], auth = [first, second];
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, feedAllPosts: [{ id, user_name: 'bob', is_pinned: true }], ADMIN_NAME: 'xxz',
    window: { ensureProtectedOperationAuth: () => auth.shift().promise, xtjProtectedFetch: async () => { requests.push(true); return { ok: true, json: async () => ({ ok: true, data: { id, is_pinned: false } }) }; } },
    normalizePosts: p => p, findBySafePostSelector: () => null, syncPinnedPostIntoFeedState: () => true,
    writeFeedCacheSnapshot() {}, rebuildFeedFromCurrentState: async () => {}, refreshPostDetailIfActive: async () => {}, showToast() {}, console };
  vm.runInNewContext(between(posts, '            function capturePostActionIdentity', '            function applyPostLikeIntent') +
    between(posts, '            // Final pin action:', '            // G10 修复'), ctx);
  const old = ctx.window.togglePostPin(id); await turn(); ctx.currentUser = 'bob'; ctx._authStateEpoch++;
  const fresh = ctx.window.togglePostPin(id); await turn();
  first.resolve({ ok: true }); await old;
  assert.equal(ctx.window.isPinningPost, true); assert.deepEqual(requests, []);
  second.resolve({ ok: true }); await fresh; assert.equal(ctx.window.isPinningPost, false); assert.equal(requests.length, 1);
});

test('delete timeout during JSON body reading still verifies the authoritative deletion status', async () => {
  const session = {}, button = { textContent: '确认删除' }, confirmed = [], checks = [];
  const ctx = { currentUser: 'alice', _authStateEpoch: 1, delPostId: id, delOwnerKey: 'alice', feedAllPosts: [{ id, user_name: 'alice' }],
    document: { getElementById: () => button }, window: { __xtjDeleteInProgress: false, __xtjPostDeleteRequestTimeoutMs: 10,
      xtjProtectedFetch: async (_url, options) => ({ ok: true, json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { const error = new Error('body aborted'); error.name = 'AbortError'; reject(error); }, { once: true })) }) },
    getDeleteSession: () => session, canDeletePost: () => true, findPostCardElement: () => null, showToast() {}, AbortController, setTimeout, clearTimeout,
    console: { warn() {}, error() {} }, confirmPostDeleteStatus: async () => { checks.push(true); return { confirmed: true, deleted: true }; },
    cleanupDeleteSession() { clearTimeout(session.timeoutId); session.cancelled = true; },
    applyConfirmedPostDeletion(postId) { confirmed.push(postId); clearTimeout(session.timeoutId); session.cancelled = true; } };
  vm.runInNewContext(between(posts, '            function capturePostActionIdentity', '            function applyPostLikeIntent') +
    between(posts, '            var delBtn = document.getElementById("delBtn");', '            window.openModal'), ctx);
  await button.onclick(); assert.deepEqual(checks, [true]); assert.deepEqual(confirmed, [id]);
});
