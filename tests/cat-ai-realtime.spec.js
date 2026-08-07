const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('js/core.js', 'utf8');
const server = fs.readFileSync('render-api/server.js', 'utf8');

test('pollCatAiReply uses exponential backoff', () => {
  assert.match(core, /var backoff = Math\.min\(baseInterval \* Math\.pow\(2, retryCount\)/);
  assert.match(core, /retryCount/);
  assert.match(core, /maxRetries = 5/);
});

test('pollCatAiReply max duration extended to 90 seconds', () => {
  assert.match(core, /maxRunTime = 90000/);
});

test('pollCatAiReply does not delete task on page hide', () => {
  assert.match(core, /document\.hidden/);
  assert.match(core, /setTimeout\(poll, 3000\)/);
  // 不应该删除任务
  assert.ok(!/document\.hidden[\s\S]*?removeCatAiStatus/.test(
    core.substring(core.indexOf('pollCatAiReply'), core.indexOf('pollCatAiReply') + 2000)
  ));
});

test('pollCatAiReply directly inserts AI reply into feedAllComments and DOM', () => {
  assert.match(core, /insertCatAiCommentIntoDOM/);
  assert.match(core, /feedAllComments\.push\(aiComment\)/);
  assert.match(core, /writeFeedCacheSnapshot/);
});

test('pollCatAiReply uses AbortController for request timeout', () => {
  assert.match(core, /__catAiPollControllers/);
  assert.match(core, /new AbortController/);
  assert.match(core, /setTimeout\(function\(\) \{ controller\.abort\(\)/);
});

test('subscribeToComments handles AI comments via INSERT', () => {
  assert.match(core, /row\.generated_by_ai === true && row\.user_name === 'cat_ai' && row\.parent_comment_id/);
  assert.match(core, /insertCatAiCommentIntoDOM/);
  assert.match(core, /removeCatAiStatus/);
});

test('subscribeToComments deduplicates by comment ID', () => {
  assert.match(core, /feedAllComments = \(feedAllComments \|\| \[\]\)\.filter/);
  assert.match(core, /String\(comment && comment\.id\) !== commentId/);
});

test('subscribeToComments auto-reconnects on channel error', () => {
  assert.match(core, /CHANNEL_ERROR.*TIMED_OUT.*CLOSED/);
  assert.match(core, /_reconnectAttempts/);
  assert.match(core, /_maxReconnectAttempts = 10/);
});

test('subscribeToComments checks and restores on visibilitychange', () => {
  assert.match(core, /visibilitychange/);
  assert.match(core, /commentRealtime\.state === 'closed'/);
});

test('subscribeToComments checks and restores on online and pageshow', () => {
  assert.match(core, /window\.addEventListener\('online'/);
  assert.match(core, /window\.addEventListener\('pageshow'/);
});

test('renderCatAiComment uses real created_at, not fixed 刚刚', () => {
  assert.match(core, /formatRelativeTime\(comment\.created_at\)/);
  // 不应该有固定的"刚刚"
  assert.ok(!/renderCatAiComment[\s\S]*?<span class="comment-item-time">刚刚<\/span>/.test(core));
});

test('renderCatAiComment has no typing indicator in completed state', () => {
  assert.ok(!/renderCatAiComment[\s\S]*?ai-typing-indicator/.test(core));
});

test('backend ai-reply-status returns full comment data when completed', () => {
  assert.match(server, /if \(replyRes\.data\)/);
  assert.match(server, /data: r/);
});

test('backend hasCatMention supports full-width @', () => {
  assert.match(server, /[@＠]小猫/);
});

test('backend extractCatQuestion supports full-width @', () => {
  assert.match(server, /[@＠]小猫\\s\*/);
});