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
      targetAvatar.className = sourceAvatar.className + ' desktop-workbench-avatar';
      targetAvatar.style.backgroundImage = sourceAvatar.style.backgroundImage || '';
      targetAvatar.replaceChildren();

      Array.prototype.forEach.call(sourceAvatar.childNodes, function (node) {
        targetAvatar.appendChild(node.cloneNode(true));
      });

      var targetImage = targetAvatar.querySelector('img');
      if (targetImage) {
        targetImage.removeAttribute('id');
        targetImage.addEventListener('error', function () {
          targetAvatar.textContent = loggedIn && String(window.currentUser)
            ? String(window.currentUser).slice(0, 1).toUpperCase()
            : '?';
        }, { once: true });
      } else if (!targetAvatar.textContent.trim() && !targetAvatar.style.backgroundImage) {
        targetAvatar.textContent = loggedIn && String(window.currentUser)
          ? String(window.currentUser).slice(0, 1).toUpperCase()
          : '?';
      }
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

  // ★ 双击刷新：每个导航项的 in-flight lock
  var _refreshLocks = {};

  function refreshTab(tab) {
    if (_refreshLocks[tab]) return; // 防止重复刷新
    _refreshLocks[tab] = true;
    try {
      if (typeof window.showToast === 'function') window.showToast('正在刷新…', 'info');
    } catch (e) {}

    switch (tab) {
      case 'posts':
        // 帖子：强制重新请求首屏帖子，刷新评论和点赞关系
        try {
          if (typeof window.loadFeed === 'function') {
            window.loadFeed(true).catch(function() {}).finally(function() { _refreshLocks[tab] = false; });
          } else { _refreshLocks[tab] = false; }
        } catch (e) { _refreshLocks[tab] = false; }
        break;

      case 'chat':
        // 聊天：刷新联系人列表、未读数、当前聊天记录
        try {
          if (typeof window.updateUnreadBadge === 'function') {
            window.updateUnreadBadge().catch(function() {});
          }
          if (typeof window.startDMPolling === 'function') {
            window.startDMPolling(300000, false);
          }
          // 如果已打开某个联系人，刷新当前聊天记录
          if (typeof window.dockChatActiveUser !== 'undefined' && window.dockChatActiveUser) {
            if (typeof window.loadDockChatMessages === 'function') {
              window.loadDockChatMessages(window.dockChatActiveUser, false).catch(function() {});
            }
          }
          syncContacts();
          syncChatBadge();
        } catch (e) {} finally { _refreshLocks[tab] = false; }
        break;

      case 'ai':
        // 小猫 AI：保持当前会话内容，刷新会话列表、配置和历史
        try {
          if (typeof window.__xtjRefreshAiSession === 'function') {
            window.__xtjRefreshAiSession().catch(function() {});
          }
          if (typeof window.__xtjRefreshAiConfig === 'function') {
            window.__xtjRefreshAiConfig().catch(function() {});
          }
        } catch (e) {} finally { _refreshLocks[tab] = false; }
        break;

      case 'photos':
        // 照片墙：调用受控的强制同步，刷新照片数据，重新连接 Realtime
        try {
          if (typeof window.__xtjPhotoWallForceSync === 'function') {
            window.__xtjPhotoWallForceSync().catch(function() {}).finally(function() { _refreshLocks[tab] = false; });
          } else { _refreshLocks[tab] = false; }
        } catch (e) { _refreshLocks[tab] = false; }
        break;

      case 'profile':
        // 我的：刷新用户资料、头像、点赞、评论、帖子和举报统计
        try {
          if (typeof window.loadCurrentUserInfoSnapshot === 'function' && window.currentUser) {
            window.loadCurrentUserInfoSnapshot(window.currentUser).catch(function() {});
          }
          if (typeof window.renderProfileActivity === 'function') {
            window.renderProfileActivity();
          }
          syncUser();
        } catch (e) {} finally { _refreshLocks[tab] = false; }
        break;

      default:
        _refreshLocks[tab] = false;
        break;
    }
  }

  function init() {
    // ★ 双击刷新处理
    document.addEventListener('dblclick', function (event) {
      var tabButton = event.target.closest('[data-desktop-tab]');
      if (tabButton) {
        event.preventDefault();
        var tab = tabButton.getAttribute('data-desktop-tab');
        // 只有当前激活的 tab 才响应双击刷新
        if (tabButton.classList.contains('is-active')) {
          refreshTab(tab);
        }
        return;
      }
      var actionButton = event.target.closest('[data-desktop-action="ai-chat"]');
      if (actionButton && actionButton.classList.contains('is-active')) {
        event.preventDefault();
        refreshTab('ai');
      }
    });

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
