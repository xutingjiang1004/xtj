'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function withOssEnv(fn) {
  const keys = ['OSS_BUCKET', 'OSS_ENDPOINT', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'];
  const saved = keys.map(key => process.env[key]);
  process.env.OSS_BUCKET = 'test-bucket';
  process.env.OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
  process.env.OSS_ACCESS_KEY_ID = 'LTAItestkeyid';
  process.env.OSS_ACCESS_KEY_SECRET = 'test-secret';
  const restore = () => keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  let result;
  try { result = fn(); } catch (error) { restore(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

test('OSS 直传签名强制禁止覆盖同名对象，且该请求头参与 V1 签名', () => {
  withOssEnv(() => {
    const oss = require('../render-api/oss-media');
    const signed = oss.presignedPutUrl('posts/alice_1_abc_photo.jpg', { contentType: 'image/jpeg', expires: 900, cacheControl: 'public, max-age=31536000, immutable' });
    assert.equal(signed.headers['x-oss-forbid-overwrite'], 'true');
    const url = new URL(signed.url);
    const expires = url.searchParams.get('Expires');
    const stringToSign = ['PUT', '', 'image/jpeg', expires, 'x-oss-forbid-overwrite:true\n/test-bucket/posts/alice_1_abc_photo.jpg'].join('\n');
    const expected = crypto.createHmac('sha1', 'test-secret').update(stringToSign, 'utf8').digest('base64');
    assert.equal(url.searchParams.get('Signature'), expected);
  });
});

test('/api/oss/sign 把禁止覆盖请求头原样交给浏览器', async () => {
  await withOssEnv(async () => {
    const { installOssSign } = require('../render-api/oss-sign');
    let handler;
    const app = { post(path, ...stack) { if (path === '/api/oss/sign') handler = stack[stack.length - 1]; } };
    const passthrough = (req, res, next) => next();
    installOssSign(app, { authenticateUser: passthrough, rateLimit: () => passthrough });
    let payload;
    const res = { set() { return this; }, status() { return this; }, json(body) { payload = body; return this; } };
    await handler({ body: { path: 'posts/alice_1_abc_photo.jpg', content_type: 'image/jpeg', size: 1024 } }, res);
    assert.equal(payload.ok, true);
    assert.equal(payload.headers['x-oss-forbid-overwrite'], 'true');
  });
});

test('/api/oss/sign 只签 50MB 以内的文件：必须申报大小，超过 50MB 返回 413 且不签名', async () => {
  await withOssEnv(async () => {
    const { installOssSign, MAX_MEDIA_BYTES } = require('../render-api/oss-sign');
    assert.equal(MAX_MEDIA_BYTES, 50 * 1024 * 1024);
    let handler;
    const app = { post(path, ...stack) { if (path === '/api/oss/sign') handler = stack[stack.length - 1]; } };
    const passthrough = (req, res, next) => next();
    installOssSign(app, { authenticateUser: passthrough, rateLimit: () => passthrough });
    async function sign(size) {
      let status = 200, payload;
      const res = { set() { return this; }, status(code) { status = code; return this; }, json(body) { payload = body; return this; } };
      await handler({ body: { path: 'posts/alice_1_abc_video.mp4', content_type: 'video/mp4', size } }, res);
      return { status, payload };
    }
    assert.equal((await sign(MAX_MEDIA_BYTES)).payload.ok, true, 'exactly 50MB is allowed');
    const over = await sign(MAX_MEDIA_BYTES + 1);
    assert.equal(over.status, 413);
    assert.equal(over.payload.code, 'file_too_large');
    assert.equal(over.payload.url, undefined, 'no signed URL is handed out');
    for (const bad of [undefined, null, 0, -5, 1.5, '1024', 'abc', Number.MAX_SAFE_INTEGER + 2]) {
      const result = await sign(bad);
      assert.equal(result.status, 400, 'size ' + String(bad) + ' is rejected');
      assert.equal(result.payload.code, 'invalid_media_size');
    }
  });
});

test('前端申请 OSS 签名时带上文件大小', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'core-parts', '05-feed-stats.js'), 'utf8');
  assert.match(source, /body: JSON\.stringify\(\{ path: path, content_type: type, size: Number\(file && file\.size\) \|\| 0 \}\)/);
});
