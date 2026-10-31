'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aiPolishFixture } = require('./helpers/ai-polish-fixture');

async function fixture(t, options) {
  const f = await aiPolishFixture(options);
  t.after(() => f.close());
  return f;
}
async function delayFile(page, name) {
  await page.evaluate(name => {
    const NativeReader = FileReader;
    window.FileReader = class extends NativeReader {
      readAsDataURL(file) {
        if (file.name === name) window.releaseRepairFile = () => super.readAsDataURL(file);
        else super.readAsDataURL(file);
      }
    };
  }, name);
}
test('errored native streams report one failure without an unhandled cleanup rejection', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  const result = await p.evaluate(async () => {
    const unhandled = [], events = [];
    window.addEventListener('unhandledrejection', e => unhandled.push(String(e.reason)));
    await XtjAiCore.Transport.readSSEStream(new Response(new ReadableStream({ start(c) { c.error(new TypeError('isolated stream read failure')); } })), e => events.push(e));
    await new Promise(resolve => setTimeout(resolve, 0));
    return { unhandled, types: events.map(e => e.type) };
  });
  assert.deepEqual(result, { unhandled: [], types: ['error'] });
  assert.deepEqual(f.errors, []);
});
test('a server error racing a connection failure restores the chat draft without an unhandled rejection', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => { window.repairUnhandled = []; addEventListener('unhandledrejection', e => repairUnhandled.push(String(e.reason))); });
  await p.locator('#aiChatMsgInput').fill('断流后仍需重试的提问'); await p.locator('#aiChatSendBtn').click();
  await p.waitForFunction(() => aiPolish.streams.length === 1);
  await p.evaluate(() => { aiPolishEmit({ type: 'error', error: '模型暂时不可用，请重试' }); aiPolish.streams[0].controller.error(new TypeError('isolated connection closed')); });
  await p.waitForFunction(() => document.querySelector('#aiChatPauseBtn').style.display === 'none');
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '断流后仍需重试的提问');
  assert.deepEqual(await p.evaluate(() => repairUnhandled), []);
  assert.deepEqual(f.errors, []);
});
test('deleting a conversation invalidates an older history page and keeps pagination and the close button usable', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    const previous = fetch;
    window.repairHistoryCount = 0;
    window.confirm = () => true; window.xtjConfirm = () => Promise.resolve(true);
    window.fetch = (url, options = {}) => {
      if (!new URL(url, location.href).pathname.endsWith('/chat/conversations')) return previous(url, options);
      const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      if (++repairHistoryCount === 1) return Promise.resolve(json({ ok: true, conversations: [{ conversation_id: 'POLISH01', title: '当前会话' }, { conversation_id: 'DELETE01', title: '待删除会话' }], has_more: true, next_cursor: 'CURSOR1' }));
      return new Promise(resolve => window.releaseRepairHistory = () => resolve(json({ ok: true, conversations: [{ conversation_id: 'DELETE01', title: '已删除的迟到记录' }], has_more: false })));
    };
  });
  await p.locator('.ai-chat-hist-btn').click();
  await p.locator('.ai-conv-more').click();
  await p.waitForFunction(() => typeof releaseRepairHistory === 'function');
  await p.locator('[data-conv-id="DELETE01"] .ai-conv-del').click();
  await p.waitForFunction(() => !document.querySelector('[data-conv-id="DELETE01"]'));
  await p.evaluate(async () => { releaseRepairHistory(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(await p.locator('[data-conv-id="DELETE01"]').count(), 0);
  assert.equal(await p.locator('.ai-conv-more').isEnabled(), true);
  await p.locator('.ai-conv-page-close').click({ timeout: 2000 });
  await p.waitForFunction(() => !document.querySelector('.ai-conv-page-shell.is-open'));
  assert.equal(await p.locator('#aiChatMsgInput').isVisible(), true);
  assert.deepEqual(f.errors, []);
});
test('unsent text belongs to its conversation and a new conversation starts with an empty composer', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  const first = await p.evaluate(() => __xtjAiAgent.getConversationId());
  await p.locator('#aiChatMsgInput').fill('第一段会话的真实草稿');
  await p.evaluate(() => __xtjAiAgent.openConversation('SESSIONB01', 'normal'));
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '');
  await p.locator('#aiChatMsgInput').fill('第二段会话的另一条草稿');
  await p.evaluate(id => __xtjAiAgent.openConversation(id, 'normal'), first);
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '第一段会话的真实草稿');
  await p.locator('.ai-chat-new-btn').click();
  await p.waitForFunction(() => __xtjAiAgent.getConversationId() === 'POLISHNEW01');
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '');
  await p.evaluate(() => __xtjCloseAiChat());
  await p.evaluate(() => __xtjAiAgent.openConversation('POLISH01', 'normal'));
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '');
  assert.deepEqual(f.errors, []);
});
test('new conversations discard the previous request context usage immediately', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.locator('#aiChatMsgInput').fill('检查一次真实的容量更新');
  await p.locator('#aiChatSendBtn').click(); await p.waitForFunction(() => aiPolish.streams.length === 1);
  await p.evaluate(() => {
    aiPolishEmit({ type: 'meta', conversation_id: 'POLISH01', context_budget: { estimated_tokens: 32000, window_tokens: 65536, preview: false } });
    aiPolishEmit({ type: 'done', content: '已完成容量更新。', complete: true, saved: true, conversation_id: 'POLISH01' });
  });
  await p.waitForFunction(() => document.querySelector('#aiChatPauseBtn').style.display === 'none');
  await p.locator('.ai-chat-new-btn').click(); await p.waitForFunction(() => __xtjAiAgent.getConversationId() === 'POLISHNEW01');
  assert.match(await p.locator('.ai-context-trigger').textContent(), /待服务端估算/);
  assert.deepEqual(f.errors, []);
});
test('sending while a replacement attachment is reading cannot send the previous file or discard the selected original', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.locator('#aiChatFileInp').setInputFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('旧文件') });
  await p.locator('#aiChatFilePreview .ai-file-info').waitFor();
  await delayFile(p, 'replacement.txt');
  const original = Buffer.from('这份新文件的原始字节必须完整保留。');
  await p.locator('#aiChatFileInp').setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: original });
  await p.locator('#aiChatMsgInput').fill('请读取新选择的文件');
  await p.locator('#aiChatSendBtn').click();
  assert.equal(await p.evaluate(() => aiPolish.streams.length), 0);
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '请读取新选择的文件');
  await p.evaluate(() => releaseRepairFile());
  await p.waitForFunction(() => document.querySelector('#aiChatFilePreview').textContent.includes('replacement.txt'));
  await p.locator('#aiChatSendBtn').click();
  await p.waitForFunction(() => aiPolish.streams.length === 1);
  const files = await p.evaluate(() => aiPolish.streams[0].body.attachments);
  assert.equal(files.length, 1); assert.equal(files[0].name, 'replacement.txt');
  assert.equal(files[0].data_url, 'data:text/plain;base64,' + original.toString('base64'));
  assert.deepEqual(f.errors, []);
});
test('a pending current-conversation deletion blocks a new send and duplicate deletion', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    const previous = fetch; window.confirm = () => true; window.xtjConfirm = () => Promise.resolve(true); window.repairDeletes = 0;
    window.fetch = (url, options) => {
      if (!new URL(url, location.href).pathname.endsWith('/chat/delete')) return previous(url, options);
      repairDeletes++;
      return new Promise(resolve => window.releaseRepairDelete = () => resolve(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })));
    };
  });
  await p.locator('.ai-chat-hist-btn').click();
  await p.locator('[data-conv-id="POLISH01"] .ai-conv-del').click();
  await p.waitForFunction(() => typeof releaseRepairDelete === 'function');
  await p.locator('.ai-conv-page-close').click({ timeout: 2000 });
  await p.locator('#aiChatMsgInput').fill('删除尚未确认时的新提问');
  await p.locator('#aiChatSendBtn').click();
  assert.equal(await p.evaluate(() => aiPolish.streams.length), 0);
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '删除尚未确认时的新提问');
  await p.locator('.ai-chat-more-btn').click(); await p.locator('.ai-chat-del-btn').click();
  assert.equal(await p.evaluate(() => repairDeletes), 1);
  await p.evaluate(() => releaseRepairDelete());
  await p.waitForFunction(() => __xtjAiAgent.getConversationId() === null);
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '');
  assert.deepEqual(f.errors, []);
});
test('research waits for all selected files before accepting a send', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => __xtjAiAgent.openDeepThink()); await p.locator('#dtInput').waitFor();
  await delayFile(p, 'second.txt');
  await p.locator('#dtFileInp').setInputFiles([{ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('第一份资料') }, { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('第二份资料') }]);
  await p.waitForFunction(() => typeof releaseRepairFile === 'function');
  await p.locator('#dtInput').fill('逐份核对这两份资料');
  await p.locator('#dtSendBtn').click();
  assert.equal(await p.evaluate(() => aiPolish.streams.length), 0);
  await p.evaluate(() => releaseRepairFile());
  await p.waitForFunction(() => document.querySelectorAll('#dtFilePreview .ai-file-chip').length === 2);
  await p.locator('#dtSendBtn').click(); await p.waitForFunction(() => aiPolish.streams.length === 1);
  assert.deepEqual(await p.evaluate(() => aiPolish.streams[0].body.attachments.map(file => file.name)), ['first.txt', 'second.txt']);
  assert.deepEqual(f.errors, []);
});
test('automatic new-conversation creation after deleting the current chat keeps sends pending until its ID is ready', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    const previous = fetch; window.confirm = () => true; window.xtjConfirm = () => Promise.resolve(true);
    window.fetch = (url, options) => {
      if (!new URL(url, location.href).pathname.endsWith('/chat/new')) return previous(url, options);
      return new Promise(resolve => window.releaseRepairNew = () => resolve(new Response('{"ok":true,"conversation_id":"AFTERDELETE01"}', { headers: { 'Content-Type': 'application/json' } })));
    };
  });
  await p.locator('.ai-chat-more-btn').click(); await p.locator('.ai-chat-del-btn').click(); await p.waitForFunction(() => typeof releaseRepairNew === 'function');
  await p.locator('#aiChatMsgInput').fill('给删除后新会话的提问'); await p.locator('#aiChatSendBtn').click();
  assert.equal(await p.evaluate(() => aiPolish.streams.length), 0);
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '给删除后新会话的提问');
  await p.evaluate(() => releaseRepairNew()); await p.waitForFunction(() => __xtjAiAgent.getConversationId() === 'AFTERDELETE01');
  await p.locator('#aiChatSendBtn').click(); await p.waitForFunction(() => aiPolish.streams.length === 1);
  assert.equal(await p.evaluate(() => aiPolish.streams[0].body.conversation_id), 'AFTERDELETE01');
  assert.deepEqual(f.errors, []);
});
test('attachment names and research settings remain readable in light and dark themes', { timeout: 60000 }, async () => {
  for (const theme of ['light', 'dark']) {
    const f = await aiPolishFixture({ theme });
    try {
      const p = f.page;
      await p.locator('#aiChatFileInp').setInputFiles({ name: '普通对话资料.txt', mimeType: 'text/plain', buffer: Buffer.from('原始资料') });
      await p.locator('#aiChatFilePreview .ai-file-info').waitFor();
      await p.evaluate(() => __xtjAiAgent.openDeepThink());
      await p.locator('#dtFileInp').setInputFiles({ name: '研究对照资料.txt', mimeType: 'text/plain', buffer: Buffer.from('研究实际段落') });
      await p.locator('#dtFilePreview .ai-file-info').waitFor();
      const ratios = await p.evaluate(() => {
        function color(value) { return (value.match(/[\d.]+/g) || []).map(Number); }
        function over(fg, bg) { const alpha = fg.length > 3 ? fg[3] : 1; return [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha)); }
        function background(node) { const chain = []; for (let n = node; n; n = n.parentElement) chain.unshift(n); return chain.reduce((c, n) => over(color(getComputedStyle(n).backgroundColor), c), [255, 255, 255]); }
        function luminance(c) { const a = c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; }
        return Array.from(document.querySelectorAll('.ai-file-info,.dt-research-mode-hint,.dt-research-model-hint,.dt-research-mode-bar>span,.dt-research-model-bar>span,.dt-research-mode-opt')).flatMap(n => {
          const style = getComputedStyle(n), bg = background(n), stops = style.backgroundImage.match(/rgba?\([^)]+\)/g), backgrounds = stops ? stops.map(stop => over(color(stop), bg)) : [bg];
          return backgrounds.map(background => { const fg = over(color(style.color), background), a = luminance(fg), b = luminance(background); return { text: n.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; });
        });
      });
      assert.ok(ratios.length >= 9);
      for (const item of ratios) assert.ok(item.ratio >= 4.5, JSON.stringify({ theme, ...item }));
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});
test('a successful deletion followed by failed creation reports the actual state and allows creating again', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => {
    const previous = fetch; window.confirm = () => true; window.xtjConfirm = () => Promise.resolve(true); window.repairNewAttempts = 0;
    window.fetch = (url, options) => {
      if (new URL(url, location.href).pathname.endsWith('/chat/new') && ++repairNewAttempts === 1) return Promise.resolve(new Response('{"ok":false,"error":"isolated creation failure","retryable":false}', { status: 400, headers: { 'Content-Type': 'application/json' } }));
      return previous(url, options);
    };
  });
  await p.locator('.ai-chat-more-btn').click(); await p.locator('.ai-chat-del-btn').click();
  await p.waitForFunction(() => document.body.textContent.includes('对话已删除，新对话创建失败'));
  assert.equal(await p.evaluate(() => __xtjAiAgent.getConversationId()), null);
  await p.locator('.ai-chat-new-btn').click();
  await p.waitForFunction(() => __xtjAiAgent.getConversationId() === 'POLISHNEW01');
  assert.deepEqual(f.errors, []);
});
