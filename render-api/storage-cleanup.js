'use strict';

const crypto = require('crypto');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 与 server.js 的 STORAGE_CLEANUP_MAX_ATTEMPTS 对齐：合并/重排 job 时不再重置 attempts，
// 让 worker 的 attempts 上限判定能最终触发，避免"失败路径被反复并入并重置计数"导致无限重试。

function normalizePhotoId(value, bucket, paths) {
  const candidate = String(value || '').trim();
  if (UUID_RE.test(candidate)) return candidate.toLowerCase();
  const normalizedBucket = String(bucket || 'uploads');
  const normalizedPaths = normalizePaths(paths).slice().sort();
  const digest = crypto.createHash('sha256')
    .update(candidate + '\0' + normalizedBucket + '\0' + normalizedPaths.join('\0'))
    .digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    '5' + digest.slice(13, 16),
    ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + digest.slice(18, 20),
    digest.slice(20, 32)
  ].join('-');
}

function normalizePaths(paths) {
  const seen = new Set();
  return (Array.isArray(paths) ? paths : []).filter(function (value) {
    const path = String(value || '').trim().replace(/^\/+/, '');
    if (!path || path.indexOf('..') >= 0 || path.indexOf('\\') >= 0 || seen.has(path)) return false;
    seen.add(path);
    return true;
  }).map(function (value) { return String(value).trim().replace(/^\/+/, ''); });
}

function errorMessage(error) {
  return String(error && (error.message || error.error || error.statusText) || '').trim();
}

function isNotFoundError(error) {
  const msg = errorMessage(error);
  if (!msg) return false;
  // M-4b: 仅对象级 404 视为"已删除"；Bucket not found / 网关错误不能当作删除成功
  if (/BucketNotFound|Bucket not found/i.test(msg)) return false;
  const statusCode = String((error && (error.statusCode || error.code)) || '');
  if (statusCode === '404' && /NotFound|NoSuchKey|does not exist/i.test(msg)) return true;
  return /does not exist|no such object|NoSuchKey/i.test(msg);
}

async function enqueueStorageCleanupJob(supabase, options) {
  options = options || {};
  const paths = normalizePaths(options.paths);
  if (!paths.length) return { ok: true, queued: false, failed: false, paths: [] };
  if (!supabase || typeof supabase.rpc !== 'function') {
    return { ok: false, queued: false, failed: true, paths,
      error: { code: 'SUPABASE_UNAVAILABLE', message: 'Atomic storage cleanup queue is unavailable' } };
  }
  // The RPC merges paths under the row lock. SELECT + UPDATE loses concurrent
  // additions across instances; deliberately do not fall back to that sequence.
  try {
    const result = await supabase.rpc('enqueue_storage_cleanup', {
      p_photo_id: normalizePhotoId(options.photoId, options.bucket, paths),
      p_bucket: String(options.bucket || 'uploads'),
      p_paths: paths,
      p_last_error: String(options.lastError || '').slice(0, 1000) || null
    });
    if (!result || result.error || !result.data || result.data.ok !== true || result.data.queued !== true) {
      return { ok: false, queued: false, failed: true, paths,
        error: result && result.error || { code: 'QUEUE_INSERT_NOT_CONFIRMED', message: 'Atomic cleanup queue update was not confirmed' } };
    }
    return Object.assign({}, result.data, { ok: true, queued: true, failed: false });
  } catch (error) { return { ok: false, queued: false, failed: true, paths, error }; }
}

async function removeStorageWithQueue(supabase, options) {
  options = options || {};
  const paths = normalizePaths(options.paths);
  if (!paths.length) return { ok: true, removed: true, cleanup_pending: false, paths: [] };
  if (!supabase || !supabase.storage || typeof supabase.storage.from !== 'function') {
    return {
      ok: false,
      removed: false,
      cleanup_pending: false,
      queue_failed: true,
      paths: paths,
      error: { code: 'SUPABASE_UNAVAILABLE', message: 'Storage cleanup is unavailable' }
    };
  }
  let removal;
  try {
    removal = await supabase.storage.from(String(options.bucket || 'uploads')).remove(paths);
  } catch (error) {
    removal = { error: error };
  }
  if (removal && !removal.error) {
    // M-3b: 校验实际删除结果——remove 对不存在对象不报错，部分失败仅返回已删列表。
    // data 为空数组（对象本就不存在）视为全部成功，不应视为部分失败去重排队。
    const removedEntries = Array.isArray(removal.data) ? removal.data : [];
    if (!removedEntries.length) {
      return { ok: true, removed: true, cleanup_pending: false, paths: paths };
    }
    // remove 返回项可能只含 basename（如 "abc.webp"）也可能含完整路径。
    // 审计 🟡：basename 跨目录同名文件（photos/a/x.webp vs photos/b/x.webp）会互相
    // 抵消导致"未删文件被误判已删"→ 孤儿永不被清理。修复：优先按完整路径精确匹配；
    // basename 兜底仅当返回项不含目录、且该 basename 在请求路径中唯一时启用。
    const removedMatches = removedEntries.map(function(item) {
      const raw = String(item && (item.name || item.path) || '').trim().replace(/^\/+/, '');
      if (!raw) return null;
      return { full: raw, base: raw.split('/').pop(), hasDir: raw.indexOf('/') >= 0 };
    }).filter(Boolean);
    const baseCount = {};
    paths.forEach(function(p) {
      const base = String(p).trim().replace(/^\/+/, '').split('/').pop();
      baseCount[base] = (baseCount[base] || 0) + 1;
    });
    const remaining = paths.filter(function(p) {
      const clean = String(p).trim().replace(/^\/+/, '');
      const idx = removedMatches.findIndex(function(m) {
        if (m.full === clean) return true;
        if (!m.hasDir && m.base === clean.split('/').pop() && baseCount[m.base] === 1) return true;
        return false;
      });
      if (idx === -1) return true;
      removedMatches.splice(idx, 1);
      return false;
    });
    if (!remaining.length) {
      return { ok: true, removed: true, cleanup_pending: false, paths: paths };
    }
    // 仅真正未删掉的路径才重新入队
    const queue = await enqueueStorageCleanupJob(supabase, {
      bucket: options.bucket || 'uploads',
      paths: remaining,
      photoId: options.photoId,
      lastError: 'partial_remove_' + remaining.length + '_of_' + paths.length
    });
    return {
      ok: queue.ok,
      removed: false,
      cleanup_pending: queue.ok,
      queue_failed: !queue.ok,
      paths: remaining,
      error: { code: 'STORAGE_PARTIAL_DELETE', message: 'Storage deleted ' + (paths.length - remaining.length) + ' of ' + paths.length + ' objects; remaining requeued' },
      queue: queue
    };
  }
  if (removal && removal.error && isNotFoundError(removal.error)) {
    return { ok: true, removed: true, cleanup_pending: false, paths: paths };
  }

  const removalError = removal && removal.error
    ? removal.error
    : { code: 'STORAGE_DELETE_NOT_CONFIRMED', message: 'Storage deletion was not confirmed' };

  const queue = await enqueueStorageCleanupJob(supabase, {
    bucket: options.bucket || 'uploads',
    paths: paths,
    photoId: options.photoId,
    lastError: errorMessage(removalError) || 'storage_delete_not_confirmed'
  });
  return {
    ok: queue.ok,
    removed: false,
    cleanup_pending: queue.ok,
    queue_failed: !queue.ok,
    paths: paths,
    error: removalError,
    queue: queue
  };
}

module.exports = {
  normalizePaths,
  normalizePhotoId,
  isNotFoundError,
  enqueueStorageCleanupJob,
  removeStorageWithQueue
};
