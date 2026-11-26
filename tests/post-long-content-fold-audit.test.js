'use strict';
// E-H3 长帖无折叠：前端限 2000 字、后端放 50000 字，经 API/旧数据写入的
// 超长帖在列表里全文渲染，一条帖子占几屏。修复：列表里超过前端发帖上限
// （2000 字）的正文默认折叠成 8 行 +「展开全文」，点开再看全文；
// 2000 字以内的正常帖子渲染零变化。详情页走另一条渲染路径，不受影响。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const early = fs.readFileSync('js/early-feed.js', 'utf8');
const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('超长正文有折叠入口：列表渲染走统一的折叠 helper', () => {
  assert.ok(early.indexOf('__xtjFoldPostContent') > 0, 'early-feed 缺少 __xtjFoldPostContent');
  assert.ok(posts.indexOf('__xtjFoldPostContent') > 0,
    'renderPostCard 仍在直接输出全文，没有走折叠 helper');
  assert.doesNotMatch(posts, /<div class="content">\$\{buildPostContentHtml\(normalized\.content\)\}<\/div>/,
    'renderPostCard 仍在直接输出全文');
});

test('折叠阈值是前端发帖上限 2000 字，正常帖子零变化', () => {
  const start = early.indexOf('function foldPostContent');
  assert.ok(start > 0, '缺少 foldPostContent');
  const block = early.slice(start, start + 1200);
  assert.match(block, /2000/, '折叠阈值应为 2000 字');
  assert.match(block, /length\s*<=\s*2000/, '2000 字以内应原样输出，不折叠');
  assert.match(block, /-webkit-line-clamp:\s*8/, '折叠后只显示 8 行');
});

test('折叠后有「展开全文」按钮，点开能恢复全文、能再收起', () => {
  const start = early.indexOf('__xtjTogglePostContent');
  assert.ok(start > 0, '缺少 __xtjTogglePostContent');
  const block = early.slice(start, start + 1500);
  assert.match(block, /展开全文/, '折叠态应显示「展开全文」');
  assert.match(block, /收起/, '展开后应能收起');
  assert.match(block, /webkitLineClamp/, '切换时应改 line-clamp');
  assert.match(early, /post-content-toggle/, '缺少展开按钮的标识 class');
});
