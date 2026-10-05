const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /(?:mobile-theme-polish|ui-polish)\.spec\.js/,
  forbidOnly: true,
  workers: 2,
  timeout: 30000,
  outputDir: '../output/playwright/mobile-theme',
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit', testMatch: /mobile-theme-polish\.spec\.js/, use: { ...devices['iPhone 13'], browserName: 'webkit' } }
  ],
  // All API/database requests are mocked by these specs. No production backend.
  webServer: { command: 'node scripts/serve-static.js', cwd: require('path').resolve(__dirname, '..'),
    url: 'http://127.0.0.1:4173', reuseExistingServer: true }
});
