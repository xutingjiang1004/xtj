'use strict';
// Group chat in the real page, backed by the real router and real PostgreSQL
// (skips without XTJ_TEST_DATABASE_URL like the other database-backed tests).
const test = require('node:test'), assert = require('node:assert/strict');
const connectionString = process.env.XTJ_TEST_DATABASE_URL;

test('group chat: list, create, send, receive, withdraw, info page and owner tools', { skip: !connectionString, timeout: 180000 }, async t => {
  const { withBackendDatabase } = require('./helpers/backend-database-fixture');
  const { postBrowserFixture } = require('./helpers/post-browser-fixture');
  const H = require('./helpers/chat-groups-harness');
  await withBackendDatabase(async ({ db, pool }) => {
    await H.seedUsers(db, ['alice', 'bob', 'carol', 'dave', 'erin']);
    await H.befriend(db, 'alice', ['bob', 'carol', 'dave', 'erin']);
    await H.befriend(db, 'bob', ['erin']);
    const hiking = await H.rpc(db, 'chat_group_create', { p_actor: 'alice', p_name: '周末徒步群', p_members: ['bob', 'carol', 'dave'] });
    const send = (actor, group, body, meta = {}) => H.rpc(db, 'chat_group_send', { p_actor: actor, p_group: group, p_kind: 'text', p_body: body, p_meta: meta, p_reply_to: null, p_client_id: null });
    await send('bob', hiking.group_id, '周六早上八点集合怎么样？');
    await send('carol', hiking.group_id, '@alice 你带水吗', { mentions: ['alice'] });
    const f = await postBrowserFixture({ counts: [1], publicPosts: true });
    const api = await H.startGroupApi(pool, { mediaOrigin: f.origin });
    t.after(async () => { await api.close(); await f.close(); });
    const p = f.page;
    p.setDefaultTimeout(8000);
    await H.wirePage(p, api);
    await p.evaluate(() => window.switchDockTab('chat', true));

    await t.test('the list shows groups with unread count, @ mention and nav badge', async () => {
      const row = p.locator('#dockGroupList .grp-row');
      await row.first().waitFor();
      assert.match(await row.first().textContent(), /周末徒步群\(4\)/);
      assert.match(await row.first().textContent(), /\[有人@我\]/);
      assert.equal((await row.first().locator('.cli-badge').textContent()).trim(), '2');
      await p.waitForFunction(() => document.getElementById('navChatBadge').textContent === '2');
      // The group section sits above the direct-message list.
      assert.equal(await p.evaluate(() => {
        const s = document.getElementById('dockGroupSection'), l = document.getElementById('dockChatList');
        return !!(s.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
      }), true);
    });

    await t.test('opening a group renders history, marks it read and sends with an optimistic bubble', async () => {
      await p.click('#dockGroupList .grp-row');
      await p.locator('#groupStream .grp-msg').nth(1).waitFor();
      assert.equal(await p.locator('#groupChatTitle').textContent(), '周末徒步群');
      assert.match(await p.locator('#groupStream .grp-system').first().textContent(), /alice 创建了群聊/);
      await p.waitForFunction(() => document.getElementById('navChatBadge').textContent === '');
      await p.fill('#groupChatInput', '大家好');
      await p.click('#groupSendBtn');
      const mine = p.locator('#groupStream .grp-msg.is-mine').last();
      await mine.waitFor();
      assert.equal(await p.inputValue('#groupChatInput'), '');
      await p.waitForFunction(() => { const n = document.querySelector('#groupStream .grp-msg.is-mine'); return n && !n.closest('[data-msg-id]').dataset.msgId.startsWith('local:'); });
      const stored = await db.query("SELECT count(*)::int AS n FROM chat_group_messages WHERE body='大家好'");
      assert.equal(stored.rows[0].n, 1);
      assert.deepEqual(api.store.events.at(-1).users.sort(), ['bob', 'carol', 'dave']);
      assert.equal(api.store.events.at(-1).event, 'chat-group');
    });

    await t.test('@ picker inserts a mention that reaches the server', async () => {
      await p.fill('#groupChatInput', '');
      await p.type('#groupChatInput', '@bo');
      await p.locator('#groupMentionPop [data-mention="bob"]').waitFor();
      await p.keyboard.press('Enter');
      assert.equal(await p.inputValue('#groupChatInput'), '@bob ');
      await p.type('#groupChatInput', '看这里');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => Array.from(document.querySelectorAll('#groupStream .grp-mention')).some(n => n.textContent === '@bob'));
      // The bubble is drawn before the request lands, so wait for the stored row instead of reading it at once.
      let row;
      for (let i = 0; i < 100 && !row; i++) {
        row = (await db.query("SELECT meta FROM chat_group_messages WHERE body='@bob 看这里'")).rows[0];
        if (!row) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(row, 'the mention message was stored');
      assert.deepEqual(row.meta.mentions, ['bob']);
    });

    await t.test('a realtime event pulls in another member’s message without re-rendering old ones', async () => {
      const marker = await p.evaluate(() => { const n = document.querySelector('#groupStream [data-msg-id]'); n.__marker = 1; return n.dataset.msgId; });
      await send('dave', hiking.group_id, '我带帐篷');
      await p.evaluate(id => window.__xtjApplyGroupEvent({ kind: 'message', group_id: id }), hiking.group_id);
      await p.waitForFunction(() => /我带帐篷/.test(document.getElementById('groupStream').textContent));
      assert.equal(await p.evaluate(id => document.querySelector('#groupStream [data-msg-id="' + id + '"]').__marker, marker), 1);
    });

    await t.test('an image is uploaded, stored privately and shown through a signed URL', async () => {
      const png = await require('sharp')({ create: { width: 320, height: 200, channels: 3, background: '#4a9' } }).png().toBuffer();
      await p.setInputFiles('#groupImageInput', { name: 'trail.png', mimeType: 'image/png', buffer: png });
      await p.waitForFunction(() => { const img = document.querySelector('#groupStream .grp-msg.is-mine .grp-image img'); return img && img.complete && img.naturalWidth > 0 && !img.closest('[data-msg-id]').dataset.msgId.startsWith('local:'); });
      const row = (await db.query("SELECT meta FROM chat_group_messages WHERE kind='image'")).rows[0];
      assert.match(row.meta.storage_path, /^chat\/[a-f0-9]{12}_private_grp[a-f0-9]{32}\.png$/);
      assert.equal(row.meta.width, 320); assert.equal(row.meta.height, 200);
      assert.ok(api.store.objects.has(row.meta.storage_path));
      // The storage path never reaches the browser.
      const page = await (await fetch(api.base + '/api/groups/' + hiking.group_id + '/messages?limit=5', { headers: { 'x-test-user': 'bob' } })).json();
      const image = page.messages.find(m => m.kind === 'image');
      assert.equal(image.media_path, undefined); assert.equal(image.meta.storage_path, undefined);
      assert.match(image.media_url, /\/test-group-media\/chat\//);
    });

    await t.test('withdrawing my message turns it into a notice for everyone', async () => {
      const bubble = p.locator('#groupStream .grp-msg.is-mine .grp-bubble', { hasText: '大家好' });
      await bubble.click({ button: 'right' });
      await p.locator('.grp-menu [data-menu="withdraw"]').click();
      await p.waitForFunction(() => /你撤回了一条消息/.test(document.getElementById('groupStream').textContent));
      const row = (await db.query("SELECT withdrawn_at FROM chat_group_messages WHERE body='大家好'")).rows[0];
      assert.ok(row.withdrawn_at);
    });

    await t.test('info page: do not disturb, pin, nickname, background and announcement', async () => {
      await p.click('#groupChatInfoBtn');
      await p.locator('.grp-info .grp-member-grid .grp-member').first().waitFor();
      assert.equal(await p.locator('.grp-info .grp-member[data-member]').count(), 4);
      await p.locator('.grp-info [data-switch="muted"] + .grp-switch').click();
      await p.locator('.grp-info [data-switch="pinned"] + .grp-switch').click();
      await p.waitForFunction(() => /免打扰/.test(document.querySelector('#dockGroupList .grp-row').textContent) && /置顶/.test(document.querySelector('#dockGroupList .grp-row').textContent));
      await p.click('.grp-info [data-info="nickname"]');
      await p.fill('.xtj-prompt-dialog input', '领队小A');
      await p.click('.xtj-prompt-dialog .is-primary');
      await p.waitForFunction(() => /领队小A/.test(document.querySelector('.grp-info').textContent));
      await p.click('.grp-info [data-info="background"]');
      await p.click('.grp-sheet [data-bg="mint"]');
      await p.waitForFunction(() => document.getElementById('groupChatMessages').classList.contains('grp-bg-mint'));
      await p.keyboard.press('Escape');
      await p.click('.grp-info [data-info="announce"]');
      await p.click('.grp-sheet [data-ann="edit"]');
      await p.fill('#grpAnnInput', '周六 8:00 地铁站 B 口集合');
      await p.click('.grp-sheet [data-ann="save"]');
      await p.waitForFunction(() => /地铁站 B 口/.test(document.querySelector('.grp-info').textContent));
      const m = (await db.query("SELECT nickname,muted,pinned_at,background FROM chat_group_members m JOIN chat_users u ON u.id=m.user_id WHERE u.user_name='alice' AND group_id=$1", [hiking.group_id])).rows[0];
      assert.equal(m.nickname, '领队小A'); assert.equal(m.muted, true); assert.ok(m.pinned_at); assert.equal(m.background, 'mint');
      // A muted group does not count towards the navigation badge.
      await send('bob', hiking.group_id, '收到');
      await p.evaluate(() => window.__xtjChatGroups.reload());
      assert.equal(await p.locator('#navChatBadge').textContent(), '');
    });

    await t.test('QR code, search and complaint', async () => {
      await p.click('.grp-info [data-info="qr"]');
      await p.waitForFunction(() => { const c = document.getElementById('grpQrCanvas'); return c && c.width > 100; });
      await p.keyboard.press('Escape');
      await p.click('.grp-info [data-info="search"]');
      await p.fill('#grpSearchInput', '帐篷');
      await p.locator('.grp-search-row').first().waitFor();
      assert.match(await p.locator('.grp-search-row mark').first().textContent(), /帐篷/);
      await p.keyboard.press('Escape');
      await p.click('.grp-info [data-info="report"]');
      await p.check('.grp-sheet input[value="spam"]');
      await p.fill('#grpReportText', '有人发广告');
      await p.click('#grpReportSubmit');
      await p.waitForFunction(() => !document.getElementById('grpReportSubmit'));
      const report = JSON.parse(api.store.inserts.at(-1).rows[0].content);
      assert.equal(report.target_type, 'group'); assert.equal(report.report_category, 'spam');
      assert.match(report.report_reason, /^【群聊：周末徒步群】有人发广告/);
    });

    await t.test('owner tools: mute all, set admin, ban and remove members', async () => {
      await p.click('.grp-info [data-info="manage"]');
      await p.locator('.grp-sheet [data-switch="mute_all"] + .grp-switch').click();
      await p.waitForFunction(() => /开启了全员禁言/.test(document.getElementById('groupStream').textContent));
      await p.keyboard.press('Escape');
      await p.click('.grp-info .grp-member[data-member="bob"]');
      await p.click('.grp-sheet [data-card="set_admin"]');
      await p.waitForFunction(() => /bob 被设为管理员/.test(document.getElementById('groupStream').textContent));
      await p.click('.grp-info .grp-member[data-member="carol"]');
      await p.click('.grp-sheet [data-card="ban"]');
      await p.click('.grp-sheet [data-minutes="60"]');
      await p.waitForFunction(() => /carol 被禁言1 小时/.test(document.getElementById('groupStream').textContent));
      assert.equal((await send('carol', hiking.group_id, 'x')).code, 'muted_all');
      await p.click('.grp-info [data-info="remove"]');
      await p.click('.grp-sheet .grp-member-row[data-member="dave"]');
      await p.click('#ppConfirmOkBtn');
      await p.waitForFunction(() => /将 dave 移出了群聊/.test(document.getElementById('groupStream').textContent));
      assert.equal((await H.rpc(db, 'chat_group_detail', { p_actor: 'dave', p_group: hiking.group_id })).code, 'not_member');
    });

    await t.test('create a group from the header button and join another by QR link', async () => {
      await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
      await p.click('#groupChatView [data-info="close"]').catch(() => {});
      await p.click('#groupChatView [data-grp="back"]');
      await p.waitForFunction(() => document.getElementById('groupChatView').hidden);
      await p.click('#chatGroupCreateButton');
      await p.fill('#grpCreateName', '读书会');
      await p.locator('.grp-pick-row', { hasText: 'erin' }).click();
      await p.locator('.grp-pick-row', { hasText: 'carol' }).click();
      assert.match(await p.locator('#grpPickConfirm').textContent(), /创建（2）/);
      await p.click('#grpPickConfirm');
      await p.waitForFunction(() => document.getElementById('groupChatTitle').textContent === '读书会' && !document.getElementById('groupChatView').hidden);
      await p.locator('#groupStream .grp-system').first().waitFor();
      const bobs = await H.rpc(db, 'chat_group_create', { p_actor: 'bob', p_name: 'bob 的群', p_members: ['erin'] });
      const token = (await H.rpc(db, 'chat_group_detail', { p_actor: 'bob', p_group: bobs.group_id })).group.qr_token;
      // Open the invite link the QR code encodes: the module reads it on start-up.
      await p.goto(f.origin + '/?group_join=' + token, { waitUntil: 'domcontentloaded' });
      await H.wirePage(p, api);
      await p.locator('#grpJoinBtn').waitFor({ timeout: 15000 });
      assert.match(await p.locator('.grp-join').textContent(), /bob 的群/);
      await p.click('#grpJoinBtn');
      await p.waitForFunction(() => document.getElementById('groupChatTitle').textContent === 'bob 的群' && !document.getElementById('groupChatView').hidden, null, { timeout: 15000 });
      assert.equal(new URL(await p.url()).searchParams.get('group_join'), null);
    });

    assert.deepEqual(f.errors, []);
  });
});
