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
const auxMedia = require('./aux-media');
const { MAX_POST_FILE_BYTES } = require('../js/post-media');

// 与 render-api/post-media.js 的 PATH 保持同样的字符集，避免两边对同一路径
// 给出不同结论（那边只认 posts/，封面另走 posters/）。
const PATH_RE = /^(?:posts|posters)\/[a-zA-Z0-9_\u4e00-\u9fff.-]{1,200}$/;
const TYPE_RE = /^(?:image|video|audio)\/[a-z0-9.+-]{1,60}$/;
const SIGN_TTL_SECONDS = 900;
// 单个照片/视频最大 50MB（与前端选片、发帖校验同一个常量）。OSS V1 预签名 PUT 没法把长度写进签名，
// 所以这里按浏览器申报的 size 把关：申报超限直接不签，前端本来就不会发出超限请求。
const MAX_MEDIA_BYTES = MAX_POST_FILE_BYTES;
// 文件名唯一且内容不可覆盖，所以可以放心让浏览器缓存一年，永不回源。
const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function validMediaPath(value) {
  return typeof value === 'string' && PATH_RE.test(value) && !value.includes('..');
}

// 每用户每小时可申请签名的总字节数（按申报大小计）。OSS V1 预签名没法把长度写进签名，
// 申报值只是自觉；这里给「一个账号能往公共读桶里塞多少」加一道上限。0 表示不限制。
const SIGN_WINDOW_MS = 60 * 60 * 1000;
function hourlySignBytes(env) {
  const raw = Number((env || process.env).OSS_SIGN_HOURLY_MB);
  const mb = Number.isFinite(raw) && raw >= 0 ? raw : 1024;
  return Math.floor(mb * 1024 * 1024);
}
function createSignQuota(options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  const limit = typeof opts.limit === 'function' ? opts.limit : hourlySignBytes;
  const rows = new Map();
  function prune(at) { if (rows.size > 5000) for (const [key, row] of rows) if (row.resetAt <= at) rows.delete(key); }
  return {
    // 申请 bytes 字节：够就扣并返回 true，超出返回 false。
    take(user, bytes) {
      const max = limit();
      if (!max) return true;
      const at = now();
      prune(at);
      let row = rows.get(user);
      if (!row || row.resetAt <= at) { row = { used: 0, resetAt: at + SIGN_WINDOW_MS }; rows.set(user, row); }
      if (row.used + bytes > max) return false;
      row.used += bytes;
      return true;
    },
    used(user) { const row = rows.get(user); return row && row.resetAt > now() ? row.used : 0; }
  };
}

// 发帖前核对 OSS 上的对象：真实存在、大小不超过上限（附件还要与申报大小一致）、类型是允许的媒体。
// 数据库函数对 OSS 附件跳过了存在性与大小校验，这里补上。
// items: [{ path, size?, kind }]，kind 为 'image'（附件，不收 svg）或 'image'|'video'|'audio'（单个媒体，须与帖子类型一致）。
// 返回 { ok:true } 或 { ok:false, status, code, error }。这里只判断、不删除：调用时路径还没核对过归属，
// 违规对象由上传登记表的清理流程（只处理登记人自己的路径）负责回收，避免用别人的路径诱导误删。
async function verifyPostOssMedia(items, options) {
  const opts = options || {};
  const head = opts.headObject || ossMedia.headObject;
  const list = Array.isArray(items) ? items : [];
  const results = await Promise.all(list.map(async item => {
    try { return { item, meta: await head(item.path, opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : undefined) }; }
    catch (error) { return { item, error }; }
  }));
  const transient = results.find(row => row.error);
  for (const { item, meta } of results) {
    if (!meta) continue;
    if (!meta.exists) return { ok: false, status: 400, code: 'media_not_uploaded', error: '图片还没有上传完成，请重新发布' };
    const family = String(meta.contentType || '').split('/')[0];
    const svg = /^image\/svg/.test(meta.contentType);
    const typeOk = svg ? false : (item.kind === 'image' ? family === 'image' : family === item.kind);
    const sizeKnown = meta.size >= 0;
    const tooBig = sizeKnown && meta.size > MAX_MEDIA_BYTES;
    const mismatch = Number.isSafeInteger(item.size) && sizeKnown && meta.size !== item.size;
    if (!typeOk) { return { ok: false, status: 400, code: 'invalid_media_type', error: '媒体类型无效' }; }
    if (tooBig || mismatch) { return { ok: false, status: 400, code: 'invalid_attachment_size', error: '文件大小与申报不一致或超过50MB' }; }
  }
  if (transient) return { ok: false, status: 503, code: 'media_verify_unavailable', error: '媒体校验暂不可用，请重试', retryable: true };
  return { ok: true };
}

function installOssSign(app, { authenticateUser, rateLimit, banError, signQuota = createSignQuota(), supabase } = {}) {
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
    const size = req.body && req.body.size;
    if (!Number.isSafeInteger(size) || size <= 0) return res.status(400).json({ ok: false, code: 'invalid_media_size' });
    if (size > MAX_MEDIA_BYTES) return res.status(413).json({ ok: false, code: 'file_too_large', error: '每个文件不能超过50MB' });
    // 单账号每小时的签名总量上限：超出时前端会按「签名失败」回退到 Supabase 老链路，不会让发帖失败。
    if (!signQuota.take(String(req.userName || ''), size)) {
      res.set('Retry-After', '600');
      return res.status(429).json({ ok: false, code: 'oss_quota_exceeded', error: '上传量较大，请稍后再试', retryable: true });
    }
    // 缩略图/封面没有 prepare 登记：签名前记一笔（谁、哪个路径），发帖成功会标记已使用，
    // 放弃发布留下的会被清理任务回收（aux-media.js）。登记失败不挡上传——最坏情况只是留下一个孤儿文件。
    if (supabase && auxMedia.isAuxPath(path)) {
      try {
        const registered = await auxMedia.registerAuxUpload(supabase, String(req.userName || ''), path);
        if (registered.conflict) return res.status(409).json({ ok: false, code: 'media_path_exists' });
        if (registered.error) console.warn('[OSS] 缩略图/封面登记失败，仍然签名:', registered.error && registered.error.message || registered.error);
      } catch (error) { console.warn('[OSS] 缩略图/封面登记异常，仍然签名:', error && error.message || error); }
    }
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

module.exports = { installOssSign, createSignQuota, hourlySignBytes, verifyPostOssMedia, validMediaPath, OBJECT_CACHE_CONTROL, SIGN_TTL_SECONDS, MAX_MEDIA_BYTES };
