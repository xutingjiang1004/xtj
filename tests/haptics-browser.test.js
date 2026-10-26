'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');
const { aiPolishFixture } = require('./helpers/ai-polish-fixture');

async function record(page) {
  await page.evaluate(() => {
    window.hapticCalls = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value(pattern) {
      const node = document.querySelector('.ai-msg.assistant:last-child');
      hapticCalls.push({ pattern, generating: !!node?.classList.contains('generating'), text: node?.querySelector('.ai-msg-bubble')?.textContent || '' });
      return true;
    } });
    XTJHaptics.setEnabled(true);
  });
}
async function pulses(page) { return page.evaluate(() => hapticCalls.filter(call => call.pattern !== 0).map(call => call.pattern)); }
async function reset(page) { await page.waitForTimeout(90); await page.evaluate(() => { hapticCalls.length = 0; }); }
async function center(page, selector) { const r = await page.locator(selector).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
async function emit(page, event) { await page.evaluate(event => aiPolishEmit(event), event); }

for (const desktop of [false, true]) test((desktop ? 'sidebar' : 'mobile Dock') + ': navigation pulses once after selection, never during drag or cancellation', { timeout: 45000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], viewport: desktop ? { width: 820, height: 1180 } : undefined }); t.after(() => f.close()); const p = f.page;
  await record(p);
  const selector = tab => desktop ? '.desktop-nav-item[data-desktop-tab="' + tab + '"]' : '#dockBar [data-tab="' + tab + '"]';
  await p.locator(selector('chat')).click();
  assert.deepEqual(await pulses(p), [6]);
  await reset(p); await p.locator(selector('chat')).click(); assert.deepEqual(await pulses(p), []);
  const from = await center(p, selector('chat')), to = await center(p, selector('profile'));
  await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps: 6 });
  assert.deepEqual(await pulses(p), []);
  await p.mouse.up(); assert.deepEqual(await pulses(p), [6]);
  assert.equal(await p.locator('#panelProfile').evaluate(node => node.classList.contains('active')), true);
  await reset(p); await p.mouse.move(to.x, to.y); await p.mouse.down(); await p.mouse.move(from.x, from.y, { steps: 6 });
  await p.evaluate(() => dispatchEvent(new Event('blur'))); await p.mouse.up(); assert.deepEqual(await pulses(p), []);
  await p.evaluate(() => switchDockTab('posts', true)); assert.deepEqual(await pulses(p), [], 'saved/background navigation stays silent');
  assert.deepEqual(f.errors, []);
});

test('post like intent stays responsive and publishing only signals a confirmed success', { timeout: 45000 }, async t => {
  const f = await postBrowserFixture({ counts: [1] }); t.after(() => f.close()); const p = f.page; await record(p);
  await p.locator('#feed .like-btn').first().click(); assert.deepEqual(await pulses(p), [10]);
  await p.waitForFunction(() => !document.querySelector('#feed .like-btn').classList.contains('like-pending'));
  await reset(p); await p.evaluate(() => toggleLike(document.querySelector('#feed .like-btn'), 'invalid-id')); assert.deepEqual(await pulses(p), []);
  f.setFailCreate(true); await p.locator('#postInp').fill('失败保留草稿'); await p.locator('#pubBtn').click();
  await p.waitForFunction(() => !document.getElementById('pubBtn').disabled); assert.deepEqual(await pulses(p), []);
  f.setFailCreate(false); await p.locator('#pubBtn').click();
  await p.waitForFunction(() => document.querySelector('#feed > .post')?.dataset.postId.endsWith('009999'));
  assert.deepEqual(await pulses(p), [[12, 35, 16]]); assert.deepEqual(f.errors, []);
});

test('post deletion stays silent on cancel and failure, then signals only after the server confirms', { timeout: 45000 }, async t => {
  const f = await postBrowserFixture({ counts: [1] }); t.after(() => f.close()); const p = f.page; await record(p);
  await p.locator('#feed .action-btn.del').first().click(); await p.locator('#delModal .post-delete-cancel').click(); assert.deepEqual(await pulses(p), []);
  let failure = true, release, reached;
  let arrived = new Promise(resolve => { reached = resolve; });
  await p.route('**/api/post/delete', async route => { await new Promise(resolve => { release = resolve; reached(); }); await route.fulfill(failure ? { status: 503, json: { ok: false, error: 'Isolated failure' } } : { json: { ok: true, deleted: true } }); });
  await p.locator('#feed .action-btn.del').first().click(); await p.locator('#delBtn').click();
  await p.waitForFunction(() => document.getElementById('delBtn').disabled); assert.deepEqual(await pulses(p), []);
  await arrived; release();
  await p.waitForFunction(() => !document.getElementById('delBtn').disabled); assert.deepEqual(await pulses(p), []);
  failure = false; release = null; arrived = new Promise(resolve => { reached = resolve; });
  await p.locator('#feed .action-btn.del').first().click(); await p.locator('#delBtn').click();
  await arrived; assert.deepEqual(await pulses(p), []); release();
  await p.waitForFunction(() => !document.querySelector('#feed > .post'));
  assert.deepEqual(await pulses(p), [[12, 35, 16]]); assert.deepEqual(f.errors, []);
});

async function wall(f) {
  await f.page.route('**/api/photos/public?*', route => route.fulfill({ json: { ok: true, data: [], has_more: false, next_cursor: null } }));
  await f.page.locator('#dockBar [data-tab="ai"]').click();
  await f.page.waitForFunction(() => document.getElementById('photoFileInput')?.__xtjUploadBound && typeof deletePhotoWallPhoto === 'function');
  await f.page.locator('#panelAi').evaluate(node => Promise.all(node.getAnimations().map(a => a.finished.catch(() => {}))));
}

test('photo upload does not claim success while status is pending, and retry confirms it once', { timeout: 45000 }, async t => {
  const f = await postBrowserFixture({ counts: [1] }); t.after(() => f.close()); const p = f.page; await wall(f); await record(p);
  const row = { id: '11111111-1111-4111-8111-000000000001', user_name: 'alice', media_type: '__photo_wall__', media_url: f.origin + '/test-image/0-0.png', visibility: 'public', created_at: '2026-10-26T12:00:00Z', content: '{}' };
  let committed = false;
  await p.route('**/api/photo/upload?*', route => route.fulfill({ json: { ok: true, public_url: row.media_url } }));
  await p.route('**/api/photo/create', route => route.fulfill({ status: 503, json: { ok: false, error: 'Still confirming' } }));
  await p.route('**/api/photo/status', route => route.fulfill({ json: committed ? { ok: true, status: 'committed', data: row } : { ok: true, status: 'processing' } }));
  await p.locator('#photoFileInput').setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: f.png }); await p.locator('#pwStartUploadBtn').click();
  await p.waitForFunction(() => document.getElementById('pwUploadResult')?.dataset.state === 'error'); assert.deepEqual(await pulses(p), []);
  await p.locator('#pwUploadResultRetry').click();
  await p.waitForFunction(() => document.getElementById('pwUploadResultTitle')?.textContent === '正在确认上传结果'); assert.deepEqual(await pulses(p), []);
  committed = true; await p.locator('#pwUploadResultRetry').click();
  await p.waitForFunction(() => document.getElementById('pwUploadResult')?.dataset.state === 'success'); assert.deepEqual(await pulses(p), [[12, 35, 16]]);
  await p.evaluate(row => { window.hapticPhoto = normalizePhotoWallRow(row); }, row);
  await reset(p); let deleteOk = false;
  await p.route('**/api/photo/delete', route => route.fulfill(deleteOk ? { json: { ok: true } } : { status: 403, json: { ok: false, error: 'Isolated rejection' } }));
  await p.evaluate(() => deletePhotoWallPhoto(hapticPhoto)); assert.deepEqual(await pulses(p), []);
  deleteOk = true; await p.evaluate(() => deletePhotoWallPhoto(hapticPhoto)); assert.deepEqual(await pulses(p), [[12, 35, 16]]);
  assert.deepEqual(f.errors, []);
});

test('model, thinking and network selections pulse for an actual change only', { timeout: 45000 }, async t => {
  const f = await aiPolishFixture(); t.after(() => f.close()); const p = f.page; await record(p);
  await p.locator('#aiPlusBtn').click(); await p.locator('[data-action="open-model"]').click();
  await p.locator('#aiSelectPopup [data-value="deepseek-v4-pro"]').click(); assert.deepEqual(await pulses(p), [6]);
  await reset(p); await p.locator('[data-action="open-model"]').click(); await p.locator('#aiSelectPopup [data-value="deepseek-v4-pro"]').click(); assert.deepEqual(await pulses(p), []);
  await p.locator('[data-action="open-think"]').click(); await p.locator('#aiSelectPopup [data-value="low"]').click(); assert.deepEqual(await pulses(p), [6]);
  await reset(p); await p.locator('[data-network-mode="off"]').click(); assert.deepEqual(await pulses(p), [6]);
  await reset(p); await p.locator('[data-network-mode="off"]').click(); assert.deepEqual(await pulses(p), []);
  assert.deepEqual(f.errors, []);
});

test('photo likes honor the shared opt-out and opening a delete confirmation never signals completion', { timeout: 45000 }, async t => {
  const f = await postBrowserFixture({ counts: [1] }); t.after(() => f.close()); const p = f.page; await wall(f); await record(p);
  const row = { id: '11111111-1111-4111-8111-000000000001', user_name: 'alice', media_type: '__photo_wall__', media_url: f.origin + '/test-image/0-0.png', visibility: 'public', created_at: '2026-10-26T12:00:00Z', content: '{}' };
  await p.route('**/api/photo/*/social*', route => route.fulfill({ json: { ok: true, liked: false, like_count: 0, views: 1, comment_count: 0, comments: [] } }));
  await p.route('**/api/photo/*/like', route => route.fulfill({ json: { ok: true, liked: route.request().postDataJSON().liked, like_count: 1 } }));
  await p.evaluate(row => { photoWallData = [normalizePhotoWallRow(row)]; renderPhotoWallWithoutReload(); }, row);
  await p.locator('#photoGrid .photo-wall-item').click(); await p.waitForFunction(() => document.getElementById('ppLikeBtn') && !document.getElementById('ppLikeBtn').disabled);
  await p.locator('#ppLikeBtn').click(); assert.deepEqual(await pulses(p), [10]);
  await reset(p); await p.locator('#ppDeleteBtn').click(); assert.deepEqual(await pulses(p), []);
  await p.locator('#ppConfirmOverlay .pp-confirm-cancel').click(); assert.deepEqual(await pulses(p), []);
  await p.evaluate(() => XTJHaptics.setEnabled(false)); await p.locator('#ppLikeBtn').click(); assert.deepEqual(await pulses(p), []);
  assert.deepEqual(f.errors, []);
});

test('research completion signals once for a real report and preserves its rendered answer', { timeout: 45000 }, async t => {
  const f = await aiPolishFixture(); t.after(() => f.close()); const p = f.page; await record(p);
  await p.evaluate(() => __xtjAiAgent.openDeepThink()); await p.locator('#dtInput').fill('核实资料后写一份报告'); await p.locator('#dtSendBtn').click();
  await p.waitForFunction(() => aiPolish.streams.length === 1);
  assert.match(await p.evaluate(() => aiPolish.streams[0].path), /research\/stream$/);
  await emit(p, { type: 'research_content', content: '已核对资料。' }); assert.deepEqual(await pulses(p), []);
  await emit(p, { type: 'research_done', answer: '完整报告：已核对原始资料。', sources: [], saved: true, conversation_id: 'HAPTICRESEARCH1' });
  await p.waitForFunction(() => document.getElementById('dtPauseBtn').style.display === 'none');
  assert.deepEqual(await pulses(p), [[12, 35, 16]]); assert.match(await p.locator('#dtMessages .ai-think-answer').last().textContent(), /完整报告/); assert.deepEqual(f.errors, []);
});

for (const outcome of ['complete', 'interrupted', 'empty', 'error', 'cancel', 'stale']) test('AI ' + outcome + ': completion feedback follows real visible body completion', { timeout: 45000 }, async t => {
  const f = await aiPolishFixture(); t.after(() => f.close()); const p = f.page; await record(p);
  await p.locator('#aiChatMsgInput').fill('核对后再回复'); await p.locator('#aiChatSendBtn').click(); await p.waitForFunction(() => aiPolish.streams.length === 1);
  assert.deepEqual(await pulses(p), []);
  const content = outcome === 'empty' ? '' : '第一段：已核对。\n\n第二段：保持中文显示顺序。';
  if (content) { await emit(p, { type: 'content', text: content }); await p.waitForFunction(() => document.querySelector('.ai-msg.assistant .ai-msg-bubble')?.textContent.includes('第一段')); }
  assert.deepEqual(await pulses(p), [], 'partial body text must not signal completion');
  if (outcome === 'stale') { await p.evaluate(() => __xtjCloseAiChat()); await emit(p, { type: 'done', content, complete: true, saved: true }); }
  else if (outcome === 'cancel') { await p.locator('#aiChatPauseBtn').click(); }
  else {
    await emit(p, outcome === 'error' ? { type: 'error', error: 'Isolated model failure' } : { type: 'done', content, complete: outcome !== 'interrupted', interrupted: outcome === 'interrupted', saved: true });
    await p.waitForFunction(() => !document.querySelector('.ai-msg.assistant.generating'));
  }
  if (outcome === 'complete') {
    assert.deepEqual(await pulses(p), [[12, 35, 16]]);
    const call = await p.evaluate(() => hapticCalls.find(call => Array.isArray(call.pattern)));
    assert.equal(call.generating, false); assert.match(call.text, /第一段.*第二段/s);
  } else assert.deepEqual(await pulses(p), []);
  assert.deepEqual(f.errors, []);
});

test('per-device opt-out survives reload; unsupported browsers keep navigation and actions working', { timeout: 45000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], ios: true }); t.after(() => f.close()); const p = f.page; await record(p);
  await p.locator('#dockBar [data-tab="profile"]').click(); await reset(p);
  await p.locator('#xtjHapticsBtn').click(); assert.equal(await p.locator('#xtjHapticsBtn').getAttribute('aria-pressed'), 'false');
  await p.locator('#dockBar [data-tab="chat"]').click(); assert.deepEqual(await pulses(p), []);
  await p.reload(); await p.waitForFunction(() => window.XTJHaptics && document.getElementById('xtjHapticsBtn'));
  assert.equal(await p.evaluate(() => localStorage.getItem('xtj_haptics')), 'off');
  await p.evaluate(() => { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined }); XTJHaptics.setEnabled(true); });
  await p.locator('#dockBar [data-tab="profile"]').click(); assert.equal(await p.locator('#xtjHapticsBtn').isDisabled(), true); assert.equal(await p.locator('#xtjHapticsBtn').textContent(), '暂不支持');
  await p.locator('#dockBar [data-tab="posts"]').click(); await p.locator('#feed .like-btn').first().click();
  assert.equal(await p.locator('#feed .like-btn').first().getAttribute('aria-pressed'), 'true'); assert.deepEqual(f.errors, []);
});
