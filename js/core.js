(function () {
// 注入魔法粒子加载器关键CSS，确保渲染前立即可用
(function(){if(document.getElementById('xtjMagicLoadingStyleEager'))return;var s=document.createElement('style');s.id='xtjMagicLoadingStyleEager';s.textContent='.xtj-magic-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;min-height:260px;padding:40px 20px;text-align:center;animation:mglFadeIn .35s ease-out}.xtj-magic-stage{position:relative;width:96px;height:96px;flex-shrink:0}.xtj-magic-core{position:absolute;top:50%;left:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,rgba(255,255,255,.95),rgba(167,243,208,.88) 55%,rgba(56,189,248,.65));box-shadow:0 0 18px rgba(123,213,255,.55),0 0 40px rgba(110,231,183,.28);animation:mglCorePulse 1.8s ease-in-out infinite}.xtj-magic-ring{position:absolute;top:50%;left:50%;border-radius:50%;border:1px solid transparent}.xtj-magic-ring:nth-of-type(1){width:52px;height:52px;margin:-26px 0 0 -26px;border-top-color:rgba(110,231,183,.45);animation:mglSpin 3.6s linear infinite}.xtj-magic-ring:nth-of-type(2){width:64px;height:64px;margin:-32px 0 0 -32px;border-bottom-color:rgba(255,227,154,.35);animation:mglSpinRev 5s linear infinite}.xtj-magic-particle{position:absolute;top:50%;left:50%;width:5px;height:5px;border-radius:50%}.xtj-magic-particle:nth-child(4){animation:mglParticleOrbit1 2.6s linear infinite;background:rgba(110,231,183,.9);box-shadow:0 0 6px rgba(110,231,183,.55)}.xtj-magic-particle:nth-child(5){animation:mglParticleOrbit1 2.6s linear infinite;animation-delay:-.65s;background:rgba(123,213,255,.85)}.xtj-magic-particle:nth-child(6){animation:mglParticleOrbit1 2.6s linear infinite;animation-delay:-1.3s;background:rgba(167,243,208,.88)}.xtj-magic-particle:nth-child(7){animation:mglParticleOrbit1 2.6s linear infinite;animation-delay:-1.95s;background:rgba(255,227,154,.82)}.xtj-magic-particle:nth-child(8){animation:mglParticleOrbit2 3.4s linear infinite;background:rgba(110,231,183,.85);width:4px;height:4px}.xtj-magic-particle:nth-child(9){animation:mglParticleOrbit2 3.4s linear infinite;animation-delay:-1.13s;background:rgba(181,156,255,.8);width:4px;height:4px}.xtj-magic-particle:nth-child(10){animation:mglParticleOrbit2 3.4s linear infinite;animation-delay:-2.27s;background:rgba(123,213,255,.82);width:4px;height:4px}.xtj-magic-particle:nth-child(11){animation:mglParticleOrbit3 4.8s linear infinite;background:rgba(255,227,154,.75);width:3px;height:3px}.xtj-magic-particle:nth-child(12){animation:mglParticleOrbit3 4.8s linear infinite;animation-delay:-2.4s;background:rgba(110,231,183,.78);width:3px;height:3px}.xtj-magic-text{display:flex;flex-direction:column;align-items:center;gap:6px}.xtj-magic-title{font-size:15px;font-weight:700;color:var(--text-main,#1f2937)}.xtj-magic-subtitle{font-size:12px;color:var(--text-muted,#6b7280)}.xtj-magic-dots{display:flex;gap:5px;margin-top:2px}.xtj-magic-dots span{width:5px;height:5px;border-radius:50%;background:rgba(110,231,183,.7);animation:mglSpanPulse 1.2s ease-in-out infinite}.xtj-magic-dots span:nth-child(2){animation-delay:.15s;background:rgba(123,213,255,.7)}.xtj-magic-dots span:nth-child(3){animation-delay:.3s;background:rgba(255,227,154,.7)}.xtj-magic-progress{width:140px;height:3px;border-radius:3px;background:rgba(110,231,183,.12);overflow:hidden}.xtj-magic-bar{display:block;width:35%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,rgba(110,231,183,.55),rgba(123,213,255,.55),transparent);animation:mglProgressIndeterminate 1.8s ease-in-out infinite}@keyframes mglFadeIn{from{opacity:0}to{opacity:1}}@keyframes mglSpin{to{transform:rotate(360deg)}}@keyframes mglSpinRev{to{transform:rotate(-360deg)}}@keyframes mglCorePulse{0%,100%{transform:scale(.82);opacity:.6}50%{transform:scale(1.08);opacity:1}}@keyframes mglParticleOrbit1{0%{transform:translate(-50%,-50%) rotate(0deg) translateX(22px) rotate(0deg) scale(1);opacity:.85}25%{transform:translate(-50%,-50%) rotate(90deg) translateX(24px) rotate(-90deg) scale(1.15);opacity:1}50%{transform:translate(-50%,-50%) rotate(180deg) translateX(20px) rotate(-180deg) scale(1);opacity:.75}75%{transform:translate(-50%,-50%) rotate(270deg) translateX(24px) rotate(-270deg) scale(1.1);opacity:1}100%{transform:translate(-50%,-50%) rotate(360deg) translateX(22px) rotate(-360deg) scale(1);opacity:.85}}@keyframes mglParticleOrbit2{0%{transform:translate(-50%,-50%) rotate(0deg) translateX(32px) rotate(0deg) scale(.9);opacity:.7}33%{transform:translate(-50%,-50%) rotate(120deg) translateX(36px) rotate(-120deg) scale(1.05);opacity:1}66%{transform:translate(-50%,-50%) rotate(240deg) translateX(30px) rotate(-240deg) scale(.95);opacity:.65}100%{transform:translate(-50%,-50%) rotate(360deg) translateX(32px) rotate(-360deg) scale(.9);opacity:.7}}@keyframes mglParticleOrbit3{0%{transform:translate(-50%,-50%) rotate(0deg) translateX(42px) rotate(0deg) scale(.75);opacity:.55}50%{transform:translate(-50%,-50%) rotate(180deg) translateX(48px) rotate(-180deg) scale(.85);opacity:.95}100%{transform:translate(-50%,-50%) rotate(360deg) translateX(42px) rotate(-360deg) scale(.75);opacity:.55}}@keyframes mglSpanPulse{0%,100%{opacity:.4;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}@keyframes mglProgressIndeterminate{0%{transform:translateX(-100%)}50%{transform:translateX(200%)}100%{transform:translateX(400%)}}@media (prefers-reduced-motion:reduce){.xtj-magic-loader,.xtj-magic-loader *{animation:none!important}}';document.head.appendChild(s);})();
// 注入GPU硬件加速CSS（仅关键动画元素，避免iOS GPU内存压力）
(function(){if(document.getElementById('xtjGPUAccelStyle'))return;var s=document.createElement('style');s.id='xtjGPUAccelStyle';s.textContent='.xtj-magic-stage{will-change:transform}.xtj-magic-particle{will-change:transform,opacity}.xtj-magic-core{will-change:transform,opacity}';document.head.appendChild(s);})();
// #region debug-point H5:onerror
window.__dbg = window.__dbg || {}; window.__dbg.errors = [];
window.onerror = function(m, s, l, c, e) { window.__dbg.errors.push({msg:m,src:s,line:l,col:c,err:e && e.stack,ts:Date.now()}); fetch("http://127.0.0.1:7777/event",{method:"POST",body:JSON.stringify({sessionId:"page-unresponsive",runId:"pre",hypothesisId:"H5",location:"onerror",msg:"[DEBUG] Uncaught: "+m,data:{stack:e&&e.stack?e.stack.substring(0,500):""},ts:Date.now()})}).catch(function(){}); };
// #endregion
// #region debug-point H2:iife-start
fetch("http://127.0.0.1:7777/event",{method:"POST",body:JSON.stringify({sessionId:"page-unresponsive",runId:"pre",hypothesisId:"H2",location:"core.js:2",msg:"[DEBUG] Outer IIFE entered",data:{ts:Date.now()},ts:Date.now()})}).catch(function(){});
// #endregion
            const SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
            const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";
// #region debug-point H1+H3:check-supabase
fetch("http://127.0.0.1:7777/event",{method:"POST",body:JSON.stringify({sessionId:"page-unresponsive",runId:"pre",hypothesisId:"H1",location:"core.js:6",msg:"[DEBUG] window.supabase = "+typeof window.supabase,data:{type:typeof window.supabase,hasScript:!!document.querySelector('script[src*=\"supabase\"]')},ts:Date.now()})}).catch(function(){});
// #endregion
            if (typeof window.supabase === 'undefined') {
                var feedEl = document.getElementById('feed');
                if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">服务加载失败，请刷新页面重试</div>';
// #region debug-point H1:supabase-undefined
fetch("http://127.0.0.1:7777/event",{method:"POST",body:JSON.stringify({sessionId:"page-unresponsive",runId:"pre",hypothesisId:"H1",location:"core.js:9",msg:"[DEBUG] supabase UNDEFINED - returning early",data:{},ts:Date.now()})}).catch(function(){});
// #endregion
                return;
            }
            const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.sb = sb;
// #region debug-point H2:sb-created
fetch("http://127.0.0.1:7777/event",{method:"POST",body:JSON.stringify({sessionId:"page-unresponsive",runId:"pre",hypothesisId:"H2",location:"core.js:14",msg:"[DEBUG] sb created, window.sb = "+!!window.sb,data:{},ts:Date.now()})}).catch(function(){});
// #endregion

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
        const CACHE_DURATION = 5 * 60 * 1000; // 缂傛挸鐡?閸掑棝鎸?

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
            return [
                '<div class="post-user-chip post-user-chip--loading is-empty">',
                '<span class="post-user-loader" aria-hidden="true">',
                '<span class="post-user-loader-ring"></span>',
                '<span class="post-user-loader-core"></span>',
                '<span class="post-user-loader-spark"></span>',
                '</span>',
                '<span class="post-user-chip-name">加载中.../span>',
                '</div>'
            ].join('');
        }

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
            var hasMeta = parsed.meta && typeof parsed.meta === "object";
            return Object.assign({}, post, {
                content: parsed.text || "",
                visibility: hasMeta ? (meta.visibility || "public") : (post && post.visibility ? post.visibility : (meta.visibility || "public")),
                is_pinned: hasMeta ? !!meta.is_pinned : (post && (post.is_pinned === true || post.is_pinned === false) ? !!post.is_pinned : !!meta.is_pinned),
                pinned_at: hasMeta ? (meta.pinned_at || null) : (post && post.pinned_at ? post.pinned_at : (meta.pinned_at || null)),
                updated_at: hasMeta ? (meta.updated_at || null) : (post && post.updated_at ? post.updated_at : (meta.updated_at || null)),
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
                el.textContent = "全部帖子";
            } else if (!count) {
                el.textContent = "没有找到相关帖子";
            } else {
                el.textContent = "找到 " + count + " 条结果";
            }
        }
        window.renderFilterSummary = renderFilterSummary;

        // ========== 鐘讹拷锟界鐞嗗懡鍚嶇┖闂达紙鍚戝悗鍏煎锟?==========
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
            
            // FLIP Animation: Step 3 - Invert (鐠侊紕鐣诲顔肩磽楠炶泛寮介崥鎴濆綁閿?
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
                    
                    // FLIP Animation for Close: 閼惧嘲褰囬敓鏂ゆ嫹鍓嶅鍦崶娴ｅ秶鐤?
                    var dialogRect = dialog.getBoundingClientRect();
                    
                    // 閼惧嘲褰囧垹閿熸枻鎷烽幐澶愭尦閿熸枻鎷峰墠娴ｅ秶鐤?
                    var deleteBtn = document.getElementById('ppDeleteBtn');
                    var btnRect = deleteBtn ? deleteBtn.getBoundingClientRect() : null;
                    
                    var targetDx = o.dx;
                    var targetDy = o.dy;
                    var targetScale = o.scale || 0.3;
                    
                    if (btnRect) {
                        // 浣跨敤鎸夐挳锟斤拷前浣嶇疆璁＄畻鐩爣鍙樻崲
                        targetDx = btnRect.left + btnRect.width / 2 - dialogRect.left - dialogRect.width / 2;
                        targetDy = btnRect.top + btnRect.height / 2 - dialogRect.top - dialogRect.height / 2;
                        
                        var btnSize = Math.sqrt(btnRect.width * btnRect.width + btnRect.height * btnRect.height);
                        var dialogSize = Math.sqrt(dialogRect.width * dialogRect.width + dialogRect.height * dialogRect.height);
                        targetScale = btnSize / dialogSize * 0.6;
                    }
                    
                    // Step 3 - Invert: 娣囶喗绻冪€垫柨缍嬮崜宥囧Ц閹?
                    dialog.style.transition = 'none';
                    dialog.style.transform = 'translate(0, 0) scale(1)';
                    dialog.style.opacity = '1';
                    void dialog.offsetHeight;
                    
                    // Step 4 - Play: 閹绢厽鏂佹鐐叉礀閸斻劎鏁?
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

            // ===================== 瀵嗙爜閸濆牆ͳ=====================
            async function hashPassword(password) {
                const encoder = new TextEncoder();
                const data = encoder.encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ===================== 閻ц缍?/ 濞夈劌鍞?/ 閻ц鍤?=====================
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

                    // 娴兼ê鍘涙禒?__auth__ 鐠佹澘缍嶉懢宄板絿濞夈劌鍞介弮鍫曟？闁挎稑鐗婂〒鑸垫綀婵炰緤绱?
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

                    // 閸氬骸顦敍姘矤閻滅増婀?__user_info__ 娑擃叀顕伴敓?reg_time閿涘牏鏁imit(1)閼板矂娼猰aybeSingle閿涘苯顔愰柨娆忣樋鐞涘矉绱?
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

                    // 閺堫澁鎷烽崥搴℃倵婢跺浄绱伴弬鎵暏閹撮鏁ら敓鏂ゆ嫹鍓嶆椂閿熸枻鎷?
                    if (!regTime && isNewUser) {
                        regTime = new Date().toISOString();
                    }

                    var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
                    var contentStr = JSON.stringify(userInfo);

                    // 鐏忔繆鐦幍鎯у煂閺堫澁鎷烽弬棰佺閺壜ゎ唶瑜版洖鑻烾PDATE閿涘牊鐦瓺ELETE+INSERT閺囨潙褰查棃鐙呯礉闁灝鍘LS閹锋帞绮稤ELETE閿?
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
                                console.log("saveUserInfo [更新] " + name + " 鐧诲綍鏃堕棿 (UPDATE): " + userInfo.last_login);
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
                            console.error("saveUserInfo insert婢惰精瑙?", insertRes.error.message);
                        } else {
                            console.log("saveUserInfo [插入] " + name + " 登录时间 (INSERT): " + userInfo.last_login);
                        }
                    }
                } catch(e) {
                    console.error("saveUserInfo婢惰精瑙?", e);
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
                    showToast("登录成功，欢迎回来！" + name);
                    closeModal('loginModal');
                    
                    // 鏇存柊閺堚偓鏉╂垹娅ヨぐ鏇熸闂?
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
                        showToast("注册失败: " + error.message);
                        btn.disabled = false; btn.textContent = "注册失败";
                        return;
                    }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    showToast("注册成功，欢迎！" + name);
                    closeModal('registerModal');
                    
                    // 娣囨繂鐡ㄩ悽銊﹀煕濞夈劌鍞芥穱顔瑰墲娴?
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

            // ========== 鏌ョ湅鍏兼湹绮敤鎴疯祫鏂欏崱鐗?==========
            let upcTargetUser = null;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '最近登录：加载中...';
                
                var avatarEl = document.getElementById('upcAvatar');
                // localStorage鏉冨▉锟斤拷锟斤拷锛氬綋鍓嶇敤鎴峰厛妫拷鏌ユ湰鍦扮紦锟?
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
                    msgBtn.textContent = '📩 发消息';
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 鐎殿喖鍊归崝鐘烘祰婢舵潙鍎氶柛婊冪灱濞呫儴銇愰弴鐔割槯闂?
                try {
                    // 瑜版挸澧犻悽銊﹀煕娴兼ê鍘涘ù锝堟硶閺侇槖ocalStorage闁哄鍟埢澶岀处鐎?
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
                        // 闈炲綋鍓嶇敤鎴锋墠鐢―B鍊兼洿鏂扮紦瀛橈紙锟斤拷前锟矫伙拷宸插湪涓婇潰鐢╨ocalStorage璁剧疆锟?
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

            // ========== 娑撴眽璧勬枡璇︽儏鍔熻兘 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 婵夘偄鍘栭崺鐑樻拱娣団剝优
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
                
                // localStorage鏉冨▉锟斤拷锟斤拷锛氬厛妫拷鏌ユ湰鍦扮紦锟?
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="头像">';
                        return;
                    }
                } catch(e) {}
                
                // 閸忕厧鐗忛弫銈夊礃閸涱厾鎽犵紓鎾崇摠閺勫墽銇?
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
                        // 鍚屾閸掔櫦ocalStorage
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            cv[currentUser] = avatarRes.data[0].media_url;
                            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cv));
                        } catch(e) {}
                    } else if (!avatarCache[currentUser]) {
                        avatarEl.innerHTML = '<span id="profileDetailAvatarText">' + (currentUser ? currentUser[0].toUpperCase() : '?') + '</span>';
                    }
                } catch(e) {
                    console.error("加载澶村儚失败:", e);
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
                        // 娴ｈ法鏁?createImageBitmap 鐏忓棗娴橀悧鍥掗敓?缂傗晜鏂侀崙杞板瘜缁捐法鈻?
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
                                // fallback: 闁搞儳鍋ら埀顑藉亾闁?canvas 缂傚倵鏅滈弬?
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
                    // 娴犺濮?閿涙岸鍣搁弸鍕礋閿熻緝杈炬嫹閿?Supabase Storage 閿?avatars/ 閻╊喖缍?
                    const timestamp = Date.now();
                    const random = Math.floor(Math.random() * 1000);
                    const path = `avatars/${timestamp}_${random}_${file.name}`;
                    
                    // 涓婁紶閸?Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 閼惧嘲褰?Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 鍒犻櫎閹碘偓閺堝顦板Λ顐仈閸嶅繗顔囪ぐ?
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
                    // 淇濆瓨閸掔櫦ocalStorage閹镐椒绠欓崠?
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
                // 閺囧瓨鏌婇幋鎴犳畱妞ょ敻娼伴柣銊ュ閵囨棃宕撹箛銉хlocalStorage闁哄鍟埢澶夌喘閸忓牞绱?
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
                            // 鍚屾閸掔櫦ocalStorage
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
                dockChatListCacheTime = 0;
                document.body.style.overflow = '';
                Object.keys(avatarCache).forEach(k => delete avatarCache[k]);
                showToast("已退出登录");
                await initUI();
                initialLoad(true);
            };

            // 婢跺嫮鎮婇幋鎴犳畱妞ょ敻娼伴敓鐭紮鎷烽崡锛勫閻愮懓鍤?
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 鐎规瓕灏欏▍銉ㄣ亹閺囶亞绐楅幍鎾崇磻濞戞挻鐪界挧鍕灐鐠囷附鍎?
                    openProfileDetail();
                } else {
                    // 閺堫亞娅ヨぐ鏇窗閿熸触寮€纰夋嫹褰?娉ㄩ敓鏂ゆ嫹妞ょ敻娼?
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
                    
                    // 鏄剧ず鍙戝竷閸栧搫鐓?
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 鍔犺浇澶村儚
                    loadUserAvatar();
                    
                    // 閿熸枻鎷烽敓鏂ゆ嫹閺堚偓鏉╂垹娅ヨぐ鏇熸闂傝揪绱欐い鐢告桨濮ｅ繑顐奸敓鏂ゆ嫹闁棄鍩涢弬甯礉韫囧懘銆廰wait绾喕绻氶崘娆忓弳閿?
                    await saveUserInfo(currentUser, false);
                    
                    try { subscribeToMessages(); startDMPolling(); updateUnreadBadge(); loadAnnouncements(); subscribeToAnnouncements(); } catch(e) {}
                } else {
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    // 閺囧瓨鏌婇幋鎴犳畱妞ょ敻娼伴弰鍓с仛闁挎稑鐗婂﹢顓犳瑜版洟鏁?
                    profileName.textContent = "未登录";
                    profileStatus.textContent = "点击登录";
                    
                    // 闂呮劘妫屽彂甯冮崠鍝勭厵
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 闂佹彃绉堕悿鍡椼仈閸?
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
                        // localStorage娌℃湁锛屽啀浠庢暟鎹簱锟斤拷锟斤拷
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
                    console.error("加载澶村儚失败:", e);
                }
            }

            // DEPRECATED_DO_NOT_EDIT ===================== [瀹告彃绨惧鍍?娑撳鏌熼敓?361鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 =====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                // 鏉堟挸鍙嗛弽锟犵崣閿涙岸妾洪崚鍫曟毐鎼达讣鎷烽敓钘夊箵闂勩倕宓勯梽鈺佸敶閿?
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
                } catch (e) { console.error(e); }
            };

            function createHeartParticles(btn) {
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                const emojis = ["❤️","💕","💖","🤍","💗","💘"];
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

            // ===================== 鐠囧嫯顔?=====================
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

            // ===================== 删除鐢牕鐡?=====================
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

            // ===================== 閸ュ墽澧栭弻銉ф箙闁?=====================
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

            // ===================== 濞村繗顫嶉梺鎻掔箳缁櫣鎷?=====================
            // 鍏ㄥ眬甯栧瓙淇℃伅锟斤拷锟斤拷锛岀敤浜庢祻瑙堣锟?
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';

            function getViewHistory() {
                try {
                    return window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 闁灝鍘ら柌宥咁槻閿熸枻鎷峰綍閿涘牆鎮撴稉顫嫹閿熺煫浼欐嫹閸氬奔绔寸敮鏍х摍閸欘亣顔囪ぐ鏇氱濞嗏槄绱?
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(entry);
                    // 閸欘亙绻氶悾娆愭付閿?00閿?
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

            // ===================== 閸旂姾娴囬柛鏂诲妽閳?=====================
            // 娴犺濮?閿涙艾鍨庢い闈涘鏉炵晫娴夐崗鍐插綁閿?
            let feedPage = 0;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熼敓?412鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            async function loadFeed(forceRefresh = false) {
                const now = Date.now();
                if (forceRefresh) {
                    // 闁插秶鐤嗗垎椤电姸鎬?
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
                                // 缂傛挸鐡ㄩ崝鐘烘祰闁挎稑鑻幃鎾诲籍鐠哄搫鐏ュ┑顔碱儏鐎垫彃鍨庢い鐢靛Ц閹?
                                feedAllPosts = parsed.data.posts || [];
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed(parsed.data);
                                // 閸氼垰濮╅弮鐘绘濠婃艾濮╅敓妗旇鎷?
                                setupFeedInfiniteScroll();
                                return;
                            }
                        } catch(e){}
                    }
                }
                const feed = document.getElementById("feed");
                if (!forceRefresh) feed.innerHTML = window.xtjMagicLoadingHtml('内容加载中...', '魔法粒子正在聚合', 'feed');
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
                    // 娣囨繂鐡ㄩ悗鐟版湰閺嗭絾鏆熼幑顔界瑹濞戞ê鐎诲銈呭悁婵炲洭鎮?
                    feedAllPosts = data.posts;
                    feedAllComments = data.comments;
                    feedAllLikes = data.likes;
                    // 锟斤拷锟斤拷鏃舵帓闄ゅご鍍忓拰锟矫伙拷淇℃伅锟斤拷录锛岄槻姝ase64澶у浘鎾戠垎localStorage
                    const cachePosts = data.posts.filter(p => p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
                    await renderFeed(data);
                    // 閸氼垰濮╅弮鐘绘濠婃艾濮╅敓妗旇鎷?
                    setupFeedInfiniteScroll();
                } catch(e) {
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>`;
                    console.error(e);
                }
            }

            // 娴犺濮?閿涙俺顔曠純顔芥￥闂勬劖绮撮崝銊潎鐎电喎娅?
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
                
                // 閿?feed 鎼存洟鍎村ǎ璇插娑擃澁鎷烽敓?sentinel 閸忓啰示
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熼敓?479鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            function loadMoreFeedPosts() {
                if (feedEndReached) return;
                
                const feed = document.getElementById('feed');
                const visiblePosts = feedAllPosts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                
                const startIdx = feedPage * FEED_PAGE_SIZE;
                const endIdx = startIdx + FEED_PAGE_SIZE;
                
                if (startIdx >= visiblePosts.length) {
                    feedEndReached = true;
                    // 閿熸枻鎷风ず濞屸剝婀侀弴鏉戭樋娴?
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熼敓?503鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
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
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none">`:`<img src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${escapeHtml(p.media_url).replace(/'/g, "\\'")}')">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} | 点赞 ${pLikes.length} | 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'❤️':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">评论</button>
                    ${canPinPost(p)?`<button type="button" class="action-btn pin" data-post-id="${escapeHtml(p.id).replace(/'/g, "\\'")}">${normalizePost(p).is_pinned ? '取消置顶' : '置顶'}</button>`:''}
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">删除</button>`:''}
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
                
                // 鍦?sentinel 涔嬪墠鎻掑叆鏂板笘子
                const sentinel = document.getElementById('feedSentinel');
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = postsHtml;
                
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                
                // 涓烘柊甯栧瓙娣诲姞锟斤拷锟斤拷鍔ㄧ敾锟桔诧拷锛堝鐢ㄥ叏灞拷鄄锟藉櫒锛?
                const newPosts = feed.querySelectorAll('.post:not(.visible)');
                newPosts.forEach(p => getPostVisibilityObserver().observe(p));
                
                // 鏇存柊缁熻
                updateFeedStats();
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熼敓?532鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;

                // 婵夘偄鍘栫敮鏍х摍娣団剝浼呯紓鎾崇摠闁挎稑濂旂欢鍨セ鐟欏牐顔囪ぐ鏇熸媴鐠恒劍鏆?
                visiblePosts.forEach(p => {
                    postInfoCache[p.id] = { content: p.content, user_name: p.user_name };
                });

                // 閺€鍫曟肠閹碘偓閺堝娓剁憰浣搞仈閸嶅繒娈戦悽銊﹀煕閸?
                const allUsers = new Set();
                visiblePosts.forEach(p => allUsers.add(p.user_name));
                comments.forEach(c => allUsers.add(c.user_name));

                // 缁涘绶熸径鏉戝剼閸旂姾娴囩€瑰本鍨氶崥搴″晙濞撳弶鐓?
                await loadAvatarsForUsers(Array.from(allUsers));
                
                // 娴犺濮?閿涙艾褰у〒鍙夌厠缁楊兛绔存い鐢垫畱閿熸枻鎷烽敓鏂ゆ嫹閿涘苯鎮楃紒顓ㄦ嫹閿熷€熺箖閺冪娀妾哄姘З閿熸枻鎷烽敓鏂ゆ嫹
                const firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                renderFeedWithAvatars(firstPage, comments, likes);
                
                // 閸氬骸褰撮閿熻妭濠忔嫹鏉炵晫绮虹拋鈩冩殶閿?
                setTimeout(function() { prefetchStatData(); }, 1000);
            }
            window.renderFeed = renderFeed;

            // 妫板嫭鐎楦跨槑鐠佸搫鎷伴敓鏂ゆ嫹閿熸枻鎷烽惃鍕Ё鐏忓嫯銆冮敍灞惧絹閸楀洦瑕嗛弻鎾粹偓褑鍏?
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

            async function loadAvatarsForUsers(usernames) {
                if (!usernames || usernames.length === 0) return;
                try {
                    var allData = [];
                    var batchSize = 80; // Supabase .in() 閺堚偓婢舵氨容00娑擃亪銆嶉敍宀嬫嫹?0娴ｆ瑩鍣?
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
                    console.error("加载澶村儚失败:", e);
                }
            }

            function getAvatarHtml(username, size = 32) {
                var avatarUrl = avatarCache[username];
                if (!avatarUrl) {
                    if (username === currentUser) {
                        // 鍙粠localStorage閲屾嬁锟斤拷前锟矫伙拷鑷繁鐨勫ご锟?
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熼敓?520鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
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
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none">`:`<img src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${escapeHtml(p.media_url).replace(/'/g, "\\'")}')">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} | 点赞 ${pLikes.length} | 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'❤️':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">评论</button>
                    ${canPinPost(p)?`<button type="button" class="action-btn pin" data-post-id="${escapeHtml(p.id).replace(/'/g, "\\'")}">${normalizePost(p).is_pinned ? '取消置顶' : '置顶'}</button>`:''}
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">删除</button>`:''}
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
                var directPayload = {
                    content: nextContent,
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                };
                var expectedState = {
                    content: nextContent,
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt
                };
                var direct = await sb.from("posts").update(directPayload).eq("id", post.id).select("*");
                if (!direct.error && (!direct.data || (Array.isArray(direct.data) && direct.data.length === 0))) {
                    try {
                        var fetchedDirectRow = await fetchPostSnapshot(post.id);
                        if (fetchedDirectRow) direct.data = [fetchedDirectRow];
                    } catch (verifyDirectRowsError) {}
                }
                if (!direct.error) {
                    if (!direct.data || (Array.isArray(direct.data) && direct.data.length === 0)) {
                        return { ok: false, error: new Error("数据库未更新任何记录，可能是 Supabase RLS/update policy 拦截") };
                    }
                    var saved = Array.isArray(direct.data) ? direct.data[0] : direct.data;
                    var hasVisibility = saved && Object.prototype.hasOwnProperty.call(saved, "visibility") && String(saved.visibility) === String(nextVisibility);
                    var hasPinned = saved && Object.prototype.hasOwnProperty.call(saved, "is_pinned") && !!saved.is_pinned === nextPinned;
                    if (hasVisibility && hasPinned) {
                        return { ok: true, fallback: false };
                    }
                    try {
                        var verifiedDirect = await fetchPostSnapshot(post.id);
                        if (matchesPostExpectation(verifiedDirect, expectedState)) {
                            return { ok: true, fallback: false };
                        }
                    } catch (verifyDirectError) {}
                }

                var message = direct.error ? String(direct.error.message || "") : "";
                var maybeSchemaIssue = /visibility|is_pinned|pinned_at|updated_at|column/i.test(message) || !direct.error;
                if (direct.error && !maybeSchemaIssue) return { ok: false, error: direct.error };

                var fallbackContent = buildPostStorageContent(normalized, nextContent, {
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                });
                var fallback = await sb.from("posts").update({ content: fallbackContent }).eq("id", post.id);
                if (fallback.error) return { ok: false, error: fallback.error };
                try {
                    var verifiedFallback = await fetchPostSnapshot(post.id);
                    if (!matchesPostExpectation(verifiedFallback, expectedState)) {
                        return { ok: false, error: new Error("帖子更新后状态未实际保存") };
                    }
                } catch (verifyFallbackError) {
                    return { ok: false, error: verifyFallbackError };
                }
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
                if (normalized.updated_at) return time + " (已编辑)";
                return time;
            }

            function buildPostBadges(post) {
                var normalized = normalizePost(post);
                var bits = [];
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '🔒 私密' : '🔓 公开') + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">📌 置顶</span>');
                return bits.join("");
            }

            function buildPostActionHtml(post, isLiked, canDelete) {
                var id = escapeHtml(String(post.id)).replace(/'/g, "\\'");
                var actorKey = escapeHtml(String(post.actor_key || "")).replace(/'/g, "\\'");
                var actions = [
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(this, \'' + id + '\')">' + (isLiked ? '❤️' : '点赞') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + id + '\')">评论</button>'
                ];
                if (canEditPost(post)) {
                    actions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + id + '\')">编辑</button>');
                }
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" onclick="togglePostPin(\'' + id + '\', this)">' + (normalizePost(post).is_pinned ? '取消置顶' : '置顶') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + id + '\', \'' + actorKey + '\')">删除</button>');
                }
                return actions.join("");
            }

            function renderPostCard(post, commentMap, likeMap, likeUserMap) {
                var normalized = normalizePost(post);
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = likeUserMap[normalized.id + '|' + deviceId];
                var canDelete = normalized.actor_key === deviceId || normalized.actor_key === currentUser || isAdmin();
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
                  <div class="post-stats-text">浏览 ${normalized.views || 0} | 点赞 ${pLikes.length} | 评论 ${pComms.length}</div>
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
                var target = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(postId); });
                if (!target || !canEditPost(target)) {
                    showToast("无权编辑这条帖子");
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
                    showToast("无权编辑这条帖子");
                    return;
                }
                var input = document.getElementById("editPostInp");
                var visibility = document.getElementById("editPostVisibility");
                var btn = document.getElementById("saveEditPostBtn");
                var nextContent = input ? input.value.trim() : "";
                var nextVisibility = visibility ? visibility.value : "public";
                if (!nextContent) {
                    showToast("请输入帖子内容");
                    return;
                }
                btn.disabled = true;
                btn.textContent = "保存中...";
                try {
                    var result = await updatePostRecord(post, {
                        content: nextContent.slice(0, 2000),
                        visibility: nextVisibility,
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
                        throw new Error("保存失败：公开/秘密状态未实际保存");
                    }
                    var verified = normalizePost(fetchedPost);
                    if (String(verified.visibility) !== String(nextVisibility)) {
                        throw new Error("保存失败：公开/私密状态未实际保存");
                    }
                    clearFeedCache();
                    closeModal("editPostModal");
                    editPostId = null;
                    await loadFeed(true);
                    showToast(nextVisibility === "private" ? "已改为私密" : "已改为公开");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("保存失败: " + (e && e.message ? e.message : "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
                }
            };
            window.togglePostPin = async function(postId, btn) {
                var post;
                var nextPinned;
                try {
                    post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                    if (!post || !canPinPost(post)) {
                        showToast("无权置顶这条帖子");
                        return;
                    }
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = post.is_pinned ? "取消中..." : "置顶中...";
                    }
                    nextPinned = !post.is_pinned;
                    var result = await updatePostRecord(post, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinned ? new Date().toISOString() : null
                    });
                    if (!result.ok) {
                        if (btn) { btn.disabled = false; btn.textContent = post.is_pinned ? "取消置顶" : "置顶"; }
                        showToast("置顶操作失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    showToast(nextPinned ? "✅ 帖子已置顶" : "✅ 已取消置顶");
                    await loadFeed(true);
                } catch (e) {
                    console.error("togglePostPin error:", e);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = post && typeof post.is_pinned !== 'undefined' ? (post.is_pinned ? "取消置顶" : "置顶") : "置顶";
                    }
                    showToast("操作异常: " + (e && e.message ? e.message : "未知错误，请查看控制台"));
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
                        btn.textContent = "处理中...";
                    }
                    nextVisibility = post.visibility === "private" ? "public" : "private";
                    var result = await updatePostRecord(post, {
                        visibility: nextVisibility,
                        visibility_set_at: new Date().toISOString()
                    });
                    if (!result.ok) {
                        if (btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "🔒 设为私密" : "🔓 设为公开"; }
                        showToast("操作失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    showToast(nextVisibility === "private" ? "🔒 已设为私密，仅自己可见" : "🔓 已设为公开");
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
            document.addEventListener('click', function(e) {
                var btn = e.target.closest('.action-btn.pin');
                if (btn) {
                    var postId = btn.getAttribute('data-post-id');
                    if (postId) {
                        togglePostPin(postId, btn);
                    }
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
                btn.textContent = "发布中...";
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
                } catch (e) {
                    showToast("发布失败: " + (e.message || "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "发布动态";
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
                    feed.innerHTML = window.xtjMagicLoadingHtml('内容加载中...', '魔法粒子正在聚合', 'feed');
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
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败: ' + escapeHtml(err.message || "未知错误") + '</div>';
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
                        noMore.textContent = "没有更多帖子";
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
                btn.textContent = "删除中...";
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
                } catch (e) {
                    showToast("删除帖子失败");
                    console.error(e);
                } finally {
                    btn.disabled = false;
                    btn.textContent = "确认删除";
                }
            };

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熼敓?668鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 ======
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
            // 瀛樺偍锟斤拷前鐨勭粺璁¤鍥剧姸锟?
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30绉掔紦锟?

            // 閸氬骸褰撮閿熻妭濠忔嫹鏉炵晫绮虹拋鈩冩殶閿?
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

            // 閹垫挸绱戠紒鐔活吀鐠囷附鍎忔俊顖楀墲閳ь兛鐒?
            window.openStatDetail = async function(type) {
                statCurrentType = type;
                const titles = { posts: '总动态- 按用户分组', views: '总浏览- 浏览记录', likes: '点赞和评论- 记录' };
                document.getElementById('statModalTitle').textContent = titles[type] || '统计详情';
                document.getElementById('statModal').classList.add('active');

                // 婵″倹鐏夐張澶岀处鐎涙ɑ鏆熼幑顕嗙礉閿熸枻鎷烽敓鏂ゆ嫹濞撳弶鐓嬮敍灞芥倱閺冭泛绱撳銉ュ煕閿?
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

                document.getElementById('statModalBody').innerHTML = window.xtjMagicLoadingHtml('加载中...', '加载中...', 'feed');

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

            window.openPostDetail = async function(postId) {
                document.getElementById('postDetailTitle').textContent = '帖子详情';
                document.getElementById('postDetailBody').innerHTML = window.xtjMagicLoadingHtml('加载中...', '加载中...', 'feed');
                document.getElementById('postDetailModal').classList.add('active');

                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                        sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                        sb.from("likes").select("*").eq("post_id", postId).order("created_at", {ascending: false})
                    ]);

                    const post = normalizePost(postRes.data);
                    if (!post) {
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">帖子不存在或已删除</div>';
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
                    ${post.media_url ? `<div class="post-detail-media">${post.media_type==='video'?`<video src="${escapeHtml(post.media_url)}" controls preload="none"></video>`:`<img src="${escapeHtml(post.media_url)}" onclick="openImageViewer('${escapeHtml(post.media_url).replace(/'/g, "\\'")}')" loading="lazy" />`}</div>` : ''}
                    <div class="post-detail-stats">浏览 ${vc} 次· 点赞 ${likes.length} 次· 评论 ${comments.length}</div>
                    <div class="stat-two-col">
                        <div class="stat-col">
                            <div class="stat-section-title">✦ 点赞用户 ${likes.length}</div>
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
                            <div class="stat-section-title">💬 评论列表 ${comments.length}</div>
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

            // 鏍煎紡鍖栧笘瀛愬唴瀹规憳瑕侊紙鐢ㄤ于灞曠ず：
            function formatPostSummary(p) {
                const text = p.content || '';
                const hasImg = p.media_url && p.media_type === 'image';
                const hasVid = p.media_url && p.media_type === 'video';
                let tag = '';
                if (hasImg) tag = '<span class="spi-img-tag">? ͼƬ</span>';
                if (hasVid) tag = '<span class="spi-img-tag">🎬 视频</span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '一张图片' : hasVid ? '一个视频' : '(无内容)');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 鐢熸垚甯栧瓙鏉＄洰鐨凥TML锛堝彲鐐瑰嚮璺宠浆：
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

            // 鏌ョ湅鎸囧畾鐢ㄦ埛鐨勬墍鏈夊笘子
            window.loadUserAllPosts = function(userName) {
                const body = document.getElementById('statModalBody');
                const userPosts = statAllPosts.filter(p => p.user_name === userName);
                body.innerHTML = `
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">← 返回总动态</button>
                    <div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        ${userName} 的全部帖子（${userPosts.length} 条）
                    </div>
                    ${userPosts.map(p => renderPostItemHTML(p)).join('')}
                `;
            };

            // 娓叉煋鎬绘祻瑙堢粺璁★紙浠?localStorage 璇诲彇浏览鍘嗗彶：
            function renderViewStats() {
                const body = document.getElementById('statModalBody');
                const history = getViewHistory();
                
                if (!history.length) {
                    body.innerHTML = `
                        <div class="stat-empty">
                            <div style="font-size:16px; margin-bottom:8px;">📵 浏览记录</div>
                            <div style="font-size:13px;">暂无浏览详情数据</div>
                            <div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录会在你查看帖子时自动保存</div>
                            <div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录总浏览数：{document.getElementById('sViews').textContent} 次</div>
                        </div>
                    `;
                    return;
                }

                body.innerHTML = history.map(v => `
                    <div class="stat-view-item">
                        <div class="svi-info">
                            <div class="svi-user">${escapeHtml(v.user_name)}</div>
                            <div class="svi-target">浏览了<b>${escapeHtml(v.post_author)}</b> 的帖子：${escapeHtml(v.post_content)}</div>
                        </div>
                        <span class="svi-time">${new Date(v.viewed_at).toLocaleString()}</span>
                    </div>
                `).join('');
            }

            // 娓叉煋点赞鍜岃瘎璁虹粺记
            function renderLikeStats() {
                const body = document.getElementById('statModalBody');

                const postMap = {};
                statAllPosts.forEach(p => { postMap[p.id] = p; });

                function buildLikesCol() {
                    let h = '<div class="stat-section-title">鉂わ笍 点赞记录</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(l => {
                            const post = postMap[l.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除帖子)';
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
                    let h = '<div class="stat-section-title">馃挰 评论记录</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除帖子)';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">评论浜嗐€?{postContent}銆嶏細${escapeHtml(c.content)}</div>
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

                // 瀵搫鍩楅敓鏂ゆ嫹閿熻棄娅掔€瑰本鍨氱敮鍐ㄩ浌閿熻棄鎮楅崘宥嗗潑閸旂垙how缁紮绱濈涵顔荤箽CSS transition濮濓絿鈥樼憴锕€褰?
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

            // ==== 濞村鐦€氱煡濡亜绠欓敍鍫熷付閸掕泛褰寸拫鍐暏閿涙estNotification()閿?====
            window.testNotification = function() {
                showNotification('张三', '这是一条测试消息，检查通知文本显示是否正常');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常非常长的测试消息，用来检查文本截断效果到底怎么样，超过300个字符也不会把字符串打坏');
            };

            // ===================== 鑱婂ぉ绯荤粺 (Dock 鍏煎閻? =====================
            let chatRealtime = null;
            let dmpollTimer = null;
            let dmpollInterval = null;

            function escapeHtml(str) {
                var d = document.createElement('div');
                d.textContent = str;
                return d.innerHTML;
            }
            window.escapeHtml = escapeHtml;

            function buildMagicLoadingTitle(title) {
                var text = String(title || '加载中...');
                if (text === '内容加载中...' || text === '内容刷新中...') text = '加载中...';
                if (text === '加载中...') {
                    return '<span class="xtj-magic-title-wave" aria-label="' + escapeHtml(text) + '">' +
                        Array.from(text).map(function(char, index) {
                            return '<span style="--wave-index:' + index + '" aria-hidden="true">' + escapeHtml(char) + '</span>';
                        }).join('') +
                    '</span>';
                }
                return escapeHtml(text);
            }

            function buildMagicLoadingHtml(title, subtitle, variant) {
                var extra = variant ? ' ' + variant : '';
                return [
                    '<div class="xtj-magic-loader' + extra + '">',
                    '<div class="xtj-magic-stage" aria-hidden="true">',
                    '<div class="xtj-magic-core"></div>',
                    '<div class="xtj-magic-ring"></div>',
                    '<div class="xtj-magic-ring"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '<div class="xtj-magic-particle"></div>',
                    '</div>',
                    '<div class="xtj-magic-text">',
                    '<div class="xtj-magic-title">' + buildMagicLoadingTitle(title) + '</div>',
                    '<div class="xtj-magic-subtitle">' + escapeHtml(subtitle || '魔法粒子正在聚合') + '</div>',
                    '</div>',
                    '<div class="xtj-magic-dots" aria-hidden="true"><span></span><span></span><span></span></div>',
                    '<div class="xtj-magic-progress"><div class="xtj-magic-bar"></div></div>',
                    '</div>'
                ].join('');
            }window.xtjMagicLoadingHtml = buildMagicLoadingHtml;

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
                        console.log('[CHAT-REALTIME] 鏀跺埌鏂版秷锟?', m);
                        if (m.media_type !== DM_MARKER) return;
                        if (!currentUser) return;
                        if (m.media_url !== currentUser) return;
                        if (m.user_name === currentUser) return;
                        console.log('[CHAT-REALTIME] 瑙﹀彂通知:', m.user_name, m.content);
                        showNotification(m.user_name, m.content || '鍙戦€佷簡一张图片视频');
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
                // 娴犺濮?閿涙岸绮拋銈夋？閿?5 閸掑棝鎸撻敓?00000ms閿涘绱濋梽宥勭秵閿熸枻鎷烽敓鏂ゆ嫹鎼存捁顕Ч鍌氬竾閿?
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

            // ========== Dock 閸掑洦宕?==========
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
                // 閸忓牐袝閸欐垹鍋ｉ崙璇插З閻紮绱欓崡鍏呭▏瀹歌尙绮￠崷銊ョ秼閸撳车ab娑旂喕顩﹂幘顓熸杹閿?
                var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (btn) triggerTabAnimation(btn, tab);
                const now = Date.now();
                
                // 濡澁鎷烽弻銉︽Ц閸氾附妲搁崣灞藉毊鍒烽敓鏂ゆ嫹閿?00ms閸愬懎鍟€濞嗭紕鍋ｉ崙璇叉倱娑擃澁鎷穞ab閿?
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);
                
                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 鍙屽嚮锛氭墽琛屽埛锟?
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            // 照片墙刷新
                            window.showToast('正在刷新照片墙...');
                            if (typeof window.loadPhotoWallData === 'function') {
                                window.loadPhotoWallData(true).then(function() {
                                    if (typeof window.renderPhotoWall === 'function') {
                                        window.renderPhotoWall();
                                    }
                                    isRefreshing[tab] = false;
                                    window.showToast('刷新完成');
                                }).catch(function() {
                                    isRefreshing[tab] = false;
                                });
                            } else {
                                isRefreshing[tab] = false;
                            }
                        } else if (tab === 'posts') {
                            // 鐢牕鐡欐い闈涘煕閿?
                            window.showToast('正在刷新...');
                            // 娓呴櫎缂撳瓨楠炲爼鍣告柊澧炲鏉?
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
                            window.showToast('刷新完成');
                        } else if (tab === 'chat') {
                            // 鑱婂ぉ妞ら潧鍩涢ʽ
                            window.showToast('正在刷新...');
                            dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        } else if (tab === 'profile') {
                            // 娑擃亙姹夋い闈涘煕閿?
                            window.showToast('正在刷新...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        }
                    } else {
                        // 鍗曞嚮锛氭墽琛岃繑锟?鍥為《鎿嶄綔
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 甯栧瓙椤碉細鍥炲埌椤堕儴
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 閿熸枻鎷烽敓鏂ゆ嫹妞ょ绱版俊鍌涚亯閸︺劌顕拠婵呰厬閿涘矁绻戦崶鐐朵喊婢垛晛鍨悰顭掔幢閸氾箑鍨崶鐐插煂妞ゅ爼鍎?
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
                
                // 鍒囨崲閸掔増鏌妕ab
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
            // ========== Dock 閼卞﹤銇?==========
            let dockChatActiveUser = null;
            let dockChatSending = false;
            let dockChatMsgsBusy = false;
            let dockChatMsgsDirty = '';
            let dockChatMsgsUser = null;
            let _dockPreviewUrl = null;

                                                            function renderChatLoadingState(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中...';
                var subtitle = options && options.subtitle ? options.subtitle : '法阵正在聚能';
                var variant = options && options.variant ? String(options.variant) : '';
                el.innerHTML = window.xtjMagicLoadingHtml(title, subtitle, variant);
            }

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
                document.getElementById('dockChatMessages').innerHTML = window.xtjMagicLoadingHtml('加载中...', '正在打开聊天通道', 'chat-detail');
                renderChatLoadingState(document.getElementById('dockChatMessages'), {
                    title: '加载中...',
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
                if (Date.now() - dockChatListCacheTime < DOCK_CHAT_CACHE_DURATION) return;
                dockChatListCacheTime = Date.now();
                el.innerHTML = window.xtjMagicLoadingHtml('加载中...', '正在召回最近消息', 'chat-list');
                try {
                    renderChatLoadingState(el, {
                        title: '加载中...',
                        subtitle: '正在召回最近消息',
                        variant: 'chat-list'
                    });
                    const { data: allMsgs, error } = await sb.from("posts")
                        .select("id, user_name, media_url, content, created_at")
                        .eq("media_type", DM_MARKER)
                        .or(`user_name.eq.${currentUser},media_url.eq.${currentUser}`)
                        .order("created_at", { ascending: false })
                        .limit(200);
                    if (error) throw error;
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">馃挰</div><div>暂无娑堟伅</div><div style="font-size:12px;">鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶?/div></div>';
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
                    // 棰勯敓鑺傚鎷锋潪鍊熶喊婢垛晛鍨悰銊ャ仈閿?
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
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">鈿?/div><div>' + (e.message || '加载失败') + '</div></div>';
                }
            }

            // 閼卞﹤銇夋繛鎴濈墛娴煎懘寮靛﹢瀵哥处鐎涙﹢鏁嶇仦鑲╃檶婵炲棌鍓濇晶锕€顕ｉ埀顒傜矓閹烘垵姣?
            var _chatCache = {};

            async function loadDockChatMessages(userName, forceScroll) {
                if (dockChatMsgsBusy && dockChatMsgsUser === userName) { dockChatMsgsDirty = userName; return; }
                // 棰勯敓鑺傚鎷锋潪钘夊蓟閺傜懓銇旈敓?
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
                // 瑜版挸澧犻悽銊﹀煕娴兼ê鍘涘ù锝堟硶閺侇槖ocalStorage闁哄鍟埢澶岀处鐎?
                if (currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 閺堝绱︾€涙ê鍘涚珛鍗虫樉绀?
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
                    // 缂傛挸鐡ㄦ繛鎴濈墛娴?
                    _chatCache[cacheKey] = msgs || [];
                    const toMark = (msgs || []).filter(m => m.user_name === userName && m.media_url === currentUser && (m.views || 0) === 0);
                    await Promise.all(toMark.map(m => sb.rpc("increment_post_views", { p_post_id: m.id }).catch(() => {})));
                    toMark.forEach(m => { m.views = 1; });
                    markMessagesRead(userName);
                    renderDockMessages(msgs || [], forceScroll);
                } catch(e) {
                    if (!_chatCache[cacheKey]) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">鈿?/div><div>' + (e.message || '加载失败') + '</div></div>';
                    }
                } finally {
                    dockChatMsgsBusy = false;
                    if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
                }
            }

            function renderDockMessages(msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>'; return; }
                // 濡澁鎷峰ù瀣暏閹撮攱妲搁崥锕€婀敓浠嬬湅閸樺棗褰堕敓鏂ゆ嫹褰曢敍鍫㈩瀲鎼存洟鍎撮敓鏂ゆ嫹閿熸枻鎷?00px鐟欏棔璐熼崷銊ф箙閸樺棗褰堕敓?
                var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                // 閸忓牓娈ｉ挊蹇擃啇閸ｎ煉绱濆〒鍙夌厠鐎瑰瞼娲块幒銉ュ煂鎼存洖鍟€閿熸枻鎷风ず閿涘矂浼╅崗宥勭矤妞ゅ爼鍎村鎴滅瑓閺夈儳娈戦梻顏嗗剨
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
                // 濞撳弶鐓嬬€瑰本鐦敍灞炬▔缁€鍝勵啇閿?
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
                // iOS 闁款喚娲忓鐟板毉娣囶喖顦? 闁灝鍘?dock-bar 鐞氼偊鏁惄姗€銆婃稉濠傚箵
                (function() {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
                    let keyboardOpen = false;

                    function handleFocus(e) {
                        if (dockBar) dockBar.style.display = 'none';
                        keyboardOpen = true;
                        // 鐠佲晞绶崗銉︻攱閼奉亜濮╁姘煂閸欘垵顫嗛崠鍝勭厵
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

                    // 娴犺濮?閿涙矮濞囬敓?100dvh 閺囧じ鍞?--vh 閺傝顢嶉敍宀€些閿?resize 閸ョ偠鐨熸稉顓犳畱 adjustIOSHeight
                    // window.addEventListener('resize', function() {
                    //     if (!keyboardOpen) adjustIOSHeight();
                    // });
                })();

                // 娴犺濮?閿涙矮濞囬敓?100dvh 閺囧じ鍞?--vh 閺傝顢嶉敍宀€些闂勩倖妫敓?iOS 鐠嬪啯鏆ｆ禒锝囩垳
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI(); initialLoad();
                // 鎭㈠娑撳﹥淇濆瓨閻ㄥ嫭鐖ｇ粵楣冦€?
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
                    if (themeBtn) themeBtn.textContent = '🌙';
                    localStorage.setItem('xtj-theme', 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) themeBtn.textContent = '☀️';
                    localStorage.setItem('xtj-theme', 'light');
                }
            }
            if (themeBtn) {
                themeBtn.addEventListener('click', function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    applyTheme(!isDark);
                });
            }
            // 閸掓繂顫愰崠鏍﹀瘜妫版﹫绱伴敓鏂ゆ嫹閿熸枻鎷?localStorage閿涘苯鍙惧▎锛勯兇缂佺喎浜搁敓?
            const savedTheme = localStorage.getItem('xtj-theme');
            if (savedTheme === 'dark') {
                applyTheme(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme(true);
            } else {
                applyTheme(false);
            }

            // ========== 鍏憡系ͳ==========
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
                // 閿熸枻鎷烽敓鏂ゆ嫹閸掓銆冮弮鑸典划婢跺秶顓搁悶鍡楁喅閻ㄥ嫬褰傜敮鍐ㄥ隘閿?
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                markAnnouncementRead(ann.id);

                // 鏉╂稑鍙嗙拠锔藉剰闁哄啫鐖煎▓锝夋寠韫囨挸绲洪悽顖氬暙鐏忣垶宕?
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 璁剧疆鍙戝竷閼板懍淇婇幁绱欐樉绀洪張鈧柊澧炪仈閸嶅骏绱?
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = avatarCache[ann.user_name];
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + ann.user_name.charAt(0).toUpperCase() + '</div>';
                    userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + escapeHtml(ann.user_name) + '</div>';
                }

                // 婵″倹鐏夐弰顖滎吀閻炲棗鎲抽敍灞惧潑閸旂姴鍨归梽銈嗗瘻閿?
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

                renderAnnouncementList(); // 閲嶆柊濞撳弶鐓嬮崚妤勩€冿紝娆㈡纯鏂板鍑＄拠鑽ゅЦ閹?
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
                    // 棰勬湡濮炴潪钘夊絺鐢啳鈧懎銇旈崓?
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
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">馃摤</div><div>暂无鍏憡</div></div>';
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
                    // content鐎涙顔岀€涙クSON閿涙title, content}閿涘潷osts鐞涖劍鐥呴張濉糹tle閸掓绱?
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
                            <div class="changelog-version">⭐ ${item.version}</div>
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
            // 缁戝畾锟叫伙拷浜嬩欢
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 娣囶喗鏁奸崢鐔告箒閿?showAnnouncementList 娴犮儲鏁幐浣哥秼閸撳秵鐖ｇ粵鍓уЦ閿?
            const originalShowAnnouncementList = showAnnouncementList;
            window.showAnnouncementList = function() {
                if (currentAnnouncementTab !== 'announcements') {
                    switchAnnouncementTab('announcements');
                }
                originalShowAnnouncementList();
            };

            // 缂佹垵鐣鹃崗顒€鎲￠幐澶愭尦娴滃娆?
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
            const pairs = [
                ['瀹歌尪顕?', '已读'],
                ['閺堫亣顕?', '未读'],
                ['閸忋劑鍎寸敮鏍х摍', '全部帖子'],
                ['濞屸剝婀侀幍鎯у煂閻╃鍙х敮鏍х摍', '没有找到相关帖子'],
                ['绾喛顓婚幙宥勭稊', '确认操作'],
                ['绾喖鐣剧憰浣瑰⒔鐞涘本顒濋幙宥勭稊閸氭绱?', '确定要执行此操作吗？'],
                ['绾喛顓?', '确认'],
                ['濞戝牊浼?', '消息'],
                ['閸忣剙鎲?', '公告'],
                ['娑撳﹣绱舵径杈Е閿涘矁顕柌宥堢槸', '上传失败，请重试'],
                ['閺冪姵娼堢純顕€銆婃潻娆愭蒋鐢牕鐡?', '无权置顶这条帖子'],
                ['缂冾噣銆婇幙宥勭稊婢惰精瑙?', '置顶操作失败'],
                ['閺堫亞鐓￠柨娆掝嚖', '未知错误'],
                ['缂冩垹绮堕柨娆掝嚖', '网络错误'],
                ['濮濓絽婀崚閿嬫煀閻撗呭婢?..', '正在刷新照片墙..'],
                ['閸欐垵绔烽幋鎰', '发布成功'],
                ['閸掔娀娅庨崗顒€鎲?', '删除公告'],
                ['閸忣剙鎲￠崣鎴濈閹存劕濮?', '公告发布成功'],
                ['閸欐垿鈧礁銇戠拹?', '发送失败'],
                ['閸旂喕鍏樻导妯哄', '功能优化'],
                ['Bug娣囶喖顦?', 'Bug修复'],
                ['閺傛澘顤?', '新增'],
                ['閺€纭呯箻', '改进'],
                ['娴ｆ挷绱?', '体验'],
                ['鐠嬪啯鏆?', '调整'],
                ['缁涙盯鈧?', '筛选'],
                ['閹貉傛', '控件'],
                ['閹舵ê褰?', '折叠'],
                ['闂堛垺婢?', '面板'],
                ['閺佹澘绐樼粩', '徽章'],
                ['濞叉槒绌?', '活跃'],
                ['閺€顖涘瘮', '支持'],
                ['妞ょ敻娼?', '页面'],
                ['鏉╂柨娲?', '返回'],
                ['閺佺増宓?', '数据'],
                ['鐟欙箑褰?', '触发'],
                ['妫板嫯顫?', '预览'],
                ['缂冾噣【', '置顶'],
                ['閸旂姾娴?', '加载'],
                ['娑撳﹣绱?', '上传'],
                ['娣囨繂鐡?', '保存'],
                ['閸掔娀娅?', '删除'],
                ['缂傛牞绶?', '编辑'],
                ['閺囧瓨鏌?', '更新'],
                ['閻撗呭', '照片'],
                ['閸欐垿鈧?', '发送'],
                ['婢惰精瑙?', '失败'],
                ['閹存劕濮?', '成功'],
                ['闁挎瑨顕?', '错误'],
                ['閻╃鍙?', '相关'],
                ['缂冩垹绮?', '网络'],
                ['鐎瑰鍙?', '安全'],
                ['娣囶喖顦?', '修复'],
                ['娴滄帒濮?', '互动'],
                ['鐢牕鐡?', '帖子'],
                ['閻劍鍩?', '用户'],
                ['閸愬懎顔?', '内容'],
                ['閹稿鎸?', '按钮'],
                ['娑撶偓濮?', '举报'],
                ['缁夊娅?', '移除'],
                ['濞撳懐鎮?', '清理'],
                ['閸撳秶顏?', '前端'],
                ['濞堝鏆€', '残留'],
                ['濡€崇础', '模式'],
                ['娴狅絿鐖?', '代码'],
                ['鐠囶叀鈻?', '语言'],
                ['濞翠胶鈻?', '流程'],
                ['閸掑棔闊?', '分享'],
                ['閺嗘澹?', '暗色'],
                ['娑撳顣?', '主题'],
                ['妞ょ澹?', '颜色'],
                ['妫版粏澹?', '颜色'],
                ['娣団€冲娇', '信号'],
                ['瀵倹', '异常'],
                ['婢跺嫮鎮?', '处理'],
                ['鈾?', '❤️'],
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
            function scheduleRepair() {
                if (repairQueued) return;
                repairQueued = true;
                requestAnimationFrame(function() {
                    repairQueued = false;
                    repairNode(document.body);
                });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    repairNode(document.body);
                    scheduleRepair();
                }, { once: true });
            } else {
                repairNode(document.body);
            }

            const observer = new MutationObserver(function(records) {
                let shouldRepair = false;
                for (const record of records) {
                    if (record.type === 'characterData' || record.addedNodes.length || record.attributeName) {
                        shouldRepair = true;
                        break;
                    }
                }
                if (shouldRepair) scheduleRepair();
            });

            observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['title', 'aria-label', 'placeholder', 'alt', 'value', 'data-button-label', 'data-busy-label', 'data-default-label']
            });

            window.__xtjUiTextRepair = repairNode;
        })();

        (function installMagicLoaderV4() {
            if (window.__xtjMagicLoaderV4Installed) return;
            window.__xtjMagicLoaderV4Installed = true;

            var magicHtml = window.xtjMagicLoadingHtml;
            if (typeof magicHtml !== 'function') {
                magicHtml = window.xtjMagicLoadingHtml = function(t, s, v) {
                    return buildMagicLoadingHtml(t, s, v);
                };
            }

            renderChatLoadingState = window.renderChatLoadingState = function(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中...';
                var subtitle = options && options.subtitle ? options.subtitle : '魔法粒子正在聚合';
                var variant = options && options.variant ? String(options.variant) : 'chat-detail';
                el.innerHTML = magicHtml(title, subtitle, variant);
            };

            renderPostFilterUserLoader = window.renderPostFilterUserLoader = function() {
                return magicHtml('加载中...', '筛选用户正在聚合...', 'post-user');
            };

            if (typeof loadFeed === 'function' && !loadFeed.__xtjMagicLoaderV4) {
                var orig = loadFeed;
                loadFeed = window.loadFeed = function(forceRefresh) {
                    var r = orig.apply(this, arguments);
                    var feed = document.getElementById('feed');
                    if (feed && /loading-spinner|loading-text|内容加载中.../.test(feed.innerHTML || '')) {
                        feed.innerHTML = magicHtml(forceRefresh ? '内容刷新中...' : '加载中...', '魔法粒子正在聚合', 'feed');
                    }
                    return r;
                };
                loadFeed.__xtjMagicLoaderV4 = true;
            }

            if (typeof openChat === 'function' && !openChat.__xtjMagicLoaderV4) {
                var origChat = openChat;
                openChat = window.openChat = function(userName) {
                    var r = origChat.apply(this, arguments);
                    var el = document.getElementById('dockChatMessages');
                    if (el && (el.querySelector('.chat-empty') || /加载中.../.test(el.textContent || ''))) {
                        renderChatLoadingState(el, { title: '加载中...', subtitle: '正在打开聊天通道', variant: 'chat-detail' });
                    }
                    return r;
                };
                openChat.__xtjMagicLoaderV4 = true;
            }

            if (typeof openPostDetail === 'function' && !openPostDetail.__xtjMagicLoaderV4) {
                var origPd = openPostDetail;
                openPostDetail = window.openPostDetail = function(postId) {
                    var r = origPd.apply(this, arguments);
                    var body = document.getElementById('postDetailBody');
                    if (body && /loading-spinner|loading-text|加载中.../.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml('加载中...', '魔法粒子正在聚合', 'feed');
                    }
                    return r;
                };
                openPostDetail.__xtjMagicLoaderV4 = true;
            }

            if (typeof openStatDetail === 'function' && !openStatDetail.__xtjMagicLoaderV4) {
                var origSd = openStatDetail;
                openStatDetail = window.openStatDetail = function(type) {
                    var r = origSd.apply(this, arguments);
                    var body = document.getElementById('statModalBody');
                    if (body && /loading-spinner|loading-text|加载中.../.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml('加载中...', '魔法粒子正在聚合', 'feed');
                    }
                    return r;
                };
                openStatDetail.__xtjMagicLoaderV4 = true;
            }

            function patchNode(root) {
                root = root || document;
                if (!root.querySelectorAll) return;
                root.querySelectorAll('.xtj-magic-loading, .xtj-chat-loader, #feed .loading, #statModalBody .loading, #postDetailBody .loading, #dockChatMessages .chat-empty, #dockChatList .chat-empty, #postUserQuickList .post-user-chip--loading').forEach(function(node) {
                    if (!node || node.querySelector('.xtj-magic-loader')) return;
                    var text = (node.textContent || '').replace(/\s+/g, '');
                    if (!text && !node.classList.contains('post-user-chip--loading')) return;
                    var variant = node.classList.contains('post-user-chip--loading') ? 'post-user' : ((node.id === 'dockChatMessages' || node.id === 'dockChatList' || node.classList.contains('xtj-chat-loader')) ? 'chat-list' : 'feed');
                    node.outerHTML = magicHtml('加载中...', node.classList.contains('post-user-chip--loading') ? '筛选用户加载中' : '魔法粒子正在聚合', variant);
                });
            }

            patchNode(document);
            setInterval(function() { patchNode(document); }, 700);
        })();

        (function installCleanStatUiOverrides() {
            if (window.__xtjStatUiOverridesV1) return;
            window.__xtjStatUiOverridesV1 = true;

            function statPostDetailMarkup(post, likes, comments) {
                var vc = (post.views || 0) + 1;
                var mediaHtml = post.media_url ? (
                    post.media_type === 'video'
                        ? '<video src="' + escapeHtml(post.media_url) + '" controls preload="none"></video>'
                        : '<img src="' + escapeHtml(post.media_url) + '" onclick="openImageViewer(\'' + escapeHtml(post.media_url).replace(/'/g, "\\'") + '\')" loading="lazy" />'
                ) : '';
                var canEdit = canEditPost(post);
                var canDel = canEdit && (post.actor_key === deviceId || post.actor_key === currentUser || isAdmin());
                var detailActions = [];
                if (canPinPost(post)) {
                    detailActions.push('<button type="button" class="action-btn pin" data-post-id="' + String(post.id).replace(/'/g, "\\'") + '">' + (normalizePost(post).is_pinned ? '取消置顶' : '置顶') + '</button>');
                }
                if (canEdit) {
                }
                if (canDel) {
                    detailActions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + String(post.id).replace(/'/g, "\\'") + '\', \'' + String(post.actor_key || "").replace(/'/g, "\\'") + '\')">删除</button>');
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
                    '<div class="post-detail-stats">浏览 ' + vc + ' 次· 点赞 ' + likes.length + ' 次· 评论 ' + comments.length + ' 次</div>',
                    '<div class="stat-two-col">',
                    '<div class="stat-col"><div class="stat-section-title">✦ 点赞用户 ' + likes.length + '</div>' +
                        (likes.length ? likes.map(function(l) {
                            return '<div class="stat-like-item"><div class="sli-info"><div class="sli-user">' + escapeHtml(l.user_name) + '</div></div><span class="sli-time">' + new Date(l.created_at).toLocaleString() + '</span></div>';
                        }).join('') : '<div class="stat-empty" style="padding:12px 0;">暂无点赞</div>') +
                    '</div>',
                    '<div class="stat-col"><div class="stat-section-title">💬 评论用户 ' + comments.length + '</div>' +
                        (comments.length ? comments.map(function(c) {
                            return '<div class="stat-comment-item"><div class="sci-info"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><div class="sci-target">' + escapeHtml(c.content) + '</div></div><span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span></div>';
                        }).join('') : '<div class="stat-empty" style="padding:12px 0;">暂无评论</div>') +
                    '</div>',
                    '</div>'
                ].join('');
            }

            renderPostDetail = function(post, likes, comments) {
                var body = document.getElementById('postDetailBody');
                if (!body) return;
                body.innerHTML = statPostDetailMarkup(post, likes, comments);
            };

            function statPostItemMarkup(post) {
                var text = post.content || '';
                var hasImg = post.media_url && post.media_type === 'image';
                var hasVid = post.media_url && post.media_type === 'video';
                var tag = hasImg ? '<span class="spi-img-tag">📷 图片</span>' : (hasVid ? '<span class="spi-img-tag">🎬 视频</span>' : '');
                var summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                var display = summary || (hasImg ? '一张图片' : hasVid ? '一个视频' : '(无内容)');
                var onclick = "openPostDetail('" + String(post.id).replace(/'/g, "\\'") + "')";
                return [
                    '<div class="stat-post-item">',
                    '<span class="spi-content" onclick="' + onclick + '" title="点击查看帖子详情">' + escapeHtml(display) + tag + '</span>',
                    hasImg ? '<img class="spi-thumb" src="' + escapeHtml(post.media_url) + '" onclick="' + onclick + '" title="点击查看帖子详情" />' : '',
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
                    body.innerHTML = '<div class="stat-empty">暂无动态数据</div>';
                    return;
                }
                body.innerHTML = entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    var moreButton = posts.length > 3
                        ? '<div style="text-align:center; padding:8px 0;"><button class="stat-view-btn" onclick="loadUserAllPosts(\'' + String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">查看全部 ' + posts.length + ' 条</button></div>'
                        : '';
                    return [
                        '<div class="stat-user-group">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(name).slice(0, 1).toUpperCase() + '</div><span class="suh-name">' + escapeHtml(name) + '</span></div><span class="suh-count">' + posts.length + ' 条</span></div>',
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
                    '<button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">← 返回总动态</button>',
                    '<div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">',
                    escapeHtml(userName) + ' 的全部帖子（' + userPosts.length + ' 条）',
                    '</div>',
                    userPosts.map(function(p) { return statPostItemMarkup(p); }).join('')
                ].join('');
            };

            renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = getViewHistory();
                if (!history.length) {
                    body.innerHTML = [
                        '<div class="stat-empty">',
                        '<div style="font-size:16px; margin-bottom:8px;">📵 浏览记录</div>',
                        '<div style="font-size:13px;">暂无浏览详情数据</div>',
                        '<div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录浼氬湪浣犳煡鐪嬪笘瀛愭椂自动保存</div>',
                        '<div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录总浏览：已加载</div>'
                    ].join('');
                    return;
                }
                body.innerHTML = history.map(function(v) {
                    return '<div class="stat-view-item"><div class="svi-info"><div class="svi-user">' + escapeHtml(v.user_name) + '</div><div class="svi-target">浏览了<b>' + escapeHtml(v.post_author) + '</b> 的帖子：' + escapeHtml(v.post_content) + '</div></div><span class="svi-time">' + new Date(v.viewed_at).toLocaleString() + '</span></div>';
                }).join('');
            };

            renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var postMap = {};
                statAllPosts.forEach(function(p) { postMap[p.id] = p; });

                function buildLikesCol() {
                    var h = '<div class="stat-section-title">✦ 点赞记录</div>';
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
                    var h = '<div class="stat-section-title">馃挰 评论记录</div>';
                    if (statAllComments.length) {
                        h += statAllComments.slice().reverse().slice(0, 200).map(function(c) {
                            var post = postMap[c.post_id];
                            var postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除帖子)';
                            return '<div class="stat-comment-item"><div class="sci-info"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><div class="sci-target">评论于 ' + postContent + '：' + escapeHtml(c.content) + '</div></div><span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span></div>';
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
                if (title) title.textContent = '帖子详情';
                if (body) body.innerHTML = window.xtjMagicLoadingHtml('加载中...', '加载中...', 'feed');
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
                    posts: '总动态- 按用户分组',
                    views: '总浏览- 浏览记录',
                    likes: '点赞和评论- 记录'
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

                if (body) body.innerHTML = window.xtjMagicLoadingHtml('加载中...', '加载中...', 'feed');
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
                var title = options && options.title ? options.title : '加载中...';
                var subtitle = options && options.subtitle ? options.subtitle : '法阵正在聚能';
                var variant = options && options.variant ? String(options.variant) : '';
                el.innerHTML = window.xtjMagicLoadingHtml(title, subtitle, variant);
            };

            renderPostFilterUserLoader = function() {
                return [
                    '<div class="post-user-chip post-user-chip--loading is-empty">',
                    '<span class="post-user-loader" aria-hidden="true">',
                    '<span class="post-user-loader-ring"></span>',
                    '<span class="post-user-loader-core"></span>',
                    '<span class="post-user-loader-spark"></span>',
                    '</span>',
                    '<span class="post-user-chip-name">加载中.../span>',
                    '</div>'
                ].join('');
            };

            updatePostRecord = async function(post, updates) {
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
                var expectedState = {
                    content: nextContent,
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt
                };
                var direct = await sb.from("posts").update(directPayload).eq("id", post.id);
                if (!direct.error) {
                    try {
                        var verifiedDirect = await sb.from("posts").select("*").eq("id", post.id).maybeSingle();
                        if (!verifiedDirect.error && matchesPostExpectation(verifiedDirect.data, expectedState)) {
                            return { ok: true, fallback: false };
                        }
                    } catch (_) {}
                }

                var message = direct.error ? String(direct.error.message || "") : "";
                var maybeSchemaIssue = /visibility|is_pinned|pinned_at|updated_at|column/i.test(message) || !direct.error;
                if (direct.error && !maybeSchemaIssue) return { ok: false, error: direct.error };

                var fallbackContent = buildPostStorageContent(normalized, nextContent, {
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                });
                var fallback = await sb.from("posts").update({ content: fallbackContent }).eq("id", post.id);
                if (fallback.error) return { ok: false, error: fallback.error };
                try {
                    var verifiedFallback = await sb.from("posts").select("*").eq("id", post.id).maybeSingle();
                    if (verifiedFallback.error || !matchesPostExpectation(verifiedFallback.data, expectedState)) {
                        return { ok: false, error: new Error("帖子状态未实际保存") };
                    }
                } catch (verifyFallbackError) {
                    return { ok: false, error: verifyFallbackError };
                }
                return { ok: true, fallback: true };
            };

            window.saveEditPost = async function() {
                if (!editPostId) return;
                var post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(editPostId); });
                if (!post || !canEditPost(post)) {
                    showToast("无权编辑这条帖子");
                    return;
                }
                var input = document.getElementById("editPostInp");
                var visibility = document.getElementById("editPostVisibility");
                var btn = document.getElementById("saveEditPostBtn");
                var nextContent = input ? input.value.trim() : "";
                var nextVisibility = visibility ? visibility.value : "public";
                if (!nextContent) {
                    showToast("请输入帖子内容");
                    return;
                }
                btn.disabled = true;
                btn.textContent = "保存中...";
                try {
                    var result = await updatePostRecord(post, {
                        content: nextContent.slice(0, 2000),
                        visibility: nextVisibility,
                        updated_at: new Date().toISOString()
                    });
                    if (!result.ok) {
                        showToast("保存失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    closeModal("editPostModal");
                    editPostId = null;
                    await loadFeed(true);
                    showToast(nextVisibility === "private" ? "已改为私密" : "已改为公开");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("保存失败: " + (e && e.message ? e.message : "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
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

                if (body) body.innerHTML = window.xtjMagicLoadingHtml('加载中...', '加载中...', 'feed');
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
})();

