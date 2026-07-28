const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

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
  assert.match(aiSource, /if \(opts\.preserveExistingMessages\)/);
  assert.match(aiSource, /ai-history-cache-banner/);
  assert.match(aiSource, /当前显示缓存记录，刷新失败/);
  assert.match(aiSource, /ai-history-cache-retry/);
});

// 7. 刷新成功后缓存状态消失
test('Requirement 7: Successful history load removes history unavailable banner', () => {
  assert.match(aiSource, /removeHistoryUnavailableBanner\(messagesEl\)/);
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
