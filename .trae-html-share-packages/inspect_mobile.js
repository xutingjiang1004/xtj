const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/puppeteer/chrome/linux-151.0.7922.71/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
  });
  const page = await ctx.newPage();
  page.on('console', m => console.log('CONSOLE:', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8090/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const btn = document.querySelector('.dock-tab[data-tab="ai-chat"]');
    const bar = document.querySelector('#dockBar');
    const br = bar.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      hasOpenAiChat: typeof window.__xtjOpenAiChat,
      hasOpenAiChatFromDock: typeof window.__xtjOpenAiChatFromDock,
      hasCloseAiChat: typeof window.__xtjCloseAiChat,
      hasSwitchDockTab: typeof window.switchDockTab,
      aiChatActive: !!window.__xtjAiChatActive,
      hasCurrentUser: !!window.currentUser,
      dockTabs: Array.from(document.querySelectorAll('.dock-tab')).map(t => t.dataset.tab),
      barRect: { l: br.left, t: br.top, w: br.width, h: br.height },
      btnRect: { l: r.left, t: r.top, w: r.width, h: r.height },
      topAtBtn: top ? (top.tagName + '.' + String(top.className)) : null,
      panelVisible: document.getElementById('panelAiChat') ? document.getElementById('panelAiChat').className : 'NO_PANEL',
    };
  });
  console.log('INFO:', JSON.stringify(info, null, 2));

  await page.click('.dock-tab[data-tab="ai-chat"]');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const panel = document.getElementById('panelAiChat');
    const pulse = document.querySelector('.ai-chat-root');
    return {
      panelClass: panel.className,
      panelActive: panel.classList.contains('active'),
      panelHidden: panel.classList.contains('hidden'),
      panelInnerLen: panel.innerHTML.length,
      aiChatActive: !!window.__xtjAiChatActive,
      currentDockTab: window.currentDockTab,
      rootDock: pulse ? pulse.className : null,
      bodyClass: document.body.className,
      bodyOverflow: document.body.style.overflow,
      aiBackBtn: !!panel.querySelector('.ai-chat-back'),
    };
  });
  console.log('AFTER_CLICK:', JSON.stringify(after, null, 2));
  await page.screenshot({ path: '/workspace/.trae-html-share-packages/mobile_after.png', fullPage: true });
  await browser.close();
})();