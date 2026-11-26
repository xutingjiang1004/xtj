'use strict';
// A-M6 回归：令牌过期早退留下孤儿「生成中」节点。
// 修复前：额度/鉴权 await 后的令牌/身份校验 return 是裸 return，不清理已创建
//   的 assistantNode、不复位 S.sending。触发：用户在 await 窗口内切换模型
//   （身份过期）且无新发送接管——被新发送接管时新发送的 interruptCurrentChat
//   已同步调过 preserveInterruptedTurn 收尾节点；用户主动停止时中断路径
//   同样已收尾。修复后：三处早退改走 abandonStaleSend()，仅当本轮仍是当前
//   发送（sendToken 仍最新且 _currentReqId 未变）才按中断路径清理节点并
//   直接复位 S.sending（resetSendingIfCurrent 要求身份仍有效，身份过期时
//   会 no-op，所以不能走它）。
// 注意：触发需真机验证（切模型时机窗口很窄），本测试只做源码断言。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const fnIdx = src.indexOf('async function handleSendMessage(');
assert.ok(fnIdx >= 0, '应有 handleSendMessage');
const fnEnd = src.indexOf('function buildHistoryLoadingState', fnIdx);
assert.ok(fnEnd > fnIdx, '应能定位 handleSendMessage 结尾');
const fnSrc = src.slice(fnIdx, fnEnd);

test('A-M6: 有 abandonStaleSend helper，仅当前发送才清理孤儿节点', () => {
  const hIdx = fnSrc.indexOf('function abandonStaleSend()');
  assert.ok(hIdx >= 0, '应有 abandonStaleSend helper');
  const body = fnSrc.slice(hIdx, hIdx + 1500);
  assert.ok(body.includes('if (sendToken !== S.sendSeq || S._currentReqId !== reqId) return false;'),
    '被新发送接管（令牌过期或 reqId 已变）时必须直接返回、不碰节点，避免误删已保留的部分回复');
  assert.ok(body.includes('assistantNode.remove()'), '应移除孤儿 assistantNode');
  assert.ok(body.includes('removeThisUserMessage()'), '应按中断路径移除本轮用户消息');
  assert.ok(body.includes('restoreInputText()'), '应回填输入框草稿');
  assert.ok(body.includes('S.sending = false'), '应直接复位 S.sending（不能走身份门控的 resetSendingIfCurrent）');
  assert.ok(!body.includes('resetSendingIfCurrent()'),
    'helper 内不应调 resetSendingIfCurrent：它要求身份仍有效，身份过期时 no-op，会留下 S.sending=true');
});

test('A-M6: helper 在 controller 已 abort（用户主动停止）时不动节点', () => {
  const hIdx = fnSrc.indexOf('function abandonStaleSend()');
  const body = fnSrc.slice(hIdx, hIdx + 1500);
  assert.ok(body.includes('controller.signal.aborted'), '用户主动停止时中断路径已收尾，helper 应先排除 aborted 再清理');
});

test('A-M6: 额度/鉴权/getUserAuthPayload 三处令牌校验早退都走 abandonStaleSend', () => {
  const quotaIdx = fnSrc.indexOf("if (sendToken !== S.sendSeq || !customModelIdentityCurrent(sendIdentity)) return;");
  assert.ok(quotaIdx < 0, '额度 await 后的裸 return 应改为走 abandonStaleSend');
  const authIdx = fnSrc.indexOf("if (sendToken !== S.sendSeq || !customModelIdentityCurrent(sendIdentity) || S._currentReqId !== reqId) return;");
  assert.ok(authIdx < 0, '鉴权 await 后的裸 return 应改为走 abandonStaleSend');
  const calls = (fnSrc.match(/abandonStaleSend\(\); return;/g) || []).length;
  assert.ok(calls >= 3, '三处早退都应调 abandonStaleSend() 再 return，实得 ' + calls + ' 处');
});

test('A-M6: getUserAuthPayload 后的 !S.active 仍走原有的 abandonInactiveSend', () => {
  const authPayloadIdx = fnSrc.indexOf('await getUserAuthPayload(');
  assert.ok(authPayloadIdx >= 0, '应有 getUserAuthPayload');
  const tail = fnSrc.slice(authPayloadIdx, authPayloadIdx + 700);
  assert.ok(tail.includes('abandonInactiveSend()'), '!S.active 分支应仍走 abandonInactiveSend');
});
