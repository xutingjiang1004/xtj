/**
 * P0 合约：+ 号（更多选项）面板不得卡在缩放中间态
 *
 * 缺陷现象（用户截图实证）：点击 + 后弹出面板，面板卡在
 * 「可见但极小」的形态（内容整体缩成左下角一小块），
 * 且无法正常打开/关闭。
 *
 * 根因：
 *   ① openPanel 把 panelShell.classList.add('open') 放在 requestAnimationFrame
 *      回调里 → rAF 被浏览器节流/延迟时 .open 迟迟不加，面板停在
 *      is-opening（opacity:0）不可见；再点 + 被 panelOpen=true 守卫挡住 → 无反应。
 *   ② 视觉补间使用 transform transition → 补间被中断时部分环境下
 *      元素会冻结在 scale(0.14) 的中间帧，即截图里的「小页面」。
 *
 * 修复契约：
 *   - 不得用 requestAnimationFrame 延迟补加 .open（须 reflow 后同步加）
 *   - .open / .is-closing 的视觉补间必须用 animation + both 填充，
 *     保证动画必然到达终态，机制上不可能停在中间态
 *   - _panelCleanup 必须复位视觉类，杜绝残留
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js/ai-agent.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'css/ai-agent.css'), 'utf8');

test('openPanel 不得用 requestAnimationFrame 延迟补加 .open', () => {
  const start = agentSrc.indexOf('function openPanel()');
  assert.ok(start > 0, 'openPanel 必须存在');
  const end = agentSrc.indexOf('function closePanel(', start);
  const body = agentSrc.slice(start, end > 0 ? end : start + 3000);
  assert.doesNotMatch(
    body,
    /requestAnimationFrame\s*\(/,
    '不能在 rAF 回调里补加 .open：rAF 被节流时面板会永久停留不可见态'
  );
  assert.match(
    body,
    /panelShell\.classList\.add\('open'\)/,
    '必须在 reflow 后同步添加 .open'
  );
});

test('.open 与 .is-closing 必须用 clip-path 揭示过渡（流动感的核心）', () => {
  const openRule = cssSrc.match(/\.ai-plus-panel-shell\.open\s*\{[^}]*\}/);
  const closingRule = cssSrc.match(/\.ai-plus-panel-shell\.is-closing\s*\{[^}]*\}/);
  assert.ok(openRule, '.ai-plus-panel-shell.open 规则必须存在');
  assert.ok(closingRule, '.ai-plus-panel-shell.is-closing 规则必须存在');
  // 打开：揭示到完整
  assert.match(openRule[0], /clip-path:\s*inset\(0/, '打开终态必须是 inset(0) 完整揭示');
  assert.match(openRule[0], /transition:/, '必须用 transition 才能双向对称流动');
  assert.match(openRule[0], /clip-path\s+320ms/);
  // 关闭：收回左下角那一小条
  assert.match(closingRule[0], /clip-path:\s*inset\(100% 82% 0 0/,
    '关闭终态必须收回到 + 按钮所在的左下角（inset(100% 82% 0 0)）');
  assert.match(closingRule[0], /opacity:\s*0/, '关闭终态必须透明');
  assert.match(closingRule[0], /visibility:\s*hidden/, '关闭终态必须不可见');
});

test('开合在同一条流动曲线上双向对称（打开/关闭都流畅）', () => {
  const base = cssSrc.match(/\.ai-plus-panel-shell\s*\{[^}]*\}/);
  const openRule = cssSrc.match(/\.ai-plus-panel-shell\.open\s*\{[^}]*\}/);
  const closingRule = cssSrc.match(/\.ai-plus-panel-shell\.is-closing\s*\{[^}]*\}/);
  assert.ok(base && openRule && closingRule, '三条规则都必须存在');

  const FLOW = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  // 打开态与关闭态必须共用同一条曲线、同一时长 —— 这才是"双向流动"，
  // 换成 keyframes 就只能单向播放，关闭会变成另一个动作。
  for (const [name, rule] of [['打开', openRule[0]], ['关闭', closingRule[0]], ['基础', base[0]]]) {
    assert.match(rule, /cubic-bezier\(0\.22,\s*0\.61,\s*0\.36,\s*1\)/,
      `${name}态必须使用流动曲线 ${FLOW}`);
  }
  // 基础隐藏态 == 关闭终态，杜绝"越开越小/越关越偏"的漂移
  assert.match(base[0], /clip-path:\s*inset\(100% 82% 0 0/,
    '基础隐藏态必须与关闭终态一致');
  assert.match(base[0], /transform-origin:\s*bottom left/,
    ' reveal 原点必须在 + 按钮所在的左下角');
  // 位移量要小（8px），配合 clip-path 才有"推开铺满"的感觉
  assert.match(base[0], /transform:\s*translateY\(8px\)/,
    '基础态位移必须是 translateY(8px)，不得用大比例 scale（会拉伸糊字）');
});

test('reduced-motion 下动画同步降级', () => {
  // 文件里有多个 reduced-motion 块，需定位包含 + 面板选择器的那个
  let idx = -1;
  let from = 0;
  while (true) {
    const i = cssSrc.indexOf('@media (prefers-reduced-motion: reduce) {', from);
    if (i < 0) break;
    const seg = cssSrc.slice(i, i + 700);
    if (seg.includes('ai-plus-panel-shell')) { idx = i; break; }
    from = i + 1;
  }
  assert.ok(idx > 0, '必须存在覆盖 + 面板的 reduced-motion 块');
  const seg = cssSrc.slice(idx, idx + 700);
  assert.match(seg, /ai-plus-panel-shell\.is-closing/, '须覆盖关闭动画选择器');
  assert.match(seg, /animation-duration:\s*0\.01ms\s*!important/,
    'reduced-motion 下必须同步降级 animation-duration');
});

test('_panelCleanup 必须复位面板视觉类，避免残留', () => {
  const start = agentSrc.indexOf('S._panelCleanup = function()');
  assert.ok(start > 0, '_panelCleanup 必须存在');
  const body = agentSrc.slice(start, start + 900);
  assert.match(body, /classList\.remove\('is-opening', 'is-closing', 'open'\)/,
    '清理时须移除三个状态类');
  assert.match(body, /setAttribute\('aria-expanded', 'false'\)/,
    '清理时须复位 aria-expanded');
});
