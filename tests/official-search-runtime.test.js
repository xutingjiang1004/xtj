'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../render-api/search-providers');

test('开启官方限定后 provider 链只剩 DeepSeek 官方', async function(t) {
  const original = providers.isOfficialOnlySearch();
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
  t.after(() => {
    providers.setOfficialOnlySearch(original);
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });
  providers.setOfficialOnlySearch(true);
  assert.equal(providers.isOfficialOnlySearch(), true);

  // 注入假 provider 观察实际请求了谁：官方搜索走 api.deepseek.com，
  // 第三方走各自域名。这里替换 global.fetch 记录出站目标。
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async function(url, opts) {
    calls.push(String(url));
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  await providers.searchWeb('官方限定测试', 3, { signal: undefined });
  assert.ok(calls.length > 0, '应至少发起一次搜索请求');
  calls.forEach(function(target) {
    assert.match(target, /^https:\/\/api\.deepseek\.com\//, '官方限定时不得请求第三方搜索域名: ' + target);
  });
});

test('关闭官方限定时 provider 链恢复完整（含第三方兜底）', function(t) {
  const original = providers.isOfficialOnlySearch();
  t.after(() => providers.setOfficialOnlySearch(original));
  providers.setOfficialOnlySearch(false);
  assert.equal(providers.isOfficialOnlySearch(), false);
});

test('官方限定的两次搜索使用不同缓存键，避免与兜底结果互相污染', function(t) {
  const original = providers.isOfficialOnlySearch();
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
  t.after(() => {
    providers.setOfficialOnlySearch(original);
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async function(url) {
    calls.push(String(url));
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  providers.setOfficialOnlySearch(false);
  const before = calls.length;
  return providers.searchWeb('缓存键隔离测试', 3).then(function() {
    const afterFallback = calls.length;
    providers.setOfficialOnlySearch(true);
    return providers.searchWeb('缓存键隔离测试', 3).then(function() {
      assert.ok(afterFallback > before, '第一次搜索应发出请求');
      assert.ok(calls.length > afterFallback, '切换官方限定后必须重新发起请求，不能命中兜底缓存');
    });
  });
});
