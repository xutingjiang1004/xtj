'use strict';
const { loadPostAttachments } = require('./post-attachments');
const { parsePostMediaUrl, parseOssMediaUrl } = require('./post-media');
// 评论区 @小猫 回复用：把帖子自带的图片（最多 3 张）交给视觉模型（OSS 图直接透传已校验公网地址，Supabase 图换 2 分钟签名链接）。
// 只取服务端保存的帖子附件，绝不取客户端给的地址；任何一步失败都只是“这次看不到图”，不影响文字回复。
const MAX_CAT_IMAGES = 3;
async function catPostImageParts({ post, supabase, supabaseUrl }) {
  try {
    if (!post || !['image', 'photo', 'album'].includes(String(post.media_type || '').trim().toLowerCase())) return [];
    const enriched = (await loadPostAttachments(supabase, [post]))[0];
    const images = (enriched.media_items || []).filter(item => item && ['image', 'photo'].includes(item.media_type)).slice(0, MAX_CAT_IMAGES);
    const origin = supabaseUrl ? new URL(supabaseUrl).origin : '';
    const parts = [];
    for (const item of images) {
      if (parseOssMediaUrl(item.media_url)) {
        parts.push({ type: 'image_url', image_url: { url: new URL(item.media_url).href } });
        continue;
      }
      if (!origin) continue;
      const path = parsePostMediaUrl(item.media_url, supabaseUrl);
      if (!path) continue;
      const signed = await supabase.storage.from('uploads').createSignedUrl(path, 120);
      const href = signed && signed.data && signed.data.signedUrl;
      if (!href) continue;
      const url = new URL(href);
      if (url.origin !== origin || url.protocol !== 'https:') continue;
      parts.push({ type: 'image_url', image_url: { url: url.href } });
    }
    return parts;
  } catch (_) { return []; }
}
module.exports = { catPostImageParts, MAX_CAT_IMAGES };
