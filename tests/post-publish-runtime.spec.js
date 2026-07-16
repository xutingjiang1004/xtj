const { test, expect } = require('@playwright/test');

test('publish button sends once, shows busy state, and inserts the returned post', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const createdId = '11111111-1111-4111-8111-111111111111';
  let createCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'publisher');
    localStorage.setItem('xtj_device_id', 'device_publish_test');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'test-access-token' })
  }));
  await page.route('**/api/post/create', async route => {
    createCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 120));
    const request = route.request();
    expect(request.headers().authorization).toBe('Bearer test-access-token');
    const payload = request.postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          id: createdId,
          user_name: 'publisher',
          content: payload.content,
          media_url: '',
          media_type: '',
          actor_key: 'device_publish_test',
          visibility: 'public',
          views: 0,
          created_at: new Date().toISOString()
        }
      })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.doPublish === 'function');
  await page.locator('#postInp').fill('发布按钮运行时验证');
  const button = page.locator('#pubBtn');
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator(`.post[data-post-id="${createdId}"]`)).toBeVisible();
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#postInp')).toHaveValue('');
  expect(createCalls).toBe(1);
  expect(pageErrors).toEqual([]);
});
