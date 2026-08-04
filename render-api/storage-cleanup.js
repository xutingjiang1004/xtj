'use strict';

const crypto = require('crypto');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return /not.?found|does not exist|no such|404/i.test(errorMessage(error));
}

async function enqueueStorageCleanupJob(supabase, options) {
  options = options || {};
  const paths = normalizePaths(options.paths);
  if (!paths.length) return { ok: true, queued: false, failed: false, paths: [] };
  if (!supabase || typeof supabase.from !== 'function') {
    return { ok: false, queued: false, failed: true, paths: paths, error: { code: 'SUPABASE_UNAVAILABLE', message: 'Storage cleanup queue is unavailable' } };
  }

  // storage_cleanup_jobs.photo_id is UUID-typed. Photo rollback callers may
  // pass an actor key such as photo_<upload-id>; map that key deterministically
  // instead of allowing a PostgreSQL 22P02 to discard the cleanup request.
  const photoId = normalizePhotoId(options.photoId, options.bucket, paths);
  const payload = {
    photo_id: photoId,
    bucket: String(options.bucket || 'uploads'),
    paths: paths,
    status: 'pending',
    attempts: 0,
    last_error: String(options.lastError || '').slice(0, 1000) || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  let result;
  try {
    result = await supabase.from('storage_cleanup_jobs').insert(payload).select('id,photo_id,paths').maybeSingle();
  } catch (error) {
    return { ok: false, queued: false, failed: true, paths: paths, error: error };
  }

  if (result && result.error && String(result.error.code || '') === '23505') {
    let existing;
    try {
      existing = await supabase.from('storage_cleanup_jobs').select('id,photo_id,paths,status,claim_token').eq('photo_id', photoId).maybeSingle();
    } catch (error) {
      return { ok: false, queued: false, failed: true, paths: paths, error: error };
    }
    if (existing && existing.error) return { ok: false, queued: false, failed: true, paths: paths, error: existing.error };
    if (existing && existing.data) {
      // 正在处理（processing）或已完成的 job 不能被并发重复提交强制重置：
      // 否则会打断持 claim_token 的 worker，导致无限重试循环。
      const existingStatus = String(existing.data.status || '');
      if (existingStatus === 'processing') {
        return { ok: true, queued: true, failed: false, duplicate: true, in_progress: true, jobId: existing.data.id, paths: paths };
      }
      if (existingStatus === 'completed' || existingStatus === 'failed') {
        // 终态 job 允许重新排队重试
        let update;
        try {
          update = await supabase.from('storage_cleanup_jobs').update({ status: 'pending', paths: paths, last_error: payload.last_error, updated_at: payload.updated_at, completed_at: null, claim_token: null, lease_until: null }).eq('id', existing.data.id).select('id').maybeSingle();
        } catch (error) {
          return { ok: false, queued: false, failed: true, paths: paths, error: error };
        }
        if (update && update.error) return { ok: false, queued: false, failed: true, paths: paths, error: update.error };
        if (!update || !update.data) return { ok: false, queued: false, failed: true, paths: paths, error: { code: 'QUEUE_UPDATE_NOT_CONFIRMED', message: 'Cleanup queue update was not confirmed' } };
        return { ok: true, queued: true, failed: false, duplicate: true, jobId: existing.data.id, paths: paths };
      }
      // pending / 其他状态：幂等合并，仅当路径不同时更新
      let update;
      try {
        update = await supabase.from('storage_cleanup_jobs').update({ status: 'pending', paths: paths, last_error: payload.last_error, updated_at: payload.updated_at, completed_at: null, claim_token: null, lease_until: null }).eq('id', existing.data.id).select('id').maybeSingle();
      } catch (error) {
        return { ok: false, queued: false, failed: true, paths: paths, error: error };
      }
      if (update && update.error) return { ok: false, queued: false, failed: true, paths: paths, error: update.error };
      if (!update || !update.data) return { ok: false, queued: false, failed: true, paths: paths, error: { code: 'QUEUE_UPDATE_NOT_CONFIRMED', message: 'Cleanup queue update was not confirmed' } };
      return { ok: true, queued: true, failed: false, duplicate: true, jobId: existing.data.id, paths: paths };
    }
  }

  if (result && result.error) return { ok: false, queued: false, failed: true, paths: paths, error: result.error };
  if (!result || !result.data) return { ok: false, queued: false, failed: true, paths: paths, error: { code: 'QUEUE_INSERT_NOT_CONFIRMED', message: 'Cleanup queue insert was not confirmed' } };
  return { ok: true, queued: true, failed: false, jobId: result.data.id, paths: paths };
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
    return { ok: true, removed: true, cleanup_pending: false, paths: paths };
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
