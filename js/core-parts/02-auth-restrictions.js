/**
 * core-parts/02-auth-restrictions.js
 * Auth markers, restrictions, admin login helpers
 * Lines from original core.js: 2307-2849
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            // ===================== 认证标记 =====================
            const AUTH_MARKER = '__auth__';
            const ADMIN_AUTH_MARKER = '__admin_auth__';
            const ADMIN_META_MARKER = '__admin_meta__';
            const DM_MARKER = '__dm__';
            const REPORT_MARKER = '__report__';

            // ===================== 用户限制状态管理 =====================
            var userRestrictions = { is_banned: false, is_blacklisted: false, is_muted: false };
            var restrictionPollTimer = null;
            var RESTRICTION_POLL_INTERVAL = 60000; // 60秒轮询（15秒太频繁）

            async function checkUserRestrictions() {
                if (!currentUser || currentUser === ADMIN_NAME) return;
                try {
                    if (typeof API_BASE !== 'string' || !API_BASE) return;
                    var authHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                    var response = await fetch(API_BASE.replace(/\/$/, '') + '/api/user/restrictions', {
                        method: 'GET', credentials: 'include', headers: authHeaders || {}
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) return;
                    var prev = JSON.stringify(userRestrictions);
                    var data = result.restrictions;
                    userRestrictions = data && !Array.isArray(data) ? data : { is_banned: false, is_blacklisted: false, is_muted: false };
                    if (JSON.stringify(userRestrictions) !== prev) {
                        applyRestrictions();
                    }
                } catch(e) { }
            }

            function applyRestrictions() {
                if (userRestrictions.is_blacklisted || userRestrictions.is_banned) {
                    showBlockedScreen();
                } else {
                    hideBlockedScreen();
                }
                if (userRestrictions.is_muted) {
                    showMuteIndicator();
                } else {
                    hideMuteIndicator();
                }
            }

            function showBlockedScreen() {
                var existing = document.getElementById('blockedOverlay');
                if (existing) {
                    existing.style.display = 'flex';
                    return;
                }
                var overlay = document.createElement('div');
                overlay.id = 'blockedOverlay';
                overlay.innerHTML = '<div style="text-align:center;max-width:400px;padding:40px 24px;background:rgba(255,255,255,0.95);border-radius:20px;box-shadow:0 16px 48px rgba(0,0,0,0.2);">' +
                    '<div style="font-size:48px;margin-bottom:16px;">🚫</div>' +
                    '<h2 style="font-size:20px;margin-bottom:8px;color:#1d1d24;">账号已被限制访问</h2>' +
                    '<p style="font-size:14px;color:#6b6c7a;line-height:1.6;margin-bottom:20px;">' +
                    (userRestrictions.is_blacklisted ? '您的账号已被管理员加入黑名单，暂时无法访问本站。' : '') +
                    (userRestrictions.is_banned ? '您的账号已被管理员封禁，暂时无法访问本站。' : '') +
                    '</p><p style="font-size:12px;color:#999;">如有疑问，请联系管理员</p></div>';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);';
                document.body.appendChild(overlay);
                document.body.style.overflow = 'hidden';
            }

            function hideBlockedScreen() {
                var overlay = document.getElementById('blockedOverlay');
                if (overlay) overlay.style.display = 'none';
                document.body.style.overflow = '';
            }

            function showMuteIndicator() {
                var existing = document.getElementById('muteIndicator');
                if (existing) return;
                var bar = document.createElement('div');
                bar.id = 'muteIndicator';
                bar.innerHTML = '<span style="font-size:14px;">🤐 您已被禁言，无法发布内容、评论、点赞或发送消息</span>';
                bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;text-align:center;padding:10px 16px;font-size:13px;font-weight:500;';
                document.body.insertBefore(bar, document.body.firstChild);
                var pubBox = document.getElementById('publishBox');
                if (pubBox) pubBox.style.opacity = '0.4';
                if (pubBox) pubBox.style.pointerEvents = 'none';
            }

            function hideMuteIndicator() {
                var bar = document.getElementById('muteIndicator');
                if (bar) bar.remove();
                var pubBox = document.getElementById('publishBox');
                if (pubBox) { pubBox.style.opacity = ''; pubBox.style.pointerEvents = ''; }
            }

            function isUserMuted() {
                return userRestrictions.is_muted && (currentUser || window.currentUser) !== ADMIN_NAME;
            }

            function isUserBlocked() {
                return (userRestrictions.is_blacklisted || userRestrictions.is_banned) && (currentUser || window.currentUser) !== ADMIN_NAME;
            }

            function startRestrictionPolling() {
                stopRestrictionPolling();
                checkUserRestrictions();
                restrictionPollTimer = setInterval(function() {
                    checkUserRestrictions();
                }, RESTRICTION_POLL_INTERVAL);
            }

            function stopRestrictionPolling() {
                if (restrictionPollTimer) { clearInterval(restrictionPollTimer); restrictionPollTimer = null; }
            }

            window.currentUserInfoSnapshot = window.currentUserInfoSnapshot || null;

            function normalizeUserInfoSnapshot(info) {
                if (!info || typeof info !== 'object') return null;
                var lastIpLocation = info.last_ip_location || null;
                if (lastIpLocation && typeof lastIpLocation === 'object' && !Array.isArray(lastIpLocation)) {
                    lastIpLocation = {
                        province: String(lastIpLocation.province || lastIpLocation.region || '').trim(),
                        city: String(lastIpLocation.city || '').trim(),
                        text: String(lastIpLocation.text || lastIpLocation.label || '').trim()
                    };
                    if (!lastIpLocation.text) {
                        lastIpLocation.text = [lastIpLocation.province, lastIpLocation.city].filter(Boolean).join(' ').trim();
                    }
                } else if (typeof lastIpLocation === 'string') {
                    lastIpLocation = lastIpLocation.trim();
                } else {
                    lastIpLocation = null;
                }
                return {
                    reg_time: info.reg_time || null,
                    last_login: info.last_login || null,
                    last_ip: info.last_ip || null,
                    last_ip_location: lastIpLocation,
                    email: info.email || ''
                };
            }

            async function loadCurrentUserInfoSnapshot(userName) {
                var name = String(userName || currentUser || "").trim();
                if (!name || !sb) return null;
                try {
                    var userInfoRes = await sb.from("posts")
                        .select("content")
                        .eq("user_name", name)
                        .eq("media_type", "__user_info__")
                        .order("created_at", { ascending: false })
                        .limit(1);
                    if (userInfoRes.data && userInfoRes.data.length > 0) {
                        try {
                            var info = JSON.parse(userInfoRes.data[0].content || '{}');
                            var snapshot = normalizeUserInfoSnapshot(info);
                            if (snapshot) {
                                window.currentUserInfoSnapshot = snapshot;
                                return snapshot;
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
                return null;
            }

            async function saveUserInfo(name, isNewUser, email) {
                // ★ 隐私/防伪守卫：仅允许写入"当前登录用户"或"登录流程中的规范用户"的
                //   __user_info__ 行，禁止经控制台伪造他人注册信息（RLS 侧亦应强制归属）。
                var actingUser = String(window.currentUser || '').trim() || String(window._xtjCanonicalUser || '').trim();
                if (!name || !actingUser || String(name).trim() !== actingUser) {
                    console.warn('[saveUserInfo] blocked write for non-self or unauthenticated user:', name);
                    return;
                }
                try {
                    var regTime = null;

                    // 优先从已有的 __user_info__ 记录读取 reg_time（已正确设置的注册时间最可靠）
                    try {
                        var existing = await sb.from("posts")
                            .select("content, id")
                            .eq("user_name", name)
                            .eq("media_type", "__user_info__")
                            .order("created_at", { ascending: false })
                            .limit(1);
                        if (existing.data && existing.data.length > 0) {
                            try { var parsed = JSON.parse(existing.data[0].content); if (parsed.reg_time) regTime = parsed.reg_time; } catch(e) {}
                        }
                    } catch(e) {}

                    // 如果 __user_info__ 没有 reg_time，从 __auth__ 记录获取（仅作为后备）
                    if (!regTime) {
                        try {
                            var authRes = await sb.from("posts")
                                .select("created_at")
                                .eq("user_name", name)
                                .eq("media_type", AUTH_MARKER)
                                .order("created_at", { ascending: true })
                                .limit(1);
                            if (authRes.data && authRes.data.length > 0 && authRes.data[0].created_at) {
                                regTime = authRes.data[0].created_at;
                            }
                        } catch(e) {}
                    }

                    // 仍然没有且是新用户，使用当前时间
                    if (!regTime && isNewUser) {
                        regTime = new Date().toISOString();
                    }

                    var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
                    if (email) userInfo.email = email;
                    var contentStr = JSON.stringify(userInfo);

                    // 尝试 UPDATE 已有记录（保留旧 reg_time，只更新 last_login）
                    var updated = false;
                    try {
                        var latest = await sb.from("posts")
                            .select("id, content")
                            .eq("user_name", name)
                            .eq("media_type", "__user_info__")
                            .order("created_at", { ascending: false })
                            .limit(1);
                        if (latest.data && latest.data.length > 0) {
                            var oldContent = latest.data[0].content;
                            var merged = { last_login: new Date().toISOString() };
                            try {
                                var oldParsed = JSON.parse(oldContent);
                                if (oldParsed.reg_time) merged.reg_time = oldParsed.reg_time;
                                if (oldParsed.email) merged.email = oldParsed.email;
                                if (oldParsed.last_ip_location) merged.last_ip_location = oldParsed.last_ip_location;
                                if (oldParsed.last_ip) merged.last_ip = oldParsed.last_ip;
                                if (oldParsed.last_location) merged.last_location = oldParsed.last_location;
                                if (oldParsed.last_precise_location) merged.last_precise_location = oldParsed.last_precise_location;
                                if (oldParsed.precise_location_history) merged.precise_location_history = oldParsed.precise_location_history;
                                if (oldParsed.last_device) merged.last_device = oldParsed.last_device;
                                if (oldParsed.last_device_id) merged.last_device_id = oldParsed.last_device_id;
                                if (oldParsed.last_visit) merged.last_visit = oldParsed.last_visit;
                            } catch(e) {}
                            if (email) merged.email = email;
                            var updRes = await sb.from("posts")
                                .update({ content: JSON.stringify(merged) })
                                .eq("id", latest.data[0].id);
                            if (!updRes.error) {
                                updated = true;
                            }
                        }
                    } catch(e) {}

                    // UPDATE 失败或无记录时，INSERT 新记录
                    if (!updated) {
                        var insertRes = await sb.from("posts").insert([{
                            user_name: name,
                            content: contentStr,
                            media_type: "__user_info__",
                            actor_key: "__user_info__"
                        }]);
                        if (insertRes.error) {
                            // silently ignore
                        } else {
                            // login info saved
                        }
                    }
                    try {
                        var snapshotSource = {};
                        try { snapshotSource = JSON.parse(contentStr); } catch (snapshotParseErr) {}
                        if (window.currentUserInfoSnapshot && window.currentUserInfoSnapshot.last_ip_location && !snapshotSource.last_ip_location) {
                            snapshotSource.last_ip_location = window.currentUserInfoSnapshot.last_ip_location;
                        }
                        if (window.currentUserInfoSnapshot && window.currentUserInfoSnapshot.last_ip && !snapshotSource.last_ip) {
                            snapshotSource.last_ip = window.currentUserInfoSnapshot.last_ip;
                        }
                        window.currentUserInfoSnapshot = normalizeUserInfoSnapshot(snapshotSource);
                    } catch (snapshotErr) {}
                } catch(e) {
                    try { console.warn('[saveUserInfo] failed:', e && e.message); } catch(_) {}
                }
            }

            var authModalFocusOrigin = null;
            window.openAuthModal = function (mode) {
                const id = mode === 'login' ? 'loginModal' : 'registerModal';
                const modal = document.getElementById(id);
                if (!modal) return;
                authModalFocusOrigin = document.activeElement;
                modal.setAttribute('aria-hidden', 'false');
                modal.classList.add('active');
                setTimeout(() => {
                    const nickInp = document.getElementById(mode === 'login' ? 'loginNickInp' : 'regNickInp');
                    if (nickInp) nickInp.focus();
                }, 200);
            };

            document.addEventListener('keydown', function (event) {
                if (event.key === 'Tab') {
                    var activeAuth = ['loginModal', 'registerModal'].map(function (id) { return document.getElementById(id); }).find(function (modal) {
                        return modal && modal.classList.contains('active');
                    });
                    if (activeAuth) {
                        var focusables = Array.prototype.slice.call(activeAuth.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')).filter(function (node) {
                            return !node.disabled && node.offsetParent !== null;
                        });
                        if (focusables.length) {
                            var first = focusables[0], last = focusables[focusables.length - 1];
                            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                        }
                    }
                    return;
                }
                if (event.key !== 'Escape') return;
                ['loginModal', 'registerModal'].some(function (id) {
                    var modal = document.getElementById(id);
                    if (modal && modal.classList.contains('active')) {
                        window.closeModal(id);
                        return true;
                    }
                    return false;
                });
            });
            var btn = document.getElementById('loginSubmitBtn');
            if (btn) btn.addEventListener('click', doLogin);
            var pwInp = document.getElementById('loginPwInp');
            if (pwInp) pwInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
            var nickInp = document.getElementById('loginNickInp');
            if (nickInp) nickInp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && pwInp) pwInp.focus(); });

            // API 请求辅助函数（用于管理员登录等需要后端 API 的场景）
            async function apiCall(method, path, body) {
                if (!API_BASE) {
                    throw new Error('API_BASE 未配置');
                }
                var opts = {
                    method: method,
                    headers: { 'Content-Type': 'application/json' }
                };
                if (body) opts.body = JSON.stringify(body);
                var res = await fetch(API_BASE + path, opts);
                var contentType = res.headers.get('content-type') || '';
                var data;
                if (contentType.indexOf('application/json') !== -1) {
                    data = await res.json().catch(function() { return {}; });
                } else {
                    var text = await res.text().catch(function() { return ''; });
                    if (!res.ok) throw new Error('请求失败 (' + res.status + '): ' + text.substring(0, 50));
                    data = {};
                }
                if (!res.ok) {
                    var errMsg = (data && data.error) || ('请求失败 (' + res.status + ')');
                    throw new Error(errMsg);
                }
                return data;
            }

            async function doLogin() {
                const name = document.getElementById("loginNickInp").value.trim();
                const pw = document.getElementById("loginPwInp").value;
                if (!name) { showToast("请输入昵称"); return; }
                if (!pw) { showToast("请输入密码"); return; }

                const btn = document.getElementById("loginSubmitBtn");
                btn.disabled = true;
                btn.textContent = "验证中..";

                try {
                    if (name === ADMIN_NAME) {
                        // 安全：管理员登录必须通过后端 API，禁止直连 Supabase
                        if (typeof API_BASE === 'undefined' || !API_BASE) {
                            showToast("管理员登录需要后端 API 服务，请确保服务器已配置");
                            return;
                        }
                        try {
                            var loginRes = await apiCall('POST', '/admin/login', {
                                username: name,
                                password: pw
                            });
                            if (!loginRes || !loginRes.ok) {
                                showToast((loginRes && loginRes.error) || "管理员登录失败");
                                return;
                            }
                            if (!loginRes.user_token) {
                                showToast("管理员用户会话建立失败", "error");
                                return;
                            }
                            setUserToken(loginRes.user_token);
                        } catch (apiErr) {
                            showToast("管理员登录失败: 无法连接后端 API");
                            return;
                        }
                    }

                    if (name !== ADMIN_NAME) {
                        var tokenRes = await fetch(API_BASE + '/api/user/login', {
                            method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ user_name: name, password: pw })
                        });
                        var tokenData = await tokenRes.json().catch(function(){ return {}; });
                        if (!tokenRes.ok || !tokenData.token) {
                            showToast(tokenData.error || "账号或密码错误", "error");
                            return;
                        }
                        setUserToken(tokenData.token);
                        // ★ 使用服务端返回的规范 user_name，禁止使用输入框 name
                        var serverUserName = (tokenData.user_name || '').trim();
                        if (!serverUserName || serverUserName !== name) {
                            // Token 身份与登录目标不一致，拒绝登录
                            clearAllAuthState({ revokeRemote: true });
                            showToast("账号认证状态异常，请重新登录", "error");
                            return;
                        }
                    }

                    // ★ 使用服务端确认的规范身份
                    var confirmedUser = (name === ADMIN_NAME) ? name : (tokenData && tokenData.user_name ? tokenData.user_name.trim() : name);
                    currentUser = confirmedUser;
                    window.currentUser = currentUser;
                    window._lastKnownUser = currentUser;
                    window.safeStorage.set("xtj_user", currentUser);
                    writeUserSession(currentUser, { resetLoginAt: true });
                    // ★ 审计修复：登录成功必须置位认证状态，否则 touchUserSession/_xtjAuthState 仍停留
                    //   在 auth_pending/unauthenticated，导致会话续写失效、长会话可能被 30 天 TTL 误登出
                    window._xtjAuthState = 'authenticated';
                    window._xtjCanonicalUser = confirmedUser;
                    await loadCurrentUserInfoSnapshot(currentUser);
                    try {
                        if (typeof window.logLoginEventSafe === "function" && confirmedUser !== ADMIN_NAME) {
                            window.logLoginEventSafe(confirmedUser);
                        }
                    } catch(e) {}
                    showToast("登录成功，欢迎回来！" + confirmedUser);
                    closeModal('loginModal');

                    // ★ 广播登录事件到其他标签页
                    try { if (typeof window.__xtjBroadcastAuthChange === 'function') window.__xtjBroadcastAuthChange(confirmedUser); } catch(e) {}

                    // 后台异步加载数据，不阻塞 UI
                    saveUserInfo(confirmedUser, false).catch(function() {});
                    initUI().catch(function() {});
                    initialLoad(true).catch(function() {});
                    // 记录用户访问
                    logUserVisitToApi(confirmedUser);

                    // 记录用户行为
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('login', '用户 [' + confirmedUser + '] 登录成功'); } catch(e) {}

                    // 公告已读：异步执行
                    try {
                        if (typeof window.loadRemoteAnnouncementReads === 'function') {
                            window.loadRemoteAnnouncementReads().then(function() {
                                if (typeof window.updateAnnouncementBadge === 'function') {
                                    window.updateAnnouncementBadge();
                                }
                            }).catch(function() {});
                        }
                    } catch (e) { console.warn('[ann_read_sync_login]', e); }
                } catch (e) {
                    showToast("登录失败，请重试");
                } finally {
                    // 统一恢复按钮状态：与 doRegister 的 finally 模式一致，避免散落恢复点
                    btn.disabled = false;
                    btn.textContent = "登录";
                }
            }
            window.doLogin = doLogin;

            var _regSubmitBtn = document.getElementById('registerSubmitBtn');
            var _regPwInp = document.getElementById('regPwInp');
            var _regNickInp = document.getElementById('regNickInp');
            var _regEmailInp = document.getElementById('regEmailInp');
            // 判空保护：任一注册表单元素缺失不得中断 core.js 后续全部逻辑
            if (_regSubmitBtn) _regSubmitBtn.addEventListener('click', doRegister);
            if (_regPwInp) _regPwInp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') doRegister();
            });
            if (_regNickInp) _regNickInp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { var _email = document.getElementById('regEmailInp'); if (_email) _email.focus(); }
            });
            if (_regEmailInp) _regEmailInp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { var _pw = document.getElementById('regPwInp'); if (_pw) _pw.focus(); }
            });
            async function doRegister() {
                const name = document.getElementById("regNickInp").value.trim();
                const pw = document.getElementById("regPwInp").value;
                const email = document.getElementById("regEmailInp").value.trim();
                if (!name) { showToast("请输入昵称"); return; }
                if (name.length < 2 || name.length > 20) { showToast("昵称长度2-20个字符"); return; }
                if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(name)) { showToast("昵称仅支持中英文、数字和下划线"); return; }
                if (!pw) { showToast("请输入密码"); return; }
                if (pw.length < 6) { showToast("密码至少6位"); return; }
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast("邮箱格式不正确"); return; }

                const btn = document.getElementById("registerSubmitBtn");
                btn.disabled = true;
                btn.textContent = "注册中..";

                try {
                    var registerRes = await fetch(API_BASE + '/api/user/register', {
                        method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ user_name: name, password: pw, email: email || undefined })
                    });
                    var registerData = await registerRes.json().catch(function(){ return {}; });
                    if (!registerRes.ok || !registerData.token) {
                        showToast(registerData.error || "注册失败，请重试", "error");
                        return;
                    }
                    setUserToken(registerData.token);
                    // ★ 使用服务端返回的规范 user_name，禁止使用输入框 name
                    var serverUserName = (registerData.user_name || '').trim();
                    if (!serverUserName || serverUserName !== name) {
                        clearAllAuthState({ revokeRemote: true });
                        showToast("账号认证状态异常，请重新注册", "error");
                        return;
                    }
                    currentUser = serverUserName;
                    window.currentUser = currentUser;
                    window._lastKnownUser = currentUser;
                    window.safeStorage.set("xtj_user", currentUser);
                    writeUserSession(currentUser, { resetLoginAt: true });
                    // ★ 审计修复：注册成功同样置位认证状态（与登录路径对称）
                    window._xtjAuthState = 'authenticated';
                    window._xtjCanonicalUser = currentUser;
                    try {
                        if (typeof window.logLoginEventSafe === "function") {
                            window.logLoginEventSafe(currentUser, "register_success");
                        }
                    } catch(e) {}
                    showToast("注册成功，欢迎你！" + currentUser);
                    closeModal('registerModal');

                    // ★ 广播注册事件到其他标签页
                    try { if (typeof window.__xtjBroadcastAuthChange === 'function') window.__xtjBroadcastAuthChange(currentUser); } catch(e) {}

                    // 后台数据加载
                    await saveUserInfo(currentUser, true, email);
                    await loadCurrentUserInfoSnapshot(currentUser);

                    await initUI();
                    initialLoad(true).catch(function() {});
                    // 记录用户访问
                    logUserVisitToApi(currentUser);

                    // 记录用户行为
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('register', '用户 [' + currentUser + '] 注册成功'); } catch(e) {}

                    // 公告已读：拉取远端已读记录，跨设备同步红点
                    try {
                        if (typeof window.loadRemoteAnnouncementReads === 'function') {
                            await window.loadRemoteAnnouncementReads();
                            if (typeof window.updateAnnouncementBadge === 'function') {
                                window.updateAnnouncementBadge();
                            }
                        }
                    } catch (e) { console.warn('[ann_read_sync_register]', e); }
                } catch (e) {
                    showToast("注册失败，请重试");
                } finally {
                    btn.disabled = false;
                    btn.textContent = "注册";
                }
            }

