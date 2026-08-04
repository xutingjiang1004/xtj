'use strict';

const crypto = require('crypto');
const { removeStorageWithQueue } = require('./storage-cleanup');
const MAX_MEDIA_URL_LENGTH = 2048;
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_CONTENT_LENGTH = 2048;
const MAX_UPLOAD_ID_LENGTH = 128;
const UPLOAD_ID_RE = /^[a-zA-Z0-9_\-]{6,128}$/;
const STORAGE_PUBLIC_PHOTO_PREFIX = '/storage/v1/object/public/uploads/photos/';
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
// 照片墙只接受位图图片；SVG 可内嵌 <script>/onload，上传后原图 URL 直接打开即存储型 XSS 载体，显式拒绝
const IMAGE_MIME_TYPE = /^image\/(?!svg\+xml)(?:jpeg|png|webp|gif|avif|heic|heif|bmp|tiff?|x-ms-bmp)[a-z0-9!#$&^_.+-]{0,126}$/i;

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
  // Reject residual percent-encoding so a downstream storage/router decode
  // cannot turn %252e%252e into a traversal segment after this validation.
  if (/%[0-9a-f]{2}/i.test(storagePath)) return invalid('图片地址无效', 'INVALID_INPUT');
  if (!storagePath || CONTROL_CHARACTERS.test(storagePath) || storagePath.indexOf('\\') >= 0 || storagePath.split('/').some(function(part) { return !part || part === '.' || part === '..'; })) return invalid('图片地址无效', 'INVALID_INPUT');
  return { ok: true, mediaUrl: parsed.toString(), storagePath: 'photos/' + storagePath };
}

function validateSize(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_IMAGE_SIZE; }

// 精确判断 storage 对象是否存在：createSignedUrl 在部分配置下即使对象不存在也会返回成功，
// 这里用 list + 精确文件名匹配，避免"旧文件丢失→修复"分支变成死代码。
async function storageObjectExists(supabase, bucket, path) {
  if (!supabase || !path) return { ok: false, exists: false, error: null };
  try {
    var cleanPath = String(path).replace(/^\/+/, '');
    var parts = cleanPath.split('/');
    var name = parts.pop();
    var directory = parts.join('/');
    var result = await supabase.storage.from(bucket).list(directory, { limit: 1000, search: name });
    if (result.error) return { ok: false, exists: false, error: result.error };
    var found = (result.data || []).some(function(item) {
      return item && item.name === name && !item.id; // 目录项有 id，文件项没有
    });
    if (found) return { ok: true, exists: true, error: null };
    // 精确名未命中（list search 是模糊匹配，可能截断），再尝试 download HEAD 级验证
    var probe = await supabase.storage.from(bucket).download(cleanPath);
    if (probe && probe.error) {
      var code = String(probe.error.statusCode || probe.error.code || probe.error.message || '');
      if (/404|not.?found|NoSuchKey/i.test(code)) return { ok: true, exists: false, error: null };
      return { ok: false, exists: false, error: probe.error };
    }
    return { ok: true, exists: true, error: null };
  } catch (e) {
    return { ok: false, exists: false, error: e };
  }
}

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
    thumb: '',
    fileSize: body.file_size,
    originalSize: body.original_size,
    mimeType: body.mime_type,
    width: null,
    height: null,
    duration: null,
    storagePath: storagePath
  };
  let content;
  try { content = JSON.stringify(contentObj); } catch (_) { return invalid('图片信息无效', 'INVALID_INPUT'); }
  if (content.length > MAX_CONTENT_LENGTH) return invalid('图片信息无效', 'PAYLOAD_TOO_LARGE');
  return Object.assign({ ok: true, content: content, storagePath: storagePath, uploadId: uploadId }, urlResult);
}

function publicStorageUrl(supabaseUrl, storagePath) {
  var origin = new URL(supabaseUrl).origin;
  return origin + '/storage/v1/object/public/uploads/' + storagePath.split('/').map(encodeURIComponent).join('/');
}

function getPhotoDerivativePaths(storagePath) {
  var key = crypto.createHash('sha256').update(String(storagePath || '')).digest('hex');
  var rotatedKey = crypto.createHash('sha256').update(String(storagePath || '') + '_rotated').digest('hex');
  return {
    thumbnailPath: 'photos/thumbs/' + key + '.webp',
    rotatedPath: 'photos/rotated/' + rotatedKey + '.webp'
  };
}

function collectPhotoRecordPaths(record, supabaseUrl) {
  var paths = new Set();
  function add(value) {
    if (typeof value === 'string' && value.trim()) paths.add(value.trim().replace(/^\/+/, ''));
  }
  try {
    var content = JSON.parse(record && record.content || '{}');
    add(content.storagePath || content.storage_path);
    add(content.thumb || content.thumbnailPath || content.thumbnail_path);
    add(content.rotatedPath || content.rotated_path);
  } catch (_) {}
  var parsed = parseStoragePhotoUrl(record && record.media_url, supabaseUrl);
  if (parsed.ok) add(parsed.storagePath);
  return paths;
}

async function createPhotoThumbnail(options) {
  var storagePath = options && options.storagePath;
  if (!storagePath || !options.supabase || !options.sharp) throw new Error('thumbnail unavailable');
  var downloaded = await options.supabase.storage.from('uploads').download(storagePath);
  if (!downloaded || downloaded.error || !downloaded.data) throw new Error('thumbnail source unavailable');
  var input = Buffer.from(await downloaded.data.arrayBuffer());
  // 服务端核对真实文件大小：客户端声称值不可信，防止超大文件/解压炸弹拖垮内存
  if (input.length > MAX_IMAGE_SIZE) {
    throw new Error('thumbnail source too large');
  }
  // 限制解码像素总量，防止高维"解压炸弹"图片耗尽内存（默认约 1.6 亿像素上限，这里收紧到 1 亿）
  var image = options.sharp(input, { animated: false, limitInputPixels: 100000000 });
  var meta = await image.metadata();
  var derivativePaths = getPhotoDerivativePaths(storagePath);
  var thumbnailPath = derivativePaths.thumbnailPath;
  var outputResult = await image.rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  var output = Buffer.isBuffer(outputResult) ? outputResult : outputResult && outputResult.data;
  var outputInfo = outputResult && !Buffer.isBuffer(outputResult) ? outputResult.info : null;
  if (!output) throw new Error('thumbnail encode failed');
  var uploaded = await options.supabase.storage.from('uploads').upload(thumbnailPath, output, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
  if (uploaded && uploaded.error) throw new Error('thumbnail upload failed');

  // Phase 5: 如果检测到 EXIF 方向且非标准方向，创建旋转后的原始尺寸 WebP 版本
  var rotatedUrl = null;
  var rotatedFileSize = null;
  var rotatedPath = null;
  var finalInfo = outputInfo || null;
  if (meta && meta.orientation && meta.orientation !== 1) {
    try {
      var rotatedImage = options.sharp(input, { animated: false }).rotate().webp({ quality: 85 });
      var rotatedResult = await rotatedImage.toBuffer({ resolveWithObject: true });
      var rotatedOutput = Buffer.isBuffer(rotatedResult) ? rotatedResult : rotatedResult && rotatedResult.data;
      var rotatedInfo = rotatedResult && !Buffer.isBuffer(rotatedResult) ? rotatedResult.info : null;
      if (!rotatedOutput) throw new Error('rotated image encode failed');
      rotatedPath = derivativePaths.rotatedPath;
      var rotatedUpload = await options.supabase.storage.from('uploads').upload(rotatedPath, rotatedOutput, { contentType: 'image/webp', cacheControl: '31536000', upsert: true });
      if (rotatedUpload && !rotatedUpload.error) {
        rotatedUrl = publicStorageUrl(options.supabaseUrl, rotatedPath);
        rotatedFileSize = rotatedOutput.length;
        finalInfo = rotatedInfo || finalInfo;
      }
    } catch (_) { /* 旋转文件创建失败，降级使用原始文件 */ }
  }

  return {
    path: thumbnailPath,
    url: publicStorageUrl(options.supabaseUrl, thumbnailPath),
    fileSize: output.length,
    width: finalInfo && Number.isSafeInteger(finalInfo.width) ? finalInfo.width : (Number.isSafeInteger(meta.width) ? meta.width : null),
    height: finalInfo && Number.isSafeInteger(finalInfo.height) ? finalInfo.height : (Number.isSafeInteger(meta.height) ? meta.height : null),
    exif: Number.isSafeInteger(meta.orientation) ? { orientation: meta.orientation } : null,
    rotatedUrl: rotatedUrl,
    rotatedPath: rotatedPath,
    rotatedFileSize: rotatedFileSize
  };
}

async function cleanupStorageFile(supabase, storagePath, logger, options) {
  if (!storagePath) return { ok: true, cleanup_pending: false };
  const result = await removeStorageWithQueue(supabase, {
    bucket: 'uploads',
    paths: [storagePath],
    photoId: options && options.photoId
  });
  if (!result.ok && logger) logger.error('[PHOTO_STORAGE_CLEANUP_FAILED]', {
    target: storagePath.indexOf('photos/thumbs/') === 0 ? 'thumbnail' : 'original',
    cleanup_pending: result.cleanup_pending === true,
    queue_failed: result.queue_failed === true
  });
  return result;
}

async function findExistingPhotoByActorKey(supabase, actorKey, userName) {
  try {
    var query = supabase.from('posts').select('id,user_name,media_url,content,created_at,views,actor_key').eq('actor_key', actorKey);
    // 幂等键必须绑定用户，防止跨用户泄露/覆盖他人照片记录
    if (typeof userName === 'string' && userName) query = query.eq('user_name', userName);
    const result = await query.maybeSingle();
    if (result && result.error) return { ok: false, found: false, error: result.error };
    return { ok: true, found: !!(result && result.data), data: (result && result.data) || null, error: null };
  } catch (err) {
    return { ok: false, found: false, error: err };
  }
}

async function cleanupPhotoPaths(options, paths) {
  const uniquePaths = Array.from(new Set((Array.isArray(paths) ? paths : []).filter(Boolean)));
  if (!uniquePaths.length) return { ok: true, cleanup_pending: false, queue_failed: false, results: [] };
  const result = await removeStorageWithQueue(options.supabase, {
    bucket: 'uploads',
    paths: uniquePaths,
    photoId: options.cleanupPhotoId
  });
  if (!result.ok && options.logger) options.logger.error('[PHOTO_STORAGE_CLEANUP_FAILED]', {
    paths: uniquePaths,
    cleanup_pending: result.cleanup_pending === true,
    queue_failed: result.queue_failed === true
  });
  const results = [result];
  return {
    ok: results.every(function (result) { return result && result.ok === true; }),
    cleanup_pending: results.some(function (result) { return result && result.cleanup_pending === true; }),
    queue_failed: results.some(function (result) { return result && result.queue_failed === true; }),
    results: results
  };
}

async function createPhotoRecord(options) {
  if (!options || typeof options.userName !== 'string' || !options.userName.trim()) {
    return { status: 401, body: { ok: false, error: '未登录', code: 'AUTH_REQUIRED' } };
  }
  const validated = validatePhotoCreatePayload(options.body, options.supabaseUrl);
  if (!validated.ok) {
    return { status: 400, body: { ok: false, error: validated.error, code: validated.code || 'INVALID_INPUT' } };
  }
  const uploadId = validated.uploadId;
  const createActorKeyFn = typeof options.createActorKey === 'function' ? options.createActorKey : (crypto.randomUUID ? function() { return crypto.randomUUID(); } : function() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); });
  const actorKey = 'photo_' + (uploadId || createActorKeyFn());
  const storagePath = validated.storagePath;

  // 若提供了 upload_id, 先查询是否已存在 (幂等)
  if (uploadId) {
    const existing = await findExistingPhotoByActorKey(options.supabase, actorKey, options.userName);
    if (!existing.ok) {
      return { status: 503, body: { ok: false, error: 'Unable to verify the existing photo record', code: 'PHOTO_IDEMPOTENCY_LOOKUP_FAILED', retryable: true } };
    }
    if (existing.found && existing.data) {
      // ★ 检查旧记录引用的文件是否还存在
      var oldStoragePath = null;
      try {
        var content = JSON.parse(existing.data.content || '{}');
        oldStoragePath = content.storagePath || '';
      } catch (_) {}
      if (oldStoragePath) {
        var fileExists = false;
        var fileCheckError = null;
        try {
          var fileCheck = await storageObjectExists(options.supabase, 'uploads', oldStoragePath);
          fileExists = fileCheck.exists === true;
          if (!fileCheck.ok && fileCheck.error) fileCheckError = fileCheck.error;
        } catch (error) { fileCheckError = error; }
        if (fileCheckError) {
          return { status: 503, body: { ok: false, error: 'Unable to verify the existing photo file', code: 'PHOTO_FILE_CHECK_FAILED', retryable: true } };
        }
        if (!fileExists) {
          // 旧文件丢失，使用新文件路径更新记录
          try {
            var newContent = existing.data.content;
            var contentObj = {};
            try {
              contentObj = JSON.parse(newContent);
              contentObj.storagePath = storagePath;
              newContent = JSON.stringify(contentObj);
            } catch (_) {
              newContent = existing.data.content;
            }
            // ★ 必须检查 update 的 error 和返回的 data
            var updateResult = await options.supabase.from('posts').update({
              media_url: validated.mediaUrl,
              content: newContent
            }).eq('id', existing.data.id).select('id, media_url, content').maybeSingle();
            if (updateResult.error) {
              if (options.logger) options.logger.error('[PHOTO_REPAIR_UPDATE_FAILED]', updateResult.error);
              // Phase 5: 修复失败不返回正常成功，也不删除新文件（唯一可用文件）
              return { status: 500, body: { ok: false, error: '照片修复失败: 数据库更新错误', code: 'REPAIR_UPDATE_FAILED' } };
            } else if (updateResult.data) {
              // ★ 验证更新后的数据
              var updatedContent = {};
              try { updatedContent = JSON.parse(updateResult.data.content || '{}'); } catch (_) {}
              if (updateResult.data.media_url === validated.mediaUrl && updatedContent.storagePath === storagePath) {
                existing.data.media_url = validated.mediaUrl;
                existing.data.content = newContent;
                existing.data._repaired = true;
                return { status: 200, body: { ok: true, data: existing.data, idempotent: true, repaired: true } };
              }
              // Phase 5: 验证失败（数据不一致），不删除新文件，返回错误
              if (options.logger) options.logger.error('[PHOTO_REPAIR_VERIFY_FAILED]', { expected: { media_url: validated.mediaUrl, storagePath: storagePath }, got: { media_url: updateResult.data.media_url, content: updateResult.data.content } });
              return { status: 500, body: { ok: false, error: '照片修复失败: 数据验证不一致', code: 'REPAIR_VERIFY_FAILED' } };
             } else {
             return { status: 503, body: { ok: false, error: 'Photo repair was not confirmed', code: 'REPAIR_UPDATE_NOT_CONFIRMED', retryable: true } };
           }
           } catch (e) {
            // Phase 5: 异常时返回错误，不删除新文件
            if (options.logger) options.logger.error('[PHOTO_REPAIR_EXCEPTION]', e);
            return { status: 500, body: { ok: false, error: '照片修复异常: ' + (e && e.message || '未知错误'), code: 'REPAIR_EXCEPTION' } };
          }
        }
      }
      // 旧文件存在或无法确认，删除本次新文件，返回旧记录
      var derivativePaths = getPhotoDerivativePaths(storagePath);
      var existingPaths = collectPhotoRecordPaths(existing.data, options.supabaseUrl);
      var duplicatePaths = existingPaths.has(storagePath) ? [] : [storagePath, derivativePaths.thumbnailPath, derivativePaths.rotatedPath].filter(function (path) {
        return !existingPaths.has(path);
      });
      var duplicateCleanup = await cleanupPhotoPaths({
        supabase: options.supabase,
        logger: options.logger,
        cleanupPhotoId: actorKey
      }, duplicatePaths);
      if (!duplicateCleanup.ok && !duplicateCleanup.cleanup_pending) {
        return { status: 503, body: { ok: false, error: 'Photo cleanup is pending a retry', code: 'PHOTO_CLEANUP_QUEUE_FAILED', retryable: true } };
      }
      return { status: 200, body: { ok: true, data: existing.data, idempotent: true } };
    }
  }

  var thumbnail = null;
  if (typeof options.createThumbnail === 'function') {
    try {
      thumbnail = await options.createThumbnail({ supabase: options.supabase, supabaseUrl: options.supabaseUrl, storagePath: storagePath });
      var contentObj = JSON.parse(validated.content);
      contentObj.thumb = thumbnail.url || '';
      contentObj.thumbFileSize = Number.isSafeInteger(thumbnail.fileSize) ? thumbnail.fileSize : null;
      contentObj.width = thumbnail.width || null;
      contentObj.height = thumbnail.height || null;
      if (thumbnail.exif) contentObj.exif = thumbnail.exif;
      // Phase 5: 如果创建了旋转版，更新 media_url 指向旋转后的文件
      if (thumbnail.rotatedUrl) {
        validated.mediaUrl = thumbnail.rotatedUrl;
        contentObj.rotatedUrl = thumbnail.rotatedUrl;
        contentObj.rotatedPath = thumbnail.rotatedPath || '';
        contentObj.rotatedFileSize = thumbnail.rotatedFileSize;
      }
      validated.content = JSON.stringify(contentObj);
    } catch (error) {
      var failedDerivativePaths = getPhotoDerivativePaths(storagePath);
      var processingCleanup = await cleanupPhotoPaths(Object.assign({}, options, { cleanupPhotoId: actorKey }), [
        storagePath,
        failedDerivativePaths.thumbnailPath,
        failedDerivativePaths.rotatedPath
      ].concat(error && error.cleanupPaths || []));
      if (processingCleanup.queue_failed) {
        return { status: 503, body: { ok: false, error: 'Image processing failed and cleanup could not be queued', code: 'PHOTO_CLEANUP_QUEUE_FAILED', retryable: true } };
      }
      return { status: 422, body: { ok: false, error: '图片缩略图处理失败', code: 'IMAGE_PROCESSING_FAILED' } };
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

  // 插入失败：无论是否带 upload_id，都必须先确认数据库最终状态。
  // 网络超时可能发生在数据库已经提交之后；只有明确查到“没有记录”才允许
  // 删除刚上传的对象，否则会把已提交的照片变成悬空记录。
  const existing = await findExistingPhotoByActorKey(options.supabase, actorKey, options.userName);
  if (!existing.ok) {
    // The insert outcome is unknown. Keep the uploaded object so a retry or
    // the status endpoint can reconcile it instead of deleting a committed file.
    return { status: 503, body: { ok: false, error: 'Photo save outcome is unknown; please retry', code: 'PHOTO_COMMIT_UNKNOWN', retryable: true } };
  }
  if (existing.found && existing.data) {
    // 文件已被另一个请求上传成功：保留 storage 文件 (因为记录已存在)
    return { status: 200, body: { ok: true, data: existing.data, idempotent: true } };
  }

  // 真正失败: 清理 storage (幂等)
  var cleanupResult = await cleanupPhotoPaths(Object.assign({}, options, { cleanupPhotoId: actorKey }), [
    thumbnail && thumbnail.path,
    thumbnail && thumbnail.rotatedPath,
    storagePath
  ]);
  const isConflict = insertResult && insertResult.error && insertResult.error.code === '23505';
  const code = isConflict ? 'CONFLICT' : 'UPSTREAM_ERROR';
  if (cleanupResult.queue_failed) {
    return { status: 503, body: { ok: false, error: 'Photo save failed and cleanup could not be queued', code: 'PHOTO_CLEANUP_QUEUE_FAILED', retryable: true, cleanup_pending: false } };
  }
  return { status: 500, body: { ok: false, error: isConflict ? '数据已存在' : '照片保存失败', code: code } };
}

module.exports = {
  MAX_IMAGE_SIZE,
  parseStoragePhotoUrl,
  validatePhotoCreatePayload,
  createPhotoRecord,
  createPhotoThumbnail,
  cleanupStorageFile
};
