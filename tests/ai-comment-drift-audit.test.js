'use strict';
// A-L2 回归：注释与代码多处漂移（只改注释，不改代码行为）。
// 核对结果：
//  ① 看门狗注释 120s/300s 与代码 idleThreshold（未收到数据 120000、收到后
//     300000）已一致——点-2 把首包 120s、收到后 300s（上一轮 45s/120s
//     会误杀长静默思考）；
//  ② 1800s 注释与 timeoutMs: 1800000 已一致——点-2 把绝对超时改回 30 分钟
//     对齐服务端 TOTAL_TIMEOUT_MS（上一轮 300s 会掐断长思考）；
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

test('A-L2: 看门狗注释 120s/300s 与代码一致（点-2 已改为首包 120s、收到后 300s）', () => {
  assert.ok(src.includes('var idleThreshold = _receivedAny ? 300000 : 120000;'),
    '代码应为未收到数据 120s、收到后 300s');
  const codeIdx = src.indexOf('var idleThreshold = _receivedAny ? 300000 : 120000;');
  const comment = src.slice(codeIdx - 700, codeIdx);
  assert.ok(comment.includes('120s') && comment.includes('300s'),
    '看门狗注释应写明首包前 120s、收到数据后 300s');
  assert.ok(!comment.includes('180s') && !comment.includes('180000'),
    '注释里不应再有旧的 180s 漂移值');
});

test('A-L2: 1800s 注释与 timeoutMs: 1800000 一致（点-2 改回 30 分钟对齐服务端）', () => {
  const codeIdx = src.indexOf('timeoutMs: 1800000');
  assert.ok(codeIdx >= 0, '绝对超时应为 timeoutMs: 1800000');
  const comment = src.slice(codeIdx - 400, codeIdx);
  assert.ok(comment.includes('1800000ms') || comment.includes('1800s') || comment.includes('30 分钟'), '注释应写明对齐为 1800s/30 分钟');
  assert.ok(!src.includes('timeoutMs: 300000'), '不应再有上一轮的 300000 绝对超时');
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
