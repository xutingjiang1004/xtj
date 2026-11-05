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

test('离线提示条：打开页面时就已离线要显示；从后台/缓存恢复时已联网要撤掉', { timeout: 90000 }, async () => {
  // 提示条以前只在 offline 事件里创建、online 事件里移除：页面加载时已经离线没有事件，用户看不到任何提示；
  // 离线后切走（bfcache / 后台冻结）、联网后回来，online 事件错过了，「网络已断开」一直挂在屏幕上。
  const s = await h.open({
    viewport: { width: 390, height: 844 }, settleMs: 1200,
    init: () => { window.__xtjOnLine = false; Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get() { return window.__xtjOnLine; } }); },
  });
  try {
    const p = s.page;
    assert.equal(await p.locator('#xtjOfflineBar').count(), 1, '加载时已离线，提示条应显示');
    await p.evaluate(() => { window.__xtjOnLine = true; window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await p.waitForTimeout(200);
    assert.equal(await p.locator('#xtjOfflineBar').count(), 0, '恢复显示时已联网，提示条应撤掉');
    await p.evaluate(() => { window.__xtjOnLine = false; document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(200);
    assert.equal(await p.locator('#xtjOfflineBar').count(), 1, '回到前台时已离线，提示条应出现');
    await p.evaluate(() => { window.__xtjOnLine = true; window.dispatchEvent(new Event('online')); });
    await p.waitForTimeout(200);
    assert.equal(await p.locator('#xtjOfflineBar').count(), 0, 'online 事件仍然撤掉提示条');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
