#!/usr/bin/env node
'use strict';
// Measures how smooth an interaction is, so "make the animation smoother" starts from numbers instead of impressions.
// Records requestAnimationFrame gaps, long tasks (>50 ms), layout shifts and which CSS transitions/animations ran.
//
//   const { open } = require('./harness');
//   const { measure, format } = require('./probe-motion');
//   const s = await open({});
//   const m = await measure(s.page, async () => { await s.page.locator('.dock-tab:visible').nth(2).click(); await s.page.waitForTimeout(900); }, { throttle: 4 });
//   console.log(format('photo wall tab', m));
//
//   node scripts/maintenance/probe-motion.js [--throttle 2] [--viewport 390x844]     cycles the bottom tabs twice
//
// Headless Chromium renders in software, so absolute numbers are worse than on a phone. Compare the same interaction before
// and after a change (same throttle, same viewport) and report both; never present the absolute numbers as phone performance.

async function measure(page, action, { throttle = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(() => {
    const m = window.__motion = { gaps: [], longTasks: [], shift: 0, anims: new Set(), last: 0, on: true };
    const describe = (el) => (el && el.tagName ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '') : '?');
    const tick = (t) => { if (!m.on) return; if (m.last) m.gaps.push(t - m.last); m.last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => m.longTasks.push(e.duration))).observe({ type: 'longtask' }); } catch (_) { /* unsupported */ }
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) m.shift += e.value; })).observe({ type: 'layout-shift' }); } catch (_) { /* unsupported */ }
    document.addEventListener('transitionstart', (e) => m.anims.add('transition ' + e.propertyName + ' on ' + describe(e.target)), true);
    document.addEventListener('animationstart', (e) => m.anims.add('animation ' + e.animationName + ' on ' + describe(e.target)), true);
  });
  const t0 = Date.now();
  try { await action(); } finally { await page.waitForTimeout(120); }
  const raw = await page.evaluate(() => {
    const m = window.__motion; m.on = false;
    return { gaps: m.gaps, longTasks: m.longTasks, shift: m.shift, anims: [...m.anims].slice(0, 14) };
  });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach().catch(() => {});
  const gaps = raw.gaps.slice().sort((a, b) => a - b);
  const pick = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] : 0);
  return {
    ms: Date.now() - t0, throttle, frames: gaps.length, medianFrameMs: +pick(0.5).toFixed(1), p95FrameMs: +pick(0.95).toFixed(1), worstFrameMs: +(gaps[gaps.length - 1] || 0).toFixed(1),
    droppedFrames: raw.gaps.filter((g) => g > 33.4).length, longTasks: raw.longTasks.length, worstLongTaskMs: +Math.max(0, ...raw.longTasks).toFixed(0),
    layoutShift: +raw.shift.toFixed(4), animations: raw.anims,
  };
}

function format(label, m) {
  return `${label}: ${m.frames} frames, median ${m.medianFrameMs} ms, p95 ${m.p95FrameMs} ms, worst ${m.worstFrameMs} ms, dropped(>33ms) ${m.droppedFrames}, long tasks ${m.longTasks} (worst ${m.worstLongTaskMs} ms), layout shift ${m.layoutShift}, cpu x${m.throttle}` +
    (m.animations.length ? `\n    ran: ${m.animations.join('; ')}` : '');
}

module.exports = { measure, format };

if (require.main === module) {
  const { open } = require('./harness');
  const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
  const throttle = Number(arg('throttle', 2));
  const [w, h] = String(arg('viewport', '390x844')).split('x').map(Number);
  (async () => {
    const s = await open({ viewport: { width: w, height: h }, mobile: w < 700 });
    const tabs = await s.page.locator('.dock-tab:visible, .desktop-nav-item:visible').all();
    for (let round = 1; round <= 2; round++) {
      for (const [i, tab] of tabs.slice(0, 5).entries()) {
        const m = await measure(s.page, async () => { await tab.click({ timeout: 3000 }).catch(() => {}); await s.page.waitForTimeout(900); }, { throttle });
        console.log(format(`round ${round} tab ${i}`, m));
      }
    }
    await s.close();
  })().catch((e) => { console.error(e); process.exit(2); });
}
