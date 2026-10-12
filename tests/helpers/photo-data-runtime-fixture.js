'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dataSource = fs.readFileSync(path.resolve(__dirname, '../../js/photo-wall/data.js'), 'utf8');

function createPhotoDataRuntime(fetchImpl) {
  const storage = new Map();
  const windowListeners = {};
  const documentListeners = {};
  const window = {
    API_BASE: '',
    currentUser: 'owner',
    photoWallData: [],
    pwCurrentSortedPhotos: [],
    addEventListener(type, handler) { windowListeners[type] = handler; },
    getUserAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
    safeStorage: {
      get: key => storage.has(key) ? storage.get(key) : null,
      set: (key, value) => storage.set(key, String(value)),
      remove: key => storage.delete(key)
    }
  };
  const context = {
    window,
    document: {
      hidden: false,
      getElementById: () => null,
      addEventListener(type, handler) { documentListeners[type] = handler; },
      querySelector: () => null
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    navigator: { onLine: true },
    fetch: fetchImpl,
    URL,
    Map,
    Set,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Date
  };
  vm.runInNewContext(dataSource, context, { filename: 'data.js' });
  return { window, storage, windowListeners, documentListeners, context };
}

module.exports = { createPhotoDataRuntime };
