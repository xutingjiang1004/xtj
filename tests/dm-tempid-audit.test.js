// F-L1：私信乐观消息 tempId 随机部分只有 4 位 base36（约 168 万种），
// 同毫秒内连发两条就可能撞号；而这个 tempId 同时是幂等键，撞号会让
// 第二条被服务端当成重发去重掉。改成 8 位，只改长度，不改格式与前缀。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');

test('F-L1: tempId 随机部分不得再只有 4 位', () => {
  assert.ok(!/Math\.random\(\)\.toString\(36\)\.slice\(2, 6\)/.test(chat),
    '仍有 4 位随机的 tempId 生成');
  const gens = chat.match(/'temp-' \+ Date\.now\(\) \+ '-' \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 10\)/g) || [];
  assert.equal(gens.length, 2, '两处 tempId 生成（排队入口与发送入口）都必须是 8 位随机');
});

test('F-L1: tempId 仍是幂等键，前缀与用法不变', () => {
  assert.match(chat, /var clientMessageId = retryOptions && retryOptions\.clientMessageId \|\| tempId;/,
    '幂等键仍取 tempId');
  assert.match(chat, /__clientMessageId: queuedTempId/, '排队消息仍用同一 tempId 作幂等键');
});
