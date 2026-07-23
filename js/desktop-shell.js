(function () {
  'use strict';

  if (window.__xtjDesktopShellBound) return;
  window.__xtjDesktopShellBound = true;

  function openTab(tab) {
    var aiPanel = document.getElementById('panelAiChat');
    var aiVisible = !!(aiPanel && aiPanel.classList.contains('active') && !aiPanel.classList.contains('hidden'));
    if ((window.__xtjAiChatActive || aiVisible) && typeof window.__xtjCloseAiChat === 'function') {
      window.__xtjCloseAiChat();
    }
    if (typeof window.switchDockTab === 'function') {
      window.switchDockTab(tab, true, { animate: true, source: 'desktop-sidebar' });
    }
  }

  function openAiChat() {
    if (typeof window.__xtjOpenAiChat === 'function') {
      return window.__xtjOpenAiChat();
    }
    var fallback = document.querySelector('[data-ai-tool="chat"]');
    if (fallback) fallback.click();
  }

  function syncActiveTab() {
    var aiPanel = document.getElementById('panelAiChat');
    var aiActive = !!(aiPanel && aiPanel.classList.contains('active') && !aiPanel.classList.contains('hidden'));
    var activePanel = document.querySelector('.dock-panel.active');
    var tab = activePanel && activePanel.id ? activePanel.id.replace(/^panel/, '').toLowerCase() : 'posts';
    document.querySelectorAll('.desktop-nav-item').forEach(function (button) {
      var active = aiActive
        ? button.getAttribute('data-desktop-action') === 'ai-chat'
        : button.getAttribute('data-desktop-tab') === tab;
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
    syncContacts();
  }

  function syncChatBadge() {
    var source = document.getElementById('navChatBadge');
    var target = document.getElementById('desktopChatBadge');
    if (!source || !target) return;
    target.textContent = source.textContent || '';
    target.hidden = !target.textContent.trim() || source.style.display === 'none';
  }

  function syncContacts() {
    var target = document.getElementById('desktopContactsPreview');
    if (!target) return;
    target.replaceChildren();

    if (!window.currentUser) {
      var authEmpty = document.createElement('span');
      authEmpty.className = 'desktop-contacts-empty';
      authEmpty.textContent = '登录后显示最近联系人';
      target.appendChild(authEmpty);
      return;
    }

    var rows = Array.prototype.slice.call(document.querySelectorAll('#dockChatList .chat-list-item[data-chat-user]'), 0, 4);
    if (!rows.length) {
      var empty = document.createElement('span');
      empty.className = 'desktop-contacts-empty';
      empty.textContent = '暂无最近联系人';
      target.appendChild(empty);
      return;
    }

    rows.forEach(function (row) {
      var userName = row.getAttribute('data-chat-user') || '';
      if (!userName) return;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'desktop-contact-preview';
      item.setAttribute('aria-label', '与 ' + userName + ' 聊天');

      var avatar = document.createElement('span');
      avatar.className = 'desktop-contact-preview__avatar';
      var sourceAvatar = row.querySelector('.cli-avatar');
      var sourceImage = sourceAvatar && sourceAvatar.querySelector('img');
      var sourceUrl = sourceImage && (sourceImage.currentSrc || sourceImage.getAttribute('src') || '');
      var safeUrl = '';
      if (sourceUrl) {
        try {
          var parsedUrl = new URL(sourceUrl, document.baseURI);
          if (['http:', 'https:', 'data:', 'blob:'].indexOf(parsedUrl.protocol) >= 0) safeUrl = parsedUrl.href;
        } catch (_) {}
      }
      if (safeUrl) {
        var image = document.createElement('img');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = '';
        image.src = safeUrl;
        image.addEventListener('error', function () {
          image.remove();
          avatar.textContent = userName.slice(0, 1).toUpperCase();
        }, { once: true });
        avatar.appendChild(image);
      } else {
        avatar.textContent = userName.slice(0, 1).toUpperCase();
      }

      var copy = document.createElement('span');
      copy.className = 'desktop-contact-preview__copy';
      var name = document.createElement('b');
      name.className = 'desktop-contact-preview__name';
      name.textContent = userName;
      var preview = document.createElement('small');
      preview.className = 'desktop-contact-preview__preview';
      preview.textContent = (row.querySelector('.cli-preview') || {}).textContent || '暂无消息';
      copy.appendChild(name);
      copy.appendChild(preview);
      item.appendChild(avatar);
      item.appendChild(copy);

      var badge = row.querySelector('.cli-badge');
      if (badge && badge.textContent.trim()) {
        var badgeEl = document.createElement('span');
        badgeEl.className = 'desktop-contact-preview__badge';
        badgeEl.textContent = badge.textContent.trim();
        item.appendChild(badgeEl);
      }
      item.addEventListener('click', function () {
        if (typeof window.openChat === 'function') window.openChat(userName);
      });
      target.appendChild(item);
    });
  }

  var contactsSyncPending = false;
  function scheduleContactsSync() {
    if (contactsSyncPending) return;
    contactsSyncPending = true;
    var run = function () {
      contactsSyncPending = false;
      syncContacts();
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else window.setTimeout(run, 0);
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
        window.requestAnimationFrame(syncActiveTab);
      }
    });

    var panels = document.getElementById('dockPanels');
    if (panels && window.MutationObserver) {
      new MutationObserver(syncActiveTab).observe(panels, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    var aiPanel = document.getElementById('panelAiChat');
    if (aiPanel && window.MutationObserver) {
      new MutationObserver(syncActiveTab).observe(aiPanel, { attributes: true, attributeFilter: ['class'] });
    }
    var auth = document.querySelector('.nav-auth');
    if (auth && window.MutationObserver) {
      new MutationObserver(syncUser).observe(auth, { attributes: true, childList: true, subtree: true, characterData: true });
    }
    var badge = document.getElementById('navChatBadge');
    if (badge && window.MutationObserver) {
      new MutationObserver(syncChatBadge).observe(badge, { attributes: true, childList: true, characterData: true });
    }
    var chatList = document.getElementById('dockChatList');
    if (chatList && window.MutationObserver) {
      new MutationObserver(scheduleContactsSync).observe(chatList, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
        attributeFilter: ['data-chat-user']
      });
    }
    syncActiveTab();
    syncUser();
    syncChatBadge();
    syncContacts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
