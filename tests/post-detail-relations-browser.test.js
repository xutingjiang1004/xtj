'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');
const like = (i) => ({ id: 'like-' + i, post_id: null, user_name: 'fan' + String(i).padStart(2, '0'), created_at: new Date(Date.UTC(2026, 9, 31, 12, 0, i)).toISOString() });
test('post detail lists every like with an avatar and no pages; the rest streams in behind the first page', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0], all = Array.from({ length: 70 }, (_, i) => Object.assign(like(i), { post_id: post.id }));
    await f.page.route('**/api/post/detail/' + post.id + '/relations/likes**', route => route.fulfill({ json: { ok: true, data: all.slice(50), has_more: false, next_cursor: null } }));
    await f.page.route('**/api/post/detail/' + post.id, route => route.fulfill({ json: { ok: true, post: Object.assign({}, post, { like_count: 70, comment_count: 0 }), likes: all.slice(0, 50), comments: [], likes_page: { has_more: true, next_cursor: 'c1' }, comments_page: { has_more: false, next_cursor: null } } }));
    await f.page.evaluate(id => openPostDetail(id), post.id);
    await f.page.waitForFunction(() => document.querySelectorAll('#postDetailBody .post-detail-like-row').length === 70, null, { timeout: 15000 });
    assert.equal(await f.page.locator('#postDetailBody .post-detail-pagination').count(), 0, 'no previous/next page controls');
    assert.equal(await f.page.locator('#postDetailBody .post-detail-like-row .avatar').count(), 70, 'every like shows an avatar (or its initial)');
    assert.equal(await f.page.locator('#postDetailBody .post-detail-more').count(), 0, 'the loading line is gone once everything arrived');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
