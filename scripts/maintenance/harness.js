'use strict';
// Maintenance harness: opens the real site in headless Chromium with every /api and Supabase call mocked, so a
// module can be driven end to end (feed, photo wall, chat, profile, AI) without a backend.
//
//   const { open, shot } = require('./harness');
//   const s = await open({ theme: 'dark', viewport: { width: 390, height: 844 } });
//   await s.page.locator('.dock-tab').nth(3).click();
//   await shot(s.page, 'photo-wall-dark');          // -> output/maintenance/photo-wall-dark.png (git-ignored)
//   console.log(s.errors, s.consoleMsgs, s.failed);  // page errors, console errors/warnings, failed requests
//   await s.close();
//
// The static server must already be running (see scripts/maintenance/serve.sh); XTJ_ORIGIN overrides the address.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DEFAULT_ORIGIN = process.env.XTJ_ORIGIN || 'http://127.0.0.1:4173';
// 2026-10-31 12:00 in Taipei. Mock timestamps are relative to it, so "N 分钟前" never changes between two runs.
const FIXED_NOW = Date.UTC(2026, 9, 31, 4, 0, 0);

// Console output caused by the mocked environment itself (no service worker, no realtime socket, no agent backend). It is
// dropped from consoleMsgs unless open({ keepNoise: true }); anything else a page logs is a real finding.
const NOISE = [
  /Service Worker registration blocked by Playwright/,
  /WebSocket connection to 'wss?:\/\/[^']*\/test-supabase\//,
  /\[CHAT-REALTIME\] CHANNEL_ERROR/,
  /\[AI-DIAG\/boot\]/,
  /\[AI-CONV\] 预拉取会话列表失败/,
  /\/test-supabase\//,
];
const isNoise = (text) => NOISE.some((re) => re.test(text));

// The harness needs a static server: the working tree on :4173 (serve.sh) or main on :4174 (baseline.sh). Start the right one
// when nothing answers, so a fresh session or a crashed server never costs a confusing "connection refused".
async function ensureServer(origin) {
  const url = new URL(origin);
  try { await fetch(origin + '/', { method: 'HEAD' }); return; } catch (_) { /* not running */ }
  if (url.hostname !== '127.0.0.1' || !['4173', '4174'].includes(url.port)) throw new Error(`nothing is listening on ${origin}`);
  const script = url.port === '4174' ? 'baseline.sh' : 'serve.sh';
  require('node:child_process').execFileSync(path.join(__dirname, script), [], { stdio: 'ignore' });
}

function outDir() {
  const dir = process.env.XTJ_OUT || path.join(process.cwd(), 'output', 'maintenance');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function shot(page, name, options = {}) {
  const file = path.join(outDir(), name.endsWith('.png') ? name : name + '.png');
  await page.screenshot({ path: file, ...options });
  return file;
}

function svgImg(i, w = 800, h = 600) {
  const sets = [
    ['#cfe9df', '#7fb8a4', '#2f6b5a'], ['#f4e3d0', '#d9a77a', '#8a5a3a'],
    ['#dbe4f2', '#8aa4cf', '#3d4f7a'], ['#f1dbe2', '#d58aa0', '#7a3d52'],
    ['#e6efd2', '#a9c26b', '#56702a'], ['#e9e2f5', '#a999d6', '#52408a'],
  ][i % 6];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sets[0]}"/><stop offset="1" stop-color="${sets[1]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.28}" r="${h * 0.09}" fill="#fff" opacity=".7"/><path d="M0 ${h}L${w * 0.3} ${h * 0.5}L${w * 0.55} ${h * 0.8}L${w * 0.78} ${h * 0.45}L${w} ${h * 0.9}V${h}Z" fill="${sets[2]}" opacity=".55"/></svg>`;
}

// Mock data: 7 posts (text, album of 4, 400-character text with an unbroken URL, private, single image, 9-image grid,
// one-liner), comments including a cat-AI reply and a nested reply, likes and 14 photos for the photo wall.
function buildData(user, origin = DEFAULT_ORIGIN, now = FIXED_NOW) {
  const ago = (m) => new Date(now - m * 60000).toISOString();
  const img = (n, i) => ({ id: `att-${n}-${i}`, position: i, media_type: 'image', media_url: `${origin}/test-image/${n}-${i}.svg`, width: 800, height: 600, file_size: 4000 });
  const posts = [
    { id: 'p-0001', user_name: 'xxz', content: '今天把照片墙整理了一遍，新增了「秋天」相册。欢迎大家去看看，也可以把自己的照片传上来。', created_at: ago(8), visibility: 'public', views: 128, pinned_at: ago(300), ip_region_text: '福建', ip_region_status: 'resolved' },
    { id: 'p-0002', user_name: 'alice', content: '周末去了一趟山里，空气特别好，拍了几张照片。', created_at: ago(55), visibility: 'public', views: 42, media_type: 'album', media_url: `${origin}/test-image/1-0.svg`, media_items: [0, 1, 2, 3].map((i) => img(1, i)), ip_region_text: '浙江', ip_region_status: 'resolved', location_name: '杭州' },
    { id: 'p-0003', user_name: 'bob', content: '一个很长的帖子：' + '这是一段用来测试长文本折叠与换行表现的内容，包含中英文 mixed English words and a-very-long-unbroken-token-https://example.com/this/is/a/really/long/url/that/should/wrap/properly/without/breaking/the/layout 。'.repeat(4), created_at: ago(180), visibility: 'public', views: 9 },
    { id: 'p-0004', user_name: 'alice', content: '只给自己看的备忘。', created_at: ago(600), visibility: 'private', views: 1 },
    { id: 'p-0005', user_name: 'carol', content: '单图帖子，看看单张图片的展示比例和圆角。', created_at: ago(1500), visibility: 'public', views: 77, media_type: 'image', media_url: `${origin}/test-image/2-0.svg`, media_items: [img(2, 0)] },
    { id: 'p-0006', user_name: 'dave', content: '九宫格测试 🍃', created_at: ago(2900), visibility: 'public', views: 15, media_type: 'album', media_url: `${origin}/test-image/3-0.svg`, media_items: Array.from({ length: 9 }, (_, i) => img(3, i)) },
    { id: 'p-0007', user_name: 'erin', content: '短。', created_at: ago(4000), visibility: 'public', views: 0 },
  ];
  const comments = [
    { id: 'c-1', post_id: 'p-0001', user_name: 'alice', content: '收到，马上去看！', created_at: ago(6) },
    { id: 'c-2', post_id: 'p-0001', user_name: 'cat_ai', generated_by_ai: true, content: '照片墙新增相册啦，秋天的色调很舒服～', created_at: ago(5) },
    { id: 'c-3', post_id: 'p-0001', user_name: 'bob', content: '回复 alice：一起', parent_comment_id: 'c-1', created_at: ago(4) },
    { id: 'c-4', post_id: 'p-0002', user_name: 'bob', content: '风景真好', created_at: ago(40) },
  ];
  const likes = [
    { id: 'l-1', post_id: 'p-0001', user_name: 'alice' }, { id: 'l-2', post_id: 'p-0001', user_name: 'bob' },
    { id: 'l-3', post_id: 'p-0002', user_name: user || 'alice' },
  ];
  const photos = Array.from({ length: 14 }, (_, i) => ({ id: `ph-${i}`, user_name: ['xxz', 'alice', 'bob', 'carol'][i % 4], media_url: `${origin}/test-image/${i % 6}-0.svg`, created_at: ago(30 + i * 700), visibility: 'public', width: 800, height: i % 3 ? 600 : 1000, views: i * 3, caption: i % 2 ? '秋日午后' : '' }));
  return { posts, comments, likes, photos };
}

// options: viewport, theme ('light'|'dark'), user (null = logged out), mobile (touch + mobile UA), dsf (device scale
// factor), reducedMotion, origin, fixedTime (freeze Date.now at FIXED_NOW), extraRoutes(url, req, body, data) -> a
// route.fulfill() object to override one mocked endpoint, init (function run before the page scripts), settleMs,
// keepNoise (also collect the console messages that only the mocked environment causes).
async function open(options = {}) {
  const {
    viewport = { width: 390, height: 844 }, theme = 'light', user = 'alice', mobile = true, dsf, reducedMotion = 'no-preference',
    origin = DEFAULT_ORIGIN, fixedTime = false, log = true, extraRoutes, init, settleMs = 1800, keepNoise = false,
  } = options;
  await ensureServer(origin);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: dsf || (mobile ? 2 : 1), colorScheme: theme, reducedMotion, serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Taipei' });
  const page = await ctx.newPage();
  if (fixedTime) await page.clock.setFixedTime(FIXED_NOW);
  const data = buildData(user, origin, FIXED_NOW);
  const calls = [], errors = [], consoleMsgs = [], failed = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const text = m.text();
    if (!keepNoise && isNoise(text)) return;
    consoleMsgs.push(m.type() + ': ' + text.slice(0, 300));
  });
  page.on('requestfailed', (r) => failed.push(r.url().slice(0, 120) + ' ' + (r.failure() && r.failure().errorText)));
  await page.addInitScript(({ user: u, theme: t }) => {
    try { if (u) localStorage.setItem('xtj_user', u); localStorage.setItem('xtj_theme', t); } catch (_) { /* storage blocked */ }
  }, { user, theme });
  if (init) await page.addInitScript(init);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/test-image/')) {
      const m = url.pathname.match(/(\d+)-(\d+)/);
      return route.fulfill({ contentType: 'image/svg+xml', headers: { 'cache-control': 'max-age=3600' }, body: svgImg(m ? +m[1] + +m[2] : 0) });
    }
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/test-supabase/')) return route.continue();
    let body = null;
    try { body = req.postData() ? req.postDataJSON() : null; } catch (_) { /* not JSON */ }
    if (log) calls.push(req.method() + ' ' + url.pathname + (url.search ? url.search.slice(0, 60) : ''));
    if (extraRoutes) { const r = await extraRoutes(url, req, body, data); if (r) return route.fulfill(r); }
    const p = url.pathname;
    let payload = { ok: true, data: [], items: [], users: [] };
    if (p === '/api/config/public') payload = { supabase_url: origin + '/test-supabase', supabase_anon_key: 'sb_publishable_test_only' };
    else if (p === '/api/user/refresh') payload = user ? { ok: true, token: 'test-token', user_name: user } : { ok: false };
    else if (p === '/api/feed') payload = { ok: true, posts: data.posts, comments: data.comments, likes: data.likes, next_offset: data.posts.length, next_cursor: null, endReached: true, total_post_count: data.posts.length };
    else if (p === '/api/avatar/batch') payload = { ok: true, avatars: {} };
    else if (p === '/api/dm/list') payload = { ok: true, data: [], muted_peers: [] };
    else if (p.startsWith('/api/photos/')) payload = { ok: true, photos: data.photos, data: data.photos, items: data.photos, next_cursor: null, endReached: true, total: data.photos.length };
    else if (p.startsWith('/test-supabase/')) payload = [];
    return route.fulfill({ status: 200, json: payload });
  });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleMs);
  return { browser, ctx, page, calls, errors, consoleMsgs, failed, data, origin, async close() { await browser.close(); } };
}

module.exports = { open, shot, outDir, svgImg, buildData, isNoise, DEFAULT_ORIGIN, FIXED_NOW };
