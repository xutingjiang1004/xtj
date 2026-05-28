(function() {
    var BROKEN_PHOTO_KEY = 'xtj_photos_broken_media';
    var pwPlaceholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Cpath fill="%23c9d5cf" d="M86 285h228L248 198l-42 55-31-39-89 71Z"/%3E%3Ccircle cx="132" cy="128" r="28" fill="%23bccbc4"/%3E%3C/svg%3E';

    function safeEsc(value) {
        if (window.escapeHtml) return window.escapeHtml(String(value == null ? '' : value));
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getBrokenPhotoIds() {
        try {
            var raw = localStorage.getItem(BROKEN_PHOTO_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list.map(String) : [];
        } catch (e) {
            return [];
        }
    }

    function addBrokenPhotoId(id) {
        if (!id) return;
        var list = getBrokenPhotoIds();
        var sid = String(id);
        if (list.indexOf(sid) < 0) {
            list.push(sid);
            try { localStorage.setItem(BROKEN_PHOTO_KEY, JSON.stringify(list.slice(-400))); } catch (e) {}
        }
    }

    function isBrokenPhotoId(id) {
        if (!id) return false;
        return getBrokenPhotoIds().indexOf(String(id)) >= 0;
    }
    window.isBrokenPhotoWallPhoto = isBrokenPhotoId;

    function hasUsableImage(photo) {
        if (!photo) return false;
        var src = photo.thumbUrl || photo.imageUrl || '';
        if (!src) return false;
        if (String(src).indexOf('data:image/svg+xml') === 0) return false;
        if (isBrokenPhotoId(photo.id)) return false;
        return true;
    }

    function getRenderablePhotos(data) {
        return (Array.isArray(data) ? data : []).filter(hasUsableImage);
    }
    window.getRenderablePhotoWallPhotos = getRenderablePhotos;

    function formatPhotoTime(ts) {
        var diff = Date.now() - (ts || Date.now());
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
        var d = new Date(ts || Date.now());
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    window.formatPhotoTime = formatPhotoTime;

    function sortPhotoWallData(data, sortKey) {
        var sorted = getRenderablePhotos(data).slice();
        switch (sortKey) {
            case 'date_asc':
                sorted.sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
                break;
            case 'name':
                sorted.sort(function(a, b) {
                    var na = (a.username || a.id || '').toLowerCase();
                    var nb = (b.username || b.id || '').toLowerCase();
                    return na.localeCompare(nb);
                });
                break;
            case 'size':
            case 'views':
                sorted.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });
                break;
            case 'date_desc':
            default:
                sorted.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
        }
        return sorted;
    }
    window.sortPhotoWallData = sortPhotoWallData;

    function photoWallIconSvg(type, extraClass) {
        var cls = extraClass ? ' ' + extraClass : '';
        if (type === 'empty') {
            return '<span class="ui-icon' + cls + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h4l2-2h4l2 2h4a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a2 2 0 0 1 2-2Z"></path><circle cx="12" cy="13" r="4"></circle></svg></span>';
        }
        if (type === 'upload') {
            return '<span class="ui-icon' + cls + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 1 1 .5 6.96H15"></path><path d="M12 11v9"></path><path d="m8.5 14.5 3.5-3.5 3.5 3.5"></path></svg></span>';
        }
        return '';
    }

    function getPhotoWallEmptyHtml() {
        return '<div class="photo-wall-empty"><div class="photo-wall-empty-icon">' + photoWallIconSvg('empty', 'photo-wall-empty-svg') + '</div><div>还没有照片</div><div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">' + photoWallIconSvg('upload') + '<span>成为第一个分享照片的人</span></div></div>';
    }

    function applyPhotoAspect(imgEl) {
        var item = imgEl && imgEl.closest ? imgEl.closest('.photo-wall-item') : null;
        if (!item || !imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return;
        var ratio = imgEl.naturalWidth / imgEl.naturalHeight;
        ratio = Math.max(3 / 4, Math.min(4 / 3, ratio));
        item.style.setProperty('--pw-aspect', String(Math.round(ratio * 1000)) + ' / 1000');
    }
    window.applyPhotoWallAspect = applyPhotoAspect;

    function removePhotoCardDom(photoId) {
        var item = document.querySelector('.photo-wall-item[data-photo-id="' + String(photoId).replace(/"/g, '\\"') + '"]');
        if (item) {
            item.classList.add('pw-card-removing');
            setTimeout(function() {
                if (item && item.parentNode) item.parentNode.removeChild(item);
            }, 180);
        }
    }

    window.hideBrokenPhotoWallItem = function(photoId, reason) {
        if (!photoId) return;
        var id = String(photoId);
        addBrokenPhotoId(id);
        if (Array.isArray(window.photoWallData)) {
            window.photoWallData = window.photoWallData.filter(function(photo) { return photo && String(photo.id) !== id; });
        }
        if (Array.isArray(window.pwCurrentSortedPhotos)) {
            window.pwCurrentSortedPhotos = window.pwCurrentSortedPhotos.filter(function(photo) { return photo && String(photo.id) !== id; });
        }
        if (window.saveLocalPhotoWallData) window.saveLocalPhotoWallData();
        removePhotoCardDom(id);
        var grid = document.getElementById('photoGrid');
        if (grid && (!window.pwCurrentSortedPhotos || window.pwCurrentSortedPhotos.length === 0)) {
            setTimeout(function() {
                if (grid.querySelectorAll('.photo-wall-item').length === 0) grid.innerHTML = getPhotoWallEmptyHtml();
            }, 220);
        }
        if (reason) console.warn('[PhotoWall] hide broken photo:', id, reason);
    };

    function renderPhotoWallHtml(sorted, startIndex) {
        var html = '';
        var startIdx = startIndex || 0;
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            if (!hasUsableImage(p)) continue;
            var timeStr = formatPhotoTime(p.timestamp);
            var name = p.username || '未知用户';
            var gridSrc = p.thumbUrl || p.imageUrl || '';
            var escapedGridSrc = String(gridSrc).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var actualIndex = startIdx + i;
            html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + safeEsc(String(p.id)) + '" style="animation-delay:' + (actualIndex * 30 < 300 ? actualIndex * 30 : 0) + 'ms" onclick="openPhotoPreview(' + actualIndex + ')">';
            html += '<img src="' + pwPlaceholder + '" alt="photo" class="pw-blur-in" data-src="' + escapedGridSrc + '" loading="lazy">';
            html += '<div class="pw-item-info"><div class="pw-item-name">' + safeEsc(name) + '</div><div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div></div></div>';
        }
        return html;
    }

    var renderLock = false;
    var pendingRender = false;

    async function renderPhotoWall() {
        if (renderLock) {
            pendingRender = true;
            return;
        }
        renderLock = true;
        var grid = document.getElementById('photoGrid');
        if (!grid) { renderLock = false; return; }
        var skeletonHtml = '';
        for (var s = 0; s < 9; s++) skeletonHtml += '<div class="pw-skeleton"></div>';
        grid.innerHTML = skeletonHtml;

        await window.loadPhotoWallData();
        var sortKey = window.pwSortKey || 'date_desc';
        var sorted = sortPhotoWallData(window.photoWallData, sortKey);
        window.pwCurrentSortedPhotos = sorted.slice();

        if (sorted.length === 0) {
            grid.innerHTML = getPhotoWallEmptyHtml();
            renderLock = false;
            return;
        }

        grid.innerHTML = renderPhotoWallHtml(sorted);
        animatePhotoCards(grid);
        setupInfiniteScroll();
        pwObserveLazyImages(grid);
        renderLock = false;
        if (pendingRender) {
            pendingRender = false;
            renderPhotoWall();
        }
    }
    window.renderPhotoWall = renderPhotoWall;

    function renderPhotoWallWithoutReload() {
        var grid = document.getElementById('photoGrid');
        if (!grid) return;
        var sortKey = window.pwSortKey || 'date_desc';
        var sorted = sortPhotoWallData(window.photoWallData, sortKey);
        window.pwCurrentSortedPhotos = sorted.slice();
        if (sorted.length === 0) {
            grid.innerHTML = getPhotoWallEmptyHtml();
            return;
        }
        grid.innerHTML = renderPhotoWallHtml(sorted);
        animatePhotoCards(grid);
        pwObserveLazyImages(grid);
    }
    window.renderPhotoWallWithoutReload = renderPhotoWallWithoutReload;

    function animatePhotoCards(grid) {
        requestAnimationFrame(function() {
            var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
            items.forEach(function(item, index) {
                setTimeout(function() {
                    item.classList.add('pw-stagger-done');
                    item.classList.remove('pw-stagger-enter');
                }, index * 20);
            });
        });
    }

    var pwLazyObserver = null;
    var imageLoadQueue = [];
    var isProcessingQueue = false;
    var imgCache = new Map();
    var activeLoadCount = 0;
    var MAX_CONCURRENT_LOADS = 4;

    function processImageQueue() {
        if (isProcessingQueue || imageLoadQueue.length === 0) return;
        if (activeLoadCount >= MAX_CONCURRENT_LOADS) return;
        isProcessingQueue = true;
        var batchSize = Math.max(1, MAX_CONCURRENT_LOADS - activeLoadCount);
        var batch = imageLoadQueue.splice(0, batchSize);
        batch.forEach(function(entry) {
            var img = entry.target;
            var realSrc = img.getAttribute('data-src');
            var card = img.closest('.photo-wall-item');
            var photoId = card ? card.getAttribute('data-photo-id') : '';
            if (!realSrc) {
                img.classList.remove('pw-blur-in');
                img.classList.add('pw-blur-done');
                if (pwLazyObserver) pwLazyObserver.unobserve(img);
                return;
            }
            if (imgCache.get(realSrc) === 'success') {
                img.src = realSrc;
                img.removeAttribute('data-src');
                img.classList.remove('pw-blur-in');
                img.classList.add('pw-blur-done');
                if (img.complete && img.naturalWidth > 0) applyPhotoAspect(img);
                if (pwLazyObserver) pwLazyObserver.unobserve(img);
                return;
            }
            if (imgCache.get(realSrc) === 'error') {
                if (window.hideBrokenPhotoWallItem) window.hideBrokenPhotoWallItem(photoId, 'cached image error');
                if (pwLazyObserver) pwLazyObserver.unobserve(img);
                return;
            }
            activeLoadCount++;
            img.src = realSrc;
            img.removeAttribute('data-src');
            if (img.complete && img.naturalWidth > 0) {
                imgCache.set(realSrc, 'success');
                img.classList.remove('pw-blur-in');
                img.classList.add('pw-blur-done');
                applyPhotoAspect(img);
                activeLoadCount--;
                if (pwLazyObserver) pwLazyObserver.unobserve(img);
                processImageQueue();
            } else {
                img.onload = function() {
                    imgCache.set(realSrc, 'success');
                    img.classList.remove('pw-blur-in');
                    img.classList.add('pw-blur-done');
                    applyPhotoAspect(img);
                    activeLoadCount--;
                    if (pwLazyObserver) pwLazyObserver.unobserve(img);
                    processImageQueue();
                };
                img.onerror = function() {
                    imgCache.set(realSrc, 'error');
                    activeLoadCount--;
                    if (pwLazyObserver) pwLazyObserver.unobserve(img);
                    if (window.hideBrokenPhotoWallItem) window.hideBrokenPhotoWallItem(photoId, 'image load error');
                    processImageQueue();
                };
            }
        });
        isProcessingQueue = false;
    }

    function pwObserveLazyImages(grid) {
        imageLoadQueue = [];
        if (pwLazyObserver) pwLazyObserver.disconnect();
        if (!window.IntersectionObserver) {
            var fallbackImgs = grid.querySelectorAll('.pw-blur-in');
            for (var i = 0; i < fallbackImgs.length; i++) {
                var img = fallbackImgs[i];
                var src = img.getAttribute('data-src');
                if (src) img.src = src;
                img.onload = function() { this.classList.remove('pw-blur-in'); this.classList.add('pw-blur-done'); applyPhotoAspect(this); };
                img.onerror = function() {
                    var card = this.closest('.photo-wall-item');
                    if (window.hideBrokenPhotoWallItem && card) window.hideBrokenPhotoWallItem(card.getAttribute('data-photo-id'), 'fallback image error');
                };
            }
            return;
        }
        pwLazyObserver = new IntersectionObserver(function(entries) {
            var hasNewEntries = false;
            for (var e = 0; e < entries.length; e++) {
                if (entries[e].isIntersecting) {
                    imageLoadQueue.push(entries[e]);
                    hasNewEntries = true;
                }
            }
            if (hasNewEntries) processImageQueue();
        }, { rootMargin: '500px 0px', threshold: 0.05 });
        var imgs = grid.querySelectorAll('.pw-blur-in');
        for (var j = 0; j < imgs.length; j++) pwLazyObserver.observe(imgs[j]);
    }

    var infiniteScrollObserver = null;
    var isLoadingMore = false;

    function setupInfiniteScroll() {
        if (infiniteScrollObserver) infiniteScrollObserver.disconnect();
        var grid = document.getElementById('photoGrid');
        if (!grid || !window.IntersectionObserver) return;
        var sentinel = document.createElement('div');
        sentinel.className = 'pw-load-more-sentinel';
        sentinel.innerHTML = '<div class="pw-load-more-indicator">加载更多...</div>';
        grid.appendChild(sentinel);
        infiniteScrollObserver = new IntersectionObserver(async function(entries) {
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (entry.isIntersecting && !isLoadingMore && window.hasMorePhotos && window.hasMorePhotos()) {
                    isLoadingMore = true;
                    var indicator = sentinel.querySelector('.pw-load-more-indicator');
                    if (indicator) indicator.textContent = '加载中...';
                    var newPhotos = await window.loadMorePhotos();
                    if (newPhotos && newPhotos.length > 0) {
                        renderPhotoWallWithoutReload();
                    } else if (indicator) {
                        indicator.textContent = '暂无更多';
                    }
                    isLoadingMore = false;
                }
            }
        }, { rootMargin: '400px 0px' });
        infiniteScrollObserver.observe(sentinel);
    }

    function bindPhotoWallScroll() {
        var header = document.querySelector('.photo-wall-header');
        if (header) header.classList.remove('pw-header-hidden');
    }
    window.bindPhotoWallScroll = bindPhotoWallScroll;

    function extractDominantColor(imgSrc, callback) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            try {
                var canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);
                var data = ctx.getImageData(0, 0, 32, 32).data;
                var colorCounts = {};
                for (var i = 0; i < data.length; i += 16) {
                    var r = Math.round(data[i] / 48) * 48;
                    var g = Math.round(data[i + 1] / 48) * 48;
                    var b = Math.round(data[i + 2] / 48) * 48;
                    var key = r + ',' + g + ',' + b;
                    colorCounts[key] = (colorCounts[key] || 0) + 1;
                }
                var maxCount = 0;
                var dominantKey = '0,0,0';
                for (var key in colorCounts) {
                    if (colorCounts[key] > maxCount) {
                        maxCount = colorCounts[key];
                        dominantKey = key;
                    }
                }
                callback(dominantKey);
            } catch(e) {
                callback('0,0,0');
            }
        };
        img.onerror = function() { callback('0,0,0'); };
        img.src = imgSrc;
    }

    function updateAmbientBackground(imgSrc) {
        var bg = document.getElementById('ppAmbientBg');
        if (!bg) return;
        extractDominantColor(imgSrc, function(color) {
            bg.style.background = 'radial-gradient(ellipse at center, rgba(' + color + ',0.35) 0%, rgba(' + color + ',0.08) 50%, transparent 80%)';
        });
    }
    window.updateAmbientBackground = updateAmbientBackground;
})();