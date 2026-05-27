(function() {
    function formatPhotoTime(ts) {
        var diff = Date.now() - ts;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
        var d = new Date(ts);
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    }
    window.formatPhotoTime = formatPhotoTime;

    var pwPlaceholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Cpath fill="%23ccc" d="M320 340H80c-11 0-20-9-20-20V80c0-11 9-20 20-20h240c11 0 20 9 20 20v240c0 11-9 20-20 20zM280 120h-80v80h-40v-80h-80v-40h80v-80h40v80h80v40z"/%3E%3C/svg%3E';

    function sortPhotoWallData(data, sortKey) {
        var sorted = data.slice();
        switch(sortKey) {
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

    function renderPhotoWallHtml(sorted, startIndex) {
        var html = '';
        var startIdx = startIndex || 0;
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            var timeStr = formatPhotoTime(p.timestamp);
            var name = p.username || '未知用户';
            var gridSrc = p.thumbUrl || p.imageUrl;
            if (!gridSrc) gridSrc = '';
            var escapedGridSrc = gridSrc.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            var actualIndex = startIdx + i;
            html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + window.escapeHtml(String(p.id)) + '" style="animation-delay:' + (actualIndex * 30 < 300 ? actualIndex * 30 : 0) + 'ms" onclick="openPhotoPreview(' + actualIndex + ')">';
            html += '<img src="' + pwPlaceholder + '" alt="photo" class="pw-blur-in" data-src="' + escapedGridSrc + '" loading="lazy">';
            html += '<div class="pw-item-info">';
            html += '<div class="pw-item-name">' + window.escapeHtml(name) + '</div>';
            html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div>';
            html += '</div></div>';
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
        if (!grid) {
            renderLock = false;
            return;
        }

        var skeletonHtml = '';
        for (var s = 0; s < 9; s++) {
            skeletonHtml += '<div class="pw-skeleton"></div>';
        }
        grid.innerHTML = skeletonHtml;

        await window.loadPhotoWallData();

        if (window.photoWallData.length === 0) {
            grid.innerHTML = '<div class="photo-wall-empty">' +
                '<div class="photo-wall-empty-icon">📷</div>' +
                '<div>还没有照片</div>' +
                '<div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">📤 成为第一个分享照片的人</div>' +
                '</div>';
            renderLock = false;
            return;
        }

        var sortKey = window.pwSortKey || 'date_desc';
        var sorted = sortPhotoWallData(window.photoWallData, sortKey);
        window.pwCurrentSortedPhotos = sorted.slice();
        var html = renderPhotoWallHtml(sorted);
        grid.innerHTML = html;

        requestAnimationFrame(function() {
            var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
            items.forEach(function(item, index) {
                setTimeout(function() {
                    item.classList.add('pw-stagger-done');
                    item.classList.remove('pw-stagger-enter');
                }, index * 20);
            });
        });

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

        if (window.photoWallData.length === 0) {
            grid.innerHTML = '<div class="photo-wall-empty">' +
                '<div class="photo-wall-empty-icon">📷</div>' +
                '<div>还没有照片</div>' +
                '<div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">📤 成为第一个分享照片的人</div>' +
                '</div>';
            return;
        }

        var sortKey = window.pwSortKey || 'date_desc';
        var sorted = sortPhotoWallData(window.photoWallData, sortKey);
        window.pwCurrentSortedPhotos = sorted.slice();
        var html = renderPhotoWallHtml(sorted);
        grid.innerHTML = html;

        requestAnimationFrame(function() {
            var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
            items.forEach(function(item, index) {
                setTimeout(function() {
                    item.classList.add('pw-stagger-done');
                    item.classList.remove('pw-stagger-enter');
                }, index * 20);
            });
        });

        pwObserveLazyImages(grid);
    }
    window.renderPhotoWallWithoutReload = renderPhotoWallWithoutReload;

    var pwLazyObserver = null;
    var imageLoadQueue = [];
    var isProcessingQueue = false;
    var imgCache = new Map(); // 图片缓存
    var activeLoadCount = 0;
    var MAX_CONCURRENT_LOADS = 2; // 限制并发加载数

    function processImageQueue() {
        if (isProcessingQueue || imageLoadQueue.length === 0) return;
        if (activeLoadCount >= MAX_CONCURRENT_LOADS) return;
        
        isProcessingQueue = true;

        var batchSize = Math.max(1, MAX_CONCURRENT_LOADS - activeLoadCount);
        var batch = imageLoadQueue.splice(0, batchSize);

        batch.forEach(function(entry) {
            var img = entry.target;
            var realSrc = img.getAttribute('data-src');
            
            if (realSrc) {
                // 检查缓存
                if (imgCache.has(realSrc)) {
                    var cachedState = imgCache.get(realSrc);
                    if (cachedState === 'success') {
                        img.src = realSrc;
                        img.removeAttribute('data-src');
                        img.classList.remove('pw-blur-in');
                        img.classList.add('pw-blur-done');
                        if (pwLazyObserver) pwLazyObserver.unobserve(img);
                        return;
                    }
                }

                activeLoadCount++;
                img.src = realSrc;
                img.removeAttribute('data-src');

                if (img.complete && img.naturalWidth > 0) {
                    imgCache.set(realSrc, 'success');
                    img.classList.remove('pw-blur-in');
                    img.classList.add('pw-blur-done');
                    activeLoadCount--;
                    if (pwLazyObserver) pwLazyObserver.unobserve(img);
                    processImageQueue(); // 继续处理队列
                } else {
                    (function(imgEl, src) {
                        var loadedFn = function() {
                            imgCache.set(src, 'success');
                            imgEl.classList.remove('pw-blur-in');
                            imgEl.classList.add('pw-blur-done');
                            activeLoadCount--;
                            if (pwLazyObserver) pwLazyObserver.unobserve(imgEl);
                            processImageQueue(); // 继续处理队列
                        };
                        var errorFn = function() {
                            imgCache.set(src, 'error');
                            imgEl.classList.remove('pw-blur-in');
                            imgEl.classList.add('pw-blur-done');
                            activeLoadCount--;
                            if (pwLazyObserver) pwLazyObserver.unobserve(imgEl);
                            processImageQueue(); // 继续处理队列
                        };
                        imgEl.onload = loadedFn;
                        imgEl.onerror = errorFn;
                    })(img, realSrc);
                }
            } else {
                img.classList.remove('pw-blur-in');
                img.classList.add('pw-blur-done');
                if (pwLazyObserver) pwLazyObserver.unobserve(img);
            }
        });

        isProcessingQueue = false;
    }

    function pwObserveLazyImages(grid) {
        if (pwLazyObserver) pwLazyObserver.disconnect();

        if (!window.IntersectionObserver) {
            var imgs = grid.querySelectorAll('.pw-blur-in');
            for (var i = 0; i < imgs.length; i++) {
                var img = imgs[i];
                if (img.dataset.src) img.src = img.dataset.src;
                img.classList.remove('pw-blur-in');
                img.classList.add('pw-blur-done');
            }
            return;
        }

        pwLazyObserver = new IntersectionObserver(function(entries) {
            var hasNewEntries = false;
            for (var e = 0; e < entries.length; e++) {
                var entry = entries[e];
                if (entry.isIntersecting) {
                    imageLoadQueue.push(entry);
                    hasNewEntries = true;
                }
            }
            if (hasNewEntries) {
                processImageQueue();
            }
        }, { 
            rootMargin: '200px 0px', // 减少预加载距离
            threshold: 0.05
        });

        var imgs = grid.querySelectorAll('.pw-blur-in');
        for (var j = 0; j < imgs.length; j++) {
            pwLazyObserver.observe(imgs[j]);
        }
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
                if (entry.isIntersecting && !isLoadingMore && window.hasMorePhotos()) {
                    isLoadingMore = true;
                    var indicator = sentinel.querySelector('.pw-load-more-indicator');
                    if (indicator) indicator.textContent = '加载中...';

                    var newPhotos = await window.loadMorePhotos();
                    
                    if (newPhotos && newPhotos.length > 0) {
                        var sortKey = window.pwSortKey || 'date_desc';
                        var sorted = sortPhotoWallData(window.photoWallData, sortKey);
                        var startIdx = sorted.length - newPhotos.length;
                        var newHtml = renderPhotoWallHtml(sorted.slice(startIdx), startIdx);
                        
                        sentinel.insertAdjacentHTML('beforebegin', newHtml);
                        
                        requestAnimationFrame(function() {
                            var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
                            items.forEach(function(item) {
                                item.classList.add('pw-stagger-done');
                                item.classList.remove('pw-stagger-enter');
                            });
                        });
                        
                        pwObserveLazyImages(grid);
                        
                        if (!window.hasMorePhotos()) {
                            if (indicator) indicator.textContent = '没有更多了';
                            infiniteScrollObserver.disconnect();
                        } else {
                            if (indicator) indicator.textContent = '加载更多...';
                        }
                    } else {
                        if (indicator) indicator.textContent = '加载失败';
                        setTimeout(function() {
                            if (indicator && window.hasMorePhotos()) {
                                indicator.textContent = '加载更多...';
                            }
                        }, 2000);
                    }
                    
                    isLoadingMore = false;
                }
            }
        }, { rootMargin: '400px 0px' });

        infiniteScrollObserver.observe(sentinel);
    }

    var pwLastScroll = 0;
    var pwScrollThreshold = 20;
    function bindPhotoWallScroll() {
        var header = document.querySelector('.photo-wall-header');
        if (header) {
            header.classList.remove('pw-header-hidden');
        }
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
