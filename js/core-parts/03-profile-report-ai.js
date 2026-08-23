/**
 * core-parts/03-profile-report-ai.js
 * Profile card, activity, reports, cat-AI comment polling
 * Lines from original core.js: 2850-4752
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            // ========== 查看用户资料卡 ==========
            let upcTargetUser = null;
            // S7 修复：资料卡请求代次号，防止快速切换用户时旧响应覆盖新用户资料
            let upcRequestSeq = 0;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                var _seq = ++upcRequestSeq;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '最近登录：加载中...';
                
                var avatarEl = document.getElementById('upcAvatar');
                if (!avatarEl) return;
                // localStorage 取头像缓存，失败用字母占位
                var showAvatar = getAvatarUrl(userName);
                if (!showAvatar && userName === currentUser) {
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                            showAvatar = cachedAvatars[currentUser].url || null;
                        }
                    } catch(e) {}
                }
                if (showAvatar) {
                    avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(showAvatar)) + '" alt="头像">';
                } else {
                    avatarEl.innerHTML = '<span id="upcAvatarText">' + escapeHtml(String(userName || '?').charAt(0).toUpperCase()) + '</span>';
                }
                
                var msgBtn = document.getElementById('upcMsgBtn');
                if (userName === currentUser) {
                    msgBtn.textContent = '这是你自己';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else if (!currentUser) {
                    msgBtn.textContent = '请先登录再发消息';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else {
                    msgBtn.textContent = '发消息';
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 加载用户头像
                try {
                    // 当前用户优先使用localStorage缓存
                    if (userName === currentUser) {
                        try {
                            var cv = readAvatarCacheFromStorage();
                            if (cv[currentUser]) {
                                avatarCache[currentUser] = cv[currentUser];
                                if (document.getElementById('userProfileModal').classList.contains('active')) {
                                    avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(cv[currentUser].url)) + '" alt="头像">';
                                }
                            }
                        } catch(e) {}
                    }

                    var avatarUrl = await fetchAvatarUrl(userName);

                    // S7 修复：响应落地前校验目标用户是否已切换，旧响应不得覆盖新资料
                    if (_seq !== upcRequestSeq || upcTargetUser !== userName) return;

                    if (avatarUrl) {
                        if (userName !== currentUser) {
                            setAvatarCacheEntry(userName, 'has_avatar', avatarUrl);
                        } else if (!getAvatarUrl(currentUser)) {
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                        }
                        if (document.getElementById('userProfileModal').classList.contains('active')) {
                            var url = (userName === currentUser && getAvatarUrl(currentUser)) ? getAvatarUrl(currentUser) : avatarUrl;
                            var imgHtml = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(url)) + '" alt="头像" onerror="this.style.display=\'none\';var s=document.createElement(\'span\');s.textContent=this.alt[0]?this.alt[0].toUpperCase():\'?\';s.className=\'avatar-fallback\';this.parentNode.appendChild(s);">';
                            avatarEl.innerHTML = imgHtml;
                            // 写入本地缓存
                            if (userName === currentUser) {
                                try { var cv = readAvatarCacheFromStorage(); cv[currentUser] = { state: 'has_avatar', url: url, fetched_at: Date.now() }; writeAvatarCacheToStorage(cv); } catch(_) {}
                            }
                        }
                    }
                    
                    // 隐私收紧：__user_info__ 仅允许本人读取（RLS 035 已强制），
                    // 非本人不再发起 anon 直读，直接显示占位。
                    var userInfoRes = null;
                    if (userName === currentUser) {
                        userInfoRes = await sb.from("posts")
                            .select("content")
                            .eq("user_name", userName)
                            .eq("media_type", "__user_info__")
                            .order("created_at", { ascending: false })
                            .limit(1);
                    }
                    
                    // S7 修复：同上，用户已切换则丢弃本次结果
                    if (_seq !== upcRequestSeq || upcTargetUser !== userName) return;
                    
                    if (userInfoRes.data && userInfoRes.data.length > 0) {
                        try {
                            var info = JSON.parse(userInfoRes.data[0].content);
                            if (info.last_login) {
                                document.getElementById('upcLogin').textContent = '最近登录：' + window.safeParseDate(info.last_login).toLocaleString();
                            } else {
                                document.getElementById('upcLogin').textContent = '最近登录：-';
                            }
                        } catch(e) {
                            document.getElementById('upcLogin').textContent = '最近登录：-';
                        }
                    } else {
                        document.getElementById('upcLogin').textContent = '最近登录：-';
                    }
                } catch(e) {
                    document.getElementById('upcLogin').textContent = '最近登录：加载失败';
                }
            };

            window.upcSendMessage = function() {
                if (!upcTargetUser || !currentUser) return;
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                closeModal('userProfileModal');
                setTimeout(function() { openChat(upcTargetUser); }, 300);
            };

            // ========== 个人资料详情功能 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 打开个人资料详情
                document.getElementById('profileDetailName').textContent = currentUser;
                document.getElementById('profileDetailId').textContent = currentUser;
                
                // 获取用户信息（注册时间等）
                try {
                    const userInfoRes = await sb.from("posts")
                        .select("content")
                        .eq("user_name", currentUser)
                        .eq("media_type", "__user_info__")
                        .order("created_at", { ascending: false })
                        .limit(1);
                    
                    if (userInfoRes.data && userInfoRes.data.length > 0) {
                        try {
                            const userInfo = JSON.parse(userInfoRes.data[0].content);
                            if (userInfo.reg_time) {
                                document.getElementById('profileDetailRegTime').textContent = window.safeParseDate(userInfo.reg_time).toLocaleString();
                            } else {
                                document.getElementById('profileDetailRegTime').textContent = '-';
                            }
                        } catch(e) {
                            document.getElementById('profileDetailRegTime').textContent = '-';
                        }
                    } else {
                        document.getElementById('profileDetailRegTime').textContent = '-';
                    }
                } catch(e) {
                    console.error("获取用户信息失败:", e);
                    document.getElementById('profileDetailRegTime').textContent = '-';
                }
                
                // 加载头像
                loadProfileAvatar();
                
                openModal('profileDetailModal');
            };

            async function loadProfileAvatar() {
                const avatarEl = document.getElementById('profileDetailAvatar');
                if (!avatarEl) return;
                
                // localStorage 兼容处理
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[currentUser] && cachedAvatars[currentUser].url) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(cachedAvatars[currentUser].url)) + '" alt="头像">';
                        return;
                    }
                } catch(e) {}

                // 优先使用内存缓存中的头像 URL
                var memUrl = getAvatarUrl(currentUser);
                if (memUrl) {
                    avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(memUrl)) + '" alt="头像">';
                }

                try {
                    var avatarUrl = await fetchAvatarUrl(currentUser);

                    if (avatarUrl) {
                        var safeAvatarUrl = escapeHtml(sanitizeUrl(avatarUrl));
                        avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + safeAvatarUrl + '" alt="头像">';
                        setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                        // 写入 localStorage
                        try {
                            var cv = readAvatarCacheFromStorage();
                            cv[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                            writeAvatarCacheToStorage(cv);
                        } catch(e) {}
                    } else if (!getAvatarUrl(currentUser)) {
                        avatarEl.innerHTML = '<span id="profileDetailAvatarText">' + (currentUser ? currentUser[0].toUpperCase() : '?') + '</span>';
                    }
                } catch(e) {
                    console.error("加载头像失败:", e);
                }
            }

            function compressImage(file, maxW, maxH, quality) {
                return new Promise(function(resolve, reject) {
                    var img = new Image();
                    var url = URL.createObjectURL(file);
                    img.onload = function() {
                        URL.revokeObjectURL(url);
                        var w = img.width, h = img.height;
                        if (w > maxW || h > maxH) {
                            var ratio = Math.min(maxW / w, maxH / h);
                            w = Math.round(w * ratio);
                            h = Math.round(h * ratio);
                        }
                        // 使用 createImageBitmap 进行图片压缩（若支持）
                        if (window.createImageBitmap) {
                            createImageBitmap(img, {
                                resizeWidth: w,
                                resizeHeight: h,
                                resizeQuality: 'high'
                            }).then(function(bitmap) {
                                var canvas = document.createElement('canvas');
                                canvas.width = bitmap.width;
                                canvas.height = bitmap.height;
                                var ctx = canvas.getContext('2d');
                                ctx.drawImage(bitmap, 0, 0);
                                bitmap.close();
                                resolve(canvas.toDataURL('image/jpeg', quality));
                            }).catch(function() {
                                // fallback: 使用 canvas 压缩
                                fallbackCompress(img, w, h, quality, resolve);
                            });
                        } else {
                            fallbackCompress(img, w, h, quality, resolve);
                        }
                    };
                    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
                    img.src = url;
                });
            }
            function fallbackCompress(img, w, h, quality, resolve) {
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            }
            window.compressImage = compressImage;

            window.triggerAvatarUpload = function() {
                document.getElementById('avatarUploadInput').click();
            };

            window.handleAvatarUpload = async function(event) {
                const file = event.target.files[0];
                if (!file) return;
                
                if (!file.type.startsWith('image/')) {
                    showToast('请选择图片文件');
                    return;
                }
                // ★ 修复 S5：前端同样拒绝 SVG（服务端已拒），避免 SVG 先上传到公共桶、
                // 后端再拒绝造成的"存储桶残留可执行脚本文件"窗口。
                if (/\.svgz?$/i.test(String(file.name || '')) || file.type === 'image/svg+xml') {
                    showToast('不支持 SVG 头像（存在安全风险）');
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('图片大小不能超过10MB');
                    return;
                }
                
                showToast('正在压缩并上传头像..');
                
                try {
                    // ★ 修复：compressImage 此前定义了却从未被调用，原图直传（浪费带宽/存储）。
                    // 仅对大文件（>1.5MB）压缩为 JPEG 再上传；小图保持原样避免透明背景被压平，
                    // 压缩失败则回退原图上传，不影响可用性。
                    var uploadFile = file;
                    var path = buildStorageUploadPath('avatars', file.name);
                    if (file.size > 1.5 * 1024 * 1024) {
                        try {
                            var compressedDataUrl = await compressImage(file, 1024, 1024, 0.82);
                            if (compressedDataUrl && compressedDataUrl.length > 0) {
                                var compressedBlob = await (await window.fetch(compressedDataUrl)).blob();
                                if (compressedBlob && compressedBlob.size > 0 && compressedBlob.size < file.size) {
                                    uploadFile = compressedBlob;
                                    path = buildStorageUploadPath('avatars', 'avatar-' + Date.now() + '.jpg');
                                }
                            }
                        } catch (compressErr) { console.warn('[avatar] compress failed, upload raw', compressErr); }
                    }
                    
                    // 上传到 Supabase Storage
                    if (/\.(svgz?|html?|xml|swf)$/i.test(String(file && file.name || '')) || /^image\/svg\+xml/i.test(String(file && file.type || ''))) {
                        throw new Error('file type not allowed');
                    }
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, uploadFile);
                    if (uploadErr) throw uploadErr;
                    
                    // 获取 Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 头像记录必须由服务端校验当前用户并写入，不能在 anon
                    // 客户端保留一条绕过 RLS/归属校验的旧写入路径。
                    try {
                        if (typeof window.API_BASE !== 'string' || !window.API_BASE) {
                            throw new Error('头像服务不可用');
                        }
                        var avAuthHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                        var avResp = await fetch(window.API_BASE.replace(/\/$/, '') + '/api/avatar', {
                            method: 'POST',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, avAuthHeaders || {}),
                            body: JSON.stringify({ media_url: avatarUrl })
                        });
                        var avData = await avResp.json().catch(function() { return {}; });
                        if (!avResp.ok || !avData || !avData.ok) {
                            throw new Error((avData && avData.error) || '头像保存失败');
                        }
                    } catch (avErr) {
                        // The request may have committed before its response
                        // was lost. Confirm ownership server-side before
                        // deleting the uploaded object, otherwise a valid
                        // avatar row can point at a deleted file.
                        var avatarCommitted = false;
                        try {
                            var statusAuthHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                            var statusResp = await fetch(window.API_BASE.replace(/\/$/, '') + '/api/avatar/status', {
                                method: 'POST',
                                headers: Object.assign({ 'Content-Type': 'application/json' }, statusAuthHeaders || {}),
                                credentials: 'include',
                                body: JSON.stringify({ media_url: avatarUrl })
                            });
                            var statusData = await statusResp.json().catch(function() { return {}; });
                            avatarCommitted = !!(statusResp.ok && statusData && statusData.committed);
                        } catch (statusErr) {}
                        if (avatarCommitted) {
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                            try {
                                var committedCache = readAvatarCacheFromStorage();
                                committedCache[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                                writeAvatarCacheToStorage(committedCache);
                            } catch (cacheErr) {}
                            updateAllAvatarElements(avatarUrl);
                            showToast('头像已更新');
                            event.target.value = '';
                            return;
                        }
                        try { await sb.storage.from('uploads').remove([path]); } catch (cleanupErr) {}
                        showToast('头像上传失败: ' + (avErr && avErr.message || '网络错误'));
                        event.target.value = '';
                        return;
                    }
                    
                    setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                    // 保存到localStorage持久化存储
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        cachedAvatars[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                        writeAvatarCacheToStorage(cachedAvatars);
                    } catch(e) {}
                    updateAllAvatarElements(avatarUrl);

                    showToast('头像更新成功');
                    window.safeStorage.remove(CACHE_KEY);
                    await loadFeed(true);
                    setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                    updateAllAvatarElements(avatarUrl);
                } catch(e) {
                    console.error("上传头像失败:", e);
                    showToast('上传失败，请重试');
                }
                
                event.target.value = '';
            };

            function updateAllAvatarElements(avatarUrl) {
                var safeUrl = escapeHtml(sanitizeUrl(avatarUrl));
                if (!safeUrl) return;
                var avatarContent = renderAvatarContent(currentUser, avatarUrl);
                var els = [
                    document.getElementById('profileAvatar'),
                    document.getElementById('myAvatar'),
                    document.getElementById('profileDetailAvatar'),
                    document.getElementById('upcAvatar')
                ];
                els.forEach(function(el) {
                    if (el) {
                        el.innerHTML = avatarContent;
                    }
                });
                document.querySelectorAll('#feed .post .avatar').forEach(function(el) {
                    var header = el.closest('.post-header');
                    if (header) {
                        var nameEl = header.querySelector('.user-name');
                        if (nameEl && nameEl.textContent === currentUser) {
                            el.innerHTML = avatarContent;
                        }
                    }
                });
                document.querySelectorAll('#dockChatMessages .chat-msg-avatar').forEach(function(el) {
                    if (el.closest('.chat-msg-row.sent')) {
                        el.innerHTML = avatarContent;
                    }
                });
                document.querySelectorAll('#dockChatList .chat-list-item').forEach(function(el) {
                    var nameEl = el.querySelector('.cli-name');
                    if (nameEl && nameEl.textContent === currentUser) {
                        var avEl = el.querySelector('.cli-avatar');
                        if (avEl) {
                            avEl.innerHTML = avatarContent;
                        }
                    }
                });
            }

            async function updateAllAvatars() {
                // 统一更新所有用户头像缓存（含 localStorage）
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[currentUser] && cachedAvatars[currentUser].url) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        const profileAvatar = document.getElementById('profileAvatar');
                        if (profileAvatar) {
                            profileAvatar.innerHTML = renderAvatarContent(currentUser, cachedAvatars[currentUser].url);
                        }
                        return;
                    }
                } catch(e) {}

                try {
                    const avatarRes = await sb.from("posts")
                        .select("media_url")
                        .eq("user_name", currentUser)
                        .eq("media_type", "__avatar__")
                        .eq("actor_key", "__avatar__")
                        .order("created_at", { ascending: false })
                        .limit(1);

                    const profileAvatar = document.getElementById('profileAvatar');
                    if (profileAvatar) {
                        if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                            profileAvatar.innerHTML = renderAvatarContent(currentUser, avatarRes.data[0].media_url);
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarRes.data[0].media_url);
                            try {
                                var cv = readAvatarCacheFromStorage();
                                cv[currentUser] = { state: 'has_avatar', url: avatarRes.data[0].media_url, fetched_at: Date.now() };
                                writeAvatarCacheToStorage(cv);
                            } catch(e) {}
                        } else {
                            profileAvatar.innerHTML = currentUser ? currentUser[0].toUpperCase() : '?';
                        }
                    }
                } catch(e) {
                    console.error("更新头像显示失败:", e);
                }
            }

            window.doLogoutFromProfile = function() {
                closeModal('profileDetailModal');
                doLogout();
            };

            var _isLoggingOut = false;
            window.doLogout = async function () {
                if (_isLoggingOut) return;
                _isLoggingOut = true;

                try { if (typeof window.xtjStopLocationSharing === 'function') window.xtjStopLocationSharing('位置共享已关闭'); } catch (e) {}

                var savedToken = '';
                var savedUser = '';
                try { savedToken = getUserToken() || ''; } catch (e) {}
                try { savedUser = currentUser || window.currentUser || ''; } catch (e) {}

                var logoutCallSucceeded = false;
                try {
                    var logoutHeaders = { 'Content-Type': 'application/json' };
                    if (savedToken) logoutHeaders.Authorization = 'Bearer ' + savedToken;
                    // H-37: 登出请求加 8s 超时，避免请求悬挂时 _isLoggingOut 永真，
                    // 导致之后所有登出点击无效、本地状态永不清除。
                    var logoutAbortCtl = null;
                    var logoutTimeoutTimer = null;
                    if (typeof AbortController === 'function') {
                        logoutAbortCtl = new AbortController();
                        logoutTimeoutTimer = setTimeout(function() { try { logoutAbortCtl.abort(); } catch (e) {} }, 8000);
                    }
                    var resp = await fetch(API_BASE + '/api/user/logout', {
                        method: 'POST',
                        credentials: 'include',
                        headers: logoutHeaders,
                        signal: logoutAbortCtl ? logoutAbortCtl.signal : undefined
                    });
                    if (logoutTimeoutTimer) clearTimeout(logoutTimeoutTimer);
                    if (resp && resp.ok) logoutCallSucceeded = true;
                } catch (e) {
                    console.error('API logout failed (will still clear local state):', e);
                }

                try {
                    if (typeof window.__xtjAbortAiRequests === 'function') window.__xtjAbortAiRequests();
                } catch (e) {}
                try {
                    // Phase 3-P0-2: 使用统一清理函数，替代分散的内联清理
                    if (typeof cancelCatAiTask === 'function') cancelCatAiTask();
                } catch (e) {}
                try { stopRestrictionPolling(); } catch (e) {}
                try { stopDMPolling(); } catch (e) {}
                try { stopReportReplyPolling(); } catch (e) {}
                try { if (chatRealtime) { sb.removeChannel(chatRealtime); chatRealtime = null; } } catch (e) {}
                try { if (commentRealtime) { sb.removeChannel(commentRealtime); commentRealtime = null; } } catch (e) {}
                try { if (annRealtime) { sb.removeChannel(annRealtime); annRealtime = null; } } catch (e) {}

                clearUserToken();
                lastUserSessionWriteAt = 0;
                try { sessionStorage.removeItem('xtj_pw_hash'); } catch(e) {}
                try { window.safeStorage.remove('xtj_pw_hash'); } catch(e) {}
                try { window.safeStorage.remove('xtj_user'); } catch(e) {}
                try { window.safeStorage.remove(USER_SESSION_KEY); } catch(e) {}
                try { sessionStorage.removeItem('xtj_user'); } catch(e) {}
                try { if (typeof window.clearAiHistoryCacheForUser === 'function') window.clearAiHistoryCacheForUser(); } catch(e) {}
                try { window.safeStorage.remove('xtj_ai_history'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_ai_history'); } catch(e) {}
                try { window.safeStorage.remove('xtj_profile_cache'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_profile_cache'); } catch(e) {}
                try { avatarCache = {}; } catch(e) {}
                try { window.safeStorage.remove(AVATAR_CACHE_KEY); } catch(e) {}

                currentUser = '';
                window.currentUser = '';
                window._lastKnownUser = '';
                window.currentUserInfoSnapshot = null;
                _chatCache = {};
                // M-2d: 登出时复位聊天面板会话状态，防止切换账号后残留上一账号的
                // 聊天标题/渲染签名，导致串号或列表不刷新
                try { dockChatActiveUser = null; } catch(e) {}
                try { _dockChatListRenderSignature = ''; } catch(e) {}
                try { _chatRenderSignature = {}; } catch(e) {}
                window.dockChatListCacheTime = 0;
                window._xtjAuthState = 'unauthenticated';
                // L11 修复：登出时断开浏览量 Observer 并清空跨会话缓存，避免单页长开内存缓慢增长
                try { if (typeof window.__xtjCleanupObservers === 'function') window.__xtjCleanupObservers(); } catch(e) {}
                try { if (typeof window.viewTracked === 'object' && window.viewTracked.clear) window.viewTracked.clear(); } catch(e) {}
                try { if (typeof window.postInfoCache === 'object') { Object.keys(window.postInfoCache).forEach(function(k) { delete window.postInfoCache[k]; }); } } catch(e) {}

                var xtjKeys = [];
                // H-36: 登出只清除会话相关键，保留用户偏好与设备身份：
                // xtj-theme（主题偏好，theme-toggle.js 实际使用连字符 key）、xtj_device_id（设备 ID，设备追踪）、
                // xtj_pending_behavior（未上报的遥测队列）。
                // ★ 修复：新增 xtj-notif（通知开关偏好）、xtj_report_reply_check（举报回复提醒）、
                // xtj_current_tab（最近停留 tab）等用户偏好键，避免登出静默重置用户设置。
                var xtjPreserveKeys = {
                    'xtj-theme': 1,
                    'xtj_theme': 1,
                    'xtj_device_id': 1,
                    'xtj_pending_behavior': 1,
                    'xtj-notif': 1,
                    'xtj_report_reply_check': 1,
                    'xtj_current_tab': 1
                };
                try {
                    for (var i = 0; i < localStorage.length; i++) {
                        var key = localStorage.key(i);
                        if (key && (key.indexOf('xtj_') === 0 || key.indexOf('xtj-') === 0) && !xtjPreserveKeys[key]) {
                            xtjKeys.push(key);
                        }
                    }
                } catch (e) {}
                xtjKeys.forEach(function(k) {
                    try { window.safeStorage.remove(k); } catch(e) {}
                });
                clearUserSessionStorage();
                try {
                    var loginNick = document.getElementById('loginNickInp');
                    var loginPw = document.getElementById('loginPwInp');
                    var regNick = document.getElementById('regNickInp');
                    var regPw = document.getElementById('regPwInp');
                    if (loginNick) loginNick.value = '';
                    if (loginPw) loginPw.value = '';
                    if (regNick) regNick.value = '';
                    if (regPw) regPw.value = '';
                } catch (e) {}
                document.body.style.overflow = '';

                try { if (typeof window.__xtjBroadcastLogout === 'function') window.__xtjBroadcastLogout('manual'); } catch(e) {}
                try { if (typeof window.queueBehavior === 'function') window.queueBehavior('logout', '用户退出登录'); } catch(e) {}

                showToast('已退出登录');
                try { await initUI(); } catch (e) {}
                initialLoad(true).catch(function() {});
                _isLoggingOut = false;
            };

            // 处理"我的"页面卡片点击
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 已登录：打开个人资料详情
                    openProfileDetail();
                } else {
                    // 未登录：弹出登录框
                    openAuthModal('login');
                }
            };

            var profileActivityState = {
                likes: [],
                comments: [],
                reports: [],
                posts: {},
                totals: {
                    posts: 0,
                    likes: 0,
                    comments: 0,
                    reports: 0
                },
                modalKind: '',
                loadedUser: '',
                loading: false,
                lastLoadedAt: 0
            };

            function renderProfileTotals() {
                var postsEl = document.getElementById('profileTotalPosts');
                var likesEl = document.getElementById('profileTotalLikes');
                var commentsEl = document.getElementById('profileTotalComments');
                if (!postsEl || !likesEl || !commentsEl) return;
                var totals = profileActivityState.totals || {};
                postsEl.textContent = String(totals.posts || 0);
                likesEl.textContent = String(totals.likes || 0);
                commentsEl.textContent = String(totals.comments || 0);
            }

            function getProfileActivityPostMap() {
                return profileActivityState.posts || {};
            }

            function isProfileActivityBlockedPost(post) {
                if (!post) return true;
                var normalized = normalizePost(post || {});
                var mediaType = String(normalized.media_type || '');
                return mediaType === AUTH_MARKER
                    || mediaType === ADMIN_AUTH_MARKER
                    || mediaType === ADMIN_META_MARKER
                    || mediaType === DM_MARKER
                    || mediaType === REPORT_MARKER
                    || mediaType === '__avatar__'
                    || mediaType === '__user_info__'
                    || mediaType === '__photo_wall__'
                    || mediaType === '__visit__'
                    || mediaType === '__attack__'
                    || mediaType === '__user_visit__'
                    || mediaType === '__ann__'
                    || mediaType === '__email_sent__'
                    || mediaType === '__email_recipient_history__'
                    || mediaType === '__vip__'
                    || mediaType === '__vip_order__'
                    || mediaType === '__vip_plan__'
                    || mediaType === '__ai_agent_profile__'
                    || mediaType === '__ai_agent_msg__'
                    || mediaType === '__ai_agent_memory__'
                    || mediaType === '__ai_agent_config__'
                    || mediaType === '**ai_agent_memory_box**'
                    || mediaType === '**ai_agent_conv_summary**'
                    || mediaType === '**ai_agent_memory_log**'
                    || mediaType === '__user_style__'
                    || mediaType === '__revoked_token__'
                    || mediaType === '__refresh_token__';
            }

            function repairProfileActivityText(value) {
                var text = value == null ? '' : String(value);
                if (!text) return '';
                if (typeof window.__xtjUiTextRepair === 'function') {
                    try {
                        var repaired = window.__xtjUiTextRepair(text);
                        if (typeof repaired === 'string' && repaired) text = repaired;
                    } catch (e) {}
                }
                if (/[ÃÂâ€œâ€\u00A0-\u00FF]/.test(text) && !/[\u4e00-\u9fff]/.test(text)) {
                    try {
                        var utf8 = decodeURIComponent(text.split('').map(function(ch) {
                            var code = ch.charCodeAt(0);
                            return code <= 255 ? '%' + code.toString(16).padStart(2, '0') : ch;
                        }).join(''));
                        if (utf8 && utf8 !== text) text = utf8;
                    } catch (e) {}
                }
                return text.replace(/\s+/g, ' ').trim();
            }

            function getProfileActivityPost(postId) {
                var post = getProfileActivityPostMap()[String(postId)] || null;
                if (!post || isProfileActivityBlockedPost(post) || !canViewPost(post)) return null;
                return post;
            }

            // 返回列表副本（状态快照使用，避免外部数组被后续修改污染内部状态）
            function cloneProfileLikes(items) {
                return Array.isArray(items) ? items.slice() : [];
            }

            function buildProfileActivityExcerpt(value, maxLength) {
                var text = repairProfileActivityText(value || '');
                var limit = Math.max(32, Number(maxLength) || 120);
                if (!text) return '';
                return text.length > limit ? text.slice(0, limit) + '...' : text;
            }

            function profileActivitySummary(post, maxLength) {
                var normalized = normalizePost(post || {});
                var text = buildProfileActivityExcerpt(normalized.content || '', maxLength || 120);
                if (text) return text;
                if (normalized.media_type === 'video') return '视频动态';
                if (normalized.media_type === 'image') return '图片动态';
                return '无文字内容';
            }

            function profileActivityMedia(post, postId) {
                var normalized = normalizePost(post || {});
                if (!normalized.media_url) return '';
                var onclick = "event.stopPropagation();openProfileActivityMedia('" + safeJsStr(String(postId || normalized.id || '')) + "')";
                if (normalized.media_type === 'image') {
                    return '<img class="stat-record-thumb" src="' + escapeHtml(normalized.media_url) + '" alt="" loading="lazy" decoding="async" fetchpriority="low" onclick="' + onclick + '" />';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="stat-record-thumb stat-record-thumb--video" onclick="' + onclick + '">视频</div>';
                }
                return '';
            }

            
            function buildProfileActivityListMarkup(kind, limit) {
                var isLikes = kind === 'likes';
                var items = isLikes ? (profileActivityState.likes || []) : (profileActivityState.comments || []);
                var totals = profileActivityState.totals || {};
                var exactCount = isLikes ? (totals.likes || 0) : (totals.comments || 0);
                if (!currentUser) {
                    return {
                        html: '<div class="profile-activity-empty">登录后，这里会显示你的点赞和评论记录。</div>',
                        totalCount: 0,
                        hasMore: false
                    };
                }
                if (!items.length) {
                    return {
                        html: '<div class="profile-activity-empty">' + (isLikes ? '你还没有点赞任何帖子。' : '你还没有留下评论记录。') + '</div>',
                        totalCount: 0,
                        hasMore: false
                    };
                }
                var visibleItems = typeof limit === 'number' ? items.slice(0, limit) : items.slice();
                var html = visibleItems.map(function(item, index) {
                    var post = getProfileActivityPost(item.post_id);
                    var normalized = normalizePost(post || {});
                    var mediaHtml = post ? profileActivityMedia(post, item.post_id) : '';
                    var openPostOnclick = "openProfileActivityPost('" + safeJsStr(String(item.post_id)) + "')";
                    var summary = post ? profileActivitySummary(post, isLikes ? 140 : 120) : '帖子已删除或不可查看';
                    var canOpenPost = !!(post && item.post_id);
                    var commentText = buildProfileActivityExcerpt(item.content || '', 140);
                    var commentNoteHtml = '';
                    if (!isLikes && commentText) {
                        commentNoteHtml = '<div class="stat-record-note"><strong>我的评论：</strong>' + escapeHtml(commentText) + '</div>';
                    }
                    var actionHtml = isLikes
                        ? '<button type="button" class="stat-record-action is-danger" onclick="event.stopPropagation();unlikeFromProfile(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">取消点赞</button>'
                        : '<button type="button" class="stat-record-action is-danger" onclick="event.stopPropagation();deleteProfileComment(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">删除评论</button>';
                    var cardAttrs = canOpenPost
                        ? ' role="button" tabindex="0" onclick="' + openPostOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + openPostOnclick + '}"'
                        : '';
                    var titleText = escapeHtml((typeof currentUser === 'object' && currentUser ? (currentUser.user_metadata?.full_name || currentUser.email) : (typeof currentUser === 'string' ? currentUser : '')) || '我') + (isLikes ? ' 点赞了这条帖子' : ' 评论了这条帖子');
                    var metaHtml = [
                        '<div class="profile-activity-record__meta">',
                        '<span class="profile-activity-record__time">' + window.safeParseDate(item.created_at).toLocaleString() + '</span>',
                        canOpenPost ? '<span class="profile-activity-record__hint">点击查看详情</span>' : '<span class="profile-activity-record__hint is-muted">当前不可查看详情</span>',
                        '</div>'
                    ].join('');
                    return [
                        '<article class="stat-record-entry stat-row profile-activity-record ' + (isLikes ? 'profile-activity-record--like' : 'profile-activity-record--comment') + (mediaHtml ? '' : ' stat-row--no-media') + (canOpenPost ? '' : ' is-disabled') + '"' + cardAttrs + ' style="--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;">',
                        '<div class="profile-activity-record__main">',
                        '<div class="profile-activity-record__header">',
                        '<div class="profile-activity-record__title">' + titleText + '</div>',
                        metaHtml,
                        '</div>',
                        '<div class="profile-activity-record__summary">' + escapeHtml(summary) + '</div>',
                        commentNoteHtml,
                        '</div>',
                        mediaHtml ? '<div class="profile-activity-record__media">' + mediaHtml + '</div>' : '',
                        '<div class="profile-activity-record__actions">' + actionHtml + '</div>',
                        '</article>'
                    ].join('');
                }).join('');
                return {
                    html: html,
                    totalCount: exactCount || items.length || 0,
                    hasMore: (exactCount || items.length || 0) > 1
                };
            }
            
function renderProfileActivityList(kind) {
                var isLikes = kind === 'likes';
                var listEl = document.getElementById(isLikes ? 'profileLikesList' : 'profileCommentsList');
                var countEl = document.getElementById(isLikes ? 'profileLikesCount' : 'profileCommentsCount');
                var moreBtn = document.getElementById(isLikes ? 'profileLikesMoreBtn' : 'profileCommentsMoreBtn');
                var cardEl = document.getElementById(isLikes ? 'profileLikesCard' : 'profileCommentsCard');
                if (!listEl || !countEl || !moreBtn) return;
                var payload = buildProfileActivityListMarkup(kind, 0);
                countEl.textContent = String(payload.totalCount || 0);
                listEl.innerHTML = '';
                listEl.style.display = 'none';
                moreBtn.style.display = 'none';
                if (cardEl) {
                    cardEl.classList.toggle('is-empty', !payload.totalCount);
                    cardEl.setAttribute('aria-label', (isLikes ? '点赞记录' : '评论记录') + '，共 ' + String(payload.totalCount || 0) + ' 条');
                }
            }

            function renderProfileActivityModal(kind) {
                var listEl = document.getElementById('profileActivityModalList');
                var titleEl = document.getElementById('profileActivityModalTitle');
                var kickerEl = document.getElementById('profileActivityModalKicker');
                var modal = document.getElementById('profileActivityModal');
                if (!listEl || !titleEl || !kickerEl || !modal) return;
                var isLikes = kind === 'likes';
                var payload = buildProfileActivityListMarkup(kind);
                titleEl.textContent = isLikes ? '点赞记录' : '评论记录';
                kickerEl.textContent = isLikes ? '我的互动' : '我的留言';
                listEl.innerHTML = payload.html;
                profileActivityState.modalKind = kind;
                modal.classList.add('active');
            }

            function refreshProfileActivityModalIfNeeded() {
                if (!profileActivityState.modalKind) return;
                var modal = document.getElementById('profileActivityModal');
                if (!modal || !modal.classList.contains('active')) return;
                renderProfileActivityModal(profileActivityState.modalKind);
            }

            function renderProfileActivity() {
                renderProfileTotals();
                renderProfileActivityList('likes');
                renderProfileActivityList('comments');
                refreshProfileActivityModalIfNeeded();
            }

            function ensureReportHistoryModal() {
                if (document.getElementById('reportHistoryModal')) return;
                var wrap = document.createElement('div');
                wrap.innerHTML = [
                    '<div class="report-modal-overlay report-history-overlay" id="reportHistoryModal" onclick="if(event.target===this)closeReportHistoryModal()">',
                    '  <div class="report-modal report-history-modal" onclick="event.stopPropagation()">',
                    '    <div class="report-modal-header">',
                    '      <div class="report-modal-header-left"><span>举报记录</span></div>',
                    '      <button class="report-modal-close" onclick="closeReportHistoryModal()" aria-label="关闭">✕</button>',
                    '    </div>',
                    '    <div class="report-history-body">',
                    '      <div class="report-records-list" id="reportHistoryList"><div class="report-records-empty">加载中...</div></div>',
                    '    </div>',
                    '  </div>',
                    '</div>'
                ].join('');
                document.body.appendChild(wrap.firstElementChild);
            }

            function syncReportModalBodyLock() {
                var formModal = document.getElementById('reportModal');
                var historyModal = document.getElementById('reportHistoryModal');
                var formOpen = !!(formModal && formModal.classList.contains('active'));
                var historyOpen = !!(historyModal && historyModal.classList.contains('active'));
                document.body.style.overflow = formOpen || historyOpen ? 'hidden' : '';
            }

            // ===================== 举报弹窗内的举报记录 =====================
            window.toggleReportRecords = async function() {
                if (typeof clearReportReplyBadge === 'function') clearReportReplyBadge();
                ensureReportHistoryModal();
                var modal = document.getElementById('reportHistoryModal');
                if (!modal) return;
                modal.classList.add('active');
                syncReportModalBodyLock();
                await loadMyReportRecords();
            };

            window.closeReportHistoryModal = function() {
                var modal = document.getElementById('reportHistoryModal');
                if (!modal) return;
                modal.classList.remove('active');
                syncReportModalBodyLock();
            };

            async function loadMyReportRecords() {
                if (!window.currentUser) {
                    var list = document.getElementById('reportHistoryList') || document.getElementById('reportRecordsList');
                    if (list) list.innerHTML = '<div class="report-records-empty">请先登录</div>';
                    return;
                }
                var list = document.getElementById('reportHistoryList') || document.getElementById('reportRecordsList');
                if (!list) return;
                try {
                    if (!window.sb) {
                        list.innerHTML = '<div class="report-records-empty">数据库连接未初始化</div>';
                        return;
                    }
                    var res = await sb.from('posts')
                        .select('id, content, created_at')
                        .eq('user_name', window.currentUser)
                        .eq('media_type', REPORT_MARKER)
                        .order('created_at', { ascending: false })
                        .limit(160);
                    if (res && res.error) throw res.error;
                    var records = (res.data || []).map(function(p) {
                        var c = {};
                        try { c = JSON.parse(p.content || '{}'); } catch(e) {}
                        return {
                            id: p.id,
                            created_at: p.created_at,
                            target_type: c.target_type || 'post',
                            target_id: c.target_id || '',
                            target_user: c.target_user || '',
                            report_reason: c.report_reason || '',
                            status: c.status || 'pending',
                            admin_response: c.admin_response || null,
                            reviewed_at: c.reviewed_at || null
                        };
                    });
                    if (!records.length) {
                        list.innerHTML = '<div class="report-records-empty">你还没有举报记录。</div>';
                        return;
                    }
                    var triggerBtn = document.getElementById('reportRecordsToggleBtn');
                    if (triggerBtn) {
                        triggerBtn.textContent = '举报记录';
                        triggerBtn.setAttribute('aria-label', '打开举报记录');
                    }
                    list.innerHTML = records.map(function(r) {
                        var targetTypeLabel = r.target_type === 'photo' ? '照片墙' : '帖子';
                        var statusText = r.status === 'pending' ? '待处理' : (r.status === 'actioned' ? '已处理' : (r.status === 'reviewed' ? '已审阅' : String(r.status || '处理中')));
                        var statusClass = r.status === 'actioned' ? ' report-record-status--actioned' : (r.status === 'reviewed' ? ' report-record-status--reviewed' : '');
                        var reasonText = escapeHtml(String(r.report_reason || '未填写举报原因'));
                        var hasReply = !!r.admin_response;
                        var footerNotes = [];
                        footerNotes.push('<span class="report-record-note">举报对象：' + (r.target_user ? escapeHtml(r.target_user) : '未知发布者') + '</span>');
                        if (r.reviewed_at) footerNotes.push('<span class="report-record-note">处理时间：' + escapeHtml(formatReportTime(r.reviewed_at)) + '</span>');
                        var replyContentHtml = hasReply
                            ? '<div class="report-record-reply"><div class="report-record-reply-label">管理员回复</div><div class="report-record-reply-body">' + escapeHtml(r.admin_response) + '</div></div>'
                            : '';
                        return [
                            '<article class="report-record-item">',
                            '<div class="report-record-head">',
                            '<div class="report-record-badges">',
                            '<span class="report-record-badge">' + escapeHtml(targetTypeLabel) + '</span>',
                            '<span class="report-record-status' + statusClass + '">' + escapeHtml(statusText) + '</span>',
                            '</div>',
                            '<span class="report-record-time">' + escapeHtml(formatReportTime(r.created_at)) + '</span>',
                            '</div>',
                            '<div class="report-record-main">',
                            '<div class="report-record-title">举报' + escapeHtml(targetTypeLabel) + (r.target_user ? ' · ' + escapeHtml(r.target_user) : '') + '</div>',
                            '<div class="report-record-reason">' + reasonText + '</div>',
                            '<div class="report-record-footer">' + footerNotes.join('') + '</div>',
                            '</div>',
                            replyContentHtml,
                            '</article>'
                        ].join('');
                    }).join('');
                } catch(e) {
                    console.error('[XTJ] loadMyReportRecords error:', e);
                    list.innerHTML = '<div class="report-records-empty">加载失败，请重试</div>';
                }
            }

            async function loadProfileActivity(forceRefresh) {
                forceRefresh = !!forceRefresh;
                if (loadProfileActivity._debounceTimer) {
                    clearTimeout(loadProfileActivity._debounceTimer);
                }
                if (forceRefresh) {
                    // 强制刷新立即执行
                    return _doLoadProfileActivity(true);
                }
                return new Promise(function(resolve) {
                    loadProfileActivity._debounceTimer = setTimeout(function() {
                        loadProfileActivity._debounceTimer = null;
                        _doLoadProfileActivity(false).then(resolve);
                    }, 500);
                });
            }
            async function _doLoadProfileActivity(forceRefresh) {
                if (!document.getElementById('panelProfile')) return;
                if (!currentUser) {
                    profileActivityState.likes = [];
                    profileActivityState.comments = [];
                    profileActivityState.reports = [];
                    profileActivityState.posts = {};
                    profileActivityState.totals = { posts: 0, likes: 0, comments: 0, reports: 0 };
                    profileActivityState.loadedUser = '';
                    renderProfileActivity();
                    return;
                }
                if (profileActivityState.loading) return;
                // ★ 修复：缓存窗口从 45000ms 缩短到 8000ms —— 用户在其他页面点赞/评论后，
                // 45 秒内切回"我的"面板看不到更新；缩短后切回即可较快看到最新互动数据。
                if (!forceRefresh && profileActivityState.loadedUser === currentUser && Date.now() - profileActivityState.lastLoadedAt < 8000) {
                    renderProfileActivity();
                    return;
                }
                profileActivityState.loading = true;
                try {
                    var results = await Promise.all([
                        window.xtjProtectedFetch('/api/likes/user/' + encodeURIComponent(currentUser) + '?limit=160')
                            .then(function(r) { return r.json(); })
                            .catch(function(e) { return { ok: false, error: e.message }; }),
                        window.xtjProtectedFetch('/api/comments/user/' + encodeURIComponent(currentUser) + '?limit=160')
                            .then(async function(response) {
                                var body = await response.json();
                                if (!response.ok || !body.ok) throw new Error(body.error || '评论记录加载失败');
                                return body;
                            })
                            .catch(function(error) { return { error: error, data: [], count: 0 }; }),
                        sb.from('posts')
                            .select('id', { count: 'exact', head: true })
                            .eq('user_name', currentUser)
                            .neq('media_type', AUTH_MARKER)
                            .neq('media_type', DM_MARKER)
                            .neq('media_type', REPORT_MARKER)
                            .neq('media_type', '__avatar__')
                            .neq('media_type', '__user_info__')
                            .neq('media_type', '__photo_wall__')
                            .neq('media_type', '__visit__')
                            .neq('media_type', '__attack__')
                            .neq('media_type', '__ann__')
                            .neq('media_type', ADMIN_META_MARKER),
                        sb.from('posts')
                            .select('id, content, created_at, media_type')
                            .eq('user_name', currentUser)
                            .eq('media_type', REPORT_MARKER)
                            .order('created_at', { ascending: false })
                            .limit(160)
                    ]);
                    var likesRes = results[0];
                    var commentsRes = results[1];
                    var postsCountRes = results[2];
                    var reportsRes = results[3];
                    if (likesRes && !likesRes.ok) console.warn('likes load warning:', likesRes.error);
                    if (commentsRes.error) throw commentsRes.error;
                    if (postsCountRes.error) throw postsCountRes.error;
                    if (reportsRes && reportsRes.error) console.warn('reports load warning:', reportsRes.error);

                    profileActivityState.likes = cloneProfileLikes(likesRes && likesRes.data || []);
                    profileActivityState.comments = commentsRes.data || [];
                    profileActivityState.reports = (reportsRes && reportsRes.data || []).map(function(p) {
                        var c = {};
                        try { c = JSON.parse(p.content || '{}'); } catch(e) {}
                        return {
                            id: p.id,
                            created_at: p.created_at,
                            target_type: c.target_type || 'post',
                            target_id: c.target_id || '',
                            target_user: c.target_user || '',
                            report_reason: c.report_reason || '',
                            status: c.status || 'pending',
                            admin_response: c.admin_response || null,
                            reviewed_at: c.reviewed_at || null
                        };
                    });
                    profileActivityState.totals = {
                        posts: postsCountRes.count || 0,
                        likes: profileActivityState.likes.length,
                        comments: commentsRes.count || (commentsRes.data || []).length,
                        reports: profileActivityState.reports.length
                    };

                    var ids = Array.from(new Set(profileActivityState.likes.concat(profileActivityState.comments).map(function(item) {
                        return item && item.post_id != null ? String(item.post_id) : '';
                    }).filter(Boolean)));

                    var postMap = {};
                    (Array.isArray(feedAllPosts) ? feedAllPosts : []).forEach(function(post) {
                        if (post && post.id != null) postMap[String(post.id)] = normalizePost(post);
                    });
                    if (ids.length) {
                        var missingIds = ids.filter(function(id) { return !postMap[String(id)]; });
                        if (missingIds.length) {
                            var postsRes = await sb.from('posts')
                                .select('*')
                                .in('id', missingIds)
                                .limit(Math.min(missingIds.length, 160));
                            if (!postsRes.error) {
                                (postsRes.data || []).forEach(function(post) {
                                    postMap[String(post.id)] = normalizePost(post);
                                });
                            }
                        }
                    }

                    profileActivityState.posts = postMap;
                    profileActivityState.loadedUser = currentUser;
                    profileActivityState.lastLoadedAt = Date.now();
                    renderProfileActivity();
                } catch (e) {
                    console.error('loadProfileActivity error:', e);
                    var likesList = document.getElementById('profileLikesList');
                    var commentsList = document.getElementById('profileCommentsList');
                    if (likesList) likesList.innerHTML = '<div class="profile-activity-empty">点赞记录加载失败，请稍后重试。</div>';
                    if (commentsList) commentsList.innerHTML = '<div class="profile-activity-empty">评论记录加载失败，请稍后重试。</div>';
                } finally {
                    profileActivityState.loading = false;
                }
            }

            window.toggleProfileActivity = function(kind) {
                if (!currentUser) {
                    showToast('请先登录');
                    return;
                }
                try {
                    renderProfileActivityModal(kind);
                } catch(e) {
                    console.error('[ProfileActivity] ERROR:', e);
                    showToast('打开记录失败：' + (e?.message || e));
                }
            };

            window.closeProfileActivityModal = function() {
                profileActivityState.modalKind = '';
                var modal = document.getElementById('profileActivityModal');
                if (modal) modal.classList.remove('active');
            };

            window.openProfileActivityPost = function(postId) {
                if (!postId) return;
                window.closeProfileActivityModal();
                openPostDetail(postId);
            };

            window.openProfileActivityMedia = function(postId) {
                var post = getProfileActivityPost(postId);
                if (!post) {
                    window.closeProfileActivityModal();
                    openPostDetail(postId);
                    return;
                }
                if (post.media_type === 'image' && post.media_url && typeof window.openPhotoPreview === 'function') {
                    window.closeProfileActivityModal();
                    openPostImagePreview(sanitizeUrl(post.media_url), {
                        getAttribute: function(name) {
                            var normalized = normalizePost(post);
                            if (name === 'data-post-id') return String(normalized.id || '');
                            if (name === 'data-post-user') return String(normalized.user_name || '');
                            if (name === 'data-post-created-at') return String(normalized.created_at || '');
                            if (name === 'data-post-views') return String(normalized.views || 0);
                            if (name === 'data-file-size') return String((normalized._contentMeta && normalized._contentMeta.fileSize) || '');
                            if (name === 'data-original-size') return String((normalized._contentMeta && normalized._contentMeta.originalSize) || '');
                            if (name === 'data-actor-key') return String(normalized.actor_key || '');
                            if (name === 'data-can-delete') return canDeletePost(normalized) ? '1' : '0';
                            if (name === 'src') return sanitizeUrl(normalized.media_url || '');
                            return '';
                        }
                    });
                    return;
                }
                window.closeProfileActivityModal();
                openPostDetail(post.id);
                if (post.media_type === 'video') {
                    setTimeout(function() {
                        try {
                            var video = document.querySelector('#postDetailBody .post-detail-media video');
                            if (video && typeof video.play === 'function') video.play().catch(function() {});
                        } catch (_) {}
                    }, 200);
                }
            };

            window.unlikeFromProfile = async function(likeId, postId, btn) {
                if (!currentUser) return;
                var originalText = btn ? btn.textContent : '';
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '取消中..';
                    }
                    var resp = await window.xtjProtectedFetch('/api/likes/user/' + encodeURIComponent(currentUser) + '/post/' + postId, { method: 'DELETE' });
                    var result = await resp.json();
                    if (!resp.ok || !result.ok) throw new Error(result.error || '删除失败');

                    profileActivityState.likes = (profileActivityState.likes || []).filter(function(item) {
                        if (postId) return !(String(item.post_id) === String(postId) && String(item.user_name) === String(currentUser));
                        if (likeId) return String(item.id) !== String(likeId);
                        return true;
                    });
                    feedAllLikes = (feedAllLikes || []).filter(function(item) {
                        if (postId) return !(String(item.post_id) === String(postId) && String(item.user_name) === String(currentUser));
                        if (likeId && item && item.id != null) return String(item.id) !== String(likeId);
                        return true;
                    });
                    if (profileActivityState.totals && profileActivityState.totals.likes > 0) {
                        profileActivityState.totals.likes -= 1;
                    }
                    if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                    if (typeof updateFeedStats === 'function') updateFeedStats();
                    if (typeof refreshStatModal === 'function') refreshStatModal();
                    if (typeof rebuildFeedFromCurrentState === 'function') {
                        rebuildFeedFromCurrentState().catch(function() {});
                    }
                    renderProfileActivity();
                    showToast('已取消点赞');
                } catch (e) {
                    console.error('unlikeFromProfile error:', e);
                    showToast('取消点赞失败');
                    if (btn) btn.textContent = originalText || '取消点赞';
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        if (btn.textContent === '取消中..') btn.textContent = originalText || '取消点赞';
                    }
                }
            };

            window.deleteFeedComment = async function(commentId, btn) {
                if (!confirm('确定要永久删除这条评论吗？')) return;
                var originalText = btn ? btn.textContent : '删除';
                var controller = typeof AbortController === 'function' ? new AbortController() : null;
                var timeout = setTimeout(function() {
                    if (controller) controller.abort();
                }, 10000);
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '删除中..';
                    }
                    var response = await window.xtjProtectedFetch('/api/post/comment/' + encodeURIComponent(commentId), {
                        method: 'DELETE',
                        signal: controller ? controller.signal : undefined
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) throw new Error(result.error || '删除评论失败');
                    
                    feedAllComments = (feedAllComments || []).filter(function(item) {
                        return String(item.id) !== String(commentId);
                    });
                    if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                    if (typeof renderFeedFromMemoryState === 'function') {
                        renderFeedFromMemoryState();
                    } else if (typeof rebuildFeedFromCurrentState === 'function') {
                        rebuildFeedFromCurrentState().catch(function() {});
                    }
                    // 成功路径同样恢复按钮（disabled/textContent），
                    // 与 catch/finally 行为保持一致，避免按钮残留"删除中.."
                    if (btn) {
                        btn.disabled = false;
                        if (btn.textContent === '删除中..') btn.textContent = originalText || '删除';
                    }
                    showToast('评论已删除');
                } catch (e) {
                    console.error('deleteFeedComment error:', e);
                    showToast(e && e.name === 'AbortError' ? '删除超时，请重试' : (e.message || '删除失败'));
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                    }
                } finally {
                    clearTimeout(timeout);
                }
            };

            window.deleteProfileComment = async function(commentId, postId, btn) {
                if (!currentUser || !commentId) return;
                var originalText = btn ? btn.textContent : '';
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '删除中..';
                    }
                    var response = await window.xtjProtectedFetch('/api/post/comment/' + encodeURIComponent(commentId), {
                        method: 'DELETE'
                    });
                    var result = await response.json();
                    if (!response.ok || !result.ok) throw new Error(result.error || '删除评论失败');

                    profileActivityState.comments = (profileActivityState.comments || []).filter(function(item) {
                        return String(item.id) !== String(commentId);
                    });
                    if (profileActivityState.totals && profileActivityState.totals.comments > 0) {
                        profileActivityState.totals.comments -= 1;
                    }
                    feedAllComments = (feedAllComments || []).filter(function(item) {
                        return !(item && item.id != null && String(item.id) === String(commentId));
                    });
                    if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                    if (typeof updateFeedStats === 'function') updateFeedStats();
                    if (typeof refreshStatModal === 'function') refreshStatModal();
                    if (typeof rebuildFeedFromCurrentState === 'function') {
                        rebuildFeedFromCurrentState().catch(function() {});
                    }
                    renderProfileActivity();
                    showToast('已删除评论');
                } catch (e) {
                    console.error('deleteProfileComment error:', e);
                    showToast('删除评论失败');
                    if (btn) btn.textContent = originalText || '删除评论';
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        if (btn.textContent === '删除中..') btn.textContent = originalText || '删除评论';
                    }
                }
            };

            // ===================== 小猫 AI 自动回复状态轮询 =====================
            window.__catAiPollTimers = window.__catAiPollTimers || {};
            window.__catAiPollStatus = window.__catAiPollStatus || {};
            window.__catAiPollControllers = window.__catAiPollControllers || {};
            window.__catAiCancelledByComment = window.__catAiCancelledByComment || {};

            // Phase 4: 重写为接受 (commentId, reason) 参数，支持按 commentId 精确清理。
            // 不传 commentId 或 commentId 为 null/undefined 时向后兼容：清理所有。
            // 集中清理 timer / AbortController / status DOM / cache，并通过 _catAiCancelled
            // 纪元标志防止正在进行的 fetch 回调在清理后仍写入状态（迟到回调防护）。
            // 替代各处分散的内联清理逻辑，避免遗漏 controller 或 status DOM。
            function cancelCatAiTask(commentId, reason) {
                var isGlobal = (commentId == null);
                var commentIdStr = commentId != null ? String(commentId) : null;
                // 1. 递增取消纪元，让 pollCatAiReply 中正在进行的 fetch 回调检查后跳过
                if (isGlobal) {
                    window._catAiCancelled = (window._catAiCancelled || 0) + 1;
                } else if (commentIdStr) {
                    window.__catAiCancelledByComment[commentIdStr] = (window.__catAiCancelledByComment[commentIdStr] || 0) + 1;
                }
                // 2. 清理轮询 timer
                try {
                    var timers = window.__catAiPollTimers || {};
                    if (isGlobal) {
                        Object.keys(timers).forEach(function(k) { clearTimeout(timers[k]); });
                        window.__catAiPollTimers = {};
                    } else if (timers[commentIdStr]) {
                        clearTimeout(timers[commentIdStr]);
                        delete timers[commentIdStr];
                    }
                } catch(e) {}
                // 3. abort 进行中的 AbortController
                try {
                    var controllers = window.__catAiPollControllers || {};
                    if (isGlobal) {
                        Object.keys(controllers).forEach(function(k) {
                            try { controllers[k].abort(); } catch(err) {}
                        });
                        window.__catAiPollControllers = {};
                    } else if (controllers[commentIdStr]) {
                        try { controllers[commentIdStr].abort(); } catch(err) {}
                        delete controllers[commentIdStr];
                    }
                } catch(e) {}
                // 4. 移除状态元素
                try {
                    if (isGlobal) {
                        var statusEls = document.querySelectorAll('.cat-ai-status');
                        Array.prototype.forEach.call(statusEls, function(el) {
                            if (el && el.parentNode) el.parentNode.removeChild(el);
                        });
                    } else if (commentIdStr) {
                        var statusEl = document.querySelector('.cat-ai-status[data-comment-id="' + commentIdStr + '"]');
                        if (statusEl && statusEl.parentNode) statusEl.parentNode.removeChild(statusEl);
                    }
                } catch(e) {}
                // 5. 清空状态缓存
                try {
                    if (isGlobal) {
                        window.__catAiPollStatus = {};
                    } else if (commentIdStr) {
                        delete window.__catAiPollStatus[commentIdStr];
                    }
                } catch(e) {}
                // 6. 记录取消原因（全局清理时忽略）
                if (!isGlobal && reason) {
                    console.log('[CAT_AI] task cancelled for comment', commentIdStr, 'reason:', reason);
                }
            }

            function pollCatAiReply(commentId, postId) {
                // 清理旧轮询
                if (window.__catAiPollTimers[commentId]) {
                    clearTimeout(window.__catAiPollTimers[commentId]);
                }
                if (window.__catAiPollControllers[commentId]) {
                    try { window.__catAiPollControllers[commentId].abort(); } catch(e) {}
                    delete window.__catAiPollControllers[commentId];
                }
                var baseInterval = 2000; // 基础间隔2秒
                var retryCount = 0;
                var maxRetries = 5;
                // ★ 使用实际运行时间，页面隐藏时不消耗超时
                var accumulatedRunTime = 0;
                var maxRunTime = 90000; // 最多实际运行90秒
                var lastPollStart = 0;
                var pausedAt = 0;
                var notTriggeredCount = 0; // not_triggered 连续计数
                var commentIdStr = String(commentId);
                // A per-comment generation is required here: deleting one
                // comment must invalidate only its in-flight callback. The
                // old global epoch protected logout, but not single-comment
                // cancellation, so a late response could recreate ghost UI.
                window.__catAiCancelledByComment = window.__catAiCancelledByComment || {};
                window.__catAiCancelledByComment[commentIdStr] = (window.__catAiCancelledByComment[commentIdStr] || 0) + 1;
                var myGlobalEpoch = window._catAiCancelled || 0;
                var myCommentEpoch = window.__catAiCancelledByComment[commentIdStr];
                // Phase 3-P0-5: 记录 postId 以供 visibilitychange 恢复轮询使用
                window.__catAiPollStatus[commentIdStr] = { postId: String(postId) };

                // 显示临时状态
                showCatAiStatus(commentIdStr, '小猫正在组织毒液……');

                function poll() {
                    if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                        (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) return;
                    // ★ 页面隐藏时记录暂停时间，不删除任务，不消耗运行时间
                    if (document.hidden) {
                        if (!pausedAt) pausedAt = Date.now();
                        // ★ 修复：先清掉旧 timer 再设新 timer，避免隐藏期间重复进入
                        // 本分支时多个 setTimeout 并存造成双链轮询/定时器堆积
                        if (window.__catAiPollTimers[commentIdStr]) clearTimeout(window.__catAiPollTimers[commentIdStr]);
                        window.__catAiPollTimers[commentIdStr] = setTimeout(poll, 3000);
                        return;
                    }
                    // ★ 恢复可见时，清空暂停标记，不把隐藏时间加入运行时间
                    if (pausedAt) {
                        pausedAt = 0;
                    }
                    if (accumulatedRunTime > maxRunTime) {
                        showCatAiStatus(commentIdStr, '小猫暂时无法回复，点击重试', true);
                        retryBtnSetup(commentIdStr, postId);
                        delete window.__catAiPollTimers[commentIdStr];
                        delete window.__catAiPollControllers[commentIdStr];
                        return;
                    }
                    // Phase 3-P0-2: 捕获取消纪元，用于迟到回调防护
                    lastPollStart = Date.now();

                    var controller = new AbortController();
                    var timeoutId = setTimeout(function() { controller.abort(); }, 10000);
                    window.__catAiPollControllers[commentIdStr] = controller;

                    window.xtjProtectedFetch('/api/comments/ai-reply-status?comment_id=' + encodeURIComponent(commentIdStr), { signal: controller.signal })
                        .then(function(r) {
                            // Phase 3-P0-2: 迟到回调防护——任务已取消则跳过，避免清理后仍写入状态
                            if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                                (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) { clearTimeout(timeoutId); return null; }
                            // ★ 计入实际运行时间（仅请求耗时）
                            accumulatedRunTime += Date.now() - lastPollStart;
                            // ★ 先检查 HTTP 状态码，400 不是网络错误
                            if (!r.ok) {
                                return r.json().catch(function() { return {}; }).then(function(payload) {
                                    if (r.status === 400 && (payload.code === 'invalid_comment_id')) {
                                        console.error('[CatAI] invalid comment_id:', commentIdStr);
                                        showCatAiStatus(commentIdStr, '评论ID格式错误，请刷新页面重试', true);
                                        delete window.__catAiPollTimers[commentIdStr];
                                        delete window.__catAiPollControllers[commentIdStr];
                                        return;
                                    }
                                    throw new Error('http_error_' + r.status);
                                });
                            }
                            return r.json();
                        })
                        .then(function(data) {
                            if (!data) return;
                            // Phase 3-P0-2: 迟到回调防护——任务已取消则跳过
                            if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                                (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) { return; }
                            clearTimeout(timeoutId);
                            retryCount = 0; // 成功请求后重置重试计数
                            if (data.status === 'completed') {
                                // ★ 严格验证：必须包含完整字段，使用 String() 比较
                                var aiComment = data.data;
                                if (aiComment && aiComment.id && typeof aiComment.content === 'string' && aiComment.content.trim() && aiComment.user_name === 'cat_ai' && aiComment.generated_by_ai && String(aiComment.parent_comment_id) === commentIdStr) {
                                    removeCatAiStatus(commentIdStr);
                                    delete window.__catAiPollTimers[commentIdStr];
                                    delete window.__catAiPollControllers[commentIdStr];
                                    // 通过统一 upsert 函数插入
                                    upsertAiComment(aiComment, commentIdStr, postId);
                                } else {
                                    // 数据不完整，回退到全量刷新
                                    if (typeof loadFeed === 'function') loadFeed(true).catch(function() {});
                                    window.__catAiPollTimers[commentIdStr] = setTimeout(poll, baseInterval);
                                }
                            } else if (data.status === 'not_triggered') {
                                // ★ 前10秒内 not_triggered 视为任务尚未同步，继续轮询
                                notTriggeredCount++;
                                var commentAge = 0;
                                try { commentAge = Date.now() - new Date(data.comment_created_at).getTime(); } catch(e) {}
                                if (notTriggeredCount <= 5 && commentAge < 10000) {
                                    showCatAiStatus(commentIdStr, '小猫正在准备回复……');
                                    window.__catAiPollTimers[commentIdStr] = setTimeout(poll, 1500);
                                } else {
                                    showCatAiStatus(commentIdStr, '未能创建回复任务，点击重试', true);
                                    retryBtnSetup(commentIdStr, postId);
                                    delete window.__catAiPollTimers[commentIdStr];
                                    delete window.__catAiPollControllers[commentIdStr];
                                }
                            } else if (data.status === 'rate_limited') {
                                showCatAiStatus(commentIdStr, data.message || '小猫今天被叫得有点烦，稍后再试', true);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'failed') {
                                showCatAiStatus(commentIdStr, '小猫暂时不想说话', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'blocked') {
                                removeCatAiStatus(commentIdStr);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'reply_deleted' || data.status === 'reply_missing') {
                                // Phase 4: 回复被删除或缺失 → 显示重试按钮
                                showCatAiStatus(commentIdStr, data.message || '小猫的回复异常，点击重试', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'repair_required') {
                                // Phase 4: 需要修复 → 显示重试按钮
                                showCatAiStatus(commentIdStr, data.message || '回复记录异常，点击重试', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'processing' || data.status === 'pending') {
                                if (data.message && data.message.includes('同步')) {
                                    showCatAiStatus(commentIdStr, '回复已生成，正在同步……');
                                }
                                window.__catAiPollTimers[commentIdStr] = setTimeout(poll, baseInterval);
                            } else {
                                removeCatAiStatus(commentIdStr);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            }
                        })
                        .catch(function(err) {
                            clearTimeout(timeoutId);
                            // Phase 3-P0-2: 迟到回调防护——任务已取消则跳过，避免清理后重新调度轮询
                            if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                                (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) { return; }
                            accumulatedRunTime += Date.now() - lastPollStart;
                            // 指数退避重试，而不是永久终止
                            if (retryCount < maxRetries) {
                                retryCount++;
                                var backoff = Math.min(baseInterval * Math.pow(2, retryCount), 30000);
                                window.__catAiPollTimers[commentIdStr] = setTimeout(poll, backoff);
                            } else {
                                showCatAiStatus(commentIdStr, '小猫暂时无法回复，点击重试', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            }
                        });
                }
                window.__catAiPollTimers[commentIdStr] = setTimeout(poll, baseInterval);
            }

            // ★ 显示重试按钮
            function retryBtnSetup(commentId, postId) {
                var statusEl = document.querySelector('.cat-ai-status[data-comment-id="' + commentId + '"]');
                if (statusEl) {
                    statusEl.innerHTML = '小猫暂时无法回复 <button type="button" class="cat-ai-retry-btn" onclick="window.__xtjRetryCatAi(\'' + safeJsStr(commentId) + '\', \'' + safeJsStr(postId) + '\')">重试</button>';
                }
            }
            window.__xtjRetryCatAi = async function(commentId, postId) {
                var commentIdStr = String(commentId);
                // ★ 修复：状态元素由 showCatAiStatus 创建，类名为 cat-ai-status + data-comment-id，
                // 不存在 id="cat-ai-status-<id>" 的元素，改用 querySelector 定位。
                var statusEl = document.querySelector('.cat-ai-status[data-comment-id="' + commentIdStr + '"]');
                if (statusEl) statusEl.innerHTML = '小猫正在恢复……';
                try {
                    var resp = await window.xtjProtectedFetch('/api/comments/ai-reply-retry', {
                        method: 'POST',
                        body: JSON.stringify({ comment_id: commentIdStr })
                    });
                    var payload = await resp.json().catch(function() { return {}; });
                    if (!resp.ok) {
                        var errMsg = payload.message || payload.error || '重试失败';
                        showCatAiStatus(commentIdStr, errMsg, true);
                        return;
                    }
                    if (payload.status === 'completed') {
                        var aiComment = payload.data || payload;
                        if (aiComment && aiComment.id) {
                            upsertAiComment(aiComment, commentIdStr, postId);
                            removeCatAiStatus(commentIdStr);
                            return;
                        }
                    }
                    if (payload.status === 'rate_limited') {
                        showCatAiStatus(commentIdStr, payload.message || '调用过于频繁，请稍后再试', true);
                        return;
                    }
                    // pending/processing - 开始轮询
                    removeCatAiStatus(commentIdStr);
                    pollCatAiReply(commentIdStr, postId);
                } catch (e) {
                    console.error('[CatAI] retry failed:', e);
                    showCatAiStatus(commentIdStr, '重试失败，请检查网络后重试', true);
                }
            };

            // ★ 统一 AI 评论插入函数（polling 和 Realtime 共用）
            function upsertAiComment(aiComment, sourceCommentId, postId) {
                if (!aiComment || !aiComment.id || !aiComment.content || !aiComment.content.trim()) return;
                // Realtime and polling must accept exactly the same AI reply
                // shape; a generated comment from another post must not be
                // rendered under the current source comment.
                if (aiComment.generated_by_ai !== true || String(aiComment.user_name || '') !== 'cat_ai') return;
                var aiIdStr = String(aiComment.id);
                var srcIdStr = String(sourceCommentId);
                if (String(aiComment.parent_comment_id || '') !== srcIdStr) return;
                if (postId != null && aiComment.post_id != null && String(aiComment.post_id) !== String(postId)) return;
                // 去重：检查 feedAllComments 和 DOM
                var existingInFeed = (feedAllComments || []).some(function(item) {
                    return item && item.id != null && String(item.id) === aiIdStr;
                });
                var existingInDom = document.querySelector('.comment-item[data-comment-id="' + aiIdStr + '"]');
                if (existingInFeed && existingInDom) return; // 已存在，跳过
                // 加入 feedAllComments
                feedAllComments = (feedAllComments || []).filter(function(item) {
                    return !(item && item.id != null && String(item.id) === aiIdStr);
                });
                feedAllComments.push(aiComment);
                // Phase 3-P0-3: 修复缓存写入顺序——先插入 DOM，成功后再写缓存。
                // 原代码在 DOM 插入前写缓存，若 insertCatAiCommentIntoDOM 返回
                // source_comment_missing，AI 回复已写入缓存却不在 DOM，产生孤儿缓存。
                // 插入 DOM，返回结果
                var result = insertCatAiCommentIntoDOM(aiComment, srcIdStr, postId);
                if (!result.inserted) {
                    // ★ 插入失败：定向重渲染对应帖子
                    if (result.reason === 'source_comment_missing') {
                        try {
                            // 尝试对对应 postId 执行一次定向帖子重渲染
                            var postEl = document.querySelector('.post[data-post-id="' + String(postId) + '"]');
                            if (postEl && typeof renderPostCardSafely === 'function') {
                                // 查找该帖子的评论数据
                                var postComms = (feedAllComments || []).filter(function(c) {
                                    return String(c.post_id) === String(postId);
                                });
                                var maps = buildPostMaps([], postComms);
                                var template = document.createElement('template');
                                template.innerHTML = renderPostCardSafely({ id: postId }, maps.commentMap, maps.likeMap, maps.likeUserMap);
                                var newPost = template.content.firstElementChild;
                                if (newPost && postEl.parentNode) {
                                    postEl.parentNode.replaceChild(newPost, postEl);
                                }
                            }
                            // 重渲染后再次确认
                            var confirmExisting = document.querySelector('.comment-item[data-comment-id="' + aiIdStr + '"]');
                            if (!confirmExisting) {
                                console.warn('[CatAI] upsert retry failed for comment:', aiIdStr);
                            }
                        } catch (e) {
                            console.warn('[CatAI] upsert re-render failed:', e);
                        }
                        // Phase 3-P0-3: source_comment_missing 时不写入缓存，避免孤儿缓存
                    }
                } else {
                    // Phase 3-P0-3: DOM 插入成功后再写缓存，保证缓存与 DOM 一致
                    try { writeFeedCacheSnapshot(); } catch(e) {}
                }
                // 同步评论数量
                if (typeof syncPostCommentCount === 'function') syncPostCommentCount(postId);
                // 更新个人活动
                if (typeof renderProfileActivity === 'function') renderProfileActivity();
            }

            // ★ 直接将 AI 回复插入 DOM（正确层级：源评论的 .comment-replies 容器内）
            function insertCatAiCommentIntoDOM(aiComment, sourceCommentId, postId) {
                if (!aiComment || !aiComment.id) return { inserted: false, reason: 'invalid_data' };
                var aiIdStr = String(aiComment.id);
                var srcIdStr = String(sourceCommentId);
                var sourceEl = document.querySelector('.comment-item[data-comment-id="' + srcIdStr + '"]');
                if (!sourceEl) return { inserted: false, reason: 'source_comment_missing' };
                // 移除旧状态
                removeCatAiStatus(srcIdStr);
                // 检查是否已存在
                var existing = document.querySelector('.comment-item[data-comment-id="' + aiIdStr + '"]');
                if (existing) return { inserted: false, reason: 'already_exists' };
                // ★ 查找或创建 .comment-replies 容器
                var repliesContainer = sourceEl.querySelector('.comment-replies');
                if (!repliesContainer) {
                    repliesContainer = document.createElement('div');
                    repliesContainer.className = 'comment-replies';
                    sourceEl.appendChild(repliesContainer);
                }
                // 创建 AI 评论 DOM（与 renderCatAiComment 渲染结构一致）
                var aiEl = document.createElement('div');
                aiEl.className = 'comment-item cat-ai-comment';
                aiEl.setAttribute('data-comment-id', aiIdStr);
                aiEl.setAttribute('data-parent-comment-id', srcIdStr);
                var timeStr = (typeof formatRelativeTime === 'function' ? formatRelativeTime(aiComment.created_at) : (aiComment.created_at || '刚刚'));
                var delBtn = isAdmin() ? '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(aiIdStr) + '\', this)">删除</button>' : '';
                aiEl.innerHTML = '<div class="comment-item-inner">' +
                    '<span class="cat-ai-avatar" aria-label="小猫">🐱</span>' +
                    '<div class="comment-item-body">' +
                    '<div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">' + escapeHtml(timeStr) + '</span>' + delBtn + '</div>' +
                    '<div class="comment-item-content">' + escapeHtml(aiComment.content || '') + '</div>' +
                    '</div></div>';
                // ★ 追加到 .comment-replies 容器内，而非源评论的兄弟节点
                repliesContainer.appendChild(aiEl);
                return { inserted: true, reason: 'ok' };
            }

            function showCatAiStatus(commentId, message, fadeOut) {
                // Phase 3-P0-4: 当状态包含"重试"文字时不自动 fadeOut。
                // retryBtnSetup 会在该元素内插入重试按钮，原逻辑 3 秒后移除整个元素导致
                // 重试按钮不可用。包含"重试"时保持元素常驻，直到用户操作或新状态覆盖。
                if (fadeOut && typeof message === 'string' && message.indexOf('重试') !== -1) {
                    fadeOut = false;
                }
                // Phase 3-P0-5: retryable 状态持久化到 localStorage，避免评论重渲染后丢失。
                // 仅对带"重试"的状态持久化（真正的 retryable 状态）。
                if (typeof message === 'string' && message.indexOf('重试') !== -1) {
                    try {
                        var postId = (window.__catAiPollStatus && window.__catAiPollStatus[String(commentId)])
                            ? window.__catAiPollStatus[String(commentId)].postId : null;
                        var retryableEntry = { message: message, postId: postId, ts: Date.now() };
                        localStorage.setItem('xtj_cat_ai_retryable_' + String(commentId), JSON.stringify(retryableEntry));
                    } catch(e) {}
                }
                var existing = document.querySelector('.cat-ai-status[data-comment-id="' + commentId + '"]');
                if (existing) {
                    existing.textContent = message;
                    if (fadeOut) {
                        existing.classList.add('cat-ai-fade-out');
                        setTimeout(function() { if (existing.parentNode) existing.parentNode.removeChild(existing); }, 3000);
                    }
                    return;
                }
                var commentEl = document.querySelector('.comment-item[data-comment-id="' + commentId + '"]');
                if (!commentEl) return;
                var statusEl = document.createElement('div');
                statusEl.className = 'cat-ai-status';
                statusEl.setAttribute('data-comment-id', commentId);
                statusEl.textContent = message;
                statusEl.style.cssText = 'font-size:12px;color:var(--text-muted);padding:4px 0 4px 8px;font-style:italic;margin-left:36px;animation:catAiPulse 1.5s ease-in-out infinite;';
                if (fadeOut) {
                    statusEl.classList.add('cat-ai-fade-out');
                    setTimeout(function() { if (statusEl.parentNode) statusEl.parentNode.removeChild(statusEl); }, 3000);
                }
                commentEl.parentNode.insertBefore(statusEl, commentEl.nextSibling);
            }

            function removeCatAiStatus(commentId) {
                var el = document.querySelector('.cat-ai-status[data-comment-id="' + commentId + '"]');
                if (el && el.parentNode) el.parentNode.removeChild(el);
                // Phase 3-P0-5: 状态被显式移除（completed/blocked）时也清除 retryable 缓存。
                try { localStorage.removeItem('xtj_cat_ai_retryable_' + String(commentId)); } catch(e) {}
            }

            // Phase 3-P0-5: 恢复持久化的 retryable 状态。
            // 在评论重新渲染后调用，遍历 DOM 中的评论项，对仍有持久化 retryable 状态的
            // 评论重新显示重试按钮。超过 1 小时的 retryable 状态视为过期并清除。
            function restoreCatAiRetryableStatuses() {
                var toRestore = [];
                var now = Date.now();
                var keysToRemove = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (!key || key.indexOf('xtj_cat_ai_retryable_') !== 0) continue;
                    var commentId = key.substring('xtj_cat_ai_retryable_'.length);
                    try {
                        var entry = JSON.parse(localStorage.getItem(key) || '{}');
                        if (!entry.ts || (now - entry.ts) > 60 * 60 * 1000) {
                            keysToRemove.push(key);
                            continue;
                        }
                        toRestore.push({ commentId: commentId, message: entry.message, postId: entry.postId });
                    } catch(e) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(function(k) { try { localStorage.removeItem(k); } catch(e) {} });
                toRestore.forEach(function(item) {
                    var commentEl = document.querySelector('.comment-item[data-comment-id="' + item.commentId + '"]');
                    if (!commentEl) return;
                    var existingStatus = document.querySelector('.cat-ai-status[data-comment-id="' + item.commentId + '"]');
                    if (existingStatus) return; // 状态已存在，不重复
                    // 重新显示 retryable 状态和重试按钮
                    var statusEl = document.createElement('div');
                    statusEl.className = 'cat-ai-status';
                    statusEl.setAttribute('data-comment-id', item.commentId);
                    statusEl.textContent = item.message || '小猫暂时无法回复，点击重试';
                    statusEl.style.cssText = 'font-size:12px;color:var(--text-muted);padding:4px 0 4px 8px;font-style:italic;margin-left:36px;';
                    commentEl.parentNode.insertBefore(statusEl, commentEl.nextSibling);
                    if (item.postId) {
                        retryBtnSetup(item.commentId, item.postId);
                    }
                });
            }
            window.__xtjRestoreCatAiRetryable = restoreCatAiRetryableStatuses;

            // ===================== 小猫 AI 评论渲染 =====================
            function renderCatAiComment(comment) {
                if (!comment || comment.user_name !== 'cat_ai' || !comment.generated_by_ai) return '';
                var avatarHtml = '<span class="cat-ai-avatar" aria-label="小猫">🐱</span>';
                var badgeHtml = '<span class="cat-ai-badge">AI</span>';
                var timeStr = (typeof formatRelativeTime === 'function' ? formatRelativeTime(comment.created_at) : (comment.created_at || '刚刚'));
                var delBtn = isAdmin() ? '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(comment.id) + '\', this)">删除</button>' : '';
                return '<div class="comment-item cat-ai-comment" data-comment-id="' + escapeHtml(comment.id) + '" data-parent-comment-id="' + escapeHtml(comment.parent_comment_id || '') + '"><div class="comment-item-inner">' + avatarHtml + '<div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b>' + badgeHtml + '<span class="comment-item-time">' + escapeHtml(timeStr) + '</span>' + delBtn + '</div><div class="comment-item-content">' + escapeHtml(comment.content || '') + '</div></div></div></div>';
            }

            var __xtjDeferredWarmupQueued = false;
            function queueDeferredStartupTasks() {
                if (!currentUser || __xtjDeferredWarmupQueued) return;
                __xtjDeferredWarmupQueued = true;
                setTimeout(function() {
                    Promise.resolve().then(function() { return saveUserInfo(currentUser, false); }).catch(function() {});
                    try { loadDockChatList(); } catch(_) {}
                    try { updateUnreadBadge(); } catch(_) {}
                    try { loadAnnouncements(); } catch(_) {}
                    try { startRestrictionPolling(); } catch(_) {}
                    try { subscribeToMessages(); } catch(_) {}
                    try { subscribeToComments(); } catch(_) {}
                    try { startDMPolling(); } catch(_) {}
                    try { subscribeToAnnouncements(); } catch(_) {}
                    try { startReportReplyPolling(); } catch(_) {}
                }, 90);
            }

            async function initUI() {
                var unauthUI = document.getElementById("unauthUI");
                var authUI = document.getElementById("authUI");
                var annBtnWrapper = document.getElementById("announcement-btn-wrapper");
                var reportBtnWrapper = document.getElementById("report-btn-wrapper");
                var profileName = document.getElementById("profileName");
                var profileStatus = document.getElementById("profileStatus");
                var publishBox = document.getElementById("publishBox");

                // 缺失关键元素时不崩溃：仅做必要的登录态兜底
                if (!unauthUI || !authUI || !annBtnWrapper) {
                    if (currentUser) {
                        queueDeferredStartupTasks();
                    } else {
                        __xtjDeferredWarmupQueued = false;
                        stopRestrictionPolling();
                        hideBlockedScreen();
                        hideMuteIndicator();
                    }
                    return;
                }
                
                if (currentUser) {
                    unauthUI.style.display = "none";
                    authUI.style.display = "flex";
                    annBtnWrapper.style.display = "block";
                    if (reportBtnWrapper) reportBtnWrapper.style.display = "block";
                    if (typeof window.bindHeaderActionButtons === 'function') window.bindHeaderActionButtons();
                    document.getElementById("myName").textContent = currentUser;
                    var avatar = document.getElementById("myAvatar");
                    avatar.textContent = currentUser[0].toUpperCase();
                    avatar.className = "avatar";
                    
                    // 更新我的页面显示
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "查看资料";
                    
                    // 显示发布框
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 加载头像
                    loadUserAvatar();
                    loadProfileActivity(true);
                    
                    queueDeferredStartupTasks();
                } else {
                    __xtjDeferredWarmupQueued = false;
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    stopRestrictionPolling();
                    hideBlockedScreen();
                    hideMuteIndicator();
                    
                    // 更新"我的"页面显示（未登录状态）
                    profileName.textContent = "未登录";
                    profileStatus.textContent = "点击登录";
                    
                    // 隐藏发布区域
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 更新头像显示
                    var profileAvatar = document.getElementById('profileAvatar');
                    if (profileAvatar) {
                        profileAvatar.innerHTML = '?';
                    }
                    loadProfileActivity(true);
                    
                    try { stopDMPolling(); } catch(e) {}
                }
            }

            async function loadUserAvatar() {
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[currentUser] && cachedAvatars[currentUser].url) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        updateAllAvatarElements(cachedAvatars[currentUser].url);
                    } else {
                        // localStorage 无缓存：远程获取头像
                        var avatarUrl = await fetchAvatarUrl(currentUser);
                        if (avatarUrl) {
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                            try {
                                cachedAvatars[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                                writeAvatarCacheToStorage(cachedAvatars);
                            } catch(e) {}
                            updateAllAvatarElements(avatarUrl);
                        } else {
                            var profileAvatar = document.getElementById('profileAvatar');
                            var myAvatar = document.getElementById('myAvatar');
                            if (profileAvatar) profileAvatar.innerHTML = currentUser ? currentUser[0].toUpperCase() : '?';
                            if (myAvatar) myAvatar.innerHTML = currentUser ? currentUser[0].toUpperCase() : '?';
                        }
                    }
                } catch(e) {
                    console.error("加载头像失败:", e);
                }
            }

