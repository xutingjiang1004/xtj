const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('[PAGEERROR] ' + e));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push('[CONSOLE:' + m.type() + '] ' + m.text());
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('has #dockBar:', !!(await page.$('#dockBar')));

  await page.click('#dockBar .dock-tab[data-tab="ai-chat"]');
  await page.waitForTimeout(1200);

  const panel = await page.$('#panelAiChat');
  console.log('panelAiChat exists:', !!panel);
  if (panel) console.log('panelAiChat classes:', await panel.getAttribute('class'));
  const root = await page.$('#aiChatRoot');
  console.log('aiChatRoot exists:', !!root);
  if (root) console.log('aiChatRoot classes:', await root.getAttribute('class'));

  const info = await page.evaluate(() => ({
    fromDock: typeof window.__xtjOpenAiChatFromDock,
    open: typeof window.__xtjOpenAiChat,
    aiActive: typeof window.__xtjAiChatActive,
  }));
  console.log('globals:', JSON.stringify(info));

  await page.screenshot({ path: '/tmp/ai_nav_mobile.png' });
  console.log('--- console/page errors ---');
  for (const e of errors) console.log(e);
  await browser.close();
})();