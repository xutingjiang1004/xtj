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

test('.open 与 .is-closing 必须用 keyframes 动画且 both 填充', () => {
  const openRule = cssSrc.match(/\.ai-plus-panel-shell\.open\s*\{[^}]*\}/);
  const closingRule = cssSrc.match(/\.ai-plus-panel-shell\.is-closing\s*\{[^}]*\}/);
  assert.ok(openRule, '.ai-plus-panel-shell.open 规则必须存在');
  assert.ok(closingRule, '.ai-plus-panel-shell.is-closing 规则必须存在');
  assert.match(openRule[0], /animation:\s*aiPlusPanelOpen/);
  assert.match(closingRule[0], /animation:\s*aiPlusPanelClose/);
  assert.match(openRule[0], /\bboth\b/, '打开动画需 both 填充锁定终态');
  assert.match(closingRule[0], /\bboth\b/, '关闭动画需 both 填充锁定终态');
});

test('开关关键帧终态与基础态一致（可见态 scale(1) / 隐藏态 scale(0.14)）', () => {
  const openKf = cssSrc.match(/@keyframes\s+aiPlusPanelOpen\s*\{[\s\S]*?\n\}/);
  const closeKf = cssSrc.match(/@keyframes\s+aiPlusPanelClose\s*\{[\s\S]*?\n\}/);
  assert.ok(openKf, 'aiPlusPanelOpen 关键帧必须存在');
  assert.ok(closeKf, 'aiPlusPanelClose 关键帧必须存在');
  assert.match(openKf[0], /scale\(1\)/, '打开终态必须是 scale(1)');
  // ★ 2026-09-22：Hero 展开恢复原样 —— 起点 scale(0.14)、340ms spring 曲线
  //   （用户明确要求"改回来那个打开跟关闭动画"）。
  //   契约本身不变：**关闭终态必须与基础隐藏态完全一致**。
  assert.match(closeKf[0], /scale\(0\.14\)/, '关闭终态必须回到基础隐藏态 scale(0.14)');
  // 基础态仍为隐藏（opacity:0 + visibility:hidden + scale(0.14)）
  const base = cssSrc.match(/\.ai-plus-panel-shell\s*\{[^}]*\}/);
  assert.ok(base, '基础规则必须存在');
  assert.match(base[0], /opacity:\s*0/);
  assert.match(base[0], /visibility:\s*hidden/);
  assert.match(base[0], /transform:\s*scale\(0\.14\)/);
  // 打开关键帧的起点同样必须是基础态，杜绝"打开时先闪一下再缩放"
  assert.match(openKf[0], /scale\(0\.14\)/, '打开起点必须与基础隐藏态一致');
  // Hero 展开的弹簧曲线：必须保留 cubic-bezier(0.32, 0.72, 0, 1)，
  // 它决定了"从 + 按钮原点点弹式生长"的手感，换成线性/ease 会立刻变生硬。
  assert.match(cssSrc, /aiPlusPanelOpen\s+340ms\s+cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/,
    '打开动画必须使用 Hero spring 曲线 340ms cubic-bezier(0.32, 0.72, 0, 1)');
  assert.match(cssSrc, /aiPlusPanelClose\s+320ms\s+cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/,
    '关闭动画必须与打开同曲线，保证"原路返回"');
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
