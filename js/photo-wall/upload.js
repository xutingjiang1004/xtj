(function() {
    window.triggerPhotoUpload = function() {
        if (!window.currentUser) {
            window.showToast('请先登录');
            return;
        }
        document.getElementById('photoFileInput').click();
    };

    window.handlePhotoUpload = async function(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!window.currentUser) {
            window.showToast('请先登录');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            window.showToast('图片超过 50MB 限制');
            return;
        }
        try {
            var sb = window.sb;
            var ts = Date.now();
            var baseName = ts + '_' + file.name;

            var origPath = 'photos/' + baseName;
            var thumbPromise = window.compressImage(file, 400, 400, 0.6).then(function(thumbDataUrl) {
                return fetch(thumbDataUrl).then(function(r) { return r.blob(); });
            });
            var [thumbBlob, { error: uploadErr }] = await Promise.all([
                thumbPromise,
                sb.storage.from('uploads').upload(origPath, file)
            ]);
            if (uploadErr) {
                window.showToast('上传失败: ' + (uploadErr.message || '未知错误'));
                e.target.value = '';
                return;
            }

            var thumbPath = 'thumbs/' + baseName;
            var { error: thumbErr } = await sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
                contentType: 'image/jpeg',
                cacheControl: '31536000'
            });
            if (thumbErr) {
                var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
                var contentJson = JSON.stringify({ type: 'photo_wall', fileSize: file.size });
                var insertRes = await sb.from('posts').insert([{
                    user_name: window.currentUser,
                    content: contentJson,
                    media_url: imageUrl,
                    media_type: window.PHOTO_WALL_MARKER,
                    actor_key: window.deviceId || 'photo_wall'
                }]).select('id,user_name,media_url,content,created_at,views').single();
                if (insertRes.error) throw insertRes.error;
                window.photoWallData.unshift(window.normalizePhotoWallRow(insertRes.data));
                window.saveLocalPhotoWallData();
                await window.renderPhotoWall();
                window.showToast('上传成功（无缩略图）');
                e.target.value = '';
                return;
            }

            var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
            var thumbUrl = sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl;

            var contentJson = JSON.stringify({ type: 'photo_wall', thumb: thumbUrl, fileSize: file.size });
            var insertRes = await sb.from('posts').insert([{
                user_name: window.currentUser,
                content: contentJson,
                media_url: imageUrl,
                media_type: window.PHOTO_WALL_MARKER,
                actor_key: window.deviceId || 'photo_wall'
            }]).select('id,user_name,media_url,content,created_at,views').single();
            if (insertRes.error) {
                window.showToast('照片已上传，但发布到照片墙失败: ' + (insertRes.error.message || '未知错误'));
                e.target.value = '';
                return;
            }
            window.photoWallData.unshift(window.normalizePhotoWallRow(insertRes.data));
            window.saveLocalPhotoWallData();
            await window.renderPhotoWall();
            window.showToast('上传成功');
        } catch (err) {
            window.showToast('上传失败: ' + (err.message || '网络错误'));
        }
        e.target.value = '';
    };

    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'photoFileInput') {
            window.handlePhotoUpload(e);
        }
    });
})();
