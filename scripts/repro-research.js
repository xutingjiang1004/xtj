// 深度研究前端复现脚本（临时，勿提交）
// 用法: node scripts/repro-research.js
const path = require('path');
const { chromium } = require('playwright-core');

const CHROME = '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:4173';

async function sseHandler(route) {
  // 模拟后端 /api/agent/research/stream 的正常 SSE 事件序列
  const events = [
    { type: 'research_stage', stage: 'rewrite', message: '总指挥正在理解并拆解研究任务…' },
    { type: 'research_stage', stage: 'rewrite_done', message: '任务已拆解，准备派出研究小队…' },
    { type: 'research_stage', stage: 'collect', message: '总指挥派出 3-5 个研究子智能体并行调研中…' },
    { type: 'research_content', text: '# 研究报告\n\n这是第一段内容。', content: '# 研究报告\n\n这是第一段内容。' },
    { type: 'research_sources', sources: [{ title: '来源一', url: 'https://example.com/1' }, { title: '来源二', url: 'https://example.com/2' }] },
    { type: 'research_stage', stage: 'synthesize', message: '总指挥正在交叉验证与深度研判，生成最终报告…' },
    { type: 'research_content', text: '\n\n这是第二段补充内容，报告应显示完整。', content: '\n\n这是第二段补充内容，报告应显示完整。' },
    { type: 'research_done', answer: '# 研究报告\n\n这是第一段内容。\n\n这是第二段补充内容，报告应显示完整。', sources: [{ title: '来源一', url: 'https://example.com/1' }, { title: '来源二', url: 'https://example.com/2' }], message_id: 'msg-research-1' }
  ];
  const body = events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('');
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();

  const requests = [];
  page.on('request', r => { if (r.url().includes('/api/')) requests.push(r.method() + ' ' + r.url().replace(BASE, '')); });
  page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') console.log('[console.' + t + ']', m.text().slice(0, 500)); });
  page.on('pageerror', e => console.log('[pageerror]', String(e && e.message || e).slice(0, 800)));

  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'research-repro-user');
    localStorage.setItem('xtj_device_id', 'research_repro');
    localStorage.setItem('xtj_ai_dt_conversation_id', 'REPRO-CONV-1');
  });

  // Mock 所有后端 API
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname.endsWith('/user/refresh')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'repro-token' }) });
    }
    if (pathname.endsWith('/agent/config')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {
        tavily_research: { enabled: true, models: ['pro', 'mini', 'auto'] },
        deep_think: { enabled: true, default_thinking_mode: 'max' }
      }})});
    }
    if (pathname.endsWith('/chat/new')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { conversation_id: 'REPRO-CONV-1' } }) });
    }
    if (pathname.endsWith('/chat/history') || pathname.endsWith('/research/history')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { messages: [], has_more: false }, messages: [] }) });
    }
    if (pathname.endsWith('/quota') || pathname.endsWith('/agent/quota')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, limit: 50, used: 0, search_limit: 50, search_used: 0, pro: true }) });
    }
    if (pathname.endsWith('/agent/research/stream')) {
      return sseHandler(route);
    }
    if (pathname.endsWith('/agent/chat')) {
      // 回退 deep think 路径也不应触发（tavily 成功时）
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {}, messages: [], conversations: [] }) });
  });

  // 捕获 network 失败
  page.on('requestfailed', r => console.log('[requestfailed]', r.url().replace(BASE, ''), r.failure() && r.failure().errorText));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__xtjEnsureAiAgentLoaded === 'function', { timeout: 20000 });

  // 打开深度研究页面
  await page.evaluate(() => window.__xtjAiAgent && window.__xtjAiAgent.open && window.__xtjAiAgent.open('research'));
  await page.waitForSelector('#panelDeepThink.active', { timeout: 10000 });
  console.log('== 深度研究页面已打开 ==');

  // 发送消息
  await page.fill('#dtInput', '请研究一下人工智能的发展趋势');
  await page.click('#dtSendBtn');

  // 等待一段时间观察
  await page.waitForTimeout(4000);

  const result = await page.evaluate(() => {
    const msgs = document.getElementById('dtMessages');
    return {
      html: msgs ? msgs.innerHTML.slice(0, 3000) : 'NO msgs',
      researchCards: msgs ? msgs.querySelectorAll('.ai-research-card').length : 0,
      answerText: msgs ? (() => { const a = msgs.querySelector('.ai-research-card .ai-think-answer'); return a ? a.innerText.slice(0, 500) : null; })() : null,
      researchState: msgs ? (() => { const c = msgs.querySelector('.ai-research-card'); return c && c._researchState ? c._researchState.state : null; })() : null,
      empty: msgs ? msgs.querySelector('.dt-empty') !== null : false,
      sendingExported: (window.__xtjAiAgent && window.__xtjAiAgent.getState ? true : false)
    };
  });
  console.log('== 页面状态 ==');
  console.log(JSON.stringify(result, null, 2));
  console.log('== 请求列表 ==');
  console.log(requests.join('\n'));

  await browser.close();
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });