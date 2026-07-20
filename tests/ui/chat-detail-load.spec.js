const { test, expect } = require('@playwright/test');

test('opening a direct message renders the conversation with one initial request', async ({ page }) => {
  let messageRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-detail-test');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'chat-test-token' })
  }));
  await page.route('**/api/feed**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 })
  }));
  await page.route('**/api/dm/messages?**', route => {
    messageRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [{
        id: 'dm-1', user_name: 'friend', media_url: 'viewer', content: 'hello from friend', created_at: '2026-07-20T08:00:00.000Z'
      }] })
    });
  });
  await page.route('**/api/avatar/batch', route => route.fulfill({ status: 500, body: 'unavailable' }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openChat === 'function');
  await page.evaluate(() => window.openChat('friend'));
  await expect(page.locator('#dockChatMessages')).toContainText('hello from friend');
  expect(messageRequests).toBe(1);
});
