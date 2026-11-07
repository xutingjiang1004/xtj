'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function chatFixture(t, counts = [1]) {
  const f = await postBrowserFixture({ counts, publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [], conversations: [], relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [], has_more: false } }));
  return f;
}
const activePanel = p => p.evaluate(() => (document.querySelector('.dock-panel.active') || {}).id);
// Tap a bottom tab like a person does; the very first tap right after load can land before the app is ready, so retry.
async function tapTab(p, index, panelId) {
  for (let i = 0; i < 6 && (await activePanel(p)) !== panelId; i++) { await p.locator('.dock-tab').nth(index).click(); await p.waitForTimeout(700); }
  assert.equal(await activePanel(p), panelId, 'the ' + panelId + ' tab is showing');
  await p.waitForTimeout(900);
}
const inConversation = p => p.evaluate(() => !document.getElementById('dockChatDetailView').classList.contains('hidden'));

test('opening a conversation from the chat list and going back returns to the chat list, not to the posts tab', { timeout: 90000 }, async t => {
  const f = await chatFixture(t); const p = f.page;
  await tapTab(p, 1, 'panelChat');
  const row = p.locator('#dockChatList .chat-list-item').first();
  for (let round = 1; round <= 3; round++) {
    await row.click(); await p.waitForTimeout(1200);
    assert.equal(await inConversation(p), true, 'round ' + round + ': the conversation opens');
    await p.locator('#dockChatBackBtn').click(); await p.waitForTimeout(1200);
    assert.equal(await activePanel(p), 'panelChat', 'round ' + round + ': back stays in the chat tab');
    assert.equal(await inConversation(p), false, 'round ' + round + ': and shows the list');
    assert.equal(await p.evaluate(() => document.getElementById('panelChat').inert), false, 'the chat tab is still usable');
  }
  // The keyboard works every time as well (it used to stop after the first return).
  for (const key of ['Enter', 'Space']) {
    await row.focus(); await p.keyboard.press(key); await p.waitForTimeout(1200);
    assert.equal(await inConversation(p), true, key + ' opens the conversation');
    await p.locator('#dockChatBackBtn').click(); await p.waitForTimeout(1200);
  }
  assert.deepEqual(f.errors, []);
});

test('a conversation opened straight from the posts tab still goes back to the posts tab at the same scroll position', { timeout: 90000 }, async t => {
  const f = await chatFixture(t, [8]); const p = f.page;
  await p.evaluate(() => { document.getElementById('panelPosts').scrollTop = 400; });
  const before = await p.evaluate(() => document.getElementById('panelPosts').scrollTop);
  assert.ok(before > 100, 'the feed is long enough to scroll: ' + before);
  await p.evaluate(() => openChat('bob')); await p.waitForTimeout(1500);
  assert.equal(await activePanel(p), 'panelChat');
  assert.equal(await inConversation(p), true);
  await p.locator('#dockChatBackBtn').click(); await p.waitForTimeout(1500);
  assert.equal(await activePanel(p), 'panelPosts', 'back returns to where the conversation was opened from');
  const after = await p.evaluate(() => document.getElementById('panelPosts').scrollTop);
  assert.ok(Math.abs(after - before) < 8, 'the scroll position is restored: ' + before + ' -> ' + after);
});

test('a leftover "return to posts" from an earlier visit cannot hijack a later conversation opened from the chat list', { timeout: 90000 }, async t => {
  const f = await chatFixture(t, [8]); const p = f.page;
  await p.evaluate(() => openChat('bob')); await p.waitForTimeout(1500);      // from posts: remembers posts
  await tapTab(p, 0, 'panelPosts');                                           // leaves by the bottom tab instead of the back button
  await tapTab(p, 1, 'panelChat');
  await p.evaluate(() => document.getElementById('dockChatBackBtn').click()); await p.waitForTimeout(900);
  const row = p.locator('#dockChatList .chat-list-item').first();
  await row.click(); await p.waitForTimeout(1200);
  assert.equal(await inConversation(p), true);
  await p.locator('#dockChatBackBtn').click(); await p.waitForTimeout(1200);
  assert.equal(await activePanel(p), 'panelChat', 'back goes to the chat list, the old posts position is gone');
});
