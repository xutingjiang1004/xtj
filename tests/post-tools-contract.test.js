const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('post actions expose only the fixed tools menu and no edit entry', () => {
  const actionSource = core.slice(core.indexOf('function buildPostActionHtml'), core.indexOf('function buildPostLocationHtml'));
  assert.match(actionSource, /data-post-tool="translate"/);
  assert.match(actionSource, /data-post-tool="ask-ai"/);
  assert.match(actionSource, /data-post-tool="report"/);
  assert.doesNotMatch(actionSource, /openEditPost|编辑/);
});

test('post tools are server-authoritative and expose an SSE post chat endpoint', () => {
  assert.match(server, /app\.post\('\/api\/agent\/post-tools', authenticateUser/);
  assert.match(server, /app\.post\('\/api\/agent\/post-chat\/stream', authenticateUser/);
  assert.match(server, /loadPostToolPost\(postId, req\.userName\)/);
  assert.match(server, /post\.is_deleted === true/);
  assert.match(server, /already_chinese/);
  // ★ 2026 修复：SSE 帧统一改走 writeSse(res, payload, eventName)（带背压上限），
  // 事件名由 sse-write.js 运行时生成；契约不变（客户端仍收到 event: message/delta）。
  const sseWrite = fs.readFileSync(path.join(root, 'render-api', 'sse-write.js'), 'utf8');
  assert.match(sseWrite, /event: ' \+ eventName/);
  assert.match(server, /writeSse\(res, \{[^}]*conversation_id[^}]*\}, 'message'\)/);
  assert.match(server, /writeSse\(res, \{[^}]*conversation_id[^}]*\}, 'delta'\)/);
  assert.match(server, /requestAbort\.abort\(\)/);
});

test('post tools guard against duplicate UI elements', () => {
  assert.match(core, /var host = anchor\.closest\('\.post'\)/);
  assert.match(core, /actions\.insertAdjacentElement\('afterend', panel\)/);
  assert.match(core, /var existing = host\.querySelector\('\.post-tool-critique'\)/);
});

test('post chat SSE correctly detects empty streams to avoid infinite loading', () => {
  assert.match(core, /var receivedContent = false;/);
  assert.match(core, /if \(!receivedContent\)/);
  assert.match(core, /receivedContent = true;/);
});

test('server post chat stream avoids premature abort on req.close', () => {
  assert.match(server, /res\.on\('close', function\(\) \{ if \(!res\.writableEnded\)/);
});
