const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const aiSource = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 1. 用户停止请求返回 aborted
test('Requirement 1: AbortController handles aborted for user stop request', () => {
  assert.match(aiSource, /S\.abortController\._abortReason = 'aborted'/);
  assert.match(aiSource, /S\.abortController\.abort\('aborted'\)/);
  assert.match(aiSource, /errCode = 'aborted'/);
});

// 2. 请求定时器超时返回 timeout
test('Requirement 2: Request timer sets timeout error_code', () => {
  assert.match(aiSource, /requestController\._abortReason = 'timeout'/);
  assert.match(aiSource, /requestController\.abort\('timeout'\)/);
  assert.match(aiSource, /errCode = 'timeout'/);
});

// 3. 网络失败返回 network_error
test('Requirement 3: Fetch failure sets network_error error_code', () => {
  assert.match(aiSource, /errCode = 'network_error'/);
  assert.match(aiSource, /errMsg = \(e && e\.message\) \|\| '网络异常'/);
});

// 4. 主动取消不出现 Toast
test('Requirement 4: Active cancellation (aborted) does not trigger error toast', () => {
  assert.match(aiSource, /if \(r && r\.error_code === 'aborted'\) \{\s*removeHistoryUnavailableBanner/);
  assert.doesNotMatch(aiSource, /if \(r\.error_code === 'aborted'\) notify/);
});

// 5 & 6. 有缓存时刷新失败保留消息且状态显示在聊天内部
test('Requirements 5 & 6: Cached history preserved and internal failure banner shown', () => {
  assert.match(aiSource, /opts\.preserveExistingMessages \|\| hasVisibleMessages/);
  assert.match(aiSource, /ai-history-cache-banner/);
  assert.match(aiSource, /当前显示缓存记录，刷新失败/);
  assert.match(aiSource, /ai-history-cache-retry/);
});

// 7. 刷新成功后缓存状态消失
test('Requirement 7: Successful history load removes history unavailable banner', () => {
  assert.match(aiSource, /removeHistoryUnavailableBanner\(messagesEl\)/);
});

test('cold history load replaces the initial welcome state with a visible loader', () => {
  const loadHistory = aiSource.slice(aiSource.indexOf('async function loadHistory'), aiSource.indexOf('async function fetchConversations'));
  assert.match(loadHistory, /messagesEl\.querySelector\('\.ai-chat-empty'\)/);
  assert.match(loadHistory, /loadingState\.classList\.add\('ai-history-loading'\)/);
});

// 8. 缓存按完整 user/assistant 轮次保存
test('Requirement 8: History cache extracts complete user/assistant turns only', () => {
  assert.match(aiSource, /function extractCompleteTurns\(msgs, maxTurns\)/);
  assert.match(aiSource, /function setAiHistoryCache\(cid, msgs\)/);
  assert.match(aiSource, /function getAiHistoryCache\(cid\)/);
});

// 9. 不同用户缓存不会串号
test('Requirement 9: Cache key includes user key from readUserName()', () => {
  assert.match(aiSource, /var uk = getAiHistoryCacheUserKey\(\)/);
  assert.match(aiSource, /'xtj_ai_history:' \+ uk \+ ':'/);
});

// 9b. 普通聊天与研究模式不能共享同一条会话缓存
test('Requirement 9b: History cache key is isolated by chat mode', () => {
  assert.match(aiSource, /function getAiHistoryCacheKey\(cid, mode\)/);
  assert.match(aiSource, /mode = mode \|\| 'normal'/);
  assert.match(aiSource, /encodeURIComponent\(mode\)/);
  assert.match(aiSource, /getLegacyAiHistoryCacheKey\(cid\)/);
  assert.match(aiSource, /if \(!str && mode === 'normal'\)/);
});

// 10. 登出后当前用户缓存被清理
test('Requirement 10: Logout invokes clearAiHistoryCacheForUser to purge user cache', () => {
  assert.match(aiSource, /function clearAiHistoryCacheForUser\(\)/);
  assert.match(aiSource, /window\.clearAiHistoryCacheForUser = clearAiHistoryCacheForUser/);
  assert.match(coreSource, /typeof window\.clearAiHistoryCacheForUser === 'function'/);
});

// 11. 切换会话不会显示上一会话缓存
test('Requirement 11: Switch conversation clears DOM and queries specific conversation cache', () => {
  assert.match(aiSource, /async function switchConversation\(cid\)/);
  assert.match(aiSource, /removeHistoryUnavailableBanner\(S\.messagesEl\)/);
  assert.match(aiSource, /getAiHistoryCache\(S\.conversationId\)/);
});

// 12. 不修改底部 Dock
test('Requirement 12: Bottom 4 Dock bar items are intact', () => {
  assert.match(indexHtml, /class="dock-bar" id="dockBar"/);
  assert.match(indexHtml, /data-tab="posts"/);
  assert.match(indexHtml, /data-tab="chat"/);
  assert.match(indexHtml, /data-tab="ai"/);
  assert.match(indexHtml, /data-tab="profile"/);
});


test('pure image history turns reconcile with server vision_urls despite different display names', () => {
  const helperStart = aiSource.indexOf('function stripAiHistoryAttachmentData');
  const helperEnd = aiSource.indexOf('function setAiHistoryCache', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'AI history helpers are present');
  const context = vm.createContext({ Date, S: { messages: [] }, CONTEXT_LIMIT_NORMAL: 256, MSG_MAX_CHARS_NORMAL: 16000 });
  vm.runInContext(aiSource.slice(helperStart, helperEnd) + '\nglobalThis.matchHistory = aiHistoryMessagesMatch; globalThis.buildHistory = buildAiConversationHistory; globalThis.reconcileHistory = reconcileAiHistoryPending;', context);

  const createdAt = '2026-09-29T12:00:00.000Z';
  const local = {
    role: 'user',
    content: '![my-cat.png](data:image/png;base64,AAAA)',
    created_at: createdAt,
    attachments: [{ name: 'my-cat.png', type: 'image/png', data_url: 'data:image/png;base64,AAAA' }]
  };
  const remote = {
    role: 'user',
    content: '![图片1](data:image/png;base64,BBBB)',
    created_at: createdAt,
    vision_urls: ['data:image/png;base64,BBBB'],
    attachments: [{ name: '图片1', type: 'image/png', data_url: 'data:image/png;base64,BBBB' }]
  };
  assert.equal(context.matchHistory(local, remote), true);
  assert.equal(context.matchHistory(local, { ...remote, vision_urls: ['data:image/png;base64,1', 'data:image/png;base64,2'], attachments: [remote.attachments[0], remote.attachments[0]] }), false);
  const repeatedLocal = { ...local, created_at: '2026-09-29T12:00:05.000Z' };
  assert.equal(context.reconcileHistory([local, repeatedLocal], [remote], [local, repeatedLocal]).length, 1);

  const localDocument = {
    role: 'user', content: '[📄 notes.pdf · 25KB]', created_at: createdAt,
    attachments: [{ name: 'notes.pdf', type: 'application/pdf', data_url: 'data:application/pdf;base64,AAAA' }]
  };
  const remoteDocument = {
    role: 'user', content: '【用户上传文件: notes.pdf · application/pdf】extracted text【文件结束】', created_at: createdAt
  };
  assert.equal(context.matchHistory(localDocument, remoteDocument), true);
});

test('history request excludes the current turn and keeps prior image attachments structured', () => {
  const helperStart = aiSource.indexOf('function stripAiHistoryAttachmentData');
  const helperEnd = aiSource.indexOf('function setAiHistoryCache', helperStart);
  const context = vm.createContext({ Date, S: { messages: [] }, CONTEXT_LIMIT_NORMAL: 256, MSG_MAX_CHARS_NORMAL: 16000 });
  vm.runInContext(aiSource.slice(helperStart, helperEnd) + '\nglobalThis.buildHistory = buildAiConversationHistory;', context);
  const prior = {
    role: 'user',
    content: 'what is this? ![cat.png](data:image/png;base64,AAAA)',
    created_at: '2026-09-29T11:00:00.000Z',
    attachments: [{ name: 'cat.png', type: 'image/png', data_url: 'data:image/png;base64,AAAA' }]
  };
  const current = { role: 'user', content: 'current question', created_at: '2026-09-29T12:00:00.000Z' };
  context.S.messages = [prior, { role: 'assistant', content: 'a prior answer' }, current];
  const result = context.buildHistory(256, 16000, current, []);
  assert.equal(result.length, 2);
  assert.equal(result[0].attachments[0].data_url, 'data:image/png;base64,AAAA');
  assert.doesNotMatch(result[0].content, /AAAA/);
  assert.equal(result[1].content, 'a prior answer');
});

test('deep research sends use an independent lock and invalidate pending auth on close', () => {
  const start = aiSource.indexOf('async function handleDeepThinkPageSend');
  const end = aiSource.indexOf('var _dtListeners', start);
  const deepSend = aiSource.slice(start, end);
  assert.match(deepSend, /if \(S\._dtSending\)/);
  assert.match(deepSend, /var dtSendToken = \(S\._dtSendSeq/);
  assert.match(deepSend, /await ensureUserAuthOrNotify\(\);\s*if \(!isCurrentDeepSend\(\)\)/);
  assert.match(deepSend, /await getUserAuthPayload\(\{ forceNoToken: false \}\);[\s\S]{0,500}if \(!isCurrentDeepSend\(\)/);
  assert.doesNotMatch(deepSend, /S\.sending\s*=/);

  const closeStart = aiSource.indexOf('function closeDeepThinkPage()');
  const closeEnd = aiSource.indexOf('// 文件上传状态 (dt 页面)', closeStart);
  const closeDeep = aiSource.slice(closeStart, closeEnd);
  assert.match(closeDeep, /S\._dtSendSeq = \(S\._dtSendSeq \|\| 0\) \+ 1/);
  assert.doesNotMatch(closeDeep, /S\.sending\s*=/);
});

test('normal and custom chat send prior history only, then append the current message server-side', () => {
  assert.equal((aiSource.match(/messages_include_current: false/g) || []).length, 2);
  assert.match(aiSource, /buildAiConversationHistory\(_ctxCap, _ctxChars, userMsg, attachmentPayload\)/);
  assert.match(aiSource, /buildAiConversationHistory\(_bCtxCap, _bCtxChars, userMsg, attachmentPayload\)/);
  assert.match(aiSource, /reconcileAiHistoryPending\(S\._pendingLocalMsgs, msgs, S\.messages\)/);
});
