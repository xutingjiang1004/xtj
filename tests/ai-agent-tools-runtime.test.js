'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentTools, TOOL_DEFS, TOOL_NAMES, META_TOOL_NAMES, dateBound } = require('../render-api/ai-agent-tools');

// A chainable fake of the supabase query builder. Every chain records its calls and resolves to the next canned reply.
function fakeDb(replies) {
  const log = [];
  const queue = Array.isArray(replies) ? replies.slice() : [];
  function chain(table) {
    const calls = []; const entry = { table, calls }; log.push(entry);
    const proxy = new Proxy({}, {
      get(_, method) {
        if (method === 'then') { const reply = typeof replies === 'function' ? replies(entry) : (queue.shift() || { data: [], error: null }); return (resolve, reject) => Promise.resolve(reply).then(resolve, reject); }
        if (method === 'maybeSingle') return () => { calls.push(['maybeSingle']); const reply = typeof replies === 'function' ? replies(entry) : (queue.shift() || { data: null, error: null }); return Promise.resolve(reply); };
        return (...args) => { calls.push([method, ...args]); return proxy; };
      }
    });
    return proxy;
  }
  return { from: chain, log };
}
const deps = (extra) => Object.assign({
  siteText: v => String(v || ''), siteResult: (source, id, title, snippet, createdAt, target) => ({ source, source_id: id, title, snippet, created_at: createdAt, jump_target: target }),
  normalPostAllowlist: q => q, isNormalPost: row => row.visibility !== 'system', photoUrl: id => '/photo/' + id
}, extra || {});
const ctx = (extra) => Object.assign({ userName: 'alice', accountId: '11111111-1111-4111-8111-111111111111' }, extra || {});
const UUID = '22222222-2222-4222-8222-222222222222';

test('definitions are complete: every tool has a definition and a handler, descriptions stay short, meta tools are never offered to workers', () => {
  const t = createAgentTools(deps());
  assert.equal(TOOL_DEFS.length, 9);
  for (const def of TOOL_DEFS) {
    const name = def.function.name;
    assert.ok(TOOL_NAMES.includes(name) && t.has(name), name);
    for (const r of def.function.parameters.required) assert.ok(def.function.parameters.properties[r], name + ' requires undeclared ' + r);
    assert.ok(def.function.description.length < 150, name + ' description too long: ' + def.function.description.length);
  }
  for (const name of ['deep_research', 'parallel_subtasks', 'self_check', 'workspace_files', 'site_navigate', 'render_card', 'memory_update', 'ask_user']) assert.ok(META_TOOL_NAMES.includes(name), name);
  assert.equal(t.has('constructor'), false);
  assert.deepEqual(dateBound('2026-03', false), '2026-03-01T00:00:00.000Z'); assert.deepEqual(dateBound('2026-12', true), '2027-01-01T00:00:00.000Z');
  assert.deepEqual(dateBound('2026-02-28', true), '2026-03-01T00:00:00.000Z'); assert.equal(dateBound('2026/02', false), null); assert.equal(dateBound('2026-13-01', false), new Date(Date.UTC(2026, 12, 1)).toISOString());
});

test('my_activity_summary counts posts, comments, likes and photos for the signed-in user only, and links recent items', async () => {
  const db = fakeDb([
    { data: [{ id: UUID, content: '今天去了海边', created_at: '2026-11-01T10:00:00Z', visibility: 'public' }, { id: 'sys', content: '系统', created_at: '2026-11-01T09:00:00Z', visibility: 'system' }], count: 7, error: null },
    { data: [{ id: 'c1', post_id: UUID, content: '好看！', created_at: '2026-10-31T10:00:00Z' }], count: 3, error: null },
    { data: null, count: 12, error: null },
    { data: [{ id: 'ph1', content: '日落', created_at: '2026-10-30T10:00:00Z' }], count: 2, error: null }
  ]);
  const t = createAgentTools(deps({ supabase: db }));
  const r = await t.execute('my_activity_summary', { days: 7 }, ctx());
  assert.match(r.content, /最近 7 天（alice）/); assert.match(r.content, /发帖 7 条｜评论 3 条｜点赞 12 次｜照片 2 张/); assert.match(r.content, /帖子 2026-11-01：今天去了海边/); assert.ok(!/系统/.test(r.content));
  assert.equal(r.cards[0].type, 'search_results'); assert.deepEqual(r.cards[0].data.results.map(x => x.jump_target.type), ['post', 'photo']);
  assert.ok(db.log.every(c => c.calls.some(x => x[0] === 'eq' && x[2] === 'alice')), 'every query is scoped to the user');
  assert.ok(db.log[0].calls.some(x => x[0] === 'gte' && x[1] === 'created_at'));
  assert.match((await t.execute('my_activity_summary', {}, { userName: '' })).error, /需要登录/);
  assert.match((await t.execute('my_activity_summary', {}, ctx({ guest: true }))).error, /需要登录/);
  // a failed sub-query is reported as unreadable instead of a fake zero
  const partial = createAgentTools(deps({ supabase: fakeDb([{ data: [], count: 0, error: null }, { data: null, error: { message: 'boom' } }, { data: null, count: 1, error: null }, { data: [], count: 0, error: null }]) }));
  assert.match((await partial.execute('my_activity_summary', {}, ctx())).content, /评论 暂时读不到/);
});

test('photo_timeline groups by month, filters by keyword and date, hides other people\'s private photos and validates dates', async () => {
  const rows = [{ id: 'a', user_name: 'alice', content: '京都 清水寺', created_at: '2026-10-20T00:00:00Z', visibility: 'public' }, { id: 'b', user_name: 'alice', content: '京都 鸭川', created_at: '2026-10-02T00:00:00Z', visibility: 'private' },
    { id: 'c', user_name: 'bob', content: '京都 私密', created_at: '2026-09-02T00:00:00Z', visibility: 'private' }, { id: 'd', user_name: 'alice', content: '大阪 城', created_at: '2026-09-01T00:00:00Z', visibility: 'public' }];
  const db = fakeDb([{ data: rows, error: null }]);
  const t = createAgentTools(deps({ supabase: db }));
  const r = await t.execute('photo_timeline', { from: '2026-09', to: '2026-10-31', keyword: '京都', scope: 'visible' }, ctx());
  assert.match(r.content, /共 2 张/); assert.match(r.content, /2026-10：2 张（京都 清水寺、京都 鸭川）/); assert.ok(!/私密/.test(r.content)); assert.equal(r.cards[0].data.results.length, 2);
  const calls = db.log[0].calls;
  assert.ok(calls.some(c => c[0] === 'gte' && c[2] === '2026-09-01T00:00:00.000Z')); assert.ok(calls.some(c => c[0] === 'lt' && c[2] === '2026-11-01T00:00:00.000Z')); assert.ok(!calls.some(c => c[0] === 'eq' && c[1] === 'user_name'));
  const mine = fakeDb([{ data: [], error: null }]); await createAgentTools(deps({ supabase: mine })).execute('photo_timeline', {}, ctx());
  assert.ok(mine.log[0].calls.some(c => c[0] === 'eq' && c[1] === 'user_name' && c[2] === 'alice'), 'default scope is the user\'s own photos');
  assert.equal((await createAgentTools(deps({ supabase: fakeDb([{ data: [], error: null }]) })).execute('photo_timeline', {}, ctx())).results_count, 0);
  assert.match((await t.execute('photo_timeline', { from: 'yesterday' }, ctx())).error, /日期格式/);
  assert.match((await createAgentTools(deps({ supabase: fakeDb([{ data: null, error: { message: 'x' } }]) })).execute('photo_timeline', {}, ctx())).error, /暂时读不到/);
});

test('site_navigate only offers whitelisted pages, checks that a post exists and is visible, and never navigates by itself', async () => {
  const visible = createAgentTools(deps({ supabase: fakeDb([{ data: { id: UUID, user_name: 'bob', visibility: 'public', media_type: null }, error: null }]) }));
  const page = await visible.execute('site_navigate', { page: 'photos' }, ctx());
  assert.equal(page.cards[0].type, 'navigate'); assert.deepEqual(page.cards[0].data, { page: 'photos', label: '打开照片墙' }); assert.match(page.content, /点一下才会跳转/);
  const post = await visible.execute('site_navigate', { page: 'post', target: UUID.toUpperCase(), label: '看帖子' }, ctx());
  assert.deepEqual(post.cards[0].data, { page: 'post', target: UUID, label: '看帖子' });
  assert.match((await visible.execute('site_navigate', { page: 'post', target: 'abc' }, ctx())).error, /帖子编号无效/);
  const hidden = createAgentTools(deps({ supabase: fakeDb([{ data: { id: UUID, user_name: 'bob', visibility: 'private' }, error: null }]) }));
  assert.match((await hidden.execute('site_navigate', { page: 'post', target: UUID }, ctx())).error, /没有权限/);
  assert.match((await createAgentTools(deps({ supabase: fakeDb([{ data: null, error: null }]) })).execute('site_navigate', { page: 'post', target: UUID }, ctx())).error, /没有找到/);
  assert.equal((await visible.execute('site_navigate', { page: 'user', target: '小明' }, ctx())).cards[0].data.label, '查看 小明');
  assert.equal((await visible.execute('site_navigate', { page: 'dm', target: 'bob' }, ctx())).cards[0].data.page, 'dm');
  for (const bad of ['', 'a/b', 'x<img>', 'a'.repeat(41), 'a\u0000b']) assert.match((await visible.execute('site_navigate', { page: 'user', target: bad }, ctx())).error, /用户名无效/);
  assert.match((await visible.execute('site_navigate', { page: 'javascript:alert(1)' }, ctx())).error, /不支持/);
});

test('deep_research offers a card with a clear topic and never claims the research started; guests and too-short topics are refused', async () => {
  const t = createAgentTools(deps());
  const r = await t.execute('deep_research', { topic: '对比 2026 年主流笔记软件的同步方案与隐私政策', note: '需要多来源核对' }, ctx());
  assert.equal(r.cards[0].type, 'research_offer'); assert.equal(r.cards[0].data.topic, '对比 2026 年主流笔记软件的同步方案与隐私政策'); assert.match(r.content, /由用户点按钮决定/); assert.match(r.content, /不要声称研究已经开始或完成/);
  assert.match((await t.execute('deep_research', { topic: '太短' }, ctx())).error, /太短/);
  assert.match((await t.execute('deep_research', { topic: '一个足够长的研究主题吧' }, ctx({ guest: true }))).error, /登录/);
});

test('parallel_subtasks runs 2-4 tasks at once, bills the extra model use, tolerates a failed task, and limits repeated use', async () => {
  const started = []; const billed = [];
  const runSubtask = async (task) => { started.push(task.title); await new Promise(r => setTimeout(r, 20)); if (task.title === '坏的') throw new Error('upstream down'); return { text: task.title + '的结论', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, model: 'deepseek-flash' }; };
  const t = createAgentTools(deps({ runSubtask, recordUsage: async (user, usage, meta) => { billed.push({ user, usage, meta }); } }));
  const c = ctx(); const tasks = [{ title: '甲', instruction: '查一下甲相关的数据并给出处' }, { title: '乙', instruction: '查一下乙相关的数据并给出处' }, { title: '坏的', instruction: '这个会失败，请执行它' }];
  const t0 = Date.now(); const r = await t.execute('parallel_subtasks', { tasks }, c);
  assert.ok(Date.now() - t0 < 55, 'tasks run in parallel, not one after another'); assert.deepEqual(started, ['甲', '乙', '坏的']);
  assert.match(r.content, /成功 2 个/); assert.match(r.content, /【子任务 1：甲】\n甲的结论/); assert.match(r.content, /【子任务 3：坏的】（失败：upstream down）/);
  assert.equal(billed.length, 1); assert.equal(billed[0].user, 'alice'); assert.equal(billed[0].usage.total_tokens, 300); assert.equal(billed[0].meta.source, 'parallel_subtasks');
  await t.execute('parallel_subtasks', { tasks }, c);
  assert.match((await t.execute('parallel_subtasks', { tasks }, c)).error, /用过两次/);
  assert.match((await t.execute('parallel_subtasks', { tasks: [tasks[0]] }, ctx())).error, /至少需要 2 个/);
  assert.match((await t.execute('parallel_subtasks', { tasks: [{ title: 'x', instruction: '短' }, { title: 'y', instruction: '' }] }, ctx())).error, /至少需要 2 个/);
  assert.equal((await t.execute('parallel_subtasks', { tasks: Array.from({ length: 9 }, (_, i) => ({ title: 't' + i, instruction: '一个足够长的指令 ' + i })) }, ctx())).results_count, 4);
  const allFail = createAgentTools(deps({ runSubtask: async () => { throw new Error('x'); } }));
  assert.match((await allFail.execute('parallel_subtasks', { tasks }, ctx())).error, /所有子任务都没有产出/);
  assert.match((await t.execute('parallel_subtasks', { tasks }, { userName: '' })).error, /需要登录/);
});

test('verify_claims searches each claim, groups evidence by domain, reports thin evidence and passes search errors through', async () => {
  const seen = [];
  const executeToolCall = async (call) => {
    const q = JSON.parse(call.function.arguments).query; seen.push([call.function.name, q]);
    if (/失败/.test(q)) return { tool_name: 'search_web', error: '今日网页搜索次数已达上限，请开通 Pro 或明日再试' };
    if (/孤证/.test(q)) return { tool_name: 'search_web', content: JSON.stringify([{ title: 'A', url: 'https://only.example/a', snippet: '只有这一处' }]) };
    return { tool_name: 'search_web', content: JSON.stringify([{ title: '报道一', url: 'https://www.news-a.com/x', snippet: '确认了' }, { title: '报道二', url: 'https://news-a.com/y', snippet: '同一域名' }, { title: '报道三', url: 'https://news-b.org/z', snippet: '另一家也确认' }, { title: '坏链接', url: 'javascript:alert(1)', snippet: 'x' }]), cards: [{ type: 'web_search' }] };
  };
  const t = createAgentTools(deps({ executeToolCall }));
  const r = await t.execute('verify_claims', { claims: ['某公司 2025 年营收 100 亿', '孤证的说法在这里', '检索失败的陈述在这里', '多余的第四条不会被处理'] }, ctx());
  assert.equal(seen.length, 3); assert.ok(seen.every(([name]) => name === 'search_web'));
  assert.match(r.content, /有 2 个不同域名的来源/); assert.match(r.content, /- news-a\.com｜报道一｜确认了/); assert.match(r.content, /- news-b\.org｜报道三/); assert.ok(!/同一域名/.test(r.content), 'one entry per domain'); assert.ok(!/javascript:/.test(r.content));
  assert.match(r.content, /只有 1 个来源域名，证据偏薄/); assert.match(r.content, /无法检索：今日网页搜索次数已达上限/); assert.ok(!r.cards.some(c => c.type === 'web_search'), 'the inner search card is not forwarded');
  assert.match(r.cards[0].data.text, /✓ 某公司[\s\S]*\? 孤证[\s\S]*✗ 检索失败/);
  assert.match((await t.execute('verify_claims', { claims: [] }, ctx())).error, /请提供要核对的陈述/);
});

test('workspace_files lists, writes, appends, reads and deletes notes through the account store, with honest errors', async () => {
  const store = new Map(); let seq = 0; const failWith = { code: null };
  const assets = {
    async list() { if (failWith.code) throw Object.assign(new Error('x'), { code: failWith.code }); return Array.from(store.values()).map(({ data, ...meta }) => meta); },
    async get(owner, id) { return store.get(id) || null; },
    async save(owner, v) { if (failWith.code) throw Object.assign(new Error('x'), { code: failWith.code }); const id = v.id || 'id' + (++seq); const rec = { id, kind: v.kind, title: v.title, data: v.data, updated_at: '2026-11-0' + (1 + seq) + 'T00:00:00Z' }; store.set(id, rec); return rec; },
    async remove(owner, id) { return store.delete(id); }
  };
  const t = createAgentTools(deps({ assets }));
  assert.match((await t.execute('workspace_files', { action: 'list' }, ctx())).content, /空的/);
  const w = await t.execute('workspace_files', { action: 'write', title: '周报草稿', content: '第一段' }, ctx());
  assert.match(w.content, /已创建笔记《周报草稿》（3 字）/); assert.equal(store.get('id1').kind, 'note'); assert.equal(store.get('id1').data.text, '第一段'); assert.equal(store.get('id1').data.summary, '第一段');
  assert.match((await t.execute('workspace_files', { action: 'append', title: '周报草稿', content: '第二段' }, ctx())).content, /已追加到笔记《周报草稿》/);
  assert.equal(store.get('id1').data.text, '第一段\n第二段');
  assert.match((await t.execute('workspace_files', { action: 'read', title: '周报草稿' }, ctx())).content, /《周报草稿》\n第一段\n第二段/);
  assert.match((await t.execute('workspace_files', { action: 'write', title: '周报草稿', content: '全部重写' }, ctx())).content, /已更新/); assert.equal(store.size, 1);
  assert.match((await t.execute('workspace_files', { action: 'list' }, ctx())).content, /共 1 篇笔记：\n- 周报草稿/);
  assert.match((await t.execute('workspace_files', { action: 'read', title: '不存在' }, ctx())).error, /没有找到/);
  assert.match((await t.execute('workspace_files', { action: 'write', title: 'x', content: '   ' }, ctx())).error, /正文为空/);
  assert.match((await t.execute('workspace_files', { action: 'read' }, ctx())).error, /请提供笔记标题/);
  assert.match((await t.execute('workspace_files', { action: 'delete', title: '周报草稿' }, ctx())).content, /已删除/); assert.equal(store.size, 0);
  store.set('long', { id: 'long', kind: 'note', title: '长', data: { text: 'x'.repeat(19990) }, updated_at: '2026-11-01T00:00:00Z' });
  assert.match((await t.execute('workspace_files', { action: 'append', title: '长', content: 'y'.repeat(30) }, ctx())).error, /超过 20000 字/);
  store.set('other', { id: 'other', kind: 'table', title: '表', data: {}, updated_at: '2026-11-01T00:00:00Z' });
  assert.match((await t.execute('workspace_files', { action: 'read', title: '表' }, ctx())).error, /没有找到/, 'only notes are visible to this tool');
  failWith.code = 'asset_limit'; assert.match((await t.execute('workspace_files', { action: 'write', title: 'n', content: 'c' }, ctx())).error, /已满/);
  failWith.code = 'asset_storage_unavailable'; assert.match((await t.execute('workspace_files', { action: 'list' }, ctx())).error, /暂时不可用/);
  assert.match((await t.execute('workspace_files', { action: 'list' }, ctx({ accountId: '' }))).error, /需要登录/);
  assert.match((await t.execute('workspace_files', { action: 'list' }, ctx({ guest: true }))).error, /需要登录/);
});

test('render_card validates every variant, clamps sizes and pads short rows', async () => {
  const t = createAgentTools(deps());
  const cmp = await t.execute('render_card', { variant: 'compare', title: '方案对比', columns: ['方案', '价格', '优点'], rows: [['A', '10 元'], ['B', '20 元', '快', '多余的格']] });
  assert.equal(cmp.cards[0].type, 'rich_card'); assert.deepEqual(cmp.cards[0].data.rows, [['A', '10 元', ''], ['B', '20 元', '快']]); assert.match(cmp.content, /不要再重复卡片里的内容/);
  assert.match((await t.execute('render_card', { variant: 'compare', title: 't', columns: ['一列'], rows: [['a']] })).error, /2 到 6 个列名/);
  assert.match((await t.execute('render_card', { variant: 'compare', title: 't', columns: ['a', 'b'], rows: [] })).error, /至少一行/);
  const big = await t.execute('render_card', { variant: 'compare', title: 't', columns: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], rows: Array.from({ length: 30 }, () => ['1']) });
  assert.equal(big.cards[0].data.columns.length, 6); assert.equal(big.cards[0].data.rows.length, 12);
  const tl = await t.execute('render_card', { variant: 'timeline', title: '进展', items: [{ time: '2026-01', title: '立项', detail: '启动' }, { time: 'x' }] });
  assert.deepEqual(tl.cards[0].data.items, [{ time: '2026-01', title: '立项', detail: '启动' }]);
  const ck = await t.execute('render_card', { variant: 'checklist', title: '待办', items: ['买菜', { text: '写周报', done: true }, { text: '' }] });
  assert.deepEqual(ck.cards[0].data.items, [{ text: '买菜', done: false }, { text: '写周报', done: true }]);
  const st = await t.execute('render_card', { variant: 'stats', title: '概览', items: Array.from({ length: 12 }, (_, i) => ({ label: 'L' + i, value: String(i), note: 'n' })) });
  assert.equal(st.cards[0].data.items.length, 8);
  assert.match((await t.execute('render_card', { variant: 'stats', title: 't', items: [{ label: 'x' }] })).error, /stats 需要 items/);
  assert.match((await t.execute('render_card', { variant: 'pie', title: 't' })).error, /不支持的卡片类型/);
  assert.match((await t.execute('render_card', { variant: 'stats', title: '  ', items: [] })).error, /请提供卡片标题/);
  const html = await t.execute('render_card', { variant: 'checklist', title: '<img src=x onerror=1>', items: ['<script>alert(1)</script>'] });
  assert.equal(html.cards[0].title, '<img src=x onerror=1>', 'text is kept as text; the client renders it with textContent');
});

test('handlers never throw and unknown tools are refused', async () => {
  const t = createAgentTools(deps({ supabase: { from() { throw new Error('db exploded'); } } }));
  assert.match((await t.execute('my_activity_summary', {}, ctx())).error, /工具执行失败：db exploded/);
  assert.match((await t.execute('nope', {}, ctx())).error, /未知工具/);
  assert.match((await t.execute('render_card', null, null)).error, /请提供卡片标题/);
});

test('wiring: every new tool is defined, dispatched, guarded for offline mode, time-limited, billed and labelled in the UI', () => {
  const fs = require('node:fs'), path = require('node:path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
  const knowledge = require('../render-api/ai-knowledge-tools'), features = require('../render-api/ai-request-features');
  const all = knowledge.TOOL_NAMES.concat(TOOL_NAMES, ['memory_update']);
  assert.equal(all.length, 25);
  // dispatch happens before the big switch and tolerates the isolated executor used by other tests
  const dispatch = server.indexOf("typeof aiKnowledgeTools !== 'undefined' && aiKnowledgeTools.has(name)");
  assert.ok(dispatch > 0 && dispatch < server.indexOf("  switch (name) {\n    case 'search_web'"), 'dispatch must run before the switch');
  assert.match(server, /typeof aiAgentTools !== 'undefined' && aiAgentTools\.has\(name\)\) return aiAgentTools\.execute\(name, args, context \|\| \{\}\)/);
  // definitions are pushed before the tool summary the prompt is generated from
  const push = server.indexOf("AI_TOOLS.push.apply(AI_TOOLS, require('./ai-knowledge-tools').TOOL_DEFS)");
  assert.ok(push > 0 && push < server.indexOf('const CAT_AI_TOOL_SUMMARY ='));
  // (offline behavior is exercised for real in the next test)
  const src = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'ai-request-features.js'), 'utf8');
  assert.match(src, /require\('\.\/ai-knowledge-tools'\)\.NETWORK_TOOL_NAMES,\['verify_claims','parallel_subtasks','my_activity_summary','photo_timeline'\]/);
  // long-running tools get longer guards than the 30 s default; the knowledge tools and subtasks are billed or bounded
  assert.match(server, /guardName === 'parallel_subtasks'\) guardLimit = 75000/); assert.match(server, /guardName === 'verify_claims'\) guardLimit = 60000/);
  assert.match(server, /source: meta\.source, message: '', content: '', reasoning: '', search_count: 0, did_search: false/);
  assert.match(server, /max_tokens: 1800, max_tool_rounds: 3, total_timeout_ms: 55000/);
  // research and deep-think workers never receive the user-facing tools
  assert.match(server, /var AI_WORKER_EXCLUDED_TOOLS = new Set\(\['deep_research', 'parallel_subtasks', 'self_check', 'workspace_files', 'site_navigate', 'render_card', 'memory_update'\]\)/);
  assert.equal((server.match(/aiToolsForSearch\(true, true\)/g) || []).length, 3);
  // the UI has a Chinese step name and a finished-state noun for every tool
  const labels = client.slice(client.indexOf('var TOOL_LABELS = {'), client.indexOf('function inProcessRail')), done = client.slice(client.indexOf('var TOOL_DONE_LABELS = {'), client.indexOf('var TOOL_SEARCH_KINDS'));
  for (const name of all) { assert.match(labels, new RegExp('\\b' + name + ':'), name + ' has no step label'); assert.match(done, new RegExp('\\b' + name + ':'), name + ' has no finished label'); }
  // every card type the tools emit is drawn by the client
  for (const type of ['link_list', 'info_card', 'navigate', 'research_offer', 'rich_card']) assert.ok(client.includes("type === '" + type + "'"), type + ' card has no renderer');
});

test('in a "use only this conversation" request the network and site tools are refused, while cards, notes, memory and pure formatting still work', async () => {
  const { EventEmitter } = require('node:events');
  const features = require('../render-api/ai-request-features'), knowledge = require('../render-api/ai-knowledge-tools');
  const mw = features.makeMiddleware({ getAiConfig: async () => ({}), writeSse() {} });
  const req = Object.assign(new EventEmitter(), { path: '/api/agent/chat', body: { message: '你好', network_mode: 'off' }, userName: 'alice', accountId: '11111111-1111-4111-8111-111111111111' });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
  const refused = [], allowed = [];
  await new Promise((resolve, reject) => mw(req, res, () => {
    try {
      for (const name of knowledge.NETWORK_TOOL_NAMES.concat(['verify_claims', 'parallel_subtasks', 'my_activity_summary', 'photo_timeline'])) { try { features.guardTool(name); allowed.push(name); } catch (e) { refused.push(name); } }
      for (const name of ['cite_format', 'render_card', 'workspace_files', 'site_navigate', 'deep_research', 'memory_update']) { try { features.guardTool(name); } catch (e) { allowed.push('WRONGLY REFUSED ' + name); } }
      resolve();
    } catch (error) { reject(error); }
  }));
  res.emit('finish');
  assert.deepEqual(allowed, []); assert.equal(refused.length, knowledge.NETWORK_TOOL_NAMES.length + 4);
});

test('self_check sends the question, draft and evidence to the reviewer, bills it, limits repeats and degrades quietly', async () => {
  const calls = [], billed = [];
  const t = createAgentTools(deps({
    runCritic: async (input) => { calls.push(input); return { text: '[无来源数字] 草稿里的 1200 亿没有出处 → 补一个来源\n[未回答] 没说明时间范围 → 补上', usage: { prompt_tokens: 400, completion_tokens: 60 }, model: 'deepseek-flash' }; },
    recordUsage: async (user, usage, meta) => { billed.push({ user, usage, meta }); }
  }));
  const c = ctx(); const draft = '这家公司 2025 年营收约 1200 亿元，同比增长 12%，主要来自云业务。'.repeat(2);
  const r = await t.execute('self_check', { question: '这家公司去年营收多少', draft, evidence: '搜索摘要一条' }, c);
  assert.match(r.content, /^自查意见（供你修改回答/); assert.match(r.content, /无来源数字/); assert.match(r.content, /不要把这段原样念给用户/);
  assert.equal(calls[0].question, '这家公司去年营收多少'); assert.equal(calls[0].draft, draft); assert.equal(calls[0].evidence, '搜索摘要一条');
  assert.equal(billed.length, 1); assert.equal(billed[0].usage.total_tokens, 460); assert.equal(billed[0].meta.source, 'self_check'); assert.equal(billed[0].user, 'alice');
  await t.execute('self_check', { question: 'q', draft }, c);
  assert.match((await t.execute('self_check', { question: 'q', draft }, c)).error, /已经自查过两次/);
  assert.match((await t.execute('self_check', { question: 'q', draft: '太短' }, ctx())).error, /太短/);
  assert.match((await t.execute('self_check', { draft }, ctx())).error, /请提供用户的原问题/);
  assert.match((await t.execute('self_check', { question: 'q', draft }, { userName: '' })).error, /需要登录/);
  const clean = createAgentTools(deps({ runCritic: async () => ({ text: '未发现明显问题', usage: null }) }));
  assert.equal((await clean.execute('self_check', { question: 'q', draft }, ctx())).content, '自查：未发现明显问题，可以直接回答。');
  const broken = createAgentTools(deps({ runCritic: async () => { throw new Error('upstream down'); } }));
  assert.match((await broken.execute('self_check', { question: 'q', draft }, ctx())).error, /自查暂时不可用，直接回答即可（upstream down）/);
  const empty = createAgentTools(deps({ runCritic: async () => ({ text: '  ' }) }));
  assert.match((await empty.execute('self_check', { question: 'q', draft }, ctx())).error, /没有给出意见/);
  assert.match((await createAgentTools(deps()).execute('self_check', { question: 'q', draft }, ctx())).error, /暂不可用/);
  const long = createAgentTools(deps({ runCritic: async (input) => { calls.push(input); return { text: 'x'.repeat(5000) }; } }));
  assert.ok((await long.execute('self_check', { question: 'q', draft: 'd'.repeat(20000) }, ctx())).content.length < 1700); assert.equal(calls.at(-1).draft.length, 6000);
});
