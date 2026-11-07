#!/usr/bin/env node
'use strict';
// 把存量帖子媒体从 Supabase 迁到阿里云 OSS（决策文档 2026-11-02：新帖已直传 OSS，存量等额度重置后迁移）。
//
//   node scripts/migrate-post-media-to-oss.js                 演练（默认）：只读数据库，列出要迁的对象，不下载、不上传、不改任何东西
//   node scripts/migrate-post-media-to-oss.js --apply         真迁
//   选项：--max-bytes=N  本次最多从 Supabase 下载 N 字节（默认 300MB，超出就停；Supabase 出站是稀缺额度）
//         --limit=N      最多处理 N 个对象（先试几个）
//
// 环境变量（与服务端同名）：SUPABASE_URL、SUPABASE_SERVICE_KEY、OSS_BUCKET、OSS_ENDPOINT、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET。
//
// 范围与安全：
//   - 只迁 uploads 桶里「未删除的普通帖子」自己引用的媒体：posts.media_url、post_attachments.media_url、帖子内容元数据里的 thumbs / poster_url。
//     私聊桶（dm-private / dm-flash）、照片墙桶（photo-wall，有可见范围）、头像永远不在范围内。
//   - 每个对象的顺序：确认源文件存在 → 若 OSS 上已有同大小对象就复用（不再下载）→ 下载 → 上传 → 回查 OSS 大小一致 → 才改数据库
//     （带「旧值相同才改」的条件，并发改动不会被覆盖）。任何一步失败，这个对象的数据库引用保持原样，仍指向 Supabase。
//   - 不删除 Supabase 上的源文件：它们是备份，留着不花额度（只有被下载才计出站）。确认线上一切正常后，由人决定是否清理。
//   - 可重复运行：已迁的对象第二次会被识别为「已在 OSS」直接跳过。
const crypto = require('node:crypto');

const MAX_DEFAULT_BYTES = 300 * 1024 * 1024;
const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const NAME_CHARS = /[^a-zA-Z0-9_一-鿿.-]/g;
const KEY_RE = /^(?:posts|posters)\/[a-zA-Z0-9_一-鿿.-]{1,200}$/;
const PUBLIC_PREFIX = '/storage/v1/object/public/uploads/';
const MEDIA_TYPES = ['image', 'video', 'audio', 'photo', 'album'];
const TYPE_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };

// 旧帖的 media_url 直接挂在 uploads 根目录（没有 posts/ 前缀），OSS 读取侧只认 posts/ 与 posters/，所以统一搬到 posts/legacy_<原名>。
function sanitizeName(name) { return String(name || '').replace(NAME_CHARS, '_'); }
function ossKeyFor(path) {
  const value = String(path || '');
  if (!value || value.includes('..') || value.includes('\\')) return null;
  if (KEY_RE.test(value)) return value;
  if (!value.includes('/')) {
    const clean = sanitizeName(value);
    const room = 200 - 'legacy_'.length;
    const name = 'legacy_' + (clean.length > room ? clean.slice(0, room - 9) + '_' + crypto.createHash('sha1').update(value).digest('hex').slice(0, 8) : clean);
    const key = 'posts/' + name;
    return KEY_RE.test(key) ? key : null;
  }
  return null; // chat/、avatars/、profile-images/ 等其他前缀不属于帖子媒体
}

function publicPathOf(url, supabaseUrl) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.origin !== new URL(supabaseUrl).origin || u.search || u.hash || !u.pathname.startsWith(PUBLIC_PREFIX)) return null;
    return decodeURIComponent(u.pathname.slice(PUBLIC_PREFIX.length));
  } catch (_) { return null; }
}

function contentMetaUrls(content) {
  let parsed = null;
  try { parsed = JSON.parse(String(content || '')); } catch (_) { return []; }
  const meta = parsed && parsed.__type === '__xtj_post_v2__' && parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : null;
  if (!meta) return [];
  return [].concat(Array.isArray(meta.thumbs) ? meta.thumbs : [], meta.poster_url ? [meta.poster_url] : []).filter(url => typeof url === 'string');
}

// 汇总成「源路径 → 引用它的地方」。store 是读写数据库的小接口，便于测试。
async function collectPlan(store, supabaseUrl) {
  const byPath = new Map();
  const add = (url, ref) => {
    const path = publicPathOf(url, supabaseUrl);
    if (!path) return;
    if (!byPath.has(path)) byPath.set(path, { path, refs: [] });
    byPath.get(path).refs.push(Object.assign({ url }, ref));
  };
  for (const row of await store.listPostMedia()) add(row.media_url, { table: 'posts', id: row.id, field: 'media_url' });
  for (const row of await store.listAttachmentMedia()) add(row.media_url, { table: 'post_attachments', id: row.id, field: 'media_url' });
  for (const row of await store.listContentWithMeta()) for (const url of contentMetaUrls(row.content)) add(url, { table: 'posts', id: row.id, field: 'content', content: row.content });
  const entries = [], skipped = [], used = new Map();
  for (const entry of Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path))) {
    let key = ossKeyFor(entry.path);
    if (!key) { skipped.push({ path: entry.path, reason: 'unsupported_prefix' }); continue; }
    if (used.has(key) && used.get(key) !== entry.path) {
      const alt = ossKeyFor(entry.path + '_' + crypto.createHash('sha1').update(entry.path).digest('hex').slice(0, 8));
      if (!alt || used.has(alt)) { skipped.push({ path: entry.path, reason: 'key_collision' }); continue; }
      key = alt;
    }
    used.set(key, entry.path);
    entries.push(Object.assign(entry, { key }));
  }
  return { entries, skipped };
}

function guessType(path, declared) {
  const type = String(declared || '').split(';')[0].trim().toLowerCase();
  if (/^(image|video|audio)\/[a-z0-9.+-]+$/.test(type)) return type;
  const ext = String(path).split('.').pop().toLowerCase();
  return TYPE_BY_EXT[ext] || 'application/octet-stream';
}

// deps: sourceHead(path)->{size,contentType}|null · download(path)->Buffer · ossHead(key)->{size}|null · ossPut(key,buffer,{contentType,cacheControl})->{url}
//       ossUrl(key)->string · rewrite(entry,newUrl)->{updated,failed}
async function migrateEntry(entry, deps, budget) {
  const source = await deps.sourceHead(entry.path);
  if (!source || !Number.isFinite(source.size)) return { path: entry.path, key: entry.key, status: 'source_missing' };
  const existing = await deps.ossHead(entry.key);
  let reused = false;
  if (existing && existing.size === source.size) reused = true;
  else {
    if (budget.used + source.size > budget.max) return { path: entry.path, key: entry.key, status: 'budget_exhausted', bytes: source.size };
    const buffer = await deps.download(entry.path);
    if (!Buffer.isBuffer(buffer) || buffer.length !== source.size) return { path: entry.path, key: entry.key, status: 'download_mismatch', bytes: source.size };
    budget.used += buffer.length;
    await deps.ossPut(entry.key, buffer, { contentType: guessType(entry.path, source.contentType), cacheControl: OBJECT_CACHE_CONTROL });
    const check = await deps.ossHead(entry.key);
    if (!check || check.size !== buffer.length) return { path: entry.path, key: entry.key, status: 'verify_failed', bytes: buffer.length };
  }
  const rewritten = await deps.rewrite(entry, deps.ossUrl(entry.key));
  return { path: entry.path, key: entry.key, status: rewritten.failed ? 'rewrite_partial' : (reused ? 'reused' : 'migrated'), bytes: source.size, updated: rewritten.updated, failed: rewritten.failed };
}

async function run({ store, deps, supabaseUrl, apply, maxBytes, limit, log }) {
  const plan = await collectPlan(store, supabaseUrl);
  const entries = limit ? plan.entries.slice(0, limit) : plan.entries;
  const summary = { apply: !!apply, candidates: plan.entries.length, skipped: plan.skipped, results: [], downloaded_bytes: 0 };
  if (!apply) { summary.results = entries.map(e => ({ path: e.path, key: e.key, refs: e.refs.length, status: 'dry_run' })); return summary; }
  const budget = { used: 0, max: Number.isFinite(maxBytes) ? maxBytes : MAX_DEFAULT_BYTES };
  for (const entry of entries) {
    let result;
    try { result = await migrateEntry(entry, deps, budget); }
    catch (error) { result = { path: entry.path, key: entry.key, status: 'error', error: String(error && error.message || error).slice(0, 200) }; }
    summary.results.push(result);
    if (log) log(result);
    if (result.status === 'budget_exhausted') break;
  }
  summary.downloaded_bytes = budget.used;
  return summary;
}

// ---- 生产实现：Supabase 读写与 Supabase/OSS 的 HTTP ----
function supabaseStore(db, supabaseUrl) {
  const like = '%' + PUBLIC_PREFIX + '%';
  async function pages(build) {
    const rows = [];
    for (let from = 0; ; from += 500) {
      const result = await build().range(from, from + 499);
      if (result.error) throw new Error('db_read_failed ' + (result.error.message || result.error.code));
      rows.push(...(result.data || []));
      if (!result.data || result.data.length < 500) break;
    }
    return rows;
  }
  return {
    listPostMedia: () => pages(() => db.from('posts').select('id,media_url').or('is_deleted.is.null,is_deleted.eq.false').in('media_type', MEDIA_TYPES).ilike('media_url', like).order('id')),
    listContentWithMeta: () => pages(() => db.from('posts').select('id,content').or('is_deleted.is.null,is_deleted.eq.false').ilike('content', '%__xtj_post_v2__%').ilike('content', like).order('id')),
    async listAttachmentMedia() {
      const rows = await pages(() => db.from('post_attachments').select('id,post_id,media_url').ilike('media_url', like).order('id'));
      const alive = new Set();
      const ids = Array.from(new Set(rows.map(r => r.post_id)));
      for (let i = 0; i < ids.length; i += 100) {
        const result = await db.from('posts').select('id').in('id', ids.slice(i, i + 100)).or('is_deleted.is.null,is_deleted.eq.false');
        if (result.error) throw new Error('db_read_failed ' + (result.error.message || result.error.code));
        (result.data || []).forEach(r => alive.add(r.id));
      }
      return rows.filter(r => alive.has(r.post_id));
    },
    // 「旧值相同才改」：并发改动不会被覆盖。返回是否真的改到了一行。
    async swap(table, id, field, from, to) {
      const result = await db.from(table).update({ [field]: to }).eq('id', id).eq(field, from).select('id');
      if (result.error) throw new Error('db_write_failed ' + (result.error.message || result.error.code));
      return Array.isArray(result.data) && result.data.length === 1;
    }
  };
}

function makeRewrite(store) {
  // 同一个帖子的内容里可能同时有封面和多张缩略图，它们分属不同对象、先后改写：
  // 后一次要在前一次改完的内容上继续改，所以「该帖子内容的最新值」要在整次运行里共享，不能每个对象各记一份旧快照。
  const contentRows = new Map();
  return async function rewrite(entry, newUrl) {
    let updated = 0, failed = 0;
    for (const ref of entry.refs) {
      try {
        let ok;
        if (ref.field === 'content') {
          const current = contentRows.has(ref.id) ? contentRows.get(ref.id) : ref.content;
          const next = current.split(ref.url).join(newUrl);
          ok = next === current ? true : await store.swap('posts', ref.id, 'content', current, next);
          if (ok) contentRows.set(ref.id, next);
        } else ok = await store.swap(ref.table, ref.id, ref.field, ref.url, newUrl);
        if (ok) updated += 1; else failed += 1;
      } catch (_) { failed += 1; }
    }
    return { updated, failed };
  };
}

function productionDeps({ supabaseUrl, serviceKey, ossMedia, store, fetchImpl }) {
  const f = fetchImpl || fetch;
  const auth = { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey };
  const objectUrl = path => supabaseUrl.replace(/\/+$/, '') + '/storage/v1/object/uploads/' + path.split('/').map(encodeURIComponent).join('/');
  return {
    async sourceHead(path) {
      const res = await f(objectUrl(path), { method: 'HEAD', headers: auth });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error('source_head_' + res.status);
      return { size: Number(res.headers.get('content-length')), contentType: res.headers.get('content-type') };
    },
    async download(path) {
      const res = await f(objectUrl(path), { headers: auth });
      if (!res.ok) throw new Error('download_' + res.status);
      return Buffer.from(await res.arrayBuffer());
    },
    async ossHead(key) {
      const res = await f(ossMedia.publicUrl(key), { method: 'HEAD' });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error('oss_head_' + res.status);
      return { size: Number(res.headers.get('content-length')) };
    },
    ossPut: (key, buffer, options) => ossMedia.putObject(key, buffer, options),
    ossUrl: key => ossMedia.publicUrl(key),
    rewrite: makeRewrite(store)
  };
}

function parseArgs(argv) {
  const out = { apply: false, maxBytes: MAX_DEFAULT_BYTES, limit: 0 };
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true;
    else if (/^--max-bytes=\d+$/.test(arg)) out.maxBytes = Number(arg.split('=')[1]);
    else if (/^--limit=\d+$/.test(arg)) out.limit = Number(arg.split('=')[1]);
    else throw new Error('未知参数：' + arg);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) { console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(2); }
  const ossMedia = require('../render-api/oss-media');
  if (args.apply && !ossMedia.enabled()) { console.error('缺少 OSS_BUCKET / OSS_ENDPOINT / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET，无法迁移'); process.exit(2); }
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = supabaseStore(db, supabaseUrl);
  const summary = await run({ store, supabaseUrl, apply: args.apply, maxBytes: args.maxBytes, limit: args.limit,
    deps: args.apply ? productionDeps({ supabaseUrl, serviceKey, ossMedia, store }) : null, log: r => console.log(JSON.stringify(r)) });
  console.log(JSON.stringify({ apply: summary.apply, candidates: summary.candidates, skipped: summary.skipped, downloaded_bytes: summary.downloaded_bytes,
    by_status: summary.results.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}) }, null, 2));
  if (!args.apply) { console.log('演练结束：没有下载、上传或修改任何东西。确认无误后加 --apply 真迁（建议先 --limit=1）。'); summary.results.forEach(r => console.log('  ' + r.path + ' -> ' + r.key + '  (' + r.refs + ' 处引用)')); }
  if (summary.results.some(r => ['error', 'verify_failed', 'download_mismatch', 'rewrite_partial'].includes(r.status))) process.exitCode = 1;
}

module.exports = { ossKeyFor, publicPathOf, contentMetaUrls, collectPlan, migrateEntry, run, makeRewrite, supabaseStore, parseArgs, guessType, MAX_DEFAULT_BYTES, OBJECT_CACHE_CONTROL };
if (require.main === module) main().catch(error => { console.error('迁移失败：', error && error.message || error); process.exit(1); });
