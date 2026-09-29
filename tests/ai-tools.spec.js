const { test, expect } = require('@playwright/test');

test.describe('AI Tools Tests', () => {
  test('AI tools menu only appears on posts with text', async ({ page }) => {
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: [
          { id: '1', user_name: 'test', content: 'hello', media_url: '', created_at: new Date().toISOString(), visibility: 'public' },
          { id: '2', user_name: 'test2', content: '', media_url: 'https://example.com/a.jpg', media_type: 'image', created_at: new Date().toISOString(), visibility: 'public' }
        ],
        comments: [],
        likes: [],
        next_offset: 2,
        endReached: true,
        total_post_count: 2
      })
    }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchDockTab === 'function');
    await page.evaluate(() => {
      window.currentUser = 'tester';
      window.switchDockTab('posts', true);
    });

    await expect(page.locator('.post[data-post-id="1"]')).toBeVisible();
    await page.locator('.post[data-post-id="1"] .post-tools-trigger').click();
    await expect(page.locator('.post-tools-menu [data-post-tool="ask-ai"]')).toBeVisible();

    await page.locator('.post[data-post-id="2"] .post-tools-trigger').click();
    await expect(page.locator('.post-tools-menu [data-post-tool="ask-ai"]')).toHaveCount(0);
  });
});
