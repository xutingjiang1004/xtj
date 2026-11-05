'use strict';
// The real site loads GSAP on demand and core-animations wraps openModal/closeModal with a GSAP fade. The shared-element
// morph owns the animated windows, so GSAP must stay out of them: on the phone it used to fade the profile window out,
// restore it opaque the moment the morph started (a flash), shift it 12px before the morph measured it (the flying avatar
// started and landed off), and tween the same window's transform/opacity again on open. The other browser tests run
// without GSAP (the CDN is blocked), so this one installs a stand-in that behaves the same way.
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');

function stubGsap() {
  const calls = (window.__gsapCalls = []);
  const live = new WeakMap();
  const overlayOf = (el) => { const o = el && el.closest && el.closest('.modal-overlay'); return o ? o.id : ''; };
  function paint(el, v) {
    if ('opacity' in v) el.style.opacity = String(v.opacity);
    if ('y' in v || 'scale' in v) el.style.transform = 'translateY(' + (v.y || 0) + 'px) scale(' + (v.scale == null ? 1 : v.scale) + ')';
  }
  function tween(el, from, to) {
    if (!el || !el.style) return;
    calls.push({ overlay: overlayOf(el), isBox: el.classList.contains('modal-box') });
    const old = live.get(el); if (old) cancelAnimationFrame(old);
    const start = Object.assign({ y: 0, scale: 1, opacity: 1 }, from || {}), end = Object.assign({}, start, to || {});
    paint(el, start);
    const t0 = performance.now(), ms = Math.max(16, ((to && to.duration) || 0.2) * 1000);
    (function step() {
      const k = Math.min(1, (performance.now() - t0) / ms), mix = (a, b) => a + (b - a) * k;
      paint(el, { y: mix(start.y, end.y), scale: mix(start.scale, end.scale), opacity: mix(start.opacity, end.opacity) });
      if (k < 1) { live.set(el, requestAnimationFrame(step)); return; }
      live.delete(el);
      if (to && to.clearProps) { el.style.removeProperty('transform'); el.style.removeProperty('opacity'); }
      if (to && to.onComplete) to.onComplete();
    })();
  }
  window.gsap = {
    fromTo: (el, from, to) => tween(el, from, to), to: (el, to) => tween(el, null, to),
    set: (el, v) => { if (el && el.style) paint(el, v || {}); },
    killTweensOf: (el) => { const id = live.get(el); if (id) cancelAnimationFrame(id); live.delete(el); },
    registerPlugin() {}, defaults() {}, timeline() { return { to() { return this; }, fromTo() { return this; }, set() { return this; } }; },
  };
}

const routes = async (url, req, body) => {
  if (url.pathname === '/api/avatar/batch') { const av = {}; ((body && body.users) || []).forEach((u) => { av[u] = '/api/avatar/image/' + u + '?v=1'; }); return { status: 200, json: { ok: true, avatars: av } }; }
  if (url.pathname.startsWith('/api/avatar/public/')) return { status: 200, json: { ok: true, avatar_url: '/api/avatar/image/' + url.pathname.split('/').pop() + '?v=1' } };
  if (url.pathname.startsWith('/api/avatar/image/')) return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: h.svgImg(3, 200, 200) };
  if (url.pathname.startsWith('/api/profile/posts/')) return { status: 200, json: { ok: true, author: 'x', posts: [], has_more: false, next_cursor: null, profile: {} } };
  return null;
};

test('with GSAP present the profile window opens and closes as one morph: no GSAP tween on it, no flash, the avatar lands exactly and the card avatar is never drawn twice', { timeout: 90000 }, async () => {
  const s = await h.open({ settleMs: 2600, viewport: { width: 390, height: 844 }, mobile: true, init: stubGsap, extraRoutes: routes });
  try {
    const p = s.page;
    await p.waitForSelector('#feed .post-feed-item img.avatar-image', { timeout: 8000 });
    assert.equal(await p.evaluate(() => typeof window.gsap), 'object', 'the stand-in is installed');
    const t = await p.evaluate(() => { const a = document.querySelector('#feed .post-feed-item .avatar'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.waitForTimeout(300);
    const feedRect = await p.evaluate(() => { const r = document.querySelector('#feed .post-feed-item .avatar img').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await p.evaluate(() => {
      window.__rec = [];
      (function tick() {
        const el = document.getElementById('userProfileModal'), box = el.querySelector('.modal-box');
        const ghost = [...document.body.children].find((c) => c.tagName === 'IMG' && c.style.zIndex === '2147483001'), gr = ghost && ghost.getBoundingClientRect();
        const feed = document.querySelector('#feed .post-feed-item .avatar img'), up = document.querySelector('#upcAvatar img'), ur = up && up.getBoundingClientRect();
        window.__rec.push({ a: +getComputedStyle(box).opacity * +getComputedStyle(el).opacity, shown: el.classList.contains('active'), ghost: gr ? [gr.left, gr.top, gr.width, gr.height] : null, ghostRadius: ghost ? parseFloat(getComputedStyle(ghost).borderTopLeftRadius) : null,
          feedVisible: getComputedStyle(feed).visibility !== 'hidden', up: ur ? [ur.left, ur.top, ur.width, ur.height] : null, upVisible: up ? getComputedStyle(up).visibility !== 'hidden' : null });
        requestAnimationFrame(tick);
      })();
    });
    const near = (a, b, tol, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, what + ': ' + a.map((x) => x.toFixed(1)) + ' vs ' + b.map((x) => x.toFixed(1))));

    await p.touchscreen.tap(t.x, t.y); await p.waitForTimeout(1300);
    const open = (await p.evaluate(() => window.__rec.splice(0))).filter((f) => f.shown || f.ghost);
    const flying = open.filter((f) => f.ghost);
    assert.ok(flying.length >= 8, 'the avatar flies over many frames: ' + flying.length);
    near(flying[0].ghost, feedRect, 1.5, 'the flying avatar starts exactly on the tapped avatar');
    const landing = open[open.length - 1], lastFlying = flying[flying.length - 1];
    near(lastFlying.ghost, landing.up, 1.5, 'and lands exactly on the avatar picture inside the 3px frame (66px, not the 72px frame)');
    assert.ok(flying.every((f) => !f.feedVisible), 'the card avatar is not drawn while its picture flies (otherwise two avatars overlap)');
    assert.ok(open[open.length - 1].feedVisible && open[open.length - 1].ghost === null, 'it is back once the picture has landed');
    for (let i = 1; i < open.length; i++) assert.ok(open[i].a >= open[i - 1].a - 0.001, 'opening never dims again: ' + open.map((f) => f.a.toFixed(2)).join(' '));
    assert.ok(Math.abs(flying[0].ghostRadius - 11) <= 1.5 || flying[0].ghostRadius > 8, 'the picture starts with the card avatar\'s rounded corners: ' + flying[0].ghostRadius);

    const upBeforeClose = await p.evaluate(() => { const r = document.querySelector('#upcAvatar img').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await p.evaluate(() => { window.__rec = []; closeModal('userProfileModal'); });
    await p.waitForTimeout(1100);
    const close = await p.evaluate(() => window.__rec.splice(0));
    const cflying = close.filter((f) => f.ghost);
    assert.ok(cflying.length >= 8, 'closing runs over many frames: ' + cflying.length);
    near(cflying[0].ghost, upBeforeClose, 1.5, 'the flying avatar starts exactly on the profile avatar (the window was not shifted by a fade first)');
    near(cflying[cflying.length - 1].ghost, feedRect, 1.5, 'and lands exactly on the card avatar');
    assert.ok(cflying.every((f) => !f.feedVisible), 'the card avatar is hidden while the picture flies back');
    const after = close[close.indexOf(cflying[cflying.length - 1]) + 1];
    assert.ok(after && after.ghost === null && after.feedVisible, 'the picture leaves and the card avatar shows in the same frame');
    let seen = false;
    for (let i = 1; i < close.length; i++) {
      if (!close[i].shown) seen = true;
      if (close[i].shown && close[i - 1].shown) assert.ok(close[i].a <= close[i - 1].a + 0.001, 'closing never brightens again (no flash): ' + close.filter((f) => f.shown).map((f) => f.a.toFixed(2)).join(' '));
      if (seen) assert.ok(!close[i].shown, 'once hidden it does not come back for a frame');
    }
    assert.ok(seen);
    const gsapOnWindow = await p.evaluate(() => window.__gsapCalls.filter((c) => c.overlay === 'userProfileModal'));
    assert.deepEqual(gsapOnWindow, [], 'GSAP did not touch the profile window');
    const left = await p.evaluate(() => ({ ghosts: [...document.body.children].filter((c) => c.tagName === 'IMG' && c.style.zIndex === '2147483001').length, feed: document.querySelector('#feed .post-feed-item .avatar img').style.visibility, box: document.querySelector('#userProfileModal .modal-box').getAttribute('style') || '' }));
    assert.equal(left.ghosts, 0); assert.equal(left.feed, '');
    assert.doesNotMatch(left.box, /opacity|transform/, 'nothing is left on the window afterwards: ' + left.box);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('with GSAP present the other animated windows are not tweened either, and windows the morph does not own still use it', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 2200, viewport: { width: 390, height: 844 }, mobile: true, init: stubGsap, extraRoutes: routes });
  try {
    const p = s.page;
    const t = await p.evaluate(() => { const a = document.querySelector('#feed .post-feed-item .avatar'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.touchscreen.tap(t.x, t.y); await p.waitForTimeout(900);
    await p.evaluate(() => closeModal('userProfileModal')); await p.waitForTimeout(700);
    assert.deepEqual(await p.evaluate(() => window.__gsapCalls.filter((c) => c.isBox && c.overlay === 'userProfileModal')), []);
    // A window without a tapped origin has no morph: GSAP keeps its own fade there.
    await p.evaluate(() => { window.__gsapCalls.length = 0; openModal('loginModal'); });
    await p.waitForTimeout(200);
    assert.ok(await p.evaluate(() => window.__gsapCalls.some((c) => c.overlay === 'loginModal' && c.isBox)), 'without a morph GSAP still animates the window');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
