'use strict';

const crypto = require('crypto');
const MAX_MEDIA_URL_LENGTH = 2048;
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_CONTENT_LENGTH = 2048;
const STORAGE_PUBLIC_PHOTO_PREFIX = '/storage/v1/object/public/uploads/photos/';
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const IMAGE_MIME_TYPE = /^image\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

function invalid(error) { return { ok: false, error: error }; }
function hasOwn(object, key) { return !!object && Object.prototype.hasOwnProperty.call(object, key); }

function parseStoragePhotoUrl(mediaUrl, supabaseUrl) {
  if (typeof mediaUrl !== 'string' || !mediaUrl || mediaUrl.length > MAX_MEDIA_URL_LENGTH || CONTROL_CHARACTERS.test(mediaUrl)) return invalid('图片地址无效');
  let parsed, storageOrigin;
  try { parsed = new URL(mediaUrl); storageOrigin = new URL(supabaseUrl); } catch (_) { return invalid('图片地址无效'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== storageOrigin.hostname || parsed.search || parsed.hash || !parsed.pathname.startsWith(STORAGE_PUBLIC_PHOTO_PREFIX)) return invalid('图片地址无效');
  const encodedPath = parsed.pathname.slice(STORAGE_PUBLIC_PHOTO_PREFIX.length);
  let storagePath;
  try { storagePath = decodeURIComponent(encodedPath); } catch (_) { return invalid('图片地址无效'); }
  if (!storagePath || CONTROL_CHARACTERS.test(storagePath) || storagePath.indexOf('\\') >= 0 || storagePath.split('/').some(function(part) { return !part || part === '.' || part === '..'; })) return invalid('图片地址无效');
  return { ok: true, mediaUrl: parsed.toString(), storagePath: 'photos/' + storagePath };
}

function validateSize(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_IMAGE_SIZE; }

function validatePhotoCreatePayload(body, supabaseUrl) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('请求无效');
  if (hasOwn(body, 'content') || hasOwn(body, 'actor_key')) return invalid('请求包含不支持的字段');
  const urlResult = parseStoragePhotoUrl(body.media_url, supabaseUrl);
  if (!urlResult.ok) return urlResult;
  if (!validateSize(body.file_size) || !validateSize(body.original_size)) return invalid('图片大小无效');
  if (typeof body.mime_type !== 'string' || !body.mime_type || body.mime_type.length > MAX_MIME_TYPE_LENGTH || !IMAGE_MIME_TYPE.test(body.mime_type)) return invalid('图片类型无效');
  const content = JSON.stringify({ type: 'photo_wall', mediaKind: 'image', thumb: '', fileSize: body.file_size, originalSize: body.original_size, mimeType: body.mime_type, duration: null });
  if (content.length > MAX_CONTENT_LENGTH) return invalid('图片信息无效');
  return Object.assign({ ok: true, content: content }, urlResult);
}

async function createPhotoRecord(options) {
  const validated = validatePhotoCreatePayload(options.body, options.supabaseUrl);
  if (!validated.ok) return { status: 400, body: { error: validated.error } };
  const actorKey = 'photo_' + (options.createActorKey || crypto.randomUUID)();
  let insertResult;
  try {
    insertResult = await options.supabase.from('posts').insert([{ user_name: options.userName, media_url: validated.mediaUrl, media_type: '__photo_wall__', content: validated.content, actor_key: actorKey }]).select('id,user_name,media_url,content,created_at,views,actor_key').maybeSingle();
  } catch (_) {
    insertResult = { error: true };
  }
  if (!insertResult.error) return { status: 200, body: { ok: true, data: insertResult.data } };
  try {
    const cleanup = await options.supabase.storage.from('uploads').remove([validated.storagePath]);
    if (cleanup && cleanup.error) options.logger.error('[PHOTO_CREATE_ROLLBACK_FAILED]', { event: 'photo_create_rollback_failed' });
  } catch (_) {
    options.logger.error('[PHOTO_CREATE_ROLLBACK_FAILED]', { event: 'photo_create_rollback_failed' });
  }
  return { status: 500, body: { error: '保存失败' } };
}

module.exports = { MAX_IMAGE_SIZE, parseStoragePhotoUrl, validatePhotoCreatePayload, createPhotoRecord };
