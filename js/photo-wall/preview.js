(function() {
    var ppZoom = { scale: 1, tx: 0, ty: 0 };
    var ppPointers = new Map();
    var ppStart = null;
    var ppLastTap = 0;
    var ppTapTimer = null;
    var ppMoved = false;
    var ppPhotoIdx = -1;
    var ppSwipeLock = 0;
    var ppNavBusy = false;
    var ppSortedPhotos = [];
    window.ppSortedPhotos = ppSortedPhotos;
    var ppTrack = null;
    var ppTrackDrag = 0;
    var ppTrackSnapping = false;
    var ppVw = 0;
    var ppVelocitySamples = new Array(8);
    var ppVelIdx = 0;
    var ppVelCount = 0;
    var ppLastMoveX = 0;
    var ppLastMoveT = 0;
    var ppRafId = null;
    var ppPreloadCache = {};
    var ppImageCache = {};
    var ppDecodeQueue = {};
    var ppTapHandled = false;
    var ppTrackRaf = null;
    var ppTransformRaf = null;
    var ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };
    var ppRefreshRate = 60;
    var ppFrameBudget = 16;
    var photoPreviewActive = false;
    var photoPreviewClosedAt = 0;
    var photoPreviewCurrent = null;
    window.photoPreviewCurrent = photoPreviewCurrent;
    var ppEventsBound = false;

    function detectRefreshRate() {
        var times = [];
        var frames = 0;
        var lastTime = performance.now();
        var medians = [];
        function sample() {
            frames++;
            var now = performance.now();
            if (frames >= 10) {
                var elapsed = now - lastTime;
                var fps = Math.round(frames / elapsed * 1000);
                medians.push(fps);
                if (medians.length >= 3) {
                    medians.sort(function(a, b) { return a - b; });
                    var median = medians[Math.floor(medians.length / 2)];
                    ppRefreshRate = Math.max(30, Math.min(144, median));
                    ppFrameBudget = 1000 / ppRefreshRate;
                    return;
                }
                frames = 0;
                lastTime = now;
            }
            requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
    }
    detectRefreshRate();

    function ppInitTrack() {
        ppTrack = document.getElementById('ppSlideTrack');
        ppVw = window.innerWidth;
    }

    function ppDecodeImage(url) {
        if (!url || ppDecodeQueue[url] instanceof Promise) return ppDecodeQueue[url] || Promise.resolve();
        ppDecodeQueue[url] = new Promise(function(resolve) {
            var img = ppImageCache[url];
            if (img && img !== 'loading') {
                if (img.decode) { img.decode().then(resolve).catch(function() { resolve(); }); }
                else { resolve(); }
                return;
            }
            var pre = new Image();
            pre.crossOrigin = 'anonymous';
            pre.onload = function() {
                ppImageCache[url] = pre;
                if (pre.decode) { pre.decode().then(resolve).catch(function() { resolve(); }); }
                else { resolve(); }
            };
            pre.onerror = function() {
                ppImageCache[url] = null;
                resolve();
            };
            pre.src = url;
        });
        return ppDecodeQueue[url];
    }

    function ppSwapImage(imgEl, url) {
        if (!imgEl) return;
        if (!url) {
            imgEl.src = '';
            imgEl.style.opacity = '0';
            return;
        }
        var loadDone = false;
        function show() {
            if (loadDone) return;
            loadDone = true;
            imgEl.style.opacity = '1';
            imgEl.removeEventListener('load', show);
            imgEl.removeEventListener('error', show);
        }
        imgEl.addEventListener('load', show);
        imgEl.addEventListener('error', show);
        imgEl.src = url;
        if (imgEl.complete && imgEl.naturalWidth > 0) {
            show();
        }
        setTimeout(function() {
            if (!loadDone) show();
        }, 5000);
    }

    function ppSetTrackImages(idx) {
        ppInitTrack();
        if (!ppTrack) return;
        var photos = ppSortedPhotos;
        var prevImg = document.getElementById('ppPrevImg');
        var curImg = document.getElementById('photoPreviewImage');
        var nextImg = document.getElementById('ppNextImg');
        ppPreloadAdjacent(idx);
        if (photos[idx]) {
            ppSwapImage(curImg, photos[idx].imageUrl);
        }
        if (idx > 0 && photos[idx - 1]) {
            ppSwapImage(prevImg, photos[idx - 1].imageUrl);
        } else {
            ppSwapImage(prevImg, null);
        }
        if (idx < photos.length - 1 && photos[idx + 1]) {
            ppSwapImage(nextImg, photos[idx + 1].imageUrl);
        } else {
            ppSwapImage(nextImg, null);
        }
        ppTrackDrag = 0;
        ppTrackSnapping = false;
        ppTrack.classList.remove('snapping');
        ppTrack.style.transition = '';
        ppTrack.style.webkitTransition = '';
        ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        ppTrack.style.webkitTransform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        if (photos[idx]) window.updateAmbientBackground(photos[idx].imageUrl);

        setTimeout(function() {
            var imgs = [curImg, prevImg, nextImg];
            for (var k = 0; k < imgs.length; k++) {
                if (imgs[k] && imgs[k].src && imgs[k].src !== window.location.href && imgs[k].style.opacity === '0') {
                    imgs[k].style.opacity = '1';
                }
            }
        }, 1000);
    }

    function ppPreloadImage(url) {
        if (!url || ppImageCache[url]) return Promise.resolve();
        ppImageCache[url] = 'loading';
        return ppDecodeImage(url);
    }

    function ppPreloadAdjacent(idx) {
        var photos = ppSortedPhotos;
        var urls = [];
        var offsets = [0, -1, 1, -2, 2, -3, 3];
        for (var o = 0; o < offsets.length; o++) {
            if (urls.length >= 3) break;
            var i = idx + offsets[o];
            if (i >= 0 && i < photos.length && photos[i] && photos[i].imageUrl) {
                urls.push(photos[i].imageUrl);
            }
        }
        urls.forEach(function(url) {
            if (!ppPreloadCache[url]) {
                ppPreloadCache[url] = true;
                ppPreloadImage(url);
            }
        });
    }

    function ppApplySlideTrack() {
        if (!ppTrack || ppTrackSnapping) return;
        if (ppTrackRaf) {
            cancelAnimationFrame(ppTrackRaf);
        }
        ppTrackRaf = requestAnimationFrame(function() {
            var offset = -ppVw + ppTrackDrag;
            ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
            ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';
            ppTrackRaf = null;
        });
    }

    function ppApplySlideTrackImmediate() {
        if (!ppTrack || ppTrackSnapping) return;
        var offset = -ppVw + ppTrackDrag;
        ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
        ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';
    }

    function ppApplyImageTransform() {
        var img = document.getElementById('photoPreviewImage');
        if (!img) return;
        var isZoomed = ppZoom.scale > 1.01;
        if (isZoomed !== img.classList.contains('zoomed')) {
            img.classList.toggle('zoomed', isZoomed);
        }
        if (ppTransformRaf) {
            cancelAnimationFrame(ppTransformRaf);
        }
        ppTransformRaf = requestAnimationFrame(function() {
            var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
            img.style.transform = t;
            img.style.webkitTransform = t;
            ppTransformRaf = null;
        });
    }

    function ppApplyPinchTransformImmediate() {
        var img = document.getElementById('photoPreviewImage');
        if (!img) return;
        var isZoomed = ppZoom.scale > 1.01;
        if (isZoomed !== img.classList.contains('zoomed')) {
            img.classList.toggle('zoomed', isZoomed);
        }
        var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
        img.style.transform = t;
        img.style.webkitTransform = t;
    }

    function ppResetZoom() {
        ppZoom = { scale: 1, tx: 0, ty: 0 };
        ppPointers.clear();
        ppStart = null;
        var img = document.getElementById('photoPreviewImage');
        if (img) {
            img.classList.remove('zoomed', 'dragging');
            img.style.transform = '';
            img.style.webkitTransform = '';
        }
    }

    function ppToggleZoom(clientX, clientY) {
        var img = document.getElementById('photoPreviewImage');
        if (!img) return;
        if (ppZoom.scale > 1.05) {
            ppResetZoom();
        } else {
            var newScale = 2.6;
            var centerX = window.innerWidth / 2;
            var centerY = window.innerHeight / 2;
            var ratio = newScale / 1;
            ppZoom.scale = newScale;
            ppZoom.tx = (clientX - centerX) * (1 - ratio);
            ppZoom.ty = (clientY - centerY) * (1 - ratio);
            ppApplyImageTransform();
        }
    }

    function ppSnapTo(targetOffset, callback) {
        if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
        ppTrackSnapping = true;

        function onSnapEnd(ev) {
            if (ev && ev.propertyName !== 'transform' && ev.propertyName !== '-webkit-transform') return;
            ppTrack.removeEventListener('transitionend', onSnapEnd);
            ppTrack.classList.remove('snapping');
            ppTrackSnapping = false;
            if (ppRafId) { clearTimeout(ppRafId); ppRafId = null; }
            if (callback) callback();
            ppSwipeLock = 0;
            ppNavBusy = false;
        }

        var absDiff = Math.abs(ppTrackDrag - targetOffset);
        var duration = Math.min(320, Math.max(160, absDiff / ppVw * 320));

        ppTrack.classList.add('snapping');
        var transitionStr = 'transform ' + duration + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        ppTrack.style.transition = transitionStr;
        ppTrack.style.webkitTransition = '-webkit-transform ' + duration + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        ppTrack.addEventListener('transitionend', onSnapEnd);

        var finalOffset = -ppVw + targetOffset;
        ppTrack.style.transform = 'translate3d(' + finalOffset + 'px, 0, 0)';
        ppTrack.style.webkitTransform = 'translate3d(' + finalOffset + 'px, 0, 0)';

        var safeTimer = setTimeout(function() {
            ppTrack.removeEventListener('transitionend', onSnapEnd);
            onSnapEnd();
        }, duration + 150);
        ppRafId = safeTimer;
    }

    function ppUpdateNavArrows() {
        var prevBtn = document.getElementById('ppPrevBtn');
        var nextBtn = document.getElementById('ppNextBtn');
        if (prevBtn) {
            prevBtn.classList.toggle('pp-nav-hidden', ppPhotoIdx <= 0);
        }
        if (nextBtn) {
            nextBtn.classList.toggle('pp-nav-hidden', ppPhotoIdx >= ppSortedPhotos.length - 1);
        }
    }

    function ppPrevPhoto() {
        if (ppNavBusy || ppPhotoIdx <= 0) return;
        ppNavigatePhoto(-1);
    }
    window.ppPrevPhoto = ppPrevPhoto;

    function ppNextPhoto() {
        if (ppNavBusy || ppPhotoIdx >= ppSortedPhotos.length - 1) return;
        ppNavigatePhoto(1);
    }
    window.ppNextPhoto = ppNextPhoto;

    function ppNavigatePhoto(direction) {
        if (ppNavBusy) return;
        var newIdx = ppPhotoIdx + direction;
        if (newIdx < 0 || newIdx >= ppSortedPhotos.length) {
            if (Math.abs(ppTrackDrag) > 2) ppSnapTo(0);
            return;
        }
        ppNavBusy = true;
        ppSwipeLock = 1;
        var photo = ppSortedPhotos[newIdx];
        var targetDrag = direction > 0 ? -ppVw : ppVw;
        window.updateAmbientBackground(photo.imageUrl);

        ppSnapTo(targetDrag, function() {
                photo.views = (photo.views || 0) + 1;
                ppPhotoIdx = newIdx;
                photoPreviewCurrent = photo;
                window.saveLocalPhotoWallData();
                window.updatePhotoViewDisplays(photo);
                ppResetZoom();
                ppSetTrackImages(newIdx);
                document.getElementById('photoPreviewUser').textContent = photo.username || '未知用户';
                document.getElementById('photoPreviewTime').textContent = window.formatPhotoTime(photo.timestamp);
                document.getElementById('photoPreviewViewsCount').textContent = photo.views;
                ppUpdateDots();
                ppUpdateNavArrows();
                var delBtn2 = document.getElementById('ppDeleteBtn');
                if (delBtn2) {
                    delBtn2.style.display = (window.currentUser && photo.username === window.currentUser) ? 'flex' : 'none';
                }
                window.syncPhotoViewCount(photo);
            });
    }

    function ppUpdateDots() {
        var dots = document.getElementById('ppDots');
        if (!dots || !ppSortedPhotos.length) return;
        if (ppSortedPhotos.length > 50) { dots.innerHTML = ''; return; }
        var html = '';
        for (var i = 0; i < ppSortedPhotos.length; i++) {
            html += '<span class="pp-dot' + (i === ppPhotoIdx ? ' active' : '') + '" data-idx="' + i + '"></span>';
        }
        dots.innerHTML = html;
    }

    function openPhotoPreview(index) {
        ppPhotoIdx = index;
        var sortKey = window.pwSortKey || 'date_desc';
        ppSortedPhotos = window.photoWallData.slice();
        if (typeof window.pwApplySort === 'function') {
            ppSortedPhotos = window.pwApplySort(ppSortedPhotos, sortKey);
        } else {
            ppSortedPhotos.sort(function(a, b) { return b.timestamp - a.timestamp; });
        }
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) {
            var container = document.createElement('div');
            container.id = 'photoPreviewOverlay';
            container.className = 'photo-preview-overlay';
            container.innerHTML = '<div id="ppAmbientBg" class="pp-ambient-bg"></div>' +
                '<button id="ppCloseBtn" class="pp-close-btn" onclick="window.closePhotoPreview()">✕</button>' +
                '<button id="ppPrevBtn" class="pp-nav-arrow pp-nav-prev" onclick="window.ppPrevPhoto()" aria-label="上一张">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</button>' +
                '<button id="ppNextBtn" class="pp-nav-arrow pp-nav-next" onclick="window.ppNextPhoto()" aria-label="下一张">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</button>' +
                '<div id="ppSlideTrack" class="pp-slide-track">' +
                '<div class="pp-slide-slot pp-prev-slot"><img id="ppPrevImg" class="pp-slide-img" alt="prev"></div>' +
                '<div class="pp-slide-slot pp-cur-slot"><img id="photoPreviewImage" class="pp-slide-img" alt="current"></div>' +
                '<div class="pp-slide-slot pp-next-slot"><img id="ppNextImg" class="pp-slide-img" alt="next"></div>' +
                '</div>' +
                '<div class="photo-preview-info">' +
                '<div class="photo-preview-user" id="photoPreviewUser"></div>' +
                '<div class="photo-preview-meta"><span id="photoPreviewTime"></span> · 浏览 <span id="photoPreviewViewsCount">0</span></div>' +
                '</div>' +
                '<div class="pp-pagination"><div id="ppDots" class="pp-dots"></div></div>' +
                '<div class="pp-backdrop-gradient pp-backdrop-top"></div>' +
                '<div class="pp-backdrop-gradient pp-backdrop-bot"></div>' +
                '<button id="ppDeleteBtn" class="pp-delete-btn" onclick="window.deletePhotoFromPreview()">🗑️</button>';
            document.body.appendChild(container);
            overlay = container;
        }
        if (!ppEventsBound) {
            bindPreviewEvents(overlay);
            ppEventsBound = true;
        }
        ppResetZoom();
        photoPreviewActive = true;
        photoPreviewCurrent = ppSortedPhotos[index] || null;
        overlay.classList.add('active');
        document.body.classList.add('pp-body-noscroll');
        document.getElementById('photoPreviewUser').textContent = photoPreviewCurrent ? (photoPreviewCurrent.username || '未知用户') : '';
        document.getElementById('photoPreviewTime').textContent = photoPreviewCurrent ? window.formatPhotoTime(photoPreviewCurrent.timestamp) : '';
        document.getElementById('photoPreviewViewsCount').textContent = photoPreviewCurrent ? (photoPreviewCurrent.views || 0) : 0;
        var delBtn = document.getElementById('ppDeleteBtn');
        if (delBtn && photoPreviewCurrent) {
            delBtn.style.display = (window.currentUser && photoPreviewCurrent.username === window.currentUser) ? 'flex' : 'none';
        }
        ppInitTrack();
        ppSetTrackImages(index);
        ppUpdateDots();
        ppUpdateNavArrows();
        if (photoPreviewCurrent) {
            window.updateAmbientBackground(photoPreviewCurrent.imageUrl);
            window.syncPhotoViewCount(photoPreviewCurrent);
        }
    }
    window.openPhotoPreview = openPhotoPreview;

    function closePhotoPreview() {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) return;
        photoPreviewActive = false;
        photoPreviewClosedAt = Date.now();
        ppResetZoom();
        if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
        ppTrackSnapping = false;
        ppSwipeLock = 0;
        overlay.classList.add('pp-closing');
        document.body.classList.remove('pp-body-noscroll');
        setTimeout(function() {
            overlay.classList.remove('active', 'pp-closing');
            ppImageCache = {};
            ppPreloadCache = {};
            ppDecodeQueue = {};
        }, 350);
    }
    window.closePhotoPreview = closePhotoPreview;

    function deletePhotoFromPreview() {
        if (!photoPreviewCurrent) return;
        var p = photoPreviewCurrent;
        if (!window.currentUser || p.username !== window.currentUser) {
            window.showToast('只能删除自己的照片');
            return;
        }
        var idx = ppPhotoIdx;
        var pwData = window.photoWallData;
        var sorted = ppSortedPhotos;
        var pwIdx = -1;
        for (var j = 0; j < pwData.length; j++) {
            if (pwData[j].id === p.id) { pwIdx = j; break; }
        }
        if (window.sb && p.cloudId) {
            var path = window.extractStoragePath(p.imageUrl);
            var paths = path ? [path] : [];
            if (p.thumbUrl) {
                var thumbPath = window.extractStoragePath(p.thumbUrl);
                if (thumbPath) paths.push(thumbPath);
            }
            if (paths.length > 0) {
                window.sb.storage.from('uploads').remove(paths).then(function(r) {
                    if (r.error) console.error('删除存储失败:', r.error);
                });
            }
            window.sb.from('posts').delete().eq('id', p.cloudId).then(function(r) {
                if (r.error) window.showToast('删除失败: ' + r.error.message);
            });
        }
        window.addDeletedPhotoId(p.id);
        if (pwIdx >= 0) pwData.splice(pwIdx, 1);
        window.saveLocalPhotoWallData();
        window.renderPhotoWallWithoutReload();
        if (pwData.length === 0) {
            closePhotoPreview();
            return;
        }
        if (idx >= pwData.length) idx = pwData.length - 1;
        var sortKeyDel = window.pwSortKey || 'date_desc';
        ppSortedPhotos = pwData.slice();
        if (typeof window.pwApplySort === 'function') {
            ppSortedPhotos = window.pwApplySort(ppSortedPhotos, sortKeyDel);
        } else {
            ppSortedPhotos.sort(function(a, b) { return b.timestamp - a.timestamp; });
        }
        ppPhotoIdx = idx;
        photoPreviewCurrent = ppSortedPhotos[idx] || null;
        if (!photoPreviewCurrent) { closePhotoPreview(); return; }
        document.getElementById('photoPreviewUser').textContent = photoPreviewCurrent.username || '未知用户';
        document.getElementById('photoPreviewTime').textContent = window.formatPhotoTime(photoPreviewCurrent.timestamp);
        document.getElementById('photoPreviewViewsCount').textContent = photoPreviewCurrent.views || 0;
        var delBtn = document.getElementById('ppDeleteBtn');
        if (delBtn) {
            delBtn.style.display = (window.currentUser && photoPreviewCurrent.username === window.currentUser) ? 'flex' : 'none';
        }
        ppSetTrackImages(idx);
        ppUpdateDots();
        ppUpdateNavArrows();
        window.updateAmbientBackground(photoPreviewCurrent.imageUrl);
    }
    window.deletePhotoFromPreview = deletePhotoFromPreview;

    function ppGetPointerPoints() {
        var pts = [];
        ppPointers.forEach(function(v) { pts.push(v); });
        return pts;
    }

    function bindPreviewEvents(overlay) {
        var interactiveElements = overlay.querySelectorAll('.photo-preview-close, .pp-info-btn, .pp-share-btn, .pp-delete-btn, .photo-preview-info, .pp-info-modal, .pp-info-modal-close, .pp-dots, .pp-nav-arrow');
        for (var ie = 0; ie < interactiveElements.length; ie++) {
            interactiveElements[ie].addEventListener('pointerdown', function(ev) {
                ev.stopPropagation();
            });
        }

        overlay.addEventListener('pointerdown', function(e) {
            ppTapHandled = false;
            ppPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (ppPointers.size >= 2) {
                ppMoved = true;
                var pts = ppGetPointerPoints();
                if (pts.length >= 2) {
                    var c0 = pts[0], c1 = pts[1];
                    var d = Math.sqrt(Math.pow(c1.x - c0.x, 2) + Math.pow(c1.y - c0.y, 2));
                    var cx = (c0.x + c1.x) / 2, cy = (c0.y + c1.y) / 2;
                    ppStart = { x: cx, y: cy, zx: ppZoom.tx, zy: ppZoom.ty, scale: ppZoom.scale || 1, pointers: 2 };
                    ppPinchPre = { pts: [c0, c1], d: d, c: { x: cx, y: cy } };
                }
                if (ppTrackSnapping) {
                    ppTrackSnapping = false;
                    if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
                }
                return;
            }

            ppMoved = false;
            if (ppZoom.scale > 1.01) {
                ppStart = { x: e.clientX, y: e.clientY, zx: ppZoom.tx, zy: ppZoom.ty, scale: ppZoom.scale, pointers: 1 };
            } else {
                ppStart = { x: e.clientX, y: e.clientY, pointers: 1 };
                ppVelocitySamples = [];
                ppVelCount = 0;
                ppLastMoveX = e.clientX;
                ppLastMoveT = performance.now();
                if (ppTrackSnapping) {
                    ppTrackSnapping = false;
                    if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
                }
            }
        });

        overlay.addEventListener('pointermove', function(e) {
            if (!ppStart) return;
            ppPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (ppStart.pointers >= 2 || ppPointers.size >= 2) {
                var pts = ppGetPointerPoints();
                if (pts.length < 2) {
                    var dx = e.clientX - ppStart.x;
                    var dy = e.clientY - ppStart.y;
                    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ppMoved = true;
                    ppZoom.tx = ppStart.zx + dx;
                    ppZoom.ty = ppStart.zy + dy;
                    ppApplyPinchTransformImmediate();
                    return;
                }
                var c0 = pts[0], c1 = pts[1];
                var d = Math.sqrt(Math.pow(c1.x - c0.x, 2) + Math.pow(c1.y - c0.y, 2));
                var cx = (c0.x + c1.x) / 2, cy = (c0.y + c1.y) / 2;
                if (!ppPinchPre.pts[0] || ppPinchPre.d === 0) {
                    ppPinchPre = { pts: [c0, c1], d: d, c: { x: cx, y: cy } };
                    return;
                }
                if (ppPinchPre.d === 0 || d === 0) { ppPinchPre = { pts: [c0, c1], d: d, c: { x: cx, y: cy } }; return; }
                var scaleDelta = d / ppPinchPre.d;
                var newScale = Math.max(1, Math.min(6, (ppStart.scale || 1) * scaleDelta));
                var dcx = cx - ppPinchPre.c.x, dcy = cy - ppPinchPre.c.y;
                ppZoom.scale = newScale;
                ppZoom.tx = dcx + ppZoom.tx;
                ppZoom.ty = dcy + ppZoom.ty;
                ppPinchPre = { pts: [c0, c1], d: d, c: { x: cx, y: cy } };
                ppApplyPinchTransformImmediate();
                return;
            }

            if (ppZoom.scale > 1.01) {
                var dx1 = e.clientX - ppStart.x;
                var dy1 = e.clientY - ppStart.y;
                if (Math.abs(dx1) > 3 || Math.abs(dy1) > 3) ppMoved = true;
                ppZoom.tx = ppStart.zx + dx1;
                ppZoom.ty = ppStart.zy + dy1;
                ppApplyPinchTransformImmediate();
            } else {
                var dx2 = e.clientX - ppStart.x;
                if (Math.abs(dx2) > 5) ppMoved = true;
                var now = performance.now();
                ppVelocitySamples[ppVelIdx] = { x: e.clientX, t: now };
                ppVelIdx = (ppVelIdx + 1) % 8;
                if (ppVelCount < 8) ppVelCount++;
                ppLastMoveX = e.clientX;
                ppLastMoveT = now;
                ppTrackDrag = dx2;
                ppApplySlideTrackImmediate();
            }
        });

        overlay.addEventListener('pointerup', function(e) {
            ppPointers.delete(e.pointerId);
            if (ppPointers.size < 2) {
                ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };
            }

            if (!ppStart) {
                if (ppPointers.size === 0 && ppZoom.scale > 1.01 && ppZoom.scale < 1.02) {
                    ppResetZoom();
                }
                return;
            }

            if (ppStart && ppStart.pointers >= 2) {
                ppStart = null;
                if (ppPointers.size === 0 && ppZoom.scale < 1.02) {
                    ppResetZoom();
                }
                return;
            }

            var wasMoved = ppMoved;
            var zoomed = ppZoom.scale > 1.01;

            if (zoomed && !wasMoved) {
                var nowTap = Date.now();
                if (nowTap - ppLastTap < 300 && !ppTapHandled) {
                    ppTapHandled = true;
                    ppResetZoom();
                    ppStart = null;
                    ppLastTap = 0;
                    return;
                }
                ppLastTap = nowTap;
                clearTimeout(ppTapTimer);
                ppTapTimer = setTimeout(function() {
                    if (!ppTapHandled) {
                        ppTapHandled = true;
                    }
                }, 300);
                ppStart = null;
                return;
            }

            if (zoomed) {
                ppStart = null;
                return;
            }

            if (ppTrackSnapping) { ppStart = null; return; }

            var dx = ppTrackDrag;
            var now = performance.now();
            var vx = 0;
            if (ppVelCount >= 2) {
                var lastIdx = (ppVelIdx - 1 + 8) % 8;
                var firstIdx = (ppVelIdx - ppVelCount + 8) % 8;
                var last = ppVelocitySamples[lastIdx];
                var first = ppVelocitySamples[firstIdx];
                if (last && first) {
                    var dt = last.t - first.t;
                    if (dt > 5) vx = (last.x - first.x) / dt;
                }
            }
            var threshold = ppVw * 0.18;
            var absDx = Math.abs(dx);
            var absVx = Math.abs(vx);
            var targetDir = 0;
            if (absDx > threshold || absVx > 0.3) {
                targetDir = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
            }
            ppStart = null;
            ppVelocitySamples = [];

            if (targetDir !== 0) {
                ppNavigatePhoto(targetDir);
                return;
            }

            if (Math.abs(ppTrackDrag) > 2) {
                if (!ppNavBusy) ppSnapTo(0);
            } else {
                ppTrackDrag = 0;
                ppApplySlideTrackImmediate();
            }

            if (!wasMoved && !ppNavBusy) {
                var now2 = Date.now();
                if (now2 - ppLastTap < 300 && !ppTapHandled) {
                    ppTapHandled = true;
                    ppToggleZoom(e.clientX, e.clientY);
                }
                ppLastTap = now2;
                clearTimeout(ppTapTimer);
                ppTapTimer = setTimeout(function() {
                    if (!ppTapHandled && !wasMoved && ppZoom.scale <= 1.01 && !ppNavBusy) {
                        ppTapHandled = true;
                        closePhotoPreview();
                    }
                }, 300);
            }
        });

        overlay.addEventListener('pointerleave', function(e) {
            ppPointers.delete(e.pointerId);
            if (ppPointers.size < 2) {
                ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };
            }
        });

        overlay.addEventListener('pointercancel', function(e) {
            ppPointers.delete(e.pointerId);
            ppStart = null;
            ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };
            ppVelocitySamples = [];
        });

        overlay.addEventListener('gesturestart', function(e) { e.preventDefault(); });
        overlay.addEventListener('gesturechange', function(e) { e.preventDefault(); });
        overlay.addEventListener('gestureend', function(e) { e.preventDefault(); });

        window.addEventListener('resize', function() {
            if (!photoPreviewActive) return;
            ppVw = window.innerWidth;
            ppTrackDrag = 0;
            ppTrackSnapping = false;
            if (ppTrack && ppPhotoIdx >= 0) {
                ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
                ppTrack.style.webkitTransform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
            }
        });
    }

    window.showPhotoInfo = function() {
        var photo = photoPreviewCurrent;
        if (!photo) return;
        var modal = document.getElementById('ppInfoModal');
        var body = document.getElementById('ppInfoModalBody');
        if (!modal || !body) return;
        var d = photo.timestamp ? new Date(photo.timestamp) : null;
        var dateStr = d ? d.toLocaleString() : '未知';
        var sizeStr = photo.fileSize ? (photo.fileSize > 1048576 ? (photo.fileSize / 1048576).toFixed(1) + ' MB' : (photo.fileSize > 1024 ? (photo.fileSize / 1024).toFixed(1) + ' KB' : photo.fileSize + ' B')) : '未知';
        body.innerHTML =
            '<div class="pp-info-row"><span class="pp-info-label">上传者</span><span class="pp-info-value">' + window.escapeHtml(photo.username || '未知用户') + '</span></div>' +
            '<div class="pp-info-row"><span class="pp-info-label">上传时间</span><span class="pp-info-value">' + dateStr + '</span></div>' +
            '<div class="pp-info-row"><span class="pp-info-label">浏览</span><span class="pp-info-value">' + (photo.views || 0) + ' 次</span></div>' +
            (sizeStr !== '未知' ? '<div class="pp-info-row"><span class="pp-info-label">文件大小</span><span class="pp-info-value">' + sizeStr + '</span></div>' : '');
        modal.style.display = 'flex';
    };

    window.closePhotoInfo = function() {
        var modal = document.getElementById('ppInfoModal');
        if (modal) modal.style.display = 'none';
    };

    window.shareCurrentPhoto = function() {
        var photo = photoPreviewCurrent;
        if (!photo || !photo.imageUrl) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(photo.imageUrl).then(function() {
                window.showToast && window.showToast('图片链接已复制到剪贴板');
            }).catch(function() {
                window.showToast && window.showToast('复制失败');
            });
        } else {
            window.showToast && window.showToast(photo.imageUrl);
        }
    };

    window.deleteCurrentPhoto = function() {
        window.deletePhotoFromPreview();
    };
})();
