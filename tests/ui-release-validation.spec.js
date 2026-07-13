const { test, expect } = require('@playwright/test');

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const VIEWPORTS = [
  { name: 'phone-390x844', width: 390, height: 844, hasTouch: true, isMobile: true },
  { name: 'phone-393x852', width: 393, height: 852, hasTouch: true, isMobile: true },
  { name: 'phone-414x896', width: 414, height: 896, hasTouch: true, isMobile: true },
  { name: 'phone-430x932', width: 430, height: 932, hasTouch: true, isMobile: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, hasTouch: true },
  { name: 'tablet-820x1180', width: 820, height: 1180, hasTouch: true },
  { name: 'tablet-834x1194', width: 834, height: 1194, hasTouch: true },
  { name: 'tablet-1024x768', width: 1024, height: 768, hasTouch: true },
  { name: 'tablet-1180x820', width: 1180, height: 820, hasTouch: true },
  { name: 'tablet-1194x834', width: 1194, height: 834, hasTouch: true },
  { name: 'desktop-1280x800', width: 1280, height: 800 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 }
];

const NON_DOCK_TABS = ['posts', 'chat', 'ai', 'profile'];

async function gotoApp(page, options = {}) {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
  });
  await page.emulateMedia({
    colorScheme: options.colorScheme || 'light',
    reducedMotion: options.reducedMotion || 'no-preference'
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  await page.waitForTimeout(350);
}

async function switchTab(page, tab) {
  await page.evaluate((nextTab) => {
    if (typeof window.switchDockTab === 'function') {
      window.switchDockTab(nextTab, true);
    }
  }, tab);
  await page.waitForTimeout(220);
}

async function collectViewportOverflowState(page) {
  return page.evaluate(() => ({
    activePanel: document.querySelector('.dock-panel.active') && document.querySelector('.dock-panel.active').id,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
}

async function assertNoOverflowAcrossMatrix(browser, mediaOptions, label) {
  const failures = [];
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: !!viewport.hasTouch,
      isMobile: !!viewport.isMobile
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await gotoApp(page, mediaOptions);
    for (const tab of NON_DOCK_TABS) {
      await switchTab(page, tab);
      const state = await collectViewportOverflowState(page);
      if (state.scrollWidth > state.innerWidth + 1) {
        failures.push(`${label}:${viewport.name}:${tab}:${state.scrollWidth}>${state.innerWidth}`);
      }
    }
    if (pageErrors.length) {
      failures.push(`${label}:${viewport.name}:pageerror:${pageErrors[0]}`);
    }
    await context.close();
  }
  expect(failures, failures.join('\n')).toEqual([]);
}

test.describe('release validation', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('all target viewports stay overflow-safe in light mode', async ({ browser }) => {
    await assertNoOverflowAcrossMatrix(browser, { colorScheme: 'light', reducedMotion: 'no-preference' }, 'light');
  });

  test('all target viewports stay overflow-safe in dark mode', async ({ browser }) => {
    await assertNoOverflowAcrossMatrix(browser, { colorScheme: 'dark', reducedMotion: 'no-preference' }, 'dark');
  });

  test('all target viewports stay overflow-safe in reduced motion mode', async ({ browser }) => {
    await assertNoOverflowAcrossMatrix(browser, { colorScheme: 'light', reducedMotion: 'reduce' }, 'reduce');
  });

  test('desktop fine-pointer chat keeps a visible dual-pane empty state', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await gotoApp(page);
    await switchTab(page, 'chat');
    const state = await page.evaluate(() => {
      const container = document.getElementById('dockChatContainer');
      const listView = document.getElementById('dockChatListView');
      const detailView = document.getElementById('dockChatDetailView');
      const backBtn = document.getElementById('dockChatBackBtn');
      const messages = document.getElementById('dockChatMessages');
      return {
        containerDisplay: getComputedStyle(container).display,
        gridTemplateColumns: getComputedStyle(container).gridTemplateColumns,
        listDisplay: getComputedStyle(listView).display,
        detailDisplay: getComputedStyle(detailView).display,
        backDisplay: getComputedStyle(backBtn).display,
        detailText: (messages.textContent || '').replace(/\s+/g, ' ').trim()
      };
    });
    expect(state.containerDisplay).toBe('grid');
    expect(state.gridTemplateColumns.startsWith('340px')).toBeTruthy();
    expect(state.listDisplay).not.toBe('none');
    expect(state.detailDisplay).not.toBe('none');
    expect(state.backDisplay).toBe('none');
    expect(/选择一条会话开始聊天|登录后可查看消息/.test(state.detailText)).toBeTruthy();
    await context.close();
  });

  test('touch tablets keep chat in a single-pane layout', async ({ browser }) => {
    const cases = [
      { width: 1024, height: 768 },
      { width: 1180, height: 820 },
      { width: 1194, height: 834 }
    ];
    for (const viewport of cases) {
      const context = await browser.newContext({ viewport, hasTouch: true });
      const page = await context.newPage();
      await gotoApp(page);
      await switchTab(page, 'chat');
      const state = await page.evaluate(() => {
        const container = document.getElementById('dockChatContainer');
        const listView = document.getElementById('dockChatListView');
        const detailView = document.getElementById('dockChatDetailView');
        return {
          display: getComputedStyle(container).display,
          listDisplay: getComputedStyle(listView).display,
          detailDisplay: getComputedStyle(detailView).display
        };
      });
      expect(state.display).toBe('block');
      expect(state.listDisplay).not.toBe('none');
      expect(state.detailDisplay).toBe('none');
      await context.close();
    }
  });

  test('coarse-pointer preview and chat controls meet the 44px touch target floor', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await gotoApp(page);
    await page.evaluate((src) => {
      window.openPhotoPreview(0, [{ imageUrl: src, username: 'u', timestamp: Date.now() }]);
    }, PNG_DATA_URL);
    await page.waitForTimeout(450);
    const previewButtons = await page.evaluate(() => {
      const selectors = [
        '.photo-preview-close',
        '#ppPrevBtn',
        '#ppNextBtn',
        '#ppZoomOutBtn',
        '#ppZoomInBtn',
        '#ppInfoBtn',
        '#ppShareBtn',
        '#ppRotateBtn',
        '#ppDeleteBtn'
      ];
      return selectors.map((selector) => {
        const el = document.querySelector(selector);
        const rect = el.getBoundingClientRect();
        return { selector, width: rect.width, height: rect.height };
      });
    });
    previewButtons.forEach((entry) => {
      expect(entry.width, entry.selector).toBeGreaterThanOrEqual(44);
      expect(entry.height, entry.selector).toBeGreaterThanOrEqual(44);
    });
    await page.evaluate(() => {
      const detail = document.getElementById('dockChatDetailView');
      const list = document.getElementById('dockChatListView');
      const back = document.getElementById('dockChatBackBtn');
      if (detail) detail.classList.remove('hidden');
      if (list) list.classList.add('hidden');
      if (back) back.style.display = 'flex';
    });
    const chatButtons = await page.evaluate(() => {
      const selectors = ['#dockChatBackBtn', '#dockChatImgBtn', '#dockChatSendBtn'];
      return selectors.map((selector) => {
        const el = document.querySelector(selector);
        const rect = el.getBoundingClientRect();
        return { selector, width: rect.width, height: rect.height };
      });
    });
    chatButtons.forEach((entry) => {
      expect(entry.width, entry.selector).toBeGreaterThanOrEqual(44);
      expect(entry.height, entry.selector).toBeGreaterThanOrEqual(44);
    });
    await context.close();
  });

  test('post tools retain 44px targets and the profile becomes a two-column layout on desktop', async ({ browser }) => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const mobilePage = await mobile.newPage();
    await gotoApp(mobilePage);
    const mobileState = await mobilePage.evaluate(() => {
      document.getElementById('announcement-btn-wrapper').style.display = 'block';
      document.getElementById('report-btn-wrapper').style.display = 'block';
      return ['#announcementBtn', '#reportBtn'].map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, width: rect.width, height: rect.height, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
    });
    mobileState.forEach((entry) => {
      expect(entry.width, entry.selector).toBeGreaterThanOrEqual(44);
      expect(entry.height, entry.selector).toBeGreaterThanOrEqual(44);
      expect(entry.overflow, entry.selector).toBeFalsy();
    });
    const mobileLayout = await mobilePage.evaluate(() => {
      const nav = document.querySelector('#panelPosts .posts-nav');
      const children = Array.from(nav.children);
      const cards = Array.from(document.querySelectorAll('#panelPosts .stats .stat-card'));
      return {
        announcementIndex: children.indexOf(document.getElementById('announcement-btn-wrapper')),
        reportIndex: children.indexOf(document.getElementById('report-btn-wrapper')),
        authIndex: children.indexOf(nav.querySelector('.nav-auth')),
        statsGap: parseFloat(getComputedStyle(document.querySelector('#panelPosts .stats')).columnGap),
        statRadii: cards.map((card) => parseFloat(getComputedStyle(card).borderRadius))
      };
    });
    expect(mobileLayout.announcementIndex).toBeLessThan(mobileLayout.reportIndex);
    expect(mobileLayout.reportIndex).toBeLessThan(mobileLayout.authIndex);
    expect(mobileLayout.statsGap).toBeGreaterThanOrEqual(7);
    mobileLayout.statRadii.forEach((radius) => expect(radius).toBeGreaterThanOrEqual(16));
    await mobile.close();

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktop.newPage();
    await gotoApp(desktopPage);
    await switchTab(desktopPage, 'profile');
    const columns = await desktopPage.evaluate(() => getComputedStyle(document.getElementById('profileMainView')).gridTemplateColumns);
    expect(columns.trim().split(/\s+/).length).toBe(2);
    const profileSafety = await desktopPage.evaluate(() => {
      const container = document.querySelector('#panelProfile .dock-profile-container');
      const dock = document.getElementById('dockBar').getBoundingClientRect();
      const last = document.getElementById('profileTotalsBar').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        paddingBottom: parseFloat(getComputedStyle(container).paddingBottom),
        dockHeight: dock.height,
        lastBottom: last.bottom,
        viewportHeight: innerHeight
      };
    });
    expect(profileSafety.overflow).toBeFalsy();
    expect(profileSafety.paddingBottom).toBeGreaterThan(profileSafety.dockHeight);
    await desktop.close();
  });

  test('chromium page scale factor 1.25 stays overflow-safe on representative widths', async ({ browser }) => {
    const cases = [
      { width: 390, height: 844, hasTouch: true, isMobile: true },
      { width: 1024, height: 768, hasTouch: true },
      { width: 1280, height: 800 }
    ];
    const failures = [];
    for (const viewport of cases) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: !!viewport.hasTouch,
        isMobile: !!viewport.isMobile
      });
      const page = await context.newPage();
      await gotoApp(page);
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.25 });
      await page.waitForTimeout(200);
      for (const tab of NON_DOCK_TABS) {
        await switchTab(page, tab);
        const state = await collectViewportOverflowState(page);
        const scale = await page.evaluate(() => window.visualViewport && window.visualViewport.scale);
        if (Math.abs((scale || 0) - 1.25) > 0.01) {
          failures.push(`scale-miss:${viewport.width}x${viewport.height}:${scale}`);
        }
        if (state.scrollWidth > state.innerWidth + 1) {
          failures.push(`overflow:${viewport.width}x${viewport.height}:${tab}:${state.scrollWidth}>${state.innerWidth}`);
        }
      }
      await context.close();
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
