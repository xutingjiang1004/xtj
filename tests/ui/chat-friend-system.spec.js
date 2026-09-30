const { test, expect } = require('@playwright/test');

test('mobile friend search sends a request and keeps non-friend messaging disabled', async ({ page }) => {
  let requestedTarget = null;
  let relationshipRequests = 0;
  let searchRequests = 0;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-friends-test');
  });

  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'chat-friends-test-token' })
  }));
  await page.route('**/api/feed**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 })
  }));
  await page.route('**/api/dm/list**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: [] })
  }));
  await page.route('**/api/dm/messages**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: [] })
  }));
  await page.route('**/api/avatar/batch', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, avatars: {} })
  }));
  await page.route('**/api/chat/relationship**', route => {
    relationshipRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, relationship: { status: 'none', is_friend: false, can_message: false } })
    });
  });
  await page.route('**/api/chat/requests**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, requests: [] })
  }));
  await page.route('**/api/chat/friends', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, friends: [] })
  }));
  await page.route('**/api/chat/users/search**', route => {
    searchRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, users: [{ user_name: 'alice', relationship: requestedTarget ? 'request_sent' : 'none' }] })
    });
  });
  await page.route('**/api/chat/friend-requests', async route => {
    requestedTarget = route.request().postDataJSON().target_user;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: { status: 'pending', request_id: '00000000-0000-4000-8000-000000000001' } })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openChat === 'function');
  await page.evaluate(() => window.openChat('alice'));

  await expect(page.locator('#dockChatRelationshipNotice')).toBeVisible();
  await expect(page.locator('#dockChatRelationshipText')).toContainText('成为好友后才能发送');
  await expect(page.locator('#dockChatInput')).toBeDisabled();
  await expect(page.locator('#dockChatSendBtn')).toBeDisabled();
  expect(relationshipRequests).toBeGreaterThan(0);

  await page.locator('#dockChatSocialBtn').click();
  await expect(page.locator('#dockChatSocialSheet')).toBeVisible();
  await page.locator('[data-chat-social-tab="search"]').click();
  await page.locator('#dockChatSocialSearchForm input[name="q"]').fill('alice');
  await page.locator('#dockChatSocialSearchForm button[type="submit"]').click();
  const addButton = page.locator('#dockChatSocialResults [data-chat-social-action="friend-request"]');
  await expect(addButton).toBeVisible();
  await addButton.click();

  await expect.poll(() => requestedTarget).toBe('alice');
  await expect(page.locator('#dockChatSocialResults')).toContainText('等待对方处理');
  await expect(page.locator('#dockChatSocialResults')).toContainText('已发送');
  expect(searchRequests).toBeGreaterThanOrEqual(2);

  await page.locator('#dockChatSocialClose').click();
  await expect(page.locator('#dockChatSocialSheet')).toBeHidden();
  // 好友申请仍待处理时，任何 UI 刷新都不能自行开放消息输入。
  await expect(page.locator('#dockChatInput')).toBeDisabled();
});
