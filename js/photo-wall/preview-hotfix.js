(function () {
  var HOTFIX_MARKER = '__xtjPhotoPreviewHotfixInstalled';
  if (window[HOTFIX_MARKER]) return;
  window[HOTFIX_MARKER] = true;
  window.__xtjPreviewHotfixV1 = true;

  var original = {
    openPhotoPreview: window.openPhotoPreview,
    closePhotoPreview: window.closePhotoPreview,
    prevPhoto: window.ppPrevPhoto,
    nextPhoto: window.ppNextPhoto,
    shareCurrentPhoto: window.shareCurrentPhoto,
    deletePhotoFromPreview: window.deletePhotoFromPreview,
    deleteCurrentPhoto: window.deleteCurrentPhoto,
    rotatePhoto: window.ppRotatePhoto
  };

  var state = {
    scale: 1,
    tx: 0,
    ty: 0,
    rotation: 0,
    mode: 'idle',
    dragAxis: '',
    pointers: new Map(),
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    startScale: 1,
    pinchStartDistance: 0,
    pinchAnchorX: 0,
    pinchAnchorY: 0,
    lastTapAt: 0,
    suppressTapUntil: 0,
    moved: false,
    closeFallbackTimer: 0,
    forceClosing: false
  };

  function installFinalStyle() {
    if (document.getElementById('xtjPreviewHotfixStyle')) return;
    var style = document.createElement('style');
    style.id = 'xtjPreviewHotfixStyle';
    style.textContent = [
      '#photoPreviewOverlay,#photoPreviewOverlay *{ -webkit-tap-highlight-color: transparent; }',
      '#photoPreviewOverlay,#ppImageWrapper,#ppSlideTrack,#photoPreviewImage{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none!important;overscroll-behavior:contain!important;}',
      '#photoPreviewOverlay #ppCompactBtn,#photoPreviewOverlay .pp-compact-btn{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      '#photoPreviewOverlay .photo-preview-close{pointer-events:auto!important;z-index:42!important;display:grid!important;place-items:center!important;left:auto!important;right:calc(12px + env(safe-area-inset-right,0px))!important;top:calc(16px + env(safe-area-inset-top,0px))!important;bottom:auto!important;margin:0!important;transform:translateY(-10px)!important;}',
      '#photoPreviewOverlay .photo-preview-close .ui-icon{display:flex!important;align-items:center!important;justify-content:center!important;width:20px!important;height:20px!important;line-height:0!important;}',
      '#photoPreviewOverlay .photo-preview-close svg{display:block!important;width:20px!important;height:20px!important;margin:auto!important;overflow:visible!important;transform:none!important;}',
      '#photoPreviewOverlay .pp-preview-toolbar{position:absolute!important;left:50%!important;bottom:calc(18px + env(safe-area-inset-bottom,0px))!important;z-index:22!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;padding:8px 10px!important;border-radius:999px!important;background:rgba(12,18,28,.34)!important;border:1px solid rgba(255,255,255,.12)!important;box-shadow:0 10px 34px rgba(0,0,0,.18)!important;backdrop-filter:blur(16px) saturate(130%)!important;-webkit-backdrop-filter:blur(16px) saturate(130%)!important;transform:translate3d(-50%,10px,0)!important;opacity:0!important;transition:opacity .24s ease,transform .24s cubic-bezier(.16,1,.3,1)!important;}',
      '#photoPreviewOverlay.active .pp-preview-toolbar{opacity:1!important;transform:translate3d(-50%,0,0)!important;}',
      '#photoPreviewOverlay .pp-preview-toolbar .pp-zoom-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-info-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-share-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-rotate-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-delete-btn{position:relative!important;inset:auto!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;display:grid!important;place-items:center!important;padding:0!important;margin:0!important;line-height:0!important;opacity:1!important;transform:none!important;border-radius:999px!important;box-shadow:none!important;background:rgba(255,255,255,.055)!important;color:rgba(255,255,255,.86)!important;border:1px solid rgba(255,255,255,.11)!important;outline:none!important;appearance:none!important;-webkit-appearance:none!important;}',
      '#photoPreviewOverlay .pp-preview-toolbar .pp-zoom-btn:hover,#photoPreviewOverlay .pp-preview-toolbar .pp-info-btn:hover,#photoPreviewOverlay .pp-preview-toolbar .pp-share-btn:hover,#photoPreviewOverlay .pp-preview-toolbar .pp-rotate-btn:hover,#photoPreviewOverlay .pp-preview-toolbar .pp-delete-btn:hover{background:rgba(255,255,255,.09)!important;color:rgba(255,255,255,.94)!important;border-color:rgba(255,255,255,.15)!important;box-shadow:none!important;}',
      '#photoPreviewOverlay .pp-preview-toolbar .pp-zoom-btn:active,#photoPreviewOverlay .pp-preview-toolbar .pp-info-btn:active,#photoPreviewOverlay .pp-preview-toolbar .pp-share-btn:active,#photoPreviewOverlay .pp-preview-toolbar .pp-rotate-btn:active,#photoPreviewOverlay .pp-preview-toolbar .pp-delete-btn:active{background:rgba(255,255,255,.11)!important;color:rgba(255,255,255,.94)!important;border-color:rgba(255,255,255,.16)!important;box-shadow:none!important;transform:none!important;}',
      '#photoPreviewOverlay .pp-preview-toolbar .pp-zoom-btn:focus,#photoPreviewOverlay .pp-preview-toolbar .pp-info-btn:focus,#photoPreviewOverlay .pp-preview-toolbar .pp-share-btn:focus,#photoPreviewOverlay .pp-preview-toolbar .pp-rotate-btn:focus,#photoPreviewOverlay .pp-preview-toolbar .pp-delete-btn:focus{background:rgba(255,255,255,.055)!important;color:rgba(255,255,255,.86)!important;border-color:rgba(255,255,255,.11)!important;box-shadow:none!important;outline:none!important;}',
      '#photoPreviewOverlay .pp-preview-toolbar .pp-zoom-btn:focus-visible,#photoPreviewOverlay .pp-preview-toolbar .pp-info-btn:focus-visible,#photoPreviewOverlay .pp-preview-toolbar .pp-share-btn:focus-visible,#photoPreviewOverlay .pp-preview-toolbar .pp-rotate-btn:focus-visible,#photoPreviewOverlay .pp-preview-toolbar .pp-delete-btn:focus-visible{box-shadow:0 0 0 1px rgba(255,255,255,.32),0 0 0 4px rgba(255,255,255,.08)!important;outline:none!important;}',
      '#photoPreviewOverlay .pp-zoom-btn .ui-icon,#photoPreviewOverlay .pp-info-btn .ui-icon,#photoPreviewOverlay .pp-share-btn .ui-icon,#photoPreviewOverlay .pp-rotate-btn .ui-icon,#photoPreviewOverlay .pp-delete-btn .ui-icon{display:flex!important;align-items:center!important;justify-content:center!important;width:20px!important;height:20px!important;line-height:0!important;margin:0!important;transform:none!important;}',
      '#photoPreviewOverlay .pp-zoom-btn svg,#photoPreviewOverlay .pp-info-btn svg,#photoPreviewOverlay .pp-share-btn svg,#photoPreviewOverlay .pp-rotate-btn svg,#photoPreviewOverlay .pp-delete-btn svg{display:block!important;width:20px!important;height:20px!important;margin:auto!important;overflow:visible!important;transform:none!important;transform-origin:center!important}',
      '#photoPreviewOverlay .pp-rotate-btn svg g{transform:none!important}',
      '@media (max-width:480px){#photoPreviewOverlay .pp-preview-toolbar{gap:8px!important;padding:7px 8px!important;bottom:calc(14px + env(safe-area-inset-bottom,0px))!important;}#photoPreviewOverlay .pp-preview-toolbar .pp-zoom-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-info-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-share-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-rotate-btn,#photoPreviewOverlay .pp-preview-toolbar .pp-delete-btn{width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important;}}'
    ].join('');
    document.head.appendChild(style);
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

  function isControl(target) {
    return !!(target && target.closest && target.closest(
      '.photo-preview-close,' +
      '.pp-nav-arrow,' +
      '.pp-zoom-btn,' +
      '.pp-info-btn,' +
      '.pp-share-btn,' +
      '.pp-rotate-btn,' +
      '.pp-delete-btn,' +
      '.pp-info-modal,' +
      '.pp-info-modal-content,' +
      '.pp-download-confirm-overlay,' +
      '.pp-download-confirm-content'
    ));
  }

  function isTouchPointer(event) {
    return event && event.pointerType === 'touch';
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
    }, delay || 150);
  }

  function resetGestureState() {
    clearCloseFallbackTimer();
    state.mode = 'idle';
    state.dragAxis = '';
    state.pointers.clear();
    state.startX = 0;
    state.startY = 0;
    state.startTx = state.tx;
    state.startTy = state.ty;
    state.startScale = state.scale;
    state.pinchStartDistance = 0;
    state.pinchAnchorX = 0;
    state.pinchAnchorY = 0;
    state.moved = false;
  }

  function centerTrackOffset(extraX) {
    return -viewportWidth() + (extraX || 0);
  }

  function syncTrackTransform(extraX, animate) {
    var track = slideTrack();
    if (!track) return;
    track.style.transition = animate ? 'transform 220ms cubic-bezier(.16,1,.3,1)' : 'none';
    track.style.transform = 'translate3d(' + centerTrackOffset(extraX) + 'px,0,0)';
    if (animate) {
      window.setTimeout(function () {
        if (track) track.style.transition = '';
      }, 240);
    }
  }

  function clearDismissVisual(animate) {
    var root = overlay();
    var img = previewImage();
    if (root) {
      root.style.transition = animate ? 'opacity 220ms cubic-bezier(.16,1,.3,1)' : '';
      root.style.opacity = '';
      if (animate) {
        window.setTimeout(function () {
          if (root) root.style.transition = '';
        }, 240);
      }
    }
    if (img) {
      img.style.transition = animate ? 'transform 220ms cubic-bezier(.16,1,.3,1)' : 'none';
      applyImageTransform(false);
      if (animate) {
        window.setTimeout(function () {
          if (img) img.style.transition = '';
        }, 240);
      }
    }
  }

  function currentTransform() {
    return 'translate3d(' + state.tx + 'px,' + state.ty + 'px,0) scale(' + state.scale + ') rotate(' + state.rotation + 'deg)';
  }

  function applyImageTransform(animate) {
    var img = previewImage();
    if (!img) return;
    img.style.transition = animate ? 'transform 220ms cubic-bezier(.16,1,.3,1)' : 'none';
    img.style.transform = currentTransform();
    img.classList.toggle('zoomed', state.scale > 1.01);
    if (animate) {
      window.setTimeout(function () {
        if (img) img.style.transition = '';
      }, 240);
    }
  }

  function resetImageTransform(animate) {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    applyImageTransform(animate);
    syncTrackTransform(0, animate);
  }

  function resetPreviewStateForChange(animate) {
    resetGestureState();
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.rotation = 0;
    clearDismissVisual(!!animate);
    syncTrackTransform(0, !!animate);
    applyImageTransform(!!animate);
  }

  function reboundScaleIfNeeded(animate) {
    if (state.scale < 1) {
      resetImageTransform(animate);
      return;
    }
    if (state.scale <= 1.01) {
      resetImageTransform(animate);
      return;
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

  function beginPanFromPoint(point) {
    state.mode = 'pan';
    state.dragAxis = '';
    state.startX = point.x;
    state.startY = point.y;
    state.startTx = state.tx;
    state.startTy = state.ty;
    state.moved = false;
  }

  function beginSwipeOrDismiss(point) {
    state.mode = 'swipe-or-dismiss';
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
      beginPanFromPoint(remaining);
    } else {
      beginSwipeOrDismiss(remaining);
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
    if (points.length < 2 || state.mode !== 'pinch') return;
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

  function updateSwipeOrDismiss(point) {
    var dx = point.x - state.startX;
    var dy = point.y - state.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) {
      state.moved = true;
    }
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
      var img = previewImage();
      var opacity = Math.max(0.35, 1 - dy / viewportHeight());
      var scale = Math.max(0.82, 1 - dy / 900);
      if (root) {
        root.style.transition = 'none';
        root.style.opacity = String(opacity);
      }
      if (img) {
        img.style.transition = 'none';
        img.style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + scale + ') rotate(' + state.rotation + 'deg)';
      }
      return;
    }

    if (state.dragAxis === 'swipe') {
      var currentIndex = currentPhotoIndex();
      var currentData = photoList();
      var extraX = dx;
      if (currentIndex === 0 && dx > 0) extraX = dx * 0.35;
      if (currentIndex === currentData.length - 1 && dx < 0) extraX = dx * 0.35;
      syncTrackTransform(extraX, false);
    }
  }

  function toggleZoomAt(point) {
    var nextScale = state.scale > 1.01 ? 1 : 2;
    zoomAt(point.x, point.y, nextScale, true);
  }

  function handleTap(point) {
    var now = Date.now();
    if (now < state.suppressTapUntil) return;
    if (now - state.lastTapAt < 280) {
      state.lastTapAt = 0;
      state.suppressTapUntil = now + 350;
      toggleZoomAt(point);
      return;
    }
    state.lastTapAt = now;
  }

  function handleGestureEnd(point) {
    var dx = point.x - state.startX;
    var dy = point.y - state.startY;
    var gestureDistance = Math.abs(dx) + Math.abs(dy);

    if (state.mode === 'pinch') {
      state.suppressTapUntil = Date.now() + 350;
      reboundScaleIfNeeded(true);
      state.mode = 'idle';
      return;
    }

    if (state.mode === 'pan') {
      state.suppressTapUntil = Date.now() + 350;
      reboundScaleIfNeeded(true);
      state.mode = 'idle';
      return;
    }

    if (state.mode === 'swipe-or-dismiss') {
      if (state.dragAxis === 'dismiss') {
        state.suppressTapUntil = Date.now() + 350;
        if (dy > 140) {
          window.closePhotoPreview();
        } else {
          clearDismissVisual(true);
          syncTrackTransform(0, true);
        }
        state.mode = 'idle';
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
        state.mode = 'idle';
        return;
      }

      syncTrackTransform(0, true);
      clearDismissVisual(true);
      if (gestureDistance > 8) {
        state.suppressTapUntil = Date.now() + 350;
      }
      if (!state.moved) handleTap(point);
      state.mode = 'idle';
      return;
    }

    if (gestureDistance > 8) {
      state.suppressTapUntil = Date.now() + 350;
    }
    if (!state.moved) {
      handleTap(point);
    }
    state.mode = 'idle';
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

  function forceClosePhotoPreview() {
    var root = overlay();
    if (state.forceClosing) return;
    state.forceClosing = true;
    clearCloseFallbackTimer();
    try {
      delete window.__xtjPreviewExplicitPhotos;
      window.__xtjPhotoPreviewContext = null;
      resetGestureState();
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
      state.rotation = 0;

      if (root && typeof root._cleanupPreview === 'function' && !root.__xtjCleanupRunning) {
        root.__xtjCleanupRunning = true;
        try {
          root._cleanupPreview();
        } catch (_) {}
        root.__xtjCleanupRunning = false;
      }

      if (root) {
        root.classList.remove('active', 'closing', 'pp-closing', 'pp-hotfix-closing', 'pp-hotfix-basic-close', 'pp-post-mode');
        root.style.opacity = '';
        root.style.transition = '';
        root.style.pointerEvents = '';
        root.style.transform = '';
      }

      var img = previewImage();
      if (img) {
        img.style.transform = '';
        img.style.transition = '';
        img.style.opacity = '';
        img.style.borderRadius = '';
        img.style.transformOrigin = '';
        img.classList.remove('zoomed', 'pp-placeholder');
      }

      var track = slideTrack();
      if (track) {
        track.style.transition = '';
        track.style.transform = '';
      }

      var wrap = wrapper();
      if (wrap) {
        wrap.style.transition = '';
        wrap.style.transform = '';
      }

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
      if (typeof window.closePhotoPreview === 'function') {
        window.closePhotoPreview();
      } else {
        forceClosePhotoPreview();
      }
      window.setTimeout(function () {
        var currentOverlay = overlay();
        if (currentOverlay && currentOverlay.classList.contains('active')) {
          forceClosePhotoPreview();
        }
      }, 150);
    }, true);
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

  function installTouchFix() {
    var wrap = wrapper();
    var root = overlay();
    var surface = root || wrap;
    if (!wrap || !surface || surface.__xtjPreviewTouchFixInstalled) return;
    surface.__xtjPreviewTouchFixInstalled = true;

    var existingCleanup = root && root._cleanupPreview;
    if (root) {
      root._cleanupPreview = function () {
        if (typeof existingCleanup === 'function') existingCleanup();
        resetGestureState();
        state.scale = 1;
        state.tx = 0;
        state.ty = 0;
        state.rotation = 0;
        clearDismissVisual(false);
        syncTrackTransform(0, false);
      };
    }

    surface.addEventListener('pointerdown', function (event) {
      if (!isTouchPointer(event) || isControl(event.target)) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      state.moved = false;

      if (state.pointers.size >= 2) {
        beginPinch();
      } else if (state.scale > 1.01) {
        beginPanFromPoint({ x: event.clientX, y: event.clientY });
      } else {
        beginSwipeOrDismiss({ x: event.clientX, y: event.clientY });
      }

      try {
        surface.setPointerCapture(event.pointerId);
      } catch (_) {}

      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    surface.addEventListener('pointermove', function (event) {
      if (!isTouchPointer(event) || !state.pointers.has(event.pointerId) || isControl(event.target)) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.pointers.size >= 2) {
        if (state.mode !== 'pinch') beginPinch();
        updatePinch();
      } else if (state.mode === 'pinch') {
        refreshSinglePointerStart();
      } else if (state.scale > 1.01 || state.mode === 'pan') {
        updatePan({ x: event.clientX, y: event.clientY });
      } else {
        updateSwipeOrDismiss({ x: event.clientX, y: event.clientY });
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    function finishPointer(event) {
      if (!isTouchPointer(event) || !state.pointers.has(event.pointerId)) return;
      state.pointers.delete(event.pointerId);
      try {
        surface.releasePointerCapture(event.pointerId);
      } catch (_) {}

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
      } else if (state.pointers.size === 1 && (state.mode === 'pan' || state.mode === 'swipe-or-dismiss')) {
        refreshSinglePointerStart();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      } else if (state.pointers.size > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      handleGestureEnd({ x: event.clientX, y: event.clientY });
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    surface.addEventListener('pointerup', finishPointer, true);
    surface.addEventListener('pointercancel', function (event) {
      if (!isTouchPointer(event)) return;
      resetGestureState();
      clearDismissVisual(true);
      reboundScaleIfNeeded(true);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    surface.addEventListener('click', function (event) {
      if (!isTouchPointer(event) && event.pointerType && event.pointerType !== 'touch') return;
      if (Date.now() < state.suppressTapUntil && !isControl(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    surface.addEventListener('dblclick', function (event) {
      if (!isControl(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function afterOpen() {
    clearCloseFallbackTimer();
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.rotation = 0;
    state.mode = 'idle';
    state.dragAxis = '';
    state.pointers.clear();
    state.lastTapAt = 0;
    state.suppressTapUntil = 0;
    cleanupLegacyControls();
    ensurePreviewToolbar();
    bindCloseButton();
    installTouchFix();
    applyImageTransform(false);
    syncTrackTransform(0, false);
    clearDismissVisual(false);
  }

  function wrapOpenPreview() {
    if (typeof original.openPhotoPreview !== 'function') return;
    if (window.openPhotoPreview && window.openPhotoPreview.__xtjHotfixWrapped) return;
    window.openPhotoPreview = function () {
      var explicitPhotos = null;
      if (Array.isArray(arguments[1])) {
        explicitPhotos = arguments[1].slice();
      } else if (arguments[1] && Array.isArray(arguments[1].photos)) {
        explicitPhotos = arguments[1].photos.slice();
      }
      var result;
      if (explicitPhotos && explicitPhotos.length) {
        var prevSorted = window.pwCurrentSortedPhotos;
        var prevWall = window.photoWallData;
        window.__xtjPreviewExplicitPhotos = explicitPhotos.slice();
        window.pwCurrentSortedPhotos = explicitPhotos.slice();
        window.photoWallData = explicitPhotos.slice();
        try {
          result = withPreviewGuardDisabled(original.openPhotoPreview, this, [arguments[0]]);
        } finally {
          if (typeof prevSorted === 'undefined') {
            delete window.pwCurrentSortedPhotos;
          } else {
            window.pwCurrentSortedPhotos = prevSorted;
          }
          if (typeof prevWall === 'undefined') {
            delete window.photoWallData;
          } else {
            window.photoWallData = prevWall;
          }
        }
      } else {
        delete window.__xtjPreviewExplicitPhotos;
        if (typeof window.getCurrentRenderablePhotoWallPhotos === 'function') {
          explicitPhotos = window.getCurrentRenderablePhotoWallPhotos();
        }
        if (explicitPhotos && explicitPhotos.length) {
          var fallbackSorted = window.pwCurrentSortedPhotos;
          var fallbackWall = window.photoWallData;
          window.__xtjPreviewExplicitPhotos = explicitPhotos.slice();
          window.pwCurrentSortedPhotos = explicitPhotos.slice();
          window.photoWallData = explicitPhotos.slice();
          try {
            result = withPreviewGuardDisabled(original.openPhotoPreview, this, [arguments[0]]);
          } finally {
            if (typeof fallbackSorted === 'undefined') {
              delete window.pwCurrentSortedPhotos;
            } else {
              window.pwCurrentSortedPhotos = fallbackSorted;
            }
            if (typeof fallbackWall === 'undefined') {
              delete window.photoWallData;
            } else {
              window.photoWallData = fallbackWall;
            }
          }
        } else {
          result = withPreviewGuardDisabled(original.openPhotoPreview, this, arguments);
        }
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(afterOpen);
      });
      return result;
    };
    window.openPhotoPreview.__xtjHotfixWrapped = true;
  }

  window.closePhotoPreview = function () {
    resetGestureState();
    delete window.__xtjPreviewExplicitPhotos;
    window.__xtjPhotoPreviewContext = null;
    var result;
    if (typeof original.closePhotoPreview === 'function') {
      result = withPreviewGuardDisabled(original.closePhotoPreview, this, arguments);
      scheduleCloseFallback(150);
      return result;
    }
    forceClosePhotoPreview();
    return result;
  };

  window.shareCurrentPhoto = function () {
    return withPreviewGuardDisabled(original.shareCurrentPhoto, this, arguments);
  };

  window.deletePhotoFromPreview = function () {
    resetPreviewStateForChange(false);
    var result = withPreviewGuardDisabled(original.deletePhotoFromPreview, this, arguments);
    window.setTimeout(function () {
      var root = overlay();
      if (root && root.classList.contains('active')) {
        resetPreviewStateForChange(false);
      }
    }, 360);
    return result;
  };

  window.deleteCurrentPhoto = function () {
    return window.deletePhotoFromPreview.apply(this, arguments);
  };

  window.ppPrevPhoto = function () {
    resetPreviewStateForChange(false);
    var result = withPreviewGuardDisabled(original.prevPhoto, this, arguments);
    window.setTimeout(function () {
      var root = overlay();
      if (root && root.classList.contains('active')) {
        resetPreviewStateForChange(false);
      }
    }, 360);
    return result;
  };

  window.ppNextPhoto = function () {
    resetPreviewStateForChange(false);
    var result = withPreviewGuardDisabled(original.nextPhoto, this, arguments);
    window.setTimeout(function () {
      var root = overlay();
      if (root && root.classList.contains('active')) {
        resetPreviewStateForChange(false);
      }
    }, 360);
    return result;
  };

  window.zoomIn = function () {
    state.suppressTapUntil = Date.now() + 350;
    zoomAt(viewportWidth() / 2, viewportHeight() / 2, state.scale > 1.01 ? state.scale + 0.5 : 2, true);
  };

  window.zoomOut = function () {
    state.suppressTapUntil = Date.now() + 350;
    if (state.scale <= 1.25) {
      resetImageTransform(true);
      return;
    }
    zoomAt(viewportWidth() / 2, viewportHeight() / 2, state.scale - 0.5, true);
  };

  window.ppRotatePhoto = function () {
    state.rotation = (state.rotation + 90) % 360;
    applyImageTransform(true);
    if (window.showToast) {
      window.showToast('已旋转 ' + state.rotation + '°');
    }
  };

  if (typeof original.rotatePhoto === 'function' && !window.ppRotatePhoto) {
    window.ppRotatePhoto = original.rotatePhoto;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      installFinalStyle();
      cleanupLegacyControls();
      bindCloseButton();
      wrapOpenPreview();
      installTouchFix();
    });
  } else {
    installFinalStyle();
    cleanupLegacyControls();
    ensurePreviewToolbar();
    bindCloseButton();
    wrapOpenPreview();
    installTouchFix();
  }
})();
