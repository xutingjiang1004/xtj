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
    syncChatInspector();
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

  function getChatInspector(container) {
    var inspector = document.getElementById('desktopChatInspector');
    if (inspector || !container) return inspector;
    inspector = document.createElement('aside');
    inspector.id = 'desktopChatInspector';
    inspector.className = 'desktop-chat-inspector';
    inspector.setAttribute('aria-label', '会话资料');
    inspector.hidden = true;
    var kicker = document.createElement('small');
    kicker.className = 'desktop-chat-inspector__kicker';
    kicker.textContent = '会话资料';
    var avatar = document.createElement('span');
    avatar.className = 'desktop-chat-inspector__avatar';
    var name = document.createElement('b');
    name.className = 'desktop-chat-inspector__name';
    var status = document.createElement('span');
    status.className = 'desktop-chat-inspector__status';
    inspector.appendChild(kicker);
    inspector.appendChild(avatar);
    inspector.appendChild(name);
    inspector.appendChild(status);
    container.appendChild(inspector);
    return inspector;
  }

  function syncChatInspector() {
    var container = document.getElementById('dockChatContainer');
    var inspector = getChatInspector(container);
    if (!inspector) return;
    var isDesktop = false;
    try { isDesktop = window.matchMedia('(min-width: 1280px) and (hover: hover) and (pointer: fine)').matches; } catch (_) {}
    inspector.hidden = !isDesktop;
    if (!isDesktop) return;
    var name = inspector.querySelector('.desktop-chat-inspector__name');
    var status = inspector.querySelector('.desktop-chat-inspector__status');
    var avatar = inspector.querySelector('.desktop-chat-inspector__avatar');
    var activeUser = window.dockChatActiveUser ? String(window.dockChatActiveUser) : '';
    if (!activeUser) {
      name.textContent = '选择一个会话';
      status.textContent = '当前未打开私聊';
      avatar.textContent = '?';
      return;
    }
    name.textContent = activeUser;
    status.textContent = '当前私聊对象';
    avatar.textContent = activeUser.slice(0, 1).toUpperCase();
  }

  function syncContacts() {
    var target = document.getElementById('desktopContactsPreview');
    if (!target) return;
    target.replaceChildren();

    if (!window.currentUser) {
      var authEmpty = document.createElement('span');
      authEmpty.className = 'desktop-contacts-empty';
      authEmpty.textContent = '鐧诲綍鍚庢樉绀烘渶杩戣仈绯讳汉';
      target.appendChild(authEmpty);
      return;
    }

    var rows = Array.prototype.slice.call(document.querySelectorAll('#dockChatList .chat-list-item[data-chat-user]'), 0, 4);
    if (!rows.length) {
      var empty = document.createElement('span');
      empty.className = 'desktop-contacts-empty';
      empty.textContent = '鏆傛棤鏈€杩戣仈绯讳汉';
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
    var chatTitle = document.getElementById('dockChatTitle');
    if (chatTitle && window.MutationObserver) {
      new MutationObserver(syncChatInspector).observe(chatTitle, { childList: true, characterData: true, subtree: true });
    }
    var chatDetail = document.getElementById('dockChatDetailView');
    if (chatDetail && window.MutationObserver) {
      new MutationObserver(syncChatInspector).observe(chatDetail, { attributes: true, attributeFilter: ['class', 'style'] });
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
    syncChatInspector();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
