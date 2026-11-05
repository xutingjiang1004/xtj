'use strict';
// Windows that open and close with the shared-element morph must keep the main thread free while they move: the page-wide
// inert/focus pass (tens of ms of style work on a phone), the list redraw that follows the data, and layout-thrashing
// helpers used to run in the middle of the motion and dropped frames. This pins the order: motion first, heavy work after
// the landing frame, and the focus behaviour that depends on that pass stays correct.
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function profileFixture(delayMs) {
  const f = await postBrowserFixture({ viewport: { width: 390, height: 844 }, theme: 'light', counts: [3, 15] });
  await f.page.route('**/api/profile/posts/**', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const author = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    return route.fulfill({ json: { ok: true, author, posts: f.posts.filter((p) => p.user_name === author), has_more: false, next_cursor: null } });
  });
  await f.page.evaluate(() => document.querySelector('#feed .avatar[role="button"], #feed .avatar-wrap[role="button"]').scrollIntoView({ block: 'center' }));
  await f.page.waitForTimeout(400);
  return f;
}
const avatar = (page) => page.locator('#feed .avatar[role="button"], #feed .avatar-wrap[role="button"]').first();
const settled = (page) => page.waitForFunction(() => { const b = document.querySelector('#userProfileModal .modal-box'); return !window.xtjMorph.running(b) && !window.__xtjMorphLanding; }, null, { timeout: 5000 });

test('the page-wide inert pass and the focus move wait for the landing; afterwards focus is inside the window, and back on the avatar after closing', { timeout: 60000 }, async () => {
  const f = await profileFixture(0);
  try {
    const p = f.page;
    await p.evaluate(() => {
      window.__inertWrites = []; window.__lastMotion = 0;
      new MutationObserver((records) => records.forEach((r) => { if (r.target.id !== 'userProfileModal') window.__inertWrites.push({ t: performance.now(), motion: window.xtjMorph.running(document.querySelector('#userProfileModal .modal-box')) }); })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert'] });
    });
    await avatar(p).focus();
    await avatar(p).press('Enter');
    await p.waitForSelector('#userProfileModal.active');
    await settled(p); await p.waitForTimeout(300);
    const open = await p.evaluate(() => {
      const modal = document.getElementById('userProfileModal');
      const others = [...document.body.children].filter((n) => n !== modal && n.nodeType === 1 && !n.matches('script,style,link,.toast,[role="status"],[role="alert"]'));
      return { modalInert: modal.inert, focusInside: modal.contains(document.activeElement), inertOthers: others.filter((n) => n.inert).length, others: others.length, duringMotion: window.__inertWrites.filter((w) => w.motion).length };
    });
    assert.equal(open.modalInert, false, 'the window itself is interactive');
    assert.ok(open.focusInside, 'focus moved into the window');
    assert.ok(open.inertOthers >= open.others - 3, 'the page behind is inert once it has landed: ' + JSON.stringify(open));
    assert.equal(open.duringMotion, 0, 'no element was made inert while the window was still moving: ' + open.duringMotion);

    await p.evaluate(() => { window.__inertWrites.length = 0; closeModal('userProfileModal'); });
    await p.waitForFunction(() => !document.getElementById('userProfileModal').classList.contains('active'));
    await settled(p); await p.waitForTimeout(300);
    const closed = await p.evaluate(() => {
      const modal = document.getElementById('userProfileModal');
      const surface = '.modal-overlay, .announcement-modal-overlay, .report-modal-overlay, #ppConfirmOverlay, #photoPreviewOverlay, #pwUploadSheet, #ppInfoModal, #imgViewer, .pp-download-confirm-overlay, [data-xtj-ai-modal], .dock-panel:not(.active)';
      const others = [...document.body.children].filter((n) => n !== modal && n.nodeType === 1 && !n.matches(surface) && !n.matches('script,style,link'));
      const a = document.activeElement;
      return { inertOthers: others.filter((n) => n.inert).length, modalInert: modal.inert, focusOnAvatar: !!(a && a.closest && a.closest('#feed .avatar, #feed .avatar-wrap')), duringMotion: window.__inertWrites.filter((w) => w.motion).length };
    });
    assert.equal(closed.inertOthers, 0, 'the page is interactive again: ' + JSON.stringify(closed));
    assert.equal(closed.modalInert, true, 'the closed window is inert');
    assert.ok(closed.focusOnAvatar, 'focus is back on the avatar that opened it');
    assert.equal(closed.duringMotion, 0, 'nothing was flipped while the window was still moving back');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('the ghost and the scrim of a morph do not make the focus lifecycle flip inert on the whole page', { timeout: 60000 }, async () => {
  const f = await profileFixture(0);
  try {
    const p = f.page;
    await p.evaluate(() => { window.__inertCount = 0; new MutationObserver((r) => { window.__inertCount += r.length; }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert'] }); });
    await avatar(p).press('Enter'); await p.waitForSelector('#userProfileModal.active'); await settled(p); await p.waitForTimeout(300);
    const afterOpen = await p.evaluate(() => window.__inertCount);
    await p.evaluate(() => closeModal('userProfileModal')); await p.waitForFunction(() => !document.getElementById('userProfileModal').classList.contains('active')); await settled(p); await p.waitForTimeout(300);
    const total = await p.evaluate(() => window.__inertCount);
    // One batch to make the background inert, one to give it back (plus the window itself and the dock panels); it used to be
    // several full passes because every node the morph added to the body triggered another one.
    assert.ok(afterOpen <= 70, 'opening flips each background node about once: ' + afterOpen);
    assert.ok(total - afterOpen <= 70, 'closing restores each of them about once: ' + (total - afterOpen));
  } finally { await f.close(); }
});

test('a profile list that arrives while the window is still opening is drawn after it has landed, not in the middle of the motion', { timeout: 60000 }, async () => {
  const f = await profileFixture(200);
  try {
    const p = f.page;
    await p.evaluate(() => {
      window.__rowsAt = 0; window.__landedAt = 0;
      (function tick() {
        const rows = document.querySelectorAll('#authorPostsList .author-post-row').length, box = document.querySelector('#userProfileModal .modal-box');
        if (rows && !window.__rowsAt) window.__rowsAt = performance.now();
        if (!window.xtjMorph.running(box) && window.__rowsAt === 0 && document.getElementById('userProfileModal').classList.contains('active') && !window.__landedAt && window.__started) window.__landedAt = performance.now();
        if (window.xtjMorph.running(box)) window.__started = true;
        requestAnimationFrame(tick);
      })();
    });
    await avatar(p).press('Enter');
    await p.waitForSelector('#authorPostsList .author-post-row', { timeout: 5000 });
    const t = await p.evaluate(() => ({ rowsAt: window.__rowsAt, running: window.xtjMorph.running(document.querySelector('#userProfileModal .modal-box')), landedBeforeRows: window.__landedAt > 0 }));
    assert.equal(t.running, false, 'the rows were not drawn while the window was still moving');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
