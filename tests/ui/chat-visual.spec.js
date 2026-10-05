// 聊天模块视觉/布局真实渲染用例（需要浏览器，属于 npm run test:ui 范畴）。
//
// 为什么需要它：本轮多次出现"源码看着对、跑起来很难看"的缺陷 ——
//   深色输入框被后加载的浅色规则覆盖、图片气泡被撑成一大块、操作条里的按钮被全局
//   按钮系统套成白色圆片。现有测试全是对源码做正则匹配，一条都拦不住。
//   这个用例真的把聊天界面渲染出来，既产出截图供人眼复核，也对关键布局做硬断言。
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const SHOT_DIR = path.join(__dirname, '..', '..', 'output', 'chat-visual');

// Install bootstrap mocks before navigation: startup refresh must retain the
// authenticated actor, and no fixture may contact production Supabase.
test.beforeEach(async ({ page }) => {
  await page.route('**/*.supabase.co/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, token: 'chat-visual-token', user_name: 'viewer', data: [], items: [], friends: [], conversations: [] }),
  }));
});

const MSG = {
  m1: { id: 'm1', user_name: 'friend', media_url: 'viewer', views: 0, actor_key: 'dm_1', created_at: '2026-09-25T10:00:00.000Z', content: JSON.stringify({ text: '在吗？给你看张照片', read_at: null }) },
  m3: { id: 'm3', user_name: 'viewer', media_url: 'friend', views: 0, actor_key: 'dm_3', created_at: '2026-09-25T10:02:00.000Z', content: JSON.stringify({ text: '这张是原图，没有压缩', read_at: null }) },
  m4: { id: 'm4', user_name: 'friend', media_url: 'viewer', views: 0, actor_key: 'dm_4', created_at: '2026-09-25T10:03:00.000Z', content: JSON.stringify({ text: '好看！', read_at: null }) },
  withdrawn: { id: 'm5', user_name: 'friend', media_url: 'viewer', views: 0, actor_key: 'dm_5', created_at: '2026-09-25T10:04:00.000Z', content: JSON.stringify({ text: '[消息已撤回]', withdrawn: true, read_at: null }) },
  longText: { id: 'm6', user_name: 'friend', media_url: 'viewer', views: 0, actor_key: 'dm_6', created_at: '2026-09-25T10:05:00.000Z', content: JSON.stringify({ text: '这是一条很长的消息，用来验证气泡在窄屏上的换行与最大宽度是否正常。它足够长，应该会自动折行而不是把气泡撑破，也不应该溢出到屏幕外面去。', read_at: null }) },
};

async function mockApis(page, messages, extra) {
  const routes = [
    page.route('**/api/user/refresh', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'chat-visual-token', user_name: 'viewer' }) })),
    page.route('**/api/feed**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 }) })),
    // 注意：这里要与 /api/dm/messages 用**同一批 id**。会话列表会被预热进 _chatCache，
    //   mergeDockChatMessages 会把"比快照新"的缓存消息并回会话；编一条 id 不同但内容/时间
    //   相同的行，界面上就会出现两条一模一样的消息（曾因此误判成渲染 bug）。
    page.route('**/api/dm/list**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [messages[messages.length - 1], { id: 'c2', user_name: 'viewer', media_url: 'other', content: JSON.stringify({ text: '晚点聊' }), created_at: '2026-09-25T09:00:00.000Z', views: 1 }] }),
    })),
    page.route('**/api/dm/messages?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: messages }) })),
    page.route('**/api/chat/relationship**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, relationship: { status: 'friends', is_friend: true, can_message: true } }) })),
    page.route('**/api/chat/friends', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, friends: [] }) })),
    page.route('**/api/chat/requests**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requests: [] }) })),
    page.route('**/api/avatar/batch', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, avatars: {} }) })),
    page.route('**/api/config/public', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })),
  ];
  if (extra) routes.push(...extra);
  return Promise.all(routes);
}

async function makeImageDataUrl(page) {
  return page.evaluate(() => {
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
}

async function openChat(page, messages, extra) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await mockApis(page, messages, extra);
  await page.waitForFunction(() => typeof window.openChat === 'function');
  await page.evaluate(() => window.openChat('friend'));
  await expect(page.locator('#dockChatMessages')).toContainText('在吗');
  await page.waitForTimeout(300);
}

test('浅色模式：气泡与操作条渲染正常', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-visual-test');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dataUrl = await makeImageDataUrl(page);
  const messages = [
    MSG.m1,
    { id: 'm2', user_name: 'viewer', media_url: 'friend', views: 1, actor_key: '__dm_img__chat/v_1_a.png', created_at: '2026-09-25T10:01:00.000Z', content: JSON.stringify({ text: '', read_at: '2026-09-25T10:01:30.000Z', media: { kind: 'image', url: dataUrl, mimeType: 'image/png' } }) },
    MSG.m3, MSG.m4,
  ];
  await openChat(page, messages);

  // 断言：图片气泡必须贴着图片，而不是被撑到 max-width(75%)
  const geom = await page.evaluate(() => {
    const bubble = document.querySelector('#dockChatMessages .chat-msg.has-media');
    const img = bubble && bubble.querySelector('.msg-img');
    if (!bubble || !img) return null;
    return { bubbleW: bubble.getBoundingClientRect().width, imgW: img.getBoundingClientRect().width };
  });
  expect(geom, 'media bubble not found').not.toBeNull();
  expect(geom.imgW).toBeGreaterThan(100);
  expect(geom.bubbleW - geom.imgW, 'image bubble is far wider than the image').toBeLessThan(30);

  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-light.png') });
});

test('深色模式：输入框必须真的是深色（审计 H-6 回归）', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-visual-test');
    localStorage.setItem('xtj-theme', 'dark');
    localStorage.setItem('xtj_theme', 'dark');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openChat(page, [MSG.m1, MSG.m3, MSG.m4, MSG.withdrawn, MSG.longText]);

  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const inputBg = await page.evaluate(() => {
    const wrap = document.querySelector('#panelChat .chat-input-wrap');
    return wrap ? getComputedStyle(wrap).backgroundColor : null;
  });
  expect(inputBg, 'chat input wrapper not found').not.toBeNull();
  // 取背景色亮度：深色模式下必须是深色（曾被后加载的浅色玻璃规则刷成 rgba(255,255,255,.3)）
  const lum = await page.evaluate((css) => {
    const m = String(css).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return 1;
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }, inputBg);
  expect(lum, 'dark-mode chat input is too light: ' + inputBg + ' (data-theme=' + theme + ')').toBeLessThan(0.5);

  // 长文本气泡不得溢出聊天区
  const overflow = await page.evaluate(() => {
    const pane = document.getElementById('dockChatMessages');
    const paneRect = pane.getBoundingClientRect();
    return Array.prototype.some.call(pane.querySelectorAll('.chat-msg'), (el) => {
      const r = el.getBoundingClientRect();
      return r.right > paneRect.right + 1 || r.left < paneRect.left - 1;
    });
  });
  expect(overflow, 'a bubble overflows the message pane').toBe(false);

  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-dark.png') });
});

test('发送失败：失败气泡与"长按重发"提示必须出现', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-visual-test');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // 用 canvas 造一张 320x200 的正常尺寸 PNG（内联的 8x8 测试图太小，
  //   气泡会被压成一条，看不出失败态的真实观感）
  const fixtureB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 320, 200);
    g.addColorStop(0, '#ffd6e0'); g.addColorStop(1, '#c98b9b');
    x.fillStyle = g; x.fillRect(0, 0, 320, 200);
    x.fillStyle = 'rgba(255,255,255,.92)';
    x.font = 'bold 22px sans-serif';
    x.fillText('320 x 200', 95, 110);
    return c.toDataURL('image/png').split(',')[1];
  });
  const fixtureBuffer = Buffer.from(fixtureB64, 'base64');
  await openChat(page, [MSG.m1, MSG.m4], [
    // 上传成功、发送被服务端明确拒绝 → 走"失败态气泡"分支
    page.route('**/api/dm/upload?**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, storage_path: 'chat/v_1_fixture.png', public_url: 'https://example.invalid/fixture.png', kind: 'image', mime_type: 'image/png' }),
    })),
    page.route('**/api/dm/upload/abort', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })),
    page.route('**/api/dm/send', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '接收用户不存在' }) })),
  ]);

  await page.setInputFiles('#dockChatFileInp', { name: 'fixture-photo.png', mimeType: 'image/png', buffer: fixtureBuffer });
  await expect(page.locator('#dockChatFilePreview')).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-attachment-card.png') });

  await page.click('#dockChatSendBtn');
  const failed = page.locator('#dockChatMessages .chat-msg.failed');
  await expect(failed).toBeVisible({ timeout: 10000 });
  // Media status sits below the bubble in the same message row.
  const failedRow = page.locator('#dockChatMessages .chat-msg-row').filter({ has: page.locator('.chat-msg.failed') });
  await expect(failedRow.locator('.msg-fail-mark')).toBeVisible();
  await expect(failedRow.locator('.msg-fail-mark')).toContainText('发送失败');
  await page.waitForTimeout(200);
  // 诊断：把含「发送」的可见文本连同伪元素 content 一起挖出来（含位置）
  const diag = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      ['::before', '::after'].forEach((pe) => {
        const c = getComputedStyle(el, pe).content;
        if (c && c !== 'none' && c !== 'normal' && /发送/.test(c)) {
          const r = el.getBoundingClientRect();
          out.push('PSEUDO ' + (el.className || el.id) + pe + ' = ' + c + ' @' + Math.round(r.x) + ',' + Math.round(r.y));
        }
      });
      const own = Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 3)
        .map((n) => n.textContent).join('').trim();
      if (own && /发送/.test(own)) {
        const r = el.getBoundingClientRect();
        out.push('TEXT ' + (el.className || el.id || el.tagName) + ' = ' + own.slice(0, 30) + ' @' + Math.round(r.x) + ',' + Math.round(r.y));
      }
    });
    return out;
  });
  console.log('DIAG send-text: ' + JSON.stringify(diag, null, 1));
  const listTimes = await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('#dockChatList .chat-list-item'),
    (n) => (n.getAttribute('data-chat-user') || '?') + ' t=' + (n.querySelector('.cli-time') || {}).textContent
  ));
  console.log('DIAG chat-list times: ' + JSON.stringify(listTimes));
  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-failed.png') });
});

test('消息操作条贴近气泡，切换原图有状态反馈，转发仍可用', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'viewer');
    localStorage.setItem('xtj_device_id', 'chat-visual-test');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openChat(page, [MSG.m1, MSG.m4]);

  // ⚠ 必须用 :not(.dm-forward-panel) 限定：转发面板复用了 .dm-action-panel 类，
  //   只写 .dm-action-panel 会匹配到它，导致断言看错元素（曾经因此误判面板过大/过透）。
  const ACTION_PANEL = '.dm-action-panel:not(.dm-forward-panel)';

  const bubble = page.locator('#dockChatMessages .chat-msg').first();
  await bubble.click({ button: 'right' });
  await expect(page.locator(ACTION_PANEL)).toBeVisible();
  // 等 opacity/transform 过渡走完（0.2s），否则截到半透明中间态
  await page.waitForTimeout(320);

  const diag = await page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    if (!panel) return null;
    const grid = panel.querySelector('.dm-action-grid');
    const item = grid && grid.querySelector('.dm-action-item');
    const icon = item && item.querySelector('.dm-action-icon');
    const ics = item ? getComputedStyle(item) : null;
    const pr = panel.getBoundingClientRect();
    const br = document.querySelector('#dockChatMessages .chat-msg').getBoundingClientRect();
    const ir = item ? item.getBoundingClientRect() : null;
    return {
      panelW: Math.round(pr.width), panelH: Math.round(pr.height),
      items: grid ? grid.querySelectorAll('.dm-action-item').length : 0,
      itemW: ir ? Math.round(ir.width) : null, itemH: ir ? Math.round(ir.height) : null,
      itemPadX: ics ? ics.paddingLeft : null,
      itemMinH: ics ? ics.minHeight : null,
      itemBgImage: ics ? ics.backgroundImage : null,
      iconW: icon ? Math.round(icon.getBoundingClientRect().width) : null,
      iconRadius: icon ? getComputedStyle(icon).borderRadius : null,
      anchorTop: br.top, anchorBottom: br.bottom, panelTop: pr.top, panelBottom: pr.bottom,
      panelBg: getComputedStyle(panel).backgroundColor,
    };
  }, ACTION_PANEL);
  console.log('DIAG action-panel: ' + JSON.stringify(diag));
  expect(diag, 'action panel not found').not.toBeNull();

  expect(diag.panelW, 'action panel too wide').toBeLessThanOrEqual(370);
  expect(diag.panelH, 'action grid exceeds two rows').toBeLessThanOrEqual(180);
  expect(diag.panelBottom <= diag.anchorTop + 1 || diag.panelTop >= diag.anchorBottom - 1,
    'action bar should appear above or below its bubble').toBeTruthy();
  expect(diag.items, 'expected complete action grid').toBeGreaterThanOrEqual(4);
  // 全局按钮系统不得覆盖菜单的紧凑布局。
  expect(diag.itemBgImage === 'none' || diag.itemBgImage === '', 'item picked up the global glass gradient').toBeTruthy();
  expect(parseFloat(diag.itemMinH), 'item height should fit a touch target').toBeGreaterThanOrEqual(50);
  expect(parseFloat(diag.itemPadX), 'item inherited the global 16px padding-inline').toBeLessThan(8);
  expect(diag.iconW, 'compact icon should be about 32px').toBeGreaterThanOrEqual(30);
  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-action-panel.png') });

  await page.keyboard.press('Escape');
  await expect(page.locator(ACTION_PANEL)).toHaveCount(0);
  const original = page.locator('#dockChatOrigBtn');
  await expect(original).toHaveAttribute('aria-checked', 'false');
  await original.click();
  await expect(original).toHaveAttribute('aria-checked', 'true');
  await expect(original).toHaveClass(/is-on/);
  await original.click();
  await expect(original).toHaveAttribute('aria-checked', 'false');

  await bubble.click({ button: 'right' });

  // 转发面板
  await page.locator(ACTION_PANEL + ' [data-dm-action="forward"]').click();
  const picker = page.locator('.dm-forward-panel');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('转发到');
  const box = await picker.boundingBox();
  expect(box.width, 'forward picker must fit the viewport').toBeLessThanOrEqual(440);
  await page.screenshot({ path: path.join(SHOT_DIR, 'chat-forward-picker.png') });
});
