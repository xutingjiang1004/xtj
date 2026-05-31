(function () {
// 注入魔法加载器CSS，确保在任何加载前可用
(function(){if(document.getElementById('xtjMagicLoadingStyleEager'))return;var s=document.createElement('style');s.id='xtjMagicLoadingStyleEager';s.textContent='.xtj-magic-loading{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:260px;padding:28px 16px 24px;text-align:center;isolation:isolate;overflow:hidden}.xtj-magic-loading::before{content:"";position:absolute;inset:-20% -10%;background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.18),transparent 24%),radial-gradient(circle at 45% 48%,rgba(123,213,255,.10),transparent 36%),radial-gradient(circle at 58% 56%,rgba(255,227,154,.10),transparent 38%),radial-gradient(circle at 50% 50%,rgba(181,156,255,.12),transparent 60%);filter:blur(18px);opacity:.96;pointer-events:none;animation:xtjEchoAura 4.2s ease-in-out infinite}.xtj-magic-loading::after{content:"";position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.28) 1px,transparent 1.6px),radial-gradient(circle,rgba(255,227,154,.24) 1px,transparent 1.6px);background-size:92px 92px,146px 146px;background-position:0 0,28px 38px;opacity:.14;pointer-events:none;animation:xtjMagicGridDrift 14s linear infinite}.xtj-echo-stage{position:relative;width:min(72vw,320px);aspect-ratio:1;display:grid;place-items:center;z-index:1;animation:xtjEchoFloat 4.8s ease-in-out infinite;filter:drop-shadow(0 30px 80px rgba(123,213,255,.22))}.xtj-echo-aura{position:absolute;inset:8%;border-radius:50%;background:radial-gradient(circle at 50% 48%,rgba(255,255,255,.88),rgba(255,227,154,.22) 22%,rgba(123,213,255,.16) 44%,rgba(181,156,255,.08) 60%,transparent 72%);filter:blur(8px);opacity:.96;animation:xtjEchoAura 4.2s ease-in-out infinite}.xtj-echo-rune{position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(255,227,154,.38);box-shadow:0 0 0 2px rgba(123,213,255,.08),0 0 60px rgba(255,227,154,.12),inset 0 0 20px rgba(255,227,154,.06);animation:xtjRuneSpin 12s linear infinite}.xtj-echo-rune--inner{inset:14%;border-style:dashed;border-width:1.5px;border-color:rgba(123,213,255,.42);box-shadow:0 0 0 2px rgba(181,156,255,.06),0 0 30px rgba(123,213,255,.14);animation:xtjRuneSpinReverse 7s linear infinite}.xtj-echo-field{position:absolute;inset:16%;border-radius:50%;background:conic-gradient(from 0deg,rgba(255,227,154,.08),rgba(123,213,255,.26),rgba(181,156,255,.16),rgba(255,227,154,.12),rgba(123,213,255,.20),rgba(255,227,154,.08));filter:blur(.5px);animation:xtjAbsorbSwirl 5.6s ease-in-out infinite}.xtj-echo-mirror{position:absolute;inset:24%;border-radius:42% 58% 52% 48%/54% 54% 46% 46%;background:linear-gradient(135deg,rgba(255,255,255,.72),rgba(255,255,255,.18) 28%,rgba(123,213,255,.22) 62%,rgba(255,227,154,.24),rgba(181,156,255,.14));border:1.5px solid rgba(255,247,214,.78);box-shadow:0 0 0 1.5px rgba(255,255,255,.22),0 20px 60px rgba(123,213,255,.22),inset 0 0 36px rgba(255,255,255,.22);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);transform:perspective(900px) rotateY(-12deg) rotateX(5deg);animation:xtjMirrorFloat 4.8s ease-in-out infinite}.xtj-echo-mirror-line{position:absolute;inset:14% 18%;border-radius:inherit;border-top:1.5px solid rgba(255,255,255,.62);border-bottom:1.5px solid rgba(255,227,154,.22);opacity:.78}.xtj-echo-shock{position:absolute;width:24%;aspect-ratio:1;border-radius:50%;border:2.5px solid rgba(255,227,154,.70);box-shadow:0 0 24px rgba(255,227,154,.28);opacity:0;animation:xtjShockLoop 3.2s ease-out infinite}.xtj-echo-bolt{position:absolute;height:7px;border-radius:999px;opacity:0;pointer-events:none;z-index:7}.xtj-echo-bolt--in{right:-26%;top:48%;width:48%;background:linear-gradient(90deg,transparent,#ff7a9c,#ffd1dc,#fff);box-shadow:0 0 22px rgba(255,111,141,.82),0 0 54px rgba(255,111,141,.46);transform:rotate(180deg);animation:xtjIncoming 3.6s ease-in infinite}.xtj-echo-bolt--out{left:44%;top:44%;width:56%;background:linear-gradient(90deg,transparent,#83ddff,#fff1b4,#fff);box-shadow:0 0 24px rgba(123,213,255,.82),0 0 68px rgba(255,227,154,.42);transform:rotate(-24deg);animation:xtjReflected 3.6s ease-out infinite}.xtj-echo-blade{position:absolute;left:38%;top:52%;width:68%;height:10px;border-radius:999px;background:linear-gradient(90deg,transparent,#fff,#ffe39a,transparent);box-shadow:0 0 32px rgba(255,227,154,.88),0 0 88px rgba(255,227,154,.48);clip-path:polygon(0 46%,70% 0,100% 50%,70% 100%,0 54%);opacity:0;transform:rotate(-8deg);animation:xtjBladeSlash 4.8s cubic-bezier(.12,.78,.2,1) infinite;z-index:9}.xtj-echo-shard{position:absolute;width:14px;height:38px;background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(255,218,138,.10));border:1px solid rgba(255,255,255,.48);clip-path:polygon(45% 0,100% 72%,40% 100%,0 24%);filter:drop-shadow(0 0 14px rgba(255,222,140,.68));opacity:.76;z-index:6;animation:xtjShardOrbit 8s linear infinite}.xtj-echo-shard--1{top:13%;left:18%;animation-delay:-1s}.xtj-echo-shard--2{top:19%;right:11%;animation-delay:-3.2s;transform:scale(.82)}.xtj-echo-shard--3{bottom:17%;left:11%;animation-delay:-5.5s;transform:scale(1.12)}.xtj-echo-shard--4{bottom:11%;right:23%;animation-delay:-6.8s;transform:scale(.78)}.xtj-echo-particle{position:absolute;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.98) 0,rgba(255,227,154,.94) 36%,rgba(255,227,154,.06) 74%);box-shadow:0 0 18px rgba(255,227,154,.92);pointer-events:none;z-index:13;animation:xtjParticlePulse 2.4s ease-in-out infinite}.xtj-echo-particle--1{top:22%;left:24%;animation-delay:-.4s}.xtj-echo-particle--2{bottom:22%;right:22%;animation-delay:-1.2s}.xtj-echo-particle--3{bottom:16%;left:50%;margin-left:-4px;animation-delay:-1.8s}.xtj-spark{position:absolute;width:5px;height:5px;border-radius:50%;background:#fff;box-shadow:0 0 12px rgba(181,156,255,.9),0 0 28px rgba(123,213,255,.6);pointer-events:none;z-index:14;animation:xtjSparkDrift 3.6s ease-in-out infinite}.xtj-spark--1{top:10%;left:62%;animation-delay:-.3s;width:4px;height:4px}.xtj-spark--2{top:28%;right:4%;animation-delay:-1.1s;width:6px;height:6px}.xtj-spark--3{bottom:8%;left:34%;animation-delay:-2.0s;width:4px;height:4px}.xtj-spark--4{top:58%;left:6%;animation-delay:-2.6s;width:5px;height:5px}.xtj-spark--5{bottom:28%;right:8%;animation-delay:-3.1s;width:4px;height:4px}.xtj-spark--6{top:42%;right:16%;animation-delay:-1.6s;width:6px;height:6px}.xtj-spark--7{bottom:42%;left:22%;animation-delay:-2.4s;width:4px;height:4px}.xtj-spark--8{top:14%;left:34%;animation-delay:-3.4s;width:5px;height:5px}.xtj-magic-loading-title{position:relative;z-index:1;margin-top:2px;font-size:20px;font-weight:850;letter-spacing:.06em;color:#ffe39a;text-shadow:0 0 28px rgba(255,227,154,.34),0 0 48px rgba(123,213,255,.16)}.xtj-magic-loading-dots{display:flex;gap:7px;position:relative;z-index:1;margin-top:2px}.xtj-magic-loading-dots span{width:6px;height:6px;border-radius:50%;background:rgba(255,227,154,.72);box-shadow:0 0 14px rgba(255,227,154,.30);animation:xtjDot 1.1s ease-in-out infinite}.xtj-magic-loading-dots span:nth-child(2){animation-delay:.14s;background:rgba(123,213,255,.72)}.xtj-magic-loading-dots span:nth-child(3){animation-delay:.28s;background:rgba(181,156,255,.70)}@keyframes xtjMagicGridDrift{to{background-position:0 -90px,28px -52px}}@keyframes xtjEchoAura{0%,100%{transform:scale(.94);opacity:.58}50%{transform:scale(1.06);opacity:1}}@keyframes xtjEchoFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}@keyframes xtjMirrorFloat{0%,100%{transform:perspective(900px) rotateY(-12deg) rotateX(5deg) translateY(0)}50%{transform:perspective(900px) rotateY(-7deg) rotateX(7deg) translateY(-16px)}}@keyframes xtjRuneSpin{to{transform:rotate(360deg)}}@keyframes xtjRuneSpinReverse{to{transform:rotate(-360deg)}}@keyframes xtjAbsorbSwirl{0%,100%{opacity:.42;transform:rotate(0deg) scale(.92)}50%{opacity:.82;transform:rotate(180deg) scale(1.06)}}@keyframes xtjShockLoop{0%,70%{opacity:0;transform:scale(.18)}77%{opacity:.65;transform:scale(.35)}100%{opacity:0;transform:scale(2.8);filter:blur(3px)}}@keyframes xtjIncoming{0%,54%{opacity:0;transform:translateX(0) rotate(180deg) scaleX(.8)}60%{opacity:1}82%{opacity:1;transform:translateX(calc(var(--s)*-.86)) rotate(180deg) scaleX(1.1)}100%{opacity:0;transform:translateX(calc(var(--s)*-.93)) rotate(180deg) scaleX(.25)}}@keyframes xtjReflected{0%,66%{opacity:0;transform:rotate(-24deg) translateX(0) scaleX(.3)}72%{opacity:1}100%{opacity:0;transform:rotate(-24deg) translateX(calc(var(--s)*.78)) scaleX(1.1)}}@keyframes xtjBladeSlash{0%,72%{opacity:0;transform:rotate(-8deg) translateX(-70px) scaleX(.25);filter:blur(4px)}78%{opacity:1;filter:blur(0)}91%{opacity:1;transform:rotate(-8deg) translateX(160px) scaleX(1.18)}100%{opacity:0;transform:rotate(-8deg) translateX(300px) scaleX(.38);filter:blur(2px)}}@keyframes xtjShardOrbit{0%{transform:translateY(0) rotate(0deg);opacity:.26}40%{opacity:.95}100%{transform:translateY(-38px) rotate(360deg);opacity:.26}}@keyframes xtjParticlePulse{0%,100%{opacity:.36;transform:scale(.68)}50%{opacity:1;transform:scale(1.16)}}@keyframes xtjSparkDrift{0%,100%{transform:translate(0,0) scale(.6);opacity:.3}25%{transform:translate(14px,-18px) scale(1.2);opacity:.9}50%{transform:translate(-8px,-32px) scale(.7);opacity:.6}75%{transform:translate(-16px,-14px) scale(1.1);opacity:.88}}@keyframes xtjDot{0%,100%{transform:translateY(0);opacity:.42}50%{transform:translateY(-5px);opacity:1}}@media (prefers-reduced-motion: reduce){.xtj-echo-loader,.xtj-echo-loader *{animation:none!important}}';document.head.appendChild(s);})();
// 注入GPU加速覆盖CSS，确保0/120fps平滑动画
(function(){if(document.getElementById('xtjGPUAccelStyle'))return;var s=document.createElement('style');s.id='xtjGPUAccelStyle';s.textContent='.xtj-magic-loading,.xtj-magic-loading::before,.xtj-magic-loading::after,.xtj-echo-stage,.xtj-echo-aura,.xtj-echo-rune,.xtj-echo-rune--inner,.xtj-echo-field,.xtj-echo-mirror,.xtj-echo-shock,.xtj-echo-bolt,.xtj-echo-blade,.xtj-echo-shard,.xtj-echo-particle,.xtj-spark,.loading,.loading::before,.loading::after,.loading-spinner,.loading-spinner::before,.loading-spinner::after,.loading-spinner .inner-ring,.loading-spinner .magic-glow,.loading-spinner .magic-core,.loading-dots span,.xtj-echo-loader *{will-change:transform,opacity;backface-visibility:hidden;-webkit-backface-visibility:hidden;perspective:1000px;-webkit-perspective:1000px}.xtj-echo-bolt--in,.xtj-echo-bolt--out,.xtj-echo-blade,.xtj-echo-shard{will-change:transform,opacity,filter}.xtj-magic-loading::before,.loading::before{will-change:transform,opacity}.xtj-magic-loading::after,.loading::after{will-change:transform}.loading-spinner .magic-core{backface-visibility:visible}';document.head.appendChild(s);})();
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
            document.getElementById('ppConfirmTitle').textContent = title || '纭操作';
            document.getElementById('ppConfirmMsg').textContent = message || '纭畾瑕佹墽琛屾操作鍚楋紵';
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
                    showToast("鐧诲綍失败，请閲嶈瘯");
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
                        showToast("娉ㄥ唽失败: " + error.message);
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
                    showToast("娉ㄥ唽失败，请閲嶈瘯");
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
                    avatarEl.innerHTML = '<img src="' + showAvatar + '" alt="婢舵潙鍎?>';
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
                                    avatarEl.innerHTML = '<img src="' + cv[currentUser] + '" alt="婢舵潙鍎?>';
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
                            avatarEl.innerHTML = '<img src="' + url + '" alt="婢舵潙鍎?>';
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
                    document.getElementById('upcLogin').textContent = '鏈€杩戠櫥褰曪細加载失败';
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
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="婢舵潙鍎?>';
                        return;
                    }
                } catch(e) {}
                
                // 閸忕厧鐗忛弫銈夊礃閸涱厾鎽犵紓鎾崇摠閺勫墽銇?
                if (avatarCache[currentUser]) {
                    avatarEl.innerHTML = '<img src="' + avatarCache[currentUser] + '" alt="婢舵潙鍎?>';
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
                        avatarEl.innerHTML = '<img src="' + avatarRes.data[0].media_url + '" alt="婢舵潙鍎?>';
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
                    showToast('请选择ͼƬ文件');
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('ͼƬ大小不能超过10MB');
                    return;
                }
                
                showToast('姝ｅ湪鍘嬬缉骞朵笂浼犲ご鍍?.');
                
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
                        showToast('涓婁紶失败: ' + error.message);
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
                    
                    showToast('澶村儚更新鎴愬姛');
                    localStorage.removeItem(CACHE_KEY);
                    await loadFeed(true);
                    avatarCache[currentUser] = avatarUrl;
                    updateAllAvatarElements(avatarUrl);
                } catch(e) {
                    console.error("涓婁紶澶村儚失败:", e);
                    showToast('涓婁紶失败，请閲嶈瘯');
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

            // DEPRECATED_DO_NOT_EDIT ===================== [瀹告彃绨惧鍍?娑撳鏌熼敓?361鐞涘本婀侀敓鏂ゆ嫹閿熸枻鎷烽悧鍫熸拱 =====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                // 鏉堟挸鍙嗛弽锟犵崣閿涙岸妾洪崚鍫曟毐鎼达讣鎷烽敓钘夊箵闂勩倕宓勯梽鈺佸敶閿?
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
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
                btn.textContent = isLiked ? "鈾?宸茶禐" : "鈾?点赞";

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
                btn.textContent = "鎻愪氦涓?..";
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
                    showToast("评论失败: " + (e.message || "鏈煡閿欒"));
                    console.error(e);
                } finally {
                    btn.textContent = "鍙戝竷评论";
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
                btn.textContent = "鍒犻櫎中.";
                try {
                    const key = isAdmin() ? delOwnerKey : deviceId;
                    const { error } = await sb.rpc("delete_post_with_actor", {
                        p_post_id: delPostId,
                        p_actor_key: key
                    });
                    if (error) {
                        showToast("鍒犻櫎失败: " + error.message);
                        return;
                    }
                    closeModal("delModal");
                    showToast("帖子已删除");
                    delPostId = null;
                    await loadFeed(true);
                } catch (e) {
                    showToast("鍒犻櫎甯栧瓙失败");
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
                if (!forceRefresh) feed.innerHTML = '<div class="xtj-magic-loading xtj-echo-loader feed" role="status"><div class="xtj-echo-stage" aria-hidden="true"><div class="xtj-echo-aura"></div><div class="xtj-echo-rune"></div><div class="xtj-echo-rune xtj-echo-rune--inner"></div><div class="xtj-echo-field"></div><div class="xtj-echo-mirror"><div class="xtj-echo-mirror-line"></div></div><div class="xtj-echo-shock"></div><div class="xtj-echo-bolt xtj-echo-bolt--in"></div><div class="xtj-echo-bolt xtj-echo-bolt--out"></div><div class="xtj-echo-blade"></div><div class="xtj-echo-shard xtj-echo-shard--1"></div><div class="xtj-echo-shard xtj-echo-shard--2"></div><div class="xtj-echo-shard xtj-echo-shard--3"></div><div class="xtj-echo-shard xtj-echo-shard--4"></div><div class="xtj-echo-particle xtj-echo-particle--1"></div><div class="xtj-echo-particle xtj-echo-particle--2"></div><div class="xtj-echo-particle xtj-echo-particle--3"></div><div class="xtj-spark xtj-spark--1"></div><div class="xtj-spark xtj-spark--2"></div><div class="xtj-spark xtj-spark--3"></div><div class="xtj-spark xtj-spark--4"></div><div class="xtj-spark xtj-spark--5"></div><div class="xtj-spark xtj-spark--6"></div><div class="xtj-spark xtj-spark--7"></div><div class="xtj-spark xtj-spark--8"></div></div><div class="xtj-magic-loading-title">内容加载中.../div><div class="xtj-magic-loading-dots"><span></span><span></span><span></span></div></div>';
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
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败锛屽埛鏂伴噸详/div>`;
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
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'👍':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">评论</button>
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

            // 缂撳瓨澶村儚URL
            const avatarCache = {};

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
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'鉂わ笍':'点赞'}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">评论</button>
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
                        return { ok: false, error: new Error("甯栧瓙更新鍚庣姸鎬佹湭瀹為檯淇濆瓨") };
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
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(this, \'' + id + '\')">' + (isLiked ? '鉂わ笍' : '点赞') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + id + '\')">评论</button>'
                ];
                if (canEditPost(post)) {
                    actions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + id + '\')">编辑</button>');
                }
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" onclick="togglePostPin(\'' + id + '\')">' + (normalizePost(post).is_pinned ? '取消置顶' : '置顶') + '</button>');
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
                btn.textContent = "淇濆瓨中..";
                try {
                    var result = await updatePostRecord(post, {
                        content: nextContent.slice(0, 2000),
                        visibility: nextVisibility,
                        updated_at: new Date().toISOString()
                    });
                    if (!result.ok) {
                        showToast("淇濆瓨失败: " + ((result.error && result.error.message) || "鏈煡閿欒"));
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
                        throw new Error("淇濆瓨失败锛氬叕寮€/绉樺瘑鐘舵€佹湭瀹為檯淇濆瓨");
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
            window.togglePostPin = async function(postId) {
                var post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                if (!post || !canPinPost(post)) {
                    showToast("无权置顶这条帖子");
                    return;
                }
                var nextPinned = !post.is_pinned;
                var result = await updatePostRecord(post, {
                    is_pinned: nextPinned,
                    pinned_at: nextPinned ? new Date().toISOString() : null
                });
                if (!result.ok) {
                    showToast("置顶操作失败: " + ((result.error && result.error.message) || "未知错误"));
                    return;
                }
                clearFeedCache();
                showToast(nextPinned ? "帖子已置顶" : "已取消置顶");
                await loadFeed(true);
            };
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
                    feed.innerHTML = '<div class="xtj-magic-loading xtj-echo-loader feed" role="status"><div class="xtj-echo-stage" aria-hidden="true"><div class="xtj-echo-aura"></div><div class="xtj-echo-rune"></div><div class="xtj-echo-rune xtj-echo-rune--inner"></div><div class="xtj-echo-field"></div><div class="xtj-echo-mirror"><div class="xtj-echo-mirror-line"></div></div><div class="xtj-echo-shock"></div><div class="xtj-echo-bolt xtj-echo-bolt--in"></div><div class="xtj-echo-bolt xtj-echo-bolt--out"></div><div class="xtj-echo-blade"></div><div class="xtj-echo-shard xtj-echo-shard--1"></div><div class="xtj-echo-shard xtj-echo-shard--2"></div><div class="xtj-echo-shard xtj-echo-shard--3"></div><div class="xtj-echo-shard xtj-echo-shard--4"></div><div class="xtj-echo-particle xtj-echo-particle--1"></div><div class="xtj-echo-particle xtj-echo-particle--2"></div><div class="xtj-echo-particle xtj-echo-particle--3"></div><div class="xtj-spark xtj-spark--1"></div><div class="xtj-spark xtj-spark--2"></div><div class="xtj-spark xtj-spark--3"></div><div class="xtj-spark xtj-spark--4"></div><div class="xtj-spark xtj-spark--5"></div><div class="xtj-spark xtj-spark--6"></div><div class="xtj-spark xtj-spark--7"></div><div class="xtj-spark xtj-spark--8"></div></div><div class="xtj-magic-loading-title">内容加载中.../div><div class="xtj-magic-loading-dots"><span></span><span></span><span></span></div></div>';
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
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败: ' + escapeHtml(err.message || "鏈煡閿欒") + '</div>';
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
                    if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，请鍒锋柊閲嶈瘯</div>';
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
                btn.textContent = "鍒犻櫎娑?..";
                try {
                    var key = isAdmin() ? delOwnerKey : deviceId;
                    var result = await sb.rpc("delete_post_with_actor", {
                        p_post_id: delPostId,
                        p_actor_key: key
                    });
                    if (result.error) {
                        showToast("鍒犻櫎失败: " + result.error.message);
                        return;
                    }
                    clearFeedCache();
                    closeModal("delModal");
                    showToast("帖子已删除");
                    delPostId = null;
                    await loadFeed(true);
                } catch (e) {
                    showToast("鍒犻櫎甯栧瓙失败");
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
                            <div class="stat-section-title">鉂わ笍 点赞用户 ${likes.length}</div>
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
                            <div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录浼氬湪浣犳煡鐪嬪笘瀛愭椂自动保存</div>
                            <div style="font-size:12px; margin-top:8px; opacity:0.7;">褰撳墠宸茶褰曟€绘祻瑙堟暟：{document.getElementById('sViews').textContent} 娆?/div>
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

                        function buildMagicLoadingHtml(title, subtitle, variant) {
                var extra = variant ? ' ' + variant : '';
                return [
                    '<div class="xtj-magic-loading' + extra + '">',
                    '<div class="xtj-echo-stage" aria-hidden="true">',
                    '<div class="xtj-echo-aura"></div>',
                    '<div class="xtj-echo-rune"></div>',
                    '<div class="xtj-echo-rune xtj-echo-rune--inner"></div>',
                    '<div class="xtj-echo-field"></div>',
                    '<div class="xtj-echo-mirror">',
                    '<div class="xtj-echo-mirror-line"></div>',
                    '</div>',
                    '<div class="xtj-echo-shock"></div>',
                    '<div class="xtj-echo-bolt xtj-echo-bolt--in"></div>',
                    '<div class="xtj-echo-bolt xtj-echo-bolt--out"></div>',
                    '<div class="xtj-echo-blade"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--1"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--2"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--3"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--4"></div>',
                    '<div class="xtj-echo-particle xtj-echo-particle--1"></div>',
                    '<div class="xtj-echo-particle xtj-echo-particle--2"></div>',
                    '<div class="xtj-echo-particle xtj-echo-particle--3"></div>',
                    '</div>',
                    '<div class="xtj-magic-loading-title">' + escapeHtml(title || '加载中...') + '</div>',
                    '<div class="xtj-magic-loading-subtitle">' + escapeHtml(subtitle || '法阵正在聚能') + '</div>',
                    '<div class="xtj-magic-loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>',
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
                            // 鐓х墖澧欏埛鏂?
                            window.showToast('姝ｅ湪鍒锋柊鐓х墖澧?..');
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
                    el.classList.add(cls);
                    // Clean up after animation duration + small buffer using rAF
                    var cleanupFrame = Math.round((animDurations[tab] + 50) / (1000 / 60));
                    var frames = 0;
                    function cleanup() {
                        frames++;
                        if (frames >= cleanupFrame) {
                            el.classList.remove(cls);
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
                } catch(e) { showToast('鍙戦€佸け璐? ' + (e?.message || e)); inp.value = content; }
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

                await initUI(); initRainAnimation(); initialLoad();
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
                    showToast('璇疯嚦灏戝～鍐欐爣棰樻垨内容');
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
                    showToast('鍙戝竷失败: ' + (e.message || '鏈煡閿欒'));
                }
            };

            window.deleteAnnouncement = async function(ann) {
                showConfirm('删除公告', '确定要删除这条公告吗？', '纭畾', async function() {
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
                        showToast('鍒犻櫎失败: ' + (e.message || '鏈煡閿欒'));
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

            // ========== 閺囧瓨鏌婇弮銉ョ箶缁崵绮?==========
            const changelogData = [
                {
                    version: 'v0.64',
                    date: '2026-05-31',
                    content: `
                        <h4>Bug 修复涓庝紭鍖栧寲</h4>
                        <ul>
                            <li>修复 core.js 璇硶缁撴瀯閿欒瀵艰嚧椤甸潰瀹屽叏绌虹櫧銆佹棤娉曠偣鍑汇€佹棤数据加载鐨勯棶棰?/li>
                            <li>修复 dock-bar 閬僵灞傞樆姝㈢偣鍑讳氦浜掔殑闂</li>
                            <li>优化寮圭獥鍏抽棴閫昏緫锛欵SC 閿寜浼樺厛绾у叧闂墍鏈夋椿璺冨脊绐?/li>
                            <li>瀹屽杽 photo-wall 绌烘暟鎹笌绌哄紩鐢ㄤ繚鎶ょ殑闃插尽鎬х紪绋?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.62',
                    date: '2026-05-30',
                    content: `
                        <h4>鍔熻兘浼樺寲</h4>
                        <ul>
                            <li>缁涙盯鈧濮涢懗鎴掔喘閸栨牭绱扮亸鍡楀敶閼辨梻鐡柅澶嬪付娴犺埖鏆ｉ崥鍫滆礋閹舵ê褰斿?缁涙盯鈧?閹稿鎸抽棃銏℃緲閿涘本鏁幐浣规た鐠哄啰鐡柅澶庮吀閺佹澘绐樼粩?/li>
                            <li>绉婚櫎甯栧瓙涓炬姤鎸夐挳鍙婂叏閮ㄧ浉鍏充唬鐮侊紝娓呯悊鍓嶇娈嬬暀</li>
                        </ul>
                        <h4>Bug娣囶喖顦?/h4>
                        <ul>
                            <li>娣囶喖顦茬紪杈戠敮鏍х摍閺冭泛鍙曞鈧?缁変礁鐦戦柅澶愩€嶆稉宥囨埂濮濓絿鏁撻弫鍫㈡畱闂傤噣顣?/li>
                            <li>娣囶喖顦茬敮鏍х摍缂冾噣銆婇崝鐔诲厴娑撳秶鏁撻弫鍫㈡畱闂傤噣顣?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.61',
                    date: '2026-05-30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>鍒犻櫎閹碘偓閺堝鍟戞担娆忣槵娴犺姤鏋冩禒韬测偓浣峰閺冩湹鎱ㄦ径宥堝壖閺堫剙鎷板ù瀣槸閼存碍婀?/li>
                            <li>閸忋劑娼板Λ鈧弻銉窗HTML瀵洜鏁ょ€瑰本鏆ｉ幀褋鈧福S鐠囶厽纭堕敍鍫濆弿闁劑鈧俺绻冮敍澶堚偓浣疯础閻焦澹傞幓蹇嬧偓浣告倵缁旑垱婀囬崝锟犵崣鐠?/li>
                        </ul>
                    
                        <h4>椤圭洰浼樺寲</h4>
                        <ul>
                            <li>濞撳懐鎮?js 婢跺洣鍞ら弬鍥︽閵嗕够cripts 閻╊喖缍嶉妴涔簅ot 娣囶喖顦查懘姘拱缁涘容110+ 閸愭ぞ缍戦弬鍥︽</li>
                            <li>娣囶喖顦查弴瀛樻煀閺冦儱绻旀い鐢告桨娑旇京鐖滈梻顕€顣?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.60',
                    date: '2026-05-28',
                    content: `
                        <h4>淇鍐呭</h4>
                        <ul>
                            <li>娣囶喖顦茬紪杈戠敮鏍х摍閸忣剙绱?缁変礁鐦戞稉宥囨埂濮濓絿鏁撻弫鍫ユ６妫?/li>
                            <li>娣囶喖顦茬紒鐔活吀鐠囷附鍎忓▔鍕苟缁変礁鐦戠敮鏍х摍娴滄帒濮?/li>
                            <li>娣囶喖顦查悡褏澧栨０鍕潔閸欏苯鍤紓鈺佺毈/閸欏本瀵氱紓鈺傛杹娑撳秶菙鐎?/li>
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
                            <li>娣囶喖顦叉稉鐐Г閹稿鎸抽悙鐟板毊閺冪姴鎼锋惔鏃堟６妫?/li>
                            <li>娣囶喖顦叉稉鐐Г閹绘劒姘︾€涙顔岄崥宥呭爱闁板稄绱濆ǎ璇插 fallback 閺堝搫鍩?/li>
                            <li>娣囶喖顦查柅姘辩叀瀵偓閸?localStorage key 娑撳秳绔撮懛?/li>
                            <li>娣囶喖顦茬紒鐔活吀鐠囷附鍎忓▔鍕苟缁変礁鐦戠敮鏍х摍娴滄帒濮?/li>
                            <li>娣囶喖顦茬敮鏍х摍鐠囷附鍎忔い鍨￥缁変礁鐦戦弶鍐濡偓閺?/li>
                            <li>娣囶喖顦查崣鎴濈瑯閺傚洣娆㈡稉濠佺炊閺堫亝顥呴弻銉╂晩鐠?/li>
                        </ul>
                        <h4>浼樺寲鍐呭</h4>
                        <ul>
                            <li>閻撗呭婢ф瑧缂夐悾銉ユ禈閸旂姾娴囬柅鐔峰閹绘劕宕?/li>
                            <li>閸樺娅?index.html UTF-8 BOM</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.56',
                    date: '2026-05-26',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li><strong>閸ュ墽澧栭崚鍡氶哺閻滃洣绔撮懛鏉戝娴兼ê瀵?/strong>
                                <ul>
                                    <li>缂佺喍绔寸紓鈺冩殣閸ュ墽鏁撻幋鎰棘閺侀璐?200x1200閸掑棜椴搁悳鍥风礉0.85閸樺缂夌拹銊╁櫤閿涘瞼鈥樻穱婵嗙殱闂堛垻缂夐悾銉ユ禈娑撳骸鐤勯梽鍛敶鐎瑰湱鍙庨悧鍥у瀻鏉堛劎宸煎В鏂剧伐閸滃本绔婚弲鏉垮閺嶅洤鍣€瑰苯鍙忔稉鈧懛?/li>
                                    <li>鐟曞棛娲婇悡褏澧栨晶娆庤⒈婵傛ぞ绗傛导鐘崇ウ缁嬪绱檜pload.js + features.js閿涘绱濇穱婵婄槈閹碘偓閺堝鏌婂铏瑰弾閻楀洤娼庨幐澶岀埠娑撯偓閺嶅洤鍣悽鐔稿灇妤傛宸濋柌蹇曠級閻ｃ儱娴?/li>
                                </ul>
                            </li>
                            <li><strong>鍒犻櫎閸旂喕鍏楿I娑撳簼姘︽禍鎺嶇喘閸?/strong>
                                <ul>
                                    <li>灏嗙郴缁熺骇window.confirm删除纭寮圭獥鏇挎崲涓鸿嚜瀹氫箟鐜荤拑纾ㄧ爞寮圭獥锛屾暣浣揢I椋庢牸缁熶竴</li>
                                    <li>瀵湱鐛ラ柌鍥╂暏闁繑妲戦悳鑽ゆ嫅閺佸牊鐏?+ backdrop-filter: blur(28px) saturate(200%) 婢х偛宸辩壕銊х垶鐠愩劍鍔?/li>
                                    <li>瀵湱鐛ュ鐟板毉閺冩湹绮爏cale(0.9) translateY(20px)楠炶櫕绮︽潻鍥ㄦ诞閸掔増顒滅敮闀愮秴缂冾噯绱濋崝銊ф暰閺囪尙鍤巆ubic-bezier瀵鈧呯处閸?/li>
                                    <li>纭删除鍚庡脊绐椾互scale(0.88)娣″嚭鍔ㄧ敾娑堝け锛岄伄缃╁眰鍚屾娣″寲</li>
                                    <li>閹稿鎸抽崷銊ュЗ閻㈢粯婀￠梻瀵割洣閻劑妲婚柌宥咁槻閻愮懓鍤敍宀€鍋ｉ崙濠氫紕缂冣晛鐪版径鏍劥閸欘垰褰囧☉?/li>
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
                            <li><strong>閻撗呭婢ф瑥鐨濋棃銏℃▔缁€杞版叏婢?/strong>
                                <ul>
                                    <li>浼樺寲photo-wall-item浼厓绱犺瑙夋晥鏋滐紝绉婚櫎澶氬眰娓愬彉鍙犲姞锛岄伩鍏嶇敤鎴锋劅鐭ュ寮犲浘鐗?/li>
                                    <li>閼村鍟块崷鍡欏箚濮濓絿鈥樼仦鍛厬鐎规矮缍呴敍灞剧Х闂勩倛顫嬬憴澶嬭穿娑?/li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭閻愮懓鍤０鍕潔娣囶喖顦?/strong>
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
                        <h4>娣囶喖顦叉稉搴濈喘閸?/h4>
                        <ul>
                            <li><strong>闁剧偓甯存径宥呭煑娴兼ê瀵?/strong>
                                <ul>
                                    <li>娴兼ê鍘涙担璺ㄦ暏閸氬本顒濧PI閿?lt;10ms閿涘绱濋悙鐟板毊閸楄櫕妞傞弰鍓с仛缂佽儻澹婂纭呯儲閸斻劎鏁?/li>
                                </ul>
                            </li>
                            <li><strong>缂╂斁涓庢墜鍔夸紭鍖?/strong>
                                <ul>
                                    <li>ppResetZoom瀹屾暣閲嶇疆閿氱偣鐘舵€侊紝闃叉璺ㄥ浘娈嬬暀</li>
                                    <li>閸欏本瀵氶梻纾嬬獩閸欐ê瀵?lt;10px閸掋倕鐣炬稉鐑樻￥閺佸牊鎼锋担婊愮礉闂冭尪顕ょ拠鍡楀焼</li>
                                </ul>
                            </li>
                            <li><strong>绋冲畾鎬т慨澶?/strong>
                                <ul>
                                    <li>閺傛澘顤僺afeLocalStorageGetJSON閿?5婢跺嫭娴涢幑銏℃建缂佹姬ocalStorage瀹曗晜绨?/li>
                                    <li>绉婚櫎涓炬姤寮圭獥鍐呰仈display:none锛岀粺涓€CSS class鎺у埗</li>
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
                            <li><strong>妫板嫬濮炴潪鎴掔喘閸?/strong>
                                <ul>
                                    <li>瀵ゆ儼绻滈崚鐗堢拨閸斻劌濮╅悽鑽ょ波閺夌喎鎮楅幍褑顢戦敍宀勪缉閸忓秷绁┃鎰彽娴?/li>
                                    <li>缁儳鍣幒褍鍩楁０鍕鏉炶姤鏆熼柌蹇庤礋3瀵媴绱濋幓鎰磳缂傛挸鐡ㄩ崨鎴掕厬閻?/li>
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
                            <li><strong>閻撗呭閸忋劌鐫嗘０鍕潔閸欏本瀵氶弨鎯с亣閹嗗厴娴兼ê瀵?/strong>
                                <ul>
                                    <li>CSS灞傞潰鍚敤GPU纭欢鍔犻€燂細backface-visibility: hidden + transform: translateZ(0) + will-change: transform</li>
                                    <li>閹靛濞嶇化鑽ょ埠闁插秵鐎敍姘额暕閸掑棝鍘inchPre鐎电钖勯柆鍨帳濮ｅ繐鎶欰rray.from閸掑棝鍘ら敍宀勬娴ｅ定C閸樺濮?/li>
                                    <li>閺傛澘顤冪仦蹇撶閸掗攱鏌婇悳鍥殰閸斻劍顥呭ù瀣剁礄rAF娑擃厼鈧吋纭堕敍澶涚礉閼奉亪鈧倸绨?20Hz/90Hz/60Hz鐢囶暕统/li>
                                    <li>viewport娑擃厼绺鹃悙褰掝暕鐠侊紕鐣荤紓鎾崇摠閿涘苯鍣虹亸鎴炵槨鐢冪鐏炩偓閺屻儴顕?/li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭娑撳﹣绱堕懛顏勫З閸樺缂?/strong>
                                <ul>
                                    <li>閺傛澘顤僣ompressToMaxSize閸戣姤鏆熼敍姘瀮娴?10MB閺冩儼鍤滈崝銊ュ竾缂傗晞鍤10MB閿涘苯顦跨痪褔妾风痪褏鐡ラ悾銉礄2560閳?048閳?920閳?280閳?00閸嶅繒绀岄敍?/li>
                                    <li>100MB鐡掑懎銇囬崹瀣弾閻楀洣绡冮懗鍊熷殰閸斻劌甯囩紓鈺佹倵娑撳﹣绱堕敍灞肩瑝閸愬秶娲块幒銉﹀珕缂?/li>
                                    <li>閸樺缂夋径杈Е閺冭泛娲栭柅鈧粵鏍殣閿涙埃澧?0MB閻╁瓨甯存稉濠佺炊閸樼喐鏋冩禒璁圭礉>50MB娑撴柨甯囩紓鈺併亼鐠愩儱鍨捄瀹犵箖</li>
                                    <li>閸樺缂夐崜宥呮倵鐏忓搫顕崸鍥唶瑜版洩绱檉ileSize + originalSize閿涘绱濋弫鐗堝祦闁繑妲戦崣顖濇嫹濠?/li>
                                    <li>Supabase閸忓秷鍨傞悧鍫ユ閸掕泛鍑＄涵顔款吇閿涙碍鏋冩禒璺虹摠閸?GB閿涘苯宕熼弬鍥︽50MB閿涘本婀€鐢箑顔?GB</li>
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
                                    <li>閺嶇懓娲滅€规矮缍呴敍姝爀atures.js娑撶捇enderPhotoWall鐞涖儰绔电憰鍡欐磰娴滃敃ender.js閻ㄥ嫭顒滅涵顔肩杽閻滃府绱濈€佃壈鍤у姝岀箼娴犲海鈹栭弫鎵矋[]濞撳弶鐓?/li>
                                    <li>缁夊娅庨柨娆掝嚖閻ㄥ嫯藟娑撲椒鍞惍渚婄礉閹垹顦瞨ender.js娑擃厼鐣弫瀵告畱閸旂姾娴?閹烘帒绨?濞撳弶鐓嬪ù浣规寜统/li>
                                    <li>娣囶喖顦瞗eatures.js娑擃厼顦挎稉鐙狪FE娴ｆ粎鏁ら崺鐔荤Ш閻ｅ矁鐨熼悽顭掔礄formatPhotoTime閵嗕躬scapeHtml缁涘鍙忕仦鈧崙鑺ユ殶瀵洜鏁ゆ穱顔碱槻閿?/li>
                                </ul>
                            </li>
                            <li><strong>绛涢€夋帓搴忓姛鑳戒慨澶?/strong>
                                <ul>
                                    <li>閺冦儲婀￠妴浣告倳缁夎埇鈧胶鍎规惔锔跨瑏缁夊秵甯撴惔蹇旀蒋娴犲墎骞囬崷銊ㄥ厴濮濓絿鈥樼紒鍕値閻㈢喐鏅?/li>
                                    <li>閹烘帒绨崚鍥ㄥ床閸氬海鍙庨悧鍥х杽閺冭埖娲块弬甯礉缂佹挻鐏夌粭锕€鎮庢０鍕埂闁槒绶?/li>
                                    <li>鍒犻櫎閹垮秳缍旈崥搴ㄥ櫢閺傜増瑕嗛弻鎾茬箽閹镐礁缍嬮崜宥嗗笓鎼村繘鏁敍灞肩瑝閸愬秹鍣哥純顔昏礋姒涙顓婚幒鎺戠碍</li>
                                </ul>
                            </li>
                            <li><strong>閻╃鍞界憴鍡楁禈缁岃櫣娅ф穱顔碱槻</strong>
                                <ul>
                                    <li>閺佺増宓侀柧鎹愮熅娣囶喖顦查崥搴礉閻╃鍞界憴鍡楁禈閸︺劍婀侀悡褏澧栭弮鎯板厴濮濓絿鈥樺〒鍙夌厠"閹稿妫╅張鐔峰瀻缂?閻ㄥ嫮娴夐崘灞藉灙鐞?/li>
                                    <li>娴犲懎婀涵顔肩杽閺冪姷鍙庨悧鍥ㄦ殶閹诡喗妞傞幍宥嗘▔缁€?閺嗗倹妫ら悡褏澧?閹绘劗銇?/li>
                                </ul>
                            </li>
                            <li><strong>鍏ㄥ睆棰勮浜や簰浼樺寲</strong>
                                <ul>
                                    <li>鍙屾寚缂╂斁锛氭柊澧瀙pApplyPinchTransformImmediate鐩存帴搴旂敤transform锛岃烦杩噐AF寤惰繜锛屾彁鍗囪窡鎵嬫劅</li>
                                    <li>閼奉亪鈧倸绨茬敮褔顣╃粻妤嬬窗3鏉?0鐢傝厬閸婂ジ鍣伴弽閿嬵梾濞?20Hz/90Hz/60Hz閸掗攱鏌婇悳鍥风礉缁儳鍣崚鍡涘帳鐢囶暕统/li>
                                    <li>鍥剧墖鍒囨崲娑堥櫎榛戝睆锛歱pDecodeImage棰勫姞杞?+ img.decode()纭繚瑙ｇ爜瀹屾垚鍚庡啀鏄剧ず锛宱pacity骞虫粦杩囨浮</li>
                                    <li>閸撳秴鎮楅崥?瀵姷鍙庨悧鍥ㄥ絹閸撳秹顣╅崝鐘烘祰閿涘苯鐤勯悳浼淬€庡鎴犳畱閸楄櫕妞傞崚鍥ㄥ床</li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭婢ф瑦膩閸ф鍣搁弸鍕旂€规碍鈧傛叏婢?/strong>
                                <ul>
                                    <li>photo-wall.js涓璱nitPhotoWall鍑芥暟閫氳繃window瀵硅薄鏆撮湶锛宑ore.js璋冪敤鏃跺鍔爐ypeof瀹夊叏妫€娴?/li>
                                    <li>preview.js娑擃厺鎱ㄦ径宄眕EventsBound閺嶅洤绻旀担宥忕礉绾喕绻氶棃娆愨偓涓燭ML鐟曞棛娲婄仦鍌欑皑娴犺埖顒滅涵顔剧拨鐎?/li>
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
                                    <li>娣囶喖顦查惄绋垮斀鐟欏棗娴橀弰鍓с仛"閺嗗倹妫ら悡褏澧?閻ㄥ嫮鈹栭惂浠嬫６妫版﹫绱濋悙鐟板毊閻╃鍞介幐澶愭尦濮濓絿鈥橀崝鐘烘祰鐎电懓绨查崘鍛啇</li>
                                    <li>鐎佃壈鍩呴弽蹇涙娑撳﹣绗呭鎴濆З閼奉亜濮╅梾鎰/閺勫墽銇氶敍灞剧セ鐟欏牏鍙庨悧鍥ㄦ娑撳秴鍟€闁喗灏呴崘鍛啇</li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭妫板嫯顫嶆禍銈勭鞍娴兼ê瀵?/strong>
                                <ul>
                                    <li>淇鍏ㄥ睆棰勮涓嬪崟鐐归€€鍑轰笌鍙屽嚮鏀惧ぇ鐨勫啿绐侀棶棰橈紝涓ょ鎿嶄綔浜掍笉骞叉壈</li>
                                    <li>鍒犻櫎閹稿鎸抽崶鐐垼閻?x"閺囨寧宕叉稉鍝勭€崷鐐€奡VG閸ョ偓鐖ｉ敍灞肩瑢閸忔娊妫撮幐澶愭尦濞撳懏娅氶崠鍝勫瀻</li>
                                    <li>娴兼ê瀵插锕€褰稿鎴濆З妫板嫯顫嶉弮鍓佹畱閸ュ墽澧栭崝鐘烘祰缁涙牜鏆愰敍灞剧Х闂勩倝绮︾仦蹇ョ礉闁插洨鏁ら崶鍓у缂傛挸鐡?瀵ゆ儼绻滈崝鐘烘祰閸撳秴鎮楅崶鍓у娴兼ê鍘涚痪褎鏌熷?/li>
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
                                    <li>缂佺喍绔撮棃銏℃緲/妞ょ敻娼伴懗灞炬珯娑撹桨鑵戦幀褑澹婇敍鍫熺ガ閻?濞ｈ京浼嗛敍澶涚礉缁夊娅庣紒鑳閼硅尪鐨熼敍宀冃掗崘鐮砄S鎼存洟鍎寸紒鑳闁繑妯夐梻顕€顣?/li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭婢ф瑥濮涢懗钘夘杻瀵?/strong>
                                <ul>
                                    <li>閺傛澘顤冮崗銊ョ潌濞村繗顫嶅锕€褰稿鎴濆З閸掑洦宕查崶鍓у閸旂喕鍏橀敍灞炬暜閹镐焦澧滈崝鎸庡珛閹疯棄顕遍懜?/li>
                                    <li>棣栧熬杈圭晫澶勭悊锛氱涓€寮犱笉鑳藉乏婊戯紝鏈€鍚庝竴寮犱笉鑳藉彸婊戯紝甯﹂樆鍔涘弽棣堝拰寮瑰洖鍔ㄧ敾</li>
                                    <li>鍙栨秷杩囨浮闂儊锛氫慨澶嶅垏鎹㈠浘鐗囨椂鐨勪綅缃烦璺冨拰闂櫧bug</li>
                                    <li>鍙屾寚缂╂斁浼樺寲锛氱Щ闄AF鎵瑰鐞嗗欢杩燂紝鐩存帴搴旂敤transform瀹炵幇鍘熺敓绾ц窡鎵嬫祦鐣呭害</li>
                                    <li>閺佺繝缍嬪鎴濆З濞翠胶鏅犳惔锔跨喘閸栨牭绱皐ill-change閵嗕辜ransition缁墽绮忛崠鏍ㄥ付閸?/li>
                                </ul>
                            </li>
                            <li><strong>鍝嶅簲寮忛€傞厤</strong>
                                <ul>
                                    <li>楠炶櫕婢橀敍?68px+閿涘绱扮€圭懓娅掑鈥愁啍閵嗕焦娲挎径褏娈戦梻纾嬬獩閸滃苯鐡ф担鎾扁偓浣规瀮缁旂姴宕遍悧鍥х湷娑?/li>
                                    <li>濡楀矂娼伴敍?024px+閿涘绱伴悡褏澧栨晶?閸掓ぜ鈧焦鏋冪粩鐘插幢閻楀洦娲跨€瑰鈧礁鐡ф担鎾存纯婢?/li>
                                    <li>鐎硅棄鐫嗛敍?280px+閿涘绱伴悡褏澧栨晶?閸掓ぜ鈧焦娲挎径姘辨殌閻?/li>
                                    <li>濡亜鐫嗛幍瀣簚娴兼ê瀵查敍姘辩級鐏忓繐绨抽柈銊ヮ嚤閼割亝鐖崡鐘垫暏缁屾椽妫?/li>
                                </ul>
                            </li>
                            <li><strong>浠ｇ爜娓呯悊</strong>
                                <ul>
                                    <li>鍒犻櫎闁鏆€閻ㄥ埇18n缂堟槒鐦ф禒锝囩垳閿涘澅ranslations鐎涙鍚€閵嗕辜ranslatePage閸戣姤鏆熼妴浣筋嚔鐟封偓闁瀚║I閿?/li>
                                    <li>绮剧畝syncProfileUser绛夊嚱鏁帮紝绉婚櫎瀵圭炕璇戝瓧鍏哥殑渚濊禆</li>
                                    <li>缁夊娅巔rofile-lang-tabs閻╃鍙SS閺嶅嘲绱?/li>
                                </ul>
                            </li>
                            <li><strong>Bug娣囶喖顦?/strong>
                                <ul>
                                    <li>娣囶喖顦茬粻锛勬倞閸涙ê褰傞崗顒€鎲￠弮璺烘躬鐢牕鐡欏ù浣疯厬閼奉亜濮╅崚娑樼紦鐢牕鐡欓惃鍒g閿涘潚eed閺屻儴顕楅張顏囩箖濠婎棫NN_MARKER閿?/li>
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
                            <li><strong>娴狅絿鐖滃〒鍛倞娑撳海绨跨粻鈧?/strong>
                                <ul>
                                    <li>褰诲簳绉婚櫎闆呮€濆崟璇嶅涔犵郴缁熷叏閮ㄤ唬鐮侊紙CSS鏍峰紡銆丣S閫昏緫銆丠TML缁撴瀯锛?/li>
                                    <li>鍒犻櫎鐠佸墽鐤嗘い鍏歌厬閻ㄥ嫯瀚崇拠?闂娾晞顕㈤崚鍥ㄥ床闁銆嶉敍灞肩矌娣囨繄鏆€娑擃厽鏋?/li>
                                    <li>濞撳懐鎮婇幍鈧張澶婄熬瀵啰娈戠紙鏄忕槯閺傚洦婀伴崪宀冾嚔鐟封偓閸掑洦宕查惄绋垮彠JS闁槒绶?/li>
                                    <li>娣囶喖顦瞫croll handler娑擃厼顕弮顪紀cab-container閻ㄥ嫰鏁婄拠顖氱穿閻?/li>
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
                            <li><strong>闂嗗懏鈧繂宕熺拠宥囧閸ф鍙忛棃銏ゅ櫢閸嬫矮璐熼悡褏澧栨晶娆欑礄閻╃鍞介崝鐔诲厴閿?/strong>
                                <ul>
                                    <li>鐎瑰苯鍙忛弴鎸庡床panelAi闂堛垺婢樻稉铏瑰弾閻楀洤顣綡TML缂佹挻鐎敍宀€些闂勩倖澧嶉張澶婂礋鐠囧秴顒熸稊鐘垫櫕闂?/li>
                                    <li>濮ｅ繋缍呴悽銊﹀煕閸欘垳瀚粩瀣╃瑐娴肩姷鍙庨悧鍥风礄base64鐎涙ê鍋嶉懛鐮給calStorage閿涘苯宕熷鐘绘閸?0MB閿?/li>
                                    <li>濡亝帖瀵姷缍夐弽鐓庣鐏炩偓閿涘潛rid-template-columns: repeat(5, 1fr)閿涘绱濈粩鏍ㄥ笓閺冪娀妾哄姘З閹烘帒鍨?/li>
                                    <li>閻撗呭閸楋紕澧杊over閺冭埖妯夌粈鍝勫絺鐢啳鈧懎鎮曠粔鑸偓浣稿絺鐢啯妞傞梻娣偓浣圭セ鐟欏牓鍣?/li>
                                    <li>閻愮懓鍤禒缁樺壈閻撗呭鏉╂稑鍙嗛崗銊ョ潌妫板嫯顫嶉敍姘祼鐎规艾鐣炬担宥変紕缂冣晛鐪伴敍灞藉斧閻㈡槒宸濈仦鍛厬鐏炴洜銇?/li>
                                    <li>棰勮椤垫樉绀哄彂甯冪敤鎴枫€佸彂甯冩椂闂淬€佹祻瑙堥噺锛堢偣鍑昏嚜鍔?1璁℃暟锛?/li>
                                    <li>鐓х墖鎸変笂浼犳椂闂村€掑簭鎺掑垪锛堟渶鏂板湪鍓嶏級锛屾敮鎸佹櫤鑳芥椂闂存牸寮忓寲</li>
                                    <li>鐎瑰本鏆SS閺嶅嘲绱￠敍姘卞弾閻楀洤顣剧€圭懓娅掗妴?閸掓缍夐弽绗衡偓浣稿幢閻楀洣姘︽禍鎺嬧偓浣稿弿鐏炲繘顣╃憴鍫涒偓浣圭箒閼瑰弶膩瀵繘鈧倿鍘?/li>
                                    <li>妫板嫯顫嶇仦鍌滃仯閸戞槒鍎楅弲顖氬隘閸╃喐鍨ㄩ崗鎶芥４閹稿鎸抽崸鍥у讲閸忔娊妫?/li>
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
                                    <li>缂佹瑥宕熺拠宥夈€夐棃銏″潑閸旂姴顦查弶鍌涚瑤閸欐姹楅悶鍡氬剹閺咁垽绱濈拋銈渁ckdrop-filter閼崇晫婀″锝呭絺閹搞儱鍤悳鑽ゆ嫅閺佸牊鐏?/li>
                                    <li>閹跺シock-panel閻ㄥ嫭绮撮崝銊ь洣閻㈩煉绱濈拋鈺佸礋鐠囧秹銆夐棃銏ｅ殰瀹歌京顓搁悶鍡樼泊閸旑煉绱濈憴锝呭枀閹烘帞澧楀ǎ铚傝础闂傤噣顣?/li>
                                    <li>鍗＄墖銆侀€夐」銆佸弽棣堥潰鏉块兘娣诲姞鏋佽嚧鐨勭幓鐠冭川鎰燂細澶氬眰杈规銆佸唴楂樺厜銆佸闃村奖銆侀珮寮哄害blur</li>
                                    <li>閹碘偓閺堝鍘撶槐鐘插娴碱亜鍘撶槐鐘荤彯閸忓鐪伴敍灞筋杻瀵櫣骞撻悹鍐畱闁岸鈧繐鎷扮粩瀣╃秼閹?/li>
                                    <li>閸欏秹顩棃銏℃緲缁夎娲杤ocab-scroll闁插矉绱濈憴锝呭枀闁喗灏呴柅澶愩€嶉惃鍕６妫?/li>
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
                            <li><strong>娣囶喖顦茬€靛綊鏁婇棅铏櫏娑撳秶鏁撻弫鍫ユ６妫?/strong>
                                <ul>
                                    <li>淇AudioContext琚祻瑙堝櫒鎸傝捣瀵艰嚧鏃犲０锛堝鍔爎esume()鍞ら啋锛?/li>
                                    <li>閹绘劙鐝棅铏櫏闂婃娊鍣洪敍鍧揳in娴?.1閹绘劕宕岄懛?.18閿涘绱濋柨娆掝嚖闂婅櫕鏁奸悽鈺皉iangle濞夈垺娲垮〒鍛珰</li>
                                    <li>椤甸潰棣栨鐐瑰嚮鑷姩瑙ｉ攣闊抽涓婁笅鏂?/li>
                                </ul>
                            </li>
                            <li><strong>淇缁х画鎸夐挳浣嶇疆闈犱笂</strong>
                                <ul>
                                    <li>鐎圭懓娅掓惔鏇㈠劥閸愬懓绔熺捄婵嗩杻閸旂姾鍤?6px閿涘矂鈧銆嶉崠鍝勭俺闁劑妫块梾娆忣杻閸旂姾鍤?0px</li>
                                    <li>鎼存洟鍎磃lex闂傛挳娈禒?0px閹绘劕宕岄懛?6px閿涘本瀵滈柦顔款攽婢х偛濮炴稉濠呯珶鐠?/li>
                                </ul>
                            </li>
                            <li><strong>濞戝弶鈧胶骞撻悹鍐╂櫏閺嬫粌銇囬獮鍛杻瀵?/strong>
                                <ul>
                                    <li>閸楋紕澧栭敍姝砱ba 0.85 + blur(32px) saturate(220%)閿涘矂妲捐ぐ杈╃倳閸?/li>
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
                            <li><strong>闂嗗懏鈧繂宕熺拠宥夈€夐棃銏犲弿闂堛垽鍣搁弸鍕喘閸?/strong>
                                <ul>
                                    <li>淇缁х画鎸夐挳浣嶇疆闈犱笂闂锛屽弽棣堥潰鏉跨Щ鑷冲簳閮ㄧ揣閭荤户缁寜閽?/li>
                                    <li>鐎靛綊鏁婇崣宥夘洯娴犲じ绗夐懗灞藉礋鐠囧秹顥撻弽濂稿櫢閸嬫熬绱版径褍娴橀弽?閸楁洝鐦濋棅铏垼+闁插﹣绠?娓氬褰為悪顒傜彌鐏炴洜銇?/li>
                                    <li>婢х偛濮炵€靛綊鏁婇棅铏櫏閿涘湹eb Audio API 閻㈢喐鍨氶惌顓濈妇閹绘劗銇氶棅绛圭礉濮濓絿鈥橀崡鍥殶/闁挎瑨顕ら梽宥堢殶閿?/li>
                                    <li>閺囨寧宕查崚鍥ㄥ床閸斻劎鏁炬稉铏圭級閺€?濞ｂ€冲弳濞ｂ€冲毉缂佸嫬鎮庨敍灞炬纯閸旂姵绁﹂悾鍛板殰閻?/li>
                                    <li>澧炲己娑叉€佺幓鐠冩晥鏋滐細鑳屾櫙閫忔槑搴︽彁楂樿嚦0.78锛屾ā绯婃彁鍗囪嚦26px</li>
                                    <li>娣囶喖顦查崡鏇＄槤闁插秴顦查梻顕€顣介敍姘暭娑撴椽娈㈤張娲Е閸掓绀傞悧宀€鐣诲▔鏇礉绾喕绻?00鐠囧秴鍙忛柈銊ㄧ枂鐎瑰本澧犻柌宥咁槻</li>
                                </ul>
                            </li>
                            <li><strong>TTS璇煶杩涗竴姝ヤ紭鍖?/strong>
                                <ul>
                                    <li>娴兼ê鍘涢柅澶嬪Google閸︺劎鍤庣拠顓㈢叾閿涘牊娓堕懛顏嗗姧閿涘绱濋崗鑸殿偧閸ョ偤鈧偓閸掓壆閮寸紒鐔活嚔闂?/li>
                                    <li>Google鐠囶參鐓堕柅鐔哄芳0.9/闂婂疇鐨?.0閿涘矂娼狦oogle鐠囶參鐓堕柅鐔哄芳0.95/闂婂疇鐨?.1閸戝繐鐨張鐑橆潾閹?/li>
                                    <li>鐠囶參鐓堕柅澶嬪缂佹挻鐏塴ocalStorage閹镐椒绠欓崠鏍电礉闁灝鍘ら柌宥咁槻閺屻儲澹?/li>
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
                            <li><strong>闂嗗懏鈧繂宕熺拠宥囬兇缂佺喎鍙忛棃顫喘閸?/strong>
                                <ul>
                                    <li>鎺掔増閲嶆柊璁捐锛屾ā鎷熶笉鑳屽崟璇?鐧捐瘝鏂╅鏍硷紝骞插噣鐧藉簳鏃犳偓娴晥鏋?/li>
                                    <li>TTS璇煶浼樺寲锛岃嚜鍔ㄩ€夋嫨鏈€鑷劧鑻辨枃璇煶锛岃閫熸洿鐪熷疄</li>
                                    <li>澧炲姞瀵归敊鏁伴噺璁板綍锛坙ocalStorage鎸佷箙鍖栵級锛屾纭巼杩涘害鏉℃樉绀?/li>
                                    <li>閸楋紕澧栧鎴濆弳/濠婃垵鍤潻鍥ㄦ诞閸斻劎鏁鹃敍灞惧絹閸楀洣姘︽禍鎺撶ウ閻ｅ懎容/li>
                                    <li>闁銆嶉弨閫涜礋2閸掓缍夐弽鐓庣鐏炩偓閿涘瞼鐡熷鍫燁劀绾?闁挎瑨顕ゆ潏瑙勵攱妫版粏澹婇崣宥夘洯</li>
                                </ul>
                            </li>
                            <li><strong>濞撳懐鎮婇柆妤冩殌閺冄傚敩閻?/strong>
                                <ul>
                                    <li>缁夊娅庨弮褏娈?toggleAIChat 閺冪姷鏁ら崙鑺ユ殶</li>
                                    <li>鍒犻櫎閹碘偓閺堝妫獳I濡剝婢橀惄绋垮彠閻ㄥ嫮鐐曠拠鎴︽暛閿涘潊iWelcome閵嗕躬nterYourQuestion閵嗕够end閿?/li>
                                    <li>鍒犻櫎閺冾渿I濮樻梹鍦篊SS閺嶅嘲绱￠敍?ai-msg閿?/li>
                                    <li>鍒犻櫎Taylor Swift閻㈣绮栭弮褌鍞惍渚婄礄initTSGallery閿?/li>
                                </ul>
                            </li>
                            <li><strong>娣囶喖顦睪it閸氬牆鑻熼崘鑼崐鐎佃壈鍤х純鎴犵彲瀹曗晜绨?/strong>
                                <ul>
                                    <li>娣囶喖顦?婢跺嫭鐣悾娆戞畱閸氬牆鑻熼崘鑼崐閺嶅洩顔囬敍鍦昐S/HTML/JS閿涘绱濇い鐢告桨閹垹顦插锝呯埗</li>
                                </ul>
                            </li>
                            <li><strong>闆呮€濆崟璇嶉〉闈㈡恫鎬佺幓鐠冮鏍奸噸鍋?/strong>
                                <ul>
                                    <li>閸欐垿鐓堕幐澶愭尦娴犲穲moji閺€閫涜礋SVG閸犲洤褰崶鐐垼+婢圭増灏濋崝銊ф暰+濞戝弶鈧胶骞撻悹鍐啇閸?/li>
                                    <li>TTS鐠囶參鐓舵导姗€鈧?2缁夊秷鍤滈悞鎯邦嚔闂婄绱橤oogle UK Female/Microsoft Zira缁涘绱氶敍宀冾嚔闁?.85闂婂疇鐨?.05</li>
                                    <li>鍘绘帀渚嬪彞鏈楄锛屽彧鏈楄鍗曡瘝鏈韩</li>
                                    <li>閸楋紕澧?闁【閸欏秹顩棃銏℃緲閸忋劑鍎撮弨閫涜礋濞戝弶鈧胶骞撻悹鍐╂櫏閺嬫粣绱檅ackdrop-filter濮ｆ稓骞撻悹鍐跨礆</li>
                                    <li>闁銆嶉悙鐟板毊濮樺瓨灏濈痪鐟板З閻?濮濓絿鈥樺瑙勨偓褍鑴婄捄?闁挎瑨顕ら幎鏍уЗ閸欏秹顩?/li>
                                    <li>鐎靛綊鏁婇崣宥夘洯閺嶅洭顣介崠鍝勫瀻閺勫墽銇氶敍鍫氭附濮濓絿鈥?閴傚瞼鐡熷鍫熸Ц閿?/li>
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
                                    <li>鐏忓棗甯張澶婂灥娑擃厽鎸夐獮鍐茬唨绾偓鐠囧秵鐪归崗銊╂桨閺囨寧宕叉稉娲长閹繈鐝０鎴ｂ偓鍐仯閸楁洝鐦?/li>
                                    <li>鐠囧秴绨遍幍鈺佸帠閼?00+娑擃亞婀″锝囨畱闂嗗懏鈧繃鐗宠箛鍐槤濮?/li>
                                    <li>鐠囧秵鐪瑰☉鐢垫磰 abandon 閸?yield 缁涘娉ら幀婵嗙箑婢跺洩鐦濆Ч?/li>
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
                        &lt;h4&gt;更新内容&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift &amp; Jennie专题画册更换为雅思单词学习系ͳlt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;删除所有原专题页面的CSS样式（idol-、ts-开头样式）&lt;/li&gt;
                                    &lt;li&gt;新增闆呮€濆崟璇嶅涔犵郴缁熷畬鏁存牱寮忥紙.vocab-鍛藉悕绌洪棿：lt;/li&gt;
                                    &lt;li&gt;鏇挎崲panelAi闈㈡澘HTML缁撴瀯涓哄崟璇嶅涔犵晫闈?lt;/li&gt;
                                    &lt;li&gt;新增200涓泤鎬濇牳蹇冭瘝搴擄紝鍖呭惈鍗曡瘝銆侀煶鏍囥€侀噴涔夈€佷緥鍙?lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;闆呮€濆崟璇嶅涔犵郴缁熷姛鑳?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;双模式学习：英译中模式、中译英模式&lt;/li&gt;
                                    &lt;li&gt;鐐瑰嚮馃敇鎸夐挳鍙湕璇昏嫳鏂囧崟详lt;/li&gt;
                                    &lt;li&gt;答完题自动朗读单词和英文例句&lt;/li&gt;
                                    &lt;li&gt;每次随机生成4个选项供选择&lt;/li&gt;
                                    &lt;li&gt;姝ｇ‘绛旀缁胯壊楂樹寒锛岄敊璇瓟妗堢孩鑹叉姈鍔?lt;/li&gt;
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
                        &lt;h4&gt;鏇存柊鍐呭&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift娑撴捇顣芥い浣冾潒鐟欏绗岄弸鑸电€崗銊╂桨闁插秵鐎?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;鍒犻櫎閹碘偓閺堝妫惃?.ts- 瀵偓婢剁SS閺嶅嘲绱?lt;/li&gt;
                                    &lt;li&gt;閺傛澘顤冮崣灞兼眽娑撴捁绶仦鏇犮仛婢ф瑦鐗卞蹇ョ礄.idol- 閸涜棄鎮曠粚娲？閿?lt;/li&gt;
                                    &lt;li&gt;寮曞叆Google Fonts Great Vibes鎵嬪啓浣?lt;/li&gt;
                                    &lt;li&gt;涓撹緫鍗＄墖hover鏃剁缉鏀?纾ㄧ爞鐜荤拑閬僵鏁堟灉&lt;/li&gt;
                                    &lt;li&gt;SVG缁涙儳鎮曢幓蹇氱珶閸斻劎鏁?鐎圭偛绺炬繅顐㈠帠濞ｂ€冲弳&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;娴狅絿鐖滃〒鍛倞娴兼ê瀵?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;鍒犻櫎閸忋劑鍎碩aylor Swift閻㈣绮朖avaScript娴狅絿鐖?lt;/li&gt;
                                    &lt;li&gt;缁夊娅庢禍宀€楠囬懣婊冨礋閻╃鍙ф惔鐔风磾閸戣姤鏆熺拫鍐暏&lt;/li&gt;
                                    &lt;li&gt;閺囨寧宕查獮鎻掑櫍閻ㄥ墕witchDockTab閸戣姤鏆?lt;/li&gt;
                                    &lt;li&gt;娴狅絿鐖滈弸鑸电€弴鏉戝濞撳懏娅?lt;/li&gt;
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
                                <li>缁涙儳鎮曢幍瀣晸閸斻劎鏁炬潻娑樺弳娑撴捇顣芥い鍨闁插秵鏌婇幘顓熸杹閿涘苯鑻熷В蹇涙閺佹壆顫楀顏嗗箚閹绢厽新/li>
                                <li>12瀵姳绗撴潏鎴炴崳閹躲儲鏁兼稉鐑樺瘻閺冨爼妫块崐鎺戠碍鐏炴洜銇氶敍鍫熸付閺傞绗撴潏鎴濇躬閸撳稄绱?/li>
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
                            <li>Taylor Swift娑撴捇顣芥い闈涘磳缁狙傝礋鐎瑰本鏆?2瀵姴缍嶉棅鍐差吇娑撴捁绶ù閿嬪Г婢?/li>
                            <ul>
                                <li>鏂板evermore銆丮idnights銆乀he Tortured Poets Department銆乀he Life of a Showgirl</li>
                                <li>妞ゅ爼鍎碩aylor Swift缁涙儳鎮曢弨閫涜礋濡剝瀚欓惇鐔风杽閹靛鍟撻幓蹇氱珶閸斻劎鏁?/li>
                                <li>涓撹緫鍗＄墖鍔犲叆鐪熷疄灏侀潰鍥俱€佹捣鎶ュ紡鎺掔増銆佹笎鍏ュ拰鎮仠杩囨浮</li>
                                <li>閺傛澘顤冮崗顒€绱戦悳鏉挎簚閻撗呭閸栧搫鐓欓敍灞筋杻瀵桨绗撴０姗€銆夌憴鍡氼潕鐏炲倹顐?/li>
                            </ul>
                            <li>閺囧瓨鏌?閹存垹娈?妞ょ敻娼伴悧鍫熸拱閸欒渹璐焩0.0.28</li>
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
                                <li>缁夊娅嶥eepSeek AI閼卞﹤銇夐崣澶綪I鐎靛棝鎸?/li>
                                <li>閺傛澘顤僒aylor Swift缁涙儳鎮昐VG閺嶅洭顣?/li>
                                <li>8瀵姳绗撴潏鎴濆幢閻楀洨鏁惧濠忕礄Debut閼风牤olklore閿?/li>
                                <li>濮ｅ繐绱堕崡锛勫濞撴劕鍙嗛崝銊ф暰+閹剙浠犻弨鎯с亣閺佸牊鐏?/li>
                                <li>涓撹緫涓撳睘娓愬彉鑹?SVG瑁呴グ鍥炬爣</li>
                            </ul>
                            <li>閸忋劑娼版禒锝囩垳鐎孤ゎ吀娣囶喖顦?妞ょug</li>
                            <li>娣囶喖顦查懕濠傘亯鏉堟挸鍙嗗鍡楁躬iOS娑撳﹣缍呯純顔肩磽用/li>
                            <li>缁夊娅庨幍鈧張鍫縄閻╃鍙ф禒锝囩垳</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>娣囶喖顦睵C濞村繗顫嶉崳銊﹀ⅵ瀵偓缁岃櫣娅фい鐢告６妫?/li>
                            <li>淇iOS鐏靛姩宀?鍒樻捣灞忓尯鍩熻瑙夐€傞厤</li>
                            <li>淇鐧诲綍鏃堕棿涓嶆洿鏂伴棶棰?/li>
                            <li>娣囶喖顦插▔銊ュ斀閺冨爼妫?閻ц缍嶉弮鍫曟？閺勫墽銇氭稉?-"閻ㄥ嫰妫舵０?/li>
                            <li>iOS Safari濞村繗顫嶉崳銊ョ暚閺佹挳鈧倿鍘?/li>
                            <li>娣囶喖顦叉惔鏇㈠劥鐎佃壈鍩呴弽?闁氨鐓?Toast閸︹暐OS閸掓ɑ鎹ｇ仦蹇庣瑓娴ｅ秶鐤嗗鍌氱埗</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>缂佺喍绔撮崗顒€鎲￠崚妤勩€?鐠囷附鍎?閺囧瓨鏌婇弮銉ョ箶閻ㄥ嫭鐗卞蹇撱亣鐏忓骏绱欑€涙ぞ缍?闂傜绐涢柈鐣岀埠娑撯偓鐠虹喐娲块弬鐗堟）韫囨ぞ绔撮懛杈剧礆</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>瑜拌绨虫穱顔碱槻婢舵潙鍎氶弻銉嚄閿涙碍澧嶉張澶娿仈閸嶅繑鐓＄拠銏犲繁閸掕泛濮?actor_key=__avatar__閿涘苯浜ゆ惔鏇熷笓闂勩倖妫弫鐗堝祦楠炲弶澹?/li>
                            <li>娣囶喖顦查幍瀣簚鎼存洟鍎寸€佃壈鍩呭鈧稉濠囶棟閿涘潷osition:fixed+闁倿鍘ょ€瑰鍙忛崠鍝勭厵閿?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>娣囶喖顦查崗顒€鎲￠崣鎴濈婢惰精瑙ug閿涘牅绗夐悽鈺癷tle閸掓绱滼SON鐎涙ontent閿?/li>
                            <li>娣囶喖顦查悙鐟板毊婢舵潙鍎?娑擃亙姹夌挧鍕灐閺勫墽銇氶弮褍銇旈崓蹇ョ礄maybeSingle閳姡imit(1)+娑撳﹣绱堕崗鍫濆灩閸氬孩褰冮敍灞炬建缂佹繈鍣告径宥堫唶瑜版洩绱?/li>
                            <li>娣囶喖顦查懕濠傘亯閸掓銆冮崝鐘烘祰閹鳖澁绱檒imit 1000閳?00閿涘瞼绱︾€?0缁夋巻鍟?20缁夋帪绱?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>娣囶喖顦查崗鏈电铂閻劍鍩涢惇瀣╃瑝閸掔増娓堕弬鏉裤仈閸嶅骏绱檒oadAvatarsForUsers閹烘帒绨崣鏍ㄦ付閺傚府绱?/li>
                            <li>娣囶喖顦叉惔鏇㈠劥鐎佃壈鍩呴弽蹇撳讲鐞氼偅绮﹂崝銊╂６妫版﹫绱檛ouch-action缁備焦顒涢幍瀣◢閿?/li>
                            <li>瑜拌绨抽崢缁樺竴妞ょ敻娼伴崣鍏呮櫠缁旀牗绮﹂崝銊︽蒋閿涘潝tml/body overflow:hidden閿?/li>
                            <li>娣囶喖顦查惂璇茬秿閺冨爼妫挎稉宥嗘纯閺傜櫚ug閿涘牊鐦″▎鈩冨ⅵ瀵偓妞ょ敻娼伴崚閿嬫煀閻ц缍嶉弮鍫曟？閿?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>淇澶村儚杩囦竴浼氬効鑷姩鍥為€€bug锛坙ocalStorage鏉冨▉浼樺厛锛孌B涓嶅啀瑕嗙洊锛?/li>
                            <li>閸樼粯甯€鐠囧嫯顔戞径鏉戝剼閿涘苯褰ч弰鍓с仛閸氬秴鐡?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>娣囶喖顦查懕濠傘亯閸掓銆冮幍鎾崇磻缁岃櫣娅?閸旂姾娴囬幈銏ゆ６妫?/li>
                            <li>鑱婂ぉ鍒楄〃鍚庡彴棰勫姞杞斤紝鐐瑰紑绉掑嚭</li>
                            <li>褰诲簳鍘绘帀甯栧瓙鍒楄〃鍙充晶绔栨粦鍔ㄦ潯</li>
                            <li>娣囶喖顦茬敮鏍х摍濠婃垵濮╅崡锟犮€?閹惰姤鎮欓幎鏍уЗ閿涘牅绮庡ǎ鈥冲弳娑撯偓濞?閸ュ墽澧栭崝鐘烘祰娴兼ê瀵查敍?/li>
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
                            <li>婢舵潙鍎氶悡褏澧栭崢瀣級鏉╂稐绔村銉ュ櫤鐏忓骏绱?0x80 @0.4閿?/li>
                            <li>淇鏇存崲澶村儚鍚庝笉鏇存柊鐨刡ug</li>
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
                            <li>娣囶喖顦查弴瀛樺床婢舵潙鍎氶崥搴濈瑝閺囧瓨鏌婇惃鍒g閿涘牆浜ゆ惔鏇氭叏婢跺稄绱?/li>
                            <li>鍘绘帀搴曢儴瀵艰埅鏍忕偣鍑绘椂鐨勯粦鑹叉锛堝交搴曚慨澶嶏級</li>
                            <li>鐢牕鐡欓崝鐘烘祰閸斻劎鏁炬禒搴㈢拨閸忋儲鏁奸幋鎰窗閸?/li>
                            <li>娣囶喖顦插▔銊ュ斀閺冨爼妫挎稉搴ｆ瑜版洘妞傞梻瀵告祲閸氬瞼娈慴ug閿涘牆浜ゆ惔鏇氭叏婢跺稄绱?/li>
                            <li>婢舵潙鍎氭稉濠佺炊閸樺缂夋导妯哄閿?28x128閿?/li>
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
                                <li>鐢牕鐡欏鎴濆弳閸斻劎鏁鹃柅鐔峰閸戝繐宕愰敍瀹紃anslateY鐠烘繄顬囬崙蹇撳磹</li>
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
                            <li>澶村儚鐐瑰嚮琛屼负浼樺寲</li>
                            <ul>
                                <li>鐐瑰嚮甯栧瓙鍜岃瘎璁轰腑鐨勫ご鍍忎笉鍐嶇洿鎺ヨ烦杞亰澶?/li>
                                <li>鏂板鐢ㄦ埛璧勬枡鍗＄墖寮圭獥锛屾樉绀哄ご鍍忋€佺敤鎴峰悕銆佹渶杩戠櫥褰曟椂闂?/li>
                                <li>鐠у嫭鏋￠崡锛勫娑擃厾鍋ｉ崙?閸欐垶绉烽幁?閹稿鎸抽幍宥堢儲鏉烆剙鍩岄懕濠傘亯鐎电鐦?/li>
                            </ul>
                            <li>缂佺喕顓搁悧鍫濇健閸旂姾娴囬柅鐔峰娴兼ê瀵?/li>
                            <ul>
                                <li>缂佺喕顓搁弫鐗堝祦婢х偛濮?0缁夋帒鍞寸€涙绱︾€涙﹫绱濇禍灞绢偧閹垫挸绱戠粔鎺戝毉</li>
                                <li>閸氬骸褰存０鍕鏉炵晫绮虹拋鈩冩殶閹诡噯绱濇＃鏍偧閹垫挸绱戞稊鐔告纯韫?/li>
                            </ul>
                            <li>鑱婂ぉ鍔熻兘澶村儚鏄剧ず</li>
                            <ul>
                                <li>閻劍鍩涢懕濠傘亯濞戝牊浼呮晶鐐插閸欏本鏌熸径鏉戝剼閺勫墽銇?/li>
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
                            <li>澶村儚涓婁紶鍘嬬缉浼樺寲</li>
                            <ul>
                                <li>婢舵潙鍎氭稉濠佺炊閸撳秷鍤滈崝銊ュ竾缂傗晞鍤?56x256閿涘瓰PEG鐠愩劑鍣?.7</li>
                                <li>澶у箙鍑忓皯base64浣撶Н锛岄槻姝㈠瓨鍌ㄦ孩鍑哄拰鍔犺浇澶辫触</li>
                                <li>娑撳﹣绱舵径褍鐨梽鎰煑閺€鎯ь啍閼?0MB</li>
                            </ul>
                            <li>閻劍鍩涘▔銊ュ斀/閻ц缍嶉弮鍫曟？瑜拌绨虫穱顔碱槻</li>
                            <ul>
                                <li>闁插秵鐎悽銊﹀煕娣団剝浼呯€涙ê褰囨稉铏圭埠娑撯偓saveUserInfo閸戣姤鏆?/li>
                                <li>update澶辫触鏃惰嚜鍔╢allback鍒癲elete+insert</li>
                                <li>绠＄悊鍛樼櫥褰曞悓鏍锋纭褰曠櫥褰曟椂闂?/li>
                                <li>閸氬骸褰寸敮鏍х摍鐠佲剝鏆熼幒鎺楁珟閻劍鍩涙穱鈩冧紖鐠佹澘缍?/li>
                            </ul>
                            <li>閺佺増宓佹惔鎻淟S缁涙牜鏆愮€瑰苯鏉?/li>
                            <ul>
                                <li>閺傛澘顤僨ix_user_info_rls.sql绾喕绻歎PDATE/DELETE缁涙牜鏆愮€涙ê婀?/li>
                                <li>閹碘晛銇嘺ctor_key閸滃畱ontent闂€鍨闂勬劕鍩?/li>
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
                            <li>婢舵潙鍎氭稉濠佺炊鐎佃壈鍤ч惃鍕箾闁夸線妫舵０妯规叏婢?/li>
                            <ul>
                                <li>娣囶喖顦叉稉濠佺炊婢舵潙鍎氶崥搴＄瑯鐎涙劙銆夋稉鈧惄瀛樻▔缁€?閸旂姾娴囨径杈Е閿涘苯鍩涢弬浼村櫢鐠?閻ㄥ嫪寮楅柌宄泆g</li>
                                <li>娣囶喖顦叉径鏉戝剼base64閺佺増宓侀幘鎴犲瀻localStorage鐎佃壈鍤фい鐢告桨瀹曗晜绨?/li>
                                <li>娣囶喖顦?閹存垹娈戞い鐢告桨"婢舵潙鍎氭稉宥嗘▔缁€铏规畱闂傤噣顣?/li>
                                <li>娣囶喖顦查柅鈧崙铏规瑜版洖鎮楅弮褏绱︾€涙ê鍏遍幍鎵畱闂傤噣顣?/li>
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
                            <li>婢舵潙鍎氶崝鐔诲厴娣囶喖顦?/li>
                            <ul>
                                <li>娣囶喖顦叉径鏉戝剼娑撳﹣绱堕崥搴濈稊娑撳搫绗樼€涙劖妯夌粈铏规畱闂傤噣顣?/li>
                                <li>娣囶喖顦查崚閿嬫煀妞ょ敻娼伴崥搴°仈閸嶅繑绉锋径杈╂畱闂傤噣顣?/li>
                                <li>婢舵潙鍎氭稉濠佺炊閹存劕濮涢崥搴ゅ殰閸斻劌鍩涢弬鐧磂ed閺勫墽銇氶弬鏉裤仈閸?/li>
                                <li>鏇存柊澶村儚缂撳瓨鏈哄埗锛岀‘淇濆ご鍍忔纭樉绀?/li>
                            </ul>
                            <li>閹嗗厴娴兼ê瀵?/li>
                            <ul>
                                <li>娴兼ê瀵茬敮鏍х摍濞撳弶鐓嬮幀褑鍏橀敍宀勵暕閺嬪嫬缂撶拠鍕啈閸滃瞼鍋ｇ挧鐐存Ё鐏忓嫯【/li>
                                <li>閹绘劕宕岄弫缈犵秼濞翠胶鏅犳惔锔肩礉閸戝繐鐨崡锟犮€?/li>
                            </ul>
                            <li>閸忣剙鎲＄化鑽ょ埠娴兼ê瀵?/li>
                            <ul>
                                <li>娣囶喖顦查崗顒€鎲￠崣鎴濈閸栧搫鐓欓崶鍝勭暰娑撳秴濮╅惃鍕６妫版﹫绱濋悳鏉挎躬娴兼岸娈㈤崘鍛啇濠婃艾濮?/li>
                            </ul>
                            <li>閸氬骸褰寸粻锛勬倞娴兼ê瀵?/li>
                            <ul>
                                <li>淇鐢ㄦ埛娉ㄥ唽鍜岀櫥褰曟椂闂翠繚瀛橀棶棰橈紝娣诲姞actor_key纭繚鏁版嵁姝ｇ‘鍐欏叆</li>
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
                                <li>閺€璺哄煂閺傜増绉烽幁顖涙妞ゅ爼鍎村鐟板毉濞戝弶鈧胶骞撻悹鍐棑閺嶅ジ鈧氨鐓?/li>
                                <li>閺勫墽銇氶崣鎴︹偓浣解偓鍛仈閸嶅繈鈧胶鏁ら幋宄版倳閸滃本绉烽幁顖氬敶鐎?/li>
                                <li>闁氨鐓?缁夋帒鎮楅懛顏勫З濞ｂ€冲毉閺€璺烘礀</li>
                                <li>鐐瑰嚮閫氱煡鐩存帴璺宠浆鍒板搴旇亰澶╁璇?/li>
                                <li>鏅鸿兘鍒ゆ柇锛氬凡鍦ㄨ亰澶╂椂涓嶉噸澶嶅脊鍑?/li>
                            </ul>
                            <li>鍚庡彴绠＄悊鍔熻兘淇</li>
                            <ul>
                                <li>娣囶喖顦查弬鐗堟暈閸愬瞼鏁ら幋鍑ょ礄閺冪姴褰傜敮鏍唶瑜版洩绱氭稉宥嗘▔缁€铏规畱闂傤噣顣?/li>
                                <li>纭繚鎵€鏈夋敞鍐岀敤鎴烽兘鑳藉湪鍚庡彴姝ｇ‘灞曠ず</li>
                            </ul>
                            <li>缂佺喕顓告い鐢告桨娴兼ê瀵?/li>
                            <ul>
                                <li>娣囶喖顦茬拠鍕啈鐠佹澘缍嶉弮鍫曟？閹烘帒绨梻顕€顣?/li>
                                <li>閺堚偓閺傛媽鐦庣拋铏瑰箛閸︺劍妯夌粈鍝勬躬閺堚偓娑撳﹥鏌?/li>
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
                            <li>娑擃亙姹夌挧鍕灐缁崵绮洪崗銊╂桨閸楀洨楠?/li>
                            <ul>
                                <li>閺傛澘顤冩稉顏冩眽鐠у嫭鏋＄拠锔藉剰妞ょ绱欐径褍銇旈崓蹇嬧偓浣烘暏閹村嘲鎮曢妴浣烘暏閹寸īD閵嗕焦鏁為崘灞炬闂傝揪绱?/li>
                                <li>閺€顖涘瘮閼奉亜鐣炬稊澶娿仈閸嶅繋绗傛导鐙呯礄閺堚偓婢?MB閿?/li>
                                <li>甯栧瓙鍜岃瘎璁哄尯鍩熸樉绀虹敤鎴疯嚜瀹氫箟澶村儚</li>
                                <li>涓汉璧勬枡椤垫柊澧為€€鍑虹櫥褰曟寜閽?/li>
                            </ul>
                            <li>濞撶顓瑰Ο鈥崇础鐎瑰苯鏉?/li>
                            <ul>
                                <li>閺堫亞娅ヨぐ鏇犳暏閹村嘲褰ч懗鑺ョ叀閻绱濇稉宥堝厴閸欐垵绔?点赞/鐠囧嫯顔?/li>
                                <li>鏈櫥褰曟椂鍙戝竷鍖哄煙鑷姩闅愯棌</li>
                                <li>閻愮懓鍤幙宥勭稊閺冩儼鍤滈崝銊﹀絹缁€铏规瑜?/li>
                            </ul>
                            <li>閸忣剙鎲＄化鑽ょ埠娣囶喖顦?/li>
                            <ul>
                                <li>娣囶喖顦查崗顒€鎲＄拠锔藉剰妞ょ敻娼伴崘鍛啇娑撳秵妯夌粈铏规畱闂傤噣顣?/li>
                            </ul>
                            <li>鍚庡彴绠＄悊鍔熻兘澧炲己</li>
                            <ul>
                                <li>鏂板鐢ㄦ埛娉ㄥ唽鏃堕棿鍜屾渶杩戠櫥褰曟椂闂存樉绀?/li>
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
                                <li>濞ｈ精澹?濞村懓澹婂Ο鈥崇础閸掑洦宕插鈧崗?/li>
                                <li>鐠囶叀鈻堥崚鍥ㄥ床閸旂喕鍏?/li>
                                <li>闁氨鐓＄拋鍓х枂闁【/li>
                                <li>閸忓厖绨惔鏃傛暏娣団剝优/li>
                                <li>缂佺喍绔撮惂鍊熷绾俱劎鐖炴搴㈢壐鐠佹崘顓?/li>
                            </ul>
                            <li>閵嗗本鍨滈惃鍕┾偓宥嗗瘻闁筋喖濮╅悽璁崇喘閸?/li>
                            <ul>
                                <li>鐐瑰嚮鎸夐挳鏃舵樉绀?鏉″僵鑹插厜娉粠灏忎汉鑴戣涓婃柟鏁ｅ皠鐨勫姩鐢?/li>
                            </ul>
                            <li>搴曢儴瀵艰埅鏍忔暣浣撲紭鍖?/li>
                            <ul>
                                <li>AI閼鸿鲸婀归幐澶愭尦閻愮懓鍤懠鍐ㄦ纯鐎靛綊缍?/li>
                                <li>鍥涙寜閽ぇ灏忕粺涓€瑙勮寖</li>
                                <li>瑙嗚骞宠　搴︽彁鍗?/li>
                            </ul>
                            <li>AI妞ょ敻娼伴崝銊ф暰閸楀洨楠?/li>
                            <ul>
                                <li>閼鸿鲸婀归崝銊ф暰閺€閫涜礋闁劗鎽氭鐐存殠閺佸牊鐏夐敍鍫滅瑢鐎佃壈鍩呴弽蹇斿瘻闁筋喕绻氶幐浣风閼疯揪绱?/li>
                                <li>闂數鍒囨崲鎸夐挳鏀逛负SVG鍥炬爣锛岃瑙夋洿绮捐嚧</li>
                                <li>閸斻劎鏁炬潻鍥ㄦ诞閺囧瓨绁﹂悾鍛板殰閻?/li>
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
                                <li>閻劍鍩涢弻銉ф箙閸忣剙鎲￠崚妤勩€冮弮璺虹潔缁€鍝勫彆閸涘﹥鐖ｆ０?/li>
                                <li>閸忣剙鎲＄拠锔藉剰妞ゅ灚鏌婃晶鐐插絺鐢啳鈧懍淇婇幁顖氱潔缁€鐚寸礄婢舵潙鍎?+ 閻劍鍩涢崥宥忕礆</li>
                                <li>绠＄悊鍚庡彴鍏憡鍒楄〃鏂板鏍囬銆佸彂甯冭€呭垪鏄剧ず</li>
                                <li>绠＄悊鍚庡彴鏂板鏍囬杈撳叆妗?/li>
                                <li>閫傞厤娣辫壊/娴呰壊涓婚</li>
                                <li>娣囨繃瀵旈崢鐔告箒閻у€熷绾俱劎鐖炴搴㈢壐缂佺喍绔?/li>
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
                                <li>閸忣剙鎲￠崚妤勩€冩い瑙勭壉瀵繒绮烘稉鈧稉铏规閼硅尙锛堥惍鍌涙櫏閺?/li>
                                <li>鐎瑰苯鍙忕粔濠氭珟閸忣剙鎲￠崘鍛啇閸栧搫鐓欓惃鍕泊閸斻劍娼?/li>
                                <li>缁備焦顒涢崗顒€鎲￠崠鍝勭厵濡亜鎮滈幏鏍ㄥ濠婃艾濮?/li>
                                <li>鍏憡璇︽儏澶撮儴浼樺寲甯冨眬锛屼慨澶嶅垹闄ゆ寜閽綅缃?/li>
                            </ul>
                            <li>閼卞﹤銇夋稉宥閸栧搫鐓欑憴鍡氼潕缂佺喍绔?/li>
                            <ul>
                                <li>閼卞﹤銇夋潏鎾冲弳閸栧搫鐓欓懗灞炬珯閺€閫涜礋闁繑妲戦敍灞肩瑢閼冲本娅欓懝韫閼?/li>
                                <li>AI鐎圭懓娅掗懗灞炬珯鐎瑰苯鍙忛柅蹇旀閸?/li>
                                <li>AI鏉堟挸鍙嗗鍡愨偓浣鼓佸蹇撳瀼閹广垺瀵滈柦顔衡偓涓処濮樻梹鍦虹紒鐔剁娑撹櫣锛堥惍鍌烆棑閺?/li>
                                <li>娴兼ê瀵睞I濞戝牊浼呭鏃€鍦烘稉搴⑩偓婵娾偓鍐箖缁嬪宕遍悧鍥ㄧ壉瀵?/li>
                            </ul>
                            <li>濞ｈ精澹?濞村懓澹婃稉濠氼暯閸忋劑娼伴柅鍌炲帳</li>
                            <ul>
                                <li>鍏憡绯荤粺娣辫壊妯″紡瀹屽叏瀵归綈鎬诲姩鎬侀鏍?/li>
                                <li>鎵€鏈夊厓绱犳敮鎸佷富棰樿嚜鍔ㄥ垏鎹?/li>
                            </ul>
                            <li>閹嗗厴娑撳孩绁﹂悾鍛娴兼ê瀵?/li>
                            <ul>
                                <li>娴兼ê瀵查崗顒€鎲￠崚妤勩€冮崝銊ф暰閺佸牊鐏?/li>
                                <li>濞ｈ濮瀢ill-change鐏炵偞鈧勫絹閸楀洦瑕嗛弻鎾粹偓褑鍏?/li>
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
                            <li>閺傛澘顤冮崗顒€鎲￠柅姘辩叀缁崵绮?/li>
                            <ul>
                                <li>閸忣剙鎲￠柧鍐憦閹稿鎸抽敍鍫㈡瑜版洖鎮楅崣顖濐潌閿?/li>
                                <li>閺堫亣顕伴崗顒€鎲＄拋鈩冩殶閹绘劗銇?/li>
                                <li>閸忣剙鎲＄拠锔藉剰閺屻儳婀呮稉搴″灙鐞涖劏绻戦崶鐐插閼?/li>
                                <li>鍏憡鍙戝竷涓庡垹闄ょ鐞嗘潈闄?/li>
                            </ul>
                            <li>閺傛澘顤冮悪顒傜彌缁狅紕鎮婇崥搴″酱妞ょ敻娼?/li>
                            <ul>
                                <li>婢舵氨娣惔锔芥殶閹诡喚顓搁悶鍡涙桨閺?/li>
                                <li>閸忣剙鎲￠崣鎴濈缁狅紕鎮?/li>
                                <li>閻劍鍩涢崣濠傚敶鐎硅鏆熼幑顔界叀閻?/li>
                                <li>閸濆秴绨插蹇氼啎鐠侊繝鈧倿鍘?/li>
                            </ul>
                            <li>鍏憡鏁版嵁涓庝富搴旂敤瀹屽叏浜掗€?/li>
                            <li>娴兼ê瀵叉禍銈勭鞍鏉╁洦娴崝銊ф暰閹绘劕宕屽ù浣烘櫊鎼?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>鏇存柊鍐呭</h4>
                        <ul>
                            <li>娴兼ê瀵叉い鍫曞劥鐎佃壈鍩呴弽蹇庢唉娴?/li>
                            <ul>
                                <li>鍘婚櫎閲嶅鑱婂ぉ鍏ュ彛</li>
                                <li>娴兼ê瀵叉惔鏇㈠劥 Dock 閺嶅繒鍋ｉ崙璇插隘閸╃噦绱濋崗浣筋啅濡楀棗顦婚崠鍝勭厵娴溿倓绨?/li>
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
                                <li>闁插秵鏌婄拋鎹愵吀鐢牕鐡欓幐澶愭尦闁姐垻鐟紒妯哄煑閸斻劎鏁?/li>
                                <li>閲嶆柊璁捐鑱婂ぉ鎸夐挳姘旀场鍔ㄧ敾</li>
                                <li>AI閹稿鎸抽弴瀛樺床娑撻缚濮抽張鐢靛敜閺€鍙ョ瑢閼鸿京鎽氳ぐ鎺嶇秴閸斻劎鏁?/li>
                                <li>鎵€鏈夊姩鐢绘敮鎸佹寜閽鍖哄煙鏄剧ず</li>
                                <li>娑撱儲鐗告担璺ㄦ暏CSS @keyframes鐎圭偟骞?/li>
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
                            <li>娑撳銇囬弽绋跨妇閸旂喕鍏橀幐澶愭尦閸忋劍鏌奡VG閸斻劎鏁剧€圭偟骞?/li>
                            <ul>
                                <li>鐢牕鐡欓幐澶愭尦闁姐垻鐟捄顖氱窞缂佹ê鍩楅敍?.5缁夋帪绱?/li>
                                <li>閼卞﹤銇夐幐澶愭尦閹垫挸鐡ч悙閫涚瑢濮樻梹鍦洪崝銊ф暰閿?缁夋帪绱?/li>
                                <li>AI閹稿鎸抽懘澶婂暱閸欐垵鍘滈弫鍫熺亯閿?.8缁夋帪绱?/li>
                                <li>娴ｈ法鏁troke-dasharray/dashoffset閹垛偓閺?/li>
                                <li>缁剧枌SS鐎圭偟骞囬敍灞炬￥鐎规碍妞傞崳銊ょ贩鐠?/li>
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
                            <li>閻劍鍩涚拋銈堢槈缁崵绮?/li>
                            <li>甯栧瓙鍙戝竷涓庢祻瑙?/li>
                            <li>璇勮涓庣偣璧炲姛鑳?/li>
                            <li>缁変椒淇婇懕濠傘亯缁崵绮?/li>
                            <li>AI瀵硅瘽鍔熻兘</li>
                            <li>濞ｈ精澹?濞村懓澹婃稉濠氼暯閸掑洦宕?/li>
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
                            <div class="changelog-version">鉁?${item.version}</div>
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
                ['瀹歌尪顕?', '宸茶'],
                ['閺堫亣顕?', '鏈'],
                ['閸忋劑鍎寸敮鏍х摍', '鍏ㄩ儴甯栧瓙'],
                ['濞屸剝婀侀幍鎯у煂閻╃鍙х敮鏍х摍', '娌℃湁鎵惧埌鐩稿叧甯栧瓙'],
                ['绾喛顓婚幙宥勭稊', '纭操作'],
                ['绾喖鐣剧憰浣瑰⒔鐞涘本顒濋幙宥勭稊閸氭绱?', '纭畾瑕佹墽琛屾操作鍚楋紵'],
                ['绾喛顓?', '纭'],
                ['濞戝牊浼?', '娑堟伅'],
                ['閸忣剙鎲?', '鍏憡'],
                ['娑撳﹣绱舵径杈Е閿涘矁顕柌宥堢槸', '涓婁紶失败，请閲嶈瘯'],
                ['閺冪姵娼堢純顕€銆婃潻娆愭蒋鐢牕鐡?', '鏃犳潈缃《杩欐潯甯栧瓙'],
                ['缂冾噣銆婇幙宥勭稊婢惰精瑙?', '缃《操作失败'],
                ['閺堫亞鐓￠柨娆掝嚖', '鏈煡閿欒'],
                ['缂冩垹绮堕柨娆掝嚖', '网络閿欒'],
                ['濮濓絽婀崚閿嬫煀閻撗呭婢?..', '姝ｅ湪鍒锋柊鐓х墖澧?..'],
                ['閸欐垵绔烽幋鎰', '鍙戝竷鎴愬姛'],
                ['閸掔娀娅庨崗顒€鎲?', '鍒犻櫎鍏憡'],
                ['閸忣剙鎲￠崣鎴濈閹存劕濮?', '鍏憡鍙戝竷鎴愬姛'],
                ['閸欐垿鈧礁銇戠拹?', '鍙戦€佸け璐'],
                ['閸旂喕鍏樻导妯哄', '鍔熻兘优化'],
                ['Bug娣囶喖顦?', 'Bug修复'],
                ['閺傛澘顤?', '新增'],
                ['閺€纭呯箻', '改进'],
                ['娴ｆ挷绱?', '浣撻獙'],
                ['鐠嬪啯鏆?', '璋冩暣'],
                ['缁涙盯鈧?', '绛涢€'],
                ['閹貉傛', '鎺т欢'],
                ['閹舵ê褰?', '鎶樺彔'],
                ['闂堛垺婢?', '闈㈡澘'],
                ['閺佹澘绐樼粩', '寰界珷'],
                ['濞叉槒绌?', '娲昏穬'],
                ['閺€顖涘瘮', '鏀寔'],
                ['妞ょ敻娼?', '椤甸潰'],
                ['鏉╂柨娲?', '杩斿洖'],
                ['閺佺増宓?', '数据'],
                ['鐟欙箑褰?', '瑙﹀彂'],
                ['妫板嫯顫?', '棰勮'],
                ['缂冾噣【', '缃《'],
                ['閸旂姾娴?', '加载'],
                ['娑撳﹣绱?', '涓婁紶'],
                ['娣囨繂鐡?', '淇濆瓨'],
                ['閸掔娀娅?', '鍒犻櫎'],
                ['缂傛牞绶?', '缂栬緫'],
                ['閺囧瓨鏌?', '更新'],
                ['閻撗呭', '鐓х墖'],
                ['閸欐垿鈧?', '鍙戦€'],
                ['婢惰精瑙?', '失败'],
                ['閹存劕濮?', '鎴愬姛'],
                ['闁挎瑨顕?', '閿欒'],
                ['閻╃鍙?', '鐩稿叧'],
                ['缂冩垹绮?', '网络'],
                ['鐎瑰鍙?', '瀹夊叏'],
                ['娣囶喖顦?', '修复'],
                ['娴滄帒濮?', '浜掑姩'],
                ['鐢牕鐡?', '甯栧瓙'],
                ['閻劍鍩?', '鐢ㄦ埛'],
                ['閸愬懎顔?', '内容'],
                ['閹稿鎸?', '鎸夐挳'],
                ['娑撶偓濮?', '涓炬姤'],
                ['缁夊娅?', '绉婚櫎'],
                ['濞撳懐鎮?', '娓呯悊'],
                ['閸撳秶顏?', '鍓嶇'],
                ['濞堝鏆€', '娈嬬暀'],
                ['濡€崇础', '妯″紡'],
                ['娴狅絿鐖?', '浠ｇ爜'],
                ['鐠囶叀鈻?', '璇█'],
                ['濞翠胶鈻?', '娴佺▼'],
                ['閸掑棔闊?', '鍒嗕韩'],
                ['閺嗘澹?', '鏆楄壊'],
                ['娑撳顣?', '涓婚'],
                ['妞ょ澹?', '棰滆壊'],
                ['妫版粏澹?', '棰滆壊'],
                ['娣団€冲娇', '淇″彿'],
                ['瀵倹', '寮傚父'],
                ['婢跺嫮鎮?', '处理'],
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

        (function installMagicLoaderV3() {
            if (window.__xtjMagicLoaderV3Installed) return;
            window.__xtjMagicLoaderV3Installed = true;

            var magicHtml = window.xtjMagicLoadingHtml;
            if (typeof magicHtml !== 'function') {
                magicHtml = function(title, subtitle, variant) {
                    var extra = variant ? ' ' + variant : '';
                    return '<div class="xtj-magic-loading xtj-echo-loader' + extra + '" role="status" aria-live="polite"><div class="xtj-echo-stage" aria-hidden="true"><div class="xtj-echo-aura"></div><div class="xtj-echo-rune"></div><div class="xtj-echo-rune xtj-echo-rune--inner"></div><div class="xtj-echo-field"></div><div class="xtj-echo-mirror"><div class="xtj-echo-mirror-line"></div></div><div class="xtj-echo-shock"></div><div class="xtj-echo-bolt xtj-echo-bolt--in"></div><div class="xtj-echo-bolt xtj-echo-bolt--out"></div><div class="xtj-echo-blade"></div><div class="xtj-echo-shard xtj-echo-shard--1"></div><div class="xtj-echo-shard xtj-echo-shard--2"></div><div class="xtj-echo-shard xtj-echo-shard--3"></div><div class="xtj-echo-shard xtj-echo-shard--4"></div><div class="xtj-echo-particle xtj-echo-particle--1"></div><div class="xtj-echo-particle xtj-echo-particle--2"></div><div class="xtj-echo-particle xtj-echo-particle--3"></div><div class="xtj-spark xtj-spark--1"></div><div class="xtj-spark xtj-spark--2"></div><div class="xtj-spark xtj-spark--3"></div><div class="xtj-spark xtj-spark--4"></div><div class="xtj-spark xtj-spark--5"></div><div class="xtj-spark xtj-spark--6"></div><div class="xtj-spark xtj-spark--7"></div><div class="xtj-spark xtj-spark--8"></div></div><div class="xtj-magic-loading-title">' + escapeHtml(title || '加载中...') + '</div><div class="xtj-magic-loading-subtitle">' + escapeHtml(subtitle || '法阵正在聚能') + '</div><div class="xtj-magic-loading-dots" aria-hidden="true"><span></span><span></span><span></span></div></div>';
                };
            }

            renderChatLoadingState = window.renderChatLoadingState = function(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中...';
                var subtitle = options && options.subtitle ? options.subtitle : '法阵正在聚能';
                var variant = options && options.variant ? String(options.variant) : 'xtj-magic-loading--chat';
                el.innerHTML = magicHtml(title, subtitle, variant);
            };

            renderPostFilterUserLoader = window.renderPostFilterUserLoader = function() {
                return magicHtml('加载中...', '筛选用户正在聚合...', 'post-user');
            };

            if (typeof loadFeed === 'function' && !loadFeed.__xtjMagicLoaderV3) {
                var prevLoadFeed = loadFeed;
                loadFeed = window.loadFeed = function(forceRefresh) {
                    var r = prevLoadFeed.apply(this, arguments);
                    var feed = document.getElementById('feed');
                    if (feed && /loading-spinner|loading-text|内容加载中.../.test(feed.innerHTML || '')) {
                        feed.innerHTML = magicHtml(forceRefresh ? '内容刷新中...' : '加载中...', '加载中...', 'feed');
                    }
                    return r;
                };
                loadFeed.__xtjMagicLoaderV3 = true;
            }

            if (typeof openChat === 'function' && !openChat.__xtjMagicLoaderV3) {
                var prevOpenChat = openChat;
                openChat = window.openChat = function(userName) {
                    var r = prevOpenChat.apply(this, arguments);
                    var el = document.getElementById('dockChatMessages');
                    if (el && (el.querySelector('.chat-empty') || /加载中.../.test(el.textContent || ''))) {
                        renderChatLoadingState(el, { title: '加载中...', subtitle: '正在打开聊天通道', variant: 'chat-detail' });
                    }
                    return r;
                };
                openChat.__xtjMagicLoaderV3 = true;
            }

            if (typeof openPostDetail === 'function' && !openPostDetail.__xtjMagicLoaderV3) {
                var prevOpenPostDetail = openPostDetail;
                openPostDetail = window.openPostDetail = function(postId) {
                    var r = prevOpenPostDetail.apply(this, arguments);
                    var body = document.getElementById('postDetailBody');
                    if (body && /loading-spinner|loading-text|加载中.../.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml('加载中...', '加载中...', 'feed');
                    }
                    return r;
                };
                openPostDetail.__xtjMagicLoaderV3 = true;
            }

            if (typeof openStatDetail === 'function' && !openStatDetail.__xtjMagicLoaderV3) {
                var prevOpenStatDetail = openStatDetail;
                openStatDetail = window.openStatDetail = function(type) {
                    var r = prevOpenStatDetail.apply(this, arguments);
                    var body = document.getElementById('statModalBody');
                    if (body && /loading-spinner|loading-text|加载中.../.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml('加载中...', '加载中...', 'feed');
                    }
                    return r;
                };
                openStatDetail.__xtjMagicLoaderV3 = true;
            }

            function patchNodeLoading(root) {
                root = root || document;
                if (!root.querySelectorAll) return;
                root.querySelectorAll('.xtj-chat-loader, #feed .loading, #statModalBody .loading, #postDetailBody .loading, #dockChatMessages .chat-empty, #dockChatList .chat-empty, #postUserQuickList .post-user-chip--loading').forEach(function(node) {
                    if (!node || node.querySelector('.xtj-magic-loading')) return;
                    var text = (node.textContent || '').replace(/\s+/g, '');
                    if (!text && !node.classList.contains('post-user-chip--loading')) return;
                    var variant = node.classList.contains('post-user-chip--loading') ? 'xtj-magic-loading--compact' : ((node.id === 'dockChatMessages' || node.id === 'dockChatList' || node.classList.contains('xtj-chat-loader')) ? 'xtj-magic-loading--chat' : 'xtj-magic-loading--panel');
                    node.outerHTML = magicHtml('加载中...', node.classList.contains('post-user-chip--loading') ? '绛涢€夌敤鎴锋鍦ㄨ仛合 : '法阵正在聚能', variant);
                });
            }

            patchNodeLoading(document);
            setInterval(function() { patchNodeLoading(document); }, 700);
        })();

        (function installMagicLoaderV2() {
            if (window.__xtjMagicLoaderV2Installed) return;
            window.__xtjMagicLoaderV2Installed = true;

            function ensureMagicLoadingStyles() {
                if (document.getElementById('xtjMagicLoadingStyle')) return;
                var st = document.createElement('style');
                st.id = 'xtjMagicLoadingStyle';
                st.textContent = `
.xtj-magic-loading.xtj-magic-loading--compact{min-height:108px;padding:10px 10px 8px;gap:8px;align-items:flex-start}
.xtj-magic-loading.xtj-magic-loading--compact .xtj-echo-stage{width:min(40vw,126px);height:min(40vw,126px);margin-left:6px}
.xtj-magic-loading.xtj-magic-loading--compact .xtj-magic-loading-title{font-size:14px}
.xtj-magic-loading.xtj-magic-loading--compact .xtj-magic-loading-subtitle{font-size:11px}
.xtj-spark--5{bottom:28%;right:8%;animation-delay:-3.1s;width:4px;height:4px}
.xtj-spark--6{top:42%;right:16%;animation-delay:-1.6s;width:6px;height:6px}
.xtj-spark--7{bottom:42%;left:22%;animation-delay:-2.4s;width:4px;height:4px}
.xtj-spark--8{top:14%;left:34%;animation-delay:-3.4s;width:5px;height:5px}
.xtj-cast-spark{position:absolute;width:5px;height:5px;border-radius:50%;pointer-events:none;z-index:15;animation:xtjCastBurst .9s ease-out forwards}
@keyframes xtjSparkDrift{0%,100%{transform:translate(0,0) scale(.6);opacity:.3}25%{transform:translate(14px,-18px) scale(1.2);opacity:.9}50%{transform:translate(-8px,-32px) scale(.7);opacity:.6}75%{transform:translate(-16px,-14px) scale(1.1);opacity:.88}}
@keyframes xtjCastBurst{0%{transform:translate(0,0) scale(.4);opacity:0}20%{opacity:1;transform:translate(var(--bx),var(--by)) scale(1.4)}100%{opacity:0;transform:translate(var(--bx),var(--by)) scale(0);filter:blur(3px)}}
.xtj-magic-loading-title{position:relative;z-index:1;margin-top:2px;font-size:20px;font-weight:850;letter-spacing:.06em;color:#ffe39a;text-shadow:0 0 28px rgba(255,227,154,.34),0 0 48px rgba(123,213,255,.16)}
.xtj-magic-loading-subtitle{position:relative;z-index:1;font-size:12px;color:rgba(31,41,55,.44)}
.xtj-magic-loading-dots{display:flex;gap:7px;position:relative;z-index:1;margin-top:2px}
.xtj-magic-loading-dots span{width:6px;height:6px;border-radius:50%;background:rgba(255,227,154,.72);box-shadow:0 0 14px rgba(255,227,154,.30);animation:xtjDot 1.1s ease-in-out infinite}
.xtj-magic-loading-dots span:nth-child(2){animation-delay:.14s;background:rgba(123,213,255,.72)}
.xtj-magic-loading-dots span:nth-child(3){animation-delay:.28s;background:rgba(181,156,255,.70)}
@keyframes xtjMagicGridDrift{to{background-position:0 -90px,28px -52px}}
@keyframes xtjEchoAura{0%,100%{transform:scale(.94);opacity:.58}50%{transform:scale(1.06);opacity:1}}
@keyframes xtjEchoFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
@keyframes xtjMirrorFloat{0%,100%{transform:perspective(900px) rotateY(-12deg) rotateX(5deg) translateY(0)}50%{transform:perspective(900px) rotateY(-7deg) rotateX(7deg) translateY(-16px)}}
@keyframes xtjRuneSpin{to{transform:rotate(360deg)}}
@keyframes xtjRuneSpinReverse{to{transform:rotate(-360deg)}}
@keyframes xtjAbsorbSwirl{0%,100%{opacity:.42;transform:rotate(0deg) scale(.92)}50%{opacity:.82;transform:rotate(180deg) scale(1.06)}}
@keyframes xtjShockLoop{0%,70%{opacity:0;transform:scale(.18)}77%{opacity:.65;transform:scale(.35)}100%{opacity:0;transform:scale(2.8);filter:blur(3px)}}
@keyframes xtjIncoming{0%,54%{opacity:0;transform:translateX(0) rotate(180deg) scaleX(.8)}60%{opacity:1}82%{opacity:1;transform:translateX(calc(var(--s)*-.86)) rotate(180deg) scaleX(1.1)}100%{opacity:0;transform:translateX(calc(var(--s)*-.93)) rotate(180deg) scaleX(.25)}}
@keyframes xtjReflected{0%,66%{opacity:0;transform:rotate(-24deg) translateX(0) scaleX(.3)}72%{opacity:1}100%{opacity:0;transform:rotate(-24deg) translateX(calc(var(--s)*.78)) scaleX(1.1)}}
@keyframes xtjBladeSlash{0%,72%{opacity:0;transform:rotate(-8deg) translateX(-70px) scaleX(.25);filter:blur(4px)}78%{opacity:1;filter:blur(0)}91%{opacity:1;transform:rotate(-8deg) translateX(160px) scaleX(1.18)}100%{opacity:0;transform:rotate(-8deg) translateX(300px) scaleX(.38);filter:blur(2px)}}
@keyframes xtjShardOrbit{0%{transform:translateY(0) rotate(0deg);opacity:.26}40%{opacity:.95}100%{transform:translateY(-38px) rotate(360deg);opacity:.26}}
@keyframes xtjParticlePulse{0%,100%{opacity:.36;transform:scale(.68)}50%{opacity:1;transform:scale(1.16)}}
@keyframes xtjDot{0%,100%{transform:translateY(0);opacity:.42}50%{transform:translateY(-5px);opacity:1}}
@media (prefers-reduced-motion: reduce){.xtj-magic-loading,.xtj-magic-loading *,.xtj-echo-loader,.xtj-echo-loader *{animation:none!important}}
                `;
                document.head.appendChild(st);
            }

            function magicLoadingHtml(title, subtitle, variant) {
                ensureMagicLoadingStyles();
                var extra = variant ? ' ' + variant : '';
                return [
                    '<div class="xtj-magic-loading xtj-echo-loader' + extra + '" role="status" aria-live="polite">',
                    '<div class="xtj-echo-stage" aria-hidden="true">',
                    '<div class="xtj-echo-aura"></div>',
                    '<div class="xtj-echo-rune"></div>',
                    '<div class="xtj-echo-rune xtj-echo-rune--inner"></div>',
                    '<div class="xtj-echo-field"></div>',
                    '<div class="xtj-echo-mirror"><div class="xtj-echo-mirror-line"></div></div>',
                    '<div class="xtj-echo-shock"></div>',
                    '<div class="xtj-echo-bolt xtj-echo-bolt--in"></div>',
                    '<div class="xtj-echo-bolt xtj-echo-bolt--out"></div>',
                    '<div class="xtj-echo-blade"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--1"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--2"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--3"></div>',
                    '<div class="xtj-echo-shard xtj-echo-shard--4"></div>',
                    '<div class="xtj-echo-particle xtj-echo-particle--1"></div>',
                    '<div class="xtj-echo-particle xtj-echo-particle--2"></div>',
                    '<div class="xtj-echo-particle xtj-echo-particle--3"></div>',
                    '<div class="xtj-spark xtj-spark--1"></div>',
                    '<div class="xtj-spark xtj-spark--2"></div>',
                    '<div class="xtj-spark xtj-spark--3"></div>',
                    '<div class="xtj-spark xtj-spark--4"></div>',
                    '<div class="xtj-spark xtj-spark--5"></div>',
                    '<div class="xtj-spark xtj-spark--6"></div>',
                    '<div class="xtj-spark xtj-spark--7"></div>',
                    '<div class="xtj-spark xtj-spark--8"></div>',
                    '</div>',
                    '<div class="xtj-magic-loading-title">' + (window.escapeHtml ? escapeHtml(title || '加载中...') : String(title || '加载中...')) + '</div>',
                    '<div class="xtj-magic-loading-subtitle">' + (window.escapeHtml ? escapeHtml(subtitle || '法阵正在聚能') : String(subtitle || '法阵正在聚能')) + '</div>',
                    '<div class="xtj-magic-loading-dots" aria-hidden="true"><span></span><span></span><span></span></div>',
                    '</div>'
                ].join('');
            }

            window.xtjMagicLoadingHtml = magicLoadingHtml;
            renderChatLoadingState = window.renderChatLoadingState = function(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中...';
                var subtitle = options && options.subtitle ? options.subtitle : '法阵正在聚能';
                var variant = options && options.variant ? String(options.variant) : 'xtj-magic-loading--chat';
                el.innerHTML = magicLoadingHtml(title, subtitle, variant);
            };

            renderPostFilterUserLoader = window.renderPostFilterUserLoader = function() {
                return magicLoadingHtml('加载中...', '筛选用户正在聚合...', 'post-user');
            };

            if (typeof openChat === 'function' && !openChat.__xtjMagicLoaderV2) {
                var originalOpenChat = openChat;
                openChat = window.openChat = function(userName) {
                    var r = originalOpenChat.apply(this, arguments);
                    var el = document.getElementById('dockChatMessages');
                    if (el && (el.querySelector('.chat-empty') || /加载中.../.test(el.textContent || ''))) {
                        window.renderChatLoadingState(el, {
                            title: '加载中...,
                            subtitle: '正在打开聊天通道',
                            variant: 'chat-detail'
                        });
                    }
                    return r;
                };
                openChat.__xtjMagicLoaderV2 = true;
            }

            if (typeof loadFeed === 'function' && !loadFeed.__xtjMagicLoaderV2) {
                var originalLoadFeed = loadFeed;
                loadFeed = window.loadFeed = function(forceRefresh) {
                    var r = originalLoadFeed.apply(this, arguments);
                    var feed = document.getElementById('feed');
                    if (feed && /loading-spinner|loading-text|内容加载中.../.test(feed.innerHTML || '')) {
                        feed.innerHTML = magicLoadingHtml(forceRefresh ? '内容刷新中...' : '加载中...', '加载中...', 'feed');
                    }
                    return r;
                };
                loadFeed.__xtjMagicLoaderV2 = true;
            }

            if (typeof openPostDetail === 'function' && !openPostDetail.__xtjMagicLoaderV2) {
                var originalOpenPostDetail = openPostDetail;
                openPostDetail = window.openPostDetail = function(postId) {
                    var r = originalOpenPostDetail.apply(this, arguments);
                    var body = document.getElementById('postDetailBody');
                    if (body && /loading-spinner|loading-text|加载中.../.test(body.innerHTML || '')) {
                        body.innerHTML = magicLoadingHtml('加载中...', '加载中...', 'feed');
                    }
                    return r;
                };
                openPostDetail.__xtjMagicLoaderV2 = true;
            }

            if (typeof openStatDetail === 'function' && !openStatDetail.__xtjMagicLoaderV2) {
                var originalOpenStatDetail = openStatDetail;
                openStatDetail = window.openStatDetail = function(type) {
                    var r = originalOpenStatDetail.apply(this, arguments);
                    var body = document.getElementById('statModalBody');
                    if (body && /loading-spinner|loading-text|加载中.../.test(body.innerHTML || '')) {
                        body.innerHTML = magicLoadingHtml('加载中...', '加载中...', 'feed');
                    }
                    return r;
                };
                openStatDetail.__xtjMagicLoaderV2 = true;
            }

            function patchQuickUserLoader() {
                var list = document.getElementById('postUserQuickList');
                if (!list) return;
                list.querySelectorAll('.post-user-chip--loading').forEach(function(node) {
                    if (node.querySelector('.xtj-magic-loading')) return;
                    node.innerHTML = magicLoadingHtml('加载中...', '筛选用户正在聚合...', 'post-user');
                });
            }

            function patchStaticLoadingNodes(root) {
                root = root || document;
                if (!root.querySelectorAll) return;
                var selectors = [
                    '.xtj-chat-loader',
                    '#feed .loading',
                    '#statModalBody .loading',
                    '#postDetailBody .loading',
                    '#dockChatMessages .chat-empty',
                    '#dockChatList .chat-empty'
                ];
                selectors.forEach(function(selector) {
                    root.querySelectorAll(selector).forEach(function(node) {
                        if (!node || node.querySelector('.xtj-magic-loading')) return;
                        if (selector.indexOf('#dockChatList') >= 0 && !/加载中.../.test(node.textContent || '')) return;
                        if (selector.indexOf('#dockChatMessages') >= 0 && !/加载中.../.test(node.textContent || '')) return;
                        var variant = (selector.indexOf('dockChat') >= 0 || selector === '.xtj-chat-loader') ? 'xtj-magic-loading--chat' : 'xtj-magic-loading--panel';
                        node.outerHTML = magicLoadingHtml('加载中...', '法阵正在聚能', variant);
                    });
                });
                patchQuickUserLoader();
            }

            patchStaticLoadingNodes(document);
            var magicLoaderObserver = new MutationObserver(function() {
                clearTimeout(magicLoaderObserver._t);
                magicLoaderObserver._t = setTimeout(function() {
                    patchStaticLoadingNodes(document);
                }, 40);
            });
            magicLoaderObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

            var patchRafPending = false;
            function rafPatchStatic() {
                if (patchRafPending) return;
                patchRafPending = true;
                requestAnimationFrame(function() {
                    patchRafPending = false;
                    patchStaticLoadingNodes(document);
                });
            }
            var patchIntervalWorker = setInterval(function() {
                rafPatchStatic();
            }, 2000);
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
                return [
                    '<div class="post-detail-header"><div class="pdh-left">',
                    '<div class="pdh-name">' + escapeHtml(post.user_name) + '</div>',
                    '<div class="pdh-time">' + new Date(post.created_at).toLocaleString() + '</div>',
                    '</div></div>',
                    post.content ? '<div class="post-detail-content">' + escapeHtml(post.content) + '</div>' : '',
                    mediaHtml ? '<div class="post-detail-media">' + mediaHtml + '</div>' : '',
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
                    var h = '<div class="stat-section-title">鉂わ笍 点赞记录</div>';
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
                            return '<div class="stat-comment-item"><div class="sci-info"><div class="sci-user">' + escapeHtml(c.user_name) + '</div><div class="sci-target">评论了 + postContent + '： + escapeHtml(c.content) + '</div></div><span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span></div>';
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
                        return { ok: false, error: new Error("甯栧瓙鐘舵€佹湭瀹為檯淇濆瓨") };
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
                btn.textContent = "淇濆瓨中..";
                try {
                    var result = await updatePostRecord(post, {
                        content: nextContent.slice(0, 2000),
                        visibility: nextVisibility,
                        updated_at: new Date().toISOString()
                    });
                    if (!result.ok) {
                        showToast("淇濆瓨失败: " + ((result.error && result.error.message) || "鏈煡閿欒"));
                        return;
                    }
                    clearFeedCache();
                    closeModal("editPostModal");
                    editPostId = null;
                    await loadFeed(true);
                    showToast(nextVisibility === "private" ? "宸叉敼涓虹瀵? : "宸叉敼涓哄叕寮€");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("淇濆瓨失败: " + (e && e.message ? e.message : "网络閿欒"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
                }
            };

            window.openStatDetail = async function(type) {
                statCurrentType = type;
                var titles = {
                    posts: '总动态- 按用户分组,
                    views: '鎬绘祻瑙?- 浏览记录',
                    likes: '点赞和评论- 记录'
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

