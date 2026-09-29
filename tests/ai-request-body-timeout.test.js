'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/ai-agent.js'), 'utf8');

function extractFunction(startMarker, endMarker, name, context) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, name + ' source should exist');
  return vm.runInNewContext('(function(){' + source.slice(start, end) + '; return ' + name + ';})()', context);
}

function requestHarness() {
  let timer = null;
  let bodyStarted;
  const bodyReady = new Promise(resolve => { bodyStarted = resolve; });
  const context = {
    API_BASE: 'https://example.test',
    AbortController,
    console: { warn() {} },
    getUserAuthPayload: async () => ({ headers: {}, body: {}, query: {} }),
    setTimeout(callback) {
      timer = { callback, active: true };
      return timer;
    },
    clearTimeout(handle) { handle.active = false; },
    fetch: async (_url, options) => ({
      ok: true,
      status: 200,
      text() {
        bodyStarted();
        return new Promise((_resolve, reject) => {
          const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (options.signal.aborted) fail();
          else options.signal.addEventListener('abort', fail, { once: true });
        });
      }
    })
  };
  return {
    sendOnce: extractFunction('async function sendOnce(', 'async function apiRequest(', 'sendOnce', context),
    bodyReady,
    timer: () => timer
  };
}

test('AI request timeout stays active until the response body finishes', async () => {
  const harness = requestHarness();
  const pending = harness.sendOnce('GET', '/history', null, { timeoutMs: 3000 });
  await harness.bodyReady;
  assert.equal(harness.timer().active, true);
  harness.timer().callback();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'timeout');
  assert.equal(harness.timer().active, false);
});

test('external cancellation still aborts while reading an AI response body', async () => {
  const harness = requestHarness();
  const external = new AbortController();
  const pending = harness.sendOnce('GET', '/history', null, { signal: external.signal });
  await harness.bodyReady;
  external.abort();
  const result = await Promise.race([
    pending,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('response body did not cancel')), 250))
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'aborted');
});

test('history cache strips attachment data URLs without losing file metadata', () => {
  const sanitizeCacheMsgs = extractFunction(
    'function sanitizeCacheMsgs(', 'function setAiHistoryCache(', 'sanitizeCacheMsgs', {}
  );
  const imageUrl = 'data:image/png;base64,' + 'A'.repeat(20000);
  const [cached] = sanitizeCacheMsgs([{
    role: 'user',
    content: '看图',
    attachments: [{ name: 'a.png', type: 'image/png', data_url: imageUrl }]
  }]);
  assert.equal(cached.content, '看图');
  assert.equal(cached.attachments[0].name, 'a.png');
  assert.equal(cached.attachments[0].data_unavailable, true);
  assert.equal(cached.attachments[0].data_url, undefined);
  assert.ok(JSON.stringify(cached).length < 1000);
});
