// ★ 2026-09-04 审计 M69 修复：本地/CI 测试严禁连真实 Supabase。
//   下方 webServer env 全部使用测试专用假值常量，不再从 process.env 回退，
//   避免开发者本机或 CI 环境注入了真实 SUPABASE_SERVICE_KEY 时测试直连真库
//   （写入/删除/改额度的用例可能污染生产数据）。
const TEST_ONLY_API_SECRET = 'xtj-test-only-api-secret-not-for-production';
const TEST_ONLY_SUPABASE_KEY = 'xtj-test-only-supabase-service-key-not-for-production';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  // ★ 2026-08-10 审计修复：这 7 个 spec 已废弃（曾混入 npm test 静默空跑，现已从
  //   package.json scripts.test 移除）。此处继续显式排除，避免 test:ui 误跑废弃用例；
  //   如需重新启用请先核对页面/接口仍存在，再移除对应条目或单独维护一条 CI 用例。
  testIgnore: /.*(ai-frontend-fixes|auth-account-switch|cat-ai-realtime|comment-mention-autocomplete|desktop-nav-refresh|photo-upload-status|photo-wall-fixes)\.spec\.js/,
  // ★ 禁止提交 .only：防止 CI 中被聚焦的用例静默跳过其余回归
  forbidOnly: true,
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
      // ★ 冷启动/安装依赖后 Node 服务常需 >10s 才能监听端口，原 10s 会假阴性中断测试
      timeout: 60000,
      env: {
        API_PROXY_TARGET: 'http://127.0.0.1:10000'
      }
    },
    {
      command: 'node render-api/server.js',
      port: 10000,
      reuseExistingServer: !process.env.CI,
      // ★ 同上：冷启动时间放宽，避免与代码无关的假失败
      timeout: 60000,
      env: {
        PORT: '10000',
        // ★ M69：强制测试假值。若某个用例确实需要真实凭据（如与真实第三方联调），
        //   请单独显式命名并注释用途，禁止使用 process.env.X || 'xxx' 形式的静默回退。
        API_SECRET: TEST_ONLY_API_SECRET,
        SUPABASE_SERVICE_KEY: TEST_ONLY_SUPABASE_KEY,
        ALLOWED_ORIGINS: 'http://127.0.0.1:4173'
      }
    }
  ]
});
