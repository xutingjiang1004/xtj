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
test('an empty composer reset during account initialization does not depend on the media helper finishing loading', () => {
  const source = fs.readFileSync('js/post-composer-media.js', 'utf8'), a = source.indexOf('function render()'), b = source.indexOf('function clear()', a);
  const nodes = { postMediaPreview: { style: {}, classList: { toggle() {} } }, postMediaPreviewGrid: { replaceChildren() {}, style: { setProperty() {} } }, postMediaPreviewCount: {} };
  const render = vm.runInNewContext('(' + source.slice(a, b).trim() + ')', {
    document: { getElementById: id => nodes[id] }, window: {}, entries: [], finishDrag() {}
  });
  assert.doesNotThrow(() => render()); assert.equal(nodes.postMediaPreview.style.display, 'none');
  assert.equal(nodes.postMediaPreviewCount.textContent, '已选择 0 个文件');
});
function researchClient(response, extra = {}) {
  const timers = [], identity = { scope: 'alice', epoch: 1 }, S = { dtConversationId: 'ORIGINAL1', dtResearchModel: 'pro' };
  const c = { S, API_BASE: 'https://isolated.test/api/agent', AbortController, TextDecoder, Promise,
    AI_CONTENT_MAX_LEN: 500000, RESEARCH_IDLE_TIMEOUT_MS: 180000, notify() {},
    customModelIdentity: () => ({ ...identity }), customModelIdentityCurrent: i => i.scope === identity.scope && i.epoch === identity.epoch,
    getUserAuthPayload: async () => ({ headers: { Authorization: 'Bearer test-only-token' } }),
    setTimeout(fn, ms) { const timer = { fn, ms, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.active = false; },
    aiFeatureFetch: async () => response, fetch: async () => response, ...extra };
  c.aiFeatureFetch=(...args)=>c.fetch(...args);
  return { run: extract(frontend, 'function runTavilyResearch(', '// Tavily 深入研究完整流程:', 'runTavilyResearch', c), c, S, identity, timers };
}
function stream(events) { return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }

test('an incomplete native research stream preserves partial output but does not report completion', async () => {
  const f = researchClient(stream([{ type: 'research_content', content: 'PARTIAL REPORT' }]));
  await assert.rejects(f.run('question'), e => e.code === 'research_incomplete' && e.partialAnswer === 'PARTIAL REPORT');
});
test('a valid long research terminal event fits the answer and source metadata together without dropping completion',async()=>{
 const answer='实际长报告。'.repeat(80000),sources=Array.from({length:40},(_,i)=>({url:'https://source.test/'+i,title:'来源'+i,snippet:'真实资料摘要'.repeat(220)}));
 const f=researchClient(stream([{type:'research_done',answer,sources,conversation_id:'ORIGINAL1',saved:true}]));const result=await f.run('question');assert.equal(result.answer,answer);assert.equal(result.sources.length,40);
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

function cachedResearchRoute(rows, cache = true, persistId = 'saved-current-id', cancelFlow = false, attachments = [], researchModel) {
  let handler, persisted = 0, persistedArgs; const queries = [];
  const db = { from() { const filters = []; let q = { select() { return q; }, eq(k,v) { filters.push(r => r[k] === v); queries.push([k,v]); return q; },
    filter(k,_op,p) { const literal = p.replace(/\\_/g, '_').replace(/%$/, ''); filters.push(r => r[k].startsWith(literal)); return q; },
    order() { return q; }, limit() { return q; }, then(resolve, reject) { return Promise.resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null }).then(resolve, reject); } }; return q; } };
  const c = { ...history, openRouter:require('../render-api/openrouter'),ADMIN_USERNAME:'alice', AbortController, Date, require: name => require('../render-api/' + name.slice(2)), parseDocumentBuffer: async () => ({}), ocrImageBuffer: async () => ({}), sharp: {}, supabase: db, app: { post(...args) { handler = args.at(-1); } }, express:{json:()=>null},fetchSafeWebPage:async()=>null, authenticateUser() {}, aiChatConcurrencyGate() {}, aiRequestMiddleware() {}, resolveAiModelReference() {}, rateLimit() {},
    AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', tryAcquireDeepResearch: () => () => {}, enforceAiChatAccess: async () => ({ allowed: true }), measureSearchQuota: async () => ({ allowed: true }),
    validateString: s => s, genConvId: () => 'GENERATED1', researchCacheKey: () => 'fixture', researchCache: new Map(), researchCacheGet: () => cache ? { answer: 'REPORT', sources: [] } : null,
    researchCacheSet() {}, getAiConfig: async () => ({}), runSelfResearchFlow: async opts => { if (cancelFlow) opts.cancelToken.cancelled = true; return { answer: 'REPORT', sources: [] }; },
    persistResearchRecord: async (...args) => { persisted++; persistedArgs = args; return persistId; }, parseMsgMeta: row => JSON.parse(row.media_url || '{}'), resolveConvId: row => JSON.parse(row.media_url || '{}').convId,
    recordAiTurnUsage: async () => null, recordAbortedStreamUsage: async () => null, setInterval: () => 1, clearInterval() {},
    endSse:require('../render-api/sse-write').endSse,writeSse(res,e) { res.events.push(e); return true; }, console: { warn() {}, error() {} } };
  extract(server, "app.post('/api/agent/research/stream'", '// GET /api/agent/research/history', 'undefined', c);
  return { queries, get persisted() { return persisted; }, get persistedArgs() { return persistedArgs; }, async run() {
    const req = new EventEmitter(); Object.assign(req, { userName: 'alice', accountId: '11111111-1111-4111-8111-111111111111', body: { query: 'QUESTION', conversation_id: 'CURRENT1', attachments,research_model:researchModel } });
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
test('a cached file report retains actual prepared text for later questions and reports no new model requests', async () => {
  const original='这份实际附件用于后续对照，预算为十万元。';
  const f=cachedResearchRoute([],true,'saved-file-report',false,[{name:'对照资料.txt',dataUrl:'data:text/plain;base64,'+Buffer.from(original).toString('base64')}]);
  const events=await f.run(),done=events.find(e=>e.type==='research_done');
  assert.ok(done,JSON.stringify(events));assert.equal(done.documents[0].name,'对照资料.txt');
  assert.equal(f.persistedArgs[6].prepared_documents[0].paragraphs[0].text,original);
  assert.equal(done.board.usage.actual_tokens,0);assert.equal(done.board.usage.returned_requests,0);
  assert.equal(done.board.search_calls,0);assert.equal(done.board.save.report,'saved');
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

test('the fallback research agent uses its selected model and flushes all genuine reasoning before completion', async () => {
  const events = [], calls = [];
  const agent = extract(server,'async function runDeepThinkAgent(', 'async function runDeepThinkWorker(', 'runDeepThinkAgent', {
    AbortController, setTimeout, clearTimeout, DEEP_THINK_CONFIG:{MAX_DURATION_MS:10000}, DEEPSEEK_MODEL_REASONER:'deepseek-v4-pro',
    getPreferredDeepSeekModel:m=>m, normalizeDeepSeekUsageModel:m=>m, buildHistoryContext:()=>'',buildAiCorePrompt:()=> 'safe prompt',
    console:{log(){},warn(){},error(){}}, endSse:require('../render-api/sse-write').endSse,writeSse:(_res,event)=>events.push(event),
    callDeepSeek:async(_messages,options)=>{calls.push(options);options.onThinkingChunk('FIRST REAL THOUGHT');options.onThinkingChunk('LAST REAL THOUGHT');return{content:'answer',model:options.model};}
  });
  const result=await agent({res:{},userName:'alice',message:'question',convId:'MODELS1',config:{},ctx:{},disableSearch:true,model:'deepseek-flash'});
  assert.equal(calls[0].model,'deepseek-flash');assert.equal(result.model,'deepseek-flash');
  assert.match(events.filter(e=>e.type==='thinking_chunk').map(e=>e.chunk).join(''),/LAST REAL THOUGHT/);
});

for (const [thinkingMode, model, expectedModel, cached = false] of [['low', 'deepseek-flash', 'deepseek-flash'], ['max', 'deepseek-v4-pro', 'deepseek-v4-pro'], ['low', 'unsupported-model', 'deepseek-v4-pro'], ['low', 'deepseek-flash', 'deepseek-v4-pro', true]]) {
  test('the real builtin research handler validates and forwards its selected model: ' + thinkingMode + '/' + model + '/cached=' + cached, async () => {
    const calls = [], events = [], rows = [], jobs = new Map();
    const req = new EventEmitter(); req.userName = 'alice'; req.body = { message: 'QUESTION', conversation_id: 'BUILTIN1',
      client_request_id: 'builtin-original-request', model, thinking_mode: thinkingMode, chat_mode: 'deep_think', attachments: [{ name: 'original.txt' }] };
    if (cached) delete req.body.attachments;
    const res = new EventEmitter(); Object.assign(res, { writableEnded: false, setHeader() {}, flushHeaders() {}, end() { this.writableEnded = true; } });
    const runFlow = async opts => { calls.push(opts); return { finalContent: 'REAL BUILTIN ANSWER', model: opts.model, planner: { agent_count: 1 }, sources: [], thinking_log: [] }; };
    const handler = extract(server, 'async function handleDeepThinkChat(', '// POST /api/agent/chat/cancel', 'handleDeepThinkChat', {
      setInterval, clearInterval, AI_CHAT_MESSAGE_MAX_LEN: 50000, validateString: value => value, genConvId: () => 'GENERATED1',
      tryAcquireDeepResearch: () => () => {}, activeDeepThinkJobs: jobs, trackActiveDeepThinkJob: (id, token) => jobs.set(id, token),
      enforceAiChatAccess: async () => ({ allowed: true }), endSse:require('../render-api/sse-write').endSse,writeSse: (_res, event) => events.push(event),
      extractVisionImageUrls: () => [], extractChatAttachments: async text => ({ text: text + (cached ? '' : '\nORIGINAL DOCUMENT') }), unwrapAttachmentExtract: value => value,
      getAiConfig: async () => ({}), loadAiContext: async () => ({ history: [] }), canUseAiCache: () => cached,
      buildAiCacheKey: () => 'account-and-model-scoped-key', aiResponseCache: new Map([['account-and-model-scoped-key', {
        content: 'REAL CACHED ANSWER', model: expectedModel, usage: { total_tokens: 100 }, expiresAt: Date.now() + 100000 }]]),
      normalizeDeepSeekModelName: value => value, normalizeDeepSeekUsageModel: value => value,
      DEEPSEEK_MODEL_FLASH: 'deepseek-flash', DEEPSEEK_MODEL_PRO: 'deepseek-v4-pro', DEEPSEEK_MODEL_REASONER: 'deepseek-v4-pro',
      runDeepThinkAgent: runFlow, runMultiAgentFlow: runFlow, sanitizeAssistantVisibleText: value => value,
      saveDeepThinkChatTurn, AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', recordAiTurnUsage: async () => ({}),
      supabase: { from: () => ({ insert: async value => { rows.push(value); return { error: null }; } }) },
      buildMsgMeta: (role, convId, usage, _reasoning, seq, _search, _elapsed, extra) => JSON.stringify({ role, convId, usage, seq, ...extra }),
      console: { log() {}, warn() {}, error() {} }
    });
    await handler(req, res);
    assert.equal(calls.length, cached ? 0 : 1, JSON.stringify(events));
    if (!cached) { assert.equal(calls[0].model, expectedModel); assert.equal(calls[0].thinking_mode, thinkingMode); assert.equal(calls[0].message, 'QUESTION\nORIGINAL DOCUMENT'); }
    assert.equal(events.find(e => e.type === 'done').saved, true); assert.equal(events.find(e => e.type === 'done').model, expectedModel);
    assert.equal(JSON.parse(rows[0][1].media_url).usage.model, expectedModel); assert.equal(jobs.size, 0);
  });
}

test('multi-agent research forwards the same selected model to its planner, all workers and synthesizer', async () => {
  const calls = [], workers = [];
  const run = extract(server, 'async function runMultiAgentFlow(', '// ===================== R:', 'runMultiAgentFlow', {
    deepSeekPricing:require('../render-api/deepseek-pricing'),AbortController, setTimeout, clearTimeout, DEEPSEEK_MODEL_REASONER: 'deepseek-v4-pro',
    DEEP_THINK_CONFIG: { MAX_DURATION_MS: 10000, MAX_WORKERS: 3, MIN_WORKERS: 1, WORKER_MAX_TOOL_ROUNDS: 1, FORCE_SPLIT_MIN_LENGTH: 24, PLANNER_TIMEOUT_MS: 1000, SYNTHESIZER_TIMEOUT_MS: 1000 },
    DEEP_THINK_PLANNER_PROMPT: '{maxWorkers}', DEEP_THINK_SYNTHESIZER_PROMPT: 'synthesize',
    getPreferredDeepSeekModel: value => value, normalizeDeepSeekUsageModel: value => value, buildHistoryContext: () => '', buildAiCorePrompt: () => 'safe prompt',
    writeSse() {}, cleanSearchResults: value => value, console: { log() {}, warn() {}, error() {} },
    runDeepThinkWorker: async opts => { workers.push(opts); return { content: 'REAL WORKER ANSWER', sources: [] }; },
    callDeepSeek: async (_messages, options) => { calls.push(options); return { model: options.model, content: calls.length === 1
      ? JSON.stringify({ agents: [{ role: 'Researcher', task_description: 'analyze', need_search: false }] }) : 'REAL SYNTH ANSWER' }; }
  });
  const result = await run({ res: {}, userName: 'alice', message: 'question', convId: 'MULTI123', config: {}, ctx: {}, model: 'deepseek-flash' });
  assert.equal(calls.length, 2); assert.equal(workers.length, 1); assert.ok([...calls, ...workers].every(c => c.model === 'deepseek-flash'));
  assert.equal(result.finalContent, 'REAL SYNTH ANSWER'); assert.equal(result.model, 'deepseek-flash');
});

function customResearchRoute({ saveError = null, incomplete = false, cancelled = false, thinkingMode, agentCount = 1, webSearch } = {}) {
  const events = [], calls = [], rows = [];
  let handler, upstreamAborts = 0;
  const req = new EventEmitter();
  req.userName = 'alice';
  req.body = { provider: 'custom', api_key: 'test-only-key', model: 'selected-custom-model', base_url: 'https://provider.test/v1',
    message: 'ORIGINAL QUESTION', conversation_id: 'CUSTOM123', client_request_id: 'original-request',
    thinking_mode: thinkingMode, web_search: webSearch,
    attachments: [{ name: 'original.txt', type: 'text/plain', data_url: 'data:text/plain;base64,' + Buffer.from('ORIGINAL DOCUMENT').toString('base64') }] };
  const res = new EventEmitter();
  Object.assign(res, { writableEnded: false, setHeader() {}, flushHeaders() {}, end() { this.writableEnded = true; } });
  const c = { app: { post(_path, ...handlers) { handler = handlers.at(-1); } }, authenticateUser() {}, aiChatConcurrencyGate() {}, aiRequestMiddleware() {}, resolveAiModelReference() {},
    // ★ 2026-10-27 限时公开：路由片段内引用了 OpenRouter 公开期鉴权中间件，vm 上下文必须提供。
    guestOpenRouterAuth: require('../render-api/openrouter').createGuestOpenRouterAuth({ authenticateUser() {}, now: () => Date.now() }),
    rateLimit() {}, AI_CHAT_HOURLY_IP_LIMIT: 10, AI_CHAT_MESSAGE_MAX_LEN: 50000, ADMIN_USERNAME: 'admin',
    express: { json() {} }, AbortController, URL, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
    validateString: value => value, genConvId: () => 'GENERATED1', extractVisionImageUrls: () => [],
    assertSafeWebUrl: async url => ({ parsed: new URL(url), addresses: [{ address: '203.0.113.20', family: 4 }] }),
    enforceAiChatAccess: async () => ({ allowed: true }), recordAiTurnUsage: async () => {},
    getAiQuotaErrorMessage: () => 'quota', AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__',
    extractChatAttachments: async (message, attachments) => ({ text: message + '\n' + Buffer.from(attachments[0].data_url.split(',')[1], 'base64').toString() }),
    unwrapAttachmentExtract: value => value, saveDeepThinkChatTurn, saveInterruptedChatTurn,
    supabase: { from: () => ({ insert: async value => { rows.push(value); return { error: saveError }; } }) },
    buildMsgMeta: (role, convId, usage, _reasoning, seq, _search, _elapsed, extra) => JSON.stringify({ role, convId, usage, seq, ...extra }),
    console: { log() {}, warn() {}, error() {} },
    endSse:require('../render-api/sse-write').endSse,writeSse: (_res, event) => { events.push(event); if (cancelled && event.type === 'content') req.emit('aborted'); },
    requestPinnedStream: async (_url, _addresses, options) => {
      const payload = JSON.parse(options.body); calls.push(payload);
      if (!payload.stream) return new Response(JSON.stringify({ choices: [{ message: { content: calls.length === 1
        ? JSON.stringify({ agents: Array.from({ length: agentCount }, (_, i) => ({ role: 'Researcher ' + i, task_description: 'Read document', need_search: webSearch === false, search_queries: ['fixture query'] })) }) : 'REAL WORKER RESULT' } }] }));
      options.signal.addEventListener('abort', () => upstreamAborts++, { once: true });
      const chunks = [{ choices: [{ delta: { reasoning_content: 'ACTUAL MODEL THOUGHT', content: 'REAL CUSTOM REPORT' } }] }];
      return new Response(chunks.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + (incomplete || cancelled ? '' : 'data: [DONE]\n\n'));
    } };
  const a = server.indexOf("app.post('/api/agent/custom-chat/deep-stream'"), b = server.indexOf('// ── 自定义第三方 AI 模型', a);
  assert.ok(a >= 0 && b > a); vm.runInNewContext(server.slice(a, b), c);
  return { events, calls, rows, get upstreamAborts() { return upstreamAborts; }, run: () => handler(req, res) };
}

test('the real third-party research route uses original files and saves the selected model, genuine thoughts and request identity', async () => {
  const f = customResearchRoute(); await f.run();
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(c => c.model === 'selected-custom-model' && JSON.stringify(c.messages).includes('ORIGINAL DOCUMENT')));
  const done = f.events.find(e => e.type === 'done'); assert.equal(done.saved, true); assert.equal(done.conversation_id, 'CUSTOM123');
  assert.equal(f.events.filter(e => e.type === 'content').map(e => e.text).join(''), 'REAL CUSTOM REPORT', 'the completed answer is not streamed twice');
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0][0].content, 'ORIGINAL QUESTION');
  const meta = JSON.parse(f.rows[0][1].media_url);
  assert.equal(meta.chat_mode, 'deep_think'); assert.equal(meta.client_request_id, 'original-request'); assert.equal(meta.usage.model, 'selected-custom-model');
  assert.equal(meta.thinking_log.find(t => t.agent_role === '模型思考').chunk, 'ACTUAL MODEL THOUGHT');
  assert.ok(meta.thinking_log.some(t => t.agent_role === '研究流程'));
  assert.match(JSON.parse(f.rows[0][0].media_url).attachment_context, /ORIGINAL DOCUMENT/);
});
test('a third-party research save failure remains explicit without duplicating the completed turn', async () => {
  const f = customResearchRoute({ saveError: { message: 'write refused' } }); await f.run();
  assert.equal(f.events.find(e => e.type === 'done').saved, false); assert.equal(f.rows.length, 1);
});
test('third-party quick research honors its intensity, limits its workers and does not execute disabled searches', async () => {
  const f = customResearchRoute({ thinkingMode: 'low', agentCount: 3, webSearch: false }); await f.run();
  const done = f.events.find(e => e.type === 'done'); assert.equal(done.thinking_mode, 'low'); assert.equal(done.agent_count, 1);
  assert.equal(f.calls.length, 3); assert.ok(f.calls.every(c => c.max_tokens <= 2048));
  assert.equal(f.events.some(e => e.type === 'tool_calls'), false);
  assert.equal(JSON.parse(f.rows[0][1].media_url).usage.thinking_mode, 'low');
});
for (const cancelled of [false, true]) test('third-party research retains its partial answer without reporting completion: cancelled=' + cancelled, async () => {
  const f = customResearchRoute({ cancelled, incomplete: !cancelled }); await f.run();
  assert.equal(f.events.some(e => e.type === 'done'), false); assert.equal(f.rows[0][1].content, 'REAL CUSTOM REPORT');
  const meta = JSON.parse(f.rows[0][1].media_url); assert.equal(meta.interrupted, true); assert.equal(meta.chat_mode, 'deep_think');
  assert.equal(meta.finish_reason, cancelled ? 'cancelled' : 'failed'); assert.equal(meta.client_request_id, 'original-request');
  if (cancelled) assert.equal(f.upstreamAborts, 1); else assert.ok(f.events.some(e => e.type === 'error'));
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

test('native free research saves and returns its exact model in history without credentials',async t=>{
 const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='isolated-native-research-key';t.after(()=>{if(old===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=old;});
 const f=cachedResearchRoute([],false,'saved-free-report',false,[],'custom:or_minimax_m31_free');const events=await f.run();
 assert.equal(f.persistedArgs[6].model,'minimax/minimax-m3.1-flash:free');assert.equal(events.find(e=>e.type==='research_done').model,'minimax/minimax-m3.1-flash:free');assert.doesNotMatch(JSON.stringify(f.persistedArgs),/isolated-native-research-key|api_key/);
});
