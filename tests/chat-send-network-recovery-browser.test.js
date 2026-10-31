'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function setup(t, landedOnServer) {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  p.setDefaultTimeout(15000);
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [],
    relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  const stored = [];
  const state = { sends: 0 };
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: stored.slice(), has_more: false } }));
  await p.route('**/api/dm/send', async route => {
    state.sends++;
    const body = route.request().postDataJSON();
    const message = { id: '00000000-0000-4000-8000-00000000000' + state.sends, user_name: 'alice', media_type: '__dm__',
      media_url: 'bob', content: body.content, created_at: new Date().toISOString() };
    if (state.sends === 1) {
      // Safari "Load failed": the response never reaches the page. The server may or may not have stored it.
      if (landedOnServer) stored.push(message);
      return route.abort('connectionreset');
    }
    stored.push(message);
    return route.fulfill({ json: { ok: true, message } });
  });
  await p.evaluate(() => openChat('bob'));
  return { p, f, state };
}

test('a dropped connection is retried instead of showing a failed bubble when nothing was stored', { timeout: 40000 }, async t => {
  const { p, f, state } = await setup(t, false);
  await p.locator('#dockChatInput').fill('断线重试');
  await p.evaluate(() => { sendDockChatMessage(); });
  await p.waitForFunction(() => document.querySelector('#dockChatMessages [data-message-id]') && !document.querySelector('#dockChatMessages .pending'), null, { timeout: 20000 });
  assert.equal(state.sends, 2);
  assert.equal(await p.locator('#dockChatMessages .chat-msg', { hasText: '断线重试' }).count(), 1);
  assert.equal(await p.evaluate(() => document.body.textContent.includes('发送失败')), false);
  assert.deepEqual(f.errors.filter(e => !/ERR_|Failed to load resource|connection/i.test(e)), []);
});

test('a dropped connection after the server stored the message does not send a duplicate', { timeout: 40000 }, async t => {
  const { p, state } = await setup(t, true);
  await p.locator('#dockChatInput').fill('已入库的消息');
  await p.evaluate(() => { sendDockChatMessage(); });
  await p.waitForFunction(() => document.querySelector('#dockChatMessages [data-message-id]') && !document.querySelector('#dockChatMessages .pending'), null, { timeout: 20000 });
  assert.equal(state.sends, 1);
  assert.equal(await p.locator('#dockChatMessages .chat-msg', { hasText: '已入库的消息' }).count(), 1);
  assert.equal(await p.evaluate(() => document.body.textContent.includes('发送失败')), false);
});
