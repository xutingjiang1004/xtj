'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture, wireAiChat } = require('./helpers/post-browser-fixture');
test('own profile uses plain self text and distinguishes quota restrictions from a retryable loading failure', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [1], theme: 'dark' });
  try {
    await f.page.route('**/api/profile/posts/**', r => r.fulfill({ status: 402, json: { ok: false, code: 'egress_quota_exceeded', error: '网站数据服务流量额度已用完，服务暂时受限，请等待恢复', retryable: false } }));
    await f.page.locator('#feed .avatar[role="button"], #feed .avatar-wrap[role="button"]').first().click();
    await f.page.waitForFunction(() => document.getElementById('authorPostsStatus').textContent.includes('等待恢复'));
    assert.equal(await f.page.locator('#authorPostsStatus button').count(), 0);
    const style = await f.page.locator('#upcMsgBtn').evaluate(e => { const s = getComputedStyle(e); return [e.textContent, s.backgroundColor, s.borderWidth, s.borderRadius, s.boxShadow]; });
    assert.deepEqual(style, ['这是你自己', 'rgba(0, 0, 0, 0)', '0px', '0px', 'none']);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('image-only posts expose critique without a text translation and keep the streamed final response intact', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [3] });
  try {
    f.posts[0].content = ''; await f.page.evaluate(() => loadFeed(true));
    let body;
    await f.page.route('**/api/agent/post-chat/stream', r => { body = r.request().postDataJSON(); return r.fulfill({ contentType: 'text/event-stream', body: 'event: delta\ndata: {"content":"这构图，"}\n\nevent: delta\ndata: {"content":"把审美拍成了事故现场。"}\n\nevent: message\ndata: {"content":"这构图，把审美拍成了事故现场。"}\n\nevent: done\ndata: {}\n\n' }); });
    await f.page.locator('#feed .post-tools-trigger').first().click();
    assert.equal(await f.page.locator('.post-tools-menu [data-post-tool="translate"]').count(), 0);
    await f.page.locator('.post-tools-menu [data-post-tool="ask-ai"]').click();
    await f.page.waitForFunction(() => document.querySelector('.post-tool-critique')?.textContent === '这构图，把审美拍成了事故现场。');
    assert.deepEqual(body, { post_id: f.posts[0].id, initial: true }); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('research upload accepts images and documents without overflowing the mobile screen, with readable dark surfaces', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [1], theme: 'dark', ios: true });
  try {
    await wireAiChat(f.page); await f.page.locator('.ai-deep-think-toggle').click();
    await f.page.waitForSelector('#panelDeepThink.active');
    for (const file of [{ name: 'a-long-original-photo-name.png', mimeType: 'image/png', buffer: f.png }, { name: 'a-long-document-name.txt', mimeType: 'text/plain', buffer: Buffer.from('研究资料') }]) {
      const chooser = f.page.waitForEvent('filechooser'); await f.page.locator('#dtFileBtn').click(); await (await chooser).setFiles(file);
      await f.page.waitForSelector('#dtFilePreview .ai-file-remove'); await f.page.waitForTimeout(180);
      const rects = await f.page.locator('#dtFileBtn,#dtFilePreview,#dtInput,#dtSendBtn').evaluateAll(nodes => nodes.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; }));
      assert.ok(rects.every(r => r.x >= 0 && r.right <= 391 && r.width > 0), JSON.stringify(rects));
      assert.ok(rects[2].width > 150, 'attachment preview must not squeeze the input');
      // Keep focus while the keyboard reduces the visible area; re-focusing
      // would conceal a composer that only becomes reachable on a second tap.
      await f.page.locator('#dtInput').focus();
      for (const height of [430, 350, 300]) {
        await f.page.setViewportSize({ width: 390, height });
        await f.page.evaluate(height => { testKeyboardViewport.height = height; testKeyboardViewport.dispatchEvent(new Event('resize')); }, height);
        await f.page.waitForFunction(height => Array.from(document.querySelectorAll('#dtInput,#dtSendBtn')).every(e => {
          const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= height;
        }), height);
      }
      await f.page.locator('#dtFilePreview .ai-file-remove').click();
      await f.page.locator('#dtInput').blur();
      await f.page.setViewportSize({ width: 390, height: 844 });
      await f.page.evaluate(() => { testKeyboardViewport.height = 844; testKeyboardViewport.dispatchEvent(new Event('resize')); document.querySelector('#panelDeepThink .dt-page').scrollTop = 0; });
    }
    assert.equal(await f.page.locator('#dtFileBtn').getAttribute('aria-label'), '上传图片或文件');
    assert.match(await f.page.locator('#panelDeepThink').evaluate(e => getComputedStyle(e).backgroundImage), /18, 26, 30/);
    const header = await f.page.locator('.dt-back,.dt-title,.dt-actions').evaluateAll(nodes => nodes.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
    assert.ok(header[1].x >= header[0].right - 1); assert.ok(header[2].y >= header[1].bottom - 1);
    await f.page.locator('#dtBackBtn').click();
    await f.page.waitForSelector('#panelDeepThink.active', { state: 'hidden' });
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('admin credential errors keep their actual message instead of becoming a connection failure', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    await f.page.route('**/admin/login', r => r.fulfill({ status: 401, json: { error: '账号或密码错误' } }));
    await f.page.evaluate(() => openAuthModal('login')); await f.page.locator('#loginNickInp').fill('xxz'); await f.page.locator('#loginPwInp').fill('wrong-password');
    await f.page.locator('#loginSubmitBtn').click();
    await f.page.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some(e => e.textContent.includes('账号或密码错误')));
    assert.equal(await f.page.locator('.toast').filter({ hasText: '无法连接后端' }).count(), 0);
    assert.equal(await f.page.locator('#loginSubmitBtn').isDisabled(), false); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('feed quota restrictions do not retry through direct Supabase or present a misleading network retry', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    await f.page.route('**/api/feed?*', r => r.fulfill({ status: 402, json: { ok: false, code: 'egress_quota_exceeded', error: '网站数据服务流量额度已用完，服务暂时受限，请等待恢复', retryable: false } }));
    const initialDirectReads = f.calls.filter(c => c.path === '/test-supabase/rest/v1/posts').length;
    await f.page.evaluate(() => { persistFeedCacheSnapshotNow(); return loadFeed(true); });
    await f.page.waitForFunction(() => document.getElementById('feedStaleNotice')?.textContent.includes('等待恢复'));
    assert.equal(await f.page.locator('#feedStaleNotice').getAttribute('role'), 'status');
    assert.equal(f.calls.filter(c => c.path === '/test-supabase/rest/v1/posts').length, initialDirectReads);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('chat preview glass follows the image and saving keeps its original format', { timeout: 45000 }, async () => {
  const messages = [0, 1].map(i => ({ id: '44444444-4444-4444-8444-00000000000' + i, user_name: 'bob', media_url: 'alice', media_type: '__dm__', content: JSON.stringify({ type: 'dm', text: '', media: { kind: 'image', url: '/test-image/0-' + i + '.png', name: 'photo.png', w: 400, h: 300 } }), created_at: '2026-10-09T00:00:0' + i + 'Z' }));
  const f = await postBrowserFixture({ counts: [1], theme: 'dark', dmMessages: messages });
  try {
    const p = f.page;
    await p.waitForFunction(() => window.isAuthenticated());
    await p.route('**/api/dm/messages**', r => r.fulfill({ json: { ok: true, data: messages } }));
    await p.route('**/api/chat/relationship**', r => r.fulfill({ json: { ok: true, relationship: { status: 'friends', can_message: true } } }));
    await p.route('**/api/chat/history/search**', r => r.fulfill({ json: { ok: true, items: [], has_more: false } }));
    await p.locator('[data-tab="chat"]').filter({ visible: true }).first().click();
    await p.locator('.chat-list-item[data-chat-user="bob"]').click();
    await p.locator('#dockChatMessages .chat-msg img').first().click();
    await p.waitForFunction(() => document.querySelector('#chatGallery img')?.naturalWidth > 0);
    await p.waitForTimeout(300);
    const controls = await p.locator('#chatGallery button:is([data-gallery="close"],[data-gallery="save"],[data-gallery="jump"])').evaluateAll(nodes => nodes.map(n => { const s = getComputedStyle(n); return { background: s.backgroundColor, filter: s.backdropFilter, image: s.backgroundImage }; }));
    assert.equal(controls.length, 3); assert.ok(controls.every(c => c.background === 'rgba(245, 250, 248, 0.2)' && c.filter.includes('blur') && c.image === 'none'));
    await p.locator('#chatGallery .chat-gallery-stage').dblclick({ position: { x: 195, y: 420 } });
    await p.waitForTimeout(250);
    assert.match(await p.locator('#chatGallery img').evaluate(e => getComputedStyle(e).transform), /^matrix\(2,/);
    const download = p.waitForEvent('download'); await p.locator('#chatGallery [data-gallery="save"]').click(); const saved = await download;
    assert.equal(saved.suggestedFilename(), 'chat-photo-0.svg');
    const expected = await (await p.request.get(f.origin + '/test-image/0-0.png')).body();
    assert.deepEqual(require('node:fs').readFileSync(await saved.path()), expected);
    await p.locator('#chatGallery [data-gallery="jump"]').click(); await p.waitForSelector('#chatGallery', { state: 'detached' });
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
test('local cache can be cleared during a profile service outage without losing login identity', { timeout: 45000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const p = f.page;
    await p.route('**/api/profile/settings**', r => r.fulfill({ status: 402, json: { ok: false, error: '网站数据服务流量额度已用完，服务暂时受限，请等待恢复', code: 'egress_quota_exceeded', retryable: false } }));
    await p.evaluate(async () => { const cache = await caches.open('xtj-original-media-v1'); await cache.put('/api/photo/8c1cb02d-74d0-4e45-9e15-000000000001/media', new Response('test bytes')); localStorage.setItem('xtj_cache_followup', 'old'); });
    await p.locator('[data-tab="profile"]').filter({ visible: true }).first().click();
    await p.waitForFunction(() => document.getElementById('profilePreferences').dataset.syncState === 'error');
    await p.evaluate(() => {
      const clearOriginals = window.xtjClearOriginalMediaCache;
      const pending = new Promise(resolve => { window.__xtjReleaseCacheClear = resolve; });
      window.xtjClearOriginalMediaCache = async () => { await pending; return clearOriginals(); };
    });
    await p.locator('#xtjClearCacheBtn').click();
    assert.equal(await p.evaluate(() => localStorage.getItem('xtj_cache_followup')), null, 'ordinary cache clears immediately even if worker registration or original-file deletion is slow');
    assert.equal(await p.evaluate(() => localStorage.getItem('xtj_user')), 'alice');
    assert.equal(await p.evaluate(async () => (await (await caches.open('xtj-original-media-v1')).keys()).length), 1);
    assert.equal(await p.locator('.toast').filter({ hasText: '已清理本地缓存' }).count(), 0, 'success waits for original-file deletion');
    await p.evaluate(() => __xtjReleaseCacheClear());
    await p.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some(e => e.textContent.includes('已清理本地缓存')));
    assert.equal(await p.evaluate(async () => (await (await caches.open('xtj-original-media-v1')).keys()).length), 0);
    assert.equal(await p.evaluate(() => localStorage.getItem('xtj_cache_followup')), null);
    assert.equal(await p.evaluate(() => localStorage.getItem('xtj_user')), 'alice');
    assert.equal(await p.evaluate(() => currentUser), 'alice'); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
