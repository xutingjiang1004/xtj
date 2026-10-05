'use strict';
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XtjPostMedia = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  var MAX_POST_IMAGES = 18;
  var MAX_POST_FILE_BYTES = 50 * 1024 * 1024;
  function getPostMediaItems(post) {
    post = post || {};
    var list = Array.isArray(post.media_items) ? post.media_items : post.attachments;
    if (Array.isArray(list) && list.length) {
      return list.filter(function(item) { return item && typeof item.media_url === 'string' && item.media_url; })
        .map(function(item, index) { return Object.assign({}, item, { width: item.width || (!item.id && (post.media_width || post.width || (post._contentMeta && post._contentMeta.w))) || null,
          height: item.height || (!item.id && (post.media_height || post.height || (post._contentMeta && post._contentMeta.h))) || null,
          position: Number.isInteger(item.position) ? item.position : index }); })
        .sort(function(a, b) { return a.position - b.position; });
    }
    if (!post.media_url) return [];
    var meta = post._contentMeta || {};
    return [{ media_url: post.media_url, media_type: /^(video|audio)$/.test(post.media_type) ? post.media_type : 'image', position: 0,
      width: post.media_width || post.width || meta.w || null, height: post.media_height || post.height || meta.h || null,
      file_size: meta.fileSize || null }];
  }
  function gridColumns(count) { return count === 1 ? 1 : (count === 2 || count === 4 ? 2 : 3); }
  function validateSelection(files) {
    var list = Array.from(files || []);
    if (!list.length) return list;
    if (list.some(function(f) { return !f || !/^(image|video|audio)\//.test(f.type || '') || /\.(svgz?|html?|xml|swf)$/i.test(f.name || '') || /^image\/svg\+xml/i.test(f.type || ''); })) throw new Error('仅支持图片、视频或音频，不支持可执行文件');
    if (list.some(function(f) { return f.size > MAX_POST_FILE_BYTES; })) throw new Error('每个文件不能超过50MB');
    var images = list.every(function(f) { return f.type.startsWith('image/'); });
    if (!images && list.length > 1) throw new Error('视频或音频只能选择一个，不能与图片混合');
    if (images && list.length > MAX_POST_IMAGES) throw new Error('最多选择' + MAX_POST_IMAGES + '张图片');
    return list;
  }
  // Stop assigning new work after the first failure, but await every in-flight
  // upload before the caller cleans paths. Late uploads cannot recreate orphans.
  async function mapUploads(files, upload, concurrency) {
    var result = new Array(files.length), next = 0, failure = null;
    async function worker() {
      while (!failure && next < files.length) {
        var index = next++;
        try { result[index] = await upload(files[index], index); }
        catch (error) { if (!failure) failure = error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency || 3, files.length) }, worker));
    if (failure) throw failure;
    return result;
  }
  return { MAX_POST_IMAGES: MAX_POST_IMAGES, MAX_POST_FILE_BYTES: MAX_POST_FILE_BYTES, getPostMediaItems: getPostMediaItems,
    gridColumns: gridColumns, validateSelection: validateSelection, mapUploads: mapUploads };
});
