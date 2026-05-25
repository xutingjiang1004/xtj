(function() {
    var avatarCache = {};
    window.avatarCache = avatarCache;

    async function hashPassword(password) {
        var encoder = new TextEncoder();
        var data = encoder.encode(password);
        var hashBuffer = await crypto.subtle.digest('SHA-256', data);
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function findAuthRecord(nickname) {
        var sb = window.sb;
        var result = await sb.from("posts").select("id, user_name, media_url").eq("user_name", nickname).eq("media_type", "__auth__").maybeSingle();
        return result.data;
    }

    async function saveUserInfo(name, isNewUser) {
        try {
            var sb = window.sb;
            var regTime = null;
            try {
                var authRes = await sb.from("posts").select("created_at").eq("user_name", name).eq("media_type", "__auth__").maybeSingle();
                if (authRes.data && authRes.data.created_at) regTime = authRes.data.created_at;
            } catch(e) {}
            if (!regTime) {
                try {
                    var existing = await sb.from("posts").select("content, id").eq("user_name", name).eq("media_type", "__user_info__").order("created_at", { ascending: false }).limit(1);
                    if (existing.data && existing.data.length > 0) {
                        try { var parsed = JSON.parse(existing.data[0].content); if (parsed.reg_time) regTime = parsed.reg_time; } catch(e) {}
                    }
                } catch(e) {}
            }
            if (!regTime && isNewUser) regTime = new Date().toISOString();
            var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
            var contentStr = JSON.stringify(userInfo);
            var updated = false;
            try {
                var latest = await sb.from("posts").select("id").eq("user_name", name).eq("media_type", "__user_info__").order("created_at", { ascending: false }).limit(1);
                if (latest.data && latest.data.length > 0) {
                    var updRes = await sb.from("posts").update({ content: contentStr }).eq("id", latest.data[0].id);
                    if (!updRes.error) updated = true;
                }
            } catch(e) {}
            if (!updated) {
                await sb.from("posts").insert([{ user_name: name, content: contentStr, media_type: "__user_info__", actor_key: "__user_info__" }]);
            }
        } catch(e) {
            console.error("saveUserInfo失败:", e);
        }
    }

    window.openAuthModal = function(mode) {
        var id = mode === 'login' ? 'loginModal' : 'registerModal';
        document.getElementById(id).classList.add('active');
        setTimeout(function() {
            var inp = document.getElementById(mode === 'login' ? 'loginNickInp' : 'regNickInp');
            if (inp) inp.focus();
        }, 200);
    };

    async function doLogin() {
        var name = document.getElementById("loginNickInp").value.trim();
        var pw = document.getElementById("loginPwInp").value;
        if (!name) { window.showToast("请输入昵称"); return; }
        if (!pw) { window.showToast("请输入密码"); return; }
        var btn = document.getElementById("loginSubmitBtn");
        btn.disabled = true; btn.textContent = "验证中...";
        try {
            if (name === window.ADMIN_NAME) {
                if (pw !== "xxz123") { window.showToast("密码错误"); btn.disabled = false; btn.textContent = "登录"; return; }
            } else {
                var authRec = await findAuthRecord(name);
                if (!authRec) { window.showToast("账号不存在，请先注册"); btn.disabled = false; btn.textContent = "登录"; return; }
                var inputHash = await hashPassword(pw);
                if (inputHash !== authRec.media_url) { window.showToast("密码错误"); btn.disabled = false; btn.textContent = "登录"; return; }
            }
            window.currentUser = name;
            localStorage.setItem("xtj_user", window.currentUser);
            window.showToast("登录成功，欢迎回来 " + name);
            window.closeModal('loginModal');
            await saveUserInfo(name, false);
            await window.initUI();
            window.initialLoad(true);
        } catch(e) {
            console.error(e);
            window.showToast("登录失败，请重试");
        } finally {
            btn.disabled = false; btn.textContent = "登录";
        }
    }
    window.doLogin = doLogin;

    async function doRegister() {
        var name = document.getElementById("regNickInp").value.trim();
        var pw = document.getElementById("regPwInp").value;
        if (!name) { window.showToast("请输入昵称"); return; }
        if (!pw) { window.showToast("请输入密码"); return; }
        if (pw.length < 3) { window.showToast("密码至少3位"); return; }
        var btn = document.getElementById("registerSubmitBtn");
        btn.disabled = true; btn.textContent = "注册中...";
        try {
            var existing = await findAuthRecord(name);
            if (existing) { window.showToast("昵称 '" + name + "' 已被注册，请换一个"); btn.disabled = false; btn.textContent = "注册"; return; }
            var pwHash = await hashPassword(pw);
            var sb = window.sb;
            var result = await sb.from("posts").insert([{ user_name: name, content: "__auth__", media_url: pwHash, media_type: "__auth__", actor_key: "__auth__" }]);
            if (result.error) { window.showToast("注册失败：" + result.error.message); btn.disabled = false; btn.textContent = "注册"; return; }
            window.currentUser = name;
            localStorage.setItem("xtj_user", window.currentUser);
            window.showToast("注册成功，欢迎 " + name);
            window.closeModal('registerModal');
            await saveUserInfo(name, true);
            await window.initUI();
            window.initialLoad(true);
        } catch(e) {
            console.error(e);
            window.showToast("注册失败，请重试");
        } finally {
            btn.disabled = false; btn.textContent = "注册";
        }
    }

    var upcTargetUser = null;

    window.openUserProfile = async function(userName) {
        upcTargetUser = userName;
        document.getElementById('upcName').textContent = userName;
        document.getElementById('upcLogin').textContent = '最近登录：加载中...';
        var avatarEl = document.getElementById('upcAvatar');
        var showAvatar = avatarCache[userName];
        if (!showAvatar && userName === window.currentUser) {
            try {
                var ca = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
                if (ca[window.currentUser]) { showAvatar = ca[window.currentUser]; avatarCache[window.currentUser] = ca[window.currentUser]; }
            } catch(e) {}
        }
        if (showAvatar) {
            avatarEl.innerHTML = '<img src="' + showAvatar + '" alt="头像">';
        } else {
            avatarEl.innerHTML = '<span id="upcAvatarText">' + userName[0].toUpperCase() + '</span>';
        }
        var msgBtn = document.getElementById('upcMsgBtn');
        if (userName === window.currentUser) { msgBtn.textContent = '这是你自己'; msgBtn.disabled = true; msgBtn.style.opacity = '0.5'; }
        else if (!window.currentUser) { msgBtn.textContent = '请先登录再发消息'; msgBtn.disabled = true; msgBtn.style.opacity = '0.5'; }
        else { msgBtn.textContent = '💬 发消息'; msgBtn.disabled = false; msgBtn.style.opacity = '1'; }
        window.openModal('userProfileModal');
        try {
            if (userName === window.currentUser) {
                try { var cv = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {}); if (cv[window.currentUser]) { avatarCache[window.currentUser] = cv[window.currentUser]; if (document.getElementById('userProfileModal').classList.contains('active')) avatarEl.innerHTML = '<img src="' + cv[window.currentUser] + '" alt="头像">'; } } catch(e) {}
            }
            var sb = window.sb;
            var avatarRes = await sb.from("posts").select("media_url").eq("user_name", userName).eq("media_type", "__avatar__").eq("actor_key", "__avatar__").order("created_at", { ascending: false }).limit(1);
            if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                if (userName !== window.currentUser) avatarCache[userName] = avatarRes.data[0].media_url;
                else if (!avatarCache[window.currentUser]) avatarCache[window.currentUser] = avatarRes.data[0].media_url;
                if (document.getElementById('userProfileModal').classList.contains('active')) {
                    var url = (userName === window.currentUser && avatarCache[window.currentUser]) ? avatarCache[window.currentUser] : avatarRes.data[0].media_url;
                    avatarEl.innerHTML = '<img src="' + url + '" alt="头像">';
                }
            }
            var userInfoRes = await sb.from("posts").select("content").eq("user_name", userName).eq("media_type", "__user_info__").order("created_at", { ascending: false }).limit(1);
            if (userInfoRes.data && userInfoRes.data.length > 0) {
                try {
                    var info = JSON.parse(userInfoRes.data[0].content);
                    document.getElementById('upcLogin').textContent = '最近登录：' + (info.last_login ? new Date(info.last_login).toLocaleString() : '-');
                } catch(e) { document.getElementById('upcLogin').textContent = '最近登录：-'; }
            } else { document.getElementById('upcLogin').textContent = '最近登录：-'; }
        } catch(e) { document.getElementById('upcLogin').textContent = '最近登录：加载失败'; }
    };

    window.upcSendMessage = function() {
        if (!upcTargetUser || !window.currentUser) return;
        window.closeModal('userProfileModal');
        setTimeout(function() { window.openChat(upcTargetUser); }, 300);
    };

    window.openProfileDetail = async function() {
        if (!window.currentUser) { window.openAuthModal('login'); return; }
        document.getElementById('profileDetailName').textContent = window.currentUser;
        document.getElementById('profileDetailId').textContent = window.currentUser;
        try {
            var sb = window.sb;
            var userInfoRes = await sb.from("posts").select("content").eq("user_name", window.currentUser).eq("media_type", "__user_info__").order("created_at", { ascending: false }).limit(1);
            if (userInfoRes.data && userInfoRes.data.length > 0) {
                try { var ui = JSON.parse(userInfoRes.data[0].content); document.getElementById('profileDetailRegTime').textContent = ui.reg_time ? new Date(ui.reg_time).toLocaleString() : '-'; } catch(e) { document.getElementById('profileDetailRegTime').textContent = '-'; }
            } else { document.getElementById('profileDetailRegTime').textContent = '-'; }
        } catch(e) { console.error("获取用户信息失败:", e); document.getElementById('profileDetailRegTime').textContent = '-'; }
        loadProfileAvatar();
        window.openModal('profileDetailModal');
    };

    async function loadProfileAvatar() {
        var avatarEl = document.getElementById('profileDetailAvatar');
        try {
            var ca = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
            if (ca[window.currentUser]) { avatarCache[window.currentUser] = ca[window.currentUser]; avatarEl.innerHTML = '<img src="' + ca[window.currentUser] + '" alt="头像">'; return; }
        } catch(e) {}
        if (avatarCache[window.currentUser]) avatarEl.innerHTML = '<img src="' + avatarCache[window.currentUser] + '" alt="头像">';
        try {
            var sb = window.sb;
            var avatarRes = await sb.from("posts").select("media_url").eq("user_name", window.currentUser).eq("media_type", "__avatar__").eq("actor_key", "__avatar__").order("created_at", { ascending: false }).limit(1);
            if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                avatarEl.innerHTML = '<img src="' + avatarRes.data[0].media_url + '" alt="头像">';
                avatarCache[window.currentUser] = avatarRes.data[0].media_url;
                try { var cv = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {}); cv[window.currentUser] = avatarRes.data[0].media_url; localStorage.setItem(window.AVATAR_CACHE_KEY, JSON.stringify(cv)); } catch(e) {}
            } else if (!avatarCache[window.currentUser]) {
                avatarEl.innerHTML = '<span id="profileDetailAvatarText">' + (window.currentUser ? window.currentUser[0].toUpperCase() : '?') + '</span>';
            }
        } catch(e) { console.error("加载头像失败:", e); }
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
                if (window.createImageBitmap) {
                    createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }).then(function(bitmap) {
                        var canvas = document.createElement('canvas');
                        canvas.width = bitmap.width; canvas.height = bitmap.height;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(bitmap, 0, 0);
                        bitmap.close();
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    }).catch(function() { fallbackCompress(img, w, h, quality, resolve); });
                } else { fallbackCompress(img, w, h, quality, resolve); }
            };
            img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
            img.src = url;
        });
    }
    function fallbackCompress(img, w, h, quality, resolve) {
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
    }
    window.compressImage = compressImage;

    window.triggerAvatarUpload = function() { document.getElementById('avatarUploadInput').click(); };

    window.handleAvatarUpload = async function(event) {
        var file = event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { window.showToast('请选择图片文件'); return; }
        if (file.size > 10 * 1024 * 1024) { window.showToast('图片大小不能超过10MB'); return; }
        window.showToast('正在压缩并上传头像...');
        try {
            var sb = window.sb;
            var timestamp = Date.now();
            var random = Math.floor(Math.random() * 1000);
            var path = 'avatars/' + timestamp + '_' + random + '_' + file.name;
            await sb.storage.from('uploads').upload(path, file);
            var avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
            var oldIds = await sb.from("posts").select("id").eq("user_name", window.currentUser).eq("media_type", "__avatar__").eq("actor_key", "__avatar__");
            if (oldIds.data && oldIds.data.length > 0) {
                for (var oi of oldIds.data) {
                    try { await sb.rpc('delete_post_with_actor', { p_post_id: oi.id, p_actor_key: '__avatar__' }); } catch(e) {}
                }
            }
            await sb.from("posts").insert([{ user_name: window.currentUser, content: "用户头像", media_url: avatarUrl, media_type: "__avatar__", actor_key: "__avatar__" }]);
            avatarCache[window.currentUser] = avatarUrl;
            try { var ca = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {}); ca[window.currentUser] = avatarUrl; localStorage.setItem(window.AVATAR_CACHE_KEY, JSON.stringify(ca)); } catch(e) {}
            updateAllAvatarElements(avatarUrl);
            window.showToast('头像更新成功');
            localStorage.removeItem(window.CACHE_KEY);
            window.loadFeed(true);
            avatarCache[window.currentUser] = avatarUrl;
            updateAllAvatarElements(avatarUrl);
        } catch(e) { console.error("上传头像失败:", e); window.showToast('上传失败，请重试'); }
        event.target.value = '';
    };

    function updateAllAvatarElements(avatarUrl) {
        var els = [document.getElementById('profileAvatar'), document.getElementById('myAvatar'), document.getElementById('profileDetailAvatar'), document.getElementById('upcAvatar')];
        els.forEach(function(el) {
            if (el) el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        });
        document.querySelectorAll('#feed .post .avatar').forEach(function(el) {
            var header = el.closest('.post-header');
            if (header) {
                var nameEl = header.querySelector('.user-name');
                if (nameEl && nameEl.textContent === window.currentUser) el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            }
        });
        document.querySelectorAll('#dockChatMessages .chat-msg-avatar').forEach(function(el) {
            if (el.closest('.chat-msg-row.sent')) el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        });
        document.querySelectorAll('#dockChatList .chat-list-item').forEach(function(el) {
            var nameEl = el.querySelector('.cli-name');
            if (nameEl && nameEl.textContent === window.currentUser) {
                var avEl = el.querySelector('.cli-avatar');
                if (avEl) avEl.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            }
        });
    }

    async function updateAllAvatars() {
        try {
            var ca = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
            if (ca[window.currentUser]) {
                avatarCache[window.currentUser] = ca[window.currentUser];
                var pa = document.getElementById('profileAvatar');
                if (pa) pa.innerHTML = '<img src="' + ca[window.currentUser] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                return;
            }
        } catch(e) {}
        try {
            var sb = window.sb;
            var avatarRes = await sb.from("posts").select("media_url").eq("user_name", window.currentUser).eq("media_type", "__avatar__").eq("actor_key", "__avatar__").order("created_at", { ascending: false }).limit(1);
            var pa = document.getElementById('profileAvatar');
            if (pa) {
                if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                    pa.innerHTML = '<img src="' + avatarRes.data[0].media_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                    avatarCache[window.currentUser] = avatarRes.data[0].media_url;
                    try { var cv = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {}); cv[window.currentUser] = avatarRes.data[0].media_url; localStorage.setItem(window.AVATAR_CACHE_KEY, JSON.stringify(cv)); } catch(e) {}
                } else { pa.innerHTML = window.currentUser ? window.currentUser[0].toUpperCase() : '?'; }
            }
        } catch(e) { console.error("更新头像显示失败:", e); }
    }

    window.doLogoutFromProfile = function() {
        window.closeModal('profileDetailModal');
        doLogout();
    };

    window.doLogout = async function() {
        window.currentUser = "";
        localStorage.removeItem("xtj_user");
        localStorage.removeItem(window.CACHE_KEY);
        document.getElementById("loginNickInp").value = "";
        document.getElementById("loginPwInp").value = "";
        document.getElementById("regNickInp").value = "";
        document.getElementById("regPwInp").value = "";
        if (window.chatRealtime) { var sb = window.sb; sb.removeChannel(window.chatRealtime); window.chatRealtime = null; }
        if (window.annRealtime) { var sb2 = window.sb; sb2.removeChannel(window.annRealtime); window.annRealtime = null; }
        window.stopDMPolling();
        window._chatCache = {};
        window.dockChatListCacheTime = 0;
        document.body.style.overflow = '';
        Object.keys(avatarCache).forEach(function(k) { delete avatarCache[k]; });
        window.showToast("已退出登录");
        await window.initUI();
        window.initialLoad(true);
    };

    window.handleProfileCardClick = function() {
        if (window.currentUser) { window.openProfileDetail(); }
        else { window.openAuthModal('login'); }
    };

    window.initUI = async function() {
        var unauthUI = document.getElementById("unauthUI");
        var authUI = document.getElementById("authUI");
        var annBtnWrapper = document.getElementById("announcement-btn-wrapper");
        var profileName = document.getElementById("profileName");
        var profileStatus = document.getElementById("profileStatus");
        var publishBox = document.getElementById("publishBox");
        if (window.currentUser) {
            unauthUI.style.display = "none";
            authUI.style.display = "flex";
            annBtnWrapper.style.display = "block";
            document.getElementById("myName").textContent = window.currentUser;
            var avatar = document.getElementById("myAvatar");
            avatar.textContent = window.currentUser[0].toUpperCase();
            avatar.className = "avatar";
            profileName.textContent = window.currentUser;
            profileStatus.textContent = "查看资料";
            if (publishBox) publishBox.style.display = "block";
            loadUserAvatar();
            await saveUserInfo(window.currentUser, false);
            try { window.subscribeToMessages(); window.startDMPolling(); window.updateUnreadBadge(); window.loadAnnouncements(); window.subscribeToAnnouncements(); } catch(e) {}
        } else {
            unauthUI.style.display = "flex";
            authUI.style.display = "none";
            annBtnWrapper.style.display = "none";
            profileName.textContent = "未登录";
            profileStatus.textContent = "点击登录";
            if (publishBox) publishBox.style.display = "none";
            var profileAvatar = document.getElementById('profileAvatar');
            if (profileAvatar) profileAvatar.innerHTML = '?';
            try { window.stopDMPolling(); } catch(e) {}
        }
    };

    async function loadUserAvatar() {
        try {
            var ca = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
            if (ca[window.currentUser]) {
                avatarCache[window.currentUser] = ca[window.currentUser];
                updateAllAvatarElements(ca[window.currentUser]);
            } else {
                var sb = window.sb;
                var avatarRes = await sb.from("posts").select("media_url").eq("user_name", window.currentUser).eq("media_type", "__avatar__").eq("actor_key", "__avatar__").order("created_at", { ascending: false }).limit(1);
                if (avatarRes.data && avatarRes.data.length > 0 && avatarRes.data[0].media_url) {
                    try { ca[window.currentUser] = avatarRes.data[0].media_url; localStorage.setItem(window.AVATAR_CACHE_KEY, JSON.stringify(ca)); } catch(e) {}
                    updateAllAvatarElements(avatarRes.data[0].media_url);
                } else {
                    var pa = document.getElementById('profileAvatar');
                    var ma = document.getElementById('myAvatar');
                    if (pa) pa.innerHTML = window.currentUser ? window.currentUser[0].toUpperCase() : '?';
                    if (ma) ma.innerHTML = window.currentUser ? window.currentUser[0].toUpperCase() : '?';
                }
            }
        } catch(e) { console.error("加载头像失败:", e); }
    }

    document.getElementById('loginSubmitBtn').addEventListener('click', doLogin);
    document.getElementById('loginPwInp').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
    document.getElementById('loginNickInp').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('loginPwInp').focus(); });
    document.getElementById('registerSubmitBtn').addEventListener('click', doRegister);
    document.getElementById('regPwInp').addEventListener('keydown', function(e) { if (e.key === 'Enter') doRegister(); });
    document.getElementById('regNickInp').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('regPwInp').focus(); });
})();