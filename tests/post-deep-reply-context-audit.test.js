'use strict';
// E-M3 回复嵌套超 8 层后脱离上下文，变成“顶层评论”。
// _renderCommentNode 只在 depth<8 时渲染子回复；第 9 层及以后的回复
// 在第二遍兜底循环里以 _renderCommentNode(c, 0) 当根追加，parent
// 没传、replyToName 为空，读者看不出它在回哪条。
// 修复：兜底追加时把父评论传进去并强制点名父作者（回复 @父作者），
// 正常嵌套（第二层靠缩进表明关系）的显示规则不动。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('兜底追加超深/孤儿评论时传父评论并点名', () => {
  const sweep = posts.indexOf("pComms.forEach(function(c) { if (!_seen[String(c.id)]");
  assert.ok(sweep > 0, '缺少兜底追加循环');
  const block = posts.slice(sweep, sweep + 300);
  assert.doesNotMatch(block, /_renderCommentNode\(c, 0\)/,
    '兜底追加仍在以 _renderCommentNode(c, 0) 当根追加，不传父评论');
  assert.match(block, /_renderCommentNode\(c, 0, _byId\[String\(c\.parent_comment_id\)\]/,
    '兜底追加应把父评论传进去');
});

test('被截断层级的回复强制显示“回复 @父作者”', () => {
  const fn = posts.indexOf('function _renderCommentNode');
  assert.ok(fn > 0, '缺少 _renderCommentNode');
  const block = posts.slice(fn, fn + 1800);
  assert.match(block, /forceReplyName/,
    '_renderCommentNode 没有强制点名的分支');
  assert.match(block, /if \(!replyToName && forceReplyName && parent\)/,
    '强制点名应只在本来没有点名、且父评论存在时触发');
  assert.match(block, /replyToName = \(parent\.user_name === 'cat_ai' && parent\.generated_by_ai\) \? '小猫' : parent\.user_name;/,
    '强制点名时应把父作者名赋给 replyToName');
});

test('正常嵌套的点名规则不动：第二层仍靠缩进，不强制点名', () => {
  const fn = posts.indexOf('function _renderCommentNode');
  const block = posts.slice(fn, fn + 1800);
  assert.match(block, /只有回复的是“回复”（第三层起）才点名/,
    '正常嵌套点名规则的注释不应被改掉');
  assert.match(block, /depth >= 2 && parent/,
    '第三层起才点名的规则不应被改掉');
});
