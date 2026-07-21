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
  if (options.userName) {
    await page.addInitScript((userName) => {
      try { localStorage.setItem('xtj_user', userName); } catch (_) {}
    }, options.userName);
  }
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

  test('desktop chat remains dual-pane at every required desktop viewport', async ({ browser }) => {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await gotoApp(page);
      await page.locator('.dock-tab[data-tab="chat"]').click();
      await expect(page.locator('#dockChatListView')).toBeVisible();
      await expect(page.locator('#dockChatDetailView')).toBeVisible();
      expect(await page.locator('#dockChatContainer').evaluate(el => getComputedStyle(el).display)).toBe('grid');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
      await context.close();
    }
  });

  test('fine and coarse pointers expose the intended hover capability without sticky coarse hover', async ({ browser }) => {
    const fine = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const finePage = await fine.newPage();
    await gotoApp(finePage);
    await switchTab(finePage, 'profile');
    expect(await finePage.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBeTruthy();
    const fineCard = finePage.locator('.profile-user-card');
    await fineCard.hover();
    await finePage.waitForTimeout(250);
    expect(await fineCard.evaluate(el => el.matches(':hover'))).toBeTruthy();
    await fine.close();

    const coarse = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const coarsePage = await coarse.newPage();
    await gotoApp(coarsePage);
    await switchTab(coarsePage, 'profile');
    expect(await coarsePage.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBeFalsy();
    const coarseCard = coarsePage.locator('.profile-user-card');
    const coarseBefore = await coarseCard.evaluate(el => getComputedStyle(el).transform);
    await coarseCard.dispatchEvent('mouseenter');
    await coarsePage.waitForTimeout(250);
    expect(await coarseCard.evaluate(el => getComputedStyle(el).transform)).toBe(coarseBefore);
    await coarse.close();
  });

  test('reduced motion disables representative non-Dock infinite and transition animations in computed styles', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await gotoApp(page, { reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'motionAuditFixture';
      fixture.innerHTML = '<div class="pro-style-preview-card"><span class="theme-preview"></span></div><div class="pro-celebration-overlay"><div class="pro-celebration-card"></div></div>';
      document.body.appendChild(fixture);
    });
    const styles = await page.locator('#motionAuditFixture *').evaluateAll(nodes => nodes.map(el => {
      const style = getComputedStyle(el);
      return { className: el.className, animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration, willChange: style.willChange };
    }));
    for (const style of styles) {
      expect(style.animationName, style.className).toBe('none');
      expect(parseFloat(style.animationDuration), style.className).toBeLessThanOrEqual(0.001);
      expect(parseFloat(style.transitionDuration), style.className).toBeLessThanOrEqual(0.001);
      expect(['auto', '']).toContain(style.willChange);
    }
    await context.close();
  });

  test('auth modal has an accessible name and receives focus without browser errors', async ({ page }) => {
    const pageErrors = [];
    await page.addInitScript(() => {
      window.__unhandledRejections = [];
      addEventListener('unhandledrejection', event => window.__unhandledRejections.push(String(event.reason && event.reason.message || event.reason)));
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    await gotoApp(page);
    await page.locator('#unauthUI .btn-primary').click();
    const dialog = page.locator('#loginModal [role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'loginModalTitle');
    await expect(page.locator('#loginNickInp')).toBeFocused();
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.__unhandledRejections)).toEqual([]);
  });

  test('pinning follows the posts panel and animates the rebuilt pinned card into place', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [], comments: [], likes: [], next_offset: null })
    }));
    await gotoApp(page, { userName: 'pin-tester' });
    await page.waitForTimeout(500);
    const sourceId = await page.evaluate(async () => {
      const now = Date.now();
      const posts = Array.from({ length: 7 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        user_name: 'pin-tester',
        content: `置顶动画测试 ${index} ` + '内容 '.repeat(180),
        created_at: new Date(now - index * 1000).toISOString(),
        visibility: 'public',
        is_pinned: false,
        pinned_at: null,
        views: index
      }));
      window.ensureProtectedOperationAuth = async () => ({ ok: true });
      window.xtjProtectedFetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        const source = posts.find((post) => post.id === body.post_id);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: { ...source, is_pinned: true, pinned_at: new Date().toISOString() } })
        };
      };
      for (const post of posts) await window.xtjPrependPostToFeed(post);
      const source = posts[posts.length - 1];
      const panel = document.getElementById('panelPosts');
      panel.scrollTop = panel.scrollHeight;
      const button = document.querySelector(`.post[data-post-id="${source.id}"] .action-btn.pin`);
      window.__pinTransitionPromise = window.togglePostPin(source.id, button);
      return source.id;
    });
    await page.evaluate(() => window.__pinTransitionPromise);
    const arrivalState = await page.evaluate((postId) => {
      const panel = document.getElementById('panelPosts');
      const post = document.querySelector(`.post[data-post-id="${postId}"]`);
      const nav = panel.querySelector('.posts-nav');
      const panelRect = panel.getBoundingClientRect();
      const postRect = post.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      return {
        firstPost: document.querySelector('#feed .post') && document.querySelector('#feed .post').getAttribute('data-post-id'),
        animationCleaned: !post.classList.contains('post-pin-arriving'),
        postTop: postRect.top,
        safeTop: Math.max(panelRect.top, navRect.bottom)
      };
    }, sourceId);
    expect(arrivalState.firstPost).toBe(sourceId);
    expect(arrivalState.animationCleaned).toBeTruthy();
    expect(arrivalState.postTop).toBeGreaterThanOrEqual(arrivalState.safeTop - 2);
    await context.close();
  });

  test('thirty real Dock clicks do not leak page errors, unhandled rejections, or horizontal overflow', async ({ page }) => {
    const pageErrors = [];
    await page.addInitScript(() => {
      window.__unhandledRejections = [];
      addEventListener('unhandledrejection', event => window.__unhandledRejections.push(String(event.reason && event.reason.message || event.reason)));
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    await gotoApp(page);
    const order = ['posts', 'chat', 'ai', 'profile'];
    for (let index = 0; index < 30; index += 1) {
      await page.locator(`.dock-tab[data-tab="${order[index % order.length]}"]`).click();
    }
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.__unhandledRejections)).toEqual([]);
  });
});
