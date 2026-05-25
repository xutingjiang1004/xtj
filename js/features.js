(function() {
            function calcPathLengths() {
                // Button 1: Post drawing path length
                var pathEl = document.querySelector('.dock-tab[data-tab="posts"] .al-path');
                if (pathEl && typeof pathEl.getTotalLength === 'function') {
                    var len = Math.round(pathEl.getTotalLength());
                    pathEl.style.setProperty('--path-len', len);
                }
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', calcPathLengths);
            } else {
                calcPathLengths();
            }
        })();

(function() {
            // 同步用户信息到我的页面
            window.syncProfileUser = function() {
                var nameEl = document.getElementById('profileName');
                var avatarEl = document.getElementById('profileAvatar');
                var nameSpan = document.getElementById('myName');
                var avatarSpan = document.getElementById('myAvatar');
                if (nameSpan && nameEl) {
                    nameEl.textContent = nameSpan.textContent || '未登录';
                }
                if (avatarSpan && avatarEl) {
                    avatarEl.innerHTML = avatarSpan.innerHTML || '?';
                }
            };

            // 初始化主题开关
            var themeToggle = document.getElementById('profileThemeToggle');
            if (themeToggle) {
                themeToggle.checked = document.documentElement.getAttribute('data-theme') === 'dark';
                themeToggle.addEventListener('change', function() {
                    var isDark = this.checked;
                    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
                    localStorage.setItem('xtj-theme', isDark ? 'dark' : 'light');
                    var topToggle = document.getElementById('themeToggle');
                    if (topToggle) topToggle.textContent = isDark ? '🌙' : '☀️';
                });
            }

            // 初始化通知开关
            var notifToggle = document.getElementById('profileNotifToggle');
            if (notifToggle) {
                notifToggle.checked = localStorage.getItem('xtj-notif') !== 'off';
                notifToggle.addEventListener('change', function() {
                    localStorage.setItem('xtj-notif', this.checked ? 'on' : 'off');
                });
            }
        })();

(function() {
        // ================================================================
        // 模块1：用户管理与内容安全模块
        // ================================================================

        // ---------- 举报功能 ----------
        var reportTarget = null;

        window.openReport = function(targetType, targetId, targetUser) {
            if (!window.currentUser) { showToast('请先登录'); return; }
            reportTarget = { targetType: targetType, targetId: targetId, targetUser: targetUser || '' };
            document.getElementById('reportCategory').value = 'spam';
            document.getElementById('reportReason').value = '';
            document.getElementById('reportEvidenceInput').value = '';
            document.getElementById('reportEvidencePreview').textContent = '';
            document.getElementById('reportModal').style.display = 'flex';
        };

        document.getElementById('reportEvidenceInput').addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            var preview = document.getElementById('reportEvidencePreview');
            if (file) {
                preview.textContent = '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)';
            } else {
                preview.textContent = '';
            }
        });

        window.submitReport = async function() {
            if (!reportTarget) { showToast('举报目标丢失，请重试'); return; }
            if (!window.currentUser) { showToast('请先登录'); return; }
            var category = document.getElementById('reportCategory').value;
            var reason = document.getElementById('reportReason').value.trim();
            if (!reason) { showToast('请填写举报理由'); return; }

            var evidenceUrl = '';
            var evidenceFile = document.getElementById('reportEvidenceInput').files && document.getElementById('reportEvidenceInput').files[0];
            if (evidenceFile) {
                try {
                    var sb = window.sb;
                    if (sb && sb.storage) {
                        var path = 'reports/' + Date.now() + '_' + evidenceFile.name;
                        var { error: upErr } = await sb.storage.from('uploads').upload(path, evidenceFile);
                        if (!upErr) {
                            evidenceUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                        }
                    }
                } catch(e) { /* evidence upload optional */ }
            }

            var btn = document.getElementById('reportSubmitBtn');
            btn.disabled = true;
            btn.textContent = '提交中...';
            try {
                var sb = window.sb;
                if (!sb) { showToast('系统未就绪'); btn.disabled = false; btn.textContent = '提交举报'; return; }
                var { error } = await sb.from('reports').insert([{
                    reporter_name: window.currentUser,
                    target_type: reportTarget.targetType,
                    target_id: reportTarget.targetId,
                    target_user: reportTarget.targetUser,
                    report_category: category,
                    report_reason: reason,
                    evidence_url: evidenceUrl,
                    status: 'pending'
                }]);
                if (error) { showToast('举报提交失败: ' + error.message); btn.disabled = false; btn.textContent = '提交举报'; return; }
                showToast('举报已提交，管理员会尽快处理');
                closeModal('reportModal');
            } catch(e) { showToast('举报提交失败'); }
            btn.disabled = false;
            btn.textContent = '提交举报';
        };

        // ---------- 封禁/黑名单检查 ----------
        async function checkUserBanStatus(userName) {
            try {
                var sb = window.sb;
                if (!sb) return false;
                var { data: banData } = await sb.from('bans').select('*').eq('user_name', userName).eq('is_active', true).maybeSingle();
                if (banData) {
                    if (banData.ban_type === 'permanent') {
                        showToast('账号已被永久封禁。原因: ' + (banData.ban_reason || '违反社区规定'));
                        return true;
                    }
                    if (banData.expires_at && new Date(banData.expires_at) > new Date()) {
                        var hours = Math.ceil((new Date(banData.expires_at) - new Date()) / 3600000);
                        showToast('账号已被临时封禁，剩余 ' + hours + ' 小时。原因: ' + (banData.ban_reason || '违反社区规定'));
                        return true;
                    }
                    if (banData.expires_at && new Date(banData.expires_at) <= new Date()) {
                        await sb.from('bans').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: 'system' }).eq('id', banData.id);
                    }
                }
                var { data: blData } = await sb.from('blacklist').select('*').eq('user_name', userName).maybeSingle();
                if (blData) {
                    showToast('账号已被加入黑名单，无法登录系统');
                    return true;
                }
            } catch(e) { /* silent */ }
            return false;
        }

        // Hook into login - after successful login, check ban status
        var _origDoLogin = window.doLogin;
        if (_origDoLogin) {
            var _loginWrapper = async function() {
                await _origDoLogin.apply(this, arguments);
                if (window.currentUser) {
                    setTimeout(async function() {
                        var banned = await checkUserBanStatus(window.currentUser);
                        if (banned) {
                            localStorage.removeItem('xtj_user');
                            window.currentUser = null;
                            showToast('账号已被限制登录');
                            setTimeout(function() { location.reload(); }, 2000);
                        }
                    }, 500);
                }
            };
            // Enhance doLogin to check ban after success
            var origDoLoginFn = window.doLogin;
            window.doLogin = async function() {
                var name = document.getElementById('loginNickInp') ? document.getElementById('loginNickInp').value.trim() : '';
                // Check before login attempt too
                if (name) {
                    var banned = await checkUserBanStatus(name);
                    if (banned) {
                        var btn = document.getElementById('loginSubmitBtn');
                        if (btn) { btn.disabled = false; btn.textContent = '登录'; }
                        return;
                    }
                }
                await origDoLoginFn.apply(this, arguments);
            };
        }

        // ================================================================
        // 模块2：照片墙功能增强
        // ================================================================

        var pwAlbumViewActive = false;
        var pwCurrentSort = 'date_desc';
        var pwBatchUploading = false;

        // ---------- 相册视图切换 ----------
        window.toggleAlbumView = function() {
            pwAlbumViewActive = !pwAlbumViewActive;
            var btn = document.getElementById('pwAlbumToggle');
            var container = document.getElementById('pwAlbumContainer');
            var grid = document.getElementById('photoGrid');
            if (pwAlbumViewActive) {
                btn.classList.add('active');
                btn.textContent = '📷 网格';
                container.style.display = 'block';
                grid.style.display = 'none';
                renderAlbumView();
            } else {
                btn.classList.remove('active');
                btn.textContent = '📁 相册';
                container.style.display = 'none';
                grid.style.display = '';
                renderPhotoWall();
            }
        };

        // ---------- 排序切换 ----------
        window.switchPhotoWallView = function() {
            var sel = document.getElementById('pwAlbumSort');
            pwCurrentSort = sel ? sel.value : 'date_desc';
            window.pwSortKey = pwCurrentSort;
            window.pwApplySort = sortPhotoWallData;
            if (pwAlbumViewActive) {
                renderAlbumView();
            } else {
                renderPhotoWall();
            }
        };

        // ---------- 排序函数 ----------
        function sortPhotoWallData(data, sortKey) {
            var sorted = data.slice();
            switch(sortKey) {
                case 'date_desc':
                    sorted.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); }); break;
                case 'date_asc':
                    sorted.sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); }); break;
                case 'name':
                    sorted.sort(function(a, b) {
                        var na = (a.username || a.id || '').toLowerCase();
                        var nb = (b.username || b.id || '').toLowerCase();
                        return na.localeCompare(nb);
                    }); break;
                case 'size':
                    sorted.sort(function(a, b) { return (b.views || 0) - (a.views || 0); }); break;
                case 'views':
                    sorted.sort(function(a, b) { return (b.views || 0) - (a.views || 0); }); break;
                default:
                    sorted.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
            }
            return sorted;
        }

        // ---------- 相册渲染 ----------
        function renderAlbumView() {
            var container = document.getElementById('pwAlbumContainer');
            if (!container) return;
            var data = window.photoWallData || [];
            if (data.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无照片</div>';
                return;
            }

            var sorted = sortPhotoWallData(data, pwCurrentSort);
            // Group by date
            var albums = {};
            sorted.forEach(function(p) {
                var d = new Date(p.timestamp || Date.now());
                var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                if (!albums[key]) albums[key] = [];
                albums[key].push(p);
            });

            var keys = Object.keys(albums).sort().reverse();
            var html = '<div style="padding:8px 0;">';
            keys.forEach(function(dateKey) {
                var photos = albums[dateKey];
                var cover = photos[0];
                var coverUrl = cover.thumbUrl || cover.imageUrl || '';
                var dateObj = new Date(dateKey);
                var displayDate = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                var weekday = weekdays[dateObj.getDay()];
                html += '<div class="pw-album-card" onclick="openAlbum(\'' + dateKey + '\')">';
                if (coverUrl) {
                    html += '<img class="pw-album-cover" src="' + coverUrl + '" alt="" loading="lazy">';
                } else {
                    html += '<div class="pw-album-cover" style="background:linear-gradient(135deg,#059669,#10b981);display:flex;align-items:center;justify-content:center;font-size:32px;">📷</div>';
                }
                html += '<div class="pw-album-title">' + displayDate + ' 周' + weekday + '</div>';
                html += '<div class="pw-album-count">共 ' + photos.length + ' 张照片</div>';
                html += '</div>';
            });
            html += '</div>';
            container.innerHTML = html;
        }

        // ---------- 打开相册 ----------
        window.openAlbum = function(dateKey) {
            var data = window.photoWallData || [];
            var filtered = data.filter(function(p) {
                var d = new Date(p.timestamp || Date.now());
                var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                return key === dateKey;
            });
            if (filtered.length === 0) return;
            openPhotoPreviewForList(filtered);
        };

        // ---------- 打开指定照片列表预览 ----------
        window.openPhotoPreviewForList = function(photoList) {
            if (typeof window.photoWallData !== 'undefined' && photoList && photoList.length > 0) {
                ppSortedPhotos = photoList;
                ppPhotoIdx = 0;
                openPhotoPreview(0);
            }
        };

        // ---------- 批量上传 ----------
        window.triggerBatchUpload = function() {
            if (!window.currentUser) { showToast('请先登录'); return; }
            document.getElementById('photoFileInput').click();
        };

        // Enhance handlePhotoUpload to support multiple files
        var _origHandleUpload = window.handlePhotoUpload;
        window.handlePhotoUpload = async function(e) {
            var files = e.target.files;
            if (!files || files.length === 0) return;
            if (!window.currentUser) { showToast('请先登录'); return; }

            // ---------- 智能压缩：将图片压缩至目标大小 ----------
        async function compressToMaxSize(file, maxBytes) {
            // 策略：根据文件大小估算合适的压缩参数，逐步降级
            var quality = file.size > 50 * 1024 * 1024 ? 0.5 : (file.size > 20 * 1024 * 1024 ? 0.6 : 0.7);
            var maxDim = file.size > 50 * 1024 * 1024 ? 2560 : 2048;

            // 第一轮压缩
            var dataUrl = await compressImage(file, maxDim, maxDim, quality);
            var blob = await fetch(dataUrl).then(function(r) { return r.blob(); });

            // 如果仍然超过限制，降低分辨率和质量
            if (blob.size > maxBytes) {
                dataUrl = await compressImage(file, 2048, 1536, 0.5);
                blob = await fetch(dataUrl).then(function(r) { return r.blob(); });
            }
            if (blob.size > maxBytes) {
                dataUrl = await compressImage(file, 1920, 1080, 0.4);
                blob = await fetch(dataUrl).then(function(r) { return r.blob(); });
            }
            if (blob.size > maxBytes) {
                dataUrl = await compressImage(file, 1280, 720, 0.3);
                blob = await fetch(dataUrl).then(function(r) { return r.blob(); });
            }
            if (blob.size > maxBytes) {
                // 最终手段：强制 target 不要太小
                dataUrl = await compressImage(file, 800, 600, 0.2);
                blob = await fetch(dataUrl).then(function(r) { return r.blob(); });
            }

            console.log('[compressToMaxSize] ' + file.name + ': ' + (file.size/1048576).toFixed(1) + 'MB → ' + (blob.size/1048576).toFixed(1) + 'MB');
            return blob;
        }

        // Single file - use original handler
            if (files.length === 1 && _origHandleUpload) {
                _origHandleUpload(e);
                return;
            }

            // Multiple files - batch upload
            var progressEl = document.getElementById('pwUploadProgress');
            progressEl.style.display = 'block';
            progressEl.innerHTML = '';
            var total = files.length;
            var success = 0;
            var failed = 0;

            for (var i = 0; i < total; i++) {
                var file = files[i];
                var itemDiv = addProgressItem(progressEl, file.name, '准备中...', 0);
                var fileToUpload = file;
                var fileOriginalSize = file.size;
                var wasCompressed = false;

                try {
                    // 超过10MB自动压缩
                    if (file.size > 10 * 1024 * 1024) {
                        updateProgressItem(itemDiv, '压缩中 (' + (file.size/1048576).toFixed(1) + 'MB → ~10MB)...', 5);
                        try {
                            var compressed = await compressToMaxSize(file, 10 * 1024 * 1024);
                            fileToUpload = compressed;
                            wasCompressed = true;
                            updateProgressItem(itemDiv, '已压缩至 ' + (compressed.size/1048576).toFixed(1) + 'MB', 25);
                        } catch (compErr) {
                            // 压缩失败：如果原文件 ≤ 50MB 则直接上传，否则跳过
                            console.warn('[压缩失败] ' + file.name + ': ' + compErr.message);
                            if (file.size > 50 * 1024 * 1024) {
                                updateProgressItem(itemDiv, '过大且压缩失败', 0);
                                failed++;
                                continue;
                            }
                            updateProgressItem(itemDiv, '压缩失败，直接上传 (' + (file.size/1048576).toFixed(1) + 'MB)', 20);
                        }
                    }
                    updateProgressItem(itemDiv, '上传中...', 30);

                    var sb = window.sb;
                    var ts = Date.now() + '_' + i;
                    var baseName = ts + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    var origPath = 'photos/' + baseName;

                    var { error: upErr } = await sb.storage.from('uploads').upload(origPath, fileToUpload);
                    if (upErr) {
                        updateProgressItem(itemDiv, '失败', 0);
                        failed++;
                        continue;
                    }

                    // Generate thumbnail
                    var thumbDataUrl = await compressImage(file, 400, 400, 0.6);
                    var thumbBlob = await fetch(thumbDataUrl).then(function(r) { return r.blob(); });
                    var thumbPath = 'thumbs/' + baseName;
                    await sb.storage.from('uploads').upload(thumbPath, thumbBlob, { contentType: 'image/jpeg', cacheControl: '31536000' });

                    var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
                    var thumbUrl = sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl;

                    // Save to posts table
                    var contentJson = JSON.stringify({ type: 'photo_wall', originalName: file.name, fileSize: fileToUpload.size, originalSize: fileOriginalSize });
                    var insertRes = await sb.from('posts').insert([{
                        user_name: window.currentUser,
                        content: contentJson,
                        media_url: imageUrl,
                        media_type: '__photo_wall__',
                        actor_key: window.deviceId || 'photo_wall'
                    }]).select('id,user_name,media_url,content,created_at,views').single();

                    if (insertRes.error) {
                        updateProgressItem(itemDiv, '保存失败', 0);
                        failed++;
                        continue;
                    }

                    // Also save to photos table
                    var photoRec = {
                        user_name: window.currentUser,
                        storage_path: origPath,
                        public_url: imageUrl,
                        original_name: file.name,
                        file_size: fileToUpload.size,
                        mime_type: file.type || 'image/jpeg',
                        album_date: new Date().toISOString().slice(0, 10),
                        is_cover: false
                    };
                    await sb.from('photos').insert([photoRec]).select().maybeSingle();

                    // Add to local data
                    var photoData = window.photoWallData || [];
                    photoData.unshift({
                        id: Date.now() + '_' + i,
                        cloudId: insertRes.data.id,
                        username: window.currentUser,
                        imageUrl: imageUrl,
                        thumbUrl: thumbUrl,
                        timestamp: Date.now(),
                        views: 0,
                        originalName: file.name,
                        fileSize: fileToUpload.size
                    });
                    if (typeof saveLocalPhotoWallData === 'function') saveLocalPhotoWallData();

                    updateProgressItem(itemDiv, '✅ 完成', 100);
                    success++;
                } catch(e) {
                    updateProgressItem(itemDiv, '失败', 0);
                    failed++;
                }
            }

            // Final status
            var statusMsg = '批量上传完成: ' + success + '成功, ' + failed + '失败';
            if (failed === 0) statusMsg = '✅ 全部上传成功 (' + success + '张)';
            else statusMsg = '⚠️ ' + statusMsg;
            showToast(statusMsg);
            e.target.value = '';

            // Clean progress after 3s
            setTimeout(function() {
                progressEl.style.display = 'none';
                progressEl.innerHTML = '';
            }, 3000);

            // Refresh
            if (typeof renderPhotoWall === 'function') renderPhotoWall();
        };

        function addProgressItem(container, fileName, status, progress) {
            var div = document.createElement('div');
            div.className = 'pw-progress-item';
            var shortName = fileName.length > 30 ? fileName.slice(0, 27) + '...' : fileName;
            div.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + shortName + '</span>' +
                '<div class="pw-progress-bar"><div class="pw-progress-fill" style="width:' + (progress || 0) + '%"></div></div>' +
                '<span class="pw-progress-status">' + status + '</span>';
            container.appendChild(div);
            return div;
        }

        function updateProgressItem(itemDiv, status, progress) {
            var fill = itemDiv.querySelector('.pw-progress-fill');
            var statusEl = itemDiv.querySelector('.pw-progress-status');
            if (fill) fill.style.width = (progress || 0) + '%';
            if (statusEl) statusEl.textContent = status;
        }

        // ---------- 自动封面生成 ----------
        window.autoGenerateCover = function() {
            var data = window.photoWallData || [];
            if (data.length === 0) return null;
            // Rule: pick the photo with most views, or the newest one
            var sorted = data.slice().sort(function(a, b) {
                var aScore = (a.views || 0) * 10 + (a.timestamp || 0);
                var bScore = (b.views || 0) * 10 + (b.timestamp || 0);
                return bScore - aScore;
            });
            return sorted[0];
        };

        // Patch renderPhotoWall to support sorting
        var _origRenderPhotoWall = window.renderPhotoWall;
        if (_origRenderPhotoWall) {
            window.renderPhotoWall = function() {
                var grid = document.getElementById('photoGrid');
                if (!grid) return;
                if (typeof loadLocalPhotoWallData === 'function') loadLocalPhotoWallData();
                var data = window.photoWallData || [];
                if (data.length === 0) {
                    grid.innerHTML = '<div class="photo-wall-empty"><div class="photo-wall-empty-icon">📷</div><div>还没有照片</div><div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">📤 成为第一个分享照片的人</div></div>';
                    return;
                }
                var sorted = sortPhotoWallData(data, pwCurrentSort);
                // Use virtual scrolling for large datasets
                if (sorted.length > 30 && typeof renderVirtualPhotoWall === 'function') {
                    renderVirtualPhotoWall(sorted, grid);
                    return;
                }
                var html = '';
                for (var i = 0; i < sorted.length; i++) {
                    var p = sorted[i];
                    var timeStr = typeof formatPhotoTime === 'function' ? formatPhotoTime(p.timestamp) : new Date(p.timestamp || Date.now()).toLocaleString();
                    var name = p.username || '未知用户';
                    html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + escapeHtml(p.id) + '" style="animation-delay:' + (i * 50 < 500 ? i * 50 : 0) + 'ms" onclick="openPhotoPreview(' + i + ')">';
                    var gridSrc = p.thumbUrl || p.imageUrl;
                    html += '<img src="' + gridSrc + '" alt="photo" class="pw-blur-in" data-src="' + gridSrc + '" loading="lazy">';
                    html += '<div class="pw-item-info"><div class="pw-item-name">' + escapeHtml(name) + '</div>';
                    html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div></div></div>';
                }
                grid.innerHTML = html;
                requestAnimationFrame(function() {
                    var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
                    items.forEach(function(item) {
                        item.classList.add('pw-stagger-done');
                        item.classList.remove('pw-stagger-enter');
                    });
                });
                if (typeof pwObserveLazyImages === 'function') pwObserveLazyImages(grid);
            };
        }

        // ================================================================
        // 模块3：系统性能优化
        // ================================================================

        // ---------- 虚拟滚动列表 ----------
        window.renderVirtualPhotoWall = function(sortedData, grid) {
            if (!grid) grid = document.getElementById('photoGrid');
            if (!grid) return;

            var ITEM_HEIGHT = 200; // estimated item height + gap
            var BUFFER = 4; // extra rows above/below viewport
            var containerHeight = grid.clientHeight || window.innerHeight - 200;
            var visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + BUFFER * 2;

            // Set up virtual scroll structure
            grid.style.overflow = 'auto';
            grid.style.position = 'relative';
            grid.innerHTML = '';

            var totalHeight = sortedData.length * ITEM_HEIGHT;
            var spacer = document.createElement('div');
            spacer.style.height = totalHeight + 'px';
            spacer.style.position = 'relative';
            grid.appendChild(spacer);

            var contentEl = document.createElement('div');
            contentEl.style.position = 'absolute';
            contentEl.style.top = '0';
            contentEl.style.left = '0';
            contentEl.style.right = '0';
            spacer.appendChild(contentEl);

            function renderVisible() {
                var scrollTop = grid.scrollTop;
                var startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
                var endIdx = Math.min(sortedData.length, startIdx + visibleCount + BUFFER * 2);
                contentEl.style.top = (startIdx * ITEM_HEIGHT) + 'px';
                contentEl.style.minHeight = ((endIdx - startIdx) * ITEM_HEIGHT) + 'px';

                var html = '';
                for (var i = startIdx; i < endIdx && i < sortedData.length; i++) {
                    var p = sortedData[i];
                    var timeStr = typeof formatPhotoTime === 'function' ? formatPhotoTime(p.timestamp) : new Date(p.timestamp || Date.now()).toLocaleString();
                    var name = p.username || '未知用户';
                    html += '<div class="photo-wall-item" data-photo-id="' + escapeHtml(p.id) + '" style="position:absolute;top:' + ((i - startIdx) * ITEM_HEIGHT) + 'px;left:0;right:0;height:' + (ITEM_HEIGHT - 8) + 'px;" onclick="openPhotoPreview(' + i + ')">';
                    var gridSrc = p.thumbUrl || p.imageUrl;
                    html += '<img src="' + gridSrc + '" alt="photo" class="pw-blur-in" loading="lazy">';
                    html += '<div class="pw-item-info"><div class="pw-item-name">' + escapeHtml(name) + '</div>';
                    html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div></div></div>';
                }
                contentEl.innerHTML = html;
            }

            grid.addEventListener('scroll', function() {
                if (window._pwScrollRaf) cancelAnimationFrame(window._pwScrollRaf);
                window._pwScrollRaf = requestAnimationFrame(renderVisible);
            });

            renderVisible();
        };

        // ---------- 服务端分页（帖子列表） ----------
        var feedPage = 0;
        var feedPageSize = 20;
        var feedLoading = false;
        var feedHasMore = true;

        window.loadMorePosts = async function() {
            if (feedLoading || !feedHasMore) return;
            feedLoading = true;
            try {
                var sb = window.sb;
                if (!sb) { feedLoading = false; return; }
                feedPage++;
                var from = feedPage * feedPageSize;
                var to = from + feedPageSize - 1;
                var { data, error } = await sb.from('posts')
                    .select('*')
                    .neq('media_type', '__avatar__')
                    .order('created_at', { ascending: false })
                    .range(from, to);
                if (error) { feedLoading = false; return; }
                if (!data || data.length < feedPageSize) feedHasMore = false;
                if (data && data.length > 0) {
                    // Append to existing data
                    if (typeof window.appendFeedPosts === 'function') {
                        window.appendFeedPosts(data);
                    }
                }
            } catch(e) {}
            feedLoading = false;
        };

        // Infinite scroll observer for feed
        document.addEventListener('DOMContentLoaded', function() {
            var sentinel = document.getElementById('feedSentinel');
            if (sentinel) {
                var obs = new IntersectionObserver(function(entries) {
                    if (entries[0].isIntersecting) {
                        loadMorePosts();
                    }
                }, { rootMargin: '200px' });
                obs.observe(sentinel);
            }
        });

        // ---------- 懒加载统计页面 ----------
        window.loadStatsLazy = function() {
            var statsEl = document.getElementById('panelProfile');
            if (!statsEl || statsEl.classList.contains('stats-loaded')) return;
            statsEl.classList.add('stats-loaded');
            // Stats are loaded only when profile tab becomes active
            var profileObserver = new MutationObserver(function() {
                if (statsEl.classList.contains('active') && !statsEl.querySelector('.stats-content')) {
                    var statsDiv = document.createElement('div');
                    statsDiv.className = 'stats-content';
                    statsDiv.style.padding = '12px';
                    // Compute stats from local data
                    var posts = window.allPosts || [];
                    var likes = window.allLikes || [];
                    var comments = window.allComments || [];
                    var users = window.allUsers || [];
                    statsDiv.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                        '<div style="padding:16px;border-radius:12px;background:rgba(5,150,105,0.08);text-align:center;"><div style="font-size:24px;font-weight:700;">' + posts.length + '</div><div style="font-size:13px;color:var(--text-muted);">帖子</div></div>' +
                        '<div style="padding:16px;border-radius:12px;background:rgba(59,130,246,0.08);text-align:center;"><div style="font-size:24px;font-weight:700;">' + users.length + '</div><div style="font-size:13px;color:var(--text-muted);">用户</div></div>' +
                        '<div style="padding:16px;border-radius:12px;background:rgba(239,68,68,0.08);text-align:center;"><div style="font-size:24px;font-weight:700;">' + likes.length + '</div><div style="font-size:13px;color:var(--text-muted);">点赞</div></div>' +
                        '<div style="padding:16px;border-radius:12px;background:rgba(168,85,247,0.08);text-align:center;"><div style="font-size:24px;font-weight:700;">' + comments.length + '</div><div style="font-size:13px;color:var(--text-muted);">评论</div></div>' +
                        '</div>';
                    var existing = statsEl.querySelector('.stats-content');
                    if (existing) existing.remove();
                    statsEl.insertBefore(statsDiv, statsEl.firstChild);
                }
            });
            profileObserver.observe(statsEl, { attributes: true, attributeFilter: ['class'] });
        };

        // Init lazy stats
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { if (typeof loadStatsLazy === 'function') loadStatsLazy(); });
        } else {
            if (typeof loadStatsLazy === 'function') loadStatsLazy();
        }

        // ---------- 数据获取重构：分页加载帖子 ----------
        var _origInitialLoad = window.initialLoad;
        if (_origInitialLoad) {
            window.initialLoad = async function(skipPosts) {
                try {
                    var sb = window.sb;
                    if (!sb) { if (_origInitialLoad) _origInitialLoad(skipPosts); return; }

                    // Load only first page of posts
                    feedPage = 0;
                    feedHasMore = true;
                    var { data: firstPosts, error: postErr } = await sb.from('posts')
                        .select('*')
                        .neq('media_type', '__avatar__')
                        .order('created_at', { ascending: false })
                        .range(0, feedPageSize - 1);
                    if (postErr) { if (_origInitialLoad) _origInitialLoad(skipPosts); return; }

                    // Load likes and comments (smaller datasets)
                    var [likeRes, commRes] = await Promise.all([
                        sb.from('likes').select('*').limit(2000),
                        sb.from('comments').select('*').limit(2000)
                    ]);

                    window.allPosts = firstPosts || [];
                    window.allLikes = likeRes.data || [];
                    window.allComments = commRes.data || [];

                    // Build user map from loaded data
                    var userMap = {};
                    (window.allPosts || []).forEach(function(p) { userMap[p.user_name] = true; });
                    (window.allLikes || []).forEach(function(l) { userMap[l.user_name] = true; });
                    (window.allComments || []).forEach(function(c) { userMap[c.user_name] = true; });

                    // Load user info records
                    var { data: userInfoData } = await sb.from('posts').select('*').eq('media_type', '__user_info__').limit(2000);
                    var userInfoMap = {};
                    (userInfoData || []).forEach(function(ui) {
                        try { var info = JSON.parse(ui.content); userInfoMap[ui.user_name] = info; userMap[ui.user_name] = true; } catch(e) {}
                    });

                    window.allUsers = Object.keys(userMap).sort().map(function(u) {
                        return { name: u, info: userInfoMap[u] || null };
                    });

                    // Render with first page
                    if (typeof renderFeed === 'function') renderFeed();
                    if (typeof updateFeedStats === 'function') updateFeedStats();

                    // Load more posts in background
                    setTimeout(async function() {
                        var remaining = [];
                        var hasMoreCheck = true;
                        var page = 1;
                        while (hasMoreCheck) {
                            var from = page * feedPageSize;
                            var to = from + feedPageSize - 1;
                            var { data: morePosts } = await sb.from('posts')
                                .select('*')
                                .neq('media_type', '__avatar__')
                                .order('created_at', { ascending: false })
                                .range(from, to);
                            if (!morePosts || morePosts.length === 0) { hasMoreCheck = false; break; }
                            remaining = remaining.concat(morePosts);
                            page++;
                            if (remaining.length > 200) break; // cap background loading
                        }
                        if (remaining.length > 0) {
                            window.allPosts = (window.allPosts || []).concat(remaining);
                        }
                    }, 2000);

                } catch(e) {
                    // Fallback to original
                    if (_origInitialLoad) _origInitialLoad(skipPosts);
                }
            };
        }

        // ---------- 图片压缩工具（用于批量上传） ----------
        if (typeof window.compressImage !== 'function') {
            window.compressImage = function(file, maxW, maxH, quality) {
                return new Promise(function(resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function(e) {
                        var img = new Image();
                        img.onload = function() {
                            var w = img.width, h = img.height;
                            if (w > maxW) { h = h * maxW / w; w = maxW; }
                            if (h > maxH) { w = w * maxH / h; h = maxH; }
                            var canvas = document.createElement('canvas');
                            canvas.width = w; canvas.height = h;
                            var ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, w, h);
                            resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
                        };
                        img.onerror = reject;
                        img.src = e.target.result;
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            };
        }

        console.log('[功能模块] 用户管理/内容安全/照片墙增强/性能优化已加载');
    })();