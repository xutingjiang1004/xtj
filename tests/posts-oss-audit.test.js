'use strict';
// 2026-11-05 帖子板块审计：OSS 直传之后的服务端回归。
const test = require('node:test'), assert = require('node:assert/strict');

const OSS_ENV = { OSS_BUCKET: 'xtj-media-2026', OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com', OSS_ACCESS_KEY_ID: 'id-test', OSS_ACCESS_KEY_SECRET: 'secret-test' };
function withOss(fn) {
  const saved = {};
  for (const key of Object.keys(OSS_ENV)) { saved[key] = process.env[key]; process.env[key] = OSS_ENV[key]; }
  const restore = () => { for (const key of Object.keys(OSS_ENV)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } };
  let result;
  try { result = fn(); } catch (error) { restore(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}
const OSS = 'https://xtj-media-2026.oss-cn-hangzhou.aliyuncs.com';
const postId = '8c1cb02d-74d0-4e45-9e15-000000000001';

function videoPost(posterUrl) {
  return {
    id: postId, user_name: 'alice', media_type: 'video', media_url: OSS + '/posts/alice_1_a_clip.mp4',
    content: JSON.stringify({ __type: '__xtj_post_v2__', text: '视频', meta: { poster_url: posterUrl } })
  };
}
const emptyDb = { from() { const q = { select() { return q; }, in() { return q; }, order() { return Promise.resolve({ data: [], error: null }); } }; return q; } };

test('OSS 媒体地址与 Supabase 地址同样严格：带查询串、片段、账号信息的 OSS 地址不被识别', () => withOss(() => {
  const { parsePostMediaUrl, isOssMediaUrl } = require('../render-api/post-media');
  const good = OSS + '/posts/alice_1_a_clip.mp4';
  assert.equal(parsePostMediaUrl(good, 'https://project.supabase.co'), 'posts/alice_1_a_clip.mp4');
  assert.equal(isOssMediaUrl(good), true);
  for (const bad of [good + '?Expires=1&Signature=x', good + '#frag', 'https://u:p@' + good.slice('https://'.length), 'http://' + good.slice('https://'.length)]) {
    assert.equal(isOssMediaUrl(bad), false, bad);
    assert.equal(parsePostMediaUrl(bad, 'https://project.supabase.co'), null, bad);
  }
}));

test('视频帖封面直传 OSS 后服务端仍返回 poster_url（否则分享卡片没有封面）', () => withOss(async () => {
  const { loadPostAttachments } = require('../render-api/post-attachments');
  const poster = OSS + '/posters/alice_1_b_poster-1.jpg';
  const [post] = await loadPostAttachments(emptyDb, [videoPost(poster)]);
  assert.equal(post.poster_url, poster);
}));

test('分享页封面：OSS 封面直接给公网地址，不绕会 404 的 /api/uploads/media', () => withOss(() => {
  const { sharePosterUrl } = require('../render-api/photo-access');
  const poster = OSS + '/posters/alice_1_b_poster-1.jpg';
  assert.equal(sharePosterUrl('https://xtj.example', poster), poster);
  assert.equal(sharePosterUrl('https://xtj.example', 'https://evil.example/posters/a.jpg'), '');
  assert.match(sharePosterUrl('https://xtj.example', 'https://p.supabase.co/storage/v1/object/public/uploads/posters/a.jpg'), /\/api\/uploads\/media\?path=posters%2Fa\.jpg&preview=1/);
}));

test('封面地址必须是本站 OSS 桶：其他域名、带查询串或带账号的地址一律丢弃', () => withOss(async () => {
  const { loadPostAttachments } = require('../render-api/post-attachments');
  for (const bad of [
    'https://evil.example/posters/a.jpg',
    OSS + '.evil.example/posters/a.jpg',
    'https://x@' + OSS.slice('https://'.length) + '/posters/a.jpg',
    OSS + '/posters/a.jpg?x=1',
    OSS + '/avatars/a.jpg'
  ]) {
    const [post] = await loadPostAttachments(emptyDb, [videoPost(bad)]);
    assert.equal(post.poster_url, null, bad);
  }
}));
