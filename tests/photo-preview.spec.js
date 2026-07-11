const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'preview.js'), 'utf8');
const okPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');

async function setup(page) {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.route('**/ok.png**', route => route.fulfill({ status: 200, contentType: 'image/png', body: okPng }));
  await page.route('**/ok2.png**', route => route.fulfill({ status: 200, contentType: 'image/png', body: okPng }));
  await page.route('**/bad.png**', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }));
  await page.route('**/slow-bad.png**', async route => {
    await new Promise(resolve => setTimeout(resolve, 120));
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'slow nope' });
  });
  await page.addInitScript(() => {
    const records = new WeakMap();
    window.__listenerStats = { active: 0, max: 0, adds: 0, removes: 0, duplicateRemoves: 0 };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    function keyFor(type, listener) { return type + '::' + String(listener && (listener.__listenerId || (listener.__listenerId = Math.random()))); }
    function bucket(target) {
      let map = records.get(target);
      if (!map) { map = new Map(); records.set(target, map); }
      return map;
    }
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this && this.id === 'photoPreviewImage' && (type === 'load' || type === 'error') && listener) {
        const map = bucket(this);
        const key = keyFor(type, listener);
        if (!map.has(key)) {
          map.set(key, { type, listener });
          window.__listenerStats.active += 1;
          window.__listenerStats.adds += 1;
          window.__listenerStats.max = Math.max(window.__listenerStats.max, window.__listenerStats.active);
        }
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (this && this.id === 'photoPreviewImage' && (type === 'load' || type === 'error') && listener) {
        const map = records.get(this);
        const key = keyFor(type, listener);
        if (map && map.has(key)) {
          map.delete(key);
          window.__listenerStats.active -= 1;
          window.__listenerStats.removes += 1;
        } else {
          window.__listenerStats.duplicateRemoves += 1;
        }
      }
      return remove.call(this, type, listener, options);
    };
  });
  await page.setContent('<!doctype html><body><div id="photoGrid"></div></body>');
  await page.addScriptTag({ content: 'window.updateAmbientBackground=function(){}; window.currentUser="tester";' + script });
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

test('same URL repeated while loading does not remove the only effective listeners', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    const item = { imageUrl: '/slow-bad.png', username: 'u', timestamp: Date.now() };
    window.openPhotoPreview(0, [item]);
    window.openPhotoPreview(0, [item]);
  });
  await page.waitForTimeout(40);
  const state = await previewState(page);
  expect(state.stats.max).toBeLessThanOrEqual(2);
  expect(state.openCleanup || state.stats.active > 0).toBe(true);
  expect(errors).toEqual([]);
});

test('failed retry from old URL cannot affect a newer image', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/slow-bad.png', username: 'u', timestamp: Date.now() }]));
  await page.waitForTimeout(160);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/ok2.png', username: 'u', timestamp: Date.now() }]));
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
