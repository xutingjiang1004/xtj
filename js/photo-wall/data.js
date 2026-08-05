(function(){
  'use strict';

  var MARKER = '__photo_wall__';
  var CACHE_KEY = 'xtj_photos';
  var DELETED_KEY = 'xtj_photos_deleted';
  var SYNC_KEY = 'xtj_photo_sync_data';
  var PAGE_SIZE = 60;

  window.PHOTO_WALL_MARKER = window.PHOTO_WALL_MARKER || MARKER;
  window.photoWallData = Array.isArray(window.photoWallData) ? window.photoWallData : [];
  window.pwCurrentSortedPhotos = Array.isArray(window.pwCurrentSortedPhotos) ? window.pwCurrentSortedPhotos : [];

  var page = 0;
  var more = true;
  var firstPageLoaded = false;
  var loading = false;
  var realtimeChannel = null;
  var bc = null;
  // P4: 拆分缓存时间戳 — TTL 只依据 lastSuccessfulLoadedAt，
  // lastAttemptAt 每次尝试都更新，lastFailureAt 仅失败时更新。
  var lastSuccessfulLoadedAt = 0;
  var lastAttemptAt = 0;
  var lastFailureAt = 0;
  var LOAD_CACHE_TTL_MS = 20000;
  var photoLoadGeneration = 0;
  var activePhotoLoadController = null;
  var loadMoreController = null;
  var loadMorePromise = null;
  // P5: 分页绑定状态 — 按 page 跟踪 requestId、AbortController、generation
  var _fetchPhotoPageState = {};
  var pendingDeletedPhotoIds = new Set();

  function byId(id){ return document.getElementById(id); }

  function toast(message){
    if (typeof window.showToast === 'function') window.showToast(message);
    else console.log('[PhotoWall]', message);
  }

  function readJson(key, fallback){
    try {
      var raw = window.safeStorage.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value){
    try { window.safeStorage.set(key, JSON.stringify(value)); } catch (_) {}
  }

  function getDeletedIds(){
    var list = readJson(DELETED_KEY, []);
    return Array.isArray(list) ? list.map(String) : [];
  }

  function addDeletedPhotoId(id){
    if (id == null) return;
    var list = getDeletedIds();
    var key = String(id);
    if (list.indexOf(key) < 0) {
      list.push(key);
      writeJson(DELETED_KEY, list.slice(-500));
    }
  }

  function addPendingDeletedPhotoId(id){
    if (id != null) pendingDeletedPhotoIds.add(String(id));
  }

  function removePendingDeletedPhotoId(id){
    if (id != null) pendingDeletedPhotoIds.delete(String(id));
  }

  function isDeletedOrPendingPhoto(item){
    if (item == null) return false;
    var id = typeof item === 'object' ? item.id : item;
    var cloudId = typeof item === 'object' ? item.cloudId : null;
    if (id == null && cloudId == null) return false;
    var deleted = getDeletedIds();
    var idStr = id != null ? String(id) : null;
    var cloudIdStr = cloudId != null ? String(cloudId) : null;
    return (idStr != null && deleted.indexOf(idStr) >= 0) ||
      (cloudIdStr != null && deleted.indexOf(cloudIdStr) >= 0) ||
      (idStr != null && pendingDeletedPhotoIds.has(idStr)) ||
      (cloudIdStr != null && pendingDeletedPhotoIds.has(cloudIdStr));
  }

  function setPhotoWallSyncStatus(state, label){
    var wrap = byId('pwSyncStatus');
    var text = byId('pwSyncLabel');
    if (!wrap || !text) return;
    wrap.classList.remove('is-idle', 'is-synced', 'is-syncing', 'is-offline', 'is-error');
    wrap.classList.add('is-' + (state || 'idle'));
    text.textContent = label || '已同步';
  }

  function saveLocalPhotoWallData(){
    var list = (Array.isArray(window.photoWallData) ? window.photoWallData : [])
      .filter(function(item){
        return item && item.imageUrl && item.imageUrl.indexOf('data:') !== 0 && item.mediaKind !== 'video' && !/^video\//i.test(item.mimeType || '');
      })
      .slice(0, 180);
    writeJson(CACHE_KEY, list);
  }

  function loadLocalPhotoWallData(){
    var list = readJson(CACHE_KEY, []);
    return Array.isArray(list) ? list.filter(function(item){
      return item && item.id && item.imageUrl && item.mediaKind !== 'video' && !/^video\//i.test(item.mimeType || '');
    }) : [];
  }

  function parseContent(raw){
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function isPhotoWallVideoMeta(meta, mime){
    var kind = String(meta && (meta.mediaKind || meta.kind) || '').toLowerCase();
    var type = String(mime || meta && meta.mimeType || '').toLowerCase();
    return kind === 'video' || /^video\//.test(type);
  }

  function normalizePhotoWallRow(row){
    row = row || {};
    var meta = parseContent(row.content);
    // 软删除标记：保留 imageUrl（管理端可见缩略图），前端 RLS 过滤 is_deleted
    if (row.is_deleted === true || row.media_url === '__deleted__' || meta.__pw_del__ === true) {
      return { id: row.id, cloudId: row.id, imageUrl: null, deleted: true, is_deleted: true };
    }
    var url = row.media_url || meta.imageUrl || meta.url || '';
    var mime = meta.mimeType || row.mime_type || '';
    if (isPhotoWallVideoMeta(meta, mime)) {
      return {
        id: row.id || meta.id || ('filtered_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
        cloudId: row.id || meta.cloudId || null,
        imageUrl: null,
        mediaKind: 'video',
        mimeType: mime,
        filtered: true,
        content: row.content || ''
      };
    }
    return {
      id: row.id || meta.id || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
      cloudId: row.id || meta.cloudId || null,
      username: row.user_name || meta.username || '未知用户',
      imageUrl: url,
      thumbUrl: meta.thumb || meta.thumbUrl || '',
      thumb: meta.thumb || meta.thumbUrl || '',
      mediaKind: 'image',
      mimeType: mime,
      duration: meta.duration || null,
      timestamp: row.created_at ? Date.parse(row.created_at) : (meta.timestamp || Date.now()),
      created_at: row.created_at || meta.created_at || null,
      views: typeof row.views === 'number' ? row.views : (Number(meta.views || 0) || 0),
      actor_key: row.actor_key || meta.actor_key || window.deviceId || '',
      fileSize: meta.fileSize || null,
      originalSize: meta.originalSize || null,
      exif: meta.exif || null,
      content: row.content || ''
    };
  }

  function mergePhotoLists(primary, fallback){
    var deleted = getDeletedIds();
    var map = new Map();
    function add(item){
      if (!item || !item.id || !item.imageUrl || item.imageUrl === '__deleted__') return;
      if (item.mediaKind === 'video' || /^video\//i.test(item.mimeType || '')) return;
      // A hard delete may reach Realtime/BroadcastChannel before a CDN or API
      // snapshot has converged. Tombstones must therefore reject stale cloud
      // rows as well as cached rows; UUIDs are never reused for uploads.
      var identity = item.cloudId != null ? String(item.cloudId) : String(item.id);
      if (deleted.indexOf(identity) >= 0 || deleted.indexOf(String(item.id)) >= 0 || isDeletedOrPendingPhoto(item)) return;
      if (!map.has(String(item.id))) map.set(String(item.id), item);
    }
    (Array.isArray(primary) ? primary : []).forEach(add);
    (Array.isArray(fallback) ? fallback : []).forEach(add);
    return Array.from(map.values()).sort(function(a, b){ return (b.timestamp || 0) - (a.timestamp || 0); });
  }

  function createPhotoAbortError(){
    var error = new Error('photo page request aborted');
    error.name = 'AbortError';
    return error;
  }

  function abortPhotoPageRequests(){
    if (activePhotoLoadController) {
      try { activePhotoLoadController.abort(); } catch (e) {}
    }
    if (loadMoreController) {
      try { loadMoreController.abort(); } catch (e) {}
    }
    Object.keys(_fetchPhotoPageState).forEach(function(key){
      var state = _fetchPhotoPageState[key];
      if (state && state.controller) {
        try { state.controller.abort(); } catch (e) {}
      }
    });
  }

  async function fetchPhotoPage(pageIndex, timeoutMs, externalSignal, requestId, requestGeneration){
    var page = pageIndex;
    var limit = PAGE_SIZE;
    // P5: 分页绑定 — 管理每个 page 的请求
    var stateKey = 'page_' + page;
    var prevState = _fetchPhotoPageState[stateKey];
    if (requestId && prevState && prevState.requestId !== requestId) {
      // 新请求不同 requestId，中止旧请求
      if (prevState.controller) {
        try { prevState.controller.abort(); } catch (e) {}
      }
    }
    var requestState = null;
    if (requestId) {
      requestState = { requestId: requestId, controller: null, generation: (prevState ? prevState.generation + 1 : 1) };
      _fetchPhotoPageState[stateKey] = requestState;
    }
    var currentGen = requestState ? requestState.generation : 0;

    var controller = new AbortController();
    if (requestId) {
      requestState.controller = controller;
    }
    var timeout = timeoutMs || 10000;
    var timer = setTimeout(function() { controller.abort(); }, timeout);
    var onAbort = function() { controller.abort(); };
    function isCurrentRequest(){
      var stateIsCurrent = !requestState || (_fetchPhotoPageState[stateKey] === requestState && requestState.generation === currentGen);
      var loadIsCurrent = requestGeneration == null || requestGeneration === photoLoadGeneration;
      return stateIsCurrent && loadIsCurrent && !controller.signal.aborted;
    }
    try {
      if (externalSignal) {
        if (externalSignal.aborted) throw createPhotoAbortError();
        externalSignal.addEventListener('abort', onAbort);
      }
      var resp = await fetch((window.API_BASE || '') + '/api/photos/public?page=' + page + '&limit=' + limit, { signal: controller.signal });
      // P5: 如果 generation 已变化（被新请求替代），丢弃结果
      if (!isCurrentRequest()) throw createPhotoAbortError();
      var result = await resp.json();
      // 响应体解析期间也可能发生 force refresh，旧结果不得再返回给调用方。
      if (!isCurrentRequest()) throw createPhotoAbortError();
      if (!resp.ok || !result.ok) throw new Error(result.error || 'fetch failed');
      return result.data || [];
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      if (requestState && _fetchPhotoPageState[stateKey] === requestState) {
        requestState.controller = null;
      }
    }
  }

  async function loadPhotoWallData(force){
    if (loading && !force) return window.photoWallData;
    // P4: 缓存 TTL 只依据 lastSuccessfulLoadedAt（失败不刷新 TTL）
    if (!force && Array.isArray(window.photoWallData) && window.photoWallData.length && lastSuccessfulLoadedAt && Date.now() - lastSuccessfulLoadedAt < LOAD_CACHE_TTL_MS) return window.photoWallData;

    // P4: 每次尝试都更新 lastAttemptAt
    lastAttemptAt = Date.now();

    photoLoadGeneration++;
    var currentGen = photoLoadGeneration;

    abortPhotoPageRequests();
    // 旧分页 Promise 已被作废；它的 finally 会通过 identity check 保持新请求不受影响。
    loadMorePromise = null;
    loadMoreController = null;
    activePhotoLoadController = new AbortController();
    var loadController = activePhotoLoadController;
    var signal = loadController.signal;

    loading = true;
    var local = [];
    var hasCache = false;
    try {
      setPhotoWallSyncStatus('syncing', '同步照片中');

      // stale-while-revalidate: 立即展示本地缓存
      local = loadLocalPhotoWallData();
      hasCache = local.length > 0;
      if (hasCache && (!Array.isArray(window.photoWallData) || window.photoWallData.length === 0)) {
        window.photoWallData = mergePhotoLists(local, []);
        window.photoWallDataLoadedAt = Date.now();
        if (typeof window.renderPhotoWallWithoutReload === 'function') {
          window.renderPhotoWallWithoutReload();
        } else if (typeof window.renderPhotoWall === 'function') {
          window.renderPhotoWall();
        }
      }

      // 首次请求 25s，已有缓存时后台刷新 10s
      var requestId = 'load_' + photoLoadGeneration + '_' + Date.now();
      var rows = await fetchPhotoPage(0, hasCache ? 10000 : 25000, signal, requestId, currentGen);
      if (currentGen !== photoLoadGeneration) return window.photoWallData; // Aborted by newer request
      
      firstPageLoaded = true;
      page = 0;
      more = rows.length >= PAGE_SIZE;
      if (!more && local.length) {
        // P4: 云端成功返回空数组 — 用户已在云端删除所有照片。
        // 必须清除旧本地缓存，否则已删除的照片会持续显示在用户设备上。
        // 之前这里保留旧缓存是错误的，导致数据永久不一致。
        if (rows.length === 0) {
          window.photoWallData = [];
          saveLocalPhotoWallData();
        } else {
          var cloudIds = new Set(rows.map(function(row){ return row && row.id != null ? String(row.id) : ''; }).filter(Boolean));
          // ★ 过滤本地缓存：只保留云端存在的 ID
          local = local.filter(function(item){
            if (!item) return false;
            var key = item.cloudId != null ? String(item.cloudId) : String(item.id || '');
            return !key || cloudIds.has(key);
          });
          // ★ 使用过滤后的本地缓存参与合并，防止已删除照片被复活
          window.photoWallData = local;
        }
      }
      var deletedRows = rows.filter(function(row){ return row && row.media_url === '__deleted__'; });
      deletedRows.forEach(function(row){ addDeletedPhotoId(row.id); });
      var cloud = rows.map(normalizePhotoWallRow).filter(function(item){ return item && item.imageUrl; });
      // 过滤本地已删除的ID：云端快照可能滞后于本地删除操作
      var tombstoneIds = getDeletedIds();
      cloud = cloud.filter(function(item){
        if (!item) return false;
        var identity = item.cloudId != null ? String(item.cloudId) : String(item.id || '');
        return tombstoneIds.indexOf(identity) < 0 && tombstoneIds.indexOf(String(item.id || '')) < 0 && !isDeletedOrPendingPhoto(item);
      });
      // 合并云端和本地，按 id/cloudId 去重
      window.photoWallData = mergePhotoLists(cloud, window.photoWallData);
      saveLocalPhotoWallData();
      // P4: 仅成功时更新 lastSuccessfulLoadedAt
      lastSuccessfulLoadedAt = Date.now();
      window.photoWallDataLoadedAt = lastSuccessfulLoadedAt;
      setPhotoWallSyncStatus('synced', '已同步');
      subscribePhotoWallRealtime();
      // 无闪烁刷新：云端数据加载完成后更新UI
      if (typeof window.renderPhotoWallWithoutReload === 'function') {
        window.renderPhotoWallWithoutReload();
      } else if (typeof window.renderPhotoWall === 'function') {
        window.renderPhotoWall();
      }
      return window.photoWallData;
    } catch (err) {
      if (currentGen !== photoLoadGeneration) return window.photoWallData;
      var isAbort = err && err.name === 'AbortError';
      if (!isAbort) {
        console.error('[PhotoWall] load failed', err);
      }
      // 保留缓存，不清空
      if (!Array.isArray(window.photoWallData) || window.photoWallData.length === 0) {
        window.photoWallData = mergePhotoLists(local, []);
      }
      // P4: 失败时更新 lastFailureAt（不更新 lastSuccessfulLoadedAt，TTL 不刷新）
      lastFailureAt = Date.now();
      window.photoWallDataLoadedAt = lastFailureAt;
      if (!isAbort) {
        setPhotoWallSyncStatus('error', '同步失败');
      }
      return window.photoWallData;
    } finally {
      if (currentGen === photoLoadGeneration) {
        loading = false;
      }
      if (activePhotoLoadController === loadController) {
        activePhotoLoadController = null;
      }
    }
  }

  function loadMorePhotos(){
    if (loadMorePromise) return loadMorePromise;
    if (loading || !firstPageLoaded || !more) return Promise.resolve([]);

    var requestGeneration = photoLoadGeneration;
    var nextPage = page + 1;
    var controller = new AbortController();
    var requestId = 'more_' + nextPage + '_' + Date.now();
    loadMoreController = controller;
    var requestPromise;
    requestPromise = (async function(){
      try {
        var rows = await fetchPhotoPage(nextPage, 10000, controller.signal, requestId, requestGeneration);
        if (requestGeneration !== photoLoadGeneration || controller.signal.aborted) {
          throw createPhotoAbortError();
        }
        var items = rows.map(normalizePhotoWallRow).filter(function(item){ return item && item.imageUrl; });
        // page、more 和列表只在请求成功且仍属于当前 generation 时一起提交。
        if (requestGeneration !== photoLoadGeneration || controller.signal.aborted) {
          throw createPhotoAbortError();
        }
        window.photoWallData = mergePhotoLists(window.photoWallData.concat(items), []);
        page = nextPage;
        more = rows.length >= PAGE_SIZE;
        saveLocalPhotoWallData();
        // P4: 仅成功时更新 lastSuccessfulLoadedAt
        lastSuccessfulLoadedAt = Date.now();
        window.photoWallDataLoadedAt = lastSuccessfulLoadedAt;
        return items;
      } catch (err) {
        console.warn('[PhotoWall] load more failed', err);
        // 不回滚 page：失败路径从未提交 page，避免并发/刷新导致页码被旧请求污染。
        throw err;
      } finally {
        if (loadMoreController === controller) loadMoreController = null;
        if (loadMorePromise === requestPromise) loadMorePromise = null;
      }
    })();
    loadMorePromise = requestPromise;
    return requestPromise;
  }

  function hasMorePhotos(){ return !!more; }

  function broadcastSync(type, payload){
    var message = Object.assign({ type: type, ts: Date.now() }, payload || {});
    try { window.safeStorage.set(SYNC_KEY, JSON.stringify(message)); } catch (_) {}
    if (bc) {
      try { bc.postMessage(message); } catch (_) {}
    }
  }

  function removePhotoLocal(id, shouldRender){
    if (id == null) return false;
    var key = String(id);
    var before = window.photoWallData.length;
    window.photoWallData = window.photoWallData.filter(function(item){
      return String(item.id) !== key && String(item.cloudId || '') !== key;
    });
    saveLocalPhotoWallData();
    // P4: 本地删除是成功操作，更新 lastSuccessfulLoadedAt 保持数据新鲜度
    lastSuccessfulLoadedAt = Date.now();
    window.photoWallDataLoadedAt = lastSuccessfulLoadedAt;
    
    var removedDom = false;
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      var els = document.querySelectorAll('.photo-wall-item[data-photo-id]');
      for (var i = 0; i < els.length; i++) {
        if (els[i].getAttribute('data-photo-id') === key) {
          if (els[i].parentNode) {
            els[i].parentNode.removeChild(els[i]);
            removedDom = true;
          }
        }
      }
    }
    
    if (shouldRender !== false && !removedDom && before !== window.photoWallData.length && typeof window.renderPhotoWallWithoutReload === 'function') {
      window.renderPhotoWallWithoutReload();
    }
    return before !== window.photoWallData.length;
  }

  async function deleteCloudPhoto(item){
    if (!item || !(item.cloudId || item.id)) return false;
    var id = item.cloudId || item.id;
    var authHeaders = typeof window.getUserAuthHeaders === 'function'
      ? await window.getUserAuthHeaders()
      : {};
    // ★ 添加 AbortController 和超时控制
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);
    try {
      var response = await fetch((window.API_BASE || '') + '/api/photo/delete', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type':'application/json' }, authHeaders || {}),
        body: JSON.stringify({ photoId:id }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      var result = await response.json().catch(function(){ return {}; });
      if (!response.ok || !result.ok) throw new Error(result.error || 'cloud_delete_failed');
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      // ★ 超时后查询服务端权威删除状态（使用只读状态接口，不重复执行删除）
      if (err.name === 'AbortError') {
        try {
          var statusController = new AbortController();
          var statusTimeoutId = setTimeout(function() { statusController.abort(); }, 12000);
          var statusResponse = await fetch((window.API_BASE || '') + '/api/photo/delete-status?photo_id=' + encodeURIComponent(id), {
            method: 'GET',
            headers: Object.assign({}, authHeaders || {}),
            signal: statusController.signal
          });
          clearTimeout(statusTimeoutId);
          var statusResult = await statusResponse.json().catch(function(){ return {}; });
          if (statusResult.status === 'deleted') {
            return { ok: true, already_deleted: true };
          }
          if (statusResult.status === 'exists') {
            // 照片还存在，删除未成功
            throw new Error('delete_status_uncertain');
          }
          // not_found 或 unknown 也视为不确定
          throw new Error('delete_status_uncertain');
        } catch (statusErr) {
          if (statusErr.message === 'delete_status_uncertain') throw statusErr;
          console.warn('[PhotoWall] delete status check failed', statusErr);
          throw err; // 保留原始 AbortError
        }
      }
      throw err;
    }
  }

  async function deletePhotoWallPhoto(item, opts){
    opts = opts || {};
    if (!item) return { ok:false, error:'missing_photo' };
    var current = window.currentUser || '';
    // L3 修复：管理员判断统一走 window.isAdmin()（由后端 /admin/verify 结果驱动），
    // 移除硬编码用户名 'xxz' 的前端后门式提权通道（后端 /api/photo/delete 仍独立校验权限）
    var isAdmin = typeof window.isAdmin === 'function' && window.isAdmin();
    var isOwner = !!(item.username && current && item.username === current);
    if (!current || (!isOwner && !isAdmin)) {
      toast('无权删除这张照片');
      return { ok:false, error:'unauthorized' };
    }
    var id = item.id || item.cloudId;
    addPendingDeletedPhotoId(item.id);
    addPendingDeletedPhotoId(item.cloudId);
    // 立即从本地 UI 移除 + 缓存清除（不等云端返回）
    removePhotoLocal(id, opts.render !== false);
    var deleteResult = null;
    try { deleteResult = await deleteCloudPhoto(item); } catch (err) { console.warn('[PhotoWall] cloud delete failed', err); }
    if (!deleteResult) {
      removePendingDeletedPhotoId(item.id);
      removePendingDeletedPhotoId(item.cloudId);
      // ★ 修复：原"撤销本地移除"调用的是 removePhotoLocal（移除而非恢复），
      // 且只有 opts.render !== false 才重渲染；预览弹窗删除传 {render:false}，
      // 导致云端删除失败后 DOM 卡片消失但数据仍在，UI 与数据不一致。
      // 数据已在下行恢复（mergePhotoLists），无条件重渲染让卡片立即回到网格。
      window.photoWallData = mergePhotoLists([item].concat(window.photoWallData || []), []);
      saveLocalPhotoWallData();
      // P4: 云端删除失败 — 更新 lastFailureAt（不更新 lastSuccessfulLoadedAt）
      lastFailureAt = Date.now();
      window.photoWallDataLoadedAt = lastFailureAt;
      if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
      // 云端删除失败，但本地已移除 —— 下次同步时会重新出现
      setPhotoWallSyncStatus('error', '删除同步失败');
      toast('云端删除失败，请稍后重试');
      return { ok:false, error:'cloud_delete_failed' };
    }
    // 云端删除成功后才标记为已删除，防止浏览器崩溃后永久丢失照片
    removePendingDeletedPhotoId(item.id);
    removePendingDeletedPhotoId(item.cloudId);
    addDeletedPhotoId(id);
    broadcastSync('photo_deleted', { photoId: id });
    try { await loadPhotoWallData(true); } catch (_) {}
    if (deleteResult.cleanup_pending) {
      setPhotoWallSyncStatus('syncing', '列表已同步，文件清理中');
      toast('照片已从全站移除，原文件正在清理');
    } else {
      setPhotoWallSyncStatus('synced', '已同步');
    }
    return { ok:true, cleanup_pending:!!deleteResult.cleanup_pending, already_deleted:!!deleteResult.already_deleted };
  }

  function extractStoragePath(url){
    if (!url) return null;
    try {
      var parsed = new URL(url);
      var match = parsed.pathname.match(/\/object\/public\/uploads\/(.*)$/) || parsed.pathname.match(/\/uploads\/(.*)$/);
      return match && match[1] ? decodeURIComponent(match[1]) : null;
    } catch (_) { return null; }
  }

  function updatePhotoViewDisplays(item){
    if (!item || item.id == null) return;
    var count = Number(item.views || 0);
    var header = byId('photoPreviewViewsCount');
    if (header && window.photoPreviewCurrent && String(window.photoPreviewCurrent.id) === String(item.id)) header.textContent = count;
    var card = document.querySelector('.photo-wall-item[data-photo-id="' + String(item.id).replace(/"/g, '\\"') + '"] .pw-view-count');
    if (card) card.textContent = count;
  }

  async function syncPhotoViewCount(item){
    if (!item || !item.cloudId || !window.sb) return;
    var key = 'xtj_pwv_' + item.cloudId;
    var now = Date.now();
    var last = Number(window.safeStorage.get(key) || 0) || 0;
    if (last && now - last < 5 * 60 * 1000) return;
    try { window.safeStorage.set(key, String(now)); } catch (_) {}
    // P4: 保存原始 views 以便 RPC 失败时回滚乐观更新
    var originalViews = Number(item.views || 0);
    item.views = originalViews + 1;
    updatePhotoViewDisplays(item);
    try {
      var result = await window.sb.rpc('increment_post_views', { p_post_id: item.cloudId });
      // P4: Supabase rpc() 在数据库层失败时返回 { data: null, error } 而非 throw。
      // 之前只 try/catch，从未检查 error，导致浏览量乐观更新无法回滚。
      if (result && result.error) {
        item.views = originalViews;
        updatePhotoViewDisplays(item);
        // P5: RPC 失败时删除节流键，允许用户立即重试
        try { window.safeStorage.remove(key); } catch (_) {}
      }
    } catch (_) {
      // P4: 网络层异常也回滚
      item.views = originalViews;
      updatePhotoViewDisplays(item);
      // P5: 网络异常也删除节流键，允许立即重试
      try { window.safeStorage.remove(key); } catch (_) {}
    }
  }

  function handleExternalSync(message){
    if (!message || !message.type) return;
    if (message.type === 'photo_deleted' && message.photoId != null) {
      addDeletedPhotoId(message.photoId);
      removePhotoLocal(message.photoId, true);
      setTimeout(function(){
        loadPhotoWallData(true).then(function(){
          if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
        });
      }, 120);
    }
    if (message.type === 'photo_added') {
      setTimeout(function(){
        loadPhotoWallData(true).then(function(){
          if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
        });
      }, 400);
    }
  }

  function unsubscribePhotoWallRealtime(){
    if (realtimeChannel) {
      try { realtimeChannel.unsubscribe(); } catch(e) {}
      realtimeChannel = null;
    }
  }
  window.addEventListener('beforeunload', unsubscribePhotoWallRealtime);
  window.addEventListener('pagehide', unsubscribePhotoWallRealtime);

  function subscribePhotoWallRealtime(){
    if (!window.sb) return;
    if (realtimeChannel) {
      var state = realtimeChannel.state;
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        unsubscribePhotoWallRealtime();
      } else {
        return;
      }
    }
    try {
      realtimeChannel = window.sb.channel('photo-wall-realtime')
        .on('postgres_changes', { event:'*', schema:'public', table:'posts', filter:'media_type=eq.' + (window.PHOTO_WALL_MARKER || MARKER) }, function(payload){
          if (!payload) return;
          if (payload.eventType === 'DELETE') {
            if (payload.old && payload.old.id != null) handleExternalSync({ type:'photo_deleted', photoId: payload.old.id });
            return;
          }
          if (payload.eventType === 'UPDATE' && payload.new) {
            var updated = normalizePhotoWallRow(payload.new);
            if (!updated.imageUrl) {
              handleExternalSync({ type:'photo_deleted', photoId: payload.new.id });
              return;
            }
          }
          loadPhotoWallData(true).then(function(){
            if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
          });
        })
        .subscribe(function(status){
          if (status === 'SUBSCRIBED') setPhotoWallSyncStatus('synced', '已同步');
        });
    } catch (err) {
      console.warn('[PhotoWall] realtime subscribe failed', err);
      realtimeChannel = null;
    }
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel('xtj_photo_sync');
      bc.onmessage = function(event){ handleExternalSync(event.data); };
      // 有 BroadcastChannel 时不重复监听 storage 事件
    } catch (_) { bc = null; }
  }

  if (!bc) {
    window.addEventListener('storage', function(event){
      if (event.key !== SYNC_KEY || !event.newValue) return;
      try { handleExternalSync(JSON.parse(event.newValue)); } catch (_) {}
    });
  }

  // Tab 聚焦/切回时自动重新同步（防止离线期间错过删除事件）
  var _lastVisibilitySync = 0;
  function reconcilePhotoWallAfterResume(){
    if (!navigator.onLine) return;
    var now = Date.now();
    if (now - _lastVisibilitySync < 5000) return; // 5秒内不重复
    _lastVisibilitySync = now;
    subscribePhotoWallRealtime();
    return loadPhotoWallData(true).then(function(){
      if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
    });
  }
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) reconcilePhotoWallAfterResume();
  });
  window.addEventListener('online', reconcilePhotoWallAfterResume);
  window.addEventListener('pageshow', reconcilePhotoWallAfterResume);

  window.setPhotoWallSyncStatus = setPhotoWallSyncStatus;
  window.addDeletedPhotoId = addDeletedPhotoId;
  window.pendingDeletedPhotoIds = pendingDeletedPhotoIds;
  window.saveLocalPhotoWallData = saveLocalPhotoWallData;
  window.normalizePhotoWallRow = normalizePhotoWallRow;
  window.extractStoragePath = extractStoragePath;
  window.updatePhotoViewDisplays = updatePhotoViewDisplays;
  window.broadcastSync = broadcastSync;
  window.loadPhotoWallData = loadPhotoWallData;
  window.loadMorePhotos = loadMorePhotos;
  window.hasMorePhotos = hasMorePhotos;
  window.deletePhotoWallPhoto = deletePhotoWallPhoto;
  window.syncPhotoViewCount = syncPhotoViewCount;
})();
