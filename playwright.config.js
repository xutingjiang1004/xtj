const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  testIgnore: /.*(ai-frontend-fixes|auth-account-switch|cat-ai-realtime|comment-mention-autocomplete|desktop-nav-refresh|photo-upload-status|photo-wall-fixes)\.spec\.js/,
  timeout: 30000,
  workers: process.env.CI ? 2 : undefined,
  outputDir: 'output/playwright/test-results',
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    channel: process.env.PW_CHANNEL || (process.env.CI ? undefined : 'msedge'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'node scripts/serve-static.js',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
      env: {
        API_PROXY_TARGET: 'http://127.0.0.1:10000'
      }
    },
    {
      command: 'node render-api/server.js',
      port: 10000,
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
      env: {
        PORT: '10000',
        API_SECRET: process.env.API_SECRET || 'test-secret',
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || 'test-key',
        ALLOWED_ORIGINS: 'http://127.0.0.1:4173'
      }
    }
  ]
});
