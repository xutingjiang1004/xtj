const { test, expect } = require('@playwright/test');

async function mainState(page) {
  return page.evaluate(() => {
    const dock = document.getElementById('dockBar') || document.querySelector('.dock-bar');
    return {
      dockInlineDisplay: dock ? dock.style.display : null,
      dockVisible: dock ? getComputedStyle(dock).display !== 'none' : false,
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction,
      secondaryClass: document.body.classList.contains('secondary-page-open'),    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.XTJSecondaryPageState && window.restoreMainNavigationState);
});

test('default startup restores dock and main page interaction', async ({ page }) => {
  const state = await mainState(page);
  expect(state.dockVisible).toBeTruthy();
  expect(state.bodyOverflow).not.toBe('hidden');
  expect(state.touchAction).not.toBe('none');
});


test('legacy hidden dock and locked touch state are repaired on restore', async ({ page }) => {
  await page.evaluate(() => {
    const dock = document.getElementById('dockBar') || document.querySelector('.dock-bar');
    dock.style.display = 'none';
    document.body.style.touchAction = 'none';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    
    document.getElementById('panelDeepThink').classList.add('hidden');
    document.getElementById('panelDeepThink').classList.remove('active');
    window.restoreMainNavigationState();
  });
  const state = await mainState(page);
  expect(state.dockInlineDisplay).toBe('');
  expect(state.bodyOverflow).toBe('');
  expect(state.touchAction).toBe('');
});

test('multiple secondary pages do not unlock until all visible panels close', async ({ page }) => {
  await page.evaluate(async () => {
    const deep = document.getElementById('panelDeepThink');
    deep.classList.remove('hidden');
    deep.classList.add('active');
    window.XTJSecondaryPageState.open('deep-think');
  });
  let state = await mainState(page);
  expect(state.bodyOverflow).toBe('hidden');
  expect(state.touchAction).toBe('none');

  await page.evaluate(() => {
    const deep = document.getElementById('panelDeepThink');
    deep.classList.add('hidden');
    deep.classList.remove('active');
    window.XTJSecondaryPageState.close('deep-think');
    window.restoreMainNavigationState();
  });
  state = await mainState(page);
  expect(state.dockVisible).toBeTruthy();
  expect(state.bodyOverflow).toBe('');
});

test('pageshow restores stale Safari/iPad bfcache state', async ({ page }) => {
  await page.evaluate(() => {
    const dock = document.getElementById('dockBar') || document.querySelector('.dock-bar');
    dock.style.display = 'none';
    document.body.style.touchAction = 'none';
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.waitForTimeout(20);
  const state = await mainState(page);
  expect(state.dockInlineDisplay).toBe('');
  expect(state.touchAction).toBe('');
});
