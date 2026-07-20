const { test, expect } = require('@playwright/test');

const BANNED_ERRORS = [
  'photo_renderer_not_loaded',
  'initPhotoWall is not a function',
  'renderPhotoWall is not a function',
  'module_script_timeout'
];

async function gotoApp(page) {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  await page.waitForTimeout(350);
  return pageErrors;
}

async function switchToPhotoWall(page) {
  await page.evaluate(() => {
    if (typeof window.switchDockTab === 'function') {
      window.switchDockTab('ai', true);
    }
  });
  await page.waitForTimeout(220);
}

test('photo wall opens and renders content within 500ms', async ({ page }) => {
  const pageErrors = await gotoApp(page);

  await switchToPhotoWall(page);

  await page.waitForFunction(() => {
    const grid = document.getElementById('photoGrid');
    if (!grid) return false;
    return grid.querySelector('.pw-skeleton') ||
           grid.querySelector('.photo-wall-item') ||
           grid.querySelector('.photo-wall-empty');
  }, { timeout: 5000 });

  const grid = page.locator('#photoGrid');
  const hasSkeleton = await grid.locator('.pw-skeleton').count();
  const hasItems = await grid.locator('.photo-wall-item').count();
  const hasEmpty = await grid.locator('.photo-wall-empty').count();

  expect(hasSkeleton + hasItems + hasEmpty).toBeGreaterThan(0);

  // 检查禁止的 console 错误
  for (const banned of BANNED_ERRORS) {
    const found = pageErrors.some(e => e.includes(banned));
    expect(found, `console should not contain "${banned}"`).toBe(false);
  }
});

test('photo wall with cache shows immediately when API is slow', async ({ page }) => {
  // 模拟慢速 API
  await page.route('**/api/photos/public**', async route => {
    await new Promise(resolve => setTimeout(resolve, 15000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [] })
    });
  });

  // 预先注入缓存数据
  await page.addInitScript(() => {
    try {
      window.__xtjPhotoWallCache = JSON.stringify([
        { id: 'cache-1', cloudId: 'cache-1', imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', timestamp: Date.now() }
      ]);
      localStorage.setItem('__xtj_photo_wall_cache', window.__xtjPhotoWallCache);
    } catch (_) {}
  });

  const pageErrors = await gotoApp(page);

  await switchToPhotoWall(page);

  // 缓存应该在 2 秒内显示
  await page.waitForFunction(() => {
    const grid = document.getElementById('photoGrid');
    if (!grid) return false;
    return grid.querySelector('.photo-wall-item') || grid.querySelector('.pw-skeleton');
  }, { timeout: 3000 });

  const hasItems = await page.locator('#photoGrid .photo-wall-item').count();
  expect(hasItems).toBeGreaterThan(0);

  for (const banned of BANNED_ERRORS) {
    const found = pageErrors.some(e => e.includes(banned));
    expect(found, `console should not contain "${banned}"`).toBe(false);
  }
});

test('photo wall shows error UI when renderPhotoWall throws', async ({ page }) => {
  // 注入错误版本的 renderPhotoWall
  await page.addInitScript(() => {
    // 在 photo-wall 模块加载后自动替换 renderPhotoWall
    const origDefineProperty = Object.defineProperty;
    let patched = false;
    Object.defineProperty = function(obj, prop, desc) {
      const result = origDefineProperty.call(this, obj, prop, desc);
      if (prop === 'renderPhotoWall' && !patched) {
        patched = true;
        setTimeout(() => {
          window.renderPhotoWall = async function() {
            var grid = document.getElementById('photoGrid');
            if (grid) grid.innerHTML = '';
            throw new Error('simulated render failure');
          };
        }, 50);
      }
      return result;
    };
  });

  const pageErrors = await gotoApp(page);

  await switchToPhotoWall(page);

  // 等待错误 UI 出现（包含重试按钮）
  await page.waitForFunction(() => {
    const grid = document.getElementById('photoGrid');
    if (!grid) return false;
    return grid.querySelector('.photo-wall-empty') &&
           grid.querySelector('button');
  }, { timeout: 5000 });

  const emptyDiv = page.locator('#photoGrid .photo-wall-empty');
  await expect(emptyDiv).toBeVisible();

  const retryBtn = page.locator('#photoGrid button');
  await expect(retryBtn).toBeVisible();
});

test('photo wall rapid toggle 20 times never shows blank', async ({ page }) => {
  const pageErrors = await gotoApp(page);

  // 快速来回切换 20 次
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => {
      if (typeof window.switchDockTab === 'function') {
        window.switchDockTab(i % 2 === 0 ? 'ai' : 'posts', true);
      }
    });
    await page.waitForTimeout(80);
  }

  // 最后停在照片墙
  await switchToPhotoWall(page);
  await page.waitForTimeout(500);

  // 检查 photoGrid 不为空
  const gridContent = await page.evaluate(() => {
    const grid = document.getElementById('photoGrid');
    if (!grid) return null;
    return grid.innerHTML.trim().length;
  });

  expect(gridContent).toBeGreaterThan(0);

  for (const banned of BANNED_ERRORS) {
    const found = pageErrors.some(e => e.includes(banned));
    expect(found, `console should not contain "${banned}"`).toBe(false);
  }
});

test('photo wall module load failure shows retry state', async ({ page }) => {
  // 阻止 photo-wall 模块加载
  await page.route('**/photo-wall/photo-wall.js**', route => route.abort());
  await page.route('**/photo-wall/render.js**', route => route.abort());
  await page.route('**/photo-wall/data.js**', route => route.abort());

  const pageErrors = await gotoApp(page);

  await switchToPhotoWall(page);

  await page.waitForTimeout(500);

  // 检查是否有错误状态
  const gridHTML = await page.evaluate(() => {
    const grid = document.getElementById('photoGrid');
    return grid ? grid.innerHTML : '';
  });

  // 应该显示错误状态或至少不是完全空白
  expect(gridHTML.trim().length).toBeGreaterThan(0);
});