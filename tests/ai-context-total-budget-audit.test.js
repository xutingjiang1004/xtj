'use strict';
// D-H2 回归：思考 Max 上下文无总上限（理论 65M 字符）。
// 修复前：buildAiConversationHistory 只有单条截断（32000 字）和 68MB
//   附件预算，没有历史总字符上限——2048 条 × 32000 字理论可达 65M 字符，
//   远超服务端 80MB JSON 上限与模型上下文窗口。
// 修复后：历史总字符预算 HISTORY_TOTAL_CHARS_MAX = 2000000（普通模式
//   上限 256 条 × 4000 字 ≈ 102 万字不受影响；中文 2M 字约 6MB，
//   远低于 80MB 服务端上限）。超预算时从最旧的轮次开始丢弃，最新轮次
//   优先保留，最旧的保留轮次标记 context_truncated。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const aiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

function buildHistoryFn() {
  const helperStart = aiSource.indexOf('function stripAiHistoryAttachmentData');
  const helperEnd = aiSource.indexOf('function setAiHistoryCache', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'AI history helpers are present');
  const context = vm.createContext({ Date, S: { messages: [] }, CONTEXT_LIMIT_NORMAL: 256, MSG_MAX_CHARS_NORMAL: 4000, HISTORY_TOTAL_CHARS_MAX: 2000000 });
  vm.runInContext(aiSource.slice(helperStart, helperEnd) + '\nglobalThis.buildHistory = buildAiConversationHistory;', context);
  return context;
}

test('D-H2: 历史总字符预算常量存在且远低于 80MB 服务端上限', () => {
  const m = aiSource.match(/var HISTORY_TOTAL_CHARS_MAX = (\d+);/);
  assert.ok(m, '应定义 HISTORY_TOTAL_CHARS_MAX');
  assert.equal(Number(m[1]), 2000000, '总预算应为 2000000 字符（中文约 6MB，远低于 80MB）');
  const fnIdx = aiSource.indexOf('function buildAiConversationHistory(');
  assert.ok(fnIdx >= 0, '应有 buildAiConversationHistory');
  const fnBody = aiSource.slice(fnIdx, aiSource.indexOf('\n  function normalizeAiHistoryMatchContent', fnIdx));
  assert.ok(fnBody.includes('HISTORY_TOTAL_CHARS_MAX'), '拼装函数应用总预算');
  assert.ok(fnBody.includes('context_truncated'), '超预算丢弃时应标记截断');
});

test('D-H2: 思考 Max 下 2048 条长消息被总预算封顶，最新轮次优先保留', () => {
  const ctx = buildHistoryFn();
  const msgs = [];
  for (let i = 0; i < 100; i++) {
    msgs.push({ role: i % 2 ? 'assistant' : 'user', content: '第' + i + '轮' + 'x'.repeat(32000), created_at: '2026-11-26T00:00:00.000Z' });
  }
  ctx.S.messages = msgs;
  const result = ctx.buildHistory(2048, 32000, null, []);
  const total = result.reduce((n, e) => n + String(e.content || '').length, 0);
  assert.ok(total <= 2000000, '历史总字符不应超过 2000000，实际 ' + total);
  assert.ok(result.length < 100, '超预算时应丢弃最旧轮次，实际保留 ' + result.length + ' 条');
  assert.ok(result[result.length - 1].content.includes('第99轮'), '最新轮次应保留');
  assert.ok(!result.some(e => String(e.content || '').includes('第0轮')), '最旧轮次应被丢弃');
  assert.equal(result[0].context_truncated, true, '最旧的保留轮次应标记 context_truncated');
});

test('D-H2: 普通短历史不受总预算影响，不标记截断', () => {
  const ctx = buildHistoryFn();
  ctx.S.messages = [
    { role: 'user', content: '你好', created_at: '2026-11-26T00:00:00.000Z' },
    { role: 'assistant', content: '你好呀', created_at: '2026-11-26T00:00:01.000Z' }
  ];
  const result = ctx.buildHistory(256, 4000, null, []);
  assert.equal(result.length, 2);
  assert.equal(result[0].content, '你好');
  assert.equal(result[1].content, '你好呀');
  assert.equal(result[0].context_truncated, undefined, '未超预算不应标记截断');
});
