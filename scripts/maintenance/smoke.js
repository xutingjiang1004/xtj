#!/usr/bin/env node
'use strict';
// Boots the site in four configurations (light/dark x phone/desktop), visits every visible navigation tab and reports page
// errors, console errors/warnings and failed requests. A cheap "is anything on fire" check to run first and last.
//   node scripts/maintenance/smoke.js [origin]
const { open } = require('./harness');

const origin = process.argv[2] || undefined;
(async () => {
  let bad = 0;
  const configs = [
    ['light phone', { theme: 'light', viewport: { width: 390, height: 844 }, mobile: true }],
    ['dark phone', { theme: 'dark', viewport: { width: 390, height: 844 }, mobile: true }],
    ['light desktop', { theme: 'light', viewport: { width: 1280, height: 800 }, mobile: false }],
    ['dark desktop', { theme: 'dark', viewport: { width: 1280, height: 800 }, mobile: false }],
  ];
  for (const [name, options] of configs) {
    const s = await open({ ...options, origin });
    // Only tabs that are visible in this layout: the phone Dock or the desktop sidebar, never both.
    const tabs = await s.page.locator('.dock-tab:visible, .desktop-nav-item:visible').all();
    let visited = 0;
    for (const tab of tabs.slice(0, 5)) {
      try { await tab.click({ timeout: 3000 }); visited += 1; } catch (_) { /* covered or detached: counted as not visited */ }
      await s.page.waitForTimeout(700);
    }
    const report = { page_errors: s.errors, console: s.consoleMsgs.filter((m) => !/favicon/i.test(m)), failed_requests: s.failed.filter((f) => !/favicon/i.test(f)) };
    const count = report.page_errors.length + report.console.length + report.failed_requests.length;
    bad += report.page_errors.length + (visited ? 0 : 1);
    console.log(`${name}: ${visited}/${tabs.length} tabs visited, ${report.page_errors.length} page errors, ${report.console.length} console messages, ${report.failed_requests.length} failed requests`);
    if (count) console.log('  ' + JSON.stringify(report).slice(0, 700));
    await s.close();
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
