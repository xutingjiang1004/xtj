(function() {
    var ppZoom = { scale: 1, tx: 0, ty: 0 };
    var ppPointers = new Map();
    var ppStart = null;
    var ppLastTap = 0;
    var ppTapTimer = null;
    var ppMoved = false;
    var ppPhotoIdx = -1;
    var ppSwipeLock = 0;
    var ppSortedPhotos = [];
    window.ppSortedPhotos = ppSortedPhotos;
    var ppTrack = null;
    var ppTrackDrag = 0;
    var ppTrackSnapping = false;
    var ppVw = 0;
    var ppVelocitySamples = [];
    var ppLastMoveX = 0;
    var ppLastMoveT = 0;
    var ppRafId = null;
    var ppPreloadCache = {};
    var ppImageCache = {};
    var ppPreloadQueue = [];
    var ppGyroTargetX = 0;
    var ppGyroTargetY = 0;
    var ppGyroCurrentX = 0;
    var ppGyroCurrentY = 0;
    var ppGyroRafId = null;
    var ppGyroActive = false;
    var ppGyroPermGranted = false;
    var ppDeviceOrientationHandler = null;
    var ppTapHandled = false;
    var ppTrackRaf = null;
    var ppTransformRaf = null;
    var ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };
    var ppGyroMaxOffset = 15;
    var ppGyroLerpSpeed = 0.1;
    var ppSpringTension = 180;
    var ppSpringFriction = 18;
    var ppRefreshRate = 60;
    var ppFrameBudget = 16;
    var photoPreviewActive = false;
    var photoPreviewClosedAt = 0;
    var photoPreviewCurrent = null;
    window.photoPreviewCurrent = photoPreviewCurrent;

    function detectRefreshRate() {
        var times = [];
        var lastTime = performance.now();
        var frames = 0;
        function sample() {
            frames++;
            var now = performance.now();
            if (frames >= 30) {
                var elapsed = now - lastTime;
                ppRefreshRate = Math.round(frames / elapsed * 1000);
                ppFrameBudget = 1000 / ppRefreshRate;
                return;
            }
            times.push(now);
            requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
    }
    detectRefreshRate();

    function ppInitTrack() {
        ppTrack = document.getElementById('ppSlideTrack');
        ppVw = window.innerWidth;
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
            var curUrl = photos[idx].imageUrl;
            if (ppImageCache[curUrl] && ppImageCache[curUrl] !== 'loading') {
                curImg.src = curUrl;
            } else {
                curImg.src = curUrl;
                ppPreloadImage(curUrl);
            }
        }
        setTimeout(function() {
            if (idx > 0 && photos[idx - 1]) {
                var prevUrl = photos[idx - 1].imageUrl;
                prevImg.src = prevUrl;
                ppPreloadImage(prevUrl);
            } else {
                prevImg.removeAttribute('src');
            }
            if (idx < photos.length - 1 && photos[idx + 1]) {
                var nextUrl = photos[idx + 1].imageUrl;
                nextImg.src = nextUrl;
                ppPreloadImage(nextUrl);
            } else {
                nextImg.removeAttribute('src');
            }
        }, 50);
        ppTrackDrag = 0;
        ppTrackSnapping = false;
        ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        ppTrack.style.webkitTransform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        if (photos[idx]) window.updateAmbientBackground(photos[idx].imageUrl);
    }

    function ppPreloadImage(url) {
        if (!url || ppImageCache[url]) return Promise.resolve();
        return new Promise(function(resolve) {
            ppImageCache[url] = 'loading';
            var pre = new Image();
            pre.onload = function() {
                ppImageCache[url] = pre;
                resolve();
            };
            pre.onerror = function() {
                ppImageCache[url] = null;
                resolve();
            };
            pre.src = url;
        });
    }

    function ppPreloadAdjacent(idx) {
        var photos = ppSortedPhotos;
        var urls = [];
        for (var d = -3; d <= 3; d++) {
            var i = idx + d;
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
        if (!ppTrackRaf) {
            ppTrackRaf = requestAnimationFrame(function() {
                var offset = -ppVw + ppTrackDrag;
                ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
                ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';
                ppTrackRaf = null;
            });
        }
    }

    function ppApplyImageTransform() {
        var img = document.getElementById('photoPreviewImage');
        if (!img) return;
        var isZoomed = ppZoom.scale > 1.01;
        if (isZoomed !== img.classList.contains('zoomed')) {
            img.classList.toggle('zoomed', isZoomed);
        }
        if (!ppTransformRaf) {
            ppTransformRaf = requestAnimationFrame(function() {
                var tx = ppZoom.tx + ppGyroCurrentX;
                var ty = ppZoom.ty + ppGyroCurrentY;
                var t = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + ppZoom.scale + ')';
                img.style.transform = t;
                img.style.webkitTransform = t;
                ppTransformRaf = null;
            });
        }
    }

    function ppGyroOnOrientation(e) {
        var beta = e.beta;
        var gamma = e.gamma;
        if (beta === null || gamma === null) {
            ppGyroTargetX = 0;
            ppGyroTargetY = 0;
            return;
        }
        ppGyroTargetX = Math.max(-ppGyroMaxOffset, Math.min(ppGyroMaxOffset, gamma * 0.25));
        ppGyroTargetY = Math.max(-ppGyroMaxOffset, Math.min(ppGyroMaxOffset, beta * -0.15));
    }

    function ppStartGyro() {
        if (ppGyroActive) return;
        ppGyroActive = true;
        ppGyroTargetX = 0;
        ppGyroTargetY = 0;
        ppGyroCurrentX = 0;
        ppGyroCurrentY = 0;
        ppDeviceOrientationHandler = ppGyroOnOrientation;
        window.addEventListener('deviceorientation', ppDeviceOrientationHandler);
        ppGyroRafId = requestAnimationFrame(ppGyroRenderLoop);
    }

    function ppStopGyro() {
        ppGyroActive = false;
        ppGyroTargetX = 0;
        ppGyroTargetY = 0;
        if (ppGyroRafId) {
            cancelAnimationFrame(ppGyroRafId);
            ppGyroRafId = null;
        }
        if (ppDeviceOrientationHandler) {
            window.removeEventListener('deviceorientation', ppDeviceOrientationHandler);
            ppDeviceOrientationHandler = null;
        }
        ppGyroCurrentX = 0;
        ppGyroCurrentY = 0;
        var img = document.getElementById('photoPreviewImage');
        if (img) {
            img.style.transform = '';
            img.style.webkitTransform = '';
        }
        var info = document.querySelector('.photo-preview-info');
        if (info) info.style.transform = '';
    }

    function ppGyroRenderLoop() {
        if (!ppGyroActive) return;
        ppGyroCurrentX += (ppGyroTargetX - ppGyroCurrentX) * ppGyroLerpSpeed;
        ppGyroCurrentY += (ppGyroTargetY - ppGyroCurrentY) * ppGyroLerpSpeed;
        ppApplyImageTransform();
        var info = document.querySelector('.photo-preview-info');
        if (info) {
            var invX = -ppGyroCurrentX * 0.35;
            var invY = -ppGyroCurrentY * 0.35;
            info.style.transform = 'translate3d(' + invX + 'px,' + invY + 'px,0)';
        }
        ppGyroRafId = requestAnimationFrame(ppGyroRenderLoop);
    }

    function ppRequestGyroPermission(triggerEl) {
        if (ppGyroPermGranted) {
            ppStartGyro();
            return;
        }
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(function(state) {
                if (state === 'granted') {
                    ppGyroPermGranted = true;
                    ppStartGyro();
                }
            }).catch(function() {});
        } else {
            ppStartGyro();
        }
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
        var position = ppTrackDrag;
        var velocity = 0;
        var tension = ppSpringTension;
        var friction = ppSpringFriction;
        ppTrackSnapping = true;
        function ppSpringStep() {
            if (!ppTrackSnapping) {
                ppSwipeLock = 0;
                ppRafId = null;
                return;
            }
            var displacement = targetOffset - position;
            var springForce = tension * displacement;
            var dampingForce = friction * velocity;
            var acceleration = springForce - dampingForce;
            velocity += acceleration * (ppFrameBudget / 1000);
            position += velocity * (ppFrameBudget / 1000);
            ppTrackDrag = position;
            var offset = -ppVw + position;
            ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
            ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';
            if (Math.abs(displacement) < 0.5 && Math.abs(velocity) < 0.5) {
                ppTrackDrag = targetOffset;
                var finalOffset = -ppVw + targetOffset;
                ppTrack.style.transform = 'translate3d(' + finalOffset + 'px, 0, 0)';
                ppTrack.style.webkitTransform = 'translate3d(' + finalOffset + 'px, 0, 0)';
                ppTrackSnapping = false;
                ppRafId = null;
                if (callback) callback();
                return;
            }
            ppRafId = requestAnimationFrame(ppSpringStep);
        }
        ppRafId = requestAnimationFrame(ppSpringStep);
    }

    function ppNavigatePhoto(direction) {
        if (ppSwipeLock) return;
        var newIdx = ppPhotoIdx + direction;
        if (newIdx < 0 || newIdx >= ppSortedPhotos.length) {
            ppSnapTo(0);
            return;
        }
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
            ppSwipeLock = 0;
            ppUpdateDots();
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
        ppSortedPhotos = window.photoWallData.slice().sort(function(a, b) { return b.timestamp - a.timestamp; });
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) {
            var container = document.createElement('div');
            container.id = 'photoPreviewOverlay';
            container.className = 'photo-preview-overlay';
            container.innerHTML = '<div id="ppAmbientBg" class="pp-ambient-bg"></div>' +
                '<button id="ppCloseBtn" class="pp-close-btn" onclick="window.closePhotoPreview()">✕</button>' +
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
            bindPreviewEvents(overlay);
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
        if (photoPreviewCurrent) {
            window.updateAmbientBackground(photoPreviewCurrent.imageUrl);
            window.syncPhotoViewCount(photoPreviewCurrent);
        }
        ppRequestGyroPermission();
    }
    window.openPhotoPreview = openPhotoPreview;

    function closePhotoPreview() {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) return;
        photoPreviewActive = false;
        photoPreviewClosedAt = Date.now();
        ppStopGyro();
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
        ppSortedPhotos = pwData.slice().sort(function(a, b) { return b.timestamp - a.timestamp; });
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
        window.updateAmbientBackground(photoPreviewCurrent.imageUrl);
    }
    window.deletePhotoFromPreview = deletePhotoFromPreview;

    function bindPreviewEvents(overlay) {
        overlay.addEventListener('pointerdown', function(e) {
            ppMoved = false;
            ppTapHandled = false;
            if (ppZoom.scale > 1.01) {
                ppStart = { x: e.clientX, y: e.clientY, zx: ppZoom.tx, zy: ppZoom.ty, scale: ppZoom.scale, pointers: 1 };
                ppPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (ppPointers.size >= 2) {
                    ppStart = null;
                }
            } else {
                ppStart = { x: e.clientX, y: e.clientY };
                ppSwipeLock = 0;
                ppVelocitySamples = [];
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
            if (ppZoom.scale > 1.01) {
                ppPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (ppPointers.size >= 2) {
                    var pts = [];
                    ppPointers.forEach(function(v) { pts.push(v); });
                    if (pts.length < 2) return;
                    var c0 = pts[0], c1 = pts[1];
                    var dx = c1.x - c0.x, dy = c1.y - c0.y;
                    var d = Math.sqrt(dx * dx + dy * dy);
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
                    ppZoom.tx = dcx + (ppZoom.scale > 1 ? ppZoom.tx : 0);
                    ppZoom.ty = dcy + (ppZoom.scale > 1 ? ppZoom.ty : 0);
                    ppApplyImageTransform();
                    return;
                }
                var dx = e.clientX - ppStart.x;
                var dy = e.clientY - ppStart.y;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ppMoved = true;
                ppZoom.tx = ppStart.zx + dx;
                ppZoom.ty = ppStart.zy + dy;
                ppApplyImageTransform();
            } else {
                var dx2 = e.clientX - ppStart.x;
                if (Math.abs(dx2) > 5) ppMoved = true;
                var now = performance.now();
                ppVelocitySamples.push({ x: e.clientX, t: now });
                if (ppVelocitySamples.length > 8) ppVelocitySamples.shift();
                ppLastMoveX = e.clientX;
                ppLastMoveT = now;
                ppTrackDrag = dx2;
                ppApplySlideTrack();
            }
        });

        overlay.addEventListener('pointerup', function(e) {
            ppPointers.delete(e.pointerId);
            if (ppPointers.size < 2) {
                ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };
            }
            if (!ppStart) return;
            if (ppZoom.scale > 1.01) {
                ppStart = null;
                if (ppPointers.size === 0) {
                    if (ppZoom.scale < 1.02) ppResetZoom();
                }
                return;
            }
            if (ppTrackSnapping) { ppStart = null; return; }
            var dx = ppTrackDrag;
            var now = performance.now();
            var vx = 0;
            if (ppVelocitySamples.length >= 2) {
                var last = ppVelocitySamples[ppVelocitySamples.length - 1];
                var first = ppVelocitySamples[0];
                var dt = last.t - first.t;
                if (dt > 0) vx = (last.x - first.x) / dt;
            }
            var threshold = ppVw * 0.25;
            var absDx = Math.abs(dx);
            var absVx = Math.abs(vx);
            var targetDir = 0;
            if (absDx > threshold || absVx > 0.5) {
                targetDir = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
            }
            ppStart = null;
            ppVelocitySamples = [];
            if (targetDir !== 0) {
                var oldDir = targetDir;
                ppNavigatePhoto(targetDir);
                if (oldDir !== targetDir) ppSnapTo(0);
            } else {
                ppSnapTo(0);
            }
            if (!ppMoved) {
                var now2 = Date.now();
                if (now2 - ppLastTap < 300 && !ppTapHandled) {
                    ppTapHandled = true;
                    ppToggleZoom(e.clientX, e.clientY);
                }
                ppLastTap = now2;
                clearTimeout(ppTapTimer);
                ppTapTimer = setTimeout(function() {
                    if (!ppTapHandled && !ppMoved) {
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
            ppStart = null;
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
})();
