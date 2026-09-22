const { test, expect } = require('@playwright/test');

// 移动视口：桌面 CSS（>=900px）会隐藏底部 dock，而这些用例通过 dock 切换面板
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('precise location is sent only after the user enables sharing', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 31.2304, longitude: 121.4737, accuracy: 18 });
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'location_tester');
    localStorage.setItem('xtj_device_id', 'location_device');
  });
  let locationCalls = 0;
  const pageLoadIds = [];
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'location-token' })
  }));
  await page.route('**/api/user/location', async route => {
    locationCalls += 1;
    expect(route.request().headers().authorization).toBe('Bearer location-token');
    const body = route.request().postDataJSON();
    pageLoadIds.push(body.page_load_id);
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
  expect(pageLoadIds).toHaveLength(2);
  expect(pageLoadIds[0]).toMatch(/^page_[a-z0-9_]+$/i);
  expect(pageLoadIds[1]).not.toBe(pageLoadIds[0]);
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

test('remembered location consent is cleared after permission denial and does not retry on refresh', async ({ page }) => {
  let watchCalls = 0;
  await page.exposeFunction('recordLocationWatch', () => { watchCalls += 1; });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('xtj_location_test_seeded')) {
      localStorage.setItem('xtj_location_sharing_enabled', '1');
      sessionStorage.setItem('xtj_location_test_seeded', '1');
    }
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (_success, error) => {
          window.recordLocationWatch();
          setTimeout(() => error({ code: 1 }), 0);
          return 7;
        },
        clearWatch: () => {}
      }
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => watchCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xtj_location_sharing_enabled'))).toBeNull();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  expect(watchCalls).toBe(1);
});
