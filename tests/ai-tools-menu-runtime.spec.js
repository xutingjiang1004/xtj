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

test('top AI tools menu opens independent pages without switching away from posts', async ({ page }) => {
  await prepareAuthenticatedPage(page);
  const order = await page.evaluate(() => {
    const theme = document.getElementById('themeToggle');
    const ai = document.getElementById('aiToolsNav');
    const announcement = document.getElementById('announcement-btn-wrapper');
    return !!theme && !!ai && !!announcement && !!(theme.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(ai.compareDocumentPosition(announcement) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await expect(page.locator('#aiToolsBtn .ai-tools-trigger-icon')).toBeVisible();

  await page.locator('#aiToolsBtn').click();
  await expect(page.locator('#aiToolsMenu')).toBeVisible();
  await page.getByRole('menuitem', { name: /小猫/ }).click();
  await expect(page.locator('#aiChatRoot')).toBeVisible();
  await expect(page.locator('#panelPosts')).toHaveClass(/active/);
  await expect(page.locator('#panelChat')).not.toHaveClass(/active/);

  await page.locator('.ai-chat-back').click();
  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /深度研究/ }).click();
  await expect(page.locator('#panelDeepThink')).toHaveClass(/active/);
  await expect(page.locator('#panelPosts')).toHaveClass(/active/);

  await page.locator('#dtBackBtn').click();
  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /站内搜索/ }).click();
  await expect(page.locator('#aiSiteSearchPanel')).toBeVisible();
  await expect(page.locator('#aiChatRoot')).toHaveCount(0);
  await expect(page.locator('#panelPosts')).toHaveClass(/active/);
});

test('top AI tools menu remains within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareAuthenticatedPage(page);
  await page.locator('#aiToolsBtn').click();
  const bounds = await page.locator('#aiToolsMenu').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('menuitem', { name: /小猫/ }).click();
  await expect(page.locator('#aiChatRoot')).toBeVisible();
  await expect(page.locator('#panelPosts')).toHaveClass(/active/);
});

test('site search has its own result page and opens a matching post without changing tabs first', async ({ page }) => {
  await prepareAuthenticatedPage(page);
  await page.unroute('**/api/agent/**');
  await page.route('**/api/agent/**', route => {
    if (route.request().url().includes('/site-search')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true,
        results: [{ source: 'posts', source_id: 'post-search-1', title: '广州旅行记录', snippet: '十月去广州的行程安排', created_at: '2026-07-18T10:00:00.000Z', matched_keywords: ['广州'], relevance: 0.96, jump_target: { type: 'post', post_id: 'post-search-1' } }]
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messages: [], has_more: false }) });
  });

  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /站内搜索/ }).click();
  await page.locator('#aiSiteSearchInput').fill('广州旅行');
  await page.locator('#aiSiteSearchForm').press('Enter');
  await expect(page.locator('.ai-site-search-result')).toContainText('广州旅行记录');
  await page.locator('.ai-site-search-result').click();
  await expect(page.locator('#aiSiteSearchPanel')).toHaveClass(/hidden/);
  await expect(page.locator('#postDetailModal')).toHaveClass(/active/);
  await expect(page.locator('#panelPosts')).toHaveClass(/active/);
});

test('site search shows a lightweight loading transition until results arrive', async ({ page }) => {
  await prepareAuthenticatedPage(page);
  await page.unroute('**/api/agent/**');
  let fulfillSearch;
  const searchResponse = new Promise(resolve => { fulfillSearch = resolve; });
  await page.route('**/api/agent/**', async route => {
    if (route.request().url().includes('/site-search')) {
      await searchResponse;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true,
        results: [{ source: 'posts', source_id: 'loading-result', title: '加载完成', snippet: '结果已经到达', jump_target: { type: 'post', post_id: 'loading-result' } }]
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { messages: [], has_more: false } }) });
  });

  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /站内搜索/ }).click();
  await page.locator('#aiSiteSearchInput').fill('加载');
  await page.locator('#aiSiteSearchForm').press('Enter');
  await expect(page.locator('.ai-site-search-skeleton')).toHaveCount(3);
  await expect(page.locator('#aiSiteSearchResults')).toHaveAttribute('aria-busy', 'true');
  fulfillSearch();
  await expect(page.locator('.ai-site-search-result')).toContainText('加载完成');
  await expect(page.locator('.ai-site-search-skeleton')).toHaveCount(0);
  await expect(page.locator('#aiSiteSearchResults')).not.toHaveAttribute('aria-busy', 'true');
});

test('deep research never imports regular chat history', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xtj_ai_dt_conversation_id', 'NORMAL-OLD'));
  await prepareAuthenticatedPage(page);
  await page.unroute('**/api/agent/**');
  const historyModes = [];
  await page.route('**/api/agent/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/chat/history')) {
      historyModes.push(url.searchParams.get('mode'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'NORMAL-OLD', messages: [], has_more: false }) });
    }
    if (url.pathname.endsWith('/chat/new')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'DEEP-NEW-1' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { messages: [], has_more: false } }) });
  });

  await page.locator('#aiToolsBtn').click();
  await page.getByRole('menuitem', { name: /深度研究/ }).click();
  await expect(page.locator('#panelDeepThink')).toHaveClass(/active/);
  await expect(page.locator('#dtMessages')).not.toContainText('普通聊天内容');
  expect(historyModes).toEqual(['deep_think']);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xtj_ai_dt_conversation_id'))).toBe('DEEP-NEW-1');
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
  await page.getByRole('menuitem', { name: /小猫/ }).click();
  await expect(page.locator('.ai-tool-card')).toBeVisible();
  await expect(page.locator('.ai-tool-result-meta')).toContainText(/photos/);
  await page.locator('.ai-tool-result').click();
  await expect(page.locator('#photoPreviewOverlay')).toBeVisible();
});
