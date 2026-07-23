const { test, expect } = require('@playwright/test');

test('admin shows clipboard tab and user detail at device-dialog width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/admin/**', async route => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^\/api/, '');
    if (!key.startsWith('/admin/')) return route.continue();
    if (key === '/admin/login') return json(route, { ok: true, user_token: 'test-admin-token', user_user_token: 'test-admin-token' });
    if (key === '/admin/data') return json(route, { posts: [], likes: [], comments: [], announcements: [], bans: [] });
    if (key === '/admin/users') return json(route, { data: [{ user_name: '测试用户', content: JSON.stringify({ reg_time: '2026-07-16T01:00:00Z' }) }] });
    if (key === '/admin/stats/online') return json(route, {
      online_count: 1,
      device_stats: { mobile: 1, desktop: 0, tablet: 0, unknown: 0 },
      users: [{ user_name: 'test-user', device_label: 'iPhone · iOS · Safari', ip: '203.0.113.10', location: 'Test region' }]
    });
    if (key === '/admin/login-events') return json(route, { data: [], behavior: [] });
    if (key === '/admin/security-alerts' || key === '/admin/mutes' || key === '/admin/reports') return json(route, { data: [] });
    if (key === '/admin/users/register-alerts') return json(route, { ok: true, unread_count: 0, users: [] });
    if (key === '/admin/users/register-alerts/read') return json(route, { ok: true });
    if (key === '/admin/clipboard-data') return json(route, {
      data: [{ user_name: '测试用户', captured_at: '2026-07-16T02:00:00Z', text: '已授权的剪贴板内容', length: 10 }],
      total: 1, page: 1, limit: 50, pages: 1
    });
    if (key === '/admin/user-data') return json(route, {
      info: { last_ip: '203.0.113.10', last_ip_location: { text: '测试地区' } }, login_events: [], behavior_events: []
    });
    return json(route, { ok: true, data: [] });
  });

  await page.goto('/admin.html');
  await page.locator('#loginName').fill('admin');
  await page.locator('#loginPw').fill('test-password');
  await page.evaluate(() => window.doAdminLogin());
  await expect(page.locator('#dashboard')).toBeVisible();

  await page.locator('#tabOnlineBtn').click();
  await expect(page.locator('#tabOnline')).toContainText('203.0.113.10');
  await expect(page.locator('#tabOnline')).toContainText('Test region');

  await page.locator('#tabProfileBtn').click();
  await expect(page.locator('#profileDirectoryRows')).toBeVisible();

  await page.locator('#tabClipboardBtn').click();
  await expect(page.locator('#tabClipboard')).toHaveClass(/active/);
  await expect(page.locator('#tabClipboard')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.admin-clipboard-item')).toContainText('已授权的剪贴板内容');
  await expect(page.locator('.admin-clipboard-item')).toContainText('测试用户');

  await page.locator('#tabUsersBtn').click();
  await page.locator('a', { hasText: '测试用户' }).first().click();
  await expect(page.locator('#detailModal')).toHaveClass(/active/);
  await expect(page.locator('#detailModal')).toContainText('IP 粗略地区');
  const dialogWidth = await page.locator('.admin-detail-dialog').evaluate(el => parseFloat(getComputedStyle(el).width));
  expect(dialogWidth).toBeGreaterThanOrEqual(850);
  expect(dialogWidth).toBeLessThanOrEqual(870);
});
