'use strict';
// Small, cacheable avatar images.
//
// Avatar rows hold either a Supabase Storage URL (original photo, often 0.5 MB) or, for old accounts, a base64
// data: URL (one is ~3 MB). Returning those from /api/avatar/* made every page load download megabytes for a 42px
// circle, and a data: URL that large cannot even be kept in localStorage, so avatars reloaded or vanished each visit.
// Here every avatar becomes a 192px WebP served from a URL that changes whenever the avatar does, so browsers can keep
// it for a year.
const crypto = require('node:crypto');
const { uploadPath } = require('./upload-access');

const SIZE = 192, MAX_SOURCE = 16 * 1024 * 1024, CACHE_MAX = 200;

function version(mediaUrl) {
  return crypto.createHash('sha1').update(String(mediaUrl || '')).digest('hex').slice(0, 10);
}
// The URL the API hands to browsers instead of the raw row value.
function avatarImageUrl(userName, mediaUrl) {
  if (!mediaUrl) return null;
  return '/api/avatar/image/' + encodeURIComponent(userName) + '?v=' + version(mediaUrl);
}

function registerAvatarImage(app, { supabase, supabaseUrl, sharp, rateLimit, fetchImpl = (...args) => fetch(...args) }) {
  const cache = new Map(), inflight = new Map();
  function remember(key, value) {
    cache.delete(key);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, value);
  }
  async function source(mediaUrl) {
    const match = /^data:image\/(?:jpeg|png|webp|gif|avif|heic|heif|bmp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(mediaUrl);
    if (match) {
      const buffer = Buffer.from(match[1], 'base64');
      if (!buffer.length || buffer.length > MAX_SOURCE) throw Error('avatar_source_invalid');
      return buffer;
    }
    const path = uploadPath(mediaUrl, supabaseUrl);
    if (!path || !/^avatars\//.test(path)) throw Error('avatar_source_invalid');
    const signed = await supabase.storage.from('uploads').createSignedUrl(path, 60);
    if (!signed || signed.error || !signed.data || !signed.data.signedUrl) throw Error('avatar_storage_unavailable');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(signed.data.signedUrl, { redirect: 'error', signal: controller.signal });
      if (!response.ok) throw Error('avatar_storage_unavailable');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_SOURCE) throw Error('avatar_source_invalid');
      return buffer;
    } finally { clearTimeout(timer); }
  }
  function render(mediaUrl) {
    const key = version(mediaUrl);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const work = source(mediaUrl)
      .then(input => sharp(input, { animated: false, limitInputPixels: 64 * 1024 * 1024 }).rotate()
        .resize({ width: SIZE, height: SIZE, fit: 'cover' }).webp({ quality: 82, effort: 3 }).timeout({ seconds: 10 }).toBuffer())
      .then(buffer => { const value = { buffer, etag: '"' + key + '"' }; remember(key, value); return value; })
      .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  }

  app.get('/api/avatar/image/:userName', rateLimit(60000, 600), async (req, res) => {
    const userName = String(req.params.userName || '').trim();
    if (!userName || userName.length > 100) return res.status(400).end();
    try {
      const { data, error } = await supabase.from('posts').select('media_url')
        .eq('user_name', userName).eq('media_type', '__avatar__').eq('actor_key', '__avatar__')
        .order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      const mediaUrl = data && data[0] && data[0].media_url;
      if (!mediaUrl) return res.status(404).end();
      const current = version(mediaUrl);
      const image = await render(mediaUrl);
      // The version in the URL names the exact avatar: a match is immutable, a stale link only gets a short life.
      const exact = String(req.query.v || '') === current;
      res.set({ 'Cache-Control': exact ? 'public, max-age=31536000, immutable' : 'public, max-age=60', 'Content-Type': 'image/webp',
        'X-Content-Type-Options': 'nosniff', ETag: image.etag });
      if (req.headers['if-none-match'] === image.etag) return res.status(304).end();
      return res.send(image.buffer);
    } catch (_) {
      return res.status(503).json({ ok: false, retryable: true });
    }
  });
}

module.exports = { avatarImageUrl, registerAvatarImage, version };
