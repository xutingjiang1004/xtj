'use strict';
// 阿里云 OSS 媒体存储适配层。
//
// 为什么不用官方 SDK：项目后端只需要「签名直传 + 上传/删除 + 拼公网地址」四件事，
// ali-oss 会带进十几个传递依赖，而 OSS 的 V1 签名算法十多年没变过，用内置 crypto
// 手写反而更好审。签名细节见：
// https://help.aliyun.com/zh/oss/developer-reference/include-signatures-in-the-authorization-header
//
// 启用条件：OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET 三个环境变量齐全。
// 任缺一个就返回 enabled()===false，调用方必须回退到 Supabase 老链路，不能硬失败。

const crypto = require('crypto');

const DEFAULT_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
const MAX_PRESIGN_SECONDS = 3600;

function config() {
  return {
    bucket: String(process.env.OSS_BUCKET || '').trim(),
    endpoint: String(process.env.OSS_ENDPOINT || DEFAULT_ENDPOINT).trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    keyId: String(process.env.OSS_ACCESS_KEY_ID || '').trim(),
    keySecret: String(process.env.OSS_ACCESS_KEY_SECRET || '').trim()
  };
}

function enabled() {
  const c = config();
  return !!(c.bucket && c.endpoint && c.keyId && c.keySecret);
}

// 对象路径清洗：去掉开头的斜杠和 .. 段，避免拼出跨桶的路径。
function cleanPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}

function encodePath(path) {
  return cleanPath(path).split('/').map(encodeURIComponent).join('/');
}

function publicUrl(path) {
  const c = config();
  if (!c.bucket || !path) return '';
  return 'https://' + c.bucket + '.' + c.endpoint + '/' + encodePath(path);
}

// OSS 的 CanonicalizedResource 永远以 /bucket/object 开头，哪怕用的是 bucket 绑定的域名。
function canonicalResource(path) {
  return '/' + config().bucket + '/' + cleanPath(path);
}

function hmac(key, text) {
  return crypto.createHmac('sha1', key).update(text, 'utf8').digest('base64');
}

function gmdate(seconds) {
  return new Date(seconds * 1000).toUTCString();
}

// 生成浏览器可直传的 PUT 签名地址。
// 走 V1：参数式签名，前端拿到 URL 直接 fetch(url, {method:'PUT'})，不接触 AccessKey。
function presignedPutUrl(path, options) {
  const c = config();
  const opts = options || {};
  if (!enabled()) throw new Error('oss_not_configured');
  const clean = cleanPath(path);
  if (!clean) throw new Error('oss_empty_path');
  const ttl = Math.max(60, Math.min(MAX_PRESIGN_SECONDS, Number(opts.expires) || 900));
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const contentType = String(opts.contentType || 'application/octet-stream');
  // 前缀 x-oss- 的请求头必须参与 V1 签名（CanonicalizedOSSHeaders，每行 name:value\n），
  // 且上传时要原样带上。forbid-overwrite 让同名对象已存在时直接 409：
  // 路径由浏览器自拟且公开可见，没有这一条，任何登录用户都能给他人的媒体路径签 PUT 并覆盖内容。
  const forbidOverwrite = opts.forbidOverwrite !== false;
  const ossHeaders = forbidOverwrite ? 'x-oss-forbid-overwrite:true\n' : '';
  const stringToSign = [
    'PUT',
    '',            // Content-MD5：不校验，留空
    contentType,
    String(expires),
    ossHeaders + canonicalResource(clean)
  ].join('\n');
  const signature = hmac(c.keySecret, stringToSign);
  const query = [
    'OSSAccessKeyId=' + encodeURIComponent(c.keyId),
    'Expires=' + expires,
    'Signature=' + encodeURIComponent(signature)
  ].join('&');
  const headers = { 'Content-Type': contentType };
  if (forbidOverwrite) headers['x-oss-forbid-overwrite'] = 'true';
  // Cache-Control 不属于 V1 签名覆盖的字段，可以安全附加；
  // 但它必须在上传时就落成对象元数据，后续 GET 才不会回源。
  if (opts.cacheControl) headers['Cache-Control'] = String(opts.cacheControl);
  return {
    url: publicUrl(clean) + '?' + query,
    headers,
    expires,
    path: clean
  };
}

// 服务端直传（迁移脚本、服务端生成的海报等）。
async function putObject(path, body, options) {
  const c = config();
  const opts = options || {};
  if (!enabled()) throw new Error('oss_not_configured');
  const clean = cleanPath(path);
  if (!clean) throw new Error('oss_empty_path');
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const contentType = String(opts.contentType || 'application/octet-stream');
  const date = gmdate(Math.floor(Date.now() / 1000));
  const stringToSign = ['PUT', '', contentType, date, canonicalResource(clean)].join('\n');
  const signature = hmac(c.keySecret, stringToSign);
  const headers = {
    'Content-Type': contentType,
    'Date': date,
    'Content-Length': String(buffer.length),
    'Authorization': 'OSS ' + c.keyId + ':' + signature
  };
  if (opts.cacheControl) headers['Cache-Control'] = String(opts.cacheControl);
  const res = await (opts.fetchImpl || fetch)(publicUrl(clean), {
    method: 'PUT',
    headers,
    body: buffer
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('oss_put_failed ' + res.status + ' ' + String(detail).slice(0, 200));
  }
  return { url: publicUrl(clean), path: clean, size: buffer.length };
}

async function deleteObject(path, options) {
  const c = config();
  const opts = options || {};
  if (!enabled()) throw new Error('oss_not_configured');
  const clean = cleanPath(path);
  if (!clean) throw new Error('oss_empty_path');
  const date = gmdate(Math.floor(Date.now() / 1000));
  const stringToSign = ['DELETE', '', '', date, canonicalResource(clean)].join('\n');
  const signature = hmac(c.keySecret, stringToSign);
  const res = await (opts.fetchImpl || fetch)(publicUrl(clean), {
    method: 'DELETE',
    headers: { 'Date': date, 'Authorization': 'OSS ' + c.keyId + ':' + signature }
  });
  // 404 视为已删除，迁移重跑时要幂等。
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error('oss_delete_failed ' + res.status + ' ' + String(detail).slice(0, 200));
  }
  return { deleted: res.status !== 404, path: clean };
}

// 判断某个媒体路径该不该走 OSS。
// dm-private / dm-flash 是私聊内容，桶是私有桶，绝不能放进公共读的 OSS 桶——
// 一旦放进去，任何拿到 URL 的人都能看。这两个桶永远留在 Supabase。
const PRIVATE_BUCKETS = new Set(['dm-private', 'dm-flash']);
const PUBLIC_BUCKETS = new Set(['uploads', 'photo-wall']);

function bucketRouted(bucket) {
  return PUBLIC_BUCKETS.has(String(bucket || ''));
}

function isPrivateBucket(bucket) {
  return PRIVATE_BUCKETS.has(String(bucket || ''));
}

module.exports = {
  config,
  enabled,
  cleanPath,
  publicUrl,
  presignedPutUrl,
  putObject,
  deleteObject,
  bucketRouted,
  isPrivateBucket,
  PRIVATE_BUCKETS,
  PUBLIC_BUCKETS
};
