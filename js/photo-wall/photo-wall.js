(function() {
    var photoWallInitialized = false;

    window.initPhotoWall = async function() {
        if (photoWallInitialized) return;
        photoWallInitialized = true;
        await window.renderPhotoWall();
        window.bindPhotoWallScroll();
        fastWarmVisibleThumbs();
    };

    function initPhotoWallHash() {
        function checkHash() {
            var hash = window.location.hash;
            if (hash === '#photo-wall' || hash === '#photos') {
                var aiTab = document.querySelector('.dock-tab[data-tab="ai"]');
                if (aiTab) aiTab.click();
            }
        }
        checkHash();
        window.addEventListener('hashchange', checkHash);
    }

    function fastWarmVisibleThumbs() {
        var imgs = document.querySelectorAll('#photoGrid .photo-wall-item img[data-src]');
        var limit = Math.min(imgs.length, 14);
        for (var i = 0; i < limit; i++) {
            var img = imgs[i];
            var src = img.getAttribute('data-src');
            if (!src) continue;
            img.src = src;
            img.removeAttribute('data-src');
            img.onload = function() {
                this.classList.remove('pw-blur-in');
                this.classList.add('pw-blur-done');
            };
            img.onerror = function() {
                this.classList.remove('pw-blur-in');
                this.classList.add('pw-blur-done');
            };
            if (img.complete && img.naturalWidth > 0) {
                img.classList.remove('pw-blur-in');
                img.classList.add('pw-blur-done');
            }
        }
    }

    function wrapPhotoWallRenderers() {
        if (window.__xtjPhotoPreviewRenderWrapped) return;
        window.__xtjPhotoPreviewRenderWrapped = true;

        var originalRender = window.renderPhotoWall;
        if (typeof originalRender === 'function') {
            window.renderPhotoWall = async function() {
                var result = await originalRender.apply(this, arguments);
                setTimeout(fastWarmVisibleThumbs, 40);
                return result;
            };
        }

        var originalRenderWithoutReload = window.renderPhotoWallWithoutReload;
        if (typeof originalRenderWithoutReload === 'function') {
            window.renderPhotoWallWithoutReload = function() {
                var result = originalRenderWithoutReload.apply(this, arguments);
                setTimeout(fastWarmVisibleThumbs, 40);
                return result;
            };
        }
    }

    function installPreviewHotfix() {
        if (window.__xtjPhotoPreviewHotfixInstalled) return;
        window.__xtjPhotoPreviewHotfixInstalled = true;

        var MAX_ZOOM = 12;

        var state = {
            active: false,
            closing: false,
            photos: [],
            index: -1,
            current: null,
            scale: 1,
            rotation: 0,
            tx: 0,
            ty: 0,
            startX: 0,
            startY: 0,
            baseTx: 0,
            baseTy: 0,
            tapX: 0,
            tapY: 0,
            moved: false,
            dragging: false,
            dismissY: 0,
            lastTap: 0,
            fullToastAt: 0,
            pinchStartDist: 0,
            pinchStartScale: 1,
            pinchActive: false,
            pinchAx: 0,
            pinchAy: 0,
            pinchCx: 0,
            pinchCy: 0
        };

        var imageCache = new Map();

        injectPreviewHotfixStyle();

        function esc(value) {
            if (window.escapeHtml) return window.escapeHtml(String(value == null ? '' : value));
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function icon(type) {
            var paths = {
                close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
                info: '<circle cx="12" cy="12" r="10"></circle><path d="M12 12v4"></path><path d="M12 8h.01"></path>',
                share: '<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 13.5 6.8 4"></path><path d="m15.4 6.5-6.8 4"></path>',
                rotate: '<path d="M20 11a8 8 0 1 0 2.35 5.65"></path><path d="M20 4v7h-7"></path>',
                delete: '<path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="m19 6-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
                prev: '<path d="M15 18 9 12l6-6"></path>',
                next: '<path d="m9 18 6-6-6-6"></path>',
                'zoom-in': '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path><path d="M11 8v6"></path><path d="M8 11h6"></path>',
                'zoom-out': '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path><path d="M8 11h6"></path>',
                compact: '<circle cx="12" cy="12" r="10"></circle><path d="M9 12h6"></path>'
            };
            return '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (paths[type] || '') + '</svg></span>';
        }

        function injectPreviewHotfixStyle() {
            if (document.getElementById('xtjPhotoPreviewHotfixStyle')) return;
            var style = document.createElement('style');
            style.id = 'xtjPhotoPreviewHotfixStyle';
            style.textContent = [
                '.photo-preview-overlay.pp-hotfix-closing{pointer-events:none;}',
                '.photo-preview-overlay.pp-closing{pointer-events:none;background:#000;transform:translateZ(0);-webkit-transform:translateZ(0);will-change:opacity,transform;backface-visibility:hidden;-webkit-backface-visibility:hidden;}',
                '.photo-preview-overlay.pp-closing,.photo-preview-overlay.pp-closing *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;}',
                '.photo-preview-overlay.pp-hotfix-loading .pp-current-loading{opacity:1;transform:translate(-50%,0);}',
                '.pp-current-loading{position:absolute;left:50%;bottom:calc(48px + env(safe-area-inset-bottom,0px));z-index:20;transform:translate(-50%,8px);opacity:0;transition:opacity .22s ease,transform .22s ease;padding:7px 12px;border-radius:999px;background:rgba(15,23,42,.34);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:rgba(255,255,255,.86);font-size:12px;pointer-events:none;}',
                '.pp-slide-img.pp-hotfix-fading{opacity:.72;}',
                '.pp-slide-img:not([src]),.pp-slide-img[src=""]{min-width:80px;min-height:80px;}',
                '.pp-slide-img.pp-placeholder{background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.02));}',
                '.photo-preview-overlay.pp-hotfix-basic-close .photo-preview-image-wrapper{transition:transform .24s cubic-bezier(.16,1,.3,1);transform:scale(.985);}',
                '.pp-compact-btn,.pp-zoom-btn{position:absolute;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:15;width:40px;height:40px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05);backdrop-filter:blur(14px) saturate(120%);-webkit-backdrop-filter:blur(14px) saturate(120%);color:rgba(255,255,255,.80);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .28s cubic-bezier(.16,1,.3,1),background .2s ease,opacity .28s cubic-bezier(.16,1,.3,1),box-shadow .2s ease;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,.10);opacity:0;transform:translateY(10px);}',
                '.photo-preview-overlay.active .pp-compact-btn,.photo-preview-overlay.active .pp-zoom-btn{opacity:1;transform:translateY(0);}',
                '.pp-compact-btn:hover,.pp-zoom-btn:hover{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.25);color:white;}',
                '.pp-compact-btn:active,.pp-zoom-btn:active{transform:scale(.92);}',
                '.pp-zoom-btn:disabled{opacity:.3;cursor:not-allowed;transform:none!important;pointer-events:none;}',
                '.pp-zoom-btn{transform-origin:center center;}',
                '.pp-zoom-in{left:calc(120px + env(safe-area-inset-left,0px));}',
                '.pp-zoom-out{left:calc(68px + env(safe-area-inset-left,0px));}',
                '.pp-compact-btn{right:calc(120px + env(safe-area-inset-right,0px));}',
                '.pp-compact-btn.active{background:rgba(52,211,153,0.2);border-color:rgba(52,211,153,0.45);color:#34d399;}',
                '@media (max-width:480px){.pp-compact-btn,.pp-zoom-btn{width:36px;height:36px;}.pp-zoom-in{left:calc(100px + env(safe-area-inset-left,0px));}.pp-zoom-out{left:calc(56px + env(safe-area-inset-left,0px));}.pp-compact-btn{right:calc(100px + env(safe-area-inset-right,0px));}}',
                '@media (prefers-reduced-motion: reduce){.pp-current-loading,.photo-preview-overlay.pp-hotfix-basic-close .photo-preview-image-wrapper{transition:none!important;}.pp-compact-btn,.pp-zoom-btn{transition:none!important;}}'
            ].join('\n');
            style.setAttribute('data-max-zoom', MAX_ZOOM);
            document.head.appendChild(style);
        }

        function getPhotos() {
            var list = window.pwCurrentSortedPhotos && window.pwCurrentSortedPhotos.length ? window.pwCurrentSortedPhotos : window.photoWallData;
            return Array.isArray(list) ? list.slice() : [];
        }

        function findThumb(photo) {
            if (!photo || photo.id == null) return null;
            var items = document.querySelectorAll('#photoGrid .photo-wall-item');
            for (var i = 0; i < items.length; i++) {
                if (String(items[i].getAttribute('data-photo-id')) === String(photo.id)) {
                    return items[i].querySelector('img');
                }
            }
            return null;
        }

        function isRealImageSrc(src) {
            return !!src && src.indexOf('data:image/svg+xml') !== 0 && src !== window.location.href;
        }

        function getPreviewSrc(photo, thumbImg) {
            var thumbSrc = thumbImg && isRealImageSrc(thumbImg.currentSrc || thumbImg.src) ? (thumbImg.currentSrc || thumbImg.src) : '';
            return thumbSrc || photo.thumbUrl || photo.imageUrl || '';
        }

        function ensureOverlay() {
            var overlay = document.getElementById('photoPreviewOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'photoPreviewOverlay';
                overlay.className = 'photo-preview-overlay pp-info-hidden';
                document.body.appendChild(overlay);
            }

            if (!overlay.querySelector('#ppSlideTrack')) {
                overlay.innerHTML =
                    '<div class="pp-ambient-bg" id="ppAmbientBg"></div>' +
                    '<div class="pp-dots" id="ppDots"></div>' +
                    '<button class="photo-preview-close" onclick="closePhotoPreview()" aria-label="关闭预览">' + icon('close') + '</button>' +
                    '<button class="pp-nav-arrow pp-nav-prev" id="ppPrevBtn" onclick="window.ppPrevPhoto()" aria-label="上一张">' + icon('prev') + '</button>' +
                    '<button class="pp-nav-arrow pp-nav-next" id="ppNextBtn" onclick="window.ppNextPhoto()" aria-label="下一张">' + icon('next') + '</button>' +
                    '<div class="photo-preview-image-wrapper" id="ppImageWrapper"><div id="ppSlideTrack" class="pp-slide-track">' +
                    '<div class="pp-slide-slot pp-prev-slot"><img id="ppPrevImg" class="pp-slide-img" alt="prev"></div>' +
                    '<div class="pp-slide-slot pp-cur-slot"><img id="photoPreviewImage" class="pp-slide-img" alt="current"></div>' +
                    '<div class="pp-slide-slot pp-next-slot"><img id="ppNextImg" class="pp-slide-img" alt="next"></div>' +
                    '</div></div>' +
                    '<button class="pp-info-btn" id="ppInfoBtn" title="照片信息" onclick="showPhotoInfo()">' + icon('info') + '</button>' +
                    '<button class="pp-share-btn" id="ppShareBtn" title="分享" onclick="window.shareCurrentPhoto()">' + icon('share') + '</button>' +
                    '<button class="pp-rotate-btn" id="ppRotateBtn" title="旋转 90 度" onclick="window.ppRotatePhoto()">' + icon('rotate') + '</button>' +
                    '<button id="ppDeleteBtn" class="pp-delete-btn" onclick="window.deletePhotoFromPreview()">' + icon('delete') + '</button>' +
                    '<button class="pp-compact-btn" id="ppCompactBtn" title="照片简洁" onclick="togglePhotoInfo()">' + icon('compact') + '</button>' +
                    '<button class="pp-zoom-btn pp-zoom-out" id="ppZoomOutBtn" title="缩小" onclick="window.zoomOut()">' + icon('zoom-out') + '</button>' +
                    '<button class="pp-zoom-btn pp-zoom-in" id="ppZoomInBtn" title="放大" onclick="window.zoomIn()">' + icon('zoom-in') + '</button>' +
                    '<div class="photo-preview-info"><span class="pp-user" id="photoPreviewUser"></span><span class="pp-time" id="photoPreviewTime"></span><span class="pp-views" id="photoPreviewViews"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12s-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg><span id="photoPreviewViewsCount">0</span></span></div>' +
                    '<div class="pp-current-loading" id="ppCurrentLoading">加载高清中...</div>';
            } else {
                if (!overlay.querySelector('#ppCurrentLoading')) {
                    var loading = document.createElement('div');
                    loading.className = 'pp-current-loading';
                    loading.id = 'ppCurrentLoading';
                    loading.textContent = '加载高清中...';
                    overlay.appendChild(loading);
                }
                if (!overlay.querySelector('#ppCompactBtn')) {
                    var compactBtn = document.createElement('button');
                    compactBtn.className = 'pp-compact-btn';
                    compactBtn.id = 'ppCompactBtn';
                    compactBtn.title = '照片简洁';
                    compactBtn.onclick = togglePhotoInfo;
                    compactBtn.innerHTML = icon('compact');
                    overlay.appendChild(compactBtn);
                }
                if (!overlay.querySelector('#ppZoomOutBtn')) {
                    var zoomOutBtn = document.createElement('button');
                    zoomOutBtn.className = 'pp-zoom-btn pp-zoom-out';
                    zoomOutBtn.id = 'ppZoomOutBtn';
                    zoomOutBtn.title = '缩小';
                    zoomOutBtn.onclick = function() { window.zoomOut(); };
                    zoomOutBtn.innerHTML = icon('zoom-out');
                    overlay.appendChild(zoomOutBtn);
                }
                if (!overlay.querySelector('#ppZoomInBtn')) {
                    var zoomInBtn = document.createElement('button');
                    zoomInBtn.className = 'pp-zoom-btn pp-zoom-in';
                    zoomInBtn.id = 'ppZoomInBtn';
                    zoomInBtn.title = '放大';
                    zoomInBtn.onclick = function() { window.zoomIn(); };
                    zoomInBtn.innerHTML = icon('zoom-in');
                    overlay.appendChild(zoomInBtn);
                }
            }

            bindHotfixEvents(overlay);
            addPinchEvents(overlay);
            return overlay;
        }

        function setupTrack() {
            var vw = window.innerWidth;
            var vh = window.innerHeight;
            var track = document.getElementById('ppSlideTrack');
            if (!track) return;
            var slots = track.querySelectorAll('.pp-slide-slot');
            slots.forEach(function(slot) {
                slot.style.width = vw + 'px';
                slot.style.height = vh + 'px';
            });
            track.style.width = (vw * 3) + 'px';
            track.style.height = vh + 'px';
            track.style.transition = 'none';
            track.style.transform = 'translate3d(' + (-vw) + 'px,0,0)';
        }

        function loadImage(url, timeoutMs) {
            if (!url) return Promise.reject(new Error('empty_url'));
            var cached = imageCache.get(url);
            if (cached && cached.status === 'loaded') return Promise.resolve(cached.img);
            if (cached && cached.status === 'loading' && cached.promise) return cached.promise;

            var promise = new Promise(function(resolve, reject) {
                var img = new Image();
                var done = false;
                var timer = setTimeout(function() {
                    fail(new Error('timeout'));
                }, timeoutMs || 9000);

                img.decoding = 'async';
                img.loading = 'eager';

                function cleanup() {
                    img.onload = null;
                    img.onerror = null;
                    clearTimeout(timer);
                }

                function ok() {
                    if (done) return;
                    if (!img.naturalWidth) {
                        fail(new Error('invalid_image'));
                        return;
                    }
                    done = true;
                    cleanup();
                    imageCache.set(url, { status: 'loaded', img: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
                    resolve(img);
                }

                function fail(err) {
                    if (done) return;
                    done = true;
                    cleanup();
                    imageCache.set(url, { status: 'error', error: err });
                    reject(err);
                }

                img.onload = ok;
                img.onerror = function() { fail(new Error('load_error')); };
                img.src = url;
                if (img.complete) ok();
            });

            imageCache.set(url, { status: 'loading', promise: promise });
            return promise;
        }

        function setImg(img, src, instant) {
            if (!img || !src) return;
            img.classList.remove('pp-placeholder');
            if (instant) img.style.transition = 'none';
            img.style.opacity = '1';
            img.src = src;
            img._xtjCurrentSrc = src;
        }

        function applyTransform(img) {
            if (!img) return;
            img.style.transform = 'translate3d(' + state.tx + 'px,' + state.ty + 'px,0) scale(' + state.scale + ') rotate(' + state.rotation + 'deg)';
        }

        function resetZoom(options) {
            options = options || {};
            state.scale = 1;
            state.tx = 0;
            state.ty = 0;
            state.pinchActive = false;
            state.pinchStartDist = 0;
            state.pinchStartScale = 1;
            state.dragging = false;
            state.moved = false;
            state.dismissY = 0;
            if (options.resetRotation) state.rotation = 0;
            var img = document.getElementById('photoPreviewImage');
            if (img) {
                if (options.instant) img.style.transition = 'none';
                applyTransform(img);
                if (options.instant) {
                    requestAnimationFrame(function() { if (img) img.style.transition = ''; });
                }
            }
            updateZoomButtons();
        }

        function updateSideImages() {
            var prev = document.getElementById('ppPrevImg');
            var next = document.getElementById('ppNextImg');
            var prevPhoto = state.photos[state.index - 1];
            var nextPhoto = state.photos[state.index + 1];
            setSideImage(prev, prevPhoto);
            setSideImage(next, nextPhoto);
        }

        function setSideImage(img, photo) {
            if (!img) return;
            img.onload = null;
            img.onerror = null;
            if (!photo) {
                img.removeAttribute('src');
                img.style.opacity = '0';
                img._xtjCurrentSrc = '';
                return;
            }
            var fallback = photo.thumbUrl || photo.imageUrl || '';
            if (!fallback) return;
            setImg(img, fallback, true);
            if (photo.imageUrl && photo.imageUrl !== fallback) {
                scheduleIdle(function() {
                    loadImage(photo.imageUrl, 12000).then(function() {
                        if (state.active && img && state.photos.indexOf(photo) >= 0) setImg(img, photo.imageUrl, false);
                    }).catch(function() {});
                }, 800);
            }
        }

        function updateInfo() {
            var photo = state.current;
            window.photoPreviewCurrent = photo || null;
            var userEl = document.getElementById('photoPreviewUser');
            var timeEl = document.getElementById('photoPreviewTime');
            var viewsEl = document.getElementById('photoPreviewViewsCount');
            if (userEl) userEl.textContent = photo ? (photo.username || '未知用户') : '';
            if (timeEl) {
                var d = photo && photo.timestamp ? new Date(photo.timestamp) : null;
                timeEl.textContent = d ? d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            }
            if (viewsEl) viewsEl.textContent = photo && photo.views ? photo.views : '0';

            var delBtn = document.getElementById('ppDeleteBtn');
            if (delBtn && photo) {
                var canDelete = window.currentUser === 'xxz' || window.currentUser === photo.username;
                delBtn.style.display = canDelete ? 'flex' : 'none';
            }

            var prevBtn = document.getElementById('ppPrevBtn');
            var nextBtn = document.getElementById('ppNextBtn');
            if (prevBtn) prevBtn.classList.toggle('pp-nav-hidden', state.index <= 0);
            if (nextBtn) nextBtn.classList.toggle('pp-nav-hidden', state.index >= state.photos.length - 1);
            updateDots();
        }

        function updateDots() {
            var dotsEl = document.getElementById('ppDots');
            if (!dotsEl) return;
            if (state.photos.length <= 1 || state.photos.length > 60) {
                dotsEl.style.display = 'none';
                return;
            }
            dotsEl.style.display = 'flex';
            var html = '';
            for (var i = 0; i < state.photos.length; i++) {
                html += '<span class="pp-dot' + (i === state.index ? ' active' : '') + '"></span>';
            }
            dotsEl.innerHTML = html;
        }

        function setLoading(on, text) {
            var overlay = document.getElementById('photoPreviewOverlay');
            var label = document.getElementById('ppCurrentLoading');
            if (!overlay) return;
            overlay.classList.toggle('pp-hotfix-loading', !!on);
            if (label && text) label.textContent = text;
        }

        function showCurrentPhoto(index, options) {
            options = options || {};
            if (index < 0) index = 0;
            if (index >= state.photos.length) index = state.photos.length - 1;
            state.index = index;
            state.current = state.photos[index] || null;
            resetZoom({ resetRotation: true });

            var photo = state.current;
            var curImg = document.getElementById('photoPreviewImage');
            if (!photo || !curImg) return;

            var full = photo.imageUrl || '';
            var token = Date.now() + '_' + Math.random().toString(36).slice(2);
            curImg._xtjLoadToken = token;
            curImg.style.transition = options.instant ? 'none' : 'opacity .18s ease, transform .26s cubic-bezier(.16,1,.3,1)';
            curImg.style.opacity = '0';
            curImg.classList.remove('pp-placeholder');

            var wrapper = document.getElementById('ppImageWrapper');
            if (wrapper) {
                wrapper.style.background = 'transparent';
            }

            applyTransform(curImg);
            updateInfo();

            if (full) {
                setLoading(true, '加载中...');
                loadImage(full, 12000).then(function() {
                    if (!state.active || curImg._xtjLoadToken !== token) return;
                    curImg.style.opacity = '1';
                    setImg(curImg, full, false);
                    setLoading(false);
                    if (window.updateAmbientBackground) window.updateAmbientBackground(full);
                }).catch(function() {
                    if (!state.active || curImg._xtjLoadToken !== token) return;
                    setLoading(false);
                    var thumbImg = options.thumbImg || findThumb(photo);
                    var alt = getPreviewSrc(photo, thumbImg);
                    if (alt && alt !== full) {
                        setImg(curImg, alt, false);
                        curImg.style.opacity = '1';
                        var now = Date.now();
                        if (window.showToast && now - state.fullToastAt > 8000) {
                            state.fullToastAt = now;
                            window.showToast('原图加载失败，已显示预览图');
                        }
                    } else {
                        curImg.classList.add('pp-placeholder');
                        curImg.style.opacity = '1';
                    }
                });
            } else {
                setLoading(false);
                curImg.style.opacity = '1';
                curImg.classList.add('pp-placeholder');
            }

            scheduleIdle(updateSideImages, 650);
            scheduleIdle(function() { preloadAround(index); }, 900);
        }

        function preloadAround(index) {
            for (var i = -1; i <= 1; i++) {
                if (i === 0) continue;
                var photo = state.photos[index + i];
                if (photo && photo.imageUrl) loadImage(photo.imageUrl, 15000).catch(function() {});
            }
        }

        function scheduleIdle(fn, delay) {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(fn, { timeout: delay || 1000 });
            } else {
                setTimeout(fn, delay || 0);
            }
        }

        function runOpenAnimation(overlay, curImg, originRect, originImg) {
            if (!curImg) return;
            overlay.style.opacity = '1';
            if (!originRect) {
                curImg.style.transition = 'opacity .24s ease, transform .28s cubic-bezier(.16,1,.3,1)';
                curImg.style.transform = 'translate3d(0,10px,0) scale(.985)';
                requestAnimationFrame(function() {
                    curImg.style.transform = 'translate3d(0,0,0) scale(1) rotate(' + state.rotation + 'deg)';
                    curImg.style.opacity = '1';
                });
                return;
            }

            requestAnimationFrame(function() {
                var fr = curImg.getBoundingClientRect();
                if (!fr || !fr.width || !fr.height) return;
                var dx = originRect.left - fr.left;
                var dy = originRect.top - fr.top;
                var sx = originRect.width / fr.width;
                var sy = originRect.height / fr.height;
                var scale = Math.min(sx, sy);
                curImg.style.transition = 'none';
                curImg.style.transformOrigin = 'top left';
                curImg.style.borderRadius = (16 / Math.max(scale, 0.2)) + 'px';
                curImg.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
                curImg.style.opacity = '1';
                if (originImg) originImg.style.opacity = '0';
                void curImg.offsetHeight;
                curImg.style.transition = 'transform .3s cubic-bezier(.16,1,.3,1), border-radius .3s cubic-bezier(.16,1,.3,1)';
                curImg.style.transform = 'translate(0,0) scale(1)';
                curImg.style.borderRadius = '0px';
                setTimeout(function() {
                    curImg.style.transition = '';
                    curImg.style.transformOrigin = '';
                    curImg.style.borderRadius = '';
                    applyTransform(curImg);
                    if (originImg) originImg.style.opacity = '';
                }, 330);
            });
        }

        window.openPhotoPreview = function(index, keepList) {
            if (state.active || state.closing) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (overlay && overlay.classList.contains('active')) {
                    finishClose(null, true);
                } else {
                    return;
                }
            }
            state.photos = keepList && state.photos.length ? state.photos : getPhotos();
            if (!state.photos.length) {
                if (window.showToast) window.showToast('暂无照片');
                return;
            }
            if (index < 0) index = 0;
            if (index >= state.photos.length) index = state.photos.length - 1;

            var photo = state.photos[index];
            var thumbImg = findThumb(photo);
            var originRect = null;
            if (thumbImg && thumbImg.complete) {
                var rect = thumbImg.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) originRect = rect;
            }

            var overlay = ensureOverlay();
            setupTrack();
            overlay._xtjOriginRect = originRect;
            overlay._xtjOriginImg = thumbImg;
            state.active = true;
            state.closing = false;
            overlay.classList.remove('pp-closing', 'pp-hotfix-closing', 'pp-hotfix-basic-close');
            overlay.classList.add('pp-info-hidden', 'active');
            document.body.classList.add('photo-previewing');

            var track = document.getElementById('ppSlideTrack');
            if (track) {
                track.style.transition = 'none';
                track.style.transform = 'translate3d(' + (-window.innerWidth) + 'px,0,0)';
            }

            showCurrentPhoto(index, { thumbImg: thumbImg, instant: true });
            var curImg = document.getElementById('photoPreviewImage');
            runOpenAnimation(overlay, curImg, originRect, thumbImg);
            var photo = state.current;
            if (photo && window.syncPhotoViewCount) {
                setTimeout(function() { window.syncPhotoViewCount(photo); }, 300);
            }
        };

        window.closePhotoPreview = function() {
            if (!state.active || state.closing) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (overlay && overlay.classList.contains('active')) {
                    finishClose();
                }
                return;
            }
            state.closing = true;

            var overlay = document.getElementById('photoPreviewOverlay');
            var curImg = document.getElementById('photoPreviewImage');

            if (!overlay) {
                finishClose();
                return;
            }

            if (state._closingSafetyTimer) clearTimeout(state._closingSafetyTimer);
            state._closingSafetyTimer = setTimeout(function() {
                if (state.closing) {
                    finishClose();
                }
            }, 3000);

            setLoading(false);

            overlay.classList.add('pp-closing');
            overlay.classList.add('pp-hotfix-closing');

            var originImg = findThumb(state.current) || overlay._xtjOriginImg;
            var originRect = null;

            if (originImg) {
                var r = originImg.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) originRect = r;
            }

            var curRect = curImg ? curImg.getBoundingClientRect() : null;
            var canFlip = originRect && curRect && curRect.width > 0 && curRect.height > 0 && state.scale <= 1.01;

            var closed = false;
            function done() {
                if (closed) return;
                closed = true;
                requestAnimationFrame(function() {
                    finishClose(originImg);
                });
            }

            clearTimeout(overlay._xtjCloseTimer);
            overlay._xtjCloseTimer = setTimeout(done, canFlip ? 380 : 320);

            if (canFlip && curImg) {
                if (originImg) {
                    originImg.style.transition = 'none';
                    originImg.style.opacity = '0';
                }

                var dx = originRect.left - curRect.left;
                var dy = originRect.top - curRect.top;
                var scale = Math.min(originRect.width / curRect.width, originRect.height / curRect.height);

                curImg.style.transition = 'none';
                curImg.style.transformOrigin = 'top left';
                curImg.style.transform = 'translate3d(0,0,0) scale(1) rotate(' + state.rotation + 'deg)';
                curImg.style.opacity = '1';

                requestAnimationFrame(function() {
                    overlay.style.transition = 'opacity 260ms cubic-bezier(.16,1,.3,1)';
                    overlay.style.opacity = '0.001';

                    curImg.style.transition = 'transform 300ms cubic-bezier(.16,1,.3,1), border-radius 300ms cubic-bezier(.16,1,.3,1), opacity 220ms ease';
                    curImg.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + scale + ') rotate(0deg)';
                    curImg.style.borderRadius = (16 / Math.max(scale, 0.2)) + 'px';

                    curImg.addEventListener('transitionend', done, { once: true });
                });
            } else {
                overlay.classList.add('pp-hotfix-basic-close');

                requestAnimationFrame(function() {
                    overlay.style.transition = 'opacity 240ms cubic-bezier(.16,1,.3,1)';
                    overlay.style.opacity = '0.001';

                    if (curImg) {
                        curImg.style.transition = 'transform 240ms cubic-bezier(.16,1,.3,1), opacity 180ms ease';
                        curImg.style.transform = 'translate3d(0,12px,0) scale(.985) rotate(' + state.rotation + 'deg)';
                        curImg.style.opacity = '0.001';
                    }

                    overlay.addEventListener('transitionend', done, { once: true });
                });
            }
        };

        function finishClose(originImg, skipBodyUnlock) {
            if (state._closingSafetyTimer) {
                clearTimeout(state._closingSafetyTimer);
                state._closingSafetyTimer = null;
            }

            var overlay = document.getElementById('photoPreviewOverlay');
            var curImg = document.getElementById('photoPreviewImage');

            if (overlay && overlay._xtjCloseTimer) {
                clearTimeout(overlay._xtjCloseTimer);
                overlay._xtjCloseTimer = null;
            }

            if (originImg) {
                originImg.style.transition = '';
                originImg.style.opacity = '';
            }

            if (curImg) {
                curImg.style.transition = '';
                curImg.style.transform = '';
                curImg.style.transformOrigin = '';
                curImg.style.borderRadius = '';
                curImg.style.opacity = '';
                curImg.classList.remove('pp-placeholder', 'pp-hotfix-fading');
            }

            if (overlay) {
                overlay.style.transition = '';
                overlay.style.opacity = '';
                overlay.classList.remove(
                    'active',
                    'pp-closing',
                    'pp-hotfix-closing',
                    'pp-hotfix-basic-close',
                    'pp-hotfix-loading'
                );
            }

            state.active = false;
            state.closing = false;
            state.current = null;
            window.photoPreviewCurrent = null;
            resetZoom({ resetRotation: true });

            if (!skipBodyUnlock) {
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        document.body.classList.remove('photo-previewing');
                    });
                });
            }
        }

        window.ppPrevPhoto = function() {
            navigate(-1);
        };

        window.ppNextPhoto = function() {
            navigate(1);
        };

        function navigate(direction) {
            if (!state.active || state.closing) return;
            var nextIndex = state.index + direction;
            if (nextIndex < 0 || nextIndex >= state.photos.length) return;
            var track = document.getElementById('ppSlideTrack');
            var offset = direction > 0 ? -2 * window.innerWidth : 0;
            if (track) {
                track.classList.add('snapping');
                track.style.transition = 'transform .28s cubic-bezier(.33,1,.68,1)';
                track.style.transform = 'translate3d(' + offset + 'px,0,0)';
            }
            setTimeout(function() {
                state.index = nextIndex;
                setupTrack();
                showCurrentPhoto(nextIndex, { instant: false });
                if (track) track.classList.remove('snapping');
                var photo = state.current;
                if (photo && window.syncPhotoViewCount) {
                    setTimeout(function() { window.syncPhotoViewCount(photo); }, 200);
                }
            }, 290);
        }

        window.zoomIn = zoomIn;
        window.zoomOut = zoomOut;

        window.ppRotatePhoto = function() {
            if (!state.active) return;
            state.rotation = (state.rotation + 90) % 360;
            applyTransform(document.getElementById('photoPreviewImage'));
        };

        window.shareCurrentPhoto = async function() {
            var photo = state.current;
            if (!photo) return;
            var url = photo.imageUrl || photo.thumbUrl || '';
            try {
                if (navigator.share) {
                    await navigator.share({ title: '照片墙', text: '分享一张照片', url: url });
                } else if (navigator.clipboard && url) {
                    await navigator.clipboard.writeText(url);
                    if (window.showToast) window.showToast('链接已复制');
                }
            } catch (e) {}
        };

        window.showPhotoInfo = function() {
            var photo = state.current;
            if (!photo) return;
            var modal = document.getElementById('ppInfoModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'ppInfoModal';
                modal.className = 'pp-info-modal';
                modal.innerHTML = '<div class="pp-info-modal-content"><div class="pp-info-modal-header"><span class="pp-info-modal-title">照片详情</span><button class="pp-info-modal-close" onclick="window.closePhotoInfo()">&times;</button></div><div class="pp-info-modal-body" id="ppInfoModalBody"></div></div>';
                document.body.appendChild(modal);
                modal.addEventListener('click', function(e) {
                    if (!e.target.closest('.pp-info-modal-content')) window.closePhotoInfo();
                });
            }
            var body = document.getElementById('ppInfoModalBody');
            var sizeStr = '--';
            if (photo.fileSize) {
                sizeStr = photo.fileSize >= 1048576 ? (photo.fileSize / 1048576).toFixed(2) + ' MB' : (photo.fileSize / 1024).toFixed(1) + ' KB';
            }
            var rows = '';
            rows += infoRow('作者', photo.username || '未知用户');
            rows += infoRow('时间', photo.timestamp ? new Date(photo.timestamp).toLocaleString('zh-CN') : '--');
            rows += infoRow('浏览', photo.views || 0);
            rows += infoRow('大小', sizeStr);
            if (photo.exif) {
                rows += infoRow('设备', photo.exif.model || photo.exif.make || '--');
                if (photo.exif.fNumber) rows += infoRow('光圈', 'f/' + photo.exif.fNumber);
                if (photo.exif.exposureTime) rows += infoRow('快门', photo.exif.exposureTime);
                if (photo.exif.iso) rows += infoRow('ISO', photo.exif.iso);
                if (photo.exif.focalLength) rows += infoRow('焦距', photo.exif.focalLength + 'mm');
            }
            if (body) body.innerHTML = '<div class="pp-info-section"><div class="pp-info-section-title">照片信息</div>' + rows + '</div>';
            modal.classList.remove('closing');
            modal.style.display = 'flex';
            requestAnimationFrame(function() { modal.classList.add('active'); });
        };

        function infoRow(label, value) {
            return '<div class="pp-info-row"><span class="pp-info-label">' + esc(label) + '</span><span class="pp-info-value">' + esc(value) + '</span></div>';
        }

        window.closePhotoInfo = function() {
            var modal = document.getElementById('ppInfoModal');
            if (!modal) return;
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(function() {
                modal.classList.remove('closing');
                modal.style.display = 'none';
            }, 260);
        };

        window.deletePhotoFromPreview = function() {
            var photo = state.current;
            if (!photo) return;
            if (!(window.currentUser === 'xxz' || window.currentUser === photo.username)) {
                if (window.showToast) window.showToast('仅上传者可删除');
                return;
            }
            var doDelete = async function() {
                var btn = document.getElementById('ppDeleteBtn');
                if (btn) btn.disabled = true;
                try {
                    var res = window.deletePhotoWallPhoto ? await window.deletePhotoWallPhoto(photo, { render: false }) : { ok: false };
                    if (!res || !res.ok) {
                        if (window.showToast) window.showToast('删除失败');
                        return;
                    }
                    state.photos = state.photos.filter(function(item) { return String(item.id) !== String(photo.id); });
                    if (window.renderPhotoWallWithoutReload) window.renderPhotoWallWithoutReload();
                    if (state.photos.length === 0) {
                        window.closePhotoPreview();
                    } else {
                        if (state.index >= state.photos.length) state.index = state.photos.length - 1;
                        showCurrentPhoto(state.index, { instant: false });
                    }
                    if (window.showToast) window.showToast('已删除');
                } finally {
                    if (btn) btn.disabled = false;
                }
            };
            if (window.showConfirm) {
                window.showConfirm('删除照片', '确定删除这张照片吗？', '确认删除', doDelete);
            } else if (confirm('确定删除这张照片吗？')) {
                doDelete();
            }
        };

        function bindHotfixEvents(overlay) {
            if (overlay._xtjHotfixEventsBound) return;
            overlay._xtjHotfixEventsBound = true;
            var wrapper = overlay.querySelector('#ppImageWrapper') || overlay;

            wrapper.addEventListener('pointerdown', function(e) {
                if (e.pointerType === 'touch') return;
                if (e.target.closest('button,.pp-info-modal-content')) return;
                state.startX = e.clientX;
                state.startY = e.clientY;
                state.baseTx = state.tx;
                state.baseTy = state.ty;
                state.moved = false;
                state.dragging = true;
                state.dismissY = 0;
                wrapper.setPointerCapture && wrapper.setPointerCapture(e.pointerId);
            });

            wrapper.addEventListener('pointermove', function(e) {
                if (e.pointerType === 'touch') return;
                if (!state.dragging || !state.active) return;
                var dx = e.clientX - state.startX;
                var dy = e.clientY - state.startY;
                if (Math.abs(dx) + Math.abs(dy) > 12) state.moved = true;
                var curImg = document.getElementById('photoPreviewImage');
                if (state.scale > 1.01) {
                    state.tx = state.baseTx + dx;
                    state.ty = state.baseTy + dy;
                    if (curImg) {
                        curImg.style.transition = 'none';
                        applyTransform(curImg);
                    }
                } else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
                    state.dismissY = dy;
                    var opacity = Math.max(0.25, 1 - dy / window.innerHeight);
                    overlay.style.opacity = String(opacity);
                    if (curImg) curImg.style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + Math.max(0.76, 1 - dy / 900) + ') rotate(' + state.rotation + 'deg)';
                }
            });

            wrapper.addEventListener('pointerup', function(e) {
                if (e.pointerType === 'touch') return;
                if (!state.dragging) return;
                state.dragging = false;
                var dx = e.clientX - state.startX;
                var dy = e.clientY - state.startY;
                var curImg = document.getElementById('photoPreviewImage');
                if (state.dismissY > 140) {
                    window.closePhotoPreview();
                    return;
                }
                overlay.style.opacity = '1';
                if (state.scale > 1.01 && state.moved) {
                    if (curImg) {
                        curImg.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
                        applyTransform(curImg);
                        setTimeout(function() { if (curImg) curImg.style.transition = ''; }, 260);
                    }
                } else if (curImg) {
                    curImg.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
                    applyTransform(curImg);
                    setTimeout(function() { if (curImg) curImg.style.transition = ''; }, 260);
                }
                if (!(state.scale > 1.01) && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
                    navigate(dx < 0 ? 1 : -1);
                    return;
                }
                var now = Date.now();
                state.tapX = e.clientX;
                state.tapY = e.clientY;
                if (!state.moved && now - state.lastTap < 300) {
                    toggleZoom();
                    state.lastTap = 0;
                } else {
                    state.lastTap = now;
                }
            });

            window.addEventListener('resize', function() {
                if (!state.active) return;
                setupTrack();
            });

            overlay.addEventListener('click', function(e) {
                var info = document.querySelector('.photo-preview-info');
                var btn = document.getElementById('ppCompactBtn');
                if (!info || overlay.classList.contains('pp-info-hidden')) return;
                if (!info.contains(e.target) && btn && !btn.contains(e.target)) {
                    overlay.classList.add('pp-info-hidden');
                    btn.classList.remove('active');
                }
            });
        }

        function toggleZoom() {
            var img = document.getElementById('photoPreviewImage');
            if (!img) return;
            if (state.scale > 1.01) {
                state.scale = 1;
                state.tx = 0;
                state.ty = 0;
                img.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
                applyTransform(img);
                setTimeout(function() { if (img) img.style.transition = ''; }, 260);
                return;
            }
            var targetScale = 2.5;
            var cx = state.tapX || window.innerWidth / 2;
            var cy = state.tapY || window.innerHeight / 2;
            var vw2 = window.innerWidth / 2;
            var vh2 = window.innerHeight / 2;
            state.tx = (cx - vw2) * (1 - targetScale);
            state.ty = (cy - vh2) * (1 - targetScale);
            state.scale = targetScale;
            img.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
            applyTransform(img);
            setTimeout(function() { if (img) img.style.transition = ''; }, 260);
            updateZoomButtons();
        }

        function updateZoomButtons() {
            var zoomInBtn = document.getElementById('ppZoomInBtn');
            var zoomOutBtn = document.getElementById('ppZoomOutBtn');
            if (zoomInBtn) zoomInBtn.disabled = state.scale >= MAX_ZOOM;
            if (zoomOutBtn) zoomOutBtn.disabled = state.scale <= 1;
        }

        function zoomIn() {
            var img = document.getElementById('photoPreviewImage');
            if (!img || !state.active) return;
            var newScale = Math.min(MAX_ZOOM, state.scale * 1.5);
            if (newScale <= state.scale) return;
            state.scale = newScale;
            img.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
            applyTransform(img);
            setTimeout(function() { if (img) img.style.transition = ''; }, 260);
            updateZoomButtons();
        }

        function zoomOut() {
            var img = document.getElementById('photoPreviewImage');
            if (!img || !state.active) return;
            var newScale = Math.max(1, state.scale / 1.5);
            if (newScale >= state.scale) return;
            if (newScale <= 1) {
                state.tx = 0;
                state.ty = 0;
            }
            state.scale = newScale;
            img.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
            applyTransform(img);
            setTimeout(function() { if (img) img.style.transition = ''; }, 260);
            updateZoomButtons();
        }

        function togglePhotoInfo() {
            var info = document.querySelector('.photo-preview-info');
            var btn = document.getElementById('ppCompactBtn');
            var overlay = document.getElementById('photoPreviewOverlay');
            if (!info || !overlay) return;
            var hidden = overlay.classList.contains('pp-info-hidden');
            overlay.classList.toggle('pp-info-hidden', !hidden);
            if (btn) btn.classList.toggle('active', !hidden);
        }

        function addPinchEvents(wrapper) {
            if (wrapper._xtjPinchBound) return;
            wrapper._xtjPinchBound = true;
            var overlay = document.getElementById('photoPreviewOverlay');
            wrapper.addEventListener('touchstart', function(e) {
                if (e.touches.length === 2) {
                    e.preventDefault();
                    state.pinchActive = true;
                    var dx = e.touches[0].clientX - e.touches[1].clientX;
                    var dy = e.touches[0].clientY - e.touches[1].clientY;
                    state.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                    state.pinchStartScale = state.scale;
                    var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    state.pinchCx = cx;
                    state.pinchCy = cy;
                    state.pinchAx = (cx - window.innerWidth / 2 - state.tx) / (state.scale || 1);
                    state.pinchAy = (cy - window.innerHeight / 2 - state.ty) / (state.scale || 1);
                    state.dragging = false;
                    state.moved = false;
                } else if (e.touches.length === 1) {
                    var touch = e.touches[0];
                    state.startX = touch.clientX;
                    state.startY = touch.clientY;
                    state.baseTx = state.tx;
                    state.baseTy = state.ty;
                    state.moved = false;
                    state.dragging = true;
                    state.dismissY = 0;
                }
            }, { passive: false });

            wrapper.addEventListener('touchmove', function(e) {
                if (state.pinchActive && e.touches.length >= 2) {
                    e.preventDefault();
                    var dx = e.touches[0].clientX - e.touches[1].clientX;
                    var dy = e.touches[0].clientY - e.touches[1].clientY;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    if (state.pinchStartDist > 0) {
                        var newScale = Math.max(0.5, Math.min(MAX_ZOOM, state.pinchStartScale * (dist / state.pinchStartDist)));
                        var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                        var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                        state.tx = cx - window.innerWidth / 2 - state.pinchAx * newScale;
                        state.ty = cy - window.innerHeight / 2 - state.pinchAy * newScale;
                        state.scale = newScale;
                        var img = document.getElementById('photoPreviewImage');
                        if (img) {
                            img.style.transition = 'none';
                            applyTransform(img);
                        }
                    }
                    return;
                }
                if (!state.dragging || e.touches.length !== 1) return;
                var touch = e.touches[0];
                var dx = touch.clientX - state.startX;
                var dy = touch.clientY - state.startY;
                if (Math.abs(dx) + Math.abs(dy) > 12) state.moved = true;
                e.preventDefault();
                var curImg = document.getElementById('photoPreviewImage');
                if (state.scale > 1.01) {
                    state.tx = state.baseTx + dx;
                    state.ty = state.baseTy + dy;
                    if (curImg) {
                        curImg.style.transition = 'none';
                        applyTransform(curImg);
                    }
                } else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
                    state.dismissY = dy;
                    overlay.style.opacity = String(Math.max(0.25, 1 - dy / window.innerHeight));
                    if (curImg) curImg.style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + Math.max(0.76, 1 - dy / 900) + ') rotate(' + state.rotation + 'deg)';
                }
            }, { passive: false });

            wrapper.addEventListener('touchend', function(e) {
                if (state.pinchActive && e.touches.length < 2) {
                    state.pinchActive = false;
                    if (state.scale <= 1.04) {
                        resetZoom({ instant: true });
                    } else {
                        var img = document.getElementById('photoPreviewImage');
                        if (img) {
                            img.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
                            applyTransform(img);
                            setTimeout(function() { if (img) img.style.transition = ''; }, 260);
                        }
                        updateZoomButtons();
                    }
                    return;
                }
                if (!state.dragging) return;
                state.dragging = false;
                var touch = e.changedTouches && e.changedTouches[0];
                var dx = touch ? touch.clientX - state.startX : 0;
                var dy = touch ? touch.clientY - state.startY : 0;
                var curImg = document.getElementById('photoPreviewImage');
                if (state.dismissY > 140) {
                    window.closePhotoPreview();
                    return;
                }
                overlay.style.opacity = '1';
                if (state.scale > 1.01 && state.moved) {
                    if (curImg) {
                        curImg.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
                        applyTransform(curImg);
                        setTimeout(function() { if (curImg) curImg.style.transition = ''; }, 260);
                    }
                } else if (curImg) {
                    curImg.style.transition = 'transform .24s cubic-bezier(.16,1,.3,1)';
                    applyTransform(curImg);
                    setTimeout(function() { if (curImg) curImg.style.transition = ''; }, 260);
                }
                if (!(state.scale > 1.01) && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
                    navigate(dx < 0 ? 1 : -1);
                    return;
                }
                var now = Date.now();
                state.tapX = touch ? touch.clientX : window.innerWidth / 2;
                state.tapY = touch ? touch.clientY : window.innerHeight / 2;
                if (!state.moved && now - state.lastTap < 300) {
                    toggleZoom();
                    state.lastTap = 0;
                } else {
                    state.lastTap = now;
                }
            }, { passive: false });
        }

        document.addEventListener('keydown', function ppKeyHandler(e) {
            if (e.key === 'Escape' && state.active) {
                e.preventDefault();
                window.closePhotoPreview();
            }
        });
    }

    wrapPhotoWallRenderers();
    installPreviewHotfix();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPhotoWallHash);
    } else {
        initPhotoWallHash();
    }
})();
