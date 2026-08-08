(function () {
  'use strict';

  if (window.__xtjThemeToggleBound) return;
  window.__xtjThemeToggleBound = true;
  // ★ 修复 M-2：声明本模块接管主题控制（V2）。core.js 中旧主题块以
  // `if (!window.__xtjThemeControllerV2)` 守卫，此前从未设置此标记导致两套
  // 实现同时运行、存储键（xtj_theme vs xtj-theme）互相覆盖。
  // 设置后旧块被跳过，主题状态统一由本模块管理。
  window.__xtjThemeControllerV2 = true;

  var STORAGE_KEY = 'xtj_theme';
  var LEGACY_STORAGE_KEY = 'xtj-theme';
  var htmlEl = document.documentElement;
  var switchTimer = 0;
  var clearSwitchingTimer = 0;
  var themeBtn = null;
  var profileThemeToggle = null;
  var desktopThemeMode = null;
  var systemThemeQuery = null;

  function getSystemTheme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function readStoredTheme() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
      var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === 'dark' || legacy === 'light') {
        localStorage.setItem(STORAGE_KEY, legacy);
        return legacy;
      }
    } catch (_) {}
    return '';
  }

  function resolveThemeMode() {
    var stored = readStoredTheme();
    if (stored) return stored;
    var currentMode = htmlEl.getAttribute('data-theme-mode');
    return currentMode === 'dark' || currentMode === 'light' || currentMode === 'system' ? currentMode : 'system';
  }

  function resolveTheme(mode) {
    return mode === 'system' ? getSystemTheme() : (mode === 'dark' ? 'dark' : 'light');
  }

  function persistTheme(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (_) {}
  }

  function syncControls(theme, mode) {
    if (!themeBtn) themeBtn = document.getElementById('themeToggle');
    var isDark = theme === 'dark';
    if (themeBtn) {
      themeBtn.classList.toggle('is-dark', isDark);
      themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', isDark ? '切换浅色模式' : '切换深色模式');
      themeBtn.setAttribute('title', isDark ? '切换浅色模式' : '切换深色模式');
    }
    if (!profileThemeToggle) profileThemeToggle = document.getElementById('profileThemeToggle');
    if (profileThemeToggle) {
      profileThemeToggle.checked = isDark;
      profileThemeToggle.setAttribute('aria-checked', isDark ? 'true' : 'false');
    }
    if (!desktopThemeMode) desktopThemeMode = document.getElementById('desktopThemeMode');
    if (desktopThemeMode) desktopThemeMode.value = mode;
  }

  function applyThemeMode(mode) {
    var normalizedMode = mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
    var theme = resolveTheme(normalizedMode);
    htmlEl.setAttribute('data-theme-mode', normalizedMode);
    htmlEl.setAttribute('data-theme', theme);
    syncControls(theme, normalizedMode);
  }

  function clearThemeSwitching() {
    if (clearSwitchingTimer) {
      window.clearTimeout(clearSwitchingTimer);
      clearSwitchingTimer = 0;
    }
    htmlEl.classList.remove('theme-switching');
  }

  function startThemeSwitching() {
    clearThemeSwitching();
    htmlEl.classList.add('theme-switching');
    clearSwitchingTimer = window.setTimeout(clearThemeSwitching, 300);
  }

  function supportsTransitionAnimation() {
    try {
      return !!document.startViewTransition &&
        !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function setThemeMode(mode) {
    var nextMode = mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
    applyThemeMode(nextMode);
    persistTheme(nextMode);
    startThemeSwitching();
  }

  function switchTheme() {
    // ★ 真正的节流闸门：连点期间只接受第一次，避免并发 startViewTransition
    if (switchTimer) return;
    var currentMode = resolveThemeMode();
    var currentTheme = resolveTheme(currentMode);
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

    if (supportsTransitionAnimation()) {
      try {
        var transition = document.startViewTransition(function () {
          applyThemeMode(nextTheme);
          persistTheme(nextTheme);
        });
        // ★ 显式吞掉 .finished/.ready 的未处理 Promise 拒绝
        if (transition && transition.finished) transition.finished.catch(function () {});
        if (transition && transition.ready) transition.ready.catch(function () {});
        startThemeSwitching();
        switchTimer = window.setTimeout(function () {
          switchTimer = 0;
        }, 300);
        return;
      } catch (_) {}
    }

    setThemeMode(nextTheme);
    switchTimer = window.setTimeout(function () {
      switchTimer = 0;
    }, 300);
  }

  function bindElementOnce(el, event, handler) {
    if (!el || el.dataset.xtjThemeBound === '1') return;
    el.dataset.xtjThemeBound = '1';
    el.addEventListener(event, handler);
  }

  function bindThemeToggle() {
    themeBtn = document.getElementById('themeToggle');
    bindElementOnce(themeBtn, 'click', function (event) {
      event.preventDefault();
      switchTheme();
    });
    profileThemeToggle = document.getElementById('profileThemeToggle');
    bindElementOnce(profileThemeToggle, 'change', function () {
      var that = this;
      var next = that.checked ? 'dark' : 'light';
      if (profileThemeToggle._debounceTimer) clearTimeout(profileThemeToggle._debounceTimer);
      profileThemeToggle._debounceTimer = setTimeout(function() { setThemeMode(next); }, 100);
    });
    desktopThemeMode = document.getElementById('desktopThemeMode');
    bindElementOnce(desktopThemeMode, 'change', function () {
      setThemeMode(this.value);
    });
  }

  function initThemeController() {
    var mode = resolveThemeMode();
    applyThemeMode(mode);
    bindThemeToggle();
    try {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      var handleSystemThemeChange = function () {
        if (resolveThemeMode() === 'system') applyThemeMode('system');
      };
      if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', handleSystemThemeChange);
      else if (systemThemeQuery.addListener) systemThemeQuery.addListener(handleSystemThemeChange);
    } catch (_) {}
  }

  window.XTJThemeController = {
    setMode: setThemeMode,
    getMode: resolveThemeMode,
    getResolvedTheme: function () { return resolveTheme(resolveThemeMode()); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeController, { once: true });
  } else {
    initThemeController();
  }
})();
