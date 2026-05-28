(function() {
    // 检测iOS设备
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    // 平滑动画变量
    var currentProgress = 0;
    var targetProgress = 0;
    var progressAnimFrame = null;
    var lastProgressTitle = '';
    var lastTitleChangeTime = 0;
    var UPLOAD_TIMEOUTS = {
        compression: 45000,
        upload: 45000,
        thumbnail: 30000,
        insert: 30000,
        render: 15000
    };

    function withTimeout(promise, ms, label) {
        var timer = null;
        var timeout = new Promise(function(_, reject) {
            timer = setTimeout(function() {
                reject(new Error(label + ' timed out after ' + ms + 'ms'));
            }, ms);
        });
        return Promise.race([Promise.resolve(promise), timeout]).finally(function() {
            if (timer) clearTimeout(timer);
        });
    }

    function setUploadStatusText(text) {
        var statusEl = document.getElementById('uploadProgressStatus');
        if (statusEl) {
            statusEl.textContent = text || '';
        }
    }

    function showUploadProgress() {
        currentProgress = 0;
        targetProgress = 0;
        lastProgressTitle = '';

        var overlay = document.getElementById('uploadProgressOverlay');
        var container = overlay ? overlay.querySelector('.upload-progress-container') : null;
        if (overlay) {
            overlay.style.display = 'flex';
            void overlay.offsetHeight;
            overlay.classList.add('upload-overlay-visible');
        }
        if (container) {
            var trigger = document.getElementById('photoUploadBtn');
            var triggerRect = trigger ? trigger.getBoundingClientRect() : null;
            container.style.transition = 'none';
            if (triggerRect && triggerRect.width > 0 && triggerRect.height > 0) {
                var finalRect = container.getBoundingClientRect();
                var dx = triggerRect.left + triggerRect.width / 2 - (finalRect.left + finalRect.width / 2);
                var dy = triggerRect.top + triggerRect.height / 2 - (finalRect.top + finalRect.height / 2);
                var scale = Math.max(0.42, Math.min(0.72, triggerRect.width / finalRect.width));
                container.style.transformOrigin = 'center center';
                container.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
                container.style.opacity = '0.4';
            }
            requestAnimationFrame(function() {
                container.style.transition = '';
                container.style.transform = '';
                container.style.opacity = '';
            });
        }

        var bar = document.getElementById('uploadProgressBar');
        if (bar) {
            bar.style.width = '0%';
        }
        var text = document.getElementById('uploadProgressText');
        if (text) {
            text.textContent = '0%';
        }
        var titleEl = document.getElementById('uploadProgressTitle');
        if (titleEl) {
            titleEl.textContent = '准备上传照片';
        }
        setUploadStatusText('正在整理照片内容...');

        startProgressAnimation();
    }

    function hideUploadProgress() {
        if (progressAnimFrame) {
            cancelAnimationFrame(progressAnimFrame);
            progressAnimFrame = null;
        }

        var overlay = document.getElementById('uploadProgressOverlay');
        if (overlay) {
            overlay.classList.remove('upload-overlay-visible');
            setTimeout(function() {
                overlay.style.display = 'none';
                currentProgress = 0;
                targetProgress = 0;
                var bar = document.getElementById('uploadProgressBar');
                if (bar) bar.style.width = '0%';
                var text = document.getElementById('uploadProgressText');
                if (text) text.textContent = '0%';
                var titleEl = document.getElementById('uploadProgressTitle');
                if (titleEl) titleEl.textContent = '准备上传照片';
                setUploadStatusText('正在整理照片内容...');
            }, 350);
        }
    }

    function startProgressAnimation() {
        if (progressAnimFrame) return;
        
        var lastTime = performance.now();
        
        function animate(currentTime) {
            var deltaTime = Math.min(currentTime - lastTime, 50);
            lastTime = currentTime;
            
            if (Math.abs(targetProgress - currentProgress) > 0.05) {
                // 使用缓动算法平滑过渡，根据设备性能调整
                var easeFactor = isIOS ? 0.12 : 0.18;
                currentProgress += (targetProgress - currentProgress) * easeFactor;
                var displayPercent = Math.round(currentProgress);
                
                var bar = document.getElementById('uploadProgressBar');
                if (bar) {
                    bar.style.width = Math.max(0, Math.min(100, currentProgress)) + '%';
                }
                var text = document.getElementById('uploadProgressText');
                if (text) {
                    text.textContent = displayPercent + '%';
                }
                progressAnimFrame = requestAnimationFrame(animate);
            } else if (targetProgress !== currentProgress) {
                // 确保最终值完全一致
                currentProgress = targetProgress;
                var bar = document.getElementById('uploadProgressBar');
                if (bar) bar.style.width = Math.max(0, Math.min(100, currentProgress)) + '%';
                var text = document.getElementById('uploadProgressText');
                if (text) text.textContent = Math.round(currentProgress) + '%';
                progressAnimFrame = null;
            }
        }
        
        progressAnimFrame = requestAnimationFrame(animate);
    }

    function updateUploadProgress(percent, title) {
        targetProgress = Math.max(0, Math.min(100, percent));
        if (percent >= 100) {
            setUploadStatusText('照片已同步到照片墙');
        } else if (percent >= 90) {
            setUploadStatusText('正在写入照片墙与同步数据...');
        } else if (percent >= 75) {
            setUploadStatusText('正在生成更轻的预览图...');
        } else if (percent >= 30) {
            setUploadStatusText('正在安全上传原图...');
        } else {
            setUploadStatusText('正在整理照片内容...');
        }
        
        var titleEl = document.getElementById('uploadProgressTitle');
        if (titleEl && title && title !== lastProgressTitle) {
            var now = Date.now();
            if (now - lastTitleChangeTime > 200) {
                lastTitleChangeTime = now;
                lastProgressTitle = title;
                titleEl.style.transition = 'opacity 0.12s ease-out';
                titleEl.style.opacity = '0';
                setTimeout(function() {
                    titleEl.textContent = title;
                    titleEl.style.opacity = '1';
                }, 120);
            }
        } else if (titleEl && title) {
            titleEl.textContent = title;
        }
        
        if (!progressAnimFrame) {
            startProgressAnimation();
        }
    }

    // iOS安全的文件读取 - 使用分段读取避免内存问题
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
            // iOS: 只读取前64KB
            reader.readAsArrayBuffer(file.slice(0, 64 * 1024));
        });
    }

    function compressToTargetBlob(file, maxBytes) {
        return new Promise(async function(resolve, reject) {
            try {
                var orientation = await getOrientation(file);
                
                var img = new Image();
                var objectUrl = URL.createObjectURL(file);
                
                img.onload = async function() {
                    try {
                        URL.revokeObjectURL(objectUrl);
                        
                        var srcWidth = img.naturalWidth;
                        var srcHeight = img.naturalHeight;
                        
                        if (srcWidth === 0 || srcHeight === 0) {
                            resolve(file);
                            return;
                        }
                        
                        // iOS: 限制最大尺寸，避免canvas内存问题
                        var maxDim = isIOS ? 1600 : 2048;
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
                        switch(orientation) {
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
                    URL.revokeObjectURL(objectUrl);
                    resolve(file);
                };
                
                img.src = objectUrl;
            } catch (e) {
                console.error('压缩处理异常:', e);
                resolve(file);
            }
        });
    }

    window.triggerPhotoUpload = function() {
        if (!window.currentUser) {
            window.showToast('请先登录');
            return;
        }
        var input = document.getElementById('photoFileInput');
        if (input) input.click();
    };

    window.handlePhotoUpload = async function(e) {
        var files = e.target.files && Array.from(e.target.files);
        console.log('[photo-upload] selected files', files);
        if (!files || files.length === 0) return;
        
        if (!window.currentUser) {
            window.showToast('请先登录');
            e.target.value = '';
            return;
        }
        
        // 过滤有效图片
        var validFiles = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (!f.type.startsWith('image/')) {
                window.showToast('仅支持上传图片文件');
                continue;
            }
            if (f.size > 50 * 1024 * 1024) {
                window.showToast('单张图片大小不能超过 50MB');
                continue;
            }
            if (f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')) {
                window.showToast('iOS HEIC格式请先在设置中改为"兼容性最佳"');
                continue;
            }
            validFiles.push(f);
        }
        
        if (validFiles.length === 0) {
            e.target.value = '';
            return;
        }
        console.log('[photo-upload] valid files', validFiles);
        
        var successCount = 0;
        var failCount = 0;
        
        try {
            var sb = window.sb;
            if (!sb) {
                window.showToast('网络连接异常');
                e.target.value = '';
                return;
            }
            
            showUploadProgress();
            
            for (var idx = 0; idx < validFiles.length; idx++) {
                try {
                    var file = validFiles[idx];
                    var progressStart = (idx / validFiles.length) * 80;
                    var progressEnd = ((idx + 1) / validFiles.length) * 80;
                    
                    updateUploadProgress(progressStart, '正在处理第 ' + (idx + 1) + '/' + validFiles.length + ' 张图片...');
                    
                    var ts = Date.now() + '_' + Math.random().toString(36).substring(2, 10);
                    var ext = file.type === 'image/png' ? '.png' : '.jpg';
                    var baseName = ts + ext;
                    var origPath = 'photos/' + baseName;
                    
                    // 压缩图片
                    var compressTarget = isIOS ? 512 * 1024 : 1 * 1024 * 1024;
                    console.log('[photo-upload] compression start', file.name);
                    var compressed = await withTimeout(compressToTargetBlob(file, compressTarget), UPLOAD_TIMEOUTS.compression, 'compression');
                    console.log('[photo-upload] compression end', file.name, compressed && compressed.size);
                    var finalSize = compressed.size;
                    
                    updateUploadProgress(progressStart + (progressEnd - progressStart) * 0.25, '正在上传第 ' + (idx + 1) + '/' + validFiles.length + ' 张图片...');
                    
                    // 上传主图
                    console.log('[photo-upload] upload start', origPath);
                    var uploadResult = await withTimeout(sb.storage.from('uploads').upload(origPath, compressed, {
                        contentType: file.type,
                        cacheControl: '31536000',
                        upsert: false
                    }), UPLOAD_TIMEOUTS.upload, 'main upload');
                    console.log('[photo-upload] upload end', origPath, uploadResult);
                    
                    if (uploadResult.error) {
                        console.error('上传失败:', uploadResult.error);
                        failCount++;
                        continue;
                    }
                    
                    updateUploadProgress(progressStart + (progressEnd - progressStart) * 0.6, '正在处理第 ' + (idx + 1) + '/' + validFiles.length + ' 张图片...');
                    
                    var imageUrl = sb.storage.from('uploads').getPublicUrl(origPath).data.publicUrl;
                    
                    // 创建并上传缩略图
                    var thumbBlob = await (function(imgBlob, maxW, maxH, quality) {
                        return new Promise(function(resolve) {
                            var img = new Image();
                            var url = URL.createObjectURL(imgBlob);
                            img.onload = function() {
                                URL.revokeObjectURL(url);
                                var w = img.naturalWidth, h = img.naturalHeight;
                                if (w > maxW || h > maxH) {
                                    var r = Math.min(maxW / w, maxH / h);
                                    w = Math.round(w * r);
                                    h = Math.round(h * r);
                                }
                                var c = document.createElement('canvas');
                                c.width = w;
                                c.height = h;
                                var ctx = c.getContext('2d');
                                ctx.imageSmoothingEnabled = true;
                                ctx.imageSmoothingQuality = 'high';
                                ctx.drawImage(img, 0, 0, w, h);
                                c.toBlob(function(b) {
                                    resolve(b || imgBlob);
                                }, 'image/jpeg', quality);
                            };
                            img.onerror = function() { URL.revokeObjectURL(url); resolve(imgBlob); };
                            img.src = url;
                        });
                    })(compressed, 400, 400, 0.7);
                    
                    var thumbPath = 'thumbs/' + baseName;
                    console.log('[photo-upload] thumbnail upload start', thumbPath);
                    var thumbResult = await withTimeout(sb.storage.from('uploads').upload(thumbPath, thumbBlob, {
                        contentType: 'image/jpeg',
                        cacheControl: '31536000'
                    }), UPLOAD_TIMEOUTS.thumbnail, 'thumbnail upload');
                    console.log('[photo-upload] thumbnail upload end', thumbPath, thumbResult);
                    
                    var thumbUrl = !thumbResult.error ? sb.storage.from('uploads').getPublicUrl(thumbPath).data.publicUrl : '';
                    
                    updateUploadProgress(progressStart + (progressEnd - progressStart) * 0.9, '正在保存第 ' + (idx + 1) + '/' + validFiles.length + ' 张图片...');
                    
                    // 插入数据库记录
                    var contentJson = JSON.stringify({ 
                        type: 'photo_wall', 
                        thumb: thumbUrl, 
                        fileSize: finalSize 
                    });
                    console.log('[photo-upload] insert start', baseName);
                    var insertRes = await withTimeout(sb.from('posts').insert([{
                        user_name: window.currentUser,
                        content: contentJson,
                        media_url: imageUrl,
                        media_type: window.PHOTO_WALL_MARKER,
                        actor_key: window.deviceId || 'photo_wall'
                    }]).select('id,user_name,media_url,content,created_at,views,actor_key').single(), UPLOAD_TIMEOUTS.insert, 'database insert');
                    console.log('[photo-upload] insert end', baseName, insertRes && insertRes.data && insertRes.data.id);
                    
                    if (insertRes.error) {
                        console.error('保存记录失败:', insertRes.error);
                        failCount++;
                        continue;
                    }
                    
                    // 更新本地数据 - 去重
                    if (window.photoWallData && window.photoWallData.unshift) {
                        var newPhoto = window.normalizePhotoWallRow(insertRes.data);
                        var existingIdx = window.photoWallData.findIndex(function(p) { 
                            return String(p.id) === String(newPhoto.id); 
                        });
                        if (existingIdx < 0) {
                            window.photoWallData.unshift(newPhoto);
                        }
                    }
                    
                    // 广播同步消息
                    if (window.broadcastSync && insertRes.data && insertRes.data.id) {
                        window.broadcastSync('photo_added', { photoId: insertRes.data.id });
                    }
                    
                    successCount++;
                } catch (fileErr) {
                    console.error('处理单张图片失败:', fileErr);
                    failCount++;
                }
            }
            
            // 完成所有上传
            if (window.saveLocalPhotoWallData) {
                window.saveLocalPhotoWallData();
            }
            if (window.renderPhotoWallWithoutReload) {
                window.renderPhotoWallWithoutReload();
            } else if (window.renderPhotoWall) {
                await withTimeout(window.renderPhotoWall(), UPLOAD_TIMEOUTS.render, 'photo wall render');
            }
            
            updateUploadProgress(100, '上传完成');
            
            setTimeout(function() {
                hideUploadProgress();
                if (successCount > 0 && failCount === 0) {
                    window.showToast('成功上传 ' + successCount + ' 张照片');
                } else if (successCount > 0 && failCount > 0) {
                    window.showToast('上传失败，请重试');
                } else {
                    window.showToast('上传失败，请重试');
                }
            }, 500);
            
        } catch (err) {
            console.error('上传异常:', err);
            hideUploadProgress();
            window.showToast(err.message || '上传失败，请重试');
        } finally {
            e.target.value = '';
        }
    };

    (function() {
        var originalHandlePhotoUpload = window.handlePhotoUpload;
        if (typeof originalHandlePhotoUpload !== 'function') return;
        window.handlePhotoUpload = async function(e) {
            try {
                return await withTimeout(originalHandlePhotoUpload.call(this, e), 180000, 'photo upload');
            } catch (err) {
                console.error('[photo-upload] upload pipeline failed or timed out', err);
                hideUploadProgress();
                window.showToast(err && err.message ? err.message : '上传失败，请重试');
            } finally {
                if (e && e.target) e.target.value = '';
            }
        };
    })();

    function initUploadHandler() {
        var fileInput = document.getElementById('photoFileInput');
        if (fileInput) {
            if (!window.__xtjPhotoUploadChangeHandler) {
                window.__xtjPhotoUploadChangeHandler = function(e) {
                    if (typeof window.handlePhotoUpload === 'function') {
                        window.handlePhotoUpload(e);
                    }
                };
            }
            fileInput.removeEventListener('change', window.__xtjPhotoUploadChangeHandler);
            fileInput.addEventListener('change', window.__xtjPhotoUploadChangeHandler);
        }

        var progressOverlay = document.getElementById('uploadProgressOverlay');
        if (progressOverlay) {
            progressOverlay.addEventListener('click', function(e) {
                if (e.target === progressOverlay) {
                    hideUploadProgress();
                }
            });
        }
    }

    var __xtjHideUploadProgressTimer = null;
    var __xtjOriginalShowUploadProgress = showUploadProgress;

    showUploadProgress = function() {
        if (__xtjHideUploadProgressTimer) {
            clearTimeout(__xtjHideUploadProgressTimer);
            __xtjHideUploadProgressTimer = null;
        }
        return __xtjOriginalShowUploadProgress.apply(this, arguments);
    };

    hideUploadProgress = function() {
        if (progressAnimFrame) {
            cancelAnimationFrame(progressAnimFrame);
            progressAnimFrame = null;
        }

        var overlay = document.getElementById('uploadProgressOverlay');
        if (overlay) {
            overlay.classList.remove('upload-overlay-visible');
            if (__xtjHideUploadProgressTimer) {
                clearTimeout(__xtjHideUploadProgressTimer);
            }
            __xtjHideUploadProgressTimer = setTimeout(function() {
                overlay.style.display = 'none';
                currentProgress = 0;
                targetProgress = 0;
                var bar = document.getElementById('uploadProgressBar');
                if (bar) bar.style.width = '0%';
                var text = document.getElementById('uploadProgressText');
                if (text) text.textContent = '0%';
                var titleEl = document.getElementById('uploadProgressTitle');
                if (titleEl) titleEl.textContent = '准备上传照片';
                setUploadStatusText('正在整理照片内容...');
                __xtjHideUploadProgressTimer = null;
            }, 350);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUploadHandler);
    } else {
        initUploadHandler();
    }
})();
