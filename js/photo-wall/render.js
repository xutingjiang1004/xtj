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

    async function renderPhotoWall() {
        var grid = document.getElementById('photoGrid');
        if (!grid) return;

        var skeletonHtml = '';
        for (var s = 0; s < 6; s++) {
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
            return;
        }

        var sorted = window.photoWallData.slice();
        if (typeof window.pwApplySort === 'function') {
            sorted = window.pwApplySort(sorted, window.pwSortKey || 'date_desc');
        } else {
            sorted.sort(function(a, b) { return b.timestamp - a.timestamp; });
        }

        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            var timeStr = formatPhotoTime(p.timestamp);
            var name = p.username || '未知用户';
            html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + window.escapeHtml(p.id) + '" style="animation-delay:' + (i * 50) + 'ms" onclick="openPhotoPreview(' + i + ')">';
            var gridSrc = p.thumbUrl || p.imageUrl;
            html += '<img src="' + gridSrc + '" alt="photo" class="pw-blur-in" data-src="' + gridSrc + '">';
            html += '<div class="pw-item-info">';
            html += '<div class="pw-item-name">' + window.escapeHtml(name) + '</div>';
            html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div>';
            html += '</div></div>';
        }
        grid.innerHTML = html;

        requestAnimationFrame(function() {
            var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
            items.forEach(function(item, idx) {
                setTimeout(function() {
                    item.classList.add('pw-stagger-done');
                    item.classList.remove('pw-stagger-enter');
                }, idx * 50);
            });
        });

        pwObserveLazyImages(grid);
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

        var sorted = window.photoWallData.slice().sort(function(a, b) {
            return b.timestamp - a.timestamp;
        });

        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i];
            var timeStr = formatPhotoTime(p.timestamp);
            var name = p.username || '未知用户';
            html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + window.escapeHtml(p.id) + '" style="animation-delay:' + (i * 50) + 'ms" onclick="openPhotoPreview(' + i + ')">';
            var gridSrc = p.thumbUrl || p.imageUrl;
            html += '<img src="' + gridSrc + '" alt="photo" class="pw-blur-in" data-src="' + gridSrc + '">';
            html += '<div class="pw-item-info">';
            html += '<div class="pw-item-name">' + window.escapeHtml(name) + '</div>';
            html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div>';
            html += '</div></div>';
        }
        grid.innerHTML = html;

        requestAnimationFrame(function() {
            var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
            items.forEach(function(item, idx) {
                setTimeout(function() {
                    item.classList.add('pw-stagger-done');
                    item.classList.remove('pw-stagger-enter');
                }, 0);
            });
        });

        pwObserveLazyImages(grid);
    }
    window.renderPhotoWallWithoutReload = renderPhotoWallWithoutReload;

    var pwLazyObserver = null;
    function pwObserveLazyImages(grid) {
        if (pwLazyObserver) pwLazyObserver.disconnect();
        if (!window.IntersectionObserver) {
            var imgs = grid.querySelectorAll('.pw-blur-in');
            for (var i = 0; i < imgs.length; i++) {
                imgs[i].classList.remove('pw-blur-in');
                imgs[i].classList.add('pw-blur-done');
            }
            return;
        }
        pwLazyObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    var img = entry.target;
                    img.classList.remove('pw-blur-in');
                    img.classList.add('pw-blur-done');
                    pwLazyObserver.unobserve(img);
                }
            });
        }, { rootMargin: '200px' });
        var imgs = grid.querySelectorAll('.pw-blur-in');
        for (var j = 0; j < imgs.length; j++) {
            pwLazyObserver.observe(imgs[j]);
        }
    }

    var pwLastScroll = 0;
    var pwScrollThreshold = 20;
    function bindPhotoWallScroll() {
        var panelAi = document.getElementById('panelAi');
        if (!panelAi) return;
        panelAi.addEventListener('scroll', function() {
            var header = document.querySelector('.photo-wall-header');
            if (!header) return;
            var currentScroll = panelAi.scrollTop;
            var diff = currentScroll - pwLastScroll;
            if (Math.abs(diff) < 5) { pwLastScroll = currentScroll; return; }
            if (diff > 0 && currentScroll > pwScrollThreshold) {
                header.classList.add('pw-header-hidden');
            } else if (diff < 0) {
                header.classList.remove('pw-header-hidden');
            }
            if (currentScroll <= pwScrollThreshold) {
                header.classList.remove('pw-header-hidden');
            }
            pwLastScroll = currentScroll;
        }, { passive: true });
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
