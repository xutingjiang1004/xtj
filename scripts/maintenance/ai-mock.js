'use strict';
// Mocks the small-cat AI backend inside a harness page so streaming, the thinking timeline, history and the plus panel
// can be driven without a server.
//
//   const { open } = require('./harness');
//   const ai = require('./ai-mock');
//   const s = await open({ viewport: { width: 390, height: 844 } });
//   await ai.wire(s.page);
//   await ai.openChat(s.page);
//   await ai.send(s.page, '帮我查一下杭州周边的徒步路线');
//   await ai.emit(s.page, { type: 'reasoning_start' });
//   await ai.emit(s.page, { type: 'reasoning', text: '先想一想路线的难度。' });
//   await ai.emit(s.page, { type: 'content', text: '我先查一下热门路线。' });          // narration before a tool call
//   await ai.emit(s.page, { type: 'tool_calls', tools: [{ id: 't1', call_id: 't1', name: 'search_web', tool_name: 'search_web', arguments: { query: '杭州 徒步' } }] });
//   await ai.emit(s.page, { type: 'tool_result', call_id: 't1', tool_name: 'search_web', success: true, count: 3, summary: '找到 3 条结果' });
//   await ai.emit(s.page, { type: 'content', text: '推荐九溪十八涧。' });
//   await ai.emit(s.page, { type: 'done' });
//
// Event shapes that matter: reasoning_start, reasoning{text}, content{text}, tool_calls{tools}, tool_progress, search,
// tool_result{call_id, tool_name, success, count, summary} (success:true is required or the step is shown as failed),
// done{content?, reasoning?, thinking_mode?, complete?, saved?}.

async function wire(page, options = {}) {
  await page.evaluate((opts) => {
    const base = window.fetch;
    window.aiMock = { streams: [], calls: [], times: [] };
    window.fetch = async (url, init = {}) => {
      const u = new URL(url, location.href), path = u.pathname;
      if (!path.startsWith('/api/agent/')) return base(url, init);
      let body = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (_) { /* not JSON */ }
      window.aiMock.calls.push(path);
      window.aiMock.times.push([path, performance.now()]);
      const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
      if (path.endsWith('/config')) return json({ ok: true, config: { enabled: true, name: '小猫', deep_think: { enabled: true }, tavily_research: { enabled: true }, allow_web_search: true } });
      if (path.endsWith('/quota')) return json({ ok: true, quota: { can_chat: true, can_search: true, tokens_used: 1200, tokens_limit: 100000, tokens_remaining: 98800, search_used: 1, search_limit: 10, search_remaining: 9, is_pro: false } });
      if (path.endsWith('/custom-models')) return json({ ok: true, models: [] });
      if (path.endsWith('/chat/history')) return json({ ok: true, conversation_id: 'C1', messages: window.mockAiHistory || opts.history || [], has_more: false });
      if (path.endsWith('/chat/conversations')) return json({ ok: true, conversations: opts.conversations || [{ conversation_id: 'C1', title: '周末去哪里玩', preview: '推荐几个杭州周边的徒步路线', message_count: 4, updated_at: new Date(Date.now() - 3600e3).toISOString() }], has_more: false });
      if (path.endsWith('/research/history')) return json({ ok: true, items: [], has_more: false });
      if (path.endsWith('/stream') || path.endsWith('/chat/stream')) {
        const st = { body, controller: null };
        window.aiMock.streams.push(st);
        return new Response(new ReadableStream({ start(c) { st.controller = c; } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return json({ ok: true });
    };
    window.emit = (e) => window.aiMock.streams.at(-1).controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(e) + '\n\n'));
  }, options);
}

async function emit(page, event) {
  await page.evaluate((e) => window.emit(e), event);
}

async function openChat(page) {
  await page.evaluate(() => window.__xtjOpenAiChat());
  await page.waitForSelector('#aiChatMsgInput', { timeout: 8000 });
  await page.waitForTimeout(700);
}

// Types the message and presses send; resolves once the mocked stream request exists.
async function send(page, text) {
  await page.fill('#aiChatMsgInput', text);
  await page.click('#aiChatSendBtn');
  await page.waitForFunction(() => window.aiMock.streams.length > 0);
}

module.exports = { wire, emit, openChat, send };
