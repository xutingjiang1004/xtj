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
    text: 1 * 1024 * 1024,      // 1 MB
    image: 15 * 1024 * 1024,    // 15 MB
    pdf: 30 * 1024 * 1024,      // 30 MB
    binary: 5 * 1024 * 1024     // 5 MB
  };

  var TEXT_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.html', '.htm', '.css', '.scss', '.less',
    '.json', '.jsonc', '.json5',
    '.md', '.mdx', '.markdown',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
    '.xml', '.svg', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.env', '.env.local', '.env.development', '.env.production',
    '.sh', '.bat', '.ps1', '.psm1',
    '.sql', '.txt', '.log', '.csv', '.tsv',
    '.vue', '.svelte', '.astro',
    '.gitignore', '.dockerignore', '.editorconfig',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yaml',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yaml',
    '.babelrc', '.browserslistrc', '.stylelintrc',
    '.graphql', '.gql',
    '.php', '.r', '.lua', '.dart', '.scala', '.clj', '.cljs', '.ex', '.exs',
    '.elm', '.hs', '.erl', '.jl', '.nim', '.zig', '.v', '.fs', '.fsx'
  ];

  var IMAGE_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'
  ];

  var PDF_EXTENSIONS = ['.pdf'];

  // ──────────────────────────────────────────────
  // Internal state
  // ──────────────────────────────────────────────
  var _dirHandle = null;
  var _objectUrls = [];

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
  function openDB() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = function (e) {
          resolve(e.target.result);
        };
        req.onerror = function (e) {
          reject(wrapError(e.target.error, 'IndexedDB.open'));
        };
      } catch (err) {
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
            if (!dirHandle) {
              db.close();
              resolve(null);
              return;
            }
            // Verify readwrite permission
            dirHandle.queryPermission({ mode: 'readwrite' }).then(function (state) {
              db.close();
              if (state === 'granted') {
                resolve(dirHandle);
              } else {
                resolve(null);
              }
            }).catch(function () {
              db.close();
              resolve(null);
            });
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
    return 'binary';
  }

  // ──────────────────────────────────────────────
  // Directory operations
  // ──────────────────────────────────────────────
  function selectDirectory() {
    try {
      return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (handle) {
        return storeHandle(handle).then(function () {
          _dirHandle = handle;
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

  function restoreWorkspace() {
    return restoreHandle().then(function (handle) {
      _dirHandle = handle;
      return handle;
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
                  mimeType: file.type || 'application/octet-stream'
                });
              });
            }).catch(function (err) {
              reject(wrapError(err, 'readFile.arrayBuffer'));
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
  // Public API
  // ──────────────────────────────────────────────
  window.__xtjCodeFS = {
    // Constants
    SKIP_DIRS: SKIP_DIRS,
    SIZE_LIMITS: SIZE_LIMITS,
    TEXT_EXTENSIONS: TEXT_EXTENSIONS,
    IMAGE_EXTENSIONS: IMAGE_EXTENSIONS,
    PDF_EXTENSIONS: PDF_EXTENSIONS,

    // Directory operations
    selectDirectory: selectDirectory,
    getWorkspaceName: getWorkspaceName,
    restoreWorkspace: restoreWorkspace,
    getDirHandle: function () { return _dirHandle; },

    // File tree
    buildFileTree: buildFileTree,
    expandDirectory: expandDirectory,

    // File reading
    getFileType: getFileType,
    readFile: readFile,
    readFileByPath: readFileByPath,

    // File existence check
    fileExistsByPath: fileExistsByPath,

    // File writing
    writeFile: writeFile,
    writeFileByPath: writeFileByPath,

    // Safe file creation
    createFileByPath: createFileByPath,

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
    _restoreHandle: restoreHandle
  };

})();