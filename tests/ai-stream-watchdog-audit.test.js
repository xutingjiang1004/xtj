'use strict';
// A-H1 回归 + 第二轮（点-2）修正：小猫 AI 超时看门狗基本失效 + 30 分钟绝对超时。
// 修复前：1800000ms（30 分钟）绝对超时；看门狗每次 chunk 到达就刷新，
// 服务端每 2.5s 的心跳让它永不触发；首包阈值 120s 与注释 45s 不符。
// 第一轮修复：绝对超时统一 300000ms（300s）；只有有意义的 SSE 事件才刷新
// 看门狗，心跳/原始 chunk 不算；首包 45s、收到数据后 120s。
// 第二轮修正（点-2）：300s 绝对超时会掐断超过 5 分钟的正常长思考（服务端
// callDeepSeek 的 TOTAL_TIMEOUT_MS 仍是 1800000ms，deep-stream 默认/上限
// 也是 1800000ms），且 120s idle 会误杀长时间静默思考。改回 1800000ms
// 绝对超时；idle 放宽为首包 120s、收到数据后 300s。心跳不刷新看门狗
// 这一核心修复保留不变。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('A-H1/点-2: 绝对超时为 1800s，与服务端 TOTAL_TIMEOUT_MS 对齐', () => {
  assert.ok(/timeoutMs:\s*1800000/.test(src), 'sharedCtrl timeoutMs 应为 1800000');
  assert.ok(/timeout_ms:\s*1800000/.test(src), '请求体 timeout_ms 应为 1800000');
  const dtIdx = src.indexOf('dtFetchTimeoutTimer = setTimeout(');
  assert.ok(dtIdx >= 0, '应有 dtFetchTimeoutTimer');
  assert.ok(src.slice(dtIdx, dtIdx + 400).includes('}, 1800000);'), '深页绝对超时应为 1800000');
  // 三处绝对超时都不许再是 300s（上一轮的回归值）
  assert.ok(!/timeoutMs:\s*300000/.test(src), 'sharedCtrl timeoutMs 不得再是 300000');
  assert.ok(!/timeout_ms:\s*300000/.test(src), '请求体 timeout_ms 不得再是 300000');
});

test('A-H1/点-2: 看门狗阈值（首包 120s、收到数据后 300s）', () => {
  const m = src.match(/var idleThreshold = _receivedAny \? (\d+) : (\d+);/);
  assert.ok(m, '应有 idleThreshold 定义');
  assert.equal(m[1], '300000');
  assert.equal(m[2], '120000');
});

test('A-H1: 只有非心跳的有意义事件才刷新 _lastDataTime', () => {
  // 原始 chunk 到达处不得再刷新看门狗
  const chunkRefresh = src.match(/buffer = lines\.pop\(\) \|\| '';\s*\n(?:[^\n]*\n){0,8}?_lastDataTime = Date\.now\(\);/);
  assert.equal(chunkRefresh, null, 'chunk 到达后不应刷新 _lastDataTime');
  // 刷新必须以 evt.type !== heartbeat 为条件
  assert.ok(/if \(evt\.type !== 'heartbeat'\) \{\s*_lastDataTime = Date\.now\(\);\s*_receivedAny = true;\s*\}/.test(src), '应有“非心跳事件才刷新看门狗”的守卫');
});
