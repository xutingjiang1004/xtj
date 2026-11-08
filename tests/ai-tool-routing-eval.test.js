'use strict';
// An offline evaluation set for tool routing and the assembled policy.
// Each case is a realistic message (and, for follow-ups, the user text before it) plus the tools a competent agent would need.
// A needed tool must keep its FULL definition after routing, and the policy text must still describe it. When someone edits the
// keyword patterns in ai-tool-router.js, this is what stops a tool from being starved without anyone noticing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const router = require('../render-api/ai-tool-router');
const features = require('../render-api/ai-request-features');
const knowledge = require('../render-api/ai-knowledge-tools');
const agent = require('../render-api/ai-agent-tools');
const policy = require('../render-api/ai-task-policy');

function realTools() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
  const a = src.indexOf('const AI_TOOLS = ['), b = src.indexOf('\n];', a) + 3;
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src.slice(a, b).replace('const AI_TOOLS', 'var AI_TOOLS'), ctx);
  const list = Array.from(ctx.AI_TOOLS);
  ['search_posts', 'search_comments', 'search_photos', 'search_dm_messages', 'search_ai_history', 'search_users', 'search_everything'].forEach(name => list.push({ type: 'function', function: { name, description: '站内检索。', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } }));
  return list.concat(features.DOCUMENT_TOOLS, knowledge.TOOL_DEFS, agent.TOOL_DEFS);
}
const ALL = realTools();
const byName = Object.fromEntries(ALL.map(t => [t.function.name, t]));
const size = list => list.reduce((n, t) => n + JSON.stringify(t).length, 0);

// [message, tools needed, earlier user text (optional)]
const CASES = [
  // small talk: nothing beyond the always-full core
  ['你好呀', []], ['谢谢你', []], ['你是谁', []], ['讲个笑话', []], ['今天心情不太好', []], ['晚安', []],
  // live information
  ['明天上海天气怎么样', ['get_weather']], ['东京今天下雨吗', ['get_weather']], ['100 美元等于多少人民币', ['get_exchange_rate']], ['苹果股价现在多少', ['get_stock_quote']],
  ['5 英里是多少公里', ['convert_units']], ['日元兑人民币汇率', ['get_exchange_rate']],
  // data, files and visuals
  ['帮我把一段 JSON 转成 CSV', ['convert_data']], ['画个本月支出的饼图', ['make_chart']], ['生成一份 PDF 简历', ['generate_pdf']], ['给我一个二维码', ['qr_code']],
  ['把这份名单去重再排序', ['sort_filter']], ['算一下两个日期差几天', ['date_calc']], ['帮我做个 Excel 表格', ['make_file']], ['对比两段文本的差异', ['diff_text']],
  ['生成一个强密码', ['password_tool']], ['这个正则能匹配邮箱吗', ['regex_test']], ['解码这段 base64', ['encode_decode']], ['统计这段话有多少字', ['text_stats']],
  ['批量算一下含税价格', ['batch_calc']], ['整理成 markdown 表格', ['markdown_table']], ['压缩包里有什么', ['read_zip']], ['把图片缩小一半', ['image_process']],
  ['解析一下这个网址的参数', ['url_parse']], ['看看这个页面的标题和描述', ['page_meta']], ['销量的走势做个折线图', ['make_chart']], ['导出成文件给我下载', ['make_file']],
  // the user's own things on the site
  ['找一下我去年发的帖子', ['search_posts']], ['我最近有什么动态', ['my_activity_summary']], ['看看我十月的照片', ['photo_timeline', 'search_photos']], ['谁评论过我的帖子', ['search_comments']],
  ['之前聊过什么关于旅行的', ['search_ai_history']], ['找一下用户小明', ['search_users']], ['带我去照片墙', ['site_navigate']], ['我和小红的私信里提过地址吗', ['search_dm_messages']],
  // public knowledge
  ['找几篇关于 RAG 的论文', ['search_papers']], ['这个 DOI 的引用格式 10.1038/nature14539', ['cite_format', 'paper_by_doi']], ['nodejs/node 仓库最近有什么 issue', ['github_issues', 'github_repo']],
  ['lodash 有没有已知漏洞', ['vuln_check']], ['express 的最新版本和依赖', ['npm_pypi_lookup']], ['Hacker News 今天热门是什么', ['hn_search']], ['serendipity 什么意思', ['dictionary']],
  ['这个网站以前长什么样', ['wayback']], ['核实一下这个数据是真的吗', ['verify_claims']], ['上海的人口是多少', ['wikidata_facts']], ['最近 AI 有什么新闻', ['news_gdelt']],
  ['这个报错在 StackOverflow 上有解答吗', ['stackexchange_search']], ['帮我订阅这个博客的更新', ['rss_read']], ['小红书上大家怎么评价这家店', ['search_social']],
  // agent behaviour
  ['把这些存到笔记里', ['workspace_files']], ['三个方案分头调研一下', ['parallel_subtasks']], ['刚才记错了，改成杭州', ['memory_update']], ['对比 A B C 三款手机做个表', ['render_card', 'make_chart']],
  ['搜一下最新的 iPhone 发布会', ['search_web', 'tavily_search']], ['这个网页能帮我提取一下正文吗', ['web_extract']],
  // follow-ups keep the previous turn's group through the recent user text
  ['再来一份', ['make_chart'], '帮我画个折线图'], ['换成柱状图', ['make_chart'], '画个本月支出的饼图'], ['那明天呢', ['get_weather'], '今天上海天气怎么样'], ['继续', ['search_papers'], '找几篇关于 RAG 的论文'],
  // long messages, links and attachments always keep every definition
  ['帮我做一个完整的方案：五个人的团队，下个季度上线学生笔记产品，要考虑同步、隐私和定价，给风险清单和时间表。', ['search_papers', 'make_chart', 'workspace_files', 'parallel_subtasks']],
  ['我们团队五个人，计划下个季度上线一个面向学生的笔记产品，预算有限，需要同时考虑同步方案、隐私政策和定价策略，并给出风险清单和时间表。', ['search_papers', 'make_chart', 'workspace_files', 'parallel_subtasks']],
  ['看看 https://example.com/a 这篇讲了什么', ['read_web_page', 'page_meta']]
];

const routeFor = ([message, , earlier], extra) => router.routeBody(Object.assign({ message, messages: earlier ? [{ role: 'user', content: earlier }, { role: 'assistant', content: '好的' }] : [] }, extra || {}));

test('every needed tool keeps its full definition after routing (100% recall on the evaluation set)', () => {
  const misses = [];
  for (const c of CASES) {
    const out = router.apply(ALL, routeFor(c));
    for (const name of c[1]) {
      assert.ok(byName[name], 'the evaluation set names an unknown tool: ' + name);
      if (JSON.stringify(out.find(t => t.function.name === name)) !== JSON.stringify(byName[name])) misses.push(c[0] + ' → ' + name);
    }
  }
  assert.deepEqual(misses, [], 'tools starved by routing:\n' + misses.join('\n'));
});

test('the evaluation set covers every routed group and most tools, so a new pattern gap cannot hide', () => {
  const needed = new Set(CASES.flatMap(c => c[1]));
  const groupsHit = new Set(Array.from(needed).map(name => router.groupOf(name)));
  for (const group of Object.keys(router.GROUPS)) assert.ok(groupsHit.has(group), 'no evaluation case needs a tool from group ' + group);
  const routed = ALL.map(t => t.function.name).filter(name => router.groupOf(name) !== 'core' && !['search_document', 'read_document_section'].includes(name));
  const uncovered = routed.filter(name => !needed.has(name));
  assert.ok(uncovered.length <= 14, 'too many routed tools have no evaluation case: ' + uncovered.join(', '));
});

test('the assembled policy still describes what a case needs, and small talk gets the shortest policy', () => {
  const full = policy.TASK_POLICY;
  const problems = [];
  for (const c of CASES) {
    const route = routeFor(c), text = policy.forRequest(route);
    for (const name of c[1]) if (full.includes(name) && !text.includes(name)) problems.push(c[0] + ' → policy lost ' + name);
    assert.ok(text.length <= full.length, 'a routed policy is never longer than the full one');
    assert.ok(text.includes('【任务执行规则】') && text.includes('【答案核查】'), 'the rules are identical for every request');
  }
  assert.deepEqual(problems, []);
  const small = policy.forRequest(routeFor(['你好呀', []])), chart = policy.forRequest(routeFor(['画个饼图', []]));
  assert.ok(small.length < chart.length && chart.length < full.length, [small.length, chart.length, full.length].join(' < '));
  assert.ok(!small.includes('make_chart') && chart.includes('make_chart'));
  assert.equal(policy.forRequest(null), full);
});

test('routing saves definition size on small requests and never makes a request larger than the full set', () => {
  const fullSize = size(ALL);
  const savings = [];
  for (const c of CASES) {
    const route = routeFor(c), out = router.apply(ALL, route);
    assert.equal(out.length, ALL.length); assert.ok(size(out) <= fullSize);
    if (route) savings.push(1 - size(out) / fullSize);
  }
  const average = savings.reduce((a, b) => a + b, 0) / savings.length;
  assert.ok(savings.length >= 40, 'most evaluation cases are routed, got ' + savings.length);
  assert.ok(average > 0.1, 'average saving on routed requests should exceed 10%, got ' + (average * 100).toFixed(1) + '%');
  console.log('routing evaluation: ' + CASES.length + ' cases, ' + savings.length + ' routed, average definition saving ' + (average * 100).toFixed(1) + '%, small talk ' + (savings[0] * 100).toFixed(1) + '%, full set ' + fullSize + ' chars');
});

test('inside one conversation the route only grows, so the prompt prefix changes once per step instead of every turn', () => {
  let clock = 1000;
  const sticky = router.createStickyRoutes({ now: () => clock, ttl: 10000, max: 3 });
  const key = 'alice|conv-001';
  const groups = route => route === null ? 'FULL' : Array.from(route).sort().join('+');
  assert.equal(groups(sticky.apply(key, routeFor(['你好呀', []]))), 'core');
  assert.equal(groups(sticky.apply(key, routeFor(['画个饼图', []]))), 'core+data');
  assert.equal(groups(sticky.apply(key, routeFor(['再聊聊', []]))), 'core+data', 'a later small-talk turn must not shrink the route');
  assert.equal(groups(sticky.apply(key, routeFor(['明天天气', []]))), 'core+data+live');
  assert.equal(sticky.apply(key, null), null, 'one long message makes the conversation full');
  assert.equal(sticky.apply(key, routeFor(['你好呀', []])), null, 'and it stays full');
  // other conversations and other owners are independent; no key means no memory
  assert.equal(groups(sticky.apply('alice|conv-002', routeFor(['你好呀', []]))), 'core');
  assert.equal(groups(sticky.apply('bob|conv-001', routeFor(['你好呀', []]))), 'core');
  assert.equal(groups(sticky.apply('', routeFor(['画个饼图', []]))), 'core+data'); assert.equal(groups(sticky.apply('', routeFor(['你好呀', []]))), 'core');
  // old conversations expire and the table stays bounded
  clock += 20000; assert.equal(groups(sticky.apply(key, routeFor(['你好呀', []]))), 'core');
  for (let i = 0; i < 10; i++) sticky.apply('k' + i, routeFor(['你好呀', []]));
  assert.ok(sticky.size() <= 3);
});

test('through the request middleware a conversation id makes the route sticky, and a different account does not share it', async () => {
  const { EventEmitter } = require('node:events');
  const run = async (account, cid, message) => {
    const mw = features.makeMiddleware({ getAiConfig: async () => ({}), writeSse() {} });
    const req = Object.assign(new EventEmitter(), { path: '/api/agent/chat/stream', body: { message, conversation_id: cid }, userName: 'u' + account, accountId: '11111111-1111-4111-8111-11111111111' + account });
    const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
    let route; await new Promise((resolve, reject) => mw(req, res, () => { try { route = features.current().toolRoute; resolve(); } catch (e) { reject(e); } }));
    res.emit('finish'); return route && Array.from(route).sort().join('+');
  };
  const cid = 'EVALSTICKY' + Date.now();
  assert.equal(await run('1', cid, '你好呀'), 'core');
  assert.equal(await run('1', cid, '画个饼图'), 'core+data');
  assert.equal(await run('1', cid, '谢谢'), 'core+data');
  assert.equal(await run('2', cid, '谢谢'), 'core');
  assert.equal(await run('1', '', '谢谢'), 'core');
});
