'use strict';
// Persistent original bytes are never an authorization cache. Every reuse must
// receive a fresh 304 from the server after its current permission checks.
const ORIGINAL_CACHE = 'xtj-original-media-v1';
const ORIGINAL_MAX_BYTES = 256 * 1024 * 1024;
const ORIGINAL_MAX_FILE_BYTES = 64 * 1024 * 1024;
const ORIGINAL_MAX_AGE = 30 * 86400000;
let originalGeneration = 0, originalWrites = Promise.resolve();
function originalKey(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) return null;
  if (!/^\/api\/(?:photo\/(?:[0-9a-f-]{36}|shared\/[A-Za-z0-9_-]{60,6000}\/[0-9a-f-]{36})\/media|post\/[0-9a-f-]{36}\/media\/(?:0|[1-9]\d?))$/i.test(url.pathname)) return null;
  // Retry nonces must not create another copy of the same original. Do not
  // intercept requests carrying any other query parameter or credentials.
  if ([...url.searchParams.keys()].some(key => key !== 'xtj_retry')) return null;
  url.search = ''; return new Request(url.href);
}
function originalWrite(work) {
  originalWrites = originalWrites.catch(() => {}).then(work);
  return originalWrites;
}
async function trimOriginals(cache) {
  const entries = [];
  for (const key of await cache.keys()) {
    const saved = await cache.match(key);
    entries.push({ key, size: Number(saved.headers.get('X-XTJ-Cached-Bytes')) || 0, at: Number(saved.headers.get('X-XTJ-Cached-At')) || 0 });
  }
  entries.sort((a, b) => a.at - b.at);
  let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries) {
    if (Date.now() - entry.at <= ORIGINAL_MAX_AGE && bytes <= ORIGINAL_MAX_BYTES) break;
    await cache.delete(entry.key); bytes -= entry.size;
  }
}
async function originalResponse(event, key) {
  const generation = originalGeneration;
  let cache, saved;
  try {
    cache = await caches.open(ORIGINAL_CACHE); saved = await cache.match(key);
    if (saved && Date.now() - Number(saved.headers.get('X-XTJ-Cached-At')) > ORIGINAL_MAX_AGE) saved = null;
  } catch (_) {} // Storage being full/disabled must not prevent ordinary loads.
  const headers = new Headers(event.request.headers);
  if (saved && saved.headers.get('ETag')) headers.set('If-None-Match', saved.headers.get('ETag'));
  // The browser's no-cors image request needs same-origin mode to carry the
  // conditional header. Cookies stay on the existing same-origin request.
  // On the first worker visit, retain the browser's existing HTTP-cache bytes
  // while forcing a current server validation; installation must not cause a
  // one-time redownload of originals already stored by the browser.
  const response = await fetch(new Request(event.request, { mode: 'same-origin', headers, cache: saved ? 'no-store' : 'no-cache', redirect: 'error' }));
  if (generation !== originalGeneration) return new Response('', { status: 401 });
  if (response.headers.get('X-XTJ-Service-Status') === 'egress_quota_exceeded') {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => clients.forEach(client => client.postMessage({ type: 'XTJ_SERVICE_RESTRICTED' }))));
  }
  if (response.status === 304 && saved) {
    const reusedHeaders = new Headers(saved.headers);
    reusedHeaders.set('Cache-Control', 'private, no-cache, must-revalidate');
    reusedHeaders.set('X-XTJ-Media-Cache', 'revalidated');
    return new Response(saved.body, { status: 200, headers: reusedHeaders });
  }
  // Fail closed on offline, 401, 404, quota limits and server errors. Never
  // return an old body as an offline or stale-while-revalidate fallback.
  if (response.status === 404 && cache) event.waitUntil(originalWrite(() => cache.delete(key)).catch(() => {}));
  const bytes = Number(response.headers.get('Content-Length'));
  if (cache && response.status === 200 && response.headers.get('ETag') && /^image\//i.test(response.headers.get('Content-Type') || '') && bytes > 0 && bytes <= ORIGINAL_MAX_FILE_BYTES) {
    const storedHeaders = new Headers(response.headers);
    storedHeaders.delete('Vary'); storedHeaders.delete('Content-Encoding');
    storedHeaders.set('X-XTJ-Cached-At', String(Date.now())); storedHeaders.set('X-XTJ-Cached-Bytes', String(bytes));
    const copy = new Response(response.clone().body, { status: 200, headers: storedHeaders });
    event.waitUntil(originalWrite(async () => {
      if (generation !== originalGeneration) return;
      await cache.put(key, copy); await trimOriginals(cache);
    }).catch(() => {}));
  }
  return response;
}
self.addEventListener('fetch', event => {
  const key = originalKey(event.request);
  if (key) event.respondWith(originalResponse(event, key));
});
self.addEventListener('message', event => {
  const source = event.source;
  if (event.data?.type !== 'XTJ_CLEAR_ORIGINAL_MEDIA' || !source?.url || new URL(source.url).origin !== self.location.origin) return;
  originalGeneration++;
  event.waitUntil(originalWrite(() => caches.delete(ORIGINAL_CACHE)).catch(() => {}).then(() => event.ports?.[0]?.postMessage({ ok: true })));
});
