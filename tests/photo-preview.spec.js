const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'preview.js'), 'utf8');
const okPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');

async function setup(page, routeMode) {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.route('**/ok.png**', route => route.fulfill({ status: 200, contentType: 'image/png', body: okPng }));
  await page.route('**/bad.png**', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' }));
  await page.setContent('<!doctype html><body><button id="thumb">open</button></body>');
  await page.addScriptTag({ content: 'window.updateAmbientBackground=function(){}; window.currentUser="tester";' + script });
  return pageErrors;
}

test('photo preview image load path has no pageerror', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/ok.png', username: 'u', timestamp: Date.now() }]));
  await expect(page.locator('#photoPreviewImage')).toHaveJSProperty('complete', true);
  expect(errors).toEqual([]);
});

test('photo preview image error path has no pageerror', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/bad.png', username: 'u', timestamp: Date.now() }]));
  await page.waitForTimeout(1900);
  expect(errors).toEqual([]);
});

test('photo preview cached image path has no pageerror', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.openPhotoPreview(0, [{ imageUrl: '/ok.png', username: 'u', timestamp: Date.now() }]));
  await expect(page.locator('#photoPreviewImage')).toHaveJSProperty('complete', true);
  await page.evaluate(() => { window.closePhotoPreview(); window.openPhotoPreview(0, [{ imageUrl: '/ok.png', username: 'u', timestamp: Date.now() }]); });
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});
