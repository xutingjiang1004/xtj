'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('js/core-utils.js', 'utf8');

function fixture({ supported = true, reduced = false, preference = null, blockedStorage = false } = {}) {
  let now = 0, fails = false, accepted = true;
  const calls = [], storage = new Map(preference ? [['xtj_haptics', preference]] : []);
  const window = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  document.documentElement = { getAttribute: () => null };
  window.matchMedia = () => ({ matches: reduced });
  const navigator = { userActivation: { hasBeenActive: false } };
  if (supported) navigator.vibrate = value => {
    if (fails) throw new Error('Browser denied vibration');
    calls.push(Array.isArray(value) ? Array.from(value) : value);
    return accepted;
  };
  const context = vm.createContext({ window, document, navigator, Event,
    performance: { now: () => now },
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage unavailable'); return storage.get(key) || null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage unavailable'); storage.set(key, value); }
    }
  });
  vm.runInContext(source, context);
  return { window, document, navigator, calls, storage, api: window.XTJHaptics,
    tick(ms = 100) { now += ms; }, activate() { navigator.userActivation.hasBeenActive = true; },
    fail(value) { fails = value; }, accept(value) { accepted = value; }
  };
}

test('optional vibration requires browser support and a real user activation', () => {
  const unsupported = fixture({ supported: false });
  assert.equal(unsupported.api.supported(), false);
  unsupported.activate(); unsupported.api.setEnabled(true);
  assert.equal(unsupported.api.enabled(), false);
  assert.equal(unsupported.api.play('success'), false);
  const f = fixture();
  assert.equal(f.api.play('selection'), false);
  f.activate(); assert.equal(f.api.play('selection'), true);
  assert.deepEqual(f.calls, [6]);
});

test('rapid feedback is bounded, never queued and ignores unrecognized patterns', () => {
  const f = fixture(); f.activate();
  assert.equal(f.api.play('impact'), true);
  for (let i = 0; i < 50; i++) assert.equal(f.api.play('selection'), false);
  assert.deepEqual(f.calls, [10]);
  f.tick(); assert.equal(f.api.play('success'), true);
  assert.deepEqual(f.calls, [10, [12, 35, 16]]);
  f.tick(); assert.equal(f.api.play('arbitrary-long-pattern'), false);
  assert.equal(f.calls.length, 2);
});

test('settings persist locally, respect reduced motion by default and can explicitly opt in', () => {
  const f = fixture({ reduced: true }); f.activate();
  assert.equal(f.api.enabled(), false); assert.equal(f.api.play('selection'), false);
  f.api.setEnabled(true); assert.equal(f.api.play('impact'), true);
  assert.equal(f.storage.get('xtj_haptics'), 'on');
  f.api.setEnabled(false); assert.equal(f.api.play('success'), false);
  assert.equal(f.storage.get('xtj_haptics'), 'off');
  assert.deepEqual(f.calls, [10, 0]);
  const reload = fixture({ preference: 'off' }); reload.activate();
  assert.equal(reload.api.play('success'), false);
  const blocked = fixture({ blockedStorage: true }); blocked.activate();
  blocked.api.setEnabled(false); blocked.tick();
  assert.equal(blocked.api.play('selection'), false);
});

test('hidden pages and page restoration never replay a completed operation', () => {
  const f = fixture(); f.activate(); f.api.play('success');
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.calls, [[12, 35, 16], 0]);
  f.tick(); assert.equal(f.api.play('success'), false);
  f.window.dispatchEvent(new Event('pagehide')); f.document.hidden = false;
  assert.equal(f.api.play('impact'), false);
  f.window.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(f.calls, [[12, 35, 16], 0]);
  assert.equal(f.api.play('selection'), true);
});

test('system rejection, exceptions and cross-tab opt-out cannot break a button handler', () => {
  const f = fixture(); f.activate(); f.accept(false);
  assert.equal(f.api.play('success'), false);
  f.fail(true); assert.doesNotThrow(() => f.api.play('impact'));
  f.fail(false); f.accept(true); f.tick(); f.api.play('impact');
  const event = new Event('storage'); Object.assign(event, { key: 'xtj_haptics', newValue: 'off' });
  f.window.dispatchEvent(event); f.tick();
  assert.equal(f.api.play('success'), false);
  assert.deepEqual(f.calls, [[12, 35, 16], 10, 0]);
});
