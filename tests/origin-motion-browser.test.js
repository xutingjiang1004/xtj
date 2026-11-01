'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');
// Samples one element each animation frame so a window that flashes, jumps or starts from the wrong place is caught.
const recorder = (sel, boxSel) => ({ sel, boxSel });
function install(page, overlaySel, boxSel) {
  return page.evaluate(([o, b]) => { window.__rec = []; (function tick() { const el = document.querySelector(o), box = document.querySelector(b); if (el && box) { const r = box.getBoundingClientRect(); window.__rec.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, a: +getComputedStyle(box).opacity * +getComputedStyle(el).opacity, shown: el.classList.contains('active') }); } requestAnimationFrame(tick); })(); }, [overlaySel, boxSel]);
}
test('a window opens out of the tapped avatar and closes back into it without a flash', { timeout: 90000 }, async () => {
  const s = await h.open({ settleMs: 2500, viewport: { width: 1180, height: 820 }, extraRoutes: async (url) => {
    if (url.pathname.startsWith('/api/avatar/public/')) return { status: 200, json: { ok: true, avatar_url: '/api/avatar/image/' + url.pathname.split('/').pop() + '?v=1' } };
    if (url.pathname.startsWith('/api/avatar/image/')) return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: h.svgImg(3) };
    if (url.pathname.startsWith('/api/profile/posts/')) return { status: 200, json: { ok: true, author: 'x', posts: [], has_more: false, next_cursor: null, profile: {} } };
    return null; } });
  try {
    const p = s.page;
    const t = await p.evaluate(() => { const a = document.querySelector('#feed [data-user-name]'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await install(p, '#userProfileModal', '#userProfileModal .modal-box');
    await p.mouse.click(t.x, t.y); await p.waitForTimeout(900);
    const open = (await p.evaluate(() => window.__rec.splice(0))).filter(f => f.shown);
    assert.ok(Math.hypot(open[0].cx - t.x, open[0].cy - t.y) < 4, 'the first frame is centred on the tapped avatar');
    assert.ok(open[0].w < 80, 'and as small as the avatar');
    for (let i = 1; i < open.length; i++) assert.ok(open[i].a >= open[i - 1].a - 0.001, 'opening never dims again');
    await p.evaluate(() => closeModal('userProfileModal')); await p.waitForTimeout(800);
    const close = await p.evaluate(() => window.__rec.splice(0));
    let seenHidden = false;
    for (let i = 1; i < close.length; i++) {
      if (!close[i].shown) seenHidden = true;
      else assert.ok(!seenHidden, 'once hidden it does not come back for a frame');
      if (close[i].shown && close[i - 1].shown) assert.ok(close[i].a <= close[i - 1].a + 0.001, 'closing never brightens again (no flash): ' + close.map(f => f.a.toFixed(2)).join(' '));
    }
    assert.ok(seenHidden);
    const lastShown = close.filter(f => f.shown).pop();
    assert.ok(Math.hypot(lastShown.cx - t.x, lastShown.cy - t.y) < 60, 'the window ends back at the avatar');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
test('the photo info card opens out of the info button and closes back into it', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 2000, viewport: { width: 1180, height: 820 } });
  try {
    const p = s.page;
    await p.evaluate(() => { const u = location.origin + '/test-image/1-1.svg'; window.openPhotoPreview(0, { photos: [{ id: 'a1', imageUrl: u, thumbUrl: u, user_name: 'alice', width: 800, height: 600, created_at: new Date().toISOString() }] }); });
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active')); await p.waitForTimeout(800);
    const b = await p.evaluate(() => { const r = document.querySelector('#photoPreviewOverlay .pp-info-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.evaluate(() => { window.__rec = []; (function tick() { const m = document.getElementById('ppInfoModal'), c = m && m.querySelector('.pp-info-modal-content'); if (c && getComputedStyle(m).display !== 'none') { const r = c.getBoundingClientRect(); window.__rec.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width }); } requestAnimationFrame(tick); })(); });
    await p.mouse.click(b.x, b.y); await p.waitForTimeout(700);
    const open = await p.evaluate(() => window.__rec.splice(0));
    assert.ok(Math.hypot(open[0].cx - b.x, open[0].cy - b.y) < 4 && open[0].w < 80, 'the first frame sits on the info button');
    assert.ok(open[open.length - 1].w > 300, 'and ends as the full card');
    await p.evaluate(() => window.closePhotoInfo()); await p.waitForTimeout(700);
    const close = await p.evaluate(() => window.__rec.splice(0));
    const last = close[close.length - 1];
    assert.ok(last.w < 120 && Math.hypot(last.cx - b.x, last.cy - b.y) < 80, 'the card shrinks back to the info button before it disappears');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
test('comment avatars load eagerly so they do not stay as a letter, and the post detail shows the local post at once', { timeout: 60000 }, async () => {
  let release; const gate = new Promise(r => release = r);
  const s = await h.open({ settleMs: 2500, viewport: { width: 390, height: 844 }, mobile: true, user: 'xxz', extraRoutes: async (url, req, body) => {
    if (url.pathname === '/api/avatar/batch') { const av = {}; (body.users || []).forEach((u, i) => av[u] = h.DEFAULT_ORIGIN + '/test-image/' + (i + 1) + '-1.svg'); return { status: 200, json: { ok: true, avatars: av } }; }
    if (url.pathname.startsWith('/api/post/detail/')) { await gate; return { status: 500, headers: { 'content-type': 'application/json' }, json: { ok: false } }; }
    return null; } });
  try {
    const p = s.page;
    await p.waitForSelector('#feed .comment-item');
    await p.waitForTimeout(800);
    const loading = await p.evaluate(() => [...document.querySelectorAll('#feed .comment-avatar img')].map(i => i.getAttribute('loading')));
    assert.ok(loading.length > 0 && loading.every(v => v === 'eager'), 'comment avatars are eager: ' + loading.join());
    await p.evaluate(() => openPostDetail('p-0001'));
    await p.waitForSelector('#postDetailBody .post-detail-shell', { timeout: 3000 });
    assert.match(await p.locator('#postDetailBody').textContent(), /照片墙整理了一遍/, 'the post text is there while the full data is still loading');
    assert.ok(await p.locator('#postDetailBody .post-detail-more').count() >= 1, 'only the likes and comments say they are loading');
    release();
    await p.waitForFunction(() => /加载失败/.test(document.querySelector('#postDetailBody .post-detail-more')?.textContent || ''), null, { timeout: 5000 });
    assert.match(await p.locator('#postDetailBody').textContent(), /照片墙整理了一遍/, 'a failed refresh keeps the post text');
  } finally { release && release(); await s.close(); }
});
