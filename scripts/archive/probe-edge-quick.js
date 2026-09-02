// ============================================================================
// ⚠️ 一次性补丁/诊断脚本 —— 请勿重跑
// ----------------------------------------------------------------------------
// 本脚本针对特定历史代码状态编写（部分以源码行号偏移 + 字符串锚点改写
// js/* 与 js/core-parts/*），对应改动已合入当前源码；直接重跑可能因锚点
// 失效而报错或静默误改源码。请仅作历史排查参考，使命完成后可移入
// scripts/archive/。
// ============================================================================

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-http2', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console:' + m.text().slice(0, 200));
  });
  page.on('requestfailed', (r) => failed.push(r.resourceType() + ' ' + r.url().slice(0, 120) + ' ' + (r.failure() && r.failure().errorText)));

  const t0 = Date.now();
  let status = 'none';
  try {
    const resp = await page.goto('https://xtj.onrender.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    status = resp ? String(resp.status()) : 'null';
  } catch (e) {
    status = 'goto_error:' + e.message;
  }
  console.log('goto', status, 'ms', Date.now() - t0);

  // wait a bit more for deferred scripts
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const feed = document.getElementById('feed');
    return {
      ready: document.readyState,
      title: document.title,
      scripts: Array.from(document.scripts).map((s) => (s.src || 'inline').split('/').pop()).slice(0, 20),
      loadFeed: typeof window.loadFeed,
      initialLoad: typeof window.initialLoad,
      apiBase: window.API_BASE || (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE),
      hasPosts: !!(feed && feed.querySelector('.post')),
      skeleton: !!(feed && feed.querySelector('.xtj-loading-skeleton,.xtj-skeleton-card')),
      feedText: feed ? (feed.innerText || '').replace(/\s+/g, ' ').slice(0, 100) : 'NOFEED',
      sPosts: (document.getElementById('sPosts') || {}).textContent,
    };
  }).catch((e) => ({ evalError: String(e) }));

  console.log('STATE', JSON.stringify(state, null, 2));
  console.log('ERRORS', errors.slice(0, 15).join('\n'));
  console.log('FAILED', failed.slice(0, 20).join('\n'));
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
