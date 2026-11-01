'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
test('tapping 小猫AI shows the page shell at once even when the AI module is slow', { timeout: 60000 }, async () => {
  const s = await h.open({ viewport: { width: 1280, height: 900 }, mobile: false, settleMs: 1500,
    beforeGoto: async (page) => { await page.route(/ai-agent(\.min)?\.js/, async (route) => { await new Promise(r => setTimeout(r, 9000)); route.continue(); }); } });
  try {
    const p = s.page;
    await p.evaluate(() => document.querySelector('[data-desktop-action="ai-chat"]').click());
    await p.waitForTimeout(500);
    const shell = await p.evaluate(() => { const a = document.getElementById('panelAiChat'); const r = a.getBoundingClientRect(); return { active: a.classList.contains('active'), w: Math.round(r.width), text: a.textContent, strayFixedBack: !!a.querySelector('button[style*="position:fixed"]') }; });
    assert.equal(shell.active, true); assert.ok(shell.w > 600);
    assert.match(shell.text, /小猫AI/); assert.match(shell.text, /有什么想聊的/); assert.match(shell.text, /问点什么/);
    assert.equal(shell.strayFixedBack, false, 'the back button lives in the title bar, not floating over the sidebar');
    assert.ok(await p.locator('#panelAiChat .ai-chat-skeleton-back').count() === 1, 'there is still a way back while the module loads');
  } finally { await s.close(); }
});
test('the AI module is warmed when the page is idle, before anyone taps', { timeout: 60000 }, async () => {
  const s = await h.open({ viewport: { width: 390, height: 844 }, settleMs: 14000 });
  try { assert.equal(await s.page.evaluate(() => !!window.__xtjAiAgent), true); } finally { await s.close(); }
});
