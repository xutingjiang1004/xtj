'use strict';
// D-M5 回归：历史缓存无 TTL。
// 修复前：setAiHistoryCache 写 cached_at: Date.now()，getAiHistoryCache
//   原样返回，全文件没有任何读 cached_at 做过期判断的地方——旧缓存无限期
//   用于首屏绘制。
// 修复后：getAiHistoryCache 里超过 30 分钟的缓存视为过期，返回 null，改走
//   服务端历史。只存 6 轮（刻意体积保护）与先画缓存（刻意首屏优化）不动。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('D-M5: 有 30 分钟历史缓存 TTL 常量', () => {
  const m = src.match(/var AI_HISTORY_CACHE_TTL_MS = ([^;]+);/);
  assert.ok(m, '应定义 AI_HISTORY_CACHE_TTL_MS');
  assert.ok(m[1].includes('30 * 60 * 1000') || Number(m[1]) === 1800000,
    'TTL 应为 30 分钟（1800000ms），实得 ' + m[1]);
});

test('D-M5: getAiHistoryCache 读 cached_at 做过期判断，过期返回 null', () => {
  const fnIdx = src.indexOf('function getAiHistoryCache(');
  assert.ok(fnIdx >= 0, '应有 getAiHistoryCache');
  const body = src.slice(fnIdx, fnIdx + 1500);
  assert.ok(body.includes('cached_at'), '读取口应读 cached_at');
  assert.ok(body.includes('AI_HISTORY_CACHE_TTL_MS'), '读取口应用 TTL 常量判定');
  assert.ok(body.includes('return null'), '过期缓存应返回 null（视为无缓存）');
  const checkIdx = body.indexOf('AI_HISTORY_CACHE_TTL_MS');
  const retIdx = body.indexOf('return { conversation_id:');
  assert.ok(checkIdx >= 0 && checkIdx < retIdx, '过期判断应在返回缓存之前');
});

test('D-M5: 只存 6 轮与先画缓存的刻意设计不动', () => {
  assert.ok(src.includes('extractCompleteTurns(msgs, 6)') || src.includes('extractCompleteTurns(rawMsgs, 6)'),
    '只存 6 轮的体积保护应保留');
  assert.ok(src.includes('paintCachedHistory(r.messagesEl, openingCache.messages)'),
    '打开先画缓存的首屏优化应保留');
  assert.ok(src.includes('cached_at: Date.now()'), '写入时仍应写 cached_at');
});
