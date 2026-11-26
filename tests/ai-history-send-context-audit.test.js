'use strict';
// A-H2 回归：小猫 AI 发送只带最近 10 条历史，上下文静默截断。
// 修复前：首屏 loadHistory 只拉 HISTORY_PAGE_SIZE(10) 条，发送时
// buildAiConversationHistory 直接取内存 S.messages，服务端优先用
// 前端传的历史，不会补全。
// 第一轮修复：发送前先分页补齐历史到发送上限（256 条），拉不到也不
// 阻塞发送；仍有更多历史未加载时不静默截断。
// 第二轮修正（点-3）：服务端只用最近 24 条前端历史
// （AI_CHAT_HISTORY_FETCH_BUFFER=24），补到 256 条纯属浪费，25 页
// 串行拉取还拖慢首 token。非托管模式最多补 2 页（首屏 10 + 20，
// 覆盖 24 条历史 + 当前一条），并加 1500ms 总预算；托管模式才保留
// 25 页上限（服务端用到 256 条），预算 5000ms。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('A-H2: 发送前有补齐历史的调用，且在拼装历史之前', () => {
  const callIdx = src.indexOf('await ensureHistoryLoadedForSend(sendSettings.contextManaged)');
  assert.ok(callIdx >= 0, 'handleSendMessage 应调用 ensureHistoryLoadedForSend（传托管标志）');
  const sendIdx = src.indexOf('async function handleSendMessage');
  const histIdx = src.indexOf('buildAiConversationHistory(_ctxCap');
  assert.ok(sendIdx >= 0 && callIdx > sendIdx, '调用应在 handleSendMessage 内');
  assert.ok(histIdx >= 0 && callIdx < histIdx, '补齐应在拼装发送历史之前');
});

test('A-H2/点-3: 补齐函数按 oldestCursor 分页拉取，非托管最多 2 页且有时间预算', () => {
  const defIdx = src.indexOf('async function ensureHistoryLoadedForSend');
  assert.ok(defIdx >= 0, '应定义 ensureHistoryLoadedForSend');
  const body = src.slice(defIdx, defIdx + 2500);
  assert.ok(body.includes('S.hasMore'), '应判断 S.hasMore');
  assert.ok(body.includes('S.oldestCursor'), '应按 oldestCursor 分页');
  assert.ok(body.includes('loadHistory(S.messagesEl, S.oldestCursor)'), '应用 oldestCursor 调 loadHistory');
  assert.ok(/maxPages = contextManaged \? 25 : 2/.test(body), '非托管最多补 2 页，托管才保留 25 页');
  assert.ok(/targetCount = contextManaged \? CONTEXT_LIMIT_NORMAL : 25/.test(body), '非托管补到 25 条即饱和');
  assert.ok(body.includes('deadline'), '应有总时间预算，超时即发不阻塞发送');
  assert.ok(/budgetMs = contextManaged \? 5000 : 1500/.test(body), '非托管预算 1500ms，托管 5000ms');
});

test('A-H2: 补齐失败不阻塞发送', () => {
  const callIdx = src.indexOf('await ensureHistoryLoadedForSend(sendSettings.contextManaged)');
  const around = src.slice(Math.max(0, callIdx - 300), callIdx + 120);
  assert.ok(/try\s*\{\s*await ensureHistoryLoadedForSend\(sendSettings\.contextManaged\)/.test(around), '调用应包在 try 内');
  assert.ok(around.includes('catch'), '失败应被 catch，不阻断发送');
});
