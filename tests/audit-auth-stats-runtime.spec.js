const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('Pro activity refreshes an HttpOnly-cookie session before declaring expiry', async ({ page }) => {
  await page.setContent('<div id="proGiftList"></div>');
  await page.evaluate(() => {
    window.currentUser = 'tester';
    window.XTJ_CONFIG = { API_BASE: 'https://api.example.test' };
    window.getUserToken = () => '';
    window.__refreshCalls = 0;
    window.getUserAuthHeaders = async () => {
      window.__refreshCalls += 1;
      return { 'Content-Type': 'application/json', Authorization: 'Bearer refreshed-token' };
    };
    window.fetch = async (_url, init) => ({
      ok: init.headers.Authorization === 'Bearer refreshed-token',
      status: 200,
      json: async () => ({ gifts: [] })
    });
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'pro-upgrade.js'), 'utf8');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => window.fetchProGifts());
  await expect.poll(() => page.evaluate(() => window.__refreshCalls)).toBe(1);
  await expect(page.locator('#proGiftList')).toContainText('暂无可用活动');
  await expect(page.locator('#proGiftList')).not.toContainText('登录状态已过期');
});

test('Pro activity keeps the session on a forbidden response', async ({ page }) => {
  await page.setContent('<div id="proGiftList"></div>');
  await page.evaluate(() => {
    window.currentUser = 'tester';
    window.XTJ_CONFIG = { API_BASE: 'https://api.example.test' };
    window.__clearCalls = 0;
    window.getUserAuthHeaders = async () => ({ Authorization: 'Bearer valid-token' });
    window.clearUserToken = () => { window.__clearCalls += 1; };
    window.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'pro-upgrade.js'), 'utf8');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => window.fetchProGifts());
  expect(await page.evaluate(() => window.__clearCalls)).toBe(0);
  await expect(page.locator('#proGiftList')).toContainText('无权查看');
});
