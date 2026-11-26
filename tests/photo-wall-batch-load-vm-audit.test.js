'use strict';
// G-M2 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/render.js，驱动 window.showNextPhotoBatch。
// 修复前：稀疏分组逐页试探固定 30 次、单页 10 秒超时，最坏 300 秒才停，
// 且加载中无法取消；修复后：20 秒时间预算到点即停，加载中哨兵可点取消。
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

function createRuntime() {
  const RealDate = Date;
  let fakeNow = RealDate.now();
  // 可控时钟：new Date() 仍走真实构造，只有 Date.now() 被接管。
  function FakeDate(...args) { return new RealDate(...args); }
  FakeDate.now = () => fakeNow;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  FakeDate.prototype = RealDate.prototype;

  const imgs = [0, 1, 2].map(i => new FakeImg('https://example.test/photo-' + i + '.jpg'));
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
      remove() {},
    };
    return node;
  }
  const grid = {
    classList: { toggle() {}, add() {}, remove() {} },
    get innerHTML() { return markup; },
    set innerHTML(v) { markup = String(v || ''); },
    querySelector(sel) { return sel === '.pw-load-more-sentinel' ? sentinelNode : null; },
    querySelectorAll(sel) {
      if (sel === 'img' || sel === '.pw-blur-in') return imgs;
      return [];
    },
    appendChild(n) { sentinelNode = n; return n; },
  };
  const timers = [];
  const state = { loadMoreCalls: 0, hasMore: true, release: null };
  const window = {
    currentUser: 'owner',
    photoWallData: imgs.map((img, i) => ({
      id: 'photo-' + i, timestamp: RealDate.UTC(2026, 9, 12) - i * 1000,
      thumbUrl: 'https://example.test/photo-' + i + '.jpg',
      imageUrl: 'https://example.test/photo-' + i + '.jpg',
    })),
    pwSortKey: 'date_desc',
    pwAlbumView: false,
    innerHeight: 800,
    addEventListener() {},
    hasMorePhotos() { return state.hasMore; },
    // 默认：每页 6 秒、永远不带出新照片（稀疏分组空转场景）。
    loadMorePhotos: async () => { state.loadMoreCalls++; fakeNow += 6000; return []; },
  };
  const document = {
    getElementById(id) { return id === 'photoGrid' ? grid : null; },
    createElement() { return makeSentinel(); },
    addEventListener() {},
    querySelector() { return null; },
  };
  const sandbox = {
    window, document, console, Map, Set, Promise,
    Date: FakeDate,
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn, delay) { const id = timers.length + 1; timers.push({ id, fn, delay }); return id; },
    clearTimeout(id) { const t = timers.find(x => x.id === id); if (t) t.cancelled = true; },
    setInterval: () => 0, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(RENDER_SRC, sandbox, { filename: 'photo-wall-render.js' });
  return {
    window, state,
    get sentinel() { return sentinelNode; },
    get sentinelText() { return sentinelNode && sentinelNode.indicator.textContent; },
    advance(ms) { fakeNow += ms; },
  };
}

test('G-M2: 稀疏分组空转时 20 秒预算到点即停，不再试探满 30 页', async () => {
  const rt = createRuntime();
  await rt.window.renderPhotoWall();
  await rt.window.showNextPhotoBatch();
  // 每页 6 秒：t=0/6/12/18 各跑 1 页，第 4 页结束时 t=24 已超 20 秒预算 → 停。
  // 修复前固定 30 次。
  assert.equal(rt.state.loadMoreCalls, 4, '20 秒预算内只应试探 4 页');
  assert.equal(rt.sentinelText, '当前相册暂无更多照片，点击继续查找');
});

test('G-M2: 加载中点哨兵取消后不再继续翻页，且 loadingMore 立即释放', async () => {
  const rt = createRuntime();
  await rt.window.renderPhotoWall();
  // 换成挂起式 loadMorePhotos：第一次调用不 resolve，等测试放行。
  rt.window.loadMorePhotos = () => new Promise((resolve) => { rt.state.loadMoreCalls++; rt.state.release = () => resolve([]); });
  const first = rt.window.showNextPhotoBatch();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(rt.state.loadMoreCalls, 1, '已发出第 1 页请求');
  assert.equal(rt.sentinelText, '正在加载下一批…（点击取消）');
  assert.equal(typeof rt.sentinel.onclick, 'function', '加载中哨兵可点取消');
  // 点取消（走哨兵 onclick，与真实点击同一路径）。
  rt.sentinel.onclick();
  assert.equal(rt.sentinelText, '已取消加载，点击继续查找');
  rt.state.release();
  await first;
  assert.equal(rt.state.loadMoreCalls, 1, '取消后不取第 2 页');
  // loadingMore 已释放：再点“下一批”能重新发出请求（每页 6 秒，20 秒预算内 4 页）。
  rt.window.loadMorePhotos = async () => { rt.state.loadMoreCalls++; rt.advance(6000); return []; };
  await rt.window.showNextPhotoBatch();
  assert.equal(rt.state.loadMoreCalls, 5, '取消后可重新翻页，loadingMore 未卡死');
});

test('G-M2: 取消函数也直接暴露在 window 上', async () => {
  const rt = createRuntime();
  assert.equal(typeof rt.window.__xtjCancelPhotoWallBatchLoad, 'function');
});
