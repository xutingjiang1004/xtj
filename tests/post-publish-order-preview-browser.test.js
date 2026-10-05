'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

for (const [width, touch] of [[1280, false], [390, true]]) test(`${width}px: drag photos, remove and append, then publish in exactly that order`, { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width, height: 900 }, counts: [1] });
  try {
    const p = f.page;
    await p.route('**/test-supabase/storage/v1/object/public/uploads/**', r => r.fulfill({ body: f.png, contentType: 'image/png' }));
    await p.locator('#fileInp').setInputFiles([0, 1, 2].map(i => ({ name: i + '.png', mimeType: 'image/png', buffer: f.png })));
    const nodes = p.locator('#postMediaPreviewGrid .post-media-preview-thumb');
    await nodes.first().scrollIntoViewIfNeeded();
    const a = await nodes.nth(0).boundingBox(), b = await nodes.nth(2).boundingBox();
    if (touch) {
      const session = await p.context().newCDPSession(p);
      const point = (x, y) => [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(a.x + a.width / 2, a.y + a.height / 2) });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(b.x + b.width / 2, b.y + b.height / 2) });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await p.mouse.up();
    }
    assert.deepEqual(await p.evaluate(() => selectedPostMedia.map(f => f.name)), ['1.png', '2.png', '0.png']);
    assert.equal(await p.locator('.post-media-drag-ghost').count(), 0);
    await p.locator('#postMediaPreviewGrid .post-media-remove').nth(1).click();
    await p.locator('#fileInp').setInputFiles({ name: '3.png', mimeType: 'image/png', buffer: f.png });
    await nodes.nth(2).focus(); await nodes.nth(2).press('Alt+ArrowLeft');
    assert.deepEqual(await p.evaluate(() => selectedPostMedia.map(f => f.name)), ['1.png', '3.png', '0.png']);
    await p.locator('#pubBtn').click();
    await p.waitForFunction(() => !document.getElementById('pubBtn').disabled && selectedPostMedia.length === 0);
    const items = f.getCreated().attachments;
    assert.deepEqual(items.map(i => i.position), [0, 1, 2]);
    for (const [i, name] of ['1.png', '3.png', '0.png'].entries()) assert.ok(items[i].storage_path.endsWith(name));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const width of [390, 1280]) test(`${width}px: create acknowledgement shows all nine local originals without waiting for IP or Storage, even with motion off`, { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width, height: 900 }, counts: [1] });
  let release; const wait = new Promise(r => release = r);
  let remoteRequests = 0;
  try {
    const p = f.page;
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.evaluate(() => {
      window.testImageDeadlines = []; window.testClearedDeadlines = [];
      const set = window.setTimeout, clear = window.clearTimeout;
      window.setTimeout = function(fn, delay, ...args) { const id = set(fn, delay, ...args); if (delay === 15000) testImageDeadlines.push(id); return id; };
      window.clearTimeout = function(id) { testClearedDeadlines.push(id); return clear(id); };
    });
    await p.route('**/test-supabase/storage/v1/object/public/uploads/**', async r => { remoteRequests++; await wait; await r.fulfill({ body: f.png, contentType: 'image/png' }).catch(() => {}); });
    await p.route('**/api/post/detail/**', async r => { await wait; await r.fulfill({ json: { ok: true, post: f.posts[0] } }).catch(() => {}); });
    await p.route('**/api/post/create', async r => {
      const body = r.request().postDataJSON();
      await p.evaluate(() => { window.testCreateAck = performance.now(); });
      await r.fulfill({ json: { ok: true, data: { ...body, id: '8c1cb02d-74d0-4e45-9e15-000000009999', user_name: 'alice', created_at: '2026-10-06T00:00:00Z', media_items: body.attachments } } });
    });
    await p.locator('#fileInp').setInputFiles(Array.from({ length: 9 }, (_, i) => ({ name: i + '.png', mimeType: 'image/png', buffer: f.png })));
    await p.locator('#pubBtn').click();
    await p.waitForFunction(() => {
      const images = Array.from(document.querySelectorAll('#feed > .post:first-child .post-media-cell img'));
      return images.length === 9 && images.every(i => i.complete && i.naturalWidth > 0 && i.src.startsWith('blob:'));
    });
    assert.ok(await p.evaluate(() => performance.now() - testCreateAck < 1000), 'acknowledged post must render before unrelated metadata/download requests finish');
    assert.equal(await p.locator('#feed > .post:first-child .post-image-failed').count(), 0);
    assert.ok(remoteRequests <= 2, 'background original handoff limits simultaneous decoding');
    assert.equal(await p.evaluate(() => {
      const before = testClearedDeadlines.length;
      window.dispatchEvent(new Event('online'));
      return testClearedDeadlines.slice(before).some(id => testImageDeadlines.includes(id));
    }), false, 'reconnecting must keep the deadline of an already active request');
    await p.locator('#feed > .post:first-child .post-media-cell').first().click();
    await p.waitForFunction(() => document.getElementById('photoPreviewImage')?.naturalWidth > 0);
    await p.evaluate(() => ppNextPhoto());
    await p.waitForFunction(() => photoPreviewCurrent.__xtjMediaIndex === 1);
    assert.ok(await p.locator('#photoPreviewImage').evaluate(i => i.complete && i.naturalWidth > 0));
    await p.evaluate(() => closePhotoPreview());
    release();
    await p.waitForFunction(() => Array.from(document.querySelectorAll('#feed > .post:first-child .post-media-cell img')).every(i => !i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0));
    assert.deepEqual(f.errors, []);
  } finally { release(); await f.close(); }
});

test('ready neighbor is promoted intact; repeated next/previous never flash a loader or clear the decoded original', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [9] });
  try {
    const p = f.page;
    await p.locator('#feed .post-media-cell').first().click();
    await p.waitForFunction(() => document.getElementById('ppNextImg')?.complete && document.getElementById('ppNextImg').naturalWidth > 0);
    await p.waitForTimeout(350);
    await p.evaluate(() => {
      window.testNeighbor = document.getElementById('ppNextImg');
      window.testPromoted = false; window.testPreviewFrames = [];
      window.addEventListener('xtj:photo-changed', () => {
        testPromoted = document.getElementById('photoPreviewImage') === testNeighbor;
        let remaining = 20;
        function frame() {
          const img = document.getElementById('photoPreviewImage');
          const loader = img.parentNode.querySelector('.pp-image-loading');
          testPreviewFrames.push({ ready: img.complete && img.naturalWidth > 0, visible: img.style.opacity !== '0', loading: loader && !loader.hidden });
          if (--remaining) requestAnimationFrame(frame);
        } frame();
      });
    });
    await p.evaluate(() => ppNextPhoto());
    await p.waitForFunction(() => testPreviewFrames.length >= 20);
    assert.equal(await p.evaluate(() => testPromoted), true);
    assert.ok(await p.evaluate(() => testPreviewFrames.every(i => i.ready && i.visible && !i.loading)));
    for (const index of [2, 3, 2, 1, 0]) {
      const previous = await p.evaluate(() => photoPreviewCurrent.__xtjMediaIndex);
      await p.evaluate(next => next ? ppNextPhoto() : ppPrevPhoto(), index > previous);
      await p.waitForFunction(index => photoPreviewCurrent.__xtjMediaIndex === index, index);
      assert.ok(await p.locator('#photoPreviewImage').evaluate(i => i.complete && i.naturalWidth > 0 && i.style.opacity !== '0'));
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
