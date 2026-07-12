'use strict';

const crypto = require('crypto');
const MAX_MEDIA_URL_LENGTH = 2048;
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_CONTENT_LENGTH = 2048;
const MAX_UPLOAD_ID_LENGTH = 128;
const UPLOAD_ID_RE = /^[a-zA-Z0-9_\-]{6,128}$/;
const STORAGE_PUBLIC_PHOTO_PREFIX = '/storage/v1/object/public/uploads/photos/';
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const IMAGE_MIME_TYPE = /^image\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

function invalid(error, code) {
  const body = { ok: false, error: error };
  if (code) body.code = code;
  return body;
}
function hasOwn(object, key) { return !!object && Object.prototype.hasOwnProperty.call(object, key); }

function parseStoragePhotoUrl(mediaUrl, supabaseUrl) {
  if (typeof mediaUrl !== 'string' || !mediaUrl || mediaUrl.length > MAX_MEDIA_URL_LENGTH || CONTROL_CHARACTERS.test(mediaUrl)) return invalid('图片地址无效', 'INVALID_INPUT');
  let parsed, storageOrigin;
  try { parsed = new URL(mediaUrl); storageOrigin = new URL(supabaseUrl); } catch (_) { return invalid('图片地址无效', 'INVALID_INPUT'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== storageOrigin.hostname || parsed.search || parsed.hash || !parsed.pathname.startsWith(STORAGE_PUBLIC_PHOTO_PREFIX)) return invalid('图片地址无效', 'INVALID_INPUT');
  const encodedPath = parsed.pathname.slice(STORAGE_PUBLIC_PHOTO_PREFIX.length);
  let storagePath;
  try { storagePath = decodeURIComponent(encodedPath); } catch (_) { return invalid('图片地址无效', 'INVALID_INPUT'); }
  if (!storagePath || CONTROL_CHARACTERS.test(storagePath) || storagePath.indexOf('\\') >= 0 || storagePath.split('/').some(function(part) { return !part || part === '.' || part === '..'; })) return invalid('图片地址无效', 'INVALID_INPUT');
  return { ok: true, mediaUrl: parsed.toString(), storagePath: 'photos/' + storagePath };
}

function validateSize(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_IMAGE_SIZE; }

function validatePhotoCreatePayload(body, supabaseUrl) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('请求无效', 'INVALID_INPUT');
  if (hasOwn(body, 'content') || hasOwn(body, 'actor_key')) return invalid('请求包含不支持的字段', 'INVALID_INPUT');
  const urlResult = parseStoragePhotoUrl(body.media_url, supabaseUrl);
  if (!urlResult.ok) return urlResult;
  if (!validateSize(body.file_size) || !validateSize(body.original_size)) return invalid('图片大小无效', 'PAYLOAD_TOO_LARGE');
  if (typeof body.mime_type !== 'string' || !body.mime_type || body.mime_type.length > MAX_MIME_TYPE_LENGTH || !IMAGE_MIME_TYPE.test(body.mime_type)) return invalid('图片类型无效', 'INVALID_INPUT');
  let uploadId = null;
  if (hasOwn(body, 'upload_id')) {
    if (typeof body.upload_id !== 'string' || !UPLOAD_ID_RE.test(body.upload_id)) return invalid('upload_id 无效', 'INVALID_INPUT');
    uploadId = body.upload_id;
  }
  const storagePath = urlResult.storagePath;
  const contentObj = {
    type: 'photo_wall',
    mediaKind: 'image',
    thumb: body.thumb_url || '',
    fileSize: body.file_size,
    originalSize: body.original_size,
    mimeType: body.mime_type,
    width: Number.isSafeInteger(body.width) && body.width > 0 ? body.width : null,
    height: Number.isSafeInteger(body.height) && body.height > 0 ? body.height : null,
    duration: null,
    storagePath: storagePath
  };
  let content;
  try { content = JSON.stringify(contentObj); } catch (_) { return invalid('图片信息无效', 'INVALID_INPUT'); }
  if (content.length > MAX_CONTENT_LENGTH) return invalid('图片信息无效', 'PAYLOAD_TOO_LARGE');
  return Object.assign({ ok: true, content: content, storagePath: storagePath, uploadId: uploadId }, urlResult);
}

async function cleanupStorageFile(supabase, storagePath, logger) {
  if (!storagePath) return { ok: true };
  try {
    const result = await supabase.storage.from('uploads').remove([storagePath]);
    if (result && result.error) {
      const msg = String((result.error && (result.error.message || result.error.error)) || '').toLowerCase();
      // not found 视为成功 (幂等)
      if (/not.?found|does not exist|no such|404/.test(msg)) return { ok: true };
      if (logger) logger.error('[PHOTO_STORAGE_CLEANUP_FAILED]', { path: storagePath, error: String(result.error.message || result.error) });
      return { ok: false, error: result.error };
    }
    return { ok: true };
  } catch (err) {
    const msg = String((err && (err.message || err.error)) || '').toLowerCase();
    if (/not.?found|does not exist|no such|404/.test(msg)) return { ok: true };
    if (logger) logger.error('[PHOTO_STORAGE_CLEANUP_FAILED]', { path: storagePath, error: String(err && err.message || err) });
    return { ok: false, error: err };
  }
}

async function findExistingPhotoByActorKey(supabase, actorKey) {
  try {
    const result = await supabase.from('posts').select('id,user_name,media_url,content,created_at,views,actor_key').eq('actor_key', actorKey).maybeSingle();
    if (result && result.data && !result.error) return { ok: true, data: result.data };
    return { ok: false, error: (result && result.error) || null };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function createPhotoRecord(options) {
  const validated = validatePhotoCreatePayload(options.body, options.supabaseUrl);
  if (!validated.ok) {
    return { status: 400, body: { ok: false, error: validated.error, code: validated.code || 'INVALID_INPUT' } };
  }
  const uploadId = validated.uploadId;
  const actorKey = 'photo_' + (uploadId || (options.createActorKey || crypto.randomUUID)());
  const storagePath = validated.storagePath;

  // 若提供了 upload_id, 先查询是否已存在 (幂等)
  if (uploadId) {
    const existing = await findExistingPhotoByActorKey(options.supabase, actorKey);
    if (existing.ok && existing.data) {
      return { status: 200, body: { ok: true, data: existing.data, idempotent: true } };
    }
  }

  let insertResult;
  try {
    insertResult = await options.supabase.from('posts').insert([{
      user_name: options.userName,
      media_url: validated.mediaUrl,
      media_type: '__photo_wall__',
      content: validated.content,
      actor_key: actorKey
    }]).select('id,user_name,media_url,content,created_at,views,actor_key').maybeSingle();
  } catch (e) {
    insertResult = { error: e || true };
  }
  if (insertResult && insertResult.data && !insertResult.error) {
    return { status: 200, body: { ok: true, data: insertResult.data, storage_path: storagePath } };
  }

  // 插入失败：检查是否已存在 (并发幂等，例如唯一键冲突)
  if (uploadId) {
    const existing = await findExistingPhotoByActorKey(options.supabase, actorKey);
    if (existing.ok && existing.data) {
      // 文件已被另一个请求上传成功：保留 storage 文件 (因为记录已存在)
      return { status: 200, body: { ok: true, data: existing.data, idempotent: true } };
    }
  }

  // 真正失败: 清理 storage (幂等)
  await cleanupStorageFile(options.supabase, storagePath, options.logger);
  const errMsg = (insertResult && insertResult.error && (insertResult.error.message || insertResult.error.details)) ? String(insertResult.error.message || insertResult.error.details) : '保存失败';
  const code = (insertResult && insertResult.error && insertResult.error.code === '23505') ? 'CONFLICT' : 'UPSTREAM_ERROR';
  return { status: 500, body: { ok: false, error: errMsg, code: code } };
}

module.exports = {
  MAX_IMAGE_SIZE,
  parseStoragePhotoUrl,
  validatePhotoCreatePayload,
  createPhotoRecord,
  cleanupStorageFile
};
