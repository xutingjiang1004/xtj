const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const part = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'core-parts', '05-feed-stats.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

/** 截取 showNotification 函数体 */
function notifBlock(src) {
  const start = src.indexOf('function showNotification(');
  assert.notEqual(start, -1, 'showNotification 必须存在');
  // 到下一个顶层函数定义结束（showNotification 很短，固定窗口足够）
  return src.slice(start, start + 3200);
}

// ---------------------------------------------------------------- M-7
test('M-7: 气泡点击是幂等的，连点只生效一次', () => {
  const block = notifBlock(part);
  assert.match(block, /let clicked = false;/, '必须有 clicked 幂等标记');
  assert.match(block, /if \(clicked\) return;/, '点击处理开头必须做幂等短路');
  assert.match(block, /clicked = true;/);
});

test('M-7: 点击时取消自动隐藏定时器', () => {
  const block = notifBlock(part);
  assert.match(block, /let autoHideTimer = null;/);
  assert.match(block, /clearTimeout\(autoHideTimer\)/, '点击必须取消自动隐藏定时器');
  assert.match(block, /autoHideTimer = setTimeout\(/, '自动隐藏定时器必须持有句柄');
});

test('M-7: 自动隐藏回调在已点击时跳过', () => {
  const block = notifBlock(part);
  const idx = block.indexOf('autoHideTimer = setTimeout(');
  assert.notEqual(idx, -1);
  const cb = block.slice(idx, idx + 600);
  assert.match(cb, /if \(clicked\) return;/, '已点击的条目不得再执行自动隐藏');
});

test('M-7: 拼装产物 core.js 与源码一致', () => {
  const block = notifBlock(coreSource);
  assert.match(block, /if \(clicked\) return;/);
  assert.match(block, /clearTimeout\(autoHideTimer\)/);
});

// ------------------------------------------------------- 红线：dock 不可改动
test('红线：本次修复不得触及 dock / capsule / 动画区域', () => {
  // 该断言是防止后续维护者在修通知气泡时误改用户明确要求冻结的 dock 区域
  const block = notifBlock(part);
  assert.doesNotMatch(block, /dockCapsule|dock-bar|capsule/i,
    'showNotification 内不得出现 dock capsule 相关改动');
});
