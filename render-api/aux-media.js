'use strict';
// 缩略图和视频封面的「放弃上传」回收。
//
// 原图走 /api/post/media/prepare 登记，放弃发布时由登记表清理；缩略图（posts/thumb_*.jpg）和封面（posters/…）
// 是前端发布时顺手多传的，没有任何登记，发布中途取消、失败或关页面都会在桶里留下没人引用的文件（孤儿）。
//
// 做法（不需要新表，复用 post_media_uploads，靠 upload_id 以 aux_ 开头区分）：
//   1. /api/oss/sign 给缩略图/封面路径签名时，先登记 {路径, 账号, aux_随机串, pending}；
//   2. 发帖成功后，把这条帖子内容里引用的缩略图/封面标记为 attached；
//   3. 清理任务（post-media.js 的 sweep）对超过 2 天仍是 pending 的 aux 行：再查一遍有没有任何帖子/附件/内容引用它，
//      没有才删 OSS 对象并删登记行；有引用就改标 attached。第 2 步的标记即使丢了，第 3 步的引用检查也不会误删线上的图。
// 只覆盖走 OSS 直传签名的对象；回退到 Supabase 存储的缩略图没有登记（那条路径不经过本站签名）。
const crypto = require('node:crypto');
const ossMedia = require('./oss-media');

const THUMB_PATH = /^posts\/thumb_[0-9a-f]{32}\.jpg$/;
const POSTER_PATH = /^posters\/[a-zA-Z0-9_一-鿿.-]{1,200}$/;
const AUX_PREFIX = 'aux_';
const AUX_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function isAuxPath(path) {
  return typeof path === 'string' && !path.includes('..') && (THUMB_PATH.test(path) || POSTER_PATH.test(path));
}
function isAuxUploadId(value) { return typeof value === 'string' && value.indexOf(AUX_PREFIX) === 0; }

// 登记一个即将上传的缩略图/封面。返回 { ok:true }、{ conflict:true }（路径已被别的账号登记）或 { error }。
async function registerAuxUpload(supabase, actor, path) {
  if (!actor || !isAuxPath(path)) return { error: new Error('not_an_aux_path') };
  const uploadId = AUX_PREFIX + crypto.randomBytes(16).toString('hex');
  const inserted = await supabase.from('post_media_uploads').insert({ storage_path: path, user_name: actor, upload_id: uploadId });
  if (inserted && !inserted.error) return { ok: true };
  if (inserted && inserted.error && String(inserted.error.code) === '23505') {
    const existing = await supabase.from('post_media_uploads').select('user_name').eq('storage_path', path).maybeSingle();
    if (!existing || existing.error) return { error: (existing && existing.error) || new Error('aux_lookup_failed') };
    return existing.data && existing.data.user_name === actor ? { ok: true } : { conflict: true };
  }
  return { error: (inserted && inserted.error) || new Error('aux_register_failed') };
}

// 帖子内容里引用的、属于缩略图/封面的 OSS 路径。
function auxPathsInContent(content) {
  let parsed = null;
  try { parsed = JSON.parse(String(content || '')); } catch (_) { return []; }
  const meta = parsed && parsed.__type === '__xtj_post_v2__' && parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : null;
  if (!meta) return [];
  const { parseOssMediaUrl } = require('./post-media');
  const urls = [].concat(Array.isArray(meta.thumbs) ? meta.thumbs : [], meta.poster_url ? [meta.poster_url] : []);
  const paths = new Set();
  for (const url of urls) {
    const path = typeof url === 'string' ? parseOssMediaUrl(url) : null;
    if (path && isAuxPath(path)) paths.add(path);
  }
  return Array.from(paths);
}

// 发帖成功后调用：把这条帖子引用的缩略图/封面标记为已使用。尽力而为，失败不影响发帖（清理任务有引用检查兜底）。
async function markAuxAttached(supabase, actor, postId, content) {
  const paths = auxPathsInContent(content);
  if (!paths.length || !actor || !postId) return 0;
  try {
    const result = await supabase.from('post_media_uploads')
      .update({ status: 'attached', attached_post_id: postId, updated_at: new Date().toISOString() })
      .eq('user_name', actor).like('upload_id', AUX_PREFIX + '%').in('storage_path', paths);
    if (result && result.error) throw result.error;
    return paths.length;
  } catch (error) {
    console.warn('[aux-media] 标记缩略图/封面已使用失败（清理任务会再核对引用）:', error && error.message || error);
    return 0;
  }
}

// 清理任务里处理一条 aux 登记行。返回处理结果字符串；删除失败会抛错，登记行保留到下一轮重试。
async function reclaimAuxUpload(supabase, row, options) {
  const opts = options || {};
  const now = opts.now === undefined ? Date.now() : opts.now;
  const enabled = opts.enabled || ossMedia.enabled;
  if (!row || !isAuxUploadId(row.upload_id) || !isAuxPath(row.storage_path)) return 'skipped';
  if (!(now - Date.parse(row.created_at) >= (opts.graceMs === undefined ? AUX_GRACE_MS : opts.graceMs))) return 'young';
  // OSS 没配置时既不能判断引用（要拼 OSS 地址），也删不了对象：留着，等配置好再处理。
  if (!enabled()) return 'disabled';
  const referencedElsewhere = opts.referencedElsewhere || require('./oss-cleanup').referencedElsewhere;
  const shared = await referencedElsewhere(supabase, [row.storage_path], NIL_UUID);
  if (shared.has(row.storage_path)) {
    const marked = await supabase.from('post_media_uploads').update({ status: 'attached', updated_at: new Date(now).toISOString() })
      .eq('storage_path', row.storage_path).eq('upload_id', row.upload_id);
    if (marked && marked.error) throw marked.error;
    return 'referenced';
  }
  await (opts.deleteObject || ossMedia.deleteObject)(row.storage_path); // 404 视为已删除
  const removed = await supabase.from('post_media_uploads').delete().eq('storage_path', row.storage_path).eq('upload_id', row.upload_id);
  if (removed && removed.error) throw removed.error;
  return 'reclaimed';
}

module.exports = { THUMB_PATH, POSTER_PATH, AUX_PREFIX, AUX_GRACE_MS, isAuxPath, isAuxUploadId, registerAuxUpload, auxPathsInContent, markAuxAttached, reclaimAuxUpload };
