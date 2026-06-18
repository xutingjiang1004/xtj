// Photo preview stability patches kept outside the compressed preview bundle.
(function () {
  if (window.__xtjPreviewHotfixV1) return;
  window.__xtjPreviewHotfixV1 = true;

  var state = {
    scale: 1,
    tx: 0,
    ty: 0,
    rotation: 0,
    pointers: new Map(),
    mode: '',
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    startScale: 1,
    pinchDist: 0,
    pinchAx: 0,
    pinchAy: 0,
    moved: false,
    lastTap: 0,
    tapTimer: null
  };

  function installFinalStyle() {
    if (document.getElementById('xtjPreviewHotfixStyle')) return;
    var style = document.createElement('style');
    style.id = 'xtjPreviewHotfixStyle';
    style.textContent = [
      '#photoPreviewOverlay #ppCompactBtn,#photoPreviewOverlay .pp-compact-btn{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      '#photoPreviewOverlay .pp-zoom-btn,#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:0!important;line-height:0!important}',
      '#photoPreviewOverlay .pp-zoom-btn .ui-icon,#photoPreviewOverlay .pp-info-btn .ui-icon,#photoPreviewOverlay .pp-share-btn .ui-icon,#photoPreviewOverlay .pp-rotate-btn .ui-icon,#photoPreviewOverlay .pp-delete-btn .ui-icon{display:flex!important;align-items:center!important;justify-content:center!important;width:20px!important;height:20px!important;line-height:0!important}',
      '#photoPreviewOverlay .pp-zoom-btn svg,#photoPreviewOverlay .pp-info-btn svg,#photoPreviewOverlay .pp-share-btn svg,#photoPreviewOverlay .pp-rotate-btn svg,#photoPreviewOverlay .pp-delete-btn svg{display:block!important;width:20px!important;height:20px!important;margin:auto!important;overflow:visible!important;transform:none!important;transform-origin:center!important}',
      '#photoPreviewOverlay .pp-rotate-btn svg g{transform:none!important}'
    ].join('');
    document.head.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function overlay() {
    return document.getElementById('photoPreviewOverlay');
  }

  function image() {
    return document.getElementById('photoPreviewImage');
  }

  function wrapper() {
    return document.getElementById('ppImageWrapper') || (overlay() && overlay().querySelector('.photo-preview-image-wrapper'));
  }

  function isControl(target) {
    return !!(target && target.closest && target.closest('button,.pp-info-modal,.pp-info-modal-content,.pp-download-confirm-overlay,.pp-download-confirm-content'));
  }

  function transformString() {
    return 'translate3d(' + state.tx + 'px,' + state.ty + 'px,0) scale(' + state.scale + ') rotate(' + state.rotation + 'deg)';
  }

  function applyTransform(animate) {
    var img = image();
    if (!img) return;
    img.style.transition = animate ? 'transform 220ms cubic-bezier(.16,1,.3,1)' : 'none';
    img.style.transform = transformString();
    img.classList.toggle('zoomed', state.scale > 1.01);
    if (animate) {
      window.setTimeout(function () {
        if (img) img.style.transition = '';
      }, 240);
    }
  }

  function resetTransform(animate) {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    applyTransform(animate);
  }

  function zoomAt(clientX, clientY, nextScale, animate) {
    var oldScale = state.scale || 1;
    var x = clientX == null ? window.innerWidth / 2 : clientX;
    var y = clientY == null ? window.innerHeight / 2 : clientY;
    var anchorX = (x - window.innerWidth / 2 - state.tx) / oldScale;
    var anchorY = (y - window.innerHeight / 2 - state.ty) / oldScale;
    state.scale = clamp(nextScale, 1, 5);
    state.tx = x - window.innerWidth / 2 - anchorX * state.scale;
    state.ty = y - window.innerHeight / 2 - anchorY * state.scale;
    if (state.scale <= 1.01) resetTransform(animate);
    else applyTransform(animate);
  }

  function cleanupLegacyControls(root) {
    root = root || overlay();
    if (!root) return;
    root.querySelectorAll('#ppCompactBtn,.pp-compact-btn').forEach(function (btn) {
      btn.remove();
    });
    if (!root.querySelector('#ppZoomOutBtn')) {
      var zoomOut = document.createElement('button');
      zoomOut.className = 'pp-zoom-btn pp-zoom-out';
      zoomOut.id = 'ppZoomOutBtn';
      zoomOut.title = '缩小';
      zoomOut.type = 'button';
      zoomOut.onclick = function () { window.zoomOut(); };
      zoomOut.innerHTML = '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"></path></svg></span>';
      root.insertBefore(zoomOut, root.querySelector('#ppInfoBtn') || null);
    }
    if (!root.querySelector('#ppZoomInBtn')) {
      var zoomIn = document.createElement('button');
      zoomIn.className = 'pp-zoom-btn pp-zoom-in';
      zoomIn.id = 'ppZoomInBtn';
      zoomIn.title = '放大';
      zoomIn.type = 'button';
      zoomIn.onclick = function () { window.zoomIn(); };
      zoomIn.innerHTML = '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg></span>';
      root.insertBefore(zoomIn, root.querySelector('#ppInfoBtn') || null);
    }
    var rotateSvg = root.querySelector('#ppRotateBtn svg');
    if (rotateSvg) {
      rotateSvg.innerHTML = '<path d="M20 11a8 8 0 1 0 2.35 5.65"></path><path d="M20 4v7h-7"></path>';
    }
  }

  function installTouchFix(root) {
    var wrap = wrapper();
    if (!root || !wrap || wrap.__xtjPreviewTouchFix) return;
    wrap.__xtjPreviewTouchFix = true;

    wrap.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'touch' || isControl(event.target)) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startTx = state.tx;
      state.startTy = state.ty;
      state.startScale = state.scale;
      state.moved = false;
      if (state.tapTimer) {
        clearTimeout(state.tapTimer);
        state.tapTimer = null;
      }
      if (state.pointers.size === 2) {
        var pts = Array.from(state.pointers.values());
        var cx = (pts[0].x + pts[1].x) / 2;
        var cy = (pts[0].y + pts[1].y) / 2;
        state.mode = 'pinch';
        state.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        state.pinchAx = (cx - window.innerWidth / 2 - state.tx) / state.scale;
        state.pinchAy = (cy - window.innerHeight / 2 - state.ty) / state.scale;
      } else {
        state.mode = state.scale > 1.01 ? 'pan' : 'base';
      }
      try { wrap.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    wrap.addEventListener('pointermove', function (event) {
      if (event.pointerType !== 'touch' || !state.pointers.has(event.pointerId)) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      var dx = event.clientX - state.startX;
      var dy = event.clientY - state.startY;
      if (Math.abs(dx) + Math.abs(dy) > 10) state.moved = true;

      if (state.pointers.size === 2 && state.mode === 'pinch') {
        var pts = Array.from(state.pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        var cx = (pts[0].x + pts[1].x) / 2;
        var cy = (pts[0].y + pts[1].y) / 2;
        state.scale = clamp(state.startScale * (dist / state.pinchDist), 1, 5);
        state.tx = cx - window.innerWidth / 2 - state.pinchAx * state.scale;
        state.ty = cy - window.innerHeight / 2 - state.pinchAy * state.scale;
        applyTransform(false);
      } else if (state.scale > 1.01) {
        state.mode = 'pan';
        state.tx = state.startTx + dx;
        state.ty = state.startTy + dy;
        applyTransform(false);
      } else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
        state.mode = 'dismiss';
        var img = image();
        var root = overlay();
        if (root) root.style.opacity = String(Math.max(0.35, 1 - dy / window.innerHeight));
        if (img) {
          img.style.transition = 'none';
          img.style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + Math.max(0.78, 1 - dy / 900) + ') rotate(' + state.rotation + 'deg)';
        }
      } else {
        state.mode = 'swipe';
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    function endPointer(event) {
      if (event.pointerType !== 'touch' || !state.pointers.has(event.pointerId)) return;
      state.pointers.delete(event.pointerId);
      try { wrap.releasePointerCapture(event.pointerId); } catch (_) {}

      if (state.pointers.size > 0) {
        state.mode = state.scale > 1.01 ? 'pan' : 'base';
        return;
      }

      var dx = event.clientX - state.startX;
      var dy = event.clientY - state.startY;
      var root = overlay();
      if (root) {
        root.style.transition = '';
        root.style.opacity = '';
      }

      if (state.mode === 'pinch') {
        if (state.scale <= 1.04) resetTransform(true);
        else applyTransform(true);
      } else if (state.mode === 'pan') {
        applyTransform(true);
      } else if (state.mode === 'dismiss' && dy > 140) {
        window.closePhotoPreview && window.closePhotoPreview();
      } else if (state.mode === 'dismiss') {
        resetTransform(true);
      } else if (state.mode === 'swipe' && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0 && window.ppNextPhoto) window.ppNextPhoto();
        if (dx > 0 && window.ppPrevPhoto) window.ppPrevPhoto();
      } else if (!state.moved) {
        var now = Date.now();
        if (now - state.lastTap < 300) {
          state.lastTap = 0;
          zoomAt(event.clientX, event.clientY, state.scale > 1.01 ? 1 : 2, true);
        } else {
          state.lastTap = now;
          state.tapTimer = window.setTimeout(function () {
            state.tapTimer = null;
          }, 320);
        }
      }
      state.mode = '';
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    wrap.addEventListener('pointerup', endPointer, true);
    wrap.addEventListener('pointercancel', function (event) {
      if (event.pointerType !== 'touch') return;
      state.pointers.clear();
      state.mode = '';
      applyTransform(true);
      event.stopImmediatePropagation();
    }, true);
  }

  function afterOpen() {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.rotation = 0;
    cleanupLegacyControls();
    installTouchFix(overlay());
    applyTransform(false);
  }

  function wrapOpenPreview() {
    if (typeof window.openPhotoPreview !== 'function' || window.openPhotoPreview.__xtjHotfixWrapped) return;
    var originalOpen = window.openPhotoPreview;
    window.openPhotoPreview = function () {
      var result = originalOpen.apply(this, arguments);
      requestAnimationFrame(function () {
        requestAnimationFrame(afterOpen);
      });
      return result;
    };
    window.openPhotoPreview.__xtjHotfixWrapped = true;
  }

  window.zoomIn = function () {
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, state.scale >= 1.01 ? state.scale + 0.5 : 2, true);
  };

  window.zoomOut = function () {
    if (state.scale <= 1.25) resetTransform(true);
    else zoomAt(window.innerWidth / 2, window.innerHeight / 2, state.scale - 0.5, true);
  };

  window.ppRotatePhoto = function () {
    state.rotation = (state.rotation + 90) % 360;
    applyTransform(true);
    if (window.showToast) window.showToast('已旋转 ' + state.rotation + '°');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      installFinalStyle();
      cleanupLegacyControls();
      wrapOpenPreview();
    });
  } else {
    installFinalStyle();
    cleanupLegacyControls();
    wrapOpenPreview();
  }
})();
