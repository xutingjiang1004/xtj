'use strict';
// 帖子媒体的 OSS 直传签名接口。
//
// 为什么要有这一层：媒体字节如果经 Render 代理再从 Supabase 取，两份出站流量
// 都要计费（Supabase 5GB/月、Render 5GB/月）。让浏览器拿着签名直传 OSS 之后，
// 字节既不经过 Render 也不经过 Supabase，两个额度同时卸掉。
//
// 边界：
//   - 只签 posts/ 和 posters/ 两个前缀，跟 Supabase 时代的上传路径保持一致，
//     老代码、老校验（render-api/post-media.js 的 validPath）不用改。
//   - 私聊媒体（dm-private / dm-flash）永远不走这里：那两个桶是私有的，
//     不能落进公共读的 OSS 桶。
//   - 只签 PUT，只允许 15 分钟，且不给 DeleteObject 之类的权限——
//     浏览器拿到的是「一次性写入这个确切路径」的地址，不是 AccessKey。

const ossMedia = require('./oss-media');

// 与 render-api/post-media.js 的 PATH 保持同样的字符集，避免两边对同一路径
// 给出不同结论（那边只认 posts/，封面另走 posters/）。
const PATH_RE = /^(?:posts|posters)\/[a-zA-Z0-9_\u4e00-\u9fff.-]{1,200}$/;
const TYPE_RE = /^(?:image|video|audio)\/[a-z0-9.+-]{1,60}$/;
const SIGN_TTL_SECONDS = 900;
// 文件名唯一且内容不可覆盖，所以可以放心让浏览器缓存一年，永不回源。
const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function validMediaPath(value) {
  return typeof value === 'string' && PATH_RE.test(value) && !value.includes('..');
}

function installOssSign(app, { authenticateUser, rateLimit, banError } = {}) {
  // 启动自检：只报「有没有」，绝不输出密钥。排查直传失败时先看这四行。
  try {
    const c = ossMedia.config();
    console.log('[OSS-CONFIG] 直传', ossMedia.enabled() ? '已启用' : '未启用（上传回退 Supabase）');
    console.log('[OSS-CONFIG] OSS_BUCKET:', c.bucket || '未设置');
    console.log('[OSS-CONFIG] OSS_ENDPOINT:', c.endpoint || '未设置');
    console.log('[OSS-CONFIG] OSS_ACCESS_KEY_ID:', c.keyId ? '已设置(' + c.keyId.slice(0, 6) + '…)' : '未设置');
    console.log('[OSS-CONFIG] OSS_ACCESS_KEY_SECRET:', c.keySecret ? '已设置' : '未设置');
  } catch (_) { console.warn('[OSS-CONFIG] 自检失败'); }
  app.post('/api/oss/sign', authenticateUser, rateLimit(60000, 120), async (req, res) => {
    // 没配置 OSS 时明确告诉前端「这条链路不可用」，前端据此回退 Supabase，
    // 而不是把一次发帖卡在这里。
    if (!ossMedia.enabled()) {
      console.warn('[OSS] 拒绝签名：环境变量不完整，前端将回退 Supabase');
      return res.status(503).json({ ok: false, code: 'oss_disabled' });
    }
    const ban = typeof banError === 'function' ? banError(req) : null;
    if (ban) return res.status(ban.status || 403).json({ ok: false, error: ban.message });
    const path = req.body && req.body.path;
    const contentType = String((req.body && req.body.content_type) || '').toLowerCase();
    if (!validMediaPath(path)) return res.status(400).json({ ok: false, code: 'invalid_media_path' });
    if (!TYPE_RE.test(contentType)) return res.status(400).json({ ok: false, code: 'invalid_media_type' });
    try {
      const signed = ossMedia.presignedPutUrl(path, {
        contentType,
        expires: SIGN_TTL_SECONDS,
        cacheControl: OBJECT_CACHE_CONTROL
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, url: signed.url, headers: signed.headers, path: signed.path, expires: signed.expires });
    } catch (_) {
      return res.status(503).json({ ok: false, code: 'oss_sign_failed', retryable: true });
    }
  });
}

module.exports = { installOssSign, validMediaPath, OBJECT_CACHE_CONTROL, SIGN_TTL_SECONDS };
