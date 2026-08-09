const { chromium } = require('playwright');
const base = process.argv[2] || 'https://xtj.onrender.com';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-http2', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const logs = [];
  const network = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (req) => {
    network.push('FAIL ' + req.method() + ' ' + req.url().slice(0, 160) + ' :: ' + (req.failure() && req.failure().errorText));
  });
  page.on('response', (res) => {
    const u = res.url();
    if (
      u.includes('/api/') ||
      u.includes('supabase') ||
      /core(-utils)?\.min\.js|config\.min\.js|vendor\/supabase/.test(u)
    ) {
      network.push('RESP ' + res.status() + ' ' + u.slice(0, 160));
    }
  });

  console.log('goto', base);
  const resp = await page.goto(base + '/', { waitUntil: 'commit', timeout: 120000 });
  console.log('commit status', resp && resp.status());

  // Wait for feed either posts or error or 25s
  try {
    await page.waitForFunction(
      () => {
        const feed = document.getElementById('feed');
        if (!feed) return false;
        if (feed.querySelector('.post')) return true;
        const t = feed.innerText || '';
        if (/加载失败|快来发布|快去发布|暂无/.test(t)) return true;
        return false;
      },
      { timeout: 25000 }
    );
  } catch (e) {
    console.log('waitForFunction timeout (still skeleton?)');
  }

  await page.waitForTimeout(2000);

  const state = await page.evaluate(async () => {
    const feed = document.getElementById('feed');
    let manual = null;
    try {
      const r = await fetch('/api/feed?page=0&limit=3', { credentials: 'include' });
      const j = await r.json();
      manual = { status: r.status, ok: j.ok, n: (j.posts || []).length };
    } catch (e) {
      manual = { error: String(e && e.message || e) };
    }
    return {
      readyState: document.readyState,
      hasSkeleton: !!(feed && feed.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card')),
      hasPosts: !!(feed && feed.querySelector('.post')),
      feedText: feed ? String(feed.innerText || '').replace(/\s+/g, ' ').slice(0, 200) : 'no-feed',
      apiBase: (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.API_BASE,
      sb: !!window.sb,
      loadFeed: typeof window.loadFeed,
      initialLoad: typeof window.initialLoad,
      auth: window._xtjAuthState,
      manualFeed: manual,
    };
  });

  console.log('STATE', JSON.stringify(state, null, 2));
  console.log('NETWORK\n' + network.slice(0, 40).join('\n'));
  console.log(
    'LOGS\n' +
      logs
        .filter((l) => /error|warn|PAGE|feed|timeout|fail|XTJ|Abort|supabase/i.test(l))
        .slice(0, 60)
        .join('\n')
  );

  // Try force loadFeed if available
  if (state.loadFeed === 'function') {
    const after = await page.evaluate(async () => {
      try {
        await window.loadFeed(true);
      } catch (e) {
        return { err: String(e && e.message || e) };
      }
      const feed = document.getElementById('feed');
      return {
        hasPosts: !!(feed && feed.querySelector('.post')),
        hasSkeleton: !!(feed && feed.querySelector('.xtj-loading-skeleton')),
        text: feed ? String(feed.innerText || '').replace(/\s+/g, ' ').slice(0, 160) : '',
      };
    });
    console.log('AFTER_FORCE_LOAD', JSON.stringify(after, null, 2));
  }

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
