'use strict';
// 帖子删除后，直传 OSS 的原图、缩略图、封面不会被任何东西引用，却一直占着桶（决策文档里记的已知遗留）。
// 这里在帖子删除成功之后做「尽力而为」的清理：失败只记日志，绝不影响删帖结果和线上运行。
// 只删本站 OSS 桶里、属于这条帖子自己引用的对象；私聊桶永远不在 OSS，也不会出现在这里。
//
// 2026-11-08 安全修复：帖子 content 是客户端自己写的 JSON，meta.thumbs / meta.poster_url
// 可以填成别人的 OSS 地址（信息流接口把地址公开返回），以前删帖会把这些地址当成「本帖自己的对象」
// 一并删掉 —— 任何登录用户都能删别人的媒体。现在有三道闸：
//   1. 原图和附件地址来自上传登记表校验过的 media_url / post_attachments，照旧信任；
//   2. 缩略图、封面来自客户端自填的元数据，只认「格式像自己产物」的路径：缩略图必须是
//      posts/thumb_<32 位十六进制>.jpg，封面必须以 <本帖作者>_ 开头（客户端用作者名生成）；
//   3. 所有候选路径删除前再查一次：还有别的帖子、附件或内容引用它就不删；查询失败也不删。
const ossMedia = require('./oss-media');
const { parseOssMediaUrl } = require('./post-media');

const MAX_OBJECTS = 60;
const { THUMB_PATH } = require('./aux-media');

// 与前端 buildStorageUploadPath 同一规则：作者名里非字母数字下划线汉字的字符换成 _，最多 32 位，再加 _。
function ownerPrefix(userName) {
  const base = String(userName || '').trim().replace(/[^a-zA-Z0-9_一-鿿]/g, '_').slice(0, 32);
  return base ? base + '_' : '';
}

function posterPathOwnedBy(path, userName) {
  const prefix = ownerPrefix(userName);
  if (!prefix) return false;
  return path.startsWith('posters/' + prefix) || (path.startsWith('posts/' + prefix) && /poster-/.test(path));
}

function pushPath(set, url, accept) {
  const path = typeof url === 'string' ? parseOssMediaUrl(url) : null;
  if (path && (!accept || accept(path))) set.add(path);
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
    if (Array.isArray(meta.thumbs)) meta.thumbs.forEach(url => pushPath(paths, url, path => THUMB_PATH.test(path)));
    pushPath(paths, meta.poster_url, path => posterPathOwnedBy(path, post.user_name));
  }
  return Array.from(paths).slice(0, MAX_OBJECTS);
}

function quote(value) {
  return '"' + String(value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 候选路径里，哪些还被「这条帖子以外」的记录引用。返回被引用的路径集合；任何一步失败都抛错，由调用方放弃删除。
async function referencedElsewhere(supabase, paths, postId) {
  const referenced = new Set();
  if (!paths.length) return referenced;
  const urls = paths.map(path => ossMedia.publicUrl(path));
  const byUrl = new Map(urls.map((url, index) => [url, paths[index]]));
  const rows = await supabase.from('posts').select('id,media_url').in('media_url', urls).neq('id', postId).limit(50);
  if (!rows || rows.error) throw (rows && rows.error) || new Error('reference_lookup_failed');
  for (const row of rows.data || []) if (byUrl.has(row.media_url)) referenced.add(byUrl.get(row.media_url));
  const attached = await supabase.from('post_attachments').select('post_id,media_url').in('media_url', urls).neq('post_id', postId).limit(50);
  if (!attached || attached.error) throw (attached && attached.error) || new Error('reference_lookup_failed');
  for (const row of attached.data || []) if (byUrl.has(row.media_url)) referenced.add(byUrl.get(row.media_url));
  // 缩略图和封面只存在别人帖子的 content 里：按路径模糊匹配，再在本地精确确认。
  const pending = paths.filter(path => !referenced.has(path));
  if (pending.length) {
    // 内容里的地址是 URL 编码过的（作者名可能含中文），两种写法都要查。
    const forms = path => Array.from(new Set([path, path.split('/').map(encodeURIComponent).join('/')]));
    const filter = pending.flatMap(path => forms(path).map(form => 'content.ilike.' + quote('%' + form + '%'))).join(',');
    const content = await supabase.from('posts').select('id,content').neq('id', postId).or(filter).limit(50);
    if (!content || content.error) throw (content && content.error) || new Error('reference_lookup_failed');
    for (const row of content.data || []) {
      const text = String(row.content || '');
      for (const path of pending) if (forms(path).some(form => text.includes(form))) referenced.add(path);
    }
  }
  return referenced;
}

// 删帖之前读出附件地址（附件行会随帖子一起删掉）。读失败就只用帖子本身带的地址。
// 返回的都是「可以安全删除」的路径：格式合法，且没有被别的帖子引用。
async function readPostOssPaths(supabase, post, postId) {
  let rows = [];
  try {
    const result = await supabase.from('post_attachments').select('media_url').eq('post_id', postId);
    if (result && !result.error && Array.isArray(result.data)) rows = result.data;
  } catch (_) { rows = []; }
  const candidates = collectPostOssPaths(post, rows);
  if (!candidates.length || !ossMedia.enabled()) return [];
  try {
    const shared = await referencedElsewhere(supabase, candidates, postId);
    return candidates.filter(path => !shared.has(path));
  } catch (error) {
    // 查不清楚就宁可留下孤儿文件，也不冒险删掉别人的媒体。
    console.warn('[oss-cleanup] 引用检查失败，本次不删除 OSS 对象:', error && error.message || error);
    return [];
  }
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

module.exports = { collectPostOssPaths, readPostOssPaths, referencedElsewhere, deleteOssObjects, ownerPrefix, MAX_OBJECTS, THUMB_PATH };
