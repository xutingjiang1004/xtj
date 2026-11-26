// F-M5：撤回注释“管理员 10 分钟”误导 —— 实现只有发送者、固定 3 分钟，
// 全仓没有任何管理员撤回分支，也没有相关产品决定。修法是改注释以符合
// 实现，不凭空加管理员撤回功能。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const chat = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');

test('F-M5: 撤回注释不得再写不存在的管理员 10 分钟', () => {
  const start = server.indexOf("app.post('/api/dm/withdraw'");
  assert.ok(start > 0, '找不到 /api/dm/withdraw');
  const head = server.slice(Math.max(0, start - 2000), start);
  assert.ok(!/管理员10分钟|管理员 10 分钟/.test(head), '注释仍在写不存在的管理员撤回');
  assert.match(head, /仅发送者本人/, '注释必须写明仅发送者可撤回');
  assert.match(head, /3 分钟内/, '注释必须写明 3 分钟时限');
});

test('F-M5: 撤回实现仍是仅发送者、固定 3 分钟，前后端口径一致', () => {
  const start = server.indexOf("app.post('/api/dm/withdraw'");
  const end = server.indexOf("app.post('/api/dm/read'", start);
  const body = server.slice(start, end);
  assert.match(body, /仅支持撤回自己发送的消息/, '服务端必须只允许发送者撤回');
  assert.match(body, /var timeLimit = 3 \* 60 \* 1000;/, '时限必须是固定 3 分钟');
  assert.match(body, /if \(elapsed > timeLimit\)/, '超时必须拒绝');
  assert.match(chat, /elapsed <= 3 \* 60 \* 1000/, '前端撤回按钮必须是同一 3 分钟口径');
});
