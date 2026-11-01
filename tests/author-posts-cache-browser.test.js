'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');
test('a personal activity page that was just opened shows at once on reopen without asking the server again', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [3] });
  try {
    let requests = 0;
    await f.page.route('**/api/profile/posts/**', route => { requests++; const author = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
      return route.fulfill({ json: { ok: true, author, posts: f.posts.map(p => Object.assign({}, p, { user_name: author })), has_more: false, next_cursor: null } }); });
    // Someone else's page (the viewer is alice): not requested again for ten minutes. Your own page is refreshed quietly instead.
    const author = 'bob';
    await f.page.evaluate(a => openUserProfile(a), author);
    await f.page.waitForSelector('#authorPostsList .author-post-row', { state: 'attached' });
    const rows = await f.page.locator('#authorPostsList .author-post-row').count();
    assert.equal(requests, 1);
    await f.page.evaluate(() => window.__xtjCloseAuthorPosts());
    assert.equal(await f.page.locator('#authorPostsList .author-post-row').count(), 0);
    await f.page.evaluate(a => openUserProfile(a), author);
    assert.equal(await f.page.locator('#authorPostsList .author-post-row').count(), rows, 'rows are painted synchronously from the device copy');
    await f.page.waitForTimeout(300);
    assert.equal(requests, 1, 'a page opened within ten minutes is not requested again');
    // Deleting or editing a post makes the saved copy stale: the next open asks the server.
    await f.page.evaluate(() => window.__xtjRemoveAuthorPost(document.querySelector('.author-post-row').dataset.postId));
    await f.page.evaluate(() => window.__xtjCloseAuthorPosts());
    await f.page.evaluate(a => openUserProfile(a), author);
    await f.page.waitForFunction(() => document.querySelectorAll('#authorPostsList .author-post-row').length > 0);
    assert.equal(requests, 2);
    // Logging out clears every saved personal activity page.
    await f.page.evaluate(() => window.xtjClearOriginalMediaCache());
    assert.equal(await f.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('xtj_author_posts_v1:')).length), 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
