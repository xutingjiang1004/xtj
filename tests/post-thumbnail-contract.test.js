'use strict';
// 缩略图链路（2026-11-02）：上传时在手机本地压一张 480px JPEG 单独上传，
// 地址写进帖子 metadata 的 thumbs 数组。信息流列表用缩略图，点开看原图。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const media = require('../js/post-media');

const OSS = 'https://xtj-media-2026.oss-cn-hangzhou.aliyuncs.com';
const SUPABASE = 'https://project.supabase.co';
const POST_ID = '11111111-2222-3333-4444-555555555555';

function withWindow(fn) {
  const saved = global.window;
  global.window = {
    XTJ_CONFIG: { SUPABASE_URL: SUPABASE },
    API_BASE: '',
    // 与 js/media-cache.js 的真实实现保持一致：只有本站的媒体接口路径才加 ?preview=1，
    // 其它地址（OSS 直链）原样返回。
    xtjMediaPreviewUrl: url => {
      try {
        const u = new URL(url, 'https://xtj.onrender.com');
        const own = /^\/api\/(?:photo\/(?:[0-9a-f-]{36}|shared\/[A-Za-z0-9_-]+\/[0-9a-f-]{36})\/media|post\/[0-9a-f-]{36}\/media\/\d+)$/;
        return own.test(u.pathname) ? u.href + '?preview=1' : url;
      } catch (_) { return url; }
    }
  };
  try { return fn(); } finally {
    if (saved === undefined) delete global.window; else global.window = saved;
  }
}

test('metadata 里的缩略图用于列表，原图仍交给查看器', () => {
  const post = {
    id: POST_ID, media_type: 'image',
    media_url: OSS + '/posts/orig.jpg',
    _contentMeta: { thumbs: [OSS + '/posts/thumb_a.jpg'] },
    media_items: [{ media_url: OSS + '/posts/orig.jpg', media_type: 'image', position: 0, width: 800, height: 600 }]
  };
  const items = withWindow(() => media.getPostMediaItems(post));
  assert.equal(items.length, 1);
  assert.equal(items[0].preview_url, OSS + '/posts/thumb_a.jpg');
  assert.equal(items[0].media_url, OSS + '/posts/orig.jpg');
  assert.equal(items[0].width, 800);
});

test('多图时按 position 对齐，缺缩略图的那张回退到原地址', () => {
  const post = {
    id: POST_ID, media_type: 'album',
    _contentMeta: { thumbs: [null, OSS + '/posts/thumb_b.jpg'] },
    media_items: [
      { media_url: OSS + '/posts/a.jpg', media_type: 'image', position: 0 },
      { media_url: OSS + '/posts/b.jpg', media_type: 'image', position: 1 }
    ]
  };
  const items = withWindow(() => media.getPostMediaItems(post));
  assert.equal(items[0].preview_url, OSS + '/posts/a.jpg');
  assert.equal(items[1].preview_url, OSS + '/posts/thumb_b.jpg');
});

test('旧帖没有缩略图时回退到服务端的 ?preview=1 预览档', () => {
  const legacy = SUPABASE + '/storage/v1/object/public/uploads/posts/old.jpg';
  const post = {
    id: POST_ID, media_type: 'image', media_url: legacy,
    media_items: [{ media_url: legacy, media_type: 'image', position: 0 }]
  };
  const items = withWindow(() => media.getPostMediaItems(post));
  assert.match(items[0].preview_url, /\/api\/post\/.+\/media\/0\?preview=1$/);
  assert.equal(items[0].media_url, '/api/post/' + POST_ID + '/media/0');
});

test('选片模块会生成缩略图并对外暴露 thumbFile', () => {
  const source = fs.readFileSync('js/post-composer-media.js', 'utf8');
  assert.match(source, /function captureThumb\(/);
  assert.match(source, /THUMB_MAX_EDGE = 480/);
  assert.match(source, /thumbFile: function\(file\)/);
  assert.match(source, /entry\.thumbFile = new File\(/);
});

test('发布流程把缩略图单独上传并写进帖子 metadata', () => {
  const source = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
  assert.match(source, /posts\/thumb_/);
  assert.match(source, /thumbUrls\[position\] = thumbUrl \|\| null/);
  assert.match(source, /thumbs: thumbUrls/);
});
