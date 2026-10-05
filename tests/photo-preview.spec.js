const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'preview.js'), 'utf8');
const renderScript = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'render.js'), 'utf8');
const okPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');

const installListenerMonitor = () => {
  if (window.__listenerStats && window.__listenerStats.installed) return;
  const targets = new Map();
  const stats = { active: 0, max: 0, adds: 0, removes: 0, installed: true };
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const trackable = (target, type) => target && target.id === 'photoPreviewImage' && (type === 'load' || type === 'error');
  const listenersFor = (target, type) => {
    let types = targets.get(target); if (!types) { types = new Map(); targets.set(target, types); }
    let listeners = types.get(type); if (!listeners) { listeners = new Set(); types.set(type, listeners); }
    return listeners;
  };
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (trackable(this, type)) { const listeners = listenersFor(this, type); if (!listeners.has(listener)) { listeners.add(listener); stats.active += 1; stats.adds += 1; stats.max = Math.max(stats.max, stats.active); } }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (trackable(this, type)) { const types = targets.get(this); const listeners = types && types.get(type); if (listeners && listeners.delete(listener)) { stats.active -= 1; stats.removes += 1; } }
    return remove.call(this, type, listener, options);
  };
  window.__listenerStats = stats;
};

async function setup(page) {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.route('**/ok.png**', route => route.fulfill({ status: 200, contentType: 'image/png', body: okPng }));
  await page.route('**/ok2.png**', route => route.fulfill({ status: 200, contentType: 'image/png', body: okPng }));
  await page.route('**/bad.png**', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }));
  await page.route('**/slow-bad.png**', async route => { await new Promise(resolve => setTimeout(resolve, 120)); await route.fulfill({ status: 404, contentType: 'text/plain', body: 'slow nope' }); });
  await page.route('**/rapid-*.png**', async route => { await new Promise(resolve => setTimeout(resolve, 15)); await route.fulfill({ status: 200, contentType: 'image/png', body: okPng }); });
  await page.addInitScript(installListenerMonitor);
  await page.setContent('<!doctype html><head><base href="http://127.0.0.1:4173/"></head><body><div id="photoGrid"></div></body>');
  await page.evaluate(installListenerMonitor);
  await page.addScriptTag({ content: 'window.updateAmbientBackground=function(){}; window.showToast=function(){}; window.currentUser="tester";' + script });
  return pageErrors;
}

async function previewState(page) {
  return page.evaluate(() => {
    const img = document.getElementById('photoPreviewImage');
    return {
      opacity: img ? getComputedStyle(img).opacity : null,
      cleanup: !!(img && img._ppCleanup),
      listenerUrl: !!(img && img._ppListenerUrl),
      openCleanup: !!(document.getElementById('photoPreviewOverlay') || {})._cleanupOpenListeners,
      stats: window.__listenerStats
    };
  });
}

test('main image load path has no pageerror and ends visible', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/ok.png', username: 'u', timestamp: Date.now() }]));
  await expect(page.locator('#photoPreviewImage')).toHaveJSProperty('complete', true);
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('main image error path has no pageerror and cleans open listeners', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/bad.png', username: 'u', timestamp: Date.now() }]));
  await page.waitForTimeout(250);
  const state = await previewState(page);
  expect(state.openCleanup).toBe(false);
  expect(state.stats.active).toBe(0);
  expect(errors).toEqual([]);
});

test('photo with thumbnail paints instantly then upgrades to full image', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const thumbUrl = 'http://127.0.0.1:4173/thumb.png';
  const fullUrl = 'http://127.0.0.1:4173/full-slow.png';
  await page.route('**/thumb.png**', route => route.fulfill({ status: 200, contentType: 'image/png', body: okPng }));
  await page.route('**/full-slow.png**', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: 'image/png', body: okPng });
  });
  await page.setContent('<!doctype html><head><base href="http://127.0.0.1:4173/"></head><body><div id="photoGrid"></div></body>');
  await page.addScriptTag({ content: 'window.updateAmbientBackground=function(){}; window.showToast=function(){}; window.currentUser="tester";' + script });
  await page.evaluate(({ thumbUrl, fullUrl }) => window.openPhotoPreview(0, [{ imageUrl: fullUrl, thumbUrl: thumbUrl, username: 'u', timestamp: Date.now() }]), { thumbUrl, fullUrl });
  // 原图尚未返回前，主槽应已秒显缩略图
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /thumb\.png/);
  // 原图后台拉取完成后无缝替换（src 为对象 URL），主图已解码显示
  await expect(page.locator('#photoPreviewImage')).toHaveJSProperty('_ppUrl', fullUrl, { timeout: 5000 });
  await expect(page.locator('#photoPreviewImage')).toHaveJSProperty('naturalWidth', 1);
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('same URL repeated while loading does not remove the only effective listeners', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    const item = { imageUrl: '/slow-bad.png', username: 'u', timestamp: Date.now() };
    window.openPhotoPreview(0, [item]);
    window.openPhotoPreview(0, [item]);
  });
  await page.waitForTimeout(40);
  const state = await previewState(page);
  // Both load paths must retire after the request settles; peaks alone do not detect leaks.
  await page.waitForFunction(() => {
    const image = document.getElementById('photoPreviewImage');
    return image && ((image.complete && image.naturalWidth > 0) || image.classList.contains('pp-placeholder'));
  }, null, { timeout: 8000 });
  const settled=await previewState(page);
  expect(settled.stats.active).toBe(0);
  expect(settled.openCleanup).toBe(false);
  const completed = await page.locator('#photoPreviewImage').evaluate(img => img.complete);
  expect(state.openCleanup || state.stats.active > 0 || completed).toBe(true);
  expect(errors).toEqual([]);
});

test('failed retry from old URL cannot affect a newer image', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/slow-bad.png', username: 'u', timestamp: Date.now() }]));
  await page.waitForTimeout(160);
  await page.evaluate(() => {
    window.closePhotoPreview();
    window.openPhotoPreview(0, [{ imageUrl: '/ok2.png', username: 'u', timestamp: Date.now() }]);
  });
  await page.waitForTimeout(700);
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /ok2\.png/);
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity', '1');
  const state = await previewState(page);
  expect(state.cleanup).toBe(false);
  expect(state.listenerUrl).toBe(false);
  expect(errors).toEqual([]);
});

test('quick open close reopen leaves no stale cleanup or duplicate listeners', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    window.openPhotoPreview(0, [{ imageUrl: '/ok.png', username: 'u', timestamp: Date.now() }]);
    window.closePhotoPreview();
    window.openPhotoPreview(0, [{ imageUrl: '/ok2.png', username: 'u', timestamp: Date.now() }]);
  });
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /ok2\.png/);
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity', '1');
  const state = await previewState(page);
  expect(state.cleanup).toBe(false);
  expect(state.listenerUrl).toBe(false);
  expect(state.openCleanup).toBe(false);
  expect(state.stats.active).toBe(0);
  expect(errors).toEqual([]);
});

test('rapidly switching 50 photos keeps the newest image and bounded listeners', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    for (let index = 0; index < 50; index += 1) {
      if (index > 0) window.closePhotoPreview();
      window.openPhotoPreview(0, [{ id: index, imageUrl: '/rapid-' + index + '.png', username: 'u', timestamp: Date.now() }]);
    }
  });
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /rapid-49\.png/);
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity', '1');
  const state = await previewState(page);
  // Both load paths must retire after the request settles; peaks alone do not detect leaks.
  await page.waitForFunction(() => {
    const image = document.getElementById('photoPreviewImage');
    return image && ((image.complete && image.naturalWidth > 0) || image.classList.contains('pp-placeholder'));
  }, null, { timeout: 8000 });
  const settled=await previewState(page);
  expect(settled.stats.active).toBe(0);
  expect(settled.openCleanup).toBe(false);
  expect(state.stats.active).toBe(0);
  expect(errors).toEqual([]);
});

test('photo controls and info dialog expose names, trap focus, close on Escape, and restore focus', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/ok.png', username: 'u', timestamp: Date.now() }]));

  for (const selector of ['#ppZoomOutBtn', '#ppZoomInBtn', '#ppInfoBtn', '#ppShareBtn', '#ppRotateBtn', '#ppDeleteBtn']) {
    await expect(page.locator(selector)).toHaveAttribute('aria-label', /.+/);
  }

  await page.locator('#ppInfoBtn').focus();
  await page.locator('#ppInfoBtn').click();
  const dialog = page.locator('#ppInfoModal');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'ppInfoModalTitle');
  await expect(page.locator('#ppInfoModalTitle')).toHaveText(/.+/);
  await expect(page.locator('.pp-info-modal-close')).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.locator('.pp-info-modal-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 1000 });
  await expect(page.locator('#ppInfoBtn')).toBeFocused();
  expect(errors).toEqual([]);
});

test('photo grid warm loading uses the bounded queue and recovers broken images', async ({ page }) => {
  const errors = [];
  let active = 0;
  let maxActive = 0, requests = 0, brokenAttempts = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/queued-*.png', async route => {
    requests += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 40));
    active -= 1;
    if (route.request().url().includes('queued-3.png') && ++brokenAttempts === 1) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'broken' });
    } else {
      await route.fulfill({ status: 200, contentType: 'image/png', body: okPng });
    }
  });
  await page.setContent('<!doctype html><head><base href="http://127.0.0.1:4173/"><style>#photoGrid{display:grid;grid-template-columns:repeat(4,100px)}#photoGrid img{width:100px;height:100px}</style></head><body><div id="photoGrid"></div></body>');
  await page.evaluate(() => { window.IntersectionObserver = undefined; });
  await page.addScriptTag({ content: renderScript });
  await page.evaluate(() => {
    window.photoWallData = Array.from({ length: 8 }, (_, index) => ({
      id: 'q' + index,
      imageUrl: '/queued-' + index + '.png',
      username: 'u',
      timestamp: Date.now() - index
    }));
    window.renderPhotoWallWithoutReload();
  });
  await expect(page.locator('#photoGrid img:not([data-src])')).toHaveCount(7, { timeout: 5000 });
  await expect(page.locator('#photoGrid img[data-src]')).toHaveCount(1);
  expect(maxActive).toBe(4);
  expect(requests).toBe(8);
  const failed = page.locator('.photo-wall-item').nth(3).locator('img');
  await expect(failed).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(failed).toHaveAttribute('data-src', /queued-3\.png$/);
  await failed.click();
  await expect(page.locator('#photoGrid img[data-src]')).toHaveCount(0);
  await expect(failed).toHaveJSProperty('naturalWidth', 1);
  expect(requests).toBe(9);
  expect(maxActive).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});
