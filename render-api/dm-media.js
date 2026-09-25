'use strict';

const MAX_DM_MEDIA_SIZE = 50 * 1024 * 1024;
const DM_MEDIA_SEND_LEASE_MS = 5 * 60 * 1000;
const MEDIA_KINDS = {
  image: '__dm_img__',
  video: '__dm_vid__',
  audio: '__dm_aud__'
};

function validateDmStoragePath(value) {
  const storagePath = String(value || '').trim();
  if (!storagePath || storagePath.length > 256 || storagePath.indexOf('..') >= 0 || storagePath.indexOf('\\') >= 0 || storagePath.indexOf('?') >= 0 || storagePath.indexOf('#') >= 0) {
    return { ok: false, code: 'invalid_media_path', error: 'Invalid media path' };
  }
  // DM uploads are intentionally flat below chat/. This makes the owner
  // registry key exact and avoids directory enumeration or path traversal.
  if (!/^chat\/[A-Za-z0-9_-]{1,180}(?:\.[A-Za-z0-9]{1,12})?$/i.test(storagePath)) {
    return { ok: false, code: 'invalid_storage_scope', error: 'Media path is outside the private message scope' };
  }
  return { ok: true, storagePath: storagePath };
}

function validateDmMediaKind(kind, mimeType) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  // M-7c: 用 hasOwnProperty 做白名单判定，防止 kind='constructor'/'__proto__'
  // 沿原型链命中返回非字符串 actorPrefix
  if (!Object.prototype.hasOwnProperty.call(MEDIA_KINDS, normalizedKind)) return { ok: false, code: 'invalid_kind', error: 'Unsupported media kind' };
  const prefix = normalizedKind + '/';
  if (!new RegExp('^' + normalizedKind + '/[a-z0-9][a-z0-9!#$&^_.+\\-]{0,126}$', 'i').test(normalizedMime)) {
    return { ok: false, code: 'mime_mismatch', error: 'MIME type does not match media kind' };
  }
  // M-9c: SVG 可内嵌脚本，直接打开即存储型 XSS 载体，DM 与照片墙一致显式排除
  if (normalizedKind === 'image' && /^image\/svg(\+xml)?([;,]|$)/i.test(normalizedMime)) {
    return { ok: false, code: 'mime_mismatch', error: 'SVG media is not allowed' };
  }
  return { ok: true, kind: normalizedKind, mimeType: normalizedMime, actorPrefix: MEDIA_KINDS[normalizedKind], mimePrefix: prefix };
}

async function verifyStorageObject(supabase, storagePath, expected) {
  const parsed = validateDmStoragePath(storagePath);
  if (!parsed.ok) return parsed;
  if (!supabase || !supabase.storage || typeof supabase.storage.from !== 'function') {
    return { ok: false, state: 'query_failed', code: 'storage_unavailable', error: 'Storage verification is unavailable' };
  }
  const slash = parsed.storagePath.lastIndexOf('/');
  const directory = parsed.storagePath.slice(0, slash);
  const name = parsed.storagePath.slice(slash + 1);
  let result;
  try {
    // Search for the exact object in its parent directory. Do not enumerate
    // chat/ with a large limit: the folder may contain more than 1000 files.
    // 提高 limit 并对结果二次精确过滤，避免同前缀文件较多时真实对象被截断误判 not_found。
    result = await supabase.storage.from('uploads').list(directory, { limit: 1000, search: name });
  } catch (error) {
    return { ok: false, state: 'query_failed', code: 'storage_verify_failed', error: error };
  }
  if (result && result.error) return { ok: false, state: 'query_failed', code: 'storage_verify_failed', error: result.error };
  let item = (result && Array.isArray(result.data) ? result.data : []).find(function (row) { return row && row.name === name; });
  if (!item) {
    // list search 是模糊匹配且可能截断：用 HEAD（info）做精确探测，避免合法媒体被误判不存在。
    // M-6c: 不再用 download 兜底——全量拉取对象入内存只为读 size 是 DoS 向量。
    try {
      const probe = await supabase.storage.from('uploads').info(parsed.storagePath);
      if (probe && !probe.error && probe.data) {
        const probeMeta = probe.data;
        item = {
          name: name,
          metadata: {
            size: Number.isSafeInteger(probeMeta.size) ? probeMeta.size : null,
            mimetype: String(probeMeta.content_type || probeMeta.mime_type || probeMeta.metadata && probeMeta.metadata.mimetype || '')
          }
        };
      } else if (probe && probe.error && (String(probe.error.statusCode) === '404' || String(probe.error.status) === '404' || /not.?found/i.test(String(probe.error.message || probe.error.error || '')))) {
        return { ok: false, state: 'not_found', code: 'media_not_found', error: 'Media object does not exist' };
      } else {
        // ★ 非 404 的失败（5xx 网关错误/网络抖动）不能视为"对象不存在"，
        //   否则毒化行清理会误删合法注册行（含 sending 租约行）
        return { ok: false, state: 'query_failed', code: 'storage_verify_failed', error: probe && probe.error };
      }
    } catch (probeError) {
      return { ok: false, state: 'query_failed', code: 'storage_verify_failed', error: probeError };
    }
  }
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  if (!metadata) return { ok: false, state: 'invalid', code: 'media_metadata_missing', error: 'Media object metadata is missing' };
  const rawSize = metadata.size !== undefined && metadata.size !== null ? metadata.size : metadata.contentLength;
  const size = Number(rawSize);
  if (!Number.isSafeInteger(size) || size < 0) {
    return { ok: false, state: 'invalid', code: 'media_size_unverified', error: 'Media object size could not be verified' };
  }
  if (size > MAX_DM_MEDIA_SIZE) return { ok: false, state: 'invalid', code: 'media_too_large', error: 'Media file is too large' };
  // 审计 🟡：MIME 归一——storage content_type 常见大小写/参数（;charset=...）差异，
  // split(';')[0] + trim + lowercase 后再精确比较，避免存储元数据正常波动误拒合法媒体
  const expectedMime = String(expected && (expected.mimeType || expected.mime_type) || '').trim().toLowerCase().split(';')[0].trim();
  const actualMime = String(metadata.mimetype || metadata.mimeType || metadata.contentType || '').trim().toLowerCase().split(';')[0].trim();
  if (expectedMime && (!actualMime || actualMime !== expectedMime)) {
    return { ok: false, state: 'invalid', code: 'media_mime_unverified', error: 'Media object MIME type does not match the registered upload' };
  }
  const expectedKind = String(expected && expected.kind || '').trim().toLowerCase();
  if (expectedKind && (!actualMime || actualMime.indexOf(expectedKind + '/') !== 0)) {
    return { ok: false, state: 'invalid', code: 'media_kind_unverified', error: 'Media object kind does not match the registered upload' };
  }
  const expectedSizeRaw = expected && (expected.sizeBytes !== undefined ? expected.sizeBytes : expected.size_bytes);
  const hasExpectedSize = expectedSizeRaw !== undefined && expectedSizeRaw !== null && expectedSizeRaw !== '';
  const expectedSize = hasExpectedSize ? Number(expectedSizeRaw) : null;
  if (hasExpectedSize && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_DM_MEDIA_SIZE)) {
    return { ok: false, state: 'invalid', code: 'media_size_unverified', error: 'Registered media size is invalid' };
  }
  if (hasExpectedSize && size !== expectedSize) {
    return { ok: false, state: 'invalid', code: 'media_size_mismatch', error: 'Media object size does not match the registered upload' };
  }
  return { ok: true, state: 'found', storagePath: parsed.storagePath, name: name, size: size, metadata: metadata };
}

async function claimDmMediaUpload(supabase, options, _retry) {
  options = options || {};
  const retry = Number(_retry || 0);
  const pathResult = validateDmStoragePath(options.storagePath);
  if (!pathResult.ok) return pathResult;
  const kindResult = validateDmMediaKind(options.kind, options.mimeType);
  if (!kindResult.ok) return kindResult;
  const uploader = String(options.uploader || '').trim();
  if (!uploader) return { ok: false, code: 'auth_required', error: 'Uploader is required' };
  const hasSize = options.sizeBytes !== undefined && options.sizeBytes !== null && options.sizeBytes !== '';
  const sizeBytes = hasSize ? Number(options.sizeBytes) : null;
  if (hasSize && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_DM_MEDIA_SIZE)) {
    return { ok: false, code: 'media_size_invalid', error: 'Media file size is invalid' };
  }

  let existing;
  try {
    existing = await supabase.from('dm_media_uploads').select('*').eq('storage_path', pathResult.storagePath).maybeSingle();
  } catch (error) {
    return { ok: false, state: 'query_failed', code: 'media_registry_query_failed', error: error };
  }
  if (existing && existing.error) return { ok: false, state: 'query_failed', code: 'media_registry_query_failed', error: existing.error };
  if (existing && existing.data) {
    const row = existing.data;
    if (String(row.uploader || '') !== uploader) return { ok: false, state: 'forbidden', code: 'media_not_owned', error: 'Media belongs to another user' };
    if (String(row.kind || '') !== kindResult.kind || String(row.mime_type || '').toLowerCase() !== kindResult.mimeType) {
      return { ok: false, state: 'invalid', code: 'media_metadata_mismatch', error: 'Media metadata does not match the registered upload' };
    }
    if (['deleted', 'cleanup_pending'].indexOf(String(row.status || '')) >= 0) {
      return { ok: false, state: 'invalid', code: 'media_not_available', error: 'Media upload is no longer available' };
    }
    // A registry row is not proof that the object still exists. Re-check the
    // exact Storage object before reusing an idempotent or attached row.
    const existingStorage = await verifyStorageObject(supabase, pathResult.storagePath, {
      kind: row.kind,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes
    });
    if (!existingStorage.ok) {
      // 注册行仍在但存储对象已被删除：该路径已被"毒化"。若属主本人且状态非
      // attached（尚未绑定已发送消息），删除注册行并落回下方全新 claim 流程
      // 重新登记，避免后续请求命中这条死行而永久失败。attached 行或删除失败时
      // 保守返回原状态。
      if (existingStorage.state === 'not_found' && String(row.status || '') !== 'attached') {
        try {
          const invalidation = await supabase.from('dm_media_uploads').delete().eq('id', row.id).eq('status', String(row.status || ''));
          if (invalidation && invalidation.error) {
            return { ok: false, state: 'query_failed', code: 'media_registry_invalidate_failed', error: invalidation.error };
          }
        } catch (error) {
          return { ok: false, state: 'query_failed', code: 'media_registry_invalidate_failed', error: error };
        }
        // 落空删除后走全新 claim 流程（下方 insert 分支）
      } else {
        return existingStorage;
      }
    } else {
      return { ok: true, state: 'found', data: row, idempotent: String(row.status || '') === 'attached' };
    }
  }

  const storageResult = await verifyStorageObject(supabase, pathResult.storagePath, {
    kind: kindResult.kind,
    mimeType: kindResult.mimeType,
    sizeBytes: sizeBytes
  });
  if (!storageResult.ok) return storageResult;
  let inserted;
  try {
    inserted = await supabase.from('dm_media_uploads').insert({
      storage_path: pathResult.storagePath,
      uploader: uploader,
      kind: kindResult.kind,
      mime_type: kindResult.mimeType,
      size_bytes: hasSize ? sizeBytes : (storageResult.size !== undefined ? storageResult.size : null),
      status: 'uploaded',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).select('*').maybeSingle();
  } catch (error) {
    return { ok: false, state: 'query_failed', code: 'media_registry_insert_failed', error: error };
  }
  if (inserted && inserted.error) {
    if (String(inserted.error.code || '') === '23505') {
      // M-11: 并发 23505 冲突重试必须有深度上限，防止极端并发下无限递归栈溢出
      if (retry >= 2) {
        return { ok: false, state: 'conflict', code: 'media_registry_conflict', error: 'Media registry insert conflicted after retries' };
      }
      return claimDmMediaUpload(supabase, options, retry + 1);
    }
    return { ok: false, state: 'query_failed', code: 'media_registry_insert_failed', error: inserted.error };
  }
  if (!inserted || !inserted.data) return { ok: false, state: 'query_failed', code: 'media_registry_insert_not_confirmed', error: 'Media registry insert was not confirmed' };
  return { ok: true, state: 'claimed', data: inserted.data, idempotent: false };
}

// Reserve the registry row before inserting the private-message post.  The
// upload registry is the concurrency authority: a second request must not be
// allowed to insert another post while the first request owns this media.
// `options.row` is the row already returned by claimDmMediaUpload, so callers
// can reconcile an already-attached row against the deterministic post key
// before taking a repair lease.
async function reserveDmMediaUpload(supabase, options) {
  options = options || {};
  let row = options.row || null;
  if (!row) {
    const claimed = await claimDmMediaUpload(supabase, options);
    if (!claimed.ok) return claimed;
    row = claimed.data;
  }
  if (!row || !row.id || !row.storage_path) {
    return { ok: false, state: 'query_failed', code: 'media_registry_row_invalid', error: 'Media registry row is invalid' };
  }

  const status = String(row.status || '');
  if (status === 'deleted' || status === 'cleanup_pending') {
    return { ok: false, state: 'invalid', code: 'media_not_available', error: 'Media upload is no longer available' };
  }
  // The row may have been loaded before the object was deleted. Validate the
  // exact path again immediately before taking a send lease.
  const storageResult = await verifyStorageObject(supabase, row.storage_path, {
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes
  });
  if (!storageResult.ok) return storageResult;
  if (status === 'attached' && options.allowAttachedRepair !== true) {
    return { ok: true, state: 'attached', data: row, idempotent: true };
  }
  if (status === 'sending') {
    const updatedAt = Date.parse(String(row.updated_at || ''));
    const stale = !Number.isFinite(updatedAt) || Date.now() - updatedAt >= DM_MEDIA_SEND_LEASE_MS;
    if (!stale) {
      return { ok: false, state: 'conflict', code: 'media_send_in_progress', data: row, error: 'Media message is already being sent' };
    }
    // A crashed request may leave a sending lease behind. Reclaim it only
    // when the lease is stale, and still require the old timestamp in the
    // predicate so two recovery requests cannot both take it over.
    let reclaim;
    try {
      const query = supabase.from('dm_media_uploads').update({
        status: 'sending',
        message_id: null,
        updated_at: new Date().toISOString()
      }).eq('id', row.id).eq('status', 'sending');
      // 审计 🟡：JS 的 toISOString() 只有毫秒精度，而 PostgreSQL timestamptz 是微秒精度，
      // 精确 .eq('updated_at', row.updated_at) 在精度差异下恒不匹配会导致租约无法回收、
      // 发送卡死到租约过期。改用 ±1ms 容差范围做 CAS：既允许微秒精度差异，
      // 又能在并发写入时间差 >1ms 时正确判定冲突。
      const casMs = Date.parse(String(row.updated_at || ''));
      if (Number.isFinite(casMs)) {
        query.gte('updated_at', new Date(casMs - 1).toISOString())
             .lte('updated_at', new Date(casMs + 1).toISOString());
      } else {
        // ★ CAS 修复：updated_at 不可解析时无法构造 CAS 谓词，绝不能跳过谓词直接
        //   按 id+status 回收——否则两个并发恢复请求会同时拿到租约（重复发送）。
        //   保守按冲突处理，等租约超时后由 updated_at 正常的行路径回收。
        return { ok: false, state: 'conflict', code: 'media_send_in_progress', data: row, error: 'Media message is already being sent' };
      }
      reclaim = await query.select('*').maybeSingle();
    } catch (error) {
      return { ok: false, state: 'query_failed', code: 'media_registry_reserve_failed', error: error };
    }
    if (reclaim && reclaim.error) return { ok: false, state: 'query_failed', code: 'media_registry_reserve_failed', error: reclaim.error };
    if (reclaim && reclaim.data) return { ok: true, state: 'reserved', data: reclaim.data, reclaimed: true };
    return { ok: false, state: 'conflict', code: 'media_send_in_progress', data: row, error: 'Media message is already being sent' };
  }

  const expectedStatus = status === 'attached' ? 'attached' : 'uploaded';
  if (status !== 'uploaded' && status !== 'attached') {
    return { ok: false, state: 'invalid', code: 'media_not_available', error: 'Media upload is not ready to send' };
  }
  let reserved;
  try {
    reserved = await supabase.from('dm_media_uploads').update({
      status: 'sending',
      message_id: null,
      updated_at: new Date().toISOString()
    }).eq('id', row.id).eq('status', expectedStatus).select('*').maybeSingle();
  } catch (error) {
    return { ok: false, state: 'query_failed', code: 'media_registry_reserve_failed', error: error };
  }
  if (reserved && reserved.error) return { ok: false, state: 'query_failed', code: 'media_registry_reserve_failed', error: reserved.error };
  if (reserved && reserved.data) return { ok: true, state: 'reserved', data: reserved.data };
  return { ok: false, state: 'conflict', code: 'media_send_in_progress', data: row, error: 'Media message is already being sent' };
}

// ===================== 私聊媒体上传配额（独立于照片墙） =====================
// 背景：私聊原本由前端直连 Supabase Storage 上传，服务端没有任何字节级约束。
// 改为后端上传后，必须给这条新通道配独立配额，否则等于开了个无上限的写入口。
//
// 审计红线：**绝不能复用照片墙的 tryConsumePhotoUploadQuota / acquirePhotoDecodeSlot**。
//   - 照片墙配额是 500MB/小时、按"上传的图片张数+缩略图"场景调的；私聊媒体含视频，
//     体积量级完全不同，共用会把两边互相拖垮（用户传个视频把照片墙额度耗光）。
//   - 两者共用一个 Map 还会让「私聊上传失败回滚」误减照片墙额度，账目跨域污染。
//   因此这里使用**完全独立的常量与 Map**，语义上与照片墙互不影响。
const DM_MEDIA_QUOTA_BYTES = 300 * 1024 * 1024; // 每用户每小时 300MB（含视频，故小于照片墙的 500MB）
const DM_MEDIA_QUOTA_WINDOW_MS = 60 * 60 * 1000;
// 并发闸取值依据：单请求上限 50MB，AI 聊天发图通常一次 1~3 张。
// 取 4 与照片墙保持同一数量级，正常使用不会误伤，最坏在途内存有界（~4×50MB）。
const DM_MEDIA_MAX_INFLIGHT_PER_USER = 4;
const dmMediaQuotaStore = new Map(); // userName -> { windowStart, bytes }
const dmMediaInflight = new Map();   // userName -> 在途请求数（归零即删除）

const dmMediaQuotaCleanupTimer = setInterval(function () {
  const cutoff = Date.now() - DM_MEDIA_QUOTA_WINDOW_MS;
  dmMediaQuotaStore.forEach(function (rec, user) {
    if (!rec || rec.windowStart < cutoff) dmMediaQuotaStore.delete(user);
  });
}, 300000);
if (dmMediaQuotaCleanupTimer && typeof dmMediaQuotaCleanupTimer.unref === 'function') dmMediaQuotaCleanupTimer.unref();

function dmMediaQuotaWindow(userName, now) {
  let rec = dmMediaQuotaStore.get(userName);
  if (!rec || (now - rec.windowStart) >= DM_MEDIA_QUOTA_WINDOW_MS) {
    rec = { windowStart: now, bytes: 0 };
    dmMediaQuotaStore.set(userName, rec);
  }
  return rec;
}

// 只读查询：用于接收 body **之前**用 Content-Length 做预检，不得创建记账记录。
function dmMediaQuotaRemainingBytes(userName) {
  const rec = dmMediaQuotaStore.get(userName);
  if (!rec || (Date.now() - rec.windowStart) >= DM_MEDIA_QUOTA_WINDOW_MS) return DM_MEDIA_QUOTA_BYTES;
  return Math.max(0, DM_MEDIA_QUOTA_BYTES - rec.bytes);
}

function tryConsumeDmMediaQuota(userName, bytes) {
  const rec = dmMediaQuotaWindow(userName, Date.now());
  if (rec.bytes + bytes > DM_MEDIA_QUOTA_BYTES) return false;
  rec.bytes += bytes;
  return true;
}

// 反向操作：被拒（校验失败 / 存储写入失败 / 并发闸 429）时回滚预占的字节数。
// 不能直接写 0 或删记录——并发请求可能已在同一窗口占用额度，粗暴清零会一起抹掉。
function refundDmMediaQuota(userName, bytes) {
  if (!bytes || bytes <= 0) return;
  const rec = dmMediaQuotaStore.get(userName);
  if (!rec) return;
  rec.bytes = Math.max(0, rec.bytes - bytes);
}

// 并发闸：拿不到名额直接拒绝，**不排队**——排队等于把 50MB 缓冲继续留在内存等着。
function acquireDmMediaSlot(userName) {
  const inFlight = dmMediaInflight.get(userName) || 0;
  if (inFlight >= DM_MEDIA_MAX_INFLIGHT_PER_USER) return null;
  dmMediaInflight.set(userName, inFlight + 1);
  let released = false;
  return function releaseDmMediaSlot() {
    if (released) return; // 幂等：重复释放会把同用户其它在途请求的名额减掉
    released = true;
    const cur = dmMediaInflight.get(userName) || 0;
    if (cur <= 1) dmMediaInflight.delete(userName);
    else dmMediaInflight.set(userName, cur - 1);
  };
}

// 存储路径归属绑定：要求 chat/<uidHash>_<...> 前缀与请求者一致。
// 与照片墙 photos/<uploadId>_ 的思路一致——让"猜路径抢占"在写入前就失败。
// uidHash 由调用方用 userName 的 sha256 前 12 位算出（与照片墙 ownerNs 同算法）。
function validateDmUploadOwnership(storagePath, uidHash) {
  const parsed = validateDmStoragePath(storagePath);
  if (!parsed.ok) return parsed;
  const prefix = 'chat/' + String(uidHash || '') + '_';
  if (!uidHash || parsed.storagePath.indexOf(prefix) !== 0 || parsed.storagePath.length <= prefix.length) {
    return { ok: false, code: 'media_not_owned', error: 'Media path is not bound to the requesting user' };
  }
  return { ok: true, storagePath: parsed.storagePath };
}

module.exports = {
  MAX_DM_MEDIA_SIZE,
  MEDIA_KINDS,
  validateDmStoragePath,
  validateDmMediaKind,
  validateDmUploadOwnership,
  verifyStorageObject,
  claimDmMediaUpload,
  reserveDmMediaUpload,
  DM_MEDIA_SEND_LEASE_MS,
  DM_MEDIA_QUOTA_BYTES,
  DM_MEDIA_QUOTA_WINDOW_MS,
  DM_MEDIA_MAX_INFLIGHT_PER_USER,
  dmMediaQuotaRemainingBytes,
  tryConsumeDmMediaQuota,
  refundDmMediaQuota,
  acquireDmMediaSlot
};
