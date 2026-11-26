'use strict';
// 第二轮审计 点-5：xtjMorph.abort() 跳过 hide()，面板可能“可见 + inert”双死锁。
// 根因：morph 的 handle.abort 只清定时器、调 cleanup，不调 o.hide()；
// 被 abort 的若是关闭动画，finishClose 再也不会跑，面板保持可见，而调用方
// 在关闭开始时就已把 inert 置 true——看得到却点不动。
// 修复：abort 关闭动画（kind 'close'/'close-reversing'）时仍执行 o.hide()；
// abort 打开动画时不隐藏（调用方 abort 打开就是为了重显）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'core-parts', '04-posts-interactions.js'), 'utf8');

test('点-5: handle.abort 在关闭动画上必须执行 o.hide()', () => {
  const idx = src.indexOf('handle.abort = function()');
  assert.ok(idx >= 0, '应有 handle.abort');
  const body = src.slice(idx, idx + 900);
  assert.ok(body.includes("handle.kind === 'close'"), 'abort 必须区分关闭动画');
  assert.ok(body.includes("'close-reversing'"), '反向收起的关闭动画也要处理');
  assert.ok(/if \(\(handle\.kind === 'close' \|\| handle\.kind === 'close-reversing'\) && o\.hide\)/.test(body),
    'abort 关闭时必须调 o.hide()');
  assert.ok(body.includes('cleanup(0)'), 'abort 仍须清理动画与节点');
});

test('点-5: handle 必须带 kind 区分 open/close', () => {
  assert.ok(/var handle = \{ kind: kind, ended: false/.test(src), 'handle 应带 kind 字段');
  assert.ok(src.includes("handle.kind = 'close-reversing'"), 'reverse 应把 kind 改为 close-reversing');
});
