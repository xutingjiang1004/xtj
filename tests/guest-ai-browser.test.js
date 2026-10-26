'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

test('游客 AI 开关：开启可聊天且不请求历史，关闭后下一条消息立即要求登录', { timeout: 60000 }, async t => {
  const f = await postBrowserFixture({ user: '', publicPosts: true, counts: [1] });
  t.after(() => f.close());
  const page = f.page;

  await page.evaluate(() => {
    window.__guestMode = true;
    window.guestCalls = [];
    const base = window.fetch;
    window.fetch = async function(url, opts) {
      opts = opts || {};
      const path = new URL(url, location.href).pathname;
      if (!path.startsWith('/api/agent/')) return base(url, opts);
      let body = null;
      try { body = opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      window.guestCalls.push({ path: path, method: opts.method || 'GET', body: body, headers: opts.headers || {} });
      const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
      if (path.endsWith('/guest-mode')) return json({ ok: true, enabled: window.__guestMode === true });
      if (path.endsWith('/config')) return json({ ok: true, config: { name: '小猫', deep_think: { enabled: true } } });
      if (path.endsWith('/custom-models')) return json({ ok: true, models: [], server_models: [] });
      if (path.endsWith('/chat/history')) return json({ ok: false, error: 'login required' }, 401);
      if (path.endsWith('/chat/stream')) {
        return new Response(new ReadableStream({ start(controller) { window.guestStream = controller; } }), {
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }
      return json({ ok: true });
    };
    window.guestEmit = function(event) {
      window.guestStream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'));
    };
  });

  await page.evaluate(() => __xtjOpenAiChat());
  await page.waitForSelector('#aiChatMsgInput');
  await page.fill('#aiChatMsgInput', '游客第一次提问');
  await page.click('#aiChatSendBtn');
  await page.waitForFunction(() => window.guestCalls.some(c => c.path.endsWith('/chat/stream')));

  const first = await page.evaluate(() => ({
    calls: window.guestCalls,
    stream: window.guestCalls.find(c => c.path.endsWith('/chat/stream'))
  }));
  assert.equal(first.calls.some(c => c.path.endsWith('/chat/history')), false, '游客不应请求账号历史');
  // The public managed-model catalog was opened by the concurrent update.
  // Guests can read its sanitized metadata while account history stays private.
  const catalogCalls = first.calls.filter(c => c.path.endsWith('/custom-models'));
  assert.ok(catalogCalls.length > 0, '游客可读取已公开的托管模型目录');
  assert.ok(catalogCalls.every(c => c.method === 'GET' && c.headers.Authorization === undefined), '匿名目录仅做无凭证读取');
  assert.ok(first.stream, '游客应当能发起聊天流');
  assert.equal(first.stream.body.message, '游客第一次提问');
  assert.equal(first.stream.headers.Authorization, undefined, '游客请求不应携带旧凭证');

  await page.evaluate(() => {
    window.guestEmit({ type: 'content', text: '游客回复成功' });
    window.guestEmit({ type: 'done', content: '游客回复成功', saved: false, complete: true });
    window.guestStream.close();
  });
  await page.waitForFunction(() => !document.querySelector('.ai-msg.generating'));
  assert.match(await page.locator('#aiChatRoot').innerText(), /游客回复成功/);

  // 管理员关闭开关：下一条消息必须重新查询并立即回到登录提示，不能继续发起流。
  await page.evaluate(() => { window.__guestMode = false; });
  await page.fill('#aiChatMsgInput', '关闭后还能聊吗');
  await page.click('#aiChatSendBtn');
  await page.waitForFunction(() => window.guestCalls.some(c => c.path.endsWith('/guest-mode') && c.method === 'GET'));
  await page.waitForTimeout(600);
  const second = await page.evaluate(() => ({
    streams: window.guestCalls.filter(c => c.path.endsWith('/chat/stream')).length,
    guestChecks: window.guestCalls.filter(c => c.path.endsWith('/guest-mode')).length,
    text: document.body.innerText
  }));
  assert.equal(second.streams, 1, '开关关闭后不得再发起新的聊天流');
  assert.ok(second.guestChecks >= 2, '每条消息都应重新检查开关');
  assert.match(second.text, /请先登录后再和小猫聊天/);
  assert.deepEqual(f.errors, []);
});
