'use strict';
// A-H1 回归：小猫 AI 超时看门狗基本失效 + 30 分钟绝对超时。
// 修复前：1800000ms（30 分钟）绝对超时；看门狗每次 chunk 到达就刷新，
// 服务端每 2.5s 的心跳让它永不触发；首包阈值 120s 与注释 45s 不符。
// 修复后：绝对超时统一 300000ms（300s）；只有有意义的 SSE 事件才刷新
// 看门狗，心跳/原始 chunk 不算；首包 45s、收到数据后 120s。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('A-H1: 绝对超时统一为 300s，不再有 1800000ms', () => {
  assert.equal((src.match(/1800000/g) || []).length, 0, 'js/ai-agent.js 不应再含 1800000');
  assert.ok(/timeoutMs:\s*300000/.test(src), 'sharedCtrl timeoutMs 应为 300000');
  assert.ok(/timeout_ms:\s*300000/.test(src), '请求体 timeout_ms 应为 300000');
  const dtIdx = src.indexOf('dtFetchTimeoutTimer = setTimeout(');
  assert.ok(dtIdx >= 0, '应有 dtFetchTimeoutTimer');
  assert.ok(src.slice(dtIdx, dtIdx + 400).includes('}, 300000);'), '深页绝对超时应为 300000');
});

test('A-H1: 看门狗阈值与注释一致（首包 45s、收到数据后 120s）', () => {
  const m = src.match(/var idleThreshold = _receivedAny \? (\d+) : (\d+);/);
  assert.ok(m, '应有 idleThreshold 定义');
  assert.equal(m[1], '120000');
  assert.equal(m[2], '45000');
});

test('A-H1: 只有非心跳的有意义事件才刷新 _lastDataTime', () => {
  // 原始 chunk 到达处不得再刷新看门狗
  const chunkRefresh = src.match(/buffer = lines\.pop\(\) \|\| '';\s*\n(?:[^\n]*\n){0,8}?_lastDataTime = Date\.now\(\);/);
  assert.equal(chunkRefresh, null, 'chunk 到达后不应刷新 _lastDataTime');
  // 刷新必须以 evt.type !== heartbeat 为条件
  assert.ok(/if \(evt\.type !== 'heartbeat'\) \{\s*_lastDataTime = Date\.now\(\);\s*_receivedAny = true;\s*\}/.test(src), '应有“非心跳事件才刷新看门狗”的守卫');
});
