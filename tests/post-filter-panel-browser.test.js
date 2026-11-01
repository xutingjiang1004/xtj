'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
test('the search and filter panel is a compact popover from the search button that does not push the page, and its controls still filter the feed', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 2200, viewport: { width: 390, height: 844 }, mobile: true, extraRoutes: async (url) => {
    if (url.pathname === '/api/feed/authors') return { status: 200, json: { ok: true, authors: ['xtj', 'xxz', 'alice', 'bob'] } };
    return null; } });
  try {
    const p = s.page;
    const feedTop = () => p.evaluate(() => Math.round(document.querySelector('#feed .post-feed-item').getBoundingClientRect().top));
    const before = await feedTop();
    await p.locator('#filterToggleBtn').click();
    await p.waitForTimeout(900);
    const box = await p.evaluate(() => { const r = document.getElementById('postFilterPanel').getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), pos: getComputedStyle(document.getElementById('postFilterPanel')).position }; });
    assert.equal(box.pos, 'fixed'); assert.ok(box.h < 430, 'the panel is compact: ' + box.h); assert.ok(box.w >= 340 && box.w <= 366);
    assert.equal(await feedTop(), before, 'opening it does not move the feed');
    assert.equal(await p.locator('#filterToggleBtn').getAttribute('aria-expanded'), 'true');
    // controls still drive the filter state
    await p.locator('#postVisibilitySeg button[data-visibility="public"]').click();
    assert.equal(await p.evaluate(() => document.getElementById('postVisibilityFilter').value), 'public');
    assert.equal(await p.locator('#postVisibilitySeg button.on').getAttribute('data-visibility'), 'public');
    await p.fill('#postStartDate', '2026-10-01'); await p.fill('#postEndDate', '2026-09-01'); await p.waitForTimeout(200);
    assert.equal(await p.locator('#postDateError').isVisible(), true, 'a start date after the end date is reported');
    await p.fill('#postEndDate', '2026-12-01');
    await p.locator('#postOnlyMine').evaluate(el => el.click()); await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => document.getElementById('postOnlyMine').checked), true);
    assert.ok(Number(await p.locator('#filterActiveBadge').textContent()) >= 3, 'the badge counts the active filters');
    await p.locator('#postUserQuickList .post-user-chip').nth(1).click(); await p.waitForTimeout(200);
    assert.ok(await p.evaluate(() => document.getElementById('postUserFilter').value) !== '', 'a user chip selects that user');
    // clear resets every control and closes the panel
    await p.locator('#filterClearBtn').click(); await p.waitForTimeout(400);
    assert.equal(await p.evaluate(() => document.getElementById('postVisibilityFilter').value), 'all');
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('postFilterPanel')).display), 'none');
    // outside tap and Escape close it
    await p.locator('#filterToggleBtn').click(); await p.waitForTimeout(700);
    await p.mouse.click(20, 780); await p.waitForTimeout(700);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('postFilterPanel')).display), 'none', 'tapping outside closes it');
    await p.locator('#filterToggleBtn').click(); await p.waitForTimeout(700);
    await p.keyboard.press('Escape'); await p.waitForTimeout(700);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('postFilterPanel')).display), 'none', 'Escape closes it');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
