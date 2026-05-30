(function () {
  'use strict';

  if (window.__xtjEmergencyVisibleV2) return;
  window.__xtjEmergencyVisibleV2 = true;

  var PANEL_MAP = {
    posts: 'panelPosts',
    chat: 'panelChat',
    ai: 'panelAi',
    profile: 'panelProfile'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function injectEmergencyStyle() {
    var old = $('xtjEmergencyVisibleStyleV2');
    if (old) return;

    var style = document.createElement('style');
    style.id = 'xtjEmergencyVisibleStyleV2';
    style.textContent = [
      'html{width:100%!important;height:100%!important;min-height:100%!important;overflow:hidden!important;background:#eaf7ee!important;}',
      'body{width:100%!important;height:100%!important;min-height:100%!important;margin:0!important;overflow:hidden!important;visibility:visible!important;opacity:1!important;background:var(--bg-color,#eaf7ee)!important;color:var(--text-main,#1d1d24)!important;}',
      '.rain-bg-container{display:block!important;visibility:visible!important;pointer-events:none!important;}',
      '.app-container{display:flex!important;flex-direction:column!important;position:relative!important;width:100%!important;max-width:640px!important;margin:0 auto!important;min-height:100vh!important;height:100vh!important;height:100dvh!important;overflow:hidden!important;visibility:visible!important;opacity:1!important;}',
      '.dock-panels{display:block!important;position:relative!important;flex:1 1 auto!important;min-height:0!important;height:auto!important;overflow:hidden!important;visibility:visible!important;opacity:1!important;}',
      '.dock-panel{position:absolute!important;inset:0!important;display:block!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:none!important;}',
      '.dock-panel.active{opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;z-index:2!important;}',
      '#panelPosts.active,#panelChat.active,#panelAi.active,#panelProfile.active{display:block!important;}',
      '#dockBar{position:fixed!important;left:0!important;right:0!important;bottom:0!important;display:flex!important;align-items:center!important;justify-content:center!important;visibility:visible!important;opacity:1!important;z-index:1000!important;pointer-events:none!important;}',
      '#dockBar .dock-tab{display:flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;touch-action:manipulation!important;}',
      '.modal-overlay:not(.active),.img-viewer:not(.active),.pp-confirm-overlay:not(.active){opacity:0!important;visibility:hidden!important;pointer-events:none!important;}',
      '.photo-preview-overlay:not(.active){opacity:0!important;visibility:hidden!important;pointer-events:none!important;}',
      '.pp-info-modal:not(.active):not(.closing){display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}',
      'body:not(.photo-previewing) #dockBar{display:flex!important;visibility:visible!important;opacity:1!important;}',
      '.xtj-emergency-message{margin:16px;padding:16px;border-radius:18px;background:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.9);box-shadow:0 10px 30px rgba(0,0,0,.08);font-size:14px;line-height:1.7;color:var(--text-main,#1d1d24);}',
      '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;}}'
    ].join('\n');

    document.head.appendChild(style);
  }

  function getPanels() {
    return Array.prototype.slice.call(document.querySelectorAll('.dock-panel'));
  }

  function getActivePanel() {
    var panels = getPanels();
    for (var i = 0; i < panels.length; i++) {
      if (panels[i].classList.contains('active')) return panels[i];
    }
    return null;
  }

  function forceLayout() {
    var app = document.querySelector('.app-container');
    var panelsBox = $('dockPanels');
    var dock = $('dockBar');

    if (app) {
      app.style.display = 'flex';
      app.style.flexDirection = 'column';
      app.style.visibility = 'visible';
      app.style.opacity = '1';
      app.style.minHeight = '100vh';
      app.style.height = '100dvh';
      app.style.overflow = 'hidden';
    }

    if (panelsBox) {
      panelsBox.style.display = 'block';
      panelsBox.style.position = 'relative';
      panelsBox.style.flex = '1 1 auto';
      panelsBox.style.minHeight = '0';
      panelsBox.style.overflow = 'hidden';
      panelsBox.style.visibility = 'visible';
      panelsBox.style.opacity = '1';
    }

    if (dock) {
      dock.style.display = 'flex';
      dock.style.visibility = 'visible';
      dock.style.opacity = '1';
      dock.style.pointerEvents = 'none';
    }
  }

  function activatePanel(tabName) {
    var panelId = PANEL_MAP[tabName] || 'panelPosts';
    var panels = getPanels();
    if (!panels.length) return;

    panels.forEach(function (panel) {
      var active = panel.id === panelId;
      panel.classList.toggle('active', active);
      panel.style.display = 'block';
      panel.style.position = 'absolute';
      panel.style.inset = '0';
      panel.style.opacity = active ? '1' : '0';
      panel.style.visibility = active ? 'visible' : 'hidden';
      panel.style.pointerEvents = active ? 'auto' : 'none';
      panel.style.transform = 'none';
      if (active) panel.style.zIndex = '2';
    });

    document.querySelectorAll('.dock-tab[data-tab]').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
      tab.style.pointerEvents = 'auto';
    });
  }

  function ensureActivePanel() {
    var active = getActivePanel();
    if (!active) {
      activatePanel('posts');
      return;
    }

    var tabName = 'posts';
    Object.keys(PANEL_MAP).forEach(function (key) {
      if (PANEL_MAP[key] === active.id) tabName = key;
    });
    activatePanel(tabName);
  }

  function unlockOverlays() {
    var preview = $('photoPreviewOverlay');
    var previewImg = $('photoPreviewImage');
    var hasPreviewImage = !!(previewImg && previewImg.getAttribute('src'));
    var previewActive = !!(preview && preview.classList.contains('active') && hasPreviewImage);

    if (!previewActive) {
      document.body.classList.remove('photo-previewing');
      if (preview) {
        preview.classList.remove('active', 'closing');
        preview.style.opacity = '0';
        preview.style.visibility = 'hidden';
        preview.style.pointerEvents = 'none';
      }
    }

    document.querySelectorAll('.modal-overlay,.img-viewer,.pp-confirm-overlay,.pp-info-modal').forEach(function (el) {
      if (!el.classList.contains('active') && !el.classList.contains('closing')) {
        el.style.pointerEvents = 'none';
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
      }
    });
  }

  function installDockClickFallback() {
    document.addEventListener('click', function (event) {
      var tab = event.target && event.target.closest ? event.target.closest('.dock-tab[data-tab]') : null;
      if (!tab) return;

      var tabName = tab.dataset.tab || 'posts';
      var nativeSwitch = window.switchDockTab;

      if (typeof nativeSwitch === 'function' && !nativeSwitch.__xtjBroken) {
        try {
          nativeSwitch(tabName);
        } catch (err) {
          nativeSwitch.__xtjBroken = true;
          console.warn('[xtj emergency] native switchDockTab failed, using fallback.', err);
          activatePanel(tabName);
        }
      } else {
        activatePanel(tabName);
      }

      setTimeout(function () {
        forceLayout();
        ensureActivePanel();
        unlockOverlays();
      }, 30);
    }, true);
  }

  function installProfileBridge() {
    window.syncProfileUser = window.syncProfileUser || function () {
      var user = window.currentUser || '';
      var name = $('profileName');
      var status = $('profileStatus');
      var avatar = $('profileAvatar');
      if (name) name.textContent = user || '未登录';
      if (status) status.textContent = user ? '查看资料' : '点击登录';
      if (avatar) avatar.textContent = user ? user.charAt(0).toUpperCase() : '?';
    };

    try { window.syncProfileUser(); } catch (err) {}

    document.addEventListener('change', function (event) {
      if (!event.target) return;
      if (event.target.id === 'profileThemeToggle') {
        var themeBtn = $('themeToggle');
        if (themeBtn) themeBtn.click();
      }
      if (event.target.id === 'profileNotifToggle') {
        try { localStorage.setItem('xtj-notif', event.target.checked ? 'on' : 'off'); } catch (err) {}
      }
    });
  }

  function showEmergencyMessageIfEmpty() {
    var app = document.querySelector('.app-container');
    if (app) return;

    var box = document.createElement('div');
    box.className = 'xtj-emergency-message';
    box.textContent = '页面结构加载失败，但应急脚本已启动。请刷新页面，或检查 index.html 是否被截断。';
    document.body.appendChild(box);
  }

  function runRecovery() {
    injectEmergencyStyle();
    forceLayout();
    ensureActivePanel();
    unlockOverlays();
    showEmergencyMessageIfEmpty();
  }

  function boot() {
    runRecovery();
    installDockClickFallback();
    installProfileBridge();

    window.addEventListener('error', function (event) {
      console.warn('[xtj emergency] runtime error:', event.message, event.filename, event.lineno);
      runRecovery();
    });

    window.addEventListener('unhandledrejection', function (event) {
      console.warn('[xtj emergency] promise rejection:', event.reason);
      runRecovery();
    });

    var count = 0;
    var timer = setInterval(function () {
      count += 1;
      runRecovery();
      if (count >= 10) clearInterval(timer);
    }, 400);
  }

  ready(boot);
})();
