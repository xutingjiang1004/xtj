const { test, expect } = require('@playwright/test');

test('a remembered user sends feed identity after a single refresh without opening login UI', async ({ page }) => {
  const feedHeaders = [];
  let refreshCalls = 0;
  const privateId = "39b33cdc-9b49-48f7-a509-9d59e0a17c10";
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'feed-tester');
  });
  await page.route('**/api/user/refresh', route => { refreshCalls++; return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'feed-access-token', user_name: 'feed-tester' })
  }); });
  await page.route('**/api/feed?**', route => {
    feedHeaders.push(route.request().headers());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: route.request().headers().authorization ? [{id:privateId,user_name:'feed-tester',content:'本人私密动态',visibility:'private',created_at:'2026-10-01T00:00:00Z'}] : [], comments: [], likes: [], next_offset: null, endReached: true })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => feedHeaders.some(headers => headers.authorization === 'Bearer feed-access-token')).toBe(true);
  await expect(page.locator(`#feed .post[data-post-id="${privateId}"]`)).toContainText('本人私密动态');
  expect(refreshCalls).toBe(1);
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
});
