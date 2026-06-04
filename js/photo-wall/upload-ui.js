(function() {
  'use strict';
  if (window.__xtjUploadUiV3) return;
  window.__xtjUploadUiV3 = true;

  var state = {
    photoFiles: [],
    photoUrls: [],
    queueUrls: [],
    postUrls: [],
    photoUploading: false,
    postPublishing: false,
    postPreviewMode: false,
    savedPwCurrentSortedPhotos: null,
    restoreTimer: null
  };

  var TIMEOUTS = {
    photoUpload: 45000,
    photoInsert: 30000,
    postUpload: 45000,
    postInsert: 30000
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function toast(text) {
    if (typeof window.showToast === 'function') window.showToast(text);
  }

  function withTimeout(promise, ms, label) {
    var timer = null;
    var timeout = new Promise(function(_, reject) {
      timer = setTimeout(function() {
        reject(new Error((label || 'task') + ' timed out after ' + ms + 'ms'));
      }, ms);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(function() {
      if (timer) clearTimeout(timer);
    });
  }

  function revokeUrls(key) {
    var list = state[key];
    if (!Array.isArray(list)) return;
    while (list.length) {
      try { URL.revokeObjectURL(list.pop()); } catch (_) {}
    }
  }

  function ensureOverlayAtBody() {
    var overlay = byId('pwUploadProgressOverlay');
    if (overlay && overlay.parentNode !== document.body) {
      document.body.appendChild(overlay);
    }
  }

  function injectStyles() {
    if (byId('xtjUploadUiStyleV3')) return;
    var style = document.createElement('style');
    style.id = 'xtjUploadUiStyleV3';
    style.textContent = [
      '.pw-upload-sheet{position:fixed;inset:0;z-index:12000;display:flex;align-items:flex-end;justify-content:center;padding:18px 14px calc(24px + env(safe-area-inset-bottom,0px));background:rgba(221,241,231,.48);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);opacity:0;pointer-events:none;transition:opacity .22s ease;}',
      '.pw-upload-sheet.active{opacity:1;pointer-events:auto;}',
      '.pw-upload-sheet-card{width:min(100%,560px);max-height:min(76vh,720px);display:flex;flex-direction:column;gap:16px;padding:20px 18px 18px;border-radius:28px;background:linear-gradient(180deg,rgba(249,255,251,.98),rgba(235,248,239,.98));border:1px solid rgba(188,226,202,.95);box-shadow:0 24px 70px rgba(85,135,104,.18);transform:translateY(18px) scale(.985);transition:transform .24s cubic-bezier(.16,1,.3,1);}',
      '.pw-upload-sheet.active .pw-upload-sheet-card{transform:translateY(0) scale(1);}',
      '.pw-upload-sheet-head,.pw-upload-sheet-footer,.pw-upload-sheet-actions,.pw-upload-progress-hero,.pw-upload-queue-head{display:flex;align-items:center;}',
      '.pw-upload-sheet-head,.pw-upload-sheet-footer{justify-content:space-between;gap:12px;}',
      '.pw-upload-sheet-head h4{margin:3px 0 0;font-size:22px;line-height:1.1;color:#234a36;}',
      '.pw-upload-sheet-kicker{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#4a9b6a;}',
      '.pw-upload-sheet-head p,.pw-upload-sheet-count,.pw-upload-queue-head,.pw-upload-progress-status{color:rgba(53,94,72,.74);}',
      '.pw-upload-sheet-head p{margin:8px 0 0;font-size:13px;line-height:1.55;}',
      '.pw-upload-sheet-close{width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.9);color:#2d6146;font-size:24px;line-height:1;cursor:pointer;box-shadow:0 10px 24px rgba(95,143,113,.14);}',
      '.pw-upload-sheet-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:10px;overflow:auto;padding-right:2px;}',
      '.pw-upload-sheet-thumb,.pw-upload-queue-thumb{position:relative;overflow:hidden;border-radius:14px;background:rgba(255,255,255,.86);border:1px solid rgba(190,224,202,.88);box-shadow:inset 0 1px 0 rgba(255,255,255,.8);}',
      '.pw-upload-sheet-thumb{aspect-ratio:1/1;}',
      '.pw-upload-sheet-thumb img,.pw-upload-queue-thumb img{display:block;width:100%;height:100%;object-fit:cover;}',
      '.pw-upload-sheet-index{position:absolute;left:8px;bottom:8px;z-index:1;font-size:11px;font-weight:700;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.28);}',
      '.pw-upload-sheet-count{font-size:12px;font-weight:700;}',
      '.pw-upload-sheet-actions{gap:10px;}',
      '.pw-upload-sheet-btn{height:42px;padding:0 18px;border-radius:999px;border:1px solid rgba(146,202,168,.54);font-size:14px;font-weight:700;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease;}',
      '.pw-upload-sheet-btn:active{transform:scale(.98);}',
      '.pw-upload-sheet-btn.is-ghost{background:rgba(255,255,255,.72);color:#2f6b4c;}',
      '.pw-upload-sheet-btn.is-primary{background:linear-gradient(135deg,#62b883,#8edaae);color:#fff;box-shadow:0 12px 26px rgba(87,171,120,.24);}',
      '.pw-upload-local-overlay{position:fixed;inset:0;z-index:12100;display:none;align-items:center;justify-content:center;padding:22px 16px;background:rgba(225,243,232,.42);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}',
      '.pw-upload-local-overlay.upload-overlay-visible{display:flex;}',
      '.pw-upload-progress-container{width:min(100%,400px);display:flex;flex-direction:column;gap:14px;padding:22px 20px 18px;border-radius:28px;background:linear-gradient(180deg,rgba(248,255,250,.98),rgba(232,247,237,.98));border:1px solid rgba(191,228,204,.96);box-shadow:0 26px 72px rgba(88,139,108,.18);}',
      '.pw-upload-progress-hero{gap:16px;}',
      '.pw-upload-progress-copy{min-width:0;flex:1;}',
      '.pw-upload-local-spinner{position:relative;width:76px;height:76px;flex:0 0 76px;display:grid;place-items:center;}',
      '.pw-upload-local-ring,.pw-upload-local-pulse{position:absolute;inset:0;border-radius:50%;}',
      '.pw-upload-local-ring{border:1.5px solid rgba(110,183,139,.24);animation:xtjUploadSpin 3.2s linear infinite;}',
      '.pw-upload-local-ring--inner{inset:10px;border-color:rgba(135,209,165,.48);animation-direction:reverse;animation-duration:2.1s;}',
      '.pw-upload-local-pulse{inset:15px;background:radial-gradient(circle,rgba(123,214,160,.42),rgba(78,143,103,.06) 68%,transparent 72%);animation:xtjUploadPulse 2.4s ease-in-out infinite;}',
      '.pw-upload-local-dot{position:absolute;width:7px;height:7px;border-radius:50%;background:#6bcf9a;box-shadow:0 0 12px rgba(107,207,154,.55);animation:xtjUploadOrbit 2.2s ease-in-out infinite;}',
      '.pw-upload-local-dot.dot-a{top:6px;left:34px;}.pw-upload-local-dot.dot-b{right:10px;bottom:18px;animation-delay:.35s;}.pw-upload-local-dot.dot-c{left:10px;bottom:20px;animation-delay:.7s;}',
      '.pw-upload-local-icon{position:relative;z-index:1;color:#3e8d61;}',
      '.pw-upload-progress-title{font-size:15px;font-weight:800;color:#28533c;}',
      '.pw-upload-progress-text{margin-top:5px;font-size:30px;font-weight:800;line-height:1;color:#2ca866;font-variant-numeric:tabular-nums;}',
      '.pw-upload-progress-status{margin-top:6px;font-size:12px;line-height:1.5;}',
      '.pw-upload-local-bar-wrap{width:100%;height:10px;border-radius:999px;background:rgba(128,184,148,.16);overflow:hidden;}',
      '.pw-upload-progress-bar{position:relative;height:100%;border-radius:inherit;background:linear-gradient(90deg,#5fbf83,#7ed7a0 52%,#a5ebc1);background-size:200% 100%;animation:xtjUploadBarFlow 2.6s linear infinite;box-shadow:0 0 18px rgba(102,199,136,.22);}',
      '.pw-upload-progress-bar::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);animation:xtjUploadBarShine 1.6s ease-in-out infinite;}',
      '.pw-upload-queue-head{justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.04em;}',
      '.pw-upload-queue{display:flex;gap:8px;min-height:48px;}',
      '.pw-upload-queue-thumb{width:46px;height:46px;border-radius:14px;flex:0 0 auto;}',
      '.pw-upload-queue-more{display:grid;place-items:center;color:#3f7757;font-size:12px;font-weight:800;background:linear-gradient(180deg,rgba(240,252,244,.96),rgba(227,245,234,.96));}',
      '.post-media-preview{padding:10px 0 4px;margin-top:8px;border-top:1px solid rgba(114,166,131,.14);opacity:0;transform:translateY(-4px);transition:opacity .22s ease,transform .22s ease;overflow:hidden;}',
      '.post-media-preview.is-active{opacity:1;transform:translateY(0);}',
      '.post-media-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,48px);grid-auto-rows:48px;gap:8px;justify-content:flex-start;max-width:100%;overflow:hidden;}',
      '.post-media-preview-thumb{position:relative;width:48px;height:48px;border-radius:14px;overflow:hidden;background:rgba(255,255,255,.82);border:1px solid rgba(190,224,202,.88);box-shadow:inset 0 1px 0 rgba(255,255,255,.8);}',
      '.post-media-preview-thumb img,.post-media-preview-thumb video{display:block;width:100%;height:100%;object-fit:cover;}',
      '.post-media-preview-tag{position:absolute;right:4px;bottom:4px;z-index:1;padding:1px 5px;border-radius:999px;background:rgba(31,65,47,.64);color:#fff;font-size:8px;font-weight:700;line-height:1.2;}',
      '.post-media-preview-more{display:grid;place-items:center;color:#3d6f53;font-size:12px;font-weight:800;background:linear-gradient(180deg,rgba(240,252,244,.96),rgba(227,245,234,.96));}',
      '.post-media-preview-count{margin-top:6px;font-size:11px;font-weight:700;color:rgba(61,94,75,.72);}',
      '.publish-box.is-submitting{transform:translateY(-1px);box-shadow:0 22px 46px rgba(76,149,104,.12);}',
      '.btn-primary.is-loading{position:relative;pointer-events:none;background:linear-gradient(135deg,#62b883,#8edaae)!important;color:#fff!important;box-shadow:0 12px 28px rgba(87,171,120,.24)!important;}',
      '.btn-primary.is-loading::after{content:"";display:inline-block;width:14px;height:14px;margin-left:8px;border-radius:50%;border:2px solid rgba(255,255,255,.34);border-top-color:#fff;vertical-align:-2px;animation:xtjUploadSpin .85s linear infinite;}',
      '.pp-compact-btn,#ppCompactBtn{display:none!important;}',
      '.pp-post-mode .pp-delete-btn,.pp-post-mode #ppDeleteBtn{display:none!important;}',
      '@keyframes xtjUploadSpin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}',
      '@keyframes xtjUploadPulse{0%,100%{transform:scale(.92);opacity:.62;}50%{transform:scale(1.06);opacity:1;}}',
      '@keyframes xtjUploadOrbit{0%,100%{transform:scale(.8);opacity:.4;}50%{transform:translateY(-5px) scale(1.2);opacity:1;}}',
      '@keyframes xtjUploadBarFlow{0%{background-position:0 50%;}100%{background-position:200% 50%;}}',
      '@keyframes xtjUploadBarShine{0%{transform:translateX(-130%);}100%{transform:translateX(130%);}}',
      '@media (max-width:520px){.pw-upload-sheet{padding-left:12px;padding-right:12px;}.pw-upload-sheet-card{padding:18px 14px 14px;border-radius:24px;}.pw-upload-sheet-grid{grid-template-columns:repeat(auto-fill,minmax(64px,1fr));}.pw-upload-sheet-footer{flex-direction:column;align-items:stretch;}.pw-upload-sheet-actions{width:100%;}.pw-upload-sheet-btn{flex:1;justify-content:center;}.pw-upload-progress-container{padding:20px 16px 16px;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensureProgressMarkup() {
    var overlay = byId('pwUploadProgressOverlay');
    if (!overlay) return;
    ensureOverlayAtBody();
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
      '  <div class="pw-upload-local-bar-wrap"><div class="pw-upload-progress-bar" id="pwUploadProgressBar" style="width:0%"></div></div>',
      '  <div class="pw-upload-queue-head"><span>媒体队列</span><span id="pwUploadQueueCount">0 项</span></div>',
      '  <div class="pw-upload-queue" id="pwUploadQueuePreview"></div>',
      '</div>'
    ].join('');
  }

  function setProgress(percent, title, status) {
    var bar = byId('pwUploadProgressBar');
    var text = byId('pwUploadProgressText');
    var titleEl = byId('pwUploadProgressTitle');
    var statusEl = byId('pwUploadProgressStatus');
    var value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (bar) bar.style.width = value + '%';
    if (text) text.textContent = Math.round(value) + '%';
    if (titleEl && title) titleEl.textContent = title;
    if (statusEl && status) statusEl.textContent = status;
  }

  function showProgress() {
    var overlay = byId('pwUploadProgressOverlay');
    if (!overlay) return;
    ensureOverlayAtBody();
    overlay.style.display = 'flex';
    overlay.classList.add('upload-overlay-visible');
    setProgress(0, '准备上传', '正在整理本次上传内容...');
  }

  function hideProgress() {
    var overlay = byId('pwUploadProgressOverlay');
    if (!overlay) return;
    overlay.classList.remove('upload-overlay-visible');
    overlay.style.display = 'none';
    setProgress(0, '准备上传', '正在整理本次上传内容...');
    revokeUrls('queueUrls');
  }

  function resetFileInput(id) {
    var input = byId(id);
    if (!input || !input.parentNode || input.__xtjUploadUiReset) return input;
    var clone = input.cloneNode(true);
    clone.__xtjUploadUiReset = true;
    input.parentNode.replaceChild(clone, input);
    return clone;
  }

  function makeThumb(file, className, indexLabel, bucketKey) {
    var node = document.createElement('div');
    var url = URL.createObjectURL(file);
    node.className = className;
    if (bucketKey && Array.isArray(state[bucketKey])) state[bucketKey].push(url);
    node.innerHTML = '<img src="' + url + '" alt="' + (file.name || '') + '">';
    if (indexLabel) {
      var badge = document.createElement('span');
      badge.className = 'pw-upload-sheet-index';
      badge.textContent = indexLabel;
      node.appendChild(badge);
    }
    return node;
  }

  function renderQueue(files) {
    revokeUrls('queueUrls');
    var queue = byId('pwUploadQueuePreview');
    var count = byId('pwUploadQueueCount');
    if (!queue || !count) return;
    queue.innerHTML = '';
    var list = Array.prototype.slice.call(files || []);
    count.textContent = list.length + ' 项';
    var shown = Math.min(list.length, 5);
    for (var i = 0; i < shown; i++) {
      queue.appendChild(makeThumb(list[i], 'pw-upload-queue-thumb', '', 'queueUrls'));
    }
    if (list.length > shown) {
      var more = document.createElement('div');
      more.className = 'pw-upload-queue-thumb pw-upload-queue-more';
      more.textContent = '+' + (list.length - shown);
      queue.appendChild(more);
    }
  }

  function openSheet(files) {
    revokeUrls('photoUrls');
    var sheet = byId('pwUploadSheet');
    var grid = byId('pwUploadSheetGrid');
    var count = byId('pwUploadSheetCount');
    var meta = byId('pwUploadSheetMeta');
    if (!sheet || !grid || !count || !meta) return;
    grid.innerHTML = '';
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      grid.appendChild(makeThumb(list[i], 'pw-upload-sheet-thumb', String(i + 1), 'photoUrls'));
    }
    count.textContent = list.length + ' 张照片';
    meta.textContent = list.length > 1
      ? '本次会按顺序连续上传，你可以先确认缩略图和数量。'
      : '确认后将立即开始上传，并显示真实进度。';
    sheet.classList.add('active');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    revokeUrls('photoUrls');
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

  function beginPublishUi(label) {
    var box = byId('publishBox');
    var btn = byId('pubBtn');
    if (box) box.classList.add('is-submitting');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.dataset.xtjLabel = btn.textContent;
      btn.textContent = label || '发布中...';
    }
  }

  function endPublishUi() {
    var box = byId('publishBox');
    var btn = byId('pubBtn');
    if (box) box.classList.remove('is-submitting');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = btn.dataset.xtjLabel || '发布动态';
    }
  }

  function buildSafeFileName(file, fallbackExt) {
    var base = String(file && file.name ? file.name : 'upload').replace(/[^\w.\-]+/g, '_');
    if (base.indexOf('.') < 0 && fallbackExt) base += fallbackExt;
    return Date.now() + '_' + base;
  }

  function compressPhoto(file) {
    return new Promise(function(resolve) {
      if (!file || !/^image\//.test(file.type)) {
        resolve(file);
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function() {
        try {
          var w = img.naturalWidth || 0;
          var h = img.naturalHeight || 0;
          if (!w || !h) {
            URL.revokeObjectURL(url);
            resolve(file);
            return;
          }
          var maxSide = 1800;
          var ratio = Math.min(maxSide / w, maxSide / h, 1);
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(w * ratio);
          canvas.height = Math.round(h * ratio);
          var ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(file);
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function(blob) {
            URL.revokeObjectURL(url);
            resolve(blob || file);
          }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', file.type === 'image/png' ? undefined : 0.86);
        } catch (_) {
          URL.revokeObjectURL(url);
          resolve(file);
        }
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function makeThumbBlob(blob) {
    return new Promise(function(resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function() {
        try {
          var w = img.naturalWidth || 0;
          var h = img.naturalHeight || 0;
          var ratio = Math.min(400 / Math.max(w, 1), 400 / Math.max(h, 1), 1);
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * ratio));
          canvas.height = Math.max(1, Math.round(h * ratio));
          var ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(blob);
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function(nextBlob) {
            URL.revokeObjectURL(url);
            resolve(nextBlob || blob);
          }, 'image/jpeg', 0.72);
        } catch (_) {
          URL.revokeObjectURL(url);
          resolve(blob);
        }
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      img.src = url;
    });
  }

  async function uploadPhotoWallFiles() {
    if (!window.sb) throw new Error('Supabase 未就绪');
    if (!window.currentUser) throw new Error('请先登录');
    if (!state.photoFiles.length) throw new Error('请先选择照片');

    state.photoUploading = true;
    showProgress();
    renderQueue(state.photoFiles);

    var successCount = 0;
    var failCount = 0;
    for (var i = 0; i < state.photoFiles.length; i++) {
      var file = state.photoFiles[i];
      var start = (i / state.photoFiles.length) * 88;
      var end = ((i + 1) / state.photoFiles.length) * 88;
      try {
        setProgress(start, '正在处理', '第 ' + (i + 1) + '/' + state.photoFiles.length + ' 张图片');
        var compressed = await withTimeout(compressPhoto(file), TIMEOUTS.photoUpload, 'photo preprocess');
        var ext = file.type === 'image/png' ? '.png' : '.jpg';
        var name = buildSafeFileName(file, ext);
        var photoPath = 'photos/' + name;
        setProgress(start + (end - start) * 0.28, '正在上传', '原图上传中');
        var uploadRes = await withTimeout(window.sb.storage.from('uploads').upload(photoPath, compressed, {
          contentType: file.type || 'image/jpeg',
          cacheControl: '31536000',
          upsert: false
        }), TIMEOUTS.photoUpload, 'photo upload');
        if (uploadRes.error) throw uploadRes.error;

        var photoUrl = window.sb.storage.from('uploads').getPublicUrl(photoPath).data.publicUrl;
        setProgress(start + (end - start) * 0.62, '正在生成预览', '缩略图处理中');
        var thumbBlob = await withTimeout(makeThumbBlob(compressed), TIMEOUTS.photoUpload, 'thumbnail build');
        var thumbPath = 'thumbs/' + name;
        var thumbRes = await withTimeout(window.sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false
        }), TIMEOUTS.photoUpload, 'thumbnail upload');
        var thumbUrl = thumbRes && !thumbRes.error ? window.sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl : '';

        setProgress(start + (end - start) * 0.88, '正在保存', '写入照片墙记录');
        var contentJson = JSON.stringify({
          type: 'photo_wall',
          thumb: thumbUrl,
          fileSize: compressed && compressed.size ? compressed.size : (file.size || null)
        });
        var insertRes = await withTimeout(
          window.sb.from('posts').insert([{
            user_name: window.currentUser,
            content: contentJson,
            media_url: photoUrl,
            media_type: window.PHOTO_WALL_MARKER,
            actor_key: window.deviceId || 'photo_wall'
          }]).select('id,user_name,media_url,content,created_at,views,actor_key').single(),
          TIMEOUTS.photoInsert,
          'photo insert'
        );
        if (insertRes.error) throw insertRes.error;

        if (window.photoWallData && window.photoWallData.unshift && typeof window.normalizePhotoWallRow === 'function') {
          var normalized = window.normalizePhotoWallRow(insertRes.data);
          var exists = window.photoWallData.findIndex(function(item) {
            return String(item.id) === String(normalized.id);
          });
          if (exists < 0) window.photoWallData.unshift(normalized);
        }
        if (window.broadcastSync && insertRes.data && insertRes.data.id) {
          window.broadcastSync('photo_added', { photoId: insertRes.data.id });
        }
        successCount++;
      } catch (err) {
        console.error('[photo-upload-ui] photo wall upload failed', err);
        failCount++;
      }
    }

    if (window.saveLocalPhotoWallData) window.saveLocalPhotoWallData();
    if (window.renderPhotoWallWithoutReload) window.renderPhotoWallWithoutReload();
    else if (window.renderPhotoWall) await window.renderPhotoWall();

    setProgress(100, failCount ? '上传完成' : '上传成功', successCount + ' 张成功，' + failCount + ' 张失败');
    state.photoUploading = false;
    state.photoFiles = [];
    setTimeout(function() {
      hideProgress();
      if (successCount > 0) toast('成功上传 ' + successCount + ' 张照片');
      if (successCount === 0 && failCount > 0) toast('上传失败，请重试');
    }, 420);
  }

  async function publishPost() {
    if (!window.currentUser) {
      toast('请先登录');
      return;
    }
    if (state.postPublishing) return;

    var postInp = byId('postInp');
    var fileInp = byId('fileInp');
    var visibilityEl = byId('postVisibility');
    var content = postInp ? String(postInp.value || '').trim() : '';
    var file = fileInp && fileInp.files ? fileInp.files[0] : null;
    var visibility = visibilityEl ? visibilityEl.value : 'public';

    if (!content && !file) {
      toast('请输入帖子内容或选择媒体');
      return;
    }
    if (content.length > 2000) {
      toast('内容不能超过 2000 字');
      return;
    }

    state.postPublishing = true;
    beginPublishUi(file ? '上传中...' : '发布中...');
    try {
      var mediaUrl = '';
      var mediaType = '';
      var uploadFile = file;
      if (file) {
        if (/^image\//.test(file.type || '')) {
          uploadFile = await withTimeout(compressPhoto(file), Math.min(TIMEOUTS.postUpload, 24000), 'post image preprocess');
        }
        var path = buildSafeFileName(file, '');
        var uploadRes = await withTimeout(window.sb.storage.from('uploads').upload(path, uploadFile, {
          contentType: (uploadFile && uploadFile.type) || file.type || 'application/octet-stream',
          cacheControl: '31536000',
          upsert: false
        }), TIMEOUTS.postUpload, 'post media upload');
        if (uploadRes.error) throw uploadRes.error;
        mediaUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
        mediaType = /^video\//.test(file.type) ? 'video' : 'image';
      }

      var text = content.slice(0, 2000);
      var metadata = {
        visibility: visibility || 'public',
        is_pinned: false,
        pinned_at: null,
        updated_at: null,
        fileSize: uploadFile ? (uploadFile.size || file.size || null) : null,
        originalSize: file ? (file.size || null) : null,
        mimeType: file ? (file.type || '') : ''
      };
      var contentPayload = JSON.stringify({
        __type: '__xtj_post_v2__',
        text: text,
        meta: metadata
      });
      var payload = {
        user_name: window.currentUser,
        content: contentPayload,
        media_url: mediaUrl,
        media_type: mediaType,
        actor_key: window.deviceId,
        visibility: metadata.visibility,
        is_pinned: false,
        pinned_at: null,
        updated_at: null
      };
      var fallbackContent = contentPayload;
      var insertResult = await withTimeout((async function() {
        var primary = await window.sb.from('posts').insert([payload]).select('*').maybeSingle();
        if (!primary.error) return { ok: true, fallback: false, data: primary.data || null };
        var message = String(primary.error.message || '');
        if (!/visibility|is_pinned|pinned_at|updated_at|column/i.test(message)) {
          return { ok: false, error: primary.error };
        }
        var fallbackPayload = {
          user_name: payload.user_name,
          content: fallbackContent,
          media_url: payload.media_url,
          media_type: payload.media_type,
          actor_key: payload.actor_key
        };
        var fallback = await window.sb.from('posts').insert([fallbackPayload]).select('*').maybeSingle();
        if (fallback.error) return { ok: false, error: fallback.error };
        return { ok: true, fallback: true, data: fallback.data || null };
      })(), TIMEOUTS.postInsert, 'post insert');

      if (!insertResult.ok) {
        throw insertResult.error || new Error('post insert failed');
      }

      if (typeof window.clearFeedCache === 'function') window.clearFeedCache();
      if (typeof window.resetPostComposer === 'function') window.resetPostComposer();
      else {
        if (postInp) postInp.value = '';
        if (fileInp) fileInp.value = '';
        if (visibilityEl) visibilityEl.value = 'public';
      }
      setPostPreview([]);
      toast(insertResult.fallback ? '发布成功，已兼容旧数据结构' : '发布成功');
      if (insertResult.data && typeof window.xtjPrependPostToFeed === 'function') await window.xtjPrependPostToFeed(insertResult.data);
      else if (typeof window.loadFeed === 'function') await window.loadFeed(true);
    } catch (err) {
      console.error('[post-publish-ui] publish failed', err);
      toast('发布失败: ' + (err && err.message ? err.message : '请重试'));
    } finally {
      state.postPublishing = false;
      endPublishUi();
    }
  }

  function handlePhotoSelection(event) {
    var files = (event && event.target && event.target.files) ? Array.prototype.slice.call(event.target.files) : [];
    var selected = files.filter(function(file) {
      return file && /^image\//.test(file.type);
    });
    if (!selected.length) {
      toast('请选择有效的照片文件');
      return;
    }
    state.photoFiles = selected.slice();
    openSheet(selected);
  }

  function attachPhotoUploadUi() {
    var input = resetFileInput('photoFileInput');
    var closeBtn = byId('pwUploadSheetClose');
    var reselectBtn = byId('pwUploadReselectBtn');
    var startBtn = byId('pwStartUploadBtn');
    var sheet = byId('pwUploadSheet');

    if (input && !input.__xtjUploadUiBound) {
      input.__xtjUploadUiBound = true;
      input.addEventListener('change', handlePhotoSelection);
    }
    if (closeBtn && !closeBtn.__xtjUploadUiBound) {
      closeBtn.__xtjUploadUiBound = true;
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', closeSheet);
    }
    if (sheet && !sheet.__xtjUploadUiBound) {
      sheet.__xtjUploadUiBound = true;
      sheet.addEventListener('click', function(event) {
        if (event.target === sheet) closeSheet();
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
      startBtn.addEventListener('click', async function() {
        if (state.photoUploading) return;
        closeSheet();
        try {
          await uploadPhotoWallFiles();
        } catch (err) {
          state.photoUploading = false;
          hideProgress();
          console.error('[photo-upload-ui] fatal upload failure', err);
          toast(err && err.message ? err.message : '上传失败，请重试');
        }
      });
    }
  }

  function attachPostPreview() {
    var input = resetFileInput('fileInp');
    if (!input || input.__xtjPostPreviewBound) return;
    input.__xtjPostPreviewBound = true;
    input.addEventListener('change', function() {
      setPostPreview(this.files || []);
    });
  }

  function buildPostPreviewItems(img) {
    function readFileSize(node) {
      if (!node) return null;
      var raw = node.getAttribute('data-file-size') || node.getAttribute('data-size') || (node.dataset ? node.dataset.fileSize : '');
      var value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    var postCard = img.closest('.post');
    if (postCard) {
      var postId = postCard.getAttribute('data-post-id') || Date.now();
      var username = ((postCard.querySelector('.user-name') || {}).textContent || '帖子图片').trim();
      var timestamp = new Date().toISOString();
      var postImages = Array.prototype.slice.call(postCard.querySelectorAll('.media img'));
      return postImages.map(function(node, index) {
        return {
          id: 'post-' + postId + '-' + index,
          imageUrl: node.currentSrc || node.src,
          username: username,
          timestamp: timestamp,
          views: 0,
          fileSize: readFileSize(node),
          __xtjPostMode: true
        };
      }).filter(function(item) {
        return !!item.imageUrl;
      });
    }

    var detailMedia = img.closest('.post-detail-media');
    if (detailMedia) {
      var detailRoot = img.closest('#postDetailBody') || document;
      var detailName = ((detailRoot.querySelector('.pdh-name') || {}).textContent || '帖子图片').trim();
      var detailTime = new Date().toISOString();
      var detailImages = Array.prototype.slice.call(detailRoot.querySelectorAll('.post-detail-media img'));
      return detailImages.map(function(node, index) {
        return {
          id: 'post-detail-' + index + '-' + Date.now(),
          imageUrl: node.currentSrc || node.src,
          username: detailName,
          timestamp: detailTime,
          views: 0,
          fileSize: readFileSize(node),
          __xtjPostMode: true
        };
      }).filter(function(item) {
        return !!item.imageUrl;
      });
    }

    return [];
  }

  buildPostPreviewItems = function(img) {
    function readNumberAttr(node, keys) {
      if (!node) return null;
      var raw = '';
      for (var i = 0; i < keys.length; i++) {
        raw = node.getAttribute(keys[i]) || raw;
        if (!raw && node.dataset && keys[i].indexOf('data-') === 0) {
          var dataKey = keys[i].slice(5).replace(/-([a-z])/g, function(_, letter) { return letter.toUpperCase(); });
          raw = node.dataset[dataKey] || raw;
        }
        if (raw) break;
      }
      var value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    }

    function buildItemFromNode(node, index, fallbackId) {
      if (!node) return null;
      var imageUrl = node.currentSrc || node.src || node.getAttribute('data-media-url') || '';
      if (!imageUrl) return null;
      var postId = node.getAttribute('data-post-id') || fallbackId || Date.now();
      return {
        id: 'post-' + postId + '-' + index,
        postId: postId,
        imageUrl: imageUrl,
        username: (node.getAttribute('data-post-user') || '').trim() || '帖子图片',
        timestamp: node.getAttribute('data-post-created-at') || new Date().toISOString(),
        views: readNumberAttr(node, ['data-post-views']) || 0,
        fileSize: readNumberAttr(node, ['data-file-size', 'data-size']),
        originalSize: readNumberAttr(node, ['data-original-size']),
        __xtjPostMode: true
      };
    }

    var postCard = img.closest('.post');
    if (postCard) {
      var postId = postCard.getAttribute('data-post-id') || Date.now();
      return Array.prototype.slice.call(postCard.querySelectorAll('.media img')).map(function(node, index) {
        return buildItemFromNode(node, index, postId);
      }).filter(function(item) {
        return !!(item && item.imageUrl);
      });
    }

    var detailMedia = img.closest('.post-detail-media');
    if (detailMedia) {
      var detailRoot = img.closest('#postDetailBody') || document;
      return Array.prototype.slice.call(detailRoot.querySelectorAll('.post-detail-media img')).map(function(node, index) {
        return buildItemFromNode(node, index, node.getAttribute('data-post-id') || ('detail-' + Date.now()));
      }).filter(function(item) {
        return !!(item && item.imageUrl);
      });
    }

    return [];
  };

  function restorePostPreviewMode() {
    if (state.restoreTimer) {
      clearTimeout(state.restoreTimer);
      state.restoreTimer = null;
    }
    state.postPreviewMode = false;
    window.pwCurrentSortedPhotos = state.savedPwCurrentSortedPhotos;
    state.savedPwCurrentSortedPhotos = null;
    var overlay = byId('photoPreviewOverlay');
    if (overlay) overlay.classList.remove('pp-post-mode');
  }

  function wrapPhotoPreviewClose() {
    if (typeof window.closePhotoPreview !== 'function' || window.closePhotoPreview.__xtjPostPreviewWrapped) return;
    var original = window.closePhotoPreview;
    window.closePhotoPreview = function() {
      var wasPostMode = state.postPreviewMode;
      var result = original.apply(this, arguments);
      if (wasPostMode) state.restoreTimer = setTimeout(restorePostPreviewMode, 260);
      return result;
    };
    window.closePhotoPreview.__xtjPostPreviewWrapped = true;
  }

  buildPostPreviewItems = function(img) {
    function readNumberAttr(node, keys) {
      if (!node) return null;
      var raw = '';
      for (var i = 0; i < keys.length; i++) {
        raw = node.getAttribute(keys[i]) || raw;
        if (!raw && node.dataset && keys[i].indexOf('data-') === 0) {
          var dataKey = keys[i].slice(5).replace(/-([a-z])/g, function(_, letter) { return letter.toUpperCase(); });
          raw = node.dataset[dataKey] || raw;
        }
        if (raw) break;
      }
      var value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    }
    function buildItemFromNode(node, index, fallbackId) {
      if (!node) return null;
      var imageUrl = node.currentSrc || node.src || node.getAttribute('data-media-url') || '';
      if (!imageUrl) return null;
      var postId = node.getAttribute('data-post-id') || fallbackId || Date.now();
      var sourcePost = typeof window.xtjGetPostById === 'function' ? window.xtjGetPostById(postId) : null;
      var sourceMeta = sourcePost && sourcePost._contentMeta ? sourcePost._contentMeta : {};
      return {
        id: 'post-' + postId + '-' + index,
        postId: postId,
        imageUrl: imageUrl,
        username: (sourcePost && sourcePost.user_name) || (node.getAttribute('data-post-user') || '').trim() || '帖子图片',
        timestamp: (sourcePost && sourcePost.created_at) || node.getAttribute('data-post-created-at') || new Date().toISOString(),
        views: sourcePost ? Number(sourcePost.views || 0) : (readNumberAttr(node, ['data-post-views']) || 0),
        fileSize: sourceMeta.fileSize != null ? (Number(sourceMeta.fileSize) || null) : readNumberAttr(node, ['data-file-size', 'data-size']),
        originalSize: sourceMeta.originalSize != null ? (Number(sourceMeta.originalSize) || null) : readNumberAttr(node, ['data-original-size']),
        __xtjPostMode: true
      };
    }
    var postCard = img.closest('.post');
    if (postCard) {
      var postId = postCard.getAttribute('data-post-id') || Date.now();
      return Array.prototype.slice.call(postCard.querySelectorAll('.media img')).map(function(node, index) {
        return buildItemFromNode(node, index, postId);
      }).filter(function(item) { return !!(item && item.imageUrl); });
    }
    var detailMedia = img.closest('.post-detail-media');
    if (detailMedia) {
      var detailRoot = img.closest('#postDetailBody') || document;
      return Array.prototype.slice.call(detailRoot.querySelectorAll('.post-detail-media img')).map(function(node, index) {
        return buildItemFromNode(node, index, node.getAttribute('data-post-id') || ('detail-' + Date.now()));
      }).filter(function(item) { return !!(item && item.imageUrl); });
    }
    return [];
  };

  function openPostPreview(img) {
    var items = buildPostPreviewItems(img);
    if (!items.length) return false;
    var postId = items[0] && items[0].postId;
    if (postId && typeof window.xtjTrackPostView === 'function') {
      var tracked = !!window.xtjTrackPostView(postId);
      if (tracked) {
        items = items.map(function(item) {
          return Object.assign({}, item, { views: Number(item.views || 0) + 1 });
        });
      }
    }
    var currentUrl = img.currentSrc || img.src;
    var currentIndex = items.findIndex(function(item) {
      return item.imageUrl === currentUrl;
    });
    if (currentIndex < 0) currentIndex = 0;
    if (typeof window.openPhotoPreview !== 'function') {
      if (typeof window.openImageViewer === 'function') window.openImageViewer(items[currentIndex].imageUrl);
      return true;
    }

    state.savedPwCurrentSortedPhotos = window.pwCurrentSortedPhotos;
    state.postPreviewMode = true;
    window.pwCurrentSortedPhotos = items;
    wrapPhotoPreviewClose();
    window.openPhotoPreview(currentIndex, false);
    requestAnimationFrame(function() {
      var overlay = byId('photoPreviewOverlay');
      if (overlay) overlay.classList.add('pp-post-mode');
    });
    return true;
  }

  function attachPostPreviewBridge() {
    if (document.__xtjPostPreviewBridgeBound) return;
    document.__xtjPostPreviewBridgeBound = true;
    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!target || !(target instanceof Element)) return;
      var img = target.closest('.post .media img, .post-detail-media img');
      if (!img) return;
      if (openPostPreview(img)) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
    }, true);
  }

  function installPreviewControlOverrides() {
    if (window.__xtjPreviewControlOverridesInstalled) return;
    window.__xtjPreviewControlOverridesInstalled = true;

    function parseTransform(transform) {
      var text = String(transform || '');
      var tx = 0;
      var ty = 0;
      var scale = 1;
      var rotation = 0;
      var translateMatch = text.match(/translate3d\(\s*([-.\d]+)px\s*,\s*([-.\d]+)px/i) || text.match(/translate\(\s*([-.\d]+)px\s*,\s*([-.\d]+)px/i);
      var scaleMatch = text.match(/scale\(\s*([-.\d]+)\s*\)/i);
      var rotateMatch = text.match(/rotate\(\s*([-.\d]+)deg\s*\)/i);
      if (translateMatch) {
        tx = Number(translateMatch[1]) || 0;
        ty = Number(translateMatch[2]) || 0;
      }
      if (scaleMatch) scale = Number(scaleMatch[1]) || 1;
      if (rotateMatch) rotation = Number(rotateMatch[1]) || 0;
      return { tx: tx, ty: ty, scale: scale, rotation: rotation };
    }

    function applyTransformState(img, state) {
      if (!img || !state) return false;
      img.style.transition = 'transform .22s cubic-bezier(.16,1,.3,1)';
      img.style.transform = 'translate3d(' + state.tx + 'px,' + state.ty + 'px,0) scale(' + state.scale + ') rotate(' + state.rotation + 'deg)';
      if (state.scale > 1.01) img.classList.add('zoomed');
      else img.classList.remove('zoomed');
      return true;
    }

    function mutatePreviewTransform(mutator) {
      var img = byId('photoPreviewImage');
      if (!img) return false;
      var state = parseTransform(img.style.transform || '');
      mutator(state, img);
      state.scale = Math.max(1, Math.min(8, state.scale || 1));
      return applyTransformState(img, state);
    }

    function installWhenReady() {
      if (typeof window.openPhotoPreview !== 'function') {
        setTimeout(installWhenReady, 250);
        return;
      }

      if (!window.openPhotoPreview.__xtjPreviewCleanupWrapped) {
        var originalOpenPhotoPreview = window.openPhotoPreview;
        window.openPhotoPreview = function() {
          var result = originalOpenPhotoPreview.apply(this, arguments);
          requestAnimationFrame(function() {
            ['ppZoomOutBtn', 'ppZoomInBtn', 'ppInfoBtn', 'ppShareBtn', 'ppRotateBtn'].forEach(function(id) {
              var btn = byId(id);
              if (btn) {
                btn.style.opacity = '1';
                btn.style.transform = id === 'ppInfoBtn' ? 'translateX(-50%)' : 'translateY(0)';
              }
            });
            var compact = byId('ppCompactBtn');
            if (compact && compact.parentNode) compact.parentNode.removeChild(compact);
            var rotate = byId('ppRotateBtn');
            if (rotate) {
              rotate.title = '旋转 90 度';
              rotate.onclick = function() { window.ppRotatePhoto(); };
            }
          });
          return result;
        };
        window.openPhotoPreview.__xtjPreviewCleanupWrapped = true;
      }

      var rotateBtn = byId('ppRotateBtn');
      if (rotateBtn) {
        rotateBtn.title = '旋转 90 度';
        rotateBtn.onclick = function() { window.ppRotatePhoto(); };
      }
      var infoBtn = byId('ppInfoBtn');
      if (infoBtn) infoBtn.title = '照片信息';
      var compactBtn = byId('ppCompactBtn');
      if (compactBtn && compactBtn.parentNode) compactBtn.parentNode.removeChild(compactBtn);

      window.zoomIn = function() {
        mutatePreviewTransform(function(state) {
          state.scale = Math.min(8, (state.scale || 1) + 0.35);
        });
      };

      window.zoomOut = function() {
        mutatePreviewTransform(function(state) {
          state.scale = Math.max(1, (state.scale || 1) - 0.35);
          if (state.scale <= 1.01) {
            state.scale = 1;
            state.tx = 0;
            state.ty = 0;
          }
        });
      };

      window.ppRotatePhoto = function() {
        if (mutatePreviewTransform(function(state) {
          state.rotation = ((state.rotation || 0) + 90) % 360;
        })) {
          toast('已旋转 90°');
        }
      };

      if (typeof window.showPhotoInfo === 'function' && !window.showPhotoInfo.__xtjFileSizeWrapped) {
        var originalShowPhotoInfo = window.showPhotoInfo;
        var wrappedShowPhotoInfo = async function() {
          var current = window.photoPreviewCurrent || null;
          if (current && !current.fileSize && current.imageUrl) {
            try {
              var response = await fetch(current.imageUrl, { cache: 'force-cache' });
              if (response && response.ok) {
                var blob = await response.blob();
                if (blob && blob.size) current.fileSize = blob.size;
              }
            } catch (_) {}
          }
          return originalShowPhotoInfo.apply(this, arguments);
        };
        wrappedShowPhotoInfo.__xtjFileSizeWrapped = true;
        window.showPhotoInfo = wrappedShowPhotoInfo;
      }
    }

    installWhenReady();
  }

  function overridePublishHandler() {
    window.doPublish = publishPost;
  }

  function overridePhotoHandlers() {
    window.xtjUploadBtn = function() {
      if (!window.currentUser) {
        toast('请先登录');
        return;
      }
      var input = byId('photoFileInput');
      if (!input) return;
      input.value = '';
      input.click();
    };
    window.handlePhotoUpload = handlePhotoSelection;
    window.triggerPhotoUpload = uploadPhotoWallFiles;
  }

  function boot() {
    injectStyles();
    ensureOverlayAtBody();
    ensureProgressMarkup();
    attachPhotoUploadUi();
    attachPostPreview();
    attachPostPreviewBridge();
    installPreviewControlOverrides();
    wrapPhotoPreviewClose();
    overridePhotoHandlers();
    overridePublishHandler();
    var existingPostInput = byId('fileInp');
    if (existingPostInput && existingPostInput.files && existingPostInput.files.length) {
      setPostPreview(existingPostInput.files);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
