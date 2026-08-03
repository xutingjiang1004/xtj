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
    models: [],
    modelLoadError: '',
    selectedModelId: '',
    thinkingMode: 'auto',
    composerDraft: '',
    composerMenu: null,
    ignoreDocumentContextOnce: false,
    composerIsComposing: false,
    composerMounted: false,
    autoScrollPinned: true,
    attachments: [],
    lastSentAttachmentPaths: [],
    attachmentProcessing: false,
    attachmentError: '',
    messages: [],
    lastFailedMessage: '',
    conversationId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    pendingOperations: [],
    recoveredOperations: [], // 流恢复操作，只读 Diff 视图
    snapshots: {},
    _documentStates: {}, // path -> { state: 'extracting'|'ready'|'failed'|'timed_out'|'cancelled', generation, error }
    sending: false,
    // P2: request lifecycle status — 'idle' | 'loading' | 'ready' | 'failed'.
    // state.sending is a boolean for backward compat; requestStatus is the
    // authoritative state machine that distinguishes "ready" (last request
    // succeeded) from "failed" (last request errored), which a single boolean
    // cannot express.
    requestStatus: 'idle',
    applying: false,
    _applyLock: false,
    _monacoLoaded: false,
    _monacoLoadPromise: null,
    _monacoEditor: null,
    _editorRenderId: 0,
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
    _modelsPromise: null,
    _composerGlobalCleanup: null,
    _localRuntime: null,
    _localRuntimeUnsubscribe: null,
    _localDownloadController: null,
    _localDownloadRuntime: null,
    _openFilePromises: {},
    _savePromises: {},
    _undoLock: false,
    _requestId: 0,
    _themeObserver: null,
    _resizerCleanup: null,
    _isReadOnly: false,
    _persistenceFailed: false, // P0-9: 标记 IndexedDB 持久化是否失败
    workspaceGeneration: 0,
    restoreGeneration: 0
  };

  // ──────────────────────────────────────────────
  // DOM cache
  // ──────────────────────────────────────────────
  var _dom = {};
  var _documentExtractionSerial = 0;
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
  var CODE_PHONE_MAX_WIDTH = 767;
  var DIFF_MAX_LINES = 2400;
  var DIFF_MAX_CHARS = 180000;

  // Phase 2: Feature flag for streaming Code agent.  Keep streaming enabled
  // by default; a per-browser test/diagnostic override avoids requiring every
  // fixture to emulate SSE when it is testing the JSON contract.
  var CODE_STREAM_ENABLED = (function () {
    try { return localStorage.getItem('CODE_STREAM_ENABLED') !== '0'; } catch (e) { return true; }
  })();

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
    // Code notifications must stay inside the Code flow. The global toast is
    // fixed near the top of the viewport and can cover the streamed answer.
    var notice = document.getElementById('codeChatNotice');
    if (!notice && _dom.panelCode) notice = _dom.panelCode.querySelector('.code-chat-notice');
    if (!notice && _dom.panelCode) {
      notice = document.createElement('div');
      notice.className = 'code-chat-notice';
      notice.id = 'codeChatNotice';
      notice.hidden = true;
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      _dom.panelCode.insertBefore(notice, _dom.panelCode.firstChild || null);
    }
    if (!notice) return;
    if (notice._hideTimer) clearTimeout(notice._hideTimer);
    notice.className = 'code-chat-notice' + (type === 'error' ? ' error' : '') + (type === 'success' ? ' success' : '') + (type === 'warning' ? ' warning' : '');
    notice.textContent = String(msg || '');
    notice.hidden = false;
    notice.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notice._hideTimer = setTimeout(function () {
      notice.hidden = true;
      notice._hideTimer = null;
    }, type === 'error' ? 6000 : 3500);
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
  // Monaco CDN URLs in priority order — 国内/国际双重备用
  var MONACO_CDN_URLS = [
    { vs: 'https://registry.npmmirror.com/monaco-editor/0.45.0/files/min/vs', loader: 'https://registry.npmmirror.com/monaco-editor/0.45.0/files/min/vs/loader.js' },
    { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs', loader: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js' },
    { vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs', loader: 'https://unpkg.com/monaco-editor@0.45.0/min/vs/loader.js' }
  ];

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
    // Share one loader promise.  Opening files quickly must not inject a
    // second AMD loader (which can race and overwrite the first editor).
    if (!state._monacoLoadPromise) {
      state._monacoLoadPromise = new Promise(function (resolve, reject) {
        var settled = false;
        var cdnIndex = 0;
        var timeoutId = null;
        var requireTimeoutId = null;

        function rejectMonaco(error) {
          if (settled) return;
          settled = true;
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
          if (requireTimeoutId) { clearTimeout(requireTimeoutId); requireTimeoutId = null; }
          reject(error);
        }

        function resolveMonaco() {
          if (settled) return;
          settled = true;
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
          if (requireTimeoutId) { clearTimeout(requireTimeoutId); requireTimeoutId = null; }
          resolve();
        }

        // Clean up Monaco AMD loader state so the next CDN attempt starts fresh.
        function cleanupMonacoLoader() {
          try {
            // Remove any previous Monaco loader script
            var prev = document.querySelector('script[data-xtj-monaco-loader="1"]');
            if (prev) try { prev.remove(); } catch (_) {}
            // Remove any Monaco AMD-loaded script tags (they reference the failed CDN)
            document.querySelectorAll('script[src*="monaco-editor"]').forEach(function (s) { try { s.remove(); } catch (_) {} });
          } catch (_) {}
          // Delete the partially-loaded monaco global to prevent stale state
          try { delete window.monaco; } catch (_) { window.monaco = undefined; }
          // Delete AMD loader context if it exists (from a previous failed require)
          try {
            if (typeof require !== 'undefined' && require.s && require.s.contexts) {
              Object.keys(require.s.contexts).forEach(function (ctx) {
                if (ctx !== '_') try { delete require.s.contexts[ctx]; } catch (_) {}
              });
            }
          } catch (_) {}
        }

        // Try loading from each CDN in order, retrying on failure
        function tryLoadCDN() {
          if (cdnIndex >= MONACO_CDN_URLS.length) {
            rejectMonaco(new Error('Monaco 所有 CDN 加载失败，已切换到基础编辑器'));
            return;
          }

          var cdn = MONACO_CDN_URLS[cdnIndex];
          cdnIndex++;

          // Clean up stale loader state before trying a new CDN
          cleanupMonacoLoader();

          timeoutId = setTimeout(function () {
            // 当前 CDN 超时，尝试下一个
            timeoutId = null;
            console.warn('[CODE] Monaco CDN ' + cdn.loader + ' 超时，尝试下一个 CDN...');
            tryLoadCDN();
          }, 5000);

          var script = document.createElement('script');
          script.src = cdn.loader;
          script.setAttribute('data-xtj-monaco-loader', '1');

          script.onload = function () {
            if (settled) return;
            // Loader script loaded, now require the editor main module
            try {
              require.config({ paths: { vs: cdn.vs } });
              // Set a shorter timeout for the require call itself
              requireTimeoutId = setTimeout(function () {
                requireTimeoutId = null;
                console.warn('[CODE] Monaco require 超时 (CDN: ' + cdn.loader + ')，尝试下一个 CDN...');
                tryLoadCDN();
              }, 8000);
              require(['vs/editor/editor.main'], function () {
                if (requireTimeoutId) { clearTimeout(requireTimeoutId); requireTimeoutId = null; }
                if (settled) return;
                state._monacoLoaded = true;
                resolveMonaco();
              }, function (err) {
                if (requireTimeoutId) { clearTimeout(requireTimeoutId); requireTimeoutId = null; }
                console.warn('[CODE] Monaco require 失败 (CDN: ' + cdn.loader + '):', err);
                tryLoadCDN();
              });
            } catch (e) {
              console.warn('[CODE] Monaco require 配置异常 (CDN: ' + cdn.loader + '):', e);
              tryLoadCDN();
            }
          };

          script.onerror = function () {
            if (settled) return;
            console.warn('[CODE] Monaco loader 下载失败 (CDN: ' + cdn.loader + ')');
            tryLoadCDN();
          };

          document.head.appendChild(script);
        }

        // Start trying CDNs
        tryLoadCDN();
      }).catch(function (error) {
        // Allow a later file open to retry after a transient CDN failure.
        state._monacoLoadPromise = null;
        throw error;
      });
    }
    state._monacoLoadPromise.then(function () { callback(null); }, callback);
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

    if (window.innerWidth <= CODE_PHONE_MAX_WIDTH) {
      _dom.panelCode = panelCode;
      renderPhoneOnlyNotice();
      return Promise.resolve({ status: 'phone-unsupported' });
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
        checkStreamRecovery();
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
    persistOpenTabs();
    var hasUnsaved = state.openTabs.some(function(t) { return t.modified && t._currentContent !== undefined; });
    if (hasUnsaved) {
      if (!window.confirm('文件存在未保存修改，是否继续？')) {
        return false; // Signal cancellation to caller
      }
    }
    // Cancel any in-flight request via activeRequest context
    if (state.activeRequest) {
      state.activeRequest.cancelled = true;
      state.activeRequest.cancelReason = 'cleanup';
      finalizeRequest(state.activeRequest, { cancelled: true, cancelReason: 'cleanup' });
    } else if (state._abortController) {
      // Compatibility fallback for a request created before ctx registration.
      try { state._abortController.abort(); } catch (_) {}
    }
    abortController(state._attachmentController);
    abortController(state._githubController);
    abortController(state._indexController);
    abortController(state._indexStatusController);
    abortController(state._localDownloadController);
    if (state._localDownloadRuntime && typeof state._localDownloadRuntime.stop === 'function') {
      try { state._localDownloadRuntime.stop(); } catch (_) {}
    }
    state._attachmentController = null;
    state._githubController = null;
    state._indexController = null;
    state._indexStatusController = null;
    state._localDownloadController = null;
    state._localDownloadRuntime = null;
    state._githubLoadPromise = null;
    state._indexBuildPromise = null;
    state._openFilePromises = {};
    state._savePromises = {};
    state._requestId++;
    if (state._resizerCleanup) state._resizerCleanup();
    if (state._composerGlobalCleanup) state._composerGlobalCleanup();
    state._composerGlobalCleanup = null;
    revokeAllUrls();
    disposeMonaco();
    state.sending = false;
    clearAttachments();
    state.lastSentAttachmentPaths = [];
    state.active = false;
    state.composerMounted = false;
    _dom = {};
    if (typeof _dragState !== 'undefined' && _dragState) {
      document.body.classList.remove('code-is-resizing');
      document.body.classList.remove('code-is-resizing-row');
      _dragState = null;
    }
    document.documentElement.classList.remove('code-workbench-nav-collapsed');
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
      '<h2 class="welcome-title">Code</h2>' +
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
      // Keep the status slot out of the layout until restore produces
      // feedback; an empty bordered span looks like a broken control.
      statusText.style.display = 'none';

      recentEl.appendChild(restoreBtn);
      recentEl.appendChild(statusText);

      restoreBtn.addEventListener('click', function () {
        var manualRestoreGeneration = ++state.restoreGeneration;
        restoreBtn.disabled = true;
        restoreBtn.innerHTML = '<span class="folder-icon">⏳</span> 正在恢复...';
        statusText.textContent = '';
        statusText.className = 'welcome-status';
        statusText.style.display = 'block';

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
      if (fs.setDirHandle) fs.setDirHandle(handle);
      try { localStorage.setItem('xtj_code_workspace_name', state.workspaceName); } catch (e) { /* ignore */ }
      renderWorkspace();
      if (handle && handle._isSingleFileRoot) {
        window.setTimeout(function () {
          openFile(handle.name).then(function (tab) {
            if (!tab && _dom.editorArea) renderEmptyState();
          });
        }, 0);
      }
    }

    function openWithInputFallback() {
      // Some embedded browsers expose showOpenFilePicker but reject it at
      // runtime. Fall back to the ordinary file input instead of leaving the
      // Code panel on a blank welcome state.
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
        openWithInputFallback();
      });
      return;
    }

    openWithInputFallback();
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

  function openTabsStorageKey(workspaceId) {
    return 'xtj_code_open_tabs:' + encodeURIComponent(workspaceId || getWorkspaceId());
  }

  function persistOpenTabs() {
    if (!state.directoryHandle || !state.workspaceName) return;
    var paths = [];
    for (var i = 0; i < state.openTabs.length; i++) {
      var path = String(state.openTabs[i] && state.openTabs[i].path || '').trim();
      if (!path || paths.indexOf(path) !== -1) continue;
      try { validatePath(path); } catch (e) { continue; }
      paths.push(path);
    }
    try {
      localStorage.setItem(openTabsStorageKey(getWorkspaceId()), JSON.stringify({
        version: 1,
        paths: paths.slice(0, 40),
        activePath: paths.indexOf(state.activePath) !== -1 ? state.activePath : (paths[0] || '')
      }));
    } catch (e) { /* local preferences are optional */ }
  }

  function restorePersistedTabs() {
    if (!state.directoryHandle || !state.workspaceName || state.openTabs.length) return;
    var saved = null;
    try {
      var raw = localStorage.getItem(openTabsStorageKey(getWorkspaceId()));
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) { saved = null; }
    if (!saved || !Array.isArray(saved.paths)) return;
    var paths = [];
    for (var i = 0; i < saved.paths.length; i++) {
      var path = String(saved.paths[i] || '').trim();
      if (!path || paths.indexOf(path) !== -1) continue;
      try { validatePath(path); } catch (e) { continue; }
      paths.push(path);
    }
    state.openTabs = paths.map(function (path) {
      return {
        path: path,
        name: fileNameFromPath(path),
        modified: false,
        content: null,
        sha256: '',
        type: 'text',
        mimeType: '',
        blobUrl: null,
        size: 0,
        _contentVersion: 0
      };
    });
    state.activePath = paths.indexOf(saved.activePath) !== -1 ? saved.activePath : (paths[0] || '');
    renderProjectStatus();
  }

  // P2: bind client metadata to each pending operation so we can detect stale
  // diffs that belong to a different request / workspace / conversation /
  // generation. Without this, applyOperation can only verify file content SHA
  // — it cannot tell whether the operation belongs to the current workspace
  // session at all.
  function attachPendingOpMetadata(ctx, ops) {
    if (!Array.isArray(ops)) return ops;
    var scope = getWorkspaceScope();
    var meta = {
      _requestId: ctx ? ctx.requestId : null,
      _workspaceId: scope.workspace_id,
      _workspaceGeneration: ctx ? ctx.workspaceGeneration : state.workspaceGeneration,
      _conversationId: state.conversationId,
      _timestamp: Date.now()
    };
    for (var i = 0; i < ops.length; i++) {
      if (ops[i] && typeof ops[i] === 'object' && !ops[i]._requestId) {
        // Attach metadata without mutating the original server-returned object
        // shape (server fields like path/type/new_content remain intact).
        ops[i]._requestId = meta._requestId;
        ops[i]._workspaceId = meta._workspaceId;
        ops[i]._workspaceGeneration = meta._workspaceGeneration;
        ops[i]._conversationId = meta._conversationId;
        ops[i]._timestamp = meta._timestamp;
        if (ctx && ctx.fileContextVersions && Object.prototype.hasOwnProperty.call(ctx.fileContextVersions, ops[i].path)) {
          ops[i]._requestContentVersion = ctx.fileContextVersions[ops[i].path];
        }
      }
    }
    return ops;
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
    persistOpenTabs();
    var previousWorkspaceId = getWorkspaceId();
    var previousGeneration = state.workspaceGeneration;
    // P0: 中止所有进行中的 AI 请求 through the owning context.
    if (state.activeRequest) {
      state.activeRequest.cancelled = true;
      state.activeRequest.cancelReason = 'workspace_reset';
      finalizeRequest(state.activeRequest, { cancelled: true, cancelReason: 'workspace_reset' });
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
    state.openTabs.forEach(function (tab) {
      if (tab && tab._extractAbortController) {
        try { tab._extractAbortController.abort(); } catch (_) {}
        tab._extractAbortController = null;
      }
      if (tab) { tab._extractId = null; tab._docState = 'cancelled'; }
    });
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
    state.recoveredOperations = [];
    state.snapshots = {};
    state._documentStates = {};
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
      showToast('需要 HTTPS 环境才能使用文件系统 API', 'error');
      return;
    }

    if (!window.__xtjCodeFS || !window.__xtjCodeFS.selectDirectory) {
      showToast('文件系统 API 不可用', 'error');
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
      showToast('选择文件夹失败：' + msg, 'error');
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
    editorCollapsed: false,
    workbenchNavCollapsed: false,
    chatCollapsed: false,
    contextCollapsed: false,
    maximizedPanel: null // 'editor' | 'chat' | null
  };

  // Layout controls are persisted, so an invalid combination must never make
  // every recovery control disappear after a reload. In particular, both main
  // panes may not stay collapsed, and a maximized pane may not be collapsed.
  // Return whether a stale saved layout was repaired so callers can persist it
  // immediately instead of recreating the same white screen on refresh.
  function normalizeLayoutState() {
    var repaired = false;
    if (_layoutState.maximizedPanel === 'editor') {
      if (_layoutState.editorCollapsed || _layoutState.chatCollapsed) {
        _layoutState.editorCollapsed = false;
        _layoutState.chatCollapsed = false;
        repaired = true;
      }
    } else if (_layoutState.maximizedPanel === 'chat') {
      if (_layoutState.editorCollapsed || _layoutState.chatCollapsed) {
        _layoutState.editorCollapsed = false;
        _layoutState.chatCollapsed = false;
        repaired = true;
      }
    } else if (_layoutState.editorCollapsed && _layoutState.chatCollapsed) {
      _layoutState.editorCollapsed = false;
      _layoutState.chatCollapsed = false;
      repaired = true;
    }
    return repaired;
  }

  function loadLayoutConfig() {
    var repaired = false;
    try {
      var saved = localStorage.getItem('xtj_code_layout_v1');
      if (saved) {
        var p = JSON.parse(saved);
        if (typeof p.sidebarWidth === 'number') _layoutState.sidebarWidth = p.sidebarWidth;
        if (typeof p.chatWidth === 'number') _layoutState.chatWidth = p.chatWidth;
        if (typeof p.contextHeight === 'number') _layoutState.contextHeight = p.contextHeight;
        if (typeof p.sidebarCollapsed === 'boolean') _layoutState.sidebarCollapsed = p.sidebarCollapsed;
        if (typeof p.editorCollapsed === 'boolean') _layoutState.editorCollapsed = p.editorCollapsed;
        if (typeof p.workbenchNavCollapsed === 'boolean') _layoutState.workbenchNavCollapsed = p.workbenchNavCollapsed;
        if (typeof p.chatCollapsed === 'boolean') _layoutState.chatCollapsed = p.chatCollapsed;
        if (typeof p.contextCollapsed === 'boolean') _layoutState.contextCollapsed = p.contextCollapsed;
        if (p.maximizedPanel === 'editor' || p.maximizedPanel === 'chat' || p.maximizedPanel === null) _layoutState.maximizedPanel = p.maximizedPanel;
      }
    } catch (err) {}
    repaired = normalizeLayoutState();
    if (repaired) saveLayoutConfig();
  }

  function saveLayoutConfig() {
    try {
      // A queued debounce can run after a fast sequence of window controls.
      // Normalize again at the persistence boundary so it can never restore
      // an all-hidden workspace on the next refresh.
      normalizeLayoutState();
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
    normalizeLayoutState();

    // Keep all three panes usable when the host window is smaller than the
    // desktop default. Without this fit pass, the fixed 260px + 360px panes
    // can squeeze the editor down to an unusable sliver before the user gets
    // a chance to drag the dividers. Keep 180px as the desktop floor so a
    // sidebar resize does not make the opposite (chat) divider appear stuck.
    var layoutRoot = _dom.sidebar && _dom.sidebar.parentElement;
    var availableWidth = (layoutRoot && layoutRoot.clientWidth) || _dom.panelCode.clientWidth || window.innerWidth;
    if (availableWidth > 0) {
      var compact = availableWidth < 900;
      var minSidebar = compact ? 188 : 220;
      var minChat = compact ? 240 : 280;
      var minEditor = compact
        ? Math.max(150, Math.min(220, availableWidth - minSidebar - minChat - 8))
        : 180;
      var maxSidebar = Math.min(560, Math.max(minSidebar, availableWidth * 0.45));
      var maxChat = Math.min(760, Math.max(minChat, availableWidth * 0.55));
      _layoutState.sidebarWidth = Math.max(minSidebar, Math.min(_layoutState.sidebarWidth, maxSidebar));
      _layoutState.chatWidth = Math.max(minChat, Math.min(_layoutState.chatWidth, maxChat));
      var dividerBudget = 8;
      var overflow = _layoutState.sidebarWidth + _layoutState.chatWidth + minEditor + dividerBudget - availableWidth;
      if (overflow > 0) {
        var chatReduction = Math.min(overflow, _layoutState.chatWidth - minChat);
        _layoutState.chatWidth -= Math.max(0, chatReduction);
        overflow -= Math.max(0, chatReduction);
        if (overflow > 0) {
          var sidebarReduction = Math.min(overflow, _layoutState.sidebarWidth - minSidebar);
          _layoutState.sidebarWidth -= Math.max(0, sidebarReduction);
        }
      }
      var availableHeight = (layoutRoot && layoutRoot.clientHeight) || _dom.panelCode.clientHeight || window.innerHeight;
      var maxContextHeight = Math.max(80, Math.floor(availableHeight * 0.65));
      _layoutState.contextHeight = Math.max(80, Math.min(_layoutState.contextHeight, maxContextHeight));
    }
    
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

    _dom.panelCode.classList.toggle('is-editor-collapsed', _layoutState.editorCollapsed === true && _layoutState.maximizedPanel !== 'editor');
    document.documentElement.classList.toggle('code-workbench-nav-collapsed', _layoutState.workbenchNavCollapsed === true);

    if (_layoutState.contextCollapsed && _dom.sidebar) {
      _dom.sidebar.classList.add('is-context-collapsed');
    } else if (_dom.sidebar) {
      _dom.sidebar.classList.remove('is-context-collapsed');
    }
    
    // Maximized chat handles hiding editor
    if ((_layoutState.maximizedPanel === 'chat' || _layoutState.editorCollapsed) && _dom.editorColumn) {
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

  function toggleEditor() {
    _layoutState.editorCollapsed = !_layoutState.editorCollapsed;
    if (_layoutState.editorCollapsed) _layoutState.chatCollapsed = false;
    _layoutState.maximizedPanel = null;
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleWorkbenchNav() {
    _layoutState.workbenchNavCollapsed = !_layoutState.workbenchNavCollapsed;
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleChat() {
    _layoutState.chatCollapsed = !_layoutState.chatCollapsed;
    if (_layoutState.chatCollapsed) _layoutState.editorCollapsed = false;
    _layoutState.maximizedPanel = null;
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleMaximizeEditor() {
    if (_layoutState.maximizedPanel === 'editor') {
      _layoutState.maximizedPanel = null;
    } else {
      _layoutState.maximizedPanel = 'editor';
      _layoutState.editorCollapsed = false;
      _layoutState.chatCollapsed = false;
    }
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function toggleMaximizeChat() {
    if (_layoutState.maximizedPanel === 'chat') {
      _layoutState.maximizedPanel = null;
    } else {
      _layoutState.maximizedPanel = 'chat';
      _layoutState.editorCollapsed = false;
      _layoutState.chatCollapsed = false;
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
      editorCollapsed: false,
      workbenchNavCollapsed: false,
      chatCollapsed: false,
      contextCollapsed: false,
      maximizedPanel: null
    };
    applyLayoutToDOM();
    triggerLayoutSave();
  }

  function codeWorkspaceIcon(name) {
    var paths = {
      folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
      file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
      reset: '<path d="M4 7V3m0 4h4"/><path d="M4.7 7A8 8 0 1 1 4 12"/><path d="M12 8v4l3 2"/>',
      collapseLeft: '<path d="m15 6-6 6 6 6"/>',
      collapseRight: '<path d="m9 6 6 6-6 6"/>',
      maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      refresh: '<path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 5v6h-6"/>'
    };
    return '<svg class="code-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.reset) + '</svg>';
  }

  // Recovery can re-enter Code with a stale layout, tab record, or browser
  // handle.  The old implementation cleared panelCode first, so any synchronous
  // exception below left a permanently blank, non-interactive Code page.
  // Keep the welcome screen as a guaranteed recovery surface.
  function renderWorkspace() {
    try {
      return renderWorkspaceImpl();
    } catch (error) {
      console.error('[code-workspace] workspace render failed; returning to welcome screen', error);
      state.openTabs = [];
      state.activePath = '';
      document.body.classList.remove('code-is-resizing', 'code-is-resizing-row');
      try {
        renderWelcome();
        showToast('恢复上次工作区失败，已回到可重新选择文件的页面。', 'error');
      } catch (fallbackError) {
        if (_dom.panelCode) {
          _dom.panelCode.innerHTML = '<div class="code-welcome"><h2>Code</h2><p>恢复工作区失败，请重新打开文件夹或刷新页面。</p></div>';
        }
      }
      return false;
    }
  }

  function renderWorkspaceImpl() {
    if (!_dom.panelCode) return;
    state.composerMounted = false;
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
        '<button class="folder-picker-btn new-file-btn" title="新建文件" aria-label="新建文件"></button>' +
        '<button class="folder-picker-btn refresh-tree-btn" title="刷新文件树" aria-label="刷新文件树"></button>' +
        '<button class="code-panel-action-btn fold-sidebar-btn" title="折叠侧边栏"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '</span>';
    
    var changeBtn = sidebarHeader.querySelector('.folder-picker-btn');
    if (changeBtn) { changeBtn.innerHTML = codeWorkspaceIcon('folder'); changeBtn.setAttribute('aria-label', '更换文件夹'); }
    if (changeBtn) changeBtn.addEventListener('click', selectAndOpenWorkspace);
    var directFileBtn = sidebarHeader.querySelector('.file-picker-btn');
    if (directFileBtn) { directFileBtn.innerHTML = codeWorkspaceIcon('file'); directFileBtn.setAttribute('aria-label', '直接打开文件'); }
    if (directFileBtn) directFileBtn.addEventListener('click', selectAndOpenFile);
    var newFileBtn = sidebarHeader.querySelector('.new-file-btn');
    if (newFileBtn) {
      newFileBtn.innerHTML = codeWorkspaceIcon('plus');
      newFileBtn.disabled = !!state._isReadOnly || state.workspaceMode === 'github' || (state.directoryHandle && state.directoryHandle._isSingleFileRoot);
      newFileBtn.addEventListener('click', createNewWorkspaceFile);
    }
    var refreshTreeBtn = sidebarHeader.querySelector('.refresh-tree-btn');
    if (refreshTreeBtn) {
      refreshTreeBtn.innerHTML = codeWorkspaceIcon('refresh');
      refreshTreeBtn.addEventListener('click', function () {
        refreshFileTree();
        showToast('文件树已刷新', 'success');
      });
    }
    var foldSidebarBtn = sidebarHeader.querySelector('.fold-sidebar-btn');
    if (foldSidebarBtn) {
      foldSidebarBtn.innerHTML = codeWorkspaceIcon('collapseLeft');
      foldSidebarBtn.setAttribute('aria-label', '折叠文件目录');
      foldSidebarBtn.title = '折叠文件目录';
      foldSidebarBtn.addEventListener('click', toggleSidebar);
    }

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
    resizerContext.setAttribute('aria-label', '调整项目状态区域高度');
    resizerContext.setAttribute('title', '拖动调整项目状态区域高度，双击恢复默认');
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
    resizerLeft.setAttribute('aria-label', '调整文件树宽度');
    resizerLeft.setAttribute('title', '拖动调整文件树宽度，双击恢复默认');
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
      '<button class="code-panel-action-btn restore-layout-btn" title="恢复默认布局" style="margin-right:4px;"></button>' +
      '<button class="code-panel-action-btn max-editor-btn" title="最大化编辑器"></button>';
    tabBar.appendChild(tabBarActions);
    tabBarActions.querySelector('.restore-layout-btn').addEventListener('click', resetLayout);
    tabBarActions.querySelector('.restore-layout-btn').innerHTML = codeWorkspaceIcon('reset');
    tabBarActions.querySelector('.restore-layout-btn').setAttribute('aria-label', '恢复默认布局');
    var foldEditorBtn = document.createElement('button');
    foldEditorBtn.type = 'button';
    foldEditorBtn.className = 'code-panel-action-btn fold-editor-btn';
    foldEditorBtn.title = '折叠文件查看区';
    foldEditorBtn.setAttribute('aria-label', '折叠文件查看区');
    foldEditorBtn.innerHTML = codeWorkspaceIcon('collapseLeft');
    foldEditorBtn.addEventListener('click', toggleEditor);
    tabBarActions.insertBefore(foldEditorBtn, tabBarActions.querySelector('.max-editor-btn'));
    var maxEditorBtn = tabBarActions.querySelector('.max-editor-btn');
    maxEditorBtn.innerHTML = codeWorkspaceIcon('maximize');
    maxEditorBtn.setAttribute('aria-label', '最大化编辑器');
    maxEditorBtn.addEventListener('click', toggleMaximizeEditor);
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
    resizerRight.setAttribute('aria-label', '调整编辑器与 AI 面板宽度');
    resizerRight.setAttribute('title', '拖动调整编辑器与 AI 面板宽度，双击恢复默认');
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
        '<button class="code-panel-action-btn max-chat-btn" title="最大化"></button>' +
        '<button class="code-panel-action-btn fold-chat-btn" title="折叠"></button>' +
      '</div>';
    var chatActions = chatHeader.querySelector('.code-panel-actions');
    var maxChatBtn = chatHeader.querySelector('.max-chat-btn');
    maxChatBtn.innerHTML = codeWorkspaceIcon('maximize');
    maxChatBtn.setAttribute('aria-label', '最大化 AI 面板');
    var foldChatBtn = chatHeader.querySelector('.fold-chat-btn');
    foldChatBtn.innerHTML = codeWorkspaceIcon('collapseRight');
    foldChatBtn.setAttribute('aria-label', '折叠 AI 面板');
    function addChatPanelToggle(className, label, handler) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-panel-action-btn ' + className;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = codeWorkspaceIcon(className === 'fold-workbench-nav-btn' ? 'collapseLeft' : (className === 'fold-editor-from-chat-btn' ? 'collapseLeft' : 'collapseRight'));
      button.addEventListener('click', handler);
      chatActions.insertBefore(button, chatActions.firstChild);
    }
    addChatPanelToggle('fold-workbench-nav-btn', '折叠左侧导航栏', toggleWorkbenchNav);
    addChatPanelToggle('fold-editor-from-chat-btn', '折叠文件查看区', toggleEditor);
    addChatPanelToggle('fold-directory-from-chat-btn', '折叠文件目录', toggleSidebar);
    maxChatBtn.addEventListener('click', toggleMaximizeChat);
    foldChatBtn.addEventListener('click', toggleChat);
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
    restoreComposerPreferences();
    renderChatPanel();
    
    initResizerDragLogic();
    applyLayoutToDOM();

    loadProjectIndexStatus();
    loadCodeModels();
    restorePersistedTabs();
    var tabRestore = restoreTabs();
    tabRestore.catch(function (error) {
      // The shell has already been mounted. Keep it interactive even if an
      // individual restored file or browser handle is malformed.
      console.warn('[code-workspace] restoring saved tabs failed', error);
      renderTabs();
      renderEmptyState();
      showToast('部分上次文件未能恢复，请重新打开需要的文件。', 'warning');
    });
  }

  // Pointer Events Drag Logic
  var _dragState = null;

  function initResizerDragLogic() {
    if (!_dom.resizerLeft || !_dom.resizerRight || !_dom.resizerContext) return;
    if (state._resizerCleanup) state._resizerCleanup();
    
    function onPointerDown(e, type) {
      if (e.button !== 0) return; // only left click
      e.preventDefault();
      var target = e.currentTarget;
      try {
        if (target.setPointerCapture && e.pointerId !== undefined) target.setPointerCapture(e.pointerId);
      } catch (_) { /* pointer capture can be lost between events */ }
      
      var layoutRoot = _dom.sidebar && _dom.sidebar.parentElement;
      var wsWidth = (layoutRoot && layoutRoot.clientWidth) || _dom.panelCode.offsetWidth || window.innerWidth;
      var sbHeight = _dom.sidebar.offsetHeight || window.innerHeight;
      
      _dragState = {
        type: type,
        target: target,
        pointerId: e.pointerId,
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
      
      // Listen on the document as well as using pointer capture. This keeps a
      // drag alive when the pointer leaves the narrow divider or crosses a
      // child iframe/editor surface.
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (!_dragState) return;
      if (_dragState.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== _dragState.pointerId) return;
      e.preventDefault();
      var dx = e.clientX - _dragState.startX;
      var dy = e.clientY - _dragState.startY;
      
      if (_dragState.type === 'left') {
        var newWidth = _dragState.startSidebarWidth + dx;
        var compact = _dragState.wsWidth < 900;
        var minSidebar = compact ? 188 : 220;
        // Clamp to the same bounds used by applyLayoutToDOM.
        var maxW = Math.min(560, _dragState.wsWidth * 0.45);
        newWidth = Math.max(minSidebar, Math.min(newWidth, maxW));
        _layoutState.sidebarWidth = newWidth;
      } else if (_dragState.type === 'right') {
        // Dragging right resizer leftwards INCREASES chat width
        var newWidth = _dragState.startChatWidth - dx;
        var compactChat = _dragState.wsWidth < 900;
        var minChat = compactChat ? 240 : 280;
        // Clamp to the same bounds used by applyLayoutToDOM.
        var maxW = Math.min(760, _dragState.wsWidth * 0.55);
        newWidth = Math.max(minChat, Math.min(newWidth, maxW));
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
      if (_dragState.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== _dragState.pointerId) return;
      var target = _dragState.target;
      try {
        if (target.releasePointerCapture && e.pointerId !== undefined &&
            (!target.hasPointerCapture || target.hasPointerCapture(e.pointerId))) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch (_) { /* capture may already have been released */ }
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      
      target.classList.remove('is-resizing');
      document.body.classList.remove('code-is-resizing');
      document.body.classList.remove('code-is-resizing-row');
      
      triggerLayoutSave();
      _dragState = null;
    }

    var onLeftDown = function(e) { onPointerDown(e, 'left'); };
    var onRightDown = function(e) { onPointerDown(e, 'right'); };
    var onContextDown = function(e) { onPointerDown(e, 'context'); };

    function onKeyDown(e, type) {
      var key = e.key;
      var step = e.shiftKey ? 32 : 8;
      var delta = 0;
      if (type === 'context') {
        if (key === 'ArrowUp') delta = step;
        else if (key === 'ArrowDown') delta = -step;
      } else if (type === 'left') {
        if (key === 'ArrowLeft') delta = -step;
        else if (key === 'ArrowRight') delta = step;
      } else {
        if (key === 'ArrowLeft') delta = step;
        else if (key === 'ArrowRight') delta = -step;
      }
      if (!delta) return;
      e.preventDefault();
      if (type === 'left') _layoutState.sidebarWidth += delta;
      else if (type === 'right') _layoutState.chatWidth += delta;
      else _layoutState.contextHeight += delta;
      applyLayoutToDOM();
      triggerLayoutSave();
    }
    var onLeftKeyDown = function(e) { onKeyDown(e, 'left'); };
    var onRightKeyDown = function(e) { onKeyDown(e, 'right'); };
    var onContextKeyDown = function(e) { onKeyDown(e, 'context'); };
    _dom.resizerLeft.addEventListener('pointerdown', onLeftDown);
    _dom.resizerRight.addEventListener('pointerdown', onRightDown);
    _dom.resizerContext.addEventListener('pointerdown', onContextDown);
    _dom.resizerLeft.addEventListener('keydown', onLeftKeyDown);
    _dom.resizerRight.addEventListener('keydown', onRightKeyDown);
    _dom.resizerContext.addEventListener('keydown', onContextKeyDown);

    // Safety net: if the pointer-up is lost (window blur, alt-tab, dialog
    // closing) the whole page would stay frozen by body.code-is-resizing.
    // Never leave that state behind.
    var onBlurEndDrag = function () { if (_dragState) onPointerUp({}); };
    var onVisibilityEndDrag = function () {
      if (document.visibilityState === 'hidden' && _dragState) onPointerUp({});
    };
    window.addEventListener('blur', onBlurEndDrag);
    document.addEventListener('visibilitychange', onVisibilityEndDrag);
    
    // Listen for resize to re-clamp
    var onWindowResize = function() {
      if (_dom.panelCode && _dom.panelCode.offsetParent !== null) {
        applyLayoutToDOM();
      }
    };
    window.addEventListener('resize', onWindowResize);
    state._resizerCleanup = function () {
      _dom.resizerLeft && _dom.resizerLeft.removeEventListener('pointerdown', onLeftDown);
      _dom.resizerRight && _dom.resizerRight.removeEventListener('pointerdown', onRightDown);
      _dom.resizerContext && _dom.resizerContext.removeEventListener('pointerdown', onContextDown);
      _dom.resizerLeft && _dom.resizerLeft.removeEventListener('keydown', onLeftKeyDown);
      _dom.resizerRight && _dom.resizerRight.removeEventListener('keydown', onRightKeyDown);
      _dom.resizerContext && _dom.resizerContext.removeEventListener('keydown', onContextKeyDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('blur', onBlurEndDrag);
      document.removeEventListener('visibilitychange', onVisibilityEndDrag);
      if (_dragState) {
        var dragTarget = _dragState.target;
        try {
          if (dragTarget && dragTarget.releasePointerCapture && _dragState.pointerId !== undefined &&
              (!dragTarget.hasPointerCapture || dragTarget.hasPointerCapture(_dragState.pointerId))) {
            dragTarget.releasePointerCapture(_dragState.pointerId);
          }
        } catch (_) {}
        dragTarget && dragTarget.classList.remove('is-resizing');
        document.body.classList.remove('code-is-resizing', 'code-is-resizing-row');
        _dragState = null;
      }
      state._resizerCleanup = null;
    };
  }

  function renderPhoneOnlyNotice() {
    if (!_dom.panelCode) return;
    _dom.panelCode.replaceChildren();
    var notice = document.createElement('section');
    notice.className = 'code-phone-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.innerHTML = '<div class="code-phone-notice-icon" aria-hidden="true">💻</div>' +
      '<h2>请在桌面或平板使用 Code</h2>' +
      '<p>Code 工作区需要更宽的编辑空间。请使用屏幕宽度至少 768px 的设备继续。</p>';
    _dom.panelCode.appendChild(notice);
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
              // Persisted tabs start as lightweight placeholders.  Refresh all
              // type metadata before rendering so DOCX/PDF/image tabs do not
              // come back as blank text editors after a page reload.
              tab.type = result.type || tab.type || 'text';
              tab.mimeType = result.mimeType || tab.mimeType || '';
              tab.size = result.size || tab.size || 0;
              tab.name = result.name || tab.name;
              if (result.type === 'document') {
                tab.content = result.content;
                tab._arrayBuffer = result._arrayBuffer || result.content;
                tab._extractPromise = null;
                tab._extractError = null;
                tab._parseReady = false;
                tab._docState = null;
                tab._extractGeneration = null;
              } else if (result.type === 'binary') {
                tab.content = result.content || null;
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
                  tab._contentVersion = 0;
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
      persistOpenTabs();
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
      kind: state.directoryHandle && state.directoryHandle._isSingleFileRoot ? 'file' : 'directory',
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
      '<div class="menu-item" data-action="rename" role="button" tabindex="0">' +
        '<span>✎</span><span>\u91cd\u547d\u540d\u6587\u4ef6</span>' +
      '</div>' +
      '<div class="menu-item danger" data-action="delete" role="button" tabindex="0">' +
        '<span>⌫</span><span>\u5220\u9664\u6587\u4ef6</span>' +
      '</div>' +
      '<div class="menu-separator"></div>' +
      '<div class="menu-item" data-action="open" role="button" tabindex="0">' +
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

    menu.querySelector('[data-action="rename"]').addEventListener('click', function () {
      renameWorkspaceFile(path);
      closeMenu();
    });

    menu.querySelector('[data-action="delete"]').addEventListener('click', function () {
      deleteWorkspaceFile(path);
      closeMenu();
    });

    menu.querySelector('[data-action="open"]').addEventListener('click', function () {
      openFile(path);
      closeMenu();
    });

    Array.prototype.forEach.call(menu.querySelectorAll('[role="button"]'), function (item) {
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          item.click();
        }
      });
    });

    // Close on click outside
    setTimeout(function () {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  function createNewWorkspaceFile() {
    if (state._isReadOnly || state.workspaceMode === 'github' || (state.directoryHandle && state.directoryHandle._isSingleFileRoot)) {
      showToast('\u5f53\u524d\u5de5\u4f5c\u533a\u4e0d\u53ef\u5199\u6216\u4ec5\u5305\u542b\u5355\u4e2a\u6587\u4ef6\uff0c\u8bf7\u6253\u5f00\u672c\u5730\u6587\u4ef6\u5939\u540e\u518d\u8bd5', 'warning');
      return;
    }
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.createFileByPath) {
      showToast('\u6587\u4ef6\u521b\u5efa\u80fd\u529b\u4e0d\u53ef\u7528\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5', 'error');
      return;
    }
    var requestedPath = window.prompt('\u8f93\u5165\u65b0\u6587\u4ef6\u8def\u5f84\uff08\u4f8b\u5982 src/index.js\uff09', state.activePath ? state.activePath.replace(/[^/]+$/, '') : '');
    if (requestedPath === null) return;
    requestedPath = String(requestedPath).trim().replace(/\\/g, '/');
    if (!requestedPath) return;
    try { validatePath(requestedPath); } catch (err) {
      showToast('\u6587\u4ef6\u8def\u5f84\u65e0\u6548\uff1a' + (err.message || '\u8bf7\u68c0\u67e5\u8def\u5f84'), 'error');
      return;
    }
    fs.createFileByPath(requestedPath, '').then(function () {
      refreshFileTree();
      return openFile(requestedPath);
    }).then(function () {
      showToast('\u6587\u4ef6\u5df2\u521b\u5efa', 'success');
    }).catch(function (err) {
      showToast('\u521b\u5efa\u6587\u4ef6\u5931\u8d25\uff1a' + (err.message || String(err)), 'error');
    });
  }

  function renameWorkspaceFile(path) {
    if (state._isReadOnly || state.workspaceMode === 'github') {
      showToast('\u5f53\u524d\u5de5\u4f5c\u533a\u4e0d\u53ef\u5199\uff0c\u8bf7\u6253\u5f00\u672c\u5730\u6587\u4ef6\u5939\u540e\u518d\u8bd5', 'warning');
      return;
    }
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.renameFileByPath) {
      showToast('\u6587\u4ef6\u91cd\u547d\u540d\u80fd\u529b\u4e0d\u53ef\u7528\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5', 'error');
      return;
    }
    var nextPath = window.prompt('\u8f93\u5165\u65b0\u7684\u6587\u4ef6\u8def\u5f84', path);
    if (nextPath === null) return;
    nextPath = String(nextPath).trim().replace(/\\/g, '/');
    if (!nextPath || nextPath === path) return;
    try { validatePath(nextPath); } catch (err) {
      showToast('\u6587\u4ef6\u8def\u5f84\u65e0\u6548\uff1a' + (err.message || '\u8bf7\u68c0\u67e5\u8def\u5f84'), 'error');
      return;
    }
    fs.renameFileByPath(path, nextPath).then(function () {
      var tab = state.openTabs.filter(function (item) { return item.path === path; })[0];
      if (tab) {
        tab.path = nextPath;
        tab.name = fileNameFromPath(nextPath);
      }
      state.pinnedFiles = state.pinnedFiles.map(function (item) { return item === path ? nextPath : item; });
      if (state.activePath === path) state.activePath = nextPath;
      persistOpenTabs();
      refreshFileTree();
      renderTabs();
      renderEditor();
      renderProjectStatus();
      showToast('\u6587\u4ef6\u5df2\u91cd\u547d\u540d', 'success');
    }).catch(function (err) {
      showToast('\u91cd\u547d\u540d\u6587\u4ef6\u5931\u8d25\uff1a' + (err.message || String(err)), 'error');
    });
  }

  function deleteWorkspaceFile(path) {
    if (state._isReadOnly || state.workspaceMode === 'github') {
      showToast('\u5f53\u524d\u5de5\u4f5c\u533a\u4e0d\u53ef\u5199\uff0c\u8bf7\u6253\u5f00\u672c\u5730\u6587\u4ef6\u5939\u540e\u518d\u8bd5', 'warning');
      return;
    }
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.deleteFileByPath) {
      showToast('\u6587\u4ef6\u5220\u9664\u80fd\u529b\u4e0d\u53ef\u7528\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5', 'error');
      return;
    }
    if (!window.confirm('\u786e\u5b9a\u5220\u9664\u6587\u4ef6\u201c' + path + '\u201d\u5417\uff1f\u6b64\u64cd\u4f5c\u65e0\u6cd5\u64a4\u9500\u3002')) return;
    fs.deleteFileByPath(path).then(function () {
      var tabIndex = state.openTabs.findIndex(function (item) { return item.path === path; });
      if (tabIndex >= 0) {
        var tab = state.openTabs[tabIndex];
        if (tab.blobUrl) revokeUrl(tab.blobUrl);
        state.openTabs.splice(tabIndex, 1);
        if (state.activePath === path) {
          state.activePath = (state.openTabs[Math.max(0, tabIndex - 1)] || state.openTabs[0] || {}).path || '';
        }
      }
      state.pinnedFiles = state.pinnedFiles.filter(function (item) { return item !== path; });
      persistOpenTabs();
      refreshFileTree();
      renderTabs();
      renderEditor();
      renderProjectStatus();
      showToast('\u6587\u4ef6\u5df2\u5220\u9664', 'success');
    }).catch(function (err) {
      showToast('\u5220\u9664\u6587\u4ef6\u5931\u8d25\uff1a' + (err.message || String(err)), 'error');
    });
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
        content: result.type === 'text' ? (result.content == null ? '' : result.content) : null,
        sha256: result.sha256 || '',
        type: result.type || 'text',
        mimeType: result.mimeType || '',
        blobUrl: (result.type === 'image' || result.type === 'pdf') ? result.content : null,
        size: result.size || 0,
        _contentVersion: 0
      };

      // Track blob URL
      if (tab.blobUrl) {
        trackUrl(tab.blobUrl);
      }

      
      state.openTabs.push(tab);
      state.activePath = path;
      persistOpenTabs();

      // Cache file handle
      if (result.handle) {
        state.fileHandles[path] = result.handle;
      }

      renderTabs();
      renderEditor();

      // Text files are cheap to keep in the active context. Documents must be
      // explicitly selected/attached; auto-pinning every opened document made
      // an unrelated failed extraction block the next AI request.
      if (tab.type === 'text' && state.pinnedFiles.indexOf(path) === -1) {
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

    // Closing a document invalidates and aborts its extraction before a new
    // tab for the same path can be opened.
    if (tab._extractAbortController) {
      try { tab._extractAbortController.abort(); } catch (_) {}
      tab._extractAbortController = null;
    }
    tab._extractId = null;
    tab._docState = 'cancelled';
    if (state._documentStates && state._documentStates[path]) {
      state._documentStates[path] = {
        state: 'cancelled',
        generation: state.workspaceGeneration,
        extractionId: null,
        error: null
      };
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
    persistOpenTabs();
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

        var failedBadge = tab._extractError
          ? '<span class="tab-failed" title="文档提取失败" aria-label="文档提取失败">!</span>'
          : '';
        el.innerHTML =
          contextDot +
          failedBadge +
          '<span class="tab-name">' + escapeHTML(tab.name) + '</span>' +
          '<span class="tab-close" title="关闭">✕</span>';

        // Click tab to switch
        el.addEventListener('click', function (e) {
          if (e.target.classList.contains('tab-close')) return;
          state.activePath = tab.path;
          persistOpenTabs();
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

    var renderId = ++state._editorRenderId;
    disposeMonaco();

    var container = document.createElement('div');
    container.className = 'code-editor-container';
    container.id = 'codeEditorContainer';
    container.style.flex = '1';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    _dom.editorArea.appendChild(container);

    // Safety: render textarea immediately if editorArea is small or hidden
    // (layout race). Monaco loads asynchronously and will replace it.
    var immediateFallback = function () {
      try {
        if (container.parentNode === _dom.editorArea && container.children.length === 0) {
          renderTextareaEditor(tab, container);
        }
      } catch (_) {}
    };

    // If the editor area has no visible height, fall back immediately
    requestAnimationFrame(function () {
      try {
        if (container.offsetParent !== null && container.clientHeight < 20) {
          console.warn('[CODE] editor container has near-zero height, forcing textarea fallback');
          immediateFallback();
        }
      } catch (_) {}
    });

    // Try Monaco
    loadMonaco(function (err) {
      // The tab may have changed while the lazy loader was in flight.  Never
      // mount a late editor into the current tab's container.
      if (renderId !== state._editorRenderId || container.parentNode !== _dom.editorArea || state.activePath !== tab.path) {
        return;
      }
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

        if (renderId !== state._editorRenderId || container.parentNode !== _dom.editorArea || state.activePath !== tab.path) {
          try { editor.dispose(); } catch (_) {}
          try { model.dispose(); } catch (_) {}
          return;
        }

        state._monacoEditor = editor;

        // Watchdog: if the visible container ends up with zero height (layout
        // race, hidden parent), Monaco renders blank and swallows clicks.
        // Detect it on the next frame and fall back to the textarea editor.
        requestAnimationFrame(function () {
          if (renderId !== state._editorRenderId || state._monacoEditor !== editor) return;
          if (container.offsetParent === null) return; // panel hidden, not an error
          var layoutHeight = 0;
          try { layoutHeight = editor.getLayoutInfo().height; } catch (_) {}
          if (!layoutHeight && container.clientHeight === 0) {
            try { editor.dispose(); } catch (_) {}
            try { model.dispose(); } catch (_) {}
            state._monacoEditor = null;
            if (container.parentNode === _dom.editorArea) {
              renderTextareaEditor(tab, container);
            }
          }
        });

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
            tab._contentVersion = (tab._contentVersion || 0) + 1;
            renderTabs();
          }
        });

        // Ctrl+S to save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
          saveFile(tab.path);
        });
      } catch (e) {
        if (renderId !== state._editorRenderId || container.parentNode !== _dom.editorArea || state.activePath !== tab.path) return;
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
        tab._contentVersion = (tab._contentVersion || 0) + 1;
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
        tab._contentVersion = 0;
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

    var extractionId = tab._extractId;
    if (!tab._extractPromise) {
      extractionId = 'doc_extract_' + (++_documentExtractionSerial);
      var extractionTimer = null;
      tab._extractId = extractionId;
      tab._parseReady = false;
      tab._docState = 'extracting';
      tab._extractGeneration = state.workspaceGeneration;
      tab._extractAbortController = new AbortController();
    state._documentStates[tab.path] = { state: 'extracting', generation: state.workspaceGeneration, extractionId: extractionId, error: null };
      extractionTimer = setTimeout(function () {
        if (tab._extractId !== extractionId || tab._docState !== 'extracting') return;
        try { tab._extractAbortController.abort(); } catch (_) {}
        tab._docState = 'timed_out';
        tab._parseReady = false;
        tab._extractError = '文档提取超时';
        state._documentStates[tab.path] = { state: 'timed_out', generation: tab._extractGeneration, extractionId: extractionId, error: tab._extractError };
        renderProjectStatus();
        updateChatRequestControls();
      }, 30000);
      tab._extractPromise = fs.readFileByPath(tab.path, { signal: tab._extractAbortController.signal }).then(function (result) {
        if (!result || result.type !== 'document') {
          throw new Error('无法读取文档文件');
        }
        return fs.readDocumentText(result._arrayBuffer, result.name, result.mimeType, { signal: tab._extractAbortController.signal });
      }).then(function (docData) {
        if (!docData) return;
        if (extractionTimer) { clearTimeout(extractionTimer); extractionTimer = null; }
        if (tab._extractId !== extractionId || tab._docState === 'timed_out' || tab._docState === 'cancelled') return;
        // 延迟提取守卫：检查 generation 是否已变化
        var currentDocumentState = state._documentStates[tab.path];
        if (state.workspaceGeneration !== tab._extractGeneration || !currentDocumentState || currentDocumentState.extractionId !== extractionId) {
          // The generation/task is stale; discard the late result completely.
          // Do not write a cancelled state into a newly opened tab at the
          // same path.
          return;
        }
        tab._extractedText = docData.text;
        tab._extractedTruncated = docData.truncated;
        tab._extractedMetadata = docData.metadata;
        tab._parseReady = true;
        tab._extractError = null;
        tab._docState = 'ready';
        state._documentStates[tab.path] = { state: 'ready', generation: state.workspaceGeneration, extractionId: extractionId, error: null };
        docData.ext = tab.name.match(/\.[^.]+$/) ? tab.name.match(/\.[^.]+$/)[0] : '';
        return docData;
      }).catch(function (err) {
        if (extractionTimer) { clearTimeout(extractionTimer); extractionTimer = null; }
        if (tab._extractId !== extractionId || tab._docState === 'timed_out' || tab._docState === 'cancelled') {
          return null;
        }
        tab._extractError = err && err.message ? err.message : '文档提取失败';
        tab._parseReady = false;
        tab._docState = 'failed';
        state._documentStates[tab.path] = { state: 'failed', generation: tab._extractGeneration, error: tab._extractError };
        throw err;
      });
    }

    tab._extractPromise.then(function (docData) {
      if (!docData || tab._extractId !== extractionId || tab._docState !== 'ready') {
        renderProjectStatus();
        updateChatRequestControls();
        return;
      }
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
  function uploadFilesInBatches(files, scanResult, ctx, controller, workspaceId, wsGen, indexOptions) {
    indexOptions = indexOptions || {};
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
    // The server merges an incremental request atomically, so do not split a
    // delta into partial snapshots.  Oversized deltas deliberately fall back
    // to the existing full/batched rebuild path at the caller.
    if (indexOptions.incremental === true && useBatches) {
      var tooLarge = new Error('INCREMENTAL_BATCH_TOO_LARGE');
      tooLarge.code = 'INCREMENTAL_BATCH_TOO_LARGE';
      return Promise.reject(tooLarge);
    }

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
          truncated: scanResult.truncated === true,
          incremental: indexOptions.incremental === true,
          manifest_paths: indexOptions.manifestPaths || undefined,
          deleted_paths: indexOptions.deletedPaths || undefined
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

  function buildProjectIndex(options) {
    options = options || {};
    var force = options.force === true;
    var fs = window.__xtjCodeFS;
    if (!fs || (!fs.listAllFilesWithMetadata && !fs.listAllFiles)) {
      var noFsCtx = createBuildContext(getWorkspaceId(), state.workspaceGeneration, new AbortController());
      noFsCtx.status = 'failed';
      noFsCtx.errorCode = 'FS_NOT_AVAILABLE';
      noFsCtx.errorMessage = '文件系统不支持项目索引';
      syncBuildContextToUI(noFsCtx);
      return Promise.resolve(state.projectIndexStatus);
    }

    // Calls from status checks and automatic retries share the in-flight build.
    // Only an explicit refresh is allowed to cancel and replace it.
    if (state._indexBuildPromise && !force) {
      return state._indexBuildPromise;
    }
    if (force) {
      abortController(state._indexController);
    }
    if (state._indexBuildPromise && force) {
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

                return uploadFilesInBatches(files, result, ctx, controller, workspaceId, wsGen, {
                  incremental: true,
                  manifestPaths: manifestFiles.map(function (f) { return f.path; }),
                  deletedPaths: deletePaths
                }).catch(function (incrementalErr) {
                  if (!incrementalErr || incrementalErr.code !== 'INCREMENTAL_BATCH_TOO_LARGE') throw incrementalErr;
                  // Preserve correctness over bandwidth: a delta too large for
                  // one atomic request is rebuilt as the legacy full snapshot.
                  return uploadFilesInBatches(manifestFiles.map(function(meta) {
                    for (var fi = 0; fi < sourceFiles.length; fi++) if (sourceFiles[fi].path === meta.path) return sourceFiles[fi];
                    return null;
                  }).filter(function(f) { return f && f.type === 'text'; }).map(function(f) {
                    return { path: f.path, name: f.name || f.path.split('/').pop(), language: f.language || getFileLanguage(f.name || f.path), size: f.size || 0, sha256: f.sha256 || '', modifiedAt: f.modifiedAt || null, content: f.content || '' };
                  }), result, ctx, controller, workspaceId, wsGen);
                });
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
        buildProjectIndex({ force: true });
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
        buildProjectIndex({ force: true });
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

  function composerPreferenceKey() {
    // Preferences are user-scoped as well as workspace-scoped, so changing
    // accounts in the same browser cannot inherit another user's model mode.
    return 'xtj_code_composer:' + encodeURIComponent(readComposerUserScope()) + ':' + encodeURIComponent(getWorkspaceId());
  }

  function restoreComposerPreferences() {
    try {
      var raw = localStorage.getItem(composerPreferenceKey());
      var saved = raw ? JSON.parse(raw) : null;
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.modelId === 'string') state.selectedModelId = saved.modelId;
      if (/^(auto|off|low|medium|high|max)$/.test(saved.thinkingMode || '')) state.thinkingMode = saved.thinkingMode;
    } catch (e) { /* local preferences are optional */ }
  }

  function saveComposerPreferences() {
    try {
      localStorage.setItem(composerPreferenceKey(), JSON.stringify({
        modelId: state.selectedModelId || '',
        thinkingMode: state.thinkingMode || 'auto'
      }));
    } catch (e) { /* storage may be unavailable */ }
  }

  function loadCodeModels() {
    if (state.models.length) return Promise.resolve(state.models);
    if (state._modelsPromise) return state._modelsPromise;
    state._modelsPromise = apiFetch('/api/code/models', { method: 'GET' })
      .then(function(response) { return responseJson(response, '模型列表加载失败'); })
      .then(function(data) {
        var models = Array.isArray(data.models) ? data.models.filter(function(model) {
          return model && model.enabled === true && typeof model.id === 'string' && model.id;
        }) : [];
        state.models = models;
        state.modelLoadError = '';
        // P3: 本地模型 ID 也视为可用，不重置选择
        var isLocalSelected = state.selectedModelId === localCodeModelId();
        var selectedAvailable = models.some(function(model) { return model.id === state.selectedModelId; });
        if (!selectedAvailable && !isLocalSelected) state.selectedModelId = String(data.default_model || (models[0] && models[0].id) || '');
        normalizeThinkingModeForSelectedModel();
        state._modelsPromise = null;
        updateComposerControls();
        updateCapabilitiesBadge();
        return models;
      }).catch(function(error) {
        state._modelsPromise = null;
        state.models = [];
        state.modelLoadError = '模型列表加载失败，可重试';
        updateComposerControls();
        updateCapabilitiesBadge();
        return [];
      });
    return state._modelsPromise;
  }

  function selectedCodeModel() {
    var model = state.models.filter(function(model) { return model.id === state.selectedModelId; })[0] || null;
    if (!model && state.selectedModelId === localCodeModelId()) model = localCodeModelDescriptor();
    return model;
  }

  function localCodeModelId() {
    return window.__xtjLocalAI ? window.__xtjLocalAI.LOCAL_MODEL_ID : 'local-qwen2.5-0.5b';
  }

  function localCodeModelDescriptor() {
    if (window.__xtjLocalAI) return window.__xtjLocalAI.getModelDescriptor();
    return {
      id: localCodeModelId(),
      name: '本地离线 · Qwen 2.5 0.5B（需下载）',
      description: '首次使用需下载约 1 GB；下载后可在本机离线运行。',
      local: true,
      supported_thinking_modes: ['off'],
      supports_thinking: false,
      supports_tools: false
    };
  }

  function ensureCodeLocalAiRuntime(options) {
    options = options || {};
    if (window.__xtjLocalAI) {
      if (options.signal && options.signal.aborted) {
        var cancelled = new Error('Local Qwen runtime loading was cancelled');
        cancelled.name = 'AbortError';
        cancelled.code = 'LOCAL_AI_CANCELLED';
        return Promise.reject(cancelled);
      }
      return Promise.resolve(window.__xtjLocalAI);
    }
    if (typeof window.__xtjEnsureLocalAI === 'function') return window.__xtjEnsureLocalAI(options);
    return Promise.reject(new Error('本地 Qwen 运行时加载器不可用。'));
  }

  function normalizeThinkingModeForSelectedModel() {
    var model = selectedCodeModel();
    var modes = model && Array.isArray(model.supported_thinking_modes) ? model.supported_thinking_modes : [];
    if (!modes.length || modes.indexOf(state.thinkingMode) >= 0) return false;
    state.thinkingMode = modes.indexOf('auto') >= 0 ? 'auto' : modes[0];
    saveComposerPreferences();
    return true;
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
    var selected = selectedCodeModel();
    element.textContent = selected ? ((selected.provider || 'AI') + ' · ' + (selected.name || selected.id) + ' · Agent') : badge.text;
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

  function attachmentTypeIcon(attachment) {
    var name = String((attachment && attachment.name) || '').toLowerCase();
    if (/\.pdf$/.test(name)) return 'PDF';
    if (/\.(docx|doc)$/.test(name)) return 'DOC';
    if (/\.(xlsx|xls|csv)$/.test(name)) return 'XLS';
    if (/\.pptx$/.test(name)) return 'PPT';
    if (/\.(json|md|markdown|txt)$/.test(name)) return 'TXT';
    return 'FILE';
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

    // 附件提取超时处理（60s）
    var attachmentTimeout = setTimeout(function() {
      if (state._attachmentController === controller) {
        try { controller.abort(); } catch (_) {}
      }
    }, 60000);

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
          status: 'ready',
          metadata: data.metadata || {}
        });
        if (attachmentGeneration !== state.workspaceGeneration) {
          releaseAttachment(state.attachments[state.attachments.length - 1]);
          state.attachments.pop();
          throw createNamedAbortError();
        }
        clearTimeout(attachmentTimeout);
        state.attachmentProcessing = false;
        if (state._attachmentController === controller) state._attachmentController = null;
        renderChatPanel();
        return state.attachments[state.attachments.length - 1];
      });
    }).catch(function (error) {
      clearTimeout(attachmentTimeout);
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

  function addOpenTabAsAttachment(tab) {
    if (!tab || !tab.path || isRestrictedContextFile(tab.path)) return false;
    if (state.attachments.length >= MAX_ATTACHMENTS) {
      state.attachmentError = '本轮附件数量已达上限';
      return false;
    }
    var content = typeof tab._currentContent === 'string' ? tab._currentContent :
      (typeof tab._extractedText === 'string' ? tab._extractedText : String(tab.content || ''));
    if (!content.trim()) return false;
    if (currentAttachmentChars() + content.length > MAX_ATTACHMENT_TOTAL_CHARS) {
      state.attachmentError = '本轮附件内容已达上限';
      return false;
    }
    if (state.attachments.some(function (item) { return item.path === tab.path || (tab.sha256 && item.sha256 === tab.sha256); })) return false;
    var safeName = safeAttachmentName(tab.name || tab.path.split('/').pop() || 'file');
    var pathName = safeName;
    var count = 1;
    while (state.attachments.some(function (item) { return item.path === 'attachments/' + pathName; })) {
      count++;
      var parts = safeName.split('.');
      if (parts.length > 1) {
        var ext = parts.pop();
        pathName = parts.join('.') + '_' + count + '.' + ext;
      } else pathName = safeName + '_' + count;
    }
    state.attachments.push({
      name: tab.name || pathName,
      path: 'attachments/' + pathName,
      mimeType: tab.mimeType || attachmentMimeType(tab.name, ''),
      content: content.slice(0, MAX_ATTACHMENT_TOTAL_CHARS),
      sha256: tab.sha256 || '',
      source: 'open-file',
      pinned: false,
      truncated: content.length > MAX_ATTACHMENT_TOTAL_CHARS,
      status: 'ready'
    });
    return true;
  }

  function renderChatPanel() {
    if (!_dom.chatPanel) return;
    if (state.composerMounted) {
      syncChatMessages();
      renderComposerAttachments();
      updateComposerControls();
      updateChatRequestControls();
      return;
    }
    state.composerMounted = true;
    _dom.chatPanel.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'chat-header';
    var badge = capabilitiesLabel();
    header.innerHTML =
      '<span>AI 代码助手</span>' +
      '<span class="chat-model-badge" title="' + escapeHTML(badge.title) + '">' + escapeHTML(badge.text) + '</span>';
    _dom.chatPanel.appendChild(header);

    var notice = document.createElement('div');
    notice.className = 'code-chat-notice';
    notice.id = 'codeChatNotice';
    notice.hidden = true;
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    _dom.chatPanel.appendChild(notice);

    var messages = document.createElement('div');
    messages.className = 'code-chat-messages';
    messages.id = 'codeChatMessages';
    _dom.chatPanel.appendChild(messages);

    var backToBottom = document.createElement('button');
    backToBottom.type = 'button';
    backToBottom.className = 'code-chat-back-to-bottom';
    backToBottom.id = 'codeChatBackToBottom';
    backToBottom.textContent = '回到底部';
    backToBottom.hidden = true;
    backToBottom.addEventListener('click', function () { scrollChatToBottom(true); });
    _dom.chatPanel.appendChild(backToBottom);
    messages.addEventListener('scroll', function () {
      var remaining = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
      state.autoScrollPinned = remaining <= 48;
      updateChatScrollControl();
    }, { passive: true });

    // Render existing messages
    for (var i = 0; i < state.messages.length; i++) {
      appendChatMessage(state.messages[i], messages);
    }

    var inputArea = document.createElement('div');
    inputArea.className = 'code-chat-input-area';
    inputArea.innerHTML =
      '<div class="code-chat-attachments" id="codeChatAttachments"></div>' +
      '<button type="button" class="code-attachment-btn" id="codeAttachmentBtn" title="支持 DOCX、PDF、XLSX、PPTX、TXT、CSV、MD、JSON" aria-label="添加资料">添加资料</button>' +
      '<input type="file" id="codeAttachmentInput" accept="' + ATTACHMENT_ACCEPT + '" multiple hidden>' +
      '<textarea id="codeChatInput" aria-label="向 Code AI 发送消息" placeholder="输入消息，AI 将基于上下文文件回答..." rows="1"></textarea>' +
      '<button class="send-btn" id="codeChatSendBtn" type="button" title="发送" aria-label="发送消息">➤</button>';
    inputArea.innerHTML += '<button class="send-btn code-chat-cancel-btn" id="codeChatCancelBtn" type="button" title="&#21462;&#28040;&#35831;&#27714;">&#21462;&#28040;</button>';
    inputArea.innerHTML +=
      '<div class="code-composer-toolbar" aria-label="Code AI 控制栏">' +
        '<button type="button" class="code-composer-context-btn" id="codeComposerContextBtn" aria-label="添加上下文" aria-haspopup="menu" aria-expanded="false">＋</button>' +
        '<select id="codeModelSelect" class="code-composer-select" aria-label="选择模型" disabled><option>模型加载中…</option></select>' +
        '<button type="button" class="code-local-model-setup" id="codeLocalModelSetupBtn">下载本地 Qwen（约 1GB）</button>' +
        '<select id="codeThinkingSelect" class="code-composer-select" aria-label="选择思考程度">' +
          '<option value="auto">自动</option><option value="off">快速</option><option value="low">轻度</option><option value="medium">标准</option><option value="high">深入</option><option value="max">极深</option>' +
        '</select>' +
        '<button type="button" class="code-context-usage" id="codeContextUsage" aria-label="查看上下文占用" aria-expanded="false">上下文 未估算</button>' +
      '<span class="code-composer-runtime-status" id="codeComposerRuntimeStatus" role="status" aria-live="polite"></span>' +
      '</div>' +
      '<div class="code-local-model-status" id="codeLocalModelStatus" role="status" aria-live="polite" hidden>' +
        '<div class="code-local-model-status-line"><span id="codeLocalModelStatusText"></span><span id="codeLocalModelStatusValue"></span></div>' +
        '<progress id="codeLocalModelProgress" max="1" value="0" aria-label="本地 Qwen 下载进度"></progress>' +
      '</div>' +
      '<div class="code-context-details" id="codeContextDetails" role="status" aria-live="polite" hidden></div>' +
      '<div class="code-composer-menu" id="codeComposerContextMenu" role="menu" hidden>' +
        '<button type="button" role="menuitem" data-composer-action="ignore-documents">Ignore documents for this send</button>' +
        '<button type="button" role="menuitem" data-composer-action="upload">上传资料</button>' +
        '<button type="button" role="menuitem" data-composer-action="current">添加当前文件</button>' +
        '<button type="button" role="menuitem" data-composer-action="open">添加已打开文件</button>' +
        '<button type="button" role="menuitem" data-composer-action="pin">固定/取消固定当前文件</button>' +
        '<button type="button" role="menuitem" data-composer-action="pinned">查看固定文件</button>' +
        '<button type="button" role="menuitem" data-composer-action="clear">清除本轮附件</button>' +
      '</div>';
    var thinkingLabels = {
      auto: String.fromCharCode(0x81ea, 0x52a8),
      off: String.fromCharCode(0x5173),
      low: String.fromCharCode(0x4f4e),
      medium: String.fromCharCode(0x4e2d),
      high: String.fromCharCode(0x9ad8),
      max: String.fromCharCode(0x6781, 0x9ad8)
    };
    var thinkingSelectEl = inputArea.querySelector('#codeThinkingSelect');
    if (thinkingSelectEl) {
      Array.prototype.forEach.call(thinkingSelectEl.options, function (option) {
        if (thinkingLabels[option.value]) option.textContent = thinkingLabels[option.value];
      });
    }
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
        state.composerDraft = input.value;
        saveComposerDraft();
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        updateChatRequestControls();
      });

      input.addEventListener('compositionstart', function () { state.composerIsComposing = true; });
      input.addEventListener('compositionend', function () { state.composerIsComposing = false; });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !state.composerIsComposing) {
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
    bindComposerControls();
    restoreComposerDraft();
    updateChatRequestControls();

    // Scroll to bottom
    scrollChatToBottom();
    if (!state.capabilities && !state._capabilitiesPromise) loadCapabilities();
    loadCodeModels();
  }

  function readComposerUserScope() {
    var current = window.currentUser;
    if (typeof current === 'string' && current && current.indexOf('[object Object]') < 0) return current;
    if (current && typeof current === 'object') return current.user_name || current.name || current.id || '';
    var keys = ['xtj_user', 'xtj_username', 'xtj_user_name'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var stored = localStorage.getItem(keys[i]) || sessionStorage.getItem(keys[i]);
        if (stored) return stored;
      } catch (e) {}
    }
    return 'anonymous';
  }

  function composerDraftKey() {
    return 'xtj_code_draft:' + encodeURIComponent(readComposerUserScope()) + ':' + encodeURIComponent(getWorkspaceId()) + ':' + encodeURIComponent(state.conversationId || 'new');
  }

  function saveComposerDraft() {
    try { sessionStorage.setItem(composerDraftKey(), state.composerDraft || ''); } catch (e) {}
  }

  function restoreComposerDraft() {
    var input = document.getElementById('codeChatInput');
    if (!input || input.value) return;
    try { state.composerDraft = sessionStorage.getItem(composerDraftKey()) || ''; } catch (e) { state.composerDraft = ''; }
    if (!state.composerDraft) return;
    input.value = state.composerDraft;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  function clearComposerDraft() {
    state.composerDraft = '';
    try { sessionStorage.removeItem(composerDraftKey()); } catch (e) {}
  }

  function syncChatMessages() {
    var messages = document.getElementById('codeChatMessages');
    if (!messages) return;
    for (var i = 0; i < state.messages.length; i++) {
      if (!messages.querySelector('[data-code-message-index="' + i + '"]')) {
        appendChatMessage(state.messages[i], messages);
      }
    }
    // Once a request is terminal, only canonical state messages may remain.
    // This removes any late transient/typing card that raced the terminal UI.
    if (!state.sending) {
      Array.prototype.forEach.call(messages.querySelectorAll('.code-chat-message.assistant:not([data-code-message-index])'), function(node) {
        discardStreamingMessageNode(node);
      });
    }
  }

  // A stream paints into a transient node before its final message is written
  // to state.  Mark that node as the canonical message once the stream
  // succeeds, otherwise syncChatMessages would append the same reply again.
  function retainStreamingMessageNode(node, message) {
    if (!node || !message) return;
    var messageIndex = state.messages.indexOf(message);
    if (messageIndex >= 0) node.setAttribute('data-code-message-index', String(messageIndex));
  }

  // Error replies are rendered from canonical state so they retain retry
  // controls.  Remove the transient node before that reconciliation.
  function discardStreamingMessageNode(node) {
    if (node && node.parentNode) {
      try { node.remove(); } catch (_) { node.parentNode.removeChild(node); }
    }
    // A re-render can replace the element while an AbortError is queued.
    // Remove the current DOM node by its stable stream id as well.
    if (node && node.id) {
      var currentNode = document.getElementById(node.id);
      if (currentNode && currentNode.parentNode) {
        try { currentNode.remove(); } catch (_) { currentNode.parentNode.removeChild(currentNode); }
      }
    }
  }

  function renderComposerAttachments() {
    var container = document.getElementById('codeChatAttachments');
    if (!container) return;
    var html = '';
    for (var i = 0; i < state.attachments.length; i++) {
      var attachment = state.attachments[i];
      var status = attachment.status === 'ready' ? '，已就绪' : '';
      if (attachment.truncated) status += '，已截断';
      html += '<span class="code-attachment-chip ' + (attachment.pinned ? 'is-pinned' : '') + '" title="' + escapeHTML(attachment.path) + '">' +
        '<span class="code-attachment-kind" aria-hidden="true">' + attachmentTypeIcon(attachment) + '</span><span class="code-attachment-name">' + escapeHTML(attachment.name) + '</span>' +
        '<span class="code-attachment-meta">' + (attachment.pinned ? '固定' : '本轮') + status + '</span>' +
        '<button type="button" data-pin-attachment="' + i + '" aria-label="' + (attachment.pinned ? '取消固定 ' : '固定 ') + escapeHTML(attachment.name) + '">' + (attachment.pinned ? '取消固定' : '固定') + '</button>' +
        '<button type="button" data-remove-attachment="' + i + '" aria-label="移除 ' + escapeHTML(attachment.name) + '">×</button></span>';
    }
    if (state.attachmentProcessing) html += '<span class="code-attachment-status" role="status">正在解析资料…</span>';
    if (state.attachmentError) html += '<span class="code-attachment-error" role="alert">' + escapeHTML(state.attachmentError) + '</span>';
    container.innerHTML = html;
    Array.prototype.forEach.call(container.querySelectorAll('[data-pin-attachment]'), function(button) {
      button.addEventListener('click', function() { toggleAttachmentPinned(parseInt(button.getAttribute('data-pin-attachment'), 10)); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-remove-attachment]'), function(button) {
      button.addEventListener('click', function() { removeAttachment(parseInt(button.getAttribute('data-remove-attachment'), 10)); });
    });
  }

  function bindLocalRuntimeStatus(runtime) {
    if (!runtime || typeof runtime.onStatusChange !== 'function') return;
    if (state._localRuntime === runtime && state._localRuntimeUnsubscribe) return;
    if (state._localRuntimeUnsubscribe) {
      try { state._localRuntimeUnsubscribe(); } catch (_) {}
    }

    state._localRuntime = runtime;
    state._localRuntimeUnsubscribe = runtime.onStatusChange(function () {
      updateComposerControls();
    });
  }

  function updateLocalModelStatus(runtime, isLocalModel) {
    var status = document.getElementById('codeLocalModelStatus');
    var statusText = document.getElementById('codeLocalModelStatusText');
    var statusValue = document.getElementById('codeLocalModelStatusValue');
    var progressEl = document.getElementById('codeLocalModelProgress');
    if (!status || !statusText || !statusValue || !progressEl) return;
    if (!isLocalModel || !runtime) {
      status.hidden = true;
      return;
    }
    bindLocalRuntimeStatus(runtime);
    var localState = typeof runtime.getState === 'function' ? runtime.getState() : 'idle';
    var progress = typeof runtime.getProgressValue === 'function' ? Number(runtime.getProgressValue()) : 0;
    progress = isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    var hasProgress = typeof runtime.hasProgressValue === 'function' ? runtime.hasProgressValue() : progress > 0;
    var lastActivityAt = typeof runtime.getLastActivityAt === 'function' ? Number(runtime.getLastActivityAt()) : 0;
    var elapsedSeconds = typeof runtime.getElapsedSeconds === 'function' ? Number(runtime.getElapsedSeconds()) : 0;
    var progressText = typeof runtime.getProgressText === 'function' ? runtime.getProgressText() : '';
    var label = '本地 Qwen 尚未下载';
    var value = '点击上方按钮开始';
    if (localState === 'downloading') {
      label = '正在下载本地 Qwen';
      value = hasProgress && progress > 0 ? Math.round(progress * 100) + '%' : '正在准备…';
      if (lastActivityAt > 0) value += ' · 刚刚有活动';
      if (isFinite(elapsedSeconds) && elapsedSeconds > 0) value += ' · 已用 ' + Math.floor(elapsedSeconds) + ' 秒';
      progressEl.hidden = false;
    } else if (localState === 'initializing') {
      label = '正在初始化本地 Qwen';
      value = '请稍候';
      progressEl.hidden = false;
    } else if (localState === 'ready') {
      label = '本地 Qwen 已就绪';
      value = '可离线使用';
      progress = 1;
      progressEl.hidden = false;
    } else if (localState === 'failed') {
      label = '本地 Qwen 准备失败';
      value = '点击上方按钮重试';
      progressEl.hidden = true;
    } else if (localState === 'cancelled') {
      label = '本地 Qwen 下载已取消';
      value = '点击上方按钮重试';
      progressEl.hidden = true;
    } else {
      progressEl.hidden = true;
    }
    status.hidden = false;
    status.dataset.state = localState;
    statusText.textContent = label;
    statusValue.textContent = value;
    status.title = progressText || label;
    progressEl.value = progress;
  }

  function updateComposerControls() {
    var modelSelect = document.getElementById('codeModelSelect');
    var thinkingSelect = document.getElementById('codeThinkingSelect');
    var contextUsage = document.getElementById('codeContextUsage');
    var runtimeStatus = document.getElementById('codeComposerRuntimeStatus');
    var localSetupButton = document.getElementById('codeLocalModelSetupBtn');
    if (modelSelect) {
      var current = state.selectedModelId;
      modelSelect.innerHTML = '';
      state.models.forEach(function(model) {
        var option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name + (model.supports_tools ? ' · 工具' : '');
        option.selected = model.id === current;
        modelSelect.appendChild(option);
      });
      var localDesc = localCodeModelDescriptor();
      var localOption = document.createElement('option');
      localOption.value = localDesc.id;
      localOption.textContent = localDesc.name;
      localOption.selected = localDesc.id === current;
      modelSelect.appendChild(localOption);
      modelSelect.disabled = false;
      var selectedModel = selectedCodeModel();
      modelSelect.title = selectedModel ? (selectedModel.description || ((selectedModel.supports_thinking ? '支持思考' : '不支持思考') + (selectedModel.supports_tools ? '；支持工具调用' : ''))) : '';
    }
    if (localSetupButton) {
      var localRuntime = window.__xtjLocalAI;
      bindLocalRuntimeStatus(localRuntime);
      var localState = localRuntime && localRuntime.getState();
      var localErrorCode = localRuntime && typeof localRuntime.getLastErrorCode === 'function' ? localRuntime.getLastErrorCode() : '';
      var localHardwareUnsupported = /^(LOCAL_AI_UNSUPPORTED|LOCAL_AI_WEBGPU_ADAPTER_UNAVAILABLE|LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED|LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED)$/.test(localErrorCode);
      localSetupButton.disabled = localHardwareUnsupported || ((localState === 'downloading' || localState === 'initializing') && !state._localDownloadController);
      localSetupButton.textContent = localHardwareUnsupported ? (localErrorCode === 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED' ? '当前运行时不兼容' : '此设备不支持本地 Qwen') : (state._localDownloadController ? '取消本地 Qwen 下载' : (localState === 'downloading' ? ('下载中 ' + Math.round(localRuntime.getProgressValue() * 100) + '%') :
        (localState === 'initializing' ? '准备中…' : (localState === 'ready' ? '本地 Qwen 已就绪' : '下载本地 Qwen（约 1GB）'))));
    }
    if (thinkingSelect) {
      normalizeThinkingModeForSelectedModel();
      thinkingSelect.value = state.thinkingMode || 'auto';
      var model = selectedCodeModel();
      Array.prototype.forEach.call(thinkingSelect.options, function(option) {
        option.disabled = !!(model && Array.isArray(model.supported_thinking_modes) && model.supported_thinking_modes.indexOf(option.value) < 0);
      });
    }
    if (contextUsage) {
      var runtime = state.lastRuntime || {};
      var used = Number(runtime.promptTokens || runtime.prompt_tokens || runtime.currentPromptTokens || 0);
      var total = Number(runtime.configuredContextTokens || runtime.maxContextTokens || (state.capabilities && state.capabilities.maxContextTokens) || 0);
      contextUsage.textContent = used > 0 && total > 0 ? '上下文 ' + Math.min(100, Math.round(used / total * 100)) + '%' : '上下文 未估算';
      contextUsage.title = used > 0 && total > 0 ? ('约 ' + used + ' / ' + total + ' tokens') : '在收到首个模型运行数据后显示估算值';
      if (runtime.thinkingFallback) contextUsage.title += '；思考模式已由 ' + (runtime.requestedThinkingMode || '请求值') + ' 降级为 ' + (runtime.effectiveThinkingMode || 'off');
    }
    if (runtimeStatus) {
      var modelHint = selectedCodeModel();
      // P3: 本地模型状态显示
      var isLocalModel = !!(window.__xtjLocalAI && modelHint && modelHint.local);
      updateLocalModelStatus(window.__xtjLocalAI, isLocalModel);
      if (isLocalModel) {
        var localState = window.__xtjLocalAI.getState();
        var localProgress = window.__xtjLocalAI.getProgressValue();
        var localText = window.__xtjLocalAI.getStatusText();
        if (localState === 'downloading') {
          runtimeStatus.textContent = '下载中 ' + Math.round(localProgress * 100) + '%';
          runtimeStatus.hidden = false;
          runtimeStatus.title = '本地模型下载进度';
        } else if (localState === 'initializing') {
          runtimeStatus.textContent = '初始化中…';
          runtimeStatus.hidden = false;
          runtimeStatus.title = '本地模型初始化中';
        } else if (localState === 'idle') {
          runtimeStatus.textContent = '尚未下载';
          runtimeStatus.hidden = false;
          runtimeStatus.title = '点击下载按钮开始准备本地模型';
        } else if (localState === 'ready') {
          runtimeStatus.textContent = '已就绪';
          runtimeStatus.hidden = false;
          runtimeStatus.title = '本地模型已就绪，可离线使用';
        } else if (localState === 'failed') {
          runtimeStatus.textContent = '加载失败';
          runtimeStatus.hidden = false;
          runtimeStatus.title = '本地模型加载失败，请重试';
        } else if (localState === 'cancelled') {
          runtimeStatus.textContent = '已取消';
          runtimeStatus.hidden = false;
          runtimeStatus.title = '本地模型下载已取消';
        } else {
          runtimeStatus.textContent = localText || '本地模型';
          runtimeStatus.hidden = false;
        }
      } else {
        if (modelHint && modelHint.availability === 'degraded' && !state.modelLoadError && !runtime.thinkingFallback) {
          runtimeStatus.dataset.availability = 'degraded'; /*
          runtimeStatus.title = '妯″瀷妫€娴嬫湭瀹屾垚锛屾湇鍔″櫒浼氬湪璇锋眰鏃跺啀娆℃牎楠?;
        */ } else if (runtimeStatus.dataset.availability) {
          delete runtimeStatus.dataset.availability;
          runtimeStatus.removeAttribute('title');
        }
        runtimeStatus.textContent = runtime.thinkingFallback ? ('思考：' + (runtime.requestedThinkingMode || 'auto') + ' → ' + (runtime.effectiveThinkingMode || 'off')) : (state.modelLoadError || (modelHint && modelHint.description) || '');
        runtimeStatus.hidden = !runtime.thinkingFallback && !state.modelLoadError && !(modelHint && (modelHint.description || modelHint.availability === 'degraded'));
        if (modelHint && modelHint.availability === 'degraded' && !state.modelLoadError && !runtime.thinkingFallback) {
          runtimeStatus.title = 'Model probe is still running; the server will verify it when you send a request.';
        }
      }
    }
  }

  function bindComposerControls() {
    var modelSelect = document.getElementById('codeModelSelect');
    var thinkingSelect = document.getElementById('codeThinkingSelect');
    var contextButton = document.getElementById('codeComposerContextBtn');
    var contextMenu = document.getElementById('codeComposerContextMenu');
    var contextUsage = document.getElementById('codeContextUsage');
    var contextDetails = document.getElementById('codeContextDetails');
    var localSetupButton = document.getElementById('codeLocalModelSetupBtn');
    if (modelSelect && !modelSelect.dataset.bound) {
      modelSelect.dataset.bound = '1';
      modelSelect.addEventListener('change', function() { state.selectedModelId = modelSelect.value; normalizeThinkingModeForSelectedModel(); saveComposerPreferences(); updateComposerControls(); updateCapabilitiesBadge(); });
    }
    if (thinkingSelect && !thinkingSelect.dataset.bound) {
      thinkingSelect.dataset.bound = '1';
      thinkingSelect.addEventListener('change', function() { state.thinkingMode = thinkingSelect.value; saveComposerPreferences(); });
    }
    if (localSetupButton && !localSetupButton.dataset.bound) {
      localSetupButton.dataset.bound = '1';
      localSetupButton.addEventListener('click', function() {
        if (state._localDownloadController) {
          try { state._localDownloadController.abort(); } catch (_) {}
          if (state._localDownloadRuntime && typeof state._localDownloadRuntime.stop === 'function') {
            try { state._localDownloadRuntime.stop(); } catch (_) {}
          }
          return;
        }
        var localDownloadController = new AbortController();
        state._localDownloadController = localDownloadController;
        localSetupButton.disabled = false;
        localSetupButton.textContent = '正在准备本地 Qwen…';
        ensureCodeLocalAiRuntime({ signal: localDownloadController.signal }).then(function(runtime) {
          state._localDownloadRuntime = runtime;
          bindLocalRuntimeStatus(runtime);
          updateComposerControls();
          if (!runtime.isSupported()) throw new Error('当前浏览器不支持 WebGPU；请使用最新版 Edge 或 Chrome，并通过 HTTPS 打开网站。');
          state.selectedModelId = runtime.LOCAL_MODEL_ID;
          saveComposerPreferences();
          try { localStorage.setItem('xtj_local_model_confirmed', '1'); } catch (e) {}
          return runtime.ensureReady({ signal: localDownloadController.signal, onProgress: function() { updateComposerControls(); } });
        }).then(function() {
          state._localDownloadController = null;
          state._localDownloadRuntime = null;
          updateComposerControls();
          updateCapabilitiesBadge();
          showToast('本地 Qwen 已就绪，可以离线使用。', 'success');
        }).catch(function(error) {
          var cancelled = !!(error && (error.code === 'LOCAL_AI_CANCELLED' || error.code === 'ABORTED' || error.name === 'AbortError'));
          var localIncompatible = !!(error && (
            error.code === 'LOCAL_AI_UNSUPPORTED' ||
            error.code === 'LOCAL_AI_WEBGPU_ADAPTER_UNAVAILABLE' ||
            error.code === 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED' ||
            error.code === 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED'
          ));
          state._localDownloadController = null;
          state._localDownloadRuntime = null;
          if (localIncompatible) {
            state.selectedModelId = 'online';
            saveComposerPreferences();
            updateCapabilitiesBadge();
          }
          updateComposerControls();
          if (!cancelled) showToast((error && error.message) || (localIncompatible ? '此设备无法运行本地 Qwen，已切换到在线 DeepSeek。' : '本地 Qwen 准备失败，请重试。'), 'error');
        });
      });
    }
    if (contextUsage && contextDetails && !contextUsage.dataset.bound) {
      contextUsage.dataset.bound = '1';
      contextUsage.addEventListener('click', function() {
        var opening = contextDetails.hidden;
        if (contextMenu) contextMenu.hidden = true;
        if (contextButton) contextButton.setAttribute('aria-expanded', 'false');
        if (opening) {
          var runtime = state.lastRuntime || {};
          var used = Number(runtime.promptTokens || runtime.prompt_tokens || runtime.currentPromptTokens || 0);
          var total = Number(runtime.configuredContextTokens || runtime.maxContextTokens || (state.capabilities && state.capabilities.maxContextTokens) || 0);
          contextDetails.innerHTML =
            '<strong>本轮上下文</strong>' +
            '<span>当前文件：' + escapeHTML(state.activePath || '无') + '</span>' +
            '<span>固定文件：' + state.pinnedFiles.length + '，已打开：' + state.openTabs.length + '，附件：' + state.attachments.length + '</span>' +
            '<span>历史消息：' + state.messages.length + '，估算：' + (used && total ? (used + ' / ' + total + ' tokens') : '未估算') + '</span>' +
            (runtime.cacheHitTokens ? '<span>最近缓存命中：' + runtime.cacheHitTokens + ' tokens</span>' : '');
          var readContext = state.lastReadContext || {};
          var contextPercent = used && total ? Math.round(used / total * 100) : 0;
          if (readContext.truncated) {
            contextDetails.innerHTML += '<span class="code-context-warning">\u5df2\u622a\u65ad\u90e8\u5206\u4e0a\u4e0b\u6587\uff1a\u8bf7\u51cf\u5c11\u9644\u4ef6\u6216\u53d6\u6d88\u56fa\u5b9a\u6587\u4ef6\u540e\u518d\u8bd5\u3002</span>';
          } else if (contextPercent >= 85) {
            contextDetails.innerHTML += '<span class="code-context-warning">\u4e0a\u4e0b\u6587\u63a5\u8fd1\u9650\u5236\uff0c\u5efa\u8bae\u51cf\u5c11\u9644\u4ef6\u6216\u53d6\u6d88\u56fa\u5b9a\u6587\u4ef6\u3002</span>';
          }
        }
        contextDetails.hidden = !opening;
        contextUsage.setAttribute('aria-expanded', opening ? 'true' : 'false');
      });
    }
    if (contextButton && contextMenu && !contextButton.dataset.bound) {
      contextButton.dataset.bound = '1';
      contextButton.addEventListener('click', function() {
        var opening = contextMenu.hidden;
        if (contextDetails) contextDetails.hidden = true;
        if (contextUsage) contextUsage.setAttribute('aria-expanded', 'false');
        contextMenu.hidden = !opening;
        state.composerMenu = opening ? 'context' : null;
        contextButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) contextMenu.querySelector('button').focus();
      });
      contextMenu.addEventListener('click', function(event) {
        var action = event.target && event.target.getAttribute('data-composer-action');
        if (!action) return;
        if (action === 'upload') document.getElementById('codeAttachmentInput').click();
        if (action === 'current') {
          var currentTab = state.openTabs.filter(function(tab) { return tab.path === state.activePath; })[0];
          if (!currentTab) showToast('请先从左侧打开一个文件', 'info');
          else if (!addOpenTabAsAttachment(currentTab)) showToast('当前文件没有可添加的内容，或已在本轮上下文中', 'info');
        }
        if (action === 'open') {
          var addedOpenFiles = 0;
          state.openTabs.forEach(function(tab) { if (addOpenTabAsAttachment(tab)) addedOpenFiles++; });
          if (!addedOpenFiles) showToast('没有新的已打开文件可添加', 'info');
        }
        if (action === 'pin') {
          if (!state.activePath) showToast('请先从左侧打开一个文件', 'info');
          else if (state.pinnedFiles.indexOf(state.activePath) < 0) state.pinnedFiles.push(state.activePath);
          else if (action === 'pin') state.pinnedFiles.splice(state.pinnedFiles.indexOf(state.activePath), 1);
        }
        if (false && action === 'open') {
          state.openTabs.forEach(function(tab) { if (tab.path && state.pinnedFiles.indexOf(tab.path) < 0) state.pinnedFiles.push(tab.path); });
        }
        if (action === 'pinned') {
          showToast(state.pinnedFiles.length ? ('已固定：' + state.pinnedFiles.map(function(path) { return path.split('/').pop(); }).join('、')) : '当前没有固定文件', 'info');
        }
        if (action === 'clear') consumeTransientAttachments();
        if (action === 'ignore-documents') {
          state.ignoreDocumentContextOnce = true;
          showToast('This send will ignore documents that are not ready.', 'info');
        }
        contextMenu.hidden = true;
        state.composerMenu = null;
        contextButton.setAttribute('aria-expanded', 'false');
        renderComposerAttachments();
        renderProjectStatus();
        contextButton.focus();
      });
      contextMenu.addEventListener('keydown', function(event) {
        var items = Array.prototype.slice.call(contextMenu.querySelectorAll('[role="menuitem"]'));
        var index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (index < 0) index = 0;
          else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[index].focus();
        }
        if (event.key === 'Home' && items.length) { event.preventDefault(); items[0].focus(); }
        if (event.key === 'End' && items.length) { event.preventDefault(); items[items.length - 1].focus(); }
        if (event.key === 'Tab') {
          contextMenu.hidden = true;
          state.composerMenu = null;
          contextButton.setAttribute('aria-expanded', 'false');
        }
      });
      if (state._composerGlobalCleanup) state._composerGlobalCleanup();
      var onDocumentPointerDown = function(event) {
        if (!contextMenu.hidden && !contextMenu.contains(event.target) && event.target !== contextButton) {
          contextMenu.hidden = true;
          state.composerMenu = null;
          contextButton.setAttribute('aria-expanded', 'false');
        }
        if (contextDetails && !contextDetails.hidden && !contextDetails.contains(event.target) && event.target !== contextUsage) {
          contextDetails.hidden = true;
          contextUsage.setAttribute('aria-expanded', 'false');
        }
      };
      var onDocumentKeyDown = function(event) {
        if (event.key === 'Escape' && !contextMenu.hidden) {
          contextMenu.hidden = true;
          state.composerMenu = null;
          contextButton.setAttribute('aria-expanded', 'false');
          contextButton.focus();
        }
        if (event.key === 'Escape' && contextDetails && !contextDetails.hidden) {
          contextDetails.hidden = true;
          contextUsage.setAttribute('aria-expanded', 'false');
          contextUsage.focus();
        }
      };
      document.addEventListener('pointerdown', onDocumentPointerDown);
      document.addEventListener('keydown', onDocumentKeyDown);
      state._composerGlobalCleanup = function() {
        document.removeEventListener('pointerdown', onDocumentPointerDown);
        document.removeEventListener('keydown', onDocumentKeyDown);
      };
    }
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

  // Show provider HTTP failures as a human-readable status (e.g. "HTTP 502")
  // instead of leaking internal error codes into the visible chat message.
  function friendlyErrorCode(code) {
    if (!code) return '';
    var m = /^PROVIDER_HTTP_(\d+)$/.exec(String(code));
    return m ? 'HTTP ' + m[1] : '';
  }

  function appendChatMessage(msg, container) {
    if (!container) return;
    var el = document.createElement('div');
    var isAssistant = msg.role !== 'user';
    var isError = isAssistant && !!msg.errorCode;
    var isCancelled = isAssistant && msg.stopped === true;
    el.className = 'code-chat-message ' + (isAssistant ? 'assistant' : 'user') +
      (isError ? ' error-state' : '') + (isCancelled ? ' cancelled' : '');
    if (isError) el.setAttribute('data-state', 'error');
    else if (isCancelled) el.setAttribute('data-state', 'cancelled');
    else if (isAssistant) el.setAttribute('data-state', 'complete');
    if (isError && msg.errorCode) el.setAttribute('data-error-code', String(msg.errorCode));
    var messageIndex = state.messages.indexOf(msg);
    if (messageIndex >= 0) el.setAttribute('data-code-message-index', String(messageIndex));

    var avatarText = msg.role === 'user' ? '你' : 'AI';
    var avatar = '<div class="msg-avatar">' + escapeHTML(avatarText) + '</div>';

    // Defense in depth: the server owns protocol parsing, but never render a
    // provider tool frame if an old proxy/cache somehow returns one.
    var visibleContent = String(msg.content || '');
    if (msg.role === 'assistant' && /<[|\uff5c]DSML[|\uff5c]|\b(?:reasoning_content|tool_calls)\b/i.test(visibleContent)) {
      visibleContent = '工具调用未生成可显示答案，请重试。';
    }
    var body = '<div class="msg-body">';
    if (isError) {
      body += '<div class="code-stream-error-heading"><span>生成失败</span>' +
        (msg.errorCode ? '<span class="code-stream-error-code">' + friendlyErrorCode(msg.errorCode) + '</span>' : '') +
        '</div>';
      body += '<div class="code-stream-status" data-state="error" role="status" aria-live="polite" aria-busy="false">' +
        '<span class="code-stream-status-text">生成失败</span></div>';
    }
    body += '<div class="msg-content markdown-body">' + parseSimpleMarkdown(visibleContent) + '</div>';
    if (msg.time) {
      body += '<div class="msg-time">' + escapeHTML(msg.time) + '</div>';
    }
    if (msg.role === 'assistant' && msg.retryable) {
      body += '<button class="code-chat-retry-btn" type="button">重新生成</button>';
    }
    body += '</div>';

    el.innerHTML = avatar + body;
    container.appendChild(el);
    if (msg.role === 'assistant' && msg.retryable) {
      var retryBtn = el.querySelector('.code-chat-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          if (retryBtn.disabled || state.sending || msg._retryStarted) return;
          msg._retryStarted = true;
          retryBtn.disabled = true;
          sendMessage(msg.retryMessage || state.lastFailedMessage, msg.retryBody || null, { retry: true, useCurrentContext: true });
        });
      }
    }
  }

  function updateChatScrollControl() {
    var button = document.getElementById('codeChatBackToBottom');
    if (button) button.hidden = state.autoScrollPinned !== false;
  }

  function scrollChatToBottom(force) {
    var container = document.getElementById('codeChatMessages');
    if (container && (force || state.autoScrollPinned !== false)) {
      setTimeout(function () {
        container.scrollTop = container.scrollHeight;
        state.autoScrollPinned = true;
        updateChatScrollControl();
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
        contentVersion: tab._contentVersion || 0,
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

  function ensureOpenFileContexts(message, options) {
    options = options || {};
    if (options.ignoreDocumentContext === true) return Promise.resolve([]);
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
    } else {
      // Callers that are preparing a context without a message (restore,
      // tests, and integrations) need every open document settled; otherwise
      // a failed extraction could be silently ignored.
      state.openTabs.forEach(function(tab) {
        if (tab.type === 'document' && tab.path) relevantPaths.add(tab.path);
      });
    }

    // Only wait for relevant documents that are still extracting
    state.openTabs.forEach(function (tab) {
      if (tab.type === 'document' && tab._docState === 'extracting' && tab._extractPromise && relevantPaths.has(tab.path)) {
        // Add timeout to relevant document extractions (30s max)
        var extractionTimeoutId = null;
        var extractionId = tab._extractId;
        var extractionGeneration = tab._extractGeneration;
        var extractWithTimeout = Promise.race([
          tab._extractPromise,
          new Promise(function(resolve) {
            extractionTimeoutId = setTimeout(function() {
              if (tab._extractId !== extractionId || tab._docState !== 'extracting' || extractionGeneration !== state.workspaceGeneration) {
                resolve(null);
                return;
              }
              // 超时：中止提取控制器并标记状态
              if (tab._extractAbortController) {
                try { tab._extractAbortController.abort(); } catch (_) {}
              }
              tab._docState = 'timed_out';
              state._documentStates[tab.path] = { state: 'timed_out', generation: tab._extractGeneration, extractionId: extractionId, error: '文档提取超时' };
              resolve(null);
            }, 30000);
          })
        ]).then(function (docData) {
          // The extraction promise is also consumed by send-time readiness
          // checks.  Some adapters resolve it directly without running the
          // preview continuation, so commit a valid result here while the
          // tab and workspace generation are still current.
          if (docData && typeof docData.text === 'string' &&
              tab._extractId === extractionId &&
              tab._docState === 'extracting' &&
              extractionGeneration === state.workspaceGeneration) {
            tab._extractedText = docData.text;
            tab._extractedTruncated = !!docData.truncated;
            tab._extractedMetadata = docData.metadata || null;
            tab._parseReady = true;
            tab._extractError = null;
            tab._docState = 'ready';
            state._documentStates[tab.path] = {
              state: 'ready',
              generation: extractionGeneration,
              extractionId: extractionId,
              error: null
            };
          }
          return docData;
        }).finally(function() {
          if (extractionTimeoutId) { clearTimeout(extractionTimeoutId); extractionTimeoutId = null; }
        });
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
        if (tab._docState !== 'ready') {
          throw new Error('document_not_ready: ' + (tab._extractError || tab._docState || 'unknown'));
        }
      }
      return [];
    }

    if (!pending.length) {
      return Promise.resolve().then(checkFailedTabs);
    }
    return Promise.all(pending).then(checkFailedTabs);
  }

  function buildChatRequestBody(message, historyMsgs, clientRequestId, sendOptions) {
    var scope = getWorkspaceScope();
    // 检查是否有文档仍未就绪
    var warnings = [];
    var notReadyDocs = state.openTabs.filter(function(t) {
      return t.type === 'document' && ['ready'].indexOf(t._docState) < 0;
    });
    if (notReadyDocs.length > 0) {
      warnings.push({
        code: 'documents_not_ready',
        paths: notReadyDocs.map(function(t) { return t.path; }).filter(Boolean),
        states: notReadyDocs.map(function(t) { return { path: t.path, state: t._docState || 'unknown' }; })
      });
    }
    var body = {
      workspace_name: state.workspaceName || '',
      workspace_id: scope.workspace_id,
      workspace_generation: scope.workspace_generation,
      conversation_id: state.conversationId,
      client_request_id: clientRequestId || ('code_cr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
      message: message,
      active_path: state.activePath || '',
      model_id: state.selectedModelId || '',
      thinking_mode: state.thinkingMode || 'auto',
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
    if (warnings.length > 0) {
      body.context_warnings = warnings;
    }
    sendOptions = sendOptions || {};
    if (sendOptions.replayOriginal === true) {
      body.replay_original_context = true;
    }
    return body;
  }

  var _sendingWatchdog = null;
  function clearSendingWatchdog() {
    if (_sendingWatchdog) { clearTimeout(_sendingWatchdog); _sendingWatchdog = null; }
  }
  function abortRequestTransport(ctx, reason) {
    if (!ctx) return;
    if (ctx.reader && typeof ctx.reader.cancel === 'function') {
      try { ctx.reader.cancel(reason || 'cancelled'); } catch (_) {}
    }
    if (ctx.sharedCtrl) {
      try {
        if (typeof ctx.sharedCtrl._abort === 'function') ctx.sharedCtrl._abort(reason || 'cancelled');
        else if (typeof ctx.sharedCtrl.cancel === 'function' && !ctx.sharedCtrl.isFinalized()) ctx.sharedCtrl.cancel(reason || 'cancelled');
      } catch (_) {}
    }
    if (ctx.abortController) { try { ctx.abortController.abort(); } catch (_) {} }
  }

  function clearRequestWatchdog(ctx) {
    if (!ctx || ctx.watchdogTimer === undefined || ctx.watchdogTimer === null) return;
    var timer = ctx.watchdogTimer;
    clearTimeout(ctx.watchdogTimer);
    ctx.watchdogTimer = undefined;
    if (_sendingWatchdog === timer) _sendingWatchdog = null;
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
    clearRequestWatchdog(ctx);
    if (ctx.timeoutTimer !== undefined) { clearTimeout(ctx.timeoutTimer); ctx.timeoutTimer = undefined; }
    // Always abort the transport owned by this context. This covers the
    // shared-controller signal as well as the local fallback controller.
    var transportReason = options.cancelReason || options.errorCode || 'finalized';
    if (!options.done || options.cancelled) abortRequestTransport(ctx, transportReason);
    if (ctx.sharedCtrl) {
      try {
        if (typeof ctx.sharedCtrl.isActive === 'function' && ctx.sharedCtrl.isActive()) {
          if (options.done) {
            ctx.sharedCtrl.done();
          } else if (options.cancelled || options.cancelReason) {
            try { ctx.sharedCtrl.cancel(options.cancelReason || 'cancelled'); } catch(_) {}
          } else if (options.error || options.errorCode) {
            try { ctx.sharedCtrl.error(options.errorCode || options.error || 'error'); } catch(_) {}
          } else {
            ctx.sharedCtrl.cancel(options.cancelReason || 'finalized');
          }
        }
      } catch(_) {}
    }
    if (ctx.unregisterKey && window.XtjAiCore && window.XtjAiCore.RequestController) {
      try { window.XtjAiCore.RequestController.unregisterInFlight(ctx.unregisterKey); } catch(_) {}
    }
    var telemetryState = 'done';
    if (options.cancelled || options.cancelReason === 'user_cancelled' || options.cancelReason === 'aborted' || options.cancelReason === 'cleanup' || options.cancelReason === 'watchdog') {
      telemetryState = 'cancelled';
    } else if (options.error || options.errorCode) {
      telemetryState = 'error';
    }
    if (ctx.telemetry) {
      try {
        if (options.usage) { try { ctx.telemetry.recordUsage(options.usage); } catch(_) {} }
        ctx.telemetry.finalize(telemetryState, options.error ? { code: options.errorCode || '', message: options.error } : undefined);
      } catch(_) {}
    }
    // Only modify state if this context is still the active request
    if (isCurrentRequest(ctx)) {
      state.sending = false;
      // P2: update request lifecycle status — 'ready' on success, 'failed' on
      // error, 'idle' on cancellation (user can start a new request).
      if (options.error || options.errorCode) {
        state.requestStatus = 'failed';
      } else if (options.cancelled || options.cancelReason) {
        state.requestStatus = 'idle';
      } else {
        state.requestStatus = 'ready';
      }
      state.activeRequest = null;
      state._abortController = null;
      state._sharedCtrl = null;
      state._telemetry = null;
      clearRequestWatchdog(ctx);
      updateChatRequestControls();
      removeTypingIndicator();
      renderProjectStatus();
    }
  }

  function sendMessage(retryMessage, retryBody, sendOptions) {
    sendOptions = sendOptions || {};
    var isRetry = sendOptions.retry === true;
    var useCurrentContext = sendOptions.useCurrentContext === true;
    var replayOriginal = sendOptions.replayOriginal === true;
    if (state.sending) {
      // P2: 不静默丢弃第二条消息 — 给用户明确反馈。
      // 消息内容保留在输入框中，用户可在当前请求完成后手动发送。
      showToast('正在发送中，请稍候', 'info');
      return;
    }

    var input = document.getElementById('codeChatInput');
    if (!input && !isRetry) return;
    var message = isRetry ? String(retryMessage || '').trim() : input.value.trim();
    var hasAttachments = state.attachments.length > 0;
    var ignoreDocumentContext = sendOptions.ignoreDocumentContext === true || state.ignoreDocumentContextOnce === true;
    if (!isRetry && state.attachmentProcessing && hasAttachments) {
      showToast('资料正在解析，请完成后再发送', 'info');
      return;
    }
    // Document readiness is resolved by ensureOpenFileContexts().  Do not
    // block a request because an unrelated background tab failed extraction:
    // that tab is omitted from open_files, while relevant extracting tabs are
    // awaited and relevant failures remain actionable there.
    if (ignoreDocumentContext) state.ignoreDocumentContextOnce = false;
    if (!message && hasAttachments && !isRetry) {
      // The server requires a non-empty instruction. Make attachment-only
      // sends useful without fabricating a model-side prompt elsewhere.
      message = '请分析我附上的资料。';
    }
    if (!message) return;
    if (!isRetry && !state.selectedModelId) {
      loadCodeModels();
      showToast('模型列表尚未准备好，请稍后重试', 'info');
      return;
    }
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
      originalMessage: message,
      originalBody: retryBody ? Object.assign({}, retryBody) : null,
      _finalized: false
    };
    // Register as active request
    state.sending = true;
    state.requestStatus = 'loading';
    state.activeRequest = ctx;
    state._abortController = abortCtrl;
    state._sharedCtrl = null;
    state._telemetry = null;
    updateChatRequestControls();

    // Keep the client deadline slightly beyond the server's 180s DeepSeek
    // deadline, so a healthy server request cannot fail locally first.
    clearSendingWatchdog();
    _sendingWatchdog = setTimeout(function() {
      if (state.sending && isCurrentRequest(ctx)) {
        console.warn('[code-workspace] Watchdog: request timed out');
        // A stream owns a visible assistant node.  Finalizing it directly
        // leaves that node in "thinking" forever, so route through its one
        // terminal-error path instead.
        if (ctx.streamState && typeof ctx.streamState.fail === 'function') {
          ctx.streamState.fail('PROVIDER_TIMEOUT', 'AI 响应超时，请稍后重试', true);
        } else {
          restoreFailedMessage(ctx.originalMessage);
          state.messages.push({
            role: 'assistant', content: 'AI 响应超时，请稍后重试',
            time: '', errorCode: 'PROVIDER_TIMEOUT', retryable: true,
            retryMessage: ctx.originalMessage,
            retryBody: ctx.originalBody ? Object.assign({}, ctx.originalBody) : null
          });
          finalizeRequest(ctx, { error: 'AI 响应超时', errorCode: 'PROVIDER_TIMEOUT' });
          renderChatPanel();
        }
      }
      _sendingWatchdog = null;
    }, 305000);
    ctx.watchdogTimer = _sendingWatchdog;

    // Shared request controller + telemetry (feature-flagged)
    if (window.XtjAiCore && window.XtjAiCore.RequestController && window.XtjAiCore.RequestController.FEATURE_FLAG) {
      ctx.sharedCtrl = window.XtjAiCore.RequestController.create({
        requestId: 'code_req_' + requestId,
        clientRequestId: clientRequestId,
        timeoutMs: 305000,
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

    // A retry reuses the already-rendered user message and must not insert a
    // duplicate. Normal sends append exactly one user message.
    if (!isRetry) {
      state.messages.push({ role: 'user', content: message, time: timeStr });
      input.value = '';
      input.style.height = 'auto';
      clearComposerDraft();
    }

    // P0: 追加用户消息到聊天，而不是重建整个面板
    // renderChatPanel() 会重建 input/button，新建的 DOM 是启用状态，
    // 但 state.sending 仍为 true → 导致点击发送被 guard 拦截，用户无法发送
    try {
      var messagesContainer = document.getElementById('codeChatMessages');
      if (messagesContainer && !isRetry) {
        appendChatMessage(state.messages[state.messages.length - 1], messagesContainer);
      }
      // Request handlers own the sole assistant status card. A generic typing
      // bubble here races with both SSE and JSON terminal rendering.
      scrollChatToBottom();
    } catch (e) {
      console.error('[code-workspace] Initial DOM render failed:', e);
      // Restore the message to input so user can retry
      if (input) {
        input.value = message;
        state.composerDraft = message;
        saveComposerDraft();
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight || 0, 120) + 'px';
      }
      // Remove the user message we just pushed (since it wasn't rendered).
      if (!isRetry) state.messages.pop();
      finalizeRequest(ctx, { error: 'DOM render failed', errorCode: 'DOM_ERROR' });
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
    var requestSendOptions = Object.assign({}, sendOptions, { ignoreDocumentContext: ignoreDocumentContext });
    return ensureOpenFileContexts(message, requestSendOptions).then(function () {
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) {
        finalizeRequest(ctx, { cancelled: true, cancelReason: 'stale' });
        return null;
      }
      var body = (retryBody && !useCurrentContext) ? Object.assign({}, retryBody, {
        client_request_id: ctx.clientRequestId,
        conversation_id: state.conversationId,
        workspace_generation: getWorkspaceScope().workspace_generation
      }) : buildChatRequestBody(message, historyMsgs, ctx.clientRequestId, requestSendOptions);
      ctx.fileContextVersions = {};
      (body.open_files || []).forEach(function (file) {
        if (file && typeof file.path === 'string') {
          ctx.fileContextVersions[file.path] = Number(file.contentVersion || 0);
        }
      });
      ctx.originalBody = Object.assign({}, body);
      // P3: 本地模型路由 — 不经过服务器，直接在浏览器端运行
      if (state.selectedModelId === localCodeModelId()) {
        return handleCodeLocalAiRequest(ctx, historyMsgs, message, timeStr);
      }
      // Phase 2: Route to streaming endpoint when feature flag is enabled
      if (CODE_STREAM_ENABLED) {
        return sendStreamingRequest(ctx, body, timeStr);
      }
      return sendApiRequest(ctx, body, timeStr);
    }).catch(function (err) {
      // Stale request: only clean own resources via finalizeRequest, don't touch UI/state
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) {
        finalizeRequest(ctx, { cancelled: true, cancelReason: 'stale' });
        return null;
      }
      if (err && err.name === 'AbortError') {
        // Aborted — unified finalizer handles everything
        finalizeRequest(ctx, { cancelled: true, cancelReason: 'aborted' });
        return null;
      }
      // Real error: P2 — finalize FIRST (clears state.sending/activeRequest and
      // resets UI controls), THEN render. This matches the streaming error path
      // (see error event handler) and avoids a frame where renderChatPanel()
      // rebuilds the DOM while state.sending is still true (which would briefly
      // show the "sending" controls and allow callbacks to observe a stale ctx).
      removeTypingIndicator();
      var errMsg = (err && err.message) ? err.message : String(err);
      var errCode = (err && err.code) ? err.code : 'CONTEXT_ERROR';
      state.messages.push({ role: 'assistant', content: '抱歉，' + errMsg, time: timeStr, errorCode: errCode, retryable: true, retryMessage: ctx.originalMessage, retryBody: ctx.originalBody ? Object.assign({}, ctx.originalBody) : null });
      finalizeRequest(ctx, { error: errMsg, errorCode: errCode });
      renderChatPanel();
      return null;
    });
  }

  // ──────────────────────────────────────────────
  // handleCodeLocalAiRequest(ctx, historyMsgs, message, timeStr)
  // 处理 Code 工作区中的本地模型 AI 请求
  // ──────────────────────────────────────────────
  function handleCodeLocalAiRequest(ctx, historyMsgs, message, timeStr) {
    var runtime = window.__xtjLocalAI;
    if (!runtime) {
      return ensureCodeLocalAiRuntime({ signal: ctx.abortController && ctx.abortController.signal }).then(function() {
        return handleCodeLocalAiRequest(ctx, historyMsgs, message, timeStr);
      }).catch(function(error) {
        var cancelled = !!(ctx.cancelled || (ctx.abortController && ctx.abortController.signal.aborted) ||
          (error && (error.code === 'LOCAL_AI_CANCELLED' || error.code === 'ABORTED' || error.name === 'AbortError')));
        if (cancelled) {
          finalizeRequest(ctx, { cancelled: true, cancelReason: ctx.cancelReason || 'user_cancelled' });
          return;
        }
        state.messages.push({ role: 'assistant', content: '本地模型运行时不可用：' + ((error && error.message) || '请重试。'), time: timeStr, errorCode: 'LOCAL_AI_NOT_AVAILABLE', retryable: true, retryMessage: ctx.originalMessage, retryBody: ctx.originalBody ? Object.assign({}, ctx.originalBody) : null });
        finalizeRequest(ctx, { error: 'Local AI runtime not available', errorCode: 'LOCAL_AI_NOT_AVAILABLE' });
        renderChatPanel();
      });
    }

    if (!runtime.isSupported()) {
      state.messages.push({ role: 'assistant', content: '当前浏览器不支持本地模型：请使用最新版 Edge 或 Chrome，并通过 HTTPS 打开网站。', time: timeStr, errorCode: 'LOCAL_AI_UNSUPPORTED', retryable: false });
      finalizeRequest(ctx, { error: 'Unsupported browser', errorCode: 'LOCAL_AI_UNSUPPORTED' });
      renderChatPanel();
      return Promise.resolve();
    }

    // First-time download confirmation
    var confirmed = false;
    try { confirmed = localStorage.getItem('xtj_local_model_confirmed') === '1'; } catch (e) {}
    if (!confirmed) {
      if (!confirm('首次使用会下载约 1GB 的 Qwen 0.5B 模型到此浏览器；下载完成后可离线问答。是否继续？')) {
        // Remove the user message that was just added
        state.messages.pop();
        finalizeRequest(ctx, { cancelled: true, cancelReason: 'user_cancelled' });
        renderChatPanel();
        return Promise.resolve();
      }
      try { localStorage.setItem('xtj_local_model_confirmed', '1'); } catch (e) {}
    }

    // Create assistant message placeholder
    var assistantMsg = { role: 'assistant', content: '', time: timeStr, local: true };
    state.messages.push(assistantMsg);
    removeTypingIndicator();
    var messagesContainer = document.getElementById('codeChatMessages');
    var assistantNode = null;
    if (messagesContainer) {
      assistantNode = appendChatMessage(assistantMsg, messagesContainer);
    }
    scrollChatToBottom();

    // Build conversation history for local model (limit to last 9 messages)
    var chatHistory = [];
    for (var hi = Math.max(0, historyMsgs.length - 8); hi < historyMsgs.length; hi++) {
      chatHistory.push({ role: historyMsgs[hi].role, content: historyMsgs[hi].content });
    }
    chatHistory.push({ role: 'user', content: message });

    var answer = '';
    var stopRequested = false;

    return runtime.streamChat(chatHistory, {
      signal: ctx.abortController.signal,
      onProgress: function(progress) {
        var typingIndicator = messagesContainer && messagesContainer.querySelector('.code-typing-indicator');
        if (typingIndicator && !answer) {
          typingIndicator.textContent = progress.text || '正在准备本地模型…';
        }
      },
      onDelta: function(delta) {
        if (stopRequested) return;
        answer += delta;
        assistantMsg.content = answer;
        if (assistantNode) {
          var bubble = assistantNode.querySelector('.msg-content');
          if (bubble) {
            bubble.innerHTML = parseSimpleMarkdown(answer);
          }
        }
        scrollChatToBottom();
      }
    }).then(function() {
      if (stopRequested) return;
      if (!answer) {
        state.messages.pop(); // Remove empty assistant message
        state.messages.push({ role: 'assistant', content: '本地模型未返回内容，请重试。', time: timeStr, errorCode: 'LOCAL_AI_EMPTY_RESPONSE', retryable: true, retryMessage: ctx.originalMessage, retryBody: ctx.originalBody ? Object.assign({}, ctx.originalBody) : null });
        finalizeRequest(ctx, { error: 'Empty response', errorCode: 'LOCAL_AI_EMPTY_RESPONSE' });
        renderChatPanel();
        return;
      }
      finalizeRequest(ctx, {});
      renderChatPanel();
    }).catch(function(error) {
      if (stopRequested) return;
      stopRequested = true;
      if (ctx.cancelled || (error && (error.code === 'ABORTED' || error.name === 'AbortError'))) {
        assistantMsg.content = '（已停止）';
        assistantMsg.stopped = true;
        if (assistantNode) {
          var bubble = assistantNode.querySelector('.msg-content');
          if (bubble) bubble.innerHTML = '（已停止）';
        }
        finalizeRequest(ctx, { cancelled: true, cancelReason: 'user_cancelled' });
        renderChatPanel();
      } else {
        // Remove the failed assistant message and replace with error message
        var msgIdx = state.messages.indexOf(assistantMsg);
        if (msgIdx >= 0) state.messages.splice(msgIdx, 1);
        var errMsg = error && error.message ? error.message : '请稍后重试。';
        var localIncompatible = !!(error && (
          error.code === 'LOCAL_AI_UNSUPPORTED' ||
          error.code === 'LOCAL_AI_WEBGPU_ADAPTER_UNAVAILABLE' ||
          error.code === 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED' ||
          error.code === 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED'
        ));
        if (localIncompatible) {
          state.selectedModelId = 'online';
          saveComposerPreferences();
        }
        state.messages.push({ role: 'assistant', content: '本地模型不可用：' + errMsg, time: timeStr, errorCode: error && error.code || 'LOCAL_AI_ERROR', retryable: !localIncompatible, retryMessage: ctx.originalMessage, retryBody: ctx.originalBody ? Object.assign({}, ctx.originalBody) : null });
        finalizeRequest(ctx, { error: errMsg, errorCode: error && error.code || 'LOCAL_AI_ERROR' });
        renderChatPanel();
      }
    });
  }

  function restoreFailedMessage(message) {
    if (!message) return;
    state.lastFailedMessage = message;
    var input = document.getElementById('codeChatInput');
    if (input && !input.value) {
      input.value = message;
      state.composerDraft = message;
      saveComposerDraft();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight || 0, 120) + 'px';
    }
  }

  function updateChatRequestControls() {
    var input = document.getElementById('codeChatInput');
    var sendBtn = document.getElementById('codeChatSendBtn');
    var cancelBtn = document.getElementById('codeChatCancelBtn');
    var inputArea = document.querySelector('.code-chat-input-area');
    var hasSendableContent = !!((input && input.value.trim()) || state.attachments.length);
    // P0 Fix: 不禁止输入框，用户可以输入下一条草稿
    if (input) input.disabled = false;
    if (sendBtn) {
      sendBtn.style.display = state.sending ? 'none' : '';
      sendBtn.disabled = !state.sending && (!hasSendableContent || state.attachmentProcessing || !state.selectedModelId);
      sendBtn.setAttribute('aria-label', '发送消息');
    }
    if (cancelBtn) {
      cancelBtn.disabled = !state.sending;
      cancelBtn.style.display = state.sending ? '' : 'none';
      cancelBtn.setAttribute('aria-label', '停止生成');
    }
    if (inputArea) inputArea.setAttribute('aria-busy', state.sending || state.attachmentProcessing ? 'true' : 'false');
  }

  function cancelCurrentRequest() {
    var ctx = state.activeRequest;
    // Recover the cancel path when a request was restored or entered the
    // sending state before its full context object was published.
    if (!ctx) {
      if (!state.sending || !state._abortController) return false;
      try { state._abortController.abort(); } catch (_) {}
      state._abortController = null;
      state.sending = false;
      state.requestStatus = 'idle';
      state._requestId++;
      if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
        updateChatRequestControls();
      }
      return true;
    }
    ctx.cancelled = true;
    ctx.cancelReason = 'user_cancelled';
    if (ctx.streamState && typeof ctx.streamState.cancel === 'function') {
      ctx.streamState.cancel();
    } else {
      removeTypingIndicator();
      state.messages.push({ role: 'assistant', content: '（已停止）', time: ctx.timeStr || '', stopped: true });
      finalizeRequest(ctx, { cancelled: true, cancelReason: 'user_cancelled' });
      renderChatPanel();
    }
    // Invalidate callbacks after finalize has cleared the active request.
    state._requestId++;
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
    var signal = ctx.sharedCtrl ? ctx.sharedCtrl.signal : ctx.abortController.signal;
    ctx.fetchSignal = signal;
    var controller = ctx.abortController;
    var streamDone = false;
    var lastEventId = 0;
    var streamId = null;
    var resumeRetryCount = 0;
    var _doneHandled = false;

    // Persist stream metadata on ctx for recovery and stale cleanup
    ctx.timeStr = timeStr;
    ctx.originalMessage = body.message || '';
    ctx.streamId = null;
    ctx.lastEventId = 0;
    ctx.assistantNodeId = 'codeStreamingNode_' + requestId;

    // Phase 3: Save stream state for resume (with full session matching data)
    if (CODE_STREAM_RESUME_ENABLED) {
      saveStreamState({
        originalMessage: body.message || '',
        requestId: requestId,
        clientRequestId: body.client_request_id || ctx.clientRequestId || '',
        streamId: null,
        lastEventId: 0,
        workspaceGeneration: wsGen,
        conversationId: state.conversationId,
        workspaceId: getWorkspaceScope().workspace_id,
        timeStr: timeStr,
        startedAt: Date.now()
      });
    }

    // Remove typing indicator — we create a real assistant node instead
    removeTypingIndicator();

    // Create the single assistant node immediately
    var messagesContainer = document.getElementById('codeChatMessages');
    if (!messagesContainer) {
      finalizeRequest(ctx, { error: 'Messages container not found', errorCode: 'DOM_ERROR' });
      return;
    }

    var assistantNode = document.createElement('div');
    assistantNode.className = 'code-chat-message assistant streaming';
    assistantNode.id = 'codeStreamingNode_' + requestId;
    assistantNode.innerHTML =
      '<div class="msg-avatar">AI</div>' +
      '<div class="msg-body">' +
        '<div class="code-stream-status" data-state="connecting" role="status" aria-live="polite" aria-busy="true">' +
          '<span class="code-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="code-stream-status-text">正在分析任务...</span>' +
          '<span class="code-stream-spinner"></span>' +
        '</div>' +
        '<div class="code-stream-tools" style="display:none">' +
          '<div class="code-stream-tools-header" role="button" tabindex="0" aria-expanded="false">' +
            '<span class="code-stream-tools-toggle">&#9654; 工具执行记录</span>' +
          '</div>' +
          '<div class="code-stream-tools-list" role="list"></div>' +
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
    var toolItems = Object.create(null);
    var streamStatusBaseText = '正在连接服务…';

    function setStreamStatus(text, stateName, busy) {
      if (!statusEl) return;
      statusEl.style.display = '';
      statusEl.setAttribute('data-state', stateName || 'working');
      statusEl.setAttribute('aria-busy', busy === false ? 'false' : 'true');
      if (statusText && text) {
        if (text.indexOf('（已等待 ') === -1) streamStatusBaseText = text;
        statusText.textContent = text;
      }
      if (spinner) {
        spinner.style.display = busy === false ? 'none' : '';
        spinner.setAttribute('aria-hidden', busy === false ? 'true' : 'false');
      }
    }

    function updateToolsHeader() {
      if (!toolsHeader) return;
      toolsHeader.setAttribute('aria-expanded', toolsExpanded ? 'true' : 'false');
      var toggle = toolsHeader.querySelector('.code-stream-tools-toggle');
      if (toggle) toggle.innerHTML = (toolsExpanded ? '&#9660;' : '&#9654;') +
        ' 工具执行记录 (' + toolCount + ')';
    }

    // Toggle tools section
    if (toolsHeader) {
      toolsList.style.display = 'none';
      toolsHeader.addEventListener('click', function () {
        toolsExpanded = !toolsExpanded;
        toolsList.style.display = toolsExpanded ? '' : 'none';
        updateToolsHeader();
      });
      toolsHeader.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toolsHeader.click();
        }
      });
      updateToolsHeader();
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
      setStreamStatus('正在生成回答…', 'answer', true);
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
      toolsExpanded = true;
      if (toolsList) toolsList.style.display = '';
      updateToolsHeader();
      if (statusText) statusText.textContent = data.summary || ('执行工具: ' + (data.tool || ''));
      setStreamStatus(data.summary || ('执行工具: ' + (data.tool || '工具调用')), 'tool', true);
      var item = document.createElement('div');
      item.className = 'code-stream-tool-item';
      var toolKey = String(data.tool_call_id || ('tool-' + toolCount));
      item.id = 'tool-item-' + toolCount;
      item.setAttribute('data-tool-call-id', toolKey);
      item.setAttribute('role', 'listitem');
      item.innerHTML = '<span class="code-stream-tool-icon spinner"></span>' +
        '<div class="code-stream-tool-main">' +
          '<div class="code-stream-tool-name">' + escapeHTML(data.tool || '工具调用') + '</div>' +
          '<div class="code-stream-tool-summary">' + escapeHTML(data.summary || data.description || data.command || data.path || '等待工具返回结果…') + '</div>' +
        '</div>' +
        '<span class="code-stream-tool-state">执行中</span>';
      toolItems[toolKey] = item;
      toolsList.appendChild(item);
    }

    function updateToolResult(data) {
      if (streamCancelled) return;
      var toolKey = String(data.tool_call_id || ('tool-' + toolCount));
      var item = toolItems[toolKey];
      if (!item) {
        // Item may have been created after tool_start, try finding by tool name
        var items = toolsList.querySelectorAll('.code-stream-tool-item');
        if (items.length > 0) item = items[items.length - 1];
      }
      var succeeded = data.ok !== false;
      var resultMessage = String(succeeded
        ? (data.summary || data.result || '工具已完成')
        : (data.error || data.message || data.summary || '工具调用失败'));
      if (item) {
        var icon = item.querySelector('.code-stream-tool-icon');
        if (icon) {
          icon.className = 'code-stream-tool-icon ' + (succeeded ? 'success' : 'error');
        }
        var summary = item.querySelector('.code-stream-tool-summary');
        if (summary) summary.textContent = resultMessage;
        var stateLabel = item.querySelector('.code-stream-tool-state');
        if (stateLabel) stateLabel.textContent = succeeded ? '已完成' : '失败';
        item.classList.toggle('failed', !succeeded);
      }
      setStreamStatus((succeeded ? '已完成 ' : '工具失败 · ') + toolCount + ' 个工具调用', succeeded ? 'tool-complete' : 'tool-error', false);
      if (statusText) statusText.textContent = '已完成 ' + toolCount + ' 个工具调用';
    }

    function showError(code, message, retryable, force) {
      if (streamCancelled && !force) return;
      setStreamStatus('生成失败', 'error', false);
      if (spinner) spinner.style.display = 'none';
      assistantNode.classList.remove('streaming');
      assistantNode.classList.add('error-state');
      assistantNode.setAttribute('data-state', 'error');
      assistantNode.setAttribute('data-error-code', code || '');
      if (statusEl) statusEl.style.display = 'none';
      if (errorEl) {
        errorEl.style.display = '';
        
        var friendlyMessage = message || '请求失败';
        // P0 Fix: 区分不同错误类型，提供具体说明和操作建议
        if (code === 'DOCUMENT_CONTEXT_MISSING') {
          friendlyMessage = '当前文档内容没有成功发送给 AI，请重新打开文档后重试。';
        } else if (code === 'INDEX_REBUILD_REQUIRED') {
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

        var errorHtml = '<div class="code-stream-error-heading"><span>生成失败</span>';
        errorHtml += (code ? '<span class="code-stream-error-code">' + friendlyErrorCode(code) + '</span>' : '') +
          '</div><div class="code-stream-error-msg">';
        errorHtml += escapeHTML(friendlyMessage);
        
        if (code) {
          errorHtml += '<details style="margin-top: 8px; font-size: 11px; opacity: 0.7; cursor: pointer;">';
          errorHtml += '<summary>查看错误详情</summary>';
          errorHtml += '<div style="margin-top: 4px;">错误码: ' + escapeHTML(code) + '</div>';
          errorHtml += '</details>';
        }
        
        errorHtml += '</div>';
        if (retryable) {
          errorHtml += '<button class="code-stream-retry-btn" type="button" style="margin-top: 8px;">重新生成</button>';
          errorHtml += '<button class="code-stream-replay-btn" type="button" style="margin-top: 8px; margin-left: 8px;">原上下文重放</button>';
        }
        errorEl.innerHTML = errorHtml;
        var retryBtn = errorEl.querySelector('.code-stream-retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            if (retryBtn.disabled || state.sending || ctx._retryStarted) return;
            ctx._retryStarted = true;
            retryBtn.disabled = true;
            // 重新生成使用当前上下文（文件、附件、模型、思考模式）
            sendMessage(ctx.originalMessage, null, { retry: true, useCurrentContext: true });
          });
        }
        var replayBtn = errorEl.querySelector('.code-stream-replay-btn');
        if (replayBtn) {
          replayBtn.addEventListener('click', function () {
            if (replayBtn.disabled || state.sending || ctx._retryStarted) return;
            ctx._retryStarted = true;
            replayBtn.disabled = true;
            // 原上下文重放：保留原始请求体
            sendMessage(ctx.originalMessage, ctx.originalBody, { retry: true, replayOriginal: true });
          });
        }
      }
      if (contentEl && !String(contentEl.textContent || '').trim() && !String(answerBuffer || '').trim()) {
        contentEl.textContent = friendlyMessage;
      }
      // A failed request must never discard the user's original prompt.  Do
      // not overwrite a newer draft typed while this request was in flight.
      restoreFailedMessage(ctx.originalMessage);
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
      } else {
        var finalContent = finalReply || answerBuffer || '未收到可显示回复，请重试。';
        contentEl.innerHTML = parseSimpleMarkdown(finalContent);
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

      assistantNode.classList.remove('streaming', 'error-state', 'cancelled');
      assistantNode.classList.add('completed');
      assistantNode.setAttribute('data-state', 'complete');
    }

    function cleanupStream() {
      if (ctx.timeoutTimer) { clearTimeout(ctx.timeoutTimer); ctx.timeoutTimer = null; }
      if (contentEl && contentEl._streamRenderer) {
        try { contentEl._streamRenderer.stop(); } catch (e) {}
        contentEl._streamRenderer = null;
      }
      if (scrollCtrl) {
        try { scrollCtrl.detach(); } catch (e) {}
        scrollCtrl = null;
      }
    }

    function armStreamTimeout(timeoutMs) {
      if (ctx.timeoutTimer) { clearTimeout(ctx.timeoutTimer); ctx.timeoutTimer = null; }
      ctx.timeoutTimer = setTimeout(function () {
      if (streamDone || ctx._finalized) return;
      showError('PROVIDER_TIMEOUT', 'AI 响应超时，请稍后重试', true, true);
      assistantNode.classList.remove('streaming');
      streamCancelled = true;
      // Replace any partial stream with an explicit terminal error in the
      // canonical state so the subsequent render cannot leave a blank/ambiguous bubble.
      answerBuffer = '';
      state.messages.push({ role: 'assistant', content: answerBuffer || '（请求超时）', time: timeStr, errorCode: 'PROVIDER_TIMEOUT', retryable: true, retryMessage: ctx.originalMessage, retryBody: Object.assign({}, ctx.originalBody || body) });
      discardStreamingMessageNode(assistantNode);
      cleanupStream();
      finalizeRequest(ctx, { errorCode: 'PROVIDER_TIMEOUT', error: 'AI 响应超时' });
      renderChatPanel();
      }, Math.max(1000, Number(timeoutMs) || 185000));
    }

    // Default remains slightly longer than the current server deadline. The
    // accepted event below replaces it with the server's actual contract.
    armStreamTimeout(185000);

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
        // Stale request: clean own stream resources + abort fetch, don't touch global state
        cleanupStream();
        if (assistantNode && assistantNode.parentNode) {
          try { assistantNode.remove(); } catch(_) {}
        }
        finalizeRequest(ctx, { cancelled: true, cancelReason: 'stale' });
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
            // Remove the streaming assistant node; sendApiRequest will render fresh
            if (assistantNode && assistantNode.parentNode) {
              try { assistantNode.remove(); } catch(_) {}
            }
            return sendApiRequest(ctx, body, timeStr);
          }
          showError(errCode, errMsg, json && json.retryable);
          answerBuffer = '';
          state.messages.push({ role: 'assistant', content: answerBuffer || ('抱歉，' + errMsg), time: timeStr, errorCode: errCode, retryable: json && json.retryable !== false, retryMessage: ctx.originalMessage, retryBody: Object.assign({}, ctx.originalBody || body) });
          discardStreamingMessageNode(assistantNode);
          cleanupStream();
          finalizeRequest(ctx, { error: errMsg, errorCode: errCode });
          renderChatPanel();
        });
      }

      var contentType = (resp.headers && resp.headers.get('content-type')) || '';
      var responseJsonPromise = null;
      var isSseResponse = contentType.toLowerCase().indexOf('text/event-stream') >= 0;
      if (!resp.body || !isSseResponse) {
        // JSON responses are used by duplicate-request recovery and must not
        // be fed into the SSE line parser.
        if (contentType.toLowerCase().indexOf('application/json') < 0) {
          throw Object.assign(new Error('AI 流响应格式无效'), { code: 'INVALID_STREAM_RESPONSE', retryable: true });
        }
        responseJsonPromise = resp.json();
      }

      // Read SSE stream only after the response type has been validated.
      var reader = null;
      if (!responseJsonPromise) {
        reader = resp.body.getReader();
        ctx.reader = reader;
      }
      var decoder = new TextDecoder();
      var buffer = '';
      var currentSseEventType = '';
      var currentSseData = [];

      function isStreamStale() { return requestId !== state._requestId || wsGen !== state.workspaceGeneration; }

      function dispatchSseEvent() {
        if (currentSseData.length === 0) return;
        var raw = currentSseData.join('\n');
        currentSseData = [];
        currentSseEventType = '';
        try {
          var event = JSON.parse(raw);
          if (event && event.type) handleSSEEvent(event);
        } catch (e) {
          console.warn('[code-workspace] SSE parse error (requestId=' + requestId + '):', raw.slice(0, 80));
        }
      }

      function processSseLine(line) {
        // Comment lines (starting with :) - skip
        if (line.charAt(0) === ':') return;
        // Empty line - dispatch accumulated event
        if (line === '') { dispatchSseEvent(); return; }
        // Field: value parsing
        var colonIdx = line.indexOf(':');
        var field, value;
        if (colonIdx >= 0) {
          field = line.substring(0, colonIdx);
          value = line.substring(colonIdx + 1);
          if (value.charAt(0) === ' ') value = value.substring(1); // Strip optional leading space
        } else {
          field = line;
          value = '';
        }
        if (field === 'event') { currentSseEventType = value; }
        else if (field === 'data') { currentSseData.push(value); }
        // 'id' and 'retry' fields are not used by this application
      }

      function readStream() {
        if (streamCancelled || ctx._finalized) return;
        if (isStreamStale()) {
          // Stale: stop reading, clean up own resources, abort fetch
          cleanupStream();
          finalizeRequest(ctx, { cancelled: true, cancelReason: 'stale' });
          return;
        }
        reader.read().then(function (result) {
          if (streamCancelled || ctx._finalized) return;
          if (isStreamStale()) {
            cleanupStream();
            finalizeRequest(ctx, { cancelled: true, cancelReason: 'stale' });
            return;
          }
          if (result.done) {
            // Process any remaining data
            if (buffer.trim()) { var remaining = buffer.trim().split('\n'); for (var ri = 0; ri < remaining.length; ri++) processSseLine(remaining[ri].replace(/\r$/, '')); }
            dispatchSseEvent();
            if (!streamDone && !_doneHandled) {
              _doneHandled = true;
              var eofError = 'AI 响应不完整，请重新生成';
              showError('STREAM_ENDED_WITHOUT_DONE', eofError, true, true);
              state.messages.push({
                role: 'assistant',
                content: eofError,
                time: timeStr,
                errorCode: 'STREAM_ENDED_WITHOUT_DONE',
                retryable: true,
                retryMessage: ctx.originalMessage,
                retryBody: Object.assign({}, ctx.originalBody || body),
                toolTrace: finalToolTrace,
                operations: finalOperations,
                contextInfo: finalContextInfo,
                runtime: finalRuntime,
                usage: finalUsage
              });
              state.pendingOperations = [];
              discardStreamingMessageNode(assistantNode);
              cleanupStream();
              finalizeRequest(ctx, { error: eofError, errorCode: 'STREAM_ENDED_WITHOUT_DONE' });
              clearStreamState();
              renderChatPanel();
              renderDiffView();
            }
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          // Handle both \r\n and \n line endings
          var lines = buffer.split('\n');
          // Keep incomplete chunk in buffer
          buffer = lines.pop() || '';
          for (var i = 0; i < lines.length; i++) {
            processSseLine(lines[i].replace(/\r$/, ''));
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
                 resumeStream(ctx, streamId, lastEventId);
               }, delay);
            } else {
              showError('STREAM_INTERRUPTED', '流式连接中断', true);
              answerBuffer = '';
              state.messages.push({ role: 'assistant', content: answerBuffer || '（连接中断）', time: timeStr, errorCode: 'STREAM_INTERRUPTED', retryable: true, retryMessage: ctx.originalMessage, retryBody: Object.assign({}, ctx.originalBody || body) });
              discardStreamingMessageNode(assistantNode);
              cleanupStream();
              finalizeRequest(ctx, { error: '流式连接中断', errorCode: 'STREAM_INTERRUPTED' });
              renderChatPanel();
            }
          }
        });
      }

      function handleSSEEvent(event) {
        if (streamCancelled || streamDone || ctx._finalized) return;
        if (isStreamStale()) return;
        // Phase 3: Event deduplication by event_id
        if (event.event_id && event.event_id <= lastEventId) return;
        if (event.event_id) {
          lastEventId = event.event_id;
          ctx.lastEventId = event.event_id;
        }
        // Capture stream_id from any event
        if (event.stream_id) {
          streamId = event.stream_id;
          ctx.streamId = event.stream_id;
        }

        // Persist updated stream state for recovery
        if (CODE_STREAM_RESUME_ENABLED && (event.stream_id || event.event_id)) {
          var saved = getStreamState() || {};
          saveStreamState(Object.assign(saved, {
            streamId: streamId,
            lastEventId: lastEventId,
            originalMessage: ctx.originalMessage || saved.originalMessage || '',
            requestId: requestId,
            conversationId: state.conversationId,
            workspaceId: getWorkspaceScope().workspace_id,
            workspaceGeneration: wsGen,
            clientRequestId: ctx.clientRequestId || '',
            timeStr: timeStr,
            startedAt: saved.startedAt || Date.now()
          }));
        }

        switch (event.type) {
          case 'accepted':
            var serverTimeoutMs = Number(event.data && event.data.timeout_ms);
            var serverElapsedMs = Number(event.data && event.data.elapsed_ms) || 0;
            if (isFinite(serverTimeoutMs) && serverTimeoutMs > 0) {
              armStreamTimeout(serverTimeoutMs - Math.max(0, serverElapsedMs) + 5000);
            }
            setStreamStatus((event.data && event.data.message) || '请求已接受，正在处理…', 'working', true);
            break;
          case 'planning':
            setStreamStatus((event.data && event.data.message) || '正在分析任务…', 'working', true);
            break;
          case 'status':
            setStreamStatus((event.data && event.data.message) || '服务端正在处理请求…', 'working', true);
            break;
          case 'tool_start':
            addToolStart(event.data || {});
            break;
          case 'tool_result':
            updateToolResult(event.data || {});
            break;
          case 'answer_start':
            setStreamStatus('正在生成回答…', 'answer', true);
            break;
          case 'answer_delta':
            var delta = (event.data && event.data.delta) ? event.data.delta : '';
            if (delta) appendAnswerDelta(delta);
            break;
          case 'operation_preview':
            if (event.data && event.data.files) {
              setStreamStatus('正在准备 ' + (event.data.files.length || 0) + ' 个文件修改…', 'working', true);
            }
            break;
          case 'usage':
            finalUsage = event.data || null;
            break;
          case 'warning':
            console.warn('[CODE-STREAM] Warning:', event.data);
            break;
          case 'heartbeat':
            var elapsedMs = Number(event.data && event.data.elapsed_ms);
            var elapsedSeconds = isFinite(elapsedMs) && elapsedMs >= 0 ? Math.floor(elapsedMs / 1000) : 0;
            setStreamStatus(streamStatusBaseText + (elapsedSeconds ? '（已等待 ' + elapsedSeconds + ' 秒）' : '（服务端仍在处理）'), 'working', true);
            break;
          case 'done':
            if (_doneHandled) return; // done must be processed only once
            _doneHandled = true;
            streamDone = true;
            finalReply = (event.data && event.data.reply) ? event.data.reply : '';
            finalOperations = (event.data && Array.isArray(event.data.operations)) ? event.data.operations : [];
            finalContextInfo = (event.data && event.data.context_info) || null;
            finalToolTrace = (event.data && Array.isArray(event.data.tool_trace)) ? event.data.tool_trace : [];
            finalRuntime = (event.data && event.data.runtime) || null;
            if (!finalUsage && event.data && event.data.usage) finalUsage = event.data.usage;

            var completedReply = String(finalReply || answerBuffer || '').trim();
            if (!completedReply) {
              var emptyReplyError = 'AI 未返回有效内容，请重新生成';
              showError('EMPTY_RESPONSE', emptyReplyError, true, true);
              state.messages.push({ role: 'assistant', content: emptyReplyError, time: timeStr, errorCode: 'EMPTY_RESPONSE', retryable: true, retryMessage: ctx.originalMessage, retryBody: Object.assign({}, ctx.originalBody || body) });
              state.pendingOperations = [];
              cleanupStream();
              finalizeRequest(ctx, { error: emptyReplyError, errorCode: 'EMPTY_RESPONSE' });
              // showError rendered the terminal state into the streaming node.
              // Remove that transient node before rebuilding from state, or
              // an empty provider response produces duplicate assistant cards.
              discardStreamingMessageNode(assistantNode);
              renderChatPanel();
              clearStreamState();
              break;
            }

            finalizeNode();

            // Update state
            state.lastSentAttachmentPaths = state.attachments.filter(function (a) { return !a.pinned; }).map(function (a) { return a.path; });
            consumeTransientAttachments();
            state.lastFailedMessage = '';
            state.messages.push({
              role: 'assistant',
              content: completedReply,
              time: timeStr,
              operations: finalOperations,
              toolTrace: finalToolTrace,
              contextInfo: finalContextInfo,
              runtime: finalRuntime,
              usage: finalUsage
            });
            retainStreamingMessageNode(assistantNode, state.messages[state.messages.length - 1]);

            state.pendingOperations = attachPendingOpMetadata(ctx, finalOperations);
            if (finalContextInfo) {
              state.lastReadContext = finalContextInfo;
            }
            if (finalRuntime) {
              state.lastRuntime = finalRuntime;
            }
            state.lastToolTrace = finalToolTrace || [];

            cleanupStream();
            finalizeRequest(ctx, { done: true, usage: finalUsage });

            renderChatPanel();

            // Always reconcile the Diff surface, including the empty-array
            // case so a previous turn's operations cannot remain visible.
            renderDiffView();
            clearStreamState();
            break;
          case 'error':
            if (_doneHandled) return;
            _doneHandled = true;
            var errCode = (event.data && event.data.code) || 'INTERNAL_ERROR';
            var errMsg = (event.data && event.data.message) || '请求失败';
            var retryable = (event.data && event.data.retryable) === true;
            showError(errCode, errMsg, retryable);
              answerBuffer = '';
              var streamErrorContent = 'AI 请求失败，请稍后重试。';
              if (errCode === 'DOCUMENT_CONTEXT_MISSING') {
                streamErrorContent = '当前文档内容没有成功发送给 AI，请重新打开文档后重试。';
              } else if (errCode === 'INDEX_REBUILD_REQUIRED') {
                streamErrorContent = '项目索引尚未建立，但当前文档内容可用，您可以继续提问。';
              } else if (errCode === 'PROVIDER_TIMEOUT') {
                streamErrorContent = 'AI 请求超时，请稍后重试或简化问题。';
              } else if (errCode === 'STREAM_INTERRUPTED') {
                streamErrorContent = '连接中断，请检查网络后重试。';
              }
              state.messages.push({
                role: 'assistant',
                content: answerBuffer || ('抱歉，[' + errCode + '] ' + errMsg),
                time: timeStr,
                errorCode: errCode,
                retryable: retryable,
                retryMessage: ctx.originalMessage,
                retryBody: Object.assign({}, ctx.originalBody || body)
              });
              // Keep provider codes and raw diagnostics out of the visible
              // message; they remain available through errorCode/details.
              state.messages[state.messages.length - 1].content = streamErrorContent;
              cleanupStream();
              finalizeRequest(ctx, { error: errMsg, errorCode: errCode });
              // The streaming node already contains the error UI. Reconcile
              // from state with exactly one assistant message.
              discardStreamingMessageNode(assistantNode);
              renderChatPanel();
            break;
        }
      }

      function handleStreamCancelled() {
        if (ctx._finalized || streamCancelled) return;
        _doneHandled = true;
        streamCancelled = true;
        if (spinner) spinner.style.display = 'none';
        if (statusEl) statusEl.style.display = 'none';
        if (contentEl._streamRenderer) {
          try { contentEl._streamRenderer.stop(); } catch (e) {}
        }
        // Mark as stopped
        assistantNode.classList.remove('streaming');
        assistantNode.classList.add('cancelled');
        answerBuffer = '';
        setStreamStatus('已停止生成', 'cancelled', false);
        assistantNode.setAttribute('data-state', 'cancelled');
        if (contentEl && !String(answerBuffer || '').trim()) contentEl.textContent = '（已停止）';
        state.messages.push({
          role: 'assistant',
          content: answerBuffer || '（已停止）',
          time: timeStr,
          stopped: true
        });
        discardStreamingMessageNode(assistantNode);
        // Phase 3: Clear stream state on cancel — prevent auto-reconnect
        clearStreamState();
        cleanupStream();
        finalizeRequest(ctx, { cancelled: true, cancelReason: ctx.cancelReason || 'aborted' });
        renderChatPanel();
      }

      ctx.streamState = {
        getStreamId: function () { return streamId; },
        getLastEventId: function () { return lastEventId; },
        setStreamId: function (value) { streamId = value || null; ctx.streamId = streamId; },
        setLastEventId: function (value) { lastEventId = Number(value) || 0; ctx.lastEventId = lastEventId; },
        isDone: function () { return streamDone || ctx._finalized; },
        handleEvent: handleSSEEvent,
        fail: function (code, message, retryable) {
          handleSSEEvent({ type: 'error', data: { code: code, message: message, retryable: retryable !== false } });
        },
        cancel: handleStreamCancelled,
        setStatus: function (message) { if (statusText) statusText.textContent = message; }
      };

      if (responseJsonPromise) {
        return responseJsonPromise.then(function (data) {
          if (!isCurrentRequest(ctx) || ctx._finalized) return null;
          var jsonData = data || {};
          if (jsonData.stream_id) ctx.streamState.setStreamId(jsonData.stream_id);
          if (jsonData.last_event_id !== undefined) ctx.streamState.setLastEventId(jsonData.last_event_id);
          var replayEvents = Array.isArray(jsonData.events) ? jsonData.events : [];
          for (var eventIndex = 0; eventIndex < replayEvents.length; eventIndex++) {
            ctx.streamState.handleEvent(replayEvents[eventIndex]);
          }
          // The idempotency endpoint deliberately returns a compact JSON
          // envelope. Fetch the persisted event log from the beginning so a
          // completed duplicate can replay its terminal `done` event.
          if (jsonData.duplicate === true && jsonData.stream_id && !ctx.streamState.isDone()) {
            ctx.streamState.setLastEventId(0);
            resumeStream(ctx, jsonData.stream_id, 0);
            return null;
          }
          if (jsonData.status === 'completed' && !ctx.streamState.isDone()) {
            var replayReply = jsonData.reply || (jsonData.result && jsonData.result.reply) || '';
            if (String(replayReply || '').trim()) {
              ctx.streamState.handleEvent({ type: 'done', data: {
                reply: replayReply,
                operations: Array.isArray(jsonData.operations) ? jsonData.operations : [],
                usage: jsonData.usage || null
              } });
            } else {
              ctx.streamState.fail('RESUME_EMPTY', '恢复完成但没有可显示的 AI 回复', true);
            }
          } else if (jsonData.status === 'running' || jsonData.duplicate === true && jsonData.status === 'running') {
            if (jsonData.stream_id) {
              resumeStream(ctx, jsonData.stream_id, jsonData.last_event_id || ctx.streamState.getLastEventId());
            } else {
              ctx.streamState.fail('INVALID_STREAM_RESPONSE', 'AI 返回了无法恢复的流标识', true);
            }
          } else if (jsonData.status === 'failed') {
            ctx.streamState.fail('STREAM_FAILED', jsonData.error || '流式处理失败', true);
          } else if (jsonData.status === 'cancelled') {
            ctx.streamState.cancel();
          } else if (!ctx.streamState.isDone()) {
            ctx.streamState.fail('INVALID_STREAM_RESPONSE', 'AI 返回了无法恢复的响应', true);
          }
          return null;
        });
      }

      readStream();
    }).catch(function (err) {
      if (requestId !== state._requestId || wsGen !== state.workspaceGeneration) {
        cleanupStream();
        return;
      }
      cleanupStream();
      if (err && err.name === 'AbortError') {
        handleStreamCancelled();
        return;
      }
      var errMsg = (err && err.message) ? err.message : String(err);
      showError('NETWORK_ERROR', errMsg, true);
      state.messages.push({ role: 'assistant', content: '抱歉，' + errMsg, time: timeStr, errorCode: 'NETWORK_ERROR', retryable: true, retryMessage: ctx.originalMessage, retryBody: Object.assign({}, ctx.originalBody || body) });
      discardStreamingMessageNode(assistantNode);
      finalizeRequest(ctx, { error: errMsg, errorCode: 'NETWORK_ERROR' });
      renderChatPanel();
    });
  }

  // ── Phase 3: Stream resume function ────────────────────────────────────
  var STREAM_RECOVERY_RETRY_STATUSES = { 408: true, 429: true, 500: true, 502: true, 503: true, 504: true };

  function fetchStreamRecoveryJson(fetchFn, url, options, maxRetries) {
    var attempt = 0;
    var limit = Number.isFinite(Number(maxRetries)) ? Number(maxRetries) : 3;
    function delayFor(response) {
      var retryAfter = response && response.headers && response.headers.get && response.headers.get('Retry-After');
      var retryMs = Number(retryAfter) * 1000;
      if (!Number.isFinite(retryMs) || retryMs < 0) retryMs = 0;
      return Math.min(5000, Math.max(retryMs, 250 * Math.pow(2, attempt - 1)));
    }
    function run() {
      attempt += 1;
      return fetchFn(url, options).then(function(resp) {
        return resp.text().then(function(text) {
          var data = null;
          var parseFailed = false;
          try { data = text ? JSON.parse(text) : null; } catch (_) { parseFailed = true; data = null; }
          if (!resp.ok && STREAM_RECOVERY_RETRY_STATUSES[resp.status] && attempt <= limit) {
            return new Promise(function(resolve) { setTimeout(resolve, delayFor(resp)); }).then(run);
          }
          if (parseFailed || !data || typeof data !== 'object') {
            data = {
              ok: false,
              code: 'STREAM_RECOVERY_INVALID_RESPONSE',
              error: '流恢复接口返回了无效响应',
              retryable: !resp.ok
            };
          }
          if (data && typeof data === 'object') data.__httpStatus = resp.status;
          return data;
        });
      });
    }
    return run();
  }

  function resumeStream(ctx, streamId, afterEventId) {
    if (!ctx || !streamId || !isCurrentRequest(ctx)) return;
    var streamState = ctx.streamState;
    if (!streamState || typeof streamState.handleEvent !== 'function') {
      finalizeRequest(ctx, { error: '流恢复上下文不可用', errorCode: 'RESUME_CONTEXT_MISSING' });
      return;
    }

    var scope = getWorkspaceScope();
    var params = 'stream_id=' + encodeURIComponent(streamId) +
      '&after_event_id=' + afterEventId +
      '&workspace_id=' + encodeURIComponent(scope.workspace_id || '') +
      '&workspace_generation=' + (scope.workspace_generation || 0) +
      '&client_request_id=' + encodeURIComponent(ctx.clientRequestId || '');

    var resumeUrl = '/api/code/chat/stream/resume?' + params;

    var fetchFn = window.xtjProtectedFetch || fetch;
    fetchStreamRecoveryJson(fetchFn, resumeUrl, { credentials: 'include', signal: ctx.fetchSignal }, 3)
      .then(function(data) {
        if (!isCurrentRequest(ctx) || ctx._finalized) return;
        if (!data || data.ok === false) {
          console.error('[CODE-STREAM] Resume failed:', data);
          streamState.handleEvent({ type: 'error', data: { code: 'RESUME_FAILED', message: '流恢复失败', retryable: true } });
          return;
        }

        // Replay events
        var events = data.events || [];
        for (var i = 0; i < events.length; i++) {
          streamState.handleEvent(events[i]);
        }

        if (data.status === 'completed' && !streamState.isDone()) {
          var resumedReply = data.reply || (data.result && data.result.reply) || '';
          if (String(resumedReply || '').trim()) {
            streamState.handleEvent({ type: 'done', data: {
              reply: resumedReply,
              operations: Array.isArray(data.operations) ? data.operations : [],
              usage: data.usage || null
            }});
          } else {
            streamState.handleEvent({ type: 'error', data: {
              code: 'RESUME_EMPTY', message: '流恢复完成但没有有效回复', retryable: true
            }});
          }
        } else if (data.status === 'running') {
          // Still running — poll the same session without relying on the
          // original sendStreamingRequest lexical scope.
          streamState.setStatus('正在恢复中...');
          setTimeout(function() {
            if (!isCurrentRequest(ctx) || streamState.isDone()) return;
            resumeStream(ctx, streamId, streamState.getLastEventId());
          }, 2000);
        } else if (data.status === 'failed') {
          streamState.handleEvent({ type: 'error', data: { code: 'STREAM_FAILED', message: '流式处理失败', retryable: false } });
        } else if (data.status === 'cancelled') {
          streamState.cancel();
        }
      }).catch(function(err) {
        console.error('[CODE-STREAM] Resume error:', err);
        if (!isCurrentRequest(ctx) || ctx._finalized) return;
        streamState.handleEvent({ type: 'error', data: {
          code: 'RESUME_ERROR', message: (err && err.message) || '流恢复请求失败', retryable: true
        }});
      });
  }

  // ── Phase 3: Page refresh recovery — check for running streams ─────────
  function checkStreamRecovery() {
    if (!CODE_STREAM_RESUME_ENABLED) return;
    var savedState = getStreamState();
    if (!savedState) return;

    // Stale check — discard sessions older than 1 hour
    if (!savedState.startedAt || Date.now() - savedState.startedAt > 60 * 60 * 1000) {
      clearStreamState();
      return;
    }

    var scope = getWorkspaceScope();

    // Phase 1-P0-7: Precise context match — workspace + generation + conversation
    if (savedState.workspaceId && scope.workspace_id &&
        savedState.workspaceId !== scope.workspace_id) {
      return; // Different workspace — don't recover
    }
    if (savedState.workspaceGeneration && scope.workspace_generation &&
        savedState.workspaceGeneration !== scope.workspace_generation) {
      clearStreamState();
      return; // Generation changed — stale stream
    }
    if (savedState.conversationId && state.conversationId &&
        savedState.conversationId !== state.conversationId) {
      return; // Different conversation — don't recover
    }

    if (!savedState.streamId) {
      clearStreamState();
      return;
    }

    var fetchFn = window.xtjProtectedFetch || fetch;
    var statusParams = 'workspace_id=' + encodeURIComponent(scope.workspace_id || '') +
      '&workspace_generation=' + (scope.workspace_generation || 0);
    if (savedState.conversationId) {
      statusParams += '&conversation_id=' + encodeURIComponent(savedState.conversationId);
    }
    if (savedState.clientRequestId) {
      statusParams += '&client_request_id=' + encodeURIComponent(savedState.clientRequestId);
    }
    var statusUrl = '/api/code/chat/stream/status?' + statusParams;

    function reportRecoveryFailure(code, message, preserveState) {
      var originalMessage = String(savedState.originalMessage || '').trim();
      state.lastFailedMessage = originalMessage;
      state.messages.push({
        role: 'assistant',
        content: message || '上一次流式请求未能恢复，请重新生成。',
        time: '',
        errorCode: code || 'STREAM_RECOVERY_UNAVAILABLE',
        retryable: true,
        retryMessage: originalMessage,
        retryBody: null
      });
      if (preserveState !== false) {
        saveStreamState(Object.assign({}, getStreamState() || savedState));
      } else {
        clearStreamState();
      }
      if (_dom.chatPanel) renderChatPanel();
    }

    fetchStreamRecoveryJson(fetchFn, statusUrl, { credentials: 'include' }, 3)
      .then(function(data) {
        if (!data || data.ok === false) {
          reportRecoveryFailure(
            (data && data.code) || 'STREAM_RECOVERY_UNAVAILABLE',
            (data && data.error) || '无法检查上一次流式请求的状态，请重新生成。'
          );
          return;
        }

        var session = null;
        if (data.sessions && data.sessions.length > 0) {
          for (var i = 0; i < data.sessions.length; i++) {
            var s = data.sessions[i];
            if (savedState.clientRequestId && s.client_request_id &&
                s.client_request_id === savedState.clientRequestId) {
              session = s;
              break;
            }
          }
          if (!session) session = data.sessions[0];
        }

        if (!session) {
          recoverStreamFromResume(savedState, reportRecoveryFailure);
          return;
        }

        if (savedState.clientRequestId && session.client_request_id &&
            savedState.clientRequestId !== session.client_request_id) {
          clearStreamState();
          return;
        }

        console.log('[CODE-STREAM] Recovering stream:', session.stream_id, 'status:', session.status);
        recoverStreamFromResume(savedState, reportRecoveryFailure);
      }).catch(function() {
        reportRecoveryFailure(
          'STREAM_RECOVERY_UNAVAILABLE',
          '无法检查上一次流式请求的状态，请重新生成。'
        );
      });
  }

  // Phase 1-P0-6: Rebuild assistant node and resume from the resume endpoint.
  function recoverStreamFromResume(savedState, reportFailure) {
    var messagesContainer = document.getElementById('codeChatMessages');
    if (!messagesContainer) {
      clearStreamState();
      return;
    }

    var requestId = savedState.requestId || (++state._requestId);
    var timeStr = savedState.timeStr || new Date().toLocaleTimeString();
    var scope = getWorkspaceScope();
    var streamId = savedState.streamId;
    var lastEventId = savedState.lastEventId || 0;
    var answerBuffer = '';
    var streamDone = false;
    var abortController = new AbortController();

    var assistantNode = document.createElement('div');
    assistantNode.className = 'code-chat-message assistant streaming';
    assistantNode.id = 'codeStreamingNode_' + requestId;
    assistantNode.innerHTML =
      '<div class="msg-avatar">AI</div>' +
      '<div class="msg-body">' +
        '<div class="code-stream-status" data-state="connecting" role="status" aria-live="polite" aria-busy="true">' +
          '<span class="code-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="code-stream-status-text">正在恢复上一次会话...</span>' +
          '<span class="code-stream-spinner"></span>' +
        '</div>' +
        '<div class="code-stream-tools" style="display:none">' +
          '<div class="code-stream-tools-header" role="button" tabindex="0" aria-expanded="false">' +
            '<span class="code-stream-tools-toggle">&#9654; 工具执行记录</span>' +
          '</div>' +
          '<div class="code-stream-tools-list" role="list"></div>' +
        '</div>' +
        '<div class="msg-content markdown-body code-stream-content"></div>' +
        '<div class="code-stream-usage" style="display:none"></div>' +
        '<div class="code-stream-error" style="display:none"></div>' +
        '<div class="msg-time">' + escapeHTML(timeStr) + '</div>' +
      '</div>';
    messagesContainer.appendChild(assistantNode);
    scrollChatToBottom();

    var statusEl = assistantNode.querySelector('.code-stream-status');
    var statusText = assistantNode.querySelector('.code-stream-status-text');
    var spinner = assistantNode.querySelector('.code-stream-spinner');
    var contentEl = assistantNode.querySelector('.code-stream-content');
    var usageEl = assistantNode.querySelector('.code-stream-usage');
    var errorEl = assistantNode.querySelector('.code-stream-error');

    function recoveryDone(reply, operations, usage) {
      if (streamDone) return;
      streamDone = true;
      if (spinner) spinner.style.display = 'none';
      if (statusEl) statusEl.style.display = 'none';
      var finalContent = String(reply || answerBuffer || '').trim() || '未收到可显示回复，请重试。';
      contentEl.innerHTML = parseSimpleMarkdown(finalContent);
      if (usage && usageEl) {
        usageEl.style.display = '';
        var parts = [];
        if (usage.model) parts.push('模型: ' + escapeHTML(usage.model));
        if (usage.input_tokens) parts.push('输入: ' + usage.input_tokens.toLocaleString() + ' Token');
        if (usage.output_tokens) parts.push('输出: ' + usage.output_tokens.toLocaleString() + ' Token');
        usageEl.textContent = parts.join(' | ');
      }
      assistantNode.classList.remove('streaming');
      assistantNode.classList.add('completed');
      assistantNode.setAttribute('data-state', 'complete');
      state.messages.push({
        role: 'assistant',
        content: finalContent,
        time: timeStr,
        operations: operations || [],
        usage: usage || null
      });
      retainStreamingMessageNode(assistantNode, state.messages[state.messages.length - 1]);
      // A resumed stream has no original request context to safely attach
      // local file-operation metadata to. Keep the reply, but require a new
      // request before offering any write operation.
      // 保存恢复的操作作为只读 recoveredOperations（Diff 视图只读）
      state.recoveredOperations = (operations || []).slice();
      state.pendingOperations = [];
      clearStreamState();
      renderChatPanel();
      renderDiffView();
    }

    function recoveryError(code, message, retryable) {
      if (streamDone) return;
      streamDone = true;
      if (spinner) spinner.style.display = 'none';
      if (statusText) statusText.textContent = '恢复失败';
      assistantNode.classList.remove('streaming');
      assistantNode.classList.add('error-state');
      assistantNode.setAttribute('data-state', 'error');
      if (errorEl) {
        errorEl.style.display = '';
        errorEl.innerHTML =
          '<div class="code-stream-error-heading"><span>恢复失败</span>' +
          (code ? '<code>' + escapeHTML(code) + '</code>' : '') + '</div>' +
          '<div class="code-stream-error-msg">' + escapeHTML(message || '请求失败') + '</div>';
      }
      var originalMessage = String(savedState.originalMessage || '').trim();
      state.lastFailedMessage = originalMessage;
      state.messages.push({
        role: 'assistant',
        content: message || '上一次流式请求未能恢复，请重新生成。',
        time: timeStr,
        errorCode: code || 'STREAM_RECOVERY_FAILED',
        retryable: retryable !== false,
        retryMessage: originalMessage,
        retryBody: null
      });
      discardStreamingMessageNode(assistantNode);
      if (retryable === false) clearStreamState();
      else saveStreamState(Object.assign({}, getStreamState() || savedState, { lastEventId: lastEventId }));
      renderChatPanel();
    }

    function recoveryCancelled() {
      if (streamDone) return;
      streamDone = true;
      if (spinner) spinner.style.display = 'none';
      if (statusEl) statusEl.style.display = 'none';
      assistantNode.classList.remove('streaming');
      assistantNode.classList.add('cancelled');
      assistantNode.setAttribute('data-state', 'cancelled');
      contentEl.innerHTML = '<em>上一次请求已取消</em>';
      state.messages.push({
        role: 'assistant',
        content: '（已取消）',
        time: timeStr,
        errorCode: 'CANCELLED'
      });
      discardStreamingMessageNode(assistantNode);
      clearStreamState();
      renderChatPanel();
    }

    function processEvent(event) {
      if (streamDone) return;
      if (event.event_id && event.event_id > 0 && event.event_id <= lastEventId) return;
      if (event.event_id && event.event_id > 0) lastEventId = event.event_id;

      switch (event.type) {
        case 'accepted':
        case 'planning':
        case 'status':
          if (statusText) statusText.textContent = (event.data && event.data.message) || '正在恢复处理…';
          break;
        case 'answer_start':
          if (statusText) statusText.textContent = '正在生成回答…';
          break;
        case 'answer_delta':
          var delta = (event.data && event.data.delta) ? event.data.delta : '';
          if (delta) {
            answerBuffer += delta;
            if (statusEl) statusEl.style.display = 'none';
            contentEl.innerHTML = parseSimpleMarkdown(answerBuffer);
            scrollChatToBottom();
          }
          break;
        case 'done':
          recoveryDone(
            (event.data && event.data.reply) || '',
            (event.data && Array.isArray(event.data.operations)) ? event.data.operations : [],
            (event.data && event.data.usage) ? event.data.usage : null
          );
          break;
        case 'error':
          recoveryError(
            (event.data && event.data.code) || 'RECOVERY_ERROR',
            (event.data && event.data.message) || '恢复失败',
            (event.data && event.data.retryable) !== false
          );
          break;
      }
    }

    var resumeParams = 'stream_id=' + encodeURIComponent(streamId) +
      '&after_event_id=' + lastEventId +
      '&workspace_id=' + encodeURIComponent(scope.workspace_id || '') +
      '&workspace_generation=' + (scope.workspace_generation || 0) +
      '&client_request_id=' + encodeURIComponent(savedState.clientRequestId || '');
    var resumeUrl = '/api/code/chat/stream/resume?' + resumeParams;
    var fetchFn = window.xtjProtectedFetch || fetch;

    var resumePollCount = 0;
    var MAX_RESUME_POLLS = 150; // 5 minutes at the normal 2s interval

    function pollResume() {
      if (streamDone) return;
      resumePollCount += 1;
      if (resumePollCount > MAX_RESUME_POLLS) {
        recoveryError('RESUME_TIMEOUT', '流恢复等待超时，请重新生成', true);
        return;
      }
      fetchStreamRecoveryJson(fetchFn, resumeUrl, { credentials: 'include', signal: abortController.signal }, 3)
        .then(function(data) {
          if (streamDone) return;
          if (!data || data.ok === false) {
            recoveryError(
              (data && data.code) || 'RESUME_FAILED',
              (data && data.error) || '流恢复失败',
              (data && data.retryable) !== false
            );
            return;
          }
          var events = Array.isArray(data.events) ? data.events : [];
          for (var i = 0; i < events.length; i++) {
            processEvent(events[i]);
          }
          if (streamDone) return;

          if (data.status === 'completed') {
            var reply = data.reply || (data.result && data.result.reply) || '';
            if (String(reply || '').trim() || answerBuffer.trim()) {
              recoveryDone(
                reply || answerBuffer,
                Array.isArray(data.operations) ? data.operations : [],
                data.usage || null
              );
            } else {
              recoveryError('RESUME_EMPTY', '流恢复完成但没有有效回复', true);
            }
          } else if (data.status === 'failed') {
            recoveryError('STREAM_FAILED', data.error || '流式处理失败', false);
          } else if (data.status === 'cancelled') {
            recoveryCancelled();
          } else if (data.status === 'running') {
            if (statusText) statusText.textContent = '正在恢复中…';
            var updated = getStreamState() || savedState;
            updated.lastEventId = lastEventId;
            saveStreamState(updated);
            setTimeout(pollResume, 2000);
          }
        }).catch(function(err) {
          if (streamDone) return;
          if (err && err.name === 'AbortError') {
            recoveryCancelled();
            return;
          }
          recoveryError('RESUME_ERROR', (err && err.message) || '流恢复请求失败', true);
        });
    }

    pollResume();
  }

  function sendApiRequest(ctx, body, timeStr, indexRetry) {
    var signal = ctx.sharedCtrl ? ctx.sharedCtrl.signal : ctx.abortController.signal;
    ctx.fetchSignal = signal;
    var fetchFn = window.xtjProtectedFetch || fetch;

    function decodeCodeChatResponse(resp) {
      if (!resp.ok) {
        return resp.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (_) {}
          var error = new Error((json && json.error) || ('API 请求失败: ' + resp.status));
          error.code = (json && json.code) || (resp.status === 400 ? 'PROVIDER_HTTP_400' : (resp.status === 401 ? 'AUTH_REQUIRED' : (resp.status >= 500 ? ('PROVIDER_HTTP_' + resp.status) : 'CODE_REQUEST_FAILED')));
          if (resp.status === 400 && json && json.validation) error.code = 'VALIDATION_FAILED';
          error.retryable = json && json.retryable === true;
          error.requestId = json && json.requestId || '';
          error.toolTrace = json && json.tool_trace || null;
          throw error;
        });
      }
      return resp.json();
    }

    var timeoutPromise = new Promise(function (_, reject) {
      ctx.timeoutTimer = setTimeout(function () {
        if (ctx._finalized) return;
        ctx._timedOut = true;
        abortRequestTransport(ctx, 'timeout');
        reject(Object.assign(new Error('AI 请求超时，请重试'), { code: 'PROVIDER_TIMEOUT', retryable: true }));
      }, 90000);
    });

    var apiCall = Promise.resolve().then(function () {
      return fetchFn('/api/code/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal
      });
    });

    return Promise.race([apiCall.then(decodeCodeChatResponse), timeoutPromise]).then(function (data) {
      if (ctx.timeoutTimer) {
        clearTimeout(ctx.timeoutTimer);
        ctx.timeoutTimer = null;
      }
      if (!isCurrentRequest(ctx) || ctx._finalized) return null;
      var replyContent = String(data && data.reply || '').trim();
      if (!replyContent) {
        var emptyError = new Error('AI 未返回有效内容，请重新生成');
        emptyError.code = 'EMPTY_RESPONSE';
        emptyError.retryable = true;
        throw emptyError;
      }
      state.lastSentAttachmentPaths = state.attachments.filter(function (a) { return !a.pinned; }).map(function (a) { return a.path; });
      consumeTransientAttachments();
      state.lastFailedMessage = '';
      if (Array.isArray(data && data.operations)) {
        state.pendingOperations = attachPendingOpMetadata(ctx, data.operations);
      } else {
        state.pendingOperations = [];
      }
      if (data && data.context_info) state.lastReadContext = data.context_info;
      if (data && data.runtime) state.lastRuntime = data.runtime;
      state.lastToolTrace = data && Array.isArray(data.tool_trace) ? data.tool_trace : [];
      if (data && data.capabilities) state.capabilities = data.capabilities;
      state.messages.push({
        role: 'assistant', content: replyContent, time: timeStr,
        operations: state.pendingOperations,
        contextInfo: data && data.context_info || null,
        runtime: data && data.runtime || null,
        usage: data && data.usage || null
      });
      removeTypingIndicator();
      finalizeRequest(ctx, { done: true, usage: data && data.usage || null });
      renderProjectStatus();
      renderChatPanel();
      renderDiffView();
      return data;
    }).catch(function (err) {
      if (ctx.timeoutTimer) {
        clearTimeout(ctx.timeoutTimer);
        ctx.timeoutTimer = null;
      }
      if (!isCurrentRequest(ctx) || ctx._finalized) return null;
      if (ctx._timedOut) {
        err = Object.assign(new Error('AI 请求超时，请重试'), { code: 'PROVIDER_TIMEOUT', retryable: true });
      }
      if (err && err.name === 'AbortError') {
        removeTypingIndicator();
        state.messages.push({ role: 'assistant', content: '（已停止）', time: timeStr, stopped: true });
        finalizeRequest(ctx, { cancelled: true, cancelReason: ctx.cancelReason || 'aborted' });
        renderChatPanel();
        return null;
      }
      if (err && err.code === 'INDEX_REBUILD_REQUIRED' && !indexRetry) {
        state.projectIndexStatus = { indexed: false, building: true, phase: '索引已丢失，正在自动重建...' };
        renderProjectStatus();
        return buildProjectIndex().then(function (result) {
          if (!result || !state.projectIndexStatus || state.projectIndexStatus.indexed !== true) {
            throw Object.assign(new Error('索引重建失败，请点击“刷新索引”后重试'), { code: 'INDEX_REBUILD_FAILED' });
          }
          if (!isCurrentRequest(ctx)) return null;
          return sendApiRequest(ctx, body, timeStr, true);
        });
      }
      removeTypingIndicator();
      var errCode = err && err.code || 'CODE_REQUEST_FAILED';
      var errMsg = err && err.message || '抱歉，操作失败，请重试';
      var friendly = errMsg;
      if (window.XtjAiCore && window.XtjAiCore.Errors && window.XtjAiCore.Errors.formatUserMessage) {
        friendly = window.XtjAiCore.Errors.formatUserMessage(err);
      }
      var userFriendlyMsg = friendly;
      if (errCode === 'DOCUMENT_CONTEXT_MISSING') {
        friendly = '当前文档内容没有成功发送给 AI，请重新打开文档后重试。';
        userFriendlyMsg = friendly;
      } else if (errCode === 'INDEX_REBUILD_REQUIRED') {
        friendly = '项目索引尚未建立，但文档内容已可用。您可以继续提问，系统会使用文档正文回答。';
        userFriendlyMsg = friendly;
      }
      if (errCode === 'PROVIDER_HTTP_400' || errCode === 'PROVIDER_INVALID_REQUEST' || errCode === 'VALIDATION_FAILED') {
        restoreFailedMessage(body && body.message);
      }
      var assistantMsg = { role: 'assistant', content: userFriendlyMsg, time: timeStr, errorCode: errCode, retryable: err.retryable !== false, retryMessage: ctx.originalMessage || body.message || '', retryBody: Object.assign({}, ctx.originalBody || body || {}), requestId: err.requestId || '' };
      if (err && Array.isArray(err.toolTrace) && err.toolTrace.length) assistantMsg.toolTrace = err.toolTrace;
      state.messages.push(assistantMsg);
      finalizeRequest(ctx, { error: errMsg, errorCode: errCode });
      renderChatPanel();
      return null;
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

    if (m + n > DIFF_MAX_LINES || oldText.length + newText.length > DIFF_MAX_CHARS) {
      return [{ type: 'summary', text: '文件改动较大（原 ' + m + ' 行，新 ' + n + ' 行）。为保持页面流畅，已省略逐行 diff；可直接查看并应用修改。' }];
    }

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

    var hasPending = state.pendingOperations.length > 0;
    var hasRecovered = state.recoveredOperations && state.recoveredOperations.length > 0;
    var hasApplied = Object.keys(state.snapshots).length > 0;
    var hasDiffSurface = hasPending || hasRecovered || hasApplied;
    _dom.editorArea.classList.toggle('has-diff-view', hasDiffSurface);

    // Remove existing diff view and apply bar
    var existingDiff = document.getElementById('codeDiffView');
    if (existingDiff) existingDiff.remove();
    var existingApplyBar = document.getElementById('codeApplyBar');
    if (existingApplyBar) existingApplyBar.remove();

    var editorContainer = document.getElementById('codeEditorContainer');
    var previewArea = document.getElementById('codePreviewArea');

    if (!hasPending && !hasRecovered && !hasApplied) {
      // Nothing to show: restore editor view
      if (editorContainer) editorContainer.style.display = '';
      if (previewArea) previewArea.style.display = '';
      return;
    }

    // We have something to show: hide editor
    if (editorContainer) editorContainer.style.display = 'none';
    if (previewArea) previewArea.style.display = 'none';

    // Only render diff content if there are pending operations
    if (hasPending) {
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
        before.className = 'code-diff-before' + (op.type === 'document' ? ' code-diff-document' : '');
        before.style.overflow = 'auto';
        before.style.maxHeight = op.type === 'document' ? 'none' : '200px';
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
    }

    // 显示恢复的操作（只读 Diff 视图）
    if (hasRecovered) {
      var recoveredView = document.createElement('div');
      recoveredView.className = 'code-diff-view';
      recoveredView.id = 'codeRecoveredDiffView';

      var recoveredHeader = document.createElement('div');
      recoveredHeader.style.cssText = 'padding:10px 14px;font-size:12px;font-weight:600;color:var(--cw-text-muted);border-bottom:1px solid var(--cw-border);';
      recoveredHeader.textContent = '恢复的操作（只读）';
      recoveredView.appendChild(recoveredHeader);

      var recoveredBody = document.createElement('div');
      recoveredBody.className = 'code-diff-body stacked';

      for (var ri = 0; ri < state.recoveredOperations.length; ri++) {
        var rop = state.recoveredOperations[ri];

        var ropHeader = document.createElement('div');
        ropHeader.className = 'code-diff-header';
        ropHeader.innerHTML =
          '<span class="diff-file-path">' + escapeHTML(rop.path || '') + '</span>' +
          (rop.summary ? '<span class="diff-stats">' + escapeHTML(rop.summary) + '</span>' : '');
        recoveredBody.appendChild(ropHeader);

        var ropContent = document.createElement('div');
        ropContent.style.cssText = 'padding:12px 14px;font-size:13px;color:var(--cw-text-muted);';
        if (rop.type === 'document') {
          ropContent.textContent = '文档操作：' + (rop.document_operations ? rop.document_operations.length + ' 个操作' : '另存为新文件');
        } else if (rop.type === 'create') {
          ropContent.textContent = '创建新文件';
        } else {
          ropContent.textContent = '修改文件内容';
        }
        recoveredBody.appendChild(ropContent);
      }

      recoveredView.appendChild(recoveredBody);
      _dom.editorArea.appendChild(recoveredView);
    }

    if (!hasPending && !hasRecovered) {
      // Only applied changes (no pending): show a simple info panel
      var appliedPanel = document.createElement('div');
      appliedPanel.className = 'code-diff-view';
      appliedPanel.id = 'codeDiffView';
      appliedPanel.innerHTML =
        '<div style="padding:40px 20px;text-align:center;color:var(--cw-text-muted);">' +
        '<div style="font-size:14px;margin-bottom:8px;">已应用 ' + Object.keys(state.snapshots).length + ' 个文件修改</div>' +
        '<div style="font-size:12px;">可使用下方"回滚修改"按钮撤销</div>' +
        '</div>';
      _dom.editorArea.appendChild(appliedPanel);
    }

    // Apply bar - dynamically build based on state (hasPending/hasApplied already declared above)
    var applyBar = document.createElement('div');
    applyBar.className = 'code-apply-bar';
    applyBar.id = 'codeApplyBar';

    // Build info text
    var infoParts = [];
    if (hasPending) {
      infoParts.push(state.pendingOperations.length + ' 个文件待应用');
    }
    if (hasRecovered) {
      infoParts.push(state.recoveredOperations.length + ' 个恢复的操作（只读）');
    }
    if (hasApplied) {
      infoParts.push(Object.keys(state.snapshots).length + ' 个文件已修改');
    }
    var infoText = infoParts.join(' · ');

    // Build actions (always include buttons, replaceChildren for read-only)
    var actionsHtml = '<div class="apply-actions">';
    if (hasPending) {
      actionsHtml += '<button class="code-btn code-btn-ghost" id="codeDiscardBtn">放弃建议</button>';
    }
    if (hasApplied) {
      actionsHtml += '<button class="code-btn code-btn-ghost" id="codeUndoBtn">回滚修改</button>';
    }
    if (hasPending) {
      actionsHtml += '<button class="code-btn code-btn-primary" id="codeApplyAllBtn">全部应用</button>';
    }
    actionsHtml += '</div>';

    applyBar.innerHTML =
      '<span class="apply-info">' + escapeHTML(infoText) + '</span>' +
      actionsHtml;

    _dom.editorArea.appendChild(applyBar);

    // Read-only workspaces: replace write controls with read-only label
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
    var discardBtn = document.getElementById('codeDiscardBtn');
    var undoBtn = document.getElementById('codeUndoBtn');

    if (applyBtn && !applyBtn._diffBound) {
      applyBtn._diffBound = true;
      applyBtn.addEventListener('click', applyAllOperations);
    }
    if (discardBtn && !discardBtn._diffBound) {
      discardBtn._diffBound = true;
      discardBtn.addEventListener('click', discardPendingOperations);
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
    var createdSnapshotForApply = false;
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
  // validateOperation(op)
  // 验证操作是否仍然有效：检查 workspace generation、路径、SHA、snapshot
  // ──────────────────────────────────────────────
  function validateOperation(op) {
    if (!op || !op.path) {
      return { valid: false, reason: '无效操作' };
    }

    // 1. 检查 workspace generation 是否匹配
    if (typeof op._workspaceGeneration === 'number' &&
        op._workspaceGeneration !== state.workspaceGeneration) {
      return { valid: false, reason: '操作已过期（工作区已切换）' };
    }

    // 2. 检查路径是否存在（create 操作要求路径不存在，其他操作要求路径存在）
    var fs = window.__xtjCodeFS;
    if (!fs || !fs.fileExistsByPath) {
      return { valid: false, reason: '文件系统不可用' };
    }

    // 路径存在性检查通过 fileExistsByPath，但这是一个异步操作，
    // 在 applyOperation 中异步调用。这里先做同步可检查的部分。

    // 3. 检查 SHA 是否匹配（如果操作有 expected_sha256）
    // 同步检查：如果 snapshot 已有记录，可以快速验证
    if (op.expected_sha256) {
      var snapshot = state.snapshots[op.path];
      if (snapshot && snapshot.beforeSha256 && snapshot.beforeSha256 !== op.expected_sha256) {
        return { valid: false, reason: '文件 "' + op.path + '" 的 SHA 不匹配，内容可能已被修改' };
      }
    }

    // 4. 检查 snapshot 是否新鲜
    if (state.snapshots[op.path]) {
      var existingSnapshot = state.snapshots[op.path];
      // 如果 snapshot 的 afterSha256 已经存在且操作类型不是 create，说明已应用过
      if (op.type !== 'create' && existingSnapshot.afterSha256) {
        return { valid: false, reason: '文件 "' + op.path + '" 的修改已被应用过' };
      }
    }

    return { valid: true };
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

    // P2: Stale diff guard — reject operations that belong to a different
    // workspace generation or conversation than the current session. The SHA
    // check below only verifies file *content*; this guard verifies
    // operation *ownership*. Without it, a stale op from a previous
    // workspace (same path, same SHA) could be silently applied to the new
    // workspace after the user switches.
    if (typeof op._workspaceGeneration === 'number' &&
        op._workspaceGeneration !== state.workspaceGeneration) {
      return Promise.reject(new Error('操作已过期（工作区已切换），请重新生成'));
    }
    if (op._conversationId && op._conversationId !== state.conversationId) {
      return Promise.reject(new Error('操作已过期（会话已切换），请重新生成'));
    }

    // P0: 通过 validateOperation 进行完整验证
    var validation = validateOperation(op);
    if (!validation.valid) {
      showToast('操作验证失败: ' + validation.reason, 'error');
      return Promise.reject(new Error(validation.reason));
    }

    // P2: Capture generation at apply start; re-check inside every async
    // continuation to abort mid-flight if the user switches workspace while
    // readFileByPath / writeFileByPath are in flight.
    var applyWsGen = state.workspaceGeneration;
    function assertGenerationUnchanged() {
      if (applyWsGen !== state.workspaceGeneration) {
        throw new Error('工作区已切换，操作中止');
      }
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
        assertGenerationUnchanged();
        if (exists) {
          throw new Error('目标文件已存在');
        }
        return fs.createFileByPath(op.path, op.new_content || '');
      }).then(function (writeResult) {
        assertGenerationUnchanged();
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
            state.openTabs[i]._contentVersion = 0;
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
      assertGenerationUnchanged();
      if (!result) {
        throw new Error('无法读取文件: ' + op.path);
      }

      // P0-7: 文件存在未保存编辑时，AI 生成回复时看到的是该未保存内容（_currentContent），
      // 而非磁盘内容。若直接以磁盘内容为基准应用，行号会错位，且写入会静默覆盖未保存编辑。
      // 此处以未保存内容为基准并请求显式确认：确认后合并写入（未保存内容不丢失），
      // 取消则放弃本次应用，未保存内容原样保留。
      var currentText = result.type === 'text' ? result.content : '';
      var usingUnsavedBase = false;
      var openTabForOp = null;
      for (var t = 0; t < state.openTabs.length; t++) {
        if (state.openTabs[t].path === op.path) { openTabForOp = state.openTabs[t]; break; }
      }
      if (op._requestContentVersion !== undefined && openTabForOp &&
          Number(openTabForOp._contentVersion || 0) !== Number(op._requestContentVersion)) {
        throw new Error('文件 "' + op.path + '" 在生成完成后又被编辑，请重新生成后再应用。');
      }
      var unsavedContent = (openTabForOp && typeof openTabForOp._currentContent === 'string') ? openTabForOp._currentContent : null;
      if (unsavedContent !== null && unsavedContent !== currentText) {
        if (!window.confirm('文件 "' + op.path + '" 存在未保存的修改。\n\nAI 回复基于包含这些修改的内容生成。\n继续应用会把 AI 修改与未保存修改合并写入文件，未保存内容不会被丢弃。\n\n取消则不应用此操作，未保存修改保持不变。')) {
          throw new Error('已取消应用：文件 "' + op.path + '" 存在未保存修改');
        }
        currentText = unsavedContent;
        usingUnsavedBase = true;
      }

      // Strict SHA-256 validation for replace_range
      if (op.type === 'replace_range') {
        if (!op.expected_sha256) {
          throw new Error('replace_range 操作缺少 expected_sha256，拒绝执行');
        }
        if (!op.start_line || !op.end_line) {
          throw new Error('replace_range 操作缺少 start_line 或 end_line，拒绝执行');
        }
        if (!usingUnsavedBase && result.sha256 !== op.expected_sha256) {
          throw new Error('文件 "' + op.path + '" 已被修改（SHA 不匹配），与 AI 生成回复时的内容不一致。请重新生成。');
        }
      } else if (op.expected_sha256 && !usingUnsavedBase && result.sha256 !== op.expected_sha256) {
        throw new Error('文件 "' + op.path + '" 已被修改，与 AI 生成回复时的内容不一致。请重新生成。');
      }

      // Take snapshot of current content BEFORE writing
      if (!state.snapshots[op.path]) {
        createdSnapshotForApply = true;
        state.snapshots[op.path] = {
          existed: true,
          beforeContent: currentText,
          beforeSha256: usingUnsavedBase ? '' : (result.sha256 || '')
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
      assertGenerationUnchanged();
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
      assertGenerationUnchanged();
      // Update open tab if file is open
      var finalContent = op._final_written_content || op.new_content || '';
      for (var i = 0; i < state.openTabs.length; i++) {
        if (state.openTabs[i].path === op.path) {
          state.openTabs[i].content = finalContent;
          state.openTabs[i].sha256 = writeResult.sha256 || '';
          state.openTabs[i].modified = false;
          state.openTabs[i]._currentContent = undefined;
          state.openTabs[i]._contentVersion = 0;
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
      // Do not leave an undo snapshot behind when validation or writing fails.
      // A snapshot is only meaningful after the write has completed.
      if (createdSnapshotForApply) {
        delete state.snapshots[op.path];
      }
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
  // discardPendingOperations()
  // 放弃所有未应用的 AI 建议（pendingOperations），不影响已应用的修改
  // ──────────────────────────────────────────────
  function discardPendingOperations() {
    if (state.pendingOperations.length === 0 && (!state.recoveredOperations || state.recoveredOperations.length === 0)) {
      showToast('没有待放弃的建议', 'info');
      return;
    }
    var count = state.pendingOperations.length + (state.recoveredOperations ? state.recoveredOperations.length : 0);
    state.pendingOperations = [];
    state.recoveredOperations = [];
    renderDiffView();
    renderTabs();
    if (state.activePath) {
      renderEditor();
    }
    showToast('已放弃 ' + count + ' 个待应用的修改建议', 'info');
  }

  // ──────────────────────────────────────────────
  // undoOperations()
  // 回滚所有已应用的修改（基于 snapshots），不影响未应用的建议
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
                  state.openTabs[j]._contentVersion = 0;
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

    var target = e.target;
    var inCodeEditor = !!(target && target.closest && target.closest('#panelCode .code-editor-container, #panelCode .monaco-editor'));
    if (!inCodeEditor) return;

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
    renderTabs: renderTabs,
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
      renderTabs: renderTabs,
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
