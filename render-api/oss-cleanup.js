'use strict';
// 帖子删除后，直传 OSS 的原图、缩略图、封面不会被任何东西引用，却一直占着桶（决策文档里记的已知遗留）。
// 这里在帖子删除成功之后做「尽力而为」的清理：失败只记日志，绝不影响删帖结果和线上运行。
// 只删本站 OSS 桶里、属于这条帖子自己引用的对象；私聊桶永远不在 OSS，也不会出现在这里。
const ossMedia = require('./oss-media');
const { parseOssMediaUrl } = require('./post-media');

const MAX_OBJECTS = 60;

function pushPath(set, url) {
  const path = typeof url === 'string' ? parseOssMediaUrl(url) : null;
  if (path) set.add(path);
}

// 收集一条帖子引用的全部 OSS 对象路径：media_url、附件、内容元数据里的缩略图与封面。
function collectPostOssPaths(post, attachmentRows) {
  const paths = new Set();
  if (!post) return [];
  pushPath(paths, post.media_url);
  for (const row of Array.isArray(attachmentRows) ? attachmentRows : []) pushPath(paths, row && row.media_url);
  let parsed = null;
  try { parsed = JSON.parse(String(post.content || '')); } catch (_) { parsed = null; }
  const meta = parsed && parsed.__type === '__xtj_post_v2__' && parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : null;
  if (meta) {
    if (Array.isArray(meta.thumbs)) meta.thumbs.forEach(url => pushPath(paths, url));
    pushPath(paths, meta.poster_url);
  }
  return Array.from(paths).slice(0, MAX_OBJECTS);
}

// 删帖之前读出附件地址（附件行会随帖子一起删掉）。读失败就只用帖子本身带的地址。
async function readPostOssPaths(supabase, post, postId) {
  let rows = [];
  try {
    const result = await supabase.from('post_attachments').select('media_url').eq('post_id', postId);
    if (result && !result.error && Array.isArray(result.data)) rows = result.data;
  } catch (_) { rows = []; }
  return collectPostOssPaths(post, rows);
}

async function deleteOssObjects(paths, options) {
  const opts = options || {};
  const remove = opts.deleteObject || ossMedia.deleteObject;
  const enabled = opts.enabled || ossMedia.enabled;
  const log = opts.log || console;
  if (!Array.isArray(paths) || !paths.length || !enabled()) return { deleted: 0, failed: 0 };
  let deleted = 0, failed = 0;
  for (const path of paths) {
    try { await remove(path, opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : undefined); deleted += 1; }
    catch (error) { failed += 1; log.warn('[oss-cleanup] 删除 OSS 对象失败（忽略）:', path, error && error.message || error); }
  }
  return { deleted, failed };
}

module.exports = { collectPostOssPaths, readPostOssPaths, deleteOssObjects, MAX_OBJECTS };
