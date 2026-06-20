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
      if (stored === 'dark' || stored === 'light') return stored;
      var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === 'dark' || legacy === 'light') {
        localStorage.setItem(STORAGE_KEY, legacy);
        return legacy;
      }
    } catch (_) {}
    return '';
  }

  function resolveTheme() {
    return readStoredTheme() || htmlEl.getAttribute('data-theme') || getSystemTheme();
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (_) {}
  }

  function syncButton(theme) {
    if (!themeBtn) themeBtn = document.getElementById('themeToggle');
    if (!themeBtn) return;
    var isDark = theme === 'dark';
    themeBtn.classList.toggle('is-dark', isDark);
    themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    themeBtn.setAttribute('aria-label', isDark ? '切换浅色模式' : '切换深色模式');
    themeBtn.setAttribute('title', isDark ? '切换浅色模式' : '切换深色模式');
  }

  function applyTheme(theme) {
    htmlEl.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    syncButton(theme);
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

  function setTheme(theme) {
    var nextTheme = theme === 'dark' ? 'dark' : 'light';
    applyTheme(nextTheme);
    persistTheme(nextTheme);
    startThemeSwitching();
  }

  function switchTheme() {
    if (switchTimer) {
      window.clearTimeout(switchTimer);
      switchTimer = 0;
    }
    var currentTheme = resolveTheme();
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

    if (supportsTransitionAnimation()) {
      try {
        document.startViewTransition(function () {
          applyTheme(nextTheme);
          persistTheme(nextTheme);
        });
        startThemeSwitching();
        switchTimer = window.setTimeout(function () {
          switchTimer = 0;
        }, 300);
        return;
      } catch (_) {}
    }

    setTheme(nextTheme);
    switchTimer = window.setTimeout(function () {
      switchTimer = 0;
    }, 300);
  }

  function bindThemeToggle() {
    if (!themeBtn) themeBtn = document.getElementById('themeToggle');
    if (!themeBtn || themeBtn.dataset.xtjThemeBound === '1') return;
    themeBtn.dataset.xtjThemeBound = '1';
    themeBtn.addEventListener('click', function (event) {
      event.preventDefault();
      switchTheme();
    });
  }

  function initThemeController() {
    var theme = resolveTheme();
    applyTheme(theme);
    bindThemeToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeController, { once: true });
  } else {
    initThemeController();
  }
})();
