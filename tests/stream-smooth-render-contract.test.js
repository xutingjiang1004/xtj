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
  const seg = agentSrc.slice(i, agentSrc.indexOf('function createSmoothTextRenderer', i));
  // 相同则跳过 —— 不碰未变节点
  assert.match(seg, /have\.isEqualNode\(want\)\)\) return/,
    '未变化节点必须跳过，否则等于整段重建');
  // 不同的才替换
  assert.match(seg, /replaceChild\(/, '变化节点必须用 replaceChild 就地替换');
  // 结构异常兜底：整段替换，保证显示正确性
  assert.match(seg, /targetEl\.innerHTML = html/, '必须保留整段替换兜底');
  // 节点数骤减说明发生重排 —— 直接整段替换
  assert.match(seg, /for \(; pos < old\.length; pos\+\+\)/, '结构收缩时必须移除旧的尾部节点');
});

test('流式渲染门限已收紧（流畅度的直接来源）', () => {
  // 增量补丁把每帧成本降到 O(1) 后，门限才能从 90/140ms 收紧到 0/16ms
  assert.match(agentSrc, /var _renderGap = 0;/,
    'ai-agent.js 每个 requestAnimationFrame 都应允许正文补丁，不用固定毫秒门限跳帧');
  assert.match(coreSrc, /var _renderGap = 0;/,
    'stream-renderer.js 每个 requestAnimationFrame 都应允许正文补丁，不用固定毫秒门限跳帧');
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

test('未闭合围栏的渲染结果必须与已闭合同形态（无跳变）', async () => {
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
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let mid, done;
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(code => {
      const rm = new Function(code + '; return renderMarkdown;')();
      return { mid: rm('说明：\n\n```js\nconst a = 1;'), done: rm('说明：\n\n```js\nconst a = 1;\n```') };
    }, helpers + src.slice(i, end));
    mid = result.mid; done = result.done;
  } finally { await browser.close(); }

  assert.match(mid, /<pre><code>/, '流式中途就必须是代码块形态');
  assert.doesNotMatch(mid, /```/, '不得把裸反引号显示给用户');
  assert.match(done, /<pre><code>/, '闭合后仍是代码块形态');
  // 两者都含 <pre><code>，说明闭合瞬间只是"内容增长"而非"形态突变"
  assert.ok(mid.includes('<pre><code>') && done.includes('<pre><code>'),
    '中途与闭合必须同形态，避免跳变');
});

// Animate only appended text. Markdown must keep the same structure at completion.
test('正文增量淡入不重新包裹整个旧尾段', () => {
  for (const source of [agentSrc, coreSrc]) {
    assert.match(source, /function isReveal/);
    assert.match(source, /className = 'ai-stream-reveal'/);
    assert.match(source, /document.createTextNode/);
    assert.match(source, /__aiFlowEpoch !== completedEpoch/);
  }
  assert.doesNotMatch(agentSrc, /class="ai-stream-soft"/);
});

test('新增文字动效限制延迟，不移动正文位置', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
  assert.match(css, /aiTextFlow 180ms/);
  assert.match(css, /@keyframes aiTextFlow/);
  for (const source of [agentSrc, coreSrc]) assert.match(source, /Math\.min\(900, chars \* 3\)/);
});

test('正文淡入受系统及站内关闭动效设置管控', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\).*ai-stream-reveal/);
  assert.match(css, /data-xtj-motion="off".*ai-stream-reveal/);
});

test('流式光标必须是流动渐变（不是整根明暗呼吸）', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
  const i = css.indexOf('.ai-stream-cursor {');
  const seg = css.slice(i, i + 1200);
  assert.match(seg, /linear-gradient/, '光标必须是渐变（流动感来源）');
  assert.match(seg, /@keyframes ai-cursor-flow|ai-cursor-flow/, '必须挂流动关键帧');
  assert.match(seg, /@supports not/, '必须为不支持 color-mix 的引擎提供降级');
});
