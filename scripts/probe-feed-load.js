/* Probe production feed + assets */
const base = process.argv[2] || 'https://xtj.onrender.com';

(async () => {
  const r = await fetch(base + '/api/feed?page=0&limit=20');
  const j = await r.json();
  console.log('feed ok=', j.ok, 'posts=', j.posts && j.posts.length);

  const utils = await (await fetch(base + '/js/core-utils.min.js')).text();
  console.log('prod xtjWithTimeout', utils.includes('xtjWithTimeout'));

  const core = await (await fetch(base + '/js/core.min.js')).text();
  console.log('prod timeoutMs', core.includes('timeoutMs'));
  console.log('prod FEED_NET', core.includes('FEED_NET') || core.includes('18000') || core.includes('18e3'));

  const html = await (await fetch(base + '/')).text();
  console.log('has feed id', /id=["']feed["']/.test(html));
  console.log('skeleton in html', html.includes('xtj-loading-skeleton'));
  const hashes = [...html.matchAll(/js\/(core-utils|core|config)\.min\.js\?v=([a-f0-9]+)/g)].map((m) => m[0]);
  console.log('script hashes', hashes.join(', '));

  // Optional browser probe if playwright available
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    const failed = [];
    page.on('requestfailed', (req) => failed.push(req.url() + ' :: ' + (req.failure() && req.failure().errorText)));
    page.on('response', (res) => {
      const u = res.url();
      if (u.includes('/api/feed') || u.includes('supabase') || u.includes('core.min')) {
        logs.push('RESP ' + res.status() + ' ' + u.slice(0, 140));
      }
    });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(12000);
    const state = await page.evaluate(() => {
      const feed = document.getElementById('feed');
      return {
        hasSkeleton: !!(feed && feed.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card, .xtj-magic-loading')),
        hasPosts: !!(feed && feed.querySelector('.post')),
        feedText: feed ? String(feed.innerText || '').slice(0, 180) : 'no-feed',
        apiBase: (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.API_BASE || null,
        sb: !!window.sb,
        auth: window._xtjAuthState || null,
        loadFeedType: typeof window.loadFeed,
        initialLoadType: typeof window.initialLoad,
      };
    });
    console.log('BROWSER_STATE', JSON.stringify(state, null, 2));
    console.log('FAILED', failed.slice(0, 15).join('\n'));
    console.log(
      'LOGS',
      logs
        .filter((l) => /error|warn|PAGE|feed|timeout|fail|XTJ|RESP/i.test(l))
        .slice(0, 50)
        .join('\n')
    );
    await browser.close();
  } catch (e) {
    console.log('BROWSER_PROBE_SKIP', e && e.message);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
