'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture, wireAiChat } = require('./helpers/post-browser-fixture');

async function fixture(t) {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true });
  t.after(() => f.close());
  await wireAiChat(f.page);
  await f.page.waitForFunction(() => !document.querySelector('#aiChatRoot .ai-history-loading'));
  return f;
}
async function attach(page, id, name, buffer, mimeType = 'image/png') {
  await page.locator(id).setInputFiles({ name, mimeType, buffer });
  const preview = id === '#dtFileInp' ? '#dtFilePreview' : '#aiChatFilePreview';
  await page.waitForFunction(({ preview, name }) => document.querySelector(preview).textContent.includes(name), { preview, name });
}
async function deepFixture(t) {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const base = fetch;
    window.deepBodies = []; window.deepAborts = 0;
    window.fetch = (url, options = {}) => {
      const p = new URL(url, location.href);
      if (p.pathname === '/api/agent/chat/history' && p.searchParams.get('mode') === 'deep_think') return Promise.resolve(new Response(JSON.stringify({ ok: true, conversation_id: p.searchParams.get('conversation_id'), messages: [{ id: 'old-report', role: 'assistant', content: 'OLD AUTHORIZED REPORT', created_at: '2026-10-12T08:00:00Z' }], has_more: false }), { headers: { 'Content-Type': 'application/json' } }));
      if (p.pathname === '/api/agent/chat' && options.method === 'POST') {
        deepBodies.push(JSON.parse(options.body));
        return Promise.resolve(new Response(new ReadableStream({ start(c) { window.deepFollowupStream = c; options.signal.addEventListener('abort', () => { deepAborts++; try { c.error(new DOMException('Aborted', 'AbortError')); } catch (_) {} }, { once: true }); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return base(url, options);
    };
    return __xtjAiAgent.openConversation('FOLLOWUP1', 'deep_think');
  });
  return f;
}

test('rejecting an oversized text preserves its selected original attachment', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  await attach(f.page, '#aiChatFileInp', 'keep.png', f.png);
  await f.page.locator('#aiChatMsgInput').fill('x'.repeat(50001));
  await f.page.locator('#aiChatSendBtn').click();
  assert.match(await f.page.locator('#aiChatFilePreview').textContent(), /keep.png/);
  assert.equal((await f.page.locator('#aiChatMsgInput').inputValue()).length, 50001);
  assert.deepEqual(f.errors, []);
});

test('a failed older send cannot replace the next attachment-only draft', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const base = fetch;
    window.fetch = (url, options) => new URL(url, location.href).pathname === '/api/agent/chat/stream'
      ? new Promise(resolve => { window.rejectOldSend = resolve; }) : base(url, options);
  });
  await attach(f.page, '#aiChatFileInp', 'old.png', f.png);
  await f.page.locator('#aiChatMsgInput').fill('OLD QUESTION');
  await f.page.locator('#aiChatSendBtn').click();
  await f.page.waitForFunction(() => typeof rejectOldSend === 'function');
  await attach(f.page, '#aiChatFileInp', 'next.png', f.png);
  await f.page.evaluate(() => rejectOldSend(new Response(JSON.stringify({ error: 'Synthetic validation error', retryable: false }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
  await f.page.waitForFunction(() => document.getElementById('aiChatPauseBtn').style.display === 'none');
  assert.equal(await f.page.locator('#aiChatMsgInput').inputValue(), '');
  assert.match(await f.page.locator('#aiChatFilePreview').textContent(), /next.png/);
  assert.deepEqual(f.errors, []);
});

test('one unreadable file does not stop a multi-file selection or lose readable originals', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const OriginalReader = FileReader;
    window.readFailures = 0;
    window.FileReader = class extends OriginalReader {
      readAsDataURL(file) {
        if (file.name === 'unreadable.png') { queueMicrotask(() => { readFailures++; this.onerror?.({ target: this }); }); return; }
        super.readAsDataURL(file);
      }
    };
  });
  await f.page.locator('#aiChatFileInp').setInputFiles(['one.png', 'unreadable.png', 'three.png'].map(name => ({ name, mimeType: 'image/png', buffer: Buffer.concat([f.png,Buffer.alloc(4096-f.png.length)]) })));
  await f.page.waitForFunction(() => readFailures === 1);
  await f.page.waitForFunction(() => document.getElementById('aiChatFilePreview').textContent.includes('2 个文件'), null, { timeout: 1500 });
  assert.match(await f.page.locator('#aiChatFilePreview').textContent(), /约 8KB/);
  await f.page.evaluate(() => {
    const base = fetch;
    window.fetch = (url, options) => {
      if (new URL(url, location.href).pathname === '/api/agent/chat/stream') window.readableSend = JSON.parse(options.body);
      return base(url, options);
    };
  });
  await f.page.locator('#aiChatSendBtn').click();
  await f.page.waitForFunction(() => !!window.readableSend);
  assert.deepEqual(await f.page.evaluate(() => readableSend.attachments.map(a => a.name)), ['one.png', 'three.png']);
  assert.deepEqual(f.errors, []);
});

test('research sends a supported PDF above the text limit without counting base64 as text', { timeout: 45000 }, async t => {
  const f = await deepFixture(t);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100000, 32)]);
  await attach(f.page, '#dtFileInp', 'research.pdf', pdf, 'application/pdf');
  await f.page.locator('#dtInput').fill('READ THE PDF');
  await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 1, null, { timeout: 1500 });
  const body = await f.page.evaluate(() => deepBodies[0]);
  assert.equal(body.attachments[0].data_url, 'data:application/pdf;base64,' + pdf.toString('base64'));
  assert.match(body.message, /READ THE PDF/);
  assert.deepEqual(f.errors, []);
});

test('native re-research uses the normal lifecycle, streams visibly and can be paused without losing the next draft', { timeout: 45000 }, async t => {
  const f = await deepFixture(t);
  await f.page.evaluate(async () => {
    await __xtjCloseAiChat();
    const base = fetch;
    window.nativeBodies = []; window.nativeStops = 0;
    window.fetch = (url, options = {}) => {
      const p = new URL(url, location.href);
      if (p.pathname === '/api/agent/config') return Promise.resolve(new Response(JSON.stringify({ ok: true, config: { enabled: true, name: '小猫', deep_think: { enabled: true }, tavily_research: { enabled: true } } }), { headers: { 'Content-Type': 'application/json' } }));
      if (p.pathname === '/api/agent/research/stream') {
        nativeBodies.push(JSON.parse(options.body));
        return Promise.resolve(new Response(new ReadableStream({ start(c) { window.nativeResearchStream = c; options.signal.addEventListener('abort', () => { nativeStops++; try { c.error(new DOMException('Aborted', 'AbortError')); } catch (_) {} }, { once: true }); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return base(url, options);
    };
    await __xtjOpenAiChat();
  });
  await f.page.waitForFunction(() => __xtjAiAgent.getConfig()?.tavily_research?.enabled === true);
  await f.page.evaluate(() => __xtjAiAgent.openConversation('NATIVE11', 'deep_think'));
  await f.page.locator('#dtInput').fill('INITIAL NATIVE RESEARCH'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => nativeBodies.length === 1);
  await f.page.evaluate(() => { nativeResearchStream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'research_done', answer: 'FIRST COMPLETE REPORT', sources: [], saved: true, conversation_id: 'NATIVE11' }) + '\n\n')); nativeResearchStream.close(); });
  await f.page.waitForFunction(() => document.querySelector('.ai-msg-refresh-research') && document.getElementById('dtPauseBtn').style.display === 'none');
  await f.page.locator('#dtInput').fill('NEXT NATIVE DRAFT');
  await f.page.locator('.ai-msg-refresh-research').click();
  await f.page.waitForFunction(() => nativeBodies.length === 2);
  assert.equal(await f.page.evaluate(() => nativeBodies[1].refresh), true);
  await f.page.evaluate(() => nativeResearchStream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'research_content', content: 'REFRESHED LIVE REPORT' }) + '\n\n')));
  await f.page.waitForFunction(() => document.getElementById('dtMessages').textContent.includes('REFRESHED LIVE REPORT'), null, { timeout: 1500 });
  await f.page.locator('#dtPauseBtn').click();
  await f.page.waitForFunction(() => nativeStops > 0);
  assert.equal(await f.page.locator('#dtInput').inputValue(), 'NEXT NATIVE DRAFT');
  assert.match(await f.page.locator('#dtMessages').textContent(), /FIRST COMPLETE REPORT/);
  assert.match(await f.page.locator('#dtMessages').textContent(), /REFRESHED LIVE REPORT/);
  await f.page.locator('#dtInput').fill('INCOMPLETE NATIVE RESEARCH'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => nativeBodies.length === 3);
  await f.page.evaluate(() => { nativeResearchStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'research_content',content:'INCOMPLETE BUT REAL REPORT'})+'\n\n')); nativeResearchStream.close(); });
  await f.page.waitForFunction(() => document.getElementById('dtPauseBtn').style.display === 'none');
  assert.match(await f.page.locator('#dtMessages').textContent(), /INCOMPLETE BUT REAL REPORT/);
  assert.equal(await f.page.evaluate(() => deepBodies.length), 0, 'partial native output must not start a second fallback research');
  assert.deepEqual(f.errors, []);
});

test('research history exposes older pages and keeps the next draft while paging', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const base = fetch;
    window.olderResearchReads = 0;
    window.fetch = (url, options) => {
      const p = new URL(url, location.href);
      if (p.pathname === '/api/agent/chat/history' && p.searchParams.get('mode') === 'deep_think') {
        const older = !!p.searchParams.get('before'); if (older) olderResearchReads++;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, conversation_id: 'PAGED111', messages: [{ id: older ? 'old' : 'latest', role: 'assistant', content: older ? 'OLDER RESEARCH REPORT' : 'LATEST RESEARCH REPORT', created_at: older ? '2026-10-11T08:00:00Z' : '2026-10-12T08:00:00Z' }], has_more: !older, next_cursor: !older ? JSON.stringify({ at: '2026-10-12T08:00:00Z', id: '11111111-1111-4111-8111-111111111111' }) : null }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return base(url, options);
    };
    return __xtjAiAgent.openConversation('PAGED111', 'deep_think');
  });
  await f.page.locator('#dtInput').fill('KEEP RESEARCH DRAFT');
  await f.page.getByRole('button', { name: '加载更早的研究记录', exact: true }).click({ timeout: 1500 });
  await f.page.waitForFunction(() => olderResearchReads === 1);
  await f.page.waitForFunction(() => document.getElementById('dtMessages').textContent.includes('OLDER RESEARCH REPORT'));
  assert.match(await f.page.locator('#dtMessages').textContent(), /OLDER RESEARCH REPORT/);
  assert.match(await f.page.locator('#dtMessages').textContent(), /LATEST RESEARCH REPORT/);
  assert.equal(await f.page.locator('#dtInput').inputValue(), 'KEEP RESEARCH DRAFT');
  assert.deepEqual(f.errors, []);
});

test('research model preference belongs to the logged-in account and updates an already-built selector', { timeout: 45000 }, async t => {
  const f = await deepFixture(t);
  await f.page.locator('.dt-research-model-select').selectOption('flash');
  assert.equal(await f.page.evaluate(() => localStorage.getItem('xtj_ai_research_model__alice')), 'flash');
  await f.page.evaluate(() => doLogout());
  for (const path of ['login', 'refresh']) await f.page.route('**/api/user/' + path, r => r.fulfill({ json: { ok: true, user_name: 'bob', token: 'bob-fixture-token' } }));
  await f.page.evaluate(async () => {
    const base = fetch;
    window.fetch = (url, options = {}) => {
      if (new URL(url, location.href).pathname === '/api/agent/custom-models' && options.method === 'GET') return Promise.resolve(new Response(JSON.stringify({ ok: true, models: [], ai_prefs: { research_model: 'pro' } }), { headers: { 'Content-Type': 'application/json' } }));
      return base(url, options);
    };
    document.getElementById('loginNickInp').value = 'bob'; document.getElementById('loginPwInp').value = 'test-only-password'; await doLogin();
    await __xtjOpenAiChat();
  });
  await f.page.evaluate(() => __xtjAiAgent.openConversation('BOBRESEARCH', 'deep_think'));
  assert.equal(await f.page.locator('.dt-research-model-select').inputValue(), 'pro');
  await f.page.waitForFunction(() => localStorage.getItem('xtj_ai_research_model__bob') === 'pro');
  assert.deepEqual(f.errors, []);
});

test('research authentication completing later preserves a new text and attachment draft', { timeout: 45000 }, async t => {
  const f = await deepFixture(t);
  await f.page.evaluate(() => { const ready = new Promise(resolve => { window.releaseDeepAuth = resolve; }); window.ensureProtectedOperationAuth = () => ready; });
  await f.page.locator('#dtInput').fill('OLD RESEARCH');
  await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => typeof releaseDeepAuth === 'function');
  await f.page.locator('#dtInput').fill('NEXT RESEARCH DRAFT');
  await attach(f.page, '#dtFileInp', 'next-research.png', f.png);
  await f.page.evaluate(() => releaseDeepAuth({ ok: true, token: 'test-only-token' }));
  await f.page.waitForFunction(() => deepBodies.length === 1);
  assert.equal(await f.page.locator('#dtInput').inputValue(), 'NEXT RESEARCH DRAFT');
  assert.match(await f.page.locator('#dtFilePreview').textContent(), /next-research.png/);
  assert.match(await f.page.evaluate(() => deepBodies[0].message), /OLD RESEARCH/);
  assert.deepEqual(f.errors, []);
});

test('research pause aborts its own stream and a distinct next send replaces it without losing partial content', { timeout: 45000 }, async t => {
  const f = await deepFixture(t);
  await f.page.locator('#dtInput').fill('FIRST RESEARCH'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 1);
  await f.page.evaluate(() => deepFollowupStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'answer_chunk',chunk:'FIRST PARTIAL ANSWER'})+'\n\n')));
  await f.page.waitForFunction(() => document.getElementById('dtMessages').textContent.includes('FIRST PARTIAL ANSWER'));
  await f.page.locator('#dtInput').fill('NEXT RESEARCH'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 2 && deepAborts === 1);
  await f.page.locator('#dtPauseBtn').click(); await f.page.waitForFunction(() => deepAborts === 2);
  assert.match(await f.page.locator('#dtMessages').textContent(), /FIRST PARTIAL ANSWER/);
  await f.page.locator('#dtInput').fill('THIRD RESEARCH'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 3); assert.deepEqual(f.errors, []);
});

test('research ignores IME candidate Enter and accepts the confirmed message once', { timeout: 45000 }, async t => {
  const f = await deepFixture(t); await f.page.locator('#dtInput').fill('确认后的中文');
  await f.page.evaluate(async () => { const input = document.getElementById('dtInput');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true}));
    input.dispatchEvent(new CompositionEvent('compositionend'));
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  assert.equal(await f.page.evaluate(() => deepBodies.length), 0);
  await f.page.locator('#dtInput').press('Enter'); await f.page.waitForFunction(() => deepBodies.length === 1);
  assert.equal(await f.page.evaluate(() => deepBodies[0].message),'确认后的中文'); assert.deepEqual(f.errors, []);
});

test('research transport failing before headers leaves a usable retry and releases its send lock', { timeout: 45000 }, async t => {
  const f = await deepFixture(t);
  await f.page.evaluate(() => { const base = fetch; let failed = false; window.fetch = (url, options) => {
    if (!failed && new URL(url,location.href).pathname === '/api/agent/chat') { failed = true; return Promise.reject(new Error('Synthetic header failure')); }
    return base(url,options);
  }; });
  await f.page.locator('#dtInput').fill('FIRST FAILED TRANSPORT'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => document.querySelector('#dtMessages .ai-research-interrupted') && document.getElementById('dtPauseBtn').style.display === 'none');
  await f.page.locator('#dtInput').fill('NEXT VALID RESEARCH'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 1);
  assert.match(await f.page.evaluate(() => deepBodies[0].message), /NEXT VALID RESEARCH/); assert.deepEqual(f.errors, []);
});

test('an unsaved research answer is explicit and retains the original file for retry', { timeout: 45000 }, async t => {
  const f = await deepFixture(t); const pdf = Buffer.from('%PDF-1.4\nTest-only content');
  await attach(f.page,'#dtFileInp','unsaved.pdf',pdf,'application/pdf');
  await f.page.locator('#dtInput').fill('KEEP MY RESEARCH FILE'); await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 1);
  await f.page.evaluate(() => { deepFollowupStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'done',content:'ACTUAL UNSAVED ANSWER',saved:false})+'\n\n')); deepFollowupStream.close(); });
  await f.page.waitForFunction(() => document.getElementById('dtPauseBtn').style.display === 'none');
  assert.match(await f.page.locator('#dtMessages').textContent(), /ACTUAL UNSAVED ANSWER/);
  assert.match(await f.page.locator('#dtMessages').textContent(), /聊天记录未保存/);
  assert.match(await f.page.locator('#dtFilePreview').textContent(), /unsaved.pdf/); assert.deepEqual(f.errors, []);
});

test('research holds a draft while its initial history is loading and then sends in that conversation', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const base = fetch;
    window.deepBodies = [];
    window.fetch = (url, options = {}) => {
      const p = new URL(url, location.href);
      if (p.pathname === '/api/agent/chat/history' && p.searchParams.get('mode') === 'deep_think') return new Promise(resolve => { window.releaseDeepHistory = resolve; });
      if (p.pathname === '/api/agent/chat') { deepBodies.push(JSON.parse(options.body)); return Promise.resolve(new Response(new ReadableStream({ start(c) { window.deepFollowupStream = c; } }), { headers: { 'Content-Type': 'text/event-stream' } })); }
      return base(url, options);
    };
    void __xtjAiAgent.openConversation('LOADING1', 'deep_think');
  });
  await f.page.waitForFunction(() => typeof releaseDeepHistory === 'function');
  await f.page.locator('#dtInput').fill('SEND AFTER HISTORY');
  await f.page.locator('#dtSendBtn').click();
  assert.equal(await f.page.evaluate(() => deepBodies.length), 0);
  assert.equal(await f.page.locator('#dtInput').inputValue(), 'SEND AFTER HISTORY');
  await f.page.evaluate(() => releaseDeepHistory(new Response(JSON.stringify({ ok: true, conversation_id: 'LOADING1', messages: [{ id: 'old-report', role: 'assistant', content: 'OLD AUTHORIZED REPORT', created_at: '2026-10-12T08:00:00Z' }], has_more: false }), { headers: { 'Content-Type': 'application/json' } })));
  await f.page.waitForFunction(() => document.getElementById('dtMessages').textContent.includes('OLD AUTHORIZED REPORT'));
  await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(() => deepBodies.length === 1);
  assert.equal(await f.page.evaluate(() => deepBodies[0].conversation_id), 'LOADING1');
  assert.deepEqual(f.errors, []);
});
