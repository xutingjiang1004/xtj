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

// ── 1) + 面板：进出场必须是 clip-path 流动揭示（不是缩放弹跳） ──────────
test('+ 面板：必须有 clip-path 揭示进出场（流动感来源）', () => {
  const base = agentCss.match(/\.ai-plus-panel-shell\s*\{[^}]*\}/);
  const openRule = agentCss.match(/\.ai-plus-panel-shell\.open\s*\{[^}]*\}/);
  const closeRule = agentCss.match(/\.ai-plus-panel-shell\.is-closing\s*\{[^}]*\}/);
  assert.ok(base && openRule && closeRule, '基础 / open / is-closing 三条规则都必须存在');

  // 关闭态（起点）= 左下角一小条；打开态（终点）= 完整揭示
  assert.match(base[0], /clip-path:\s*inset\(100% 82% 0 0/,
    '隐藏态必须裁到 + 按钮所在的左下角');
  assert.match(openRule[0], /clip-path:\s*inset\(0/,
    '打开终态必须完整揭示 inset(0)');
  assert.match(closeRule[0], /clip-path:\s*inset\(100% 82% 0 0/,
    '关闭终态必须收回左下角，与隐藏态一致');

  // 用 clip-path 而不是 scale：scale 会拉伸文字（糊字/形变），
  // clip-path 只做揭示、内容不变形 —— 这是"流动"与"弹跳"的分界。
  // 注意：只匹配**声明行**（transform: 开头的行），注释里提到 scale() 不算。
  const decls = [base[0], openRule[0], closeRule[0]]
    .join('\n')
    .split('\n')
    .filter((l) => /^\s*(transform|animation)\s*:/.test(l))
    .join('\n');
  assert.doesNotMatch(decls, /scale\(0\.\d+\)/,
    '不得用大比例 scale 做开合（会拉伸糊字）');
});

test('+ 面板：打开与关闭共用同一条流动曲线（双向对称流动）', () => {
  const base = agentCss.match(/\.ai-plus-panel-shell\s*\{[^}]*\}/);
  const openRule = agentCss.match(/\.ai-plus-panel-shell\.open\s*\{[^}]*\}/);
  assert.ok(base && openRule, '基础 / open 规则必须存在');
  const openMs = parseInt((openRule[0].match(/clip-path\s+(\d+)ms/) || [])[1], 10);
  const closeMs = parseInt((base[0].match(/clip-path\s+(\d+)ms/) || [])[1], 10);
  assert.ok(openMs > 0 && closeMs > 0, '打开与关闭都必须有 clip-path 显式时长');
  // 关闭态复用基础态的 transition 声明，故以基础态时长为准；
  // 两者必须同速，才是真正的双向流动。
  assert.ok(openMs === closeMs,
    `打开(${openMs}ms) 与关闭(${closeMs}ms) 必须同速，才是双向流动`);
  // 曲线：平滑减速，无过冲无回弹
  const FLOW = /cubic-bezier\(0\.22,\s*0\.61,\s*0\.36,\s*1\)/;
  assert.match(openRule[0], FLOW, '打开必须使用流动曲线 cubic-bezier(0.22, 0.61, 0.36, 1)');
  assert.match(base[0], FLOW, '关闭必须复用同一条流动曲线');
  assert.match(base[0], /transform-origin:\s*bottom left/,
    'reveal 原点必须在 + 按钮所在的左下角');
  // 位移量要小（8px），配合 clip-path 才有"推开铺满"的感觉
  assert.match(base[0], /transform:\s*translateY\(8px\)/,
    '基础态位移必须是 translateY(8px)');
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

/* ── 4) 「整理检索结果并作答」占位：必须在所有终态路径收敛 ──────────────
   背景（用户报障，2026-09-22）：
     「明明已经工具完成了，并且也回复给我了，但是他还是在这里转圈圈：
       整理检索结果并作答，每条回复、每次要用工具的时候，他都这样子一直在
       那里转圈圈，根本就停不下来」
   根因：
     · 该占位是 append 到 .ai-tool-timeline（轮次容器**之外**）的，
       updateToolRoundState / forceSettleToolRound 只遍历 .ai-tool-round
       内部的 .ai-tool-step → 永远命中不到它；
     · 它的旋转动画挂在 .ai-tool-organizing .ai-tool-step-icon::before 上，
       是**无条件 infinite**，只有加 .is-done 才会换成静态 ✓ ——
       光 classList.remove('is-running') 完全停不下来；
     · 唯一的正常收敛时机是 content 事件（正文首字到达），带思考的回复
       正文来得晚，这段空窗就是一个永远在转的圈。
   本测试把"必须抽成统一收敛函数并在所有终态路径调用"固化成契约。 */
test('整理占位：必须存在统一的 settleOrganizingStep 收敛函数', () => {
  assert.match(agentSrc, /function settleOrganizingStep\(node,\s*opts\)/,
    '必须抽出统一的收敛函数，避免各路径各写一套（此前正是如此走偏的）');
  const start = agentSrc.indexOf('function settleOrganizingStep(');
  const body = agentSrc.slice(start, start + 1800);
  // 关键：必须加 is-done / is-error（只有这两个类会覆盖 CSS 的无条件 infinite 旋转）
  assert.match(body, /classList\.add\(ok \? 'is-done' : 'is-error'\)/,
    '必须加 is-done（只去 is-running 停不下 CSS 旋转环）');
  assert.match(body, /classList\.remove\('is-running'\)/, '同时清除进行中态');
  assert.match(body, /ai-tool-step-status/, '状态文案要同步落定为终态');
});

test('整理占位：CSS 旋转环必须只在 is-running 时转（否则无法被收敛）', () => {
  // 收敛的前提是"动画由状态类驱动"：.is-done / .is-error 必须能覆盖掉旋转
  assert.match(enhanceCss, /\.ai-tool-step\.ai-tool-organizing\s+\.ai-tool-step-icon::before\s*\{[^}]*animation:\s*xtjToolSpin/,
    'organizing 图标须有旋转环');
  assert.match(enhanceCss, /\.ai-tool-step\.ai-tool-organizing\.is-done\s+\.ai-tool-step-icon::before/,
    '必须存在 .is-done 覆盖规则把旋转环换成静态 ✓（否则永远停不下来）');
});

test('整理占位：所有终态路径都必须调用收敛（content / done / error / 中断）', () => {
  // ① content：正文首字到达
  assert.ok(agentSrc.includes("settleOrganizingStep(assistantNode)"),
    'content 事件必须调用收敛');
  // ② clearAssistantTransientStatus（done / 中断 / 超时统一入口）必须调用
  const clearStart = agentSrc.indexOf('function clearAssistantTransientStatus(');
  assert.ok(clearStart > 0, 'clearAssistantTransientStatus 必须存在');
  const clearBody = agentSrc.slice(clearStart, clearStart + 6000);
  assert.ok(clearBody.includes('settleOrganizingStep(target)'),
    'clearAssistantTransientStatus 必须调用收敛（覆盖 done/中断/超时）');
  // ③ 不经过 finishAiMessage 的分支（doneReceived / terminalErrorSeen）也要覆盖
  assert.match(agentSrc, /settleOrganizingStep\(assistantNode\)/,
    'doneReceived / terminalErrorSeen 分支必须显式收敛');
});

test('整理占位：占位必须挂在 timeline 且不在任何 .ai-tool-round 内（这是曾经的漏网原因）', () => {
  // 固化"它落在轮次之外"这一事实 —— 若将来有人把它挪进轮次，本断言会提醒
  // 重新评估 updateToolRoundState 的覆盖范围。
  assert.match(agentSrc, /class:\s*'ai-tool-step ai-tool-organizing is-running'/,
    'organizing 占位必须仍以该 class 组合创建');
  assert.match(agentSrc, /_organizeBar\.appendChild/, '占位是 append 到 timeline 的');
});

/* ── 5) 流动感动效层（参考 iOS 27 Siri / ChatGPT 流式输出）────────────── */
test('流动感：工具轮摘要行运行中必须有流光扫过（渐变位移而非闪烁）', () => {
  assert.match(enhanceCss, /@keyframes\s+xtjToolFlow/,
    '必须存在流光扫过关键帧');
  const rule = enhanceCss.match(/\.ai-tool-round\.is-running \.ai-tool-round-label\s*\{[^}]*\}/);
  assert.ok(rule, '运行中摘要行规则必须存在');
  assert.match(rule[0], /background-image:\s*linear-gradient/,
    '流光必须是渐变（有方向的连续位移）');
  assert.match(rule[0], /animation:\s*xtjToolFlow/, '必须挂上流光动画');
  // 终态必须归零：流结束了光就得停
  const done = enhanceCss.match(/\.ai-tool-round\.is-done \.ai-tool-round-label[\s\S]{0,200}?\}/);
  assert.ok(done, '终态摘要行规则必须存在');
  assert.match(done[0], /animation:\s*none/, '终态必须停掉流光');
});

test('流动感：结果卡片改为 clip-path 渐进揭示（与 + 面板同一套语法）', () => {
  assert.match(enhanceCss, /@keyframes\s+xtjToolResultReveal/,
    '结果卡片必须有揭示式入场');
  const kf = enhanceCss.match(/@keyframes\s+xtjToolResultReveal\s*\{[\s\S]*?\n\}/);
  assert.match(kf[0], /clip-path:\s*inset\(0 100% 0 0/,
    '必须从一侧擦除式揭示，而不是整块淡入');
  assert.match(kf[0], /clip-path:\s*inset\(0 0 0 0/, '终态必须完整揭示');
});

test('流动感：流式光标带柔光晕（不是硬竖线电报灯）', () => {
  assert.match(enhanceCss, /@keyframes\s+ai-cursor-halo/, '必须有光晕脉动关键帧');
  const rule = enhanceCss.match(/\.ai-stream-cursor\s*\{[^}]*\}/);
  assert.ok(rule, '光标规则必须存在');
  assert.match(rule[0], /ai-cursor-halo/, '光标必须挂上光晕动画');
  assert.match(rule[0], /box-shadow/, '光晕用 box-shadow 实现');
});

test('流动感：所有新增动画必须受 reduced-motion 与动效开关管控', () => {
  // 定位包含流光选择器的 reduced-motion 块
  let idx = -1;
  let from = 0;
  while (true) {
    const i = enhanceCss.indexOf('@media (prefers-reduced-motion: reduce)', from);
    if (i < 0) break;
    if (enhanceCss.slice(i, i + 1200).includes('ai-tool-round-label')) { idx = i; break; }
    from = i + 1;
  }
  assert.ok(idx > 0, '必须存在覆盖流光的 reduced-motion 块');
  const block = enhanceCss.slice(idx, idx + 1200);
  for (const sel of ['ai-tool-round-label', 'ai-tool-result-card', 'ai-stream-cursor']) {
    assert.ok(block.includes(sel), `reduced-motion 必须停掉 ${sel} 的动画`);
  }
  assert.match(enhanceCss, /html\[data-xtj-motion=off\] \.ai-stream-cursor/,
    '站内动效开关同样必须覆盖光标');
});

/* ── 6) 结果展示不得整屏铺开（P0 回归）──────────────────────────────── */
test('结果卡片：卡片内的明细必须有高度上限（不得整屏铺开）', () => {
  const rule = enhanceCss.match(/\.ai-tool-result-card \.ai-search-detail\s*\{[^}]*\}/);
  assert.ok(rule, '卡片内 detail 规则必须存在');
  assert.match(rule[0], /max-height/, '必须有 max-height 约束');
  assert.match(rule[0], /overflow-y:\s*auto/, '超出必须可滚动，而非撑开页面');
  const cardRule = enhanceCss.match(/\.ai-tool-result-card\s*\{[^}]*\}/);
  assert.match(cardRule[0], /overflow:\s*hidden/, '卡片本身要裁掉溢出');
});

test('结果卡片：长片段必须夹住行数（读网页正文不得整屏铺开）', () => {
  const rule = enhanceCss.match(/\.ai-tool-result-card \.ai-search-detail-snippet\s*\{[^}]*\}/);
  assert.ok(rule, '卡片内 snippet 规则必须存在');
  assert.match(rule[0], /-webkit-line-clamp/, '必须用 line-clamp 夹住行数');
});

test('Items 契约：后端必须统一 items 出口（不得把整段正文当列表下发）', () => {
  const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
  assert.match(serverSrc, /function normalizeToolResultItems\(/,
    '必须存在统一的 items 规范化函数');
  const fnStart = serverSrc.indexOf('function normalizeToolResultItems(');
  const body = serverSrc.slice(fnStart, fnStart + 1600);
  // 字符串必须先判"是不是数组"再决定，正文文本一律返回 null
  assert.match(body, /trimmed\[0\] !== '\['\)\s*return null/,
    '非 JSON 数组的正文字符串必须返回 null，不得当列表下发');
  assert.match(body, /Array\.isArray\(arr\)/, '必须校验确实是数组');
  // 三条写入路径都必须走这个出口
  const occurrences = (serverSrc.match(/items:\s*normalizeToolResultItems\(/g) || []).length;
  assert.ok(occurrences >= 3, `三条 tool_result 路径都必须走统一出口，当前只有 ${occurrences} 处`);
});

test('Items 契约：前端必须校验 Array.isArray 才渲染结果列表', () => {
  assert.match(agentSrc, /if \(!Array\.isArray\(itemsArr\)\) itemsArr = null;/,
    '前端必须拒绝非数组的 items（字符串也有 .length，旧判断会被穿透）');
});
