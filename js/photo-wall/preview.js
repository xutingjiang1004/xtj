
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
        for (var i = -preloadCount; i &lt;= preloadCount; i++) {
            var adjIdx = idx + i;
            if (adjIdx &gt;= 0 &amp;&amp; adjIdx &lt; photos.length &amp;&amp; photos[adjIdx].imageUrl) {
                ppDecodeImage(photos[adjIdx].imageUrl);
            }
        }
    }

    function ppEnsureSideImages(idx) {
        var photos = ppSortedPhotos;
        if (!ppTrack) return;
        var prevImg = document.getElementById('ppPrevImg');
        var nextImg = document.getElementById('ppNextImg');
        if (idx &gt; 0 &amp;&amp; photos[idx - 1]) {
            ppSwapImage(prevImg, photos[idx - 1].imageUrl);
        } else {
            ppSwapImage(prevImg, null);
        }
        if (idx &lt; photos.length - 1 &amp;&amp; photos[idx + 1]) {
            ppSwapImage(nextImg, photos[idx + 1].imageUrl);
        } else {
            ppSwapImage(nextImg, null);
        }
    }

    var ppImageCache = {};
    var ppDecodeQueue = {};

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
                    resolve();
                } else {
                    img.onload = img.onerror = function() {
                        ppImageCache[url] = img;
                        delete ppDecodeQueue[url];
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
        if (cached) {
            imgEl.style.transition = 'none';
            imgEl.src = url;
            imgEl.style.opacity = '1';
            return;
        }
        imgEl.style.transition = 'none';
        imgEl.removeAttribute('src');
        imgEl.style.opacity = '0';
        var loadDone = false;
        function onLoad() {
            if (loadDone) return;
            loadDone = true;
            imgEl.removeEventListener('load', onLoad);
            imgEl.removeEventListener('error', onError);
            if (!ppImageCache[url]) {
                ppImageCache[url] = imgEl;
            }
            requestAnimationFrame(function() {
                imgEl.style.transition = 'opacity 0.2s ease-in-out';
                void imgEl.offsetHeight;
                imgEl.style.opacity = '1';
            });
        }
        function onError() {
            if (loadDone) return;
            loadDone = true;
            imgEl.removeEventListener('load', onLoad);
            imgEl.removeEventListener('error', onError);
            imgEl._ppUrl = null;
        }
        imgEl.addEventListener('load', onLoad);
        imgEl.addEventListener('error', onError);
        imgEl.src = url;
        if (imgEl.complete &amp;&amp; imgEl.naturalWidth &gt; 0) {
            onLoad();
        }
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
        if (idx &gt; 0 &amp;&amp; photos[idx - 1]) {
            ppSwapImage(prevImg, photos[idx - 1].imageUrl);
        } else {
            ppSwapImage(prevImg, null);
        }
        if (idx &lt; photos.length - 1 &amp;&amp; photos[idx + 1]) {
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

            if (idx &gt; 0 &amp;&amp; photos[idx - 1]) {
                ppSwapImage(prevImg, photos[idx - 1].imageUrl);
            } else {
                ppSwapImage(prevImg, null);
            }
            if (idx &lt; photos.length - 1 &amp;&amp; photos[idx + 1]) {
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

        if (newIdx &lt; 0 || newIdx &gt;= photos.length) {
            if (Math.abs(ppTrackDrag) &gt; 2) ppSnapTo(0);
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
            if (window.currentUser === photo.username) {
                deleteBtn.style.display = 'flex';
                deleteBtn.title = '删除';
            } else {
                deleteBtn.style.display = 'flex';
                deleteBtn.title = '仅照片上传者可删除';
            }
        }
    }

    function ppUpdateDots(idx) {
        var photos = ppSortedPhotos;
        var dotsEl = document.getElementById('ppDots');
        if (!dotsEl || photos.length &lt;= 1) {
            if (dotsEl) dotsEl.style.display = 'none';
            return;
        }
        dotsEl.style.display = 'flex';
        var dots = '';
        for (var i = 0; i &lt; photos.length; i++) {
            dots += '&lt;span class="pp-dot' + (i === idx ? ' active' : '') + '" data-index="' + i + '"&gt;&lt;/span&gt;';
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

        if (ppZoom.scale &gt; 1.01) {
            ppResetZoom();
            curImg.classList.remove('zoomed');
        } else {
            var rect = curImg.getBoundingClientRect();
            var ratio = 2;
            ppZoom.scale = ratio;

            if (typeof clientX !== 'undefined' &amp;&amp; typeof clientY !== 'undefined') {
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
        if (photoPreviewActive) return;

        if (!keepList) {
            ppSortedPhotos = window.photoWallData ? window.photoWallData.slice() : [];
        }
        if (!ppSortedPhotos || ppSortedPhotos.length === 0) {
            window.showToast('暂无照片');
            return;
        }

        if (index &lt; 0) index = 0;
        if (index &gt;= ppSortedPhotos.length) index = ppSortedPhotos.length - 1;

        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay) {
            var container = document.createElement('div');
            container.className = 'photo-preview-overlay';
            container.id = 'photoPreviewOverlay';
            container.innerHTML =
                '&lt;div class="pp-ambient-bg" id="ppAmbientBg"&gt;&lt;/div&gt;' +
                '&lt;div class="pp-dots" id="ppDots"&gt;&lt;/div&gt;' +
                '&lt;button class="photo-preview-close" onclick="closePhotoPreview()"&gt;&amp;times;&lt;/button&gt;' +
                '&lt;button class="pp-nav-arrow pp-nav-prev" id="ppPrevBtn" onclick="window.ppPrevPhoto()" aria-label="上一张"&gt;' +
                '&lt;svg width="20" height="20" viewBox="0 0 20 20" fill="none"&gt;&lt;path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/&gt;&lt;/svg&gt;&lt;/button&gt;' +
                '&lt;button class="pp-nav-arrow pp-nav-next" id="ppNextBtn" onclick="window.ppNextPhoto()" aria-label="下一张"&gt;' +
                '&lt;svg width="20" height="20" viewBox="0 0 20 20" fill="none"&gt;&lt;path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/&gt;&lt;/svg&gt;&lt;/button&gt;' +
                '&lt;div class="photo-preview-image-wrapper" id="ppImageWrapper"&gt;' +
                '&lt;div id="ppSlideTrack" class="pp-slide-track"&gt;' +
                '&lt;div class="pp-slide-slot pp-prev-slot"&gt;&lt;img id="ppPrevImg" class="pp-slide-img" alt="prev"/&gt;&lt;/div&gt;' +
                '&lt;div class="pp-slide-slot pp-cur-slot"&gt;&lt;img id="photoPreviewImage" class="pp-slide-img" alt="current"/&gt;&lt;/div&gt;' +
                '&lt;div class="pp-slide-slot pp-next-slot"&gt;&lt;img id="ppNextImg" class="pp-slide-img" alt="next"/&gt;&lt;/div&gt;' +
                '&lt;/div&gt;' +
                '&lt;/div&gt;' +
                '&lt;button class="pp-info-btn" id="ppInfoBtn" title="照片详情" onclick="showPhotoInfo()"&gt;&lt;svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"&gt;&lt;circle cx="12" cy="12" r="10"/&gt;&lt;line x1="12" y1="16" x2="12" y2="12"/&gt;&lt;line x1="12" y1="8" x2="12.01" y2="8"/&gt;&lt;/svg&gt;&lt;/button&gt;' +
                '&lt;button class="pp-share-btn" id="ppShareBtn" title="分享" onclick="window.shareCurrentPhoto()"&gt;&amp;#x1F517;&lt;/button&gt;' +
                '&lt;button class="pp-rotate-btn" id="ppRotateBtn" title="旋转90°" onclick="window.ppRotatePhoto()"&gt;&amp;#x27F3;&lt;/button&gt;' +
                '&lt;button id="ppDeleteBtn" class="pp-delete-btn" onclick="window.deletePhotoFromPreview()"&gt;🗑️&lt;/button&gt;' +
                '&lt;div class="photo-preview-info"&gt;' +
                '&lt;span class="pp-user" id="photoPreviewUser"&gt;&lt;/span&gt;' +
                '&lt;span class="pp-time" id="photoPreviewTime"&gt;&lt;/span&gt;' +
                '&lt;span class="pp-views" id="photoPreviewViews"&gt;&lt;svg viewBox="0 0 24 24" aria-hidden="true"&gt;&lt;path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12s-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z"/&gt;&lt;circle cx="12" cy="12" r="2.6"/&gt;&lt;/svg&gt;&lt;span id="photoPreviewViewsCount"&gt;0&lt;/span&gt;&lt;/span&gt;' +
                '&lt;/div&gt;';
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
        if (photo &amp;&amp; photo.imageUrl) {
            ppDecodeImage(photo.imageUrl);
        }

        ppInitTrack();
        if (ppTrack) {
            ppTrack.style.transition = 'none';
            ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        }

        var originRect = null;
        var originImg = null;
        var grid = document.getElementById('photoGrid');
        if (grid) {
            var items = grid.querySelectorAll('.photo-wall-item');
            if (items[index]) {
                var thumbImg = items[index].querySelector('img');
                if (thumbImg &amp;&amp; thumbImg.complete) {
                    originRect = thumbImg.getBoundingClientRect();
                    originImg = thumbImg;
                    var area = originRect.width * originRect.height;
                    if (area &lt; 1) {
                        originRect = null;
                        originImg = null;
                    }
                }
            }
        }

        overlay._openOrigin = originRect;
        overlay._openOriginImg = originImg;

        if (originImg) {
            originImg.style.transition = 'none';
            originImg.style.opacity = '0';
        }

        overlay.classList.add('active');
        document.body.classList.add('photo-previewing');

        overlay.style.transition = 'none';
        overlay.style.opacity = '1';
        overlay.style.transform = '';
        overlay.style.transformOrigin = '';

        ppInitTrack();
        if (ppTrack) {
            ppTrack.style.transition = 'none';
            ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        }

        var curImg = document.getElementById('photoPreviewImage');

        function executeFlipAnimation() {
            void overlay.offsetHeight;

            if (curImg &amp;&amp; photo &amp;&amp; photo.imageUrl) {
                curImg.src = photo.imageUrl;
                curImg.style.transition = 'none';
                curImg.style.opacity = '1';
            }

            void curImg?.offsetHeight;

            var finalRect = null;
            var dx = 0, dy = 0, scale = 0.05;

            if (originRect &amp;&amp; curImg) {
                finalRect = curImg.getBoundingClientRect();
                if (finalRect &amp;&amp; finalRect.width &gt; 0 &amp;&amp; finalRect.height &gt; 0) {
                    dx = originRect.left - finalRect.left;
                    dy = originRect.top - finalRect.top;
                    var scaleX = originRect.width / finalRect.width;
                    var scaleY = originRect.height / finalRect.height;
                    scale = Math.min(scaleX, scaleY);

                    curImg.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
                    curImg.style.transformOrigin = 'top left';
                    curImg.style.borderRadius = (14 / scale) + 'px';
                }
            }

            void curImg?.offsetHeight;

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

            if (originRect &amp;&amp; finalRect &amp;&amp; finalRect.width &gt; 0) {
                overlay.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
                curImg.style.transition = 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.55s cubic-bezier(0.16, 1, 0.3, 1)';
                curImg.style.transform = 'translate(0, 0) scale(1)';
                curImg.style.borderRadius = '0px';

                setTimeout(finishOpen, 580);
            } else {
                overlay.style.transition = 'opacity 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                overlay.style.opacity = '0';
                void overlay.offsetHeight;
                overlay.style.opacity = '1';

                if (curImg) {
                    curImg.style.transition = '';
                    curImg.style.transform = '';
                    curImg.style.transformOrigin = '';
                    curImg.style.borderRadius = '';
                }

                setTimeout(finishOpen, 380);
            }
        }

        if (curImg &amp;&amp; photo &amp;&amp; photo.imageUrl) {
            var cachedImg = ppImageCache[photo.imageUrl];
            if (cachedImg || curImg.src === photo.imageUrl &amp;&amp; curImg.complete) {
                executeFlipAnimation();
            } else {
                var loadHandler = function() {
                    curImg.removeEventListener('load', loadHandler);
                    curImg.removeEventListener('error', loadHandler);
                    executeFlipAnimation();
                };
                curImg.addEventListener('load', loadHandler);
                curImg.addEventListener('error', loadHandler);

                curImg.style.transition = 'none';
                curImg.style.opacity = '0';
                curImg.src = photo.imageUrl;

                setTimeout(loadHandler, 2000);
            }
        } else {
            executeFlipAnimation();
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

        ppResetZoom();

        var curImg = document.getElementById('photoPreviewImage');
        var originRect = overlay._openOrigin;
        var originImg = overlay._openOriginImg;

        var currentRect = null;
        if (curImg) {
            currentRect = curImg.getBoundingClientRect();
        }

        var canFlip = originRect &amp;&amp; currentRect &amp;&amp; originImg &amp;&amp;
            currentRect.width &gt; 0 &amp;&amp; currentRect.height &gt; 0 &amp;&amp;
            originRect.width &gt; 0 &amp;&amp; originRect.height &gt; 0;

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

            overlay.style.transition = 'opacity 0.4s cubic-bezier(0.25, 1, 0.4, 1)';
            curImg.style.transition = 'transform 0.45s cubic-bezier(0.25, 1, 0.4, 1), border-radius 0.45s cubic-bezier(0.25, 1, 0.4, 1)';
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
            }, 480);
        } else {
            overlay.style.transition = 'opacity 0.35s cubic-bezier(0.55, 0, 1, 0.45)';
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
            }, 380);
        }
    }

    window.closePhotoPreview = closePhotoPreview;

    function showPhotoInfo() {
        var photo = photoPreviewCurrent;
        if (!photo) return;

        var modal = document.getElementById('ppInfoModal');

        if (modal &amp;&amp; (modal.style.display === 'flex' || modal.classList.contains('active') || modal.classList.contains('closing'))) {
            window.closePhotoInfo();
            return;
        }

        if (!modal) {
            var modalEl = document.createElement('div');
            modalEl.className = 'pp-info-modal';
            modalEl.id = 'ppInfoModal';
            modalEl.innerHTML =
                '&lt;div class="pp-info-modal-content"&gt;' +
                '&lt;div class="pp-info-modal-header"&gt;' +
                '&lt;span class="pp-info-modal-title"&gt;照片详情&lt;/span&gt;' +
                '&lt;button class="pp-info-modal-close" onclick="window.closePhotoInfo()"&gt;&amp;times;&lt;/button&gt;' +
                '&lt;/div&gt;' +
                '&lt;div class="pp-info-modal-body" id="ppInfoModalBody"&gt;&lt;/div&gt;' +
                '&lt;/div&gt;';

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

        var sizeStr = '未知';
        if (photo.fileSize) {
            var size = photo.fileSize;
            if (size &gt;= 1024 * 1024) {
                sizeStr = (size / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (size &gt;= 1024) {
                sizeStr = (size / 1024).toFixed(1) + ' KB';
            } else {
                sizeStr = size + ' B';
            }
        }

        var dateStr = '未知';
        if (photo.timestamp) {
            dateStr = new Date(photo.timestamp).toLocaleString('zh-CN');
        }

        var exifHtml = '';
        if (photo.exif) {
            exifHtml = '&lt;div class="pp-info-divider"&gt;&lt;/div&gt;' +
                '&lt;div class="pp-info-section"&gt;' +
                '&lt;div class="pp-info-section-title"&gt;拍摄参数&lt;/div&gt;';
            if (photo.exif.make || photo.exif.model) {
                exifHtml += '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;设备&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + (photo.exif.model || photo.exif.make || '未知') + '&lt;/span&gt;&lt;/div&gt;';
            }
            if (photo.exif.fNumber) {
                exifHtml += '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;光圈&lt;/span&gt;&lt;span class="pp-info-value"&gt;f/' + photo.exif.fNumber + '&lt;/span&gt;&lt;/div&gt;';
            }
            if (photo.exif.exposureTime) {
                exifHtml += '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;快门&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + photo.exif.exposureTime + '&lt;/span&gt;&lt;/div&gt;';
            }
            if (photo.exif.iso) {
                exifHtml += '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;ISO&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + photo.exif.iso + '&lt;/span&gt;&lt;/div&gt;';
            }
            if (photo.exif.focalLength) {
                exifHtml += '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;焦距&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + photo.exif.focalLength + 'mm&lt;/span&gt;&lt;/div&gt;';
            }
            exifHtml += '&lt;/div&gt;';
        }

        document.getElementById('ppInfoModalBody').innerHTML =
            '&lt;div class="pp-info-section"&gt;' +
            '&lt;div class="pp-info-section-title"&gt;元数据&lt;/div&gt;' +
            '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;上传者&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + (photo.username || '未知') + '&lt;/span&gt;&lt;/div&gt;' +
            '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;上传时间&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + dateStr + '&lt;/span&gt;&lt;/div&gt;' +
            '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;浏览量&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + (photo.views || 0) + ' 次&lt;/span&gt;&lt;/div&gt;' +
            '&lt;/div&gt;' +
            '&lt;div class="pp-info-divider"&gt;&lt;/div&gt;' +
            '&lt;div class="pp-info-section"&gt;' +
            '&lt;div class="pp-info-section-title"&gt;文件信息&lt;/div&gt;' +
            '&lt;div class="pp-info-row"&gt;&lt;span class="pp-info-label"&gt;文件大小&lt;/span&gt;&lt;span class="pp-info-value"&gt;' + sizeStr + '&lt;/span&gt;&lt;/div&gt;' +
            '&lt;/div&gt;' +
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

        if (origin &amp;&amp; content) {
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
            if (document.execCommand &amp;&amp; document.execCommand('copy')) {
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

        if (navigator.clipboard &amp;&amp; navigator.clipboard.writeText) {
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

        window.showConfirm('删除照片', '确定删除这张照片吗？', '是', function() {
            var currentPhotos = ppSortedPhotos;
            if (ppPhotoIdx &lt; 0 || ppPhotoIdx &gt;= currentPhotos.length) return;
            var photo = currentPhotos[ppPhotoIdx];
            if (!photo) return;
            var id = photo.id;
            if (id != null) {
                window.addDeletedPhotoId(id);
            }
            var idxInGlobal = -1;
            if (window.photoWallData) {
                for (var i = 0; i &lt; window.photoWallData.length; i++) {
                    if (window.photoWallData[i].id === id) {
                        idxInGlobal = i;
                        break;
                    }
                }
                if (idxInGlobal &gt;= 0) {
                    window.photoWallData.splice(idxInGlobal, 1);
                }
                window.saveLocalPhotoWallData();
            }
            closePhotoPreview();
            window.renderPhotoWall();
            window.showToast('已删除');
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

    function bindPreviewEvents(overlay) {
        var wrapper = overlay.querySelector('.photo-preview-image-wrapper');

        var startX, startY, startTime;

        overlay.addEventListener('pointerdown', function(e) {
            var target = e.target;
            var isButton = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn');
            var isModalContent = target.closest('.pp-info-modal-content');
            var isModal = target.closest('.pp-info-modal');

            if (ppCloseTimer) {
                clearTimeout(ppCloseTimer);
                ppCloseTimer = null;
            }

            if (isButton) {
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
                if (ppZoom.scale &gt; 1.01) {
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
            } else if (ppPointers.size === 1 &amp;&amp; ppStart &amp;&amp; ppStart.pointers === 1) {
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
                if (ppZoom.scale &lt;= 1.01 &amp;&amp; ppDismissState.isActive &amp;&amp; dy &gt; 0) {
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

                    var isZoomed = ppZoom.scale &gt; 1.01;
                    if (!isZoomed) {
                        var offset = -ppVw + ppTrackDrag;
                        var resistance = 1;
                        if (ppPhotoIdx === 0 &amp;&amp; dx &gt; 0) resistance = 1 + dx / ppVw * 2;
                        if (ppPhotoIdx === ppSortedPhotos.length - 1 &amp;&amp; dx &lt; 0) resistance = 1 - dx / ppVw * 2;
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
            var target = e.target;
            var isButton = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn');
            var isModalContent = target.closest('.pp-info-modal-content');
            var isModal = target.closest('.pp-info-modal');

            if (isButton) {
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
                if (infoModal &amp;&amp; infoModal.style.display !== 'none') {
                    window.closePhotoInfo();
                }
                return;
            }

            var pointerId = e.pointerId;
            ppPointers.delete(pointerId);

            if (ppPointers.size === 0) {
                var now = Date.now();
                var moved = ppMovedDistance &gt; ppTapThreshold;

                if (ppDismissState.isActive &amp;&amp; ppZoom.scale &lt;= 1.01 &amp;&amp; ppDismissState.dy &gt; 0) {
                    var dismissThreshold = 150;
                    if (ppDismissState.dy &gt; dismissThreshold) {
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
                    if (distDiff &lt; 10) {
                        ppZoom = { scale: 1, tx: 0, ty: 0 };
                        var imgs = document.querySelectorAll('.pp-slide-img');
                        imgs.forEach(function(img) {
                            img.style.transform = '';
                        });
                    }
                    ppPinchStart = null;
                    ppPinchPre = null;
                }

                var zoomed = ppZoom.scale &gt; 1.01;

                if (!zoomed &amp;&amp; !ppTrackSnapping) {
                    var dx = ppTrackDrag;
                    var isSwipe = Math.abs(dx) &gt; ppVw / 4;

                    if (isSwipe) {
                        var direction = dx &gt; 0 ? -1 : 1;
                        if (direction === -1 &amp;&amp; ppPhotoIdx &gt; 0) {
                            ppNavBusy = true;
                            ppPreloadAdjacent(ppPhotoIdx - 1);
                            ppEnsureSideImages(ppPhotoIdx - 1);
                            ppSlideTo(0, function() {
                                ppFinishNavigation(ppPhotoIdx - 1);
                            });
                        } else if (direction === 1 &amp;&amp; ppPhotoIdx &lt; ppSortedPhotos.length - 1) {
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
                        var isDoubleTap = (now - ppLastTap &lt; 300 &amp;&amp; !ppTapHandled &amp;&amp; ppZoom.scale &lt;= 1.01);

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

                        if (!ppTapHandled &amp;&amp; ppZoom.scale &lt;= 1.01 &amp;&amp; !ppNavBusy) {
                            var modal = document.getElementById('ppInfoModal');
                            if (modal &amp;&amp; modal.style.display !== 'none' &amp;&amp; modal.classList.contains('active')) {
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
                        if (now - ppLastTap &lt; 300 &amp;&amp; !ppTapHandled) {
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

            if (ppZoom.scale &lt;= 1.01) {
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

