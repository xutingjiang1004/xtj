'use strict';
// E-H2 评论自动展开风暴：滚动刷列表时每个进视口的帖子都并发拉评论，
// 修复要求：自动展开走全局队列、同时最多 2 个在途；用户主动点击不受上限影响。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const source = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('自动展开有全局并发上限（同时最多 2 个），而不是每个进视口的帖子都直接发起', () => {
  const start = source.indexOf('function autoExpandVisibleComments()');
  assert.ok(start > 0, '缺少 autoExpandVisibleComments');
  const block = source.slice(start, start + 2600);
  // 观察器回调不再直接调 __xtjExpandPostComments，而是进队列
  assert.doesNotMatch(block, /window\.__xtjExpandPostComments\(pid, btn\)/,
    '观察器回调仍在直接发起展开请求，没有走并发队列');
  assert.match(block, /queueAutoCommentExpand\(pid, btn\)/,
    '观察器回调应把自动展开放进全局队列');
  assert.match(source, /COMMENT_EXPAND_AUTO_MAX\s*=\s*2/,
    '缺少自动展开全局并发上限 2');
  assert.match(source, /_commentExpandAutoActive\s*<\s*COMMENT_EXPAND_AUTO_MAX/,
    '队列没有按上限放行');
});

test('用户主动点击展开按钮不受自动展开的并发上限影响', () => {
  // 点击入口仍是直接调 __xtjExpandPostComments（onclick 在渲染处），
  // 队列只用于 IntersectionObserver 的自动展开路径。
  const render = source.indexOf('onclick="__xtjExpandPostComments(');
  assert.ok(render > 0, '缺少点击展开按钮的 onclick 入口');
  const queueFn = source.indexOf('function queueAutoCommentExpand');
  assert.ok(queueFn > 0, '缺少 queueAutoCommentExpand');
  const pumpFn = source.indexOf('function pumpCommentExpandAutoQueue');
  assert.ok(pumpFn > 0, '缺少 pumpCommentExpandAutoQueue');
  const qblock = source.slice(pumpFn, pumpFn + 900);
  assert.match(qblock, /__xtjExpandPostComments\(next\.pid, next\.btn\)/,
    '队列放行时应调用原展开函数');
});

test('队列里的帖子被 feed 重建移除后会被跳过，不会白占并发名额', () => {
  const queueFn = source.indexOf('function pumpCommentExpandAutoQueue');
  assert.ok(queueFn > 0, '缺少 pumpCommentExpandAutoQueue');
  const block = source.slice(queueFn, queueFn + 900);
  assert.match(block, /!next\.btn\.isConnected/,
    '放行前应检查按钮是否还在文档里');
  assert.match(block, /_commentExpandAutoActive--/,
    '展开结束后应释放并发名额并继续放行队列');
});
