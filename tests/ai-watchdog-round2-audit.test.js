'use strict';
// 第二轮审计 点-2 回归：前端绝对超时不得短于服务端允许值。
// 上一轮把前端三处绝对超时从 1800000ms 砍到 300000ms，而服务端
// callDeepSeek 的 TOTAL_TIMEOUT_MS 与 deep-stream 的默认/上限一直是
// 1800000ms，导致超过 5 分钟的正常长思考被前端提前掐断。
// 本测试锁住前后端超时一致：前端三处绝对超时、服务端 TOTAL_TIMEOUT_MS、
// deep-stream 的 timeout_ms 默认/上限必须同为 1800000ms。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('点-2: 前端三处绝对超时均为 1800000ms', () => {
  assert.ok(/timeoutMs:\s*1800000/.test(agentSrc), 'sharedCtrl timeoutMs 应为 1800000');
  assert.ok(/timeout_ms:\s*1800000/.test(agentSrc), '请求体 timeout_ms 应为 1800000');
  const dtIdx = agentSrc.indexOf('dtFetchTimeoutTimer = setTimeout(');
  assert.ok(dtIdx >= 0, '应有 dtFetchTimeoutTimer');
  assert.ok(agentSrc.slice(dtIdx, dtIdx + 400).includes('}, 1800000);'), '深页绝对超时应为 1800000');
});

test('点-2: 服务端 TOTAL_TIMEOUT_MS 与 deep-stream 上限同为 1800000ms', () => {
  assert.ok(/var TOTAL_TIMEOUT_MS = 1800000/.test(serverSrc), '服务端 TOTAL_TIMEOUT_MS 应为 1800000');
  assert.ok(/Math\.min\(Number\(body\.timeout_ms\) \|\| 1800000, 1800000\)/.test(serverSrc),
    'deep-stream 的 timeout_ms 默认/上限应为 1800000');
});

test('点-2: idle 看门狗仍比绝对超时严格，且心跳不刷新', () => {
  const m = agentSrc.match(/var idleThreshold = _receivedAny \? (\d+) : (\d+);/);
  assert.ok(m, '应有 idleThreshold 定义');
  assert.ok(Number(m[1]) < 1800000 && Number(m[2]) < 1800000, 'idle 阈值必须小于绝对超时');
  assert.ok(/if \(evt\.type !== 'heartbeat'\) \{\s*_lastDataTime = Date\.now\(\);/.test(agentSrc),
    '心跳事件不得刷新 _lastDataTime');
});
