'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

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
const oss = file => 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/' + file;

test('删帖后要清的 OSS 对象：原图、附件、缩略图、封面；别的来源一概不碰', () => withOssEnv(() => {
  const { collectPostOssPaths } = require('../render-api/oss-cleanup');
  // 缩略图名字与前端一致：posts/thumb_<32 位十六进制>.jpg；封面以作者名开头。
  const thumb = 'posts/thumb_0123456789abcdef0123456789abcdef.jpg';
  const post = {
    user_name: 'alice',
    media_url: oss('posts/alice_1_a_video.mp4'),
    content: JSON.stringify({ __type: '__xtj_post_v2__', text: 'hi', meta: {
      thumbs: [oss(thumb), 'https://project.supabase.co/storage/v1/object/public/uploads/posts/other.jpg', 'https://evil.example/posts/x.jpg'],
      poster_url: oss('posters/alice_1_a.jpg') } })
  };
  const attachments = [{ media_url: oss('posts/alice_1_b.png') }, { media_url: 'https://project.supabase.co/storage/v1/object/public/uploads/posts/c.png' }, { media_url: null }];
  assert.deepEqual(collectPostOssPaths(post, attachments).sort(), [
    'posters/alice_1_a.jpg', 'posts/alice_1_a_video.mp4', 'posts/alice_1_b.png', thumb
  ]);
  assert.deepEqual(collectPostOssPaths({ media_url: 'https://project.supabase.co/x', content: 'plain text' }, []), []);
  assert.deepEqual(collectPostOssPaths({ media_url: oss('posts/../../dm-private/secret') }, []), [], 'path tricks are not accepted');
}));

const hex = n => String(n).repeat(32).slice(0, 32);
function metaPost(meta, extra) { return Object.assign({ media_url: 'https://project.supabase.co/storage/v1/object/public/uploads/posts/a.png', content: JSON.stringify({ __type: '__xtj_post_v2__', text: 'hi', meta }) }, extra); }
// 只模拟 posts 表的「别的帖子内容里是否提到某个文件名」查询。
function fakeSupabase(others, fail) {
  return { from(table) {
    let notId = null, like = null;
    const q = { select() { return q; }, neq(_c, v) { notId = v; return q; }, ilike(_c, v) { like = v.slice(1, -1); return q; }, eq() { return q; }, limit() { return q; },
      then(resolve) {
        if (fail) return resolve({ data: null, error: { message: 'down' } });
        if (table === 'post_attachments') return resolve({ data: [], error: null });
        resolve({ data: others.filter(o => o.id !== notId && o.content.includes(like)).map(o => ({ id: o.id })), error: null });
      } };
    return q;
  } };
}

test('删帖要清的 Supabase 侧缩略图与封面：只认固定格式，别的一律不碰', () => {
  const { collectPostMetaStoragePaths } = require('../render-api/oss-cleanup');
  const origin = 'https://project.supabase.co';
  const proxied = 'https://api.example.com/api/uploads/media?path=' + encodeURIComponent('posts/thumb_' + hex('a') + '.jpg');
  const post = metaPost({ thumbs: [proxied, 'https://api.example.com/api/uploads/media?path=' + encodeURIComponent('posts/thumb_x.jpg'), 'https://api.example.com/api/uploads/media?path=' + encodeURIComponent('dm-private/x.jpg'), null],
    poster_url: origin + '/storage/v1/object/public/uploads/posters/p_1.jpg' });
  assert.deepEqual(collectPostMetaStoragePaths(post, origin).sort(), ['posters/p_1.jpg', 'posts/thumb_' + hex('a') + '.jpg']);
  assert.deepEqual(collectPostMetaStoragePaths(metaPost({ poster_url: 'https://evil.example/storage/v1/object/public/uploads/posters/p_1.jpg' }), origin), [], 'another host is not our bucket');
  assert.deepEqual(collectPostMetaStoragePaths(metaPost({ poster_url: origin + '/storage/v1/object/public/uploads/posters/..%2F..%2Fphotos%2Fx.jpg' }), origin), [], 'path tricks are not accepted');
  assert.deepEqual(collectPostMetaStoragePaths({ content: 'plain text' }, origin), []);
});

test('删帖前读清理路径：别的帖子还提到的缩略图不删，查询失败就不删，帖子自己的媒体照旧', async () => {
  const { readPostCleanupPaths } = require('../render-api/oss-cleanup');
  const origin = 'https://project.supabase.co', mine = 'https://api.example.com/api/uploads/media?path=' + encodeURIComponent('posts/thumb_' + hex('b') + '.jpg');
  const stolen = 'https://api.example.com/api/uploads/media?path=' + encodeURIComponent('posts/thumb_' + hex('c') + '.jpg');
  const post = metaPost({ thumbs: [mine, stolen], poster_url: origin + '/storage/v1/object/public/uploads/posters/p_2.jpg' });
  const others = [{ id: 'other', content: JSON.stringify({ meta: { thumbs: [stolen] } }) }, { id: 'me', content: post.content }];
  const result = await readPostCleanupPaths(fakeSupabase(others), post, 'me', { supabaseUrl: origin });
  assert.deepEqual(result.storage.sort(), ['posters/p_2.jpg', 'posts/thumb_' + hex('b') + '.jpg'], 'the thumbnail another post also names is left alone; the post itself does not count as another post');
  const down = await readPostCleanupPaths(fakeSupabase(others, true), post, 'me', { supabaseUrl: origin });
  assert.deepEqual(down.storage, [], 'a lookup failure deletes nothing');
  const withOss = metaPost({ thumbs: [oss('posts/thumb_' + hex('d') + '.jpg')] }, { media_url: oss('posts/own.png') });
  await withOssEnv(async () => {
    const kept = await readPostCleanupPaths(fakeSupabase([{ id: 'x', content: 'posts/thumb_' + hex('d') + '.jpg' }]), withOss, 'me', { supabaseUrl: origin });
    assert.deepEqual(withOss && kept.oss, ['posts/own.png'], 'an OSS thumbnail that another post names is not deleted, the post own media still is');
    const all = await readPostCleanupPaths(fakeSupabase([]), withOss, 'me', { supabaseUrl: origin });
    assert.deepEqual(all.oss.sort(), ['posts/own.png', 'posts/thumb_' + hex('d') + '.jpg']);
  });
});

test('OSS 对象清理是尽力而为：一个失败不挡住其余，未配置 OSS 时什么都不做', async () => {
  const { deleteOssObjects } = require('../render-api/oss-cleanup');
  const calls = [], quiet = { warn() {} };
  const result = await deleteOssObjects(['posts/a.jpg', 'posts/b.jpg', 'posts/c.jpg'], {
    enabled: () => true, log: quiet,
    deleteObject: async p => { calls.push(p); if (p === 'posts/b.jpg') throw new Error('oss_delete_failed 403'); }
  });
  assert.deepEqual(calls, ['posts/a.jpg', 'posts/b.jpg', 'posts/c.jpg']);
  assert.deepEqual(result, { deleted: 2, failed: 1 });
  const off = await deleteOssObjects(['posts/a.jpg'], { enabled: () => false, log: quiet, deleteObject: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(off, { deleted: 0, failed: 0 });
});

test('放弃的照片上传：超过 14 天仍 pending 的登记行才清理，仍被照片引用的路径不会被删', async () => {
  const { sweepAbandonedPhotoUploads, ABANDONED_PHOTO_UPLOAD_MS } = require('../render-api/storage-cleanup');
  assert.equal(ABANDONED_PHOTO_UPLOAD_MS, 14 * 24 * 60 * 60 * 1000);
  const now = Date.parse('2026-11-05T00:00:00Z');
  const registry = [
    { storage_path: 'photos/old-orphan.jpg', user_name: 'alice', status: 'pending', created_at: '2026-10-01T00:00:00Z' },
    { storage_path: 'photos/old-but-used.jpg', user_name: 'alice', status: 'pending', created_at: '2026-10-02T00:00:00Z' },
    { storage_path: 'photos/recent.jpg', user_name: 'alice', status: 'pending', created_at: '2026-11-04T00:00:00Z' },
    { storage_path: 'photos/attached.jpg', user_name: 'alice', status: 'attached', created_at: '2026-09-01T00:00:00Z' },
    { storage_path: 'photos/cleanup-marker.jpg', user_name: '__cleanup__', status: 'pending', created_at: '2026-09-01T00:00:00Z' }
  ];
  const removed = [], claims = [], filters = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'photo_upload_registry');
      let rows = registry.slice(), cap = Infinity;
      const q = {
        select() { return q; },
        eq(column, value) { filters.push(['eq', column, value]); rows = rows.filter(r => r[column] === value); return q; },
        neq(column, value) { filters.push(['neq', column, value]); rows = rows.filter(r => r[column] !== value); return q; },
        lt(column, value) { filters.push(['lt', column, value]); rows = rows.filter(r => r[column] < value); return q; },
        order() { return q; },
        limit(n) { cap = n; return q; },
        then(resolve) { resolve({ data: rows.slice(0, cap), error: null }); }
      };
      return q;
    },
    // The same database function the app uses for deletes: a path a photo still references is not handed back.
    async rpc(name, args) {
      assert.equal(name, 'claim_photo_cleanup_paths');
      claims.push(args.p_paths.slice());
      return { data: { ok: true, paths: args.p_paths.filter(p => p !== 'photos/old-but-used.jpg') }, error: null };
    },
    storage: { from(bucket) { return { async remove(paths) { removed.push({ bucket, paths: paths.slice() }); return { data: paths.map(name => ({ name })), error: null }; } }; } }
  };
  const result = await sweepAbandonedPhotoUploads(supabase, { now });
  assert.deepEqual(claims, [['photos/old-orphan.jpg', 'photos/old-but-used.jpg']], 'only old pending rows are even considered');
  assert.deepEqual(removed, [{ bucket: 'photo-wall', paths: ['photos/old-orphan.jpg'] }], 'a path a photo still uses is never removed');
  assert.equal(result.swept, 2);
  assert.ok(filters.some(f => f[0] === 'eq' && f[1] === 'status' && f[2] === 'pending'));
  assert.ok(filters.some(f => f[0] === 'lt' && f[1] === 'created_at' && f[2] === '2026-10-22T00:00:00.000Z'), '14 days before now');
  const unavailable = await sweepAbandonedPhotoUploads({ from() { const q = { select() { return q; }, eq() { return q; }, neq() { return q; }, lt() { return q; }, order() { return q; }, limit() { return q; }, then(r) { r({ data: null, error: { message: 'down' } }); } }; return q; } }, { now });
  assert.equal(unavailable.ok, false, 'a registry outage deletes nothing and does not throw');
});

test('接线：删帖成功后清 OSS（用户删帖与举报删帖两处），清理任务里每小时扫一次放弃的照片上传', () => {
  const del = SERVER.slice(SERVER.indexOf("app.post('/api/post/delete'"), SERVER.indexOf('// ===================== 点赞接口'));
  assert.ok(del.indexOf('readPostCleanupPaths(') > 0 && del.indexOf('readPostCleanupPaths(') < del.indexOf('hardDeleteContent('), 'paths are read before the rows disappear');
  assert.match(del, /concat\(postCleanupPaths\.storage\)/, 'Supabase-hosted thumbnails and posters join the durable queue of the delete transaction');
  assert.match(del, /result\.deleted === true && ossPathsToClean\.length\) deleteOssObjects\(ossPathsToClean\)\.catch/);
  const report = SERVER.slice(SERVER.indexOf("app.post('/admin/report/:id/delete-post'"));
  assert.match(report.slice(0, 4800), /readPostCleanupPaths\(supabase, post, normalizedTargetId/);
  assert.match(report.slice(0, 5400), /storagePaths: expectPhoto \? collectPhotoStoragePaths\(post\) : postCleanupPaths\.storage/);
  assert.match(report.slice(0, 5800), /deleteOssObjects\(ossPathsToClean\)\.catch/);
  const jobs = SERVER.slice(SERVER.indexOf('async function processStorageCleanupJobs()'), SERVER.indexOf('async function processStorageCleanupJobs()') + 1800);
  assert.match(jobs, /_abandonedPhotoSweepAt > 60 \* 60 \* 1000/);
  assert.match(jobs, /sweepAbandonedPhotoUploads\(supabase\)/);
});
