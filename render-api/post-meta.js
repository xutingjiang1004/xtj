'use strict';
// 帖子 content 是客户端拼的 JSON（__xtj_post_v2__），其中 meta.thumbs / meta.poster_url 会被信息流
// 当作图片地址直接返回给所有浏览者。服务端以前原样存库，导致：
//   · 任意 https 地址可以当缩略图/封面（追踪图片、外链内容混进信息流）；
//   · 别人的 OSS 地址可以被写进来，配合删帖清理误删他人媒体（已在 oss-cleanup 里另外堵住）。
// 这里在发帖/改帖时清洗：只保留本站自己产生的几种地址形态，其余置空。内容没问题时原字符串原样返回。
const { parseOssMediaUrl } = require('./post-media');

const MAX_THUMBS = 9;
const MAX_URL = 2048;
const PROXY_PATH = /^\/api\/uploads\/media\?path=(?:posts|posters)(?:%2F|\/)[^&#]+$/i;
const SUPABASE_PUBLIC_PATH = /^\/storage\/v1\/object\/public\/uploads\/(?:posts|posters)\/[^?#]+$/;

// 允许的地址形态：本站 OSS 桶；本项目 Supabase 存储里的 posts/posters 公开地址；
// 本站同源的 /api/uploads/media 代理（相对路径，或主机是本站自己）。
function allowedMetaUrl(value, context) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL) return false;
  const options = context || {};
  if (value.charAt(0) === '/' && value.charAt(1) !== '/') return PROXY_PATH.test(value);
  if (parseOssMediaUrl(value)) return true;
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  try {
    if (options.supabaseUrl && url.origin === new URL(options.supabaseUrl).origin) return !url.search && SUPABASE_PUBLIC_PATH.test(url.pathname);
  } catch (_) { /* 配置异常时按不放行处理 */ }
  const hosts = (options.hosts || []).map(host => String(host || '').toLowerCase()).filter(Boolean);
  if (hosts.indexOf(url.host.toLowerCase()) >= 0) return PROXY_PATH.test(url.pathname + url.search);
  return false;
}

function sanitizePostContent(content, context) {
  const text = String(content == null ? '' : content);
  if (text.charAt(0) !== '{' && !/^\s*\{/.test(text)) return { content: text, changed: false };
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { return { content: text, changed: false }; }
  if (!parsed || parsed.__type !== '__xtj_post_v2__' || !parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta)) {
    return { content: text, changed: false };
  }
  const meta = parsed.meta;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(meta, 'thumbs')) {
    if (!Array.isArray(meta.thumbs)) { delete meta.thumbs; changed = true; }
    else {
      const cleaned = meta.thumbs.slice(0, MAX_THUMBS).map(item => (item == null || allowedMetaUrl(item, context)) ? item : null);
      if (cleaned.length !== meta.thumbs.length || cleaned.some((item, index) => item !== meta.thumbs[index])) { meta.thumbs = cleaned; changed = true; }
    }
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'poster_url')) {
    const poster = meta.poster_url;
    if (poster !== '' && poster != null && !allowedMetaUrl(poster, context)) { delete meta.poster_url; changed = true; }
  }
  return changed ? { content: JSON.stringify(parsed), changed: true } : { content: text, changed: false };
}

module.exports = { sanitizePostContent, allowedMetaUrl, MAX_THUMBS };
