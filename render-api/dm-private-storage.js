'use strict';
const { validateDmStoragePath, dmStorageBucket } = require('./dm-media');
const PRIVATE_BUCKET = 'dm-private';
function createDmPrivateStorage(supabase) {
  const cache = new Map(), pending = new Map();
  async function sign(path, refresh) {
    if (!validateDmStoragePath(path).ok || dmStorageBucket(path) !== PRIVATE_BUCKET) throw new Error('invalid_private_path');
    const hit = cache.get(path);
    if (!refresh && hit && hit.until > Date.now()) return hit.url;
    if (pending.has(path)) return pending.get(path);
    const request = (async () => {
      const r = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 3600);
      if (!r || r.error || !r.data || !r.data.signedUrl) throw new Error('private_media_sign_failed');
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(path, { url: r.data.signedUrl, until: Date.now() + 1800000 });
      return r.data.signedUrl;
    })().finally(() => pending.delete(path));
    pending.set(path, request); return request;
  }
  async function hydrateMessage(row, options = {}) {
    let payload;
    if (row.payload) payload = row.payload;
    else { try { payload = JSON.parse(row.content); } catch (_) { return; } }
    if (!payload || !payload.media || payload.media.bucket !== PRIVATE_BUCKET) return;
    const path = payload.media.storage_path;
    let url = '', unavailable = false;
    try { url = await sign(path); }
    catch (error) { if(options.strict)throw error; unavailable = true; }
    // One unavailable attachment must not erase the entire conversation or
    // its saved transcripts. Never fall back to an expired/public private URL.
    const next = { ...payload, media: { ...payload.media, url, unavailable } };
    if (row.payload) row.payload = next;
    else row.content = JSON.stringify(next);
  }
  async function hydrateBody(body) {
    if (!body || !body.ok) return body;
    const rows = [...(Array.isArray(body.data) ? body.data : []), ...(Array.isArray(body.items) ? body.items : []), ...(body.message ? [body.message] : [])];
    // Bounded parallel signing; every row has already passed the route's actor visibility check.
    for (let offset = 0; offset < rows.length; offset += 8) await Promise.all(rows.slice(offset, offset + 8).map(hydrateMessage));
    return body;
  }
  function middleware(req, res, next) {
    if (!/^\/api\/(dm\/(list|messages|send)|chat\/history\/(search|context))\/?$/.test(req.path)) return next();
    const json = res.json.bind(res);
    res.json = function(body) {
      void hydrateBody(body).then(json).catch(() => { if (!res.headersSent) { res.status(503); json({ ok: false, code: 'private_media_unavailable', retryable: true, error: '附件暂时不可用，请重试' }); } });
      return res;
    };
    next();
  }
  return { sign, hydrateMessage, hydrateBody, middleware };
}
module.exports = { PRIVATE_BUCKET, dmStorageBucket, createDmPrivateStorage };
