const { test, expect } = require('@playwright/test');

const validPost = {
  id: 'feed-healthy-post',
  user_name: 'Alice',
  content: 'A normal post that must remain visible.',
  created_at: '2026-07-20T08:00:00.000Z',
  visibility: 'public',
  views: 3
};

test('feed remains usable when an avatar request and one post render fail', async ({ page }) => {
  const pageErrors = [];
  let feedRequests = 0;
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/api/feed**', route => {
    feedRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: [
          validPost,
          { id: 'feed-missing-user', user_name: null, content: 'Incomplete legacy row', created_at: '2026-07-20T08:01:00.000Z' },
          { id: 'feed-long-content', user_name: 'Bob', content: `${'x'.repeat(240)} full post content`, created_at: '2026-07-20T08:02:00.000Z', visibility: 'public' }
        ],
        comments: [],
        likes: [],
        next_offset: 3,
        endReached: true,
        total_post_count: 3
      })
    });
  });
  await page.route('**/api/avatar/batch', route => route.fulfill({ status: 500, body: 'unavailable' }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#feed .post[data-post-id="feed-healthy-post"]')).toBeVisible();
  await expect(page.locator('#feed')).not.toContainText('加载失败');
  await expect(page.locator('#feed .post[data-post-id="feed-healthy-post"] .avatar.clickable')).toHaveText('A');

  await expect(page.locator('.read-more-btn')).toHaveCount(0);
  await expect(page.locator('#feed .post[data-post-id="feed-long-content"] .content')).toContainText('full post content');

  await page.evaluate(() => window.loadFeed(true));
  await expect.poll(() => feedRequests).toBeGreaterThan(1);
  await expect(page.locator('#feed .post[data-post-id="feed-healthy-post"]')).toBeVisible();

  const scripts = await page.evaluate(() => Array.from(document.scripts, script => script.src));
  expect(scripts.some(src => src.includes('core.min.js'))).toBe(true);
  expect(pageErrors.filter(message => /buildPostContentHtml is not defined|reading ['\"]0['\"]/.test(message))).toEqual([]);
});
