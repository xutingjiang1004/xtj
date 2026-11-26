'use strict';
// D-M4 回归：切走 tab 只隐藏面板，三个定时器继续跑。
// 修复前：hideAiChatForTabSwitch 只摘 class、置 _tabHidden，没有任何
//   stopQuotaPolling / clearInterval；状态（60s）与配置（5 分钟）定时器
//   的回调没有 S.active 守卫，配额回调虽有守卫但切 tab 时 S.active 仍为
//   true，拦不住。切走后每 30s/60s/5min 各一次无用请求。
// 修复后：抽 startAiPollTimers / stopAiPollTimers（状态 + 配置 + 配额
//   三个定时器）；hide 时停掉，restore 时重建，openAiChat 复用同一 helper。
//   流式请求本身不受影响（仍继续跑），只停轮询。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('D-M4: 有 start/stopAiPollTimers，stop 停掉三个定时器', () => {
  const stopIdx = src.indexOf('function stopAiPollTimers()');
  assert.ok(stopIdx >= 0, '应有 stopAiPollTimers helper');
  const stopBody = src.slice(stopIdx, stopIdx + 800);
  assert.ok(stopBody.includes('stopQuotaPolling()'), 'stop 应停配额轮询');
  assert.ok(stopBody.includes('clearInterval(S.statusTimer)'), 'stop 应停状态定时器');
  assert.ok(stopBody.includes('clearInterval(S._configRefreshTimer)'), 'stop 应停配置定时器');
  assert.ok(stopBody.includes('S.statusTimer = null'), 'stop 应把状态定时器置空');
  assert.ok(stopBody.includes('S._configRefreshTimer = null'), 'stop 应把配置定时器置空');
  const startIdx = src.indexOf('function startAiPollTimers()');
  assert.ok(startIdx >= 0, '应有 startAiPollTimers helper');
  const startBody = src.slice(startIdx, startIdx + 900);
  assert.ok(startBody.includes('setInterval(updateAiStatus, 60000)'), 'start 应重建 60s 状态定时器');
  assert.ok(startBody.includes('CONFIG_REFRESH_INTERVAL'), 'start 应重建配置定时器');
  assert.ok(startBody.includes('startQuotaPolling()'), 'start 应重建配额轮询');
});

test('D-M4: hideAiChatForTabSwitch 切走时停定时器，restore 时重建', () => {
  const hideIdx = src.indexOf('function hideAiChatForTabSwitch()');
  assert.ok(hideIdx >= 0, '应有 hideAiChatForTabSwitch');
  const hideEnd = src.indexOf('function restoreHiddenAiChat(', hideIdx);
  const hideBody = src.slice(hideIdx, hideEnd);
  assert.ok(hideBody.includes('stopAiPollTimers()'), 'hide 应调 stopAiPollTimers');
  const restoreIdx = src.indexOf('function restoreHiddenAiChat(');
  const restoreEnd = src.indexOf('async function openAiChat(', restoreIdx);
  const restoreBody = src.slice(restoreIdx, restoreEnd);
  assert.ok(restoreBody.includes('startAiPollTimers()'), 'restore 应调 startAiPollTimers 重建轮询');
});

test('D-M4: openAiChat 复用同一 helper，不再各写一套 setInterval', () => {
  const statusSets = (src.match(/setInterval\(updateAiStatus, 60000\)/g) || []).length;
  assert.equal(statusSets, 1, 'setInterval(updateAiStatus, 60000) 应只在 helper 里出现一次，实得 ' + statusSets + ' 处');
  const openIdx = src.indexOf('async function openAiChat(');
  const openEnd = src.indexOf('function buildHistoryLoadingState', openIdx);
  const openBody = src.slice(openIdx, openEnd);
  assert.ok(openBody.includes('startAiPollTimers()'), 'openAiChat 应调 startAiPollTimers');
});

test('D-M4: 不依赖 S.active 做守卫——hide 里直接停定时器', () => {
  const hideIdx = src.indexOf('function hideAiChatForTabSwitch()');
  const hideEnd = src.indexOf('function restoreHiddenAiChat(', hideIdx);
  const hideBody = src.slice(hideIdx, hideEnd);
  assert.ok(!hideBody.includes('if (!S.active) return'), 'hide 不应靠 S.active 守卫（切 tab 时它仍为 true）');
});
