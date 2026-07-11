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

  function closeSheet(){
    var sheet = byId('pwUploadSheet');
    if (!sheet) return;
    sheet.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
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
    var user = getCurrentUser();
    if (!isPhotoWallImage(file)) throw new Error('请选择图片');
    var path = 'photos/' + safeFileName(file, inferExt(file));
    var type = isImage(file) && file.type ? file.type : 'image/jpeg';
    setProgress('正在上传 ' + (index + 1) + ' / ' + total);
    var upload = await window.sb.storage.from('uploads').upload(path, file, {
      contentType: type,
      cacheControl: '31536000',
      upsert: false
    });
    if (upload.error) {
      console.error('[photo-upload] Storage upload error', upload.error);
      throw upload.error;
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
    var createRes = await fetch(apiUrl('/api/photo/create'), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        media_url: publicUrl,
        content: content,
        actor_key: actorKey
      })
    });
    if (!createRes.ok) {
      try {
        await window.sb.storage.from('uploads').remove([path]);
      } catch (_) {}
      var errBody = {};
      try { errBody = await createRes.json(); } catch (_) {}
      throw new Error(errBody.error || '创建照片记录失败');
    }
    var createData = await createRes.json();
    return createData.data;
  }

  async function uploadPhotoWallFiles(){
    if (state.uploading) return;
    var user = getCurrentUser();
    if (!user) { toast('请先登录'); return; }
    if (!window.sb) { toast('Supabase 未加载，请刷新页面'); return; }
    if (!state.photoFiles.length) { toast('请选择照片'); return; }
    state.uploading = true;
    closeSheet();
    var ok = 0;
    var fail = 0;
    var firstError = '';
    try {
      for (var i = 0; i < state.photoFiles.length; i++) {
        try {
          var pct = state.photoFiles.length > 1 ? Math.round((i / state.photoFiles.length) * 100) : 0;
          setProgress('正在上传 ' + (i + 1) + ' / ' + state.photoFiles.length, pct);
          var row = await uploadOnePhotoWallFile(state.photoFiles[i], i, state.photoFiles.length);
          ok += 1;
          setProgress('已上传 ' + ok + ' / ' + state.photoFiles.length, Math.round((ok / state.photoFiles.length) * 100));
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
          if (!firstError) firstError = err && err.message ? err.message : '上传失败';
        }
      }
      if (typeof window.loadPhotoWallData === 'function') await window.loadPhotoWallData(true);
      if (typeof window.renderPhotoWallWithoutReload === 'function') window.renderPhotoWallWithoutReload();
      else if (typeof window.renderPhotoWall === 'function') await window.renderPhotoWall();
      if (ok && typeof window.touchUserSession === 'function') window.touchUserSession(false);
      if (ok) toast('已上传 ' + ok + ' 张照片' + (fail ? '，失败 ' + fail + ' 张' : ''));
      else toast(firstError || '上传失败');
    } finally {
      setProgress('');
      state.uploading = false;
      state.photoFiles = [];
      var input = byId('photoFileInput');
      if (input) input.value = '';
      revoke('photoUrls');
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
