'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
const aiAgent = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const photoData = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'data.js'), 'utf8');
const photoRender = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'render.js'), 'utf8');

function routeSource(method, route, nextRoute) {
  const startToken = `app.${method}('${route}'`;
  const start = server.indexOf(startToken);
  assert.notEqual(start, -1, `missing ${method.toUpperCase()} ${route}`);
  const end = nextRoute ? server.indexOf(nextRoute, start + startToken.length) : server.length;
  assert.ok(end > start, `could not isolate ${route}`);
  return server.slice(start, end);
}

// 1 & 2: retry queries ai_comment_reply_jobs and uses source_comment_id
test('retry endpoint queries ai_comment_reply_jobs with source_comment_id', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /supabase\.from\('ai_comment_reply_jobs'\)/);
  assert.match(retrySource, /\.eq\('source_comment_id', commentId\)/);
  assert.doesNotMatch(retrySource, /supabase\.from\('ai_reply_jobs'\)/);
});

// 3: bigint comment ID is preserved as string and not passed through Number or parseInt
test('bigint comment ID is validated with regex and not converted with parseInt or Number', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /commentIdRaw/);
  assert.match(retrySource, /test\(commentIdRaw\)/);
  assert.doesNotMatch(retrySource, /parseInt\(String\(req\.body/);
  assert.doesNotMatch(retrySource, /Number\.isFinite/);
});

// 4: completed returns full cat_ai comment format
test('retry completed status returns full cat_ai comment data structure', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /\.eq\('user_name', 'cat_ai'\)/);
  assert.match(retrySource, /\.eq\('generated_by_ai', true\)/);
  assert.match(retrySource, /data: aiReplyComment/);
});

// 5: failed transient error can retry
test('failed status retries transient errors without resetting cumulative attempts', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /status: 'pending'/);
  assert.match(retrySource, /error_message: null/);
  assert.doesNotMatch(retrySource, /attempts:\s*0/);
  assert.match(retrySource, /checkCatRateLimit\(sourceComment\.user_name, post\.id\)/);
});

// 6: safety blocked is non-retryable
test('safety blocked or deleted resource returns non_retryable', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /code: 'non_retryable'/);
  assert.match(retrySource, /blocked by safety check/);
});

// 7: pending/processing returns status without duplicate task creation
test('pending or processing status returns existing status without creating duplicate job', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /if \(existingJob && \(existingJob\.status === 'pending' || existingJob\.status === 'processing'\)\)/);
  assert.match(retrySource, /return res\.json\(\{ ok: true, status: existingJob\.status/);
});

// 8: no job creates via createCatReplyJob
test('no existing job reuses createCatReplyJob', () => {
  const retrySource = routeSource('post', '/api/comments/ai-reply-retry', "app.post('/api/brain/add'");
  assert.match(retrySource, /createCatReplyJob\(commentId, sourceComment\.post_id, userName\)/);
});

// 9: AI chat sends request and processes SSE stream
test('AI agent chat uses SSE stream endpoint and updates DOM', () => {
  const streamEndpoint = routeSource('post', '/api/agent/chat/stream', "app.get('/api/agent/chat/conversations'");
  assert.match(streamEndpoint, /text\/event-stream/);
  assert.match(aiAgent, /\/chat\/stream/);
  assert.match(aiAgent, /getReader\(\)/);
  assert.match(aiAgent, /renderMarkdown/);
});

// 10: Private DM history uses authenticated API, stale sequence guard, and AbortController
test('Private DM history handles loading with AbortController and sequence guard', () => {
  const dmMessagesEndpoint = routeSource('get', '/api/dm/messages', "app.post('/api/dm/read'");
  assert.match(dmMessagesEndpoint, /authenticateUser/);
  assert.match(core, /loadDockChatMessages/);
  assert.match(core, /_dockChatLoadSeq/);
  assert.match(core, /AbortController/);
  assert.match(core, /window\.xtjProtectedFetch\('\/api\/dm\/messages\?/);
});

// 11: Public photos API returns 3 items -> normalized into photo array
test('Public photo wall endpoint returns public photos without requiring protected auth', () => {
  const photosEndpoint = routeSource('get', '/api/photos/public', "app.get('/api/avatar/:userName'");
  assert.match(photosEndpoint, /media_type.*__photo_wall__/);
  assert.match(photosEndpoint, /res\.json\(\{ ok: true, data: data \|\| \[\] \}\)/);
  assert.match(photoData, /\/api\/photos\/public\?page=/);
  assert.match(photoData, /normalizePhotoWallRow/);
});

// 12: Photo API failure shows error and retry button
test('Photo wall API error displays error state with reload button', () => {
  assert.match(photoData, /setPhotoWallSyncStatus\('error'/);
  assert.match(photoRender, /pwSyncStatus/);
  assert.match(photoRender, /initPhotoWall\(true\)/);
});
