const fs = require('fs');
const path = 'c:\\Users\\Administrator\\Desktop\\最新index\\xtj\\index.html';
let content = fs.readFileSync(path, 'utf-8');

// ============================================================
// 1. Add photo wall CSS before </style>
// ============================================================
const photoWallCSS = `
        /* ========== 照片墙样式 ========== */
        .photo-wall-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            padding: 12px 0;
        }
        .photo-wall-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 4px 16px;
            flex-shrink: 0;
        }
        .photo-wall-title {
            font-size: 18px;
            font-weight: 700;
            color: var(--text-main);
        }
        .photo-wall-upload-btn {
            padding: 8px 20px;
            border-radius: 999px;
            border: none;
            background: linear-gradient(135deg, #059669, #34d399);
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s ease;
            box-shadow: 0 2px 12px rgba(5, 150, 105, 0.3);
        }
        .photo-wall-upload-btn:hover {
            transform: scale(1.03);
            box-shadow: 0 4px 16px rgba(5, 150, 105, 0.4);
        }
        .photo-wall-upload-btn:active {
            transform: scale(0.97);
        }
        .photo-wall-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 4px;
            flex: 1;
            align-content: start;
        }
        .photo-wall-item {
            position: relative;
            aspect-ratio: 1;
            overflow: hidden;
            border-radius: 6px;
            cursor: pointer;
            background: rgba(255,255,255,0.05);
            transition: transform 0.2s ease;
        }
        .photo-wall-item:hover {
            transform: scale(1.03);
            z-index: 2;
        }
        .photo-wall-item:active {
            transform: scale(0.97);
        }
        .photo-wall-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .photo-wall-item .pw-item-info {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 20px 6px 6px;
            background: linear-gradient(transparent, rgba(0,0,0,0.7));
            opacity: 0;
            transition: opacity 0.25s ease;
        }
        .photo-wall-item:hover .pw-item-info {
            opacity: 1;
        }
        .pw-item-info .pw-item-name {
            color: white;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .pw-item-info .pw-item-meta {
            color: rgba(255,255,255,0.7);
            font-size: 10px;
            display: flex;
            justify-content: space-between;
        }
        .photo-wall-empty {
            grid-column: 1 / -1;
            text-align: center;
            padding: 60px 20px;
            color: var(--text-muted);
            font-size: 15px;
        }
        .photo-wall-empty-icon {
            font-size: 48px;
            margin-bottom: 12px;
            opacity: 0.5;
        }

        /* 全屏预览 */
        .photo-preview-overlay {
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: rgba(0, 0, 0, 0.95);
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
            animation: fadeIn 0.2s ease;
        }
        .photo-preview-overlay.active {
            display: flex;
        }
        .photo-preview-close {
            position: absolute;
            top: calc(20px + env(safe-area-inset-top, 0px));
            right: calc(20px + env(safe-area-inset-right, 0px));
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(255,255,255,0.15);
            color: white;
            font-size: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
            line-height: 1;
        }
        .photo-preview-close:hover {
            background: rgba(255,255,255,0.25);
            transform: rotate(90deg);
        }
        .photo-preview-image-wrapper {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            width: 100%;
            max-height: calc(100vh - 100px);
        }
        .photo-preview-image-wrapper img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            border-radius: 8px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.5);
        }
        .photo-preview-info {
            display: flex;
            align-items: center;
            gap: 20px;
            padding: 16px 0 0;
            color: rgba(255,255,255,0.8);
            font-size: 14px;
            flex-shrink: 0;
            flex-wrap: wrap;
            justify-content: center;
        }
        .photo-preview-info .pp-user {
            font-weight: 600;
            color: white;
        }
        .photo-preview-info .pp-time {
            color: rgba(255,255,255,0.5);
            font-size: 13px;
        }
        .photo-preview-info .pp-views {
            color: rgba(255,255,255,0.5);
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        [data-theme="dark"] .photo-wall-item {
            background: rgba(255,255,255,0.03);
        }
`;

const styleEndIdx = content.indexOf('</style>');
if (styleEndIdx >= 0) {
    content = content.slice(0, styleEndIdx) + photoWallCSS + '\n    ' + content.slice(styleEndIdx);
    console.log('1. Photo wall CSS added before </style>');
} else {
    console.error('ERROR: </style> not found');
}

// ============================================================
// 2. Replace vocab HTML with photo wall HTML inside panelAi
// ============================================================
const panelAiStart = content.indexOf('<div class="dock-panel" id="panelAi">');
const panelAiEnd = content.indexOf('<div class="dock-panel" id="panelProfile">');

if (panelAiStart >= 0 && panelAiEnd > panelAiStart) {
    const panelAiOpen = content.indexOf('>', panelAiStart) + 1;
    const panelProfileOpen = content.indexOf('>', panelAiEnd) + 1;

    // Find the start of the vocab container (after panelAi opening tag)
    const vocabStart = content.indexOf('<div class="vocab-container"', panelAiStart);
    // Find where panelProfile starts
    const panelProfileStart = content.indexOf('<div class="dock-panel" id="panelProfile">', vocabStart);

    if (vocabStart >= 0 && panelProfileStart > vocabStart) {
        const newPhotoWallHTML = `            <div class="photo-wall-container" id="photoWallContainer">
                <div class="photo-wall-header">
                    <div class="photo-wall-title">\u{1F4F7} 照片墙</div>
                    <button class="photo-wall-upload-btn" id="photoUploadBtn" onclick="triggerPhotoUpload()">\u{1F4E4} 上传照片</button>
                </div>
                <div class="photo-wall-grid" id="photoGrid"></div>
                <input type="file" id="photoFileInput" accept="image/*" style="display:none">

                <div class="photo-preview-overlay" id="photoPreviewOverlay">
                    <button class="photo-preview-close" onclick="closePhotoPreview()">&times;</button>
                    <div class="photo-preview-image-wrapper">
                        <img id="photoPreviewImage" src="" alt="preview">
                    </div>
                    <div class="photo-preview-info">
                        <span class="pp-user" id="photoPreviewUser"></span>
                        <span class="pp-time" id="photoPreviewTime"></span>
                        <span class="pp-views" id="photoPreviewViews">\u{1F441} <span id="photoPreviewViewsCount">0</span></span>
                    </div>
                </div>
            </div>`;

        const beforeHTML = content.substring(0, vocabStart);
        const afterHTML = content.substring(panelProfileStart);
        content = beforeHTML + newPhotoWallHTML + '\n        ' + afterHTML;
        console.log('2. Vocab HTML replaced with photo wall HTML');
    } else {
        console.error('ERROR: Could not find vocab container or panelProfile boundaries');
    }
} else {
    console.error('ERROR: Could not find panelAi or panelProfile');
}

// ============================================================
// 3. Replace vocab JS with photo wall JS
// ============================================================
// Find the vocab JS section: from "function initVocabQueue" to "document.addEventListener('DOMContentLoaded', function() {"
const jsVocabStart = content.indexOf('function initVocabQueue()');
const jsVocabEnd = content.indexOf("document.addEventListener('DOMContentLoaded', function()", jsVocabStart);

if (jsVocabStart >= 0 && jsVocabEnd > jsVocabStart) {
    // Find the end of the DOMContentLoaded block
    const afterDOMLoaded = content.indexOf("\n        })();", jsVocabEnd);
    let actualEnd = jsVocabEnd;
    if (afterDOMLoaded >= 0 && afterDOMLoaded < jsVocabStart + 100000) {
        actualEnd = afterDOMLoaded + "\n        })();".length;
    } else {
        // Fallback: find the closing of the surrounding IIFE
        const iifeEnd = content.indexOf("\n        })();", jsVocabStart);
        if (iifeEnd > jsVocabStart && iifeEnd < jsVocabStart + 100000) {
            actualEnd = iifeEnd + "\n        })();".length;
        }
    }

    const photoWallJS = `
            // ========== 照片墙功能 ==========
            var photoWallData = [];
            var photoWallKey = 'xtj_photos';

            function loadPhotoWallData() {
                try {
                    var saved = localStorage.getItem(photoWallKey);
                    photoWallData = saved ? JSON.parse(saved) : [];
                } catch(e) {
                    photoWallData = [];
                }
            }

            function savePhotoWallData() {
                localStorage.setItem(photoWallKey, JSON.stringify(photoWallData));
            }

            function renderPhotoWall() {
                var grid = document.getElementById('photoGrid');
                if (!grid) return;
                loadPhotoWallData();

                if (photoWallData.length === 0) {
                    grid.innerHTML = '<div class="photo-wall-empty"><div class="photo-wall-empty-icon">\u{1F4F7}</div>还没有照片，快来上传第一张吧</div>';
                    return;
                }

                // Sort by time descending (newest first)
                var sorted = photoWallData.slice().sort(function(a, b) {
                    return b.timestamp - a.timestamp;
                });

                var html = '';
                for (var i = 0; i < sorted.length; i++) {
                    var p = sorted[i];
                    var timeStr = formatPhotoTime(p.timestamp);
                    var name = p.username || '\u672A\u77E5\u7528\u6237';
                    html += '<div class="photo-wall-item" onclick="openPhotoPreview(' + i + ')">';
                    html += '<img src="' + p.imageUrl + '" alt="photo" loading="lazy">';
                    html += '<div class="pw-item-info">';
                    html += '<div class="pw-item-name">' + escapeHtml(name) + '</div>';
                    html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>\u{1F441} ' + p.views + '</span></div>';
                    html += '</div></div>';
                }
                grid.innerHTML = html;
            }

            function formatPhotoTime(ts) {
                var diff = Date.now() - ts;
                if (diff < 60000) return '\u521A\u521A';
                if (diff < 3600000) return Math.floor(diff / 60000) + ' \u5206\u949F\u524D';
                if (diff < 86400000) return Math.floor(diff / 3600000) + ' \u5C0F\u65F6\u524D';
                var d = new Date(ts);
                return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
            }

            function escapeHtml(str) {
                var div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            }

            window.triggerPhotoUpload = function() {
                if (!currentUser) {
                    showToast('\u8BF7\u5148\u767B\u5F55');
                    return;
                }
                document.getElementById('photoFileInput').click();
            };

            window.handlePhotoUpload = function(e) {
                var file = e.target.files && e.target.files[0];
                if (!file) return;
                if (!currentUser) {
                    showToast('\u8BF7\u5148\u767B\u5F55');
                    return;
                }
                if (file.size > 20 * 1024 * 1024) {
                    showToast('\u56FE\u7247\u8D85\u8FC7 20MB \u9650\u5236');
                    return;
                }
                var reader = new FileReader();
                reader.onload = function(ev) {
                    var dataUrl = ev.target.result;
                    loadPhotoWallData();
                    var photo = {
                        id: Date.now(),
                        username: currentUser,
                        imageUrl: dataUrl,
                        timestamp: Date.now(),
                        views: 0
                    };
                    photoWallData.push(photo);
                    savePhotoWallData();
                    renderPhotoWall();
                    showToast('\u4E0A\u4F20\u6210\u529F');
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            };

            function getPhotoIndexInSorted(idx) {
                var sorted = photoWallData.slice().sort(function(a, b) {
                    return b.timestamp - a.timestamp;
                });
                return sorted[idx];
            }

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
                    track.style.perspective = '1000px';
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
                document.getElementById('photoPreviewUser').textContent = photo.username || '未知用户';
                document.getElementById('photoPreviewTime').textContent = formatPhotoTime(photo.timestamp);
                document.getElementById('photoPreviewViewsCount').textContent = photo.views || '0';
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

            window.openPhotoPreview = function(sortedIdx) {
                ppSortedPhotos = photoWallData.slice().sort(function(a, b) {
                    return b.timestamp - a.timestamp;
                });
                
                var photo = ppSortedPhotos[sortedIdx];
                if (!photo) return;

                photo.views = (photo.views || 0) + 1;
                savePhotoWallData();

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

                document.getElementById('photoPreviewOverlay').classList.add('active');
                document.body.style.overflow = 'hidden';
                renderPhotoWall();
            };

            window.closePhotoPreview = function() {
                document.getElementById('photoPreviewOverlay').classList.remove('active');
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
                
                document.getElementById('ppInfoModalBody').innerHTML = 
                    '<div class="pp-info-section"><div class="pp-info-section-title">元数据</div>' +
                    '<div class="pp-info-row"><span class="pp-info-label">上传者</span><span class="pp-info-value">' + (photo.username || '未知') + '</span></div>' +
                    '<div class="pp-info-row"><span class="pp-info-label">上传时间</span><span class="pp-info-value">' + new Date(photo.timestamp).toLocaleString('zh-CN') + '</span></div>' +
                    '<div class="pp-info-row"><span class="pp-info-label">浏览量</span><span class="pp-info-value">' + (photo.views || 0) + ' 次</span></div></div>' +
                    '<div class="pp-info-divider"></div>' +
                    '<div class="pp-info-section"><div class="pp-info-section-title">文件信息</div>' +
                    '<div class="pp-info-row"><span class="pp-info-label">文件大小</span><span class="pp-info-value">' + sizeStr + '</span></div></div>';
                
                modal.style.display = 'flex';
                setTimeout(function() { modal.classList.add('active'); }, 10);
            };

            window.closePhotoInfo = function() {
                var modal = document.getElementById('ppInfoModal');
                modal.classList.remove('active');
                setTimeout(function() { modal.style.display = 'none'; }, 220);
            };

            window.shareCurrentPhoto = function() {
                var photo = ppSortedPhotos[ppPhotoIdx];
                if (!photo || !photo.imageUrl) return;
                
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(photo.imageUrl).then(function() {
                        window.showToast('链接已复制');
                    });
                }
            };

            var startX = 0, startY = 0, wasMoved = false;
            
            document.getElementById('photoPreviewOverlay').addEventListener('click', function(e) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay.classList.contains('active')) return;
                
                var target = e.target;
                if (target.classList.contains('photo-preview-overlay')) {
                    closePhotoPreview();
                }
            });
            
            document.getElementById('ppInfoModal').addEventListener('click', function(e) {
                var modal = document.getElementById('ppInfoModal');
                if (e.target === modal) {
                    window.closePhotoInfo();
                }
            });

            document.addEventListener('touchstart', function(e) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay || !overlay.classList.contains('active')) return;
                
                var target = e.target;
                if (target.closest('.photo-preview-close, .pp-nav-arrow, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-info-modal')) {
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
                
                var touch = e.touches[0];
                var dx = touch.clientX - startX;
                
                if (Math.abs(dx) > 5) wasMoved = true;
                
                var track = document.getElementById('ppSlideTrack');
                if (!track) return;
                
                var resistance = 1;
                if (ppPhotoIdx === 0 && dx > 0) resistance = 2;
                if (ppPhotoIdx === ppSortedPhotos.length - 1 && dx < 0) resistance = 2;
                
                track.style.transition = 'none';
                track.style.transform = 'translate3d(' + (-ppVw + dx / resistance) + 'px, 0, 0)';
            }, { passive: true });

            document.addEventListener('touchend', function(e) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay || !overlay.classList.contains('active')) return;
                
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
                        track.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                        track.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
                    }
                } else {
                    var modal = document.getElementById('ppInfoModal');
                    if (modal.style.display === 'flex') {
                        window.closePhotoInfo();
                    } else {
                        closePhotoPreview();
                    }
                }
                wasMoved = false;
            });

            function initPhotoWall() {
                loadPhotoWallData();
                renderPhotoWall();
            }
            window.initPhotoWall = initPhotoWall;

            // Listen for file input changes
            document.addEventListener('change', function(e) {
                if (e.target && e.target.id === 'photoFileInput') {
                    window.handlePhotoUpload(e);
                }
            });

`;

        const beforeJS = content.substring(0, jsVocabStart);
        const afterJS = content.substring(actualEnd);
        content = beforeJS + photoWallJS + afterJS;
        console.log('3. Vocab JS replaced with photo wall JS');
    } else {
        console.error('ERROR: Could not find vocab JS section');
    }

// ============================================================
// 4. Update switchDockTab to call initPhotoWall instead of initVocabQuiz
// ============================================================
const oldDockCall = "if (tab === 'ai') { initVocabQuiz(); }";
const newDockCall = "if (tab === 'ai') { initPhotoWall(); }";
if (content.indexOf(oldDockCall) >= 0) {
    content = content.split(oldDockCall).join(newDockCall);
    console.log('4. switchDockTab updated to call initPhotoWall');
} else {
    console.error('ERROR: Could not find switchDockTab vocab call');
}

// Also update the DOMContentLoaded listener reference
const oldDOMRef = "if (document.getElementById('vocabContainer'))";
const newDOMRef = "if (document.getElementById('photoWallContainer'))";
if (content.indexOf(oldDOMRef) >= 0) {
    content = content.split(oldDOMRef).join(newDOMRef);
    console.log('4b. DOMContentLoaded reference updated');
}

// Clean up any remaining vocab-container references in non-comment code
// (the vocab-container no longer exists in HTML)

// ============================================================
// 5. Remove English and Korean language options
// ============================================================

// 5a. Remove en and ko from language tabs in HTML
const langTabHTML = '<div class="profile-lang-tabs">\n                            <button class="profile-lang-tab" data-lang="zh" onclick="setProfileLang(\'zh\')">\u4E2D\u6587</button>\n                            <button class="profile-lang-tab" data-lang="en" onclick="setProfileLang(\'en\')">English</button>\n                            <button class="profile-lang-tab" data-lang="ko" onclick="setProfileLang(\'ko\')">\uD55C\uAD6D\uC5B4</button>\n                        </div>\n                        <select id="profileLang" style="display:none;">\n                            <option value="zh">\u4E2D\u6587</option>\n                            <option value="en">English</option>\n                            <option value="ko">\uD55C\uAD6D\uC5B4</option>\n                        </select>';

const newLangHTML = '<div class="profile-lang-tabs">\n                            <button class="profile-lang-tab active" data-lang="zh" onclick="setProfileLang(\'zh\')">\u4E2D\u6587</button>\n                        </div>\n                        <select id="profileLang" style="display:none;">\n                            <option value="zh">\u4E2D\u6587</option>\n                        </select>';

if (content.indexOf(langTabHTML) >= 0) {
    content = content.split(langTabHTML).join(newLangHTML);
    console.log('5a. Language tabs reduced to only Chinese');
} else {
    console.log('5a. WARNING: Could not find exact lang tab HTML, trying alternative...');
    // Try to find a shorter unique segment
    const profileLangSection = content.indexOf('profile-lang-tabs');
    if (profileLangSection >= 0) {
        // Find the containing setting-item div
        const settingStart = content.lastIndexOf('<div class="profile-setting-item"', profileLangSection);
        const settingEnd = content.indexOf('</div>', content.indexOf('profileLang', settingStart));
        if (settingStart >= 0 && settingEnd > settingStart) {
            const fullSetting = content.substring(settingStart, settingEnd + 6);
            const simplifiedSetting = fullSetting
                .replace(/<button class="profile-lang-tab" data-lang="en"[^>]*>.*?<\/button>/g, '')
                .replace(/<button class="profile-lang-tab" data-lang="ko"[^>]*>.*?<\/button>/g, '')
                .replace(/<option value="en">.*?<\/option>/g, '')
                .replace(/<option value="ko">.*?<\/option>/g, '');
            content = content.substring(0, settingStart) + simplifiedSetting + content.substring(settingEnd + 6);
            console.log('5a. Language tabs reduced (alternative method)');
        }
    }
}

// 5b. Remove en and ko from translations object
const enStart = content.indexOf("en: {");
const koStart = content.indexOf("ko: {");

// Find and remove 'en' translations section
if (enStart >= 0) {
    // Find the end of en section (the next top-level key or closing brace of parent)
    const koOrEnd = content.indexOf("ko: {", enStart);
    const parentEnd = content.indexOf("};", enStart);
    let enEnd = -1;
    if (koOrEnd > enStart && koOrEnd < parentEnd + 10) {
        // Find where ko starts - go backwards to find the closing of en
        enEnd = content.lastIndexOf("},", koOrEnd - 1);
        if (enEnd < enStart) enEnd = -1;
    }
    if (enEnd < enStart) {
        // Try finding the en section between braces
        const openBrace = content.indexOf('{', enStart);
        let depth = 1;
        let pos = openBrace + 1;
        while (depth > 0 && pos < content.length) {
            if (content[pos] === '{') depth++;
            else if (content[pos] === '}') depth--;
            pos++;
        }
        enEnd = pos;
    }
    if (enEnd > enStart) {
        content = content.substring(0, enStart) + content.substring(enEnd);
        console.log('5b. English translations removed');
    }
}

// Find and remove 'ko' translations section
const koStart2 = content.indexOf("ko: {");
if (koStart2 >= 0) {
    const openBrace = content.indexOf('{', koStart2);
    let depth = 1;
    let pos = openBrace + 1;
    while (depth > 0 && pos < content.length) {
        if (content[pos] === '{') depth++;
        else if (content[pos] === '}') depth--;
        pos++;
    }
    const koEnd = pos;
    if (koEnd > koStart2) {
        content = content.substring(0, koStart2) + content.substring(koEnd);
        console.log('5c. Korean translations removed');
    }
}

// Clean up trailing commas in translations object
content = content.replace(/,(\s*\n\s*};)/g, '$1');

// ============================================================
// 6. Clean up - remove any remaining references to vocab-list variable
// ============================================================
// Remove the vocabList and related data array
const vocabListStart = content.indexOf("var vocabList = [");
const vocabListEnd = content.indexOf("];", vocabListStart);
if (vocabListStart >= 0 && vocabListEnd > vocabListStart && vocabListEnd - vocabListStart < 500000) {
    // Check that it's not already been replaced
    const beforeRemove = content.substring(0, vocabListStart);
    const afterRemove = content.substring(vocabListEnd + 2);
    content = beforeRemove + '\n            var vocabList = []; // emptied\n            ' + afterRemove;
    console.log('6. vocabList emptied');
}

// Remove any stray vocab variable declarations (vocabMode, vocabCorrect, etc.)
// These are inside the IIFE so they're scoped anyway, but let's clean them
const varDeclarations = [
    'var vocabMode =',
    'var vocabCorrect =',
    'var vocabWrong =',
    'var vocabTotalAnswered =',
    'var currentVocabIndex =',
    'var currentVocabObj =',
    'var currentOptions =',
    'var isAnswered =',
    'var vocabQueue =',
    'var vocabQueueIndex =',
    'var vocabList ='
];

// Just nullify the variables that are still used
for (const decl of varDeclarations) {
    const idx = content.indexOf(decl);
    if (idx >= 0) {
        const lineEnd = content.indexOf('\n', idx);
        if (lineEnd > idx) {
            const line = content.substring(idx, lineEnd);
            content = content.substring(0, idx) + '// ' + line + content.substring(lineEnd);
            console.log('6b. Commented out: ' + decl);
        }
    }
}

// ============================================================
// Write the file
// ============================================================
fs.writeFileSync(path, content, 'utf-8');
console.log('\n=== ALL CHANGES COMPLETE ===');
