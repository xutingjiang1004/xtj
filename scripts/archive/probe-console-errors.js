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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      logs.push(m.type() + ': ' + m.text());
    }
  });
  page.on('requestfailed', (r) => {
    if (/js\/|api\/feed|supabase/.test(r.url())) {
      logs.push('REQFAIL ' + r.url() + ' ' + (r.failure() && r.failure().errorText));
    }
  });

  // Don't wait for full load — capture early errors
  await page.goto('https://xtj.onrender.com/', {
    waitUntil: 'commit',
    timeout: 45000,
  });

  // poll for up to 20s
  let state = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    state = await page.evaluate(() => {
      const feed = document.getElementById('feed');
      return {
        ready: document.readyState,
        hasLoadFeed: typeof window.loadFeed,
        hasInitialLoad: typeof window.initialLoad,
        hasOptional: typeof window.xtjOptionalAuthFetch,
        hasSb: !!window.sb,
        hasPosts: !!(feed && feed.querySelector('.post')),
        hasSkeleton: !!(feed && /skeleton/.test(feed.innerHTML || '')),
        feedText: feed ? (feed.innerText || '').replace(/\s+/g, ' ').slice(0, 120) : 'NOFEED',
        sPosts: (document.getElementById('sPosts') || {}).textContent || null,
        apiBase: window.API_BASE || (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || null,
      };
    }).catch((e) => ({ evalError: String(e) }));
    if (state.hasPosts || (state.hasLoadFeed === 'function' && !state.hasSkeleton) || state.evalError) break;
  }

  // if loadFeed exists, try force
  if (state && state.hasLoadFeed === 'function' && !state.hasPosts) {
    const forced = await page.evaluate(async () => {
      try {
        await window.loadFeed(true);
        const feed = document.getElementById('feed');
        return {
          ok: true,
          hasPosts: !!(feed && feed.querySelector('.post')),
          text: (feed && feed.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
        };
      } catch (e) {
        return { ok: false, err: String(e && e.message || e) };
      }
    });
    state.forced = forced;
  }

  console.log(JSON.stringify({ state, errors: errors.slice(0, 20), logs: logs.slice(0, 40) }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
