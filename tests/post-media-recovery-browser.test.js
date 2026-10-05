'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

for (const width of [390, 1024, 1280]) {
  test(`wall metadata stays inside the card and composer fonts match at ${width}px`, async () => {
    const f = await postBrowserFixture({ counts: [1], viewport: { width, height: 880 } });
    try {
      const { page } = f;
      await page.addScriptTag({ path: 'js/photo-wall/render.js' });
      const fonts = await page.evaluate(() => ['.post-compose-label', '.post-visibility-select'].map(s => getComputedStyle(document.querySelector(s)).fontSize));
      assert.deepEqual(fonts, ['12px', '12px']);
      await page.evaluate(() => {
        document.getElementById('panelPosts').classList.remove('active');
        document.getElementById('panelAi').classList.add('active');
        window.photoWallData = [{ id: 'one', username: '发布者', imageUrl: location.origin + '/test-image/0-0.png', timestamp: Date.now(), views: 42 }];
        renderPhotoWallWithoutReload();
      });
      await page.waitForFunction(() => document.querySelector('.photo-wall-item img').naturalWidth > 0);
      await page.waitForTimeout(350);
      const boxes = await page.locator('.photo-wall-item').evaluate(el => {
        const card = el.getBoundingClientRect(), info = el.querySelector('.pw-item-info').getBoundingClientRect();
        const img = el.querySelector('img').getBoundingClientRect();
        const style = getComputedStyle(el.querySelector('.pw-item-info'));
        return { top: info.top - card.top, bottom: card.bottom - info.bottom, imageBottom: img.bottom - info.bottom, position: style.position, color: getComputedStyle(el.querySelector('.pw-item-name')).color, text: el.querySelector('.pw-item-info').textContent };
      });
      assert.ok(boxes.top >= 0 && boxes.bottom >= -1, JSON.stringify(boxes));
      assert.ok(boxes.imageBottom >= -1, JSON.stringify(boxes));
      assert.equal(boxes.position, 'absolute');
      assert.equal(boxes.color, 'rgb(255, 255, 255)');
      assert.match(boxes.text, /发布者.*刚刚.*浏览 42/);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

test('actual publishing shows 发布中 without flowers and keeps failed text', async () => {
  const f = await postBrowserFixture({ counts: [1] });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  try {
    await f.page.route('**/api/post/create', async route => { await pending; await route.fulfill({ status: 503, json: { ok: false, error: '稍后重试' } }); });
    await f.page.evaluate(() => document.documentElement.dataset.perf = 'lite');
    await f.page.locator('#postInp').fill('这是一条文字动态');
    await f.page.locator('#pubBtn').click();
    await f.page.waitForFunction(() => document.querySelector('.post-publish-progress-label')?.textContent === '发布中');
    assert.equal(await f.page.locator('#pubBtn .pw-garden').count(),0);
    assert.equal(await f.page.locator('#pubBtn [role=progressbar]').count(),1);
    release();
    await f.page.waitForFunction(() => !document.getElementById('pubBtn').disabled);
    assert.equal(await f.page.locator('#postInp').inputValue(), '这是一条文字动态');
  } finally { release(); await f.close(); }
});

for (const surface of ['post', 'preview']) {
  test(`${surface}: stalled original offers retry and ignores the old response`, async () => {
    const f = await postBrowserFixture({ counts: [1] });
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    try {
      const { page } = f;
      await page.clock.install();
      const url = f.origin + '/storage/v1/object/public/uploads/posts/retry.png';
      let count = 0;
      await page.route(url + '*', async route => {
        count++;
        if (count === 1) await pending;
        await route.fulfill({ contentType: 'image/png', body: f.png }).catch(() => {});
      });
      await page.evaluate(({ url, surface }) => {
        XTJ_CONFIG.SUPABASE_URL = location.origin;
        if (surface === 'preview') openPhotoPreview(0, { photos: [{ id: 'stalled', imageUrl: url, thumbUrl: url }] });
        else {
          const img = document.querySelector('#feed .post-media-cell img');
          img.setAttribute('data-media-url', url);
          img.src = url;
        }
      }, { url, surface });
      await page.waitForTimeout(100);
      await page.clock.runFor(31000);
      const retry = surface === 'post' ? page.locator('#feed .post-media-cell.post-image-failed').first() : page.locator('.pp-error-retry');
      await retry.waitFor({ state: 'visible' });
      await retry.click();
      const image = surface === 'post' ? page.locator('#feed .post-media-cell img').first() : page.locator('#photoPreviewImage');
      await page.waitForFunction(surface => {
        const img = document.querySelector(surface === 'post' ? '#feed .post-media-cell img' : '#photoPreviewImage');
        return img.complete && img.naturalWidth === 1;
      }, surface);
      assert.match(await image.getAttribute('src'), /xtj_retry=/);
      release();
      await page.waitForTimeout(100);
      assert.equal(await image.evaluate(el => el.naturalWidth), 1);
      assert.equal(await page.locator(surface === 'post' ? '#feed .post-media-cell.post-image-failed' : '.pp-error-placeholder').count(), 0);
      assert.deepEqual(f.errors, []);
    } finally { release(); await f.close(); }
  });
}
