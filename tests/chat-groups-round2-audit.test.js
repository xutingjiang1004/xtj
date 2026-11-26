'use strict';
// 第二轮审计 聊-2 / 聊-3 / 聊-8：聊天好友与建群。
// 聊-2：建群选人空态是死胡同，只有文字、没有“去添加好友”入口。
//   修复：无好友时渲染全宽按钮，点后关选人表、打开「联系人」搜索页。
// 聊-3：刚加的好友 30 秒内进不了建群名单（好友列表 30 秒缓存不失效）。
//   修复：chat-groups 暴露 invalidateFriends；接受/删除/拉黑好友后
//   立即失效缓存。
// 聊-8：建群成员非法时服务端返回 group_full（“群成员已达上限”），
//   文案张冠李戴。修复：非法名单报 invalid_members，空名单报
//   members_required。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const groupsSrc = fs.readFileSync(path.join(root, 'js', 'chat-groups.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(root, 'js', 'core-parts', '06-chat-and-nav.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'chat-groups.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'css', 'chat-groups.css'), 'utf8');

test('聊-2: 建群选人无好友空态有“去添加好友”按钮', () => {
  assert.ok(groupsSrc.includes("id=\"grpGoAddFriend\""), '空态应有去添加好友按钮');
  assert.ok(groupsSrc.includes("去添加好友"), '按钮文案应为“去添加好友”');
  assert.ok(groupsSrc.includes("typeof window.__xtjOpenChatSocial === 'function'"),
    '点击应先判断 __xtjOpenChatSocial 存在再调用');
  assert.ok(groupsSrc.includes("__xtjOpenChatSocial('search')"), '应打开联系人搜索页');
  assert.ok(navSrc.includes('window.__xtjOpenChatSocial = openDockChatSocialSheet;'),
    '06 应暴露 __xtjOpenChatSocial');
  assert.ok(cssSrc.includes('grp-pick-empty-action'), '按钮应有全宽样式');
});

test('聊-3: 好友关系变动后建群好友缓存立即失效', () => {
  assert.ok(groupsSrc.includes('invalidateFriends: function () { state.friends = null; state.friendsAt = 0; }'),
    'chat-groups 应暴露 invalidateFriends');
  assert.ok(navSrc.includes('function invalidateChatGroupsFriendsCache()'),
    '06 应有统一的缓存失效调用');
  const acceptIdx = navSrc.indexOf("showToast('已添加好友')");
  assert.ok(acceptIdx > 0, '应有接受好友成功分支');
  assert.ok(navSrc.slice(acceptIdx, acceptIdx + 300).includes('invalidateChatGroupsFriendsCache()'),
    '接受好友后应失效缓存');
  const removeIdx = navSrc.indexOf("showToast('已删除好友，历史聊天保留')");
  assert.ok(navSrc.slice(Math.max(0, removeIdx - 400), removeIdx).includes('invalidateChatGroupsFriendsCache()'),
    '删除好友后应失效缓存');
  const blockIdx = navSrc.indexOf("showToast('已拉黑该用户')");
  assert.ok(navSrc.slice(Math.max(0, blockIdx - 400), blockIdx).includes('invalidateChatGroupsFriendsCache()'),
    '拉黑好友后应失效缓存');
});

test('聊-8: 成员名单非法不再报 group_full', () => {
  assert.ok(!serverSrc.includes("members && members.length === 0 ? 'members_required' : 'group_full'"),
    '不得再用三元把非法名单报成 group_full');
  assert.ok(serverSrc.includes("if (!members) return fail(res, 'invalid_members');"),
    '非法名单应报 invalid_members');
  assert.ok(serverSrc.includes("if (!members.length) return fail(res, 'members_required');"),
    '空名单仍报 members_required');
  assert.ok(serverSrc.includes("invalid_members: [400, '成员名单无效，请重新选择']"),
    'invalid_members 应有对应的中文文案');
  assert.ok(!serverSrc.includes("if (!m) return fail(res, 'group_full')"),
    '改成员路径的非法名单也不得再报 group_full（V1 复核发现的第二处）');
  assert.ok(serverSrc.includes("if (!m) return fail(res, 'invalid_members')"),
    '改成员路径的非法名单应报 invalid_members');
});
