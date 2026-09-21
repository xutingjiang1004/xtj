/**
 * 合约测试：AI 输入区「+ 面板 / 模型·思考弹层 / 工具进展」的动效与折叠行为
 *
 * 背景（用户反馈，2026-09-22）：
 *   1) 点 + 之后"没有展开的动画"，弹出与收起都很生硬；
 *   2) 模型 / 思考的选项弹层关闭时是"啪"地消失，同样生硬；
 *   3) 工具调用展示不像 ChatGPT / Codex——完成后仍占一大片，且 emoji 图标随系统字体变色。
 *
 * 本文件把上述三条诉求固化成可回归的断言，防止后续改动把动效悄悄退化回"硬切"。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const agentCss = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
const enhanceCss = fs.readFileSync(path.join(root, 'css', 'ui-enhance.css'), 'utf8');

// ── 1) + 面板：进出场必须有 keyframes 动画 ────────────────────────────
test('+ 面板：打开/关闭必须有独立的 keyframes 进出场动画', () => {
  const openKf = agentCss.match(/@keyframes\s+aiPlusPanelOpen\s*\{[\s\S]*?\n\}/);
  const closeKf = agentCss.match(/@keyframes\s+aiPlusPanelClose\s*\{[\s\S]*?\n\}/);
  assert.ok(openKf, 'aiPlusPanelOpen 必须存在');
  assert.ok(closeKf, 'aiPlusPanelClose 必须存在');
  // 打开：起点与隐藏态一致，终点完全展开
  assert.match(openKf[0], /opacity:\s*0/, '打开起点必须透明');
  assert.match(openKf[0], /scale\(1\)/, '打开终点必须完全展开');
  // 关闭：必须收回到隐藏态（而非瞬间消失）
  assert.match(closeKf[0], /opacity:\s*0/, '关闭终点必须透明');
});

test('+ 面板：关闭动画不得慢于打开动画（收起不该让用户等）', () => {
  const openRule = agentCss.match(/\.ai-plus-panel-shell\.open\s*\{[^}]*\}/);
  const closeRule = agentCss.match(/\.ai-plus-panel-shell\.is-closing\s*\{[^}]*\}/);
  assert.ok(openRule && closeRule, 'open / is-closing 规则必须存在');
  const openMs = parseInt((openRule[0].match(/aiPlusPanelOpen\s+(\d+)ms/) || [])[1], 10);
  const closeMs = parseInt((closeRule[0].match(/aiPlusPanelClose\s+(\d+)ms/) || [])[1], 10);
  assert.ok(openMs > 0 && closeMs > 0, '两段动画都必须有显式时长');
  assert.ok(closeMs <= openMs, `关闭(${closeMs}ms) 不应慢于打开(${openMs}ms)`);
});

test('+ 面板：内容块错峰淡入（不是整块糊上去）', () => {
  assert.match(agentCss, /@keyframes\s+aiPlusPanelItemIn/, '缺少面板内容错峰动画');
  assert.match(
    agentCss,
    /\.ai-plus-panel-shell\.open \.ai-panel-group:nth-of-type\(1\)/,
    '面板分组须按序号错峰'
  );
});

// ── 2) 模型 / 思考弹层：必须有进出场动画，关闭不得直接 remove ─────────
test('模型/思考弹层：必须有入场与退场动画', () => {
  assert.match(agentCss, /@keyframes\s+aiSelectPopIn/, '弹层缺少入场动画');
  assert.match(agentCss, /@keyframes\s+aiSelectPopOut/, '弹层缺少退场动画');
  const closing = agentCss.match(/\.ai-select-pop\.is-closing\s*\{[^}]*\}/);
  assert.ok(closing, '.ai-select-pop.is-closing 规则必须存在');
  assert.match(closing[0], /pointer-events:\s*none/, '退场中的弹层必须不可点击');
});

test('模型/思考弹层：关闭走「先播动画再移除」，不得直接 removeChild', () => {
  const start = agentSrc.indexOf('function closeSelectPopup(');
  assert.ok(start > 0, 'closeSelectPopup 必须存在');
  const body = agentSrc.slice(start, start + 1200);
  assert.match(body, /classList\.add\('is-closing'\)/, '关闭必须先打 is-closing 标记');
  assert.match(body, /setTimeout/, '退场动画播完后再移除节点');
  // instant 参数用于"立刻换一个弹层"的场景，避免两层叠在一起
  assert.match(body, /instant === true/, '必须支持 instant 立即移除');
});

test('模型/思考弹层：展开原点应对齐到锚点行', () => {
  assert.match(agentSrc, /--pop-ox/, '缺少弹层展开原点变量');
  assert.match(agentCss, /transform-origin:\s*var\(--pop-ox/, 'CSS 必须使用 --pop-ox 作为变换原点');
});

// ── 3) 工具进展：Codex 风格的可折叠轮次 ───────────────────────────────
test('工具轮次：容器由 createToolRound 统一构造（三处创建点结构一致）', () => {
  assert.match(agentSrc, /function createToolRound\(/, '缺少统一轮次构造函数');
  const fnStart = agentSrc.indexOf('function createToolRound(');
  const body = agentSrc.slice(fnStart, fnStart + 1800);
  assert.match(body, /ai-tool-round-list-wrap/, '必须有折叠包裹层（grid-template-rows 过渡）');
  assert.match(body, /ai-tool-round-caret/, '必须有折叠箭头');
  assert.match(body, /is-collapsed/, '必须支持 is-collapsed 折叠态');
  assert.match(body, /addEventListener\('click'/, '摘要行必须可点击展开/收起');
  assert.match(body, /is-running'\)\) return/, '运行中不得允许收起（进度是此刻唯一想看的）');
});

test('工具轮次：整轮结束后自动折叠为一行', () => {
  const fnStart = agentSrc.indexOf('function updateToolRoundState(');
  assert.ok(fnStart > 0, 'updateToolRoundState 必须存在');
  const body = agentSrc.slice(fnStart, fnStart + 1800);
  const settledIdx = body.indexOf('roundBox.classList.add(\'is-done\')');
  assert.ok(settledIdx > 0, '必须存在整轮完成分支');
  const settledSeg = body.slice(settledIdx, settledIdx + 400);
  assert.match(settledSeg, /is-collapsed/, '完成后必须自动折叠');
  assert.match(body, /remove\('is-done', 'is-collapsed'\)/, '重新运行时必须展开');
});

test('工具进展：折叠用 grid-template-rows 平滑过渡（不用写死 max-height）', () => {
  assert.match(enhanceCss, /\.ai-tool-round-list-wrap\s*\{[^}]*grid-template-rows:\s*1fr/,
    '折叠包裹层默认展开');
  assert.match(enhanceCss, /\.ai-tool-round\.is-collapsed \.ai-tool-round-list-wrap\s*\{[^}]*grid-template-rows:\s*0fr/,
    '折叠态必须收敛到 0fr');
  assert.match(enhanceCss, /transition:\s*grid-template-rows/, '必须有高度过渡');
});

test('工具进展：运行态图标由 CSS 绘制（不依赖 emoji，避免字体变色/缺字）', () => {
  assert.match(enhanceCss, /@keyframes\s+xtjToolSpin/, '缺少 CSS 旋转环动画');
  assert.match(enhanceCss, /\.ai-tool-round-icon\s*\{[^}]*font-size:\s*0/,
    '摘要图标的 emoji 文本必须隐身（font-size:0），图形由 CSS 绘制');
  assert.match(enhanceCss, /\.ai-tool-round-list \.ai-tool-step-icon\s*\{[^}]*font-size:\s*0/,
    '步骤图标同理，不得依赖 emoji');
  assert.match(enhanceCss, /\.ai-tool-round\.is-done \.ai-tool-round-icon::before\s*\{[^}]*content:\s*'✓'/,
    '完成态必须有 ✓ 落定标记');
});

test('工具进展：条目错峰进入（并行多工具时依次落下而非整块砸出）', () => {
  assert.match(enhanceCss, /\.ai-tool-round-list \.ai-tool-step:nth-child\(2\)\s*\{\s*animation-delay/,
    '条目须按序号错峰');
});

test('工具进展：新增动画必须受 reduced-motion / 动效开关管控', () => {
  // 文件里有多个 reduced-motion 块，定位覆盖工具进展的那一个
  let idx = -1;
  let from = 0;
  while (true) {
    const i = enhanceCss.indexOf('@media (prefers-reduced-motion: reduce)', from);
    if (i < 0) break;
    if (enhanceCss.slice(i, i + 900).includes('ai-tool-round-icon')) { idx = i; break; }
    from = i + 1;
  }
  assert.ok(idx > 0, '必须存在覆盖工具进展的 reduced-motion 块');
  const reducedBlock = enhanceCss.slice(idx, idx + 900);
  assert.match(reducedBlock, /\.ai-tool-round-icon::before/, 'reduced-motion 必须停掉 CSS 旋转环');
  assert.match(reducedBlock, /\.ai-tool-round-list \.ai-tool-step-icon::before/, '步骤旋转环同样要停');
  assert.match(enhanceCss, /html\[data-xtj-motion=off\] \.ai-tool-round-icon::before/,
    '站内动效开关同样必须覆盖');
});
