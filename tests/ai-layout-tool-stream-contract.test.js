'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const agent = read('js/ai-agent.js');
const aiCss = read('css/ai-agent.css');
const shellCss = read('css/ui-shell.css');

test('AI transcript sizing allows flex/grid children and bubbles to shrink within the viewport', () => {
  assert.match(aiCss, /\.ai-chat-root\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/s);
  assert.match(aiCss, /\.ai-chat-messages\s*\{[^}]*min-width:\s*0;/s);
  assert.match(aiCss, /\.ai-msg\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(aiCss, /\.ai-msg-bubble\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*min\(92%,\s*720px\);[^}]*box-sizing:\s*border-box;/s);
  assert.match(shellCss, /#panelChat \.dock-chat-container,[\s\S]*?#panelChat \.chat-list\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/);
});

test('desktop AI messages and cards stay in the main grid column without an empty min-content rail', () => {
  assert.match(aiCss, /\.ai-secondary-panel #aiChatRoot > \.ai-chat-messages\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/s);
  assert.match(aiCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*var\(--ai-desktop-context\)\);/);
  assert.match(aiCss, /\.ai-secondary-panel #aiChatRoot > \.ai-chat-messages > \.ai-tool-card\s*\{[^}]*grid-column:\s*1;[^}]*min-width:\s*0;/s);
  assert.match(aiCss, /\.ai-tool-card-kv\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
});

test('tool_calls promotes pending placeholders instead of duplicating the same tool row', () => {
  const calls = agent.slice(agent.indexOf("if (evt.type === 'tool_calls')"), agent.indexOf("if (evt.type === 'enhanced_stage')"));
  assert.match(calls, /pendingRounds = timeline\.querySelectorAll\('\.ai-tool-round\.is-running'\)/);
  // ★★★ 2026-09-28 改写（原断言钉住的正是缺陷本身）：
  //   原来是 `assert.match(calls, /pendingTitles\[pt\]\.textContent === '准备工具'/)`
  //   —— 它把"靠标题文案识别占位轮次"固化成契约。但占位标题后来改为
  //   toolLabel(pendName)（"查询天气"，说人话、不暴露 get_weather 这类内部名），
  //   文案匹配随即失效 → 找不到可复用轮次 → 新建 → 同一工具出现两条目/两轮次。
  //   现改为断言**标记驱动**：占位必须打 [data-tool-pending]，
  //   复用查找必须基于该标记，从此与显示文案解耦。
  assert.match(calls, /pendingRounds\[pr\]\.querySelector\('\[data-tool-pending\]'\)/,
    '必须用 [data-tool-pending] 语义标记识别占位轮次');
  // 反向断言必须先剥掉注释 —— 修复说明里会引用旧写法作为反例，
  // 直接 doesNotMatch 会命中注释本身（假失败）。
  const callsCode = calls.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(line => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  assert.doesNotMatch(callsCode, /textContent === '准备工具'/,
    '不得再用标题文案匹配（占位标题已改为 toolLabel 结果，文案匹配会失效导致重复条目）');
  assert.match(calls, /\.ai-tool-step\[data-tool-pending\]/,
    '占位条目的复用查找也必须基于 [data-tool-pending]');
  assert.match(calls, /existing\.removeAttribute\('data-tool-pending'\)/,
    '占位被转正后必须清掉 pending 标记');
  assert.match(calls, /existing\.setAttribute\('data-tool-step', stepId\)/);
  assert.match(calls, /existing\.querySelector\('\.ai-tool-step-detail'\)/);
});

test('tool results match active same-name calls and only explicit success is shown as success', () => {
  const resultStart = agent.indexOf("if (evt.type === 'tool_result') {");
  const resultEnd = agent.indexOf("if (evt.type === 'error') {", resultStart);
  const result = agent.slice(resultStart, resultEnd);
  assert.match(result, /var toolSucceeded = evt\.success === true && !evt\.error/);
  // ★★★ 2026-09-28 改写（原断言钉住的正是缺陷本身）：
  //   原来是 `assert.match(result, /exactRunningStep \|\| firstRunningStep \|\| exactNamedStep/)`
  //   —— 它把"回落到 firstRunningStep（全 timeline 第一个 running 的同名条目，
  //   无视轮次归属）"固化成了契约。用户报障「工具完成了、原来那个还在转圈，
  //   下面却多出一个已完成」正是这条逻辑造成的：多轮调用同名工具时，
  //   第 N 轮的结果会去认领错轮次的那一条，真正在跑的永远等不到自己的结果。
  //   现改为断言**正确行为**：
  //     · 优先精确匹配（名字 + query 都对得上，且未被认领）；
  //     · 否则在"未被认领的同名 running 条目"里 FIFO 认领；
  //     · 匹配到的条目必须打 data-tool-claimed，保证并行同名工具各自配对。
  assert.match(result, /exactRunningStep \|\| unclaimedNamedStep/,
    '匹配顺序必须优先精确 running，其次"未认领的同名 running"（FIFO），不得回落到跨轮的 firstRunningStep');
  // 只针对**代码用法**（`|| firstRunningStep` / `= firstRunningStep`）断言，
  // 不误伤修复说明里提到旧实现的注释。
  assert.doesNotMatch(result, /(?:\|\||=)\s*firstRunningStep\b/,
    'firstRunningStep 无视轮次归属，会把结果认领到错误的轮次上');
  assert.match(result, /setAttribute\('data-tool-claimed', '1'\)/,
    '认领后必须打 data-tool-claimed，否则同一 result 重复命中、另一条同名条目永远转圈');
  assert.match(result, /matchStep\.classList\.remove\('is-running', 'is-done', 'is-error'\)/);
  assert.match(result, /class: 'ai-tool-result-error'/);
  assert.match(result, /Array\.isArray\(itemsArr\)/);
});

test('a tool failure does not falsely settle parallel siblings, and unresolved tools are not marked completed', () => {
  const toolError = agent.slice(agent.indexOf("if (evt.type === 'tool_error')"), agent.indexOf("if (evt.type === 'tool_result')"));
  assert.doesNotMatch(toolError, /notify\(/);
  assert.doesNotMatch(toolError, /settleSearchStatus\(/);
  assert.doesNotMatch(toolError, /\.ai-tool-step\.is-running/);
  assert.match(toolError, /refreshOwningToolRound\(errMatch\)/);
  const cleanup = agent.slice(agent.indexOf('function clearAssistantTransientStatus'), agent.indexOf('function attachContinueGenerateBtn'));
  assert.match(cleanup, /rsEl\.classList\.add\('is-error'\)/);
  assert.match(cleanup, /未收到结果/);
  assert.doesNotMatch(cleanup, /rsEl\.classList\.add\('is-done'\)/);
});
