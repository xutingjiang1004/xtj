// probe-empirical.js
// 对照实验：在完整页面上下文中逐个"禁用"脚本，找出导致主线程卡死的脚本。
// 方法：page.route 拦截所有请求，命中要禁用的子串 -> abort；允许 xtj.onrender.com 与 supabase；
//       其余一律 abort（阻断外部资源）。每个用例独立开浏览器，整体 25s 硬超时，
//       每测完一个用例强制终结浏览器进程，防止一个卡死用例拖死整个脚本。
// 运行: node scripts/probe-empirical.js
const { chromium } = require('playwright');

const TARGET = 'https://xtj.onrender.com/';
const ALLOW_PREFIXES = ['https://xtj.onrender.com', 'https://ithowxqignlhkwaykglt.supabase.co'];

const NAV_TIMEOUT = 15000;   // goto domcontentloaded
const SETTLE_MS = 1200;      // 加载后等待
const EVAL_TIMEOUT = 1500;   // readyState 探测
const CASE_HARD_TIMEOUT = 25000; // 每个用例整体硬超时
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY || 3);
const MAX_PHASE2_CASES = 24; // phase2 用例数上限

// ---- 单个禁用的脚本列表（按可疑度粗排，实际上按实验输出定论） ----
const SINGLE_BLOCKS = [
  'js/ai-core/stream-renderer.min.js',
  'js/ai-core/markdown-renderer.min.js',
  'js/ai-core/scroll-controller.min.js',
  'js/ai-core/transport.min.js',
  'js/ai-core/request-controller.min.js',
  'js/vendor/supabase.min.js',
  'js/config.min.js',
  'js/performance.min.js',
  'js/core-utils.min.js',
  'js/core.min.js',
  'js/login-device.min.js',
  'js/theme-toggle.min.js',
  'js/desktop-shell.min.js',
  'js/ux-features.min.js',
  'js/early-feed.min.js',
];

function shortName(sub) {
  return sub.split('/').pop();
}

// 保证浏览器进程被终结：先 close（限时 3s），再进程级 kill 兜底
async function hardClose(browser) {
  if (!browser) return;
  try {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((r) => { const t = setTimeout(r, 3000); t.unref(); }),
    ]);
  } catch (e) {}
  try {
    const p = browser.process();
    if (p && p.pid) {
      try { process.kill(p.pid, 'SIGKILL'); } catch (e) {}
    }
  } catch (e) {}
}

// 跑一个用例。blockList: 数组，命中任一子串即 abort。
function runCase(blockList, label) {
  return new Promise((resolve) => {
    let browser = null;
    let settled = false;
    const result = { label, navOk: false, alive: false, ready: null, navErr: '', caseErr: '', hardTimeout: false };

    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };

    const hardTimer = setTimeout(() => {
      result.hardTimeout = true;
      finish(result);
      hardClose(browser); // 不 await，兜底杀掉
    }, CASE_HARD_TIMEOUT);
    hardTimer.unref();

    (async () => {
      try {
        browser = await chromium.launch({ ignoreHTTPSErrors: true });
        const page = await browser.newPage();
        await page.route('**/*', (route) => {
          const u = route.request().url();
          if (blockList.some((b) => b && u.includes(b))) return route.abort();
          if (ALLOW_PREFIXES.some((p) => u.startsWith(p))) return route.continue();
          return route.abort();
        });
        try {
          await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
          result.navOk = true;
        } catch (e) {
          result.navErr = String(e.message || e).replace(/[\r\n]+/g, ' ').slice(0, 80);
        }
        if (settled) return;
        await page.waitForTimeout(SETTLE_MS);
        if (settled) return;
        try {
          result.ready = await page.evaluate(() => document.readyState, { timeout: EVAL_TIMEOUT });
          result.alive = true;
        } catch (e) {}
      } catch (e) {
        result.caseErr = String(e.message || e).replace(/[\r\n]+/g, ' ').slice(0, 80);
      } finally {
        clearTimeout(hardTimer);
        if (!settled) {
          settled = true;
          await hardClose(browser);
          resolve(result);
        } else {
          // 已被硬超时结算，进程交由上面的 hardClose 兜底
          hardClose(browser);
        }
      }
    })();
  });
}

function fmt(r) {
  const nav = r.navOk ? 'NAV-OK' : 'NAV-BAD';
  const alive = r.alive ? 'ALIVE' : 'HUNG';
  let line = 'block=' + r.label + ' -> ' + nav + ' ' + alive;
  if (r.alive && r.ready) line += ' ready=' + r.ready;
  if (!r.navOk && r.navErr) line += ' (' + r.navErr + ')';
  if (r.hardTimeout) line += ' [HARD-TIMEOUT]';
  if (r.caseErr) line += ' [caseErr:' + r.caseErr + ']';
  return line;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function runBatch(cases) {
  const results = await mapLimit(cases, CONCURRENCY, (c) => runCase(c.blocks, c.label));
  for (const r of results) console.log(fmt(r));
  return results;
}

(async () => {
  const t0 = Date.now();
  console.log('== phase 1: 单个禁用 + 对照 ==');
  const phase1Cases = [
    ...SINGLE_BLOCKS.map((b) => ({ label: shortName(b), blocks: [b] })),
    { label: 'NONE(control)', blocks: [] },
    { label: 'NONE(control-2)', blocks: [] }, // 对照跑两次确认复现
  ];
  const phase1 = await runBatch(phase1Cases);

  const control = phase1.filter((r) => r.label.startsWith('NONE(control'));
  const controlHung = control.every((r) => !r.alive && !r.navOk);
  console.log('control 复现: ' + (controlHung ? 'HUNG(符合预期)' : '未复现！注意环境可能变化'));

  const aliveBlocks = phase1.filter((r) => r.alive).map((r) => r.label);
  const navOkBlocks = phase1.filter((r) => r.navOk).map((r) => r.label);

  console.log('\n== phase 1 汇总 ==');
  console.log('单禁用即 ALIVE(恢复): ' + (aliveBlocks.length ? aliveBlocks.join(', ') : '无'));
  console.log('单禁用 NAV-OK(DCL 恢复但主线程仍可能卡): ' + (navOkBlocks.length ? navOkBlocks.join(', ') : '无'));

  // ---- phase 2: 组合补测，确认最小卡死集合 ----
  // 若单禁用即恢复，说明卡死需要"多个脚本同时在场"。为确认最小集合，
  // 仍然补测关键组合：两个恢复脚本一起禁用（应为 ALIVE）、恢复脚本 + 非恢复脚本（应 HUNG）。
  let minimalSet = null;
  if (!controlHung) {
    console.log('\n== phase 2: 跳过（对照未复现卡死，组合测试无意义） ==');
  } else if (aliveBlocks.length > 0) {
    console.log('\n== phase 2: 单禁用已恢复，补测组合确认最小卡死集合 ==');
    const aliveSubs = aliveBlocks.map((n) => SINGLE_BLOCKS.find((b) => shortName(b) === n)).filter(Boolean);
    const comboCases = [
      // 两个恢复脚本一起禁用 -> 应 ALIVE（验证二者即最小集合）
      { label: 'combo(core+ux)', blocks: aliveSubs },
      // 恢复脚本 + 明确不在场也能恢复的无关脚本 -> 应仍 ALIVE
      { label: 'combo(core+stream-renderer)', blocks: ['js/core.min.js', 'js/ai-core/stream-renderer.min.js'] },
      { label: 'combo(ux+stream-renderer)', blocks: ['js/ux-features.min.js', 'js/ai-core/stream-renderer.min.js'] },
      // 全部恢复脚本 + 一个无关脚本 -> 应 ALIVE
      { label: 'combo(all-winners+stream-renderer)', blocks: [...aliveSubs, 'js/ai-core/stream-renderer.min.js'] },
      // 重复验证：单个恢复脚本再次单测（稳定性）
      { label: 'REPEAT-core.min.js', blocks: ['js/core.min.js'] },
      { label: 'REPEAT-ux-features.min.js', blocks: ['js/ux-features.min.js'] },
      { label: 'REPEAT-NONE(control-3)', blocks: [] },
    ];
    const comboResults = await runBatch(comboCases);
    const comboAlive = comboResults.filter((r) => r.alive).map((r) => r.label);
    const comboHung = comboResults.filter((r) => !r.alive).map((r) => r.label);
    console.log('组合中 ALIVE: ' + (comboAlive.length ? comboAlive.join(', ') : '无'));
    console.log('组合中 HUNG:  ' + (comboHung.length ? comboHung.join(', ') : '无'));
    // 最小卡死集合 = 同时在场必然卡死的脚本组合：这里即两个恢复脚本
    if (aliveSubs.length >= 2) {
      const pair = aliveSubs.map(shortName);
      const pairCase = comboResults.find((r) => r.label === 'combo(core+ux)');
      if (pairCase && pairCase.alive) minimalSet = pair; // 同时禁用二者恢复 -> 二者即最小卡死集合
    } else if (aliveSubs.length === 1) {
      minimalSet = aliveSubs.map(shortName);
    }
  } else if (navOkBlocks.length === 0) {
    console.log('\n== phase 2: 没有任何单禁用能恢复 DCL，尝试两两组合（取最多 24 个用例） ==');
    // 两两组合太多了，先测最可疑的几个（core 相关 + 全部 ai-core）并集/两两
    const suspects = SINGLE_BLOCKS.map(shortName);
    const combos = [];
    // core + 每个其他脚本
    for (const s of suspects) {
      if (s !== 'core.min.js') combos.push({ label: 'core.min.js+' + s, blocks: ['js/core.min.js', SINGLE_BLOCKS.find((b) => shortName(b) === s)] });
    }
    // 全部 ai-core 并集
    const aiCore = SINGLE_BLOCKS.filter((b) => b.includes('ai-core/'));
    combos.push({ label: 'all-ai-core', blocks: aiCore });
    const results = await runBatch(combos.slice(0, MAX_PHASE2_CASES));
    const found = results.filter((r) => r.alive);
    if (found.length) {
      const best = found[0];
      minimalSet = best.label.split('+');
      console.log('组合恢复最小候选: ' + best.label);
    }
  } else {
    // 有 NAV-OK 的集合（如禁用 core 后 DCL 恢复但主线程仍卡）→ 贪心求最小集合
    console.log('\n== phase 2: 在 NAV-OK 集合基础上扩展/缩减，求最小卡死集合 ==');
    const baseNames = navOkBlocks; // 已恢复 DCL 的单脚本
    const baseBlocks = baseNames.map((n) => SINGLE_BLOCKS.find((b) => shortName(b) === n)).filter(Boolean);

    let used = 0;
    let curBlocks = [...baseBlocks];
    let curLabel = baseNames.join('+');

    // 1) 先测全部 NAV-OK 脚本同时禁用
    let rAll = await runCase(curBlocks, 'union(' + curLabel + ')');
    console.log(fmt(rAll));
    used++;

    // 显式补测用户提示的 core+stream-renderer（若 stream-renderer 不在集合内）
    if (!curBlocks.some((b) => b.includes('stream-renderer')) && curBlocks.some((b) => b.includes('core.min.js'))) {
      const combo = ['js/core.min.js', 'js/ai-core/stream-renderer.min.js'];
      const rCombo = await runCase(combo, 'core.min.js+stream-renderer.min.js');
      console.log(fmt(rCombo));
      used++;
      if (rCombo.alive && !rAll.alive) {
        curBlocks = combo;
        curLabel = 'core.min.js+stream-renderer.min.js';
        rAll = rCombo;
      }
    }

    if (!rAll.alive) {
      // 需要额外禁用的脚本：逐个加，找到第一个能恢复的
      const rest = SINGLE_BLOCKS.filter((b) => !curBlocks.includes(b));
      for (const b of rest) {
        if (used >= MAX_PHASE2_CASES) break;
        const nb = [...curBlocks, b];
        const rb = await runCase(nb, curLabel + '+' + shortName(b));
        console.log(fmt(rb));
        used++;
        if (rb.alive) {
          curBlocks = nb;
          curLabel = curBlocks.map(shortName).join('+');
          rAll = rb;
          break;
        }
      }
    }

    // 2) 贪心缩减：逐个尝试从集合中移除，若仍 ALIVE 则保留移除
    if (rAll.alive) {
      let i = 0;
      while (i < curBlocks.length) {
        if (used >= MAX_PHASE2_CASES) break;
        const candidate = curBlocks.filter((_, j) => j !== i);
        if (candidate.length === 0) break;
        const rc = await runCase(candidate, 'minus(' + curLabel + ' - ' + shortName(curBlocks[i]) + ')');
        console.log(fmt(rc));
        used++;
        if (rc.alive) {
          curBlocks = candidate;
          curLabel = curBlocks.map(shortName).join('+');
          // 不递增 i：移除后同一位置是新元素
        } else {
          i++;
        }
      }
      // 最后复测一次确认
      const rFinal = await runCase(curBlocks, 'final(' + curLabel + ')');
      console.log(fmt(rFinal));
      used++;
      if (rFinal.alive) minimalSet = curBlocks.map(shortName);
    }
  }

  console.log('\n== 最终结论 ==');
  if (aliveBlocks.length > 0) {
    console.log('单禁用即恢复 ALIVE 的脚本（恢复即元凶，按可疑度）: ' + aliveBlocks.join(', '));
  }
  if (minimalSet) {
    console.log('最小卡死集合（这些脚本同时在场即卡死，全部禁用后页面恢复）: ' + minimalSet.join(' + '));
  } else if (controlHung && aliveBlocks.length === 0) {
    console.log('未找到可恢复组合（受 phase2 用例数上限限制）');
  }

  // 按可疑度排序输出全部结果
  console.log('\n== 全部结果（按可疑度排序） ==');
  const score = (r) => (r.alive ? 3 : r.navOk ? 2 : 1);
  const all = [...phase1];
  const ranked = all.sort((a, b) => score(b) - score(a));
  for (const r of ranked) console.log(fmt(r));
  console.log('elapsed ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
