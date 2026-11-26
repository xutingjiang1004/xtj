'use strict';
// G-M1 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/render.js，模拟 10 张图全部超时（src 设置后永远不
// 触发 onload/onerror），验证慢图不再堵死后续加载。
// 修复前：第 5 张超时后 slowImages.size 已 >= 4，pumpImages 门控直接返回，
// 即使有空闲槽位第 9 张也永远不开始加载；修复后：第 9 张正常开始加载。
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

// 永远不触发 onload/onerror 的慢图：src 一置上就停在“下载中”。
class FakeImg {
  constructor(url) {
    this._attrs = { 'data-src': url };
    this._src = '';
    this.started = false;
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
  set src(v) { this._src = String(v || ''); if (this._src) this.started = true; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  closest() { return null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }; }
}

function createRuntime(photoCount) {
  const imgs = Array.from({ length: photoCount }, (_, i) => new FakeImg('https://example.test/photo-' + i + '.jpg'));
  let markup = '';
  const grid = {
    classList: { toggle() {}, add() {}, remove() {} },
    get innerHTML() { return markup; },
    set innerHTML(v) { markup = String(v || ''); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === 'img' || sel === '.pw-blur-in') return imgs;
      return [];
    },
    appendChild(n) { return n; },
  };
  const timers = [];
  const window = {
    currentUser: 'owner',
    photoWallData: imgs.map((img, i) => ({
      id: 'photo-' + i, timestamp: Date.UTC(2026, 9, 12) - i * 1000,
      thumbUrl: 'https://example.test/photo-' + i + '.jpg',
      imageUrl: 'https://example.test/photo-' + i + '.jpg',
    })),
    pwSortKey: 'date_desc',
    pwAlbumView: false,
    innerHeight: 800,
    addEventListener() {},
    // 故意不提供 IntersectionObserver：走 observeImages 的直接入队分支。
  };
  const document = {
    getElementById(id) {
      if (id === 'photoGrid') return grid;
      return null; // panelAi / pwAlbumToggle / pwUploadGarden 均无
    },
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
  return {
    window, imgs, timers,
    // 按创建顺序触发第 n 个未触发的定时器（30 秒回退定时器）。
    fireNextTimer() {
      const t = timers.find(x => !x.fired && !x.cancelled);
      assert.ok(t, '应有待触发的定时器');
      t.fired = true;
      t.fn();
      return t;
    },
    pendingTimers() { return timers.filter(x => !x.fired && !x.cancelled); },
  };
}

test('G-M1: 4 张以上慢图超时后，后续图片仍能占用空闲槽位开始加载', async () => {
  const rt = createRuntime(10);
  await rt.window.renderPhotoWall();
  // 首屏并发 4 路：前 4 张开始加载，后 6 张排队。
  assert.deepEqual(rt.imgs.map(i => i.started), [true, true, true, true, false, false, false, false, false, false]);
  assert.equal(rt.pendingTimers().length, 4, '4 个在途加载各有 1 个 30 秒回退定时器');
  assert.ok(rt.pendingTimers().every(t => t.delay === 30000));
  // 前 4 张依次超时：每次 settle 都立即补位一张新图（第 5、6、7、8 张）。
  rt.fireNextTimer(); assert.equal(rt.imgs[4].started, true, '第 1 张超时后第 5 张补位');
  rt.fireNextTimer(); assert.equal(rt.imgs[5].started, true, '第 2 张超时后第 6 张补位');
  rt.fireNextTimer(); assert.equal(rt.imgs[6].started, true, '第 3 张超时后第 7 张补位');
  rt.fireNextTimer(); assert.equal(rt.imgs[7].started, true, '第 4 张超时后第 8 张补位');
  // 此时 slowImages 已有 4 张（且永远不 settle），仍有 2 张排队、空闲槽位 0；
  // 再让第 5 张（索引 4）超时：释放 1 个槽位，修复前门控会堵住第 9 张。
  assert.equal(rt.imgs[8].started, false, '第 5 张超时前第 9 张尚未开始');
  rt.fireNextTimer();
  assert.equal(rt.imgs[8].started, true, '第 5 张超时释放槽位后，第 9 张必须开始加载（慢图不再阻塞）');
  rt.fireNextTimer();
  assert.equal(rt.imgs[9].started, true, '第 6 张超时后第 10 张也应补位');
});

test('G-M1: 并发上限仍为 4 路，慢图不占用 activeLoads 槽位', async () => {
  const rt = createRuntime(10);
  await rt.window.renderPhotoWall();
  // 任何时候同时在途的加载不超过 4 路：已开始且未超时的图不多于 4 张。
  const inFlight = () => rt.imgs.filter(i => i.started && !i._pwLoadFailed).length;
  assert.ok(inFlight() <= 4, '首屏在途不超过 4 路');
  for (let n = 0; n < 6; n++) { rt.fireNextTimer(); assert.ok(inFlight() <= 4, '第 ' + (n + 1) + ' 次超时后在途仍不超过 4 路'); }
});
