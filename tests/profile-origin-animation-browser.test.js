'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
test('the personal activity page opens from the tapped avatar, closes back to it, and the avatar can be viewed large', { timeout: 90000 }, async () => {
  const requests = [];
  const s = await h.open({ settleMs: 2500, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    requests.push(url.pathname + url.search);
    if (url.pathname.startsWith('/api/avatar/public/')) return { status: 200, json: { ok: true, avatar_url: '/api/avatar/image/' + url.pathname.split('/').pop() + '?v=abc123' } };
    if (url.pathname.startsWith('/api/avatar/image/')) return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: h.svgImg(3) };
    if (url.pathname.startsWith('/api/profile/posts/')) return { status: 200, json: { ok: true, author: 'x', posts: [], has_more: false, next_cursor: null, profile: {} } };
    return null;
  } });
  try {
    const p = s.page;
    const target = await p.evaluate(() => { const a = document.querySelector('#feed [data-user-name]'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
    await p.mouse.click(target.x, target.y);
    await p.waitForTimeout(60);
    const early = await p.evaluate(() => { const box = document.querySelector('#userProfileModal .modal-box'); return { anims: box.getAnimations().filter(a => a.__xtjOrigin).length, w: box.getBoundingClientRect().width }; });
    assert.ok(early.anims >= 1, 'the card is animating from the avatar');
    assert.ok(early.w < 200, 'a moment after the tap the card is still close to the avatar size, not full size: ' + early.w);
    await p.waitForFunction(() => document.querySelector('#userProfileModal .modal-box').getBoundingClientRect().width > 340 && document.querySelector('#upcAvatar img'));
    assert.equal(await p.locator('#upcAvatar').getAttribute('role'), 'button');
    await p.click('#upcAvatar');
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay').classList.contains('active'));
    assert.ok(requests.some(r => /\/api\/avatar\/image\/.*size=large/.test(r)), 'the large rendition is requested');
    await p.evaluate(() => window.closePhotoPreview()); await p.waitForTimeout(500);
    await p.evaluate(() => closeModal('userProfileModal'));
    await p.waitForTimeout(100);
    const closing = await p.evaluate(() => { const el = document.getElementById('userProfileModal'); return { active: el.classList.contains('active'), anims: el.querySelector('.modal-box').getAnimations().filter(a => a.__xtjOrigin).length }; });
    assert.equal(closing.active, true, 'still on screen while it shrinks back'); assert.ok(closing.anims >= 1);
    await p.waitForFunction(() => !document.getElementById('userProfileModal').classList.contains('active'), null, { timeout: 3000 });
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
