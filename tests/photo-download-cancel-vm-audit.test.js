'use strict';
// G-H1 vm 回归测试：本机装不上浏览器二进制（Playwright CDN 被网关拦截、
// /opt/meta-chromium 需 Hatch WebGL 域策略才能启动），所以用 vm + 手写 DOM 桩
// 直接加载 js/photo-wall/preview.js 跑真实下载链路。浏览器版见
// tests/photo-download-cancel-audit.test.js（CI 环境有浏览器时跑）。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const PREVIEW_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'preview.js'), 'utf8');

function makeStyle() {
  const s = { setProperty(k, v) { s[k] = v; }, getPropertyValue(k) { return s[k] || ''; }, removeProperty(k) { delete s[k]; } };
  return s;
}
class El {
  constructor(tag, env) {
    this.tagName = (tag || 'div').toUpperCase();
    this._env = env;
    this.children = [];
    this.parentNode = null;
    this.style = makeStyle();
    this._class = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => this._class.add(x)),
      remove: (...c) => c.forEach(x => this._class.delete(x)),
      contains: (c) => this._class.has(c),
      toggle: (c, f) => { if (f === undefined) f = !this._class.has(c); f ? this._class.add(c) : this._class.delete(c); return f; },
    };
    this._attrs = {};
    this._listeners = {};
    this._id = '';
    this.textContent = '';
    this._html = '';
    this.complete = false;
    this.naturalWidth = 0;
    this.clientWidth = 390;
    this.clientHeight = 844;
    this.offsetWidth = 390;
    this.offsetHeight = 44;
    this.disabled = false;
    this.hidden = false;
    this.download = '';
    this.href = '';
    this.src = '';
    this.onload = null;
    this.onerror = null;
  }
  get id() { return this._id; }
  set id(v) { this._id = String(v || ''); if (this._id) this._env.registry[this._id] = this; }
  get className() { return [...this._class].join(' '); }
  set className(v) { this._class = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v || '');
    // 桩 DOM 不解析 HTML：只把 id="..." 抠出来注册成桩元素。
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(this._html))) {
      if (!this._env.registry[m[1]]) {
        const tag = /Img|Image/.test(m[1]) ? 'img' : /Btn|button/i.test(m[1]) ? 'button' : 'div';
        const el = new El(tag, this._env);
        el.id = m[1];
        this.children.push(el);
        el.parentNode = this;
      }
    }
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(f => f !== fn); }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  querySelector(sel) {
    if (sel.startsWith('#')) return this._env.registry[sel.slice(1)] || null;
    return null;
  }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  closest() { return null; }
  decode() { return Promise.resolve(); }
  click() {
    // 下载用的 <a>：记录下来，替代真实保存文件。
    if (this.tagName === 'A' && this.download) this._env.downloads.push({ download: this.download, href: this.href });
  }
}

function makeEnv() {
  const env = {
    registry: {}, downloads: [], toasts: [],
    fetchCalls: [], downloadCtl: null, _total: 0,
    timers: new Set(), intervals: new Set(),
  };
  const sandbox = {
    console,
    // 记下所有定时器：预览里的 ppBar 蠕动 interval、watchOriginal 看门狗等
    // 在测试结束后由 env.cleanup() 清掉，否则 node --test 进程无法退出。
    setTimeout: (fn, ms, ...a) => { const id = setTimeout(fn, ms, ...a); env.timers.add(id); return id; },
    clearTimeout: (id) => { env.timers.delete(id); clearTimeout(id); },
    setInterval: (fn, ms, ...a) => { const id = setInterval(fn, ms, ...a); env.intervals.add(id); return id; },
    clearInterval: (id) => { env.intervals.delete(id); clearInterval(id); },
    Blob, AbortController,
    URL: { createObjectURL: () => 'blob:test-' + Math.random().toString(36).slice(2), revokeObjectURL: () => {} },
    Math, JSON, Number, String, Array, Object, Promise, Date, RegExp, Error,
    innerWidth: 390, innerHeight: 844,
    currentUser: 'alice',
    showToast: (m) => { env.toasts.push(String(m)); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(fn, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    location: { origin: 'https://test.invalid', href: 'https://test.invalid/' },
    navigator: { userAgent: 'node-test' },
    __env: env,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const docEl = new El('html', env);
  const body = new El('body', env);
  sandbox.document = {
    getElementById: (id) => env.registry[id] || null,
    createElement: (tag) => new El(tag, env),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
    documentElement: docEl,
    body,
  };
  sandbox.Image = class Image extends El {
    constructor() { super('img', env); }
  };
  // fetch 桩：watchOriginal 的预取（credentials: same-origin）挂起不返回；
  // 下载的 fetch 返回可控流：测试手动投递 chunk / 结束 / 观察 abort。
  sandbox.fetch = (url, init) => {
    env.fetchCalls.push({ url, init });
    if (init && init.credentials === 'same-origin') return new Promise(() => {});
    const ctl = { chunks: [], done: false, pendingReads: [], aborted: false, total: 0 };
    env.downloadCtl = ctl;
    const signal = init && init.signal;
    if (signal) {
      if (signal.aborted) ctl.aborted = true;
      else signal.addEventListener('abort', () => {
        ctl.aborted = true;
        ctl.pendingReads.splice(0).forEach(({ reject }) => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (name) => {
        const n = String(name || '').toLowerCase();
        if (n === 'content-length') return String(env._total || 0);
        if (n === 'content-type') return 'image/jpeg';
        return null;
      } },
      body: { getReader: () => ({ read: () => {
        if (ctl.aborted) { const err = new Error('aborted'); err.name = 'AbortError'; return Promise.reject(err); }
        if (ctl.chunks.length) return Promise.resolve({ done: false, value: ctl.chunks.shift() });
        if (ctl.done) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve, reject) => ctl.pendingReads.push({ resolve, reject }));
      } }) },
    });
  };
  vm.createContext(sandbox);
  vm.runInContext(PREVIEW_SRC, sandbox, { filename: 'preview.js' });
  env.sandbox = sandbox;
  env.cleanup = () => {
    env.timers.forEach((id) => clearTimeout(id));
    env.intervals.forEach((id) => clearInterval(id));
    env.timers.clear();
    env.intervals.clear();
  };
  env.el = (id) => env.registry[id] || null;
  env.deliver = (bytes) => {
    const chunk = new Uint8Array(bytes);
    const ctl = env.downloadCtl;
    if (ctl.pendingReads.length) ctl.pendingReads.shift().resolve({ done: false, value: chunk });
    else ctl.chunks.push(chunk);
  };
  env.finishStream = () => {
    const ctl = env.downloadCtl;
    ctl.done = true;
    ctl.pendingReads.splice(0).forEach(({ resolve }) => resolve({ done: true, value: undefined }));
  };
  env.open = () => {
    // 注意：列表必须直接传数组（或挂 window.pwCurrentSortedPhotos）；
    // 传 { photos } 对象时只用于登录守卫，列表仍取全局数据。
    sandbox.openPhotoPreview(0, [{ id: 'p1', imageUrl: 'https://test.invalid/api/photo/p1/media', username: 'alice', timestamp: Date.now(), views: 3 }]);
  };
  return env;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('G-H1: 未收到字节时进度条不动（无假进度），收到一半时显示真实进度，完成后保存带扩展名的文件', async () => {
  const env = makeEnv();
  try {
  const { sandbox } = env;
  env.open();
  assert.equal(sandbox.photoPreviewCurrent && sandbox.photoPreviewCurrent.id, 'p1', 'preview opens and sets the current photo');
  env.downloadCtl = null;
  env._total = 1000;
  sandbox.ppConfirmDownload();
  await sleep(50);
  // 下载 fetch 已发出，总长 1000 字节，但先不投递任何 chunk。
  assert.ok(env.downloadCtl, 'download fetch started');
  await sleep(1200);
  // 旧实现 150ms 一跳、每次 +2%，1.2 秒后已假推到约 25%。
  assert.equal(env.el('ppDownloadProgressBar').style.width, '0%', 'bar must not advance before any byte arrives');
  env.deliver(500);
  await sleep(50);
  assert.equal(env.el('ppDownloadProgressBar').style.width, '50%', 'bar shows real received/total progress');
  env.deliver(500);
  env.finishStream();
  await sleep(1200);
  assert.equal(env.downloads.length, 1, 'one file saved');
  assert.match(env.downloads[0].download, /\.jpe?g$/i, 'saved as "' + env.downloads[0].download + '"');
  assert.ok(env.toasts.some(t => /下载成功/.test(t)), 'success toast shown, got: ' + env.toasts.join('|'));
  } finally { env.cleanup(); }
});

test('G-H1: 取消按钮中止下载，遮罩隐藏、不保存文件，且可再次下载', async () => {
  const env = makeEnv();
  try {
  const { sandbox } = env;
  env.open();
  env._total = 1000;
  sandbox.ppConfirmDownload();
  await sleep(50);
  assert.ok(env.downloadCtl, 'download fetch started');
  await sleep(300);
  assert.ok(env.el('ppDownloadCancelBtn'), 'overlay carries a cancel button');
  // 模拟点遮罩上的取消按钮。
  env.el('ppDownloadCancelBtn').click();
  // 注意：桩元素的 click() 只记录 <a> 下载；取消按钮走 onclick 属性——直接调同名入口。
  sandbox.ppCancelDownload();
  await sleep(100);
  assert.equal(env.el('ppDownloadOverlay').style.display, 'none', 'overlay hidden after cancel');
  assert.equal(env.downloads.length, 0, 'cancelled download must not save a file');
  assert.ok(env.toasts.some(t => /下载已取消/.test(t)), 'cancel toast shown, got: ' + env.toasts.join('|'));
  // E 标志已复位：再次下载能重新发起（遮罩重新出现），而不是点下载无反应。
  env.downloadCtl = null;
  sandbox.ppConfirmDownload();
  await sleep(50);
  assert.ok(env.downloadCtl, 'second download starts after cancel');
  assert.equal(env.el('ppDownloadOverlay').style.display, 'flex', 'overlay shown again');
  sandbox.ppCancelDownload();
  await sleep(100);
  assert.equal(env.el('ppDownloadOverlay').style.display, 'none', 'second download cancelled cleanly');
  } finally { env.cleanup(); }
});
