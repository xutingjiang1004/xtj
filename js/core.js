(function () {
            const SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
            const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";
            if (typeof window.supabase === 'undefined') {
                var feedEl = document.getElementById('feed');
                if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">服务加载失败，请刷新页面重试</div>';
                return;
            }
            const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.sb = sb;

window.safeLocalStorageGetJSON = function(key, fallback) {
    try {
        var v = localStorage.getItem(key);
        if (v === null) return fallback;
        return JSON.parse(v);
    } catch(e) {
        localStorage.removeItem(key);
        return fallback;
    }
};

            const ADMIN_NAME = "xxz";
            const AVATAR_CACHE_KEY = "xtj_avatars";

        let currentUser;
        try { currentUser = localStorage.getItem("xtj_user") || ""; } catch(e) { currentUser = ""; }
        window.currentUser = currentUser;
        let dockChatListCacheTime = 0;
        const DOCK_CHAT_CACHE_DURATION = 120000;
        let deviceId;
        try { deviceId = localStorage.getItem("xtj_device_id"); } catch(e) { deviceId = null; }
        if (!deviceId) {
            try { deviceId = crypto.randomUUID(); } catch(e) { deviceId = 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }
            localStorage.setItem("xtj_device_id", deviceId);
        }

        let delPostId = null, delOwnerKey = null;
        let activePostId = null;
        
        var _openReportOrigStub = function(targetType, targetId, targetUser) {
            if (window.openReport !== _openReportOrigStub) {
                window.openReport(targetType, targetId, targetUser);
            } else {
                setTimeout(function() { _openReportOrigStub(targetType, targetId, targetUser); }, 200);
            }
        };
        if (!window.openReport) window.openReport = _openReportOrigStub;
        const viewTracked = new Set();
        let postVisibilityObserver = null;
        function getPostVisibilityObserver() {
            if (!postVisibilityObserver) {
                postVisibilityObserver = new IntersectionObserver(e => {
                    e.forEach(i => {
                        if (i.isIntersecting) {
                            i.target.classList.add('visible');
                        }
                    });
                }, { threshold: 0.05 });
            }
            return postVisibilityObserver;
        }
        const CACHE_KEY = "xtj_feed_cache";
        const CACHE_DURATION = 5 * 60 * 1000; // 缓存5分钟

        function isAdmin() { return currentUser === ADMIN_NAME; }

        // ========== 状态管理命名空间（向后兼容） ==========
        window.appState = {
            get currentUser() { return window.currentUser; },
            set currentUser(v) { window.currentUser = v; },
            get photoWallData() { return photoWallData; },
            set photoWallData(v) { photoWallData = v; },
            get deviceId() { return window.deviceId; },
            _listeners: {}
        };
        function safeText(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        }
        window.safeText = safeText;

        function showToast(message) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'toastFade 0.3s ease-out forwards';
                setTimeout(() => toast.remove(), 300);
            }, 2500);
        }
        window.showToast = showToast;

        function showConfirm(title, message, confirmText, callback) {
            var overlay = document.getElementById('ppConfirmOverlay');
            if (!overlay) return;
            document.getElementById('ppConfirmTitle').textContent = title || '确认操作';
            document.getElementById('ppConfirmMsg').textContent = message || '确定要执行此操作吗？';
            document.getElementById('ppConfirmOkBtn').textContent = confirmText || '确认';
            window._confirmCallback = callback;
            if (overlay._closeTimer) {
                clearTimeout(overlay._closeTimer);
                overlay._closeTimer = null;
            }
            
            // FLIP Animation: Step 1 - First (记录按钮位置)
            var origin = window._confirmOrigin;
            
            // FLIP Animation: Step 2 - Last (设置最终状态)
            overlay.classList.remove('closing');
            overlay.classList.add('active');
            var okBtn = document.getElementById('ppConfirmOkBtn');
            okBtn.disabled = false;
            
            var dialog = overlay.querySelector('.pp-confirm-dialog');
            if (dialog) {
                dialog.style.transition = 'none';
                dialog.style.transform = '';
                dialog.style.opacity = '1';
            }
            
            void dialog?.offsetHeight;
            
            // FLIP Animation: Step 3 - Invert (计算差异并反向变换)
            if (origin && dialog) {
                var dialogRect = dialog.getBoundingClientRect();
                var dx = origin.btnCx - dialogRect.left - dialogRect.width / 2;
                var dy = origin.btnCy - dialogRect.top - dialogRect.height / 2;
                
                var btnSize = Math.sqrt(origin.btnWidth * origin.btnWidth + origin.btnHeight * origin.btnHeight) || 40;
                var dialogSize = Math.sqrt(dialogRect.width * dialogRect.width + dialogRect.height * dialogRect.height);
                var scale = btnSize / dialogSize * 0.6;
                
                dialog.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
                dialog.style.transformOrigin = 'center center';
                dialog.style.opacity = '0';
                
                overlay._ppDeleteOrigin = { 
                    dx: dx, 
                    dy: dy, 
                    scale: scale,
                    btnCx: origin.btnCx,
                    btnCy: origin.btnCy
                };
            }
            
            void dialog?.offsetHeight;
            
            // FLIP Animation: Step 4 - Play (播放动画)
            if (origin && dialog) {
                dialog.style.transition = 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease-out';
                dialog.style.transform = 'translate(0, 0) scale(1)';
                dialog.style.opacity = '1';
            }
            
            window._confirmOrigin = null;
        }
        window.showConfirm = showConfirm;

        window.execConfirm = function() {
            var overlay = document.getElementById('ppConfirmOverlay');
            if (!overlay) return;
            if (overlay.classList.contains('closing')) return;
            var cb = window._confirmCallback;
            
            if (overlay._ppDeleteOrigin) {
                var dialog = overlay.querySelector('.pp-confirm-dialog');
                if (dialog) {
                    var o = overlay._ppDeleteOrigin;
                    var okBtn = document.getElementById('ppConfirmOkBtn');
                    if (okBtn) okBtn.disabled = true;
                    overlay.classList.add('closing');
                    
                    // FLIP Animation for Close: 获取当前弹窗位置
                    var dialogRect = dialog.getBoundingClientRect();
                    
                    // 获取删除按钮当前位置
                    var deleteBtn = document.getElementById('ppDeleteBtn');
                    var btnRect = deleteBtn ? deleteBtn.getBoundingClientRect() : null;
                    
                    var targetDx = o.dx;
                    var targetDy = o.dy;
                    var targetScale = o.scale || 0.3;
                    
                    if (btnRect) {
                        // 使用按钮当前位置计算目标变换
                        targetDx = btnRect.left + btnRect.width / 2 - dialogRect.left - dialogRect.width / 2;
                        targetDy = btnRect.top + btnRect.height / 2 - dialogRect.top - dialogRect.height / 2;
                        
                        var btnSize = Math.sqrt(btnRect.width * btnRect.width + btnRect.height * btnRect.height);
                        var dialogSize = Math.sqrt(dialogRect.width * dialogRect.width + dialogRect.height * dialogRect.height);
                        targetScale = btnSize / dialogSize * 0.6;
                    }
                    
                    // Step 3 - Invert: 保持当前状态
                    dialog.style.transition = 'none';
                    dialog.style.transform = 'translate(0, 0) scale(1)';
                    dialog.style.opacity = '1';
                    void dialog.offsetHeight;
                    
                    // Step 4 - Play: 播放飞回动画
                    dialog.style.transition = 'transform 0.45s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.35s ease-in';
                    dialog.style.transform = 'translate(' + targetDx + 'px, ' + targetDy + 'px) scale(' + targetScale + ')';
                    dialog.style.opacity = '0';
                    
                    overlay._closeTimer = setTimeout(function() {
                        dialog.style.transform = '';
                        dialog.style.opacity = '';
                        dialog.style.transition = '';
                        dialog.style.transformOrigin = '';
                        overlay._ppDeleteOrigin = null;
                        overlay._closeTimer = null;
                        overlay.classList.remove('closing');
                        overlay.classList.remove('active');
                        window._confirmCallback = null;
                        if (typeof cb === 'function') {
                            cb();
                        }
                    }, 480);
                    return;
                }
            }
            
            overlay.classList.remove('active');
            overlay.classList.add('closing');
            var okBtn = document.getElementById('ppConfirmOkBtn');
            if (okBtn) okBtn.disabled = true;
            overlay._closeTimer = setTimeout(function() {
                overlay.classList.remove('closing');
                overlay.classList.remove('active');
                window._confirmCallback = null;
                overlay._closeTimer = null;
                if (typeof cb === 'function') {
                    cb();
                }
            }, 280);
        };

        window.closeConfirm = function() {
            var overlay = document.getElementById('ppConfirmOverlay');
            if (!overlay) return;
            if (overlay.classList.contains('closing')) return;
            
            if (overlay._ppDeleteOrigin) {
                var dialog = overlay.querySelector('.pp-confirm-dialog');
                if (dialog) {
                    var o = overlay._ppDeleteOrigin;
                    overlay.classList.add('closing');
                    dialog.style.transition = 'none';
                    dialog.style.transform = 'scale(1) translateY(0)';
                    dialog.style.opacity = '1';
                    void dialog.offsetHeight;
                    dialog.style.transition = 'transform 0.35s cubic-bezier(0.5, 0, 0.75, 0), opacity 0.25s ease-in';
                    dialog.style.transform = 'translate(' + o.dx + 'px, ' + o.dy + 'px) scale(0.05)';
                    dialog.style.opacity = '0';
                    overlay._closeTimer = setTimeout(function() {
                        overlay._ppDeleteOrigin = null;
                        overlay._closeTimer = null;
                        overlay.classList.remove('closing');
                        overlay.classList.remove('active');
                        window._confirmCallback = null;
                        var okBtn = document.getElementById('ppConfirmOkBtn');
                        if (okBtn) okBtn.disabled = false;
                    }, 380);
                    return;
                }
            }
            
            overlay.classList.remove('active');
            overlay.classList.add('closing');
            overlay._closeTimer = setTimeout(function() {
                overlay.classList.remove('closing');
                overlay.classList.remove('active');
                window._confirmCallback = null;
                var okBtn = document.getElementById('ppConfirmOkBtn');
                if (okBtn) okBtn.disabled = false;
                overlay._closeTimer = null;
            }, 300);
        };

            // ===================== 密码哈希 =====================
            async function hashPassword(password) {
                const encoder = new TextEncoder();
                const data = encoder.encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ===================== 登录 / 注册 / 登出 =====================
            const AUTH_MARKER = '__auth__';
            const DM_MARKER = '__dm__';

            async function findAuthRecord(nickname) {
                const { data } = await sb.from("posts")
                    .select("id, user_name, media_url")
                    .eq("user_name", nickname)
                    .eq("media_type", AUTH_MARKER)
                    .maybeSingle();
                return data;
            }

            async function saveUserInfo(name, isNewUser) {
                try {
                    var regTime = null;

                    // 优先从 __auth__ 记录获取注册时间（最权威）
                    try {
                        var authRes = await sb.from("posts")
                            .select("created_at")
                            .eq("user_name", name)
                            .eq("media_type", AUTH_MARKER)
                            .maybeSingle();
                        if (authRes.data && authRes.data.created_at) {
                            regTime = authRes.data.created_at;
                        }
                    } catch(e) {}

                    // 后备：从现有 __user_info__ 中读取 reg_time（用limit(1)而非maybeSingle，容错多行）
                    if (!regTime) {
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
                    }

                    // 最后后备：新用户用当前时间
                    if (!regTime && isNewUser) {
                        regTime = new Date().toISOString();
                    }

                    var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
                    var contentStr = JSON.stringify(userInfo);

                    // 尝试找到最新一条记录并UPDATE（比DELETE+INSERT更可靠，避免RLS拒绝DELETE）
                    var updated = false;
                    try {
                        var latest = await sb.from("posts")
                            .select("id")
                            .eq("user_name", name)
                            .eq("media_type", "__user_info__")
                            .order("created_at", { ascending: false })
                            .limit(1);
                        if (latest.data && latest.data.length > 0) {
                            var updRes = await sb.from("posts")
                                .update({ content: contentStr })
                                .eq("id", latest.data[0].id);
                            if (!updRes.error) {
                                updated = true;
                                console.log("saveUserInfo ✓ " + name + " 登录时间已更新(UPDATE): " + userInfo.last_login);
                            }
                        }
                    } catch(e) {}

                    // UPDATE失败或无记录时，INSERT一条新记录
                    if (!updated) {
                        var insertRes = await sb.from("posts").insert([{
                            user_name: name,
                            content: contentStr,
                            media_type: "__user_info__",
                            actor_key: "__user_info__"
                        }]);
                        if (insertRes.error) {
                            console.error("saveUserInfo insert失败:", insertRes.error.message);
                        } else {
                            console.log("saveUserInfo ✓ " + name + " 登录时间已更新(INSERT): " + userInfo.last_login);
                        }
                    }
                } catch(e) {
                    console.error("saveUserInfo失败:", e);
                }
            }

            window.openAuthModal = function (mode) {
                const id = mode === 'login' ? 'loginModal' : 'registerModal';
                document.getElementById(id).classList.add('active');
                setTimeout(() => {
                    const nickInp = document.getElementById(mode === 'login' ? 'loginNickInp' : 'regNickInp');
                    if (nickInp) nickInp.focus();
                }, 200);
            };

            document.getElementById('loginSubmitBtn').addEventListener('click', doLogin);
            document.getElementById('loginPwInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') doLogin();
            });
            document.getElementById('loginNickInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') document.getElementById('loginPwInp').focus();
            });

            async function doLogin() {
                const name = document.getElementById("loginNickInp").value.trim();
                const pw = document.getElementById("loginPwInp").value;
                if (!name) { showToast("请输入昵称"); return; }
                if (!pw) { showToast("请输入密码"); return; }

                const btn = document.getElementById("loginSubmitBtn");
                btn.disabled = true;
                btn.textContent = "验证中...";

                try {
                    if (name === ADMIN_NAME) {
                        if (pw !== "xxz123") {
                            showToast("密码错误");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                    } else {
                        const authRec = await findAuthRecord(name);
                        if (!authRec) {
                            showToast("账号不存在，请先注册");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                        const inputHash = await hashPassword(pw);
                        if (inputHash !== authRec.media_url) {
                            showToast("密码错误");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("登录成功，欢迎回来 " + name);
                    closeModal('loginModal');
                    
                    // 更新最近登录时间
                    await saveUserInfo(name, false);
                    
                    await initUI();
                    initialLoad(true);
                } catch (e) {
                    console.error(e);
                    showToast("登录失败，请重试");
                } finally {
                    btn.disabled = false;
                    btn.textContent = "登录";
                }
            }
            window.doLogin = doLogin;

            document.getElementById('registerSubmitBtn').addEventListener('click', doRegister);
            document.getElementById('regPwInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') doRegister();
            });
            document.getElementById('regNickInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') document.getElementById('regPwInp').focus();
            });

            async function doRegister() {
                const name = document.getElementById("regNickInp").value.trim();
                const pw = document.getElementById("regPwInp").value;
                if (!name) { showToast("请输入昵称"); return; }
                if (!pw) { showToast("请输入密码"); return; }
                if (pw.length < 3) { showToast("密码至少3位"); return; }

                const btn = document.getElementById("registerSubmitBtn");
                btn.disabled = true;
                btn.textContent = "注册中...";

                try {
                    const existing = await findAuthRecord(name);
                    if (existing) {
                        showToast("昵称 '" + name + "' 已被注册，请换一个");
                        btn.disabled = false; btn.textContent = "注册";
                        return;
                    }

                    const pwHash = await hashPassword(pw);
                    const { error } = await sb.from("posts").insert([{
                        user_name: name,
                        content: AUTH_MARKER,
                        media_url: pwHash,
                        media_type: AUTH_MARKER,
                        actor_key: AUTH_MARKER
                    }]);
                    if (error) {
                        showToast("注册失败：" + error.message);
                        btn.disabled = false; btn.textContent = "注册";
                        return;
                    }

                    currentUser = name;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("注册成功，欢迎 " + name);
                    closeModal('registerModal');
                    
                    // 保存用户注册信息
                    await saveUserInfo(name, true);
                    
                    await initUI();
                    initialLoad(true);
                } catch (e) {
                    console.error(e);
                    showToast("注册失败，请重试");
                } finally {
                    btn.disabled = false;
                    btn.textContent = "注册";
                }
            }

            // ========== 查看其他用户资料卡片 ==========
            let upcTargetUser = null;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '最近登录：加载中...';
                
                var avatarEl = document.getElementById('upcAvatar');
                // localStorage权威优先：当前用户先检查本地缓存
                var showAvatar = avatarCache[userName];
                if (!showAvatar && userName === currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            showAvatar = cachedAvatars[currentUser];
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                if (showAvatar) {
                    avatarEl.innerHTML = '<img src="' + showAvatar + '" alt="头像">';
                } else {
                    avatarEl.innerHTML = '<span id="upcAvatarText">' + userName[0].toUpperCase() + '</span>';
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
                    msgBtn.textContent = '💬 发消息';
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 异步加载头像和登录时间
                try {
                    // 当前用户优先使用localStorage权威缓存
                    if (userName === currentUser) {
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            if (cv[currentUser]) {
                                avatarCache[currentUser] = cv[currentUser];
                                if (document.getElementById('userProfileModal').classList.contains('active')) {
                                    avatarEl.innerHTML = '<img src="' + cv[currentUser] + '" alt="头像">';
                                }
                            }
                        } catch(e) {}
                    }
                    
                    var avatarRes = await sb.from("posts")
                        .select("media_url")
                        .eq("user_name", userName)
                        .eq("media_type", "__avatar__")
                        .eq("actor_key", "__avatar__")
                        .order("created_at", { ascending: false })
                        .limit(1);
                    
                    if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                        // 非当前用户才用DB值更新缓存（当前用户已在上面用localStorage设置）
                        if (userName !== currentUser) {
                            avatarCache[userName] = avatarRes.data[0].media_url;
                        } else if (!avatarCache[currentUser]) {
                            avatarCache[currentUser] = avatarRes.data[0].media_url;
                        }
                        if (document.getElementById('userProfileModal').classList.contains('active')) {
                            var url = (userName === currentUser && avatarCache[currentUser]) ? avatarCache[currentUser] : avatarRes.data[0].media_url;
                            avatarEl.innerHTML = '<img src="' + url + '" alt="头像">';
                        }
                    }
                    
                    var userInfoRes = await sb.from("posts")
                        .select("content")
                        .eq("user_name", userName)
                        .eq("media_type", "__user_info__")
                        .order("created_at", { ascending: false })
                        .limit(1);
                    
                    if (userInfoRes.data && userInfoRes.data.length > 0) {
                        try {
                            var info = JSON.parse(userInfoRes.data[0].content);
                            if (info.last_login) {
                                document.getElementById('upcLogin').textContent = '最近登录：' + new Date(info.last_login).toLocaleString();
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
                closeModal('userProfileModal');
                setTimeout(function() { openChat(upcTargetUser); }, 300);
            };

            // ========== 个人资料详情功能 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 填充基本信息
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
                                document.getElementById('profileDetailRegTime').textContent = new Date(userInfo.reg_time).toLocaleString();
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
                
                // localStorage权威优先：先检查本地缓存
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="头像">';
                        return;
                    }
                } catch(e) {}
                
                // 先用内存缓存显示
                if (avatarCache[currentUser]) {
                    avatarEl.innerHTML = '<img src="' + avatarCache[currentUser] + '" alt="头像">';
                }
                
                try {
                    const avatarRes = await sb.from("posts")
                        .select("media_url")
                        .eq("user_name", currentUser)
                        .eq("media_type", "__avatar__")
                        .eq("actor_key", "__avatar__")
                        .order("created_at", { ascending: false })
                        .limit(1);
                    
                    if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                        avatarEl.innerHTML = '<img src="' + avatarRes.data[0].media_url + '" alt="头像">';
                        avatarCache[currentUser] = avatarRes.data[0].media_url;
                        // 同步到localStorage
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            cv[currentUser] = avatarRes.data[0].media_url;
                            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cv));
                        } catch(e) {}
                    } else if (!avatarCache[currentUser]) {
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
                        // 使用 createImageBitmap 将图片解码/缩放出主线程
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
                                // fallback: 回退到 canvas 缩放
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
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('图片大小不能超过10MB');
                    return;
                }
                
                showToast('正在压缩并上传头像...');
                
                try {
                    // 任务2：重构为上传到 Supabase Storage 的 avatars/ 目录
                    const timestamp = Date.now();
                    const random = Math.floor(Math.random() * 1000);
                    const path = `avatars/${timestamp}_${random}_${file.name}`;
                    
                    // 上传到 Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 获取 Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 删除所有旧头像记录
                    var oldIds = await sb.from("posts")
                        .select("id")
                        .eq("user_name", currentUser)
                        .eq("media_type", "__avatar__")
                        .eq("actor_key", "__avatar__");
                    if (oldIds.data && oldIds.data.length > 0) {
                        for (var oi of oldIds.data) {
                            try {
                                await sb.rpc('delete_post_with_actor', {
                                    p_post_id: oi.id,
                                    p_actor_key: '__avatar__'
                                });
                            } catch(e) {}
                        }
                    }
                    
                    var { error } = await sb.from("posts").insert([{
                        user_name: currentUser,
                        content: "用户头像",
                        media_url: avatarUrl,
                        media_type: "__avatar__",
                        actor_key: "__avatar__"
                    }]);
                    
                    if (error) {
                        showToast('上传失败：' + error.message);
                        return;
                    }
                    
                    avatarCache[currentUser] = avatarUrl;
                    // 保存到localStorage持久化
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        cachedAvatars[currentUser] = avatarUrl;
                        localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
                    } catch(e) {}
                    updateAllAvatarElements(avatarUrl);
                    
                    showToast('头像更新成功');
                    localStorage.removeItem(CACHE_KEY);
                    await loadFeed(true);
                    avatarCache[currentUser] = avatarUrl;
                    updateAllAvatarElements(avatarUrl);
                } catch(e) {
                    console.error("上传头像失败:", e);
                    showToast('上传失败，请重试');
                }
                
                event.target.value = '';
            };

            function updateAllAvatarElements(avatarUrl) {
                var els = [
                    document.getElementById('profileAvatar'),
                    document.getElementById('myAvatar'),
                    document.getElementById('profileDetailAvatar'),
                    document.getElementById('upcAvatar')
                ];
                els.forEach(function(el) {
                    if (el) {
                        el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                    }
                });
                document.querySelectorAll('#feed .post .avatar').forEach(function(el) {
                    var header = el.closest('.post-header');
                    if (header) {
                        var nameEl = header.querySelector('.user-name');
                        if (nameEl && nameEl.textContent === currentUser) {
                            el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                        }
                    }
                });
                document.querySelectorAll('#dockChatMessages .chat-msg-avatar').forEach(function(el) {
                    if (el.closest('.chat-msg-row.sent')) {
                        el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                    }
                });
                document.querySelectorAll('#dockChatList .chat-list-item').forEach(function(el) {
                    var nameEl = el.querySelector('.cli-name');
                    if (nameEl && nameEl.textContent === currentUser) {
                        var avEl = el.querySelector('.cli-avatar');
                        if (avEl) {
                            avEl.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                        }
                    }
                });
            }

            async function updateAllAvatars() {
                // 更新我的页面的头像（localStorage权威优先）
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        const profileAvatar = document.getElementById('profileAvatar');
                        if (profileAvatar) {
                            profileAvatar.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
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
                            profileAvatar.innerHTML = '<img src="' + avatarRes.data[0].media_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                            avatarCache[currentUser] = avatarRes.data[0].media_url;
                            // 同步到localStorage
                            try {
                                var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                                cv[currentUser] = avatarRes.data[0].media_url;
                                localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cv));
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

            window.doLogout = async function () {
                currentUser = "";
                window.currentUser = currentUser;
                localStorage.removeItem("xtj_user");
                localStorage.removeItem(CACHE_KEY);
                document.getElementById("loginNickInp").value = "";
                document.getElementById("loginPwInp").value = "";
                document.getElementById("regNickInp").value = "";
                document.getElementById("regPwInp").value = "";
                if (chatRealtime) { sb.removeChannel(chatRealtime); chatRealtime = null; }
                if (annRealtime) { sb.removeChannel(annRealtime); annRealtime = null; }
                stopDMPolling();
                _chatCache = {};
                dockChatListCacheTime = 0;
                document.body.style.overflow = '';
                Object.keys(avatarCache).forEach(k => delete avatarCache[k]);
                showToast("已退出登录");
                await initUI();
                initialLoad(true);
            };

            // 处理我的页面用户卡片点击
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 已登录：打开个人资料详情
                    openProfileDetail();
                } else {
                    // 未登录：打开登录/注册页面
                    openAuthModal('login');
                }
            };

            async function initUI() {
                var unauthUI = document.getElementById("unauthUI");
                var authUI = document.getElementById("authUI");
                var annBtnWrapper = document.getElementById("announcement-btn-wrapper");
                var profileName = document.getElementById("profileName");
                var profileStatus = document.getElementById("profileStatus");
                var publishBox = document.getElementById("publishBox");
                
                if (currentUser) {
                    unauthUI.style.display = "none";
                    authUI.style.display = "flex";
                    annBtnWrapper.style.display = "block";
                    document.getElementById("myName").textContent = currentUser;
                    var avatar = document.getElementById("myAvatar");
                    avatar.textContent = currentUser[0].toUpperCase();
                    avatar.className = "avatar";
                    
                    // 更新我的页面显示
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "查看资料";
                    
                    // 显示发布区域
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 加载头像
                    loadUserAvatar();
                    
                    // 更新最近登录时间（页面每次打开都刷新，必须await确保写入）
                    await saveUserInfo(currentUser, false);
                    
                    try { subscribeToMessages(); startDMPolling(); updateUnreadBadge(); loadAnnouncements(); subscribeToAnnouncements(); } catch(e) {}
                } else {
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    // 更新我的页面显示（未登录）
                    profileName.textContent = "未登录";
                    profileStatus.textContent = "点击登录";
                    
                    // 隐藏发布区域
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 重置头像
                    var profileAvatar = document.getElementById('profileAvatar');
                    if (profileAvatar) {
                        profileAvatar.innerHTML = '?';
                    }
                    
                    try { stopDMPolling(); } catch(e) {}
                }
            }

            async function loadUserAvatar() {
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        updateAllAvatarElements(cachedAvatars[currentUser]);
                    } else {
                        // localStorage没有，再从数据库加载
                        const avatarRes = await sb.from("posts")
                            .select("media_url")
                            .eq("user_name", currentUser)
                            .eq("media_type", "__avatar__")
                            .eq("actor_key", "__avatar__")
                            .order("created_at", { ascending: false })
                            .limit(1);
                        if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                            avatarCache[currentUser] = avatarRes.data[0].media_url;
                            try {
                                cachedAvatars[currentUser] = avatarRes.data[0].media_url;
                                localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
                            } catch(e) {}
                            updateAllAvatarElements(avatarRes.data[0].media_url);
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

            function initRainAnimation() {
                const canvas = document.getElementById('rainCanvas');
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                let w, h;
                let drops = [];
                let animId = null;
                let paused = false;
                let resizeTimeout = null;

                function resize() { 
                    w = canvas.width = window.innerWidth; 
                    h = canvas.height = window.innerHeight; 
                }
                window.addEventListener('resize', () => {
                    if (resizeTimeout) clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(resize, 100);
                }, { passive: true });
                resize();

                for (let i = 0; i < 40; i++) drops.push({ 
                    x: Math.random()*w, 
                    y: Math.random()*h, 
                    len: Math.random()*8+6, 
                    xs: -0.5+Math.random()*1, 
                    ys: Math.random()*6+4 
                });

                function draw() {
                    ctx.clearRect(0,0,w,h);
                    ctx.strokeStyle = 'rgba(180,190,210,0.3)';
                    ctx.lineCap = 'round';
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    for (let p of drops) {
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p.x+p.xs, p.y+p.ys);
                        p.x += p.xs; p.y += p.ys;
                        if (p.y>h || p.x>w || p.x<0) { p.x = Math.random()*w; p.y = -20; }
                    }
                    ctx.stroke();
                    animId = requestAnimationFrame(draw);
                }
                window._rainPause = function() { 
                    if (animId) {
                        cancelAnimationFrame(animId);
                        animId = null;
                    }
                };
                window._rainResume = function() { 
                    if (!animId) {
                        draw();
                    }
                };
                draw();
            }

            // ===================== 发布动态 =====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("请输入内容"); return; }
                // 输入校验：限制长度、去除危险内容
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
                var btn = document.getElementById("pubBtn"); btn.disabled = true; btn.textContent = "发布中...";
                try {
                    let media_url = "", media_type = "";
                    if (file) {
                        const path = `${Date.now()}_${file.name}`;
                        await sb.storage.from("uploads").upload(path, file);
                        media_url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                        media_type = file.type.startsWith("image") ? "image" : "video";
                    }
                    var { error: insertErr } = await sb.from("posts").insert([{ user_name: currentUser, content: safeText(content).slice(0, 2000), media_url, media_type, actor_key: deviceId }]);
                    if (insertErr) { showToast("发布失败: " + (insertErr.message || "未知错误")); btn.disabled = false; btn.textContent = "发布动态"; return; }
                    document.getElementById("postInp").value = "";
                    document.getElementById("fileInp").value = "";
                    showToast("发布成功！");
                    loadFeed(true);
                } catch (e) { showToast("发布失败: " + (e.message || "网络错误")); } finally { btn.disabled = false; btn.textContent = "发布动态"; }
            };

            // ===================== 点赞 =====================
            window.toggleLike = async function (btn, postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                const isLiked = btn.classList.contains("liked");
                const statsText = btn.closest('.post').querySelector('.post-stats-text');

                if (isLiked) {
                    btn.classList.remove("liked");
                } else {
                    btn.classList.add("liked");
                    createHeartParticles(btn);
                }
                btn.textContent = isLiked ? "点赞" : "❤️";

                try {
                    if (isLiked) {
                        await sb.from("likes").delete().eq("post_id", postId).eq("actor_key", deviceId);
                    } else {
                        await sb.from("likes").insert([{ post_id: postId, user_name: currentUser, actor_key: deviceId }]);
                    }
                    const match = statsText.textContent.match(/点赞 (\d+)/);
                    if (match) {
                        const num = parseInt(match[1]);
                        statsText.innerHTML = statsText.innerHTML.replace(/点赞 \d+/, `点赞 ${isLiked ? num-1 : num+1}`);
                    }
                    updateFeedStats();
                    refreshStatModal();
                } catch (e) { console.error(e); }
            };

            function createHeartParticles(btn) {
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                const emojis = ["❤️","💕","💗","✨","💖","💓"];
                for (let i=0; i<8; i++) {
                    const heart = document.createElement('div');
                    heart.className = 'heart-particle';
                    heart.textContent = emojis[Math.floor(Math.random()*emojis.length)];
                    const angle = (Math.PI*2*i/8) + (Math.random()-0.5)*0.4;
                    const dist1 = 30 + Math.random()*20;
                    const dist2 = 55 + Math.random()*40;
                    const dist3 = 80 + Math.random()*50;
                    heart.style.left = cx+'px';
                    heart.style.top = cy+'px';
                    heart.style.setProperty('--tx25', Math.cos(angle)*dist1+'px');
                    heart.style.setProperty('--ty25', Math.sin(angle)*dist1+'px');
                    heart.style.setProperty('--tx60', Math.cos(angle)*dist2+'px');
                    heart.style.setProperty('--ty60', Math.sin(angle)*dist2+'px');
                    heart.style.setProperty('--tx', Math.cos(angle)*dist3+'px');
                    heart.style.setProperty('--ty', Math.sin(angle)*dist3+'px');
                    heart.style.animationDelay = (Math.random()*0.12)+'s';
                    document.body.appendChild(heart);
                    setTimeout(() => heart.remove(), 1200);
                }
            }

            // ===================== 评论 =====================
            window.openComment = function (postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                activePostId = postId;
                document.getElementById("commInp").value = "";
                document.getElementById("commentModal").classList.add("active");
                setTimeout(() => document.getElementById("commInp").focus(), 100);
            };
            document.getElementById("commBtn").onclick = async () => {
                const content = document.getElementById("commInp").value.trim();
                if (!content) { showToast("请输入评论内容"); return; }
                const btn = document.getElementById("commBtn");
                btn.textContent = "提交中...";
                btn.disabled = true;
                try {
                    const { error } = await sb.from("comments").insert([{ post_id: activePostId, user_name: currentUser, content, actor_key: deviceId }]);
                    if (error) throw error;
                    closeModal("commentModal");
                    showToast("评论成功！");
                    var scrollEl = document.getElementById('panelPosts');
                    var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
                    await loadFeed(true);
                    requestAnimationFrame(function() {
                        var p = document.getElementById('panelPosts');
                        if (p && savedScroll > 0) p.scrollTop = savedScroll;
                        var postEl = document.querySelector('.post[data-post-id="' + activePostId + '"]');
                        if (postEl) postEl.classList.add('visible');
                    });
                } catch (e) {
                    showToast("评论失败: " + (e.message || "未知错误"));
                    console.error(e);
                } finally {
                    btn.textContent = "发布评论";
                    btn.disabled = false;
                }
            };

            // ===================== 删除帖子 =====================
            window.openDelete = function (postId, ownerKey) {
                delPostId = postId;
                delOwnerKey = ownerKey;
                document.getElementById("delModal").classList.add("active");
            };
            document.getElementById("delBtn").onclick = async () => {
                if (!delPostId) return;
                const btn = document.getElementById("delBtn");
                btn.disabled = true;
                btn.textContent = "删除中...";
                try {
                    const key = isAdmin() ? delOwnerKey : deviceId;
                    const { error } = await sb.rpc("delete_post_with_actor", {
                        p_post_id: delPostId,
                        p_actor_key: key
                    });
                    if (error) {
                        showToast("删除失败：" + error.message);
                        return;
                    }
                    closeModal("delModal");
                    showToast("帖子已删除");
                    delPostId = null;
                    await loadFeed(true);
                } catch (e) {
                    showToast("删除帖子失败");
                    console.error(e);
                } finally {
                    btn.disabled = false;
                    btn.textContent = "确认删除";
                }
            };

            window.openModal = function (id) {
                document.getElementById(id).classList.add("active");
            };

            window.closeModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.classList.remove("active");
                el.style.display = 'none';
                if (id === 'statModal' && statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }
            };

            // ===================== 图片查看器 =====================
            const ivZoomState = { scale: 1, tx: 0, ty: 0 };
            let ivIsZooming = false;
            let ivIsPanning = false;
            let ivLastDist = 0;
            let ivPanStartX = 0, ivPanStartY = 0;
            let ivStartTx = 0, ivStartTy = 0;
            let ivStartScale = 1;
            let ivLastTapTime = 0;
            let ivDoubleTapTimer = null;
            let ivHintTimer = null;
            let ivTouchEndTime = 0;

            function ivApplyTransform() {
                const img = document.getElementById('ivImg');
                const v = ivZoomState;
                const t = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.scale})`;
                img.style.transform = t;
                img.style.webkitTransform = t;
            }

            function ivResetZoom(instant = false) {
                const img = document.getElementById('ivImg');
                ivZoomState.scale = 1;
                ivZoomState.tx = 0;
                ivZoomState.ty = 0;
                if (instant) {
                    img.classList.add('instant');
                    img.style.transform = '';
                    img.style.webkitTransform = '';
                    void img.offsetWidth;
                    img.classList.remove('instant');
                } else {
                    img.style.transform = '';
                    img.style.webkitTransform = '';
                }
            }

            function ivShowHint() {
                const h = document.getElementById('ivZoomHint');
                h.classList.add('show');
                clearTimeout(ivHintTimer);
                ivHintTimer = setTimeout(() => h.classList.remove('show'), 2000);
            }

            window.openImageViewer = function (src) {
                const viewer = document.getElementById('imgViewer');
                const img = document.getElementById('ivImg');
                const wrapper = document.getElementById('ivWrapper');
                ivResetZoom(true);
                img.src = src;
                wrapper.classList.add('open-anim');
                img.classList.add('instant');
                void img.offsetWidth;
                img.classList.remove('instant');
                viewer.classList.add('active');
                document.body.style.overflow = 'hidden';
            };

            window.closeImageViewer = function () {
                const viewer = document.getElementById('imgViewer');
                const wrapper = document.getElementById('ivWrapper');
                ivResetZoom(true);
                wrapper.classList.remove('open-anim');
                viewer.classList.remove('active');
                document.body.style.overflow = '';
            };

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeImageViewer();
            });

            const ivViewerEl = document.getElementById('imgViewer');
            const ivImgEl = document.getElementById('ivImg');

            ivViewerEl.addEventListener('click', function (e) {
                if (Date.now() - ivTouchEndTime < 120) return;
                if (e.target === ivViewerEl || e.target === document.getElementById('ivWrapper')) {
                    closeImageViewer();
                }
            });

            ivViewerEl.addEventListener('contextmenu', function (e) {
                e.preventDefault();
            });

            ivViewerEl.addEventListener('touchstart', function (e) {
                if (e.target.closest('.iv-close')) return;
                if (e.touches.length === 2) {
                    e.preventDefault();
                    ivIsZooming = true;
                    const t = e.touches;
                    ivLastDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                    ivStartTx = ivZoomState.tx;
                    ivStartTy = ivZoomState.ty;
                    ivStartScale = ivZoomState.scale;
                    ivImgEl.classList.add('instant');
                } else if (e.touches.length === 1) {
                    const now = Date.now();
                    if (now - ivLastTapTime < 320) {
                        clearTimeout(ivDoubleTapTimer);
                        ivLastTapTime = 0;
                        if (ivZoomState.scale > 1.5) {
                            ivResetZoom(false);
                        } else {
                            ivZoomState.scale = 2.5;
                            ivZoomState.tx = 0;
                            ivZoomState.ty = 0;
                            ivApplyTransform();
                            ivShowHint();
                        }
                        return;
                    }
                    ivLastTapTime = now;
                    ivDoubleTapTimer = setTimeout(() => { ivLastTapTime = 0; }, 350);

                    if (ivZoomState.scale > 1) {
                        ivIsPanning = true;
                        ivPanStartX = e.touches[0].clientX;
                        ivPanStartY = e.touches[0].clientY;
                        ivStartTx = ivZoomState.tx;
                        ivStartTy = ivZoomState.ty;
                        ivImgEl.classList.add('instant');
                    }
                }
            }, { passive: false });

            ivViewerEl.addEventListener('touchmove', function (e) {
                if (ivIsZooming && e.touches.length === 2) {
                    e.preventDefault();
                    const t = e.touches;
                    const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                    const totalRatio = dist / ivLastDist;
                    const newScale = Math.max(1, Math.min(6, ivStartScale * totalRatio));
                    const cx = (t[0].clientX + t[1].clientX) / 2;
                    const cy = (t[0].clientY + t[1].clientY) / 2;
                    const zoomRatio = ivStartScale > 0 ? newScale / ivStartScale : 1;
                    ivZoomState.tx = cx - zoomRatio * (cx - ivStartTx);
                    ivZoomState.ty = cy - zoomRatio * (cy - ivStartTy);
                    ivZoomState.scale = newScale;
                    ivApplyTransform();
                    ivShowHint();
                } else if (ivIsPanning && e.touches.length === 1) {
                    e.preventDefault();
                    const dx = e.touches[0].clientX - ivPanStartX;
                    const dy = e.touches[0].clientY - ivPanStartY;
                    ivZoomState.tx = ivStartTx + dx;
                    ivZoomState.ty = ivStartTy + dy;
                    ivApplyTransform();
                }
            }, { passive: false });

            ivViewerEl.addEventListener('touchend', function (e) {
                ivTouchEndTime = Date.now();
                if (ivIsZooming) {
                    ivIsZooming = false;
                    if (ivZoomState.scale <= 1) {
                        ivImgEl.classList.remove('instant');
                        ivResetZoom(false);
                    } else {
                        setTimeout(() => ivImgEl.classList.remove('instant'), 50);
                    }
                }
                if (ivIsPanning) {
                    ivIsPanning = false;
                    ivImgEl.classList.remove('instant');
                }
            });

            ivViewerEl.addEventListener('wheel', function (e) {
                if (!ivViewerEl.classList.contains('active')) return;
                e.preventDefault();
                const delta = -e.deltaY * 0.002;
                const newScale = Math.max(1, Math.min(6, ivZoomState.scale * (1 + delta)));
                if (newScale === ivZoomState.scale) return;
                const cx = e.clientX;
                const cy = e.clientY;
                const ratio = newScale / ivZoomState.scale;
                ivZoomState.tx = cx - ratio * (cx - ivZoomState.tx);
                ivZoomState.ty = cy - ratio * (cy - ivZoomState.ty);
                ivZoomState.scale = newScale;
                ivApplyTransform();
                ivShowHint();
                if (ivZoomState.scale <= 1) {
                    ivResetZoom(true);
                }
            }, { passive: false });

            // ===================== 浏览量统计 =====================
            // 全局帖子信息缓存，用于浏览记录
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';

            function getViewHistory() {
                try {
                    return window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 避免重复记录（同一用户同一帖子只记录一次）
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(entry);
                    // 只保留最近500条
                    if (history.length > 500) history.length = 500;
                    localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(history));
                }
            }

            function trackView(postId) {
                const key = `xtj_v_${postId}`;
                if (!localStorage.getItem(key) && !viewTracked.has(postId)) {
                    viewTracked.add(postId);
                    localStorage.setItem(key, "1");
                    var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                    if (postEl) {
                        var statsEl = postEl.querySelector('.post-stats-text');
                        if (statsEl) {
                            var vm = statsEl.textContent.match(/浏览 (\d+)/);
                            if (vm) {
                                var newVal = parseInt(vm[1]) + 1;
                                statsEl.innerHTML = statsEl.innerHTML.replace(/浏览 \d+/, '浏览 ' + newVal);
                            }
                        }
                    }
                    if (currentUser && postInfoCache[postId]) {
                        var rawContent = postInfoCache[postId].content || '';
                        saveViewHistory({
                            user_name: currentUser,
                            post_id: postId,
                            post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + '...' : (rawContent || '(图片/视频)'),
                            post_author: postInfoCache[postId].user_name || '未知',
                            viewed_at: new Date().toISOString()
                        });
                    }
                    setTimeout(async () => { 
                        try { 
                            await sb.rpc("increment_post_views", { p_post_id: postId }); 
                        } catch(e){ console.error(e); } 
                    }, 1000);
                    updateFeedStats();
                }
            }

            // ===================== 加载动态 =====================
            // 任务5：分页加载相关变量
            let feedPage = 0;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;

            async function loadFeed(forceRefresh = false) {
                const now = Date.now();
                if (forceRefresh) {
                    // 重置分页状态
                    feedPage = 0;
                    feedEndReached = false;
                    feedAllPosts = [];
                    feedAllComments = [];
                    feedAllLikes = [];
                }
                if (!forceRefresh) {
                    const cached = localStorage.getItem(CACHE_KEY);
                    if (cached) {
                        try {
                            const parsed = JSON.parse(cached);
                            if (parsed?.data && now - parsed.timestamp < CACHE_DURATION) {
                                // 缓存加载，同时初始化分页状态
                                feedAllPosts = parsed.data.posts || [];
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed(parsed.data);
                                // 启动无限滚动观察
                                setupFeedInfiniteScroll();
                                return;
                            }
                        } catch(e){}
                    }
                }
                const feed = document.getElementById("feed");
                if (!forceRefresh) feed.innerHTML = `<div class="loading"><div class="loading-spinner"></div><span class="loading-text">加载中...</span></div>`;
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*")
                    ]);
                    if (postRes.error || commRes.error || likeRes.error) {
                        const errMsg = (postRes.error || commRes.error || likeRes.error).message || '数据加载失败';
                        feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败: ${errMsg}</div>`;
                        return;
                    }
                    const data = { posts: postRes.data || [], comments: commRes.data || [], likes: likeRes.data || [] };
                    // 保存完整数据供分页使用
                    feedAllPosts = data.posts;
                    feedAllComments = data.comments;
                    feedAllLikes = data.likes;
                    // 缓存时排除头像和用户信息记录，防止base64大图撑爆localStorage
                    const cachePosts = data.posts.filter(p => p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
                    await renderFeed(data);
                    // 启动无限滚动观察
                    setupFeedInfiniteScroll();
                } catch(e) {
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败，刷新重试</div>`;
                    console.error(e);
                }
            }

            // 任务5：设置无限滚动观察器
            function setupFeedInfiniteScroll() {
                if (feedScrollObserver) feedScrollObserver.disconnect();
                
                const feed = document.getElementById('feed');
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting && !feedEndReached) {
                            loadMoreFeedPosts();
                        }
                    });
                }, { rootMargin: '200px' });
                
                // 在 feed 底部添加一个 sentinel 元素
                let sentinel = document.getElementById('feedSentinel');
                if (!sentinel) {
                    sentinel = document.createElement('div');
                    sentinel.id = 'feedSentinel';
                    sentinel.style.height = '1px';
                    feed.appendChild(sentinel);
                }
                observer.observe(sentinel);
                feedScrollObserver = observer;
            }

            // 任务5：加载更多帖子
            function loadMoreFeedPosts() {
                if (feedEndReached) return;
                
                const feed = document.getElementById('feed');
                const visiblePosts = feedAllPosts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                
                const startIdx = feedPage * FEED_PAGE_SIZE;
                const endIdx = startIdx + FEED_PAGE_SIZE;
                
                if (startIdx >= visiblePosts.length) {
                    feedEndReached = true;
                    // 显示没有更多了
                    let noMore = document.getElementById('feedNoMore');
                    if (!noMore) {
                        noMore = document.createElement('div');
                        noMore.id = 'feedNoMore';
                        noMore.className = 'loading';
                        noMore.textContent = '没有更多了';
                        noMore.style.padding = '30px';
                        noMore.style.textAlign = 'center';
                        feed.appendChild(noMore);
                    }
                    return;
                }
                
                const nextPosts = visiblePosts.slice(startIdx, endIdx);
                appendMorePosts(nextPosts, feedAllComments, feedAllLikes);
                feedPage++;
            }

            // 任务5：追加更多帖子到 feed
            function appendMorePosts(posts, comments, likes) {
                const feed = document.getElementById('feed');
                const { commentMap, likeMap, likeUserMap } = buildPostMaps(comments, likes);
                
                const postsHtml = posts.map(p => {
                    const pLikes = likeMap[p.id] || [];
                    const pComms = commentMap[p.id] || [];
                    const isLiked = likeUserMap[p.id + '|' + deviceId];
                    const canDelPost = p.actor_key === deviceId || p.actor_key === currentUser || isAdmin();
                    trackView(p.id);
                    return `
                <div class="post glass" data-post-id="${escapeHtml(p.id)}">
                  <div class="post-header">
                    ${getAvatarHtml(p.user_name)}
                    <div class="user-info">
                      <span class="user-name">${escapeHtml(p.user_name)}</span>
                      <span class="post-time">${new Date(p.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div class="content">${escapeHtml(p.content)}</div>
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none">`:`<img src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${escapeHtml(p.media_url).replace(/'/g, "\\'")}')">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} · 点赞 ${pLikes.length} · 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'❤️':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">评论</button>
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">删除</button>`:''}
                    <button class="action-btn report-btn" style="margin-left:auto;" data-id="${escapeHtml(p.id)}" data-user="${escapeHtml(p.user_name)}">举报</button>
                  </div>
                  ${pComms.length?`
                  <div class="comments">
                    ${pComms.map(c=>`
                    <div class="comment-item" data-comment-id="${escapeHtml(c.id)}">
                      <div><b>${escapeHtml(c.user_name)}:</b> ${escapeHtml(c.content)}</div>
                    </div>
                    `).join('')}
                  </div>
                  `:''}
                </div>
              `;
                }).join('');
                
                // 在 sentinel 之前插入新帖子
                const sentinel = document.getElementById('feedSentinel');
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = postsHtml;
                
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                
                // 为新帖子添加进入动画观察（复用全局观察器）
                const newPosts = feed.querySelectorAll('.post:not(.visible)');
                newPosts.forEach(p => getPostVisibilityObserver().observe(p));
                
                // 更新统计
                updateFeedStats();
            }

            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;

                // 填充帖子信息缓存，供浏览记录使用
                visiblePosts.forEach(p => {
                    postInfoCache[p.id] = { content: p.content, user_name: p.user_name };
                });

                // 收集所有需要头像的用户名
                const allUsers = new Set();
                visiblePosts.forEach(p => allUsers.add(p.user_name));
                comments.forEach(c => allUsers.add(c.user_name));

                // 等待头像加载完成后再渲染
                await loadAvatarsForUsers(Array.from(allUsers));
                
                // 任务5：只渲染第一页的内容，后续通过无限滚动加载
                const firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                renderFeedWithAvatars(firstPage, comments, likes);
                
                // 后台预加载统计数据
                setTimeout(function() { prefetchStatData(); }, 1000);
            }
            window.renderFeed = renderFeed;

            // 预构建评论和点赞的映射表，提升渲染性能
            function buildPostMaps(comments, likes) {
                const commentMap = {};
                const likeMap = {};
                const likeUserMap = {};

                comments.forEach(c => {
                    if (!commentMap[c.post_id]) commentMap[c.post_id] = [];
                    commentMap[c.post_id].push(c);
                });

                likes.forEach(l => {
                    if (!likeMap[l.post_id]) likeMap[l.post_id] = [];
                    likeMap[l.post_id].push(l);
                    likeUserMap[l.post_id + '|' + l.actor_key] = true;
                });

                return { commentMap, likeMap, likeUserMap };
            }

            // 缓存头像URL
            const avatarCache = {};

            async function loadAvatarsForUsers(usernames) {
                if (!usernames || usernames.length === 0) return;
                try {
                    var allData = [];
                    var batchSize = 80; // Supabase .in() 最多约100个值，留20余量
                    for (var i = 0; i < usernames.length; i += batchSize) {
                        var batch = usernames.slice(i, i + batchSize);
                        var { data: batchData } = await sb.from("posts")
                            .select("user_name, media_url")
                            .eq("media_type", "__avatar__")
                            .eq("actor_key", "__avatar__")
                            .in("user_name", batch)
                            .order("created_at", { ascending: false });
                        if (batchData) allData = allData.concat(batchData);
                    }

                    if (allData.length) {
                        var seenUsers = {};
                        allData.forEach(avatar => {
                            if (avatar.media_url && !seenUsers[avatar.user_name]) {
                                seenUsers[avatar.user_name] = true;
                                avatarCache[avatar.user_name] = avatar.media_url;
                            }
                        });
                        if (currentUser) {
                            try {
                                var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                                if (cachedAvatars[currentUser]) {
                                    avatarCache[currentUser] = cachedAvatars[currentUser];
                                }
                            } catch(e) {}
                        }
                    }
                } catch(e) {
                    console.error("加载头像失败:", e);
                }
            }

            function getAvatarHtml(username, size = 32) {
                var avatarUrl = avatarCache[username];
                if (!avatarUrl) {
                    if (username === currentUser) {
                        // 只从localStorage里拿当前用户自己的头像
                        try {
                            var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            avatarUrl = cachedAvatars[username];
                            if (avatarUrl) avatarCache[username] = avatarUrl;
                        } catch(e) {}
                    }
                }
                if (avatarUrl) {
                    return '<div class="avatar clickable" onclick="openUserProfile(\'' + username.replace(/'/g, "\\'") + '\')"><img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>';
                } else {
                    return '<div class="avatar clickable" onclick="openUserProfile(\'' + username.replace(/'/g, "\\'") + '\')">' + username[0].toUpperCase() + '</div>';
                }
            }

            function renderFeedWithAvatars(visiblePosts, comments, likes) {
                const feed = document.getElementById("feed");
                const { commentMap, likeMap, likeUserMap } = buildPostMaps(comments, likes);

                feed.innerHTML = visiblePosts.length ? visiblePosts.map(p => {
                    const pLikes = likeMap[p.id] || [];
                    const pComms = commentMap[p.id] || [];
                    const isLiked = likeUserMap[p.id + '|' + deviceId];
                    const canDelPost = p.actor_key === deviceId || p.actor_key === currentUser || isAdmin();
                    trackView(p.id);
                    return `
                <div class="post glass" data-post-id="${escapeHtml(p.id)}">
                  <div class="post-header">
                    ${getAvatarHtml(p.user_name)}
                    <div class="user-info">
                      <span class="user-name">${escapeHtml(p.user_name)}</span>
                      <span class="post-time">${new Date(p.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div class="content">${escapeHtml(p.content)}</div>
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none">`:`<img src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${escapeHtml(p.media_url).replace(/'/g, "\\'")}')">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} · 点赞 ${pLikes.length} · 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'❤️':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">评论</button>
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">删除</button>`:''}
                    <button class="action-btn report-btn" style="margin-left:auto;" data-id="${escapeHtml(p.id)}" data-user="${escapeHtml(p.user_name)}">举报</button>
                  </div>
                  ${pComms.length?`
                  <div class="comments">
                    ${pComms.map(c=>`
                    <div class="comment-item" data-comment-id="${escapeHtml(c.id)}">
                      <div><b>${escapeHtml(c.user_name)}:</b> ${escapeHtml(c.content)}</div>
                    </div>
                    `).join('')}
                  </div>
                  `:''}
                </div>
              `;
                }).join('') : `<div class="loading">快来发布第一条动态吧~</div>`;

                initPostScrollAnimation();
            }

            function initPostScrollAnimation() {
                document.querySelectorAll('.post').forEach(p => getPostVisibilityObserver().observe(p));
            }

            let _cachedSPosts = null, _cachedSViews = null, _cachedSLikes = null;
            function updateFeedStats() {
                var posts = document.querySelectorAll('.post');
                var totalLikes = 0, totalComments = 0, totalViews = 0;
                posts.forEach(function(p) {
                    var text = (p.querySelector('.post-stats-text') || {}).textContent || '';
                    var vm = text.match(/浏览 (\d+)/);
                    var lm = text.match(/点赞 (\d+)/);
                    var cm = text.match(/评论 (\d+)/);
                    if (vm) totalViews += parseInt(vm[1]);
                    if (lm) totalLikes += parseInt(lm[1]);
                    if (cm) totalComments += parseInt(cm[1]);
                });
                var sPosts = _cachedSPosts || (_cachedSPosts = document.getElementById('sPosts'));
                var sViews = _cachedSViews || (_cachedSViews = document.getElementById('sViews'));
                var sLikes = _cachedSLikes || (_cachedSLikes = document.getElementById('sLikes'));
                if (sPosts) sPosts.textContent = posts.length;
                if (sViews) sViews.textContent = totalViews;
                if (sLikes) sLikes.textContent = totalLikes + totalComments;
            }

            async function initialLoad(skipCache = false) {
                if (!skipCache) {
                    const cached = localStorage.getItem(CACHE_KEY);
                    if (cached) {
                        try {
                            const parsed = JSON.parse(cached);
                            if (parsed?.data && Date.now()-parsed.timestamp < CACHE_DURATION) { await renderFeed(parsed.data); loadFeed(true); if (currentUser) loadDockChatList(); return; }
                        } catch(e){}
                    }
                }
                await loadFeed(false);
                if (currentUser) loadDockChatList();
            }

            // ===================== 数据统计详情功能 =====================
            // 存储当前的统计视图状态
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30秒缓存

            // 后台预加载统计数据
            window.prefetchStatData = async function() {
                if (Date.now() - statCacheTime < STAT_CACHE_DURATION) return;
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = (postRes.data || []).filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__');
                    statAllComments = commRes.data || [];
                    statAllLikes = likeRes.data || [];
                    statCacheTime = Date.now();
                } catch(e) {}
            };

            // 打开统计详情模态框
            window.openStatDetail = async function(type) {
                statCurrentType = type;
                const titles = { posts: '总动态 - 按用户分组', views: '总浏览 - 浏览记录', likes: '点赞和评论 - 记录' };
                document.getElementById('statModalTitle').textContent = titles[type] || '统计详情';
                document.getElementById('statModal').classList.add('active');

                // 如果有缓存数据，立即渲染，同时异步刷新
                if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    // 后台静默刷新
                    prefetchStatData().then(function() {
                        if (document.getElementById('statModal').classList.contains('active') && statCurrentType === type) {
                            renderStatByType(type);
                        }
                    });
                    return;
                }

                document.getElementById('statModalBody').innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">加载中...</span></div>';

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = (postRes.data || []).filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__');
                    statAllComments = commRes.data || [];
                    statAllLikes = likeRes.data || [];
                    statCacheTime = Date.now();

                    renderStatByType(type);
                } catch(e) {
                    document.getElementById('statModalBody').innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error('stat error', e);
                }

                if (statPollTimer) clearInterval(statPollTimer);
                statPollTimer = setInterval(refreshStatModal, 15000);
            };

            function renderStatByType(type) {
                if (type === 'posts') {
                    renderPostStats();
                } else if (type === 'views') {
                    renderViewStats();
                } else if (type === 'likes') {
                    renderLikeStats();
                }
            }

            // 滚动到指定帖子并高亮
            window.scrollToPost = function(postId) {
                closeModal('statModal');
                setTimeout(() => {
                    const post = document.querySelector(`.post[data-post-id="${postId}"]`);
                    if (post) {
                        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        post.style.boxShadow = '0 0 0 3px var(--primary)';
                        post.style.transition = 'box-shadow 0.3s';
                        setTimeout(() => { post.style.boxShadow = ''; }, 2000);
                    }
                }, 350);
            };

            window.openPostDetail = async function(postId) {
                document.getElementById('postDetailTitle').textContent = '帖子详情';
                document.getElementById('postDetailBody').innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">加载中...</span></div>';
                document.getElementById('postDetailModal').classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);

                    const post = postRes.data;
                    if (!post) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">帖子不存在或已被删除</div>';
                        return;
                    }
                    const likes = likeRes.data || [];
                    const comments = commRes.data || [];
                    renderPostDetail(post, likes, comments);
                } catch(e) {
                    document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error(e);
                }
            };

            function renderPostDetail(post, likes, comments) {
                const body = document.getElementById('postDetailBody');
                const vc = (post.views||0) + 1;

                body.innerHTML = `
                    <div class="post-detail-header">
                        <div class="pdh-left">
                            <div class="pdh-name">${escapeHtml(post.user_name)}</div>
                            <div class="pdh-time">${new Date(post.created_at).toLocaleString()}</div>
                        </div>
                    </div>
                    ${post.content ? `<div class="post-detail-content">${escapeHtml(post.content)}</div>` : ''}
                    ${post.media_url ? `<div class="post-detail-media">${post.media_type==='video'?`<video src="${escapeHtml(post.media_url)}" controls preload="none"></video>`:`<img src="${escapeHtml(post.media_url)}" onclick="openImageViewer('${escapeHtml(post.media_url).replace(/'/g, "\\'")}')" loading="lazy" />`}</div>` : ''}
                    <div class="post-detail-stats">浏览 ${vc} · 点赞 ${likes.length} · 评论 ${comments.length}</div>
                    <div class="stat-two-col">
                        <div class="stat-col">
                            <div class="stat-section-title">❤️ 点赞用户（${likes.length}）</div>
                            ${likes.length ? likes.map(l => `
                                <div class="stat-like-item">
                                    <div class="sli-info">
                                        <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                    </div>
                                    <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                                </div>
                            `).join('') : '<div class="stat-empty" style="padding:12px 0;">暂无点赞</div>'}
                        </div>
                        <div class="stat-col">
                            <div class="stat-section-title">💬 评论列表（${comments.length}）</div>
                            ${comments.length ? comments.map(c => `
                                <div class="stat-comment-item">
                                    <div class="sci-info">
                                        <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                        <div class="sci-target">${escapeHtml(c.content)}</div>
                                    </div>
                                    <span class="sci-time">${new Date(c.created_at).toLocaleString()}</span>
                                </div>
                            `).join('') : '<div class="stat-empty" style="padding:12px 0;">暂无评论</div>'}
                        </div>
                    </div>
                `;
            }

            // 格式化帖子内容摘要（用于展示）
            function formatPostSummary(p) {
                const text = p.content || '';
                const hasImg = p.media_url && p.media_type === 'image';
                const hasVid = p.media_url && p.media_type === 'video';
                let tag = '';
                if (hasImg) tag = '<span class="spi-img-tag">🖼 图片</span>';
                if (hasVid) tag = '<span class="spi-img-tag">🎬 视频</span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '一张图片' : hasVid ? '一个视频' : '(无内容)');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 生成帖子条目的HTML（可点击跳转）
            function renderPostItemHTML(p) {
                const fmt = formatPostSummary(p);
                const onclick = `openPostDetail('${escapeHtml(p.id).replace(/'/g, "\\'")}')`;
                return `
                    <div class="stat-post-item">
                        <span class="spi-content" onclick="${onclick}" title="点击查看帖子详情">
                            ${escapeHtml(fmt.display)}
                            ${fmt.tag}
                        </span>
                        ${fmt.thumbUrl ? `<img class="spi-thumb" src="${escapeHtml(fmt.thumbUrl)}" onclick="${onclick}" title="点击查看帖子详情" />` : ''}
                        <span class="spi-time">${new Date(p.created_at).toLocaleString()}</span>
                    </div>
                `;
            }

            // 渲染总动态统计（按用户分组）
            function renderPostStats() {
                const body = document.getElementById('statModalBody');
                // 按 user_name 分组统计
                const userMap = {};
                statAllPosts.forEach(p => {
                    if (!userMap[p.user_name]) userMap[p.user_name] = [];
                    userMap[p.user_name].push(p);
                });
                const entries = Object.entries(userMap).sort((a, b) => b[1].length - a[1].length);
                
                if (!entries.length) {
                    body.innerHTML = '<div class="stat-empty">暂无动态数据</div>';
                    return;
                }

                body.innerHTML = entries.map(([name, posts]) => `
                    <div class="stat-user-group">
                        <div class="stat-user-header">
                            <div class="suh-left">
                                <div class="suh-avatar">${escapeHtml(name)[0].toUpperCase()}</div>
                                <span class="suh-name">${escapeHtml(name)}</span>
                            </div>
                            <span class="suh-count">${posts.length} 条</span>
                        </div>
                        <div class="stat-user-posts">
                            ${posts.slice(0, 3).map(p => renderPostItemHTML(p)).join('')}
                            ${posts.length > 3 ? `
                                <div style="text-align:center; padding:8px 0;">
                                    <button class="stat-view-btn" onclick="loadUserAllPosts('${escapeHtml(name).replace(/'/g, "\\'")}')">查看全部 ${posts.length} 条</button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('');
            }

            // 查看指定用户的所有帖子
            window.loadUserAllPosts = function(userName) {
                const body = document.getElementById('statModalBody');
                const userPosts = statAllPosts.filter(p => p.user_name === userName);
                body.innerHTML = `
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">← 返回总动态</button>
                    <div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        ${userName} 的全部帖子（共 ${userPosts.length} 条）
                    </div>
                    ${userPosts.map(p => renderPostItemHTML(p)).join('')}
                `;
            };

            // 渲染总浏览统计（从 localStorage 读取浏览历史）
            function renderViewStats() {
                const body = document.getElementById('statModalBody');
                const history = getViewHistory();
                
                if (!history.length) {
                    body.innerHTML = `
                        <div class="stat-empty">
                            <div style="font-size:16px; margin-bottom:8px;">📊 浏览记录</div>
                            <div style="font-size:13px;">暂无浏览详情数据</div>
                            <div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录会在你查看帖子时自动保存</div>
                            <div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录总浏览数：${document.getElementById('sViews').textContent} 次</div>
                        </div>
                    `;
                    return;
                }

                body.innerHTML = history.map(v => `
                    <div class="stat-view-item">
                        <div class="svi-info">
                            <div class="svi-user">${escapeHtml(v.user_name)}</div>
                            <div class="svi-target">浏览了 <b>${escapeHtml(v.post_author)}</b> 的帖子：${escapeHtml(v.post_content)}</div>
                        </div>
                        <span class="svi-time">${new Date(v.viewed_at).toLocaleString()}</span>
                    </div>
                `).join('');
            }

            // 渲染点赞和评论统计
            function renderLikeStats() {
                const body = document.getElementById('statModalBody');

                const postMap = {};
                statAllPosts.forEach(p => { postMap[p.id] = p; });

                function buildLikesCol() {
                    let h = '<div class="stat-section-title">❤️ 点赞记录</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(l => {
                            const post = postMap[l.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                            return `
                        <div class="stat-like-item">
                            <div class="sli-info">
                                <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                <div class="sli-target">点赞了：${postContent}</div>
                            </div>
                            <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    let h = '<div class="stat-section-title">💬 评论记录</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">评论了「${postContent}」：${escapeHtml(c.content)}</div>
                            </div>
                            <span class="sci-time">${new Date(c.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
                    }
                    return h;
                }

                body.innerHTML = `
                    <div class="stat-two-col">
                        <div class="stat-col">${buildLikesCol()}</div>
                        <div class="stat-col">${buildCommentsCol()}</div>
                    </div>
                `;
            }

            function refreshStatModal() {
                var modal = document.getElementById('statModal');
                if (!modal || !modal.classList.contains('active')) return;
                var type = statCurrentType;
                if (!type) return;
                Promise.all([
                    sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                    sb.from("comments").select("*").order("created_at"),
                    sb.from("likes").select("*").order("created_at", { ascending: false })
                ]).then(function(results) {
                    var postRes = results[0], commRes = results[1], likeRes = results[2];
                    statAllPosts = (postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__'; });
                    statAllComments = commRes.data || [];
                    statAllLikes = likeRes.data || [];
                    var body = document.getElementById('statModalBody');
                    if (!body) return;
                    if (type === 'posts') renderPostStats();
                    else if (type === 'views') renderViewStats();
                    else if (type === 'likes') renderLikeStats();
                }).catch(function() {});
            }

            // ===================== 通知系统 =====================
            let activeNotifications = [];

            function showNotification(userName, message) {
                if (!userName || !message) return;
                if (localStorage.getItem('xtj-notif') === 'off') return;
                if (currentDockTab === 'chat' && dockChatActiveUser === userName) return;

                const container = document.getElementById('notificationContainer');
                if (!container) return;

                const bubble = document.createElement('div');
                bubble.className = 'notification-bubble';

                const avatarHtml = avatarCache[userName] ? 
                    `<img src="${avatarCache[userName]}" alt="${userName}">` : 
                    userName[0].toUpperCase();

                const truncatedMsg = message.length > 50 ? message.slice(0, 50) + '...' : message;

                bubble.innerHTML = `
                    <div class="notification-avatar">${avatarHtml}</div>
                    <div class="notification-content">
                        <div class="notification-name">${escapeHtml(userName)}</div>
                        <div class="notification-text">${escapeHtml(truncatedMsg)}</div>
                    </div>
                `;

                bubble.addEventListener('click', () => {
                    switchDockTab('chat');
                    openChat(userName);
                    bubble.classList.remove('show');
                    bubble.classList.add('hide');
                    setTimeout(() => {
                        if (bubble.parentNode) bubble.remove();
                    }, 400);
                });

                container.appendChild(bubble);

                // 强制浏览器完成布局后再添加show类，确保CSS transition正确触发
                bubble.offsetHeight; // force reflow
                setTimeout(function() {
                    bubble.classList.add('show');
                }, 16);

                const notifId = Date.now() + Math.random();
                activeNotifications.push({ id: notifId, element: bubble });

                setTimeout(() => {
                    bubble.classList.remove('show');
                    bubble.classList.add('hide');
                    setTimeout(() => {
                        if (bubble.parentNode) bubble.remove();
                        activeNotifications = activeNotifications.filter(n => n.id !== notifId);
                    }, 400);
                }, 3000);
            }

            // ==== 测试通知横幅（控制台调用：testNotification()） ====
            window.testNotification = function() {
                showNotification('张三', '你好！这是一条测试消息～看看液态玻璃效果如何？');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常非常长的测试消息用来检查文本截断效果到底怎么样超出50个字符');
            };

            // ===================== 聊天系统 (Dock 兼容版) =====================
            let chatRealtime = null;
            let dmpollTimer = null;
            let dmpollInterval = null;

            function escapeHtml(str) {
                var d = document.createElement('div');
                d.textContent = str;
                return d.innerHTML;
            }
            window.escapeHtml = escapeHtml;

            function formatMsgTime(dateStr) {
                var d = new Date(dateStr);
                var now = new Date();
                var pad = function(n) { return String(n).padStart(2, '0'); };
                var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
                if (d.toDateString() === now.toDateString()) return hhmm;
                var yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
                if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + hhmm;
                return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmm;
            }

            function getMediaUrl(prefix, val) {
                if (val.startsWith('http')) return val;
                return sb.storage.from('uploads').getPublicUrl(val).data.publicUrl;
            }

            function isMsgReadByMe(msg) {
                var key = 'xtj_dmread_' + currentUser + '_' + msg.user_name;
                var t = localStorage.getItem(key);
                return t && new Date(msg.created_at) <= new Date(t);
            }

            function markMessagesRead(senderName) {
                var key = 'xtj_dmread_' + currentUser + '_' + senderName;
                localStorage.setItem(key, new Date().toISOString());
                updateUnreadBadge();
            }

            function subscribeToMessages() {
                if (chatRealtime) { sb.removeChannel(chatRealtime); }
                chatRealtime = sb.channel('chat-dms')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, function(payload) {
                        var m = payload.new;
                        console.log('[CHAT-REALTIME] 收到新消息:', m);
                        if (m.media_type !== DM_MARKER) return;
                        if (!currentUser) return;
                        if (m.media_url !== currentUser) return;
                        if (m.user_name === currentUser) return;
                        console.log('[CHAT-REALTIME] 触发通知:', m.user_name, m.content);
                        showNotification(m.user_name, m.content || '发送了一张图片/视频');
                        if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser === m.user_name) {
                            loadDockChatMessages(m.user_name, false);
                        } else if (typeof dockChatActiveUser === 'undefined' || !dockChatActiveUser) {
                            loadDockChatList();
                        } else {
                            updateUnreadBadge();
                        }
                    })
                    .subscribe(function(status, err) {
                        if (err) { console.error('[CHAT-REALTIME]', err); }
                        else if (status === 'SUBSCRIBED') { console.log('[CHAT-REALTIME] 已连接'); }
                    });
            }

            function startDMPolling(interval) {
                // 任务3：默认间隔 5 分钟（300000ms），降低数据库请求压力
                interval = interval || 300000;
                if (dmpollTimer) {
                    if (dmpollInterval === interval) return;
                    clearInterval(dmpollTimer); dmpollTimer = null;
                }
                dmpollInterval = interval;
                async function pollNow() {
                    if (!currentUser) return;
                    try {
                        if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {
                            await loadDockChatMessages(dockChatActiveUser, false);
                        } else {
                            await updateUnreadBadge();
                        }
                    } catch(e) {}
                }
                pollNow();
                dmpollTimer = setInterval(pollNow, interval);
            }

            function stopDMPolling() {
                if (dmpollTimer) { clearInterval(dmpollTimer); dmpollTimer = null; dmpollInterval = null; }
            }

            async function updateUnreadBadge() {
                try {
                    var result = await sb.from('posts')
                        .select('id, user_name, created_at')
                        .eq('media_type', DM_MARKER)
                        .eq('media_url', currentUser)
                        .order('created_at', { ascending: false })
                        .limit(200);

                    var data = result.data;
                    var error = result.error;
                    if (error) return;
                    var cnt = 0;
                    (data || []).forEach(function(m) {
                        if (!isMsgReadByMe(m)) cnt++;
                    });
                    var badge = document.getElementById('navChatBadge');
                    if (badge) {
                        if (cnt > 0) {
                            badge.textContent = cnt > 99 ? '99+' : cnt;
                            badge.classList.add('show');
                        } else {
                            badge.classList.remove('show');
                        }
                    }
                } catch(e) {}
            }

            let refreshTimeout = null;
            const debouncedLoadFeed = (forceRefresh = false) => {
                if (refreshTimeout) clearTimeout(refreshTimeout);
                refreshTimeout = setTimeout(() => loadFeed(forceRefresh), 500);
            };

            // ========== Dock 切换 ==========
            let currentDockTab = localStorage.getItem('xtj_current_tab') || 'posts';
            let lastTabTapTime = {};
            window.switchDockTab = function(tab, skipReturn) {
                if (tab === 'chat' && !currentUser) { showToast('请先登录'); return; }
                // 先触发点击动画（即使已经在当前tab也要播放）
                var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (btn) triggerTabAnimation(btn, tab);
                const now = Date.now();
                if (tab === currentDockTab && !skipReturn) {
                    // 已经在当前tab，单击执行返回操作
                    if (tab === 'posts') {
                        // 帖子页：回到顶部
                        const panel = document.getElementById('panelPosts');
                        if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                    } else if (tab === 'chat') {
                        // 聊天页：如果在对话中，返回聊天列表；否则回到顶部
                        if (dockChatActiveUser) {
                            dockChatGoBack();
                        } else {
                            const panel = document.getElementById('panelChat');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    } else if (tab === 'ai') {
                        const photoWallPage = document.getElementById('photoWallContainer');
                        if (photoWallPage) photoWallPage.scrollTo({ top: 0, behavior: 'smooth' });
                    } else if (tab === 'profile') {
                        // 我的页：回到顶部
                        const panel = document.getElementById('panelProfile');
                        if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                    return;
                }
                lastTabTapTime[tab] = now;
                currentDockTab = tab;
                localStorage.setItem('xtj_current_tab', tab);
                document.querySelectorAll('.dock-panel').forEach(p => p.classList.remove('active'));
                document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
                const panel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
                if (panel) panel.classList.add('active');
                const tabBtn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (tabBtn) tabBtn.classList.add('active');
                if (tab === 'posts') { if (window._rainResume) window._rainResume(); }
                else { if (window._rainPause) window._rainPause(); }
                if (tab === 'chat') { loadDockChatList(); startDMPolling(300000); }
                if (tab === 'ai') { if (typeof window.initPhotoWall === 'function') window.initPhotoWall(); }
                if (tab === 'profile') { syncProfileUser(); if (currentUser) loadUserAvatar(); }
            };

            // Animation class mapping
            var animClassMap = { posts: 'anim-post', chat: 'anim-chat', ai: 'anim-ai', profile: 'anim-profile' };
            // Track which buttons currently have animation playing
            var animatingTabs = {};
            // Animation durations by tab (in ms, matching CSS)
            var animDurations = { posts: 1500, chat: 2500, ai: 1400, profile: 1400 };

            function triggerTabAnimation(el, tab) {
                var cls = animClassMap[tab];
                if (!cls) return;
                if (animatingTabs[tab]) return;
                animatingTabs[tab] = true;
                el.classList.add(cls);
                // Clean up after animation duration + small buffer
                setTimeout(function() {
                    el.classList.remove(cls);
                    animatingTabs[tab] = false;
                }, animDurations[tab] + 50);
            }

            document.querySelectorAll('.dock-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    var tab = this.dataset.tab;
                    switchDockTab(tab);
                });
            });
            // ========== Dock 聊天 ==========
            let dockChatActiveUser = null;
            let dockChatSending = false;
            let dockChatMsgsBusy = false;
            let dockChatMsgsDirty = '';
            let dockChatMsgsUser = null;
            let _dockPreviewUrl = null;

            function dockChatGoBack() {
                dockChatActiveUser = null;
                document.getElementById('dockChatDetailView').classList.add('hidden');
                document.getElementById('dockChatListView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'none';
                document.getElementById('dockChatTitle').textContent = '消息';
                loadDockChatList();
                startDMPolling(300000);
                if (restorePostsScroll !== null) {
                    switchDockTab('posts');
                    requestAnimationFrame(() => {
                        const postsPanel = document.getElementById('panelPosts');
                        if (postsPanel) postsPanel.scrollTop = restorePostsScroll;
                        restorePostsScroll = null;
                    });
                }
            }
            window.dockChatGoBack = dockChatGoBack;

            window.openChatList = function() { switchDockTab('chat', true); };
            window.closeChat = function() { switchDockTab('posts'); };

            let restorePostsScroll = null;

            window.openChat = function(userName) {
                if (!currentUser) { showToast('请先登录'); return; }
                if (userName === currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                document.getElementById('dockChatMessages').innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>加载中...</div></div>';
                document.getElementById('dockChatListView').classList.add('hidden');
                document.getElementById('dockChatDetailView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'flex';
                document.getElementById('dockChatTitle').textContent = userName;
                switchDockTab('chat', true);
                loadDockChatMessages(userName);
                startDMPolling(60000);
            };

            async function loadDockChatList() {
                const el = document.getElementById('dockChatList');
                if (!el) return;
                if (Date.now() - dockChatListCacheTime < DOCK_CHAT_CACHE_DURATION) return;
                dockChatListCacheTime = Date.now();
                el.innerHTML = '<div class="chat-empty"><div class="ce-icon" style="animation:spin 1s linear infinite">⏳</div><div>加载中...</div></div>';
                try {
                    const { data: allMsgs, error } = await sb.from("posts")
                        .select("id, user_name, media_url, content, created_at")
                        .eq("media_type", DM_MARKER)
                        .or(`user_name.eq.${currentUser},media_url.eq.${currentUser}`)
                        .order("created_at", { ascending: false })
                        .limit(200);
                    if (error) throw error;
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>暂无消息</div><div style="font-size:12px;">在帖子页面点击头像开始聊天</div></div>';
                        updateUnreadBadge();
                        return;
                    }
                    const convMap = {};
                    allMsgs.forEach(m => {
                        const other = m.user_name === currentUser ? m.media_url : m.user_name;
                        if (!convMap[other] || new Date(m.created_at) > new Date(convMap[other].last_time)) {
                            convMap[other] = { other_user: other, last_message: m.content, last_time: m.created_at, unread: 0 };
                        }
                        if (m.media_url === currentUser && !isMsgReadByMe(m)) {
                            convMap[other].unread = Math.min((convMap[other].unread || 0) + 1, 99);
                        }
                    });
                    const convs = Object.values(convMap).sort((a, b) => new Date(b.last_time) - new Date(a.last_time));
                    // 预加载聊天列表头像
                    var chatUsers = convs.map(function(c) { return c.other_user; });
                    if (chatUsers.length > 0) {
                        var uncachedUsers = chatUsers.filter(function(u) { return !avatarCache[u]; });
                        if (uncachedUsers.length > 0) {
                            try {
                                var avatarRes = await sb.from("posts")
                                    .select("user_name, media_url")
                                    .eq("media_type", "__avatar__")
                                    .eq("actor_key", "__avatar__")
                                    .in("user_name", uncachedUsers)
                                    .order("created_at", { ascending: false });
                                if (avatarRes.data) {
                                    var seen = {};
                                    avatarRes.data.forEach(function(a) {
                                        if (a.media_url && !seen[a.user_name]) {
                                            seen[a.user_name] = true;
                                            avatarCache[a.user_name] = a.media_url;
                                        }
                                    });
                                }
                            } catch(e) {}
                        }
                    }
                    el.innerHTML = convs.map(c => {
                        var avHtml = avatarCache[c.other_user]
                            ? '<img src="' + avatarCache[c.other_user] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                            : c.other_user[0].toUpperCase();
                        return `
                        <div class="chat-list-item" onclick="openChat('${c.other_user.replace(/'/g, "\\'")}')">
                            <div class="cli-avatar">${avHtml}</div>
                            <div class="cli-info"><div class="cli-name">${c.other_user}</div><div class="cli-preview">${c.last_message}</div></div>
                            <div class="cli-right"><span class="cli-time">${formatMsgTime(c.last_time)}</span>${c.unread ? '<span class="cli-badge">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : ''}</div>
                        </div>`;
                    }).join('');
                    updateUnreadBadge();
                } catch(e) {
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">⚠️</div><div>' + (e.message || '加载失败') + '</div></div>';
                }
            }

            // 聊天消息本地缓存，二次打开秒出
            var _chatCache = {};

            async function loadDockChatMessages(userName, forceScroll) {
                if (dockChatMsgsBusy && dockChatMsgsUser === userName) { dockChatMsgsDirty = userName; return; }
                // 预加载双方头像
                var needAvatars = [];
                if (currentUser && !avatarCache[currentUser]) needAvatars.push(currentUser);
                if (userName && !avatarCache[userName]) needAvatars.push(userName);
                if (needAvatars.length > 0) {
                    try {
                        var avatarRes = await sb.from("posts")
                            .select("user_name, media_url")
                            .eq("media_type", "__avatar__")
                            .eq("actor_key", "__avatar__")
                            .in("user_name", needAvatars)
                            .order("created_at", { ascending: false });
                        if (avatarRes.data) {
                            var seenAv = {};
                            avatarRes.data.forEach(function(a) {
                                if (a.media_url && !seenAv[a.user_name]) {
                                    seenAv[a.user_name] = true;
                                    avatarCache[a.user_name] = a.media_url;
                                }
                            });
                        }
                    } catch(e) {}
                }
                // 当前用户优先使用localStorage权威缓存
                if (currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 有缓存先立即显示
                var cacheKey = currentUser + '_' + userName;
                if (_chatCache[cacheKey] && !forceScroll) {
                    renderDockMessages(_chatCache[cacheKey], true);
                }
                dockChatMsgsBusy = true; dockChatMsgsUser = userName; dockChatMsgsDirty = '';
                const el = document.getElementById('dockChatMessages');
                try {
                    const { data: msgs, error } = await sb.from("posts").select("id, user_name, media_url, content, created_at, views, actor_key")
                        .eq("media_type", DM_MARKER)
                        .or(`and(user_name.eq.${currentUser},media_url.eq.${userName}),and(user_name.eq.${userName},media_url.eq.${currentUser})`)
                        .order("created_at").limit(500);
                    if (error) throw error;
                    // 缓存消息
                    _chatCache[cacheKey] = msgs || [];
                    const toMark = (msgs || []).filter(m => m.user_name === userName && m.media_url === currentUser && (m.views || 0) === 0);
                    await Promise.all(toMark.map(m => sb.rpc("increment_post_views", { p_post_id: m.id }).catch(() => {})));
                    toMark.forEach(m => { m.views = 1; });
                    markMessagesRead(userName);
                    renderDockMessages(msgs || [], forceScroll);
                } catch(e) {
                    if (!_chatCache[cacheKey]) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">⚠️</div><div>' + (e.message || '加载失败') + '</div></div>';
                    }
                } finally {
                    dockChatMsgsBusy = false;
                    if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
                }
            }

            function renderDockMessages(msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>'; return; }
                // 检测用户是否在查看历史记录（离底部超过100px视为在看历史）
                var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                // 先隐藏容器，渲染完直接到底再显示，避免从顶部滑下来的闪烁
                var wasHidden = false;
                if (shouldAutoScroll && isBulk) {
                    el.style.visibility = 'hidden';
                    wasHidden = true;
                }
                var otherUser = msgs[0] ? (msgs[0].user_name === currentUser ? msgs[0].media_url : msgs[0].user_name) : '';
                var myAvatarHtml = avatarCache[currentUser] ? '<img src="' + avatarCache[currentUser] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' : (currentUser ? currentUser[0].toUpperCase() : '?');
                var otherAvatarHtml = avatarCache[otherUser] ? '<img src="' + avatarCache[otherUser] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' : (otherUser ? otherUser[0].toUpperCase() : '?');
                el.innerHTML = msgs.map(m => {
                    const sent = m.user_name === currentUser;
                    const readStatus = sent ? ((m.views || 0) > 0 ? '<span class="msg-read-status">已读</span>' : '<span class="msg-read-status">未读</span>') : '';
                    let body = '';
                    if (m.actor_key && m.actor_key.startsWith('__dm_img__')) {
                        body = '<img class="msg-img" src="' + getMediaUrl('__dm_img__', m.actor_key.replace('__dm_img__', '')) + '" onclick="openImageViewer(this.src)" loading="lazy" />';
                        if (m.content) body += '<div class="msg-text">' + escapeHtml(m.content) + '</div>';
                    } else if (m.actor_key && m.actor_key.startsWith('__dm_vid__')) {
                        body = '<video class="msg-img" src="' + getMediaUrl('__dm_vid__', m.actor_key.replace('__dm_vid__', '')) + '" controls preload="metadata" onclick="event.stopPropagation()" style="cursor:default;"></video>';
                        if (m.content) body += '<div class="msg-text">' + escapeHtml(m.content) + '</div>';
                    } else { body = '<span class="msg-text">' + escapeHtml(m.content || '') + '</span>'; }
                    var avatarHtml = sent ? myAvatarHtml : otherAvatarHtml;
                    var bubble = '<div class="chat-msg ' + (sent ? 'sent' : 'received') + (isBulk ? ' no-anim' : '') + '">' + body + readStatus + '<span class="msg-time">' + formatMsgTime(m.created_at) + '</span></div>';
                    if (sent) {
                        return '<div class="chat-msg-row sent">' + bubble + '<div class="chat-msg-avatar">' + avatarHtml + '</div></div>';
                    } else {
                        return '<div class="chat-msg-row received"><div class="chat-msg-avatar">' + avatarHtml + '</div>' + bubble + '</div>';
                    }
                }).join('');
                if (shouldAutoScroll) {
                    el.scrollTop = el.scrollHeight;
                }
                // 渲染完毕，显示容器
                if (wasHidden) {
                    el.style.visibility = '';
                }
            }

            function scrollDockChatBottom() {
                const el = document.getElementById('dockChatMessages');
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            }

            async function sendDockChatMessage() {
                const inp = document.getElementById('dockChatInput');
                const content = inp.value.trim();
                const fileInput = document.getElementById('dockChatFileInp');
                const file = fileInput.files[0];
                if ((!content && !file) || !dockChatActiveUser || dockChatSending) return;
                dockChatSending = true; inp.value = '';
                try {
                    let actorKey = DM_MARKER;
                    if (file) {
                        const path = 'chat/' + Date.now() + '_' + file.name;
                        await sb.storage.from("uploads").upload(path, file);
                        actorKey = file.type.startsWith('video/') ? '__dm_vid__' + path : '__dm_img__' + path;
                    }
                    const { error } = await sb.from("posts").insert([{ user_name: currentUser, content: content, media_type: DM_MARKER, media_url: dockChatActiveUser, actor_key: actorKey }]);
                    if (error) throw error;
                    clearDockChatFilePreview();
                    await loadDockChatMessages(dockChatActiveUser, true);
                    const msgs = document.getElementById('dockChatMessages');
                    if (msgs) {
                        msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
                        const lastMsg = msgs.lastElementChild;
                        if (lastMsg && lastMsg.classList.contains('chat-msg')) {
                            lastMsg.classList.add('sent-anim');
                            setTimeout(function() {
                                msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
                            }, 200);
                        }
                    }
                } catch(e) { showToast('发送失败: ' + (e?.message || e)); inp.value = content; }
                finally { dockChatSending = false; }
            }

            function showDockChatFilePreview(file) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const thumb = document.getElementById('dockCfpThumb'), name = document.getElementById('dockCfpName');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                const xBtn = thumb.querySelector('.cfp-x'); thumb.innerHTML = '';
                if (file.type.startsWith('video/')) { thumb.innerHTML = '<span class="cfp-video-icon">🎬</span>'; }
                else { const img = document.createElement('img'); _dockPreviewUrl = URL.createObjectURL(file); img.src = _dockPreviewUrl; thumb.appendChild(img); }
                if (xBtn) thumb.appendChild(xBtn);
                name.textContent = file.name; input.classList.add('hidden'); preview.classList.remove('hidden');
            }

            function clearDockChatFilePreview() {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const fileInput = document.getElementById('dockChatFileInp');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                preview.classList.add('hidden'); input.classList.remove('hidden'); fileInput.value = ''; input.focus();
            }

            document.getElementById('dockChatSendBtn').addEventListener('click', sendDockChatMessage);
            document.getElementById('dockChatInput').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDockChatMessage(); } });
            document.getElementById('dockChatImgBtn').addEventListener('click', function() { document.getElementById('dockChatFileInp').click(); });
            document.getElementById('dockChatFileInp').addEventListener('change', function() { if (this.files.length) showDockChatFilePreview(this.files[0]); });
            document.getElementById('dockCfpRemove').addEventListener('click', clearDockChatFilePreview);

            window.addEventListener('DOMContentLoaded', async function() {
                // iOS 键盘弹出修复: 避免 dock-bar 被键盘顶上去
                (function() {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
                    let keyboardOpen = false;

                    function handleFocus(e) {
                        if (dockBar) dockBar.style.display = 'none';
                        keyboardOpen = true;
                        // 让输入框自动滚到可见区域
                        setTimeout(() => {
                            if (e.target && e.target.scrollIntoViewIfNeeded) {
                                e.target.scrollIntoViewIfNeeded(true);
                            } else if (e.target && e.target.scrollIntoView) {
                                e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }, 300);
                    }

                    function handleBlur() {
                        if (document.body.classList.contains('photo-previewing')) return;
                        if (dockBar) dockBar.style.display = 'flex';
                        keyboardOpen = false;
                    }

                    inputs.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.addEventListener('focus', handleFocus);
                            el.addEventListener('blur', handleBlur);
                        }
                    });

                    // 任务4：使用 100dvh 替代 --vh 方案，移除 resize 回调中的 adjustIOSHeight
                    // window.addEventListener('resize', function() {
                    //     if (!keyboardOpen) adjustIOSHeight();
                    // });
                })();

                // 任务4：使用 100dvh 替代 --vh 方案，移除旧的 iOS 调整代码
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI(); initRainAnimation(); initialLoad();
                // 恢复上次保存的标签页
                const savedTab = localStorage.getItem('xtj_current_tab');
                if (savedTab && savedTab !== 'posts') {
                    switchDockTab(savedTab, true);
                }
            });

            // ========== 主题切换 ==========
            const htmlEl = document.documentElement;
            const themeBtn = document.getElementById('themeToggle');
            function applyTheme(isDark) {
                if (isDark) {
                    htmlEl.setAttribute('data-theme', 'dark');
                    if (themeBtn) themeBtn.textContent = '☀️';
                    localStorage.setItem('xtj-theme', 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) themeBtn.textContent = '🌙';
                    localStorage.setItem('xtj-theme', 'light');
                }
            }
            if (themeBtn) {
                themeBtn.addEventListener('click', function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    applyTheme(!isDark);
                });
            }
            // 初始化主题：优先 localStorage，其次系统偏好
            const savedTheme = localStorage.getItem('xtj-theme');
            if (savedTheme === 'dark') {
                applyTheme(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme(true);
            } else {
                applyTheme(false);
            }

            // ========== 公告系统 ==========
            const ANN_MARKER = '__ann__';
            const ANN_READ_KEY = 'xtj_ann_read';
            let announcements = [];
            let currentAnnouncement = null;
            let annRealtime = null;

            function getReadAnnouncements() {
                try {
                    const data = localStorage.getItem(ANN_READ_KEY);
                    return data ? JSON.parse(data) : [];
                } catch(e) {
                    return [];
                }
            }

            function saveReadAnnouncements(readIds) {
                localStorage.setItem(ANN_READ_KEY, JSON.stringify(readIds));
            }

            function markAnnouncementRead(annId) {
                const readIds = getReadAnnouncements();
                if (!readIds.includes(annId)) {
                    readIds.push(annId);
                    saveReadAnnouncements(readIds);
                    updateAnnouncementBadge();
                }
            }

            function isAnnouncementRead(annId) {
                return getReadAnnouncements().includes(annId);
            }

            function updateAnnouncementBadge() {
                const readIds = getReadAnnouncements();
                const unreadCount = announcements.filter(a => !readIds.includes(a.id)).length;
                const badge = document.getElementById('announcementBadge');
                if (badge) {
                    if (unreadCount > 0) {
                        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                        badge.style.display = 'flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            }

            window.openAnnouncementModal = async function() {
                const overlay = document.getElementById('announcementModal');
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
                showAnnouncementList();
                await loadAnnouncements();
                renderAnnouncementList();

                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                } else {
                    document.getElementById('announcementAdminArea').style.display = 'none';
                }
            };

            window.closeAnnouncementModal = function() {
                const overlay = document.getElementById('announcementModal');
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.2s ease';
                setTimeout(() => {
                    overlay.classList.remove('active');
                    overlay.style.opacity = '';
                    overlay.style.transition = '';
                    document.body.style.overflow = '';
                    currentAnnouncement = null;
                }, 200);
            };

            function showAnnouncementList() {
                document.getElementById('announcementListContainer').style.display = 'block';
                const detail = document.getElementById('announcementDetail');
                detail.classList.remove('active');
                detail.style.display = 'none';
                currentAnnouncement = null;
                // 返回列表时恢复管理员的发布区域
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                markAnnouncementRead(ann.id);

                // 进入详情时隐藏发布区域
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 设置发布者信息（显示最新头像）
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = avatarCache[ann.user_name];
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + ann.user_name.charAt(0).toUpperCase() + '</div>';
                    userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + escapeHtml(ann.user_name) + '</div>';
                }

                // 如果是管理员，添加删除按钮
                const existingDelBtn = detail.querySelector('.announcement-delete-btn');
                if (existingDelBtn) existingDelBtn.remove();
                if (isAdmin()) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'announcement-delete-btn';
                    delBtn.textContent = '删除公告';
                    delBtn.onclick = function(e) { e.stopPropagation(); deleteAnnouncement(ann); };
                    const header = detail.querySelector('.announcement-detail-header');
                    if (header) header.appendChild(delBtn);
                }

                renderAnnouncementList(); // 重新渲染列表，更新已读状态
            }

            async function loadAnnouncements() {
                try {
                    const { data, error } = await sb.from('posts')
                        .select('*')
                        .eq('media_type', ANN_MARKER)
                        .order('created_at', { ascending: false });
                    if (error) throw error;
                    announcements = data || [];
                    updateAnnouncementBadge();
                    // 预加载发布者头像
                    if (announcements.length > 0) {
                        var publishers = new Set();
                        announcements.forEach(function(a) { publishers.add(a.user_name); });
                        loadAvatarsForUsers(Array.from(publishers));
                    }
                } catch(e) {
                    console.error('加载公告失败:', e);
                }
            }

            function parseAnnData(ann) {
                var title = '公告', content = ann.content || '';
                if (ann.content) {
                    try {
                        var parsed = JSON.parse(ann.content);
                        if (parsed.title !== undefined) { title = parsed.title || '公告'; content = parsed.content || ''; }
                    } catch(e) {}
                }
                return { title: title, content: content };
            }

            function renderAnnouncementList() {
                const listEl = document.getElementById('announcementList');
                if (!listEl) return;

                if (!announcements.length) {
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">📭</div><div>暂无公告</div></div>';
                    return;
                }

                listEl.innerHTML = '';
                const readIds = getReadAnnouncements();

                announcements.forEach((ann, index) => {
                    const isRead = readIds.includes(ann.id);
                    const item = document.createElement('div');
                    item.className = 'announcement-item' + (isRead ? '' : ' unread');
                    item.onclick = function() { showAnnouncementDetail(ann); };

                    var annData = parseAnnData(ann);
                    const displayTitle = annData.title;
                    const previewContent = annData.content ? (annData.content.length > 100 ? annData.content.substring(0, 100) + '...' : annData.content) : '';
                    
                    item.innerHTML = `
                        <div class="announcement-item-header">
                            <div class="announcement-item-title">
                                ${!isRead ? '<span class="unread-dot"></span>' : ''}
                                ${escapeHtml(displayTitle)}
                            </div>
                            <div class="announcement-item-time">${new Date(ann.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                        ${previewContent ? `<div class="announcement-item-preview">${escapeHtml(previewContent)}</div>` : ''}
                    `;
                    listEl.appendChild(item);

                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            item.classList.add('visible');
                        }, index * 60);
                    });
                });
            }

            window.publishAnnouncement = async function() {
                const titleInput = document.getElementById('announcementAdminTitle');
                const contentInput = document.getElementById('announcementAdminInput');
                const title = titleInput.value.trim();
                const content = contentInput.value.trim();
                
                if (!title && !content) {
                    showToast('请至少填写标题或内容');
                    return;
                }

                try {
                    // content字段存JSON：{title, content}（posts表没有title列）
                    const storeData = JSON.stringify({ title: title, content: content });
                    const { error } = await sb.from('posts').insert([{
                        user_name: ADMIN_NAME,
                        content: storeData,
                        media_type: ANN_MARKER,
                        media_url: '',
                        actor_key: 'admin_' + Date.now()
                    }]);
                    if (error) throw error;
                    titleInput.value = '';
                    contentInput.value = '';
                    showToast('公告发布成功');
                    await loadAnnouncements();
                    renderAnnouncementList();
                } catch(e) {
                    showToast('发布失败: ' + (e.message || '未知错误'));
                }
            };

            window.deleteAnnouncement = async function(ann) {
                showConfirm('删除公告', '确定要删除这条公告吗？', '是', async function() {
                    try {
                        const { error } = await sb.rpc('delete_post_with_actor', {
                            p_post_id: ann.id,
                            p_actor_key: ann.actor_key || 'admin_' + Date.now()
                        });
                        if (error) throw error;

                        const readIds = getReadAnnouncements();
                        const filteredReadIds = readIds.filter(id => id !== ann.id);
                        saveReadAnnouncements(filteredReadIds);

                        showToast('公告已删除');
                        await loadAnnouncements();
                        showAnnouncementList();
                        renderAnnouncementList();
                    } catch(e) {
                        showToast('删除失败: ' + (e.message || '未知错误'));
                    }
                });
            };

            function subscribeToAnnouncements() {
                if (annRealtime) return;
                annRealtime = sb.channel('announcements')
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'posts',
                        filter: `media_type=eq.${ANN_MARKER}`
                    }, async function() {
                        if (!currentUser) return;
                        await loadAnnouncements();
                        if (document.getElementById('announcementModal').classList.contains('active')) {
                            renderAnnouncementList();
                        }
                    })
                    .subscribe();
            }

            // ========== 更新日志系统 ==========
            const changelogData = [
                {
                    version: 'v0.0.56',
                    date: '2026-05-26',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>图片分辨率一致性优化</strong>
                                <ul>
                                    <li>统一缩略图生成参数为1200x1200分辨率、0.85压缩质量，确保封面缩略图与实际内容照片分辨率比例和清晰度标准完全一致</li>
                                    <li>覆盖照片墙两套上传流程（upload.js + features.js），保证所有新建照片均按统一标准生成高质量缩略图</li>
                                </ul>
                            </li>
                            <li><strong>删除功能UI与交互优化</strong>
                                <ul>
                                    <li>将系统级window.confirm删除确认弹窗替换为自定义玻璃磨砂弹窗，整体UI风格统一</li>
                                    <li>弹窗采用透明玻璃效果 + backdrop-filter: blur(28px) saturate(200%) 增强磨砂质感</li>
                                    <li>弹窗弹出时从scale(0.9) translateY(20px)平滑过渡到正常位置，动画曲线cubic-bezier弹性缓出</li>
                                    <li>确认删除后弹窗以scale(0.88)淡出动画消失，遮罩层同步淡化</li>
                                    <li>按钮在动画期间禁用防重复点击，点击遮罩层外部可取消</li>
                                    <li>所有交互流程自动清理回调引用，避免内存泄漏</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.55',
                    date: '2026-05-26',
                    content: `
                        <h4>修复内容</h4>
                        <ul>
                            <li><strong>照片墙封面显示修复</strong>
                                <ul>
                                    <li>简化.photo-wall-item伪元素视觉效果，移除多层渐变叠加，避免用户感知多张图片</li>
                                    <li>脉冲圆环正确居中定位，消除视觉混乱</li>
                                </ul>
                            </li>
                            <li><strong>照片点击预览修复</strong>
                                <ul>
                                    <li>移除冲突的CSS动画ppTrackEnter，避免与JS transform时序冲突</li>
                                    <li>openPhotoPreview中添加预定位逻辑，确保轨道在遮罩层可见前已就位</li>
                                    <li>修复相册视图ppSortedPhotos被覆盖的Bug</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.54',
                    date: '2026-05-25',
                    content: `
                        <h4>修复与优化</h4>
                        <ul>
                            <li><strong>链接复制优化</strong>
                                <ul>
                                    <li>优先使用同步API（&lt;10ms），点击即时显示绿色✓+弹性动画</li>
                                </ul>
                            </li>
                            <li><strong>缩放与手势优化</strong>
                                <ul>
                                    <li>ppResetZoom完整重置锚点状态，防止跨图残留</li>
                                    <li>双指间距变化&lt;10px判定为无效操作，防误识别</li>
                                </ul>
                            </li>
                            <li><strong>稳定性修复</strong>
                                <ul>
                                    <li>新增safeLocalStorageGetJSON，25处替换杜绝localStorage崩溃</li>
                                    <li>移除举报弹窗内联display:none，统一CSS class控制</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.53',
                    date: '2026-05-25',
                    content: `
                        <h4>修复内容</h4>
                        <ul>
                            <li><strong>封面闭包陷阱修复</strong>
                                <ul>
                                    <li>IIFE包裹确保每张图片独立绑定，全部正确加载</li>
                                </ul>
                            </li>
                            <li><strong>预加载优化</strong>
                                <ul>
                                    <li>延迟到滑动动画结束后执行，避免资源竞争</li>
                                    <li>精准控制预加载数量为3张，提升缓存命中率</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.51',
                    date: '2026-05-25',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>举报按钮修复</strong>
                                <ul>
                                    <li>将举报按钮直接嵌入帖子模板HTML（renderFeedWithAvatars 和 appendMorePosts），替代脆弱的DOM打补丁方式</li>
                                    <li>移除features.js中的MutationObserver补丁代码，按钮随帖子初始加载一并渲染，杜绝消失问题</li>
                                    <li>举报按钮右对齐置底，通过inline onclick调用window.openReport，兼容所有设备和屏幕尺寸</li>
                                </ul>
                            </li>
                            <li><strong>照片全屏预览双指放大性能优化</strong>
                                <ul>
                                    <li>CSS层面启用GPU硬件加速：backface-visibility: hidden + transform: translateZ(0) + will-change: transform</li>
                                    <li>手势系统重构：预分配PinchPre对象避免每帧Array.from分配，降低GC压力</li>
                                    <li>新增屏幕刷新率自动检测（rAF中值法），自适应120Hz/90Hz/60Hz帧预算</li>
                                    <li>viewport中心点预计算缓存，减少每帧布局查询</li>
                                </ul>
                            </li>
                            <li><strong>照片上传自动压缩</strong>
                                <ul>
                                    <li>新增compressToMaxSize函数：文件>10MB时自动压缩至~10MB，多级降级策略（2560→2048→1920→1280→800像素）</li>
                                    <li>100MB超大型照片也能自动压缩后上传，不再直接拒绝</li>
                                    <li>压缩失败时回退策略：≤50MB直接上传原文件，>50MB且压缩失败则跳过</li>
                                    <li>压缩前后尺寸均记录（fileSize + originalSize），数据透明可追溯</li>
                                    <li>Supabase免费版限制已确认：文件存储1GB，单文件50MB，月带宽5GB</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.52',
                    date: '2026-05-25',
                    content: `
                        <h4>修复内容</h4>
                        <ul>
                            <li><strong>照片墙数据丢失问题彻底修复</strong>
                                <ul>
                                    <li>根因定位：features.js中renderPhotoWall补丁覆盖了render.js的正确实现，导致永远从空数组[]渲染</li>
                                    <li>移除错误的补丁代码，恢复render.js中完整的加载+排序+渲染流水线</li>
                                    <li>修复features.js中多个IIFE作用域越界调用（formatPhotoTime、escapeHtml等全局函数引用修复）</li>
                                </ul>
                            </li>
                            <li><strong>筛选排序功能修复</strong>
                                <ul>
                                    <li>日期、名称、热度三种排序条件现在能正确组合生效</li>
                                    <li>排序切换后照片墙实时更新，结果符合预期逻辑</li>
                                    <li>删除操作后重新渲染保持当前排序键，不再重置为默认排序</li>
                                </ul>
                            </li>
                            <li><strong>相册视图空白修复</strong>
                                <ul>
                                    <li>数据加载链路修复后，相册视图在有照片时能正确渲染"按日期分组"的相册列表</li>
                                    <li>仅在确实无照片数据时才显示"暂无照片"提示</li>
                                </ul>
                            </li>
                            <li><strong>全屏预览交互优化</strong>
                                <ul>
                                    <li>双指缩放：新增ppApplyPinchTransformImmediate直接应用transform，跳过rAF延迟，提升跟手性</li>
                                    <li>自适应帧预算：3轮×10帧中值采样检测120Hz/90Hz/60Hz刷新率，精准分配帧预算</li>
                                    <li>图片切换消除黑屏：ppDecodeImage预加载+img.decode()确保解码完成后再显示，opacity平滑过渡</li>
                                    <li>前后各3张照片提前预加载，实现顺滑的即时切换</li>
                                </ul>
                            </li>
                            <li><strong>照片墙模块重构稳定性修复</strong>
                                <ul>
                                    <li>photo-wall.js中initPhotoWall函数通过window对象导出，core.js调用时增加typeof安全检查</li>
                                    <li>preview.js中修复ppEventsBound标志位，确保静态HTML覆盖层事件正确绑定</li>
                                    <li>修复photocurImg拼写错误为curImg</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.50',
                    date: '2026-05-25',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>照片墙功能全面完善</strong>
                                <ul>
                                    <li>新增按日期、名称、热度三种条件的筛选排序功能，切换后立即响应</li>
                                    <li>修复相册视图显示"暂无照片"的空白问题，点击相册按钮正确加载对应内容</li>
                                    <li>导航栏随上下滑动自动隐藏/显示，浏览照片时不再遮挡内容</li>
                                </ul>
                            </li>
                            <li><strong>照片预览交互优化</strong>
                                <ul>
                                    <li>修复全屏预览下单点退出与双击放大的冲突问题，两种操作互不干扰</li>
                                    <li>删除按钮图标由"x"替换为垃圾桶SVG图标，与关闭按钮清晰区分</li>
                                    <li>优化左右滑动预览时的图片加载策略，消除黑屏，采用图片缓存+延迟加载前后图片优先级方案</li>
                                    <li>图片加载时显示脉冲动画背景，替代纯黑背景，提升视觉体验</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.40',
                    date: '2026-05-24',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>UI视觉优化</strong>
                                <ul>
                                    <li>底部导航栏去框融合：移除背景、边框、阴影，仅保留四个按钮可见，按钮间区域可穿透点击</li>
                                    <li>统一面板/页面背景为中性色（浅灰/深灰），移除绿色色调，解决iOS底部绿色透显问题</li>
                                </ul>
                            </li>
                            <li><strong>照片墙功能增强</strong>
                                <ul>
                                    <li>新增全屏浏览左右滑动切换图片功能，支持手势拖拽导航</li>
                                    <li>首尾边界处理：第一张不能左滑，最后一张不能右滑，带阻力反馈和弹回动画</li>
                                    <li>取消过渡闪烁：修复切换图片时的位置跳跃和闪白bug</li>
                                    <li>双指缩放优化：移除RAF批处理延迟，直接应用transform实现原生级跟手流畅度</li>
                                    <li>整体滑动流畅度优化：will-change、transition精细化控制</li>
                                </ul>
                            </li>
                            <li><strong>响应式适配</strong>
                                <ul>
                                    <li>平板（768px+）：容器满宽、更大的间距和字体、文章卡片居中</li>
                                    <li>桌面（1024px+）：照片墙3列、文章卡片更宽、字体更大</li>
                                    <li>宽屏（1280px+）：照片墙4列、更多留白</li>
                                    <li>横屏手机优化：缩小底部导航栏占用空间</li>
                                </ul>
                            </li>
                            <li><strong>代码清理</strong>
                                <ul>
                                    <li>删除遗留的i18n翻译代码（translations字典、translatePage函数、语言选择UI）</li>
                                    <li>精简syncProfileUser等函数，移除对翻译字典的依赖</li>
                                    <li>移除profile-lang-tabs相关CSS样式</li>
                                </ul>
                            </li>
                            <li><strong>Bug修复</strong>
                                <ul>
                                    <li>修复管理员发公告时在帖子流中自动创建帖子的bug（feed查询未过滤ANN_MARKER）</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.38',
                    date: '2026-05-18',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>代码清理与精简</strong>
                                <ul>
                                    <li>彻底移除雅思单词学习系统全部代码（CSS样式、JS逻辑、HTML结构）</li>
                                    <li>删除设置页中的英语/韩语切换选项，仅保留中文</li>
                                    <li>清理所有废弃的翻译文本和语言切换相关JS逻辑</li>
                                    <li>修复scroll handler中对旧vocab-container的错误引用</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.37',
                    date: '2026-05-18',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>雅思单词版块全面重做为照片墙（相册功能）</strong>
                                <ul>
                                    <li>完全替换panelAi面板为照片墙HTML结构，移除所有单词学习界面</li>
                                    <li>每位用户可独立上传照片（base64存储至localStorage，单张限制20MB）</li>
                                    <li>横排5张网格布局（grid-template-columns: repeat(5, 1fr)），竖排无限滚动排列</li>
                                    <li>照片卡片hover时显示发布者名称、发布时间、浏览量</li>
                                    <li>点击任意照片进入全屏预览：固定定位遮罩层，原画质居中展示</li>
                                    <li>预览页显示发布用户、发布时间、浏览量（点击自动+1计数）</li>
                                    <li>照片按上传时间倒序排列（最新在前），支持智能时间格式化</li>
                                    <li>完整CSS样式：照片墙容器、5列网格、卡片交互、全屏预览、深色模式适配</li>
                                    <li>预览层点击背景区域或关闭按钮均可关闭</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.36',
                    date: '2026-05-13',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>彻底修复所有问题，实现极致的液态玻璃效果</strong>
                                <ul>
                                    <li>给单词页面添加复杂渐变纹理背景，让backdrop-filter能真正发挥出玻璃效果</li>
                                    <li>把dock-panel的滚动禁用，让单词页面自己管理滚动，解决排版混乱问题</li>
                                    <li>卡片、选项、反馈面板都添加极致的玻璃质感：多层边框、内高光、外阴影、高强度blur</li>
                                    <li>所有元素加伪元素高光层，增强玻璃的通透和立体感</li>
                                    <li>反馈面板移回vocab-scroll里，解决遮挡选项的问题</li>
                                    <li>暗色模式同步升级，背景用深色渐变+玻璃元素</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.35',
                    date: '2026-05-13',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>修复对错音效不生效问题</strong>
                                <ul>
                                    <li>修复AudioContext被浏览器挂起导致无声（增加resume()唤醒）</li>
                                    <li>提高音效音量（gain从0.1提升至0.18），错误音改用triangle波更清晰</li>
                                    <li>页面首次点击自动解锁音频上下文</li>
                                </ul>
                            </li>
                            <li><strong>修复继续按钮位置靠上</strong>
                                <ul>
                                    <li>容器底部内边距增加至16px，选项区底部间隙增加至20px</li>
                                    <li>底部flex间隙从10px提升至16px，按钮行增加上边距</li>
                                </ul>
                            </li>
                            <li><strong>液态玻璃效果大幅增强</strong>
                                <ul>
                                    <li>卡片：rgba 0.85 + blur(32px) saturate(220%)，阴影翻倍</li>
                                    <li>选项：rgba 0.72 + blur(16px) saturate(180%)</li>
                                    <li>反馈面板：rgba 0.82 + blur(30px) saturate(220%)</li>
                                    <li>暗色模式同步增强</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.34',
                    date: '2026-05-13',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>雅思单词页面全面重构优化</strong>
                                <ul>
                                    <li>修复继续按钮位置靠上问题，反馈面板移至底部紧邻继续按钮</li>
                                    <li>对错反馈仿不背单词风格重做：大图标+单词音标+释义+例句独立展示</li>
                                    <li>增加对错音效（Web Audio API 生成短促提示音，正确升调/错误降调）</li>
                                    <li>替换切换动画为缩放+淡入淡出组合，更加流畅自然</li>
                                    <li>增强液态玻璃效果：背景透明度提高至0.78，模糊提升至26px</li>
                                    <li>修复单词重复问题：改为随机队列洗牌算法，确保200词全部轮完才重复</li>
                                </ul>
                            </li>
                            <li><strong>TTS语音进一步优化</strong>
                                <ul>
                                    <li>优先选择Google在线语音（最自然），其次回退到系统语音</li>
                                    <li>Google语音速率0.9/音调1.0，非Google语音速率0.95/音调1.1减少机械感</li>
                                    <li>语音选择结果localStorage持久化，避免重复查找</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.33',
                    date: '2026-05-13',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>雅思单词系统全面优化</strong>
                                <ul>
                                    <li>排版重新设计，模拟不背单词/百词斩风格，干净白底无悬浮效果</li>
                                    <li>TTS语音优化，自动选择最自然英文语音，语速更真实</li>
                                    <li>增加对错数量记录（localStorage持久化），正确率进度条显示</li>
                                    <li>卡片滑入/滑出过渡动画，提升交互流畅度</li>
                                    <li>选项改为2列网格布局，答案正确/错误边框颜色反馈</li>
                                </ul>
                            </li>
                            <li><strong>清理遗留旧代码</strong>
                                <ul>
                                    <li>移除旧的 toggleAIChat 无用函数</li>
                                    <li>删除所有旧AI模板相关的翻译键（aiWelcome、enterYourQuestion、send）</li>
                                    <li>删除旧AI气泡CSS样式（.ai-msg）</li>
                                    <li>删除Taylor Swift画廊旧代码（initTSGallery）</li>
                                </ul>
                            </li>
                            <li><strong>修复Git合并冲突导致网站崩溃</strong>
                                <ul>
                                    <li>修复4处残留的合并冲突标记（CSS/HTML/JS），页面恢复正常</li>
                                </ul>
                            </li>
                            <li><strong>雅思单词页面液态玻璃风格重做</strong>
                                <ul>
                                    <li>发音按钮从emoji改为SVG喇叭图标+声波动画+液态玻璃容器</li>
                                    <li>TTS语音优选12种自然语音（Google UK Female/Microsoft Zira等），语速0.85音调1.05</li>
                                    <li>去掉例句朗读，只朗读单词本身</li>
                                    <li>卡片/选项/反馈面板全部改为液态玻璃效果（backdrop-filter毛玻璃）</li>
                                    <li>选项点击水波纹动画+正确弹性弹跳+错误抖动反馈</li>
                                    <li>对错反馈标题区分显示（✅正确/❌答案是）</li>
                                    <li>分数数字点击弹性放大动画</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.32',
                    date: '2026-05-12',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li><strong>雅思词汇库全面升级</strong>
                                <ul>
                                    <li>将原有初中水平基础词汇全面替换为雅思高频考点单词</li>
                                    <li>词库扩充至200+个真正的雅思核心词汇</li>
                                    <li>词汇涵盖 abandon 到 yield 等雅思必备词汇</li>
                                    <li>每个单词均包含标准音标、英文例句及中文翻译</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.31',
                    date: '2026-05-12',
                    content: `
                        &lt;h4&gt;更新内容&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift &amp; Jennie专题画廊替换为雅思单词学习系统&lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;删除所有原专题页的CSS样式（.idol-、.ts-开头样式）&lt;/li&gt;
                                    &lt;li&gt;新增雅思单词学习系统完整样式（.vocab-命名空间）&lt;/li&gt;
                                    &lt;li&gt;替换panelAi面板HTML结构为单词学习界面&lt;/li&gt;
                                    &lt;li&gt;新增200个雅思核心词库，包含单词、音标、释义、例句&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;雅思单词学习系统功能&lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;双模式学习：英译中模式、中译英模式&lt;/li&gt;
                                    &lt;li&gt;点击🔊按钮可朗读英文单词&lt;/li&gt;
                                    &lt;li&gt;答完题自动朗读单词和英文例句&lt;/li&gt;
                                    &lt;li&gt;每次随机生成4个选项供选择&lt;/li&gt;
                                    &lt;li&gt;正确答案绿色高亮，错误答案红色抖动&lt;/li&gt;
                                    &lt;li&gt;答题后显示详细解析和例句&lt;/li&gt;
                                    &lt;li&gt;完全支持深色/浅色主题自动适配&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                        &lt;/ul&gt;
                    `
                },
                {
                    version: 'v0.0.30',
                    date: '2026-05-03 16:00',
                    content: `
                        &lt;h4&gt;更新内容&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift专题页视觉与架构全面重构&lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;删除所有旧的 .ts- 开头CSS样式&lt;/li&gt;
                                    &lt;li&gt;新增双人专辑展示墙样式（.idol- 命名空间）&lt;/li&gt;
                                    &lt;li&gt;引入Google Fonts Great Vibes手写体&lt;/li&gt;
                                    &lt;li&gt;专辑卡片hover时缩放+磨砂玻璃遮罩效果&lt;/li&gt;
                                    &lt;li&gt;SVG签名描边动画+实心填充淡入&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;代码清理优化&lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;删除全部Taylor Swift画廊JavaScript代码&lt;/li&gt;
                                    &lt;li&gt;移除二级菜单相关废弃函数调用&lt;/li&gt;
                                    &lt;li&gt;替换干净的switchDockTab函数&lt;/li&gt;
                                    &lt;li&gt;代码架构更加清晰&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                        &lt;/ul&gt;
                    `
                },
                {
                    version: 'v0.0.29',
                    date: '2026-05-03 15:30',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>Taylor Swift专题页交互升级</li>
                            <ul>
                                <li>签名手写动画进入专题页时重新播放，并每隔数秒循环播放</li>
                                <li>12张专辑海报改为按时间倒序展示（最新专辑在前）</li>
                                <li>每张专辑支持点击进入详情页</li>
                                <li>专辑详情页新增专辑封面、时期照片、专辑故事、歌曲列表、背景故事</li>
                                <li>专辑封面和详情照片加入动态漂移动画</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.28',
                    date: '2026-05-03 15:00',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>Taylor Swift专题页升级为完整12张录音室专辑海报墙</li>
                            <ul>
                                <li>新增evermore、Midnights、The Tortured Poets Department、The Life of a Showgirl</li>
                                <li>顶部Taylor Swift签名改为模拟真实手写描边动画</li>
                                <li>专辑卡片加入真实封面图、海报式排版、渐入和悬停过渡</li>
                                <li>新增公开现场照片区域，增强专题页视觉层次</li>
                            </ul>
                            <li>更新“我的”页面版本号为v0.0.28</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.27',
                    date: '2026-05-03 14:00',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>AI聊天全面替换为Taylor Swift专题画廊</li>
                            <ul>
                                <li>移除DeepSeek AI聊天及API密钥</li>
                                <li>新增Taylor Swift签名SVG标题</li>
                                <li>8张专辑卡片画廊（Debut至folklore）</li>
                                <li>每张卡片渐入动画+悬停放大效果</li>
                                <li>专辑专属渐变色+SVG装饰图标</li>
                            </ul>
                            <li>全面代码审计修复9项Bug</li>
                            <li>修复聊天输入框在iOS上位置异常</li>
                            <li>移除所有AI相关代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复PC浏览器打开空白页问题</li>
                            <li>修复iOS灵动岛/刘海屏区域视觉适配</li>
                            <li>修复登录时间不更新问题</li>
                            <li>修复注册时间/登录时间显示为"-"的问题</li>
                            <li>iOS Safari浏览器完整适配</li>
                            <li>修复底部导航栏/通知/Toast在iOS刘海屏下位置异常</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>统一公告列表/详情/更新日志的样式大小（字体/间距都统一跟更新日志一致）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>彻底修复头像查询：所有头像查询强制加 actor_key=__avatar__，彻底排除旧数据干扰</li>
                            <li>修复手机底部导航往上飘（position:fixed+适配安全区域）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复公告发布失败bug（不用title列，JSON存content）</li>
                            <li>修复点击头像/个人资料显示旧头像（maybeSingle→limit(1)+上传先删后插，杜绝重复记录）</li>
                            <li>修复聊天列表加载慢（limit 1000→200，缓存30秒→120秒）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复其他用户看不到最新头像（loadAvatarsForUsers排序取最新）</li>
                            <li>修复底部导航栏可被滑动问题（touch-action禁止手势）</li>
                            <li>彻底去掉页面右侧竖滑动条（html/body overflow:hidden）</li>
                            <li>修复登录时间不更新bug（每次打开页面刷新登录时间）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复头像过一会儿自动回退bug（localStorage权威优先，DB不再覆盖）</li>
                            <li>去掉评论头像，只显示名字</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复聊天列表打开空白/加载慢问题</li>
                            <li>聊天列表后台预加载，点开秒出</li>
                            <li>彻底去掉帖子列表右侧竖滑动条</li>
                            <li>修复帖子滑动卡顿/抽搐抖动（仅淡入一次+图片加载优化）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.19',
                    date: '2026-05-03 09:10',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复刷新网页后头像回退bug</li>
                            <li>头像照片压缩进一步减小（80x80 @0.4）</li>
                            <li>修复更换头像后不更新的bug</li>
                            <li>帖子划入划出动画重设计：淡入+上移、淡出+下移</li>
                            <li>去掉帖子和评论的hover悬浮效果</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.18',
                    date: '2026-05-03 08:30',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>修复更换头像后不更新的bug（彻底修复）</li>
                            <li>去掉底部导航栏点击时的黑色框（彻底修复）</li>
                            <li>帖子加载动画从滑入改成淡入</li>
                            <li>修复注册时间与登录时间相同的bug（彻底修复）</li>
                            <li>头像上传压缩优化（128x128）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.17',
                    date: '2026-05-02 17:00',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>动画效果减半优化</li>
                            <ul>
                                <li>帖子滑入动画速度减半，translateY距离减半</li>
                                <li>所有按钮hover动画幅度减半（底部导航栏除外）</li>
                                <li>包括hover上浮、缩放、旋转等动画均减半</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.16',
                    date: '2026-05-02 16:53',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>头像点击行为优化</li>
                            <ul>
                                <li>点击帖子和评论中的头像不再直接跳转聊天</li>
                                <li>新增用户资料卡片弹窗，显示头像、用户名、最近登录时间</li>
                                <li>资料卡片中点击"发消息"按钮才跳转到聊天对话</li>
                            </ul>
                            <li>统计版块加载速度优化</li>
                            <ul>
                                <li>统计数据增加30秒内存缓存，二次打开秒出</li>
                                <li>后台预加载统计数据，首次打开也更快</li>
                            </ul>
                            <li>聊天功能头像显示</li>
                            <ul>
                                <li>用户聊天消息增加双方头像显示</li>
                                <li>聊天列表显示联系人真实头像</li>
                                <li>AI对话中显示用户真实头像</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.15',
                    date: '2026-05-02 16:30',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>头像上传压缩优化</li>
                            <ul>
                                <li>头像上传前自动压缩至256x256，JPEG质量0.7</li>
                                <li>大幅减少base64体积，防止存储溢出和加载失败</li>
                                <li>上传大小限制放宽至10MB</li>
                            </ul>
                            <li>用户注册/登录时间彻底修复</li>
                            <ul>
                                <li>重构用户信息存取为统一saveUserInfo函数</li>
                                <li>update失败时自动fallback到delete+insert</li>
                                <li>管理员登录同样正确记录登录时间</li>
                                <li>后台帖子计数排除用户信息记录</li>
                            </ul>
                            <li>数据库RLS策略完善</li>
                            <ul>
                                <li>新增fix_user_info_rls.sql确保UPDATE/DELETE策略存在</li>
                                <li>扩大actor_key和content长度限制</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.14',
                    date: '2026-05-02 16:20',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>头像上传导致的连锁问题修复</li>
                            <ul>
                                <li>修复上传头像后帖子页一直显示"加载失败，刷新重试"的严重bug</li>
                                <li>修复头像base64数据撑爆localStorage导致页面崩溃</li>
                                <li>修复"我的页面"头像不显示的问题</li>
                                <li>修复退出登录后旧缓存干扰的问题</li>
                                <li>优化数据查询，排除头像记录减少响应体积</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.13',
                    date: '2026-05-02 14:58',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>头像功能修复</li>
                            <ul>
                                <li>修复头像上传后作为帖子显示的问题</li>
                                <li>修复刷新页面后头像消失的问题</li>
                                <li>头像上传成功后自动刷新feed显示新头像</li>
                                <li>更新头像缓存机制，确保头像正确显示</li>
                            </ul>
                            <li>性能优化</li>
                            <ul>
                                <li>优化帖子渲染性能，预构建评论和点赞映射表</li>
                                <li>提升整体流畅度，减少卡顿</li>
                            </ul>
                            <li>公告系统优化</li>
                            <ul>
                                <li>修复公告发布区域固定不动的问题，现在会随内容滚动</li>
                            </ul>
                            <li>后台管理优化</li>
                            <ul>
                                <li>修复用户注册和登录时间保存问题，添加actor_key确保数据正确写入</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.12',
                    date: '2026-05-02 01:00',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>新增消息通知功能</li>
                            <ul>
                                <li>收到新消息时顶部弹出液态玻璃风格通知</li>
                                <li>显示发送者头像、用户名和消息内容</li>
                                <li>通知3秒后自动淡出收回</li>
                                <li>点击通知直接跳转到对应聊天对话</li>
                                <li>智能判断：已在聊天时不重复弹出</li>
                            </ul>
                            <li>后台管理功能修复</li>
                            <ul>
                                <li>修复新注册用户（无发帖记录）不显示的问题</li>
                                <li>确保所有注册用户都能在后台正确展示</li>
                            </ul>
                            <li>统计页面优化</li>
                            <ul>
                                <li>修复评论记录时间排序问题</li>
                                <li>最新评论现在显示在最上方</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.11',
                    date: '2026-05-02',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>个人资料系统全面升级</li>
                            <ul>
                                <li>新增个人资料详情页（大头像、用户名、用户ID、注册时间）</li>
                                <li>支持自定义头像上传（最大5MB）</li>
                                <li>帖子和评论区域显示用户自定义头像</li>
                                <li>个人资料页新增退出登录按钮</li>
                            </ul>
                            <li>游客模式完善</li>
                            <ul>
                                <li>未登录用户只能查看，不能发布/点赞/评论</li>
                                <li>未登录时发布区域自动隐藏</li>
                                <li>点击操作时自动提示登录</li>
                            </ul>
                            <li>公告系统修复</li>
                            <ul>
                                <li>修复公告详情页面内容不显示的问题</li>
                            </ul>
                            <li>后台管理功能增强</li>
                            <ul>
                                <li>新增用户注册时间和最近登录时间显示</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.10',
                    date: '2026-05-02',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>新增「我的」页面</li>
                            <ul>
                                <li>深色/浅色模式切换开关</li>
                                <li>语言切换功能</li>
                                <li>通知设置选项</li>
                                <li>关于应用信息</li>
                                <li>统一白色磨砂风格设计</li>
                            </ul>
                            <li>「我的」按钮动画优化</li>
                            <ul>
                                <li>点击按钮时显示5条彩色光波从小人脑袋上方散射的动画</li>
                            </ul>
                            <li>底部导航栏整体优化</li>
                            <ul>
                                <li>AI花朵按钮点击范围对齐</li>
                                <li>四按钮大小统一规范</li>
                                <li>视觉平衡度提升</li>
                            </ul>
                            <li>AI页面动画升级</li>
                            <ul>
                                <li>花朵动画改为逐瓣飞散效果（与导航栏按钮保持一致）</li>
                                <li>闪电切换按钮改为SVG图标，视觉更精致</li>
                                <li>动画过渡更流畅自然</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.9',
                    date: '2026-05-02',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>公告系统功能增强</li>
                            <ul>
                                <li>管理员发布公告时可选择输入标题和内容（不强制，至少填写一项）</li>
                                <li>用户查看公告列表时展示公告标题</li>
                                <li>公告详情页新增发布者信息展示（头像 + 用户名）</li>
                                <li>管理后台公告列表新增标题、发布者列显示</li>
                                <li>管理后台新增标题输入框</li>
                                <li>适配深色/浅色主题</li>
                                <li>保持原有白色磨砂风格统一</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.8',
                    date: '2026-05-02',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>公告系统视觉与交互优化</li>
                            <ul>
                                <li>公告模态框改为与总动态总浏览完全一致的白色磨砂风格</li>
                                <li>公告列表项样式统一为白色磨砂效果</li>
                                <li>完全移除公告内容区域的滚动条</li>
                                <li>禁止公告区域横向拖拽滚动</li>
                                <li>公告详情头部优化布局，修复删除按钮位置</li>
                            </ul>
                            <li>聊天与AI区域视觉统一</li>
                            <ul>
                                <li>聊天输入区域背景改为透明，与背景色一致</li>
                                <li>AI容器背景完全透明化</li>
                                <li>AI输入框、模式切换按钮、AI气泡统一为磨砂风格</li>
                                <li>优化AI消息气泡与思考过程卡片样式</li>
                            </ul>
                            <li>深色/浅色主题全面适配</li>
                            <ul>
                                <li>公告系统深色模式完全对齐总动态风格</li>
                                <li>所有元素支持主题自动切换</li>
                            </ul>
                            <li>性能与流畅度优化</li>
                            <ul>
                                <li>优化公告列表动画效果</li>
                                <li>添加will-change属性提升渲染性能</li>
                                <li>优化事件处理逻辑</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.7',
                    date: '2026-05-02',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>新增公告通知系统</li>
                            <ul>
                                <li>公告铃铛按钮（登录后可见）</li>
                                <li>未读公告计数提示</li>
                                <li>公告详情查看与列表返回功能</li>
                                <li>公告发布与删除管理权限</li>
                            </ul>
                            <li>新增独立管理后台页面</li>
                            <ul>
                                <li>多维度数据管理面板</li>
                                <li>公告发布管理</li>
                                <li>用户及内容数据查看</li>
                                <li>响应式设计适配</li>
                            </ul>
                            <li>公告数据与主应用完全互通</li>
                            <li>优化交互过渡动画提升流畅度</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>优化顶部导航栏交互</li>
                            <ul>
                                <li>去除重复聊天入口</li>
                                <li>优化底部 Dock 栏点击区域，允许框外区域交互</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.5',
                    date: '2026-04-30',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>三大核心功能按钮SVG动画优化</li>
                            <ul>
                                <li>重新设计帖子按钮钢笔绘制动画</li>
                                <li>重新设计聊天按钮气泡动画</li>
                                <li>AI按钮更换为花朵绽放与花瓣归位动画</li>
                                <li>所有动画支持按钮外区域显示</li>
                                <li>严格使用CSS @keyframes实现</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.4',
                    date: '2026-04-29',
                    content: `
                        <h4>更新内容</h4>
                        <ul>
                            <li>三大核心功能按钮全新SVG动画实现</li>
                            <ul>
                                <li>帖子按钮钢笔路径绘制（1.5秒）</li>
                                <li>聊天按钮打字点与气泡动画（2秒）</li>
                                <li>AI按钮脉冲发光效果（1.8秒）</li>
                                <li>使用stroke-dasharray/dashoffset技术</li>
                                <li>纯CSS实现，无定时器依赖</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.3',
                    date: '2026-04-28',
                    content: `
                        <h4>初始版本</h4>
                        <ul>
                            <li>基础功能框架搭建</li>
                            <li>用户认证系统</li>
                            <li>帖子发布与浏览</li>
                            <li>评论与点赞功能</li>
                            <li>私信聊天系统</li>
                            <li>AI对话功能</li>
                            <li>深色/浅色主题切换</li>
                        </ul>
                    `
                }
            ];
            let currentAnnouncementTab = 'announcements';
            function switchAnnouncementTab(tab) {
                currentAnnouncementTab = tab;
                const tabs = document.querySelectorAll('.announcement-tab');
                tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
                const listContainer = document.getElementById('announcementListContainer');
                const detailContainer = document.getElementById('announcementDetail');
                const changelogContainer = document.getElementById('changelogContainer');
                const adminArea = document.getElementById('announcementAdminArea');
                if (tab === 'announcements') {
                    listContainer.style.display = 'block';
                    detailContainer.style.display = 'none';
                    changelogContainer.style.display = 'none';
                    if (isAdmin()) adminArea.style.display = 'block';
                } else {
                    listContainer.style.display = 'none';
                    detailContainer.style.display = 'none';
                    changelogContainer.style.display = 'block';
                    adminArea.style.display = 'none';
                    renderChangelogList();
                }
            }
            function renderChangelogList() {
                const listEl = document.getElementById('changelogList');
                if (!listEl) return;
                listEl.innerHTML = '';
                changelogData.forEach((item, index) => {
                    const div = document.createElement('div');
                    div.className = 'changelog-item';
                    div.innerHTML = `
                        <div class="changelog-header">
                            <div class="changelog-version">🚀 ${item.version}</div>
                            <div class="changelog-date">${item.date}</div>
                        </div>
                        <div class="changelog-content">
                            ${item.content}
                        </div>
                    `;
                    listEl.appendChild(div);
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            div.style.opacity = '1';
                            div.style.transform = 'translateY(0)';
                        }, index * 80);
                    });
                });
            }
            // 绑定切换事件
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 修改原有的 showAnnouncementList 以支持当前标签状态
            const originalShowAnnouncementList = showAnnouncementList;
            window.showAnnouncementList = function() {
                if (currentAnnouncementTab !== 'announcements') {
                    switchAnnouncementTab('announcements');
                }
                originalShowAnnouncementList();
            };

            // 绑定公告按钮事件
            const annBtn = document.getElementById('announcementBtn');
            if (annBtn) {
                annBtn.addEventListener('click', function() {
                    currentAnnouncementTab = 'announcements';
                    document.querySelectorAll('.announcement-tab').forEach(t => 
                        t.classList.toggle('active', t.dataset.tab === 'announcements')
                    );
                    document.getElementById('announcementListContainer').style.display = 'block';
                    document.getElementById('announcementDetail').style.display = 'none';
                    document.getElementById('changelogContainer').style.display = 'none';
                    openAnnouncementModal();
                });
            }
        })();