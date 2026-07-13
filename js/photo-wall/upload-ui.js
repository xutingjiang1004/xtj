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

  var MAX_PHOTO_UPLOAD_BYTES = 25 * 1024 * 1024;
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

  function isImage(file){ return !!(file && /^image\//i.test(file.type || '')); }
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
    if (code === 'file_too_large') return '文件超过 25 MB 限制';
    if (code === 'timeout' || /timeout|timed out/.test(message)) return '网络超时';
    if (code === 'backend_unreachable' || stage === 'network') return '后端不可达';
    if (status === 401 || status === 403 || /jwt|token|unauthori[sz]ed|forbidden|登录/.test(message)) return '登录已过期';
    if (status === 429) return '请求过于频繁，请稍后重试';
    if (stage === 'storage') return '图片上传失败';
    if (stage === 'record') return '图片已上传，但记录保存失败';
    return '上传失败';
  }

  function cleanupStorage(path){
    if (!path) return Promise.resolve();
    return Promise.resolve().then(function(){
      try { return window.sb.storage.from('uploads').remove([path]); }
      catch (e) { return { error: e }; }
    }).then(function(result){
      if (result && result.error) {
        var msg = String((result.error && (result.error.message || result.error.error)) || '').toLowerCase();
        if (/not.?found|does not exist|no such|404/.test(msg)) return;
        console.error('[photo-upload] Storage cleanup error', result.error);
      }
    }).catch(function(e){
      var msg = String((e && (e.message || e.error)) || '').toLowerCase();
      if (/not.?found|does not exist|no such|404/.test(msg)) return;
      console.error('[photo-upload] Storage cleanup failed', e);
    });
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

  function safeFileName(file, fallbackExt){
    var name = String(file && file.name || 'media');
    var extMatch = name.match(/\.[a-z0-9]{1,8}$/i);
    var ext = extMatch ? extMatch[0].toLowerCase() : (fallbackExt || '');
    var base = extMatch ? name.slice(0, -ext.length) : name;
    if (base.normalize) base = base.normalize('NFKD');
    base = base.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
    if (!base) base = 'media';
    return Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + base + ext;
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
    options = options || {};
    var sheet = byId('pwUploadSheet');
    if (!sheet) return;
    if (state.uploading && !options.force) return;
    sheet.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
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
      if (size > MAX_PHOTO_UPLOAD_BYTES) { skipped.push({ file: f, reason: '超过单张 25MB 限制' }); continue; }
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
    if (!text) {
      overlay.style.display = 'none';
      overlay.classList.remove('upload-overlay-visible');
      overlay.setAttribute('aria-hidden', 'true');
      if (trackEl) trackEl.hidden = true;
      if (fillEl) fillEl.style.width = '0%';
      if (cancelBtn) cancelBtn.hidden = true;
      return;
    }
    overlay.style.display = 'flex';
    overlay.classList.add('upload-overlay-visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (textEl) textEl.textContent = text || '';
    if (statusEl) statusEl.textContent = (typeof pct === 'number') ? ('当前进度 ' + Math.round(pct) + '%') : '正在准备上传任务。';
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

  async function uploadOnePhotoWallFile(file, uploadId, signal){
    if (state.cancelRequested || (signal && signal.aborted)) throw createPhotoUploadError('cancelled');
    if (!isPhotoWallImage(file)) throw createPhotoUploadError('unsupported_type');
    if (!Number.isFinite(Number(file.size)) || Number(file.size) > MAX_PHOTO_UPLOAD_BYTES) throw createPhotoUploadError('file_too_large');
    var path = 'photos/' + safeFileName(file, inferExt(file));
    var type = isImage(file) && file.type ? file.type : 'image/jpeg';
    var upload;
    try {
      upload = await window.sb.storage.from('uploads').upload(path, file, {
        contentType: type, cacheControl: '31536000', upsert: false
      });
    } catch (storageError) {
      storageError.photoUploadStage = 'storage';
      throw storageError;
    }
    if (upload && upload.error) { upload.error.photoUploadStage = 'storage'; throw upload.error; }
    if (state.cancelRequested || (signal && signal.aborted)) {
      await cleanupStorage(path);
      throw createPhotoUploadError('cancelled');
    }
    var publicUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
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
        await cleanupStorage(path);
        throw createPhotoUploadError('cancelled');
      }
      if (timedOut) {
        // ★ 超时不确定：先查询服务端是否已提交记录
        fetchError.photoUploadCode = 'timeout';
        fetchError.photoUploadStage = 'uncertain';
        try {
          var statusRes = await fetch(apiUrl('/api/photo/status'), {
            method: 'POST',
            headers: buildPhotoCreateHeaders(headers),
            body: JSON.stringify({ upload_id: uploadId }),
            signal: (typeof AbortController !== 'undefined' ? (new AbortController()).signal : undefined)
          });
          var statusData = await statusRes.json().catch(function(){ return {}; });
          if (statusData && statusData.status === 'committed' && statusData.data) {
            // 服务端已提交，视为成功，不删除 Storage
            return statusData.data;
          }
        } catch(statusErr) {
          // 状态查询失败，继续清理流程
        }
        // 未提交才清理 Storage
        await cleanupStorage(path);
        throw fetchError;
      } else {
        fetchError.photoUploadCode = 'backend_unreachable';
      }
      fetchError.photoUploadStage = 'network';
      await cleanupStorage(path);
      throw fetchError;
    }
    clearTimeout(timeoutTimer);
    if (state.cancelRequested) throw createPhotoUploadError('cancelled');
    if (!createRes.ok) {
      var errBody = {};
      try { errBody = await createRes.json(); } catch (_) { errBody = {}; }
      var recordError = new Error((errBody && errBody.error) || '创建照片记录失败');
      recordError.status = createRes.status;
      recordError.photoUploadStage = 'record';
      throw recordError;
    }
    var createData;
    try { createData = await createRes.json(); } catch (parseError) { parseError.photoUploadStage = 'record'; throw parseError; }
    if (!createData || !createData.data) {
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
      return uploadOnePhotoWallFile(job.file, job.uploadId, signal).then(function(row){
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
          window.photoWallData.unshift(item);
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
    if (state.uploading) { toast('正在上传，请等待'); return; }
    var jobs = (state.failedJobs || []).filter(function(j){ return j && j.file && !j.succeeded; });
    if (!jobs.length) { toast('没有可重试的失败项'); return; }
    state.skippedFiles = [];
    jobs.forEach(function(j){ j.status = 'pending'; j.error = null; });
    await performUpload(jobs);
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
    if (retryBtn && !retryBtn.__xtjRetryBound) {
      retryBtn.__xtjRetryBound = true;
      retryBtn.addEventListener('click', retryFailedUploads);
    }
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
