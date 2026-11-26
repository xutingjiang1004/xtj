'use strict';
// A-M2 回归：“继续生成”伪造用户消息、覆盖草稿。
// 修复前：点“继续生成”把模板句写进输入框再调 handleSendMessage，模板句
//   进 S.messages、画用户气泡、写历史缓存，服务端还把它存为用户轮次；
//   覆盖输入框前不保存草稿，用户正在打的字直接丢了。
// 修复后：继续生成走不进历史的内部续写请求（continuation），模板句只作
//   本次请求的 message 发给模型，不进 S.messages、不画气泡、不写缓存，
//   服务端也不把它存为用户轮次；发送前先把输入框草稿记进会话草稿表，
//   输入框本身也不再被模板句覆盖。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const agentSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const { saveCustomChatTurn, saveInterruptedChatTurn } = require('../render-api/ai-chat-save');

const CONTINUE_TEXT = '请在上文基础上继续写完，不要重复已说内容。';

test('A-M2: 继续生成先保存草稿，且不再把模板句写进输入框', () => {
  const btnIdx = agentSrc.indexOf('function attachContinueGenerateBtn');
  assert.ok(btnIdx >= 0, '应有 attachContinueGenerateBtn');
  const btnBody = agentSrc.slice(btnIdx, btnIdx + 4500);
  assert.ok(btnBody.includes('_saveAiComposerDraft'), '点继续生成前应先保存输入框草稿');
  assert.ok(!btnBody.includes("inputEl.value = '" + CONTINUE_TEXT + "'"), '模板句不应再写进输入框');
  assert.ok(btnBody.includes('continuation: true'), '应以 continuation 内部续写请求发送');
  assert.ok(agentSrc.includes('S._saveAiComposerDraft = function'), '应有 _saveAiComposerDraft 草稿保存入口');
});

test('A-M2: 内部续写请求不进 S.messages、不画用户气泡、不写历史缓存', () => {
  const sendIdx = agentSrc.indexOf('async function handleSendMessage(');
  assert.ok(sendIdx >= 0, '应有 handleSendMessage');
  const sendBody = agentSrc.slice(sendIdx, sendIdx + 9000);
  assert.ok(sendBody.includes('isContinuation'), 'handleSendMessage 应识别 continuation');
  // 模板句只作本次请求的 message：请求体带 continuation 标记，服务端据此不存用户轮次
  assert.ok(agentSrc.includes('continuation: isContinuation'), '请求体应带 continuation 标记');
  // 用户轮次落定处必须按 continuation 分流
  const pushIdx = agentSrc.indexOf('S.messages.push(userMsg)');
  assert.ok(pushIdx >= 0, '应有 S.messages.push(userMsg)');
  assert.ok(agentSrc.slice(pushIdx - 1200, pushIdx).includes('isContinuation'), 'push 用户轮次前应有 continuation 分流');
});

test('A-M2: 服务端 saveCustomChatTurn 遇 continuation 只存助手回复', async () => {
  const stored = [];
  const db = { from() { return { async insert(rows) { stored.push(...rows); return { error: null }; } }; } };
  const buildMeta = (role, convId, usage, reasoning, seq, search, elapsed, extra) => JSON.stringify({ role, convId, ...extra });
  const ok = await saveCustomChatTurn({ db, userName: 'alice', convId: 'ABCDEF', message: CONTINUE_TEXT,
    content: '续写内容', model: 'chosen', buildMeta, marker: '__ai_agent_msg__', continuation: true });
  assert.equal(ok, true);
  assert.equal(stored.length, 1, 'continuation 只应存 1 行（助手回复），不应存模板用户轮次');
  assert.equal(JSON.parse(stored[0].media_url).role, 'assistant');
  assert.equal(stored[0].content, '续写内容');
});

test('A-M2: 服务端 saveInterruptedChatTurn 遇 continuation 不存模板用户轮次', async () => {
  const stored = [];
  const db = { from() { return { async insert(rows) { stored.push(...rows); return { error: null }; } }; } };
  const buildMeta = (role, convId, usage, reasoning, seq, search, elapsed, extra) => JSON.stringify({ role, convId, ...extra });
  // 有续写内容：只存助手行
  const ok = await saveInterruptedChatTurn({ db, userName: 'alice', convId: 'ABCDEF', message: CONTINUE_TEXT,
    content: '半截续写', reasoning: '', model: 'm', thinkingMode: 'off', buildMeta, marker: '__ai_agent_msg__',
    continuation: true, startedAt: 1000, requestId: 'req-1' });
  assert.equal(ok, true);
  assert.equal(stored.length, 1, '中断续写只应存助手行');
  assert.equal(JSON.parse(stored[0].media_url).role, 'assistant');
  // 无任何内容：不应为模板句单独建一条用户轮次
  let inserts = 0;
  const db2 = { from() { return { async insert(rows) { inserts++; return { error: null }; } }; } };
  const ok2 = await saveInterruptedChatTurn({ db: db2, userName: 'alice', convId: 'ABCDEF', message: CONTINUE_TEXT,
    content: '', reasoning: '', model: 'm', thinkingMode: 'off', buildMeta, marker: '__ai_agent_msg__',
    continuation: true, startedAt: 1000, requestId: 'req-2' });
  assert.equal(ok2, false, '无内容的续写中断不应落库');
  assert.equal(inserts, 0, '无内容的续写中断不应 insert');
});

test('A-M2: 内置流 finishStream 遇 continuation 不把模板句存为用户轮次', () => {
  const fsIdx = serverSrc.indexOf('async function finishStream(');
  assert.ok(fsIdx >= 0, '应有 finishStream');
  const fsBody = serverSrc.slice(fsIdx, serverSrc.indexOf('\n// ★ 2026-09-13', fsIdx));
  assert.ok(fsBody.includes('continuation'), 'finishStream 保存处应识别 continuation');
  assert.ok(/isContinuation/.test(fsBody), 'finishStream 应有 isContinuation 分流');
  // 内置流入口应把请求体的 continuation 记到 res 上，供 finishStream/中断保存共用
  assert.ok(serverSrc.includes('_aiContinuation'), '内置流应把 continuation 记到 res._aiContinuation');
});
