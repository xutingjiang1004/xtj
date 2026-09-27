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

/** 与 CSS 版一致：断言"代码行为"时必须先剥掉注释，
 *  否则修复说明里提到的旧代码（如 `toolBar2.appendChild(resultCard)`）
 *  会被误判为"缺陷仍然存在"。
 *
 *  ★ 2026-09-28 修正：原实现用正则删除行注释（形如 replace 加 "(^|[^:])\/\/[^\n]*"），
 *    会把 URL 里的双斜杠之后、以及大量正常代码一并吃掉
 *    （实测剥离后只剩 294KB / 原文 557KB，丢了 47% 内容），
 *    导致"计数类"断言（如 toolLabel 调用点数）永远偏低而误报。
 *    改为逐字符状态机：正确跳过块注释、行注释与字符串字面量，
 *    只删除真正的注释文本。 */
function stripJsComments(s) {
  let out = '', i = 0, quote = null, inBlock = false;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 2; } else i++; continue; }
    if (quote) {
      out += c;
      if (c === '\\') { out += (s[i + 1] || ''); i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c; i++;
  }
  return out;
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

test('D8：条目内图标位必须隐藏（状态改由导轨节点独家表达，消除双圆冗余）', function () {
  // ★ 2026-09-28（去冗余）契约演进：
  //   过去条目左侧同时有「导轨节点 ::after」+「图标位 ::before」两个圆表达状态，
  //   4x 放大截图里表现为"实心蓝点 + 空心圆环"并排，信息完全重复。
  //   现隐藏整个图标位；D8 原来的"emoji 隐身兜底"（color:transparent /
  //   text-indent:-999px）已随 display:none 一并失去意义，不再要求。
  //   新不变量：图标位必须隐藏，且运行态（3 类选择器）也要显式隐藏——
  //   否则它的高优先级规则会覆盖 2 类规则、空心环重新漏出（真实渲染实证）。
  const iconRule = rule(css, '.ai-tool-round-list .ai-tool-step-icon {');
  assert.match(iconRule, /display:\s*none/, '条目内图标位必须 display:none');
  const runningIconRule = rule(css, '.ai-tool-round-list .ai-tool-step.is-running .ai-tool-step-icon {');
  assert.match(runningIconRule, /display:\s*none/,
    '运行态必须显式 display:none（3 类选择器优先级高于 2 类，漏写会让空心环漏出）');
  // 导轨节点是唯一状态载体 → 三态必须齐备
  assert.match(css, /\.ai-tool-round-list \.ai-tool-step\.is-running::after\s*\{[^}]*background/, '运行态节点必须实心');
  assert.match(css, /\.ai-tool-round-list \.ai-tool-step\.is-done::after\s*\{[^}]*background:\s*#3a9271/, '完成态节点必须实心绿');
  assert.match(css, /\.ai-tool-round-list \.ai-tool-step\.is-error::after\s*\{[^}]*background:\s*#c44b5a/, '失败态节点必须实心红');
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

// ══════════════════════════════════════════════════════════════════════
// 2026-09-28 第二轮（用户报障）：
//   「他调用工具，如果从运行中的状态完成了，不应该在原来的基础上变成/勾选上完成态吗？
//     为什么搜索网页、搜索天气搜好了之后，下面又显示一个已完成工具，
//     但原先那个工具还在运行、还在转圈圈？」
//
// 真实成因（三处，全部在 tool_result / tool_calls 分支）：
//   E1 tool_result 的结果卡片 `toolBar2.appendChild(resultCard)`，而 toolBar2 是
//      **外层 .ai-tool-timeline** → 卡片落在 .ai-tool-activity 外面，看起来就是
//      "活动区里还在转，活动区下面凭空多出一个已完成"。
//   E2 条目匹配用 `firstRunningStep` —— 全 timeline 范围内第一个还在转的同名条目，
//      **完全无视轮次归属**，多轮同名时认领错人 → 真正在跑的那条没人收敛，一直转。
//   E3 tool_calls 复用旧条目时只判 is-running，不复用"未认领"约束，
//      也没清 data-tool-claimed → 新一轮的 result 认领不到被复用的条目 → 一直转。
// ══════════════════════════════════════════════════════════════════════

test('E1：tool_result 的结果卡片必须落在活动区内，不得挂到外层 timeline', function () {
  const seg = stripJsComments(block(aiAgent, "if (evt.type === 'tool_result') {", 12000));
  assert.doesNotMatch(seg, /toolBar2\.appendChild\(resultCard\)/,
    '结果卡片不得再挂到 toolBar2（=外层 .ai-tool-timeline）——那会让卡片落在'
    + '活动区外面，用户看到"活动区里还在转圈、下面却多出一个已完成"');
  assert.match(seg, /closest\(['"]\.ai-tool-round['"]\)/,
    '结果卡片必须定位到所属轮次（closest .ai-tool-round）后再插入');
  assert.match(seg, /toolActivityBody\(toolBar2\)/,
    '兜底路径也必须挂在活动区内（toolActivityBody）');
});

test('E1：同一工具重复返回时必须复用已有卡片，不得堆叠', function () {
  const seg = block(aiAgent, "if (evt.type === 'tool_result') {", 12000);
  assert.match(seg, /ai-tool-result-card/);
  assert.match(seg, /nextElementSibling/,
    '必须用 nextElementSibling 判断"紧邻已有卡片"以复用，否则每个 result 都新建一张');
  assert.match(seg, /fillResultCard/,
    '复用时只重填内容（fillResultCard），而不是再插入一个新节点');
});

test('E2：条目匹配不得使用跨轮的 firstRunningStep', function () {
  const seg = stripJsComments(block(aiAgent, "if (evt.type === 'tool_result') {", 12000));
  assert.doesNotMatch(seg, /firstRunningStep/,
    'firstRunningStep 取全 timeline 第一个 running 的同名条目、无视轮次归属，'
    + '多轮同名工具时会认领错人，导致真正在跑的条目永远转圈');
  assert.match(seg, /unclaimedNamedStep/,
    '必须改为"未认领的同名 running 条目"FIFO 认领（unclaimedNamedStep）');
});

test('E2：认领必须打 data-tool-claimed 标记（保证同名并行工具各自配对）', function () {
  const seg = block(aiAgent, "if (evt.type === 'tool_result') {", 12000);
  assert.match(seg, /setAttribute\(['"]data-tool-claimed['"],\s*['"]1['"]\)/,
    '匹配到的条目必须打 data-tool-claimed=1，否则同一 result 会重复命中、'
    + '而另一条同名条目永远等不到自己的 result');
  assert.match(seg, /getAttribute\(['"]data-tool-claimed['"]\)/,
    '匹配时要跳过已认领的条目');
});

test('E2：只匹配到"已完成"条目时必须兜底收敛残留的同名 running 条目', function () {
  const seg = block(aiAgent, "if (evt.type === 'tool_result') {", 12000);
  assert.match(seg, /_stragglers/,
    '兜底路径缺失：只匹配到已完成条目时，同名的 running 条目会永久转圈，'
    + '必须扫一遍并强制收敛（对应"原先那个工具还在转圈圈"）');
});

test('E3：tool_calls 复用旧条目时必须清掉 data-tool-claimed', function () {
  const seg = block(aiAgent, "toolList.forEach(function(t) {", 4000);
  assert.match(seg, /removeAttribute\(['"]data-tool-claimed['"]\)/,
    '重激活条目 = 开启新执行轮次，必须清除上一轮的 claimed 标记，'
    + '否则新一轮的 result 会因 claimed=1 认领不到它 → 一直转圈');
  const claimGuard = seg.match(/getAttribute\(['"]data-tool-claimed['"]\)\s*!==\s*['"]1['"]/);
  assert.ok(claimGuard,
    '复用候选必须排除"已被认领"的条目，否则两次调用共用同一条 DOM');
});

test('E3：不得复用 .ai-tool-organizing 占位作为普通工具条目', function () {
  const seg = block(aiAgent, "toolList.forEach(function(t) {", 4000);
  assert.match(seg, /ai-tool-organizing/,
    '"整理中"占位也带 data-tool-name，复用循环必须显式排除它');
});

// ── E4: 共享辅助函数的作用域守卫 ────────────────────────────────────────
/**
 * 背景（线上致命 bug，2026-09-28 用户截图报障）：
 *   TOOL_LABELS / toolLabel 曾被**误插入 ensureToolActivity 函数体内部**。
 *   后果有两条，且压缩后更难发现：
 *     ① ensureToolActivity 被拦腰截断，尾部（activity.__startedAt /
 *        timeline.appendChild / return activity）掉到函数外变成裸语句；
 *     ② toolLabel 成为 ensureToolActivity 的**局部函数**，而调用它的
 *        tool_calls / tool_result 分支在别的作用域 → 一旦真的触发工具调用
 *        就抛 `Can't find variable: toolLabel`（Terser 把定义 mangle 掉，
 *        产物里只剩调用点保留原名，肉眼 grep 定义会误以为"函数没写"）。
 *   纯文本 `assert.match(/function toolLabel\(/)` 完全抓不到这个问题——
 *   定义确实存在，只是**位置错了**。所以这里必须做真实的作用域判定。
 */

/** 用花括号配平判断某位置是否嵌套在函数体内部。
 *  只统计 {} ，忽略字符串/正则/注释里的干扰（先剥注释；本文件的
 *  作用域检查目标代码里没有含 {} 的字符串字面量）。 */
function depthAt(src, index) {
  // 在原文里逐字符扫描，遇到注释/字符串就跳过（不能先剥离再算 —— 剥离会改变长度）
  let depth = 0, i = 0;
  const end = Math.min(index, src.length);
  let inBlock = false, inLine = false;
  let quote = null;
  while (i < end) {
    const c = src[i], n = src[i + 1];
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 2; continue; } i++; continue; }
    if (inLine) { if (c === '\n') inLine = false; i++; continue; }
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return depth;
}

test('E4：TOOL_LABELS / toolLabel 必须与工具区其他辅助函数同层（不得嵌进函数体）', function () {
  const labelsIdx = aiAgent.indexOf('var TOOL_LABELS = {');
  assert.notEqual(labelsIdx, -1, 'TOOL_LABELS 定义必须存在');
  const fnIdx = aiAgent.indexOf('function toolLabel(');
  assert.notEqual(fnIdx, -1, 'toolLabel 定义必须存在');

  // 基准：ensureToolActivity / toolActivityBody 所在层级即"模块级"。
  // （ai-agent.js 整体包在 IIFE + 块作用域中，绝对深度不是 0，
  //   因此不能硬编码 0 —— 必须拿同类辅助函数做参照。）
  const baseIdx = aiAgent.indexOf('function ensureToolActivity(timeline) {');
  assert.notEqual(baseIdx, -1, 'ensureToolActivity 必须存在（作为层级基准）');
  const base = depthAt(aiAgent, baseIdx);

  const labelsDepth = depthAt(aiAgent, labelsIdx);
  const fnDepth = depthAt(aiAgent, fnIdx);
  assert.equal(labelsDepth, base,
    `TOOL_LABELS 必须与其他辅助函数同层（期望深度 ${base}，实际 ${labelsDepth}）。`
    + '若被插进某个函数体，调用方会拿不到它；同时会把宿主函数拦腰截断。');
  assert.equal(fnDepth, base,
    `toolLabel 必须与其他辅助函数同层（期望深度 ${base}，实际 ${fnDepth}）。`
    + '嵌进 ensureToolActivity 等函数体时会变成局部函数，'
    + 'tool_calls / tool_result 分支调用它必然抛 ReferenceError。');
  assert.ok(fnIdx > labelsIdx, 'toolLabel 必须定义在 TOOL_LABELS 之后（它依赖该表）');
});

test('E4：ensureToolActivity 必须完整（尾部不得掉到函数体外）', function () {
  const start = aiAgent.indexOf('function ensureToolActivity(timeline) {');
  assert.notEqual(start, -1, 'ensureToolActivity 必须存在');
  // 从函数起点做花括号配平，取回它真正的函数体范围
  let depth = 0, i = aiAgent.indexOf('{', start), end = -1;
  for (; i < aiAgent.length; i++) {
    if (aiAgent[i] === '{') depth++;
    else if (aiAgent[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.notEqual(end, -1, 'ensureToolActivity 花括号未配平');
  const body = stripJsComments(aiAgent.slice(start, end + 1));
  assert.match(body, /activity\.__startedAt\s*=\s*Date\.now\(\)/,
    'activity.__startedAt 必须在函数体内（曾因中间插入映射表而掉到函数外）');
  assert.match(body, /timeline\.appendChild\(activity\)/, 'timeline.appendChild 必须在函数体内');
  assert.match(body, /return activity/, 'return activity 必须在函数体内');
  // 反向断言：函数体里不得再出现 TOOL_LABELS 的整表定义
  assert.doesNotMatch(body, /var TOOL_LABELS = \{/,
    'TOOL_LABELS 不得被定义在 ensureToolActivity 内部');
});

test('E4：toolLabel 的每个调用点都必须看得到定义（产物同名性）', function () {
  // 源码层：调用点数 ≥3（tool_calls / tool_result / 其他）
  const calls = (stripJsComments(aiAgent).match(/toolLabel\(/g) || []).length;
  assert.ok(calls >= 3, `toolLabel 调用点应 ≥3，实际 ${calls}`);
  // 产物层：定义与调用必须被 mangle 成**同一个**名字。
  // 若定义在错误作用域，Terser 只会改定义名、调用点保留原名 → 两者不一致。
  const min = read('js/ai-agent.min.js');
  const def = min.match(/规划任务"\};\s*function\s+([A-Za-z_$][\w$]*)\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*var\s+[A-Za-z_$][\w$]*\s*=\s*String/);
  assert.ok(def, '产物中必须能定位到工具名映射函数（紧随映射表定义之后）');
  const fnName = def[1];
  const callRe = new RegExp('\\b' + fnName.replace(/\$/g, '\\$') + '\\(', 'g');
  const minCalls = (min.match(callRe) || []).length;
  assert.ok(minCalls >= 2,
    `产物中该函数名的调用次数应 ≥2（实际 ${minCalls}）。`
    + '若为 0，说明调用点仍写着未 mangle 的 toolLabel，而定义已被改名 —— '
    + '这正是线上 "Can\'t find variable: toolLabel" 的形态。');
  assert.doesNotMatch(min, /\btoolLabel\s*\(/,
    '产物中不得残留未改名的 toolLabel 调用（定义已 mangle，调用必须同步）');
});

// ═══════════════════════════════════════════════════════════════
// 2026-09-28 第二轮守卫：折叠「确定性收法」+ 多轮间距 gap 化 + 整理完成文案
//
// 背景（接手中断会话的实测结论）：
//   ① 即便 body 的直接子元素全部 min-height:0，嵌套内容（round-head 的
//      padding 2px 4px + min-height 20px、result-card 的 margin 4px +
//      border 1px + padding 10px）仍通过嵌套 grid/flex 的 min-content
//      链条把 0fr 轨道顶开 —— Chromium 实测收起后第二轮残留 62px。
//      这些是内容自身的必要样式，不能删 → 最终态必须与轨道计算解耦。
//   ② 首间距/轮间距的 margin-top: 2px 属于 item 盒子，同链条顶开轨道。
//      间距改由 grid 的 row-gap 承担（gap 是轨道间距，不参与 item 尺寸计算）。
//   ③ 用户三次报障「他竟然整理好了，不应该把整理中三个字变成整理完成吗」
//      → 占位落定文案「整理中」必须原位变「整理完成」。

test('D9：活动区 body 收起态必须 height:0 锁死（确定性收法）', function () {
  const m = css.match(/\.ai-tool-activity\.is-collapsed \.ai-tool-activity-body\s*\{[^}]*\}/);
  assert.ok(m, '规则 .ai-tool-activity.is-collapsed .ai-tool-activity-body 必须存在');
  assert.match(m[0], /height:\s*0\s*!important/,
    '收起态必须 height:0 !important —— 0fr 最终态会被嵌套内容的 min-content 链条顶开（实测残留 62px）');
  assert.match(m[0], /min-height:\s*0\s*!important/, 'min-height 必须同步锁 0');
  assert.match(m[0], /pointer-events:\s*none/, '收起态不得参与命中测试（看不见但能点到）');
});

test('D10：单轮 list-wrap 收起态必须 height:0 锁死（与 D9 同一修法）', function () {
  const m = css.match(/\.ai-tool-round\.is-collapsed \.ai-tool-round-list-wrap\s*\{[^}]*\}/);
  assert.ok(m, '规则 .ai-tool-round.is-collapsed .ai-tool-round-list-wrap 必须存在');
  assert.match(m[0], /height:\s*0\s*!important/, '收起态必须 height:0 !important');
  assert.match(m[0], /visibility:\s*hidden/, '导轨线必须随收起隐藏（border 不随高度归零）');
});

test('D11：活动区多轮间距必须由 row-gap 承担（margin 顶开轨道回归防护）', function () {
  const bodyRule = css.match(/\.ai-tool-activity-body\s*\{[^}]*\}/);
  assert.ok(bodyRule, '.ai-tool-activity-body 主规则必须存在');
  assert.match(bodyRule[0], /row-gap:\s*3px/, 'body 必须用 row-gap 承担多轮间距（gap 不参与 item 尺寸计算）');
  // 两条 margin-top: 2px 旧规则已删，不得回归
  assert.doesNotMatch(css, /\.ai-tool-activity-body > \.ai-tool-(?:round|step):first-child\s*\{[^}]*margin-top/,
    '首元素 margin-top 2px 已删（计入 item 盒子、顶开收起态轨道），不得回归');
  assert.doesNotMatch(css, /\.ai-tool-activity \.ai-tool-round\.is-done:not\(:first-child\)\s*\{[^}]*margin-top/,
    '已完成轮次 margin-top 2px 已删，不得回归');
  // 活动区内轮间距 margin 必须显式清零，压掉全局 `.ai-tool-round + .ai-tool-round { margin-top: 2px }` 的叠加
  const sep = css.match(/\.ai-tool-activity \.ai-tool-round \+ \.ai-tool-round\s*\{[^}]*\}/);
  assert.ok(sep, '活动区内轮次分隔线规则必须存在');
  assert.match(sep[0], /margin-top:\s*0/, '活动区内轮间距 margin 必须清零（由 row-gap 接管，避免 gap+margin 双重叠加）');
  assert.match(sep[0], /border-top:\s*1px dashed/, '轮次分隔虚线必须保留');
});

test('R1：「整理中」占位落定文案必须是「整理完成」（原位收敛叙事闭合）', function () {
  const src = stripJsComments(aiAgent);
  const fnStart = src.indexOf('function settleOrganizingStep(');
  assert.notEqual(fnStart, -1, 'settleOrganizingStep 必须存在');
  // 花括号配平取完整函数体
  let depth = 0, i = src.indexOf('{', fnStart), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.notEqual(end, -1, 'settleOrganizingStep 花括号未配平');
  const body = src.slice(fnStart, end + 1);
  assert.match(body, /'整理完成'/,
    '落定文案必须是「整理完成」—— 用户报障原话：他竟然整理好了，不应该把整理中三个字变成整理完成吗');
  assert.match(body, /'整理失败'/, '失败落定文案必须是「整理失败」');
  assert.doesNotMatch(body, /=\s*ok\s*\?\s*'完成'/, '不得回落到裸「完成」（对用户而言叙事不闭合）');
});
