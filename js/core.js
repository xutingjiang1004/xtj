﻿﻿﻿﻿﻿// Spring loader CSS is now in style.css - old CSS removed
console.log('[XTJ] core.js loaded, starting...');


            const SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
            const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";
            var sb;
            if (typeof window.supabase !== 'undefined') {
                sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            } else {
                console.error('Supabase SDK not loaded');
                document.addEventListener('DOMContentLoaded', function() {
                    var feedEl = document.getElementById('feed');
                    if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">服务加载失败，请刷新页面重试</div>';
                });
            }
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
            let avatarCache = {};

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
        const viewTracked = new Set();
        let postVisibilityObserver = null;
        function primePostReveal(nodes) {
            Array.from(nodes || []).forEach(function(post, index) {
                if (!post || post.classList.contains('visible')) return;
                post.style.setProperty('--post-enter-delay', Math.min(index, 5) * 42 + 'ms');
            });
        }
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
        const CACHE_DURATION = 5 * 60 * 1000; // 缂傛挸锟?鍒嗭拷锟?

        const POST_METADATA_MARKER = "__xtj_post_v2__";
        const POST_META_DEFAULTS = {
            visibility: "public",
            is_pinned: false,
            pinned_at: null,
            updated_at: null,
            edited_at: null,
            fileSize: null,
            originalSize: null,
            mimeType: ""
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
        let postFilterUsersLoaded = false;
        let postFilterUsersLoading = false;
        let postFilterUsers = [];
        let postFilterUsersLoadSeq = 0;
        let postFilterUsersLoadTimer = null;

        function stopPostFilterUsersLoading() {
            if (postFilterUsersLoadTimer) {
                clearTimeout(postFilterUsersLoadTimer);
                postFilterUsersLoadTimer = null;
            }
            postFilterUsersLoading = false;
        }

        function renderPostFilterUserLoader() {
            return '<div class="xtj-magic-loading" style="display:flex;align-items:center;justify-content:center;min-height:140px;padding:16px 0;">' +
                '<div class="spring-loader" style="width:120px;height:120px;margin:0 auto;">' +
                '<canvas class="spring-canvas" width="120" height="120" style="width:120px;height:120px;" aria-hidden="true"></canvas>' +
                '</div></div>';
        }

        function isAdmin() { return currentUser === ADMIN_NAME; }

        function clearFeedCache() {
            try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
        }
        window.clearFeedCache = clearFeedCache;

        var _photoWallLoaded = false;
        var _photoWallLoading = null;
        function ensurePhotoWallLoaded() {
            if (_photoWallLoaded) return Promise.resolve();
            if (_photoWallLoading) return _photoWallLoading;
            var scripts = [
                'js/photo-wall/data.min.js',
                'js/photo-wall/render.min.js',
                'js/photo-wall/upload.min.js',
                'js/photo-wall/preview.min.js',
                'js/photo-wall/photo-wall.min.js'
            ];
            _photoWallLoading = new Promise(function(resolve, reject) {
                function loadNext(idx) {
                    if (idx >= scripts.length) {
                        _photoWallLoaded = true;
                        _photoWallLoading = null;
                        resolve();
                        return;
                    }
                    var s = document.createElement('script');
                    s.src = scripts[idx];
                    s.onload = function() { loadNext(idx + 1); };
                    s.onerror = function() { reject(new Error('Failed to load ' + scripts[idx])); };
                    document.body.appendChild(s);
                }
                loadNext(0);
            });
            return _photoWallLoading;
        }

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
            var realVisibility = post && typeof post.visibility === "string" && post.visibility ? post.visibility : "";
            var hasRealPinned = !!(post && (post.is_pinned === true || post.is_pinned === false));
            var hasRealPinnedAt = !!(post && post.pinned_at);
            var hasRealUpdatedAt = !!(post && post.updated_at);
            return Object.assign({}, post, {
                content: parsed.text || "",
                visibility: realVisibility || meta.visibility || "public",
                is_pinned: hasRealPinned ? !!post.is_pinned : !!meta.is_pinned,
                pinned_at: hasRealPinnedAt ? post.pinned_at : (meta.pinned_at || null),
                updated_at: hasRealUpdatedAt ? post.updated_at : (meta.updated_at || null),
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
            return !!currentUser && isAdmin();
        }
        window.canPinPost = canPinPost;

        function canDeletePost(post) {
            var p = normalizePost(post);
            if (!currentUser) return false;
            if (isAdmin()) return true;
            if (p.user_name && p.user_name === currentUser) return true;
            return !p.user_name && !!deviceId && !!p.actor_key && p.actor_key === deviceId;
        }
        window.canDeletePost = canDeletePost;

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
            var activeCount = 0;
            if (state.keyword) activeCount++;
            if (state.user) activeCount++;
            if (state.startDate || state.endDate) activeCount++;
            if (state.onlyMine) activeCount++;
            if (state.visibility && state.visibility !== "all") activeCount++;
            var badge = document.getElementById("filterActiveBadge");
            if (badge) {
                badge.textContent = activeCount;
                badge.style.display = activeCount > 0 ? "inline-flex" : "none";
            }
            var clearBtn = document.getElementById("filterClearBtn");
            if (clearBtn) clearBtn.style.display = activeCount > 0 ? "" : "none";
            var hasFilters = activeCount > 0;
            if (!hasFilters) {
                el.textContent = "全部帖子";
            } else if (!count) {
                el.textContent = "没有找到相关帖子";
            } else {
                el.textContent = "找到 " + count + " 条结果";
            }
        }
        window.renderFilterSummary = renderFilterSummary;

        // ========== 閻樿鎷烽敓鐣岊吀閻炲棗鎳￠崥宥団敄闂达紙鍚戝悗鍏硷拷顔愰敓?==========
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
            if (!container) { console.warn("showToast: toastContainer not found"); return; }
            const toast = document.createElement('div');
            toast.className = 'toast';
            if (typeof window.__xtjUiTextRepair === 'function') {
                try { message = window.__xtjUiTextRepair(message); } catch (e) {}
            }
            toast.textContent = message == null ? '' : String(message);
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
            
            // FLIP Animation: Step 1 - First (锟斤拷录鎸夐挳浣嶇疆)
            var origin = window._confirmOrigin;
            
            // FLIP Animation: Step 2 - Last (设置鏈拷缁堢姸锟?
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
            
            // FLIP Animation: Step 3 - Invert (鐠侊紕鐣诲顔肩磽楠炶泛寮介崥鎴濆綁锟?
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
                    
                    // FLIP Animation for Close: 鑾峰彇閿熸枻鎷峰墠瀵湱鐛ユ担宥囷拷?
                    var dialogRect = dialog.getBoundingClientRect();
                    
                    // 鑾峰彇鍒犻敓鏂ゆ嫹鎸夐挳閿熸枻鎷峰墠娴ｅ秶锟?
                    var deleteBtn = document.getElementById('ppDeleteBtn');
                    var btnRect = deleteBtn ? deleteBtn.getBoundingClientRect() : null;
                    
                    var targetDx = o.dx;
                    var targetDy = o.dy;
                    var targetScale = o.scale || 0.3;
                    
                    if (btnRect) {
                        // 浣跨敤鎸夐挳锟斤拷前浣嶇疆锟斤紕鐣婚惄顔斤拷锟藉彉鎹?
                        targetDx = btnRect.left + btnRect.width / 2 - dialogRect.left - dialogRect.width / 2;
                        targetDy = btnRect.top + btnRect.height / 2 - dialogRect.top - dialogRect.height / 2;
                        
                        var btnSize = Math.sqrt(btnRect.width * btnRect.width + btnRect.height * btnRect.height);
                        var dialogSize = Math.sqrt(dialogRect.width * dialogRect.width + dialogRect.height * dialogRect.height);
                        targetScale = btnSize / dialogSize * 0.6;
                    }
                    
                    // Step 3 - Invert: 娣囶喗绻冪€垫柨缍嬮崜宥囧Ц锟?
                    dialog.style.transition = 'none';
                    dialog.style.transform = 'translate(0, 0) scale(1)';
                    dialog.style.opacity = '1';
                    void dialog.offsetHeight;
                    
                    // Step 4 - Play: 鎾斁椋炲洖鍔拷??
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

            // ===================== 密码閸濆牆?=====================
            async function hashPassword(password) {
                const encoder = new TextEncoder();
                const data = encoder.encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ===================== 闁谎嗩嚙缂?/ 婵炲鍔岄崬?/ 闁谎嗩嚙閸?=====================
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

                    // 浼樺厛浠?__auth__ 记录鑾峰彇娉ㄥ唽时间閿涘牊娓舵潈濞侊拷??
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

                    // 閸氬骸顦敍姘矤閻滅増锟?__user_info__ 涓锟?reg_time閿涘牏鏁imit(1)闁兼澘鐭傚鐚癮ybeSingle閿涘苯顔愰敊锟筋樋琛岋拷锟?
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

                    // 閺堫澁鎷烽崥搴℃倵婢跺浄绱伴弬鎵暏閹撮鏁ら敓鏂ゆ嫹鍓嶆椂閿熸枻锟?
                    if (!regTime && isNewUser) {
                        regTime = new Date().toISOString();
                    }

                    var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
                    var contentStr = JSON.stringify(userInfo);

                    // 灏濊瘯找到锟筋澁鎷烽弬棰佺閺壜ゎ唶瑜版洖鑻烾PDATE锛堟瘮DELETE+INSERT闁哄洦娼欒ぐ鏌ユ閻欏懐绀夐梺顒€鐏濋崢顥窵S闁归攱甯炵划绋LETE闁?
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
                                console.log("saveUserInfo [更新] " + name + " 登录时间 (UPDATE): " + userInfo.last_login);
                            }
                        }
                    } catch(e) {}

                    // UPDATE失败鎴栨棤记录鏃讹紝INSERT涓€鏉℃柊记录
                    if (!updated) {
                        var insertRes = await sb.from("posts").insert([{
                            user_name: name,
                            content: contentStr,
                            media_type: "__user_info__",
                            actor_key: "__user_info__"
                        }]);
                        if (insertRes.error) {
                            console.error("saveUserInfo insert濠㈡儼绮剧憴?", insertRes.error.message);
                        } else {
                            console.log("saveUserInfo [鎻掑叆] " + name + " 登录时间 (INSERT): " + userInfo.last_login);
                        }
                    }
                } catch(e) {
                    console.error("saveUserInfo濠㈡儼绮剧憴?", e);
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
                btn.textContent = "验证中..";

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
                    showToast("登录成功，欢迎回来！" + name);
                    closeModal('loginModal');
                    
                    // 更新闁哄牃鍋撻弶鈺傚灩濞呫儴銇愭洘锟筋槯闂?
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
                btn.textContent = "注册中..";

                try {
                    const existing = await findAuthRecord(name);
                    if (existing) {
                        showToast("昵称 '" + name + "' 已被注册，请换一个");
                        btn.disabled = false; btn.textContent = "注册中..";
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
                        btn.disabled = false; btn.textContent = "注册失败";
                        return;
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("注册成功，欢迎你！" + name);
                    closeModal('registerModal');
                    
                    // 濞ｅ洦绻傞悺銊╂偨閵婏箑鐓曟繛澶堝妼閸炶姤绌遍鐟板⒉濞?
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

            // ========== 查看鍏兼湹绮敤鎴疯祫鏂欏崱锟?==========
            let upcTargetUser = null;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細加载涓?..';
                
                var avatarEl = document.getElementById('upcAvatar');
                // localStorage鏉冿拷鈻夐敓鏂ゆ嫹閿熸枻鎷烽敍姘秼閸撳秶鏁ら幋宄板帥濡澁鎷烽弻銉︽拱閸︽壆绱﹂敓?
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
                    msgBtn.textContent = '发消息';
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 瀵倹加载头像閸滃瞼娅ヨぐ鏇熸??
                try {
                    // 褰撳墠用户浼樺厛浣跨敤localStorage闂佸搫顦崯顐﹀煝婢跺瞼澶勯悗?
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
                        // 闈炲綋鍓嶇敤鎴锋墠鐢―B閸婂吋娲块弬鎵处鐎涙﹫绱欓敓鏂ゆ嫹鍓嶉敓鐭紮鎷峰鎻掓躬娑撳﹪娼伴悽鈺╫calStorage设置閿?
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
                                document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細-';
                            }
                        } catch(e) {
                            document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細-';
                        }
                    } else {
                        document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細-';
                    }
                } catch(e) {
                    document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細加载失败';
                }
            };

            window.upcSendMessage = function() {
                if (!upcTargetUser || !currentUser) return;
                closeModal('userProfileModal');
                setTimeout(function() { openChat(upcTargetUser); }, 300);
            };

            // ========== 娑撴眽璧勬枡璇︽儏功能 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 濠靛鍋勯崢鏍春閻戞ɑ鎷卞ǎ鍥ｅ墲浼?
                document.getElementById('profileDetailName').textContent = currentUser;
                document.getElementById('profileDetailId').textContent = currentUser;
                
                // 鑾峰彇锟矫伙拷淇℃伅锛堟敞鍐屾椂闂寸瓑锟?
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
                    console.error("鑾峰彇用户淇℃伅失败:", e);
                    document.getElementById('profileDetailRegTime').textContent = '-';
                }
                
                // 加载头像
                loadProfileAvatar();
                
                openModal('profileDetailModal');
            };

            async function loadProfileAvatar() {
                const avatarEl = document.getElementById('profileDetailAvatar');
                
                // localStorage鏉冿拷鈻夐敓鏂ゆ嫹閿熸枻鎷烽敍姘帥濡澁鎷烽弻銉︽拱閸︽壆绱﹂敓?
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="头像">';
                        return;
                    }
                } catch(e) {}
                
                // 鍏煎牏锟姐倝宕橀崨顓犳憼缂傛挸鐡ㄩ弰鍓э拷?
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
                        // 閸氬本顒為柛鎺旀ocalStorage
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
                        // 浣匡拷锟?createImageBitmap 灏嗗浘锟斤拷顎帡鏁?缂傚倵鏅滈弬渚€宕欐潪鏉跨槣缂佹崘娉曢埢?
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
                                // fallback: 闂佹悶鍎抽崑銈夊焵椤戣棄浜鹃梺?canvas 缂傚倸鍊甸弲婊堝棘?
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
                
                showToast('正在压缩并上传头像..');
                
                try {
                    // 濞寸姾顕ф慨?閿涙岸鍣搁弸鍕礋閿熻緝杈炬嫹锟?Supabase Storage 闁?avatars/ 闁烩晩鍠栫紞?
                    const timestamp = Date.now();
                    const random = Math.floor(Math.random() * 1000);
                    const path = `avatars/${timestamp}_${random}_${file.name}`;
                    
                    // 上传锟?Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 閼惧嘲锟?Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 删除閹碘偓閺堬拷顦ˇ鏉课涢顫粓闁稿秴绻楅鍥亹?
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
                        showToast('上传失败: ' + error.message);
                        return;
                    }
                    
                    avatarCache[currentUser] = avatarUrl;
                    // 保存鍒發ocalStorage鎸佷箙鍖栧瓨鍌?
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
                // 闁哄洤鐡ㄩ弻濠囧箣閹寸姵鐣卞銈囨暬濞间即鏌ｉ妸銉ヮ仼闁靛洦妫冨畷鎾圭疀閵壯咁槱localStorage闂佸搫顦崯顐﹀煝婢跺鍠橀柛蹇撶墳缁?
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
                            // 閸氬本顒為柛鎺旀ocalStorage
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
                window.dockChatListCacheTime = 0;
                document.body.style.overflow = '';
                Object.keys(avatarCache).forEach(k => delete avatarCache[k]);
                showToast("已退出登录");
                await initUI();
                initialLoad(true);
            };

            // 处理鎴戠殑椤甸潰锟矫伙拷卡片鐐癸拷??
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 鐎规瓕灏欙拷鈻嶉妷銊ｄ汗闁哄浂浜炵粣妤呭箥閹惧磭纾绘繛鎴炴尰閻晫鎸ч崟顒佺亹閻犲浄闄勯崕?
                    openProfileDetail();
                } else {
                    // 閺堫亞娅ヨぐ鏇窗閿熸触寮€纰夋嫹锟?娉ㄩ敓鏂ゆ嫹妞ょ敻锟?
                    openAuthModal('login');
                }
            };

            var profileActivityState = {
                likes: [],
                comments: [],
                posts: {},
                totals: {
                    posts: 0,
                    likes: 0,
                    comments: 0
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

            function getProfileActivityPost(postId) {
                return getProfileActivityPostMap()[String(postId)] || null;
            }

            function dedupeProfileLikes(items) {
                var seen = Object.create(null);
                return (items || []).filter(function(item) {
                    var postKey = item && item.post_id != null ? String(item.post_id) : '';
                    if (!postKey || seen[postKey]) return false;
                    seen[postKey] = true;
                    return true;
                });
            }

            function profileActivitySummary(post) {
                var normalized = normalizePost(post || {});
                var text = String(normalized.content || '').trim();
                if (text) return text.length > 28 ? text.slice(0, 28) + '...' : text;
                if (normalized.media_type === 'video') return '视频动态';
                if (normalized.media_type === 'image') return '图片动态';
                return '无文字内容';
            }

            function profileActivityMedia(post, postId) {
                var normalized = normalizePost(post || {});
                if (!normalized.media_url) return '';
                var onclick = "event.stopPropagation();openProfileActivityMedia('" + safeJsStr(String(postId || normalized.id || '')) + "')";
                if (normalized.media_type === 'image') {
                    return '<img class="profile-activity-media" src="' + escapeHtml(normalized.media_url) + '" alt="" loading="lazy" onclick="' + onclick + '" />';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="profile-activity-video" onclick="' + onclick + '">视频</div>';
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
                    var summary = post ? profileActivitySummary(post) : '原帖已不可用';
                    var actorName = String(currentUser || item.user_name || '你');
                    var hasMedia = !!(normalized && normalized.media_url);
                    var postText = normalized ? String(normalized.content || '').trim() : '';
                    var titlePrefix = escapeHtml(actorName) + (isLikes ? '点赞了：' : '评论了：');
                    var inlineSummary = !hasMedia && summary && summary !== '无文字内容'
                        ? '<span class="profile-activity-inline-summary">' + escapeHtml(summary) + '</span>'
                        : '';
                    var extraNote = '';
                    if (!isLikes && item.content) {
                        extraNote = '<div class="profile-activity-note">我的评论：' + escapeHtml(item.content || '') + '</div>';
                    } else if (hasMedia && postText) {
                        extraNote = '<div class="profile-activity-note">' + escapeHtml(postText.length > 36 ? postText.slice(0, 36) + '...' : postText) + '</div>';
                    } else if (!hasMedia && summary === '无文字内容') {
                        extraNote = '<div class="profile-activity-note">原帖没有文字内容</div>';
                    }
                    var actionHtml = isLikes
                        ? '<button type="button" class="profile-activity-btn is-danger" onclick="event.stopPropagation();unlikeFromProfile(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">取消点赞</button>'
                        : '<button type="button" class="profile-activity-btn is-danger" onclick="event.stopPropagation();deleteProfileComment(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">删除评论</button>';
                    var titleRow = '<div class="profile-activity-topline"><div class="profile-activity-title">' + titlePrefix + inlineSummary + '</div>' + (hasMedia ? mediaHtml : '') + '</div>';
                    return [
                        '<article class="profile-activity-item" role="button" tabindex="0" onclick="' + openPostOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + openPostOnclick + '}\" style="--xtj-enter-delay:' + Math.min(index * 28, 180) + 'ms;">',
                        '<div class="profile-activity-main">',
                        '<div class="profile-activity-body">',
                        titleRow,
                        extraNote,
                        '</div>',
                        '</div>',
                        '<div class="profile-activity-side"><span class="profile-activity-time">' + new Date(item.created_at).toLocaleString() + '</span><div class="profile-activity-actions">' + actionHtml + '</div></div>',
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
                if (!listEl || !countEl || !moreBtn) return;
                var payload = buildProfileActivityListMarkup(kind, 1);
                countEl.textContent = String(payload.totalCount || 0);
                listEl.innerHTML = payload.html;
                moreBtn.style.display = payload.hasMore ? 'block' : 'none';
                moreBtn.textContent = isLikes ? '更多点赞内容' : '更多评论内容';
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

            async function loadProfileActivity(forceRefresh) {
                forceRefresh = !!forceRefresh;
                if (!document.getElementById('panelProfile')) return;
                if (!currentUser) {
                    profileActivityState.likes = [];
                    profileActivityState.comments = [];
                    profileActivityState.posts = {};
                    profileActivityState.totals = { posts: 0, likes: 0, comments: 0 };
                    profileActivityState.loadedUser = '';
                    renderProfileActivity();
                    return;
                }
                if (profileActivityState.loading) return;
                if (!forceRefresh && profileActivityState.loadedUser === currentUser && Date.now() - profileActivityState.lastLoadedAt < 45000) {
                    renderProfileActivity();
                    return;
                }
                profileActivityState.loading = true;
                try {
                    var results = await Promise.all([
                        sb.from('likes')
                            .select('id, post_id, user_name, actor_key, created_at', { count: 'exact' })
                            .eq('user_name', currentUser)
                            .order('created_at', { ascending: false })
                            .limit(160),
                        sb.from('comments')
                            .select('id, post_id, user_name, content, actor_key, created_at', { count: 'exact' })
                            .eq('user_name', currentUser)
                            .order('created_at', { ascending: false })
                            .limit(160),
                        sb.from('posts')
                            .select('id', { count: 'exact', head: true })
                            .eq('user_name', currentUser)
                            .neq('media_type', AUTH_MARKER)
                            .neq('media_type', DM_MARKER)
                            .neq('media_type', '__avatar__')
                            .neq('media_type', '__user_info__')
                            .neq('media_type', '__photo_wall__')
                            .neq('media_type', '__ann__')
                    ]);
                    var likesRes = results[0];
                    var commentsRes = results[1];
                    var postsCountRes = results[2];
                    if (likesRes.error) throw likesRes.error;
                    if (commentsRes.error) throw commentsRes.error;
                    if (postsCountRes.error) throw postsCountRes.error;

                    profileActivityState.likes = dedupeProfileLikes(likesRes.data || []);
                    profileActivityState.comments = commentsRes.data || [];
                    profileActivityState.totals = {
                        posts: postsCountRes.count || 0,
                        likes: profileActivityState.likes.length,
                        comments: commentsRes.count || (commentsRes.data || []).length
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
                renderProfileActivityModal(kind);
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
                if (post.media_type === 'image' && post.media_url && typeof window.openImageViewer === 'function') {
                    window.closeProfileActivityModal();
                    window.openImageViewer(post.media_url);
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
                    var query = sb.from('likes').delete();
                    if (postId) query = query.eq('post_id', postId).eq('user_name', currentUser);
                    else if (likeId) query = query.eq('id', likeId);
                    var result = await query;
                    if (result.error) throw result.error;

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

            window.deleteProfileComment = async function(commentId, postId, btn) {
                if (!currentUser || !commentId) return;
                var originalText = btn ? btn.textContent : '';
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '删除中..';
                    }
                    var result = await sb.from('comments').delete().eq('id', commentId).eq('user_name', currentUser);
                    if (result.error) throw result.error;

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
                    
                    // 更新鎴戠殑椤甸潰显示
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "查看资料";
                    
                    // 显示发布閸栧搫锟?
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 加载头像
                    loadUserAvatar();
                    loadProfileActivity(true);
                    
                    // 閿熸枻鎷烽敓鏂ゆ嫹閺堚偓杩戠櫥褰曟椂闂达紙椤甸潰姣忥拷顐奸敓鏂ゆ嫹闁棄鍩涢弬甯礉韫囧懘銆廰wait纭繚鍐欏叆??
                    await saveUserInfo(currentUser, false);
                    
                    try { subscribeToMessages(); startDMPolling(); updateUnreadBadge(); loadAnnouncements(); subscribeToAnnouncements(); } catch(e) {}
                } else {
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    // 更新鎴戠殑椤甸潰显示閿涘牊婀櫥褰曪拷??
                    profileName.textContent = "未登录";
                    profileStatus.textContent = "点击登录";
                    
                    // 闂呮劘妫屽彂甯冮崠鍝勭厵
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 闂佹彃绉堕悿鍡椼仈锟?
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
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        updateAllAvatarElements(cachedAvatars[currentUser]);
                    } else {
                        // localStorage濞屸剝婀侀敍灞藉晙娴犲孩鏆熼幑顔肩氨閿熸枻鎷烽敓鏂ゆ嫹
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

            // DEPRECATED_DO_NOT_EDIT ===================== [瀹告彃绨惧锟?娑撳鏌熼敓?361鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 =====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                // 鏉堟挸鍙嗛弽锟犵崣閿涙岸妾洪崚鍫曟毐鎼达讣鎷烽敓钘夊箵闂勩倕宓勯梽鈺佸敶锟?
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
                var btn = document.getElementById("pubBtn"); btn.disabled = true; btn.textContent = "发布中..";
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
                    showToast("发布成功");
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
                btn.textContent = isLiked ? "❤️ 已赞" : "❤️ 点赞";

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
                    loadProfileActivity(true);
                } catch (e) { console.error(e); }
            };

            function createHeartParticles(btn) {
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                const emojis = ["❤️","💜","💙","💚","💛","🧡"];
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

            // ===================== 閻犲洤瀚?=====================
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
                btn.textContent = "提交中..";
                btn.disabled = true;
                try {
                    const { error } = await sb.from("comments").insert([{ post_id: activePostId, user_name: currentUser, content, actor_key: deviceId }]);
                    if (error) throw error;
                    closeModal("commentModal");
                    showToast("评论成功");
                    var scrollEl = document.getElementById('panelPosts');
                    var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
                    await loadFeed(true);
                    requestAnimationFrame(function() {
                        var p = document.getElementById('panelPosts');
                        if (p && savedScroll > 0) p.scrollTop = savedScroll;
                        var postEl = document.querySelector('.post[data-post-id="' + activePostId + '"]');
                        if (postEl) postEl.classList.add('visible');
                    });
                    loadProfileActivity(true);
                } catch (e) {
                    showToast("评论失败: " + (e.message || "未知错误"));
                    console.error(e);
                } finally {
                    btn.textContent = "发布评论";
                    btn.disabled = false;
                }
            };

            // ===================== 删除閻㈩垱鐗曢悺?=====================
            window.openDelete = function (postId, ownerKey) {
                var targetPost = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(postId); });
                if (targetPost && !canDeletePost(targetPost)) {
                    showToast("无权删除这条帖子");
                    return;
                }
                delPostId = postId;
                delOwnerKey = ownerKey;
                document.getElementById("delModal").classList.add("active");
            };
            document.getElementById("delBtn").onclick = async () => {
                if (!delPostId) return;
                const btn = document.getElementById("delBtn");
                btn.disabled = true;
                btn.textContent = "删除中..";
                try {
                    var currentPost = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(delPostId); });
                    if (currentPost && !canDeletePost(currentPost)) {
                        showToast("无权删除这条帖子");
                        return;
                    }
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

            // ===================== 图片锟姐儳婀咃拷?=====================
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
                if (e.key !== 'Escape') return;
                var iv = document.getElementById('imgViewer');
                if (iv && iv.classList.contains('active')) { closeImageViewer(); return; }
                var am = document.getElementById('announcementModal');
                if (am && am.classList.contains('active')) { closeAnnouncementModal(); return; }
                var sm = document.getElementById('statModal');
                if (sm && sm.classList.contains('active')) { sm.classList.remove('active'); return; }
                var cm = document.getElementById('commentModal');
                if (cm && cm.classList.contains('active')) { closeModal('commentModal'); return; }
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

            // ===================== 濞村繗顫嶉梺鎻掔箳缁櫣锟?=====================
            // 閸忋劌锟斤拷帖子锟解剝浼呴敓鏂ゆ嫹閿熸枻鎷烽敍宀€鏁ゆ禍搴㈢セ鐟欏牐顔囬敓?
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';
            const VIEW_TRACK_TTL = 5 * 60 * 1000;
            const VIEW_HISTORY_MEDIA_LABEL = '(\u56fe\u7247/\u89c6\u9891)';
            const VIEW_HISTORY_DELETED_AUTHOR = '\u5df2\u5220\u9664\u7528\u6237';

            function normalizeViewHistoryText(value, fallback) {
                var text = String(value == null ? '' : value).trim();
                if (!text) return fallback;
                if (text.indexOf('閸ュ墽澧') !== -1 || text.indexOf('鐟欏棝') !== -1 || text.indexOf('闁搞儱澧') !== -1 || text.indexOf('閻熸瑥妫') !== -1) return VIEW_HISTORY_MEDIA_LABEL;
                if (text.indexOf('闁哄牜浜') !== -1 || text.indexOf('瀹告彃鍨') !== -1 || text.indexOf('未知') !== -1) return VIEW_HISTORY_DELETED_AUTHOR;
                return text;
            }

            function normalizeViewHistoryEntry(entry) {
                entry = entry || {};
                return Object.assign({}, entry, {
                    user_name: String(entry.user_name || '').trim(),
                    post_id: entry.post_id,
                    post_content: normalizeViewHistoryText(entry.post_content, VIEW_HISTORY_MEDIA_LABEL),
                    post_author: normalizeViewHistoryText(entry.post_author, VIEW_HISTORY_DELETED_AUTHOR),
                    viewed_at: entry.viewed_at || new Date().toISOString()
                });
            }

            function getViewHistory() {
                try {
                    var history = window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
                    var changed = false;
                    var normalized = Array.isArray(history) ? history.map(function(entry) {
                        var next = normalizeViewHistoryEntry(entry);
                        if (!changed && JSON.stringify(next) !== JSON.stringify(entry || {})) changed = true;
                        return next;
                    }) : [];
                    if (changed) {
                        try { localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(normalized)); } catch (e) {}
                    }
                    return normalized;
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 閬垮厤閲嶅閿熸枻鎷峰綍閿涘牆鎮撴稉顫嫹閿熺煫浼欐嫹閸氬奔绔村笘瀛愰崣顏囶唶褰曚竴锟解槄锟?
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(normalizeViewHistoryEntry(entry));
                    // 鍙繚鐣欐渶??00锟?
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

            // ===================== 加载閸斻劍??=====================
            // 濞寸姾顕э拷?锛氬垎椤靛姞杞界浉鍏冲彉锟?
            saveViewHistory = function(entry) {
                const history = getViewHistory();
                history.unshift(normalizeViewHistoryEntry(entry));
                if (history.length > 500) history.length = 500;
                localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(history));
            };

            function canTrackViewNow(postId) {
                const key = `xtj_v_${postId}`;
                const now = Date.now();
                var last = 0;
                try { last = Number(localStorage.getItem(key) || 0); } catch (e) { last = 0; }
                if (viewTracked.has(postId) && now - last < VIEW_TRACK_TTL) return false;
                if (last && now - last < VIEW_TRACK_TTL) return false;
                return true;
            }

            trackView = function(postId) {
                const key = `xtj_v_${postId}`;
                if (!canTrackViewNow(postId)) return false;
                const now = Date.now();
                viewTracked.add(postId);
                localStorage.setItem(key, String(now));
                var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                if (postEl) {
                    var statsEl = postEl.querySelector('.post-stats-text');
                    if (statsEl) {
                        var vm = statsEl.textContent.match(/(\d+)/);
                        if (vm) {
                            var newVal = parseInt(vm[1]) + 1;
                            statsEl.innerHTML = statsEl.innerHTML.replace(/\d+/, String(newVal));
                        }
                    }
                }
                if (currentUser && postInfoCache[postId]) {
                    var rawContent = postInfoCache[postId].content || '';
                    saveViewHistory({
                        user_name: currentUser,
                        post_id: postId,
                        post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + '...' : (rawContent || VIEW_HISTORY_MEDIA_LABEL),
                        post_author: postInfoCache[postId].user_name || VIEW_HISTORY_DELETED_AUTHOR,
                        viewed_at: new Date().toISOString()
                    });
                }
                if (Array.isArray(feedAllPosts)) {
                    feedAllPosts = feedAllPosts.map(function(post) {
                        if (!post || String(post.id) !== String(postId)) return post;
                        return Object.assign({}, post, { views: Number(post.views || 0) + 1 });
                    });
                    if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                }
                if (postInfoCache[postId]) {
                    postInfoCache[postId].views = Number(postInfoCache[postId].views || 0) + 1;
                }
                setTimeout(async () => {
                    try {
                        await sb.rpc("increment_post_views", { p_post_id: postId });
                    } catch (e) { console.error(e); }
                }, 1000);
                updateFeedStats();
                return true;
            };
            window.xtjTrackPostView = trackView;
            window.xtjCanTrackPostView = canTrackViewNow;
            window.xtjGetPostById = function(postId) {
                var found = Array.isArray(feedAllPosts) ? feedAllPosts.find(function(post) {
                    return post && String(post.id) === String(postId);
                }) : null;
                return found || postInfoCache[postId] || null;
            };

            let feedPage = 0;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;
            let feedLoadRequestId = 0;

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?412鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            async function loadFeed(forceRefresh = false) {
                const now = Date.now();
                if (forceRefresh) {
                    // 闂佹彃绉堕悿鍡楀瀻妞ょ數濮搁幀?
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
                                // 缂撳瓨加载閿涘苯鎮撻弮璺哄灥婵瀵插垎椤电姸??
                                feedAllPosts = parsed.data.posts || [];
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed(parsed.data);
                                // 閸氼垰濮╅弮鐘绘濠婃艾濮╅敓妗旇锟?
                                setupFeedInfiniteScroll();
                                return;
                            }
                        } catch(e){}
                    }
                }
                const feed = document.getElementById("feed");
                if (!forceRefresh) feed.innerHTML = window.xtjMagicLoadingHtml('内容加载中..', '', 'feed');
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }).limit(500),
                        sb.from("comments").select("*").order("created_at").limit(2000),
                        sb.from("likes").select("*").limit(3000)
                    ]);
                    if (postRes.error || commRes.error || likeRes.error) {
                        const errMsg = (postRes.error || commRes.error || likeRes.error).message || '数据加载失败';
                        feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败: ${errMsg}</div>`;
                        return;
                    }
                    const data = { posts: postRes.data || [], comments: commRes.data || [], likes: likeRes.data || [] };
                    // 濞ｅ洦绻傞悺銊╂倵閻熺増婀伴柡鍡稻閺嗙喖骞戦鐣岀懝婵炴垶锚閻庤顪冮妶鍛倎濠电偛娲幃?
                    feedAllPosts = data.posts;
                    feedAllComments = data.comments;
                    feedAllLikes = data.likes;
                    // 閿熸枻鎷烽敓鏂ゆ嫹閺冭埖甯撻梽銈呫仈閸嶅繐鎷伴敓鐭紮鎷锋穱鈩冧紖閿熸枻鎷峰綍閿涘矂妲诲顣坅se64婢堆冩禈閹炬垹鍨巐ocalStorage
                    const cachePosts = data.posts.filter(p => p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
                    await renderFeed(data);
                    // 閸氼垰濮╅弮鐘绘濠婃艾濮╅敓妗旇锟?
                    setupFeedInfiniteScroll();
                } catch(e) {
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>`;
                    console.error(e);
                }
            }

            // 娴犺锟?锛氳缃棤闄愭粴鍔ㄨ瀵燂拷??
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
                
                // 闁?feed 搴曢儴娣诲姞锟筋澁鎷烽敓?sentinel 闁稿繐鍟扮ず
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?479鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            function loadMoreFeedPosts() {
                if (feedEndReached) return;
                
                const feed = document.getElementById('feed');
                const visiblePosts = feedAllPosts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                
                const startIdx = feedPage * FEED_PAGE_SIZE;
                const endIdx = startIdx + FEED_PAGE_SIZE;
                
                if (startIdx >= visiblePosts.length) {
                    feedEndReached = true;
                    // 閿熸枻鎷风ず濞屸剝婀侀弴鏉戭樋锟?
                    let noMore = document.getElementById('feedNoMore');
                    if (!noMore) {
                        noMore = document.createElement('div');
                        noMore.id = 'feedNoMore';
                        noMore.className = 'loading';
                        noMore.textContent = '没有更多帖子';
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?503鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            function appendMorePosts(posts, comments, likes) {
                const feed = document.getElementById('feed');
                const { commentMap, likeMap, likeUserMap } = buildPostMaps(comments, likes);
                
                const postsHtml = posts.map(p => {
                    const pLikes = likeMap[p.id] || [];
                    const pComms = commentMap[p.id] || [];
                    const isLiked = likeUserMap[p.id + '|' + deviceId];
                    const canDelPost = p.actor_key === deviceId || p.actor_key === currentUser || isAdmin();
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
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none">`:`<img src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${safeJsStr(p.media_url)}')">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} | 点赞 ${pLikes.length} | 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${safeJsStr(p.id)}')">${isLiked?'❤️':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${safeJsStr(p.id)}')">评论</button>
                    ${canPinPost(p)?`<button type="button" class="action-btn pin" data-post-id="${escapeHtml(p.id)}">${normalizePost(p).is_pinned ? '取消置顶' : '置顶'}</button>`:''}
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${safeJsStr(p.id)}', '${safeJsStr(p.actor_key)}')">删除</button>`:''}
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
                
                // 閸?sentinel 娑斿澧犻幓鎺戝弳閺傛澘绗樺瓙
                const sentinel = document.getElementById('feedSentinel');
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = postsHtml;
                
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                
                // 娑撶儤鏌婂笘瀛愬ǎ璇插閿熸枻鎷烽敓鏂ゆ嫹閸斻劎鏁鹃敓妗旇鎷烽敍鍫濐槻閻劌鍙忕仦顫嫹閯勯敓钘夋珤閿?
                const newPosts = feed.querySelectorAll('.post:not(.visible)');
                newPosts.forEach(p => getPostVisibilityObserver().observe(p));
                
                // 更新缁熻
                updateFeedStats();
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?532鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;

                // 濉厖帖子淇℃伅缂撳瓨閿涘奔绶垫祻瑙堣褰曟担璺拷??
                visiblePosts.forEach(p => {
                    postInfoCache[p.id] = { content: p.content, user_name: p.user_name };
                });

                // 闁衡偓閸洘鑲犻柟纰樺亾闁哄牆顦垫付鐟曚礁銇斿儚鐨勶拷锟斤箑鐓曢柛?
                const allUsers = new Set();
                visiblePosts.forEach(p => allUsers.add(p.user_name));
                comments.forEach(c => allUsers.add(c.user_name));

                // 缂佹稑顦欢鐔稿緞閺夋垵鍓奸柛鏃傚Ь濞村洨鈧拷灞惧灇閸氾拷鈥虫櫃婵炴挸寮堕悡?
                await loadAvatarsForUsers(Array.from(allUsers));
                
                // 濞寸姾顕ф慨?閿涙艾褰у〒鍙夌厠缁楊兛绔存い鐢垫畱閿熸枻鎷烽敓鏂ゆ嫹閿涘苯鎮楃紒顓ㄦ嫹閿熷€熺箖閺冪娀妾猴拷?姘З閿熸枻鎷烽敓鏂ゆ嫹
                const firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                renderFeedWithAvatars(firstPage, comments, likes);
                
                // 閸氬骸褰撮閿熻妭濠忔嫹鏉炵晫绮虹拋鈩冩殶锟?
                setTimeout(function() { prefetchStatData(); }, 1000);
            }
            window.renderFeed = renderFeed;

            // 妫板嫭鐎楦跨槑鐠佸搫鎷伴敓鏂ゆ嫹閿熸枻鎷烽惃鍕Ё鐏忓嫯銆冮敍灞惧絹閸楀洦瑕嗛弻鎾粹偓褑锟?
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

            async function loadAvatarsForUsers(usernames) {
                if (!usernames || usernames.length === 0) return;
                try {
                    var allData = [];
                    var batchSize = 80; // Supabase .in() 闁哄牃鍋撳鑸垫皑瀹?0涓」锛岋拷?0娴ｆ瑩锟?
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
                        // 鍙粠localStorage闁插本瀣侀敓鏂ゆ嫹鍓嶉敓鐭紮鎷烽懛顏勭箒閻ㄥ嫬銇旈敓?
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?520鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            function getPostFilterUserAvatar(username) {
                var safeName = escapeHtml(username || "");
                var avatarUrl = avatarCache[username];
                if (avatarUrl) {
                    return '<span class="post-user-chip-avatar"><img src="' + escapeHtml(avatarUrl) + '" alt="' + safeName + '"></span>';
                }
                return '<span class="post-user-chip-avatar">' + escapeHtml((username || "?").slice(0, 1).toUpperCase()) + '</span>';
            }

            function renderPostFilterUsers() {
                var list = document.getElementById("postUserQuickList");
                var input = document.getElementById("postUserFilter");
                var resetBtn = document.getElementById("postUserFilterReset");
                if (!list || !input) return;
                var activeUser = String(input.value || "").trim();
                if (resetBtn) resetBtn.style.visibility = activeUser ? "visible" : "hidden";
                if (postFilterUsersLoading && !postFilterUsers.length) {
                    list.innerHTML = renderPostFilterUserLoader();
                    if (window.initAllSpringLoaders) window.initAllSpringLoaders(list);
                    return;
                }
                var users = Array.isArray(postFilterUsers) ? postFilterUsers : [];
                if (!users.length) {
                    list.innerHTML = '<div class="post-user-chip is-empty">\u6682\u65e0\u53ef\u7b5b\u9009\u7528\u6237</div>';
                    return;
                }
                var html = [
                    '<button type="button" class="post-user-chip' + (!activeUser ? ' is-active' : '') + '" onclick="selectPostFilterUser(\'\')">' +
                        '<span class="post-user-chip-avatar">\u5168</span>' +
                        '<span class="post-user-chip-name">\u5168\u90e8\u7528\u6237</span>' +
                    '</button>'
                ];
                users.forEach(function(username) {
                    var safeJsName = String(username).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                    html.push(
                        '<button type="button" class="post-user-chip' + (activeUser === username ? ' is-active' : '') + '" onclick="selectPostFilterUser(\'' + safeJsName + '\')">' +
                            getPostFilterUserAvatar(username) +
                            '<span class="post-user-chip-name">' + escapeHtml(username) + '</span>' +
                        '</button>'
                    );
                });
                list.innerHTML = html.join("");
            }

            async function loadPostFilterUsers(forceRefresh) {
                if (postFilterUsersLoading) return;
                if (postFilterUsersLoaded && !forceRefresh) {
                    renderPostFilterUsers();
                    return;
                }
                var loadSeq = ++postFilterUsersLoadSeq;
                postFilterUsersLoading = true;
                renderPostFilterUsers();
                if (postFilterUsersLoadTimer) clearTimeout(postFilterUsersLoadTimer);
                postFilterUsersLoadTimer = setTimeout(function() {
                    if (loadSeq !== postFilterUsersLoadSeq) return;
                    postFilterUsersLoading = false;
                    renderPostFilterUsers();
                }, 2400);
                try {
                    var authRes = await sb.from("posts")
                        .select("user_name")
                        .eq("media_type", AUTH_MARKER)
                        .eq("actor_key", AUTH_MARKER)
                        .order("created_at", { ascending: false });
                    if (authRes.error) throw authRes.error;
                    var seen = {};
                    postFilterUsers = (authRes.data || []).map(function(row) {
                        return row && row.user_name ? String(row.user_name).trim() : "";
                    }).filter(function(name) {
                        if (!name || seen[name]) return false;
                        seen[name] = true;
                        return true;
                    }).sort(function(a, b) {
                        return a.localeCompare(b, "zh-Hans-CN");
                    });
                    postFilterUsersLoaded = true;
                    if (postFilterUsers.length) {
                        await Promise.race([
                            loadAvatarsForUsers(postFilterUsers),
                            new Promise(function(resolve) { setTimeout(resolve, 1800); })
                        ]);
                    }
                } catch (e) {
                    console.error("[post-filter-users] load failed", e);
                    if (!postFilterUsers.length) {
                        var fallbackSeen = {};
                        postFilterUsers = (feedAllPosts || []).map(function(post) {
                            return post && post.user_name ? String(post.user_name).trim() : "";
                        }).filter(function(name) {
                            if (!name || fallbackSeen[name]) return false;
                            fallbackSeen[name] = true;
                            return true;
                        }).sort(function(a, b) {
                            return a.localeCompare(b, "zh-Hans-CN");
                        });
                    }
                } finally {
                    if (loadSeq === postFilterUsersLoadSeq) {
                        stopPostFilterUsersLoading();
                    }
                    renderPostFilterUsers();
                }
            }

            window.selectPostFilterUser = function(userName) {
                var input = document.getElementById("postUserFilter");
                if (input) input.value = userName || "";
                renderPostFilterUsers();
                window.applyPostFilters();
            };

            function renderFeedWithAvatars(visiblePosts, comments, likes) {
                const feed = document.getElementById("feed");
                const { commentMap, likeMap, likeUserMap } = buildPostMaps(comments, likes);

                feed.innerHTML = visiblePosts.length ? visiblePosts.map(function(post) {
                    const pLikes = likeMap[p.id] || [];
                    const pComms = commentMap[p.id] || [];
                    const isLiked = likeUserMap[p.id + '|' + deviceId];
                    const canDelPost = p.actor_key === deviceId || p.actor_key === currentUser || isAdmin();
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
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none">`:`<img src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${safeJsStr(p.media_url)}')">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} | 点赞 ${pLikes.length} | 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${safeJsStr(p.id)}')">${isLiked?'❤️':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${safeJsStr(p.id)}')">评论</button>
                    ${canPinPost(p)?`<button type="button" class="action-btn pin" data-post-id="${escapeHtml(p.id)}">${normalizePost(p).is_pinned ? '取消置顶' : '置顶'}</button>`:''}
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${safeJsStr(p.id)}', '${safeJsStr(p.actor_key)}')">删除</button>`:''}
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
                }).join('') : `<div class="loading">蹇潵发布绗竴鏉″姩鎬佸惂~</div>`;

                initPostScrollAnimation();
            }

            function initPostScrollAnimation() {
                var posts = document.querySelectorAll('.post');
                primePostReveal(posts);
                posts.forEach(p => getPostVisibilityObserver().observe(p));
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
                    updated_at: normalized.updated_at || null,
                    edited_at: (normalized._contentMeta && normalized._contentMeta.edited_at) || null
                }, metaOverrides || {});
                var nextText = typeof text === "string" ? text : normalized.content || "";
                return buildPostContentPayload(nextText, meta);
            }

            function matchesPostExpectation(post, expected) {
                if (!post) return false;
                var normalized = normalizePost(post);
                if (typeof expected.content === "string" && String(normalized.content || "") !== String(expected.content)) return false;
                if (expected.visibility != null && String(normalized.visibility || "public") !== String(expected.visibility)) return false;
                if (expected.is_pinned != null && !!normalized.is_pinned !== !!expected.is_pinned) return false;
                if (Object.prototype.hasOwnProperty.call(expected, "pinned_at") && String(normalized.pinned_at || "") !== String(expected.pinned_at || "")) return false;
                return true;
            }

            async function fetchPostSnapshot(postId) {
                var fetched = await sb.from("posts").select("*").eq("id", postId).maybeSingle();
                if (fetched.error) throw fetched.error;
                return fetched.data || null;
            }

            async function updatePostRecord(post, updates) {
                var normalized = normalizePost(post);
                var nextVisibility = updates.visibility != null ? updates.visibility : normalized.visibility;
                var nextPinned = updates.is_pinned != null ? !!updates.is_pinned : !!normalized.is_pinned;
                var nextPinnedAt = Object.prototype.hasOwnProperty.call(updates, "pinned_at") ? updates.pinned_at : normalized.pinned_at;
                var nextUpdatedAt = Object.prototype.hasOwnProperty.call(updates, "updated_at") ? updates.updated_at : normalized.updated_at;
                var nextEditedAt = Object.prototype.hasOwnProperty.call(updates, "edited_at")
                    ? updates.edited_at
                    : ((normalized._contentMeta && normalized._contentMeta.edited_at) || null);
                var nextContent = typeof updates.content === "string" ? updates.content : normalized.content;

                var newContent = buildPostStorageContent(normalized, nextContent, {
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt,
                    edited_at: nextEditedAt
                });
                var updatePayload = {
                    content: newContent,
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                };
                var result = await sb.from("posts").update(updatePayload).eq("id", post.id).select("*").maybeSingle();
                if (result.error) return { ok: false, error: result.error };
                if (!result.data) {
                    return { ok: false, error: new Error("更新失败：数据库没有实际修改任何行，可能是RLS权限阻止") };
                }
                var verified = normalizePost(result.data);
                var verifiedMeta = parsePostContent(result.data).meta || {};
                if (String(verified.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("更新失败：置顶状态未实际生效") };
                }
                if (String(verifiedMeta.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("更新失败：content.meta.visibility 未同步") };
                }
                if (!!verified.is_pinned !== !!nextPinned) {
                    return { ok: false, error: new Error("更新失败：置顶状态未实际生效") };
                }
                if (!!verifiedMeta.is_pinned !== !!nextPinned) {
                    return { ok: false, error: new Error("更新失败：content.meta.is_pinned 未同步") };
                }
                if (Object.prototype.hasOwnProperty.call(updates, "pinned_at") && String(verified.pinned_at || "") !== String(nextPinnedAt || "")) {
                    return { ok: false, error: new Error("更新失败：pinned_at 未实际生效") };
                }
                if (Object.prototype.hasOwnProperty.call(updates, "updated_at") && String(verified.updated_at || "") !== String(nextUpdatedAt || "")) {
                    return { ok: false, error: new Error("更新失败：updated_at 未实际生效") };
                }
                return { ok: true, data: result.data };
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
                var editedAt = normalized._contentMeta && normalized._contentMeta.edited_at ? normalized._contentMeta.edited_at : null;
                if (editedAt) return time + " (已编辑)";
                return time;
            }

            function buildPostBadges(post) {
                var normalized = normalizePost(post);
                var bits = [];
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '私密' : '公开') + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">置顶</span>');
                return bits.join("");
            }

            function buildPostStatsLine(post, likeCount, commentCount) {
                var normalized = normalizePost(post);
                var visibilityClass = normalized.visibility === "private" ? 'private' : 'public';
                var visibilityText = normalized.visibility === "private" ? '私密' : '公开';
                return '浏览 ' + (normalized.views || 0) +
                    ' | 点赞 ' + (likeCount || 0) +
                    ' | 评论 ' + (commentCount || 0) +
                    '<span class="post-stats-visibility post-stats-visibility-' + visibilityClass + '">' + visibilityText + '</span>';
            }

            buildPostBadges = function(post) {
                var normalized = normalizePost(post);
                return normalized.is_pinned ? '<span class="post-pin-badge">置顶</span>' : '';
            };

            function buildPostActionHtml(post, isLiked, canDelete) {
                var idJs = safeJsStr(String(post.id));
                var idHtml = escapeHtml(String(post.id));
                var actorKeyJs = safeJsStr(String(post.actor_key || ""));
                var actions = [
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + idJs + '\')">评论</button>'
                ];
                if (canEditPost(post)) {
                    actions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + idJs + '\')">编辑</button>');
                }
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" data-post-id="' + idHtml + '">' + (normalizePost(post).is_pinned ? '取消置顶' : '置顶') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + idJs + '\', \'' + actorKeyJs + '\')">删除</button>');
                }
                return actions.join("");
            }

            function renderPostCard(post, commentMap, likeMap, likeUserMap) {
                var normalized = normalizePost(post);
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = likeUserMap[normalized.id + '|' + deviceId];
                var canDelete = canDeletePost(normalized);
                var mediaDataAttrs = [
                    'data-post-id="' + escapeHtml(String(normalized.id)) + '"',
                    'data-media-url="' + escapeHtml(String(normalized.media_url || "")) + '"',
                    'data-post-user="' + escapeHtml(String(normalized.user_name || "")) + '"',
                    'data-post-created-at="' + escapeHtml(String(normalized.created_at || "")) + '"',
                    'data-post-views="' + escapeHtml(String(normalized.views || 0)) + '"',
                    'data-file-size="' + escapeHtml(String((normalized._contentMeta && normalized._contentMeta.fileSize) || "")) + '"',
                    'data-original-size="' + escapeHtml(String((normalized._contentMeta && normalized._contentMeta.originalSize) || "")) + '"'
                ].join(" ");
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
                  ${normalized.media_url ? `<div class="media">${normalized.media_type === 'video' ? `<video src="${escapeHtml(normalized.media_url)}" controls preload="none"></video>` : `<img ${mediaDataAttrs} src="${escapeHtml(normalized.media_url)}" loading="lazy" onclick="openImageViewer('${safeJsStr(normalized.media_url)}')">`}</div>` : ''}
                  <div class="post-stats-text">${buildPostStatsLine(normalized, pLikes.length, pComms.length)}</div>
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
                var feed = document.getElementById("feed");
                if (feed && window.xtjMagicLoadingHtml) {
                    feed.innerHTML = window.xtjMagicLoadingHtml('内容加载中..', '', 'feed');
                }
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
                var panel = document.getElementById("postFilterPanel");
                if (panel) panel.style.display = "none";
                var btn = document.getElementById("filterToggleBtn");
                if (btn) btn.classList.remove("active");
                renderPostFilterUsers();
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

            window.toggleFilterPanel = function() {
                var panel = document.getElementById("postFilterPanel");
                var btn = document.getElementById("filterToggleBtn");
                if (!panel) return;
                var isHidden = panel.style.display === "none" || window.getComputedStyle(panel).display === "none";
                if (isHidden) {
                    panel.style.display = "flex";
                    if (btn) btn.classList.add("active");
                    loadPostFilterUsers(true);
                    renderPostFilterUsers();
                } else {
                    panel.style.display = "none";
                    if (btn) btn.classList.remove("active");
                }
            };

            window.openEditPost = function(postId) {
                console.log('[openEditPost] called with postId:', postId, 'feedAllPosts length:', feedAllPosts.length);
                var target = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(postId); });
                if (!target || !canEditPost(target)) {
                    showToast("无权编辑这条帖子");
                    return;
                }
                editPostId = String(target.id);
                var input = document.getElementById("editPostInp");
                if (input) input.value = target.content || "";
                // Update custom visibility toggle
                var vis = target.visibility || "public";
                document.getElementById("editPostVisibilityVal").value = vis;
                var toggleBtns = document.querySelectorAll("#editPostVisibility .vis-btn");
                toggleBtns.forEach(function(b) {
                    b.classList.toggle("active", b.getAttribute("data-vis") === vis);
                });
                // Re-enable save button
                var btn = document.getElementById("saveEditPostBtn");
                if (btn) { btn.disabled = false; btn.textContent = "保存修改"; }
                openModal("editPostModal");
            };

            window.saveEditPost = async function() {
                if (!editPostId) return;
                var post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(editPostId); });
                if (!post || !canEditPost(post)) {
                    showToast("无权编辑这条帖子");
                    return;
                }
                var input = document.getElementById("editPostInp");
                var btn = document.getElementById("saveEditPostBtn");
                var nextContent = input ? input.value.trim() : "";
                var nextVisibility = (document.getElementById("editPostVisibilityVal") || {}).value || "public";
                if (!nextContent) {
                    showToast("请输入帖子内容");
                    return;
                }
                btn.disabled = true;
                btn.textContent = "保存中..";
                try {
                    var result = await updatePostRecord(post, {
                        content: nextContent.slice(0, 2000),
                        visibility: nextVisibility,
                        edited_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                    if (!result.ok) {
                        showToast("保存失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    var fetched = await sb.from("posts").select("*").eq("id", editPostId).maybeSingle();
                    if (fetched.error) throw fetched.error;
                    var fetchedPost = fetched.data || null;
                    if (!fetchedPost) {
                        throw new Error("保存失败，公开/私密状态未实际保存");
                    }
                    var verified = normalizePost(fetchedPost);
                    var verifiedMeta = parsePostContent(fetchedPost).meta || {};
                    if (String(verified.visibility) !== String(nextVisibility)) {
                        throw new Error("保存失败，公开/私密状态未实际保存");
                    }
                    if (String(verifiedMeta.visibility || "public") !== String(nextVisibility)) {
                        throw new Error("保存失败：content.meta.visibility 未同步");
                    }
                    var savedPostId = editPostId;
                    var syncedPost = syncPinnedPostIntoFeedState(fetchedPost);
                    if (syncedPost) {
                        writeFeedCacheSnapshot();
                    } else {
                        clearFeedCache();
                    }
                    closeModal("editPostModal");
                    editPostId = null;
                    if (syncedPost) {
                        await renderFeedFromMemoryState();
                        await refreshPostDetailIfActive(savedPostId);
                    } else {
                        await loadFeed(true);
                    }
                    showToast(nextVisibility === "private" ? "已改为私密" : "已改为公开");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("保存失败: " + (e && e.message ? e.message : "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
                }
            };
            window._legacyTogglePostPinBase = async function(postId, btn) {
                console.log('[togglePostPin] called with postId:', postId, 'feedAllPosts length:', feedAllPosts.length);
                if (!postId) { showToast("置顶失败: postId 为空"); return; }
                var nextPinned;
                var originalText;
                if (btn) {
                    originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = '处理中..';
                }
                try {
                    // Fetch current post state directly from DB (only select columns that exist)
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) { alert('查询失败: ' + fetchRes.error.message); throw fetchRes.error; }
                    if (!fetchRes.data) { alert('未找到帖子(id=' + postId + ')'); throw new Error('not found'); }
                    var dbPost = normalizePost(fetchRes.data);
                    // Check permission
                    if (currentUser !== dbPost.user_name && currentUser !== ADMIN_NAME) {
                        showToast('无权置顶');
                        if (btn) { btn.disabled = false; btn.textContent = originalText; }
                        return;
                    }
                    nextPinned = !dbPost.is_pinned;
                    btn.textContent = nextPinned ? '置顶中..' : '取消中..';
                    // Update via Supabase directly
                    var updateRes = await sb.from('posts').update({
                        is_pinned: nextPinned,
                        pinned_at: nextPinned ? new Date().toISOString() : null
                    }).eq('id', postId);
                    if (updateRes.error) { alert('更新失败: ' + updateRes.error.message); throw updateRes.error; }
                    clearFeedCache();
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                    await loadFeed(true);
                } catch (e) {
                    console.error('[togglePostPin] error:', e);
                    if (btn) { btn.disabled = false; btn.textContent = originalText || '置顶'; }
                    if (!/^[\u4e00-\u9fa5]/.test(e && e.message || '')) {
                        showToast('操作异常，请查看控制台');
                    }
                }
            };
            window._legacyTogglePostPin = async function(postId, btn) {
                console.log('[togglePostPin override] called with postId:', postId, 'feedAllPosts length:', feedAllPosts.length);
                if (!postId) { showToast("置顶失败: postId 为空"); return; }
                var nextPinned;
                var originalText;
                if (btn) {
                    originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = '处理中..';
                }
                try {
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) throw fetchRes.error;
                    if (!fetchRes.data) throw new Error('未找到对应帖子');
                    var dbPost = normalizePost(fetchRes.data);
                    if (!isAdmin()) {
                        showToast('无权置顶');
                        return;
                    }
                    nextPinned = !dbPost.is_pinned;
                    if (btn) btn.textContent = nextPinned ? '置顶中..' : '取消中..';
                    var updateRes = await updatePostRecord(fetchRes.data, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinned ? new Date().toISOString() : null,
                        updated_at: new Date().toISOString()
                    });
                    if (!updateRes.ok) {
                        showToast('置顶失败: ' + ((updateRes.error && updateRes.error.message) || '未知错误'));
                        return;
                    }
                    clearFeedCache();
                    await loadFeed(true);
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                } catch (e) {
                    console.error('[togglePostPin override] error:', e);
                    showToast('置顶失败: ' + (e && e.message ? e.message : '未知错误'));
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText || '置顶';
                    }
                }
            };
            function writeFeedCacheSnapshot() {
                try {
                    var cachePosts = (feedAllPosts || []).filter(function(post) {
                        return post && post.media_type !== '__avatar__' && post.media_type !== '__user_info__' && post.media_type !== '__photo_wall__';
                    });
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        data: {
                            posts: cachePosts,
                            comments: feedAllComments || [],
                            likes: feedAllLikes || []
                        },
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    console.warn('[pin] failed to persist feed cache', e);
                }
            }

            function syncPinnedPostIntoFeedState(serverPost) {
                if (!serverPost || !serverPost.id) return false;
                var found = false;
                feedAllPosts = sortPosts((feedAllPosts || []).map(function(post) {
                    if (String(post.id) !== String(serverPost.id)) return post;
                    found = true;
                    return Object.assign({}, post, serverPost);
                }));
                return found;
            }

            async function renderFeedFromMemoryState() {
                await renderFeed({
                    posts: feedAllPosts || [],
                    comments: feedAllComments || [],
                    likes: feedAllLikes || []
                });
            }

            async function rebuildFeedFromCurrentState() {
                feedPage = 0;
                feedEndReached = false;
                var noMore = document.getElementById('feedNoMore');
                if (noMore) noMore.remove();
                await renderFeedFromMemoryState();
                if (typeof setupFeedInfiniteScroll === 'function') {
                    setupFeedInfiniteScroll();
                }
            }

            window.xtjPrependPostToFeed = async function(serverPost) {
                if (!serverPost || !serverPost.id) return false;
                var normalized = normalizePost(serverPost);
                var exists = false;
                feedAllPosts = sortPosts((feedAllPosts || []).map(function(post) {
                    if (!post || String(post.id) !== String(normalized.id)) return post;
                    exists = true;
                    return Object.assign({}, post, normalized);
                }));
                if (!exists) {
                    feedAllPosts = sortPosts([normalized].concat(feedAllPosts || []));
                }
                writeFeedCacheSnapshot();
                await rebuildFeedFromCurrentState();
                return true;
            };

            async function refreshPostDetailIfActive(postId) {
                if (!postId || String(activePostId || '') !== String(postId)) return;
                if (typeof window.openPostDetail !== 'function') return;
                try {
                    await window.openPostDetail(postId);
                } catch (e) {
                    console.warn('[pin] failed to refresh post detail', e);
                }
            }

            async function verifyPinnedPostInBackground(postId, expectedPinned) {
                try {
                    var snapshot = await fetchPostSnapshot(postId);
                    if (!snapshot) throw new Error('not found');
                    var normalized = normalizePost(snapshot);
                    var synced = syncPinnedPostIntoFeedState(snapshot);
                    writeFeedCacheSnapshot();
                    if (!!normalized.is_pinned !== !!expectedPinned) {
                        if (synced) {
                            await rebuildFeedFromCurrentState();
                            await refreshPostDetailIfActive(postId);
                        }
                        showToast('置顶状态已按服务器结果校正');
                    }
                } catch (e) {
                    console.error('[pin] background verify failed', e);
                    showToast('置顶已更新，但后台校验失败: ' + (e && e.message ? e.message : '未知错误'));
                }
            }

            async function syncFeedDataInBackground() {
                var requestId = ++feedLoadRequestId;
                try {
                    var postRes = await sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false });
                    if (requestId !== feedLoadRequestId) return false;
                    if (postRes.error) throw postRes.error;
                    feedAllPosts = normalizePosts(postRes.data || []);
                    writeFeedCacheSnapshot();
                    if (currentDockTab === 'posts') {
                        await rebuildFeedFromCurrentState();
                    }

                    var results = await Promise.all([
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*")
                    ]);
                    if (requestId !== feedLoadRequestId) return false;
                    var commRes = results[0];
                    var likeRes = results[1];
                    if (commRes.error || likeRes.error) {
                        throw (commRes.error || likeRes.error);
                    }
                    feedAllComments = commRes.data || [];
                    feedAllLikes = likeRes.data || [];
                    writeFeedCacheSnapshot();
                    if (currentDockTab === 'posts') {
                        await rebuildFeedFromCurrentState();
                    }
                    return true;
                } finally {
                    isRefreshing.posts = false;
                }
            }

            window.togglePostPin = async function(postId, btn) {
                console.log('[togglePostPin final override] called with postId:', postId, 'feedAllPosts length:', feedAllPosts.length);
                if (!postId) {
                    showToast('置顶失败: postId 为空');
                    return;
                }
                var originalText = btn ? btn.textContent : '';
                var nextPinned = false;
                var didSucceed = false;
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '处理中..';
                    }
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) throw fetchRes.error;
                    if (!fetchRes.data) throw new Error('未找到对应帖子');

                    var dbPost = normalizePost(fetchRes.data);
                    if (currentUser !== dbPost.user_name && currentUser !== ADMIN_NAME) {
                        showToast('无权置顶');
                        return;
                    }

                    nextPinned = !dbPost.is_pinned;
                    var nextPinnedAt = nextPinned ? new Date().toISOString() : null;
                    var nextUpdatedAt = new Date().toISOString();
                    if (btn) btn.textContent = nextPinned ? '置顶中..' : '取消中..';

                    var updateRes = await updatePostRecord(fetchRes.data, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinnedAt,
                        updated_at: nextUpdatedAt
                    });
                    if (!updateRes.ok) {
                        showToast('置顶失败: ' + ((updateRes.error && updateRes.error.message) || '未知错误'));
                        return;
                    }

                    var fallbackRow = Object.assign({}, fetchRes.data, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinnedAt,
                        updated_at: nextUpdatedAt,
                        content: buildPostStorageContent(fetchRes.data, normalizePost(fetchRes.data).content, {
                            is_pinned: nextPinned,
                            pinned_at: nextPinnedAt,
                            updated_at: nextUpdatedAt
                        })
                    });
                    var synced = syncPinnedPostIntoFeedState(updateRes.data || fallbackRow);
                    writeFeedCacheSnapshot();
                    if (synced) {
                        await rebuildFeedFromCurrentState();
                        await refreshPostDetailIfActive(postId);
                    } else {
                        clearFeedCache();
                        await loadFeed(true);
                    }

                    didSucceed = true;
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                    verifyPinnedPostInBackground(postId, nextPinned);
                } catch (e) {
                    console.error('[togglePostPin final override] error:', e);
                    showToast('置顶失败: ' + (e && e.message ? e.message : '未知错误'));
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = didSucceed ? (nextPinned ? '取消置顶' : '置顶') : (originalText || '置顶');
                    }
                }
            };

            window.togglePostVisibility = async function(postId, btn) {
                var post;
                var nextVisibility;
                try {
                    post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                    if (!post || !canEditPost(post)) {
                        showToast("无权修改这条帖子的隐私状态");
                        return;
                    }
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = "处理中..";
                    }
                    nextVisibility = post.visibility === "private" ? "public" : "private";
                    var result = await updatePostRecord(post, {
                        visibility: nextVisibility
                    });
                    if (!result.ok) {
                        if (btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "🔒 设为私密" : "🌐 设为公开"; }
                        showToast("操作失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    showToast(nextVisibility === "private" ? "已设为私密" : "已设为公开");
                    await loadFeed(true);
                } catch (e) {
                    console.error("togglePostVisibility error:", e);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = "🔒 设为私密";
                    }
                    showToast("操作异常: " + (e && e.message ? e.message : "未知错误，请查看控制台"));
                }
            };
            // ============== Global click delegation ==============
            document.addEventListener('click', function(e) {
                // Pin button: delegate only (no inline onclick)
                var pinBtn = e.target.closest('.action-btn.pin');
                if (pinBtn) {
                    if (pinBtn.disabled) { console.log('[pin] btn disabled, skip'); return; }
                    var pid = pinBtn.getAttribute('data-post-id');
                    if (!pid) { console.warn('[pin] no data-post-id'); return; }
                    console.log('[pin] delegated click, postId:', pid);
                    window.togglePostPin(pid, pinBtn);
                    return;
                }
                // Visibility toggle in edit modal
                var visBtn = e.target.closest('#editPostVisibility .vis-btn');
                if (visBtn) {
                    var vis = visBtn.getAttribute('data-vis');
                    if (!vis) return;
                    console.log('[vis-toggle] click, value:', vis);
                    document.getElementById('editPostVisibilityVal').value = vis;
                    document.querySelectorAll('#editPostVisibility .vis-btn').forEach(function(b) {
                        b.classList.toggle('active', b.getAttribute('data-vis') === vis);
                    });
                    return;
                }
            });
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
                var btn = document.getElementById("pubBtn");
                btn.disabled = true;
                btn.textContent = "发布中..";
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
                        showToast("发布失败: " + ((insertRes.error && insertRes.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    resetPostComposer();
                    showToast(insertRes.fallback ? "发布成功，已兼容旧数据结构" : "发布成功");
                    await loadFeed(true);
                    loadProfileActivity(true);
                } catch (e) {
                    showToast("发布失败: " + (e.message || "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "发布动态";
                }
            };

            loadFeed = async function(forceRefresh) {
                var now = Date.now();
                var requestId = ++feedLoadRequestId;
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
                                if (requestId !== feedLoadRequestId) return;
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
                    feed.innerHTML = window.xtjMagicLoadingHtml('内容加载中..', '', 'feed');
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
                        if (requestId !== feedLoadRequestId) return;
                        var err = postRes.error || commRes.error || likeRes.error;
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败: ' + escapeHtml(err.message || "未知错误") + '</div>';
                        return;
                    }
                    if (requestId !== feedLoadRequestId) return;
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
                    if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>';
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
                        noMore.textContent = "没有鏇村帖子";
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
                primePostReveal(newPosts);
                newPosts.forEach(function(p) { getPostVisibilityObserver().observe(p); });
                updateFeedStats();
            };

            renderFeedWithAvatars = function(visiblePosts, comments, likes) {
                var feed = document.getElementById("feed");
                var scopedComments = getRenderableComments(comments, visiblePosts);
                var maps = buildPostMaps(scopedComments, likes);
                var state = getPostSearchState();
                var hasFilters = !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
                if (visiblePosts.length) {
                    feed.innerHTML = visiblePosts.map(function(post) {
                        return renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                    }).join("");
                } else {
                    feed.innerHTML = '<div class="loading">' + (hasFilters ? '暂无匹配的帖子' : '快去发布第一条动态吧~') + '</div>';
                }
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
                btn.textContent = "删除中..";
                try {
                    var key = isAdmin() ? delOwnerKey : deviceId;
                    var result = await sb.rpc("delete_post_with_actor", {
                        p_post_id: delPostId,
                        p_actor_key: key
                    });
                    if (result.error) {
                        showToast("删除失败: " + result.error.message);
                        return;
                    }
                    clearFeedCache();
                    closeModal("delModal");
                    showToast("帖子已删除");
                    delPostId = null;
                    await loadFeed(true);
                    loadProfileActivity(true);
                } catch (e) {
                    showToast("删除帖子失败");
                    console.error(e);
                } finally {
                    btn.disabled = false;
                    btn.textContent = "确认删除";
                }
            };

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?668鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
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

            // ===================== 数据缁熻璇︽儏功能 =====================
            // 存储锟斤拷前鐨勭粺锟铰ゎ潒鍥剧姸锟?
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30绉掔紦锟?

            // 閸氬骸褰撮閿熻妭濠忔嫹鏉炵晫绮虹拋鈩冩殶锟?
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

            // 闁瑰灚鎸哥槐鎴犵磼閻旀椿鍚€閻犲浄闄勯崕蹇斾繆椤栨澧查柍褜鍏涢悞?
            window.openStatDetail = async function(type) {
                statCurrentType = type;
                const titles = { posts: '总动态 - 按用户分组', views: '总浏览 - 浏览记录', likes: '点赞和评论 - 记录' };
                document.getElementById('statModalTitle').textContent = titles[type] || '统计详情';
                document.getElementById('statModal').classList.add('active');

                // 濡傛灉鏈夌紦瀛樻暟锟筋噯绱濋敓鏂ゆ嫹閿熸枻鎷峰〒鍙夌厠閿涘苯鎮撻弮璺虹磽濮濄儱鍩涳拷?
                if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    // 后台静默刷锟斤拷
                    prefetchStatData().then(function() {
                        if (document.getElementById('statModal').classList.contains('active') && statCurrentType === type) {
                            renderStatByType(type);
                        }
                    });
                    return;
                }

                document.getElementById('statModalBody').innerHTML = window.xtjMagicLoadingHtml('加载中..', '加载中..', 'feed');

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

            function formatStatTime(value) {
                try {
                    return new Date(value).toLocaleString();
                } catch (e) {
                    return '';
                }
            }

            function summarizeStatPost(post, limit) {
                post = post || {};
                var max = limit || 40;
                var text = String(post.content || '').trim();
                if (text) return text.length > max ? text.slice(0, max) + '...' : text;
                if (post.media_type === 'image') return '图片动态';
                if (post.media_type === 'video') return '视频动态';
                return '无文字内容';
            }

            function statMetricMarkup(label, value) {
                return [
                    '<div class="stat-metric">',
                    '<span class="stat-metric-value">' + escapeHtml(String(value)) + '</span>',
                    '<span class="stat-metric-label">' + escapeHtml(String(label)) + '</span>',
                    '</div>'
                ].join('');
            }

            function statHeroMarkup(opts) {
                opts = opts || {};
                var metrics = Array.isArray(opts.metrics) ? opts.metrics : [];
                return [
                    '<section class="stat-hero stat-hero--' + escapeHtml(opts.tone || 'posts') + '">',
                    opts.kicker ? '<div class="stat-hero-kicker">' + escapeHtml(opts.kicker) + '</div>' : '',
                    '<div class="stat-hero-title">' + escapeHtml(opts.title || '') + '</div>',
                    opts.copy ? '<div class="stat-hero-copy">' + escapeHtml(opts.copy) + '</div>' : '',
                    metrics.length ? '<div class="stat-hero-metrics">' + metrics.map(function(metric) { return statMetricMarkup(metric.label, metric.value); }).join('') + '</div>' : '',
                    '</section>'
                ].join('');
            }

            function statEmptyMarkup(opts) {
                opts = opts || {};
                return [
                    '<div class="stat-empty-rich stat-surface-card">',
                    opts.kicker ? '<div class="stat-hero-kicker">' + escapeHtml(opts.kicker) + '</div>' : '',
                    '<div class="stat-empty-title">' + escapeHtml(opts.title || '暂无数据') + '</div>',
                    opts.copy ? '<div class="stat-empty-copy">' + escapeHtml(opts.copy) + '</div>' : '',
                    opts.note ? '<div class="stat-empty-note">' + escapeHtml(opts.note) + '</div>' : '',
                    '</div>'
                ].join('');
            }

            function statPostItemMarkup(post) {
                var hasImg = post.media_url && post.media_type === 'image';
                var hasVid = post.media_url && post.media_type === 'video';
                var tag = hasImg ? '<span class="spi-img-tag">图片</span>' : (hasVid ? '<span class="spi-img-tag">视频</span>' : '<span class="spi-img-tag spi-img-tag--text">文字</span>');
                var display = summarizeStatPost(post, 38);
                var onclick = "openPostDetail('" + String(post.id).replace(/'/g, "\\'") + "')";
                return [
                    '<div class="stat-post-item" onclick="' + onclick + '" title="点击查看帖子详情">',
                    '<div class="spi-main">',
                    '<div class="spi-content-row"><span class="spi-content">' + escapeHtml(display) + '</span>' + tag + '</div>',
                    '<div class="spi-meta"><span class="spi-time">' + escapeHtml(formatStatTime(post.created_at)) + '</span><span class="spi-open">查看详情</span></div>',
                    '</div>',
                    hasImg ? '<img class="spi-thumb" src="' + escapeHtml(post.media_url) + '" alt="" />' : (hasVid ? '<div class="spi-thumb spi-thumb--video">VIDEO</div>' : ''),
                    '</div>'
                ].join('');
            }

            renderPostStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userMap = {};
                statAllPosts.forEach(function(p) {
                    if (!userMap[p.user_name]) userMap[p.user_name] = [];
                    userMap[p.user_name].push(p);
                });
                var entries = Object.entries(userMap).sort(function(a, b) {
                    return b[1].length - a[1].length;
                });
                if (!entries.length) {
                    body.innerHTML = statEmptyMarkup({
                        kicker: 'POSTS',
                        title: '还没有动态统计',
                        copy: '这里会按用户整理所有动态，方便你快速查看谁发得最多、最近发了什么。'
                    });
                    return;
                }
                body.innerHTML = statHeroMarkup({
                    tone: 'posts',
                    kicker: 'POSTS',
                    title: '总动态总览',
                    copy: '按用户分组展示，优先显示发帖更活跃的用户。',
                    metrics: [
                        { label: '动态总数', value: statAllPosts.length },
                        { label: '活跃用户', value: entries.length },
                        { label: '最近更新', value: entries[0] && entries[0][1] && entries[0][1][0] ? formatStatTime(entries[0][1][0].created_at).slice(0, 16) : '--' }
                    ]
                }) + '<div class="stat-stack">' + entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    var latest = posts[0] ? formatStatTime(posts[0].created_at) : '--';
                    var moreButton = posts.length > 3
                        ? '<button class="stat-view-btn" onclick="loadUserAllPosts(\'' + String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">查看全部 ' + posts.length + ' 条/button>'
                        : '';
                    return [
                        '<section class="stat-user-group stat-surface-card">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(name).slice(0, 1).toUpperCase() + '</div><div class="suh-copy"><span class="suh-name">' + escapeHtml(name) + '</span><span class="suh-sub">最近更新:' + escapeHtml(latest) + '</span></div></div><div class="suh-right"><span class="suh-count">' + posts.length + ' 条/span>' + moreButton + '</div></div>',
                        '<div class="stat-user-posts">',
                        posts.slice(0, 3).map(function(p) { return statPostItemMarkup(p); }).join(''),
                        '</div>',
                        '</section>'
                    ].join('');
                }).join('') + '</div>';
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = statAllPosts.filter(function(p) { return p.user_name === userName; });
                body.innerHTML = [
                    '<button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">返回总动态/button>',
                    statHeroMarkup({
                        tone: 'posts',
                        kicker: 'USER POSTS',
                        title: userName + ' 的全部动态',
                        copy: '按时间倒序展示该用户发布过的所有内容。',
                        metrics: [
                            { label: '动态数量', value: userPosts.length },
                            { label: '最新发布', value: userPosts[0] ? formatStatTime(userPosts[0].created_at).slice(0, 16) : '--' }
                        ]
                    }),
                    '<div class="stat-stack">' + userPosts.map(function(p) { return statPostItemMarkup(p); }).join('') + '</div>'
                ].join('');
            };

            renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = getViewHistory();
                if (!history.length) {
                    body.innerHTML = statEmptyMarkup({
                        kicker: 'VIEWS',
                        title: '还没有浏览记录',
                        copy: '当你查看帖子详情时，这里会自动记录谁看了哪条帖子，方便回看浏览轨迹。',
                        note: '浏览记录保存在当前设备的本地缓存中。'
                    });
                    return;
                }
                body.innerHTML = statHeroMarkup({
                    tone: 'views',
                    kicker: 'VIEWS',
                    title: '浏览记录',
                    copy: '记录最近的帖子浏览轨迹，帮助你回看被访问过的内容。',
                    metrics: [
                        { label: '记录条数', value: history.length },
                        { label: '最近浏览', value: formatStatTime(history[0].viewed_at).slice(0, 16) },
                        { label: '浏览总量', value: document.getElementById('sViews') ? document.getElementById('sViews').textContent : history.length }
                    ]
                }) + '<div class="stat-stack">' + history.map(function(v) {
                    return [
                        '<article class="stat-view-item">',
                        '<div class="stat-record-head"><div class="svi-user">' + escapeHtml(v.user_name) + '</div><span class="svi-time">' + escapeHtml(formatStatTime(v.viewed_at)) + '</span></div>',
                        '<div class="stat-record-title">浏览了 ' + escapeHtml(v.post_author) + ' 的帖子</div>',
                        '<div class="stat-record-copy">' + escapeHtml(v.post_content || '无文字内容') + '</div>',
                        '</article>'
                    ].join('');
                }).join('') + '</div>';
            };

            renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var postMap = {};
                statAllPosts.forEach(function(p) { postMap[p.id] = p; });

                function buildLikesCol() {
                    var h = '<div class="stat-section-title"><span>点赞记录</span><span class="stat-section-count">' + statAllLikes.length + '</span></div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(function(l) {
                            var post = postMap[l.post_id];
                            var postContent = post ? summarizeStatPost(post, 32) : '原帖已删除';
                            return [
                                '<article class="stat-like-item">',
                                '<div class="stat-record-head"><div class="sli-user">' + escapeHtml(l.user_name) + '</div><span class="sli-time">' + escapeHtml(formatStatTime(l.created_at)) + '</span></div>',
                                '<div class="stat-record-title">点赞了这条内容</div>',
                                '<div class="stat-record-copy">' + escapeHtml(postContent) + '</div>',
                                '</article>'
                            ].join('');
                        }).join('');
                    } else {
                        h += statEmptyMarkup({ title: '暂无点赞记录', copy: '当有人给帖子点赞后，这里会显示最近的互动。' });
                    }
                    return h;
                }

                function buildCommentsCol() {
                    var h = '<div class="stat-section-title"><span>评论记录</span><span class="stat-section-count">' + statAllComments.length + '</span></div>';
                    if (statAllComments.length) {
                        h += statAllComments.slice().reverse().slice(0, 200).map(function(c) {
                            var post = postMap[c.post_id];
                            var postContent = post ? summarizeStatPost(post, 28) : '原帖已删除';
                            return [
                                '<article class="stat-comment-item">',
                                '<div class="stat-record-head"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><span class="sci-time">' + escapeHtml(formatStatTime(c.created_at)) + '</span></div>',
                                '<div class="stat-record-title">评论了这条内容</div>',
                                '<div class="stat-record-copy">原帖：' + escapeHtml(postContent) + '</div>',
                                '<div class="stat-record-note">' + escapeHtml(c.content || '无评论内容') + '</div>',
                                '</article>'
                            ].join('');
                        }).join('');
                    } else {
                        h += statEmptyMarkup({ title: '暂无评论记录', copy: '评论互动出现后，这里会按时间整理出来。' });
                    }
                    return h;
                }

                body.innerHTML = statHeroMarkup({
                    tone: 'likes',
                    kicker: 'ENGAGEMENT',
                    title: '点赞与评论',
                    copy: '把两类互动拆开展示，便于快速看清谁在点赞、谁在发言。',
                    metrics: [
                        { label: '总互动', value: statAllLikes.length + statAllComments.length },
                        { label: '点赞', value: statAllLikes.length },
                        { label: '评论', value: statAllComments.length }
                    ]
                }) + '<div class="stat-two-col"><section class="stat-col">' + buildLikesCol() + '</section><section class="stat-col">' + buildCommentsCol() + '</section></div>';
            };

            window.openPostDetail = async function(postId) {
                document.getElementById('postDetailTitle').textContent = '帖子详情';
                document.getElementById('postDetailBody').innerHTML = window.xtjMagicLoadingHtml('加载中..', '加载中..', 'feed');
                document.getElementById('postDetailModal').classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);

                    const post = normalizePost(postRes.data);
                    if (!post) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">帖子不存在或已删除/div>';
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
                    ${post.media_url ? `<div class="post-detail-media">${post.media_type==='video'?`<video src="${escapeHtml(post.media_url)}" controls preload="none"></video>`:`<img src="${escapeHtml(post.media_url)}" onclick="openImageViewer('${safeJsStr(post.media_url)}')" loading="lazy" />`}</div>` : ''}
                    <div class="post-detail-stats">浏览 ${vc} 次 | 点赞 ${likes.length} 次 | 评论 ${comments.length}</div>
                    <div class="stat-two-col">
                        <div class="stat-col">
                            <div class="stat-section-title">✅ 点赞用户 ${likes.length}</div>
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
                            <div class="stat-section-title">馃挰 评论列表 ${comments.length}</div>
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

            // 鏍煎紡鍖栧笘瀛愬唴瀹规憳瑕侊紙锟姐劋浜庣仦鏇犮仛锛?
            function formatPostSummary(p) {
                const text = p.content || '';
                const hasImg = p.media_url && p.media_type === 'image';
                const hasVid = p.media_url && p.media_type === 'video';
                let tag = '';
                if (hasImg) tag = '<span class="spi-img-tag">? 图片</span>';
                if (hasVid) tag = '<span class="spi-img-tag">馃幀 视频</span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '一张图片' : hasVid ? '一个视频' : '(无内容)');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 鐢熸垚帖子锟斤紕娲伴惃鍑ML閿涘牆褰查悙鐟板毊鐠哄疇娴嗭細
            function renderPostItemHTML(p) {
                const fmt = formatPostSummary(p);
                const onclick = `openPostDetail('${safeJsStr(p.id)}')`;
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
                // 閹?user_name 分组缁燂拷顓?
                const userMap = {};
                statAllPosts.forEach(p => {
                    if (!userMap[p.user_name]) userMap[p.user_name] = [];
                    userMap[p.user_name].push(p);
                });
                const entries = Object.entries(userMap).sort((a, b) => b[1].length - a[1].length);
                
                if (!entries.length) {
                    body.innerHTML = '<div class="stat-empty">暂无鍔ㄦ€佹暟鎹?/div>';
                    return;
                }

                body.innerHTML = entries.map(([name, posts]) => `
                    <div class="stat-user-group">
                        <div class="stat-user-header">
                            <div class="suh-left">
                                <div class="suh-avatar">${escapeHtml(name)[0].toUpperCase()}</div>
                                <span class="suh-name">${escapeHtml(name)}</span>
                            </div>
                            <span class="suh-count">${posts.length} 条/span>
                        </div>
                        <div class="stat-user-posts">
                            ${posts.slice(0, 3).map(p => renderPostItemHTML(p)).join('')}
                            ${posts.length > 3 ? `
                                <div style="text-align:center; padding:8px 0;">
                                    <button class="stat-view-btn" onclick="loadUserAllPosts('${safeJsStr(name)}')">查看全部 ${posts.length} 条/button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('');
            }

            // 閺屻儳婀呴幐鍥х暰用户閻ㄥ嫭澧嶉張澶婄瑯瀛?
            window.loadUserAllPosts = function(userName) {
                const body = document.getElementById('statModalBody');
                const userPosts = statAllPosts.filter(p => p.user_name === userName);
                body.innerHTML = `
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">鈫?返回总动态/button>
                    <div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        ${userName} 鐨勫叏閮ㄥ笘瀛愶紙${userPosts.length} 鏉★級
                    </div>
                    ${userPosts.map(p => renderPostItemHTML(p)).join('')}
                `;
            };

            // 濞撳弶鐓嬮幀缁樼セ鐟欏牏绮虹拋鈽呯礄娴?localStorage 鐠囪褰囨祻瑙堥崢鍡楀蕉锛?
            function renderViewStats() {
                const body = document.getElementById('statModalBody');
                const history = getViewHistory();
                
                if (!history.length) {
                    body.innerHTML = `
                        <div class="stat-empty">
                            <div style="font-size:16px; margin-bottom:8px;">📰 浏览记录</div>
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

            // 濞撳弶鐓嬬偣璧為崪宀冪槑鐠佽櫣绮鸿
            function renderLikeStats() {
                const body = document.getElementById('statModalBody');

                const postMap = {};
                statAllPosts.forEach(p => { postMap[p.id] = p; });

                function buildLikesCol() {
                    let h = '<div class="stat-section-title">点赞记录</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(l => {
                            const post = postMap[l.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                            return `
                        <div class="stat-like-item">
                            <div class="sli-info">
                                <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                <div class="sli-target">点赞浜嗭細${postContent}</div>
                            </div>
                            <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">点赞记录</div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    let h = '<div class="stat-section-title">馃挰 评论记录</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">评论娴滃棎鈧?{postContent}閵嗗稄绱?{escapeHtml(c.content)}</div>
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

            // ===================== 闁氨鐓＄化鑽ょ埠 =====================
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

                // 寮哄埗閿熸枻鎷烽敓钘夋珤鐎瑰本鍨氱敮鍐ㄩ浌閿熻棄鎮楅崘宥嗗潑閸旂垙how缂侇偂绱槐婵堟兜椤旇崵绠紺SS transition濮濓絿鈥樼憴锕€锟?
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

            // ==== 测试通知锟筋亜绠欓敍鍫熷付閸掕泛褰寸拫鍐暏閿涙estNotification()闁?====
            window.testNotification = function() {
                showNotification('张三', '这是一条测试消息，检查通知文本显示是否正常');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常长的测试消息，用来检查文本截断效果到底怎么样，超过300个字符也不怕');
            };

            // ===================== 閼卞﹤銇夌化鑽ょ埠 (Dock 鍏煎锟? =====================
            let chatRealtime = null;
            let dmpollTimer = null;
            let dmpollInterval = null;

            var _escapeDiv = null;
            function escapeHtml(str) {
                var s = String(str == null ? '' : str);
                if (s.length < 80) {
                    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                }
                if (!_escapeDiv) _escapeDiv = document.createElement('div');
                _escapeDiv.textContent = s;
                return _escapeDiv.innerHTML;
            }
            window.escapeHtml = escapeHtml;

            // Safely escape a value for use inside a JavaScript single-quoted string
            // that is itself inside an HTML attribute (e.g. onclick="...'...'...")
            function safeJsStr(str) {
                var s = String(str == null ? '' : str);
                // Must escape & first, then \, then ', then "
                return s.replace(/&/g, '&amp;').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            }
            window.safeJsStr = safeJsStr;




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

            function sanitizeStorageFileName(name) {
                var raw = String(name || "file");
                var extMatch = raw.match(/(\.[a-zA-Z0-9]{1,8})$/);
                var ext = extMatch ? extMatch[1].toLowerCase() : "";
                var base = ext ? raw.slice(0, -ext.length) : raw;
                if (base.normalize) base = base.normalize("NFKD");
                base = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
                if (!base) base = "media";
                return base + ext;
            }

            function buildStorageUploadPath(scope, fileName) {
                return String(scope || "misc") + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "_" + sanitizeStorageFileName(fileName);
            }

            window.handleDockChatImageError = function(img) {
                if (!img || !img.parentNode) return;
                var fullSrc = img.getAttribute("data-full-src") || img.currentSrc || img.src || "";
                var fallback = document.createElement("button");
                fallback.type = "button";
                fallback.className = "msg-media-fallback";
                fallback.innerHTML = '<span class="msg-media-fallback-icon">图片</span><span class="msg-media-fallback-text">查看图片</span>';
                fallback.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fullSrc && typeof window.openImageViewer === "function") {
                        window.openImageViewer(fullSrc);
                    } else {
                        showToast("图片加载失败");
                    }
                };
                img.parentNode.replaceChild(fallback, img);
            };

            function isMsgReadByMe(msg) {
                var key = 'xtj_dmread_' + window.currentUser + '_' + msg.user_name;
                return !!localStorage.getItem(key);
            }

            function markMessagesRead(senderName) {
                var key = 'xtj_dmread_' + window.currentUser + '_' + senderName;
                localStorage.setItem(key, new Date().toISOString());
                window.dockChatListCacheTime = 0;
                loadDockChatList();
                updateUnreadBadge();
            }

            function subscribeToMessages() {
                if (chatRealtime) { sb.removeChannel(chatRealtime); chatRealtime = null; }
                chatRealtime = sb.channel('chat-dms')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, function(payload) {
                        var m = payload.new;
                        if (m.media_type !== DM_MARKER) return;
                        if (!window.currentUser) return;
                        if (m.media_url !== window.currentUser) return;
                        if (m.user_name === window.currentUser) return;
                        localStorage.removeItem('xtj_dmread_' + window.currentUser + '_' + m.user_name);
                        showNotification(m.user_name, m.content || '发送了一张图片/视频');
                        if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser === m.user_name) {
                            loadDockChatMessages(m.user_name, false);
                        } else if (typeof dockChatActiveUser === 'undefined' || !dockChatActiveUser) {
                            window.dockChatListCacheTime = 0;
                            loadDockChatList();
                            updateUnreadBadge();
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
                // 濞寸姾顕ф慨?閿涙岸绮拋銈夋？锟?5 鍒嗛挓锟?00000ms閿涘绱濋梽宥勭秵閿熸枻鎷烽敓鏂ゆ嫹鎼存捁顕Ч鍌氬竾锟?
                interval = interval || 300000;
                if (dmpollTimer) {
                    if (dmpollInterval === interval) return;
                    clearInterval(dmpollTimer); dmpollTimer = null;
                }
                dmpollInterval = interval;
                async function pollNow() {
                    if (!window.currentUser) return;
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
                        .eq('media_url', window.currentUser)
                        .order('created_at', { ascending: false })
                        .limit(200);

                    var data = result.data;
                    var error = result.error;
                    if (error) return;
                    var cnt = 0;
                    (data || []).forEach(function(m) {
                        if (!window.isMsgReadByMe(m)) cnt++;
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

            // ========== Dock 闁告帒娲﹀畷?==========
            let currentDockTab = localStorage.getItem('xtj_current_tab') || 'posts';
            let lastTabTapTime = {};
            let lastTabTapCount = {};
            let isRefreshing = {};
            window.switchDockTab = function(tab, skipReturn) {
                if (tab === 'chat' && !currentUser) { showToast('请先登录'); return; }
                if (tab !== currentDockTab) {
                    try { var imv = document.getElementById('imgViewer'); if (imv && imv.classList.contains('active')) closeImageViewer(); } catch(e) {}
                    try { var am = document.getElementById('announcementModal'); if (am && am.classList.contains('active')) closeAnnouncementModal(); } catch(e) {}
                    try { var sm = document.getElementById('statModal'); if (sm && sm.classList.contains('active')) sm.classList.remove('active'); } catch(e) {}
                    try { var cm = document.getElementById('commentModal'); if (cm && cm.classList.contains('active')) closeModal('commentModal'); } catch(e) {}
                    document.body.style.overflow = '';
                }
                // 鍏堬拷袝鍙戠偣鍑诲姩鐢伙紙鍗充娇宸茬粡锟姐劌缍嬮崜宄礱b涔燂拷顩﹂幘顓熸杹锟?
                var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (btn) triggerTabAnimation(btn, tab);
                const now = Date.now();
                
                // 濡澁鎷烽弻銉︽Ц閸氾附妲搁崣灞藉毊鍒烽敓鏂ゆ嫹锟?00ms鍐呭啀锟斤紕鍋ｉ崙璇叉倱娑擃澁鎷穞ab锟?
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);
                
                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 双击锛氭墽琛屽埛锟?
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            window.showToast('刷新失败');
                            ensurePhotoWallLoaded().then(function() {
                                if (typeof window.loadPhotoWallData === 'function') {
                                    return window.loadPhotoWallData(true).then(function() {
                                        if (typeof window.renderPhotoWall === 'function') {
                                            window.renderPhotoWall();
                                        }
                                    });
                                }
                            }).then(function() {
                                isRefreshing[tab] = false;
                                window.showToast('刷新完成');
                            }).catch(function() {
                                isRefreshing[tab] = false;
                                window.showToast('刷新失败');
                            });
                        } else if (tab === 'posts') {
                            // 帖子椤靛埛??
                            window.showToast('正在刷新...');
                            // 娓呴櫎缂傛挸鐡ㄦ鐐茬埣閸ｅ憡鏌婃晶鐐差潱閺?
                            try {
                                localStorage.removeItem(CACHE_KEY);
                            } catch(e) {}
                            if (typeof window.initialLoad === 'function') {
                                rebuildFeedFromCurrentState()
                                    .then(function() {
                                        return syncFeedDataInBackground();
                                    })
                                    .catch(function(err) {
                                        isRefreshing[tab] = false;
                                        console.error('[posts] fast refresh failed', err);
                                        window.showToast('刷新失败');
                                    });
                            }
                            // 鍥炲埌顶部
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                            window.showToast('刷新完成');
                        } else if (tab === 'chat') {
                            // 閼卞﹤銇夊銈夋涧閸╂盯式
                            window.showToast('正在刷新...');
                            window.dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        } else if (tab === 'profile') {
                            // 涓汉椤靛埛??
                            window.showToast('正在刷新...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            loadProfileActivity(true);
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        }
                    } else {
                        // 鍗曞嚮锛氭墽琛岃繑锟?鍥為《鎿嶄綔
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 帖子椤碉細鍥炲埌顶部
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 閿熸枻鎷烽敓鏂ゆ嫹妞ょ绱版俊鍌涚亯閸︺劌顕瘽涓紝返回鑱婏拷鈺佸灙鐞涱煉绱遍崥锕€鍨崶鐐插煂妞ゅ爼锟?
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
                            // 鎴戠殑椤碉細鍥炲埌顶部
                            const panel = document.getElementById('panelProfile');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }
                    lastTabTapTime[tab] = now;
                    return;
                }
                
                // 锟叫伙拷鍒版柊tab
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
                if (tab === 'chat') {
                    if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {
                        document.getElementById('dockChatListView').classList.add('hidden');
                        document.getElementById('dockChatDetailView').classList.remove('hidden');
                        document.getElementById('dockChatBackBtn').style.display = 'flex';
                        document.getElementById('dockChatTitle').textContent = dockChatActiveUser;
                    } else {
                        loadDockChatList();
                    }
                    startDMPolling(300000);
                }
                if (tab === 'ai') { ensurePhotoWallLoaded().then(function() { if (typeof window.initPhotoWall === 'function') window.initPhotoWall(); }); }
                if (tab === 'profile') { syncProfileUser(); if (currentUser) loadUserAvatar(); loadProfileActivity(false); }
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
                // Use rAF to synchronize with iOS rendering pipeline for smooth 60fps compositing
                requestAnimationFrame(function() {
                    // Promote anim-layer to GPU only during animation to conserve GPU memory on iOS
                    var animLayer = el.querySelector('.anim-layer');
                    if (animLayer) animLayer.style.willChange = 'transform, opacity';
                    el.classList.add(cls);
                    // Clean up after animation duration + small buffer using rAF
                    var cleanupFrame = Math.round((animDurations[tab] + 50) / (1000 / 60));
                    var frames = 0;
                    function cleanup() {
                        frames++;
                        if (frames >= cleanupFrame) {
                            el.classList.remove(cls);
                            if (animLayer) animLayer.style.willChange = 'auto';
                            animatingTabs[tab] = false;
                        } else {
                            requestAnimationFrame(cleanup);
                        }
                    }
                    requestAnimationFrame(cleanup);
                });
            }

            document.querySelectorAll('.dock-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    var tab = this.dataset.tab;
                    switchDockTab(tab);
                });
            });
            // ========== Dock 闁煎崬锕ら妵?==========
            let dockChatActiveUser = null;
            let dockChatSending = false;
            let dockChatMsgsBusy = false;
            let dockChatMsgsDirty = '';
            let dockChatMsgsUser = null;
            let _dockPreviewUrl = null;

                                                            function renderChatLoadingState(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                el.innerHTML = window.xtjMagicLoadingHtml(title, subtitle, variant);
            }

            function dockChatGoBack() {
                dockChatActiveUser = null;
                document.getElementById('dockChatDetailView').classList.add('hidden');
                document.getElementById('dockChatListView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'none';
                document.getElementById('dockChatTitle').textContent = '消息';
                window.dockChatListCacheTime = 0;
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
                if (!window.currentUser) { showToast('请先登录'); return; }
                if (userName === window.currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                document.getElementById('dockChatMessages').innerHTML = window.xtjMagicLoadingHtml('加载中..', '正在打开聊天通道', 'chat-detail');
                renderChatLoadingState(document.getElementById('dockChatMessages'), {
                    title: '加载中..',
                    subtitle: '正在打开聊天通道',
                    variant: 'chat-detail'
                });
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
                if (!dockChatActiveUser) {
                    document.getElementById('dockChatDetailView').classList.add('hidden');
                    document.getElementById('dockChatListView').classList.remove('hidden');
                    document.getElementById('dockChatBackBtn').style.display = 'none';
                    document.getElementById('dockChatTitle').textContent = '消息';
                }
                if (Date.now() - (window.dockChatListCacheTime || 0) < DOCK_CHAT_CACHE_DURATION) return;
                window.dockChatListCacheTime = Date.now();
                el.innerHTML = window.xtjMagicLoadingHtml('加载中...', '正在取回最近消息', 'chat-list');
                try {
                    renderChatLoadingState(el, {
                        title: '加载中...',
                        subtitle: '正在取回最近消息',
                        variant: 'chat-list'
                    });
                    const { data: allMsgs, error } = await sb.from("posts")
                        .select("id, user_name, media_url, content, created_at")
                        .eq("media_type", DM_MARKER)
                        .or(`user_name.eq.${window.currentUser},media_url.eq.${window.currentUser}`)
                        .order("created_at", { ascending: false })
                        .limit(200);
                    if (error) throw error;
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>暂无消息</div><div style="font-size:12px;">在帖子页面点击头像就可以开始聊天</div></div>';
                        updateUnreadBadge();
                        return;
                    }
                    const convMap = {};
                    allMsgs.forEach(m => {
                        const other = m.user_name === window.currentUser ? m.media_url : m.user_name;
                        if (!convMap[other] || new Date(m.created_at) > new Date(convMap[other].last_time)) {
                            convMap[other] = { other_user: other, last_message: m.content, last_time: m.created_at, unread: 0 };
                        }
                        if (m.media_url === window.currentUser && !window.isMsgReadByMe(m)) {
                            convMap[other].unread = Math.min((convMap[other].unread || 0) + 1, 99);
                        }
                    });
                    const convs = Object.values(convMap).sort((a, b) => new Date(b.last_time) - new Date(a.last_time));
                    // 棰勯敓鑺傦拷?鎷锋潪鍊熶喊婢垛晛鍨悰銊ャ仈锟?
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
                    el.innerHTML = convs.map(function(c, index) {
                        var avHtml = avatarCache[c.other_user]
                            ? '<img src="' + avatarCache[c.other_user] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                            : c.other_user[0].toUpperCase();
                        return `
                        <div class="chat-list-item" style="--xtj-enter-delay:${Math.min(index * 28, 220)}ms" onclick="openChat('${c.other_user.replace(/'/g, "\\'")}')">
                            <div class="cli-avatar">${avHtml}</div>
                            <div class="cli-info"><div class="cli-name">${c.other_user}</div><div class="cli-preview">${c.last_message}</div></div>
                            <div class="cli-right"><span class="cli-time">${formatMsgTime(c.last_time)}</span>${c.unread ? '<span class="cli-badge">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : ''}</div>
                        </div>`;
                    }).join('');
                    updateUnreadBadge();
                } catch(e) {
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">!</div><div>' + (e.message || '加载失败') + '</div></div>';
                }
            }

            // 鑱婂ぉ消息閺堟勾缂撳瓨閿涘奔绨╁▎鈩冨ⅵ瀵偓缁夋帒锟??
            var _chatCache = {};

            async function loadDockChatMessages(userName, forceScroll) {
                if (dockChatMsgsBusy && dockChatMsgsUser === userName) { dockChatMsgsDirty = userName; return; }
                // 棰勯敓鑺傦拷?鎷锋潪钘夊蓟閺傜懓銇旈敓?
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
                // 褰撳墠用户浼樺厛浣跨敤localStorage闂佸搫顦崯顐﹀煝婢跺瞼澶勯悗?
                if (currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 閺堝绱︾€涙ê鍘涚珛鍗虫樉锟?
                var cacheKey = currentUser + '_' + userName;
                if (_chatCache[cacheKey] && !forceScroll) {
                    renderDockMessages(_chatCache[cacheKey], true);
                }
                dockChatMsgsBusy = true; dockChatMsgsUser = userName; dockChatMsgsDirty = '';
                const el = document.getElementById('dockChatMessages');
                try {
                    const { data: msgs, error } = await sb.from("posts").select("id, user_name, media_url, content, created_at, views, actor_key")
                        .eq("media_type", DM_MARKER)
                        .or(`and(user_name.eq.${window.currentUser},media_url.eq.${userName}),and(user_name.eq.${userName},media_url.eq.${window.currentUser})`)
                        .order("created_at").limit(500);
                    if (error) throw error;
                    _chatCache[cacheKey] = msgs || [];
                    const toMark = (msgs || []).filter(m => m.user_name === userName && m.media_url === window.currentUser && (m.views || 0) === 0);
                    await Promise.all(toMark.map(m => sb.rpc("increment_post_views", { p_post_id: m.id }).catch(() => {})));
                    toMark.forEach(m => { m.views = 1; });
                    window.markMessagesRead(userName);
                    renderDockMessages(msgs || [], forceScroll);
                } catch(e) {
                    if (!_chatCache[cacheKey]) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>' + (e.message || '加载失败') + '</div></div>';
                    }
                } finally {
                    dockChatMsgsBusy = false;
                    if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
                }
            }

            function renderDockMessages(msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>'; return; }
                // 濡澁鎷峰ù瀣暏閹撮攱妲搁崥锕€婀敓浠嬬湅閸樺棗褰堕敓鏂ゆ嫹褰曢敍鍫㈩瀲鎼存洟鍎撮敓鏂ゆ嫹閿熸枻锟?00px鐟欏棔璐熼崷锟窖勭畽闁告ê妫楄ぐ鍫曟晸?
                var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                // 鍏堥殣钘忥拷顔愰崳顭掔礉濞撳弶鐓嬬€瑰瞼娲块幒銉ュ煂鎼存洖鍟€閿熸枻鎷风ず閿涘矂浼╅崗宥勭矤妞ゅ爼鍎达拷?鎴滅瑓閺夈儳娈戦梻顏嗗剨
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
                        var imageSrc = getMediaUrl('__dm_img__', m.actor_key.replace('__dm_img__', ''));
                        body = '<img class="msg-img" src="' + imageSrc + '" data-full-src="' + imageSrc + '" onclick="openImageViewer(this.getAttribute(\'data-full-src\') || this.src)" onerror="window.handleDockChatImageError(this)" loading="lazy" />';
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
                // 濞撳弶鐓嬬€瑰本鐦敍灞炬▔缁€鍝勵啇锟?
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
                        const path = buildStorageUploadPath('chat', file.name);
                        await sb.storage.from("uploads").upload(path, file, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: file.type || 'application/octet-stream'
                        });
                        actorKey = file.type.startsWith('video/') ? '__dm_vid__' + path : '__dm_img__' + path;
                    }
                    const { error } = await sb.from("posts").insert([{ user_name: currentUser, content: content, media_type: DM_MARKER, media_url: dockChatActiveUser, actor_key: actorKey }]);
                    if (error) throw error;
                    clearDockChatFilePreview(false);
                    await loadDockChatMessages(dockChatActiveUser, true);
                    const msgs = document.getElementById('dockChatMessages');
                    if (msgs) {
                        msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
                        const lastMsg = msgs.lastElementChild && msgs.lastElementChild.querySelector ? msgs.lastElementChild.querySelector('.chat-msg') : null;
                        if (lastMsg) {
                            lastMsg.classList.add('sent-anim');
                            setTimeout(function() {
                                msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
                            }, 200);
                        }
                    }
                } catch(e) { showToast('发送失败 ' + (e?.message || e)); inp.value = content; }
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

            function clearDockChatFilePreview(restoreFocus) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const fileInput = document.getElementById('dockChatFileInp');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                preview.classList.add('hidden'); input.classList.remove('hidden'); fileInput.value = '';
                if (restoreFocus !== false) input.focus();
            }

            try {
                var _dsb = document.getElementById('dockChatSendBtn'); if (_dsb) _dsb.addEventListener('click', sendDockChatMessage);
                var _dci = document.getElementById('dockChatInput'); if (_dci) _dci.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDockChatMessage(); } });
                var _dib = document.getElementById('dockChatImgBtn'); if (_dib) _dib.addEventListener('click', function() { document.getElementById('dockChatFileInp').click(); });
                var _dfi = document.getElementById('dockChatFileInp'); if (_dfi) _dfi.addEventListener('change', function() { if (this.files.length) showDockChatFilePreview(this.files[0]); });
                var _dcr = document.getElementById('dockCfpRemove'); if (_dcr) _dcr.addEventListener('click', clearDockChatFilePreview);
            } catch(e) {
            }

            window.addEventListener('DOMContentLoaded', async function() {
                // iOS 键盘与可视视口适配
                (function() {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
                    const root = document.documentElement;
                    let keyboardOpen = false;

                    function hasActiveInput() {
                        var active = document.activeElement;
                        return !!(active && inputs.indexOf(active.id) >= 0);
                    }

                    function updateIOSViewport() {
                        var vv = window.visualViewport;
                        var appHeight = vv ? Math.round(vv.height) : window.innerHeight;
                        root.style.setProperty('--xtj-app-height', appHeight + 'px');
                        var keyboardGap = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
                        root.style.setProperty('--xtj-ios-keyboard-gap', keyboardGap + 'px');
                        var chatFocused = document.activeElement && document.activeElement.id === 'dockChatInput' && currentDockTab === 'chat';
                        document.body.classList.toggle('ios-chat-keyboard-open', !!(chatFocused && keyboardGap > 0));
                        if (dockBar) dockBar.style.display = hasActiveInput() ? 'none' : 'flex';
                        if (chatFocused) setTimeout(scrollDockChatBottom, 80);
                    }

                    function handleFocus(e) {
                        keyboardOpen = true;
                        updateIOSViewport();
                        setTimeout(() => {
                            if (e.target && e.target.scrollIntoViewIfNeeded) {
                                e.target.scrollIntoViewIfNeeded(true);
                            } else if (e.target && e.target.scrollIntoView) {
                                e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        }, 300);
                    }

                    function handleBlur() {
                        setTimeout(function() {
                            keyboardOpen = hasActiveInput();
                            if (!keyboardOpen && !document.body.classList.contains('photo-previewing')) {
                                document.body.classList.remove('ios-chat-keyboard-open');
                            }
                            updateIOSViewport();
                        }, 80);
                    }

                    inputs.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.addEventListener('focus', handleFocus);
                            el.addEventListener('blur', handleBlur);
                        }
                    });
                    if (window.visualViewport) {
                        window.visualViewport.addEventListener('resize', updateIOSViewport);
                        window.visualViewport.addEventListener('scroll', updateIOSViewport);
                    }
                    window.addEventListener('orientationchange', function() {
                        setTimeout(updateIOSViewport, 180);
                    });
                    window.addEventListener('resize', function() {
                        if (!keyboardOpen) updateIOSViewport();
                    });
                    updateIOSViewport();
                })();

                // 濞寸姾顕ф慨?閿涙矮濞囬敓?100dvh 闁哄洤銇橀崬?--vh 鏂规锛岀Щ闄ゆ棫锟?iOS 閻犲鍟弳锝嗙閿濆洨鍨?
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI(); initialLoad();
                // 鎭㈠娑撳﹥保存閻ㄥ嫭鐖ｇ粵楣冿拷?
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
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到浅色模式');
                        themeBtn.setAttribute('title', '切换到浅色模式');
                    }
                    localStorage.setItem('xtj-theme', 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到深色模式');
                        themeBtn.setAttribute('title', '切换到深色模式');
                    }
                    localStorage.setItem('xtj-theme', 'light');
                }
            }
            if (themeBtn) {
                themeBtn.addEventListener('click', function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    applyTheme(!isDark);
                });
            }
            // 鍒濓拷顫愰崠鏍﹀瘜妫版﹫绱伴敓鏂ゆ嫹閿熸枻锟?localStorage锛屽叾锟斤紕閮寸紒鐔蜂焊閿?
            const savedTheme = localStorage.getItem('xtj-theme');
            if (savedTheme === 'dark') {
                applyTheme(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme(true);
            } else {
                applyTheme(false);
            }

            // ========== 鍏憡系?==========
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
                // 閿熸枻鎷烽敓鏂ゆ嫹閸掓銆冮弮鑸典划婢跺秶顓哥悊鍛樼殑发布鍖猴拷?
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                markAnnouncementRead(ann.id);

                // 杩涘叆璇︽儏閺冨爼娈ｉ挊蹇撳絺鐢啫灏拷??
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 设置发布閼板懍淇婇幁绱欐樉绀洪張鈧柊澧炪仈閸嶅骏锟?
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = avatarCache[ann.user_name];
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + ann.user_name.charAt(0).toUpperCase() + '</div>';
                    userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + escapeHtml(ann.user_name) + '</div>';
                }

                // 濡傛灉锟筋垳顓哥悊鍛橈紝娣诲姞鍒狅拷銈嗗瘻锟?
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

                renderAnnouncementList(); // 閲嶆柊娓叉煋列表锛屾竻鐞嗘柊澧?
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
                    // 预锟节婏拷杞藉彂甯冿拷鈧懎銇旈崓?
                    if (announcements.length > 0) {
                        var publishers = new Set();
                        announcements.forEach(function(a) { publishers.add(a.user_name); });
                        loadAvatarsForUsers(Array.from(publishers));
                    }
                } catch(e) {
                    console.error('加载失败:', e);
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
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">📢</div><div>暂无公告</div></div>';
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
                    // content鐎涙顔岀€涙クSON閿涙title, content}閿涘潷osts閻炴稏鍔嶉惀鍛村嫉婵夌彻tle闁告帗顨愮槐?
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
                showConfirm('删除公告', '确定要删除这条公告吗？', '确定', async function() {
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

            // 版本更新日志
            const changelogData = [
                {
                    version: 'v0.69',
                    date: '2026-06-04',
                    content: `
                        <h4>我的页互动收口</h4>
                        <ul>
                            <li>我的页点赞记录和评论记录改为首页只预览 1 条，减少首屏占位</li>
                            <li>更多点赞内容和更多评论内容统一改成二级弹层，不再把当前页面拉得很长</li>
                            <li>评论记录整条可直接查看帖子，主按钮改成删除评论</li>
                            <li>点赞记录缩略图位置收紧到文案右侧，信息关系更清晰</li>
                        </ul>
                        <h4>详情入口整理</h4>
                        <ul>
                            <li>所有非首页查看详情入口移除置顶和取消置顶操作，避免和首页帖子操作重复</li>
                            <li>我的页互动卡、互动二级弹层、帖子详情弹层统一向首页帖子卡样式靠拢</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做了我的页互动入口、记录弹层和详情入口关系，整个链路更短、更干净，也更顺手</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.67',
                    date: '2026-06-02',
                    content: `
                        <h4>性能大幅优化</h4>
                        <ul>
                            <li>花草圈圈 Canvas 动画全面优化：阴影模糊降低60%、藤蔓分段减少33%、花粉减至8粒、蝴蝶残影减至1层</li>
                            <li>escapeHtml 改用纯字符串替换避免创建DOM元素；fixText 改为单次正则替换</li>
                            <li>全局 pointerdown 加80ms节流；移除多个 will-change 反效果声明</li>
                            <li>perf-lite 彻底禁用 echo-loader 无限循环动画；perf-balanced 大幅降低阴影和模糊</li>
                            <li>筛选用户加载动画改为中心120px花草圈圈Canvas动画</li>
                        </ul>
                    `
                },
                            {
                    version: 'v0.64',
                    date: '2026-05-31',
                    content: `
                        <h4>乱码修复与动画升级</h4>
                        <ul>
                            <li>帖子卡片浏览、点赞、评论文字乱码</li>
                            <li>点赞(❤️)、评论、编辑、删除、置顶等按钮文字乱码</li>
                            <li>私密切换和置顶徽章乱码</li>
                            <li>统计正则匹配乱码，确保计数正确更新</li>
                            <li>帖子详情页、摘要、Toast 消息中的多处乱码</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>加载动画新增 8 颗浮动星辰粒子，蓝紫白辉光飘移</li>
                            <li>光环、符文环、镜面核心视觉增强</li>
                            <li>交互粒子爆发升级：42 颗、8 色、可变大小、扩散范围加大</li>
                            <li>照片墙信息模板点击外部和再次点击 i 均可关闭</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.62',
                    date: '2026-05-30',
                    content: `
                        <h4>功能优化与Bug修复</h4>
                        <ul>
                            <li>筛选功能优化：将内联筛选控件整合为折叠式"筛选"按钮面板，支持活跃筛选计数徽章</li>
                            <li>移除帖子举报按钮及全部相关代码，清理前端残留</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复编辑帖子时公开/私密选项不真正生效的问题</li>
                            <li>修复帖子置顶功能不生效的问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.61',
                    date: '2026-05-30',
                    content: `
                        <h4>项目清理与全面检查</h4>
                        <ul>
                            <li>删除所有冗余备份文件、临时修复脚本和测试脚本（js备份、scripts目录、root fix/test等）</li>
                            <li>全面检查：HTML引用完整性、JS语法（全部通过）、乱码扫描、后端服务验证</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.60',
                    date: '2026-05-28',
                    content: `
                        <h4>核心功能修复与照片墙预览优化</h4>
                        <ul>
                            <li>修复编辑帖子公开/私密不真正生效问题</li>
                            <li>修复统计详情泄露私密帖子互动</li>
                            <li>修复照片预览双击缩小/双指缩放不稳定</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>照片墙预览新增双指缩放</li>
                            <li>标记废弃函数避免误修改</li>
                            <li>upload.js select 字段完整性提升</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.59',
                    date: '2026-05-27',
                    content: `
                        <h4>功能修复与稳定性提升</h4>
                        <ul>
                            <li>修复举报按钮点击无响应问题</li>
                            <li>修复举报提交字段名匹配，添加 fallback 机制</li>
                            <li>修复通知开关 localStorage key 不一致</li>
                            <li>修复统计详情泄露私密帖子互动</li>
                            <li>修复帖子详情页无私密权限检查</li>
                            <li>修复发帖文件上传未检查错误</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>照片墙缩略图加载速度提升</li>
                            <li>去除 index.html UTF-8 BOM</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.56',
                    date: '2026-05-26',
                    content: `
                        <h4>照片墙优化与Bug修复</h4>
                        <ul>
                            <li>照片墙缩略图延迟加载(LazyLoad)，滚动到可视区域再加载</li>
                            <li>大图预览优化，支持手势缩放和滑动切换</li>
                            <li>移除原生 confirm 弹窗，统一替换为自定义弹窗</li>
                            <li>优化统计数据显示，修复计数不准确问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.55',
                    date: '2026-05-26',
                    content: `
                        <h4>照片墙优化</h4>
                        <ul>
                            <li>照片墙性能优化：减少重排重绘，提升滚动流畅度</li>
                            <li>修复照片上传后不立即显示的问题</li>
                            <li>优化照片加载状态提示</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.54',
                    date: '2026-05-25',
                    content: `
                        <h4>API性能优化</h4>
                        <ul>
                            <li>优化 Supabase 查询性能，减少不必要的数据请求</li>
                            <li>新增双指缩放/捏合手势支持</li>
                            <li>稳定性提升：修复多条件竞态问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.53',
                    date: '2026-05-25',
                    content: `
                        <h4>闭包陷阱修复</h4>
                        <ul>
                            <li>修复循环中的闭包陷阱导致的数据加载错误</li>
                            <li>优化异步数据加载逻辑，避免重复请求</li>
                            <li>修复特定条件下页面白屏问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.52',
                    date: '2026-05-25',
                    content: `
                        <h4>照片墙数据丢失修复</h4>
                        <ul>
                            <li>修复照片墙数据丢失问题：优化数据同步机制</li>
                            <li>新增筛选和排序功能</li>
                            <li>全屏预览模式优化</li>
                            <li>跨模块数据一致性修复</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.51',
                    date: '2026-05-25',
                    content: `
                        <h4>CSS性能优化</h4>
                        <ul>
                            <li>优化 CSS 选择器性能，减少重排重绘</li>
                            <li>图片压缩优化，首屏加载速度提升</li>
                            <li>移除冗余 CSS 代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.50',
                    date: '2026-05-25',
                    content: `
                        <h4>照片墙功能增强</h4>
                        <ul>
                            <li>照片墙交互优化：新增双击缩放、滑动切换</li>
                            <li>优化照片分类和标签系统</li>
                            <li>提升移动端触摸体验</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.40',
                    date: '2026-05-24',
                    content: `
                        <h4>UI视觉优化</h4>
                        <ul>
                            <li>整体UI视觉优化：统一设计语言</li>
                            <li>照片墙滑块组件优化</li>
                            <li>响应式布局适配改进</li>
                            <li>清理废弃代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.38',
                    date: '2026-05-18',
                    content: `
                        <h4>移除雅思词汇系统</h4>
                        <ul>
                            <li>移除完整的雅思词汇学习系统</li>
                            <li>清理所有相关代码和样式</li>
                            <li>优化整体性能</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.37',
                    date: '2026-05-18',
                    content: `
                        <h4>雅思词汇页面增强</h4>
                        <ul>
                            <li>panelAi 改造：采用简洁 HTML 结构</li>
                            <li>单词图片 base64 化，适配 localStorage 存储</li>
                            <li>响应式布局 grid-template-columns: repeat(5, 1fr)</li>
                            <li>悬停和交互动画优化</li>
                            <li>预览显示作者、发布时间和浏览数</li>
                            <li>照片按上传时间排序（最新在前）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.36',
                    date: '2026-05-13',
                    content: `
                        <h4>极致毛玻璃效果</h4>
                        <ul>
                            <li>修复所有浏览器 backdrop-filter 兼容性问题</li>
                            <li>锁屏面板和遮罩层毛玻璃效果完善</li>
                            <li>卡片、选项、反馈面板高级毛玻璃质感</li>
                            <li>优化毛玻璃遮罩层叠顺序</li>
                            <li>暗色模式同步深度渐变背景</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.35',
                    date: '2026-05-13',
                    content: `
                        <h4>音频系统修复与毛玻璃增强</h4>
                        <ul>
                            <li>修复 AudioContext 被浏览器挂起导致无声的问题</li>
                            <li>修复继续按钮位置：调整间距布局</li>
                            <li>毛玻璃效果增强：卡片/选项/反馈面板统一优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.34',
                    date: '2026-05-13',
                    content: `
                        <h4>学习系统增强</h4>
                        <ul>
                            <li>修复继续按钮位置，反馈移到底部</li>
                            <li>新增对错答案音效反馈</li>
                            <li>Web Audio API 语音优化</li>
                            <li>修复音频资源管理内存泄漏</li>
                            <li>修复主题切换导致的 CPU 100% 问题</li>
                            <li>TTS 语音进一步优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.33',
                    date: '2026-05-13',
                    content: `
                        <h4>雅思词汇重构与代码清理</h4>
                        <ul>
                            <li>布局重构为简洁单词卡片样式</li>
                            <li>TTS 语音优化，自动选择最自然英语发音</li>
                            <li>新增错误计数追踪和准确率进度条</li>
                            <li>新增重新学习/查看答案切换功能</li>
                            <li>移除 toggleAIChat 函数和 AI 欢迎消息</li>
                            <li>移除 Taylor Swift 画廊初始化</li>
                            <li>修复 Git 合并冲突</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.32',
                    date: '2026-05-12',
                    content: `
                        <h4>雅思词汇升级</h4>
                        <ul>
                            <li>完整雅思词库升级，学术分类</li>
                            <li>新增 3000+ 核心雅思词汇</li>
                            <li>从 abandon 到 yield，完整 A-Z 覆盖</li>
                            <li>每个单词含标准音标、英文例句和中文翻译</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.31',
                    date: '2026-05-12',
                    content: `
                        <h4>Taylor Swift 与 Jennie 替换为雅思词汇</h4>
                        <ul>
                            <li>删除原 idol/ts 前缀全部样式</li>
                            <li>新增完整雅思词汇学习系统样式</li>
                            <li>200 核心雅思词汇含音标、释义和例句</li>
                            <li>双模式学习：英译中/中译英</li>
                            <li>完整暗色/亮色主题支持</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.30',
                    date: '2026-05-03 16:00',
                    content: `
                        <h4>Taylor Swift 功能完全移除</h4>
                        <ul>
                            <li>删除全部 .ts- 前缀 CSS 样式</li>
                            <li>新增 .idol- 命名空间样式替代</li>
                            <li>引入 Google Fonts Great Vibes 手写字体</li>
                            <li>相册卡片悬停缩放和毛玻璃效果</li>
                            <li>SVG 装饰元素视觉增强</li>
                            <li>移除 Taylor Swift JavaScript 代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.29',
                    date: '2026-05-03 15:30',
                    content: `
                        <h4>Taylor Swift 页面交互升级</h4>
                        <ul>
                            <li>SVG 装饰元素悬停动画</li>
                            <li>12 张专辑卡片悬停预览效果</li>
                            <li>每张专辑支持点击进入详情页</li>
                            <li>专辑详情含封面、时代照片、专辑故事、曲目列表</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.28',
                    date: '2026-05-03 15:00',
                    content: `
                        <h4>Taylor Swift 12 专辑展示</h4>
                        <ul>
                            <li>Taylor Swift 页面重构为 12 专辑展示</li>
                            <li>新增 evermore、Midnights、The Tortured Poets Department 等</li>
                            <li>专辑卡片真实封面、海报式布局、渐入暂停过渡</li>
                            <li>渐变背景和精致悬停效果</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.27',
                    date: '2026-05-03 14:00',
                    content: `
                        <h4>AI 聊天替换为 Taylor Swift</h4>
                        <ul>
                            <li>DeepSeek AI 替换为 Taylor Swift 主题界面</li>
                            <li>添加 Taylor Swift SVG 装饰元素</li>
                            <li>8 张专辑卡片从 Debut 到 folklore</li>
                            <li>渐变背景和专辑专属图标</li>
                            <li>修复已知崩溃和页面白屏问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>iOS Safari 兼容性修复</h4>
                        <ul>
                            <li>修复 iOS Safari 兼容性问题</li>
                            <li>修复灵动岛/刘海区域视觉适配</li>
                            <li>修复登录时间不更新问题</li>
                            <li>优化 iOS Safari 滚动性能</li>
                            <li>修复 iOS 上 Toast 通知显示</li>
                            <li>修复多项 UI 显示问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>版本号显示更新</h4>
                        <ul>
                            <li>更新版本号显示在版本更新日志系统中</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>头像与固定定位修复</h4>
                        <ul>
                            <li>修复头像 URL 处理，添加 actor_key=__avatar__ 回退</li>
                            <li>修复某些场景下 position:fixed 渲染问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>数据查询与性能优化</h4>
                        <ul>
                            <li>修复 JSON 内容解析的数据获取错误</li>
                            <li>数据查询优化：limit(1) + maybeSingle 模式</li>
                            <li>Fetch 限制从 1000 降至 20 提升性能</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>头像与触摸交互修复</h4>
                        <ul>
                            <li>修复 loadAvatarsForUsers 函数头像加载问题</li>
                            <li>修复 touch-action 交互问题</li>
                            <li>修复 html/body overflow:hidden 滚动锁定</li>
                            <li>修复多项 UI 和交互问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>头像与导航修复</h4>
                        <ul>
                            <li>修复头像自动回退问题（localStorage 优先，DB 不再覆盖）</li>
                            <li>优化导航栏交互</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>管理面板与聊天修复</h4>
                        <ul>
                            <li>修复管理面板数据获取错误</li>
                            <li>聊天列表背景预加载，实现即时打开</li>
                            <li>移除帖子列表右侧滚动条</li>
                            <li>修复交互状态一致性问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.19',
                    date: '2026-05-03 09:10',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.18',
                    date: '2026-05-03 08:30',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.17',
                    date: '2026-05-02 17:00',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.16',
                    date: '2026-05-02 16:53',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.15',
                    date: '2026-05-02 16:30',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.14',
                    date: '2026-05-02 16:20',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.13',
                    date: '2026-05-02 14:58',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.12',
                    date: '2026-05-02 01:00',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.11',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.10',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.9',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.8',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.7',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.5',
                    date: '2026-04-30',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.4',
                    date: '2026-04-29',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.3',
                    date: '2026-04-28',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
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
                            <div class="changelog-version">版本 ${item.version}</div>
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
            // 缂佹垵鐣鹃敓鍙紮鎷锋禍瀣╂
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 娣囶喗鏁奸崢鐔告箒锟?showAnnouncementList 浠ユ敮鎸佸綋鍓嶆爣绛剧姸??
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

        (function installUiTextRepair() {
            // This repair system is superseded by features.js which handles mojibake more accurately.
            // Only expose stop/repair hooks for backward compatibility.
            window.__xtjUiTextRepair = function(node) {};
            window.__xtjUiTextRepairStop = function() {};
            return;
        })();

        // === Self-diagnostic: verify key functions are available after page load ===
        (function() {
            function check() {
                var funcs = ['togglePostPin', 'openEditPost', 'saveEditPost', 'safeJsStr', 'escapeHtml'];
                var missing = [];
                funcs.forEach(function(f) {
                    if (typeof window[f] !== 'function') missing.push(f);
                });
                if (missing.length) {
                    console.error('[XTJ] Missing functions:', missing.join(', '));
                } else {
                    console.log('[XTJ] All key functions loaded OK');
                }
            }
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                check();
            } else {
                document.addEventListener('DOMContentLoaded', check);
            }
        })();

        (function installMagicLoaderV4() {
            if (window.__xtjMagicLoaderV4Installed) return;
            window.__xtjMagicLoaderV4Installed = true;

            var springLoaderHtml = '<div class="xtj-magic-loading" role="status" aria-live="polite"><div class="spring-loader" aria-label="春日藤蔓蝴蝶加载动画"><canvas class="spring-canvas" width="220" height="220" aria-hidden="true"></canvas></div></div>';
            var photoWallLoaderHtml = [
                '<div class="xtj-magic-loading xtj-magic-loading--photo" role="status" aria-live="polite">',
                '  <div class="xtj-photo-loader" aria-label="照片墙加载动画">',
                '    <span class="xtj-photo-loader-ring"></span>',
                '    <span class="xtj-photo-loader-ring xtj-photo-loader-ring--inner"></span>',
                '    <span class="xtj-photo-loader-core"></span>',
                '    <span class="xtj-photo-loader-dot dot-a"></span>',
                '    <span class="xtj-photo-loader-dot dot-b"></span>',
                '    <span class="xtj-photo-loader-dot dot-c"></span>',
                '  </div>',
                '</div>'
            ].join('');

            window.xtjMagicLoadingHtml = function(title, subtitle, variant) {
                var mode = String(variant || '');
                if (mode === 'chat-list' || mode === 'chat-detail') {
                    return photoWallLoaderHtml;
                }
                return springLoaderHtml;
            };
            window.xtjInitSpringUltLoaders = function(root) {
                if (window.initAllSpringLoaders) {
                    window.initAllSpringLoaders(root || document);
                }
            };

            // Disabled on purpose: this global loader patch was replacing live content areas
            // after render, which could cause feed/chat content loss and persistent jank.
            if (false && typeof loadFeed === 'function' && !loadFeed.__xtjMagicLoaderV4) {
                var orig = loadFeed;
                loadFeed = window.loadFeed = function(forceRefresh) {
                    var r = orig.apply(this, arguments);
                    var feed = document.getElementById('feed');
                    if (feed && /loading-spinner|loading-text|鍐呭加载涓?../.test(feed.innerHTML || '')) {
                        feed.innerHTML = magicHtml();
                        if (window.initAllSpringLoaders) {
                            window.initAllSpringLoaders(feed);
                        }
                    }
                    return r;
                };
                loadFeed.__xtjMagicLoaderV4 = true;
            }

            if (false && typeof openChat === 'function' && !openChat.__xtjMagicLoaderV4) {
                var origChat = openChat;
                openChat = window.openChat = function(userName) {
                    var r = origChat.apply(this, arguments);
                    var el = document.getElementById('dockChatMessages');
                    if (el && (el.querySelector('.chat-empty') || /加载涓?../.test(el.textContent || ''))) {
                        renderChatLoadingState(el, { title: '加载中..', variant: 'chat-detail' });
                    }
                    return r;
                };
                openChat.__xtjMagicLoaderV4 = true;
            }

            if (false && typeof openPostDetail === 'function' && !openPostDetail.__xtjMagicLoaderV4) {
                var origPd = openPostDetail;
                openPostDetail = window.openPostDetail = function(postId) {
                    var r = origPd.apply(this, arguments);
                    var body = document.getElementById('postDetailBody');
                    if (body && /loading-spinner|loading-text|加载涓?../.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml();
                        if (window.initAllSpringLoaders) {
                            window.initAllSpringLoaders(body);
                        }
                    }
                    return r;
                };
                openPostDetail.__xtjMagicLoaderV4 = true;
            }

            if (false && typeof openStatDetail === 'function' && !openStatDetail.__xtjMagicLoaderV4) {
                var origSd = openStatDetail;
                openStatDetail = window.openStatDetail = function(type) {
                    var r = origSd.apply(this, arguments);
                    var body = document.getElementById('statModalBody');
                    if (body && /loading-spinner|loading-text|加载涓?../.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml();
                        if (window.initAllSpringLoaders) {
                            window.initAllSpringLoaders(body);
                        }
                    }
                    return r;
                };
                openStatDetail.__xtjMagicLoaderV4 = true;
            }

            function patchNode(root) {
                // Keep explicit loaders, but do not rewrite arbitrary nodes into spring loaders.
                return;
                root = root || document;
                if (!root.querySelectorAll) return;
                root.querySelectorAll('.xtj-magic-loading, .xtj-chat-loader, #feed .loading, #statModalBody .loading, #postDetailBody .loading, #dockChatMessages .chat-empty, #dockChatList .chat-empty, #postUserQuickList .post-user-chip--loading').forEach(function(node) {
                    if (!node) return;
                    if (node.querySelector('.spring-loader')) return;
                    node.outerHTML = springLoaderHtml;
                });
                if (window.initAllSpringLoaders) {
                    window.initAllSpringLoaders(root === document ? document : (root.parentNode || root));
                }
            }

            patchNode(document);

            if (window.initAllSpringLoaders) {
                window.initAllSpringLoaders(document);
            }
        })();

        (function installCleanStatUiOverrides() {
            if (window.__xtjStatUiOverridesV1) return;
            window.__xtjStatUiOverridesV1 = true;

            function buildPostDetailMediaAttrs(post) {
                var normalizedPost = normalizePost(post);
                return [
                    'data-post-id="' + escapeHtml(String(post.id || "")) + '"',
                    'data-media-url="' + escapeHtml(String(post.media_url || "")) + '"',
                    'data-post-user="' + escapeHtml(String(post.user_name || "")) + '"',
                    'data-post-created-at="' + escapeHtml(String(post.created_at || "")) + '"',
                    'data-post-views="' + escapeHtml(String(post.views || 0)) + '"',
                    'data-file-size="' + escapeHtml(String((normalizedPost._contentMeta && normalizedPost._contentMeta.fileSize) || "")) + '"',
                    'data-original-size="' + escapeHtml(String((normalizedPost._contentMeta && normalizedPost._contentMeta.originalSize) || "")) + '"'
                ].join(" ");
            }

            function statPostDetailMarkup(post, likes, comments) {
                var normalizedPost = normalizePost(post);
                var vc = Math.max(Number(normalizedPost.views) || 0, (post && post.views) || 0);
                var detailMediaAttrs = buildPostDetailMediaAttrs(normalizedPost);
                var mediaHtml = normalizedPost.media_url ? (
                    normalizedPost.media_type === 'video'
                        ? '<video src="' + escapeHtml(normalizedPost.media_url) + '" controls preload="metadata" playsinline></video>'
                        : '<img ' + detailMediaAttrs + ' src="' + escapeHtml(normalizedPost.media_url) + '" onclick="openImageViewer(\'' + safeJsStr(normalizedPost.media_url) + '\')" loading="lazy" />'
                ) : '';
                var visibilityLabel = normalizedPost.visibility === 'private' ? '私密' : '公开';
                var detailActions = [];
                if (canEditPost(normalizedPost)) {
                    detailActions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + String(normalizedPost.id).replace(/'/g, "\\'") + '\')">编辑</button>');
                }
                if (canDeletePost(normalizedPost)) {
                    detailActions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + String(normalizedPost.id).replace(/'/g, "\\'") + '\', \'' + String(normalizedPost.actor_key || "").replace(/'/g, "\\'") + '\')">删除</button>');
                }
                return [
                    '<article class="post-detail-shell">',
                    '  <header class="post-detail-top">',
                    '    <div class="post-detail-owner">',
                    '      <div class="post-detail-avatar">' + escapeHtml(String(normalizedPost.user_name || '?').slice(0, 1).toUpperCase()) + '</div>',
                    '      <div class="post-detail-owner-copy">',
                    '        <div class="pdh-name">' + escapeHtml(normalizedPost.user_name || '未知用户') + '</div>',
                    '        <div class="pdh-time">' + new Date(normalizedPost.created_at).toLocaleString() + '</div>',
                    '      </div>',
                    '    </div>',
                    '    <div class="pdh-badges"><span class="post-detail-visibility">' + visibilityLabel + '</span></div>',
                    '  </header>',
                    mediaHtml ? '<div class="post-detail-media-card"><div class="post-detail-media">' + mediaHtml + '</div></div>' : '',
                    normalizedPost.content ? '<div class="post-detail-content">' + escapeHtml(normalizedPost.content) + '</div>' : '',
                    '<div class="post-detail-stats">' + buildPostStatsLine(normalizedPost, (likes || []).length, (comments || []).length) + '</div>',
                    detailActions.length ? '<div class="post-detail-actions">' + detailActions.join("") + '</div>' : '',
                    '  <div class="post-detail-lists">',
                    '    <section class="post-detail-panel">',
                    '      <div class="post-detail-panel-title">点赞用户 <span>' + likes.length + '</span></div>',
                    likes.length ? likes.map(function(l) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(l.user_name) + '</div><div class="post-detail-mini-copy">留下了喜欢</div></div><span class="post-detail-mini-time">' + new Date(l.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无点赞</div>',
                    '    </section>',
                    '    <section class="post-detail-panel">',
                    '      <div class="post-detail-panel-title">评论记录 <span>' + comments.length + '</span></div>',
                    comments.length ? comments.map(function(c) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(c.user_name) + '</div><div class="post-detail-mini-copy">' + escapeHtml(c.content || '无评论内容') + '</div></div><span class="post-detail-mini-time">' + new Date(c.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无评论</div>',
                    '    </section>',
                    '  </div>',
                    '</article>'
                ].join('');
            }

            renderPostDetail = function(post, likes, comments) {
                var body = document.getElementById('postDetailBody');
                if (!body) return;
                body.innerHTML = statPostDetailMarkup(post, likes, comments);
            };

            function formatStatTime(value) {
                try {
                    return new Date(value).toLocaleString();
                } catch (e) {
                    return '';
                }
            }

            function summarizeStatPost(post, limit) {
                post = post || {};
                var max = limit || 40;
                var text = String(post.content || '').trim();
                if (text) return text.length > max ? text.slice(0, max) + '...' : text;
                if (post.media_type === 'image') return '图片动态';
                if (post.media_type === 'video') return '视频动态';
                return '无文字内容';
            }

            function statMetricMarkup(label, value) {
                return [
                    '<div class="stat-metric">',
                    '<span class="stat-metric-value">' + escapeHtml(String(value)) + '</span>',
                    '<span class="stat-metric-label">' + escapeHtml(String(label)) + '</span>',
                    '</div>'
                ].join('');
            }

            function statHeroMarkup(opts) {
                opts = opts || {};
                var metrics = Array.isArray(opts.metrics) ? opts.metrics : [];
                return [
                    '<section class="stat-hero stat-hero--' + escapeHtml(opts.tone || 'posts') + '">',
                    opts.kicker ? '<div class="stat-hero-kicker">' + escapeHtml(opts.kicker) + '</div>' : '',
                    '<div class="stat-hero-title">' + escapeHtml(opts.title || '') + '</div>',
                    opts.copy ? '<div class="stat-hero-copy">' + escapeHtml(opts.copy) + '</div>' : '',
                    metrics.length ? '<div class="stat-hero-metrics">' + metrics.map(function(metric) { return statMetricMarkup(metric.label, metric.value); }).join('') + '</div>' : '',
                    '</section>'
                ].join('');
            }

            function statEmptyMarkup(opts) {
                opts = opts || {};
                return [
                    '<div class="stat-empty-rich stat-surface-card">',
                    opts.kicker ? '<div class="stat-hero-kicker">' + escapeHtml(opts.kicker) + '</div>' : '',
                    '<div class="stat-empty-title">' + escapeHtml(opts.title || '暂无数据') + '</div>',
                    opts.copy ? '<div class="stat-empty-copy">' + escapeHtml(opts.copy) + '</div>' : '',
                    opts.note ? '<div class="stat-empty-note">' + escapeHtml(opts.note) + '</div>' : '',
                    '</div>'
                ].join('');
            }

            function statGetPostMap() {
                var postMap = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (post && post.id != null) postMap[String(post.id)] = normalizePost(post);
                });
                (Array.isArray(feedAllPosts) ? feedAllPosts : []).forEach(function(post) {
                    if (post && post.id != null && !postMap[String(post.id)]) {
                        postMap[String(post.id)] = normalizePost(post);
                    }
                });
                return postMap;
            }

            function statGetPost(postId) {
                return statGetPostMap()[String(postId)] || null;
            }

            function ensureStatRecordsModal() {
                var modal = document.getElementById('statRecordsModal');
                if (modal) return modal;
                modal = document.createElement('div');
                modal.id = 'statRecordsModal';
                modal.className = 'modal-overlay stat-records-overlay';
                modal.innerHTML = [
                    '<div class="modal-box glass stat-records-modal" onclick="event.stopPropagation()">',
                    '  <div class="profile-activity-modal-head stat-records-head">',
                    '    <div>',
                    '      <div class="profile-activity-kicker" id="statRecordsModalKicker">互动记录</div>',
                    '      <h3 id="statRecordsModalTitle">更多记录</h3>',
                    '    </div>',
                    '    <button class="btn btn-ghost stat-close-btn" type="button" onclick="closeStatRecordsModal()" aria-label="关闭记录">✕</button>',
                    '  </div>',
                    '  <div class="profile-activity-list profile-activity-modal-list stat-records-list" id="statRecordsModalList"></div>',
                    '</div>'
                ].join('');
                modal.addEventListener('click', function(event) {
                    if (event.target === modal) window.closeStatRecordsModal();
                });
                document.body.appendChild(modal);
                return modal;
            }

            window.closeStatRecordsModal = function() {
                var modal = document.getElementById('statRecordsModal');
                if (modal) modal.classList.remove('active');
            };

            function statPostSummary(post, mode) {
                var normalized = normalizePost(post || {});
                var text = String(normalized.content || '').trim();
                if (text) return text.length > 28 ? text.slice(0, 28) + '...' : text;
                if (normalized.media_type === 'video') return mode === 'plain' ? '视频动态' : '（视频）';
                if (normalized.media_type === 'image') return mode === 'plain' ? '图片动态' : '（图片）';
                return mode === 'plain' ? '无文字内容' : '（无文字内容）';
            }

            function statMediaThumbMarkup(post, className, onclick, title) {
                var normalized = normalizePost(post || {});
                if (!normalized.media_url) return '';
                var thumbClass = className || 'stat-record-thumb';
                var clickAttr = onclick ? ' onclick="' + onclick + '"' : '';
                var titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
                if (normalized.media_type === 'image') {
                    return '<img class="' + thumbClass + '" src="' + escapeHtml(normalized.media_url) + '" alt="" loading="lazy"' + clickAttr + titleAttr + ' />';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="' + thumbClass + ' ' + thumbClass + '--video"' + clickAttr + titleAttr + '>视频</div>';
                }
                return '';
            }

            window.openStatPostDetail = function(postId) {
                if (!postId) return;
                window.closeStatRecordsModal();
                window.openPostDetail(postId);
            };

            window.openStatPostMedia = function(postId) {
                if (!postId) return;
                window.closeStatRecordsModal();
                var post = statGetPost(postId);
                if (!post) {
                    window.openPostDetail(postId);
                    return;
                }
                if (post.media_type === 'image' && post.media_url && typeof window.openImageViewer === 'function') {
                    window.openImageViewer(post.media_url);
                    return;
                }
                window.openPostDetail(post.id);
                if (post.media_type === 'video') {
                    setTimeout(function() {
                        try {
                            var video = document.querySelector('#postDetailBody .post-detail-media video');
                            if (video && typeof video.play === 'function') video.play().catch(function() {});
                        } catch (_) {}
                    }, 220);
                }
            };

            function statPostItemMarkup(post) {
                var normalized = normalizePost(post || {});
                var tag = normalized.media_type === 'image'
                    ? '<span class="spi-img-tag">图片</span>'
                    : (normalized.media_type === 'video'
                        ? '<span class="spi-img-tag">视频</span>'
                        : '<span class="spi-img-tag spi-img-tag--text">文字</span>');
                var display = String(normalized.content || '').trim();
                if (display.length > 36) display = display.slice(0, 36) + '...';
                var detailOnclick = "openStatPostDetail('" + safeJsStr(String(normalized.id)) + "')";
                var mediaOnclick = "openStatPostMedia('" + safeJsStr(String(normalized.id)) + "')";
                var mediaHtml = statMediaThumbMarkup(normalized, 'spi-thumb', mediaOnclick, normalized.media_type === 'video' ? '点击查看视频' : '点击全屏预览');
                var delay = Math.min((Number(normalized._statIndex) || 0) * 26, 220);
                return [
                    '<article class="stat-post-item" style="--xtj-enter-delay:' + delay + 'ms;">',
                    mediaHtml,
                    '<div class="spi-main">',
                    '<div class="spi-content-row">',
                    display ? '<span class="spi-content" onclick="' + detailOnclick + '" title="点击查看帖子详情">' + escapeHtml(display) + '</span>' : '',
                    tag,
                    '</div>',
                    '<div class="spi-bottom"><span class="spi-time">' + new Date(normalized.created_at).toLocaleString() + '</span><button type="button" class="spi-open-btn" onclick="' + detailOnclick + '">查看详情</button></div>',
                    '</div>',
                    '</article>'
                ].join('');
            }

            renderPostStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userMap = {};
                statAllPosts.forEach(function(p) {
                    if (!userMap[p.user_name]) userMap[p.user_name] = [];
                    userMap[p.user_name].push(p);
                });
                var entries = Object.entries(userMap).sort(function(a, b) {
                    return b[1].length - a[1].length;
                });
                if (!entries.length) {
                    body.innerHTML = statEmptyMarkup({
                        kicker: 'POSTS',
                        title: '暂无动态数据',
                        copy: '等有新的帖子之后，这里会先按用户分组整理，再进入对应用户的历史记录。'
                    });
                    return;
                }
                body.innerHTML = entries.map(function(entry, index) {
                    var name = entry[0];
                    var posts = sortPosts(entry[1] || []);
                    var latest = posts[0] ? new Date(posts[0].created_at).toLocaleString() : '--';
                    var nameJs = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    var previewMedia = posts.filter(function(post) {
                        return !!(post && post.media_url);
                    }).slice(0, 3).map(function(post) {
                        var thumbOnclick = "loadUserAllPosts('" + nameJs + "')";
                        return statMediaThumbMarkup(post, 'stat-user-preview-thumb', thumbOnclick, '查看该用户的全部动态');
                    }).join('');
                    if (posts.filter(function(post) { return !!(post && post.media_url); }).length > 3) {
                        previewMedia += '<div class="stat-user-preview-more">+' + (posts.filter(function(post) { return !!(post && post.media_url); }).length - 3) + '</div>';
                    }
                    return [
                        '<section class="stat-user-group" style="--xtj-enter-delay:' + Math.min(index * 42, 240) + 'ms;">',
                        '<button type="button" class="stat-user-summary" onclick="loadUserAllPosts(\'' + nameJs + '\')">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(name).slice(0, 1).toUpperCase() + '</div><div class="suh-copy"><span class="suh-name">' + escapeHtml(name) + '</span><span class="suh-sub">最近更新 ' + escapeHtml(latest) + '</span></div></div><span class="suh-count">' + posts.length + ' 条</span></div>',
                        previewMedia ? '<div class="stat-user-preview">' + previewMedia + '</div>' : '',
                        '<div class="stat-user-cta"><span class="stat-user-note">' + escapeHtml(statPostSummary(posts[0], 'plain')) + '</span><span class="stat-user-link">查看记录</span></div>',
                        '</button>',
                        '</section>'
                    ].join('');
                }).join('');
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = sortPosts(statAllPosts.filter(function(p) { return p.user_name === userName; }));
                body.innerHTML = [
                    '<button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">返回总动态</button>',
                    '<div class="stat-inline-title">' + escapeHtml(userName) + ' 的历史记录 · ' + userPosts.length + ' 条</div>',
                    '<div class="stat-stack">' + userPosts.map(function(p, index) {
                        return statPostItemMarkup(Object.assign({}, p, { _statIndex: index }));
                    }).join('') + '</div>'
                ].join('');
            };

            function buildStatRecordEntry(kind, item, post, index) {
                var isLike = kind === 'likes';
                var safePostId = post && post.id != null ? safeJsStr(String(post.id)) : '';
                var detailOnclick = post ? "openStatPostDetail('" + safePostId + "')" : '';
                var mediaOnclick = post ? "event.stopPropagation();openStatPostMedia('" + safePostId + "')" : '';
                var mediaHtml = post ? statMediaThumbMarkup(post, 'stat-record-thumb', mediaOnclick, post.media_type === 'video' ? '点击查看视频' : '点击全屏预览') : '';
                var actorName = escapeHtml(item.user_name || '匿名用户');
                var timeText = new Date(item.created_at).toLocaleString();
                var summary = post ? statPostSummary(post, 'bracket') : '（帖子已删除）';
                var cardAttrs = post
                    ? ' role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}"'
                    : '';
                var noteHtml = '';
                if (!isLike && item.content) {
                    noteHtml = '<div class="stat-record-note">我的评论：' + escapeHtml(item.content) + '</div>';
                } else if (isLike && post && post.content) {
                    noteHtml = '<div class="stat-record-note">' + escapeHtml(String(post.content).trim().slice(0, 36)) + '</div>';
                }
                return [
                    '<article class="stat-record-entry ' + (isLike ? 'stat-like-item' : 'stat-comment-item') + '"' + cardAttrs + ' style="--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;">',
                    '  <div class="stat-record-shell">',
                    '    <div class="stat-record-main">',
                    '      <div class="stat-record-head"><div class="' + (isLike ? 'sli-user' : 'sci-user') + '">' + actorName + '</div><span class="' + (isLike ? 'sli-time' : 'sci-time') + '">' + timeText + '</span></div>',
                    '      <div class="stat-record-inline"><span class="stat-record-inline-title">' + actorName + (isLike ? ' 点赞了：' : ' 评论了：') + '</span>' + (mediaHtml ? '<span class="stat-record-inline-media">' + mediaHtml + '</span>' : '') + '</div>',
                    '      <div class="' + (isLike ? 'sli-target' : 'sci-target') + '">' + escapeHtml(summary) + noteHtml + '</div>',
                    '      <div class="stat-record-actions">' + (post ? '<button type="button" class="stat-record-action" onclick="event.stopPropagation();' + detailOnclick + '">查看帖子详情</button>' : '') + '</div>',
                    '    </div>',
                    '  </div>',
                    '</article>'
                ].join('');
            }

            window.openStatRecordsModal = function(kind) {
                var modal = ensureStatRecordsModal();
                var titleEl = document.getElementById('statRecordsModalTitle');
                var kickerEl = document.getElementById('statRecordsModalKicker');
                var listEl = document.getElementById('statRecordsModalList');
                if (!modal || !titleEl || !kickerEl || !listEl) return;
                var postMap = statGetPostMap();
                var isLike = kind === 'likes';
                var items = isLike ? (statAllLikes || []).slice() : (statAllComments || []).slice().reverse();
                titleEl.textContent = isLike ? '更多点赞记录' : '更多评论记录';
                kickerEl.textContent = isLike ? '点赞记录' : '评论记录';
                listEl.innerHTML = items.length
                    ? items.map(function(item, index) {
                        return buildStatRecordEntry(kind, item, postMap[String(item.post_id)] || null, index);
                    }).join('')
                    : '<div class="profile-activity-empty">' + (isLike ? '暂无点赞记录' : '暂无评论记录') + '</div>';
                modal.classList.add('active');
            };

            renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = getViewHistory();
                var postMap = statGetPostMap();
                if (!history.length) {
                    body.innerHTML = statEmptyMarkup({
                        kicker: 'VIEWS',
                        title: '暂无浏览记录',
                        copy: '浏览帖子后，这里会自动累计每一条访问历史。'
                    });
                    return;
                }
                body.innerHTML = history.map(function(v, index) {
                    var post = postMap[String(v.post_id)] || null;
                    var detailOnclick = post ? "openStatPostDetail('" + safeJsStr(String(post.id)) + "')" : '';
                    var mediaOnclick = post ? "openStatPostMedia('" + safeJsStr(String(post.id)) + "')" : '';
                    var mediaHtml = post ? statMediaThumbMarkup(post, 'stat-record-thumb', mediaOnclick, post.media_type === 'video' ? '点击查看视频' : '点击全屏预览') : '';
                    var postText = post ? statPostSummary(post, 'bracket') : (v.post_content || '（内容已不可用）');
                    return [
                        '<article class="stat-view-item" style="--xtj-enter-delay:' + Math.min(index * 32, 220) + 'ms;">',
                        '<div class="stat-view-layout">',
                        mediaHtml,
                        '<div class="svi-info">',
                        '<div class="stat-record-head"><div class="svi-user">' + escapeHtml(v.user_name) + '</div><span class="svi-time">' + new Date(v.viewed_at).toLocaleString() + '</span></div>',
                        '<div class="svi-target">浏览了 <b>' + escapeHtml(v.post_author) + '</b> 的帖子：' + escapeHtml(v.post_content || postText) + '</div>',
                        post ? '<button type="button" class="stat-record-action" onclick="' + detailOnclick + '">查看帖子详情</button>' : '',
                        '</div>',
                        '</div>',
                        '</article>'
                    ].join('');
                }).join('');
            };

            renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var postMap = statGetPostMap();

                function buildLikesCol() {
                    var h = '<div class="stat-col-kicker">点赞记录<span class="stat-col-kicker-count">' + statAllLikes.length + '</span></div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 5).map(function(l, index) {
                            return buildStatRecordEntry('likes', l, postMap[String(l.post_id)] || null, index);
                        }).join('');
                        if (statAllLikes.length > 5) {
                            h += '<button type="button" class="stat-record-more-btn" onclick="openStatRecordsModal(\'likes\')">更多点赞记录</button>';
                        }
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    var h = '<div class="stat-col-kicker">评论记录<span class="stat-col-kicker-count">' + statAllComments.length + '</span></div>';
                    if (statAllComments.length) {
                        h += statAllComments.slice().reverse().slice(0, 5).map(function(c, index) {
                            return buildStatRecordEntry('comments', c, postMap[String(c.post_id)] || null, index);
                        }).join('');
                        if (statAllComments.length > 5) {
                            h += '<button type="button" class="stat-record-more-btn" onclick="openStatRecordsModal(\'comments\')">更多评论记录</button>';
                        }
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
                    }
                    return h;
                }

                body.innerHTML = '<div class="stat-two-col stat-two-col--flat"><div class="stat-col stat-col--flat">' + buildLikesCol() + '</div><div class="stat-col stat-col--flat">' + buildCommentsCol() + '</div></div>';
            };

            window.openPostDetail = async function(postId) {
                var title = document.getElementById('postDetailTitle');
                var body = document.getElementById('postDetailBody');
                var modal = document.getElementById('postDetailModal');
                if (title) title.textContent = '帖子详情';
                if (body) body.innerHTML = window.xtjMagicLoadingHtml('加载中..', '加载中..', 'feed');
                if (modal) modal.classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);
                    const post = normalizePost(postRes.data);
                    if (!post) {
                        if (body) body.innerHTML = '<div class="stat-empty">帖子不存在或已删除</div>';
                        return;
                    }
                    if (!canViewPost(post)) {
                        if (body) body.innerHTML = '<div class="stat-empty">无权查看这条帖子</div>';
                        return;
                    }
                    trackView(postId);
                    renderPostDetail(post, likeRes.data || [], commRes.data || []);
                } catch (e) {
                    if (body) body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error(e);
                }
            };

            window.openStatDetail = async function(type) {
                statCurrentType = type;
                var titles = {
                    posts: '总动态 - 按用户分组',
                    views: '总浏览 - 浏览记录',
                    likes: '点赞和评论 - 记录'
                };
                var title = document.getElementById('statModalTitle');
                var body = document.getElementById('statModalBody');
                var modal = document.getElementById('statModal');
                if (title) title.textContent = titles[type] || '统计详情';
                if (modal) modal.classList.add('active');

                if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    prefetchStatData().then(function() {
                        if (modal && modal.classList.contains('active') && statCurrentType === type) {
                            renderStatByType(type);
                        }
                    });
                    return;
                }

                if (body) body.innerHTML = window.xtjMagicLoadingHtml('加载中..', '加载中..', 'feed');
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                        sb.from("comments").select("*").order("created_at"),
                        sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = normalizePosts(postRes.data || []).filter(function(p) {
                        return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__' && canViewPost(p);
                    });
                    var visiblePostIds = new Set(statAllPosts.map(function(p) { return String(p.id); }));
                    statAllComments = (commRes.data || []).filter(function(c) { return visiblePostIds.has(String(c.post_id)); });
                    statAllLikes = (likeRes.data || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                    statCacheTime = Date.now();
                    renderStatByType(type);
                } catch (e) {
                    if (body) body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error('stat error', e);
                }

                if (statPollTimer) clearInterval(statPollTimer);
                statPollTimer = setInterval(refreshStatModal, 15000);
            };
        })();

        (function installFinalUiAndDataOverrides() {
            if (window.__xtjFinalUiOverridesV1) return;
            window.__xtjFinalUiOverridesV1 = true;

            function sleep(ms) {
                return new Promise(function(resolve) { setTimeout(resolve, ms); });
            }

            function applyStatSnapshot(posts, comments, likes) {
                var visiblePosts = normalizePosts(Array.isArray(posts) ? posts : []).filter(function(p) {
                    return p && p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__photo_wall__' && canViewPost(p);
                });
                var visiblePostIds = new Set(visiblePosts.map(function(p) { return String(p.id); }));
                statAllPosts = visiblePosts;
                statAllComments = (Array.isArray(comments) ? comments : []).filter(function(c) {
                    return c && visiblePostIds.has(String(c.post_id));
                });
                statAllLikes = (Array.isArray(likes) ? likes : []).filter(function(l) {
                    return l && visiblePostIds.has(String(l.post_id));
                });
                statCacheTime = Date.now();
            }

            async function fetchStatSnapshotWithTimeout(timeoutMs) {
                var timeout = new Promise(function(resolve) {
                    setTimeout(function() { resolve(null); }, timeoutMs);
                });
                var request = Promise.all([
                    sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                    sb.from("comments").select("*").order("created_at"),
                    sb.from("likes").select("*").order("created_at", { ascending: false })
                ]).then(function(results) {
                    return {
                        posts: results[0].data || [],
                        comments: results[1].data || [],
                        likes: results[2].data || []
                    };
                }).catch(function() {
                    return null;
                });
                return Promise.race([request, timeout]);
            }

                        renderChatLoadingState = function(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                el.innerHTML = window.xtjMagicLoadingHtml(title, subtitle, variant);
                if (window.initAllSpringLoaders) {
                    window.initAllSpringLoaders(el);
                }
            };

            renderPostFilterUserLoader = function() {
                return '<div class="xtj-magic-loading" style="display:flex;align-items:center;justify-content:center;min-height:140px;padding:16px 0;">' +
                    '<div class="spring-loader" style="width:120px;height:120px;margin:0 auto;">' +
                    '<canvas class="spring-canvas" width="120" height="120" style="width:120px;height:120px;" aria-hidden="true"></canvas>' +
                    '</div></div>';
            };

            window.openStatDetail = async function(type) {
                statCurrentType = type;
                var titles = {
                    posts: '总动态 - 按用户分组',
                    views: '总浏览 - 浏览记录',
                    likes: '点赞和评论 - 记录'
                };
                var title = document.getElementById('statModalTitle');
                var body = document.getElementById('statModalBody');
                var modal = document.getElementById('statModal');
                if (title) title.textContent = titles[type] || '缁熻璇︽儏';
                if (modal) modal.classList.add('active');

                var sourcePosts = Array.isArray(feedAllPosts) && feedAllPosts.length ? feedAllPosts : statAllPosts;
                var sourceComments = Array.isArray(feedAllComments) && feedAllComments.length ? feedAllComments : statAllComments;
                var sourceLikes = Array.isArray(feedAllLikes) && feedAllLikes.length ? feedAllLikes : statAllLikes;

                if (sourcePosts.length || sourceComments.length || sourceLikes.length) {
                    applyStatSnapshot(sourcePosts, sourceComments, sourceLikes);
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    fetchStatSnapshotWithTimeout(4500).then(function(snapshot) {
                        if (!snapshot || !modal || !modal.classList.contains('active') || statCurrentType !== type) return;
                        applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                        renderStatByType(type);
                    });
                    return;
                }

                if (body) body.innerHTML = window.xtjMagicLoadingHtml('加载中..', '加载中..', 'feed');
                var snapshot = await fetchStatSnapshotWithTimeout(5000);
                if (snapshot) {
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                    renderStatByType(type);
                } else if (body) {
                    body.innerHTML = '<div class="stat-empty">暂无鍙敤数据</div>';
                }
                if (statPollTimer) clearInterval(statPollTimer);
                statPollTimer = setInterval(refreshStatModal, 15000);
            };
        })();

