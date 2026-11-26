'use strict';
// D-M6 回归：断网无前置判断。
// 修复前：handleSendMessage 全程无 navigator.onLine 判断，离线时也要先跑
//   访客预检（/guest-mode）再等 fetch 抛 TypeError 才提示。
// 修复后：发送入口先判 navigator.onLine===false，直接给「网络已断开」
//   提示、不发请求。失败后的离线指示逻辑（S.serviceStatus='offline'、
//   状态栏离线指示）不动。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const fnIdx = src.indexOf('async function handleSendMessage(');
assert.ok(fnIdx >= 0, '应有 handleSendMessage');
const fnSrc = src.slice(fnIdx, fnIdx + 9000);

test('D-M6: 发送入口先判断网，直接提示、不发请求', () => {
  const checkIdx = fnSrc.indexOf('navigator.onLine === false');
  assert.ok(checkIdx >= 0, '发送入口应判 navigator.onLine===false');
  const check = fnSrc.slice(checkIdx - 100, checkIdx + 300);
  assert.ok(check.includes('网络已断开'), '断网提示应含「网络已断开」');
  assert.ok(check.includes('return;') || check.includes('return }'), '断网时应直接 return、不发请求');
  const preflightIdx = fnSrc.indexOf('await ensureGuestAiMode()');
  assert.ok(checkIdx < preflightIdx, '断网判断应在访客预检 await 之前，否则预检请求仍会先发出去');
  const sendingIdx = fnSrc.indexOf('S.sending = true', checkIdx);
  assert.ok(checkIdx < sendingIdx, '断网判断应在 S.sending=true 之前，不占发送锁');
});

test('D-M6: 空草稿仍静默返回，断网判断不抢空发送的语义', () => {
  const emptyIdx = fnSrc.indexOf("if (!text && !fileList.some(function(f) { return f && f.dataUrl; })) return;");
  const checkIdx = fnSrc.indexOf('navigator.onLine === false');
  assert.ok(emptyIdx >= 0 && emptyIdx < checkIdx, '空草稿静默返回应在断网判断之前');
});

test('D-M6: 失败后的离线指示逻辑不动', () => {
  assert.ok(src.includes("S.serviceStatus = r && (r.status === 0 || r.error_code === 'timeout') ? 'offline' : 'degraded';"),
    '请求失败后按状态置 S.serviceStatus offline/degraded 的逻辑应保留');
  assert.ok(src.includes("if (S.serviceStatus === 'offline') return '服务离线';"),
    '状态栏离线指示文案应保留');
});
