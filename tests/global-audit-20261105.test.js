'use strict';
// 全站审计（2026-11-05，global 板块）的回归测试。浏览器流程都驱动真实页面（scripts/maintenance/harness.js）。
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');

test('已登录但令牌刷新暂时失败时，照片墙仍按访客身份加载公开照片', { timeout: 90000 }, async () => {
  // /api/user/refresh 返回 503：getUserAuthHeaders() 此时返回 null，照片墙列表请求以前把 null 直接塞进 fetch 的 headers，
  // 浏览器抛 TypeError，整个照片墙显示「加载失败」，而公开照片接口本身是正常的。
  const s = await h.open({
    viewport: { width: 1280, height: 800 }, mobile: false, settleMs: 1500,
    extraRoutes: async (url) => (url.pathname === '/api/user/refresh' ? { status: 503, json: { ok: false } } : null),
  });
  try {
    const p = s.page;
    await p.locator('.desktop-nav-item[data-desktop-tab="ai"]').click();
    await p.waitForSelector('.photo-wall-item', { timeout: 8000 });
    assert.ok(await p.locator('.photo-wall-item').count() > 0, '照片已渲染');
    assert.ok(!s.consoleMsgs.some((m) => /PhotoWall\] load failed/.test(m)), '没有「照片墙加载失败」报错: ' + s.consoleMsgs.join(' | '));
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
