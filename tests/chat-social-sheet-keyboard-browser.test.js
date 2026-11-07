'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

test('the friends and contacts sheet is a real modal for the keyboard: focus enters, Tab stays inside, Esc closes and gives focus back', { timeout: 90000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [], conversations: [], relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  for (let i = 0; i < 6 && !(await p.evaluate(() => document.getElementById('panelChat').classList.contains('active'))); i++) { await p.locator('.dock-tab').nth(1).click(); await p.waitForTimeout(700); }
  await p.waitForTimeout(1200);
  const opener = p.locator('#dockChatSocialBtn');
  const sheetOpen = () => p.evaluate(() => { const s = document.getElementById('dockChatSocialSheet'); return !s.hidden && !s.inert && !s.classList.contains('hidden'); });
  const focusInside = () => p.evaluate(() => document.getElementById('dockChatSocialSheet').contains(document.activeElement));
  await opener.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  assert.equal(await sheetOpen(), true, 'Enter on the button opens the sheet');
  assert.equal(await focusInside(), true, 'focus moves into the sheet instead of staying on the button behind it');
  for (let i = 0; i < 14; i++) await p.keyboard.press('Tab');
  assert.equal(await focusInside(), true, 'Tab cycles inside the sheet and never reaches the chat behind');
  for (let i = 0; i < 14; i++) await p.keyboard.press('Shift+Tab');
  assert.equal(await focusInside(), true, 'and so does Shift+Tab');
  await p.keyboard.press('Escape'); await p.waitForTimeout(900);
  assert.equal(await sheetOpen(), false, 'Esc closes the sheet');
  assert.equal(await opener.evaluate(el => el === document.activeElement), true, 'focus goes back to the button that opened it');
  // Reopening works the same way every time.
  await opener.press('Enter'); await p.waitForTimeout(1000);
  assert.equal(await sheetOpen(), true);
  assert.equal(await focusInside(), true);
  assert.deepEqual(f.errors, []);
});
