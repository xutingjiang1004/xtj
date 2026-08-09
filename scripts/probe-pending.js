const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-http2', '--disable-quic', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const reqs = new Map();
  page.on('request', (r) => {
    reqs.set(r.url(), { url: r.url(), type: r.resourceType(), status: 'pending', t: Date.now() });
  });
  page.on('response', (r) => {
    const rec = reqs.get(r.url()) || { url: r.url() };
    rec.status = r.status();
    rec.ok = r.ok();
    reqs.set(r.url(), rec);
  });
  page.on('requestfailed', (r) => {
    const rec = reqs.get(r.url()) || { url: r.url() };
    rec.status = 'FAIL:' + (r.failure() && r.failure().errorText);
    reqs.set(r.url(), rec);
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  console.log('goto commit...');
  try {
    await page.goto('https://xtj.onrender.com/', { waitUntil: 'commit', timeout: 30000 });
    console.log('commit ok', Date.now());
  } catch (e) {
    console.log('commit fail', e.message);
  }

  for (let i = 1; i <= 15; i++) {
    await page.waitForTimeout(1000);
    const pending = [...reqs.values()].filter((x) => x.status === 'pending');
    const state = await page.evaluate(() => ({
      ready: document.readyState,
      scripts: document.scripts.length,
      hasLoadFeed: typeof window.loadFeed,
      feed: !!(document.getElementById('feed')),
    })).catch((e) => ({ err: String(e) }));
    console.log('t+' + i + 's ready=' + state.ready + ' loadFeed=' + state.hasLoadFeed + ' pending=' + pending.length);
    if (pending.length && i % 5 === 0) {
      console.log(
        'PENDING',
        pending
          .slice(0, 12)
          .map((p) => p.type + ' ' + p.url.slice(0, 100))
          .join('\n')
      );
    }
    if (state.ready === 'complete' && state.hasLoadFeed === 'function') break;
  }

  const all = [...reqs.values()];
  console.log(
    'DONE statuses',
    all
      .map((x) => x.status + ' ' + (x.url || '').split('/').pop().slice(0, 40))
      .slice(0, 40)
      .join('\n')
  );
  const finalState = await page.evaluate(() => {
    const feed = document.getElementById('feed');
    return {
      ready: document.readyState,
      loadFeed: typeof window.loadFeed,
      posts: !!(feed && feed.querySelector('.post')),
      skeleton: !!(feed && /skeleton/.test(feed.innerHTML || '')),
      text: feed ? (feed.innerText || '').slice(0, 80) : 'NO',
    };
  }).catch((e) => ({ err: String(e) }));
  console.log('FINAL', JSON.stringify(finalState));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
