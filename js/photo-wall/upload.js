(function() {
    function getOrientation(file) {
        return new Promise(function(resolve) {
            if (!file || !file.type.startsWith('image/')) {
                resolve(-1);
                return;
            }
            
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
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
                } catch (e) {
                    console.warn('EXIF读取失败:', e);
                }
                resolve(-1);
            };
            reader.onerror = function() { resolve(-1); };
            reader.readAsArrayBuffer(file.slice(0, 64 * 1024));
        });
    }

    function compressToTargetBlob(file, maxBytes) {
        return new Promise(async function(resolve, reject) {
            try {
                var orientation = await getOrientation(file);
                
                var img = new Image();
                img.onload = async function() {
                    try {
                        URL.revokeObjectURL(this.src);
                        
                        var srcWidth = img.naturalWidth;
                        var srcHeight = img.naturalHeight;
                        
                        if (srcWidth === 0 || srcHeight === 0) {
                            throw new Error('无法读取图片尺寸');
                        }
                        
                        var maxDim = 2048;
                        var scale = Math.min(maxDim / srcWidth, maxDim / srcHeight, 1);
                        var targetWidth = Math.round(srcWidth * scale);
                        var targetHeight = Math.round(srcHeight * scale);
                        
                        var isRotated = [5, 6, 7, 8].includes(orientation);
                        var canvasWidth = isRotated ? targetHeight : targetWidth;
                        var canvasHeight = isRotated ? targetWidth : targetHeight;
                        
                        var canvas = document.createElement('canvas');
                        canvas.width = canvasWidth;
                        canvas.height = canvasHeight;
                        
                        var ctx = canvas.getContext('2d');
                        if (!ctx) {
                            throw new Error('无法创建Canvas上下文');
                        }
                        
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        
                        ctx.save();
                        switch (orientation) {
                            case 2:
                                ctx.translate(canvasWidth, 0);
                                ctx.scale(-1, 1);
                                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                                break;
                            case 3:
                                ctx.translate(canvasWidth, canvasHeight);
                                ctx.rotate(Math.PI);
                                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                                break;
                            case 4:
                                ctx.translate(0, canvasHeight);
                                ctx.scale(1, -1);
                                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                                break;
                            case 5:
                                ctx.rotate(0.5 * Math.PI);
                                ctx.scale(1, -1);
                                ctx.drawImage(img, 0, -targetHeight, targetWidth, targetHeight);
                                break;
                            case 6:
                                ctx.translate(canvasWidth, 0);
                                ctx.rotate(0.5 * Math.PI);
                                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                                break;
                            case 7:
                                ctx.translate(canvasWidth, canvasHeight);
                                ctx.rotate(0.5 * Math.PI);
                                ctx.scale(-1, 1);
                                ctx.drawImage(img, -targetWidth, 0, targetWidth, targetHeight);
                                break;
                            case 8:
                                ctx.translate(0, canvasHeight);
                                ctx.rotate(-0.5 * Math.PI);
                                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                                break;
                            default:
                                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                        }
                        ctx.restore();
                        
                        var mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                        var quality = mimeType === 'image/png' ? undefined : 0.85;
                        
                        if (canvas.toBlob) {
                            var targetSize = maxBytes;
                            var minQuality = 0.1;
                            
                            function tryCompress(currentQuality) {
                                canvas.toBlob(function(blob) {
                                    if (!blob) {
                                        console.warn('Canvas转换失败，使用原始文件');
                                        resolve(file);
                                        return;
                                    }
                                    
                                    if (blob.size <= targetSize || currentQuality <= minQuality) {
                                        resolve(blob);
                                        return;
                                    }
                                    
                                    var newQuality = currentQuality - 0.05;
                                    if (newQuality < minQuality) newQuality = minQuality;
                                    tryCompress(newQuality);
                                }, mimeType, currentQuality);
                            }
                            
                            tryCompress(quality);
                        } else {
                            throw new Error('浏览器不支持toBlob');
                        }
                    } catch (e) {
                        console.error('图片处理失败:', e);
                        reject(e);
                    }
                };
                
                img.onerror = function() {
                    URL.revokeObjectURL(this.src);
                    reject(new Error('图片加载失败'));
                };
                
                img.src = URL.createObjectURL(file);
            } catch (e) {
                console.error('压缩处理异常:', e);
                reject(e);
            }
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
            e.target.value = '';
            return;
        }
        
        if (!file.type.startsWith('image/')) {
            window.showToast('请选择图片文件');
            e.target.value = '';
            return;
        }
        
        try {
            var sb = window.sb;
            var ts = Date.now();
            var ext = file.type === 'image/png' ? '.png' : '.jpg';
            var baseName = ts + '_' + file.name.replace(/\.[^.]+$/, '') + ext;

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
                throw new Error('上传失败: ' + (uploadErr.message || '未知错误'));
            }

            var thumbPath = 'thumbs/' + baseName;
            var { error: thumbErr } = await sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
                contentType: 'image/jpeg',
                cacheControl: '31536000'
            });

            var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
            
            if (thumbErr) {
                var contentJson = JSON.stringify({ type: 'photo_wall', fileSize: finalSize });
                var insertRes = await sb.from('posts').insert([{
                    user_name: window.currentUser,
                    content: contentJson,
                    media_url: imageUrl,
                    media_type: window.PHOTO_WALL_MARKER,
                    actor_key: window.deviceId || 'photo_wall'
                }]).select('id,user_name,media_url,content,created_at,views').single();
                
                if (insertRes.error) throw new Error(insertRes.error.message);
                
                window.photoWallData.unshift(window.normalizePhotoWallRow(insertRes.data));
                window.saveLocalPhotoWallData();
                await window.renderPhotoWall();
                window.showToast('上传成功（无缩略图）');
                e.target.value = '';
                return;
            }

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
                throw new Error('照片已上传，但发布到照片墙失败: ' + (insertRes.error.message || '未知错误'));
            }
            
            window.photoWallData.unshift(window.normalizePhotoWallRow(insertRes.data));
            window.saveLocalPhotoWallData();
            await window.renderPhotoWall();
            
            var sizeStr = finalSize >= 1024 * 1024 
                ? (finalSize / (1024 * 1024)).toFixed(2) + ' MB'
                : (finalSize / 1024).toFixed(1) + ' KB';
            window.showToast('上传成功 (' + sizeStr + ')');
            e.target.value = '';
            
        } catch (err) {
            console.error('上传异常:', err);
            window.showToast(err.message || '上传失败，请重试');
            e.target.value = '';
        }
    };
})();