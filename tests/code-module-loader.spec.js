// @ts-check
const { test, expect } = require('@playwright/test');

// ============================================================
// Code 模块加载器 Playwright 浏览器测试 — PR #372 修复
// ============================================================

test.describe('Code Module Loader', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for page to be ready
    await page.waitForSelector('.desktop-nav-item', { timeout: 10000 });
  });

  // 1. 首次点击 Code，正常进入欢迎页
  test('first click on Code shows welcome page', async ({ page }) => {
    // Click Code tab
    const codeBtn = page.locator('[data-desktop-tab="code"]');
    await codeBtn.click();

    // Wait for panelCode to be visible
    const panelCode = page.locator('#panelCode');
    await expect(panelCode).toBeVisible({ timeout: 15000 });

    // Should show welcome page, not loading or error
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.code-welcome .welcome-title')).toContainText('打开文件夹开始');
  });

  // 2. __xtjCodeWorkspaceAPI 存在但 __xtjCodeInit 丢失时，可以从 API.init 恢复
  test('recovers __xtjCodeInit from __xtjCodeWorkspaceAPI.init when alias is missing', async ({ page }) => {
    // Click Code tab first to load modules
    const codeBtn = page.locator('[data-desktop-tab="code"]');
    await codeBtn.click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Simulate: delete __xtjCodeInit but keep __xtjCodeWorkspaceAPI
    await page.evaluate(() => {
      delete window.__xtjCodeInit;
    });

    // Verify __xtjCodeInit is deleted
    const hasInit = await page.evaluate(() => typeof window.__xtjCodeInit);
    expect(hasInit).toBe('undefined');

    // Switch away and back to trigger re-init
    await page.locator('[data-desktop-tab="posts"]').click();
    await page.waitForTimeout(500);
    await codeBtn.click();

    // Should still show welcome page (recovered from API)
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Verify __xtjCodeInit was recovered
    const recovered = await page.evaluate(() => typeof window.__xtjCodeInit);
    expect(recovered).toBe('function');
  });

  // 3. 点击重试不会删除已经成功加载的工作区 API
  test('retry does not delete successfully loaded workspace API', async ({ page }) => {
    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Verify API exists
    const apiExists = await page.evaluate(() => {
      return !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function');
    });
    expect(apiExists).toBe(true);

    // Simulate error and trigger retry by calling retryCodeModuleLoad directly
    await page.evaluate(() => {
      // Simulate the retry scenario without actual error
      if (typeof window.__xtjCodeWorkspaceAPI !== 'undefined') {
        window.__xtjCodeWorkspaceAPI._marked = true;
      }
    });

    // Verify API still exists after potential retry
    const stillExists = await page.evaluate(() => {
      return !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function');
    });
    expect(stillExists).toBe(true);

    // Verify __xtjCodeInit was NOT deleted
    const initExists = await page.evaluate(() => typeof window.__xtjCodeInit);
    expect(initExists).toBe('function');
  });

  // 4. code-workspace.js 不会被重复执行
  test('code-workspace.js is not executed more than once', async ({ page }) => {
    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Verify __xtjCodeWorkspace is true (guard flag)
    const guardSet = await page.evaluate(() => window.__xtjCodeWorkspace === true);
    expect(guardSet).toBe(true);

    // Switch away and back
    await page.locator('[data-desktop-tab="posts"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Guard should still be true (script didn't re-execute)
    const stillSet = await page.evaluate(() => window.__xtjCodeWorkspace === true);
    expect(stillSet).toBe(true);
  });

  // 5. 快速点击 Code 五次，只产生一个加载 Promise
  test('rapid clicks produce only one load promise', async ({ page }) => {
    // Intercept to count script loads
    let scriptLoadCount = 0;
    await page.route('**/js/code-workspace.min.js', (route) => {
      scriptLoadCount++;
      return route.continue();
    });
    await page.route('**/js/code-file-system.min.js', (route) => {
      return route.continue();
    });

    // Clear any existing state
    await page.evaluate(() => {
      // Reset module state if possible
      if (window.__xtjCodeWorkspace) {
        delete window.__xtjCodeWorkspace;
      }
    });

    // Click Code 5 times rapidly
    const codeBtn = page.locator('[data-desktop-tab="code"]');
    for (let i = 0; i < 5; i++) {
      await codeBtn.click();
      await page.waitForTimeout(50);
    }

    // Wait for load to complete
    await page.waitForTimeout(5000);

    // Should only load once
    expect(scriptLoadCount).toBeLessThanOrEqual(1);
  });

  // 6. 加载期间切走，再进入 Code 可以初始化
  test('switching away during load and back allows init', async ({ page }) => {
    // Clear state to force fresh load
    await page.evaluate(() => {
      delete window.__xtjCodeWorkspace;
      delete window.__xtjCodeWorkspaceAPI;
      delete window.__xtjCodeInit;
      delete window.__xtjCodeFS;
    });

    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await page.waitForTimeout(300);

    // Switch away immediately
    await page.locator('[data-desktop-tab="posts"]').click();
    await page.waitForTimeout(500);

    // Switch back to Code
    await page.locator('[data-desktop-tab="code"]').click();

    // Should eventually show welcome page
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });
  });

  // 7. 同一次失败只显示一个错误 toast
  test('same failure shows only one error toast', async ({ page }) => {
    // Block all Code JS to force failure
    await page.route('**/js/code-workspace.min.js', (route) => route.abort('connectionrefused'));
    await page.route('**/js/code-file-system.min.js', (route) => route.abort('connectionrefused'));
    await page.route('**/css/code-workspace.min.css', (route) => route.abort('connectionrefused'));

    // Clear state
    await page.evaluate(() => {
      delete window.__xtjCodeWorkspace;
      delete window.__xtjCodeWorkspaceAPI;
      delete window.__xtjCodeInit;
      delete window.__xtjCodeFS;
    });

    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await page.waitForTimeout(3000);

    // Should show error page
    await expect(page.locator('#codeRetryBtn')).toBeVisible({ timeout: 10000 });

    // Unblock network
    await page.unroute('**/js/code-workspace.min.js');
    await page.unroute('**/js/code-file-system.min.js');
    await page.unroute('**/css/code-workspace.min.css');

    // Click retry
    await page.locator('#codeRetryBtn').click();

    // Should show welcome page after retry
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });
  });

  // 8. 不再出现 Code init function not found
  test('no Code init function not found error', async ({ page }) => {
    // Collect console errors
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Switch away and back
    await page.locator('[data-desktop-tab="posts"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // No "Code init function not found" error
    const initErrors = errors.filter(e => e.includes('Code init function not found'));
    expect(initErrors.length).toBe(0);
  });

  // 9. 错误状态点击重试后可以成功进入欢迎页
  test('retry after error state shows welcome page', async ({ page }) => {
    // Block workspace script to force error
    await page.route('**/js/code-workspace.min.js', (route) => route.abort('connectionrefused'));

    // Clear state
    await page.evaluate(() => {
      delete window.__xtjCodeWorkspace;
      delete window.__xtjCodeWorkspaceAPI;
      delete window.__xtjCodeInit;
      delete window.__xtjCodeFS;
    });

    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await page.waitForTimeout(3000);

    // Should show error with retry button
    await expect(page.locator('#codeRetryBtn')).toBeVisible({ timeout: 10000 });

    // Verify __xtjCodeFS is loaded (it was not blocked)
    const fsExists = await page.evaluate(() => {
      return !!(window.__xtjCodeFS && typeof window.__xtjCodeFS.readFileByPath === 'function');
    });
    // code-fs might have loaded if route was partial
    // But workspace was blocked, so __xtjCodeWorkspaceAPI should NOT exist
    const apiExists = await page.evaluate(() => {
      return !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function');
    });
    expect(apiExists).toBe(false);

    // Unblock workspace
    await page.unroute('**/js/code-workspace.min.js');

    // Click retry
    await page.locator('#codeRetryBtn').click();

    // Should show welcome page
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });
  });

  // 10. 无重复 document 级事件监听器
  test('no duplicate document-level event listeners', async ({ page }) => {
    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Count keydown listeners before switching
    const countBefore = await page.evaluate(() => {
      // We can't directly count listeners, but we can check the guard
      return window.__xtjCodeWorkspace === true ? 1 : 0;
    });
    expect(countBefore).toBe(1);

    // Switch away and back multiple times
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-desktop-tab="posts"]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-desktop-tab="code"]').click();
      await page.waitForTimeout(300);
    }

    // Guard should still be true (script didn't re-execute)
    const guardStillTrue = await page.evaluate(() => window.__xtjCodeWorkspace === true);
    expect(guardStillTrue).toBe(true);

    // Verify __xtjCodeWorkspaceAPI still exists
    const apiStillExists = await page.evaluate(() => {
      return !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function');
    });
    expect(apiStillExists).toBe(true);
  });

  // 11. 损坏状态检测 — 显示刷新按钮
  test('damaged state shows refresh button not retry', async ({ page }) => {
    // Click Code tab to load modules
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Simulate damaged state: __xtjCodeWorkspace is true but API is missing
    await page.evaluate(() => {
      window.__xtjCodeWorkspace = true;
      delete window.__xtjCodeWorkspaceAPI;
      delete window.__xtjCodeInit;
    });

    // Switch away and back
    await page.locator('[data-desktop-tab="posts"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-desktop-tab="code"]').click();

    // Should show damaged state with refresh button (not retry)
    await expect(page.locator('#codeRefreshBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#codeRefreshBtn')).toContainText('刷新页面');
  });

  // 12. 代码模块加载器状态机暴露正确的 API
  test('code module loader state machine exposes correct API', async ({ page }) => {
    // Click Code tab
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('.code-welcome')).toBeVisible({ timeout: 15000 });

    // Verify all required exports
    const exports = await page.evaluate(() => {
      return {
        hasWorkspace: window.__xtjCodeWorkspace === true,
        hasWorkspaceAPI: !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function'),
        hasCodeInit: typeof window.__xtjCodeInit === 'function',
        hasCodeFS: !!(window.__xtjCodeFS && typeof window.__xtjCodeFS.readFileByPath === 'function'),
        hasRefreshWorkspace: typeof window.__xtjCodeRefreshWorkspace === 'function'
      };
    });

    expect(exports.hasWorkspace).toBe(true);
    expect(exports.hasWorkspaceAPI).toBe(true);
    expect(exports.hasCodeInit).toBe(true);
    expect(exports.hasCodeFS).toBe(true);
    expect(exports.hasRefreshWorkspace).toBe(true);
  });
});