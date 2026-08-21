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
// 照片墙只接受位图图片；SVG 可内嵌 <script>/onload，上传后原图 URL 直接打开即存储型 XSS 载体，显式拒绝。
// 收紧为常见图片类型精确白名单，不再允许任意长后缀（如 image/jpegmalware）。
// 服务端仍以 sharp 解码出的真实格式兜底校验（见 createPhotoThumbnail 的 M-8a）。
const IMAGE_MIME_TYPE = /^image\/(?:jpeg|png|webp|gif|avif|heic|heif|bmp|tif|tiff|x-ms-bmp)$/i;

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
// 注意：Supabase list 返回的文件项有 id、文件夹项 id 为 null（FileObject.id 语义）。
async function storageObjectExists(supabase, bucket, path) {
  if (!supabase || !path) return { ok: false, exists: false, error: null };
  try {
    var cleanPath = String(path).replace(/^\/+/, '');
    var parts = cleanPath.split('/');
    var name = parts.pop();
    var directory = parts.join('/');
    var result = await supabase.storage.from(bucket).list(directory, { limit: 1000, search: name });
    if (result.error) return { ok: false, exists: false, error: result.error };
    // 文件项有 id（目录项 id 为 null），精确名命中即可判定文件存在
    var foundItem = (result.data || []).find(function(item) {
      return item && item.name === name && !!item.id;
    });
    if (foundItem) {
      // 顺带返回真实文件大小，供调用方在下载前做体积预检（避免全量下载导致 OOM）
      var fileSize = null;
      try {
        var meta = foundItem.metadata || {};
        if (Number.isSafeInteger(meta.size) && meta.size >= 0) fileSize = meta.size;
      } catch (_) {}
      return { ok: true, exists: true, error: null, size: fileSize };
    }
    // 精确名未命中（list search 是模糊匹配，可能截断），再尝试 info() 做 HEAD 级验证。
    // info() 只取对象元数据，禁止 download() 全量下载仅为了判存在（超大对象会拖垮内存）。
    var probe = await supabase.storage.from(bucket).info(cleanPath);
    if (probe && probe.error) {
      var code = String(probe.error.statusCode || probe.error.code || probe.error.message || '');
      if (/404|not.?found|NoSuchKey/i.test(code)) return { ok: true, exists: false, error: null };
      return { ok: false, exists: false, error: probe.error };
    }
    if (probe && probe.data) {
      // 顺带返回真实文件大小，供调用方在下载前做体积预检（避免全量下载导致 OOM）
      var probeSize = null;
      try {
        var probeMeta = probe.data;
        var nestedMeta = probeMeta.metadata && typeof probeMeta.metadata === 'object' ? probeMeta.metadata : null;
        if (nestedMeta && Number.isSafeInteger(nestedMeta.size)) probeSize = nestedMeta.size;
        else if (Number.isSafeInteger(probeMeta.size)) probeSize = probeMeta.size;
      } catch (_) {}
      return { ok: true, exists: true, error: null, size: probeSize };
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

// H-8: 把存储对象的公网 URL（https://<supabase>/storage/v1/object/public/uploads/<path>）
// 反解为 storage path，避免把 URL 直接当 remove() 路径导致缩略图成为删不掉的孤儿。
function storageUrlToStoragePath(url, supabaseUrl) {
  if (typeof url !== 'string' || !url) return null;
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return null;
  try {
    var parsed = new URL(url);
    if (supabaseUrl) {
      var expectedOrigin = new URL(supabaseUrl).origin;
      if (parsed.origin !== expectedOrigin) return null;
    }
    var match = parsed.pathname.match(/\/storage\/v1\/object\/public\/uploads\/(.+)$/);
    if (!match || !match[1]) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return null; }
  } catch (_) {
    return null;
  }
}

function collectPhotoRecordPaths(record, supabaseUrl) {
  var paths = new Set();
  function add(value) {
    if (typeof value !== 'string' || !value.trim()) return;
    var path = value.trim().replace(/^\/+/, '');
    // 完整 URL（thumb/rotated 历史字段）先反解为对象路径
    var resolved = storageUrlToStoragePath(value, supabaseUrl) || path;
    paths.add(resolved);
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
  // M-10: 给瞬态错误打标记——源探测/下载失败是网络抖动，不应删除用户原图
  var sourceError = new Error('thumbnail source unavailable');
  sourceError.transient = true;
  var tooLargeError = new Error('thumbnail source too large');
  tooLargeError.code = 'PHOTO_SOURCE_TOO_LARGE';
  // H-6: 下载前先用 list/HEAD 探测对象真实大小，超过上限直接拒绝，
  // 避免把超大对象全量读入内存后才检查（OOM 发生在校验之前）。
  var sizeProbe = await storageObjectExists(options.supabase, 'uploads', storagePath);
  if (!sizeProbe.ok && sizeProbe.error) throw sourceError;
  if (Number.isSafeInteger(sizeProbe.size) && sizeProbe.size > MAX_IMAGE_SIZE) {
    throw tooLargeError;
  }
  var downloaded = await options.supabase.storage.from('uploads').download(storagePath);
  if (!downloaded || downloaded.error || !downloaded.data) throw sourceError;
  // 探测失败（size 为 null）时不再降级为全量下载：改为流式限量读取，逐块累计，
  // 超 MAX_IMAGE_SIZE 立即 cancel() 并抛错，OOM 防护与探测结果解耦（审计 🟠）
  var blobLike = downloaded.data;
  if (blobLike && Number.isSafeInteger(blobLike.size) && blobLike.size > MAX_IMAGE_SIZE) {
    throw tooLargeError;
  }
  var input;
  var stream = (blobLike && typeof blobLike.getReader === 'function') ? blobLike
    : (blobLike && typeof blobLike.stream === 'function' ? blobLike.stream() : null);
  if (stream && typeof stream.getReader === 'function') {
    var reader = stream.getReader();
    var chunks = [];
    var totalBytes = 0;
    var overLimit = false;
    try {
      while (true) {
        var read = await reader.read();
        if (read.done) break;
        if (!read.value) continue;
        totalBytes += read.value.byteLength;
        if (totalBytes > MAX_IMAGE_SIZE) { overLimit = true; break; }
        chunks.push(Buffer.from(read.value));
      }
    } finally {
      try { if (overLimit) await reader.cancel(); } catch (_) {}
      try { if (typeof reader.releaseLock === 'function') reader.releaseLock(); } catch (_) {}
    }
    if (overLimit) throw tooLargeError;
    input = Buffer.concat(chunks, totalBytes);
  } else {
    // 兜底：无 ReadableStream 能力的客户端（极少见），保留全量读取 + 大小校验
    input = Buffer.from(await blobLike.arrayBuffer());
  }
  // 服务端核对真实文件大小：客户端声称值不可信，防止超大文件/解压炸弹拖垮内存（下载后兜底校验）
  if (input.length > MAX_IMAGE_SIZE) {
    throw tooLargeError;
  }
  // 限制解码像素总量，防止高维"解压炸弹"图片耗尽内存（默认约 1.6 亿像素上限，这里收紧到 1 亿）
  var image = options.sharp(input, { animated: false, limitInputPixels: 100000000 });
  var meta = await image.metadata();
  // M-8a: 用 sharp 解码出的真实格式校验（客户端声明的 mime_type 不可信）。
  // SVG 可内嵌脚本，直接打开原图 URL 即存储型 XSS 载体——即使客户端伪报
  // mime_type 也必须拒绝，非瞬态错误会触发 422 清理原图。
  if (meta && meta.format && String(meta.format).toLowerCase() === 'svg') {
    throw new Error('thumbnail source unsupported');
  }
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
      // H-7: 旋转分支与缩略图分支一致，限制解码像素总量并对输出尺寸设上限
      // （最长边 4096），防止高分辨率 EXIF 图全分辨率解码产生 GB 级缓冲
      var rotatedImage = options.sharp(input, { animated: false, limitInputPixels: 100000000 })
        .rotate()
        .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 });
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
    if (result && result.data) return { ok: true, found: true, data: result.data, error: null };
    // ★ 存量兼容：新格式 photo_<ns>_<uploadId> 未命中时，回退匹配旧格式 photo_<uploadId>
    // （升级前已存在的记录仍是旧格式，避免同 uploadId 重试插入重复照片）
    if (typeof actorKey === 'string' && actorKey.indexOf('photo_') === 0) {
      var secondUnderscore = actorKey.indexOf('_', 6);
      if (secondUnderscore > 0) {
        var legacyKey = 'photo_' + actorKey.slice(secondUnderscore + 1);
        if (legacyKey !== actorKey) {
          var legacyQuery = supabase.from('posts').select('id,user_name,media_url,content,created_at,views,actor_key').eq('actor_key', legacyKey);
          if (typeof userName === 'string' && userName) legacyQuery = legacyQuery.eq('user_name', userName);
          const legacyResult = await legacyQuery.maybeSingle();
          if (legacyResult && legacyResult.error) return { ok: false, found: false, error: legacyResult.error };
          if (legacyResult && legacyResult.data) return { ok: true, found: true, data: legacyResult.data, error: null };
        }
      }
    }
    return { ok: true, found: false, data: null, error: null };
  } catch (err) {
    return { ok: false, found: false, error: err };
  }
}

// ★ C-2/C-3 修复：查询引用指定 storagePath 的帖子记录。
// 照片走「客户端直传 public 桶 + 服务端事后登记」，服务端仅凭 URL 无法判断
// 文件归属；此函数用于在删除/改写文件前确认该路径是否已被其他（尤其是他人
// 的）帖子引用，防止借幂等分支把受害者原图当重复上传删除。
async function findStoragePathRefs(supabase, storagePath, excludeId) {
  try {
    if (!storagePath) return { ok: true, refs: [], total: 0, truncated: false, error: null };
    var cleanPath = String(storagePath).replace(/^\/+/, '');
    // content JSON 中序列化为 "storagePath":"photos/xxx"，用带引号的 token 精确匹配
    var contentToken = '"' + cleanPath + '"';
    // ILIKE 通配符 %/_ 与转义符 \ 在拼接前必须转义，否则路径中的这些字符会扩大/破坏匹配
    var escapedToken = String(contentToken).replace(/[\\%_]/g, function (m) { return '\\' + m; });
    var pattern = '%' + escapedToken + '%';
    // count:'exact' 让 total 反映全部命中数（limit 只截断 data，不截断计数）
    var query = supabase.from('posts').select('id,user_name', { count: 'exact' }).ilike('content', pattern);
    if (excludeId) query = query.neq('id', excludeId);
    var result = await query.limit(50);
    if (result && result.error) return { ok: false, refs: [], error: result.error };
    var refs = (result && result.data) || [];
    var total = Number.isSafeInteger(result.count) ? result.count : refs.length;
    return { ok: true, refs: refs, total: total, truncated: refs.length < total, error: null };
  } catch (err) {
    return { ok: false, refs: [], error: err };
  }
}

function hasOtherOwnerRef(refResult, userName) {
  if (!refResult) return false;
  // 引用数超过采样上限（limit 50）：截断后无法确认其余引用是否属于他人，
  // 保守判定"存在他人引用"，防止截断掩盖他人对受害者文件的引用导致误删。
  if (refResult.truncated === true) return true;
  return (refResult.refs || []).some(function (ref) { return ref && ref.user_name !== userName; });
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
  // ★ actorKey 带用户命名空间前缀：不同用户即使提交相同 uploadId，幂等键也不会互相冲突/串号
  const userNamespace = crypto.createHash('sha256').update(String(options.userName)).digest('hex').slice(0, 12);
  const actorKey = 'photo_' + userNamespace + '_' + (uploadId || createActorKeyFn());
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
          // ★ C-3 修复：新路径若已被其他用户引用，禁止把他人照片文件
          //   绑定进自己的记录（否则删自己帖子会连带删除受害者原图）
          var repairRefs = await findStoragePathRefs(options.supabase, storagePath, existing.data.id);
          if (!repairRefs.ok) {
            return { status: 503, body: { ok: false, error: 'Unable to verify photo ownership', code: 'PHOTO_OWNERSHIP_CHECK_FAILED', retryable: true } };
          }
          if (hasOtherOwnerRef(repairRefs, options.userName)) {
            return { status: 409, body: { ok: false, error: '图片已被其他帖子使用，无法关联', code: 'PHOTO_ALREADY_REFERENCED' } };
          }
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
      // ★ C-2 修复：提交的 storagePath 若已被其他用户帖子引用（受害者照片），
      //   绝不能删除——攻击者用 upload_id 幂等命中自己的记录后提交他人文件
      //   URL，会让这里把受害者原图当"重复上传的新文件"清掉
      var duplicateRefs = await findStoragePathRefs(options.supabase, storagePath, existing.data.id);
      if (!duplicateRefs.ok) {
        return { status: 503, body: { ok: false, error: 'Unable to verify photo ownership', code: 'PHOTO_OWNERSHIP_CHECK_FAILED', retryable: true } };
      }
      if (hasOtherOwnerRef(duplicateRefs, options.userName)) {
        // 该文件属于其他用户的帖子，禁止删除；仅返回现有记录（幂等语义）
        return { status: 200, body: { ok: true, data: existing.data, idempotent: true } };
      }
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

  // ★ C-2/C-3 修复：首次创建前校验 storagePath 未被其他用户帖子引用，
  //   防止建帖引用他人照片文件（内容盗用 + 删帖连带删除他人原图）
  var createRefs = await findStoragePathRefs(options.supabase, storagePath, null);
  if (!createRefs.ok) {
    return { status: 503, body: { ok: false, error: 'Unable to verify photo ownership', code: 'PHOTO_OWNERSHIP_CHECK_FAILED', retryable: true } };
  }
  if (hasOtherOwnerRef(createRefs, options.userName)) {
    return { status: 409, body: { ok: false, error: '图片已被其他帖子使用，请重新上传', code: 'PHOTO_ALREADY_REFERENCED' } };
  }

  var thumbnail = null;
  if (typeof options.createThumbnail === 'function') {
    try {
      thumbnail = await options.createThumbnail({ supabase: options.supabase, supabaseUrl: options.supabaseUrl, storagePath: storagePath });
      var contentObj = JSON.parse(validated.content);
      contentObj.thumb = thumbnail.url || '';
      // H-8: 持久化缩略图 storage path，删除时才能正确移除（thumb 是 https URL，
      // 直接当 storage path 传 remove() 永删不掉，缩略图成公网孤儿）
      contentObj.thumbnailPath = thumbnail.path || '';
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
      // M-10: 瞬态失败（源探测/下载失败）属于网络抖动，保留原图并返回可重试错误，
      // 仅 sharp 解码/编码等确定性失败才清理原图与衍生物
      if (error && error.transient === true) {
        return { status: 503, body: { ok: false, error: '图片处理暂时不可用，请稍后重试', code: 'PHOTO_PROCESSING_RETRYABLE', retryable: true } };
      }
      var failedDerivativePaths = getPhotoDerivativePaths(storagePath);
      var failedCleanupPaths = [
        storagePath,
        failedDerivativePaths.thumbnailPath,
        failedDerivativePaths.rotatedPath
      ].concat(error && error.cleanupPaths || []);
      // ★ 审计 🟡 双引用竞态：创建失败要删除原图前，二次执行引用检查——
      // 首次检查（createRefs）到失败之间仍可能有人并发引用了同一 storagePath，
      // 此时必须保留原图（它属于他人帖子），只清理本次衍生的缩略图/旋转图。
      var failureRefs = await findStoragePathRefs(options.supabase, storagePath, null);
      if (!failureRefs.ok) {
        return { status: 503, body: { ok: false, error: 'Unable to verify photo ownership', code: 'PHOTO_OWNERSHIP_CHECK_FAILED', retryable: true } };
      }
      if (hasOtherOwnerRef(failureRefs, options.userName)) {
        failedCleanupPaths = failedCleanupPaths.filter(function (p) { return p !== storagePath; });
      }
      var processingCleanup = await cleanupPhotoPaths(Object.assign({}, options, { cleanupPhotoId: actorKey }), failedCleanupPaths);
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

  const isConflict = insertResult && insertResult.error && insertResult.error.code === '23505';
  if (isConflict) {
    // ★ 23505 冲突：本次提交的文件路径很可能已被他人（或己方先前）的记录引用，
    //   绝不对其执行 cleanupPhotoPaths——删除会连带破坏引用该文件的帖子。
    //   归属他人、归属本人或无法确认时统一保留文件，仅返回冲突错误。
    return { status: 500, body: { ok: false, error: '数据已存在', code: 'CONFLICT' } };
  }

  // 真正失败: 清理 storage (幂等)
  var insertFailPaths = [
    thumbnail && thumbnail.path,
    thumbnail && thumbnail.rotatedPath,
    storagePath
  ];
  // ★ 审计 🟡 双引用竞态：插入失败要删原图前二次引用检查，他人已并发引用时保留原图
  var insertFailRefs = await findStoragePathRefs(options.supabase, storagePath, null);
  if (!insertFailRefs.ok) {
    return { status: 503, body: { ok: false, error: 'Unable to verify photo ownership', code: 'PHOTO_OWNERSHIP_CHECK_FAILED', retryable: true } };
  }
  if (hasOtherOwnerRef(insertFailRefs, options.userName)) {
    insertFailPaths = insertFailPaths.filter(function (p) { return p !== storagePath; });
  }
  var cleanupResult = await cleanupPhotoPaths(Object.assign({}, options, { cleanupPhotoId: actorKey }), insertFailPaths);
  if (cleanupResult.queue_failed) {
    return { status: 503, body: { ok: false, error: 'Photo save failed and cleanup could not be queued', code: 'PHOTO_CLEANUP_QUEUE_FAILED', retryable: true, cleanup_pending: false } };
  }
  return { status: 500, body: { ok: false, error: '照片保存失败', code: 'UPSTREAM_ERROR' } };
}

module.exports = {
  MAX_IMAGE_SIZE,
  parseStoragePhotoUrl,
  validatePhotoCreatePayload,
  createPhotoRecord,
  createPhotoThumbnail,
  cleanupStorageFile
};
