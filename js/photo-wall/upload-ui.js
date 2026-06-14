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
    photoWallImagePreviewMode: false,
    savedPwCurrentSortedPhotos: null,
    restoreTimer: null
  };

  var TIMEOUTS = {
    photoUpload: 45000,
    photoInsert: 30000,
    postUpload: 45000,
    postInsert: 30000
  };

  var DAILY_LIMIT_KEY = 'xtj_photo_upload_date';
  var DAILY_COUNT_KEY = 'xtj_photo_upload_count';
  var DAILY_LIMIT = 5;
  var MAX_VIDEO_BYTES = 10 * 1024 * 1024;
  var SOFT_VIDEO_LIMIT_BYTES = 10 * 1024 * 1024;
  var HARD_VIDEO_LIMIT_BYTES = 200 * 1024 * 1024;
  var VIDEO_COMPRESS_ERROR = 'Unable to compress this video to a smaller size. Please try a shorter video.';

  function isImageFile(file) {
    return !!(file && /^image\//.test(file.type || ''));
  }

  function isVideoFile(file) {
    return !!(file && /^video\//.test(file.type || ''));
  }

  function formatDuration(totalSeconds) {
    var value = Number(totalSeconds || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    var rounded = Math.max(1, Math.round(value));
    var minutes = Math.floor(rounded / 60);
    var seconds = rounded % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function sanitizeBaseName(name) {
    return String(name || 'upload').replace(/[^\w.\-]+/g, '_');
  }

  function inferExtensionFromType(type, fallback) {
    var mime = String(type || '').toLowerCase();
    if (mime === 'image/png') return '.png';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'image/gif') return '.gif';
    if (mime === 'video/mp4') return '.mp4';
    if (mime === 'video/webm') return '.webm';
    if (mime === 'video/ogg') return '.ogv';
    if (mime.indexOf('jpeg') >= 0 || mime === 'image/jpg') return '.jpg';
    return fallback || '';
  }

  function toUploadFile(blob, sourceFile, forcedType) {
    if (!blob) return sourceFile;
    var type = forcedType || blob.type || (sourceFile && sourceFile.type) || 'application/octet-stream';
    var baseName = sanitizeBaseName(sourceFile && sourceFile.name ? sourceFile.name.replace(/\.[^.]+$/, '') : 'upload');
    var fileName = baseName + inferExtensionFromType(type, sourceFile ? sourceFile.name.slice(sourceFile.name.lastIndexOf('.')) : '');
    try {
      return new File([blob], fileName, { type: type, lastModified: Date.now() });
    } catch (_) {
      blob.name = fileName;
      blob.type = type;
      blob.lastModified = Date.now();
      return blob;
    }
  }

  function checkDailyUploadLimit() {
    if (typeof window.isVipUser === 'function' && window.isVipUser()) return true;
    var today = new Date().toDateString();
    var storedDate = window.safeLocalStorageGet(DAILY_LIMIT_KEY, '');
    var storedCount = parseInt(window.safeLocalStorageGet(DAILY_COUNT_KEY, '0'), 10) || 0;
    if (storedDate !== today) {
      window.safeLocalStorageSet(DAILY_LIMIT_KEY, today);
      window.safeLocalStorageSet(DAILY_COUNT_KEY, '0');
      return true;
    }
    if (storedCount >= DAILY_LIMIT) {
      throw new Error('Daily upload limit reached (' + DAILY_LIMIT + '). Upgrade to Pro for unlimited uploads.');
    }
    return true;
  }

  function incrementDailyUploadCount(count) {
    var today = new Date().toDateString();
    var storedDate = window.safeLocalStorageGet(DAILY_LIMIT_KEY, '');
    var storedCount = parseInt(window.safeLocalStorageGet(DAILY_COUNT_KEY, '0'), 10) || 0;
    if (storedDate !== today) {
      window.safeLocalStorageSet(DAILY_LIMIT_KEY, today);
      window.safeLocalStorageSet(DAILY_COUNT_KEY, String(count));
    } else {
      window.safeLocalStorageSet(DAILY_COUNT_KEY, String(storedCount + count));
    }
  }

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
      '.pw-upload-local-overlay{position:fixed;inset:0;z-index:12100;display:none;align-items:center;justify-content:center;padding:22px 16px;background:rgba(230,244,239,.38);backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);}',
      '.pw-upload-local-overlay.upload-overlay-visible{display:flex;}',
      '.pw-upload-progress-container{position:relative;overflow:hidden;width:min(100%,408px);display:flex;flex-direction:column;gap:14px;padding:22px 20px 18px;border-radius:30px;background:linear-gradient(180deg,rgba(250,255,253,.86),rgba(238,249,246,.92));border:1px solid rgba(255,255,255,.82);box-shadow:0 24px 58px rgba(88,139,108,.14), inset 0 1px 0 rgba(255,255,255,.74);backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);}',
      '.pw-upload-progress-container::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 18% 10%,rgba(125,211,252,.18),transparent 34%),radial-gradient(circle at 82% 16%,rgba(134,239,172,.16),transparent 30%);}',
      '.pw-upload-progress-hero{gap:16px;}',
      '.pw-upload-progress-copy{min-width:0;flex:1;}',
      '.pw-upload-local-spinner{position:relative;width:78px;height:78px;flex:0 0 78px;display:grid;place-items:center;}',
      '.pw-upload-liquid-shell{position:absolute;inset:0;border-radius:26px;background:linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,.16));border:1px solid rgba(255,255,255,.76);box-shadow:0 14px 36px rgba(86,138,120,.12), inset 0 1px 0 rgba(255,255,255,.78), inset 0 -12px 24px rgba(82,189,161,.14);backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);animation:xtjUploadFloat 3.4s ease-in-out infinite;}',
      '.pw-upload-liquid-glow{position:absolute;inset:10px;border-radius:20px;background:radial-gradient(circle at 30% 24%,rgba(255,255,255,.72),rgba(255,255,255,.12) 36%,transparent 58%),radial-gradient(circle at 74% 72%,rgba(96,165,250,.16),transparent 52%),radial-gradient(circle at 30% 78%,rgba(34,197,94,.16),transparent 50%);opacity:.92;animation:xtjUploadGlow 3.6s ease-in-out infinite;}',
      '.pw-upload-liquid-core{position:absolute;inset:20px;border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.74),rgba(216,245,234,.5));box-shadow:inset 0 1px 0 rgba(255,255,255,.84);}',
      '.pw-upload-local-icon{position:relative;z-index:1;color:#2e7f63;filter:drop-shadow(0 8px 18px rgba(90,168,145,.16));}',
      '.pw-upload-progress-title{font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(44,96,76,.78);}',
      '.pw-upload-progress-text{margin-top:6px;font-size:30px;font-weight:800;line-height:1;color:#1e9f86;font-variant-numeric:tabular-nums;}',
      '.pw-upload-progress-status{margin-top:6px;font-size:12px;line-height:1.55;color:rgba(59,97,82,.72);}',
      '.pw-upload-local-bar-wrap{width:100%;height:10px;border-radius:999px;background:rgba(130,185,166,.14);overflow:hidden;box-shadow:inset 0 1px 2px rgba(135,181,160,.12);}',
      '.pw-upload-progress-bar{position:relative;height:100%;border-radius:inherit;background:linear-gradient(90deg,rgba(32,197,157,.96),rgba(96,165,250,.88) 54%,rgba(167,243,208,.98));background-size:180% 100%;animation:xtjUploadBarFlow 3.4s linear infinite;box-shadow:0 8px 20px rgba(90,179,166,.18);}',
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
      '.post-media-preview-thumb video{width:100%;height:100%;object-fit:cover;display:block;}',
      '.post-media-preview-more{display:grid;place-items:center;color:#3d6f53;font-size:12px;font-weight:800;background:linear-gradient(180deg,rgba(240,252,244,.96),rgba(227,245,234,.96));}',
      '.post-media-preview-count{margin-top:6px;font-size:11px;font-weight:700;color:rgba(61,94,75,.72);}',
      '.pw-upload-sheet-thumb video,.pw-upload-queue-thumb video{display:block;width:100%;height:100%;object-fit:cover;}',
      '.pw-upload-media-kind,.pw-upload-media-duration{position:absolute;z-index:1;border-radius:999px;padding:2px 6px;font-size:10px;font-weight:700;line-height:1.2;color:#fff;background:rgba(28,72,58,.58);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}',
      '.pw-upload-media-kind{left:8px;top:8px;}',
      '.pw-upload-media-duration{right:8px;bottom:8px;}',
      '.xtj-photo-wall-video-overlay{position:fixed;inset:0;z-index:12200;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:rgba(228,243,239,.42);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);opacity:0;pointer-events:none;transition:opacity .24s ease;}',
      '.xtj-photo-wall-video-overlay.active{opacity:1;pointer-events:auto;}',
      '.xtj-photo-wall-video-shell{position:relative;width:min(100%,920px);display:flex;flex-direction:column;gap:14px;padding:18px;border-radius:28px;background:rgba(255,255,255,.56);border:1px solid rgba(255,255,255,.72);box-shadow:0 18px 44px rgba(80,140,150,.14);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);}',
      '.xtj-photo-wall-video-stage{overflow:hidden;border-radius:22px;background:linear-gradient(180deg,rgba(233,247,244,.92),rgba(219,240,236,.9));min-height:220px;}',
      '.xtj-photo-wall-video-stage video{display:block;width:100%;max-height:min(72vh,760px);background:transparent;}',
      '.xtj-photo-wall-video-meta{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;color:#20483b;}',
      '.xtj-photo-wall-video-title{font-size:18px;font-weight:700;}',
      '.xtj-photo-wall-video-subtitle{font-size:12px;color:rgba(32,72,59,.72);}',
      '.xtj-photo-wall-video-close{position:absolute;top:14px;right:14px;width:40px;height:40px;border:0;border-radius:999px;background:rgba(255,255,255,.72);color:#21483b;font-size:28px;line-height:1;box-shadow:0 10px 24px rgba(80,140,150,.12);cursor:pointer;}',
      '.xtj-photo-wall-video-badge,.xtj-photo-wall-video-duration{position:absolute;z-index:2;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.2;color:#fff;background:rgba(27,71,57,.54);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}',
      '.xtj-photo-wall-video-badge{left:8px;top:8px;}',
      '.xtj-photo-wall-video-duration{right:8px;bottom:8px;}',
      '.publish-box.is-submitting{transform:translateY(-1px);box-shadow:0 22px 46px rgba(76,149,104,.12);}',
      '.btn-primary.is-loading{position:relative;pointer-events:none;background:linear-gradient(135deg,#62b883,#8edaae)!important;color:#fff!important;box-shadow:0 12px 28px rgba(87,171,120,.24)!important;}',
      '.btn-primary.is-loading::after{content:"";display:inline-block;width:14px;height:14px;margin-left:8px;border-radius:50%;border:2px solid rgba(255,255,255,.34);border-top-color:#fff;vertical-align:-2px;animation:xtjUploadSpin .85s linear infinite;}',
      '.pp-compact-btn,#ppCompactBtn{display:none!important;}',
      '.pp-post-mode .pp-delete-btn,.pp-post-mode #ppDeleteBtn{display:none!important;}',
      '@keyframes xtjUploadSpin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}',
      '@keyframes xtjUploadFloat{0%,100%{transform:translateY(0);}50%{transform:translateY(-3px);}}',
      '@keyframes xtjUploadGlow{0%,100%{opacity:.88;}50%{opacity:1;}}',
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
      '      <div class="pw-upload-progress-title" id="pwUploadProgressTitle">Preparing Upload</div>',
      '      <div class="pw-upload-progress-text" id="pwUploadProgressText">0%</div>',
      '      <div class="pw-upload-progress-status" id="pwUploadProgressStatus">Preparing upload...</div>',
      '    </div>',
      '  </div>',
      '  <div class="pw-upload-local-bar-wrap"><div class="pw-upload-progress-bar" id="pwUploadProgressBar" style="width:0%"></div></div>',
      '  <div class="pw-upload-queue-head"><span>Upload Queue</span><span id="pwUploadQueueCount">0 items</span></div>',
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
    setProgress(0, 'Preparing Upload', 'Checking media and building upload queue...');
  }

  function hideProgress() {
    var overlay = byId('pwUploadProgressOverlay');
    if (!overlay) return;
    overlay.classList.remove('upload-overlay-visible');
    overlay.style.display = 'none';
    setProgress(0, 'Preparing Upload', 'Checking media and building upload queue...');
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


  function closeSheet() {
    revokeUrls('photoUrls');
    var sheet = byId('pwUploadSheet');
    if (!sheet) return;
    sheet.classList.remove('active');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function makeThumb(file, className, indexLabel, bucketKey) {
    var node = document.createElement('div');
    var url = URL.createObjectURL(file);
    node.className = className;
    if (bucketKey && Array.isArray(state[bucketKey])) state[bucketKey].push(url);
    if (isVideoFile(file)) {
      node.innerHTML = '<video src="' + url + '" muted playsinline preload="metadata"></video><span class="pw-upload-media-kind">Video</span><span class="pw-upload-media-duration"></span>';
      var mediaEl = node.querySelector('video');
      var durationEl = node.querySelector('.pw-upload-media-duration');
      if (mediaEl && durationEl) {
        mediaEl.addEventListener('loadedmetadata', function() {
          durationEl.textContent = formatDuration(mediaEl.duration || 0);
        }, { once: true });
      }
    } else {
      node.innerHTML = '<img src="' + url + '" alt="' + (file.name || '') + '">';
    }
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
    count.textContent = list.length + ' items';
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
    var title = byId('pwUploadSheetTitle');
    if (!sheet || !grid || !count || !meta) return;
    grid.innerHTML = '';
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      grid.appendChild(makeThumb(list[i], 'pw-upload-sheet-thumb', String(i + 1), 'photoUrls'));
    }
    count.textContent = list.length + ' items';
    if (title) title.textContent = 'Ready to upload';
    meta.textContent = list.length > 1
      ? 'Images and videos will upload in order.'
      : 'Upload will start immediately after confirmation.';
    sheet.classList.add('active');
    sheet.setAttribute('aria-hidden', 'false');
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
      count.textContent = 'Selected 0 items';
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
        thumb.innerHTML = '<video src="' + url + '" muted playsinline preload="metadata"></video><span class="post-media-preview-tag">Video</span>';
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
    count.textContent = 'Selected ' + list.length + ' items';
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
      btn.dataset.xtjLabel = btn.textContent || 'Publish';
      btn.textContent = label || 'Publishing...';
    }
  }

  function endPublishUi() {
    var box = byId('publishBox');
    var btn = byId('pubBtn');
    if (box) box.classList.remove('is-submitting');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = btn.dataset.xtjLabel || 'Publish';
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

  function readVideoMetadata(file) {
    return new Promise(function(resolve, reject) {
      if (!isVideoFile(file)) {
        reject(new Error('not_video'));
        return;
      }
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      var cleaned = false;
      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = function() {
        resolve({
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          duration: Number(video.duration || 0),
          url: url,
          video: video,
          cleanup: cleanup
        });
      };
      video.onerror = function() {
        cleanup();
        reject(new Error('video_metadata_failed'));
      };
      video.src = url;
    });
  }

  function pickRecorderMimeType() {
    var types = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    for (var i = 0; i < types.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(types[i])) return types[i];
      } catch (_) {}
    }
    return '';
  }

  function waitForSeek(video, time) {
    return new Promise(function(resolve, reject) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve();
      }
      function onSeeked() { finish(); }
      function onError() {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        reject(new Error('video_seek_failed'));
      }
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      try {
        video.currentTime = Math.max(0, time || 0);
      } catch (err) {
        onError(err);
      }
      setTimeout(finish, 600);
    });
  }

  async function extractVideoPoster(file) {
    var metadata = await readVideoMetadata(file);
    try {
      var video = metadata.video;
      var width = Math.max(1, metadata.width || 1);
      var height = Math.max(1, metadata.height || 1);
      var canvas = document.createElement('canvas');
      var ratio = Math.min(640 / width, 640 / height, 1);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('poster_context_failed');
      var targetTime = metadata.duration > 1 ? Math.min(metadata.duration * 0.35, metadata.duration - 0.2) : 0;
      await waitForSeek(video, targetTime);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var blob = await new Promise(function(resolve) {
        canvas.toBlob(function(nextBlob) {
          resolve(nextBlob || null);
        }, 'image/jpeg', 0.82);
      });
      if (!blob) throw new Error('poster_blob_failed');
      return {
        blob: blob,
        duration: metadata.duration || 0,
        width: metadata.width || 0,
        height: metadata.height || 0
      };
    } finally {
      metadata.cleanup();
    }
  }

  async function createVideoPosterFallback(file, duration) {
    var width = 640;
    var height = 640;
    try {
      var metadata = await readVideoMetadata(file);
      width = Math.max(320, metadata.width || width);
      height = Math.max(320, metadata.height || height);
      duration = duration || metadata.duration || 0;
      metadata.cleanup();
    } catch (_) {}
    var ratio = Math.min(640 / Math.max(width, 1), 640 / Math.max(height, 1), 1);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(220, Math.round(width * ratio));
    canvas.height = Math.max(220, Math.round(height * ratio));
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('video_poster_fallback_failed');

    var gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#ebfbf5');
    gradient.addColorStop(0.55, '#eaf6ff');
    gradient.addColorStop(1, '#d9f5ec');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var orb = ctx.createRadialGradient(canvas.width * 0.26, canvas.height * 0.24, 0, canvas.width * 0.26, canvas.height * 0.24, canvas.width * 0.6);
    orb.addColorStop(0, 'rgba(255,255,255,0.82)');
    orb.addColorStop(0.4, 'rgba(255,255,255,0.24)');
    orb.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    roundRect(ctx, canvas.width * 0.22, canvas.height * 0.22, canvas.width * 0.56, canvas.height * 0.56, Math.min(canvas.width, canvas.height) * 0.1);
    ctx.fill();

    ctx.fillStyle = '#26a38a';
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.46, canvas.height * 0.39);
    ctx.lineTo(canvas.width * 0.46, canvas.height * 0.61);
    ctx.lineTo(canvas.width * 0.62, canvas.height * 0.5);
    ctx.closePath();
    ctx.fill();

    if (duration) {
      ctx.fillStyle = 'rgba(23,49,58,0.72)';
      ctx.font = '600 24px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(formatDuration(duration), canvas.width - 22, canvas.height - 24);
    }

    var blob = await new Promise(function(resolve) {
      canvas.toBlob(function(nextBlob) {
        resolve(nextBlob || null);
      }, 'image/jpeg', 0.84);
    });
    if (!blob) throw new Error('video_poster_fallback_empty');
    return {
      blob: blob,
      duration: duration || 0,
      width: width,
      height: height
    };
  }

  function roundRect(ctx, x, y, width, height, radius) {
    var r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  async function buildVideoPoster(sourceFile, posterSourceFile, duration) {
    var candidates = [posterSourceFile, sourceFile].filter(Boolean);
    for (var i = 0; i < candidates.length; i++) {
      try {
        return await extractVideoPoster(candidates[i]);
      } catch (_) {}
    }
    return createVideoPosterFallback(sourceFile || posterSourceFile, duration || 0);
  }

  function getSupportedCaptureStream(video) {
    if (video && typeof video.captureStream === 'function') return video.captureStream();
    if (video && typeof video.mozCaptureStream === 'function') return video.mozCaptureStream();
    return null;
  }

  async function compressVideoAttempt(file, targetBytes, attemptIndex) {
    if (!window.MediaRecorder) throw new Error('media_recorder_unsupported');
    var recorderMimeType = pickRecorderMimeType();
    if (!recorderMimeType) throw new Error('video_record_unsupported');
    var metadata = await readVideoMetadata(file);
    try {
      var duration = Math.max(1, Math.min(metadata.duration || 1, 600));
      var sourceWidth = Math.max(1, metadata.width || 1);
      var sourceHeight = Math.max(1, metadata.height || 1);
      var maxSide = attemptIndex > 0 ? 720 : 1080;
      var ratio = Math.min(maxSide / sourceWidth, maxSide / sourceHeight, 1);
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(sourceWidth * ratio));
      canvas.height = Math.max(2, Math.round(sourceHeight * ratio));
      var ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('video_canvas_failed');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      var fps = attemptIndex > 0 ? 20 : 24;
      var canvasStream = typeof canvas.captureStream === 'function' ? canvas.captureStream(fps) : null;
      if (!canvasStream) throw new Error('capture_stream_unsupported');

      var mediaTracks = [];
      var videoTracks = canvasStream.getVideoTracks();
      if (videoTracks && videoTracks[0]) mediaTracks.push(videoTracks[0]);

      var sourceStream = getSupportedCaptureStream(metadata.video);
      if (sourceStream) {
        try {
          var audioTracks = sourceStream.getAudioTracks();
          if (audioTracks && audioTracks[0]) mediaTracks.push(audioTracks[0]);
        } catch (_) {}
      }
      var mixedStream = new MediaStream(mediaTracks);

      var targetBitsPerSecond = Math.max(
        400000,
        Math.min(attemptIndex > 0 ? 1200000 : 2000000, Math.floor((targetBytes * 8 * 0.9) / duration))
      );
      var recorderOptions = {
        mimeType: recorderMimeType,
        videoBitsPerSecond: targetBitsPerSecond,
        audioBitsPerSecond: 96000
      };
      var recorder;
      try {
        recorder = new MediaRecorder(mixedStream, recorderOptions);
      } catch (_) {
        try {
          recorder = new MediaRecorder(mixedStream, { mimeType: recorderMimeType });
        } catch (_2) {
          recorder = new MediaRecorder(mixedStream);
        }
      }
      var chunks = [];
      var rafId = 0;
      var stopped = false;
      function stopDrawing() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      }
      function drawFrame() {
        if (stopped) return;
        try {
          ctx.drawImage(metadata.video, 0, 0, canvas.width, canvas.height);
        } catch (_) {}
        rafId = requestAnimationFrame(drawFrame);
      }

      var recordedBlob = await new Promise(function(resolve, reject) {
        var timeoutMs = Math.min(Math.ceil(duration * 1000) + 3000, 65000);
        var timeoutId = setTimeout(function() {
          try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
        }, timeoutMs);

        recorder.ondataavailable = function(event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = function(event) {
          clearTimeout(timeoutId);
          var errMsg = (event && event.error && event.error.message) ? event.error.message : 'video_record_failed';
          reject(new Error(errMsg));
        };
        recorder.onstop = function() {
          clearTimeout(timeoutId);
          stopped = true;
          stopDrawing();
          try {
            var blob = new Blob(chunks, { type: recorder.mimeType || recorderMimeType || 'video/webm' });
            if (blob && blob.size) resolve(blob);
            else reject(new Error('video_record_empty'));
          } catch (ex) {
            reject(ex);
          }
        };

        metadata.video.muted = true;
        metadata.video.playsInline = true;
        metadata.video.setAttribute('playsinline', '');
        metadata.video.setAttribute('autoplay', '');
        metadata.video.currentTime = 0;

        var playPromise;
        try {
          playPromise = metadata.video.play();
        } catch (playErr) {
          reject(new Error('video_play_failed'));
          return;
        }

        Promise.resolve(playPromise).then(function() {
          drawFrame();
          try {
            recorder.start(500);
            metadata.video.onended = function() {
              try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
            };
          } catch (startErr) {
            reject(new Error('video_recorder_start_failed'));
          }
        }).catch(function() {
          reject(new Error('video_play_failed'));
        });
      });

      return {
        blob: recordedBlob,
        duration: metadata.duration || 0,
        width: canvas.width,
        height: canvas.height,
        mimeType: recordedBlob.type || recorderMimeType
      };
    } finally {
      try { metadata.cleanup(); } catch (_) {}
    }
  }

  async function compressVideoToTarget(file, targetBytes) {
    if (!isVideoFile(file)) return { file: file, duration: 0, mimeType: file.type || '', compressed: false };
    var metaPromise = readVideoMetadata(file).then(function(metadata) {
      var data = { duration: metadata.duration || 0, width: metadata.width || 0, height: metadata.height || 0 };
      try { metadata.cleanup(); } catch (_) {}
      return data;
    }).catch(function() {
      return { duration: 0, width: 0, height: 0 };
    });

    if (file.size <= targetBytes) {
      var smallMeta = await metaPromise;
      return {
        file: file,
        duration: smallMeta.duration || 0,
        width: smallMeta.width || 0,
        height: smallMeta.height || 0,
        mimeType: file.type || '',
        compressed: false
      };
    }

    var lastError = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var result = await compressVideoAttempt(file, targetBytes, attempt);
        var uploadFile = toUploadFile(result.blob, file, result.mimeType);
        if (uploadFile && uploadFile.size && uploadFile.size <= Math.max(targetBytes, file.size * 0.8)) {
          return {
            file: uploadFile,
            duration: result.duration || 0,
            width: result.width || 0,
            height: result.height || 0,
            mimeType: uploadFile.type || result.mimeType || file.type || '',
            compressed: true
          };
        }
      } catch (err) {
        lastError = err;
      }
    }

    var fallbackMeta = await metaPromise;
    return {
      file: file,
      duration: fallbackMeta.duration || 0,
      width: fallbackMeta.width || 0,
      height: fallbackMeta.height || 0,
      mimeType: file.type || '',
      compressed: false,
      skipped: true,
      lastError: lastError && lastError.message ? lastError.message : 'compress_failed'
    };
  }

  async function uploadPhotoWallFiles() {
    if (!window.sb) throw new Error('Supabase not ready');
    if (!window.currentUser) throw new Error('Please log in first');
    if (!state.photoFiles.length) throw new Error('Please choose image or video files');

    checkDailyUploadLimit();

    state.photoUploading = true;
    showProgress();
    renderQueue(state.photoFiles);

    var successCount = 0;
    var failCount = 0;
    var firstErrorMessage = '';
    for (var i = 0; i < state.photoFiles.length; i++) {
      var file = state.photoFiles[i];
      var start = (i / state.photoFiles.length) * 88;
      var end = ((i + 1) / state.photoFiles.length) * 88;
      try {
        setProgress(start, 'Processing', 'Item ' + (i + 1) + '/' + state.photoFiles.length);
        var compressed = await withTimeout(compressPhoto(file), TIMEOUTS.photoUpload, 'photo preprocess');
        var ext = file.type === 'image/png' ? '.png' : '.jpg';
        var name = buildSafeFileName(file, ext);
        var photoPath = 'photos/' + name;
        setProgress(start + (end - start) * 0.28, 'Uploading', 'Uploading original file');
        var uploadRes = await withTimeout(window.sb.storage.from('uploads').upload(photoPath, compressed, {
          contentType: file.type || 'image/jpeg',
          cacheControl: '31536000',
          upsert: false
        }), TIMEOUTS.photoUpload, 'photo upload');
        if (uploadRes.error) throw uploadRes.error;

        var photoUrl = window.sb.storage.from('uploads').getPublicUrl(photoPath).data.publicUrl;
        setProgress(start + (end - start) * 0.62, 'Preparing preview', 'Building thumbnail');
        var thumbBlob = await withTimeout(makeThumbBlob(compressed), TIMEOUTS.photoUpload, 'thumbnail build');
        var thumbPath = 'thumbs/' + name;
        var thumbRes = await withTimeout(window.sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false
        }), TIMEOUTS.photoUpload, 'thumbnail upload');
        var thumbUrl = thumbRes && !thumbRes.error ? window.sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl : '';

        setProgress(start + (end - start) * 0.88, 'Saving', 'Writing photo wall record');
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

    if (successCount > 0) incrementDailyUploadCount(successCount);

    if (window.saveLocalPhotoWallData) window.saveLocalPhotoWallData();
    if (window.renderPhotoWallWithoutReload) window.renderPhotoWallWithoutReload();
    else if (window.renderPhotoWall) await window.renderPhotoWall();

    setProgress(100, failCount ? '上传完成' : '上传成功', '成功 ' + successCount + ' 个，失败 ' + failCount + ' 个');
    state.photoUploading = false;
    state.photoFiles = [];
    setTimeout(function() {
      hideProgress();
      if (successCount > 0) toast('上传成功 ' + successCount + ' 个文件');
      if (successCount === 0 && failCount > 0) toast('上传失败，请重试');
    }, 420);
  }

  async function publishPost() {
    if (!window.currentUser) {
      toast('Please log in first');
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
      toast('Enter content or choose media');
      return;
    }
    if (content.length > 2000) {
      toast('Content cannot exceed 2000 characters');
      return;
    }

    state.postPublishing = true;
    beginPublishUi(file ? 'Uploading...' : 'Publishing...');
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
      toast(insertResult.fallback ? '发布成功（兼容模式）' : '发布成功');
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
      return file && (/^image\//.test(file.type) || /^video\//.test(file.type));
    });
    if (!selected.length) {
      toast('Please choose valid image or video files');
      return;
    }
    state.photoFiles = selected.slice();
    openSheet(selected);
  }

  async function preparePhotoWallMedia(file) {
    if (isImageFile(file)) {
      var compressedImage = await withTimeout(compressPhoto(file), TIMEOUTS.photoUpload, 'photo preprocess');
      var imageFile = toUploadFile(compressedImage, file, (compressedImage && compressedImage.type) || file.type || 'image/jpeg');
      var imageThumb = await withTimeout(makeThumbBlob(imageFile), TIMEOUTS.photoUpload, 'thumbnail build');
      return {
        mediaKind: 'image',
        uploadFile: imageFile,
        thumbBlob: imageThumb,
        duration: 0,
        mimeType: imageFile.type || file.type || 'image/jpeg',
        originalSize: file.size || null,
        fileSize: imageFile.size || file.size || null
      };
    }
    if (isVideoFile(file)) {
      if (file.size > HARD_VIDEO_LIMIT_BYTES) {
        throw new Error('Video too large. Max size is 200MB.');
      }
      var compressedVideo;
      try {
        compressedVideo = await withTimeout(
          compressVideoToTarget(file, SOFT_VIDEO_LIMIT_BYTES),
          Math.max(TIMEOUTS.photoUpload, 70000),
          'video compress'
        );
      } catch (_) {
        compressedVideo = null;
      }
      if (!compressedVideo || !compressedVideo.file) {
        compressedVideo = {
          file: file,
          mimeType: file.type || 'video/mp4',
          duration: 0,
          compressed: false
        };
      }
      if (compressedVideo.file.size > HARD_VIDEO_LIMIT_BYTES) {
        throw new Error('Video too large after compression.');
      }
      var poster;
      try {
        poster = await withTimeout(
          buildVideoPoster(file, compressedVideo.file, compressedVideo.duration || 0),
          TIMEOUTS.photoUpload,
          'video poster'
        );
      } catch (_) {
        poster = { blob: null, duration: compressedVideo.duration || 0 };
      }
      return {
        mediaKind: 'video',
        uploadFile: compressedVideo.file,
        thumbBlob: poster && poster.blob ? poster.blob : null,
        duration: compressedVideo.duration || (poster && poster.duration) || 0,
        mimeType: compressedVideo.mimeType || compressedVideo.file.type || file.type || 'video/mp4',
        originalSize: file.size || null,
        fileSize: compressedVideo.file.size || file.size || null
      };
    }
    throw new Error('unsupported_media');
  }

  function handlePhotoSelection(event) {
    var files = (event && event.target && event.target.files) ? Array.prototype.slice.call(event.target.files) : [];
    var selected = files.filter(function(file) {
      return isImageFile(file) || isVideoFile(file);
    });
    if (!selected.length) {
      toast('Please choose images or videos');
      return;
    }
    state.photoFiles = selected.slice();
    openSheet(selected);
  }

  async function uploadPhotoWallFiles() {
    if (!window.sb) throw new Error('Supabase not ready');
    if (!window.currentUser) throw new Error('Please log in first');
    if (!state.photoFiles.length) throw new Error('Please choose image or video files');

    checkDailyUploadLimit();

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
        setProgress(start, 'Preparing media', 'Processing ' + (i + 1) + ' / ' + state.photoFiles.length);
        var prepared = await preparePhotoWallMedia(file);
        var mediaExt = inferExtensionFromType(prepared.mimeType, isVideoFile(file) ? '.mp4' : '.jpg');
        var mediaName = buildSafeFileName(prepared.uploadFile, mediaExt);
        var photoPath = 'photos/' + mediaName;
        var mediaUploadTimeout = prepared.mediaKind === 'video'
          ? Math.max(TIMEOUTS.photoUpload, 70000)
          : TIMEOUTS.photoUpload;
        setProgress(start + (end - start) * 0.34, 'Uploading media', 'Uploading main file');
        var uploadRes = await withTimeout(window.sb.storage.from('uploads').upload(photoPath, prepared.uploadFile, {
          contentType: prepared.mimeType,
          cacheControl: '31536000',
          upsert: false
        }), mediaUploadTimeout, 'photo upload');
        if (uploadRes.error) throw uploadRes.error;

        var photoUrl = window.sb.storage.from('uploads').getPublicUrl(photoPath).data.publicUrl;
        var thumbUrl = '';
        if (prepared.thumbBlob) {
          setProgress(start + (end - start) * 0.62, 'Uploading cover', 'Generating cover');
          var thumbFile = toUploadFile(prepared.thumbBlob, file, 'image/jpeg');
          var thumbPath = 'thumbs/' + buildSafeFileName(thumbFile, '.jpg');
          var thumbRes = await withTimeout(window.sb.storage.from('uploads').upload(thumbPath, thumbFile, {
            contentType: 'image/jpeg',
            cacheControl: '31536000',
            upsert: false
          }), mediaUploadTimeout, 'thumbnail upload');
          if (thumbRes && !thumbRes.error) {
            thumbUrl = window.sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl;
          }
        }

        setProgress(start + (end - start) * 0.88, 'Saving entry', 'Writing photo wall record');
        var contentJson = JSON.stringify({
          type: 'photo_wall',
          mediaKind: prepared.mediaKind,
          thumb: thumbUrl,
          fileSize: prepared.fileSize,
          originalSize: prepared.originalSize,
          mimeType: prepared.mimeType,
          duration: prepared.duration || null
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
        if (!firstErrorMessage) {
          firstErrorMessage = err && err.message ? err.message : '上传失败';
        }
        failCount++;
      }
    }

    if (successCount > 0) incrementDailyUploadCount(successCount);

    if (window.saveLocalPhotoWallData) window.saveLocalPhotoWallData();
    if (window.renderPhotoWallWithoutReload) window.renderPhotoWallWithoutReload();
    else if (window.renderPhotoWall) await window.renderPhotoWall();

    setProgress(100, failCount ? '上传完成' : '上传成功', '成功 ' + successCount + ' 个，失败 ' + failCount + ' 个');
    state.photoUploading = false;
    state.photoFiles = [];
    setTimeout(function() {
      hideProgress();
      if (successCount > 0) toast('Uploaded ' + successCount + ' items');
      if (successCount === 0 && failCount > 0) toast(firstErrorMessage || 'Upload failed, please retry');
    }, 420);
  }

  async function publishPost() {
    if (!window.currentUser) {
      toast('Please log in first');
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
      toast('Enter content or choose media');
      return;
    }
    if (content.length > 2000) {
      toast('Content cannot exceed 2000 characters');
      return;
    }

    state.postPublishing = true;
    beginPublishUi(file ? 'Uploading...' : 'Publishing...');
    try {
      var mediaUrl = '';
      var mediaType = '';
      var uploadFile = file;
      var uploadMimeType = file ? (file.type || '') : '';
      var originalSize = file ? (file.size || null) : null;

      if (file) {
        if (isImageFile(file)) {
          uploadFile = toUploadFile(await withTimeout(compressPhoto(file), Math.min(TIMEOUTS.postUpload, 24000), 'post image preprocess'), file, file.type || 'image/jpeg');
          uploadMimeType = uploadFile.type || file.type || 'image/jpeg';
        } else if (isVideoFile(file)) {
          if (file.size > HARD_VIDEO_LIMIT_BYTES) {
            throw new Error('Video too large. Max size is 200MB.');
          }
          if (file.size > SOFT_VIDEO_LIMIT_BYTES) {
            try {
              var compressedVideo = await withTimeout(
                compressVideoToTarget(file, SOFT_VIDEO_LIMIT_BYTES),
                Math.max(TIMEOUTS.postUpload, 70000),
                'post video compress'
              );
              if (compressedVideo && compressedVideo.file && compressedVideo.file.size < file.size) {
                uploadFile = compressedVideo.file;
                uploadMimeType = compressedVideo.mimeType || uploadFile.type || file.type || 'video/mp4';
              }
            } catch (_) {
            }
          }
          mediaType = 'video';
        }
        var path = buildSafeFileName(uploadFile, inferExtensionFromType(uploadMimeType, ''));
        var uploadRes = await withTimeout(window.sb.storage.from('uploads').upload(path, uploadFile, {
          contentType: uploadMimeType || (uploadFile && uploadFile.type) || file.type || 'application/octet-stream',
          cacheControl: '31536000',
          upsert: false
        }), TIMEOUTS.postUpload, 'post media upload');
        if (uploadRes.error) throw uploadRes.error;
        mediaUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
        mediaType = mediaType || (isVideoFile(file) ? 'video' : 'image');
      }

      var text = content.slice(0, 2000);
      var metadata = {
        visibility: visibility || 'public',
        is_pinned: false,
        pinned_at: null,
        updated_at: null,
        fileSize: uploadFile ? (uploadFile.size || file.size || null) : null,
        originalSize: originalSize,
        mimeType: file ? (uploadMimeType || file.type || '') : ''
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
      toast(insertResult.fallback ? '发布成功（兼容模式）' : '发布成功');
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
      closeBtn.textContent = '脳';
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

  function restorePostPreviewMode() {
    if (state.restoreTimer) {
      clearTimeout(state.restoreTimer);
      state.restoreTimer = null;
    }
    state.postPreviewMode = false;
    state.photoWallImagePreviewMode = false;
    window.pwCurrentSortedPhotos = state.savedPwCurrentSortedPhotos;
    state.savedPwCurrentSortedPhotos = null;
    var overlay = byId('photoPreviewOverlay');
    if (overlay) overlay.classList.remove('pp-post-mode');
  }

  function wrapPhotoPreviewClose() {
    if (typeof window.closePhotoPreview !== 'function' || window.closePhotoPreview.__xtjPostPreviewWrapped) return;
    var original = window.closePhotoPreview;
    window.closePhotoPreview = function() {
      var shouldRestore = state.postPreviewMode || state.photoWallImagePreviewMode;
      var result = original.apply(this, arguments);
      if (shouldRestore) state.restoreTimer = setTimeout(restorePostPreviewMode, 260);
      return result;
    };
    window.closePhotoPreview.__xtjPostPreviewWrapped = true;
  }

  window.buildPostPreviewItems = function(img) {
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
        username: (sourcePost && sourcePost.user_name) || (node.getAttribute('data-post-user') || '').trim() || '甯栧瓙鍥剧墖',
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

  function ensurePhotoWallVideoOverlay() {
    var overlay = byId('xtjPhotoWallVideoOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'xtjPhotoWallVideoOverlay';
    overlay.className = 'xtj-photo-wall-video-overlay';
    overlay.innerHTML = [
      '<div class="xtj-photo-wall-video-shell">',
      '  <button type="button" class="xtj-photo-wall-video-close" id="xtjPhotoWallVideoClose" aria-label="Close">脳</button>',
      '  <div class="xtj-photo-wall-video-stage">',
      '    <video id="xtjPhotoWallVideoPlayer" controls playsinline preload="metadata"></video>',
      '  </div>',
      '  <div class="xtj-photo-wall-video-meta">',
      '    <div class="xtj-photo-wall-video-title" id="xtjPhotoWallVideoTitle"></div>',
      '    <div class="xtj-photo-wall-video-subtitle" id="xtjPhotoWallVideoSubtitle"></div>',
      '  </div>',
      '</div>'
    ].join('');
    overlay.addEventListener('click', function(event) {
      if (event.target === overlay) closePhotoWallVideoPreview();
    });
    document.body.appendChild(overlay);
    var closeBtn = byId('xtjPhotoWallVideoClose');
    if (closeBtn) closeBtn.addEventListener('click', closePhotoWallVideoPreview);
    return overlay;
  }

  function closePhotoWallVideoPreview() {
    var overlay = byId('xtjPhotoWallVideoOverlay');
    var player = byId('xtjPhotoWallVideoPlayer');
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('photo-previewing');
  }

  function openPhotoWallVideoPreview(item) {
    if (!item || !item.imageUrl) return false;
    var overlay = ensurePhotoWallVideoOverlay();
    var player = byId('xtjPhotoWallVideoPlayer');
    var title = byId('xtjPhotoWallVideoTitle');
    var subtitle = byId('xtjPhotoWallVideoSubtitle');
    if (!overlay || !player) return false;
    player.poster = item.thumbUrl || item.thumb || '';
    player.src = item.imageUrl;
    player.load();
    if (title) title.textContent = item.username || 'Video';
    if (subtitle) {
      var metaBits = [];
      if (item.duration) metaBits.push(formatDuration(item.duration));
      if (item.fileSize) metaBits.push(Math.round((item.fileSize || 0) / 1024 / 1024 * 10) / 10 + 'MB');
      subtitle.textContent = metaBits.join(' 路 ');
    }
    overlay.classList.add('active');
    document.body.classList.add('photo-previewing');
    var playPromise = player.play();
    Promise.resolve(playPromise).catch(function() {});
    return true;
  }

  function openPhotoWallMedia(index) {
    var sourceList = Array.isArray(window.pwCurrentSortedPhotos) && window.pwCurrentSortedPhotos.length
      ? window.pwCurrentSortedPhotos.slice()
      : (Array.isArray(window.photoWallData) ? window.photoWallData.slice() : []);
    var item = sourceList[index];
    if (!item) return false;
    if ((item.mediaKind || '').toLowerCase() === 'video' || /^video\//.test(item.mimeType || '')) {
      return openPhotoWallVideoPreview(item);
    }
    if (typeof window.openPhotoPreview !== 'function') return false;
    var imageItems = sourceList.filter(function(entry) {
      return !!entry && !((entry.mediaKind || '').toLowerCase() === 'video' || /^video\//.test(entry.mimeType || ''));
    });
    var currentIndex = imageItems.findIndex(function(entry) {
      return entry && String(entry.id) === String(item.id);
    });
    if (currentIndex < 0) return false;
    state.savedPwCurrentSortedPhotos = sourceList;
    state.photoWallImagePreviewMode = true;
    window.pwCurrentSortedPhotos = imageItems;
    wrapPhotoPreviewClose();
    window.openPhotoPreview(currentIndex, false);
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
            var toolbar = byId('ppPreviewToolbar') || document.querySelector('#photoPreviewOverlay .pp-preview-toolbar');
            if (toolbar) {
              toolbar.style.left = '50%';
              toolbar.style.right = 'auto';
              toolbar.style.marginLeft = '0';
              toolbar.style.transform = 'translate3d(-50%,0,0)';
            }
            ['ppZoomOutBtn', 'ppZoomInBtn', 'ppInfoBtn', 'ppShareBtn', 'ppRotateBtn'].forEach(function(id) {
              var btn = byId(id);
              if (btn) {
                btn.style.opacity = '1';
                btn.style.transform = 'translateY(0)';
              }
            });
            var compact = byId('ppCompactBtn');
            if (compact && compact.parentNode) compact.parentNode.removeChild(compact);
            var rotate = byId('ppRotateBtn');
            if (rotate) {
              rotate.title = 'Rotate 90 degrees';
              rotate.onclick = function() { window.ppRotatePhoto(); };
            }
          });
          return result;
        };
        window.openPhotoPreview.__xtjPreviewCleanupWrapped = true;
      }

      var rotateBtn = byId('ppRotateBtn');
      if (rotateBtn) {
        rotateBtn.title = 'Rotate 90 degrees';
        rotateBtn.onclick = function() { window.ppRotatePhoto(); };
      }
      var infoBtn = byId('ppInfoBtn');
      if (infoBtn) infoBtn.title = '鐓х墖淇℃伅';
      var compactBtn = byId('ppCompactBtn');
      if (compactBtn && compactBtn.parentNode) compactBtn.parentNode.removeChild(compactBtn);
       if (rotateBtn) rotateBtn.title = 'Rotate 90 degrees';
      if (infoBtn) infoBtn.title = '鐓х墖淇℃伅';

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
          toast('Rotated 90 degrees');
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

  function installAlbumTransitionOverrides() {
    if (window.__xtjAlbumTransitionOverridesInstalled) return;
    window.__xtjAlbumTransitionOverridesInstalled = true;

    function animatePhotoWallSwap() {
      var grid = byId('photoGrid');
      var container = byId('photoWallContainer');
      if (!grid || !container) return;
      container.classList.remove('xtj-pw-view-enter');
      container.classList.add('xtj-pw-view-switching');
      grid.classList.remove('xtj-pw-grid-enter');
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          container.classList.add('xtj-pw-view-enter');
          grid.classList.add('xtj-pw-grid-enter');
          setTimeout(function() {
            container.classList.remove('xtj-pw-view-switching');
            container.classList.remove('xtj-pw-view-enter');
            grid.classList.remove('xtj-pw-grid-enter');
          }, 240);
        });
      });
    }

    function wrap(name) {
      var fn = window[name];
      if (typeof fn !== 'function' || fn.__xtjAlbumAnimated) return;
      var wrapped = function() {
        animatePhotoWallSwap();
        return fn.apply(this, arguments);
      };
      wrapped.__xtjAlbumAnimated = true;
      window[name] = wrapped;
    }

    function installWhenReady() {
      if (typeof window.toggleAlbumView !== 'function' || typeof window.openPhotoAlbumGroup !== 'function' || typeof window.switchPhotoWallView !== 'function') {
        setTimeout(installWhenReady, 200);
        return;
      }
      wrap('toggleAlbumView');
      wrap('openPhotoAlbumGroup');
      wrap('switchPhotoWallView');
    }

    installWhenReady();
  }

  function enhancePhotoWallItem(item) {
    if (!item) return item;
    var next = item;
    var rawContent = item.content;
    if (rawContent && typeof rawContent === 'string') {
      try { rawContent = JSON.parse(rawContent); } catch (_) { rawContent = null; }
    }
    if (rawContent && typeof rawContent === 'object') {
      next = Object.assign({}, item, {
        thumbUrl: item.thumbUrl || rawContent.thumb || rawContent.thumbUrl || '',
        thumb: item.thumb || rawContent.thumb || rawContent.thumbUrl || '',
        mediaKind: item.mediaKind || rawContent.mediaKind || (/^video\//.test(rawContent.mimeType || '') ? 'video' : 'image'),
        mimeType: item.mimeType || rawContent.mimeType || '',
        duration: item.duration || rawContent.duration || null,
        originalSize: item.originalSize || rawContent.originalSize || null,
        fileSize: item.fileSize || rawContent.fileSize || null
      });
    }
    if (!next.mediaKind) {
      next = Object.assign({}, next, {
        mediaKind: /^video\//.test(next.mimeType || '') ? 'video' : 'image'
      });
    }
    return next;
  }

  function decoratePhotoWallVideoCards() {
    var list = Array.isArray(window.pwCurrentSortedPhotos) && window.pwCurrentSortedPhotos.length
      ? window.pwCurrentSortedPhotos
      : (Array.isArray(window.photoWallData) ? window.photoWallData : []);
    var byIdMap = {};
    for (var i = 0; i < list.length; i++) {
      var entry = enhancePhotoWallItem(list[i]);
      if (entry && entry.id != null) byIdMap[String(entry.id)] = entry;
    }
    var nodes = document.querySelectorAll('.photo-wall-item');
    nodes.forEach(function(node) {
      var photoId = node.getAttribute('data-photo-id');
      var item = byIdMap[String(photoId || '')];
      var badge = node.querySelector('.xtj-photo-wall-video-badge');
      var duration = node.querySelector('.xtj-photo-wall-video-duration');
      if (item && ((item.mediaKind || '').toLowerCase() === 'video' || /^video\//.test(item.mimeType || ''))) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'xtj-photo-wall-video-badge';
          badge.textContent = 'Video';
          node.appendChild(badge);
        }
        if (!duration) {
          duration = document.createElement('span');
          duration.className = 'xtj-photo-wall-video-duration';
          node.appendChild(duration);
        }
        duration.textContent = formatDuration(item.duration || 0);
      } else {
        if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
        if (duration && duration.parentNode) duration.parentNode.removeChild(duration);
      }
    });
  }

  function installPhotoWallMediaOverrides() {
    if (window.__xtjPhotoWallMediaOverridesInstalled) return;
    window.__xtjPhotoWallMediaOverridesInstalled = true;

    if (!document.__xtjPhotoWallMediaClickBound) {
      document.__xtjPhotoWallMediaClickBound = true;
      document.addEventListener('click', function(event) {
        var itemNode = event.target && event.target.closest ? event.target.closest('.photo-wall-item') : null;
        if (!itemNode) return;
        var photoId = itemNode.getAttribute('data-photo-id');
        var list = Array.isArray(window.pwCurrentSortedPhotos) && window.pwCurrentSortedPhotos.length
          ? window.pwCurrentSortedPhotos.slice()
          : (Array.isArray(window.photoWallData) ? window.photoWallData.slice() : []);
        var index = list.findIndex(function(entry) {
          return entry && String(entry.id) === String(photoId);
        });
        if (index < 0) return;
        if (openPhotoWallMedia(index)) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }
      }, true);
    }

    function installWhenReady() {
      if (typeof window.normalizePhotoWallRow === 'function' && !window.normalizePhotoWallRow.__xtjMediaWrapped) {
        var originalNormalize = window.normalizePhotoWallRow;
        window.normalizePhotoWallRow = function() {
          return enhancePhotoWallItem(originalNormalize.apply(this, arguments));
        };
        window.normalizePhotoWallRow.__xtjMediaWrapped = true;
      }

      ['renderPhotoWall', 'renderPhotoWallWithoutReload'].forEach(function(name) {
        var fn = window[name];
        if (typeof fn === 'function' && !fn.__xtjDecorated) {
          var wrapped = async function() {
            var result = await fn.apply(this, arguments);
            requestAnimationFrame(decoratePhotoWallVideoCards);
            return result;
          };
          wrapped.__xtjDecorated = true;
          window[name] = wrapped;
        }
      });

      if (Array.isArray(window.photoWallData) && window.photoWallData.length) {
        window.photoWallData = window.photoWallData.map(enhancePhotoWallItem);
      }
      if (Array.isArray(window.pwCurrentSortedPhotos) && window.pwCurrentSortedPhotos.length) {
        window.pwCurrentSortedPhotos = window.pwCurrentSortedPhotos.map(enhancePhotoWallItem);
      }
      requestAnimationFrame(decoratePhotoWallVideoCards);

      if (typeof window.renderPhotoWall !== 'function' || typeof window.normalizePhotoWallRow !== 'function') {
        setTimeout(installWhenReady, 250);
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
        toast('Please log in first');
        return;
      }
      var input = byId('photoFileInput');
      if (!input) return;
      input.value = '';
      input.click();
    };
    window.handlePhotoUpload = handlePhotoSelection;
    window.triggerPhotoUpload = uploadPhotoWallFiles;
    window.openPhotoWallMedia = openPhotoWallMedia;
    window.closePhotoWallVideoPreview = closePhotoWallVideoPreview;
  }

  function installUploadProgressOverrides() {
    ensureProgressMarkup = function() {
      var overlay = byId('pwUploadProgressOverlay');
      if (!overlay) return;
      ensureOverlayAtBody();
      overlay.innerHTML = [
        '<div class="pw-upload-progress-container">',
        '  <div class="pw-upload-progress-hero">',
        '    <div class="pw-upload-local-spinner" aria-hidden="true">',
        '      <div class="pw-upload-liquid-shell"></div>',
        '      <div class="pw-upload-liquid-glow"></div>',
        '      <div class="pw-upload-liquid-core"></div>',
        '      <svg class="pw-upload-local-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">',
        '        <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 1 1 .5 6.96H15"></path>',
        '        <path d="M12 11v9"></path>',
        '        <path d="m8.5 14.5 3.5-3.5 3.5 3.5"></path>',
        '      </svg>',
        '    </div>',
        '    <div class="pw-upload-progress-copy">',
        '      <div class="pw-upload-progress-title" id="pwUploadProgressTitle">Preparing Upload</div>',
        '      <div class="pw-upload-progress-text" id="pwUploadProgressText">0%</div>',
        '      <div class="pw-upload-progress-status" id="pwUploadProgressStatus">Checking media and building upload queue...</div>',
        '    </div>',
        '  </div>',
        '  <div class="pw-upload-local-bar-wrap"><div class="pw-upload-progress-bar" id="pwUploadProgressBar" style="width:0%"></div></div>',
        '  <div class="pw-upload-queue-head"><span>Upload Queue</span><span id="pwUploadQueueCount">0 items</span></div>',
        '  <div class="pw-upload-queue" id="pwUploadQueuePreview"></div>',
        '</div>'
      ].join('');
    };

    showProgress = function() {
      var overlay = byId('pwUploadProgressOverlay');
      if (!overlay) return;
      ensureProgressMarkup();
      ensureOverlayAtBody();
      overlay.style.display = 'flex';
      overlay.classList.add('upload-overlay-visible');
      setProgress(0, 'Preparing Upload', 'Checking media and building upload queue...');
    };

    hideProgress = function() {
      var overlay = byId('pwUploadProgressOverlay');
      if (!overlay) return;
      overlay.classList.remove('upload-overlay-visible');
      overlay.style.display = 'none';
      setProgress(0, 'Preparing Upload', 'Checking media and building upload queue...');
      revokeUrls('queueUrls');
    };
  }

  function boot() {
    injectStyles();
    installUploadProgressOverrides();
    ensureOverlayAtBody();
    ensureProgressMarkup();
    attachPhotoUploadUi();
    attachPostPreview();
    attachPostPreviewBridge();
    installPreviewControlOverrides();
    installAlbumTransitionOverrides();
    installPhotoWallMediaOverrides();
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
