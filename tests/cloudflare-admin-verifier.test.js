'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createAdminVerifier } = require('../cloudflare/admin-verifier');
const { createPreviewWorker } = require('../cloudflare/pages-worker');
const { REVOKED_TOKEN_MARKER } = require('../render-api/post-markers');
const NOW = 1800000000000;
const SECRET = 'fixture_original_signing_secret';
const URL_BASE = 'https://fixture.supabase.co';
const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.fixture';
const ENV = { API_SECRET: SECRET, SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_KEY: jwt('service_role') };
// Use the existing implementation itself to create the compatibility fixtures.
const source = fs.readFileSync(require.resolve('../render-api/server'), 'utf8');
const context = vm.createContext({ Buffer, crypto, API_SECRET: SECRET, Date: { now: () => NOW } });
vm.runInContext(source.slice(source.indexOf('function _signPayload('), source.indexOf('function signToken()')), context);
const sign = payload => context._signPayload(payload);
const TOKEN = sign({ exp: NOW + 60000, user: 'xxz' });
const id = n => '11111111-1111-4111-8111-' + String(n).padStart(12, '0');
const json = data => Response.json(data);
const request = (token = TOKEN, extra = {}) => new Request('https://preview.example/admin/verify', {
  ...extra, headers: { ...(token == null ? {} : { Authorization: 'Bearer ' + token }), ...extra.headers }
});
function fixture(fetcher = async () => json([]), options = {}) {
  const calls = [];
  const verify = createAdminVerifier(URL_BASE, REVOKED_TOKEN_MARKER, {
    crypto: crypto.webcrypto, now: () => NOW, ...options,
    fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); }
  });
  return { verify, calls };
}

test('existing signed admin tokens work with WebCrypto and only query their own revocation hash', async () => {
  const f = fixture();
  assert.deepEqual(await f.verify(request(), ENV), { status: 200, body: { ok: true } });
  const { url, init } = f.calls[0], parsed = new URL(url);
  assert.equal(parsed.origin, URL_BASE);
  assert.equal(parsed.searchParams.get('media_type'), 'eq.' + REVOKED_TOKEN_MARKER);
  assert.equal(parsed.searchParams.get('media_url'), 'eq.' + crypto.createHash('sha256').update(TOKEN).digest('hex'));
  assert.equal(url.includes(TOKEN), false);
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_KEY);
  assert.equal(init.headers.Authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_KEY);
});

test('cookie credentials preserve header precedence and requests never set or clear cookies', async () => {
  const f = fixture();
  assert.equal((await f.verify(request(null, { headers: { Cookie: 'xtj_admin_token=' + TOKEN } }), ENV)).status, 200);
  assert.equal((await f.verify(request('wrong', { headers: { Cookie: 'xtj_admin_token=' + TOKEN } }), ENV)).status, 401);
  const worker = createPreviewWorker({}, URL_BASE, f.verify);
  const response = await worker.fetch(request(null, { method: 'HEAD', headers: { Cookie: 'xtj_admin_token=' + TOKEN } }), ENV);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await worker.fetch(new Request('https://preview.example/admin/verify/', { headers: { Authorization: 'Bearer ' + TOKEN } }), ENV)).status, 200);
  assert.equal((await worker.fetch(request(TOKEN, { method: 'POST' }), ENV)).status, 503);
});

test('cryptographic infrastructure failure is retryable and cannot falsely expire a session', async () => {
  const f = fixture(() => { assert.fail('unavailable crypto reached database'); }, { crypto: { subtle: { importKey() { throw Error('unavailable'); } } } });
  const result = await f.verify(request(), ENV);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'auth_unavailable');
  assert.equal(result.body.retryable, true);
});

test('ordinary access/refresh tokens, invalid signatures, noncanonical signatures and invalid expiries never query the database', async () => {
  const f = fixture(() => { assert.fail('invalid credential caused a database query'); });
  const other = crypto.createHmac('sha256', 'other_key').update(TOKEN.split('.')[0]).digest('base64url');
  const last = TOKEN.at(-1), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const noncanonical = TOKEN.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
  for (const token of [null, '', 'not-a-token', TOKEN + '=', TOKEN.split('.')[0] + '.' + other, noncanonical,
    sign({ exp: NOW - 1, user: 'xxz' }), sign({ user: 'xxz' }), sign({ exp: '9999999999999', user: 'xxz' }),
    sign({ exp: NOW + 60000, user: 'someone' }), sign({ exp: NOW + 60000, user: 'xxz', type: 'user_access' }),
    sign({ exp: NOW + 60000, user_name: 'xxz', type: 'user_refresh' }), 'x'.repeat(8200)]) {
    assert.equal((await f.verify(request(token), ENV)).status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test('active revocations reject; expired rows are read through pagination and are never deleted', async () => {
  const revoked = fixture(async () => json([{ id: id(1), content: JSON.stringify({ expires_at: NOW + 1000 }) }]));
  assert.equal((await revoked.verify(request(), ENV)).status, 401);
  const expired = fixture(async url => new URL(url).searchParams.has('id') ? json([])
    : json([{ id: id(1), content: JSON.stringify({ expires_at: NOW - 1 }) }]));
  assert.equal((await expired.verify(request(), ENV)).status, 200);
  assert.equal(expired.calls.length, 2);
  assert.equal(new URL(expired.calls[1].url).searchParams.get('id'), 'gt.' + id(1));
  assert.ok(expired.calls.every(call => call.init.method === 'GET'));
});

test('a later revocation page, including a short server-capped page, cannot be skipped', async () => {
  const f = fixture(async url => json([{ id: id(1), content: JSON.stringify({ expires_at: new URL(url).searchParams.has('id') ? NOW + 1 : NOW - 1 }) }]));
  assert.equal((await f.verify(request(), ENV)).status, 401);
  assert.equal(f.calls.length, 2);
});

test('missing original bindings, public keys and untrusted service origins fail closed without requests', async () => {
  const f = fixture(() => { assert.fail('unsafe binding caused a request'); });
  for (const changed of [{ API_SECRET: '' }, { SUPABASE_SERVICE_KEY: '' }, { SUPABASE_URL: '' },
    { SUPABASE_SERVICE_KEY: jwt('anon') }, { SUPABASE_SERVICE_KEY: 'sb_publishable_fixture' },
    { SUPABASE_URL: 'https://unexpected.example' }, { SUPABASE_URL: URL_BASE + '?key=fixture' },
    { SUPABASE_URL: 'https://name:password@fixture.supabase.co' }]) {
    const result = await f.verify(request(), { ...ENV, ...changed });
    assert.equal(result.status, 503);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(ENV.SUPABASE_SERVICE_KEY), false);
  }
});

test('modern secret keys stay in apikey and never become a bearer JWT or response field', async () => {
  const f = fixture();
  assert.equal((await f.verify(request(), { ...ENV, SUPABASE_SERVICE_KEY: 'sb_secret_fixture' })).status, 200);
  assert.equal(f.calls[0].init.headers.apikey, 'sb_secret_fixture');
  assert.equal(f.calls[0].init.headers.Authorization, undefined);
});

test('unavailable, malformed, oversized and stalled revocation queries return retryable 503', async () => {
  for (const fetcher of [async () => { throw Error(SECRET); }, async () => json({ error: SECRET }),
    async () => new Response('denied', { status: 403 }), async () => json([{ id: id(1), content: 'invalid' }]),
    async () => json([{ id: id(1), content: JSON.stringify({ expires_at: NOW - 1, extra: 'x'.repeat(33000) }) }]),
    async () => json([{ id: id(1), content: JSON.stringify({ expires_at: NOW - 1 }) }])]) {
    const f = fixture(fetcher), result = await f.verify(request(), ENV);
    assert.equal(result.status, 503);
    assert.equal(result.body.retryable, true);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test('timeouts and cancellation cannot grant access; expiry is checked again after the database read', async () => {
  const slow = fixture(async (_, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }), { timeoutMs: 5 });
  assert.equal((await slow.verify(request(), ENV)).status, 503);
  const controller = new AbortController(); controller.abort();
  const aborted = fixture(() => { assert.fail('cancelled request reached database'); });
  assert.equal((await aborted.verify(request(TOKEN, { signal: controller.signal }), ENV)).status, 503);
  let time = NOW;
  const expired = fixture(async () => { time += 120000; return json([]); }, { now: () => time });
  assert.equal((await expired.verify(request(), ENV)).status, 401);
});
