'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../js/core-parts/01-bootstrap.js'), 'utf8');
const boot = source.slice(0, source.indexOf('\n(function() {'));
function bootstrapFixture({ user = '', key = 'sb_publishable_fixture', sdk = true, fetch, timers = {} } = {}) {
  const clients = [], listeners = new Map();
  const window = {
    location: { origin: 'https://site.test', href: 'https://site.test/' }, currentUser: user,
    XTJ_CONFIG: { API_BASE: 'https://site.test', SUPABASE_URL: 'https://old-project.test', SUPABASE_ANON_KEY: key },
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  function installSdk() {
    window.supabase = { createClient(url, key) { const client = { url, key, removeAllChannels: async () => {} }; clients.push(client); return client; } };
  }
  if (sdk) installSdk();
  const context = { window, URL, AbortController, Promise, setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
    console: { log() {}, error() {}, warn() {} },
    document: { readyState: 'loading', addEventListener(name, callback) { listeners.set(name, callback); }, getElementById() { return null; } },
    fetch: fetch || (async () => ({ ok: true, json: async () => ({ supabase_url: 'https://new-project.test', supabase_anon_key: 'sb_publishable_new_fixture' }) })) };
  vm.createContext(context); vm.runInContext(boot, context);
  return { context, window, clients, listeners, installSdk, sync: () => context._syncRuntimeConfig() };
}
module.exports = { bootstrapFixture };
