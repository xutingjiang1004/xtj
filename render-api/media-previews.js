'use strict';
const crypto = require('node:crypto');
const { mediaTraffic } = require('./media-traffic');
const VARIANT = 'hd1080-q80-v1', MAX_SOURCE = 50 * 1024 * 1024;
function cleanTag(value) { return String(value || '').replace(/^W\//, '').replace(/^"|"$/g, ''); }
function sourceInfo(data) {
  const meta = data && data.metadata || {};
  return { tag: cleanTag(data && (data.etag || data.eTag) || meta.eTag || meta.etag || data && data.version),
    size: Number((data && data.size) ?? meta.size), type: String(data && (data.contentType || data.content_type) || meta.mimetype || '') };
}
function previewTag(bucket, path, tag) {
  return '"xtj-' + crypto.createHash('sha256').update(VARIANT + '\0' + bucket + '\0' + path + '\0' + tag).digest('hex') + '"';
}
function matches(value, tag) { return String(value || '').split(',').some(v => v.trim().replace(/^W\//, '') === tag); }

function createMediaPreviews({ supabase, sharp, fetchImpl = fetch, traffic = mediaTraffic, now = () => Date.now(), maxBytes = 24 * 1024 * 1024, isRestricted = () => false } = {}) {
  const cache = new Map(), pending = new Map(), recent = new Map();
  let bytes = 0, working = false;
  const queue = [];
  function put(key, body) {
    if (body.length > maxBytes) return;
    if (cache.has(key)) bytes -= cache.get(key).length;
    cache.delete(key); cache.set(key, body); bytes += body.length;
    while (bytes > maxBytes) { const first = cache.keys().next().value; bytes -= cache.get(first).length; cache.delete(first); }
  }
  function get(key) { const body = cache.get(key); if (body) { cache.delete(key); cache.set(key, body); } return body; }
  async function info(bucket, path) {
    const r = await supabase.storage.from(bucket).info(path);
    if (!r || r.error || !r.data) throw Error('preview_source_unavailable');
    const data = sourceInfo(r.data);
    if (!data.tag || !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > MAX_SOURCE || !/^image\/(?!svg)[a-z0-9.+-]+$/i.test(data.type)) throw Error('preview_source_unsupported');
    return data;
  }
  function schedule(work, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (queue.length >= 16) return Promise.reject(Error('preview_busy'));
    return new Promise((resolve, reject) => {
      const item = { work, resolve, reject, at: now(), stop: null };
      const remove = error => {
        const index = queue.indexOf(item);
        if (index < 0) return;
        queue.splice(index, 1); item.stop(); reject(error);
      };
      const aborted = () => remove(signal.reason);
      const timer = setTimeout(() => remove(Error('preview_busy')), 30000);
      item.stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
      signal?.addEventListener('abort', aborted, { once: true });
      queue.push(item); pump();
    });
  }
  async function pump() {
    if (working || !queue.length) return;
    working = true;
    const item = queue.shift();
    item.stop();
    try {
      if (now() - item.at > 30000 || isRestricted()) throw Error('preview_busy');
      item.resolve(await item.work());
    } catch (error) { item.reject(error); }
    finally { working = false; void pump(); }
  }
  async function encode(input) {
    // An independent display copy. Originals are never rewritten or replaced.
    // 2026-10-28：列表统一用 1080px / q80 —— 之前 1920/q90 单张约 540-740KB，
    // 一页 3 张就 2MB，既拖慢首屏，也让免费实例的串行编码长期占满进程。
    // 点开大图仍走原图字节（不带 preview 参数），分辨率与画质不受此影响。
    // One decoder at a time bounds free-instance memory.
    return sharp(input, { animated: false, limitInputPixels: 64 * 1024 * 1024 })
      .rotate().resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, alphaQuality: 100, effort: 4 }).timeout({ seconds: 15 }).toBuffer();
  }
  async function download(bucket, path, expected, signal) {
    signal.throwIfAborted();
    const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    signal.throwIfAborted();
    if (!signed || signed.error || !signed.data?.signedUrl) throw Error('preview_source_unavailable');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    const aborted = () => controller.abort(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    let reader;
    try {
      traffic.request(bucket, path);
      const response = await fetchImpl(signed.data.signedUrl, { redirect: 'error', signal: controller.signal });
      if (response.status !== 200 || !response.body) { if (response.body) await response.body.cancel(); throw Error('preview_source_unavailable'); }
      const actual = cleanTag(response.headers.get('etag'));
      if (actual && actual !== expected.tag) { await response.body.cancel(); throw Error('preview_source_changed'); }
      reader = response.body.getReader(); const chunks = []; let total = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        total += part.value.byteLength; traffic.read(bucket, path, part.value.byteLength);
        if (total > MAX_SOURCE || total > expected.size) throw Error('preview_source_too_large');
        chunks.push(Buffer.from(part.value));
      }
      if (total !== expected.size) throw Error('preview_source_changed');
      return Buffer.concat(chunks, total);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', aborted); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
  function untilAborted(promise, signal) {
    return new Promise((resolve, reject) => {
      const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
      promise.then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
      if (signal.aborted) aborted();
      else signal.addEventListener('abort', aborted, { once: true });
    });
  }
  async function body(bucket, path, source, signal) {
    signal.throwIfAborted();
    const key = previewTag(bucket, path, source.tag), saved = get(key);
    if (saved) { traffic.previewHit(); return saved; }
    let entry = pending.get(key);
    if (!entry) {
      entry = { controller: new AbortController(), clients: 0, finished: false };
      entry.promise = schedule(async () => {
        // A previous client may have left during encoding. Reuse the finished
        // display copy instead of downloading its original again for a retry.
        const ready = get(key);
        if (ready) { traffic.previewHit(); return ready; }
        const input = await download(bucket, path, source, entry.controller.signal);
        entry.controller.signal.throwIfAborted();
        const result = await encode(input);
        // libvips work already in progress is bounded by its timeout. Retain
        // its finished copy even if the last client disconnected meanwhile;
        // every later use still checks current permissions and source version.
        put(key, result); traffic.generated(); return result;
      }, entry.controller.signal).finally(() => {
        entry.finished = true;
        if (pending.get(key) === entry) pending.delete(key);
      });
      pending.set(key, entry);
    }
    entry.clients++;
    try { return await untilAborted(entry.promise, signal); }
    finally {
      if (!--entry.clients && !entry.finished) {
        entry.controller.abort(Error('preview_cancelled'));
        if (pending.get(key) === entry) pending.delete(key);
      }
    }
  }
  return {
    async stream(req, res, { bucket, path }) {
      if (res.destroyed) return;
      const controller = new AbortController(), closed = () => controller.abort(Error('preview_cancelled'));
      res.on('close', closed);
      try {
        if (traffic.identify) traffic.identify(bucket,path,req.params && req.params.id);
        const source = await info(bucket, path), etag = previewTag(bucket, path, source.tag);
        if (controller.signal.aborted) return;
        res.set({ 'Cache-Control': 'private, no-cache, must-revalidate', ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-XTJ-Media-Variant': VARIANT });
        // A deterministic validator survives server restarts. Fresh permission
        // checks happen in the caller, and fresh source metadata is checked above.
        if (matches(req.headers['if-none-match'], etag)) { traffic.revalidated(); return res.status(304).end(); }
        if (req.method === 'HEAD') return res.status(200).type('image/webp').end();
        const result = await body(bucket, path, source, controller.signal);
        if (req.destroyed || res.destroyed) return;
        return res.status(200).set('Content-Length', String(result.length)).type('image/webp').end(result);
      } catch (error) { if (!controller.signal.aborted) throw error; }
      finally { res.removeListener('close', closed); }
    },
    async rememberUpload({ bucket, path, owner, input, metadata }) {
      const tag = crypto.createHash('md5').update(input).digest('hex'), swap = metadata.orientation >= 5 && metadata.orientation <= 8;
      recent.set(bucket + '\0' + path, { owner, at: now(), tag, info: { fileSize: input.length,
        width: swap ? metadata.height : metadata.width, height: swap ? metadata.width : metadata.height,
        exif: metadata.orientation ? { orientation: metadata.orientation } : null,
        sha256: crypto.createHash('sha256').update(input).digest('hex') } });
      while (recent.size > 128) recent.delete(recent.keys().next().value);
      // Do not retain the original buffer or background-decode an unbounded
      // number of uploads. The upload caller awaits this bounded operation.
      if (working || queue.length) return;
      const result = await schedule(() => encode(input)); put(previewTag(bucket, path, tag), result);
    },
    async inspectedUpload(bucket, path, owner) {
      const item = recent.get(bucket + '\0' + path);
      if (!item || item.owner !== owner || now() - item.at > 300000) return null;
      let current;
      try { current = await info(bucket, path); }
      catch (error) { error.transient = true; throw error; }
      return current.tag === item.tag && current.size === item.info.fileSize ? { ...item.info } : null;
    },
    inspect: () => ({ bytes, entries: cache.size, pending: pending.size, queued: queue.length })
  };
}
module.exports = { createMediaPreviews, previewTag, sourceInfo, VARIANT };
