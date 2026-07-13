(function () {
  'use strict';

  var HOTFIX_MARKER = '__xtjPhotoPreviewHotfixInstalled';
  if (window[HOTFIX_MARKER]) return;
  window[HOTFIX_MARKER] = true;
  window.__xtjPreviewHotfixV1 = true;
  window.__xtjDisableEmbeddedPhotoPreviewHotfix = true;
  window.__xtjPhotoInfoAnimationFixInstalledV10 = true;

  var original = {
    openPhotoPreview: window.openPhotoPreview,
    closePhotoPreview: window.closePhotoPreview,
    prevPhoto: window.ppPrevPhoto,
    nextPhoto: window.ppNextPhoto,
    shareCurrentPhoto: window.shareCurrentPhoto,
    deletePhotoFromPreview: window.deletePhotoFromPreview,
    deleteCurrentPhoto: window.deleteCurrentPhoto,
    rotatePhoto: window.ppRotatePhoto,
    showPhotoInfo: window.showPhotoInfo,
    closePhotoInfo: window.closePhotoInfo,
    closeImageViewer: window.closeImageViewer
  };

  var state = {
    scale: 1,
    tx: 0,
    ty: 0,
    rotation: 0,
    mode: 'idle',
    pointers: new Map(),
    activePointerId: null,
    pointerType: '',
    mouseDown: false,
    moved: false,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    startScale: 1,
    pinchStartDistance: 0,
    pinchAnchorX: 0,
    pinchAnchorY: 0,
    dragAxis: '',
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    ignoreNativeDblClickUntil: 0,
    suppressTapUntil: 0,
    closeFallbackTimer: 0,
    forceClosing: false,
    callingOriginalClose: false,
    infoOpen: false,
    previewReturnFocus: null,
    infoReturnFocus: null,
    moveRaf: 0,
    pendingMove: null
  };

  var photoSizeCache = Object.create(null);

  function cancelPendingMoveFrame() {
    if (state.moveRaf) {
      cancelAnimationFrame(state.moveRaf);
      state.moveRaf = 0;
    }
    state.pendingMove = null;
  }

  function flushPendingMoveFrame() {
    var pending = state.pendingMove;
    state.pendingMove = null;
    state.moveRaf = 0;
    if (!pending) return;
    if (pending.kind === 'pinch') {
      updatePinch();
    } else if (pending.kind === 'refresh-single') {
      refreshSinglePointerStart();
    } else if (pending.kind === 'pan-or-tap') {
      updatePanOrTapCandidate(pending.point);
    } else if (pending.kind === 'pan') {
      updatePan(pending.point);
    } else if (pending.kind === 'swipe-dismiss') {
      updateSwipeDismiss(pending.point);
    } else if (pending.kind === 'mouse-move') {
      if (Math.abs(pending.point.x - state.startX) + Math.abs(pending.point.y - state.startY) > 8) {
        state.moved = true;
      }
    }
  }

  function schedulePointerMoveVisual(kind, point) {
    state.pendingMove = { kind: kind, point: point };
    if (state.moveRaf) return;
    state.moveRaf = requestAnimationFrame(flushPendingMoveFrame);
  }

  function flushPendingMoveBeforePointerEnd() {
    if (!state.pendingMove) return;
    if (state.moveRaf) {
      cancelAnimationFrame(state.moveRaf);
      state.moveRaf = 0;
    }
    flushPendingMoveFrame();
  }

  function overlay() {
    return document.getElementById('photoPreviewOverlay');
  }

  function wrapper() {
    return document.getElementById('ppImageWrapper');
  }

  function slideTrack() {
    return document.getElementById('ppSlideTrack');
  }

  function previewImage() {
    return document.getElementById('photoPreviewImage');
  }

  function infoModal() {
    return document.getElementById('ppInfoModal');
  }

  function infoBody() {
    return document.getElementById('ppInfoModalBody');
  }

  function closeLegacyViewer() {
    var viewer = document.getElementById('imgViewer');
    if (!viewer || !viewer.classList.contains('active')) return;
    if (typeof original.closeImageViewer === 'function') {
      try {
        original.closeImageViewer();
      } catch (_) {}
      return;
    }
    viewer.classList.remove('active');
  }

  function installFinalStyle() {
    if (document.documentElement) {
      document.documentElement.classList.add('xtj-photo-preview-ready');
    }
  }

  function viewportWidth() {
    var wrap = wrapper();
    return wrap && wrap.clientWidth ? wrap.clientWidth : window.innerWidth;
  }

  function viewportHeight() {
    var wrap = wrapper();
    return wrap && wrap.clientHeight ? wrap.clientHeight : window.innerHeight;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isModalOpen() {
    var modal = infoModal();
    return !!(modal && modal.classList.contains('active'));
  }

  function isControl(target) {
    return !!(target && target.closest && target.closest(
      '.photo-preview-close,' +
      '.pp-nav-arrow,' +
      '.pp-zoom-btn,' +
      '.pp-info-btn,' +
      '.pp-share-btn,' +
      '.pp-rotate-btn,' +
      '.pp-delete-btn,' +
      '.pp-info-modal-close,' +
      '.pp-info-modal,' +
      '.pp-info-modal-content,' +
      '.pp-download-confirm-overlay,' +
      '.pp-download-confirm-content'
    ));
  }

  function photoList() {
    if (Array.isArray(window.__xtjPreviewExplicitPhotos) && window.__xtjPreviewExplicitPhotos.length) {
      return window.__xtjPreviewExplicitPhotos;
    }
    if (Array.isArray(window.pwCurrentSortedPhotos) && window.pwCurrentSortedPhotos.length) {
      return window.pwCurrentSortedPhotos;
    }
    if (Array.isArray(window.photoWallData) && window.photoWallData.length) {
      return window.photoWallData;
    }
    return [];
  }

  function activePhoto() {
    return window.photoPreviewCurrent || null;
  }

  function photoUsername(photo) {
    if (!photo) return '';
    return String(photo.username || photo.user_name || photo.userName || '').trim();
  }

  function syncPreviewMeta(photo) {
    photo = photo || activePhoto();
    var userEl = document.getElementById('photoPreviewUser');
    var timeEl = document.getElementById('photoPreviewTime');
    var viewsEl = document.getElementById('photoPreviewViewsCount');
    if (userEl) userEl.textContent = photo ? (photoUsername(photo) || '未知用户') : '';
    if (timeEl) {
      timeEl.textContent = photo && photo.timestamp
        ? new Date(photo.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
    }
    if (viewsEl) viewsEl.textContent = photo && photo.views != null ? String(photo.views) : '0';
  }

  function currentPhotoIndex() {
    var current = activePhoto();
    var list = photoList();
    if (!current || !list.length) return -1;
    var currentId = current.id == null ? '' : String(current.id);
    var currentUrl = String(current.imageUrl || '');
    for (var idx = 0; idx < list.length; idx++) {
      var item = list[idx] || {};
      if ((item.id != null && String(item.id) === currentId) || String(item.imageUrl || '') === currentUrl) {
        return idx;
      }
    }
    return -1;
  }

  function withPreviewGuardDisabled(fn, ctx, args) {
    if (typeof fn !== 'function') return;
    var prevHotfix = window.__xtjPhotoPreviewHotfixInstalled;
    var prevLegacy = window.__xtjPreviewHotfixV1;
    window.__xtjPhotoPreviewHotfixInstalled = false;
    window.__xtjPreviewHotfixV1 = prevLegacy;
    try {
      return fn.apply(ctx || window, args || []);
    } finally {
      window.__xtjPhotoPreviewHotfixInstalled = prevHotfix;
      window.__xtjPreviewHotfixV1 = prevLegacy;
    }
  }

  function clearCloseFallbackTimer() {
    if (state.closeFallbackTimer) {
      clearTimeout(state.closeFallbackTimer);
      state.closeFallbackTimer = 0;
    }
  }

  function scheduleCloseFallback(delay) {
    clearCloseFallbackTimer();
    state.closeFallbackTimer = window.setTimeout(function () {
      state.closeFallbackTimer = 0;
      var root = overlay();
      if (root && root.classList.contains('active')) {
        forceClosePhotoPreview();
      }
    }, delay || 520);
  }

  function currentTransform() {
    return 'translate3d(' + state.tx + 'px,' + state.ty + 'px,0) scale(' + state.scale + ') rotate(' + state.rotation + 'deg)';
  }

  function toggleTimedClass(node, className, delay) {
    if (!node) return;
    node.classList.remove(className);
    if (node._xtjMotionFrame) cancelAnimationFrame(node._xtjMotionFrame);
    node._xtjMotionFrame = requestAnimationFrame(function () {
      node.classList.add(className);
      window.setTimeout(function () {
        if (node) node.classList.remove(className);
      }, delay || 240);
    });
  }

  function setPreviewVars(patch) {
    var root = overlay();
    if (!root || !patch) return;
    Object.keys(patch).forEach(function(key) {
      root.style.setProperty(key, String(patch[key]));
    });
  }

  function applyImageTransform(animate) {
    var img = previewImage();
    var root = overlay();
    if (!img || !root) return;
    setPreviewVars({
      '--pp-img-x': state.tx + 'px',
      '--pp-img-y': state.ty + 'px',
      '--pp-scale': state.scale,
      '--pp-rotate': state.rotation + 'deg'
    });
    if (animate) toggleTimedClass(root, 'pp-animate-image', 240);
    else root.classList.remove('pp-animate-image');
    img.classList.toggle('zoomed', state.scale > 1.01);
  }

  function centerTrackOffset(extraX) {
    return -viewportWidth() + (extraX || 0);
  }

  function syncTrackTransform(extraX, animate) {
    var track = slideTrack();
    var root = overlay();
    if (!track || !root) return;
    setPreviewVars({ '--pp-track-x': centerTrackOffset(extraX) + 'px' });
    if (animate) toggleTimedClass(root, 'pp-animate-track', 240);
    else root.classList.remove('pp-animate-track');
  }

  function clearDismissVisual(animate) {
    var root = overlay();
    if (root) {
      setPreviewVars({ '--pp-overlay-opacity': 1 });
      if (animate) toggleTimedClass(root, 'pp-animate-root', 240);
      else root.classList.remove('pp-animate-root');
    }
    applyImageTransform(animate);
  }

  function clearInteractionState() {
    state.mode = 'idle';
    state.pointers.clear();
    state.activePointerId = null;
    state.pointerType = '';
    state.mouseDown = false;
    state.moved = false;
    state.dragAxis = '';
    state.startX = 0;
    state.startY = 0;
    state.startTx = state.tx;
    state.startTy = state.ty;
    state.startScale = state.scale;
    state.pinchStartDistance = 0;
    state.pinchAnchorX = 0;
    state.pinchAnchorY = 0;
  }

  function resetPreviewState(options) {
    var opts = options || {};
    clearInteractionState();
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    if (opts.resetRotation !== false) state.rotation = 0;
    if (!opts.keepSuppressTap) {
      state.suppressTapUntil = 0;
      state.lastTapAt = 0;
      state.lastTapX = 0;
      state.lastTapY = 0;
    }
    clearDismissVisual(!!opts.animate);
    syncTrackTransform(0, !!opts.animate);
    applyImageTransform(!!opts.animate);
  }

  function reboundScaleIfNeeded(animate) {
    if (state.scale < 1) {
      resetPreviewState({ animate: animate, resetRotation: false, keepSuppressTap: true });
      return;
    }
    if (state.scale <= 1.01) {
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
    }
    applyImageTransform(animate);
  }

  function zoomAt(clientX, clientY, nextScale, animate) {
    var oldScale = Math.max(state.scale || 1, 0.0001);
    var width = viewportWidth();
    var height = viewportHeight();
    var pointX = clientX == null ? width / 2 : clientX;
    var pointY = clientY == null ? height / 2 : clientY;
    var anchorX = (pointX - width / 2 - state.tx) / oldScale;
    var anchorY = (pointY - height / 2 - state.ty) / oldScale;
    state.scale = clamp(nextScale, 1, 5);
    state.tx = pointX - width / 2 - anchorX * state.scale;
    state.ty = pointY - height / 2 - anchorY * state.scale;
    reboundScaleIfNeeded(animate);
  }

  function toggleZoomAt(point) {
    var nextScale = state.scale > 1.01 ? 1 : 2;
    zoomAt(point.x, point.y, nextScale, true);
    state.lastTapAt = 0;
    state.lastTapX = 0;
    state.lastTapY = 0;
    state.suppressTapUntil = Date.now() + 350;
  }

  function maybeHandleTouchDoubleTap(point) {
    var now = Date.now();
    if (now < state.suppressTapUntil) return;
    if (now - state.lastTapAt < 280 && Math.abs(point.x - state.lastTapX) < 24 && Math.abs(point.y - state.lastTapY) < 24) {
      state.ignoreNativeDblClickUntil = now + 520;
      state.lastTapAt = 0;
      toggleZoomAt(point);
      return;
    }
    state.lastTapAt = now;
    state.lastTapX = point.x;
    state.lastTapY = point.y;
  }

  function beginPan(point) {
    state.mode = 'pan';
    state.dragAxis = '';
    state.startX = point.x;
    state.startY = point.y;
    state.startTx = state.tx;
    state.startTy = state.ty;
    state.moved = false;
  }

  function beginPanOrTap(point) {
    state.mode = 'pan-or-tap';
    state.dragAxis = '';
    state.startX = point.x;
    state.startY = point.y;
    state.startTx = state.tx;
    state.startTy = state.ty;
    state.moved = false;
  }

  function beginSwipeDismiss(point) {
    state.mode = 'swipe-dismiss';
    state.dragAxis = '';
    state.startX = point.x;
    state.startY = point.y;
    state.startTx = 0;
    state.startTy = 0;
    state.moved = false;
    syncTrackTransform(0, false);
    clearDismissVisual(false);
  }

  function refreshSinglePointerStart() {
    var remaining = Array.from(state.pointers.values())[0];
    if (!remaining) return;
    if (state.scale > 1.01) {
      beginPan(remaining);
    } else {
      beginSwipeDismiss(remaining);
    }
  }

  function beginPinch() {
    var points = Array.from(state.pointers.values());
    if (points.length < 2) return;
    var width = viewportWidth();
    var height = viewportHeight();
    var centerX = (points[0].x + points[1].x) / 2;
    var centerY = (points[0].y + points[1].y) / 2;
    var distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
    state.mode = 'pinch';
    state.dragAxis = '';
    state.startScale = Math.max(state.scale || 1, 1);
    state.pinchStartDistance = distance;
    state.pinchAnchorX = (centerX - width / 2 - state.tx) / state.startScale;
    state.pinchAnchorY = (centerY - height / 2 - state.ty) / state.startScale;
    state.moved = true;
    state.suppressTapUntil = Date.now() + 350;
    clearDismissVisual(false);
  }

  function updatePinch() {
    var points = Array.from(state.pointers.values());
    if (points.length < 2) return;
    var width = viewportWidth();
    var height = viewportHeight();
    var centerX = (points[0].x + points[1].x) / 2;
    var centerY = (points[0].y + points[1].y) / 2;
    var distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
    var rawScale = state.startScale * (distance / Math.max(state.pinchStartDistance, 1));
    state.scale = clamp(rawScale, 0.85, 5);
    state.tx = centerX - width / 2 - state.pinchAnchorX * state.scale;
    state.ty = centerY - height / 2 - state.pinchAnchorY * state.scale;
    applyImageTransform(false);
  }

  function updatePan(point) {
    state.tx = state.startTx + (point.x - state.startX);
    state.ty = state.startTy + (point.y - state.startY);
    if (Math.abs(point.x - state.startX) + Math.abs(point.y - state.startY) > 8) {
      state.moved = true;
    }
    applyImageTransform(false);
  }

  function updatePanOrTapCandidate(point) {
    var dx = point.x - state.startX;
    var dy = point.y - state.startY;
    if (Math.abs(dx) + Math.abs(dy) <= 8) return;
    state.moved = true;
    state.mode = 'pan';
    updatePan(point);
  }

  function updateSwipeDismiss(point) {
    var dx = point.x - state.startX;
    var dy = point.y - state.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) state.moved = true;
    if (!state.dragAxis) {
      if (Math.abs(dy) > Math.abs(dx) + 6 && dy > 0) {
        state.dragAxis = 'dismiss';
      } else if (Math.abs(dx) > Math.abs(dy) + 6) {
        state.dragAxis = 'swipe';
      } else {
        return;
      }
    }

    if (state.dragAxis === 'dismiss') {
      var root = overlay();
      var opacity = Math.max(0.35, 1 - dy / viewportHeight());
      var scale = Math.max(0.82, 1 - dy / 900);
      if (root) {
        root.classList.remove('pp-animate-root', 'pp-animate-image');
        setPreviewVars({
          '--pp-overlay-opacity': opacity,
          '--pp-img-x': '0px',
          '--pp-img-y': dy + 'px',
          '--pp-scale': scale,
          '--pp-rotate': state.rotation + 'deg'
        });
      }
      return;
    }

    if (state.dragAxis === 'swipe') {
      var currentIndex = currentPhotoIndex();
      var list = photoList();
      var extraX = dx;
      if (currentIndex === 0 && dx > 0) extraX = dx * 0.35;
      if (currentIndex === list.length - 1 && dx < 0) extraX = dx * 0.35;
      syncTrackTransform(extraX, false);
    }
  }

  function handleTouchGestureEnd(point) {
    var dx = point.x - state.startX;
    var dy = point.y - state.startY;
    var distance = Math.abs(dx) + Math.abs(dy);

    if (state.mode === 'pinch') {
      state.suppressTapUntil = Date.now() + 350;
      reboundScaleIfNeeded(true);
      clearInteractionState();
      return;
    }

    if (state.mode === 'pan') {
      state.suppressTapUntil = Date.now() + 350;
      reboundScaleIfNeeded(true);
      clearInteractionState();
      return;
    }

    if (state.mode === 'pan-or-tap') {
      if (!state.moved) {
        maybeHandleTouchDoubleTap(point);
      } else {
        reboundScaleIfNeeded(true);
      }
      clearInteractionState();
      return;
    }

    if (state.mode === 'swipe-dismiss') {
      if (state.dragAxis === 'dismiss') {
        state.suppressTapUntil = Date.now() + 350;
        if (dy > 140) {
          window.closePhotoPreview();
        } else {
          clearDismissVisual(true);
          syncTrackTransform(0, true);
        }
        clearInteractionState();
        return;
      }

      if (state.dragAxis === 'swipe') {
        state.suppressTapUntil = Date.now() + 350;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0 && typeof window.ppNextPhoto === 'function') {
            window.ppNextPhoto();
          } else if (dx > 0 && typeof window.ppPrevPhoto === 'function') {
            window.ppPrevPhoto();
          } else {
            syncTrackTransform(0, true);
          }
        } else {
          syncTrackTransform(0, true);
        }
        clearInteractionState();
        return;
      }

      syncTrackTransform(0, true);
      clearDismissVisual(true);
      if (distance > 8) {
        state.suppressTapUntil = Date.now() + 350;
      }
      if (!state.moved) {
        maybeHandleTouchDoubleTap(point);
      }
      clearInteractionState();
    }
  }

  function releasePointerCapture(surface, pointerId) {
    if (!surface || pointerId == null) return;
    try {
      surface.releasePointerCapture(pointerId);
    } catch (_) {}
  }

  function cleanupLegacyControls(root) {
    root = root || overlay();
    if (!root) return;
    root.querySelectorAll('#ppCompactBtn,.pp-compact-btn').forEach(function (button) {
      button.remove();
    });
    var rotateSvg = root.querySelector('#ppRotateBtn svg');
    if (rotateSvg) {
      rotateSvg.innerHTML = '<path d="M20 11a8 8 0 1 0 2.35 5.65"></path><path d="M20 4v7h-7"></path>';
    }
  }

  function ensurePreviewToolbar(root) {
    root = root || overlay();
    if (!root) return null;
    var toolbar = root.querySelector('.pp-preview-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'pp-preview-toolbar';
      root.appendChild(toolbar);
    }
    [
      'ppZoomOutBtn',
      'ppZoomInBtn',
      'ppInfoBtn',
      'ppRotateBtn',
      'ppShareBtn',
      'ppDeleteBtn'
    ].forEach(function (id) {
      var button = root.querySelector('#' + id);
      if (button && button.parentNode !== toolbar) {
        toolbar.appendChild(button);
      }
    });
    return toolbar;
  }

  function formatFileSize(size) {
    if (!size && size !== 0) return '--';
    if (size >= 1048576) return (size / 1048576).toFixed(2) + ' MB';
    if (size >= 1024) return (size / 1024).toFixed(1) + ' KB';
    return String(size) + ' B';
  }

  function escapeValue(value) {
    if (window.escapeHtml) return window.escapeHtml(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function infoRow(label, value) {
    return '<div class="pp-info-row"><span class="pp-info-label">' + escapeValue(label) + '</span><span class="pp-info-value">' + escapeValue(value || '--') + '</span></div>';
  }

  function buildPhotoInfoHtml(photo) {
    if (!photo) return '<div class="pp-info-section"><div class="pp-info-section-title">照片信息</div>' + infoRow('状态', '暂无数据') + '</div>';
    var parts = [];
    parts.push(infoRow('作者', photoUsername(photo) || '未知用户'));
    parts.push(infoRow('时间', photo.timestamp ? new Date(photo.timestamp).toLocaleString('zh-CN') : '--'));
    parts.push(infoRow('浏览', photo.views == null ? 0 : photo.views));
    parts.push(infoRow('大小', formatFileSize(photo.fileSize)));
    if (photo.originalSize && Number(photo.originalSize) > 0 && Number(photo.originalSize) !== Number(photo.fileSize || 0)) {
      parts.push(infoRow('原始大小', formatFileSize(photo.originalSize)));
    }
    var html = '<div class="pp-info-section"><div class="pp-info-section-title">照片信息</div>' + parts.join('') + '</div>';
    var exif = photo.exif || null;
    if (exif) {
      var exifRows = [];
      if (exif.model || exif.make) exifRows.push(infoRow('设备', exif.model || exif.make));
      if (exif.fNumber) exifRows.push(infoRow('光圈', 'f/' + exif.fNumber));
      if (exif.exposureTime) exifRows.push(infoRow('快门', exif.exposureTime));
      if (exif.iso) exifRows.push(infoRow('ISO', exif.iso));
      if (exif.focalLength) exifRows.push(infoRow('焦距', exif.focalLength + 'mm'));
      if (exifRows.length) {
        html += '<div class="pp-info-divider"></div><div class="pp-info-section"><div class="pp-info-section-title">EXIF</div>' + exifRows.join('') + '</div>';
      }
    }
    return html;
  }

  function fetchPhotoFileSize(photo) {
    if (!photo) return Promise.resolve(null);
    if (photo.fileSize) return Promise.resolve(photo.fileSize);
    return Promise.resolve(null);
  }

  function bindInfoModal() {
    var modal = infoModal();
    if (!modal || modal.__xtjInfoBound) return;
    modal.__xtjInfoBound = true;
    modal.addEventListener('click', function (event) {
      if (event.target === modal) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.closePhotoInfo();
      }
    }, true);
    var closeBtn = modal.querySelector('.pp-info-modal-close');
    if (closeBtn && !closeBtn.__xtjInfoCloseBound) {
      closeBtn.__xtjInfoCloseBound = true;
      closeBtn.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }, true);
      closeBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.closePhotoInfo();
      }, true);
    }
    var content = modal.querySelector('.pp-info-modal-content');
    if (content) {
      content.addEventListener('click', function (event) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }, true);
      content.addEventListener('pointerdown', function (event) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }, true);
    }
    modal.addEventListener('keydown', function (event) {
      if (!state.infoOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        window.closePhotoInfo();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = Array.prototype.filter.call(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (node) {
        return !node.disabled && node.getAttribute('aria-hidden') !== 'true' && node.offsetParent !== null;
      });
      if (!focusable.length) {
        event.preventDefault();
        if (content) content.focus();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function closePhotoInfoInternal(silent) {
    var modal = infoModal();
    var root = overlay();
    state.infoOpen = false;
    if (root) root.classList.remove('pp-info-open');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    if (modal.__xtjInfoCloseTimer) {
      clearTimeout(modal.__xtjInfoCloseTimer);
      modal.__xtjInfoCloseTimer = 0;
    }
    var content = modal.querySelector('.pp-info-modal-content');
    var body = infoBody();
    modal.classList.remove('active');
    modal.classList.add('closing');
    modal.style.pointerEvents = 'none';
    if (!content) {
      modal.style.display = 'none';
      modal.classList.remove('closing');
      modal.style.pointerEvents = '';
      if (!silent && body) body.innerHTML = '';
      if (!silent && state.infoReturnFocus && document.contains(state.infoReturnFocus)) state.infoReturnFocus.focus();
      state.infoReturnFocus = null;
      return;
    }
    modal.__xtjInfoCloseTimer = window.setTimeout(function () {
      modal.__xtjInfoCloseTimer = 0;
      modal.style.display = 'none';
      modal.classList.remove('closing');
      modal.style.pointerEvents = '';
      if (!silent && body) body.innerHTML = '';
      if (!silent && state.infoReturnFocus && document.contains(state.infoReturnFocus)) state.infoReturnFocus.focus();
      state.infoReturnFocus = null;
    }, 240);
  }

  function showPhotoInfoInternal() {
    var photo = activePhoto();
    var modal = infoModal();
    var body = infoBody();
    var root = overlay();
    if (!modal || !body || !photo) return;
    state.infoReturnFocus = document.activeElement;
    bindInfoModal();
    if (modal.__xtjInfoCloseTimer) {
      clearTimeout(modal.__xtjInfoCloseTimer);
      modal.__xtjInfoCloseTimer = 0;
    }
    var content = modal.querySelector('.pp-info-modal-content');
    body.innerHTML = buildPhotoInfoHtml(photo);
    modal.classList.remove('closing');
    modal.classList.add('pp-info-prep');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.style.pointerEvents = 'auto';
    state.infoOpen = true;
    if (root) root.classList.add('pp-info-open');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        modal.classList.remove('pp-info-prep');
        modal.classList.add('active');
        var closeBtn = modal.querySelector('.pp-info-modal-close');
        if (closeBtn) closeBtn.focus();
        else if (content) content.focus();
      });
    });
    if (!photo.fileSize) {
      fetchPhotoFileSize(photo).then(function (size) {
        if (!size) return;
        if (!state.infoOpen || activePhoto() !== photo) return;
        var latestBody = infoBody();
        if (latestBody) latestBody.innerHTML = buildPhotoInfoHtml(photo);
      });
    }
  }

  function forceClosePhotoPreview() {
    var root = overlay();
    if (state.forceClosing) return;
    state.forceClosing = true;
    clearCloseFallbackTimer();
    try {
      closePhotoInfoInternal(true);
      if (state.activePointerId != null) {
        releasePointerCapture(root || wrapper(), state.activePointerId);
      }
      clearInteractionState();
      clearImageError();
      delete window.__xtjPreviewExplicitPhotos;
      window.__xtjPhotoPreviewContext = null;
      window.photoPreviewCurrent = null;
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
      state.rotation = 0;

      if (!state.callingOriginalClose && typeof original.closePhotoPreview === 'function') {
        state.callingOriginalClose = true;
        try {
          withPreviewGuardDisabled(original.closePhotoPreview, window, []);
        } catch (_) {}
        state.callingOriginalClose = false;
      }

      if (root && typeof root._cleanupPreview === 'function' && !root.__xtjCleanupRunning) {
        root.__xtjCleanupRunning = true;
        try {
          root._cleanupPreview();
        } catch (_) {}
        root.__xtjCleanupRunning = false;
      }

      if (root) {
        root.classList.remove('active', 'closing', 'pp-closing', 'pp-hotfix-closing', 'pp-hotfix-basic-close', 'pp-post-mode', 'pp-info-open');
        root.classList.remove('pp-animate-root', 'pp-animate-track', 'pp-animate-image');
        root.style.pointerEvents = '';
        root.style.removeProperty('--pp-overlay-opacity');
        root.style.removeProperty('--pp-track-x');
        root.style.removeProperty('--pp-img-x');
        root.style.removeProperty('--pp-img-y');
        root.style.removeProperty('--pp-scale');
        root.style.removeProperty('--pp-rotate');
        root.setAttribute('aria-hidden', 'true');
      }

      if (state.previewReturnFocus && document.contains(state.previewReturnFocus)) state.previewReturnFocus.focus();
      state.previewReturnFocus = null;

      var img = previewImage();
      if (img) {
        img.style.opacity = '';
        img.style.borderRadius = '';
        img.style.transformOrigin = '';
        img.classList.remove('zoomed', 'pp-placeholder');
      }

      var track = slideTrack();
      if (track) track.classList.remove('snapping');

      var wrap = wrapper();
      if (wrap) wrap.classList.remove('pp-wrap-animating');

      if (root && root._openOriginImg) {
        root._openOriginImg.style.transition = '';
        root._openOriginImg.style.opacity = '';
      }

      document.body.classList.remove('photo-previewing');
      document.body.style.overflow = '';
    } finally {
      state.forceClosing = false;
    }
  }

  function bindCloseButton(root) {
    root = root || overlay();
    if (!root) return;
    var closeBtn = root.querySelector('.photo-preview-close');
    if (!closeBtn || closeBtn.__xtjCloseBound) return;
    closeBtn.__xtjCloseBound = true;
    closeBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.closePhotoPreview();
    }, true);
  }

  function bindInfoButton(root) {
    root = root || overlay();
    if (!root) return;
    var infoBtn = root.querySelector('#ppInfoBtn');
    if (!infoBtn || infoBtn.__xtjInfoBtnBound) return;
    infoBtn.__xtjInfoBtnBound = true;
    infoBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isModalOpen()) {
        window.closePhotoInfo();
      } else {
        window.showPhotoInfo();
      }
    }, true);
  }

  function installUnifiedPointerHandlers() {
    var root = overlay();
    var surface = root || wrapper();
    if (!root || !surface || surface.__xtjUnifiedPreviewHandlersInstalled) return;
    surface.__xtjUnifiedPreviewHandlersInstalled = true;
    if (window.__xtjPreviewWindowHandlersInstalled) return;
    window.__xtjPreviewWindowHandlersInstalled = true;

    surface.addEventListener('pointerdown', function (event) {
      if (isControl(event.target)) return;
      if (isModalOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      var isTouchLike = event.pointerType === 'touch';
      var isMouse = event.pointerType === 'mouse';
      if (isMouse && event.button !== 0) return;

      state.pointerType = event.pointerType || (isTouchLike ? 'touch' : 'mouse');
      state.activePointerId = event.pointerId;
      state.moved = false;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (isTouchLike) {
        if (state.pointers.size >= 2) {
          beginPinch();
        } else if (state.scale > 1.01) {
          beginPanOrTap({ x: event.clientX, y: event.clientY });
        } else {
          beginSwipeDismiss({ x: event.clientX, y: event.clientY });
        }
      } else {
        state.mouseDown = true;
        if (state.scale > 1.01) {
          beginPan({ x: event.clientX, y: event.clientY });
        } else {
          state.mode = 'mouse-idle';
          state.startX = event.clientX;
          state.startY = event.clientY;
        }
      }

      try {
        surface.setPointerCapture(event.pointerId);
      } catch (_) {}

      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    surface.addEventListener('pointermove', function (event) {
      if (isControl(event.target) || isModalOpen()) return;
      if (state.activePointerId == null && event.pointerType !== 'touch') return;
      if (event.pointerType === 'touch' && !state.pointers.has(event.pointerId)) return;
      if (event.pointerType !== 'touch' && !state.mouseDown) return;

      if (event.pointerType === 'touch') {
        state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (state.pointers.size >= 2) {
          if (state.mode !== 'pinch') beginPinch();
          schedulePointerMoveVisual('pinch');
        } else if (state.mode === 'pinch') {
          schedulePointerMoveVisual('refresh-single');
        } else if (state.mode === 'pan-or-tap') {
          schedulePointerMoveVisual('pan-or-tap', { x: event.clientX, y: event.clientY });
        } else if (state.scale > 1.01 || state.mode === 'pan') {
          schedulePointerMoveVisual('pan', { x: event.clientX, y: event.clientY });
        } else {
          schedulePointerMoveVisual('swipe-dismiss', { x: event.clientX, y: event.clientY });
        }
      } else {
        if (state.mode === 'pan' && state.scale > 1.01) {
          schedulePointerMoveVisual('pan', { x: event.clientX, y: event.clientY });
        } else {
          schedulePointerMoveVisual('mouse-move', { x: event.clientX, y: event.clientY });
        }
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    function finishPointer(event) {
      flushPendingMoveBeforePointerEnd();
      if (event.pointerType === 'touch') {
        if (!state.pointers.has(event.pointerId)) return;
        state.pointers.delete(event.pointerId);
        releasePointerCapture(surface, event.pointerId);

        if (state.mode === 'pinch') {
          if (state.pointers.size >= 2) {
            beginPinch();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          if (state.pointers.size === 1) {
            state.suppressTapUntil = Date.now() + 350;
            refreshSinglePointerStart();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
        } else if (state.pointers.size === 1 && (state.mode === 'pan' || state.mode === 'pan-or-tap' || state.mode === 'swipe-dismiss')) {
          state.suppressTapUntil = Date.now() + 350;
          refreshSinglePointerStart();
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        } else if (state.pointers.size > 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }

        handleTouchGestureEnd({ x: event.clientX, y: event.clientY });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (state.activePointerId !== event.pointerId && event.pointerType === 'mouse') return;
      releasePointerCapture(surface, event.pointerId);
      state.mouseDown = false;
      state.activePointerId = null;

      if (state.mode === 'pan' && state.scale > 1.01) {
        state.suppressTapUntil = Date.now() + 350;
        reboundScaleIfNeeded(true);
      }
      clearInteractionState();
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    surface.addEventListener('pointerup', finishPointer, true);
    surface.addEventListener('pointercancel', function (event) {
      cancelPendingMoveFrame();
      releasePointerCapture(surface, event.pointerId);
      clearInteractionState();
      clearDismissVisual(true);
      reboundScaleIfNeeded(true);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    surface.addEventListener('click', function (event) {
      if (isControl(event.target)) return;
      if (Date.now() < state.suppressTapUntil || isModalOpen()) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
    }, true);

    surface.addEventListener('dblclick', function (event) {
      if (isControl(event.target) || isModalOpen()) return;
      if (Date.now() < state.ignoreNativeDblClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleZoomAt({ x: event.clientX, y: event.clientY });
    }, true);

    window.addEventListener('mouseup', function () {
      state.mouseDown = false;
      if (state.mode === 'pan' && state.scale > 1.01) reboundScaleIfNeeded(true);
      clearInteractionState();
    }, true);

    window.addEventListener('mouseleave', function () {
      state.mouseDown = false;
      clearInteractionState();
    }, true);

    window.addEventListener('blur', function () {
      state.mouseDown = false;
      clearInteractionState();
    }, true);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return;
      state.mouseDown = false;
      clearInteractionState();
    }, true);
  }

  function installImageErrorHandler() {
    var img = previewImage();
    if (!img) return;
    img.onerror = function () {
      var root = overlay();
      if (!root) return;
      if (root.classList.contains('pp-img-error')) return;
      root.classList.add('pp-img-error');
      var slot = img.parentElement;
      if (!slot) return;
      var existing = root.querySelector('.pp-error-placeholder');
      if (existing) return;
      img.style.display = 'none';
      var placeholder = document.createElement('div');
      placeholder.className = 'pp-error-placeholder';
      placeholder.textContent = '图片加载失败';
      slot.appendChild(placeholder);
    };
    img.onload = function () {
      clearImageError();
    };
  }

  function clearImageError() {
    var root = overlay();
    var img = previewImage();
    if (root) {
      root.classList.remove('pp-img-error');
      var ph = root.querySelector('.pp-error-placeholder');
      if (ph) ph.remove();
    }
    if (img) {
      img.style.display = '';
      img.onerror = null;
      img.onload = null;
    }
  }

  function afterOpen() {
    clearCloseFallbackTimer();
    closeLegacyViewer();
    closePhotoInfoInternal(true);
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.rotation = 0;
    state.suppressTapUntil = 0;
    state.lastTapAt = 0;
    state.lastTapX = 0;
    state.lastTapY = 0;
    state.ignoreNativeDblClickUntil = 0;
    clearInteractionState();
    cleanupLegacyControls();
    ensurePreviewToolbar();
    bindCloseButton();
    bindInfoButton();
    bindInfoModal();
    installUnifiedPointerHandlers();
    clearImageError();
    installImageErrorHandler();
    syncPreviewMeta(activePhoto());
    applyImageTransform(false);
    syncTrackTransform(0, false);
    clearDismissVisual(false);
    var root = overlay();
    if (root) root.setAttribute('aria-hidden', 'false');
    var closeBtn = root && root.querySelector('.photo-preview-close');
    if (closeBtn) closeBtn.focus();
  }

  function resolvePhotoArray(arg1) {
    if (Array.isArray(arg1)) return arg1.slice();
    if (arg1 && Array.isArray(arg1.photos)) return arg1.photos.slice();
    return null;
  }

  function resolveFallbackPhotoArray() {
    if (typeof window.getCurrentRenderablePhotoWallPhotos === 'function') {
      var derived = window.getCurrentRenderablePhotoWallPhotos();
      if (Array.isArray(derived) && derived.length) return derived.slice();
    }
    var list = photoList();
    return Array.isArray(list) && list.length ? list.slice() : null;
  }

  function openWithExplicitPhotos(index, photos, options) {
    var originEl = options && options.originEl && options.originEl.getBoundingClientRect
      ? options.originEl
      : null;
    var originRect = null;
    if (originEl) {
      try {
        var rect = originEl.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          originRect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          };
        }
      } catch (_) {}
    }
    var prevSorted = window.pwCurrentSortedPhotos;
    var prevWall = window.photoWallData;
    window.__xtjPreviewExplicitPhotos = photos.slice();
    window.pwCurrentSortedPhotos = photos.slice();
    window.photoWallData = photos.slice();
    try {
      return withPreviewGuardDisabled(original.openPhotoPreview, window, [index]);
    } finally {
      var root = overlay();
      if (root && originEl && originRect) {
        root._xtjOriginImg = originEl;
        root._xtjOriginRect = originRect;
        root._openOriginImg = originEl;
        root._openOrigin = originRect;
      }
      if (typeof prevSorted === 'undefined') delete window.pwCurrentSortedPhotos;
      else window.pwCurrentSortedPhotos = prevSorted;
      if (typeof prevWall === 'undefined') delete window.photoWallData;
      else window.photoWallData = prevWall;
    }
  }

  function wrapOpenPreview() {
    if (typeof original.openPhotoPreview !== 'function') return;
    if (window.openPhotoPreview && window.openPhotoPreview.__xtjHotfixWrapped) return;
    window.openPhotoPreview = function (index, options) {
      closeLegacyViewer();
      state.previewReturnFocus = document.activeElement;
      var explicitPhotos = resolvePhotoArray(options);
      if (!explicitPhotos || !explicitPhotos.length) {
        explicitPhotos = resolveFallbackPhotoArray();
      }
      if (!explicitPhotos || !explicitPhotos.length) {
        if (window.showToast) window.showToast('照片数据加载中，请稍后重试');
        return;
      }
      var safeIndex = Number(index || 0);
      if (safeIndex < 0) safeIndex = 0;
      if (safeIndex >= explicitPhotos.length) safeIndex = explicitPhotos.length - 1;
      resetPreviewState({ resetRotation: true, animate: false, keepSuppressTap: true });
      clearImageError();
      var result = openWithExplicitPhotos(safeIndex, explicitPhotos, options || null);
      requestAnimationFrame(function () {
        requestAnimationFrame(afterOpen);
      });
      return result;
    };
    window.openPhotoPreview.__xtjHotfixWrapped = true;
  }

  function wrapNavigation(kind) {
    return function () {
      closePhotoInfoInternal(true);
      resetPreviewState({ resetRotation: true, animate: false, keepSuppressTap: true });
      var fn = kind === 'next' ? original.nextPhoto : original.prevPhoto;
      var result = withPreviewGuardDisabled(fn, window, arguments);
      window.setTimeout(function () {
        var root = overlay();
        if (root && root.classList.contains('active')) {
          resetPreviewState({ resetRotation: true, animate: false, keepSuppressTap: true });
          afterOpen();
          syncPreviewMeta(activePhoto());
        }
      }, 360);
      return result;
    };
  }

  window.showPhotoInfo = function () {
    showPhotoInfoInternal();
  };

  window.closePhotoInfo = function () {
    closePhotoInfoInternal(false);
  };

  window.closePhotoPreview = function () {
    closePhotoInfoInternal(true);
    delete window.__xtjPreviewExplicitPhotos;
    window.__xtjPhotoPreviewContext = null;
    clearInteractionState();
    cancelPendingMoveFrame();
    if (typeof original.closePhotoPreview === 'function') {
      state.callingOriginalClose = true;
      try {
        withPreviewGuardDisabled(original.closePhotoPreview, this, arguments);
      } finally {
        state.callingOriginalClose = false;
      }
      scheduleCloseFallback(520);
      return;
    }
    forceClosePhotoPreview();
  };

  window.shareCurrentPhoto = function () {
    return withPreviewGuardDisabled(original.shareCurrentPhoto, this, arguments);
  };

  window.deletePhotoFromPreview = function () {
    closePhotoInfoInternal(true);
    resetPreviewState({ resetRotation: true, animate: false, keepSuppressTap: true });
    var result = withPreviewGuardDisabled(original.deletePhotoFromPreview, this, arguments);
    window.setTimeout(function () {
      var root = overlay();
      if (root && root.classList.contains('active')) {
        resetPreviewState({ resetRotation: true, animate: false, keepSuppressTap: true });
        afterOpen();
      }
    }, 420);
    return result;
  };

  window.deleteCurrentPhoto = function () {
    if (typeof original.deleteCurrentPhoto === 'function') {
      return original.deleteCurrentPhoto.apply(this, arguments);
    }
    return window.deletePhotoFromPreview.apply(this, arguments);
  };

  window.ppPrevPhoto = wrapNavigation('prev');
  window.ppNextPhoto = wrapNavigation('next');

  window.zoomIn = function () {
    state.suppressTapUntil = Date.now() + 350;
    zoomAt(viewportWidth() / 2, viewportHeight() / 2, state.scale > 1.01 ? state.scale + 0.5 : 2, true);
  };

  window.zoomOut = function () {
    state.suppressTapUntil = Date.now() + 350;
    if (state.scale <= 1.25) {
      resetPreviewState({ animate: true, resetRotation: false, keepSuppressTap: true });
      return;
    }
    zoomAt(viewportWidth() / 2, viewportHeight() / 2, state.scale - 0.5, true);
  };

  window.ppRotatePhoto = function () {
    state.rotation = (state.rotation + 90) % 360;
    applyImageTransform(true);
    if (window.showToast) window.showToast('已旋转');
  };

  function boot() {
    installFinalStyle();
    cleanupLegacyControls();
    ensurePreviewToolbar();
    bindCloseButton();
    bindInfoButton();
    bindInfoModal();
    installUnifiedPointerHandlers();
    wrapOpenPreview();
    closeLegacyViewer();
  }

  window.forceClosePhotoPreview = forceClosePhotoPreview;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
