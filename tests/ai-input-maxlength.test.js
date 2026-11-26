'use strict';
// D-M3 回归：主输入框无 maxlength。
// 修复前：创建 aiChatMsgInput 的 textarea 时无 maxlength，只有发送时才有
//   50000 校验，超长粘贴先卡 UI、发送时才被拒。
// 修复后：输入框加 maxlength=50000，与发送时校验一致；粘贴超长时给一次
//   提示（按“从未满到满”的跨越判断，不静默截断无提示，也不在每次粘贴时重复刷屏）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const inputIdx = src.indexOf("id: 'aiChatMsgInput'");
assert.ok(inputIdx >= 0, '应有 aiChatMsgInput 创建处');

test('D-M3: 主输入框有 maxlength=50000，与发送校验一致', () => {
  const creation = src.slice(inputIdx - 400, inputIdx + 400);
  assert.ok(creation.includes("maxlength: '50000'") || creation.includes('maxlength: "50000"'),
    'aiChatMsgInput 创建时应带 maxlength=50000');
  const checks = (src.match(/text\.length > 50000/g) || []).length;
  assert.equal(checks, 4, '发送时 50000 校验应仍为 4 处，实得 ' + checks + ' 处');
});

test('D-M3: 粘贴超长时给一次提示，不静默截断无提示', () => {
  const pasteIdx = src.indexOf("input.addEventListener('paste'");
  assert.ok(pasteIdx >= 0, '主输入框应有 paste 监听');
  const handler = src.slice(pasteIdx, pasteIdx + 600);
  assert.ok(handler.includes('50000'), 'paste 处理应按 50000 判定');
  assert.ok(handler.includes('消息过长，最多 50000 字符，请精简后重试'),
    '粘贴超长提示应与发送时文案一致');
  assert.ok(handler.includes('_beforeLen') || handler.includes('beforeLen') || handler.includes('< 50000'),
    '提示应只在“从未满到满”的跨越时给一次，不在每次粘贴时重复');
});
