'use strict';
// G-L5 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/render.js 渲染一张卡片，从生成的 HTML 里抽出
// onkeydown 处理器执行它。
// 修复前：处理器调 (img||card).click()，图片加载失败时 img.onclick 已被
// 改成重试加载并 stopPropagation，键盘 Enter 会变成重试；修复后：
// 处理器直接调 this.click()（打开预览），与鼠标点卡片一致，图片重试
// 仍可鼠标点图本身触发。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const RENDER_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'render.js'), 'utf8');

function makeClassList() {
  const set = new Set();
  return {
    add(...c) { c.forEach(x => set.add(x)); },
    remove(...c) { c.forEach(x => set.delete(x)); },
    contains(c) { return set.has(c); },
    toggle(c, f) { if (f === undefined) f = !set.has(c); f ? set.add(c) : set.delete(c); return f; },
  };
}

class FakeImg {
  constructor(url) {
    this._attrs = { 'data-src': url };
    this._src = '';
    this.classList = makeClassList();
    this.classList.add('pw-blur-in');
    this.style = { setProperty() {} };
    this.isConnected = true;
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
    this.onclick = null;
    this.clicked = false;
  }
  get src() { return this._src; }
  set src(v) { this._src = String(v || ''); }
  click() { this.clicked = true; if (typeof this.onclick === 'function') this.onclick({ stopPropagation() {} }); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  closest() { return null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }; }
}

async function renderOneCard() {
  const img = new FakeImg('https://example.test/photo-0.jpg');
  let markup = '';
  const grid = {
    classList: { toggle() {}, add() {}, remove() {} },
    get innerHTML() { return markup; },
    set innerHTML(v) { markup = String(v || ''); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === 'img' || sel === '.pw-blur-in') return [img];
      return [];
    },
    appendChild(n) { return n; },
  };
  const timers = [];
  const window = {
    currentUser: 'owner',
    photoWallData: [{
      id: 'photo-0', timestamp: Date.UTC(2026, 9, 12), username: 'owner',
      imageUrl: 'https://example.test/photo-0.jpg', thumbUrl: 'https://example.test/photo-0.jpg',
    }],
    pwSortKey: 'date_desc',
    pwAlbumView: false,
    innerHeight: 800,
    addEventListener() {},
    hasMorePhotos() { return false; },
  };
  const document = {
    getElementById(id) { return id === 'photoGrid' ? grid : null; },
    createElement() { return { classList: makeClassList(), style: {}, setAttribute() {}, removeAttribute() {}, querySelector() { return null; } }; },
    addEventListener() {},
    querySelector() { return null; },
  };
  const sandbox = {
    window, document, console, Date, Map, Set, Promise,
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn, delay) { const id = timers.length + 1; timers.push({ id, fn, delay }); return id; },
    clearTimeout(id) { const t = timers.find(x => x.id === id); if (t) t.cancelled = true; },
    setInterval: () => 0, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(RENDER_SRC, sandbox, { filename: 'photo-wall-render.js' });
  await window.renderPhotoWall();
  const m = markup.match(/onkeydown="([^"]*)"/);
  assert.ok(m, '卡片 HTML 应带 onkeydown 处理器');
  return { code: m[1], img, timers };
}

function runKeydown(code, card, key) {
  const fn = new Function('event', code);
  fn.call(card, { key, preventDefault() {} });
}

test('G-L5: 图片加载失败时键盘 Enter 打开预览，而不是重试加载', async () => {
  const { code, img } = await renderOneCard();
  // 模拟图片加载失败：img.onclick 已被改成重试（与 pumpImages 的行为一致）。
  let retried = false;
  img.onclick = () => { retried = true; };
  const card = {
    clicked: false,
    click() { this.clicked = true; },
    querySelector(sel) { return sel === 'img' ? img : null; },
  };
  runKeydown(code, card, 'Enter');
  assert.equal(card.clicked, true, 'Enter 应点卡片本身（打开预览）');
  assert.equal(img.clicked, false, 'Enter 不应点图片');
  assert.equal(retried, false, 'Enter 不应触发图片重试');
});

test('G-L5: 空格键同样打开预览；非 Enter/空格键不触发', async () => {
  const { code, img } = await renderOneCard();
  img.onclick = () => { throw new Error('must not retry'); };
  const card = {
    clicked: false,
    click() { this.clicked = true; },
    querySelector(sel) { return sel === 'img' ? img : null; },
  };
  runKeydown(code, card, ' ');
  assert.equal(card.clicked, true, '空格应点卡片本身');
  card.clicked = false;
  runKeydown(code, card, 'Tab');
  assert.equal(card.clicked, false, 'Tab 不应触发');
});
