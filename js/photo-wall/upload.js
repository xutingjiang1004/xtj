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
                            resolve(file);
                            return;
                        }
                        
                        var maxDim = 2048;
                        var scale = Math.min(maxDim / srcWidth, maxDim / srcHeight, 1);
                        var targetWidth = Math.round(srcWidth * scale);
                        var targetHeight = Math.round(srcHeight * scale);
                        
                        var isRotated = [5, 6, 7, 8].indexOf(orientation) !== -1;
                        var canvasWidth = isRotated ? targetHeight : targetWidth;
                        var canvasHeight = isRotated ? targetWidth : targetHeight;
                        
                        var canvas = document.createElement('canvas');
                        canvas.width = canvasWidth;
                        canvas.height = canvasHeight;
                        
                        var ctx = canvas.getContext('2d');
                        if (!ctx) {
                            resolve(file);
                            return;
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
                            resolve(file);
                        }
                    } catch (e) {
                        console.error('图片处理失败:', e);
                        resolve(file);
                    }
                };
                
                img.onerror = function() {
                    URL.revokeObjectURL(this.src);
                    resolve(file);
                };
                
                img.src = URL.createObjectURL(file);
            } catch (e) {
                console.error('压缩处理异常:', e);
                resolve(file);
            }
        });
    }

    function simpleCompress(blob, maxW, maxH, quality) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            var url = URL.createObjectURL(blob);
            img.onload = function() {
                URL.revokeObjectURL(url);
                var w = img.naturalWidth, h = img.naturalHeight;
                if (w > maxW || h > maxH) {
                    var ratio = Math.min(maxW / w, maxH / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);
                var dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = function() {
                URL.revokeObjectURL(url);
                reject(new Error('图片加载失败'));
            };
            img.src = url;
        });
    }

    window.triggerPhotoUpload = function() {
        if (!window.currentUser) {
            window.showToast('\u8bf7\u5148\u767b\u5f55');
            return;
        }
        var input = document.getElementById('photoFileInput');
        if (input) input.click();
    };

    window.handlePhotoUpload = async function(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        
        if (!window.currentUser) {
            window.showToast('\u8bf7\u5148\u767b\u5f55');
            e.target.value = '';
            return;
        }
        
        if (file.size > 50 * 1024 * 1024) {
            window.showToast('\u56fe\u7247\u8d85\u8fc7 50MB \u9650\u5236');
            e.target.value = '';
            return;
        }
        
        if (!file.type.startsWith('image/')) {
            window.showToast('\u8bf7\u9009\u62e9\u56fe\u7247\u6587\u4ef6');
            e.target.value = '';
            return;
        }
        
        try {
            var sb = window.sb;
            if (!sb) {
                window.showToast('\u7f51\u7edc\u8fde\u63a5\u5f02\u5e38');
                e.target.value = '';
                return;
            }
            var ts = Date.now();
            var ext = file.type === 'image/png' ? '.png' : '.jpg';
            var safeName = file.name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-\.]+/g, '_');
            var baseName = ts + '_' + safeName.replace(/\.[^.]+$/, '') + ext;

            var origPath = 'photos/' + baseName;
            var needCompress = file.size > 1 * 1024 * 1024;
            
            if (needCompress) {
                window.showToast('\u6b63\u5728\u538b\u7f29\u56fe\u7247...');
            }
            
            var compressed = await compressToTargetBlob(file, 1 * 1024 * 1024);
            var finalSize = compressed.size;

            var thumbPromise = simpleCompress(compressed, 1200, 1200, 0.85).then(function(thumbDataUrl) {
                return fetch(thumbDataUrl).then(function(r) { return r.blob(); });
            });
            
            var [thumbBlob, uploadResult] = await Promise.all([
                thumbPromise,
                sb.storage.from('uploads').upload(origPath, compressed, {
                    cacheControl: '31536000',
                    upsert: false
                })
            ]);
            
            var uploadErr = uploadResult.error;
            
            if (uploadErr) {
                throw new Error('\u4e0a\u4f20\u5931\u8d25: ' + (uploadErr.message || '\u672a\u77e5\u9519\u8bef'));
            }

            var thumbPath = 'thumbs/' + baseName;
            var thumbResult = await sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
                contentType: 'image/jpeg',
                cacheControl: '31536000'
            });
            var thumbErr = thumbResult.error;

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
                
                if (window.photoWallData && window.photoWallData.unshift) {
                    window.photoWallData.unshift(window.normalizePhotoWallRow(insertRes.data));
                }
                if (window.saveLocalPhotoWallData) {
                    window.saveLocalPhotoWallData();
                }
                if (window.renderPhotoWall) {
                    await window.renderPhotoWall();
                }
                window.showToast('\u4e0a\u4f20\u6210\u529f');
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
                throw new Error('\u7167\u7247\u5df2\u4e0a\u4f20\uff0c\u4f46\u53d1\u5e03\u5230\u7167\u7247\u5899\u5931\u8d25: ' + (insertRes.error.message || '\u672a\u77e5\u9519\u8bef'));
            }
            
            if (window.photoWallData && window.photoWallData.unshift) {
                window.photoWallData.unshift(window.normalizePhotoWallRow(insertRes.data));
            }
            if (window.saveLocalPhotoWallData) {
                window.saveLocalPhotoWallData();
            }
            if (window.renderPhotoWall) {
                await window.renderPhotoWall();
            }
            
            var sizeStr = finalSize >= 1024 * 1024 
                ? (finalSize / (1024 * 1024)).toFixed(2) + ' MB'
                : (finalSize / 1024).toFixed(1) + ' KB';
            window.showToast('\u4e0a\u4f20\u6210\u529f (' + sizeStr + ')');
            e.target.value = '';
            
        } catch (err) {
            console.error('\u4e0a\u4f20\u5f02\u5e38:', err);
            window.showToast(err.message || '\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
            e.target.value = '';
        }
    };

    function initUploadHandler() {
        var fileInput = document.getElementById('photoFileInput');
        if (fileInput) {
            fileInput.removeEventListener('change', window.handlePhotoUpload);
            fileInput.addEventListener('change', function(e) {
                if (typeof window.handlePhotoUpload === 'function') {
                    window.handlePhotoUpload(e);
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUploadHandler);
    } else {
        initUploadHandler();
    }
})();
