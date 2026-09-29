const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.', testMatch: 'chat-completion-runtime.spec.js', forbidOnly: true,
  timeout: 30000, workers: 1, reporter: 'line', outputDir: '../output/playwright/chat-completion',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: process.env.CHAT_TEST_BROWSER || 'chromium',
    launchOptions: process.env.CHAT_TEST_BROWSER !== 'webkit' && process.env.CHAT_TEST_CHROMIUM ? { executablePath: process.env.CHAT_TEST_CHROMIUM } : {},
    screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/serve-static.js', cwd: '..', url: 'http://127.0.0.1:4173', reuseExistingServer: true }
});
