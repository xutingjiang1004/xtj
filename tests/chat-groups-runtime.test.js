'use strict';
// Router-level checks for render-api/chat-groups.js that need no database:
// input validation, error mapping, private media handling and fan-out.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const sharp = require('sharp');
const { createChatGroupsRouter } = require('../render-api/chat-groups');

const GROUP = '11111111-2222-4333-8444-555555555555';

async function start(handlers, extra = {}) {
  const calls = [], events = [], removed = [], uploads = [], inserts = [];
  const supabase = {
    async rpc(name, args) { calls.push({ name, args }); const h = handlers[name]; return h ? { data: await h(args), error: null } : { data: null, error: { code: 'XX000' } }; },
    from() { return { insert: async rows => { inserts.push(rows); return { error: null }; } }; },
    storage: { from: bucket => ({ upload: async (path, buf, opts) => { uploads.push({ bucket, path, size: buf.length, opts }); return extra.uploadError ? { error: { message: 'down' } } : { data: { path }, error: null }; } }) }
  };
  const app = express(); app.use(express.json());
  app.use('/api/groups', createChatGroupsRouter({
    express, supabase, sharp,
    authenticateUser: (req, res, next) => { req.userName = 'alice'; next(); },
    rateLimit: () => (req, res, next) => next(),
    publishMany: (users, event, payload) => events.push({ users, event, payload }),
    signPrivate: async path => 'https://signed.example/' + path,
    removePrivate: async paths => { removed.push(...paths); },
    sendBlocked: extra.sendBlocked || (() => null)
  }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/groups';
  const call = async (path, init = {}) => { const r = await fetch(base + path, init); return { status: r.status, body: await r.json() }; };
  return { call, calls, events, removed, uploads, inserts, close: () => new Promise(r => server.close(r)) };
}
const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('input validation rejects bad ids, cursors, payloads and actions before the database', async t => {
  const s = await start({}); t.after(s.close);
  assert.equal((await s.call('/not-a-uuid')).status, 404);
  assert.equal((await s.call('/' + GROUP + '/messages?before=yesterday')).status, 400);
  assert.equal((await s.call('/' + GROUP + '/messages', json({ body: 'x'.repeat(2001) }))).body.code, 'content_too_long');
  assert.equal((await s.call('/' + GROUP + '/messages', json({ body: '   ' }))).body.code, 'empty_content');
  assert.equal((await s.call('/' + GROUP + '/messages', json({ body: 'hi', client_id: 'bad id!' }))).status, 400);
  assert.equal((await s.call('/' + GROUP + '/actions', json({ action: 'drop_table' }))).body.code, 'invalid_action');
  assert.equal((await s.call('/' + GROUP + '/actions', json({ action: 'set_background', background: 'url(x)' }))).body.code, 'invalid_background');
  assert.equal((await s.call('/' + GROUP + '/actions', json({ action: 'ban', user_name: 'bob', minutes: 0 }))).status, 400);
  assert.equal((await s.call('', json({ name: 'x', members: Array.from({ length: 1000 }, (_, i) => 'u' + i) }))).body.code, 'group_full');
  assert.equal((await s.call('/join/not-a-token')).body.code, 'invalid_token');
  assert.equal((await s.call('/' + GROUP + '/report', json({ category: 'nope' }))).body.code, 'invalid_category');
  assert.equal(s.calls.length, 0, 'nothing above reached the database');
});

test('database codes map to friendly statuses and outages to a retryable 503', async t => {
  const s = await start({
    chat_group_send: () => ({ ok: false, code: 'muted_all' }),
    chat_group_detail: () => ({ ok: false, code: 'not_member' })
  }); t.after(s.close);
  const muted = await s.call('/' + GROUP + '/messages', json({ body: 'hi' }));
  assert.equal(muted.status, 403); assert.equal(muted.body.error, '群主已开启全员禁言');
  assert.equal((await s.call('/' + GROUP)).status, 404);
  const down = await s.call('');
  assert.equal(down.status, 503); assert.equal(down.body.retryable, true);
});

test('sending fans one id-only event out to the other members and signs media', async t => {
  const s = await start({
    chat_group_send: args => ({ ok: true, notify: ['bob', 'carol'], message: { id: 'm1', kind: args.p_kind, has_media: false, media_path: null } })
  }); t.after(s.close);
  const r = await s.call('/' + GROUP + '/messages', json({ body: '@bob hi', mentions: ['bob'], client_id: 'abcdefgh1234' }));
  assert.equal(r.status, 200);
  assert.deepEqual(s.calls[0].args.p_meta, { mentions: ['bob'] });
  assert.equal(s.calls[0].args.p_client_id, 'abcdefgh1234');
  assert.deepEqual(s.events, [{ users: ['bob', 'carol'], event: 'chat-group', payload: { kind: 'message', group_id: GROUP, message_id: 'm1' } }]);
  assert.equal('media_path' in r.body.message, false);
});

test('images: membership is checked before upload, failures remove the object, paths stay private', async t => {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer();
  const denied = await start({ chat_group_can_send: () => ({ ok: false, code: 'not_member' }) }); t.after(denied.close);
  const r1 = await denied.call('/' + GROUP + '/images', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
  assert.equal(r1.body.code, 'not_member'); assert.equal(denied.uploads.length, 0);

  const rejected = await start({ chat_group_can_send: () => ({ ok: true }), chat_group_send: () => ({ ok: false, code: 'banned' }) }); t.after(rejected.close);
  const r2 = await rejected.call('/' + GROUP + '/images', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
  assert.equal(r2.body.code, 'banned');
  assert.equal(rejected.uploads.length, 1); assert.equal(rejected.uploads[0].bucket, 'dm-private');
  assert.deepEqual(rejected.removed, [rejected.uploads[0].path], 'the stored object is removed again');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const r3 = await rejected.call('/' + GROUP + '/images', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: svg });
  assert.equal(r3.body.code, 'invalid_image');

  const ok = await start({
    chat_group_can_send: () => ({ ok: true }),
    chat_group_send: args => ({ ok: true, notify: [], message: { id: 'm2', kind: 'image', has_media: true, media_path: args.p_meta.storage_path, meta: { width: args.p_meta.width } } })
  }); t.after(ok.close);
  const r4 = await ok.call('/' + GROUP + '/images?client_id=abcdefgh1234', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
  assert.equal(r4.status, 200);
  assert.match(ok.uploads[0].path, /^chat\/[a-f0-9]{12}_private_grp[a-f0-9]{32}\.png$/);
  assert.equal(r4.body.message.media_url, 'https://signed.example/' + ok.uploads[0].path);
  assert.equal(r4.body.message.media_path, undefined);
  assert.equal(r4.body.message.meta.width, 40);
});

test('withdrawing an image removes its private object; complaints go into the report queue', async t => {
  const s = await start({
    chat_group_action: () => ({ ok: true, notify: ['bob'], storage_path: 'chat/abcabcabcabc_private_grpx.png', message: { id: 'm3', withdrawn: true } }),
    chat_group_detail: () => ({ ok: true, group: { name: '读书会', owner: 'alice' }, me: {}, members: [] })
  }); t.after(s.close);
  const r = await s.call('/' + GROUP + '/actions', json({ action: 'withdraw', message_id: '11111111-2222-4333-8444-666666666666' }));
  assert.equal(r.status, 200); assert.deepEqual(s.removed, ['chat/abcabcabcabc_private_grpx.png']);
  assert.equal(r.body.storage_path, undefined);
  const report = await s.call('/' + GROUP + '/report', json({ category: 'fraud', reason: '诈骗链接' }));
  assert.equal(report.status, 200);
  const content = JSON.parse(s.inserts[0][0].content);
  assert.equal(content.target_type, 'group'); assert.equal(content.target_id, GROUP); assert.equal(content.report_reason, '【群聊：读书会】诈骗链接');
});

test('banned or blacklisted accounts cannot create, send or invite', async t => {
  const s = await start({}, { sendBlocked: () => ({ status: 403, code: 'account_banned', message: '该账号已被封禁' }) }); t.after(s.close);
  assert.equal((await s.call('', json({ members: ['bob'] }))).body.code, 'account_banned');
  assert.equal((await s.call('/' + GROUP + '/messages', json({ body: 'hi' }))).body.code, 'account_banned');
  assert.equal((await s.call('/' + GROUP + '/actions', json({ action: 'invite', members: ['bob'] }))).body.code, 'account_banned');
  assert.equal(s.calls.length, 0);
});
