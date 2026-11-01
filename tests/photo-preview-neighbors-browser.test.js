'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
test('neighbours show only their preview; the photo you move to loads its original with the progress bar, and nothing else is downloaded', { timeout: 90000 }, async () => {
  const requests = [];
  const s = await h.open({ settleMs: 2000, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    const m = url.pathname.match(/^\/api\/photo\/([0-9a-f-]{36})\/media$/);
    if (!m) return null;
    const preview = url.searchParams.has('preview');
    requests.push(m[1].slice(0, 2) + (preview ? 'p' : 'o'));
    if (!preview) await new Promise(r => setTimeout(r, 2200));
    return { status: 200, headers: { 'content-type': 'image/svg+xml', etag: '"' + m[1] + (preview ? 'p' : 'o') + '"' }, body: h.svgImg(ids.indexOf(m[1]) * 7 + (preview ? 1 : 2)) };
  } });
  try {
    const p = s.page;
    await p.evaluate((list) => { const items = list.map(id => { const u = location.origin + '/api/photo/' + id + '/media'; return { id, imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 1000, created_at: new Date().toISOString() }; }); window.openPhotoPreview(0, { photos: items }); }, ids);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.waitForTimeout(700);
    assert.ok(!requests.includes('22o') && !requests.includes('33o'), 'while the first photo loads, neighbours do not fetch their originals: ' + requests.join());
    // go to the next photo before the first original finished
    await p.evaluate(() => (document.getElementById('ppNextBtn') || document.querySelector('.pp-nav-arrow.pp-next, #ppNextArrow')).click());
    await p.waitForTimeout(900);
    const state = await p.evaluate(() => { const i = document.getElementById('photoPreviewImage'), b = document.querySelector('.pp-load-progress'); return { src: i.currentSrc || i.src, bar: !!b && b.classList.contains('show') }; });
    assert.match(state.src, /22222222.*preview=1/, 'the next photo shows its preview at once');
    assert.equal(state.bar, true, 'and the progress bar follows the photo that is now on screen');
    assert.ok(requests.includes('22o'), 'its original is now being fetched');
    assert.ok(!requests.includes('33o'), 'but the one after it is not');
    await p.waitForFunction(() => { const i = document.getElementById('photoPreviewImage'); return !/preview=1/.test(i.currentSrc || i.src) && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
    assert.equal(requests.filter(r => r === '22o').length, 1, 'the original is downloaded exactly once');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
test('a dropped connection resumes the original from where it stopped, the bar follows the real bytes, and the finished picture is shown from memory', { timeout: 90000 }, async () => {
  const body = Array.from(Buffer.from(h.svgImg(2)));
  const s = await h.open({ settleMs: 2000, viewport: { width: 390, height: 844 }, init: () => {
    const real = window.fetch.bind(window);
    window.__fx = []; window.__seen = [];
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!/^\/api\/photo\/[0-9a-f-]{36}\/media$/.test(url.pathname) || url.searchParams.has('preview')) return real(input, init);
      const range = init && init.headers && init.headers.Range, start = range ? Number(range.match(/bytes=(\d+)-/)[1]) : 0;
      window.__fx.push(range || 'full');
      const bytes = new Uint8Array(window.__body), slice = bytes.slice(start), step = Math.ceil(slice.length / 6);
      let sent = 0; const failAfter = !range && !window.__failed ? 2 : -1;
      const stream = new ReadableStream({ async pull(controller) {
        await new Promise(r => setTimeout(r, 160));
        if (failAfter >= 0 && sent >= step * failAfter) { window.__failed = true; controller.error(new TypeError('network down')); return; }
        if (sent >= slice.length) { controller.close(); return; }
        controller.enqueue(slice.slice(sent, sent + step)); sent += step;
        window.__seen.push(Math.round((start + Math.min(sent, slice.length)) / bytes.length * 100));
      } });
      return new Response(stream, { status: range ? 206 : 200, headers: Object.assign({ 'Content-Type': 'image/svg+xml', 'Content-Length': String(slice.length), ETag: '"v1"' }, range ? { 'Content-Range': 'bytes ' + start + '-' + (bytes.length - 1) + '/' + bytes.length } : {}) });
    };
  }, extraRoutes: async (url) => {
    const m = url.pathname.match(/^\/api\/photo\/([0-9a-f-]{36})\/media$/);
    if (m && url.searchParams.has('preview')) return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: h.svgImg(1) };
    return null;
  } });
  try {
    const p = s.page;
    await p.evaluate((b) => { window.__body = b; const u = location.origin + '/api/photo/' + '44444444-4444-4444-8444-444444444444' + '/media'; window.openPhotoPreview(0, { photos: [{ id: '44444444-4444-4444-8444-444444444444', imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 600, created_at: new Date().toISOString() }] }); }, body);
    await p.waitForFunction(() => { const i = document.getElementById('photoPreviewImage'); return !/preview=1/.test(i.currentSrc || i.src) && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 });
    const info = await p.evaluate(() => ({ fx: window.__fx, seen: window.__seen, src: document.getElementById('photoPreviewImage').currentSrc }));
    assert.equal(info.fx[0], 'full');
    assert.ok(info.fx.length >= 2 && /^bytes=\d+-$/.test(info.fx[1]), 'the second request asks only for the rest: ' + info.fx.join());
    assert.equal(info.fx.length, 2, 'two requests in total, no fresh start');
    assert.match(info.src, /^blob:/, 'the finished picture is shown from memory (no third request)');
    assert.ok(info.seen[info.seen.length - 1] >= 99, 'all bytes arrived: ' + info.seen.join());
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
