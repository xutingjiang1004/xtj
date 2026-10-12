'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const history = require('../render-api/ai-history');
const { saveDeepThinkChatTurn, saveInterruptedChatTurn } = require('../render-api/ai-chat-save');
const frontend = fs.readFileSync('js/ai-agent.js', 'utf8'), server = fs.readFileSync('render-api/server.js', 'utf8');
function extract(source, start, end, name, c) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return vm.runInNewContext('(function(){' + source.slice(a,b) + ';return ' + name + ';})()', c);
}
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function researchClient(response, extra = {}) {
  const timers = [], identity = { scope: 'alice', epoch: 1 }, S = { dtConversationId: 'ORIGINAL1', dtResearchModel: 'pro' };
  const c = { S, API_BASE: 'https://isolated.test/api/agent', AbortController, TextDecoder, Promise,
    AI_CONTENT_MAX_LEN: 500000, RESEARCH_IDLE_TIMEOUT_MS: 180000, notify() {},
    customModelIdentity: () => ({ ...identity }), customModelIdentityCurrent: i => i.scope === identity.scope && i.epoch === identity.epoch,
    getUserAuthPayload: async () => ({ headers: { Authorization: 'Bearer test-only-token' } }),
    setTimeout(fn, ms) { const timer = { fn, ms, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.active = false; },
    fetch: async () => response, ...extra };
  return { run: extract(frontend, 'function runTavilyResearch(', '// Tavily 深入研究完整流程:', 'runTavilyResearch', c), c, S, identity, timers };
}
function stream(events) { return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }

test('an incomplete native research stream preserves partial output but does not report completion', async () => {
  const f = researchClient(stream([{ type: 'research_content', content: 'PARTIAL REPORT' }]));
  await assert.rejects(f.run('question'), e => e.code === 'research_incomplete' && e.partialAnswer === 'PARTIAL REPORT');
});
test('native research retains structured non-retryable service errors', async () => {
  const f = researchClient(new Response(JSON.stringify({ code: 'service_limited', retryable: false, error: '等待服务恢复' }), { status: 402 }));
  await assert.rejects(f.run('question'), e => e.code === 'service_limited' && e.retryable === false && e.status === 402);
});
test('native research captures its conversation and model before token acquisition', async () => {
  const auth = deferred(); let body;
  const f = researchClient(null, { getUserAuthPayload: () => auth.promise, fetch: async (_url, options) => { body = JSON.parse(options.body); return stream([{ type: 'research_done', answer: 'done', conversation_id: 'ORIGINAL1', saved: true }]); } });
  const pending = f.run('question'); f.S.dtConversationId = 'NEXTCONV'; f.S.dtResearchModel = 'flash';
  auth.resolve({ headers: { Authorization: 'Bearer test-only-token' } }); await pending;
  assert.equal(body.conversation_id, 'ORIGINAL1'); assert.equal(body.research_model, 'pro');
});
test('native research never starts an old private request under a replacement login', async () => {
  const auth = deferred(); let calls = 0;
  const f = researchClient(null, { getUserAuthPayload: () => auth.promise, fetch: async () => { calls++; return stream([{ type: 'research_done', answer: 'done' }]); } });
  const pending = f.run('OLD PRIVATE QUERY'); const rejected = assert.rejects(pending, e => e.code === 'identity_changed');
  f.identity.scope = 'bob'; f.identity.epoch++; auth.resolve({ headers: { Authorization: 'Bearer bob-fixture-token' } });
  await rejected; assert.equal(calls, 0);
});
test('native research starts a deadline before response headers arrive', async () => {
  const f = researchClient(null, { fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })) });
  const pending = f.run('question'); const rejected = assert.rejects(pending, e => e.tavilyTimeout === true);
  await new Promise(r => setImmediate(r));
  const timer = f.timers.find(t => t.active && t.ms === 180000); assert.ok(timer, 'waiting for headers is part of the idle timeout');
  timer.fn(); await rejected; assert.ok(f.timers.every(t => !t.active));
});
test('a successful native research terminal retains actual persistence and conversation metadata', async () => {
  const f = researchClient(stream([{ type: 'research_done', answer: 'answer', conversation_id: 'ACTUAL1', message_id: null, saved: false }]));
  const result = await f.run('question'); assert.equal(result.saved, false); assert.equal(result.conversation_id, 'ACTUAL1');
});

for (const result of [{ data: null, error: { message: 'database unavailable' } }, { data: [], error: null }]) test('failed research persistence never returns a synthetic saved message ID: ' + !!result.error, async () => {
  const q = { insert() { return q; }, select() { return Promise.resolve(result); } };
  const persist = extract(server, 'async function persistResearchRecord(', '// AI visible-text sanitizer:', 'persistResearchRecord', { supabase: { from: () => q }, AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', console: { warn() {} } });
  assert.equal(await persist('alice', 'ABCDEF', 'question', 'answer', []), null);
});

function cachedResearchRoute(rows, cache = true, persistId = 'saved-current-id', cancelFlow = false) {
  let handler, persisted = 0, persistedArgs; const queries = [];
  const db = { from() { const filters = []; let q = { select() { return q; }, eq(k,v) { filters.push(r => r[k] === v); queries.push([k,v]); return q; },
    filter(k,_op,p) { const literal = p.replace(/\\_/g, '_').replace(/%$/, ''); filters.push(r => r[k].startsWith(literal)); return q; },
    order() { return q; }, limit() { return q; }, then(resolve, reject) { return Promise.resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null }).then(resolve, reject); } }; return q; } };
  const c = { ...history, AbortController, Date, supabase: db, app: { post(...args) { handler = args.at(-1); } }, authenticateUser() {}, aiChatConcurrencyGate() {}, rateLimit() {},
    AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', tryAcquireDeepResearch: () => () => {}, enforceAiChatAccess: async () => ({ allowed: true }), measureSearchQuota: async () => ({ allowed: true }),
    validateString: s => s, genConvId: () => 'GENERATED1', researchCacheKey: () => 'fixture', researchCache: new Map(), researchCacheGet: () => cache ? { answer: 'REPORT', sources: [] } : null,
    researchCacheSet() {}, getAiConfig: async () => ({}), runSelfResearchFlow: async opts => { if (cancelFlow) opts.cancelToken.cancelled = true; return { answer: 'REPORT', sources: [] }; },
    persistResearchRecord: async (...args) => { persisted++; persistedArgs = args; return persistId; }, parseMsgMeta: row => JSON.parse(row.media_url || '{}'), resolveConvId: row => JSON.parse(row.media_url || '{}').convId,
    recordAiTurnUsage: async () => null, recordAbortedStreamUsage: async () => null, setInterval: () => 1, clearInterval() {},
    writeSse(res,e) { res.events.push(e); return true; }, console: { warn() {}, error() {} } };
  extract(server, "app.post('/api/agent/research/stream'", '// GET /api/agent/research/history', 'undefined', c);
  return { queries, get persisted() { return persisted; }, get persistedArgs() { return persistedArgs; }, async run() {
    const req = new EventEmitter(); Object.assign(req, { userName: 'alice', accountId: '11111111-1111-4111-8111-111111111111', body: { query: 'QUESTION', conversation_id: 'CURRENT1' } });
    const res = new EventEmitter(); Object.assign(res, { events: [], setHeader() {}, flushHeaders() {}, end() { res.writableEnded = true; } });
    await handler(req, res); return res.events;
  } };
}
test('cached research cannot reuse a record from a different conversation or a deleted record', async () => {
  const other = { id: 'wrong-id', user_name: 'alice', media_type: '__ai_agent_msg__', actor_key: 'ai_msg_conv_OTHER111_1', content: JSON.stringify({ type: 'tavily_research', query: 'QUESTION', answer: 'REPORT' }), media_url: JSON.stringify({ convId: 'OTHER111' }) };
  const deleted = { ...other, id: 'deleted-id', actor_key: 'ai_msg_conv_CURRENT1_1', media_url: JSON.stringify({ convId: 'CURRENT1', deleted: true }) };
  const f = cachedResearchRoute([other,deleted]); const events = await f.run();
  assert.equal(f.persisted, 1); assert.equal(events.find(e => e.type === 'research_done').message_id, 'saved-current-id');
});
test('failed native research persistence is explicit after generating a valid answer', async () => {
  const f = cachedResearchRoute([], false, null); const events = await f.run(), done = events.find(e => e.type === 'research_done');
  assert.equal(done.saved, false); assert.equal(done.message_id, null); assert.equal(done.conversation_id, 'CURRENT1');
});
test('cancelled native research persists its received partial report as interrupted history', async () => {
  const f = cachedResearchRoute([], false, 'partial-id', true); const events = await f.run();
  assert.equal(f.persisted, 1); assert.equal(f.persistedArgs[2], 'QUESTION'); assert.equal(f.persistedArgs[3], 'REPORT');
  assert.equal(f.persistedArgs[6].interrupted, true); assert.equal(events.some(e => e.type === 'research_done'), false);
});
test('research cache identities differ for two accounts that reuse the same nickname', () => {
  const key = extract(server, 'function researchCacheKey(', 'function researchCacheGet(', 'researchCacheKey', { crypto });
  assert.notEqual(key('alice', 'question', 'pro', 'hybrid', 'account-original'), key('alice', 'question', 'pro', 'hybrid', 'account-recreated'));
});

function contextFixture(rows, error = null) {
  const q = { select() { return q; }, eq() { return q; }, filter() { return q; }, order() { return q; }, limit() { return q; },
    then(resolve,reject) { return Promise.resolve({ data: error ? null : rows, error }).then(resolve,reject); } };
  const c = { ...history, supabase: { from: () => q }, AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', AI_CHAT_HISTORY_FETCH_BUFFER: 256, AI_CHAT_HISTORY_MSG_MAX_CHARS: 4000,
    parseMsgMeta: row => JSON.parse(row.media_url || '{}'), console: { log() {}, warn() {}, error() {} } };
  return extract(server, 'async function loadAiContext(', '// ★ M: 深度思考模式端点处理', 'loadAiContext', c);
}
test('model context excludes deleted history and decodes native research answers', async () => {
  const load = contextFixture([{ content: 'DELETED PRIVATE TURN', media_url: JSON.stringify({ role: 'user', deleted: true }) },
    { content: JSON.stringify({ type: 'tavily_research', answer: 'AUTHORIZED REPORT' }), media_url: JSON.stringify({ role: 'assistant' }) }]);
  const ctx = await load('alice', 'ABCDEF');
  assert.deepEqual(Array.from(ctx.history, x => x.content), ['AUTHORIZED REPORT']);
});
test('database context read failure does not silently generate a reply with missing history', async () => {
  const load = contextFixture([], { message: 'database unavailable' });
  await assert.rejects(load('alice', 'ABCDEF'));
});
test('a reopened research conversation retains parsed file context while its user bubble keeps the original question', async () => {
  const load = contextFixture([{ content: 'ORIGINAL QUESTION', media_url: JSON.stringify({ role: 'user', attachment_context: 'ORIGINAL QUESTION\nFILE CONTENT FOR FOLLOWUP' }) }]);
  const ctx = await load('alice','ABCDEF');
  assert.equal(ctx.history[0].content,'ORIGINAL QUESTION\nFILE CONTENT FOR FOLLOWUP');
});

for (const interrupted of [false,true]) test('deep research turn persistence keeps its original question, picture, request and actual save status: interrupted=' + interrupted, async () => {
  const rows = []; let error = null;
  const options = { db: { from: () => ({ insert: async value => { rows.push(value); return { error }; } }) }, userName: 'alice', convId: 'RECORD11',
    message: 'ORIGINAL QUESTION', content: 'ACTUAL ANSWER', marker: '__ai_agent_msg__', requestId: 'deep-request-1', chatMode: 'deep_think',
    visionUrls: ['data:image/png;base64,QUJD'], userExtra: { vision_urls: ['data:image/png;base64,QUJD'] },
    buildMeta: (role,conv,_usage,_reasoning,seq,_search,_elapsed,extra) => JSON.stringify({ role, convId: conv, seq, ...extra }) };
  const save = interrupted ? saveInterruptedChatTurn : saveDeepThinkChatTurn;
  assert.equal(await save(options), true);
  assert.equal(rows[0][0].content, 'ORIGINAL QUESTION'); assert.equal(rows[0][1].content, 'ACTUAL ANSWER');
  for (const row of rows[0]) { const meta = JSON.parse(row.media_url); assert.equal(meta.chat_mode, 'deep_think'); assert.equal(meta.client_request_id, 'deep-request-1'); }
  assert.equal(JSON.parse(rows[0][0].media_url).vision_urls[0], 'data:image/png;base64,QUJD');
  error = { code: '42501', message: 'write refused' }; assert.equal(await save(options), false);
});
