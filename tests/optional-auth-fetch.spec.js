const { test, expect } = require('@playwright/test');

test('a remembered user sends feed identity after a single refresh without opening login UI', async ({ page }) => {
  const feedHeaders = [];
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'feed-tester');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'feed-access-token' })
  }));
  await page.route('**/api/feed?**', route => {
    feedHeaders.push(route.request().headers());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: null, endReached: true })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => feedHeaders.length).toBeGreaterThan(0);
  expect(feedHeaders[0].authorization).toBe('Bearer feed-access-token');
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
});
