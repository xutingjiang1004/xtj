'use strict';
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { mediaTraffic } = require('./media-traffic');
const { pipeline } = require('node:stream/promises');
const { parsePostMediaUrl } = require('./post-media');
const { loadPostAttachments } = require('./post-attachments');
const PHOTO_BUCKET = 'photo-wall';
const PHOTO_COOKIE = 'xtj_photo_session';
const POST_MEDIA_COOKIE = 'xtj_post_media_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_LIFETIME = 30 * 86400000;
const pendingMoves = new WeakMap();

function photoStoragePath(value, origin) {
  try {
    const url = new URL(value), expected = new URL(origin);
    if (url.origin !== expected.origin || url.protocol !== 'https:' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/storage\/v1\/(?:object\/(?:public|sign|authenticated)|render\/image\/public)\/(?:uploads|photo-wall)\/(.+)$/);
    if (!match) return null;
    const path = decodeURIComponent(match[1]);
    return safePhotoPath(path) ? path : null;
  } catch (_) { return null; }
}
function safePhotoPath(path) {
  return typeof path === 'string' && /^(photos|thumbs)\//.test(path) && path.length <= 500 &&
    !/[\\%\u0000-\u001f\u007f]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}
function metadata(row) { try { return JSON.parse(row.content || '{}') || {}; } catch (_) { return {}; } }
function originalPhotoPath(row, origin) {
  const stored = photoStoragePath(row.media_url, origin);
  if (!stored || !stored.startsWith('photos/')) return null;
  // Historical rows sometimes point media_url at a rotated/thumbnail copy.
  // The stored original path is server-owned metadata, never a request path.
  const original = metadata(row).storagePath || metadata(row).storage_path;
  return safePhotoPath(original) && /^photos\/(?!thumbs\/|rotated\/)/.test(original) ? original : stored;
}
function livePhoto(row) {
  return !!(row && row.media_type === '__photo_wall__' && row.is_deleted !== true && row.media_url !== '__deleted__' && metadata(row).__pw_del__ !== true);
}
function canReadPhoto(row, actor, admin = 'xxz') {
  return !!actor && livePhoto(row) && (row.visibility == null || row.visibility === 'public' || row.user_name === actor || actor === admin);
}
function photoMediaUrl(id) { return '/api/photo/' + encodeURIComponent(id) + '/media'; }
function setPhotoSession(res, token, expiresAt, sessionId) {
  if (!token || !(expiresAt > Date.now()) || !UUID.test(String(sessionId || ''))) return;
  const value = token + '~' + sessionId;
  res.cookie(PHOTO_COOKIE, value, { httpOnly:true, secure:true, sameSite:'Lax', path:'/api/photo', maxAge:expiresAt - Date.now() });
  res.cookie(POST_MEDIA_COOKIE, value, { httpOnly:true, secure:true, sameSite:'Lax', path:'/api/post', maxAge:expiresAt - Date.now() });
  res.cookie(POST_MEDIA_COOKIE, value, { httpOnly:true, secure:true, sameSite:'Lax', path:'/api/uploads', maxAge:expiresAt - Date.now() });
}
function photoPayload(row, mediaUrl = photoMediaUrl(row.id)) {
  const source = metadata(row), content = {};
  for (const key of ['type','caption','mediaKind','fileSize','originalSize','mimeType','width','height','duration','exif','sha256']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) content[key] = source[key];
  }
  content.thumb = mediaUrl + '?preview=1';
  return { ...row, media_url: mediaUrl, content: JSON.stringify(content) };
}
function shareCodec(secret, now = () => Date.now()) {
  if (!secret) throw Error('photo_share_secret_required');
  const key = crypto.createHash('sha256').update('xtj-photo-share-v1\0' + secret).digest();
  return {
    issue(rows, actor) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const value = { v: 1, ids: rows.map(row => row.id.toLowerCase()), private_ids: rows.filter(row => row.visibility === 'private').map(row => row.id.toLowerCase()), by: actor, exp: now() + SHARE_LIFETIME };
      cipher.setAAD(Buffer.from('xtj-photo-share-v1'));
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    read(token) {
      try {
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{60,6000}$/.test(token)) return null;
        const bytes = Buffer.from(token, 'base64url');
        if (bytes.toString('base64url') !== token) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
        decipher.setAuthTag(bytes.subarray(12,28)); decipher.setAAD(Buffer.from('xtj-photo-share-v1'));
        const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
        if (value.v !== 1 || !Number.isSafeInteger(value.exp) || value.exp <= now() || !value.by || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 50 ||
            value.ids.some(id => !UUID.test(id)) || new Set(value.ids).size !== value.ids.length || !Array.isArray(value.private_ids) || value.private_ids.some(id => !value.ids.includes(id))) return null;
        return value;
      } catch (_) { return null; }
    }
  };
}
function canReadSharedPhoto(row, grant) {
  return livePhoto(row) && grant && grant.ids.includes(row.id.toLowerCase()) &&
    (row.visibility == null || row.visibility === 'public' || (grant.private_ids.includes(row.id.toLowerCase()) && row.user_name === grant.by));
}
async function checked(query) { const result = await query; if (!result || result.error) throw Error('photo_lookup_unavailable'); return result.data; }

// Storage's cross-bucket move preserves original bytes and invalidates the old
// public key. A retry never overwrites a different private object.
async function storedFileExists(bucket, path) {
  const result = await bucket.exists(path);
  if (!result || typeof result.data !== 'boolean') throw Error('photo_storage_probe_failed');
  if (!result.error) return result.data;
  // storage-js returns data:false AND an error for a missing object's HEAD.
  const status = Number(result.error.status ?? result.error.originalError?.status ?? result.error.statusCode);
  if (result.data === false && [400,404].includes(status)) return false;
  throw Error('photo_storage_probe_failed');
}
async function protectPhotoPath(supabase, path) {
  if (!safePhotoPath(path)) throw Error('invalid_photo_storage_path');
  let moves = pendingMoves.get(supabase); if (!moves) pendingMoves.set(supabase, moves = new Map());
  if (moves.has(path)) return moves.get(path);
  const work = (async () => {
    const source = supabase.storage.from('uploads'), target = supabase.storage.from(PHOTO_BUCKET);
    const old = await storedFileExists(source, path);
    if (!old) return;
    const dest = await storedFileExists(target, path);
    if (!dest) {
      const moved = await source.move(path, path, { destinationBucket: PHOTO_BUCKET });
      if (moved && !moved.error) return;
      // Another instance may have moved this exact source while we waited.
      const [after, ready] = await Promise.all([storedFileExists(source,path),storedFileExists(target,path)]);
      if (after === false && ready === true) return;
      throw Error('photo_storage_move_failed');
    }
    const info = await Promise.all([source.info(path), target.info(path)]);
    if (info.some(r => !r || r.error || !r.data || !(r.data.size > 0) || r.data.size > 50 * 1024 * 1024) || info[0].data.size !== info[1].data.size) throw Error('photo_storage_collision');
    const copies = await Promise.all([source.download(path), target.download(path)]);
    if (copies.some(r => !r || r.error || !r.data)) throw Error('photo_storage_compare_failed');
    const hashes = await Promise.all(copies.map(async r => crypto.createHash('sha256').update(Buffer.from(await r.data.arrayBuffer())).digest('hex')));
    if (hashes[0] !== hashes[1]) throw Error('photo_storage_collision');
    const removed = await source.remove([path]);
    if (!removed || removed.error) throw Error('photo_public_copy_remove_failed');
    const remains = await storedFileExists(source, path);
    if (remains !== false) throw Error('photo_public_copy_remove_failed');
  })().finally(() => moves.delete(path));
  moves.set(path, work); return work;
}
async function migratePhotoStorage(supabase) {
  let moved = 0;
  const folders = ['photos','thumbs'], seen = new Set(folders);
  // Re-read offset zero after each batch: successful moves remove source rows.
  for (const folder of folders) {
    let offset = 0;
    while (true) {
      const result = await supabase.storage.from('uploads').list(folder, { limit: 100, offset });
      if (!result || result.error) throw Error('photo_migration_listing_failed');
      const rows = result.data || [], files = rows.filter(row => row.id);
      for (const row of rows.filter(row => !row.id)) {
        const child = folder + '/' + row.name;
        if (!safePhotoPath(child)) throw Error('invalid_photo_storage_path');
        if (!seen.has(child)) {seen.add(child);folders.push(child);}
      }
      for (const file of files) { await protectPhotoPath(supabase, folder + '/' + file.name); moved++; }
      if (files.length) continue;
      if (rows.length < 100) break;
      offset += 100;
    }
  }
  return moved;
}

// Media is revalidated on every use because access can change. Avatars are the exception: they are
// public by definition and every upload gets a new unique path, so a cached copy can never be stale.
const PRIVATE_MEDIA_CACHE = 'private, no-cache, must-revalidate';
async function streamOriginal(req, res, { supabase, bucket, path, fetchImpl = fetch, allowDownload = false, previews, cacheControl = PRIVATE_MEDIA_CACHE }) {
  mediaTraffic.identify(bucket, path, req.params && req.params.id);
  if (req.query && req.query.preview !== undefined) {
    if (req.query.preview !== '1' || !previews) return res.status(400).json({ ok:false, code:'invalid_preview' });
    if (req.headers.range) return res.status(416).end();
    return previews.stream(req, res, { bucket, path });
  }
  const range = req.headers.range;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return res.status(416).end();
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (!signed || signed.error || !signed.data || !signed.data.signedUrl) throw Error('media_storage_unavailable');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  const closed = () => controller.abort(); res.on('close', closed);
  try {
    const headers = {};
    if (range) { headers.Range = range; if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range']; }
    else if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
    else if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'];
    if (req.method !== 'HEAD') mediaTraffic.request(bucket, path);
    const response = await fetchImpl(signed.data.signedUrl, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'error', signal: controller.signal });
    if (![200,206,304,416].includes(response.status) || (response.status === 304 && (range || (!headers['If-None-Match'] && !headers['If-Modified-Since'])))) throw Error('media_download_unavailable');
    const type = String(response.headers.get('content-type') || '').split(';')[0];
    const mediaType = /^(image\/(?:jpeg|png|webp|gif|avif|heic|heif|bmp|tif|tiff|x-ms-bmp)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)$/i.test(type);
    const downloadType = allowDownload && /^(?:application\/(?:pdf|octet-stream|zip|rtf|vnd\.openxmlformats-officedocument\.[a-z.]+)|text\/(?:plain|csv))$/i.test(type);
    if (![304,416].includes(response.status) && !mediaType && !downloadType) throw Error('media_type_unavailable');
    // Every route authorizes against current session/visibility before reaching
    // this point. Private caches may reuse bytes only after that fresh check.
    res.status(response.status).set({ 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (downloadType) res.set('Content-Disposition','attachment');
    for (const name of ['etag','last-modified','accept-ranges']) { const value = response.headers.get(name); if (value) res.set(name, value); }
    if (response.status !== 304) for (const name of ['content-type','content-length','content-range']) { const value = response.headers.get(name); if (value) res.set(name, value); }
    if (response.status === 304) mediaTraffic.revalidated();
    if (req.method === 'HEAD' || [304,416].includes(response.status)) { if (response.body) await response.body.cancel(); return res.end(); }
    if (!response.body) throw Error('media_body_unavailable');
    const meter = new Transform({ transform(chunk, encoding, done) { mediaTraffic.read(bucket, path, chunk.length); done(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), meter, res);
  } finally { clearTimeout(timer); res.removeListener('close', closed); }
}
function createPhotoAccess({ app, supabase, supabaseUrl, secret, authenticateUser, verifyToken, optionalAuth, rateLimit, adminName = 'xxz', fetchImpl, previews, normalPostAllowed = () => true, activeSession = async () => false }) {
  const codec = shareCodec(secret);
  // Album cells arrive together. Share only unfinished reads, never completed
  // permission decisions: a later request must see deletion/privacy changes.
  const postReads = new Map();
  const attachmentReads = new Map();
  function readPostMedia(id) {
    if (postReads.has(id)) return postReads.get(id);
    const pending = checked(supabase.from('posts').select('id,user_name,media_type,media_url,content,visibility,is_deleted').eq('id',id).maybeSingle());
    postReads.set(id,pending);
    pending.then(() => postReads.delete(id), () => postReads.delete(id));
    return pending;
  }
  function readAttachments(row) {
    if (attachmentReads.has(row.id)) return attachmentReads.get(row.id);
    const pending = loadPostAttachments(supabase,[row]);
    attachmentReads.set(row.id,pending);
    pending.then(() => attachmentReads.delete(row.id), () => attachmentReads.delete(row.id));
    return pending;
  }
  const limited = rateLimit(60000, 180);
  async function photo(id) {
    if (!UUID.test(String(id || ''))) return null;
    return checked(supabase.from('posts').select('id,user_name,media_type,media_url,content,created_at,visibility,is_deleted,views').eq('id', id).maybeSingle());
  }
  function unavailable(res) { if (!res.headersSent && !res.destroyed) res.status(503).json({ ok:false, code:'media_unavailable', error:'图片暂时无法加载，请重试', retryable:true }); }
  function missing(res) { return res.status(404).json({ ok:false, code:'photo_not_found', error:'照片不存在或不可查看' }); }
  async function authenticateMedia(req, res, next) {
    if (req.headers.authorization) return authenticateUser(req,res,next);
    if (req.cookies && req.cookies.xtj_admin_token && verifyToken) return verifyToken(req, res, () => { req.userName = req.adminName; next(); });
    const parts = String(req.cookies && req.cookies[PHOTO_COOKIE] || '').split('~');
    if (parts.length !== 2 || !UUID.test(parts[1])) return res.status(401).json({ok:false,code:'auth_expired'});
    req.headers.authorization = 'Bearer ' + parts[0];
    return authenticateUser(req,res,async () => {
      try { if (await activeSession(parts[1],req.userName)) return next(); }
      catch (_) { return unavailable(res); }
      res.status(401).json({ok:false,code:'auth_expired'});
    });
  }
  app.get('/api/photo/:id/media', authenticateMedia, limited, async (req,res) => {
    try {
      const row = await photo(req.params.id);
      if (!canReadPhoto(row, req.userName, adminName)) return missing(res);
      const path = originalPhotoPath(row, supabaseUrl);
      if (!path) return missing(res);
      await protectPhotoPath(supabase, path);
      await streamOriginal(req,res,{supabase,bucket:PHOTO_BUCKET,path,fetchImpl,previews});
    } catch (_) { unavailable(res); }
  });
  app.post('/api/photo/share', authenticateUser, rateLimit(60000,30), async(req,res) => {
    try {
      const ids = req.body && req.body.photo_ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) return res.status(400).json({ok:false,code:'invalid_photo_ids'});
      const unique = Array.from(new Set(ids.map(id => id.toLowerCase())));
      const rows = await checked(supabase.from('posts').select('id,user_name,media_type,media_url,content,visibility,is_deleted').in('id', unique)) || [];
      const ordered = unique.map(id => rows.find(row => row.id.toLowerCase() === id));
      if (ordered.some(row => !canReadPhoto(row, req.userName, adminName) || ![null,undefined,'public','private'].includes(row.visibility) || (row.visibility === 'private' && row.user_name !== req.userName))) return missing(res);
      const token = codec.issue(ordered, req.userName);
      res.set('Cache-Control','no-store').json({ ok:true, share_path:'/share/photos/' + token, photo_count:unique.length, expires_in_ms:SHARE_LIFETIME });
    } catch (_) { unavailable(res); }
  });
  app.get('/api/photo/shared/:token/:id/media', limited, async(req,res) => {
    try {
      const grant = codec.read(req.params.token);
      if (!grant || !grant.ids.includes(String(req.params.id).toLowerCase())) return missing(res);
      const row = await photo(req.params.id);
      if (!canReadSharedPhoto(row, grant)) return missing(res);
      const path = originalPhotoPath(row, supabaseUrl);
      if (!path) return missing(res);
      await protectPhotoPath(supabase,path);
      await streamOriginal(req,res,{supabase,bucket:PHOTO_BUCKET,path,fetchImpl,previews});
    } catch (_) { unavailable(res); }
  });
  app.get('/share/photos/:token', limited, async(req,res) => {
    try {
      const grant = codec.read(req.params.token);
      if (!grant) return res.status(404).type('html').send(renderSharePage([]));
      const rows = await checked(supabase.from('posts').select('id,user_name,media_type,media_url,content,created_at,visibility,is_deleted').in('id', grant.ids)) || [];
      const visible = grant.ids.map(id => rows.find(row => row.id.toLowerCase() === id)).filter(row => canReadSharedPhoto(row, grant));
      res.set({ 'Cache-Control':'no-store, private', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex, nofollow' });
      res.status(visible.length ? 200 : 404).type('html').send(renderSharePage(visible,req.params.token));
    } catch (_) { unavailable(res); }
  });
  // The public post boundary is deliberately independent from wall access.
  // This same-origin stream avoids clients depending on a reachable Storage host.
  async function optionalPostMediaAuth(req,res,next) {
    if (req.headers.authorization) return optionalAuth(req,res,next);
    const parts = String(req.cookies && req.cookies[POST_MEDIA_COOKIE] || '').split('~');
    if (parts.length !== 2 || !UUID.test(parts[1])) return next();
    req.headers.authorization = 'Bearer ' + parts[0];
    return optionalAuth(req,res,async () => {
      try { if (!req.userName || !await activeSession(parts[1],req.userName)) req.userName = undefined; }
      catch (_) { req.userName = undefined; }
      next();
    });
  }
  app.get('/api/post/:id/media/:position', optionalPostMediaAuth, limited, async(req,res) => {
    try {
      if (!UUID.test(req.params.id) || !/^(?:0|[1-9]\d?)$/.test(req.params.position)) return missing(res);
      const row = await readPostMedia(req.params.id);
      if (!row || row.is_deleted === true || !['','text','image','video','audio','photo','album',null].includes(row.media_type) || !normalPostAllowed(row) || (row.visibility && row.visibility !== 'public' && row.user_name !== req.userName && req.userName !== adminName)) return missing(res);
      const posts = await readAttachments(row);
      const item = (posts[0].media_items || [])[Number(req.params.position)];
      const path = item && parsePostMediaUrl(item.media_url, supabaseUrl);
      if (!path) return missing(res);
      await streamOriginal(req,res,{supabase,bucket:'uploads',path,fetchImpl,previews});
    } catch (_) { unavailable(res); }
  });
  app.get('/share/posts/:id', limited, async(req,res) => {
    try {
      if (!UUID.test(req.params.id)) return missing(res);
      const row = await checked(supabase.from('posts').select('id,user_name,media_type,media_url,content,visibility,is_deleted,created_at').eq('id',req.params.id).maybeSingle());
      // 分享页面向游客公开，但只放行公开且未删除的普通帖子；
      // 文字、图片、视频、音频帖子共用同一个分享地址，微信好友点开即可查看。
      if (!row || row.is_deleted === true || !['','text','image','video','audio','photo','album',null].includes(row.media_type) || (row.visibility && row.visibility !== 'public') || !normalPostAllowed(row)) return missing(res);
      const posts = await loadPostAttachments(supabase,[row]);
      const items = (posts[0].media_items || []).map((item,index) => ({ ...item, share_media_url:'/api/post/' + row.id + '/media/' + index }));
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
      const origin = (/^https?$/.test(proto) ? proto : 'https') + '://' + req.get('host');
      // 正文里第一条公网链接做成卡片：音乐可试听、网页显示封面与标题，避免好友只看到裸 URL。
      const preview = await linkPreview((String(postShareText(row)).match(POST_URL_RE) || [])[0]);
      res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'}).type('html').send(renderPostSharePage(row, items, origin, preview));
    } catch (_) { unavailable(res); }
  });
  return { photo, codec, authenticateMedia, migrate: () => migratePhotoStorage(supabase) };
}
function html(value) { return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderSharePage(rows, token) {
  const images = rows.map((row,index) => `<article><p class="author">${html(row.user_name)} <time>${html(String(row.created_at || '').slice(0,10))}</time></p><button class="photo" aria-label="查看第${index+1}张照片"><img data-original="${html(row.share_media_url || '/api/photo/shared/' + token + '/' + row.id + '/media')}" src="${html((row.share_media_url || '/api/photo/shared/' + token + '/' + row.id + '/media') + '?preview=1')}" alt="${html(metadata(row).caption || '作者分享的照片')}" loading="${index ? 'lazy' : 'eager'}"></button>${metadata(row).caption ? '<p>' + html(metadata(row).caption) + '</p>' : ''}<button class="retry" hidden>图片未加载 · 点击重试</button></article>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>分享的照片 · XTJ</title><style>body{margin:0;background:#f0faf7;color:#233c37;font:16px/1.6 system-ui,sans-serif}header,main,footer{max-width:960px;margin:auto;padding:20px}header{display:flex;justify-content:space-between}a{color:#247d6c}main{display:grid;gap:24px}article{background:#ffffff70;border-radius:18px;padding:18px}p{white-space:pre-wrap;overflow-wrap:anywhere}.author{margin:0 0 12px}time{margin-left:12px;color:#718680;font-size:13px}button{font:inherit;color:inherit;cursor:pointer}.photo{display:block;width:100%;border:0;padding:0;background:transparent}.photo img{display:block;max-width:100%;max-height:70vh;width:auto;height:auto;margin:auto;border-radius:12px}.retry{border:0;background:transparent}footer{color:#718680;font-size:14px}dialog{padding:0;border:0;background:transparent;max-width:100vw;max-height:100dvh}dialog::backdrop{background:#10211feb}.viewer{display:flex;align-items:center;justify-content:center;width:100vw;height:100dvh;overflow:auto}.viewer img{max-width:100%;max-height:100%;object-fit:contain}.close{position:fixed;right:20px;top:20px;border:0;background:#ffffffdf;border-radius:50%;width:44px;height:44px;font-size:24px}.viewer{touch-action:none}.viewer.is-zoomed{touch-action:auto}.viewer img.zoomed{max-width:none;max-height:none}@media(min-width:720px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><script src="/js/media-cache.min.js?v=hq1920-v1" defer></script><script src="/js/photo-share.min.js?v=hq1920-v1" defer></script></head><body><header><strong>XTJ · 照片分享</strong><a href="/">打开网站</a></header><main>${images || '<p>这份分享已过期，或照片已被作者移除。</p>'}</main><footer>${rows.length ? '本次分享包含' + rows.length + '张照片，更多照片需登录网站查看。' : ''}</footer><dialog><div class="viewer"><img alt="照片预览"></div><button class="close" aria-label="关闭预览">×</button></dialog></body></html>`;
}
// 帖子正文可能是 v2 JSON 包装，分享页只取其中的纯文本，绝不回显原始 JSON。
function postShareText(row) {
  const raw = String(row && row.content || '');
  if (!raw.trim().startsWith('{')) return raw;
  const data = metadata(row);
  return String(data.text || data.caption || '');
}
// ---------- 分享页链接卡片 ----------
// 帖子正文常常只有一条链接（音乐/网页）。直接输出裸 URL，好友点开只看到一串字符；
// 这里在服务端取一次链接元信息，渲染成封面卡片，音乐链接再加 30 秒试听。
const LINK_CACHE = new Map();
const LINK_TTL = 3600 * 1000;
const LINK_TIMEOUT = 2600;
const LINK_MAX_BYTES = 300000;
const POST_URL_RE = /https?:\/\/[^\s<>"'）)\]】]+/g;
const LINK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    const hit = named[code.toLowerCase()];
    return hit === undefined ? all : hit;
  });
}

// 只允许公网 http(s)：帖子内容用户可控，分享页绝不能变成探测内网的跳板。
function publicLink(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch (_) { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host.includes(':') || host.startsWith('[')) return null;
  if (!host.includes('.')) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test)$/i.test(host)) return null;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const a = Number(ip[1]), b = Number(ip[2]);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return null;
    if (a === 169 && b === 254) return null;
    if (a === 172 && b >= 16 && b <= 31) return null;
    if (a === 192 && b === 168) return null;
  }
  return url;
}

async function readHtmlHead(url, limit = LINK_MAX_BYTES) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(LINK_TIMEOUT),
    headers: { 'user-agent': LINK_UA, accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) return '';
  if (!/text\/html|application\/xhtml/i.test(String(res.headers.get('content-type') || ''))) return '';
  if (!res.body) return String(await res.text()).slice(0, limit);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(Buffer.from(value)); total += value.length; }
  }
  try { await reader.cancel(); } catch (_) { /* 已经读够，取消剩余流 */ }
  return Buffer.concat(chunks).toString('utf8').slice(0, limit);
}

function metaContent(page, keys) {
  for (const key of keys) {
    const tag = page.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*>', 'i'));
    if (!tag) continue;
    const content = tag[0].match(/content=["']([\s\S]*?)["']/i);
    if (content && content[1].trim()) return decodeEntities(content[1].trim());
  }
  return '';
}

async function appleMusicPreview(url) {
  const songId = url.searchParams.get('i');
  const pathId = (url.pathname.match(/\d{6,}/g) || []).pop();
  const ids = [songId, pathId].filter(Boolean).filter((id, i, all) => all.indexOf(id) === i);
  for (const id of ids) {
    for (const country of ['cn', 'us']) {
      try {
        const res = await fetch('https://itunes.apple.com/lookup?id=' + encodeURIComponent(id) + '&entity=song&country=' + country, {
          signal: AbortSignal.timeout(LINK_TIMEOUT),
          headers: { 'user-agent': LINK_UA },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const hit = (data.results || []).find(item => item && (item.trackName || item.collectionName));
        if (!hit) continue;
        return {
          kind: 'music',
          host: 'Apple Music',
          url: url.href,
          title: hit.trackName || hit.collectionName || '',
          desc: [hit.artistName, hit.collectionName].filter(Boolean).join(' · '),
          image: String(hit.artworkUrl100 || hit.artworkUrl60 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
          audio: hit.previewUrl || '',
        };
      } catch (_) { /* 换下一个 id / 地区 */ }
    }
  }
  return null;
}

async function spotifyPreview(url) {
  const res = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url.href), {
    signal: AbortSignal.timeout(LINK_TIMEOUT),
    headers: { 'user-agent': LINK_UA },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.title) return null;
  return {
    kind: 'music',
    host: 'Spotify',
    url: url.href,
    title: data.title,
    desc: data.provider_name || 'Spotify',
    image: data.thumbnail_url || '',
    audio: '',
  };
}

async function ogPreview(url) {
  const page = await readHtmlHead(url.href);
  if (!page) return null;
  let title = metaContent(page, ['og:title', 'twitter:title']);
  if (!title) {
    const t = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = decodeEntities(String(t ? t[1] : '').replace(/\s+/g, ' ').trim());
  }
  let image = metaContent(page, ['og:image', 'og:image:secure_url', 'twitter:image']);
  if (image.startsWith('//')) image = url.protocol + image;
  else if (image.startsWith('/')) image = url.origin + image;
  if (!/^https?:\/\//i.test(image)) image = '';
  if (!title && !image) return null;
  return {
    kind: 'link',
    host: url.hostname.replace(/^www\./i, ''),
    url: url.href,
    title: title || url.hostname.replace(/^www\./i, ''),
    desc: metaContent(page, ['og:description', 'description', 'twitter:description']),
    image,
    audio: '',
  };
}

async function linkPreview(raw) {
  const url = publicLink(raw);
  if (!url) return null;
  const hit = LINK_CACHE.get(url.href);
  if (hit && Date.now() - hit.at < LINK_TTL) return hit.data;
  let data = null;
  try {
    if (/(^|\.)music\.apple\.com$/i.test(url.hostname)) data = await appleMusicPreview(url);
    else if (/(^|\.)open\.spotify\.com$/i.test(url.hostname)) data = await spotifyPreview(url);
    if (!data) data = await ogPreview(url);
  } catch (_) { data = null; }
  if (LINK_CACHE.size > 400) LINK_CACHE.clear();
  LINK_CACHE.set(url.href, { at: Date.now(), data });
  return data;
}

function linkCardHtml(preview) {
  if (!preview) return '';
  const music = preview.kind === 'music';
  const cover = preview.image ? '<img class="lc-cover" src="' + html(preview.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
  const meta = music
    ? html([preview.host, preview.audio ? '点播放试听 30 秒' : '点开收听'].filter(Boolean).join(' · '))
    : html(preview.host || '');
  const body = '<span class="lc-body"><span class="lc-title">' + html(preview.title || '') + '</span>'
    + (preview.desc ? '<span class="lc-desc">' + html(preview.desc) + '</span>' : '')
    + '<span class="lc-host">' + meta + '</span></span>';
  const card = '<a class="lcard' + (music ? ' music' : '') + '" href="' + html(preview.url) + '" target="_blank" rel="noopener noreferrer">' + cover + body + '</a>';
  const audio = music && preview.audio
    ? '<audio class="lc-audio" controls preload="none" src="' + html(preview.audio) + '"></audio>'
    : '';
  return '<section class="lblock">' + card + audio + '</section>';
}

// 单个帖子的公开分享页：正文 + 图片（可点开缩放）+ 音视频，游客无需登录即可查看。
// og:* 元信息让微信在聊天里展示帖子标题与摘要，而不是一条裸链接。
function renderPostSharePage(row, items, origin, preview = null) {
  const text = postShareText(row).trim();
  const media = Array.isArray(items) ? items : [];
  const author = String(row.user_name || 'XTJ 用户');
  // 标题与摘要里去掉裸链接本身，改用链接卡片的标题/简介，微信卡片才不会显示成一串网址。
  const plain = text.replace(POST_URL_RE, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const title = (preview && preview.title) || (plain ? plain.slice(0, 50) : author + ' 分享的帖子');
  const description = (preview && preview.desc) || (plain ? plain.slice(0, 120) : '来自 XTJ 的帖子，点开即可查看。');
  const firstImage = media.find(item => /^(image|photo)$/.test(String(item.media_type || '')));
  const shareImage = firstImage ? origin + firstImage.share_media_url : ((preview && preview.image) || origin + '/img/share-cover-v2.jpg');
  // 只有回退到站点默认封面时才声明 1200×1200，避免给真实图片标错尺寸。
  const coverMeta = firstImage || (preview && preview.image) ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="1200">';
  const card = linkCardHtml(preview);
  const textBlock = plain ? '<p class="text">' + html(plain) + '</p>' : '';
  const date = html(String(row.created_at || '').slice(0, 10));
  // 正文只有一条链接时，作者信息收成一行小字，避免出现一张空白卡片。
  const postHead = textBlock
    ? '<section class="post-card"><p class="author">' + html(author) + '<time>' + date + '</time></p>' + textBlock + '</section>'
    : (media.length || card
      ? '<p class="author-line">' + html(author) + '<time>' + date + '</time></p>'
      : '<section class="post-card"><p class="author">' + html(author) + '<time>' + date + '</time></p><p class="empty">这篇帖子暂时没有可展示的内容</p></section>');
  const body = media.map((item, index) => {
    const url = String(item.share_media_url || '');
    const kind = String(item.media_type || '');
    if (!url) return '';
    if (/^(image|photo)$/.test(kind)) return `<article><button class="photo" aria-label="查看第${index + 1}张图片"><img data-original="${html(url)}" src="${html(url + '?preview=1')}" alt="${html(text.slice(0, 60) || '帖子图片')}" loading="${index ? 'lazy' : 'eager'}"></button><button class="retry" hidden>图片未加载 · 点击重试</button></article>`;
    if (kind === 'video') return `<section class="media"><video controls playsinline preload="metadata" src="${html(url)}"></video></section>`;
    if (kind === 'audio') return `<section class="media"><audio controls preload="metadata" src="${html(url)}"></audio></section>`;
    return '';
  }).join('');
  const shareUrl = origin + '/share/posts/' + encodeURIComponent(row.id);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>${html(title)} · XTJ</title><meta name="description" content="${html(description)}"><meta property="og:type" content="article"><meta property="og:site_name" content="XTJ"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}"><meta property="og:url" content="${html(shareUrl)}"><meta property="og:image" content="${html(shareImage)}">${coverMeta}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${html(shareImage)}"><link rel="icon" type="image/png" sizes="192x192" href="${origin}/img/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="${origin}/img/icon-180.png"><meta name="theme-color" content="#059669"><style>body{margin:0;background:#f0faf7;color:#233c37;font:16px/1.7 system-ui,sans-serif}header,main,footer{max-width:680px;margin:auto;padding:20px}header{display:flex;justify-content:space-between;align-items:center}a{color:#247d6c;text-decoration:none}main{display:grid;gap:16px}.post-card,article,.media{background:#ffffff80;border:1px solid #ffffffb0;border-radius:18px;padding:18px;margin:0}p{white-space:pre-wrap;overflow-wrap:anywhere}.author{margin:0 0 10px;font-weight:600}.author-line{margin:0 4px;color:#4a6660;font-size:14px;font-weight:600}time{margin-left:12px;color:#718680;font-size:13px;font-weight:400}.text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:17px}.empty{color:#718680;margin:0}button{font:inherit;color:inherit;cursor:pointer}.photo{display:block;width:100%;border:0;padding:0;background:transparent}.photo img{display:block;max-width:100%;max-height:70vh;width:auto;height:auto;margin:auto;border-radius:12px}.retry{border:0;background:transparent}.media video{display:block;width:100%;max-height:70vh;border-radius:12px;background:#10211f}.media audio{width:100%}.lblock{display:grid;gap:10px}.lcard{display:flex;gap:14px;align-items:center;padding:14px;border-radius:18px;background:#ffffffcc;border:1px solid #ffffffb0;text-decoration:none;color:inherit}.lc-cover{width:76px;height:76px;border-radius:14px;object-fit:cover;flex:0 0 auto;background:#e8f5ef}.lcard.music .lc-cover{width:96px;height:96px}.lc-body{display:flex;flex-direction:column;gap:3px;min-width:0}.lc-title{font-weight:700;font-size:16px;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.lc-desc{color:#4a6660;font-size:14px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.lc-host{color:#718680;font-size:13px}.lc-audio{width:100%}.cta{display:block;text-align:center;padding:14px 18px;border-radius:14px;background:linear-gradient(135deg,#3d9a6c,#2f7d57);color:#fff !important;font-weight:700;text-decoration:none;box-shadow:0 8px 20px rgba(61,154,108,.28)}.cta:active{transform:translateY(1px)}footer{color:#718680;font-size:14px}dialog{padding:0;border:0;background:transparent;max-width:100vw;max-height:100dvh}dialog::backdrop{background:#10211feb}.viewer{display:flex;align-items:center;justify-content:center;width:100vw;height:100dvh;overflow:auto}.viewer img{max-width:100%;max-height:100%;object-fit:contain}.close{position:fixed;right:20px;top:20px;border:0;background:#ffffffdf;border-radius:50%;width:44px;height:44px;font-size:24px}.viewer{touch-action:none}.viewer.is-zoomed{touch-action:auto}.viewer img.zoomed{max-width:none;max-height:none}</style><script src="/js/media-cache.min.js?v=hq1920-v1" defer></script><script src="/js/photo-share.min.js?v=hq1920-v1" defer></script></head><body><header><strong>XTJ · 帖子分享</strong><a href="/">打开网站</a></header><main>${postHead}${card}${body}<a class="cta" href="${html(origin)}">打开 XTJ 看更多</a></main><footer>这篇帖子来自 XTJ，打开网站可以看到更多精彩内容。</footer><dialog><div class="viewer"><img alt="图片预览"></div><button class="close" aria-label="关闭预览">×</button></dialog></body></html>`;
}
module.exports = { PHOTO_BUCKET, PHOTO_COOKIE, POST_MEDIA_COOKIE, setPhotoSession, photoStoragePath, safePhotoPath, originalPhotoPath, livePhoto, canReadPhoto, canReadSharedPhoto, photoMediaUrl, photoPayload, shareCodec, protectPhotoPath, migratePhotoStorage, streamOriginal, createPhotoAccess, renderSharePage, renderPostSharePage, linkPreview, publicLink };
