const { test, expect } = require('@playwright/test');

test('AI entry renders a visible state while history is slow and offers retry on failure', async ({ page }) => {
  test.setTimeout(30000);
  const pageErrors = [];
  const rejections = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', event => {
      window.__aiTestRejections = window.__aiTestRejections || [];
      window.__aiTestRejections.push(String(event.reason && event.reason.message || event.reason || 'unknown'));
    });
  });
  await page.route('**/api/agent/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ name: '徐旭泽', welcome_message: '嗨，来聊天吧。' })
  }));
  await page.route('**/api/agent/chat/history**', async route => {
    await new Promise(resolve => setTimeout(resolve, 650));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'temporary_unavailable' })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  await page.evaluate(() => {
    window.currentUser = 'tester';
    window.ensureUserToken = async () => 'test-token';
    window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 'test-token' });
    window.switchDockTab('posts', true);
  });

  await expect(page.locator('.ai-agent-entry')).toHaveCount(0);
  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /AI/ }).first().click();
  await expect(page.locator('#aiChatRoot')).toBeVisible();
  await expect(page.locator('#aiChatMessagesArea')).toContainText('正在加载聊天记录');
  await expect(page.locator('.ai-history-retry')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('#aiChatMsgInput')).toBeVisible();

  rejections.push(...await page.evaluate(() => window.__aiTestRejections || []));
  expect(pageErrors).toEqual([]);
  expect(rejections).toEqual([]);
});
