const { test, expect } = require('@playwright/test');

test('admin tabs activate before data resolves and deduplicate concurrent loads', async ({ page }) => {
  const counts = Object.create(null);
  const seenAuth = [];
  const json = (route, body) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });

  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/admin/**', async route => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^\/api/, '');
    if (!key.startsWith('/admin/')) return route.continue();
    counts[key] = (counts[key] || 0) + 1;

    const auth = route.request().headers().authorization;
    if (auth) seenAuth.push(auth);

    // admin.js:726 实际读取 data.user_token（而非 user_user_token）
    if (key === '/admin/login') return json(route, { ok: true, user_token: 'test-admin-token' });
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
  // dashboard 渲染依赖登录返回的 user_token：后续 admin 数据请求必须携带该 token
  expect(seenAuth).toContain('Bearer test-admin-token');
  await expect(page.locator('#tabAnn')).toHaveClass(/active/);

  const activatedInMs = await page.evaluate(() => {
    const start = performance.now();
    document.querySelector('#tabUsersBtn').click();
    if (!document.querySelector('#tabUsers').classList.contains('active')) return -1;
    return performance.now() - start;
  });
  // -1 表示点击后未同步激活；原 toBeGreaterThanOrEqual(0) 恒真，无法捕获该哨兵值。
  // 改为有意义的边界：激活必须真实发生，且发生在 100ms 内。
  expect(activatedInMs).not.toBe(-1);
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
