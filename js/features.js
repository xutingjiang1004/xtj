(function() {
    function restoreMinimalDockStyles() {
        var old = document.getElementById('xtjDockRestoreStyle');
        if (old) old.remove();
        var style = document.getElementById('xtjDockMinimalStyle');
        if (!style) {
            style = document.createElement('style');
            style.id = 'xtjDockMinimalStyle';
            document.head.appendChild(style);
        }
        style.textContent = `
            #dockBar.dock-bar {
                position: fixed !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 3px !important;
                padding: 10px 12px 14px !important;
                padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
                padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
                padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)) !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                pointer-events: none !important;
                z-index: 100 !important;
            }
            #dockBar .dock-tab,
            #dockBar .dock-tab.active,
            #dockBar .dock-tab:hover,
            #dockBar .dock-tab:focus,
            #dockBar .dock-tab:focus-visible {
                -webkit-appearance: none !important;
                appearance: none !important;
                background: transparent !important;
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
                -webkit-box-shadow: none !important;
            }
            #dockBar .dock-tab {
                margin: 0 !important;
                width: auto !important;
                min-width: 62px !important;
                max-width: 80px !important;
                height: 54px !important;
                flex: 1 1 0 !important;
                padding: 4px 10px !important;
                border-radius: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 1px !important;
                color: var(--text-muted) !important;
                font-family: inherit !important;
                font-size: 9px !important;
                line-height: 1 !important;
                cursor: pointer !important;
                pointer-events: auto !important;
                position: relative !important;
                overflow: visible !important;
                -webkit-tap-highlight-color: transparent !important;
                transition: color .28s cubic-bezier(.16,1,.3,1), transform .28s cubic-bezier(.16,1,.3,1) !important;
            }
            #dockBar .dock-tab::before,
            #dockBar .dock-tab::after,
            #dockBar .dock-tab.active::before,
            #dockBar .dock-tab.active::after {
                display: none !important;
                content: none !important;
                opacity: 0 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            #dockBar .dock-tab.active {
                color: var(--primary) !important;
                transform: translateY(-4px) !important;
            }
            #dockBar .dock-tab:active {
                transform: scale(.94) !important;
            }
            #dockBar .dock-tab.active:active {
                transform: translateY(-4px) scale(.94) !important;
            }
            #dockBar .dock-tab .dt-icon,
            #dockBar .dock-tab .dt-label {
                position: relative !important;
                z-index: 1 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }
            #dockBar .dock-tab .dt-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 24px !important;
                height: 24px !important;
                font-size: 20px !important;
                line-height: 1 !important;
                filter: none !important;
            }
            #dockBar .dock-tab.active .dt-icon {
                filter: drop-shadow(0 4px 8px rgba(5,150,105,.22)) !important;
            }
            #dockBar .dock-tab .dt-icon svg.dt-svg,
            #dockBar .dock-tab .dt-icon svg {
                width: 21px !important;
                height: 21px !important;
                display: block !important;
            }
            #dockBar .dock-tab .dt-label {
                display: block !important;
                height: auto !important;
                overflow: visible !important;
                pointer-events: none !important;
                font-size: 9px !important;
                font-weight: 500 !important;
                letter-spacing: .25px !important;
                color: currentColor !important;
            }
            #dockBar .dock-tab.active .dt-label {
                font-weight: 700 !important;
            }
            #dockBar .dock-tab[data-tab="ai"] .dt-label {
                display: none !important;
            }
            #dockBar .dock-tab .anim-layer,
            #dockBar .dock-tab .anim-layer * {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            #dockBar .dock-tab .anim-layer {
                position: absolute !important;
                left: 50% !important;
                top: 50% !important;
                transform: translate(-50%, -50%) !important;
                pointer-events: none !important;
                z-index: 2 !important;
            }
            body.photo-previewing #dockBar {
                display: none !important;
            }
        `;
    }

    restoreMinimalDockStyles();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreMinimalDockStyles);
    }

    function syncProfileUser() {
        var profileName = document.getElementById('profileName');
        var profileStatus = document.getElementById('profileStatus');
        var profileAvatar = document.getElementById('profileAvatar');
        if (!profileName) return;
        if (window.currentUser) {
            profileName.textContent = window.currentUser;
            profileStatus.textContent = '查看资料';
            if (profileAvatar) profileAvatar.textContent = window.currentUser[0].toUpperCase();
        } else {
            profileName.textContent = '未登录';
            profileStatus.textContent = '点击登录';
            if (profileAvatar) profileAvatar.innerHTML = '?';
        }
    }
    window.syncProfileUser = syncProfileUser;

    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.report-btn');
        if (!btn) return;
        var postId = btn.getAttribute('data-id');
        var userName = btn.getAttribute('data-user') || '';
        window.openReport('post', postId, userName);
    });

    window.openReport = function(targetType, targetId, targetUser) {
        var modal = document.getElementById('reportModal');
        if (!modal) return;
        var overlay = modal.closest('.modal-overlay') || modal;
        overlay.style.display = '';
        overlay.classList.add('active');
        document.getElementById('reportCategory').value = 'spam';
        document.getElementById('reportReason').value = '';
        document.getElementById('reportEvidencePreview').textContent = '';
        document.getElementById('reportEvidenceInput').value = '';
        window._reportTarget = { type: targetType, id: targetId, user: targetUser };
    };

    window.submitReport = async function() {
        var target = window._reportTarget;
        if (!target) { window.showToast('举报目标不存在'); return; }
        var category = document.getElementById('reportCategory').value;
        var reason = document.getElementById('reportReason').value.trim();
        if (!reason) { window.showToast('请填写举报理由'); return; }
        var btn = document.getElementById('reportSubmitBtn');
        btn.disabled = true;
        btn.textContent = '提交中...';
        try {
            var evidenceFile = document.getElementById('reportEvidenceInput').files[0];
            var evidenceUrl = '';
            if (evidenceFile) {
                var path = 'reports/' + Date.now() + '_' + evidenceFile.name;
                var uploadRes = await window.sb.storage.from('uploads').upload(path, evidenceFile);
                if (uploadRes.error) throw uploadRes.error;
                evidenceUrl = window.sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
            }
            var payload = {
                reporter_name: window.currentUser || 'anonymous',
                target_type: target.type,
                target_id: target.id,
                target_user: target.user || '',
                report_category: category,
                report_reason: reason,
                evidence_url: evidenceUrl,
                status: 'pending'
            };
            var { error } = await window.sb.from('reports').insert([payload]);
            if (error) {
                var fallbackPayload = {
                    reporter: window.currentUser || 'anonymous',
                    target_type: target.type,
                    target_id: target.id,
                    target_user: target.user || '',
                    category: category,
                    reason: reason,
                    evidence_url: evidenceUrl,
                    actor_key: window.deviceId || 'unknown'
                };
                console.warn('[report] 主字段插入失败，尝试备用字段:', error.message);
                var { error: err2 } = await window.sb.from('reports').insert([fallbackPayload]);
                if (err2) throw err2;
            }
            window.showToast('举报已提交，感谢你的反馈！');
            window.closeModal('reportModal');
        } catch (e) {
            window.showToast('提交失败: ' + (e.message || '网络错误'));
        } finally {
            btn.disabled = false;
            btn.textContent = '提交举报';
        }
    };

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'reportEvidenceInput') {
            var file = e.target.files[0];
            var preview = document.getElementById('reportEvidencePreview');
            if (preview) {
                preview.textContent = file ? '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)' : '';
            }
        }
    });

    function calcPathLengths() {
        var pathEl = document.querySelector('.dock-tab[data-tab="posts"] .al-path');
        if (pathEl && typeof pathEl.getTotalLength === 'function') {
            var len = Math.round(pathEl.getTotalLength());
            pathEl.style.setProperty('--path-len', len);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', calcPathLengths);
    } else {
        calcPathLengths();
    }

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'profileThemeToggle') {
            var themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.click();
            }
        }
    });

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'profileNotifToggle') {
            var enabled = e.target.checked;
            try { localStorage.setItem('xtj-notif', enabled ? 'on' : 'off'); } catch(e2) {}
        }
    });

    function initProfileToggles() {
        var themeToggle = document.getElementById('profileThemeToggle');
        var notifToggle = document.getElementById('profileNotifToggle');
        if (themeToggle) {
            var isDark = document.body.classList.contains('dark-theme');
            themeToggle.checked = isDark;
        }
        if (notifToggle) {
            try {
                var saved = localStorage.getItem('xtj-notif');
                if (saved !== null) notifToggle.checked = saved !== 'off';
            } catch(e) {}
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProfileToggles);
    } else {
        initProfileToggles();
    }
})();

(function() {
    if (window.__xtjPhotoPreviewZoomPatchInstalled) return;
    window.__xtjPhotoPreviewZoomPatchInstalled = true;

    var MIN_SCALE = 1;
    var MAX_SCALE = 5;
    var DOUBLE_TAP_SCALE = 2.6;
    var z = {
        scale: 1,
        tx: 0,
        ty: 0,
        pointers: new Map(),
        panning: false,
        pinching: false,
        startX: 0,
        startY: 0,
        startTx: 0,
        startTy: 0,
        startScale: 1,
        startDist: 0,
        startCenterX: 0,
        startCenterY: 0,
        moved: false,
        lastTapAt: 0,
        lastTapX: 0,
        lastTapY: 0,
        touchPinching: false
    };

    function injectZoomStyle() {
        if (document.getElementById('xtjPhotoZoomPatchStyle')) return;
        var style = document.createElement('style');
        style.id = 'xtjPhotoZoomPatchStyle';
        style.textContent = [
            '#photoPreviewOverlay.pp-zooming .photo-preview-image-wrapper{touch-action:none!important;}',
            '#photoPreviewImage.pp-zoom-active{cursor:grab;will-change:transform;}',
            '#photoPreviewImage.pp-zoom-active:active{cursor:grabbing;}',
            '#photoPreviewImage.pp-zoom-transition{transition:transform .24s cubic-bezier(.16,1,.3,1)!important;}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function overlay() { return document.getElementById('photoPreviewOverlay'); }
    function wrapper() { return document.getElementById('ppImageWrapper'); }
    function img() { return document.getElementById('photoPreviewImage'); }
    function active() {
        var ov = overlay();
        return !!(ov && ov.classList.contains('active'));
    }
    function inPreviewTarget(target) {
        return !!(target && target.closest && (target.closest('#ppImageWrapper') || target.closest('#photoPreviewImage')) && !target.closest('button,.pp-info-modal-content'));
    }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function clampPan() {
        if (z.scale <= 1.01) {
            z.tx = 0;
            z.ty = 0;
            return;
        }
        var maxX = Math.max(0, (window.innerWidth * (z.scale - 1)) / 2 + 80);
        var maxY = Math.max(0, (window.innerHeight * (z.scale - 1)) / 2 + 80);
        z.tx = clamp(z.tx, -maxX, maxX);
        z.ty = clamp(z.ty, -maxY, maxY);
    }

    function applyZoom(animate) {
        var im = img();
        var ov = overlay();
        if (!im) return;
        clampPan();
        im.classList.toggle('pp-zoom-active', z.scale > 1.01);
        if (animate) {
            im.classList.add('pp-zoom-transition');
            setTimeout(function() { if (im) im.classList.remove('pp-zoom-transition'); }, 260);
        } else {
            im.classList.remove('pp-zoom-transition');
        }
        im.style.transformOrigin = 'center center';
        im.style.transform = 'translate3d(' + z.tx + 'px,' + z.ty + 'px,0) scale(' + z.scale + ')';
        if (ov) ov.classList.toggle('pp-zooming', z.scale > 1.01 || z.pinching || z.panning || z.touchPinching);
    }

    function resetZoom(animate) {
        z.scale = 1;
        z.tx = 0;
        z.ty = 0;
        z.panning = false;
        z.pinching = false;
        z.touchPinching = false;
        z.pointers.clear();
        applyZoom(animate !== false);
    }
    window.xtjPhotoPreviewResetZoom = resetZoom;

    function zoomAt(nextScale, clientX, clientY, animate) {
        var im = img();
        if (!im) return;
        var oldScale = z.scale || 1;
        nextScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
        if (nextScale <= 1.01) {
            resetZoom(true);
            return;
        }
        var cx = window.innerWidth / 2;
        var cy = window.innerHeight / 2;
        var px = (typeof clientX === 'number') ? clientX : cx;
        var py = (typeof clientY === 'number') ? clientY : cy;
        var ratio = nextScale / oldScale;
        z.tx = px - cx - (px - cx - z.tx) * ratio;
        z.ty = py - cy - (py - cy - z.ty) * ratio;
        z.scale = nextScale;
        applyZoom(animate !== false);
    }

    function distance(a, b) {
        var dx = a.clientX - b.clientX;
        var dy = a.clientY - b.clientY;
        return Math.hypot(dx, dy);
    }
    function center(a, b) {
        return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }

    function beginPinch() {
        var pts = Array.from(z.pointers.values());
        if (pts.length < 2) return;
        z.pinching = true;
        z.panning = false;
        z.startDist = Math.max(1, distance(pts[0], pts[1]));
        var c = center(pts[0], pts[1]);
        z.startCenterX = c.x;
        z.startCenterY = c.y;
        z.startScale = z.scale;
        z.startTx = z.tx;
        z.startTy = z.ty;
        var ov = overlay();
        if (ov) ov.classList.add('pp-zooming');
    }

    function updatePinch() {
        var pts = Array.from(z.pointers.values());
        if (pts.length < 2 || !z.pinching) return;
        var dist = Math.max(1, distance(pts[0], pts[1]));
        var c = center(pts[0], pts[1]);
        var nextScale = clamp(z.startScale * (dist / z.startDist), MIN_SCALE, MAX_SCALE);
        var baseCx = window.innerWidth / 2;
        var baseCy = window.innerHeight / 2;
        var ratio = nextScale / (z.startScale || 1);
        z.scale = nextScale;
        z.tx = (c.x - baseCx) - (z.startCenterX - baseCx - z.startTx) * ratio;
        z.ty = (c.y - baseCy) - (z.startCenterY - baseCy - z.startTy) * ratio;
        applyZoom(false);
    }

    function handlePointerDown(e) {
        if (!active() || !inPreviewTarget(e.target)) return;
        z.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        z.moved = false;
        if (z.pointers.size >= 2) {
            e.preventDefault();
            e.stopImmediatePropagation();
            beginPinch();
            return;
        }
        if (z.scale > 1.01) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.panning = true;
            z.startX = e.clientX;
            z.startY = e.clientY;
            z.startTx = z.tx;
            z.startTy = z.ty;
        }
    }

    function handlePointerMove(e) {
        if (!active() || !z.pointers.has(e.pointerId)) return;
        z.pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        if (z.pinching) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.moved = true;
            updatePinch();
            return;
        }
        if (z.panning && z.scale > 1.01) {
            e.preventDefault();
            e.stopImmediatePropagation();
            var dx = e.clientX - z.startX;
            var dy = e.clientY - z.startY;
            if (Math.abs(dx) + Math.abs(dy) > 6) z.moved = true;
            z.tx = z.startTx + dx;
            z.ty = z.startTy + dy;
            applyZoom(false);
        }
    }

    function handlePointerUp(e) {
        if (!active()) return;
        var hadPointer = z.pointers.has(e.pointerId);
        var wasPinching = z.pinching;
        var wasPanning = z.panning;
        z.pointers.delete(e.pointerId);
        if (wasPinching) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (z.pointers.size < 2) {
                z.pinching = false;
                if (z.scale <= 1.04) resetZoom(true);
                else applyZoom(true);
            }
            return;
        }
        if (wasPanning) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.panning = false;
            if (z.scale <= 1.04) resetZoom(true);
            else applyZoom(true);
            return;
        }
        if (hadPointer && inPreviewTarget(e.target) && !z.moved) {
            var now = Date.now();
            var dist = Math.hypot(e.clientX - z.lastTapX, e.clientY - z.lastTapY);
            if (now - z.lastTapAt < 320 && dist < 44) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (z.scale > 1.01) resetZoom(true);
                else zoomAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
                z.lastTapAt = 0;
            } else {
                z.lastTapAt = now;
                z.lastTapX = e.clientX;
                z.lastTapY = e.clientY;
            }
        }
    }

    function handleDblClick(e) {
        if (!active() || !inPreviewTarget(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (z.scale > 1.01) resetZoom(true);
        else zoomAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
    }

    function handleWheel(e) {
        if (!active() || !inPreviewTarget(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var factor = e.deltaY < 0 ? 1.16 : 0.86;
        zoomAt(z.scale * factor, e.clientX, e.clientY, false);
    }

    function touchPoint(t) { return { clientX: t.clientX, clientY: t.clientY }; }
    function handleTouchStart(e) {
        if (!active() || !inPreviewTarget(e.target)) return;
        if (e.touches.length === 2) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.touchPinching = true;
            var a = touchPoint(e.touches[0]);
            var b = touchPoint(e.touches[1]);
            z.startDist = Math.max(1, distance(a, b));
            var c = center(a, b);
            z.startCenterX = c.x;
            z.startCenterY = c.y;
            z.startScale = z.scale;
            z.startTx = z.tx;
            z.startTy = z.ty;
            var ov = overlay();
            if (ov) ov.classList.add('pp-zooming');
        } else if (e.touches.length === 1 && z.scale > 1.01) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.panning = true;
            z.startX = e.touches[0].clientX;
            z.startY = e.touches[0].clientY;
            z.startTx = z.tx;
            z.startTy = z.ty;
        }
    }
    function handleTouchMove(e) {
        if (!active() || !inPreviewTarget(e.target)) return;
        if (z.touchPinching && e.touches.length === 2) {
            e.preventDefault();
            e.stopImmediatePropagation();
            var a = touchPoint(e.touches[0]);
            var b = touchPoint(e.touches[1]);
            var dist = Math.max(1, distance(a, b));
            var c = center(a, b);
            var nextScale = clamp(z.startScale * (dist / z.startDist), MIN_SCALE, MAX_SCALE);
            var baseCx = window.innerWidth / 2;
            var baseCy = window.innerHeight / 2;
            var ratio = nextScale / (z.startScale || 1);
            z.scale = nextScale;
            z.tx = (c.x - baseCx) - (z.startCenterX - baseCx - z.startTx) * ratio;
            z.ty = (c.y - baseCy) - (z.startCenterY - baseCy - z.startTy) * ratio;
            applyZoom(false);
        } else if (z.panning && z.scale > 1.01 && e.touches.length === 1) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.tx = z.startTx + (e.touches[0].clientX - z.startX);
            z.ty = z.startTy + (e.touches[0].clientY - z.startY);
            applyZoom(false);
        }
    }
    function handleTouchEnd(e) {
        if (!active()) return;
        if (z.touchPinching || z.panning) {
            e.preventDefault();
            e.stopImmediatePropagation();
            z.touchPinching = false;
            z.panning = false;
            if (z.scale <= 1.04) resetZoom(true);
            else applyZoom(true);
        }
    }

    function wrapPreviewFns() {
        if (window.__xtjPhotoZoomFnsWrapped) return;
        window.__xtjPhotoZoomFnsWrapped = true;
        var oldOpen = window.openPhotoPreview;
        if (typeof oldOpen === 'function') {
            window.openPhotoPreview = function() {
                resetZoom(false);
                var ret = oldOpen.apply(this, arguments);
                setTimeout(function() { resetZoom(false); }, 0);
                return ret;
            };
        }
        var oldClose = window.closePhotoPreview;
        if (typeof oldClose === 'function') {
            window.closePhotoPreview = function() {
                resetZoom(false);
                return oldClose.apply(this, arguments);
            };
        }
        var oldPrev = window.ppPrevPhoto;
        if (typeof oldPrev === 'function') {
            window.ppPrevPhoto = function() {
                resetZoom(false);
                var ret = oldPrev.apply(this, arguments);
                setTimeout(function() { resetZoom(false); }, 330);
                return ret;
            };
        }
        var oldNext = window.ppNextPhoto;
        if (typeof oldNext === 'function') {
            window.ppNextPhoto = function() {
                resetZoom(false);
                var ret = oldNext.apply(this, arguments);
                setTimeout(function() { resetZoom(false); }, 330);
                return ret;
            };
        }
        var oldRotate = window.ppRotatePhoto;
        if (typeof oldRotate === 'function') {
            window.ppRotatePhoto = function() {
                resetZoom(false);
                return oldRotate.apply(this, arguments);
            };
        }
    }

    function installZoomEvents() {
        injectZoomStyle();
        wrapPreviewFns();
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('pointermove', handlePointerMove, true);
        document.addEventListener('pointerup', handlePointerUp, true);
        document.addEventListener('pointercancel', handlePointerUp, true);
        document.addEventListener('dblclick', handleDblClick, true);
        document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
        document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
        document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
        document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });
        window.addEventListener('resize', function() { if (active() && z.scale > 1.01) resetZoom(true); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installZoomEvents);
    } else {
        installZoomEvents();
    }
})();