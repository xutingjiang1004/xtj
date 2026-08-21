const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';

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
  const logs = [];
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('console', m => { logs.push('[' + m.type() + '] ' + m.text()); });

  await page.addInitScript(() => {
    window.currentUser = 'check_user';
    window.ensureUserToken = async () => 'check-token';
    window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 'check-token' });
    window.ensureAiUserReady = async () => ({ ok: true });
    localStorage.setItem('xtj_user', 'check_user');
    localStorage.setItem('xtj_ai_thinking_mode', 'off');
  });

  await page.route('**/*', async r => {
    const url = r.request().url();
    if (/\/api\/agent\/(config|quota|chat\/history|chat\/conversations|profile|chat\/stream)/.test(url)) return r.continue();
    const resp = await r.fetch().catch(() => null);
    if (!resp) return r.abort();
    const headers = resp.headers();
    delete headers['content-security-policy'];
    return r.fulfill({ status: resp.status(), headers, body: await resp.body() });
  });

  await page.route('**/api/user/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'check-token', user: { user_name: 'check_user' } }) }));
  await page.route('**/api/agent/config', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { config: { name: '小猫', welcome_message: '嗨，来聊天吧。' } } }) }));
  await page.route('**/api/agent/quota', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { quota: { requests_used: 1, requests_limit: 50, tokens_used: 100, tokens_limit: 1000000, unlimited: true, can_chat: true, tokens_remaining: 999999 } } }) }));
  await page.route('**/api/agent/chat/history**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'conv-check', has_more: false, messages: [] }) }));
  await page.route('**/api/agent/chat/conversations', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: [] }) }));
  await page.route('**/api/agent/profile**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  let chatBodies = [];
  await page.route('**/api/agent/chat/stream', async r => {
    const body = r.request().postData();
    try { chatBodies.push(JSON.parse(body)); } catch (e) {}
    const reply = '这是一段用于验证流式渲染的测试回复内容。';
    // ★ Playwright route.fulfill 的 body 不支持 ReadableStream，使用完整 SSE 字符串
    const sseStr = [
      'data: ' + JSON.stringify({ type: 'meta', conversation_id: 'conv-check' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'content', text: reply }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'done', content: reply, model: 'deepseek-v4-flash', thinking_mode: 'off', usage: {} }) + '\n\n'
    ].join('');
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: sseStr });
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => typeof window.__xtjEnsureAiAgentLoaded === 'function', { timeout: 10000 }).catch(() => {});

  // ★ 页面加载完成后（core.js 已运行）再覆盖认证函数，避免被真实实现覆盖
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
  await page.waitForTimeout(800);

  // 检查输入框状态
  const inputState = await page.evaluate(() => {
    const inp = document.querySelector('#aiChatMsgInput');
    const btn = document.querySelector('#aiChatSendBtn');
    const send = window.__xtjAiChatState ? 'S存在' : 'S不存在';
    return {
      hasInput: !!inp,
      hasBtn: !!btn,
      inputVisible: inp ? (inp.offsetParent !== null) : false,
      inputValue: inp ? inp.value : null,
      btnVisible: btn ? (btn.offsetParent !== null) : false,
      state: send
    };
  });
  console.log('[DIAG] inputState =', JSON.stringify(inputState));

  // 手动绑定点击监听
  await page.evaluate(() => {
    window.__sendClicks = 0;
    const btn = document.querySelector('#aiChatSendBtn');
    if (btn) {
      const orig = btn.click;
      btn.addEventListener('click', function(){ window.__sendClicks++; }, { capture: true });
    }
  });

  await page.fill('#aiChatMsgInput', '你好，测试一下');
  await page.click('#aiChatSendBtn');
  await page.waitForTimeout(4000);

  const afterSend = await page.evaluate(() => {
    const area = document.querySelector('#aiChatMessagesArea');
    const btn = document.querySelector('#aiChatSendBtn');
    const inp = document.querySelector('#aiChatMsgInput');
    const asst = area ? area.querySelector('.ai-msg.assistant .ai-msg-bubble') : null;
    return {
      msgAreaLen: area ? area.textContent.length : -1,
      msgAreaText: area ? area.textContent.slice(0, 200) : '',
      assistantBubbleText: asst ? asst.textContent.slice(0, 200) : '(无助手气泡)',
      assistantBubbleDisplay: asst ? asst.style.display : null,
      sendClicks: window.__sendClicks || 0,
      inputValue: inp ? inp.value : null,
      btnDisabled: btn ? btn.disabled : null
    };
  });
  console.log('[DIAG] afterSend =', JSON.stringify(afterSend, null, 2));
  console.log('[DIAG] chatBodies =', chatBodies.length);
  console.log('[DIAG] logs:');
  logs.slice(-40).forEach(l => console.log('   ' + l));

  await browser.close();
})();
