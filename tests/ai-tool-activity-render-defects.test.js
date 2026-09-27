/**
 * 回归守卫：工具活动区「真实渲染」缺陷修复（2026-09-28）
 *
 * 背景（为什么单独建一个文件）：
 *   方案 A/B/C/D 第一版落地后，用户反馈「并没有达到你说的那些建议和方案、
 *   并没有真正落地，现在修复的有很多问题」。
 *   复盘时不再凭源码推断，改用 Chromium headless 加载**真实 CSS 规则 +
 *   真实 DOM 结构**（复用 js/ai-agent.js 里的 ensureToolActivity /
 *   createToolRound / updateToolActivity 原函数体）逐场景截图 + 量测几何，
 *   一次性暴露出 8 个靠读源码看不出来的缺陷。
 *
 * 本文件把这 8 个缺陷全部钉死。它们的共同特征是：
 *   **源码里"看起来写对了"，但渲染结果是错的** —— 因此断言必须落在
 *   "结构 + 具体数值 + 选择器归属"上，而不是"某个关键词出现过"。
 *
 * 清单：
 *   D1 活动区收起后 body 仍有 24px 残余高度（grid item 缺 min-height:0）
 *   D2 轮次收起后导轨线悬空（border 不随高度归零）
 *   D3 三层摘要重复（活动区头 + 每轮摘要行都在报同一件事）
 *   D4 "整理中"占位缩进错位（缺 list 那套 20px 缩进）
 *   D5 死选择器 .ai-tool-activity-inner（JS 从不创建该节点）
 *   D6 导轨节点被折叠容器的 overflow:hidden 裁掉左半边
 *   D7 占位继承了 .ai-tool-step.is-running::before 的 3px 粗光晕条
 *   D8 emoji 文本残留（🔍 在部分字体下退化成 ▷ 小三角）
 *   另附：流光动画铺满整行 label（观感像"被选中的高亮块"）
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

/** 取一条 CSS 规则的完整声明块（从选择器起到匹配的 } 为止）
 *  ★ 会先剥掉注释，避免"注释里提到的属性"被误判为真实声明
 *    （例如 .ai-tool-round-list 的注释里写着"不能加 overflow:hidden"）。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}
function rule(src, selector) {
  const clean = stripComments(src);
  const start = clean.indexOf(selector);
  assert.notEqual(start, -1, `找不到 CSS 规则: ${selector}`);
  const open = clean.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth === 0) return clean.slice(start, i + 1);
    }
  }
  assert.fail(`CSS 规则未闭合: ${selector}`);
}

// ── D1: 活动区折叠必须真的收干净（grid item 需显式 min-height:0）─────────
test('D1：活动区 body 的 grid item 必须显式 min-height:0（否则 0fr 轨道被 min-content 撑开）', function () {
  // 这是 24px 残余高度的根因：轨道设 0fr 只把"轨道"压到 0，
  // 轨道里的 item 默认 min-height:auto（= min-content）会把轨道重新顶开。
  assert.match(css, /\.ai-tool-activity-body\s*>\s*\*\s*\{[^}]*min-height:\s*0/,
    '缺 `.ai-tool-activity-body > * { min-height: 0 }`：收起后 body 会残留高度（实测 24px）');
  // 轮次折叠容器同一处坑，必须一起兜底
  assert.match(css, /\.ai-tool-round-list-wrap\s*>\s*\*\s*\{[^}]*min-height:\s*0/,
    '缺 `.ai-tool-round-list-wrap > * { min-height: 0 }`：轮次收起同样收不干净');
});

// ── D2: 轮次收起后导轨线不得悬空 ────────────────────────────────────────
test('D2：轮次收起后必须隐藏导轨线（border 不随高度归零，会留一条悬空竖线）', function () {
  const collapsed = rule(css, '.ai-tool-round.is-collapsed .ai-tool-round-list-wrap');
  assert.match(collapsed, /grid-template-rows:\s*0fr/, '收起态必须是 0fr');
  assert.match(collapsed, /visibility:\s*hidden/,
    '收起态必须 visibility:hidden，否则 list 的 border-left 会画出一条悬空竖线');
});

// ── D3: 三层摘要重复必须被收敛 ──────────────────────────────────────────
test('D3：活动区内的"已完成"轮次摘要行必须隐藏（信息已被总摘要归纳）', function () {
  const hideDone = rule(css, '.ai-tool-activity .ai-tool-round.is-done > .ai-tool-round-head');
  assert.match(hideDone, /display:\s*none/,
    '活动区里已完成的轮次摘要行必须整行隐藏；否则一个回复会同时出现'
    + '「活动区总摘要 + 每个轮次的 已完成 N 个工具」，即三层同义重复');
});

test('D3：单轮场景下运行中的轮次摘要行也要隐藏（避免同义反复）', function () {
  assert.match(css, /\.ai-tool-activity \.ai-tool-round\.is-running:first-child:last-child\s*>\s*\.ai-tool-round-head\s*\{[^}]*display:\s*none/,
    '单轮（活动区里只有一个轮次）时，运行中的轮次摘要行是冗余的第二套标题，必须隐藏');
});

test('D3：活动区头在"整理中"期间只说状态，不重复占位的动作描述', function () {
  const fn = block(aiAgent, 'function updateToolActivity(activity) {', 5200);
  assert.doesNotMatch(fn, /'正在整理结果'/,
    '活动区头不得再写"正在整理结果"——具体动作由"整理检索结果并作答"占位承载，'
    + '两行都说"整理"就是同义反复（真实渲染里是上下两行同一件事）');
  assert.match(fn, /'正在使用工具'/, '活动区头在运行中应保持"正在使用工具"这类状态措辞');
});

// ── D4: "整理中"占位缩进必须与条目对齐 ──────────────────────────────────
test('D4：活动区内的"整理中"占位必须复用与条目一致的 20px 缩进', function () {
  // 注意锚点必须带 " {"，否则会先命中同选择器的 ::before 规则（只有 display:none）
  const orgRule = rule(css, '.ai-tool-activity-body > .ai-tool-step.ai-tool-organizing {');
  assert.match(orgRule, /margin-left:\s*9px/,
    '占位缺 margin-left:9px —— 条目经过 list 的 margin-left:9px，占位没有就会左移错位');
  assert.match(orgRule, /padding-left:\s*10px/,
    '占位缺 padding-left:10px —— 与 list 的 padding-left 对齐后图标才落在同一竖线');
  assert.match(orgRule, /border-left/,
    '占位需要同款导轨线，否则时间轴在占位处断开');
  // 占位是 flex column 的子项，默认 stretch 会把导轨线拉成"拖尾"
  assert.match(orgRule, /align-self:\s*flex-start/,
    '占位必须 align-self:flex-start，否则 border-left 会被拉长成拖尾');
});

// ── D5: 死选择器必须清掉 ────────────────────────────────────────────────
test('D5：不得存在 .ai-tool-activity-inner 这类 JS 从不创建的死选择器', function () {
  assert.doesNotMatch(css, /\.ai-tool-activity-inner/,
    '.ai-tool-activity-inner 在 JS 中从未被创建（grep 零命中），是无用规则，'
    + '留着会让后来者以为存在这一层 wrapper');
  assert.doesNotMatch(css, new RegExp('\\.ai-tool-activity-body\\s*>\\s*\\.ai-tool-activity-inner'));
});

// ── D6: 折叠容器不得裁掉导轨节点 ────────────────────────────────────────
test('D6：list 不得带 overflow:hidden（会裁掉负偏移的导轨节点左半边）', function () {
  const listRule = rule(css, '.ai-tool-round-list {');
  assert.doesNotMatch(listRule, /overflow:\s*hidden/,
    '.ai-tool-round-list 带 overflow:hidden 会把 ::after 节点（left:-14px）裁掉左半边；'
    + '裁切职责应上移到 .ai-tool-round-list-wrap');
  // 裁切职责上移后，wrap 必须承担
  const wrapRule = rule(css, '.ai-tool-round-list-wrap {');
  assert.match(wrapRule, /overflow:\s*hidden/,
    '.ai-tool-round-list-wrap 必须承担折叠裁切（overflow:hidden），否则收起时内容溢出');
});

test('D6：导轨节点必须用负偏移精确落在导轨线上（改动 padding 必须重算）', function () {
  const nodeRule = rule(css, '.ai-tool-round-list .ai-tool-step::after');
  assert.match(nodeRule, /position:\s*absolute/);
  assert.match(nodeRule, /left:\s*-14px/,
    '节点 left 必须约 -14px：list 有 border 1.5px + padding 10px，'
    + '节点半径 3.5px ⇒ -(11.5-0.75+3.5) ≈ -14.25，取 -14');
  assert.match(nodeRule, /border-radius:\s*50%/);
  // 三态必须齐全
  assert.match(css, /\.ai-tool-round-list \.ai-tool-step\.is-running::after/, '缺"当前"态节点');
  assert.match(css, /\.ai-tool-round-list \.ai-tool-step\.is-done::after/, '缺"已过"态节点');
  assert.match(css, /\.ai-tool-round-list \.ai-tool-step\.is-error::after/, '缺"失败"态节点');
});

// ── D7: 占位不得继承 3px 粗光晕条 ───────────────────────────────────────
test('D7："整理中"占位必须关掉 .ai-tool-step.is-running::before 的粗光晕条', function () {
  assert.match(css, /\.ai-tool-step\.ai-tool-organizing(?:\.is-running)?::before\s*\{[^}]*display:\s*none/,
    '占位同时带 .ai-tool-step.is-running，会继承那条 3px 宽的渐变光晕条；'
    + '它自己有 border-left 导轨，光晕必须关掉（真实渲染里是一条突兀的粗蓝绿竖线）');
});

// ── D8: emoji 文本必须彻底隐身 ──────────────────────────────────────────
test('D8：图标位不得由 JS 写入 emoji 文本（CSS ::before 才是唯一图形来源）', function () {
  // emoji 是彩色字形：color 对它无效，font-size:0 在 Chromium 下还会退化成
  // fallback 字形（实测渲染成 ▷ 小三角），所以最稳的是**根本不写 emoji**。
  const iconAssigns = aiAgent.match(/class:\s*'ai-tool-step-icon'[^)]*\)/g) || [];
  assert.ok(iconAssigns.length >= 4, `图标位数量异常：${iconAssigns.length}`);
  iconAssigns.forEach(function (snippet) {
    assert.doesNotMatch(snippet, /\btext:/,
      '图标位不得写 text（emoji），否则会在部分字体下漏出 fallback 字形：' + snippet);
  });
});

test('D8：图标容器必须带双重隐身兜底（color:transparent + text-indent）', function () {
  const iconRule = rule(css, '.ai-tool-round-list .ai-tool-step-icon {');
  assert.match(iconRule, /color:\s*transparent/, '缺 color:transparent 兜底');
  assert.match(iconRule, /text-indent:\s*-\d+px/, '缺 text-indent 兜底（把 fallback 字形推出可视区）');
  assert.match(iconRule, /overflow:\s*hidden/);
});

test('D8：所有 static 定位的伪元素必须重置 text-indent（否则 ✓/! 会被推出视野）', function () {
  // 父级为了藏 emoji 设了 text-indent:-999px；static 定位的 ::before 属于文本流，
  // 会被一起推走 → 终态的对勾/叹号消失。每个 static 伪元素都要显式清零。
  const clean = stripComments(css);
  const re = /::before\s*\{([^}]*)\}/g;
  let m, totalStatic = 0, missing = [];
  while ((m = re.exec(clean)) !== null) {
    const body = m[1];
    if (!/position:\s*static\b/.test(body)) continue;
    totalStatic++;
    if (!/text-indent:\s*0/.test(body)) missing.push(m[0].slice(0, 110));
  }
  assert.ok(totalStatic >= 4,
    `带 position:static 的 ::before 数量异常：${totalStatic}（预期 ≥4 个终态图形）`);
  assert.equal(missing.length, 0,
    `以下 static 定位的 ::before 未重置 text-indent:0，图形会被推出可视区：\n${missing.join('\n')}`);
});

// ── 附:流光动画不得铺满整行 ─────────────────────────────────────────────
test('附：运行中流光必须只覆盖文案宽度，不得铺满整行（否则像"选中的高亮块"）', function () {
  assert.match(css, /\.ai-tool-round\.is-running \.ai-tool-round-label\s*\{[^}]*flex:\s*0 1 auto/,
    'label 必须 flex:0 1 auto 收缩到内容宽度；用 flex:1 1 auto 会让渐变横跨整行，'
    + '真实渲染里表现为一整条蓝色高亮块（实测宽度 590px → 修后 97px）');
  assert.match(css, /\.ai-tool-round\.is-running \.ai-tool-round-label\s*\{[^}]*max-width:\s*100%/,
    '收缩后仍需 max-width:100% 兜底，保证长文案不撑破容器');
});

// ── 综合:修复不得回退到"每轮自带外框"的旧形态 ────────────────────────────
test('综合：活动区内的轮次必须是"分段"而非"独立卡片"', function () {
  const roundRule = rule(css, '.ai-tool-activity .ai-tool-round {');
  assert.match(roundRule, /background:\s*transparent/,
    '活动区内轮次必须去背景，否则又变回一叠独立卡片');
  assert.match(roundRule, /border-radius:\s*0/,
    '活动区内轮次必须去圆角');
});
