(function() {
    var photoPreviewActive = false;
    var photoPreviewCurrent = null;
    var ppZoom = { scale: 1, tx: 0, ty: 0 };
    var ppSortedPhotos = [];
    var ppPhotoIdx = -1;
    var ppVw = 0, ppVh = 0;
    var ppTrack = null;
    var ppTrackDrag = 0;
    var ppTrackSnapping = false;
    var ppEventsBound = false;
    var ppDownloadActive = false;
    var ppDownloadAbortController = null;
    var ppDownloadProgress = 0;
    var ppConfirmDownloadModal = null;

    function ppInitTrack() {
        ppVw = window.innerWidth;
        ppVh = window.innerHeight;
        ppTrack = document.getElementById('ppSlideTrack');
        if (ppTrack) {
            ppTrack.style.width = (ppVw * 3) + 'px';
            ppTrack.style.transform = 'translate3d(-' + ppVw + 'px,0,0)';
        }
    }

    function ppSetTrackImages(idx) {
        var prevImg = document.getElementById('ppPrevImg');
        var curImg = document.getElementById('photoPreviewImage');
        var nextImg = document.getElementById('ppNextImg');
        
        var prevIdx = idx - 1;
        var nextIdx = idx + 1;
        
        if (prevIdx >= 0 && ppSortedPhotos[prevIdx]) {
            ppSwapImage(prevImg, ppSortedPhotos[prevIdx].imageUrl);
        } else {
            prevImg.removeAttribute('src');
        }
        
        if (ppSortedPhotos[idx]) {
            ppSwapImage(curImg, ppSortedPhotos[idx].imageUrl);
        }
        
        if (nextIdx < ppSortedPhotos.length && ppSortedPhotos[nextIdx]) {
            ppSwapImage(nextImg, ppSortedPhotos[nextIdx].imageUrl);
        } else {
            nextImg.removeAttribute('src');
        }
        
        ppPreloadAdjacent(idx);
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
                    ppImageCache[url] = img;
                    delete ppDecodeQueue[url];
                    resolve();
                });
            } else {
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

    function ppPreloadAdjacent(idx) {
        var preloadCount = 3;
        for (var i = -preloadCount; i <= preloadCount; i++) {
            var adjIdx = idx + i;
            if (adjIdx >= 0 && adjIdx < ppSortedPhotos.length) {
                var photo = ppSortedPhotos[adjIdx];
                if (photo && photo.imageUrl) {
                    ppDecodeImage(photo.imageUrl);
                }
            }
        }
    }

    var ppLoadRetries = {};
    var MAX_RETRIES = 3;

    function ppSwapImage(imgEl, url) {
        if (!imgEl) return;
        if (!url) {
            imgEl.style.transition = 'none';
            imgEl.removeAttribute('src');
            imgEl.style.opacity = '0';
            imgEl.classList.remove('pp-placeholder');
            return;
        }
        
        if (imgEl.dataset.ppUrl === url) return;
        imgEl.dataset.ppUrl = url;
        
        var cachedImg = ppImageCache[url];
        if (cachedImg && cachedImg.naturalWidth > 0) {
            imgEl.style.transition = 'none';
            imgEl.src = url;
            imgEl.style.opacity = '1';
            imgEl.classList.remove('pp-placeholder');
            return;
        }
        
        imgEl.style.transition = 'none';
        imgEl.style.opacity = '0';
        imgEl.classList.remove('pp-placeholder');
        
        var loadDone = false;
        var retryCount = ppLoadRetries[url] || 0;
        
        function onLoad() {
            if (loadDone) return;
            loadDone = true;
            imgEl.removeEventListener('load', onLoad);
            imgEl.removeEventListener('error', onError);
            delete ppLoadRetries[url];
            
            if (!ppImageCache[url]) {
                ppImageCache[url] = imgEl;
            }
            
            requestAnimationFrame(function() {
                imgEl.style.transition = 'opacity 0.2s ease-out';
                imgEl.style.opacity = '1';
            });
        }
        
        function onError() {
            if (loadDone) return;
            imgEl.removeEventListener('load', onLoad);
            imgEl.removeEventListener('error', onError);
            
            retryCount++;
            if (retryCount <= MAX_RETRIES) {
                ppLoadRetries[url] = retryCount;
                var retryUrl = url + (url.indexOf('?') === -1 ? '?' : '&') + '_retry=' + Date.now();
                imgEl.src = retryUrl;
                imgEl.addEventListener('load', onLoad);
                imgEl.addEventListener('error', onError);
            } else {
                loadDone = true;
                delete ppLoadRetries[url];
                showPlaceholder(imgEl);
            }
        }
        
        imgEl.addEventListener('load', onLoad);
        imgEl.addEventListener('error', onError);
        imgEl.src = url;
        
        if (imgEl.complete && imgEl.naturalWidth > 0) {
            onLoad();
        }
    }

    function showPlaceholder(imgEl) {
        if (!imgEl) return;
        imgEl.style.transition = 'opacity 0.3s ease';
        imgEl.style.opacity = '1';
        imgEl.classList.add('pp-placeholder');
    }

    function ppUpdateInfo(idx) {
        var photo = ppSortedPhotos[idx];
        if (!photo) return;
        
        var userEl = document.getElementById('photoPreviewUser');
        var timeEl = document.getElementById('photoPreviewTime');
        var viewsCount = document.getElementById('photoPreviewViewsCount');
        
        if (userEl) userEl.textContent = photo.userName || photo.user_name || '用户';
        if (timeEl) timeEl.textContent = photo.time || photo.created_at || '';
        if (viewsCount) viewsCount.textContent = photo.views || 0;
    }

    function ppUpdateDots(idx) {
        var dotsContainer = document.getElementById('ppDots');
        if (!dotsContainer) return;
        
        var html = '';
        for (var i = 0; i < ppSortedPhotos.length; i++) {
            var isActive = i === idx;
            html += '<div class="pp-dot' + (isActive ? ' active' : '') + '" data-index="' + i + '"></div>';
        }
        dotsContainer.innerHTML = html;
    }

    function ppResetZoom() {
        ppZoom = { scale: 1, tx: 0, ty: 0 };
        var curImg = document.getElementById('photoPreviewImage');
        if (curImg) {
            curImg.style.transform = '';
        }
    }

    function openPhotoPreview(idx, keepList) {
        try {
            if (photoPreviewActive) return;
            
            if (!keepList) {
                ppSortedPhotos = window.photoWallData ? window.photoWallData.slice() : [];
            }
            
            if (!ppSortedPhotos || ppSortedPhotos.length === 0) {
                window.showToast('暂无照片');
                return;
            }
            
            if (idx < 0) idx = 0;
            if (idx >= ppSortedPhotos.length) idx = ppSortedPhotos.length - 1;
            
            var overlay = document.getElementById('photoPreviewOverlay');
            if (!overlay) {
                var container = document.createElement('div');
                container.className = 'photo-preview-overlay';
                container.id = 'photoPreviewOverlay';
                container.innerHTML =
                    '<div class="pp-ambient-bg" id="ppAmbientBg"></div>' +
                    '<div class="pp-dots" id="ppDots"></div>' +
                    '<button class="photo-preview-close" onclick="closePhotoPreview()">×</button>' +
                    '<button class="pp-nav-arrow pp-nav-prev" id="ppPrevBtn" onclick="window.ppPrevPhoto()" aria-label="上一张">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>' +
                    '<button class="pp-nav-arrow pp-nav-next" id="ppNextBtn" onclick="window.ppNextPhoto()" aria-label="下一张">' +
                    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>' +
                    '<div class="photo-preview-image-wrapper" id="ppImageWrapper">' +
                    '<div id="ppSlideTrack" class="pp-slide-track">' +
                    '<div class="pp-slide-slot pp-prev-slot"><img id="ppPrevImg" class="pp-slide-img" alt="prev"></div>' +
                    '<div class="pp-slide-slot pp-cur-slot"><img id="photoPreviewImage" class="pp-slide-img" alt="current"></div>' +
                    '<div class="pp-slide-slot pp-next-slot"><img id="ppNextImg" class="pp-slide-img" alt="next"></div>' +
                    '</div>' +
                    '</div>' +
                    '<button class="pp-info-btn" id="ppInfoBtn" title="照片详情" onclick="showPhotoInfo()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>' +
                    '<button class="pp-share-btn" id="ppShareBtn" title="分享" onclick="window.shareCurrentPhoto()">🔗</button>' +
                    '<button class="pp-rotate-btn" id="ppRotateBtn" title="旋转90°" onclick="window.ppRotatePhoto()">↻</button>' +
                    '<button id="ppDeleteBtn" class="pp-delete-btn" onclick="window.deletePhotoFromPreview()">🗑️</button>' +
                    '<div class="photo-preview-info">' +
                    '<span class="pp-user" id="photoPreviewUser"></span>' +
                    '<span class="pp-time" id="photoPreviewTime"></span>' +
                    '<span class="pp-views" id="photoPreviewViews"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12s-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg><span id="photoPreviewViewsCount">0</span></span>' +
                    '</div>' +
                    '<div class="pp-download-overlay" id="ppDownloadOverlay" style="display:none;">' +
                    '<div class="pp-download-content">' +
                    '<div class="pp-download-spinner"></div>' +
                    '<div class="pp-download-text" id="ppDownloadText">正在下载...</div>' +
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
            photoPreviewCurrent = ppSortedPhotos[idx] || null;
            ppPhotoIdx = idx;
            
            var photo = ppSortedPhotos[idx];
            if (photo && photo.imageUrl) {
                ppDecodeImage(photo.imageUrl);
            }
            
            ppInitTrack();
            
            // 设置删除按钮可见性
            var deleteBtn = document.getElementById('ppDeleteBtn');
            if (deleteBtn) {
                var photo = ppSortedPhotos[idx];
                var isOwner = window.currentUser && photo && (photo.username === window.currentUser || photo.user_name === window.currentUser);
                deleteBtn.style.display = isOwner ? '' : 'none';
            }
            
            var originRect = null;
            var originImg = null;
            var grid = document.getElementById('photoGrid');
            if (grid) {
                var items = grid.querySelectorAll('.photo-wall-item');
                if (items[idx]) {
                    var thumbImg = items[idx].querySelector('img');
                    if (thumbImg && thumbImg.complete) {
                        var r = thumbImg.getBoundingClientRect();
                        if (r && r.width > 0 && r.height > 0) {
                            originRect = r;
                            originImg = thumbImg;
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
            overlay.style.opacity = '1';
            
            var curImg = document.getElementById('photoPreviewImage');
            
            function finishOpen() {
                try {
                    if (curImg) {
                        curImg.style.transition = '';
                        curImg.style.transform = '';
                        curImg.style.transformOrigin = '';
                        curImg.style.borderRadius = '';
                    }
                    overlay.style.transition = '';
                    ppSetTrackImages(idx);
                    ppUpdateInfo(idx);
                    ppUpdateDots(idx);
                    
                    if (originImg) {
                        originImg.style.transition = '';
                        originImg.style.opacity = '';
                    }
                } catch (e) {
                    console.error('Finish open error:', e);
                }
            }
            
            if (curImg && photo && photo.imageUrl) {
                var preloaded = ppImageCache[photo.imageUrl];
                
                curImg.style.transition = 'none';
                curImg.style.opacity = '0';
                curImg.src = photo.imageUrl;
                
                if (preloaded || (curImg.complete && curImg.naturalWidth > 0)) {
                    void curImg.offsetHeight;
                    
                    if (originRect) {
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
                    
                    if (originRect && curImg.getBoundingClientRect().width > 0) {
                        overlay.style.transition = 'opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1)';
                        curImg.style.transition = 'transform 0.55s cubic-bezier(0.25, 1, 0.5, 1), border-radius 0.55s cubic-bezier(0.25, 1, 0.5, 1)';
                        curImg.style.transform = 'translate(0, 0) scale(1)';
                        curImg.style.borderRadius = '0px';
                        
                        setTimeout(finishOpen, 580);
                    } else {
                        curImg.style.opacity = '1';
                        setTimeout(finishOpen, 320);
                    }
                } else {
                    curImg.addEventListener('load', function onLoad() {
                        curImg.removeEventListener('load', onLoad);
                        curImg.removeEventListener('error', onLoadError);
                        try {
                            void curImg.offsetHeight;
                            curImg.style.opacity = '1';
                            finishOpen();
                        } catch (e) {
                            console.error('Image load error:', e);
                        }
                    });
                    curImg.addEventListener('error', function onLoadError() {
                        curImg.removeEventListener('load', onLoad);
                        curImg.removeEventListener('error', onLoadError);
                        try {
                            curImg.style.opacity = '1';
                            finishOpen();
                        } catch (e) {
                            console.error('Image error:', e);
                        }
                    });
                    setTimeout(finishOpen, 8000);
                }
            } else {
                finishOpen();
            }
        } catch (e) {
            console.error('Open preview error:', e);
        }
    }

    function closePhotoPreview() {
        try {
            var overlay = document.getElementById('photoPreviewOverlay');
            if (!overlay) return;
            
            var originRect = overlay._openOrigin;
            var originImg = overlay._openOriginImg;
            var curImg = document.getElementById('photoPreviewImage');
            
            function finishClose() {
                try {
                    overlay.classList.remove('active');
                    document.body.classList.remove('photo-previewing');
                    overlay.style.display = 'none';
                    overlay.style.transition = '';
                    overlay.style.opacity = '';
                    if (curImg) {
                        curImg.style.transition = '';
                        curImg.style.transform = '';
                        curImg.style.transformOrigin = '';
                        curImg.style.borderRadius = '';
                        curImg.removeAttribute('src');
                        curImg.style.opacity = '';
                    }
                    if (originImg) {
                        originImg.style.transition = '';
                        originImg.style.opacity = '';
                    }
                    photoPreviewActive = false;
                    photoPreviewCurrent = null;
                } catch (e) {
                    console.error('Finish close error:', e);
                }
            }
            
            if (originRect && curImg) {
                var fr = curImg.getBoundingClientRect();
                if (fr && fr.width > 0) {
                    var dx = originRect.left - fr.left;
                    var dy = originRect.top - fr.top;
                    var sx = originRect.width / fr.width;
                    var sy = originRect.height / fr.height;
                    var s = Math.min(sx, sy);
                    
                    curImg.style.transition = 'none';
                    curImg.style.transform = '';
                    curImg.style.borderRadius = '';
                    void curImg.offsetHeight;
                    
                    overlay.style.transition = 'opacity 0.4s cubic-bezier(0.5, 0, 0.75, 0)';
                    curImg.style.transition = 'transform 0.45s cubic-bezier(0.5, 0, 0.75, 0), border-radius 0.45s cubic-bezier(0.5, 0, 0.75, 0)';
                    
                    curImg.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')';
                    curImg.style.borderRadius = (14 / s) + 'px';
                    overlay.style.opacity = '0';
                    
                    setTimeout(finishClose, 480);
                    return;
                }
            }
            
            finishClose();
        } catch (e) {
            console.error('Close preview error:', e);
            try {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (overlay) {
                    overlay.classList.remove('active');
                    document.body.classList.remove('photo-previewing');
                    overlay.style.display = 'none';
                }
                photoPreviewActive = false;
            } catch (e2) {}
        }
    }

    function ppSlideTo(idx) {
        if (idx < 0) idx = 0;
        if (idx >= ppSortedPhotos.length) idx = ppSortedPhotos.length - 1;
        if (idx === ppPhotoIdx) return;
        
        ppPhotoIdx = idx;
        photoPreviewCurrent = ppSortedPhotos[idx];
        ppTrackSnapping = true;
        
        if (ppTrack) {
            ppTrack.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
            ppTrack.style.transform = 'translate3d(-' + ppVw + 'px, 0, 0)';
        }
        
        ppSetTrackImages(idx);
        ppUpdateInfo(idx);
        ppUpdateDots(idx);
        
        setTimeout(function() {
            ppTrackSnapping = false;
        }, 400);
    }

    window.ppPrevPhoto = function() {
        if (ppPhotoIdx > 0) {
            ppSlideTo(ppPhotoIdx - 1);
        }
    };

    window.ppNextPhoto = function() {
        if (ppPhotoIdx < ppSortedPhotos.length - 1) {
            ppSlideTo(ppPhotoIdx + 1);
        }
    };

    function ppShowDownloadOverlay() {
        try {
            var dlOverlay = document.getElementById('ppDownloadOverlay');
            if (dlOverlay) {
                dlOverlay.style.display = 'flex';
            }
        } catch (e) {
            console.error('Show download overlay error:', e);
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
            console.error('Hide download overlay error:', e);
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
            console.error('Update progress error:', e);
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
                '<div class="pp-download-confirm-title">是否要下载该图片？</div>' +
                '<div class="pp-download-confirm-buttons">' +
                '<button class="pp-download-confirm-btn pp-cancel-btn" onclick="window.ppCancelDownload()">取消</button>' +
                '<button class="pp-download-confirm-btn pp-confirm-btn" onclick="window.ppConfirmDownload()">确认</button>' +
                '</div>' +
                '</div>';
            
            overlay.appendChild(confirmOverlay);
            ppConfirmDownloadModal = confirmOverlay;
            
            void confirmOverlay.offsetHeight;
            confirmOverlay.classList.add('show');
        } catch (e) {
            console.error('Show confirm modal error:', e);
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
                    } catch (e) {
                        console.error('Hide modal timeout error:', e);
                    }
                }, 300);
            }
        } catch (e) {
            console.error('Hide confirm modal error:', e);
        }
    }

    window.ppCancelDownload = function() {
        try {
            ppHideDownloadConfirmModal();
        } catch (e) {
            console.error('Cancel download error:', e);
        }
    };

    window.ppConfirmDownload = function() {
        try {
            ppHideDownloadConfirmModal();
            ppDoDownloadPhoto();
        } catch (e) {
            console.error('Confirm download error:', e);
        }
    };

    function ppDownloadCurrentPhoto() {
        try {
            if (ppDownloadActive) return;
            
            var photo = photoPreviewCurrent;
            if (!photo || !photo.imageUrl) {
                window.showToast('没有可下载的照片');
                return;
            }
            
            ppShowDownloadConfirmModal();
        } catch (e) {
            console.error('Download current photo error:', e);
            window.showToast('操作失败，请重试');
        }
    }

    async function ppDoDownloadPhoto() {
        try {
            if (ppDownloadActive) return;
            
            var photo = photoPreviewCurrent;
            if (!photo || !photo.imageUrl) {
                window.showToast('没有可下载的照片');
                return;
            }
            
            ppDownloadActive = true;
            ppShowDownloadOverlay();
            ppUpdateDownloadProgress(0, '正在下载...');
            
            if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
                try {
                    navigator.vibrate(10);
                } catch (e) {
                    console.log('Vibrate not available:', e);
                }
            }
            
            if ('AbortController' in window) {
                ppDownloadAbortController = new AbortController();
            }
            
            var response = await fetch(photo.imageUrl, {
                signal: ppDownloadAbortController ? ppDownloadAbortController.signal : undefined
            });
            
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }
            
            var total = response.headers ? response.headers.get('content-length') : null;
            var reader = response.body ? response.body.getReader() : null;
            var received = 0;
            var chunks = [];
            
            if (reader) {
                while (true) {
                    var result = await reader.read();
                    var done = result.done;
                    var value = result.value;
                    
                    if (value) {
                        chunks.push(value);
                        received += value.length;
                        if (total) {
                            var percent = Math.round((received / total) * 100);
                            ppUpdateDownloadProgress(percent);
                        }
                    }
                    
                    if (done) {
                        break;
                    }
                }
            } else {
                var blob = await response.blob();
                downloadBlob(blob, photo.imageUrl);
                return;
            }
            
            var blob = new Blob(chunks);
            downloadBlob(blob, photo.imageUrl);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Download error:', err);
                try {
                    var photo = photoPreviewCurrent;
                    if (photo && photo.imageUrl) {
                        var fallbackA = document.createElement('a');
                        fallbackA.href = photo.imageUrl;
                        fallbackA.target = '_blank';
                        fallbackA.rel = 'noopener noreferrer';
                        document.body.appendChild(fallbackA);
                        fallbackA.click();
                        setTimeout(function() {
                            try {
                                document.body.removeChild(fallbackA);
                            } catch (e) {}
                        }, 100);
                        window.showToast('已在新标签页打开');
                    } else {
                        window.showToast('下载失败，请重试');
                    }
                } catch (e2) {
                    console.error('Fallback download error:', e2);
                    window.showToast('下载失败，请重试');
                }
            }
            ppHideDownloadOverlay();
            ppDownloadActive = false;
        } finally {
            ppDownloadAbortController = null;
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
                } catch (e) {
                    console.error('Cleanup error:', e);
                }
            }, 100);
            
            ppUpdateDownloadProgress(100, '下载成功!');
            
            setTimeout(function() {
                ppHideDownloadOverlay();
                ppDownloadActive = false;
                window.showToast('下载成功');
            }, 1000);
        } catch (e) {
            console.error('Blob download error:', e);
            ppHideDownloadOverlay();
            ppDownloadActive = false;
            window.showToast('下载失败，请重试');
        }
    }

    window.shareCurrentPhoto = function() {
        try {
            var photo = photoPreviewCurrent;
            if (!photo || !photo.imageUrl) {
                window.showToast('暂无可分享的照片');
                return;
            }
            
            if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
                try {
                    navigator.vibrate(10);
                } catch (e) {}
            }
            
            if ('share' in navigator) {
                try {
                    navigator.share({
                        title: '图片分享',
                        text: '来自照片墙的图片',
                        url: photo.imageUrl
                    }).catch(function(e) {
                        console.log('Share cancelled:', e);
                    });
                    return;
                } catch (e) {
                    console.log('Share not available:', e);
                }
            }
            
            try {
                var textarea = document.createElement('textarea');
                textarea.value = photo.imageUrl;
                document.body.appendChild(textarea);
                textarea.select();
                var success = document.execCommand('copy');
                setTimeout(function() {
                    try {
                        document.body.removeChild(textarea);
                    } catch (e) {}
                }, 100);
                if (success) {
                    window.showToast('链接已复制');
                } else {
                    window.showToast('复制失败');
                }
            } catch (e) {
                window.showToast('链接: ' + photo.imageUrl);
            }
        } catch (e) {
            console.error('Share error:', e);
        }
    };

    function showPhotoInfo() {
        try {
            var modal = document.getElementById('ppInfoModal');
            if (modal) {
                modal.style.display = 'block';
                void modal.offsetHeight;
                modal.classList.add('show');
                return;
            }
            
            var overlay = document.getElementById('photoPreviewOverlay');
            if (!overlay) return;
            
            var infoModal = document.createElement('div');
            infoModal.id = 'ppInfoModal';
            infoModal.className = 'pp-info-modal';
            infoModal.innerHTML =
                '<div class="pp-info-modal-content">' +
                '<div class="pp-info-modal-header">' +
                '<span>照片详情</span>' +
                '<button class="pp-info-modal-close" onclick="closePhotoInfo()">×</button>' +
                '</div>' +
                '<div class="pp-info-modal-body" id="ppInfoBody"></div>' +
                '</div>';
            
            overlay.appendChild(infoModal);
            
            var photo = photoPreviewCurrent;
            var infoBody = document.getElementById('ppInfoBody');
            if (infoBody && photo) {
                var html = '';
                html += '<div class="pp-info-row"><span class="pp-info-label">用户名</span><span class="pp-info-value">' + (photo.userName || photo.user_name || '用户') + '</span></div>';
                html += '<div class="pp-info-row"><span class="pp-info-label">时间</span><span class="pp-info-value">' + (photo.time || photo.created_at || '') + '</span></div>';
                html += '<div class="pp-info-row"><span class="pp-info-label">浏览量</span><span class="pp-info-value">' + (photo.views || 0) + '</span></div>';
                
                try {
                    var contentJson = photo.content ? JSON.parse(photo.content) : null;
                    if (contentJson && contentJson.fileSize) {
                        var sizeStr = contentJson.fileSize >= 1024 * 1024 
                            ? (contentJson.fileSize / (1024 * 1024)).toFixed(2) + ' MB' 
                            : (contentJson.fileSize / 1024).toFixed(1) + ' KB';
                        html += '<div class="pp-info-row"><span class="pp-info-label">文件大小</span><span class="pp-info-value">' + sizeStr + '</span></div>';
                    }
                } catch (e) {}
                
                infoBody.innerHTML = html;
            }
            
            void infoModal.offsetHeight;
            infoModal.classList.add('show');
        } catch (e) {
            console.error('Show info error:', e);
        }
    }

    function closePhotoInfo() {
        try {
            var modal = document.getElementById('ppInfoModal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(function() {
                    try {
                        modal.style.display = 'none';
                    } catch (e) {}
                }, 300);
            }
        } catch (e) {
            console.error('Close info error:', e);
        }
    }

    var ppRotate = 0;

    window.ppRotatePhoto = function() {
        try {
            ppRotate += 90;
            var curImg = document.getElementById('photoPreviewImage');
            if (curImg) {
                curImg.style.transition = 'transform 0.3s ease';
                curImg.style.transform = 'rotate(' + ppRotate + 'deg)';
            }
        } catch (e) {
            console.error('Rotate photo error:', e);
        }
    };

    window.deletePhotoFromPreview = function() {
        try {
            if (!window.currentUser) {
                window.showToast('请先登录');
                return;
            }
            if (!photoPreviewCurrent) {
                window.showToast('未选择照片');
                return;
            }
            
            if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
                try {
                    navigator.vibrate(10);
                } catch (e) {}
            }
            
            window.showConfirm('确定要删除这张照片吗？', function() {
                try {
                    if (!window.sb || !window.sb.from) {
                        window.showToast('删除失败');
                        return;
                    }
                    
                    var photoId = photoPreviewCurrent.id;
                    window.sb.from('posts').delete().eq('id', photoId).then(function(result) {
                        if (result.error) {
                            window.showToast('删除失败: ' + result.error.message);
                            return;
                        }
                        
                        var idx = ppPhotoIdx;
                        ppSortedPhotos.splice(idx, 1);
                        
                        if (window.photoWallData) {
                            for (var i = 0; i < window.photoWallData.length; i++) {
                                if (window.photoWallData[i] && window.photoWallData[i].id === photoId) {
                                    window.photoWallData.splice(i, 1);
                                    break;
                                }
                            }
                        }
                        
                        if (window.saveLocalPhotoWallData) {
                            window.saveLocalPhotoWallData();
                        }
                        
                        if (window.renderPhotoWall) {
                            window.renderPhotoWall();
                        }
                        
                        closePhotoPreview();
                        window.showToast('删除成功');
                    });
                } catch (e) {
                    console.error('Delete error:', e);
                    window.showToast('删除失败');
                }
            });
        } catch (e) {
            console.error('Delete from preview error:', e);
        }
    };

    function bindPreviewEvents(overlay) {
        var wrapper = overlay.querySelector('.photo-preview-image-wrapper');
        var longPressTimer = null;
        var startX = 0, startY = 0, startTime = 0;
        var movedDistance = 0;

        overlay.addEventListener('click', function(e) {
            try {
                var target = e.target;
                var isButton = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn');
                var isModalContent = target.closest('.pp-info-modal-content, .pp-download-confirm-content');
                var isModal = target.closest('.pp-info-modal, .pp-download-confirm-overlay');
                
                if (isButton || isModalContent) {
                    return;
                }
                
                if (isModal) {
                    var infoModal = document.getElementById('ppInfoModal');
                    if (infoModal && infoModal.style.display !== 'none') {
                        closePhotoInfo();
                    }
                    var dlModal = document.getElementById('ppDownloadConfirmModal');
                    if (dlModal && dlModal.style.display !== 'none') {
                        ppHideDownloadConfirmModal();
                    }
                    return;
                }
                
                if (target === overlay || target.closest('.photo-preview-image-wrapper')) {
                    if (!ppDownloadActive) {
                        closePhotoPreview();
                    }
                }
            } catch (e) {
                console.error('Click handler error:', e);
            }
        });

        overlay.addEventListener('pointerdown', function(e) {
            try {
                var target = e.target;
                var isButton = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn');
                var isModalContent = target.closest('.pp-info-modal-content, .pp-download-confirm-content');
                var isModal = target.closest('.pp-info-modal, .pp-download-confirm-overlay');
                
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
                movedDistance = 0;
                
                if (ppDownloadActive) {
                    return;
                }
                
                longPressTimer = setTimeout(function() {
                    longPressTimer = null;
                    ppDownloadCurrentPhoto();
                }, 500);
            } catch (e) {
                console.error('Pointer down error:', e);
            }
        });

        overlay.addEventListener('pointermove', function(e) {
            try {
                movedDistance = Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY);
                if (movedDistance > 15 && longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            } catch (e) {
                console.error('Pointer move error:', e);
            }
        });

        overlay.addEventListener('pointerup', function(e) {
            try {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            } catch (e) {
                console.error('Pointer up error:', e);
            }
        });

        overlay.addEventListener('pointercancel', function(e) {
            try {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            } catch (e) {
                console.error('Pointer cancel error:', e);
            }
        });
    }

    window.openPhotoPreview = openPhotoPreview;
    window.closePhotoPreview = closePhotoPreview;
    window.showPhotoInfo = showPhotoInfo;
    window.closePhotoInfo = closePhotoInfo;
})();
