'use strict';

// P1-9 审计回归：搜索配额「超发窗口」。
//
// 背景：搜索额度门禁 measureSearchQuota 内部有一次 Supabase RPC 往返（I/O）。
// 旧代码顺序是「await 门禁 → 通过后才 searchConsumed++」，于是同一请求内并发
// 发起的 N 个搜索工具调用会在 RPC 返回前读到同一个旧计数，全部判定为未超额，
// 一次性打穿用户当日额度。修复方式是乐观预占（claimSearchSlot）：先加一，
// 门禁拒绝再回滚。本文件既做静态契约检查，也把 claimSearchSlot 抽出来做
// 真实并发行为验证。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
// 去掉整行注释后再做"禁止出现"的断言（注释里会引用被废弃的旧写法）。
const serverCode = serverSrc.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');

// 从源码里抽出 claimSearchSlot，注入一个可控的 measureSearchQuota 后真实执行。
function loadClaimSearchSlot() {
  const start = serverSrc.indexOf('async function claimSearchSlot(context) {');
  assert.ok(start >= 0, 'claimSearchSlot must exist in render-api/server.js');
  const end = serverSrc.indexOf('\n}\n', start);
  assert.ok(end > start, 'claimSearchSlot must be a complete function');
  const src = serverSrc.slice(start, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function('measureSearchQuota', src + '\nreturn claimSearchSlot;');
}

test('P1-9: no gate site reads searchConsumed before claiming it', () => {
  // 旧写法：await measureSearchQuota(...) 之后才 ++ —— 已被 claimSearchSlot 取代。
  assert.doesNotMatch(serverCode, /measureSearchQuota\(context\.userName,\s*context\.searchConsumed\)/,
    'gate must not read context.searchConsumed directly; use claimSearchSlot');
  assert.doesNotMatch(serverCode, /measureSearchQuota\(req\.userName,\s*searchCount\)/,
    'deep-research workers must not read a bare searchCount counter');
});

test('P1-9: every tool-call site shares a request-scoped quota context', () => {
  // `executeToolCall(x, { userName })` 每次新建对象 → searchConsumed 恒为 0。
  assert.doesNotMatch(serverCode, /executeToolCall\([A-Za-z_$][\w$]*,\s*\{\s*userName:/,
    'executeToolCall must receive a shared request context, not a fresh object literal');
  assert.ok(/function requestSearchCtx\(req, userName\)/.test(serverSrc),
    'requestSearchCtx helper must exist');
  assert.match(serverCode, /executeToolCall\(tc, requestSearchCtx\(req, userName\)\)/);
  assert.match(serverCode, /executeToolCall\(toolCall, requestSearchCtx\(req, userName\)\)/);
});

test('P1-9: parallel deep-think workers share one quota context', () => {
  // buildToolExecutor 需要接收共享 context，否则每个 worker / 每次工具调用都从 0 开始。
  assert.match(serverSrc, /function buildToolExecutor\(sseSend, agentRole, sourcesAccum, queriesAccum, searchCountAccum, userName, sharedSearchCtx\)/);
  assert.match(serverCode, /buildToolExecutor\(sseSend, agent\.role, sources, queries, searchCountAccum, userName, searchCtx\)/);
  assert.match(serverCode, /buildToolExecutor\(sseSend, 'AI 智能体', sources, searchQueries, searchCountAccum, userName, mainSearchCtx\)/);
  // 共享槽由 runMultiAgentFlow 创建并下发给每个 worker。
  assert.match(serverCode, /var sharedSearchCtx = \{ userName: userName \|\| '', searchConsumed: 0 \}/);
  assert.match(serverCode, /searchCtx: sharedSearchCtx,/);
  assert.match(serverCode, /var searchCtx = opts\.searchCtx \|\|/);
});

test('P1-9: claimSearchSlot increments before awaiting the gate', () => {
  const fn = loadClaimSearchSlot();
  let observedDuringGate = null;
  const measure = async (userName, used) => {
    // 门禁执行期间观察调用方传入的"已用次数"
    observedDuringGate = used;
    await new Promise((r) => setImmediate(r)); // 模拟 RPC 往返
    return { allowed: used < 2, reason: used < 2 ? null : 'search_limit', quota: null, degraded: false };
  };
  const claim = fn(measure);
  const ctx = { userName: 'alice', searchConsumed: 0 };
  const gate = claim(ctx);
  // 关键：await 之前计数就必须已经 +1，否则并发调用会读到同一个旧值。
  assert.equal(ctx.searchConsumed, 1, 'slot must be claimed synchronously before the gate resolves');
  return gate.then((g) => {
    assert.equal(observedDuringGate, 0, 'gate must be asked about the pre-claim usage');
    assert.equal(g.allowed, true);
    assert.equal(ctx.searchConsumed, 1, 'allowed claim stays counted');
  });
});

test('P1-9: denied claims are rolled back', async () => {
  const fn = loadClaimSearchSlot();
  const measure = async (userName, used) => ({ allowed: false, reason: 'search_limit', quota: null, degraded: false });
  const claim = fn(measure);
  const ctx = { userName: 'alice', searchConsumed: 3 };
  const g = await claim(ctx);
  assert.equal(g.allowed, false);
  assert.equal(ctx.searchConsumed, 3, 'a denied search must not consume a slot');
});

test('P1-9: concurrent searches cannot overspend the quota', async () => {
  const fn = loadClaimSearchSlot();
  const REMAINING = 3;
  // 模拟 RPC 往返：故意把 await 拉长，放大旧实现的竞态窗口。
  const measure = async (userName, used) => {
    await new Promise((r) => setTimeout(r, 5));
    return {
      allowed: (REMAINING - used) > 0,
      reason: (REMAINING - used) > 0 ? null : 'search_limit',
      quota: { search_remaining: REMAINING },
      degraded: false
    };
  };
  const claim = fn(measure);
  const ctx = { userName: 'bob', searchConsumed: 0 };

  // 8 个并发搜索抢 3 个额度
  const gates = await Promise.all(Array.from({ length: 8 }, () => claim(ctx)));
  const allowed = gates.filter((g) => g && g.allowed).length;

  assert.equal(allowed, REMAINING, 'exactly the remaining quota may pass, even under concurrency');
  assert.equal(ctx.searchConsumed, REMAINING, 'counter reflects only the allowed searches');
});

test('P1-9: fail-open path still counts the claimed slot', async () => {
  const fn = loadClaimSearchSlot();
  // 配额服务不可用 + fail-open → allowed=true，本次真实发起了搜索，必须计入。
  const measure = async () => ({ allowed: true, reason: null, quota: null, degraded: true });
  const claim = fn(measure);
  const ctx = { userName: 'carol', searchConsumed: 0 };
  const g = await claim(ctx);
  assert.equal(g.allowed, true);
  assert.equal(g.degraded, true);
  assert.equal(ctx.searchConsumed, 1);
});

test('P1-9: a missing context degrades safely instead of throwing', async () => {
  const fn = loadClaimSearchSlot();
  const measure = async (userName) => ({ allowed: false, reason: 'no_user', quota: null, degraded: false });
  const claim = fn(measure);
  const g = await claim(null);
  assert.equal(g.allowed, false, 'null context must fall back to a denied gate, not throw');
});
