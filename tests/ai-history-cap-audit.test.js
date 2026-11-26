'use strict';
// D-H3 回归：历史分页无上限，S.messages 与 DOM 无限增长。
// 修复前：分页分支 S.messages = msgs.concat(S.messages)，DOM insertBefore
//   前置节点，全文件没有任何上限、剪枝或虚拟列表；翻几百上千条就一直涨。
// 修复后：内存历史与 DOM 上限 AI_HISTORY_MAX_MESSAGES = 500。超限时剪掉
//   最旧的消息与节点（不含本页刚加载的，避免刚加载就被剪掉看不到；
//   不剪正在流式的 .generating 节点）。剪枝在分页插入后、rAF 滚动锚点
//   回调前同步完成，锚点 Δ（新 scrollHeight - 旧 scrollHeight）已包含
//   剪掉的高度，scrollTop = oldScrollTop + Δ 仍停在原来那条消息上。
//   实时发送收尾（finishAiMessage）同样剪枝，避免长会话只靠分页才封顶。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('D-H3: 历史上限常量 500 且分页/实时收尾两路都剪枝', () => {
  const m = src.match(/var AI_HISTORY_MAX_MESSAGES = (\d+);/);
  assert.ok(m, '应定义 AI_HISTORY_MAX_MESSAGES');
  assert.equal(Number(m[1]), 500, '上限应为 500 条');
  assert.ok(src.includes('function pruneAiHistory('), '应有 pruneAiHistory 剪枝 helper');
  const pruneIdx = src.indexOf('function pruneAiHistory(');
  const pruneBody = src.slice(pruneIdx, pruneIdx + 2200);
  assert.ok(pruneBody.includes('AI_HISTORY_MAX_MESSAGES'), '剪枝应按上限计算超量');
  assert.ok(pruneBody.includes('S.messages.splice(0,'), '内存历史应从最旧处剪掉');
  assert.ok(pruneBody.includes("querySelectorAll('.ai-msg')"), 'DOM 应同步剪掉最旧的 .ai-msg 节点');
  assert.ok(pruneBody.includes('generating'), '剪枝不应动正在流式的节点');
});

test('D-H3: 分页分支先插新页再剪枝，滚动锚点仍用插入后的 Δ', () => {
  const pageIdx = src.indexOf("if (msgs.length) S.messages = msgs.concat(S.messages);");
  assert.ok(pageIdx >= 0, '应有分页合并分支');
  const branch = src.slice(pageIdx, pageIdx + 2600);
  assert.ok(branch.includes('pruneAiHistory('), '分页分支超限时应剪枝');
  assert.ok(branch.includes('insertBefore(frag, _existingFirstNode)'), '分页仍前置插入');
  assert.ok(branch.indexOf('insertBefore(frag, _existingFirstNode)') < branch.indexOf('pruneAiHistory('),
    '应先插新页再剪枝（新页节点不被剪）');
  assert.ok(branch.indexOf('pruneAiHistory(') < branch.indexOf('requestAnimationFrame'),
    '剪枝应在 rAF 锚点回调前完成，Δ 已含剪掉的高度');
});

test('D-H3: 实时发送收尾也剪枝，S.messages 不只靠分页封顶', () => {
  const finIdx = src.indexOf('function finishAiMessage(');
  assert.ok(finIdx >= 0, '应有 finishAiMessage');
  const pushIdx = src.indexOf('S.messages.push(aiMsg)', finIdx);
  assert.ok(pushIdx >= 0, '收尾应 push 新助手消息');
  const pruneAfterPush = src.indexOf('pruneAiHistory(', pushIdx);
  assert.ok(pruneAfterPush >= 0 && pruneAfterPush - pushIdx < 300, '收尾 push 后应紧接着剪枝');
});
