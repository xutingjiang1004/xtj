const { test, expect } = require('@playwright/test');

test('small-cat Qwen setup renders a real download percentage and bar', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    // The homepage uses a lazy AI launcher which performs auth preflight
    // before the real AI module renders its root. Install the fixture before
    // any application script runs so the test exercises the real open path.
    window.currentUser = 'progress-fixture-user';
    window.localStorage.setItem('xtj_user', 'progress-fixture-user');
    window.localStorage.setItem('xtj_user_token', 'fixture-token');
    window.ensureUserToken = async function () { return 'fixture-token'; };
    window.ensureProtectedOperationAuth = async function () { return { ok: true }; };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__xtjOpenAiChat === 'function', { timeout: 15000 });

  await page.evaluate(() => {
    // Core auth wiring may replace the init fixture while the page boots.
    // Re-assert it immediately before invoking the lazy launcher as well.
    window.currentUser = 'progress-fixture-user';
    window.ensureUserToken = async function () { return 'fixture-token'; };
    window.ensureProtectedOperationAuth = async function () { return { ok: true }; };
    var runtimeState = 'idle';
    var listeners = [];
    var runtime = {
      LOCAL_MODEL_ID: 'fixture-local-qwen',
      isSupported: function () { return true; },
      getModelDescriptor: function () { return { name: 'Fixture Qwen' }; },
      getState: function () { return runtimeState; },
      getProgressValue: function () { return 0.37; },
      getProgressText: function () { return '正在下载模型文件'; },
      onStatusChange: function (listener) { listeners.push(listener); return function () {}; },
      ensureReady: function (options) {
        runtimeState = 'downloading';
        listeners.forEach(function (listener) { listener({ state: runtimeState, progress: 0.37, text: '正在下载模型文件' }); });
        options.onProgress({ progress: 0.37, text: '正在下载模型文件' });
        return new Promise(function (resolve, reject) {
          var settled = false;
          function cancel() {
            if (settled) return;
            settled = true;
            runtimeState = 'cancelled';
            listeners.forEach(function (listener) { listener({ state: runtimeState, progress: 0.37, text: '已取消' }); });
            var error = new Error('本地模型下载已取消');
            error.code = 'LOCAL_AI_CANCELLED';
            reject(error);
          }
          if (options.signal) {
            if (options.signal.aborted) cancel();
            else options.signal.addEventListener('abort', cancel, { once: true });
          }
          setTimeout(function () {
            if (settled) return;
            settled = true;
            runtimeState = 'ready';
            listeners.forEach(function (listener) { listener({ state: runtimeState, progress: 1, text: '已完成' }); });
            resolve();
          }, 2000);
        });
      }
    };
    window.__xtjEnsureLocalAI = function () { return Promise.resolve(runtime); };
    return window.__xtjOpenAiChat();
  });

  await expect(page.locator('#aiChatRoot')).toBeVisible({ timeout: 10000 });
  await page.locator('.ai-chat-local-setup').click();
  const progress = page.locator('.ai-chat-local-progress');
  await expect(progress).toBeVisible();
  await expect(progress.locator('.ai-chat-local-progress-value')).toHaveText('37%');
  await expect(progress.locator('.ai-chat-local-progress-fill')).toHaveCSS('width', /.+/);
  await expect(progress.locator('.ai-chat-local-progress-detail')).toHaveText('正在下载模型文件');

  await page.locator('.ai-chat-local-setup').click();
  await expect(progress).toHaveAttribute('data-state', 'cancelled');
  await expect(page.locator('.ai-chat-local-setup')).toHaveText('下载本地 Qwen（约 1GB）');
});

test('small-cat Qwen stops before download and returns to online mode when WebGPU has too few storage buffers', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    window.currentUser = 'low-limit-fixture-user';
    window.localStorage.setItem('xtj_user', 'low-limit-fixture-user');
    window.localStorage.setItem('xtj_user_token', 'fixture-token');
    window.ensureUserToken = async function () { return 'fixture-token'; };
    window.ensureProtectedOperationAuth = async function () { return { ok: true }; };
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async function () {
          return { limits: { maxStorageBuffersPerShaderStage: 8 } };
        }
      }
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__xtjOpenAiChat === 'function', { timeout: 15000 });

  await page.evaluate(() => {
    window.currentUser = 'low-limit-fixture-user';
    window.ensureUserToken = async function () { return 'fixture-token'; };
    window.ensureProtectedOperationAuth = async function () { return { ok: true }; };
    return window.__xtjOpenAiChat();
  });

  await expect(page.locator('#aiChatRoot')).toBeVisible({ timeout: 10000 });
  await page.locator('.ai-chat-local-setup').click();

  const progress = page.locator('.ai-chat-local-progress');
  await expect(progress).toHaveAttribute('data-state', 'unsupported');
  await expect(progress).toContainText('此设备不兼容本地 Qwen');
  await expect(progress).toContainText('限制为 8');
  await expect(progress).toContainText('在线 DeepSeek');
  await expect(page.locator('.ai-chat-model-selector')).toHaveValue('online');
  await expect(page.locator('.ai-chat-local-setup')).toBeDisabled();
  await expect(page.locator('.ai-chat-local-setup')).toHaveText('此设备不支持本地 Qwen');
});
