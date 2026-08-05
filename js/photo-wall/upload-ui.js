(function(){
  'use strict';

  var MARKER = '__photo_wall__';
  var state = {
    photoFiles: [],
    photoUrls: [],
    skippedFiles: [],
    uploading: false,
    cancelRequested: false,
    batchController: null,
    batchJobs: [],
    postPreviewUrls: [],
    failedJobs: []
  };

  window.PHOTO_WALL_MARKER = window.PHOTO_WALL_MARKER || MARKER;

  var MAX_PHOTO_UPLOAD_BYTES = 50 * 1024 * 1024;
  var MAX_BATCH_COUNT = 12;
  var MAX_BATCH_BYTES = 120 * 1024 * 1024;
  var CONCURRENCY = 3;
  var PHOTO_UPLOAD_TIMEOUT_MS = 25000;

  function byId(id){ return document.getElementById(id); }

  function apiUrl(path) {
    var base = (typeof window.API_BASE === 'string' && window.API_BASE)
      ? window.API_BASE.replace(/\/$/, '')
      : '';
    return base + path;
  }

  function buildPhotoCreateHeaders(authHeaders) {
    return Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {});
  }

  function toast(message){
    if (typeof window.showToast === 'function') window.showToast(message);
    else console.log('[XTJ]', message);
  }

  function getCurrentUser(){
    return window.currentUser || (function(){
      try { return localStorage.getItem('xtj_user') || ''; }
      catch (_) { return ''; }
    })();
  }

  // G5 修复：除拒绝 SVG 外，仅允许位图 MIME 白名单（与后端 photo-create.js 一致）。
  // 防止伪造 file.type 上传 text/html、application/javascript 等可执行内容到公开可读的
  // Storage bucket（原图 URL 直接打开即存储型 XSS 载体）。
  var PHOTO_WALL_ALLOWED_IMAGE_MIME = /^image\/(?:jpeg|png|webp|gif|avif|heic|heif|bmp|tiff|x-ms-bmp)(?:[a-z0-9!#$&^_.+-]{0,126})?$/i;
  function isImage(file){ return !!(file && PHOTO_WALL_ALLOWED_IMAGE_MIME.test(String(file.type || ''))); }
  function isVideo(file){ return !!(file && /^video\//i.test(file.type || '')); }
  function isMedia(file){ return isImage(file) || isVideo(file); }
  function isPhotoWallImage(file){ return isImage(file); }

  function genUploadId() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    } catch (_) {}
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function createPhotoUploadError(code){
    var error = new Error(code || 'upload_failed');
    error.photoUploadCode = code || 'upload_failed';
    return error;
  }

  function photoUploadFailureReason(error, stage){
    var code = error && error.photoUploadCode;
    var status = Number(error && (error.status || error.statusCode)) || 0;
    var message = String(error && error.message || '').toLowerCase();
    if (code === 'cancelled' || (error && error.name === 'AbortError')) return '已取消';
    if (code === 'unsupported_type') return '文件类型不支持';
    if (code === 'file_too_large') return '文件超过 50 MB 限制';
    if (code === 'timeout' || /timeout|timed out/.test(message)) return '正在确认上传结果，请稍候';
    if (code === 'backend_unreachable' || stage === 'network') return '后端不可达';
    if (status === 401 || status === 403 || /jwt|token|unauthori[sz]ed|forbidden|登录/.test(message)) return '登录已过期';
    if (status === 429) return '请求过于频繁，请稍后重试';
    if (stage === 'storage') return '图片上传失败';
    if (stage === 'record') return '图片已上传，但记录保存失败';
    return '上传失败';
  }

  function cleanupStorage(path, uploadId, options){
    if (!path) return Promise.resolve();
    options = options || {};
    // Once /api/photo/create has been called, the response may be lost after
    // the server commits the database row.  Never delete Storage directly in
    // that ambiguous window; ask the authenticated backend to verify the
    // reference first and retain a durable pending record if that request
    // itself cannot be confirmed.
    if (options.serverOnly) {
      var pendingInfo = Object.assign({ uploadId: uploadId, path: path }, options.pendingInfo || {});
      var rememberPending = function () {
        if (pendingInfo.uploadId && pendingInfo.path) savePendingPhotoUpload(pendingInfo);
      };
      return Promise.resolve().then(function () {
        var authHeaders = typeof window.getUserAuthHeaders === 'function' ? window.getUserAuthHeaders() : {};
        return Promise.resolve(authHeaders).then(function (resolvedHeaders) {
          var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
          return fetch(apiUrl('/api/photo/cleanup'), {
            method: 'POST',
            headers: buildPhotoCreateHeaders(resolvedHeaders || {}),
            body: JSON.stringify({ path: path, upload_id: uploadId }),
            signal: controller ? controller.signal : undefined
          }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
              if (response.ok && data && data.ok === true) return { ok: true, data: data };
              rememberPending();
              return { ok: false, status: response.status, data: data };
            });
          }).finally(function () {
            if (timeoutId) clearTimeout(timeoutId);
          });
        });
      }).catch(function (error) {
        rememberPending();
        console.error('[photo-upload] Backend cleanup could not be confirmed', error);
        return { ok: false, error: error };
      });
    }
    // 统一走后端 /api/photo/cleanup（含归属与路径校验），禁止前端 anon key 直删 Storage：
    // 直删会绕过服务端校验与审计，且若 bucket 删除策略未按 owner 收紧即为任意文件删除。
    // 后端要求 upload_id + 规范路径；缺少 upload_id 时无法通过后端校验，直接放弃删除并警告。
    if (!uploadId) {
      console.warn('[photo-upload] cleanup skipped: missing upload_id (cannot verify ownership)', path);
      return Promise.resolve({ ok: false, reason: 'missing_upload_id' });
    }
    return Promise.resolve().then(function () {
      var authHeaders = typeof window.getUserAuthHeaders === 'function' ? window.getUserAuthHeaders() : {};
      return Promise.resolve(authHeaders).then(function (resolvedHeaders) {
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
        return fetch(apiUrl('/api/photo/cleanup'), {
          method: 'POST',
          headers: buildPhotoCreateHeaders(resolvedHeaders || {}),
          body: JSON.stringify({ path: path, upload_id: uploadId }),
          signal: controller ? controller.signal : undefined
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (response.ok && data && data.ok === true) return { ok: true, data: data };
            // ★ fetch 请求失败（503/非 ok 响应）时保存 durable pending 记录，
            // 等待后续 reconcile 重试清理，避免 Storage 残留孤儿文件。
            if (uploadId && path) savePendingPhotoUpload({ uploadId: uploadId, path: path });
            return { ok: false, status: response.status, data: data };
          });
        }).finally(function () {
          if (timeoutId) clearTimeout(timeoutId);
        });
      });
    }).catch(function (error) {
      // ★ 网络异常/超时也保存 durable pending 记录
      if (uploadId && path) savePendingPhotoUpload({ uploadId: uploadId, path: path });
      console.error('[photo-upload] Backend cleanup could not be confirmed', error);
      return { ok: false, error: error };
    });
  }

  // ★ 保存 pending 上传状态（状态不确定时不删除 Storage，等待后续查询）
  // P4: upsert 语义 — 同 uploadId 的记录合并 path 到 allPaths（不丢失历史路径），
  // 更新 activePath / updatedAt / attempt；新记录则 allPaths 初始化为 [path]。
  function savePendingPhotoUpload(info) {
    try {
      var pending = readJson('xtj_photo_upload_pending', []);
      var now = Date.now();
      var newPath = info.path || info.activePath;
      var existingIdx = -1;
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        if (p && p.uploadId === info.uploadId) { existingIdx = i; break; }
      }
      if (existingIdx >= 0) {
        // ★ upsert：合并新 path 到 allPaths（不丢失旧路径），更新 activePath / updatedAt
        var existing = pending[existingIdx];
        var allPaths = Array.isArray(existing.allPaths) ? existing.allPaths.slice() : (existing.path ? [existing.path] : []);
        if (newPath && allPaths.indexOf(newPath) < 0) allPaths.push(newPath);
        existing.allPaths = allPaths;
        existing.activePath = newPath || existing.activePath || existing.path;
        // 维持向后兼容：path 字段同步为 activePath
        existing.path = existing.activePath;
        existing.attempt = (typeof existing.attempt === 'number' ? existing.attempt : 0) + 1;
        existing.updatedAt = now;
        // 更新可选字段（如调用方提供则覆盖）
        if (info.publicUrl) existing.publicUrl = info.publicUrl;
        if (info.fileName) existing.fileName = info.fileName;
        if (info.fileSize != null) existing.fileSize = info.fileSize;
        if (info.mimeType) existing.mimeType = info.mimeType;
      } else {
        // ★ 新记录：allPaths 初始化为 [path]
        pending.push({
          uploadId: info.uploadId,
          path: newPath,
          activePath: newPath,
          allPaths: newPath ? [newPath] : [],
          publicUrl: info.publicUrl,
          fileName: info.fileName,
          fileSize: info.fileSize,
          mimeType: info.mimeType,
          createdAt: now,
          updatedAt: now,
          attempt: 0,
          // P4: track retry state for real expiry, backoff, and stale detection
          retryCount: 0,
          lastQueriedAt: 0,
          stale: false
        });
      }
      // 保留最近 50 条
      writeJson('xtj_photo_upload_pending', pending.slice(-50));
    } catch(e) {}
  }

  // ★ 恢复 pending 上传状态
  var _reconcileLocks = {};
  window.reconcilePendingPhotoUploads = async function() {
    try {
      var pending = readJson('xtj_photo_upload_pending', []);
      if (!pending.length) return;
      var now = Date.now();
      var maxAge = 7 * 24 * 60 * 60 * 1000; // 7 天过期
      var remaining = [];
      var lowFreqQueue = readJson('xtj_photo_upload_lowfreq', []); // P5: 低频率重试队列
      var reconciled = 0;

      var maxRetryCount = 10; // P4: 最大重试次数
      var minRetryInterval = 30 * 1000; // P4: 最小重试间隔 30 秒
      // P5: 同一 uploadId 的清理锁，防止并发清理
      var _cleanupInProgress = window._photoCleanupInProgress = window._photoCleanupInProgress || {};

      for (var i = 0; i < pending.length; i++) {
        var entry = pending[i];
        if (!entry.uploadId) continue;
        // P5: 超过 7 天过期的记录 — 移入低频率重试队列，不直接丢弃
        if ((now - entry.createdAt) > maxAge) {
          entry.stale = true;
          entry.movedToLowFreq = true;
          lowFreqQueue.push(entry);
          continue; // 不加入 remaining，但已加入 lowFreqQueue
        }
        // P4: 退避 — 距离上次查询不足最小间隔则跳过
        if (entry.lastQueriedAt && (now - entry.lastQueriedAt) < minRetryInterval) {
          remaining.push(entry);
          continue;
        }
        // P5: 超过最大重试次数 — 移入低频率重试队列，不再主动查询
        if ((entry.retryCount || 0) >= maxRetryCount) {
          entry.stale = true;
          entry.movedToLowFreq = true;
          lowFreqQueue.push(entry);
          continue; // 不加入 remaining
        }
        entry.lastQueriedAt = now;
        entry.retryCount = (entry.retryCount || 0) + 1;
        // 每个 uploadId 同时只能有一个 reconcile 请求（有并发请求时保留记录，不丢弃）
        if (_reconcileLocks[entry.uploadId]) { remaining.push(entry); continue; }
        var reconcileToken = 'reconcile_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        _reconcileLocks[entry.uploadId] = reconcileToken;

        try {
          var controller = new AbortController();
          var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
          var authHeaders = typeof window.getUserAuthHeaders === 'function' ? await window.getUserAuthHeaders() : {};
          var resp = await fetch((window.API_BASE || '') + '/api/photo/status', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
            body: JSON.stringify({ upload_id: entry.uploadId }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          var data = await resp.json().catch(function(){ return {}; });

          if (resp.ok && data.status === 'committed') {
            // 已提交，加入照片墙
            reconciled++;
            // 删除 pending 记录（不删除 Storage，因为文件已提交）
            continue; // 不加入 remaining
          } else if (resp.ok && (data.status === 'failed' || data.status === 'not_found')) {
            // P5: 清理时必须等待结果，且使用 _cleanupInProgress 锁防止并发
            var cleanupOk = !entry.path;
            if (entry.path && _cleanupInProgress[entry.uploadId]) {
              // Another reconcile invocation owns the cleanup request. Keep
              // this entry so that the concurrent invocation cannot make it
              // disappear from durable pending state.
              remaining.push(entry);
              continue;
            }
            if (entry.path && !_cleanupInProgress[entry.uploadId]) {
              var cleanupToken = 'cleanup_' + Date.now() + '_' + Math.random().toString(36).slice(2);
              _cleanupInProgress[entry.uploadId] = cleanupToken;
              try {
                var cleanupAuthHeaders = typeof window.getUserAuthHeaders === 'function' ? await window.getUserAuthHeaders() : {};
                var cleanupResp = await fetch((window.API_BASE || '') + '/api/photo/cleanup', {
                  method: 'POST',
                  headers: Object.assign({ 'Content-Type': 'application/json' }, cleanupAuthHeaders || {}),
                  body: JSON.stringify({ path: entry.path, upload_id: entry.uploadId })
                });
                var cleanupData = await cleanupResp.json().catch(function(){ return {}; });
                if (!cleanupResp.ok || !cleanupData.ok) {
                  console.warn('[PhotoWall] cleanup failed for', entry.uploadId, cleanupData);
                } else {
                  cleanupOk = true;
                }
              } catch (e) {
                console.warn('[PhotoWall] cleanup error for', entry.uploadId, e);
              } finally {
                if (_cleanupInProgress[entry.uploadId] === cleanupToken) delete _cleanupInProgress[entry.uploadId];
                if (!cleanupOk) {
                  entry.lastQueriedAt = now;
                  remaining.push(entry);
                }
              }
            }
            continue; // 不加入 remaining
          } else if (resp.ok && data.status === 'processing') {
            // 仍在处理，保留记录
            remaining.push(entry);
          } else {
            // 网络错误或未知状态，保留记录
            remaining.push(entry);
          }
        } catch (err) {
          // 网络错误，保留记录，不删除 Storage
          remaining.push(entry);
        } finally {
          if (_reconcileLocks[entry.uploadId] === reconcileToken) delete _reconcileLocks[entry.uploadId];
        }
      }

      // P5: 保存低频率重试队列，限制大小
      writeJson('xtj_photo_upload_lowfreq', lowFreqQueue.slice(-50));
      writeJson('xtj_photo_upload_pending', remaining);
      if (reconciled > 0 && typeof window.initPhotoWall === 'function') {
        window.initPhotoWall(true).catch(function() {});
      }
    } catch (e) {
      console.warn('[PhotoWall] reconcile pending uploads failed', e);
    }
  };

  // P5: 低频率重试队列检查 — 每 30 分钟处理一次
  var _lowFreqLocks = window._photoLowFreqLocks = window._photoLowFreqLocks || {};
  window.recheckLowFreqPhotoQueue = async function() {
    try {
      var lowFreq = readJson('xtj_photo_upload_lowfreq', []);
      if (!lowFreq.length) return;
      var now = Date.now();
      var remaining = [];
      for (var i = 0; i < lowFreq.length; i++) {
        var entry = lowFreq[i];
        if (!entry || !entry.uploadId) continue;
        if (entry.lastLowFreqCheckAt && (now - entry.lastLowFreqCheckAt) < 24 * 60 * 60 * 1000) {
          remaining.push(entry);
          continue;
        }
        if (_lowFreqLocks[entry.uploadId]) {
          remaining.push(entry);
          continue;
        }
        var lowFreqToken = 'lowfreq_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        _lowFreqLocks[entry.uploadId] = lowFreqToken;
        entry.lastLowFreqCheckAt = now;
        var keepEntry = true;
        var refreshPhotoWall = false;
        var controller = null;
        var timeoutId = null;
        try {
          controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          timeoutId = controller ? setTimeout(function() { controller.abort(); }, 15000) : null;
          var authHeaders = typeof window.getUserAuthHeaders === 'function' ? await window.getUserAuthHeaders() : {};
          var resp = await fetch((window.API_BASE || '') + '/api/photo/status', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
            body: JSON.stringify({ upload_id: entry.uploadId }),
            signal: controller ? controller.signal : undefined
          });
          var data = await resp.json().catch(function(){ return {}; });
          if (resp.ok && data && data.status === 'committed') {
            keepEntry = false;
            refreshPhotoWall = true;
          } else if (resp.ok && data && (data.status === 'failed' || data.status === 'not_found')) {
            if (!entry.path) {
              keepEntry = false;
            } else {
              var cleanupController = typeof AbortController !== 'undefined' ? new AbortController() : null;
              var cleanupTimeoutId = cleanupController ? setTimeout(function() { cleanupController.abort(); }, 15000) : null;
              try {
                var cleanupAuthHeaders = typeof window.getUserAuthHeaders === 'function' ? await window.getUserAuthHeaders() : {};
                var cleanupResp = await fetch((window.API_BASE || '') + '/api/photo/cleanup', {
                  method: 'POST',
                  headers: Object.assign({ 'Content-Type': 'application/json' }, cleanupAuthHeaders || {}),
                  body: JSON.stringify({ path: entry.path, upload_id: entry.uploadId }),
                  signal: cleanupController ? cleanupController.signal : undefined
                });
                var cleanupData = await cleanupResp.json().catch(function(){ return {}; });
                if (cleanupResp.ok && cleanupData && cleanupData.ok === true) keepEntry = false;
              } finally {
                if (cleanupTimeoutId) clearTimeout(cleanupTimeoutId);
              }
            }
          } else if (resp.ok && data && data.status === 'processing') {
            keepEntry = true;
          }
        } catch (_) {
          keepEntry = true;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (_lowFreqLocks[entry.uploadId] === lowFreqToken) delete _lowFreqLocks[entry.uploadId];
        }
        if (keepEntry) remaining.push(entry);
        if (refreshPhotoWall && typeof window.initPhotoWall === 'function') {
          window.initPhotoWall(true).catch(function() {});
        }
      }
      writeJson('xtj_photo_upload_lowfreq', remaining.slice(-50));
    } catch (e) {
      console.warn('[PhotoWall] recheckLowFreqPhotoQueue failed', e);
    }
  };
  // 每 30 分钟执行一次低频率重试
  setInterval(function() { window.recheckLowFreqPhotoQueue(); }, 30 * 60 * 1000);

  // ★ 绑定 reconcile 触发时机
  (function() {
    // 页面启动
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() { window.reconcilePendingPhotoUploads(); }, 2000);
      }, { once: true });
    } else {
      setTimeout(function() { window.reconcilePendingPhotoUploads(); }, 2000);
    }
    // online / pageshow / visibilitychange
    window.addEventListener('online', function() { window.reconcilePendingPhotoUploads(); });
    window.addEventListener('pageshow', function() { window.reconcilePendingPhotoUploads(); });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) window.reconcilePendingPhotoUploads();
    });
  })();

  function readJson(key, fallback) {
    try {
      var raw = window.safeStorage.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    try { window.safeStorage.set(key, JSON.stringify(value)); } catch (_) {}
  }

  function uploadBatchPercent(processed, total){
    return total > 0 ? Math.round((processed / total) * 100) : 100;
  }

  function updateUploadBatchProgress(processed, total, success, failed, prefix){
    var skipped = (state.skippedFiles || []).length;
    var pct = uploadBatchPercent(processed, total);
    var text = (prefix ? prefix + '，' : '') + '已处理 ' + processed + ' / ' + total + '，成功 ' + success + '，失败 ' + failed;
    if (skipped) text += '，跳过 ' + skipped;
    setProgress(text, pct);
    var processedEl = byId('pwUploadProgressProcessed');
    var okEl = byId('pwUploadProgressOk');
    var failEl = byId('pwUploadProgressFail');
    var skipEl = byId('pwUploadProgressSkip');
    var statsEl = byId('pwUploadProgressStats');
    if (statsEl && processedEl && okEl && failEl) {
      processedEl.textContent = String(processed);
      okEl.textContent = String(success);
      failEl.textContent = String(failed);
      if (skipEl) skipEl.textContent = String(skipped || 0);
      statsEl.hidden = false;
    }
  }

  function safeFileName(file, fallbackExt, uploadId){
    var name = String(file && file.name || 'media');
    var extMatch = name.match(/\.[a-z0-9]{1,8}$/i);
    var ext = extMatch ? extMatch[0].toLowerCase() : (fallbackExt || '');
    var base = extMatch ? name.slice(0, -ext.length) : name;
    if (base.normalize) base = base.normalize('NFKD');
    base = base.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
    if (!base) base = 'media';
    var ownerPrefix = String(uploadId || '').replace(/[^a-z0-9_\-]/gi, '').slice(0, 64);
    return (ownerPrefix ? ownerPrefix + '_' : '') + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + base + ext;
  }

  function inferExt(file){
    var type = String(file && file.type || '').toLowerCase();
    if (type === 'image/png') return '.png';
    if (type === 'image/webp') return '.webp';
    if (type === 'image/gif') return '.gif';
    if (type.indexOf('jpeg') >= 0 || type === 'image/jpg') return '.jpg';
    return '';
  }

  function revoke(listName){
    var list = state[listName];
    if (!Array.isArray(list)) return;
    while (list.length) {
      try { URL.revokeObjectURL(list.pop()); } catch (_) {}
    }
  }

  function focusUploadButton(){
    var trigger = byId('photoUploadBtn');
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }

  function closeSheet(options){
    if (options && typeof options.preventDefault === 'function') options = {};
    options = options || {};
    var sheet = byId('pwUploadSheet');
    if (!sheet) return;
    if (state.uploading && !options.force) return;
    sheet.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
    
    if (!options.force) {
      revoke('photoUrls');
      state.photoFiles = [];
      state.skippedFiles = [];
      var grid = byId('pwUploadSheetGrid');
      if (grid) grid.innerHTML = '';
      var input = byId('photoFileInput');
      if (input) input.value = '';
      var title = byId('pwUploadTitle');
      if (title) title.textContent = '选择照片';
      var subtitle = byId('pwUploadSubtitle');
      if (subtitle) subtitle.textContent = '最多 ' + MAX_BATCH_COUNT + ' 张图片，单张不超过 50MB';
      setUploadResult('', false);
    }
    
    if (options.restoreFocus !== false) focusUploadButton();
  }

  function setUploadResult(message, isError){
    var result = byId('pwUploadResult');
    if (!result) return;
    var titleEl = byId('pwUploadResultTitle');
    var detailEl = byId('pwUploadResultDetail');
    if (!titleEl || !detailEl) {
      result.textContent = message || '';
      result.hidden = !message;
      result.classList.toggle('is-error', !!isError);
      if (result.dataset) result.dataset.state = !message ? 'idle' : (isError ? 'error' : 'success');
      return;
    }
    setUploadResultState(message, isError ? 'error' : 'success');
  }

  function setUploadResultState(message, s){
    var result = byId('pwUploadResult');
    if (!result) return;
    var titleEl = byId('pwUploadResultTitle');
    var detailEl = byId('pwUploadResultDetail');
    var closeBtn = byId('pwUploadResultClose');
    var actionsEl = byId('pwUploadResultActions');
    var retryBtn = byId('pwUploadResultRetry');
    var text = String(message || '');
    if (!text) {
      result.hidden = true;
      result.dataset.state = 'idle';
      if (titleEl) titleEl.textContent = '';
      if (detailEl) detailEl.textContent = '';
      if (closeBtn) closeBtn.hidden = true;
      if (actionsEl) actionsEl.hidden = true;
      if (retryBtn) retryBtn.hidden = true;
      return;
    }
    result.hidden = false;
    s = s || 'success';
    result.dataset.state = s;
    var titleMap = { success: '上传成功', partial: '部分上传成功', error: '上传失败' };
    if (titleEl) titleEl.textContent = titleMap[s] || titleMap.success;
    var parts = text.split(/\n|[。;；]/).map(function(p){ return p.trim(); }).filter(Boolean);
    if (detailEl) detailEl.textContent = parts.length > 1 ? parts.join('\n') : text;
    if (actionsEl) actionsEl.hidden = (s === 'success');
    if (retryBtn) retryBtn.hidden = !(s === 'partial' || s === 'error');
    if (closeBtn) closeBtn.hidden = false;
  }

  function clearUploadResult(){ setUploadResult(''); }

  function bindUploadResultActions(){
    var closeBtn = byId('pwUploadResultClose');
    if (closeBtn && !closeBtn.__xtjBound) {
      closeBtn.__xtjBound = true;
      closeBtn.addEventListener('click', function(){ clearUploadResult(); focusUploadButton(); });
    }
    var actionsEl = byId('pwUploadResultActions');
    if (actionsEl && !actionsEl.__xtjBound) {
      actionsEl.__xtjBound = true;
      actionsEl.addEventListener('click', function(event){
        var btn = event.target.closest && event.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        if (action === 'refresh-photos') {
          try { window.dispatchEvent(new CustomEvent('xtj:photo-result-refresh', { bubbles: true })); } catch (_) {}
          if (typeof window.loadPhotoWallData === 'function') { try { window.loadPhotoWallData(true); } catch (_) {} }
        } else if (action === 'retry-failed') {
          retryFailedUploads();
        }
      });
    }
  }

  function classifyFiles(files){
    var accepted = [];
    var skipped = [];
    var totalBytes = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!isPhotoWallImage(f)) { skipped.push({ file: f, reason: '文件类型不支持' }); continue; }
      var size = Number(f.size) || 0;
      if (size > MAX_PHOTO_UPLOAD_BYTES) { skipped.push({ file: f, reason: '超过单张 50MB 限制' }); continue; }
      if (accepted.length >= MAX_BATCH_COUNT) { skipped.push({ file: f, reason: '超过每批 12 张限制' }); continue; }
      if (totalBytes + size > MAX_BATCH_BYTES) { skipped.push({ file: f, reason: '超过每批 120MB 总大小' }); continue; }
      accepted.push(f);
      totalBytes += size;
    }
    return { accepted: accepted, skipped: skipped };
  }

  function openSheet(files, skipped){
    var sheet = byId('pwUploadSheet');
    var grid = byId('pwUploadSheetGrid');
    var title = byId('pwUploadSheetTitle');
    var meta = byId('pwUploadSheetMeta');
    var count = byId('pwUploadSheetCount');
    var skipMeta = byId('pwUploadSheetSkipped');
    if (!sheet || !grid) { toast('上传面板未加载，请刷新页面'); return; }
    revoke('photoUrls');
    grid.innerHTML = '';
    files.forEach(function(file, index){
      var url = URL.createObjectURL(file);
      state.photoUrls.push(url);
      var item = document.createElement('div');
      item.className = 'pw-upload-sheet-thumb';
      var img = document.createElement('img');
      img.src = url; img.alt = ''; img.decoding = 'async';
      if (index > 3) img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      item.appendChild(img);
      grid.appendChild(item);
    });
    state.photoFiles = files.slice();
    state.skippedFiles = (skipped || []).slice();
    if (title) title.textContent = '选择完成，准备上传';
    var metaText = '已选择 ' + files.length + ' 张照片，确认后开始上传。';
    if (skipped && skipped.length) metaText += ' 已跳过 ' + skipped.length + ' 个不支持或超限文件。';
    if (meta) meta.textContent = metaText;
    if (count) count.textContent = files.length + ' 张照片';
    if (skipMeta) {
      if (skipped && skipped.length) {
        skipMeta.hidden = false;
        skipMeta.textContent = '跳过 ' + skipped.length + ' 个：' + skipped.slice(0, 3).map(function(s){ return (s.file && s.file.name ? s.file.name : '文件') + '（' + s.reason + '）'; }).join('；') + (skipped.length > 3 ? '…' : '');
      } else { skipMeta.hidden = true; skipMeta.textContent = ''; }
    }
    sheet.classList.add('active');
    sheet.setAttribute('aria-hidden', 'false');
    setUploadResult('');
    var firstControl = byId('pwUploadReselectBtn') || byId('pwStartUploadBtn') || byId('pwUploadSheetClose');
    if (firstControl && typeof firstControl.focus === 'function') firstControl.focus();
  }

  function setProgress(text, pct){
    var overlay = byId('pwUploadProgressOverlay');
    if (!overlay) return;
    var textEl = byId('pwUploadProgressText');
    var statusEl = byId('pwUploadProgressStatus');
    var trackEl = byId('pwUploadProgressTrack');
    var fillEl = byId('pwUploadProgressFill');
    var stageEl = byId('pwUploadProgressStage');
    var cancelBtn = byId('pwUploadProgressCancel');
    // ★ 修复：pwUploadProgressPct（统计行"进度 X%"）此前从未被更新，恒显示 0%
    var pctEl = byId('pwUploadProgressPct');
    if (!text) {
      overlay.style.display = 'none';
      overlay.classList.remove('upload-overlay-visible');
      overlay.setAttribute('aria-hidden', 'true');
      if (trackEl) trackEl.hidden = true;
      if (fillEl) fillEl.style.width = '0%';
      if (cancelBtn) cancelBtn.hidden = true;
      if (pctEl) pctEl.textContent = '0%';
      return;
    }
    overlay.style.display = 'flex';
    overlay.classList.add('upload-overlay-visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (textEl) textEl.textContent = text || '';
    if (statusEl) statusEl.textContent = (typeof pct === 'number') ? ('当前进度 ' + Math.round(pct) + '%') : '正在准备上传任务。';
    if (pctEl) pctEl.textContent = (typeof pct === 'number') ? Math.round(pct) + '%' : '0%';
    if (trackEl) trackEl.hidden = !(typeof pct === 'number');
    if (fillEl && typeof pct === 'number') fillEl.style.width = Math.round(pct) + '%';
    if (stageEl) {
      var r = (typeof pct === 'number') ? Math.round(pct) : -1;
      stageEl.textContent = r < 0 ? '准备中' : (r >= 100 ? '上传完成' : '上传中');
    }
    if (cancelBtn) cancelBtn.hidden = false;
  }

  function handlePhotoSelection(event){
    var input = event && event.target;
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    var c = classifyFiles(files);
    if (!c.accepted.length) {
      if (c.skipped.length) toast('没有可上传的图片：' + c.skipped[0].reason);
      else toast('请选择照片');
      return;
    }
    openSheet(c.accepted, c.skipped);
  }

  async function uploadOnePhotoWallFile(job, signal){
    var file = job.file;
    var uploadId = job.uploadId;
    if (state.cancelRequested || (signal && signal.aborted)) throw createPhotoUploadError('cancelled');
    if (!isPhotoWallImage(file)) throw createPhotoUploadError('unsupported_type');
    if (!Number.isFinite(Number(file.size)) || Number(file.size) > MAX_PHOTO_UPLOAD_BYTES) throw createPhotoUploadError('file_too_large');
    var path = 'photos/' + safeFileName(file, inferExt(file), uploadId);
    job.storagePath = path;
    var type = isImage(file) && file.type ? file.type : 'image/jpeg';
    var upload;
    try {
      upload = await window.sb.storage.from('uploads').upload(path, file, {
        contentType: type, cacheControl: '31536000', upsert: false,
        // P4: pass the AbortController signal so that cancelCurrentUpload()
        // truly aborts the in-flight Storage network request, instead of
        // letting it run to completion and then deleting the uploaded file.
        signal: signal || undefined
      });
    } catch (storageError) {
      storageError.photoUploadStage = 'storage';
      throw storageError;
    }
    if (upload && upload.error) { upload.error.photoUploadStage = 'storage'; throw upload.error; }
    if (state.cancelRequested || (signal && signal.aborted)) {
      // 取消上传：必须走后端 /api/photo/cleanup 校验路径归属，禁止前端 anon key 直删 Storage
      await cleanupStorage(path, uploadId);
      throw createPhotoUploadError('cancelled');
    }
    var publicUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
    var cleanupAfterCreateOptions = {
      serverOnly: true,
      pendingInfo: { uploadId: uploadId, path: path, publicUrl: publicUrl, fileName: file.name, fileSize: file.size, mimeType: type }
    };
    var authHeaders = (typeof window.getUserAuthHeaders === 'function')
      ? window.getUserAuthHeaders()
      : null;
    var headers = await Promise.resolve(authHeaders);
    var controller = new AbortController();
    var timeoutTimer = setTimeout(function() { controller.abort(); }, PHOTO_UPLOAD_TIMEOUT_MS);
    var timedOut = false;
    if (signal) signal.addEventListener('abort', function(){ controller.abort(); }, { once: true });
    var createRes;
    try {
      createRes = await fetch(apiUrl('/api/photo/create'), {
        method: 'POST',
        headers: buildPhotoCreateHeaders(headers),
        body: JSON.stringify({
          media_url: publicUrl,
          upload_id: uploadId,
          file_size: file.size || 0,
          original_size: file.size || 0,
          mime_type: type
        }),
        signal: controller.signal
      });
    } catch (fetchError) {
      clearTimeout(timeoutTimer);
      timedOut = fetchError.name === 'AbortError';
      if (state.cancelRequested || (signal && signal.aborted)) {
        await cleanupStorage(path, uploadId, cleanupAfterCreateOptions);
        throw createPhotoUploadError('cancelled');
      }
      if (timedOut) {
        // 超时不确定：先查询服务端是否已提交记录
        fetchError.photoUploadCode = 'timeout';
        fetchError.photoUploadStage = 'uncertain';
        try {
          var statusController = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var statusTimeout = statusController ? setTimeout(function() { statusController.abort(); }, 10000) : null;
          var statusRes = await fetch(apiUrl('/api/photo/status'), {
            method: 'POST',
            headers: buildPhotoCreateHeaders(headers),
            body: JSON.stringify({ upload_id: uploadId }),
            signal: statusController ? statusController.signal : undefined
          });
          if (statusTimeout) clearTimeout(statusTimeout);
          var statusData = await statusRes.json().catch(function(){ return {}; });
          if (statusData && statusData.status === 'committed' && statusData.data) {
            // 服务端已提交，视为成功，不删除 Storage
            return statusData.data;
          }
          if (statusData && (statusData.status === 'not_found' || statusData.status === 'failed')) {
            // A timeout can race the server's create transaction: "not_found"
            // is not proof that the request will never commit. Keep the
            // object and let the authoritative status reconciliation decide
            // later; deleting here can create an orphaned committed record.
            savePendingPhotoUpload({ uploadId: uploadId, path: path, publicUrl: publicUrl, fileName: file.name, fileSize: file.size, mimeType: type });
            fetchError.photoUploadStage = 'pending';
            fetchError._pendingRetry = true;
            fetchError._statusWasTerminal = true;
            throw fetchError;
          }
          // ★ 状态不确定（processing / 其他），不得删除 Storage
          // 保存 pending 状态，继续查询权威结果
          savePendingPhotoUpload({ uploadId: uploadId, path: path, publicUrl: publicUrl, fileName: file.name, fileSize: file.size, mimeType: type });
          fetchError.photoUploadStage = 'pending';
          fetchError._pendingRetry = true;
          throw fetchError;
        } catch(statusErr) {
          // ★ 状态查询失败，不得删除 Storage
          // 保存 pending 状态，稍后重试
          if (statusErr !== fetchError) {
            fetchError._statusQueryError = statusErr;
          }
          if (!fetchError._pendingRetry) {
            savePendingPhotoUpload({ uploadId: uploadId, path: path, publicUrl: publicUrl, fileName: file.name, fileSize: file.size, mimeType: type });
            fetchError.photoUploadStage = 'pending';
            fetchError._pendingRetry = true;
          }
          throw fetchError;
        }
      } else {
        fetchError.photoUploadCode = 'backend_unreachable';
        // A connection failure is ambiguous: the server may have committed
        // the row before the response was lost. Preserve the object and let
        // status reconciliation decide; deleting here could destroy a valid
        // photo record.
        savePendingPhotoUpload({ uploadId: uploadId, path: path, publicUrl: publicUrl, fileName: file.name, fileSize: file.size, mimeType: type });
        fetchError.photoUploadStage = 'pending';
        fetchError._pendingRetry = true;
        throw fetchError;
      }
    }
    clearTimeout(timeoutTimer);
    if (!createRes.ok) {
      if (state.cancelRequested) throw createPhotoUploadError('cancelled');
      var errBody = {};
      try { errBody = await createRes.json(); } catch (_) { errBody = {}; }
      var recordError = new Error((errBody && errBody.error) || '创建照片记录失败');
      recordError.status = createRes.status;
      recordError.photoUploadStage = 'record';
      await cleanupStorage(path, uploadId, cleanupAfterCreateOptions);
      throw recordError;
    }
    var createData;
    try { createData = await createRes.json(); } catch (parseError) { parseError.photoUploadStage = 'record'; await cleanupStorage(path, uploadId, cleanupAfterCreateOptions); throw parseError; }
    if (!createData || !createData.data) {
      await cleanupStorage(path, uploadId, cleanupAfterCreateOptions);
      throw createPhotoUploadError('record');
    }
    return createData.data;
  }

  function cancelCurrentUpload(){
    if (!state.uploading) return;
    state.cancelRequested = true;
    if (state.batchController) { try { state.batchController.abort(); } catch (_) {} }
  }

  function runBatch(jobs, onProgress){
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    state.batchController = controller;
    var signal = controller ? controller.signal : null;
    var total = jobs.length;
    var nextIdx = 0;
    var processed = 0;
    var ok = 0;
    var fail = 0;
    function runOne(){
      if (state.cancelRequested) return Promise.resolve();
      if (nextIdx >= total) return Promise.resolve();
      var idx = nextIdx; nextIdx += 1;
      var job = jobs[idx];
      if (job.succeeded) {
        processed += 1; ok += 1;
        onProgress && onProgress(processed, ok, fail);
        return runOne();
      }
      job.status = 'running';
      return uploadOnePhotoWallFile(job, signal).then(function(row){
        processed += 1; ok += 1; job.status = 'success'; job.succeeded = true; job.result = row;
        onProgress && onProgress(processed, ok, fail);
      }, function(err){
        processed += 1; fail += 1; job.status = 'failed'; job.error = err;
        onProgress && onProgress(processed, ok, fail);
      }).then(runOne);
    }
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, Math.max(1, total)); w++) workers.push(runOne());
    return Promise.all(workers).then(function(){ return { processed: processed, ok: ok, fail: fail }; });
  }

  function buildSummary(total, ok, fail){
    var s = '已处理 ' + total + ' 张：成功 ' + ok + ' 张，失败 ' + fail + ' 张';
    var skipped = (state.skippedFiles || []).length;
    if (skipped) s += '，跳过 ' + skipped + ' 张';
    return s;
  }

  async function performUpload(jobs){
    state.uploading = true;
    state.cancelRequested = false;
    var total = jobs.length;
    var processed = 0;
    var ok = 0;
    var fail = 0;
    var failures = [];
    try {
      updateUploadBatchProgress(processed, total, ok, fail, '正在准备上传');
      var result = await runBatch(jobs, function(p, o, f){
        processed = p; ok = o; fail = f;
        updateUploadBatchProgress(p, total, o, f, '正在处理第 ' + p + ' 张');
      });
      ok = result.ok; fail = result.fail;
      updateUploadBatchProgress(total, total, ok, fail, '处理完成');
    } finally {
      setProgress('');
      state.uploading = false;
      state.batchController = null;
    }
    jobs.forEach(function(j){
      if (j.status === 'failed' && j.error) {
        failures.push({
          name: String(j.file && j.file.name || '图片').slice(0, 80),
          reason: photoUploadFailureReason(j.error, j.error && j.error.photoUploadStage),
          job: j
        });
      }
    });
    state.failedJobs = failures.map(function(f){ return f.job; }).filter(Boolean);
    var refreshFailed = false;
    try {
      if (typeof window.loadPhotoWallData === 'function') await window.loadPhotoWallData(true);
      if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
      else if (typeof window.renderPhotoWall === 'function') await window.renderPhotoWall();
    } catch (e) { refreshFailed = true; }
    jobs.filter(function(j){ return j.succeeded && j.result; }).forEach(function(j){
      var row = j.result;
      if (row && typeof window.normalizePhotoWallRow === 'function') {
        var item = window.normalizePhotoWallRow(row);
        if (item && item.imageUrl) {
          window.photoWallData = Array.isArray(window.photoWallData) ? window.photoWallData : [];
          var newId = item.id || item.cloudId;
          var exists = window.photoWallData.some(function(p) { return (p.id && newId && String(p.id) === String(newId)) || (p.cloudId && newId && String(p.cloudId) === String(newId)); });
          if (!exists) window.photoWallData.unshift(item);
        }
      }
      if (window.broadcastSync && row && row.id) window.broadcastSync('photo_added', { photoId: row.id });
    });
    if (ok && typeof window.touchUserSession === 'function') window.touchUserSession(false);
    var summary = buildSummary(total, ok, fail);
    if (refreshFailed) summary += '。照片已上传，但列表刷新失败，请点击重试';
    var resultState = ok === 0 && fail > 0 ? 'error' : (fail > 0 ? 'partial' : 'success');
    var details = [];
    if (state.skippedFiles.length) {
      state.skippedFiles.slice(0, 3).forEach(function(s){ details.push((s.file && s.file.name ? s.file.name : '文件') + '（跳过：' + s.reason + '）'); });
    }
    failures.slice(0, 5).forEach(function(f){ details.push(f.name + '（' + f.reason + '）'); });
    var fullMsg = summary + (details.length ? '\n' + details.join('；') : '');
    setUploadResult(summary, resultState === 'error');
    setUploadResultState(fullMsg, resultState);
    toast(summary);
    await new Promise(function(resolve){ setTimeout(resolve, 180); });
  }

  async function uploadPhotoWallFiles(){
    if (state.uploading) { toast('正在上传，请等待'); return; }
    var user = getCurrentUser();
    if (!user) { toast('请先登录'); return; }
    if (!window.sb) { toast('Supabase 未加载，请刷新页面'); return; }
    if (!state.photoFiles.length) { toast('请选择照片'); return; }
    var jobs = state.photoFiles.map(function(f){
      return { file: f, uploadId: genUploadId(), status: 'pending' };
    });
    state.batchJobs = jobs;
    state.failedJobs = [];
    closeSheet({ force: true, restoreFocus: false });
    await performUpload(jobs);
    state.photoFiles = [];
    var input = byId('photoFileInput');
    if (input) input.value = '';
    revoke('photoUrls');
  }

  async function retryFailedUploads(){
    // ★ 修复：并发守卫——即使双监听路径已移除，仍防止快速连点/跨路径并发
    if (state.uploading || state.retrying) { toast('正在上传，请等待'); return; }
    state.retrying = true;
    try {
    var jobs = (state.failedJobs || []).filter(function(j){ return j && j.file && !j.succeeded; });
    if (!jobs.length) { toast('没有可重试的失败项'); return; }
    state.skippedFiles = [];
    // H-30: 先查询服务端权威状态，再决定是否清理旧文件并重新上传。
    // 网络超时后记录可能已经提交；状态为 committed/processing 时绝不能重复使用同一 uploadId。
    var retryJobs = [];
    var pendingJobs = [];
    var settledJobs = [];
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      var statusData = null;
      try {
        var statusHeaders = typeof window.getUserAuthHeaders === 'function' ? await window.getUserAuthHeaders() : {};
        var statusResp = await fetch((window.API_BASE || '') + '/api/photo/status', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, statusHeaders || {}),
          body: JSON.stringify({ upload_id: j.uploadId })
        });
        statusData = await statusResp.json().catch(function(){ return {}; });
        if (!statusResp.ok) throw new Error(statusData.error || '照片状态查询失败');
      } catch (statusError) {
        j.status = 'pending';
        j.error = statusError;
        j.error.photoUploadStage = 'pending';
        pendingJobs.push(j);
        continue;
      }
      if (statusData.status === 'committed' && statusData.data) {
        j.status = 'success';
        j.succeeded = true;
        j.result = statusData.data;
        settledJobs.push(j);
        continue;
      }
      if (statusData.status === 'processing') {
        j.status = 'pending';
        j.error = new Error('照片仍在服务端处理中');
        j.error.photoUploadStage = 'pending';
        pendingJobs.push(j);
        continue;
      }
      if (statusData.status !== 'failed' && statusData.status !== 'not_found') {
        j.status = 'pending';
        j.error = new Error('照片状态暂不可确认');
        j.error.photoUploadStage = 'pending';
        pendingJobs.push(j);
        continue;
      }
      if (j.storagePath) {
        try {
          var cleanupHeaders = typeof window.getUserAuthHeaders === 'function' ? await window.getUserAuthHeaders() : {};
          var cleanupResp = await fetch((window.API_BASE || '') + '/api/photo/cleanup', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, cleanupHeaders || {}),
            body: JSON.stringify({ path: j.storagePath, upload_id: j.uploadId })
          });
          var cleanupData = await cleanupResp.json().catch(function(){ return {}; });
          if (!cleanupResp.ok || !cleanupData.ok) throw new Error(cleanupData.error || '旧照片文件清理失败');
        } catch (cleanupError) {
          j.status = 'pending';
          j.error = cleanupError;
          j.error.photoUploadStage = 'pending';
          pendingJobs.push(j);
          continue;
        }
      }
      j.status = 'pending';
      j.error = null;
      retryJobs.push(j);
    }
    var uploadJobs = settledJobs.concat(retryJobs);
    if (uploadJobs.length) await performUpload(uploadJobs);
    state.failedJobs = (state.failedJobs || []).concat(pendingJobs);
    if (!uploadJobs.length && pendingJobs.length) toast('照片状态仍在确认中，请稍后重试');
    } finally {
      state.retrying = false;
    }
  }

  function attachPhotoUploadUi(){
    var input = byId('photoFileInput');
    var closeBtn = byId('pwUploadSheetClose');
    var reselectBtn = byId('pwUploadReselectBtn');
    var startBtn = byId('pwStartUploadBtn');
    var cancelBtn = byId('pwUploadProgressCancel');
    var retryBtn = byId('pwUploadResultRetry');
    var sheet = byId('pwUploadSheet');
    if (input) { input.setAttribute('accept', 'image/*'); input.multiple = true; }
    if (input && !input.__xtjUploadBound) {
      input.__xtjUploadBound = true;
      input.addEventListener('change', handlePhotoSelection);
    }
    if (closeBtn && !closeBtn.__xtjUploadBound) {
      closeBtn.__xtjUploadBound = true;
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', closeSheet);
    }
    if (sheet && !sheet.__xtjUploadBound) {
      sheet.__xtjUploadBound = true;
      sheet.addEventListener('click', function(event){ if (event.target === sheet) closeSheet(); });
    }
    if (!document.__xtjEscapeBound) {
      document.__xtjEscapeBound = true;
      document.addEventListener('keydown', function(event){
        if (event.key !== 'Escape' || state.uploading) return;
        var activeSheet = byId('pwUploadSheet');
        if (activeSheet && activeSheet.classList.contains('active')) { event.preventDefault(); closeSheet(); }
      });
    }
    if (reselectBtn && !reselectBtn.__xtjUploadBound) {
      reselectBtn.__xtjUploadBound = true;
      reselectBtn.addEventListener('click', function(){ if (!input) return; input.setAttribute('accept', 'image/*'); input.value = ''; input.click(); });
    }
    if (startBtn && !startBtn.__xtjUploadBound) {
      startBtn.__xtjUploadBound = true;
      startBtn.addEventListener('click', uploadPhotoWallFiles);
    }
    if (cancelBtn && !cancelBtn.__xtjCancelBound) {
      cancelBtn.__xtjCancelBound = true;
      cancelBtn.addEventListener('click', function(){
        cancelCurrentUpload();
        cancelBtn.disabled = true;
        cancelBtn.textContent = '正在取消...';
        setTimeout(function(){ cancelBtn.disabled = false; cancelBtn.textContent = '取消上传'; }, 500);
      });
    }
    // ★ 修复：不再在此处给 pwUploadResultRetry 绑定直接 click——该按钮同时受
    // bindUploadResultActions 的父容器 data-action 委托监听（596-609 行），
    // 双监听导致一次点击并发执行两次 retryFailedUploads，产生孤儿 Storage 文件
    // 与双倍流量。只保留父容器委托这一条路径。
  }

  function triggerPhotoUpload(){
    if (state.uploading) { toast('正在上传，请等待'); return; }
    var user = getCurrentUser();
    if (!user) { toast('请先登录'); return; }
    attachPhotoUploadUi();
    var input = byId('photoFileInput');
    if (!input) { toast('上传控件未加载，请刷新页面'); return; }
    input.setAttribute('accept', 'image/*');
    input.value = '';
    input.click();
  }

  function resetPostPreview(){
    var wrap = byId('postMediaPreview');
    var grid = byId('postMediaPreviewGrid');
    var count = byId('postMediaPreviewCount');
    revoke('postPreviewUrls');
    if (grid) grid.innerHTML = '';
    if (count) count.textContent = '已选择 0 个文件';
    if (wrap) { wrap.classList.remove('is-active'); wrap.style.display = 'none'; }
  }

  function setPostPreview(files){
    var list = Array.prototype.slice.call(files || []).filter(isMedia);
    var wrap = byId('postMediaPreview');
    var grid = byId('postMediaPreviewGrid');
    var count = byId('postMediaPreviewCount');
    resetPostPreview();
    if (!list.length || !wrap || !grid) return;
    wrap.style.display = '';
    requestAnimationFrame(function(){ wrap.classList.add('is-active'); });
    list.slice(0, 6).forEach(function(file, index){
      var url = URL.createObjectURL(file);
      state.postPreviewUrls.push(url);
      var node = document.createElement('div');
      node.className = 'post-media-preview-thumb';
      if (isVideo(file)) {
        var vid = document.createElement('video');
        vid.src = url; vid.muted = true; vid.playsInline = true;
        node.appendChild(vid);
        var tag = document.createElement('span');
        tag.className = 'post-media-preview-tag'; tag.textContent = '视频';
        node.appendChild(tag);
      } else {
        var img2 = document.createElement('img');
        img2.src = url; img2.alt = ''; img2.decoding = 'async'; if (index > 3) img2.loading = 'lazy';
        img2.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        node.appendChild(img2);
      }
      grid.appendChild(node);
    });
    if (count) count.textContent = '已选择 ' + list.length + ' 个文件';
  }

  function attachPostPreview(){
    var input = byId('fileInp');
    if (input && !input.__xtjPostPreviewBound) {
      input.__xtjPostPreviewBound = true;
      input.addEventListener('change', function(){ setPostPreview(input.files || []); });
    }
  }

  function boot(){ attachPhotoUploadUi(); attachPostPreview(); bindUploadResultActions(); }

  window.xtjUploadBtn = triggerPhotoUpload;
  window.triggerPhotoUpload = triggerPhotoUpload;
  window.attachPhotoUploadUi = attachPhotoUploadUi;
  window.handlePhotoUpload = handlePhotoSelection;
  window.triggerPhotoWallUpload = uploadPhotoWallFiles;
  window.cancelPhotoWallUpload = cancelCurrentUpload;
  window.retryFailedPhotoUploads = retryFailedUploads;
  window.resetPostPreview = resetPostPreview;
  window.setPhotoUploadResult = setUploadResult;
  window.setPhotoUploadResultState = setUploadResultState;
  window.clearPhotoUploadResult = clearUploadResult;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
