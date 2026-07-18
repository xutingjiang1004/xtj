const { test, expect } = require('@playwright/test');

test('AI rapid conversation switching ignores a late response from the old conversation', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__testRejections = [];
    window.addEventListener('unhandledrejection', event => {
      window.__testRejections.push(String(event.reason && event.reason.message || event.reason || 'unknown'));
    });
  });

  await page.route('**/api/agent/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/agent/chat/history**', async route => {
    const url = new URL(route.request().url());
    const cid = url.searchParams.get('conversation_id');
    const delay = cid === 'old-conversation' ? 700 : 40;
    await new Promise(resolve => setTimeout(resolve, delay));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, conversation_id: cid || 'initial', has_more: false, messages: cid ? [{ id: cid, role: 'assistant', content: cid === 'old-conversation' ? 'OLD_RESPONSE' : 'NEW_RESPONSE', created_at: new Date().toISOString() }] : [] })
    });
  });
  await page.route('**/api/agent/chat/conversations**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, conversations: [
      { conversation_id: 'old-conversation', title: 'Old' },
      { conversation_id: 'new-conversation', title: 'New' }
    ] })
  }));

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
  await page.locator('.ai-chat-hist-btn').click();
  await expect(page.locator('.ai-conv-item')).toHaveCount(2);
  await page.locator('.ai-conv-item[data-conv-id="old-conversation"]').click();
  await page.locator('.ai-conv-item[data-conv-id="new-conversation"]').dispatchEvent('click');

  await expect(page.locator('#aiChatMessagesArea')).toContainText('NEW_RESPONSE');
  await page.waitForTimeout(850);
  await expect(page.locator('#aiChatMessagesArea')).not.toContainText('OLD_RESPONSE');
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__testRejections)).toEqual([]);
});

test('closing AI while history is pending does not reopen or mutate the removed panel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/agent/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/agent/chat/history**', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messages: [], has_more: false }) });
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
  await page.locator('.ai-chat-back').click();
  await page.waitForTimeout(650);
  await expect(page.locator('#aiChatRoot')).toHaveCount(0);
  expect(errors).toEqual([]);
});
