// P0 回归合约：「模型把工具调用协议当正文回复」四项根因修复
// 2026-09-21 截图实证：工作模式 + 思考下，模型在正文输出
// `<| | DSML | | invoke name="search_social">` 原文，且大段内部纠结泄漏。
// 根因链：
//   ① callDeepSeekViaResponses 引用未定义变量 workModeEnabled → ReferenceError，
//     所有 use_responses_api 调用瘫痪；
//   ② Responses 路径思考模式清空 tools，但 prompt 宣称"可用工具（…）"；
//   ③ 工作模式 + 思考 + 搜索关 → useBuiltInSearch=false → 标准路径零工具裸跑；
//   ④ 标准路径思考模式 prompt 宣称工具却不挂载 → 模型拿 DSML 文本假装调用。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

test('① callDeepSeekViaResponses 不得引用请求处理器局部变量 workModeEnabled', () => {
  // 提取 callDeepSeekViaResponses 函数体，确认其中没有裸引用 workModeEnabled
  const start = serverSrc.indexOf('async function callDeepSeekViaResponses(');
  assert.ok(start > 0, '缺少 callDeepSeekViaResponses 函数');
  const next = serverSrc.indexOf('\nasync function ', start + 10);
  const body = serverSrc.slice(start, next > 0 ? next : start + 60000)
    .split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n');
  assert.doesNotMatch(body, /(?<![\w.])workModeEnabled(?![\w])/,
    '函数内引用了未定义的 workModeEnabled（运行时 ReferenceError，Responses 路径整体瘫痪）');
  assert.match(body, /allowToolsWithThinking = true/,
    '思考+工具共存判定缺失（/responses 实测可共存，调用方传入的 tools 必须下发）');
});

test('② Responses 路径思考模式不得清空 tools（宣称 ≡ 下发）', () => {
  assert.doesNotMatch(serverSrc, /var responsesTools = \(useThinking && !workModeEnabled\)/,
    '思考模式清空工具集会造成 prompt 宣称与实际下发错位');
  assert.match(serverSrc, /var responsesTools = workModeEnabled\s*\n?\s*\?\s*aiToolsForWorkMode\(\)/);
});

test('③ 工作模式（非视觉直传）强制走 Responses 路径', () => {
  assert.match(serverSrc,
    /if \(workModeEnabled && !_visionEngaged && validatedModel !== DEEPSEEK_RESPONSES_MODEL\)\s*\{\s*\n\s*validatedModel = DEEPSEEK_RESPONSES_MODEL;/,
    '工作模式未归一到 responses 模型');
  assert.match(serverSrc,
    /var useBuiltInSearch = \(workModeEnabled && !_visionEngaged\)/,
    '工作模式未强制启用内置搜索（Responses）路径');
});

test('④ 标准路径思考模式下 prompt 工具宣称改写为如实口径', () => {
  assert.match(serverSrc,
    /本次请求未挂载任何工具：不要尝试调用任何工具，也不要在回复里输出任何工具调用协议文本/,
    '缺少"未挂载工具"如实口径改写（模型会拿 DSML 文本假装调用）');
  assert.match(serverSrc,
    /if \(useThinking && !workModeEnabled && messages\.length && messages\[0\] && typeof messages\[0\]\.content === 'string'\)/,
    '改写条件缺失');
});

test('⑤ 工作模式 FC 预检兜底不再要求关闭思考', () => {
  assert.match(serverSrc, /if \(workModeEnabled && !aborted\) needsFcCheck = true;/);
  assert.doesNotMatch(serverSrc, /if \(workModeEnabled && !useThinking && !aborted\) needsFcCheck = true;/);
});
