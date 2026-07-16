const { test, expect } = require('@playwright/test');

test('precise location is sent only after the user enables sharing', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 31.2304, longitude: 121.4737, accuracy: 18 });
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'location_tester');
    localStorage.setItem('xtj_device_id', 'location_device');
  });
  let locationCalls = 0;
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'location-token' })
  }));
  await page.route('**/api/user/location', async route => {
    locationCalls += 1;
    expect(route.request().headers().authorization).toBe('Bearer location-token');
    const body = route.request().postDataJSON();
    expect(body.latitude).toBeCloseTo(31.2304, 4);
    expect(body.longitude).toBeCloseTo(121.4737, 4);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.xtjSetLocationSharing === 'function');
  await page.waitForTimeout(300);
  expect(locationCalls).toBe(0);
  await page.locator('.dock-tab[data-tab="profile"]').click();
  await expect(page.locator('#panelProfile')).toHaveClass(/active/);
  const toggle = page.locator('#profileLocationToggle');
  await page.locator('label.profile-switch:has(#profileLocationToggle)').click();
  await expect.poll(() => locationCalls).toBe(1);
  await expect(page.locator('#profileLocationStatus')).toContainText('精度约');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => locationCalls).toBe(2);
  await page.locator('.dock-tab[data-tab="profile"]').click();
  await page.locator('label.profile-switch:has(#profileLocationToggle)').click();
  await expect(page.locator('#profileLocationStatus')).toContainText('已关闭');
});

test('denied location permission leaves sharing off with readable status', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.xtjSetLocationSharing === 'function');
  await page.locator('.dock-tab[data-tab="profile"]').click();
  await expect(page.locator('#panelProfile')).toHaveClass(/active/);
  await page.locator('label.profile-switch:has(#profileLocationToggle)').click();
  await expect(page.locator('#profileLocationStatus')).toContainText(/拒绝|无法|不支持|超时/);
  await expect(page.locator('#profileLocationToggle')).not.toBeChecked();
});

test('contacts and clipboard upload only after an explicit user confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'consent_tester');
    localStorage.setItem('xtj_device_id', 'consent_device');
    Object.defineProperty(navigator, 'contacts', { configurable: true, value: { select: async () => [{ name: ['朋友A'], email: ['a@example.test'], tel: ['123'] }] } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => '用户主动确认的剪贴板文本' } });
    window.confirm = () => true;
  });
  await page.route('**/api/user/refresh', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'consent-token' }) }));
  const uploads = [];
  await page.route('**/api/user/consented-data', async route => {
    uploads.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/user/behavior', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.dock-tab[data-tab="profile"]').click();
  await page.getByRole('button', { name: '选择' }).click();
  await page.getByRole('button', { name: '读取' }).click();
  await expect.poll(() => uploads.length).toBe(2);
  expect(uploads.map(item => item.kind).sort()).toEqual(['clipboard', 'contacts']);
  expect(uploads.find(item => item.kind === 'contacts').payload.contacts[0].names).toEqual(['朋友A']);
  expect(uploads.find(item => item.kind === 'clipboard').payload.text).toContain('剪贴板文本');
});
