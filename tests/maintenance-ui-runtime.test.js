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
    close() {}, showModal() {}, querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 })
  };
  Object.defineProperty(value, 'src', { get: () => attrs.src || '', set: v => { attrs.src = v; } });
  return value;
}
function imageQueueRepro() {
  let intersection;
  const timers = new Map(); let clockId = 0;
  const imgs = Array.from({ length: 5 }, () => element());
  imgs.forEach((img, i) => { img.setAttribute('data-post-src', '/api/post/test/media/' + i); img.complete = false; img.naturalWidth = 0; });
  const body = element(); body.querySelectorAll = () => imgs; body.matches = () => false; body.nodeType = 1;
  const context = { document: { body }, innerHeight: 800, location: { href: 'https://xtj.test/', origin: 'https://xtj.test' }, URL, Map, Event,
    setTimeout(fn) { const id = ++clockId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    IntersectionObserver: class { constructor(cb) { intersection = cb; } observe() {} unobserve() {} },
    MutationObserver: class { observe() {} }
  }; context.window = context;
  vm.runInNewContext(read('js/image-load-guard.js'), context);
  intersection(imgs.slice(0, 4).map(target => ({ target, isIntersecting: true })));
  assert.equal(imgs.filter(img => img.src).length, 4);
  // All four network requests remain pending while a new group scrolls into view.
  intersection(imgs.slice(0, 4).map(target => ({ target, isIntersecting: false })).concat({ target: imgs[4], isIntersecting: true }));
  assert.equal(imgs[4].src, '');
  assert.equal(timers.size, 4, 'off-screen requests keep their deadlines');
  [...timers.values()][0]();
  assert.ok(imgs[4].src, 'deadline releases a slot for the newly visible original');

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
