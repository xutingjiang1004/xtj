'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function open(t, extra = {}) {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true, ...extra });
  t.after(() => f.close());
  const p = f.page;
  p.setDefaultTimeout(10000);
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [],
    relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  return { f, p };
}

async function menu(p, selector, action) {
  await p.locator(selector).first().click({ button: 'right' });
  await p.locator('[data-dm-action="' + action + '"]').click();
}

test('retrying a failed text bubble reuses its client_message_id and leaves one bubble', { timeout: 40000 }, async t => {
  const { f, p } = await open(t);
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [], has_more: false } }));
  const ids = [];
  await p.route('**/api/dm/send', route => {
    const body = route.request().postDataJSON();
    ids.push(body.client_message_id);
    if (ids.length === 1) return route.fulfill({ status: 400, json: { ok: false, error: '内容不合规' } });
    return route.fulfill({ json: { ok: true, message: { id: '00000000-0000-4000-8000-000000000001', user_name: 'alice', media_type: '__dm__',
      media_url: 'bob', content: body.content, created_at: new Date().toISOString() } } });
  });
  await p.evaluate(() => openChat('bob'));
  await p.locator('#dockChatInput').fill('会失败的消息');
  await p.evaluate(() => { sendDockChatMessage(); });
  await p.waitForSelector('#dockChatMessages .chat-msg-row[data-message-id^="temp-"]');
  await menu(p, '#dockChatMessages .chat-msg-row[data-message-id^="temp-"] .chat-msg', 'resend');
  await p.waitForFunction(() => document.querySelector('#dockChatMessages [data-message-id="00000000-0000-4000-8000-000000000001"]'));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1], 'retry must reuse the idempotency key');
  assert.equal(await p.locator('#dockChatMessages .chat-msg', { hasText: '会失败的消息' }).count(), 1);
  assert.deepEqual(f.errors.filter(e => !/Failed to load resource/.test(e)), []);
});

test('withdrawing a recent message replaces its bubble and keeps one row', { timeout: 40000 }, async t => {
  const id = '00000000-0000-4000-8000-0000000000aa';
  const mine = { id, user_name: 'alice', media_type: '__dm__', media_url: 'bob', actor_key: '__dm__', views: 0,
    content: JSON.stringify({ type: 'dm', text: '马上撤回', read_at: null }), created_at: new Date().toISOString() };
  const { f, p } = await open(t, { dmMessages: [mine] });
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [mine], has_more: false } }));
  await p.route('**/api/dm/withdraw', route => route.fulfill({ json: { ok: true,
    message: { ...mine, content: JSON.stringify({ text: '[消息已撤回]', withdrawn: true, read_at: null }) } } }));
  await p.evaluate(() => openChat('bob'));
  await p.waitForSelector('#dockChatMessages .chat-msg-row[data-message-id="' + id + '"] .chat-msg');
  await menu(p, '#dockChatMessages .chat-msg-row[data-message-id="' + id + '"] .chat-msg', 'withdraw');
  await p.waitForFunction(() => document.querySelector('#dockChatMessages .withdrawn'));
  assert.equal(await p.locator('#dockChatMessages .chat-msg-row').count(), 1);
  assert.equal(await p.locator('#dockChatMessages', { hasText: '马上撤回' }).count(), 0);
  assert.deepEqual(f.errors.filter(e => !/Failed to load resource/.test(e)), []);
});
