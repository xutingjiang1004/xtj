(function() {
    window.photoWallData = [];

    var photoWallKey = 'xtj_photos';
    var photoWallDeletedKey = 'xtj_photos_deleted';
    var photoWallLastSyncKey = 'xtj_photos_sync';
    var photoWallSyncChannel = 'xtj_photo_sync';
    var photoWallSyncDataKey = 'xtj_photo_sync_data';
    var photoWallPendingDeleteKey = 'xtj_photos_pending_deletes';
    var PHOTO_WALL_MARKER = '__photo_wall__';

    var pageSize = 20;
    var currentPage = 0;
    var hasMore = true;
    var isLoading = false;
    var photoWallMigrating = false;
    var reconcileTimer = null;
    var deleteQueueTimer = null;
    var deleteQueueRunning = false;
    var syncStatusState = 'idle';
    var syncStatusMessage = '已同步';
    var isSubscribed = false;
    var realtimeSubscription = null;
    var subscriptionRetryTimer = null;
    var syncChannel = null;
    var lastLocalStorageTs = 0;

    window.PHOTO_WALL_MARKER = PHOTO_WALL_MARKER;

    function getSyncStatusElements() {
        return {
            wrap: document.getElementById('pwSyncStatus'),
            label: document.getElementById('pwSyncLabel')
        };
    }

    function setPhotoWallSyncStatus(state, message) {
        syncStatusState = state || 'idle';
        syncStatusMessage = message || syncStatusMessage || '已同步';

        var els = getSyncStatusElements();
        if (!els.wrap || !els.label) return;

        els.wrap.classList.remove('is-idle', 'is-synced', 'is-syncing', 'is-offline', 'is-error');
        els.wrap.classList.add('is-' + syncStatusState);
        els.label.textContent = syncStatusMessage;
    }
    window.setPhotoWallSyncStatus = setPhotoWallSyncStatus;

    function refreshSyncStatus() {
        var pending = getPendingDeleteQueue();
        if (pending.length > 0) {
            if (navigator.onLine === false) {
                setPhotoWallSyncStatus('offline', '离线待同步 ' + pending.length);
            } else if (deleteQueueRunning) {
                setPhotoWallSyncStatus('syncing', '正在同步删除 ' + pending.length);
            } else {
                setPhotoWallSyncStatus('error', '待重试 ' + pending.length);
            }
            return;
        }
        if (navigator.onLine === false) {
            setPhotoWallSyncStatus('offline', '当前离线');
            return;
        }
        if (window.sb && !isSubscribed) {
            setPhotoWallSyncStatus('syncing', '同步连接中');
            return;
        }
        setPhotoWallSyncStatus('synced', '已同步');
    }

    function getDeletedPhotoIds() {
        try {
            return window.safeLocalStorageGetJSON(photoWallDeletedKey, []);
        } catch (e) {
            return [];
        }
    }

    function addDeletedPhotoId(id) {
        var ids = getDeletedPhotoIds();
        var sid = String(id);
        if (ids.indexOf(sid) < 0) {
            ids.push(sid);
            try {
                localStorage.setItem(photoWallDeletedKey, JSON.stringify(ids.slice(-400)));
            } catch (e) {}
        }
    }
    window.addDeletedPhotoId = addDeletedPhotoId;

    function cleanDeletedIds() {
        try {
            localStorage.removeItem(photoWallDeletedKey);
        } catch (e) {}
    }
    window.cleanDeletedIds = cleanDeletedIds;

    function getPendingDeleteQueue() {
        try {
            var queue = window.safeLocalStorageGetJSON(photoWallPendingDeleteKey, []);
            return Array.isArray(queue) ? queue : [];
        } catch (e) {
            return [];
        }
    }

    function savePendingDeleteQueue(queue) {
        try {
            localStorage.setItem(photoWallPendingDeleteKey, JSON.stringify(queue || []));
        } catch (e) {}
        refreshSyncStatus();
    }

    function upsertPendingDelete(entry) {
        if (!entry || !entry.id) return;
        var queue = getPendingDeleteQueue();
        var id = String(entry.id);
        var idx = queue.findIndex(function(item) { return String(item.id) === id; });
        if (idx >= 0) {
            queue[idx] = Object.assign({}, queue[idx], entry);
        } else {
            queue.push(entry);
        }
        savePendingDeleteQueue(queue);
    }

    function removePendingDelete(photoId) {
        var id = String(photoId);
        var queue = getPendingDeleteQueue().filter(function(item) {
            return String(item.id) !== id;
        });
        savePendingDeleteQueue(queue);
    }

    function loadLocalPhotoWallData() {
        try {
            var saved = localStorage.getItem(photoWallKey);
            var localData = saved ? JSON.parse(saved) : [];
            return localData.filter(function(p) {
                return p && p.imageUrl && p.imageUrl.indexOf('data:') !== 0;
            });
        } catch (e) {
            return [];
        }
    }

    function saveLocalPhotoWallData() {
        try {
            localStorage.setItem(photoWallKey, JSON.stringify(window.photoWallData.slice(0, 120)));
        } catch (e) {}
    }
    window.saveLocalPhotoWallData = saveLocalPhotoWallData;

    function normalizePhotoWallRow(row) {
        var extra = {};
        try {
            extra = row && row.content ? JSON.parse(row.content) : {};
        } catch (e) {}

        return {
            id: row.id,
            cloudId: row.id,
            username: row.user_name || extra.username || '未知用户',
            imageUrl: row.media_url || extra.imageUrl || '',
            thumbUrl: extra.thumb || '',
            timestamp: row.created_at ? Date.parse(row.created_at) : (extra.timestamp || Date.now()),
            views: typeof row.views === 'number' ? row.views : (extra.views || 0),
            actor_key: row.actor_key || extra.actor_key || window.deviceId || '',
            fileSize: extra.fileSize || null,
            exif: extra.exif || null
        };
    }
    window.normalizePhotoWallRow = normalizePhotoWallRow;

    function extractStoragePath(url) {
        if (!url) return null;
        try {
            var urlObj = new URL(url);
            var pathMatch = urlObj.pathname.match(/\/object\/public\/uploads\/(.*)/);
            if (pathMatch && pathMatch[1]) {
                return decodeURIComponent(pathMatch[1]);
            }
            var altMatch = urlObj.pathname.match(/\/uploads\/(.*)/);
            if (altMatch && altMatch[1]) {
                return decodeURIComponent(altMatch[1]);
            }
        } catch (e) {}
        return null;
    }
    window.extractStoragePath = extractStoragePath;

    function updatePhotoViewDisplays(photo) {
        if (!photo) return;
        var previewCount = document.getElementById('photoPreviewViewsCount');
        if (previewCount && window.photoPreviewCurrent && String(window.photoPreviewCurrent.id) === String(photo.id)) {
            previewCount.textContent = photo.views || 0;
        }
        var selector = '.photo-wall-item[data-photo-id="' + String(photo.id).replace(/"/g, '\\"') + '"] .pw-view-count';
        var item = document.querySelector(selector);
        if (item) item.textContent = photo.views || 0;
    }
    window.updatePhotoViewDisplays = updatePhotoViewDisplays;

    function persistAndRender(renderNow) {
        saveLocalPhotoWallData();
        if (renderNow === false) return;
        if (window.renderPhotoWallWithoutReload) {
            window.renderPhotoWallWithoutReload();
        }
    }

    function removePhotoLocallyById(photoId, options) {
        options = options || {};
        var id = String(photoId);
        var next = [];
        var removed = null;

        for (var i = 0; i < window.photoWallData.length; i++) {
            var photo = window.photoWallData[i];
            if (photo && String(photo.id) === id) {
                removed = photo;
                continue;
            }
            next.push(photo);
        }

        if (removed) {
            window.photoWallData = next;
            persistAndRender(options.render !== false);
        }

        return removed;
    }

    function upsertPhotoLocally(photo, options) {
        options = options || {};
        if (!photo || !photo.id || !photo.imageUrl) return false;
        if (getDeletedPhotoIds().indexOf(String(photo.id)) >= 0) return false;

        var idx = window.photoWallData.findIndex(function(item) {
            return item && String(item.id) === String(photo.id);
        });
        var changed = false;

        if (idx >= 0) {
            var prev = window.photoWallData[idx];
            var merged = Object.assign({}, prev, photo);
            if (JSON.stringify(prev) !== JSON.stringify(merged)) {
                window.photoWallData[idx] = merged;
                changed = true;
            }
        } else {
            window.photoWallData.unshift(photo);
            changed = true;
        }

        if (changed) {
            persistAndRender(options.render !== false);
        }
        return changed;
    }

    function sortByNewest(data) {
        return data.slice().sort(function(a, b) {
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
    }

    function mergeRemoteAndLocal(remotePhotos, localPhotos) {
        var deletedIds = getDeletedPhotoIds();
        var pendingIds = new Set(getPendingDeleteQueue().map(function(item) { return String(item.id); }));
        var byId = new Map();

        remotePhotos.forEach(function(photo) {
            if (!photo || !photo.id || !photo.imageUrl) return;
            var id = String(photo.id);
            if (deletedIds.indexOf(id) >= 0 || pendingIds.has(id)) return;
            byId.set(id, photo);
        });

        localPhotos.forEach(function(photo) {
            if (!photo || !photo.id || !photo.imageUrl) return;
            var id = String(photo.id);
            if (deletedIds.indexOf(id) >= 0 || pendingIds.has(id)) return;
            if (!byId.has(id)) byId.set(id, photo);
        });

        return sortByNewest(Array.from(byId.values()));
    }

    function broadcastSync(type, data) {
        var payload = Object.assign({ type: type, ts: Date.now() }, data || {});
        if (syncChannel) {
            try {
                syncChannel.postMessage(payload);
            } catch (e) {}
        }
        try {
            localStorage.setItem(photoWallSyncDataKey, JSON.stringify(payload));
        } catch (e) {}
    }
    window.broadcastSync = broadcastSync;

    function handlePhotoDeleted(photoId, source) {
        if (!photoId) return;
        addDeletedPhotoId(photoId);
        removePendingDelete(photoId);
        var removed = removePhotoLocallyById(photoId, { render: true });
        if (removed && source && source !== 'local') {
            window.showToast('照片已在其他设备删除');
        }
        refreshSyncStatus();
    }

    function handleSyncPayload(payload, source) {
        if (!payload || !payload.type) return;
        if (payload.type === 'photo_deleted' && payload.photoId) {
            handlePhotoDeleted(payload.photoId, source || 'external');
            return;
        }
        if (payload.type === 'photo_added') {
            setTimeout(function() {
                fetchLatestPhotos();
                reconcilePhotoWallData();
            }, 500);
        }
    }

    if (typeof BroadcastChannel !== 'undefined') {
        try {
            syncChannel = new BroadcastChannel(photoWallSyncChannel);
            syncChannel.onmessage = function(event) {
                handleSyncPayload(event.data, 'broadcast');
            };
        } catch (e) {
            syncChannel = null;
        }
    }

    window.addEventListener('storage', function(event) {
        if (event.key !== photoWallSyncDataKey) return;
        try {
            var syncData = JSON.parse(event.newValue || '{}');
            if (!syncData.ts || syncData.ts <= lastLocalStorageTs) return;
            lastLocalStorageTs = syncData.ts;
            handleSyncPayload(syncData, 'storage');
        } catch (e) {}
    });

    async function deletePhotoCloudRecord(entry) {
        if (!window.sb || !entry || !entry.cloudId) return false;

        try {
            var res = await window.sb
                .from('posts')
                .delete()
                .eq('id', entry.cloudId)
                .select('id');
            if (res && !res.error) return true;
        } catch (e) {}

        var actorKey = entry.actor_key || entry.actorKey || window.deviceId || '';
        if (!actorKey) return false;

        var rpcRes = await window.sb.rpc('delete_post_with_actor', {
            p_post_id: entry.cloudId,
            p_actor_key: actorKey
        });
        if (rpcRes && rpcRes.error) throw rpcRes.error;
        return true;
    }

    async function cleanupPhotoStorage(entry) {
        if (!window.sb || !entry) return;
        var paths = [];
        if (entry.imageUrl) {
            var imagePath = extractStoragePath(entry.imageUrl);
            if (imagePath) paths.push(imagePath);
        }
        if (entry.thumbUrl) {
            var thumbPath = extractStoragePath(entry.thumbUrl);
            if (thumbPath && paths.indexOf(thumbPath) < 0) paths.push(thumbPath);
        }
        if (!paths.length) return;

        try {
            await window.sb.storage.from('uploads').remove(paths);
        } catch (e) {
            console.warn('[PhotoWall] storage cleanup skipped', e);
        }
    }

    function scheduleDeleteQueue(delay) {
        if (deleteQueueTimer) clearTimeout(deleteQueueTimer);
        deleteQueueTimer = setTimeout(function() {
            deleteQueueTimer = null;
            processPendingDeletes();
        }, typeof delay === 'number' ? delay : 1200);
    }

    async function processPendingDeletes() {
        if (deleteQueueRunning) return;
        var queue = getPendingDeleteQueue();
        if (!queue.length) {
            refreshSyncStatus();
            return;
        }
        if (!window.sb) {
            setPhotoWallSyncStatus('offline', '本地待同步');
            return;
        }
        if (navigator.onLine === false) {
            setPhotoWallSyncStatus('offline', '离线待同步 ' + queue.length);
            return;
        }

        deleteQueueRunning = true;
        setPhotoWallSyncStatus('syncing', '正在同步删除 ' + queue.length);

        try {
            var nextQueue = getPendingDeleteQueue();
            for (var i = 0; i < nextQueue.length; i++) {
                var entry = nextQueue[i];
                try {
                    await deletePhotoCloudRecord(entry);
                    addDeletedPhotoId(entry.id);
                    removePhotoLocallyById(entry.id, { render: true });
                    broadcastSync('photo_deleted', { photoId: entry.id });
                    removePendingDelete(entry.id);
                    await cleanupPhotoStorage(entry);
                } catch (e) {
                    entry.retryCount = (entry.retryCount || 0) + 1;
                    entry.lastAttemptAt = Date.now();
                    entry.lastError = e && e.message ? e.message : 'sync_failed';
                    upsertPendingDelete(entry);
                    setPhotoWallSyncStatus('error', '同步异常，重试中');
                    scheduleDeleteQueue(Math.min(12000, 1500 * entry.retryCount));
                    break;
                }
            }
        } finally {
            deleteQueueRunning = false;
            refreshSyncStatus();
        }
    }

    function queuePhotoDeletion(photo) {
        if (!photo || !photo.id) return;
        if (!photo.cloudId) return;
        upsertPendingDelete({
            id: String(photo.id),
            cloudId: photo.cloudId,
            imageUrl: photo.imageUrl || '',
            thumbUrl: photo.thumbUrl || '',
            actor_key: photo.actor_key || photo.actorKey || window.deviceId || '',
            queuedAt: Date.now(),
            retryCount: 0
        });
    }

    window.deletePhotoWallPhoto = async function(photo, options) {
        options = options || {};
        if (!photo) return { ok: false };

        var id = String(photo.id || photo.cloudId || '');
        if (!id) return { ok: false };

        var isAdmin = window.currentUser === 'xxz';
        var isOwner = window.currentUser === photo.username;
        if (!isAdmin && !isOwner) {
            window.showToast('????????????');
            return { ok: false, error: 'unauthorized' };
        }

        if (photo.cloudId && window.sb) {
            try {
                var cloudDeleted = await deletePhotoCloudRecord(photo);
                if (!cloudDeleted) throw new Error('cloud_delete_failed');

                addDeletedPhotoId(id);
                removePhotoLocallyById(id, { render: options.render !== false });
                broadcastSync('photo_deleted', { photoId: id });
                await cleanupPhotoStorage(photo);
                refreshSyncStatus();
                return { ok: true, cloudDeleted: true };
            } catch (e) {
                console.error('[PhotoWall] cloud delete failed', e);
                window.showToast('???????????????');
                return { ok: false, error: e && e.message ? e.message : 'delete_failed' };
            }
        }

        addDeletedPhotoId(id);
        removePhotoLocallyById(id, { render: options.render !== false });
        broadcastSync('photo_deleted', { photoId: id });
        refreshSyncStatus();
        return { ok: true, localOnly: true };
    };

    async function migrateLocalPhotosToCloud(localData) {
        if (photoWallMigrating || !window.sb || !window.currentUser || !localData.length) return;
        if (localStorage.getItem('xtj_photos_migrated_v1') === '1') return;

        var candidates = localData.filter(function(photo) {
            return photo && photo.imageUrl && photo.imageUrl.indexOf('http') === 0 && !photo.cloudId;
        });
        if (!candidates.length) return;

        photoWallMigrating = true;
        var migratedOk = false;

        try {
            for (var i = 0; i < candidates.length; i++) {
                var photo = candidates[i];
                var exists = await window.sb.from('posts')
                    .select('id')
                    .eq('media_type', PHOTO_WALL_MARKER)
                    .eq('media_url', photo.imageUrl)
                    .limit(1);

                if (exists.data && exists.data.length) continue;

                await window.sb.from('posts').insert([{
                    user_name: photo.username || window.currentUser,
                    content: JSON.stringify({
                        type: 'photo_wall',
                        migrated: true,
                        timestamp: photo.timestamp || Date.now()
                    }),
                    media_url: photo.imageUrl,
                    media_type: PHOTO_WALL_MARKER,
                    actor_key: window.deviceId || 'photo_wall_migrated'
                }]);
            }
            migratedOk = true;
        } catch (e) {
            console.error('[PhotoWall] migrate local photos failed', e);
        } finally {
            if (migratedOk) localStorage.setItem('xtj_photos_migrated_v1', '1');
            photoWallMigrating = false;
        }
    }

    async function loadPhotoWallPage(pageNum) {
        if (!window.sb) return [];
        try {
            var res = await window.sb.from('posts')
                .select('id,user_name,media_url,content,created_at,views,actor_key')
                .eq('media_type', PHOTO_WALL_MARKER)
                .order('created_at', { ascending: false })
                .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);
            if (res.error) throw res.error;
            return (res.data || []).map(normalizePhotoWallRow).filter(function(photo) {
                return !!photo.imageUrl;
            });
        } catch (e) {
            console.error('[PhotoWall] load page failed', e);
            return [];
        }
    }

    async function loadPhotoWallData(forceRefresh) {
        var localData = loadLocalPhotoWallData();
        currentPage = 0;
        hasMore = true;
        isLoading = false;

        if (!window.sb) {
            window.photoWallData = mergeRemoteAndLocal([], localData);
            refreshSyncStatus();
            return window.photoWallData;
        }

        try {
            await migrateLocalPhotosToCloud(localData);

            var lastSync = localStorage.getItem(photoWallLastSyncKey);
            var shouldQuickLoad = !forceRefresh && lastSync && (Date.now() - parseInt(lastSync, 10) < 300000);

            if (shouldQuickLoad && localData.length > 0) {
                window.photoWallData = mergeRemoteAndLocal([], localData);
                setTimeout(fetchLatestPhotos, 300);
                setTimeout(reconcilePhotoWallData, 900);
                setTimeout(setupRealtimeSubscription, 600);
                scheduleDeleteQueue(120);
                refreshSyncStatus();
                return window.photoWallData;
            }

            if (forceRefresh) {
                try {
                    localStorage.removeItem(photoWallLastSyncKey);
                } catch (e) {}
            }

            var firstPage = await loadPhotoWallPage(0);
            window.photoWallData = mergeRemoteAndLocal(firstPage, localData);
            hasMore = firstPage.length >= pageSize;
            localStorage.setItem(photoWallLastSyncKey, Date.now().toString());
            saveLocalPhotoWallData();
            setTimeout(setupRealtimeSubscription, 200);
            scheduleDeleteQueue(60);
            refreshSyncStatus();
            return window.photoWallData;
        } catch (e) {
            console.error('[PhotoWall] load failed, using local cache', e);
            window.photoWallData = mergeRemoteAndLocal([], localData);
            scheduleDeleteQueue(120);
            refreshSyncStatus();
            return window.photoWallData;
        }
    }
    window.loadPhotoWallData = loadPhotoWallData;

    async function fetchLatestPhotos() {
        if (!window.sb) return;
        try {
            var latest = await window.sb.from('posts')
                .select('id,user_name,media_url,content,created_at,views,actor_key')
                .eq('media_type', PHOTO_WALL_MARKER)
                .order('created_at', { ascending: false })
                .limit(8);
            if (latest.error) return;

            var changed = false;
            for (var i = 0; i < latest.data.length; i++) {
                changed = upsertPhotoLocally(normalizePhotoWallRow(latest.data[i]), { render: false }) || changed;
            }
            if (changed) persistAndRender(true);
        } catch (e) {}
    }
    window.fetchLatestPhotos = fetchLatestPhotos;

    async function reconcilePhotoWallData() {
        if (reconcileTimer) {
            clearTimeout(reconcileTimer);
            reconcileTimer = null;
        }
        if (!window.sb || navigator.onLine === false) return;

        try {
            var fetchCount = Math.max(pageSize, Math.min(100, Math.max(window.photoWallData.length, 40)));
            var res = await window.sb.from('posts')
                .select('id,user_name,media_url,content,created_at,views,actor_key')
                .eq('media_type', PHOTO_WALL_MARKER)
                .order('created_at', { ascending: false })
                .limit(fetchCount);

            if (res.error) throw res.error;

            var remotePhotos = (res.data || []).map(normalizePhotoWallRow).filter(function(photo) {
                return !!photo.imageUrl;
            });
            var localData = loadLocalPhotoWallData();
            var merged = mergeRemoteAndLocal(remotePhotos, localData);
            var prev = JSON.stringify(window.photoWallData);
            var next = JSON.stringify(merged);

            if (prev !== next) {
                window.photoWallData = merged;
                persistAndRender(true);
            } else {
                saveLocalPhotoWallData();
            }
        } catch (e) {
            console.warn('[PhotoWall] reconcile failed', e);
            reconcileTimer = setTimeout(reconcilePhotoWallData, 15000);
        }
    }
    window.reconcilePhotoWallData = reconcilePhotoWallData;

    async function loadMorePhotos() {
        if (isLoading || !hasMore || !window.sb) return [];
        isLoading = true;

        try {
            currentPage += 1;
            var pageData = await loadPhotoWallPage(currentPage);
            var deletedIds = getDeletedPhotoIds();
            var pendingIds = new Set(getPendingDeleteQueue().map(function(item) { return String(item.id); }));

            pageData = pageData.filter(function(photo) {
                var id = String(photo.id);
                return deletedIds.indexOf(id) < 0 && !pendingIds.has(id);
            });

            if (!pageData.length) {
                hasMore = false;
                return [];
            }

            var existingIds = new Set(window.photoWallData.map(function(photo) {
                return String(photo.id);
            }));

            var appended = [];
            for (var i = 0; i < pageData.length; i++) {
                var photo = pageData[i];
                if (existingIds.has(String(photo.id))) continue;
                window.photoWallData.push(photo);
                appended.push(photo);
            }

            saveLocalPhotoWallData();
            hasMore = pageData.length >= pageSize;
            return appended;
        } catch (e) {
            console.error('[PhotoWall] load more failed', e);
            return [];
        } finally {
            isLoading = false;
        }
    }
    window.loadMorePhotos = loadMorePhotos;

    function hasMorePhotos() {
        return hasMore && !isLoading;
    }
    window.hasMorePhotos = hasMorePhotos;

    async function syncPhotoViewCount(photo) {
        if (!photo || !photo.cloudId || !window.sb) return;
        try {
            await window.sb.rpc('increment_post_views', { p_post_id: photo.cloudId });
            var res = await window.sb.from('posts').select('views').eq('id', photo.cloudId).maybeSingle();
            if (res && res.data && typeof res.data.views === 'number') {
                photo.views = res.data.views;
                var cached = window.photoWallData.find(function(item) {
                    return String(item.id) === String(photo.id) || String(item.cloudId) === String(photo.cloudId);
                });
                if (cached) cached.views = photo.views;
                saveLocalPhotoWallData();
                updatePhotoViewDisplays(photo);
            }
        } catch (e) {
            updatePhotoViewDisplays(photo);
        }
    }
    window.syncPhotoViewCount = syncPhotoViewCount;

    function handleRealtimeInsert(row) {
        var photo = normalizePhotoWallRow(row);
        if (!photo || !photo.id) return;
        var changed = upsertPhotoLocally(photo, { render: false });
        if (changed) {
            saveLocalPhotoWallData();
            if (window.renderPhotoWallWithoutReload) window.renderPhotoWallWithoutReload();
        }
    }

    function handleRealtimeDelete(row) {
        if (!row || row.id == null) return;
        handlePhotoDeleted(row.id, 'realtime');
    }

    function handleRealtimeUpdate(row) {
        var photo = normalizePhotoWallRow(row);
        if (!photo || !photo.id) return;
        var changed = upsertPhotoLocally(photo, { render: false });
        if (changed) {
            saveLocalPhotoWallData();
            if (window.renderPhotoWallWithoutReload) window.renderPhotoWallWithoutReload();
        }
    }

    function setupRealtimeSubscription() {
        if (!window.sb || isSubscribed) {
            refreshSyncStatus();
            return;
        }

        try {
            if (realtimeSubscription) {
                try {
                    window.sb.removeChannel(realtimeSubscription);
                } catch (e) {}
            }

            realtimeSubscription = window.sb
                .channel('photo-wall-realtime', {
                    config: {
                        broadcast: { self: true },
                        presence: { key: 'photo-wall' }
                    }
                })
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'posts',
                    filter: 'media_type=eq.' + PHOTO_WALL_MARKER
                }, function(payload) {
                    if (!payload) return;
                    if (payload.eventType === 'INSERT') {
                        handleRealtimeInsert(payload.new);
                    } else if (payload.eventType === 'DELETE') {
                        handleRealtimeDelete(payload.old);
                    } else if (payload.eventType === 'UPDATE') {
                        handleRealtimeUpdate(payload.new);
                    }
                })
                .subscribe(function(status) {
                    isSubscribed = status === 'SUBSCRIBED';
                    refreshSyncStatus();

                    if (status === 'SUBSCRIBED') {
                        scheduleDeleteQueue(120);
                        return;
                    }

                    if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        isSubscribed = false;
                        refreshSyncStatus();
                        if (subscriptionRetryTimer) clearTimeout(subscriptionRetryTimer);
                        subscriptionRetryTimer = setTimeout(function() {
                            setupRealtimeSubscription();
                            reconcilePhotoWallData();
                        }, 3000);
                    }
                });
        } catch (e) {
            console.error('[PhotoWall] realtime subscribe failed', e);
            isSubscribed = false;
            refreshSyncStatus();
            if (subscriptionRetryTimer) clearTimeout(subscriptionRetryTimer);
            subscriptionRetryTimer = setTimeout(setupRealtimeSubscription, 5000);
        }
    }
    window.setupRealtimeSubscription = setupRealtimeSubscription;

    function cleanupRealtimeSubscription() {
        if (subscriptionRetryTimer) {
            clearTimeout(subscriptionRetryTimer);
            subscriptionRetryTimer = null;
        }
        if (realtimeSubscription && window.sb) {
            try {
                window.sb.removeChannel(realtimeSubscription);
            } catch (e) {}
        }
        realtimeSubscription = null;
        isSubscribed = false;
        refreshSyncStatus();
    }
    window.cleanupRealtimeSubscription = cleanupRealtimeSubscription;

    window.addEventListener('online', function() {
        refreshSyncStatus();
        scheduleDeleteQueue(80);
        reconcilePhotoWallData();
        setupRealtimeSubscription();
    });

    window.addEventListener('offline', function() {
        refreshSyncStatus();
    });

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            scheduleDeleteQueue(120);
            reconcilePhotoWallData();
            setupRealtimeSubscription();
        }
    });

    setInterval(function() {
        if (document.visibilityState !== 'visible') return;
        if (!window.sb) return;
        reconcilePhotoWallData();
    }, 20000);

    refreshSyncStatus();
})();
