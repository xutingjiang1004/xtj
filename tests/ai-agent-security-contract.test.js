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

test('reasoning hides the empty reply bubble until an answer token arrives', () => {
  assert.match(source, /assistantBubble\.classList\.add\('ai-reply-pending'\)/);
  assert.match(source, /function ensureAssistantBubbleReady\(\) \{[\s\S]{0,180}assistantBubble\.classList\.remove\('ai-reply-pending'\)/);
  assert.match(source, /var contentChunk = evt\.text \|\| '';[\s\S]{0,120}if \(!contentChunk\) continue;/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'ai-agent.css'), 'utf8');
  assert.match(css, /\.ai-msg\.assistant\.generating \.ai-msg-bubble\.ai-reply-pending\s*\{\s*display:\s*none;/);
});

test('AI routes do not treat a normally completed request body as a disconnect', () => {
  const aiRouteStart = serverSource.indexOf("app.post('/api/agent/chat'");
  const aiRouteEnd = serverSource.indexOf("app.post('/api/agent/chat/stream'", aiRouteStart);
  const aiRoutes = serverSource.slice(aiRouteStart, aiRouteEnd + 1800);
  assert.doesNotMatch(aiRoutes, /req\.on\(['"]close['"]/);
  assert.match(aiRoutes, /req\.on\(['"]aborted['"]/);
  assert.match(aiRoutes, /res\.on\(['"]close['"]/);
});

test('normal chat stream keeps the SSE connection alive with heartbeats', () => {
  // 普通聊天路由必须有心跳保活：DeepSeek 思考模型首个 token 前可能沉默 20-60s，
  // 若无 keep-alive，代理/网络切断空闲连接后前端只会看到"AI 暂时没有回应"。
  const routeStart = serverSource.indexOf("app.post('/api/agent/chat/stream'");
  const routeEnd = serverSource.indexOf('app.get(\'/api/agent/chat/conversations\'', routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.match(route, /startStreamHeartbeat\(\)/);
  assert.match(route, /type: 'heartbeat'/);
  assert.match(route, /_sseLastWriteAt/);
  assert.match(route, /clearStreamHeartbeat\(\)/);
  assert.match(route, /safeEnd\(\) \{ clearStreamHeartbeat\(\)/);
  // 前端显式忽略 heartbeat，避免未来事件类型解析冲突
  assert.match(source, /if \(evt\.type === 'heartbeat'\) \{[\s\S]{0,80}continue;/);
});
