'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(root, 'js', 'ai-core', 'stream-renderer.js'), 'utf8');
const cssEnhance = fs.readFileSync(path.join(root, 'css', 'ui-enhance.css'), 'utf8');

/* ── 背景（2026-09-22）────────────────────────────────────────────────
   用户反馈：「小猫AI 正文回复的时候，那个动画感觉好卡顿」，希望改成
   iOS 27 Siri 那种连续流淌的观感。
   诊断（实测数据，勿凭直觉推翻）：
     · renderMarkdown 12000 字符仅 0.33ms —— **不是**卡顿来源；
     · 真正的开销是 `targetEl.innerHTML = html` 每帧销毁并重建整棵 DOM
       子树、重算样式、重排。正文字数越多节点越多，每帧成本随长度线性
       增长 —— 这就是"越回越卡、一块块跳"的成因。
   修复：整体渲染保持不变（正确性 100%），但落地时走增量补丁 —— 只替换
   真正变化的节点，未变节点浏览器完全不碰，每帧改动量 O(1)。
   本段把「增量补丁存在」「两处渲染路径都走补丁」「门限已收紧」固化成契约。 */

test('正文流式渲染必须走增量补丁（不得每帧整段替换 innerHTML）', () => {
  // ai-agent.js：正文路径必须调用 patchInnerHTML
  assert.match(agentSrc, /function patchInnerHTML\s*\(/, 'ai-agent.js 必须提供 patchInnerHTML');
  const i = agentSrc.indexOf('function createSmoothTextRenderer');
  assert.ok(i > 0, '必须存在 createSmoothTextRenderer');
  const body = agentSrc.slice(i, i + 12000);
  assert.match(body, /patchInnerHTML\(targetEl, renderMarkdown\(rendered\)\)/,
    '正文渲染必须通过 patchInnerHTML 落地，而不是整段 innerHTML 替换');

  // stream-renderer.js：Code 工作区路径同样要走补丁
  assert.match(coreSrc, /function patchInnerHTML\s*\(/, 'stream-renderer.js 必须提供 patchInnerHTML');
  const j = coreSrc.indexOf('function createStreamRenderer');
  const coreBody = coreSrc.slice(j, j + 8000);
  assert.match(coreBody, /patchInnerHTML\(targetEl, renderRich\(rendered\)\)/,
    'Code 工作区渲染同样必须走增量补丁');
});

test('增量补丁必须保留未变化节点（这是性能保证的核心）', () => {
  const i = agentSrc.indexOf('function patchInnerHTML');
  const seg = agentSrc.slice(i, i + 2400);
  // 相同则跳过 —— 不碰未变节点
  assert.match(seg, /outerHTML === wantHtml\)\s*continue/,
    '未变化节点必须跳过，否则等于整段重建');
  // 不同的才替换
  assert.match(seg, /replaceChild\(/, '变化节点必须用 replaceChild 就地替换');
  // 结构异常兜底：整段替换，保证显示正确性
  assert.match(seg, /targetEl\.innerHTML = html/, '必须保留整段替换兜底');
  // 节点数骤减说明发生重排 —— 直接整段替换
  assert.match(seg, /next\.length < kids\.length/, '节点数骤减时必须回退整段替换');
});

test('流式渲染门限已收紧（流畅度的直接来源）', () => {
  // 增量补丁把每帧成本降到 O(1) 后，门限才能从 90/140ms 收紧到 48/64ms
  assert.match(agentSrc, /rendered\.length < 600 \? 48 : 64/,
    'ai-agent.js 门限必须收紧到 48/64ms');
  assert.match(coreSrc, /rendered\.length < 600 \? 48 : 64/,
    'stream-renderer.js 门限必须收紧到 48/64ms');
  // 不得回退到旧的 90/140
  assert.doesNotMatch(agentSrc, /rendered\.length < 600 \? 90 : 140/,
    '不得回退到旧的 90/140ms 门限');
});

test('增量补丁必须尊重用户选区（不得破坏选中文本）', () => {
  const i = agentSrc.indexOf('function createSmoothTextRenderer');
  const body = agentSrc.slice(i, i + 12000);
  assert.match(body, /isSelectionInTarget\(targetEl\)/,
    '存在选区时必须跳过 DOM 改动');
});

test('流式光标仍保持柔和呼吸（不得回退成硬闪）', () => {
  // 光标动画是"流淌感"的收尾细节，不能被这次改动带回去
  assert.match(cssEnhance, /\.ai-stream-cursor/, 'ui-enhance.css 必须覆盖流式光标');
});
