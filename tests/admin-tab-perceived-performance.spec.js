const { test, expect } = require('@playwright/test');

test('admin tabs activate before data resolves and deduplicate concurrent loads', async ({ page }) => {
  const counts = Object.create(null);
  const json = (route, body) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });

  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/admin/**', async route => {
    const url = new URL(route.request().url());
    const key = url.pathname;
    if (!key.startsWith('/admin/')) return route.continue();
    counts[key] = (counts[key] || 0) + 1;

    if (key === '/admin/login') return json(route, { ok: true, token: 'test-admin-token' });
    if (key === '/admin/data') return json(route, {
      posts: [], likes: [], comments: [], announcements: [], bans: []
    });
    if (key === '/admin/users/register-alerts') return json(route, { ok: true, unread_count: 0, users: [] });
    if (key === '/admin/users/register-alerts/read') return json(route, { ok: true });
    if (key === '/admin/reports') return json(route, { data: [] });

    if (['/admin/users', '/admin/login-events', '/admin/security-alerts', '/admin/mutes'].includes(key)) {
      await new Promise(resolve => setTimeout(resolve, 700));
      if (key === '/admin/login-events') return json(route, { data: [], behavior: [] });
      return json(route, { data: [] });
    }
    if (key === '/admin/security-settings') return json(route, { settings: {} });
    return json(route, { ok: true, data: [] });
  });

  await page.goto('/admin.html');
  await page.waitForFunction(() => typeof window.doAdminLogin === 'function');
  await page.locator('#loginName').fill('admin');
  await page.locator('#loginPw').fill('test-password');
  await page.evaluate(() => window.doAdminLogin());
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#tabAnn')).toHaveClass(/active/);

  const activatedInMs = await page.evaluate(() => {
    const start = performance.now();
    document.querySelector('#tabUsersBtn').click();
    if (!document.querySelector('#tabUsers').classList.contains('active')) return -1;
    return performance.now() - start;
  });
  expect(activatedInMs).toBeGreaterThanOrEqual(0);
  expect(activatedInMs).toBeLessThan(100);
  await expect(page.locator('#tabUsers')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#tabUsers .admin-tab-loading')).toBeVisible();

  // Return to the same tab while its first request is still pending.
  await page.locator('#tabSecurityBtn').click();
  await page.locator('#tabUsersBtn').click();
  await expect(page.locator('#tabUsers')).toHaveClass(/active/);
  await expect(page.locator('#tabUsers')).not.toHaveAttribute('aria-busy', 'true', { timeout: 4000 });

  expect(counts['/admin/users']).toBe(1);
  expect(counts['/admin/login-events']).toBe(1);
  expect(counts['/admin/mutes']).toBe(1);
});
