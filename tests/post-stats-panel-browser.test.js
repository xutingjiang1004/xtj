'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

const person = (prefix, i, postId) => ({ id: prefix + '-' + i, post_id: postId, user_name: prefix + String(i).padStart(2, '0'),
  created_at: new Date(Date.UTC(2026, 9, 31, 12, 0, i)).toISOString() });

// An overlay fades out with opacity, which Playwright still calls visible: the open state is its `active` class.
const closed = f => f.page.waitForFunction(() => !document.getElementById('postStatsModal').classList.contains('active'), null, { timeout: 15000 });

async function routeRelations(f, post, { views, likes, viewsTotal, likesTotal }) {
  await f.page.route('**/api/post/detail/' + post.id + '/relations/views**', route => route.fulfill({ json: { ok: true, data: views, has_more: false, next_cursor: null, total: viewsTotal } }));
  await f.page.route('**/api/post/detail/' + post.id + '/relations/likes**', route => route.fulfill({ json: { ok: true, data: likes, has_more: false, next_cursor: null, total: likesTotal } }));
}

test('clicking 浏览 or 点赞 opens one centered secondary window: viewers on the left, likers on the right, each with avatar and name', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    const views = [0, 1, 2].map(i => person('viewer', i, post.id)), likes = [0, 1].map(i => person('fan', i, post.id));
    await routeRelations(f, post, { views, likes, viewsTotal: 3, likesTotal: 2 });
    const card = f.page.locator('.post[data-post-id="' + post.id + '"]').first();
    const before = (await card.locator('.post-stats-text').textContent()).trim();
    assert.match(before, /^浏览 \d+ \| 点赞 \d+ \| 评论 \d+$/, 'the stats line reads exactly as before');
    await card.locator('.post-stat-link[data-stat-kind="views"]').click();
    const modal = f.page.locator('#postStatsModal');
    await modal.waitFor({ state: 'visible' });
    await f.page.waitForFunction(() => document.querySelectorAll('#postStatsViewsList .post-stats-row').length === 3 && document.querySelectorAll('#postStatsLikesList .post-stats-row').length === 2, null, { timeout: 15000 });
    assert.equal((await modal.locator('#postStatsViewsHead').textContent()).replace(/\s+/g, ' ').trim(), '浏览用户 3', 'left title shows the viewer count');
    assert.equal((await modal.locator('#postStatsLikesHead').textContent()).replace(/\s+/g, ' ').trim(), '点赞用户 2', 'right title shows the like count');
    assert.deepEqual(await modal.locator('#postStatsViewsList .post-stats-name').allTextContents(), ['viewer00', 'viewer01', 'viewer02']);
    assert.deepEqual(await modal.locator('#postStatsLikesList .post-stats-name').allTextContents(), ['fan00', 'fan01']);
    assert.equal(await modal.locator('.post-stats-row .avatar').count(), 5, 'every user shows an avatar (or initial)');
    // The window grows out of the tapped button (~0.4s): measure it once it has settled, not mid-animation.
    await f.page.waitForFunction(() => { const b = document.querySelector('#postStatsModal .post-stats-panel'); return b.getAnimations().length === 0 && b.getBoundingClientRect().width > 200; }, null, { timeout: 5000 });
    const box = await modal.locator('.post-stats-panel').boundingBox(), viewport = f.page.viewportSize();
    assert.ok(box.width <= 520 + 1 && box.width <= viewport.width * 0.92 + 1 && box.width >= 280, 'a small window, not the full width: ' + box.width);
    assert.ok(box.height <= viewport.height - 31 && box.height <= 560 + 1, 'a window, not a full-height page: ' + box.height);
    assert.ok(Math.abs((box.x + box.width / 2) - viewport.width / 2) <= 2, 'centered horizontally');
    assert.ok(Math.abs((box.y + box.height / 2) - viewport.height / 2) <= 2, 'centered vertically');
    assert.ok(box.y > 8 && box.y + box.height < viewport.height - 8, 'floats above the page with a margin on every side');
    assert.equal(await modal.locator('.post-stats-header h2').textContent(), '浏览与点赞');
    const left = await modal.locator('#postStatsViewsHead').boundingBox(), right = await modal.locator('#postStatsLikesHead').boundingBox();
    assert.ok(left.x < right.x, 'viewers are on the left, likers on the right');
    await modal.locator('.post-stats-close').click();
    await closed(f);
    assert.equal((await card.locator('.post-stats-text').textContent()).trim(), before, 'closing leaves the card untouched');
    await card.locator('.post-stat-link[data-stat-kind="likes"]').click();
    await modal.waitFor({ state: 'visible' });
    await f.page.keyboard.press('Escape');
    await closed(f);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a like toggle keeps the stats buttons clickable and a late answer never fills the next panel', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await f.page.route('**/api/post/detail/' + post.id + '/relations/views**', async route => { await gate; await route.fulfill({ json: { ok: true, data: [person('late', 0, post.id)], has_more: false, next_cursor: null, total: 1 } }); });
    await f.page.route('**/api/post/detail/' + post.id + '/relations/likes**', route => route.fulfill({ json: { ok: true, data: [], has_more: false, next_cursor: null, total: 0 } }));
    const card = f.page.locator('.post[data-post-id="' + post.id + '"]').first();
    const likeText = () => card.locator('.post-stat-link[data-stat-kind="likes"]').textContent();
    const likedBefore = Number((await likeText()).replace(/\D/g, ''));
    await card.locator('.actions .like-btn').click();
    await f.page.waitForFunction(({ id, n }) => { const l = document.querySelector('.post[data-post-id="' + id + '"] .post-stat-link[data-stat-kind="likes"]'); return l && Number(l.textContent.replace(/\D/g, '')) !== n; }, { id: post.id, n: likedBefore }, { timeout: 15000 });
    await card.locator('.post-stat-link[data-stat-kind="views"]').click();
    await f.page.locator('#postStatsModal').waitFor({ state: 'visible' });
    await f.page.keyboard.press('Escape');
    await closed(f);
    release();
    await f.page.waitForTimeout(300);
    assert.equal(await f.page.locator('#postStatsViewsList .post-stats-row').count(), 0, 'the answer of a closed panel is discarded');
    assert.equal(await card.locator('.post-stat-link').count(), 2, 'the buttons survive count updates');
  } finally { await f.close(); }
});

test('a guest is told to sign in and never requests the viewer list; the like list still loads', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true, user: '' });
  try {
    const post = f.posts[0];
    let viewerRequests = 0;
    await f.page.route('**/api/post/detail/' + post.id + '/relations/views**', route => { viewerRequests += 1; return route.fulfill({ status: 401, json: { ok: false, code: 'login_required' } }); });
    await f.page.route('**/api/post/detail/' + post.id + '/relations/likes**', route => route.fulfill({ json: { ok: true, data: [person('fan', 0, post.id)], has_more: false, next_cursor: null, total: 1 } }));
    await f.page.evaluate(id => window.openPostStatsPanel(id), post.id);
    await f.page.waitForFunction(() => document.querySelectorAll('#postStatsLikesList .post-stats-row').length === 1, null, { timeout: 15000 });
    assert.match(await f.page.locator('#postStatsViewsList').textContent(), /登录后可以查看浏览用户/);
    assert.equal(await f.page.locator('#postStatsViewsList .post-stats-retry').count(), 0, 'no retry button for something that needs a login');
    assert.equal(viewerRequests, 0, 'the guest never asks the server for the list');
  } finally { await f.close(); }
});

test('a login that expires while the panel is open also ends with the sign-in hint, not an error', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    await f.page.route('**/api/post/detail/' + post.id + '/relations/views**', route => route.fulfill({ status: 401, json: { ok: false, code: 'login_required' } }));
    await f.page.route('**/api/post/detail/' + post.id + '/relations/likes**', route => route.fulfill({ json: { ok: true, data: [], has_more: false, next_cursor: null, total: 0 } }));
    await f.page.evaluate(id => window.openPostStatsPanel(id), post.id);
    await f.page.waitForFunction(() => /登录后可以查看浏览用户/.test(document.getElementById('postStatsViewsList').textContent), null, { timeout: 15000 });
    assert.equal(await f.page.locator('#postStatsViewsList .post-stats-retry').count(), 0);
  } finally { await f.close(); }
});

test('the window opens from the tapped button and closes back to it with the shared-element motion; no stacked fade, nothing left behind', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    await routeRelations(f, post, { views: [person('viewer', 0, post.id)], likes: [person('fan', 0, post.id)], viewsTotal: 1, likesTotal: 1 });
    const result = await f.page.evaluate(async id => {
      const link = document.querySelector('.post[data-post-id="' + id + '"] .post-stat-link[data-stat-kind="likes"]');
      const modal = document.getElementById('postStatsModal'), box = modal.querySelector('.modal-box');
      const r = link.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch' }));
      link.click();
      const open = box.getAnimations().filter(a => a.__xtjOrigin).length;
      const claimed = window.xtjMorph.claims('postStatsModal', 'open');
      const first = box.getBoundingClientRect();   // the first frame: still at the button, not at the final place
      const startsAtButton = Math.abs(first.left + first.width / 2 - x) < 60 && Math.abs(first.top + first.height / 2 - y) < 60 && first.width < 120;
      return { open, claimed, startsAtButton, hasGsap: !!window.gsap };
    }, post.id);
    assert.ok(result.open >= 1, 'the shared-element motion owns the opening');
    assert.equal(result.claimed, true, 'the page-level GSAP fade steps aside');
    assert.equal(result.startsAtButton, true, 'the window starts from the tapped button');
    await f.page.waitForFunction(() => { const b = document.querySelector('#postStatsModal .modal-box'); return b.getAnimations().length === 0 && b.getBoundingClientRect().width > 200; }, null, { timeout: 5000 });
    const opened = await f.page.evaluate(() => { const b = document.querySelector('#postStatsModal .modal-box'), cs = getComputedStyle(b); return { opacity: cs.opacity, transform: cs.transform, backdrop: cs.backdropFilter }; });
    assert.equal(opened.opacity, '1'); assert.ok(opened.transform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(opened.transform), 'settles with no leftover transform: ' + opened.transform);
    // 关闭：回到按钮，结束时窗口立刻隐藏，没有残留的压暗层、飞行图或内联样式。
    const closing = await f.page.evaluate(() => { document.querySelector('#postStatsModal .post-stats-close').click(); const b = document.querySelector('#postStatsModal .modal-box'); return { anims: b.getAnimations().filter(a => a.__xtjOrigin).length, stillActive: document.getElementById('postStatsModal').classList.contains('active') }; });
    assert.ok(closing.anims >= 1, 'closing is animated back to the button'); assert.equal(closing.stillActive, true, 'stays visible while it shrinks');
    await closed(f);
    await f.page.waitForTimeout(400);
    const after = await f.page.evaluate(() => { const m = document.getElementById('postStatsModal'), b = m.querySelector('.modal-box'); return { anims: b.getAnimations().length, transform: b.style.transform, will: b.style.willChange, strays: document.querySelectorAll('body > img[aria-hidden="true"], #postStatsModal ~ div[aria-hidden="true"][style*="fixed"]').length, hidden: getComputedStyle(m).opacity }; });
    assert.equal(after.anims, 0); assert.equal(after.transform, ''); assert.equal(after.will, ''); assert.equal(after.strays, 0); assert.equal(after.hidden, '0');
    // 再开一次、中途关掉：沿原路退回，不会卡在半开。
    const reopened = await f.page.evaluate(async id => {
      const link = document.querySelector('.post[data-post-id="' + id + '"] .post-stat-link[data-stat-kind="views"]');
      link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40, pointerType: 'touch' })); link.click();
      await new Promise(r => setTimeout(r, 120)); window.closeModal('postStatsModal');
      await new Promise(r => setTimeout(r, 900));
      const m = document.getElementById('postStatsModal'); return { active: m.classList.contains('active'), anims: m.querySelector('.modal-box').getAnimations().length };
    }, post.id);
    assert.deepEqual(reopened, { active: false, anims: 0 });
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
