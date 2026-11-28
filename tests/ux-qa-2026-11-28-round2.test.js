'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { chromium } = require('playwright');
const { createStaticCompressor, jsonCompressMiddleware } = require('../render-api/static-compress');

const ROOT = path.resolve(__dirname, '..');

test('static-compress serves Brotli/Gzip, 304 ETag, skips Range/SSE/media and blocks traversal', async () => {
  const app = express();
  app.use(jsonCompressMiddleware);
  app.get('/api/big', (req, res) => {
    res.json({ ok: true, items: Array.from({ length: 80 }, (_, i) => ({ id: i, text: 'hello world compression test ' + i })) });
  });
  app.get('/api/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.end('data: {"ok":true}\n\n');
  });
  app.use(createStaticCompressor(ROOT));
  app.use(express.static(ROOT));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;

  function fetchRaw(urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get(origin + urlPath, { headers }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  }

  try {
    const rawSize = fs.statSync(path.join(ROOT, 'js/core.min.js')).size;
    const brRes = await fetchRaw('/js/core.min.js?v=86203c0331', { 'Accept-Encoding': 'br, gzip' });
    assert.equal(brRes.status, 200);
    assert.equal(brRes.headers['content-encoding'], 'br');
    assert.match(String(brRes.headers['cache-control'] || ''), /immutable/);
    assert.ok(brRes.body.length < rawSize * 0.4, `expected Brotli < 40% of raw (${brRes.body.length} vs ${rawSize})`);
    assert.equal(zlib.brotliDecompressSync(brRes.body).length, rawSize);

    // Conditional 304
    const notMod = await fetchRaw('/js/core.min.js?v=86203c0331', {
      'Accept-Encoding': 'br',
      'If-None-Match': brRes.headers.etag
    });
    assert.equal(notMod.status, 304);

    // Gzip fallback
    const gzRes = await fetchRaw('/css/style.min.css', { 'Accept-Encoding': 'gzip' });
    assert.equal(gzRes.status, 200);
    assert.equal(gzRes.headers['content-encoding'], 'gzip');

    // Range request skips compressor
    const rangeRes = await fetchRaw('/js/core.min.js', { 'Accept-Encoding': 'br', Range: 'bytes=0-15' });
    assert.equal(rangeRes.headers['content-encoding'], undefined);

    // Sensitive / non-public paths and traversal are never compressed/served by static-compress
    for (const badPath of ['/../../package.json', '/package.json', '/render-api/server.js', '/.env']) {
      const badRes = await fetchRaw(badPath, { 'Accept-Encoding': 'br' });
      assert.notEqual(badRes.headers['content-encoding'], 'br', 'must not compress ' + badPath);
    }

    // JSON compression works & skips SSE
    const jsonRes = await fetchRaw('/api/big', { 'Accept-Encoding': 'br, gzip' });
    assert.equal(jsonRes.status, 200);
    assert.equal(jsonRes.headers['content-encoding'], 'br');
    const parsed = JSON.parse(zlib.brotliDecompressSync(jsonRes.body).toString('utf8'));
    assert.equal(parsed.items.length, 80);

    const sseRes = await fetchRaw('/api/sse', { 'Accept-Encoding': 'br, gzip' });
    assert.equal(sseRes.headers['content-encoding'], undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('index.html defers photo-wall scripts via prefetch rather than high-priority preload', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /rel="preload"[^>]*js\/photo-wall\//);
  assert.match(html, /rel="prefetch"[^>]*js\/photo-wall\/photo-wall\.min\.js/);
  assert.match(html, /rel="preload"[^>]*js\/core\.min\.js/);
});

test('browser QA regression: group sheet clickable, Cat AI keeps Dock + dark skeleton, dark chat/history uniformity, 50% photo info, flat more link', async () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(jsonCompressMiddleware);

  const gid = '11111111-2222-4333-8444-555555555555';
  const postId = '8c1cb02d-74d0-4e45-9e15-000000000001';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#2c5347"/></svg>';

  app.get('/qa-img.svg', (req, res) => { res.type('image/svg+xml').send(svg); });
  app.post('/api/user/refresh', (req, res) => res.json({ ok: true, user_name: 'xxz', token: 'qa-token', expires_at: Date.now() + 3600000 }));
  app.get('/api/user/session', (req, res) => res.json({ ok: true, authenticated: true, user_name: 'xxz' }));
  app.get('/api/users/directory', (req, res) => res.json({ ok: true, users: [{ user_name: 'xtj' }, { user_name: 'alice' }] }));
  app.get('/api/user/profile', (req, res) => res.json({ ok: true, user_name: 'xxz' }));
  app.get('/api/profile/settings', (req, res) => res.json({ ok: true, settings: {} }));
  app.get('/api/profile/records', (req, res) => res.json({
    ok: true,
    items: [{ id: 'r1', post_id: postId, author: 'xxz', text: '记录1', media_type: 'text', created_at: '2026-11-28T10:00:00Z', available: true }],
    has_more: true, next_cursor: { at: '2026-11-20T00:00:00Z', id: 'r1' }
  }));
  app.get('/api/stats/snapshot', (req, res) => res.json({ ok: true, posts: 1, views: 5, likes: 1, comments: 0 }));
  app.get('/api/report/notifications', (req, res) => res.json({ ok: true, unread: 0, notifications: [] }));
  app.get('/api/announcements', (req, res) => res.json({ ok: true, announcements: [] }));
  app.get('/api/avatars/batch', (req, res) => res.json({ ok: true, avatars: {} }));
  app.post('/api/avatars/batch', (req, res) => res.json({ ok: true, avatars: {} }));
  app.get('/api/feed', (req, res) => res.json({
    ok: true,
    posts: [{
      id: postId, user_name: 'xxz', content: '测试帖子', media_type: 'image', media_url: '/qa-img.svg',
      visibility: 'public', visibility_mode: 'public', created_at: '2026-11-28T10:00:00Z',
      views: 5, like_count: 1, comment_count: 0, liked_by_me: false,
      media_items: [{ id: 'm1', position: 0, media_type: 'image', media_url: '/qa-img.svg', width: 400, height: 400 }]
    }],
    comments: [], likes: [], total_post_count: 1, next_offset: 1, endReached: true
  }));
  app.get('/api/dm/list', (req, res) => res.json({
    ok: true,
    data: [{ id: 'dm-1', user_name: 'xtj', media_url: 'xxz', content: '你好', created_at: '2026-11-28T12:00:00Z', read_at: null }],
    conversations: [{ peer_name: 'xtj', last_message: '你好', last_at: '2026-11-28T12:00:00Z', unread_count: 1 }]
  }));
  app.get('/api/dm/messages', (req, res) => res.json({
    ok: true,
    data: [{ id: 'dm-1', user_name: 'xtj', media_url: 'xxz', content: '你好', created_at: '2026-11-28T12:00:00Z', read_at: null }],
    has_more: false
  }));
  app.post('/api/dm/read', (req, res) => res.json({ ok: true, updated: 1 }));
  app.get('/api/chat/friends', (req, res) => res.json({ ok: true, friends: [{ peer_name: 'xtj', mutual: true, relation_status: 'mutual' }] }));
  app.get('/api/chat/social/summary', (req, res) => res.json({ ok: true, pending_requests: 0, friends_count: 1 }));
  app.get('/api/chat/social/relationship/:peer', (req, res) => res.json({ ok: true, is_friend: true, mutual: true }));
  app.get('/api/chat/history/search', (req, res) => res.json({
    ok: true,
    items: [{ message_id: 'dm-1', peer_name: 'xtj', sender_name: 'xtj', body: '历史消息测试', message_type: 'text', sent_at: '2026-11-27T12:00:00Z', payload: {} }],
    has_more: false
  }));
  app.get('/api/groups', (req, res) => res.json({
    ok: true,
    groups: [{ id: gid, name: 'xtj、xxz', member_count: 2, unread: 0, last_message: { kind: 'text', sender: 'xtj', text: 'hi', created_at: '2026-11-28T12:00:00Z' } }]
  }));
  app.get('/api/groups/:id', (req, res) => res.json({
    ok: true,
    group: { id: gid, name: 'xtj、xxz', member_count: 2, owner: 'xxz', invite_policy: 'all', join_approval: false, mute_all: false },
    me: { role: 'owner', nickname: '', muted: false },
    members: [{ user_name: 'xxz', role: 'owner', active: true }, { user_name: 'xtj', role: 'member', active: true }]
  }));
  app.get('/api/groups/:id/messages', (req, res) => res.json({ ok: true, messages: [], has_more: false }));
  app.post('/api/groups/:id/actions', (req, res) => res.json({ ok: true }));
  app.get('/api/agent/config', (req, res) => res.json({ ok: true, name: '小猫', description: 'AI', models: [], default_model: 'deepseek-flash' }));
  app.get('/api/agent/quota', (req, res) => res.json({ ok: true, daily_used: 0, daily_limit: 50 }));
  app.get('/api/agent/conversations', (req, res) => res.json({ ok: true, conversations: [] }));
  app.get('/api/agent/history', (req, res) => res.json({ ok: true, messages: [], has_more: false }));
  app.use('/api', (req, res) => res.json({ ok: true }));
  app.use(createStaticCompressor(ROOT));
  app.use(express.static(ROOT));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    // 1. Cold Cat AI dark skeleton on iOS stacking context: dark bg + visible/clickable bottom Dock
    const skelCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const skelPage = await skelCtx.newPage();
    await skelPage.addInitScript(() => {
      localStorage.setItem('xtj_user', 'xxz');
      localStorage.setItem('xtj_theme', 'dark');
      localStorage.setItem('xtj_user_token', 'qa-token');
      const applyIos = () => {
        if (!document.documentElement) return;
        document.documentElement.classList.add('xtj-ios-viewport');
        document.documentElement.style.setProperty('--xtj-app-height', '844px');
      };
      if (document.documentElement) applyIos();
      else document.addEventListener('DOMContentLoaded', applyIos, { once: true });
    });
    await skelPage.route('**/js/ai-agent*.js*', () => {});
    await skelPage.route('**/css/ai-agent*.css*', () => {});
    await skelPage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await skelPage.waitForSelector('.dock-tab[data-tab="ai-chat"]');
    await skelPage.locator('.dock-tab[data-tab="ai-chat"]').click();
    await skelPage.waitForSelector('#panelAiChat.active .ai-chat-skeleton');
    const skel = await skelPage.evaluate(() => {
      const panel = document.getElementById('panelAiChat');
      const postsTab = document.querySelector('.dock-tab[data-tab="posts"]');
      const r = postsTab.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        bg: getComputedStyle(panel).backgroundColor,
        inApp: !!panel.closest('.app-container'),
        dockClickable: !!(top && postsTab.contains(top)),
        panelsHidden: getComputedStyle(document.getElementById('dockPanels')).visibility === 'hidden'
      };
    });
    assert.equal(skel.bg, 'rgb(11, 11, 16)');
    assert.equal(skel.inApp, true);
    assert.equal(skel.dockClickable, true);
    assert.equal(skel.panelsHidden, true);
    await skelPage.locator('.dock-tab[data-tab="posts"]').click();
    await skelPage.waitForFunction(() => !document.body.classList.contains('xtj-ai-page-open'));
    await skelCtx.close();

    // 2. Main mobile dark flow
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('xtj_user', 'xxz');
      localStorage.setItem('xtj_theme', 'dark');
      localStorage.setItem('xtj_user_token', 'qa-token');
      const applyIos = () => {
        if (!document.documentElement) return;
        document.documentElement.classList.add('xtj-ios-viewport');
        document.documentElement.style.setProperty('--xtj-app-height', '844px');
      };
      if (document.documentElement) applyIos();
      else document.addEventListener('DOMContentLoaded', applyIos, { once: true });
    });
    await page.goto(origin + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#feed .post .post-tools-trigger');

    // Refined visibility modal
    await page.locator('#feed .post .post-tools-trigger').first().scrollIntoViewIfNeeded();
    await page.locator('#feed .post .post-tools-trigger').first().click();
    await page.locator('.post-tools-menu [data-post-tool="visibility"]').click({ force: true });
    await page.waitForSelector('#postVisibilityModal .post-vis-dialog');
    assert.equal(await page.locator('#postVisibilityModal .post-vis-icon svg').count(), 4);
    await page.locator('#postVisibilityModal .post-vis-close').click();

    // Photo info modal ~50% translucent
    await page.locator('#feed .post img').first().click();
    await page.waitForSelector('#photoPreviewOverlay.active');
    await page.locator('#ppInfoBtn').click();
    await page.waitForSelector('#ppInfoModal.active');
    const alpha = await page.evaluate(() => {
      const m = getComputedStyle(document.querySelector('#photoPreviewOverlay .pp-info-modal-content')).backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    });
    assert.ok(alpha >= 0.42 && alpha <= 0.56, `expected ~0.50 alpha, got ${alpha}`);
    await page.locator('.pp-info-modal-close').click();
    await page.locator('.photo-preview-close').click();

    // Chat create group sheet clickable & closes on X and on tab switch
    await page.locator('.dock-tab[data-tab="chat"]').click();
    await page.waitForSelector('#chatGroupCreateButton');
    await page.locator('#chatGroupCreateButton').click();
    await page.waitForSelector('.grp-sheet .grp-pick-row');
    const grp = await page.evaluate(() => {
      const s = document.querySelector('.grp-sheet');
      const closeBtn = s.querySelector('[data-sheet-close]');
      const r = closeBtn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inert: s.inert, closeHit: !!(top && closeBtn.contains(top)) };
    });
    assert.equal(grp.inert, false);
    assert.equal(grp.closeHit, true);
    await page.locator('.grp-sheet .grp-pick-row').first().click();
    assert.equal(await page.locator('#grpPickConfirm').isEnabled(), true);
    await page.locator('.grp-sheet [data-sheet-close]').first().click();
    await page.waitForFunction(() => !document.querySelector('.grp-sheet'));

    // Switching tab also cleans up any open .grp-sheet
    await page.locator('#chatGroupCreateButton').click();
    await page.waitForSelector('.grp-sheet');
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts'); });
    await page.waitForFunction(() => !document.querySelector('.grp-sheet'));
    await page.locator('.dock-tab[data-tab="chat"]').click();
    await page.waitForSelector('#dockGroupList [data-group-id]');

    // Group chat, DM & history dark uniformity (#0b0b10)
    await page.locator('#dockGroupList [data-group-id]').first().click();
    await page.waitForSelector('#groupChatView:not([hidden])');
    const grpBg = await page.evaluate(() => ({
      outer: getComputedStyle(document.getElementById('panelChat')).backgroundColor,
      view: getComputedStyle(document.getElementById('groupChatView')).backgroundColor,
      head: getComputedStyle(document.querySelector('#groupChatView .grp-head')).backgroundColor
    }));
    assert.deepEqual(grpBg, { outer: 'rgb(11, 11, 16)', view: 'rgb(11, 11, 16)', head: 'rgb(11, 11, 16)' });
    await page.locator('#groupChatView [data-grp="back"]').click();

    await page.locator('#chatMediaButton').click();
    await page.waitForSelector('#chatHistoryResults .chat-history-result');
    const histBg = await page.evaluate(() => ({
      panel: getComputedStyle(document.getElementById('chatHistoryPanel')).backgroundColor,
      jumpBg: getComputedStyle(document.querySelector('#chatHistoryResults .chat-history-jump')).backgroundColor
    }));
    assert.equal(histBg.panel, 'rgb(11, 11, 16)');
    assert.equal(histBg.jumpBg, 'rgba(0, 0, 0, 0)');
    await page.locator('#chatHistoryClose').click();

    await page.locator('#dockChatList .chat-list-item[data-chat-user="xtj"]').click();
    await page.waitForSelector('#dockChatDetailView:not(.hidden)');
    const dmBg = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector('#dockChatContainer .chat-header')).backgroundColor,
      input: getComputedStyle(document.querySelector('#dockChatContainer .chat-input-area')).backgroundColor
    }));
    assert.deepEqual(dmBg, { header: 'rgb(11, 11, 16)', input: 'rgb(11, 11, 16)' });
    await page.locator('#dockChatBackBtn').click();

    // Profile -> My Posts flat "查看更多"
    await page.locator('.dock-tab[data-tab="profile"]').click();
    await page.waitForSelector('#profilePostsCard');
    await page.locator('#profilePostsCard').click();
    await page.waitForSelector('#profileActivityModal.active .profile-record-more');
    const more = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#profileActivityModal .profile-record-more'));
      return { bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow };
    });
    assert.deepEqual(more, { bg: 'rgba(0, 0, 0, 0)', radius: '0px', shadow: 'none' });
    await page.locator('#profileActivityModal .stat-close-btn').click();

    // Loaded Cat AI keeps bottom Dock clickable on mobile iOS
    await page.locator('.dock-tab[data-tab="ai-chat"]').click();
    await page.waitForSelector('#panelAiChat #aiChatRoot', { timeout: 12000 });
    const aiLoaded = await page.evaluate(() => {
      const postsTab = document.querySelector('.dock-tab[data-tab="posts"]');
      const r = postsTab.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        inApp: !!document.getElementById('panelAiChat').closest('.app-container'),
        dockClickable: !!(top && postsTab.contains(top))
      };
    });
    assert.deepEqual(aiLoaded, { inApp: true, dockClickable: true });
    assert.deepEqual(pageErrors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
