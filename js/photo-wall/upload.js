(function() {
    function getOrientation(file) {
        return new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var view = new DataView(e.target.result);
                if (view.getUint16(0, false) !== 0xFFD8) {
                    resolve(-1);
                    return;
                }
                var length = view.byteLength;
                var offset = 2;
                while (offset < length) {
                    var marker = view.getUint16(offset, false);
                    offset += 2;
                    if (marker === 0xFFE1) {
                        if (view.getUint32(offset += 2, false) !== 0x45786966) {
                            resolve(-1);
                            return;
                        }
                        var little = view.getUint16(offset += 6, false) === 0x4949;
                        offset += view.getUint32(offset + 4, little);
                        var tags = view.getUint16(offset, little);
                        offset += 2;
                        for (var i = 0; i < tags; i++) {
                            if (view.getUint16(offset + i * 12, little) === 0x0112) {
                                resolve(view.getUint16(offset + i * 12 + 8, little));
                                return;
                            }
                        }
                    } else if ((marker & 0xFF00) !== 0xFF00) {
                        break;
                    } else {
                        offset += view.getUint16(offset, false);
                    }
                }
                resolve(-1);
            };
            reader.onerror = function() { resolve(-1); };
            reader.readAsArrayBuffer(file.slice(0, 64 * 1024));
        });
    }

    function compressToTargetBlob(file, maxBytes) {
        return new Promise(async function(resolve) {
            var orientation = await getOrientation(file);
            var img = new Image();
            var url = URL.createObjectURL(file);
            
            img.onload = function() {
                URL.revokeObjectURL(url);
                
                var needsRotation = [5, 6, 7, 8].includes(orientation);
                var srcWidth = img.width;
                var srcHeight = img.height;
                
                var targetWidth = srcWidth;
                var targetHeight = srcHeight;
                var maxDim = 2048;
                
                if (targetWidth > maxDim || targetHeight > maxDim) {
                    var ratio = maxDim / Math.max(targetWidth, targetHeight);
                    targetWidth = Math.round(targetWidth * ratio);
                    targetHeight = Math.round(targetHeight * ratio);
                }
                
                var canvasWidth = needsRotation ? targetHeight : targetWidth;
                var canvasHeight = needsRotation ? targetWidth : targetHeight;
                
                var canvas = document.createElement('canvas');
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                var ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                switch (orientation) {
                    case 2:
                        ctx.transform(-1, 0, 0, 1, canvasWidth, 0);
                        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                        break;
                    case 3:
                        ctx.transform(-1, 0, 0, -1, canvasWidth, canvasHeight);
                        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                        break;
                    case 4:
                        ctx.transform(1, 0, 0, -1, 0, canvasHeight);
                        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                        break;
                    case 5:
                        ctx.transform(0, 1, 1, 0, 0, 0);
                        ctx.drawImage(img, 0, 0, targetHeight, targetWidth);
                        break;
                    case 6:
                        ctx.transform(0, 1, -1, 0, canvasHeight, 0);
                        ctx.drawImage(img, 0, 0, targetHeight, targetWidth);
                        break;
                    case 7:
                        ctx.transform(0, -1, -1, 0, canvasHeight, canvasWidth);
                        ctx.drawImage(img, 0, 0, targetHeight, targetWidth);
                        break;
                    case 8:
                        ctx.transform(0, -1, 1, 0, 0, canvasWidth);
                        ctx.drawImage(img, 0, 0, targetHeight, targetWidth);
                        break;
                    default:
                        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                }

                if (canvas.toBlob) {
                    var quality = 0.85;
                    var step = 0.1;
                    
                    function tryQuality() {
                        canvas.toBlob(function(blob) {
                            if (!blob) {
                                resolve(file);
                                return;
                            }
                            if (blob.size <= maxBytes || quality <= 0.1) {
                                resolve(blob);
                                return;
                            }
                            quality -= step;
                            if (quality < 0.3) step = 0.05;
                            tryQuality();
                        }, 'image/jpeg', quality);
                    }
                    tryQuality();
                } else {
                    resolve(file);
                }
            };
            
            img.onerror = function() {
                URL.revokeObjectURL(url);
                resolve(file);
            };
            
            img.src = url;
        });
    }

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
            var baseName = ts + '_' + file.name.replace(/\.[^.]+$/, '.jpg');

            var origPath = 'photos/' + baseName;
            var needCompress = file.size > 1 * 1024 * 1024;
            if (needCompress) {
                window.showToast('正在压缩图片...');
            }
            var compressed = await compressToTargetBlob(file, 1 * 1024 * 1024);
            var finalSize = compressed.size;

            var thumbPromise = window.compressImage(compressed, 400, 400, 0.6).then(function(thumbDataUrl) {
                return fetch(thumbDataUrl).then(function(r) { return r.blob(); });
            });
            var [thumbBlob, { error: uploadErr }] = await Promise.all([
                thumbPromise,
                sb.storage.from('uploads').upload(origPath, compressed)
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
                var contentJson = JSON.stringify({ type: 'photo_wall', fileSize: finalSize });
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

            var contentJson = JSON.stringify({ type: 'photo_wall', thumb: thumbUrl, fileSize: finalSize });
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