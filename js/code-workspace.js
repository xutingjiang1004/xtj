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
    workspaceMode: 'local', // 'local' or 'github'
    fileHandles: {},
    openTabs: [],
    activePath: '',
    pinnedFiles: [], // Replaces contextPaths — only priority hints, not full uploads
    projectIndexStatus: null, // { totalFiles, totalChunks, builtAt, indexed }
    lastReadContext: null, // { files_read: [], total_chunks, total_tokens, truncated }
    lastRuntime: null, // { provider, model, configuredContextTokens, promptTokens, toolReadTokens, cacheHitTokens, cacheMissTokens, completionTokens, remainingEstimatedTokens }
    lastToolTrace: [],
    capabilities: null,
    attachments: [],
    lastSentAttachmentPaths: [],
    attachmentProcessing: false,
    attachmentError: '',
    messages: [],
    lastFailedMessage: '',
    conversationId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    pendingOperations: [],
    snapshots: {},
    sending: false,
    applying: false,
    _applyLock: false,
    _monacoLoaded: false,
    _monacoEditor: null,
    _objectUrls: [],
    _abortController: null,
    _attachmentController: null,
    _githubController: null,
    _githubLoadPromise: null,
    _githubLoadKey: '',
    _githubErrorKey: '',
    _indexController: null,
    _indexStatusController: null,
    _indexBuildPromise: null,
    _indexStatusPromise: null,
    _indexBuildKey: '',
    _capabilitiesPromise: null,
    _openFilePromises: {},
    _savePromises: {},
    _undoLock: false,
    _requestId: 0,
    _themeObserver: null,
    _isReadOnly: false,
    _persistenceFailed: false, // P0-9: 标记 IndexedDB 持久化是否失败
    workspaceGeneration: 0,
    restoreGeneration: 0
  };

  // ──────────────────────────────────────────────
  // DOM cache
  // ──────────────────────────────────────────────
  var _dom = {};
  var MAX_OPEN_FILE_CONTEXT = 12;
  var MAX_OPEN_FILE_CHARS = 240000;
  var MAX_OPEN_FILES_TOTAL_CHARS = 900000;
  var MAX_ATTACHMENTS = 8;
  // Keep each index request comfortably below the server JSON/body limit.
  var MAX_INDEX_BATCH_BYTES = 3 * 1024 * 1024;
  // Must stay aligned with render-api/code-agent.js MAX_DOCUMENT_UPLOAD_BYTES.
  var MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;
  var MAX_ATTACHMENT_TOTAL_CHARS = 1600000;
  var ATTACHMENT_ACCEPT = '.docx,.pdf,.xlsx,.xls,.pptx,.txt,.csv,.md,.markdown,.json';

  // Phase 2: Feature flag for streaming Code agent
var CODE_STREAM_ENABLED = true;

  // Phase 3: Feature flag for stream resume
  var CODE_STREAM_RESUME_ENABLED = (function () {
    try { return localStorage.getItem('CODE_STREAM_RESUME_ENABLED') === '1'; } catch (e) { return false; }
  })();

  // Phase 3: Stream resume state (saved to sessionStorage)
  var STREAM_RESUME_MAX_RETRIES = 5;
  var STREAM_RETRY_DELAYS = [500, 1000, 2000, 4000, 8000]; // Exponential backoff

  // Phase 4: Feature flag for persistent index
  var CODE_PERSISTENT_INDEX_ENABLED = (function () {
    try { return localStorage.getItem('CODE_PERSISTENT_INDEX_ENABLED') === '1'; } catch (e) { return false; }
  })();

  // Phase 4: IndexedDB stores for workspace manifest and file metadata
  var _indexedDB = null;
  var INDEXED_DB_NAME = 'xtj_code_index';
  var INDEXED_DB_VERSION = 1;

  function openIndexedDB() {
    if (_indexedDB) return Promise.resolve(_indexedDB);
    if (!CODE_PERSISTENT_INDEX_ENABLED) return Promise.resolve(null);
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
      request.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('code_workspaces')) {
          db.createObjectStore('code_workspaces', { keyPath: 'workspaceKey' });
        }
        if (!db.objectStoreNames.contains('code_file_manifest')) {
          var store = db.createObjectStore('code_file_manifest', { keyPath: 'id' });
          store.createIndex('workspaceKey', 'workspaceKey', { unique: false });
          store.createIndex('path', 'path', { unique: false });
        }
        if (!db.objectStoreNames.contains('code_drafts')) {
          db.createObjectStore('code_drafts', { keyPath: 'id' });
        }
      };
      request.onsuccess = function (e) {
        _indexedDB = e.target.result;
        resolve(_indexedDB);
      };
      request.onerror = function (e) {
        console.warn('[CODE-INDEXEDDB] Failed to open:', e.target.error);
        resolve(null);
      };
    });
  }

  function idbGet(storeName, key) {
    return openIndexedDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function (e) {
          var err = e.target.error || new Error('IndexedDB get failed');
          console.warn('[CODE-INDEXEDDB] idbGet error:', storeName, key, err && err.name);
          reject(err);
        };
      });
    });
  }

  function idbPut(storeName, value) {
    return openIndexedDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        store.put(value);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) {
          var err = e.target.error || new Error('IndexedDB put failed');
          console.warn('[CODE-INDEXEDDB] idbPut error:', storeName, err && err.name);
          reject(err);
        };
        tx.onabort = function (e) {
          var err = e.target.error || new Error('IndexedDB put aborted');
          console.warn('[CODE-INDEXEDDB] idbPut abort:', storeName, err && err.name);
          reject(err);
        };
      });
    });
  }

  function idbGetAll(storeName) {
    return openIndexedDB().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function (e) {
          var err = e.target.error || new Error('IndexedDB getAll failed');
          console.warn('[CODE-INDEXEDDB] idbGetAll error:', storeName, err && err.name);
          reject(err);
        };
      });
    });
  }

  function idbDelete(storeName, key) {
    return openIndexedDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) {
          var err = e.target.error || new Error('IndexedDB delete failed');
          console.warn('[CODE-INDEXEDDB] idbDelete error:', storeName, key, err && err.name);
          reject(err);
        };
        tx.onabort = function (e) {
          var err = e.target.error || new Error('IndexedDB delete aborted');
          console.warn('[CODE-INDEXEDDB] idbDelete abort:', storeName, key, err && err.name);
          reject(err);
        };
      });
    });
  }

  function idbClear(storeName) {
    return openIndexedDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) {
          var err = e.target.error || new Error('IndexedDB clear failed');
          console.warn('[CODE-INDEXEDDB] idbClear error:', storeName, err && err.name);
          reject(err);
        };
        tx.onabort = function (e) {
          var err = e.target.error || new Error('IndexedDB clear aborted');
          console.warn('[CODE-INDEXEDDB] idbClear abort:', storeName, err && err.name);
          reject(err);
        };
      });
    });
  }

  // Phase 4: Save workspace info to IndexedDB
  function saveWorkspaceToIDB(workspaceId, workspaceName) {
    if (!CODE_PERSISTENT_INDEX_ENABLED) return Promise.resolve();
    var workspaceKey = 'local_folder:' + String(workspaceId || getWorkspaceId());
    return idbPut('code_workspaces', {
      workspaceKey: workspaceKey,
      workspaceId: workspaceId || getWorkspaceId(),
      workspaceName: workspaceName || getWorkspaceId(),
      sourceType: 'local_folder',
      generation: state.workspaceGeneration || 0,
      lastOpenedAt: Date.now()
    });
  }

  // Phase 4: Save file manifest to IndexedDB
  function saveFileManifestToIDB(files) {
    if (!CODE_PERSISTENT_INDEX_ENABLED) return Promise.resolve();
    var workspaceId = getWorkspaceId();
    if (!workspaceId) return Promise.resolve();
    var workspaceKey = 'local_folder:' + workspaceId;
    var now = Date.now();

    // P0-7: Only delete records for the current workspaceKey, not the entire store
    return idbGetAll('code_file_manifest').then(function (allRecords) {
      var deletePromises = [];
      for (var i = 0; i < allRecords.length; i++) {
        if (allRecords[i].workspaceKey === workspaceKey) {
          deletePromises.push(idbDelete('code_file_manifest', allRecords[i].id));
        }
      }
      return Promise.all(deletePromises);
    }).then(function () {
      var promises = [];
      for (var i = 0; i < files.length && i < 1000; i++) {
        var f = files[i];
        (function (file) {
          promises.push(idbPut('code_file_manifest', {
            id: workspaceKey + ':' + file.path,
            workspaceKey: workspaceKey,
            workspaceId: workspaceId,
            path: file.path,
            size: file.size || 0,
            lastModified: file.modifiedAt || 0,
            sha256: file.sha256 || '',
            lastIndexedSha256: file.sha256 || '',
            lastSeenGeneration: state.workspaceGeneration || 0,
            updatedAt: now
          }));
        })(f);
      }
      return Promise.all(promises);
    });
  }

  // Phase 4: Get stored manifest from IndexedDB
  function getStoredManifest() {
    if (!CODE_PERSISTENT_INDEX_ENABLED) return Promise.resolve([]);
    var workspaceId = getWorkspaceId();
    var workspaceKey = 'local_folder:' + workspaceId;
    return idbGetAll('code_file_manifest').then(function (records) {
      // P0-7: Filter by current workspaceKey to avoid cross-workspace pollution
      return records.filter(function (r) {
        return r.workspaceKey === workspaceKey;
      }).map(function (r) {
        return {
          path: r.path,
          size: r.size || 0,
          modifiedAt: r.lastModified || 0,
          sha256: r.lastIndexedSha256 || r.sha256 || ''
        };
      });
    }).catch(function (err) {
      // P0-9: IndexedDB 读取失败时降级为会话内索引，不阻塞构建
      console.warn('[CODE-INDEXEDDB] getStoredManifest failed, falling back to session-only index:', err && err.name);
      return [];
    });
  }

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

  // P0: 文档格式能力定义 — 拆分文件系统权限与 AI 文档能力
  function getDocumentFormatCapability(ext) {
    if (!ext) ext = '';
    ext = ext.toLowerCase();
    var cap = { readable: true, analyzable: true, writable: false, savable: false, exportable: false, label: '只读' };
    if (ext === 'docx') {
      cap.writable = true;
      cap.savable = true;
      cap.exportable = true;
      cap.experimental = true; // P1-5: 标记为实验性修改，直到可靠性验证完成
      cap.label = '可读取 · 可分析 · 实验性修改 · 另存副本';
    } else if (ext === 'xlsx' || ext === 'xls') {
      cap.writable = true;
      cap.savable = true;
      cap.exportable = true;
      cap.label = '可读取 · 可分析 · 可修改 · 可保存';
    } else if (ext === 'pdf') {
      cap.writable = false;
      cap.savable = false;
      cap.exportable = true;
      cap.label = '可读取 · 可分析 · 可导出（PDF 原位编辑不支持，可生成新文档）';
    } else if (ext === 'pptx') {
      cap.writable = true;
      cap.savable = true;
      cap.exportable = true;
      cap.experimental = true; // P1-5: 标记为实验性修改，直到可靠性验证完成
      cap.label = '可读取 · 可分析 · 实验性修改 · 另存副本';
    } else if (ext === 'txt' || ext === 'csv' || ext === 'md' || ext === 'markdown') {
      cap.writable = true;
      cap.savable = true;
      cap.exportable = true;
      cap.label = '可读取 · 可分析 · 可修改 · 可保存';
    } else if (ext === 'json') {
      cap.writable = true;
      cap.savable = true;
      cap.exportable = true;
      cap.label = '可读取 · 可分析 · 可修改 · 可保存';
    }
    return cap;
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
      '.docx': 'file-doc',
      '.xlsx': 'file-xls', '.xls': 'file-xls',
      '.csv': 'file-csv'
    };
    return map[ext] || 'file-icon';
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
    // P0: 幂等 — 已激活时直接返回
    if (state.active) {
      return Promise.resolve({ status: 'already-active' });
    }

    var panelCode = document.getElementById('panelCode');
    if (!panelCode || !panelCode.offsetParent) {
      // P0: 面板不可见时返回明确状态
      return Promise.resolve({ status: 'hidden' });
    }

    state.active = true;

    _dom.panelCode = document.getElementById('panelCode');
    if (!_dom.panelCode) {
      console.warn('[code-workspace] panelCode not found');
      state.active = false;
      return Promise.resolve({ status: 'no-panel' });
    }

    // P0: 先立即显示欢迎页，IndexedDB 恢复在后台进行
    renderWelcome();

    // P0: 后台尝试恢复工作区，使用 restoreGeneration 防止覆盖用户新选择
    var restoreGeneration = ++state.restoreGeneration;

    tryRestoreWorkspace().then(function (result) {
      if (restoreGeneration !== state.restoreGeneration) return;
      if (!state.active) return;

      if (result && result.status === 'granted') {
        state.directoryHandle = result.handle;
        state.workspaceName = result.handle.name;
        state.workspaceMode = 'local';
        state._isReadOnly = false;
        renderWorkspace();
        if (result.kind === 'file') {
          window.setTimeout(function () { openFile(state.workspaceName); }, 0);
        }
      }
      // 如果不是 granted，欢迎页已经显示，用户可以看到恢复入口
    }).catch(function () {
      // 欢迎页已经显示，忽略恢复错误
    });

    return Promise.resolve({ status: 'ok' });
  }

  function tryRestoreWorkspace() {
    if (!window.__xtjCodeFS || !window.__xtjCodeFS.restoreWorkspace) {
      return Promise.resolve({ status: 'missing' });
    }
    return window.__xtjCodeFS.restoreWorkspace({ requestPermission: false }).then(function (result) {
      return result;
    }).catch(function () {
      return { status: 'error' };
    });
  }

  // ──────────────────────────────────────────────
  // cleanup() — called when leaving Code tab
  // ──────────────────────────────────────────────
  function cleanup() {
    var hasUnsaved = state.openTabs.some(function(t) { return t.modified && t._currentContent !== undefined; });
    if (hasUnsaved) {
      if (!window.confirm('文件存在未保存修改，是否继续？')) {
        return false; // Signal cancellation to caller
      }
    }
    // Cancel any in-flight request via activeRequest context
    if (state.activeRequest) {
      finalizeRequest(state.activeRequest, { cancelReason: 'cleanup', done: false });
    }
    abortController(state._attachmentController);
    abortController(state._githubController);
    abortController(state._indexController);
    abortController(state._indexStatusController);
    state._attachmentController = null;
    state._githubController = null;
    state._indexController = null;
    state._indexStatusController = null;
    state._githubLoadPromise = null;
    state._indexBuildPromise = null;
    state._openFilePromises = {};
    state._savePromises = {};
    state._requestId++;
    revokeAllUrls();
    disposeMonaco();
    state.sending = false;
    clearAttachments();
    state.lastSentAttachmentPaths = [];
    state.active = false;
    _dom = {};
    if (typeof _dragState !== 'undefined' && _dragState) {
      document.body.classList.remove('code-is-resizing');
      document.body.classList.remove('code-is-resizing-row');
      _dragState = null;
    }
    // Don't clear directoryHandle so workspace can be restored
    return true;
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
      '<h2 class="welcome-title">打开工作区开始</h2>' +
      '<p class="welcome-desc">选择 GitHub 仓库、本地文件夹或单个文件，浏览和编辑内容，或使用 AI 助手进行代码操作。</p>' +
      '<div class="welcome-actions">' +
        '<button class="folder-picker-btn-large primary" id="codeWelcomeGitHubBtn">' +
          '<span class="folder-icon">🔗</span> 打开 GitHub 仓库（推荐）' +
        '</button>' +
        '<button class="folder-picker-btn-large" id="codeWelcomeLocalBtn">' +
          '<span class="folder-icon">📂</span> 打开本地文件夹' +
        '</button>' +
        '<button class="folder-picker-btn-large" id="codeWelcomeFileBtn">' +
          '<span class="folder-icon">📄</span> 直接打开文件' +
        '</button>' +
      '</div>' +
      '<p class="welcome-recent" id="codeWelcomeRecent" style="display:none"></p>';

    _dom.panelCode.appendChild(welcome);

    // Bind GitHub repo button
    var githubBtn = document.getElementById('codeWelcomeGitHubBtn');
    if (githubBtn) {
      githubBtn.addEventListener('click', function () {
        renderGitHubRepoSelector();
      });
    }

    // Bind local folder button
    var localBtn = document.getElementById('codeWelcomeLocalBtn');
    if (localBtn) {
      localBtn.addEventListener('click', function () {
        selectAndOpenWorkspace();
      });
    }

    // Bind the single-file entry point here.  The composer is rendered only
    // after a workspace is open, so binding this button from renderComposer()
    // leaves the welcome-page action inert.
    var fileBtn = document.getElementById('codeWelcomeFileBtn');
    if (fileBtn) {
      fileBtn.addEventListener('click', function () {
        selectAndOpenFile();
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
      restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复上次工作区';
      restoreBtn.title = '上次打开: ' + stored;

      var statusText = document.createElement('span');
      statusText.className = 'welcome-status';
      statusText.id = 'codeWelcomeStatus';

      recentEl.appendChild(restoreBtn);
      recentEl.appendChild(statusText);

      restoreBtn.addEventListener('click', function () {
        var manualRestoreGeneration = ++state.restoreGeneration;
        restoreBtn.disabled = true;
        restoreBtn.innerHTML = '<span class="folder-icon">⏳</span> 正在恢复...';
        statusText.textContent = '';
        statusText.className = 'welcome-status';

        if (!window.__xtjCodeFS || !window.__xtjCodeFS.restoreWorkspace) {
          statusText.textContent = '文件系统 API 不可用';
          statusText.className = 'welcome-status error';
          restoreBtn.disabled = false;
          restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复上次工作区';
          return;
        }

        window.__xtjCodeFS.restoreWorkspace({ requestPermission: true }).then(function (result) {
          if (!state.active || manualRestoreGeneration !== state.restoreGeneration) return;
          restoreBtn.disabled = false;
          restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复上次工作区';

          if (result.status === 'granted') {
            resetWorkspaceState();
            state.directoryHandle = result.handle;
            state.workspaceName = result.handle.name;
            state.workspaceMode = 'local';
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
          } else if (result.status === 'timeout') {
            statusText.innerHTML = '工作区恢复超时，可能是浏览器存储记录损坏。<br><button class="code-retry-btn" id="codeClearStorageBtn">清除旧记录</button>';
            statusText.className = 'welcome-status error';
            bindClearStorageBtn(statusText, recentEl);
          } else if (result.status === 'error') {
            statusText.innerHTML = '工作区恢复失败，可能是浏览器存储记录损坏。<br><button class="code-retry-btn" id="codeClearStorageBtn">清除旧记录</button>';
            statusText.className = 'welcome-status error';
            bindClearStorageBtn(statusText, recentEl);
          } else if (result.status === 'prompt') {
            statusText.textContent = '需要授权才能恢复工作区，请点击按钮重试';
            statusText.className = 'welcome-status warning';
          } else {
            statusText.innerHTML = '恢复失败，请重新选择文件夹<br><button class="code-retry-btn" id="codeClearStorageBtn">清除旧记录</button>';
            statusText.className = 'welcome-status error';
            bindClearStorageBtn(statusText, recentEl);
          }
        }).catch(function (err) {
          if (!state.active || manualRestoreGeneration !== state.restoreGeneration) return;
          restoreBtn.disabled = false;
          restoreBtn.innerHTML = '<span class="folder-icon">🔄</span> 恢复上次工作区';
          statusText.innerHTML = '恢复失败，可能是浏览器存储记录损坏。<br><button class="code-retry-btn" id="codeClearStorageBtn">清除旧记录</button>';
          statusText.className = 'welcome-status error';
          bindClearStorageBtn(statusText, recentEl);
        });
      });
    }
  }

  function bindClearStorageBtn(statusText, recentEl) {
    var clearBtn = document.getElementById('codeClearStorageBtn');
    if (!clearBtn) return;
    clearBtn.addEventListener('click', function () {
      clearBtn.disabled = true;
      clearBtn.textContent = '正在清除...';
      if (!window.__xtjCodeFS || !window.__xtjCodeFS.clearWorkspaceStorage) {
        statusText.textContent = '文件系统 API 不可用';
        statusText.className = 'welcome-status error';
        clearBtn.disabled = false;
        clearBtn.textContent = '清除旧记录';
        return;
      }

      window.__xtjCodeFS.clearWorkspaceStorage().then(function (result) {
        clearBtn.disabled = false;
        clearBtn.textContent = '清除旧记录';

        if (result && result.ok) {
          statusText.textContent = '旧记录已清除，请重新选择文件夹';
          statusText.className = 'welcome-status success';
          if (recentEl) recentEl.style.display = 'none';
        } else if (result && result.blocked) {
          statusText.textContent = result.error || '数据库被占用，请关闭其他 XTJ 页面后重试';
          statusText.className = 'welcome-status error';
        } else {
          statusText.textContent = '清除失败: ' + (result && result.error ? result.error : '未知错误');
          statusText.className = 'welcome-status error';
        }
      }).catch(function (err) {
        clearBtn.disabled = false;
        clearBtn.textContent = '清除旧记录';
        statusText.textContent = '清除失败: ' + (err && err.message ? err.message : String(err));
        statusText.className = 'welcome-status error';
      });
    });
  }

  function selectAndOpenFile() {
    var selectionGeneration = ++state.restoreGeneration;
    if (hasUnsavedChanges() && !confirm('当前工作区存在未保存内容。打开单个文件将放弃这些修改，是否继续？')) {
      return;
    }

    var fs = window.__xtjCodeFS;
    if (!fs) {
      showToast('文件系统不可用', 'error');
      return;
    }

    function openSelectedHandle(handle, readOnly) {
      if (!handle) return;
      if (!state.active || selectionGeneration !== state.restoreGeneration) return;
      resetWorkspaceState();
      state.directoryHandle = handle;
      state.workspaceName = handle.name || '单个文件';
      state.workspaceMode = 'local';
      state._isReadOnly = !!readOnly;
      try { localStorage.setItem('xtj_code_workspace_name', state.workspaceName); } catch (e) { /* ignore */ }
      renderWorkspace();
      if (handle && handle._isSingleFileRoot) {
        window.setTimeout(function () {
          openFile(handle.name);
        }, 0);
      }
    }

    if (typeof fs.selectFile === 'function' && window.showOpenFilePicker && window.isSecureContext) {
      var fileBtn = document.getElementById('codeWelcomeFileBtn');
      var originalText = fileBtn ? fileBtn.innerHTML : '';
      if (fileBtn) {
        fileBtn.disabled = true;
        fileBtn.innerHTML = '<span class="folder-icon">⏳</span> 请在弹窗中选择文件...';
      }
      fs.selectFile().then(function (handle) {
        if (fileBtn) { fileBtn.disabled = false; fileBtn.innerHTML = originalText; }
        if (!state.active || selectionGeneration !== state.restoreGeneration) {
          // selectFile() installs its synthetic single-file root immediately.
          // Restore the still-current workspace when an older picker resolves
          // after the user has already switched elsewhere.
          if (state.directoryHandle && fs.setDirHandle) fs.setDirHandle(state.directoryHandle);
          return;
        }
        openSelectedHandle(handle, false);
      }).catch(function (err) {
        if (fileBtn) { fileBtn.disabled = false; fileBtn.innerHTML = originalText; }
        if (err && err.name === 'AbortError') return;
        showToast('打开文件失败：' + (err && err.message ? err.message : String(err)), 'error');
      });
      return;
    }

    // Compatibility fallback for Firefox, HTTP development pages, and older
    // Chromium: this remains read-only because a File object has no writable
    // FileSystemFileHandle behind it.
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = false;
    input.accept = '*/*';
    input.onchange = function () {
      if (!state.active || selectionGeneration !== state.restoreGeneration) return;
      var file = input.files && input.files[0];
      if (!file) return;
      var mockFileHandle = {
        kind: 'file',
        name: file.name,
        getFile: function () { return Promise.resolve(file); }
      };
      if (fs.setDirHandle) fs.setDirHandle(mockFileHandle);
      openSelectedHandle(fs.getDirHandle ? fs.getDirHandle() : mockFileHandle, true);
    };
    input.click();
  }

  function apiFetch(url, options) {
    options = options || {};
    if (window.xtjProtectedFetch) {
      return window.xtjProtectedFetch(url, options);
    }
    var fallbackOptions = {};
    Object.keys(options).forEach(function (key) { fallbackOptions[key] = options[key]; });
    fallbackOptions.credentials = 'include';
    return fetch(url, fallbackOptions);
  }

  function postJson(url, body, signal) {
    return apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: signal
    });
  }

  function responseJson(response, fallbackMessage) {
    if (!response) return Promise.reject(new Error(fallbackMessage || '请求失败'));
    return response.text().then(function (text) {
      var data = null;
      try { data = JSON.parse(text); } catch (e) {}
      if (!response.ok) {
        var error = new Error(data && data.error ? data.error : (fallbackMessage || ('请求失败: ' + response.status)));
        error.status = response.status;
        error.code = data && data.code;
        throw error;
      }
      if (!data) throw new Error(fallbackMessage || '服务器返回格式无效');
      return data;
    });
  }

  function getWorkspaceId() {
    var mode = state.workspaceMode === 'github' ? 'github' : 'local';
    return mode + ':' + String(state.workspaceName || 'default').slice(0, 180);
  }

  function getWorkspaceScope(workspaceId, generation) {
    return {
      workspace_id: workspaceId || getWorkspaceId(),
      workspace_generation: generation === undefined ? state.workspaceGeneration : generation
    };
  }

  function abortController(controller) {
    if (!controller) return;
    try { controller.abort(); } catch (e) { /* ignore */ }
  }

  function createNamedAbortError() {
    var error = new Error('Request aborted');
    error.name = 'AbortError';
    return error;
  }

  function resetWorkspaceState() {
    var previousWorkspaceId = getWorkspaceId();
    var previousGeneration = state.workspaceGeneration;
    // P0: 中止所有进行中的 AI 请求
    if (state._abortController) {
      try { state._abortController.abort(); } catch (e) { /* ignore */ }
      state._abortController = null;
    }
    abortController(state._attachmentController);
    abortController(state._githubController);
    abortController(state._indexController);
    abortController(state._indexStatusController);
    state._attachmentController = null;
    state._githubController = null;
    state._indexController = null;
    state._indexStatusController = null;
    state._githubLoadPromise = null;
    state._githubLoadKey = '';
    state._indexBuildPromise = null;
    state._indexStatusPromise = null;
    state._indexBuildKey = '';
    _activeBuildContext = null;
    state._openFilePromises = {};
    state._savePromises = {};
    state._undoLock = false;
    state._requestId++;
    state.sending = false;
    state.workspaceGeneration++;
    state.openTabs = [];
    state.activePath = '';
    state.pinnedFiles = [];
    state.projectIndexStatus = null;
    state.lastReadContext = null;
    state.lastToolTrace = [];
    clearAttachments();
    state.lastSentAttachmentPaths = [];
    state.attachmentProcessing = false;
    state.attachmentError = '';
    state.pendingOperations = [];
    state.snapshots = {};
    state.fileHandles = {};
    state.messages = [];
    state.conversationId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    state.lastFailedMessage = '';
    state._isReadOnly = false;
    state._persistenceFailed = false;
    // Clear backend index
    try {
      postJson('/api/code/agent/clear_index', getWorkspaceScope(previousWorkspaceId, previousGeneration)).catch(function () {});
    } catch (e) { /* ignore */ }
    revokeAllUrls();
    disposeMonaco();
  }

  function hasUnsavedChanges() {
    return state.openTabs.some(function(t) { return t.modified && t._currentContent !== undefined; }) ||
           state.pendingOperations.length > 0 ||
           state.applying ||
           state.sending;
  }

  function selectAndOpenWorkspace() {
    // P0: 递增 restoreGeneration，使后台旧恢复立即失效
    var selectionGeneration = ++state.restoreGeneration;

    // P0: 检查未保存修改
    if (hasUnsavedChanges()) {
      if (!confirm('当前工作区存在未保存内容。更换文件夹将放弃这些修改，是否继续？')) {
        return;
      }
    }

    var btn = document.getElementById('codeWelcomeLocalBtn');
    if (!window.showDirectoryPicker) {
      // Fallback for browsers without File System Access API
      var input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.onchange = function(e) {
        if (!state.active || selectionGeneration !== state.restoreGeneration) return;
        if (!e.target.files || !e.target.files.length) return;
        var files = Array.from(e.target.files);
        var dirName = files[0].webkitRelativePath.split('/')[0] || 'Workspace';

        function createMockDirHandle(name, pathPrefix) {
          return {
            _isMock: true,
            name: name,
            kind: 'directory',
            getFileHandle: function(fileName) {
              return new Promise(function(resolve, reject) {
                var targetPath = pathPrefix + fileName;
                var file = files.find(function(f) { return f.webkitRelativePath === targetPath; });
                if (file) {
                  resolve({
                    name: fileName,
                    kind: 'file',
                    getFile: function() { return Promise.resolve(file); }
                  });
                } else {
                  reject(new Error("File not found"));
                }
              });
            },
            getDirectoryHandle: function(dirNameStr) {
              return new Promise(function(resolve, reject) {
                var targetPrefix = pathPrefix + dirNameStr + '/';
                var hasFiles = files.some(function(f) { return f.webkitRelativePath.startsWith(targetPrefix); });
                if (hasFiles) {
                  resolve(createMockDirHandle(dirNameStr, targetPrefix));
                } else {
                  reject(new Error("Directory not found"));
                }
              });
            },
            values: function() {
              var children = {};
              files.forEach(function(f) {
                if (f.webkitRelativePath.startsWith(pathPrefix)) {
                  var remainder = f.webkitRelativePath.substring(pathPrefix.length);
                  var slashIdx = remainder.indexOf('/');
                  if (slashIdx === -1) {
                    children[remainder] = {
                      name: remainder,
                      kind: 'file',
                      getFile: function() { return Promise.resolve(f); }
                    };
                  } else {
                    var childDirName = remainder.substring(0, slashIdx);
                    if (!children[childDirName]) {
                      children[childDirName] = createMockDirHandle(childDirName, pathPrefix + childDirName + '/');
                    }
                  }
                }
              });
              var handles = Object.values(children);
              var idx = 0;
              return {
                next: function() {
                  if (idx < handles.length) {
                    return Promise.resolve({ value: handles[idx++], done: false });
                  } else {
                    return Promise.resolve({ done: true });
                  }
                }
              };
            },
            entries: function() {
              var children = {};
              files.forEach(function(f) {
                if (f.webkitRelativePath.startsWith(pathPrefix)) {
                  var remainder = f.webkitRelativePath.substring(pathPrefix.length);
                  var slashIdx = remainder.indexOf('/');
                  if (slashIdx === -1) {
                    children[remainder] = {
                      name: remainder,
                      kind: 'file',
                      getFile: function() { return Promise.resolve(f); }
                    };
                  } else {
                    var childDirName = remainder.substring(0, slashIdx);
                    if (!children[childDirName]) {
                      children[childDirName] = createMockDirHandle(childDirName, pathPrefix + childDirName + '/');
                    }
                  }
                }
              });
              var handles = Object.entries(children);
              var idx = 0;
              return {
                next: function() {
                  if (idx < handles.length) {
                    return Promise.resolve({ value: handles[idx++], done: false });
                  } else {
                    return Promise.resolve({ done: true });
                  }
                }
              };
            }
          };
        }

        resetWorkspaceState();
        state.directoryHandle = createMockDirHandle(dirName, dirName + '/');
        state.workspaceName = dirName;
        state.workspaceMode = 'local';
        state._isReadOnly = true;
        // P1 #4: notify FS module of the mock handle so readFileByPath works
        if (window.__xtjCodeFS && window.__xtjCodeFS.setDirHandle) {
          window.__xtjCodeFS.setDirHandle(state.directoryHandle);
        }
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
      if (!state.active || selectionGeneration !== state.restoreGeneration) return;
      resetWorkspaceState();
      state.directoryHandle = handle;
      state.workspaceName = handle.name;
      state.workspaceMode = 'local';
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

  var _layoutState = {
    sidebarWidth: 260,
    chatWidth: 360,
    contextHeight: 180,
    sidebarCollapsed: false,
    chatCollapsed: false,
    contextCollapsed: false,
    maximizedPanel: null // 'editor' | 'chat' | null
  };

  function loadLayoutConfig() {
    try {
      var saved = localStorage.getItem('xtj_code_layout_v1');
      if (saved) {
        var p = JSON.parse(saved);
        if (typeof p.sidebarWidth === 'number') _layoutState.sidebarWidth = p.sidebarWidth;
        if (typeof p.chatWidth === 'number') _layoutState.chatWidth = p.chatWidth;
        if (typeof p.contextHeight === 'number') _layoutState.contextHeight = p.contextHeight;
        if (typeof p.sidebarCollapsed === 'boolean') _layoutState.sidebarCollapsed = p.sidebarCollapsed;
        if (typeof p.chatCollapsed === 'boolean') _layoutState.chatCollapsed = p.chatCollapsed;
        if (typeof p.contextCollapsed === 'boolean') _layoutState.contextCollapsed = p.contextCollapsed;
        if (p.maximizedPanel === 'editor' || p.maximizedPanel === 'chat' || p.maximizedPanel === null) _layoutState.maximizedPanel = p.maximizedPanel;
      }
    } catch (err) {}
  }

  function saveLayoutConfig() {
    try {
      localStorage.setItem('xtj_code_layout_v1', JSON.stringify(_layoutState));
    } catch (err) {}
  }

  var _saveLayoutDebounce = null;
  function triggerLayoutSave() {
    if (_saveLayoutDebounce) clearTimeout(_saveLayoutDebounce);
    _saveLayoutDebounce = setTimeout(saveLayoutConfig, 500);
  }

  function applyLayoutToDOM() {
    if (!_dom.panelCode) return;
    
    // Apply inline vars
    _dom.panelCode.style.setProperty('--cw-sidebar-width', _layoutState.sidebarWidth + 'px');
    _dom.panelCode.style.setProperty('--cw-chat-width', _layoutState.chatWidth + 'px');
    _dom.panelCode.style.setProperty('--cw-context-height', _layoutState.contextHeight + 'px');

    // Apply collapsed classes
    if (_layoutState.sidebarCollapsed || _layoutState.maximizedPanel === 'chat' || _layoutState.maximizedPanel === 'editor') {
      _dom.panelCode.classList.add('is-sidebar-collapsed');
    } else {
      _dom.panelCode.classList.remove('is-sidebar-collapsed');
    }

    if (_layoutState.chatCollapsed || _layoutState.maximizedPanel === 'editor') {
      _dom.panelCode.classList.add('is-chat-collapsed');
    } else {
      _dom.panelCode.classList.remove('is-chat-collapsed');
    }

    if (_layoutState.contextCollapsed && _dom.sidebar) {
      _dom.sidebar.classList.add('is-context-collapsed');
    } else if (_dom.sidebar) {
      _dom.sidebar.classList.remove('is-context-collapsed');
    }
    
    // Maximized chat handles hiding editor
    if (_layoutState.maximizedPanel === 'chat' && _dom.editorColumn) {
      _dom.editorColumn.style.display = 'none';
      _dom.panelCode.style.setProperty('--cw-chat-width', '100%');
    } else if (_dom.editorColumn) {
      _dom.editorColumn.style.display = 'flex';
      if (_layoutState.maximizedPanel !== 'chat') {
        _dom.panelCode.style.setProperty('--cw-chat-width', _layoutState.chatWidth + 'px');
      }
    }
    
    // If window is small (<1024), we should clamp things and override max
    if (window.innerWidth < 1024) {
      _dom.panelCode.classList.add('is-narrow-viewport');
    } else {
      _dom.panelCode.classList.remove('is-narrow-viewport');
    }
    
    if (window.monacoEditorInstance) {
      // Defer layout slightly so DOM is ready
      requestAnimationFrame(function() {
        if (window.monacoEditorInstance) window.monacoEditorInstance.layout();
      });
    }
  }

  function toggleSidebar() {
    _layoutState.sidebarCollapsed = !_layoutState.sidebarCollapsed;
    _layoutState.maximizedPanel = null;
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleChat() {
    _layoutState.chatCollapsed = !_layoutState.chatCollapsed;
    _layoutState.maximizedPanel = null;
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleMaximizeEditor() {
    if (_layoutState.maximizedPanel === 'editor') {
      _layoutState.maximizedPanel = null;
    } else {
      _layoutState.maximizedPanel = 'editor';
    }
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleMaximizeChat() {
    if (_layoutState.maximizedPanel === 'chat') {
      _layoutState.maximizedPanel = null;
    } else {
      _layoutState.maximizedPanel = 'chat';
    }
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function resetLayout() {
    _layoutState = {
      sidebarWidth: 260,
      chatWidth: 360,
      contextHeight: 180,
      sidebarCollapsed: false,
      chatCollapsed: false,
      contextCollapsed: false,
      maximizedPanel: null
    };
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function renderWorkspace() {
    if (!_dom.panelCode) return;
    _dom.panelCode.innerHTML = '';
    
    loadLayoutConfig();

    var shell = document.createElement('div');
    shell.className = 'code-workspace-shell';

    if (state._isReadOnly) {
      var banner = document.createElement('div');
      banner.className = 'code-readonly-banner';
      banner.style.cssText = 'background:#fff3cd;color:#856404;padding:8px 12px;font-size:12px;text-align:center;border-bottom:1px solid var(--cw-border);';
      banner.innerHTML = '当前浏览器使用只读文件夹模式。可以查看和分析文件，但不能直接保存修改。建议使用最新版 Chrome 或 Edge 获得完整读写能力。';
      shell.appendChild(banner);
    }

    var workspace = document.createElement('div');
    workspace.className = 'code-workspace';

    // ── Sidebar (left) ──
    var sidebar = document.createElement('div');
    sidebar.className = 'code-sidebar';

    var sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'code-sidebar-header';
    sidebarHeader.innerHTML =
      '<span class="workspace-name">' + escapeHTML(state.workspaceName || 'Workspace') + '</span>' +
      '<span class="code-panel-actions">' +
        '<button class="folder-picker-btn" title="更换文件夹">📁</button>' +
        '<button class="folder-picker-btn file-picker-btn" title="直接打开文件">📄</button>' +
        '<button class="code-panel-action-btn fold-sidebar-btn" title="折叠侧边栏"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '</span>';
    
    var changeBtn = sidebarHeader.querySelector('.folder-picker-btn');
    if (changeBtn) changeBtn.addEventListener('click', selectAndOpenWorkspace);
    var directFileBtn = sidebarHeader.querySelector('.file-picker-btn');
    if (directFileBtn) directFileBtn.addEventListener('click', selectAndOpenFile);
    var foldSidebarBtn = sidebarHeader.querySelector('.fold-sidebar-btn');
    if (foldSidebarBtn) foldSidebarBtn.addEventListener('click', toggleSidebar);

    sidebar.appendChild(sidebarHeader);

    var fileTree = document.createElement('div');
    fileTree.className = 'code-file-tree';
    fileTree.id = 'codeFileTree';
    sidebar.appendChild(fileTree);
    
    // Resizer for Context Panel
    var resizerContext = document.createElement('div');
    resizerContext.className = 'code-resizer code-resizer-context';
    resizerContext.setAttribute('role', 'separator');
    resizerContext.setAttribute('tabindex', '0');
    resizerContext.setAttribute('aria-orientation', 'horizontal');
    sidebar.appendChild(resizerContext);

    var contextPanel = document.createElement('div');
    contextPanel.className = 'code-context-panel';
    contextPanel.id = 'codeContextPanel';
    sidebar.appendChild(contextPanel);

    workspace.appendChild(sidebar);
    
    // Resizer Left (Sidebar / Editor)
    var resizerLeft = document.createElement('div');
    resizerLeft.className = 'code-resizer code-resizer-left';
    resizerLeft.setAttribute('role', 'separator');
    resizerLeft.setAttribute('tabindex', '0');
    resizerLeft.setAttribute('aria-orientation', 'vertical');
    resizerLeft.addEventListener('dblclick', resetLayout);
    workspace.appendChild(resizerLeft);

    // ── Editor column (center) ──
    var editorColumn = document.createElement('div');
    editorColumn.className = 'code-editor-column';

    var tabBar = document.createElement('div');
    tabBar.className = 'code-tab-bar';
    tabBar.id = 'codeTabBar';

    var tabList = document.createElement('div');
    tabList.style.cssText = 'display:flex;flex:1;overflow-x:auto;';
    tabBar.appendChild(tabList);

    // Add maximize button to tabBar
    var tabBarActions = document.createElement('div');
    tabBarActions.style.cssText = 'display:flex;align-items:center;padding:0 8px;border-left:1px solid var(--cw-border);';
    tabBarActions.innerHTML = 
      '<button class="code-panel-action-btn restore-layout-btn" title="恢复默认布局" style="margin-right:4px;">🪟</button>' +
      '<button class="code-panel-action-btn max-editor-btn" title="最大化编辑器"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>';
    tabBar.appendChild(tabBarActions);
    tabBarActions.querySelector('.restore-layout-btn').addEventListener('click', resetLayout);
    tabBarActions.querySelector('.max-editor-btn').addEventListener('click', toggleMaximizeEditor);
    editorColumn.appendChild(tabBar);

    var editorArea = document.createElement('div');
    editorArea.className = 'code-editor-area';
    editorArea.id = 'codeEditorArea';
    editorColumn.appendChild(editorArea);

    workspace.appendChild(editorColumn);
    
    // Resizer Right (Editor / Chat)
    var resizerRight = document.createElement('div');
    resizerRight.className = 'code-resizer code-resizer-right';
    resizerRight.setAttribute('role', 'separator');
    resizerRight.setAttribute('tabindex', '0');
    resizerRight.setAttribute('aria-orientation', 'vertical');
    resizerRight.addEventListener('dblclick', resetLayout);
    workspace.appendChild(resizerRight);

    // ── Chat panel (right) ──
    var chatPanel = document.createElement('div');
    chatPanel.className = 'code-chat-panel';
    chatPanel.id = 'codeChatPanel';
    
    // We need a header in chat panel for collapse/maximize
    var chatHeader = document.createElement('div');
    chatHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--cw-border);min-height:44px;flex-shrink:0;';
    chatHeader.innerHTML = 
      '<div style="font-weight:600;font-size:13px;"></div>' +
      '<div class="code-panel-actions">' +
        '<button class="code-panel-action-btn max-chat-btn" title="最大化"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>' +
        '<button class="code-panel-action-btn fold-chat-btn" title="折叠"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>' +
      '</div>';
    chatHeader.querySelector('.max-chat-btn').addEventListener('click', toggleMaximizeChat);
    chatHeader.querySelector('.fold-chat-btn').addEventListener('click', toggleChat);
    chatPanel.appendChild(chatHeader);
    
    // Container for original chat app
    var chatAppContainer = document.createElement('div');
    chatAppContainer.id = 'codeChatAppContainer';
    chatAppContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';
    chatPanel.appendChild(chatAppContainer);

    workspace.appendChild(chatPanel);

    _dom.panelCode.appendChild(shell);
    shell.appendChild(workspace);

    _dom.fileTree = fileTree;
    _dom.contextPanel = contextPanel;
    _dom.tabBar = tabList;
    _dom.editorArea = editorArea;
    _dom.chatPanel = chatAppContainer; // redirect original chat rendering here
    _dom.sidebar = sidebar;
    _dom.editorColumn = editorColumn;
    
    _dom.resizerLeft = resizerLeft;
    _dom.resizerRight = resizerRight;
    _dom.resizerContext = resizerContext;

    renderFileTree();
    renderEmptyState();
    renderProjectStatus();
    renderChatPanel();
    
    initResizerDragLogic();
    applyLayoutToDOM();

    loadProjectIndexStatus();
    restoreTabs();
  }

  // Pointer Events Drag Logic
  var _dragState = null;

  function initResizerDragLogic() {
    if (!_dom.resizerLeft || !_dom.resizerRight || !_dom.resizerContext) return;
    
    function onPointerDown(e, type) {
      if (e.button !== 0) return; // only left click
      e.preventDefault();
      var target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      
      var wsWidth = _dom.panelCode.offsetWidth || window.innerWidth;
      var sbHeight = _dom.sidebar.offsetHeight || window.innerHeight;
      
      _dragState = {
        type: type,
        target: target,
        startX: e.clientX,
        startY: e.clientY,
        startSidebarWidth: _layoutState.sidebarWidth,
        startChatWidth: _layoutState.chatWidth,
        startContextHeight: _layoutState.contextHeight,
        wsWidth: wsWidth,
        sbHeight: sbHeight
      };
      
      target.classList.add('is-resizing');
      document.body.classList.add(type === 'context' ? 'code-is-resizing-row' : 'code-is-resizing');
      
      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
      target.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (!_dragState) return;
      e.preventDefault();
      var dx = e.clientX - _dragState.startX;
      var dy = e.clientY - _dragState.startY;
      
      if (_dragState.type === 'left') {
        var newWidth = _dragState.startSidebarWidth + dx;
        // Clamp: min 180, max 45% or 560
        var maxW = Math.min(560, _dragState.wsWidth * 0.45);
        newWidth = Math.max(180, Math.min(newWidth, maxW));
        _layoutState.sidebarWidth = newWidth;
      } else if (_dragState.type === 'right') {
        // Dragging right resizer leftwards INCREASES chat width
        var newWidth = _dragState.startChatWidth - dx;
        // Clamp: min 280, max 55% or 760
        var maxW = Math.min(760, _dragState.wsWidth * 0.55);
        newWidth = Math.max(280, Math.min(newWidth, maxW));
        _layoutState.chatWidth = newWidth;
      } else if (_dragState.type === 'context') {
        // Dragging context resizer upwards INCREASES context height (wait, context is at bottom)
        // If context is at bottom, dragging up means smaller Y -> dx is negative.
        // wait, sidebar flex direction is column. Context is at the bottom.
        // So dy < 0 means context is getting taller.
        var newHeight = _dragState.startContextHeight - dy;
        var maxH = _dragState.sbHeight * 0.65;
        newHeight = Math.max(80, Math.min(newHeight, maxH));
        _layoutState.contextHeight = newHeight;
      }
      
      applyLayoutToDOM();
    }

    function onPointerUp(e) {
      if (!_dragState) return;
      var target = _dragState.target;
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
      
      target.classList.remove('is-resizing');
      document.body.classList.remove('code-is-resizing');
      document.body.classList.remove('code-is-resizing-row');
      
      triggerLayoutSave();
      _dragState = null;
    }

    _dom.resizerLeft.addEventListener('pointerdown', function(e) { onPointerDown(e, 'left'); });
    _dom.resizerRight.addEventListener('pointerdown', function(e) { onPointerDown(e, 'right'); });
    _dom.resizerContext.addEventListener('pointerdown', function(e) { onPointerDown(e, 'context'); });
    
    // Listen for resize to re-clamp
    window.addEventListener('resize', function() {
      if (_dom.panelCode && _dom.panelCode.offsetParent !== null) {
        applyLayoutToDOM();
      }
    });
  }


  // ──────────────────────────────────────────────
  // restoreTabs() — restore open tabs after cleanup
  // ──────────────────────────────────────────────
  function restoreTabs() {
    if (state.openTabs.length === 0) return Promise.resolve([]);
    var wsGen = state.workspaceGeneration;
    var tabsToRestore = state.openTabs.slice();

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
      return Promise.resolve([]);
    }

    // Re-read all open tabs to refresh content and blob URLs
    var readPromises = [];
    for (var i = 0; i < tabsToRestore.length; i++) {
      (function (tab) {
        readPromises.push(
          new Promise(function (resolve) {
            fs.readFileByPath(tab.path).then(function (result) {
              if (wsGen !== state.workspaceGeneration || state.openTabs.indexOf(tab) === -1) {
                if (result && (result.type === 'image' || result.type === 'pdf') && result.content) {
                  try { URL.revokeObjectURL(result.content); } catch (e) { /* ignore */ }
                }
                resolve({ tab: tab, stale: true });
                return;
              }
              if (!result) {
                // File was deleted externally
                resolve({ tab: tab, deleted: !tab.modified, failed: !!tab.modified });
                return;
              }
              // Update content for text files
              if (result.type === 'text') {
                if (tab.modified && tab._currentContent !== undefined) {
                  // Do not overwrite user's unsaved draft
                } else {
                  tab.content = result.content;
                  tab.sha256 = result.sha256 || '';
                  tab.modified = false;
                  tab._currentContent = undefined;
                }
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
            }).catch(function (error) {
              var notFound = error && (error.name === 'NotFoundError' || /\bnot found\b/i.test(error.message || ''));
              resolve({
                tab: tab,
                deleted: notFound && !tab.modified,
                failed: !notFound || !!tab.modified,
                error: error
              });
            });
          })
        );
      })(tabsToRestore[i]);
    }

    return Promise.all(readPromises).then(function (results) {
      if (wsGen !== state.workspaceGeneration) return results;
      // Remove tabs for deleted files
      var deletedPaths = [];
      var failedPaths = [];
      for (var k = results.length - 1; k >= 0; k--) {
        if (results[k].failed) failedPaths.push(results[k].tab.path);
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
      if (failedPaths.length > 0) {
        showToast('部分文件暂时无法重新读取，已保留标签和未保存内容', 'warning');
      }
      return results;
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

      // Expose toggle on wrapper for auto-expand (renderFileTree calls wrapper._toggle)
      wrapper._toggle = row._toggle;

      row.addEventListener('click', function (e) {
        e.stopPropagation();
        row._toggle();
      });
      wrapper._toggle = row._toggle;
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

    var inContext = state.pinnedFiles.indexOf(path) !== -1;
    var contextLabel = inContext ? '取消固定' : '固定到 AI 上下文';

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
    if (!path) return Promise.resolve(null);

    try {
      validatePath(path);
    } catch (e) {
      showToast('无效的文件路径', 'error');
      return Promise.resolve(null);
    }

    // Check if already open
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === path) {
        state.activePath = path;
        renderTabs();
        renderEditor();
        return Promise.resolve(state.openTabs[i]);
      }
    }

    // Read file
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.readFileByPath) {
      showToast('文件系统不可用', 'error');
      return Promise.resolve(null);
    }

    var wsGen = state.workspaceGeneration;
    var openKey = wsGen + ':' + path;
    if (state._openFilePromises[openKey]) return state._openFilePromises[openKey];

    var promise = fs.readFileByPath(path).then(function (result) {
      if (wsGen !== state.workspaceGeneration || !state.active) {
        if (result && (result.type === 'image' || result.type === 'pdf') && result.content) {
          try { URL.revokeObjectURL(result.content); } catch (e) { /* ignore */ }
        }
        return null;
      }
      if (!result) {
        showToast('无法读取文件: ' + path, 'error');
        return null;
      }

      // Another asynchronous path may have opened this file while it was read.
      for (var existingIndex = 0; existingIndex < state.openTabs.length; existingIndex++) {
        if (state.openTabs[existingIndex].path === path) {
          state.activePath = path;
          renderTabs();
          renderEditor();
          return state.openTabs[existingIndex];
        }
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

      // Auto-pin opened file as high priority (not full context upload)
      if ((tab.type === 'text' || tab.type === 'document') && state.pinnedFiles.indexOf(path) === -1) {
        if (!isRestrictedContextFile(path)) {
          state.pinnedFiles.push(path);
          renderProjectStatus();
        }
      }
      return tab;
    }).catch(function (err) {
      if (wsGen !== state.workspaceGeneration || !state.active) return null;
      showToast('打开文件失败: ' + (err && err.message ? err.message : String(err)), 'error');
      return null;
    }).then(function (result) {
      if (state._openFilePromises[openKey] === promise) {
        delete state._openFilePromises[openKey];
      }
      return result;
    });
    state._openFilePromises[openKey] = promise;
    return promise;
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

    if (tab.modified && tab._currentContent !== undefined) {
      if (!window.confirm('文件存在未保存修改，是否继续关闭？')) {
        return;
      }
    }

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

        var inContext = state.pinnedFiles.indexOf(tab.path) !== -1;
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
    } else if (tab.type === 'binary') {
      renderBinaryPreview(tab);
    } else {
      // Text editor
      renderTextEditor(tab);
    }
  }

  function renderBinaryPreview(tab) {
    if (!_dom.editorArea) return;
    _dom.editorArea.innerHTML = '';
    var container = document.createElement('div');
    container.className = 'code-preview-container pdf-preview-container';
    container.style.flex = '1';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.padding = '40px';
    container.style.color = 'var(--text-color)';

    var icon = document.createElement('div');
    icon.innerHTML = '📦';
    icon.style.fontSize = '48px';
    icon.style.marginBottom = '16px';

    var nameEl = document.createElement('h3');
    nameEl.textContent = tab.name;
    nameEl.style.marginBottom = '8px';

    var msg = document.createElement('p');
    msg.textContent = '该文件是二进制文件，当前仅显示文件信息，不能编辑或保存。';
    msg.style.opacity = '0.7';

    container.appendChild(icon);
    container.appendChild(nameEl);
    container.appendChild(msg);
    _dom.editorArea.appendChild(container);
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
          padding: { top: 12 },
          readOnly: !!state._isReadOnly
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
        (state._isReadOnly ? '<span class="toolbar-readonly-label">只读</span>' :
          '<button class="toolbar-btn" id="codeSaveBtn" title="保存 (Ctrl+S)">💾</button>') +
      '</div>';
    container.appendChild(toolbar);

    var textarea = document.createElement('textarea');
    textarea.className = 'code-textarea';
    textarea.value = tab._currentContent !== undefined ? tab._currentContent : (tab.content || '');
    textarea.spellcheck = false;
    textarea.readOnly = !!state._isReadOnly;
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
    if (state._isReadOnly) {
      showToast('当前为只读模式，不支持保存文件', 'error');
      return;
    }
    var tab = null;
    for (var i = 0; i < state.openTabs.length; i++) {
      if (state.openTabs[i].path === path) {
        tab = state.openTabs[i];
        break;
      }
    }
    if (!tab) return;

    if (tab.type === 'binary') {
      showToast('二进制文件不支持保存', 'error');
      return;
    }

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

    var wsGen = state.workspaceGeneration;
    var saveKey = wsGen + ':' + path;
    if (state._savePromises[saveKey]) return state._savePromises[saveKey];
    var promise = fs.writeFileByPath(path, content).then(function (result) {
      if (wsGen !== state.workspaceGeneration || state.openTabs.indexOf(tab) === -1) return false;
      var currentContent = tab._currentContent;
      if (state._monacoEditor && state.activePath === path) currentContent = state._monacoEditor.getValue();
      var unchanged = currentContent === undefined || currentContent === content;
      tab.content = content;
      tab.sha256 = result.sha256 || '';
      if (unchanged) {
        tab.modified = false;
        tab._currentContent = undefined;
      } else {
        tab.modified = true;
      }
      renderTabs();
      showToast(unchanged ? 'File saved' : 'Previous version saved; newer edits remain unsaved', unchanged ? 'success' : 'warning');
      return true;
    }).catch(function (err) {
      // A save belonging to a replaced workspace must not surface an error
      // toast in the new workspace. The operation is stale UI work.
      if (wsGen !== state.workspaceGeneration || state.openTabs.indexOf(tab) === -1) {
        return false;
      }
      showToast('保存失败: ' + (err && err.message ? err.message : String(err)), 'error');
      return false;
    }).then(function (result) {
      if (state._savePromises[saveKey] === promise) delete state._savePromises[saveKey];
      return result;
    });
    state._savePromises[saveKey] = promise;
    return promise;
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

    function renderDocData(docData) {
      if (!docData) return;

      var docIcon = '📄';
      var docLabel = '文档';
      var ext = (docData.ext || '').toLowerCase();
      if (ext === '.docx') { docIcon = '📝'; docLabel = 'Word 文档'; }
      else if (ext === '.xlsx' || ext === '.xls') { docIcon = '📊'; docLabel = 'Excel 表格'; }
      else if (ext === '.pptx') { docIcon = '📽️'; docLabel = 'PPT 演示'; }

      var html = '<div class="doc-preview-header">';
      html += '<span class="doc-preview-icon">' + docIcon + '</span>';
      html += '<div class="doc-preview-info">';
      html += '<span class="doc-preview-label">' + docLabel + '</span>';
      html += '<span class="doc-preview-name">' + escapeHTML(tab.name) + '</span>';
      if (docData.metadata) {
        if (docData.metadata.pages) html += '<span class="doc-preview-meta">' + docData.metadata.pages + ' 页</span>';
        if (docData.metadata.sheetCount) html += '<span class="doc-preview-meta">' + docData.metadata.sheetCount + ' 个工作表</span>';
        if (docData.metadata.slideCount) html += '<span class="doc-preview-meta">' + docData.metadata.slideCount + ' 页幻灯片</span>';
      }
      html += '</div></div>';

      html += '<div class="doc-preview-content">';
      if (docData.truncated) {
        html += '<div class="doc-preview-truncated">⚠ 内容过长，已截断显示</div>';
      }
      html += '<pre class="doc-preview-text">' + escapeHTML(docData.text) + '</pre>';
      html += '</div>';

      preview.innerHTML = html;
    }

    if (tab._extractedText) {
      renderDocData({
        text: tab._extractedText,
        truncated: tab._extractedTruncated,
        metadata: tab._extractedMetadata,
        ext: tab.name.match(/\.[^.]+$/) ? tab.name.match(/\.[^.]+$/)[0] : ''
      });
      // P0 Fix: 缓存命中时也要同步更新项目状态面板（修复正文已显示但状态仍为"正在解析"）
      renderProjectStatus();
      updateChatRequestControls();
      return;
    }
    
    if (tab._extractError) {
      preview.innerHTML = '<div class="doc-preview-error"><span class="doc-icon">📄</span><p>文档提取失败: ' + escapeHTML(tab._extractError) + '</p></div>';
      // P0 Fix: 解析失败时也要同步更新状态面板
      renderProjectStatus();
      updateChatRequestControls();
      return;
    }

    if (!tab._extractPromise) {
      tab._parseReady = false;
      tab._extractPromise = fs.readFileByPath(tab.path).then(function (result) {
        if (!result || result.type !== 'document') {
          throw new Error('无法读取文档文件');
        }
        return fs.readDocumentText(result._arrayBuffer, result.name, result.mimeType);
      }).then(function (docData) {
        if (!docData) return;
        tab._extractedText = docData.text;
        tab._extractedTruncated = docData.truncated;
        tab._extractedMetadata = docData.metadata;
        tab._parseReady = true;
        tab._extractError = null;
        docData.ext = tab.name.match(/\.[^.]+$/) ? tab.name.match(/\.[^.]+$/)[0] : '';
        return docData;
      }).catch(function (err) {
        tab._extractError = err && err.message ? err.message : '文档提取失败';
        tab._parseReady = false;
        throw err;
      });
    }

    tab._extractPromise.then(function (docData) {
      renderDocData(docData);
      // P0: 文档提取完成后同步更新项目状态面板
      renderProjectStatus();
      // 同步更新打开文件按钮状态
      updateChatRequestControls();
    }).catch(function (err) {
      preview.innerHTML = '<div class="doc-preview-error"><span class="doc-icon">📄</span><p>文档提取失败: ' + escapeHTML((err && err.message) || '未知错误') + '</p></div>';
      // P0: 提取失败也更新状态
      renderProjectStatus();
      updateChatRequestControls();
    });
  }

  // ──────────────────────────────────────────────
  // toggleContext(path) — now pinFile
  // ──────────────────────────────────────────────
  function toggleContext(path) {
    pinFile(path);
  }

  // ──────────────────────────────────────────────
  // pinFile(path) — pin a file as high priority for AI
  // ──────────────────────────────────────────────
  function pinFile(path) {
    if (!path) return;

    var idx = state.pinnedFiles.indexOf(path);
    if (idx !== -1) {
      state.pinnedFiles.splice(idx, 1);
    } else {
      // Check if file is restricted (sensitive files)
      if (isRestrictedContextFile(path)) {
        showToast('该文件包含敏感信息，不能添加到 AI 上下文', 'error');
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
        if (tab.type === 'image' || tab.type === 'binary') {
          showToast('该文件仅支持本地预览，不能作为 AI 文本上下文', 'error');
          return;
        }
      } else {
        var ext = path.slice(path.lastIndexOf('.')).toLowerCase();
        var imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif', '.avif', '.heic', '.heif'];
        if (imgExts.indexOf(ext) !== -1) {
          showToast('该文件仅支持本地预览，不能作为 AI 文本上下文', 'error');
          return;
        }
      }

      state.pinnedFiles.push(path);
    }

    // Sync with backend
    var isPinned = state.pinnedFiles.indexOf(path) !== -1;
    try {
      var pinBody = getWorkspaceScope();
      pinBody.path = path;
      pinBody.pinned = isPinned;
      postJson('/api/code/agent/pin_file', pinBody).catch(function () {});
    } catch (e) { /* ignore */ }

    renderProjectStatus();
    renderTabs();
  }

  function unpinFile(path) {
    var idx = state.pinnedFiles.indexOf(path);
    if (idx !== -1) {
      state.pinnedFiles.splice(idx, 1);
    }
    try {
      var pinBody = getWorkspaceScope();
      pinBody.path = path;
      pinBody.pinned = false;
      postJson('/api/code/agent/pin_file', pinBody).catch(function () {});
    } catch (e) { /* ignore */ }
    renderProjectStatus();
    renderTabs();
  }

  // ──────────────────────────────────────────────
  // buildProjectIndex() — scan workspace and build index
  // ──────────────────────────────────────────────
  function loadProjectIndexStatus() {
    if (state._indexStatusPromise) return state._indexStatusPromise;
    var workspaceId = getWorkspaceId();
    var wsGen = state.workspaceGeneration;
    abortController(state._indexStatusController);
    state._indexStatusController = new AbortController();
    var controller = state._indexStatusController;
    var promise = postJson('/api/code/index/status', getWorkspaceScope(workspaceId, wsGen), controller.signal)
      .then(function (response) { return responseJson(response, '索引状态查询失败'); })
      .then(function (result) {
        if (state.workspaceGeneration !== wsGen || getWorkspaceId() !== workspaceId) return null;
        if (result && result.summary) {
          state.projectIndexStatus = {
            totalFiles: result.summary.totalFiles,
            totalChunks: result.summary.totalChunks,
            builtAt: result.summary.builtAt,
            indexed: true,
            recovered: result.recovered === true
          };
          state.pinnedFiles = Array.isArray(result.pinnedFiles) ? result.pinnedFiles.slice() : state.pinnedFiles;
          renderProjectStatus();
          return result;
        }
        return buildProjectIndex();
      }).catch(function (error) {
        if (error && error.name === 'AbortError') return null;
        if (state.workspaceGeneration !== wsGen || getWorkspaceId() !== workspaceId) return null;
        return buildProjectIndex();
      }).then(function (result) {
        if (state._indexStatusPromise === promise) {
          state._indexStatusPromise = null;
          state._indexStatusController = null;
        }
        return result;
      });
    state._indexStatusPromise = promise;
    return promise;
  }

  // Phase 2: Index build context — immutable per-task state machine.
  // Each build task owns its own buildContext; callbacks must only
  // touch their own context.  Never set projectIndexStatus to null
  // while an async task is still referencing it.
  var _nextBuildId = 0;
  var _activeBuildContext = null;

  function createBuildContext(workspaceId, wsGen, controller) {
    var ctx = {
      id: ++_nextBuildId,
      workspaceId: workspaceId,
      workspaceGeneration: wsGen,
      controller: controller,
      startedAt: Date.now(),
      status: 'scanning',   // idle | scanning | comparing | uploading | finalizing | ready | failed | cancelled
      phase: '正在扫描文件...',
      scannedFiles: 0,
      indexableFiles: 0,
      totalFiles: 0,
      totalChunks: 0,
      builtAt: null,
      skippedFiles: 0,
      failedFiles: 0,
      truncated: false,
      errorCode: '',
      errorMessage: '',
      batchIndex: 0,
      totalBatches: 0
    };
    _activeBuildContext = ctx;
    return ctx;
  }

  function isBuildContextCurrent(ctx) {
    return _activeBuildContext === ctx &&
      state.workspaceGeneration === ctx.workspaceGeneration &&
      getWorkspaceId() === ctx.workspaceId;
  }

  function syncBuildContextToUI(ctx) {
    if (!isBuildContextCurrent(ctx)) return;
    state.projectIndexStatus = {
      indexed: ctx.status === 'ready',
      building: ctx.status === 'scanning' || ctx.status === 'comparing' || ctx.status === 'uploading' || ctx.status === 'finalizing',
      phase: ctx.phase,
      scannedFiles: ctx.scannedFiles,
      indexableFiles: ctx.indexableFiles,
      totalFiles: ctx.totalFiles,
      totalChunks: ctx.totalChunks,
      builtAt: ctx.builtAt,
      skippedFiles: ctx.skippedFiles,
      failedFiles: ctx.failedFiles,
      truncated: ctx.truncated,
      error: ctx.errorMessage || '',
      errorCode: ctx.errorCode || '',
      buildId: ctx.id,
      changedCount: ctx.changedCount,
      unchangedCount: ctx.unchangedCount,
      deletedCount: ctx.deletedCount
    };
    renderProjectStatus();
  }

  // Phase 4: Helper to upload files in batches (used by both full and incremental upload)
  function uploadFilesInBatches(files, scanResult, ctx, controller, workspaceId, wsGen) {
    if (files.length === 0) {
      return Promise.resolve({
        ok: true,
        totalFiles: 0,
        totalChunks: 0,
        builtAt: new Date().toISOString(),
        workspaceId: workspaceId,
        generation: wsGen,
        empty: true
      });
    }

    var batches = [];
    var currentBatch = [];
    var currentBytes = 0;
    for (var batchIndex = 0; batchIndex < files.length; batchIndex++) {
      var fileBytes = 0;
      try { fileBytes = JSON.stringify(files[batchIndex]).length; } catch (e) { fileBytes = 0; }
      if (currentBatch.length && currentBytes + fileBytes > MAX_INDEX_BATCH_BYTES) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBytes = 0;
      }
      currentBatch.push(files[batchIndex]);
      currentBytes += fileBytes;
    }
    if (currentBatch.length || !batches.length) batches.push(currentBatch);
    ctx.totalBatches = batches.length;
    var useBatches = batches.length > 1;

    return batches.reduce(function (chain, batch, index) {
      return chain.then(function () {
        if (!isBuildContextCurrent(ctx)) throw createNamedAbortError();
        ctx.batchIndex = index;
        ctx.phase = useBatches
          ? '正在上传索引 (' + (index + 1) + '/' + batches.length + ')...'
          : '正在上传索引...';
        syncBuildContextToUI(ctx);
        var payload = {
          workspaceId: workspaceId,
          workspaceGeneration: wsGen,
          files: batch,
          truncated: scanResult.truncated === true
        };
        if (useBatches) {
          payload.append = true;
          payload.finalize = index === batches.length - 1;
          payload.batchIndex = index;
          payload.batchCount = batches.length;
        }
        return postJson('/api/code/index/build', payload, controller.signal).then(function (response) {
          return responseJson(response, 'index build failed');
        });
      });
    }, Promise.resolve());
  }

  function buildProjectIndex() {
    var fs = window.__xtjCodeFS;
    if (!fs || (!fs.listAllFilesWithMetadata && !fs.listAllFiles)) {
      var noFsCtx = createBuildContext(getWorkspaceId(), state.workspaceGeneration, new AbortController());
      noFsCtx.status = 'failed';
      noFsCtx.errorCode = 'FS_NOT_AVAILABLE';
      noFsCtx.errorMessage = '文件系统不支持项目索引';
      syncBuildContextToUI(noFsCtx);
      return Promise.resolve(state.projectIndexStatus);
    }

    // Cancel any in-flight build before starting a new one
    abortController(state._indexController);
    if (state._indexBuildPromise) {
      state._indexBuildKey = '';
      state._indexBuildPromise = null;
    }

    var workspaceId = getWorkspaceId();
    var wsGen = state.workspaceGeneration;
    var controller = new AbortController();
    state._indexController = controller;

    var ctx = createBuildContext(workspaceId, wsGen, controller);
    var buildKey = 'build_' + ctx.id + '@' + workspaceId + '@' + wsGen;
    state._indexBuildKey = buildKey;
    syncBuildContextToUI(ctx);

    var listPromise = fs.listAllFilesWithMetadata
      ? fs.listAllFilesWithMetadata(8, 1000, controller.signal)
      : fs.listAllFiles(8, 1000, controller.signal);

    var promise = listPromise.then(function (result) {
      if (!isBuildContextCurrent(ctx)) throw createNamedAbortError();
      var sourceFiles = result && Array.isArray(result.files) ? result.files : [];
      var files = [];
      for (var i = 0; i < sourceFiles.length; i++) {
        var file = sourceFiles[i];
        if (!file || file.type !== 'text') continue;
        files.push({
          path: file.path,
          name: file.name || file.path.split('/').pop(),
          language: file.language || getFileLanguage(file.name || file.path),
          size: file.size || 0,
          sha256: file.sha256 || '',
          modifiedAt: file.modifiedAt || null,
          content: file.content || ''
        });
      }

      ctx.status = 'uploading';
      ctx.scannedFiles = sourceFiles.length;
      ctx.indexableFiles = files.length;

      // Phase 4: Incremental manifest comparison
      if (CODE_PERSISTENT_INDEX_ENABLED) {
        ctx.phase = '正在比较索引...';
        ctx.status = 'comparing';
        syncBuildContextToUI(ctx);

        return getStoredManifest().then(function (storedManifest) {
          if (!isBuildContextCurrent(ctx)) throw createNamedAbortError();

          // Build manifest from current files
          var manifestFiles = files.map(function (f) {
            return {
              path: f.path,
              size: f.size || 0,
              modified_at: f.modifiedAt || null,
              sha256: f.sha256 || ''
            };
          });

          // Send manifest to server for comparison
          var manifestPayload = {
            workspace_id: workspaceId,
            workspace_generation: wsGen,
            files: manifestFiles
          };

          return postJson('/api/code/index/manifest', manifestPayload, controller.signal)
            .then(function (response) { return responseJson(response, '清单比较失败'); })
            .then(function (manifestResult) {
              if (!isBuildContextCurrent(ctx)) throw createNamedAbortError();

              if (manifestResult.persist_enabled && manifestResult.upload_paths) {
                // Only upload changed files
                var uploadPaths = manifestResult.upload_paths || [];
                var unchangedPaths = manifestResult.unchanged_paths || [];
                var deletePaths = manifestResult.delete_paths || [];

                if (uploadPaths.length === 0 && deletePaths.length === 0) {
                  // No changes needed
                  ctx.status = 'ready';
                  ctx.phase = '索引未变化，无需更新';
                  ctx.totalFiles = files.length;
                  ctx.totalChunks = unchangedPaths.length;
                  ctx.builtAt = new Date().toISOString();
                  syncBuildContextToUI(ctx);
                  // Save current manifest to IDB
                  saveFileManifestToIDB(files).catch(function (err) {
                    state._persistenceFailed = true;
                    console.warn('[CODE-INDEXEDDB] saveFileManifestToIDB failed, marking non-persistent:', err && err.name);
                  });
                  saveWorkspaceToIDB(workspaceId).catch(function (err) {
                    state._persistenceFailed = true;
                    console.warn('[CODE-INDEXEDDB] saveWorkspaceToIDB failed, marking non-persistent:', err && err.name);
                  });
                  return {
                    ok: true,
                    totalFiles: files.length,
                    totalChunks: unchangedPaths.length,
                    builtAt: ctx.builtAt,
                    workspaceId: workspaceId,
                    generation: wsGen,
                    scannedFiles: sourceFiles.length,
                    indexedFiles: files.length,
                    skippedFiles: 0,
                    failedFiles: 0,
                    truncated: result.truncated === true,
                    status: 'ready',
                    totalBytes: 0,
                    batchComplete: true,
                    unchanged: true
                  };
                }

                // Filter files to only changed ones
                var uploadPathSet = {};
                for (var up = 0; up < uploadPaths.length; up++) {
                  uploadPathSet[uploadPaths[up]] = true;
                }

                var changedFiles = files.filter(function (f) {
                  return uploadPathSet[f.path];
                });

                ctx.phase = '发现 ' + uploadPaths.length + ' 个变化文件，' + unchangedPaths.length + ' 个未变化';
                if (deletePaths.length > 0) {
                  ctx.phase += '，' + deletePaths.length + ' 个已删除';
                }
                ctx.scannedFiles = sourceFiles.length;
                ctx.indexableFiles = changedFiles.length;
                ctx.changedCount = uploadPaths.length;
                ctx.unchangedCount = unchangedPaths.length;
                ctx.deletedCount = deletePaths.length;
                syncBuildContextToUI(ctx);

                // Use only changed files for upload
                files = changedFiles;
              }

              ctx.status = 'uploading';
              ctx.phase = '正在上传索引...';
              syncBuildContextToUI(ctx);

              return uploadFilesInBatches(files, result, ctx, controller, workspaceId, wsGen);
            });
        }).catch(function (err) {
          if (err && err.name === 'AbortError') throw err;
          // Manifest comparison failed, fall back to full upload
          console.warn('[CODE-WORKSPACE] Manifest comparison failed, falling back to full upload:', err);
          ctx.status = 'uploading';
          ctx.phase = '增量比较失败，正在全量上传索引...';
          syncBuildContextToUI(ctx);
          return uploadFilesInBatches(files, result, ctx, controller, workspaceId, wsGen);
        });
      }

      ctx.phase = '正在上传索引...';
      syncBuildContextToUI(ctx);

      return uploadFilesInBatches(files, result, ctx, controller, workspaceId, wsGen);
    }).then(function (buildResult) {
      if (!isBuildContextCurrent(ctx)) return null;
      ctx.status = 'ready';
      ctx.phase = '索引构建完成';
      ctx.totalFiles = buildResult.totalFiles;
      ctx.totalChunks = buildResult.totalChunks;
      ctx.builtAt = buildResult.builtAt;
      ctx.skippedFiles = buildResult.skippedFiles || 0;
      ctx.failedFiles = buildResult.failedFiles || 0;
      ctx.truncated = buildResult.truncated === true;
      syncBuildContextToUI(ctx);

      // Phase 4: Save manifest to IndexedDB after successful build
      if (CODE_PERSISTENT_INDEX_ENABLED && !buildResult.unchanged) {
        // Re-get the files list from the scan result to save to IDB
        // (The files variable is already filtered, so we save from the original scan)
        saveWorkspaceToIDB(workspaceId).catch(function (err) {
          state._persistenceFailed = true;
          console.warn('[CODE-INDEXEDDB] saveWorkspaceToIDB failed, marking non-persistent:', err && err.name);
        });
      }

      return buildResult;
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        if (isBuildContextCurrent(ctx)) {
          ctx.status = 'cancelled';
          ctx.phase = '索引构建已取消';
          syncBuildContextToUI(ctx);
        }
        return null;
      }
      if (!isBuildContextCurrent(ctx)) return null;
      console.error('[code-workspace] Index build failed:', err);
      ctx.status = 'failed';
      ctx.errorCode = 'INDEX_BUILD_FAILED';
      ctx.errorMessage = (err && err.message) || '索引构建失败';
      ctx.phase = '索引构建失败';
      syncBuildContextToUI(ctx);
      return null;
    }).then(function (buildResult) {
      // Only cleanup if this build is still the registered one
      if (state._indexBuildKey === buildKey) {
        state._indexBuildPromise = null;
        state._indexController = null;
      }
      return buildResult;
    });

    state._indexBuildPromise = promise;
    return promise;
  }

  // ──────────────────────────────────────────────
  // renderProjectStatus() — compact status area (replaces old context panel)
  // ──────────────────────────────────────────────
  function renderProjectStatus() {
    if (!_dom.contextPanel) return;
    _dom.contextPanel.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'context-header';
    header.innerHTML = '<span>项目状态</span>';
    _dom.contextPanel.appendChild(header);

    var body = document.createElement('div');
    body.className = 'context-list';

    // Index status
    var indexDiv = document.createElement('div');
    indexDiv.style.cssText = 'padding:8px 12px;font-size:11px;line-height:1.6;';

    var docTab = state.openTabs && state.openTabs.find(function(t) { return t.type === 'document'; });
    var kindStr = (state.workspaceMode === 'github' ? 'GitHub 仓库' : (window.__xtjCodeFS && window.__xtjCodeFS.getWorkspaceKind && window.__xtjCodeFS.getWorkspaceKind() === 'file' ? '本地单文件' : '本地文件夹'));
    var isDocWorkspace = (state.projectIndexStatus && state.projectIndexStatus.totalFiles === 0) && (kindStr === '本地单文件' || (state.projectIndexStatus && state.projectIndexStatus.scannedFiles > 0) || docTab);

    if (isDocWorkspace && docTab) {
      // P7-UI: 区分四种状态：文件系统权限、文本解析状态、格式修改能力、保存验证状态
      var docStatus = '文档正在打开';
      var docStatusClass = '';
      var parseStatus = '等待解析';
      var parseStatusClass = '';
      if (docTab._extractError) {
        docStatus = '文档解析失败';
        docStatusClass = 'color:var(--cw-error);';
        parseStatus = '失败';
        parseStatusClass = 'color:var(--cw-error);';
      } else if (docTab._parseReady === true && docTab._extractedText) {
        docStatus = '文本已解析';
        docStatusClass = 'color:var(--cw-success,#10b981);';
        parseStatus = '已就绪';
        parseStatusClass = 'color:var(--cw-success,#10b981);';
      } else if (docTab._extractedText) {
        docStatus = '文本已提取（索引构建中）';
        docStatusClass = 'color:var(--cw-accent,#3b82f6);';
        parseStatus = '索引构建中';
        parseStatusClass = 'color:var(--cw-accent,#3b82f6);';
      } else if (docTab._extractPromise) {
        docStatus = '文档正在解析';
        docStatusClass = '';
        parseStatus = '正在解析';
        parseStatusClass = '';
      }

      var charCount = docTab._extractedText ? docTab._extractedText.length : 0;
      var ext = (docTab.name || '').toLowerCase().split('.').pop();
      var permStr = state._isReadOnly ? '只读' : '可写';
      var permClass = state._isReadOnly ? 'color:var(--cw-warning,#f59e0b);' : 'color:var(--cw-success,#10b981);';
      
      // 当前格式能力区分
      var formatCap = getDocumentFormatCapability(ext);
      var formatCapParts = [];
      if (formatCap.readable) formatCapParts.push('可读取');
      if (formatCap.analyzable) formatCapParts.push('可分析');
      // P1-5: 实验性修改标记
      if (formatCap.experimental) {
        formatCapParts.push('实验性修改');
        formatCapParts.push('另存副本');
      } else {
        if (formatCap.writable) formatCapParts.push('可修改');
        else formatCapParts.push('只读');
        if (formatCap.savable) formatCapParts.push('可保存');
      }
      if (formatCap.exportable) formatCapParts.push('可导出');
      var formatCapStr = formatCapParts.join(' · ');

      // P7-UI: 保存验证状态
      var saveStatus = '未保存';
      var saveStatusClass = 'color:var(--cw-text-muted);';
      if (docTab._saveError) {
        saveStatus = '保存失败';
        saveStatusClass = 'color:var(--cw-error);';
      } else if (docTab._saveVerified === true) {
        saveStatus = '已保存验证通过';
        saveStatusClass = 'color:var(--cw-success,#10b981);';
      } else if (docTab._savePending === true) {
        saveStatus = '保存待验证';
        saveStatusClass = 'color:var(--cw-accent,#3b82f6);';
      }
      
      indexDiv.innerHTML =
        '<div style="' + docStatusClass + 'font-weight:600;margin-bottom:6px;">' + docStatus + '</div>' +
        '<div style="color:var(--cw-text-muted);margin-bottom:2px;">' + escapeHTML(docTab.name) + '</div>' +
        (charCount > 0 ? '<div style="color:var(--cw-text-muted);margin-bottom:2px;">已解析文本：' + charCount.toLocaleString() + ' 字符</div>' : '') +
        '<div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;line-height:1.8;">' +
        '  <div style="color:var(--cw-text-muted);">文件系统权限</div><div style="' + permClass + '">' + permStr + '</div>' +
        '  <div style="color:var(--cw-text-muted);">文本解析状态</div><div style="' + parseStatusClass + '">' + parseStatus + '</div>' +
        '  <div style="color:var(--cw-text-muted);">格式修改能力</div><div style="color:var(--cw-text);">' + formatCapStr + '</div>' +
        '  <div style="color:var(--cw-text-muted);">保存验证状态</div><div style="' + saveStatusClass + '">' + saveStatus + '</div>' +
        '</div>' +
        (docTab._extractError ? '<div style="color:var(--cw-error);font-size:10px;margin-top:4px;">错误：' + escapeHTML(docTab._extractError) + '</div>' : '') +
        (docTab._saveError ? '<div style="color:var(--cw-error);font-size:10px;margin-top:2px;">保存错误：' + escapeHTML(docTab._saveError) + '</div>' : '');
    } else if (state.projectIndexStatus && state.projectIndexStatus.indexed) {
      var idx = state.projectIndexStatus;
      var statusLabel = (idx.recovered || state.projectIndexStatus.recovered) ? '索引已恢复' : '项目已索引';
      
      var statsHtml = '<div style="color:var(--cw-text-muted);">' + idx.totalFiles + ' 个文件</div>' +
                      '<div style="color:var(--cw-text-muted);">' + idx.totalChunks + ' 个代码块</div>';

      indexDiv.innerHTML =
        '<div style="color:var(--cw-text);font-weight:600;margin-bottom:4px;">' + statusLabel + '</div>' +
        statsHtml +
        '<div style="color:var(--cw-text-muted);">' + kindStr + '</div>';
      if (idx.truncated) {
        var truncationWarning = document.createElement('div');
        truncationWarning.className = 'code-index-warning';
        truncationWarning.textContent = '⚠ 仅索引扫描上限内的文件';
        indexDiv.appendChild(truncationWarning);
      }
    } else if (state.projectIndexStatus && state.projectIndexStatus.error) {
      indexDiv.innerHTML =
        '<div style="color:var(--cw-error);font-weight:600;margin-bottom:4px;">索引失败</div>' +
        '<div style="color:var(--cw-text-muted);font-size:10px;">' + escapeHTML(state.projectIndexStatus.error) + '</div>' +
        '<button class="code-retry-btn" style="margin-top:4px;font-size:10px;" id="codeRetryIndex">重试索引</button>';
    } else if (state.projectIndexStatus && state.projectIndexStatus.building) {
      var idx = state.projectIndexStatus;
      indexDiv.innerHTML =
        '<div style="color:var(--cw-text);font-weight:600;">' +
        (idx.phase && idx.phase.indexOf('比较') !== -1 ? '索引比较中' : '索引构建中') +
        '</div>' +
        '<div style="color:var(--cw-text-muted);">' + escapeHTML(idx.phase || '正在建立索引...') + '</div>' +
        (idx.scannedFiles !== undefined
          ? '<div style="color:var(--cw-text-muted);">已扫描 ' + idx.scannedFiles +
            '，可索引 ' + idx.indexableFiles + '</div>'
          : '');
      // Phase 4: Show incremental stats
      if (idx.changedCount !== undefined || idx.unchangedCount !== undefined || idx.deletedCount !== undefined) {
        var incStats = [];
        if (idx.changedCount !== undefined) incStats.push('本次新增/修改: ' + idx.changedCount);
        if (idx.unchangedCount !== undefined) incStats.push('未变化: ' + idx.unchangedCount);
        if (idx.deletedCount !== undefined) incStats.push('本次删除: ' + idx.deletedCount);
        if (incStats.length > 0) {
          indexDiv.innerHTML += '<div style="color:var(--cw-text-muted);font-size:10px;">' + incStats.join(' | ') + '</div>';
        }
      }
    } else {
      indexDiv.innerHTML = '<div style="color:var(--cw-text-muted);">索引尚未建立</div>';
    }
    body.appendChild(indexDiv);

    // Runtime info — real server-verified model identity and token stats
    var runtime = state.lastRuntime;
    if (runtime) {
      var runtimeDiv = document.createElement('div');
      runtimeDiv.style.cssText = 'padding:4px 12px 8px;font-size:10px;border-top:1px solid var(--cw-border);margin-top:4px;';

      var runtimeTitle = document.createElement('div');
      runtimeTitle.style.cssText = 'color:var(--cw-text-muted);font-weight:600;margin-bottom:3px;';
      runtimeTitle.textContent = '运行时';
      runtimeDiv.appendChild(runtimeTitle);

      var lines = [];
      lines.push('模型：' + (runtime.model || '服务器未声明'));
      lines.push('上下文配置：' + (runtime.configuredContextTokens ? runtime.configuredContextTokens.toLocaleString() + ' Token' : '服务器未声明'));
      if (typeof runtime.promptTokens === 'number') {
        lines.push('本轮输入：' + runtime.promptTokens.toLocaleString() + ' Token');
      }
      if (typeof runtime.toolReadTokens === 'number' && runtime.toolReadTokens > 0) {
        lines.push('本轮工具读取：' + runtime.toolReadTokens.toLocaleString() + ' Token');
      }
      if (runtime.cacheHitTokens != null && runtime.cacheMissTokens != null) {
        var cacheTotal = runtime.cacheHitTokens + runtime.cacheMissTokens;
        if (cacheTotal > 0) {
          lines.push('缓存命中：' + Math.round(runtime.cacheHitTokens / cacheTotal * 100) + '%');
        }
      }
      if (runtime.remainingEstimatedTokens != null) {
        lines.push('预估剩余：' + runtime.remainingEstimatedTokens.toLocaleString() + ' Token');
      }

      // Project index scale — clearly separated from model context
      if (state.projectIndexStatus && state.projectIndexStatus.indexed) {
        var isDocWorkspaceRuntime = state.projectIndexStatus.totalFiles === 0 &&
          ((window.__xtjCodeFS && window.__xtjCodeFS.getWorkspaceKind && window.__xtjCodeFS.getWorkspaceKind() === 'file') ||
           state.projectIndexStatus.scannedFiles > 0 ||
           (state.openTabs && state.openTabs.some(function(t) { return t.type === 'document'; })));
        
        if (!isDocWorkspaceRuntime) {
          lines.push('项目索引：' + state.projectIndexStatus.totalFiles + ' 文件 / ' + state.projectIndexStatus.totalChunks + ' 代码块');
        }
      }

      lines.forEach(function (line) {
        var lineDiv = document.createElement('div');
        lineDiv.style.cssText = 'color:var(--cw-text-muted);font-size:9px;line-height:1.5;';
        lineDiv.textContent = line;
        runtimeDiv.appendChild(lineDiv);
      });

      body.appendChild(runtimeDiv);
    }

    function appendPathSection(title, paths, icon, clickable) {
      var unique = [];
      (paths || []).forEach(function (path) {
        if (path && unique.indexOf(path) === -1) unique.push(path);
      });
      if (!unique.length) return;
      var section = document.createElement('div');
      section.style.cssText = 'padding:4px 12px 8px;font-size:10px;border-top:1px solid var(--cw-border);margin-top:4px;';
      var label = document.createElement('div');
      label.style.cssText = 'color:var(--cw-text-muted);font-weight:600;margin-bottom:3px;';
      label.textContent = title + ' (' + unique.length + ')';
      section.appendChild(label);
      unique.slice(0, 12).forEach(function (path) {
        var button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = 'display:block;width:100%;padding:2px 0;border:0;background:transparent;color:var(--cw-text);font-size:10px;text-align:left;' +
          (clickable === false ? 'cursor:default;' : 'cursor:pointer;') +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        button.title = path;
        button.textContent = (icon || '📄') + ' ' + path;
        if (clickable !== false) button.addEventListener('click', function () { openFile(path); });
        section.appendChild(button);
      });
      body.appendChild(section);
    }

    appendPathSection('当前文件', state.activePath ? [state.activePath] : [], '▶', true);
    appendPathSection('打开文件', state.openTabs.map(function (tab) { return tab.path; }), '◫', true);

    // Last read context info
    if (state.lastReadContext && state.lastReadContext.files_read && state.lastReadContext.files_read.length > 0) {
      var lrc = state.lastReadContext;
      var readDiv = document.createElement('div');
      readDiv.style.cssText = 'padding:4px 12px 8px;font-size:10px;border-top:1px solid var(--cw-border);margin-top:4px;';

      var readTitle = document.createElement('div');
      readTitle.style.cssText = 'color:var(--cw-text-muted);font-weight:600;margin-bottom:3px;';
      readTitle.textContent = 'AI 本次读取 (' + lrc.files_read.length + ')';
      readDiv.appendChild(readTitle);
      for (var ri = 0; ri < Math.min(lrc.files_read.length, 5); ri++) {
        var fr = lrc.files_read[ri];
        var ranges = Array.isArray(fr.ranges)
          ? fr.ranges.map(function (r) { return 'L' + r[0] + '-' + r[1]; }).join(', ')
          : '';
        var readButton = document.createElement('button');
        readButton.type = 'button';
        readButton.style.cssText = 'display:block;width:100%;padding:2px 0;border:0;background:transparent;color:var(--cw-text);font-size:10px;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        readButton.title = fr.path;
        readButton.textContent = fr.path + (ranges ? ': ' + ranges : '');
        readButton.addEventListener('click', function (path) {
          return function () { openFile(path); };
        }(fr.path));
        readDiv.appendChild(readButton);
      }
      var readMeta = document.createElement('div');
      readMeta.style.cssText = 'color:var(--cw-text-muted);font-size:9px;margin-top:3px;';
      readMeta.textContent = (lrc.total_tokens || 0) + ' tokens / ' +
        (lrc.total_tool_calls || state.lastToolTrace.length || 0) + ' 次工具调用';
      readDiv.appendChild(readMeta);
      body.appendChild(readDiv);
    }

    if (state.lastToolTrace.length > 0) {
      var traceDiv = document.createElement('div');
      traceDiv.style.cssText = 'padding:4px 12px 8px;font-size:10px;border-top:1px solid var(--cw-border);margin-top:4px;';
      traceDiv.innerHTML = '<div style="color:var(--cw-text-muted);font-weight:600;margin-bottom:3px;">本轮工具轨迹 (' + state.lastToolTrace.length + ')</div>';
      state.lastToolTrace.slice(0, 8).forEach(function (entry) {
        var row = document.createElement(entry.path ? 'button' : 'div');
        if (entry.path) row.type = 'button';
        row.style.cssText = 'display:block;width:100%;padding:2px 0;border:0;background:transparent;color:' +
          (entry.ok === false ? 'var(--cw-danger)' : 'var(--cw-text-muted)') +
          ';font-size:9px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
          (entry.path ? 'cursor:pointer;' : '');
        row.textContent = (entry.ok === false ? '✕ ' : '✓ ') + (entry.tool || 'tool') +
          (entry.path ? ' · ' + entry.path : '') + ' · ' + (entry.duration_ms || 0) + 'ms';
        if (entry.path) row.addEventListener('click', function () { openFile(entry.path); });
        traceDiv.appendChild(row);
      });
      body.appendChild(traceDiv);
    }

    appendPathSection('固定文件', state.pinnedFiles, '📌', true);
    appendPathSection('本轮附件', state.lastSentAttachmentPaths.length ? state.lastSentAttachmentPaths : state.attachments.filter(function (attachment) { return !attachment.pinned; }).map(function (attachment) { return attachment.path; }), '📎', false);
    appendPathSection('固定附件', state.attachments.filter(function (attachment) { return attachment.pinned; }).map(function (attachment) { return attachment.path; }), '📌', false);

    // Actions
    var actionsDiv = document.createElement('div');
    actionsDiv.style.cssText = 'padding:4px 12px 8px;font-size:10px;border-top:1px solid var(--cw-border);margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;';
    actionsDiv.innerHTML =
      '<button class="code-retry-btn" style="font-size:10px;" id="codeRefreshIndex">刷新索引</button>' +
      '<button class="code-retry-btn" style="font-size:10px;" id="codeSwitchWorkspace">切换工作区</button>';
    body.appendChild(actionsDiv);

    _dom.contextPanel.appendChild(body);

    // Bind buttons
    var refreshBtn = document.getElementById('codeRefreshIndex');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        // Phase 2: Let buildProjectIndex() cancel old task and create new one.
        // Never set projectIndexStatus to null while async tasks are pending.
        buildProjectIndex();
      });
    }
    var switchBtn = document.getElementById('codeSwitchWorkspace');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        renderWelcome();
      });
    }
    var retryBtn = document.getElementById('codeRetryIndex');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        // Phase 2: Let buildProjectIndex() cancel old task and create new one.
        buildProjectIndex();
      });
    }
  }

  // ──────────────────────────────────────────────
  // renderGitHubRepoSelector() — GitHub repo selection UI
  // ──────────────────────────────────────────────
  function splitGitHubRepo(value) {
    var parts = String(value || '').trim().split('/');
    if (parts.length !== 2 ||
        !/^[A-Za-z0-9_.-]+$/.test(parts[0]) ||
        !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
      return null;
    }
    return { owner: parts[0], repo: parts[1], fullName: parts[0] + '/' + parts[1] };
  }

  function loadGitHubRepositoryInfo(repoValue) {
    var parsed = splitGitHubRepo(repoValue);
    if (!parsed) return Promise.reject(new Error('请输入有效的仓库地址（owner/repo）'));
    var key = parsed.fullName.toLowerCase();
    if (state._githubLoadPromise && state._githubLoadKey === key) {
      return state._githubLoadPromise;
    }

    abortController(state._githubController);
    state._githubController = new AbortController();
    state._githubLoadKey = key;
    var controller = state._githubController;
    var base = '/api/code/github/repos/' +
      encodeURIComponent(parsed.owner) + '/' + encodeURIComponent(parsed.repo);

    var promise = Promise.all([
      apiFetch(base, { method: 'GET', signal: controller.signal }).then(function (response) {
        return responseJson(response, '无法读取 GitHub 仓库');
      }),
      apiFetch(base + '/branches', { method: 'GET', signal: controller.signal }).then(function (response) {
        return responseJson(response, '无法读取 GitHub 分支');
      })
    ]).then(function (results) {
      state._githubErrorKey = '';
      return {
        parsed: parsed,
        repo: results[0].repo || results[0],
        branches: Array.isArray(results[1].branches) ? results[1].branches : []
      };
    }).then(function (result) {
      if (state._githubLoadKey === key) {
        state._githubLoadPromise = null;
        state._githubController = null;
      }
      return result;
    }, function (error) {
      if (state._githubLoadKey === key) {
        state._githubLoadPromise = null;
        state._githubController = null;
      }
      throw error;
    });
    state._githubLoadPromise = promise;
    return promise;
  }

  function openGitHubWorkspace(repo, branch) {
    var parsed = splitGitHubRepo(repo);
    var fs = window.__xtjCodeFS;
    if (!parsed || !fs || typeof fs.createGitHubFileSystemAdapter !== 'function') {
      return Promise.reject(new Error('GitHub 文件系统适配器不可用，请刷新页面后重试'));
    }
    return fs.createGitHubFileSystemAdapter({
      owner: parsed.owner,
      repo: parsed.repo,
      branch: branch
    }).then(function (adapter) {
      resetWorkspaceState();
      state.workspaceMode = 'github';
      state.workspaceName = parsed.fullName;
      state.directoryHandle = adapter;
      state._isReadOnly = true;
      fs.setDirHandle(adapter);
      renderWorkspace();
      return adapter;
    });
  }

  function renderGitHubRepoSelector() {
    if (!_dom.panelCode) return;
    _dom.panelCode.innerHTML = '';

    var container = document.createElement('div');
    container.className = 'code-welcome';
    container.innerHTML =
      '<div class="welcome-icon">🔗</div>' +
      '<h2 class="welcome-title">打开 GitHub 仓库</h2>' +
      '<p class="welcome-desc">输入仓库地址（如 xutingjiang1004/xtj），选择分支后即可浏览和分析代码。</p>' +
      '<div class="github-repo-input" style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:16px;">' +
        '<input type="text" id="githubRepoInput" placeholder="owner/repo（如 xutingjiang1004/xtj）" ' +
        'style="flex:1;max-width:400px;padding:10px 14px;border:1px solid var(--cw-border);border-radius:8px;font-size:14px;background:var(--cw-bg);color:var(--cw-text);">' +
        '<button class="folder-picker-btn-large" id="githubRepoLoadBtn" style="padding:10px 20px;font-size:14px;">加载仓库</button>' +
      '</div>' +
      '<div id="githubRepoBranches" style="display:none;margin-bottom:16px;"></div>' +
      '<div id="githubRepoFiles" style="display:none;max-height:300px;overflow-y:auto;text-align:left;border:1px solid var(--cw-border);border-radius:8px;padding:12px;"></div>' +
      '<div id="githubRepoActions" style="display:none;margin-top:12px;"></div>' +
      '<button class="folder-picker-btn-large" id="githubBackBtn" style="margin-top:16px;background:var(--cw-bg);">← 返回</button>';

    _dom.panelCode.appendChild(container);

    // Bind back button
    var backBtn = document.getElementById('githubBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function () { renderWelcome(); });
    }

    // Bind load button
    var loadBtn = document.getElementById('githubRepoLoadBtn');
    var repoInput = document.getElementById('githubRepoInput');
    if (loadBtn && repoInput) {
      loadBtn.addEventListener('click', function () {
        var repo = repoInput.value.trim();
        if (!repo || repo.indexOf('/') === -1) {
          showToast('请输入有效的仓库地址（owner/repo）', 'error');
          return;
        }

        loadBtn.disabled = true;
        loadBtn.textContent = '加载中...';

        loadGitHubRepositoryInfo(repo).then(function (data) {
          loadBtn.disabled = false;
          loadBtn.textContent = '加载仓库';

          var branchesDiv = document.getElementById('githubRepoBranches');
          var filesDiv = document.getElementById('githubRepoFiles');
          var actionsDiv = document.getElementById('githubRepoActions');

          // Show branches
          branchesDiv.style.display = 'block';
          var defaultBranch = data.repo.default_branch || 'main';
          branchesDiv.innerHTML = '<div style="font-weight:600;margin-bottom:8px;">分支:</div>' +
            data.branches.map(function (b) {
              return '<label style="display:inline-block;margin:4px 8px;cursor:pointer;font-size:13px;">' +
                '<input type="radio" name="githubBranch" value="' + escapeHTML(b.name) + '"' +
                (b.name === defaultBranch ? ' checked' : '') + '> ' + escapeHTML(b.name) +
                '</label>';
            }).join('');

          // Show repo info
          filesDiv.style.display = 'block';
          filesDiv.innerHTML =
            '<div style="font-weight:600;margin-bottom:8px;">仓库信息:</div>' +
            '<div style="font-size:13px;color:var(--cw-text-muted);">' +
            '名称: ' + escapeHTML(data.repo.full_name || data.parsed.fullName) + '<br>' +
            '描述: ' + escapeHTML(data.repo.description || '无') + '<br>' +
            '默认分支: ' + escapeHTML(defaultBranch) + '<br>' +
            '可见性: ' + (data.repo.private ? '私有仓库' : '公开仓库') + '<br>' +
            '最近更新: ' + (data.repo.updated_at ? new Date(data.repo.updated_at).toLocaleString() : '未知') +
            '</div>';

          // Show open button
          actionsDiv.style.display = 'block';
          actionsDiv.innerHTML =
            '<button class="folder-picker-btn-large primary" id="githubOpenWorkspaceBtn" style="padding:10px 24px;font-size:14px;">打开此仓库</button>';

          var openBtn = document.getElementById('githubOpenWorkspaceBtn');
          if (openBtn) {
            openBtn.addEventListener('click', function () {
              var selectedBranch = document.querySelector('input[name="githubBranch"]:checked');
              var branch = selectedBranch ? selectedBranch.value : defaultBranch;

              openBtn.disabled = true;
              openBtn.textContent = '正在获取文件树...';
              openGitHubWorkspace(repo, branch).catch(function (err) {
                showToast('获取文件树失败: ' + (err.message || '未知错误'), 'error');
                openBtn.disabled = false;
                openBtn.textContent = '打开此仓库';
              });
            });
          }
        }).catch(function (err) {
          loadBtn.disabled = false;
          loadBtn.textContent = '加载仓库';
          if (err && err.name === 'AbortError') return;
          var errorKey = String((err && err.status) || 0) + ':' + String((err && err.message) || '未知错误');
          if (state._githubErrorKey !== errorKey) {
            state._githubErrorKey = errorKey;
            showToast('加载失败: ' + (err.message || '未知错误'), 'error');
          }
        });
      });

      // Enter key support
      repoInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') loadBtn.click();
      });
    }
  }

  // ──────────────────────────────────────────────
  // renderChatPanel()
  // ──────────────────────────────────────────────
  function loadCapabilities() {
    if (state.capabilities) return Promise.resolve(state.capabilities);
    if (state._capabilitiesPromise) return state._capabilitiesPromise;
    state._capabilitiesPromise = apiFetch('/api/code/capabilities', { method: 'GET' })
      .then(function (response) { return responseJson(response, '能力信息加载失败'); })
      .then(function (data) {
        state.capabilities = data;
        state._capabilitiesPromise = null;
        updateCapabilitiesBadge();
        return data;
      }).catch(function (error) {
        state._capabilitiesPromise = null;
        state.capabilities = {
          ok: false,
          configured: false,
          agentEnabled: false,
          toolCallingEnabled: false,
          error: error && error.message
        };
        updateCapabilitiesBadge();
        return state.capabilities;
      });
    return state._capabilitiesPromise;
  }

  function capabilitiesLabel() {
    var capabilities = state.capabilities;
    if (!capabilities) return { text: '能力检测中', title: '正在读取服务端能力' };
    if (capabilities.agentEnabled && capabilities.toolCallingEnabled) {
      var provider = capabilities.provider || 'AI';
      var model = capabilities.model || '模型未命名';
      return {
        text: provider + ' · Agent',
        title: model + '；工具调用已启用；最多 ' + (capabilities.maxToolRounds || '?') + ' 轮'
      };
    }
    if (capabilities.configured === false) {
      return { text: 'AI 未配置', title: '服务端尚未配置 Code AI' };
    }
    return { text: '基础模式', title: '服务端未启用工具调用' };
  }

  function updateCapabilitiesBadge() {
    if (!_dom.chatPanel) return;
    var element = _dom.chatPanel.querySelector('.chat-model-badge');
    if (!element) return;
    var badge = capabilitiesLabel();
    element.textContent = badge.text;
    element.title = badge.title;
  }

  function attachmentMimeType(fileName, browserMime) {
    var ext = String(fileName || '').slice(String(fileName || '').lastIndexOf('.')).toLowerCase();
    var map = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pdf': 'application/pdf',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.md': 'text/plain',
      '.markdown': 'text/plain',
      '.json': 'text/plain'
    };
    return map[ext] || browserMime || '';
  }

  function isAllowedAttachment(fileName) {
    var lower = String(fileName || '').toLowerCase();
    return /\.(docx|pdf|xlsx|xls|pptx|txt|csv|md|markdown|json)$/.test(lower);
  }

  function safeAttachmentName(fileName) {
    return String(fileName || 'attachment')
      .replace(/[\/\\\u0000-\u001f\u007f]/g, '_')
      .slice(0, 180);
  }

  function currentAttachmentChars() {
    return state.attachments.reduce(function (total, attachment) {
      return total + String(attachment.content || '').length;
    }, 0);
  }

  // Attachments are in-memory context. Release any browser-owned resources
  // when a chip is removed or its workspace is replaced.
  function releaseAttachment(attachment) {
    if (!attachment) return;
    var urlApi = (window && window.URL) || (typeof URL !== 'undefined' ? URL : null);
    var objectUrl = attachment.objectUrl || attachment.previewUrl || attachment.blobUrl;
    if (objectUrl && urlApi && typeof urlApi.revokeObjectURL === 'function') {
      try { urlApi.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ }
    }
    attachment.objectUrl = null;
    attachment.previewUrl = null;
    attachment.blobUrl = null;
    attachment.content = '';
  }

  function clearAttachments() {
    for (var i = 0; i < state.attachments.length; i++) releaseAttachment(state.attachments[i]);
    state.attachments = [];
    state.attachmentProcessing = false;
    state.attachmentError = '';
  }

  function consumeTransientAttachments() {
    var retained = [];
    for (var i = 0; i < state.attachments.length; i++) {
      var attachment = state.attachments[i];
      if (attachment && attachment.pinned === true) retained.push(attachment);
      else releaseAttachment(attachment);
    }
    state.attachments = retained;
  }

  function processAttachmentFile(file) {
    if (!file || !isAllowedAttachment(file.name)) {
      return Promise.reject(new Error('仅支持 DOCX、PDF、XLSX、XLS、PPTX、TXT、CSV、MD、JSON'));
    }
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      return Promise.reject(new Error('资料文件不能超过 20MB'));
    }
    if (state.attachments.length >= MAX_ATTACHMENTS) {
      return Promise.reject(new Error('每个会话最多添加 ' + MAX_ATTACHMENTS + ' 份资料'));
    }

    var attachmentGeneration = state.workspaceGeneration;
    abortController(state._attachmentController);
    state._attachmentController = new AbortController();
    var controller = state._attachmentController;
    var mimeType = attachmentMimeType(file.name, file.type);
    var formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('fileName', file.name);
    formData.append('mimeType', mimeType);
    state.attachmentProcessing = true;
    state.attachmentError = '';
    renderChatPanel();

    return apiFetch('/api/code/document/extract', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    }).then(function (response) {
      return responseJson(response, '资料解析失败');
    }).then(function (data) {
      if (attachmentGeneration !== state.workspaceGeneration) {
        throw createNamedAbortError();
      }
      var content = String(data.text || '');
      if (!content.trim()) throw new Error('资料中没有可读取的文字');
      if (currentAttachmentChars() + content.length > MAX_ATTACHMENT_TOTAL_CHARS) {
        throw new Error('已添加资料内容过多，请移除部分资料后重试');
      }
      var originalName = data.fileName || file.name;
      var safeName = safeAttachmentName(originalName);
      return getSHA256(content).catch(function () { return ''; }).then(function (sha256) {
        if (sha256 && state.attachments.some(function(a) { return a.sha256 === sha256; })) {
          throw new Error('文件已在资料区中，无需重复添加');
        }
        var pathName = safeName;
        var count = 1;
        while (state.attachments.some(function(a) { return a.path === 'attachments/' + pathName; })) {
          count++;
          var parts = safeName.split('.');
          if (parts.length > 1) {
            var ext = parts.pop();
            pathName = parts.join('.') + '_' + count + '.' + ext;
          } else {
            pathName = safeName + '_' + count;
          }
        }

        state.attachments.push({
          name: originalName,
          path: 'attachments/' + pathName,
          mimeType: data.mimeType || mimeType,
          content: content,
          sha256: sha256,
          source: 'attachment',
          pinned: false,
          truncated: !!data.truncated,
          metadata: data.metadata || {}
        });
        if (attachmentGeneration !== state.workspaceGeneration) {
          releaseAttachment(state.attachments[state.attachments.length - 1]);
          state.attachments.pop();
          throw createNamedAbortError();
        }
        state.attachmentProcessing = false;
        if (state._attachmentController === controller) state._attachmentController = null;
        renderChatPanel();
        return state.attachments[state.attachments.length - 1];
      });
    }).catch(function (error) {
      if (attachmentGeneration !== state.workspaceGeneration) throw error;
      state.attachmentProcessing = false;
      if (state._attachmentController === controller) state._attachmentController = null;
      if (error && error.name !== 'AbortError') {
        state.attachmentError = error.message || '资料解析失败';
        renderChatPanel();
      }
      throw error;
    });
  }

  function removeAttachment(index) {
    if (index < 0 || index >= state.attachments.length) return;
    releaseAttachment(state.attachments[index]);
    state.attachments.splice(index, 1);
    state.attachmentError = '';
    renderChatPanel();
  }

  function toggleAttachmentPinned(index) {
    if (index < 0 || index >= state.attachments.length) return;
    state.attachments[index].pinned = state.attachments[index].pinned !== true;
    renderChatPanel();
  }

  function renderChatPanel() {
    if (!_dom.chatPanel) return;
    _dom.chatPanel.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'chat-header';
    var badge = capabilitiesLabel();
    header.innerHTML =
      '<span>AI 代码助手</span>' +
      '<span class="chat-model-badge" title="' + escapeHTML(badge.title) + '">' + escapeHTML(badge.text) + '</span>';
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
      '<div class="code-chat-attachments" id="codeChatAttachments"></div>' +
      '<button type="button" class="code-attachment-btn" id="codeAttachmentBtn" title="支持 DOCX、PDF、XLSX、PPTX、TXT、CSV、MD、JSON">添加资料</button>' +
      '<input type="file" id="codeAttachmentInput" accept="' + ATTACHMENT_ACCEPT + '" multiple hidden>' +
      '<textarea id="codeChatInput" placeholder="输入消息，AI 将基于上下文文件回答..." rows="1"></textarea>' +
      '<button class="send-btn" id="codeChatSendBtn" title="发送">➤</button>';
    inputArea.innerHTML += '<button class="send-btn code-chat-cancel-btn" id="codeChatCancelBtn" type="button" title="&#21462;&#28040;&#35831;&#27714;">&#21462;&#28040;</button>';
    _dom.chatPanel.appendChild(inputArea);

    // Auto-resize textarea
    var input = document.getElementById('codeChatInput');
    var sendBtn = document.getElementById('codeChatSendBtn');
    var cancelBtn = document.getElementById('codeChatCancelBtn');
    var attachmentButton = document.getElementById('codeAttachmentBtn');
    var attachmentInput = document.getElementById('codeAttachmentInput');
    var attachmentsContainer = document.getElementById('codeChatAttachments');

    if (attachmentsContainer) {
      var attachmentHtml = '';
      for (var ai = 0; ai < state.attachments.length; ai++) {
        var attachment = state.attachments[ai];
        attachmentHtml += '<span class="code-attachment-chip ' + (attachment.pinned ? 'is-pinned' : '') + '" title="' + escapeHTML(attachment.path) + '">' +
          (attachment.pinned ? '📌 固定资料 ' : '📎 本次发送 ') + escapeHTML(attachment.name) +
          (attachment.truncated ? '（已截断）' : '') +
          '<button type="button" class="code-attachment-pin-toggle" data-pin-attachment="' + ai + '" aria-label="' + (attachment.pinned ? '取消固定 ' : '固定 ') + escapeHTML(attachment.name) + '">' + (attachment.pinned ? '取消固定' : '固定') + '</button>' +
          '<button type="button" data-remove-attachment="' + ai + '" aria-label="移除 ' + escapeHTML(attachment.name) + '">×</button></span>';
      }
      if (state.attachmentProcessing) attachmentHtml += '<span class="code-attachment-status">正在解析资料...</span>';
      if (state.attachmentError) attachmentHtml += '<span class="code-attachment-error">' + escapeHTML(state.attachmentError) + '</span>';
      attachmentsContainer.innerHTML = attachmentHtml;
      Array.prototype.forEach.call(attachmentsContainer.querySelectorAll('[data-pin-attachment]'), function (button) {
        button.addEventListener('click', function () {
          toggleAttachmentPinned(parseInt(button.getAttribute('data-pin-attachment'), 10));
        });
      });
      Array.prototype.forEach.call(attachmentsContainer.querySelectorAll('[data-remove-attachment]'), function (button) {
        button.addEventListener('click', function () {
          removeAttachment(parseInt(button.getAttribute('data-remove-attachment'), 10));
        });
      });
    }

    var fileBtn = document.getElementById('codeWelcomeFileBtn');
    if (fileBtn) {
      fileBtn.addEventListener('click', function () {
        selectAndOpenFile();
      });
    }

    if (attachmentButton && attachmentInput) {
      attachmentButton.disabled = state.attachmentProcessing || state.attachments.length >= MAX_ATTACHMENTS;
      attachmentButton.addEventListener('click', function () { attachmentInput.click(); });
      attachmentInput.addEventListener('change', function () {
        var selected = Array.prototype.slice.call(attachmentInput.files || []);
        attachmentInput.value = '';
        var chain = Promise.resolve();
        selected.slice(0, Math.max(0, MAX_ATTACHMENTS - state.attachments.length)).forEach(function (file) {
          chain = chain.then(function () { return processAttachmentFile(file); });
        });
        chain.catch(function (error) {
          if (error && error.name !== 'AbortError') showToast(error.message || '资料解析失败', 'error');
        });
      });
    }

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
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        cancelCurrentRequest();
      });
    }
    updateChatRequestControls();

    // Scroll to bottom
    scrollChatToBottom();
    if (!state.capabilities && !state._capabilitiesPromise) loadCapabilities();
  }

  function parseSimpleMarkdown(text) {
    if (typeof window.marked !== 'undefined') {
      try {
        var rendered = window.marked.parse(text);
        // P0: 净化 AI 返回的 HTML，防止 XSS 注入
        if (typeof window.DOMPurify !== 'undefined') {
          return DOMPurify.sanitize(rendered, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
          });
        }
        // 没有 DOMPurify 时，退回先转义再替换方案，不允许直接使用 marked 原始 HTML
        console.warn('[CODE] DOMPurify not available, falling back to safe markdown renderer');
        // fall through to safe fallback
      } catch (e) { /* ignore, fall through to safe fallback */ }
    }
    // Safe fallback: escape *before* building our small, fixed HTML subset.
    // This still covers useful answers when optional markdown libraries were
    // not loaded: headings, lists, fenced/inline code and GFM-style tables.
    function inline(value) {
      return escapeHTML(value)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
    function tableCells(row) {
      return row.trim().replace(/^\||\|$/g, '').split('|').map(function(cell) { return inline(cell.trim()); });
    }
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var output = [];
    var inCode = false;
    var codeLines = [];
    var inList = false;
    function closeList() { if (inList) { output.push('</ul>'); inList = false; } }
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (/^```/.test(line)) {
        closeList();
        if (inCode) { output.push('<pre><code>' + escapeHTML(codeLines.join('\n')) + '</code></pre>'); codeLines = []; }
        inCode = !inCode;
        continue;
      }
      if (inCode) { codeLines.push(line); continue; }
      var tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[li + 1] || '');
      if (line.indexOf('|') >= 0 && tableDivider) {
        closeList();
        var headers = tableCells(line);
        output.push('<table><thead><tr>' + headers.map(function(cell) { return '<th>' + cell + '</th>'; }).join('') + '</tr></thead><tbody>');
        li += 2;
        while (li < lines.length && lines[li].indexOf('|') >= 0 && lines[li].trim()) {
          output.push('<tr>' + tableCells(lines[li]).map(function(cell) { return '<td>' + cell + '</td>'; }).join('') + '</tr>');
          li += 1;
        }
        output.push('</tbody></table>');
        li -= 1;
        continue;
      }
      var heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) { closeList(); output.push('<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>'); continue; }
      var list = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (list) { if (!inList) { output.push('<ul>'); inList = true; } output.push('<li>' + inline(list[1]) + '</li>'); continue; }
      closeList();
      if (!line.trim()) { continue; }
      output.push('<p>' + inline(line) + '</p>');
    }
    if (inCode) output.push('<pre><code>' + escapeHTML(codeLines.join('\n')) + '</code></pre>');
    closeList();
    return output.join('');
  }

  function appendChatMessage(msg, container) {
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'code-chat-message ' + (msg.role === 'user' ? 'user' : 'assistant');

    var avatarText = msg.role === 'user' ? '你' : 'AI';
    var avatar = '<div class="msg-avatar">' + escapeHTML(avatarText) + '</div>';

    // Defense in depth: the server owns protocol parsing, but never render a
    // provider tool frame if an old proxy/cache somehow returns one.
    var visibleContent = String(msg.content || '');
    if (msg.role === 'assistant' && /<[|\uff5c]DSML[|\uff5c]|\b(?:reasoning_content|tool_calls)\b/i.test(visibleContent)) {
      visibleContent = '工具调用未生成可显示答案，请重试。';
    }
    var body = '<div class="msg-body">';
    body += '<div class="msg-content markdown-body">' + parseSimpleMarkdown(visibleContent) + '</div>';
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
  function buildOpenFilesContext() {
    var candidates = state.openTabs.map(function (tab) {
      var content = '';
      if (typeof tab._currentContent === 'string') content = tab._currentContent;
      else if (typeof tab._extractedText === 'string') content = tab._extractedText;
      else if (typeof tab.content === 'string') content = tab.content;
      return {
        path: tab.path,
        name: tab.name,
        language: getFileLanguage(tab.name),
        mimeType: tab.mimeType || '',
        content: content,
        sha256: tab.sha256 || '',
        source: 'open',
        priority: tab.path === state.activePath ? 3 :
          (state.pinnedFiles.indexOf(tab.path) !== -1 ? 2 : 1)
      };
    }).filter(function (file) {
      return file.path && file.content && !isRestrictedContextFile(file.path);
    }).sort(function (a, b) {
      return b.priority - a.priority || a.path.localeCompare(b.path);
    });

    var selected = [];
    var usedChars = 0;
    for (var i = 0; i < candidates.length && selected.length < MAX_OPEN_FILE_CONTEXT; i++) {
      var candidate = candidates[i];
      var remaining = MAX_OPEN_FILES_TOTAL_CHARS - usedChars;
      if (remaining <= 0) break;
      var content = candidate.content.slice(0, Math.min(MAX_OPEN_FILE_CHARS, remaining));
      if (!content) continue;
      selected.push({
        path: candidate.path,
        name: candidate.name,
        language: candidate.language,
        mimeType: candidate.mimeType,
        content: content,
        sha256: candidate.sha256,
        source: 'open'
      });
      usedChars += content.length;
    }
    return selected;
  }

  function ensureOpenFileContexts(message) {
    // P0: Only wait for RELEVANT documents, not all open tabs
    // Relevant = current file + pinned files + attachments + files explicitly mentioned in message
    var pending = [];
    var relevantPaths = new Set();

    // Add current active file
    if (state.activePath) relevantPaths.add(state.activePath);

    // Add pinned files
    state.pinnedFiles.forEach(function(p) { relevantPaths.add(p); });

    // Add attachments
    state.attachments.forEach(function(a) { if (a.path) relevantPaths.add(a.path); });

    // Check message for file references (simple path/name matching)
    if (message) {
      state.openTabs.forEach(function(tab) {
        if (tab.path && (message.indexOf(tab.name) !== -1 || message.indexOf(tab.path) !== -1)) {
          relevantPaths.add(tab.path);
        }
      });
    }

    // Only wait for relevant documents that are still extracting
    state.openTabs.forEach(function (tab) {
      if (tab.type === 'document' && !tab._extractedText && tab._extractPromise && relevantPaths.has(tab.path)) {
        // Add timeout to relevant document extractions (30s max)
        var extractWithTimeout = Promise.race([
          tab._extractPromise,
          new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 30000); })
        ]);
        pending.push(extractWithTimeout);
      }
    });

    function checkFailedTabs() {
      // Only check failures for relevant files
      var relevantTabs = state.openTabs.filter(function(tab) {
        return tab.type === 'document' && relevantPaths.has(tab.path);
      });
      for (var i = 0; i < relevantTabs.length; i++) {
        var tab = relevantTabs[i];
        if (tab._extractError) {
          var isCurrent = (tab.path === state.activePath);
          var isPinned = (state.pinnedFiles.indexOf(tab.path) !== -1);
          var isAttachment = state.attachments.some(function(a) { return a.path === tab.path; });
          if (isCurrent || isPinned || isAttachment) {
            throw new Error('文档提取失败：' + tab._extractError);
          }
        }
      }
      return [];
    }

    if (!pending.length) {
      return Promise.resolve().then(checkFailedTabs);
    }
    return Promise.all(pending).then(checkFailedTabs);
  }

  function buildChatRequestBody(message, historyMsgs) {
    var scope = getWorkspaceScope();
    return {
      workspace_name: state.workspaceName || '',
      workspace_id: scope.workspace_id,
      workspace_generation: scope.workspace_generation,
      conversation_id: state.conversationId,
      client_request_id: 'code_cr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      message: message,
      active_path: state.activePath || '',
      thinking_mode: 'high',
      history: historyMsgs,
      pinned_paths: state.pinnedFiles.slice(),
      open_files: buildOpenFilesContext(),
      attachments: state.attachments.map(function (attachment) {
        return {
          name: attachment.name,
          path: attachment.path,
          mimeType: attachment.mimeType,
          content: attachment.content,
          sha256: attachment.sha256 || '',
          source: 'attachment'
        };
      })
    };
  }

  var _sendingWatchdog = null;
  function clearSendingWatchdog() {
    if (_sendingWatchdog) { clearTimeout(_sendingWatchdog); _sendingWatchdog = null; }
  }
  function resetSendingState() {
    state.sending = false;
    state._abortController = null;
    updateChatRequestControls();
  }

  // ── Request Context Pattern ──
  // Every async request creates an immutable requestContext that captures all
  // resources (AbortController, sharedCtrl, telemetry, watchdog, etc.).
  // Async callbacks close over THEIR OWN context, not over state.xxx.
  // Before any mutation, call isCurrentRequest(ctx) to verify this context is
  // still the active request. Stale callbacks clean up only their OWN resources
  // and never touch state that belongs to a newer request.
  function isCurrentRequest(ctx) {
    return ctx && state.activeRequest === ctx && ctx.requestId === state._requestId;
  }
  function finalizeRequest(ctx, options) {
    if (!ctx) return;
    options = options || {};
    // Always clean up own resources (idempotent via _finalized flag)
    if (ctx._finalized) return;
    ctx._finalized = true;
    if (ctx.watchdogTimer !== undefined) { clearTimeout(ctx.watchdogTimer); ctx.watchdogTimer = undefined; }
    if (ctx.timeoutTimer !== undefined) { clearTimeout(ctx.timeoutTimer); ctx.timeoutTimer = undefined; }
    if (ctx.abortController && !ctx.cancelled) { try { ctx.abortController.abort(); } catch(_) {} }
    if (ctx.sharedCtrl && ctx.sharedCtrl.isActive) {
      try {
        if (options.done) ctx.sharedCtrl.done();
        else ctx.sharedCtrl.cancel(options.cancelReason || 'finalized');
      } catch(_) {}
    }
    if (ctx.unregisterKey && window.XtjAiCore && window.XtjAiCore.RequestController) {
      try { window.XtjAiCore.RequestController.unregisterInFlight(ctx.unregisterKey); } catch(_) {}
    }
    if (ctx.telemetry) {
      try { ctx.telemetry.finalize('done'); } catch(_) {}
    }
    // Only modify state if this context is still the active request
    if (isCurrentRequest(ctx)) {
      state.sending = false;
      state.activeRequest = null;
      state._abortController = null;
      state._sharedCtrl = null;
      state._telemetry = null;
      updateChatRequestControls();
      removeTypingIndicator();
    }
  }

  function sendMessage() {
    if (state.sending) {
      console.log('[code-workspace] sendMessage blocked: state.sending is true');
      return;
    }

    var input = document.getElementById('codeChatInput');
    if (!input) return;
    var message = input.value.trim();
    if (!message) return;
    state.lastFailedMessage = message;

    // P0: 保存当前 workspace generation 用于隔离
    var wsGen = state.workspaceGeneration;

    // Create request context BEFORE any async work
    var requestId = ++state._requestId;
    var abortCtrl = new AbortController();
    var clientRequestId = 'code_cr_' + requestId + '_' + Date.now();
    var ctx = {
      requestId: requestId,
      workspaceGeneration: wsGen,
      clientRequestId: clientRequestId,
      abortController: abortCtrl,
      sharedCtrl: null,
      telemetry: null,
      unregisterKey: 'code_ai_' + requestId,
      watchdogTimer: null,
      timeoutTimer: undefined,
      streamId: null,
      cancelled: false,
      cancelReason: '',
      _finalized: false
    };
    // Register as active request
    state.sending = true;
    state.activeRequest = ctx;
    state._abortController = abortCtrl;
    state._sharedCtrl = null;
    state._telemetry = null;
    updateChatRequestControls();

    // Watchdog: 120s timeout for stuck sending
    clearSendingWatchdog();
    _sendingWatchdog = setTimeout(function() {
      if (state.sending && isCurrentRequest(ctx)) {
        console.warn('[code-workspace] Watchdog: state.sending stuck true, resetting');
        finalizeRequest(ctx, { cancelReason: 'watchdog', done: false });
      }
      _sendingWatchdog = null;
    }, 120000);
    ctx.watchdogTimer = _sendingWatchdog;

    // Shared request controller + telemetry (feature-flagged)
    if (window.XtjAiCore && window.XtjAiCore.RequestController && window.XtjAiCore.RequestController.FEATURE_FLAG) {
      ctx.sharedCtrl = window.XtjAiCore.RequestController.create({
        requestId: 'code_req_' + requestId,
        clientRequestId: clientRequestId,
        timeoutMs: 120000,
        workspaceGeneration: wsGen
      });
      ctx.sharedCtrl.start();
      window.XtjAiCore.RequestController.registerInFlight(ctx.unregisterKey, ctx.sharedCtrl);
      if (window.XtjAiCore.Telemetry) {
        ctx.telemetry = window.XtjAiCore.Telemetry.create();
        ctx.telemetry.start('code_req_' + requestId, clientRequestId);
      }
    }

    var now = new Date();
    var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    // Add user message to state
    state.messages.push({ role: 'user', content: message, time: timeStr });

    input.value = '';
    input.style.height = 'auto';

    // P0: 追加用户消息到聊天，而不是重建整个面板
    // renderChatPanel() 会重建 input/button，新建的 DOM 是启用状态，
    // 但 state.sending 仍为 true → 导致点击发送被 guard 拦截，用户无法发送
    try {
      var messagesContainer = document.getElementById('codeChatMessages');
      if (messagesContainer) {
        appendChatMessage(state.messages[state.messages.length - 1], messagesContainer);
      }
      showTypingIndicator();
      scrollChatToBottom();
    } catch (e) {
      state.sending = false;
      var curInput = document.getElementById('codeChatInput');
      if (curInput) curInput.disabled = false;
      var curSendBtn = document.getElementById('codeChatSendBtn');
      if (curSendBtn) curSendBtn.disabled = false;
      return;
    }

    // Build history WITHOUT the current message (dedup)
    var historyMsgs = [];
    var recentMsgs = state.messages.slice(0, -1).slice(-50);
    for (var mi = 0; mi < recentMsgs.length; mi++) {
      var m = recentMsgs[mi];
      if (m.errorCode || m.retryable || m.stopped || !m.content || m.content === '（已停止）' || m.content === '（无响应）') {
        continue;
      }
      historyMsgs.push({ role: m.role, content: m.content });
    }

    // Documents are extracted asynchronously for preview. Wait for that
    // result before building the request, otherwise a fast send would omit
    // the document and the backend would incorrectly ask for an index.
    return ensureOpenFileContexts(message).then(function () {
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) return null;
      var body = buildChatRequestBody(message, historyMsgs);
      // Phase 2: Route to streaming endpoint when feature flag is enabled
      if (CODE_STREAM_ENABLED) {
        return sendStreamingRequest(ctx, body, timeStr);
      }
      return sendApiRequest(ctx, body, timeStr);
    }).catch(function (err) {
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) return null;
      if (err && err.name === 'AbortError') {
        removeTypingIndicator();
        if (state._sharedCtrl) {
          try { state._sharedCtrl.cancel('aborted'); } catch (e) {}
          if (state._telemetry) { state._telemetry.finalize('cancelled', { code: 'REQUEST_CANCELLED', message: 'aborted' }); }
        }
        state.sending = false;
        state._abortController = null;
        state._sharedCtrl = null;
        state._telemetry = null;
        updateChatRequestControls();
        return null;
      }
      removeTypingIndicator();
      // P0 Fix: 失败时不重复恢复消息到输入框
      // 只在真正发送失败时恢复一次（即网络层失败，消息未离开客户端）
      // 如果已经收到错误响应（后端返回了错误），不恢复消息到输入框
      state.messages.push({ role: 'assistant', content: 'Request failed: ' + ((err && err.message) || String(err)), time: timeStr });
      renderChatPanel();
      state.sending = false;
      state._abortController = null;
      state._sharedCtrl = null;
      state._telemetry = null;
      updateChatRequestControls();
      return null;
    });
  }

  function restoreFailedMessage(message) {
    if (!message) return;
    state.lastFailedMessage = message;
    var input = document.getElementById('codeChatInput');
    if (input && !input.value) {
      input.value = message;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight || 0, 120) + 'px';
    }
  }

  function updateChatRequestControls() {
    var input = document.getElementById('codeChatInput');
    var sendBtn = document.getElementById('codeChatSendBtn');
    var cancelBtn = document.getElementById('codeChatCancelBtn');
    // P0 Fix: 不禁止输入框，用户可以输入下一条草稿
    if (input) input.disabled = false;
    if (sendBtn) {
      sendBtn.style.display = state.sending ? 'none' : '';
    }
    if (cancelBtn) {
      cancelBtn.disabled = !state.sending;
      cancelBtn.style.display = state.sending ? '' : 'none';
    }
  }

  function cancelCurrentRequest() {
    var ctx = state.activeRequest;
    if (!ctx) return false;
    state._requestId++;
    ctx.cancelled = true;
    ctx.cancelReason = 'user_cancelled';
    finalizeRequest(ctx, { cancelReason: 'user_cancelled', done: false });
    removeTypingIndicator();
    updateChatRequestControls();
    return true;
  }

  // ── Phase 3: Stream resume helpers ───────────────────────────────────────
  function saveStreamState(streamState) {
    if (!CODE_STREAM_RESUME_ENABLED) return;
    try {
      sessionStorage.setItem('xtj_stream_state', JSON.stringify(streamState));
    } catch (e) { /* quota exceeded, ignore */ }
  }

  function clearStreamState() {
    try { sessionStorage.removeItem('xtj_stream_state'); } catch (e) {}
  }

  function getStreamState() {
    try {
      var raw = sessionStorage.getItem('xtj_stream_state');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ── Phase 2: Streaming SSE request handler ──────────────────────────────
  function sendStreamingRequest(ctx, body, timeStr) {
    var requestId = ctx.requestId;
    var wsGen = ctx.workspaceGeneration;
    var signal = state._sharedCtrl ? state._sharedCtrl.signal : (state._abortController ? state._abortController.signal : undefined);
    var controller = state._abortController;
    var timeoutId;
    var streamDone = false;
    var lastEventId = 0;
    var streamId = null;
    var resumeRetryCount = 0;

    // Phase 3: Save stream state for resume
    if (CODE_STREAM_RESUME_ENABLED) {
      saveStreamState({
        requestId: requestId,
        workspaceGeneration: wsGen,
        conversationId: state.conversationId,
        workspaceId: getWorkspaceScope().workspace_id,
        timeStr: timeStr,
        clientRequestId: body.client_request_id || '',
        startedAt: Date.now()
      });
    }

    // Remove typing indicator — we create a real assistant node instead
    removeTypingIndicator();

    // Create the single assistant node immediately
    var messagesContainer = document.getElementById('codeChatMessages');
    if (!messagesContainer) {
      state.sending = false;
      state._abortController = null;
      state._sharedCtrl = null;
      state._telemetry = null;
      updateChatRequestControls();
      return;
    }

    var assistantNode = document.createElement('div');
    assistantNode.className = 'code-chat-message assistant streaming';
    assistantNode.id = 'codeStreamingNode_' + requestId;
    assistantNode.innerHTML =
      '<div class="msg-avatar">AI</div>' +
      '<div class="msg-body">' +
        '<div class="code-stream-status">' +
          '<span class="code-stream-status-text">正在分析任务...</span>' +
          '<span class="code-stream-spinner"></span>' +
        '</div>' +
        '<div class="code-stream-tools" style="display:none">' +
          '<div class="code-stream-tools-header">' +
            '<span class="code-stream-tools-toggle">&#9654; 工具执行记录</span>' +
          '</div>' +
          '<div class="code-stream-tools-list"></div>' +
        '</div>' +
        '<div class="msg-content markdown-body code-stream-content"></div>' +
        '<div class="code-stream-usage" style="display:none"></div>' +
        '<div class="code-stream-error" style="display:none"></div>' +
        '<div class="msg-time">' + escapeHTML(timeStr) + '</div>' +
      '</div>';
    messagesContainer.appendChild(assistantNode);
    scrollChatToBottom();

    // Cache DOM references
    var statusEl = assistantNode.querySelector('.code-stream-status');
    var statusText = assistantNode.querySelector('.code-stream-status-text');
    var spinner = assistantNode.querySelector('.code-stream-spinner');
    var toolsContainer = assistantNode.querySelector('.code-stream-tools');
    var toolsList = assistantNode.querySelector('.code-stream-tools-list');
    var toolsHeader = assistantNode.querySelector('.code-stream-tools-header');
    var contentEl = assistantNode.querySelector('.code-stream-content');
    var usageEl = assistantNode.querySelector('.code-stream-usage');
    var errorEl = assistantNode.querySelector('.code-stream-error');
    var timeEl = assistantNode.querySelector('.msg-time');

    var toolCount = 0;
    var toolsExpanded = false;
    var answerBuffer = '';
    var answerStarted = false;
    var finalReply = '';
    var finalOperations = [];
    var finalUsage = null;
    var finalContextInfo = null;
    var finalToolTrace = null;
    var finalRuntime = null;
    var streamCancelled = false;

    // Toggle tools section
    if (toolsHeader) {
      toolsHeader.addEventListener('click', function () {
        toolsExpanded = !toolsExpanded;
        toolsList.style.display = toolsExpanded ? '' : 'none';
        var toggle = toolsHeader.querySelector('.code-stream-tools-toggle');
        if (toggle) toggle.innerHTML = (toolsExpanded ? '&#9660;' : '&#9654;') + ' 工具执行记录';
      });
    }

    // Scroll handler
    var scrollCtrl = null;
    if (window.XtjAiCore && window.XtjAiCore.Scroll) {
      scrollCtrl = window.XtjAiCore.Scroll.create(messagesContainer);
    }

    function appendAnswerDelta(delta) {
      if (streamCancelled) return;
      answerStarted = true;
      answerBuffer += String(delta);
      if (statusEl) statusEl.style.display = 'none';
      // Use StreamRenderer for smooth text output
      if (!contentEl._streamRenderer && window.XtjAiCore && window.XtjAiCore.StreamRenderer) {
        contentEl._streamRenderer = window.XtjAiCore.StreamRenderer.create(contentEl, { plainStream: true });
      }
      if (contentEl._streamRenderer) {
        contentEl._streamRenderer.append(String(delta));
      } else {
        // Fallback: direct text update
        contentEl.textContent = answerBuffer;
      }
      if (scrollCtrl) scrollCtrl.onNewContent();
    }

    function addToolStart(data) {
      if (streamCancelled) return;
      toolCount++;
      if (toolsContainer) toolsContainer.style.display = '';
      if (statusText) statusText.textContent = data.summary || ('执行工具: ' + (data.tool || ''));
      var item = document.createElement('div');
      item.className = 'code-stream-tool-item';
      item.id = 'tool-item-' + (data.tool_call_id || toolCount);
      item.innerHTML = '<span class="code-stream-tool-icon spinner"></span>' +
        '<span class="code-stream-tool-name">' + escapeHTML(data.tool || '') + '</span>' +
        '<span class="code-stream-tool-summary">' + escapeHTML(data.summary || '') + '</span>';
      toolsList.appendChild(item);
    }

    function updateToolResult(data) {
      if (streamCancelled) return;
      var itemId = 'tool-item-' + (data.tool_call_id || toolCount);
      var item = document.getElementById(itemId);
      if (!item) {
        // Item may have been created after tool_start, try finding by tool name
        var items = toolsList.querySelectorAll('.code-stream-tool-item');
        if (items.length > 0) item = items[items.length - 1];
      }
      if (item) {
        var icon = item.querySelector('.code-stream-tool-icon');
        if (icon) {
          icon.className = 'code-stream-tool-icon ' + (data.ok ? 'success' : 'error');
        }
        var summary = item.querySelector('.code-stream-tool-summary');
        if (summary) summary.textContent = data.summary || '';
      }
      if (statusText) statusText.textContent = '已完成 ' + toolCount + ' 个工具调用';
    }

    function showError(code, message, retryable) {
      if (streamCancelled) return;
      if (statusEl) statusEl.style.display = 'none';
      if (spinner) spinner.style.display = 'none';
      if (errorEl) {
        errorEl.style.display = '';
        
        var friendlyMessage = message || '请求失败';
        // P0 Fix: 区分不同错误类型，提供具体说明和操作建议
        if (code === 'INDEX_REBUILD_REQUIRED') {
          friendlyMessage = '项目索引尚未建立，但文档内容已可用。您可以继续提问，系统会使用文档正文回答。';
        } else if (code === 'DOCUMENT_NOT_PARSED') {
          friendlyMessage = '文档正在解析中，请等待解析完成后重试。';
        } else if (code === 'NO_WRITE_PERMISSION') {
          friendlyMessage = '没有文件写入权限，请重新授权写入权限后再试。';
        } else if (code === 'FORMAT_NOT_EDITABLE') {
          friendlyMessage = '该文件格式暂不支持修改。PDF 可读取和分析，DOCX/PPTX/XLSX 可修改。';
        } else if (code === 'PROVIDER_TIMEOUT') {
          friendlyMessage = 'AI 请求超时，请重试或简化问题。';
        } else if (code === 'PROVIDER_HTTP_401') {
          friendlyMessage = 'API 密钥无效，请检查 AI 服务配置。';
        } else if (code === 'PROVIDER_HTTP_403') {
          friendlyMessage = 'API 访问被拒绝，请检查权限配置。';
        } else if (code === 'PROVIDER_HTTP_429') {
          friendlyMessage = '请求过于频繁，请稍后重试。';
        } else if (code === 'STREAM_INTERRUPTED') {
          friendlyMessage = '连接中断，请检查网络后重试。';
        } else if (code === 'TOOL_CALL_FAILED') {
          friendlyMessage = '工具调用失败：' + (message || '未知错误');
        } else if (code === 'DOCUMENT_WRITE_FAILED') {
          friendlyMessage = '文档写入失败：' + (message || '未知错误');
        } else if (code === 'SAVE_VERIFICATION_FAILED') {
          friendlyMessage = '保存验证失败，文件可能已损坏，请重试。';
        } else if (code === 'AMBIGUOUS_REQUEST') {
          friendlyMessage = '请明确说明要修改什么内容，例如："将标题改为XXX"或"在第三段后插入XXX"。';
        } else if (code && code.indexOf('PROVIDER_') === 0) {
          friendlyMessage = 'AI 服务暂时无法处理该请求，请稍后重试。';
        }

        var errorHtml = '<div class="code-stream-error-msg">';
        errorHtml += escapeHTML(friendlyMessage);
        
        if (code) {
          errorHtml += '<details style="margin-top: 8px; font-size: 11px; opacity: 0.7; cursor: pointer;">';
          errorHtml += '<summary>查看错误详情</summary>';
          errorHtml += '<div style="margin-top: 4px;">错误码: ' + escapeHTML(code) + '</div>';
          if (friendlyMessage !== message) {
             errorHtml += '<div>原始信息: ' + escapeHTML(message) + '</div>';
          }
          errorHtml += '</details>';
        }
        
        errorHtml += '</div>';
        if (retryable) {
          errorHtml += '<button class="code-stream-retry-btn" type="button" style="margin-top: 8px;">重新生成</button>';
        }
        errorEl.innerHTML = errorHtml;
        var retryBtn = errorEl.querySelector('.code-stream-retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            sendMessage();
          });
        }
      }
      // Keep partial content
      if (contentEl._streamRenderer) {
        try { contentEl._streamRenderer.stop(); } catch (e) {}
      }
    }

    function finalizeNode() {
      streamDone = true;
      if (spinner) spinner.style.display = 'none';
      if (statusEl) statusEl.style.display = 'none';

      // Final markdown render
      if (contentEl._streamRenderer) {
        try { contentEl._streamRenderer.finish(finalReply || answerBuffer); } catch (e) {}
        contentEl._streamRenderer = null;
      } else if (finalReply || answerBuffer) {
        contentEl.innerHTML = parseSimpleMarkdown(finalReply || answerBuffer);
      }

      // Show usage
      if (finalUsage && usageEl) {
        usageEl.style.display = '';
        var usageParts = [];
        if (finalUsage.model) usageParts.push('模型: ' + escapeHTML(finalUsage.model));
        if (finalUsage.input_tokens) usageParts.push('输入: ' + finalUsage.input_tokens.toLocaleString() + ' Token');
        if (finalUsage.output_tokens) usageParts.push('输出: ' + finalUsage.output_tokens.toLocaleString() + ' Token');
        if (finalUsage.cache_hit_tokens) usageParts.push('缓存命中: ' + finalUsage.cache_hit_tokens.toLocaleString() + ' Token');
        if (finalUsage.total_duration_ms) usageParts.push('耗时: ' + (finalUsage.total_duration_ms / 1000).toFixed(1) + 's');
        usageEl.textContent = usageParts.join(' | ');
      }

      // Update time
      var now = new Date();
      if (timeEl) timeEl.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

      assistantNode.classList.remove('streaming');
    }

    function cleanupStream() {
      clearTimeout(timeoutId);
      if (contentEl._streamRenderer) {
        try { contentEl._streamRenderer.stop(); } catch (e) {}
        contentEl._streamRenderer = null;
      }
      if (scrollCtrl) {
        try { scrollCtrl.detach(); } catch (e) {}
        scrollCtrl = null;
      }
    }

    // Timeout
    timeoutId = setTimeout(function () {
      if (streamDone) return;
      streamCancelled = true;
      if (controller) {
        try { controller.abort(); } catch (e) {}
      }
      showError('PROVIDER_TIMEOUT', 'AI 响应超时，请稍后重试', true);
      state.messages.push({ role: 'assistant', content: answerBuffer || '（请求超时）', time: timeStr, errorCode: 'PROVIDER_TIMEOUT', retryable: true });
      finalizeRequestState();
    }, 120000);

    // Send the SSE request
    var apiCall;
    if (window.xtjProtectedFetch) {
      apiCall = window.xtjProtectedFetch('/api/code/chat/stream', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: signal
      });
    } else {
      apiCall = fetch('/api/code/chat/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal
      });
    }

    apiCall.then(function (resp) {
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) {
        cleanupStream();
        return;
      }
      if (!resp.ok) {
        return resp.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) {}
          var errMsg = (json && json.error) ? json.error : ('HTTP ' + resp.status);
          var errCode = (json && json.code) ? json.code : '';
          // Auto-fallback to non-streaming if streaming is not available
          if (resp.status === 503 && errCode === 'STREAM_DISABLED') {
            console.log('[code-workspace] Streaming not available, falling back to standard API');
            cleanupStream();
            return sendApiRequest(ctx, body, timeStr);
          }
          showError(errCode, errMsg, json && json.retryable);
          state.messages.push({ role: 'assistant', content: answerBuffer || ('抱歉，' + errMsg), time: timeStr, errorCode: errCode });
          finalizeRequestState();
        });
      }

      // Read SSE stream
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function isStreamStale() { return requestId !== state._requestId || wsGen !== state.workspaceGeneration; }

      function readStream() {
        if (streamCancelled || isStreamStale()) return;
        reader.read().then(function (result) {
          if (result.done) {
            // Stream ended
            if (!streamDone) {
              finalizeNode();
              state.messages.push({
                role: 'assistant',
                content: finalReply || answerBuffer || '（无响应）',
                time: timeStr,
                toolTrace: finalToolTrace,
                operations: finalOperations,
                contextInfo: finalContextInfo,
                runtime: finalRuntime,
                usage: finalUsage
              });
              finalizeRequestState();
              cleanupStream();
            }
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
      // SSE: accept both 'data:{...}' and 'data: {...}'
      if (!line.startsWith('data:')) continue;
      var jsonStr = line.substring(5);
      if (jsonStr.charAt(0) === ' ') jsonStr = jsonStr.substring(1);
      if (!jsonStr) continue;
            var event;
            try { event = JSON.parse(jsonStr); } catch (e) {
              console.warn('[code-workspace] SSE parse error (requestId=' + requestId + '):', jsonStr.slice(0, 80));
              continue;
            }
            if (!event || !event.type) continue;

            handleSSEEvent(event);
          }

          readStream();
        }).catch(function (err) {
          if (streamCancelled || streamDone) return;
          if (err && err.name === 'AbortError') {
            handleStreamCancelled();
          } else {
            // Phase 3: Auto-reconnect on stream interruption
            if (CODE_STREAM_RESUME_ENABLED && streamId && !streamCancelled && resumeRetryCount < STREAM_RESUME_MAX_RETRIES) {
              var delay = STREAM_RETRY_DELAYS[resumeRetryCount] || 8000;
              resumeRetryCount++;
              if (statusText) statusText.textContent = '连接中断，正在恢复 (' + resumeRetryCount + '/' + STREAM_RESUME_MAX_RETRIES + ')...';
              console.log('[CODE-STREAM] Reconnecting in ' + delay + 'ms, attempt ' + resumeRetryCount);
              setTimeout(function() {
                if (streamCancelled || streamDone) return;
                resumeStream(streamId, lastEventId, requestId, wsGen);
              }, delay);
            } else {
              showError('STREAM_INTERRUPTED', '流式连接中断', true);
              state.messages.push({ role: 'assistant', content: answerBuffer || '（连接中断）', time: timeStr, errorCode: 'STREAM_INTERRUPTED' });
              finalizeRequestState();
              cleanupStream();
            }
          }
        });
      }

      function handleSSEEvent(event) {
        if (streamCancelled || streamDone) return;
        // Phase 3: Event deduplication by event_id
        if (event.event_id && event.event_id <= lastEventId) return;
        if (event.event_id) lastEventId = event.event_id;
        // Capture stream_id from any event
        if (event.stream_id) streamId = event.stream_id;

        switch (event.type) {
          case 'accepted':
            if (statusText) statusText.textContent = '请求已接受，正在处理...';
            // Phase 3: Update stream state
            if (CODE_STREAM_RESUME_ENABLED && streamId) {
              saveStreamState(Object.assign(getStreamState() || {}, {
                streamId: streamId, lastEventId: lastEventId
              }));
            }
            break;
          case 'planning':
            if (statusText) statusText.textContent = (event.data && event.data.message) || '正在分析任务...';
            break;
          case 'tool_start':
            addToolStart(event.data || {});
            break;
          case 'tool_result':
            updateToolResult(event.data || {});
            break;
          case 'answer_start':
            if (statusText) statusText.textContent = '正在生成回答...';
            break;
          case 'answer_delta':
            var delta = (event.data && event.data.delta) ? event.data.delta : '';
            if (delta) appendAnswerDelta(delta);
            break;
          case 'operation_preview':
            if (event.data && event.data.files) {
              if (statusText) statusText.textContent = '生成修改操作: ' + (event.data.files.length || 0) + ' 个文件';
            }
            break;
          case 'usage':
            finalUsage = event.data || null;
            break;
          case 'warning':
            console.warn('[CODE-STREAM] Warning:', event.data);
            break;
          case 'heartbeat':
            // Keep-alive, do nothing
            break;
          case 'done':
            finalReply = (event.data && event.data.reply) ? event.data.reply : '';
            finalOperations = (event.data && Array.isArray(event.data.operations)) ? event.data.operations : [];
            finalContextInfo = (event.data && event.data.context_info) || null;
            finalToolTrace = (event.data && Array.isArray(event.data.tool_trace)) ? event.data.tool_trace : [];
            finalRuntime = (event.data && event.data.runtime) || null;
            if (!finalUsage && event.data && event.data.usage) finalUsage = event.data.usage;

            finalizeNode();

            // Update state
            state.lastSentAttachmentPaths = state.attachments.filter(function (a) { return !a.pinned; }).map(function (a) { return a.path; });
            consumeTransientAttachments();
            state.lastFailedMessage = '';
            state.messages.push({
              role: 'assistant',
              content: finalReply || answerBuffer || '（无响应）',
              time: timeStr,
              operations: finalOperations,
              toolTrace: finalToolTrace,
              contextInfo: finalContextInfo,
              runtime: finalRuntime,
              usage: finalUsage
            });

            if (finalOperations.length > 0) {
              state.pendingOperations = finalOperations;
            }
            if (finalContextInfo) {
              state.lastReadContext = finalContextInfo;
            }
            if (finalRuntime) {
              state.lastRuntime = finalRuntime;
            }
            state.lastToolTrace = finalToolTrace || [];

            finalizeRequestState();
            cleanupStream();

            // Show diff if operations
            if (finalOperations.length > 0) {
              renderDiffView();
            }
            // Phase 3: Clear stream state on done
            clearStreamState();
            break;
          case 'error':
            var errCode = (event.data && event.data.code) || 'INTERNAL_ERROR';
            var errMsg = (event.data && event.data.message) || '请求失败';
            var retryable = (event.data && event.data.retryable) === true;
            showError(errCode, errMsg, retryable);
            state.messages.push({
              role: 'assistant',
              content: answerBuffer || ('抱歉，[' + errCode + '] ' + errMsg),
              time: timeStr,
              errorCode: errCode,
              retryable: retryable
            });
            finalizeRequestState();
            cleanupStream();
            break;
        }
      }

      function handleStreamCancelled() {
        streamCancelled = true;
        if (spinner) spinner.style.display = 'none';
        if (statusEl) statusEl.style.display = 'none';
        if (contentEl._streamRenderer) {
          try { contentEl._streamRenderer.stop(); } catch (e) {}
        }
        // Mark as stopped
        assistantNode.classList.remove('streaming');
        assistantNode.classList.add('cancelled');
        if (statusText) {
          statusText.textContent = '已停止';
          statusEl.style.display = '';
        }
        state.messages.push({
          role: 'assistant',
          content: answerBuffer || '（已停止）',
          time: timeStr,
          stopped: true
        });
        // Phase 3: Clear stream state on cancel — prevent auto-reconnect
        clearStreamState();
        finalizeRequestState();
        cleanupStream();
      }

      readStream();
    }).catch(function (err) {
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) {
        cleanupStream();
        return;
      }
      cleanupStream();
      if (err && err.name === 'AbortError') {
        if (!streamDone) {
          streamCancelled = true;
          if (spinner) spinner.style.display = 'none';
          if (statusEl) statusEl.style.display = 'none';
          assistantNode.classList.remove('streaming');
          assistantNode.classList.add('cancelled');
          state.messages.push({ role: 'assistant', content: answerBuffer || '（已停止）', time: timeStr, stopped: true });
        }
        finalizeRequestState();
        return;
      }
      var errMsg = (err && err.message) ? err.message : String(err);
      showError('NETWORK_ERROR', errMsg, true);
      state.messages.push({ role: 'assistant', content: '抱歉，' + errMsg, time: timeStr, errorCode: 'NETWORK_ERROR', retryable: true });
      finalizeRequestState();
    });

    function finalizeRequestState() {
      clearTimeout(timeoutId);
      // Stale guard: if request is no longer current, clean only local resources
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) {
        if (state._sharedCtrl) {
          try { window.XtjAiCore.RequestController.unregisterInFlight('code_ai_' + requestId); } catch(e) {}
        }
        return;
      }
      if (state._sharedCtrl && state._sharedCtrl.isActive()) {
        try { state._sharedCtrl.done(); } catch (e) {}
        if (state._telemetry) {
          if (finalUsage) state._telemetry.recordUsage(finalUsage);
          state._telemetry.finalize(streamCancelled ? 'cancelled' : 'done');
        }
      }
      if (state._sharedCtrl) {
        try { window.XtjAiCore.RequestController.unregisterInFlight('code_ai_' + requestId); } catch(e) {}
        state._sharedCtrl = null;
      }
      state._telemetry = null;
      clearSendingWatchdog();
      state.sending = false;
      state._abortController = null;
      var inp = document.getElementById('codeChatInput');
      if (inp) inp.disabled = false;
      var sb = document.getElementById('codeChatSendBtn');
      if (sb) sb.disabled = false;
      updateChatRequestControls();
      renderProjectStatus();
    }
  }

  // ── Phase 3: Stream resume function ────────────────────────────────────
  function resumeStream(streamId, afterEventId, requestId, wsGen) {
    if (!streamId) return;
    if (requestId !== state._requestId) return;
    if (wsGen !== state.workspaceGeneration) return;

    var scope = getWorkspaceScope();
    var params = 'stream_id=' + encodeURIComponent(streamId) +
      '&after_event_id=' + afterEventId +
      '&workspace_id=' + encodeURIComponent(scope.workspace_id || '') +
      '&workspace_generation=' + (scope.workspace_generation || 0);

    var resumeUrl = '/api/code/chat/stream/resume?' + params;

    var fetchFn = window.xtjProtectedFetch || fetch;
    fetchFn(resumeUrl, { credentials: 'include' })
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) return;
        if (!data || !data.ok) {
          console.error('[CODE-STREAM] Resume failed:', data);
          showError('RESUME_FAILED', '流恢复失败', true);
          return;
        }

        // Replay events
        var events = data.events || [];
        for (var i = 0; i < events.length; i++) {
          handleSSEEvent(events[i]);
        }

        if (data.status === 'completed') {
          // Already done
          if (!streamDone) {
            finalizeNode();
            state.messages.push({
              role: 'assistant',
              content: finalReply || answerBuffer || '（无响应）',
              time: timeStr,
              toolTrace: finalToolTrace,
              operations: finalOperations,
              contextInfo: finalContextInfo,
              runtime: finalRuntime,
              usage: finalUsage
            });
            finalizeRequestState();
            cleanupStream();
          }
        } else if (data.status === 'running') {
          // Still running — reconnect to SSE
          // We can't reconnect to the same SSE, but we can poll resume
          if (statusText) statusText.textContent = '正在恢复中...';
          setTimeout(function() {
            if (requestId !== state._requestId || streamDone) return;
            resumeStream(streamId, lastEventId, requestId, wsGen);
          }, 2000);
        } else if (data.status === 'failed') {
          showError('STREAM_FAILED', '流式处理失败', false);
        } else if (data.status === 'cancelled') {
          handleStreamCancelled();
        }
      }).catch(function(err) {
        console.error('[CODE-STREAM] Resume error:', err);
        if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) return;
        showError('RESUME_ERROR', '流恢复请求失败', true);
      });
  }

  // ── Phase 3: Page refresh recovery — check for running streams ─────────
  function checkStreamRecovery() {
    if (!CODE_STREAM_RESUME_ENABLED) return;
    var streamState = getStreamState();
    if (!streamState) return;
    // Check if the stream is still recent (within 1 hour)
    if (Date.now() - streamState.startedAt > 60 * 60 * 1000) {
      clearStreamState();
      return;
    }
    // Check workspace match
    var scope = getWorkspaceScope();
    if (streamState.workspaceId && scope.workspace_id && streamState.workspaceId !== scope.workspace_id) {
      return; // Don't recover streams from a different workspace
    }
    if (streamState.streamId) {
      console.log('[CODE-STREAM] Recovering stream:', streamState.streamId);
      // We need to create a partial assistant node and resume
      // For now, we just check if there's a running session
      var fetchFn = window.xtjProtectedFetch || fetch;
      var statusUrl = '/api/code/chat/stream/status?workspace_id=' + encodeURIComponent(scope.workspace_id || '');
      fetchFn(statusUrl, { credentials: 'include' })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (data && data.has_running && Array.isArray(data.sessions)) {
            var session = data.sessions[0];
            if (session) {
              console.log('[CODE-STREAM] Found running session:', session.stream_id);
              // If the stream was in this conversation, we could show a "recovering" indicator
              // For now, we just clear the state since we don't have the UI context
              clearStreamState();
            }
          }
        }).catch(function() { clearStreamState(); });
    }
  }

  function sendApiRequest(ctx, body, timeStr, indexRetry) {
    var requestId = ctx.requestId;
    var wsGen = ctx.workspaceGeneration;
    var sendBtn = document.getElementById('codeChatSendBtn');
    var input = document.getElementById('codeChatInput');

    var signal = ctx.sharedCtrl ? ctx.sharedCtrl.signal : (ctx.abortController ? ctx.abortController.signal : undefined);

    // P0: AI 请求超时 (90 秒)，超时时真正中止网络请求
    var controller = ctx.abortController;
    var timeoutId;
    var timeoutPromise = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        // P1: 超时时真正中止网络请求，不只是 reject
        if (controller) {
          try { controller.abort(); } catch (e) { /* ignore */ }
        }
        reject(new Error('AI 响应超时，请稍后重试'));
      }, 90000);
    });

    var apiCall;
    if (window.xtjProtectedFetch) {
      apiCall = window.xtjProtectedFetch('/api/code/chat', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: signal
      });
    } else {
      apiCall = fetch('/api/code/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal
      });
    }

    function decodeCodeChatResponse(resp) {
      if (requestId !== state._requestId) return;
      if (wsGen !== state.workspaceGeneration) return;
      if (!resp.ok) {
        return resp.text().then(function(text) {
          var errMsg;
          var json = null;
          try { json = JSON.parse(text); } catch(e) {}
          if (resp.status === 409 && json && json.code === 'INDEX_REBUILD_REQUIRED') {
            var rebuildError = new Error('项目需要构建索引，正在自动为您准备数据...');
            rebuildError.code = 'INDEX_REBUILD_REQUIRED';
            throw rebuildError;
          }
          // Phase 2: Preserve structured error from backend
          if (json && json.code && json.error) {
            var codeError = new Error(json.error);
            codeError.code = json.code;
            codeError.requestId = json.requestId || '';
            codeError.phase = json.phase || '';
            codeError.retryable = json.retryable === true;
            // Preserve tool trace if tools succeeded
            if (Array.isArray(json.tool_trace) && json.tool_trace.length > 0) {
              codeError.toolTrace = json.tool_trace;
            }
            throw codeError;
          }
          // P0: 根据状态码显示具体错误
          if (resp.status === 401) {
            errMsg = '登录已失效，请重新登录';
          } else if (resp.status === 403) {
            errMsg = (json && json.error) ? json.error : '权限不足';
          } else if (resp.status === 413) {
            errMsg = '请求内容过大';
          } else if (resp.status === 429) {
            errMsg = (json && json.error) ? json.error : '请求过于频繁，请稍后重试';
          } else if (resp.status >= 500) {
            errMsg = (json && json.error) ? '服务器错误: ' + json.error : '服务器错误: ' + resp.status;
          } else {
            errMsg = (json && json.error) ? json.error : ('API 请求失败: ' + resp.status);
          }
          throw new Error(errMsg);
        });
      }
      return resp.json();
    }

    // Keep the timeout active through response-body decoding as well as the
    // network request. A fetch can resolve with headers while text()/json()
    // hangs, which otherwise leaves the typing indicator stuck forever.
    return Promise.race([apiCall.then(decodeCodeChatResponse), timeoutPromise]).then(function (data) {
      clearTimeout(timeoutId);
      if (requestId !== state._requestId) return;
      if (wsGen !== state.workspaceGeneration) return;

      if (requestId !== state._requestId) return;
      if (wsGen !== state.workspaceGeneration) return;

      // Remove typing indicator
      removeTypingIndicator();

      // Phase 1: Shared controller done lifecycle
      if (state._sharedCtrl && state._sharedCtrl.isActive()) {
        try { state._sharedCtrl.done(); } catch (e) {}
        if (state._telemetry) {
          if (data && data.usage) state._telemetry.recordUsage(data.usage);
          if (data && data.runtime) state._telemetry.recordToolCall(data.runtime.tool_calls || 0);
          state._telemetry.finalize('done');
        }
      }

      var replyContent = (data && data.reply) ? data.reply : '（无响应）';
      var now2 = new Date();
      var timeStr2 = now2.getHours().toString().padStart(2, '0') + ':' + now2.getMinutes().toString().padStart(2, '0');

      state.lastSentAttachmentPaths = state.attachments.filter(function (attachment) { return !attachment.pinned; }).map(function (attachment) { return attachment.path; });
      consumeTransientAttachments();
      state.lastFailedMessage = '';
      state.messages.push({ role: 'assistant', content: replyContent, time: timeStr2 });

      // Store operations
      if (data && data.operations && Array.isArray(data.operations)) {
        state.pendingOperations = data.operations;
      }

      // Update last read context for display
      if (data && data.context_info) {
        state.lastReadContext = data.context_info;
      }
      if (data && data.runtime) {
        state.lastRuntime = data.runtime;
      }
      state.lastToolTrace = data && Array.isArray(data.tool_trace) ? data.tool_trace : [];
      if (data && data.capabilities) state.capabilities = data.capabilities;
      renderProjectStatus();

      renderChatPanel();

      // Show diff view if operations exist
      if (state.pendingOperations.length > 0) {
        renderDiffView();
      }
    }).catch(function (err) {
      clearTimeout(timeoutId);
      if (requestId !== state._requestId) return;
      if (wsGen !== state.workspaceGeneration) return;
      // AbortError is not a real failure
      if (err && err.name === 'AbortError') return;

      // A Render restart or eviction can invalidate the server-side index
      // between the status check and chat request. Rebuild once automatically
      // and retry the same message instead of making the user resend it.
      if (err && err.code === 'INDEX_REBUILD_REQUIRED' && !indexRetry) {
        state.projectIndexStatus = { indexed: false, building: true, phase: '索引已丢失，正在自动重建...' };
        renderProjectStatus();
        return buildProjectIndex().then(function (result) {
          if (!result || !state.projectIndexStatus || state.projectIndexStatus.indexed !== true) {
            var rebuildFailed = new Error('索引重建失败，请点击“刷新索引”后重试');
            rebuildFailed.code = 'INDEX_REBUILD_FAILED';
            throw rebuildFailed;
          }
          if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) return null;
          // P0 Fix: 自动重试不再添加第二次用户消息
          return sendApiRequest(body, requestId, timeStr, wsGen, true);
        }).catch(function (rebuildError) {
          if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) return null;
          removeTypingIndicator();
          // P0 Fix: 索引重建失败，不重复恢复消息
          state.messages.push({ role: 'assistant', content: '索引重建失败：' + ((rebuildError && rebuildError.message) || '请稍后重试'), time: timeStr });
          renderChatPanel();
          return null;
        });
      }

      removeTypingIndicator();

      var errMsg = (err && err.message) ? err.message : String(err);
      var errCode = (err && err.code) ? err.code : '';
      var errRequestId = (err && err.requestId) ? err.requestId : '';

      // Phase 3: Use shared error classification when enabled
      var classified = null;
      if (window.XtjAiCore && window.XtjAiCore.Errors && window.XtjAiCore.RequestController && window.XtjAiCore.RequestController.FEATURE_FLAG) {
        classified = window.XtjAiCore.Errors.classify(err, {
          requestId: errRequestId,
          phase: 'code_request',
          toolTrace: (err && err.toolTrace) || null
        });
        errCode = classified.code;
        errMsg = classified.message;
        errRequestId = classified.request_id || errRequestId;
      }

      if (errCode === 'INDEX_REBUILD_REQUIRED') {
        errMsg = '项目索引尚未建立，但文档内容已可用。您可以继续提问，系统会使用文档正文回答。';
      }

      console.error('[CODE-AI] Request failed:', errMsg, errCode || '', errRequestId || '');
      // Phase 1: Shared controller error lifecycle
      if (state._sharedCtrl && state._sharedCtrl.isActive()) {
        try { state._sharedCtrl.error(errCode || 'code_request_error'); } catch (e) {}
        if (state._telemetry) { state._telemetry.finalize('error', { code: errCode, phase: 'code_request', message: errMsg }); }
      }
      // P0 Fix: 只在 400 类错误（客户端验证失败）时恢复消息到输入框
      if (errCode === 'PROVIDER_HTTP_400' || errCode === 'PROVIDER_INVALID_REQUEST' || errCode === 'VALIDATION_FAILED') {
        restoreFailedMessage(body && body.message);
      }

      // Phase 2: Build enhanced error message — 用户可见消息不显示错误码
      var displayMsg = errMsg;
      var userFriendlyMsg = '抱歉，操作失败';
      if (window.XtjAiCore && window.XtjAiCore.Errors && window.XtjAiCore.Errors.formatUserMessage) {
        userFriendlyMsg = window.XtjAiCore.Errors.formatUserMessage(err);
      } else if (errCode === 'INDEX_REBUILD_REQUIRED') {
        userFriendlyMsg = '项目索引尚未建立，但文档内容已可用。您可以继续提问，系统会使用文档正文回答。';
      } else if (errCode === 'DOCUMENT_NOT_PARSED') {
        userFriendlyMsg = '文档正在解析中，请等待解析完成后重试。';
      } else if (errCode === 'NO_WRITE_PERMISSION') {
        userFriendlyMsg = '没有文件写入权限，请重新授权写入权限后再试。';
      } else if (errCode === 'FORMAT_NOT_EDITABLE') {
        userFriendlyMsg = '该文件格式暂不支持修改。PDF 可读取和分析，DOCX/PPTX/XLSX 可修改。';
      } else if (errCode === 'PROVIDER_TIMEOUT') {
        userFriendlyMsg = 'AI 请求超时，请重试或简化问题。';
      } else if (errCode === 'PROVIDER_HTTP_401') {
        userFriendlyMsg = 'API 密钥无效，请检查 AI 服务配置。';
      } else if (errCode === 'PROVIDER_HTTP_403') {
        userFriendlyMsg = 'API 访问被拒绝，请检查权限配置。';
      } else if (errCode === 'PROVIDER_HTTP_429') {
        userFriendlyMsg = '请求过于频繁，请稍后重试。';
      } else if (errCode === 'STREAM_INTERRUPTED') {
        userFriendlyMsg = '连接中断，请检查网络后重试。';
      } else if (errCode === 'AMBIGUOUS_REQUEST') {
        userFriendlyMsg = '请明确说明要修改什么内容，例如："将标题改为XXX"或"在第三段后插入XXX"。';
      } else if (errCode && errCode.indexOf('PROVIDER_') === 0) {
        userFriendlyMsg = 'AI 服务暂时无法处理该请求，请稍后重试。';
      }
      var assistantMsg = { role: 'assistant', content: userFriendlyMsg, time: timeStr, errorCode: errCode, requestId: errRequestId };

      // Phase 3: Add retryable hint from shared error classification
      if (classified && classified.retryable) {
        assistantMsg.retryable = true;
      }

      // Phase 2: Preserve tool trace when tools succeeded but final answer failed
      if (err && Array.isArray(err.toolTrace) && err.toolTrace.length > 0) {
        assistantMsg.toolTrace = err.toolTrace;
        assistantMsg.toolTraceNote = '工具执行成功，模型总结失败';
        state.lastToolTrace = err.toolTrace;
      }

      state.messages.push(assistantMsg);

      renderChatPanel();
      // P0 Fix: 只恢复一次消息到输入框，不重复调用 restoreFailedMessage
    }).then(function () {
      // P0: finally — 统一恢复 UI 状态
      clearTimeout(timeoutId);
      // Guard: if request is stale, only clean local resources, not state
      var isStale = (requestId !== state._requestId || wsGen !== state.workspaceGeneration);
      if (isStale) {
        // Stale request: only clean up the captured controller, not state._sharedCtrl
        return;
      }
      // Phase 1: Cleanup shared controller (only when request is current)
      var sharedCtrlKey = 'code_ai_' + requestId;
      if (state._sharedCtrl) {
        try { window.XtjAiCore.RequestController.unregisterInFlight(sharedCtrlKey); } catch(e) {}
        state._sharedCtrl = null;
      }
      state._telemetry = null;
      clearSendingWatchdog();
      state.sending = false;
      state._abortController = null;
      // P0 Fix: 不重新禁用输入框
      updateChatRequestControls();
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
  // computeDiff(oldText, newText) — line-by-line LCS diff
  // ──────────────────────────────────────────────
  function computeDiff(oldText, newText) {
    var oldLines = oldText.split('\n');
    var newLines = newText.split('\n');
    var m = oldLines.length;
    var n = newLines.length;

    // Build LCS table
    var dp = new Array(m + 1);
    for (var i = 0; i <= m; i++) {
      dp[i] = new Array(n + 1);
      for (var j = 0; j <= n; j++) {
        if (i === 0 || j === 0) {
          dp[i][j] = 0;
        } else if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to generate diff
    var i = m, j = n;
    var diffLines = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diffLines.unshift({ type: 'unchanged', lineNum: i, text: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diffLines.unshift({ type: 'added', lineNum: j, text: newLines[j - 1] });
        j--;
      } else {
        diffLines.unshift({ type: 'removed', lineNum: i, text: oldLines[i - 1] });
        i--;
      }
    }
    return diffLines;
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
          '  将另存为: <strong>' + escapeHTML((op.path || '').replace(/(\.[^.]+)$/, '_AI修改版$1')) + '</strong>' +
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
        if (op.type === 'replace_range' && op.start_line && op.end_line) {
          var lines = originalContent.split('\n');
          var startIdx = Math.max(0, op.start_line - 1);
          var endIdx = Math.max(0, op.end_line);
          var prefix = lines.slice(0, startIdx).join('\n');
          var suffix = lines.slice(endIdx).join('\n');
          newContent = (prefix ? prefix + '\n' : '') + newContent + (suffix ? '\n' + suffix : '');
        }
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

    // GitHub and browser-fallback workspaces are read-only. Do not expose
    // controls that can only fail with a misleading error toast.
    if (state._isReadOnly) {
      var readOnlyApplyActions = applyBar.querySelector('.apply-actions');
      if (readOnlyApplyActions) {
        readOnlyApplyActions.replaceChildren();
        var readOnlyLabel = document.createElement('span');
        readOnlyLabel.className = 'apply-readonly-label';
        readOnlyLabel.textContent = '只读工作区不可应用修改';
        readOnlyApplyActions.appendChild(readOnlyLabel);
      }
    }

    // Bind buttons (use _bound flag to avoid duplicate listeners on re-render)
    var applyBtn = document.getElementById('codeApplyAllBtn');
    var undoBtn = document.getElementById('codeUndoBtn');
    if (applyBtn && !applyBtn._diffBound) {
      applyBtn._diffBound = true;
      applyBtn.addEventListener('click', applyAllOperations);
    }
    if (undoBtn && !undoBtn._diffBound) {
      undoBtn._diffBound = true;
      undoBtn.addEventListener('click', function() { undoOperations(); });
    }
  }

  // ──────────────────────────────────────────────
  // findAvailableBinaryPath(fs, basePath)
  // 递增计数器直到找到不存在的文件路径
  // ──────────────────────────────────────────────
  function findAvailableBinaryPath(fs, basePath) {
    return fs.fileExistsByPath(basePath).then(function (exists) {
      if (!exists) return basePath;
      var dotIdx = basePath.lastIndexOf('.');
      var base = dotIdx >= 0 ? basePath.slice(0, dotIdx) : basePath;
      var ext = dotIdx >= 0 ? basePath.slice(dotIdx) : '';
      var counter = 2;
      function tryNext() {
        var candidate = base + '_' + counter + ext;
        return fs.fileExistsByPath(candidate).then(function (e) {
          if (!e) return candidate;
          counter++;
          return tryNext();
        });
      }
      return tryNext();
    });
  }

  // ──────────────────────────────────────────────
  // applyDocumentOperation(op, index)
  // 由 applyOperation 调用，不自行管理 _applyLock
  // 批量锁由 applyAllOperations 统一管理
  // ──────────────────────────────────────────────
  function applyDocumentOperation(op, index) {
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.readFileByPath || !fs.writeBinaryFileByPath) {
      return Promise.reject(new Error('File system not available'));
    }

    // Read original file as ArrayBuffer
    return fs.readFileByPath(op.path).then(function (result) {
      if (!result || !result.content) {
        throw new Error('无法读取文件');
      }

      // result.content is an ArrayBuffer for document files.
      var buffer = result.content;
      var ext = op.path.split('.').pop().toLowerCase();
      var mimeType = ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                     ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                     ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' :
                     'application/octet-stream';

      // Create FormData
      var formData = new FormData();
      formData.append('file', new Blob([buffer], { type: mimeType }), op.path.split('/').pop());
      formData.append('fileName', op.path.split('/').pop());
      formData.append('mimeType', mimeType);
      formData.append('documentType', op.document_type || ext);
      formData.append('operations', JSON.stringify(op.document_operations || []));

      // Call backend API
      var apiCall;
      if (window.xtjProtectedFetch) {
        apiCall = window.xtjProtectedFetch('/api/code/document/apply', {
          method: 'POST',
          body: formData
        });
      } else {
        apiCall = fetch('/api/code/document/apply', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
      }

      return apiCall.then(function (resp) {
        if (!resp.ok) {
          return resp.json().then(function (data) {
            throw new Error(data.error || '文档操作失败');
          }).catch(function (err) {
            throw new Error(err.message || '文档操作失败');
          });
        }
        
        var rawMime = resp.headers.get('Content-Type') || '';
        var newMimeType = rawMime.split(';')[0].trim().toLowerCase();
        var disposition = resp.headers.get('Content-Disposition') || '';
        
        // Extract filename from disposition if present
        var match = disposition.match(/filename="([^"]+)"/);
        var returnedFileName = match ? decodeURIComponent(match[1]) : op.path.split('/').pop();
        
        return resp.arrayBuffer().then(function (ab) {
           return {
             newFileBuffer: ab,
             newFileName: returnedFileName,
             newMimeType: newMimeType
           };
        });
      }).then(function (data) {
        if (!data || !data.newFileBuffer) {
          throw new Error('文档操作返回数据无效');
        }

        var newFileName = data.newFileName;
        var newMimeType = data.newMimeType;
        var newExt = newFileName.split('.').pop().toLowerCase();

        // Validate MIME vs extension before saving
        if (newExt === 'docx' && newMimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          throw new Error('DOCX 文件格式无效，暂不支持此操作');
        }
        if (newExt === 'xlsx' && newMimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
          throw new Error('XLSX 文件格式无效');
        }
        if (newExt === 'pptx' && newMimeType !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
          throw new Error('PPTX 文件格式无效');
        }
        if (newMimeType === 'text/plain' && newExt !== 'txt') {
          throw new Error('text/plain 只能保存为 .txt 文件');
        }

        // P0 Fix: DOCX and PPTX are now writable via backend document operations.
        // PDF is genuinely read-only for in-place editing.
        var origExt = op.path.split('.').pop().toLowerCase();
        if (origExt === 'pdf') {
          throw new Error('PDF 不支持原位编辑，可通过提取文本后生成新文档');
        }

        // Save as new file (don't overwrite original)
        var parentPath = op.path.indexOf('/') >= 0 ? op.path.substring(0, op.path.lastIndexOf('/') + 1) : '';
        var newPath = parentPath + newFileName; // The backend already append _AI修改版

        // P2 #10: if file already exists, generate unique name (e.g., _AI修改版_2.xlsx)
        return findAvailableBinaryPath(fs, newPath).then(function (availablePath) {
          return fs.createBinaryFileByPath(availablePath, data.newFileBuffer).then(function () {
            // Remove operation from pending
            state.pendingOperations.splice(index, 1);

            // P0 Fix: Invalidate old index after document modification
            // The document content has changed, so the old index is stale.
            state.projectIndexStatus = null;
            state._indexBuildPromise = null;
            state._indexBuildKey = '';

            // Refresh file tree
            refreshFileTree();

            // Open the new file
            openFile(availablePath);

            showToast('\u5df2\u4fdd\u5b58\u4e3a: ' + availablePath.split('/').pop(), 'success');
            return true;
          });
        });
      });
    }).catch(function (err) {
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
      return fs.fileExistsByPath(op.path).then(function(exists) {
        if (exists) {
          throw new Error('目标文件已存在');
        }
        return fs.createFileByPath(op.path, op.new_content || '');
      }).then(function (writeResult) {
        // Save snapshot ONLY after successful creation (not before, to avoid phantom undo)
        if (!state.snapshots[op.path]) {
          state.snapshots[op.path] = { existed: false, beforeContent: '', beforeSha256: '', afterSha256: writeResult.sha256 || '' };
        } else {
          state.snapshots[op.path].afterSha256 = writeResult.sha256 || '';
        }
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
      }).catch(function (err) {
        // Clean up residual snapshot on failure
        delete state.snapshots[op.path];
        throw err;
      });
    }

    // replace_range/update: re-read existing file and verify SHA-256 + line ranges
    if (!fs.readFileByPath) {
      return Promise.reject(new Error('File system not available'));
    }

    return fs.readFileByPath(op.path).then(function (result) {
      if (!result) {
        throw new Error('无法读取文件: ' + op.path);
      }

      // Strict SHA-256 validation for replace_range
      if (op.type === 'replace_range') {
        if (!op.expected_sha256) {
          throw new Error('replace_range 操作缺少 expected_sha256，拒绝执行');
        }
        if (!op.start_line || !op.end_line) {
          throw new Error('replace_range 操作缺少 start_line 或 end_line，拒绝执行');
        }
        if (result.sha256 !== op.expected_sha256) {
          throw new Error('文件 "' + op.path + '" 已被修改（SHA 不匹配），与 AI 生成回复时的内容不一致。请重新生成。');
        }
      } else if (op.expected_sha256 && result.sha256 !== op.expected_sha256) {
        throw new Error('文件 "' + op.path + '" 已被修改，与 AI 生成回复时的内容不一致。请重新生成。');
      }

      // Take snapshot of current content BEFORE writing
      var currentText = result.type === 'text' ? result.content : '';
      if (!state.snapshots[op.path]) {
        state.snapshots[op.path] = {
          existed: true,
          beforeContent: currentText,
          beforeSha256: result.sha256 || ''
        };
      }

      var contentToWrite = op.new_content || '';

      if (op.type === 'replace_range') {
        var lines = currentText.split('\n');
        var totalLines = lines.length;

        // Strict line range validation: lines must be within actual file range
        if (op.start_line < 1 || op.end_line < op.start_line) {
          throw new Error('replace_range 行号无效: start_line=' + op.start_line + ', end_line=' + op.end_line);
        }
        if (op.start_line > totalLines) {
          throw new Error('replace_range start_line (' + op.start_line + ') 超出文件范围（共 ' + totalLines + ' 行）');
        }
        if (op.end_line > totalLines + 1) {
          throw new Error('replace_range end_line (' + op.end_line + ') 超出文件范围（共 ' + totalLines + ' 行）');
        }

        // Build candidate content in memory first
        var startIdx = op.start_line - 1;
        var endIdx = op.end_line;
        var prefix = lines.slice(0, startIdx).join('\n');
        var suffix = lines.slice(Math.min(endIdx, totalLines)).join('\n');
        contentToWrite = (prefix ? prefix + '\n' : '') + op.new_content + (suffix ? '\n' + suffix : '');
      }

      op._final_written_content = contentToWrite;
      return fs.writeFileByPath(op.path, contentToWrite);
    }).then(function (writeResult) {
      // Post-write verification: re-read and verify SHA
      return fs.readFileByPath(op.path).then(function (verifyResult) {
        var expectedSha = writeResult.sha256 || '';
        if (verifyResult && verifyResult.sha256 && expectedSha && verifyResult.sha256 !== expectedSha) {
          console.error('[code-workspace] Post-write SHA mismatch for', op.path);
        }
        if (state.snapshots[op.path]) {
          state.snapshots[op.path].afterSha256 = (verifyResult && verifyResult.sha256) || writeResult.sha256 || '';
        }
        return writeResult;
      }).catch(function() {
        if (state.snapshots[op.path]) state.snapshots[op.path].afterSha256 = writeResult.sha256 || '';
        return writeResult;
      });
    }).then(function (writeResult) {
      // Update open tab if file is open
      var finalContent = op._final_written_content || op.new_content || '';
      for (var i = 0; i < state.openTabs.length; i++) {
        if (state.openTabs[i].path === op.path) {
          state.openTabs[i].content = finalContent;
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
    if (state._isReadOnly) {
      showToast('当前为只读模式，不支持应用修改', 'error');
      return;
    }
    if (state._applyLock) return;
    state._applyLock = true;
    state.applying = true;

    // P0: 保存当前 workspace generation
    var wsGen = state.workspaceGeneration;

    var applyBtn = document.getElementById('codeApplyAllBtn');
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = '应用...';
    }

    function applyNext(idx) {
      if (wsGen !== state.workspaceGeneration) {
        // Workspace changed, stop applying
        state._applyLock = false;
        state.applying = false;
        return;
      }
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
    if (state._undoLock) return Promise.resolve(false);
    if (state._isReadOnly) {
      showToast('当前为只读模式，不支持撤销文件修改', 'error');
      return Promise.resolve(false);
    }
    var snapshotPaths = Object.keys(state.snapshots);
    if (snapshotPaths.length === 0) {
      showToast('没有可撤销的操作', 'info');
      return Promise.resolve(false);
    }

    var fs = window.__xtjCodeFS;
    if (!fs) {
      showToast('文件系统不可用', 'error');
      return Promise.resolve(false);
    }

    state._undoLock = true;
    var wsGen = state.workspaceGeneration;

    var promises = [];
    var successPaths = [];
    var failedPaths = [];

    for (var i = 0; i < snapshotPaths.length; i++) {
      (function (p, snapshot) {
        promises.push(
          new Promise(function (resolve) {
            if (wsGen !== state.workspaceGeneration) {
              failedPaths.push(p);
              resolve(false);
              return;
            }
            if (snapshot.existed === false) {
              // This was a create operation — delete the file
              if (!fs.deleteFileByPath) {
                // Replacing a newly-created file with an empty file is not an
                // undo. Keep the snapshot so the user can retry safely.
                failedPaths.push(p);
                resolve(false);
                return;
              }
              if (!fs.readFileByPath || !snapshot.afterSha256) {
                failedPaths.push(p);
                resolve(false);
                return;
              }
              fs.readFileByPath(p).then(function (current) {
                if (!current || current.sha256 !== snapshot.afterSha256) {
                  throw new Error('File changed after AI apply; undo was not applied');
                }
                return fs.deleteFileByPath(p);
              }).then(function () {
                if (wsGen !== state.workspaceGeneration) {
                  resolve(false);
                  return;
                }
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

            if (!fs.readFileByPath || !snapshot.afterSha256) {
              failedPaths.push(p);
              resolve(false);
              return;
            }
            fs.readFileByPath(p).then(function (current) {
              if (!current || current.sha256 !== snapshot.afterSha256) {
                throw new Error('File changed after AI apply; undo was not applied');
              }
              return fs.writeFileByPath(p, snapshot.beforeContent || '');
            }).then(function () {
              if (wsGen !== state.workspaceGeneration) {
                resolve(false);
                return;
              }
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

    return Promise.all(promises).then(function () {
      if (wsGen !== state.workspaceGeneration) return false;
      // Only remove successful snapshots
      for (var k = 0; k < successPaths.length; k++) {
        delete state.snapshots[successPaths[k]];
      }

      // pendingOperations contains AI suggestions that have not been applied.
      // Undoing previously-applied snapshots must never discard that queue,
      // including when only part of the undo succeeds.
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
      return failedPaths.length === 0;
    }).finally(function () {
      state._undoLock = false;
    });
  }

  // ──────────────────────────────────────────────
  // Event: window beforeunload — P0: 浏览器刷新和关闭保护
  // ──────────────────────────────────────────────
  window.addEventListener('beforeunload', function (event) {
    if (state.active && hasUnsavedChanges()) {
      // 触发浏览器原生离开确认，不在 beforeunload 中弹自定义 confirm
      event.preventDefault();
      event.returnValue = '';
    }
    // Do not clear workspace state here: the browser may cancel navigation after the
    // native prompt, in which case clearing editors/blob URLs corrupts the
    // still-visible workspace.
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
    pinFile: pinFile,
    unpinFile: unpinFile,
    toggleContext: toggleContext, // Kept for backward compat
    getState: function () { return state; },
    selectAndOpenWorkspace: selectAndOpenWorkspace
  };
  if (window.__XTJ_TEST_MODE__) {
    window.__xtjCodeWorkspaceTestHooks = {
      buildChatRequestBody: buildChatRequestBody,
      parseSimpleMarkdown: parseSimpleMarkdown,
      ensureOpenFileContexts: ensureOpenFileContexts,
      processAttachmentFile: processAttachmentFile,
      removeAttachment: removeAttachment,
      toggleAttachmentPinned: toggleAttachmentPinned,
      consumeTransientAttachments: consumeTransientAttachments,
      clearAttachments: clearAttachments,
      loadGitHubRepositoryInfo: loadGitHubRepositoryInfo,
      openGitHubWorkspace: openGitHubWorkspace,
      buildProjectIndex: buildProjectIndex,
      saveFile: saveFile,
      undoOperations: undoOperations,
      cancelCurrentRequest: cancelCurrentRequest,
      selectAndOpenFile: selectAndOpenFile,
      loadProjectIndexStatus: loadProjectIndexStatus,
      openFile: openFile,
      restoreTabs: restoreTabs,
      getWorkspaceId: getWorkspaceId,
      getState: function () { return state; }
    };
  }

  // Exports for desktop-shell.js integration
  window.__xtjCodeInit = init;
  window.__xtjCodeRefreshWorkspace = function () {
    // Refresh: re-render file tree and chat
    if (state.active && state.directoryHandle) {
      renderFileTree();
      renderProjectStatus();
      showToast('工作区已刷新', 'info');
    }
    return Promise.resolve();
  };

})();
