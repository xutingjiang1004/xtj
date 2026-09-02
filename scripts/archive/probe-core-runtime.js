// ============================================================================
// ⚠️ 一次性补丁/诊断脚本 —— 请勿重跑
// ----------------------------------------------------------------------------
// 本脚本针对特定历史代码状态编写（部分以源码行号偏移 + 字符串锚点改写
// js/* 与 js/core-parts/*），对应改动已合入当前源码；直接重跑可能因锚点
// 失效而报错或静默误改源码。请仅作历史排查参考，使命完成后可移入
// scripts/archive/。
// ============================================================================

/**
 * Load production/min core in a minimal browser-like env to catch boot errors.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const useProd = process.argv.includes('--prod');

async function loadText(p) {
  if (useProd) {
    const url = p.startsWith('http') ? p : 'https://xtj.onrender.com/' + p.replace(/^\//, '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('fetch failed ' + url + ' ' + r.status);
    return r.text();
  }
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function makeDom() {
  const elements = new Map();
  function el(id, tag) {
    if (elements.has(id)) return elements.get(id);
    const node = {
      id,
      tagName: (tag || 'div').toUpperCase(),
      style: {},
      className: '',
      classList: {
        _s: new Set(),
        add() {},
        remove() {},
        contains() { return false; },
        toggle() { return false; },
      },
      children: [],
      childNodes: [],
      firstElementChild: null,
      parentNode: null,
      innerHTML: id === 'feed' ? '<div class="xtj-loading-skeleton"></div>' : '',
      textContent: '',
      value: '',
      checked: false,
      hidden: false,
      dataset: {},
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.children.push(c); return c; },
      removeChild() { return null; },
      insertBefore(c) { this.children.push(c); return c; },
      insertAdjacentElement() {},
      insertAdjacentHTML() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      blur() {},
      click() {},
      closest() { return null; },
      matches() { return false; },
      getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 40, right: 100, bottom: 40 }; },
      scrollIntoView() {},
      dispatchEvent() { return true; },
    };
    elements.set(id, node);
    return node;
  }
  // precreate common ids
  [
    'feed', 'dockBar', 'dockIndicator', 'panelPosts', 'panelChat', 'unauthUI', 'authUI',
    'announcement-btn-wrapper', 'report-btn-wrapper', 'profileName', 'profileStatus',
    'publishBox', 'myName', 'myAvatar', 'profileAvatar', 'sPosts', 'sViews', 'sLikes',
    'desktopWorkbenchName', 'desktopWorkbenchStatus', 'desktopWorkbenchAvatar',
    'toastContainer', 'notificationContainer', 'postInp', 'dockChatInput',
  ].forEach((id) => el(id));

  const document = {
    documentElement: { style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; } },
    body: { style: {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }, appendChild() {}, addEventListener() {} },
    readyState: 'loading',
    getElementById(id) { return el(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return el('tmp_' + Math.random().toString(36).slice(2), tag); },
    createTextNode(t) { return { textContent: t }; },
    createDocumentFragment() { return { appendChild() {}, childNodes: [] }; },
    addEventListener(type, fn) {
      if (!document._listeners) document._listeners = {};
      (document._listeners[type] = document._listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() { return true; },
    fonts: { ready: Promise.resolve() },
  };
  return { document, elements };
}

(async () => {
  const { document } = makeDom();
  const localStorageData = {};
  const windowObj = {
    document,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(localStorageData, k) ? localStorageData[k] : null; },
      setItem(k, v) { localStorageData[k] = String(v); },
      removeItem(k) { delete localStorageData[k]; },
    },
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    location: { origin: 'https://xtj.onrender.com', href: 'https://xtj.onrender.com/', port: '', protocol: 'https:', hostname: 'xtj.onrender.com', pathname: '/', search: '', hash: '' },
    navigator: { userAgent: 'node-probe', platform: 'Win32', maxTouchPoints: 0, language: 'zh-CN', onLine: true },
    performance: { now: () => Date.now(), timeOrigin: Date.now() },
    requestAnimationFrame(cb) { return setTimeout(() => cb(Date.now()), 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
    requestIdleCallback(cb) { return setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 0); },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; },
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    scrollTo() {},
    scrollY: 0,
    scrollX: 0,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    visualViewport: null,
    crypto: require('crypto').webcrypto,
    fetch: async (url, opts) => {
      const u = String(url);
      const full = u.startsWith('http') ? u : 'https://xtj.onrender.com' + u;
      const r = await fetch(full, opts);
      return r;
    },
    Image: function () { this.src = ''; },
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    IntersectionObserver: function () { this.observe = function () {}; this.disconnect = function () {}; this.unobserve = function () {}; },
    ResizeObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    AbortController,
    AbortSignal,
    URL,
    URLSearchParams,
    Promise,
    Map,
    Set,
    WeakMap,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    history: { replaceState() {}, pushState() {} },
    CustomEvent: function (n, i) { this.type = n; this.detail = i && i.detail; },
    Event: function (n) { this.type = n; },
  };
  windowObj.window = windowObj;
  windowObj.self = windowObj;
  windowObj.globalThis = windowObj;
  windowObj.HTMLElement = function () {};
  windowObj.Node = function () {};
  windowObj.Element = function () {};

  const context = vm.createContext(windowObj);
  const scripts = [
    'js/vendor/supabase.min.js',
    'js/config.min.js',
    'js/core-utils.min.js',
    'js/core.min.js',
  ];

  for (const s of scripts) {
    process.stdout.write('eval ' + s + ' ... ');
    try {
      const code = await loadText(s);
      vm.runInContext(code, context, { filename: s, timeout: 10000 });
      console.log('OK');
    } catch (e) {
      console.log('FAIL');
      console.error(e && e.stack || e);
      process.exit(2);
    }
  }

  console.log('loadFeed', typeof context.loadFeed);
  console.log('initialLoad', typeof context.initialLoad);
  console.log('xtjOptionalAuthFetch', typeof context.xtjOptionalAuthFetch);
  console.log('xtjFetch', typeof context.xtjFetch);
  console.log('sb', !!context.sb);
  console.log('API_BASE', context.API_BASE || (context.XTJ_CONFIG && context.XTJ_CONFIG.API_BASE));

  // fire DOMContentLoaded listeners if any
  const listeners = (document._listeners && document._listeners.DOMContentLoaded) || [];
  console.log('DOMContentLoaded listeners', listeners.length);
  document.readyState = 'interactive';
  for (const fn of listeners) {
    try {
      await fn.call(document);
    } catch (e) {
      console.error('DOMContentLoaded handler error', e && e.stack || e);
    }
  }

  if (typeof context.initialLoad === 'function') {
    try {
      await context.initialLoad(true);
      console.log('initialLoad finished');
    } catch (e) {
      console.error('initialLoad error', e && e.stack || e);
    }
  } else {
    console.log('NO initialLoad');
  }

  const feed = document.getElementById('feed');
  console.log('feed has skeleton', /skeleton/.test(feed.innerHTML || ''));
  console.log('feed text', String(feed.textContent || feed.innerHTML || '').slice(0, 200));
  console.log('sPosts', document.getElementById('sPosts').textContent);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
