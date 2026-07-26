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

  test('should open a single file directly from the welcome screen', async ({ page }) => {
    await page.addInitScript(() => {
      window.showOpenFilePicker = async () => [{
        kind: 'file',
        name: 'direct-open.js',
        getFile: async () => new File(['export const direct = true;'], 'direct-open.js', { type: 'text/javascript' })
      }];
    });

    await page.goto('/');
    await page.waitForSelector('button[data-desktop-tab="code"]', { state: 'visible' });
    await page.click('button[data-desktop-tab="code"]');
    await page.waitForSelector('#codeWelcomeFileBtn', { state: 'visible', timeout: 10000 });
    await page.click('#codeWelcomeFileBtn');
    await page.waitForSelector('.code-tab', { state: 'visible', timeout: 10000 });
    await expect(page.locator('.code-tab').first()).toContainText('direct-open.js');
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


test('Code workspace does not block AI requests if background document extraction fails', async ({ page }) => {
  let extractCallCount = 0;
  await page.route('**/api/code/document/extract', async (route) => {
    extractCallCount++;
    if (extractCallCount === 1) {
      // Mock first extraction as failing (e.g. broken PDF)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Cannot parse PDF' })
      });
    } else {
      // Mock second extraction as success (e.g. js file, though JS doesn't usually use document/extract, but just in case)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, name: 'normal.js', mimeType: 'application/javascript', text: 'console.log("ok");', sha256: 'sha' })
      });
    }
  });

  let chatBody = null;
  await page.route('**/api/code/chat', async (route) => {
    chatBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reply: 'AI response' })
    });
  });

  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => [{
      kind: 'file',
      name: 'direct-open.js',
      getFile: async () => new File(['export const direct = true;'], 'direct-open.js', { type: 'text/javascript' })
    }];
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
  });
  await page.click('button[data-desktop-tab="code"]');
  await page.waitForSelector('#codeWelcomeFileBtn', { state: 'visible', timeout: 10000 });
  await page.click('#codeWelcomeFileBtn');
  await page.waitForSelector('.code-workspace', { state: 'visible' });

  // Open broken PDF
  await page.evaluate(() => {
    window.__xtjCodeFS.readDocumentContent = function() { return Promise.reject(new Error('Extract error test')); };
    // Trigger opening a file that fails extraction
    var state = window.__xtjGetCodeState ? window.__xtjGetCodeState() : null;
    if (state) {
      state.openTabs.push({ path: 'broken.pdf', name: 'broken.pdf', type: 'document', _extractPromise: Promise.resolve(), _extractError: 'Cannot parse PDF' });
      state.activePath = 'broken.pdf';
    }
  });

  // Open normal JS file
  await page.evaluate(() => {
    var state = window.__xtjGetCodeState();
    state.openTabs.push({ path: 'normal.js', name: 'normal.js', type: 'code', _currentContent: 'console.log("ok");' });
    state.activePath = 'normal.js';
    if (window.__xtjRenderCodeEditorTabs) window.__xtjRenderCodeEditorTabs();
  });

  // Check that the failed tab has the warning icon
  const hasWarning = await page.evaluate(() => {
    var tabs = document.querySelectorAll('.code-tab');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-path') === 'broken.pdf') {
        return tabs[i].querySelector('.tab-failed') !== null;
      }
    }
    return false;
  });
  expect(hasWarning).toBe(true);

  // Send message
  await page.fill('#codeChatInput', 'What is in normal.js?');
  await page.click('#codeChatSend');
  
  // Wait for network request to chat
  await page.waitForResponse(response => response.url().includes('/api/code/chat'));

  // Ensure request was sent and broken.pdf content is NOT in open_files
  expect(chatBody).not.toBeNull();
  expect(chatBody.message).toBe('What is in normal.js?');
  
  const openFiles = chatBody.open_files || [];
  const brokenPdf = openFiles.find(f => f.path === 'broken.pdf');
  expect(brokenPdf).toBeUndefined(); // Should not include empty content
  
  const normalJs = openFiles.find(f => f.path === 'normal.js');
  expect(normalJs).toBeDefined();
  expect(normalJs.content).toBe('console.log("ok");');
});


test('Code workspace layout can be resized and collapsed', async ({ page }) => {
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => [{
      kind: 'file',
      name: 'direct-open.js',
      getFile: async () => new File(['export const direct = true;'], 'direct-open.js', { type: 'text/javascript' })
    }];
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
  });
  await page.click('button[data-desktop-tab="code"]');
  await page.waitForSelector('#codeWelcomeFileBtn', { state: 'visible', timeout: 10000 });
  await page.click('#codeWelcomeFileBtn');
  await page.waitForSelector('.code-workspace', { state: 'visible' });

  // 1. Drag left resizer
  const resizerLeft = await page.locator('.code-resizer-left');
  await resizerLeft.waitFor({ state: 'visible' });
  const leftBox = await resizerLeft.boundingBox();
  
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 100, leftBox.y + 10);
  await page.mouse.up();

  // Wait a bit for layout to settle
  await page.waitForTimeout(100);

  // 2. Drag right resizer (chat)
  const resizerRight = await page.locator('.code-resizer-right');
  await resizerRight.waitFor({ state: 'visible' });
  const rightBox = await resizerRight.boundingBox();
  
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 50, rightBox.y + 10);
  await page.mouse.up();

  // 3. Test collapse chat
  await page.click('.fold-chat-btn');
  await expect(page.locator('.code-chat-panel')).not.toBeVisible();

  // 4. Test maximize editor
  await page.click('.max-editor-btn');
  // Both sidebar and chat should be hidden
  await expect(page.locator('.code-sidebar')).not.toBeVisible();

  // Restore layout
  await page.click('.restore-layout-btn');
  await expect(page.locator('.code-sidebar')).toBeVisible();
  await expect(page.locator('.code-chat-panel')).toBeVisible();
});
