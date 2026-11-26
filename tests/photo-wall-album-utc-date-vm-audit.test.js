'use strict';
// G-L2 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/render.js，以相册视图渲染三张跨 UTC 午夜的照片。
// 修复前：按本地时区取日期，三张全进 2026-11-12 组；修复后：按 UTC 取日期，
// 前两张进 2026-11-11 组，第三张进 2026-11-12 组。
// 本测试必须在 TZ=Asia/Shanghai 下运行（本地时区须与 UTC 不同）：
//   TZ=Asia/Shanghai node --test tests/photo-wall-album-utc-date-vm-audit.test.js
// 前置断言会在时区不对时直接失败，避免在 UTC 时区下空过。
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

async function renderAlbum(photos) {
  const imgs = photos.map(p => new FakeImg(p.imageUrl));
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
  const window = {
    currentUser: 'owner',
    photoWallData: photos,
    pwSortKey: 'date_desc',
    pwAlbumView: true,
    pwAlbumGroupKey: '',
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
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(RENDER_SRC, sandbox, { filename: 'photo-wall-render.js' });
  await window.renderPhotoWall();
  return markup;
}

test('G-L2: 相册按 UTC 日期分组，跨午夜的照片不因本地时区串组', async () => {
  // 前置条件：本地时区须为东八区，否则本地与 UTC 无差异、测试空过。
  const probe = new Date(Date.UTC(2026, 10, 11, 18, 0, 0));
  assert.equal(probe.getHours(), 2, '本测试须在 TZ=Asia/Shanghai 下运行（本地 18:00 UTC 应为次日 02:00）');
  const photos = [
    { id: 'a', timestamp: Date.UTC(2026, 10, 11, 18, 0, 0), username: 'owner', imageUrl: 'https://example.test/a.jpg', thumbUrl: 'https://example.test/a.jpg' },
    { id: 'b', timestamp: Date.UTC(2026, 10, 11, 20, 0, 0), username: 'owner', imageUrl: 'https://example.test/b.jpg', thumbUrl: 'https://example.test/b.jpg' },
    { id: 'c', timestamp: Date.UTC(2026, 10, 12, 2, 0, 0), username: 'owner', imageUrl: 'https://example.test/c.jpg', thumbUrl: 'https://example.test/c.jpg' },
  ];
  const markup = await renderAlbum(photos);
  const groupKeys = [...markup.matchAll(/openPhotoAlbumGroup\('([^']+)'\)/g)].map(m => m[1]);
  // 照片按时间倒序排，11-12 组先出现。
  assert.deepEqual(groupKeys, ['2026-11-12', '2026-11-11'], 'UTC 分组：前两张 11-11，第三张 11-12');
  assert.match(markup, /11 月 11 日/, '分组标题也用 UTC 日期');
  assert.match(markup, /11 月 12 日/);
  assert.doesNotMatch(markup, /11 月 13 日/);
});
