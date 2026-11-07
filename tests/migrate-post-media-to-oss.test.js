'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../scripts/migrate-post-media-to-oss');

const SB = 'https://project.supabase.co';
const pub = path => SB + '/storage/v1/object/public/uploads/' + path;
const OSS = key => 'https://bucket.oss-cn-hangzhou.aliyuncs.com/' + key;

function world() {
  const posts = [
    { id: 'p1', media_type: 'video', media_url: pub('posts/alice_1_video.mp4'), content: JSON.stringify({ __type: '__xtj_post_v2__', text: 'v', meta: { poster_url: pub('posters/alice_1_poster.jpg'), thumbs: [pub('posts/thumb_alice_1.jpg')] } }) },
    { id: 'p2', media_type: 'image', media_url: pub('1777456621870_IMG_3381.jpeg'), content: 'plain' },
    { id: 'p3', media_type: 'image', media_url: OSS('posts/already_on_oss.jpg'), content: 'plain' },
    { id: 'p4', media_type: 'album', media_url: pub('posts/alice_2_a.png'), content: 'plain' }
  ];
  const attachments = [{ id: 1, post_id: 'p4', media_url: pub('posts/alice_2_a.png') }, { id: 2, post_id: 'p4', media_url: pub('posts/alice_2_b.png') }, { id: 3, post_id: 'p4', media_url: pub('chat/not_a_post_media.png') }];
  const writes = [];
  const store = {
    posts, attachments, writes,
    async listPostMedia() { return posts.filter(p => p.media_url.startsWith(SB)).map(p => ({ id: p.id, media_url: p.media_url })); },
    async listAttachmentMedia() { return attachments.map(a => ({ id: a.id, post_id: a.post_id, media_url: a.media_url })); },
    async listContentWithMeta() { return posts.filter(p => p.content.includes('__xtj_post_v2__')).map(p => ({ id: p.id, content: p.content })); },
    async swap(table, id, field, from, to) {
      const row = (table === 'posts' ? posts : attachments).find(r => r.id === id);
      if (!row || row[field] !== from) return false;
      row[field] = to; writes.push([table, id, field]); return true;
    }
  };
  return store;
}

function deps(store, over) {
  const calls = [], ossObjects = new Map(), sizes = new Map();
  const d = {
    calls, ossObjects,
    async sourceHead(path) { calls.push(['sourceHead', path]); return sizes.has(path) ? { size: sizes.get(path), contentType: path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' } : (path.includes('missing') ? null : { size: 1000, contentType: 'image/jpeg' }); },
    async download(path) { calls.push(['download', path]); return Buffer.alloc(sizes.has(path) ? sizes.get(path) : 1000, 7); },
    async ossHead(key) { calls.push(['ossHead', key]); return ossObjects.has(key) ? { size: ossObjects.get(key) } : null; },
    async ossPut(key, buffer, options) { calls.push(['ossPut', key, options.contentType, options.cacheControl]); ossObjects.set(key, buffer.length); return { url: OSS(key) }; },
    ossUrl: OSS,
    rewrite: m.makeRewrite(store),
    sizes
  };
  return Object.assign(d, over || {});
}

test('OSS 路径：posts/ 与 posters/ 原样保留，旧帖根目录文件搬到 posts/legacy_，其他前缀（私聊、头像）不属于帖子媒体', () => {
  assert.equal(m.ossKeyFor('posts/alice_1_a.jpg'), 'posts/alice_1_a.jpg');
  assert.equal(m.ossKeyFor('posters/alice_1_p.jpg'), 'posters/alice_1_p.jpg');
  assert.equal(m.ossKeyFor('1777456621870_IMG_3381.jpeg'), 'posts/legacy_1777456621870_IMG_3381.jpeg');
  assert.equal(m.ossKeyFor('1780539158943___2026 0424.png'), 'posts/legacy_1780539158943___2026_0424.png', 'characters OSS reads would reject are replaced');
  assert.equal(m.ossKeyFor('照片 1.jpg'), 'posts/legacy_照片_1.jpg');
  const long = m.ossKeyFor('x'.repeat(400) + '.jpg');
  assert.match(long, /^posts\/legacy_/); assert.ok(long.length <= 'posts/'.length + 200);
  for (const unsafe of ['chat/a.png', 'dm-private/chat/a.png', 'avatars/a.png', 'profile-images/a.png', 'posts/../chat/a.png', 'posts/a/b.png', '', '..', 'a\\b.png']) assert.equal(m.ossKeyFor(unsafe), null, unsafe);
});

test('只认本项目 Supabase 的 uploads 公网地址：别的来源、带查询串的地址、已在 OSS 的地址都不算', () => {
  assert.equal(m.publicPathOf(pub('posts/a%20b.jpg'), SB), 'posts/a b.jpg');
  for (const bad of ['https://evil.example/storage/v1/object/public/uploads/posts/a.jpg', pub('posts/a.jpg') + '?x=1', SB + '/storage/v1/object/public/dm-private/chat/a.jpg', OSS('posts/a.jpg'), '', null, 'not a url']) assert.equal(m.publicPathOf(bad, SB), null, String(bad));
});

test('收集：帖子、附件、内容元数据里的缩略图与封面汇成「源路径 → 引用」，不支持的前缀单独列出', async () => {
  const plan = await m.collectPlan(world(), SB);
  assert.deepEqual(plan.entries.map(e => e.path), ['1777456621870_IMG_3381.jpeg', 'posters/alice_1_poster.jpg', 'posts/alice_1_video.mp4', 'posts/alice_2_a.png', 'posts/alice_2_b.png', 'posts/thumb_alice_1.jpg']);
  assert.deepEqual(plan.skipped, [{ path: 'chat/not_a_post_media.png', reason: 'unsupported_prefix' }]);
  const shared = plan.entries.find(e => e.path === 'posts/alice_2_a.png');
  assert.deepEqual(shared.refs.map(r => r.table + ':' + r.id), ['posts:p4', 'post_attachments:1'], 'a file used by a post and its attachment is moved once and both references are updated');
});

test('演练是默认：只读，不碰 Supabase 存储、不碰 OSS、不改数据库', async () => {
  const store = world();
  const before = JSON.stringify(store.posts) + JSON.stringify(store.attachments);
  const summary = await m.run({ store, deps: null, supabaseUrl: SB, apply: false });
  assert.equal(summary.apply, false);
  assert.equal(summary.results.length, 6);
  assert.ok(summary.results.every(r => r.status === 'dry_run'));
  assert.equal(store.writes.length, 0);
  assert.equal(JSON.stringify(store.posts) + JSON.stringify(store.attachments), before);
  assert.deepEqual(m.parseArgs([]), { apply: false, maxBytes: m.MAX_DEFAULT_BYTES, limit: 0 });
  assert.throws(() => m.parseArgs(['--delete-source']), /未知参数/, 'there is no switch that deletes the Supabase originals');
});

test('真迁：先确认源存在、下载、上传（带一年 immutable 缓存与真实类型）、回查大小，最后才改数据库', async () => {
  const store = world(), d = deps(store);
  d.sizes.set('posts/alice_1_video.mp4', 5000);
  const summary = await m.run({ store, deps: d, supabaseUrl: SB, apply: true, maxBytes: 10 * 1024 * 1024 });
  assert.ok(summary.results.every(r => r.status === 'migrated'), JSON.stringify(summary.results.map(r => r.status)));
  const video = d.calls.filter(c => c[1] === 'posts/alice_1_video.mp4');
  assert.deepEqual(video.map(c => c[0]), ['sourceHead', 'ossHead', 'download', 'ossPut', 'ossHead']);
  assert.deepEqual(video.find(c => c[0] === 'ossPut').slice(2), ['video/mp4', m.OBJECT_CACHE_CONTROL]);
  assert.equal(d.calls.find(c => c[0] === 'ossPut' && c[1] === 'posts/legacy_1777456621870_IMG_3381.jpeg')[2], 'image/jpeg');
  const p1 = store.posts.find(p => p.id === 'p1'), p2 = store.posts.find(p => p.id === 'p2');
  assert.equal(p1.media_url, OSS('posts/alice_1_video.mp4'));
  assert.equal(p2.media_url, OSS('posts/legacy_1777456621870_IMG_3381.jpeg'));
  const meta = JSON.parse(p1.content).meta;
  assert.equal(meta.poster_url, OSS('posters/alice_1_poster.jpg'));
  assert.deepEqual(meta.thumbs, [OSS('posts/thumb_alice_1.jpg')]);
  assert.deepEqual(store.attachments.map(a => a.media_url), [OSS('posts/alice_2_a.png'), OSS('posts/alice_2_b.png'), pub('chat/not_a_post_media.png')], 'chat media is never touched');
  assert.equal(store.posts.find(p => p.id === 'p3').media_url, OSS('posts/already_on_oss.jpg'));
  assert.equal(summary.downloaded_bytes, 5000 + 5 * 1000);
  assert.ok(!d.calls.some(c => /delete|remove/i.test(c[0])), 'nothing is ever deleted from Supabase');
});

test('任何一步失败，这个对象的数据库引用保持原样；其余对象照常处理', async () => {
  const store = world();
  const d = deps(store, {
    async ossPut(key, buffer, options) { if (key === 'posts/alice_1_video.mp4') throw new Error('oss_put_failed 403'); d.ossObjects.set(key, key === 'posts/alice_2_a.png' ? buffer.length - 1 : buffer.length); return { url: OSS(key) }; },
    async download(path) { return Buffer.alloc(path === 'posters/alice_1_poster.jpg' ? 999 : 1000, 1); }
  });
  const summary = await m.run({ store, deps: d, supabaseUrl: SB, apply: true });
  const status = Object.fromEntries(summary.results.map(r => [r.path, r.status]));
  assert.equal(status['posts/alice_1_video.mp4'], 'error');
  assert.equal(status['posters/alice_1_poster.jpg'], 'download_mismatch');
  assert.equal(status['posts/alice_2_a.png'], 'verify_failed');
  assert.equal(status['posts/alice_2_b.png'], 'migrated');
  assert.equal(store.posts.find(p => p.id === 'p1').media_url, pub('posts/alice_1_video.mp4'), 'a failed upload leaves the post pointing at Supabase');
  assert.equal(JSON.parse(store.posts.find(p => p.id === 'p1').content).meta.poster_url, pub('posters/alice_1_poster.jpg'));
  assert.equal(store.attachments[0].media_url, pub('posts/alice_2_a.png'), 'a size mismatch after upload is never published');
  assert.equal(store.attachments[1].media_url, OSS('posts/alice_2_b.png'));
});

test('可重复运行：OSS 上已有同大小对象就复用，不再从 Supabase 下载；已迁的引用第二次不再出现', async () => {
  const store = world(), d = deps(store);
  d.ossObjects.set('posts/alice_2_b.png', 1000);
  const first = await m.run({ store, deps: d, supabaseUrl: SB, apply: true });
  assert.equal(first.results.find(r => r.path === 'posts/alice_2_b.png').status, 'reused');
  assert.ok(!d.calls.some(c => c[0] === 'download' && c[1] === 'posts/alice_2_b.png'), 'no egress for an object that is already on OSS');
  const again = await m.run({ store, deps: deps(store), supabaseUrl: SB, apply: true });
  assert.equal(again.candidates, 0, 'everything referenced is already on OSS');
});

test('下载额度：超过 --max-bytes 就停，已迁的保留，没迁的不动', async () => {
  const store = world(), d = deps(store);
  const summary = await m.run({ store, deps: d, supabaseUrl: SB, apply: true, maxBytes: 2500 });
  const statuses = summary.results.map(r => r.status);
  assert.equal(statuses.filter(s => s === 'migrated').length, 2);
  assert.equal(statuses[2], 'budget_exhausted');
  assert.equal(summary.results.length, 3, 'stops at the first object that does not fit');
  assert.ok(summary.downloaded_bytes <= 2500);
  assert.equal((await m.run({ store, deps: null, supabaseUrl: SB, apply: false, limit: 2 })).results.length, 2, '--limit works');
});

test('数据库改动是「旧值相同才改」：被别人同时改过的引用不会被覆盖，并如实报告', async () => {
  const store = world();
  const d = deps(store);
  const realSwap = store.swap;
  store.swap = async (table, id, field, from, to) => { if (table === 'post_attachments' && id === 1) store.attachments[0].media_url = pub('posts/changed_by_someone.png'); return realSwap(table, id, field, from, to); };
  const summary = await m.run({ store, deps: d, supabaseUrl: SB, apply: true });
  const shared = summary.results.find(r => r.path === 'posts/alice_2_a.png');
  assert.equal(shared.status, 'rewrite_partial');
  assert.equal(shared.failed, 1);
  assert.equal(store.attachments[0].media_url, pub('posts/changed_by_someone.png'), 'the concurrent edit survives');
});

test('生产的数据库写入带条件：update … where id = ? and 字段 = 旧值，只有改到恰好一行才算成功', async () => {
  const log = [];
  const db = { from(table) { const q = { update(patch) { log.push(['update', table, patch]); return q; }, eq(c, v) { log.push(['eq', c, v]); return q; }, select() { return Promise.resolve({ data: [{ id: 'p1' }], error: null }); } }; return q; } };
  const store = m.supabaseStore(db, SB);
  assert.equal(await store.swap('posts', 'p1', 'media_url', 'old', 'new'), true);
  assert.deepEqual(log, [['update', 'posts', { media_url: 'new' }], ['eq', 'id', 'p1'], ['eq', 'media_url', 'old']]);
  const none = m.supabaseStore({ from() { const q = { update() { return q; }, eq() { return q; }, select() { return Promise.resolve({ data: [], error: null }); } }; return q; } }, SB);
  assert.equal(await none.swap('posts', 'p1', 'media_url', 'old', 'new'), false);
  const broken = m.supabaseStore({ from() { const q = { update() { return q; }, eq() { return q; }, select() { return Promise.resolve({ data: null, error: { message: 'down' } }); } }; return q; } }, SB);
  await assert.rejects(() => broken.swap('posts', 'p1', 'media_url', 'old', 'new'), /db_write_failed/);
});

test('帖子内容太长、「旧值相同才改」的网址会超限时，明确跳过并报告，引用保持指向 Supabase', async () => {
  const store = world();
  const long = '汉'.repeat(1500); // encodes to far more than the request-URL budget
  const p1 = store.posts.find(p => p.id === 'p1');
  p1.content = JSON.stringify({ __type: '__xtj_post_v2__', text: long, meta: { poster_url: pub('posters/alice_1_poster.jpg') } });
  const d = deps(store);
  const summary = await m.run({ store, deps: d, supabaseUrl: SB, apply: true });
  const poster = summary.results.find(r => r.path === 'posters/alice_1_poster.jpg');
  assert.equal(poster.status, 'rewrite_partial');
  assert.deepEqual(poster.content_too_long_post_ids, ['p1']);
  assert.ok(JSON.parse(p1.content).meta.poster_url.startsWith(SB), 'the long post still points at Supabase, nothing was half-written');
  assert.equal(store.writes.filter(w => w[0] === 'posts' && w[1] === 'p1' && w[2] === 'content').length, 0, 'no doomed request was attempted');
  assert.equal(m.MAX_FILTER_VALUE, 6000);
});
