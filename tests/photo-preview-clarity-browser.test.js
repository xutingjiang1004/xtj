'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const id = '55555555-5555-4555-8555-555555555555';
test('there is no sweeping skeleton any more: a photo with no preview shows the blossom progress bar while its original loads, then the picture', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 2000, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    if (url.pathname === '/api/photo/' + id + '/media') { await new Promise(r => setTimeout(r, 1800)); return { status: 200, headers: { 'content-type': 'image/svg+xml', etag: '"o"' }, body: h.svgImg(2) }; }
    return null; } });
  try {
    const p = s.page;
    await p.evaluate((id) => { const u = location.origin + '/api/photo/' + id + '/media'; window.openPhotoPreview(0, { photos: [{ id, imageUrl: u, user_name: 'alice', width: 800, height: 600, created_at: new Date().toISOString() }] }); }, id);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.waitForTimeout(900);
    const mid = await p.evaluate(() => ({ bar: !!document.querySelector('.pp-load-progress.show'), loaders: [...document.querySelectorAll('.pp-image-loading')].map(e => getComputedStyle(e).display) }));
    assert.equal(mid.bar, true, 'the progress bar is shown while the original loads');
    assert.ok(mid.loaders.every(d => d === 'none'), 'the old sweeping skeleton is never displayed: ' + mid.loaders.join());
    await p.waitForFunction(() => { const i = document.getElementById('photoPreviewImage'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
    await p.waitForTimeout(900);
    assert.equal(await p.evaluate(() => !!document.querySelector('.pp-load-progress')), false, 'and the bar is gone once the picture is there');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
test('a zoomed photo is not promoted to its own layer while it is dragged (that is what made it blurry until the finger lifted)', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 2000, viewport: { width: 390, height: 844 } });
  try {
    const p = s.page;
    await p.evaluate(() => { const u = location.origin + '/test-image/1-1.svg'; window.openPhotoPreview(0, { photos: [{ id: 'a', imageUrl: u, thumbUrl: u, user_name: 'alice', width: 800, height: 600, created_at: new Date().toISOString() }] }); });
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active')); await p.waitForTimeout(800);
    const will = (zoomed) => p.evaluate((zoomed) => { const root = document.getElementById('photoPreviewOverlay'), img = document.getElementById('photoPreviewImage'); root.classList.add('pp-gesturing'); img.classList.toggle('zoomed', zoomed); const v = getComputedStyle(img).willChange; root.classList.remove('pp-gesturing'); img.classList.remove('zoomed'); return v; }, zoomed);
    assert.equal(await will(false), 'transform', 'at normal size a drag still gets its own layer (smooth swipe and dismiss)');
    assert.equal(await will(true), 'auto', 'zoomed in it does not');
  } finally { await s.close(); }
});
