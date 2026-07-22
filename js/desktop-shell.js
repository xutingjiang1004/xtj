(function () {
  'use strict';

  if (window.__xtjDesktopShellBound) return;
  window.__xtjDesktopShellBound = true;

  function openTab(tab) {
    if (typeof window.switchDockTab === 'function') {
      window.switchDockTab(tab, true, { animate: true, source: 'desktop-sidebar' });
    }
  }

  function openAiChat() {
    if (typeof window.__xtjOpenAiChat === 'function') {
      window.__xtjOpenAiChat();
      return;
    }
    var fallback = document.querySelector('[data-ai-tool="chat"]');
    if (fallback) fallback.click();
  }

  function syncActiveTab() {
    var activePanel = document.querySelector('.dock-panel.active');
    var tab = activePanel && activePanel.id ? activePanel.id.replace(/^panel/, '').toLowerCase() : 'posts';
    document.querySelectorAll('[data-desktop-tab]').forEach(function (button) {
      var active = button.getAttribute('data-desktop-tab') === tab;
      button.classList.toggle('is-active', active);
      if (button.classList.contains('desktop-nav-item')) {
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    });
  }

  function syncUser() {
    var sourceAvatar = document.getElementById('myAvatar');
    var sourceName = document.getElementById('myName');
    var targetAvatar = document.getElementById('desktopWorkbenchAvatar');
    var targetName = document.getElementById('desktopWorkbenchName');
    var targetStatus = document.getElementById('desktopWorkbenchStatus');
    if (!targetAvatar || !targetName || !targetStatus) return;

    var loggedIn = !!window.currentUser;
    targetName.textContent = loggedIn ? ((sourceName && sourceName.textContent.trim()) || String(window.currentUser)) : '未登录';
    targetStatus.textContent = loggedIn ? '欢迎回来' : '登录后同步个人信息';
    if (sourceAvatar) {
      targetAvatar.textContent = sourceAvatar.textContent || '?';
      targetAvatar.style.backgroundImage = sourceAvatar.style.backgroundImage || '';
      targetAvatar.className = sourceAvatar.className + ' desktop-workbench-avatar';
    }
  }

  function syncChatBadge() {
    var source = document.getElementById('navChatBadge');
    var target = document.getElementById('desktopChatBadge');
    if (!source || !target) return;
    target.textContent = source.textContent || '';
    target.hidden = !target.textContent.trim() || source.style.display === 'none';
  }

  function init() {
    document.addEventListener('click', function (event) {
      var tabButton = event.target.closest('[data-desktop-tab]');
      if (tabButton) {
        event.preventDefault();
        openTab(tabButton.getAttribute('data-desktop-tab'));
        window.requestAnimationFrame(syncActiveTab);
        return;
      }
      var actionButton = event.target.closest('[data-desktop-action="ai-chat"]');
      if (actionButton) {
        event.preventDefault();
        openAiChat();
      }
    });

    var panels = document.getElementById('dockPanels');
    if (panels && window.MutationObserver) {
      new MutationObserver(syncActiveTab).observe(panels, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    var auth = document.querySelector('.nav-auth');
    if (auth && window.MutationObserver) {
      new MutationObserver(syncUser).observe(auth, { attributes: true, childList: true, subtree: true, characterData: true });
    }
    var badge = document.getElementById('navChatBadge');
    if (badge && window.MutationObserver) {
      new MutationObserver(syncChatBadge).observe(badge, { attributes: true, childList: true, characterData: true });
    }
    syncActiveTab();
    syncUser();
    syncChatBadge();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
