const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sharedSecurityHeaders = require('../render-api/security-headers.js');

const CSP_VIOLATION_RE = /Refused to (load|execute|apply inline|apply)|Content Security Policy|violates the following Content Security Policy|strict-dynamic/;

async function gotoApp(page) {
  const cspViolations = [];
  const pageErrors = [];
  const failedRequests = [];
  const apiRequests = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' && CSP_VIOLATION_RE.test(text)) {
      cspViolations.push(text);
    }
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });
  page.on('requestfailed', req => {
    failedRequests.push(req.url() + ' (' + (req.failure()?.errorText || 'unknown') + ')');
  });
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/') && !url.includes('/api/health')) {
      apiRequests.push(url);
    }
  });

  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
  });

  const response = await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  expect(response, 'Homepage response must exist').not.toBeNull();
  expect(response.status(), 'Homepage must return 200').toBe(200);
  expect(response.ok(), 'Homepage response must be successful').toBeTruthy();

  return { cspViolations, pageErrors, failedRequests, apiRequests, response };
}

test.describe('CSP Regression (PR #366 production outage)', () => {

  test('CSP header does not contain strict-dynamic', async ({ request }) => {
    const resp = await request.get('/');
    const csp = resp.headers()['content-security-policy'] || '';
    expect(csp, 'CSP header must exist').toBeTruthy();
    expect(csp, "CSP must NOT contain 'strict-dynamic' without nonces").not.toContain("'strict-dynamic'");
    expect(csp).toContain("script-src");
    expect(csp).toContain("'self'");
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("https://cdn.jsdelivr.net");
  });

  test('vercel.json CSP must not contain strict-dynamic and must match shared policy', async () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
    const cspHeader = vercel.headers.find(h => h.headers.some(x => x.key === 'Content-Security-Policy'));
    expect(cspHeader, 'vercel.json must define a Content-Security-Policy').toBeTruthy();
    const csp = cspHeader.headers.find(x => x.key === 'Content-Security-Policy').value;
    expect(csp, "vercel.json CSP must NOT contain 'strict-dynamic'").not.toContain("'strict-dynamic'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toBe(sharedSecurityHeaders.CSP);
  });

  test('CSP header includes style-src with jsDelivr', async ({ request }) => {
    const resp = await request.get('/');
    const csp = resp.headers()['content-security-policy'] || '';
    const styleMatch = csp.match(/style-src\s+([^;]+)/);
    expect(styleMatch, 'style-src directive must exist').toBeTruthy();
    expect(styleMatch[1]).toContain("'self'");
    expect(styleMatch[1]).toContain("'unsafe-inline'");
    expect(styleMatch[1]).toContain("https://cdn.jsdelivr.net");
  });

  test('inline theme bootstrap script executes on page load', async ({ page }) => {
    const { cspViolations, pageErrors } = await gotoApp(page);

    await page.waitForFunction(
      () => window.__xtjThemeControllerV2 === true,
      { timeout: 5000 }
    );

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(['dark', 'light']).toContain(theme);

    for (const v of cspViolations) {
      expect(v, 'No CSP violations allowed').toBe('');
    }
  });

  test('inline fallback function definitions are available', async ({ page }) => {
    await gotoApp(page);

    const hasFns = await page.evaluate(() => {
      return typeof window.openAuthModal === 'function'
          && typeof window.openReportModal === 'function'
          && typeof window.doLogout === 'function';
    });
    expect(hasFns, 'Inline fallback functions must be defined').toBe(true);
  });

  test('core.min.js loads and defines switchDockTab', async ({ page }) => {
    await gotoApp(page);

    await page.waitForFunction(
      () => typeof window.switchDockTab === 'function',
      { timeout: 10000 }
    );

    const coreLoaded = await page.evaluate(() => {
      return typeof window.switchDockTab === 'function';
    });
    expect(coreLoaded, 'core.min.js must have loaded and defined switchDockTab').toBe(true);
  });

  test('Supabase CDN script loads successfully', async ({ page }) => {
    const { failedRequests } = await gotoApp(page);

    await page.waitForFunction(
      () => window.supabase !== undefined,
      { timeout: 10000 }
    );

    const supabaseLoaded = await page.evaluate(() => typeof window.supabase);
    expect(supabaseLoaded).toBe('object');

    const supabaseFailed = failedRequests.some(u => u.includes('cdn.jsdelivr.net') && u.includes('supabase'));
    expect(supabaseFailed, 'Supabase CDN script must not fail to load').toBe(false);
  });

  test('navigation buttons (posts/chat/ai/profile) respond to clicks', async ({ page }) => {
    await gotoApp(page);

    await page.waitForFunction(() => typeof window.switchDockTab === 'function', { timeout: 10000 });
    await page.waitForTimeout(300);

    const tabs = ['chat', 'ai', 'profile', 'posts'];
    for (const tab of tabs) {
      // Desktop uses the persistent sidebar; coarse-pointer/mobile keeps the
      // original bottom Dock. Test the active navigation surface at either
      // breakpoint instead of requiring the hidden mobile Dock on desktop.
      const btn = page.locator(
        `.desktop-nav-item[data-desktop-tab="${tab}"]:visible, .dock-tab[data-tab="${tab}"]:visible`
      ).first();
      await expect(btn, `${tab} tab button must exist`).toBeVisible({ timeout: 5000 });
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(250);

      const panelActive = await page.evaluate((t) => {
        const panel = document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1));
        return panel && panel.classList.contains('active');
      }, tab);
      expect(panelActive, `Panel ${tab} must become active after clicking its tab`).toBe(true);
    }
  });

  test('homepage data API requests are actually dispatched', async ({ page }) => {
    const { apiRequests } = await gotoApp(page);

    await page.waitForFunction(() => typeof window.switchDockTab === 'function', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const dataApis = apiRequests.filter(u =>
      u.includes('/api/feed') || u.includes('/api/photos/public') || u.includes('/api/stats/snapshot')
    );

    expect(dataApis.length, 'At least one data API request must be made (posts/photos/stats)').toBeGreaterThan(0);
  });

  test('no CSP violation errors or blocked script resources', async ({ page }) => {
    const { cspViolations, pageErrors, failedRequests } = await gotoApp(page);

    await page.waitForFunction(() => typeof window.switchDockTab === 'function', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const blockedScripts = failedRequests.filter(u =>
      (u.endsWith('.js') || u.includes('.js')) &&
      !u.includes('favicon') &&
      (u.includes('Refused') || u.includes('ERR_BLOCKED') || u.includes('blocked'))
    );

    expect(cspViolations, 'No CSP violation console errors').toEqual([]);
    expect(blockedScripts, 'No JS resources blocked by CSP').toEqual([]);

    const criticalErrors = pageErrors.filter(e =>
      !/AbortError|ERR_ABORTED|Loading chunk|Loading CSS chunk|NetworkError/i.test(e)
    );
    expect(criticalErrors, 'No unexpected page errors that indicate script loading failure').toEqual([]);
  });

});
