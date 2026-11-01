'use strict';
const { MAX_POST_IMAGES, MAX_POST_FILE_BYTES, getPostMediaItems } = require('../js/post-media');
const { parsePostMediaUrl } = require('./post-media');
const FIELDS = 'id,post_id,position,media_type,media_url,width,height,file_size,created_at';
// 视频封面不走 post_attachments：数据库函数会把「带附件的帖子」强制写成 image，
// 视频帖一挂附件就变成图片帖。封面改成存在帖子内容的元数据里，读取时再取出来。
function contentPosterUrl(content) {
  let parsed;
  try { parsed = JSON.parse(String(content || '')); } catch (_) { return null; }
  if (!parsed || parsed.__type !== '__xtj_post_v2__' || !parsed.meta) return null;
  const url = typeof parsed.meta.poster_url === 'string' ? parsed.meta.poster_url.trim() : '';
  if (!url || url.length > 2048 || !/^https:\/\//i.test(url)) return null;
  // 只认存储里的 posts/ 图片，避免把任意地址渲染成封面。
  if (!/\/storage\/v1\/object\/public\/uploads\/posts\//.test(url) && !/\/api\/uploads\/media\?path=posts(%2F|\/)/i.test(url)) return null;
  return url;
}
function validatePostAttachments(value, origin) {
  if (value == null) return [];
  if (!Array.isArray(value) || !value.length || value.length > MAX_POST_IMAGES) throw Object.assign(new Error('图片数量无效，最多' + MAX_POST_IMAGES + '张'), { code: 'invalid_attachments' });
  const paths = new Set(), uploads = new Set();
  return value.map((item, position) => {
    const path = item && parsePostMediaUrl(item.media_url, origin);
    if (!path || path !== item.storage_path || item.media_type !== 'image' || typeof item.upload_id !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(item.upload_id) || paths.has(path) || uploads.has(item.upload_id)) throw Object.assign(new Error('图片上传登记无效'), { code: 'media_ownership' });
    paths.add(path); uploads.add(item.upload_id);
    if (!Number.isSafeInteger(item.file_size) || item.file_size <= 0 || item.file_size > MAX_POST_FILE_BYTES) throw Object.assign(new Error('图片大小无效'), { code: 'invalid_attachment_size' });
    const width = item.width == null ? null : item.width, height = item.height == null ? null : item.height;
    if ((width === null) !== (height === null) || (width !== null && (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000))) throw Object.assign(new Error('图片尺寸无效'), { code: 'invalid_attachment_dimensions' });
    return { position, media_type: 'image', media_url: item.media_url, storage_path: path, upload_id: item.upload_id, width, height, file_size: item.file_size };
  });
}
async function loadPostAttachments(db, posts) {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  // One indexed query for the entire visible page; paths/upload credentials are
  // never part of the public read projection.
  const result = await db.from('post_attachments').select(FIELDS).in('post_id', ids).order('position');
  if (result.error) throw Object.assign(new Error('帖子图片加载失败'), { code: 'attachments_unavailable' });
  const byPost = new Map();
  for (const item of result.data || []) { if (!byPost.has(item.post_id)) byPost.set(item.post_id, []); byPost.get(item.post_id).push(item); }
  return posts.map(post => {
    const rows = (byPost.get(post.id) || []).slice();
    const isVideo = String(post.media_type || '') === 'video';
    if (!isVideo) return Object.assign({}, post, { poster_url: null, media_items: getPostMediaItems(Object.assign({}, post, { media_items: rows })) });
    // 视频帖会把「自己截的第一帧」作为一张图片附件一起上传，用来当封面。
    // 它不是相册里的照片，必须从媒体列表里拆出来单独标记，否则信息流会把视频帖渲染成一张静图。
    const posterIndex = rows.findIndex(row => /^(image|photo)$/.test(String(row.media_type || '')));
    const poster = posterIndex >= 0 ? rows.splice(posterIndex, 1)[0] : null;
    // 视频本身不在 post_attachments 里（走 media_url），这里补回列表第 0 位，
    // 保证分享页 /api/post/:id/media/0 仍然是可播放的视频。
    const list = [{ media_url: post.media_url, media_type: 'video', position: 0,
      width: post.media_width || null, height: post.media_height || null, file_size: post.file_size || null }].concat(rows);
    if (poster) list.push(Object.assign({}, poster, { __poster: true }));
    list.forEach((item, index) => { item.position = index; });
    const items = getPostMediaItems(Object.assign({}, post, { media_items: list }));
    const marked = items.find(item => item.__poster);
    // 新视频帖的封面存在内容元数据里；老帖没有就是 null，由前端退回首帧。
    const posterUrl = marked ? marked.media_url : contentPosterUrl(post.content);
    return Object.assign({}, post, { poster_url: posterUrl || null, media_items: items });
  });
}
async function createPostWithAttachments(db, actor, payload, attachments) {
  const result = await db.rpc('create_post_with_attachments', { p_actor: actor, p_payload: payload, p_attachments: attachments, p_max_images: MAX_POST_IMAGES });
  if (result.error) return { data: null, error: result.error };
  const saved = result.data;
  if (!saved || !saved.ok || !saved.post) return { data: null, error: { code: saved && saved.code || 'media_attach_failed', message: '图片挂载失败，请重试' } };
  return { data: Object.assign({}, saved.post, { media_items: saved.attachments }), error: null, duplicate: saved.duplicate === true };
}
module.exports = { validatePostAttachments, loadPostAttachments, createPostWithAttachments };
