(function() {
    window.photoWallData = [];

    var photoWallKey = 'xtj_photos';
    var photoWallDeletedKey = 'xtj_photos_deleted';
    var photoWallLastSyncKey = 'xtj_photos_sync';
    var photoWallSyncChannel = 'xtj_photo_sync';

    var PHOTO_WALL_MARKER = '__photo_wall__';
    window.PHOTO_WALL_MARKER = PHOTO_WALL_MARKER;
    var photoWallMigrating = false;

    var pageSize = 20;
    var currentPage = 0;
    var hasMore = true;
    var isLoading = false;
    
    // 实时订阅句柄
    var realtimeSubscription = null;
    var isSubscribed = false;
    var subscriptionRetryTimer = null;
    
    // 多设备同步：BroadcastChannel API
    var syncChannel = null;
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            syncChannel = new BroadcastChannel(photoWallSyncChannel);
            syncChannel.onmessage = function(event) {
                if (event.data && event.data.type === 'photo_deleted') {
                    var deletedId = String(event.data.photoId);
                    // 从当前数据中移除
                    var idx = window.photoWallData.findIndex(function(p) {
                        return String(p.id) === deletedId;
                    });
                    if (idx >= 0) {
                        window.photoWallData.splice(idx, 1);
                        saveLocalPhotoWallData();
                        // 刷新UI
                        if (window.renderPhotoWallWithoutReload) {
                            window.renderPhotoWallWithoutReload();
                        }
                        window.showToast('照片已被其他设备删除');
                    }
                } else if (event.data && event.data.type === 'photo_added') {
                    // 有新照片上传，刷新数据
                    setTimeout(function() {
                        fetchLatestPhotos();
                    }, 800);
                }
            };
        } catch(e) {
            console.warn('BroadcastChannel不支持:', e);
        }
    }
    
    // 发送同步消息
    function broadcastSync(type, data) {
        if (syncChannel) {
            try {
                syncChannel.postMessage({ type: type, ...data, ts: Date.now() });
            } catch(e) {}
        }
        // 同时更新localStorage用于跨标签页同步
        try {
            var syncData = JSON.parse(localStorage.getItem('xtj_photo_sync_data') || '{}');
            syncData.lastUpdate = Date.now();
            syncData.lastAction = type;
            syncData.lastPhotoId = data.photoId;
            localStorage.setItem('xtj_photo_sync_data', JSON.stringify(syncData));
        } catch(e) {}
    }
    window.broadcastSync = broadcastSync;
    
    // localStorage备用同步方案（用于不支持BroadcastChannel的环境）
    var lastLocalStorageTs = 0;
    window.addEventListener('storage', function(event) {
        if (event.key === 'xtj_photo_sync_data') {
            try {
                var syncData = JSON.parse(event.newValue || '{}');
                // 防抖，避免重复处理
                if (syncData.lastUpdate && syncData.lastUpdate <= lastLocalStorageTs) return;
                lastLocalStorageTs = syncData.lastUpdate;
                
                if (syncData.lastAction === 'photo_deleted' && syncData.lastPhotoId) {
                    var deletedId = String(syncData.lastPhotoId);
                    var idx = window.photoWallData.findIndex(function(p) {
                        return String(p.id) === deletedId;
                    });
                    if (idx >= 0) {
                        window.photoWallData.splice(idx, 1);
                        saveLocalPhotoWallData();
                        if (window.renderPhotoWallWithoutReload) {
                            window.renderPhotoWallWithoutReload();
                        }
                        window.showToast('照片已被其他设备删除');
                    }
                } else if (syncData.lastAction === 'photo_added') {
                    setTimeout(function() {
                        fetchLatestPhotos();
                    }, 800);
                }
            } catch(e) {}
        }
    });
    
    // 建立Supabase实时订阅（主同步机制）
    function setupRealtimeSubscription() {
        if (isSubscribed || !window.sb) return;
        
        try {
            // 先清理旧的订阅
            if (realtimeSubscription) {
                try {
                    window.sb.removeChannel(realtimeSubscription);
                } catch(e) {}
            }
            
            realtimeSubscription = window.sb
                .channel('photo-wall-realtime', {
                    config: {
                        broadcast: { self: true },
                        presence: { key: 'photo-wall' }
                    }
                })
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'posts',
                        filter: 'media_type=eq.' + PHOTO_WALL_MARKER
                    },
                    function(payload) {
                        console.log('[Realtime] 收到照片墙更新:', payload);
                        
                        if (payload.eventType === 'INSERT') {
                            // 新照片添加
                            var newPhoto = normalizePhotoWallRow(payload.new);
                            if (newPhoto && newPhoto.id) {
                                var existingIdx = window.photoWallData.findIndex(function(p) {
                                    return String(p.id) === String(newPhoto.id);
                                });
                                if (existingIdx < 0) {
                                    window.photoWallData.unshift(newPhoto);
                                    saveLocalPhotoWallData();
                                    if (window.renderPhotoWallWithoutReload) {
                                        window.renderPhotoWallWithoutReload();
                                    }
                                    // 不在这再showToast了，避免重复提示
                                }
                            }
                        } else if (payload.eventType === 'DELETE') {
                            // 照片删除
                            var deletedId = String(payload.old.id);
                            var idx = window.photoWallData.findIndex(function(p) {
                                return String(p.id) === deletedId;
                            });
                            if (idx >= 0) {
                                window.photoWallData.splice(idx, 1);
                                saveLocalPhotoWallData();
                                if (window.renderPhotoWallWithoutReload) {
                                    window.renderPhotoWallWithoutReload();
                                }
                                window.showToast('照片已删除');
                            }
                        } else if (payload.eventType === 'UPDATE') {
                            // 照片更新
                            var updatedPhoto = normalizePhotoWallRow(payload.new);
                            if (updatedPhoto && updatedPhoto.id) {
                                var idx = window.photoWallData.findIndex(function(p) {
                                    return String(p.id) === String(updatedPhoto.id);
                                });
                                if (idx >= 0) {
                                    window.photoWallData[idx] = updatedPhoto;
                                    saveLocalPhotoWallData();
                                    if (window.renderPhotoWallWithoutReload) {
                                        window.renderPhotoWallWithoutReload();
                                    }
                                }
                            }
                        }
                    }
                )
                .subscribe(function(status) {
                    console.log('[Realtime] 订阅状态:', status);
                    isSubscribed = status === 'SUBSCRIBED';
                    
                    if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                        // 订阅断开，延迟重试
                        isSubscribed = false;
                        if (subscriptionRetryTimer) {
                            clearTimeout(subscriptionRetryTimer);
                        }
                        subscriptionRetryTimer = setTimeout(function() {
                            setupRealtimeSubscription();
                        }, 3000);
                    }
                });
        } catch(e) {
            console.error('[Realtime] 建立订阅失败:', e);
            // 失败重试
            if (subscriptionRetryTimer) {
                clearTimeout(subscriptionRetryTimer);
            }
            subscriptionRetryTimer = setTimeout(function() {
                setupRealtimeSubscription();
            }, 5000);
        }
    }
    window.setupRealtimeSubscription = setupRealtimeSubscription;
    
    // 清理实时订阅
    function cleanupRealtimeSubscription() {
        if (subscriptionRetryTimer) {
            clearTimeout(subscriptionRetryTimer);
            subscriptionRetryTimer = null;
        }
        if (realtimeSubscription && window.sb) {
            try {
                window.sb.removeChannel(realtimeSubscription);
            } catch(e) {
                console.warn('[Realtime] 清理订阅失败:', e);
            }
            realtimeSubscription = null;
        }
        isSubscribed = false;
    }
    window.cleanupRealtimeSubscription = cleanupRealtimeSubscription;

    function getDeletedPhotoIds() {
        try {
            return window.safeLocalStorageGetJSON(photoWallDeletedKey, []);
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
    window.addDeletedPhotoId = addDeletedPhotoId;

    function cleanDeletedIds() {
        try {
            localStorage.removeItem(photoWallDeletedKey);
        } catch(e) {}
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
    window.normalizePhotoWallRow = normalizePhotoWallRow;

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

    async function loadPhotoWallPage(pageNum = 0) {
        if (!window.sb) return [];
        try {
            var res = await window.sb.from('posts')
                .select('id,user_name,media_url,content,created_at,views')
                .eq('media_type', PHOTO_WALL_MARKER)
                .order('created_at', { ascending: false })
                .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);
            if (res.error) throw res.error;
            return (res.data || []).map(normalizePhotoWallRow).filter(function(p) { return !!p.imageUrl; });
        } catch(e) {
            console.error('加载照片墙分页失败:', e);
            return [];
        }
    }

    async function loadPhotoWallData(forceRefresh) {
        var localData = loadLocalPhotoWallData();
        currentPage = 0;
        hasMore = true;
        isLoading = false;

        if (!window.sb) {
            window.photoWallData = localData;
            return window.photoWallData;
        }

        try {
            await migrateLocalPhotosToCloud(localData);

            var lastSync = localStorage.getItem(photoWallLastSyncKey);
            var shouldQuickLoad = !forceRefresh && lastSync && (Date.now() - parseInt(lastSync) < 300000);

            if (shouldQuickLoad && localData.length > 0) {
                window.photoWallData = localData;
                setTimeout(fetchLatestPhotos, 500);
                // 启动实时订阅
                setTimeout(setupRealtimeSubscription, 1000);
                return window.photoWallData;
            }

            // 强制刷新时清除旧缓存
            if (forceRefresh) {
                try {
                    localStorage.removeItem(photoWallLastSyncKey);
                } catch(e) {}
            }

            var firstPage = await loadPhotoWallPage(0);
            var deletedIds = getDeletedPhotoIds();
            
            if (deletedIds.length > 0) {
                firstPage = firstPage.filter(function(p) {
                    return deletedIds.indexOf(String(p.id)) < 0;
                });
            }

            window.photoWallData = firstPage;
            hasMore = firstPage.length >= pageSize;
            localStorage.setItem(photoWallLastSyncKey, Date.now().toString());
            saveLocalPhotoWallData();

            // 启动实时订阅
            setTimeout(setupRealtimeSubscription, 500);

            return window.photoWallData;
        } catch(e) {
            console.error('加载云端照片墙失败:', e);
            window.photoWallData = localData;
            return window.photoWallData;
        }
    }
    window.loadPhotoWallData = loadPhotoWallData;

    async function fetchLatestPhotos() {
        if (!window.sb || !window.currentUser) return;
        try {
            var latest = await window.sb.from('posts')
                .select('id,user_name,media_url,content,created_at,views')
                .eq('media_type', PHOTO_WALL_MARKER)
                .order('created_at', { ascending: false })
                .limit(5);
            if (latest.error) return;
            
            var existingIds = new Set(window.photoWallData.map(function(p) { return String(p.id); }));
            var deletedIds = getDeletedPhotoIds();
            
            for (var i = 0; i < latest.data.length; i++) {
                var row = latest.data[i];
                var id = String(row.id);
                if (!existingIds.has(id) && deletedIds.indexOf(id) < 0) {
                    var normalized = normalizePhotoWallRow(row);
                    if (normalized.imageUrl) {
                        window.photoWallData.unshift(normalized);
                    }
                }
            }
            
            saveLocalPhotoWallData();
            if (window.renderPhotoWallWithoutReload) {
                window.renderPhotoWallWithoutReload();
            }
        } catch(e) {}
    }

    async function loadMorePhotos() {
        if (isLoading || !hasMore || !window.sb) return false;
        isLoading = true;
        
        try {
            currentPage++;
            var pageData = await loadPhotoWallPage(currentPage);
            var deletedIds = getDeletedPhotoIds();
            
            pageData = pageData.filter(function(p) {
                return deletedIds.indexOf(String(p.id)) < 0;
            });

            if (pageData.length > 0) {
                window.photoWallData = window.photoWallData.concat(pageData);
                saveLocalPhotoWallData();
                hasMore = pageData.length >= pageSize;
                return true;
            } else {
                hasMore = false;
                return false;
            }
        } catch(e) {
            console.error('加载更多照片失败:', e);
            hasMore = false;
            return false;
        } finally {
            isLoading = false;
        }
    }
    window.loadMorePhotos = loadMorePhotos;

    function hasMorePhotos() {
        return hasMore && !isLoading;
    }
    window.hasMorePhotos = hasMorePhotos;

    function saveLocalPhotoWallData() {
        try {
            localStorage.setItem(photoWallKey, JSON.stringify(window.photoWallData.slice(0, 100)));
        } catch (e) {}
    }
    window.saveLocalPhotoWallData = saveLocalPhotoWallData;
    
    // 从Supabase Storage URL提取存储路径
    function extractStoragePath(url) {
        if (!url) return null;
        try {
            var urlObj = new URL(url);
            var pathMatch = urlObj.pathname.match(/\/object\/public\/uploads\/(.*)/);
            if (pathMatch) {
                return decodeURIComponent(pathMatch[1]);
            }
            // 备用匹配模式
            var altMatch = urlObj.pathname.match(/\/uploads\/(.*)/);
            if (altMatch) {
                return decodeURIComponent(altMatch[1]);
            }
        } catch(e) {}
        return null;
    }
    window.extractStoragePath = extractStoragePath;

    function updatePhotoViewDisplays(photo) {
        if (!photo) return;
        var previewCount = document.getElementById('photoPreviewViewsCount');
        if (previewCount && window.photoPreviewCurrent && window.photoPreviewCurrent.id === photo.id) {
            previewCount.textContent = photo.views || 0;
        }
        var item = document.querySelector('.photo-wall-item[data-photo-id="' + String(photo.id).replace(/"/g, '\\"') + '"] .pw-view-count');
        if (item) item.textContent = photo.views || 0;
    }
    window.updatePhotoViewDisplays = updatePhotoViewDisplays;

    async function syncPhotoViewCount(photo) {
        if (!photo || !photo.cloudId || !window.sb) return;
        try {
            await window.sb.rpc('increment_post_views', { p_post_id: photo.cloudId });
            var res = await window.sb.from('posts').select('views').eq('id', photo.cloudId).maybeSingle();
            if (res && res.data && typeof res.data.views === 'number') {
                photo.views = res.data.views;
                var cached = window.photoWallData.find(function(p) { return p.id === photo.id || p.cloudId === photo.cloudId; });
                if (cached) cached.views = photo.views;
                saveLocalPhotoWallData();
                updatePhotoViewDisplays(photo);
            }
        } catch(e) {
            updatePhotoViewDisplays(photo);
        }
    }
    window.syncPhotoViewCount = syncPhotoViewCount;

    function extractStoragePath(url) {
        if (!url) return null;
        var match = url.match(/\/uploads\/(.+?)(?:\?|$)/);
        return match ? decodeURIComponent(match[1]) : null;
    }
    window.extractStoragePath = extractStoragePath;
})();