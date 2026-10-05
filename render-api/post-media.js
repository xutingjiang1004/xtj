'use strict';
const { MAX_POST_IMAGES } = require('../js/post-media');
const { removeStorageWithQueue, enqueueStorageCleanupJob } = require('./storage-cleanup');
const PATH = /^posts\/[a-zA-Z0-9_\u4e00-\u9fff.-]{1,200}$/;
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
function validPath(value) { return typeof value === 'string' && PATH.test(value) && !value.includes('..'); }
function parsePostMediaUrl(value, origin) {
  let url, expected;
  try { url = new URL(value); expected = new URL(origin); } catch (_) { return null; }
  if (url.origin !== expected.origin || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  const prefix = '/storage/v1/object/public/uploads/';
  if (!url.pathname.startsWith(prefix)) return null;
  let path; try { path = decodeURIComponent(url.pathname.slice(prefix.length)); } catch (_) { return null; }
  return validPath(path) ? path : null;
}
function isLocalUploadUrl(value, origin) {
  try { const url = new URL(value); return url.origin === new URL(origin).origin && /^\/storage\/v1\/object\/(public|sign)\/uploads\//.test(url.pathname); }
  catch (_) { return false; }
}
async function checked(query) { const result = await query; if (!result || result.error) throw result && result.error || Error('post_media_unavailable'); return result.data; }
function installPostMedia(app, { supabase, authenticateUser, rateLimit, userBanError }) {
  let timer, busy = false, cursor = '';
  function unavailable(res) { return res.status(503).json({ ok: false, error: '媒体操作暂不可用，请重试', retryable: true }); }
  app.post('/api/post/media/prepare', authenticateUser, rateLimit(60000, MAX_POST_IMAGES * 4), async (req, res) => {
    const path = req.body && req.body.storage_path, uploadId = req.body && req.body.upload_id;
    if (!validPath(path) || typeof uploadId !== 'string' || !ID.test(uploadId)) return res.status(400).json({ ok: false, code: 'invalid_media_path' });
    const ban = userBanError(req); if (ban) return res.status(ban.status || 403).json({ ok: false, error: ban.message });
    try {
      let row = await checked(supabase.from('post_media_uploads').select('*').eq('storage_path', path).maybeSingle());
      if (!row) {
        const exists = await supabase.storage.from('uploads').exists(path);
        if (!exists || (exists.error && ![400, 404].includes(Number(exists.error.status || exists.error.statusCode)))) throw Error('storage_probe_failed');
        if (exists.data !== false) return res.status(409).json({ ok: false, code: 'media_path_exists' });
        const inserted = await supabase.from('post_media_uploads').insert({ storage_path: path, user_name: req.userName, upload_id: uploadId });
        if (!inserted || (inserted.error && inserted.error.code !== '23505')) throw inserted && inserted.error || Error('registry_insert_failed');
        row = await checked(supabase.from('post_media_uploads').select('*').eq('storage_path', path).maybeSingle());
      }
      if (!row || row.user_name !== req.userName || row.upload_id !== uploadId || row.status === 'cleanup') return res.status(403).json({ ok: false, code: 'media_ownership' });
      res.json({ ok: true, storage_path: path, upload_id: uploadId });
    } catch (_) { unavailable(res); }
  });
  app.post('/api/post/media/cleanup', authenticateUser, rateLimit(60000, MAX_POST_IMAGES * 4), async (req, res) => {
    const path = req.body && req.body.storage_path, uploadId = req.body && req.body.upload_id;
    if (!validPath(path) || typeof uploadId !== 'string' || !ID.test(uploadId)) return res.status(400).json({ ok: false, code: 'invalid_media_path' });
    try {
      // The database locks the same registry row as create_post_with_media.
      // Once marked cleanup, no concurrent create may claim this object.
      const claimed = await checked(supabase.rpc('claim_post_media_cleanup', { p_actor: req.userName, p_path: path, p_upload_id: uploadId }));
      if (!claimed || !claimed.ok) return res.status(403).json({ ok: false, code: claimed && claimed.code || 'media_ownership' });
      if (claimed.referenced) return res.json({ ok: true, referenced: true, cleanup_pending: false });
      const removed = await removeStorageWithQueue(supabase, { bucket: 'uploads', paths: [path], photoId: 'post-media:' + uploadId });
      if (!removed.ok) return unavailable(res);
      await checked(supabase.from('post_media_uploads').update({ cleaned_at: new Date().toISOString() }).eq('storage_path', path).eq('status', 'cleanup'));
      res.json({ ok: true, referenced: false, cleanup_pending: !!removed.cleanup_pending });
    } catch (_) { unavailable(res); }
  });
  async function tick() {
    if (busy) return; busy = true;
    try { cursor = await sweepPostMediaUploads(supabase, { cursor }); }
    catch (_) { console.warn('[post-media] abandoned upload cleanup will retry'); }
    finally { busy = false; }
  }
  return { start() { void tick(); timer = setInterval(tick, 60000); timer.unref(); }, stop() { clearInterval(timer); }, tick };
}
async function sweepPostMediaUploads(supabase, { cursor = '', now = Date.now(), limit = 50 } = {}) {
  // A full day of grace keeps ordinary slow uploads/retries safe. Attached
  // objects are protected again by the transactional cleanup check.
  let query = supabase.from('post_media_uploads').select('storage_path,user_name,upload_id,cleaned_at')
    .in('status', ['pending', 'cleanup']).lt('created_at', new Date(now - 86400000).toISOString())
    .order('storage_path', { ascending: true }).limit(limit);
  if (cursor) query = query.gt('storage_path', cursor);
  const rows = await checked(query) || [];
  for (const row of rows) {
    if (!validPath(row.storage_path)) continue;
    try {
      if (row.cleaned_at) {
        const account = await checked(supabase.from('posts').select('id').eq('user_name', row.user_name).eq('media_type', '__auth__').limit(1).maybeSingle());
        if (!account) await checked(supabase.from('post_media_uploads').delete().eq('storage_path', row.storage_path).eq('status', 'cleanup'));
        continue;
      }
      const claim = await checked(supabase.rpc('claim_post_media_cleanup', { p_actor: row.user_name, p_path: row.storage_path, p_upload_id: row.upload_id }));
      if (!claim || !claim.ok || claim.referenced) continue;
      const result = await removeStorageWithQueue(supabase, { bucket: 'uploads', paths: [row.storage_path], photoId: 'post-media:' + row.upload_id });
      if (!result.ok) throw Error('cleanup_queue_failed');
      const account = await checked(supabase.from('posts').select('id').eq('user_name', row.user_name).eq('media_type', '__auth__').limit(1).maybeSingle());
      if (!account) {
        await checked(supabase.from('post_media_uploads').delete().eq('storage_path', row.storage_path).eq('status', 'cleanup'));
        continue;
      }
      await checked(supabase.from('post_media_uploads').update({ cleaned_at: new Date(now).toISOString() }).eq('storage_path', row.storage_path).eq('status', 'cleanup'));
    } catch (_) { /* Tombstones remain fenced and are retried on the next pass. */ }
  }
  return rows.length < limit ? '' : rows[rows.length - 1].storage_path;
}
async function retireAccountPostMediaUploads(supabase, actor) {
  const paths = []; let cursor = '';
  while (true) {
    let query = supabase.from('post_media_uploads').select('storage_path').eq('user_name', actor).order('storage_path', { ascending: true }).limit(500);
    if (cursor) query = query.gt('storage_path', cursor);
    const rows = await checked(query) || [];
    const batch = rows.map(row => row.storage_path);
    if (batch.some(path => !validPath(path))) throw Error('unsafe_account_media_path');
    if (batch.length) {
      await checked(supabase.from('post_media_uploads').update({ status: 'cleanup' }).eq('user_name', actor).in('storage_path', batch));
      const queue = await enqueueStorageCleanupJob(supabase, { bucket: 'uploads', paths: batch, photoId: 'account-post-media:' + actor });
      if (!queue.ok) throw Error('account_media_queue_failed');
      paths.push(...batch); cursor = batch[batch.length - 1];
    }
    if (rows.length < 500) break;
  }
  return paths;
}
async function deleteQueuedAccountPostMediaUploads(supabase, actor, paths) {
  // Delete only the exact paths already fenced and durably queued. A prepare
  // arriving after retirement's last page must retain its registry for sweep.
  for (let offset = 0; offset < paths.length; offset += 500) {
    await checked(supabase.from('post_media_uploads').delete().eq('user_name', actor)
      .eq('status', 'cleanup').in('storage_path', paths.slice(offset, offset + 500)));
  }
  return { data: [], count: paths.length };
}
async function createPostWithMedia(supabase, actor, path, uploadId, payload) {
  const result = await supabase.rpc('create_post_with_media', { p_actor: actor, p_path: path, p_upload_id: uploadId, p_payload: payload });
  if (!result || result.error) return { error: result && result.error || { code: 'media_store_unavailable' } };
  const data = result.data;
  if (!data || !data.ok || !data.post) return { error: { code: data && data.code || 'media_ownership', message: '媒体登记已失效，请重新选择附件' } };
  return { data: data.post, error: null };
}
module.exports = { installPostMedia, createPostWithMedia, parsePostMediaUrl, isLocalUploadUrl, validPath, sweepPostMediaUploads, retireAccountPostMediaUploads, deleteQueuedAccountPostMediaUploads };
