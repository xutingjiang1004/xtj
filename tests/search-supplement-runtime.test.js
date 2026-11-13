'use strict';
// 联网搜索：第一个搜索源结果太少时，用不花配额的免费搜索源补齐并去重；付费搜索源不因此多调用。
const test = require('node:test'), assert = require('node:assert/strict');

const KEYS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_WEB_API_KEY', 'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'SEARCH_API_URL'];
function load(env) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env || {});
  for (const id of Object.keys(require.cache)) if (/render-api[\\/](search-providers|deepseek-web)\.js$/.test(id)) delete require.cache[id];
  return require('../render-api/search-providers');
}
const bing = rows => '<ol>' + rows.map(([url, title]) => '<li class="b_algo"><h2><a href="' + url + '">' + title + '</a></h2><p>' + title + ' 摘要</p></li>').join('') + '</ol>';
function mockFetch(routes, calls) {
  return async (url, init) => {
    const host = new URL(String(url)).host; calls.push(host);
    for (const [match, reply] of routes) if (host.includes(match)) return reply(String(url), init);
    throw new Error('offline: ' + host);
  };
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const html = value => new Response(value, { status: 200, headers: { 'content-type': 'text/html' } });

test('result keys ignore protocol, www, trailing slashes and tracking parameters', () => {
  const { searchResultKey } = load();
  assert.equal(searchResultKey({ url: 'https://www.Example.com/a/?utm_source=x&id=2' }), searchResultKey({ link: 'http://example.com/a?id=2' }));
  assert.notEqual(searchResultKey({ url: 'https://example.com/a?id=2' }), searchResultKey({ url: 'https://example.com/a?id=3' }));
  assert.equal(searchResultKey({}), '');
});

test('a thin first answer is topped up from the next free provider without duplicates', async t => {
  const calls = [], real = global.fetch; t.after(() => { global.fetch = real; });
  global.fetch = mockFetch([
    ['bing.com', () => html(bing([['https://www.example.com/one/', '第一条']]))],
    ['', () => json({ results: [
      { title: '第一条（重复）', url: 'http://example.com/one?utm_source=feed', content: 'dup' },
      { title: '第二条', url: 'https://news.example.org/two', content: 'b' },
      { title: '第三条', url: 'https://forum.example.net/three', content: 'c' },
      { title: '第四条', url: 'https://blog.example.io/four', content: 'd' }] })]
  ], calls);
  const { searchWeb } = load();
  const out = await searchWeb('补充测试 ' + Date.now(), 5);
  assert.equal(out.used_provider, 'BingHtml');
  assert.deepEqual(out.supplemented_by, ['SearXNG']);
  assert.deepEqual(out.results.map(r => r.title), ['第一条', '第二条', '第三条', '第四条']);
});

test('enough results from the first provider stop the chain; nothing else is called', async t => {
  const calls = [], real = global.fetch; t.after(() => { global.fetch = real; });
  global.fetch = mockFetch([['bing.com', () => html(bing([['https://a.example/1', '一'], ['https://b.example/2', '二'], ['https://c.example/3', '三']]))]], calls);
  const { searchWeb } = load();
  const out = await searchWeb('足够的结果 ' + Date.now(), 5);
  assert.equal(out.results.length, 3); assert.equal(out.supplemented_by, undefined);
  assert.deepEqual([...new Set(calls)], ['www.bing.com']);
});

test('a thin paid answer is topped up only from free providers, never from another paid one', async t => {
  const calls = [], real = global.fetch; t.after(() => { global.fetch = real; });
  global.fetch = mockFetch([
    ['tavily', () => json({ results: [{ title: '付费唯一一条', url: 'https://paid.example/only', content: 'x' }] })],
    ['brave', () => { throw new Error('a second paid provider must not be called'); }],
    ['bing.com', () => html(bing([['https://free.example/1', '免费一'], ['https://free.example/2', '免费二']]))]
  ], calls);
  const { searchWeb } = load({ TAVILY_API_KEY: 'tvly-test', BRAVE_SEARCH_API_KEY: 'brave-test' });
  const out = await searchWeb('付费结果太少 ' + Date.now(), 5);
  assert.equal(out.used_provider, 'Tavily');
  assert.deepEqual(out.supplemented_by, ['BingHtml']);
  assert.deepEqual(out.results.map(r => r.title), ['付费唯一一条', '免费一', '免费二']);
  assert.ok(!calls.some(host => host.includes('brave')), calls.join(','));
});

test('the task policy tells the agent how to search comprehensively', () => {
  const policy = require('../render-api/ai-task-policy').forRequest(null);
  for (const part of ['【全面检索】', '中文和英文各查一遍', 'site:域名', '再追查一轮', '3 个以上原文', '只算一个来源', '哪些角度没有查到']) assert.ok(policy.includes(part), part);
});
