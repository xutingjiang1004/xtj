const { test, expect } = require('@playwright/test');

test.describe('AI Tools Tests', () => {
  test('AI critique is available for text and pure images, but not audio-only posts', async ({ page }) => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333'
    ];
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: [
          { id: ids[0], user_name: 'test', content: 'hello', media_url: '', created_at: new Date().toISOString(), visibility: 'public' },
          { id: ids[1], user_name: 'test2', content: '', media_url: 'https://example.com/a.jpg', media_type: 'image', created_at: new Date().toISOString(), visibility: 'public' },
          { id: ids[2], user_name: 'test3', content: '', media_url: 'https://example.com/a.wav', media_type: 'audio', created_at: new Date().toISOString(), visibility: 'public' }
        ],
        comments: [],
        likes: [],
        next_offset: 3,
        endReached: true,
        total_post_count: 3
      })
    }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchDockTab === 'function');
    await page.evaluate(() => {
      window.currentUser = 'tester';
      window.switchDockTab('posts', true);
    });

    await expect(page.locator(`.post[data-post-id="${ids[0]}"]`)).toBeVisible();
    await page.locator(`.post[data-post-id="${ids[0]}"] .post-tools-trigger`).click();
    await expect(page.locator('.post-tools-menu [data-post-tool="ask-ai"]')).toBeVisible();

    await page.locator(`.post[data-post-id="${ids[1]}"] .post-tools-trigger`).click();
    await expect(page.locator('.post-tools-menu [data-post-tool="ask-ai"]').last()).toBeVisible();

    await page.locator(`.post[data-post-id="${ids[2]}"] .post-tools-trigger`).click();
    await expect(page.locator('.post-tools-menu [data-post-tool="ask-ai"]')).toHaveCount(0);
  });
});
