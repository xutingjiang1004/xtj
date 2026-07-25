(function () {
  'use strict';

  if (window.__xtjDesktopShellBound) return;
  window.__xtjDesktopShellBound = true;

  function openTab(tab) {
    // When leaving Code panel, call cleanup
    var currentPanel = document.querySelector('.dock-panel.active:not(.hidden)');
    var currentIsCode = currentPanel && currentPanel.id === 'panelCode';
    if (currentIsCode && tab !== 'code' && window.__xtjCodeWorkspaceAPI && window.__xtjCodeWorkspaceAPI.cleanup) {
      // P0: increment generation to invalidate any in-flight Code module loads
      _codeLoadGeneration++;
      codeModuleState.generation++;
      // P0: check cleanup return value — cancel navigation if user declined
      if (window.__xtjCodeWorkspaceAPI.cleanup() === false) return;
    }

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

  // ★ 双击刷新：每个导航项的 Promise 锁防抖
  var _refreshLocks = {};

  function refreshTab(tab) {
    if (_refreshLocks[tab]) return _refreshLocks[tab];
    _refreshLocks[tab] = performRefresh(tab);
    return _refreshLocks[tab];
  }

  async function performRefresh(tab) {
    try {
      try {
        if (typeof window.showToast === 'function') window.showToast('正在刷新…', 'info');
      } catch (e) {}

      switch (tab) {
        case 'posts':
          if (typeof window.loadFeed === 'function') await window.loadFeed(true);
          break;

        case 'chat':
          var chatPromises = [];
          if (typeof window.updateUnreadBadge === 'function') {
            chatPromises.push(window.updateUnreadBadge().catch(function() {}));
          }
          if (typeof window.startDMPolling === 'function') {
            chatPromises.push(window.startDMPolling(300000, false));
          }
          if (typeof window.syncContacts === 'function') {
            chatPromises.push(window.syncContacts().catch(function() {}));
          }
          if (typeof window.syncChatBadge === 'function') {
            chatPromises.push(window.syncChatBadge().catch(function() {}));
          }
          if (typeof window.dockChatActiveUser !== 'undefined' && window.dockChatActiveUser) {
            if (typeof window.loadDockChatMessages === 'function') {
              chatPromises.push(window.loadDockChatMessages(window.dockChatActiveUser, false).catch(function() {}));
            }
          }
          if (chatPromises.length) await Promise.allSettled(chatPromises);
          break;

        case 'ai':
          var aiPromises = [];
          if (typeof window.__xtjRefreshAiSession === 'function') {
            aiPromises.push(window.__xtjRefreshAiSession().catch(function() {}));
          }
          if (typeof window.__xtjRefreshAiConfig === 'function') {
            aiPromises.push(window.__xtjRefreshAiConfig().catch(function() {}));
          }
          if (aiPromises.length) await Promise.allSettled(aiPromises);
          break;

        case 'photos':
          if (typeof window.__xtjPhotoWallForceSync === 'function') {
            await window.__xtjPhotoWallForceSync();
          }
          break;

        case 'profile':
          var profilePromises = [];
          if (typeof window.loadCurrentUserInfoSnapshot === 'function' && window.currentUser) {
            profilePromises.push(window.loadCurrentUserInfoSnapshot(window.currentUser).catch(function() {}));
          }
          if (typeof window.renderProfileActivity === 'function') {
            try { window.renderProfileActivity(); } catch (e) {}
          }
          if (typeof window.syncUser === 'function') {
            profilePromises.push(window.syncUser().catch(function() {}));
          }
          if (profilePromises.length) await Promise.allSettled(profilePromises);
          break;

        case 'code':
          if (typeof window.__xtjCodeRefreshWorkspace === 'function') {
            await window.__xtjCodeRefreshWorkspace();
          } else {
            _codeLoadGeneration++;
            codeModuleState.generation++;
            var gen = _codeLoadGeneration;
            try {
              await ensureCodeModulesLoaded();
              if (gen !== _codeLoadGeneration) break;
              if (typeof window.__xtjCodeInit === 'function') {
                window.__xtjCodeInit();
              }
            } catch (e) {
              if (gen !== _codeLoadGeneration) break;
              console.error('[CODE] workspace load failed:', e);
              if (typeof window.showToast === 'function') window.showToast('Code 工作区加载失败', 'error');
            }
          }
          break;

        default:
          break;
      }
    } finally {
      delete _refreshLocks[tab];
    }
  }

  
  // ── P0: Code 模块加载状态机 ──────────────────────────────
  var codeModuleState = {
    status: 'idle',   // idle | loading | ready | error
    promise: null,
    generation: 0,
    error: null
  };

  var _loadedModules = {};
  var _codeLoadGeneration = 0;

  function ensureCodeModulesLoaded() {
    if (codeModuleState.status === 'ready') {
      // 验证完整成功条件
      var panelCode = document.getElementById('panelCode');
      if (!panelCode || !panelCode.offsetParent) {
        // 页面不可见，需要重新初始化
        codeModuleState.status = 'idle';
      } else if (window.__xtjCodeFS && window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeInit === 'function') {
        return Promise.resolve();
      } else {
        // 部分模块丢失，重置状态
        codeModuleState.status = 'idle';
        codeModuleState.promise = null;
      }
    }

    if (codeModuleState.status === 'loading' && codeModuleState.promise) {
      return codeModuleState.promise;
    }

    // 创建新加载 Promise
    codeModuleState.generation++;
    var gen = codeModuleState.generation;
    codeModuleState.status = 'loading';
    codeModuleState.error = null;
    _codeLoadGeneration++;

    var panelCode = document.getElementById('panelCode');
    if (panelCode) {
      panelCode.innerHTML = '<div class="code-loading-state"><div class="loading-spinner"></div><p>正在加载 Code 工作区...</p></div>';
    }

    // 超时 Promise
    var timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error('Code 工作区加载超时，请检查网络后重试'));
      }, 10000);
    });

    var loadPromise = Promise.all([
      loadModuleScript('code-fs', 'xtj-module-code-fs'),
      loadModuleScript('code-workspace', 'xtj-module-code-workspace'),
      loadModuleStyle('code-css', 'xtj-module-code-style')
    ]);

    codeModuleState.promise = Promise.race([loadPromise, timeoutPromise])
      .then(function () {
        if (gen !== codeModuleState.generation) return;
        // 检查页面是否仍为 Code 且可见
        var pc = document.getElementById('panelCode');
        if (!pc || !pc.offsetParent) {
          // 用户已离开，不标记 ready
          codeModuleState.status = 'idle';
          codeModuleState.promise = null;
          return;
        }
        if (typeof window.__xtjCodeInit === 'function') {
          codeModuleState.status = 'ready';
          codeModuleState.promise = null;
        } else {
          throw new Error('Code init function not found');
        }
      }).catch(function (e) {
        if (gen !== codeModuleState.generation) {
          codeModuleState.status = 'idle';
          codeModuleState.promise = null;
          return;
        }
        codeModuleState.status = 'error';
        codeModuleState.error = e;
        codeModuleState.promise = null;
        console.error('[CODE-LOADER] Module load failed:', e && e.message ? e.message : String(e));
        var pc2 = document.getElementById('panelCode');
        if (pc2) {
          pc2.innerHTML = '<div class="code-loading-state"><p>Code 工作区加载失败: ' + (e && e.message ? e.message.replace(/</g, '&lt;') : '未知错误') + '</p><button class="code-retry-btn" id="codeRetryBtn">重试</button></div>';
          // 使用 addEventListener 而非内联 onclick
          var retryBtn = document.getElementById('codeRetryBtn');
          if (retryBtn) {
            retryBtn.addEventListener('click', function () {
              retryCodeModuleLoad();
            });
          }
        }
        if (typeof window.showToast === 'function') window.showToast('Code 工作区加载失败', 'error');
      });

    return codeModuleState.promise;
  }

  function retryCodeModuleLoad() {
    // 清除失败模块的缓存
    codeModuleState.status = 'idle';
    codeModuleState.promise = null;
    codeModuleState.error = null;
    codeModuleState.generation++;
    _codeLoadGeneration++;
    // 移除失败的 script/link 元素
    var failedScripts = document.querySelectorAll('script[data-xtj-code-module]');
    for (var i = 0; i < failedScripts.length; i++) {
      try { failedScripts[i].remove(); } catch (e) {}
    }
    var failedLinks = document.querySelectorAll('link[data-xtj-code-module]');
    for (var j = 0; j < failedLinks.length; j++) {
      try { failedLinks[j].remove(); } catch (e) {}
    }
    // 清除模块缓存
    _loadedModules['code-fs'] = false;
    _loadedModules['code-workspace'] = false;
    _loadedModules['code-css'] = false;
    delete window.__xtjCodeInit;
    // 重新加载
    ensureCodeModulesLoaded().then(function () {
      var gen = codeModuleState.generation;
      var pc = document.getElementById('panelCode');
      if (pc && pc.offsetParent && gen === codeModuleState.generation) {
        if (typeof window.__xtjCodeInit === 'function') {
          window.__xtjCodeInit();
        }
      }
    }).catch(function () {});
  }

  function loadModuleScript(id, metaName) {
    if (_loadedModules[id]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var meta = document.querySelector('meta[name="' + metaName + '"]');
      if (!meta || !meta.content) return reject(new Error('Missing meta ' + metaName));
      var script = document.createElement('script');
      script.src = meta.content;
      script.setAttribute('data-xtj-code-module', id);
      console.log('[CODE-LOADER] Loading script:', meta.content);
      script.onload = function () {
        _loadedModules[id] = true;
        console.log('[CODE-LOADER] Script loaded:', meta.content);
        resolve();
      };
      script.onerror = function () {
        console.error('[CODE-LOADER] Script failed:', meta.content);
        reject(new Error('Failed to load ' + meta.content));
      };
      document.body.appendChild(script);
    });
  }

  function loadModuleStyle(id, metaName) {
    if (_loadedModules[id]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var meta = document.querySelector('meta[name="' + metaName + '"]');
      if (!meta || !meta.content) return reject(new Error('Missing meta ' + metaName));
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = meta.content;
      link.setAttribute('data-xtj-code-module', id);
      console.log('[CODE-LOADER] Loading CSS:', meta.content);
      link.onload = function () {
        _loadedModules[id] = true;
        console.log('[CODE-LOADER] CSS loaded:', meta.content);
        resolve();
      };
      link.onerror = function () {
        console.error('[CODE-LOADER] CSS failed:', meta.content);
        reject(new Error('Failed to load ' + meta.content));
      };
      document.head.appendChild(link);
    });
  }

  function init() {
    // ★ 双击刷新处理
    document.addEventListener('dblclick', function (event) {
      var tabButton = event.target.closest('[data-desktop-tab]');
      if (tabButton) {
        event.preventDefault();
        var tab = tabButton.getAttribute('data-desktop-tab');
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
        var tab = tabButton.getAttribute('data-desktop-tab');
        if (tab === 'code') {
          // P0: 使用状态机管理模块加载
          var gen = _codeLoadGeneration;
          ensureCodeModulesLoaded().then(function () {
            if (gen !== _codeLoadGeneration) return;
            var pc = document.getElementById('panelCode');
            if (!pc || !pc.offsetParent) return;
            // P0: 即使 __xtjCodeInit 已存在，也检查 workspace 是否已激活
            if (typeof window.__xtjCodeInit === 'function') {
              var codeState = window.__xtjCodeWorkspaceAPI && window.__xtjCodeWorkspaceAPI.getState ? window.__xtjCodeWorkspaceAPI.getState() : null;
              if (!codeState || !codeState.active) {
                window.__xtjCodeInit();
              }
            }
          }).catch(function () {
            // 错误已在 ensureCodeModulesLoaded 中处理
          });
        }
        openTab(tab);
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