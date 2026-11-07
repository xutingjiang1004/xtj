'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

const openIds = page => page.evaluate(() => [...document.querySelectorAll('.modal-overlay.active, .report-modal-overlay.active')].map(e => e.id));
const settle = (page, ms = 800) => page.waitForTimeout(ms);

test('Esc closes the window that is on top, never the one underneath, and never two at once', { timeout: 90000 }, async () => {
  const f = await postBrowserFixture({ counts: [3], user: 'alice' });
  try {
    const page = f.page, post = f.posts[0];
    // A post detail opened over a profile: the profile comes later in the page source, which used to make Esc close it instead.
    await page.evaluate(() => openUserProfile('alice')); await settle(page, 1300);
    await page.evaluate(id => openPostDetail(id), post.id); await settle(page, 1300);
    assert.deepEqual((await openIds(page)).sort(), ['postDetailModal', 'userProfileModal']);
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await openIds(page), ['userProfileModal'], 'the first Escape closes the detail on top and leaves the profile');
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await openIds(page), []);
    // The report form (its own Escape handling) over a detail: one Escape must not also close the detail below.
    await page.evaluate(id => openPostDetail(id), post.id); await settle(page, 1300);
    await page.evaluate(id => openPostReport(id), post.id); await settle(page, 1300);
    assert.deepEqual((await openIds(page)).sort(), ['postDetailModal', 'reportModal']);
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await openIds(page), ['postDetailModal'], 'one Escape closes only the report form');
    await page.keyboard.press('Escape'); await settle(page);
    assert.deepEqual(await openIds(page), []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('the post tools menu keeps its role="menu" promise: it has a name and the arrow keys move between its items', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [2], user: 'alice' });
  try {
    const page = f.page, post = f.posts[0];
    await page.locator('.post[data-post-id="' + post.id + '"] .post-tools-trigger').first().click(); await settle(page, 600);
    const menu = page.locator('.post-tools-menu');
    assert.equal(await menu.getAttribute('aria-label'), '帖子工具');
    const items = await menu.locator('[role="menuitem"]').count();
    assert.ok(items >= 3, 'the menu has its items');
    const focused = () => menu.evaluate(m => [...m.querySelectorAll('[role="menuitem"]')].indexOf(document.activeElement));
    assert.equal(await focused(), 0, 'focus starts on the first item');
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(), 1);
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(), 2);
    await page.keyboard.press('End'); assert.equal(await focused(), items - 1);
    await page.keyboard.press('ArrowDown'); assert.equal(await focused(), 0, 'ArrowDown wraps from the last item to the first');
    await page.keyboard.press('ArrowUp'); assert.equal(await focused(), items - 1, 'ArrowUp wraps from the first item to the last');
    await page.keyboard.press('Home'); assert.equal(await focused(), 0);
    await page.keyboard.press('Escape'); await settle(page, 500);
    assert.equal(await menu.count() === 0 || await menu.evaluate(m => m.getBoundingClientRect().height === 0 || getComputedStyle(m).visibility === 'hidden' || getComputedStyle(m).opacity === '0'), true);
  } finally { await f.close(); }
});

test('"浏览 N" and "点赞 N" can be hit with a thumb: a larger touch area that changes neither the layout nor the like button', { timeout: 90000 }, async () => {
  const f = await postBrowserFixture({ counts: [2], user: 'alice' });
  try {
    const page = f.page;
    await page.route('**/relations/**', route => route.fulfill({ json: { ok: true, data: [], has_more: false, next_cursor: null, total: 0 } }));
    const card = page.locator('.post[data-post-id]').first(), link = card.locator('.post-stat-link').first();
    const layout = await card.evaluate(c => ({ statsHeight: Math.round(c.querySelector('.post-stats-text').getBoundingClientRect().height), likeTop: Math.round(c.querySelector('.actions .like-btn').getBoundingClientRect().top) }));
    assert.ok(layout.statsHeight <= 20, 'the stats line is still one line of text: ' + layout.statsHeight);
    const box = await link.boundingBox();
    assert.ok(box.height >= 32 && box.width >= 40, 'the touch area is at least 32px tall: ' + box.width + 'x' + box.height);
    const opened = () => page.evaluate(() => document.getElementById('postStatsModal').classList.contains('active'));
    for (const [where, x, y] of [['above the text', box.x + box.width / 2, box.y + 3], ['below the text', box.x + box.width / 2, box.y + box.height - 3], ['left of the text', box.x + 3, box.y + box.height / 2]]) {
      await page.evaluate(() => document.getElementById('postStatsModal').classList.remove('active'));
      await page.mouse.click(x, y); await settle(page, 450);
      assert.equal(await opened(), true, 'a tap ' + where + ' opens the panel');
    }
    await page.evaluate(() => document.getElementById('postStatsModal').classList.remove('active'));
    const like = card.locator('.actions .like-btn'), lb = await like.boundingBox(), pressed = await like.getAttribute('aria-pressed');
    await page.mouse.click(lb.x + lb.width / 2, lb.y + 2); await settle(page);
    assert.notEqual(await like.getAttribute('aria-pressed'), pressed, 'the top edge of the like button still likes');
    assert.equal(await opened(), false, 'and does not open the stats panel');
    assert.equal(await card.evaluate(c => Math.round(c.querySelector('.actions .like-btn').getBoundingClientRect().top)), layout.likeTop, 'nothing moved');
  } finally { await f.close(); }
});

test('the chat box says when a paste is cut at 500 characters, and the inputs tell the mobile keyboard to show "发送"', { timeout: 60000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [], relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [], has_more: false } }));
  await p.evaluate(() => openChat('bob')); await settle(p, 1500);
  const attrs = await p.evaluate(() => { const i = document.getElementById('dockChatInput'); return { enterkeyhint: i.getAttribute('enterkeyhint'), label: i.getAttribute('aria-label'), max: i.getAttribute('maxlength') }; });
  assert.deepEqual(attrs, { enterkeyhint: 'send', label: '输入消息', max: '500' });
  const toasts = () => p.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')].map(e => e.textContent.trim()));
  const paste = text => p.evaluate(value => { const el = document.getElementById('dockChatInput'); el.focus(); const dt = new DataTransfer(); dt.setData('text', value); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
  await paste('短短的一句话'); await settle(p, 300);
  assert.deepEqual((await toasts()).filter(x => /最多/.test(x)), [], 'a normal paste says nothing');
  await paste('哈'.repeat(600)); await settle(p, 300);
  assert.ok((await toasts()).some(x => /消息最多 500 字/.test(x)), 'a paste that does not fit is announced: ' + JSON.stringify(await toasts()));
  // the post comment input and the old image viewer's close button have names too
  const post = f.posts[0];
  await p.evaluate(() => { const t = document.querySelectorAll('.dock-tab')[0]; if (t) t.click(); }); await settle(p, 600);
  await p.evaluate(id => openComment(id), post.id); await settle(p, 900);
  const comment = await p.evaluate(() => { const i = document.querySelector('.inline-comment-inp'); return { enterkeyhint: i.getAttribute('enterkeyhint'), label: i.getAttribute('aria-label') }; });
  assert.deepEqual(comment, { enterkeyhint: 'send', label: '写评论' });
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<button id="ivClose" class="iv-close" aria-label="关闭预览"/);
});
