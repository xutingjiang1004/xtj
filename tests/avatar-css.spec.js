const { test, expect } = require('@playwright/test');

test('Avatar image fills container correctly and handles CSS constraints', async ({ page }) => {
  await page.route('**/api/avatar/batch', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      avatars: {
        'testUser': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><rect width="100" height="20" fill="red"/></svg>'
      }
    })
  }));
  await page.route('**/api/posts/visible', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: [
        { id: '1', user_name: 'testUser', content: 'test', media_url: '', created_at: Date.now() }
      ]
    })
  }));

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.switchDockTab('posts', true);
  });

  // Verify avatar img
  const avatarImg = page.locator('.post[data-post-id="1"] .avatar img');
  await expect(avatarImg).toBeVisible();

  const box = await avatarImg.boundingBox();
  expect(box.width).toBeCloseTo(40, -1);
  expect(box.height).toBeCloseTo(40, -1);

  // Re-render feed and check again
  await page.evaluate(() => window.renderFeed(window.feedAllPosts));
  const reAvatarImg = page.locator('.post[data-post-id="1"] .avatar img');
  await expect(reAvatarImg).toBeVisible();

  const reBox = await reAvatarImg.boundingBox();
  expect(reBox.width).toBeCloseTo(40, -1);
  expect(reBox.height).toBeCloseTo(40, -1);
});
