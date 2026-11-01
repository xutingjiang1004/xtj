'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
test('a slow original shows a wordless blossom progress bar, and a reopened original skips the preview and the bar', { timeout: 90000 }, async () => {
  const seen = new Set(), requests = [];
  const s = await h.open({ settleMs: 2000, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    const m = url.pathname.match(/^\/api\/photo\/([0-9a-f-]{36})\/media$/);
    if (!m) return null;
    const preview = url.searchParams.has('preview');
    requests.push(m[1].slice(0, 2) + (preview ? 'p' : 'o'));
    if (!preview && !seen.has(m[1])) { seen.add(m[1]); await new Promise(r => setTimeout(r, 3000)); }
    return { status: 200, headers: { 'content-type': 'image/svg+xml', etag: '"' + m[1] + (preview ? 'p' : 'o') + '"' }, body: h.svgImg(ids.indexOf(m[1]) * 7 + (preview ? 1 : 2)) };
  } });
  try {
    const p = s.page;
    const open = () => p.evaluate((list) => { const items = list.map(id => { const u = location.origin + '/api/photo/' + id + '/media'; return { id, imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 1000, created_at: new Date().toISOString() }; }); window.openPhotoPreview(0, { photos: items }); }, ids);
    const bar = () => p.evaluate(() => { const b = document.querySelector('.pp-load-progress'); const z = [...document.querySelectorAll('.pp-zoom-btn')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0); return b ? { mid: Math.abs(((b.getBoundingClientRect().top + b.getBoundingClientRect().bottom) / 2) - ((Math.min(...z.map(r => r.top)) + Math.max(...z.map(r => r.bottom))) / 2)), p: Number(b.style.getPropertyValue('--p')), on: b.querySelectorAll('.on').length, text: b.textContent.trim(), show: b.classList.contains('show') } : null; });
    await open();
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.waitForTimeout(1700);
    const mid = await bar();
    assert.ok(mid && mid.show, 'the bar appears while the original is loading');
    assert.equal(mid.text, '原图加载中…', 'the bar carries only the short label');
    assert.ok(mid.mid < 4, 'off by ' + mid.mid + ': ' + 'the bar sits at the height between the zoom buttons');
    assert.ok(mid.p > 0 && mid.p < 1, 'progress is between empty and full');
    assert.ok(mid.on >= 1 && mid.on < 14, 'blossoms fill in with the progress');
    assert.match(await p.evaluate(() => document.getElementById('photoPreviewImage').currentSrc), /preview=1/, 'the preview stays up meanwhile');
    await p.waitForFunction(() => { const i = document.getElementById('photoPreviewImage'); return /11111111-1111-4111-8111-111111111111\/media$/.test(i.currentSrc || i.src) && i.complete; }, null, { timeout: 15000 });
    await p.waitForTimeout(1200);
    assert.equal(await bar(), null, 'the bar is gone once the original shows');
    await p.evaluate(() => window.closePhotoPreview(true)); await p.waitForTimeout(500);
    const before = requests.filter(r => r === '11p').length;
    await open();
    await p.waitForTimeout(450);
    assert.match(await p.evaluate(() => document.getElementById('photoPreviewImage').currentSrc), /11111111-1111-4111-8111-111111111111\/media$/, 'reopening shows the original, not the preview');
    assert.equal(requests.filter(r => r === '11p').length, before, 'the preview is not requested again');
    assert.equal(await bar(), null, 'no bar on reopen');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
