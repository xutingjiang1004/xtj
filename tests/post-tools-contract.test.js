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

test('post chat SSE correctly detects empty streams to avoid infinite loading', {timeout:45000}, async () => {
  const { postBrowserFixture } = require('./helpers/post-browser-fixture');
  const fixture = await postBrowserFixture({counts:[1]});
  try {
    const replies = ['', 'event:done\ndata:{}\n\n', 'event:message\ndata:{"content":"完整锐评"}\n\nevent:done\ndata:{}'];
    let calls = 0;
    await fixture.page.route('**/api/agent/post-chat/stream', route => {
      const body = replies[calls++];
      return route.fulfill({contentType:'text/event-stream', body});
    });
    for (let i = 0; i < 2; i++) {
      await fixture.page.evaluate(id => openPostAiChat(id), fixture.posts[0].id);
      await fixture.page.waitForSelector('.post-tool-critique.is-error');
      assert.equal(await fixture.page.locator('.post-tool-critique').textContent(), 'AI 暂时不可用。');
    }
    await fixture.page.evaluate(id => openPostAiChat(id), fixture.posts[0].id);
    await fixture.page.waitForFunction(() => document.querySelector('.post-tool-critique')?.textContent === '完整锐评');
    assert.equal(await fixture.page.locator('.post-tool-critique').evaluate(node => node.classList.contains('is-error')), false);
    assert.equal(calls, 3);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});

test('server post chat stream avoids premature abort on req.close', () => {
  assert.match(server, /res\.on\('close', function\(\) \{ if \(!res\.writableEnded\)/);
});
