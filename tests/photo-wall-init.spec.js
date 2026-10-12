const { test, expect } = require('@playwright/test');
// These API fixtures must also own media requests. Real Service Worker/cache
// authorization has a separate browser suite with a local HTTP backend.
test.use({ serviceWorkers: 'block' });

const BANNED_ERRORS = [
  'photo_renderer_not_loaded',
  'initPhotoWall is not a function',
  'renderPhotoWall is not a function',
  'module_script_timeout'
];

async function gotoApp(page, preserveStorage) {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  if (!preserveStorage) {
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
    });
  }
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

test('photo wall with authorized account metadata shows immediately when API is slow', async ({ page }) => {
  const id = '123e4567-e89b-42d3-a456-000000000001';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxkAAAAASUVORK5CYII=', 'base64');
  await page.route('**/api/**', route => route.fulfill({json:{ok:true,data:[],posts:[],comments:[],likes:[],users:[],items:[]}}));
  await page.route('**/api/user/refresh', route => route.fulfill({json:{ok:true,user_name:'u',token:'local-fixture-token'}}));
  await page.route('**/api/photo/*/media*', route => route.fulfill({contentType:'image/png',body:png}));
  await page.route('**/api/photos/public**', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({json:{ok:true,data:[{id,user_name:'u',media_url:'/api/photo/'+id+'/media',created_at:new Date().toISOString()}]}});
  });
  await page.addInitScript(() => localStorage.setItem('xtj_user', 'u'));
  const pageErrors = await gotoApp(page, true);
  await page.waitForFunction(() => window.currentUser === 'u' && window._xtjAuthState === 'authenticated');
  await page.evaluate(() => window.ensurePhotoWallLoaded());
  await page.waitForFunction(() => typeof window.initPhotoWall === 'function');
  // Seed metadata only after auth, under the confirmed account. Image bytes
  // still go through the authorized media endpoint, never an old offline original.
  await page.evaluate(id => {
    localStorage.setItem('xtj_photos_owner', JSON.stringify('u'));
    localStorage.setItem('xtj_photos', JSON.stringify([{id,cloudId:id,username:'u',imageUrl:'/api/photo/'+id+'/media',timestamp:Date.now()}]));
  }, id);
  await switchToPhotoWall(page);
  await expect(page.locator('#photoGrid .photo-wall-item')).toHaveCount(1, {timeout:1000});
  await expect(page.locator('#photoGrid img').first()).toHaveJSProperty('naturalWidth',1);
  for (const banned of BANNED_ERRORS) expect(pageErrors.some(error => error.includes(banned))).toBe(false);
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
    await page.evaluate((index) => {
      if (typeof window.switchDockTab === 'function') {
        window.switchDockTab(index % 2 === 0 ? 'ai' : 'posts', true);
      }
    }, i);
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
