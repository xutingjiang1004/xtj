'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  const handlers = {}, saved = new Map(), network = [];
  const cache = { keys: async () => Array.from(saved.keys()).map(url => ({ url })), match: async key => saved.get(key.url || key), put: async (key, value) => { saved.set(key.url, value); }, delete: async key => saved.delete(key.url || key) };
  const context = { self: { location: { origin: 'https://xtj.test' }, addEventListener: (type, fn) => { handlers[type] = fn; } }, importScripts() {}, Request, Response, Headers, Blob, URL, AbortController, Date, Promise, Number, String, Set, Map, Array, Object,
    XtjMediaDigest: {}, setTimeout, clearTimeout, caches: { open: async () => cache, delete: async () => { saved.clear(); return true; } },
    fetch: (input, init) => { const url = typeof input === 'string' ? input : input.url; network.push({ url, mode: init && init.mode });
      return Promise.resolve(new Response('image-bytes', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '11' } })); } };
  vm.runInNewContext(fs.readFileSync('media-originals-sw.js', 'utf8'), context);
  async function load(url, extra = {}) {
    const request = new Request(url);
    Object.defineProperty(request, 'destination', { value: 'destination' in extra ? extra.destination : 'image' });
    let answer = null, work = Promise.resolve();
    handlers.fetch({ request, respondWith: p => { answer = p; }, waitUntil: p => { work = p; } });
    const response = answer ? await answer : null; await work; return response;
  }
  return { load, network, saved, handlers };
}
const base = 'https://example-project.supabase.co/storage/v1/object/sign/dm-private/chat/a_photo.jpg';
test('the same private picture is downloaded once even though every signed link carries a new token', async () => {
  const f = fixture();
  const first = await f.load(base + '?token=AAA');
  assert.equal(await first.text(), 'image-bytes'); assert.equal(f.network.length, 1);
  assert.equal(f.network[0].mode, 'cors', 'a readable response is needed to keep a device copy');
  const second = await f.load(base + '?token=BBB');
  assert.equal(await second.text(), 'image-bytes'); assert.equal(f.network.length, 1, 'a new token must be served from the device copy');
  assert.equal(f.saved.size, 1);
});
test('only signed image requests are touched', async () => {
  const f = fixture();
  assert.equal(await f.load(base + '?token=AAA', { destination: '' }), null, 'script fetches keep their own handling');
  assert.equal(await f.load('https://example-project.supabase.co/storage/v1/object/public/uploads/a.jpg'), null, 'public links already use the browser cache');
  assert.equal(await f.load('https://other.example.com/storage/v1/object/sign/x/y.jpg?token=1'), null, 'other hosts are not cached');
  assert.equal(f.network.length, 0);
});
test('logout clears the device copy together with the original-media cache', async () => {
  const f = fixture(); await f.load(base + '?token=AAA'); assert.equal(f.saved.size, 1);
  let work; f.handlers.message({ source: { url: 'https://xtj.test/' }, data: { type: 'XTJ_CLEAR_ORIGINAL_MEDIA' }, ports: [{ postMessage() {} }], waitUntil: p => { work = p; } });
  await work; assert.equal(f.saved.size, 0);
});
