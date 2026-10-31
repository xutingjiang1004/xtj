'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

test('rapid sends show every bubble at once, send in order and never toast "已排队"', { timeout: 25000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  p.setDefaultTimeout(7000);
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [],
    relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [], has_more: false } }));
  const sent = [];
  let releaseFirst;
  const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
  await p.route('**/api/dm/send', async route => {
    const body = route.request().postDataJSON();
    const text = JSON.parse(body.content).text;
    sent.push({ text, id: body.client_message_id });
    if (sent.length === 1) await firstHeld;
    await route.fulfill({ json: { ok: true, message: { id: '00000000-0000-4000-8000-00000000000' + sent.length,
      user_name: 'alice', media_type: '__dm__', media_url: 'bob', content: body.content,
      created_at: new Date(Date.now() + sent.length).toISOString() } } });
  });
  await p.evaluate(() => openChat('bob'));
  for (const text of ['第一条', '第二条', '第三条']) {
    await p.locator('#dockChatInput').fill(text);
    await p.evaluate(() => { sendDockChatMessage(); });
  }
  // First request is still in flight: all three bubbles must already be visible.
  await p.waitForFunction(() => ['第一条', '第二条', '第三条'].every(x => document.getElementById('dockChatMessages').textContent.includes(x)));
  assert.equal(await p.locator('#dockChatInput').inputValue(), '');
  assert.equal(sent.length, 1);
  assert.equal(await p.evaluate(() => document.body.textContent.includes('已排队')), false);
  releaseFirst();
  await p.waitForFunction(() => document.querySelectorAll('#dockChatMessages [data-message-id]').length >= 3 &&
    !document.querySelector('#dockChatMessages .pending'));
  assert.deepEqual(sent.map(x => x.text), ['第一条', '第二条', '第三条']);
  assert.equal(new Set(sent.map(x => x.id)).size, 3);
  assert.equal(await p.evaluate(() => (document.getElementById('dockChatMessages').textContent.match(/第[一二三]条/g) || []).length), 3);
  assert.deepEqual(f.errors, []);
});

test('queued text is put back into its own draft when the user switches conversation first', { timeout: 30000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  p.setDefaultTimeout(7000);
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  const drafts = {};
  await p.route('**/api/chat/**', route => {
    const req = route.request();
    const peer = decodeURIComponent(new URL(req.url()).pathname.split('/').pop());
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON();
      if (body.action === 'draft') drafts[peer] = body.draft_text;
    }
    route.fulfill({ json: { ok: true, friends: [], items: [], users: [], relationship: { status: 'friends', can_message: true },
      state: { status: 'ok', draft_text: drafts[peer] || '', draft_revision: 0 } } });
  });
  await p.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [], has_more: false } }));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let calls = 0;
  await p.route('**/api/dm/send', async route => {
    calls++;
    const body = route.request().postDataJSON();
    await held;
    await route.fulfill({ json: { ok: true, message: { id: '00000000-0000-4000-8000-000000000009', user_name: 'alice',
      media_type: '__dm__', media_url: 'bob', content: body.content, created_at: new Date().toISOString() } } });
  });
  await p.evaluate(() => openChat('bob'));
  for (const text of ['先发的', '没来得及发的']) {
    await p.locator('#dockChatInput').fill(text);
    await p.evaluate(() => { sendDockChatMessage(); });
  }
  await p.evaluate(() => openChat('carol'));
  release();
  await p.waitForFunction(() => document.body.textContent.includes('已放回草稿'));
  await p.evaluate(() => openChat('bob'));
  await p.waitForFunction(() => document.getElementById('dockChatInput').value === '没来得及发的');
  assert.equal(calls, 1);
  assert.equal(await p.evaluate(() => document.getElementById('dockChatMessages').textContent.includes('没来得及发的')), false);
});

test('marking more than 200 unread messages read is sent in batches of 200', { timeout: 30000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  const p = f.page;
  p.setDefaultTimeout(7000);
  await p.waitForFunction(() => window._xtjAuthState === 'authenticated');
  const batches = [];
  await p.route('**/api/dm/read', route => { batches.push(route.request().postDataJSON().message_ids.length); route.fulfill({ json: { ok: true, data: [] } }); });
  await p.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [], state: { status: 'ok', draft_revision: 0 } } }));
  await p.evaluate(() => window.markMessagesRead('bob', [], Array.from({ length: 450 }, (_, i) => ({ id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0') }))));
  assert.deepEqual(batches, [200, 200, 50]);
});
