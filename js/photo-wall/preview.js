(function() {
    var photoPreviewActive = false;
    var photoPreviewCurrent = null;
    var photoPreviewOverlay = null;
    var ppZoom = { scale: 1, tx: 0, ty: 0 };
    var ppSortedPhotos = [];
    var ppPhotoIdx = -1;
    var ppVw = 0;
    var ppVh = 0;
    var ppTrack = null;
    var ppTrackDrag = 0;
    var ppTrackSnapping = false;
    var ppEventsBound = false;
    var ppLastTap = 0;
    var ppTapHandled = false;
    var ppNavBusy = false;
    var ppPointers = new Map();
    var ppPinchStart = null;
    var ppPinchPre = null;
    var ppStart = null;
    var ppTrackRaf = null;
    var ppPinchMinDist = Infinity;
    var ppPinchMaxDist = 0;
    var ppCurrentRotation = 0;

    function ppInitTrack() {
        ppVw = window.innerWidth;
        ppVh = window.innerHeight;
        ppTrack = document.getElementById('ppSlideTrack');
        if (ppTrack) {
            var slots = ppTrack.querySelectorAll('.pp-slide-slot');
            slots.forEach(function(slot) {
                slot.style.width = ppVw + 'px';
                slot.style.height = ppVh + 'px';
            });
            ppTrack.style.width = ppVw * 3 + 'px';
            ppTrack.style.height = ppVh + 'px';
        }
    }

    function ppPreloadAdjacent(idx) {
        var photos = ppSortedPhotos;
        var preloadCount = 3;
        for (var i = -preloadCount; i <= preloadCount; i++) {
            var adjIdx = idx + i;
            if (adjIdx >= 0 && adjIdx < photos.length && photos[adjIdx].imageUrl) {
                ppDecodeImage(photos[adjIdx].imageUrl);
            }
        }
    }

    var ppImageCache = {};
    var ppDecodeQueue = {};

    function ppDecodeImage(url) {
        if (!url) return;
        if (ppImageCache[url]) return ppImageCache[url];
        if (ppDecodeQueue[url]) return ppDecodeQueue[url];
        
        var promise = new Promise(function(resolve) {
            var img = new Image();
            img.onload = function() {
                ppImageCache[url] = img;
                delete ppDecodeQueue[url];
                resolve(img);
            };
            img.onerror = function() {
                delete ppDecodeQueue[url];
                resolve(null);
            };
            img.src = url;
        });
        ppDecodeQueue[url] = promise;
        return promise;
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

    function ppUpdateInfo(idx) {
        var photos = ppSortedPhotos;
        if (!photos[idx]) return;
        var photo = photos[idx];
        var userEl = document.getElementById('photoPreviewUser');
        var timeEl = document.getElementById('photoPreviewTime');
        var viewsEl = document.getElementById('photoPreviewViewsCount');
        
        if (userEl) userEl.textContent = photo.user_name || '未知用户';
        if (timeEl) {
            var date = new Date(photo.created_at);
            timeEl.textContent = date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
        if (viewsEl) viewsEl.textContent = photo.views || '0';
        
        var deleteBtn = document.getElementById('ppDeleteBtn');
        if (deleteBtn) {
            deleteBtn.style.display = (window.currentUser === photo.user_name) ? 'block' : 'none';
        }
    }

    function ppUpdateDots(idx) {
        var photos = ppSortedPhotos;
        var dotsEl = document.getElementById('ppDots');
        if (!dotsEl || photos.length <= 1) {
            if (dotsEl) dotsEl.style.display = 'none';
            return;
        }
        dotsEl.style.display = 'flex';
        var dots = '';
        for (var i = 0; i < photos.length; i++) {
            dots += '<span class="pp-dot' + (i === idx ? ' active' : '') + '" data-index="' + i + '"></span>';
        }
        dotsEl.innerHTML = dots;
    }

    function ppResetZoom() {
        ppZoom = { scale: 1, tx: 0, ty: 0 };
        ppPinchStart = null;
        ppPinchPre = null;
        ppCurrentRotation = 0;
        var imgs = document.querySelectorAll('.pp-slide-img');
        imgs.forEach(function(img) {
            img.style.transform = '';
            img.style.webkitTransform = '';
        });
    }

    function ppToggleZoom() {
        var curImg = document.getElementById('photoPreviewImage');
        if (!curImg) return;
        
        if (ppZoom.scale > 1.01) {
            ppResetZoom();
            curImg.classList.remove('zoomed');
        } else {
            var rect = curImg.getBoundingClientRect();
            var centerX = rect.left + rect.width / 2;
            var centerY = rect.top + rect.height / 2;
            var ratio = 2;
            ppZoom.scale = ratio;
            ppZoom.tx = (window.innerWidth / 2 - centerX) * (1 - ratio);
            ppZoom.ty = (window.innerHeight / 2 - centerY) * (1 - ratio);
            
            var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
            curImg.style.transform = t;
            curImg.style.webkitTransform = t;
            curImg.classList.add('zoomed');
        }
    }

    function ppSnapTo(targetOffset) {
        if (!ppTrack) return;
        ppTrackSnapping = true;
        var onSnapEnd = function() {
            ppTrack.removeEventListener('transitionend', onSnapEnd);
            ppTrack.classList.remove('snapping');
            ppTrackSnapping = false;
            
            var idx = ppPhotoIdx;
            var photos = ppSortedPhotos;
            
            var prevImg = document.getElementById('ppPrevImg');
            var curImg = document.getElementById('photoPreviewImage');
            var nextImg = document.getElementById('ppNextImg');
            
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
            
            setTimeout(function() {
                ppPreloadAdjacent(idx);
            }, 500);
        };
        
        var absDiff = Math.abs(ppTrackDrag - targetOffset);
        var duration = Math.min(Math.max(absDiff * 0.5, 150), 400);
        ppTrack.classList.add('snapping');
        ppTrack.style.transition = 'transform ' + duration + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        ppTrack.style.webkitTransition = '-webkit-transform ' + duration + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        ppTrack.addEventListener('transitionend', onSnapEnd);
        
        var finalOffset = -ppVw + targetOffset;
        ppTrack.style.transform = 'translate3d(' + finalOffset + 'px, 0, 0)';
        ppTrack.style.webkitTransform = 'translate3d(' + finalOffset + 'px, 0, 0)';
    }

    function ppNavigatePhoto(direction) {
        if (ppNavBusy) return;
        ppNavBusy = true;
        
        var photos = ppSortedPhotos;
        var newIdx = ppPhotoIdx + direction;
        
        if (newIdx < 0 || newIdx >= photos.length) {
            if (Math.abs(ppTrackDrag) > 2) ppSnapTo(0);
            ppNavBusy = false;
            return;
        }
        
        ppPhotoIdx = newIdx;
        ppResetZoom();
        ppUpdateInfo(newIdx);
        ppUpdateDots(newIdx);
        photoPreviewCurrent = photos[newIdx];
        
        ppSnapTo(0);
        
        setTimeout(function() {
            ppNavBusy = false;
        }, 500);
    }

    window.ppPrevPhoto = function() {
        ppNavigatePhoto(-1);
    };

    window.ppNextPhoto = function() {
        ppNavigatePhoto(1);
    };

    function openPhotoPreview(index, keepList) {
        if (photoPreviewActive) return;
        
        if (!keepList) {
            ppSortedPhotos = window.photoWallData ? window.photoWallData.slice() : [];
        }
        if (!ppSortedPhotos || ppSortedPhotos.length === 0) {
            window.showToast('暂无照片');
            return;
        }
        
        if (index < 0) index = 0;
        if (index >= ppSortedPhotos.length) index = ppSortedPhotos.length - 1;
        
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) {
            var container = document.createElement('div');
            container.className = 'photo-preview-overlay';
            container.id = 'photoPreviewOverlay';
            container.innerHTML = 
                '<div class="pp-ambient-bg" id="ppAmbientBg"></div>' +
                '<div class="pp-dots" id="ppDots"></div>' +
                '<button class="photo-preview-close" onclick="closePhotoPreview()">&times;</button>' +
                '<button class="pp-nav-arrow pp-nav-prev" id="ppPrevBtn" onclick="window.ppPrevPhoto()" aria-label="上一张">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
                '<button class="pp-nav-arrow pp-nav-next" id="ppNextBtn" onclick="window.ppNextPhoto()" aria-label="下一张">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
                '<div class="photo-preview-image-wrapper" id="ppImageWrapper">' +
                '<div id="ppSlideTrack" class="pp-slide-track">' +
                '<div class="pp-slide-slot pp-prev-slot"><img id="ppPrevImg" class="pp-slide-img" alt="prev"></div>' +
                '<div class="pp-slide-slot pp-cur-slot"><img id="photoPreviewImage" class="pp-slide-img" alt="current"></div>' +
                '<div class="pp-slide-slot pp-next-slot"><img id="ppNextImg" class="pp-slide-img" alt="next"></div>' +
                '</div>' +
                '</div>' +
                '<button class="pp-info-btn" id="ppInfoBtn" title="照片信息" onclick="showPhotoInfo()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>' +
                '<button class="pp-share-btn" id="ppShareBtn" title="分享" onclick="window.shareCurrentPhoto()">&#x1F517;</button>' +
                '<button class="pp-rotate-btn" id="ppRotateBtn" title="旋转90°" onclick="window.ppRotatePhoto()">&#x27F3;</button>' +
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
        ppPhotoIdx = index;
        
        ppInitTrack();
        if (ppTrack) {
            ppTrack.style.transition = 'none';
            ppTrack.style.webkitTransition = 'none';
            ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
            ppTrack.style.webkitTransform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        }
        
        overlay.classList.add('active');
        document.body.classList.add('pp-body-noscroll');
        
        setTimeout(function() {
            ppSetTrackImages(index);
            ppUpdateInfo(index);
            ppUpdateDots(index);
        }, 50);
    }

    window.openPhotoPreview = openPhotoPreview;

    function closePhotoPreview() {
        if (!photoPreviewActive) return;
        photoPreviewActive = false;
        var overlay = document.getElementById('photoPreviewOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.classList.add('pp-closing');
        }
        document.body.classList.remove('pp-body-noscroll');
        ppResetZoom();
        
        setTimeout(function() {
            if (overlay) {
                overlay.classList.remove('pp-closing');
            }
        }, 300);
    }

    window.closePhotoPreview = closePhotoPreview;

    function showPhotoInfo() {
        var photo = photoPreviewCurrent;
        if (!photo) return;
        var modal = document.getElementById('ppInfoModal');
        if (!modal) {
            var modalEl = document.createElement('div');
            modalEl.className = 'pp-info-modal';
            modalEl.id = 'ppInfoModal';
            modalEl.innerHTML = 
                '<div class="pp-info-modal-content">' +
                '<div class="pp-info-modal-header">' +
                '<span class="pp-info-modal-title">照片详情</span>' +
                '<button class="pp-info-modal-close" onclick="closePhotoInfo()">×</button>' +
                '</div>' +
                '<div class="pp-info-modal-body" id="ppInfoModalBody"></div>' +
                '</div>';
            document.body.appendChild(modalEl);
            modal = modalEl;
        }
        
        var sizeStr = '未知';
        if (photo.content) {
            try {
                var content = JSON.parse(photo.content);
                if (content.fileSize) {
                    var size = content.fileSize;
                    if (size >= 1024 * 1024) {
                        sizeStr = (size / (1024 * 1024)).toFixed(2) + ' MB';
                    } else if (size >= 1024) {
                        sizeStr = (size / 1024).toFixed(1) + ' KB';
                    } else {
                        sizeStr = size + ' B';
                    }
                }
            } catch (e) {}
        }
        
        var dateStr = '未知';
        if (photo.created_at) {
            dateStr = new Date(photo.created_at).toLocaleString('zh-CN');
        }
        
        document.getElementById('ppInfoModalBody').innerHTML = 
            '<div class="pp-info-row"><span class="pp-info-label">上传者</span><span class="pp-info-value">' + (photo.user_name || '未知') + '</span></div>' +
            '<div class="pp-info-row"><span class="pp-info-label">上传时间</span><span class="pp-info-value">' + dateStr + '</span></div>' +
            '<div class="pp-info-row"><span class="pp-info-label">浏览</span><span class="pp-info-value">' + (photo.views || 0) + ' 次</span></div>' +
            (sizeStr !== '未知' ? '<div class="pp-info-row"><span class="pp-info-label">文件大小</span><span class="pp-info-value">' + sizeStr + '</span></div>' : '');
        modal.style.display = 'flex';
    }

    window.showPhotoInfo = showPhotoInfo;

    window.closePhotoInfo = function() {
        var modal = document.getElementById('ppInfoModal');
        if (modal) modal.style.display = 'none';
    };

    window.shareCurrentPhoto = function() {
        var photo = photoPreviewCurrent;
        if (!photo || !photo.imageUrl) return;
        var btn = document.getElementById('ppShareBtn');
        if (!btn) return;
        if (btn._copying) return;

        btn._copying = true;
        btn._origHTML = btn.innerHTML;
        btn.textContent = '✓';
        btn.classList.add('copied');

        function restoreBtn() {
            if (!btn) return;
            btn.innerHTML = btn._origHTML || '🔗';
            btn.classList.remove('copied');
            btn.style.transform = '';
            btn._copying = false;
        }

        function copySuccess() {
            window.showToast('照片链接已复制');
            setTimeout(restoreBtn, 1500);
        }

        function copyFail() {
            window.showToast('复制失败，请手动复制');
            setTimeout(restoreBtn, 1500);
        }

        try {
            if (document.execCommand && document.execCommand('copy')) {
                var ta = document.createElement('textarea');
                ta.value = photo.imageUrl;
                document.body.appendChild(ta);
                ta.select();
                var success = document.execCommand('copy');
                document.body.removeChild(ta);
                if (success) {
                    copySuccess();
                    return;
                }
            }
        } catch (e) {}

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(photo.imageUrl).then(copySuccess).catch(copyFail);
            return;
        }

        var ta2 = document.createElement('textarea');
        ta2.value = photo.imageUrl;
        document.body.appendChild(ta2);
        ta2.select();
        document.body.removeChild(ta2);
        copyFail();
    };

    window.deleteCurrentPhoto = function() {
        window.deletePhotoFromPreview();
    };

    window.ppRotatePhoto = function() {
        var imgs = document.querySelectorAll('.pp-slide-img');
        ppCurrentRotation = (ppCurrentRotation + 90) % 360;
        var rotateStyle = 'rotate(' + ppCurrentRotation + 'deg)';
        imgs.forEach(function(img) {
            img.style.transform = rotateStyle;
            img.style.webkitTransform = rotateStyle;
        });
    };

    function bindPreviewEvents(overlay) {
        var wrapper = overlay.querySelector('.photo-preview-image-wrapper');
        
        var startX, startY, startTime;
        var wasMoved = false;
        
        overlay.addEventListener('pointerdown', function(e) {
            if (e.target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn, .pp-info-modal')) {
                return;
            }
            
            startTime = Date.now();
            startX = e.clientX;
            startY = e.clientY;
            wasMoved = false;
            
            var pointerId = e.pointerId;
            var point = { x: e.clientX, y: e.clientY };
            ppPointers.set(pointerId, point);
            
            if (ppPointers.size === 2) {
                var pts = Array.from(ppPointers.values());
                var dx = pts[1].x - pts[0].x;
                var dy = pts[1].y - pts[0].y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                
                var vw2 = window.innerWidth / 2;
                var vh2 = window.innerHeight / 2;
                var cx = (pts[0].x + pts[1].x) / 2;
                var cy = (pts[0].y + pts[1].y) / 2;
                
                var s = ppZoom.scale || 1;
                ppPinchStart = {
                    dist: dist,
                    scale: s,
                    ax: (cx - vw2) / s - ppZoom.tx,
                    ay: (cy - vh2) / s - ppZoom.ty
                };
                ppPinchPre = ppPinchStart;
                ppPinchMinDist = dist;
                ppPinchMaxDist = dist;
                ppStart = { x: cx, y: cy, zx: ppZoom.tx, zy: ppZoom.ty, pointers: 2 };
            } else {
                if (ppTrackSnapping) {
                    ppTrackSnapping = false;
                    ppTrack.style.transition = 'none';
                    ppTrack.style.webkitTransition = 'none';
                }
                if (ppZoom.scale > 1.01) {
                    ppStart = { x: e.clientX, y: e.clientY, zx: ppZoom.tx, zy: ppZoom.ty, pointers: 1 };
                }
            }
        });
        
        overlay.addEventListener('pointermove', function(e) {
            if (ppPointers.size === 0) return;
            
            wasMoved = true;
            var pointerId = e.pointerId;
            ppPointers.set(pointerId, { x: e.clientX, y: e.clientY });
            
            if (ppPointers.size === 2) {
                var pts = Array.from(ppPointers.values());
                var dx = pts[1].x - pts[0].x;
                var dy = pts[1].y - pts[0].y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                
                ppPinchMinDist = Math.min(ppPinchMinDist, dist);
                ppPinchMaxDist = Math.max(ppPinchMaxDist, dist);
                
                var vw2 = window.innerWidth / 2;
                var vh2 = window.innerHeight / 2;
                var cx = (pts[0].x + pts[1].x) / 2;
                var cy = (pts[0].y + pts[1].y) / 2;
                
                ppPinchPre = { dist: dist, cx: cx, cy: cy };
                
                var ratio = dist / ppPinchStart.dist;
                var newScale = Math.max(1, Math.min(8, ppPinchStart.scale * ratio));
                
                ppZoom.scale = newScale;
                ppZoom.tx = cx - vw2 - ppPinchStart.ax * newScale;
                ppZoom.ty = cy - vh2 - ppPinchStart.ay * newScale;
                
                var curImg = document.getElementById('photoPreviewImage');
                if (curImg) {
                    var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
                    curImg.style.transform = t;
                    curImg.style.webkitTransform = t;
                    curImg.classList.add('zoomed');
                }
            } else if (ppPointers.size === 1 && ppStart && ppStart.pointers === 1) {
                var dx = e.clientX - ppStart.x;
                var dy = e.clientY - ppStart.y;
                ppZoom.tx = ppStart.zx + dx;
                ppZoom.ty = ppStart.zy + dy;
                
                var curImg = document.getElementById('photoPreviewImage');
                if (curImg) {
                    var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
                    curImg.style.transform = t;
                    curImg.style.webkitTransform = t;
                }
            } else {
                if (ppTrackSnapping) return;
                var dx = e.clientX - startX;
                ppTrackDrag = dx;
                
                var isZoomed = ppZoom.scale > 1.01;
                if (!isZoomed) {
                    var offset = -ppVw + ppTrackDrag;
                    var resistance = 1;
                    if (ppPhotoIdx === 0 && dx > 0) resistance = 1 + dx / ppVw * 2;
                    if (ppPhotoIdx === ppSortedPhotos.length - 1 && dx < 0) resistance = 1 - dx / ppVw * 2;
                    offset = -ppVw + dx / resistance;
                    
                    if (ppTrackRaf) cancelAnimationFrame(ppTrackRaf);
                    ppTrackRaf = requestAnimationFrame(function() {
                        ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
                        ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';
                        ppTrackRaf = null;
                    });
                }
            }
        });
        
        overlay.addEventListener('pointerup', function(e) {
            var pointerId = e.pointerId;
            ppPointers.delete(pointerId);
            
            if (ppPointers.size === 0) {
                var now = Date.now();
                var now2 = Date.now();
                
                if (ppPinchStart) {
                    var distDiff = ppPinchMaxDist - ppPinchMinDist;
                    if (distDiff < 10) {
                        ppZoom = { scale: 1, tx: 0, ty: 0 };
                        var imgs = document.querySelectorAll('.pp-slide-img');
                        imgs.forEach(function(img) {
                            img.style.transform = '';
                            img.style.webkitTransform = '';
                        });
                    }
                    ppPinchStart = null;
                    ppPinchPre = null;
                }
                
                var zoomed = ppZoom.scale > 1.01;
                
                if (!zoomed && !wasMoved) {
                    if (ppTrackSnapping) { ppStart = null; return; }
                    
                    var dx = ppTrackDrag;
                    
                    if (Math.abs(dx) > ppVw / 4) {
                        var direction = dx > 0 ? -1 : 1;
                        if (direction === -1 && ppPhotoIdx > 0) {
                            ppNavigatePhoto(-1);
                        } else if (direction === 1 && ppPhotoIdx < ppSortedPhotos.length - 1) {
                            ppNavigatePhoto(1);
                        } else {
                            ppSnapTo(0);
                        }
                    } else {
                        if (Math.abs(ppTrackDrag) > 2) {
                            ppSnapTo(0);
                        }
                    }
                    ppTrackDrag = 0;
                }
                
                if (now2 - ppLastTap < 300 && !ppTapHandled && ppZoom.scale <= 1.01) {
                    ppToggleZoom();
                    ppTapHandled = true;
                    setTimeout(function() { ppTapHandled = false; }, 300);
                }
                ppLastTap = now2;
                
                if (!ppTapHandled && !wasMoved && ppZoom.scale <= 1.01 && !ppNavBusy) {
                    closePhotoPreview();
                }
                
                ppStart = null;
            }
        });
        
        overlay.addEventListener('pointercancel', function(e) {
            ppPointers.clear();
            ppPinchStart = null;
            ppPinchPre = null;
            ppStart = null;
            
            if (!ppZoom.scale > 1.01) {
                ppSnapTo(0);
            }
        });
    }
})();