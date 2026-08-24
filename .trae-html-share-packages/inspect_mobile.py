from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        device_scale_factor=1,
    )
    page = ctx.new_page()
    page.on("console", lambda m: print("CONSOLE:", m.type, m.text))
    page.on("pageerror", lambda e: print("PAGEERROR:", e))
    page.goto("http://localhost:8090/index.html", wait_until="networkidle")
    page.wait_for_timeout(1500)

    info = page.evaluate("""() => {
      return {
        hasOpenAiChat: typeof window.__xtjOpenAiChat,
        hasOpenAiChatFromDock: typeof window.__xtjOpenAiChatFromDock,
        hasCloseAiChat: typeof window.__xtjCloseAiChat,
        hasSwitchDockTab: typeof window.switchDockTab,
        hasXtjOpenAiChatActive: !!window.__xtjAiChatActive,
        hasCurrentUser: !!window.currentUser,
        dockTabs: Array.from(document.querySelectorAll('.dock-tab')).map(t => t.dataset.tab),
        dockBar: document.querySelector('#dockBar').getBoundingClientRect().toJSON(),
      };
    }""")
    print("INFO:", info)

    page.click('.dock-tab[data-tab="ai-chat"]')
    page.wait_for_timeout(800)
    after = page.evaluate("""() => {
      const panel = document.getElementById('panelAiChat');
      const bar = document.querySelector('#dockBar').getBoundingClientRect();
      const btn = document.querySelector('.dock-tab[data-tab="ai-chat"]').getBoundingClientRect();
      const cx = btn.left + btn.width/2, cy = btn.top + btn.height/2;
      const topAtBtn = document.elementFromPoint(cx, cy);
      return {
        panelClass: panel.className,
        panelActive: panel.classList.contains('active'),
        panelHidden: panel.classList.contains('hidden'),
        panelInnerLen: panel.innerHTML.length,
        aiChatActive: !!window.__xtjAiChatActive,
        currentDockTab: (window.currentDockTab),
        barRect: {left: bar.left, top: bar.top, width: bar.width, height: bar.height},
        btnRect: {left: btn.left, top: btn.top, width: btn.width, height: btn.height},
        topAtBtnTag: topAtBtn ? (topAtBtn.tagName + '.' + topAtBtn.className) : null,
        bodyClass: document.body.className,
      };
    }""")
    print("AFTER_CLICK:", after)
    print("BODY_OVERFLOW:", page.evaluate("document.body.style.overflow"))
    browser.close()