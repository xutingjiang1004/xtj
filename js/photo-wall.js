(function() {
            // ========== 照片墙功能 ==========
            var photoWallData = [];
            window.photoWallData = photoWallData;
            var photoWallKey = 'xtj_photos';
            var photoWallDeletedKey = 'xtj_photos_deleted';

            /* ========== 本地删除追踪 ========== */
            function getDeletedPhotoIds() {
                try {
                    return JSON.parse(localStorage.getItem(photoWallDeletedKey)) || [];
                } catch(e) {
                    return [];
                }
            }

            function addDeletedPhotoId(id) {
                var ids = getDeletedPhotoIds();
                var sid = String(id);
                if (ids.indexOf(sid) < 0) {
                    ids.push(sid);
                    try {
                        localStorage.setItem(photoWallDeletedKey, JSON.stringify(ids));
                    } catch(e) {}
                }
            }

            function cleanDeletedIds() {
                try {
                    localStorage.removeItem(photoWallDeletedKey);
                } catch(e) {}
            }
            var PHOTO_WALL_MARKER = '__photo_wall__';
            var photoWallMigrating = false;
            var photoWallRealtime = null;
            var photoPreviewActive = false;
            var photoPreviewClosedAt = 0;
            var photoPreviewCurrent = null;
            var ppZoom = { scale: 1, tx: 0, ty: 0 };
            var ppPointers = new Map();
            var ppStart = null;
            var ppLastTap = 0;
            var ppTapTimer = null;
            var ppMoved = false;
            var ppPhotoIdx = -1;
            var ppSwipeLock = 0;
            var ppSortedPhotos = [];
            window.ppSortedPhotos = ppSortedPhotos;
            // 滑动轨道变量
            var ppTrack = null;
            var ppTrackDrag = 0;
            var ppTrackSnapping = false;
            var ppVw = 0;
            var ppVelocitySamples = [];
            var ppLastMoveX = 0;
            var ppLastMoveT = 0;
            var ppRafId = null;
            var ppPreloadCache = {};
            var ppImageCache = {};
            var ppPreloadQueue = [];
            // 陀螺仪视差（Gyroscope Parallax）变量
            var ppGyroTargetX = 0;
            var ppGyroTargetY = 0;
            var ppGyroCurrentX = 0;
            var ppGyroCurrentY = 0;
            var ppGyroRafId = null;
            var ppGyroActive = false;
            var ppGyroPermGranted = false;
            var ppDeviceOrientationHandler = null;
            var ppTapHandled = false;

            function ppInitTrack() {
                ppTrack = document.getElementById('ppSlideTrack');
                ppVw = window.innerWidth;
            }

            function ppSetTrackImages(idx) {
                ppInitTrack();
                if (!ppTrack) return;
                var photos = ppSortedPhotos;
                var prevImg = document.getElementById('ppPrevImg');
                var curImg = document.getElementById('photoPreviewImage');
                var nextImg = document.getElementById('ppNextImg');

                // 预加载邻接图片（更新缓存）
                ppPreloadAdjacent(idx);

                // 先设置当前图片（优先级最高），使用缓存确保即时显示
                if (photos[idx]) {
                    var curUrl = photos[idx].imageUrl;
                    if (ppImageCache[curUrl] && ppImageCache[curUrl] !== 'loading') {
                        curImg.src = curUrl;
                    } else {
                        curImg.src = curUrl;
                        ppPreloadImage(curUrl);
                    }
                }

                // 延迟设置前后图片，避免与当前图片竞争带宽
                setTimeout(function() {
                    if (idx > 0 && photos[idx - 1]) {
                        var prevUrl = photos[idx - 1].imageUrl;
                        prevImg.src = prevUrl;
                        ppPreloadImage(prevUrl);
                    } else {
                        prevImg.removeAttribute('src');
                    }
                    if (idx < photos.length - 1 && photos[idx + 1]) {
                        var nextUrl = photos[idx + 1].imageUrl;
                        nextImg.src = nextUrl;
                        ppPreloadImage(nextUrl);
                    } else {
                        nextImg.removeAttribute('src');
                    }
                }, 50);

                // 同步重置轨道位置 — 不等图片加载，消除黑屏
                ppTrackDrag = 0;
                ppTrackSnapping = false;
                ppTrack.style.transform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
                ppTrack.style.webkitTransform = 'translate3d(' + (-ppVw) + 'px, 0, 0)';
                if (photos[idx]) updateAmbientBackground(photos[idx].imageUrl);
            }

            function ppPreloadImage(url) {
                if (!url || ppImageCache[url]) return Promise.resolve();
                return new Promise(function(resolve) {
                    ppImageCache[url] = 'loading';
                    var pre = new Image();
                    pre.onload = function() {
                        ppImageCache[url] = pre;
                        resolve();
                    };
                    pre.onerror = function() {
                        ppImageCache[url] = null;
                        resolve();
                    };
                    pre.src = url;
                });
            }

            function ppPreloadAdjacent(idx) {
                var photos = ppSortedPhotos;
                var urls = [];
                for (var d = -3; d <= 3; d++) {
                    var i = idx + d;
                    if (i >= 0 && i < photos.length && photos[i] && photos[i].imageUrl) {
                        urls.push(photos[i].imageUrl);
                    }
                }
                urls.forEach(function(url) {
                    if (!ppPreloadCache[url]) {
                        ppPreloadCache[url] = true;
                        ppPreloadImage(url);
                    }
                });
            }

            // --- 新增：轨道滑动的 requestAnimationFrame 缓存变量 ---
            var ppTrackRaf = null;

            function ppApplySlideTrack() {
                if (!ppTrack || ppTrackSnapping) return;
                
                if (!ppTrackRaf) {
                    ppTrackRaf = requestAnimationFrame(function() {
                        var offset = -ppVw + ppTrackDrag;
                        ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
                        ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';
                        ppTrackRaf = null;
                    });
                }
            }

            // --- 新增：图像变换的 requestAnimationFrame 缓存变量 ---
            var ppTransformRaf = null;
            var ppPinchPre = { pts: [null, null], d: 0, c: { x: 0, y: 0 } };

            function ppApplyImageTransform() {
                var img = document.getElementById('photoPreviewImage');
                if (!img) return;

                // 性能瓶颈修复：避免在每一次手指微动时都无脑触发 classList 重排
                var isZoomed = ppZoom.scale > 1.01;
                if (isZoomed !== img.classList.contains('zoomed')) {
                    img.classList.toggle('zoomed', isZoomed);
                }

                // 使用 requestAnimationFrame 把变换交给 GPU 批量渲染，实现原生级顺滑
                if (!ppTransformRaf) {
                    ppTransformRaf = requestAnimationFrame(function() {
                        var tx = ppZoom.tx + ppGyroCurrentX;
                        var ty = ppZoom.ty + ppGyroCurrentY;
                        var t = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + ppZoom.scale + ')';
                        img.style.transform = t;
                        img.style.webkitTransform = t;
                        ppTransformRaf = null;
                    });
                }
            }

            // ========== 陀螺仪视差引擎（Gyroscope Parallax）==========
            var ppGyroMaxOffset = 15;
            var ppGyroLerpSpeed = 0.1;

            function ppGyroOnOrientation(e) {
                var beta = e.beta;
                var gamma = e.gamma;
                if (beta === null || gamma === null) {
                    ppGyroTargetX = 0;
                    ppGyroTargetY = 0;
                    return;
                }
                // gamma: 左右倾斜（-180~180），beta: 前后倾斜（-180~180）
                // 将角度映射为 ±ppGyroMaxOffset 像素偏移
                ppGyroTargetX = Math.max(-ppGyroMaxOffset, Math.min(ppGyroMaxOffset, gamma * 0.25));
                ppGyroTargetY = Math.max(-ppGyroMaxOffset, Math.min(ppGyroMaxOffset, beta * -0.15));
            }

            function ppStartGyro() {
                if (ppGyroActive) return;
                ppGyroActive = true;
                ppGyroTargetX = 0;
                ppGyroTargetY = 0;
                ppGyroCurrentX = 0;
                ppGyroCurrentY = 0;

                // 注册 deviceorientation 监听器（存储在变量中以供移除）
                ppDeviceOrientationHandler = ppGyroOnOrientation;
                window.addEventListener('deviceorientation', ppDeviceOrientationHandler);

                // 启动 rAF 渲染循环
                ppGyroRafId = requestAnimationFrame(ppGyroRenderLoop);
            }

            function ppStopGyro() {
                ppGyroActive = false;
                ppGyroTargetX = 0;
                ppGyroTargetY = 0;

                if (ppGyroRafId) {
                    cancelAnimationFrame(ppGyroRafId);
                    ppGyroRafId = null;
                }
                if (ppDeviceOrientationHandler) {
                    window.removeEventListener('deviceorientation', ppDeviceOrientationHandler);
                    ppDeviceOrientationHandler = null;
                }

                // 复位 gyro 偏移到零（由 rAF 最后一帧完成平滑归位）
                ppGyroCurrentX = 0;
                ppGyroCurrentY = 0;
                var img = document.getElementById('photoPreviewImage');
                if (img) {
                    img.style.transform = '';
                    img.style.webkitTransform = '';
                }
                var info = document.querySelector('.photo-preview-info');
                if (info) info.style.transform = '';
            }

            function ppGyroRenderLoop() {
                if (!ppGyroActive) return;

                // Lerp 线性插值：current += (target - current) * speed
                ppGyroCurrentX += (ppGyroTargetX - ppGyroCurrentX) * ppGyroLerpSpeed;
                ppGyroCurrentY += (ppGyroTargetY - ppGyroCurrentY) * ppGyroLerpSpeed;

                // 让 ppApplyImageTransform 在下一个 RAF 中拾取最新的 gyro 值
                ppApplyImageTransform();

                // 对底部的照片信息（用户名、浏览量）应用反向小幅度偏移，形成视差层次
                var info = document.querySelector('.photo-preview-info');
                if (info) {
                    var invX = -ppGyroCurrentX * 0.35;
                    var invY = -ppGyroCurrentY * 0.35;
                    info.style.transform = 'translate3d(' + invX + 'px,' + invY + 'px,0)';
                }

                ppGyroRafId = requestAnimationFrame(ppGyroRenderLoop);
            }

            function ppRequestGyroPermission(triggerEl) {
                if (ppGyroPermGranted) {
                    ppStartGyro();
                    return;
                }
                if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    // iOS 13+ 需要请求权限
                    DeviceOrientationEvent.requestPermission().then(function(state) {
                        if (state === 'granted') {
                            ppGyroPermGranted = true;
                            ppStartGyro();
                        }
                    }).catch(function() {
                        // 静默失败，不使用陀螺仪
                    });
                } else {
                    // 非 iOS 或不需要权限的设备，直接启动
                    ppStartGyro();
                }
            }

            function ppResetZoom() {
                ppZoom = { scale: 1, tx: 0, ty: 0 };
                ppPointers.clear();
                ppStart = null;
                var img = document.getElementById('photoPreviewImage');
                if (img) {
                    img.classList.remove('zoomed', 'dragging');
                    img.style.transform = '';
                    img.style.webkitTransform = '';
                }
            }

            function ppToggleZoom(clientX, clientY) {
                var img = document.getElementById('photoPreviewImage');
                if (!img) return;
                if (ppZoom.scale > 1.05) {
                    ppResetZoom();
                } else {
                    var newScale = 2.6;
                    var centerX = window.innerWidth / 2;
                    var centerY = window.innerHeight / 2;
                    var ratio = newScale / 1;
                    ppZoom.scale = newScale;
                    ppZoom.tx = (clientX - centerX) * (1 - ratio);
                    ppZoom.ty = (clientY - centerY) * (1 - ratio);
                    ppApplyImageTransform();
                }
            }

            // 120Hz 弹簧物理引擎：基于胡克定律的无 transition 动画
            var ppSpringTension = 180;
            var ppSpringFriction = 18;

            function ppSnapTo(targetOffset, callback) {
                if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }

                var position = ppTrackDrag;
                var velocity = 0;
                var tension = ppSpringTension;
                var friction = ppSpringFriction;
                ppTrackSnapping = true;

                function ppSpringStep() {
                    if (!ppTrackSnapping) {
                        // 被拖拽手势中断：释放导航锁即可
                        ppSwipeLock = 0;
                        ppRafId = null;
                        return;
                    }

                    // 胡克定律：F_spring = -k * displacement（弹簧力）
                    // F_damping = -c * velocity（阻尼力）
                    // a = (F_spring - F_damping) / mass
                    var displacement = targetOffset - position;
                    var springForce = tension * displacement;
                    var dampingForce = friction * velocity;
                    var acceleration = springForce - dampingForce;

                    // 固定时间步长 16ms（~60fps），Euler 积分
                    velocity += acceleration * 0.016;
                    position += velocity * 0.016;

                    ppTrackDrag = position;
                    var offset = -ppVw + position;
                    ppTrack.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
                    ppTrack.style.webkitTransform = 'translate3d(' + offset + 'px, 0, 0)';

                    // 判断是否稳定（接近静止）
                    if (Math.abs(displacement) < 0.5 && Math.abs(velocity) < 0.5) {
                        // 锁定到精确目标值，消除亚像素误差
                        ppTrackDrag = targetOffset;
                        var finalOffset = -ppVw + targetOffset;
                        ppTrack.style.transform = 'translate3d(' + finalOffset + 'px, 0, 0)';
                        ppTrack.style.webkitTransform = 'translate3d(' + finalOffset + 'px, 0, 0)';
                        ppTrackSnapping = false;
                        ppRafId = null;
                        if (callback) callback();
                        return;
                    }

                    ppRafId = requestAnimationFrame(ppSpringStep);
                }

                ppRafId = requestAnimationFrame(ppSpringStep);
            }

            function ppNavigatePhoto(direction) {
                if (ppSwipeLock) return;
                var newIdx = ppPhotoIdx + direction;
                if (newIdx < 0 || newIdx >= ppSortedPhotos.length) {
                    // 到达边界，弹回
                    ppSnapTo(0);
                    return;
                }
                ppSwipeLock = 1;
                var photo = ppSortedPhotos[newIdx];

                // 计算目标偏移量：右滑展示右槽(-ppVw)，左滑展示左槽(ppVw)
                var targetDrag = direction > 0 ? -ppVw : ppVw;

                // 动画前先更新背景环境光，让视觉过度更连贯
                updateAmbientBackground(photo.imageUrl);

                // 核心修复：先执行物理滑动动画，等 300ms 动画结束后再执行数据替换
                ppSnapTo(targetDrag, function() {
                    // --- 此时用户已经看到了左/右侧已经预加载好的图片 ---
                    photo.views = (photo.views || 0) + 1;
                    ppPhotoIdx = newIdx;
                    photoPreviewCurrent = photo;

                    saveLocalPhotoWallData();
                    updatePhotoViewDisplays(photo);
                    ppResetZoom();

                    // 瞬间重新排布 3 个槽位的图片，并把轨道悄悄拉回正中间 (-ppVw)
                    // 因为中间的图已经被换成了刚刚滑进来的图，视觉上完全无缝，彻底消灭黑屏！
                    ppSetTrackImages(newIdx);

                    document.getElementById('photoPreviewUser').textContent = photo.username || '未知用户';
                    document.getElementById('photoPreviewTime').textContent = formatPhotoTime(photo.timestamp);
                    document.getElementById('photoPreviewViewsCount').textContent = photo.views;

                    ppSwipeLock = 0;
                    ppUpdateDots();

                    var delBtn2 = document.getElementById('ppDeleteBtn');
                    if (delBtn2) {
                        delBtn2.style.display = (window.currentUser && photo.username === window.currentUser) ? 'flex' : 'none';
                    }

                    syncPhotoViewCount(photo);
                });
            }

            function loadLocalPhotoWallData() {
                try {
                    var saved = localStorage.getItem(photoWallKey);
                    var localData = saved ? JSON.parse(saved) : [];
                    return localData.filter(function(p) {
                        return p && p.imageUrl && p.imageUrl.indexOf('data:') !== 0;
                    });
                } catch(e) {
                    return [];
                }
            }

            function normalizePhotoWallRow(row) {
                var extra = {};
                try { extra = row.content ? JSON.parse(row.content) : {}; } catch(e) {}
                return {
                    id: row.id,
                    cloudId: row.id,
                    username: row.user_name || extra.username || '未知用户',
                    imageUrl: row.media_url || extra.imageUrl || '',
                    thumbUrl: extra.thumb || '',
                    timestamp: row.created_at ? Date.parse(row.created_at) : (extra.timestamp || Date.now()),
                    views: row.views || extra.views || 0,
                    fileSize: extra.fileSize || null
                };
            }

            async function migrateLocalPhotosToCloud(localData) {
                if (photoWallMigrating || !window.sb || !window.currentUser || !localData.length) return;
                if (localStorage.getItem('xtj_photos_migrated_v1') === '1') return;
                var candidates = localData.filter(function(p) {
                    return p && p.imageUrl && p.imageUrl.indexOf('http') === 0 && !p.cloudId;
                });
                if (!candidates.length) return;
                photoWallMigrating = true;
                var migratedOk = false;
                try {
                    for (var i = 0; i < candidates.length; i++) {
                        var p = candidates[i];
                        var exists = await window.sb.from('posts')
                            .select('id')
                            .eq('media_type', PHOTO_WALL_MARKER)
                            .eq('media_url', p.imageUrl)
                            .limit(1);
                        if (exists.data && exists.data.length) continue;
                        await window.sb.from('posts').insert([{
                            user_name: p.username || window.currentUser,
                            content: JSON.stringify({ type: 'photo_wall', migrated: true, timestamp: p.timestamp || Date.now() }),
                            media_url: p.imageUrl,
                            media_type: PHOTO_WALL_MARKER,
                            actor_key: window.deviceId || 'photo_wall_migrated'
                        }]);
                    }
                    migratedOk = true;
                } catch(e) {
                    console.error('迁移本地照片墙失败:', e);
                } finally {
                    if (migratedOk) localStorage.setItem('xtj_photos_migrated_v1', '1');
                    photoWallMigrating = false;
                }
            }

            async function loadPhotoWallData() {
                var localData = loadLocalPhotoWallData();
                if (!window.sb) {
                    photoWallData = localData;
                    return photoWallData;
                }
                try {
                    await migrateLocalPhotosToCloud(localData);
                    var res = await window.sb.from('posts')
                        .select('id,user_name,media_url,content,created_at,views')
                        .eq('media_type', PHOTO_WALL_MARKER)
                        .order('created_at', { ascending: false })
                        .limit(500);
                    if (res.error) throw res.error;
                    var deletedIds = getDeletedPhotoIds();
                    photoWallData = (res.data || []).map(normalizePhotoWallRow).filter(function(p) { return !!p.imageUrl; });
                    // 过滤掉已删除的照片（云端同步延迟时的兜底保障）
                    if (deletedIds.length > 0) {
                        // 收集当前云端所有照片的ID
                        var cloudIds = {};
                        photoWallData.forEach(function(p) { cloudIds[String(p.id)] = true; });
                        // 清理已不在云端的删除记录（说明云端删除已生效）
                        var cleaned = deletedIds.filter(function(id) { return cloudIds[id]; });
                        if (cleaned.length !== deletedIds.length) {
                            try { localStorage.setItem(photoWallDeletedKey, JSON.stringify(cleaned)); } catch(e) {}
                            deletedIds = cleaned;
                        }
                        // 过滤掉仍在云端但用户已标记删除的
                        if (deletedIds.length > 0) {
                            photoWallData = photoWallData.filter(function(p) {
                                return deletedIds.indexOf(String(p.id)) < 0;
                            });
                        }
                    }
                    if (!photoWallData.length && localData.length) photoWallData = localData;
                    return photoWallData;
                } catch(e) {
                    console.error('加载云端照片墙失败:', e);
                    photoWallData = localData;
                    return photoWallData;
                }
            }

            function saveLocalPhotoWallData() {
                try {
                    localStorage.setItem(photoWallKey, JSON.stringify(photoWallData.slice(0, 100)));
                } catch (e) {}
            }

            function updatePhotoViewDisplays(photo) {
                if (!photo) return;
                var previewCount = document.getElementById('photoPreviewViewsCount');
                if (previewCount && photoPreviewCurrent && photoPreviewCurrent.id === photo.id) {
                    previewCount.textContent = photo.views || 0;
                }
                var item = document.querySelector('.photo-wall-item[data-photo-id="' + String(photo.id).replace(/"/g, '\\"') + '"] .pw-view-count');
                if (item) item.textContent = photo.views || 0;
            }

            async function syncPhotoViewCount(photo) {
                if (!photo || !photo.cloudId || !window.sb) return;
                try {
                    await window.sb.rpc('increment_post_views', { p_post_id: photo.cloudId });
                    var res = await window.sb.from('posts').select('views').eq('id', photo.cloudId).maybeSingle();
                    if (res && res.data && typeof res.data.views === 'number') {
                        photo.views = res.data.views;
                        var cached = photoWallData.find(function(p) { return p.id === photo.id || p.cloudId === photo.cloudId; });
                        if (cached) cached.views = photo.views;
                        saveLocalPhotoWallData();
                        updatePhotoViewDisplays(photo);
                    }
                } catch(e) {
                    updatePhotoViewDisplays(photo);
                }
            }

            async function renderPhotoWall() {
                var grid = document.getElementById('photoGrid');
                if (!grid) return;

                // TODO: 虚拟滚动（Virtual Scrolling）方案规划
                // 当照片超过50张时，仅渲染可视区域±2屏的DOM节点
                // 使用 IntersectionObserver 回收不可见节点内存
                // 预估节省 70-90% DOM节点数，显著降低内存占用

                // 先显示骨架屏
                var skeletonHtml = '';
                for (var s = 0; s < 6; s++) {
                    skeletonHtml += '<div class="pw-skeleton"></div>';
                }
                grid.innerHTML = skeletonHtml;

                await loadPhotoWallData();

                if (photoWallData.length === 0) {
                    grid.innerHTML = '<div class="photo-wall-empty">' +
                        '<div class="photo-wall-empty-icon">📷</div>' +
                        '<div>还没有照片</div>' +
                        '<div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">📤 成为第一个分享照片的人</div>' +
                        '</div>';
                    return;
                }

                var sorted = photoWallData.slice();
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
                    html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + escapeHtml(p.id) + '" style="animation-delay:' + (i * 50) + 'ms" onclick="openPhotoPreview(' + i + ')">';
                    var gridSrc = p.thumbUrl || p.imageUrl;
                    html += '<img src="' + gridSrc + '" alt="photo" class="pw-blur-in" data-src="' + gridSrc + '">';
                    html += '<div class="pw-item-info">';
                    html += '<div class="pw-item-name">' + escapeHtml(name) + '</div>';
                    html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div>';
                    html += '</div></div>';
                }
                grid.innerHTML = html;

                // 交错入场动画
                requestAnimationFrame(function() {
                    var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
                    items.forEach(function(item, idx) {
                        setTimeout(function() {
                            item.classList.add('pw-stagger-done');
                            item.classList.remove('pw-stagger-enter');
                        }, idx * 50);
                    });
                });

                // 懒加载观察器：blur → sharp
                pwObserveLazyImages(grid);
            }

            function formatPhotoTime(ts) {
                var diff = Date.now() - ts;
                if (diff < 60000) return '刚刚';
                if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
                if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
                var d = new Date(ts);
                return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
            }

            window.triggerPhotoUpload = function() {
                if (!window.currentUser) {
                    showToast('请先登录');
                    return;
                }
                document.getElementById('photoFileInput').click();
            };

            window.handlePhotoUpload = async function(e) {
                var file = e.target.files && e.target.files[0];
                if (!file) return;
                if (!window.currentUser) {
                    showToast('请先登录');
                    return;
                }
                if (file.size > 50 * 1024 * 1024) {
                    showToast('图片超过 50MB 限制');
                    return;
                }
                try {
                    var sb = window.sb;
                    var ts = Date.now();
                    var baseName = ts + '_' + file.name;

                    // 并行执行：上传原图 + 生成缩略图
                    var origPath = 'photos/' + baseName;
                    var thumbPromise = compressImage(file, 400, 400, 0.6).then(function(thumbDataUrl) {
                        // 将 data URL 转换为 Blob
                        return fetch(thumbDataUrl).then(function(r) { return r.blob(); });
                    });
                    var [thumbBlob, { error: uploadErr }] = await Promise.all([
                        thumbPromise,
                        sb.storage.from('uploads').upload(origPath, file)
                    ]);
                    if (uploadErr) {
                        showToast('上传失败: ' + (uploadErr.message || '未知错误'));
                        e.target.value = '';
                        return;
                    }

                    // 上传缩略图
                    var thumbPath = 'thumbs/' + baseName;
                    var { error: thumbErr } = await sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
                        contentType: 'image/jpeg',
                        cacheControl: '31536000'
                    });
                    if (thumbErr) {
                        // 缩略图上传失败不阻塞主流程，只用原图
                        var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
                        var contentJson = JSON.stringify({ type: 'photo_wall', fileSize: file.size });
                        var insertRes = await sb.from('posts').insert([{
                            user_name: window.currentUser,
                            content: contentJson,
                            media_url: imageUrl,
                            media_type: PHOTO_WALL_MARKER,
                            actor_key: window.deviceId || 'photo_wall'
                        }]).select('id,user_name,media_url,content,created_at,views').single();
                        if (insertRes.error) throw insertRes.error;
                        photoWallData.unshift(normalizePhotoWallRow(insertRes.data));
                        saveLocalPhotoWallData();
                        await renderPhotoWall();
                        showToast('上传成功（无缩略图）');
                        e.target.value = '';
                        return;
                    }

                    var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
                    var thumbUrl = sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl;

                    // 将缩略图 URL 存入 content 字段
                    var contentJson = JSON.stringify({ type: 'photo_wall', thumb: thumbUrl, fileSize: file.size });
                    var insertRes = await sb.from('posts').insert([{
                        user_name: window.currentUser,
                        content: contentJson,
                        media_url: imageUrl,
                        media_type: PHOTO_WALL_MARKER,
                        actor_key: window.deviceId || 'photo_wall'
                    }]).select('id,user_name,media_url,content,created_at,views').single();
                    if (insertRes.error) {
                        showToast('照片已上传，但发布到照片墙失败: ' + (insertRes.error.message || '未知错误'));
                        e.target.value = '';
                        return;
                    }
                    photoWallData.unshift(normalizePhotoWallRow(insertRes.data));
                    saveLocalPhotoWallData();
                    await renderPhotoWall();
                    showToast('上传成功');
                } catch (err) {
                    showToast('上传失败: ' + (err.message || '网络错误'));
                }
                e.target.value = '';
            };

            // ========== 环境光背景：提取照片主色调 ==========
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

            window.openPhotoPreview = async function(sortedIdx) {
                var sorted = photoWallData.slice();
                if (typeof window.pwApplySort === 'function') {
                    sorted = window.pwApplySort(sorted, window.pwSortKey || 'date_desc');
                } else {
                    sorted.sort(function(a, b) { return b.timestamp - a.timestamp; });
                }
                var photo = sorted[sortedIdx];
                if (!photo) return;

                ppPhotoIdx = sortedIdx;
                ppSortedPhotos = sorted;
                ppSwipeLock = 0;

                photo.views = (photo.views || 0) + 1;
                photoPreviewCurrent = photo;
                saveLocalPhotoWallData();
                updatePhotoViewDisplays(photo);

                ppResetZoom();
                ppInitTrack();
                ppSetTrackImages(sortedIdx);
                document.getElementById('photoPreviewUser').textContent = photo.username || '未知用户';
                document.getElementById('photoPreviewTime').textContent = formatPhotoTime(photo.timestamp);
                document.getElementById('photoPreviewViewsCount').textContent = photo.views;

                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay) return;
                if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
                overlay.classList.add('active');

                // 设置环境光背景
                updateAmbientBackground(photo.imageUrl);

                photoPreviewActive = true;

                // 启动陀螺仪视差（请求权限 + 开始监听）
                ppRequestGyroPermission();

                var dock = document.getElementById('dockBar');
                if (dock) dock.style.display = 'none';
                document.documentElement.classList.add('photo-previewing');
                document.body.classList.add('photo-previewing');
                document.body.style.overflow = 'hidden';

                // 更新指示点（必须在overlay激活后，避免DOM reflow干扰滑动轨道渲染）
                ppUpdateDots();

                // 显示/隐藏删除按钮（只有自己的照片可见）
                var delBtn = document.getElementById('ppDeleteBtn');
                if (delBtn) {
                    delBtn.style.display = (window.currentUser && photo.username === window.currentUser) ? 'flex' : 'none';
                }

                syncPhotoViewCount(photo);
            };

            window.closePhotoPreview = function() {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay) return;
                overlay.classList.remove('active');
                photoPreviewActive = false;
                photoPreviewClosedAt = Date.now();
                photoPreviewCurrent = null;
                ppPhotoIdx = -1;
                ppSortedPhotos = [];
                ppTrackDrag = 0;
                ppTrackSnapping = false;
                ppSwipeLock = 0;
                ppResetZoom();
                // 停止陀螺仪视差，释放监听器和 rAF
                ppStopGyro();
                ppTapHandled = false;
                var dock = document.getElementById('dockBar');
                if (dock) dock.style.display = '';
                document.documentElement.classList.remove('photo-previewing');
                document.body.classList.remove('photo-previewing');
                document.body.style.overflow = '';
                if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
            };

            document.addEventListener('click', function(e) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay || !overlay.classList.contains('active')) return;
                // If a pointer tap was just handled, skip click handler to avoid conflict
                if (ppTapHandled) { ppTapHandled = false; return; }
                // 如果点击的是关闭按钮、分享按钮、删除按钮，不处理
                if (e.target.closest('.photo-preview-close') || e.target.closest('.pp-share-btn') || e.target.closest('.pp-delete-btn')) return;
                // 如果是在图片wrapper上点击，且图片已放大，只缩小；未放大才关闭
                if (e.target === overlay || e.target.closest('#ppImageWrapper')) {
                    if (ppZoom.scale > 1.01) {
                        ppResetZoom();
                    } else {
                        closePhotoPreview();
                    }
                }
            });

            // ========== 刷新率检测 + 自适应帧预算 ==========
            var ppRefreshRate = 60;
            var ppFrameBudget = 16.67;
            (function detectRefreshRate() {
                var samples = [];
                var lastTime = performance.now();
                var count = 0;
                function sample() {
                    var now = performance.now();
                    var delta = now - lastTime;
                    lastTime = now;
                    if (delta > 5 && delta < 100) samples.push(delta);
                    count++;
                    if (count < 30) {
                        requestAnimationFrame(sample);
                    } else if (samples.length > 0) {
                        samples.sort(function(a, b) { return a - b; });
                        var median = samples[Math.floor(samples.length / 2)];
                        ppRefreshRate = Math.round(1000 / median);
                        ppFrameBudget = 1000 / ppRefreshRate;
                        if (ppRefreshRate >= 120) ppFrameBudget = 8.33;
                        else if (ppRefreshRate >= 90) ppFrameBudget = 11.11;
                        else ppFrameBudget = 16.67;
                        console.log('[照片预览] 检测到屏幕刷新率: ' + ppRefreshRate + 'Hz, 帧预算: ' + ppFrameBudget.toFixed(2) + 'ms');
                    }
                }
                requestAnimationFrame(sample);
            })();

            // ========== 手势系统：rAF驱动 + 速度追踪 + 动量惯性 ==========
            (function bindPhotoPreviewGestures() {
                var img = document.getElementById('photoPreviewImage');
                var wrapper = document.getElementById('ppImageWrapper');
                if (!img || !wrapper) return;

                var ppVwCenterX = window.innerWidth / 2;
                var ppVwCenterY = window.innerHeight / 2;

                function dist(a, b) {
                    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                }

                function center(a, b) {
                    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
                }

                function trackVelocity(clientX) {
                    var now = performance.now();
                    if (ppLastMoveT > 0 && now - ppLastMoveT < 80) {
                        var v = (clientX - ppLastMoveX) / Math.max(1, now - ppLastMoveT);
                        ppVelocitySamples.push(v);
                        if (ppVelocitySamples.length > 5) ppVelocitySamples.shift();
                    }
                    ppLastMoveX = clientX;
                    ppLastMoveT = now;
                }

                function avgVelocity() {
                    if (!ppVelocitySamples.length) return 0;
                    var sum = 0;
                    for (var i = 0; i < ppVelocitySamples.length; i++) sum += ppVelocitySamples[i];
                    return sum / ppVelocitySamples.length;
                }

                function startMomentum() {
                    if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
                    var v = avgVelocity() * 1000; // px/s
                    var friction = 0.92;
                    var minV = 0.3;

                    function step() {
                        v *= friction;
                        if (Math.abs(v) < minV) {
                            ppRafId = null;
                            settleSnap();
                            return;
                        }
                        // 边界阻力
                        var canPrev = ppPhotoIdx > 0;
                        var canNext = ppPhotoIdx < ppSortedPhotos.length - 1;
                        if ((!canPrev && ppTrackDrag + v > 0) || (!canNext && ppTrackDrag + v < 0)) {
                            v *= 0.55;
                        }
                        ppTrackDrag += v;
                        ppApplySlideTrack();
                        ppRafId = requestAnimationFrame(step);
                    }

                    ppRafId = requestAnimationFrame(step);
                }

                function settleSnap() {
                    var threshold = ppVw * 0.3;
                    if (ppTrackDrag > threshold && ppPhotoIdx > 0) {
                        ppNavigatePhoto(-1);
                    } else if (ppTrackDrag < -threshold && ppPhotoIdx < ppSortedPhotos.length - 1) {
                        ppNavigatePhoto(1);
                    } else {
                        ppSnapTo(0);
                    }
                }

                wrapper.addEventListener('pointerdown', function(e) {
                    if (!photoPreviewActive) return;
                    e.preventDefault();
                    img.setPointerCapture && img.setPointerCapture(e.pointerId);
                    ppPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
                    ppMoved = false;
                    img.classList.add('dragging');
                    // 中断进行中的动量/吸附动画
                    if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
                    if (ppTrackSnapping) {
                        ppTrackSnapping = false;
                        ppSwipeLock = 0;
                    }
                    ppVelocitySamples = [];
                    ppLastMoveX = e.clientX;
                    ppLastMoveT = performance.now();

                    if (ppPointers.size === 2) {
                        var ptrIter = ppPointers.values();
                        ppPinchPre.pts[0] = ptrIter.next().value;
                        ppPinchPre.pts[1] = ptrIter.next().value;
                        var pdx = ppPinchPre.pts[0].clientX - ppPinchPre.pts[1].clientX;
                        var pdy = ppPinchPre.pts[0].clientY - ppPinchPre.pts[1].clientY;
                        ppStart = {
                            mode: 'pinch',
                            dist: Math.sqrt(pdx * pdx + pdy * pdy) || 1,
                            scale: ppZoom.scale,
                            tx: ppZoom.tx,
                            ty: ppZoom.ty,
                            centerX: (ppPinchPre.pts[0].clientX + ppPinchPre.pts[1].clientX) / 2,
                            centerY: (ppPinchPre.pts[0].clientY + ppPinchPre.pts[1].clientY) / 2,
                            vcx: ppVwCenterX,
                            vcy: ppVwCenterY
                        };
                    } else if (ppPointers.size === 1) {
                        ppStart = {
                            mode: 'pan',
                            x: e.clientX,
                            y: e.clientY,
                            trackDrag: ppTrackDrag,
                            tx: ppZoom.tx,
                            ty: ppZoom.ty
                        };
                    }
                }, { passive: false });

                wrapper.addEventListener('pointermove', function(e) {
                    if (!photoPreviewActive || !ppPointers.has(e.pointerId)) return;
                    e.preventDefault();
                    ppPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
                    if (!ppStart) return;

                    if (ppPointers.size >= 2 && ppStart.mode === 'pinch') {
                        ppTrackDrag = 0;
                        var pi = ppPointers.values();
                        ppPinchPre.pts[0] = pi.next().value;
                        ppPinchPre.pts[1] = pi.next().value;
                        var dx = ppPinchPre.pts[0].clientX - ppPinchPre.pts[1].clientX;
                        var dy = ppPinchPre.pts[0].clientY - ppPinchPre.pts[1].clientY;
                        var d = Math.sqrt(dx * dx + dy * dy) || 1;
                        var cx = (ppPinchPre.pts[0].clientX + ppPinchPre.pts[1].clientX) / 2;
                        var cy = (ppPinchPre.pts[0].clientY + ppPinchPre.pts[1].clientY) / 2;
                        var nextScale = Math.max(1, Math.min(5, ppStart.scale * (d / ppStart.dist)));
                        var ratio = nextScale / Math.max(1, ppStart.scale);
                        ppZoom.scale = nextScale;
                        ppZoom.tx = cx - ratio * (ppStart.centerX - ppStart.tx) + ppStart.vcx * (ratio - 1);
                        ppZoom.ty = cy - ratio * (ppStart.centerY - ppStart.ty) + ppStart.vcy * (ratio - 1);
                        ppMoved = true;
                        ppApplyImageTransform();
                    } else if (ppPointers.size === 1 && ppStart.mode === 'pan') {
                        var dx = e.clientX - ppStart.x;
                        var dy = e.clientY - ppStart.y;
                        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ppMoved = true;
                        if (ppZoom.scale > 1.01) {
                            // 任务1：计算边界并钳制 tx/ty，防止图片拖出屏幕
                            var rawTx = ppStart.tx + dx;
                            var rawTy = ppStart.ty + dy;
                            
                            // 计算溢出范围：(scale-1)/2 * viewport 尺寸
                            var maxOverflowX = (ppZoom.scale - 1) * window.innerWidth / 2;
                            var maxOverflowY = (ppZoom.scale - 1) * window.innerHeight / 2;
                            
                            // 钳制 tx 和 ty
                            ppZoom.tx = Math.max(-maxOverflowX, Math.min(maxOverflowX, rawTx));
                            ppZoom.ty = Math.max(-maxOverflowY, Math.min(maxOverflowY, rawTy));
                            
                            ppTrackDrag = 0;
                            ppApplyImageTransform();
                        } else {
                            trackVelocity(e.clientX);
                            var canPrev = ppPhotoIdx > 0;
                            var canNext = ppPhotoIdx < ppSortedPhotos.length - 1;
                            var rawDrag = ppStart.trackDrag + dx;
                            if ((!canPrev && rawDrag > 0) || (!canNext && rawDrag < 0)) {
                                ppTrackDrag = (rawDrag > 0 ? 1 : -1) * Math.log(1 + Math.abs(rawDrag)) * 20;
                            } else {
                                ppTrackDrag = rawDrag;
                            }
                            ppApplySlideTrack();
                        }
                    }
                }, { passive: false });

                function endPointer(e) {
                    if (!ppPointers.has(e.pointerId)) return;
                    ppPointers.delete(e.pointerId);
                    img.releasePointerCapture && img.releasePointerCapture(e.pointerId);

                    if (ppPointers.size === 0) {
                        img.classList.remove('dragging');
                        ppStart = null;
                        if (!ppMoved) {
                            if (ppTrackSnapping) {
                                ppTrackSnapping = false;
                                ppSwipeLock = 0;
                                if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
                            }
                            var now = Date.now();
                            if (now - ppLastTap < 280) {
                                clearTimeout(ppTapTimer);
                                ppLastTap = 0;
                                ppToggleZoom(e.clientX, e.clientY);
                            } else {
                                ppLastTap = now;
                                clearTimeout(ppTapTimer);
                                ppTapTimer = setTimeout(function() {
                                    ppLastTap = 0;
                                    if (photoPreviewActive && ppZoom.scale <= 1.01) closePhotoPreview();
                                }, 260);
                            }
                            ppTapHandled = true;
                            ppTrackDrag = 0;
                            ppApplySlideTrack();
                            return;
                        }
                        if (ppZoom.scale <= 1.01) {
                            startMomentum();
                        }
                        return;
                    }

                    if (ppPointers.size === 1) {
                        var p = Array.from(ppPointers.values())[0];
                        ppStart = { mode: 'pan', x: p.clientX, y: p.clientY, trackDrag: ppTrackDrag, tx: ppZoom.tx, ty: ppZoom.ty };
                    }
                }

                wrapper.addEventListener('pointerup', endPointer);
                wrapper.addEventListener('pointercancel', function(e) {
                    ppPointers.delete(e.pointerId);
                    if (ppPointers.size === 0) {
                        img.classList.remove('dragging');
                        ppStart = null;
                        if (ppTrackSnapping) {
                            ppTrackSnapping = false;
                            ppSwipeLock = 0;
                            if (ppRafId) { cancelAnimationFrame(ppRafId); ppRafId = null; }
                        }
                        ppTrackDrag = 0;
                        ppApplySlideTrack();
                    }
                });

                wrapper.addEventListener('wheel', function(e) {
                    if (!photoPreviewActive) return;
                    e.preventDefault();
                    var next = Math.max(1, Math.min(5, ppZoom.scale * (1 - e.deltaY * 0.002)));
                    ppZoom.scale = next;
                    if (next <= 1.01) {
                        ppResetZoom();
                    } else {
                        ppApplyImageTransform();
                    }
                }, { passive: false });
            })();

            function initPhotoWall() {
                if (!photoWallRealtime && window.sb) {
                    photoWallRealtime = window.sb.channel('photo-wall')
                        .on('postgres_changes', {
                            event: '*',
                            schema: 'public',
                            table: 'posts',
                            filter: 'media_type=eq.' + PHOTO_WALL_MARKER
                        }, function() {
                            if (photoPreviewActive || document.body.classList.contains('photo-previewing')) return;
                            if (Date.now() - photoPreviewClosedAt < 1000) return;
                            renderPhotoWall();
                        })
                        .subscribe();
                }

                // 照片墙导航栏滚动自动隐藏/显示
                var panelAi = document.getElementById('panelAi');
                if (panelAi) {
                    var pwLastScroll = 0;
                    var pwScrollThreshold = 20;
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

                renderPhotoWall();
            }
            window.initPhotoWall = initPhotoWall;

            // ========== 懒加载观察器：blur-in → sharp ==========
            var pwLazyObserver = null;
            function pwObserveLazyImages(grid) {
                if (pwLazyObserver) pwLazyObserver.disconnect();
                if (!window.IntersectionObserver) {
                    // fallback: 直接触发所有图片
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

            // ========== 预览指示点更新 ==========
            function ppUpdateDots() {
                var dots = document.getElementById('ppDots');
                if (!dots) return;
                var total = ppSortedPhotos.length;
                if (total <= 1) { dots.innerHTML = ''; return; }
                var html = '';
                for (var i = 0; i < total; i++) {
                    html += '<span class="pp-dot' + (i === ppPhotoIdx ? ' active' : '') + '"></span>';
                }
                dots.innerHTML = html;
            }

            // ========== 分享当前照片 ==========
            window.shareCurrentPhoto = function() {
                var photo = ppSortedPhotos[ppPhotoIdx];
                if (!photo) return;
                var url = photo.imageUrl;
                if (navigator.share) {
                    navigator.share({ title: '分享照片', text: '来自 xtj 照片墙', url: url }).catch(function() {});
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(function() {
                        showToast('链接已复制到剪贴板');
                    }).catch(function() {
                        showToast('链接：' + url);
                    });
                } else {
                    var ta = document.createElement('textarea');
                    ta.value = url;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    showToast('链接已复制');
                }
            };

            // ========== 显示照片信息 ==========
            window.showPhotoInfo = function() {
                var photo = ppSortedPhotos[ppPhotoIdx];
                if (!photo) return;

                var modal = document.getElementById('ppInfoModal');
                var body = document.getElementById('ppInfoModalBody');

                // 格式化文件大小
                function formatSize(bytes) {
                    if (!bytes) return '未知';
                    var sizes = ['B', 'KB', 'MB', 'GB'];
                    var i = 0;
                    var b = parseInt(bytes, 10);
                    while (b >= 1024 && i < sizes.length - 1) { b /= 1024; i++; }
                    return b.toFixed(2) + ' ' + sizes[i];
                }

                // 格式化日期
                function formatFullDate(ts) {
                    var d = new Date(ts || Date.now());
                    var y = d.getFullYear();
                    var m = String(d.getMonth() + 1).padStart(2, '0');
                    var da = String(d.getDate()).padStart(2, '0');
                    var h = String(d.getHours()).padStart(2, '0');
                    var mi = String(d.getMinutes()).padStart(2, '0');
                    var s = String(d.getSeconds()).padStart(2, '0');
                    return y + '-' + m + '-' + da + ' ' + h + ':' + mi + ':' + s;
                }

                body.innerHTML = '';

                // 添加信息项
                var items = [
                    { label: '发布人', value: photo.username || '未知用户' },
                    { label: '发布时间', value: formatFullDate(photo.timestamp) },
                    { label: '文件大小', value: formatSize(photo.fileSize) },
                    { label: '浏览次数', value: (photo.views || 0) + ' 次' },
                    { label: '照片ID', value: photo.id || '未知' }
                ];

                items.forEach(function(item) {
                    var div = document.createElement('div');
                    div.className = 'pp-info-item';
                    div.innerHTML = '<div class="pp-info-label">' + escapeHtml(item.label) + '</div><div class="pp-info-value">' + escapeHtml(item.value) + '</div>';
                    body.appendChild(div);
                });

                modal.style.display = 'flex';
            };

            // ========== 关闭照片信息 ==========
            window.closePhotoInfo = function() {
                var modal = document.getElementById('ppInfoModal');
                if (modal) modal.style.display = 'none';
            };

            // ========== 删除确认弹窗 ==========
            window.confirmDeletePhoto = function(photoId) {
                var existing = document.querySelector('.pw-confirm-dialog');
                if (existing) existing.remove();

                var dialog = document.createElement('div');
                dialog.className = 'pw-confirm-dialog';
                dialog.innerHTML = '<div class="pw-confirm-card">' +
                    '<div class="pw-confirm-title">删除照片</div>' +
                    '<div class="pw-confirm-text">确定要删除这张照片吗？此操作不可撤销。</div>' +
                    '<div class="pw-confirm-actions">' +
                    '<button class="pw-confirm-cancel">取消</button>' +
                    '<button class="pw-confirm-danger">确认删除</button>' +
                    '</div></div>';
                dialog.querySelector('.pw-confirm-cancel').onclick = function() { dialog.remove(); };
                dialog.querySelector('.pw-confirm-danger').onclick = function() { dialog.remove(); window.doDeletePhoto(photoId); };
                dialog.onclick = function(e) { if (e.target === dialog) dialog.remove(); };
                document.body.appendChild(dialog);
            };

            // ========== 执行删除照片 ==========
            window.doDeletePhoto = async function(photoId) {
                // 统一转换为字符串比较，兼容 Supabase 数字 ID
                var targetId = String(photoId);
                var idx = -1;
                for (var i = 0; i < photoWallData.length; i++) {
                    if (String(photoWallData[i].id) === targetId) { idx = i; break; }
                }
                if (idx < 0) { showToast('照片不存在'); return; }
                var photo = photoWallData[idx];

                // 记录已删除ID（防止云端同步延迟导致刷新后重新出现）
                addDeletedPhotoId(targetId);

                // 删除云端数据：posts记录 + Storage文件
                if (photo.cloudId && window.sb) {
                    try {
                        var { error: deleteDbErr } = await window.sb.from('posts').delete().eq('id', photo.cloudId);
                        if (deleteDbErr) console.error('删除云端记录失败:', deleteDbErr);
                    } catch(e) { console.error('删除云端记录异常:', e); }

                    // 尝试删除 Storage 中的照片文件
                    try {
                        var storagePath = extractStoragePath(photo.imageUrl);
                        if (storagePath) {
                            var { error: removeErr } = await window.sb.storage.from('uploads').remove([storagePath]);
                            if (removeErr) console.error('删除云端文件失败:', removeErr);
                        }
                    } catch(e) { console.error('删除云端文件异常:', e); }
                }

                // 删除本地数据
                photoWallData.splice(idx, 1);
                saveLocalPhotoWallData();

                // 如果正在预览该照片，先关闭预览再刷新
                if (photoPreviewActive && photoPreviewCurrent) {
                    if (String(photoPreviewCurrent.id) === targetId || String(photoPreviewCurrent.cloudId) === targetId) {
                        closePhotoPreview();
                    }
                }

                // 重新渲染 - 不重新从云端加载数据
                renderPhotoWallWithoutReload();
                showToast('照片已删除');
            };

            // 从 Supabase public URL 提取 Storage 路径
            function extractStoragePath(url) {
                if (!url) return null;
                // URL 格式: https://xxx.supabase.co/storage/v1/object/public/uploads/photos/xxx
                var match = url.match(/\/uploads\/(.+?)(?:\?|$)/);
                return match ? decodeURIComponent(match[1]) : null;
            }

            // 渲染照片墙但不重新从云端加载数据
            function renderPhotoWallWithoutReload() {
                var grid = document.getElementById('photoGrid');
                if (!grid) return;

                // TODO: 虚拟滚动 - 与 renderPhotoWall 共用同一套虚拟滚动逻辑

                if (photoWallData.length === 0) {
                    grid.innerHTML = '<div class="photo-wall-empty">' +
                        '<div class="photo-wall-empty-icon">📷</div>' +
                        '<div>还没有照片</div>' +
                        '<div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">📤 成为第一个分享照片的人</div>' +
                        '</div>';
                    return;
                }

                var sorted = photoWallData.slice().sort(function(a, b) {
                    return b.timestamp - a.timestamp;
                });

                var html = '';
                for (var i = 0; i < sorted.length; i++) {
                    var p = sorted[i];
                    var timeStr = formatPhotoTime(p.timestamp);
                    var name = p.username || '未知用户';
                    html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + escapeHtml(p.id) + '" style="animation-delay:' + (i * 50) + 'ms" onclick="openPhotoPreview(' + i + ')">';
                    var gridSrc = p.thumbUrl || p.imageUrl;
                    html += '<img src="' + gridSrc + '" alt="photo" class="pw-blur-in" data-src="' + gridSrc + '">';
                    html += '<div class="pw-item-info">';
                    html += '<div class="pw-item-name">' + escapeHtml(name) + '</div>';
                    html += '<div class="pw-item-meta"><span>' + timeStr + '</span><span>浏览 <b class="pw-view-count">' + (p.views || 0) + '</b></span></div>';
                    html += '</div></div>';
                }
                grid.innerHTML = html;

                // 交错入场动画
                requestAnimationFrame(function() {
                    var items = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
                    items.forEach(function(item, idx) {
                        setTimeout(function() {
                            item.classList.add('pw-stagger-done');
                            item.classList.remove('pw-stagger-enter');
                        }, 0);
                    });
                });

                // 初始化懒加载
                pwObserveLazyImages(grid);
            }

            // ========== 预览中删除 ==========
            window.deleteCurrentPhoto = function() {
                var photo = ppSortedPhotos[ppPhotoIdx];
                if (!photo) return;
                confirmDeletePhoto(photo.id);
            };

            // Listen for file input changes
            document.addEventListener('change', function(e) {
                if (e.target && e.target.id === 'photoFileInput') {
                    window.handlePhotoUpload(e);
                }
            });


        })();