'use strict';
// D-M2 回归：四处长度校验文案漂移（只统一文案，不合并发送入口）。
// 修复前：text.length > 50000 在 4 处，其中深入研究页 dtDoSend 的提示缺
//   「请精简后重试」；其余三处（研究页发送、主聊天发送两次刻意重查）文案一致。
// 修复后：四处提示统一为「消息过长，最多 50000 字符，请精简后重试」。
// 不合并入口：dtDoSend 只是调 handleDeepThinkPageSend 的薄包装，
//   主聊天内的两次检查是附件展开前后的刻意重查。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('D-M2: 四处 50000 字符校验的提示文案完全一致', () => {
  // 只数紧跟 text.length > 50000 校验的提示：D-M3 的粘贴提示复用同一文案，
  // 不属于四处发送校验，不计入。
  const checks = Array.from(src.matchAll(/text\.length > 50000/g));
  assert.equal(checks.length, 4, '应有 4 处 50000 字符校验，实得 ' + checks.length + ' 处');
  checks.forEach(function(m) {
    const near = src.slice(m.index, m.index + 200);
    assert.ok(near.includes('消息过长，最多 50000 字符，请精简后重试'),
      '每处校验后的提示都应统一含「请精简后重试」，附近文案：' + near.slice(0, 120));
  });
});

test('D-M2: 不合并发送入口——薄包装与刻意重查都在', () => {
  assert.ok(src.includes('function dtDoSend()'), 'dtDoSend 薄包装应保留');
  const fnIdx = src.indexOf('async function handleSendMessage(');
  const fnEnd = src.indexOf('function buildHistoryLoadingState', fnIdx);
  const fnSrc = src.slice(fnIdx, fnEnd);
  const inFn = (fnSrc.match(/text\.length > 50000/g) || []).length;
  assert.equal(inFn, 2, '主聊天函数内两次检查（附件展开前后刻意重查）应保留，实得 ' + inFn + ' 处');
});
