'use strict';
// G-L3 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/render.js，模拟 490 张已渲染、再加载 20 张顶满 500 张
// DOM 上限的场景。
// 修复前：触顶后哨兵仍写通用的“加载更多…”，明确入口要等哨兵滚入视口、
// IO 回调触发后才出现，用户容易误以为墙到底了；修复后：触顶即写明
// “已达当前渲染上限，点击继续加载”并保留点击入口。
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
  }
  get src() { return this._src; }
  set src(v) { this._src = String(v || ''); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  closest() { return null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }; }
}

function photo(i) {
  return {
    id: 'photo-' + i, timestamp: Date.UTC(2026, 9, 12) - i * 1000, username: 'owner',
    imageUrl: 'https://example.test/photo-' + i + '.jpg',
    thumbUrl: 'https://example.test/photo-' + i + '.jpg',
  };
}

function createRuntime() {
  // 桩 DOM 只建模卡片数量：insertAdjacentHTML 按插入的卡片数累加。
  const state = { cardCount: 0, hasMore: true };
  const countCards = (html) => (String(html).match(/data-photo-id="/g) || []).length;
  const imgs = Array.from({ length: 490 }, (_, i) => new FakeImg('https://example.test/photo-' + i + '.jpg'));
  let markup = '';
  let sentinelNode = null;
  function makeSentinel() {
    const indicator = { textContent: '' };
    const node = {
      className: '',
      innerHTML: '',
      indicator,
      classList: makeClassList(),
      querySelector(sel) { return sel === '.pw-load-more-indicator' ? indicator : null; },
      setAttribute() {},
      removeAttribute() {},
      onclick: null,
      onkeydown: null,
      insertAdjacentHTML(pos, html) { state.cardCount += countCards(html); },
      remove() { sentinelNode = null; },
    };
    return node;
  }
  const grid = {
    classList: { toggle() {}, add() {}, remove() {} },
    get innerHTML() { return markup; },
    set innerHTML(v) {
      markup = String(v || '');
      state.cardCount = countCards(markup);
    },
    querySelector(sel) {
      if (sel === '.pw-load-more-sentinel') return sentinelNode;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'img' || sel === '.pw-blur-in') return imgs;
      if (sel === '.photo-wall-item[data-photo-id]') {
        return Array.from({ length: state.cardCount }, (_, i) => ({
          getAttribute(name) { return name === 'data-photo-id' ? 'photo-' + i : null; },
        }));
      }
      return [];
    },
    appendChild(n) { sentinelNode = n; return n; },
    insertAdjacentHTML(pos, html) { state.cardCount += countCards(html); },
  };
  const window = {
    currentUser: 'owner',
    photoWallData: Array.from({ length: 490 }, (_, i) => photo(i)),
    pwSortKey: 'date_desc',
    pwAlbumView: false,
    innerHeight: 800,
    addEventListener() {},
    hasMorePhotos() { return state.hasMore; },
    // 再取一页：追加 20 张更旧的照片（前缀顺序不变），服务端仍有更多。
    loadMorePhotos: async () => {
      const more = Array.from({ length: 20 }, (_, k) => photo(490 + k));
      window.photoWallData = window.photoWallData.concat(more);
      return more;
    },
  };
  const document = {
    getElementById(id) { return id === 'photoGrid' ? grid : null; },
    createElement() { return makeSentinel(); },
    addEventListener() {},
    querySelector() { return null; },
  };
  const sandbox = {
    window, document, console, Date, Map, Set, Promise,
    requestAnimationFrame(fn) { fn(); },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(RENDER_SRC, sandbox, { filename: 'photo-wall-render.js' });
  return {
    window, state,
    get sentinel() { return sentinelNode; },
    get sentinelText() { return sentinelNode && sentinelNode.indicator.textContent; },
  };
}

test('G-L3: 无 500 DOM 上限——加载更多后全部追加，哨兵仍是可用入口', async () => {
  // 2026-11-27：用户要求照片墙全部显示、不要分批。DOM 上限常量放宽到实际
  // 不可达，加载更多把新页全部追加进 DOM（490 + 20 = 510），不再顶满 500
  // 停住，也不再写「已达渲染上限」这类分批文案。
  const rt = createRuntime();
  await rt.window.renderPhotoWall();
  assert.equal(rt.state.cardCount, 490, '首屏渲染已加载的全部 490 张卡片');
  await rt.window.__xtjPhotoWallLoadMore();
  assert.equal(rt.state.cardCount, 510, '加载更多后全部追加，无 500 上限截断');
  assert.ok(!/上限|分批|第 \d+ 批/.test(rt.sentinelText), '哨兵不再提示分批触顶');
  assert.equal(typeof rt.sentinel.onclick, 'function', '哨兵仍保留可点击入口');
});
