(function () {
  'use strict';

  if (window.__xtjCodeFS) return;

  // ──────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────
  var DB_NAME = 'xtj_code_workspace';
  var STORE_NAME = 'handles';
  var HANDLE_KEY = 'last_workspace';

  var SKIP_DIRS = [
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.next',
    '.DS_Store'
  ];

  var SIZE_LIMITS = {
    text: 2 * 1024 * 1024,
    image: 15 * 1024 * 1024,
    pdf: 50 * 1024 * 1024,
    binary: 10 * 1024 * 1024,
    document: 50 * 1024 * 1024
  };

  var TEXT_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.html', '.htm', '.css', '.scss', '.less', '.sass',
    '.json', '.jsonc', '.json5',
    '.md', '.mdx', '.markdown', '.rst', '.tex',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.m', '.mm',
    '.xml', '.svg', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.env', '.env.local', '.env.development', '.env.production',
    '.sh', '.bat', '.ps1', '.psm1', '.cmd', '.bash', '.zsh', '.fish',
    '.sql', '.txt', '.log', '.csv', '.tsv', '.properties',
    '.vue', '.svelte', '.astro',
    '.gitignore', '.dockerignore', '.editorconfig', '.npmrc',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yaml',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yaml',
    '.babelrc', '.browserslistrc', '.stylelintrc',
    '.graphql', '.gql',
    '.php', '.r', '.lua', '.dart', '.scala', '.clj', '.cljs', '.ex', '.exs',
    '.elm', '.hs', '.erl', '.jl', '.nim', '.zig', '.v', '.fs', '.fsx'
  ];

  var IMAGE_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
    '.avif', '.heic', '.heif', '.tiff', '.tif'
  ];

  var PDF_EXTENSIONS = ['.pdf'];

  var DOCUMENT_EXTENSIONS = [
    '.docx', '.xlsx', '.xls', '.pptx'
  ];

    var DOCUMENT_MIME_MAP = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };

  // ──────────────────────────────────────────────
  // Internal state
  // ──────────────────────────────────────────────
  var _dirHandle = null;
  var _objectUrls = [];
  var _fileLocks = {};

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────
  function lowerExt(name) {
    var dot = name.lastIndexOf('.');
    if (dot === -1 || dot === name.length - 1) return '';
    return name.slice(dot).toLowerCase();
  }

  function isTextExtension(name) {
    var ext = lowerExt(name);
    return TEXT_EXTENSIONS.indexOf(ext) !== -1;
  }

  function isImageExtension(name) {
    var ext = lowerExt(name);
    return IMAGE_EXTENSIONS.indexOf(ext) !== -1;
  }

  function isPdfExtension(name) {
    var ext = lowerExt(name);
    return PDF_EXTENSIONS.indexOf(ext) !== -1;
  }

  function isDocumentExtension(name) {
    var ext = lowerExt(name);
    return DOCUMENT_EXTENSIONS.indexOf(ext) !== -1;
  }

  function getDocumentMimeType(name) {
    var ext = lowerExt(name);
    return DOCUMENT_MIME_MAP[ext] || 'application/octet-stream';
  }

  function shouldSkip(name) {
    return SKIP_DIRS.indexOf(name) !== -1;
  }

  function wrapError(err, context) {
    var message = (err && err.message) ? err.message : String(err);
    var e = new Error('[' + context + '] ' + message);
    if (err && err.stack) {
      e.stack = err.stack;
    }
    return e;
  }

  // ──────────────────────────────────────────────
  // IndexedDB
  // ──────────────────────────────────────────────
  var _dbConnection = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      try {
        // 关闭旧连接
        if (_dbConnection) {
          try { _dbConnection.close(); } catch (e) {}
          _dbConnection = null;
        }

        var resolved = false;
        // P0: IndexedDB 打开超时 (3 秒)
        var timeoutId = setTimeout(function () {
          if (!resolved) {
            resolved = true;
            console.error('[CODE-IDB] Open timeout after 3s');
            reject(new Error('[IndexedDB.open] Timeout'));
          }
        }, 3000);

        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          // P1: 超时后连接才到达，关闭迟到连接防止泄漏
          if (resolved) {
            try { db.close(); } catch (_) {}
            return;
          }
          resolved = true;
          clearTimeout(timeoutId);
          _dbConnection = db;
          // 监听 versionchange，当其他页面升级数据库时主动关闭
          db.onversionchange = function () {
            console.log('[CODE-IDB] Database version change detected, closing connection');
            db.close();
            _dbConnection = null;
          };
          resolve(db);
        };
        req.onerror = function (e) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          var err = e.target.error;
          console.error('[CODE-IDB] Open error:', err && err.message ? err.message : String(err));
          reject(wrapError(err, 'IndexedDB.open'));
        };
        req.onblocked = function (e) {
          console.warn('[CODE-IDB] Database open blocked by another connection');
          // 尝试关闭旧连接后重试
          if (_dbConnection) {
            try { _dbConnection.close(); } catch (ex) {}
            _dbConnection = null;
          }
          // 不直接 reject，让 onerror 或 onsuccess 处理
        };
      } catch (err) {
        console.error('[CODE-IDB] Open exception:', err && err.message ? err.message : String(err));
        reject(wrapError(err, 'IndexedDB.open'));
      }
    });
  }

  function storeHandle(dirHandle) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          var req = store.put(dirHandle, HANDLE_KEY);
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) {
            db.close();
            reject(wrapError(e.target.error, 'IndexedDB.storeHandle'));
          };
          tx.oncomplete = function () { db.close(); };
        } catch (err) {
          db.close();
          reject(wrapError(err, 'IndexedDB.storeHandle'));
        }
      });
    });
  }

  function restoreHandle() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var req = store.get(HANDLE_KEY);
          req.onsuccess = function () {
            var dirHandle = req.result;
            db.close();
            resolve(dirHandle || null);
          };
          req.onerror = function (e) {
            db.close();
            reject(wrapError(e.target.error, 'IndexedDB.restoreHandle'));
          };
        } catch (err) {
          db.close();
          reject(wrapError(err, 'IndexedDB.restoreHandle'));
        }
      });
    });
  }

  // ──────────────────────────────────────────────
  // SHA-256
  // ──────────────────────────────────────────────
  function sha256ToHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length === 1) h = '0' + h;
      hex += h;
    }
    return hex;
  }

  function getSHA256(input) {
    var buffer;
    if (typeof input === 'string') {
      var encoder = new TextEncoder();
      buffer = encoder.encode(input);
    } else if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
      buffer = input;
    } else {
      return Promise.reject(new Error('getSHA256: input must be a string, ArrayBuffer, or Uint8Array'));
    }
    return crypto.subtle.digest('SHA-256', buffer).then(function (hash) {
      return sha256ToHex(hash);
    });
  }

  // ──────────────────────────────────────────────
  // Object URL management
  // ──────────────────────────────────────────────
  function trackUrl(url) {
    _objectUrls.push(url);
    return url;
  }

  function revokeUrl(url) {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      // ignore
    }
    var idx = _objectUrls.indexOf(url);
    if (idx !== -1) {
      _objectUrls.splice(idx, 1);
    }
  }

  function revokeAllUrls() {
    var urls = _objectUrls.slice();
    for (var i = 0; i < urls.length; i++) {
      try {
        URL.revokeObjectURL(urls[i]);
      } catch (e) {
        // ignore
      }
    }
    _objectUrls = [];
  }

  // ──────────────────────────────────────────────
  // Path validation
  // ──────────────────────────────────────────────
  function normalizePath(path) {
    if (typeof path !== 'string') {
      throw new Error('normalizePath: path must be a string');
    }
    // Normalize backslashes to forward slashes
    var normalized = path.replace(/\\/g, '/');
    // Remove leading and trailing slashes
    normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, '/');
    return normalized;
  }

  function validatePath(path) {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new Error('validatePath: path must be a non-empty string');
    }
    // Reject absolute paths
    if (/^[a-zA-Z]:[\\/]/.test(path)) {
      throw new Error('validatePath: absolute Windows paths are not allowed: ' + path);
    }
    if (/^\//.test(path)) {
      throw new Error('validatePath: absolute Unix paths are not allowed: ' + path);
    }
    // Normalize and check for path traversal
    var normalized = normalizePath(path);
    var parts = normalized.split('/');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..' || parts[i] === '.') {
        throw new Error('validatePath: path traversal is not allowed: ' + path);
      }
      if (parts[i] === '') {
        throw new Error('validatePath: empty path segment is not allowed: ' + path);
      }
    }
    if (parts.length === 0) {
      throw new Error('validatePath: path resolves to empty: ' + path);
    }
    return parts;
  }

  // ──────────────────────────────────────────────
  // File type detection
  // ──────────────────────────────────────────────
  function getFileType(fileName) {
    if (isTextExtension(fileName)) return 'text';
    if (isImageExtension(fileName)) return 'image';
    if (isPdfExtension(fileName)) return 'pdf';
    if (isDocumentExtension(fileName)) return 'document';
    return 'binary';
  }

  // ──────────────────────────────────────────────
  // Directory operations
  // ──────────────────────────────────────────────
  function selectDirectory() {
    try {
      return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (handle) {
        // P0: 立即使用获得的句柄，不等 IndexedDB
        _dirHandle = handle;

        // P0: 保存恢复记录失败，不能阻止当前工作区使用
        return storeHandle(handle).catch(function (err) {
          console.warn('[CODE-IDB] 无法保存工作区恢复记录:', err);
        }).then(function () {
          return handle;
        });
      }).catch(function (err) {
        if (err && err.name === 'AbortError') {
          // User cancelled - not an error
          return null;
        }
        throw wrapError(err, 'selectDirectory');
      });
    } catch (err) {
      return Promise.reject(wrapError(err, 'selectDirectory'));
    }
  }

  function getWorkspaceName() {
    if (!_dirHandle) return null;
    return _dirHandle.name;
  }

  function restoreWorkspace(options) {
    // 带超时的恢复，最多等待 5 秒
    return new Promise(function (resolve) {
      var resolved = false;
      var timeoutId = setTimeout(function () {
        if (!resolved) {
          resolved = true;
          console.warn('[CODE-IDB] restoreWorkspace timed out');
          resolve({ status: 'timeout', handle: null, error: 'IndexedDB operation timed out' });
        }
      }, 5000);

      restoreHandle().then(function (handle) {
        if (resolved) return;
        if (!handle) {
          resolved = true;
          clearTimeout(timeoutId);
          return resolve({ status: 'missing', handle: null });
        }

        return handle.queryPermission({ mode: 'readwrite' }).then(function (permission) {
          if (resolved) return;
          if (permission === 'granted') {
            _dirHandle = handle;
            resolved = true;
            clearTimeout(timeoutId);
            return resolve({ status: 'granted', handle: handle });
          }

          if (permission === 'prompt' && options && options.requestPermission) {
            return handle.requestPermission({ mode: 'readwrite' }).then(function (result) {
              if (resolved) return;
              resolved = true;
              clearTimeout(timeoutId);
              if (result === 'granted') {
                _dirHandle = handle;
                return resolve({ status: 'granted', handle: handle });
              }
              return resolve({ status: 'denied', handle: handle });
            });
          }

          resolved = true;
          clearTimeout(timeoutId);
          return resolve({
            status: permission === 'denied' ? 'denied' : 'prompt',
            handle: handle
          });
        }).catch(function (err) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          console.error('[CODE-IDB] Permission query error:', err && err.message ? err.message : String(err));
          return resolve({ status: 'error', handle: handle, error: err && err.message ? err.message : String(err) });
        });
      }).catch(function (err) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        console.error('[CODE-IDB] restoreHandle error:', err && err.message ? err.message : String(err));
        return resolve({ status: 'error', handle: null, error: err && err.message ? err.message : String(err) });
      });
    });
  }

  function clearWorkspaceRecord() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          var req = store.delete(HANDLE_KEY);
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) {
            db.close();
            reject(wrapError(e.target.error, 'IndexedDB.clearWorkspaceRecord'));
          };
          tx.oncomplete = function () { db.close(); };
        } catch (err) {
          db.close();
          reject(wrapError(err, 'IndexedDB.clearWorkspaceRecord'));
        }
      });
    }).then(function () {
      try { localStorage.removeItem('xtj_code_workspace_name'); } catch (e) { /* ignore */ }
    });
  }

  function clearWorkspaceStorage() {
    console.log('[CODE-IDB] Clearing workspace storage');
    // 关闭当前连接
    if (_dbConnection) {
      try { _dbConnection.close(); } catch (e) {}
      _dbConnection = null;
    }
    _dirHandle = null;
    // 清理 localStorage
    try { localStorage.removeItem('xtj_code_workspace_name'); } catch (e) {}
    // 删除 IndexedDB 数据库
    return new Promise(function (resolve) {
      try {
        var delReq = indexedDB.deleteDatabase(DB_NAME);
        delReq.onsuccess = function () {
          console.log('[CODE-IDB] Database deleted successfully');
          resolve({ ok: true });
        };
        delReq.onerror = function (e) {
          var errMsg = e && e.target && e.target.error ? e.target.error.message : 'unknown';
          console.warn('[CODE-IDB] Database delete error:', errMsg);
          resolve({ ok: false, blocked: false, error: errMsg });
        };
        delReq.onblocked = function () {
          console.warn('[CODE-IDB] Database delete blocked');
          // P1: 不能当作成功，返回明确状态
          resolve({
            ok: false,
            blocked: true,
            error: '数据库正在被其他页面占用，请关闭其他 XTJ 页面后重试'
          });
        };
      } catch (e) {
        console.warn('[CODE-IDB] deleteDatabase error:', e && e.message ? e.message : String(e));
        resolve({ ok: false, blocked: false, error: e && e.message ? e.message : String(e) });
      }
    });
  }

  // ──────────────────────────────────────────────
  // File tree (lazy loading)
  // ──────────────────────────────────────────────
  function buildFileTree(dirHandle, depth) {
    if (depth === undefined) depth = 0;
    return new Promise(function (resolve, reject) {
      try {
        var entries = [];
        // Children are intentionally left empty for lazy loading
        resolve({
          name: dirHandle.name,
          kind: 'directory',
          handle: dirHandle,
          children: entries
        });
      } catch (err) {
        reject(wrapError(err, 'buildFileTree'));
      }
    });
  }

  function expandDirectory(dirHandle) {
    return new Promise(function (resolve, reject) {
      try {
        var children = [];
        var pending = [];
        var reader;

        // Try to get an async iterator; fallback to entries() + manual iteration
        try {
          // Use for-await via manual promise chain because we're in ES5-style
          var iterateEntries = function (dir) {
            return new Promise(function (res, rej) {
              var items = [];
              var it;
              try {
                it = dir.values();
              } catch (e) {
                // Fallback: use entries() which returns an async iterable
                // Some browsers only support the older .entries() method
                try {
                  it = dir.entries();
                } catch (e2) {
                  rej(e2);
                  return;
                }
              }

              function pump() {
                it.next().then(function (result) {
                  if (result.done) {
                    res(items);
                  } else {
                    var handle;
                    // entries() returns [name, handle], values() returns handle
                    if (Array.isArray(result.value)) {
                      handle = result.value[1];
                    } else {
                      handle = result.value;
                    }
                    items.push(handle);
                    pump();
                  }
                }).catch(function (err) {
                  rej(err);
                });
              }
              pump();
            });
          };

          iterateEntries(dirHandle).then(function (handles) {
            for (var i = 0; i < handles.length; i++) {
              var handle = handles[i];
              if (handle.kind === 'directory' && shouldSkip(handle.name)) {
                continue;
              }
              children.push({
                name: handle.name,
                kind: handle.kind,
                handle: handle,
                children: handle.kind === 'directory' ? [] : undefined
              });
            }
            // Sort: directories first, then alphabetically by name
            children.sort(function (a, b) {
              if (a.kind === 'directory' && b.kind !== 'directory') return -1;
              if (a.kind !== 'directory' && b.kind === 'directory') return 1;
              return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
            resolve(children);
          }).catch(function (err) {
            reject(wrapError(err, 'expandDirectory'));
          });
        } catch (err) {
          reject(wrapError(err, 'expandDirectory'));
        }
      } catch (err) {
        reject(wrapError(err, 'expandDirectory'));
      }
    });
  }

  // ──────────────────────────────────────────────
  // File reading
  // ──────────────────────────────────────────────
  function readFile(fileHandle) {
    return new Promise(function (resolve, reject) {
      try {
        var fileName = fileHandle.name;
        var fileType = getFileType(fileName);

        fileHandle.getFile().then(function (file) {
          // Check size limits
          var limit = SIZE_LIMITS[fileType];
          if (limit && file.size > limit) {
            var limitMB = (limit / (1024 * 1024)).toFixed(1);
            reject(new Error(
              'readFile: file "' + fileName + '" (' + (file.size / 1024).toFixed(1) + ' KB) ' +
              'exceeds ' + fileType + ' size limit of ' + limitMB + ' MB'
            ));
            return;
          }

          if (fileType === 'text') {
            file.text().then(function (content) {
              return getSHA256(content).then(function (sha256) {
                resolve({
                  content: content,
                  sha256: sha256,
                  size: file.size,
                  type: fileType,
                  name: fileName
                });
              });
            }).catch(function (err) {
              reject(wrapError(err, 'readFile.text'));
            });
          } else if (fileType === 'image' || fileType === 'pdf') {
            file.arrayBuffer().then(function (buffer) {
              var blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
              var blobUrl = URL.createObjectURL(blob);
              trackUrl(blobUrl);
              return getSHA256(buffer).then(function (sha256) {
                resolve({
                  content: blobUrl,
                  sha256: sha256,
                  size: file.size,
                  type: fileType,
                  name: fileName,
                  mimeType: file.type || 'application/octet-stream',
                  _arrayBuffer: buffer
                });
              });
            }).catch(function (err) {
              reject(wrapError(err, 'readFile.arrayBuffer'));
            });
          } else if (fileType === 'document') {
            file.arrayBuffer().then(function (buffer) {
              return getSHA256(buffer).then(function (sha256) {
                resolve({
                  content: buffer,
                  sha256: sha256,
                  size: file.size,
                  type: fileType,
                  name: fileName,
                  mimeType: file.type || getDocumentMimeType(fileName),
                  _arrayBuffer: buffer
                });
              });
            }).catch(function (err) {
              reject(wrapError(err, 'readFile.document'));
            });
          } else {
            // binary
            file.arrayBuffer().then(function (buffer) {
              return getSHA256(buffer).then(function (sha256) {
                resolve({
                  content: null,
                  sha256: sha256,
                  size: file.size,
                  type: fileType,
                  name: fileName
                });
              });
            }).catch(function (err) {
              reject(wrapError(err, 'readFile.binary'));
            });
          }
        }).catch(function (err) {
          reject(wrapError(err, 'readFile.getFile'));
        });
      } catch (err) {
        reject(wrapError(err, 'readFile'));
      }
    });
  }

  function readFileByPath(pathParts) {
    if (!_dirHandle) {
      return Promise.reject(new Error('readFileByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (parts.length === 0) {
      return Promise.reject(new Error('readFileByPath: path must contain at least a file name'));
    }

    return new Promise(function (resolve, reject) {
      try {
        var current = _dirHandle;
        var index = 0;

        function traverse() {
          if (index >= parts.length - 1) {
            // Last part is the file
            current.getFileHandle(parts[index]).then(function (fileHandle) {
              return readFile(fileHandle);
            }).then(resolve).catch(function (err) {
              reject(wrapError(err, 'readFileByPath'));
            });
            return;
          }
          current.getDirectoryHandle(parts[index]).then(function (dirHandle) {
            current = dirHandle;
            index++;
            traverse();
          }).catch(function (err) {
            reject(wrapError(err, 'readFileByPath'));
          });
        }
        traverse();
      } catch (err) {
        reject(wrapError(err, 'readFileByPath'));
      }
    });
  }

  // ──────────────────────────────────────────────
  // File writing
  // ──────────────────────────────────────────────
  function writeFile(fileHandle, content) {
    if (typeof content !== 'string') {
      return Promise.reject(new Error('writeFile: content must be a string'));
    }

    return new Promise(function (resolve, reject) {
      try {
        var originalSHA256 = null;

        // Compute SHA-256 of original content
        getSHA256(content).then(function (sha) {
          originalSHA256 = sha;

          // Create writable
          return fileHandle.createWritable();
        }).then(function (writable) {
          return writable.write(content).then(function () {
            return writable.close();
          });
        }).then(function () {
          // Re-read and verify
          return readFile(fileHandle);
        }).then(function (result) {
          if (result.sha256 !== originalSHA256) {
            reject(new Error(
              'writeFile: verification failed - SHA-256 mismatch. ' +
              'Expected: ' + originalSHA256 + ', Got: ' + result.sha256
            ));
            return;
          }
          resolve({
            name: result.name,
            size: result.size,
            sha256: result.sha256,
            type: result.type
          });
        }).catch(function (err) {
          reject(wrapError(err, 'writeFile'));
        });
      } catch (err) {
        reject(wrapError(err, 'writeFile'));
      }
    });
  }

  function writeFileByPath(pathParts, content) {
    if (!_dirHandle) {
      return Promise.reject(new Error('writeFileByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (parts.length === 0) {
      return Promise.reject(new Error('writeFileByPath: path must contain at least a file name'));
    }
    if (typeof content !== 'string') {
      return Promise.reject(new Error('writeFileByPath: content must be a string'));
    }

    return new Promise(function (resolve, reject) {
      try {
        var current = _dirHandle;
        var index = 0;

        function traverse() {
          if (index >= parts.length - 1) {
            // Last part is the file - get or create
            current.getFileHandle(parts[index], { create: true }).then(function (fileHandle) {
              return writeFile(fileHandle, content);
            }).then(resolve).catch(function (err) {
              reject(wrapError(err, 'writeFileByPath'));
            });
            return;
          }
          // Ensure intermediate directories exist
          current.getDirectoryHandle(parts[index], { create: true }).then(function (dirHandle) {
            current = dirHandle;
            index++;
            traverse();
          }).catch(function (err) {
            reject(wrapError(err, 'writeFileByPath'));
          });
        }
        traverse();
      } catch (err) {
        reject(wrapError(err, 'writeFileByPath'));
      }
    });
  }

  // ──────────────────────────────────────────────
  // Document text extraction (calls backend API)
  // ──────────────────────────────────────────────
  function readDocumentText(arrayBuffer, fileName, mimeType) {
    if (!arrayBuffer && !(arrayBuffer instanceof ArrayBuffer)) {
      return Promise.reject(new Error('readDocumentText: arrayBuffer is required'));
    }
    if (!mimeType) {
      mimeType = getDocumentMimeType(fileName || '');
    }

    var formData = new FormData();
    var blob = new Blob([arrayBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('fileName', fileName || '');
    formData.append('mimeType', mimeType);

    var apiCall;
    if (window.xtjProtectedFetch) {
      apiCall = window.xtjProtectedFetch('/api/code/document/extract', {
        method: 'POST',
        body: formData
      });
    } else {
      apiCall = fetch('/api/code/document/extract', {
        method: 'POST',
        credentials: 'include',
        
        body: formData
      });
    }

    return apiCall.then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) {}
          var msg = (data && data.error) ? data.error : text || ('文档提取失败: ' + resp.status);
          throw new Error(msg);
        });
      }
      return resp.json();
    }).then(function (data) {
      if (!data.ok) {
        throw new Error(data.error || '文档提取失败');
      }
      return {
        text: data.text || '',
        truncated: !!data.truncated,
        textLength: data.textLength || 0,
        metadata: data.metadata || {},
        fileName: data.fileName || fileName,
        mimeType: data.mimeType || mimeType,
        ext: data.ext || ''
      };
    });
  }

  // ──────────────────────────────────────────────
  // File existence check (no content read)
  // ──────────────────────────────────────────────
  function fileExistsByPath(pathParts) {
    if (!_dirHandle) {
      return Promise.reject(new Error('fileExistsByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (parts.length === 0) {
      return Promise.reject(new Error('fileExistsByPath: path must contain at least a file name'));
    }

    return new Promise(function (resolve, reject) {
      try {
        var current = _dirHandle;
        var index = 0;

        function traverse() {
          if (index >= parts.length - 1) {
            // Check if file exists using getFileHandle without create
            current.getFileHandle(parts[index]).then(function () {
              resolve(true);
            }).catch(function (err) {
              // Only NotFoundError means the file does NOT exist
              if (err && err.name === 'NotFoundError') {
                resolve(false);
              } else {
                // SecurityError, NotAllowedError, TypeMismatchError,
                // AbortError, UnknownError, etc. must be propagated
                reject(wrapError(err, 'fileExistsByPath'));
              }
            });
            return;
          }
          current.getDirectoryHandle(parts[index]).then(function (dirHandle) {
            current = dirHandle;
            index++;
            traverse();
          }).catch(function (err) {
            if (err && err.name === 'NotFoundError') {
              // Intermediate directory doesn't exist, so file can't exist
              resolve(false);
            } else {
              reject(wrapError(err, 'fileExistsByPath'));
            }
          });
        }
        traverse();
      } catch (err) {
        reject(wrapError(err, 'fileExistsByPath'));
      }
    });
  }

  // ──────────────────────────────────────────────
  // Safe file creation (never overwrites)
  // ──────────────────────────────────────────────
  function createFileByPath(pathParts, content) {
    if (!_dirHandle) {
      return Promise.reject(new Error('createFileByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (parts.length === 0) {
      return Promise.reject(new Error('createFileByPath: path must contain at least a file name'));
    }
    if (typeof content !== 'string') {
      return Promise.reject(new Error('createFileByPath: content must be a string'));
    }

    var fullPath = parts.join('/');
    if (_fileLocks[fullPath]) {
      return Promise.reject(new Error('createFileByPath: file "' + fullPath + '" is currently being created'));
    }
    _fileLocks[fullPath] = true;

    // First check that the file does NOT exist
    return fileExistsByPath(parts).then(function (exists) {
      if (exists) {
        delete _fileLocks[fullPath];
        return Promise.reject(new Error('createFileByPath: file "' + fullPath + '" already exists'));
      }

      // File does not exist — safe to create with { create: true }
      return new Promise(function (resolve, reject) {
        try {
          var current = _dirHandle;
          var index = 0;

          function traverse() {
            if (index >= parts.length - 1) {
              // Create the file
              current.getFileHandle(parts[index], { create: true }).then(function (fileHandle) {
                return writeFile(fileHandle, content);
              }).then(function(res) {
                delete _fileLocks[fullPath];
                resolve(res);
              }).catch(function (err) {
                delete _fileLocks[fullPath];
                reject(wrapError(err, 'createFileByPath'));
              });
              return;
            }
            // Ensure intermediate directories exist
            current.getDirectoryHandle(parts[index], { create: true }).then(function (dirHandle) {
              current = dirHandle;
              index++;
              traverse();
            }).catch(function (err) {
              reject(wrapError(err, 'createFileByPath'));
            });
          }
          traverse();
        } catch (err) {
          delete _fileLocks[fullPath];
          reject(wrapError(err, 'createFileByPath'));
        }
      });
    }).catch(function(err) {
      delete _fileLocks[fullPath];
      return Promise.reject(err);
    });
  }

  // ──────────────────────────────────────────────
  // File deletion
  // ──────────────────────────────────────────────
  function deleteFileByPath(pathParts) {
    if (!_dirHandle) {
      return Promise.reject(new Error('deleteFileByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (parts.length === 0) {
      return Promise.reject(new Error('deleteFileByPath: path must contain at least a file name'));
    }

    return new Promise(function (resolve, reject) {
      try {
        var current = _dirHandle;
        var index = 0;

        function traverse() {
          if (index >= parts.length - 1) {
            // Remove the file
            current.removeEntry(parts[index]).then(function () {
              resolve(true);
            }).catch(function (err) {
              reject(wrapError(err, 'deleteFileByPath'));
            });
            return;
          }
          current.getDirectoryHandle(parts[index]).then(function (dirHandle) {
            current = dirHandle;
            index++;
            traverse();
          }).catch(function (err) {
            reject(wrapError(err, 'deleteFileByPath'));
          });
        }
        traverse();
      } catch (err) {
        reject(wrapError(err, 'deleteFileByPath'));
      }
    });
  }

  // ──────────────────────────────────────────────
  // List all files recursively (for workspace overview)
  // ──────────────────────────────────────────────
  function listAllFiles(maxDepth, maxFiles) {
    if (!_dirHandle) {
      return Promise.reject(new Error('listAllFiles: no workspace selected'));
    }
    maxDepth = maxDepth || 5;
    maxFiles = maxFiles || 200;

    var allFiles = [];
    var allDirs = [];

    function scanDir(dirHandle, currentPath, depth) {
      if (depth > maxDepth || allFiles.length >= maxFiles) {
        return Promise.resolve();
      }

      return new Promise(function (res, rej) {
        var items = [];
        var it;
        try {
          it = dirHandle.values();
        } catch (e) {
          try { it = dirHandle.entries(); } catch (e2) { res(); return; }
        }

        function pump() {
          it.next().then(function (result) {
            if (result.done) {
              var promises = [];
              for (var i = 0; i < items.length; i++) {
                var handle = items[i];
                var entryPath = currentPath ? currentPath + '/' + handle.name : handle.name;
                if (handle.kind === 'directory') {
                  if (!shouldSkip(handle.name)) {
                    allDirs.push({ path: entryPath, name: handle.name });
                    if (depth < maxDepth) {
                      promises.push(scanDir(handle, entryPath, depth + 1));
                    }
                  }
                } else {
                  var fileType = getFileType(handle.name);
                  allFiles.push({
                    path: entryPath,
                    name: handle.name,
                    type: fileType,
                    size: 0
                  });
                  if (allFiles.length >= maxFiles) break;
                }
              }
              Promise.all(promises).then(function() { res(); }).catch(rej);
            } else {
              var handle;
              if (Array.isArray(result.value)) handle = result.value[1];
              else handle = result.value;
              items.push(handle);
              pump();
            }
          }).catch(function (err) {
            rej(err);
          });
        }
        pump();
      });
    }

    return scanDir(_dirHandle, '', 0).then(function () {
      return {
        files: allFiles.slice(0, maxFiles),
        directories: allDirs,
        totalCount: allFiles.length,
        truncated: allFiles.length >= maxFiles
      };
    });
  }

  // ──────────────────────────────────────────────
  // Binary file writing (for document operations)
  // ──────────────────────────────────────────────
  function writeBinaryFile(fileHandle, buffer) {
    if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof Blob)) {
      return Promise.reject(new Error('writeBinaryFile: content must be ArrayBuffer or Blob'));
    }

    return new Promise(function (resolve, reject) {
      try {
        var originalSHA256 = null;

        getSHA256(buffer).then(function (sha) {
          originalSHA256 = sha;
          return fileHandle.createWritable();
        }).then(function (writable) {
          return writable.write(buffer).then(function () {
            return writable.close();
          });
        }).then(function () {
          return readFile(fileHandle);
        }).then(function (result) {
          if (result.sha256 !== originalSHA256) {
            reject(new Error('writeBinaryFile: verification failed - SHA-256 mismatch'));
            return;
          }
          resolve({
            name: result.name,
            size: result.size,
            sha256: result.sha256,
            type: result.type
          });
        }).catch(function (err) {
          reject(wrapError(err, 'writeBinaryFile'));
        });
      } catch (err) {
        reject(wrapError(err, 'writeBinaryFile'));
      }
    });
  }

  function writeBinaryFileByPath(pathParts, buffer) {
    if (!_dirHandle) {
      return Promise.reject(new Error('writeBinaryFileByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (!parts) {
      return Promise.reject(new Error('writeBinaryFileByPath: invalid path'));
    }

    return new Promise(function (resolve, reject) {
      var current = _dirHandle;
      var index = 0;
      function traverse() {
        if (index === parts.length - 1) {
          current.getFileHandle(parts[index], { create: true }).then(function (fileHandle) {
            return writeBinaryFile(fileHandle, buffer);
          }).then(function (result) {
            resolve(result);
          }).catch(function (err) {
            reject(wrapError(err, 'writeBinaryFileByPath'));
          });
          return;
        }
        current.getDirectoryHandle(parts[index]).then(function (dirHandle) {
          current = dirHandle;
          index++;
          traverse();
        }).catch(function (err) {
          reject(wrapError(err, 'writeBinaryFileByPath'));
        });
      }
      traverse();
    });
  }

  function createBinaryFileByPath(pathParts, buffer) {
    if (!_dirHandle) {
      return Promise.reject(new Error('createBinaryFileByPath: no workspace selected'));
    }
    var parts = Array.isArray(pathParts) ? pathParts : validatePath(pathParts);
    if (!parts) {
      return Promise.reject(new Error('createBinaryFileByPath: invalid path'));
    }
    if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof Blob)) {
      return Promise.reject(new Error('createBinaryFileByPath: content must be ArrayBuffer or Blob'));
    }

    return new Promise(function (resolve, reject) {
      fileExistsByPath(parts).then(function (exists) {
        if (exists) {
          reject(new Error('File already exists: ' + parts.join('/')));
          return;
        }
        return writeBinaryFileByPath(parts, buffer);
      }).then(function (result) {
        if (result) resolve(result);
      }).catch(function (err) {
        reject(wrapError(err, 'createBinaryFileByPath'));
      });
    });
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────
  window.__xtjCodeFS = {
    // Constants
    SKIP_DIRS: SKIP_DIRS,
    SIZE_LIMITS: SIZE_LIMITS,
    TEXT_EXTENSIONS: TEXT_EXTENSIONS,
    IMAGE_EXTENSIONS: IMAGE_EXTENSIONS,
    PDF_EXTENSIONS: PDF_EXTENSIONS,
    DOCUMENT_EXTENSIONS: DOCUMENT_EXTENSIONS,
    DOCUMENT_MIME_MAP: DOCUMENT_MIME_MAP,

    // Directory operations
    selectDirectory: selectDirectory,
    getWorkspaceName: getWorkspaceName,
    restoreWorkspace: restoreWorkspace,
    getDirHandle: function () { return _dirHandle; },
    setDirHandle: function (handle) { _dirHandle = handle; },

    // File tree
    buildFileTree: buildFileTree,
    expandDirectory: expandDirectory,
    listAllFiles: listAllFiles,

    // File reading
    getFileType: getFileType,
    readFile: readFile,
    readFileByPath: readFileByPath,
    isTextExtension: isTextExtension,
    isImageExtension: isImageExtension,

    // Document extraction
    readDocumentText: readDocumentText,
    getDocumentMimeType: getDocumentMimeType,
    isDocumentExtension: isDocumentExtension,

    // File existence check
    fileExistsByPath: fileExistsByPath,

    // File writing
    writeFile: writeFile,
    writeFileByPath: writeFileByPath,
    writeBinaryFile: writeBinaryFile,
    writeBinaryFileByPath: writeBinaryFileByPath,

    // Safe file creation
    createFileByPath: createFileByPath,
    createBinaryFileByPath: createBinaryFileByPath,

    // File deletion
    deleteFileByPath: deleteFileByPath,

    // Path utilities
    validatePath: validatePath,
    normalizePath: normalizePath,

    // SHA-256
    getSHA256: getSHA256,
    sha256ToHex: sha256ToHex,

    // Object URL management
    revokeUrl: revokeUrl,
    revokeAllUrls: revokeAllUrls,

    // IndexedDB
    _storeHandle: storeHandle,
    _restoreHandle: restoreHandle,
    clearWorkspaceRecord: clearWorkspaceRecord,
    clearWorkspaceStorage: clearWorkspaceStorage
  };

})();