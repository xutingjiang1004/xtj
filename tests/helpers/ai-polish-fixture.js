'use strict';
const { postBrowserFixture } = require('./post-browser-fixture');
async function aiPolishFixture(options = {}) {
  const f = await postBrowserFixture({ counts: [1], publicPosts: true, ...options });
  try {
  await f.page.evaluate(options => {
    const base = fetch;
    window.aiPolish = { historyTitles:{}, calls: [], streams: [], models: options.models || [], serverModels:options.serverModels || [], modelWriteStatus: options.modelWriteStatus || 200, checkpoints:options.checkpoints || [], capabilityResults:options.capabilityResults || [] };
    window.fetch = async (url, opts = {}) => {
      const u = new URL(url, location.href), path = u.pathname;
      if (!path.startsWith('/api/agent/')) return base(url, opts);
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
      aiPolish.calls.push({ path, method: opts.method || 'GET', body });
      const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
      if (path.endsWith('/config')) return json({ ok: true, config: Object.assign({ enabled: true, name: '小猫', deep_think: { enabled: true }, tavily_research: { enabled: true } },options.config || {}) });
      if (path.endsWith('/quota')) return json({ ok: true, quota: Object.assign({ can_chat: true, can_search: true, tokens_used: 0, tokens_limit: 100000, tokens_remaining: 100000, search_used: 0, search_limit: 10, search_remaining: 10, is_pro: false },options.quota || {}) });
      if (path.endsWith('/custom-models')) {
        if (opts.method === 'PUT') {
          if (aiPolish.modelWriteStatus !== 200) return json({ ok: false, error: 'Isolated save failure' }, aiPolish.modelWriteStatus);
          aiPolish.models = body.models || aiPolish.models;
        }
        return json({ ok: true, models: aiPolish.models.map(model=>{const copy={...model,key_configured:!!(model.api_key||model.key_configured),stored_reference:true,config_revision:'isolated-config-revision'};delete copy.api_key;delete copy.api_key_enc;return copy;}), server_models:aiPolish.serverModels, deleted_uids: [], ai_prefs: {} });
      }
      if(path.endsWith('/chat/metadata/read'))return json({ok:true,records:(body.conversation_ids||[]).map(cid=>aiPolish.historyTitles[cid]).filter(Boolean)});
      if(path.endsWith('/chat/metadata')){const old=aiPolish.historyTitles[body.conversation_id]||{revision:0};const record={conversation_id:body.conversation_id,title:body.title,revision:old.revision+1};aiPolish.historyTitles[body.conversation_id]=record;return json({ok:true,record});}
      if (path.endsWith('/chat/history')) return json({ ok: true, conversation_id: u.searchParams.get('conversation_id') || 'POLISH01', messages: options.history || [], has_more: false });
      if (path.endsWith('/chat/conversations')) return json({ ok: true, conversations: [{ conversation_id: 'POLISH01', title: '本地测试对话', preview: '模拟历史内容', message_count: 4, updated_at: '2026-10-13T08:00:00Z' }], has_more: false });
      if (path.endsWith('/research/history')) return json({ ok: true, items: [], has_more: false });
      if (path.endsWith('/research/checkpoints')) return json({ok:true,records:aiPolish.checkpoints});
      if (path.includes('/research/checkpoints/') && opts.method === 'DELETE') { aiPolish.checkpoints = aiPolish.checkpoints.filter(row => row.id !== path.split('/').at(-1)); return json({ok:true}); }
      if (path.endsWith('/models/check')) { if (aiPolish.waitCapability) await new Promise(resolve => aiPolish.releaseCapability = resolve); return json({ok:true,results:aiPolish.capabilityResults}); }
      if (path.endsWith('/chat/new')) return json({ ok: true, conversation_id: 'POLISHNEW01' });
      if (path.endsWith('/stream') || path.endsWith('/deep-stream') || (path.endsWith('/chat') && body && body.deep_think)) {
        const stream = { path, body, signal: opts.signal, cancelled: false };
        aiPolish.streams.push(stream);
        return new Response(new ReadableStream({ start(c) { stream.controller = c; }, cancel() { stream.cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return json({ ok: true });
    };
    window.aiPolishEmit = event => aiPolish.streams.at(-1).controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'));
  }, options);
  await f.page.evaluate(() => __xtjOpenAiChat());
  await f.page.waitForSelector('#aiChatMsgInput');
  await f.page.waitForFunction(() => aiPolish.calls.some(x => x.path.endsWith('/chat/history')) && document.activeElement.id === 'aiChatMsgInput');
  return f;
  }catch(error){error.message+='\nAI fixture browser errors: '+JSON.stringify(f.errors);await f.close();throw error;}
}
async function openModelPicker(page) {
  await page.locator('.ai-plus-btn').click();
  await page.locator('[data-action="open-model"]').click();
}
function models(count) {
  return Array.from({ length: count }, (_, i) => ({ uid: 'polish' + i, provider: 'qwen', providerLabel: '千问 Qwen', label: '本地模型' + i, api_key: 'isolated-only-key', model: 'qwen-plus', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }));
}
module.exports = { aiPolishFixture, openModelPicker, models };
