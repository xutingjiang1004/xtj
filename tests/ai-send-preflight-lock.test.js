'use strict';
// A-M1 回归：访客预检窄窗口重复发送。
// 修复前：handleSendMessage 里 S.sending=true 在 await ensureGuestAiMode()
//   之后，访客首次发送的预检 await 期间两次点击都会进预检、开出两条流。
// 修复后：预检 await 之前同步置 S._sendPreflight 锁，入口处检查；
//   S.sending=true 接管后释放，预检失败的早退路径同样释放。锁只覆盖预检窗口，
//   不改变「再次发送=打断上一条」（S.sending=true 后仍走 interruptCurrentChat）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const fnIdx = src.indexOf('async function handleSendMessage(');
assert.ok(fnIdx >= 0, '应有 handleSendMessage');
const fnSrc = src.slice(fnIdx, fnIdx + 9000);

test('A-M1: 预检 await 之前同步置锁，入口处先查锁', () => {
  const awaitIdx = fnSrc.indexOf('await ensureGuestAiMode()');
  assert.ok(awaitIdx >= 0, '应有访客预检 await ensureGuestAiMode()');
  const setIdx = fnSrc.indexOf('S._sendPreflight = true');
  assert.ok(setIdx >= 0, '预检前应同步置 S._sendPreflight = true');
  assert.ok(setIdx < awaitIdx, '置锁必须在 await 之前（同一同步段内），否则两个点击仍能同时进预检');
  assert.ok(awaitIdx - setIdx < 300, '置锁与 await 之间不应隔着其它 await/长逻辑');
  const checkIdx = fnSrc.indexOf('if (S._sendPreflight)');
  assert.ok(checkIdx >= 0, '入口处应检查 S._sendPreflight');
  assert.ok(checkIdx < setIdx, '查锁必须在置锁之前');
});

test('A-M1: 预检锁只在访客分支内设置，登录用户不受影响', () => {
  const guestGuard = fnSrc.indexOf("if (!readUserName() && !S.guestAi) { await ensureGuestAiMode(); }");
  if (guestGuard >= 0) assert.fail('旧的单行预检写法应已被带锁的写法替换');
  const setIdx = fnSrc.indexOf('S._sendPreflight = true');
  const guardStart = fnSrc.lastIndexOf("if (!readUserName() && !S.guestAi)", setIdx);
  assert.ok(guardStart >= 0 && setIdx - guardStart < 200, '置锁应在访客预检分支内');
});

test('A-M1: 锁在 S.sending 接管时释放，预检失败的早退路径也释放', () => {
  const awaitIdx = fnSrc.indexOf('await ensureGuestAiMode()');
  const sendingIdx = fnSrc.indexOf('S.sending = true', awaitIdx);
  assert.ok(sendingIdx >= 0, '预检后应有 S.sending = true 接管');
  const releaseIdx = fnSrc.indexOf('S._sendPreflight = false', awaitIdx);
  assert.ok(releaseIdx >= 0 && releaseIdx <= sendingIdx + 120,
    'S.sending=true 接管处应释放预检锁');
  // 预检失败（未登录）/面板未就绪/超长三条早退都必须释放，否则一次失败就永久锁死访客发送。
  const tail = fnSrc.slice(awaitIdx, sendingIdx);
  const releases = (tail.match(/S\._sendPreflight = false/g) || []).length;
  assert.ok(releases >= 3, '预检 await 与 S.sending=true 之间的早退路径应逐一释放锁，实得 ' + releases + ' 处');
});

test('A-M1: 「再次发送=打断上一条」不变：打断判断仍保留在预检与 S.sending 之间', () => {
  const interruptIdx = fnSrc.indexOf('if (S.sending || S._interruptChat) interruptCurrentChat();');
  assert.ok(interruptIdx >= 0, '应保留再次发送打断上一条的判断');
  const awaitIdx = fnSrc.indexOf('await ensureGuestAiMode()');
  const sendingIdx = fnSrc.indexOf('S.sending = true', awaitIdx);
  assert.ok(interruptIdx > awaitIdx && interruptIdx < sendingIdx,
    '打断判断应仍在预检之后、S.sending=true 之前（原位置不动）；预检锁只拦预检窗口内的重复点击，流式回复中的再次发送仍走打断');
});
