const { test, expect } = require('@playwright/test');

async function prepareAuthenticatedPage(page) {
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'ai-tools-user');
    localStorage.setItem('xtj_device_id', 'ai_tools_menu_test');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'ai-tools-token' })
  }));
  await page.route('**/api/agent/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { messages: [], has_more: false }, conversations: [] })
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__xtjEnsureAiAgentLoaded === 'function');
}

test('top AI tools menu sits between theme and notifications and opens chat or research', async ({ page }) => {
  await prepareAuthenticatedPage(page);
  const order = await page.evaluate(() => {
    const theme = document.getElementById('themeToggle');
    const ai = document.getElementById('aiToolsNav');
    const announcement = document.getElementById('announcement-btn-wrapper');
    return !!theme && !!ai && !!announcement && !!(theme.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(ai.compareDocumentPosition(announcement) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await expect(page.locator('#aiToolsBtn .ai-tools-trigger-label')).toHaveText('AI');

  await page.locator('#aiToolsBtn').click();
  await expect(page.locator('#aiToolsMenu')).toBeVisible();
  await page.getByRole('menuitem', { name: /AI 聊天/ }).click();
  await expect(page.locator('#aiChatRoot')).toBeVisible();

  await page.evaluate(() => window.__xtjCloseAiChat());
  await page.evaluate(() => window.switchDockTab('posts', true));
  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /深度研究/ }).click();
  await expect(page.locator('#panelDeepThink')).toHaveClass(/active/);

  await page.locator('#dtBackBtn').click();
  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /站内搜索/ }).click();
  await expect(page.locator('#aiChatRoot')).toBeVisible();
  await expect(page.locator('#aiChatRoot textarea')).toHaveAttribute('placeholder', /广州旅行/);
});

test('top AI tools menu remains within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareAuthenticatedPage(page);
  await page.locator('#aiToolsBtn').click();
  const bounds = await page.locator('#aiToolsMenu').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('menuitem', { name: /AI 聊天/ }).click();
  await expect(page.locator('#aiChatRoot')).toBeVisible();
});

test('restored site-search cards retain source metadata and open a photo preview', async ({ page }) => {
  await prepareAuthenticatedPage(page);
  await page.unroute('**/api/agent/**');
  await page.route('**/api/agent/**', route => {
    if (!route.request().url().includes('/chat/history')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { messages: [], has_more: false } }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, conversation_id: 'AI-CARD-TEST', has_more: false, oldest: null,
      messages: [{ role: 'assistant', content: '找到了匹配照片。', created_at: '2026-07-18T10:20:00.000Z', site_cards: [{
        protocol: 'xtj.ai.ui.v1', id: 'card-search-photo', type: 'search_results', title: '站内搜索结果', data: { results: [{
          source: 'photos', source_id: 'photo-card-1', title: '测试照片', snippet: '广州旅行照片',
          created_at: '2026-07-18T10:00:00.000Z', matched_keywords: ['广州旅行'], relevance: 1,
          jump_target: { type: 'photo', post_id: 'photo-card-1', image_url: 'https://example.com/photo.jpg', user_name: 'ai-tools-user' }
        }] }
      }] }]
    }) });
  });

  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /AI 聊天/ }).click();
  await expect(page.locator('.ai-tool-card')).toBeVisible();
  await expect(page.locator('.ai-tool-result-meta')).toContainText(/photos/);
  await page.locator('.ai-tool-result').click();
  await expect(page.locator('#photoPreviewOverlay')).toBeVisible();
});
