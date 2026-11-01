'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('js/early-feed.js', 'utf8');
function boot({ cache, fetchImpl, user = 'alice' }) {
  const timers = [], store = new Map(), calls = { loadFeed: [] }, win = { addEventListener() {}, dispatchEvent() {}, location: { origin: 'https://xtj.test' }, currentUser: user, scrollY: 0 };
  if (cache) store.set('xtj_feed_cache_v1', JSON.stringify(cache));
  const context = { window: win, document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }), activeElement: null, head: { appendChild() {} } },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, AbortController, CustomEvent: class {}, Promise, JSON, Date, Number, String, Array, Error,
    fetch: fetchImpl, console };
  context.window.loadFeed = force => calls.loadFeed.push(force); context.window.__xtjCoreFeedReady = true;
  context.self = win; vm.runInNewContext(source, context);
  return { win, timers, store, calls };
}
const feed = tag => ({ ok: true, posts: [{ id: tag, user_name: 'bob', content: tag }], comments: [], likes: [] });
const saved = { t: Date.now() - 3600000, user: 'alice', data: feed('cached') };
const flush = () => new Promise(setImmediate);
test('a slow server shows the saved first page after a short wait, then swaps in the real one', async () => {
  let answer; const b = boot({ cache: saved, fetchImpl: () => new Promise(resolve => { answer = resolve; }) });
  const slow = b.timers.find(t => t.ms === 2500); assert.ok(slow, 'a short slow-start timer is armed when a saved page exists');
  slow.fn();
  const early = await b.win.__xtjEarlyFeedPromise;
  assert.equal(early.posts[0].id, 'cached'); assert.equal(b.win.__xtjEarlyFeed.stale, true);
  answer({ ok: true, status: 200, json: async () => feed('fresh') }); await flush(); await flush();
  assert.equal(b.win.__xtjEarlyFeed.stale, false); assert.equal(b.win.__xtjEarlyFeed.data.posts[0].id, 'fresh');
  assert.deepEqual(b.calls.loadFeed, [true], 'the core list is refreshed once the real answer arrives');
  assert.equal(JSON.parse(b.store.get('xtj_feed_cache_v1')).data.posts[0].id, 'fresh', 'the saved page is renewed');
});
test('a failed request falls back to the saved page instead of an error and retries later', async () => {
  const b = boot({ cache: saved, fetchImpl: () => Promise.reject(Object.assign(new Error('timeout'), { name: 'AbortError' })) });
  await flush(); await flush();
  const early = await b.win.__xtjEarlyFeedPromise; assert.equal(early.posts[0].id, 'cached');
  assert.ok(b.timers.some(t => t.ms === 8000), 'a retry is scheduled');
});
test('another account never sees the saved page, and without one the old error path remains', async () => {
  const b = boot({ cache: Object.assign({}, saved, { user: 'someone-else' }), fetchImpl: () => Promise.reject(new Error('down')) });
  await flush(); await flush();
  assert.equal(b.timers.find(t => t.ms === 2500) && true, true);
  await assert.rejects(b.win.__xtjEarlyFeedPromise, /down/);
  assert.notEqual(b.win.__xtjEarlyFeed.status, 'ok');
});
test('a successful load stores the page for next time', async () => {
  const b = boot({ fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => feed('first') }) });
  await b.win.__xtjEarlyFeedPromise;
  assert.equal(JSON.parse(b.store.get('xtj_feed_cache_v1')).data.posts[0].id, 'first');
});
