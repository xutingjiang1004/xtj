(function() {
    var ppSortedPhotos = [];
    var ppPhotoIdx = -1;
    var ppVw = 0;

    function ppInitTrack() {
        ppVw = window.innerWidth;
        var track = document.getElementById('ppSlideTrack');
        if (track) {
            track.style.width = ppVw * 3 + 'px';
            track.style.height = window.innerHeight + 'px';
            track.style.willChange = 'transform';
            track.style.backfaceVisibility = 'hidden';
        }
    }

    function ppSetTrackImages(idx) {
        var prevImg = document.getElementById('ppPrevImg');
        var curImg = document.getElementById('photoPreviewImage');
        var nextImg = document.getElementById('ppNextImg');
        
        if (ppSortedPhotos[idx]) {
            curImg.src = ppSortedPhotos[idx].imageUrl;
            curImg.style.opacity = '1';
        }
        if (idx > 0 && ppSortedPhotos[idx - 1]) {
            prevImg.src = ppSortedPhotos[idx - 1].imageUrl;
            prevImg.style.opacity = '1';
        } else {
            prevImg.src = '';
            prevImg.style.opacity = '0';
        }
        if (idx < ppSortedPhotos.length - 1 && ppSortedPhotos[idx + 1]) {
            nextImg.src = ppSortedPhotos[idx + 1].imageUrl;
            nextImg.style.opacity = '1';
        } else {
            nextImg.src = '';
            nextImg.style.opacity = '0';
        }
    }

    function ppUpdateInfo(idx) {
        if (!ppSortedPhotos[idx]) return;
        var photo = ppSortedPhotos[idx];
        if (document.getElementById('photoPreviewUser')) {
            document.getElementById('photoPreviewUser').textContent = photo.username || '未知用户';
        }
        if (document.getElementById('photoPreviewTime')) {
            var date = new Date(photo.timestamp);
            document.getElementById('photoPreviewTime').textContent = date.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            });
        }
        if (document.getElementById('photoPreviewViewsCount')) {
            document.getElementById('photoPreviewViewsCount').textContent = photo.views || '0';
        }
    }

    function ppUpdateDots(idx) {
        var dotsEl = document.getElementById('ppDots');
        if (!dotsEl || ppSortedPhotos.length <= 1) {
            if (dotsEl) dotsEl.style.display = 'none';
            return;
        }
        dotsEl.style.display = 'flex';
        var dots = '';
        for (var i = 0; i < ppSortedPhotos.length; i++) {
            dots += '<span class="pp-dot' + (i === idx ? ' active' : '') + '" data-index="' + i + '"></span>';
        }
        dotsEl.innerHTML = dots;
    }

    function ppNavigateTo(idx) {
        if (idx < 0 || idx >= ppSortedPhotos.length) return;
        
        ppPhotoIdx = idx;
        ppUpdateInfo(idx);
        ppUpdateDots(idx);
        
        var track = document.getElementById('ppSlideTrack');
        track.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        track.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        
        setTimeout(function() {
            ppSetTrackImages(idx);
        }, 300);
    }

    window.ppPrevPhoto = function() {
        if (ppPhotoIdx > 0) {
            ppNavigateTo(ppPhotoIdx - 1);
        }
    };

    window.ppNextPhoto = function() {
        if (ppPhotoIdx < ppSortedPhotos.length - 1) {
            ppNavigateTo(ppPhotoIdx + 1);
        }
    };

    window.openPhotoPreview = function(sortedIdx, keepList) {
        if (!keepList) {
            ppSortedPhotos = window.photoWallData ? window.photoWallData.slice().sort(function(a, b) {
                return b.timestamp - a.timestamp;
            }) : [];
        }
        
        if (ppSortedPhotos.length === 0) {
            window.showToast('暂无照片');
            return;
        }
        
        if (sortedIdx < 0) sortedIdx = 0;
        if (sortedIdx >= ppSortedPhotos.length) sortedIdx = ppSortedPhotos.length - 1;
        
        var photo = ppSortedPhotos[sortedIdx];
        if (!photo) return;

        photo.views = (photo.views || 0) + 1;
        if (window.savePhotoWallData) window.savePhotoWallData();

        ppPhotoIdx = sortedIdx;
        ppInitTrack();
        
        var track = document.getElementById('ppSlideTrack');
        if (track) {
            track.style.transition = 'none';
            track.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
        }

        setTimeout(function() {
            ppSetTrackImages(sortedIdx);
            ppUpdateInfo(sortedIdx);
            ppUpdateDots(sortedIdx);
        }, 50);

        var overlay = document.getElementById('photoPreviewOverlay');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        if (window.renderPhotoWall) window.renderPhotoWall();
    };

    window.closePhotoPreview = function() {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    };

    window.showPhotoInfo = function() {
        var photo = ppSortedPhotos[ppPhotoIdx];
        if (!photo) return;
        
        var modal = document.getElementById('ppInfoModal');
        var sizeStr = '未知';
        if (photo.fileSize) {
            var size = photo.fileSize;
            sizeStr = size >= 1024 * 1024 ? (size / (1024 * 1024)).toFixed(2) + ' MB' : (size / 1024).toFixed(1) + ' KB';
        }
        
        if (document.getElementById('ppInfoModalBody')) {
            document.getElementById('ppInfoModalBody').innerHTML = 
                '<div class="pp-info-section"><div class="pp-info-section-title">元数据</div>' +
                '<div class="pp-info-row"><span class="pp-info-label">上传者</span><span class="pp-info-value">' + (photo.username || '未知') + '</span></div>' +
                '<div class="pp-info-row"><span class="pp-info-label">上传时间</span><span class="pp-info-value">' + new Date(photo.timestamp).toLocaleString('zh-CN') + '</span></div>' +
                '<div class="pp-info-row"><span class="pp-info-label">浏览量</span><span class="pp-info-value">' + (photo.views || 0) + ' 次</span></div></div>' +
                '<div class="pp-info-divider"></div>' +
                '<div class="pp-info-section"><div class="pp-info-section-title">文件信息</div>' +
                '<div class="pp-info-row"><span class="pp-info-label">文件大小</span><span class="pp-info-value">' + sizeStr + '</span></div></div>';
        }
        
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(function() { modal.classList.add('active'); }, 10);
        }
    };

    window.closePhotoInfo = function() {
        var modal = document.getElementById('ppInfoModal');
        if (!modal) return;
        if (modal.classList.contains('active')) {
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(function() { 
                modal.classList.remove('closing');
                modal.style.display = 'none'; 
            }, 220);
        } else {
            modal.style.display = 'none';
        }
    };

    window.shareCurrentPhoto = function() {
        var photo = ppSortedPhotos[ppPhotoIdx];
        if (!photo || !photo.imageUrl) return;
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(photo.imageUrl).then(function() {
                if (window.showToast) window.showToast('链接已复制');
            });
        }
    };

    window.deleteCurrentPhoto = function() {
        var photo = ppSortedPhotos[ppPhotoIdx];
        if (!photo) return;
        
        if (!window.currentUser || photo.username !== window.currentUser) {
            if (window.showToast) window.showToast('只能删除自己的照片');
            return;
        }
        
        if (confirm('确定要删除这张照片吗？')) {
            var idx = window.photoWallData.findIndex(function(p) { return p.id === photo.id; });
            if (idx >= 0) {
                window.photoWallData.splice(idx, 1);
                window.savePhotoWallData();
                
                if (window.deletePhotoFromServer) {
                    window.deletePhotoFromServer(photo.id);
                }
                
                closePhotoPreview();
                if (window.renderPhotoWall) window.renderPhotoWall();
                if (window.showToast) window.showToast('删除成功');
            }
        }
    };

    var startX = 0, startY = 0, wasMoved = false;
    var lastTouchEndTime = 0;
    
    document.addEventListener('DOMContentLoaded', function() {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (overlay) {
            overlay.addEventListener('click', function(e) {
                if (!overlay.classList.contains('active')) return;
                
                var now = Date.now();
                if (now - lastTouchEndTime < 300) {
                    return;
                }
                
                var target = e.target;
                var isClickableElement = target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-delete-btn, .pp-info-modal-content');
                
                if (!isClickableElement) {
                    var infoModal = document.getElementById('ppInfoModal');
                    if (infoModal && infoModal.classList.contains('active')) {
                        window.closePhotoInfo();
                    } else {
                        closePhotoPreview();
                    }
                }
            });
        }
        
        var infoModal = document.getElementById('ppInfoModal');
        if (infoModal) {
            infoModal.addEventListener('click', function(e) {
                if (e.target === infoModal) {
                    window.closePhotoInfo();
                }
            });
        }
    });

    document.addEventListener('touchstart', function(e) {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        
        var target = e.target;
        if (target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-delete-btn, .pp-info-modal-content')) {
            return;
        }
        
        var touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        wasMoved = false;
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        
        var target = e.target;
        if (target.closest('.pp-info-modal-content')) {
            return;
        }
        
        var touch = e.touches[0];
        var dx = touch.clientX - startX;
        var dy = touch.clientY - startY;
        
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) wasMoved = true;
        
        if (Math.abs(dx) > 5) {
            var track = document.getElementById('ppSlideTrack');
            if (!track) return;
            
            var resistance = 1;
            if (ppPhotoIdx === 0 && dx > 0) resistance = 2;
            if (ppPhotoIdx === ppSortedPhotos.length - 1 && dx < 0) resistance = 2;
            
            track.style.transition = 'none';
            track.style.transform = 'translate3d(' + (-ppVw + dx / resistance) + 'px, 0, 0)';
        }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        var overlay = document.getElementById('photoPreviewOverlay');
        if (!overlay || !overlay.classList.contains('active')) return;
        
        lastTouchEndTime = Date.now();
        
        var target = e.target;
        if (target.closest('.pp-info-modal-content')) {
            return;
        }
        
        if (wasMoved) {
            var track = document.getElementById('ppSlideTrack');
            var dx = e.changedTouches[0].clientX - startX;
            
            if (Math.abs(dx) > 50) {
                var direction = dx > 0 ? -1 : 1;
                if (direction === -1 && ppPhotoIdx > 0) {
                    ppNavigateTo(ppPhotoIdx - 1);
                } else if (direction === 1 && ppPhotoIdx < ppSortedPhotos.length - 1) {
                    ppNavigateTo(ppPhotoIdx + 1);
                } else {
                    track.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                    track.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
                }
            } else {
                var track = document.getElementById('ppSlideTrack');
                track.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                track.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
            }
        } else {
            var infoModal = document.getElementById('ppInfoModal');
            if (infoModal && infoModal.classList.contains('active')) {
                window.closePhotoInfo();
            } else {
                closePhotoPreview();
            }
        }
        wasMoved = false;
    });
})();