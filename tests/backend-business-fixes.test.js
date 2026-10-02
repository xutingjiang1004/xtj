'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), https = require('node:https'), { EventEmitter } = require('node:events'), zlib = require('node:zlib');
const quota = require('../render-api/ai-quota');
const web = require('../render-api/web-fetch');
const { createSearchCredit } = require('../render-api/search-credit');
const { scanStorageOrphans } = require('../render-api/storage-orphan-scan');
const cleanup = require('../render-api/storage-cleanup');
const limits = { free_token_limit: 100000, pro_token_limit: 1000000, free_search_limit: 10 };

test('Chat Completions and Responses reasoning details are already included in completion', () => {
  assert.equal(quota.computeBillableTokens({ prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, completion_tokens_details: { reasoning_tokens: 80 } }), 300);
  assert.equal(quota.computeBillableTokens({ input_tokens: 100, output_tokens: 200, output_tokens_details: { reasoning_tokens: 80 } }), 300);
  assert.equal(quota.computeBillableTokens({ prompt_tokens: 10, completion_tokens: 20, reasoning_tokens: 5 }), 35);
});

test('durable search credit retries a lost commit response with the same claim and fails closed', async () => {
  const ids = [];
  const claim = createSearchCredit({ limits, adminName: 'xxz', supabase: { async rpc(name, args) {
    assert.equal(name, 'claim_ai_search_credit'); ids.push(args.p_claim_id);
    return ids.length === 1 ? { error: Error('lost response') } : { data: { allowed: true, quota: { search_remaining: 0 } } };
  } } });
  const context = { userName: 'u', searchConsumed: 0 };
  assert.equal((await claim(context)).allowed, true); assert.equal(ids[0], ids[1]); assert.equal(context.searchConsumed, 1);
  const unavailable = createSearchCredit({ limits, adminName: 'xxz', supabase: { rpc: async () => ({ error: Error('missing migration') }) } });
  assert.equal((await unavailable({ userName: 'u' })).reason, 'quota_unavailable');
});

test('a search cancelled during its claim releases that exact unused durable credit', async () => {
  const controller = new AbortController(), calls = [];
  const claim = createSearchCredit({ limits, adminName: 'xxz', supabase: { async rpc(name, args) {
    calls.push([name, args]); if (name === 'claim_ai_search_credit') { controller.abort(); return { data: { allowed: true } }; }
    return { data: { ok: true, released: true } };
  } } });
  assert.equal((await claim({ userName: 'u', signal: controller.signal })).allowed, false);
  assert.equal(calls[1][0], 'release_ai_search_credit'); assert.equal(calls[0][1].p_claim_id, calls[1][1].p_claim_id);
});

test('aborted webpage requests cannot start a Jina fallback', async () => {
  const source = fs.readFileSync(require.resolve('../render-api/web-fetch'), 'utf8');
  const start = source.indexOf('async function fetchSafeWebPage(rawUrl'), end = source.indexOf('\n/**', start);
  let fallback = 0;
  const context = { WEB_MAX_BYTES: 100, WEB_TIMEOUT_MS: 10, defaultDnsLookup() {}, fetchSafeWebPageDirect: async () => { throw Error('cancelled'); }, assertSafeWebUrl: async () => ({}), fetchViaJinaReader: async () => { fallback++; return { content: 'text' }; } };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(context.fetchSafeWebPage('https://example.com', { signal: controller.signal })); assert.equal(fallback, 0);
});

function fakeHttps(t, pages) {
  const calls = [], original = https.request;
  https.request = (options, onResponse) => {
    calls.push(options); const req = new EventEmitter(); let destroyed = false;
    req.setTimeout = () => {}; req.destroy = error => { destroyed = true; if (error) process.nextTick(() => req.emit('error', error)); };
    req.end = () => process.nextTick(() => {
      if (destroyed) return;
      const page = pages[options.hostname + options.path]; assert.ok(page, 'unexpected network target: ' + options.hostname + options.path);
      const response = new EventEmitter(); response.statusCode = page.status || 200; response.headers = page.headers || {}; onResponse(response);
      for (const chunk of page.chunks || [Buffer.from('image')]) { if (destroyed) break; response.emit('data', chunk); }
      if (!destroyed) response.emit('end');
    });
    return req;
  };
  t.after(() => { https.request = original; }); return calls;
}
const lookup = async host => [{ address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }];
test('image fetch follows only validated pinned HTTPS hops and preserves final original bytes', async t => {
  const bytes = Buffer.from([255, 216, 255, 1, 2, 3]);
  const calls = fakeHttps(t, { 'a.example/start': { status: 302, headers: { location: 'https://b.example/final', 'content-type': 'text/html' } }, 'b.example/final': { headers: { 'content-type': 'image/jpeg' }, chunks: [bytes] } });
  const result = await web.fetchSafeRedirectBuffer('https://a.example/start', { lookupImpl: lookup });
  assert.equal(result.url, 'https://b.example/final'); assert.deepEqual(result.buffer, bytes); assert.equal(calls.length, 2);
  const pinned = await new Promise(resolve => calls[1].lookup('b.example', { all: true }, (_, addresses) => resolve(addresses)));
  assert.equal(pinned[0].address, '93.184.216.34');
});

test('redirect to private domain or HTTP and private base never connects to forbidden host', async t => {
  const calls = fakeHttps(t, { 'a.example/private': { status: 302, headers: { location: 'https://private.example/' } }, 'a.example/http': { status: 302, headers: { location: 'http://b.example/' } } });
  for (const path of ['private', 'http']) await assert.rejects(web.fetchSafeRedirectBuffer('https://a.example/' + path, { lookupImpl: lookup }), { code: 'IMAGE_UPSTREAM_BLOCKED' });
  await assert.rejects(web.fetchSafeRedirectBuffer('https://private.example/', { lookupImpl: lookup }), { code: 'IMAGE_UPSTREAM_BLOCKED' });
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.hostname === 'a.example'));
});

test('image fetch aborts after DNS before connection and stops oversized chunked/decompressed data', async t => {
  const calls = fakeHttps(t, { 'a.example/large': { chunks: [Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)] }, 'a.example/gzip': { headers: { 'content-encoding': 'gzip' }, chunks: [zlib.gzipSync(Buffer.alloc(1000))] } });
  const controller = new AbortController();
  await assert.rejects(web.fetchSafeRedirectBuffer('https://a.example/abort', { signal: controller.signal, lookupImpl: async () => { controller.abort(); return lookup('a.example'); } }));
  assert.equal(calls.length, 0);
  await assert.rejects(web.fetchSafeRedirectBuffer('https://a.example/large', { lookupImpl: lookup, maxBytes: 12 }), { code: 'IMAGE_TOO_LARGE' });
  await assert.rejects(web.fetchSafeRedirectBuffer('https://a.example/gzip', { lookupImpl: lookup, maxBytes: 100 }), { code: 'IMAGE_TOO_LARGE' });
});

test('orphan scanning advances beyond 100 retained files and retries a failed object next pass', async () => {
  const name = n => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0') + '.bin';
  const files = Array.from({ length: 102 }, (_, i) => ({ name: name(i), created_at: '2020-01-01' }));
  let fail = true, deleted = [], offsets = [];
  const args = { store: { list: async (_, options) => { offsets.push(options.offset); return { data: files.slice(options.offset, options.offset + options.limit) }; } }, lookup: async path => path === name(100) || path === name(101) ? null : { id: path }, remove: async path => { if (path === name(100) && fail) throw Error('network'); deleted.push(path); files.splice(files.findIndex(f => f.name === path), 1); } };
  let offset = await scanStorageOrphans(args); assert.equal(offset, 100);
  offset = await scanStorageOrphans({ ...args, offset }); assert.equal(offset, 0); assert.deepEqual(deleted, [name(101)]);
  fail = false; offset = await scanStorageOrphans({ ...args, offset }); await scanStorageOrphans({ ...args, offset });
  assert.deepEqual(deleted, [name(101), name(100)]); assert.deepEqual(offsets, [0, 100, 0, 100]);
});

test('storage queue submits atomic path union RPC and never silently falls back on a missing migration', async () => {
  let captured;
  const db = { rpc: async (name, args) => { captured = [name, args]; return { data: { ok: true, queued: true, jobId: 'j', paths: args.p_paths } }; }, from() { throw Error('unlocked write forbidden'); } };
  const result = await cleanup.enqueueStorageCleanupJob(db, { photoId: '123e4567-e89b-42d3-a456-000000000001', paths: ['photos/a', 'photos/a', '../bad', 'photos/b'] });
  assert.equal(result.ok, true); assert.equal(captured[0], 'enqueue_storage_cleanup'); assert.deepEqual(captured[1].p_paths, ['photos/a', 'photos/b']);
  db.rpc = async () => ({ error: { code: 'PGRST202' } }); assert.equal((await cleanup.enqueueStorageCleanupJob(db, { paths: ['photos/a'] })).queued, false);
});

function cleanupWorkerFixture(interleave) {
  const source = fs.readFileSync(require.resolve('../render-api/server'), 'utf8');
  const start = source.indexOf('async function processStorageCleanupJobs()'), end = source.indexOf("app.post('/api/photo/delete'", start);
  const row = { id: 1, bucket: 'uploads', paths: ['photos/old'], attempts: 0, status: 'pending', claim_token: null }, removed = [];
  const supabase = {
    from() { let update = null, filters = []; const q = {
      select() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
      update(value) { update = value; return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; }, is(k, v) { filters.push(r => r[k] === v); return q; },
      async maybeSingle() {
        if (update.status === 'processing' && interleave === 'before-claim') row.paths.push('photos/new');
        if (!filters.every(f => f(row))) return { data: null }; Object.assign(row, update); return { data: structuredClone(row) };
      }, then(a, b) { return Promise.resolve({ data: [structuredClone(row)] }).then(a, b); }
    }; return q; },
    storage: { from() { return { async remove(paths) { removed.push(paths.slice()); if (interleave === 'after-claim') { row.status = 'pending'; row.claim_token = null; row.paths.push('photos/new'); } return { data: paths.map(name => ({ name })) }; } }; } }
  };
  const context = { supabase, _storageCleanupRunning: false, STORAGE_CLEANUP_CLAIM_TIMEOUT_MS: 60000, STORAGE_CLEANUP_LEASE_MS: 60000, STORAGE_CLEANUP_REMOVE_TIMEOUT_MS: 30000, STORAGE_CLEANUP_MAX_ATTEMPTS: 5, crypto: require('node:crypto'), withStorageCleanupTimeout: promise => promise, isNotFoundError: () => false, console: { warn() {} } };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return { row, removed, run: context.processStorageCleanupJobs };
}

test('cleanup worker removes the locked claim snapshot including paths merged after its initial SELECT', async () => {
  const f = cleanupWorkerFixture('before-claim'); await f.run();
  assert.deepEqual(JSON.parse(JSON.stringify(f.removed)), [['photos/old', 'photos/new']]); assert.equal(f.row.status, 'completed');
});

test('a path merged after claim invalidates the worker token so late completion cannot discard it', async () => {
  const f = cleanupWorkerFixture('after-claim'); await f.run();
  assert.equal(f.row.status, 'pending'); assert.deepEqual(f.row.paths, ['photos/old', 'photos/new']);
});

test('web DNS gate blocks site-local, discard-only and mapped private IPv6 while retaining public v6', async () => {
  for (const address of ['fec0::1', 'fec0:0:0:0:0:0:0:1', '100::1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe', '2001:10::1', '3fff::1']) {
    assert.equal(web.isPrivateAddress(address), true, address);
    await assert.rejects(web.assertSafeWebUrl('https://a.example/', async () => [{ address, family: 6 }]));
  }
  assert.equal(web.isPrivateAddress('2606:4700:4700::1111'), false);
  await web.assertSafeWebUrl('https://a.example/', async () => [{ address: '2606:4700:4700::1111', family: 6 }]);
});

test('image redirect rejects site-local IPv6 DNS before the second connection', async t => {
  const calls = fakeHttps(t, { 'a.example/start': { status: 302, headers: { location: 'https://b.example/final' } } });
  await assert.rejects(web.fetchSafeRedirectBuffer('https://a.example/start', { lookupImpl: async host => [{ address: host === 'b.example' ? 'fec0::1' : '93.184.216.34', family: host === 'b.example' ? 6 : 4 }] }), { code: 'IMAGE_UPSTREAM_BLOCKED' });
  assert.equal(calls.length, 1);
});
