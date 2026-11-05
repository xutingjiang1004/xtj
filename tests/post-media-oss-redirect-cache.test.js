'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express'), request = require('supertest');
const { createPhotoAccess } = require('../render-api/photo-access');
const POST = '55555555-5555-4555-8555-555555555555';
const origin = 'https://example.supabase.co';
const OSS = 'https://bucket-x.oss-cn-hangzhou.aliyuncs.com/posts/one.png';
function setup(visibility) {
  Object.assign(process.env, { OSS_BUCKET: 'bucket-x', OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com', OSS_ACCESS_KEY_ID: 'id', OSS_ACCESS_KEY_SECRET: 'secret' });
  const rows = [{ id: POST, user_name: 'owner', media_type: 'album', media_url: OSS, visibility, content: '帖子' }];
  const attachments = [{ post_id: POST, position: 0, media_type: 'image', media_url: OSS }];
  const supabase = { from(table) {
    let data = (table === 'post_attachments' ? attachments : rows).slice();
    const q = { select() { return this; }, eq(k, v) { data = data.filter(r => r[k] === v); return this; }, in(k, v) { data = data.filter(r => v.includes(r[k])); return this; }, order() { return this; },
      maybeSingle: async () => ({ data: data[0] || null, error: null }), then(a, b) { return Promise.resolve({ data, error: null }).then(a, b); } };
    return q;
  } };
  const app = express(); app.use(express.json());
  const optionalAuth = (req, res, next) => { const t = String(req.headers.authorization || '').replace('Bearer ', ''); if (t === 'owner') req.userName = t; next(); };
  const authenticateUser = (req, res, next) => res.status(401).end();
  createPhotoAccess({ app, supabase, supabaseUrl: origin, secret: 'test-only-shared-secret', authenticateUser, optionalAuth, rateLimit: () => (req, res, next) => next() });
  return app;
}
// 302 本身带着「是否有权查看」的判定结果：非公开帖子的跳转不能标成 public，
// 否则共享缓存（CDN/代理）会把作者的跳转原样发给没有登录的访客，绕过这里的权限检查。
test('the OSS redirect of a private post is never marked as publicly cacheable', async () => {
  const app = setup('private');
  await request(app).get('/api/post/' + POST + '/media/0').expect(404);
  const owner = await request(app).get('/api/post/' + POST + '/media/0').set('Authorization', 'Bearer owner').expect(302);
  assert.equal(owner.headers.location, OSS);
  assert.doesNotMatch(owner.headers['cache-control'] || '', /\bpublic\b/);
  assert.match(owner.headers['cache-control'] || '', /\bprivate\b/);
});
test('the OSS redirect of a public post stays publicly cacheable', async () => {
  const app = setup('public');
  const res = await request(app).get('/api/post/' + POST + '/media/0').expect(302);
  assert.match(res.headers['cache-control'], /\bpublic\b/);
});
