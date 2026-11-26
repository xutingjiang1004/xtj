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
