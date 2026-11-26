// F-M7：群聊定时器叠加 —— 每 1.5 秒空转的 syncAccount 全生命周期不停。
// 复核已确认：syncAccount 无变化即 return（空转本身可忽略）、30 秒刷新
// 有可见性守卫、closeGroup 会 stopPolling()。修法只动真正能省的部分：
// 账号变化已有事件即时同步，定时器只是兜底，改成 10 秒一次、隐藏时跳过。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync('js/chat-groups.js', 'utf8');

test('F-M7: syncAccount 兜底定时器不再每 1.5 秒空转', () => {
  assert.ok(!/setInterval\(syncAccount, 1500\)/.test(src), '仍是每 1.5 秒的 syncAccount 定时器');
  assert.match(src, /setInterval\(function \(\) \{ if \(document\.visibilityState !== 'hidden'\) syncAccount\(\); \}, 10000\)/,
    '兜底定时器必须是 10 秒一次、页面隐藏时跳过');
  assert.match(src, /'auth-ready', 'xtj-auth-changed', 'storage'/,
    '账号变化仍有事件即时同步，定时器只是兜底，不能删事件监听');
});

test('F-M7: 30 秒列表刷新与轮询的既有守卫保持不变', () => {
  assert.match(src, /setInterval\(function \(\) \{ if \(me\(\) && isChatVisible\(\) && document\.visibilityState === 'visible'\) loadGroups/,
    '30 秒列表刷新必须仍有登录/可见性守卫');
  assert.match(src, /function startPolling\(\) \{/, '轮询启动函数不得删');
  assert.match(src, /function stopPolling\(\) \{ clearTimeout\(state\.pollTimer\)/, '轮询停止函数不得删');
  const closeIdx = src.indexOf('  function closeGroup(immediate) {');
  assert.ok(closeIdx > 0, '找不到 closeGroup');
  assert.ok(src.slice(closeIdx, closeIdx + 800).includes('stopPolling()'), 'closeGroup 必须仍停轮询');
});
