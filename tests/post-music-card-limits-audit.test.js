'use strict';
// E-M5 音乐卡片全局 MutationObserver + 逐链接请求，无上限。
// 复核确认：扫描只针对待解析卡片、resolve 按链接去重、缓存仅 60 条，
// 请求风暴不存在；真正待修的是两点：
//  1. 不同链接的解析请求没有全局并发上限；
//  2. 卡片被 feed 重建移除后，试听音频继续播、播放按钮状态不复位。
// 修复：解析并发上限 3 个（排队等候）；MutationObserver 回调里检查
// 正在试听的按钮是否还在文档里，不在就暂停音频（onpause 会复位按钮）。
// 全局监听本身保留：音乐卡片分布在列表、详情、作者动态三处，
// 缩到 #feed 会漏掉详情页的卡片解析。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

function musicBlock() {
  const start = posts.indexOf('var musicCards = (function() {');
  assert.ok(start > 0, '缺少 musicCards');
  const end = posts.indexOf('window.xtjMusicCards = musicCards;', start);
  assert.ok(end > start, 'musicCards 结构已变动，人工复核');
  return posts.slice(start, end);
}

test('音乐解析有全局并发上限 3 个，不同链接排队等候', () => {
  const block = musicBlock();
  assert.match(block, /MUSIC_RESOLVE_MAX\s*=\s*3/, '缺少解析并发上限 3');
  assert.match(block, /resolveActive\s*<\s*MUSIC_RESOLVE_MAX/, '没有按上限放行解析请求');
  assert.match(block, /resolveQueue\.push/, '超上限的解析请求没有进队列等候');
  assert.match(block, /resolveActive--/, '解析结束后应释放名额并放行队列');
});

test('试听中的卡片被移除后暂停音频', () => {
  const block = musicBlock();
  assert.match(block, /!playing\.isConnected/, '没有检查试听按钮是否还在文档里');
  assert.match(block, /audio\.pause\(\)/, '卡片移除后没有暂停音频');
});
