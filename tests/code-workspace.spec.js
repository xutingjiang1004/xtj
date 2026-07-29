const { test, expect } = require('@playwright/test');
const fs = require('fs');

test.describe('Code Workspace', () => {
  test.beforeEach(async ({ page }) => {
    // The production default is SSE. These tests exercise the JSON error and
    // request-body contract, so opt into the explicit non-stream fixture.
    await page.addInitScript(() => {
      localStorage.setItem('CODE_STREAM_ENABLED', '0');
    });
    // Keep offline UI tests independent from third-party SDK/font requests.
    // This must be installed before navigation so a pending external request
    // cannot delay the local app bootstrap or page teardown.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('jsdelivr.net') || /fonts\.googleapis\.com|fonts\.gstatic\.com|\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(url)) {
        return route.abort();
      }
      return route.continue();
    });
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

  test('offline Code keeps the editor usable and resizers change pane proportions', async ({ page }) => {
    await page.evaluate(() => {
      window.showOpenFilePicker = async () => [{
        kind: 'file',
        name: 'offline.js',
        getFile: async () => new File(['export const offline = true;'], 'offline.js', { type: 'text/javascript' })
      }];
    });
    await page.click('#codeWelcomeFileBtn');
    await page.waitForSelector('.code-textarea', { state: 'visible', timeout: 7000 });
    await expect(page.locator('.code-textarea')).toHaveValue('export const offline = true;');

    const before = await page.evaluate(() => ({
      sidebar: document.querySelector('.code-sidebar').getBoundingClientRect().width,
      editor: document.querySelector('.code-editor-column').getBoundingClientRect().width,
      chat: document.querySelector('.code-chat-panel').getBoundingClientRect().width
    }));
    const divider = await page.locator('.code-resizer-left').boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + 260);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2 + 72, divider.y + 260, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() => ({
      sidebar: document.querySelector('.code-sidebar').getBoundingClientRect().width,
      editor: document.querySelector('.code-editor-column').getBoundingClientRect().width,
      chat: document.querySelector('.code-chat-panel').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    expect(after.sidebar).toBeGreaterThan(before.sidebar + 40);
    expect(after.editor).toBeGreaterThan(180);
    expect(after.chat).toBeGreaterThan(240);
    expect(after.overflow).toBeLessThanOrEqual(1);

    // Width transitions finish before measuring the next divider. Otherwise
    // the old hit target can be sampled while the editor is still moving.
    await page.waitForTimeout(350);
    const rightDivider = await page.locator('.code-resizer-right').boundingBox();
    await page.mouse.move(rightDivider.x + rightDivider.width / 2, rightDivider.y + 260);
    await page.mouse.down();
    await page.mouse.move(rightDivider.x + rightDivider.width / 2 - 72, rightDivider.y + 260, { steps: 6 });
    await page.mouse.up();
    const afterRight = await page.evaluate(() => ({
      editor: document.querySelector('.code-editor-column').getBoundingClientRect().width,
      chat: document.querySelector('.code-chat-panel').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    expect(afterRight.chat).toBeGreaterThan(after.chat + 40);
    expect(afterRight.editor).toBeGreaterThan(180);
    expect(afterRight.overflow).toBeLessThanOrEqual(1);
  });

  test('should intercept 500 API errors and show toast', async ({ page }, testInfo) => {
    // 1. Intercept API
    await page.route('**/api/code/chat*', async route => {
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
  await page.addInitScript(() => {
    localStorage.setItem('CODE_STREAM_ENABLED', '0');
  });
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
  await page.route('**/api/code/chat*', async (route) => {
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
    var api = window.__xtjCodeWorkspaceAPI;
    var state = api && api.getState ? api.getState() : null;
    if (state) {
      state.openTabs.push({ path: 'broken.pdf', name: 'broken.pdf', type: 'document', _extractPromise: Promise.resolve(), _extractError: 'Cannot parse PDF' });
      state.activePath = 'broken.pdf';
    }
  });

  // Open normal JS file
  await page.evaluate(() => {
    var api = window.__xtjCodeWorkspaceAPI;
    var state = api.getState();
    state.openTabs.push({ path: 'normal.js', name: 'normal.js', type: 'code', _currentContent: 'console.log("ok");' });
    state.activePath = 'normal.js';
    state.sending = false;
    api.renderTabs();
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
  // Wait for network request to chat
  const chatResponse = page.waitForResponse(response => response.url().includes('/api/code/chat'));
  await page.click('#codeChatSendBtn', { force: true });
  await chatResponse;

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

test('Code keeps an usable editor column at compact desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => [{
      kind: 'file',
      name: 'compact.js',
      getFile: async () => new File(['export const compact = true;'], 'compact.js', { type: 'text/javascript' })
    }];
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.click('button[data-desktop-tab="code"]');
  await page.waitForSelector('#codeWelcomeFileBtn', { state: 'visible', timeout: 10000 });
  await page.click('#codeWelcomeFileBtn');
  await page.waitForSelector('.code-workspace', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);

  const editorWidth = await page.locator('.code-editor-column').evaluate((el) => el.getBoundingClientRect().width);
  expect(editorWidth).toBeGreaterThanOrEqual(150);
  const panel = await page.locator('#panelCode').boundingBox();
  expect(panel).not.toBeNull();
  expect(panel.y + panel.height).toBeLessThanOrEqual(768);
});

test('built Code bundle keeps the modification preview and action bar full width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.addInitScript(() => {
    localStorage.setItem('CODE_STREAM_ENABLED', '0');
    window.showOpenFilePicker = async () => [{
      kind: 'file',
      name: 'built-preview.js',
      getFile: async () => new File(['export const built = true;'], 'built-preview.js', { type: 'text/javascript' })
    }];
  });
  await page.route('**/api/code/chat*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        reply: '已生成修改预览',
        operations: [{
          path: 'built-preview.js',
          type: 'replace_range',
          start_line: 1,
          end_line: 1,
          new_content: 'export const built = false;',
          summary: '更新示例值'
        }]
      })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.click('button[data-desktop-tab="code"]');
  await page.waitForSelector('#codeWelcomeFileBtn', { state: 'visible', timeout: 10000 });
  await page.click('#codeWelcomeFileBtn');
  await page.waitForSelector('#codeChatInput', { state: 'visible', timeout: 10000 });
  await page.evaluate(() => {
    window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options || {}));
  });
  await page.fill('#codeChatInput', '修改这个文件');
  await page.click('#codeChatSendBtn');
  await page.waitForSelector('#codeDiffView', { state: 'visible', timeout: 10000 });

  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      editorArea: rect('#codeEditorArea'),
      diffView: rect('#codeDiffView'),
      applyBar: rect('#codeApplyBar')
    };
  });
  expect(metrics.diffView.width).toBeGreaterThan(metrics.editorArea.width * 0.95);
  expect(metrics.applyBar.width).toBeGreaterThan(metrics.editorArea.width * 0.95);
  expect(metrics.applyBar.y + metrics.applyBar.height).toBeLessThanOrEqual(metrics.editorArea.y + metrics.editorArea.height + 1);
  await page.screenshot({ path: testInfo.outputPath('built-operation-preview-layout.png'), fullPage: false });
});
