const { test, expect } = require('@playwright/test');

async function openApp(page, options = {}) {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
  });
  await page.emulateMedia({ colorScheme: options.colorScheme || 'light' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  await page.waitForTimeout(250);
}

test.describe('desktop workbench contract', () => {
  test('only fine-pointer desktop exposes the three-column shell', async ({ browser }) => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktop.newPage();
    await openApp(desktopPage);
    const desktopState = await desktopPage.evaluate(() => ({
      sidebar: getComputedStyle(document.getElementById('desktopWorkbenchSidebar')).display,
      columns: getComputedStyle(document.querySelector('.app-container')).gridTemplateColumns,
      rightRail: getComputedStyle(document.querySelector('.desktop-right-rail')).display,
      mode: document.documentElement.getAttribute('data-theme-mode')
    }));
    expect(desktopState.sidebar).toBe('flex');
    expect(desktopState.columns.split(/\s+/).length).toBe(2);
    expect(desktopState.rightRail).toBe('flex');
    expect(desktopState.mode).toBe('system');
    await desktop.close();

    const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const tabletPage = await tablet.newPage();
    await openApp(tabletPage);
    const tabletState = await tabletPage.evaluate(() => ({
      sidebar: getComputedStyle(document.getElementById('desktopWorkbenchSidebar')).display,
      matches: matchMedia('(min-width: 1280px) and (hover: hover) and (pointer: fine)').matches
    }));
    expect(tabletState.sidebar).toBe('none');
    expect(tabletState.matches).toBeFalsy();
    await tablet.close();
  });

  test('desktop theme selector persists and keeps the header toggle synchronized', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.selectOption('#desktopThemeMode', 'dark');
    await expect.poll(() => page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      mode: document.documentElement.getAttribute('data-theme-mode'),
      stored: localStorage.getItem('xtj_theme'),
      selected: document.getElementById('desktopThemeMode').value,
      pressed: document.getElementById('themeToggle').getAttribute('aria-pressed')
    }))).toEqual({ theme: 'dark', mode: 'dark', stored: 'dark', selected: 'dark', pressed: 'true' });
  });

  test('desktop navigation reuses the existing panels and highlights the active page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    for (const tab of ['chat', 'ai', 'profile', 'posts']) {
      await page.locator(`.desktop-nav-item[data-desktop-tab="${tab}"]`).click();
      await expect.poll(() => page.evaluate(() => ({
        activePanel: document.querySelector('.dock-panel.active')?.id,
        activeNav: document.querySelector('.desktop-nav-item.is-active')?.dataset.desktopTab
      }))).toEqual({ activePanel: `panel${tab[0].toUpperCase()}${tab.slice(1)}`, activeNav: tab });
    }
  });

  test('desktop chat keeps the conversation surface usable at required widths', async ({ browser }) => {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await openApp(page);
      await page.locator('.desktop-nav-item[data-desktop-tab="chat"]').click();
      await expect(page.locator('#dockChatListView')).toBeVisible();
      await expect(page.locator('#dockChatDetailView')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await context.close();
    }
  });

  test('desktop recent contacts mirror real chat rows without inventing data', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(() => {
      window.currentUser = 'owner';
      window.__openedContact = '';
      window.openChat = (name) => { window.__openedContact = name; };
      const list = document.getElementById('dockChatList');
      list.replaceChildren();
      const row = document.createElement('div');
      row.className = 'chat-list-item';
      row.dataset.chatUser = 'real-contact';
      row.innerHTML = '<span class="cli-avatar">R</span><span class="cli-preview">最近消息</span><span class="cli-badge">2</span>';
      list.appendChild(row);
    });
    await expect(page.locator('.desktop-contact-preview')).toHaveCount(1);
    await expect(page.locator('.desktop-contact-preview__name')).toHaveText('real-contact');
    await expect(page.locator('.desktop-contact-preview__badge')).toHaveText('2');
    await page.locator('.desktop-contact-preview').click();
    await expect.poll(() => page.evaluate(() => window.__openedContact)).toBe('real-contact');
  });

  test('desktop chat inspector reflects the active real conversation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(() => {
      window.dockChatActiveUser = 'active-contact';
      document.getElementById('dockChatTitle').textContent = 'active-contact';
    });
    await expect(page.locator('#desktopChatInspector')).toBeVisible();
    await expect(page.locator('.desktop-chat-inspector__name')).toHaveText('active-contact');
    await expect(page.locator('.desktop-chat-inspector__status')).toHaveText('当前私聊对象');
  });
});
