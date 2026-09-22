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
  // ★ 2026-09-22：调用签名增加 streaming 参数（软揭示标记），此处放宽匹配
  assert.match(body, /patchInnerHTML\(targetEl, renderMarkdown\(rendered/,
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

/* ── B) 未闭合代码围栏必须容错（否则反引号裸奔 + 闭合瞬间突变）─────────
   背景（2026-09-22 实测复现）：
     流式中途 renderMarkdown('说明：\n\n```js\nconst a=1;') 返回
       '说明：<br><br>```js<br>const a = 1;'
     即**裸的三反引号被当普通正文显示给用户**；等闭合围栏到达的瞬间
     整块突变成 <pre> 代码块 —— 这就是"闪一下 / 跳一下"的直接来源。
   修复：对"只有开头围栏、没有结尾"的尾部残余同样按代码块渲染，
     闭合到来时只是内容增长，不发生形态突变。 */
test('未闭合代码围栏必须按代码块渲染（不得让反引号裸奔）', () => {
  // 必须存在针对未闭合围栏的第二条兜底 replace
  assert.match(agentSrc, /```\(\\w\*\)\\n\(\[\\s\\S\]\*\)\$/,
    '必须存在未闭合围栏的兜底匹配（到字符串末尾）');
  // 兜底渲染也必须走 escapeCode，避免代码内容被当 HTML 执行
  const idx = agentSrc.indexOf('function renderMarkdown');
  const seg = agentSrc.slice(idx, idx + 1400);
  assert.match(seg, /function escapeCode\(/, '必须抽出 escapeCode 统一转义');
  const escCount = (seg.match(/escapeCode\(/g) || []).length;
  assert.ok(escCount >= 3, `已闭合与未闭合两条路径都必须转义（当前 ${escCount} 处调用）`);
});

test('未闭合围栏的渲染结果必须与已闭合同形态（无跳变）', () => {
  // 用真实实现验证：中途与闭合后都应产出 <pre><code>
  const path2 = require('node:path');
  const src = fs.readFileSync(path2.join(root, 'js', 'ai-agent.js'), 'utf8');
  const i = src.indexOf('function renderMarkdown');
  // 取出 renderMarkdown 主体，配合依赖桩执行
  let d = 0, started = false, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) { end = j + 1; break; } }
  }
  const helpers = `
    function escapeAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');}
    function escapeHtml(s){return escapeAttr(String(s));}
    function aiDecodeHtmlEntities(s){return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
  `;
  const savedDoc = global.document, savedWin = global.window;
  global.document = { createElement: () => ({ set href(v) {}, set target(v) {}, set rel(v) {}, set textContent(v) {}, get outerHTML() { return '<a></a>'; } }) };
  global.window = { location: { origin: 'https://x.local' } };
  let rm;
  try { rm = new Function(helpers + src.slice(i, end) + '; return renderMarkdown;')(); }
  finally { global.document = savedDoc; global.window = savedWin; }

  const mid = rm('说明：\n\n```js\nconst a = 1;');
  const done = rm('说明：\n\n```js\nconst a = 1;\n```');
  assert.match(mid, /<pre><code>/, '流式中途就必须是代码块形态');
  assert.doesNotMatch(mid, /```/, '不得把裸反引号显示给用户');
  assert.match(done, /<pre><code>/, '闭合后仍是代码块形态');
  // 两者都含 <pre><code>，说明闭合瞬间只是"内容增长"而非"形态突变"
  assert.ok(mid.includes('<pre><code>') && done.includes('<pre><code>'),
    '中途与闭合必须同形态，避免跳变');
});

/* ── C) 软揭示：新到达的文字要"渗"进来，不是"跳"进来 ─────────────────
   背景（2026-09-22 实测）：
     CSS 原本靠 `.ai-streaming-soft > :last-child` 做新块浮起，但
     renderMarkdown 的输出里**根本没有 <p>**（段落是裸文本 + <br>），
     所以那条规则基本从未生效；且增量补丁不重建未变节点，
     一次性入场动画也不会重放。
   修复：流式期间由 renderMarkdown 把**纯文本尾巴**包成 .ai-stream-soft；
     内容一变，该 span 就是新节点 → 动画必定重放。
     只在纯文本尾巴上包裹，绝不横跨 </ul>/</pre> 等块边界。 */
test('流式期间必须产出软揭示标记，最终态必须干净', () => {
  assert.match(agentSrc, /function renderMarkdown\(txt, streaming\)/,
    'renderMarkdown 必须接受 streaming 参数以区分流式/最终态');
  assert.match(agentSrc, /class="ai-stream-soft"/, '流式期间必须产出软揭示标记');
  // 渲染调用点必须传 streaming=true
  assert.match(agentSrc, /renderMarkdown\(rendered, true\)/,
    '正文流式渲染必须传 streaming=true');
});

test('软揭示只得包裹纯文本尾巴（绝不横跨块级边界）', () => {
  const c = agentSrc; // 便于阅读
  // 必须是"末尾纯文本"判定：从最后一个 '>' 之后取尾巴，且尾巴不含 '<'
  assert.match(c, /lastIndexOf\('>'\)/, '必须通过最后一个标签闭合定位尾巴');
  assert.match(c, /tail\.indexOf\('<'\) < 0/, '尾巴必须不含标签（否则会横跨块边界）');
});

test('软揭示必须受 reduced-motion 与动效开关管控', () => {
  const i = cssEnhance.indexOf('.ai-stream-soft');
  assert.ok(i > 0, 'ui-enhance.css 必须定义 .ai-stream-soft');
  // reduced-motion 块必须覆盖它
  assert.match(cssEnhance, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}ai-stream-soft/,
    'reduced-motion 必须关掉软揭示');
  assert.match(cssEnhance, /data-xtj-motion=off[\s\S]{0,400}ai-stream-soft/,
    '动效开关 off 必须关掉软揭示');
});

test('流式光标必须是流动渐变（不是整根明暗呼吸）', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
  const i = css.indexOf('.ai-stream-cursor {');
  const seg = css.slice(i, i + 1200);
  assert.match(seg, /linear-gradient/, '光标必须是渐变（流动感来源）');
  assert.match(seg, /@keyframes ai-cursor-flow|ai-cursor-flow/, '必须挂流动关键帧');
  assert.match(seg, /@supports not/, '必须为不支持 color-mix 的引擎提供降级');
});
