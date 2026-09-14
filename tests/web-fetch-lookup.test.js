/**
 * web-fetch lookup 契约测试
 *
 * 背景（2026-09-13 线上事故）：
 *   read_web_page 工具 100% 失败，统一报「工具暂时出现了故障，无法访问这个链接」。
 *   根因：Node 22 的 net.connect 在 IPv4/IPv6 双栈场景会传 options.all = true，
 *   此时 lookup 回调必须返回**对象数组** [{ address, family }]。而 web-fetch.js
 *   三处 DNS pin 实现都写成 `callback(null, addresses[0], family)` 的单地址形态，
 *   Node 内部读 items[i].address 得到 undefined，抛
 *   "Invalid IP address: undefined"，所有网页读取请求全量失败。
 *
 * 本测试锁定该契约，防止再次回归。
 */
'use strict';

var assert = require('assert');
var net = require('net');

var webFetch = require('../render-api/web-fetch.js');

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, err: e });
    console.log('  ✗ ' + name + '\n      ' + (e && e.message));
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, err: e });
    console.log('  ✗ ' + name + '\n      ' + (e && e.message));
  }
}

console.log('\nweb-fetch DNS pin lookup 契约\n');

// ── 1. 模块导出面 ──────────────────────────────────────────────────────────
test('导出 createPinnedAgent', function() {
  assert.strictEqual(typeof webFetch.createPinnedAgent, 'function');
});

test('导出 assertSafeWebUrl', function() {
  assert.strictEqual(typeof webFetch.assertSafeWebUrl, 'function');
});

// ── 2. createPinnedAgent 的 lookup 行为（核心契约）──────────────────────────
test('createPinnedAgent 空地址数组应抛错', function() {
  assert.throws(function() { webFetch.createPinnedAgent([]); }, /非空/);
});

test('createPinnedAgent 非数组入参应抛错', function() {
  assert.throws(function() { webFetch.createPinnedAgent(null); }, /非空/);
});

test('★ 关键：options.all = true 时必须返回对象数组', function() {
  var agent = webFetch.createPinnedAgent(['93.184.216.34']);
  var lookup = agent.options.lookup;
  assert.strictEqual(typeof lookup, 'function', 'Agent 应暴露 lookup 函数');

  var captured = null;
  lookup('example.com', { all: true, hints: 32 }, function(err, addresses) {
    captured = { err: err, addresses: addresses };
  });

  assert.ok(captured, 'lookup 应同步回调');
  assert.strictEqual(captured.err, null, '不应有错误');
  assert.ok(Array.isArray(captured.addresses), 'all=true 时必须返回数组，否则 Node 抛 Invalid IP address: undefined');
  assert.strictEqual(captured.addresses.length, 1);
  assert.strictEqual(captured.addresses[0].address, '93.184.216.34');
  assert.ok(
    captured.addresses[0].family === 4 || captured.addresses[0].family === 6,
    'family 必须是 4 或 6，实际 ' + captured.addresses[0].family
  );
});

test('★ 关键：options.all 为假时返回单地址形态', function() {
  var agent = webFetch.createPinnedAgent(['93.184.216.34']);
  var capture = { args: null };
  agent.options.lookup('example.com', {}, function(err, address, family) {
    capture.args = [err, address, family];
  });
  assert.ok(capture.args, 'lookup 应同步回调');
  assert.strictEqual(capture.args[0], null);
  assert.strictEqual(capture.args[1], '93.184.216.34');
  assert.strictEqual(capture.args[2], 4);
});

test('lookup 未传 options 时也应可用（返回单地址）', function() {
  var agent = webFetch.createPinnedAgent(['1.1.1.1']);
  var capture = { args: null };
  agent.options.lookup('cloudflare.com', undefined, function(err, address, family) {
    capture.args = [err, address, family];
  });
  assert.ok(capture.args);
  assert.strictEqual(capture.args[1], '1.1.1.1');
  assert.strictEqual(capture.args[2], 4);
});

test('IPv6 地址 family 应识别为 6', function() {
  var agent = webFetch.createPinnedAgent(['2606:4700:4700::1111']);
  var capture = { addresses: null };
  agent.options.lookup('cloudflare.com', { all: true }, function(err, addresses) {
    capture.addresses = addresses;
  });
  assert.ok(Array.isArray(capture.addresses));
  assert.strictEqual(capture.addresses[0].family, 6);
});

test('多地址时 all=true 应全部返回，单地址模式取首个', function() {
  var agent = webFetch.createPinnedAgent(['1.1.1.1', '8.8.8.8', '2606:4700::1111']);
  var multi = null;
  agent.options.lookup('x.com', { all: true }, function(e, a) { multi = a; });
  assert.strictEqual(multi.length, 3);
  assert.deepStrictEqual(multi.map(function(i) { return i.address; }), ['1.1.1.1', '8.8.8.8', '2606:4700::1111']);

  var single = null;
  agent.options.lookup('x.com', {}, function(e, a) { single = a; });
  assert.strictEqual(single, '1.1.1.1');
});

test('返回的 family 值必须能被 net.isIP 验证（与实际地址一致）', function() {
  var agent = webFetch.createPinnedAgent(['93.184.216.34', '2606:4700:4700::1111']);
  var out = null;
  agent.options.lookup('x.com', { all: true }, function(e, a) { out = a; });
  out.forEach(function(item) {
    assert.strictEqual(net.isIP(item.address), item.family, item.address + ' 的 family 标注应与 net.isIP 一致');
  });
});

// ── 3. 真实网络端到端（修复前此用例必失败）──────────────────────────────────
(async function() {
  await testAsync('★ 端到端：fetchSafeWebPage 能真实读取网页（修复前报 Invalid IP address）', async function() {
    var r = await webFetch.fetchSafeWebPage('https://example.com');
    assert.ok(r, '应返回结果对象');
    assert.ok(r.title && r.title.length > 0, '应解析出标题');
    assert.ok(r.bytes > 0, '应读到正文');
  });

  await testAsync('端到端：中文站点读取正常', async function() {
    var r = await webFetch.fetchSafeWebPage('https://www.baidu.com');
    assert.ok(r && r.bytes > 0, '应读到正文');
  });

  await testAsync('端到端：内网地址应被拦截（SSRF 防线未被破坏）', async function() {
    var blocked = false;
    try {
      await webFetch.fetchSafeWebPage('https://127.0.0.1/');
    } catch (e) {
      blocked = true;
    }
    assert.ok(blocked, '内网地址必须被拒绝');
  });

  await testAsync('端到端：assertSafeWebUrl 内网拦截生效', async function() {
    var blocked = false;
    try {
      await webFetch.assertSafeWebUrl('https://169.254.169.254/latest/meta-data/');
    } catch (e) {
      blocked = true;
    }
    assert.ok(blocked, '云元数据地址必须被拒绝');
  });

  console.log('\n────────────────────────────');
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) {
    failures.forEach(function(f) { console.log('  FAILED: ' + f.name); });
    process.exitCode = 1;
  }
})();
