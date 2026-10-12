'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function fixture(run) {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  try {
    await f.page.evaluate(() => window.loadFeed(true));
    await run(f);
    assert.deepEqual(f.errors, []);
  } finally {
    if (f.held) { f.held.release(); await f.held.task; }
    await f.close();
  }
}

async function heldFeed(f) {
  let release, started, count = 0;
  const start = new Promise(resolve => { started = resolve; });
  await f.page.route(/\/api\/feed(?:\?|$)/, async route => {
    const json = JSON.parse(JSON.stringify({ ok: true, posts: f.posts, comments: f.comments, likes: f.likes,
      next_offset: f.posts.length, next_cursor: null, endReached: true, total_post_count: f.posts.length }));
    if (++count === 1) { started(); await new Promise(resolve => { release = resolve; }); }
    await route.fulfill({ json });
  });
  const held = { release: () => { if (release) release(); }, task: f.page.evaluate(() => window.loadFeed(true)).then(() => null, error => error.message) };
  f.held = held;
  let timer;
  try { await Promise.race([start, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('feed request did not start')), 10000); })]); }
  finally { clearTimeout(timer); }
  return { finish: async () => { held.release(); assert.equal(await held.task, null); }, requests: () => count };
}

test('a stale refresh cannot undo a confirmed post pin', { timeout: 40000 }, async () => fixture(async f => {
  const id = f.posts[0].id, pending = await heldFeed(f);
  await f.page.route('**/api/post/pin', route => {
    Object.assign(f.posts[0], { is_pinned: true, pinned_at: '2026-10-12T00:00:00Z' });
    return route.fulfill({ json: { ok: true, data: f.posts[0], unpinned_ids: [] } });
  });
  await f.page.evaluate(id => window.togglePostPin(id, document.querySelector('#feed .pin')), id);
  assert.equal(await f.page.locator('#feed .post-pin-badge').count(), 1);
  await pending.finish();
  assert.equal(await f.page.locator('#feed .post-pin-badge').count(), 1);
  assert.equal(await f.page.locator('#feed .pin').textContent(), '取消置顶');
}));

test('a stale refresh cannot undo a confirmed post like', { timeout: 40000 }, async () => fixture(async f => {
  const id = f.posts[0].id, page = f.page, pending = await heldFeed(f);
  await page.evaluate(id => window.toggleLike(document.querySelector('#feed .post[data-post-id="' + id + '"] .like-btn'), id), id);
  assert.equal(await page.locator('#feed .like-btn').getAttribute('aria-pressed'), 'true');
  await pending.finish();
  assert.equal(f.likes.some(l => l.user_name === 'alice' && l.post_id === id), true);
  assert.equal(await page.locator('#feed .like-btn').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#feed .post-stats-text').textContent(), /点赞 1/);
}));

test('a failed refresh preserves a confirmed like rather than reverting to an older disk snapshot', { timeout: 40000 }, async () => fixture(async f => {
  await f.page.evaluate(() => {
    persistFeedCacheSnapshotNow();
    const previous = window.safeStorage.get('xtj_feed_cache_v8'), get = window.safeStorage.get;
    window.safeStorage.get = function(key) { return key === 'xtj_feed_cache_v8' ? previous : get.call(this, key); };
  });
  await f.page.evaluate(id => window.toggleLike(document.querySelector('#feed .like-btn'), id), f.posts[0].id);
  await f.page.route(/\/api\/feed(?:\?|$)/, route => route.fulfill({ status: 402, json: {
    ok: false, code: 'egress_quota_exceeded', error: '服务暂时受限，请等待恢复', retryable: false
  } }));
  await f.page.evaluate(() => loadFeed(true));
  assert.equal(await f.page.locator('#feed .like-btn').getAttribute('aria-pressed'), 'true');
  assert.match(await f.page.locator('#feed .post-stats-text').textContent(), /点赞 1/);
}));

test('a failed refresh shows a status even when no disk snapshot is available', { timeout: 40000 }, async () => fixture(async f => {
  await f.page.evaluate(() => {
    const get = window.safeStorage.get;
    window.safeStorage.get = function(key) { return key === 'xtj_feed_cache_v8' ? null : get.call(this, key); };
  });
  await f.page.route(/\/api\/feed(?:\?|$)/, route => route.fulfill({ status: 402, json: {
    ok: false, code: 'egress_quota_exceeded', error: '服务暂时受限，请等待恢复', retryable: false
  } }));
  await f.page.evaluate(() => loadFeed(true));
  assert.equal(await f.page.locator('#feed .post').count(), 1);
  assert.equal(await f.page.locator('#feedStaleNotice').count(), 1);
  assert.equal(await f.page.locator('#feedStaleNotice').getAttribute('role'), 'status');
  await f.page.unroute(/\/api\/feed(?:\?|$)/);
  await f.page.route(/\/api\/feed(?:\?|$)/, route => route.fulfill({ status: 503, json: { ok: false, error: 'temporary failure', retryable: true } }));
  await f.page.route('**/test-supabase/rest/v1/posts**', route => route.fulfill({ status: 503, json: { message: 'temporary database failure' } }));
  await f.page.evaluate(() => loadFeed(true));
  assert.equal(await f.page.locator('#feedStaleNotice').getAttribute('role'), 'button');
  assert.equal(await f.page.locator('#feedStaleNotice').getAttribute('tabindex'), '0');
  await f.page.unroute(/\/api\/feed(?:\?|$)/);
  await f.page.route(/\/api\/feed(?:\?|$)/, route => route.fulfill({ status: 402, json: {
    ok: false, code: 'egress_quota_exceeded', error: '服务暂时受限，请等待恢复', retryable: false
  } }));
  await f.page.evaluate(() => loadFeed(true));
  assert.equal(await f.page.locator('#feedStaleNotice').getAttribute('role'), 'status');
  assert.equal(await f.page.locator('#feedStaleNotice').getAttribute('tabindex'), null);
  assert.equal(await f.page.locator('#feedStaleNotice').evaluate(node => node.onclick), null);
}));

test('a refresh waits for a pending like and then renders its confirmed state', { timeout: 40000 }, async () => fixture(async f => {
  let release, started;
  const start = new Promise(resolve => { started = resolve; });
  await f.page.route('**/api/post/like', async route => {
    started(); await new Promise(resolve => { release = resolve; }); await route.fallback();
  });
  const pending = await heldFeed(f);
  try {
    await f.page.evaluate(id => { window.pendingLikeTask = window.toggleLike(document.querySelector('#feed .like-btn'), id); }, f.posts[0].id);
    await start;
    f.held.release();
    await f.page.waitForTimeout(100);
    assert.equal(await f.page.locator('#feed .like-btn').getAttribute('aria-pressed'), 'true');
    release(); await pending.finish();
    assert.equal(await f.page.locator('#feed .like-btn').getAttribute('aria-pressed'), 'true');
    assert.match(await f.page.locator('#feed .post-stats-text').textContent(), /点赞 1/);
  } finally { if (release) release(); }
}));

test('a stale refresh cannot remove a confirmed post comment', { timeout: 40000 }, async () => fixture(async f => {
  const page = f.page, id = f.posts[0].id, pending = await heldFeed(f);
  await page.evaluate(id => window.openComment(id), id);
  await page.locator('#feed .inline-comment-box input').fill('刷新期间已经确认的评论');
  await page.locator('#feed .inline-comment-box button').filter({ hasText: '发送' }).last().click();
  await page.waitForFunction(() => /评论 7/.test(document.querySelector('#feed .post-stats-text').textContent));
  await pending.finish();
  assert.match(await page.locator('#feed .post-stats-text').textContent(), /评论 7/);
}));

test('a stale refresh cannot resurrect a deleted comment', { timeout: 40000 }, async () => fixture(async f => {
  const id = f.comments[0].id, pending = await heldFeed(f);
  await f.page.route('**/api/post/comment/' + id, route => {
    f.comments.splice(f.comments.findIndex(c => c.id === id), 1);
    return route.fulfill({ json: { ok: true, deleted: true } });
  });
  f.page.once('dialog', dialog => dialog.accept());
  await f.page.evaluate(id => window.deleteFeedComment(id, document.createElement('button')), id);
  await pending.finish();
  assert.match(await f.page.locator('#feed .post-stats-text').textContent(), /评论 5/);
  assert.equal(await f.page.locator('[data-comment-id="' + id + '"]').count(), 0);
}));

test('feed refresh preserves the actual comment input, selection, mention listener and submit handler', { timeout: 40000 }, async () => fixture(async f => {
  const page = f.page, id = f.posts[0].id;
  await page.evaluate(id => window.openComment(id), id);
  await page.locator('#feed .inline-comment-box input').fill('尚未发送的评论草稿');
  await page.evaluate(() => { const input = document.querySelector('#feed .inline-comment-box input'); window.savedDraftInput = input; input.focus(); input.setSelectionRange(2, 7); });
  const pending = await heldFeed(f); await pending.finish();
  const state = await page.evaluate(() => { const input = document.querySelector('#feed .inline-comment-box input'); return {
    same: input === window.savedDraftInput, value: input && input.value, focused: document.activeElement === input,
    start: input && input.selectionStart, end: input && input.selectionEnd }; });
  assert.deepEqual(state, { same: true, value: '尚未发送的评论草稿', focused: true, start: 2, end: 7 });
  await page.locator('#feed .inline-comment-box input').fill('@小');
  await page.waitForSelector('.mention-dropdown');
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  assert.equal(await page.locator('.mention-dropdown').count(), 0);
  await page.locator('#feed .inline-comment-box input').fill('保留事件处理器后发送');
  await page.locator('#feed .inline-comment-box button').filter({ hasText: '发送' }).last().click();
  await page.waitForFunction(() => /评论 7/.test(document.querySelector('#feed .post-stats-text').textContent));
  assert.equal(f.comments.some(c => c.content === '保留事件处理器后发送'), true);
}));

test('feed refresh keeps a pending comment disabled until its original request finishes', { timeout: 40000 }, async () => fixture(async f => {
  let release;
  const page = f.page, id = f.posts[0].id;
  await page.route('**/api/post/comment', async route => {
    await new Promise(resolve => { release = resolve; }); await route.fallback();
  });
  try {
    await page.evaluate(id => window.openComment(id), id);
    const input = page.locator('#feed .inline-comment-box input');
    await input.fill('一次请求不能重复发送');
    await page.locator('#feed .inline-comment-box button').filter({ hasText: '发送' }).last().click();
    await page.waitForFunction(() => document.querySelector('#feed .inline-comment-box button.btn-primary').disabled);
    const pending = await heldFeed(f); await pending.finish();
    assert.equal(await input.inputValue(), '一次请求不能重复发送');
    assert.equal(await page.locator('#feed .inline-comment-box button').filter({ hasText: '发送' }).last().isDisabled(), true);
    release();
    await page.waitForFunction(() => /评论 7/.test(document.querySelector('#feed .post-stats-text').textContent));
    assert.equal(f.calls.filter(c => c.path === '/api/post/comment').length, 1);
  } finally { if (release) release(); }
}));

async function wall(f, pages) {
  const requests = [];
  await f.page.route(/\/api\/photos\/public(?:\?|$)/, route => {
    const page = Number(new URL(route.request().url()).searchParams.get('page'));
    requests.push(page); return route.fulfill({ json: { ok: true, data: pages(page) } });
  });
  await f.page.route(/\/api\/photo\/[0-9a-f-]+\/media(?:\?|$)/, route => route.fulfill({ contentType: 'image/png', body: f.png }));
  await f.page.evaluate(() => ensurePhotoWallLoaded());
  await f.page.waitForFunction(() => typeof window.initPhotoWall === 'function' && typeof window.renderPhotoWall === 'function');
  await f.page.evaluate(async () => { window.IntersectionObserver = undefined; window.switchDockTab('ai', true); await window.initPhotoWall(true); });
  return requests;
}
function row(f, i, video = false) {
  const id = '8c1cb02d-74d0-4e45-9e15-' + String(i + 100).padStart(12, '0');
  return { id, user_name: 'alice', media_url: f.origin + '/api/photo/' + id + '/media', media_type: '__photo_wall__',
    created_at: new Date(Date.UTC(2026, 9, 12) - i * 1000).toISOString(), content: JSON.stringify(video ? { mediaKind: 'video', mimeType: 'video/mp4' } : { mimeType: 'image/png' }) };
}

test('a filtered first photo page still provides a usable path to later authorized images', { timeout: 40000 }, async () => fixture(async f => {
  const requests = await wall(f, page => page === 0 ? Array.from({ length: 60 }, (_, i) => row(f, i, true)) : [row(f, 60)]);
  const sentinel = f.page.locator('.pw-load-more-sentinel');
  assert.equal(await sentinel.count(), 1);
  await sentinel.click();
  await f.page.waitForSelector('.photo-wall-item');
  assert.equal(requests.includes(1), true);
}));

test('a filtered middle photo page remains retryable while the server still has more pages', { timeout: 40000 }, async () => fixture(async f => {
  await wall(f, page => page < 2 ? Array.from({ length: 60 }, (_, i) => row(f, page * 60 + i, page === 1)) : [row(f, 120)]);
  const sentinel = f.page.locator('.pw-load-more-sentinel');
  await sentinel.scrollIntoViewIfNeeded();
  assert.equal(await sentinel.evaluate(node => {
    const rect = node.getBoundingClientRect(), dock = document.getElementById('dockBar').getBoundingClientRect();
    return rect.bottom <= dock.top;
  }), true, 'the paging control must remain above the fixed Dock at the bottom of the wall');
  await sentinel.click();
  await f.page.waitForFunction(() => document.querySelector('.pw-load-more-sentinel').textContent.includes('继续'));
  assert.equal(await sentinel.getAttribute('role'), 'button');
  await sentinel.click();
  await f.page.waitForFunction(() => window.photoWallData.length === 61);
}));

test('re-reading the last photo page removes its deleted card and closes its old preview', { timeout: 40000 }, async () => fixture(async f => {
  let removed = false;
  await wall(f, page => Array.from({ length: removed ? 69 : 70 }, (_, i) => row(f, i)).slice(page * 60, (page + 1) * 60));
  await f.page.locator('.pw-load-more-sentinel').click();
  await f.page.waitForFunction(() => window.photoWallData.length === 70);
  await f.page.locator('.photo-wall-item').last().click();
  await f.page.waitForSelector('#photoPreviewOverlay.active');
  removed = true;
  await f.page.evaluate(async () => { await loadPhotoWallData(true); await loadMorePhotos(); });
  assert.equal(await f.page.evaluate(() => window.photoWallData.length), 69);
  assert.equal(await f.page.locator('.photo-wall-item').count(), 69);
  assert.equal(await f.page.locator('#photoPreviewOverlay').evaluate(node => node.classList.contains('active')), false);
}));

test('an authoritative empty photo refresh closes the now-removed wall preview', { timeout: 40000 }, async () => fixture(async f => {
  let removed = false;
  await wall(f, () => removed ? [] : [row(f, 0)]);
  await f.page.locator('.photo-wall-item').click();
  await f.page.waitForSelector('#photoPreviewOverlay.active');
  removed = true; await f.page.evaluate(() => window.loadPhotoWallData(true));
  assert.equal(await f.page.evaluate(() => window.photoWallData.length), 0);
  assert.equal(await f.page.locator('#photoPreviewOverlay').evaluate(node => node.classList.contains('active')), false);
}));
