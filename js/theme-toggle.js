(function () {
  'use strict';

  if (window.__xtjThemeToggleBound) return;
  window.__xtjThemeToggleBound = true;
  window.__xtjThemeControllerV2 = true;

  var STORAGE_KEY = 'xtj_theme';
  var LEGACY_STORAGE_KEY = 'xtj-theme';
  var htmlEl = document.documentElement;
  var themeBtn, profileThemeToggle, desktopThemeMode, systemThemeQuery;
  var activeTransition = null;
  var transitionVersion = 0;
  var clearSwitchingTimer = 0;
  var gesture = null;
  var dragFrame = 0;
  var suppressPointerClick = false;

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function resolveThemeMode() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
      var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === 'dark' || legacy === 'light') {
        localStorage.setItem(STORAGE_KEY, legacy);
        return legacy;
      }
    } catch (_) {}
    var mode = htmlEl.getAttribute('data-theme-mode');
    return mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
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
    var isDark = theme === 'dark';
    if (themeBtn) {
      themeBtn.classList.toggle('is-dark', isDark);
      themeBtn.style.setProperty('--theme-progress', isDark ? '1' : '0');
      themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', isDark ? '切换浅色模式，可左右拖动' : '切换深色模式，可左右拖动');
      themeBtn.setAttribute('title', isDark ? '切换浅色模式' : '切换深色模式');
    }
    if (profileThemeToggle) {
      profileThemeToggle.checked = isDark;
      profileThemeToggle.setAttribute('aria-checked', isDark ? 'true' : 'false');
    }
    if (desktopThemeMode) desktopThemeMode.value = mode;
  }

  function applyThemeMode(mode) {
    htmlEl.setAttribute('data-theme-mode', mode);
    htmlEl.setAttribute('data-theme', resolveTheme(mode));
    syncControls(resolveTheme(mode), mode);
  }

  function clearThemeSwitching() {
    window.clearTimeout(clearSwitchingTimer);
    clearSwitchingTimer = 0;
    htmlEl.classList.remove('theme-switching', 'theme-crossfade');
    activeTransition = null;
  }

  function motionEnabled() {
    return htmlEl.getAttribute('data-xtj-motion') !== 'off' &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function setThemeMode(mode) {
    var next = mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
    var previousTheme = htmlEl.getAttribute('data-theme');
    var version = ++transitionVersion;
    if (activeTransition) activeTransition.skipTransition();
    clearThemeSwitching();
    persistTheme(next);
    // Freeze individual color transitions BEFORE updating the theme. The page
    // crossfade supplies a single clock, including buttons and pseudo-elements.
    htmlEl.classList.add('theme-switching');
    var update = function () {
      if (version === transitionVersion) applyThemeMode(next);
    };
    var finish = function () {
      if (version === transitionVersion) clearThemeSwitching();
    };
    if (previousTheme !== resolveTheme(next) && document.startViewTransition && motionEnabled()) {
      try {
        htmlEl.classList.add('theme-crossfade');
        activeTransition = document.startViewTransition(update);
        activeTransition.ready.catch(function () {});
        activeTransition.finished.then(finish, finish);
        clearSwitchingTimer = window.setTimeout(function () {
          if (version !== transitionVersion) return;
          if (activeTransition) activeTransition.skipTransition();
          update();
          finish();
        }, 700);
        return;
      } catch (_) {
        htmlEl.classList.remove('theme-crossfade');
      }
    }
    // Older Safari / reduced motion: one coherent paint, without staggered
    // gradients and late button transitions.
    update();
    clearSwitchingTimer = window.setTimeout(finish, 32);
  }

  function switchTheme() {
    setThemeMode(resolveTheme(resolveThemeMode()) === 'dark' ? 'light' : 'dark');
  }

  function renderDrag() {
    dragFrame = 0;
    if (gesture && themeBtn) themeBtn.style.setProperty('--theme-progress', String(gesture.progress));
  }

  function resetGesture() {
    if (dragFrame) window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    var old = gesture;
    gesture = null;
    themeBtn.classList.remove('is-dragging');
    if (old && themeBtn.hasPointerCapture(old.id)) themeBtn.releasePointerCapture(old.id);
    return old;
  }

  function finishGesture(event, cancelled) {
    if (!gesture || (event && event.pointerId !== gesture.id)) return;
    var old = resetGesture();
    suppressPointerClick = old.dragged || cancelled;
    if (cancelled || !old.dragged) {
      syncControls(resolveTheme(resolveThemeMode()), resolveThemeMode());
      return;
    }
    setThemeMode(old.progress >= 0.5 ? 'dark' : 'light');
  }

  function bindThemeToggle() {
    themeBtn = document.getElementById('themeToggle');
    profileThemeToggle = document.getElementById('profileThemeToggle');
    desktopThemeMode = document.getElementById('desktopThemeMode');
    if (themeBtn) {
      themeBtn.addEventListener('click', function (event) {
        event.preventDefault();
        if (suppressPointerClick && event.detail !== 0) {
          suppressPointerClick = false;
          return;
        }
        suppressPointerClick = false;
        switchTheme();
      });
      themeBtn.addEventListener('pointerdown', function (event) {
        if (gesture || !event.isPrimary || event.button !== 0) return;
        suppressPointerClick = false;
        if (activeTransition) {
          activeTransition.skipTransition();
          applyThemeMode(resolveThemeMode());
        }
        var orb = themeBtn.querySelector('.theme-toggle-orb');
        var box = themeBtn.getBoundingClientRect();
        var style = window.getComputedStyle(themeBtn);
        var travel = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) -
          parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - orb.offsetWidth;
        themeBtn.style.setProperty('--theme-travel', Math.max(1, travel) + 'px');
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
          start: resolveTheme(resolveThemeMode()) === 'dark' ? 1 : 0,
          progress: resolveTheme(resolveThemeMode()) === 'dark' ? 1 : 0,
          travel: Math.max(1, travel), dragged: false };
        themeBtn.setPointerCapture(event.pointerId);
      });
      themeBtn.addEventListener('pointermove', function (event) {
        if (!gesture || event.pointerId !== gesture.id) return;
        var dx = event.clientX - gesture.x;
        var dy = event.clientY - gesture.y;
        if (!gesture.dragged && Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) {
          finishGesture(event, true);
          return;
        }
        if (!gesture.dragged && Math.abs(dx) < 3) return;
        gesture.dragged = true;
        themeBtn.classList.add('is-dragging');
        gesture.progress = Math.max(0, Math.min(1, gesture.start + dx / gesture.travel));
        if (!dragFrame) dragFrame = window.requestAnimationFrame(renderDrag);
      });
      themeBtn.addEventListener('pointerup', function (event) { finishGesture(event, false); });
      themeBtn.addEventListener('pointercancel', function (event) { finishGesture(event, true); });
      themeBtn.addEventListener('lostpointercapture', function (event) { finishGesture(event, true); });
      themeBtn.addEventListener('keydown', function (event) {
        if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) return;
        event.preventDefault();
        if (gesture) finishGesture(null, true);
        setThemeMode(event.key === 'ArrowRight' || event.key === 'End' ? 'dark' : 'light');
      });
    }
    if (profileThemeToggle) profileThemeToggle.addEventListener('change', function () {
      setThemeMode(this.checked ? 'dark' : 'light');
    });
    if (desktopThemeMode) desktopThemeMode.addEventListener('change', function () { setThemeMode(this.value); });
  }

  function initThemeController() {
    bindThemeToggle();
    applyThemeMode(resolveThemeMode());
    try {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      var change = function () {
        if (resolveThemeMode() === 'system') setThemeMode('system');
      };
      if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', change);
      else if (systemThemeQuery.addListener) systemThemeQuery.addListener(change);
    } catch (_) {}
    window.addEventListener('pagehide', function () {
      if (gesture) finishGesture(null, true);
      ++transitionVersion;
      if (activeTransition) activeTransition.skipTransition();
      applyThemeMode(resolveThemeMode());
      clearThemeSwitching();
    });
  }

  window.XTJThemeController = {
    setMode: setThemeMode,
    getMode: resolveThemeMode,
    getResolvedTheme: function () { return resolveTheme(resolveThemeMode()); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThemeController, { once: true });
  else initThemeController();
})();
