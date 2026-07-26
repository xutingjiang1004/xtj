const { test, expect } = require('@playwright/test');
const fs = require('fs');

test.describe('Code Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button[data-desktop-tab="code"]', { state: 'visible' });
    await page.click('button[data-desktop-tab="code"]');
    await page.waitForSelector('#codeWelcomeLocalBtn', { state: 'visible', timeout: 10000 });
  });

  test('should correctly initialize Code module and display welcome screen', async ({ page }) => {
    const welcomeTitle = page.locator('.welcome-title');
    await expect(welcomeTitle).toBeVisible();
    
    const welcomeIcon = page.locator('.welcome-icon');
    await expect(welcomeIcon).toBeVisible();
  });

  test('should fallback to input when showDirectoryPicker is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      delete window.showDirectoryPicker;
    });
    
    await page.goto('/');
    await page.waitForSelector('button[data-desktop-tab="code"]', { state: 'visible' });
    await page.click('button[data-desktop-tab="code"]');
    await page.waitForSelector('#codeWelcomeLocalBtn', { state: 'visible', timeout: 10000 });
    
    const openBtn = page.locator('#codeWelcomeLocalBtn');
    
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      openBtn.click()
    ]);
    
    expect(fileChooser.isMultiple()).toBe(true);
  });

  test('should intercept 500 API errors and show toast', async ({ page }, testInfo) => {
    // 1. Intercept API
    await page.route('/api/code/chat', async route => {
      await route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html><body><h1>502 Bad Gateway</h1></body></html>'
      });
    });

    // 2. Disable native picker to use fallback
    await page.addInitScript(() => {
      delete window.showDirectoryPicker;
    });
    
    await page.goto('/');
    await page.waitForSelector('button[data-desktop-tab="code"]', { state: 'visible' });
    await page.click('button[data-desktop-tab="code"]');
    await page.waitForSelector('#codeWelcomeLocalBtn', { state: 'visible', timeout: 10000 });

    await page.evaluate(() => {
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({
        credentials: 'include'
      }, options || {}));
    });
    
    // 3. Open a mock workspace using the fallback file chooser
    const openBtn = page.locator('#codeWelcomeLocalBtn');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      openBtn.click()
    ]);
    
    // Keep the required directory fixture under Playwright's ignored output tree.
    const testDir = testInfo.outputPath('mock_workspace');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testInfo.outputPath('mock_workspace', 'test.js'), 'console.log("hello");');
    await fileChooser.setFiles(testDir);
    
    // 4. Verify chat UI is loaded
    await page.waitForSelector('#codeChatInput', { state: 'visible', timeout: 10000 });

    // 5. Trigger the API request by sending a message
    await page.fill('#codeChatInput', 'Hello AI');
    await page.click('#codeChatSendBtn');

    // 6. Check for error message in the chat
    await page.waitForSelector('.code-chat-message:has-text("502")', { state: 'visible', timeout: 5000 });
    const hasErrorMsg = await page.locator('.code-chat-message:has-text("502")').isVisible();
    expect(hasErrorMsg).toBe(true);
  });
});
