(function () {
  'use strict';

  if (window.__xtjDesktopShellBound) return;
  window.__xtjDesktopShellBound = true;

  function openTab(tab) {
    if (tab === 'code' && typeof window.__xtjCancelPendingAiChatOpen === 'function') {
      window.__xtjCancelPendingAiChatOpen();
    }
    // When leaving Code panel, call cleanup
    var currentPanel = document.querySelector('.dock-panel.active:not(.hidden)');
    var currentIsCode = currentPanel && currentPanel.id === 'panelCode';
    if (currentIsCode && tab !== 'code' && window.__xtjCodeWorkspaceAPI && window.__xtjCodeWorkspaceAPI.cleanup) {
      // P3: 确保 cleanup 至多执行一次
      if (codeModuleState._codeCleanupExecuted) return;
      // H-35: 先执行 cleanup、确认导航真正会继续后再置标志。
      // 旧逻辑先置 true —— 用户取消"未保存确认"（cleanup 返回 false）后，
      // 本次会话内 cleanup 永不再次执行，Monaco/resizer/监听器泄漏。
      // P2: check cleanup return value FIRST — cancel navigation if user declined.
      // Only increment generation after we know navigation will actually proceed,
      // otherwise stale in-flight loads would be wrongly invalidated and the user
      // would be left on the Code panel with a polluted generation counter.
      if (window.__xtjCodeWorkspaceAPI.cleanup() === false) return;
      codeModuleState._codeCleanupExecuted = true;
      // P2: now that navigation is confirmed, increment generation to invalidate
      // any in-flight Code module loads belonging to the old Code session.
      codeModuleState.generation++;
    }
    var aiPanel = document.getElementById('panelAiChat');
    var aiVisible = !!(aiPanel && aiPanel.classList.contains('active') && !aiPanel.classList.contains('hidden'));
    if ((window.__xtjAiChatActive || aiVisible) && typeof window.__xtjCloseAiChat === 'function') {
      window.__xtjCloseAiChat();
    }
    // The lazy AI launcher may still be loading when no close handler has
    // been installed yet. Code must never remain underneath that overlay.
    if (tab === 'code' && aiPanel) {
      aiPanel.classList.add('hidden');
      aiPanel.classList.remove('active', 'is-entering', 'is-leaving');
      aiPanel.setAttribute('aria-hidden', 'true');
      window.__xtjAiChatActive = false;
      if (window.XTJSecondaryPageState && typeof window.XTJSecondaryPageState.close === 'function') {
        window.XTJSecondaryPageState.close('ai-chat');
      }
      if (typeof window.restoreMainNavigationState === 'function') window.restoreMainNavigationState();
    }
    if (typeof window.switchDockTab === 'function') {
      window.switchDockTab(tab, true, { animate: true, source: 'desktop-sidebar' });
    }
    if (tab === 'code') {
      // P3: 进入 Code 页面时重置 cleanup 标志，允许下次离开时再次执行
      codeModuleState._codeCleanupExecuted = false;
      // The canonical API survives tab cleanup; restore the legacy alias
      // synchronously when returning to Code so core.js and integrations do
      // not observe a half-recovered workspace.
      recoverCodeInitAlias();
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
    var previousTab = codeModuleState.currentTab;
    if (previousTab === 'code' && tab !== 'code' && window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.cleanup === 'function') {
      // P3: 确保 cleanup 至多执行一次；已执行过则跳过 cleanup，但必须继续下方
      // 的 currentTab 更新与导航高亮同步（否则导航状态永久失效）。
      if (codeModuleState._codeCleanupExecuted) {
        /* cleanup 已执行，继续同步 */
      } else {
        // H-35: 先执行再置位 —— 用户取消确认（cleanup 返回 false）时不置标志，
        // 否则 cleanup 永不再次执行，造成 Monaco/resizer/监听器泄漏。
        try {
          if (window.__xtjCodeWorkspaceAPI.cleanup() === false) return;
        } catch (_) { return; }
        codeModuleState._codeCleanupExecuted = true;
      }
    }
    codeModuleState.currentTab = tab;
    // Bootstrap a restored Code tab even when no click event fires.
    if (tab === 'code') {
      // P3: 进入 Code 页面时重置 cleanup 标志
      codeModuleState._codeCleanupExecuted = false;
      scheduleVisibleCodeWorkspaceLoad();
    }
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
  // 导出供 performRefresh('chat') 等外部流程调用（原为 IIFE 私有函数）
  window.syncContacts = syncContacts;
  window.syncChatBadge = syncChatBadge;

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
      'code-css':     { status: 'idle', url: '', startTime: 0 },
      'code-claude-css': { status: 'idle', url: '', startTime: 0 }
    },
    // P0: 当前 active tab 用于可靠的可见性判断
    currentTab: 'posts',
    // P3: 确保 Code 页面 cleanup 至多执行一次
    _codeCleanupExecuted: false
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
          msg.indexOf('code-claude') !== -1 ||
          /^Code\b/.test(msg)) {
        console.error('[CODE-LOADER] Unhandled rejection:');
        console.error('  Message: ' + msg);
        if (reason && reason.stack) {
          console.error('  Stack: ' + reason.stack);
        }
      }
    });
  }

  function ensureCodeModulesLoaded() {
    _installCodeErrorListeners();

    // Detect a partially executed/corrupted workspace before consulting the
    // shared loader cache. A resolved cached promise must not hide a missing
    // workspace API or leave the panel in a non-actionable state.
    if (window.__xtjCodeWorkspace === true &&
        (!window.__xtjCodeWorkspaceAPI || typeof window.__xtjCodeWorkspaceAPI.init !== 'function')) {
      codeModuleState.status = 'error';
      codeModuleState.error = new Error('Code 工作区脚本初始化不完整，请刷新页面后重试');
      codeModuleState.promise = null;
      renderErrorPage('Code 工作区脚本初始化不完整，请刷新页面后重试', true);
      return Promise.reject(codeModuleState.error);
    }

    // Asset injection, timeout cleanup, retry and export validation are shared
    // with 小猫 AI. The fallback below only supports stale cached core bundles.
    if (window.XTJModuleLoader && typeof window.XTJModuleLoader.load === 'function') {
      if (codeModuleState.status === 'loading' && codeModuleState.promise) return codeModuleState.promise;
      codeModuleState.status = 'loading';
      codeModuleState.error = null;
      codeModuleState.promise = window.XTJModuleLoader.load('code-workspace').then(function () {
        if (!recoverCodeInitAlias()) throw new Error('module_export_missing:code-workspace');
        codeModuleState.status = 'ready';
        codeModuleState.promise = null;
      }).catch(function (error) {
        codeModuleState.status = 'error';
        codeModuleState.error = error;
        codeModuleState.promise = null;
        console.error('[CODE-LOADER] Shared module load failed:', error);
        renderErrorPage('Code 工作区暂时无法加载，请点击重试。', false);
        throw error;
      });
      return codeModuleState.promise;
    }

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
    // Match the shared loader: cold Render static assets can exceed 15 seconds.
    var MODULE_TIMEOUT_MS = 45000;

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
      }),
      loadModuleWithTimeout('code-claude-css', 'xtj-module-code-claude-style', function () {
        return loadModuleStyle('code-claude-css', 'xtj-module-code-claude-style');
      })
    ]);

    codeModuleState.promise = loadPromise
      .then(function () {
        if (gen !== codeModuleState.generation) {
          // G14 修复：过期代次的加载完成后必须复位状态，否则 status 卡在 'loading'，
          // 后续 ensureCodeModulesLoaded 会复用已 resolve 的旧 promise 跳过真正加载
          codeModuleState.status = 'idle';
          codeModuleState.promise = null;
          return;
        }
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

  function scheduleVisibleCodeWorkspaceLoad() {
    if (!isCodePanelVisible()) return;
      if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function') {
        var codeState = typeof window.__xtjCodeWorkspaceAPI.getState === 'function' ? window.__xtjCodeWorkspaceAPI.getState() : null;
        if (!codeState || codeState.active) return;
      }
    if (codeModuleState.status === 'loading') return;
    var panelCode = document.getElementById('panelCode');
    if (panelCode && codeModuleState.status === 'idle') {
      panelCode.innerHTML = '<div class="code-loading-state"><div class="loading-spinner"></div><p>正在加载 Code 工作区...</p></div>';
    }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        ensureCodeModulesLoaded().then(function () {
          if (!isCodePanelVisible()) return;
          recoverCodeInitAlias();
          if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function') {
            window.__xtjCodeWorkspaceAPI.init();
          }
        }).catch(function () {
          // ensureCodeModulesLoaded renders its actionable retry state.
        });
      });
    });
  }

  // P0: 渲染错误页面
  function renderErrorPage(message, showRefresh) {
    var pc = document.getElementById('panelCode');
    if (!pc) return;
    var escapedMsg = String(message || '未知错误').replace(/</g, '&lt;');
    var state = showRefresh ? 'damaged' : 'error';
    var html = '<div class="code-loading-state" data-code-loader-state="' + state + '"><p>Code 工作区加载失败: ' + escapedMsg + '</p>';
    if (showRefresh) {
      html += '<button class="code-retry-btn" id="codeRefreshBtn" data-code-loader-action="refresh">刷新页面</button>';
    } else {
      html += '<button class="code-retry-btn" id="codeRetryBtn" data-code-loader-action="retry">重试</button>';
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

    // P2: 重置 code-workspace 的 active 状态，确保半初始化后重试能真正重新执行 init()。
    // init() 在 state.active === true 时会直接返回 already-active，跳过 renderWelcome()
    // 和 tryRestoreWorkspace()。retryCodeModuleLoad 仅在面板处于错误状态（显示重试按钮）
    // 时被调用，因此重置 active 是安全的，不会丢失正在使用的工作区。
    if (window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.getState === 'function') {
      var _wsState = window.__xtjCodeWorkspaceAPI.getState();
      if (_wsState && _wsState.active) _wsState.active = false;
    }

    // 确定哪些模块失败
    var failedModules = [];
    if (!verifyModule('code-fs')) failedModules.push('code-fs');
    if (!verifyModule('code-workspace')) failedModules.push('code-workspace');
    if (!verifyModule('code-css')) failedModules.push('code-css');
    if (!verifyModule('code-claude-css')) failedModules.push('code-claude-css');

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
    if (id === 'code-css' || id === 'code-claude-css') {
      // P0: 多维度验证 CSS 加载
      // 1. 检查 link 元素
      var links = document.querySelectorAll('link[data-xtj-code-module="' + id + '"]');
      for (var i = 0; i < links.length; i++) {
        if (links[i].sheet) return true;
        if (links[i].getAttribute('data-xtj-loaded') === 'true') return true;
      }
      // 2. 检查 document.styleSheets 中的 Code 样式 (跨浏览器兼容)
      try {
        var sheets = document.styleSheets;
        var needle = id === 'code-claude-css' ? 'code-claude-style' : 'code-workspace';
        for (var j = 0; j < sheets.length; j++) {
          var href = sheets[j].href || '';
          if (href.indexOf(needle) !== -1) return true;
        }
      } catch (e) {}
      // 3. 检查 CSS 探针 — 特定 Code 样式是否生效（主 workspace CSS）
      if (id === 'code-css') {
        try {
          var probe = document.querySelector('.code-welcome');
          if (probe) {
            var style = window.getComputedStyle(probe);
            if (style && style.display !== 'none') return true;
          }
        } catch (e) {}
      }
      return _loadedModules[id] === true;
    }
    return !!_loadedModules[id];
  }

  function init() {
    // P0: 安装全局错误监听器
    _installCodeErrorListeners();

    // P0: 存储 MutationObserver 引用，页面切换时断开防止内存泄漏
    var _observers = [];

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
      var _t = event.target;
      if (!_t || typeof _t.closest !== 'function') return;
      var actionButton = _t.closest('[data-desktop-action="ai-chat"]');
      if (actionButton && actionButton.classList.contains('is-active')) {
        event.preventDefault();
        refreshTab('ai');
      }
    });

    document.addEventListener('click', function (event) {
      var _t2 = event.target;
      if (!_t2 || typeof _t2.closest !== 'function') return;
      var tabButton = _t2.closest('[data-desktop-tab]');
      if (tabButton) {
        event.preventDefault();
        var tab = tabButton.getAttribute('data-desktop-tab');
        if (tab === 'code') {
          // P0: 先打开面板，再用 requestAnimationFrame 延迟加载模块
          // 确保面板可见后再开始加载，避免 offsetParent 检查失败
          openTab(tab);
          // Do not let the static welcome markup look like a ready workspace
          // while the asynchronously injected modules are still loading.
          var codePanel = document.getElementById('panelCode');
          if (codePanel && (!window.__xtjCodeWorkspaceAPI || typeof window.__xtjCodeWorkspaceAPI.init !== 'function')) {
            codePanel.innerHTML = '<div class="code-loading-state"><div class="loading-spinner"></div><p>正在加载 Code 工作区...</p></div>';
          }
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
      var obs1 = new MutationObserver(syncActiveTab);
      obs1.observe(panels, { attributes: true, subtree: true, attributeFilter: ['class'] });
      _observers.push(obs1);
    }
    var aiPanel = document.getElementById('panelAiChat');
    if (aiPanel && window.MutationObserver) {
      var obs2 = new MutationObserver(syncActiveTab);
      obs2.observe(aiPanel, { attributes: true, attributeFilter: ['class'] });
      _observers.push(obs2);
    }
    var auth = document.querySelector('.nav-auth');
    if (auth && window.MutationObserver) {
      // ★ rAF 合并防抖：一帧内多次变更只同步一次用户状态
      var _userSyncRaf = 0;
      function scheduleUserSync() {
        if (_userSyncRaf) return;
        _userSyncRaf = requestAnimationFrame(function () {
          _userSyncRaf = 0;
          syncUser();
        });
      }
      var obs3 = new MutationObserver(scheduleUserSync);
      obs3.observe(auth, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'data-user', 'data-username'] });
      _observers.push(obs3);
    }
    var badge = document.getElementById('navChatBadge');
    if (badge && window.MutationObserver) {
      var obs4 = new MutationObserver(syncChatBadge);
      obs4.observe(badge, { attributes: true, childList: true, characterData: true });
      _observers.push(obs4);
    }
    var chatList = document.getElementById('dockChatList');
    if (chatList && window.MutationObserver) {
      var obs5 = new MutationObserver(scheduleContactsSync);
      obs5.observe(chatList, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
        attributeFilter: ['data-chat-user']
      });
      _observers.push(obs5);
    }

    // P0: 在页面卸载时断开所有 Observer
    window.addEventListener('beforeunload', function() {
      for (var i = 0; i < _observers.length; i++) {
        try { _observers[i].disconnect(); } catch (e) {}
      }
      _observers.length = 0;
    });
    syncActiveTab();
    syncUser();
    syncChatBadge();
    syncContacts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
