'use strict';
// A-H3 回归：SSE 缓冲溢出静默删整条回复。
// 修复前：单行 >2MB 的事件被 continue 丢掉、未闭合缓冲 >4MB 时 aborted=true，
// 收尾的 aborted 分支直接 assistantNode.remove()，已收到的内容全删且无任何提示。
// 修复后：溢出时记 sseTruncated，收尾保留已收到的内容并追加“内容过长已截断”
// 提示（done/异常收尾两路都挂提示）；无任何已收内容时仍提示后清理。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'ai-agent.css'), 'utf8');

test('A-H3: 溢出两处都标记 sseTruncated，而不是只写 console.warn', () => {
  assert.ok(src.includes('sseTruncated'), '应有 sseTruncated 标记');
  const bufIdx = src.indexOf('SSE buffer overflow');
  assert.ok(bufIdx >= 0, '应有缓冲溢出分支');
  assert.ok(src.slice(bufIdx, bufIdx + 300).includes('sseTruncated = true'), '缓冲溢出时应置 sseTruncated');
  const lineIdx = src.indexOf('oversized SSE line dropped');
  assert.ok(lineIdx >= 0, '应有单行超限分支');
  assert.ok(src.slice(lineIdx, lineIdx + 300).includes('sseTruncated = true'), '单行超限丢弃时应置 sseTruncated');
});

test('A-H3: aborted 收尾分支遇截断且有已收内容时先落定、不直接删节点', () => {
  const branchIdx = src.indexOf("if (((S._currentReqId !== reqId || !customModelIdentityCurrent(sendIdentity)) || aborted) && !_finalized && !turnSettled) {");
  assert.ok(branchIdx >= 0, '应有 aborted 收尾分支');
  const branch = src.slice(branchIdx, branchIdx + 2600);
  assert.ok(branch.includes('sseTruncated'), 'aborted 分支应区分截断溢出');
  assert.ok(branch.includes('finishAiMessage'), '截断且有内容时应先 finishAiMessage 落定已收内容');
  // 落定必须在删除之前：finishAiMessage 在该分支内出现的位置早于 assistantNode.remove()
  assert.ok(branch.indexOf('finishAiMessage') < branch.indexOf('assistantNode.remove()'), '应先落定再（仅无内容时）删节点');
  assert.ok(branch.includes('已截断'), '截断收尾应给用户“已截断”提示');
});

test('A-H3: done/正常收尾也挂截断提示，截断提示有样式', () => {
  assert.ok(src.includes('appendTruncatedNote'), '应有 appendTruncatedNote 挂提示');
  assert.ok(src.includes('内容过长，已截断'), '提示文案应含“内容过长，已截断”');
  assert.ok(css.includes('.ai-truncated-note'), 'css 应有 .ai-truncated-note 样式');
});
