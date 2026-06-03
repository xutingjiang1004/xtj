(function() {
  'use strict';
  if (window.__xtjUploadUiV1) return;
  window.__xtjUploadUiV1 = true;

  var state = {
    photoFiles: [],
    sheetUrls: [],
    queueUrls: [],
    postUrls: [],
    uploading: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function revokeUrls(key) {
    var list = state[key];
    if (!Array.isArray(list)) return;
    while (list.length) {
      try { URL.revokeObjectURL(list.pop()); } catch (_) {}
    }
  }

  function safeToast(text) {
    if (typeof window.showToast === 'function') window.showToast(text);
  }

  function ensureProgressMarkup() {
    var overlay = byId('pwUploadProgressOverlay');
    if (!overlay || byId('pwUploadQueuePreview')) return;
    overlay.innerHTML = [
      '<div class="pw-upload-progress-container">',
      '  <div class="pw-upload-progress-hero">',
      '    <div class="pw-upload-local-spinner" aria-hidden="true">',
      '      <div class="pw-upload-local-ring"></div>',
      '      <div class="pw-upload-local-ring pw-upload-local-ring--inner"></div>',
      '      <div class="pw-upload-local-pulse"></div>',
      '      <span class="pw-upload-local-dot dot-a"></span>',
      '      <span class="pw-upload-local-dot dot-b"></span>',
      '      <span class="pw-upload-local-dot dot-c"></span>',
      '      <svg class="pw-upload-local-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">',
      '        <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 1 1 .5 6.96H15"></path>',
      '        <path d="M12 11v9"></path>',
      '        <path d="m8.5 14.5 3.5-3.5 3.5 3.5"></path>',
      '      </svg>',
      '    </div>',
      '    <div class="pw-upload-progress-copy">',
      '      <div class="pw-upload-progress-title" id="pwUploadProgressTitle">准备上传</div>',
      '      <div class="pw-upload-progress-text" id="pwUploadProgressText">0%</div>',
      '      <div class="pw-upload-progress-status" id="pwUploadProgressStatus">正在整理本次上传内容...</div>',
      '    </div>',
      '  </div>',
      '  <div class="pw-upload-local-bar-wrap">',
      '    <div class="pw-upload-progress-bar" id="pwUploadProgressBar" style="width:0%"></div>',
      '  </div>',
      '  <div class="pw-upload-queue-head">',
      '    <span>媒体队列</span>',
      '    <span id="pwUploadQueueCount">0 项</span>',
      '  </div>',
      '  <div class="pw-upload-queue" id="pwUploadQueuePreview"></div>',
      '</div>'
    ].join('');
  }

  function resetFileInput(id) {
    var input = byId(id);
    if (!input || !input.parentNode || input.__xtjUploadUiReset) return input;
    var clone = input.cloneNode(true);
    clone.__xtjUploadUiReset = true;
    input.parentNode.replaceChild(clone, input);
    return clone;
  }

  function makeThumb(file, className, indexLabel) {
    var node = document.createElement('div');
    node.className = className;
    var url = URL.createObjectURL(file);
    if (className.indexOf('pw-upload-queue') >= 0) state.queueUrls.push(url);
    else if (className.indexOf('pw-upload-sheet') >= 0) state.sheetUrls.push(url);
    else if (className.indexOf('post-media') >= 0) state.postUrls.push(url);
    node.innerHTML = '<img src="' + url + '" alt="' + (file.name || '') + '">';
    if (indexLabel) {
      var badge = document.createElement('span');
      badge.className = 'pw-upload-sheet-index';
      badge.textContent = indexLabel;
      node.appendChild(badge);
    }
    return node;
  }

  function renderUploadQueue(files) {
    ensureProgressMarkup();
    revokeUrls('queueUrls');
    var queue = byId('pwUploadQueuePreview');
    var count = byId('pwUploadQueueCount');
    if (!queue || !count) return;
    queue.innerHTML = '';
    var list = Array.prototype.slice.call(files || []);
    count.textContent = list.length + ' 项';
    var shown = Math.min(list.length, 5);
    for (var i = 0; i < shown; i++) {
      queue.appendChild(makeThumb(list[i], 'pw-upload-queue-thumb'));
    }
    if (list.length > shown) {
      var more = document.createElement('div');
      more.className = 'pw-upload-queue-thumb pw-upload-queue-more';
      more.textContent = '+' + (list.length - shown);
      queue.appendChild(more);
    }
  }

  function openSheet(files) {
    revokeUrls('sheetUrls');
    var sheet = byId('pwUploadSheet');
    var grid = byId('pwUploadSheetGrid');
    var count = byId('pwUploadSheetCount');
    var meta = byId('pwUploadSheetMeta');
    if (!sheet || !grid || !count || !meta) return;
    grid.innerHTML = '';
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      grid.appendChild(makeThumb(list[i], 'pw-upload-sheet-thumb', String(i + 1)));
    }
    count.textContent = list.length + ' 张照片';
    meta.textContent = list.length > 1 ? '本次会按顺序连续上传，你可以先确认缩略图和数量。' : '确认后将立即开始上传，并显示真实进度。';
    sheet.classList.add('active');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    revokeUrls('sheetUrls');
    var sheet = byId('pwUploadSheet');
    if (!sheet) return;
    sheet.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function setPostPreview(files) {
    revokeUrls('postUrls');
    var preview = byId('postMediaPreview');
    var grid = byId('postMediaPreviewGrid');
    var count = byId('postMediaPreviewCount');
    if (!preview || !grid || !count) return;
    grid.innerHTML = '';
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) {
      preview.style.display = 'none';
      preview.classList.remove('is-active');
      count.textContent = '已选择 0 个文件';
      return;
    }
    var shown = Math.min(list.length, 10);
    for (var i = 0; i < shown; i++) {
      var file = list[i];
      var url = URL.createObjectURL(file);
      state.postUrls.push(url);
      var thumb = document.createElement('div');
      thumb.className = 'post-media-preview-thumb';
      if (/^video\//.test(file.type)) {
        thumb.innerHTML = '<video src="' + url + '" muted playsinline preload="metadata"></video><span class="post-media-preview-tag">视频</span>';
      } else {
        thumb.innerHTML = '<img src="' + url + '" alt="' + (file.name || '') + '">';
      }
      grid.appendChild(thumb);
    }
    if (list.length > shown) {
      var more = document.createElement('div');
      more.className = 'post-media-preview-thumb post-media-preview-more';
      more.textContent = '+' + (list.length - shown);
      grid.appendChild(more);
    }
    count.textContent = '已选择 ' + list.length + ' 个文件';
    preview.style.display = 'block';
    requestAnimationFrame(function() {
      preview.classList.add('is-active');
    });
  }

  function beginPublishTransition() {
    var box = byId('publishBox');
    var btn = byId('pubBtn');
    if (box) box.classList.add('is-submitting');
    if (btn) {
      btn.classList.add('is-loading');
      btn.dataset.xtjUploadLabel = btn.textContent;
      btn.textContent = '发布中';
    }
  }

  function endPublishTransition() {
    var box = byId('publishBox');
    var btn = byId('pubBtn');
    if (box) box.classList.remove('is-submitting');
    if (btn) {
      btn.classList.remove('is-loading');
      btn.textContent = btn.dataset.xtjUploadLabel || '发布动态';
    }
    var fileInp = byId('fileInp');
    var postInp = byId('postInp');
    if (fileInp && (!fileInp.files || !fileInp.files.length) && postInp && !String(postInp.value || '').trim()) {
      setPostPreview([]);
    }
  }

  function attachPostPreview() {
    var fileInp = resetFileInput('fileInp');
    if (!fileInp || fileInp.__xtjPreviewBound) return;
    fileInp.__xtjPreviewBound = true;
    fileInp.addEventListener('change', function() {
      setPostPreview(this.files || []);
    });
  }

  function wrapPublish() {
    if (typeof window.doPublish !== 'function' || window.doPublish.__xtjUploadUiWrapped) return;
    var original = window.doPublish;
    window.doPublish = function() {
      beginPublishTransition();
      return Promise.resolve(original.apply(this, arguments)).finally(endPublishTransition);
    };
    window.doPublish.__xtjUploadUiWrapped = true;
  }

  function handlePhotoUploadSelection(e) {
    var files = (e && e.target && e.target.files) ? Array.prototype.slice.call(e.target.files) : [];
    var selected = files.filter(function(file) {
      return file && /^image\//.test(file.type);
    });
    if (!selected.length) {
      safeToast('请选择有效的照片文件');
      return;
    }
    window.validFiles = selected.slice();
    window.successCount = 0;
    window.failCount = 0;
    state.photoFiles = selected.slice();
    openSheet(selected);
  }

  function beginPhotoUpload() {
    if (state.uploading) return;
    if (!state.photoFiles.length) {
      safeToast('请先选择照片');
      return;
    }
    if (typeof window.triggerPhotoUpload !== 'function') {
      safeToast('上传功能尚未就绪，请刷新后重试');
      return;
    }
    state.uploading = true;
    window.validFiles = state.photoFiles.slice();
    window.successCount = 0;
    window.failCount = 0;
    renderUploadQueue(state.photoFiles);
    closeSheet();
    var startBtn = byId('pwStartUploadBtn');
    if (startBtn) startBtn.disabled = true;
    Promise.resolve(window.triggerPhotoUpload()).catch(function(err) {
      console.error('[photo-upload-ui] upload failed', err);
      safeToast(err && err.message ? err.message : '上传失败，请重试');
    }).finally(function() {
      state.uploading = false;
      state.photoFiles = [];
      revokeUrls('queueUrls');
      if (startBtn) startBtn.disabled = false;
    });
  }

  function attachPhotoUploadUi() {
    var input = resetFileInput('photoFileInput');
    var closeBtn = byId('pwUploadSheetClose');
    var reselectBtn = byId('pwUploadReselectBtn');
    var startBtn = byId('pwStartUploadBtn');
    var sheet = byId('pwUploadSheet');
    if (input && !input.__xtjUploadUiBound) {
      input.__xtjUploadUiBound = true;
      input.addEventListener('change', handlePhotoUploadSelection);
    }
    if (closeBtn && !closeBtn.__xtjUploadUiBound) {
      closeBtn.__xtjUploadUiBound = true;
      closeBtn.addEventListener('click', function() {
        closeSheet();
      });
    }
    if (sheet && !sheet.__xtjUploadUiBound) {
      sheet.__xtjUploadUiBound = true;
      sheet.addEventListener('click', function(e) {
        if (e.target === sheet) closeSheet();
      });
    }
    if (reselectBtn && !reselectBtn.__xtjUploadUiBound) {
      reselectBtn.__xtjUploadUiBound = true;
      reselectBtn.addEventListener('click', function() {
        if (!input) return;
        input.value = '';
        input.click();
      });
    }
    if (startBtn && !startBtn.__xtjUploadUiBound) {
      startBtn.__xtjUploadUiBound = true;
      startBtn.addEventListener('click', beginPhotoUpload);
    }
  }

  window.xtjUploadBtn = function() {
    if (!window.currentUser) {
      safeToast('请先登录');
      return;
    }
    var input = byId('photoFileInput');
    if (!input) return;
    input.value = '';
    input.click();
  };

  window.handlePhotoUpload = handlePhotoUploadSelection;

  function boot() {
    ensureProgressMarkup();
    attachPhotoUploadUi();
    attachPostPreview();
    wrapPublish();
    if (byId('fileInp') && byId('fileInp').files && byId('fileInp').files.length) {
      setPostPreview(byId('fileInp').files);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
