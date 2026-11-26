'use strict';
// A-H2 回归：小猫 AI 发送只带最近 10 条历史，上下文静默截断。
// 修复前：首屏 loadHistory 只拉 HISTORY_PAGE_SIZE(10) 条，发送时
// buildAiConversationHistory 直接取内存 S.messages，服务端优先用
// 前端传的历史，不会补全。
// 修复后：发送前先分页补齐历史到发送上限（256 条），拉不到也不
// 阻塞发送；仍有更多历史未加载时不静默截断。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('A-H2: 发送前有补齐历史的调用，且在拼装历史之前', () => {
  const callIdx = src.indexOf('await ensureHistoryLoadedForSend()');
  assert.ok(callIdx >= 0, 'handleSendMessage 应调用 ensureHistoryLoadedForSend');
  const sendIdx = src.indexOf('async function handleSendMessage');
  const histIdx = src.indexOf('buildAiConversationHistory(_ctxCap');
  assert.ok(sendIdx >= 0 && callIdx > sendIdx, '调用应在 handleSendMessage 内');
  assert.ok(histIdx >= 0 && callIdx < histIdx, '补齐应在拼装发送历史之前');
});

test('A-H2: 补齐函数只在有更多历史时分页拉取，并有上限', () => {
  const defIdx = src.indexOf('async function ensureHistoryLoadedForSend');
  assert.ok(defIdx >= 0, '应定义 ensureHistoryLoadedForSend');
  const body = src.slice(defIdx, defIdx + 2000);
  assert.ok(body.includes('S.hasMore'), '应判断 S.hasMore');
  assert.ok(body.includes('S.oldestCursor'), '应按 oldestCursor 分页');
  assert.ok(body.includes('loadHistory(S.messagesEl, S.oldestCursor)'), '应用 oldestCursor 调 loadHistory');
  assert.ok(body.includes('CONTEXT_LIMIT_NORMAL'), '补齐应以发送上限（256 条）为界');
  assert.ok(/maxPages\s*=\s*25/.test(body), '应有分页次数上限，避免无限拉取');
});

test('A-H2: 补齐失败不阻塞发送', () => {
  const callIdx = src.indexOf('await ensureHistoryLoadedForSend()');
  const around = src.slice(Math.max(0, callIdx - 300), callIdx + 120);
  assert.ok(/try\s*\{\s*await ensureHistoryLoadedForSend\(\)/.test(around), '调用应包在 try 内');
  assert.ok(around.includes('catch'), '失败应被 catch，不阻断发送');
});
