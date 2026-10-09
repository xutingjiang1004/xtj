'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require('playwright');
const id = '8c1cb02d-74d0-4e45-9e15-000000000001', media = '/api/photo/' + id + '/media';
const postMedia = '/api/post/' + id + '/media/0';
const sharedMedia = '/api/photo/shared/' + 'A'.repeat(64) + '/' + id + '/media';
const otherGrant = '/api/photo/shared/' + 'B'.repeat(64) + '/' + id + '/media';
test('persistent original cache revalidates across browser restarts and fails closed on every access loss', { timeout: 90000 }, async () => {
  let state = 200, version = 1, bytes = 0, requests = [], hold = null;
  const body = n => '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="' + (n === 1 ? '#78bba4' : '#e8b6a2') + '"/></svg>';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local'), file = url.pathname;
    if ([media, postMedia, sharedMedia, otherGrant].includes(file)) {
      requests.push({ url: req.url, conditional: req.headers['if-none-match'] });
      if (hold) await hold;
      if (state !== 200) return res.writeHead(state, { 'Cache-Control': 'no-store' }).end('denied');
      const etag = '"original-' + version + '"';
      if (req.headers['if-none-match'] === etag) return res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache' }).end();
      const image = body(version); bytes += Buffer.byteLength(image);
      return res.writeHead(200, { ETag: etag, 'Content-Type': 'image/svg+xml', 'Content-Length': Buffer.byteLength(image), 'Cache-Control': 'private, no-cache' }).end(image);
    }
    if (file === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Original cache fixture</title><script src="/js/media-cache.js"></script>');
    if (['/chat-notifications-sw.js', '/media-originals-sw.js', '/js/media-cache.js'].includes(file)) return res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' }).end(fs.readFileSync(path.join(process.cwd(), file)));
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xtj-original-cache-'));
  let context;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
    const page = await context.newPage(); await page.goto(origin);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    return page;
  }
  async function image(page, query = '', resource = media) {
    return page.evaluate(async url => {
      const response = await fetch(url); return { status: response.status, cached: response.headers.get('X-XTJ-Media-Cache'), body: await response.text() };
    }, resource + query);
  }
  try {
    let page = await launch(); const first = await image(page); assert.equal(first.body, body(1));
    await page.waitForFunction(async () => !!(await (await caches.open('xtj-original-media-v1')).match('/api/photo/' + '8c1cb02d-74d0-4e45-9e15-000000000001' + '/media')));
    const originalBytes = bytes;
    const next = await image(page, '?xtj_retry=click'); assert.equal(next.cached, 'revalidated'); assert.equal(next.body, first.body); assert.equal(bytes, originalBytes);
    await context.close(); context = null;
    page = await launch(); const reopened = await image(page); assert.equal(reopened.cached, 'revalidated'); assert.equal(bytes, originalBytes); assert.equal(requests.at(-1).conditional, '"original-1"');
    // Simulate a retained file being revisited days later, without changing its bytes.
    await page.evaluate(async () => {
      const cache = await caches.open('xtj-original-media-v1'), keys = await cache.keys(), response = await cache.match(keys[0]);
      const headers = new Headers(response.headers); headers.set('X-XTJ-Cached-At', String(Date.now() - 7 * 86400000));
      await cache.put(keys[0], new Response(response.body, { headers }));
    });
    assert.equal((await image(page)).cached, 'revalidated'); assert.equal(bytes, originalBytes);
    for (const resource of [postMedia, sharedMedia]) {
      assert.equal((await image(page, '', resource)).body, body(1));
      await page.waitForFunction(async resource => !!(await (await caches.open('xtj-original-media-v1')).match(resource)), resource);
      const transferred = bytes;
      assert.equal((await image(page, '', resource)).cached, 'revalidated'); assert.equal(bytes, transferred);
    }
    await image(page, '', otherGrant);
    assert.equal(requests.at(-1).conditional, undefined, 'a different share grant must not reuse another grant cache key');
    for (state of [401, 404, 402, 503]) { const denied = await image(page); assert.equal(denied.status, state); assert.equal(denied.body, 'denied'); assert.equal(denied.cached, null); }
    state = 200; version = 2; const changed = await image(page); assert.equal(changed.body, body(2)); assert.ok(bytes > originalBytes);
    await page.waitForFunction(async () => (await (await caches.open('xtj-original-media-v1')).match('/api/photo/8c1cb02d-74d0-4e45-9e15-000000000001/media'))?.headers.get('ETag') === '"original-2"');
    await context.setOffline(true); assert.equal(await image(page).then(() => false, () => true), true); await context.setOffline(false);
    await page.evaluate(() => xtjClearOriginalMediaCache());
    assert.equal(await page.evaluate(async () => (await (await caches.open('xtj-original-media-v1')).keys()).length), 0);
    // An authorized response started before logout must not repopulate cleared storage.
    let release; hold = new Promise(resolve => release = resolve);
    const pending = image(page); await page.waitForTimeout(80); await page.evaluate(() => xtjClearOriginalMediaCache()); release(); hold = null;
    assert.equal((await pending).status, 401);
    assert.equal(await page.evaluate(async () => (await (await caches.open('xtj-original-media-v1')).keys()).length), 0);
  } finally { if (context) await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); }
});
