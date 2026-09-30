const { test, expect, devices } = require('@playwright/test');

// This spec also runs under the repository's default desktop CI project.
// Use a mobile context explicitly so Safari viewport handling is exercised.
const phone = devices['iPhone 13'];
test.use({ userAgent: phone.userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: phone.deviceScaleFactor });

const pageErrors = new WeakMap();
test.beforeEach(({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

const postId = 'd5133cdc-9b49-48f7-a509-9d59e0a17c10';
async function setup(page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'mobile-polish-test');
    localStorage.setItem('xtj_theme', 'light');
  });
  await page.route('**/*.supabase.co/**', route => route.fulfill({ json: [] }));
  await page.route('**/api/**', route => {
    const url = route.request().url();
    const data = { ok: true, token: 'test-only-token', user_name: 'viewer', data: [],
      posts: [], comments: [], likes: [], friends: [], requests: [], blocks: [], avatars: {},
      items: [], endReached: true };
    if (url.includes('/feed')) {
      data.posts = Array.from({ length: 8 }, (_, i) => ({
        id: i ? 'd5133cdc-9b49-48f7-a509-9d59e0a17c1' + i : postId,
        user_name: 'viewer', actor_key: 'mobile-polish-test', content: i ? '下一条动态' : '分享一点新鲜事。',
        created_at: '2026-09-26T01:48:15Z', visibility: 'public', views: 6, is_pinned: false
      }));
    }
    if (url.includes('/post/like')) {
      data.liked = JSON.parse(route.request().postData()).liked;
      data.like_count = data.liked ? 1 : 0;
    }
    return route.fulfill({ json: data });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.XTJThemeController && window.currentUser === 'viewer' && window.__xtjUxFeaturesV1);
  // Early feed renders readable cards before the interactive feed is ready.
  await expect(page.locator('#feed .post .like-btn').first()).toBeVisible();
}

for (const [width, height] of [[320, 700], [390, 844], [430, 932], [844, 390]]) {
  test(`header and flat actions fit ${width}x${height}, and the header settles fully in/out`, async ({ page }, info) => {
    await setup(page, width, height);
    const header = page.locator('.posts-nav');
    const box = await header.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await expect(header).toHaveCSS('position', 'relative');
    const actions = page.locator('#feed .post .actions').first();
    await expect(actions.locator('.action-btn')).toHaveCount(5);
    for (const button of await actions.locator('.action-btn').all()) {
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(button).toHaveCSS('box-shadow', 'none');
      await expect(button).toHaveCSS('border-width', '0px');
      const b = await button.boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
    await page.evaluate(() => {
      const p = document.getElementById('panelPosts'), n = p.querySelector('.posts-nav');
      p.scrollTop = n.getBoundingClientRect().top - p.getBoundingClientRect().top + 8;
    });
    await expect.poll(() => page.locator('#panelPosts').evaluate(p => p.scrollTop)).toBe(0);
    await page.evaluate(() => {
      const p = document.getElementById('panelPosts'), n = p.querySelector('.posts-nav');
      p.scrollTop = n.getBoundingClientRect().top - p.getBoundingClientRect().top + n.offsetHeight - 8;
    });
    await expect.poll(() => header.evaluate(n => n.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
    // Returning all the way to the top reveals the whole header again.
    await page.locator('#panelPosts').evaluate(p => { p.scrollTop = 0; });
    await expect.poll(() => header.evaluate(n => n.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`mobile-${width}-light.png`) });
    await page.evaluate(() => window.XTJThemeController.setMode('dark'));
    await expect(page.locator('html')).not.toHaveClass(/theme-crossfade/);
    await page.screenshot({ path: info.outputPath(`mobile-${width}-dark.png`) });
  });
}

test('slider follows forward/reverse movement before release, with transparent round symbols', async ({ page }, info) => {
  await setup(page);
  const toggle = page.locator('#themeToggle'), orb = toggle.locator('.theme-toggle-orb');
  const b = await toggle.boundingBox(), x = b.x + 14, y = b.y + b.height / 2;
  const start = await orb.boundingBox();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 11, y, { steps: 4 });
  await expect(toggle).toHaveClass(/is-dragging/);
  const middle = await orb.boundingBox();
  expect(middle.x - start.x).toBeGreaterThan(9);
  expect(middle.x - start.x).toBeLessThan(13);
  await expect(toggle.locator('.theme-symbol-moon')).toHaveCSS('opacity', '0.5');
  await expect(toggle.locator('.theme-symbol-sun')).toHaveCSS('opacity', '0.5');
  await page.screenshot({ path: info.outputPath('theme-mid-drag.png') });
  await page.mouse.move(x + 5, y);
  await expect.poll(() => orb.evaluate(el => el.getBoundingClientRect().x)).toBeLessThan(start.x + 7);
  await page.mouse.move(x + 30, y);
  await page.mouse.up();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).not.toHaveClass(/theme-crossfade/);
  await expect(toggle.locator('.theme-symbol-moon')).toHaveCSS('opacity', '1');
  for (const node of [toggle.locator('.theme-toggle-core'), toggle.locator('.theme-symbol-moon')]) {
    await expect(node).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(node).toHaveCSS('box-shadow', 'none');
    await expect(node).toHaveCSS('filter', 'none');
  }
  await expect(toggle.locator('.theme-toggle-core')).toHaveCSS('border-radius', '50%');
  const end = await orb.boundingBox();
  await page.mouse.move(end.x + 12, y);
  await page.mouse.down();
  await page.mouse.move(end.x - 15, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('pointer cancellation preserves the original mode and does not turn a vertical scroll into a toggle', async ({ page }) => {
  await setup(page);
  const toggle = page.locator('#themeToggle');
  const b = await toggle.boundingBox(), x = b.x + 14, y = b.y + 15;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 17, y);
  await expect(toggle).toHaveClass(/is-dragging/);
  await toggle.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
  await page.mouse.up();
  await expect(toggle).not.toHaveClass(/is-dragging/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y + 20);
  await page.mouse.up();
  await toggle.dispatchEvent('click', { detail: 1 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('fast reversals, keyboard, system preference and stored mode stay synchronized', async ({ page }) => {
  await setup(page);
  const toggle = page.locator('#themeToggle');
  await toggle.click();
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await toggle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Home');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => window.XTJThemeController.setMode('system'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => window.XTJThemeController.setMode('light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('xtj_theme'))).toBe('light');
});

test('every sampled frame resolves all control colors together, with no delayed button repaint', async ({ page }, info) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const nodes = [document.body, document.querySelector('.post'), document.getElementById('publishBox'),
      document.querySelector('.action-btn'), document.querySelector('.publish-footer button'), document.getElementById('themeToggle')];
    if (nodes.some(node => !node)) throw new Error('Interactive controls must be ready before sampling frames');
    const colors = () => nodes.map(n => {
      const s = getComputedStyle(n);
      return [s.backgroundColor, s.backgroundImage, s.color, s.borderColor, s.boxShadow];
    });
    const samples = [], start = performance.now();
    let firstDarkFrame = null;
    window.XTJThemeController.setMode('dark');
    await new Promise(resolve => {
      function frame() {
        if (document.documentElement.dataset.theme === 'dark') {
          if (firstDarkFrame === null) firstDarkFrame = performance.now();
          samples.push({ colors: colors(), time: performance.now() - start,
            durations: nodes.map(n => getComputedStyle(n).transitionDuration) });
        }
        // View transitions can suspend rAF, especially in software-rendered
        // WebKit. Sample a fixed number of actual frames after capture resumes.
        if ((samples.length < 12 || firstDarkFrame === null || performance.now() - firstDarkFrame < 500) && performance.now() - start < 10000) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
    return { samples, final: colors() };
  });
  expect(result.samples.length).toBeGreaterThan(3);
  for (const sample of result.samples) expect(sample.colors).toEqual(result.final);
  await page.screenshot({ path: info.outputPath('theme-final-dark.png') });
});

for (const mode of ['reduced', 'off', 'no-view-transition']) {
  test(`theme and likes respect ${mode} and remain responsive`, async ({ page }) => {
    await setup(page);
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (mode === 'off') await page.evaluate(() => document.documentElement.setAttribute('data-xtj-motion', 'off'));
    if (mode === 'no-view-transition') await page.evaluate(() => { document.startViewTransition = undefined; });
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).not.toHaveClass(/theme-crossfade/);
    const like = page.locator('#feed .like-btn').first();
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toHaveAttribute('aria-label', '取消点赞');
    await expect(like.locator('.post-like-icon')).toHaveCount(1);
    if (mode !== 'no-view-transition') await expect(page.locator('.like-blossom')).toHaveCount(0);
  });
}

test('like feedback keeps one blossom and one SVG, without moving sibling buttons', async ({ page }, info) => {
  await setup(page);
  await page.evaluate(() => { window.__xtjPerfProfile = 'full'; });
  const like = page.locator('#feed .like-btn').first();
  const actions = page.locator('#feed .actions').first();
  const before = await actions.locator('.action-btn').evaluateAll(nodes => nodes.map(n => [n.getBoundingClientRect().x, n.getBoundingClientRect().width]));
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(actions.locator('.like-blossom')).toHaveCount(1);
  await expect(page.locator('.xtj-heart-burst-layer')).toHaveCount(0);
  const after = await actions.locator('.action-btn').evaluateAll(nodes => nodes.map(n => [n.getBoundingClientRect().x, n.getBoundingClientRect().width]));
  expect(after).toEqual(before);
  await page.screenshot({ path: info.outputPath('like-animation.png') });
  await expect(actions.locator('.like-blossom')).toHaveCount(0);
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(like.locator('.post-like-icon')).toHaveCount(1);
});

test('native touch input follows the finger, commits on release and cancels safely', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch injection requires Chromium CDP; WebKit still tests native pointer capture.');
  await setup(page);
  const toggle = page.locator('#themeToggle'), box = await toggle.boundingBox();
  const x = box.x + 14, y = box.y + 15;
  const client = await page.context().newCDPSession(page);
  const touch = (type, dx = 0) => client.send('Input.dispatchTouchEvent', { type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: x + dx, y }] });
  await touch('touchStart');
  await touch('touchMove', 11);
  await expect(toggle).toHaveClass(/is-dragging/);
  await expect(toggle.locator('.theme-symbol-moon')).toHaveCSS('opacity', '0.5');
  await touch('touchMove', 28);
  await touch('touchEnd');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveClass(/theme-crossfade/);
  await touch('touchStart', 22);
  await touch('touchMove', 0);
  await touch('touchCancel');
  await expect(toggle).not.toHaveClass(/is-dragging/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Safari viewport offset and returning from a cached page realign the whole header', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'offsetTop', { value: 48, configurable: true });
    Object.defineProperty(visualViewport, 'height', { value: 620, configurable: true });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.locator('.app-container').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(48);
  await expect.poll(() => page.locator('.app-container').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(620);
  await expect.poll(() => page.locator('.posts-nav').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(48);
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(visualViewport, 'height', { value: 844, configurable: true });
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.locator('.app-container').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBe(0);
  await expect.poll(() => page.locator('.app-container').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(844);
});

test('signed-out navigation also fits a 320px screen', async ({ page }) => {
  await setup(page, 320, 700);
  await page.locator('.nav-account-logout').click();
  await expect(page.locator('#unauthUI')).toBeVisible();
  const bounds = await page.locator('.posts-nav button:visible').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
  for (const b of bounds) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.right).toBeLessThanOrEqual(320); }
});
