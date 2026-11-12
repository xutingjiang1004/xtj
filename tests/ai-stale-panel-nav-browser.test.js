'use strict';
// 2026-11-12 用户反馈：iPad 上点了小猫 AI 之后，左侧导航一直点不动。
// 小猫页面停在「登录后即可使用」（登录校验没通过）时，切换导航必须把它收起来。
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

const aiVisible = page => page.evaluate(() => { const p = document.getElementById('panelAiChat'); return !!p && p.classList.contains('active') && !p.classList.contains('hidden'); });

test('iPad sidebar: leaving the AI page that stopped at the login notice hides it and moves the highlight', { timeout: 60000 }, async t => {
  const f = await postBrowserFixture({ publicPosts: true, counts: [1], user: '', guestLimited: true, waitForPost: false, ios: 'ipad-desktop', viewport: { width: 1180, height: 820 } });
  t.after(() => f.close());
  const p = f.page; p.setDefaultTimeout(8000);
  await p.locator('.desktop-nav-item[data-desktop-action="ai-chat"]').waitFor();
  await p.locator('.desktop-nav-item[data-desktop-action="ai-chat"]').click();
  await p.waitForFunction(() => /登录后即可使用小猫 AI/.test(document.getElementById('panelAiChat').textContent) && !window.__xtjAiChatActive);
  assert.equal(await aiVisible(p), true);
  for (const tab of ['chat', 'profile', 'posts']) {
    await p.locator('.desktop-nav-item[data-desktop-tab="' + tab + '"]').click();
    await p.waitForFunction(tab => document.querySelector('.desktop-nav-item.is-active')?.getAttribute('data-desktop-tab') === tab, tab);
    assert.equal(await aiVisible(p), false, 'AI page is hidden after switching to ' + tab);
    assert.equal(await p.evaluate(() => document.body.classList.contains('xtj-ai-page-open') || document.body.classList.contains('secondary-page-open')), false);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('dockPanels')).visibility), 'visible');
    // 再点小猫还能重新打开。
    await p.locator('.desktop-nav-item[data-desktop-action="ai-chat"]').click();
    await p.waitForFunction(() => { const a = document.getElementById('panelAiChat'); return a.classList.contains('active') && !a.classList.contains('hidden') && /登录后即可使用小猫 AI/.test(a.textContent) && !window.__xtjAiChatActive; });
  }
  assert.deepEqual(f.errors, []);
});

test('phone dock: leaving the AI page that stopped at the login notice hides it', { timeout: 60000 }, async t => {
  const f = await postBrowserFixture({ publicPosts: true, counts: [1], user: '', guestLimited: true, waitForPost: false });
  t.after(() => f.close());
  const p = f.page; p.setDefaultTimeout(8000);
  await p.locator('.dock-tab[data-tab="ai-chat"]').click();
  await p.waitForFunction(() => /登录后即可使用小猫 AI/.test(document.getElementById('panelAiChat').textContent) && !window.__xtjAiChatActive);
  await p.locator('.dock-tab[data-tab="chat"]').click();
  await p.waitForFunction(() => document.getElementById('panelChat').classList.contains('active'));
  assert.equal(await aiVisible(p), false);
  assert.equal(await p.evaluate(() => document.body.style.touchAction), '');
  assert.deepEqual(f.errors, []);
});
