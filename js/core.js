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
        window.deviceId = deviceId;

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
        const CACHE_KEY = "xtj_feed_cache_v2";
        const CACHE_DURATION = 5 * 60 * 1000; // 缓存5分钟

        const POST_METADATA_MARKER = "__xtj_post_v2__";
        const POST_META_DEFAULTS = {
            visibility: "public",
            is_pinned: false,
            pinned_at: null,
            updated_at: null
        };
        let postSearchState = {
            keyword: "",
            user: "",
            startDate: "",
            endDate: "",
            visibility: "all",
            onlyMine: false
        };
        let editPostId = null;

        function isAdmin() { return currentUser === ADMIN_NAME; }

        function clearFeedCache() {
            try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
        }
        window.clearFeedCache = clearFeedCache;

        function parsePostContent(post) {
            var raw = post && typeof post.content === "string" ? post.content : "";
            if (!raw) return { text: "", meta: {} };
            try {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && parsed.__type === POST_METADATA_MARKER) {
                    return {
                        text: typeof parsed.text === "string" ? parsed.text : "",
                        meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {}
                    };
                }
            } catch (e) {}
            return { text: raw, meta: {} };
        }
        window.parsePostContent = parsePostContent;

        function buildPostContentPayload(text, meta) {
            return JSON.stringify({
                __type: POST_METADATA_MARKER,
                text: text || "",
                meta: Object.assign({}, POST_META_DEFAULTS, meta || {})
            });
        }

        function normalizePost(post) {
            var parsed = parsePostContent(post || {});
            var meta = Object.assign({}, POST_META_DEFAULTS, parsed.meta || {});
            return Object.assign({}, post, {
                content: parsed.text || "",
                visibility: post && post.visibility ? post.visibility : (meta.visibility || "public"),
                is_pinned: post ? !!post.is_pinned : !!meta.is_pinned,
                pinned_at: post && post.pinned_at ? post.pinned_at : (meta.pinned_at || null),
                updated_at: post && post.updated_at ? post.updated_at : (meta.updated_at || null),
                _contentMeta: meta
            });
        }
        window.normalizePost = normalizePost;

        function getPostDisplayContent(post) {
            return normalizePost(post).content || "";
        }
        window.getPostDisplayContent = getPostDisplayContent;

        function canViewPost(post) {
            var p = normalizePost(post);
            if (p.visibility === "private") {
                return !!window.currentUser && p.user_name === window.currentUser;
            }
            return true;
        }
        window.canViewPost = canViewPost;

        function canEditPost(post) {
            var p = normalizePost(post);
            return !!currentUser && (p.user_name === currentUser || isAdmin());
        }
        window.canEditPost = canEditPost;

        function canPinPost(post) {
            return canEditPost(post);
        }
        window.canPinPost = canPinPost;

        function normalizePosts(posts) {
            return (posts || []).map(normalizePost);
        }

        function sortPosts(posts) {
            return posts.slice().sort(function(a, b) {
                var pa = normalizePost(a);
                var pb = normalizePost(b);
                if (!!pa.is_pinned !== !!pb.is_pinned) return pa.is_pinned ? -1 : 1;
                if (pa.is_pinned && pb.is_pinned) return new Date(pb.pinned_at || pb.created_at || 0) - new Date(pa.pinned_at || pa.created_at || 0);
                return new Date(pb.created_at || 0) - new Date(pa.created_at || 0);
            });
        }
        window.sortPosts = sortPosts;

        function toLocalDateKey(dateLike) {
            if (!dateLike) return "";
            var d = new Date(dateLike);
            if (isNaN(d.getTime())) return "";
            var y = d.getFullYear();
            var m = String(d.getMonth() + 1).padStart(2, "0");
            var day = String(d.getDate()).padStart(2, "0");
            return y + "-" + m + "-" + day;
        }

        function isPostInDateRange(post, startDate, endDate) {
            var key = toLocalDateKey(post && post.created_at);
            if (!key) return false;
            if (startDate && key < startDate) return false;
            if (endDate && key > endDate) return false;
            return true;
        }
        window.isPostInDateRange = isPostInDateRange;

        function getPostSearchState() {
            return Object.assign({}, postSearchState);
        }
        window.getPostSearchState = getPostSearchState;

        function getFilteredPosts(posts, comments) {
            var state = getPostSearchState();
            var keyword = (state.keyword || "").trim().toLowerCase();
            var userFilter = (state.user || "").trim().toLowerCase();
            var visibilityFilter = state.visibility || "all";
            var onlyMine = !!state.onlyMine;
            var matchedCommentPostIds = new Set();

            (comments || []).forEach(function(c) {
                if (!c) return;
                var commentContent = String(c.content || "").toLowerCase();
                var commentUser = String(c.user_name || "").toLowerCase();
                if (keyword && (commentContent.indexOf(keyword) >= 0 || commentUser.indexOf(keyword) >= 0)) {
                    matchedCommentPostIds.add(String(c.post_id));
                }
            });

            return sortPosts(normalizePosts(posts).filter(function(post) {
                if (!post) return false;
                if (post.media_type === AUTH_MARKER || post.media_type === DM_MARKER || post.media_type === "__avatar__" || post.media_type === "__user_info__" || post.media_type === "__photo_wall__" || post.media_type === "__ann__") return false;
                if (!post.user_name) return false;
                if (!canViewPost(post)) return false;
                if (onlyMine && (!currentUser || post.user_name !== currentUser)) return false;
                if (visibilityFilter !== "all" && post.visibility !== visibilityFilter) return false;
                if (userFilter && String(post.user_name || "").toLowerCase().indexOf(userFilter) < 0) return false;
                if ((state.startDate || state.endDate) && !isPostInDateRange(post, state.startDate, state.endDate)) return false;
                if (!keyword) return true;
                var postContent = String(post.content || "").toLowerCase();
                var postUser = String(post.user_name || "").toLowerCase();
                var dateText = toLocalDateKey(post.created_at);
                return postContent.indexOf(keyword) >= 0 ||
                    postUser.indexOf(keyword) >= 0 ||
                    dateText.indexOf(keyword) >= 0 ||
                    matchedCommentPostIds.has(String(post.id));
            }));
        }
        window.getFilteredPosts = getFilteredPosts;

        function renderFilterSummary(count) {
            var el = document.getElementById("postFilterSummary");
            if (!el) return;
            var state = getPostSearchState();
            var hasFilters = !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
            if (!hasFilters) {
                el.textContent = "全部帖子";
            } else if (!count) {
                el.textContent = "没找到相关帖子";
            } else {
                el.textContent = "找到 " + count + " 条结果";
            }
        }
        window.renderFilterSummary = renderFilterSummary;

        // ========== 鐘舵€佺鐞嗗懡鍚嶇┖闂达紙鍚戝悗鍏煎锛?==========
        window.appState = {
            get currentUser() { return window.currentUser; },
            set currentUser(v) { window.currentUser = v; },
            get photoWallData() { return window.photoWallData; },
            set photoWallData(v) { window.photoWallData = v; },
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
            
            // FLIP Animation: Step 1 - First (璁板綍鎸夐挳浣嶇疆)
            var origin = window._confirmOrigin;
            
            // FLIP Animation: Step 2 - Last (璁剧疆鏈€缁堢姸鎬?
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
            
            // FLIP Animation: Step 3 - Invert (璁＄畻宸紓骞跺弽鍚戝彉鎹?
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
            
            // FLIP Animation: Step 4 - Play (鎾斁鍔ㄧ敾)
            if (origin && dialog) {
                dialog.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out';
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
                    
                    // 鑾峰彇鍒犻櫎鎸夐挳褰撳墠浣嶇疆
                    var deleteBtn = document.getElementById('ppDeleteBtn');
                    var btnRect = deleteBtn ? deleteBtn.getBoundingClientRect() : null;
                    
                    var targetDx = o.dx;
                    var targetDy = o.dy;
                    var targetScale = o.scale || 0.3;
                    
                    if (btnRect) {
                        // 浣跨敤鎸夐挳褰撳墠浣嶇疆璁＄畻鐩爣鍙樻崲
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
                    
                    // Step 4 - Play: 鎾斁椋炲洖鍔ㄧ敾
                    dialog.style.transition = 'transform 0.3s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.2s ease-in';
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
                    }, 320);
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
                    dialog.style.transform = 'translate(' + o.dx + 'px, ' + o.dy + 'px) scale(' + (o.scale || 0.18) + ')';
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

            // ===================== 瀵嗙爜鍝堝笇 =====================
            async function hashPassword(password) {
                const encoder = new TextEncoder();
                const data = encoder.encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ===================== 登录 / 注册 / 退出 =====================
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

                    // 鍚庡锛氫粠鐜版湁 __user_info__ 涓鍙?reg_time锛堢敤limit(1)鑰岄潪maybeSingle锛屽閿欏琛岋級
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

                    // 鏈€鍚庡悗澶囷細鏂扮敤鎴风敤褰撳墠鏃堕棿
                    if (!regTime && isNewUser) {
                        regTime = new Date().toISOString();
                    }

                    var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
                    var contentStr = JSON.stringify(userInfo);

                    // 灏濊瘯鎵惧埌鏈€鏂颁竴鏉¤褰曞苟UPDATE锛堟瘮DELETE+INSERT鏇村彲闈狅紝閬垮厤RLS鎷掔粷DELETE锛?
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
                                console.log("saveUserInfo 鉁?" + name + " 登录鏃堕棿宸叉洿鏂?UPDATE): " + userInfo.last_login);
                            }
                        }
                    } catch(e) {}

                    // UPDATE澶辫触鎴栨棤璁板綍鏃讹紝INSERT涓€鏉℃柊璁板綍
                    if (!updated) {
                        var insertRes = await sb.from("posts").insert([{
                            user_name: name,
                            content: contentStr,
                            media_type: "__user_info__",
                            actor_key: "__user_info__"
                        }]);
                        if (insertRes.error) {
                            console.error("saveUserInfo insert澶辫触:", insertRes.error.message);
                        } else {
                            console.log("saveUserInfo 鉁?" + name + " 登录鏃堕棿宸叉洿鏂?INSERT): " + userInfo.last_login);
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
                if (!name) { showToast("璇疯緭鍏ユ樀绉"); return; }
                if (!pw) { showToast("璇疯緭鍏ュ瘑鐮"); return; }

                const btn = document.getElementById("loginSubmitBtn");
                btn.disabled = true;
                btn.textContent = "楠岃瘉涓?..";

                try {
                    if (name === ADMIN_NAME) {
                        if (pw !== "xxz123") {
                            showToast("瀵嗙爜閿欒");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                    } else {
                        const authRec = await findAuthRecord(name);
                        if (!authRec) {
                            showToast("璐﹀彿涓嶅瓨鍦紝璇峰厛注册");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                        const inputHash = await hashPassword(pw);
                        if (inputHash !== authRec.media_url) {
                            showToast("瀵嗙爜閿欒");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("登录鎴愬姛锛屾杩庡洖鏉?" + name);
                    closeModal('loginModal');
                    
                    // 鏇存柊鏈€杩戠櫥褰曟椂闂?
                    await saveUserInfo(name, false);
                    
                    await initUI();
                    initialLoad(true);
                } catch (e) {
                    console.error(e);
                    showToast("登录澶辫触锛岃閲嶈瘯");
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
                if (!name) { showToast("璇疯緭鍏ユ樀绉"); return; }
                if (!pw) { showToast("璇疯緭鍏ュ瘑鐮"); return; }
                if (pw.length < 3) { showToast("瀵嗙爜鑷冲皯3浣"); return; }

                const btn = document.getElementById("registerSubmitBtn");
                btn.disabled = true;
                btn.textContent = "注册涓?..";

                try {
                    const existing = await findAuthRecord(name);
                    if (existing) {
                        showToast("昵称 '" + name + "' 宸茶注册锛岃鎹竴涓");
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
                        showToast("注册失败: " + error.message);
                        btn.disabled = false; btn.textContent = "注册";
                        return;
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("注册鎴愬姛锛屾杩?" + name);
                    closeModal('registerModal');
                    
                    // 淇濆瓨鐢ㄦ埛注册淇℃伅
                    await saveUserInfo(name, true);
                    
                    await initUI();
                    initialLoad(true);
                } catch (e) {
                    console.error(e);
                    showToast("注册澶辫触锛岃閲嶈瘯");
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
                document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細鍔犺浇涓?..';
                
                var avatarEl = document.getElementById('upcAvatar');
                // localStorage鏉冨▉浼樺厛锛氬綋鍓嶇敤鎴峰厛妫€鏌ユ湰鍦扮紦瀛?
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
                    msgBtn.textContent = '杩欐槸浣犺嚜宸';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else if (!currentUser) {
                    msgBtn.textContent = '璇峰厛登录鍐嶅彂娑堟伅';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else {
                    msgBtn.textContent = '馃挰 鍙戞秷鎭';
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 寮傛鍔犺浇头像鍜岀櫥褰曟椂闂?
                try {
                    // 褰撳墠鐢ㄦ埛浼樺厛浣跨敤localStorage鏉冨▉缂撳瓨
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
                        // 闈炲綋鍓嶇敤鎴锋墠鐢―B鍊兼洿鏂扮紦瀛橈紙褰撳墠鐢ㄦ埛宸插湪涓婇潰鐢╨ocalStorage璁剧疆锛?
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
                                document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細' + new Date(info.last_login).toLocaleString();
                            } else {
                                document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細-';
                            }
                        } catch(e) {
                            document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細-';
                        }
                    } else {
                        document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細-';
                    }
                } catch(e) {
                    document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細鍔犺浇澶辫触';
                }
            };

            window.upcSendMessage = function() {
                if (!upcTargetUser || !currentUser) return;
                closeModal('userProfileModal');
                setTimeout(function() { openChat(upcTargetUser); }, 300);
            };

            // ========== 涓汉璧勬枡璇︽儏鍔熻兘 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 濉厖鍩烘湰淇℃伅
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
                
                // 鍔犺浇头像
                loadProfileAvatar();
                
                openModal('profileDetailModal');
            };

            async function loadProfileAvatar() {
                const avatarEl = document.getElementById('profileDetailAvatar');
                
                // localStorage鏉冨▉浼樺厛锛氬厛妫€鏌ユ湰鍦扮紦瀛?
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="头像">';
                        return;
                    }
                } catch(e) {}
                
                // 鍏堢敤鍐呭瓨缂撳瓨鏄剧ず
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
                        // 鍚屾鍒發ocalStorage
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            cv[currentUser] = avatarRes.data[0].media_url;
                            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cv));
                        } catch(e) {}
                    } else if (!avatarCache[currentUser]) {
                        avatarEl.innerHTML = '<span id="profileDetailAvatarText">' + (currentUser ? currentUser[0].toUpperCase() : '?') + '</span>';
                    }
                } catch(e) {
                    console.error("鍔犺浇头像澶辫触:", e);
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
                        // 浣跨敤 createImageBitmap 灏嗗浘鐗囪В鐮?缂╂斁鍑轰富绾跨▼
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
                    showToast('璇烽€夋嫨鍥剧墖鏂囦欢');
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('图片大小不能超过10MB');
                    return;
                }
                
                showToast('姝ｅ湪鍘嬬缉骞朵笂浼犲ご鍍?..');
                
                try {
                    // 浠诲姟2锛氶噸鏋勪负上传到 Supabase Storage 鐨?avatars/ 鐩綍
                    const timestamp = Date.now();
                    const random = Math.floor(Math.random() * 1000);
                    const path = `avatars/${timestamp}_${random}_${file.name}`;
                    
                    // 上传到 Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 鑾峰彇 Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 鍒犻櫎鎵€鏈夋棫头像璁板綍
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
                        content: "鐢ㄦ埛头像",
                        media_url: avatarUrl,
                        media_type: "__avatar__",
                        actor_key: "__avatar__"
                    }]);
                    
                    if (error) {
                        showToast('上传失败: ' + error.message);
                        return;
                    }
                    
                    avatarCache[currentUser] = avatarUrl;
                    // 淇濆瓨鍒發ocalStorage鎸佷箙鍖?
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        cachedAvatars[currentUser] = avatarUrl;
                        localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
                    } catch(e) {}
                    updateAllAvatarElements(avatarUrl);
                    
                    showToast('头像鏇存柊鎴愬姛');
                    localStorage.removeItem(CACHE_KEY);
                    await loadFeed(true);
                    avatarCache[currentUser] = avatarUrl;
                    updateAllAvatarElements(avatarUrl);
                } catch(e) {
                    console.error("涓婁紶头像澶辫触:", e);
                    showToast('涓婁紶澶辫触锛岃閲嶈瘯');
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
                // 鏇存柊鎴戠殑椤甸潰鐨勫ご鍍忥紙localStorage鏉冨▉浼樺厛锛?
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
                            // 鍚屾鍒發ocalStorage
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
                    console.error("鏇存柊头像鏄剧ず澶辫触:", e);
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
                showToast("宸查€€鍑虹櫥褰");
                await initUI();
                initialLoad(true);
            };

            // 澶勭悊鎴戠殑椤甸潰鐢ㄦ埛鍗＄墖鐐瑰嚮
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 宸茬櫥褰曪細鎵撳紑涓汉璧勬枡璇︽儏
                    openProfileDetail();
                } else {
                    // 鏈櫥褰曪細鎵撳紑登录/注册椤甸潰
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
                    
                    // 鏇存柊鎴戠殑椤甸潰鏄剧ず
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "查看资料";
                    
                    // 鏄剧ず鍙戝竷鍖哄煙
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 鍔犺浇头像
                    loadUserAvatar();
                    
                    // 鏇存柊鏈€杩戠櫥褰曟椂闂达紙椤甸潰姣忔鎵撳紑閮藉埛鏂帮紝蹇呴』await纭繚鍐欏叆锛?
                    await saveUserInfo(currentUser, false);
                    
                    try { subscribeToMessages(); startDMPolling(); updateUnreadBadge(); loadAnnouncements(); subscribeToAnnouncements(); } catch(e) {}
                } else {
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    // 鏇存柊鎴戠殑椤甸潰鏄剧ず锛堟湭登录锛?
                    profileName.textContent = "鏈櫥褰";
                    profileStatus.textContent = "点击登录";
                    
                    // 闅愯棌鍙戝竷鍖哄煙
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 閲嶇疆头像
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
                        // localStorage娌℃湁锛屽啀浠庢暟鎹簱鍔犺浇
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
                    console.error("鍔犺浇头像澶辫触:", e);
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

            // DEPRECATED_DO_NOT_EDIT ===================== [宸插簾寮僝 涓嬫柟绗?361琛屾湁鏇存柊鐗堟湰 =====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("璇峰厛登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("璇疯緭鍏ュ唴瀹"); return; }
                // 杈撳叆鏍￠獙锛氶檺鍒堕暱搴︺€佸幓闄ゅ嵄闄╁唴瀹?
                if (content.length > 2000) { showToast("鍐呭涓嶈兘瓒呰繃2000瀛"); return; }
                var btn = document.getElementById("pubBtn"); btn.disabled = true; btn.textContent = "鍙戝竷涓?..";
                try {
                    let media_url = "", media_type = "";
                    if (file) {
                        const path = `${Date.now()}_${file.name}`;
                        await sb.storage.from("uploads").upload(path, file);
                        media_url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                        media_type = file.type.startsWith("image") ? "image" : "video";
                    }
                    var { error: insertErr } = await sb.from("posts").insert([{ user_name: currentUser, content: safeText(content).slice(0, 2000), media_url, media_type, actor_key: deviceId }]);
                    if (insertErr) { showToast("鍙戝竷澶辫触: " + (insertErr.message || "鏈煡閿欒")); btn.disabled = false; btn.textContent = "鍙戝竷鍔ㄦ€"; return; }
                    document.getElementById("postInp").value = "";
                    document.getElementById("fileInp").value = "";
                    showToast("发布成功锛");
                    loadFeed(true);
                } catch (e) { showToast("鍙戝竷澶辫触: " + (e.message || "缃戠粶閿欒")); } finally { btn.disabled = false; btn.textContent = "鍙戝竷鍔ㄦ€"; }
            };

            // ===================== 鐐硅禐 =====================
            window.toggleLike = async function (btn, postId) {
                if (!currentUser) { showToast("璇峰厛登录"); return; }
                const isLiked = btn.classList.contains("liked");
                const statsText = btn.closest('.post').querySelector('.post-stats-text');

                if (isLiked) {
                    btn.classList.remove("liked");
                } else {
                    btn.classList.add("liked");
                    createHeartParticles(btn);
                }
                btn.textContent = isLiked ? "鐐硅禐" : "鉂わ笍";

                try {
                    if (isLiked) {
                        await sb.from("likes").delete().eq("post_id", postId).eq("actor_key", deviceId);
                    } else {
                        await sb.from("likes").insert([{ post_id: postId, user_name: currentUser, actor_key: deviceId }]);
                    }
                    const match = statsText.textContent.match(/鐐硅禐 (\d+)/);
                    if (match) {
                        const num = parseInt(match[1]);
                        statsText.innerHTML = statsText.innerHTML.replace(/鐐硅禐 \d+/, `鐐硅禐 ${isLiked ? num-1 : num+1}`);
                    }
                    updateFeedStats();
                    refreshStatModal();
                } catch (e) { console.error(e); }
            };

            function createHeartParticles(btn) {
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                const emojis = ["鉂わ笍","馃挄","馃挆","鉁","馃挅","馃挀"];
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

            // ===================== 璇勮 =====================
            window.openComment = function (postId) {
                if (!currentUser) { showToast("璇峰厛登录"); return; }
                activePostId = postId;
                document.getElementById("commInp").value = "";
                document.getElementById("commentModal").classList.add("active");
                setTimeout(() => document.getElementById("commInp").focus(), 100);
            };
            document.getElementById("commBtn").onclick = async () => {
                const content = document.getElementById("commInp").value.trim();
                if (!content) { showToast("璇疯緭鍏ヨ瘎璁哄唴瀹"); return; }
                const btn = document.getElementById("commBtn");
                btn.textContent = "鎻愪氦涓?..";
                btn.disabled = true;
                try {
                    const { error } = await sb.from("comments").insert([{ post_id: activePostId, user_name: currentUser, content, actor_key: deviceId }]);
                    if (error) throw error;
                    closeModal("commentModal");
                    showToast("璇勮鎴愬姛锛");
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
                    showToast("璇勮澶辫触: " + (e.message || "鏈煡閿欒"));
                    console.error(e);
                } finally {
                    btn.textContent = "鍙戝竷璇勮";
                    btn.disabled = false;
                }
            };

            // ===================== 鍒犻櫎甯栧瓙 =====================
            window.openDelete = function (postId, ownerKey) {
                delPostId = postId;
                delOwnerKey = ownerKey;
                document.getElementById("delModal").classList.add("active");
            };
            document.getElementById("delBtn").onclick = async () => {
                if (!delPostId) return;
                const btn = document.getElementById("delBtn");
                btn.disabled = true;
                btn.textContent = "鍒犻櫎涓?..";
                try {
                    const key = isAdmin() ? delOwnerKey : deviceId;
                    const { error } = await sb.rpc("delete_post_with_actor", {
                        p_post_id: delPostId,
                        p_actor_key: key
                    });
                    if (error) {
                        showToast("删除失败: " + error.message);
                        return;
                    }
                    closeModal("delModal");
                    showToast("甯栧瓙宸插垹闄");
                    delPostId = null;
                    await loadFeed(true);
                } catch (e) {
                    showToast("鍒犻櫎甯栧瓙澶辫触");
                    console.error(e);
                } finally {
                    btn.disabled = false;
                    btn.textContent = "纭鍒犻櫎";
                }
            };

            window.openModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.style.display = '';
                el.classList.add("active");
            };

            window.closeModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.classList.remove("active");
                if (id === 'statModal' && statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }
                if (id === 'editPostModal') {
                    editPostId = null;
                }
            };

            // ===================== 鍥剧墖鏌ョ湅鍣?=====================
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

            // ===================== 娴忚閲忕粺璁?=====================
            // 鍏ㄥ眬甯栧瓙淇℃伅缂撳瓨锛岀敤浜庢祻瑙堣褰?
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';

            function getViewHistory() {
                try {
                    return window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 閬垮厤閲嶅璁板綍锛堝悓涓€鐢ㄦ埛鍚屼竴甯栧瓙鍙褰曚竴娆★級
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(entry);
                    // 鍙繚鐣欐渶杩?00鏉?
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
                            var vm = statsEl.textContent.match(/娴忚 (\d+)/);
                            if (vm) {
                                var newVal = parseInt(vm[1]) + 1;
                                statsEl.innerHTML = statsEl.innerHTML.replace(/娴忚 \d+/, '娴忚 ' + newVal);
                            }
                        }
                    }
                    if (currentUser && postInfoCache[postId]) {
                        var rawContent = postInfoCache[postId].content || '';
                        saveViewHistory({
                            user_name: currentUser,
                            post_id: postId,
                            post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + '...' : (rawContent || '(鍥剧墖/瑙嗛)'),
                            post_author: postInfoCache[postId].user_name || '鏈煡',
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

            // ===================== 鍔犺浇鍔ㄦ€?=====================
            // 浠诲姟5锛氬垎椤靛姞杞界浉鍏冲彉閲?
            let feedPage = 0;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;

            // DEPRECATED_DO_NOT_EDIT ====== [宸插簾寮僝 涓嬫柟绗?412琛屾湁鏇存柊鐗堟湰 ======
            async function loadFeed(forceRefresh = false) {
                const now = Date.now();
                if (forceRefresh) {
                    // 閲嶇疆鍒嗛〉鐘舵€?
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
                                // 缂撳瓨鍔犺浇锛屽悓鏃跺垵濮嬪寲鍒嗛〉鐘舵€?
                                feedAllPosts = parsed.data.posts || [];
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed(parsed.data);
                                // 鍚姩鏃犻檺婊氬姩瑙傚療
                                setupFeedInfiniteScroll();
                                return;
                            }
                        } catch(e){}
                    }
                }
                const feed = document.getElementById("feed");
                if (!forceRefresh) feed.innerHTML = `<div class="loading"><div class="loading-spinner"></div><span class="loading-text">鍔犺浇涓?..</span></div>`;
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*")
                    ]);
                    if (postRes.error || commRes.error || likeRes.error) {
                        const errMsg = (postRes.error || commRes.error || likeRes.error).message || '鏁版嵁鍔犺浇澶辫触';
                        feed.innerHTML = `<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触: ${errMsg}</div>`;
                        return;
                    }
                    const data = { posts: postRes.data || [], comments: commRes.data || [], likes: likeRes.data || [] };
                    // 淇濆瓨瀹屾暣鏁版嵁渚涘垎椤典娇鐢?
                    feedAllPosts = data.posts;
                    feedAllComments = data.comments;
                    feedAllLikes = data.likes;
                    // 缂撳瓨鏃舵帓闄ゅご鍍忓拰鐢ㄦ埛淇℃伅璁板綍锛岄槻姝ase64澶у浘鎾戠垎localStorage
                    const cachePosts = data.posts.filter(p => p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
                    await renderFeed(data);
                    // 鍚姩鏃犻檺婊氬姩瑙傚療
                    setupFeedInfiniteScroll();
                } catch(e) {
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触锛屽埛鏂伴噸璇?/div>`;
                    console.error(e);
                }
            }

            // 浠诲姟5锛氳缃棤闄愭粴鍔ㄨ瀵熷櫒
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
                
                // 鍦?feed 搴曢儴娣诲姞涓€涓?sentinel 鍏冪礌
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

            // DEPRECATED_DO_NOT_EDIT ====== [宸插簾寮僝 涓嬫柟绗?479琛屾湁鏇存柊鐗堟湰 ======
            function loadMoreFeedPosts() {
                if (feedEndReached) return;
                
                const feed = document.getElementById('feed');
                const visiblePosts = feedAllPosts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                
                const startIdx = feedPage * FEED_PAGE_SIZE;
                const endIdx = startIdx + FEED_PAGE_SIZE;
                
                if (startIdx >= visiblePosts.length) {
                    feedEndReached = true;
                    // 鏄剧ず娌℃湁鏇村浜?
                    let noMore = document.getElementById('feedNoMore');
                    if (!noMore) {
                        noMore = document.createElement('div');
                        noMore.id = 'feedNoMore';
                        noMore.className = 'loading';
                        noMore.textContent = '娌℃湁鏇村浜';
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

            // DEPRECATED_DO_NOT_EDIT ====== [宸插簾寮僝 涓嬫柟绗?503琛屾湁鏇存柊鐗堟湰 ======
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
                  <div class="post-stats-text">娴忚 ${p.views||0} 路 鐐硅禐 ${pLikes.length} 路 璇勮 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'鉂わ笍':'鐐硅禐'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">璇勮</button>
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">鍒犻櫎</button>`:''}
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
                
                // 鍦?sentinel 涔嬪墠鎻掑叆鏂板笘瀛?
                const sentinel = document.getElementById('feedSentinel');
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = postsHtml;
                
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                
                // 涓烘柊甯栧瓙娣诲姞杩涘叆鍔ㄧ敾瑙傚療锛堝鐢ㄥ叏灞€瑙傚療鍣級
                const newPosts = feed.querySelectorAll('.post:not(.visible)');
                newPosts.forEach(p => getPostVisibilityObserver().observe(p));
                
                // 鏇存柊缁熻
                updateFeedStats();
            }

            // DEPRECATED_DO_NOT_EDIT ====== [宸插簾寮僝 涓嬫柟绗?532琛屾湁鏇存柊鐗堟湰 ======
            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;

                // 濉厖甯栧瓙淇℃伅缂撳瓨锛屼緵娴忚璁板綍浣跨敤
                visiblePosts.forEach(p => {
                    postInfoCache[p.id] = { content: p.content, user_name: p.user_name };
                });

                // 鏀堕泦鎵€鏈夐渶瑕佸ご鍍忕殑鐢ㄦ埛鍚?
                const allUsers = new Set();
                visiblePosts.forEach(p => allUsers.add(p.user_name));
                comments.forEach(c => allUsers.add(c.user_name));

                // 绛夊緟头像鍔犺浇瀹屾垚鍚庡啀娓叉煋
                await loadAvatarsForUsers(Array.from(allUsers));
                
                // 浠诲姟5锛氬彧娓叉煋绗竴椤电殑鍐呭锛屽悗缁€氳繃鏃犻檺婊氬姩鍔犺浇
                const firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                renderFeedWithAvatars(firstPage, comments, likes);
                
                // 鍚庡彴棰勫姞杞界粺璁℃暟鎹?
                setTimeout(function() { prefetchStatData(); }, 1000);
            }
            window.renderFeed = renderFeed;

            // 棰勬瀯寤鸿瘎璁哄拰鐐硅禐鐨勬槧灏勮〃锛屾彁鍗囨覆鏌撴€ц兘
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

            // 缂撳瓨头像URL
            const avatarCache = {};

            async function loadAvatarsForUsers(usernames) {
                if (!usernames || usernames.length === 0) return;
                try {
                    var allData = [];
                    var batchSize = 80; // Supabase .in() 鏈€澶氱害100涓€硷紝鐣?0浣欓噺
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
                    console.error("鍔犺浇头像澶辫触:", e);
                }
            }

            function getAvatarHtml(username, size = 32) {
                var avatarUrl = avatarCache[username];
                if (!avatarUrl) {
                    if (username === currentUser) {
                        // 鍙粠localStorage閲屾嬁褰撳墠鐢ㄦ埛鑷繁鐨勫ご鍍?
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

            // DEPRECATED_DO_NOT_EDIT ====== [宸插簾寮僝 涓嬫柟绗?520琛屾湁鏇存柊鐗堟湰 ======
            function renderFeedWithAvatars(visiblePosts, comments, likes) {
                const feed = document.getElementById("feed");
                const { commentMap, likeMap, likeUserMap } = buildPostMaps(comments, likes);

                feed.innerHTML = visiblePosts.length ? visiblePosts.map(function(post) {
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
                  <div class="post-stats-text">娴忚 ${p.views||0} 路 鐐硅禐 ${pLikes.length} 路 璇勮 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'鉂わ笍':'鐐硅禐'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">璇勮</button>
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">鍒犻櫎</button>`:''}
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
                }).join('') : `<div class="loading">蹇潵鍙戝竷绗竴鏉″姩鎬佸惂~</div>`;

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
                    var vm = text.match(/娴忚 (\d+)/);
                    var lm = text.match(/鐐硅禐 (\d+)/);
                    var cm = text.match(/璇勮 (\d+)/);
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

            function collectPostMetadata(visibility, overrides) {
                return Object.assign({}, POST_META_DEFAULTS, {
                    visibility: visibility || "public"
                }, overrides || {});
            }

            async function insertPostRecord(payload, fallbackContent) {
                var primary = await sb.from("posts").insert([payload]);
                if (!primary.error) return { ok: true, fallback: false };

                var message = String(primary.error.message || "");
                var maybeSchemaIssue = /visibility|is_pinned|pinned_at|updated_at|column/i.test(message);
                if (!maybeSchemaIssue) return { ok: false, error: primary.error };

                var fallbackPayload = {
                    user_name: payload.user_name,
                    content: fallbackContent,
                    media_url: payload.media_url,
                    media_type: payload.media_type,
                    actor_key: payload.actor_key
                };
                var fallback = await sb.from("posts").insert([fallbackPayload]);
                if (fallback.error) return { ok: false, error: fallback.error };
                return { ok: true, fallback: true };
            }

            function resetPostComposer() {
                var postInp = document.getElementById("postInp");
                var fileInp = document.getElementById("fileInp");
                var visibilityEl = document.getElementById("postVisibility");
                if (postInp) postInp.value = "";
                if (fileInp) fileInp.value = "";
                if (visibilityEl) visibilityEl.value = "public";
            }

            function buildPostStorageContent(post, text, metaOverrides) {
                var normalized = normalizePost(post || {});
                var meta = Object.assign({}, normalized._contentMeta || POST_META_DEFAULTS, {
                    visibility: normalized.visibility || "public",
                    is_pinned: !!normalized.is_pinned,
                    pinned_at: normalized.pinned_at || null,
                    updated_at: normalized.updated_at || null
                }, metaOverrides || {});
                var nextText = typeof text === "string" ? text : normalized.content || "";
                return buildPostContentPayload(nextText, meta);
            }

            async function updatePostRecord(post, updates) {
                var normalized = normalizePost(post);
                var nextVisibility = updates.visibility != null ? updates.visibility : normalized.visibility;
                var nextPinned = updates.is_pinned != null ? !!updates.is_pinned : !!normalized.is_pinned;
                var nextPinnedAt = Object.prototype.hasOwnProperty.call(updates, "pinned_at") ? updates.pinned_at : normalized.pinned_at;
                var nextUpdatedAt = Object.prototype.hasOwnProperty.call(updates, "updated_at") ? updates.updated_at : normalized.updated_at;
                var nextContent = typeof updates.content === "string" ? updates.content : normalized.content;
                var directPayload = {
                    content: nextContent,
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                };
                var direct = await sb.from("posts").update(directPayload).eq("id", post.id).select("*");
                if (!direct.error) {
                    if (!direct.data || (Array.isArray(direct.data) && direct.data.length === 0)) {
                        return { ok: false, error: new Error("数据库未更新任何记录，可能是 Supabase RLS/update policy 拦截。") };
                    }
                    return { ok: true, fallback: false };
                }

                var message = String(direct.error.message || "");
                var maybeSchemaIssue = /visibility|is_pinned|pinned_at|updated_at|column/i.test(message);
                if (!maybeSchemaIssue) return { ok: false, error: direct.error };

                var fallbackContent = buildPostStorageContent(normalized, nextContent, {
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                });
                var fallback = await sb.from("posts").update({ content: fallbackContent }).eq("id", post.id);
                if (fallback.error) return { ok: false, error: fallback.error };
                return { ok: true, fallback: true };
            }

            function getRenderableComments(comments, visiblePosts) {
                var visibleIds = new Set((visiblePosts || []).map(function(post) { return String(post.id); }));
                return (comments || []).filter(function(comment) {
                    return comment && visibleIds.has(String(comment.post_id));
                });
            }

            function formatPostTime(post) {
                var normalized = normalizePost(post);
                var time = normalized.created_at ? new Date(normalized.created_at).toLocaleString() : "";
                if (normalized.updated_at) return time + " 路 宸茬紪杈";
                return time;
            }

            function buildPostBadges(post) {
                var normalized = normalizePost(post);
                var bits = [];
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '馃敀 绉佸瘑' : '馃實 鍏紑') + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">馃搶 缃《</span>');
                return bits.join("");
            }

            function buildPostActionHtml(post, isLiked, canDelete) {
                var id = escapeHtml(String(post.id)).replace(/'/g, "\\'");
                var actorKey = escapeHtml(String(post.actor_key || "")).replace(/'/g, "\\'");
                var actions = [
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(this, \'' + id + '\')">' + (isLiked ? '鉂わ笍' : '鐐硅禐') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + id + '\')">璇勮</button>'
                ];
                if (canEditPost(post)) {
                    actions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + id + '\')">缂栬緫</button>');
                }
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" onclick="togglePostPin(\'' + id + '\')">' + (normalizePost(post).is_pinned ? '鍙栨秷缃《' : '缃《') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + id + '\', \'' + actorKey + '\')">鍒犻櫎</button>');
                }
                actions.push('<button class="action-btn report-btn" style="margin-left:auto;" data-id="' + escapeHtml(String(post.id)) + '" data-user="' + escapeHtml(post.user_name || "") + '">举报</button>');
                return actions.join("");
            }

            function renderPostCard(post, commentMap, likeMap, likeUserMap) {
                var normalized = normalizePost(post);
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = likeUserMap[normalized.id + '|' + deviceId];
                var canDelete = normalized.actor_key === deviceId || normalized.actor_key === currentUser || isAdmin();
                trackView(normalized.id);
                return `
                <div class="post glass" data-post-id="${escapeHtml(normalized.id)}">
                  <div class="post-header">
                    ${getAvatarHtml(normalized.user_name)}
                    <div class="post-header-main">
                      <div class="user-info">
                        <span class="user-name">${escapeHtml(normalized.user_name)}</span>
                        <span class="post-time post-meta-line">${escapeHtml(formatPostTime(normalized))}</span>
                      </div>
                      <div class="post-badge-stack">${buildPostBadges(normalized)}</div>
                    </div>
                  </div>
                  <div class="content">${escapeHtml(normalized.content || "")}</div>
                  ${normalized.media_url ? `<div class="media">${normalized.media_type === 'video' ? `<video src="${escapeHtml(normalized.media_url)}" controls preload="none"></video>` : `<img src="${escapeHtml(normalized.media_url)}" loading="lazy" onclick="openImageViewer('${escapeHtml(normalized.media_url).replace(/'/g, "\\'")}')">`}</div>` : ''}
                  <div class="post-stats-text">娴忚 ${normalized.views || 0} 路 鐐硅禐 ${pLikes.length} 路 璇勮 ${pComms.length}</div>
                  <div class="actions">${buildPostActionHtml(normalized, isLiked, canDelete)}</div>
                  ${pComms.length ? `<div class="comments">${pComms.map(function(c) {
                    return `<div class="comment-item" data-comment-id="${escapeHtml(c.id)}"><div><b>${escapeHtml(c.user_name)}:</b> ${escapeHtml(c.content)}</div></div>`;
                  }).join('')}</div>` : ''}
                </div>`;
            }

            function updatePostFilterStateFromDom() {
                var keywordEl = document.getElementById("postSearchInput");
                var userEl = document.getElementById("postUserFilter");
                var startEl = document.getElementById("postStartDate");
                var endEl = document.getElementById("postEndDate");
                var visibilityEl = document.getElementById("postVisibilityFilter");
                var mineEl = document.getElementById("postOnlyMine");
                postSearchState = {
                    keyword: keywordEl ? keywordEl.value.trim() : "",
                    user: userEl ? userEl.value.trim() : "",
                    startDate: startEl ? startEl.value : "",
                    endDate: endEl ? endEl.value : "",
                    visibility: visibilityEl ? visibilityEl.value : "all",
                    onlyMine: !!(mineEl && mineEl.checked)
                };
            }

            window.applyPostFilters = function() {
                updatePostFilterStateFromDom();
                feedPage = 0;
                feedEndReached = false;
                renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
            };

            window.clearPostFilters = function() {
                var ids = ["postSearchInput", "postUserFilter", "postStartDate", "postEndDate"];
                ids.forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.value = "";
                });
                var visibilityEl = document.getElementById("postVisibilityFilter");
                var mineEl = document.getElementById("postOnlyMine");
                if (visibilityEl) visibilityEl.value = "all";
                if (mineEl) mineEl.checked = false;
                postSearchState = {
                    keyword: "",
                    user: "",
                    startDate: "",
                    endDate: "",
                    visibility: "all",
                    onlyMine: false
                };
                feedPage = 0;
                feedEndReached = false;
                renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
            };

            function bindPostFilterEvents() {
                if (window._postFilterEventsBound) return;
                window._postFilterEventsBound = true;
                ["postSearchInput", "postUserFilter", "postStartDate", "postEndDate", "postVisibilityFilter", "postOnlyMine"].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (!el) return;
                    var eventName = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
                    el.addEventListener(eventName, function() {
                        window.applyPostFilters();
                    });
                });
            }

            window.openEditPost = function(postId) {
                var target = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(postId); });
                if (!target || !canEditPost(target)) {
                    showToast("鏃犳潈缂栬緫杩欐潯甯栧瓙");
                    return;
                }
                editPostId = String(target.id);
                var input = document.getElementById("editPostInp");
                var visibility = document.getElementById("editPostVisibility");
                if (input) input.value = target.content || "";
                if (visibility) visibility.value = target.visibility || "public";
                openModal("editPostModal");
            };

            window.saveEditPost = async function() {
                if (!editPostId) return;
                var post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(editPostId); });
                if (!post || !canEditPost(post)) {
                    showToast("鏃犳潈缂栬緫杩欐潯甯栧瓙");
                    return;
                }
                var input = document.getElementById("editPostInp");
                var visibility = document.getElementById("editPostVisibility");
                var btn = document.getElementById("saveEditPostBtn");
                var nextContent = input ? input.value.trim() : "";
                var nextVisibility = visibility ? visibility.value : "public";
                if (!nextContent) {
                    showToast("璇疯緭鍏ュ笘瀛愬唴瀹?");
                    return;
                }
                btn.disabled = true;
                btn.textContent = "淇濆瓨涓?..";
                try {
                    var result = await updatePostRecord(post, {
                        content: nextContent.slice(0, 2000),
                        visibility: nextVisibility,
                        updated_at: new Date().toISOString()
                    });
                    if (!result.ok) {
                        showToast("淇濆瓨澶辫触: " + ((result.error && result.error.message) || "鏈煡閿欒"));
                        return;
                    }
                    var fetched = await sb.from("posts").select("*").eq("id", editPostId).maybeSingle();
                    if (fetched.error) throw fetched.error;
                    var fetchedPost = fetched.data || null;
                    if (!fetchedPost) {
                        throw new Error("保存失败：公开/私密状态未实际保存");
                    }
                    var verified = normalizePost(fetchedPost);
                    if (String(verified.visibility) !== String(nextVisibility)) {
                        throw new Error("保存失败：公开/私密状态未实际保存");
                    }
                    clearFeedCache();
                    closeModal("editPostModal");
                    editPostId = null;
                    await loadFeed(true);
                    showToast(nextVisibility === "private" ? "宸叉敼涓虹瀵?" : "宸叉敼涓哄叕寮€");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("淇濆瓨澶辫触: " + (e && e.message ? e.message : "缃戠粶閿欒"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "淇濆瓨淇敼";
                }
            };
            window.togglePostPin = async function(postId) {
                var post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                if (!post || !canPinPost(post)) {
                    showToast("鏃犳潈缃《杩欐潯甯栧瓙");
                    return;
                }
                var nextPinned = !post.is_pinned;
                var result = await updatePostRecord(post, {
                    is_pinned: nextPinned,
                    pinned_at: nextPinned ? new Date().toISOString() : null
                });
                if (!result.ok) {
                    showToast("缃《鎿嶄綔澶辫触: " + ((result.error && result.error.message) || "鏈煡閿欒"));
                    return;
                }
                clearFeedCache();
                showToast(nextPinned ? "帖子已置顶" : "已取消置顶");
                await loadFeed(true);
            };
            window.doPublish = async function () {
                if (!currentUser) { showToast("璇峰厛登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("璇疯緭鍏ュ唴瀹"); return; }
                if (content.length > 2000) { showToast("鍐呭涓嶈兘瓒呰繃2000瀛"); return; }
                var btn = document.getElementById("pubBtn");
                btn.disabled = true;
                btn.textContent = "鍙戝竷涓?..";
                try {
                    var media_url = "";
                    var media_type = "";
                    if (file) {
                        var path = Date.now() + "_" + file.name;
                        var uploadRes = await sb.storage.from("uploads").upload(path, file);
                        if (uploadRes.error) throw uploadRes.error;
                        media_url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                        media_type = file.type.startsWith("image") ? "image" : "video";
                    }
                    var plainText = content.slice(0, 2000);
                    var metadata = collectPostMetadata ? collectPostMetadata(visibility) : { visibility: visibility || "public" };
                    var payload = {
                        user_name: currentUser,
                        content: plainText,
                        media_url: media_url,
                        media_type: media_type,
                        actor_key: deviceId,
                        visibility: metadata.visibility,
                        is_pinned: false,
                        pinned_at: null,
                        updated_at: null
                    };
                    var fallbackContent = buildPostContentPayload(plainText, metadata);
                    var insertRes = await insertPostRecord(payload, fallbackContent);
                    if (!insertRes.ok) {
                        showToast("鍙戝竷澶辫触: " + ((insertRes.error && insertRes.error.message) || "鏈煡閿欒"));
                        return;
                    }
                    clearFeedCache();
                    resetPostComposer();
                    showToast(insertRes.fallback ? "发布成功，已兼容旧数据结构" : "发布成功");
                    await loadFeed(true);
                } catch (e) {
                    showToast("鍙戝竷澶辫触: " + (e.message || "缃戠粶閿欒"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "鍙戝竷鍔ㄦ€";
                }
            };

            loadFeed = async function(forceRefresh) {
                var now = Date.now();
                if (forceRefresh) {
                    feedPage = 0;
                    feedEndReached = false;
                    feedAllPosts = [];
                    feedAllComments = [];
                    feedAllLikes = [];
                    clearFeedCache();
                }
                bindPostFilterEvents();
                if (!forceRefresh) {
                    var cached = localStorage.getItem(CACHE_KEY);
                    if (cached) {
                        try {
                            var parsed = JSON.parse(cached);
                            if (parsed && parsed.data && now - parsed.timestamp < CACHE_DURATION) {
                                feedAllPosts = normalizePosts(parsed.data.posts || []);
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
                                setupFeedInfiniteScroll();
                                return;
                            }
                        } catch (e) {}
                    }
                }
                var feed = document.getElementById("feed");
                if (!forceRefresh && feed) {
                    feed.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">鍔犺浇涓?..</span></div>';
                }
                try {
                    var results = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*")
                    ]);
                    var postRes = results[0];
                    var commRes = results[1];
                    var likeRes = results[2];
                    if (postRes.error || commRes.error || likeRes.error) {
                        var err = postRes.error || commRes.error || likeRes.error;
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触: ' + escapeHtml(err.message || "鏈煡閿欒") + '</div>';
                        return;
                    }
                    feedAllPosts = normalizePosts(postRes.data || []);
                    feedAllComments = commRes.data || [];
                    feedAllLikes = likeRes.data || [];
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        data: {
                            posts: feedAllPosts,
                            comments: feedAllComments,
                            likes: feedAllLikes
                        },
                        timestamp: now
                    }));
                    await renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
                    setupFeedInfiniteScroll();
                } catch (e) {
                    if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触锛岃鍒锋柊閲嶈瘯</div>';
                    console.error(e);
                }
            };
            window.loadFeed = loadFeed;

            loadMoreFeedPosts = function() {
                if (feedEndReached) return;
                var feed = document.getElementById("feed");
                var filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                var startIdx = feedPage * FEED_PAGE_SIZE;
                var endIdx = startIdx + FEED_PAGE_SIZE;
                if (startIdx >= filteredPosts.length) {
                    feedEndReached = true;
                    var noMore = document.getElementById("feedNoMore");
                    if (!noMore) {
                        noMore = document.createElement("div");
                        noMore.id = "feedNoMore";
                        noMore.className = "loading";
                        noMore.textContent = "娌℃湁鏇村浜";
                        noMore.style.padding = "30px";
                        noMore.style.textAlign = "center";
                        feed.appendChild(noMore);
                    }
                    return;
                }
                var filteredPostIds = new Set();
                filteredPosts.forEach(function(p) { filteredPostIds.add(String(p.id)); });
                var scopedComments = getRenderableComments(feedAllComments, filteredPosts);
                var scopedLikes = (feedAllLikes || []).filter(function(l) { return filteredPostIds.has(String(l.post_id)); });
                appendMorePosts(filteredPosts.slice(startIdx, endIdx), scopedComments, scopedLikes);
                feedPage++;
            };

            appendMorePosts = function(posts, comments, likes) {
                var feed = document.getElementById("feed");
                var maps = buildPostMaps(getRenderableComments(comments, posts), likes);
                var postsHtml = posts.map(function(post) {
                    return renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                }).join("");
                var sentinel = document.getElementById("feedSentinel");
                var tempContainer = document.createElement("div");
                tempContainer.innerHTML = postsHtml;
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                var newPosts = feed.querySelectorAll(".post:not(.visible)");
                newPosts.forEach(function(p) { getPostVisibilityObserver().observe(p); });
                updateFeedStats();
            };

            renderFeedWithAvatars = function(visiblePosts, comments, likes) {
                var feed = document.getElementById("feed");
                var scopedComments = getRenderableComments(comments, visiblePosts);
                var maps = buildPostMaps(scopedComments, likes);
                var state = getPostSearchState();
                var hasFilters = !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
                feed.innerHTML = visiblePosts.length ? visiblePosts.map(function(post) {
                    return renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                }).join("") : "<div class=\"loading\">" + (hasFilters ? "没有找到相关帖子" : "快来发布第一条动态吧~") + "</div>";
                initPostScrollAnimation();
            };

            renderFeed = async function(payload) {
                bindPostFilterEvents();
                var filteredPosts = getFilteredPosts(payload.posts, payload.comments);
                var visibleComments = getRenderableComments(payload.comments, filteredPosts);
                document.getElementById("sPosts").textContent = filteredPosts.length;
                document.getElementById("sViews").textContent = filteredPosts.reduce(function(sum, post) { return sum + (post.views || 0); }, 0);
                var visiblePostIds = new Set();
                filteredPosts.forEach(function(p) { visiblePostIds.add(String(p.id)); });
                var scopedLikes = (payload.likes || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                document.getElementById("sLikes").textContent = scopedLikes.length + visibleComments.length;
                filteredPosts.forEach(function(post) {
                    postInfoCache[post.id] = { content: post.content, user_name: post.user_name };
                });
                var allUsers = new Set();
                filteredPosts.forEach(function(post) { allUsers.add(post.user_name); });
                visibleComments.forEach(function(comment) { allUsers.add(comment.user_name); });
                await loadAvatarsForUsers(Array.from(allUsers));
                var firstPage = filteredPosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                feedEndReached = firstPage.length >= filteredPosts.length;
                renderFeedWithAvatars(firstPage, visibleComments, scopedLikes);
                renderFilterSummary(filteredPosts.length);
                setTimeout(function() { prefetchStatData(); }, 1000);
            };
            window.renderFeed = renderFeed;

            document.getElementById("delBtn").onclick = async function() {
                if (!delPostId) return;
                var btn = document.getElementById("delBtn");
                btn.disabled = true;
                btn.textContent = "鍒犻櫎涓?..";
                try {
                    var key = isAdmin() ? delOwnerKey : deviceId;
                    var result = await sb.rpc("delete_post_with_actor", {
                        p_post_id: delPostId,
                        p_actor_key: key
                    });
                    if (result.error) {
                        showToast("鍒犻櫎澶辫触: " + result.error.message);
                        return;
                    }
                    clearFeedCache();
                    closeModal("delModal");
                    showToast("甯栧瓙宸插垹闄");
                    delPostId = null;
                    await loadFeed(true);
                } catch (e) {
                    showToast("鍒犻櫎甯栧瓙澶辫触");
                    console.error(e);
                } finally {
                    btn.disabled = false;
                    btn.textContent = "纭鍒犻櫎";
                }
            };

            // DEPRECATED_DO_NOT_EDIT ====== [宸插簾寮僝 涓嬫柟绗?668琛屾湁鏇存柊鐗堟湰 ======
            window.prefetchStatData = async function() {
                if (Date.now() - statCacheTime < STAT_CACHE_DURATION) return;
                try {
                    var results = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = normalizePosts(results[0].data || []).filter(function(post) {
                        return post.media_type !== AUTH_MARKER && post.media_type !== DM_MARKER && post.media_type !== "__photo_wall__" && canViewPost(post);
                    });
                    statAllComments = results[1].data || [];
                    statAllLikes = results[2].data || [];
                    statCacheTime = Date.now();
                } catch (e) {}
            };

            // ===================== 鏁版嵁缁熻璇︽儏鍔熻兘 =====================
            // 瀛樺偍褰撳墠鐨勭粺璁¤鍥剧姸鎬?
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30绉掔紦瀛?

            // 鍚庡彴棰勫姞杞界粺璁℃暟鎹?
            window.prefetchStatData = async function() {
                if (Date.now() - statCacheTime < STAT_CACHE_DURATION) return;
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = normalizePosts(postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__' && canViewPost(p); });
                    var visiblePostIds = new Set(statAllPosts.map(function(p) { return String(p.id); }));
                    statAllComments = (commRes.data || []).filter(function(c) { return visiblePostIds.has(String(c.post_id)); });
                    statAllLikes = (likeRes.data || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                    statCacheTime = Date.now();
                } catch(e) {}
            };

            // 鎵撳紑缁熻璇︽儏妯℃€佹
            window.openStatDetail = async function(type) {
                statCurrentType = type;
                const titles = { posts: '鎬诲姩鎬?- 鎸夌敤鎴峰垎缁', views: '鎬绘祻瑙?- 娴忚璁板綍', likes: '鐐硅禐鍜岃瘎璁?- 璁板綍' };
                document.getElementById('statModalTitle').textContent = titles[type] || '缁熻璇︽儏';
                document.getElementById('statModal').classList.add('active');

                // 濡傛灉鏈夌紦瀛樻暟鎹紝绔嬪嵆娓叉煋锛屽悓鏃跺紓姝ュ埛鏂?
                if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    // 鍚庡彴闈欓粯鍒锋柊
                    prefetchStatData().then(function() {
                        if (document.getElementById('statModal').classList.contains('active') && statCurrentType === type) {
                            renderStatByType(type);
                        }
                    });
                    return;
                }

                document.getElementById('statModalBody').innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">鍔犺浇涓?..</span></div>';

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = normalizePosts(postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__' && canViewPost(p); });
                    var visiblePostIds = new Set(statAllPosts.map(function(p) { return String(p.id); }));
                    statAllComments = (commRes.data || []).filter(function(c) { return visiblePostIds.has(String(c.post_id)); });
                    statAllLikes = (likeRes.data || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                    statCacheTime = Date.now();

                    renderStatByType(type);
                } catch(e) {
                    document.getElementById('statModalBody').innerHTML = '<div class="stat-empty">鍔犺浇澶辫触锛岃閲嶈瘯</div>';
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

            // 婊氬姩鍒版寚瀹氬笘瀛愬苟楂樹寒
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
                document.getElementById('postDetailTitle').textContent = '甯栧瓙璇︽儏';
                document.getElementById('postDetailBody').innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">鍔犺浇涓?..</span></div>';
                document.getElementById('postDetailModal').classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);

                    const post = normalizePost(postRes.data);
                    if (!post) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">帖子不存在或已被删除</div>';
                        return;
                    }
                    if (!canViewPost(post)) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">无权查看这条帖子</div>';
                        return;
                    }
                    const likes = likeRes.data || [];
                    const comments = commRes.data || [];
                    renderPostDetail(post, likes, comments);
                } catch(e) {
                    document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">鍔犺浇澶辫触锛岃閲嶈瘯</div>';
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
                    <div class="post-detail-stats">娴忚 ${vc} 路 鐐硅禐 ${likes.length} 路 璇勮 ${comments.length}</div>
                    <div class="stat-two-col">
                        <div class="stat-col">
                            <div class="stat-section-title">鉂わ笍 鐐硅禐鐢ㄦ埛锛?{likes.length}锛?/div>
                            ${likes.length ? likes.map(l => `
                                <div class="stat-like-item">
                                    <div class="sli-info">
                                        <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                    </div>
                                    <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                                </div>
                            `).join('') : '<div class="stat-empty" style="padding:12px 0;">鏆傛棤鐐硅禐</div>'}
                        </div>
                        <div class="stat-col">
                            <div class="stat-section-title">馃挰 璇勮鍒楄〃锛?{comments.length}锛?/div>
                            ${comments.length ? comments.map(c => `
                                <div class="stat-comment-item">
                                    <div class="sci-info">
                                        <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                        <div class="sci-target">${escapeHtml(c.content)}</div>
                                    </div>
                                    <span class="sci-time">${new Date(c.created_at).toLocaleString()}</span>
                                </div>
                            `).join('') : '<div class="stat-empty" style="padding:12px 0;">鏆傛棤璇勮</div>'}
                        </div>
                    </div>
                `;
            }

            // 鏍煎紡鍖栧笘瀛愬唴瀹规憳瑕侊紙鐢ㄤ簬灞曠ず锛?
            function formatPostSummary(p) {
                const text = p.content || '';
                const hasImg = p.media_url && p.media_type === 'image';
                const hasVid = p.media_url && p.media_type === 'video';
                let tag = '';
                if (hasImg) tag = '<span class="spi-img-tag">馃柤 鍥剧墖</span>';
                if (hasVid) tag = '<span class="spi-img-tag">馃幀 瑙嗛</span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '一张图片' : hasVid ? '一个视频' : '(无内容)');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 鐢熸垚甯栧瓙鏉＄洰鐨凥TML锛堝彲鐐瑰嚮璺宠浆锛?
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

            // 娓叉煋鎬诲姩鎬佺粺璁★紙鎸夌敤鎴峰垎缁勶級
            function renderPostStats() {
                const body = document.getElementById('statModalBody');
                // 鎸?user_name 鍒嗙粍缁熻
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

            // 鏌ョ湅鎸囧畾鐢ㄦ埛鐨勬墍鏈夊笘瀛?
            window.loadUserAllPosts = function(userName) {
                const body = document.getElementById('statModalBody');
                const userPosts = statAllPosts.filter(p => p.user_name === userName);
                body.innerHTML = `
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">鈫?杩斿洖鎬诲姩鎬?/button>
                    <div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        ${userName} 鐨勫叏閮ㄥ笘瀛愶紙鍏?${userPosts.length} 鏉★級
                    </div>
                    ${userPosts.map(p => renderPostItemHTML(p)).join('')}
                `;
            };

            // 娓叉煋鎬绘祻瑙堢粺璁★紙浠?localStorage 璇诲彇娴忚鍘嗗彶锛?
            function renderViewStats() {
                const body = document.getElementById('statModalBody');
                const history = getViewHistory();
                
                if (!history.length) {
                    body.innerHTML = `
                        <div class="stat-empty">
                            <div style="font-size:16px; margin-bottom:8px;">馃搳 娴忚璁板綍</div>
                            <div style="font-size:13px;">鏆傛棤娴忚璇︽儏鏁版嵁</div>
                            <div style="font-size:12px; margin-top:12px; opacity:0.7;">娴忚璁板綍浼氬湪浣犳煡鐪嬪笘瀛愭椂鑷姩淇濆瓨</div>
                            <div style="font-size:12px; margin-top:8px; opacity:0.7;">褰撳墠宸茶褰曟€绘祻瑙堟暟锛?{document.getElementById('sViews').textContent} 娆?/div>
                        </div>
                    `;
                    return;
                }

                body.innerHTML = history.map(v => `
                    <div class="stat-view-item">
                        <div class="svi-info">
                            <div class="svi-user">${escapeHtml(v.user_name)}</div>
                            <div class="svi-target">娴忚浜?<b>${escapeHtml(v.post_author)}</b> 鐨勫笘瀛愶細${escapeHtml(v.post_content)}</div>
                        </div>
                        <span class="svi-time">${new Date(v.viewed_at).toLocaleString()}</span>
                    </div>
                `).join('');
            }

            // 娓叉煋鐐硅禐鍜岃瘎璁虹粺璁?
            function renderLikeStats() {
                const body = document.getElementById('statModalBody');

                const postMap = {};
                statAllPosts.forEach(p => { postMap[p.id] = p; });

                function buildLikesCol() {
                    let h = '<div class="stat-section-title">鉂わ笍 鐐硅禐璁板綍</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(l => {
                            const post = postMap[l.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(鍥剧墖/瑙嗛)') : '(宸插垹闄?';
                            return `
                        <div class="stat-like-item">
                            <div class="sli-info">
                                <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                <div class="sli-target">鐐硅禐浜嗭細${postContent}</div>
                            </div>
                            <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">鏆傛棤鐐硅禐璁板綍</div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    let h = '<div class="stat-section-title">馃挰 璇勮璁板綍</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(鍥剧墖/瑙嗛)') : '(宸插垹闄?';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">璇勮浜嗐€?{postContent}銆嶏細${escapeHtml(c.content)}</div>
                            </div>
                            <span class="sci-time">${new Date(c.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">鏆傛棤璇勮璁板綍</div>';
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
                    statAllPosts = normalizePosts(postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__' && canViewPost(p); });
                    var visiblePostIds = new Set(statAllPosts.map(function(p) { return String(p.id); }));
                    statAllComments = (commRes.data || []).filter(function(c) { return visiblePostIds.has(String(c.post_id)); });
                    statAllLikes = (likeRes.data || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                    var body = document.getElementById('statModalBody');
                    if (!body) return;
                    if (type === 'posts') renderPostStats();
                    else if (type === 'views') renderViewStats();
                    else if (type === 'likes') renderLikeStats();
                }).catch(function() {});
            }

            // ===================== 閫氱煡绯荤粺 =====================
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

                // 寮哄埗娴忚鍣ㄥ畬鎴愬竷灞€鍚庡啀娣诲姞show绫伙紝纭繚CSS transition姝ｇ‘瑙﹀彂
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

            // ==== 娴嬭瘯閫氱煡妯箙锛堟帶鍒跺彴璋冪敤锛歵estNotification()锛?====
            window.testNotification = function() {
                showNotification('寮犱笁', '浣犲ソ锛佽繖鏄竴鏉℃祴璇曟秷鎭綖鐪嬬湅娑叉€佺幓鐠冩晥鏋滃浣曪紵');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常非常长的测试消息，用来检查文本截断效果到底怎么样，超过300个字符应该也不会把字符串打坏。');
            };

            // ===================== 鑱婂ぉ绯荤粺 (Dock 鍏煎鐗? =====================
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
                if (d.toDateString() === yesterday.toDateString()) return '鏄ㄥぉ ' + hhmm;
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
                        console.log('[CHAT-REALTIME] 鏀跺埌鏂版秷鎭?', m);
                        if (m.media_type !== DM_MARKER) return;
                        if (!currentUser) return;
                        if (m.media_url !== currentUser) return;
                        if (m.user_name === currentUser) return;
                        console.log('[CHAT-REALTIME] 瑙﹀彂閫氱煡:', m.user_name, m.content);
                        showNotification(m.user_name, m.content || '鍙戦€佷簡涓€寮犲浘鐗?瑙嗛');
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
                        else if (status === 'SUBSCRIBED') { console.log('[CHAT-REALTIME] 宸茶繛鎺'); }
                    });
            }

            function startDMPolling(interval) {
                // 浠诲姟3锛氶粯璁ら棿闅?5 鍒嗛挓锛?00000ms锛夛紝闄嶄綆鏁版嵁搴撹姹傚帇鍔?
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

            // ========== Dock 鍒囨崲 ==========
            let currentDockTab = localStorage.getItem('xtj_current_tab') || 'posts';
            let lastTabTapTime = {};
            let lastTabTapCount = {};
            let isRefreshing = {};
            window.switchDockTab = function(tab, skipReturn) {
                if (tab === 'chat' && !currentUser) { showToast('璇峰厛登录'); return; }
                // 鍏堣Е鍙戠偣鍑诲姩鐢伙紙鍗充娇宸茬粡鍦ㄥ綋鍓峵ab涔熻鎾斁锛?
                var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (btn) triggerTabAnimation(btn, tab);
                const now = Date.now();
                
                // 妫€鏌ユ槸鍚︽槸鍙屽嚮鍒锋柊锛?00ms鍐呭啀娆＄偣鍑诲悓涓€tab锛?
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);
                
                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 鍙屽嚮锛氭墽琛屽埛鏂?
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            // 鐓х墖澧欏埛鏂?
                            window.showToast('姝ｅ湪鍒锋柊鐓х墖澧?..');
                            if (typeof window.loadPhotoWallData === 'function') {
                                window.loadPhotoWallData(true).then(function() {
                                    if (typeof window.renderPhotoWall === 'function') {
                                        window.renderPhotoWall();
                                    }
                                    isRefreshing[tab] = false;
                                    window.showToast('鍒锋柊瀹屾垚');
                                }).catch(function() {
                                    isRefreshing[tab] = false;
                                });
                            } else {
                                isRefreshing[tab] = false;
                            }
                        } else if (tab === 'posts') {
                            // 甯栧瓙椤靛埛鏂?
                            window.showToast('姝ｅ湪鍒锋柊...');
                            // 娓呴櫎缂撳瓨骞堕噸鏂板姞杞?
                            try {
                                localStorage.removeItem(CACHE_KEY);
                            } catch(e) {}
                            if (typeof window.initialLoad === 'function') {
                                window.initialLoad(true);
                            }
                            // 鍥炲埌椤堕儴
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                            isRefreshing[tab] = false;
                            window.showToast('鍒锋柊瀹屾垚');
                        } else if (tab === 'chat') {
                            // 鑱婂ぉ椤靛埛鏂?
                            window.showToast('姝ｅ湪鍒锋柊...');
                            dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('鍒锋柊瀹屾垚');
                        } else if (tab === 'profile') {
                            // 涓汉椤靛埛鏂?
                            window.showToast('姝ｅ湪鍒锋柊...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            isRefreshing[tab] = false;
                            window.showToast('鍒锋柊瀹屾垚');
                        }
                    } else {
                        // 鍗曞嚮锛氭墽琛岃繑鍥?鍥為《鎿嶄綔
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 甯栧瓙椤碉細鍥炲埌椤堕儴
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 鑱婂ぉ椤碉細濡傛灉鍦ㄥ璇濅腑锛岃繑鍥炶亰澶╁垪琛紱鍚﹀垯鍥炲埌椤堕儴
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
                            // 鎴戠殑椤碉細鍥炲埌椤堕儴
                            const panel = document.getElementById('panelProfile');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }
                    lastTabTapTime[tab] = now;
                    return;
                }
                
                // 鍒囨崲鍒版柊tab
                lastTabTapTime[tab] = now;
                lastTabTapCount[tab] = 1;
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
            var animDurations = { posts: 900, chat: 900, ai: 900, profile: 900 };

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
            // ========== Dock 鑱婂ぉ ==========
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
                document.getElementById('dockChatTitle').textContent = '娑堟伅';
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
                if (!currentUser) { showToast('璇峰厛登录'); return; }
                if (userName === currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                document.getElementById('dockChatMessages').innerHTML = '<div class="chat-empty"><div class="ce-icon">馃挰</div><div>鍔犺浇涓?..</div></div>';
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
                el.innerHTML = '<div class="chat-empty"><div class="ce-icon" style="animation:spin 1s linear infinite">鈴?/div><div>鍔犺浇涓?..</div></div>';
                try {
                    const { data: allMsgs, error } = await sb.from("posts")
                        .select("id, user_name, media_url, content, created_at")
                        .eq("media_type", DM_MARKER)
                        .or(`user_name.eq.${currentUser},media_url.eq.${currentUser}`)
                        .order("created_at", { ascending: false })
                        .limit(200);
                    if (error) throw error;
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">馃挰</div><div>鏆傛棤娑堟伅</div><div style="font-size:12px;">鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶?/div></div>';
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
                    // 棰勫姞杞借亰澶╁垪琛ㄥご鍍?
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
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">鈿狅笍</div><div>' + (e.message || '鍔犺浇澶辫触') + '</div></div>';
                }
            }

            // 鑱婂ぉ娑堟伅鏈湴缂撳瓨锛屼簩娆℃墦寮€绉掑嚭
            var _chatCache = {};

            async function loadDockChatMessages(userName, forceScroll) {
                if (dockChatMsgsBusy && dockChatMsgsUser === userName) { dockChatMsgsDirty = userName; return; }
                // 棰勫姞杞藉弻鏂瑰ご鍍?
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
                // 褰撳墠鐢ㄦ埛浼樺厛浣跨敤localStorage鏉冨▉缂撳瓨
                if (currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 鏈夌紦瀛樺厛绔嬪嵆鏄剧ず
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
                    // 缂撳瓨娑堟伅
                    _chatCache[cacheKey] = msgs || [];
                    const toMark = (msgs || []).filter(m => m.user_name === userName && m.media_url === currentUser && (m.views || 0) === 0);
                    await Promise.all(toMark.map(m => sb.rpc("increment_post_views", { p_post_id: m.id }).catch(() => {})));
                    toMark.forEach(m => { m.views = 1; });
                    markMessagesRead(userName);
                    renderDockMessages(msgs || [], forceScroll);
                } catch(e) {
                    if (!_chatCache[cacheKey]) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">鈿狅笍</div><div>' + (e.message || '鍔犺浇澶辫触') + '</div></div>';
                    }
                } finally {
                    dockChatMsgsBusy = false;
                    if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
                }
            }

            function renderDockMessages(msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">馃挰</div><div>鍙戦€佺涓€鏉℃秷鎭惂</div></div>'; return; }
                // 妫€娴嬬敤鎴锋槸鍚﹀湪鏌ョ湅鍘嗗彶璁板綍锛堢搴曢儴瓒呰繃100px瑙嗕负鍦ㄧ湅鍘嗗彶锛?
                var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                // 鍏堥殣钘忓鍣紝娓叉煋瀹岀洿鎺ュ埌搴曞啀鏄剧ず锛岄伩鍏嶄粠椤堕儴婊戜笅鏉ョ殑闂儊
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
                    const readStatus = sent ? ((m.views || 0) > 0 ? '<span class="msg-read-status">宸茶</span>' : '<span class="msg-read-status">鏈</span>') : '';
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
                // 娓叉煋瀹屾瘯锛屾樉绀哄鍣?
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
                } catch(e) { showToast('鍙戦€佸け璐? ' + (e?.message || e)); inp.value = content; }
                finally { dockChatSending = false; }
            }

            function showDockChatFilePreview(file) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const thumb = document.getElementById('dockCfpThumb'), name = document.getElementById('dockCfpName');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                const xBtn = thumb.querySelector('.cfp-x'); thumb.innerHTML = '';
                if (file.type.startsWith('video/')) { thumb.innerHTML = '<span class="cfp-video-icon">馃幀</span>'; }
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
                // iOS 閿洏寮瑰嚭淇: 閬垮厤 dock-bar 琚敭鐩橀《涓婂幓
                (function() {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
                    let keyboardOpen = false;

                    function handleFocus(e) {
                        if (dockBar) dockBar.style.display = 'none';
                        keyboardOpen = true;
                        // 璁╄緭鍏ユ鑷姩婊氬埌鍙鍖哄煙
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

                    // 浠诲姟4锛氫娇鐢?100dvh 鏇夸唬 --vh 鏂规锛岀Щ闄?resize 鍥炶皟涓殑 adjustIOSHeight
                    // window.addEventListener('resize', function() {
                    //     if (!keyboardOpen) adjustIOSHeight();
                    // });
                })();

                // 浠诲姟4锛氫娇鐢?100dvh 鏇夸唬 --vh 鏂规锛岀Щ闄ゆ棫鐨?iOS 璋冩暣浠ｇ爜
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI(); initRainAnimation(); initialLoad();
                // 鎭㈠涓婃淇濆瓨鐨勬爣绛鹃〉
                const savedTab = localStorage.getItem('xtj_current_tab');
                if (savedTab && savedTab !== 'posts') {
                    switchDockTab(savedTab, true);
                }
            });

            // ========== 涓婚鍒囨崲 ==========
            const htmlEl = document.documentElement;
            const themeBtn = document.getElementById('themeToggle');
            function applyTheme(isDark) {
                if (isDark) {
                    htmlEl.setAttribute('data-theme', 'dark');
                    if (themeBtn) themeBtn.textContent = '鈽€锔';
                    localStorage.setItem('xtj-theme', 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) themeBtn.textContent = '馃寵';
                    localStorage.setItem('xtj-theme', 'light');
                }
            }
            if (themeBtn) {
                themeBtn.addEventListener('click', function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    applyTheme(!isDark);
                });
            }
            // 鍒濆鍖栦富棰橈細浼樺厛 localStorage锛屽叾娆＄郴缁熷亸濂?
            const savedTheme = localStorage.getItem('xtj-theme');
            if (savedTheme === 'dark') {
                applyTheme(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme(true);
            } else {
                applyTheme(false);
            }

            // ========== 鍏憡绯荤粺 ==========
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
                // 杩斿洖鍒楄〃鏃舵仮澶嶇鐞嗗憳鐨勫彂甯冨尯鍩?
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                markAnnouncementRead(ann.id);

                // 杩涘叆璇︽儏鏃堕殣钘忓彂甯冨尯鍩?
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 璁剧疆鍙戝竷鑰呬俊鎭紙鏄剧ず鏈€鏂板ご鍍忥級
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = avatarCache[ann.user_name];
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + ann.user_name.charAt(0).toUpperCase() + '</div>';
                    userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + escapeHtml(ann.user_name) + '</div>';
                }

                // 濡傛灉鏄鐞嗗憳锛屾坊鍔犲垹闄ゆ寜閽?
                const existingDelBtn = detail.querySelector('.announcement-delete-btn');
                if (existingDelBtn) existingDelBtn.remove();
                if (isAdmin()) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'announcement-delete-btn';
                    delBtn.textContent = '鍒犻櫎鍏憡';
                    delBtn.onclick = function(e) { e.stopPropagation(); deleteAnnouncement(ann); };
                    const header = detail.querySelector('.announcement-detail-header');
                    if (header) header.appendChild(delBtn);
                }

                renderAnnouncementList(); // 閲嶆柊娓叉煋鍒楄〃锛屾洿鏂板凡璇荤姸鎬?
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
                    // 棰勫姞杞藉彂甯冭€呭ご鍍?
                    if (announcements.length > 0) {
                        var publishers = new Set();
                        announcements.forEach(function(a) { publishers.add(a.user_name); });
                        loadAvatarsForUsers(Array.from(publishers));
                    }
                } catch(e) {
                    console.error('鍔犺浇鍏憡澶辫触:', e);
                }
            }

            function parseAnnData(ann) {
                var title = '鍏憡', content = ann.content || '';
                if (ann.content) {
                    try {
                        var parsed = JSON.parse(ann.content);
                        if (parsed.title !== undefined) { title = parsed.title || '鍏憡'; content = parsed.content || ''; }
                    } catch(e) {}
                }
                return { title: title, content: content };
            }

            function renderAnnouncementList() {
                const listEl = document.getElementById('announcementList');
                if (!listEl) return;

                if (!announcements.length) {
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">馃摥</div><div>鏆傛棤鍏憡</div></div>';
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
                    showToast('璇疯嚦灏戝～鍐欐爣棰樻垨鍐呭');
                    return;
                }

                try {
                    // content瀛楁瀛楯SON锛歿title, content}锛坧osts琛ㄦ病鏈塼itle鍒楋級
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
                    showToast('鍏憡发布成功');
                    await loadAnnouncements();
                    renderAnnouncementList();
                } catch(e) {
                    showToast('鍙戝竷澶辫触: ' + (e.message || '鏈煡閿欒'));
                }
            };

            window.deleteAnnouncement = async function(ann) {
                showConfirm('鍒犻櫎鍏憡', '纭畾瑕佸垹闄よ繖鏉″叕鍛婂悧锛', '鏄', async function() {
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
                        showToast('鍒犻櫎澶辫触: ' + (e.message || '鏈煡閿欒'));
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

            // ========== 鏇存柊鏃ュ織绯荤粺 ==========
            const changelogData = [
                {
                    version: 'v0.0.60',
                    date: '2026-05-28',
                    content: `
                        <h4>淇鍐呭</h4>
                        <ul>
                            <li>淇缂栬緫甯栧瓙鍏紑/绉佸瘑涓嶇湡姝ｇ敓鏁堥棶棰?/li>
                            <li>淇缁熻璇︽儏娉勯湶绉佸瘑甯栧瓙浜掑姩</li>
                            <li>淇鐓х墖棰勮鍙屽嚮缂╁皬/鍙屾寚缂╂斁涓嶇ǔ瀹?/li>
                        </ul>
                        <h4>浼樺寲鍐呭</h4>
                        <ul>
                            <li>鐓х墖澧欓瑙堟柊澧炲弻鎸囩缉鏀?/li>
                            <li>鏍囪搴熷純鍑芥暟閬垮厤璇慨鏀?/li>
                            <li>upload.js select 瀛楁瀹屾暣鎬ф彁鍗?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.59',
                    date: '2026-05-27',
                    content: `
                        <h4>淇鍐呭</h4>
                        <ul>
                            <li>淇举报鎸夐挳鐐瑰嚮鏃犲搷搴旈棶棰?/li>
                            <li>淇举报鎻愪氦瀛楁鍚嶅尮閰嶏紝娣诲姞 fallback 鏈哄埗</li>
                            <li>淇閫氱煡寮€鍏?localStorage key 涓嶄竴鑷?/li>
                            <li>淇缁熻璇︽儏娉勯湶绉佸瘑甯栧瓙浜掑姩</li>
                            <li>淇甯栧瓙璇︽儏椤垫棤绉佸瘑鏉冮檺妫€鏌?/li>
                            <li>淇鍙戝笘鏂囦欢涓婁紶鏈鏌ラ敊璇?/li>
                        </ul>
                        <h4>浼樺寲鍐呭</h4>
                        <ul>
                            <li>鐓х墖澧欑缉鐣ュ浘鍔犺浇閫熷害鎻愬崌</li>
                            <li>鍘婚櫎 index.html UTF-8 BOM</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.56',
                    date: '2026-05-26',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>鍥剧墖鍒嗚鲸鐜囦竴鑷存€т紭鍖?/strong>
                                <ul>
                                    <li>缁熶竴缂╃暐鍥剧敓鎴愬弬鏁颁负1200x1200鍒嗚鲸鐜囥€?.85鍘嬬缉璐ㄩ噺锛岀‘淇濆皝闈㈢缉鐣ュ浘涓庡疄闄呭唴瀹圭収鐗囧垎杈ㄧ巼姣斾緥鍜屾竻鏅板害鏍囧噯瀹屽叏涓€鑷?/li>
                                    <li>瑕嗙洊鐓х墖澧欎袱濂椾笂浼犳祦绋嬶紙upload.js + features.js锛夛紝淇濊瘉鎵€鏈夋柊寤虹収鐗囧潎鎸夌粺涓€鏍囧噯鐢熸垚楂樿川閲忕缉鐣ュ浘</li>
                                </ul>
                            </li>
                            <li><strong>鍒犻櫎鍔熻兘UI涓庝氦浜掍紭鍖?/strong>
                                <ul>
                                    <li>灏嗙郴缁熺骇window.confirm鍒犻櫎纭寮圭獥鏇挎崲涓鸿嚜瀹氫箟鐜荤拑纾ㄧ爞寮圭獥锛屾暣浣揢I椋庢牸缁熶竴</li>
                                    <li>寮圭獥閲囩敤閫忔槑鐜荤拑鏁堟灉 + backdrop-filter: blur(28px) saturate(200%) 澧炲己纾ㄧ爞璐ㄦ劅</li>
                                    <li>寮圭獥寮瑰嚭鏃朵粠scale(0.9) translateY(20px)骞虫粦杩囨浮鍒版甯镐綅缃紝鍔ㄧ敾鏇茬嚎cubic-bezier寮规€х紦鍑?/li>
                                    <li>纭鍒犻櫎鍚庡脊绐椾互scale(0.88)娣″嚭鍔ㄧ敾娑堝け锛岄伄缃╁眰鍚屾娣″寲</li>
                                    <li>鎸夐挳鍦ㄥ姩鐢绘湡闂寸鐢ㄩ槻閲嶅鐐瑰嚮锛岀偣鍑婚伄缃╁眰澶栭儴鍙彇娑?/li>
                                    <li>鎵€鏈変氦浜掓祦绋嬭嚜鍔ㄦ竻鐞嗗洖璋冨紩鐢紝閬垮厤鍐呭瓨娉勬紡</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.55',
                    date: '2026-05-26',
                    content: `
                        <h4>淇鍐呭</h4>
                        <ul>
                            <li><strong>鐓х墖澧欏皝闈㈡樉绀轰慨澶?/strong>
                                <ul>
                                    <li>绠€鍖?photo-wall-item浼厓绱犺瑙夋晥鏋滐紝绉婚櫎澶氬眰娓愬彉鍙犲姞锛岄伩鍏嶇敤鎴锋劅鐭ュ寮犲浘鐗?/li>
                                    <li>鑴夊啿鍦嗙幆姝ｇ‘灞呬腑瀹氫綅锛屾秷闄よ瑙夋贩涔?/li>
                                </ul>
                            </li>
                            <li><strong>鐓х墖鐐瑰嚮棰勮淇</strong>
                                <ul>
                                    <li>绉婚櫎鍐茬獊鐨凜SS鍔ㄧ敾ppTrackEnter锛岄伩鍏嶄笌JS transform鏃跺簭鍐茬獊</li>
                                    <li>openPhotoPreview涓坊鍔犻瀹氫綅閫昏緫锛岀‘淇濊建閬撳湪閬僵灞傚彲瑙佸墠宸插氨浣?/li>
                                    <li>淇鐩稿唽瑙嗗浘ppSortedPhotos琚鐩栫殑Bug</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.54',
                    date: '2026-05-25',
                    content: `
                        <h4>淇涓庝紭鍖?/h4>
                        <ul>
                            <li><strong>閾炬帴澶嶅埗浼樺寲</strong>
                                <ul>
                                    <li>浼樺厛浣跨敤鍚屾API锛?lt;10ms锛夛紝鐐瑰嚮鍗虫椂鏄剧ず缁胯壊鉁?寮规€у姩鐢?/li>
                                </ul>
                            </li>
                            <li><strong>缂╂斁涓庢墜鍔夸紭鍖?/strong>
                                <ul>
                                    <li>ppResetZoom瀹屾暣閲嶇疆閿氱偣鐘舵€侊紝闃叉璺ㄥ浘娈嬬暀</li>
                                    <li>鍙屾寚闂磋窛鍙樺寲&lt;10px鍒ゅ畾涓烘棤鏁堟搷浣滐紝闃茶璇嗗埆</li>
                                </ul>
                            </li>
                            <li><strong>绋冲畾鎬т慨澶?/strong>
                                <ul>
                                    <li>鏂板safeLocalStorageGetJSON锛?5澶勬浛鎹㈡潨缁漧ocalStorage宕╂簝</li>
                                    <li>绉婚櫎举报寮圭獥鍐呰仈display:none锛岀粺涓€CSS class鎺у埗</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.53',
                    date: '2026-05-25',
                    content: `
                        <h4>淇鍐呭</h4>
                        <ul>
                            <li><strong>灏侀潰闂寘闄烽槺淇</strong>
                                <ul>
                                    <li>IIFE鍖呰９纭繚姣忓紶鍥剧墖鐙珛缁戝畾锛屽叏閮ㄦ纭姞杞?/li>
                                </ul>
                            </li>
                            <li><strong>棰勫姞杞戒紭鍖?/strong>
                                <ul>
                                    <li>寤惰繜鍒版粦鍔ㄥ姩鐢荤粨鏉熷悗鎵ц锛岄伩鍏嶈祫婧愮珵浜?/li>
                                    <li>绮惧噯鎺у埗棰勫姞杞芥暟閲忎负3寮狅紝鎻愬崌缂撳瓨鍛戒腑鐜?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.51',
                    date: '2026-05-25',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>举报鎸夐挳淇</strong>
                                <ul>
                                    <li>灏嗕妇鎶ユ寜閽洿鎺ュ祵鍏ュ笘瀛愭ā鏉縃TML锛坮enderFeedWithAvatars 鍜?appendMorePosts锛夛紝鏇夸唬鑴嗗急鐨凞OM鎵撹ˉ涓佹柟寮?/li>
                                    <li>绉婚櫎features.js涓殑MutationObserver琛ヤ竵浠ｇ爜锛屾寜閽殢甯栧瓙鍒濆鍔犺浇涓€骞舵覆鏌擄紝鏉滅粷娑堝け闂</li>
                                    <li>举报鎸夐挳鍙冲榻愮疆搴曪紝閫氳繃inline onclick璋冪敤window.openReport锛屽吋瀹规墍鏈夎澶囧拰灞忓箷灏哄</li>
                                </ul>
                            </li>
                            <li><strong>鐓х墖鍏ㄥ睆棰勮鍙屾寚鏀惧ぇ鎬ц兘浼樺寲</strong>
                                <ul>
                                    <li>CSS灞傞潰鍚敤GPU纭欢鍔犻€燂細backface-visibility: hidden + transform: translateZ(0) + will-change: transform</li>
                                    <li>鎵嬪娍绯荤粺閲嶆瀯锛氶鍒嗛厤PinchPre瀵硅薄閬垮厤姣忓抚Array.from鍒嗛厤锛岄檷浣嶨C鍘嬪姏</li>
                                    <li>鏂板灞忓箷鍒锋柊鐜囪嚜鍔ㄦ娴嬶紙rAF涓€兼硶锛夛紝鑷€傚簲120Hz/90Hz/60Hz甯ч绠?/li>
                                    <li>viewport涓績鐐归璁＄畻缂撳瓨锛屽噺灏戞瘡甯у竷灞€鏌ヨ</li>
                                </ul>
                            </li>
                            <li><strong>鐓х墖涓婁紶鑷姩鍘嬬缉</strong>
                                <ul>
                                    <li>鏂板compressToMaxSize鍑芥暟锛氭枃浠?10MB鏃惰嚜鍔ㄥ帇缂╄嚦~10MB锛屽绾ч檷绾х瓥鐣ワ紙2560鈫?048鈫?920鈫?280鈫?00鍍忕礌锛?/li>
                                    <li>100MB瓒呭ぇ鍨嬬収鐗囦篃鑳借嚜鍔ㄥ帇缂╁悗涓婁紶锛屼笉鍐嶇洿鎺ユ嫆缁?/li>
                                    <li>鍘嬬缉澶辫触鏃跺洖閫€绛栫暐锛氣墹50MB鐩存帴涓婁紶鍘熸枃浠讹紝>50MB涓斿帇缂╁け璐ュ垯璺宠繃</li>
                                    <li>鍘嬬缉鍓嶅悗灏哄鍧囪褰曪紙fileSize + originalSize锛夛紝鏁版嵁閫忔槑鍙拷婧?/li>
                                    <li>Supabase鍏嶈垂鐗堥檺鍒跺凡纭锛氭枃浠跺瓨鍌?GB锛屽崟鏂囦欢50MB锛屾湀甯﹀5GB</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.52',
                    date: '2026-05-25',
                    content: `
                        <h4>淇鍐呭</h4>
                        <ul>
                            <li><strong>鐓х墖澧欐暟鎹涪澶遍棶棰樺交搴曚慨澶?/strong>
                                <ul>
                                    <li>鏍瑰洜瀹氫綅锛歠eatures.js涓璻enderPhotoWall琛ヤ竵瑕嗙洊浜唕ender.js鐨勬纭疄鐜帮紝瀵艰嚧姘歌繙浠庣┖鏁扮粍[]娓叉煋</li>
                                    <li>绉婚櫎閿欒鐨勮ˉ涓佷唬鐮侊紝鎭㈠render.js涓畬鏁寸殑鍔犺浇+鎺掑簭+娓叉煋娴佹按绾?/li>
                                    <li>淇features.js涓涓狪IFE浣滅敤鍩熻秺鐣岃皟鐢紙formatPhotoTime銆乪scapeHtml绛夊叏灞€鍑芥暟寮曠敤淇锛?/li>
                                </ul>
                            </li>
                            <li><strong>绛涢€夋帓搴忓姛鑳戒慨澶?/strong>
                                <ul>
                                    <li>鏃ユ湡銆佸悕绉般€佺儹搴︿笁绉嶆帓搴忔潯浠剁幇鍦ㄨ兘姝ｇ‘缁勫悎鐢熸晥</li>
                                    <li>鎺掑簭鍒囨崲鍚庣収鐗囧瀹炴椂鏇存柊锛岀粨鏋滅鍚堥鏈熼€昏緫</li>
                                    <li>鍒犻櫎鎿嶄綔鍚庨噸鏂版覆鏌撲繚鎸佸綋鍓嶆帓搴忛敭锛屼笉鍐嶉噸缃负榛樿鎺掑簭</li>
                                </ul>
                            </li>
                            <li><strong>鐩稿唽瑙嗗浘绌虹櫧淇</strong>
                                <ul>
                                    <li>鏁版嵁鍔犺浇閾捐矾淇鍚庯紝鐩稿唽瑙嗗浘鍦ㄦ湁鐓х墖鏃惰兘姝ｇ‘娓叉煋"鎸夋棩鏈熷垎缁?鐨勭浉鍐屽垪琛?/li>
                                    <li>浠呭湪纭疄鏃犵収鐗囨暟鎹椂鎵嶆樉绀?鏆傛棤鐓х墖"鎻愮ず</li>
                                </ul>
                            </li>
                            <li><strong>鍏ㄥ睆棰勮浜や簰浼樺寲</strong>
                                <ul>
                                    <li>鍙屾寚缂╂斁锛氭柊澧瀙pApplyPinchTransformImmediate鐩存帴搴旂敤transform锛岃烦杩噐AF寤惰繜锛屾彁鍗囪窡鎵嬫€?/li>
                                    <li>鑷€傚簲甯ч绠楋細3杞?0甯т腑鍊奸噰鏍锋娴?20Hz/90Hz/60Hz鍒锋柊鐜囷紝绮惧噯鍒嗛厤甯ч绠?/li>
                                    <li>鍥剧墖鍒囨崲娑堥櫎榛戝睆锛歱pDecodeImage棰勫姞杞?img.decode()纭繚瑙ｇ爜瀹屾垚鍚庡啀鏄剧ず锛宱pacity骞虫粦杩囨浮</li>
                                    <li>鍓嶅悗鍚?寮犵収鐗囨彁鍓嶉鍔犺浇锛屽疄鐜伴『婊戠殑鍗虫椂鍒囨崲</li>
                                </ul>
                            </li>
                            <li><strong>鐓х墖澧欐ā鍧楅噸鏋勭ǔ瀹氭€т慨澶?/strong>
                                <ul>
                                    <li>photo-wall.js涓璱nitPhotoWall鍑芥暟閫氳繃window瀵硅薄瀵煎嚭锛宑ore.js璋冪敤鏃跺鍔爐ypeof瀹夊叏妫€鏌?/li>
                                    <li>preview.js涓慨澶峱pEventsBound鏍囧織浣嶏紝纭繚闈欐€丠TML瑕嗙洊灞備簨浠舵纭粦瀹?/li>
                                    <li>淇photocurImg鎷煎啓閿欒涓篶urImg</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.50',
                    date: '2026-05-25',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>鐓х墖澧欏姛鑳藉叏闈㈠畬鍠?/strong>
                                <ul>
                                    <li>鏂板鎸夋棩鏈熴€佸悕绉般€佺儹搴︿笁绉嶆潯浠剁殑绛涢€夋帓搴忓姛鑳斤紝鍒囨崲鍚庣珛鍗冲搷搴?/li>
                                    <li>淇鐩稿唽瑙嗗浘鏄剧ず"鏆傛棤鐓х墖"鐨勭┖鐧介棶棰橈紝鐐瑰嚮鐩稿唽鎸夐挳姝ｇ‘鍔犺浇瀵瑰簲鍐呭</li>
                                    <li>瀵艰埅鏍忛殢涓婁笅婊戝姩鑷姩闅愯棌/鏄剧ず锛屾祻瑙堢収鐗囨椂涓嶅啀閬尅鍐呭</li>
                                </ul>
                            </li>
                            <li><strong>鐓х墖棰勮浜や簰浼樺寲</strong>
                                <ul>
                                    <li>淇鍏ㄥ睆棰勮涓嬪崟鐐归€€鍑轰笌鍙屽嚮鏀惧ぇ鐨勫啿绐侀棶棰橈紝涓ょ鎿嶄綔浜掍笉骞叉壈</li>
                                    <li>鍒犻櫎鎸夐挳鍥炬爣鐢?x"鏇挎崲涓哄瀮鍦炬《SVG鍥炬爣锛屼笌鍏抽棴鎸夐挳娓呮櫚鍖哄垎</li>
                                    <li>浼樺寲宸﹀彸婊戝姩棰勮鏃剁殑鍥剧墖鍔犺浇绛栫暐锛屾秷闄ら粦灞忥紝閲囩敤鍥剧墖缂撳瓨+寤惰繜鍔犺浇鍓嶅悗鍥剧墖浼樺厛绾ф柟妗?/li>
                                    <li>鍥剧墖鍔犺浇鏃舵樉绀鸿剦鍐插姩鐢昏儗鏅紝鏇夸唬绾粦鑳屾櫙锛屾彁鍗囪瑙変綋楠?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.40',
                    date: '2026-05-24',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>UI瑙嗚浼樺寲</strong>
                                <ul>
                                    <li>搴曢儴瀵艰埅鏍忓幓妗嗚瀺鍚堬細绉婚櫎鑳屾櫙銆佽竟妗嗐€侀槾褰憋紝浠呬繚鐣欏洓涓寜閽彲瑙侊紝鎸夐挳闂村尯鍩熷彲绌块€忕偣鍑?/li>
                                    <li>缁熶竴闈㈡澘/椤甸潰鑳屾櫙涓轰腑鎬ц壊锛堟祬鐏?娣辩伆锛夛紝绉婚櫎缁胯壊鑹茶皟锛岃В鍐砳OS搴曢儴缁胯壊閫忔樉闂</li>
                                </ul>
                            </li>
                            <li><strong>鐓х墖澧欏姛鑳藉寮?/strong>
                                <ul>
                                    <li>鏂板鍏ㄥ睆娴忚宸﹀彸婊戝姩鍒囨崲鍥剧墖鍔熻兘锛屾敮鎸佹墜鍔挎嫋鎷藉鑸?/li>
                                    <li>棣栧熬杈圭晫澶勭悊锛氱涓€寮犱笉鑳藉乏婊戯紝鏈€鍚庝竴寮犱笉鑳藉彸婊戯紝甯﹂樆鍔涘弽棣堝拰寮瑰洖鍔ㄧ敾</li>
                                    <li>鍙栨秷杩囨浮闂儊锛氫慨澶嶅垏鎹㈠浘鐗囨椂鐨勪綅缃烦璺冨拰闂櫧bug</li>
                                    <li>鍙屾寚缂╂斁浼樺寲锛氱Щ闄AF鎵瑰鐞嗗欢杩燂紝鐩存帴搴旂敤transform瀹炵幇鍘熺敓绾ц窡鎵嬫祦鐣呭害</li>
                                    <li>鏁翠綋婊戝姩娴佺晠搴︿紭鍖栵細will-change銆乼ransition绮剧粏鍖栨帶鍒?/li>
                                </ul>
                            </li>
                            <li><strong>鍝嶅簲寮忛€傞厤</strong>
                                <ul>
                                    <li>骞虫澘锛?68px+锛夛細瀹瑰櫒婊″銆佹洿澶х殑闂磋窛鍜屽瓧浣撱€佹枃绔犲崱鐗囧眳涓?/li>
                                    <li>妗岄潰锛?024px+锛夛細鐓х墖澧?鍒椼€佹枃绔犲崱鐗囨洿瀹姐€佸瓧浣撴洿澶?/li>
                                    <li>瀹藉睆锛?280px+锛夛細鐓х墖澧?鍒椼€佹洿澶氱暀鐧?/li>
                                    <li>妯睆鎵嬫満浼樺寲锛氱缉灏忓簳閮ㄥ鑸爮鍗犵敤绌洪棿</li>
                                </ul>
                            </li>
                            <li><strong>浠ｇ爜娓呯悊</strong>
                                <ul>
                                    <li>鍒犻櫎閬楃暀鐨刬18n缈昏瘧浠ｇ爜锛坱ranslations瀛楀吀銆乼ranslatePage鍑芥暟銆佽瑷€閫夋嫨UI锛?/li>
                                    <li>绮剧畝syncProfileUser绛夊嚱鏁帮紝绉婚櫎瀵圭炕璇戝瓧鍏哥殑渚濊禆</li>
                                    <li>绉婚櫎profile-lang-tabs鐩稿叧CSS鏍峰紡</li>
                                </ul>
                            </li>
                            <li><strong>Bug淇</strong>
                                <ul>
                                    <li>淇绠＄悊鍛樺彂鍏憡鏃跺湪甯栧瓙娴佷腑鑷姩鍒涘缓甯栧瓙鐨刡ug锛坒eed鏌ヨ鏈繃婊NN_MARKER锛?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.38',
                    date: '2026-05-18',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>浠ｇ爜娓呯悊涓庣簿绠€</strong>
                                <ul>
                                    <li>褰诲簳绉婚櫎闆呮€濆崟璇嶅涔犵郴缁熷叏閮ㄤ唬鐮侊紙CSS鏍峰紡銆丣S閫昏緫銆丠TML缁撴瀯锛?/li>
                                    <li>鍒犻櫎璁剧疆椤典腑鐨勮嫳璇?闊╄鍒囨崲閫夐」锛屼粎淇濈暀涓枃</li>
                                    <li>娓呯悊鎵€鏈夊簾寮冪殑缈昏瘧鏂囨湰鍜岃瑷€鍒囨崲鐩稿叧JS閫昏緫</li>
                                    <li>淇scroll handler涓鏃ocab-container鐨勯敊璇紩鐢?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.37',
                    date: '2026-05-18',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>闆呮€濆崟璇嶇増鍧楀叏闈㈤噸鍋氫负鐓х墖澧欙紙鐩稿唽鍔熻兘锛?/strong>
                                <ul>
                                    <li>瀹屽叏鏇挎崲panelAi闈㈡澘涓虹収鐗囧HTML缁撴瀯锛岀Щ闄ゆ墍鏈夊崟璇嶅涔犵晫闈?/li>
                                    <li>姣忎綅鐢ㄦ埛鍙嫭绔嬩笂浼犵収鐗囷紙base64瀛樺偍鑷砽ocalStorage锛屽崟寮犻檺鍒?0MB锛?/li>
                                    <li>妯帓5寮犵綉鏍煎竷灞€锛坓rid-template-columns: repeat(5, 1fr)锛夛紝绔栨帓鏃犻檺婊氬姩鎺掑垪</li>
                                    <li>鐓х墖鍗＄墖hover鏃舵樉绀哄彂甯冭€呭悕绉般€佸彂甯冩椂闂淬€佹祻瑙堥噺</li>
                                    <li>鐐瑰嚮浠绘剰鐓х墖杩涘叆鍏ㄥ睆棰勮锛氬浐瀹氬畾浣嶉伄缃╁眰锛屽師鐢昏川灞呬腑灞曠ず</li>
                                    <li>棰勮椤垫樉绀哄彂甯冪敤鎴枫€佸彂甯冩椂闂淬€佹祻瑙堥噺锛堢偣鍑昏嚜鍔?1璁℃暟锛?/li>
                                    <li>鐓х墖鎸変笂浼犳椂闂村€掑簭鎺掑垪锛堟渶鏂板湪鍓嶏級锛屾敮鎸佹櫤鑳芥椂闂存牸寮忓寲</li>
                                    <li>瀹屾暣CSS鏍峰紡锛氱収鐗囧瀹瑰櫒銆?鍒楃綉鏍笺€佸崱鐗囦氦浜掋€佸叏灞忛瑙堛€佹繁鑹叉ā寮忛€傞厤</li>
                                    <li>棰勮灞傜偣鍑昏儗鏅尯鍩熸垨鍏抽棴鎸夐挳鍧囧彲鍏抽棴</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.36',
                    date: '2026-05-13',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>褰诲簳淇鎵€鏈夐棶棰橈紝瀹炵幇鏋佽嚧鐨勬恫鎬佺幓鐠冩晥鏋?/strong>
                                <ul>
                                    <li>缁欏崟璇嶉〉闈㈡坊鍔犲鏉傛笎鍙樼汗鐞嗚儗鏅紝璁゜ackdrop-filter鑳界湡姝ｅ彂鎸ュ嚭鐜荤拑鏁堟灉</li>
                                    <li>鎶奷ock-panel鐨勬粴鍔ㄧ鐢紝璁╁崟璇嶉〉闈㈣嚜宸辩鐞嗘粴鍔紝瑙ｅ喅鎺掔増娣蜂贡闂</li>
                                    <li>鍗＄墖銆侀€夐」銆佸弽棣堥潰鏉块兘娣诲姞鏋佽嚧鐨勭幓鐠冭川鎰燂細澶氬眰杈规銆佸唴楂樺厜銆佸闃村奖銆侀珮寮哄害blur</li>
                                    <li>鎵€鏈夊厓绱犲姞浼厓绱犻珮鍏夊眰锛屽寮虹幓鐠冪殑閫氶€忓拰绔嬩綋鎰?/li>
                                    <li>鍙嶉闈㈡澘绉诲洖vocab-scroll閲岋紝瑙ｅ喅閬尅閫夐」鐨勯棶棰?/li>
                                    <li>鏆楄壊妯″紡鍚屾鍗囩骇锛岃儗鏅敤娣辫壊娓愬彉+鐜荤拑鍏冪礌</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.35',
                    date: '2026-05-13',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>淇瀵归敊闊虫晥涓嶇敓鏁堥棶棰?/strong>
                                <ul>
                                    <li>淇AudioContext琚祻瑙堝櫒鎸傝捣瀵艰嚧鏃犲０锛堝鍔爎esume()鍞ら啋锛?/li>
                                    <li>鎻愰珮闊虫晥闊抽噺锛坓ain浠?.1鎻愬崌鑷?.18锛夛紝閿欒闊虫敼鐢╰riangle娉㈡洿娓呮櫚</li>
                                    <li>椤甸潰棣栨鐐瑰嚮鑷姩瑙ｉ攣闊抽涓婁笅鏂?/li>
                                </ul>
                            </li>
                            <li><strong>淇缁х画鎸夐挳浣嶇疆闈犱笂</strong>
                                <ul>
                                    <li>瀹瑰櫒搴曢儴鍐呰竟璺濆鍔犺嚦16px锛岄€夐」鍖哄簳閮ㄩ棿闅欏鍔犺嚦20px</li>
                                    <li>搴曢儴flex闂撮殭浠?0px鎻愬崌鑷?6px锛屾寜閽澧炲姞涓婅竟璺?/li>
                                </ul>
                            </li>
                            <li><strong>娑叉€佺幓鐠冩晥鏋滃ぇ骞呭寮?/strong>
                                <ul>
                                    <li>鍗＄墖锛歳gba 0.85 + blur(32px) saturate(220%)锛岄槾褰辩炕鍊?/li>
                                    <li>閫夐」锛歳gba 0.72 + blur(16px) saturate(180%)</li>
                                    <li>鍙嶉闈㈡澘锛歳gba 0.82 + blur(30px) saturate(220%)</li>
                                    <li>鏆楄壊妯″紡鍚屾澧炲己</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.34',
                    date: '2026-05-13',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>闆呮€濆崟璇嶉〉闈㈠叏闈㈤噸鏋勪紭鍖?/strong>
                                <ul>
                                    <li>淇缁х画鎸夐挳浣嶇疆闈犱笂闂锛屽弽棣堥潰鏉跨Щ鑷冲簳閮ㄧ揣閭荤户缁寜閽?/li>
                                    <li>瀵归敊鍙嶉浠夸笉鑳屽崟璇嶉鏍奸噸鍋氾細澶у浘鏍?鍗曡瘝闊虫爣+閲婁箟+渚嬪彞鐙珛灞曠ず</li>
                                    <li>澧炲姞瀵归敊闊虫晥锛圵eb Audio API 鐢熸垚鐭績鎻愮ず闊筹紝姝ｇ‘鍗囪皟/閿欒闄嶈皟锛?/li>
                                    <li>鏇挎崲鍒囨崲鍔ㄧ敾涓虹缉鏀?娣″叆娣″嚭缁勫悎锛屾洿鍔犳祦鐣呰嚜鐒?/li>
                                    <li>澧炲己娑叉€佺幓鐠冩晥鏋滐細鑳屾櫙閫忔槑搴︽彁楂樿嚦0.78锛屾ā绯婃彁鍗囪嚦26px</li>
                                    <li>淇鍗曡瘝閲嶅闂锛氭敼涓洪殢鏈洪槦鍒楁礂鐗岀畻娉曪紝纭繚200璇嶅叏閮ㄨ疆瀹屾墠閲嶅</li>
                                </ul>
                            </li>
                            <li><strong>TTS璇煶杩涗竴姝ヤ紭鍖?/strong>
                                <ul>
                                    <li>浼樺厛閫夋嫨Google鍦ㄧ嚎璇煶锛堟渶鑷劧锛夛紝鍏舵鍥為€€鍒扮郴缁熻闊?/li>
                                    <li>Google璇煶閫熺巼0.9/闊宠皟1.0锛岄潪Google璇煶閫熺巼0.95/闊宠皟1.1鍑忓皯鏈烘鎰?/li>
                                    <li>璇煶閫夋嫨缁撴灉localStorage鎸佷箙鍖栵紝閬垮厤閲嶅鏌ユ壘</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.33',
                    date: '2026-05-13',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>闆呮€濆崟璇嶇郴缁熷叏闈紭鍖?/strong>
                                <ul>
                                    <li>鎺掔増閲嶆柊璁捐锛屾ā鎷熶笉鑳屽崟璇?鐧捐瘝鏂╅鏍硷紝骞插噣鐧藉簳鏃犳偓娴晥鏋?/li>
                                    <li>TTS璇煶浼樺寲锛岃嚜鍔ㄩ€夋嫨鏈€鑷劧鑻辨枃璇煶锛岃閫熸洿鐪熷疄</li>
                                    <li>澧炲姞瀵归敊鏁伴噺璁板綍锛坙ocalStorage鎸佷箙鍖栵級锛屾纭巼杩涘害鏉℃樉绀?/li>
                                    <li>鍗＄墖婊戝叆/婊戝嚭杩囨浮鍔ㄧ敾锛屾彁鍗囦氦浜掓祦鐣呭害</li>
                                    <li>閫夐」鏀逛负2鍒楃綉鏍煎竷灞€锛岀瓟妗堟纭?閿欒杈规棰滆壊鍙嶉</li>
                                </ul>
                            </li>
                            <li><strong>娓呯悊閬楃暀鏃т唬鐮?/strong>
                                <ul>
                                    <li>绉婚櫎鏃х殑 toggleAIChat 鏃犵敤鍑芥暟</li>
                                    <li>鍒犻櫎鎵€鏈夋棫AI妯℃澘鐩稿叧鐨勭炕璇戦敭锛坅iWelcome銆乪nterYourQuestion銆乻end锛?/li>
                                    <li>鍒犻櫎鏃I姘旀场CSS鏍峰紡锛?ai-msg锛?/li>
                                    <li>鍒犻櫎Taylor Swift鐢诲粖鏃т唬鐮侊紙initTSGallery锛?/li>
                                </ul>
                            </li>
                            <li><strong>淇Git鍚堝苟鍐茬獊瀵艰嚧缃戠珯宕╂簝</strong>
                                <ul>
                                    <li>淇4澶勬畫鐣欑殑鍚堝苟鍐茬獊鏍囪锛圕SS/HTML/JS锛夛紝椤甸潰鎭㈠姝ｅ父</li>
                                </ul>
                            </li>
                            <li><strong>闆呮€濆崟璇嶉〉闈㈡恫鎬佺幓鐠冮鏍奸噸鍋?/strong>
                                <ul>
                                    <li>鍙戦煶鎸夐挳浠巈moji鏀逛负SVG鍠囧彮鍥炬爣+澹版尝鍔ㄧ敾+娑叉€佺幓鐠冨鍣?/li>
                                    <li>TTS璇煶浼橀€?2绉嶈嚜鐒惰闊筹紙Google UK Female/Microsoft Zira绛夛級锛岃閫?.85闊宠皟1.05</li>
                                    <li>鍘绘帀渚嬪彞鏈楄锛屽彧鏈楄鍗曡瘝鏈韩</li>
                                    <li>鍗＄墖/閫夐」/鍙嶉闈㈡澘鍏ㄩ儴鏀逛负娑叉€佺幓鐠冩晥鏋滐紙backdrop-filter姣涚幓鐠冿級</li>
                                    <li>閫夐」鐐瑰嚮姘存尝绾瑰姩鐢?姝ｇ‘寮规€у脊璺?閿欒鎶栧姩鍙嶉</li>
                                    <li>瀵归敊鍙嶉鏍囬鍖哄垎鏄剧ず锛堚渽姝ｇ‘/鉂岀瓟妗堟槸锛?/li>
                                    <li>鍒嗘暟鏁板瓧鐐瑰嚮寮规€ф斁澶у姩鐢?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.32',
                    date: '2026-05-12',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>闆呮€濊瘝姹囧簱鍏ㄩ潰鍗囩骇</strong>
                                <ul>
                                    <li>灏嗗師鏈夊垵涓按骞冲熀纭€璇嶆眹鍏ㄩ潰鏇挎崲涓洪泤鎬濋珮棰戣€冪偣鍗曡瘝</li>
                                    <li>璇嶅簱鎵╁厖鑷?00+涓湡姝ｇ殑闆呮€濇牳蹇冭瘝姹?/li>
                                    <li>璇嶆眹娑电洊 abandon 鍒?yield 绛夐泤鎬濆繀澶囪瘝姹?/li>
                                    <li>姣忎釜鍗曡瘝鍧囧寘鍚爣鍑嗛煶鏍囥€佽嫳鏂囦緥鍙ュ強涓枃缈昏瘧</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.31',
                    date: '2026-05-12',
                    content: `
                        &lt;h4&gt;鏇存柊鍐呭&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift &amp; Jennie涓撻鐢诲粖鏇挎崲涓洪泤鎬濆崟璇嶅涔犵郴缁?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;鍒犻櫎鎵€鏈夊師涓撻椤电殑CSS鏍峰紡锛?idol-銆?ts-寮€澶存牱寮忥級&lt;/li&gt;
                                    &lt;li&gt;鏂板闆呮€濆崟璇嶅涔犵郴缁熷畬鏁存牱寮忥紙.vocab-鍛藉悕绌洪棿锛?lt;/li&gt;
                                    &lt;li&gt;鏇挎崲panelAi闈㈡澘HTML缁撴瀯涓哄崟璇嶅涔犵晫闈?lt;/li&gt;
                                    &lt;li&gt;鏂板200涓泤鎬濇牳蹇冭瘝搴擄紝鍖呭惈鍗曡瘝銆侀煶鏍囥€侀噴涔夈€佷緥鍙?lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;闆呮€濆崟璇嶅涔犵郴缁熷姛鑳?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;鍙屾ā寮忓涔狅細鑻辫瘧涓ā寮忋€佷腑璇戣嫳妯″紡&lt;/li&gt;
                                    &lt;li&gt;鐐瑰嚮馃攰鎸夐挳鍙湕璇昏嫳鏂囧崟璇?lt;/li&gt;
                                    &lt;li&gt;绛斿畬棰樿嚜鍔ㄦ湕璇诲崟璇嶅拰鑻辨枃渚嬪彞&lt;/li&gt;
                                    &lt;li&gt;姣忔闅忔満鐢熸垚4涓€夐」渚涢€夋嫨&lt;/li&gt;
                                    &lt;li&gt;姝ｇ‘绛旀缁胯壊楂樹寒锛岄敊璇瓟妗堢孩鑹叉姈鍔?lt;/li&gt;
                                    &lt;li&gt;绛旈鍚庢樉绀鸿缁嗚В鏋愬拰渚嬪彞&lt;/li&gt;
                                    &lt;li&gt;瀹屽叏鏀寔娣辫壊/娴呰壊涓婚鑷姩閫傞厤&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                        &lt;/ul&gt;
                    `
                },
                {
                    version: 'v0.0.30',
                    date: '2026-05-03 16:00',
                    content: `
                        &lt;h4&gt;鏇存柊鍐呭&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift涓撻椤佃瑙変笌鏋舵瀯鍏ㄩ潰閲嶆瀯&lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;鍒犻櫎鎵€鏈夋棫鐨?.ts- 寮€澶碈SS鏍峰紡&lt;/li&gt;
                                    &lt;li&gt;鏂板鍙屼汉涓撹緫灞曠ず澧欐牱寮忥紙.idol- 鍛藉悕绌洪棿锛?lt;/li&gt;
                                    &lt;li&gt;寮曞叆Google Fonts Great Vibes鎵嬪啓浣?lt;/li&gt;
                                    &lt;li&gt;涓撹緫鍗＄墖hover鏃剁缉鏀?纾ㄧ爞鐜荤拑閬僵鏁堟灉&lt;/li&gt;
                                    &lt;li&gt;SVG绛惧悕鎻忚竟鍔ㄧ敾+瀹炲績濉厖娣″叆&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;浠ｇ爜娓呯悊浼樺寲&lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;鍒犻櫎鍏ㄩ儴Taylor Swift鐢诲粖JavaScript浠ｇ爜&lt;/li&gt;
                                    &lt;li&gt;绉婚櫎浜岀骇鑿滃崟鐩稿叧搴熷純鍑芥暟璋冪敤&lt;/li&gt;
                                    &lt;li&gt;鏇挎崲骞插噣鐨剆witchDockTab鍑芥暟&lt;/li&gt;
                                    &lt;li&gt;浠ｇ爜鏋舵瀯鏇村姞娓呮櫚&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                        &lt;/ul&gt;
                    `
                },
                {
                    version: 'v0.0.29',
                    date: '2026-05-03 15:30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>Taylor Swift涓撻椤典氦浜掑崌绾?/li>
                            <ul>
                                <li>绛惧悕鎵嬪啓鍔ㄧ敾杩涘叆涓撻椤垫椂閲嶆柊鎾斁锛屽苟姣忛殧鏁扮寰幆鎾斁</li>
                                <li>12寮犱笓杈戞捣鎶ユ敼涓烘寜鏃堕棿鍊掑簭灞曠ず锛堟渶鏂颁笓杈戝湪鍓嶏級</li>
                                <li>姣忓紶涓撹緫鏀寔鐐瑰嚮杩涘叆璇︽儏椤?/li>
                                <li>涓撹緫璇︽儏椤垫柊澧炰笓杈戝皝闈€佹椂鏈熺収鐗囥€佷笓杈戞晠浜嬨€佹瓕鏇插垪琛ㄣ€佽儗鏅晠浜?/li>
                                <li>涓撹緫灏侀潰鍜岃鎯呯収鐗囧姞鍏ュ姩鎬佹紓绉诲姩鐢?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.28',
                    date: '2026-05-03 15:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>Taylor Swift涓撻椤靛崌绾т负瀹屾暣12寮犲綍闊冲涓撹緫娴锋姤澧?/li>
                            <ul>
                                <li>鏂板evermore銆丮idnights銆乀he Tortured Poets Department銆乀he Life of a Showgirl</li>
                                <li>椤堕儴Taylor Swift绛惧悕鏀逛负妯℃嫙鐪熷疄鎵嬪啓鎻忚竟鍔ㄧ敾</li>
                                <li>涓撹緫鍗＄墖鍔犲叆鐪熷疄灏侀潰鍥俱€佹捣鎶ュ紡鎺掔増銆佹笎鍏ュ拰鎮仠杩囨浮</li>
                                <li>鏂板鍏紑鐜板満鐓х墖鍖哄煙锛屽寮轰笓棰橀〉瑙嗚灞傛</li>
                            </ul>
                            <li>鏇存柊鈥滄垜鐨勨€濋〉闈㈢増鏈彿涓簐0.0.28</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.27',
                    date: '2026-05-03 14:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>AI鑱婂ぉ鍏ㄩ潰鏇挎崲涓篢aylor Swift涓撻鐢诲粖</li>
                            <ul>
                                <li>绉婚櫎DeepSeek AI鑱婂ぉ鍙夾PI瀵嗛挜</li>
                                <li>鏂板Taylor Swift绛惧悕SVG鏍囬</li>
                                <li>8寮犱笓杈戝崱鐗囩敾寤婏紙Debut鑷砯olklore锛?/li>
                                <li>姣忓紶鍗＄墖娓愬叆鍔ㄧ敾+鎮仠鏀惧ぇ鏁堟灉</li>
                                <li>涓撹緫涓撳睘娓愬彉鑹?SVG瑁呴グ鍥炬爣</li>
                            </ul>
                            <li>鍏ㄩ潰浠ｇ爜瀹¤淇9椤笲ug</li>
                            <li>淇鑱婂ぉ杈撳叆妗嗗湪iOS涓婁綅缃紓甯?/li>
                            <li>绉婚櫎鎵€鏈堿I鐩稿叧浠ｇ爜</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇PC娴忚鍣ㄦ墦寮€绌虹櫧椤甸棶棰?/li>
                            <li>淇iOS鐏靛姩宀?鍒樻捣灞忓尯鍩熻瑙夐€傞厤</li>
                            <li>淇登录鏃堕棿涓嶆洿鏂伴棶棰?/li>
                            <li>淇注册鏃堕棿/登录鏃堕棿鏄剧ず涓?-"鐨勯棶棰?/li>
                            <li>iOS Safari娴忚鍣ㄥ畬鏁撮€傞厤</li>
                            <li>淇搴曢儴瀵艰埅鏍?閫氱煡/Toast鍦╥OS鍒樻捣灞忎笅浣嶇疆寮傚父</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>缁熶竴鍏憡鍒楄〃/璇︽儏/鏇存柊鏃ュ織鐨勬牱寮忓ぇ灏忥紙瀛椾綋/闂磋窛閮界粺涓€璺熸洿鏂版棩蹇椾竴鑷达級</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>褰诲簳淇头像鏌ヨ锛氭墍鏈夊ご鍍忔煡璇㈠己鍒跺姞 actor_key=__avatar__锛屽交搴曟帓闄ゆ棫鏁版嵁骞叉壈</li>
                            <li>淇鎵嬫満搴曢儴瀵艰埅寰€涓婇锛坧osition:fixed+閫傞厤瀹夊叏鍖哄煙锛?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇鍏憡鍙戝竷澶辫触bug锛堜笉鐢╰itle鍒楋紝JSON瀛榗ontent锛?/li>
                            <li>淇鐐瑰嚮头像/涓汉璧勬枡鏄剧ず鏃уご鍍忥紙maybeSingle鈫抣imit(1)+涓婁紶鍏堝垹鍚庢彃锛屾潨缁濋噸澶嶈褰曪級</li>
                            <li>淇鑱婂ぉ鍒楄〃鍔犺浇鎱紙limit 1000鈫?00锛岀紦瀛?0绉掆啋120绉掞級</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇鍏朵粬鐢ㄦ埛鐪嬩笉鍒版渶鏂板ご鍍忥紙loadAvatarsForUsers鎺掑簭鍙栨渶鏂帮級</li>
                            <li>淇搴曢儴瀵艰埅鏍忓彲琚粦鍔ㄩ棶棰橈紙touch-action绂佹鎵嬪娍锛?/li>
                            <li>褰诲簳鍘绘帀椤甸潰鍙充晶绔栨粦鍔ㄦ潯锛坔tml/body overflow:hidden锛?/li>
                            <li>淇登录鏃堕棿涓嶆洿鏂癰ug锛堟瘡娆℃墦寮€椤甸潰鍒锋柊登录鏃堕棿锛?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇头像杩囦竴浼氬効鑷姩鍥為€€bug锛坙ocalStorage鏉冨▉浼樺厛锛孌B涓嶅啀瑕嗙洊锛?/li>
                            <li>鍘绘帀璇勮头像锛屽彧鏄剧ず鍚嶅瓧</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇鑱婂ぉ鍒楄〃鎵撳紑绌虹櫧/鍔犺浇鎱㈤棶棰?/li>
                            <li>鑱婂ぉ鍒楄〃鍚庡彴棰勫姞杞斤紝鐐瑰紑绉掑嚭</li>
                            <li>褰诲簳鍘绘帀甯栧瓙鍒楄〃鍙充晶绔栨粦鍔ㄦ潯</li>
                            <li>淇甯栧瓙婊戝姩鍗￠】/鎶芥悙鎶栧姩锛堜粎娣″叆涓€娆?鍥剧墖鍔犺浇浼樺寲锛?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.19',
                    date: '2026-05-03 09:10',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇鍒锋柊缃戦〉鍚庡ご鍍忓洖閫€bug</li>
                            <li>头像鐓х墖鍘嬬缉杩涗竴姝ュ噺灏忥紙80x80 @0.4锛?/li>
                            <li>淇鏇存崲头像鍚庝笉鏇存柊鐨刡ug</li>
                            <li>甯栧瓙鍒掑叆鍒掑嚭鍔ㄧ敾閲嶈璁★細娣″叆+涓婄Щ銆佹贰鍑?涓嬬Щ</li>
                            <li>鍘绘帀甯栧瓙鍜岃瘎璁虹殑hover鎮诞鏁堟灉</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.18',
                    date: '2026-05-03 08:30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇鏇存崲头像鍚庝笉鏇存柊鐨刡ug锛堝交搴曚慨澶嶏級</li>
                            <li>鍘绘帀搴曢儴瀵艰埅鏍忕偣鍑绘椂鐨勯粦鑹叉锛堝交搴曚慨澶嶏級</li>
                            <li>甯栧瓙鍔犺浇鍔ㄧ敾浠庢粦鍏ユ敼鎴愭贰鍏?/li>
                            <li>淇注册鏃堕棿涓庣櫥褰曟椂闂寸浉鍚岀殑bug锛堝交搴曚慨澶嶏級</li>
                            <li>头像涓婁紶鍘嬬缉浼樺寲锛?28x128锛?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.17',
                    date: '2026-05-02 17:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鍔ㄧ敾鏁堟灉鍑忓崐浼樺寲</li>
                            <ul>
                                <li>甯栧瓙婊戝叆鍔ㄧ敾閫熷害鍑忓崐锛宼ranslateY璺濈鍑忓崐</li>
                                <li>鎵€鏈夋寜閽甴over鍔ㄧ敾骞呭害鍑忓崐锛堝簳閮ㄥ鑸爮闄ゅ锛?/li>
                                <li>鍖呮嫭hover涓婃诞銆佺缉鏀俱€佹棆杞瓑鍔ㄧ敾鍧囧噺鍗?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.16',
                    date: '2026-05-02 16:53',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>头像鐐瑰嚮琛屼负浼樺寲</li>
                            <ul>
                                <li>鐐瑰嚮甯栧瓙鍜岃瘎璁轰腑鐨勫ご鍍忎笉鍐嶇洿鎺ヨ烦杞亰澶?/li>
                                <li>鏂板鐢ㄦ埛璧勬枡鍗＄墖寮圭獥锛屾樉绀哄ご鍍忋€佺敤鎴峰悕銆佹渶杩戠櫥褰曟椂闂?/li>
                                <li>璧勬枡鍗＄墖涓偣鍑?鍙戞秷鎭?鎸夐挳鎵嶈烦杞埌鑱婂ぉ瀵硅瘽</li>
                            </ul>
                            <li>缁熻鐗堝潡鍔犺浇閫熷害浼樺寲</li>
                            <ul>
                                <li>缁熻鏁版嵁澧炲姞30绉掑唴瀛樼紦瀛橈紝浜屾鎵撳紑绉掑嚭</li>
                                <li>鍚庡彴棰勫姞杞界粺璁℃暟鎹紝棣栨鎵撳紑涔熸洿蹇?/li>
                            </ul>
                            <li>鑱婂ぉ鍔熻兘头像鏄剧ず</li>
                            <ul>
                                <li>鐢ㄦ埛鑱婂ぉ娑堟伅澧炲姞鍙屾柟头像鏄剧ず</li>
                                <li>鑱婂ぉ鍒楄〃鏄剧ず鑱旂郴浜虹湡瀹炲ご鍍?/li>
                                <li>AI瀵硅瘽涓樉绀虹敤鎴风湡瀹炲ご鍍?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.15',
                    date: '2026-05-02 16:30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>头像涓婁紶鍘嬬缉浼樺寲</li>
                            <ul>
                                <li>头像涓婁紶鍓嶈嚜鍔ㄥ帇缂╄嚦256x256锛孞PEG璐ㄩ噺0.7</li>
                                <li>澶у箙鍑忓皯base64浣撶Н锛岄槻姝㈠瓨鍌ㄦ孩鍑哄拰鍔犺浇澶辫触</li>
                                <li>涓婁紶澶у皬闄愬埗鏀惧鑷?0MB</li>
                            </ul>
                            <li>鐢ㄦ埛注册/登录鏃堕棿褰诲簳淇</li>
                            <ul>
                                <li>閲嶆瀯鐢ㄦ埛淇℃伅瀛樺彇涓虹粺涓€saveUserInfo鍑芥暟</li>
                                <li>update澶辫触鏃惰嚜鍔╢allback鍒癲elete+insert</li>
                                <li>绠＄悊鍛樼櫥褰曞悓鏍锋纭褰曠櫥褰曟椂闂?/li>
                                <li>鍚庡彴甯栧瓙璁℃暟鎺掗櫎鐢ㄦ埛淇℃伅璁板綍</li>
                            </ul>
                            <li>鏁版嵁搴揜LS绛栫暐瀹屽杽</li>
                            <ul>
                                <li>鏂板fix_user_info_rls.sql纭繚UPDATE/DELETE绛栫暐瀛樺湪</li>
                                <li>鎵╁ぇactor_key鍜宑ontent闀垮害闄愬埗</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.14',
                    date: '2026-05-02 16:20',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>头像涓婁紶瀵艰嚧鐨勮繛閿侀棶棰樹慨澶?/li>
                            <ul>
                                <li>淇涓婁紶头像鍚庡笘瀛愰〉涓€鐩存樉绀?鍔犺浇澶辫触锛屽埛鏂伴噸璇?鐨勪弗閲峛ug</li>
                                <li>淇头像base64鏁版嵁鎾戠垎localStorage瀵艰嚧椤甸潰宕╂簝</li>
                                <li>淇"鎴戠殑椤甸潰"头像涓嶆樉绀虹殑闂</li>
                                <li>淇閫€鍑虹櫥褰曞悗鏃х紦瀛樺共鎵扮殑闂</li>
                                <li>浼樺寲鏁版嵁鏌ヨ锛屾帓闄ゅご鍍忚褰曞噺灏戝搷搴斾綋绉?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.13',
                    date: '2026-05-02 14:58',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>头像鍔熻兘淇</li>
                            <ul>
                                <li>淇头像涓婁紶鍚庝綔涓哄笘瀛愭樉绀虹殑闂</li>
                                <li>淇鍒锋柊椤甸潰鍚庡ご鍍忔秷澶辩殑闂</li>
                                <li>头像涓婁紶鎴愬姛鍚庤嚜鍔ㄥ埛鏂癴eed鏄剧ず鏂板ご鍍?/li>
                                <li>鏇存柊头像缂撳瓨鏈哄埗锛岀‘淇濆ご鍍忔纭樉绀?/li>
                            </ul>
                            <li>鎬ц兘浼樺寲</li>
                            <ul>
                                <li>浼樺寲甯栧瓙娓叉煋鎬ц兘锛岄鏋勫缓璇勮鍜岀偣璧炴槧灏勮〃</li>
                                <li>鎻愬崌鏁翠綋娴佺晠搴︼紝鍑忓皯鍗￠】</li>
                            </ul>
                            <li>鍏憡绯荤粺浼樺寲</li>
                            <ul>
                                <li>淇鍏憡鍙戝竷鍖哄煙鍥哄畾涓嶅姩鐨勯棶棰橈紝鐜板湪浼氶殢鍐呭婊氬姩</li>
                            </ul>
                            <li>鍚庡彴绠＄悊浼樺寲</li>
                            <ul>
                                <li>淇鐢ㄦ埛注册鍜岀櫥褰曟椂闂翠繚瀛橀棶棰橈紝娣诲姞actor_key纭繚鏁版嵁姝ｇ‘鍐欏叆</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.12',
                    date: '2026-05-02 01:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鏂板娑堟伅閫氱煡鍔熻兘</li>
                            <ul>
                                <li>鏀跺埌鏂版秷鎭椂椤堕儴寮瑰嚭娑叉€佺幓鐠冮鏍奸€氱煡</li>
                                <li>鏄剧ず鍙戦€佽€呭ご鍍忋€佺敤鎴峰悕鍜屾秷鎭唴瀹?/li>
                                <li>閫氱煡3绉掑悗鑷姩娣″嚭鏀跺洖</li>
                                <li>鐐瑰嚮閫氱煡鐩存帴璺宠浆鍒板搴旇亰澶╁璇?/li>
                                <li>鏅鸿兘鍒ゆ柇锛氬凡鍦ㄨ亰澶╂椂涓嶉噸澶嶅脊鍑?/li>
                            </ul>
                            <li>鍚庡彴绠＄悊鍔熻兘淇</li>
                            <ul>
                                <li>淇鏂版敞鍐岀敤鎴凤紙鏃犲彂甯栬褰曪級涓嶆樉绀虹殑闂</li>
                                <li>纭繚鎵€鏈夋敞鍐岀敤鎴烽兘鑳藉湪鍚庡彴姝ｇ‘灞曠ず</li>
                            </ul>
                            <li>缁熻椤甸潰浼樺寲</li>
                            <ul>
                                <li>淇璇勮璁板綍鏃堕棿鎺掑簭闂</li>
                                <li>鏈€鏂拌瘎璁虹幇鍦ㄦ樉绀哄湪鏈€涓婃柟</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.11',
                    date: '2026-05-02',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>涓汉璧勬枡绯荤粺鍏ㄩ潰鍗囩骇</li>
                            <ul>
                                <li>鏂板涓汉璧勬枡璇︽儏椤碉紙澶уご鍍忋€佺敤鎴峰悕銆佺敤鎴稩D銆佹敞鍐屾椂闂达級</li>
                                <li>鏀寔鑷畾涔夊ご鍍忎笂浼狅紙鏈€澶?MB锛?/li>
                                <li>甯栧瓙鍜岃瘎璁哄尯鍩熸樉绀虹敤鎴疯嚜瀹氫箟头像</li>
                                <li>涓汉璧勬枡椤垫柊澧為€€鍑虹櫥褰曟寜閽?/li>
                            </ul>
                            <li>娓稿妯″紡瀹屽杽</li>
                            <ul>
                                <li>鏈櫥褰曠敤鎴峰彧鑳芥煡鐪嬶紝涓嶈兘鍙戝竷/鐐硅禐/璇勮</li>
                                <li>鏈櫥褰曟椂鍙戝竷鍖哄煙鑷姩闅愯棌</li>
                                <li>鐐瑰嚮鎿嶄綔鏃惰嚜鍔ㄦ彁绀虹櫥褰?/li>
                            </ul>
                            <li>鍏憡绯荤粺淇</li>
                            <ul>
                                <li>淇鍏憡璇︽儏椤甸潰鍐呭涓嶆樉绀虹殑闂</li>
                            </ul>
                            <li>鍚庡彴绠＄悊鍔熻兘澧炲己</li>
                            <ul>
                                <li>鏂板鐢ㄦ埛注册鏃堕棿鍜屾渶杩戠櫥褰曟椂闂存樉绀?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.10',
                    date: '2026-05-02',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鏂板銆屾垜鐨勩€嶉〉闈?/li>
                            <ul>
                                <li>娣辫壊/娴呰壊妯″紡鍒囨崲寮€鍏?/li>
                                <li>璇█鍒囨崲鍔熻兘</li>
                                <li>閫氱煡璁剧疆閫夐」</li>
                                <li>鍏充簬搴旂敤淇℃伅</li>
                                <li>缁熶竴鐧借壊纾ㄧ爞椋庢牸璁捐</li>
                            </ul>
                            <li>銆屾垜鐨勩€嶆寜閽姩鐢讳紭鍖?/li>
                            <ul>
                                <li>鐐瑰嚮鎸夐挳鏃舵樉绀?鏉″僵鑹插厜娉粠灏忎汉鑴戣涓婃柟鏁ｅ皠鐨勫姩鐢?/li>
                            </ul>
                            <li>搴曢儴瀵艰埅鏍忔暣浣撲紭鍖?/li>
                            <ul>
                                <li>AI鑺辨湹鎸夐挳鐐瑰嚮鑼冨洿瀵归綈</li>
                                <li>鍥涙寜閽ぇ灏忕粺涓€瑙勮寖</li>
                                <li>瑙嗚骞宠　搴︽彁鍗?/li>
                            </ul>
                            <li>AI椤甸潰鍔ㄧ敾鍗囩骇</li>
                            <ul>
                                <li>鑺辨湹鍔ㄧ敾鏀逛负閫愮摚椋炴暎鏁堟灉锛堜笌瀵艰埅鏍忔寜閽繚鎸佷竴鑷达級</li>
                                <li>闂數鍒囨崲鎸夐挳鏀逛负SVG鍥炬爣锛岃瑙夋洿绮捐嚧</li>
                                <li>鍔ㄧ敾杩囨浮鏇存祦鐣呰嚜鐒?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.9',
                    date: '2026-05-02',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鍏憡绯荤粺鍔熻兘澧炲己</li>
                            <ul>
                                <li>绠＄悊鍛樺彂甯冨叕鍛婃椂鍙€夋嫨杈撳叆鏍囬鍜屽唴瀹癸紙涓嶅己鍒讹紝鑷冲皯濉啓涓€椤癸級</li>
                                <li>鐢ㄦ埛鏌ョ湅鍏憡鍒楄〃鏃跺睍绀哄叕鍛婃爣棰?/li>
                                <li>鍏憡璇︽儏椤垫柊澧炲彂甯冭€呬俊鎭睍绀猴紙头像 + 鐢ㄦ埛鍚嶏級</li>
                                <li>绠＄悊鍚庡彴鍏憡鍒楄〃鏂板鏍囬銆佸彂甯冭€呭垪鏄剧ず</li>
                                <li>绠＄悊鍚庡彴鏂板鏍囬杈撳叆妗?/li>
                                <li>閫傞厤娣辫壊/娴呰壊涓婚</li>
                                <li>淇濇寔鍘熸湁鐧借壊纾ㄧ爞椋庢牸缁熶竴</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.8',
                    date: '2026-05-02',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鍏憡绯荤粺瑙嗚涓庝氦浜掍紭鍖?/li>
                            <ul>
                                <li>鍏憡妯℃€佹鏀逛负涓庢€诲姩鎬佹€绘祻瑙堝畬鍏ㄤ竴鑷寸殑鐧借壊纾ㄧ爞椋庢牸</li>
                                <li>鍏憡鍒楄〃椤规牱寮忕粺涓€涓虹櫧鑹茬（鐮傛晥鏋?/li>
                                <li>瀹屽叏绉婚櫎鍏憡鍐呭鍖哄煙鐨勬粴鍔ㄦ潯</li>
                                <li>绂佹鍏憡鍖哄煙妯悜鎷栨嫿婊氬姩</li>
                                <li>鍏憡璇︽儏澶撮儴浼樺寲甯冨眬锛屼慨澶嶅垹闄ゆ寜閽綅缃?/li>
                            </ul>
                            <li>鑱婂ぉ涓嶢I鍖哄煙瑙嗚缁熶竴</li>
                            <ul>
                                <li>鑱婂ぉ杈撳叆鍖哄煙鑳屾櫙鏀逛负閫忔槑锛屼笌鑳屾櫙鑹蹭竴鑷?/li>
                                <li>AI瀹瑰櫒鑳屾櫙瀹屽叏閫忔槑鍖?/li>
                                <li>AI杈撳叆妗嗐€佹ā寮忓垏鎹㈡寜閽€丄I姘旀场缁熶竴涓虹（鐮傞鏍?/li>
                                <li>浼樺寲AI娑堟伅姘旀场涓庢€濊€冭繃绋嬪崱鐗囨牱寮?/li>
                            </ul>
                            <li>娣辫壊/娴呰壊涓婚鍏ㄩ潰閫傞厤</li>
                            <ul>
                                <li>鍏憡绯荤粺娣辫壊妯″紡瀹屽叏瀵归綈鎬诲姩鎬侀鏍?/li>
                                <li>鎵€鏈夊厓绱犳敮鎸佷富棰樿嚜鍔ㄥ垏鎹?/li>
                            </ul>
                            <li>鎬ц兘涓庢祦鐣呭害浼樺寲</li>
                            <ul>
                                <li>浼樺寲鍏憡鍒楄〃鍔ㄧ敾鏁堟灉</li>
                                <li>娣诲姞will-change灞炴€ф彁鍗囨覆鏌撴€ц兘</li>
                                <li>浼樺寲浜嬩欢澶勭悊閫昏緫</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.7',
                    date: '2026-05-02',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鏂板鍏憡閫氱煡绯荤粺</li>
                            <ul>
                                <li>鍏憡閾冮摏鎸夐挳锛堢櫥褰曞悗鍙锛?/li>
                                <li>鏈鍏憡璁℃暟鎻愮ず</li>
                                <li>鍏憡璇︽儏鏌ョ湅涓庡垪琛ㄨ繑鍥炲姛鑳?/li>
                                <li>鍏憡鍙戝竷涓庡垹闄ょ鐞嗘潈闄?/li>
                            </ul>
                            <li>鏂板鐙珛绠＄悊鍚庡彴椤甸潰</li>
                            <ul>
                                <li>澶氱淮搴︽暟鎹鐞嗛潰鏉?/li>
                                <li>鍏憡鍙戝竷绠＄悊</li>
                                <li>鐢ㄦ埛鍙婂唴瀹规暟鎹煡鐪?/li>
                                <li>鍝嶅簲寮忚璁￠€傞厤</li>
                            </ul>
                            <li>鍏憡鏁版嵁涓庝富搴旂敤瀹屽叏浜掗€?/li>
                            <li>浼樺寲浜や簰杩囨浮鍔ㄧ敾鎻愬崌娴佺晠搴?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>浼樺寲椤堕儴瀵艰埅鏍忎氦浜?/li>
                            <ul>
                                <li>鍘婚櫎閲嶅鑱婂ぉ鍏ュ彛</li>
                                <li>浼樺寲搴曢儴 Dock 鏍忕偣鍑诲尯鍩燂紝鍏佽妗嗗鍖哄煙浜や簰</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.5',
                    date: '2026-04-30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>涓夊ぇ鏍稿績鍔熻兘鎸夐挳SVG鍔ㄧ敾浼樺寲</li>
                            <ul>
                                <li>閲嶆柊璁捐甯栧瓙鎸夐挳閽㈢瑪缁樺埗鍔ㄧ敾</li>
                                <li>閲嶆柊璁捐鑱婂ぉ鎸夐挳姘旀场鍔ㄧ敾</li>
                                <li>AI鎸夐挳鏇存崲涓鸿姳鏈电唤鏀句笌鑺辩摚褰掍綅鍔ㄧ敾</li>
                                <li>鎵€鏈夊姩鐢绘敮鎸佹寜閽鍖哄煙鏄剧ず</li>
                                <li>涓ユ牸浣跨敤CSS @keyframes瀹炵幇</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.4',
                    date: '2026-04-29',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>涓夊ぇ鏍稿績鍔熻兘鎸夐挳鍏ㄦ柊SVG鍔ㄧ敾瀹炵幇</li>
                            <ul>
                                <li>甯栧瓙鎸夐挳閽㈢瑪璺緞缁樺埗锛?.5绉掞級</li>
                                <li>鑱婂ぉ鎸夐挳鎵撳瓧鐐逛笌姘旀场鍔ㄧ敾锛?绉掞級</li>
                                <li>AI鎸夐挳鑴夊啿鍙戝厜鏁堟灉锛?.8绉掞級</li>
                                <li>浣跨敤stroke-dasharray/dashoffset鎶€鏈?/li>
                                <li>绾疌SS瀹炵幇锛屾棤瀹氭椂鍣ㄤ緷璧?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.3',
                    date: '2026-04-28',
                    content: `
                        <h4>鍒濆鐗堟湰</h4>
                        <ul>
                            <li>鍩虹鍔熻兘妗嗘灦鎼缓</li>
                            <li>鐢ㄦ埛璁よ瘉绯荤粺</li>
                            <li>甯栧瓙鍙戝竷涓庢祻瑙?/li>
                            <li>璇勮涓庣偣璧炲姛鑳?/li>
                            <li>绉佷俊鑱婂ぉ绯荤粺</li>
                            <li>AI瀵硅瘽鍔熻兘</li>
                            <li>娣辫壊/娴呰壊涓婚鍒囨崲</li>
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
                            <div class="changelog-version">馃殌 ${item.version}</div>
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
            // 缁戝畾鍒囨崲浜嬩欢
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 淇敼鍘熸湁鐨?showAnnouncementList 浠ユ敮鎸佸綋鍓嶆爣绛剧姸鎬?
            const originalShowAnnouncementList = showAnnouncementList;
            window.showAnnouncementList = function() {
                if (currentAnnouncementTab !== 'announcements') {
                    switchAnnouncementTab('announcements');
                }
                originalShowAnnouncementList();
            };

            // 缁戝畾鍏憡鎸夐挳浜嬩欢
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
