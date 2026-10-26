'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

const peers = ['constructor', '__proto__', 'toString'];
const states = peers.map((peer, i) => ({ peer_name: peer, last_message: '消息 ' + i,
  last_message_at: '2026-10-26T09:00:0' + i + 'Z', unread_count: 1 }));
const messages = peers.map((peer, i) => ({ id: '123e4567-e89b-42d3-a456-' + String(i + 1).padStart(12, '0'),
  user_name: peer, media_url: 'alice', media_type: '__dm__', content: JSON.stringify({ text: '消息 ' + i }),
  created_at: states[i].last_message_at }));

async function fixture(t) {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  f.page.setDefaultTimeout(7000);
  await f.page.waitForFunction(() => window._xtjAuthState === 'authenticated');
  await f.page.route('**/api/chat/**', route => route.fulfill({ json: { ok: true, friends: [], items: [], users: [],
    relationship: { status: 'friends', can_message: true }, state: { status: 'ok', draft_revision: 0 } } }));
  await f.page.route('**/api/dm/messages?**', route => route.fulfill({ json: { ok: true, data: [], has_more: false } }));
  return f;
}

test('prototype-property usernames retain unread counts and exact mute membership', { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page;
  const unread = await p.evaluate(messages => { const result = window.aggregateDmUnread(messages); return { total: result.total, senders: Object.entries(result.bySender) }; }, messages);
  assert.equal(unread.total, 3);
  assert.deepEqual(unread.senders, peers.map(peer => [peer, 1]));
  assert.equal(await p.evaluate(states => window.__xtjAuthoritativeDmUnread(states), states), 3);
  assert.equal(await p.evaluate(() => !!window.__xtjMutedChatPeers.constructor), false);
  assert.equal(await p.evaluate(states => window.__xtjAuthoritativeDmUnread(states.map(state => ({ ...state,
    muted_until: state.peer_name === '__proto__' ? 'infinity' : null }))), states), 2);
  assert.equal(await p.evaluate(() => window.__xtjMutedChatPeers.__proto__ === true), true);
  assert.equal(await p.evaluate(() => !!window.__xtjMutedChatPeers.constructor), false);
  assert.deepEqual(f.errors, []);
});

for (const authoritative of [true, false]) test('chat list retains prototype-property usernames with ' +
  (authoritative ? 'conversation states' : 'message fallback'), { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.route('**/api/dm/list?**', route => route.fulfill({ json: { ok: true, data: authoritative ? [] : messages,
    ...(authoritative ? { conversations: states } : {}) } }));
  await p.evaluate(() => { window.dockChatListCacheTime = 0; window.__xtjInvalidateDmListShared(); window.switchDockTab('chat', true); });
  await p.waitForFunction(peers => peers.every(peer => Array.from(document.querySelectorAll('#dockChatList [data-chat-user]'))
    .some(row => row.dataset.chatUser === peer)), peers).catch(async error => {
      error.message += ' ' + JSON.stringify(await p.evaluate(() => ({ owner: window.currentUser,
        rows: Array.from(document.querySelectorAll('#dockChatList [data-chat-user]')).map(row => row.dataset.chatUser),
        text: document.getElementById('dockChatList').textContent })));
      throw error;
    });
  assert.deepEqual(await p.locator('#dockChatList [data-signature][data-chat-user]').evaluateAll(rows => rows.map(r => r.dataset.chatUser).sort()), peers.slice().sort());
  if (authoritative) {
    await p.evaluate(() => { window.__xtjApplyConversationSnapshot([
      { peer_name: '__proto__', last_message: '置顶消息', last_message_at: '2026-10-26T09:01:00Z', pinned_at: '2026-10-26T09:00:00Z' },
      { peer_name: 'normal-peer', last_message: '普通消息', last_message_at: '2026-10-26T09:02:00Z' }
    ]); window.openChat('normal-peer'); });
    await p.locator('#dockChatConversationBtn').click();
    assert.equal(await p.locator('[data-chat-conversation-action="pin"]').count(), 1);
    assert.equal(await p.locator('[data-chat-conversation-action="unpin"]').count(), 0);
  }
  assert.deepEqual(f.errors, []);
});

test('chat social response rejects an old account epoch even when the same username signs back in', { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    const base = window.xtjProtectedFetch;
    window.xtjProtectedFetch = (url, options) => url === '/api/chat/conversations/race-peer'
      ? Promise.resolve({ ok: true, json: () => new Promise(resolve => { window.releaseChatSocialBody = () => resolve({ ok: true, state: { status: 'ok', deleted: true } }); }) })
      : base(url, options);
    window.chatSocialOutcome = window.requestDockChatSocial('/conversations/race-peer', { method: 'PATCH', body: JSON.stringify({ action: 'delete' }) })
      .then(() => 'accepted', error => error.code);
  });
  await p.waitForFunction(() => typeof window.releaseChatSocialBody === 'function');
  const outcome = await p.evaluate(async () => {
    currentUser = 'bob'; window.currentUser = currentUser; window._authStateEpoch++;
    currentUser = 'alice'; window.currentUser = currentUser; window._authStateEpoch++;
    window.releaseChatSocialBody(); return window.chatSocialOutcome;
  });
  assert.equal(outcome, 'identity_changed');
  assert.deepEqual(f.errors, []);
});

test('late conversation action does not close a different peers menu', { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    const base = window.xtjProtectedFetch;
    window.xtjProtectedFetch = (url, options) => url === '/api/chat/conversations/first-peer' && options.method === 'PATCH'
      ? Promise.resolve({ ok: true, json: () => new Promise(resolve => { window.releaseConversationAction = () => resolve({ ok: true, state: { status: 'ok', pinned_at: '2026-10-26T09:00:00Z' } }); }) })
      : base(url, options);
    window.openChat('first-peer');
  });
  await p.locator('#dockChatConversationBtn').click();
  await p.locator('[data-chat-conversation-action="pin"]').click();
  await p.waitForFunction(() => typeof window.releaseConversationAction === 'function');
  await p.evaluate(() => window.openChat('second-peer'));
  await p.locator('#dockChatConversationBtn').click();
  await p.evaluate(() => window.releaseConversationAction());
  await p.waitForFunction(() => !document.getElementById('dockChatConversationMenu').getAnimations().some(a => a.playState === 'running'));
  assert.equal(await p.locator('#dockChatConversationMenu').getAttribute('aria-hidden'), 'false');
  assert.equal(await p.locator('#dockChatConversationMenu').getAttribute('data-peer'), 'second-peer');
  assert.equal(await p.locator('#dockChatConversationBtn').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(f.errors, []);
});

test('a failed deletion sync cannot enqueue one accounts message ids under the next account', { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page, id = messages[0].id;
  await p.evaluate(id => {
    const base = window.xtjProtectedFetch;
    window.xtjProtectedFetch = (url, options) => url === '/api/dm/deleted' && options.method === 'POST'
      ? new Promise((resolve, reject) => { window.rejectDeletionSync = () => reject(Object.assign(new Error('账号已切换'), { code: 'identity_changed' })); })
      : base(url, options);
    window.deletionSyncOutcome = window.pushDmDeletedToServer([id]);
  }, id);
  await p.evaluate(async () => { currentUser = 'bob'; window.currentUser = currentUser; window._authStateEpoch++; window.rejectDeletionSync(); await window.deletionSyncOutcome; });
  assert.deepEqual(await p.evaluate(() => window._dmDeletedPendingPush), []);
  assert.deepEqual(f.errors, []);
});

test('a same-account deletion failure remains queued for retry', { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page, id = messages[0].id;
  await p.evaluate(id => {
    const base = window.xtjProtectedFetch;
    window.xtjProtectedFetch = async (url, options) => {
      if (url === '/api/dm/deleted') throw new Error('offline');
      return base(url, options);
    };
    return window.pushDmDeletedToServer([id]);
  }, id);
  assert.deepEqual(await p.evaluate(() => window._dmDeletedPendingPush), [{ account: 'alice', ids: [id] }]);
  assert.deepEqual(f.errors, []);
});

test('a deletion-list body from a previous login cannot overwrite the same names new local deletions', { timeout: 30000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    window.xtjProtectedFetch = async () => ({ ok: true, json: () => new Promise(resolve => {
      window.releaseDeletionList = () => resolve({ ids: ['old-session-delete'] });
    }) });
    window.deletionListOutcome = window.syncDmDeletedWithServer('race-peer', true);
  });
  await p.waitForFunction(() => typeof window.releaseDeletionList === 'function');
  await p.evaluate(async () => {
    currentUser = 'bob'; window.currentUser = currentUser; window._authStateEpoch++;
    currentUser = 'alice'; window.currentUser = currentUser; window._authStateEpoch++;
    localStorage.setItem('xtj_dm_deleted_alice', JSON.stringify(['current-session-delete']));
    window.releaseDeletionList(); await window.deletionListOutcome;
  });
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('xtj_dm_deleted_alice'))), ['current-session-delete']);
  assert.deepEqual(f.errors, []);
});
