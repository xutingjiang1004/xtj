(function () {
  'use strict';

  if (window.__xtjThemeToggleBound) return;
  window.__xtjThemeToggleBound = true;

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
    if (switchTimer) {
      window.clearTimeout(switchTimer);
      switchTimer = 0;
    }
    var currentMode = resolveThemeMode();
    var currentTheme = resolveTheme(currentMode);
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

    if (supportsTransitionAnimation()) {
      try {
        document.startViewTransition(function () {
          applyThemeMode(nextTheme);
          persistTheme(nextTheme);
        });
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
