'use strict';
// Group chat permission rules, executed against real PostgreSQL with every
// migration applied (skips without XTJ_TEST_DATABASE_URL, like the other -db tests).
const test = require('node:test'), assert = require('node:assert/strict');
const connectionString = process.env.XTJ_TEST_DATABASE_URL;

test('group chat lifecycle, roles and member limits in PostgreSQL', { skip: !connectionString, timeout: 120000 }, async t => {
  const { withBackendDatabase } = require('./helpers/backend-database-fixture');
  await withBackendDatabase(async ({ db }) => {
    const call = async (fn, ...args) => {
      const placeholders = args.map((_, i) => '$' + (i + 1)).join(',');
      return (await db.query(`SELECT public.${fn}(${placeholders}) AS r`, args)).rows[0].r;
    };
    const action = (actor, group, name, args = {}) => call('chat_group_action', actor, group, name, JSON.stringify(args));
    const send = (actor, group, body, extra = {}) => call('chat_group_send', actor, group, extra.kind || 'text', body,
      JSON.stringify(extra.meta || {}), extra.reply || null, extra.client || null);
    const users = ['owner', 'admin1', 'm1', 'm2', 'm3', 'stranger', 'blocked'];
    for (const u of users) await db.query("INSERT INTO posts(user_name,media_type,content) VALUES($1,'__auth__','{}')", [u]);
    const id = async name => (await db.query('SELECT id FROM chat_users WHERE user_name=$1', [name])).rows[0].id;
    const befriend = async (a, b) => {
      const [x, y] = [await id(a), await id(b)].sort();
      await db.query('INSERT INTO chat_friendships(user_low_id,user_high_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [x, y]);
    };
    for (const u of ['admin1', 'm1', 'm2', 'm3', 'blocked']) await befriend('owner', u);
    await befriend('m1', 'stranger');
    await db.query('INSERT INTO chat_user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [await id('blocked'), await id('owner')]);

    let group;
    await t.test('create accepts only unblocked friends and names the group', async () => {
      const r = await call('chat_group_create', 'owner', '', ['admin1', 'm1', 'm2', 'stranger', 'blocked', 'nobody']);
      assert.equal(r.ok, true);
      assert.deepEqual(r.rejected.sort(), ['blocked', 'nobody', 'stranger']);
      assert.equal(r.name, 'owner、admin1、m1、m2');
      assert.deepEqual(r.notify.sort(), ['admin1', 'm1', 'm2']);
      group = r.group_id;
      const detail = await call('chat_group_detail', 'm1', group);
      assert.equal(detail.group.member_count, 4);
      assert.equal(detail.members[0].role, 'owner');
      assert.equal((await call('chat_group_detail', 'stranger', group)).code, 'not_member');
      assert.equal((await call('chat_group_create', 'owner', 'x', ['stranger'])).code, 'friend_required');
    });

    await t.test('messages, unread counts, mentions, replies and idempotent sends', async () => {
      const first = await send('m1', group, '大家好', { client: 'client-aaaaaaaa', meta: { mentions: ['owner', '@all', 'stranger'] } });
      assert.equal(first.ok, true);
      assert.deepEqual(first.message.meta.mentions, ['owner'], '@all needs admin rights and non-members are dropped');
      const again = await send('m1', group, '大家好', { client: 'client-aaaaaaaa' });
      assert.equal(again.idempotent, true); assert.equal(again.message.id, first.message.id);
      const list = await call('chat_group_list', 'owner');
      assert.equal(list.groups[0].unread, 1); assert.equal(list.groups[0].mentioned, true);
      assert.equal(list.groups[0].last_message.text, '大家好');
      const reply = await send('owner', group, '欢迎', { reply: first.message.id });
      assert.equal(reply.message.reply_to.text, '大家好');
      await action('owner', group, 'mark_read');
      assert.equal((await call('chat_group_list', 'owner')).groups[0].unread, 0);
      assert.equal((await call('chat_group_list', 'm2')).groups[0].unread, 2);
      assert.equal((await send('stranger', group, 'hi')).code, 'not_member');
      assert.equal((await send('m1', group, '   ')).code, 'empty_content');
    });

    await t.test('pages are complete and ordered, search finds visible text', async () => {
      for (let i = 0; i < 25; i++) await send('m2', group, 'page ' + i);
      assert.equal((await call('chat_group_messages_page', 'm3', group, 10, null, null, null, null)).code, 'not_member');
      const seen = []; let cursor = null;
      for (;;) {
        const page = await call('chat_group_messages_page', 'm1', group, 10, cursor && cursor.created_at, cursor && cursor.id, null, null);
        seen.unshift(...page.messages.map(m => m.id));
        if (!page.has_more) break;
        cursor = page.messages[0];
      }
      assert.equal(new Set(seen).size, seen.length);
      assert.equal(seen.length, 1 + 2 + 25, 'system create message + 2 chats + 25 pages');
      const latest = await call('chat_group_messages_page', 'm1', group, 3, null, null, null, null);
      const newer = await call('chat_group_messages_page', 'm1', group, 50, null, null, latest.messages[0].created_at, latest.messages[0].id);
      assert.deepEqual(newer.messages.map(m => m.id), latest.messages.slice(1).map(m => m.id));
      const found = await call('chat_group_search', 'm1', group, 'PAGE 1', 50, null);
      assert.equal(found.messages.length, 11);
    });

    await t.test('roles: admins manage members, only the owner manages admins', async () => {
      assert.equal((await action('m1', group, 'rename', { name: '新群名' })).code, 'forbidden');
      assert.equal((await action('owner', group, 'set_admin', { user_name: 'admin1' })).ok, true);
      assert.equal((await action('admin1', group, 'rename', { name: '新群名' })).ok, true);
      assert.equal((await action('admin1', group, 'set_admin', { user_name: 'm1' })).code, 'forbidden');
      assert.equal((await action('admin1', group, 'announce', { announcement: '周五聚餐' })).ok, true);
      const detail = await call('chat_group_detail', 'm2', group);
      assert.equal(detail.group.name, '新群名'); assert.equal(detail.group.announcement, '周五聚餐');
      assert.equal(detail.group.announcement_by, 'admin1');
      assert.equal((await action('admin1', group, 'remove_member', { user_name: 'owner' })).code, 'forbidden');
      assert.equal((await action('admin1', group, 'ban', { user_name: 'm2', minutes: 10 })).ok, true);
      assert.equal((await send('m2', group, 'x')).code, 'banned');
      assert.equal((await action('admin1', group, 'unban', { user_name: 'm2' })).ok, true);
      assert.equal((await send('m2', group, '解禁了')).ok, true);
      assert.equal((await action('owner', group, 'set_mute_all', { enabled: true })).ok, true);
      assert.equal((await send('m1', group, 'x')).code, 'muted_all');
      assert.equal((await send('admin1', group, '管理员可以说话')).ok, true);
      const allMention = await send('admin1', group, '@所有人 注意', { meta: { mentions: ['@all'] } });
      assert.deepEqual(allMention.message.meta.mentions, ['@all']);
      await action('owner', group, 'set_mute_all', { enabled: false });
    });

    await t.test('withdraw: own message within two minutes, admins over members only', async () => {
      const mine = await send('m1', group, '撤回我');
      const w = await action('m1', group, 'withdraw', { message_id: mine.message.id });
      assert.equal(w.ok, true); assert.equal(w.message.withdrawn, true); assert.equal(w.message.body, '');
      await db.query("UPDATE chat_group_messages SET created_at=now()-interval '5 minutes' WHERE id=(SELECT id FROM chat_group_messages WHERE body='解禁了')");
      const old = (await db.query("SELECT id FROM chat_group_messages WHERE body='解禁了'")).rows[0].id;
      assert.equal((await action('m2', group, 'withdraw', { message_id: old })).code, 'withdraw_expired');
      assert.equal((await action('admin1', group, 'withdraw', { message_id: old })).ok, true);
      const adminMsg = (await db.query("SELECT id FROM chat_group_messages WHERE body='管理员可以说话'")).rows[0].id;
      assert.equal((await action('m1', group, 'withdraw', { message_id: adminMsg })).code, 'forbidden');
      assert.equal((await action('owner', group, 'withdraw', { message_id: adminMsg })).ok, true);
    });

    await t.test('personal settings: nickname, mute, pin, background, hide, clear', async () => {
      await action('m1', group, 'set_nickname', { nickname: '小一' });
      await action('m1', group, 'set_muted', { muted: true });
      await action('m1', group, 'set_pinned', { pinned: true });
      await action('m1', group, 'set_background', { background: 'mint' });
      assert.equal((await action('m1', group, 'set_background', { background: 'url(javascript:1)' })).code, 'invalid_background');
      const item = (await call('chat_group_list', 'm1')).groups[0];
      assert.equal(item.muted, true); assert.ok(item.pinned_at); assert.equal(item.background, 'mint');
      const sent = await send('m1', group, '我的昵称');
      assert.equal(sent.message.sender_display, '小一'); assert.equal(sent.message.sender, 'm1');
      await action('m2', group, 'hide_message', { message_id: sent.message.id });
      const m2page = await call('chat_group_messages_page', 'm2', group, 200, null, null, null, null);
      assert.equal(m2page.messages.some(m => m.id === sent.message.id), false);
      await action('m2', group, 'clear_history');
      assert.equal((await call('chat_group_messages_page', 'm2', group, 200, null, null, null, null)).messages.length, 0);
      assert.equal((await call('chat_group_list', 'm2')).groups[0].last_message, null);
    });

    await t.test('invites follow friendship, policy and approval', async () => {
      assert.equal((await action('m1', group, 'invite', { members: ['stranger'] })).ok, true, 'm1 is friends with stranger');
      await action('owner', group, 'remove_member', { user_name: 'stranger' });
      await action('owner', group, 'set_invite_policy', { policy: 'admins' });
      assert.equal((await action('m1', group, 'invite', { members: ['stranger'] })).code, 'forbidden');
      await action('owner', group, 'set_invite_policy', { policy: 'all' });
      await action('owner', group, 'set_join_approval', { enabled: true });
      const pending = await action('m1', group, 'invite', { members: ['stranger'] });
      assert.deepEqual(pending.pending, ['stranger']);
      const requests = await action('admin1', group, 'list_requests');
      assert.equal(requests.requests.length, 1); assert.equal(requests.requests[0].inviter, 'm1');
      assert.equal((await action('m1', group, 'approve_request', { request_id: requests.requests[0].id })).code, 'forbidden');
      assert.equal((await action('admin1', group, 'approve_request', { request_id: requests.requests[0].id })).ok, true);
      assert.equal((await call('chat_group_detail', 'stranger', group)).ok, true);
      const strangerPage = await call('chat_group_messages_page', 'stranger', group, 200, null, null, null, null);
      assert.ok(strangerPage.messages.every(m => m.kind === 'system'), 'new members do not see earlier history');
    });

    await t.test('QR token join, approval and reset', async () => {
      const token = (await call('chat_group_detail', 'owner', group)).group.qr_token;
      await db.query("INSERT INTO posts(user_name,media_type,content) VALUES('qr1','__auth__','{}'),('qr2','__auth__','{}')");
      const preview = await call('chat_group_token_preview', 'qr1', token);
      assert.equal(preview.group.name, '新群名'); assert.equal(preview.group.join_approval, true);
      const joinPending = await call('chat_group_token_join', 'qr1', token, '想进群');
      assert.equal(joinPending.pending, true); assert.ok(joinPending.notify.includes('owner'));
      await action('owner', group, 'set_join_approval', { enabled: false });
      const joined = await call('chat_group_token_join', 'qr2', token, null);
      assert.equal(joined.joined, true);
      await action('owner', group, 'reset_qr');
      assert.equal((await call('chat_group_token_preview', 'qr1', token)).code, 'invalid_token');
      const req = (await action('owner', group, 'list_requests')).requests.find(r => r.user_name === 'qr1');
      assert.equal(req.note, '想进群');
      assert.equal((await action('owner', group, 'reject_request', { request_id: req.id })).ok, true);
    });

    await t.test('member limit of 1000 is enforced', async () => {
      await db.query(`INSERT INTO posts(user_name,media_type,content) SELECT 'bulk'||i,'__auth__','{}' FROM generate_series(1,1000) i`);
      await db.query(`INSERT INTO chat_friendships(user_low_id,user_high_id)
        SELECT LEAST(o.id,u.id),GREATEST(o.id,u.id) FROM chat_users o, chat_users u WHERE o.user_name='owner' AND u.user_name LIKE 'bulk%'`);
      const names = Array.from({ length: 1000 }, (_, i) => 'bulk' + (i + 1));
      assert.equal((await call('chat_group_create', 'owner', 'big', names)).code, 'group_full');
      const big = await call('chat_group_create', 'owner', 'big', names.slice(0, 999));
      assert.equal(big.ok, true);
      assert.equal((await call('chat_group_detail', 'owner', big.group_id)).group.member_count, 1000);
      const over = await action('owner', big.group_id, 'invite', { members: ['bulk1000'] });
      assert.equal(over.code, 'group_full');
      const list = await call('chat_group_list', 'bulk5');
      assert.equal(list.groups[0].member_count, 1000);
    });

    await t.test('owner leaving hands over; dissolve stops sending; retirement leaves groups', async () => {
      const r = await action('owner', group, 'leave');
      assert.equal(r.ok, true);
      const detail = await call('chat_group_detail', 'admin1', group);
      assert.equal(detail.group.owner, 'admin1', 'the longest serving admin becomes owner');
      assert.equal(detail.me.role, 'owner');
      await action('admin1', group, 'transfer', { user_name: 'm1' });
      assert.equal((await call('chat_group_detail', 'm1', group)).me.role, 'owner');
      await db.query("DELETE FROM posts WHERE user_name='m2' AND media_type='__auth__'");
      assert.equal((await call('chat_group_detail', 'm1', group)).members.some(m => m.user_name === 'm2'), false);
      assert.equal((await action('admin1', group, 'dissolve')).code, 'forbidden');
      assert.equal((await action('m1', group, 'dissolve')).ok, true);
      assert.equal((await send('admin1', group, 'x')).code, 'dissolved');
      assert.equal((await call('chat_group_list', 'admin1')).groups.find(g => g.id === group).dissolved, true);
      assert.equal((await action('admin1', group, 'leave')).ok, true);
      assert.equal((await call('chat_group_list', 'admin1')).groups.some(g => g.id === group), false);
    });

    await t.test('browser roles cannot reach group tables or functions', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.query('SET ROLE ' + role);
        await assert.rejects(db.query('SELECT * FROM chat_group_messages'), /permission denied/);
        await assert.rejects(db.query("SELECT public.chat_group_list('owner')"), /permission denied/);
        await db.query('RESET ROLE');
      }
    });
  });
});
