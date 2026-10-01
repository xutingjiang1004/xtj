const { test, expect } = require('@playwright/test');

test('admin shows online users and user detail at device-dialog width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const flashWrites=[];
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/admin/**', async route => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^\/api/, '');
    if (!key.startsWith('/admin/')) return route.continue();
    if (key === '/admin/login') return json(route, { ok: true, user_token: 'test-admin-token', user_user_token: 'test-admin-token' });
    if (key === '/admin/flash-photos') {
      if(route.request().method()==='POST'){flashWrites.push(route.request().postDataJSON());return json(route,{ok:true});}
      return json(route,{ok:true,settings:{free_daily:3,pro_daily:20},quota:{ok:true,used:1,limit:3,override:null,is_pro:false}});
    }
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

  await page.locator('#tabUsersBtn').click();
  await page.locator('a', { hasText: '测试用户' }).first().click();
  await expect(page.locator('#detailModal')).toHaveClass(/active/);
  await expect(page.locator('#detailModal')).toContainText('IP 粗略地区');
  const dialogWidth = await page.locator('.admin-detail-dialog').evaluate(el => parseFloat(getComputedStyle(el).width));
  expect(dialogWidth).toBeGreaterThanOrEqual(850);
  expect(dialogWidth).toBeLessThanOrEqual(1024);
  expect((await page.locator('.admin-detail-dialog').boundingBox()).x+dialogWidth).toBeLessThanOrEqual(1280);
  await expect(page.locator('#adminFlashLimits')).toContainText('今日 1 / 3 张');
  await page.locator('#adminFlashUserLimit').fill('6');await page.locator('#adminFlashPro').check();await page.locator('#adminFlashUserSave').click();
  await expect.poll(()=>flashWrites.length).toBe(1);expect(flashWrites[0]).toEqual({user_name:'测试用户',daily_limit:6,pro:true});
  await page.locator('#adminFlashLimits summary').click();await page.locator('#adminFlashFree').fill('8');await page.locator('#adminFlashApplyAll').check();await page.locator('#adminFlashDefaultSave').click();
  await expect.poll(()=>flashWrites.length).toBe(2);expect(flashWrites[1]).toEqual({free_daily:8,pro_daily:20,apply_all:true});
});
