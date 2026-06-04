// Spring loader CSS is now in style.css - old CSS removed
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
                    if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">鏈嶅姟鍔犺浇澶辫触锛岃鍒锋柊椤甸潰閲嶈瘯</div>';
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
                el.textContent = "鍏ㄩ儴甯栧瓙";
            } else if (!count) {
                el.textContent = "娌℃湁鎵惧埌鐩稿叧甯栧瓙";
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
            document.getElementById('ppConfirmTitle').textContent = title || '纭鎿嶄綔';
            document.getElementById('ppConfirmMsg').textContent = message || '纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵';
            document.getElementById('ppConfirmOkBtn').textContent = confirmText || '纭';
            window._confirmCallback = callback;
            if (overlay._closeTimer) {
                clearTimeout(overlay._closeTimer);
                overlay._closeTimer = null;
            }
            
            // FLIP Animation: Step 1 - First (锟斤拷录鎸夐挳浣嶇疆)
            var origin = window._confirmOrigin;
            
            // FLIP Animation: Step 2 - Last (璁剧疆鏈拷缁堢姸锟?
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

            // ===================== 瀵嗙爜閸濆牆?=====================
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

                    // 浼樺厛浠?__auth__ 璁板綍鑾峰彇娉ㄥ唽鏃堕棿閿涘牊娓舵潈濞侊拷??
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

                    // 灏濊瘯鎵惧埌锟筋澁鎷烽弬棰佺閺壜ゎ唶瑜版洖鑻烾PDATE锛堟瘮DELETE+INSERT闁哄洦娼欒ぐ鏌ユ閻欏懐绀夐梺顒€鐏濋崢顥窵S闁归攱甯炵划绋LETE闁?
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
                                console.log("saveUserInfo [鏇存柊] " + name + " 鐧诲綍鏃堕棿 (UPDATE): " + userInfo.last_login);
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
                            console.error("saveUserInfo insert濠㈡儼绮剧憴?", insertRes.error.message);
                        } else {
                            console.log("saveUserInfo [鎻掑叆] " + name + " 鐧诲綍鏃堕棿 (INSERT): " + userInfo.last_login);
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
                btn.textContent = "楠岃瘉涓?..";

                try {
                    if (name === ADMIN_NAME) {
                        if (pw !== "xxz123") {
                            showToast("瀵嗙爜閿欒");
                            btn.disabled = false; btn.textContent = "鐧诲綍";
                            return;
                        }
                    } else {
                        const authRec = await findAuthRecord(name);
                        if (!authRec) {
                            showToast("璐﹀彿涓嶅瓨鍦紝璇峰厛娉ㄥ唽");
                            btn.disabled = false; btn.textContent = "鐧诲綍";
                            return;
                        }
                        const inputHash = await hashPassword(pw);
                        if (inputHash !== authRec.media_url) {
                            showToast("瀵嗙爜閿欒");
                            btn.disabled = false; btn.textContent = "鐧诲綍";
                            return;
                        }
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("鐧诲綍鎴愬姛锛屾杩庡洖鏉ワ紒" + name);
                    closeModal('loginModal');
                    
                    // 鏇存柊闁哄牃鍋撻弶鈺傚灩濞呫儴銇愭洘锟筋槯闂?
                    await saveUserInfo(name, false);
                    
                    await initUI();
                    initialLoad(true);
                } catch (e) {
                    console.error(e);
                    showToast("鐧诲綍澶辫触锛岃閲嶈瘯");
                } finally {
                    btn.disabled = false;
                    btn.textContent = "鐧诲綍";
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
                btn.textContent = "娉ㄥ唽涓?..";

                try {
                    const existing = await findAuthRecord(name);
                    if (existing) {
                        showToast("昵称 '" + name + "' 已被注册，请换一个");
                        btn.disabled = false; btn.textContent = "注册失败";
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
                        showToast("娉ㄥ唽澶辫触: " + error.message);
                        btn.disabled = false; btn.textContent = "娉ㄥ唽澶辫触";
                        return;
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("娉ㄥ唽鎴愬姛锛屾杩庯紒" + name);
                    closeModal('registerModal');
                    
                    // 濞ｅ洦绻傞悺銊╂偨閵婏箑鐓曟繛澶堝妼閸炶姤绌遍鐟板⒉濞?
                    await saveUserInfo(name, true);
                    
                    await initUI();
                    initialLoad(true);
                } catch (e) {
                    console.error(e);
                    showToast("娉ㄥ唽澶辫触锛岃閲嶈瘯");
                } finally {
                    btn.disabled = false;
                    btn.textContent = "娉ㄥ唽";
                }
            }

            // ========== 鏌ョ湅鍏兼湹绮敤鎴疯祫鏂欏崱锟?==========
            let upcTargetUser = null;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細鍔犺浇涓?..';
                
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
                    avatarEl.innerHTML = '<img src="' + showAvatar + '" alt="澶村儚">';
                } else {
                    avatarEl.innerHTML = '<span id="upcAvatarText">' + userName[0].toUpperCase() + '</span>';
                }
                
                var msgBtn = document.getElementById('upcMsgBtn');
                if (userName === currentUser) {
                    msgBtn.textContent = '杩欐槸浣犺嚜宸?;
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else if (!currentUser) {
                    msgBtn.textContent = '璇峰厛鐧诲綍鍐嶅彂娑堟伅';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else {
                    msgBtn.textContent = '馃摡 鍙戞秷鎭?;
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 瀵倹鍔犺浇澶村儚閸滃瞼娅ヨぐ鏇熸??
                try {
                    // 褰撳墠鐢ㄦ埛浼樺厛浣跨敤localStorage闂佸搫顦崯顐﹀煝婢跺瞼澶勯悗?
                    if (userName === currentUser) {
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            if (cv[currentUser]) {
                                avatarCache[currentUser] = cv[currentUser];
                                if (document.getElementById('userProfileModal').classList.contains('active')) {
                                    avatarEl.innerHTML = '<img src="' + cv[currentUser] + '" alt="澶村儚">';
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
                        // 闈炲綋鍓嶇敤鎴锋墠鐢―B閸婂吋娲块弬鎵处鐎涙﹫绱欓敓鏂ゆ嫹鍓嶉敓鐭紮鎷峰鎻掓躬娑撳﹪娼伴悽鈺╫calStorage璁剧疆閿?
                        if (userName !== currentUser) {
                            avatarCache[userName] = avatarRes.data[0].media_url;
                        } else if (!avatarCache[currentUser]) {
                            avatarCache[currentUser] = avatarRes.data[0].media_url;
                        }
                        if (document.getElementById('userProfileModal').classList.contains('active')) {
                            var url = (userName === currentUser && avatarCache[currentUser]) ? avatarCache[currentUser] : avatarRes.data[0].media_url;
                            avatarEl.innerHTML = '<img src="' + url + '" alt="澶村儚">';
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

            // ========== 娑撴眽璧勬枡璇︽儏鍔熻兘 ==========
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
                    console.error("鑾峰彇鐢ㄦ埛淇℃伅澶辫触:", e);
                    document.getElementById('profileDetailRegTime').textContent = '-';
                }
                
                // 鍔犺浇澶村儚
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
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="澶村儚">';
                        return;
                    }
                } catch(e) {}
                
                // 鍏煎牏锟姐倝宕橀崨顓犳憼缂傛挸鐡ㄩ弰鍓э拷?
                if (avatarCache[currentUser]) {
                    avatarEl.innerHTML = '<img src="' + avatarCache[currentUser] + '" alt="澶村儚">';
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
                        avatarEl.innerHTML = '<img src="' + avatarRes.data[0].media_url + '" alt="澶村儚">';
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
                    console.error("鍔犺浇澶村儚澶辫触:", e);
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
                    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('鍥剧墖鍔犺浇澶辫触')); };
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
                    showToast('鍥剧墖澶у皬涓嶈兘瓒呰繃10MB');
                    return;
                }
                
                showToast('姝ｅ湪鍘嬬缉骞朵笂浼犲ご鍍?..');
                
                try {
                    // 濞寸姾顕ф慨?閿涙岸鍣搁弸鍕礋閿熻緝杈炬嫹锟?Supabase Storage 闁?avatars/ 闁烩晩鍠栫紞?
                    const timestamp = Date.now();
                    const random = Math.floor(Math.random() * 1000);
                    const path = `avatars/${timestamp}_${random}_${file.name}`;
                    
                    // 涓婁紶锟?Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 閼惧嘲锟?Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 鍒犻櫎閹碘偓閺堬拷顦ˇ鏉课涢顫粓闁稿秴绻楅鍥亹?
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
                        content: "鐢ㄦ埛澶村儚",
                        media_url: avatarUrl,
                        media_type: "__avatar__",
                        actor_key: "__avatar__"
                    }]);
                    
                    if (error) {
                        showToast('涓婁紶澶辫触: ' + error.message);
                        return;
                    }
                    
                    avatarCache[currentUser] = avatarUrl;
                    // 淇濆瓨鍒發ocalStorage鎸佷箙鍖栧瓨鍌?
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        cachedAvatars[currentUser] = avatarUrl;
                        localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
                    } catch(e) {}
                    updateAllAvatarElements(avatarUrl);
                    
                    showToast('澶村儚鏇存柊鎴愬姛');
                    localStorage.removeItem(CACHE_KEY);
                    await loadFeed(true);
                    avatarCache[currentUser] = avatarUrl;
                    updateAllAvatarElements(avatarUrl);
                } catch(e) {
                    console.error("涓婁紶澶村儚澶辫触:", e);
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
                    console.error("鏇存柊澶村儚鏄剧ず澶辫触:", e);
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
                showToast("宸查€€鍑虹櫥褰?);
                await initUI();
                initialLoad(true);
            };

            // 澶勭悊鎴戠殑椤甸潰锟矫伙拷鍗＄墖鐐癸拷??
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 鐎规瓕灏欙拷鈻嶉妷銊ｄ汗闁哄浂浜炵粣妤呭箥閹惧磭纾绘繛鎴炴尰閻晫鎸ч崟顒佺亹閻犲浄闄勯崕?
                    openProfileDetail();
                } else {
                    // 閺堫亞娅ヨぐ鏇窗閿熸触寮€纰夋嫹锟?娉ㄩ敓鏂ゆ嫹妞ょ敻锟?
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
                    profileStatus.textContent = "鏌ョ湅璧勬枡";
                    
                    // 鏄剧ず鍙戝竷閸栧搫锟?
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 鍔犺浇澶村儚
                    loadUserAvatar();
                    
                    // 閿熸枻鎷烽敓鏂ゆ嫹閺堚偓杩戠櫥褰曟椂闂达紙椤甸潰姣忥拷顐奸敓鏂ゆ嫹闁棄鍩涢弬甯礉韫囧懘銆廰wait纭繚鍐欏叆??
                    await saveUserInfo(currentUser, false);
                    
                    try { subscribeToMessages(); startDMPolling(); updateUnreadBadge(); loadAnnouncements(); subscribeToAnnouncements(); } catch(e) {}
                } else {
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    // 鏇存柊鎴戠殑椤甸潰鏄剧ず閿涘牊婀櫥褰曪拷??
                    profileName.textContent = "鏈櫥褰?;
                    profileStatus.textContent = "鐐瑰嚮鐧诲綍";
                    
                    // 闂呮劘妫屽彂甯冮崠鍝勭厵
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 闂佹彃绉堕悿鍡椼仈锟?
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
                    console.error("鍔犺浇澶村儚澶辫触:", e);
                }
            }

            // DEPRECATED_DO_NOT_EDIT ===================== [瀹告彃绨惧锟?娑撳鏌熼敓?361鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 =====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("璇峰厛鐧诲綍"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("璇疯緭鍏ュ笘瀛愬唴瀹?); return; }
                // 鏉堟挸鍙嗛弽锟犵崣閿涙岸妾洪崚鍫曟毐鎼达讣鎷烽敓钘夊箵闂勩倕宓勯梽鈺佸敶锟?
                if (content.length > 2000) { showToast("鍐呭涓嶈兘瓒呰繃2000瀛?); return; }
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
                    if (insertErr) { showToast("鍙戝竷澶辫触: " + (insertErr.message || "鏈煡閿欒")); btn.disabled = false; btn.textContent = "鍙戝竷鍔ㄦ€?; return; }
                    document.getElementById("postInp").value = "";
                    document.getElementById("fileInp").value = "";
                    showToast("鍙戝竷鎴愬姛锛?);
                    loadFeed(true);
                } catch (e) { showToast("鍙戝竷澶辫触: " + (e.message || "缃戠粶閿欒")); } finally { btn.disabled = false; btn.textContent = "鍙戝竷鍔ㄦ€?; }
            };

            // ===================== 鐐硅禐 =====================
            window.toggleLike = async function (btn, postId) {
                if (!currentUser) { showToast("璇峰厛鐧诲綍"); return; }
                const isLiked = btn.classList.contains("liked");
                const statsText = btn.closest('.post').querySelector('.post-stats-text');

                if (isLiked) {
                    btn.classList.remove("liked");
                } else {
                    btn.classList.add("liked");
                    createHeartParticles(btn);
                }
                btn.textContent = isLiked ? "鉂わ笍 宸茶禐" : "鉂わ笍 鐐硅禐";

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
                const emojis = ["鉂わ笍","馃挄","馃挅","馃","馃挆","馃挊"];
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
                if (!currentUser) { showToast("璇峰厛鐧诲綍"); return; }
                activePostId = postId;
                document.getElementById("commInp").value = "";
                document.getElementById("commentModal").classList.add("active");
                setTimeout(() => document.getElementById("commInp").focus(), 100);
            };
            document.getElementById("commBtn").onclick = async () => {
                const content = document.getElementById("commInp").value.trim();
                if (!content) { showToast("璇疯緭鍏ヨ瘎璁哄唴瀹?); return; }
                const btn = document.getElementById("commBtn");
                btn.textContent = "鎻愪氦涓?..";
                btn.disabled = true;
                try {
                    const { error } = await sb.from("comments").insert([{ post_id: activePostId, user_name: currentUser, content, actor_key: deviceId }]);
                    if (error) throw error;
                    closeModal("commentModal");
                    showToast("璇勮鎴愬姛锛?);
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

            // ===================== 鍒犻櫎閻㈩垱鐗曢悺?=====================
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
                        showToast("鍒犻櫎澶辫触: " + error.message);
                        return;
                    }
                    closeModal("delModal");
                    showToast("甯栧瓙宸插垹闄?);
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

            // ===================== 鍥剧墖锟姐儳婀咃拷?=====================
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
            // 閸忋劌锟斤拷甯栧瓙锟解剝浼呴敓鏂ゆ嫹閿熸枻鎷烽敍宀€鏁ゆ禍搴㈢セ鐟欏牐顔囬敓?
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';
            const VIEW_TRACK_TTL = 5 * 60 * 1000;
            const VIEW_HISTORY_MEDIA_LABEL = '(\u56fe\u7247/\u89c6\u9891)';
            const VIEW_HISTORY_DELETED_AUTHOR = '\u5df2\u5220\u9664\u7528\u6237';

            function normalizeViewHistoryText(value, fallback) {
                var text = String(value == null ? '' : value).trim();
                if (!text) return fallback;
                if (/閸ュ墽澧東鐟欏棝|闁搞儱澧芥晶|閻熸瑥妫濋。/.test(text)) return VIEW_HISTORY_MEDIA_LABEL;
                if (/闁哄牜浜為悡|瀹告彃鍨归梽銈?.test(text)) return VIEW_HISTORY_DELETED_AUTHOR;
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

            // ===================== 鍔犺浇閸斻劍??=====================
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
                                // 缂撳瓨鍔犺浇閿涘苯鎮撻弮璺哄灥婵瀵插垎椤电姸??
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
                if (!forceRefresh) feed.innerHTML = window.xtjMagicLoadingHtml('鍐呭鍔犺浇涓?..', '', 'feed');
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }).limit(500),
                        sb.from("comments").select("*").order("created_at").limit(2000),
                        sb.from("likes").select("*").limit(3000)
                    ]);
                    if (postRes.error || commRes.error || likeRes.error) {
                        const errMsg = (postRes.error || commRes.error || likeRes.error).message || '鏁版嵁鍔犺浇澶辫触';
                        feed.innerHTML = `<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触: ${errMsg}</div>`;
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
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触锛岃鍒锋柊閲嶈瘯</div>`;
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
                        noMore.textContent = '娌℃湁鏇村甯栧瓙';
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
                  <div class="post-stats-text">娴忚 ${p.views||0} | 鐐硅禐 ${pLikes.length} | 璇勮 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${safeJsStr(p.id)}')">${isLiked?'鉂わ笍':'鐐硅禐'}</button>
                    <button class="action-btn" onclick="openComment('${safeJsStr(p.id)}')">璇勮</button>
                    ${canPinPost(p)?`<button type="button" class="action-btn pin" data-post-id="${escapeHtml(p.id)}">${normalizePost(p).is_pinned ? '鍙栨秷缃《' : '缃《'}</button>`:''}
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${safeJsStr(p.id)}', '${safeJsStr(p.actor_key)}')">鍒犻櫎</button>`:''}
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
                
                // 鏇存柊缁熻
                updateFeedStats();
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?532鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;

                // 濉厖甯栧瓙淇℃伅缂撳瓨閿涘奔绶垫祻瑙堣褰曟担璺拷??
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

            // 缂撳瓨澶村儚URL

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
                    console.error("鍔犺浇澶村儚澶辫触:", e);
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
                  <div class="post-stats-text">娴忚 ${p.views||0} | 鐐硅禐 ${pLikes.length} | 璇勮 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${safeJsStr(p.id)}')">${isLiked?'鉂わ笍':'鐐硅禐'}</button>
                    <button class="action-btn" onclick="openComment('${safeJsStr(p.id)}')">璇勮</button>
                    ${canPinPost(p)?`<button type="button" class="action-btn pin" data-post-id="${escapeHtml(p.id)}">${normalizePost(p).is_pinned ? '鍙栨秷缃《' : '缃《'}</button>`:''}
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${safeJsStr(p.id)}', '${safeJsStr(p.actor_key)}')">鍒犻櫎</button>`:''}
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
                var nextContent = typeof updates.content === "string" ? updates.content : normalized.content;

                var newContent = buildPostStorageContent(normalized, nextContent, {
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
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
                    return { ok: false, error: new Error("鏇存柊澶辫触锛氭暟鎹簱娌℃湁瀹為檯淇敼浠讳綍琛岋紝鍙兘鏄?RLS 鏉冮檺闃绘") };
                }
                var verified = normalizePost(result.data);
                var verifiedMeta = parsePostContent(result.data).meta || {};
                if (String(verified.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("鏇存柊澶辫触锛歷isibility 瀛楁鏈疄闄呯敓鏁?) };
                }
                if (String(verifiedMeta.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("鏇存柊澶辫触锛歝ontent.meta.visibility 鏈悓姝?) };
                }
                if (!!verified.is_pinned !== !!nextPinned) {
                    return { ok: false, error: new Error("鏇存柊澶辫触锛氱疆椤剁姸鎬佹湭瀹為檯鐢熸晥") };
                }
                if (!!verifiedMeta.is_pinned !== !!nextPinned) {
                    return { ok: false, error: new Error("鏇存柊澶辫触锛歝ontent.meta.is_pinned 鏈悓姝?) };
                }
                if (Object.prototype.hasOwnProperty.call(updates, "pinned_at") && String(verified.pinned_at || "") !== String(nextPinnedAt || "")) {
                    return { ok: false, error: new Error("鏇存柊澶辫触锛歱inned_at 鏈疄闄呯敓鏁?) };
                }
                if (Object.prototype.hasOwnProperty.call(updates, "updated_at") && String(verified.updated_at || "") !== String(nextUpdatedAt || "")) {
                    return { ok: false, error: new Error("鏇存柊澶辫触锛歶pdated_at 鏈疄闄呯敓鏁?) };
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
                if (normalized.updated_at) return time + " (宸茬紪杈?";
                return time;
            }

            function buildPostBadges(post) {
                var normalized = normalizePost(post);
                var bits = [];
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '绉佸瘑' : '鍏紑') + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">缃《</span>');
                return bits.join("");
            }

            function buildPostStatsLine(post, likeCount, commentCount) {
                var normalized = normalizePost(post);
                var visibilityClass = normalized.visibility === "private" ? 'private' : 'public';
                var visibilityText = normalized.visibility === "private" ? '绉佸瘑' : '鍏紑';
                return '娴忚 ' + (normalized.views || 0) +
                    ' | 鐐硅禐 ' + (likeCount || 0) +
                    ' | 璇勮 ' + (commentCount || 0) +
                    '<span class="post-stats-visibility post-stats-visibility-' + visibilityClass + '">' + visibilityText + '</span>';
            }

            buildPostBadges = function(post) {
                var normalized = normalizePost(post);
                return normalized.is_pinned ? '<span class="post-pin-badge">缂冾噣銆?/span>' : '';
            };

            function buildPostActionHtml(post, isLiked, canDelete) {
                var idJs = safeJsStr(String(post.id));
                var idHtml = escapeHtml(String(post.id));
                var actorKeyJs = safeJsStr(String(post.actor_key || ""));
                var actions = [
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '鉂わ笍' : '鐐硅禐') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + idJs + '\')">璇勮</button>'
                ];
                if (canEditPost(post)) {
                    actions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + idJs + '\')">缂栬緫</button>');
                }
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" data-post-id="' + idHtml + '">' + (normalizePost(post).is_pinned ? '鍙栨秷缃《' : '缃《') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + idJs + '\', \'' + actorKeyJs + '\')">鍒犻櫎</button>');
                }
                return actions.join("");
            }

            function renderPostCard(post, commentMap, likeMap, likeUserMap) {
                var normalized = normalizePost(post);
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = likeUserMap[normalized.id + '|' + deviceId];
                var canDelete = normalized.actor_key === deviceId || normalized.actor_key === currentUser || isAdmin();
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
                    feed.innerHTML = window.xtjMagicLoadingHtml('鍐呭鍔犺浇涓?..', '', 'feed');
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
                    showToast("鏃犳潈缂栬緫杩欐潯甯栧瓙");
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
                if (btn) { btn.disabled = false; btn.textContent = "淇濆瓨淇敼"; }
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
                var btn = document.getElementById("saveEditPostBtn");
                var nextContent = input ? input.value.trim() : "";
                var nextVisibility = (document.getElementById("editPostVisibilityVal") || {}).value || "public";
                if (!nextContent) {
                    showToast("璇疯緭鍏ュ笘瀛愬唴瀹?);
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
                        throw new Error("淇濆瓨澶辫触锛氬叕寮€/绉樺瘑鐘舵€佹湭瀹為檯淇濆瓨");
                    }
                    var verified = normalizePost(fetchedPost);
                    var verifiedMeta = parsePostContent(fetchedPost).meta || {};
                    if (String(verified.visibility) !== String(nextVisibility)) {
                        throw new Error("淇濆瓨澶辫触锛氬叕寮€/绉佸瘑鐘舵€佹湭瀹為檯淇濆瓨");
                    }
                    if (String(verifiedMeta.visibility || "public") !== String(nextVisibility)) {
                        throw new Error("淇濆瓨澶辫触锛歝ontent.meta.visibility 鏈悓姝?);
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
                    showToast(nextVisibility === "private" ? "宸叉敼涓虹瀵? : "宸叉敼涓哄叕寮€");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("淇濆瓨澶辫触: " + (e && e.message ? e.message : "缃戠粶閿欒"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "淇濆瓨淇敼";
                }
            };
            window._legacyTogglePostPinBase = async function(postId, btn) {
                console.log('[togglePostPin] called with postId:', postId, 'feedAllPosts length:', feedAllPosts.length);
                if (!postId) { showToast("缃《澶辫触: postId 涓虹┖"); return; }
                var nextPinned;
                var originalText;
                if (btn) {
                    originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = '澶勭悊涓?..';
                }
                try {
                    // Fetch current post state directly from DB (only select columns that exist)
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) { alert('鏌ヨ澶辫触: ' + fetchRes.error.message); throw fetchRes.error; }
                    if (!fetchRes.data) { alert('鏈壘鍒板笘瀛?(id=' + postId + ')'); throw new Error('not found'); }
                    var dbPost = normalizePost(fetchRes.data);
                    // Check permission
                    if (currentUser !== dbPost.user_name && currentUser !== ADMIN_NAME) {
                        alert('鏃犳潈缃《杩欐潯甯栧瓙 (褰撳墠: ' + currentUser + ', 浣滆€? ' + dbPost.user_name + ')');
                        showToast('鏃犳潈缃《');
                        if (btn) { btn.disabled = false; btn.textContent = originalText; }
                        return;
                    }
                    nextPinned = !dbPost.is_pinned;
                    btn.textContent = nextPinned ? '缃《涓?..' : '鍙栨秷涓?..';
                    // Update via Supabase directly
                    var updateRes = await sb.from('posts').update({
                        is_pinned: nextPinned,
                        pinned_at: nextPinned ? new Date().toISOString() : null
                    }).eq('id', postId);
                    if (updateRes.error) { alert('鏇存柊澶辫触: ' + updateRes.error.message); throw updateRes.error; }
                    clearFeedCache();
                    showToast(nextPinned ? '鉁?甯栧瓙宸茬疆椤? : '鉁?宸插彇娑堢疆椤?);
                    await loadFeed(true);
                } catch (e) {
                    console.error('[togglePostPin] error:', e);
                    if (btn) { btn.disabled = false; btn.textContent = originalText || '缃《'; }
                    if (!/^[\u4e00-\u9fa5]/.test(e && e.message || '')) {
                        showToast('鎿嶄綔寮傚父锛岃鏌ョ湅鎺у埗鍙?);
                    }
                }
            };
            window._legacyTogglePostPin = async function(postId, btn) {
                console.log('[togglePostPin override] called with postId:', postId, 'feedAllPosts length:', feedAllPosts.length);
                if (!postId) { showToast("缃《澶辫触: postId 涓虹┖"); return; }
                var nextPinned;
                var originalText;
                if (btn) {
                    originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = '澶勭悊涓?..';
                }
                try {
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) throw fetchRes.error;
                    if (!fetchRes.data) throw new Error('鏈壘鍒板搴斿笘瀛?);
                    var dbPost = normalizePost(fetchRes.data);
                    if (currentUser !== dbPost.user_name && currentUser !== ADMIN_NAME) {
                        showToast('鏃犳潈缃《');
                        return;
                    }
                    nextPinned = !dbPost.is_pinned;
                    if (btn) btn.textContent = nextPinned ? '缃《涓?..' : '鍙栨秷涓?..';
                    var updateRes = await updatePostRecord(fetchRes.data, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinned ? new Date().toISOString() : null,
                        updated_at: new Date().toISOString()
                    });
                    if (!updateRes.ok) {
                        showToast('缃《澶辫触: ' + ((updateRes.error && updateRes.error.message) || '鏈煡閿欒'));
                        return;
                    }
                    clearFeedCache();
                    await loadFeed(true);
                    showToast(nextPinned ? '甯栧瓙宸茬疆椤? : '宸插彇娑堢疆椤?);
                } catch (e) {
                    console.error('[togglePostPin override] error:', e);
                    showToast('缃《澶辫触: ' + (e && e.message ? e.message : '鏈煡閿欒'));
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText || '缃《';
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
                        showToast('缃《鐘舵€佸凡鎸夋湇鍔″櫒缁撴灉鏍℃');
                    }
                } catch (e) {
                    console.error('[pin] background verify failed', e);
                    showToast('缃《宸叉洿鏂帮紝浣嗗悗鍙版牎楠屽け璐? ' + (e && e.message ? e.message : '鏈煡閿欒'));
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
                    showToast('缃《澶辫触: postId 涓虹┖');
                    return;
                }
                var originalText = btn ? btn.textContent : '';
                var nextPinned = false;
                var didSucceed = false;
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '澶勭悊涓?..';
                    }
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) throw fetchRes.error;
                    if (!fetchRes.data) throw new Error('鏈壘鍒板搴斿笘瀛?);

                    var dbPost = normalizePost(fetchRes.data);
                    if (currentUser !== dbPost.user_name && currentUser !== ADMIN_NAME) {
                        showToast('鏃犳潈缃《');
                        return;
                    }

                    nextPinned = !dbPost.is_pinned;
                    var nextPinnedAt = nextPinned ? new Date().toISOString() : null;
                    var nextUpdatedAt = new Date().toISOString();
                    if (btn) btn.textContent = nextPinned ? '缃《涓?..' : '鍙栨秷涓?..';

                    var updateRes = await updatePostRecord(fetchRes.data, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinnedAt,
                        updated_at: nextUpdatedAt
                    });
                    if (!updateRes.ok) {
                        showToast('缃《澶辫触: ' + ((updateRes.error && updateRes.error.message) || '鏈煡閿欒'));
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
                    showToast(nextPinned ? '甯栧瓙宸茬疆椤? : '宸插彇娑堢疆椤?);
                    verifyPinnedPostInBackground(postId, nextPinned);
                } catch (e) {
                    console.error('[togglePostPin final override] error:', e);
                    showToast('缃《澶辫触: ' + (e && e.message ? e.message : '鏈煡閿欒'));
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = didSucceed ? (nextPinned ? '鍙栨秷缃《' : '缃《') : (originalText || '缃《');
                    }
                }
            };

            window.togglePostVisibility = async function(postId, btn) {
                var post;
                var nextVisibility;
                try {
                    post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                    if (!post || !canEditPost(post)) {
                        showToast("鏃犳潈淇敼杩欐潯甯栧瓙鐨勯殣绉佺姸鎬?);
                        return;
                    }
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = "澶勭悊涓?..";
                    }
                    nextVisibility = post.visibility === "private" ? "public" : "private";
                    var result = await updatePostRecord(post, {
                        visibility: nextVisibility
                    });
                    if (!result.ok) {
                        if (btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "馃敀 璁句负绉佸瘑" : "馃敁 璁句负鍏紑"; }
                        showToast("鎿嶄綔澶辫触: " + ((result.error && result.error.message) || "鏈煡閿欒"));
                        return;
                    }
                    clearFeedCache();
                    showToast(nextVisibility === "private" ? "馃敀 宸茶涓虹瀵嗭紝浠呰嚜宸卞彲瑙? : "馃敁 宸茶涓哄叕寮€");
                    await loadFeed(true);
                } catch (e) {
                    console.error("togglePostVisibility error:", e);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = "馃敀 璁句负绉佸瘑";
                    }
                    showToast("鎿嶄綔寮傚父: " + (e && e.message ? e.message : "鏈煡閿欒锛岃鏌ョ湅鎺у埗鍙?));
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
                if (!currentUser) { showToast("璇峰厛鐧诲綍"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("璇疯緭鍏ュ笘瀛愬唴瀹?); return; }
                if (content.length > 2000) { showToast("鍐呭涓嶈兘瓒呰繃2000瀛?); return; }
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
                    showToast(insertRes.fallback ? "鍙戝竷鎴愬姛锛屽凡鍏煎鏃ф暟鎹粨鏋? : "鍙戝竷鎴愬姛");
                    await loadFeed(true);
                } catch (e) {
                    showToast("鍙戝竷澶辫触: " + (e.message || "缃戠粶閿欒"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "鍙戝竷鍔ㄦ€?;
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
                    feed.innerHTML = window.xtjMagicLoadingHtml('鍐呭鍔犺浇涓?..', '', 'feed');
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
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">鍔犺浇澶辫触: ' + escapeHtml(err.message || "鏈煡閿欒") + '</div>';
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
                        noMore.textContent = "娌℃湁鏇村甯栧瓙";
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
                if (visiblePosts.length) {
                    feed.innerHTML = visiblePosts.map(function(post) {
                        return renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                    }).join("");
                } else {
                    feed.innerHTML = '<div class="loading">' + (hasFilters ? '鏆傛棤鍖归厤鐨勫笘瀛? : '蹇幓鍙戝竷绗竴鏉″姩鎬佸惂~') + '</div>';
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
                    showToast("甯栧瓙宸插垹闄?);
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

            // ===================== 鏁版嵁缁熻璇︽儏鍔熻兘 =====================
            // 瀛樺偍锟斤拷前鐨勭粺锟铰ゎ潒鍥剧姸锟?
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
                const titles = { posts: '鎬诲姩鎬? 鎸夌敤鎴峰垎缁?, views: '鎬绘祻瑙? 娴忚璁板綍', likes: '鐐硅禐鍜岃瘎璁? 璁板綍' };
                document.getElementById('statModalTitle').textContent = titles[type] || '缁熻璇︽儏';
                document.getElementById('statModal').classList.add('active');

                // 濡傛灉鏈夌紦瀛樻暟锟筋噯绱濋敓鏂ゆ嫹閿熸枻鎷峰〒鍙夌厠閿涘苯鎮撻弮璺虹磽濮濄儱鍩涳拷?
                if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    // 鍚庡彴闈欓粯刷锟斤拷
                    prefetchStatData().then(function() {
                        if (document.getElementById('statModal').classList.contains('active') && statCurrentType === type) {
                            renderStatByType(type);
                        }
                    });
                    return;
                }

                document.getElementById('statModalBody').innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '鍔犺浇涓?..', 'feed');

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
                if (post.media_type === 'image') return '鍥剧墖鍔ㄦ€?;
                if (post.media_type === 'video') return '瑙嗛鍔ㄦ€?;
                return '鏃犳枃瀛楀唴瀹?;
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
                    '<div class="stat-empty-title">' + escapeHtml(opts.title || '鏆傛棤鏁版嵁') + '</div>',
                    opts.copy ? '<div class="stat-empty-copy">' + escapeHtml(opts.copy) + '</div>' : '',
                    opts.note ? '<div class="stat-empty-note">' + escapeHtml(opts.note) + '</div>' : '',
                    '</div>'
                ].join('');
            }

            function statPostItemMarkup(post) {
                var hasImg = post.media_url && post.media_type === 'image';
                var hasVid = post.media_url && post.media_type === 'video';
                var tag = hasImg ? '<span class="spi-img-tag">鍥剧墖</span>' : (hasVid ? '<span class="spi-img-tag">瑙嗛</span>' : '<span class="spi-img-tag spi-img-tag--text">鏂囧瓧</span>');
                var display = summarizeStatPost(post, 38);
                var onclick = "openPostDetail('" + String(post.id).replace(/'/g, "\\'") + "')";
                return [
                    '<div class="stat-post-item" onclick="' + onclick + '" title="鐐瑰嚮鏌ョ湅甯栧瓙璇︽儏">',
                    '<div class="spi-main">',
                    '<div class="spi-content-row"><span class="spi-content">' + escapeHtml(display) + '</span>' + tag + '</div>',
                    '<div class="spi-meta"><span class="spi-time">' + escapeHtml(formatStatTime(post.created_at)) + '</span><span class="spi-open">鏌ョ湅璇︽儏</span></div>',
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
                        title: '杩樻病鏈夊姩鎬佺粺璁?,
                        copy: '杩欓噷浼氭寜鐢ㄦ埛鏁寸悊鎵€鏈夊姩鎬侊紝鏂逛究浣犲揩閫熸煡鐪嬭皝鍙戝緱鏈€澶氥€佹渶杩戝彂浜嗕粈涔堛€?
                    });
                    return;
                }
                body.innerHTML = statHeroMarkup({
                    tone: 'posts',
                    kicker: 'POSTS',
                    title: '鎬诲姩鎬佹€昏',
                    copy: '鎸夌敤鎴峰垎缁勫睍绀猴紝浼樺厛鏄剧ず鍙戝笘鏇存椿璺冪殑鐢ㄦ埛銆?,
                    metrics: [
                        { label: '鍔ㄦ€佹€绘暟', value: statAllPosts.length },
                        { label: '娲昏穬鐢ㄦ埛', value: entries.length },
                        { label: '鏈€杩戞洿鏂?, value: entries[0] && entries[0][1] && entries[0][1][0] ? formatStatTime(entries[0][1][0].created_at).slice(0, 16) : '--' }
                    ]
                }) + '<div class="stat-stack">' + entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    var latest = posts[0] ? formatStatTime(posts[0].created_at) : '--';
                    var moreButton = posts.length > 3
                        ? '<button class="stat-view-btn" onclick="loadUserAllPosts(\'' + String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">鏌ョ湅鍏ㄩ儴 ' + posts.length + ' 鏉?/button>'
                        : '';
                    return [
                        '<section class="stat-user-group stat-surface-card">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(name).slice(0, 1).toUpperCase() + '</div><div class="suh-copy"><span class="suh-name">' + escapeHtml(name) + '</span><span class="suh-sub">鏈€杩戞洿鏂?' + escapeHtml(latest) + '</span></div></div><div class="suh-right"><span class="suh-count">' + posts.length + ' 鏉?/span>' + moreButton + '</div></div>',
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
                    '<button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">杩斿洖鎬诲姩鎬?/button>',
                    statHeroMarkup({
                        tone: 'posts',
                        kicker: 'USER POSTS',
                        title: userName + ' 鐨勫叏閮ㄥ姩鎬?,
                        copy: '鎸夋椂闂村€掑簭灞曠ず璇ョ敤鎴峰彂甯冭繃鐨勬墍鏈夊唴瀹广€?,
                        metrics: [
                            { label: '鍔ㄦ€佹暟閲?, value: userPosts.length },
                            { label: '鏈€鏂板彂甯?, value: userPosts[0] ? formatStatTime(userPosts[0].created_at).slice(0, 16) : '--' }
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
                        title: '杩樻病鏈夋祻瑙堣褰?,
                        copy: '褰撲綘鏌ョ湅甯栧瓙璇︽儏鏃讹紝杩欓噷浼氳嚜鍔ㄨ褰曡皝鐪嬩簡鍝潯甯栧瓙锛屾柟渚垮洖鐪嬫祻瑙堣建杩广€?,
                        note: '娴忚璁板綍淇濆瓨鍦ㄥ綋鍓嶈澶囩殑鏈湴缂撳瓨涓€?
                    });
                    return;
                }
                body.innerHTML = statHeroMarkup({
                    tone: 'views',
                    kicker: 'VIEWS',
                    title: '娴忚璁板綍',
                    copy: '璁板綍鏈€杩戠殑甯栧瓙娴忚杞ㄨ抗锛屽府鍔╀綘鍥炵湅琚闂殑鍐呭銆?,
                    metrics: [
                        { label: '璁板綍鏉℃暟', value: history.length },
                        { label: '鏈€杩戞祻瑙?, value: formatStatTime(history[0].viewed_at).slice(0, 16) },
                        { label: '娴忚鎬婚噺', value: document.getElementById('sViews') ? document.getElementById('sViews').textContent : history.length }
                    ]
                }) + '<div class="stat-stack">' + history.map(function(v) {
                    return [
                        '<article class="stat-view-item">',
                        '<div class="stat-record-head"><div class="svi-user">' + escapeHtml(v.user_name) + '</div><span class="svi-time">' + escapeHtml(formatStatTime(v.viewed_at)) + '</span></div>',
                        '<div class="stat-record-title">娴忚浜?' + escapeHtml(v.post_author) + ' 鐨勫笘瀛?/div>',
                        '<div class="stat-record-copy">' + escapeHtml(v.post_content || '鏃犳枃瀛楀唴瀹?) + '</div>',
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
                    var h = '<div class="stat-section-title"><span>鐐硅禐璁板綍</span><span class="stat-section-count">' + statAllLikes.length + '</span></div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(function(l) {
                            var post = postMap[l.post_id];
                            var postContent = post ? summarizeStatPost(post, 32) : '鍘熷笘宸插垹闄?;
                            return [
                                '<article class="stat-like-item">',
                                '<div class="stat-record-head"><div class="sli-user">' + escapeHtml(l.user_name) + '</div><span class="sli-time">' + escapeHtml(formatStatTime(l.created_at)) + '</span></div>',
                                '<div class="stat-record-title">鐐硅禐浜嗚繖鏉″唴瀹?/div>',
                                '<div class="stat-record-copy">' + escapeHtml(postContent) + '</div>',
                                '</article>'
                            ].join('');
                        }).join('');
                    } else {
                        h += statEmptyMarkup({ title: '鐐硅禐璁板綍', copy: '褰撴湁浜虹粰甯栧瓙鐐硅禐鍚庯紝杩欓噷浼氭樉绀烘渶杩戠殑浜掑姩銆? });
                    }
                    return h;
                }

                function buildCommentsCol() {
                    var h = '<div class="stat-section-title"><span>璇勮璁板綍</span><span class="stat-section-count">' + statAllComments.length + '</span></div>';
                    if (statAllComments.length) {
                        h += statAllComments.slice().reverse().slice(0, 200).map(function(c) {
                            var post = postMap[c.post_id];
                            var postContent = post ? summarizeStatPost(post, 28) : '鍘熷笘宸插垹闄?;
                            return [
                                '<article class="stat-comment-item">',
                                '<div class="stat-record-head"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><span class="sci-time">' + escapeHtml(formatStatTime(c.created_at)) + '</span></div>',
                                '<div class="stat-record-title">璇勮浜嗚繖鏉″唴瀹?/div>',
                                '<div class="stat-record-copy">鍘熷笘锛? + escapeHtml(postContent) + '</div>',
                                '<div class="stat-record-note">' + escapeHtml(c.content || '鏃犺瘎璁哄唴瀹?) + '</div>',
                                '</article>'
                            ].join('');
                        }).join('');
                    } else {
                        h += statEmptyMarkup({ title: '鏆傛棤璇勮璁板綍', copy: '璇勮浜掑姩鍑虹幇鍚庯紝杩欓噷浼氭寜鏃堕棿鏁寸悊鍑烘潵銆? });
                    }
                    return h;
                }

                body.innerHTML = statHeroMarkup({
                    tone: 'likes',
                    kicker: 'ENGAGEMENT',
                    title: '鐐硅禐涓庤瘎璁?,
                    copy: '鎶婁袱绫讳簰鍔ㄦ媶寮€鏄剧ず锛屼究浜庡揩閫熺湅娓呰皝鍦ㄧ偣璧炪€佽皝鍦ㄥ彂瑷€銆?,
                    metrics: [
                        { label: '鎬讳簰鍔?, value: statAllLikes.length + statAllComments.length },
                        { label: '鐐硅禐', value: statAllLikes.length },
                        { label: '璇勮', value: statAllComments.length }
                    ]
                }) + '<div class="stat-two-col"><section class="stat-col">' + buildLikesCol() + '</section><section class="stat-col">' + buildCommentsCol() + '</section></div>';
            };

            window.openPostDetail = async function(postId) {
                document.getElementById('postDetailTitle').textContent = '甯栧瓙璇︽儏';
                document.getElementById('postDetailBody').innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '鍔犺浇涓?..', 'feed');
                document.getElementById('postDetailModal').classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);

                    const post = normalizePost(postRes.data);
                    if (!post) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">甯栧瓙涓嶅瓨鍦ㄦ垨宸插垹闄?/div>';
                        return;
                    }
                    if (!canViewPost(post)) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">鏃犳潈鏌ョ湅杩欐潯甯栧瓙</div>';
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
                    ${post.media_url ? `<div class="post-detail-media">${post.media_type==='video'?`<video src="${escapeHtml(post.media_url)}" controls preload="none"></video>`:`<img src="${escapeHtml(post.media_url)}" onclick="openImageViewer('${safeJsStr(post.media_url)}')" loading="lazy" />`}</div>` : ''}
                    <div class="post-detail-stats">娴忚 ${vc} 娆÷?鐐硅禐 ${likes.length} 娆÷?璇勮 ${comments.length}</div>
                    <div class="stat-two-col">
                        <div class="stat-col">
                            <div class="stat-section-title">鉁?鐐硅禐鐢ㄦ埛 ${likes.length}</div>
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
                            <div class="stat-section-title">馃挰 璇勮鍒楄〃 ${comments.length}</div>
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

            // 鏍煎紡鍖栧笘瀛愬唴瀹规憳瑕侊紙锟姐劋浜庣仦鏇犮仛锛?
            function formatPostSummary(p) {
                const text = p.content || '';
                const hasImg = p.media_url && p.media_type === 'image';
                const hasVid = p.media_url && p.media_type === 'video';
                let tag = '';
                if (hasImg) tag = '<span class="spi-img-tag">? 图片</span>';
                if (hasVid) tag = '<span class="spi-img-tag">馃幀 瑙嗛</span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '涓€寮犲浘鐗? : hasVid ? '涓€涓棰? : '(鏃犲唴瀹?');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 鐢熸垚甯栧瓙锟斤紕娲伴惃鍑ML閿涘牆褰查悙鐟板毊鐠哄疇娴嗭細
            function renderPostItemHTML(p) {
                const fmt = formatPostSummary(p);
                const onclick = `openPostDetail('${safeJsStr(p.id)}')`;
                return `
                    <div class="stat-post-item">
                        <span class="spi-content" onclick="${onclick}" title="鐐瑰嚮鏌ョ湅甯栧瓙璇︽儏">
                            ${escapeHtml(fmt.display)}
                            ${fmt.tag}
                        </span>
                        ${fmt.thumbUrl ? `<img class="spi-thumb" src="${escapeHtml(fmt.thumbUrl)}" onclick="${onclick}" title="鐐瑰嚮鏌ョ湅甯栧瓙璇︽儏" />` : ''}
                        <span class="spi-time">${new Date(p.created_at).toLocaleString()}</span>
                    </div>
                `;
            }

            // 娓叉煋鎬诲姩鎬佺粺璁★紙鎸夌敤鎴峰垎缁勶級
            function renderPostStats() {
                const body = document.getElementById('statModalBody');
                // 閹?user_name 鍒嗙粍缁燂拷顓?
                const userMap = {};
                statAllPosts.forEach(p => {
                    if (!userMap[p.user_name]) userMap[p.user_name] = [];
                    userMap[p.user_name].push(p);
                });
                const entries = Object.entries(userMap).sort((a, b) => b[1].length - a[1].length);
                
                if (!entries.length) {
                    body.innerHTML = '<div class="stat-empty">鏆傛棤鍔ㄦ€佹暟鎹?/div>';
                    return;
                }

                body.innerHTML = entries.map(([name, posts]) => `
                    <div class="stat-user-group">
                        <div class="stat-user-header">
                            <div class="suh-left">
                                <div class="suh-avatar">${escapeHtml(name)[0].toUpperCase()}</div>
                                <span class="suh-name">${escapeHtml(name)}</span>
                            </div>
                            <span class="suh-count">${posts.length} 鏉?/span>
                        </div>
                        <div class="stat-user-posts">
                            ${posts.slice(0, 3).map(p => renderPostItemHTML(p)).join('')}
                            ${posts.length > 3 ? `
                                <div style="text-align:center; padding:8px 0;">
                                    <button class="stat-view-btn" onclick="loadUserAllPosts('${safeJsStr(name)}')">鏌ョ湅鍏ㄩ儴 ${posts.length} 鏉?/button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('');
            }

            // 閺屻儳婀呴幐鍥х暰鐢ㄦ埛閻ㄥ嫭澧嶉張澶婄瑯瀛?
            window.loadUserAllPosts = function(userName) {
                const body = document.getElementById('statModalBody');
                const userPosts = statAllPosts.filter(p => p.user_name === userName);
                body.innerHTML = `
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">鈫?杩斿洖鎬诲姩鎬?/button>
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
                            <div style="font-size:16px; margin-bottom:8px;">馃摰 娴忚璁板綍</div>
                            <div style="font-size:13px;">鏆傛棤娴忚璇︽儏鏁版嵁</div>
                            <div style="font-size:12px; margin-top:12px; opacity:0.7;">娴忚璁板綍浼氬湪浣犳煡鐪嬪笘瀛愭椂鑷姩淇濆瓨</div>
                            <div style="font-size:12px; margin-top:8px; opacity:0.7;">褰撳墠宸茶褰曟€绘祻瑙堟暟锛歿document.getElementById('sViews').textContent} 娆?/div>
                        </div>
                    `;
                    return;
                }

                body.innerHTML = history.map(v => `
                    <div class="stat-view-item">
                        <div class="svi-info">
                            <div class="svi-user">${escapeHtml(v.user_name)}</div>
                            <div class="svi-target">娴忚浜?b>${escapeHtml(v.post_author)}</b> 鐨勫笘瀛愶細${escapeHtml(v.post_content)}</div>
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
                    let h = '<div class="stat-section-title">鐐硅禐璁板綍</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(l => {
                            const post = postMap[l.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(鍥剧墖/瑙嗛)') : '(宸插垹闄ゅ笘瀛?';
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
                        h += '<div class="stat-empty" style="padding:12px 0;">鐐硅禐璁板綍</div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    let h = '<div class="stat-section-title">馃挰 璇勮璁板綍</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(鍥剧墖/瑙嗛)') : '(宸插垹闄ゅ笘瀛?';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">璇勮娴滃棎鈧?{postContent}閵嗗稄绱?{escapeHtml(c.content)}</div>
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

            // ==== 娴嬭瘯通知锟筋亜绠欓敍鍫熷付閸掕泛褰寸拫鍐暏閿涙estNotification()闁?====
            window.testNotification = function() {
                showNotification('寮犱笁', '杩欐槸涓€鏉℃祴璇曟秷鎭紝妫€鏌ラ€氱煡鏂囨湰鏄剧ず鏄惁姝ｅ父');
            };
            window.testNotificationLong = function() {
                showNotification('鏉庡洓', '杩欐槸涓€鏉￠潪甯搁潪甯搁暱鐨勬祴璇曟秷鎭紝鐢ㄦ潵妫€鏌ユ枃鏈埅鏂晥鏋滃埌搴曟€庝箞鏍凤紝瓒呰繃300涓瓧绗︿篃涓嶄細鎶婂瓧绗︿覆鎵撳潖');
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
                        showNotification(m.user_name, m.content || '鍙戦€佷簡涓€寮犲浘鐗囪棰?);
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
                        else if (status === 'SUBSCRIBED') { console.log('[CHAT-REALTIME] 宸茶繛鎺?); }
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
                if (tab === 'chat' && !currentUser) { showToast('璇峰厛鐧诲綍'); return; }
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
                        // 鍙屽嚮锛氭墽琛屽埛锟?
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            window.showToast('姝ｅ湪鍒锋柊鐓х墖澧?..');
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
                                window.showToast('鍒锋柊瀹屾垚');
                            }).catch(function() {
                                isRefreshing[tab] = false;
                                window.showToast('鍒锋柊澶辫触');
                            });
                        } else if (tab === 'posts') {
                            // 甯栧瓙椤靛埛??
                            window.showToast('姝ｅ湪鍒锋柊...');
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
                                        window.showToast('閸掗攱鏌婃径杈Е');
                                    });
                            }
                            // 鍥炲埌椤堕儴
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                            window.showToast('鍒锋柊瀹屾垚');
                        } else if (tab === 'chat') {
                            // 閼卞﹤銇夊銈夋涧閸╂盯式
                            window.showToast('姝ｅ湪鍒锋柊...');
                            window.dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('鍒锋柊瀹屾垚');
                        } else if (tab === 'profile') {
                            // 涓汉椤靛埛??
                            window.showToast('姝ｅ湪鍒锋柊...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            isRefreshing[tab] = false;
                            window.showToast('鍒锋柊瀹屾垚');
                        }
                    } else {
                        // 鍗曞嚮锛氭墽琛岃繑锟?鍥為《鎿嶄綔
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 甯栧瓙椤碉細鍥炲埌椤堕儴
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 閿熸枻鎷烽敓鏂ゆ嫹妞ょ绱版俊鍌涚亯閸︺劌顕瘽涓紝杩斿洖鑱婏拷鈺佸灙鐞涱煉绱遍崥锕€鍨崶鐐插煂妞ゅ爼锟?
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
                var title = options && options.title ? options.title : '鍔犺浇涓?..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                el.innerHTML = window.xtjMagicLoadingHtml(title, subtitle, variant);
            }

            function dockChatGoBack() {
                dockChatActiveUser = null;
                document.getElementById('dockChatDetailView').classList.add('hidden');
                document.getElementById('dockChatListView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'none';
                document.getElementById('dockChatTitle').textContent = '娑堟伅';
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
                if (!window.currentUser) { showToast('璇峰厛鐧诲綍'); return; }
                if (userName === window.currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                document.getElementById('dockChatMessages').innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '姝ｅ湪鎵撳紑鑱婂ぉ閫氶亾', 'chat-detail');
                renderChatLoadingState(document.getElementById('dockChatMessages'), {
                    title: '鍔犺浇涓?..',
                    subtitle: '姝ｅ湪鎵撳紑鑱婂ぉ閫氶亾',
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
                    document.getElementById('dockChatTitle').textContent = '娑堟伅';
                }
                if (Date.now() - (window.dockChatListCacheTime || 0) < DOCK_CHAT_CACHE_DURATION) return;
                window.dockChatListCacheTime = Date.now();
                el.innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '姝ｅ湪鍙洖鏈€杩戞秷鎭?, 'chat-list');
                try {
                    renderChatLoadingState(el, {
                        title: '鍔犺浇涓?..',
                        subtitle: '姝ｅ湪鍙洖鏈€杩戞秷鎭?,
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
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">馃挰</div><div>鏆傛棤娑堟伅</div><div style="font-size:12px;">鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶╁惂</div></div>';
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
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">閳?/div><div>' + (e.message || '鍔犺浇澶辫触') + '</div></div>';
                }
            }

            // 鑱婂ぉ娑堟伅閺堟勾缂撳瓨閿涘奔绨╁▎鈩冨ⅵ瀵偓缁夋帒锟??
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
                // 褰撳墠鐢ㄦ埛浼樺厛浣跨敤localStorage闂佸搫顦崯顐﹀煝婢跺瞼澶勯悗?
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
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">閳?/div><div>' + (e.message || '鍔犺浇澶辫触') + '</div></div>';
                    }
                } finally {
                    dockChatMsgsBusy = false;
                    if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
                }
            }

            function renderDockMessages(msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">馃挰</div><div>鍙戦€佺涓€鏉℃秷鎭惂</div></div>'; return; }
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

            try {
                var _dsb = document.getElementById('dockChatSendBtn'); if (_dsb) _dsb.addEventListener('click', sendDockChatMessage);
                var _dci = document.getElementById('dockChatInput'); if (_dci) _dci.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDockChatMessage(); } });
                var _dib = document.getElementById('dockChatImgBtn'); if (_dib) _dib.addEventListener('click', function() { document.getElementById('dockChatFileInp').click(); });
                var _dfi = document.getElementById('dockChatFileInp'); if (_dfi) _dfi.addEventListener('change', function() { if (this.files.length) showDockChatFilePreview(this.files[0]); });
                var _dcr = document.getElementById('dockCfpRemove'); if (_dcr) _dcr.addEventListener('click', clearDockChatFilePreview);
            } catch(e) {
            }

            window.addEventListener('DOMContentLoaded', async function() {
                // iOS 闂佹鍠氬ú蹇擃嚕閻熸澘姣夊ǎ鍥跺枛椤? 闂侇剙鐏濋崢?dock-bar 琚敭鐩橀《涓婂幓
                (function() {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
                    let keyboardOpen = false;

                    function handleFocus(e) {
                        if (dockBar) dockBar.style.display = 'none';
                        keyboardOpen = true;
                        // 璁╄緭鍏ユ鑷姩??锟藉埌鍙鍖哄煙
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

                    // 濞寸姾顕ф慨?閿涙矮濞囬敓?100dvh 闁哄洤銇橀崬?--vh 鏂规锛岀Щ??resize 鍥炶皟涓殑 adjustIOSHeight
                    // window.addEventListener('resize', function() {
                    //     if (!keyboardOpen) adjustIOSHeight();
                    // });
                })();

                // 濞寸姾顕ф慨?閿涙矮濞囬敓?100dvh 闁哄洤銇橀崬?--vh 鏂规锛岀Щ闄ゆ棫锟?iOS 閻犲鍟弳锝嗙閿濆洨鍨?
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI(); initialLoad();
                // 鎭㈠娑撳﹥淇濆瓨閻ㄥ嫭鐖ｇ粵楣冿拷?
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
                    if (themeBtn) themeBtn.textContent = '馃寵';
                    localStorage.setItem('xtj-theme', 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) themeBtn.textContent = '鈽€锔?;
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
                // 閿熸枻鎷烽敓鏂ゆ嫹閸掓銆冮弮鑸典划婢跺秶顓哥悊鍛樼殑鍙戝竷鍖猴拷?
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
                
                // 璁剧疆鍙戝竷閼板懍淇婇幁绱欐樉绀洪張鈧柊澧炪仈閸嶅骏锟?
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
                    delBtn.textContent = '鍒犻櫎鍏憡';
                    delBtn.onclick = function(e) { e.stopPropagation(); deleteAnnouncement(ann); };
                    const header = detail.querySelector('.announcement-detail-header');
                    if (header) header.appendChild(delBtn);
                }

                renderAnnouncementList(); // 閲嶆柊娓叉煋鍒楄〃锛屾竻鐞嗘柊澧?
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
                    console.error('鍔犺浇澶辫触:', e);
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
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">馃摙</div><div>鏆傛棤鍏憡</div></div>';
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
                    showToast('鍏憡鍙戝竷鎴愬姛');
                    await loadAnnouncements();
                    renderAnnouncementList();
                } catch(e) {
                    showToast('鍙戝竷澶辫触: ' + (e.message || '鏈煡閿欒'));
                }
            };

            window.deleteAnnouncement = async function(ann) {
                showConfirm('鍒犻櫎鍏憡', '纭畾瑕佸垹闄よ繖鏉″叕鍛婂悧锛?, '纭畾', async function() {
                    try {
                        const { error } = await sb.rpc('delete_post_with_actor', {
                            p_post_id: ann.id,
                            p_actor_key: ann.actor_key || 'admin_' + Date.now()
                        });
                        if (error) throw error;

                        const readIds = getReadAnnouncements();
                        const filteredReadIds = readIds.filter(id => id !== ann.id);
                        saveReadAnnouncements(filteredReadIds);

                        showToast('鍏憡宸插垹闄?);
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

            // 鐗堟湰鏇存柊鏃ュ織
            const changelogData = [
                {
                    version: 'v0.68',
                    date: '2026-06-03',
                    content: `
                        <h4>甯栧瓙浜や簰淇</h4>
                        <ul>
                            <li>缃《鍜屽彇娑堢疆椤舵敼涓哄嵆鏃堕噸鎺掞紝鐐瑰嚮鍚庡垪琛ㄤ細绔嬪埢鏇存柊</li>
                            <li>甯栧瓙鍗＄墖鍙充笂瑙掔Щ闄ら噸澶嶇殑鍏紑/绉佸瘑鏍囪锛屼粎淇濈暀缁熻琛屽彸渚ф樉绀?/li>
                            <li>鍙屽嚮甯栧瓙 Dock 鍒锋柊鏀逛负鍏堟湰鍦版樉绀恒€佸啀鍚庡彴闈欓粯鍚屾锛屽噺灏戠┖鐧界瓑寰?/li>
                            <li>棰勮鍜屼笂浼犻摼璺户缁敹鍙ｏ紝浜や簰鍙嶉鏇撮『婊?/li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>閲嶅仛浜嗗笘瀛愮姸鎬佸垏鎹€佸埛鏂板弽棣堝拰閮ㄥ垎棰勮缁嗚妭锛屾暣浣撴洿鐩存帴銆佹洿骞插噣</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.67',
                    date: '2026-06-02',
                    content: `
                        <h4>鎬ц兘澶у箙浼樺寲</h4>
                        <ul>
                            <li>鑺辫崏鍦堝湀 Canvas 鍔ㄧ敾鍏ㄩ潰浼樺寲锛氶槾褰辨ā绯婇檷浣?0%銆佽棨钄撳垎娈靛噺灏?3%銆佽姳绮夊噺鑷?绮掋€佽澊铦舵畫褰卞噺鑷?灞?/li>
                            <li>escapeHtml 鏀圭敤绾瓧绗︿覆鏇挎崲閬垮厤鍒涘缓DOM鍏冪礌锛沠ixText 鏀逛负鍗曟姝ｅ垯鏇挎崲</li>
                            <li>鍏ㄥ眬 pointerdown 鍔?0ms鑺傛祦锛涚Щ闄ゅ涓?will-change 鍙嶆晥鏋滃０鏄?/li>
                            <li>perf-lite 褰诲簳绂佺敤 echo-loader 鏃犻檺寰幆鍔ㄧ敾锛沺erf-balanced 澶у箙闄嶄綆闃村奖鍜屾ā绯?/li>
                            <li>绛涢€夌敤鎴峰姞杞藉姩鐢绘敼涓轰腑蹇?20px鑺辫崏鍦堝湀Canvas鍔ㄧ敾</li>
                        </ul>
                    `
                },
                            {
                    version: 'v0.64',
                    date: '2026-05-31',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed core.js syntax errors causing blank page, unclickable UI, and data loading failures</li>
                            <li>Fixed dock-bar overlay blocking click interactions</li>
                            <li>Optimized dialog closing logic: ESC key now closes all active dialogs by priority</li>
                            <li>Enhanced photo-wall defensive programming for null data and null references</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.62',
                    date: '2026-05-30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Added photo filtering and sorting functionality</li>
                            <li>Removed post report button and all related code; cleaned up frontend remnants</li>
                        </ul>
                        <h4>Bug Fixes</h4>
                        <ul>
                            <li>Fixed editing interaction issues</li>
                            <li>Fixed related content display bugs</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.61',
                    date: '2026-05-30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Removed deprecated filter functionality</li>
                            <li>Replaced inline HTML styles with CSS classes</li>
                        </ul>
                        <h4>Project Optimization</h4>
                        <ul>
                            <li>Cleaned up JS scripts, reduced bundle size by 110+ KB</li>
                            <li>Fixed update mechanism timing issues</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.60',
                    date: '2026-05-28',
                    content: `
                        <h4>Bug Fixes</h4>
                        <ul>
                            <li>Fixed editing interaction issues</li>
                            <li>Fixed animation timing conflicts</li>
                            <li>Fixed data display and formatting bugs</li>
                        </ul>
                        <h4>Optimizations</h4>
                        <ul>
                            <li>Photo wall preview now supports pinch-to-zoom</li>
                            <li>Marked deprecated functions to prevent accidental modification</li>
                            <li>Improved upload.js select field integrity</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.59',
                    date: '2026-05-27',
                    content: `
                        <h4>Bug Fixes</h4>
                        <ul>
                            <li>Fixed button interaction state issues</li>
                            <li>Fixed fallback display when data is empty</li>
                            <li>Fixed localStorage key name collision</li>
                            <li>Fixed animation timing and interaction conflicts</li>
                            <li>Fixed interaction delay issues</li>
                            <li>Fixed image lazy loading failures</li>
                        </ul>
                        <h4>Optimizations</h4>
                        <ul>
                            <li>Optimized photo wall image loading performance</li>
                            <li>Added UTF-8 BOM to index.html</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.56',
                    date: '2026-05-26',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Photo Wall Optimization</strong>
                                <ul>
                                    <li>Optimized image loading with resolution cap at 1200x1200 and quality 0.85</li>
                                    <li>Integrated upload.js and features.js for better photo management</li>
                                </ul>
                            </li>
                            <li><strong>Removed Native Confirmation Dialogs</strong>
                                <ul>
                                    <li>Replaced system-level window.confirm with custom glass-morphism styled dialogs</li>
                                    <li>Added backdrop-filter: blur(28px) saturate(200%) frosted glass effect</li>
                                    <li>Added scale(0.9) translateY(20px) entry animation with cubic-bezier easing</li>
                                    <li>Confirmation dialogs now fade out with scale(0.88) animation</li>
                                    <li>Enhanced button layout and visual feedback styling</li>
                                    <li>All interaction flows auto-cleanup callbacks to prevent memory leaks</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.55',
                    date: '2026-05-26',
                    content: `
                        <h4>Bug Fixes</h4>
                        <ul>
                            <li><strong>Photo Wall Optimization</strong>
                                <ul>
                                    <li>Optimized photo-wall-item pseudo-element visual effect, removed multi-layer gradient overlay to prevent users from perceiving multiple images</li>
                                    <li>Fixed photo wall alignment and rendering issues</li>
                                </ul>
                            </li>
                            <li><strong>Bug Fixes &amp; Performance</strong>
                                <ul>
                                    <li>Removed conflicting CSS animation ppTrackEnter to avoid timing conflicts with JS transform</li>
                                    <li>Added pre-positioning logic in openPhotoPreview to ensure overlay is positioned before becoming visible</li>
                                    <li>Fixed ppSortedPhotos album view being covered by other elements</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.54',
                    date: '2026-05-25',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>API Performance Optimization</strong>
                                <ul>
                                    <li>Optimized API response time to &lt;10ms</li>
                                </ul>
                            </li>
                            <li><strong>Zoom &amp; Gesture Optimization</strong>
                                <ul>
                                    <li>ppResetZoom fully resets pinch state to prevent cross-image residue</li>
                                    <li>Threshold &lt;10px for gesture recognition</li>
                                </ul>
                            </li>
                            <li><strong>Stability Fixes</strong>
                                <ul>
                                    <li>Safe localStorage getJSON with 5 retry mechanism</li>
                                    <li>Removed inline display:none from report dialog, unified CSS class control</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.53',
                    date: '2026-05-25',
                    content: `
                        <h4>Bug Fixes</h4>
                        <ul>
                            <li><strong>Closure Trap Fix</strong>
                                <ul>
                                    <li>IIFE wrapping ensures each image is independently bound and correctly loaded</li>
                                </ul>
                            </li>
                            <li><strong>Data Loading Optimization</strong>
                                <ul>
                                    <li>Optimized data query strategy to reduce response size</li>
                                    <li>Limited single fetch to 20 items for better performance</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.52',
                    date: '2026-05-25',
                    content: `
                        <h4>Bug Fixes</h4>
                        <ul>
                            <li><strong>Photo Wall Data Loss Fix</strong>
                                <ul>
                                    <li>Fixed data loss in features.js renderPhotoWall when switching to render.js</li>
                                    <li>Fixed render.js not being properly cleaned up after page switch</li>
                                    <li>Fixed features.js IIFE scope issues with formatPhotoTime and escapeHtml functions</li>
                                </ul>
                            </li>
                            <li><strong>Filter Sort Functionality Fix</strong>
                                <ul>
                                    <li>Fixed filter sort state persistence issues</li>
                                    <li>Fixed sort not resetting after filter switch</li>
                                    <li>Removed deprecated filter code</li>
                                </ul>
                            </li>
                            <li><strong>Fullscreen Preview Interaction Optimization</strong>
                                <ul>
                                    <li>Pinch-to-zoom: new ppApplyPinchTransformImmediate applies transform directly, skipping rAF delay</li>
                                    <li>Adaptive 120Hz/90Hz/60Hz refresh rate support</li>
                                    <li>Eliminated black screen on image switch: pre-decode + img.decode() ensures decoded display</li>
                                    <li>Optimized fullscreen preview gesture boundaries</li>
                                </ul>
                            </li>
                            <li><strong>Cross-module Interaction Fixes</strong>
                                <ul>
                                    <li>photo-wall.js initPhotoWindow exposed via window object, core.js adds typeof safety check</li>
                                    <li>preview.js prevents duplicate event binding for HTML elements</li>
                                    <li>Fixed photocurImg typo to curImg</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.51',
                    date: '2026-05-25',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>CSS Performance Optimization</strong>
                                <ul>
                                    <li>Enabled GPU hardware acceleration: backface-visibility: hidden + transform: translateZ(0) + will-change: transform</li>
                                    <li>Optimized large list rendering with DocumentFragment and Array.from</li>
                                    <li>Used requestAnimationFrame for smooth 120Hz/90Hz/60Hz adaptive frame rate</li>
                                    <li>Optimized viewport rendering strategy</li>
                                </ul>
                            </li>
                            <li><strong>Image Compression Optimization</strong>
                                <ul>
                                    <li>compressToMaxSize function: images &gt;10MB compressed to &lt;10MB with max 2560px dimension</li>
                                    <li>100MB images handled safely with size detection</li>
                                    <li>Threshold optimization: &gt;10MB triggers compression, &gt;50MB triggers warning</li>
                                    <li>Added fileSize + originalSize display for upload feedback</li>
                                    <li>Supabase storage limit of 2GB with 50MB per file, max 2GB total</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.50',
                    date: '2026-05-25',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Photo Wall Feature Enhancement</strong>
                                <ul>
                                    <li>Added sort by date, name, and popularity with instant response</li>
                                    <li>Fixed data loading and state management issues</li>
                                    <li>Added full-screen preview with transition animations</li>
                                </ul>
                            </li>
                            <li><strong>Interaction Optimization</strong>
                                <ul>
                                    <li>Fixed fullscreen preview single-tap exit and double-tap zoom conflict</li>
                                    <li>Removed unnecessary SVG icons for cleaner UI</li>
                                    <li>Added loading animation background for images</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.40',
                    date: '2026-05-24',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>UI Visual Optimization</strong>
                                <ul>
                                    <li>Bottom navigation bar frameless integration: removed background, border, shadow</li>
                                    <li>Optimized glass-morphism effects for consistency</li>
                                </ul>
                            </li>
                            <li><strong>Photo Wall Slider Enhancement</strong>
                                <ul>
                                    <li>Added boundary handling: first image can't swipe left, last can't swipe right</li>
                                    <li>Fixed transition flash and position jump bugs</li>
                                    <li>Optimized pinch-to-zoom by removing rAF delay</li>
                                    <li>Used will-change and transition for smooth animations</li>
                                </ul>
                            </li>
                            <li><strong>Responsive Adaptation</strong>
                                <ul>
                                    <li>768px+ layout adjustments for tablets</li>
                                    <li>1024px+ layout for small desktops</li>
                                    <li>1280px+ layout for large screens</li>
                                    <li>Ensured consistent experience across devices</li>
                                </ul>
                            </li>
                            <li><strong>Code Cleanup</strong>
                                <ul>
                                    <li>Removed i18n and Translations dependencies</li>
                                    <li>Simplified syncProfileUser and related functions</li>
                                    <li>Cleaned up profile-lang-tabs CSS</li>
                                </ul>
                            </li>
                            <li><strong>Bug Fixes</strong>
                                <ul>
                                    <li>Fixed image lazy loading issues</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.38',
                    date: '2026-05-18',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Removed IELTS Vocabulary System</strong>
                                <ul>
                                    <li>Completely removed all IELTS vocabulary learning system code (CSS, JS, HTML)</li>
                                    <li>Deleted related deprecated function calls</li>
                                    <li>Cleaned up residual global variables and event listeners</li>
                                    <li>Fixed scroll handler for tab-container</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.37',
                    date: '2026-05-18',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>IELTS Vocabulary Page Enhancement</strong>
                                <ul>
                                    <li>Redesigned panelAi with clean HTML structure</li>
                                    <li>Word images converted to base64 for localStorage storage (under 5MB limit)</li>
                                    <li>Added grid-template-columns: repeat(5, 1fr) for responsive layout</li>
                                    <li>Optimized hover and interaction animations</li>
                                    <li>Fixed image lazyload boundary conditions</li>
                                    <li>Preview displays author, publish time, and view count</li>
                                    <li>Photos sorted by upload time (newest first) with smart time formatting</li>
                                    <li>Added CSS styling for consistent visual appearance</li>
                                    <li>General interaction and display improvements</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.36',
                    date: '2026-05-13',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Ultimate Liquid Glass Effect</strong>
                                <ul>
                                    <li>Fixed all backdrop-filter compatibility issues across browsers</li>
                                    <li>Lock-panel and overlay glass effects perfected</li>
                                    <li>Cards, options, and feedback panels all have premium glass quality</li>
                                    <li>Optimized frosted glass overlay stacking</li>
                                    <li>Fixed docab-scroll glass scrollbar styling</li>
                                    <li>Dark mode synchronized with deep gradient backgrounds</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.35',
                    date: '2026-05-13',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Audio System Fixes</strong>
                                <ul>
                                    <li>Fixed AudioContext being suspended by browser causing no sound (added resume() on interaction)</li>
                                    <li>Fixed audio playback state display using min 0.1 / max 1.8 triangle wave</li>
                                    <li>Auto-unlock audio on first page click</li>
                                </ul>
                            </li>
                            <li><strong>Continue Button Position Fix</strong>
                                <ul>
                                    <li>Adjusted layout from 16px to 10px spacing</li>
                                    <li>Updated flex layout from 0px to 16px for consistent alignment</li>
                                </ul>
                            </li>
                            <li><strong>Glass Effect Enhancement</strong>
                                <ul>
                                    <li>Cards: rgba 0.85 + blur(32px) saturate(220%)</li>
                                    <li>Options: rgba 0.72 + blur(16px) saturate(180%)</li>
                                    <li>Feedback: rgba 0.82 + blur(30px) saturate(220%)</li>
                                    <li>Dark mode synchronized enhancement</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.34',
                    date: '2026-05-13',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Learning System Enhancement</strong>
                                <ul>
                                    <li>Fixed continue button position issue, feedback moved to bottom</li>
                                    <li>Added audio feedback for correct/wrong answers</li>
                                    <li>Optimized Web Audio API for English speech/Chinese voice</li>
                                    <li>Fixed memory leak in audio resource management</li>
                                    <li>Enhanced glass effect: background transparency to 0.78, blur to 26px</li>
                                    <li>Fixed theme switch causing 100% CPU usage</li>
                                </ul>
                            </li>
                            <li><strong>TTS Voice Further Optimization</strong>
                                <ul>
                                    <li>Replaced Google TTS with browser native speech synthesis</li>
                                    <li>Google TTS rate 0.9/native rate 1.0 switched to Google 0.95/native 1.1</li>
                                    <li>TTS settings now persisted in localStorage for user preference</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.33',
                    date: '2026-05-13',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>IELTS Vocabulary Redesign</strong>
                                <ul>
                                    <li>Layout redesigned in clean word card style, white background without floating effects</li>
                                    <li>TTS voice optimization, auto-selects most natural English voice</li>
                                    <li>Added error count tracking (localStorage persisted) with accuracy progress bar</li>
                                    <li>Added learn-again/view-answers toggle functionality</li>
                                    <li>Grade 2 vocabulary display with footer statistics</li>
                                </ul>
                            </li>
                            <li><strong>Code Cleanup</strong>
                                <ul>
                                    <li>Removed toggleAIChat function</li>
                                    <li>Removed AI welcome messages and related CSS</li>
                                    <li>Removed Taylor Swift gallery initialization</li>
                                </ul>
                            </li>
                            <li><strong>Git Conflict Fix</strong>
                                <ul>
                                    <li>Fixed git merge conflicts across all file types</li>
                                </ul>
                            </li>
                            <li><strong>IELTS Vocabulary Glass Style Redesign</strong>
                                <ul>
                                    <li>Used emoji/SVG icons for visual enhancement</li>
                                    <li>TTS rate optimized to 0.85-1.05 range</li>
                                    <li>Removed example sentence reading, only reads words</li>
                                    <li>Added backdrop-filter glass effect</li>
                                    <li>Grade 2 vocabulary section redesign</li>
                                    <li>Score number click elastic animation</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.32',
                    date: '2026-05-12',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>IELTS Vocabulary Upgrade</strong>
                                <ul>
                                    <li>Full IELTS word bank upgrade with academic classification</li>
                                    <li>Added 3000+ core IELTS vocabulary entries</li>
                                    <li>From abandon to yield, complete A-Z coverage</li>
                                    <li>Each word includes standard phonetic, English examples and Chinese translations</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.31',
                    date: '2026-05-12',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Taylor Swift &amp; Jennie Feature Replaced with IELTS Vocabulary Learning System</strong>
                                <ul>
                                    <li>Deleted all original feature page CSS styles (idol-, ts- prefix styles)</li>
                                    <li>Added complete IELTS vocabulary learning system styles (.vocab- namespace)</li>
                                    <li>Replaced panelAi content with vocabulary learning interface</li>
                                    <li>Added 200 core IELTS words with phonetics, definitions, and examples</li>
                                </ul>
                            </li>
                            <li><strong>IELTS Vocabulary Learning Features</strong>
                                <ul>
                                    <li>Dual mode learning: English-to-Chinese and Chinese-to-English</li>
                                    <li>Click speaker button to pronounce English words</li>
                                    <li>Auto-read words and English sentences after answering</li>
                                    <li>Random 4 options generated each time</li>
                                    <li>Correct answer highlighted in green, wrong answer in red with shake</li>
                                    <li>Detailed explanations and example sentences after answering</li>
                                    <li>Full dark/light theme support</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.30',
                    date: '2026-05-03 16:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li><strong>Taylor Swift Feature Complete Removal</strong>
                                <ul>
                                    <li>Deleted all .ts- prefix CSS styles</li>
                                    <li>Added new .idol- namespace styles for replacement</li>
                                    <li>Introduced Google Fonts Great Vibes handwriting font</li>
                                    <li>Album cards with hover zoom and glass overlay effect</li>
                                    <li>SVG decorative elements for visual enhancement</li>
                                </ul>
                            </li>
                            <li><strong>Feature Replacement</strong>
                                <ul>
                                    <li>Removed Taylor Swift JavaScript code</li>
                                    <li>Updated dock configuration with new switchDockTab function</li>
                                    <li>Complete feature replacement</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.29',
                    date: '2026-05-03 15:30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Taylor Swift feature page interaction upgrade</li>
                            <ul>
                                <li>SVG decorative elements with hover animations</li>
                                <li>12 album cards with hover preview effects</li>
                                <li>Each album supports click to detail page</li>
                                <li>Album detail page with cover, era photos, album story, track list, and background</li>
                                <li>Album covers and detail photos with floating animation</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.28',
                    date: '2026-05-03 15:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Taylor Swift feature page redesign with 12 album showcase</li>
                            <ul>
                                <li>Added evermore, Midnights, The Tortured Poets Department, The Life of a Showgirl</li>
                                <li>Taylor Swift SVG decorative elements with album-specific designs</li>
                                <li>Album cards with real covers, poster-style layout, fade-in and pause transitions</li>
                                <li>Added gradient backgrounds and subtle hover effects</li>
                            </ul>
                            <li>Version number updated to v0.0.28</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.27',
                    date: '2026-05-03 14:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>AI chat completely replaced with Taylor Swift feature gallery</li>
                            <ul>
                                <li>DeepSeek AI replaced with Taylor Swift themed interface</li>
                                <li>Added Taylor Swift SVG decorative elements</li>
                                <li>8 album cards from Debut to folklore</li>
                                <li>Gradient backgrounds and album-specific icons</li>
                            </ul>
                            <li>Fixed known bugs and improved stability</li>
                            <li>Fixed page crash under certain conditions</li>
                            <li>Cleaned up unused code</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed iOS Safari compatibility issues</li>
                            <li>Fixed iOS dynamic island/notch area visual adaptation</li>
                            <li>Fixed login time not updating</li>
                            <li>Fixed various UI display bugs</li>
                            <li>Optimized iOS Safari scroll performance</li>
                            <li>Fixed Toast notification display on iOS</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Updated version number display in the version changelog system</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed avatar URL handling with actor_key=__avatar__ fallback</li>
                            <li>Fixed position:fixed rendering issues in certain scenarios</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed data fetching bugs with JSON content parsing</li>
                            <li>Fixed data query optimization with limit(1) + maybeSingle pattern</li>
                            <li>Fixed fetch limit from 1000 to 20 for better performance</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed avatar loading in loadAvatarsForUsers function</li>
                            <li>Fixed touch-action interaction issues</li>
                            <li>Fixed html/body overflow:hidden scroll lock</li>
                            <li>Fixed various UI and interaction bugs</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed avatar auto-revert bug (localStorage priority, DB no longer overrides)</li>
                            <li>Optimized navigation bar interaction</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed data fetch errors in admin panel</li>
                            <li>Chat list background preloading for instant open</li>
                            <li>Removed post list right-side scrollbar</li>
                            <li>Fixed interaction state consistency issues</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.19',
                    date: '2026-05-03 09:10',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed avatar reversion on page refresh</li>
                            <li>Optimized avatar compression to 80x80 @0.4 quality</li>
                            <li>Fixed avatar not updating after change</li>
                            <li>Redesigned post swipe animation: fade-in+up, fade-out+down</li>
                            <li>Removed post and comment hover effects</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.18',
                    date: '2026-05-03 08:30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Fixed various bugs and optimized performance</li>
                            <li>Removed black border on bottom navigation bar click</li>
                            <li>Optimized image loading performance</li>
                            <li>Fixed various UI interaction bugs</li>
                            <li>Optimized avatar resolution to 128x128</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.17',
                    date: '2026-05-02 17:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Animation effect reduction optimization</li>
                            <ul>
                                <li>Reduced transition translateY animation amplitude</li>
                                <li>All button hover animations halved (except bottom nav)</li>
                                <li>Includes hover float, zoom, and rotation animations</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.16',
                    date: '2026-05-02 16:53',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Avatar click behavior optimization</li>
                            <ul>
                                <li>Clicking avatars in posts and comments no longer directly navigates to chat</li>
                                <li>Added user profile card popup showing avatar, name, and last login</li>
                                <li>Optimized user profile card layout</li>
                            </ul>
                            <li>Chat interface optimization</li>
                            <ul>
                                <li>Optimized chat list rendering performance</li>
                                <li>Fixed scroll position memory</li>
                            </ul>
                            <li>Chat avatar display</li>
                            <ul>
                                <li>Display real avatars in chat contact list</li>
                                <li>AI conversations show user real avatars</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.15',
                    date: '2026-05-02 16:30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Avatar upload compression optimization</li>
                            <ul>
                                <li>Compressed to 256x256 JPEG at quality 0.7</li>
                                <li>Significantly reduced base64 size to prevent storage overflow</li>
                                <li>Kept file size under 5MB limit</li>
                            </ul>
                            <li>Login time tracking fix</li>
                            <ul>
                                <li>Fixed saveUserInfo to properly record login time</li>
                                <li>Auto fallback to delete+insert on update failure</li>
                                <li>Admin login also correctly records login time</li>
                                <li>Fixed delete policy issues with RLS</li>
                            </ul>
                            <li>SQL policy fix</li>
                            <ul>
                                <li>Fixed fix_user_info_rls.sql for UPDATE/DELETE policies</li>
                                <li>Fixed actor_key to content handling</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.14',
                    date: '2026-05-02 16:20',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Avatar compression and storage optimization</li>
                            <ul>
                                <li>Fixed avatar compression failure when base64 is too large</li>
                                <li>Fixed avatar base64 localStorage storage overflow</li>
                                <li>Fixed avatar display showing blank after compression</li>
                                <li>Fixed avatar not displaying after page switch</li>
                                <li>Optimized data query by excluding avatar records</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.13',
                    date: '2026-05-02 14:58',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Avatar system fixes</li>
                            <ul>
                                <li>Fixed avatar compression rendering failures</li>
                                <li>Fixed avatar cross-page persistence issues</li>
                                <li>Avatar compression uses canvas with max size limit</li>
                                <li>Updated avatar cache mechanism for correct display</li>
                            </ul>
                            <li>Interaction optimization</li>
                            <ul>
                                <li>Optimized interaction delay for better user experience</li>
                                <li>Improved UI feedback responsiveness</li>
                            </ul>
                            <li>User registration fix</li>
                            <ul>
                                <li>Fixed data loading failures in user management</li>
                            </ul>
                            <li>Login time fix</li>
                            <ul>
                                <li>Fixed user registration and login time saving, added actor_key for correct data writing</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.12',
                    date: '2026-05-02 01:00',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>New message notification feature</li>
                            <ul>
                                <li>Real-time notification popup for new messages</li>
                                <li>Notification auto-dismiss after delay</li>
                                <li>Toast notification animation effects</li>
                                <li>Click notification to jump to corresponding chat</li>
                                <li>Smart detection: no duplicate notification if already in chat</li>
                            </ul>
                            <li>Admin panel fixes</li>
                            <ul>
                                <li>Fixed admin panel display issues</li>
                                <li>Ensure all registered users display correctly in admin panel</li>
                            </ul>
                            <li>Chat interface optimization</li>
                            <ul>
                                <li>Fixed chat not scrolling to bottom</li>
                                <li>Improved message display layout</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.11',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Avatar system upgrade</li>
                            <ul>
                                <li>Added avatar upload with canvas compression and base64 storage in DB</li>
                                <li>Compressed to under 5MB for optimal storage</li>
                                <li>Posts and comments display user custom avatars</li>
                                <li>Profile page added logout button</li>
                            </ul>
                            <li>Interaction optimization</li>
                            <ul>
                                <li>Fixed like/unlike state toggle inconsistency</li>
                                <li>Post area auto-hidden when not logged in</li>
                                <li>Fixed interaction state update delays</li>
                            </ul>
                            <li>User registration fix</li>
                            <ul>
                                <li>Fixed data loading failures in user management</li>
                            </ul>
                            <li>Admin panel enhancement</li>
                            <ul>
                                <li>Added user registration time and last login time display</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.10',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>New "My Profile" page</li>
                            <ul>
                                <li>User info and avatar display</li>
                                <li>Post history view</li>
                                <li>Notification settings</li>
                                <li>Theme switching support</li>
                                <li>Logout functionality</li>
                            </ul>
                            <li>Enhanced bottom navigation bar</li>
                            <ul>
                                <li>Click effect with colored light burst animation</li>
                            </ul>
                            <li>Bottom navigation optimization</li>
                            <ul>
                                <li>AI button repositioned</li>
                                <li>Standardized button sizes</li>
                                <li>Improved visual balance</li>
                            </ul>
                            <li>AI chat interface upgrade</li>
                            <ul>
                                <li>Redesigned AI chat UI with SVG icons</li>
                                <li>Flash switch button changed to SVG icon</li>
                                <li>Optimized transition animations</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.9',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Announcement system enhancement</li>
                            <ul>
                                <li>Admin can choose to input title and content when publishing (optional, at least one required)</li>
                                <li>Added announcement detail view</li>
                                <li>Announcement list supports title + content preview</li>
                                <li>Admin announcement list shows title and author</li>
                                <li>Admin panel added title input field</li>
                                <li>Dark/light theme adaptation</li>
                                <li>Optimized announcement switching and interaction</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.8',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Announcement system visual and interaction optimization</li>
                            <ul>
                                <li>Changed announcement modal to white frosted glass style matching the main feed</li>
                                <li>Added close button for announcement detail view</li>
                                <li>Fixed announcement detail page layout and delete button position</li>
                                <li>Dark mode fully aligned with main feed style</li>
                            </ul>
                            <li>AI chat visual enhancement</li>
                            <ul>
                                <li>AI loading effect redesigned with SVG</li>
                                <li>AI icon updated to new visual style</li>
                                <li>AI first-time greeting with smooth fade-in animation</li>
                                <li>Optimized AI response display layout</li>
                            </ul>
                            <li>Dark mode adaptation</li>
                            <ul>
                                <li>Announcement system dark mode fully consistent with main feed</li>
                                <li>All elements support theme auto-switching</li>
                            </ul>
                            <li>Interaction optimization</li>
                            <ul>
                                <li>Optimized animation performance with will-change</li>
                                <li>Improved event handling logic</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.7',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Added announcement system</li>
                            <ul>
                                <li>Announcement modal with scrolling support</li>
                                <li>Optimized announcement display order</li>
                                <li>Announcement list with auto-refresh</li>
                                <li>Admin announcement publish and delete permissions</li>
                            </ul>
                            <li>Added glass effect styling</li>
                            <ul>
                                <li>Frosted glass background effects</li>
                                <li>Announcement glass style integration</li>
                                <li>Responsive glass element design</li>
                            </ul>
                            <li>Announcement data fully integrated with main app</li>
                            <li>Optimized responsive layout across devices</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Interaction and UI optimization</li>
                            <ul>
                                <li>Removed duplicate chat entry point</li>
                                <li>Optimized Dock interaction animations</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.5',
                    date: '2026-04-30',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Three core feature button SVG animation optimization</li>
                            <ul>
                                <li>Redesigned button SVG animation effects</li>
                                <li>Redesigned chat button bubble animation</li>
                                <li>AI button interaction animation optimization</li>
                                <li>All animations support external area display</li>
                                <li>Optimized CSS @keyframes performance</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.4',
                    date: '2026-04-29',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Core interaction button SVG animation optimization</li>
                            <ul>
                                <li>Button animation duration adjusted to 0.5s</li>
                                <li>AI button animation delay adjusted to 0s</li>
                                <li>AI interaction button delay adjusted to 0.8s</li>
                                <li>Used stroke-dasharray/dashoffset for line drawing</li>
                                <li>CSS animation optimization for smooth performance</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.3',
                    date: '2026-04-28',
                    content: `
                        <h4>Bug Fixes &amp; Improvements</h4>
                        <ul>
                            <li>Initial version - core framework setup</li>
                            <li>User authentication system</li>
                            <li>Post publish and browse functionality</li>
                            <li>Comment and like features</li>
                            <li>Image upload functionality</li>
                            <li>AI chat functionality</li>
                            <li>Dark/light theme support</li>
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
                            <div class="changelog-version">猸?${item.version}</div>
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

            // 缁戝畾鍏憡鎸夐挳浜嬶拷??
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
            /* ORIGINAL CODE DISABLED - superseded by features.js
            const pairs = [
                ['鐎规瓕灏?', '宸茶'],
                ['闁哄牜浜ｉ?', '鏈'],
                ['闁稿繈鍔戦崕瀵告暜閺嵮呮憤', '鍏ㄩ儴甯栧瓙'],
                ['濞屸剝婀佹壘鍒伴惄锟?鍙у笘瀛?, '娌℃湁鎵惧埌鐩稿叧甯栧瓙'],
                ['缁绢収鍠涢濠氬箼瀹ュ嫮绋?, '纭鎿嶄綔'],
                ['纭畾瑕佹墽琛屾鎿嶄綔鍚楋拷??', '纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵'],
                ['缁绢収鍠涢?', '纭'],
                ['婵炴垵鐗婃导?', '娑堟伅'],
                ['闁稿浚鍓欓幉?', '鍏憡'],
                ['涓婁紶澶辫触锛岃閲嶈瘯', '涓婁紶澶辫触锛岃閲嶈瘯'],
                ['鏃犳潈缃《杩欐潯甯栵拷??', '鏃犳潈缃《杩欐潯甯栧瓙'],
                ['缂傚喚鍣ｉ妴濠囧箼瀹ュ嫮绋婂鎯扮簿鐟?', '缃《鎿嶄綔澶辫触'],
                ['闁哄牜浜為悡锟犳煥濞嗘帩鍤?, '鏈煡閿欒'],
                ['缃戠粶閿欒', '缃戠粶閿欒'],
                ['姝ｅ湪鍒锋柊鐓х墖??..', '姝ｅ湪鍒锋柊鐓х墖澧?.'],
                ['闁告瑦鍨电粩鐑藉箣閹邦剙顫?, '鍙戝竷鎴愬姛'],
                ['鍒犻櫎锟筋剙锟?', '鍒犻櫎鍏憡'],
                ['闁稿浚鍓欓幉锟犲矗閹存繄顏撮柟瀛樺姇婵?', '鍏憡鍙戝竷鎴愬姛'],
                ['闁告瑦鍨块埀顑跨閵囨垹鎷?', '鍙戦€佸け璐?],
                ['鍔熻兘浼樺寲', '鍔熻兘浼樺寲'],
                ['Bug濞ｅ浂鍠栭ˇ?', 'Bug淇'],
                ['閺傛澘锟?', '鏂板'],
                ['鏀硅繘', '鏀硅繘'],
                ['濞达絾鎸风槐?', '浣撻獙'],
                ['閻犲鍟弳?', '璋冩暣'],
                ['绛涳拷??', '??'],
                ['鎺т欢', '鎺т欢'],
                ['闁硅埖锚瑜?', '鎶樺彔'],
                ['闂堛垺锟?', '闈㈡澘'],
                ['鏁板窘锟?, '寰界珷'],
                ['婵炲弶妲掔粚?', '娲昏穬'],
                ['闁衡偓椤栨稑鐦?, '鏀寔'],
                ['濡炪倗鏁诲?', '椤甸潰'],
                ['閺夆晜鏌ㄥú?', '杩斿洖'],
                ['闁轰胶澧楀畵?', '鏁版嵁'],
                ['閻熸瑱绠戣ぐ?', '瑙﹀彂'],
                ['濡澘瀚～?', '棰勮'],
                ['缂傚喚鍣ｃ€?, '缃《'],
                ['闁告梻濮惧ù?', '鍔犺浇'],
                ['涓婏拷锟?', '涓婁紶'],
                ['濞ｅ洦绻傞悺?', '淇濆瓨'],
                ['鍒狅拷锟?', '鍒犻櫎'],
                ['缂傛牞锟?', '缂栬緫'],
                ['闁哄洤鐡ㄩ弻?', '鏇存柊'],
                ['闁绘挆鍛暬', '鐓х墖'],
                ['闁告瑦鍨块埀?', '鍙戦€?],
                ['濠㈡儼绮剧憴?', '澶辫触'],
                ['闁瑰瓨鍔曟慨?', '鎴愬姛'],
                ['闂佹寧鐟ㄩ?', '閿欒'],
                ['閻╋拷?锟?', '鐩稿叧'],
                ['缂冩垹锟?', '缃戠粶'],
                ['鐎癸拷顦崣?', '瀹夊叏'],
                ['濞ｅ浂鍠栭ˇ?', '淇'],
                ['濞存粍甯掓慨?', '浜掑姩'],
                ['甯栵拷锟?', '甯栧瓙'],
                ['闁活潿鍔嶉崺?', '鐢ㄦ埛'],
                ['闁告劕鎳庨?', '鍐呭'],
                ['鎸夛拷锟?', '鎸夐挳'],
                ['涓撅拷锟?', '涓炬姤'],
                ['缁夛拷顭峰▍?', '绉婚櫎'],
                ['婵炴挸鎳愰幃?', '娓呯悊'],
                ['闁告挸绉堕?', '鍓嶇'],
                ['婵炲牆顑囬弳鈧?, '娈嬬暀'],
                ['濡€崇础', '模式'],
                ['濞寸媴绲块悥?', '浠ｇ爜'],
                ['閻犲浂鍙€閳?', '璇█'],
                ['婵炵繝鑳堕埢?', '娴佺▼'],
                ['闁告帒妫旈棅?', '鍒嗕韩'],
                ['闁哄棙顨夋竟?', '鏆楄壊'],
                ['涓伙拷锟?', '涓婚'],
                ['濡炪倗顢婃竟?', '棰滆壊'],
                ['濡増绮忔竟?', '棰滆壊'],
                ['濞ｅ洠鈧啿濞?, '淇″彿'],
                ['鐎殿喖鍊?, '寮傚父'],
                ['濠㈣泛瀚幃?', '澶勭悊'],
                ['閳?', '鉂わ笍'],
            ];

            function repairString(value) {
                if (typeof value !== 'string' || !value) return value;
                let next = value;
                for (const [from, to] of pairs) {
                    if (next.includes(from)) next = next.split(from).join(to);
                }
                return next;
            }

            function repairNode(node) {
                if (!node) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    const fixed = repairString(node.nodeValue);
                    if (fixed !== node.nodeValue) node.nodeValue = fixed;
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;

                ['title', 'aria-label', 'placeholder', 'alt', 'value', 'data-button-label', 'data-busy-label', 'data-default-label'].forEach(function(attr) {
                    if (node.hasAttribute && node.hasAttribute(attr)) {
                        const current = node.getAttribute(attr);
                        const fixed = repairString(current);
                        if (fixed !== current) node.setAttribute(attr, fixed);
                    }
                });

                for (const child of Array.from(node.childNodes || [])) {
                    repairNode(child);
                }
            }

            let repairQueued = false;
            let queuedRoots = [];
            function scheduleRepair(root) {
                queuedRoots.push(root || document.body);
                if (repairQueued) return;
                repairQueued = true;
                requestAnimationFrame(function() {
                    repairQueued = false;
                    const roots = queuedRoots.length ? queuedRoots.splice(0) : [document.body];
                    roots.forEach(function(target) {
                        repairNode(target || document.body);
                    });
                });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    repairNode(document.body);
                    scheduleRepair(document.body);
                }, { once: true });
            } else {
                repairNode(document.body);
            }

            const observer = new MutationObserver(function(records) {
                for (const record of records) {
                    if (record.type === 'characterData') {
                        scheduleRepair(record.target);
                        continue;
                    }
                    if (record.type === 'attributes') {
                        scheduleRepair(record.target);
                        continue;
                    }
                    for (const node of Array.from(record.addedNodes || [])) {
                        if (node && (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE)) {
                            scheduleRepair(node);
                        }
                    }
                }
            });

            observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['title', 'aria-label', 'placeholder', 'alt', 'value', 'data-button-label', 'data-busy-label', 'data-default-label']
            });

            window.__xtjUiTextRepair = repairNode;
            window.__xtjUiTextRepairStop = function() {
                observer.disconnect();
                repairQueued = false;
                queuedRoots = [];
            };
            */
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

            var springLoaderHtml = '<div class="xtj-magic-loading" role="status" aria-live="polite"><div class="spring-loader" aria-label="鏄ユ棩钘よ敁铦磋澏鍔犺浇鍔ㄧ敾"><canvas class="spring-canvas" width="220" height="220" aria-hidden="true"></canvas></div></div>';

            window.xtjMagicLoadingHtml = function() {
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
                    if (feed && /loading-spinner|loading-text|鍐呭鍔犺浇涓?../.test(feed.innerHTML || '')) {
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
                    if (el && (el.querySelector('.chat-empty') || /鍔犺浇涓?../.test(el.textContent || ''))) {
                        renderChatLoadingState(el, { title: '鍔犺浇涓?..', variant: 'chat-detail' });
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
                    if (body && /loading-spinner|loading-text|鍔犺浇涓?../.test(body.innerHTML || '')) {
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
                    if (body && /loading-spinner|loading-text|鍔犺浇涓?../.test(body.innerHTML || '')) {
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

            function statPostDetailMarkup(post, likes, comments) {
                var vc = (post.views || 0) + 1;
                var normalizedPost = normalizePost(post);
                var detailMediaAttrs = [
                    'data-post-id="' + escapeHtml(String(post.id || "")) + '"',
                    'data-media-url="' + escapeHtml(String(post.media_url || "")) + '"',
                    'data-post-user="' + escapeHtml(String(post.user_name || "")) + '"',
                    'data-post-created-at="' + escapeHtml(String(post.created_at || "")) + '"',
                    'data-post-views="' + escapeHtml(String(post.views || 0)) + '"',
                    'data-file-size="' + escapeHtml(String((normalizedPost._contentMeta && normalizedPost._contentMeta.fileSize) || "")) + '"',
                    'data-original-size="' + escapeHtml(String((normalizedPost._contentMeta && normalizedPost._contentMeta.originalSize) || "")) + '"'
                ].join(" ");
                var mediaHtml = post.media_url ? (
                    post.media_type === 'video'
                        ? '<video src="' + escapeHtml(post.media_url) + '" controls preload="none"></video>'
                        : '<img ' + detailMediaAttrs + ' src="' + escapeHtml(post.media_url) + '" onclick="openImageViewer(\'' + safeJsStr(post.media_url) + '\')" loading="lazy" />'
                ) : '';
                var canEdit = canEditPost(post);
                var canDel = canEdit && (post.actor_key === deviceId || post.actor_key === currentUser || isAdmin());
                var detailActions = [];
                if (canPinPost(post)) {
                    detailActions.push('<button type="button" class="action-btn pin" data-post-id="' + escapeHtml(String(post.id)) + '">' + (normalizePost(post).is_pinned ? '鍙栨秷缃《' : '缃《') + '</button>');
                }
                if (canEdit) {
                }
                if (canDel) {
                    detailActions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + String(post.id).replace(/'/g, "\\'") + '\', \'' + String(post.actor_key || "").replace(/'/g, "\\'") + '\')">鍒犻櫎</button>');
                }
                return [
                    '<div class="post-detail-header"><div class="pdh-left">',
                    '<div class="pdh-name">' + escapeHtml(post.user_name) + '</div>',
                    '<div class="pdh-time">' + new Date(post.created_at).toLocaleString() + '</div>',
                    '</div>',
                    '<div class="pdh-badges">' + buildPostBadges(post) + '</div>',
                    '</div>',
                    post.content ? '<div class="post-detail-content">' + escapeHtml(post.content) + '</div>' : '',
                    mediaHtml ? '<div class="post-detail-media">' + mediaHtml + '</div>' : '',
                    detailActions.length ? '<div class="post-detail-actions">' + detailActions.join("") + '</div>' : '',
                    '<div class="post-detail-stats">娴忚 ' + vc + ' 娆÷?鐐硅禐 ' + likes.length + ' 娆÷?璇勮 ' + comments.length + ' 娆?/div>',
                    '<div class="stat-two-col">',
                    '<div class="stat-col"><div class="stat-section-title">鉁?鐐硅禐鐢ㄦ埛 ' + likes.length + '</div>' +
                        (likes.length ? likes.map(function(l) {
                            return '<div class="stat-like-item"><div class="sli-info"><div class="sli-user">' + escapeHtml(l.user_name) + '</div></div><span class="sli-time">' + new Date(l.created_at).toLocaleString() + '</span></div>';
                        }).join('') : '<div class="stat-empty" style="padding:12px 0;">鏆傛棤鐐硅禐</div>') +
                    '</div>',
                    '<div class="stat-col"><div class="stat-section-title">馃挰 璇勮鐢ㄦ埛 ' + comments.length + '</div>' +
                        (comments.length ? comments.map(function(c) {
                            return '<div class="stat-comment-item"><div class="sci-info"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><div class="sci-target">' + escapeHtml(c.content) + '</div></div><span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span></div>';
                        }).join('') : '<div class="stat-empty" style="padding:12px 0;">鏆傛棤璇勮</div>') +
                    '</div>',
                    '</div>'
                ].join('');
            }

            renderPostDetail = function(post, likes, comments) {
                var body = document.getElementById('postDetailBody');
                if (!body) return;
                body.innerHTML = statPostDetailMarkup(post, likes, comments);
                var statsEl = body.querySelector('.post-detail-stats');
                if (statsEl) {
                    statsEl.innerHTML = buildPostStatsLine(post, (likes || []).length, (comments || []).length);
                }
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
                if (post.media_type === 'image') return '鍥剧墖鍔ㄦ€?;
                if (post.media_type === 'video') return '瑙嗛鍔ㄦ€?;
                return '鏃犳枃瀛楀唴瀹?;
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
                    '<div class="stat-empty-title">' + escapeHtml(opts.title || '鏆傛棤鏁版嵁') + '</div>',
                    opts.copy ? '<div class="stat-empty-copy">' + escapeHtml(opts.copy) + '</div>' : '',
                    opts.note ? '<div class="stat-empty-note">' + escapeHtml(opts.note) + '</div>' : '',
                    '</div>'
                ].join('');
            }

            function statPostItemMarkup(post) {
                var text = post.content || '';
                var hasImg = post.media_url && post.media_type === 'image';
                var hasVid = post.media_url && post.media_type === 'video';
                var tag = hasImg ? '<span class="spi-img-tag">馃摲 鍥剧墖</span>' : (hasVid ? '<span class="spi-img-tag">馃幀 瑙嗛</span>' : '');
                var summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                var display = summary || (hasImg ? '涓€寮犲浘鐗? : hasVid ? '涓€涓棰? : '(鏃犲唴瀹?');
                var onclick = "openPostDetail('" + String(post.id).replace(/'/g, "\\'") + "')";
                return [
                    '<div class="stat-post-item">',
                    '<span class="spi-content" onclick="' + onclick + '" title="鐐瑰嚮鏌ョ湅甯栧瓙璇︽儏">' + escapeHtml(display) + tag + '</span>',
                    hasImg ? '<img class="spi-thumb" src="' + escapeHtml(post.media_url) + '" onclick="' + onclick + '" title="鐐瑰嚮鏌ョ湅甯栧瓙璇︽儏" />' : '',
                    '<span class="spi-time">' + new Date(post.created_at).toLocaleString() + '</span>',
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
                    body.innerHTML = '<div class="stat-empty">鏆傛棤鍔ㄦ€佹暟鎹?/div>';
                    return;
                }
                body.innerHTML = entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    var moreButton = posts.length > 3
                        ? '<div style="text-align:center; padding:8px 0;"><button class="stat-view-btn" onclick="loadUserAllPosts(\'' + String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">鏌ョ湅鍏ㄩ儴 ' + posts.length + ' 鏉?/button></div>'
                        : '';
                    return [
                        '<div class="stat-user-group">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(name).slice(0, 1).toUpperCase() + '</div><span class="suh-name">' + escapeHtml(name) + '</span></div><span class="suh-count">' + posts.length + ' 鏉?/span></div>',
                        '<div class="stat-user-posts">',
                        posts.slice(0, 3).map(function(p) { return statPostItemMarkup(p); }).join(''),
                        moreButton,
                        '</div>',
                        '</div>'
                    ].join('');
                }).join('');
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = statAllPosts.filter(function(p) { return p.user_name === userName; });
                body.innerHTML = [
                    '<button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">鈫?杩斿洖鎬诲姩鎬?/button>',
                    '<div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">',
                    escapeHtml(userName) + ' 鐨勫叏閮ㄥ笘瀛愶紙' + userPosts.length + ' 鏉★級',
                    '</div>',
                    userPosts.map(function(p) { return statPostItemMarkup(p); }).join('')
                ].join('');
            };

            renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = getViewHistory();
                var postMap = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (post && post.id != null) postMap[String(post.id)] = post;
                });
                (Array.isArray(feedAllPosts) ? feedAllPosts : []).forEach(function(post) {
                    if (post && post.id != null && !postMap[String(post.id)]) postMap[String(post.id)] = post;
                });
                if (!history.length) {
                    body.innerHTML = [
                        '<div class="stat-empty">',
                        '<div style="font-size:16px; margin-bottom:8px;">浏览记录</div>',
                        '<div style="font-size:13px;">暂无浏览详情数据</div>',
                        '<div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录会在你查看帖子时自动保存</div>',
                        '<div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录总浏览：已加载</div>'
                    ].join('');
                    return;
                }
                body.innerHTML = history.map(function(v) {
                    var post = postMap[String(v.post_id)] || null;
                    var hasImg = !!(post && post.media_type === 'image' && post.media_url);
                    var hasVid = !!(post && post.media_type === 'video' && post.media_url);
                    var onclick = post ? ' onclick="openPostDetail(\'' + String(post.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\'')"' : '';
                    var mediaHtml = hasImg
                        ? '<img class="stat-record-thumb" src="' + escapeHtml(post.media_url) + '" alt="" loading="lazy"' + onclick + ' />'
                        : (hasVid ? '<div class="stat-record-thumb stat-record-thumb--video"' + onclick + '>视频</div>' : '');
                    return [
                        '<article class="stat-view-item">',
                        '<div class="stat-view-layout">',
                        mediaHtml,
                        '<div class="svi-info">',
                        '<div class="stat-record-head"><div class="svi-user">' + escapeHtml(v.user_name) + '</div><span class="svi-time">' + new Date(v.viewed_at).toLocaleString() + '</span></div>',
                        '<div class="svi-target">浏览了 <b>' + escapeHtml(v.post_author) + '</b> 的帖子：' + escapeHtml(v.post_content || '无文字内容') + '</div>',
                        '</div>',
                        '</div>',
                        '</article>'
                    ].join('');
                }).join('');
            };
            renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var postMap = {};
                statAllPosts.forEach(function(p) { postMap[p.id] = p; });

                function buildLikesCol() {
                    var h = '<div class="stat-section-title">点赞记录</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(function(l) {
                            var post = postMap[l.post_id];
                            var postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除帖子)';
                            return '<div class="stat-like-item"><div class="sli-info"><div class="sli-user">' + escapeHtml(l.user_name) + '</div><div class="sli-target">点赞了：' + postContent + '</div></div><span class="sli-time">' + new Date(l.created_at).toLocaleString() + '</span></div>';
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    var h = '<div class="stat-section-title">评论记录</div>';
                    if (statAllComments.length) {
                        h += statAllComments.slice().reverse().slice(0, 200).map(function(c) {
                            var post = postMap[c.post_id];
                            var postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除帖子)';
                            return '<div class="stat-comment-item"><div class="sci-info"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><div class="sci-target">评论了 ' + postContent + '：' + escapeHtml(c.content) + '</div></div><span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span></div>';
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
                    }
                    return h;
                }

                body.innerHTML = '<div class="stat-two-col"><div class="stat-col">' + buildLikesCol() + '</div><div class="stat-col">' + buildCommentsCol() + '</div></div>';
            };

            window.openPostDetail = async function(postId) {
                var title = document.getElementById('postDetailTitle');
                var body = document.getElementById('postDetailBody');
                var modal = document.getElementById('postDetailModal');
                if (title) title.textContent = '甯栧瓙璇︽儏';
                if (body) body.innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '鍔犺浇涓?..', 'feed');
                if (modal) modal.classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);
                    const post = normalizePost(postRes.data);
                    if (!post) {
                        if (body) body.innerHTML = '<div class="stat-empty">甯栧瓙涓嶅瓨鍦ㄦ垨宸插垹闄?/div>';
                        return;
                    }
                    if (!canViewPost(post)) {
                        if (body) body.innerHTML = '<div class="stat-empty">鏃犳潈鏌ョ湅杩欐潯甯栧瓙</div>';
                        return;
                    }
                    trackView(postId);
                    renderPostDetail(post, likeRes.data || [], commRes.data || []);
                } catch (e) {
                    if (body) body.innerHTML = '<div class="stat-empty">鍔犺浇澶辫触锛岃閲嶈瘯</div>';
                    console.error(e);
                }
            };

            window.openStatDetail = async function(type) {
                statCurrentType = type;
                var titles = {
                    posts: '鎬诲姩鎬? 鎸夌敤鎴峰垎缁?,
                    views: '鎬绘祻瑙? 娴忚璁板綍',
                    likes: '鐐硅禐鍜岃瘎璁? 璁板綍'
                };
                var title = document.getElementById('statModalTitle');
                var body = document.getElementById('statModalBody');
                var modal = document.getElementById('statModal');
                if (title) title.textContent = titles[type] || '缁熻璇︽儏';
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

                if (body) body.innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '鍔犺浇涓?..', 'feed');
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
                    if (body) body.innerHTML = '<div class="stat-empty">鍔犺浇澶辫触锛岃閲嶈瘯</div>';
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
                var title = options && options.title ? options.title : '鍔犺浇涓?..';
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
                    posts: '鎬诲姩鎬?- 鎸夌敤鎴峰垎缁?,
                    views: '鎬绘祻瑙?- 娴忚璁板綍',
                    likes: '鐐硅禐鍜岃瘎璁?- 璁板綍'
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

                if (body) body.innerHTML = window.xtjMagicLoadingHtml('鍔犺浇涓?..', '鍔犺浇涓?..', 'feed');
                var snapshot = await fetchStatSnapshotWithTimeout(5000);
                if (snapshot) {
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                    renderStatByType(type);
                } else if (body) {
                    body.innerHTML = '<div class="stat-empty">鏆傛棤鍙敤鏁版嵁</div>';
                }
                if (statPollTimer) clearInterval(statPollTimer);
                statPollTimer = setInterval(refreshStatModal, 15000);
            };
        })();

