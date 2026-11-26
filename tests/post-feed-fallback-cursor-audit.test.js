'use strict';
// E-M4 分页回退仍用 offset/range，并发发帖/删帖会重复或跳帖。
// 修复：回退也全程走游标。无游标且已加载过帖子时，用已加载的最旧
// 一帖当游标继续往下翻；无游标、无已加载帖子时只从头拉第一页，
// 不再用 offset 翻页。首屏（start=0）仍可用 range 拉第一页。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

function fallbackBlock() {
  const searchGuard = posts.indexOf("if(searchKeyword&&!usedApi)throw");
  assert.ok(searchGuard > 0, '缺少搜索回退守卫');
  const start = posts.indexOf("if (!usedApi) {", searchGuard);
  assert.ok(start > 0, '缺少 API 失败回退分支');
  // 回退分支到函数末尾的 nextOffset 计算之前
  const end = posts.indexOf('var computedNextOffset;', start);
  assert.ok(end > start, '回退分支结构已变动，人工复核');
  return posts.slice(start, end);
}

test('回退翻页不再用 offset/range：无游标时用已加载最旧一帖当游标', () => {
  const block = fallbackBlock();
  assert.match(block, /feedAllPosts\[feedAllPosts\.length - 1\]/,
    '回退无游标时没有用已加载的最旧一帖推导游标');
  assert.match(block, /created_at\.lt\./,
    '回退没有用 created_at 游标过滤');
  // range(start, end) 只允许留在首屏 else 分支（start=0）；翻页分支
  // （start>0）必须走游标或只拉第一页
  assert.match(block, /\} else if \(start > 0\) \{\s*fallbackQuery = fallbackQuery\.range\(0, FEED_PAGE_SIZE - 1\);\s*\} else \{\s*fallbackQuery = fallbackQuery\.range\(start, end\);/,
    '翻页分支仍在用 range(start, end) 做 offset 翻页，并发写入时会漂移');
});

test('无游标、无已加载帖子时只从头拉第一页', () => {
  const block = fallbackBlock();
  assert.match(block, /range\(0, FEED_PAGE_SIZE - 1\)/,
    '无游标且无已加载帖子时应只从头拉第一页');
});

test('首屏仍可用 range 拉第一页（start=0 的分支保留）', () => {
  const block = fallbackBlock();
  assert.match(block, /range\(start, end\)|range\(0, FEED_PAGE_SIZE - 1\)/,
    '首屏 range 拉第一页的路径不应被删掉');
  // 但 range(start, end) 只允许出现在 start=0 的分支里
  const rangeAt = block.indexOf('range(start, end)');
  if (rangeAt >= 0) {
    const before = block.slice(Math.max(0, rangeAt - 400), rangeAt);
    assert.match(before, /start\s*>\s*0|else/,
      'range(start, end) 不应出现在翻页分支');
  }
});
