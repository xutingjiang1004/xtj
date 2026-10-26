'use strict';
const { validateDmStoragePath, dmStorageBucket } = require('./dm-media');
const PRIVATE_BUCKET = 'dm-private';
function createDmPrivateStorage(supabase, options = {}) {
  const cache = new Map(), pending = new Map();
  function mediaPath(row, media) {
    if (!media) return '';
    if (media.bucket === PRIVATE_BUCKET) {
      return validateDmStoragePath(media.storage_path).ok && dmStorageBucket(media.storage_path) === PRIVATE_BUCKET ? media.storage_path : '';
    }
    // Historical messages used uploads before both buckets became private.
    // Never sign a URL supplied by another host or a non-chat object.
    try {
      const url = new URL(media.url), expected = new URL(options.supabaseUrl || supabase.supabaseUrl);
      if (url.origin !== expected.origin) return '';
      const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/uploads\/(.+)$/);
      const path = match && decodeURIComponent(match[1]);
      const actor = String(row.actor_key || '').replace(/^__dm_(?:img|vid|aud|file)__/, '');
      const declared = media.storage_path || actor;
      return path && validateDmStoragePath(path).ok && dmStorageBucket(path) === 'uploads' &&
        (!declared || declared === path || declared === media.url) ? path : '';
    } catch (_) { return ''; }
  }
  async function sign(path, refresh) {
    if (!validateDmStoragePath(path).ok) throw new Error('invalid_private_path');
    const hit = cache.get(path);
    if (!refresh && hit && hit.until > Date.now()) return hit.url;
    if (pending.has(path)) return pending.get(path);
    const request = (async () => {
      const r = await supabase.storage.from(dmStorageBucket(path)).createSignedUrl(path, 3600);
      if (!r || r.error || !r.data || !r.data.signedUrl) throw new Error('private_media_sign_failed');
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(path, { url: r.data.signedUrl, until: Date.now() + 1800000 });
      return r.data.signedUrl;
    })().finally(() => pending.delete(path));
    pending.set(path, request); return request;
  }
  async function hydrateMessage(row, options = {}) {
    let payload, legacyActorPath = '';
    if (row.payload) payload = row.payload;
    else {
      try { payload = JSON.parse(row.content); } catch (_) { payload = null; }
      if (!payload || typeof payload !== 'object' || !payload.media) {
        if (payload && payload.withdrawn) return;
        const actor = String(row.actor_key || '').match(/^__dm_(img|vid|aud|file)__(chat\/.+)$/);
        // A caption may itself be valid JSON, such as "123". Parsing it does
        // not make the attachment disappear; withdrawal still takes priority.
        if (!actor || !validateDmStoragePath(actor[2]).ok) return;
        const kind = { img: 'image', vid: 'video', aud: 'audio', file: 'file' }[actor[1]];
        const text = payload && typeof payload.text === 'string' ? payload.text :
          typeof row.content === 'string' ? row.content : '';
        payload = { ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
          type: 'dm', text, media: { kind, bucket: dmStorageBucket(actor[2]), storage_path: actor[2] } };
        legacyActorPath = actor[2];
      }
    }
    if (!payload || !payload.media) return;
    const path = legacyActorPath || mediaPath(row, payload.media);
    let url = '', unavailable = false;
    try { if (!path || payload.withdrawn) throw new Error('invalid_private_path'); url = await sign(path); }
    catch (error) { if(options.strict)throw error; unavailable = true; }
    // One unavailable attachment must not erase the entire conversation or
    // its saved transcripts. Never fall back to an expired/public private URL.
    const next = { ...payload, media: { ...payload.media, ...(path ? { storage_path: path, bucket: dmStorageBucket(path) } : {}), url, unavailable } };
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
    if (!/^\/api\/(dm\/(list|messages(?:\/loaded)?|send)|chat\/history\/(search|context))\/?$/.test(req.path)) return next();
    const json = res.json.bind(res);
    res.json = function(body) {
      void hydrateBody(body).then(json).catch(() => { if (!res.headersSent) { res.status(503); json({ ok: false, code: 'private_media_unavailable', retryable: true, error: '附件暂时不可用，请重试' }); } });
      return res;
    };
    next();
  }
  return { sign, mediaPath, hydrateMessage, hydrateBody, middleware };
}
module.exports = { PRIVATE_BUCKET, dmStorageBucket, createDmPrivateStorage };
