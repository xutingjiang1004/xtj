(function () {
  'use strict';

  if (window.__xtjCodeWorkspace) return;
  window.__xtjCodeWorkspace = true;

  // ──────────────────────────────────────────────
  // State
  // ──────────────────────────────────────────────
  var state = {
    active: false,
    directoryHandle: null,
    workspaceName: '',
    fileHandles: {},
    openTabs: [],
    activePath: '',
    contextPaths: {},
    messages: [],
    pendingOperations: [],
    snapshots: {},
    sending: false,
    applying: false,
    _applyLock: false,
    _monacoLoaded: false,
    _monacoEditor: null,
    _objectUrls: [],
    _abortController: null,
    _requestId: 0,
    _themeObserver: null
  };

  // ──────────────────────────────────────────────
  // DOM cache
  // ──────────────────────────────────────────────
  var _dom = {};

  // ──────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────
  function escapeHTML(str) {
    if (typeof str !== 'string') str = String(str == null ? '' : str);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getMonacoTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs';
  }

  function getFileLanguage(fileName) {
    if (!fileName) return 'plaintext';
    var ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    var map = {
      '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
      '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
      '.html': 'html', '.htm': 'html',
      '.css': 'css', '.scss': 'scss', '.less': 'less',
      '.json': 'json', '.jsonc': 'json', '.json5': 'json',
      '.md': 'markdown', '.mdx': 'markdown', '.markdown': 'markdown',
      '.py': 'python', '.rb': 'ruby',
      '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
      '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
      '.cs': 'csharp', '.swift': 'swift',
      '.xml': 'xml', '.svg': 'xml',
      '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
      '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
      '.sh': 'shell', '.bat': 'bat', '.ps1': 'powershell',
      '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
      '.vue': 'html', '.svelte': 'html', '.astro': 'html',
      '.php': 'php', '.r': 'r', '.lua': 'lua',
      '.dart': 'dart', '.scala': 'scala', '.clj': 'clojure',
      '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang',
      '.hs': 'haskell', '.elm': 'elm', '.jl': 'julia',
      '.zig': 'rust', '.nim': 'nim',
      '.dockerfile': 'dockerfile', '.dockerignore': 'ignore',
      '.gitignore': 'ignore', '.editorconfig': 'ini'
    };
    return map[ext] || 'plaintext';
  }

  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function showToast(msg, type) {
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
        return;
      }
    } catch (e) { /* ignore */ }
    // Fallback: inline toast in code panel
    var panel = _dom.panelCode;
    if (!panel) return;
    var existing = panel.querySelector('.code-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'code-toast' + (type === 'error' ? ' error' : '') + (type === 'success' ? ' success' : '');
    toast.textContent = msg;
    panel.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(function () { try { toast.remove(); } catch (e) { /* ignore */ } }, 300);
    }, type === 'error' ? 4000 : 2500);
  }

  function validatePath(path) {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new Error('Path must be a non-empty string');
    }
    if (path.split('/').some(function(part) { return part === '..'; })) {
      throw new Error('Path traversal is not allowed');
    }
    if (/^[a-zA-Z]:[\\/]/.test(path) || path.charAt(0) === '/') {
      throw new Error('Absolute paths are not allowed');
    }
    return true;
  }

  function fileNameFromPath(path) {
    if (!path) return '';
    var normalized = path.replace(/\\/g, '/');
    var parts = normalized.split('/');
    return parts[parts.length - 1] || path;
  }

  function getFileTypeIconClass(fileName) {
    if (!fileName) return 'file-icon';
    var ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    var map = {
      '.js': 'file-js', '.mjs': 'file-js', '.cjs': 'file-js',
      '.ts': 'file-ts', '.tsx': 'file-ts',
      '.jsx': 'file-jsx',
      '.css': 'file-css', '.scss': 'file-css', '.less': 'file-css',
      '.html': 'file-html', '.htm': 'file-html',
      '.json': 'file-json', '.jsonc': 'file-json', '.json5': 'file-json',
      '.md': 'file-md', '.mdx': 'file-md', '.markdown': 'file-md',
      '.py': 'file-py',
      '.go': 'file-go',
      '.rs': 'file-rust',
      '.java': 'file-java', '.kt': 'file-java',
      '.sql': 'file-sql',
      '.yaml': 'file-yaml', '.yml': 'file-yaml',
      '.png': 'file-img', '.jpg': 'file-img', '.jpeg': 'file-img',
      '.gif': 'file-img', '.webp': 'file-img', '.svg': 'file-img',
      '.bmp': 'file-img', '.ico': 'file-img',
      '.pdf': 'file-pdf',
      '.docx': 'file-doc', '.doc': 'file-doc',
      '.xlsx': 'file-xls', '.xls': 'file-xls',
      '.pptx': 'file-ppt', '.ppt': 'file-ppt',
      '.csv': 'file-csv'
    };
    return map[ext] || 'file-icon';
  }

  function fileIsImage(fileName) {
    if (!fileName) return false;
    var ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].indexOf(ext) !== -1;
  }

  function fileIsPdf(fileName) {
    if (!fileName) return false;
    return fileName.slice(fileName.lastIndexOf('.')).toLowerCase() === '.pdf';
  }

  function fileIsDocument(fileName) {
    if (!fileName) return false;
    var ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    return ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'].indexOf(ext) !== -1;
  }

  // ──────────────────────────────────────────────
  // Monaco lazy-load
  // ──────────────────────────────────────────────
  function loadMonaco(callback) {
    if (state._monacoLoaded) {
      callback(null);
      return;
    }
    if (typeof monaco !== 'undefined') {
      state._monacoLoaded = true;
      callback(null);
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js';
    script.onload = function () {
      try {
        require.config({
          paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }
        });
        require(['vs/editor/editor.main'], function () {
          state._monacoLoaded = true;
          callback(null);
        });
      } catch (e) {
        callback(e);
      }
    };
    script.onerror = function () {
      callback(new Error('Failed to load Monaco loader'));
    };
    document.head.appendChild(script);
  }

  function disposeMonaco() {
    if (state._themeObserver) {
      state._themeObserver.disconnect();
      state._themeObserver = null;
    }
    if (state._monacoEditor) {
      try {
        if (window.monaco) {
          monaco.editor.getModels().forEach(function(m) { m.dispose(); });
        }
        state._monacoEditor.dispose();
      } catch (e) { /* ignore */ }
      state._monacoEditor = null;
    }
  }

  // ──────────────────────────────────────────────
  // SHA-256 via FS module
  // ──────────────────────────────────────────────
  function getSHA256(content) {
    if (window.__xtjCodeFS && window.__xtjCodeFS.getSHA256) {
      return window.__xtjCodeFS.getSHA256(content);
    }
    // Fallback
    var buffer;
    if (typeof content === 'string') {
      buffer = new TextEncoder().encode(content);
    } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      buffer = content;
    } else {
      return Promise.resolve('');
    }
    return crypto.subtle.digest('SHA-256', buffer).then(function (hash) {
      var bytes = new Uint8Array(hash);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        if (h.length === 1) h = '0' + h;
        hex += h;
      }
      return hex;
    });
  }

  // ──────────────────────────────────────────────
  // Object URL tracking
  // ──────────────────────────────────────────────
  function trackUrl(url) {
    state._objectUrls.push(url);
  }

  function revokeUrl(url) {
    try {
      URL.revokeObjectURL(url);
    } catch (e) { /* ignore */ }
    var idx = state._objectUrls.indexOf(url);
    if (idx !== -1) state._objectUrls.splice(idx, 1);
  }

  function revokeAllUrls() {
    var urls = state._objectUrls.slice();
    for (var i = 0; i < urls.length; i++) {
      try { URL.revokeObjectURL(urls[i]); } catch (e) { /* ignore */ }
    }
    state._objectUrls = [];
  }

  // ──────────────────────────────────────────────
  // init() — called when Code tab is first activated
  // ──────────────────────────────────────────────
  function init() {
    if (state.active) return;
    state.active = true;

    _dom.panelCode = document.getElementById('panelCode');
    if (!_dom.panelCode) {
      console.warn('[code-workspace] panelCode not found');
      state.active = false;
      return;
    }

    // Try to restore previous workspace (auto-load, no permission prompt)
    tryRestoreWorkspace().then(function (result) {
      if (result && result.status === 'granted') {
        renderWorkspace();
      } else {
        renderWelcome();
      }
    }).catch(function () {
      renderWelcome();
    });
  }

  function tryRestoreWorkspace() {
    if (!window.__xtjCodeFS || !window.__xtjCodeFS.restoreWorkspace) {
      return Promise.resolve({ status: 'missing' });
    }
    return window.__xtjCodeFS.restoreWorkspace({ requestPermission: false }).then(function (result) {
      if (result.status === 'granted') {
        state.directoryHandle = result.handle;
        state.workspaceName = result.handle.name;
      }
      return result;
    }).catch(function () {
      return { status: 'error' };
    });
  }

  // ──────────────────────────────────────────────
  // cleanup() — called when leaving Code tab
  // ──────────────────────────────────────────────
  function cleanup() {
    // Cancel any in-flight request
    if (state._abortController) {
      try { state._abortController.abort(); } catch (e) { /* ignore */ }
      state._abortController = null;
    }
    state._requestId++;
    revokeAllUrls();
    disposeMonaco();
    state.sending = false;
    state.active = false;
    _dom = {};
    // Don't clear directoryHandle so workspace can be restored
  }

  // ──────────────────────────────────────────────
  // renderWelcome()
  // ──────────────────────────────────────────────
  function renderWelcome() {
    if (!_dom.panelCode) return;
    _dom.panelCode.innerHTML = '';

    var welcome = document.createElement('div');
    welcome.className = 'code-welcome';

    welcome.innerHTML =
      '<div class="welcome-icon">📁</div>' +
      '<h2 class="welcome-title">打开文件夹开始</h2>' +
      '<p class="welcome-desc">选择一个本地文件夹作为工作区，浏览和编辑文件，或使用 AI 助手进行代码操作。</p>' +
      '<div class="welcome-actions">' +
        '<button class="folder-picker-btn-large" id="codeWelcomeOpenBtn">' +
          '<span class="folder-icon">📂</span> 重新选择文件夹' +
        '</button>' +
      '</div>' +
      '<p class="welcome-recent" id="codeWelcomeRecent" style="display:none"></p>';

    _dom.panelCode.appendChild(welcome);

    // Bind open folder button
    var btn = document.getElementById('codeWelcomeOpenBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        selectAndOpenWorkspace();
      });
    }

    // Check if there's a stored handle path — show restore section
    var stored = null;
    try {
      stored = localStorage.getItem('xtj_code_workspace_name');
    } catch (e) { /* ignore */ }

    var recentEl = document.getElementById('codeWelcomeRecent');
    if (recentEl && stored) {
      recentEl.style.display = 'block';

      var restoreBtn = document.createElement('button');
      restoreBtn.className = 'folder-picker-btn-large';
      restoreBtn.id = 'codeWelcomeRestoreBtn';
      restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复 xtj 工作区';
      restoreBtn.title = '上次打开: ' + stored;

      var statusText = document.createElement('span');
      statusText.className = 'welcome-status';
      statusText.id = 'codeWelcomeStatus';

      recentEl.appendChild(restoreBtn);
      recentEl.appendChild(statusText);

      restoreBtn.addEventListener('click', function () {
        restoreBtn.disabled = true;
        restoreBtn.innerHTML = '<span class="folder-icon">⏳</span> 正在恢复...';
        statusText.textContent = '';
        statusText.className = 'welcome-status';

        if (!window.__xtjCodeFS || !window.__xtjCodeFS.restoreWorkspace) {
          statusText.textContent = '文件系统 API 不可用';
          statusText.className = 'welcome-status error';
          restoreBtn.disabled = false;
          restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复 xtj 工作区';
          return;
        }

        window.__xtjCodeFS.restoreWorkspace({ requestPermission: true }).then(function (result) {
          restoreBtn.disabled = false;
          restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复 xtj 工作区';

          if (result.status === 'granted') {
            state.directoryHandle = result.handle;
            state.workspaceName = result.handle.name;
            try {
              localStorage.setItem('xtj_code_workspace_name', result.handle.name);
            } catch (e) { /* ignore */ }
            renderWorkspace();
          } else if (result.status === 'missing') {
            statusText.textContent = '工作区记录已失效，请重新选择文件夹';
            statusText.className = 'welcome-status error';
            if (window.__xtjCodeFS.clearWorkspaceRecord) {
              window.__xtjCodeFS.clearWorkspaceRecord().catch(function () {});
            }
            recentEl.style.display = 'none';
          } else if (result.status === 'denied') {
            statusText.textContent = '您拒绝了访问权限，请重新选择文件夹';
            statusText.className = 'welcome-status error';
          } else if (result.status === 'prompt') {
            statusText.textContent = '需要授权才能恢复工作区，请点击按钮重试';
            statusText.className = 'welcome-status warning';
          } else {
            statusText.textContent = '恢复失败，请重新选择文件夹';
            statusText.className = 'welcome-status error';
          }
        }).catch(function (err) {
          restoreBtn.disabled = false;
          restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复 xtj 工作区';
          statusText.textContent = '恢复失败: ' + (err && err.message ? err.message : String(err));
          statusText.className = 'welcome-status error';
        });
      });
    }
  }

  function selectAndOpenWorkspace() {
    var btn = document.getElementById('codeWelcomeOpenBtn');
    if (!window.showDirectoryPicker) {
      // Fallback for browsers without File System Access API
      var input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.onchange = function(e) {
        if (!e.target.files || !e.target.files.length) return;
        var files = Array.from(e.target.files);
        var dirName = files[0].webkitRelativePath.split('/')[0] || 'Workspace';
        state.directoryHandle = { _isMock: true, name: dirName, files: files };
        state.workspaceName = dirName;
        renderWorkspace();
      };
      input.click();
      return;
    }
    
    if (!window.isSecureContext) {
      if (typeof window.showToast === 'function') window.showToast('需要 HTTPS 环境才能使用文件系统 API', 'error');
      return;
    }

    if (!window.__xtjCodeFS || !window.__xtjCodeFS.selectDirectory) {
      if (typeof window.showToast === 'function') window.showToast('文件系统 API 不可用', 'error');
      return;
    }

    var originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="folder-icon">⏳</span> 请在弹窗中选择并授权...';
    }

    window.__xtjCodeFS.selectDirectory().then(function (handle) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
      if (!handle) return; // User cancelled
      state.directoryHandle = handle;
      state.workspaceName = handle.name;
      try {
        localStorage.setItem('xtj_code_workspace_name', handle.name);
      } catch (e) { /* ignore */ }
      renderWorkspace();
    }).catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
      var msg = err && err.message ? err.message : String(err);
      if (err.name === 'SecurityError') {
        msg = '安全错误，无法访问文件夹';
      } else if (err.name === 'NotAllowedError') {
        msg = '您拒绝了访问权限';
      } else if (err.name === 'AbortError') {
        return; // User cancelled
      }
      if (typeof window.showToast === 'function') window.showToast('选择文件夹失败：' + msg, 'error');
    });
  }

  // ──────────────────────────────────────────────
  // renderWorkspace()
  // ──────────────────────────────────────────────
  function renderWorkspace() {
    if (!_dom.panelCode) return;
    _dom.panelCode.innerHTML = '';

    // Main workspace container — true three-column layout
    var workspace = document.createElement('div');
    workspace.className = 'code-workspace';

    // ── Sidebar (left) ──
    var sidebar = document.createElement('div');
    sidebar.className = 'code-sidebar';

    var sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'code-sidebar-header';
    sidebarHeader.innerHTML =
      '<span class="workspace-name">' + escapeHTML(state.workspaceName || 'Workspace') + '</span>' +
      '<button class="folder-picker-btn" title="更换文件夹">📁</button>';
    var changeBtn = sidebarHeader.querySelector('.folder-picker-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        selectAndOpenWorkspace();
      });
    }
    sidebar.appendChild(sidebarHeader);

    // File tree
    var fileTree = document.createElement('div');
    fileTree.className = 'code-file-tree';
    fileTree.id = 'codeFileTree';
    sidebar.appendChild(fileTree);

    // Context panel
    var contextPanel = document.createElement('div');
    contextPanel.className = 'code-context-panel';
    contextPanel.id = 'codeContextPanel';
    sidebar.appendChild(contextPanel);

    workspace.appendChild(sidebar);

    // ── Editor column (center) ──
    var editorColumn = document.createElement('div');
    editorColumn.className = 'code-editor-column';

    // Tab bar
    var tabBar = document.createElement('div');
    tabBar.className = 'code-tab-bar';
    tabBar.id = 'codeTabBar';
    editorColumn.appendChild(tabBar);

    // Editor area
    var editorArea = document.createElement('div');
    editorArea.className = 'code-editor-area';
    editorArea.id = 'codeEditorArea';
    editorColumn.appendChild(editorArea);

    workspace.appendChild(editorColumn);

    // ── Chat panel (right) ──
    var chatPanel = document.createElement('div');
    chatPanel.className = 'code-chat-panel';
    chatPanel.id = 'codeChatPanel';
    workspace.appendChild(chatPanel);

    _dom.panelCode.appendChild(workspace);

    // Cache DOM refs
    _dom.fileTree = fileTree;
    _dom.contextPanel = contextPanel;
    _dom.tabBar = tabBar;
    _dom.editorArea = editorArea;
    _dom.chatPanel = chatPanel;
    _dom.sidebar = sidebar;
    _dom.editorColumn = editorColumn;

    // Render sub-components
    renderFileTree();
    renderEmptyState();
    renderContextPanel();
    renderChatPanel();

    // Restore open tabs after re-entering Code
    restoreTabs();
  }

  // ──────────────────────────────────────────────
  // restoreTabs() — restore open tabs after cleanup
  // ──────────────────────────────────────────────
  function restoreTabs() {
    if (state.openTabs.length === 0) return;

    // Validate activePath
    var found = false;
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === state.activePath) {
        found = true;
        break;
      }
    }
    if (!found) {
      state.activePath = state.openTabs[0].path;
    }

    var fs = window.__xtjCodeFS;
    if (!fs || !fs.readFileByPath) {
      renderTabs();
      renderEditor();
      return;
    }

    // Re-read all open tabs to refresh content and blob URLs
    var readPromises = [];
    for (var i = 0; i < state.openTabs.length; i++) {
      (function (tab) {
        readPromises.push(
          new Promise(function (resolve) {
            fs.readFileByPath(tab.path).then(function (result) {
              if (!result) {
                // File was deleted externally
                resolve({ tab: tab, deleted: true });
                return;
              }
              // Update content for text files
              if (result.type === 'text') {
                tab.content = result.content;
                tab.sha256 = result.sha256 || '';
                tab.modified = false;
                tab._currentContent = undefined;
              }
              // Generate new blob URL for image/PDF (old one was revoked)
              if (result.type === 'image' || result.type === 'pdf') {
                // Revoke any stale blob URL reference
                if (tab.blobUrl) {
                  var oldUrl = tab.blobUrl;
                  tab.blobUrl = null;
                  try { URL.revokeObjectURL(oldUrl); } catch (e) { /* ignore */ }
                }
                tab.blobUrl = result.content; // readFileByPath returns blob URL as content
                tab.mimeType = result.mimeType || '';
                if (tab.blobUrl) {
                  trackUrl(tab.blobUrl);
                }
              }
              resolve({ tab: tab, deleted: false });
            }).catch(function () {
              // Read failed — file may be deleted
              resolve({ tab: tab, deleted: true });
            });
          })
        );
      })(state.openTabs[i]);
    }

    Promise.all(readPromises).then(function (results) {
      // Remove tabs for deleted files
      var deletedPaths = [];
      for (var k = results.length - 1; k >= 0; k--) {
        if (results[k].deleted) {
          var t = results[k].tab;
          deletedPaths.push(t.path);
          // Remove from openTabs
          for (var m = state.openTabs.length - 1; m >= 0; m--) {
            if (state.openTabs[m].path === t.path) {
              state.openTabs.splice(m, 1);
              break;
            }
          }
        }
      }

      // Re-validate activePath after removing deleted tabs
      if (state.openTabs.length > 0) {
        var activeFound = false;
        for (var n = 0; n < state.openTabs.length; n++) {
          if (state.openTabs[n].path === state.activePath) {
            activeFound = true;
            break;
          }
        }
        if (!activeFound) {
          state.activePath = state.openTabs[0].path;
        }
      }

      renderTabs();
      renderEditor();

      if (deletedPaths.length > 0) {
        showToast('部分文件已被外部删除，已关闭对应标签', 'warning');
      }
    });
  }

  // ──────────────────────────────────────────────
  // renderEmptyState()
  // ──────────────────────────────────────────────
  function renderEmptyState() {
    if (!_dom.editorArea) return;
    _dom.editorArea.innerHTML = '';

    var empty = document.createElement('div');
    empty.className = 'code-empty-state';
    empty.id = 'codeEmptyState';
    empty.innerHTML =
      '<div class="empty-icon">📄</div>' +
      '<h3 class="empty-title">选择一个文件开始编辑</h3>' +
      '<p class="empty-desc">从左侧文件树中选择一个文件，或使用 AI 助手创建新文件</p>';

    _dom.editorArea.appendChild(empty);
  }

  // ──────────────────────────────────────────────
  // renderFileTree()
  // ──────────────────────────────────────────────
  function renderFileTree() {
    if (!_dom.fileTree) return;
    if (!state.directoryHandle) {
      _dom.fileTree.innerHTML = '<div style="padding:12px;color:var(--cw-text-muted);font-size:12px;">请先打开文件夹</div>';
      return;
    }

    _dom.fileTree.innerHTML = '';

    // Create root tree node
    var rootNode = createTreeItem({
      name: state.workspaceName || 'Root',
      kind: 'directory',
      handle: state.directoryHandle,
      depth: 0,
      isRoot: true
    });

    _dom.fileTree.appendChild(rootNode);

    // Auto-expand root
    if (rootNode._toggle) {
      rootNode._toggle();
    }
  }

  function createTreeItem(item) {
    var depth = item.depth || 0;
    var wrapper = document.createElement('div');
    wrapper.className = 'code-tree-wrapper';

    var row = document.createElement('div');
    row.className = 'code-tree-item ' + (item.kind === 'directory' ? 'dir' : 'file');
    row.style.setProperty('--cw-tree-depth', depth);
    row.setAttribute('data-path', item.path || item.name);

    if (item.kind === 'directory') {
      row.innerHTML =
        '<span class="code-tree-icon">▶</span>' +
        '<span class="code-tree-icon folder">📁</span>' +
        '<span class="code-tree-name">' + escapeHTML(item.name) + '</span>';
    } else {
      var iconClass = getFileTypeIconClass(item.name);
      row.innerHTML =
        '<span class="code-tree-icon" style="visibility:hidden">▶</span>' +
        '<span class="code-tree-icon ' + iconClass + '">📄</span>' +
        '<span class="code-tree-name">' + escapeHTML(item.name) + '</span>';
    }

    var childrenContainer = document.createElement('div');
    childrenContainer.className = 'code-tree-children collapsed';
    childrenContainer.setAttribute('data-path', item.path || item.name);

    wrapper.appendChild(row);
    wrapper.appendChild(childrenContainer);

    if (item.kind === 'directory') {
      var expanded = false;

      row._toggle = function () {
        if (expanded) {
          // Collapse
          row.classList.remove('expanded');
          childrenContainer.classList.add('collapsed');
          expanded = false;
        } else {
          // Expand
          row.classList.add('expanded');
          childrenContainer.classList.remove('collapsed');
          expanded = true;

          // Lazy load children
          if (childrenContainer.children.length === 0 && item.handle) {
            childrenContainer.innerHTML = '<div class="code-tree-skeleton"><span class="skeleton-icon"></span><span class="skeleton-line" style="width:60%"></span></div>';

            var fs = window.__xtjCodeFS;
            if (fs && fs.expandDirectory) {
              fs.expandDirectory(item.handle).then(function (children) {
                childrenContainer.innerHTML = '';
                if (!children || children.length === 0) {
                  childrenContainer.innerHTML = '<div style="padding:2px 12px;font-size:11px;color:var(--cw-text-muted);opacity:0.5;">空目录</div>';
                  return;
                }
                for (var i = 0; i < children.length; i++) {
                  var child = children[i];
                  var childPath = (item.path ? item.path + '/' : '') + child.name;
                  var childNode = createTreeItem({
                    name: child.name,
                    kind: child.kind,
                    handle: child.handle,
                    depth: depth + 1,
                    path: childPath
                  });
                  childrenContainer.appendChild(childNode);
                }
              }).catch(function (err) {
                childrenContainer.innerHTML = '<div style="padding:2px 12px;font-size:11px;color:var(--cw-danger);">加载失败</div>';
                console.error('[code-workspace] expandDirectory error:', err);
              });
            }
          }
        }
      };

      row.addEventListener('click', function (e) {
        e.stopPropagation();
        row._toggle();
      });
    } else {
      // File click — open in editor
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        openFile(item.path || item.name);
      });

      // Right-click context menu
      row.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e, item.path || item.name);
      });
    }

    return wrapper;
  }

  function showFileContextMenu(e, path) {
    // Remove any existing menu
    var existing = document.querySelector('.code-context-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.className = 'code-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.position = 'fixed';

    var inContext = state.contextPaths[path];
    var contextLabel = inContext ? '从 AI 上下文移除' : '添加到 AI 上下文';

    menu.innerHTML =
      '<div class="menu-item" data-action="toggle-context">' +
        '<span>' + (inContext ? '🔽' : '🔼') + '</span>' +
        '<span>' + contextLabel + '</span>' +
      '</div>' +
      '<div class="menu-separator"></div>' +
      '<div class="menu-item" data-action="open">' +
        '<span>📄</span><span>打开文件</span>' +
      '</div>';

    document.body.appendChild(menu);

    function closeMenu() {
      try { menu.remove(); } catch (e) { /* ignore */ }
      document.removeEventListener('click', closeMenu);
    }

    menu.querySelector('[data-action="toggle-context"]').addEventListener('click', function () {
      toggleContext(path);
      closeMenu();
    });

    menu.querySelector('[data-action="open"]').addEventListener('click', function () {
      openFile(path);
      closeMenu();
    });

    // Close on click outside
    setTimeout(function () {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  function refreshFileTree() {
    if (!_dom.fileTree || !state.directoryHandle) return;
    renderFileTree();

    // Highlight active file
    if (state.activePath) {
      var items = _dom.fileTree.querySelectorAll('.code-tree-item.file');
      for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute('data-path') === state.activePath) {
          items[i].classList.add('active');
          break;
        }
      }
    }
  }

  // ──────────────────────────────────────────────
  // openFile(path)
  // ──────────────────────────────────────────────
  function openFile(path) {
    if (!path) return;

    try {
      validatePath(path);
    } catch (e) {
      showToast('无效的文件路径', 'error');
      return;
    }

    // Check if already open
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === path) {
        state.activePath = path;
        renderTabs();
        renderEditor();
        return;
      }
    }

    // Read file
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.readFileByPath) {
      showToast('文件系统不可用', 'error');
      return;
    }

    fs.readFileByPath(path).then(function (result) {
      if (!result) {
        showToast('无法读取文件: ' + path, 'error');
        return;
      }

      var tab = {
        path: path,
        name: fileNameFromPath(path),
        modified: false,
        content: result.type === 'text' ? result.content : null,
        sha256: result.sha256 || '',
        type: result.type || 'text',
        mimeType: result.mimeType || '',
        blobUrl: (result.type === 'image' || result.type === 'pdf') ? result.content : null,
        size: result.size || 0
      };

      // Track blob URL
      if (tab.blobUrl) {
        trackUrl(tab.blobUrl);
      }

      
      state.openTabs.push(tab);
      state.activePath = path;

      // Cache file handle
      if (result.handle) {
        state.fileHandles[path] = result.handle;
      }

      renderTabs();
      renderEditor();
      
      // Auto-add to context if text and not in context
      if (tab.type === 'text' && !state.contextPaths[path]) {
        var count = Object.keys(state.contextPaths).length;
        if (count < 12 && !isRestrictedContextFile(path)) {
          state.contextPaths[path] = true;
          renderContextPanel();
        }
      }
    }).catch(function (err) {

      showToast('打开文件失败: ' + (err && err.message ? err.message : String(err)), 'error');
    });
  }

  // ──────────────────────────────────────────────
  // closeTab(path)
  // ──────────────────────────────────────────────
  function closeTab(path) {
    var idx = -1;
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === path) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    var tab = state.openTabs[idx];

    // Revoke blob URL
    if (tab.blobUrl) {
      revokeUrl(tab.blobUrl);
    }

    state.openTabs.splice(idx, 1);

    if (state.activePath === path) {
      if (state.openTabs.length > 0) {
        state.activePath = state.openTabs[Math.max(0, idx - 1)].path;
      } else {
        state.activePath = '';
      }
    }

    renderTabs();
    if (state.activePath) {
      renderEditor();
    } else {
      renderEmptyState();
    }
  }

  // ──────────────────────────────────────────────
  // renderTabs()
  // ──────────────────────────────────────────────
  function renderTabs() {
    if (!_dom.tabBar) return;
    _dom.tabBar.innerHTML = '';

    for (var i = 0; i < state.openTabs.length; i++) {
      (function (tab) {
        var el = document.createElement('div');
        el.className = 'code-tab' + (tab.path === state.activePath ? ' active' : '') + (tab.modified ? ' modified' : '');
        el.setAttribute('data-path', tab.path);

        var inContext = state.contextPaths[tab.path];
        var contextDot = inContext ? '<span class="code-tab-context"></span>' : '';

        el.innerHTML =
          contextDot +
          '<span class="tab-name">' + escapeHTML(tab.name) + '</span>' +
          '<span class="tab-close" title="关闭">✕</span>';

        // Click tab to switch
        el.addEventListener('click', function (e) {
          if (e.target.classList.contains('tab-close')) return;
          state.activePath = tab.path;
          renderTabs();
          renderEditor();
        });

        // Close button
        var closeBtn = el.querySelector('.tab-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeTab(tab.path);
          });
        }

        // Middle-click to close
        el.addEventListener('auxclick', function (e) {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(tab.path);
          }
        });

        _dom.tabBar.appendChild(el);
      })(state.openTabs[i]);
    }

    if (state.openTabs.length === 0) {
      _dom.tabBar.innerHTML = '';
    }
  }

  // ──────────────────────────────────────────────
  // renderEditor()
  // ──────────────────────────────────────────────
  function renderEditor() {
    if (!_dom.editorArea) return;

    var tab = null;
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === state.activePath) {
        tab = state.openTabs[i];
        break;
      }
    }
    if (!tab) {
      renderEmptyState();
      return;
    }

    // Remove empty state
    var emptyEl = document.getElementById('codeEmptyState');
    if (emptyEl) emptyEl.remove();

    _dom.editorArea.innerHTML = '';

    if (tab.type === 'image') {
      renderImagePreview(tab.path, tab.blobUrl);
    } else if (tab.type === 'pdf') {
      renderPdfPreview(tab.path, tab.blobUrl);
    } else if (tab.type === 'document') {
      renderDocumentPreview(tab);
    } else {
      // Text editor
      renderTextEditor(tab);
    }
  }

  // ──────────────────────────────────────────────
  // renderTextEditor(tab)
  // ──────────────────────────────────────────────
  function renderTextEditor(tab) {
    if (!_dom.editorArea) return;

    disposeMonaco();

    var container = document.createElement('div');
    container.className = 'code-editor-container';
    container.id = 'codeEditorContainer';
    container.style.flex = '1';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    _dom.editorArea.appendChild(container);

    // Try Monaco
    loadMonaco(function (err) {
      if (err || !state._monacoLoaded || typeof monaco === 'undefined') {
        // Fallback to textarea
        renderTextareaEditor(tab, container);
        return;
      }

      try {
        var language = getFileLanguage(tab.name);
        var content = tab._currentContent !== undefined ? tab._currentContent : (tab.content || '');
        var model = monaco.editor.createModel(content, language);
        var editor = monaco.editor.create(container, {
          model: model,
          theme: getMonacoTheme(),
          fontSize: 13,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Monaco', monospace",
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'off',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: { indentation: true },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          padding: { top: 12 }
        });

        state._monacoEditor = editor;

        if (!state._themeObserver) {
          state._themeObserver = new MutationObserver(function () {
            if (state._monacoEditor && window.monaco) {
              monaco.editor.setTheme(getMonacoTheme());
            }
          });
          state._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        }

        // Track content changes
        editor.getModel().onDidChangeContent(function () {
          var newContent = editor.getValue();
          if (newContent !== tab.content) {
            tab.modified = true;
            tab._currentContent = newContent;
            renderTabs();
          }
        });

        // Ctrl+S to save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
          saveFile(tab.path);
        });
      } catch (e) {
        renderTextareaEditor(tab, container);
      }
    });
  }

  function renderTextareaEditor(tab, container) {
    container.innerHTML = '';

    var toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    toolbar.innerHTML =
      '<div class="toolbar-breadcrumb">' +
        '<span class="crumb">' + escapeHTML(tab.path) + '</span>' +
      '</div>' +
      '<div class="toolbar-group">' +
        '<button class="toolbar-btn" id="codeSaveBtn" title="保存 (Ctrl+S)">💾</button>' +
      '</div>';
    container.appendChild(toolbar);

    var textarea = document.createElement('textarea');
    textarea.className = 'code-textarea';
    textarea.value = tab._currentContent !== undefined ? tab._currentContent : (tab.content || '');
    textarea.spellcheck = false;
    textarea.setAttribute('placeholder', '// 文件内容...');
    container.appendChild(textarea);

    // Track changes
    textarea.addEventListener('input', function () {
      var newContent = textarea.value;
      if (newContent !== tab.content) {
        tab.modified = true;
        tab._currentContent = newContent;
        renderTabs();
      }
    });

    // Ctrl+S
    textarea.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        saveFile(tab.path);
      }
    });

    // Save button
    var saveBtn = document.getElementById('codeSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveFile(tab.path);
      });
    }
  }

  // ──────────────────────────────────────────────
  // saveFile(path)
  // ──────────────────────────────────────────────
  function saveFile(path) {
    var tab = null;
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === path) {
        tab = state.openTabs[i];
        break;
      }
    }
    if (!tab) return;

    var content;
    if (state._monacoEditor && state.activePath === path) {
      content = state._monacoEditor.getValue();
    } else if (tab._currentContent !== undefined) {
      content = tab._currentContent;
    } else {
      content = tab.content;
    }

    var fs = window.__xtjCodeFS;
    if (!fs || !fs.writeFileByPath) {
      showToast('文件系统不可用', 'error');
      return;
    }

    fs.writeFileByPath(path, content).then(function (result) {
      tab.content = content;
      tab.modified = false;
      tab._currentContent = undefined;
      tab.sha256 = result.sha256 || '';
      renderTabs();
      showToast('文件已保存', 'success');
    }).catch(function (err) {
      showToast('保存失败: ' + (err && err.message ? err.message : String(err)), 'error');
    });
  }

  // ──────────────────────────────────────────────
  // renderImagePreview(path, url)
  // ──────────────────────────────────────────────
  function renderImagePreview(path, url) {
    if (!_dom.editorArea) return;

    var preview = document.createElement('div');
    preview.className = 'code-preview-area';
    preview.id = 'codePreviewArea';

    var img = document.createElement('img');
    img.src = url;
    img.alt = fileNameFromPath(path);
    img.title = fileNameFromPath(path);
    img.onerror = function () {
      preview.innerHTML = '<div class="image-placeholder"><span class="image-icon">🖼️</span><p>图片加载失败</p></div>';
    };

    preview.appendChild(img);
    _dom.editorArea.appendChild(preview);
  }

  // ──────────────────────────────────────────────
  // renderPdfPreview(path, url)
  // ──────────────────────────────────────────────
  function renderPdfPreview(path, url) {
    if (!_dom.editorArea) return;

    var preview = document.createElement('div');
    preview.className = 'code-preview-area';
    preview.id = 'codePreviewArea';

    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = fileNameFromPath(path);
    // iframe onerror doesn't trigger for network errors
    // We can use fetch to verify if it's a valid blob/url
    fetch(url, { method: 'HEAD' }).then(function(res) {
      if (!res.ok) throw new Error('Not ok');
    }).catch(function() {
      preview.innerHTML = '<div class="pdf-placeholder"><span class="pdf-icon">📕</span><p>PDF 预览不可用</p></div>';
    });

    preview.appendChild(iframe);
    _dom.editorArea.appendChild(preview);
  }

  // ──────────────────────────────────────────────
  // renderDocumentPreview(tab)
  // ──────────────────────────────────────────────
  function renderDocumentPreview(tab) {
    if (!_dom.editorArea) return;

    var preview = document.createElement('div');
    preview.className = 'code-preview-area code-document-preview';
    preview.id = 'codePreviewArea';

    // Loading state
    preview.innerHTML = '<div class="doc-preview-loading"><span class="doc-loading-spinner"></span><p>正在提取文档内容...</p></div>';
    _dom.editorArea.appendChild(preview);

    // Extract text via backend API
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.readDocumentText) {
      preview.innerHTML = '<div class="doc-preview-error"><span class="doc-icon">📄</span><p>文档提取功能不可用</p></div>';
      return;
    }

    // Read the file again to get ArrayBuffer
    fs.readFileByPath(tab.path).then(function (result) {
      if (!result || result.type !== 'document') {
        preview.innerHTML = '<div class="doc-preview-error"><span class="doc-icon">📄</span><p>无法读取文档文件</p></div>';
        return;
      }

      return fs.readDocumentText(result._arrayBuffer, result.name, result.mimeType);
    }).then(function (docData) {
      if (!docData) return;

      var docIcon = '📄';
      var docLabel = '文档';
      var ext = (docData.ext || '').toLowerCase();
      if (ext === '.docx' || ext === '.doc') { docIcon = '📝'; docLabel = 'Word 文档'; }
      else if (ext === '.xlsx' || ext === '.xls') { docIcon = '📊'; docLabel = 'Excel 表格'; }
      else if (ext === '.pptx' || ext === '.ppt') { docIcon = '📽️'; docLabel = 'PPT 演示'; }

      var html = '<div class="doc-preview-header">';
      html += '<span class="doc-preview-icon">' + docIcon + '</span>';
      html += '<div class="doc-preview-info">';
      html += '<span class="doc-preview-label">' + docLabel + '</span>';
      html += '<span class="doc-preview-name">' + escapeHTML(tab.name) + '</span>';
      if (docData.metadata) {
        if (docData.metadata.pages) html += '<span class="doc-preview-meta">' + docData.metadata.pages + ' 页</span>';
        if (docData.metadata.sheetCount) html += '<span class="doc-preview-meta">' + docData.metadata.sheetCount + ' 个工作表</span>';
      }
      html += '</div></div>';

      html += '<div class="doc-preview-content">';
      if (docData.truncated) {
        html += '<div class="doc-preview-truncated">⚠ 内容过长，已截断显示前 100KB</div>';
      }
      html += '<pre class="doc-preview-text">' + escapeHTML(docData.text) + '</pre>';
      html += '</div>';

      preview.innerHTML = html;

      // Store extracted text in tab for AI context
      tab._extractedText = docData.text;
      tab._extractedTruncated = docData.truncated;
      tab._extractedMetadata = docData.metadata;
    }).catch(function (err) {
      preview.innerHTML = '<div class="doc-preview-error"><span class="doc-icon">📄</span><p>文档提取失败: ' + escapeHTML((err && err.message) || '未知错误') + '</p></div>';
    });
  }

  // ──────────────────────────────────────────────
  // toggleContext(path)
  // ──────────────────────────────────────────────
  function toggleContext(path) {
    if (!path) return;

    if (state.contextPaths[path]) {
      delete state.contextPaths[path];
    } else {
      var count = Object.keys(state.contextPaths).length;
      if (count >= 12) {
        showToast('最多添加 12 个文件到 AI 上下文', 'error');
        return;
      }

      // Check if file is restricted (sensitive files)
      if (isRestrictedContextFile(path)) {
        showToast('该文件包含敏感信息，不能作为 AI 文本上下文', 'error');
        return;
      }

      // Check if file is image, PDF, or binary — cannot be AI text context
      var tab = null;
      for (var j = 0; j < state.openTabs.length; j++) {
        if (state.openTabs[j].path === path) {
          tab = state.openTabs[j];
          break;
        }
      }
      if (tab) {
        if (tab.type === 'image' || tab.type === 'pdf' || tab.type === 'binary') {
          showToast('该文件仅支持本地预览，不能作为 AI 文本上下文', 'error');
          return;
        }
        // document type is allowed — will be extracted at send time
      } else {
        // File not open — check by extension
        var ext = path.slice(path.lastIndexOf('.')).toLowerCase();
        var imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.ico', '.webp', '.tiff', '.tif', '.avif', '.heic', '.heif'];
        if (ext === '.pdf' || imgExts.indexOf(ext) !== -1) {
          showToast('该文件仅支持本地预览，不能作为 AI 文本上下文', 'error');
          return;
        }
        // document extensions are allowed — will be extracted at send time
      }

      state.contextPaths[path] = true;
    }

    renderContextPanel();
    renderTabs();
  }

  // ──────────────────────────────────────────────
  // sanitizeContextPaths() — remove invalid paths
  // ──────────────────────────────────────────────
  function sanitizeContextPaths() {
    var removed = [];
    var paths = Object.keys(state.contextPaths);
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var shouldRemove = false;

      // Check restricted files
      if (isRestrictedContextFile(p)) {
        shouldRemove = true;
      }

      // Check if open tab is image/PDF/binary
      if (!shouldRemove) {
        for (var j = 0; j < state.openTabs.length; j++) {
          if (state.openTabs[j].path === p) {
            var t = state.openTabs[j];
            if (t.type === 'image' || t.type === 'pdf' || t.type === 'binary') {
              shouldRemove = true;
            }
            // document type is allowed — will be extracted at send time
            break;
          }
        }
      }

      // Check extension for unopened files
      if (!shouldRemove) {
        var ext = p.slice(p.lastIndexOf('.')).toLowerCase();
        var imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.ico', '.webp', '.tiff', '.tif', '.avif', '.heic', '.heif'];
        if (ext === '.pdf' || imgExts.indexOf(ext) !== -1) {
          shouldRemove = true;
        }
      }

      if (shouldRemove) {
        delete state.contextPaths[p];
        removed.push(p);
      }
    }
    return removed;
  }

  // ──────────────────────────────────────────────
  // renderContextPanel()
  // ──────────────────────────────────────────────
  function renderContextPanel() {
    if (!_dom.contextPanel) return;

    // Clean up invalid paths
    var removed = sanitizeContextPaths();
    if (removed.length > 0) {
      renderTabs();
    }

    var paths = Object.keys(state.contextPaths);
    var totalSize = 0;

    _dom.contextPanel.innerHTML = '';

    if (paths.length === 0) {
      _dom.contextPanel.innerHTML =
        '<div class="context-header">' +
          '<span>AI 上下文</span>' +
          '<span class="context-count">0</span>' +
        '</div>' +
        '<div class="context-list" style="padding:8px 12px;font-size:11px;color:var(--cw-text-muted);">' +
          '右键点击文件，选择"添加到 AI 上下文"以添加文件供 AI 分析' +
        '</div>';
      return;
    }

    var header = document.createElement('div');
    header.className = 'context-header';
    header.innerHTML =
      '<span>AI 上下文</span>' +
      '<span class="context-count">' + paths.length + ' / 12</span>';
    _dom.contextPanel.appendChild(header);

    var list = document.createElement('div');
    list.className = 'context-list';

    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var name = fileNameFromPath(p);

      // Calculate size from open tabs
      var sizeText = '';
      for (var j = 0; j < state.openTabs.length; j++) {
        if (state.openTabs[j].path === p) {
          sizeText = formatSize(state.openTabs[j].size || 0);
          break;
        }
      }

      var item = document.createElement('span');
      item.className = 'code-context-item';
      item.title = p;
      item.innerHTML =
        '<span class="context-item-icon">📄</span>' +
        '<span class="context-item-name">' + escapeHTML(name) + '</span>' +
        (sizeText ? '<span style="font-size:10px;color:var(--cw-text-muted);margin-left:2px">' + sizeText + '</span>' : '') +
        '<span class="context-item-remove">✕</span>';

      // Click to open file
      item.addEventListener('click', function (path) {
        return function (e) {
          if (e.target.classList.contains('context-item-remove')) return;
          openFile(path);
        };
      }(p));

      // Remove button
      var removeBtn = item.querySelector('.context-item-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function (path) {
          return function (e) {
            e.stopPropagation();
            delete state.contextPaths[path];
            renderContextPanel();
            renderTabs();
          };
        }(p));
      }

      list.appendChild(item);
    }

    _dom.contextPanel.appendChild(list);
  }

  // ──────────────────────────────────────────────
  // renderChatPanel()
  // ──────────────────────────────────────────────
  function renderChatPanel() {
    if (!_dom.chatPanel) return;
    _dom.chatPanel.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'chat-header';
    header.innerHTML =
      '<span>AI 代码助手</span>' +
      '<span class="chat-model-badge">Agent</span>';
    _dom.chatPanel.appendChild(header);

    var messages = document.createElement('div');
    messages.className = 'code-chat-messages';
    messages.id = 'codeChatMessages';
    _dom.chatPanel.appendChild(messages);

    // Render existing messages
    for (var i = 0; i < state.messages.length; i++) {
      appendChatMessage(state.messages[i], messages);
    }

    var inputArea = document.createElement('div');
    inputArea.className = 'code-chat-input-area';
    inputArea.innerHTML =
      '<textarea id="codeChatInput" placeholder="输入消息，AI 将基于上下文文件回答..." rows="1"></textarea>' +
      '<button class="send-btn" id="codeChatSendBtn" title="发送">➤</button>';
    _dom.chatPanel.appendChild(inputArea);

    // Auto-resize textarea
    var input = document.getElementById('codeChatInput');
    var sendBtn = document.getElementById('codeChatSendBtn');

    if (input) {
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        sendMessage();
      });
    }

    // Scroll to bottom
    scrollChatToBottom();
  }

  function parseSimpleMarkdown(text) {
    if (typeof window.marked !== 'undefined') {
      try {
        return window.marked.parse(text);
      } catch (e) { /* ignore */ }
    }
    // Escape HTML first
    var html = escapeHTML(text);
    // Code blocks
    html = html.replace(/```[a-z]*\n([\s\S]*?)```/gi, '<pre><code>$1</code></pre>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function appendChatMessage(msg, container) {
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'code-chat-message ' + (msg.role === 'user' ? 'user' : 'assistant');

    var avatarText = msg.role === 'user' ? '你' : 'AI';
    var avatar = '<div class="msg-avatar">' + escapeHTML(avatarText) + '</div>';

    var body = '<div class="msg-body">';
    body += '<div class="msg-content markdown-body">' + parseSimpleMarkdown(msg.content) + '</div>';
    if (msg.time) {
      body += '<div class="msg-time">' + escapeHTML(msg.time) + '</div>';
    }
    body += '</div>';

    el.innerHTML = avatar + body;
    container.appendChild(el);
  }

  function scrollChatToBottom() {
    var container = document.getElementById('codeChatMessages');
    if (container) {
      setTimeout(function () {
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  }

  // ──────────────────────────────────────────────
  // sendMessage()
  // ──────────────────────────────────────────────
  function sendMessage() {
    if (state.sending) return;

    var input = document.getElementById('codeChatInput');
    if (!input) return;
    var message = input.value.trim();
    if (!message) return;

    // Disable UI
    state.sending = true;
    input.disabled = true;
    var sendBtn = document.getElementById('codeChatSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    // Cancel previous request
    if (state._abortController) {
      try { state._abortController.abort(); } catch (e) { /* ignore */ }
    }
    state._abortController = new AbortController();
    var requestId = ++state._requestId;

    var now = new Date();
    var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    // Add user message to state
    state.messages.push({ role: 'user', content: message, time: timeStr });

    input.value = '';
    input.style.height = 'auto';

    // Re-render chat
    try {
      renderChatPanel();
      // Show typing indicator
      showTypingIndicator();
    } catch (e) {
      state.sending = false;
      var curInput = document.getElementById('codeChatInput');
      if (curInput) curInput.disabled = false;
      var curSendBtn = document.getElementById('codeChatSendBtn');
      if (curSendBtn) curSendBtn.disabled = false;
      return;
    }

    // Final defense: clean up invalid context paths before sending
    sanitizeContextPaths();

    // Read all context files from disk (not just open tabs)
    var contextPaths = Object.keys(state.contextPaths);
    var fs = window.__xtjCodeFS;
    var readPromises = [];

    for (var i = 0; i < contextPaths.length; i++) {
      (function (p) {
        readPromises.push(
          new Promise(function (resolve) {
            // Check if file is open and has unsaved changes
            var openTab = null;
            for (var j = 0; j < state.openTabs.length; j++) {
              if (state.openTabs[j].path === p) {
                openTab = state.openTabs[j];
                break;
              }
            }

            // If file is an image or PDF, skip for context
            if (openTab && (openTab.type === 'image' || openTab.type === 'pdf' || openTab.type === 'binary')) {
              resolve(null);
              return;
            }

            // If file is a restricted context file, skip
            if (isRestrictedContextFile(p)) {
              resolve(null);
              return;
            }

            // Read from disk
            if (!fs || !fs.readFileByPath) {
              resolve(null);
              return;
            }

            fs.readFileByPath(p).then(function (result) {
              if (!result) {
                resolve(null);
                return;
              }

              // Handle document type: extract text via backend API
              if (result.type === 'document') {
                if (!fs.readDocumentText) {
                  resolve(null);
                  return;
                }
                fs.readDocumentText(result._arrayBuffer, result.name, result.mimeType).then(function (docData) {
                  if (!docData || !docData.text) {
                    resolve(null);
                    return;
                  }
                  var docContent = '【文档: ' + p + '】\n' + docData.text;
                  if (docData.truncated) {
                    docContent += '\n\n[注意: 文档内容过长，已截断]';
                  }
                  var encoder = new TextEncoder();
                  var contentBytes = encoder.encode(docContent).length;
                  if (contentBytes > 500 * 1024) {
                    // Truncate to 500KB for AI context
                    var truncated = docContent.slice(0, 500 * 1024);
                    docContent = truncated + '\n\n[文档内容过长，已截断至 500KB]';
                  }
                  resolve({
                    path: p,
                    language: 'document',
                    content: docContent,
                    sha256: result.sha256 || ''
                  });
                }).catch(function (err) {
                  console.error('[code-workspace] Document extraction failed:', p, err);
                  resolve({ path: p, error: '文档提取失败: ' + ((err && err.message) || '未知错误') });
                });
                return;
              }

              // For text files
              if (result.type !== 'text') {
                resolve(null);
                return;
              }

              // Use _currentContent if file has unsaved modifications
              var content = result.content;
              if (openTab && openTab.modified && openTab._currentContent !== undefined) {
                content = openTab._currentContent;
              }

              // Compute SHA-256 of the actual content being sent to AI
              getSHA256(content).then(function (computedSha) {
                resolve({
                  path: p,
                  language: getFileLanguage(p),
                  content: content,
                  sha256: computedSha || result.sha256 || ''
                });
              }).catch(function () {
                // Fallback: use disk SHA if computation fails
                resolve({
                  path: p,
                  language: getFileLanguage(p),
                  content: content,
                  sha256: result.sha256 || ''
                });
              });
            }).catch(function (err) {
              console.error('[code-workspace] Failed to read context file:', p, err);
              resolve({ path: p, error: (err && err.message) ? err.message : String(err) });
            });
          })
        );
      })(contextPaths[i]);
    }

    Promise.all(readPromises).then(function (results) {
      // Check if request was cancelled
      if (requestId !== state._requestId) return;

      var files = [];
      var failedFiles = [];
      var totalBytes = 0;

      for (var k = 0; k < results.length; k++) {
        var r = results[k];
        if (!r) continue;
        if (r.error) {
          failedFiles.push(r.path + ': ' + r.error);
          continue;
        }
        // Recalculate SHA-256 for files with unsaved changes
        var contentBytes = new TextEncoder().encode(r.content).length;
        if (totalBytes + contentBytes > 600 * 1024) {
          showToast('AI 上下文文件总内容超过 600 KB 限制，请减少上下文文件', 'error');
          state.sending = false;
          var curInput = document.getElementById('codeChatInput');
          if (curInput) curInput.disabled = false;
          var curSendBtn = document.getElementById('codeChatSendBtn');
          if (curSendBtn) curSendBtn.disabled = false;
          removeTypingIndicator();
          return;
        }
        totalBytes += contentBytes;

        files.push({
          path: r.path,
          language: r.language,
          content: r.content,
          sha256: r.sha256
        });
      }

      if (failedFiles.length > 0) {
        showToast('部分文件读取失败: ' + failedFiles.join('; '), 'error');
      }

      // Build history WITHOUT the current message (dedup)
      // The current message was just pushed to state.messages, so exclude it
      var historyMsgs = state.messages.slice(0, -1).slice(-20).map(function (m) {
        return { role: m.role, content: m.content };
      });

      // Build request
      var body = {
        workspace_name: state.workspaceName || '',
        message: message,
        active_path: state.activePath || '',
        history: historyMsgs,
        files: files
      };

      return sendApiRequest(body, requestId, timeStr);
    }).catch(function (err) {
      if (requestId !== state._requestId) return;
      removeTypingIndicator();
      var errMsg = (err && err.message) ? err.message : String(err);
      state.messages.push({ role: 'assistant', content: '抱歉，请求失败: ' + errMsg, time: timeStr });
      renderChatPanel();
      state.sending = false;
      var curInput = document.getElementById('codeChatInput');
      if (curInput) curInput.disabled = false;
      var curSendBtn = document.getElementById('codeChatSendBtn');
      if (curSendBtn) curSendBtn.disabled = false;
    });
  }

  function sendApiRequest(body, requestId, timeStr) {
    var sendBtn = document.getElementById('codeChatSendBtn');
    var input = document.getElementById('codeChatInput');

    var apiCall;
    if (window.xtjProtectedFetch) {
      apiCall = window.xtjProtectedFetch('/api/code/chat', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: state._abortController ? state._abortController.signal : undefined
      });
    } else {
      apiCall = fetch('/api/code/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: state._abortController ? state._abortController.signal : undefined
      });
    }

    apiCall.then(function (resp) {
      if (requestId !== state._requestId) return;
      if (!resp.ok) {
        throw new Error('API 请求失败: ' + resp.status + ' ' + (resp.statusText || ''));
      }
      return resp.json();
    }).then(function (data) {
      if (requestId !== state._requestId) return;

      // Remove typing indicator
      removeTypingIndicator();

      var replyContent = (data && data.reply) ? data.reply : '（无响应）';
      var now2 = new Date();
      var timeStr2 = now2.getHours().toString().padStart(2, '0') + ':' + now2.getMinutes().toString().padStart(2, '0');

      state.messages.push({ role: 'assistant', content: replyContent, time: timeStr2 });

      // Store operations
      if (data && data.operations && Array.isArray(data.operations)) {
        state.pendingOperations = data.operations;
      }

      renderChatPanel();

      // Show diff view if operations exist
      if (state.pendingOperations.length > 0) {
        renderDiffView();
      }
    }).catch(function (err) {
      if (requestId !== state._requestId) return;
      // AbortError is not a real failure
      if (err && err.name === 'AbortError') return;

      removeTypingIndicator();

      var errMsg = (err && err.message) ? err.message : String(err);
      state.messages.push({ role: 'assistant', content: '抱歉，请求失败: ' + errMsg, time: timeStr });

      renderChatPanel();
    }).then(function () {
      if (requestId !== state._requestId) return;
      // Re-enable UI
      state.sending = false;
      state._abortController = null;
      var inp = document.getElementById('codeChatInput');
      if (inp) inp.disabled = false;
      var sb = document.getElementById('codeChatSendBtn');
      if (sb) sb.disabled = false;
    });
  }

  function isRestrictedContextFile(path) {
    if (!path) return false;
    var name = fileNameFromPath(path).toLowerCase();
    var restricted = [
      '.env', '.env.local', '.env.development', '.env.production',
      'credentials.json', 'id_rsa', 'id_rsa.pub'
    ];
    for (var i = 0; i < restricted.length; i++) {
      if (name === restricted[i]) return true;
    }
    if (name.endsWith('.pem') || name.endsWith('.key')) return true;
    return false;
  }

  function showTypingIndicator() {
    var container = document.getElementById('codeChatMessages');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'code-chat-typing';
    el.id = 'codeTypingIndicator';
    el.innerHTML =
      '<span class="typing-dot"></span>' +
      '<span class="typing-dot"></span>' +
      '<span class="typing-dot"></span>';
    container.appendChild(el);
    scrollChatToBottom();
  }

  function removeTypingIndicator() {
    var el = document.getElementById('codeTypingIndicator');
    if (el) {
      try { el.remove(); } catch (e) { /* ignore */ }
    }
  }

  // ──────────────────────────────────────────────
  // renderDiffView()
  // ──────────────────────────────────────────────
  function renderDiffView() {
    if (!_dom.editorArea) return;
    if (state.pendingOperations.length === 0) {
      // Remove existing diff view
      var existingDiff = document.getElementById('codeDiffView');
      if (existingDiff) existingDiff.remove();
      var existingApplyBar = document.getElementById('codeApplyBar');
      if (existingApplyBar) existingApplyBar.remove();
      return;
    }

    // Remove existing diff view
    var existingDiff = document.getElementById('codeDiffView');
    if (existingDiff) existingDiff.remove();
    var existingApplyBar = document.getElementById('codeApplyBar');
    if (existingApplyBar) existingApplyBar.remove();

    // Hide editor area current content, show diff
    var editorContainer = document.getElementById('codeEditorContainer');
    var previewArea = document.getElementById('codePreviewArea');
    if (editorContainer) editorContainer.style.display = 'none';
    if (previewArea) previewArea.style.display = 'none';

    var diffView = document.createElement('div');
    diffView.className = 'code-diff-view';
    diffView.id = 'codeDiffView';

    var diffBody = document.createElement('div');
    diffBody.className = 'code-diff-body stacked';

    for (var i = 0; i < state.pendingOperations.length; i++) {
      var op = state.pendingOperations[i];

      // Header for this operation
      var header = document.createElement('div');
      header.className = 'code-diff-header';
      header.innerHTML =
        '<span class="diff-file-path">' + escapeHTML(op.path || '') + '</span>' +
        (op.summary ? '<span class="diff-stats">' + escapeHTML(op.summary) + '</span>' : '');
      diffBody.appendChild(header);

      // Before (original)
      var before = document.createElement('div');
      before.className = 'code-diff-before';
      before.style.overflow = 'auto';
      before.style.maxHeight = '200px';
      before.style.padding = '8px 0';
      before.style.borderBottom = '1px solid var(--cw-border)';

      var beforeLabel = document.createElement('div');
      beforeLabel.style.cssText = 'padding:2px 14px;font-size:11px;color:var(--cw-text-muted);font-weight:600;';
      beforeLabel.textContent = '当前内容';
      before.appendChild(beforeLabel);

      // Get original content from snapshot or tab
      var originalContent = '';
      if (state.snapshots[op.path] && state.snapshots[op.path].beforeContent !== undefined) {
        originalContent = state.snapshots[op.path].beforeContent;
      } else {
        for (var j = 0; j < state.openTabs.length; j++) {
          if (state.openTabs[j].path === op.path) {
            originalContent = state.openTabs[j].content || '';
            break;
          }
        }
      }

      if (op.type === 'document') {
        // Document operation: show operations list instead of text diff
        var docInfo = document.createElement('div');
        docInfo.style.padding = '12px 14px';
        docInfo.style.cssText = 'padding:12px 14px;color:var(--cw-text);font-size:13px;';

        var ext = (op.path || '').split('.').pop().toLowerCase();
        var docType = ext === 'docx' ? 'Word' : ext === 'xlsx' ? 'Excel' : '文档';
        docInfo.innerHTML = '<div style="margin-bottom:8px;font-weight:600;">' +
          escapeHTML(docType + ' 修改') + '</div>' +
          '<div style="margin-bottom:6px;">' +
          '  将另存为: <strong>' + escapeHTML(op.path.replace(/(\.[^.]+)$/, '_AI修改版$1')) + '</strong>' +
          '</div>';

        if (op.document_operations && op.document_operations.length > 0) {
          var opsList = document.createElement('ul');
          opsList.style.cssText = 'margin:8px 0;padding-left:20px;list-style:disc;';
          for (var di = 0; di < op.document_operations.length; di++) {
            var dop = op.document_operations[di];
            var li = document.createElement('li');
            li.style.cssText = 'margin:4px 0;line-height:1.5;';
            li.textContent = (dop.type || '修改') + ': ' + (dop.description || JSON.stringify(dop));
            opsList.appendChild(li);
          }
          docInfo.appendChild(opsList);
        } else {
          docInfo.innerHTML += '<div style="color:var(--cw-text-muted);">无详细操作描述</div>';
        }

        before.appendChild(docInfo);
      } else {
        var newContent = op.new_content || '';
        var diffLines = computeDiff(originalContent, newContent);

        for (var k = 0; k < diffLines.length; k++) {
          var line = diffLines[k];
          var lineEl = document.createElement('div');
          lineEl.className = 'code-diff-line ' + line.type;
          lineEl.innerHTML =
            '<span class="line-num">' + (line.lineNum ? line.lineNum : '') + '</span>' +
            '<span class="line-content">' + escapeHTML(line.text) + '</span>';
          before.appendChild(lineEl);
        }
      }

      diffBody.appendChild(before);
    }

    diffView.appendChild(diffBody);
    _dom.editorArea.appendChild(diffView);

    // Apply bar
    var applyBar = document.createElement('div');
    applyBar.className = 'code-apply-bar';
    applyBar.id = 'codeApplyBar';
    applyBar.innerHTML =
      '<span class="apply-info">' + state.pendingOperations.length + ' 个文件待应用' + '</span>' +
      '<div class="apply-actions">' +
        '<button class="code-btn code-btn-ghost" id="codeUndoBtn">撤销</button>' +
        '<button class="code-btn code-btn-primary" id="codeApplyAllBtn">全部应用</button>' +
      '</div>';

    _dom.editorArea.appendChild(applyBar);

    // Bind buttons
    var undoBtn = document.getElementById('codeUndoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function () {
        undoOperations();
      });
    }

    var applyAllBtn = document.getElementById('codeApplyAllBtn');
    if (applyAllBtn) {
      applyAllBtn.addEventListener('click', function () {
        applyAllOperations();
      });
    }
  }

  function computeDiff(original, newContent) {
    var oldLines = (original || '').split('\n');
    var newLines = (newContent || '').split('\n');

    // Simple line-by-line diff
    var result = [];
    var maxLen = Math.max(oldLines.length, newLines.length);

    // Find common prefix
    var prefixLen = 0;
    while (prefixLen < oldLines.length && prefixLen < newLines.length && oldLines[prefixLen] === newLines[prefixLen]) {
      result.push({ type: 'unchanged', text: oldLines[prefixLen], lineNum: prefixLen + 1 });
      prefixLen++;
    }

    // Find common suffix
    var suffixLen = 0;
    while (
      suffixLen < oldLines.length - prefixLen &&
      suffixLen < newLines.length - prefixLen &&
      oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    // Removed lines
    for (var i = prefixLen; i < oldLines.length - suffixLen; i++) {
      result.push({ type: 'removed', text: oldLines[i], lineNum: i + 1 });
    }

    // Added lines
    for (var j = prefixLen; j < newLines.length - suffixLen; j++) {
      result.push({ type: 'added', text: newLines[j], lineNum: j + 1 });
    }

    // Suffix
    for (var k = oldLines.length - suffixLen; k < oldLines.length; k++) {
      result.push({ type: 'unchanged', text: oldLines[k], lineNum: k + 1 });
    }

    return result;
  }

  // ──────────────────────────────────────────────
  // applyDocumentOperation(op, index)
  // ──────────────────────────────────────────────
  function applyDocumentOperation(op, index) {
    if (state._applyLock) return Promise.reject(new Error('已有操作正在进行中'));
    state._applyLock = true;

    var fs = window.__xtjCodeFS;
    if (!fs || !fs.readFileByPath || !fs.writeBinaryFileByPath) {
      state._applyLock = false;
      return Promise.reject(new Error('File system not available'));
    }

    // Read original file as ArrayBuffer
    return fs.readFileByPath(op.path).then(function (result) {
      if (!result || !result.content) {
        throw new Error('无法读取文件');
      }

      // result.content is an ArrayBuffer for document files.
      // Convert ArrayBuffer to base64 for sending to the backend API.
      var buffer = result.content;
      var bytes = new Uint8Array(buffer);
      var binaryStr = '';
      for (var i = 0; i < bytes.length; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
      }
      var base64 = btoa(binaryStr);

      // Call backend API to apply document operations, sending the file content
      var ext = op.path.split('.').pop().toLowerCase();
      var mimeType = ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                     ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                     'application/octet-stream';

      var apiCall;
      if (window.xtjProtectedFetch) {
        apiCall = window.xtjProtectedFetch('/api/code/document/apply', {
          method: 'POST',
          body: JSON.stringify({
            file: base64,
            fileName: op.path.split('/').pop(),
            mimeType: mimeType,
            document_type: op.document_type || ext,
            document_operations: op.document_operations || []
          })
        });
      } else {
        apiCall = fetch('/api/code/document/apply', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file: base64,
            fileName: op.path.split('/').pop(),
            mimeType: mimeType,
            document_type: op.document_type || ext,
            document_operations: op.document_operations || []
          })
        });
      }

      return apiCall.then(function (resp) {
        if (!resp.ok) {
          return resp.json().then(function (data) {
            throw new Error(data.error || '文档操作失败');
          });
        }
        return resp.json();
      }).then(function (data) {
        if (!data.ok || !data.newFile) {
          throw new Error(data.error || '文档操作返回数据无效');
        }

        // Decode returned base64 content
        var newBinaryStr = atob(data.newFile);
        var newBytes = new Uint8Array(newBinaryStr.length);
        for (var i = 0; i < newBinaryStr.length; i++) {
          newBytes[i] = newBinaryStr.charCodeAt(i);
        }

        // Save as new file (don't overwrite original)
        var dotIdx = op.path.lastIndexOf('.');
        var baseName = dotIdx >= 0 ? op.path.substring(0, dotIdx) : op.path;
        var extName = dotIdx >= 0 ? op.path.substring(dotIdx) : '';
        var newPath = baseName + '_AI\u4fee\u6539\u7248' + extName;

        return fs.createBinaryFileByPath(newPath, newBytes.buffer).then(function () {
          // Remove operation from pending
          state.pendingOperations.splice(index, 1);

          // Refresh file tree
          refreshFileTree();

          // Open the new file
          openFile(newPath);

          showToast('\u5df2\u4fdd\u5b58\u4e3a: ' + newPath.split('/').pop(), 'success');
          state._applyLock = false;
          return true;
        });
      });
    }).catch(function (err) {
      state._applyLock = false;
      showToast('\u6587\u6863\u64cd\u4f5c\u5931\u8d25: ' + (err && err.message ? err.message : String(err)), 'error');
      throw err;
    });
  }

  // ──────────────────────────────────────────────
  // applyOperation(index)
  // ──────────────────────────────────────────────
  function applyOperation(index) {
    if (index < 0 || index >= state.pendingOperations.length) {
      return Promise.reject(new Error('Invalid operation index'));
    }

    var op = state.pendingOperations[index];
    if (!op || !op.path) {
      return Promise.reject(new Error('Invalid operation'));
    }

    var fs = window.__xtjCodeFS;
    if (!fs || !fs.writeFileByPath) {
      return Promise.reject(new Error('File system not available'));
    }

    // Document operation (DOCX/XLSX): delegate to applyDocumentOperation
    if (op.type === 'document') {
      return applyDocumentOperation(op, index);
    }

    if (op.type === 'create') {
      // Create operation: use createFileByPath with proper existence check
      // Save snapshot with existed=false before creating
      if (!state.snapshots[op.path]) {
        state.snapshots[op.path] = { existed: false, beforeContent: '', beforeSha256: '' };
      }
      return fs.createFileByPath(op.path, op.new_content || '').then(function (writeResult) {
        // Optionally open the new file in a tab
        for (var i = 0; i < state.openTabs.length; i++) {
          if (state.openTabs[i].path === op.path) {
            state.openTabs[i].content = op.new_content || '';
            state.openTabs[i].sha256 = writeResult.sha256 || '';
            state.openTabs[i].modified = false;
            state.openTabs[i]._currentContent = undefined;
            break;
          }
        }
        state.pendingOperations.splice(index, 1);
        if (state.activePath === op.path) {
          renderEditor();
        }
        showToast('已创建: ' + op.path, 'success');
        return true;
      });
    }

    // Update operation: re-read existing file and verify SHA-256
    if (!fs.readFileByPath) {
      return Promise.reject(new Error('File system not available'));
    }

    return fs.readFileByPath(op.path).then(function (result) {
      if (!result) {
        throw new Error('无法读取文件: ' + op.path);
      }

      if (op.expected_sha256 && result.sha256 !== op.expected_sha256) {
        throw new Error('文件 "' + op.path + '" 已被修改，与 AI 生成回复时的内容不一致。请重新生成。');
      }

      // Take snapshot of current content before writing
      if (!state.snapshots[op.path]) {
        state.snapshots[op.path] = {
          existed: true,
          beforeContent: result.type === 'text' ? result.content : '',
          beforeSha256: result.sha256 || ''
        };
      }

      // Write new content
      return fs.writeFileByPath(op.path, op.new_content || '');
    }).then(function (writeResult) {
      // Update open tab if file is open
      for (var i = 0; i < state.openTabs.length; i++) {
        if (state.openTabs[i].path === op.path) {
          state.openTabs[i].content = op.new_content || '';
          state.openTabs[i].sha256 = writeResult.sha256 || '';
          state.openTabs[i].modified = false;
          state.openTabs[i]._currentContent = undefined;
          break;
        }
      }

      // Remove operation from pending
      state.pendingOperations.splice(index, 1);

      // Update editor if this file is active
      if (state.activePath === op.path) {
        renderEditor();
      }

      showToast('已应用: ' + op.path, 'success');
      return true;
    }).catch(function (err) {
      showToast('应用失败: ' + (err && err.message ? err.message : String(err)), 'error');
      throw err;
    });
  }

  // ──────────────────────────────────────────────
  // applyAllOperations()
  // ──────────────────────────────────────────────
  function applyAllOperations() {
    if (state._applyLock) return;
    state._applyLock = true;
    state.applying = true;

    var applyBtn = document.getElementById('codeApplyAllBtn');
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = '应用...';
    }

    function applyNext(idx) {
      if (idx >= state.pendingOperations.length) {
        // All done
        state._applyLock = false;
        state.applying = false;
        renderDiffView();
        renderTabs();
        showToast('所有操作已应用', 'success');
        return;
      }

      applyOperation(idx).then(function () {
        applyNext(idx); // Index stays same because we removed the previous
      }).catch(function () {
        // Stop on error
        state._applyLock = false;
        state.applying = false;
        renderDiffView();
        renderTabs();
      });
    }

    applyNext(0);
  }

  // ──────────────────────────────────────────────
  // undoOperations()
  // ──────────────────────────────────────────────
  function undoOperations() {
    var snapshotPaths = Object.keys(state.snapshots);
    if (snapshotPaths.length === 0) {
      showToast('没有可撤销的操作', 'info');
      return;
    }

    var fs = window.__xtjCodeFS;
    if (!fs) {
      showToast('文件系统不可用', 'error');
      return;
    }

    var promises = [];
    var successPaths = [];
    var failedPaths = [];

    for (var i = 0; i < snapshotPaths.length; i++) {
      (function (p, snapshot) {
        promises.push(
          new Promise(function (resolve) {
            if (snapshot.existed === false) {
              // This was a create operation — delete the file
              if (!fs.deleteFileByPath) {
                // Fallback: write empty string (not ideal but we can't delete)
                fs.writeFileByPath(p, '').then(function () {
                  successPaths.push(p);
                  resolve(true);
                }).catch(function (err) {
                  console.error('[code-workspace] undo delete failed for', p, err);
                  failedPaths.push(p);
                  resolve(false);
                });
                return;
              }
              fs.deleteFileByPath(p).then(function () {
                successPaths.push(p);
                resolve(true);
              }).catch(function (err) {
                console.error('[code-workspace] undo delete failed for', p, err);
                failedPaths.push(p);
                resolve(false);
              });
              return;
            }

            // Update operation — restore original content
            if (!fs.writeFileByPath) {
              failedPaths.push(p);
              resolve(false);
              return;
            }

            fs.writeFileByPath(p, snapshot.beforeContent || '').then(function () {
              // Update open tab
              for (var j = 0; j < state.openTabs.length; j++) {
                if (state.openTabs[j].path === p) {
                  state.openTabs[j].content = snapshot.beforeContent || '';
                  state.openTabs[j].modified = false;
                  state.openTabs[j]._currentContent = undefined;
                  state.openTabs[j].sha256 = snapshot.beforeSha256 || '';
                  break;
                }
              }
              successPaths.push(p);
              resolve(true);
            }).catch(function (err) {
              console.error('[code-workspace] undo error for', p, err);
              failedPaths.push(p);
              resolve(false);
            });
          })
        );
      })(snapshotPaths[i], state.snapshots[snapshotPaths[i]]);
    }

    Promise.all(promises).then(function () {
      // Only remove successful snapshots
      for (var k = 0; k < successPaths.length; k++) {
        delete state.snapshots[successPaths[k]];
      }

      state.pendingOperations = [];
      renderDiffView();
      renderTabs();
      if (state.activePath) {
        renderEditor();
      }

      if (failedPaths.length > 0) {
        showToast('部分文件撤销失败: ' + failedPaths.join(', '), 'error');
      } else {
        showToast('已撤销所有更改 (' + successPaths.length + ' 个文件)', 'info');
      }
    });
  }

  // ──────────────────────────────────────────────
  // Event: window beforeunload
  // ──────────────────────────────────────────────
  window.addEventListener('beforeunload', function () {
    cleanup();
  });

  // ──────────────────────────────────────────────
  // Keyboard shortcuts
  // ──────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (!state.active) return;

    // Ctrl+S: save active file
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      if (state.activePath && !state._monacoEditor) {
        e.preventDefault();
        saveFile(state.activePath);
      }
    }

    // Ctrl+W: close active tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      if (state.activePath) {
        e.preventDefault();
        closeTab(state.activePath);
      }
    }
  });

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────
  window.__xtjCodeWorkspaceAPI = {
    init: init,
    cleanup: cleanup,
    openFile: openFile,
    closeTab: closeTab,
    saveFile: saveFile,
    toggleContext: toggleContext,
    getState: function () { return state; },
    selectAndOpenWorkspace: selectAndOpenWorkspace
  };

  // Exports for desktop-shell.js integration
  window.__xtjCodeInit = init;
  window.__xtjCodeRefreshWorkspace = function () {
    // Refresh: re-render file tree and chat
    if (state.active && state.directoryHandle) {
      renderFileTree();
      renderContextPanel();
      showToast('工作区已刷新', 'info');
    }
    return Promise.resolve();
  };

})();