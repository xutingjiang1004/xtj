'use strict';
// 第二轮审计 聊-7 / 聊-9：聊天输入锁死与标签滑条吞点击。
// 聊-7：好友关系查不到时输入框永久锁死，只剩原地打转的“重试”。
//   修复：查不到时放开输入（fail-open），提示改为“发送时将由服务端
//   确认”。服务端发消息时自己校验关系（assertCanSendDirectMessage，
//   server.js:16823），放开不会绕过拉黑/好友门禁；重试按钮保留。
// 聊-9：联系人面板标签滑条无条件压住抬手后 400ms 内的点击。
//   修复：只有真正拖动（moved）后才压 400ms；普通点按不再被吞。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const navSrc = fs.readFileSync(path.join(root, 'js', 'core-parts', '06-chat-and-nav.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('聊-7: 关系查询失败时输入框放开，不再永久锁死', () => {
  const fnIdx = navSrc.indexOf('async function updateDockChatComposerPermission(userName)');
  assert.ok(fnIdx >= 0, '应有 updateDockChatComposerPermission');
  const fnBody = navSrc.slice(fnIdx, fnIdx + 6000);
  const catchIdx = fnBody.indexOf('} catch (_) {');
  assert.ok(catchIdx >= 0, '应有查询失败的 catch');
  const catchBody = fnBody.slice(catchIdx, catchIdx + 1500);
  assert.ok(catchBody.includes('if (input) input.disabled = false;'), '失败时应放开输入框');
  assert.ok(catchBody.includes('if (send) send.disabled = false;'), '失败时应放开发送按钮');
  assert.ok(catchBody.includes('发送时将由服务端确认'), '提示应说明发送时由服务端确认');
  assert.ok(!catchBody.includes('消息发送已暂停'), '不得再提示“消息发送已暂停”');
  assert.ok(catchBody.includes("textContent = '重试'"), '重试按钮应保留');
});

test('聊-7: 服务端发消息时确实校验关系（放开才安全）', () => {
  assert.ok(serverSrc.includes('assertCanSendDirectMessage(supabase, sender, targetUser, ADMIN_USERNAME)'),
    '服务端发消息前应调 assertCanSendDirectMessage');
  const socialSrc = fs.readFileSync(path.join(root, 'render-api', 'chat-social.js'), 'utf8');
  assert.ok(socialSrc.includes("code: 'chat_blocked'"), '拉黑发送应被服务端以 chat_blocked 拒绝');
  assert.ok(socialSrc.includes('recordAutoFriendOnMessage'), '发消息后应自动维护单向/双向好友关系');
});

test('聊-9: 滑条只在真正拖动后压 400ms 点击，普通点按不被吞', () => {
  const fnIdx = navSrc.indexOf('function bindDockChatSocialSlider()');
  assert.ok(fnIdx >= 0, '应有 bindDockChatSocialSlider');
  const fnBody = navSrc.slice(fnIdx, fnIdx + 3000);
  assert.ok(fnBody.includes('if(moved)suppressClickUntil=Date.now()+400;'),
    '应只在拖动后设置 400ms 点击压制');
  assert.ok(!fnBody.includes('\n                    suppressClickUntil=Date.now()+400;'),
    '不得再无条件压制抬手后的点击');
});
