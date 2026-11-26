'use strict';
// D-L2 回归：配额缓存窗口三处不一致。
// 修复前：fetchAiQuota 内 20000ms（inflight 复用）/15000ms（缓存直返）
//   两档，轮询 QUOTA_POLL_MS=30000，边界处可能多拉一次或短暂显示旧额度。
// 修复后：统一常量 AI_QUOTA_CACHE_MS = 20000ms，三处（两档缓存判定 +
//   inflight 去重 + 轮询间隔）都用它。取 20000ms 的理由：三处已有两处
//   用它，只改动两处；轮询由 30s 加密到 20s，额度显示最多滞后 20s、
//   更及时，/quota 是轻量 GET；缓存窗口 15s→20s，与轮询周期对齐，
//   轮询到达时缓存刚过期、恰好拉新。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('D-L2: 有统一的配额缓存常量 20000ms，旧的三档常量消失', () => {
  const m = src.match(/var AI_QUOTA_CACHE_MS = (\d+);/);
  assert.ok(m, '应定义 AI_QUOTA_CACHE_MS');
  assert.equal(Number(m[1]), 20000, '统一值应为 20000ms，实得 ' + m[1] + 'ms');
  assert.ok(!src.includes('QUOTA_POLL_MS'), '旧的 QUOTA_POLL_MS 常量应被统一常量取代，不留两套');
});

test('D-L2: fetchAiQuota 的三处窗口判定都用统一常量', () => {
  const fnIdx = src.indexOf('async function fetchAiQuota(');
  assert.ok(fnIdx >= 0, '应有 fetchAiQuota');
  const fnEnd = src.indexOf('function startQuotaPolling(', fnIdx);
  const body = src.slice(fnIdx, fnEnd);
  const uses = (body.match(/AI_QUOTA_CACHE_MS/g) || []).length;
  assert.ok(uses >= 3, 'fetchAiQuota 内三处窗口判定（inflight 复用、缓存直返、inflight 去重）都应用统一常量，实得 ' + uses + ' 处');
  assert.ok(!/15000|30000/.test(body), 'fetchAiQuota 内不应再有 15000/30000 字面窗口值');
  assert.ok(body.includes('if (!force && S.quota'), 'force 直通逻辑应保留');
  assert.ok(body.includes('applyQuota('), '拉到额度后仍应 applyQuota');
});

test('D-L2: 轮询间隔也用统一常量，注释里的轮询周期同步', () => {
  const pollIdx = src.indexOf('function startQuotaPolling(');
  const pollBody = src.slice(pollIdx, pollIdx + 400);
  assert.ok(pollBody.includes('AI_QUOTA_CACHE_MS'), '轮询 setInterval 应以统一常量为间隔');
  assert.ok(!src.includes('前端 90s 轮询'), '额度注释里错误的 90s 轮询说法应随间隔统一同步修正');
});
