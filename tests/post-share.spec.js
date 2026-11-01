const { test, expect } = require('@playwright/test');

const POST_ID = '11111111-1111-4111-8111-111111111111';

function post(overrides) {
  return Object.assign({
    id: POST_ID,
    user_name: 'alice',
    content: '你好，这是要分享的帖子',
    media_url: '',
    media_type: 'text',
    visibility: 'public',
    created_at: new Date().toISOString()
  }, overrides || {});
}

async function openFeed(page, row) {
  await page.route('**/api/feed**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, posts: [row], comments: [], likes: [], next_offset: 1, endReached: true, total_post_count: 1 })
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  await page.evaluate(() => { window.currentUser = 'tester'; window.switchDockTab('posts', true); });
  await expect(page.locator(`.post[data-post-id="${POST_ID}"]`)).toBeVisible({ timeout: 15000 });
}

async function stubClipboard(page) {
  await page.evaluate(() => {
    window.__copiedLinks = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedLinks.push(text); return Promise.resolve(); } }
    });
  });
}

test.describe('Post sharing', () => {
  test('three-dot menu shares a post through a copyable public link', async ({ page }) => {
    await openFeed(page, post());
    await stubClipboard(page);
    await page.locator(`.post[data-post-id="${POST_ID}"] .post-tools-trigger`).click();
    await page.locator('.post-tools-menu [data-post-tool="share"]').click();

    await expect(page.locator('.post-share-dialog')).toBeVisible();
    await expect(page.locator('.post-share-author')).toHaveText('alice');
    await expect(page.locator('.post-share-text')).toHaveText('你好，这是要分享的帖子');
    const link = await page.locator('.post-share-link').inputValue();
    expect(link).toBe(new URL('/share/posts/' + POST_ID, page.url()).href);
    // 菜单带关闭动画，DOM 会短暂保留，断言它已不可交互。
    await expect(page.locator('.post-tools-menu').first()).toBeHidden();

    await page.locator('.post-share-copy').click();
    await expect(page.locator('.post-share-copy')).toHaveText('已复制');
    expect(await page.evaluate(() => window.__copiedLinks)).toEqual([link]);

    await page.keyboard.press('Escape');
    await expect(page.locator('.post-share-overlay')).toHaveCount(0);
  });

  test('guests can share public posts without being asked to log in', async ({ page }) => {
    await openFeed(page, post());
    await page.evaluate(() => { window.currentUser = ''; });
    await page.locator(`.post[data-post-id="${POST_ID}"] .post-tools-trigger`).click();
    await page.locator('.post-tools-menu [data-post-tool="share"]').click();
    await expect(page.locator('.post-share-dialog')).toBeVisible();
    expect(await page.locator('.post-share-link').inputValue()).toContain('/share/posts/' + POST_ID);
    await page.locator('.post-share-close').click();
    await expect(page.locator('.post-share-overlay')).toHaveCount(0);
  });

  test('private posts never produce a public share link', async ({ page }) => {
    await openFeed(page, post());
    const result = await page.evaluate(() => {
      window.currentPost = { id: 'private-post-id', visibility: 'private', user_name: 'tester', content: '私密内容' };
      window.openPostShare('private-post-id');
      return { overlay: !!document.querySelector('.post-share-overlay') };
    });
    expect(result.overlay).toBe(false);
  });

  test('native share sheet is offered when the browser supports it', async ({ page }) => {
    await openFeed(page, post());
    await page.evaluate(() => {
      window.__shared = [];
      navigator.share = data => { window.__shared.push(data); return Promise.resolve(); };
    });
    await page.locator(`.post[data-post-id="${POST_ID}"] .post-tools-trigger`).click();
    await page.locator('.post-tools-menu [data-post-tool="share"]').click();
    const button = page.locator('.post-share-native');
    await expect(button).toBeVisible();
    await button.click();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].url).toBe(new URL('/share/posts/' + POST_ID, page.url()).href);
  });
});
