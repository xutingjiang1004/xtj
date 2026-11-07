'use strict';
const test=require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function element(id = '') {
  const events = {}, attrs = {};
  const value = { id, events, dataset: {}, style: { setProperty() {} }, disabled: false, hidden: false, value: '', name: '', type: '', isConnected: true,
    classList: { contains: () => false, toggle() {}, remove() {}, add() {} },
    addEventListener(name, fn) { (events[name] ||= []).push(fn); },
    fire(name, event = {}) { for (const fn of events[name] || []) fn.call(value, { target: value, ...event }); },
    getAttribute: name => attrs[name] || null,
    setAttribute: (name, v) => { attrs[name] = String(v); },
    removeAttribute: name => { delete attrs[name]; },
    close() {}, showModal() {}, querySelectorAll: () => [], querySelector: () => null, closest: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 })
  };
  Object.defineProperty(value, 'src', { get: () => attrs.src || '', set: v => { attrs.src = v; } });
  return value;
}
function imageQueueRepro() {
  let intersection;
  const timers = new Map(); let clockId = 0;
  // 并发上限现为 6（见 image-load-guard.js 的 pump）：用 6 张占满槽位，第 7 张才会排队。
  const SLOTS = 6;
  const imgs = Array.from({ length: SLOTS + 1 }, () => element());
  imgs.forEach((img, i) => { img.setAttribute('data-post-src', '/api/post/test/media/' + i); img.complete = false; img.naturalWidth = 0; });
  const body = element(); body.querySelectorAll = () => imgs; body.matches = () => false; body.nodeType = 1;
  const context = { document: { body, querySelectorAll: () => [] }, innerHeight: 800, location: { href: 'https://xtj.test/', origin: 'https://xtj.test' }, URL, Map, Event,
    setTimeout(fn) { const id = ++clockId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    IntersectionObserver: class { constructor(cb) { intersection = cb; } observe() {} unobserve() {} },
    MutationObserver: class { observe() {} }
  }; context.window = context;
  vm.runInNewContext(read('js/image-load-guard.js'), context);
  const first = imgs.slice(0, SLOTS), last = imgs[SLOTS];
  intersection(first.map(target => ({ target, isIntersecting: true, boundingClientRect: { top: 0, bottom: 100 } })));
  assert.equal(imgs.filter(img => img.src).length, SLOTS);
  // All network requests remain pending while a new group scrolls into view.
  // 真实的 IntersectionObserver 条目总带 boundingClientRect；这里是「刚滚出视口、仍在 1200px 以内」的位置，
  // 请求不会被立即回收，只靠 30 秒期限放槽位。
  intersection(first.map(target => ({ target, isIntersecting: false, boundingClientRect: { top: 900, bottom: 1000 } })).concat({ target: last, isIntersecting: true, boundingClientRect: { top: 0, bottom: 100 } }));
  assert.equal(last.src, '');
  assert.equal(timers.size, SLOTS, 'off-screen requests keep their deadlines');
  [...timers.values()][0]();
  assert.ok(last.src, 'deadline releases a slot for the newly visible original');

}
async function profileOrderRepro() {
  const nodes = new Map(), winEvents = {}, requests = [];
  const byId = id => { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); };
  const signature = element(); signature.name = 'signature';
  const form = byId('profilePreferences'); form.querySelector = () => signature;
  const coverButton = byId('profileOwnCover'); coverButton.dataset.imageKind = 'cover';
  form.querySelectorAll = query => query === '[data-image-kind]' ? [coverButton] : [];
  const image = element(), label = element(), clear = element(), backgroundImage = element();
  for (const id of ['profileOwnCover', 'profileOwnBackground']) byId(id).querySelector = query => query === 'img' ? (id === 'profileOwnCover' ? image : backgroundImage) : label;
  const menu = byId('profileImageMenu'); menu.querySelector = () => clear;
  const document = { readyState: 'complete', documentElement: element(), activeElement: null, getElementById: byId, querySelectorAll: () => [] };
  const defaults = { signature: '', cover_url: 'https://xtj.test/old.jpg', background_url: '', theme: 'system' };
  let pendingPatch;
  const context = { document, location: { href: 'https://xtj.test/' }, URL, Map, MutationObserver: class { observe() {} }, CustomEvent: class {},
    currentUser: 'alice', __xtjGetAuthEpoch: () => 1, setTimeout: () => 1, clearTimeout() {},
    addEventListener(name, fn) { winEvents[name] = fn; }, dispatchEvent() {},
    xtjProtectedFetch(url, options = {}) {
      requests.push({ url, method: options.method || 'GET', body: options.body });
      if (!options.method) return Promise.resolve({ ok: true, json: async () => ({ ok: true, settings: defaults }) });
      if (!pendingPatch) { let resolve; const promise = new Promise(r => { resolve = r; }); pendingPatch = { resolve }; return promise; }
      const settings = options.method === 'POST' ? { ...defaults, cover_url: 'https://xtj.test/new.jpg' } : { ...defaults, ...JSON.parse(options.body) };
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, settings }) });
    }
  }; context.window = context;
  vm.runInNewContext(read('js/profile-settings.js'), context); await flush();
  // A slow signature save keeps a subsequently selected cover in the upload queue.
  signature.value = 'new signature'; signature.fire('blur'); await flush();
  const upload = byId('profileImageUpload'); upload.dataset = { owner: 'alice', epoch: '1', kind: 'cover' }; upload.files = [{ size: 100, type: 'image/jpeg' }]; upload.fire('change');
  // The latest user action is explicitly removing the existing cover.
  coverButton.fire('click');
  const clearButton = { dataset: { profileImageAction: 'clear' } };
  menu.fire('click', { target: { closest: () => clearButton } });
  pendingPatch.resolve({ ok: true, json: async () => ({ ok: true, settings: { ...defaults, signature: 'new signature' } }) });
  await flush();
  const writes = requests.filter(r => r.method !== 'GET');
  assert.deepEqual(writes.map(r => r.method), ['PATCH', 'PATCH']);
  assert.equal(JSON.parse(writes[1].body).cover_url, '');
  assert.equal(image.src, '');

}
test('stalled off-screen originals release their queue slot',imageQueueRepro);
test('removing a cover supersedes its queued upload',profileOrderRepro);
