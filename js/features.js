(function () {
  'use strict';

  if (window.__xtjFeaturesSafeHotfixV1) return;
  window.__xtjFeaturesSafeHotfixV1 = true;

  var PANEL_MAP = {
    posts: 'panelPosts',
    chat: 'panelChat',
    ai: 'panelAi',
    profile: 'panelProfile'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function injectStyle() {
    if ($('xtjSafeHotfixStyle')) return;
    var style = document.createElement('style');
    style.id = 'xtjSafeHotfixStyle';
    style.textContent = [
      'html,body{visibility:visible!important;opacity:1!important;}',
      '.app-container{display:flex!important;visibility:visible!important;opacity:1!important;}',
      '.dock-panels{display:block!important;visibility:visible!important;opacity:1!important;}',
      '.dock-panel.active{opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:translate3d(0,0,0) scale(1)!important;}',
      '.dock-panel:not(.active){pointer-events:none!important;}',
      '#dockBar{display:flex!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;}',
      '#dockBar .dock-tab{pointer-events:auto!important;touch-action:manipulation!important;}',
      '.modal-overlay:not(.active),.img-viewer:not(.active),.pp-confirm-overlay:not(.active){opacity:0!important;pointer-events:none!important;}',
      '.photo-preview-overlay:not(.active){opacity:0!important;visibility:hidden!important;pointer-events:none!important;}',
      '.pp-info-modal:not(.active):not(.closing){display:none!important;opacity:0!important;pointer-events:none!important;}',
      'body:not(.photo-previewing) #dockBar{display:flex!important;visibility:visible!important;opacity:1!important;}',
      '.xtj-hotfix-error{margin:14px 0;padding:14px 16px;border-radius:16px;background:rgba(255,59,96,.10);border:1px solid rgba(255,59,96,.20);color:#ff3b60;font-size:13px;line-height:1.6;}',
      '@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureActivePanel() {
    var panels = Array.prototype.slice.call(document.querySelectorAll('.dock-panel'));
    if (!panels.length) return;

    var active = panels.find(function (panel) { return panel.classList.contains('active'); });
    if (!active) {
      active = $('panelPosts') || panels[0];
      active.classList.add('active');
    }

    panels.forEach(function (panel) {
      var isActive = panel === active;
      panel.style.pointerEvents = isActive ? 'auto' : 'none';
      panel.style.opacity = isActive ? '1' : '';
      panel.style.visibility = isActive ? 'visible' : '';
    });

    var tabName = Object.keys(PANEL_MAP).find(function (key) { return PANEL_MAP[key] === active.id; }) || 'posts';
    document.querySelectorAll('.dock-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
  }

  function switchPanel(tabName) {
    var panelId = PANEL_MAP[tabName];
    if (!panelId) return false;

    document.querySelectorAll('.dock-panel').forEach(function (panel) {
      var active = panel.id === panelId;
      panel.classList.toggle('active', active);
      panel.style.pointerEvents = active ? 'auto' : 'none';
      panel.style.opacity = active ? '1' : '';
      panel.style.visibility = active ? 'visible' : '';
      if (active) panel.scrollTop = panel.scrollTop || 0;
    });

    document.querySelectorAll('.dock-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.body.classList.remove('photo-previewing');
    return true;
  }

  function installDockFallback() {
    document.addEventListener('click', function (event) {
      var tab = event.target && event.target.closest ? event.target.closest('.dock-tab[data-tab]') : null;
      if (!tab) return;

      var tabName = tab.dataset.tab;
      var nativeSwitch = window.switchDockTab;

      if (typeof nativeSwitch === 'function' && !nativeSwitch.__xtjSafeFallbackBroken) {
        try {
          nativeSwitch(tabName);
          setTimeout(ensureActivePanel, 40);
          return;
        } catch (err) {
          nativeSwitch.__xtjSafeFallbackBroken = true;
          console.warn('[xtj hotfix] switchDockTab failed, fallback enabled:', err);
        }
      }

      switchPanel(tabName);
    }, true);
  }

  function unlockStuckOverlays() {
    var preview = $('photoPreviewOverlay');
    var previewImg = $('photoPreviewImage');
    var previewVisible = preview && preview.classList.contains('active') && previewImg && previewImg.getAttribute('src');

    if (!previewVisible) {
      document.body.classList.remove('photo-previewing');
      if (preview && !preview.classList.contains('active')) {
        preview.style.pointerEvents = 'none';
        preview.style.visibility = 'hidden';
        preview.style.opacity = '0';
      }
    }

    document.querySelectorAll('.modal-overlay,.img-viewer,.pp-confirm-overlay').forEach(function (overlay) {
      if (!overlay.classList.contains('active')) {
        overlay.style.pointerEvents = 'none';
      }
    });
  }

  function syncProfileFallback() {
    window.syncProfileUser = window.syncProfileUser || function () {
      var currentUser = window.currentUser || '';
      var name = $('profileName');
      var status = $('profileStatus');
      var avatar = $('profileAvatar');
      if (name) name.textContent = currentUser || '未登录';
      if (status) status.textContent = currentUser ? '查看资料' : '点击登录';
      if (avatar) avatar.textContent = currentUser ? currentUser.charAt(0).toUpperCase() : '?';
    };
    try { window.syncProfileUser(); } catch (err) {}
  }

  function installThemeBridge() {
    document.addEventListener('change', function (event) {
      if (!event.target) return;
      if (event.target.id === 'profileThemeToggle') {
        var btn = $('themeToggle');
        if (btn) btn.click();
      }
      if (event.target.id === 'profileNotifToggle') {
        try { localStorage.setItem('xtj-notif', event.target.checked ? 'on' : 'off'); } catch (err) {}
      }
    });
  }

  function installErrorGuard() {
    window.addEventListener('error', function (event) {
      console.warn('[xtj hotfix] runtime error:', event.message, event.filename, event.lineno);
      injectStyle();
      ensureActivePanel();
      unlockStuckOverlays();
    });

    window.addEventListener('unhandledrejection', function (event) {
      console.warn('[xtj hotfix] promise rejection:', event.reason);
      injectStyle();
      ensureActivePanel();
      unlockStuckOverlays();
    });
  }

  function installLightObserver() {
    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        unlockStuckOverlays();
        ensureActivePanel();
      });
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: false,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }
  }

  function boot() {
    injectStyle();
    ensureActivePanel();
    unlockStuckOverlays();
    installDockFallback();
    installThemeBridge();
    syncProfileFallback();
    installErrorGuard();
    installLightObserver();

    setTimeout(function () {
      injectStyle();
      ensureActivePanel();
      unlockStuckOverlays();
      syncProfileFallback();
    }, 300);

    setTimeout(function () {
      injectStyle();
      ensureActivePanel();
      unlockStuckOverlays();
    }, 1200);
  }

  onReady(boot);
})();
