'use strict';
// 纯文字私信必须按 client_message_id 幂等：响应丢失后重发，不能产生第二条消息。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { dmTextActorKey } = require('../render-api/dm-media');

const source = fs.readFileSync('render-api/server.js', 'utf8');

function fixture(options = {}) {
  const rows = [];
  let insertFailure = options.insertFailure || null;
  function table() {
    const filters = {};
    const q = {
      select() { return q; },
      eq(k, v) { filters[k] = v; return q; },
      limit() { return q; },
      insert(list) {
        if (insertFailure) {
          const failure = insertFailure;
          // The transport error is thrown after the row was in fact committed.
          if (failure.commit) rows.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), views: 0, ...list[0] });
          const error = new Error('socket hang up');
          const rejected = { select() { return rejected; }, single() { return Promise.reject(error); } };
          return rejected;
        }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), views: 0, ...list[0] };
        rows.push(row);
        return { select() { return { single: async () => ({ data: row, error: null }) }; } };
      },
      maybeSingle: async () => {
        const hit = rows.find(r => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: hit || (filters.media_type === 'AUTH' ? { id: 'u' } : null), error: null };
      },
      then(resolve) { return resolve({ data: rows.filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null }); }
    };
    return q;
  }
  const published = [];
  let handler;
  const context = vm.createContext({
    require: createRequire(require.resolve('../render-api/server.js')), console, Date, Math, JSON, String, Number, Array, Object, Promise, Set,
    crypto, dmTextActorKey, dmTextSendInflight: new Set(),
    app: { post(path, ...fns) { if (path === '/api/dm/send') handler = fns[fns.length - 1]; }, get() {} },
    authenticateUser() {}, rateLimit() {},
    supabase: { from: table },
    userBanError: () => null,
    DM_MARKER: 'DM', AUTH_MARKER: 'AUTH', ADMIN_USERNAME: 'xxz', MAX_USERNAME_LEN: 50, MAX_CONTENT_LEN: 5000,
    assertCanSendDirectMessage: async () => ({ ok: true }),
    chatFeatures: { validateReply: async () => null },
    publishDmRealtime: (target, message) => published.push([target, message.id]),
    publishChatEvent() {},
    chatPush: { notify: async () => {} },
    sanitizeError: e => String(e && e.message || e),
    cleanupDmMediaAfterFailedSend: async () => ({}),
  });
  const start = source.indexOf('async function findDmMessageByActorKey');
  const end = source.indexOf('async function updateDmMediaRegistryCAS', start);
  vm.runInContext(source.slice(start, end), context);
  const routeStart = source.indexOf("app.post('/api/dm/send'");
  const routeEnd = source.indexOf('// POST /api/dm/withdraw', routeStart);
  assert.ok(start > 0 && routeStart > 0 && routeEnd > routeStart, 'could not isolate /api/dm/send');
  vm.runInContext(source.slice(routeStart, routeEnd), context);
  async function send(body, user = 'alice') {
    const closers = [];
    const res = { statusCode: 200, body: null, status(n) { this.statusCode = n; return this; },
      json(v) { this.body = v; closers.forEach(fn => fn()); return this; }, on(event, fn) { if (event === 'close') closers.push(fn); } };
    await handler({ userName: user, body, headers: {}, userRestrictions: {} }, res);
    return res;
  }
  return { rows, published, send, failInsert(value) { insertFailure = value; } };
}

test('dmTextActorKey is deterministic per sender, target and client id and rejects malformed ids', () => {
  const a = dmTextActorKey('alice', 'bob', 'temp-1730000000000-ab12');
  assert.equal(a, dmTextActorKey('alice', 'bob', 'temp-1730000000000-ab12'));
  assert.notEqual(a, dmTextActorKey('alice', 'carol', 'temp-1730000000000-ab12'));
  assert.notEqual(a, dmTextActorKey('bob', 'alice', 'temp-1730000000000-ab12'));
  assert.equal(dmTextActorKey('alice', 'bob', 'short'), '');
  assert.equal(dmTextActorKey('alice', 'bob', 'bad id with spaces!'), '');
  assert.equal(dmTextActorKey('alice', 'bob', undefined), '');
});

test('a retried text send with the same client_message_id returns the stored message instead of inserting a duplicate', async () => {
  const f = fixture();
  const body = { target_user: 'bob', content: JSON.stringify({ type: 'dm', text: 'hello', read_at: null }), client_message_id: 'temp-1730000000000-ab12' };
  const first = await f.send(body);
  assert.equal(first.statusCode, 200);
  assert.equal(f.rows.length, 1);
  const retry = await f.send(body);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.idempotent, true);
  assert.equal(retry.body.message.id, first.body.message.id);
  assert.equal(f.rows.length, 1, 'retry must not create a second message');
  assert.equal(f.published.length, 1, 'recipient is notified once');
});

test('the same text with a different client_message_id is a genuinely new message', async () => {
  const f = fixture();
  const content = JSON.stringify({ type: 'dm', text: 'same words', read_at: null });
  await f.send({ target_user: 'bob', content, client_message_id: 'temp-1730000000000-aaaa' });
  await f.send({ target_user: 'bob', content, client_message_id: 'temp-1730000000001-bbbb' });
  assert.equal(f.rows.length, 2);
});

test('a client without client_message_id keeps the previous behaviour', async () => {
  const f = fixture();
  const content = JSON.stringify({ type: 'dm', text: 'legacy', read_at: null });
  await f.send({ target_user: 'bob', content });
  await f.send({ target_user: 'bob', content });
  assert.equal(f.rows.length, 2);
});

test('a thrown insert error that actually committed is reconciled as success', async () => {
  const f = fixture({ insertFailure: { commit: true } });
  const res = await f.send({ target_user: 'bob', content: JSON.stringify({ type: 'dm', text: 'x', read_at: null }), client_message_id: 'temp-1730000000000-cccc' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.idempotent, true);
  assert.equal(f.rows.length, 1);
});
