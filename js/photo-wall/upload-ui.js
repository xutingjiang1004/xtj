(function(){
  'use strict';

  var MARKER = '__photo_wall__';
  var state = {
    photoFiles: [],
    photoUrls: [],
    uploading: false,
    postPreviewUrls: []
  };

  window.PHOTO_WALL_MARKER = window.PHOTO_WALL_MARKER || MARKER;

  function byId(id){ return document.getElementById(id); }

  function apiUrl(path) {
    var base = (typeof window.API_BASE === 'string' && window.API_BASE)
      ? window.API_BASE.replace(/\/$/, '')
      : '';
    return base + path;
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

  var MAX_PHOTO_UPLOAD_BYTES = 25 * 1024 * 1024;
  var PHOTO_UPLOAD_TIMEOUT_MS = 25000;

  function createPhotoUploadError(code){
    var error = new Error(code || 'upload_failed');
    error.photoUploadCode = code || 'upload_failed';
    return error;
  }

  function photoUploadFailureReason(error, stage){
    var code = error && error.photoUploadCode;
    var status = Number(error && (error.status || error.statusCode)) || 0;
    var message = String(error && error.message || '').toLowerCase();
    if (code === 'unsupported_type') return '文件类型不支持';
    if (code === 'file_too_large') return '文件超过 25 MB 限制';
    if (code === 'timeout' || /timeout|timed out/.test(message)) return '网络超时';
    if (code === 'backend_unreachable' || stage === 'network') return '后端不可达';
    if (status === 401 || status === 403 || /jwt|token|unauthori[sz]ed|forbidden|登录/.test(message)) return '登录已过期';
    if (stage === 'storage') return '图片上传失败';
    if (stage === 'record') return '图片已上传，但记录保存失败';
    if (code === 'cleanup_failed') return '图片记录已保存，但清理临时文件失败';
    return '上传失败';
  }

  function cleanupStorage(path) {
    if (!path) return Promise.resolve();
    return window.sb.storage.from('uploads').remove([path])
      .then(function(r) {
        if (r && r.error) console.error('[photo-upload] Storage cleanup error', r.error);
      })
      .catch(function(e) { console.error('[photo-upload] Storage cleanup failed', e); });
  }

  function uploadBatchText(processed, total, success, failed, prefix){
    return (prefix ? prefix + '，' : '') + '已处理 ' + processed + ' / ' + total + '，成功 ' + success + '，失败 ' + failed;
  }

  function uploadBatchPercent(processed, total){
    return total > 0 ? Math.round((processed / total) * 100) : 100;
  }

  function updateUploadBatchProgress(processed, total, success, failed, prefix){
    var pct = uploadBatchPercent(processed, total);
    setProgress(uploadBatchText(processed, total, success, failed, prefix), pct);
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
    if (type === 'video/mp4') return '.mp4';
    if (type === 'video/webm') return '.webm';
    if (type === 'video/quicktime') return '.mov';
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
    result.textContent = message || '';
    result.hidden = !message;
    result.classList.toggle('is-error', !!isError);
  }

  function openSheet(files){
    var sheet = byId('pwUploadSheet');
    var grid = byId('pwUploadSheetGrid');
    var title = byId('pwUploadSheetTitle');
    var meta = byId('pwUploadSheetMeta');
    var count = byId('pwUploadSheetCount');
    if (!sheet || !grid) {
      toast('上传面板未加载，请刷新页面');
      return;
    }
    revoke('photoUrls');
    grid.innerHTML = '';
    files.forEach(function(file, index){
      var url = URL.createObjectURL(file);
      state.photoUrls.push(url);
      var item = document.createElement('div');
      item.className = 'pw-upload-sheet-thumb';
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      if (index > 3) img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      item.appendChild(img);
      grid.appendChild(item);
    });
    if (title) title.textContent = '选择完成，准备上传';
    if (meta) meta.textContent = '已选择 ' + files.length + ' 张照片，确认后开始上传。';
    if (count) count.textContent = files.length + ' 张照片';
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
    if (!text) {
      overlay.style.display = 'none';
      overlay.classList.remove('upload-overlay-visible');
      overlay.setAttribute('aria-hidden', 'true');
      if (trackEl) trackEl.hidden = true;
      if (fillEl) fillEl.style.width = '0%';
      return;
    }
    overlay.style.display = 'flex';
    overlay.classList.add('upload-overlay-visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (textEl) textEl.textContent = text || '';
    if (statusEl) {
      if (typeof pct === 'number' && pct >= 0 && pct <= 100) {
        statusEl.textContent = '当前进度 ' + Math.round(pct) + '%';
      } else {
        statusEl.textContent = '正在准备上传任务。';
      }
    }
    if (trackEl) trackEl.hidden = !(typeof pct === 'number' && pct >= 0 && pct <= 100);
    if (fillEl && typeof pct === 'number' && pct >= 0 && pct <= 100) {
      fillEl.style.width = Math.round(pct) + '%';
    }
  }

  function handlePhotoSelection(event){
    var input = event && event.target;
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    var selected = files.filter(isPhotoWallImage);
    if (!selected.length) {
      toast('请选择照片');
      return;
    }
    state.photoFiles = selected;
    openSheet(selected);
  }

  async function uploadOnePhotoWallFile(file, index, total){
    if (!isPhotoWallImage(file)) throw createPhotoUploadError('unsupported_type');
    if (!Number.isFinite(Number(file.size)) || Number(file.size) > MAX_PHOTO_UPLOAD_BYTES) {
      throw createPhotoUploadError('file_too_large');
    }
    var path = 'photos/' + safeFileName(file, inferExt(file));
    var type = isImage(file) && file.type ? file.type : 'image/jpeg';
    try {
      var upload = await window.sb.storage.from('uploads').upload(path, file, {
        contentType: type,
        cacheControl: '31536000',
        upsert: false
      });
      if (upload.error) { upload.error.photoUploadStage = 'storage'; throw upload.error; }
    } catch (storageError) {
      storageError.photoUploadStage = 'storage';
      throw storageError;
    }
    var publicUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
    var content = JSON.stringify({
      type: 'photo_wall',
      mediaKind: 'image',
      thumb: '',
      fileSize: file.size || null,
      originalSize: file.size || null,
      mimeType: type,
      duration: null
    });
    var actorKey = window.deviceId || ('photo_' + Date.now());
    var headers = (typeof window.getUserAuthHeaders === 'function')
      ? await window.getUserAuthHeaders()
      : { 'Content-Type': 'application/json' };
    if (!headers) headers = { 'Content-Type': 'application/json' };
    var controller = new AbortController();
    var timeoutTimer = setTimeout(function() { controller.abort(); }, PHOTO_UPLOAD_TIMEOUT_MS);
    var timedOut = false;
    var createRes;
    try {
      createRes = await fetch(apiUrl('/api/photo/create'), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          media_url: publicUrl,
          content: content,
          actor_key: actorKey
        }),
        signal: controller.signal
      });
    } catch (fetchError) {
      timedOut = fetchError.name === 'AbortError';
      if (timedOut) {
        fetchError.photoUploadCode = 'timeout';
      } else {
        fetchError.photoUploadCode = 'backend_unreachable';
      }
      fetchError.photoUploadStage = 'network';
      await cleanupStorage(path);
      throw fetchError;
    } finally {
      clearTimeout(timeoutTimer);
      if (controller.signal.aborted && !timedOut) {
      }
    }
    if (!createRes.ok) {
      await cleanupStorage(path);
      var errBody = {};
      try { errBody = await createRes.json(); } catch (_) {}
      var recordError = new Error(errBody.error || '创建照片记录失败');
      recordError.status = createRes.status;
      recordError.photoUploadStage = 'record';
      throw recordError;
    }
    var createData;
    try {
      createData = await createRes.json();
    } catch (parseError) {
      await cleanupStorage(path);
      parseError.photoUploadStage = 'record';
      throw parseError;
    }
    if (!createData || !createData.data) {
      await cleanupStorage(path);
      throw createPhotoUploadError('record');
    }
    return createData.data;
  }

  async function uploadPhotoWallFiles(){
    if (state.uploading) { toast('正在上传，请等待'); return; }
    var user = getCurrentUser();
    if (!user) { toast('请先登录'); return; }
    if (!window.sb) { toast('Supabase 未加载，请刷新页面'); return; }
    if (!state.photoFiles.length) { toast('请选择照片'); return; }
    state.uploading = true;
    closeSheet({ force: true, restoreFocus: false });
    var processed = 0;
    var ok = 0;
    var fail = 0;
    var failures = [];
    var total = state.photoFiles.length;
    try {
      updateUploadBatchProgress(processed, total, ok, fail, '正在准备上传');
      for (var i = 0; i < total; i++) {
        try {
          updateUploadBatchProgress(processed, total, ok, fail, '正在处理第 ' + (i + 1) + ' 张');
          var row = await uploadOnePhotoWallFile(state.photoFiles[i], i, total);
          ok += 1;
          if (row && typeof window.normalizePhotoWallRow === 'function') {
            var item = window.normalizePhotoWallRow(row);
            if (item && item.imageUrl) {
              window.photoWallData = Array.isArray(window.photoWallData) ? window.photoWallData : [];
              window.photoWallData.unshift(item);
            }
          }
          if (window.broadcastSync && row && row.id) window.broadcastSync('photo_added', { photoId: row.id });
        } catch (err) {
          console.error('[photo-upload] failed', err);
          fail += 1;
          failures.push({
            name: String(state.photoFiles[i] && state.photoFiles[i].name || '图片').slice(0, 80),
            reason: photoUploadFailureReason(err, err && err.photoUploadStage)
          });
        }
        processed += 1;
        updateUploadBatchProgress(processed, total, ok, fail, processed === total ? '处理完成' : '正在处理');
      }
    } finally {
      setProgress('');
      state.uploading = false;
      state.photoFiles = [];
      var input = byId('photoFileInput');
      if (input) input.value = '';
      revoke('photoUrls');
    }
    var refreshFailed = false;
    try {
      if (typeof window.loadPhotoWallData === 'function') await window.loadPhotoWallData(true);
      if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
      else if (typeof window.renderPhotoWall === 'function') await window.renderPhotoWall();
    } catch (refreshError) {
      console.error('[photo-upload] refresh failed', refreshError);
      refreshFailed = true;
    }
    if (ok && typeof window.touchUserSession === 'function') window.touchUserSession(false);
    var summary = '已处理 ' + total + ' 张：成功 ' + ok + ' 张，失败 ' + fail + ' 张';
    if (refreshFailed) summary += '。照片已上传，但列表刷新失败，请点击重试';
    if (failures.length) {
      var details = failures.slice(0, 3).map(function(item){ return item.name + '（' + item.reason + '）'; }).join('；');
      if (failures.length > 3) details += '；另有 ' + (failures.length - 3) + ' 张失败';
      setUploadResult(summary + '。' + details, true);
    } else {
      setUploadResult(summary, refreshFailed);
    }
    toast(summary);
    await new Promise(function(resolve){ setTimeout(resolve, 180); });
    if (refreshFailed && ok) {
      var retryBtn = byId('pwUploadResult');
      if (retryBtn) retryBtn.style.cursor = 'pointer';
    }
  }

  function attachPhotoUploadUi(){
    var input = byId('photoFileInput');
    var closeBtn = byId('pwUploadSheetClose');
    var reselectBtn = byId('pwUploadReselectBtn');
    var startBtn = byId('pwStartUploadBtn');
    var sheet = byId('pwUploadSheet');
    if (input) {
      input.setAttribute('accept', 'image/*');
      input.multiple = true;
    }
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
      sheet.addEventListener('click', function(event){
        if (event.target === sheet) closeSheet();
      });
    }
    if (!document.__xtjPhotoUploadEscapeBound) {
      document.__xtjPhotoUploadEscapeBound = true;
      document.addEventListener('keydown', function(event){
        if (event.key !== 'Escape' || state.uploading) return;
        var activeSheet = byId('pwUploadSheet');
        if (activeSheet && activeSheet.classList.contains('active')) {
          event.preventDefault();
          closeSheet();
        }
      });
    }
    if (reselectBtn && !reselectBtn.__xtjUploadBound) {
      reselectBtn.__xtjUploadBound = true;
      reselectBtn.addEventListener('click', function(){
        if (!input) return;
        input.setAttribute('accept', 'image/*');
        input.value = '';
        input.click();
      });
    }
    if (startBtn && !startBtn.__xtjUploadBound) {
      startBtn.__xtjUploadBound = true;
      startBtn.addEventListener('click', uploadPhotoWallFiles);
    }
  }

  function triggerPhotoUpload(){
    if (state.uploading) { toast('正在上传，请等待'); return; }
    var user = getCurrentUser();
    if (!user) { toast('请先登录'); return; }
    attachPhotoUploadUi();
    var input = byId('photoFileInput');
    if (!input) {
      console.error('[photo-upload] #photoFileInput not found');
      toast('上传控件未加载，请刷新页面');
      return;
    }
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
    if (wrap) {
      wrap.classList.remove('is-active');
      wrap.style.display = 'none';
    }
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

  function boot(){
    attachPhotoUploadUi();
    attachPostPreview();
  }

  window.xtjUploadBtn = triggerPhotoUpload;
  window.triggerPhotoUpload = triggerPhotoUpload;
  window.attachPhotoUploadUi = attachPhotoUploadUi;
  window.handlePhotoUpload = handlePhotoSelection;
  window.triggerPhotoWallUpload = uploadPhotoWallFiles;
  window.resetPostPreview = resetPostPreview;
  window.setPhotoUploadResult = setUploadResult;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
