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

test('clicking 浏览 or 点赞 opens one bottom half-screen panel: viewers on the left, likers on the right, each with avatar and name', { timeout: 60000 }, async () => {
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
    const box = await modal.locator('.post-stats-panel').boundingBox(), viewport = f.page.viewportSize();
    assert.ok(box.width >= viewport.width - 1, 'the panel spans the width of the site');
    assert.ok(Math.abs(box.height - viewport.height / 2) <= 2, 'the panel takes half of the site height');
    assert.ok(Math.abs(box.y + box.height - viewport.height) <= 1, 'the panel sits at the bottom, so the top half is left uncovered');
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
