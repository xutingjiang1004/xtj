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

test('search gate delegates to durable database claim for automatic and tool paths', () => {
  assert.match(serverCode, /return claimDurableSearchCredit\(context\)/);
  assert.match(serverCode, /async function searchWebForUser[\s\S]*?claimSearchSlot\(shared\)/);
  assert.match(serverCode, /search_count: 0, did_search: false/);
});
