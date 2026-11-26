'use strict';
// A-L2 回归：注释与代码多处漂移（只改注释，不改代码行为）。
// 核对结果：
//  ① 看门狗注释 45s/120s 与代码 idleThreshold（未收到数据 45000、收到后
//     120000）已一致——A-H1 修代码时已顺带对齐；
//  ② 300s 注释与 timeoutMs: 300000 已一致——A-H1 同样已顺带修完；
//  ③ search_supplement 分支注释仍漂移：称「reasoning 节点引用一并失效」，
//     但代码从未置空 reasoningContainer，只有关闭段渲染器引用，真正防脱管
//     的是 finishAiMessage 的 isConnected 复核；另 settleSearchStatus 注释
//     里 search_status(8223) 等行号早已过期。
// 本测试锁定 ①② 的一致性与 ③ 的修正。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('A-L2: 看门狗注释 45s/120s 与代码一致（A-H1 已顺带修完）', () => {
  assert.ok(src.includes('var idleThreshold = _receivedAny ? 120000 : 45000;'),
    '代码应为未收到数据 45s、收到后 120s');
  const codeIdx = src.indexOf('var idleThreshold = _receivedAny ? 120000 : 45000;');
  const comment = src.slice(codeIdx - 700, codeIdx);
  assert.ok(comment.includes('45s') && comment.includes('120s'),
    '看门狗注释应写明首包前 45s、收到数据后 120s');
  assert.ok(!comment.includes('180s') && !comment.includes('180000'),
    '注释里不应再有旧的 180s 漂移值');
});

test('A-L2: 300s 注释与 timeoutMs: 300000 一致（A-H1 已顺带修完）', () => {
  const codeIdx = src.indexOf('timeoutMs: 300000');
  assert.ok(codeIdx >= 0, '绝对超时应为 timeoutMs: 300000');
  const comment = src.slice(codeIdx - 400, codeIdx);
  assert.ok(comment.includes('300s'), '注释应写明对齐为 300s');
  assert.ok(!src.includes('timeoutMs: 1800000'), '不应再有旧的 1800000（30 分钟）绝对超时');
});

test('A-L2: search_supplement 注释不再谎称 reasoning 引用已失效', () => {
  const branchIdx = src.indexOf("if (evt.type === 'search_supplement')");
  assert.ok(branchIdx >= 0, '应有 search_supplement 分支');
  const branch = src.slice(branchIdx, branchIdx + 2200);
  assert.ok(!branch.includes('reasoning 节点引用一并失效'),
    '注释不应再称 reasoning 节点引用一并失效：代码从未置空 reasoningContainer');
  assert.ok(branch.includes('sealedContents.length = 0'), '分支应清 sealedContents（A-H4 行为）');
  assert.ok(branch.includes('answerCommitted = false'), '分支应复位 answerCommitted（A-H4 行为）');
  assert.ok(branch.includes('aiReasoning 不清') || branch.includes('aiReasoning') && branch.includes('保留'),
    '注释应写明 aiReasoning 是刻意保留而非遗漏');
});

test('A-L2: settleSearchStatus 注释里不再有过期行号', () => {
  assert.ok(!src.includes('search_status(8223)'), '过期行号 search_status(8223) 应去掉');
  assert.ok(!src.includes('search_supplement(8194)'), '过期行号 search_supplement(8194) 应去掉');
  assert.ok(src.includes('search_supplement'), '事件名本身应保留');
});
