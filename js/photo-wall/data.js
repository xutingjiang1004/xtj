(function() {
    window.photoWallData = [];

    var photoWallKey = 'xtj_photos';
    var photoWallDeletedKey = 'xtj_photos_deleted';

    var PHOTO_WALL_MARKER = '__photo_wall__';
    window.PHOTO_WALL_MARKER = PHOTO_WALL_MARKER;
    var photoWallMigrating = false;

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

    async function loadPhotoWallData() {
        var localData = loadLocalPhotoWallData();
        if (!window.sb) {
            window.photoWallData = localData;
            return window.photoWallData;
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
            window.photoWallData = (res.data || []).map(normalizePhotoWallRow).filter(function(p) { return !!p.imageUrl; });
            if (deletedIds.length > 0) {
                var cloudIds = {};
                window.photoWallData.forEach(function(p) { cloudIds[String(p.id)] = true; });
                var cleaned = deletedIds.filter(function(id) { return cloudIds[id]; });
                if (cleaned.length !== deletedIds.length) {
                    try { localStorage.setItem(photoWallDeletedKey, JSON.stringify(cleaned)); } catch(e) {}
                    deletedIds = cleaned;
                }
                if (deletedIds.length > 0) {
                    window.photoWallData = window.photoWallData.filter(function(p) {
                        return deletedIds.indexOf(String(p.id)) < 0;
                    });
                }
            }
            if (!window.photoWallData.length && localData.length) window.photoWallData = localData;
            return window.photoWallData;
        } catch(e) {
            console.error('加载云端照片墙失败:', e);
            window.photoWallData = localData;
            return window.photoWallData;
        }
    }
    window.loadPhotoWallData = loadPhotoWallData;

    function saveLocalPhotoWallData() {
        try {
            localStorage.setItem(photoWallKey, JSON.stringify(window.photoWallData.slice(0, 100)));
        } catch (e) {}
    }
    window.saveLocalPhotoWallData = saveLocalPhotoWallData;

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
