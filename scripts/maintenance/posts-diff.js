#!/usr/bin/env node
'use strict';
// Guard check 3: the posts page must look the same. Compares every computed style of every element in #panelPosts between
// main (baseline server, :4174) and the working tree (:4173), in three configurations, with the page clock frozen so that
// relative times ("8 分钟前") cannot differ between runs. Exit code 1 when any element differs.
//   node scripts/maintenance/posts-diff.js [baselineOrigin] [newOrigin]
// A listed difference is not automatically wrong: a bug fix may legitimately change a computed style (for example an
// overflow rule). Report each one in the PR description with the reason; never leave one unexplained.
const { open } = require('./harness');

const BASE = process.argv[2] || 'http://127.0.0.1:4174';
const NEW = process.argv[3] || 'http://127.0.0.1:4173';
// XTJ_GUARD_SELFTEST=1 injects a deliberate style change on the new side: the run must then report differences and exit 1.
const SELFTEST = process.env.XTJ_GUARD_SELFTEST === '1';
const inject = () => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#panelPosts *{letter-spacing:.4px}'; document.head.appendChild(st); });
const SKIP = new Set(['transition-property', 'transition-duration', 'transition-delay', 'transition-timing-function']);

async function dump(origin, theme, viewport, mobile) {
  const s = await open({ origin, theme, viewport, mobile, dsf: 1, fixedTime: true, settleMs: 5000, init: SELFTEST && origin === NEW ? inject : undefined });
  try {
    return await s.page.evaluate(() => {
      const root = document.getElementById('panelPosts') || document.body;
      const rows = [];
      const walk = (el, key) => {
        const c = getComputedStyle(el);
        const style = {};
        for (let i = 0; i < c.length; i++) style[c[i]] = c.getPropertyValue(c[i]);
        const r = el.getBoundingClientRect();
        style.__rect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
        rows.push({ key, sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), style });
        Array.from(el.children).forEach((k, i) => walk(k, key + '/' + i));
      };
      walk(root, 'root');
      return rows;
    });
  } finally { await s.close(); }
}

(async () => {
  let totalDiffElements = 0;
  const configs = [['light', { width: 390, height: 844 }, true], ['dark', { width: 390, height: 844 }, true], ['light', { width: 1280, height: 800 }, false]];
  for (const [theme, viewport, mobile] of configs) {
    const a = await dump(BASE, theme, viewport, mobile);
    const b = await dump(NEW, theme, viewport, mobile);
    const byKey = new Map(b.map((e) => [e.key, e]));
    const bySel = {};
    let elements = 0, changed = 0;
    for (const ea of a) {
      const eb = byKey.get(ea.key);
      if (!eb) { (bySel[ea.sel] = bySel[ea.sel] || []).push('element missing on the new tree'); changed += 1; continue; }
      elements += 1;
      let differs = false;
      for (const k of Object.keys(ea.style)) {
        if (SKIP.has(k) || ea.style[k] === eb.style[k]) continue;
        differs = true;
        (bySel[ea.sel] = bySel[ea.sel] || []).push(`${k}: ${String(ea.style[k]).slice(0, 40)} -> ${String(eb.style[k]).slice(0, 40)}`);
      }
      if (differs) changed += 1;
    }
    totalDiffElements += changed;
    console.log(`== ${theme} ${viewport.width}px: ${elements} elements compared, ${changed} differ`);
    for (const [sel, list] of Object.entries(bySel).slice(0, 25)) console.log('  ' + sel + '  ' + list.slice(0, 4).join(' | '));
  }
  console.log(totalDiffElements ? `Posts page: ${totalDiffElements} differing elements in total` : 'Posts page: no differences');
  process.exit(totalDiffElements ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
