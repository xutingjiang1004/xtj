'use strict';
// A-H4 回归：search_supplement 只清 UI 不清存档，显示与保存不一致。
// 修复前：supplement 分支只清 assistantBubble/aiContent/doneReceived，
// 已封存的第一轮正文（sealedContents）仍会在 finishAiMessage 里
// 存进历史，而屏幕上只有第二轮；answerCommitted /
// _thinkingSettledOnContent 也未复位，第二轮按旧轮次状态走。
// 修复后：supplement 分支同时清空已封存正文（并摘掉已封存的气泡段）、
// 复位 answerCommitted 与 _thinkingSettledOnContent，第二轮按新轮次走。
// 注意：aiReasoning 不清——分支注释明确“保留已显示的思考过程”，
// 思考面板仍显示第一轮思考，存档的 reasoning 累积值与显示一致；
// 清掉它还会打断 railReasonCursor 的游标。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

function supplementBranch() {
  const idx = src.indexOf("if (evt.type === 'search_supplement')");
  assert.ok(idx >= 0, '应有 search_supplement 分支');
  return src.slice(idx, idx + 1500);
}

test('A-H4: supplement 分支清空已封存的第一轮正文', () => {
  const branch = supplementBranch();
  assert.ok(/sealedContents\.length\s*=\s*0/.test(branch), '应清空 sealedContents');
});

test('A-H4: supplement 分支摘掉屏幕上已封存的气泡段，与存档一致', () => {
  const branch = supplementBranch();
  assert.ok(branch.includes('.ai-content-segment'), '应处理已封存的气泡段');
  assert.ok(/\.remove\(\)/.test(branch), '应把已封存的气泡段移出 DOM');
});

test('A-H4: supplement 分支复位第二轮的状态标志', () => {
  const branch = supplementBranch();
  assert.ok(/answerCommitted\s*=\s*false/.test(branch), '应复位 answerCommitted');
  assert.ok(/_thinkingSettledOnContent\s*=\s*false/.test(branch), '应复位 _thinkingSettledOnContent');
});

test('A-H4: 思考过程仍保留（aiReasoning 不在 supplement 分支被清空）', () => {
  const branch = supplementBranch();
  assert.ok(!/aiReasoning\s*=/.test(branch), '不应清空 aiReasoning（思考面板仍显示第一轮）');
});
