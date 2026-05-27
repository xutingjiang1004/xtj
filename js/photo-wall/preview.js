
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
    var ppTapThreshold = 15;
    var ppMovedDistance = 0;
    var ppCloseTimer = null;
    var ppDismissState = {
        isActive: false,
        dy: 0,
        scale: 1,
        opacity: 1
    };
    var ppLongPressTimer = null;
    var ppDownloadActive = false;
    var ppDownloadProgress = 0;
    var ppConfirmDownloadModal = null;
    var ppDownloadAbortController = null;

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
        var preloadCount = 1;
        for (var i = -preloadCount; i <= preloadCount; i++) {
            var adjIdx = idx + i;
            if (adjIdx >= 0 && adjIdx < photos.length && photos[adjIdx].imageUrl) {
                ppDecodeImage(photos[adjIdx].imageUrl);
            }
        }
    }

    function ppEnsureSideImages(idx) {
        var photos = ppSortedPhotos;
        if (!ppTrack) return;
        var prevImg = document.getElementById('ppPrevImg');
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
    }

    var ppImageCache = {};
    var ppDecodeQueue = {};
    var ppLoadRetries = {};
    var MAX_RETRIES = 3;

    function ppDecodeImage(url) {
        if (!url) return Promise.resolve();
        if (ppImageCache[url]) return Promise.resolve();
        if (ppDecodeQueue[url]) return ppDecodeQueue[url];

        var promise = new Promise(function(resolve) {
            var img = new Image();
            img.src = url;

            if ('decode' in img) {
                img.decode().then(function() {
                    ppImageCache[url] = img;
                    delete ppDecodeQueue[url];
                    delete ppLoadRetries[url];
                    resolve();
                }).catch(function() {
                    tryToLoad();
                });
            } else {
                tryToLoad();
            }

            function tryToLoad() {
                if (img.complete) {
                    ppImageCache[url] = img;
                    delete ppDecodeQueue[url];
                    delete ppLoadRetries[url];
                    resolve();
                } else {
                    img.onload = img.onerror = function() {
                        ppImageCache[url] = img;
                        delete ppDecodeQueue[url];
                        delete ppLoadRetries[url];
                        resolve();
                    };
                }
            }
        });

        ppDecodeQueue[url] = promise;
        return promise;
    }

    function ppSwapImage(imgEl, url) {
        if (!imgEl) return;

        // 鍏堝畬鍏ㄦ竻鐞嗘棫鐨勭洃鍚櫒
        imgEl.onload = null;
        imgEl.onerror = null;

        if (!url) {
            imgEl.style.transition = 'none';
            imgEl.removeAttribute('src');
            imgEl.style.opacity = '0';
            imgEl._ppUrl = null;
            return;
        }

        if (imgEl._ppUrl === url) return;
        imgEl._ppUrl = url;
        var cached = ppImageCache[url];
        if (cached && cached.naturalWidth > 0) {
            imgEl.style.transition = 'none';
            imgEl.src = url;
            imgEl.style.opacity = '1';
            return;
        }

        imgEl.style.transition = 'none';
        imgEl.removeAttribute('src');
        imgEl.style.opacity = '0';

        var loadDone = false;
        var retryCount = 0;
        var loadHandler = function() {
            if (loadDone) return;
            loadDone = true;
            imgEl.onload = null;
            imgEl.onerror = null;

            if (!ppImageCache[url]) {
                ppImageCache[url] = imgEl;
            }
            delete ppLoadRetries[url];
            requestAnimationFrame(function() {
                imgEl.style.transition = 'opacity 0.2s ease-in-out';
                void imgEl.offsetHeight;
                imgEl.style.opacity = '1';
            });
        };

        var errorHandler = function() {
            if (loadDone) return;

            imgEl.onload = null;
            imgEl.onerror = null;

            retryCount = (ppLoadRetries[url] || 0) + 1;
            if (retryCount <= MAX_RETRIES) {
                ppLoadRetries[url] = retryCount;
                setTimeout(function() {
                    if (imgEl._ppUrl === url) {
                        loadDone = false;
                        imgEl.onload = loadHandler;
                        imgEl.onerror = errorHandler;
                        imgEl.src = url + (url.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now();
                    }
                }, 500 * retryCount);
            } else {
                loadDone = true;
                imgEl._ppUrl = null;
                delete ppLoadRetries[url];
                showPlaceholder(imgEl);
            }
        };

        imgEl.onload = loadHandler;
        imgEl.onerror = errorHandler;
        imgEl.src = url;

        if (imgEl.complete && imgEl.naturalWidth > 0) {
            loadHandler();
        }
    }

    function showPlaceholder(imgEl) {
        if (!imgEl) return;
        imgEl.style.transition = 'opacity 0.3s ease';
        imgEl.style.opacity = '1';
        imgEl.classList.add('pp-placeholder');
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
        ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        if (photos[idx]) window.updateAmbientBackground(photos[idx].imageUrl);
    }

    function ppSlideTo(targetOffsetX, callback) {
        if (!ppTrack) {
            if (callback) callback();
            return;
        }
        ppTrackSnapping = true;
        ppTrack.classList.add('snapping');
        var duration = 320;
        ppTrack.style.transition = 'transform ' + duration + 'ms cubic-bezier(0.33, 1, 0.68, 1)';
        var ran = false;
        var onEnd = function() {
            if (ran) return;
            ran = true;
            ppTrack.removeEventListener('transitionend', onEnd);
            ppTrack.classList.remove('snapping');
            ppTrackSnapping = false;
            if (callback) callback();
        };
        ppTrack.addEventListener('transitionend', onEnd);
        setTimeout(onEnd, duration + 120);
        ppTrack.style.transform = 'translate3d(' + targetOffsetX + 'px, 0, 0)';
    }

    function ppSnapTo(targetOffset) {
        if (!ppTrack) return;
        ppTrackSnapping = true;
        var absDiff = Math.abs(ppTrackDrag - targetOffset);
        var duration = Math.min(Math.max(absDiff * 0.5, 150), 400);
        ppTrack.classList.add('snapping');
        ppTrack.style.transition = 'transform ' + duration + 'ms cubic-bezier(0.33, 1, 0.68, 1)';
        var onSnapEnd = function() {
            ppTrack.removeEventListener('transitionend', onSnapEnd);
            ppTrack.classList.remove('snapping');
            ppTrackSnapping = false;

            vibrate(10);

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
        ppTrack.addEventListener('transitionend', onSnapEnd);
        var finalOffset = -ppVw + targetOffset;
        ppTrack.style.transform = 'translate3d(' + finalOffset + 'px, 0, 0)';
    }

    function ppFinishNavigation(newIdx) {
        ppPhotoIdx = newIdx;
        ppResetZoom();
        photoPreviewCurrent = ppSortedPhotos[newIdx];
        ppUpdateInfo(newIdx);
        ppUpdateDots(newIdx);

        ppInitTrack();
        ppTrack.style.transition = 'none';
        ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        ppTrackDrag = 0;
        ppTrackSnapping = false;
        ppTrack.classList.remove('snapping');

        ppSetTrackImages(newIdx);

        if (ppSortedPhotos[newIdx]) {
            window.updateAmbientBackground(ppSortedPhotos[newIdx].imageUrl);
        }

        setTimeout(function() {
            ppNavBusy = false;
        }, 300);
    }

    function ppNavigatePhoto(direction) {
        if (ppNavBusy) return;
        var photos = ppSortedPhotos;
        var newIdx = ppPhotoIdx + direction;

        if (newIdx < 0 || newIdx >= photos.length) {
            if (Math.abs(ppTrackDrag) > 2) ppSnapTo(0);
            return;
        }

        ppNavBusy = true;
        ppInitTrack();

        var targetOffset = direction === 1 ? -2 * ppVw : 0;

        ppPreloadAdjacent(newIdx);
        ppEnsureSideImages(newIdx);

        ppSlideTo(targetOffset, function() {
            ppFinishNavigation(newIdx);
        });
    }

    window.ppPrevPhoto = function() {
        ppNavigatePhoto(-1);
    };

    window.ppNextPhoto = function() {
        ppNavigatePhoto(1);
    };

    function ppUpdateInfo(idx) {
        var photos = ppSortedPhotos;
        if (!photos[idx]) return;
        var photo = photos[idx];
        var userEl = document.getElementById('photoPreviewUser');
        var timeEl = document.getElementById('photoPreviewTime');
        var viewsEl = document.getElementById('photoPreviewViewsCount');

        if (userEl) userEl.textContent = photo.username || '未知用户';
        if (timeEl) {
            var date = new Date(photo.timestamp);
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
            var isAdmin = window.currentUser === 'xxz';
            var isOwner = window.currentUser === photo.username;
            if (isAdmin || isOwner) {
                deleteBtn.style.display = 'flex';
                deleteBtn.title = '删除';
            } else {
                deleteBtn.style.display = 'none';
            }
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
            img.style.borderRadius = '';
        });
    }

    function ppToggleZoom(clientX, clientY) {
        var curImg = document.getElementById('photoPreviewImage');
        if (!curImg) return;

        if (ppZoom.scale > 1.01) {
            ppResetZoom();
            curImg.classList.remove('zoomed');
        } else {
            var rect = curImg.getBoundingClientRect();
            var ratio = 2;
            ppZoom.scale = ratio;

            if (typeof clientX !== 'undefined' && typeof clientY !== 'undefined') {
                var nx = (clientX - rect.left) / rect.width;
                var ny = (clientY - rect.top) / rect.height;
                var cx = rect.left + rect.width * nx;
                var cy = rect.top + rect.height * ny;
                ppZoom.tx = (window.innerWidth / 2 - cx) * (1 - ratio);
                ppZoom.ty = (window.innerHeight / 2 - cy) * (1 - ratio);
            } else {
                var centerX = rect.left + rect.width / 2;
                var centerY = rect.top + rect.height / 2;
                ppZoom.tx = (window.innerWidth / 2 - centerX) * (1 - ratio);
                ppZoom.ty = (window.innerHeight / 2 - centerY) * (1 - ratio);
            }

            var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
            curImg.style.transform = t;
            curImg.classList.add('zoomed');
        }
    }

    function vibrate(duration) {
        if (navigator.vibrate) {
            try {
                navigator.vibrate(duration);
            } catch (e) {}
        }
    }

    function openPhotoPreview(index, keepList) {
        if (photoPreviewActive) {
            return;
        }

        if (!keepList) {
            ppSortedPhotos = window.pwCurrentSortedPhotos ? window.pwCurrentSortedPhotos.slice() : (window.photoWallData ? window.photoWallData.slice() : []);
        }
        if (!ppSortedPhotos || ppSortedPhotos.length === 0) {
            window.showToast('\u6682\u65e0\u7167\u7247');
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
                '<button class="pp-nav-arrow pp-nav-prev" id="ppPrevBtn" onclick="window.ppPrevPhoto()" aria-label="\u4e0a\u4e00\u5f20">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
                '<button class="pp-nav-arrow pp-nav-next" id="ppNextBtn" onclick="window.ppNextPhoto()" aria-label="\u4e0b\u4e00\u5f20">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
                '<div class="photo-preview-image-wrapper" id="ppImageWrapper">' +
                '<div id="ppSlideTrack" class="pp-slide-track">' +
                '<div class="pp-slide-slot pp-prev-slot"><img id="ppPrevImg" class="pp-slide-img" alt="prev"/></div>' +
                '<div class="pp-slide-slot pp-cur-slot"><img id="photoPreviewImage" class="pp-slide-img" alt="current"/></div>' +
                '<div class="pp-slide-slot pp-next-slot"><img id="ppNextImg" class="pp-slide-img" alt="next"/></div>' +
                '</div>' +
                '</div>' +
                '<button class="pp-info-btn" id="ppInfoBtn" title="\u7167\u7247\u8be6\u60c5" onclick="showPhotoInfo()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>' +
                '<button class="pp-share-btn" id="ppShareBtn" title="\u5206\u4eab" onclick="window.shareCurrentPhoto()">\ud83d\udd17</button>' +
                '<button class="pp-rotate-btn" id="ppRotateBtn" title="\u65cb\u8f6c90\u00b0" onclick="window.ppRotatePhoto()">\u27f3</button>' +
                '<button id="ppDeleteBtn" class="pp-delete-btn" onclick="window.deletePhotoFromPreview()">\ud83d\uddd1\ufe0f</button>' +
                '<div class="photo-preview-info">' +
                '<span class="pp-user" id="photoPreviewUser"></span>' +
                '<span class="pp-time" id="photoPreviewTime"></span>' +
                '<span class="pp-views" id="photoPreviewViews"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12s-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/></svg><span id="photoPreviewViewsCount">0</span></span>' +
                '</div>' +
                '<div class="pp-download-overlay" id="ppDownloadOverlay" style="display:none;">' +
                '<div class="pp-download-content">' +
                '<div class="pp-download-spinner"></div>' +
                '<div class="pp-download-text" id="ppDownloadText">\u6b63\u5728\u4e0b\u8f7d...</div>' +
                '<div class="pp-download-progress">' +
                '<div class="pp-download-progress-bar" id="ppDownloadProgressBar"></div>' +
                '</div>' +
                '</div>' +
                '</div>';
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

        var photo = ppSortedPhotos[index];
        if (photo && photo.imageUrl) {
            ppDecodeImage(photo.imageUrl);
        }

        ppInitTrack();
        if (ppTrack) {
            ppTrack.style.transition = 'none';
            ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        }

        // FLIP: Step 1 - record origin
        var originRect = null;
        var originImg = null;
        var grid = document.getElementById('photoGrid');
        if (grid && photo && photo.id != null) {
            var thumbItem = grid.querySelector('.photo-wall-item[data-photo-id="' + String(photo.id).replace(/"/g, '\\"') + '"]');
            var thumbImg = thumbItem ? thumbItem.querySelector('img') : null;
            if (thumbImg && thumbImg.complete) {
                var r = thumbImg.getBoundingClientRect();
                if (r && r.width > 0 && r.height > 0) {
                    originRect = r;
                    originImg = thumbImg;
                }
            }
        }

        overlay._openOrigin = originRect;
        overlay._openOriginImg = originImg;

        if (originImg) {
            originImg.style.transition = 'none';
            originImg.style.opacity = '0';
        }

        // Show overlay
        overlay.classList.add('active');
        document.body.classList.add('photo-previewing');
        overlay.style.opacity = '1';

        ppInitTrack();
        if (ppTrack) {
            ppTrack.style.transition = 'none';
            ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        }

        var curImg = document.getElementById('photoPreviewImage');

        function finishOpen() {
            if (curImg) {
                curImg.style.transition = '';
                curImg.style.transform = '';
                curImg.style.transformOrigin = '';
                curImg.style.borderRadius = '';
            }
            overlay.style.transition = '';
            ppSetTrackImages(index);
            ppUpdateInfo(index);
            ppUpdateDots(index);
            if (originImg) {
                originImg.style.transition = '';
                originImg.style.opacity = '';
            }
        }

        if (curImg && photo && photo.imageUrl) {
            var preloaded = ppImageCache[photo.imageUrl];

            curImg.style.transition = 'none';
            curImg.style.opacity = '0';
            curImg.src = photo.imageUrl;

            if (preloaded || curImg.complete) {
                // Image already ready
                void curImg.offsetHeight;

                if (originRect) {
                    // FLIP: Invert
                    var fr = curImg.getBoundingClientRect();
                    if (fr && fr.width > 0) {
                        var dx = originRect.left - fr.left;
                        var dy = originRect.top - fr.top;
                        var sx = originRect.width / fr.width;
                        var sy = originRect.height / fr.height;
                        var s = Math.min(sx, sy);

                        curImg.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')';
                        curImg.style.transformOrigin = 'top left';
                        curImg.style.borderRadius = (14 / s) + 'px';
                        curImg.style.opacity = '1';
                    }
                }

                void curImg.offsetHeight;

                // FLIP: Play
                if (originRect && curImg.getBoundingClientRect().width > 0) {
                    overlay.style.transition = 'opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1)';
                    curImg.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
                    curImg.style.transform = 'translate(0, 0) scale(1)';
                    curImg.style.borderRadius = '0px';
                    setTimeout(finishOpen, 220);
                } else {
                    curImg.style.opacity = '1';
                    setTimeout(finishOpen, 150);
                }
            } else {
                // Wait for load
                curImg.addEventListener('load', function onLoad() {
                    curImg.removeEventListener('load', onLoad);
                    curImg.removeEventListener('error', onErr);
                    void curImg.offsetHeight;
                    curImg.style.opacity = '1';
                    finishOpen();
                });
                curImg.addEventListener('error', function onErr() {
                    curImg.removeEventListener('load', onLoad);
                    curImg.removeEventListener('error', onErr);
                    curImg.style.opacity = '1';
                    finishOpen();
                });
                setTimeout(finishOpen, 8000);
            }
        } else {
            finishOpen();
        }
    }

    window.openPhotoPreview = openPhotoPreview;

    function closePhotoPreview() {
        if (!photoPreviewActive) return;
        photoPreviewActive = false;
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) {
            document.body.classList.remove('photo-previewing');
            return;
        }

        // 璋冪敤娓呯悊鍑芥暟闃叉鍐呭瓨娉勬紡
        if (overlay._cleanupPreview) {
            overlay._cleanupPreview();
        }

        ppResetZoom();

        var curImg = document.getElementById('photoPreviewImage');
        var originRect = overlay._openOrigin;
        var originImg = overlay._openOriginImg;

        var currentRect = null;
        if (curImg) {
            currentRect = curImg.getBoundingClientRect();
        }

        var canFlip = originRect && currentRect && originImg &&
            currentRect.width > 0 && currentRect.height > 0 &&
            originRect.width > 0 && originRect.height > 0;

        if (canFlip) {
            originImg.style.transition = 'none';
            originImg.style.opacity = '0';

            var dx = originRect.left - currentRect.left;
            var dy = originRect.top - currentRect.top;
            var scaleX = originRect.width / currentRect.width;
            var scaleY = originRect.height / currentRect.height;
            var scale = Math.min(scaleX, scaleY);

            curImg.style.transition = 'none';
            curImg.style.transform = 'translate(0, 0) scale(1)';
            curImg.style.transformOrigin = 'top left';
            curImg.style.borderRadius = '0px';
            void curImg.offsetHeight;

            overlay.style.transition = 'opacity 0.15s cubic-bezier(0.25, 1, 0.4, 1)';
            curImg.style.transition = 'transform 0.2s cubic-bezier(0.25, 1, 0.4, 1), border-radius 0.2s cubic-bezier(0.25, 1, 0.4, 1)';
            curImg.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
            curImg.style.borderRadius = (14 / scale) + 'px';
            overlay.style.opacity = '0';

            setTimeout(function() {
                if (originImg) {
                    originImg.style.transition = '';
                    originImg.style.opacity = '';
                }

                if (curImg) {
                    curImg.style.transition = '';
                    curImg.style.transform = '';
                    curImg.style.transformOrigin = '';
                    curImg.style.borderRadius = '';
                }
                overlay.style.transition = '';
                overlay.style.opacity = '';
                overlay.classList.remove('active');

                document.body.classList.remove('photo-previewing');
            }, 220);
        } else {
            overlay.style.transition = 'opacity 0.15s cubic-bezier(0.55, 0, 1, 0.45)';
            overlay.style.opacity = '0';

            setTimeout(function() {
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.classList.remove('active');

                if (curImg) {
                    curImg.style.transition = '';
                    curImg.style.transform = '';
                    curImg.style.transformOrigin = '';
                    curImg.style.borderRadius = '';
                }

                if (originImg) {
                    originImg.style.transition = '';
                    originImg.style.opacity = '';
                }

                document.body.classList.remove('photo-previewing');
            }, 150);
        }
    }

    window.closePhotoPreview = closePhotoPreview;

    function showPhotoInfo() {
        var photo = photoPreviewCurrent;
        if (!photo) return;

        var modal = document.getElementById('ppInfoModal');

        if (modal && (modal.style.display === 'flex' || modal.classList.contains('active') || modal.classList.contains('closing'))) {
            window.closePhotoInfo();
            return;
        }

        if (!modal) {
            var modalEl = document.createElement('div');
            modalEl.className = 'pp-info-modal';
            modalEl.id = 'ppInfoModal';
            modalEl.innerHTML =
                '<div class="pp-info-modal-content">' +
                '<div class="pp-info-modal-header">' +
                '<span class="pp-info-modal-title">鐓х墖璇︽儏</span>' +
                '<button class="pp-info-modal-close" onclick="window.closePhotoInfo()">&times;</button>' +
                '</div>' +
                '<div class="pp-info-modal-body" id="ppInfoModalBody"></div>' +
                '</div>';

            document.body.appendChild(modalEl);
            modal = modalEl;
        }

        if (!modal._bgListener) {
            modal._bgListener = true;
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    window.closePhotoInfo();
                }
            });
        }

        var sizeStr = '鏈煡';
        if (photo.fileSize) {
            var size = photo.fileSize;
            if (size >= 1024 * 1024) {
                sizeStr = (size / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (size >= 1024) {
                sizeStr = (size / 1024).toFixed(1) + ' KB';
            } else {
                sizeStr = size + ' B';
            }
        }

        var dateStr = '鏈煡';
        if (photo.timestamp) {
            dateStr = new Date(photo.timestamp).toLocaleString('zh-CN');
        }

        var exifHtml = '';
        if (photo.exif) {
            exifHtml = '<div class="pp-info-divider"></div>' +
                '<div class="pp-info-section">' +
                '<div class="pp-info-section-title">鎷嶆憚鍙傛暟</div>';
            if (photo.exif.make || photo.exif.model) {
                exifHtml += '<div class="pp-info-row"><span class="pp-info-label">璁惧</span><span class="pp-info-value">' + (photo.exif.model || photo.exif.make || '鏈煡') + '</span></div>';
            }
            if (photo.exif.fNumber) {
                exifHtml += '<div class="pp-info-row"><span class="pp-info-label">鍏夊湀</span><span class="pp-info-value">f/' + photo.exif.fNumber + '</span></div>';
            }
            if (photo.exif.exposureTime) {
                exifHtml += '<div class="pp-info-row"><span class="pp-info-label">蹇棬</span><span class="pp-info-value">' + photo.exif.exposureTime + '</span></div>';
            }
            if (photo.exif.iso) {
                exifHtml += '<div class="pp-info-row"><span class="pp-info-label">ISO</span><span class="pp-info-value">' + photo.exif.iso + '</span></div>';
            }
            if (photo.exif.focalLength) {
                exifHtml += '<div class="pp-info-row"><span class="pp-info-label">鐒﹁窛</span><span class="pp-info-value">' + photo.exif.focalLength + 'mm</span></div>';
            }
            exifHtml += '</div>';
        }

        document.getElementById('ppInfoModalBody').innerHTML =
            '<div class="pp-info-section">' +
            '<div class="pp-info-section-title">鍏冩暟鎹?/div>' +
            '<div class="pp-info-row"><span class="pp-info-label">涓婁紶鑰?/span><span class="pp-info-value">' + (photo.username || '鏈煡') + '</span></div>' +
            '<div class="pp-info-row"><span class="pp-info-label">涓婁紶鏃堕棿</span><span class="pp-info-value">' + dateStr + '</span></div>' +
            '<div class="pp-info-row"><span class="pp-info-label">娴忚閲?/span><span class="pp-info-value">' + (photo.views || 0) + ' 娆?/span></div>' +
            '</div>' +
            '<div class="pp-info-divider"></div>' +
            '<div class="pp-info-section">' +
            '<div class="pp-info-section-title">鏂囦欢淇℃伅</div>' +
            '<div class="pp-info-row"><span class="pp-info-label">鏂囦欢澶у皬</span><span class="pp-info-value">' + sizeStr + '</span></div>' +
            '</div>' +
            exifHtml;

        if (modal._closeTimeout) {
            clearTimeout(modal._closeTimeout);
            modal._closeTimeout = null;
        }

        var content = modal.querySelector('.pp-info-modal-content');

        var btn = document.getElementById('ppInfoBtn');
        var btnRect = null;
        if (btn) {
            btnRect = btn.getBoundingClientRect();
        }

        modal.classList.remove('closing');
        modal.classList.add('active');
        modal.style.display = 'flex';
        modal.style.opacity = '1';

        content.style.transition = 'none';
        content.style.transform = '';
        content.style.opacity = '1';

        void content.offsetHeight;

        if (btnRect) {
            var finalRect = content.getBoundingClientRect();
            var dx = btnRect.left - finalRect.left;
            var dy = btnRect.top - finalRect.top;
            var scaleX = btnRect.width / finalRect.width;
            var scaleY = btnRect.height / finalRect.height;
            var scale = Math.min(scaleX, scaleY);

            content.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
            content.style.transformOrigin = 'top left';
            content.style.opacity = '0';

            modal._ppInfoOrigin = {
                dx: dx,
                dy: dy,
                scale: scale,
                btnWidth: btnRect.width,
                btnHeight: btnRect.height
            };
        }

        void content.offsetHeight;

        modal.style.transition = 'opacity 0.25s ease-out';
        modal.style.opacity = '0';
        void modal.offsetHeight;
        modal.style.opacity = '1';

        if (btnRect) {
            content.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out';
            content.style.transform = 'translate(0, 0) scale(1)';
            content.style.opacity = '1';
        } else {
            content.style.transition = 'none';
            content.style.transform = 'scale(0.9)';
            content.style.opacity = '0';
            void content.offsetHeight;
            content.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out';
            content.style.transform = 'scale(1)';
            content.style.opacity = '1';
        }
    }

    window.showPhotoInfo = showPhotoInfo;

    window.closePhotoInfo = function() {
        var modal = document.getElementById('ppInfoModal');
        if (!modal) return;
        if (modal.classList.contains('closing')) return;

        var content = modal.querySelector('.pp-info-modal-content');

        modal.classList.remove('active');
        modal.classList.add('closing');

        var origin = modal._ppInfoOrigin;

        if (origin && content) {
            var currentRect = content.getBoundingClientRect();

            var btn = document.getElementById('ppInfoBtn');
            var btnRect = btn ? btn.getBoundingClientRect() : null;

            var targetDx = 0;
            var targetDy = 0;
            var targetScale = 0.3;

            if (btnRect) {
                targetDx = btnRect.left - currentRect.left;
                targetDy = btnRect.top - currentRect.top;
                targetScale = Math.min(btnRect.width / currentRect.width, btnRect.height / currentRect.height);
            } else {
                targetDx = origin.dx;
                targetDy = origin.dy;
                targetScale = origin.scale || 0.3;
            }

            content.style.transition = 'none';
            content.style.transform = 'translate(0, 0) scale(1)';
            content.style.opacity = '1';

            void content.offsetHeight;

            content.style.transition = 'transform 0.3s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.2s ease-in';
            content.style.transform = 'translate(' + targetDx + 'px, ' + targetDy + 'px) scale(' + targetScale + ')';
            content.style.opacity = '0';

            modal.style.transition = 'opacity 0.25s ease-in';
            modal.style.opacity = '0';

            if (modal._closeTimeout) clearTimeout(modal._closeTimeout);
            modal._closeTimeout = setTimeout(function() {
                content.style.transition = 'none';
                content.style.transform = '';
                content.style.opacity = '';
                content.style.transformOrigin = '';
                modal.style.display = 'none';
                modal.style.opacity = '';
                modal.style.transition = '';
                modal.classList.remove('closing');
                modal._closeTimeout = null;
            }, 320);
        } else {
            if (content) {
                content.style.transition = 'none';
                content.style.transform = 'scale(1)';
                content.style.opacity = '1';
                void content.offsetHeight;
                content.style.transition = 'transform 0.3s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.2s ease-in';
                content.style.transform = 'scale(0.9)';
                content.style.opacity = '0';
            }

            modal.style.transition = 'opacity 0.25s ease-in';
            modal.style.opacity = '0';

            modal._closeTimeout = setTimeout(function() {
                modal.style.display = 'none';
                modal.style.opacity = '';
                modal.style.transition = '';
                modal.classList.remove('closing');
                if (content) {
                    content.style.transition = 'none';
                    content.style.transform = '';
                    content.style.opacity = '';
                    content.style.transformOrigin = '';
                }
                modal._closeTimeout = null;
            }, 320);
        }
    };

    window.shareCurrentPhoto = function() {
        var photo = photoPreviewCurrent;
        if (!photo || !photo.imageUrl) {
            window.showToast('\u6682\u65e0\u53ef\u5206\u4eab\u7684\u56fe\u7247');
            return;
        }
        
        if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(10); } catch (e) {}
        }
        
        var btn = document.getElementById('ppShareBtn');
        if (btn) {
            if (btn._copying) return;
            btn._copying = true;
            btn._origHTML = btn.innerHTML;
            btn.textContent = '\u2713';
            btn.classList.add('copied');
        }
        
        function restoreBtn() {
            if (!btn) return;
            btn.innerHTML = btn._origHTML || '\ud83d\udd17';
            btn.classList.remove('copied');
            btn.style.transform = '';
            btn._copying = false;
        }
        
        function copySuccess() {
            window.showToast('\u56fe\u7247\u94fe\u63a5\u5df2\u590d\u5236');
            setTimeout(restoreBtn, 1500);
        }
        
        function copyFail() {
            window.showToast('\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
            setTimeout(restoreBtn, 1500);
        }
        
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(photo.imageUrl).then(copySuccess).catch(copyFail);
                return;
            }
        } catch (e) {}
        
        try {
            var ta = document.createElement('textarea');
            ta.value = photo.imageUrl;
            document.body.appendChild(ta);
            ta.select();
            var success = document.execCommand('copy');
            document.body.removeChild(ta);
            if (success) { copySuccess(); return; }
        } catch (e) {}
        
        copyFail();
    };

    window.deleteCurrentPhoto = function() {
        window.deletePhotoFromPreview();
    };

    window.deletePhotoFromPreview = function() {
        if (!photoPreviewActive) return;

        vibrate(10);

        var btn = document.getElementById('ppDeleteBtn');
        var btnRect = btn ? btn.getBoundingClientRect() : null;
        if (btnRect) {
            var btnCx = btnRect.left + btnRect.width / 2;
            var btnCy = btnRect.top + btnRect.height / 2;
            window._confirmOrigin = {
                btnCx: btnCx,
                btnCy: btnCy,
                btnWidth: btnRect.width,
                btnHeight: btnRect.height
            };
        }

        window.showConfirm('删除照片', '确定删除这张照片吗？', '确认删除', async function() {
            var currentPhotos = ppSortedPhotos;
            if (ppPhotoIdx < 0 || ppPhotoIdx >= currentPhotos.length) return;
            var photo = currentPhotos[ppPhotoIdx];
            if (!photo) return;

            var deleteBtn = document.getElementById('ppDeleteBtn');
            var confirmOkBtn = document.getElementById('ppConfirmOkBtn');
            if (deleteBtn) deleteBtn.disabled = true;
            if (confirmOkBtn) confirmOkBtn.disabled = true;

            window.showToast('正在删除...');
            var deleteResult = { ok: true };
            if (window.deletePhotoWallPhoto) {
                deleteResult = await window.deletePhotoWallPhoto(photo, { render: false });
            }

            if (deleteResult && deleteResult.ok) {
                ppSortedPhotos = currentPhotos.filter(function(item) {
                    return item && String(item.id) !== String(photo.id);
                });

                closePhotoPreview();
                if (window.renderPhotoWallWithoutReload) {
                    window.renderPhotoWallWithoutReload();
                } else if (window.renderPhotoWall) {
                    window.renderPhotoWall();
                }
                window.showToast('已删除，正在同步到其他设备');
            } else {
                if (deleteBtn) deleteBtn.disabled = false;
                if (confirmOkBtn) confirmOkBtn.disabled = false;
            }
        });
    };

    window.ppRotatePhoto = function() {
        var imgs = document.querySelectorAll('.pp-slide-img');
        ppCurrentRotation = (ppCurrentRotation + 90) % 360;
        var rotateStyle = 'rotate(' + ppCurrentRotation + 'deg)';
        imgs.forEach(function(img) {
            img.style.transform = rotateStyle;
        });
    };

    function ppShowDownloadOverlay() {
        try {
            var dlOverlay = document.getElementById('ppDownloadOverlay');
            if (dlOverlay) {
                dlOverlay.style.display = 'flex';
            }
        } catch (e) {
            console.error('Error showing download overlay:', e);
        }
    }

    function ppHideDownloadOverlay() {
        try {
            var dlOverlay = document.getElementById('ppDownloadOverlay');
            if (dlOverlay) {
                dlOverlay.style.display = 'none';
            }
            var progressBar = document.getElementById('ppDownloadProgressBar');
            if (progressBar) {
                progressBar.style.width = '0%';
            }
        } catch (e) {
            console.error('Error hiding download overlay:', e);
        }
    }

    function ppUpdateDownloadProgress(percent, text) {
        try {
            var progressBar = document.getElementById('ppDownloadProgressBar');
            if (progressBar) {
                progressBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
            }
            var dlText = document.getElementById('ppDownloadText');
            if (dlText && text) {
                dlText.textContent = text;
            }
        } catch (e) {
            console.error('Error updating download progress:', e);
        }
    }

    function ppShowDownloadConfirmModal() {
        try {
            var overlay = document.getElementById('photoPreviewOverlay');
            if (!overlay) return;

            var modal = document.getElementById('ppDownloadConfirmModal');
            if (modal) {
                modal.style.display = 'flex';
                void modal.offsetHeight;
                modal.classList.add('show');
                return;
            }

            var confirmOverlay = document.createElement('div');
            confirmOverlay.id = 'ppDownloadConfirmModal';
            confirmOverlay.className = 'pp-download-confirm-overlay';
            confirmOverlay.innerHTML =
                '<div class="pp-download-confirm-content">' +
                    '<div class="pp-download-confirm-title">\u662f\u5426\u8981\u4e0b\u8f7d\u8be5\u56fe\u7247\uff1f</div>' +
                    '<div class="pp-download-confirm-buttons">' +
                        '<button class="pp-download-confirm-btn pp-cancel-btn" onclick="window.ppCancelDownload()">\u53d6\u6d88</button>' +
                        '<button class="pp-download-confirm-btn pp-confirm-btn" onclick="window.ppConfirmDownload()">\u786e\u8ba4</button>' +
                    '</div>' +
                '</div>';

            overlay.appendChild(confirmOverlay);
            ppConfirmDownloadModal = confirmOverlay;

            void confirmOverlay.offsetHeight;
            confirmOverlay.classList.add('show');
        } catch (e) {
            console.error('Error showing download confirm modal:', e);
        }
    }

    function ppHideDownloadConfirmModal() {
        try {
            var modal = document.getElementById('ppDownloadConfirmModal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(function() {
                    try {
                        if (modal && modal.style) {
                            modal.style.display = 'none';
                        }
                    } catch (e2) {
                        console.error('Error in hide timeout:', e2);
                    }
                }, 300);
            }
        } catch (e) {
            console.error('Error hiding download confirm modal:', e);
        }
    }

    window.ppCancelDownload = function() {
        try {
            ppHideDownloadConfirmModal();
        } catch (e) {
            console.error('Error in cancel download:', e);
        }
    };

    window.ppConfirmDownload = function() {
        try {
            ppHideDownloadConfirmModal();
            ppDoDownloadPhoto();
        } catch (e) {
            console.error('Error in confirm download:', e);
        }
    };

    function ppDownloadCurrentPhoto() {
        try {
            if (ppDownloadActive) return;
            
            var photo = photoPreviewCurrent;
            if (!photo || !photo.imageUrl) {
                window.showToast('\u6ca1\u6709\u53ef\u4e0b\u8f7d\u7684\u7167\u7247');
                return;
            }
            
            ppShowDownloadConfirmModal();
        } catch (e) {
            console.error('Error in download current photo:', e);
            window.showToast('\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
        }
    }

    async function ppDoDownloadPhoto() {
        try {
            if (ppDownloadActive) return;
            
            var photo = photoPreviewCurrent;
            if (!photo || !photo.imageUrl) {
                window.showToast('\u6ca1\u6709\u53ef\u4e0b\u8f7d\u7684\u7167\u7247');
                return;
            }

            ppDownloadActive = true;
            ppShowDownloadOverlay();
            ppUpdateDownloadProgress(10, '\u6b63\u5728\u4e0b\u8f7d...');

            if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
                try { navigator.vibrate(10); } catch (e) {}
            }

            // 妯℃嫙杩涘害鍔ㄧ敾
            var dlTimer = setInterval(function() {
                var bar = document.getElementById('ppDownloadProgressBar');
                if (!bar) { clearInterval(dlTimer); return; }
                var cur = parseInt(bar.style.width) || 10;
                if (cur < 85) {
                    ppUpdateDownloadProgress(cur + 2);
                }
            }, 150);

            var response = await fetch(photo.imageUrl);
            clearInterval(dlTimer);
            
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }

            ppUpdateDownloadProgress(90, '\u6b63\u5728\u4fdd\u5b58...');
            var blob = await response.blob();
            
            downloadBlob(blob, photo.imageUrl);

        } catch (err) {
            console.error('Download error:', err);
            ppHideDownloadOverlay();
            ppDownloadActive = false;

            // 闄嶇骇锛氱洿鎺ユ墦寮€鍥剧墖閾炬帴
            try {
                var a = document.createElement('a');
                a.href = photo.imageUrl;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.download = 'photo_' + Date.now() + '.jpg';
                document.body.appendChild(a);
                a.click();
                setTimeout(function() {
                    try { document.body.removeChild(a); } catch (e) {}
                }, 100);
                window.showToast('\u5df2\u5728\u65b0\u7a97\u53e3\u6253\u5f00\u4e0b\u8f7d');
            } catch (e2) {
                window.showToast('\u4e0b\u8f7d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
            }
        }
    }

    function downloadBlob(blob, originalUrl) {
        try {
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            
            var filename = 'photo_' + Date.now() + '.jpg';
            if (originalUrl) {
                var urlParts = originalUrl.split('/');
                var lastPart = urlParts[urlParts.length - 1].split('?')[0];
                if (lastPart && lastPart.length > 0) {
                    filename = lastPart;
                }
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {
                try {
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                } catch (e) {}
            }, 200);

            ppUpdateDownloadProgress(100, '\u4e0b\u8f7d\u6210\u529f!');
            
            setTimeout(function() {
                ppHideDownloadOverlay();
                ppDownloadActive = false;
                window.showToast('\u4e0b\u8f7d\u6210\u529f');
            }, 800);

        } catch (e) {
            console.error('Blob download error:', e);
            ppHideDownloadOverlay();
            ppDownloadActive = false;
            window.showToast('\u4e0b\u8f7d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
        }
    }

    function bindPreviewEvents(overlay) {
        var wrapper = overlay.querySelector('.photo-preview-image-wrapper');

        var startX, startY, startTime;
        
        function cleanupPreview() {
            if (ppLongPressTimer) {
                clearTimeout(ppLongPressTimer);
                ppLongPressTimer = null;
            }
            if (ppCloseTimer) {
                clearTimeout(ppCloseTimer);
                ppCloseTimer = null;
            }
            if (ppTrackRaf) {
                cancelAnimationFrame(ppTrackRaf);
                ppTrackRaf = null;
            }
            ppPointers.clear();
            ppPinchStart = null;
            ppPinchPre = null;
            ppStart = null;
            ppDismissState.isActive = false;
        }
        
        overlay._cleanupPreview = cleanupPreview;

        overlay.addEventListener('pointerdown', function(e) {
            var target = e.target;
            var isButton = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn');
            var isModalContent = target.closest('.pp-info-modal-content, .pp-download-confirm-content');
            var isModal = target.closest('.pp-info-modal, .pp-download-confirm-overlay');
            var isDownloading = ppDownloadActive;

            if (ppCloseTimer) {
                clearTimeout(ppCloseTimer);
                ppCloseTimer = null;
            }
            
            if (ppLongPressTimer) {
                clearTimeout(ppLongPressTimer);
                ppLongPressTimer = null;
            }

            if (isButton || isDownloading) {
                e.stopPropagation();
                return;
            }

            if (isModalContent) {
                e.stopPropagation();
                return;
            }

            if (isModal) {
                e.stopPropagation();
            }

            startTime = Date.now();
            startX = e.clientX;
            startY = e.clientY;
            ppMovedDistance = 0;

            var pointerId = e.pointerId;
            var point = { x: e.clientX, y: e.clientY };
            ppPointers.set(pointerId, point);

            if (ppPointers.size === 1) {
                ppLongPressTimer = setTimeout(function() {
                    ppDownloadCurrentPhoto();
                }, 500);
            }

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
                }
                if (ppZoom.scale > 1.01) {
                    ppStart = { x: e.clientX, y: e.clientY, zx: ppZoom.tx, zy: ppZoom.ty, pointers: 1 };
                } else {
                    ppDismissState.isActive = true;
                    ppDismissState.dy = 0;
                    ppDismissState.scale = 1;
                    ppDismissState.opacity = 1;
                }
            }
        });

        overlay.addEventListener('pointermove', function(e) {
            if (ppPointers.size === 0) return;

            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            ppMovedDistance = Math.abs(dx) + Math.abs(dy);
            
            if (ppMovedDistance > 15 && ppLongPressTimer) {
                clearTimeout(ppLongPressTimer);
                ppLongPressTimer = null;
            }

            var pointerId = e.pointerId;
            ppPointers.set(pointerId, { x: e.clientX, y: e.clientY });

            if (ppPointers.size === 2) {
                var pts = Array.from(ppPointers.values());
                var pdx = pts[1].x - pts[0].x;
                var pdy = pts[1].y - pts[0].y;
                var dist = Math.sqrt(pdx * pdx + pdy * pdy);

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
                    curImg.classList.add('zoomed');
                }
            } else if (ppPointers.size === 1 && ppStart && ppStart.pointers === 1) {
                var sdx = e.clientX - ppStart.x;
                var sdy = e.clientY - ppStart.y;
                ppZoom.tx = ppStart.zx + sdx;
                ppZoom.ty = ppStart.zy + sdy;

                var curImg = document.getElementById('photoPreviewImage');
                if (curImg) {
                    var t = 'translate3d(' + ppZoom.tx + 'px,' + ppZoom.ty + 'px,0) scale(' + ppZoom.scale + ')';
                    curImg.style.transform = t;
                }
            } else {
                if (ppZoom.scale <= 1.01 && ppDismissState.isActive && dy > 0) {
                    ppDismissState.dy = dy;
                    var scaleFactor = Math.max(0.7, 1 - dy / (ppVh * 2));
                    ppDismissState.scale = scaleFactor;
                    ppDismissState.opacity = Math.max(0, 1 - dy / ppVh);

                    var curImg = document.getElementById('photoPreviewImage');
                    if (curImg) {
                        overlay.style.opacity = ppDismissState.opacity;
                        curImg.style.transform = 'translate(0, ' + dy + 'px) scale(' + ppDismissState.scale + ')';
                    }
                } else {
                    if (ppTrackSnapping) return;
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
                            ppTrackRaf = null;
                        });
                    }
                }
            }
        });

        overlay.addEventListener('pointerup', function(e) {
            if (ppLongPressTimer) {
                clearTimeout(ppLongPressTimer);
                ppLongPressTimer = null;
            }

            var target = e.target;
            var isButton = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn');
            var isModalContent = target.closest('.pp-info-modal-content, .pp-download-confirm-content');
            var isModal = target.closest('.pp-info-modal, .pp-download-confirm-overlay');
            var isDownloading = ppDownloadActive;

            if (isButton || isDownloading) {
                e.stopPropagation();
                ppPointers.clear();
                ppStart = null;
                ppDismissState.isActive = false;
                return;
            }

            if (isModalContent) {
                e.stopPropagation();
                ppPointers.clear();
                ppStart = null;
                ppDismissState.isActive = false;
                return;
            }

            if (isModal) {
                e.stopPropagation();
                ppPointers.clear();
                ppStart = null;
                ppDismissState.isActive = false;
                var infoModal = document.getElementById('ppInfoModal');
                if (infoModal && infoModal.style.display !== 'none') {
                    window.closePhotoInfo();
                }
                var downloadModal = document.getElementById('ppDownloadConfirmModal');
                if (downloadModal && downloadModal.style.display !== 'none') {
                    ppHideDownloadConfirmModal();
                }
                return;
            }

            var pointerId = e.pointerId;
            ppPointers.delete(pointerId);

            if (ppPointers.size === 0) {
                var now = Date.now();
                var moved = ppMovedDistance > ppTapThreshold;

                if (ppDismissState.isActive && ppZoom.scale <= 1.01 && ppDismissState.dy > 0) {
                    var dismissThreshold = 150;
                    if (ppDismissState.dy > dismissThreshold) {
                        ppDismissState.isActive = false;
                        closePhotoPreview();
                        return;
                    } else {
                        var curImg = document.getElementById('photoPreviewImage');
                        if (curImg) {
                            overlay.style.transition = 'opacity 0.3s cubic-bezier(0.25, 1, 0.4, 1)';
                            curImg.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.4, 1)';
                            overlay.style.opacity = 1;
                            curImg.style.transform = '';
                        }
                        ppDismissState.isActive = false;
                    }
                }

                if (ppPinchStart) {
                    var distDiff = ppPinchMaxDist - ppPinchMinDist;
                    if (distDiff < 10) {
                        ppZoom = { scale: 1, tx: 0, ty: 0 };
                        var imgs = document.querySelectorAll('.pp-slide-img');
                        imgs.forEach(function(img) {
                            img.style.transform = '';
                        });
                    }
                    ppPinchStart = null;
                    ppPinchPre = null;
                }

                var zoomed = ppZoom.scale > 1.01;

                if (!zoomed && !ppTrackSnapping) {
                    var dx = ppTrackDrag;
                    var isSwipe = Math.abs(dx) > ppVw / 4;

                    if (isSwipe) {
                        var direction = dx > 0 ? -1 : 1;
                        if (direction === -1 && ppPhotoIdx > 0) {
                            ppNavBusy = true;
                            ppPreloadAdjacent(ppPhotoIdx - 1);
                            ppEnsureSideImages(ppPhotoIdx - 1);
                            ppSlideTo(0, function() {
                                ppFinishNavigation(ppPhotoIdx - 1);
                            });
                        } else if (direction === 1 && ppPhotoIdx < ppSortedPhotos.length - 1) {
                            ppNavBusy = true;
                            ppPreloadAdjacent(ppPhotoIdx + 1);
                            ppEnsureSideImages(ppPhotoIdx + 1);
                            ppSlideTo(-2 * ppVw, function() {
                                ppFinishNavigation(ppPhotoIdx + 1);
                            });
                        } else {
                            ppSnapTo(0);
                        }
                    }
                    ppTrackDrag = 0;

                    if (!isSwipe) {
                        moved = false;
                    }
                }

                if (!moved) {
                    if (!zoomed) {
                        var isDoubleTap = (now - ppLastTap < 300 && !ppTapHandled && ppZoom.scale <= 1.01);

                        if (isDoubleTap) {
                            if (ppCloseTimer) {
                                clearTimeout(ppCloseTimer);
                                ppCloseTimer = null;
                            }
                            ppToggleZoom(e.clientX, e.clientY);
                            ppTapHandled = true;
                            setTimeout(function() { ppTapHandled = false; }, 300);
                        }
                        ppLastTap = now;

                        if (!ppTapHandled && ppZoom.scale <= 1.01 && !ppNavBusy) {
                            var modal = document.getElementById('ppInfoModal');
                            if (modal && modal.style.display !== 'none' && modal.classList.contains('active')) {
                                window.closePhotoInfo();
                                ppStart = null;
                                return;
                            }
                            if (ppCloseTimer) clearTimeout(ppCloseTimer);
                            ppCloseTimer = setTimeout(function() {
                                ppCloseTimer = null;
                                closePhotoPreview();
                            }, 350);
                        }
                    } else {
                        if (now - ppLastTap < 300 && !ppTapHandled) {
                            if (ppCloseTimer) {
                                clearTimeout(ppCloseTimer);
                                ppCloseTimer = null;
                            }
                            ppToggleZoom(e.clientX, e.clientY);
                            ppTapHandled = true;
                            setTimeout(function() { ppTapHandled = false; }, 300);
                        }
                        ppLastTap = now;
                    }
                }

                ppStart = null;
            }
        });

        overlay.addEventListener('pointercancel', function(e) {
            if (ppLongPressTimer) {
                clearTimeout(ppLongPressTimer);
                ppLongPressTimer = null;
            }
            
            ppPointers.clear();
            ppPinchStart = null;
            ppPinchPre = null;
            ppStart = null;

            if (ppDismissState.isActive) {
                var curImg = document.getElementById('photoPreviewImage');
                if (curImg) {
                    overlay.style.transition = 'opacity 0.3s cubic-bezier(0.25, 1, 0.4, 1)';
                    curImg.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.4, 1)';
                    overlay.style.opacity = 1;
                    curImg.style.transform = '';
                }
                ppDismissState.isActive = false;
            }

            if (ppZoom.scale <= 1.01) {
                ppSnapTo(0);
            }
        });

        window.addEventListener('resize', function() {
            if (!photoPreviewActive) return;
            ppInitTrack();
            ppSetTrackImages(ppPhotoIdx);
            ppResetZoom();
        });
    }
})();
