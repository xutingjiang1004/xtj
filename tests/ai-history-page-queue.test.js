'use strict';
// A-L1 回归：历史分页边沿触发、加载中不补拉。
// 修复前：只有 scroll 事件且 scrollTop<60 才调 loadHistory；加载中收到新的
//   上翻请求时 loadHistory 入口直接 return、无排队，用户必须再滚一次才补拉。
// 修复后：(1) 滚动时若正在加载，记 S._historyPagePending 待处理标志，
//   loadHistory 的 finally 里消费它并补拉一次；(2) 分页加载完成后若仍在
//   顶部（scrollTop<60）且 hasMore、有新内容返回，自动续拉一页——锚点
//   回调会把 scrollTop 抬到旧位置+新增高度，链条自然停止，不会一次拉全量。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('A-L1: S 状态里有历史分页待处理标志', () => {
  assert.ok(src.includes('_historyPagePending: false'), 'S 应定义 _historyPagePending: false');
});

test('A-L1: 滚动到顶部时加载中不再丢弃请求，而是记待处理标志', () => {
  const scrollIdx = src.indexOf("if (messagesEl.scrollTop < 60 && S.hasMore && !S.loading && !S.loadingMore && S.oldestCursor) {");
  assert.ok(scrollIdx < 0, '旧的“加载中直接不触发”判断应被改写');
  const setIdx = src.indexOf('S._historyPagePending = true');
  assert.ok(setIdx >= 0, '加载中收到上翻请求时应记 S._historyPagePending = true');
  const branch = src.slice(setIdx - 400, setIdx + 100);
  assert.ok(branch.includes('scrollTop < 60'), '记标志的分支仍以 scrollTop<60 为触发条件');
  assert.ok(branch.includes('S.loading') && branch.includes('S.loadingMore'), '记标志的分支应只在加载中时走');
});

test('A-L1: loadHistory 收尾消费待处理标志并补拉，加载完仍在顶部自动续拉一页', () => {
  const fnIdx = src.indexOf('async function loadHistory(');
  assert.ok(fnIdx >= 0, '应有 loadHistory');
  const fnSrc = src.slice(fnIdx, fnIdx + 12000);
  const finIdx = fnSrc.indexOf('S.loading = false;');
  assert.ok(finIdx >= 0, 'loadHistory finally 应复位 S.loading');
  const tail = fnSrc.slice(finIdx, finIdx + 1200);
  assert.ok(tail.includes('S._historyPagePending = false'), '收尾应先清除待处理标志再补拉（避免重复触发）');
  assert.ok(tail.includes('loadHistory(messagesEl, S.oldestCursor)'), '收尾满足条件时应补拉一页');
  assert.ok(tail.includes('scrollTop < 60'), '补拉应要求仍在顶部');
  assert.ok(tail.includes('S.hasMore'), '补拉应要求还有更多历史');
  assert.ok(tail.includes('msgs') && tail.includes('length'), '自动续拉应要求本页确实返回了新内容（保证有进展，不空转）');
});

test('A-L1: loadHistory 入口仍拒绝并发加载，排队只走标志', () => {
  const fnIdx = src.indexOf('async function loadHistory(');
  const head = src.slice(fnIdx, fnIdx + 400);
  assert.ok(head.includes('if (S.loading || S.loadingMore) return;'), '入口仍应直接拒绝并发加载，不在入口里递归');
});
