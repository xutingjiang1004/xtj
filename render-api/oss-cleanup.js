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

function postMeta(post) {
  let parsed = null;
  try { parsed = JSON.parse(String(post && post.content || '')); } catch (_) { parsed = null; }
  return parsed && parsed.__type === '__xtj_post_v2__' && parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : null;
}
function metaUrls(post) {
  const meta = postMeta(post);
  if (!meta) return [];
  return (Array.isArray(meta.thumbs) ? meta.thumbs : []).concat([meta.poster_url]).filter(url => typeof url === 'string' && url);
}

// 收集一条帖子引用的全部 OSS 对象路径：media_url、附件、内容元数据里的缩略图与封面。
function collectPostOssPaths(post, attachmentRows) {
  const paths = new Set();
  if (!post) return [];
  pushPath(paths, post.media_url);
  for (const row of Array.isArray(attachmentRows) ? attachmentRows : []) pushPath(paths, row && row.media_url);
  metaUrls(post).forEach(url => pushPath(paths, url));
  return Array.from(paths).slice(0, MAX_OBJECTS);
}

// 缩略图、封面没有回退到 OSS 时存在 Supabase 的 uploads 桶里：缩略图走同源代理地址
// （/api/uploads/media?path=posts/thumb_<32 位十六进制>.jpg），封面是桶的公开地址（posters/…）。
// 路径格式固定，别的一律不认；这些路径要进删帖事务里的持久清理队列。
const THUMB_PATH = /^posts\/thumb_[0-9a-f]{32}\.jpg$/;
const POSTER_PATH = /^posters\/[a-zA-Z0-9_\u4e00-\u9fff.-]{1,200}$/;
function storagePathOfMetaUrl(value, supabaseOrigin) {
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.pathname === '/api/uploads/media') {
    const path = url.searchParams.get('path') || '';
    return THUMB_PATH.test(path) ? path : null;
  }
  const prefix = '/storage/v1/object/public/uploads/';
  if (!supabaseOrigin || url.origin !== supabaseOrigin || !url.pathname.startsWith(prefix)) return null;
  let path; try { path = decodeURIComponent(url.pathname.slice(prefix.length)); } catch (_) { return null; }
  return (POSTER_PATH.test(path) || THUMB_PATH.test(path)) && !path.includes('..') ? path : null;
}
function collectPostMetaStoragePaths(post, supabaseOrigin) {
  const paths = new Set();
  metaUrls(post).forEach(url => { const path = storagePathOfMetaUrl(url, supabaseOrigin); if (path) paths.add(path); });
  return Array.from(paths).slice(0, MAX_OBJECTS);
}

// 缩略图和封面的地址写在帖子内容里，内容是发帖人自己提交的：不能因为某条帖子「提到」了一个文件就删它。
// 只要还有别的帖子的内容提到同一个文件名，就一律不删（宁可少删，下划线在 LIKE 里是通配符，只会更保守）；查询失败也按「不删」处理。
async function unreferencedElsewhere(supabase, postId, paths) {
  const keep = [];
  for (const path of paths) {
    try {
      const name = path.slice(path.indexOf('/') + 1);
      const result = await supabase.from('posts').select('id').neq('id', postId).ilike('content', '%' + name + '%').limit(1);
      if (result && !result.error && Array.isArray(result.data) && result.data.length === 0) keep.push(path);
    } catch (_) { /* 查不清就不删 */ }
  }
  return keep;
}

// 删帖之前读出要清的对象路径（附件行会随帖子一起删）。返回 { oss, storage }：
//   oss      直传 OSS 的对象，帖子删除成功后尽力删除；
//   storage  留在 Supabase 的缩略图/封面，交给删帖事务排进持久清理队列。
// 读附件失败就只用帖子本身带的地址。
async function readPostCleanupPaths(supabase, post, postId, options) {
  let supabaseOrigin = '';
  try { supabaseOrigin = options && options.supabaseUrl ? new URL(options.supabaseUrl).origin : ''; } catch (_) { supabaseOrigin = ''; }
  let rows = [];
  try {
    const result = await supabase.from('post_attachments').select('media_url').eq('post_id', postId);
    if (result && !result.error && Array.isArray(result.data)) rows = result.data;
  } catch (_) { rows = []; }
  const all = collectPostOssPaths(post, rows);
  const metaOss = new Set(); metaUrls(post).forEach(url => pushPath(metaOss, url));
  const own = all.filter(path => !metaOss.has(path));
  // 同一路径既是媒体本身又出现在元数据里，仍按媒体本身处理（它不是靠元数据才被引用的）。
  const ownSet = new Set(own); const guardedOss = await unreferencedElsewhere(supabase, postId, Array.from(metaOss).filter(path => !ownSet.has(path)));
  const storage = await unreferencedElsewhere(supabase, postId, collectPostMetaStoragePaths(post, supabaseOrigin));
  return { oss: own.concat(guardedOss).slice(0, MAX_OBJECTS), storage };
}
async function readPostOssPaths(supabase, post, postId, options) { return (await readPostCleanupPaths(supabase, post, postId, options)).oss; }

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

module.exports = { collectPostOssPaths, collectPostMetaStoragePaths, readPostOssPaths, readPostCleanupPaths, deleteOssObjects, MAX_OBJECTS };
