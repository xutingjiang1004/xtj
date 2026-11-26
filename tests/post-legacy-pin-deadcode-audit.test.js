'use strict';
// E-L3 死代码：旧置顶路径调已被禁用的接口。
// window._legacyTogglePostPinBase 直接 fetch('/api/post/update', {is_pinned})，
// 服务端遇到顶层 is_pinned/pinned_at 直接 400 use_pin_endpoint；
// 同名的 window._legacyTogglePostPin 是同一条旧路（经 updatePostRecord 把
// is_pinned 写进 content JSON，绕开置顶接口）。两者全仓零调用，
// 现行入口 window.togglePostPin（/api/post/pin）不受影响。
// 修复：删除两个死函数，避免旧缓存或误调用时置顶静默失败。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('旧置顶 Base 已删除', () => {
  assert.doesNotMatch(posts, /window\._legacyTogglePostPinBase\s*=/,
    '仍定义着 _legacyTogglePostPinBase');
});

test('旧置顶 override 已删除（同一条死路）', () => {
  assert.doesNotMatch(posts, /window\._legacyTogglePostPin\s*=/,
    '仍定义着 _legacyTogglePostPin');
});

test('没有其他地方再调 /api/post/update 传顶层 is_pinned', () => {
  assert.doesNotMatch(posts, /body: JSON\.stringify\(\{ post_id: postId, is_pinned: nextPinned \}\)/,
    '仍有代码直接调 /api/post/update 传 is_pinned，会被服务端 400');
});

test('现行置顶入口保留：走 /api/post/pin', () => {
  assert.match(posts, /window\.togglePostPin = async function\(postId, btn\)/,
    '现行 togglePostPin 不见了');
  const start = posts.indexOf('window.togglePostPin = async function(postId, btn)');
  const block = posts.slice(start, start + 4000);
  assert.match(block, /\/api\/post\/pin/, '现行置顶入口应调 /api/post/pin');
});
