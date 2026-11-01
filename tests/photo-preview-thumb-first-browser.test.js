'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
test('going to the next photo shows its preview at once while the original loads in the background', { timeout: 90000 }, async () => {
  const s = await h.open({ settleMs: 2000, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    const m = url.pathname.match(/^\/api\/photo\/([0-9a-f-]{36})\/media$/);
    if (!m) return null;
    const preview = url.searchParams.has('preview');
    if (!preview) await new Promise(r => setTimeout(r, 3500));
    return { status: 200, headers: { 'content-type': 'image/svg+xml', etag: '"' + m[1] + (preview ? 'p' : 'o') + '"' }, body: h.svgImg(ids.indexOf(m[1]) * 7 + (preview ? 1 : 2)) };
  } });
  try {
    const p = s.page;
    await p.evaluate((list) => { const items = list.map(id => { const u = location.origin + '/api/photo/' + id + '/media'; return { id, imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 1000, created_at: new Date().toISOString() }; }); window.openPhotoPreview(0, { photos: items }); }, ids);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.evaluate(() => (document.getElementById('ppNextBtn') || document.querySelector('.pp-nav-arrow.pp-next, #ppNextArrow')).click());
    await p.waitForTimeout(700);
    const early = await p.evaluate(() => { const i = document.getElementById('photoPreviewImage'); return { opacity: getComputedStyle(i).opacity, src: i.currentSrc || i.src, nat: i.naturalWidth }; });
    assert.equal(early.opacity, '1', 'never an empty screen while the original downloads');
    assert.match(early.src, /22222222.*preview=1/); assert.ok(early.nat > 0);
    await p.waitForFunction(() => { const i = document.getElementById('photoPreviewImage'); return !/preview=1/.test(i.currentSrc || i.src) && i.complete && getComputedStyle(i).opacity === '1'; }, null, { timeout: 15000 });
    assert.equal(await p.evaluate(() => document.getElementById('photoPreviewImage').style.backgroundImage), '', 'the preview underlay is removed once the original shows');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
test('the close button looks the same at rest and while the picture is being moved', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 1500, viewport: { width: 390, height: 844 } });
  try {
    const p = s.page;
    await p.evaluate((list) => { const items = list.map(id => { const u = location.origin + '/api/photo/' + id + '/media'; return { id, imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 1000, created_at: new Date().toISOString() }; }); window.openPhotoPreview(0, { photos: items }); }, ids);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    const look = () => p.evaluate(() => { const c = getComputedStyle(document.querySelector('#photoPreviewOverlay .photo-preview-close')); return [c.backgroundColor, c.backdropFilter || c.webkitBackdropFilter || 'none']; });
    const rest = await look();
    await p.evaluate(() => document.getElementById('photoPreviewOverlay').classList.add('pp-gesturing'));
    assert.deepEqual(await look(), rest);
    assert.equal(rest[1], 'none');
  } finally { await s.close(); }
});
