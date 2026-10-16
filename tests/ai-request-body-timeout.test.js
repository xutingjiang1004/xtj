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

function requestHarness({ rawAbortReason = false } = {}) {
  let timer = null;
  let bodyStarted;
  const bodyReady = new Promise(resolve => { bodyStarted = resolve; });
  const context = {
    API_BASE: 'https://example.test',
    readUserName: () => 'alice', readAiAuthEpoch: () => 1,
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
          const fail = () => reject(rawAbortReason ? options.signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' }));
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

test('AI preflight never sends a private request with a replacement login', async () => {
  let owner = 'alice', epoch = 1, resolveAuth, calls = 0;
  const context = { API_BASE: 'https://example.test', AbortController, console: { warn() {} },
    readUserName: () => owner, readAiAuthEpoch: () => epoch,
    getUserAuthPayload: () => new Promise(resolve => { resolveAuth = resolve; }),
    setTimeout, clearTimeout,
    fetch: async () => { calls++; return new Response('{"ok":true}'); } };
  const send = extractFunction('async function sendOnce(', 'async function apiRequest(', 'sendOnce', context);
  const pending = send('POST', '/chat/delete', { conversation_id: 'private-alice' });
  owner = 'bob'; epoch++; resolveAuth({ headers: { Authorization: 'Bearer bob-token' }, body: {}, query: {} });
  const result = await pending;
  assert.equal(calls, 0); assert.equal(result.error_code, 'aborted');
});

test('AI business failures keep their structured service metadata', async () => {
  const context = { API_BASE: 'https://example.test', AbortController, console: { warn() {} },
    readUserName: () => 'alice', readAiAuthEpoch: () => 1,
    getUserAuthPayload: async () => ({ headers: {}, body: {}, query: {} }), setTimeout, clearTimeout,
    fetch: async () => new Response(JSON.stringify({ ok: false, partial: true, code: 'service_limited', retryable: false, error: '请等待服务恢复' }), { status: 207 }) };
  const send = extractFunction('async function sendOnce(', 'async function apiRequest(', 'sendOnce', context);
  const result = await send('POST', '/chat/delete', {});
  assert.equal(result.ok, false); assert.equal(result.code, 'service_limited'); assert.equal(result.retryable, false);
});

for (const nextUser of ['bob','alice']) test('delayed research cancellation does not use a replacement '+nextUser+' login',async()=>{
  let resolveToken,calls=0;const window={currentUser:'alice',epoch:1,ensureUserToken:()=>new Promise(resolve=>resolveToken=resolve)};
  const context={window,S:{dtConversationId:'ALPHA1'},document:{getElementById:id=>id==='panelDeepThink'?{classList:{contains:c=>c==='active'}}:null},
    customModelIdentity:()=>({scope:window.currentUser,epoch:window.epoch}),customModelIdentityCurrent:i=>i.scope===window.currentUser&&i.epoch===window.epoch,
    resetActiveRenderersByChannel(){},notify(){},API_BASE:'https://isolated.test/api/agent',fetch:async()=>{calls++;}};
  const cancel=extractFunction('function cancelDeepThink(', 'async function ensureUserAuthOrNotify(', 'cancelDeepThink',context);
  cancel();window.currentUser=nextUser;window.epoch++;resolveToken('replacement-fixture-token');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
});

test('a research cancellation keeps its original target while authentication is pending',async()=>{
  let resolveToken,body;const window={currentUser:'alice',epoch:1,ensureUserToken:()=>new Promise(resolve=>resolveToken=resolve)};
  const context={window,S:{dtConversationId:'ALPHA1'},document:{getElementById:id=>id==='panelDeepThink'?{classList:{contains:c=>c==='active'}}:null},
    customModelIdentity:()=>({scope:window.currentUser,epoch:window.epoch}),customModelIdentityCurrent:i=>i.scope===window.currentUser&&i.epoch===window.epoch,
    resetActiveRenderersByChannel(){},notify(){},API_BASE:'https://isolated.test/api/agent',fetch:async(_url,options)=>{body=JSON.parse(options.body);}};
  const cancel=extractFunction('function cancelDeepThink(', 'async function ensureUserAuthOrNotify(', 'cancelDeepThink',context);
  cancel();context.S.dtConversationId='SECOND';resolveToken('alice-fixture-token');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(body.conversation_id,'ALPHA1');
});

test('a delayed research cancellation cannot stop a replacement request in the same conversation',async()=>{
  let resolveToken,calls=0;const window={currentUser:'alice',epoch:1,ensureUserToken:()=>new Promise(resolve=>resolveToken=resolve)};
  const context={window,S:{dtConversationId:'ALPHA1',_dtSendSeq:1},document:{getElementById:id=>id==='panelDeepThink'?{classList:{contains:c=>c==='active'}}:null},
    customModelIdentity:()=>({scope:window.currentUser,epoch:window.epoch}),customModelIdentityCurrent:i=>i.scope===window.currentUser&&i.epoch===window.epoch,
    resetActiveRenderersByChannel(){},notify(){},API_BASE:'https://isolated.test/api/agent',fetch:async()=>{calls++;}};
  const cancel=extractFunction('function cancelDeepThink(', 'async function ensureUserAuthOrNotify(', 'cancelDeepThink',context);
  cancel();context.S._dtSendSeq++;resolveToken('same-account-fixture-token');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
});

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

for (const reason of ['aborted', 'timeout']) test('AI request classifies a raw '+reason+' rejection from its actual signal', async () => {
  const harness = requestHarness({ rawAbortReason: true }), external = new AbortController();
  const pending = harness.sendOnce('GET', '/history', null, { signal: external.signal });
  await harness.bodyReady;
  if (reason === 'timeout') harness.timer().callback(); else external.abort();
  const result = await pending;
  assert.equal(result.error_code, reason);
  assert.equal(harness.timer().active, false);
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
