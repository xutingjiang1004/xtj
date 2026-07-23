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
  test('every viewport from 768px exposes the desktop workbench', async ({ browser }) => {
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

    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 834, height: 1194 },
      { width: 1024, height: 768 },
      { width: 1194, height: 834 }
    ]) {
      const tablet = await browser.newContext({ viewport, hasTouch: true });
      const tabletPage = await tablet.newPage();
      await openApp(tabletPage);
      const tabletState = await tabletPage.evaluate(() => ({
        sidebar: getComputedStyle(document.getElementById('desktopWorkbenchSidebar')).display,
        dock: getComputedStyle(document.getElementById('dockBar')).display,
        matches: matchMedia('(min-width: 768px)').matches,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(tabletState.sidebar).toBe('flex');
      expect(tabletState.dock).toBe('none');
      expect(tabletState.matches).toBeTruthy();
      expect(tabletState.scrollWidth).toBeLessThanOrEqual(viewport.width);
      await tablet.close();
    }
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

  test('desktop AI stays inside the workbench content beside the sidebar', async ({ browser }) => {
    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 }
    ]) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1280 });
      const page = await context.newPage();
      await openApp(page);
      await page.waitForFunction(() => typeof window.__xtjOpenAiChat === 'function');
      await page.evaluate(() => {
        window.__xtjOpenAiChat = () => {
          const panel = document.getElementById('panelAiChat');
          panel.classList.remove('hidden');
          panel.classList.add('active');
          panel.setAttribute('aria-hidden', 'false');
          panel.innerHTML = '<div id="aiChatRoot"></div>';
          window.__xtjAiChatActive = true;
        };
        window.__xtjCloseAiChat = () => {
          const panel = document.getElementById('panelAiChat');
          panel.classList.add('hidden');
          panel.classList.remove('active');
          panel.setAttribute('aria-hidden', 'true');
          window.__xtjAiChatActive = false;
        };
      });
      const urlBefore = page.url();
      await page.evaluate(() => window.__xtjOpenAiChat());
      await expect(page.locator('#panelAiChat #aiChatRoot')).toBeVisible();
      const state = await page.evaluate(() => {
        const sidebar = document.getElementById('desktopWorkbenchSidebar');
        const panel = document.getElementById('panelAiChat');
        const button = document.querySelector('.desktop-nav-item[data-desktop-action="ai-chat"]');
        const sidebarRect = sidebar.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return {
          sidebarDisplay: getComputedStyle(sidebar).display,
          panelLeft: panelRect.left,
          panelRight: panelRect.right,
          sidebarRight: sidebarRect.right,
          active: button.classList.contains('is-active'),
          current: button.getAttribute('aria-current'),
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      });
      expect(state.sidebarDisplay).toBe('flex');
      expect(state.panelLeft).toBeGreaterThanOrEqual(state.sidebarRight - 1);
      expect(state.panelRight).toBeLessThanOrEqual(viewport.width + 1);
      expect(state.active).toBeTruthy();
      expect(state.current).toBe('page');
      expect(state.overflow).toBeFalsy();
      expect(page.url()).toBe(urlBefore);
      expect(context.pages()).toHaveLength(1);

      await page.locator('.desktop-nav-item[data-desktop-tab="posts"]').click();
      await expect(page.locator('#panelAiChat')).toBeHidden();
      await expect(page.locator('.desktop-nav-item[data-desktop-tab="posts"]')).toHaveClass(/is-active/);
      await context.close();
    }
  });

  test('desktop AI icon uses the complete six-petal asset', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openApp(page);
    const icon = page.locator('.desktop-nav-icon--ai');
    await expect(icon.locator('ellipse')).toHaveCount(6);
    await expect(icon.locator('circle')).toHaveCount(1);
    expect(await icon.locator('svg').getAttribute('viewBox')).toBe('-2 -2 28 28');
  });

  test('desktop chat keeps the conversation surface usable at required widths', async ({ browser }) => {
    for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1194, height: 834 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1280 });
      const page = await context.newPage();
      await openApp(page);
      await page.locator('.desktop-nav-item[data-desktop-tab="chat"]').click();
      await expect(page.locator('#dockChatListView')).toBeVisible();
      await expect(page.locator('#dockChatDetailView')).toBeVisible();
      await expect(page.locator('#dockBar')).toBeHidden();
      await expect(page.locator('#desktopChatInspector')).toHaveCount(0);
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

  test('mobile keeps the existing Dock navigation', async ({ browser }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 767, height: 1024 }]) {
      const context = await browser.newContext({ viewport, hasTouch: true });
      const page = await context.newPage();
      await openApp(page);
      await expect(page.locator('#dockBar')).toBeVisible();
      await expect(page.locator('#desktopWorkbenchSidebar')).toBeHidden();
      await context.close();
    }
  });

  test('desktop account avatar follows asynchronous source avatar updates', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openApp(page);
    await page.evaluate(() => {
      window.currentUser = 'xxz';
      document.getElementById('myName').textContent = 'xxz';
      document.getElementById('myAvatar').innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="头像">';
    });
    await expect(page.locator('#desktopWorkbenchAvatar img')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => ({
      source: document.querySelector('#myAvatar img')?.getAttribute('src'),
      target: document.querySelector('#desktopWorkbenchAvatar img')?.getAttribute('src'),
      name: document.getElementById('desktopWorkbenchName').textContent
    }))).toEqual({
      source: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      target: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      name: 'xxz'
    });

    await page.evaluate(() => {
      document.getElementById('myAvatar').textContent = 'X';
    });
    await expect(page.locator('#desktopWorkbenchAvatar')).toHaveText('X');
    await expect(page.locator('#desktopWorkbenchAvatar img')).toHaveCount(0);
  });
});
