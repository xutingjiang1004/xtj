const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

function sseResponse(chunks, delay) {
  delay = delay || 10;
  return new ReadableStream({
    start(controller) {
      let i = 0;
      const push = () => {
        if (i >= chunks.length) { controller.close(); return; }
        controller.enqueue(new TextEncoder().encode(chunks[i]));
        i++;
        setTimeout(push, delay);
      };
      push();
    }
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.addInitScript(() => {
    window.currentUser = 'check_user';
    window.ensureUserToken = async () => 'check-token';
    window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 'check-token' });
    window.ensureAiUserReady = async () => ({ ok: true });
    localStorage.setItem('xtj_user', 'check_user');
    localStorage.setItem('xtj_ai_thinking_mode', 'off');
  });

  // CSP 剥离兜底：注册在具体 mock 之前（Playwright 后注册优先，故放最前）
  await page.route('**/*', async r => {
    const url = r.request().url();
    if (/\/api\/agent\/(config|quota|chat\/history|chat\/conversations|profile|chat\/stream)/.test(url)) {
      return r.continue();
    }
    const resp = await r.fetch().catch(() => null);
    if (!resp) return r.abort();
    const headers = resp.headers();
    delete headers['content-security-policy'];
    return r.fulfill({ status: resp.status(), headers, body: await resp.body() });
  });

  // 具体 mock（后注册，优先匹配）
  await page.route('**/api/user/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'check-token', user: { user_name: 'check_user' } }) }));
  await page.route('**/api/agent/config', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { config: { name: '小猫', welcome_message: '嗨，来聊天吧。' } } }) }));
  await page.route('**/api/agent/quota', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { quota: { requests_used: 1, requests_limit: 50, tokens_used: 100, tokens_limit: 1000000, unlimited: true, can_chat: true, tokens_remaining: 999999 } } }) }));
  await page.route('**/api/agent/chat/history**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'conv-check', has_more: false, messages: [] }) }));
  await page.route('**/api/agent/chat/conversations**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: [] }) }));
  await page.route('**/api/agent/profile**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  let chatBodies = [];
  await page.route('**/api/agent/chat/stream', async r => {
    const body = r.request().postData();
    try { chatBodies.push(JSON.parse(body)); } catch (e) {}
    const reply = '这是一段用于验证流式渲染的测试回复内容，用于确认深度思考关闭时内容不会被清空。';
    // ★ Playwright route.fulfill 的 body 不支持 ReadableStream，使用完整 SSE 字符串
    const sseStr = [
      'data: ' + JSON.stringify({ type: 'meta', conversation_id: 'conv-check' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'content', text: reply.slice(0, 20) }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'content', text: reply.slice(20, 40) }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'content', text: reply.slice(40) }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'done', content: reply, model: 'deepseek-v4-flash', thinking_mode: 'off', usage: {} }) + '\n\n'
    ].join('');
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: sseStr });
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__xtjEnsureAiAgentLoaded === 'function', { timeout: 10000 }).catch(() => {});
  // ★ 页面加载完成后（core.js 已运行并覆盖了认证函数）再覆盖，避免真实 Supabase 认证在沙箱内卡住
  await page.evaluate(() => {
    window.ensureProtectedOperationAuth = async () => ({ ok: true, reason: 'ok', token: 'check-token', user_name: 'check_user' });
    window.ensureRealUserAuth = window.ensureProtectedOperationAuth;
    window.ensureUserToken = async () => 'check-token';
  });

  try {
    await page.locator('#aiToolsBtn').click();
    await page.locator('#aiToolsMenu [data-ai-tool="chat"]').click();
  } catch (e) {
    await page.evaluate(() => { if (window.__xtjOpenAiChat) window.__xtjOpenAiChat(); });
  }
  await page.waitForSelector('#aiChatRoot', { timeout: 8000 });
  report('AI面板打开', await page.locator('#aiChatRoot').isVisible());

  const modelOptions = await page.evaluate(() => {
    const sel = document.querySelector('#aiPlusModelSelect');
    if (!sel) return [];
    return Array.from(sel.options || []).map(o => o.value + '=' + o.textContent);
  });
  report('模型选择包含V4 Flash Vision', modelOptions.some(o => o.indexOf('deepseek-v4-flash-vision-exp') >= 0), 'options=' + JSON.stringify(modelOptions));

  await page.fill('#aiChatMsgInput', '你好，测试一下');
  await page.click('#aiChatSendBtn');
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('#aiChatMessagesArea .ai-msg, #aiChatMessagesArea .ai-chat-bubble');
    return msgs.length >= 2;
  }, { timeout: 10000 });

  const replyText = await page.evaluate(() => {
    const area = document.querySelector('#aiChatMessagesArea');
    return area ? area.textContent : '';
  });
  report('深度思考关闭时内容正常显示', replyText.indexOf('这是一段用于验证流式渲染') >= 0, 'replyLen=' + replyText.length);

  const lastBody = chatBodies[chatBodies.length - 1];
  report('请求体含thinking_mode=off', !!lastBody && lastBody.thinking_mode === 'off' && !!lastBody.message, lastBody ? JSON.stringify({ model: lastBody.model, thinking: lastBody.thinking_mode, msg: lastBody.message }) : 'none');

  const hasRegen = await page.evaluate(() => document.querySelectorAll('.ai-msg-act-regen').length > 0);
  report('回复底部有重新生成按钮', hasRegen);

  const regenBefore = chatBodies.length;
  await page.evaluate(() => {
    const btn = document.querySelector('.ai-msg-act-regen');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  report('点击重新生成触发新请求', chatBodies.length >= regenBefore + 1, 'bodies=' + chatBodies.length);

  // ★ 图片上传 → 视觉直传（多模态"图片连续追问"关键链路）
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const imgBefore = chatBodies.length;
  await page.setInputFiles('#aiChatFileInp', { name: 'test.png', mimeType: 'image/png', buffer: tinyPng });
  await page.waitForTimeout(300);
  const imgPreviewVisible = await page.evaluate(() => {
    const pv = document.querySelector('#aiChatFilePreview, #aiChatRoot .ai-chat-file-preview, #aiChatRoot .ai-file-preview, #aiChatRoot .ai-chat-preview');
    return pv ? pv.offsetParent !== null : false;
  });
  report('图片上传后预览出现', imgPreviewVisible);
  await page.fill('#aiChatMsgInput', '这张图里有什么？');
  await page.click('#aiChatSendBtn');
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('#aiChatMessagesArea .ai-msg');
    return msgs.length >= 4;
  }, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const imgBody = chatBodies[chatBodies.length - 1];
  const hasAttach = !!imgBody && Array.isArray(imgBody.attachments) && imgBody.attachments.length > 0
    && /^data:image\//.test(String(imgBody.attachments[0].data_url || ''));
  report('图片消息请求含attachments(data_url)', hasAttach && chatBodies.length >= imgBefore + 1, 'bodies=' + chatBodies.length + ' att=' + (imgBody && imgBody.attachments ? imgBody.attachments.length : 0));
  // 重新生成图片消息：附件应被复用
  const imgRegenBodyCount = chatBodies.length;
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.ai-msg-act-regen');
    const lastBtn = btns[btns.length - 1];
    if (lastBtn) lastBtn.click();
  });
  await page.waitForTimeout(400);
  const imgRegenBody = chatBodies[chatBodies.length - 1];
  report('图片消息重新生成复用附件', chatBodies.length >= imgRegenBodyCount + 1 && !!imgRegenBody
    && Array.isArray(imgRegenBody.attachments) && imgRegenBody.attachments.length > 0,
    'att=' + (imgRegenBody && imgRegenBody.attachments ? imgRegenBody.attachments.length : 0));

  const hasVoice = await page.evaluate(() => {
    return !!document.querySelector('#aiChatVoiceBtn, .ai-chat-voice');
  });
  report('语音输入按钮存在', hasVoice);

  let plusItems = [];
  try {
    await page.click('#aiPlusBtn').catch(() => {});
    await page.waitForTimeout(300);
    plusItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#aiChatRoot [class*="chip"], #aiChatRoot .ai-quick-chip, #aiChatRoot .ai-panel-row')).map(b => b.textContent.trim()).filter(t => t).slice(0, 12);
    });
    await page.keyboard.press('Escape').catch(() => {});
  } catch (e) {}
  report('+面板快捷指令可见', plusItems.length >= 3, 'items=' + JSON.stringify(plusItems));

  const aiErrors = pageErrors.filter(e => e.indexOf('HTTP 500') < 0 && e.indexOf('Supabase') < 0);
  report('无AI相关页面JS报错', aiErrors.length === 0, 'errors=' + JSON.stringify(aiErrors.slice(0, 3)));
  const aiConsole = consoleErrors.filter(e => e.indexOf('Supabase') < 0 && e.indexOf('loadProfileActivity') < 0 && e.indexOf('saveUserInfo') < 0 && e.indexOf('Failed to load resource') < 0 && e.indexOf('feed') < 0);
  report('无AI相关控制台错误', aiConsole.length === 0, 'errors=' + JSON.stringify(aiConsole.slice(0, 3)));

  await page.screenshot({ path: '/workspace/xtj-ai-check.png', fullPage: true }).catch(() => {});
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log('\n==== 汇总: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
  process.exit(failed.length ? 1 : 0);
})();
