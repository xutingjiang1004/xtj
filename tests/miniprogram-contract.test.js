// 小程序端结构契约测试（2026-09-22）
//
// 为什么需要：miniprogram/ 不在 npm run build 的链路里（build.js 用显式文件清单），
// 改动不会经过任何构建校验，结构错误只会在微信开发者工具里才暴露。
// 这里把「结构完整性 + 事件绑定 + data 字段 + 语法」锁进 npm test。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

const mpFiles = walk(MP);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

test('合约：本测试已接入 npm test（否则 CI 不会执行）', () => {
  const pkg = JSON.parse(readRaw('package.json'));
  assert.ok(
    String(pkg.scripts.test || '').indexOf('miniprogram-contract') >= 0,
    '本测试文件必须登记在 package.json 的 scripts.test 中'
  );
});

test('合约：project.config.json 指向 miniprogram/ 且 appid 未丢失', () => {
  const pc = JSON.parse(readRaw('project.config.json'));
  // 没有 miniprogramRoot 时开发者工具会去仓库根目录找 app.json，报「模拟器启动失败」
  assert.strictEqual(pc.miniprogramRoot, 'miniprogram/', 'miniprogramRoot 必须指向 miniprogram/');
  assert.strictEqual(pc.compileType, 'miniprogram');
  assert.match(String(pc.appid || ''), /^wx[0-9a-f]{16}$/, 'appid 必须是合法的 wx 开头 16 位十六进制');
});

test('合约：app.json 声明的每个页面，四个必需文件都在', () => {
  const app = JSON.parse(readRaw('miniprogram/app.json'));
  assert.ok(Array.isArray(app.pages) && app.pages.length > 0, 'app.json 必须有 pages');
  for (const page of app.pages) {
    for (const ext of ['.wxml', '.js', '.json']) {
      assert.ok(
        fs.existsSync(path.join(MP, page + ext)),
        `缺少页面文件 miniprogram/${page}${ext}`
      );
    }
  }
  if (app.sitemapLocation) {
    assert.ok(fs.existsSync(path.join(MP, app.sitemapLocation)), 'sitemapLocation 指向的文件不存在');
  }
});

test('合约：miniprogram/ 下所有 json 合法、所有 js 语法通过', () => {
  for (const f of mpFiles) {
    if (f.endsWith('.json')) {
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, 'utf8')), rel(f) + ' 不是合法 JSON');
    }
    if (f.endsWith('.js')) {
      assert.doesNotThrow(
        () => cp.execSync('node --check "' + f + '"', { stdio: 'pipe' }),
        rel(f) + ' 语法错误'
      );
    }
  }
});

test('合约：wxml 的事件绑定在同名 js 里都有处理函数', () => {
  const wxmls = mpFiles.filter((f) => f.endsWith('.wxml'));
  assert.ok(wxmls.length > 0, '找不到任何 wxml');
  for (const w of wxmls) {
    const js = w.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(js)) continue;
    const src = fs.readFileSync(w, 'utf8');
    const code = fs.readFileSync(js, 'utf8');
    const re = /\b(?:bind|catch):?([a-zA-Z]+)\s*=\s*"([^"]+)"/g;
    let m;
    const missing = [];
    while ((m = re.exec(src))) {
      const fn = m[2];
      if (!new RegExp('\\b' + fn + '\\s*[(:]').test(code)) missing.push(m[1] + '->' + fn);
    }
    assert.deepStrictEqual(missing, [], rel(w) + ' 绑定了同名 js 中不存在的方法: ' + missing.join(', '));
  }
});

test('合约：wxml 里 {{}} 引用的字段都在 data 中声明', () => {
  for (const w of mpFiles.filter((f) => f.endsWith('.wxml'))) {
    const js = w.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(js)) continue;
    const src = fs.readFileSync(w, 'utf8');
    const code = fs.readFileSync(js, 'utf8');
    const dm = code.match(/data\s*:\s*\{([\s\S]*?)\n\s{2}\}/);
    const declared = dm ? [...dm[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((x) => x[1]) : [];
    const used = [...new Set([...src.matchAll(/\{\{\s*([A-Za-z_$][\w$]*)/g)].map((x) => x[1]))];
    const undef = used.filter((u) => declared.indexOf(u) < 0);
    assert.deepStrictEqual(undef, [], rel(w) + ' 用到但 data 未声明: ' + undef.join(', '));
  }
});

test('合约：首页 <web-view> 必须独占页面（微信硬性要求）', () => {
  const idx = readRaw('miniprogram/pages/index/index.wxml');
  assert.ok(idx.indexOf('<web-view') >= 0, '首页必须有 <web-view>');
  assert.doesNotMatch(idx, /<view[\s>]/, 'web-view 页面不能混排其他 <view> 组件');
  assert.doesNotMatch(idx, /<button[\s>]/, 'web-view 页面不能混排其他 <button> 组件');
});

test('合约：小程序环境适配标记仍在网页侧生效', () => {
  // 网页侧靠 UA 里的 miniProgram 加 .xtj-miniprogram：顶部空白与底部 Dock 位错位的修复依赖它
  assert.ok(
    readRaw('index.html').indexOf("classList.add('xtj-miniprogram')") >= 0,
    'index.html 必须在小程序 UA 下给 <html> 加 .xtj-miniprogram'
  );
  const shell = readRaw('css/ui-shell.css');
  assert.ok(shell.indexOf('html.xtj-miniprogram') >= 0, 'ui-shell.css 必须有 .xtj-miniprogram 适配规则');
  assert.ok(
    readRaw('js/core-parts/06-chat-and-nav.js').indexOf("if (/miniProgram/i.test(navigator.userAgent)) viewportBottom = 0;") >= 0,
    'core-parts 必须在小程序环境下把 --xtj-visual-bottom 归零'
  );
  assert.ok(
    readRaw('js/core.js').indexOf("if (/miniProgram/i.test(navigator.userAgent)) viewportBottom = 0;") >= 0,
    'js/core.js 需由 scripts/assemble-core.js 重新生成（改完 core-parts 必须重跑）'
  );
});
