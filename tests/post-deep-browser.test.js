'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const source = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
const browserOptions = { executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] };
const id = '8c1cb02d-74d0-4e45-9e15-17f5cf3aa812';
function between(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a); return source.slice(a, b); }
async function commentPage(browser, options = {}) {
  const page = await browser.newPage(options);
  await page.setContent(`<div id="panelPosts"><div id="feed"><article class="post" data-post-id="${id}"><div class="actions"></div></article></div></div>`);
  await page.evaluate(() => {
    window.currentUser = 'alice'; window._authStateEpoch = 1; window.calls = []; window.toasts = []; window.cacheWrites = 0; window.feedAllComments = [];
    window.isUserMuted = () => false; window.showToast = text => toasts.push(text);
    window.findBySafePostSelector = id => document.querySelector(`.post[data-post-id="${id}"]`);
    window.touchUserSession = () => {}; window.writeFeedCacheSnapshot = () => cacheWrites++;
    window.__xtjSchedulePostCardPatch = () => {}; window.loadProfileActivity = async () => {}; window.pollCatAiReply = () => {};
    window.xtjProtectedFetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true, data: { id: 'comment', post_id: JSON.parse(options.body).post_id } }) }; };
  });
  await page.addScriptTag({ content: between('            function capturePostActionIdentity', '            function applyPostLikeIntent') });
  await page.addScriptTag({ content: between('            window.openComment = function', '            // ===================== 删除帖子') });
  await page.evaluate(id => openComment(id), id);
  return page;
}
for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
  test(`${name}: IME confirmation does not send a comment; normal Enter still sends once`, async () => {
    const browser = await chromium.launch(browserOptions);
    try {
      const page = await commentPage(browser, { viewport });
      await page.locator('.inline-comment-inp').fill('中文输入确认');
      await page.locator('.inline-comment-inp').evaluate(inp => { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })); });
      assert.equal(await page.evaluate(() => calls.length), 0);
      await page.locator('.inline-comment-inp').press('Enter'); await page.waitForFunction(() => calls.length === 1);
      assert.equal(await page.evaluate(() => JSON.parse(calls[0].options.body).content), '中文输入确认');
      assert.equal(await page.evaluate(() => calls[0].options.authOwner), 'alice');
    } finally { await browser.close(); }
  });
}
test('feed rebuild removes the mention dropdown and resets combobox accessibility state', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await commentPage(browser); await page.locator('.inline-comment-inp').fill('@小');
    assert.equal(await page.locator('.mention-dropdown').count(), 1);
    await page.evaluate(() => __xtjRunMentionCleanups());
    assert.equal(await page.locator('.mention-dropdown').count(), 0);
    assert.equal(await page.locator('.inline-comment-inp').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.inline-comment-inp').getAttribute('aria-activedescendant'), null);
  } finally { await browser.close(); }
});
test('comment JSON arriving after account switch cannot refill feed comments or caches', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await commentPage(browser);
    await page.evaluate(() => { window.xtjProtectedFetch = async () => ({ ok: true, json: () => new Promise(resolve => window.releaseComment = resolve) }); });
    await page.locator('.inline-comment-inp').fill('alice comment'); await page.locator('.inline-comment-inp').press('Enter');
    await page.waitForFunction(() => !!window.releaseComment);
    await page.evaluate(id => { currentUser = 'bob'; _authStateEpoch++; releaseComment({ ok: true, data: { id: 'comment', post_id: id } }); }, id);
    await page.waitForTimeout(30);
    assert.deepEqual(await page.evaluate(() => feedAllComments), []); assert.equal(await page.evaluate(() => cacheWrites), 0); assert.deepEqual(await page.evaluate(() => toasts), []);
  } finally { await browser.close(); }
});
test('burst comment patches preserve the draft, focused input and media nodes', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await commentPage(browser);
    await page.evaluate(id => {
      window.safePostSelector = id => `.post[data-post-id="${id}"]`;
      window.feedAllPosts = [{ id }]; window.feedAllLikes = []; window.updateFeedStats = () => {};
      window.getFilteredPosts = posts => posts; window.getRenderableComments = c => c;
      window.buildPostMaps = () => ({ commentMap: {}, likeMap: {}, likeUserMap: {} });
      window.renderPostCardSafely = () => `<article><div class="post-stats-text">评论 ${feedAllComments.length}</div><div class="comments">${feedAllComments.map(c => c.content).join(',')}</div></article>`;
      const card = document.querySelector('.post'); card.insertAdjacentHTML('afterbegin', '<video id="media"></video><div class="post-stats-text">评论 0</div>');
      window.mediaNode = document.getElementById('media'); window.inputNode = document.querySelector('.inline-comment-inp'); inputNode.value = '未发出的草稿'; inputNode.focus();
    }, id);
    await page.addScriptTag({ content: between('            function patchSinglePostCard', '            function hydrateCachedAvatarsForUsers') });
    await page.evaluate(id => { feedAllComments.push({ content: 'one' }); __xtjSchedulePostCardPatch(id); feedAllComments.push({ content: 'two' }); __xtjSchedulePostCardPatch(id); }, id);
    await page.waitForFunction(() => document.querySelector('.comments').textContent === 'one,two');
    assert.equal(await page.locator('.inline-comment-inp').inputValue(), '未发出的草稿');
    assert.equal(await page.evaluate(() => document.activeElement === inputNode && document.getElementById('media') === mediaNode), true);
  } finally { await browser.close(); }
});

test('built homepage renders posts, likes/comments and clears private content on session removal', async () => {
  const http = require('node:http');
  const path = require('node:path');
  const root = path.resolve('.');
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mjs': 'application/javascript' };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], calls = [];
    page.on('pageerror', error => errors.push(error.message));
    const post = { id, user_name: 'alice', content: '仅本人可见的帖子', visibility: 'private', media_type: '', media_url: '', created_at: '2026-10-02T12:00:00.000Z', views: 0 };
    await page.addInitScript(() => { localStorage.setItem('xtj_user', 'alice'); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { await route.abort(); return; }
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/test-supabase/')) { await route.continue(); return; }
      calls.push(url.pathname);
      let data = { ok: true, data: [], users: [], items: [], totals: { posts: 1, views: 0, likes: 0, comments: 0 } };
      if (url.pathname === '/api/config/public') data = { supabase_url: origin + '/test-supabase', supabase_anon_key: 'sb_publishable_test_only_never_production' };
      if (url.pathname === '/api/user/refresh') data = { token: 'test-only-token', user_name: 'alice' };
      if (url.pathname === '/api/feed') data = { ok: true, posts: [post], comments: [], likes: [], next_offset: 1, next_cursor: null, endReached: true, total_post_count: 1 };
      if (url.pathname === '/api/avatar/batch') data = { ok: true, avatars: {} };
      if (url.pathname === '/api/post/like') { const liked = route.request().postDataJSON().liked; data = { ok: true, liked, like_count: liked ? 1 : 0 }; }
      if (url.pathname === '/api/post/comment') data = { ok: true, data: { id: '33333333-3333-4333-8333-333333333333', post_id: id, user_name: 'alice', content: route.request().postDataJSON().content, created_at: '2026-10-02T12:01:00.000Z' } };
      if (url.pathname === '/api/post/view') data = { ok: true, view_count: 1 };
      if (url.pathname.startsWith('/test-supabase/')) data = [];
      await route.fulfill({ status: 200, json: data });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.currentUser === 'alice' && document.querySelector('#feed .post'));
    const card = page.locator(`#feed .post[data-post-id="${id}"]`);
    await card.locator('.like-btn').click(); await page.waitForFunction(() => document.querySelector('#feed .like-btn')?.getAttribute('aria-busy') !== 'true');
    assert.equal(await card.locator('.like-btn').getAttribute('aria-pressed'), 'true');
    await card.getByRole('button', { name: '评论', exact: true }).click();
    await card.locator('.inline-comment-inp').fill('完整页面评论验证'); await card.locator('.inline-comment-inp').press('Enter');
    await page.waitForFunction(() => document.querySelector('#feed .comments')?.textContent.includes('完整页面评论验证'));
    assert.ok(calls.includes('/api/post/like') && calls.includes('/api/post/comment'));
    await page.evaluate(() => clearAllAuthState({ revokeRemote: false, broadcast: false }));
    assert.equal(await page.locator('#feed .post').count(), 0); assert.equal(await page.evaluate(id => xtjGetPostById(id), id), null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('filter continuation can be activated with the keyboard without resetting the server cursor', async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage(); await page.setContent('<div id="feed"></div>');
    await page.evaluate(() => { window.feedEndReached = false; window.feedPageFetchPending = false; window._feedCoverageLastFetchAt = 100; window.feedNextCursor = { id: 'saved-cursor' }; window.hasActiveFeedFilters = () => true; window.continued = 0; window.loadMoreFeedPosts = () => continued++; });
    await page.addScriptTag({ content: between('            function showFeedSearchContinueControl', '            loadMoreFeedPosts = async function') });
    await page.evaluate(() => showFeedSearchContinueControl());
    await page.getByRole('button', { name: '继续查找帖子' }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => continued), 1); assert.equal(await page.evaluate(() => feedNextCursor.id), 'saved-cursor'); assert.equal(await page.evaluate(() => _feedCoverageLastFetchAt), 0);
  } finally { await browser.close(); }
});
