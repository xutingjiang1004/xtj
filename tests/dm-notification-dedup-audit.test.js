// F-L5：通知去重集合只留 500 条就按插入顺序淘汰最旧的；一个会话里收到
// 500 条以上私信时，被淘汰的旧消息再出现在快照里会重复弹通知。
// 集合存的只是短 id 字符串，2000 条内存可忽略，上限放宽到 2000。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync('js/core-parts/05-feed-stats.js', 'utf8');

test('F-L5: 通知去重集合上限不得再是 500', () => {
  assert.ok(!/while\(dmNotificationIds\.size>500\)/.test(src), '去重集合仍只留 500 条');
  assert.match(src, /while\(dmNotificationIds\.size>2000\)dmNotificationIds\.delete\(dmNotificationIds\.values\(\)\.next\(\)\.value\)/,
    '去重集合上限必须是 2000，仍按插入顺序淘汰最旧的');
});

test('F-L5: 去重与换账号清理逻辑不变', () => {
  assert.match(src, /if\(dmNotificationIds\.has\(id\)\)return;/, '快照仍按 id 去重');
  assert.match(src, /dmNotificationIdentity=identity;dmNotificationIds\.clear\(\)/,
    '换账号仍清空去重集合');
});
