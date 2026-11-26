const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
const markdownRenderer = fs.readFileSync(path.join(root, 'js', 'ai-core', 'markdown-renderer.js'), 'utf8');
const streamRenderer = fs.readFileSync(path.join(root, 'js', 'ai-core', 'stream-renderer.js'), 'utf8');

function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, 'missing ' + signature);
  return src.slice(start, src.indexOf('\n  }\n', start) + 5);
}

// B-06: 空状态头像闪烁 —— upgradeEmptyStateAvatar 只在有 URL 时才重画，
// 且已画好 URL 头像的节点不再重画；appendEmptyState 必须把 avatar_url 传进去。
test('B-06 empty-state avatar upgrade only redraws when a URL exists', () => {
  const body = fnBody(source, 'function upgradeEmptyStateAvatar(');
  assert.match(body, /avatarUrl/);
  // 无 URL 时直接返回，不调用 renderCatAvatarNode（否则会把刚画好的 URL 头像刷成 SVG 默认图）
  assert.match(body, /if\s*\(\s*!avatarUrl\s*\)\s*return/);
  // 已有 URL 头像的节点跳过，不重复 innerHTML='' 重画
  assert.match(body, /ai-avatar-image/);
  assert.match(body, /continue/);
  assert.match(body, /renderCatAvatarNode\(nodes\[i\], 'ai-chat-empty-avatar', avatarUrl, avatarVersion\)/);
});

test('B-06 appendEmptyState passes the configured avatar URL into the upgrade', () => {
  const body = fnBody(source, 'function appendEmptyState(');
  assert.match(body, /upgradeEmptyStateAvatar\(container, S\.config && S\.config\.avatar_url, S\.config && S\.config\.avatar_version\)/);
});

// B-07: 14px 输入框在 iOS 聚焦会触发系统自动缩放。两个聊天输入框改 16px：
// .ai-chat-input 与 .dt-input 都是 flex:1 的 textarea，min-height 只是下限，
// 字号变大只让输入栏自身长高约 4px，不挤压固定宽度的发送/暂停按钮。
test('B-07 chat composers use 16px font to avoid iOS auto-zoom', () => {
  const chatInput = css.slice(css.indexOf('.ai-chat-input {'), css.indexOf('.ai-chat-input::placeholder'));
  assert.match(chatInput, /font-size:\s*16px/);
  const dtInput = css.slice(css.indexOf('.dt-input {'), css.indexOf('.dt-input::placeholder'));
  assert.match(dtInput, /font-size:\s*16px/);
});

// B-09: 主操作按钮缺键盘焦点可见样式 —— 发送键、返回键、头部按钮、
// 学习/深入研究开关都要有 :focus-visible 轮廓（与 .ai-history-retry 同款）。
test('B-09 main AI buttons have a visible keyboard focus outline', () => {
  for (const sel of ['.ai-chat-send:focus-visible', '.ai-chat-back:focus-visible',
    '.ai-chat-hist-btn:focus-visible', '.ai-chat-new-btn:focus-visible',
    '.ai-chat-del-btn:focus-visible', '.ai-study-toggle:focus-visible',
    '.ai-deep-think-toggle:focus-visible']) {
    assert.ok(css.includes(sel), 'missing ' + sel);
  }
  const idx = css.indexOf('.ai-chat-send:focus-visible');
  const block = css.slice(idx, css.indexOf('}', idx));
  assert.match(block, /outline:\s*3px solid/);
});

// B-10: 11px 浅灰小字对比度不足（实测 2.55–3.92:1，WCAG 要求 4.5:1）。
// 四处浅底小字统一改深为 #4e5e59（白底 6.84:1、浅底 #f4fcf9 上 6.56:1）。
// 深色主题已有各自的浅色覆盖规则，不动。
function wcagContrast(fg, bg) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (rgb) => 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
test('B-10 small muted text meets WCAG 4.5:1 on light backgrounds', () => {
  assert.ok(wcagContrast([78, 94, 89], [255, 255, 255]) >= 4.5, '#4e5e59 on white');
  assert.ok(wcagContrast([78, 94, 89], [244, 252, 249]) >= 4.5, '#4e5e59 on pale');
  for (const [sel, prop] of [
    ['.ai-msg-footer .ai-msg-usage', 'color: #4e5e59'],
    ['.ai-msg-footer .ai-msg-time', 'color: #4e5e59'],
    ['.ai-msg-thinking-badge', 'color: #4e5e59'],
    ['.ai-chat-empty-tip', 'color: #4e5e59'],
    ['.ai-chat-input::placeholder', 'color: #4e5e59'],
    ['.ai-msg-footer .ai-msg-agent-badge', 'color: #4e5e59'],
  ]) {
    const idx = css.indexOf(sel + ' {');
    assert.notEqual(idx, -1, 'missing rule ' + sel);
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes(prop), sel + ' should use ' + prop + ', got: ' + block.trim());
  }
  // 浅底上不再残留这四处低对比度的半透明灰
  assert.doesNotMatch(css, /color: rgba\(95, 116, 113, 0\.72\)/);
  assert.doesNotMatch(css, /color: rgba\(116, 128, 132, 0\.72\)/);
  assert.doesNotMatch(css, /color: rgba\(102, 118, 116, 0\.92\)/);
  assert.doesNotMatch(css, /color: rgba\(113, 127, 132, 0\.74\)/);
});

// B-12: 死 CSS —— 头部头像/信息、思考按钮/菜单等规则在 JS/HTML 里已无创建者
// （当前顶栏用 .ai-chat-header-title/.ai-chat-header-cat 与
// .ai-study-toggle/.ai-deep-think-toggle），删除前已 grep 确认无引用。
// 历史注释里提及旧类名不算引用，故先剥离注释再断言。
test('B-12 dead header/think-menu CSS is removed', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const dead of ['ai-chat-header-avatar', 'ai-chat-header-info', 'ai-chat-header-name',
    'ai-chat-header-status', 'ai-chat-think-btn', 'ai-chat-think-menu',
    'ai-chat-think-opt', 'ai-chat-think-wrap']) {
    assert.ok(!stripped.includes(dead), 'dead CSS remains: ' + dead);
  }
});

test('B-12 live header controls keep their CSS', () => {
  for (const live of ['.ai-cat-avatar', '.ai-chat-hist-btn', '.ai-chat-new-btn',
    '.ai-chat-del-btn', '.ai-chat-back', '.ai-deep-think-toggle', '.ai-study-toggle',
    '.ai-chat-header-title']) {
    assert.ok(css.includes(live), 'live CSS missing: ' + live);
  }
});

// B-13: 历史加载态与空态长得一样 —— buildHistoryLoadingState 只复用
// buildEmptyState + 一句文案。加载态加一个转圈指示，与空态区分开。
test('B-13 history loading state shows a spinner distinct from the empty state', () => {
  const body = fnBody(source, 'function buildHistoryLoadingState()');
  assert.match(body, /ai-history-loading-spinner/);
  assert.match(body, /classList\.add\('ai-history-loading'\)/);
  assert.match(css, /\.ai-history-loading-spinner\s*\{[^}]*animation:\s*ai-history-spin/);
  assert.match(css, /@keyframes ai-history-spin/);
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce) {\n  .ai-history-loading-spinner { animation: none; }\n}'),
    'spinner must stop under prefers-reduced-motion');
});
