/**
 * 回归守卫：统一「工具活动区」外壳（P0 + 方案 A，2026-09-28）
 *
 * 背景（用户诉求）：
 *   小猫AI 的工具活动区此前是**两套并存的容器**：
 *     · 工具轮次（.ai-tool-round）挂在 .ai-tool-timeline 上，结构完整、可折叠；
 *     · "整理检索结果并作答"占位是**直接 append 到 .ai-tool-timeline** 的，
 *       落在轮次容器之外 → 样式与轮次条目不一致，且收敛路径覆盖不到它。
 *   多轮工具时视觉上是一堆各自独立的小块，缺少 ChatGPT 那种"所有工具活动
 *   归到一个可折叠区域"的整体感。
 *
 * 方案 A：引入 .ai-tool-activity 外壳，把所有轮次 + "整理中"占位收进同一区域，
 *   由总摘要行统一控制折叠。
 *
 * 本文件把这些约束钉死，防止以后被"顺手改回把轮次直挂 timeline"。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const aiAgent = read('js/ai-agent.js');
const css = read('css/ui-enhance.css');

function block(src, anchor, size) {
  const start = src.indexOf(anchor);
  assert.notEqual(start, -1, `找不到锚点: ${anchor}`);
  return src.slice(start, start + size);
}

// ── 1. 外壳与辅助函数存在 ──────────────────────────────────────────────
test('方案A：必须提供 ensureToolActivity / toolActivityBody / updateToolActivity', function () {
  assert.ok(/function ensureToolActivity\s*\(timeline\)/.test(aiAgent),
    '缺 ensureToolActivity：无法惰性创建统一活动区外壳');
  assert.ok(/function toolActivityBody\s*\(timeline\)/.test(aiAgent),
    '缺 toolActivityBody：轮次与"整理中"无法归到同一父节点');
  assert.ok(/function updateToolActivity\s*\(activity\)/.test(aiAgent),
    '缺 updateToolActivity：总摘要行无法刷新');
  assert.ok(/function refreshOwningToolActivity\s*\(node\)/.test(aiAgent),
    '缺 refreshOwningToolActivity：无法从子节点反查并刷新活动区');
});

test('方案A：外壳结构必须是 head(摘要行) + body(可折叠体)', function () {
  const fn = block(aiAgent, 'function ensureToolActivity(timeline) {', 1800);
  assert.match(fn, /'ai-tool-activity'/, '缺少 .ai-tool-activity 根容器');
  assert.match(fn, /'ai-tool-activity-head'/, '缺少总摘要行 .ai-tool-activity-head');
  assert.match(fn, /'ai-tool-activity-body'/, '缺少可折叠体 .ai-tool-activity-body');
  assert.match(fn, /'ai-tool-activity-label'/, '缺少摘要文案节点');
  assert.match(fn, /'ai-tool-activity-count'/, '缺少进度计数节点');
  assert.match(fn, /'ai-tool-activity-caret'/, '缺少折叠箭头');
  // 摘要行必须是可聚焦的可点击控件（键盘可达）
  assert.match(fn, /tabindex:\s*'0'/, '摘要行必须 tabindex=0，保证键盘可达');
  assert.match(fn, /role:\s*'button'/, '摘要行必须有 button 语义');
  assert.match(fn, /aria-expanded/, '摘要行必须维护 aria-expanded');
});

// ── 2. 所有轮次创建点都必须挂进活动区 body ────────────────────────────
test('方案A：三处轮次创建点都必须挂进活动区 body（不得直挂 timeline）', function () {
  // tool_calls / tool_pending / tool_error 三处都必须经过 toolActivityBody
  const bodyCalls = aiAgent.match(/toolActivityBody\(/g) || [];
  assert.ok(bodyCalls.length >= 4,
    `toolActivityBody 调用点不足（${bodyCalls.length} 处）：轮次与"整理中"都必须经它挂载`);

  // 反向断言：轮次容器不得再直接 append 到 timeline / pendingBar / errTimeline
  ['timeline.appendChild(roundBox)',
   'pendingBar.appendChild(pendRound)',
   'errTimeline.appendChild(errRound2)'].forEach(function (badCall) {
    assert.ok(aiAgent.indexOf(badCall) < 0,
      `发现轮次直挂父容器的旧写法「${badCall}」——必须改为挂进活动区 body`);
  });
});

test('方案A：挂载时必须保留兜底（活动区创建失败也不能丢轮次）', function () {
  // 三处挂载都应是 (_actBody || host).appendChild(...) 的兜底形态
  const fallbacks = aiAgent.match(/\(_actBody \|\| timeline\)|\(_pendActBody \|\| pendingBar\)|\(_errActBody \|\| errTimeline\)/g) || [];
  assert.equal(fallbacks.length, 3,
    `轮次挂载兜底缺失（找到 ${fallbacks.length} 处，期望 3 处）：活动区创建异常时必须退回挂原容器`);
});

// ── 3. "整理中"必须归位到活动区（本次核心修复）────────────────────────
test('已返回的工具不再被虚构的整理步骤保持为运行中', function () {
  assert.doesNotMatch(aiAgent, /'data-organizing': '1'/);
  assert.match(aiAgent, /processBody\(\)\.appendChild\(activeToolTimeline\)/);
});

// ── 4. 总摘要联动刷新 ─────────────────────────────────────────────────
test('方案A：轮次 / 整理中 / 强制收敛三条路径都要刷新活动区', function () {
  // updateToolRoundState 末尾
  const roundState = block(aiAgent, 'function updateToolRoundState(roundBox) {', 4200);
  assert.match(roundState, /refreshOwningToolActivity\(roundBox\)/,
    '轮次状态变化后必须刷新活动区总摘要');

  // settleOrganizingStep 末尾
  const settle = block(aiAgent, 'function settleOrganizingStep(node, opts) {', 4200);
  assert.match(settle, /refreshOwningToolActivity\(host\)/,
    '"整理中"收敛后必须刷新活动区，否则总摘要会卡在"正在整理结果"');
  // ★★★ 2026-09-28：占位收敛后，轮次容器与活动区自身的 is-running 也要落定。
  //   它们不在 .ai-tool-organizing 的 DOM 子树里，只靠上面的循环覆盖不到 ——
  //   结果是占位行显示"完成"、活动区头仍在转圈（用户报障形态）。
  assert.match(settle, /querySelectorAll\('\.ai-tool-round\.is-running'\)/,
    '占位收敛时必须一并落定仍在运行的轮次容器');
  assert.match(settle, /querySelectorAll\('\.ai-tool-activity\.is-running'\)/,
    '占位收敛时必须一并落定仍在运行的活动区');

  // forceSettleToolRound 兜底分支
  const force = block(aiAgent, 'function forceSettleToolRound(roundBox) {', 1800);
  assert.match(force, /refreshOwningToolActivity\(roundBox\)/,
    '强制收敛路径必须刷新活动区，否则中断后活动区会残留进行态');
});

test('方案A：refreshOwningToolActivity 必须双向查找（closest 只朝祖先，覆盖不到容器入参）', function () {
  // ★★★ 2026-09-28 修复的线上缺陷：
  //   原实现只用 node.closest('.ai-tool-activity')，而 closest 只朝**祖先**方向。
  //   但 settleOrganizingStep / clearAssistantTransientStatus 传入的是 assistantNode，
  //   活动区是它的**后代** → closest 恒 null → 活动区摘要永不刷新，
  //   于是"整理中已变完成、正文已渲染"时头行还在转。
  const fn = block(aiAgent, 'function refreshOwningToolActivity(node) {', 1200);
  assert.match(fn, /node\.closest \? node\.closest\('\.ai-tool-activity'\)/,
    '必须保留向上查找（节点本身/祖先即活动区）');
  assert.match(fn, /node\.querySelectorAll\(['"]\.ai-tool-activity['"]\)/,
    '必须补充向下查找（节点是容器、活动区在后代里）');
});

test('方案A：总摘要必须汇总轮数、工具数，并把"整理中"计入未完成', function () {
  const fn = block(aiAgent, 'function updateToolActivity(activity) {', 5200);
  assert.match(fn, /querySelectorAll\('\.ai-tool-round'\)/, '必须遍历所有轮次以汇总');
  assert.match(fn, /runningRounds/, '必须统计仍在运行的轮次');
  assert.match(fn, /ai-tool-organizing/, '必须检查"整理中"占位是否仍在运行');
  // ★★★ 2026-09-28 改写（原断言把"仅 totalSteps>0 才算完成"固化成契约）：
  //   原断言是 `runningRounds === 0 && !organizingRunning`。这条组合在
  //   「只有一个 organizing 占位、压根没有任何 .ai-tool-round」的场景下
  //   永远不会成立：totalSteps 恒为 0 → settled 恒 false →
  //   占位行已经显示"完成"、正文都开始渲染了，活动区头仍在转圈。
  //   现改为断言**行为等价的新表述**：
  //     · 进行中证据 = 运行中轮次 ∥ 运行中条目 ∥ 运行中占位；
  //     · 内容判据必须把占位计入（否则"只有占位"场景永远不会 settled）；
  //     · 二者共同决定 settled。
  assert.match(fn, /runningSteps/, '必须统计仍在运行的条目（含直挂 body 的）');
  assert.match(fn, /var stillRunning = runningRounds > 0 \|\| runningSteps > 0 \|\| organizingRunning/,
    '进行中证据必须涵盖：运行中轮次 / 运行中条目 / 运行中占位');
  assert.match(fn, /var hasAnyContent = \(totalSteps \+ \(organizing \? 1 : 0\)\) > 0/,
    '内容判据必须把"整理中"占位计入，否则只有占位时永不收敛');
  assert.match(fn, /var settled = hasAnyContent && !stillRunning/,
    'settled 必须由"有内容 且 无进行中证据"决定');
  // 完成后自动折叠
  assert.match(fn, /is-collapsed/, '活动区完成后必须自动折叠为一行');
});

// ── 5. CSS 结构契约 ───────────────────────────────────────────────────
test('方案A：CSS 必须定义活动区三层结构', function () {
  assert.match(css, /\.ai-tool-activity\s*\{/, '缺少 .ai-tool-activity 样式');
  assert.match(css, /\.ai-tool-activity-head\s*\{/, '缺少摘要行样式');
  assert.match(css, /\.ai-tool-activity-body\s*\{/, '缺少折叠体样式');
  assert.match(css, /\.ai-tool-activity-caret/, '缺少折叠箭头样式');
});

test('方案A：折叠必须用 grid-template-rows 过渡（唯一能平滑过渡未知高度的方案）', function () {
  const bodyRule = block(css, '.ai-tool-activity-body {', 400);
  assert.match(bodyRule, /grid-template-rows:\s*1fr/, '折叠体必须用 grid-template-rows 展开态');
  const collapsedRule = block(css, '.ai-tool-activity.is-collapsed .ai-tool-activity-body {', 200);
  assert.match(collapsedRule, /grid-template-rows:\s*0fr/, '折叠态必须是 0fr');
  assert.match(css, /transition:\s*grid-template-rows/, '必须对 grid-template-rows 做过渡');
});

test('方案A：总摘要行必须比轮次摘要行更弱化（保持 区域>轮次>条目 三级层次）', function () {
  const actHead = block(css, '.ai-tool-activity-head {', 500);
  const roundHead = css.match(/\.ai-tool-round-head\s*\{[^}]*font-size:\s*([\d.]+)px/);
  const actHeadSize = actHead.match(/font-size:\s*([\d.]+)px/);
  assert.ok(roundHead && actHeadSize, '无法提取摘要行字号');
  assert.ok(parseFloat(actHeadSize[1]) < parseFloat(roundHead[1]),
    `活动区摘要字号(${actHeadSize[1]}px)必须小于轮次摘要字号(${roundHead[1]}px)，否则层级感消失`);
});

test('方案A：必须覆盖深色主题与 reduced-motion 降级', function () {
  assert.match(css, /\[data-theme="dark"\]\s*\.ai-tool-activity-head/,
    '深色主题下活动区摘要行缺配色，会残留浅色硬编码');
  assert.match(css, /\[data-theme="dark"\]\s*\.ai-tool-activity-icon/,
    '深色主题下活动区图标缺配色');
  // reduced-motion 降级：新图标动画与折叠过渡都要停
  const rmStart = css.indexOf('@media (prefers-reduced-motion: reduce) {');
  assert.notEqual(rmStart, -1, '找不到 reduced-motion 区块');
  // 取到该 media 块结束（用 html[data-xtj-motion=off] 作为下一个锚点的近似边界）
  const rmEnd = css.indexOf('html[data-xtj-motion=off] .ai-tool-step', rmStart);
  const rmBlock = css.slice(rmStart, rmEnd > rmStart ? rmEnd : rmStart + 3000);
  assert.match(rmBlock, /\.ai-tool-activity-icon::before/, 'reduced-motion 下活动区图标动画未停');
  assert.match(rmBlock, /\.ai-tool-activity-body/, 'reduced-motion 下活动区折叠过渡未停');
  assert.match(css, /\[data-xtj-motion=off\][\s\S]{0,400}\.ai-tool-activity-icon::before/,
    'data-xtj-motion=off 开关下活动区图标动画未停');
});

// ── 6. 不破坏既有约定 ─────────────────────────────────────────────────
test('方案A：timeline 容器与既有查询路径必须保持可用', function () {
  // timeline 仍是外层容器（外部定位/清理逻辑依赖它）
  assert.match(aiAgent, /class:\s*'ai-tool-timeline ai-tool-status'/, 'timeline 容器不得被移除');
  assert.match(aiAgent, /processBody\(\)\.appendChild\(activeToolTimeline\)/,
    '开启思考时工具必须按顺序插进思考过程');
  // 既有以 timeline 为根的轮次查询必须仍然成立（活动区是其子节点）
  assert.match(aiAgent, /timeline\.querySelectorAll\('\.ai-tool-round\.is-running'\)/,
    '轮次查询不得从 timeline 根上移除（活动区在下一层，后代查询仍应生效）');
});

test('方案A：活动区折叠运行中必须被禁止（进度是用户此刻唯一想看的东西）', function () {
  const fn = block(aiAgent, 'function ensureToolActivity(timeline) {', 1800);
  assert.match(fn, /if \(activity\.classList\.contains\('is-running'\)\) return;/,
    '运行中必须禁止折叠活动区');
});
