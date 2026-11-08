'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const router = require('../render-api/ai-tool-router');
const features = require('../render-api/ai-request-features');
const knowledge = require('../render-api/ai-knowledge-tools');
const agent = require('../render-api/ai-agent-tools');

// The real definitions: the literal AI_TOOLS array in server.js plus what the server pushes after it.
function realTools() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
  const a = src.indexOf('const AI_TOOLS = ['), b = src.indexOf('\n];', a) + 3;
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src.slice(a, b).replace('const AI_TOOLS', 'var AI_TOOLS'), ctx);
  const list = Array.from(ctx.AI_TOOLS);
  const siteNames = ['search_posts', 'search_comments', 'search_photos', 'search_dm_messages', 'search_ai_history', 'search_users', 'search_everything'];
  siteNames.forEach(name => list.push({ type: 'function', function: { name, description: '站内检索。', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } }));
  return list.concat(features.DOCUMENT_TOOLS, knowledge.TOOL_DEFS, agent.TOOL_DEFS);
}
const size = list => list.reduce((n, t) => n + JSON.stringify(t).length, 0);
const names = list => list.map(t => t.function.name);

test('every tool in the router groups exists, no tool is in two groups, and every real tool is grouped', () => {
  const all = names(realTools());
  assert.ok(all.length >= 70, 'expected the full set, got ' + all.length);
  const seen = new Map();
  Object.keys(router.GROUPS).forEach(group => router.GROUPS[group].forEach(name => { assert.ok(all.includes(name), group + ' lists unknown tool ' + name); assert.ok(!seen.has(name), name + ' is in two groups'); seen.set(name, group); }));
  assert.deepEqual(all.filter(name => !seen.has(name)), [], 'ungrouped tools always stay full; list them deliberately');
  Object.keys(router.PATTERNS).forEach(key => assert.ok(router.GROUPS[key], 'pattern without group ' + key));
});

test('routing: small talk keeps only the core, topics add their group, long or attachment-bearing messages keep everything', () => {
  const has = (set, g) => set && set.has(g);
  assert.deepEqual(Array.from(router.route({ latest: '你好呀', context: '你好呀' })), ['core']);
  assert.ok(has(router.route({ latest: '明天上海天气怎么样' , context: '明天上海天气怎么样' }), 'live'));
  assert.ok(has(router.route({ latest: '帮我画个柱状图', context: '帮我画个柱状图' }), 'data'));
  assert.ok(has(router.route({ latest: '找一下我去年的照片', context: '找一下我去年的照片' }), 'site'));
  assert.ok(has(router.route({ latest: '找几篇关于 transformer 的论文', context: '找几篇关于 transformer 的论文' }), 'knowledge'));
  assert.ok(has(router.route({ latest: '把这个存到笔记里', context: '把这个存到笔记里' }), 'agent'));
  const multi = router.route({ latest: '查下天气再画图', context: '查下天气再画图' }); assert.ok(has(multi, 'live') && has(multi, 'data') && !has(multi, 'site'));
  assert.ok(has(router.route({ latest: '帮我搜一下最新的新闻', context: '帮我搜一下最新的新闻' }), 'web'));
  assert.ok(has(router.route({ latest: '刚才记错了，改成杭州', context: '刚才记错了，改成杭州' }), 'agent'));
  // follow-ups keep the previous turn's group through the recent context
  assert.ok(has(router.route({ latest: '再来一份', context: '再来一份\n帮我画个折线图' }), 'data'));
  assert.equal(router.route({ latest: '好'.repeat(router.LONG_MESSAGE) }), null);
  assert.equal(router.route({ latest: '看看 https://example.com/a 这篇讲了啥' }), null);
  assert.equal(router.route({ latest: '总结一下', hasAttachments: true }), null);
  assert.equal(router.route({ latest: '   ' }), null); assert.equal(router.route(), null);
  assert.equal(router.routeBody({ message: '总结一下', attachments: [{ name: 'a.pdf' }] }), null);
  assert.equal(router.routeBody({ message: '总结一下', vision_urls: ['x'] }), null);
  const viaBody = router.routeBody({ message: '再来一份', messages: [{ role: 'user', content: '帮我做个 excel 表' }, { role: 'assistant', content: '好的 天气' }] });
  assert.ok(has(viaBody, 'data') && !has(viaBody, 'live'), 'assistant text never selects groups');
});

test('apply keeps every tool visible in the same order, shrinks only unmatched groups, and keeps names, types, enums and required', () => {
  const all = realTools();
  const small = router.apply(all, router.route({ latest: '你好呀', context: '你好呀' }));
  assert.deepEqual(names(small), names(all));
  const ratio = size(small) / size(all);
  assert.ok(ratio < 0.8, 'small talk should shrink the definitions, got ' + ratio.toFixed(2));
  assert.ok(ratio > 0.5, 'the floor is the schema structure; a much smaller ratio would mean required information was dropped');
  const byName = Object.fromEntries(small.map(t => [t.function.name, t]));
  const chart = byName.make_chart.function;
  assert.ok(chart.description.length <= 70); assert.ok(!JSON.stringify(chart.parameters).includes('"description"'));
  const original = all.find(t => t.function.name === 'make_chart').function.parameters;
  assert.deepEqual(chart.parameters.required, original.required); assert.deepEqual(chart.parameters.properties.type.enum, original.properties.type.enum); assert.deepEqual(Object.keys(chart.parameters.properties), Object.keys(original.properties));
  // core tools are never shrunk
  for (const name of router.GROUPS.core) assert.deepEqual(byName[name], all.find(t => t.function.name === name), name + ' must stay full');
  // a matched group keeps its full definitions
  const chartRequest = router.apply(all, router.route({ latest: '画个图', context: '画个图' }));
  assert.deepEqual(chartRequest.find(t => t.function.name === 'make_chart'), all.find(t => t.function.name === 'make_chart'));
  assert.ok(chartRequest.find(t => t.function.name === 'get_weather').function.description.length <= 70);
  // no route (long message, attachments) returns the very same list
  assert.equal(router.apply(all, null), all);
  // unknown tools are left alone
  const odd = { type: 'function', function: { name: 'brand_new', description: '一个新工具。第二句。', parameters: { type: 'object', properties: { x: { type: 'string', description: '说明' } } } } };
  assert.deepEqual(router.apply([odd], new Set(['core']))[0], odd);
  assert.equal(router.compact(odd).function.description, '一个新工具');
});

test('the request middleware routes ordinary chat only; research, deep think and work mode keep every definition', async () => {
  const run = async (urlPath, body) => {
    const mw = features.makeMiddleware({ getAiConfig: async () => ({}), writeSse() {} });
    const req = Object.assign(new EventEmitter(), { path: urlPath, body, userName: 'alice', accountId: '11111111-1111-4111-8111-111111111111' });
    const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
    let route; await new Promise((resolve, reject) => { mw(req, res, () => { try { route = features.current().toolRoute; resolve(); } catch (e) { reject(e); } }); });
    res.emit('finish');
    return route;
  };
  const chat = await run('/api/agent/chat/stream', { message: '你好呀' }); assert.deepEqual(Array.from(chat), ['core']);
  assert.deepEqual(Array.from(await run('/api/agent/chat', { message: '今天天气' })), ['core', 'live']);
  assert.equal(await run('/api/agent/research/stream', { message: '你好呀', query: '你好呀你好呀' }), undefined);
  assert.equal(await run('/api/agent/chat/stream', { message: '你好呀', deep_think: true }), undefined);
  assert.equal(await run('/api/agent/chat/stream', { message: '你好呀', work_mode: true }), undefined);
  assert.equal(await run('/api/agent/custom-chat/stream', { message: '你好呀' }), undefined);
  assert.equal(await run('/api/agent/chat/stream', { message: '总结', attachments: [] }) instanceof Set, true);
});

test('inside a routed request, features.tools() returns compact definitions; outside any request it returns the list untouched', async () => {
  const all = realTools();
  assert.equal(features.tools(all).length, all.length);
  const mw = features.makeMiddleware({ getAiConfig: async () => ({}), writeSse() {} });
  const req = Object.assign(new EventEmitter(), { path: '/api/agent/chat/stream', body: { message: '你好呀' }, userName: 'alice', accountId: '11111111-1111-4111-8111-111111111111' });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
  let inside; await new Promise(resolve => mw(req, res, () => { inside = features.tools(all); resolve(); }));
  res.emit('finish');
  assert.deepEqual(names(inside), names(all)); assert.ok(size(inside) < size(all) * 0.8);
  // the attachment catalog is still appended to the document tools
  const doc = inside.find(t => t.function.name === 'search_document'); assert.match(doc.function.description, /当前附件目录/);
});
