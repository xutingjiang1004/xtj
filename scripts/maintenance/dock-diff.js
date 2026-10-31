#!/usr/bin/env node
'use strict';
// Guard check 2: every computed style of the bottom navigation bar (Dock) must be identical between main (baseline
// server, :4174) and the working tree (:4173), in three configurations. Exit code 1 on any difference.
//   scripts/maintenance/baseline.sh && scripts/maintenance/serve.sh && node scripts/maintenance/dock-diff.js
//   node scripts/maintenance/dock-diff.js [baselineOrigin] [newOrigin]
const { open } = require('./harness');

const BASE = process.argv[2] || 'http://127.0.0.1:4174';
const NEW = process.argv[3] || 'http://127.0.0.1:4173';
// XTJ_GUARD_SELFTEST=1 injects a deliberate style change on the new side: the run must then report differences and exit 1.
const SELFTEST = process.env.XTJ_GUARD_SELFTEST === '1';
const inject = () => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.dock-tab{opacity:.8}'; document.head.appendChild(st); });
const SELECTORS = ['.dock-bar', '.dock-bar > .dock-indicator', '.dock-tab', '.dock-tab .dt-icon', '.dock-tab .dt-label', '.dock-tab.active'];

async function dump(origin, theme, viewport, mobile) {
  const s = await open({ origin, theme, viewport, mobile, dsf: 1, fixedTime: true, init: SELFTEST && origin === NEW ? inject : undefined });
  try {
    return await s.page.evaluate((sels) => {
      const result = {};
      for (const sel of sels) {
        result[sel] = Array.from(document.querySelectorAll(sel)).slice(0, 6).map((el) => {
          const c = getComputedStyle(el);
          const o = {};
          for (let i = 0; i < c.length; i++) o[c[i]] = c.getPropertyValue(c[i]);
          const r = el.getBoundingClientRect();
          o.__rect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
          o.__htmlLength = el.innerHTML.length;
          return o;
        });
      }
      return result;
    }, SELECTORS);
  } finally { await s.close(); }
}

(async () => {
  let compared = 0, differences = 0;
  const configs = [['light', { width: 390, height: 844 }, true], ['dark', { width: 390, height: 844 }, true], ['light', { width: 1280, height: 800 }, false]];
  for (const [theme, viewport, mobile] of configs) {
    const a = await dump(BASE, theme, viewport, mobile);
    const b = await dump(NEW, theme, viewport, mobile);
    for (const sel of Object.keys(a)) {
      if (a[sel].length !== b[sel].length) { differences += 1; console.log('COUNT', theme, viewport.width, sel, a[sel].length, '->', b[sel].length); continue; }
      a[sel].forEach((oa, i) => {
        for (const k of Object.keys(oa)) {
          compared += 1;
          if (oa[k] !== b[sel][i][k]) { differences += 1; console.log('DIFF', theme, viewport.width, sel, i, k, '|', String(oa[k]).slice(0, 60), '=>', String(b[sel][i][k]).slice(0, 60)); }
        }
      });
    }
  }
  console.log(`Dock: ${compared} computed properties compared, ${differences} differences`);
  process.exit(differences ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
