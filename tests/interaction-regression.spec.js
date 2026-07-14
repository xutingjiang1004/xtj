const { test, expect } = require('@playwright/test');

async function openApp(page, reducedMotion = 'no-preference') {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    window.__xtjUnhandledRejections = [];
    window.addEventListener('unhandledrejection', event => {
      window.__xtjUnhandledRejections.push(String(event.reason && event.reason.message || event.reason || 'unknown'));
    });
  });
  await page.emulateMedia({ reducedMotion });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  // Let startup hydration and lazy enhancement scheduling settle before timing
  // the user-driven panel transition itself.
  await page.waitForTimeout(500);
}

test.describe('interaction regression contracts', () => {
  test('thirty real Dock clicks settle on exactly one panel without a stale page', async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openApp(page);

    const sequence = Array.from({ length: 30 }, (_, index) =>
      ['posts', 'chat', 'ai', 'profile'][index % 4]
    );
    for (const tab of sequence) {
      await page.locator(`.dock-tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(260);
      const state = await page.evaluate((expectedTab) => {
        const activePanels = Array.from(document.querySelectorAll('.dock-panel.active'));
        const selectedTabs = Array.from(document.querySelectorAll('.dock-tab.active'));
        return {
          expectedPanelId: `panel${expectedTab.charAt(0).toUpperCase()}${expectedTab.slice(1)}`,
          activeIds: activePanels.map(panel => panel.id),
          transitioningIds: Array.from(document.querySelectorAll('.dock-panel.is-entering, .dock-panel.is-leaving')).map(panel => panel.id),
          panelStates: Array.from(document.querySelectorAll('.dock-panel')).map(panel => ({
            id: panel.id,
            className: panel.className,
            opacity: getComputedStyle(panel).opacity,
            pointerEvents: getComputedStyle(panel).pointerEvents,
            animationName: getComputedStyle(panel).animationName,
            animationDuration: getComputedStyle(panel).animationDuration,
            transitionDuration: getComputedStyle(panel).transitionDuration,
            inlineStyle: panel.getAttribute('style') || ''
          })),
          selectedTabs: selectedTabs.map(item => item.dataset.tab),
          overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
          unhandledRejections: (window.__xtjUnhandledRejections || []).slice()
        };
      }, tab);
      expect(state.activeIds).toEqual([state.expectedPanelId]);
      expect(state.transitioningIds, JSON.stringify(state.panelStates)).toEqual([]);
      expect(state.selectedTabs).toEqual([tab]);
      expect(state.overflowing).toBeFalsy();
      expect(state.unhandledRejections).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test('reduced motion switches immediately and leaves no outgoing panel', async ({ page }) => {
    await openApp(page, 'reduce');
    for (const tab of ['chat', 'ai', 'profile', 'posts']) {
      await page.locator(`.dock-tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(40);
      const state = await page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('.dock-panel'));
        return {
          active: panels.filter(panel => panel.classList.contains('active')).map(panel => panel.id),
          outgoing: panels.filter(panel => panel.classList.contains('outgoing') || panel.classList.contains('is-outgoing')).map(panel => panel.id),
          animated: panels.some(panel => {
            const style = getComputedStyle(panel);
            return style.animationName !== 'none' && parseFloat(style.animationDuration) > 0.01;
          })
        };
      });
      expect(state.active).toHaveLength(1);
      expect(state.outgoing).toEqual([]);
      expect(state.animated).toBeFalsy();
    }
  });
});

