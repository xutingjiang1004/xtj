'use strict';
// 第二轮审计 点-3 回归：发送前补历史不得超过服务端实际会用的量。
// 服务端 loadAiContext 只取前端历史的最近 AI_CHAT_HISTORY_FETCH_BUFFER 条
// （24 条），上一轮补到 256 条（最多 25 页串行拉取）纯属浪费，还拖慢首 token。
// 本测试锁住前后端一致：服务端取 24 条，前端非托管模式补到 25 条
// （24 条历史 + 当前一条）即停，最多 2 页、1500ms 预算。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('点-3: 服务端只用最近 24 条前端历史', () => {
  const m = serverSrc.match(/const AI_CHAT_HISTORY_FETCH_BUFFER = (\d+);/);
  assert.ok(m, '服务端应定义 AI_CHAT_HISTORY_FETCH_BUFFER');
  assert.equal(m[1], '24');
  assert.ok(serverSrc.includes('clientRows.slice(historyOptions && historyOptions.contextManagement ? -256 : -AI_CHAT_HISTORY_FETCH_BUFFER)'),
    '非托管模式服务端应只取最近 24 条');
});

test('点-3: 前端非托管补历史的目标与服务端取用量一致', () => {
  const defIdx = agentSrc.indexOf('async function ensureHistoryLoadedForSend');
  assert.ok(defIdx >= 0, '应定义 ensureHistoryLoadedForSend');
  const body = agentSrc.slice(defIdx, defIdx + 2500);
  // 25 = 服务端 24 条 + S.messages 里已含的当前一条用户消息
  assert.ok(/targetCount = contextManaged \? CONTEXT_LIMIT_NORMAL : 25/.test(body),
    '非托管目标应为 25 条（24 历史 + 当前一条）');
  assert.ok(/maxPages = contextManaged \? 25 : 2/.test(body), '非托管最多 2 页');
  assert.ok(/budgetMs = contextManaged \? 5000 : 1500/.test(body), '应有时间预算');
  // 不得再有无预算的 25 页全量补齐
  assert.ok(!/var maxPages = 25;/.test(body), '不得再有无条件 25 页补齐');
});
