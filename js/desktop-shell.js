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
    // P0: 跟踪当前 tab 用于 Code 模块可见性判断
    codeModuleState.currentTab = tab;
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
            // P0: 不预保存 generation — ensureCodeModulesLoaded 内部管理自己的 generation
            try {
              await ensureCodeModulesLoaded();
              if (!isCodePanelVisible()) break;
              recoverCodeInitAlias();
              if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function') {
                window.__xtjCodeWorkspaceAPI.init();
              }
            } catch (e) {
              console.error('[CODE] workspace load failed:', e);
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
    error: null,
    errorShownGeneration: -1,  // 防止同一 generation 重复显示错误
    // P0: 每个模块独立状态
    modules: {
      'code-fs':      { status: 'idle', url: '', startTime: 0 },
      'code-workspace': { status: 'idle', url: '', startTime: 0 },
      'code-css':     { status: 'idle', url: '', startTime: 0 }
    },
    // P0: 当前 active tab 用于可靠的可见性判断
    currentTab: 'posts'
  };

  var _loadedModules = {};
  var _pendingModulePromises = {};  // P0: 防止重复加载同一个模块
  var _codeErrorListenerInstalled = false;

  // P0: 安装全局错误监听器，捕获 Code 模块脚本执行错误
  function _installCodeErrorListeners() {
    if (_codeErrorListenerInstalled) return;
    _codeErrorListenerInstalled = true;

    window.addEventListener('error', function (event) {
      var filename = event.filename || '';
      var message = event.message || '';
      if (filename.indexOf('code-file-system') !== -1 ||
          filename.indexOf('code-workspace') !== -1 ||
          message.indexOf('__xtjCode') !== -1) {
        console.error('[CODE-LOADER] Script error caught:');
        console.error('  Module: ' + (filename.indexOf('code-file-system') !== -1 ? 'code-fs' : 'code-workspace'));
        console.error('  URL: ' + filename);
        console.error('  Error: ' + message + ' at ' + (event.lineno || '?') + ':' + (event.colno || '?'));
        if (event.error && event.error.stack) {
          console.error('  Stack: ' + event.error.stack);
        }
      }
    }, true);

    window.addEventListener('unhandledrejection', function (event) {
      var reason = event.reason;
      var msg = reason && reason.message ? reason.message : String(reason || '');
      if (msg.indexOf('code-fs') !== -1 ||
          msg.indexOf('code-workspace') !== -1 ||
          msg.indexOf('code-css') !== -1 ||
          msg.indexOf('Code') !== -1) {
        console.error('[CODE-LOADER] Unhandled rejection:');
        console.error('  Message: ' + msg);
        if (reason && reason.stack) {
          console.error('  Stack: ' + reason.stack);
        }
      }
    });
  }

  function ensureCodeModulesLoaded() {
    // P0: 确保错误监听器已安装（兜底）
    _installCodeErrorListeners();

    // P0: 检查 ready 状态时验证完整成功条件
    if (codeModuleState.status === 'ready') {
      if (!isCodePanelVisible()) {
        codeModuleState.status = 'idle';
        codeModuleState.promise = null;
      } else if (verifyModule('code-fs') && verifyModule('code-workspace') && verifyModule('code-css') && typeof window.__xtjCodeInit === 'function') {
        return Promise.resolve();
      } else {
        // 部分模块丢失或损坏，重置状态
        codeModuleState.status = 'idle';
        codeModuleState.promise = null;
      }
    }

    // P0: 检查损坏状态 — 脚本已执行但 API 不完整
    if (window.__xtjCodeWorkspace === true && (!window.__xtjCodeWorkspaceAPI || typeof window.__xtjCodeWorkspaceAPI.init !== 'function')) {
      codeModuleState.status = 'error';
      codeModuleState.error = new Error('Code 工作区脚本初始化不完整，请刷新页面后重试');
      codeModuleState.promise = null;
      renderErrorPage('Code 工作区脚本初始化不完整，请刷新页面后重试', true);
      return Promise.reject(codeModuleState.error);
    }

    if (codeModuleState.status === 'loading' && codeModuleState.promise) {
      return codeModuleState.promise;
    }

    // 创建新加载 Promise
    codeModuleState.generation++;
    var gen = codeModuleState.generation;
    codeModuleState.status = 'loading';
    codeModuleState.error = null;

    var panelCode = document.getElementById('panelCode');
    if (panelCode) {
      panelCode.innerHTML = '<div class="code-loading-state"><div class="loading-spinner"></div><p>正在加载 Code 工作区...</p></div>';
    }

    var loadStartTime = Date.now();
    var MODULE_TIMEOUT_MS = 15000;  // P0: 每个模块 15 秒超时

    // P0: 每个模块独立加载 + 独立超时 + 详细错误
    function loadModuleWithTimeout(id, metaName, loaderFn) {
      var mod = codeModuleState.modules[id];
      mod.status = 'loading';
      mod.startTime = Date.now();
      var meta = document.querySelector('meta[name="' + metaName + '"]');
      mod.url = (meta && meta.content) ? meta.content : '(meta not found)';

      return new Promise(function (resolve, reject) {
        var timeoutId = setTimeout(function () {
          var elapsed = Date.now() - mod.startTime;
          var detail = [
            'Code 工作区加载超时',
            '模块: ' + id,
            'URL: ' + mod.url,
            'script loaded: ' + (_loadedModules[id] === true),
            'API exported: ' + verifyModule(id),
            '已等待: ' + (elapsed / 1000).toFixed(1) + ' 秒'
          ];
          mod.status = 'timeout';
          reject(new Error(detail.join('\n')));
        }, MODULE_TIMEOUT_MS);

        loaderFn().then(function () {
          clearTimeout(timeoutId);
          mod.status = 'loaded';
          resolve();
        }).catch(function (e) {
          clearTimeout(timeoutId);
          mod.status = 'error';
          reject(e);
        });
      });
    }

    var loadPromise = Promise.all([
      loadModuleWithTimeout('code-fs', 'xtj-module-code-fs', function () {
        return loadModuleScript('code-fs', 'xtj-module-code-fs');
      }),
      loadModuleWithTimeout('code-workspace', 'xtj-module-code-workspace', function () {
        return loadModuleScript('code-workspace', 'xtj-module-code-workspace');
      }),
      loadModuleWithTimeout('code-css', 'xtj-module-code-style', function () {
        return loadModuleStyle('code-css', 'xtj-module-code-style');
      })
    ]);

    codeModuleState.promise = loadPromise
      .then(function () {
        if (gen !== codeModuleState.generation) return;
        if (!isCodePanelVisible()) {
          codeModuleState.status = 'idle';
          codeModuleState.promise = null;
          return;
        }
        // P0: recover init alias before checking
        recoverCodeInitAlias();
        if (typeof window.__xtjCodeInit === 'function') {
          codeModuleState.status = 'ready';
          codeModuleState.promise = null;
          console.log('[CODE-LOADER] All modules loaded successfully in ' + (Date.now() - loadStartTime) + 'ms');
        } else {
          throw new Error('Code init function not found');
        }
      }).catch(function (e) {
        if (gen !== codeModuleState.generation) {
          codeModuleState.status = 'idle';
          codeModuleState.promise = null;
          return Promise.reject(e);
        }
        codeModuleState.status = 'error';
        codeModuleState.error = e;
        codeModuleState.promise = null;
        console.error('[CODE-LOADER] Module load failed:', e && e.message ? e.message : String(e));
        // P0: 显示详细错误信息
        var errMsg = e && e.message ? e.message : '未知错误';
        renderErrorPage(errMsg, false);
        if (codeModuleState.errorShownGeneration !== gen) {
          codeModuleState.errorShownGeneration = gen;
          if (typeof window.showToast === 'function') window.showToast('Code 工作区加载失败', 'error');
        }
        return Promise.reject(e);
      });

    return codeModuleState.promise;
  }

  // P0: 从 __xtjCodeWorkspaceAPI.init 恢复 __xtjCodeInit 别名
  function recoverCodeInitAlias() {
    if (
      typeof window.__xtjCodeInit !== 'function' &&
      window.__xtjCodeWorkspaceAPI &&
      typeof window.__xtjCodeWorkspaceAPI.init === 'function'
    ) {
      window.__xtjCodeInit = window.__xtjCodeWorkspaceAPI.init;
      console.log('[CODE-LOADER] Recovered __xtjCodeInit from __xtjCodeWorkspaceAPI.init');
    }
    return typeof window.__xtjCodeInit === 'function';
  }

  // P0: 检查 Code 面板是否可见
  function isCodePanelVisible() {
    var pc = document.getElementById('panelCode');
    if (!pc) return false;
    // P0: 双重检查 — offsetParent 和 active tab 状态
    if (pc.offsetParent) return true;
    if (codeModuleState.currentTab === 'code' && pc.classList.contains('active') && !pc.classList.contains('hidden')) return true;
    return false;
  }

  // P0: 渲染错误页面
  function renderErrorPage(message, showRefresh) {
    var pc = document.getElementById('panelCode');
    if (!pc) return;
    var escapedMsg = String(message || '未知错误').replace(/</g, '&lt;');
    var html = '<div class="code-loading-state"><p>Code 工作区加载失败: ' + escapedMsg + '</p>';
    if (showRefresh) {
      html += '<button class="code-retry-btn" id="codeRefreshBtn">刷新页面</button>';
    } else {
      html += '<button class="code-retry-btn" id="codeRetryBtn">重试</button>';
    }
    html += '</div>';
    pc.innerHTML = html;
    if (showRefresh) {
      var refreshBtn = document.getElementById('codeRefreshBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
          window.location.reload();
        });
      }
    } else {
      var retryBtn = document.getElementById('codeRetryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          retryCodeModuleLoad();
        });
      }
    }
  }

  function retryCodeModuleLoad() {
    // P0: 不要删除 __xtjCodeInit — 如果 API 已存在，从 API 恢复别名
    // P0: 只重试失败的模块，不删除已成功的

    // 确定哪些模块失败
    var failedModules = [];
    if (!verifyModule('code-fs')) failedModules.push('code-fs');
    if (!verifyModule('code-workspace')) failedModules.push('code-workspace');
    if (!verifyModule('code-css')) failedModules.push('code-css');

    // 如果所有模块都成功了，只需要恢复 init 别名并调用 init
    if (failedModules.length === 0) {
      recoverCodeInitAlias();
      if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function') {
        window.__xtjCodeWorkspaceAPI.init();
      }
      return;
    }

    // 只移除失败模块的 DOM 元素
    var allScripts = document.querySelectorAll('script[data-xtj-code-module]');
    for (var i = 0; i < allScripts.length; i++) {
      var id = allScripts[i].getAttribute('data-xtj-code-module');
      if (failedModules.indexOf(id) !== -1) {
        try { allScripts[i].remove(); } catch (e) {}
      }
    }
    var allLinks = document.querySelectorAll('link[data-xtj-code-module]');
    for (var j = 0; j < allLinks.length; j++) {
      var lid = allLinks[j].getAttribute('data-xtj-code-module');
      if (failedModules.indexOf(lid) !== -1) {
        try { allLinks[j].remove(); } catch (e) {}
      }
    }

    // 只清除失败模块的缓存
    for (var k = 0; k < failedModules.length; k++) {
      _loadedModules[failedModules[k]] = false;
      // P0: 清除 pending promise，允许重新加载
      delete _pendingModulePromises[failedModules[k]];
    }

    // 重置状态（不递增 generation，ensureCodeModulesLoaded 内部会递增）
    codeModuleState.status = 'idle';
    codeModuleState.promise = null;
    codeModuleState.error = null;

    // 重新加载
    ensureCodeModulesLoaded().then(function () {
      if (!isCodePanelVisible()) return;
      recoverCodeInitAlias();
      if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function') {
        window.__xtjCodeWorkspaceAPI.init();
      }
    }).catch(function () {});
  }

  function loadModuleScript(id, metaName) {
    // P0: 如果已加载且验证通过，直接返回
    if (_loadedModules[id] && verifyModule(id)) return Promise.resolve();

    // P0: 如果正在加载，复用同一个 Promise
    if (_pendingModulePromises[id]) return _pendingModulePromises[id];

    // P0: 检查页面中是否已存在相同 ID 的 script
    var existingScripts = document.querySelectorAll('script[data-xtj-code-module="' + id + '"]');
    for (var i = 0; i < existingScripts.length; i++) {
      var existing = existingScripts[i];
      if (existing.getAttribute('data-xtj-loaded') === 'true') {
        if (verifyModule(id)) {
          _loadedModules[id] = true;
          return Promise.resolve();
        }
        // API 丢失，移除后重新加载
        try { existing.remove(); } catch (e) {}
        _loadedModules[id] = false;
      } else if (existing.getAttribute('data-xtj-loading') === 'true') {
        // 正在加载中，等待已有的 Promise
        if (_pendingModulePromises[id]) return _pendingModulePromises[id];
      } else {
        // 未知状态，移除旧脚本
        try { existing.remove(); } catch (e) {}
        _loadedModules[id] = false;
      }
    }

    var promise = new Promise(function (resolve, reject) {
      var meta = document.querySelector('meta[name="' + metaName + '"]');
      if (!meta || !meta.content) {
        delete _pendingModulePromises[id];
        return reject(new Error('Missing meta ' + metaName));
      }
      var script = document.createElement('script');
      script.src = meta.content;
      script.setAttribute('data-xtj-code-module', id);
      script.setAttribute('data-xtj-loading', 'true');
      console.log('[CODE-LOADER] Loading script:', meta.content);
      script.onload = function () {
        script.setAttribute('data-xtj-loaded', 'true');
        script.removeAttribute('data-xtj-loading');
        console.log('[CODE-LOADER] Script loaded:', meta.content);
        // P0: script.onload 不等于脚本成功导出 API，验证后再 resolve
        if (verifyModule(id)) {
          _loadedModules[id] = true;
          delete _pendingModulePromises[id];
          resolve();
        } else {
          console.warn('[CODE-LOADER] Script loaded but module not verified:', id);
          // 脚本已下载但未正确导出 — 标记为失败
          _loadedModules[id] = false;
          delete _pendingModulePromises[id];
          reject(new Error('Module ' + id + ' loaded but API not available'));
        }
      };
      script.onerror = function () {
        console.error('[CODE-LOADER] Script failed:', meta.content);
        script.removeAttribute('data-xtj-loading');
        _loadedModules[id] = false;
        delete _pendingModulePromises[id];
        reject(new Error('Failed to load ' + meta.content));
      };
      document.body.appendChild(script);
    });

    _pendingModulePromises[id] = promise;
    return promise;
  }

  function loadModuleStyle(id, metaName) {
    // P0: 如果已加载且验证通过，直接返回
    if (_loadedModules[id] && verifyModule(id)) return Promise.resolve();

    // P0: 如果正在加载，复用同一个 Promise
    if (_pendingModulePromises[id]) return _pendingModulePromises[id];

    // P0: 检查页面中是否已存在相同 ID 的 link
    var existingLinks = document.querySelectorAll('link[data-xtj-code-module="' + id + '"]');
    for (var i = 0; i < existingLinks.length; i++) {
      var existing = existingLinks[i];
      if (existing.getAttribute('data-xtj-loaded') === 'true') {
        if (verifyModule(id)) {
          _loadedModules[id] = true;
          return Promise.resolve();
        }
        try { existing.remove(); } catch (e) {}
        _loadedModules[id] = false;
      } else if (existing.getAttribute('data-xtj-loading') === 'true') {
        if (_pendingModulePromises[id]) return _pendingModulePromises[id];
      } else {
        try { existing.remove(); } catch (e) {}
        _loadedModules[id] = false;
      }
    }

    var promise = new Promise(function (resolve, reject) {
      var meta = document.querySelector('meta[name="' + metaName + '"]');
      if (!meta || !meta.content) {
        delete _pendingModulePromises[id];
        return reject(new Error('Missing meta ' + metaName));
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = meta.content;
      link.setAttribute('data-xtj-code-module', id);
      link.setAttribute('data-xtj-loading', 'true');
      console.log('[CODE-LOADER] Loading CSS:', meta.content);
      link.onload = function () {
        link.setAttribute('data-xtj-loaded', 'true');
        link.removeAttribute('data-xtj-loading');
        _loadedModules[id] = true;
        console.log('[CODE-LOADER] CSS loaded:', meta.content);
        delete _pendingModulePromises[id];
        resolve();
      };
      link.onerror = function () {
        console.error('[CODE-LOADER] CSS failed:', meta.content);
        link.removeAttribute('data-xtj-loading');
        _loadedModules[id] = false;
        delete _pendingModulePromises[id];
        reject(new Error('Failed to load ' + meta.content));
      };
      document.head.appendChild(link);
    });

    _pendingModulePromises[id] = promise;
    return promise;
  }

  // P0: 验证模块是否真正可用（不只是 script.onload 触发）
  function verifyModule(id) {
    if (id === 'code-fs') {
      return !!(window.__xtjCodeFS && typeof window.__xtjCodeFS.readFileByPath === 'function');
    }
    if (id === 'code-workspace') {
      return !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function');
    }
    if (id === 'code-css') {
      // P0: 多维度验证 CSS 加载
      // 1. 检查 link 元素
      var links = document.querySelectorAll('link[data-xtj-code-module="code-css"]');
      for (var i = 0; i < links.length; i++) {
        if (links[i].sheet) return true;
        if (links[i].getAttribute('data-xtj-loaded') === 'true') return true;
      }
      // 2. 检查 document.styleSheets 中的 Code 样式 (跨浏览器兼容)
      try {
        var sheets = document.styleSheets;
        for (var j = 0; j < sheets.length; j++) {
          var href = sheets[j].href || '';
          if (href.indexOf('code-workspace') !== -1) return true;
        }
      } catch (e) {}
      // 3. 检查 CSS 探针 — 特定 Code 样式是否生效
      try {
        var probe = document.querySelector('.code-welcome');
        if (probe) {
          var style = window.getComputedStyle(probe);
          if (style && style.display !== 'none') return true;
        }
      } catch (e) {}
      return _loadedModules[id] === true;
    }
    return !!_loadedModules[id];
  }

  function init() {
    // P0: 安装全局错误监听器
    _installCodeErrorListeners();

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
          // P0: 先打开面板，再用 requestAnimationFrame 延迟加载模块
          // 确保面板可见后再开始加载，避免 offsetParent 检查失败
          openTab(tab);
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
              ensureCodeModulesLoaded().then(function () {
                if (!isCodePanelVisible()) return;
                recoverCodeInitAlias();
                if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function') {
                  var codeState = window.__xtjCodeWorkspaceAPI.getState ? window.__xtjCodeWorkspaceAPI.getState() : null;
                  if (!codeState || !codeState.active) {
                    window.__xtjCodeWorkspaceAPI.init();
                  }
                }
              }).catch(function () {
                // 错误已在 ensureCodeModulesLoaded 中处理
              });
            });
          });
          window.requestAnimationFrame(syncActiveTab);
          return;
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