'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const row = (n, url) => ({ id: '00000000-0000-4000-8000-00000000000' + n, user_name: 'alice', media_type: '__dm_img__', media_url: 'bob',
  actor_key: '__dm_img__x/' + n + '.png', created_at: '2026-10-27T12:14:0' + n + 'Z',
  content: JSON.stringify({ type: 'dm', text: '', read_at: '2026-10-27T12:14:00Z', media: { kind: 'image', url, w: 1, h: 1 } }) });

test('chat photos show a sweep placeholder until they finish downloading', { timeout: 30000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  p.setDefaultTimeout(7000);
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', r => r.fulfill({ json: { ok: true, friends: [], items: [], users: [],
    relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  await p.route('**/api/dm/messages?**', r => r.fulfill({ json: { ok: true, data: [row(1, '/fast-chat.png'), row(2, '/slow-chat.png')], has_more: false } }));
  await p.route('**/fast-chat.png', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await p.route('**/slow-chat.png', async r => { await held; await r.fulfill({ contentType: 'image/png', body: PNG }); });
  await p.evaluate(() => openChat('bob'));
  const img = n => p.locator('#dockChatMessages [data-message-id$="' + n + '"] img.msg-img');
  await p.waitForFunction(() => document.querySelector('#dockChatMessages [data-message-id$="1"] img.msg-img[data-loaded="1"]'));
  assert.equal(await img(2).getAttribute('data-loaded'), null);
  assert.notEqual(await img(2).evaluate(el => getComputedStyle(el).animationName), 'none');
  release();
  await p.waitForFunction(() => document.querySelector('#dockChatMessages [data-message-id$="2"] img.msg-img[data-loaded="1"]'));
  assert.equal(await img(2).evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(f.errors, []);
});
