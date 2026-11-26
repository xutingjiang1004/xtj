'use strict';
// E-M6 帖子详情与列表的互动数口径仍有两套：updateFeedStats 内存有
// 全量数据时用内存算，无数据时改用 DOM 文本正则解析（浏览/点赞/评论）。
// 筛选/分页后 DOM 只含部分帖子，正则猜出来的数字与详情页的精确
// count 对不上。修复：去掉 DOM 正则兜底，统计只认内存全量数据的
// 精确计数；内存数据缺失时显示 —，不猜数字。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

function statsBlock() {
  const start = posts.indexOf('function updateFeedStats()');
  assert.ok(start > 0, '缺少 updateFeedStats');
  const end = posts.indexOf('async function initialLoad', start);
  assert.ok(end > start, 'updateFeedStats 结构已变动，人工复核');
  return posts.slice(start, end);
}

test('不再用 DOM 文本正则猜互动数', () => {
  const block = statsBlock();
  assert.doesNotMatch(block, /match\(.*浏览\|👁/,
    '仍在用 DOM 正则解析浏览数');
  assert.doesNotMatch(block, /match\(.*点赞\|❤/,
    '仍在用 DOM 正则解析点赞数');
  assert.doesNotMatch(block, /match\(.*评论\|💬/,
    '仍在用 DOM 正则解析评论数');
  assert.doesNotMatch(block, /querySelectorAll\('\.post'\)/,
    '仍在用 DOM 帖子节点做统计兜底');
});

test('内存数据缺失时显示 —，不写猜出来的数字', () => {
  const block = statsBlock();
  assert.match(block, /if \(!hasFullData\)/,
    '缺少内存数据缺失分支');
  assert.match(block, /textContent = '—'/,
    '内存数据缺失时应显示 —');
});

test('内存全量数据的精确计数路径保留', () => {
  const block = statsBlock();
  assert.match(block, /hasFullData/, '应保留 hasFullData 判断');
  assert.match(block, /feedAllLikes\.forEach/, '应保留内存点赞精确计数');
  assert.match(block, /feedAllComments\.filter/, '应保留内存评论精确计数');
  assert.match(block, /Number\(p\.views\)/, '应保留内存浏览精确计数');
});
