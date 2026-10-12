'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const history = require('../render-api/ai-history');
const source = fs.readFileSync('render-api/server.js', 'utf8');
const id = n => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');
const parseMeta = row => { try { return JSON.parse(row.media_url); } catch (_) { return {}; } };
function likePattern(pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else regex += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$');
}
function database(rows, error) {
  return { async rpc(name, args) {
    assert.equal(name,'list_ai_conversations');
    if (error) return { data:null,error };
    const grouped = new Map();
    for (const r of rows) {
      const meta = parseMeta(r); if (r.user_name !== args.p_user_name || meta.deleted || (args.p_conversation_id && meta.convId !== args.p_conversation_id)) continue;
      let c = grouped.get(meta.convId);
      if (!c) { c = { conversation_id:meta.convId, updated_at:r.created_at, message_count:0, chat_mode:'normal' }; grouped.set(meta.convId,c); }
      c.message_count++; if (r.created_at > c.updated_at) c.updated_at = r.created_at;
      if (meta.chat_mode === 'deep_think' || meta.type === 'tavily_research') c.chat_mode = 'deep_think';
    }
    return { data:{ ok:true, conversations:[...grouped.values()].filter(r => !args.p_mode || r.chat_mode === args.p_mode)
      .sort((a,b) => b.updated_at.localeCompare(a.updated_at)).slice(0,args.p_limit), has_more:false },error:null };
  }, from() {
    const filters = [], orders = []; let limit = Infinity;
    const q = { select() { return q; }, neq(k,v) { filters.push(r => r[k] !== v); return q; },
      eq(k,v) { filters.push(r => r[k] === v); return q; },
      filter(k,op,v) { assert.equal(op, 'like'); const regex = likePattern(v); filters.push(r => regex.test(r[k])); return q; },
      lt(k,v) { filters.push(r => r[k] < v); return q; },
      order(k,v) { orders.push([k,v.ascending]); return q; }, limit(n) { limit = n; return q; },
      or(value) { const m = value.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^\)]+)\)$/);
        assert.ok(m, 'cursor uses validated time and UUID'); filters.push(r => r.created_at < m[1] || (r.created_at === m[2] && r.id < m[3])); return q; },
      then(resolve,reject) {
        const found = rows.filter(r => filters.every(f => f(r))).sort((a,b) => {
          for (const [k,asc] of orders) { const cmp = String(a[k]).localeCompare(String(b[k])); if (cmp) return cmp * (asc ? 1 : -1); }
          return 0;
        }).slice(0, limit);
        return Promise.resolve(error ? { data: null, error } : { data: found, error: null }).then(resolve,reject);
      }
    }; return q;
  } };
}
function row(n, conv = 'ABCDEF', extra = {}) {
  return { id: id(n), user_name: 'alice', content: 'message ' + n, media_type: '__ai_agent_msg__',
    actor_key: 'ai_msg_conv_' + conv + '_user_alice_' + n, created_at: '2026-10-12T08:00:00.123456Z',
    media_url: JSON.stringify({ convId: conv, role: 'user', ...extra }) };
}
function route(start, end, db) {
  let handler;
  const c = { ...history, supabase: db, app: { get(...args) { handler = args.at(-1); }, post(...args) { handler = args.at(-1); } },
    authenticateUser() {}, rateLimit() {}, AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', AI_CHAT_LATEST_CONVERSATION_SCAN_LIMIT: 60,
    AI_AGENT_CONVERSATION_LIST_LIMIT: 50, parseMsgMeta: parseMeta, resolveConvId: r => parseMeta(r).convId,
    getConversationStorageMode: rows => rows.some(r => parseMeta(r).chat_mode === 'deep_think') ? 'deep_think' : 'normal', console: { log() {}, warn() {}, error() {} } };
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a);
  vm.runInNewContext(source.slice(a,b), c);
  return async req => { let body, status = 200; const res = { status(n) { status = n; return res; }, json(v) { body = v; return res; } };
    await handler({ userName: 'alice', query: {}, body: {}, ...req },res); return { status, body }; };
}
test('AI queries distinguish a conversation from a longer ID and literal marker delimiters', async () => {
  const db = database([row(1), row(2,'ABCDEF-other'), { ...row(3), actor_key: 'aiXmsgYconvZABCDEF_user_alice_3' }, { ...row(4), user_name: 'bob' }]);
  const page = await history.queryAiHistoryPage(db, { userName: 'alice', marker: '__ai_agent_msg__', convId: 'ABCDEF', limit: 10, parseMeta });
  assert.deepEqual(page.rows.map(r => r.id),[id(1)]);
  for (const value of ['abc%', 'ABC_DEF', 'ABCDEF\\', 'ABCDEF,or', 'x'.repeat(129)]) assert.throws(() => history.aiConversationActorPattern(value));
});
test('AI pagination covers timestamp ties without omissions or duplicate messages', async () => {
  const db = database(Array.from({ length: 37 }, (_,n) => row(n + 1))), found = []; let cursor;
  do {
    const page = await history.queryAiHistoryPage(db, { userName: 'alice', marker: '__ai_agent_msg__', convId: 'ABCDEF', limit: 10, parseMeta, cursor });
    found.push(...page.rows.map(r => r.id)); if (!page.hasMore) break;
    const last = page.rows.at(-1); cursor = history.parseAiHistoryCursor(JSON.stringify({ at: last.created_at, id: last.id }));
  } while (true);
  assert.equal(found.length,37); assert.equal(new Set(found).size,37);
  for (const value of ['bad', '{"at":"2026-10-12T00:00:00Z","id":"evil,or"}', '{"at":"2026-10-12T00:00:00Z,or"}']) assert.throws(() => history.parseAiHistoryCursor(value));
  assert.equal(history.parseAiHistoryCursor('2026-10-12T08:00:00Z').id,null);
});
test('AI pagination steps over more deleted rows than the first payload buffer', async () => {
  const db = database(Array.from({ length: 70 }, (_,n) => row(n + 1,'ABCDEF',{ deleted: n >= 20 })));
  const page = await history.queryAiHistoryPage(db, { userName: 'alice', marker: '__ai_agent_msg__', convId: 'ABCDEF', limit: 10, parseMeta });
  assert.equal(page.rows.length,10); assert.equal(page.hasMore,true); assert.equal(page.rows[0].id,id(20));
  await assert.rejects(history.queryAiHistoryPage(database([],{code:'database_failure'}), { userName: 'alice', marker: '__ai_agent_msg__', convId: 'ABCDEF', limit: 10, parseMeta }));
});
test('AI list errors are failures, and auto-open skips deleted recent conversations', async () => {
  const list = route("app.get('/api/agent/chat/conversations'", '// GET /api/agent/search-health',database([],{code:'database_failure'}));
  assert.equal((await list({})).status,503);
  const rows = [ { ...row(1,'ACTIVE'), created_at:'2026-10-12T07:00:00Z' }, { ...row(2,'DELETED',{deleted:true}), created_at:'2026-10-12T08:00:00Z' } ];
  const read = route("app.get('/api/agent/chat/history'", '// =====================',database(rows));
  const result = await read({ query:{ mode:'normal' } }); assert.equal(result.status,200);
  assert.equal(result.body.conversation_id,'ACTIVE'); assert.equal(result.body.messages.length,1);
  assert.equal((await read({query:{before:'malformed'}})).status,400);
});
test('AI deletion checks its atomic database result and ignores a body-supplied owner', async () => {
  const mutations = [], db = { rpc: async (name,args) => { mutations.push({name,args}); return {data:null,error:{code:'write_failed'}}; } };
  const remove = route("app.post('/api/agent/chat/delete'", '// POST /api/agent/chat/new',db);
  const result = await remove({body:{conversation_id:'ABCDEF',user_name:'bob'}});
  assert.equal(result.status,503); assert.equal(result.body.ok,false);
  assert.equal(mutations[0].args.p_user_name,'alice'); assert.equal(mutations[0].name,'soft_delete_ai_conversation');
});
