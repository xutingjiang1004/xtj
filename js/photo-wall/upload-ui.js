(function() {
  'use strict';
  if (window.__xtjUploadUiV2) return;
  window.__xtjUploadUiV2 = true;

  var state = {
    photoFiles: [],
    sheetUrls: [],
    queueUrls: [],
    postUrls: [],
    uploading: false,
    postPreviewMode: false,
    savedPwCurrentSortedPhotos: null,
    postPreviewRestoreTimer: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function safeToast(text) {
    if (typeof window.showToast === 'function') window.showToast(text);
  }

  function revokeUrls(key) {
    var list = state[key];
    if (!Array.isArray(list)) return;
    while (list.length) {
      try { URL.revokeObjectURL(list.pop()); } catch (_) {}
    }
  }

  function injectRuntimeStyles() {
    if (byId('xtjUploadUiRuntimeStyle')) return;
    var style = document.createElement('style');
    style.id = 'xtjUploadUiRuntimeStyle';
    style.textContent = [
      '.pw-upload-sheet{position:fixed;inset:0;z-index:11520;display:flex;align-items:flex-end;justify-content:center;padding:20px 16px calc(26px + env(safe-area-inset-bottom,0px));background:rgba(11,20,17,.16);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);opacity:0;pointer-events:none;transition:opacity .22s ease;}',
      '.pw-upload-sheet.active{opacity:1;pointer-events:auto;}',
      '.pw-upload-sheet-card{width:min(100%,560px);max-height:min(72vh,720px);display:flex;flex-direction:column;gap:16px;padding:20px 18px 18px;border-radius:26px;background:radial-gradient(circle at top right,rgba(171,236,198,.34),transparent 28%),linear-gradient(180deg,rgba(249,255,250,.98),rgba(232,247,237,.98));border:1px solid rgba(196,231,209,.92);box-shadow:0 24px 60px rgba(48,88,63,.18);transform:translateY(18px) scale(.98);transition:transform .28s cubic-bezier(.16,1,.3,1);}',
      '.pw-upload-sheet.active .pw-upload-sheet-card{transform:translateY(0) scale(1);}',
      '.pw-upload-sheet-head,.pw-upload-sheet-footer,.pw-upload-sheet-actions,.pw-upload-queue-head,.pw-upload-progress-hero{display:flex;align-items:center;}',
      '.pw-upload-sheet-head,.pw-upload-sheet-footer{justify-content:space-between;gap:14px;}',
      '.pw-upload-sheet-head h4{margin:4px 0 0;font-size:22px;line-height:1.1;color:#244734;}',
      '.pw-upload-sheet-kicker{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:rgba(54,124,83,.74);}',
      '.pw-upload-sheet-head p,.pw-upload-sheet-count,.pw-upload-queue-head{color:rgba(61,94,75,.72);}',
      '.pw-upload-sheet-head p{margin:8px 0 0;font-size:13px;line-height:1.6;}',
      '.pw-upload-sheet-close{width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.82);color:#27503a;font-size:28px;line-height:1;cursor:pointer;box-shadow:0 10px 24px rgba(71,118,92,.14);}',
      '.pw-upload-sheet-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:10px;overflow:auto;padding-right:2px;}',
      '.pw-upload-sheet-thumb,.pw-upload-queue-thumb{position:relative;overflow:hidden;border-radius:16px;background:rgba(255,255,255,.75);border:1px solid rgba(191,225,205,.84);box-shadow:inset 0 1px 0 rgba(255,255,255,.7);}',
      '.pw-upload-sheet-thumb{aspect-ratio:1/1;}',
      '.pw-upload-sheet-thumb img,.pw-upload-queue-thumb img{display:block;width:100%;height:100%;object-fit:cover;}',
      '.pw-upload-sheet-thumb::after,.pw-upload-queue-thumb::after{content:"";position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(180deg,transparent,rgba(13,27,18,.46));pointer-events:none;}',
      '.pw-upload-sheet-index{position:absolute;left:8px;bottom:8px;z-index:1;font-size:11px;font-weight:700;color:rgba(255,255,255,.92);}',
      '.pw-upload-sheet-count{font-size:12px;font-weight:700;}',
      '.pw-upload-sheet-actions{gap:10px;}',
      '.pw-upload-sheet-btn{height:42px;padding:0 18px;border-radius:999px;border:1px solid rgba(138,193,161,.36);font-size:14px;font-weight:700;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease;}',
      '.pw-upload-sheet-btn:active{transform:scale(.97);}',
      '.pw-upload-sheet-btn.is-ghost{background:rgba(255,255,255,.6);color:#2e6a4a;}',
      '.pw-upload-sheet-btn.is-primary{background:linear-gradient(135deg,#4aa56e,#6bcf9a);color:#fff;box-shadow:0 12px 28px rgba(76,149,104,.22);}',
      '.pw-upload-local-overlay{display:flex;align-items:center;justify-content:center;padding:18px 16px;}',
      '.pw-upload-progress-container{position:relative;width:min(100%,390px);display:flex;flex-direction:column;gap:14px;padding:20px 18px 18px;border-radius:26px;background:radial-gradient(circle at top right,rgba(112,211,155,.16),transparent 28%),linear-gradient(180deg,rgba(8,16,14,.92),rgba(13,23,18,.96));border:1px solid rgba(148,230,186,.14);box-shadow:0 24px 50px rgba(0,0,0,.28);}',
      '.pw-upload-progress-hero{gap:16px;}',
      '.pw-upload-progress-copy{min-width:0;flex:1;}',
      '.pw-upload-local-spinner{position:relative;width:74px;height:74px;flex:0 0 74px;display:grid;place-items:center;}',
      '.pw-upload-local-ring,.pw-upload-local-pulse{position:absolute;inset:0;border-radius:50%;}',
      '.pw-upload-local-ring{border:1.5px solid rgba(153,246,196,.2);animation:xtjUploadUiSpin 3.2s linear infinite;}',
      '.pw-upload-local-ring--inner{inset:9px;border-color:rgba(153,246,196,.34);animation-direction:reverse;animation-duration:2.1s;}',
      '.pw-upload-local-pulse{inset:14px;background:radial-gradient(circle,rgba(95,216,154,.34),rgba(36,74,55,.04) 68%,transparent 72%);animation:xtjUploadUiPulse 2.6s ease-in-out infinite;}',
      '.pw-upload-local-dot{position:absolute;width:7px;height:7px;border-radius:50%;background:#a7f3d0;box-shadow:0 0 12px rgba(167,243,208,.7);animation:xtjUploadUiOrbit 2.4s ease-in-out infinite;}',
      '.pw-upload-local-dot.dot-a{top:6px;left:32px;}.pw-upload-local-dot.dot-b{right:10px;bottom:20px;animation-delay:.4s;}.pw-upload-local-dot.dot-c{left:10px;bottom:18px;animation-delay:.8s;}',
      '.pw-upload-local-icon{position:relative;z-index:1;color:rgba(225,255,240,.92);filter:drop-shadow(0 10px 22px rgba(76,210,145,.22));}',
      '.pw-upload-progress-title{font-size:15px;font-weight:800;color:rgba(244,255,247,.96);}',
      '.pw-upload-progress-text{margin-top:6px;font-size:26px;font-weight:800;color:#86efac;font-variant-numeric:tabular-nums;}',
      '.pw-upload-progress-status{margin-top:4px;font-size:12px;line-height:1.5;color:rgba(214,237,223,.72);}',
      '.pw-upload-local-bar-wrap{width:100%;height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;}',
      '.pw-upload-progress-bar{position:relative;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2bb673,#6fdfb0 52%,#9ff2ce);background-size:200% 100%;animation:xtjUploadUiBarFlow 2.6s linear infinite;box-shadow:0 0 18px rgba(75,208,141,.24);}',
      '.pw-upload-progress-bar::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.34),transparent);animation:xtjUploadUiBarShine 1.7s ease-in-out infinite;}',
      '.pw-upload-queue-head{justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.04em;}',
      '.pw-upload-queue{display:flex;gap:8px;min-height:48px;}',
      '.pw-upload-queue-thumb{width:46px;height:46px;border-radius:14px;flex:0 0 auto;}',
      '.pw-upload-queue-more{display:grid;place-items:center;color:#3d6f53;font-size:12px;font-weight:800;background:linear-gradient(180deg,rgba(236,250,241,.96),rgba(224,244,231,.96));}',
      '.post-media-preview{padding:10px 0 4px;margin-top:8px;border-top:1px solid rgba(111,153,123,.14);opacity:0;transform:translateY(-4px);transition:opacity .22s ease,transform .22s ease;overflow:hidden;}',
      '.post-media-preview.is-active{opacity:1;transform:translateY(0);}',
      '.post-media-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,44px);grid-auto-rows:44px;gap:8px;justify-content:flex-start;max-width:100%;overflow:hidden;}',
      '.post-media-preview-thumb{position:relative;width:44px;height:44px;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.78);border:1px solid rgba(191,225,205,.84);box-shadow:inset 0 1px 0 rgba(255,255,255,.7);flex:0 0 auto;}',
      '.post-media-preview-thumb img,.post-media-preview-thumb video{display:block;width:100%;height:100%;object-fit:cover;}',
      '.post-media-preview-thumb::after{content:"";position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(180deg,transparent,rgba(13,27,18,.42));pointer-events:none;}',
      '.post-media-preview-tag{position:absolute;right:4px;bottom:4px;z-index:1;padding:1px 5px;border-radius:999px;background:rgba(9,17,13,.6);color:#fff;font-size:8px;font-weight:700;line-height:1.2;}',
      '.post-media-preview-more{display:grid;place-items:center;color:#3d6f53;font-size:12px;font-weight:800;background:linear-gradient(180deg,rgba(236,250,241,.96),rgba(224,244,231,.96));}',
      '.post-media-preview-count{margin-top:6px;font-size:11px;font-weight:700;color:rgba(61,94,75,.72);}',
      '.publish-box.is-submitting{transform:translateY(-1px) scale(.996);box-shadow:0 20px 42px rgba(76,149,104,.12);}',
      '.btn-primary.is-loading{position:relative;pointer-events:none;background:linear-gradient(135deg,#4aa56e,#6bcf9a)!important;color:#fff!important;box-shadow:0 12px 28px rgba(76,149,104,.22)!important;}',
      '.btn-primary.is-loading::after{content:"";display:inline-block;width:14px;height:14px;margin-left:8px;border-radius:50%;border:2px solid rgba(255,255,255,.34);border-top-color:#fff;vertical-align:-2px;animation:xtjUploadUiSpin .85s linear infinite;}',
      '.pp-post-mode .pp-delete-btn{display:none!important;}',
      '[data-theme="dark"] .pw-upload-sheet-card{background:radial-gradient(circle at top right,rgba(89,180,131,.2),transparent 30%),linear-gradient(180deg,rgba(18,28,24,.98),rgba(14,24,19,.98));border-color:rgba(106,157,125,.38);}',
      '[data-theme="dark"] .pw-upload-sheet-head h4,[data-theme="dark"] .pw-upload-sheet-close,[data-theme="dark"] .pw-upload-sheet-btn.is-ghost,[data-theme="dark"] .pw-upload-sheet-count,[data-theme="dark"] .pw-upload-sheet-head p,[data-theme="dark"] .pw-upload-queue-head{color:rgba(219,244,228,.84);}',
      '[data-theme="dark"] .pw-upload-sheet-thumb,[data-theme="dark"] .pw-upload-queue-thumb{background:rgba(255,255,255,.05);border-color:rgba(130,174,145,.24);}',
      '[data-theme="dark"] .post-media-preview{border-top-color:rgba(134,180,151,.16);}',
      '[data-theme="dark"] .post-media-preview-thumb{background:rgba(255,255,255,.05);border-color:rgba(130,174,145,.24);}',
      '[data-theme="dark"] .post-media-preview-count{color:rgba(219,244,228,.84);}',
      '@keyframes xtjUploadUiSpin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}',
      '@keyframes xtjUploadUiPulse{0%,100%{transform:scale(.92);opacity:.62;}50%{transform:scale(1.06);opacity:1;}}',
      '@keyframes xtjUploadUiOrbit{0%,100%{transform:scale(.8);opacity:.4;}50%{transform:translateY(-5px) scale(1.2);opacity:1;}}',
      '@keyframes xtjUploadUiBarFlow{0%{background-position:0% 50%;}100%{background-position:200% 50%;}}',
      '@keyframes xtjUploadUiBarShine{0%{transform:translateX(-130%);}100%{transform:translateX(130%);}}',
      '@media (max-width:520px){.pw-upload-sheet{padding-left:12px;padding-right:12px;}.pw-upload-sheet-card{padding:18px 14px 14px;border-radius:22px;}.pw-upload-sheet-grid{grid-template-columns:repeat(auto-fill,minmax(64px,1fr));}.pw-upload-sheet-footer{flex-direction:column;align-items:stretch;}.pw-upload-sheet-actions{width:100%;}.pw-upload-sheet-btn{flex:1;justify-content:center;}}'
    ].join('');
    document.head.appendChild(style);
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
    var url = URL.createObjectURL(file);
    node.className = className;
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
    meta.textContent = list.length > 1
      ? '本次会按顺序连续上传，你可以先确认缩略图和数量。'
      : '确认后将立即开始上传，并显示真实进度。';
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
      closeBtn.addEventListener('click', closeSheet);
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

  function parseFirstNumber(text) {
    var match = String(text || '').match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function normalizeTimestamp(text) {
    var raw = String(text || '').trim();
    if (!raw) return new Date().toISOString();
    var parsed = Date.parse(raw.replace(/\./g, '/'));
    return isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
  }

  function buildPostPreviewItem(img) {
    var postCard = img.closest('.post');
    if (postCard) {
      return {
        id: 'post-' + (postCard.getAttribute('data-post-id') || Date.now()),
        imageUrl: img.currentSrc || img.src,
        username: ((postCard.querySelector('.user-name') || {}).textContent || '帖子图片').trim(),
        timestamp: normalizeTimestamp((postCard.querySelector('.post-time') || {}).textContent),
        views: parseFirstNumber((postCard.querySelector('.post-stats-text') || {}).textContent),
        __xtjPostMode: true
      };
    }

    var detailMedia = img.closest('.post-detail-media');
    var detailRoot = img.closest('#postDetailBody') || document;
    if (detailMedia) {
      return {
        id: 'post-detail-' + Date.now(),
        imageUrl: img.currentSrc || img.src,
        username: ((detailRoot.querySelector('.pdh-name') || {}).textContent || '帖子图片').trim(),
        timestamp: normalizeTimestamp((detailRoot.querySelector('.pdh-time') || {}).textContent),
        views: parseFirstNumber((detailRoot.querySelector('.post-detail-stats') || {}).textContent),
        __xtjPostMode: true
      };
    }

    return null;
  }

  function restorePostPreviewMode() {
    if (state.postPreviewRestoreTimer) {
      clearTimeout(state.postPreviewRestoreTimer);
      state.postPreviewRestoreTimer = null;
    }
    state.postPreviewMode = false;
    window.pwCurrentSortedPhotos = state.savedPwCurrentSortedPhotos;
    state.savedPwCurrentSortedPhotos = null;
    var overlay = byId('photoPreviewOverlay');
    if (overlay) overlay.classList.remove('pp-post-mode');
  }

  function wrapPhotoPreviewClose() {
    if (typeof window.closePhotoPreview !== 'function' || window.closePhotoPreview.__xtjPostWrapped) return;
    var original = window.closePhotoPreview;
    window.closePhotoPreview = function() {
      var overlay = byId('photoPreviewOverlay');
      var wasPostMode = state.postPreviewMode;
      if (wasPostMode && overlay) overlay.classList.remove('pp-post-mode');
      var result = original.apply(this, arguments);
      if (wasPostMode) {
        state.postPreviewRestoreTimer = setTimeout(restorePostPreviewMode, 260);
      }
      return result;
    };
    window.closePhotoPreview.__xtjPostWrapped = true;
  }

  function openPostPhotoPreviewFromImage(img) {
    var item = buildPostPreviewItem(img);
    if (!item || !item.imageUrl) return false;
    if (typeof window.openPhotoPreview !== 'function') {
      if (typeof window.openImageViewer === 'function') window.openImageViewer(item.imageUrl);
      return true;
    }

    state.savedPwCurrentSortedPhotos = window.pwCurrentSortedPhotos;
    state.postPreviewMode = true;
    window.pwCurrentSortedPhotos = [item];
    wrapPhotoPreviewClose();
    window.openPhotoPreview(0, false);

    requestAnimationFrame(function() {
      var overlay = byId('photoPreviewOverlay');
      var deleteBtn = byId('ppDeleteBtn');
      if (overlay) overlay.classList.add('pp-post-mode');
      if (deleteBtn) deleteBtn.style.display = 'none';
    });
    return true;
  }

  function attachPostImagePreviewBridge() {
    if (document.__xtjPostPreviewBridgeBound) return;
    document.__xtjPostPreviewBridgeBound = true;
    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !(target instanceof Element)) return;
      var img = target.closest('.post .media img, .post-detail-media img');
      if (!img) return;
      if (openPostPhotoPreviewFromImage(img)) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      }
    }, true);
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
    injectRuntimeStyles();
    ensureProgressMarkup();
    attachPhotoUploadUi();
    attachPostPreview();
    attachPostImagePreviewBridge();
    wrapPublish();
    wrapPhotoPreviewClose();
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
