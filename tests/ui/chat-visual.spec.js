// 聊天模块视觉/布局真实渲染用例（需要浏览器，属于 npm run test:ui 范畴）。
//
// 为什么需要它：本轮多次出现"源码看着对、跑起来很难看"的缺陷 ——
//   深色输入框被后加载的浅色规则覆盖、图片气泡被撑成一大块、操作条里的按钮被全局
//   按钮系统套成白色圆片。现有测试全是对源码做正则匹配，一条都拦不住。
//   这个用例真的把聊天界面渲染出来，既产出截图供人眼复核，也对两处布局做硬断言。
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const SHOT_DIR = path.join(__dirname, '..', '..', 'output', 'chat-visual');

function mockApis(page, messages) {
  return Promise.all([
    page.route('**/api/user/refresh', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ token: 'chat-visual-token' }),
    })),
    page.route('**/api/feed**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 }),
    })),
    page.route('**/api/dm/list', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        // 注意：这里必须是**同一批消息**（id 与 /api/dm/messages 一致）。
        //   会话列表会被预热进 _chatCache，mergeDockChatMessages 对"比快照新"的缓存消息
        //   会并回会话 —— 若 mock 里编一条 id 不同但内容/时间相同的消息，界面上就会
        //   出现两条一模一样的"好看！"（曾经因此误判成渲染 bug）。
        data: [
          { id: 'm4', user_name: 'friend', media_url: 'viewer', content: JSON.stringify({ text: '好看！', read_at: null }), created_at: '2026-09-25T10:03:00.000Z', views: 0 },
          { id: 'c2', user_name: 'viewer', media_url: 'other', content: JSON.stringify({ text: '晚点聊' }), created_at: '2026-09-25T09:00:00.000Z', views: 1 },
        ],
      }),
    })),
    page.route('**/api/dm/messages?**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: messages }),
    })),
    page.route('**/api/avatar/batch', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, avatars: {} }),
    })),
    page.route('**/api/config/public', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
    })),
  ]);
}

test('chat message bubbles and the long-press action bar render sanely', async ({ page }) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-visual-test');
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // 在浏览器里现造一张图，避免依赖任何外部资源
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 280;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 400, 280);
    g.addColorStop(0, '#8fd0ae'); g.addColorStop(1, '#2f7d5b');
    x.fillStyle = g; x.fillRect(0, 0, 400, 280);
    x.fillStyle = 'rgba(255,255,255,.9)';
    x.font = 'bold 26px sans-serif';
    x.fillText('400 x 280', 120, 155);
    return c.toDataURL('image/png');
  });

  const messages = [
    { id: 'm1', user_name: 'friend', media_url: 'viewer', views: 0, actor_key: 'dm_1', created_at: '2026-09-25T10:00:00.000Z', content: JSON.stringify({ text: '在吗？给你看张照片', read_at: null }) },
    { id: 'm2', user_name: 'viewer', media_url: 'friend', views: 1, actor_key: '__dm_img__chat/v_1_a.png', created_at: '2026-09-25T10:01:00.000Z', content: JSON.stringify({ text: '', read_at: '2026-09-25T10:01:30.000Z', media: { kind: 'image', url: dataUrl, mimeType: 'image/png' } }) },
    { id: 'm3', user_name: 'viewer', media_url: 'friend', views: 0, actor_key: 'dm_3', created_at: '2026-09-25T10:02:00.000Z', content: JSON.stringify({ text: '这张是原图，没有压缩', read_at: null }) },
    { id: 'm4', user_name: 'friend', media_url: 'viewer', views: 0, actor_key: 'dm_4', created_at: '2026-09-25T10:03:00.000Z', content: JSON.stringify({ text: '好看！', read_at: null }) },
  ];
  await mockApis(page, messages);

  await page.waitForFunction(() => typeof window.openChat === 'function');
  await page.evaluate(() => window.openChat('friend'));
  await expect(page.locator('#dockChatMessages')).toContainText('在吗？给你看张照片');
  await expect(page.locator('#dockChatMessages .msg-img')).toBeVisible();
  await page.waitForTimeout(300);

  // ── 断言 1：图片气泡必须贴着图片，而不是被撑到 max-width(75%) ──
  const geom = await page.evaluate(() => {
    const bubble = document.querySelector('#dockChatMessages .chat-msg.has-media');
    const img = bubble && bubble.querySelector('.msg-img');
    if (!bubble || !img) return null;
    const b = bubble.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return { bubbleW: b.width, imgW: i.width, slack: b.width - i.width };
  });
  expect(geom, 'media bubble not found').not.toBeNull();
  expect(geom.imgW).toBeGreaterThan(100);
  // 气泡只应比图片多出内边距（12px 左右），而不是多出几百像素
  expect(geom.slack, 'image bubble is far wider than the image').toBeLessThan(30);

  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-desktop.png'), fullPage: false });

  // ── 断言 2：右键操作条必须弹出，且是"细长条"（矮），且条内按钮没有被全局按钮系统刷白 ──
  await page.locator('#dockChatMessages .chat-msg.has-media').first().click({ button: 'right' });
  const bar = page.locator('.dm-bar');
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox();
  expect(barBox.height, 'action bar should be a slim strip').toBeLessThan(80);

  const btnStyle = await page.evaluate(() => {
    const btn = document.querySelector('.dm-bar .dm-bar-item');
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, radius: cs.borderRadius, minH: cs.minHeight, padLeft: cs.paddingLeft };
  });
  expect(btnStyle, 'bar item not found').not.toBeNull();
  // 被共享按钮系统刷白时会带上玻璃渐变背景 —— 必须没有
  expect(btnStyle.bgImage === 'none' || btnStyle.bgImage === '', 'bar item picked up the global glass gradient').toBeTruthy();
  expect(btnStyle.bg, 'bar item should be transparent').toMatch(/rgba?\(0, 0, 0, 0\)|transparent/);
  expect(parseFloat(btnStyle.minH), 'bar item inherited the global 40px min-height').toBeLessThan(30);

  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-action-bar.png') });

  await page.keyboard.press('Escape');

  // ── 手机宽度再截一张（长按菜单与气泡在窄屏的表现完全不同） ──
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(250);
  await page.locator('#dockChatMessages .chat-msg.has-media').first().click({ button: 'right' });
  await expect(page.locator('.dm-bar')).toBeVisible();
  const mobileBar = await page.locator('.dm-bar').boundingBox();
  expect(mobileBar.width, 'action bar must fit the phone width').toBeLessThanOrEqual(390);
  expect(mobileBar.x, 'action bar must stay inside the viewport').toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-action-bar-mobile.png') });
});
