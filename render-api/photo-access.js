'use strict';
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
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
}
function photoPayload(row, mediaUrl = photoMediaUrl(row.id)) {
  const source = metadata(row), content = {};
  for (const key of ['type','caption','mediaKind','fileSize','originalSize','mimeType','width','height','duration','exif','sha256']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) content[key] = source[key];
  }
  content.thumb = '';
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

async function streamOriginal(req, res, { supabase, bucket, path, fetchImpl = fetch }) {
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
    const response = await fetchImpl(signed.data.signedUrl, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'error', signal: controller.signal });
    if (![200,206,304,416].includes(response.status) || (response.status === 304 && (range || (!headers['If-None-Match'] && !headers['If-Modified-Since'])))) throw Error('media_download_unavailable');
    const type = String(response.headers.get('content-type') || '').split(';')[0];
    if (![304,416].includes(response.status) && !/^(image\/(?:jpeg|png|webp|gif|avif|heic|heif|bmp|tif|tiff|x-ms-bmp)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)$/i.test(type)) throw Error('media_type_unavailable');
    // Every route authorizes against current session/visibility before reaching
    // this point. Private caches may reuse bytes only after that fresh check.
    res.status(response.status).set({ 'Cache-Control': 'private, no-cache, must-revalidate', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    for (const name of ['etag','last-modified','accept-ranges']) { const value = response.headers.get(name); if (value) res.set(name, value); }
    if (response.status !== 304) for (const name of ['content-type','content-length','content-range']) { const value = response.headers.get(name); if (value) res.set(name, value); }
    if (req.method === 'HEAD' || [304,416].includes(response.status)) { if (response.body) await response.body.cancel(); return res.end(); }
    if (!response.body) throw Error('media_body_unavailable');
    await pipeline(Readable.fromWeb(response.body), res);
  } finally { clearTimeout(timer); res.removeListener('close', closed); }
}
function createPhotoAccess({ app, supabase, supabaseUrl, secret, authenticateUser, verifyToken, optionalAuth, rateLimit, adminName = 'xxz', fetchImpl, normalPostAllowed = () => true, activeSession = async () => false }) {
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
      await streamOriginal(req,res,{supabase,bucket:PHOTO_BUCKET,path,fetchImpl});
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
      await streamOriginal(req,res,{supabase,bucket:PHOTO_BUCKET,path,fetchImpl});
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
      await streamOriginal(req,res,{supabase,bucket:'uploads',path,fetchImpl});
    } catch (_) { unavailable(res); }
  });
  app.get('/share/posts/:id', limited, async(req,res) => {
    try {
      if (!UUID.test(req.params.id)) return missing(res);
      const row = await checked(supabase.from('posts').select('id,user_name,media_type,media_url,content,visibility,is_deleted,created_at').eq('id',req.params.id).maybeSingle());
      if (!row || row.is_deleted === true || !['image','photo','album'].includes(row.media_type) || (row.visibility && row.visibility !== 'public') || !normalPostAllowed(row)) return missing(res);
      const posts = await loadPostAttachments(supabase,[row]);
      const rows = (posts[0].media_items || []).map((item,index) => ({ ...row, share_media_url:'/api/post/' + row.id + '/media/' + index, content:JSON.stringify({caption:index ? '' : metadata(row).text || (String(row.content).startsWith('{') ? '' : row.content)}) }));
      res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'}).type('html').send(renderSharePage(rows));
    } catch (_) { unavailable(res); }
  });
  return { photo, codec, authenticateMedia, migrate: () => migratePhotoStorage(supabase) };
}
function html(value) { return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderSharePage(rows, token) {
  const images = rows.map((row,index) => `<article><p class="author">${html(row.user_name)} <time>${html(String(row.created_at || '').slice(0,10))}</time></p><button class="photo" aria-label="查看第${index+1}张照片"><img src="${html(row.share_media_url || '/api/photo/shared/' + token + '/' + row.id + '/media')}" alt="${html(metadata(row).caption || '作者分享的照片')}" loading="${index ? 'lazy' : 'eager'}"></button>${metadata(row).caption ? '<p>' + html(metadata(row).caption) + '</p>' : ''}<button class="retry" hidden>图片未加载 · 点击重试</button></article>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>分享的照片 · XTJ</title><style>body{margin:0;background:#f0faf7;color:#233c37;font:16px/1.6 system-ui,sans-serif}header,main,footer{max-width:960px;margin:auto;padding:20px}header{display:flex;justify-content:space-between}a{color:#247d6c}main{display:grid;gap:24px}article{background:#ffffff70;border-radius:18px;padding:18px}p{white-space:pre-wrap;overflow-wrap:anywhere}.author{margin:0 0 12px}time{margin-left:12px;color:#718680;font-size:13px}button{font:inherit;color:inherit;cursor:pointer}.photo{display:block;width:100%;border:0;padding:0;background:transparent}.photo img{display:block;max-width:100%;max-height:70vh;width:auto;height:auto;margin:auto;border-radius:12px}.retry{border:0;background:transparent}footer{color:#718680;font-size:14px}dialog{padding:0;border:0;background:transparent;max-width:100vw;max-height:100dvh}dialog::backdrop{background:#10211feb}.viewer{display:flex;align-items:center;justify-content:center;width:100vw;height:100dvh;overflow:auto}.viewer img{max-width:100%;max-height:100%;object-fit:contain}.close{position:fixed;right:20px;top:20px;border:0;background:#ffffffdf;border-radius:50%;width:44px;height:44px;font-size:24px}.viewer{touch-action:none}.viewer.is-zoomed{touch-action:auto}.viewer img.zoomed{max-width:none;max-height:none}@media(min-width:720px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><script src="/js/photo-share.min.js" defer></script></head><body><header><strong>XTJ · 照片分享</strong><a href="/">打开网站</a></header><main>${images || '<p>这份分享已过期，或照片已被作者移除。</p>'}</main><footer>${rows.length ? '本次分享包含' + rows.length + '张照片，更多照片需登录网站查看。' : ''}</footer><dialog><div class="viewer"><img alt="照片预览"></div><button class="close" aria-label="关闭预览">×</button></dialog></body></html>`;
}
module.exports = { PHOTO_BUCKET, PHOTO_COOKIE, POST_MEDIA_COOKIE, setPhotoSession, photoStoragePath, safePhotoPath, originalPhotoPath, livePhoto, canReadPhoto, canReadSharedPhoto, photoMediaUrl, photoPayload, shareCodec, protectPhotoPath, migratePhotoStorage, streamOriginal, createPhotoAccess, renderSharePage };
