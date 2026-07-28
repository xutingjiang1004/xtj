const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('AI module does not read legacy password-equivalent hashes', () => {
  assert.doesNotMatch(source, /PW_HASH_KEYS|readPwHash|hasLocalPasswordHash/);
});

test('AI cancellation obtains auth through the shared token helper', () => {
  assert.match(source, /window\.ensureUserToken/);
  assert.doesNotMatch(source, /localStorage\.getItem\(['"]xtj_user_token['"]\)/);
});

test('server-provided thought labels are HTML escaped', () => {
  assert.doesNotMatch(source, /ai-thought-role[^\n]+\+ roleLabel \+/);
  assert.doesNotMatch(source, /escapeHtml\([^\n]+\) \+ roundLabel/);
  assert.match(source, /escapeHtml\(roleLabel\) \+ escapeHtml\(roundLabel\)/);
});

test('AI close clears recurring status and configuration timers', () => {
  const closeStart = source.indexOf('function closeAiChat()');
  assert.notEqual(closeStart, -1);
  const closeBody = source.slice(closeStart, source.indexOf('function ', closeStart + 30));
  assert.match(closeBody, /clearInterval\(S\.statusTimer\)/);
  assert.match(closeBody, /clearInterval\(S\._configRefreshTimer\)/);
});

test('AI attachments are sent as structured payloads and consumed only after success', () => {
  assert.match(source, /attachments:\s*attachmentPayload/);
  assert.match(source, /data_url:\s*fileData\.dataUrl/);
  assert.match(source, /consumeAiAttachment\(fileData\)/);
  assert.match(source, /onSuccess:\s*function\(\)/);
  assert.doesNotMatch(source, /attachments:\s*attachmentPayload \|\| \[\]/);
});

test('server extracts structured attachments on normal, stream, and deep routes', () => {
  assert.match(serverSource, /async function extractChatAttachments\(message, attachments\)/);
  assert.equal((serverSource.match(/extractChatAttachments\(message, req\.body && req\.body\.attachments\)/g) || []).length, 3);
  assert.match(serverSource, /缺少文件数据/);
  assert.match(serverSource, /文件数据格式无效/);
  assert.match(serverSource, /attachments\.length, 10/);
});

test('AI upload controls only advertise formats supported by the extractor', () => {
  assert.match(source, /function isSupportedAiFile\(file\)/);
  assert.match(source, /\\\.\(pdf\|docx\|txt\|csv\|xlsx\)\$/);
  assert.doesNotMatch(source, /accept: ['"]image\/\*\.pdf/);
  assert.doesNotMatch(source, /accept: ['"]image\/\*,\.pdf,\.doc,\.docx/);
});

test('deep research close invalidates callbacks, aborts streams, and clears transient files', () => {
  const closeStart = source.indexOf('function closeDeepThinkPage()');
  assert.notEqual(closeStart, -1);
  const closeBody = source.slice(closeStart, source.indexOf('var _dtFileData', closeStart));
  assert.match(closeBody, /S\.lifecycleId\+\+/);
  assert.match(closeBody, /S\.clientRequestId\+\+/);
  assert.match(closeBody, /S\.abortController\.abort/);
  assert.match(closeBody, /S\.deepThinkJob\.abort/);
  assert.match(closeBody, /_dtFileData\s*=\s*null/);
});

test('search result links are restricted to http(s)', () => {
  assert.match(source, /function safeSearchUrl\(value\)/);
  assert.match(source, /parsed\.protocol !== 'http:' && parsed\.protocol !== 'https:'/);
  assert.match(source, /href:\s*safeSrUrl \|\| '#'/);
  assert.doesNotMatch(source, /href="' \+ escapeHtml\(sr\.url\)/);
  assert.doesNotMatch(source, /href:\s*r2\.url\s*\|\|\s*'#'/);
});

test('api requests propagate caller abort signals', () => {
  assert.match(source, /options\.signal \|\| \(options\.abortController && options\.abortController\.signal\)/);
  assert.match(source, /externalSignal\.addEventListener\('abort'/);
});

test('chat send locks before awaiting authentication', () => {
  const sendStart = source.indexOf('async function handleSendMessage');
  const sendBody = source.slice(sendStart, source.indexOf('async function ', sendStart + 30));
  assert.match(sendBody, /S\.sending\s*=\s*true/);
  assert.ok(sendBody.indexOf('S.sending = true') < sendBody.indexOf('await ensureUserAuthOrNotify'));
});

test('failed AI requests remove the temporary typing bubble and reveal quota outages', () => {
  const sendStart = source.indexOf('async function handleSendMessage');
  const sendBody = source.slice(sendStart, source.indexOf('async function ', sendStart + 30));
  const typingStart = sendBody.indexOf("var assistantBubble = el('div', { class: 'ai-msg-bubble ai-typing-bubble' })");
  const fetchStart = sendBody.indexOf('var resp = await fetch(url');
  assert.ok(typingStart >= 0 && fetchStart > typingStart);
  assert.ok(sendBody.indexOf('function hideAssistantTyping()', typingStart) < fetchStart);
  const httpErrorBody = sendBody.slice(sendBody.indexOf('if (!resp.ok)'), sendBody.indexOf('if (!resp.body)'));
  const bodylessError = sendBody.slice(sendBody.indexOf('if (!resp.body)'), sendBody.indexOf('var reader = resp.body.getReader()'));
  assert.match(httpErrorBody, /assistantNode\.remove\(\)/);
  assert.match(bodylessError, /assistantNode\.remove\(\)/);
  assert.match(sendBody, /catch \(e\) \{ throw e; \}/);
  assert.match(serverSource, /function getAiQuotaErrorMessage\(reason\)/);
  assert.match(serverSource, /reason === 'quota_unavailable'/);
});

test('AI routes do not treat a normally completed request body as a disconnect', () => {
  const aiRouteStart = serverSource.indexOf("app.post('/api/agent/chat'");
  const aiRouteEnd = serverSource.indexOf("app.post('/api/agent/chat/stream'", aiRouteStart);
  const aiRoutes = serverSource.slice(aiRouteStart, aiRouteEnd + 1800);
  assert.doesNotMatch(aiRoutes, /req\.on\(['"]close['"]/);
  assert.match(aiRoutes, /req\.on\(['"]aborted['"]/);
  assert.match(aiRoutes, /res\.on\(['"]close['"]/);
});
