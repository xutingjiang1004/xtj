(function () {
            const SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
            const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";
            if (typeof window.supabase === 'undefined') {
                var feedEl = document.getElementById('feed');
                if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">鏈嶅姟鍔犺浇澶辫触锛岃鍒锋柊椤甸潰閲嶈瘯</div>';
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
        const CACHE_DURATION = 5 * 60 * 1000; // 缂撳瓨5鍒嗛挓

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
                el.textContent = "鍏ㄩ儴甯栧瓙";
            } else if (!count) {
                el.textContent = "没有找到相关帖子";
            } else {
                el.textContent = "找到 " + count + " 条结果";
            }
        }
        window.renderFilterSummary = renderFilterSummary;

        // ========== 閻樿埖鈧胶顓搁悶鍡楁嚒閸氬秶鈹栭梻杈剧礄閸氭垵鎮楅崗鐓庮啇閿?==========
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

        function getThemeToggleIconSvg(isDark) {
            if (isDark) {
                return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path></svg>';
            }
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2.5"></path><path d="M12 19.5V22"></path><path d="M4.93 4.93 6.7 6.7"></path><path d="M17.3 17.3 19.07 19.07"></path><path d="M2 12h2.5"></path><path d="M19.5 12H22"></path><path d="M4.93 19.07 6.7 17.3"></path><path d="M17.3 6.7 19.07 4.93"></path></svg>';
        }

        function syncThemeToggleIcon(isDark) {
            var icon = document.getElementById('themeToggleIcon');
            if (icon) {
                icon.innerHTML = getThemeToggleIconSvg(!!isDark);
                return;
            }
            var themeBtn = document.getElementById('themeToggle');
            if (themeBtn) themeBtn.textContent = isDark ? "🌙" : "☀️";
        }
        window.syncThemeToggleIcon = syncThemeToggleIcon;

        function buildUiButtonIcon(name) {
            var icons = {
                login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0"></path><path d="M4 20c1.8-3.8 5.1-5.7 8-5.7s6.2 1.9 8 5.7"></path></svg>',
                register: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
                publish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7Z"></path></svg>',
                clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
                close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
                cancel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
                save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h10l4 4v14H6z"></path><path d="M8 3v6h8V3"></path><path d="M8 13h8"></path></svg>',
                comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-4.5A4 4 0 0 1 4 15V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"></path></svg>',
                delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="m19 6-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
                confirm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
                back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>',
                message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3 1.5-4.5A7.5 7.5 0 1 1 21 11.5Z"></path></svg>'
            };
            return icons[name] || icons.close;
        }

        function enhanceUiButton(button) {
            if (!button || button.dataset.uiEnhanced === '1') return;
            var iconKey = button.dataset.buttonIcon;
            if (iconKey) {
                var label = button.dataset.buttonLabel || button.textContent.trim();
                button.innerHTML = '<span class="ui-icon ui-button-icon" aria-hidden="true">' + buildUiButtonIcon(iconKey) + '</span><span class="ui-button-text">' + safeText(label) + '</span>';
            }
            button.dataset.uiEnhanced = '1';
        }

        function enhanceUiButtons(root) {
            var scope = root && root.querySelectorAll ? root : document;
            var buttons = scope.querySelectorAll ? scope.querySelectorAll('.ui-button,[data-button-icon]') : [];
            for (var i = 0; i < buttons.length; i++) enhanceUiButton(buttons[i]);
        }
        window.enhanceUiButtons = enhanceUiButtons;
        if (document.body) {
            enhanceUiButtons(document.body);
            if (!window.__xtjUiButtonObserver) {
                window.__xtjUiButtonObserver = new MutationObserver(function(records) {
                    records.forEach(function(record) {
                        for (var i = 0; i < record.addedNodes.length; i++) {
                            var node = record.addedNodes[i];
                            if (node && node.nodeType === 1) enhanceUiButtons(node);
                        }
                    });
                });
                window.__xtjUiButtonObserver.observe(document.body, { childList: true, subtree: true });
            }
        }

        var BUTTON_ICON_SVGS = {
            login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><path d="m10 17 5-5-5-5"></path><path d="M15 12H3"></path></svg>',
            register: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="9.5" cy="7" r="4"></circle><path d="M19 8v6"></path><path d="M16 11h6"></path></svg>',
            publish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4Z"></path></svg>',
            clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3 2 23"></path><path d="M10 6H4l6 7v5l4 2v-5l2-2"></path><path d="M20 10.5 14 4h8l-3 3.5"></path></svg>',
            like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 21-1.9-1.7C5 14.7 2 11.9 2 8.5 2 5.5 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.5 22 8.5c0 3.4-3 6.2-8.1 10.8Z"></path></svg>',
            likeActive: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 21-1.9-1.7C5 14.7 2 11.9 2 8.5 2 5.5 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.5 22 8.5c0 3.4-3 6.2-8.1 10.8Z"></path></svg>',
            comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"></path></svg>',
            message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3 1.5-4.5A7.5 7.5 0 1 1 21 11.5Z"></path></svg>',
            edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
            pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"></path><path d="M5 5h14"></path><path d="M7 5v6l5 4 5-4V5"></path></svg>',
            delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="m19 6-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
            report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16"></path><path d="M4 4h10l-1.5 3L14 10H4"></path></svg>',
            confirm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"></path></svg>',
            cancel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
            back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>',
            close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
            save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path></svg>'
        };

        function getButtonText(button) {
            if (!button) return '';
            var labelEl = button.querySelector('[data-button-label]');
            return labelEl ? labelEl.textContent.trim() : button.textContent.trim();
        }

        function buildButtonInnerHtml(label, iconName) {
            var safeLabel = safeText(label || '');
            var iconSvg = iconName && BUTTON_ICON_SVGS[iconName] ? BUTTON_ICON_SVGS[iconName] : '';
            var iconHtml = iconSvg ? '<span class="ui-icon" aria-hidden="true">' + iconSvg + '</span>' : '';
            return iconHtml + '<span class="btn-label" data-button-label="true">' + safeLabel + '</span>';
        }

        function renderButtonContent(button, label, iconName) {
            if (!button) return;
            var nextLabel = label == null ? getButtonText(button) : String(label);
            var nextIcon = iconName || button.dataset.buttonIcon || '';
            button.dataset.buttonLabel = nextLabel;
            button.dataset.buttonDecorated = nextIcon ? 'true' : 'false';
            if (!nextIcon) {
                button.textContent = nextLabel;
                return;
            }
            button.innerHTML = buildButtonInnerHtml(nextLabel, nextIcon);
        }

        function hydrateButtonContent(button) {
            if (!button) return;
            var label = button.dataset.buttonLabel || getButtonText(button);
            if (!button.dataset.defaultLabel) button.dataset.defaultLabel = label;
            if (!button.dataset.defaultAriaLabel) button.dataset.defaultAriaLabel = button.getAttribute('aria-label') || label;
            renderButtonContent(button, label, button.dataset.buttonIcon || '');
            if (!button.hasAttribute('type')) button.setAttribute('type', 'button');
            if (!button.hasAttribute('aria-busy')) button.setAttribute('aria-busy', 'false');
            button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
            if (!button.dataset.state) button.dataset.state = button.disabled ? 'disabled' : 'idle';
        }

        function hydrateButtons(root) {
            (root || document).querySelectorAll('button[data-button-icon]').forEach(hydrateButtonContent);
        }

        function setButtonLabel(button, label, ariaLabel) {
            if (!button) return;
            var nextLabel = label == null ? (button.dataset.defaultLabel || button.dataset.buttonLabel || getButtonText(button)) : String(label);
            renderButtonContent(button, nextLabel, button.dataset.buttonIcon || '');
            if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        }

        function syncToggleButtonState(button, options) {
            if (!button) return;
            var next = options || {};
            if (next.className) button.classList.toggle(next.className, !!next.active);
            button.dataset.state = next.active ? 'active' : 'idle';
            button.setAttribute('aria-pressed', next.active ? 'true' : 'false');
            if (next.icon) button.dataset.buttonIcon = next.icon;
            setButtonLabel(
                button,
                next.label != null ? next.label : (button.dataset.defaultLabel || button.dataset.buttonLabel || getButtonText(button)),
                next.ariaLabel || button.dataset.defaultAriaLabel || button.dataset.buttonLabel || getButtonText(button)
            );
        }

        function setButtonBusy(button, isBusy, options) {
            if (!button) return;
            var opts = options || {};
            if (button.dataset.buttonIcon && button.dataset.buttonDecorated !== 'true') {
                hydrateButtonContent(button);
            }
            var defaultLabel = button.dataset.defaultLabel || button.dataset.buttonLabel || getButtonText(button);
            var defaultAriaLabel = button.dataset.defaultAriaLabel || button.getAttribute('aria-label') || defaultLabel;
            button.dataset.defaultLabel = defaultLabel;
            button.dataset.defaultAriaLabel = defaultAriaLabel;
            if (isBusy) {
                button.dataset.prevDisabled = button.disabled ? 'true' : 'false';
                button.disabled = true;
                button.setAttribute('aria-disabled', 'true');
                button.setAttribute('aria-busy', 'true');
                button.dataset.state = 'busy';
                setButtonLabel(button, opts.busyLabel || button.dataset.busyLabel || defaultLabel, opts.busyLabel || button.dataset.busyLabel || defaultAriaLabel);
                return;
            }
            var restoreDisabled = button.dataset.prevDisabled === 'true';
            delete button.dataset.prevDisabled;
            button.disabled = restoreDisabled;
            button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
            button.setAttribute('aria-busy', 'false');
            button.dataset.state = opts.state || 'idle';
            setButtonLabel(button, opts.idleLabel || defaultLabel, opts.ariaLabel || defaultAriaLabel);
        }

        async function withButtonBusy(button, options, task) {
            setButtonBusy(button, true, options);
            try {
                return await task();
            } finally {
                setButtonBusy(button, false, options);
            }
        }
        window.withButtonBusy = withButtonBusy;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                hydrateButtons(document);
            });
        } else {
            hydrateButtons(document);
        }

        function showConfirm(title, message, confirmText, callback) {
            var overlay = document.getElementById('ppConfirmOverlay');
            if (!overlay) return;
            document.getElementById('ppConfirmTitle').textContent = title || '纭鎿嶄綔';
            document.getElementById('ppConfirmMsg').textContent = message || '纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵';
            setButtonLabel(document.getElementById('ppConfirmOkBtn'), confirmText || '纭', confirmText || '纭');
            window._confirmCallback = callback;
            if (overlay._closeTimer) {
                clearTimeout(overlay._closeTimer);
                overlay._closeTimer = null;
            }
            
            // FLIP Animation: Step 1 - First (鐠佹澘缍嶉幐澶愭尦娴ｅ秶鐤?
            var origin = window._confirmOrigin;
            
            // FLIP Animation: Step 2 - Last (鐠佸墽鐤嗛張鈧紒鍫㈠Ц閹?
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
            
            // FLIP Animation: Step 3 - Invert (鐠侊紕鐣诲顔肩磽楠炶泛寮介崥鎴濆綁閹?
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
            
            // FLIP Animation: Step 4 - Play (閹绢厽鏂侀崝銊ф暰)
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
                    
                    // FLIP Animation for Close: 鑾峰彇褰撳墠寮圭獥浣嶇疆
                    var dialogRect = dialog.getBoundingClientRect();
                    
                    // 閼惧嘲褰囬崚鐘绘珟閹稿鎸宠ぐ鎾冲娴ｅ秶鐤?
                    var deleteBtn = document.getElementById('ppDeleteBtn');
                    var btnRect = deleteBtn ? deleteBtn.getBoundingClientRect() : null;
                    
                    var targetDx = o.dx;
                    var targetDy = o.dy;
                    var targetScale = o.scale || 0.3;
                    
                    if (btnRect) {
                        // 娴ｈ法鏁ら幐澶愭尦瑜版挸澧犳担宥囩枂鐠侊紕鐣婚惄顔界垼閸欐ɑ宕?
                        targetDx = btnRect.left + btnRect.width / 2 - dialogRect.left - dialogRect.width / 2;
                        targetDy = btnRect.top + btnRect.height / 2 - dialogRect.top - dialogRect.height / 2;
                        
                        var btnSize = Math.sqrt(btnRect.width * btnRect.width + btnRect.height * btnRect.height);
                        var dialogSize = Math.sqrt(dialogRect.width * dialogRect.width + dialogRect.height * dialogRect.height);
                        targetScale = btnSize / dialogSize * 0.6;
                    }
                    
                    // Step 3 - Invert: 淇濇寔褰撳墠鐘舵€?
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

            // ===================== 鐎靛棛鐖滈崫鍫濈瑖 =====================
            async function hashPassword(password) {
                const encoder = new TextEncoder();
                const data = encoder.encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ===================== 鐧诲綍 / 娉ㄥ唽 / 閫€鍑?=====================
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

                    // 浼樺厛浠?__auth__ 璁板綍鑾峰彇娉ㄥ唽鏃堕棿锛堟渶鏉冨▉锛?
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

                    // 閸氬骸顦敍姘矤閻滅増婀?__user_info__ 娑擃叀顕伴崣?reg_time閿涘牏鏁imit(1)閼板矂娼猰aybeSingle閿涘苯顔愰柨娆忣樋鐞涘矉绱?
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

                    // 閺堚偓閸氬骸鎮楁径鍥风窗閺傛壆鏁ら幋椋庢暏瑜版挸澧犻弮鍫曟？
                    if (!regTime && isNewUser) {
                        regTime = new Date().toISOString();
                    }

                    var userInfo = { reg_time: regTime, last_login: new Date().toISOString() };
                    var contentStr = JSON.stringify(userInfo);

                    // 鐏忔繆鐦幍鎯у煂閺堚偓閺傞绔撮弶陇顔囪ぐ鏇炶嫙UPDATE閿涘牊鐦瓺ELETE+INSERT閺囨潙褰查棃鐙呯礉闁灝鍘LS閹锋帞绮稤ELETE閿?
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
                                console.log("saveUserInfo 閴?" + name + " 鐧诲綍閺冨爼妫垮鍙夋纯閺?UPDATE): " + userInfo.last_login);
                            }
                        }
                    } catch(e) {}

                    // UPDATE婢惰精瑙﹂幋鏍ㄦ￥鐠佹澘缍嶉弮璁圭礉INSERT娑撯偓閺夆剝鏌婄拋鏉跨秿
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
                            console.log("saveUserInfo 閴?" + name + " 鐧诲綍閺冨爼妫垮鍙夋纯閺?INSERT): " + userInfo.last_login);
                        }
                    }
                } catch(e) {
                    console.error("saveUserInfo澶辫触:", e);
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
                try {
                    await withButtonBusy(btn, { busyLabel: "验证中...", idleLabel: "登录", ariaLabel: "登录" }, async function() {
                        if (name === ADMIN_NAME) {
                            if (pw !== "xxz123") {
                                showToast("密码错误");
                                return;
                            }
                        } else {
                            const authRec = await findAuthRecord(name);
                            if (!authRec) {
                                showToast("账号不存在，请先注册");
                                return;
                            }
                            const inputHash = await hashPassword(pw);
                            if (inputHash !== authRec.media_url) {
                                showToast("密码错误");
                                return;
                            }
                        }

                        currentUser = name;
                        window.currentUser = currentUser;
                        localStorage.setItem("xtj_user", currentUser);
                        showToast("登录成功，欢迎回来 " + name);
                        closeModal('loginModal');
                        await saveUserInfo(name, false);
                        await initUI();
                        initialLoad(true);
                    });
                } catch (e) {
                    console.error(e);
                    showToast("登录失败，请重试");
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
                if (pw.length < 3) { showToast("密码至少 3 位"); return; }

                const btn = document.getElementById("registerSubmitBtn");
                try {
                    await withButtonBusy(btn, { busyLabel: "注册中...", idleLabel: "注册", ariaLabel: "注册" }, async function() {
                        const existing = await findAuthRecord(name);
                        if (existing) {
                            showToast("昵称 ''" + name + "'' 已被注册，请换一个");
                            return;
                        }

                        const pwHash = await hashPassword(pw);
                        const insertResult = await sb.from("posts").insert([{
                            user_name: name,
                            content: AUTH_MARKER,
                            media_url: pwHash,
                            media_type: AUTH_MARKER,
                            actor_key: AUTH_MARKER
                        }]);
                        if (insertResult.error) {
                            showToast("注册失败: " + insertResult.error.message);
                            return;
                        }

                        currentUser = name;
                        window.currentUser = currentUser;
                        localStorage.setItem("xtj_user", currentUser);
                        showToast("注册成功，欢迎加入 " + name);
                        closeModal('registerModal');
                        await saveUserInfo(name, true);
                        await initUI();
                        initialLoad(true);
                    });
                } catch (e) {
                    console.error(e);
                    showToast("注册失败，请重试");
                }
            }
            // ========== 鏌ョ湅鍏朵粬鐢ㄦ埛璧勬枡鍗＄墖 ==========
            let upcTargetUser = null;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '閺堚偓鏉╂垹娅ヨぐ鏇窗鍔犺浇涓?..';
                
                var avatarEl = document.getElementById('upcAvatar');
                // localStorage閺夊啫鈻夋导妯哄帥閿涙艾缍嬮崜宥囨暏閹村嘲鍘涘Λ鈧弻銉︽拱閸︽壆绱︾€?
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
                    msgBtn.textContent = '这是你自己';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else if (!currentUser) {
                    msgBtn.textContent = '请先登录后再发消息';
                    msgBtn.disabled = true;
                    msgBtn.style.opacity = '0.5';
                } else {
                    msgBtn.textContent = '棣冩尠 閸欐垶绉烽幁';
                    msgBtn.disabled = false;
                    msgBtn.style.opacity = '1';
                }
                
                openModal('userProfileModal');
                
                // 瀵倹顒為崝鐘烘祰澶村儚閸滃瞼娅ヨぐ鏇熸闂?
                try {
                    // 瑜版挸澧犻悽銊﹀煕娴兼ê鍘涙担璺ㄦ暏localStorage閺夊啫鈻夌紓鎾崇摠
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
                        // 闂堢偛缍嬮崜宥囨暏閹撮攱澧犻悽鈥旴閸婂吋娲块弬鎵处鐎涙﹫绱欒ぐ鎾冲閻劍鍩涘鎻掓躬娑撳﹪娼伴悽鈺╫calStorage鐠佸墽鐤嗛敍?
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
                                document.getElementById('upcLogin').textContent = '閺堚偓鏉╂垹娅ヨぐ鏇窗' + new Date(info.last_login).toLocaleString();
                            } else {
                                document.getElementById('upcLogin').textContent = '閺堚偓鏉╂垹娅ヨぐ鏇窗-';
                            }
                        } catch(e) {
                            document.getElementById('upcLogin').textContent = '閺堚偓鏉╂垹娅ヨぐ鏇窗-';
                        }
                    } else {
                        document.getElementById('upcLogin').textContent = '閺堚偓鏉╂垹娅ヨぐ鏇窗-';
                    }
                } catch(e) {
                    document.getElementById('upcLogin').textContent = '閺堚偓鏉╂垹娅ヨぐ鏇窗閸旂姾娴囨径杈Е';
                }
            };

            window.upcSendMessage = function() {
                if (!upcTargetUser || !currentUser) return;
                closeModal('userProfileModal');
                setTimeout(function() { openChat(upcTargetUser); }, 300);
            };

            // ========== 娑擃亙姹夌挧鍕灐鐠囷附鍎忛崝鐔诲厴 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 婵夘偄鍘栭崺鐑樻拱娣団剝浼?
                document.getElementById('profileDetailName').textContent = currentUser;
                document.getElementById('profileDetailId').textContent = currentUser;
                
                // 鑾峰彇鐢ㄦ埛淇℃伅锛堟敞鍐屾椂闂寸瓑锛?
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
                
                // 閸旂姾娴囧ご鍍?
                loadProfileAvatar();
                
                openModal('profileDetailModal');
            };

            async function loadProfileAvatar() {
                const avatarEl = document.getElementById('profileDetailAvatar');
                
                // localStorage閺夊啫鈻夋导妯哄帥閿涙艾鍘涘Λ鈧弻銉︽拱閸︽壆绱︾€?
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img src="' + cachedAvatars[currentUser] + '" alt="澶村儚">';
                        return;
                    }
                } catch(e) {}
                
                // 閸忓牏鏁ら崘鍛摠缂傛挸鐡ㄩ弰鍓с仛
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
                        // 閸氬本顒為崚鐧紀calStorage
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            cv[currentUser] = avatarRes.data[0].media_url;
                            localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cv));
                        } catch(e) {}
                    } else if (!avatarCache[currentUser]) {
                        avatarEl.innerHTML = '<span id="profileDetailAvatarText">' + (currentUser ? currentUser[0].toUpperCase() : '?') + '</span>';
                    }
                } catch(e) {
                    console.error("閸旂姾娴囧ご鍍忔径杈Е:", e);
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
                        // 娴ｈ法鏁?createImageBitmap 鐏忓棗娴橀悧鍥掗惍?缂傗晜鏂侀崙杞板瘜缁捐法鈻?
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
                                // fallback: 鍥為€€鍒?canvas 缂╂斁
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
                    showToast('鐠囩兘鈧瀚ㄩ崶鍓у閺傚洣娆?);
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('鍥剧墖澶у皬涓嶈兘瓒呰繃10MB');
                    return;
                }
                
                showToast('濮濓絽婀崢瀣級楠炴湹绗傛导鐘层仈閸?..');
                
                try {
                    // 娴犺濮?閿涙岸鍣搁弸鍕礋涓婁紶鍒?Supabase Storage 閻?avatars/ 閻╊喖缍?
                    const timestamp = Date.now();
                    const random = Math.floor(Math.random() * 1000);
                    const path = `avatars/${timestamp}_${random}_${file.name}`;
                    
                    // 涓婁紶鍒?Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 閼惧嘲褰?Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 閸掔娀娅庨幍鈧張澶嬫＋澶村儚鐠佹澘缍?
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
                        content: "閻劍鍩涘ご鍍?,
                        media_url: avatarUrl,
                        media_type: "__avatar__",
                        actor_key: "__avatar__"
                    }]);
                    
                    if (error) {
                        showToast('涓婁紶澶辫触: ' + error.message);
                        return;
                    }
                    
                    avatarCache[currentUser] = avatarUrl;
                    // 娣囨繂鐡ㄩ崚鐧紀calStorage閹镐椒绠欓崠?
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        cachedAvatars[currentUser] = avatarUrl;
                        localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
                    } catch(e) {}
                    var insertAvatar = await sb.from("posts").insert([{
                        user_name: currentUser,
                        content: "更换头像",
                        media_url: avatarUrl,
                        media_type: "__avatar__",
                        actor_key: "__avatar__"
                    }]);
                    if (insertAvatar.error) throw insertAvatar.error;
                    localStorage.removeItem(CACHE_KEY);
                    await loadFeed(true);
                    avatarCache[currentUser] = avatarUrl;
                    updateAllAvatarElements(avatarUrl);
                    console.error("娑撳﹣绱跺ご鍍忔径杈Е:", e);
                    showToast('娑撳﹣绱舵径杈Е閿涘矁顕柌宥堢槸');
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
                // 閺囧瓨鏌婇幋鎴犳畱妞ょ敻娼伴惃鍕仈閸嶅骏绱檒ocalStorage閺夊啫鈻夋导妯哄帥閿?
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
                            // 閸氬本顒為崚鐧紀calStorage
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
                    console.error("閺囧瓨鏌婂ご鍍忛弰鍓с仛婢惰精瑙?", e);
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
                showToast("瀹告煡鈧偓閸戣櫣娅ヨぐ");
                await initUI();
                initialLoad(true);
            };

            // 婢跺嫮鎮婇幋鎴犳畱妞ょ敻娼伴悽銊﹀煕閸楋紕澧栭悙鐟板毊
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 瀹歌尙娅ヨぐ鏇窗閹垫挸绱戞稉顏冩眽鐠у嫭鏋＄拠锔藉剰
                    openProfileDetail();
                } else {
                    // 閺堫亞娅ヨぐ鏇窗閹垫挸绱戠櫥褰?娉ㄥ唽妞ょ敻娼?
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
                    
                    // 閺囧瓨鏌婇幋鎴犳畱妞ょ敻娼伴弰鍓с仛
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "鏌ョ湅璧勬枡";
                    
                    // 閺勫墽銇氶崣鎴濈閸栧搫鐓?
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 閸旂姾娴囧ご鍍?
                    loadUserAvatar();
                    
                    // 閺囧瓨鏌婇張鈧潻鎴犳瑜版洘妞傞梻杈剧礄妞ょ敻娼板В蹇旑偧閹垫挸绱戦柈钘夊煕閺傚府绱濊箛鍛淬€廰wait绾喕绻氶崘娆忓弳閿?
                    await saveUserInfo(currentUser, false);
                    
                    try { subscribeToMessages(); startDMPolling(); updateUnreadBadge(); loadAnnouncements(); subscribeToAnnouncements(); } catch(e) {}
                } else {
                    unauthUI.style.display = "flex";
                    authUI.style.display = "none";
                    annBtnWrapper.style.display = "none";
                    
                    // 閺囧瓨鏌婇幋鎴犳畱妞ょ敻娼伴弰鍓с仛閿涘牊婀櫥褰曢敍?
                    profileName.textContent = "閺堫亞娅ヨぐ";
                    profileStatus.textContent = "鐐瑰嚮鐧诲綍";
                    
                    // 闂呮劘妫岄崣鎴濈閸栧搫鐓?
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 闁插秶鐤嗗ご鍍?
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
                        // localStorage濞屸剝婀侀敍灞藉晙娴犲孩鏆熼幑顔肩氨閸旂姾娴?
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
                    console.error("閸旂姾娴囧ご鍍忔径杈Е:", e);
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

            // DEPRECATED_DO_NOT_EDIT ===================== [瀹告彃绨惧鍍?娑撳鏌熺粭?361鐞涘本婀侀弴瀛樻煀閻楀牊婀?=====================
            window.doPublish = async function () {
                if (!currentUser) { showToast("鐠囧嘲鍘涚櫥褰?); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                if (!content && !file) { showToast("鐠囩柉绶崗銉ュ敶鐎?); return; }
                // 鏉堟挸鍙嗛弽锟犵崣閿涙岸妾洪崚鍫曟毐鎼达负鈧礁骞撻梽銈呭祫闂勨晛鍞寸€?
                if (content.length > 2000) { showToast("閸愬懎顔愭稉宥堝厴鐡掑懓绻?000鐎?); return; }
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
                    if (insertErr) { showToast("閸欐垵绔锋径杈Е: " + (insertErr.message || "閺堫亞鐓￠柨娆掝嚖")); btn.disabled = false; btn.textContent = "閸欐垵绔烽崝銊︹偓"; return; }
                    document.getElementById("postInp").value = "";
                    document.getElementById("fileInp").value = "";
                    }
                    const match = statsText.textContent.match(/閻愮绂?(\d+)/);
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
                if (!currentUser) { showToast("鐠囧嘲鍘涚櫥褰?); return; }
                activePostId = postId;
                document.getElementById("commInp").value = "";
                document.getElementById("commentModal").classList.add("active");
                setTimeout(() => document.getElementById("commInp").focus(), 100);
            };
            document.getElementById("commBtn").onclick = async function() {
                const content = document.getElementById("commInp").value.trim();
                if (!content) { showToast("请输入评论内容"); return; }
                const btn = document.getElementById("commBtn");
                try {
                    await withButtonBusy(btn, { busyLabel: "发布中...", idleLabel: "发布评论", ariaLabel: "发布评论" }, async function() {
                        const result = await sb.from("comments").insert([{ post_id: activePostId, user_name: currentUser, content: content, actor_key: deviceId }]);
                        if (result.error) throw result.error;
                        closeModal("commentModal");
                        showToast("评论已发布");
                        var scrollEl = document.getElementById('panelPosts');
                        var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
                        await loadFeed(true);
                        requestAnimationFrame(function() {
                            var p = document.getElementById('panelPosts');
                            if (p && savedScroll > 0) p.scrollTop = savedScroll;
                            var postEl = document.querySelector('.post[data-post-id="' + activePostId + '"]');
                            if (postEl) postEl.classList.add('visible');
                        });
                    });
                } catch (e) {
                    showToast("评论失败: " + ((e && e.message) || "未知错误"));
                    console.error(e);
                }
            };
            // ===================== 閸掔娀娅庣敮鏍х摍 =====================
            window.openDelete = function (postId, ownerKey) {
                delPostId = postId;
                delOwnerKey = ownerKey;
                document.getElementById("delModal").classList.add("active");
            };
            document.getElementById("delBtn").onclick = async function() {
                if (!delPostId) return;
                var btn = document.getElementById("delBtn");
                try {
                    await withButtonBusy(btn, { busyLabel: "删除中...", idleLabel: "确认删除", ariaLabel: "确认删除帖子" }, async function() {
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
                    });
                } catch (e) {
                    showToast("删除失败，请重试");
                    console.error(e);
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

            // ===================== 閸ュ墽澧栭弻銉ф箙閸?=====================
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

            // ===================== 濞村繗顫嶉柌蹇曠埠鐠?=====================
            // 閸忋劌鐪敮鏍х摍娣団剝浼呯紓鎾崇摠閿涘瞼鏁ゆ禍搴㈢セ鐟欏牐顔囪ぐ?
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';

            function getViewHistory() {
                try {
                    return window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 闁灝鍘ら柌宥咁槻鐠佹澘缍嶉敍鍫濇倱娑撯偓閻劍鍩涢崥灞肩鐢牕鐡欓崣顏囶唶瑜版洑绔村▎鈽呯礆
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(entry);
                    // 閸欘亙绻氶悾娆愭付鏉?00閺?
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
                            var vm = statsEl.textContent.match(/濞村繗顫?(\d+)/);
                            if (vm) {
                                var newVal = parseInt(vm[1]) + 1;
                                statsEl.innerHTML = statsEl.innerHTML.replace(/濞村繗顫?\d+/, '濞村繗顫?' + newVal);
                            }
                        }
                    }
                    if (currentUser && postInfoCache[postId]) {
                        var rawContent = postInfoCache[postId].content || '';
                        saveViewHistory({
                            user_name: currentUser,
                            post_id: postId,
                            post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + '...' : (rawContent || '(閸ュ墽澧?鐟欏棝顣?'),
                            post_author: postInfoCache[postId].user_name || '閺堫亞鐓?,
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

            // ===================== 閸旂姾娴囬崝銊︹偓?=====================
            // 娴犺濮?閿涙艾鍨庢い闈涘鏉炵晫娴夐崗鍐插綁闁?
            let feedPage = 0;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熺粭?412鐞涘本婀侀弴瀛樻煀閻楀牊婀?======
            async function loadFeed(forceRefresh = false) {
                const now = Date.now();
                if (forceRefresh) {
                    // 闁插秶鐤嗛崚鍡涖€夐悩鑸碘偓?
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
                                // 缂傛挸鐡ㄩ崝鐘烘祰閿涘苯鎮撻弮璺哄灥婵瀵查崚鍡涖€夐悩鑸碘偓?
                                feedAllPosts = parsed.data.posts || [];
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed(parsed.data);
                                // 閸氼垰濮╅弮鐘绘濠婃艾濮╃憴鍌氱檪
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
                        const errMsg = (postRes.error || commRes.error || likeRes.error).message || '閺佺増宓侀崝鐘烘祰婢惰精瑙?;
                        feed.innerHTML = `<div class="loading" style="color:#ff3b60;">閸旂姾娴囨径杈Е: ${errMsg}</div>`;
                        return;
                    }
                    const data = { posts: postRes.data || [], comments: commRes.data || [], likes: likeRes.data || [] };
                    // 娣囨繂鐡ㄧ€瑰本鏆ｉ弫鐗堝祦娓氭稑鍨庢い鍏稿▏閻?
                    feedAllPosts = data.posts;
                    feedAllComments = data.comments;
                    feedAllLikes = data.likes;
                    // 缂傛挸鐡ㄩ弮鑸靛笓闂勩倕銇旈崓蹇撴嫲閻劍鍩涙穱鈩冧紖鐠佹澘缍嶉敍宀勬Щ濮濐晥ase64婢堆冩禈閹炬垹鍨巐ocalStorage
                    const cachePosts = data.posts.filter(p => p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
                    await renderFeed(data);
                    // 閸氼垰濮╅弮鐘绘濠婃艾濮╃憴鍌氱檪
                    setupFeedInfiniteScroll();
                } catch(e) {
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">閸旂姾娴囨径杈Е閿涘苯鍩涢弬浼村櫢鐠?/div>`;
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
                
                // 閸?feed 鎼存洟鍎村ǎ璇插娑撯偓娑?sentinel 閸忓啰绀?
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熺粭?479鐞涘本婀侀弴瀛樻煀閻楀牊婀?======
            function loadMoreFeedPosts() {
                if (feedEndReached) return;
                
                const feed = document.getElementById('feed');
                const visiblePosts = feedAllPosts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                
                const startIdx = feedPage * FEED_PAGE_SIZE;
                const endIdx = startIdx + FEED_PAGE_SIZE;
                
                if (startIdx >= visiblePosts.length) {
                    feedEndReached = true;
                    // 閺勫墽銇氬▽鈩冩箒閺囨潙顦挎禍?
                    let noMore = document.getElementById('feedNoMore');
                    if (!noMore) {
                        noMore = document.createElement('div');
                        noMore.id = 'feedNoMore';
                        noMore.className = 'loading';
                        noMore.textContent = '濞屸剝婀侀弴鏉戭樋娴?;
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熺粭?503鐞涘本婀侀弴瀛樻煀閻楀牊婀?======
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
                  <div class="post-stats-text">濞村繗顫?${p.views||0} 璺?閻愮绂?${pLikes.length} 璺?鐠囧嫯顔?${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'閴傘倧绗?:'閻愮绂?}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">鐠囧嫯顔?/button>
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">閸掔娀娅?/button>`:''}
                    <button class="action-btn report-btn" style="margin-left:auto;" data-id="${escapeHtml(p.id)}" data-user="${escapeHtml(p.user_name)}">涓炬姤</button>
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
                
                // 閸?sentinel 娑斿澧犻幓鎺戝弳閺傛澘绗樼€?
                const sentinel = document.getElementById('feedSentinel');
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = postsHtml;
                
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                
                // 娑撶儤鏌婄敮鏍х摍濞ｈ濮炴潻娑樺弳閸斻劎鏁剧憴鍌氱檪閿涘牆顦查悽銊ュ弿鐏炩偓鐟欏倸鐧傞崳顭掔礆
                const newPosts = feed.querySelectorAll('.post:not(.visible)');
                newPosts.forEach(p => getPostVisibilityObserver().observe(p));
                
                // 閺囧瓨鏌婄紒鐔活吀
                updateFeedStats();
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熺粭?532鐞涘本婀侀弴瀛樻煀閻楀牊婀?======
            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name);
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;

                // 婵夘偄鍘栫敮鏍х摍娣団剝浼呯紓鎾崇摠閿涘奔绶靛ù蹇氼潔鐠佹澘缍嶆担璺ㄦ暏
                visiblePosts.forEach(p => {
                    postInfoCache[p.id] = { content: p.content, user_name: p.user_name };
                });

                // 閺€鍫曟肠閹碘偓閺堝娓剁憰浣搞仈閸嶅繒娈戦悽銊﹀煕閸?
                const allUsers = new Set();
                visiblePosts.forEach(p => allUsers.add(p.user_name));
                comments.forEach(c => allUsers.add(c.user_name));

                // 缁涘绶熷ご鍍忛崝鐘烘祰鐎瑰本鍨氶崥搴″晙濞撳弶鐓?
                await loadAvatarsForUsers(Array.from(allUsers));
                
                // 娴犺濮?閿涙艾褰у〒鍙夌厠缁楊兛绔存い鐢垫畱閸愬懎顔愰敍灞芥倵缂侇參鈧俺绻冮弮鐘绘濠婃艾濮╅崝鐘烘祰
                const firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                renderFeedWithAvatars(firstPage, comments, likes);
                
                // 閸氬骸褰存０鍕鏉炵晫绮虹拋鈩冩殶閹?
                setTimeout(function() { prefetchStatData(); }, 1000);
            }
            window.renderFeed = renderFeed;

            // 妫板嫭鐎楦跨槑鐠佸搫鎷伴悙纭呯閻ㄥ嫭妲х亸鍕€冮敍灞惧絹閸楀洦瑕嗛弻鎾粹偓褑鍏?
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

            // 缂傛挸鐡ㄥご鍍廢RL
            const avatarCache = {};

            async function loadAvatarsForUsers(usernames) {
                if (!usernames || usernames.length === 0) return;
                try {
                    var allData = [];
                    var batchSize = 80; // Supabase .in() 閺堚偓婢舵氨瀹?00娑擃亜鈧》绱濋悾?0娴ｆ瑩鍣?
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
                    console.error("閸旂姾娴囧ご鍍忔径杈Е:", e);
                }
            }

            function getAvatarHtml(username, size = 32) {
                var avatarUrl = avatarCache[username];
                if (!avatarUrl) {
                    if (username === currentUser) {
                        // 閸欘亙绮爈ocalStorage闁插本瀣佽ぐ鎾冲閻劍鍩涢懛顏勭箒閻ㄥ嫬銇旈崓?
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熺粭?520鐞涘本婀侀弴瀛樻煀閻楀牊婀?======
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
                  <div class="post-stats-text">濞村繗顫?${p.views||0} 璺?閻愮绂?${pLikes.length} 璺?鐠囧嫯顔?${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" onclick="toggleLike(this, '${escapeHtml(p.id).replace(/'/g, "\\'")}')">${isLiked?'閴傘倧绗?:'閻愮绂?}</button>
                    <button class="action-btn" onclick="openComment('${escapeHtml(p.id).replace(/'/g, "\\'")}')">鐠囧嫯顔?/button>
                    ${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete('${escapeHtml(p.id).replace(/'/g, "\\'")}', '${escapeHtml(p.actor_key).replace(/'/g, "\\'")}')">閸掔娀娅?/button>`:''}
                    <button class="action-btn report-btn" style="margin-left:auto;" data-id="${escapeHtml(p.id)}" data-user="${escapeHtml(p.user_name)}">涓炬姤</button>
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
                }).join('') : `<div class="loading">韫囶偅娼甸崣鎴濈缁楊兛绔撮弶鈥冲З閹礁鎯倊</div>`;

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
                    var vm = text.match(/濞村繗顫?(\d+)/);
                    var lm = text.match(/閻愮绂?(\d+)/);
                    var cm = text.match(/鐠囧嫯顔?(\d+)/);
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
                        return { ok: false, error: new Error("鏁版嵁搴撴湭鏇存柊浠讳綍璁板綍锛屽彲鑳芥槸 Supabase RLS/update policy 鎷︽埅銆?) };
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
                if (normalized.updated_at) return time + " 璺?瀹歌尙绱潏";
                return time;
            }

            function buildPostBadges(post) {
                var normalized = normalizePost(post);
                var bits = [];
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '棣冩晙 缁変礁鐦? : '棣冨 閸忣剙绱?) + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">棣冩惗 缂冾噣銆?/span>');
                return bits.join("");
            }

            function buildPostActionHtml(post, isLiked, canDelete) {
                var id = escapeHtml(String(post.id)).replace(/'/g, "\\'");
                var actorKey = escapeHtml(String(post.actor_key || "")).replace(/'/g, "\\'");
                var isPinned = normalizePost(post).is_pinned;
                var actions = [
                    '<button type="button" class="action-btn action-btn-like ui-button ' + (isLiked ? 'liked' : '') + '" onclick="toggleLike(this, \\'' + id + '\\')" data-button-role="post-like" data-button-icon="' + (isLiked ? 'likeActive' : 'like') + '" data-button-label="点赞" data-state="' + (isLiked ? 'active' : 'idle') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" aria-label="' + (isLiked ? '取消点赞' : '点赞') + '">' + buildButtonInnerHtml('点赞', isLiked ? 'likeActive' : 'like') + '</button>',
                    '<button type="button" class="action-btn action-btn-comment ui-button" onclick="openComment(\\'' + id + '\\')" data-button-role="post-comment" data-button-icon="comment" data-button-label="评论" data-state="idle" aria-label="评论帖子">' + buildButtonInnerHtml('评论', 'comment') + '</button>'
                ];
                if (canEditPost(post)) {
                    actions.push('<button type="button" class="action-btn edit action-btn-edit ui-button" onclick="openEditPost(\\'' + id + '\\')" data-button-role="post-edit" data-button-icon="edit" data-button-label="编辑" data-state="idle" aria-label="编辑帖子">' + buildButtonInnerHtml('编辑', 'edit') + '</button>');
                }
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin action-btn-pin ui-button" onclick="togglePostPin(\\'' + id + '\\')" data-button-role="post-pin" data-button-icon="pin" data-button-label="置顶" data-state="' + (isPinned ? 'active' : 'idle') + '" aria-pressed="' + (isPinned ? 'true' : 'false') + '" aria-label="' + (isPinned ? '取消置顶' : '置顶帖子') + '">' + buildButtonInnerHtml('置顶', 'pin') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del action-btn-delete ui-button" onclick="openDelete(\\'' + id + '\\', \\'' + actorKey + '\\')" data-button-role="post-delete" data-button-icon="delete" data-button-label="删除" data-state="idle" aria-label="删除帖子">' + buildButtonInnerHtml('删除', 'delete') + '</button>');
                }
                actions.push('<button type="button" class="action-btn report-btn action-btn-report ui-button" style="margin-left:auto;" data-id="' + escapeHtml(String(post.id)) + '" data-user="' + escapeHtml(post.user_name || "") + '" data-button-role="post-report" data-button-icon="report" data-button-label="举报" data-state="idle" aria-label="举报帖子">' + buildButtonInnerHtml('举报', 'report') + '</button>');
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
                  <div class="post-stats-text">濞村繗顫?${normalized.views || 0} 璺?閻愮绂?${pLikes.length} 璺?鐠囧嫯顔?${pComms.length}</div>
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
                        return { ok: false, error: new Error("数据库未更新任何记录，可能是 Supabase RLS/update policy 拦截。") };
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
                    showToast("閺冪姵娼堢紓鏍帆鏉╂瑦娼敮鏍х摍");
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
                    showToast("当前没有可编辑的帖子");
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
                try {
                    await withButtonBusy(btn, { busyLabel: "保存中...", idleLabel: "保存修改", ariaLabel: "保存帖子修改" }, async function() {
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
                        if (!fetchedPost) throw new Error("保存失败：帖子未能重新读取");
                        var verified = normalizePost(fetchedPost);
                        if (String(verified.visibility) !== String(nextVisibility)) {
                            throw new Error("保存失败：可见范围未成功写入");
                        }
                        clearFeedCache();
                        closeModal("editPostModal");
                        editPostId = null;
                        await loadFeed(true);
                        showToast("帖子已更新");
                    });
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("保存失败: " + (e && e.message ? e.message : "未知错误"));
                }
            };
            window.togglePostPin = async function(postId) {
                var post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                if (!post || !canPinPost(post)) {
                    showToast("閺冪姵娼堢純顕€銆婃潻娆愭蒋鐢牕鐡?);
                    return;
                }
                var nextPinned = !post.is_pinned;
                var result = await updatePostRecord(post, {
                    is_pinned: nextPinned,
                    pinned_at: nextPinned ? new Date().toISOString() : null
                });
                if (!result.ok) {
                    showToast("缂冾噣銆婇幙宥勭稊婢惰精瑙? " + ((result.error && result.error.message) || "閺堫亞鐓￠柨娆掝嚖"));
                    return;
                }
                clearFeedCache();
                showToast(nextPinned ? "甯栧瓙宸茬疆椤? : "宸插彇娑堢疆椤?);
                await loadFeed(true);
            };
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("请输入内容或选择媒体"); return; }
                if (content.length > 2000) { showToast("帖子内容不能超过 2000 字"); return; }
                var btn = document.getElementById("pubBtn");
                try {
                    await withButtonBusy(btn, { busyLabel: "发布中...", idleLabel: "发布动态", ariaLabel: "发布动态" }, async function() {
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
                    });
                } catch (e) {
                    showToast("发布失败: " + ((e && e.message) || "未知错误"));
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
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">閸旂姾娴囨径杈Е: ' + escapeHtml(err.message || "閺堫亞鐓￠柨娆掝嚖") + '</div>';
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
                    if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">閸旂姾娴囨径杈Е閿涘矁顕崚閿嬫煀闁插秷鐦?/div>';
                    console.error(e);
                }
            };
            window.loadFeed = loadFeed;

                    showToast("当前帖子不允许置顶");
                if (feedEndReached) return;
                var feed = document.getElementById("feed");
                var filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                var startIdx = feedPage * FEED_PAGE_SIZE;
                var endIdx = startIdx + FEED_PAGE_SIZE;
                if (startIdx >= filteredPosts.length) {
                    feedEndReached = true;
                    var noMore = document.getElementById("feedNoMore");
                    showToast("置顶失败: " + ((result.error && result.error.message) || "未知错误"));
                        noMore = document.createElement("div");
                        noMore.id = "feedNoMore";
                        noMore.className = "loading";
                showToast(nextPinned ? "帖子已置顶" : "已取消置顶");
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
                }).join("") : "<div class=\"loading\">" + (hasFilters ? "娌℃湁鎵惧埌鐩稿叧甯栧瓙" : "蹇潵鍙戝竷绗竴鏉″姩鎬佸惂~") + "</div>";
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


            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧鍍?娑撳鏌熺粭?668鐞涘本婀侀弴瀛樻煀閻楀牊婀?======
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

            // ===================== 閺佺増宓佺紒鐔活吀鐠囷附鍎忛崝鐔诲厴 =====================
            // 鐎涙ê鍋嶈ぐ鎾冲閻ㄥ嫮绮虹拋陇顫嬮崶鍓уЦ閹?
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30缁夋帞绱︾€?

            // 閸氬骸褰存０鍕鏉炵晫绮虹拋鈩冩殶閹?
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

            // 閹垫挸绱戠紒鐔活吀鐠囷附鍎忓Ο鈩冣偓浣诡攱
            window.openStatDetail = async function(type) {
                statCurrentType = type;
                const titles = { posts: '閹濮╅幀?- 閹稿鏁ら幋宄板瀻缂?, views: '閹粯绁荤憴?- 濞村繗顫嶇拋鏉跨秿', likes: '閻愮绂愰崪宀冪槑鐠?- 鐠佹澘缍? };
                document.getElementById('statModalTitle').textContent = titles[type] || '缂佺喕顓哥拠锔藉剰';
                document.getElementById('statModal').classList.add('active');

                // 婵″倹鐏夐張澶岀处鐎涙ɑ鏆熼幑顕嗙礉缁斿宓嗗〒鍙夌厠閿涘苯鎮撻弮璺虹磽濮濄儱鍩涢弬?
                if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
                    renderStatByType(type);
                    if (statPollTimer) clearInterval(statPollTimer);
                    statPollTimer = setInterval(refreshStatModal, 15000);
                    // 閸氬骸褰撮棃娆撶帛閸掗攱鏌?
                    prefetchStatData().then(function() {
                        if (document.getElementById('statModal').classList.contains('active') && statCurrentType === type) {
                            renderStatByType(type);
                        }
                        noMore.textContent = "没有更多帖子了";
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
                    document.getElementById('statModalBody').innerHTML = '<div class="stat-empty">閸旂姾娴囨径杈Е閿涘矁顕柌宥堢槸</div>';
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

            // 濠婃艾濮╅崚鐗堝瘹鐎规艾绗樼€涙劕鑻熸妯瑰瘨
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
                document.getElementById('postDetailTitle').textContent = '鐢牕鐡欑拠锔藉剰';
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
                        document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">甯栧瓙涓嶅瓨鍦ㄦ垨宸茶鍒犻櫎</div>';
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
                    document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">閸旂姾娴囨径杈Е閿涘矁顕柌宥堢槸</div>';
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
                    <div class="post-detail-stats">濞村繗顫?${vc} 璺?閻愮绂?${likes.length} 璺?鐠囧嫯顔?${comments.length}</div>
                    <div class="stat-two-col">
                        <div class="stat-col">
                            <div class="stat-section-title">閴傘倧绗?閻愮绂愰悽銊﹀煕閿?{likes.length}閿?/div>
                            ${likes.length ? likes.map(l => `
                                <div class="stat-like-item">
                                    <div class="sli-info">
                                        <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                    </div>
                                    <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                                </div>
                            `).join('') : '<div class="stat-empty" style="padding:12px 0;">閺嗗倹妫ら悙纭呯</div>'}
                        </div>
                        <div class="stat-col">
                            <div class="stat-section-title">棣冩尠 鐠囧嫯顔戦崚妤勩€冮敍?{comments.length}閿?/div>
                            ${comments.length ? comments.map(c => `
                                <div class="stat-comment-item">
                                    <div class="sci-info">
                                        <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                        <div class="sci-target">${escapeHtml(c.content)}</div>
                                    </div>
                                    <span class="sci-time">${new Date(c.created_at).toLocaleString()}</span>
                                </div>
                            `).join('') : '<div class="stat-empty" style="padding:12px 0;">閺嗗倹妫ょ拠鍕啈</div>'}
                        </div>
                    </div>
                `;
            }

            // 閺嶇厧绱￠崠鏍х瑯鐎涙劕鍞寸€硅鎲崇憰渚婄礄閻劋绨仦鏇犮仛閿?
            function formatPostSummary(p) {
                const text = p.content || '';
                const hasImg = p.media_url && p.media_type === 'image';
                const hasVid = p.media_url && p.media_type === 'video';
                let tag = '';
                if (hasImg) tag = '<span class="spi-img-tag">棣冩煠 閸ュ墽澧?/span>';
                if (hasVid) tag = '<span class="spi-img-tag">棣冨箑 鐟欏棝顣?/span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '涓€寮犲浘鐗? : hasVid ? '涓€涓棰? : '(鏃犲唴瀹?');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 閻㈢喐鍨氱敮鏍х摍閺夛紕娲伴惃鍑ML閿涘牆褰查悙鐟板毊鐠哄疇娴嗛敍?
            function renderPostItemHTML(p) {
                const fmt = formatPostSummary(p);
                const onclick = `openPostDetail('${escapeHtml(p.id).replace(/'/g, "\\'")}')`;
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

            // 濞撳弶鐓嬮幀璇插З閹胶绮虹拋鈽呯礄閹稿鏁ら幋宄板瀻缂佸嫸绱?
            function renderPostStats() {
                const body = document.getElementById('statModalBody');
                // 閹?user_name 閸掑棛绮嶇紒鐔活吀
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
                                    <button class="stat-view-btn" onclick="loadUserAllPosts('${escapeHtml(name).replace(/'/g, "\\'")}')">鏌ョ湅鍏ㄩ儴 ${posts.length} 鏉?/button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('');
            }

            // 閺屻儳婀呴幐鍥х暰閻劍鍩涢惃鍕閺堝绗樼€?
            window.loadUserAllPosts = function(userName) {
                const body = document.getElementById('statModalBody');
                const userPosts = statAllPosts.filter(p => p.user_name === userName);
                body.innerHTML = `
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">閳?鏉╂柨娲栭幀璇插З閹?/button>
                    <div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        ${userName} 閻ㄥ嫬鍙忛柈銊ョ瑯鐎涙劧绱欓崗?${userPosts.length} 閺夆槄绱?
                    </div>
                    ${userPosts.map(p => renderPostItemHTML(p)).join('')}
                `;
            };

            // 濞撳弶鐓嬮幀缁樼セ鐟欏牏绮虹拋鈽呯礄娴?localStorage 鐠囪褰囧ù蹇氼潔閸樺棗褰堕敍?
            function renderViewStats() {
                const body = document.getElementById('statModalBody');
                const history = getViewHistory();
                
                if (!history.length) {
                    body.innerHTML = `
                        <div class="stat-empty">
                            <div style="font-size:16px; margin-bottom:8px;">棣冩惓 濞村繗顫嶇拋鏉跨秿</div>
                            <div style="font-size:13px;">閺嗗倹妫ゅù蹇氼潔鐠囷附鍎忛弫鐗堝祦</div>
                            <div style="font-size:12px; margin-top:12px; opacity:0.7;">濞村繗顫嶇拋鏉跨秿娴兼艾婀担鐘崇叀閻绗樼€涙劖妞傞懛顏勫З娣囨繂鐡?/div>
                            <div style="font-size:12px; margin-top:8px; opacity:0.7;">瑜版挸澧犲鑼额唶瑜版洘鈧粯绁荤憴鍫熸殶閿?{document.getElementById('sViews').textContent} 濞?/div>
                        </div>
                    `;
                    return;
                }

                body.innerHTML = history.map(v => `
                    <div class="stat-view-item">
                        <div class="svi-info">
                            <div class="svi-user">${escapeHtml(v.user_name)}</div>
                            <div class="svi-target">濞村繗顫嶆禍?<b>${escapeHtml(v.post_author)}</b> 閻ㄥ嫬绗樼€涙劧绱?{escapeHtml(v.post_content)}</div>
                        </div>
                        <span class="svi-time">${new Date(v.viewed_at).toLocaleString()}</span>
                    </div>
                `).join('');
            }

            // 濞撳弶鐓嬮悙纭呯閸滃矁鐦庣拋铏圭埠鐠?
            function renderLikeStats() {
                const body = document.getElementById('statModalBody');

                const postMap = {};
                statAllPosts.forEach(p => { postMap[p.id] = p; });

                function buildLikesCol() {
                    let h = '<div class="stat-section-title">閴傘倧绗?閻愮绂愮拋鏉跨秿</div>';
                    if (statAllLikes.length) {
                        h += statAllLikes.slice(0, 200).map(l => {
                            const post = postMap[l.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(閸ュ墽澧?鐟欏棝顣?') : '(瀹告彃鍨归梽?';
                            return `
                        <div class="stat-like-item">
                            <div class="sli-info">
                                <div class="sli-user">${escapeHtml(l.user_name)}</div>
                                <div class="sli-target">閻愮绂愭禍鍡窗${postContent}</div>
                            </div>
                            <span class="sli-time">${new Date(l.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">閺嗗倹妫ら悙纭呯鐠佹澘缍?/div>';
                    }
                    return h;
                }

                function buildCommentsCol() {
                    let h = '<div class="stat-section-title">棣冩尠 鐠囧嫯顔戠拋鏉跨秿</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(閸ュ墽澧?鐟欏棝顣?') : '(瀹告彃鍨归梽?';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">鐠囧嫯顔戞禍鍡愨偓?{postContent}閵嗗稄绱?{escapeHtml(c.content)}</div>
                            </div>
                            <span class="sci-time">${new Date(c.created_at).toLocaleString()}</span>
                        </div>
                    `;
                        }).join('');
                    } else {
                        h += '<div class="stat-empty" style="padding:12px 0;">閺嗗倹妫ょ拠鍕啈鐠佹澘缍?/div>';
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

                // 瀵搫鍩楀ù蹇氼潔閸ｃ劌鐣幋鎰鐏炩偓閸氬骸鍟€濞ｈ濮瀞how缁紮绱濈涵顔荤箽CSS transition濮濓絿鈥樼憴锕€褰?
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

            // ==== 濞村鐦柅姘辩叀濡亜绠欓敍鍫熷付閸掕泛褰寸拫鍐暏閿涙estNotification()閿?====
            window.testNotification = function() {
                showNotification('瀵姳绗?, '娴ｇ姴銈介敍浣界箹閺勵垯绔撮弶鈩冪ゴ鐠囨洘绉烽幁顖ょ稏閻婀呭☉鍙夆偓浣哄箵閻犲啯鏅ラ弸婊冾洤娴ｆ洩绱?);
            };
            window.testNotificationLong = function() {
                showNotification('鏉庡洓', '杩欐槸涓€鏉￠潪甯搁潪甯搁暱鐨勬祴璇曟秷鎭紝鐢ㄦ潵妫€鏌ユ枃鏈埅鏂晥鏋滃埌搴曟€庝箞鏍凤紝瓒呰繃300涓瓧绗﹀簲璇ヤ篃涓嶄細鎶婂瓧绗︿覆鎵撳潖銆?);
            };

            // ===================== 閼卞﹤銇夌化鑽ょ埠 (Dock 閸忕厧顔愰悧? =====================
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
                if (d.toDateString() === yesterday.toDateString()) return '閺勩劌銇?' + hhmm;
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
                        console.log('[CHAT-REALTIME] 閺€璺哄煂閺傜増绉烽幁?', m);
                        if (m.media_type !== DM_MARKER) return;
                        if (!currentUser) return;
                        if (m.media_url !== currentUser) return;
                        if (m.user_name === currentUser) return;
                        console.log('[CHAT-REALTIME] 鐟欙箑褰傞柅姘辩叀:', m.user_name, m.content);
                        showNotification(m.user_name, m.content || '閸欐垿鈧椒绨℃稉鈧鐘叉禈閻?鐟欏棝顣?);
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
                        else if (status === 'SUBSCRIBED') { console.log('[CHAT-REALTIME] 瀹歌尪绻涢幒'); }
                    });
            }

            function startDMPolling(interval) {
                // 娴犺濮?閿涙岸绮拋銈夋？闂?5 閸掑棝鎸撻敍?00000ms閿涘绱濋梽宥勭秵閺佺増宓佹惔鎾诡嚞濮瑰倸甯囬崝?
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
                if (tab === 'chat' && !currentUser) { showToast('鐠囧嘲鍘涚櫥褰?); return; }
                // 閸忓牐袝閸欐垹鍋ｉ崙璇插З閻紮绱欓崡鍏呭▏瀹歌尙绮￠崷銊ョ秼閸撳车ab娑旂喕顩﹂幘顓熸杹閿?
                var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (btn) triggerTabAnimation(btn, tab);
                const now = Date.now();
                
                // 濡偓閺屻儲妲搁崥锔芥Ц閸欏苯鍤崚閿嬫煀閿?00ms閸愬懎鍟€濞嗭紕鍋ｉ崙璇叉倱娑撯偓tab閿?
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);
                
                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 閸欏苯鍤敍姘⒔鐞涘苯鍩涢弬?
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            // 閻撗呭婢ф瑥鍩涢弬?
                            window.showToast('濮濓絽婀崚閿嬫煀閻撗呭婢?..');
                            if (typeof window.loadPhotoWallData === 'function') {
                                window.loadPhotoWallData(true).then(function() {
                                    if (typeof window.renderPhotoWall === 'function') {
                                        window.renderPhotoWall();
                                    }
                                    isRefreshing[tab] = false;
                                    window.showToast('閸掗攱鏌婄€瑰本鍨?);
                                }).catch(function() {
                                    isRefreshing[tab] = false;
                                });
                            } else {
                                isRefreshing[tab] = false;
                            }
                        } else if (tab === 'posts') {
                            // 鐢牕鐡欐い闈涘煕閺?
                            window.showToast('濮濓絽婀崚閿嬫煀...');
                            // 濞撳懘娅庣紓鎾崇摠楠炲爼鍣搁弬鏉垮鏉?
                            try {
                                localStorage.removeItem(CACHE_KEY);
                            } catch(e) {}
                            if (typeof window.initialLoad === 'function') {
                                window.initialLoad(true);
                            }
                            // 閸ョ偛鍩屾い鍫曞劥
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                            isRefreshing[tab] = false;
                            window.showToast('閸掗攱鏌婄€瑰本鍨?);
                        } else if (tab === 'chat') {
                            // 閼卞﹤銇夋い闈涘煕閺?
                            window.showToast('濮濓絽婀崚閿嬫煀...');
                            dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('閸掗攱鏌婄€瑰本鍨?);
                        } else if (tab === 'profile') {
                            // 娑擃亙姹夋い闈涘煕閺?
                            window.showToast('濮濓絽婀崚閿嬫煀...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            isRefreshing[tab] = false;
                            window.showToast('閸掗攱鏌婄€瑰本鍨?);
                        }
                    } else {
                        // 閸楁洖鍤敍姘⒔鐞涘矁绻戦崶?閸ョ偤銆婇幙宥勭稊
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 鐢牕鐡欐い纰夌窗閸ョ偛鍩屾い鍫曞劥
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 閼卞﹤銇夋い纰夌窗婵″倹鐏夐崷銊ヮ嚠鐠囨繀鑵戦敍宀冪箲閸ョ偠浜版径鈺佸灙鐞涱煉绱遍崥锕€鍨崶鐐插煂妞ゅ爼鍎?
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
                            // 閹存垹娈戞い纰夌窗閸ョ偛鍩屾い鍫曞劥
                            const panel = document.getElementById('panelProfile');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }
                    lastTabTapTime[tab] = now;
                    return;
                }
                
                // 閸掑洦宕查崚鐗堟煀tab
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
            // ========== Dock 閼卞﹤銇?==========
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
                document.getElementById('dockChatTitle').textContent = '濞戝牊浼?;
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
                if (!currentUser) { showToast('鐠囧嘲鍘涚櫥褰?); return; }
                if (userName === currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                document.getElementById('dockChatMessages').innerHTML = '<div class="chat-empty"><div class="ce-icon">棣冩尠</div><div>鍔犺浇涓?..</div></div>';
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
                el.innerHTML = '<div class="chat-empty"><div class="ce-icon" style="animation:spin 1s linear infinite">閳?/div><div>鍔犺浇涓?..</div></div>';
                try {
                    const { data: allMsgs, error } = await sb.from("posts")
                        .select("id, user_name, media_url, content, created_at")
                        .eq("media_type", DM_MARKER)
                        .or(`user_name.eq.${currentUser},media_url.eq.${currentUser}`)
                        .order("created_at", { ascending: false })
                        .limit(200);
                    if (error) throw error;
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">棣冩尠</div><div>閺嗗倹妫ゅ☉鍫熶紖</div><div style="font-size:12px;">閸︺劌绗樼€涙劙銆夐棃銏㈠仯閸戣銇旈崓蹇撶磻婵浜版径?/div></div>';
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
                    // 妫板嫬濮炴潪鍊熶喊婢垛晛鍨悰銊ャ仈閸?
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
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">閳跨媴绗?/div><div>' + (e.message || '閸旂姾娴囨径杈Е') + '</div></div>';
                }
            }

            // 閼卞﹤銇夊☉鍫熶紖閺堫剙婀寸紓鎾崇摠閿涘奔绨╁▎鈩冨ⅵ瀵偓缁夋帒鍤?
            var _chatCache = {};

            async function loadDockChatMessages(userName, forceScroll) {
                if (dockChatMsgsBusy && dockChatMsgsUser === userName) { dockChatMsgsDirty = userName; return; }
                // 妫板嫬濮炴潪钘夊蓟閺傜懓銇旈崓?
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
                // 瑜版挸澧犻悽銊﹀煕娴兼ê鍘涙担璺ㄦ暏localStorage閺夊啫鈻夌紓鎾崇摠
                if (currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 閺堝绱︾€涙ê鍘涚粩瀣祮閺勫墽銇?
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
                    // 缂傛挸鐡ㄥ☉鍫熶紖
                    _chatCache[cacheKey] = msgs || [];
                    const toMark = (msgs || []).filter(m => m.user_name === userName && m.media_url === currentUser && (m.views || 0) === 0);
                    await Promise.all(toMark.map(m => sb.rpc("increment_post_views", { p_post_id: m.id }).catch(() => {})));
                    toMark.forEach(m => { m.views = 1; });
                    markMessagesRead(userName);
                    renderDockMessages(msgs || [], forceScroll);
                } catch(e) {
                    if (!_chatCache[cacheKey]) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">閳跨媴绗?/div><div>' + (e.message || '閸旂姾娴囨径杈Е') + '</div></div>';
                    }
                } finally {
                    dockChatMsgsBusy = false;
                    if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
                }
            }

            function renderDockMessages(msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">棣冩尠</div><div>閸欐垿鈧胶顑囨稉鈧弶鈩冪Х閹垰鎯?/div></div>'; return; }
                // 濡偓濞村鏁ら幋閿嬫Ц閸氾箑婀弻銉ф箙閸樺棗褰剁拋鏉跨秿閿涘牏顬囨惔鏇㈠劥鐡掑懓绻?00px鐟欏棔璐熼崷銊ф箙閸樺棗褰堕敍?
                var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                // 閸忓牓娈ｉ挊蹇擃啇閸ｎ煉绱濆〒鍙夌厠鐎瑰瞼娲块幒銉ュ煂鎼存洖鍟€閺勫墽銇氶敍宀勪缉閸忓秳绮犳い鍫曞劥濠婃垳绗呴弶銉ф畱闂傤亞鍎?
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
                    const readStatus = sent ? ((m.views || 0) > 0 ? '<span class="msg-read-status">瀹歌尪顕?/span>' : '<span class="msg-read-status">閺堫亣顕?/span>') : '';
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
                // 濞撳弶鐓嬬€瑰本鐦敍灞炬▔缁€鍝勵啇閸?
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
                } catch(e) { showToast('閸欐垿鈧礁銇戠拹? ' + (e?.message || e)); inp.value = content; }
                finally { dockChatSending = false; }
            }

            function showDockChatFilePreview(file) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const thumb = document.getElementById('dockCfpThumb'), name = document.getElementById('dockCfpName');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                const xBtn = thumb.querySelector('.cfp-x'); thumb.innerHTML = '';
                if (file.type.startsWith('video/')) { thumb.innerHTML = '<span class="cfp-video-icon">棣冨箑</span>'; }
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

                    // 娴犺濮?閿涙矮濞囬悽?100dvh 閺囧じ鍞?--vh 閺傝顢嶉敍宀€些闂?resize 閸ョ偠鐨熸稉顓犳畱 adjustIOSHeight
                    // window.addEventListener('resize', function() {
                    //     if (!keyboardOpen) adjustIOSHeight();
                    // });
                })();

                // 娴犺濮?閿涙矮濞囬悽?100dvh 閺囧じ鍞?--vh 閺傝顢嶉敍宀€些闂勩倖妫惃?iOS 鐠嬪啯鏆ｆ禒锝囩垳
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI(); initRainAnimation(); initialLoad();
                // 閹垹顦叉稉濠冾偧娣囨繂鐡ㄩ惃鍕垼缁涢箖銆?
                const savedTab = localStorage.getItem('xtj_current_tab');
                if (savedTab && savedTab !== 'posts') {
                    switchDockTab(savedTab, true);
                }
            });

            // ========== 娑撳顣介崚鍥ㄥ床 ==========
            const htmlEl = document.documentElement;
            const themeBtn = document.getElementById('themeToggle');
            function applyTheme(isDark) {
                if (isDark) {
                    htmlEl.setAttribute('data-theme', 'dark');
                    syncThemeToggleIcon(true);
                    localStorage.setItem('xtj-theme', 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    syncThemeToggleIcon(false);
                    localStorage.setItem('xtj-theme', 'light');
                }
            }
            if (themeBtn) {
                themeBtn.addEventListener('click', function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    applyTheme(!isDark);
                });
            }
            // 閸掓繂顫愰崠鏍﹀瘜妫版﹫绱版导妯哄帥 localStorage閿涘苯鍙惧▎锛勯兇缂佺喎浜告總?
            const savedTheme = localStorage.getItem('xtj-theme');
            if (savedTheme === 'dark') {
                applyTheme(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme(true);
            } else {
                applyTheme(false);
            }

            // ========== 閸忣剙鎲＄化鑽ょ埠 ==========
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
                // 鏉╂柨娲栭崚妤勩€冮弮鑸典划婢跺秶顓搁悶鍡楁喅閻ㄥ嫬褰傜敮鍐ㄥ隘閸?
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                markAnnouncementRead(ann.id);

                // 鏉╂稑鍙嗙拠锔藉剰閺冨爼娈ｉ挊蹇撳絺鐢啫灏崺?
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 鐠佸墽鐤嗛崣鎴濈閼板懍淇婇幁顖ょ礄閺勫墽銇氶張鈧弬鏉裤仈閸嶅骏绱?
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = avatarCache[ann.user_name];
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + ann.user_name.charAt(0).toUpperCase() + '</div>';
                    userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + escapeHtml(ann.user_name) + '</div>';
                }

                // 婵″倹鐏夐弰顖滎吀閻炲棗鎲抽敍灞惧潑閸旂姴鍨归梽銈嗗瘻闁?
                const existingDelBtn = detail.querySelector('.announcement-delete-btn');
                if (existingDelBtn) existingDelBtn.remove();
                if (isAdmin()) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'announcement-delete-btn';
                    delBtn.textContent = '閸掔娀娅庨崗顒€鎲?;
                    delBtn.onclick = function(e) { e.stopPropagation(); deleteAnnouncement(ann); };
                    const header = detail.querySelector('.announcement-detail-header');
                    if (header) header.appendChild(delBtn);
                }

                renderAnnouncementList(); // 闁插秵鏌婂〒鍙夌厠閸掓銆冮敍灞炬纯閺傛澘鍑＄拠鑽ゅЦ閹?
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
                    // 妫板嫬濮炴潪钘夊絺鐢啳鈧懎銇旈崓?
                    if (announcements.length > 0) {
                        var publishers = new Set();
                        announcements.forEach(function(a) { publishers.add(a.user_name); });
                        loadAvatarsForUsers(Array.from(publishers));
                    }
                } catch(e) {
                    console.error('閸旂姾娴囬崗顒€鎲℃径杈Е:', e);
                }
            }

            function parseAnnData(ann) {
                var title = '閸忣剙鎲?, content = ann.content || '';
                if (ann.content) {
                    try {
                        var parsed = JSON.parse(ann.content);
                        if (parsed.title !== undefined) { title = parsed.title || '閸忣剙鎲?; content = parsed.content || ''; }
                    } catch(e) {}
                }
                return { title: title, content: content };
            }

            function renderAnnouncementList() {
                const listEl = document.getElementById('announcementList');
                if (!listEl) return;

                if (!announcements.length) {
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">棣冩懃</div><div>閺嗗倹妫ら崗顒€鎲?/div></div>';
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
                    showToast('鐠囩柉鍤︾亸鎴濓綖閸愭瑦鐖ｆ０妯诲灗閸愬懎顔?);
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
                    showToast('閸忣剙鎲″彂甯冩垚鍔?);
                    await loadAnnouncements();
                    renderAnnouncementList();
                } catch(e) {
                    showToast('閸欐垵绔锋径杈Е: ' + (e.message || '閺堫亞鐓￠柨娆掝嚖'));
                }
            };

            window.deleteAnnouncement = async function(ann) {
                showConfirm('閸掔娀娅庨崗顒€鎲?, '绾喖鐣剧憰浣稿灩闂勩倛绻栭弶鈥冲彆閸涘﹤鎮ч敍', '閺?, async function() {
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
                        showToast('閸掔娀娅庢径杈Е: ' + (e.message || '閺堫亞鐓￠柨娆掝嚖'));
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
                    version: 'v0.0.60',
                    date: '2026-05-28',
                    content: `
                        <h4>娣囶喖顦查崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦茬紓鏍帆鐢牕鐡欓崗顒€绱?缁変礁鐦戞稉宥囨埂濮濓絿鏁撻弫鍫ユ６妫?/li>
                            <li>娣囶喖顦茬紒鐔活吀鐠囷附鍎忓▔鍕苟缁変礁鐦戠敮鏍х摍娴滄帒濮?/li>
                            <li>娣囶喖顦查悡褏澧栨０鍕潔閸欏苯鍤紓鈺佺毈/閸欏本瀵氱紓鈺傛杹娑撳秶菙鐎?/li>
                        </ul>
                        <h4>娴兼ê瀵查崘鍛啇</h4>
                        <ul>
                            <li>閻撗呭婢ф瑩顣╃憴鍫熸煀婢х偛寮婚幐鍥╃級閺€?/li>
                            <li>閺嶅洩顔囨惔鐔风磾閸戣姤鏆熼柆鍨帳鐠囶垯鎱ㄩ弨?/li>
                            <li>upload.js select 鐎涙顔岀€瑰本鏆ｉ幀褎褰侀崡?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.59',
                    date: '2026-05-27',
                    content: `
                        <h4>娣囶喖顦查崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦蹭妇鎶ラ幐澶愭尦閻愮懓鍤弮鐘叉惙鎼存棃妫舵０?/li>
                            <li>娣囶喖顦蹭妇鎶ラ幓鎰唉鐎涙顔岄崥宥呭爱闁板稄绱濆ǎ璇插 fallback 閺堝搫鍩?/li>
                            <li>娣囶喖顦查柅姘辩叀瀵偓閸?localStorage key 娑撳秳绔撮懛?/li>
                            <li>娣囶喖顦茬紒鐔活吀鐠囷附鍎忓▔鍕苟缁変礁鐦戠敮鏍х摍娴滄帒濮?/li>
                            <li>娣囶喖顦茬敮鏍х摍鐠囷附鍎忔い鍨￥缁変礁鐦戦弶鍐濡偓閺?/li>
                            <li>娣囶喖顦查崣鎴濈瑯閺傚洣娆㈡稉濠佺炊閺堫亝顥呴弻銉╂晩鐠?/li>
                        </ul>
                        <h4>娴兼ê瀵查崘鍛啇</h4>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>閸ュ墽澧栭崚鍡氶哺閻滃洣绔撮懛瀛樷偓褌绱崠?/strong>
                                <ul>
                                    <li>缂佺喍绔寸紓鈺冩殣閸ュ墽鏁撻幋鎰棘閺侀璐?200x1200閸掑棜椴搁悳鍥モ偓?.85閸樺缂夌拹銊╁櫤閿涘瞼鈥樻穱婵嗙殱闂堛垻缂夐悾銉ユ禈娑撳骸鐤勯梽鍛敶鐎瑰湱鍙庨悧鍥у瀻鏉堛劎宸煎В鏂剧伐閸滃本绔婚弲鏉垮閺嶅洤鍣€瑰苯鍙忔稉鈧懛?/li>
                                    <li>鐟曞棛娲婇悡褏澧栨晶娆庤⒈婵傛ぞ绗傛导鐘崇ウ缁嬪绱檜pload.js + features.js閿涘绱濇穱婵婄槈閹碘偓閺堝鏌婂铏瑰弾閻楀洤娼庨幐澶岀埠娑撯偓閺嶅洤鍣悽鐔稿灇妤傛宸濋柌蹇曠級閻ｃ儱娴?/li>
                                </ul>
                            </li>
                            <li><strong>閸掔娀娅庨崝鐔诲厴UI娑撳簼姘︽禍鎺嶇喘閸?/strong>
                                <ul>
                                    <li>鐏忓棛閮寸紒鐔洪獓window.confirm閸掔娀娅庣涵顔款吇瀵湱鐛ラ弴鎸庡床娑撻缚鍤滅€规矮绠熼悳鑽ゆ嫅绾俱劎鐖炲鍦崶閿涘本鏆ｆ担鎻妞嬪孩鐗哥紒鐔剁</li>
                                    <li>瀵湱鐛ラ柌鍥╂暏闁繑妲戦悳鑽ゆ嫅閺佸牊鐏?+ backdrop-filter: blur(28px) saturate(200%) 婢х偛宸辩壕銊х垶鐠愩劍鍔?/li>
                                    <li>瀵湱鐛ュ鐟板毉閺冩湹绮爏cale(0.9) translateY(20px)楠炶櫕绮︽潻鍥ㄦ诞閸掔増顒滅敮闀愮秴缂冾噯绱濋崝銊ф暰閺囪尙鍤巆ubic-bezier瀵鈧呯处閸?/li>
                                    <li>绾喛顓婚崚鐘绘珟閸氬骸鑴婄粣妞句簰scale(0.88)濞ｂ€冲毉閸斻劎鏁惧☉鍫濄亼閿涘矂浼勭純鈺佺湴閸氬本顒炲ǎ鈥冲</li>
                                    <li>閹稿鎸抽崷銊ュЗ閻㈢粯婀￠梻瀵割洣閻劑妲婚柌宥咁槻閻愮懓鍤敍宀€鍋ｉ崙濠氫紕缂冣晛鐪版径鏍劥閸欘垰褰囧☉?/li>
                                    <li>閹碘偓閺堝姘︽禍鎺撶ウ缁嬪鍤滈崝銊︾閻炲棗娲栫拫鍐ㄧ穿閻㈩煉绱濋柆鍨帳閸愬懎鐡ㄥ▔鍕础</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.55',
                    date: '2026-05-26',
                    content: `
                        <h4>娣囶喖顦查崘鍛啇</h4>
                        <ul>
                            <li><strong>閻撗呭婢ф瑥鐨濋棃銏℃▔缁€杞版叏婢?/strong>
                                <ul>
                                    <li>缁犫偓閸?photo-wall-item娴碱亜鍘撶槐鐘侯潒鐟欏鏅ラ弸婊愮礉缁夊娅庢径姘湴濞撴劕褰夐崣鐘插閿涘矂浼╅崗宥囨暏閹撮攱鍔呴惌銉ヮ樋瀵姴娴橀悧?/li>
                                    <li>閼村鍟块崷鍡欏箚濮濓絿鈥樼仦鍛厬鐎规矮缍呴敍灞剧Х闂勩倛顫嬬憴澶嬭穿娑?/li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭閻愮懓鍤０鍕潔娣囶喖顦?/strong>
                                <ul>
                                    <li>缁夊娅庨崘鑼崐閻ㄥ嚋SS閸斻劎鏁緋pTrackEnter閿涘矂浼╅崗宥勭瑢JS transform閺冭泛绨崘鑼崐</li>
                                    <li>openPhotoPreview娑擃厽鍧婇崝鐘活暕鐎规矮缍呴柅鏄忕帆閿涘瞼鈥樻穱婵婂缓闁挸婀柆顔惧兊鐏炲倸褰茬憴浣稿瀹告彃姘ㄦ担?/li>
                                    <li>娣囶喖顦查惄绋垮斀鐟欏棗娴榩pSortedPhotos鐞氼偉顩惄鏍畱Bug</li>
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
                                    <li>娴兼ê鍘涙担璺ㄦ暏閸氬本顒濧PI閿?lt;10ms閿涘绱濋悙鐟板毊閸楄櫕妞傞弰鍓с仛缂佽儻澹婇墎?瀵鈧冨З閻?/li>
                                </ul>
                            </li>
                            <li><strong>缂傗晜鏂佹稉搴㈠閸斿じ绱崠?/strong>
                                <ul>
                                    <li>ppResetZoom鐎瑰本鏆ｉ柌宥囩枂闁挎氨鍋ｉ悩鑸碘偓渚婄礉闂冨弶顒涚捄銊ユ禈濞堝鏆€</li>
                                    <li>閸欏本瀵氶梻纾嬬獩閸欐ê瀵?lt;10px閸掋倕鐣炬稉鐑樻￥閺佸牊鎼锋担婊愮礉闂冭尪顕ょ拠鍡楀焼</li>
                                </ul>
                            </li>
                            <li><strong>缁嬪啿鐣鹃幀褌鎱ㄦ径?/strong>
                                <ul>
                                    <li>閺傛澘顤僺afeLocalStorageGetJSON閿?5婢跺嫭娴涢幑銏℃建缂佹姬ocalStorage瀹曗晜绨?/li>
                                    <li>缁夊娅庝妇鎶ュ鍦崶閸愬懓浠坉isplay:none閿涘瞼绮烘稉鈧珻SS class閹貉冨煑</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.53',
                    date: '2026-05-25',
                    content: `
                        <h4>娣囶喖顦查崘鍛啇</h4>
                        <ul>
                            <li><strong>鐏忎線娼伴梻顓炲瘶闂勭兘妲烘穱顔碱槻</strong>
                                <ul>
                                    <li>IIFE閸栧懓锛欑涵顔荤箽濮ｅ繐绱堕崶鍓у閻欘剛鐝涚紒鎴濈暰閿涘苯鍙忛柈銊︻劀绾喖濮炴潪?/li>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>涓炬姤閹稿鎸虫穱顔碱槻</strong>
                                <ul>
                                    <li>鐏忓棔濡囬幎銉﹀瘻闁筋喚娲块幒銉ョサ閸忋儱绗樼€涙劖膩閺夌竷TML閿涘澁enderFeedWithAvatars 閸?appendMorePosts閿涘绱濋弴澶稿敩閼村棗鎬ラ惃鍑濷M閹垫捁藟娑撲焦鏌熷?/li>
                                    <li>缁夊娅巉eatures.js娑擃厾娈慚utationObserver鐞涖儰绔垫禒锝囩垳閿涘本瀵滈柦顕€娈㈢敮鏍х摍閸掓繂顫愰崝鐘烘祰娑撯偓楠炶埖瑕嗛弻鎿勭礉閺夋粎绮峰☉鍫濄亼闂傤噣顣?/li>
                                    <li>涓炬姤閹稿鎸抽崣鍐差嚠姒绘劗鐤嗘惔鏇礉闁俺绻僫nline onclick鐠嬪啰鏁indow.openReport閿涘苯鍚嬬€硅澧嶉張澶庮啎婢跺洤鎷扮仦蹇撶鐏忓搫顕?/li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭閸忋劌鐫嗘０鍕潔閸欏本瀵氶弨鎯с亣閹嗗厴娴兼ê瀵?/strong>
                                <ul>
                                    <li>CSS鐏炲倿娼伴崥顖滄暏GPU绾兛娆㈤崝鐘烩偓鐕傜窗backface-visibility: hidden + transform: translateZ(0) + will-change: transform</li>
                                    <li>閹靛濞嶇化鑽ょ埠闁插秵鐎敍姘额暕閸掑棝鍘inchPre鐎电钖勯柆鍨帳濮ｅ繐鎶欰rray.from閸掑棝鍘ら敍宀勬娴ｅ定C閸樺濮?/li>
                                    <li>閺傛澘顤冪仦蹇撶閸掗攱鏌婇悳鍥殰閸斻劍顥呭ù瀣剁礄rAF娑擃厼鈧吋纭堕敍澶涚礉閼奉亪鈧倸绨?20Hz/90Hz/60Hz鐢囶暕缁?/li>
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
                        <h4>娣囶喖顦查崘鍛啇</h4>
                        <ul>
                            <li><strong>閻撗呭婢ф瑦鏆熼幑顔绘丢婢堕亶妫舵０妯轰氦鎼存洑鎱ㄦ径?/strong>
                                <ul>
                                    <li>閺嶇懓娲滅€规矮缍呴敍姝爀atures.js娑撶捇enderPhotoWall鐞涖儰绔电憰鍡欐磰娴滃敃ender.js閻ㄥ嫭顒滅涵顔肩杽閻滃府绱濈€佃壈鍤у姝岀箼娴犲海鈹栭弫鎵矋[]濞撳弶鐓?/li>
                                    <li>缁夊娅庨柨娆掝嚖閻ㄥ嫯藟娑撲椒鍞惍渚婄礉閹垹顦瞨ender.js娑擃厼鐣弫瀵告畱閸旂姾娴?閹烘帒绨?濞撳弶鐓嬪ù浣规寜缁?/li>
                                    <li>娣囶喖顦瞗eatures.js娑擃厼顦挎稉鐙狪FE娴ｆ粎鏁ら崺鐔荤Ш閻ｅ矁鐨熼悽顭掔礄formatPhotoTime閵嗕躬scapeHtml缁涘鍙忕仦鈧崙鑺ユ殶瀵洜鏁ゆ穱顔碱槻閿?/li>
                                </ul>
                            </li>
                            <li><strong>缁涙盯鈧甯撴惔蹇撳閼虫垝鎱ㄦ径?/strong>
                                <ul>
                                    <li>閺冦儲婀￠妴浣告倳缁夎埇鈧胶鍎规惔锔跨瑏缁夊秵甯撴惔蹇旀蒋娴犲墎骞囬崷銊ㄥ厴濮濓絿鈥樼紒鍕値閻㈢喐鏅?/li>
                                    <li>閹烘帒绨崚鍥ㄥ床閸氬海鍙庨悧鍥ь暰鐎圭偞妞傞弴瀛樻煀閿涘瞼绮ㄩ弸婊咁儊閸氬牓顣╅張鐔尖偓鏄忕帆</li>
                                    <li>閸掔娀娅庨幙宥勭稊閸氬酣鍣搁弬鐗堣閺屾挷绻氶幐浣哥秼閸撳秵甯撴惔蹇涙暛閿涘奔绗夐崘宥夊櫢缂冾喕璐熸妯款吇閹烘帒绨?/li>
                                </ul>
                            </li>
                            <li><strong>閻╃鍞界憴鍡楁禈缁岃櫣娅ф穱顔碱槻</strong>
                                <ul>
                                    <li>閺佺増宓侀崝鐘烘祰闁炬崘鐭炬穱顔碱槻閸氬函绱濋惄绋垮斀鐟欏棗娴橀崷銊︽箒閻撗呭閺冩儼鍏樺锝団€樺〒鍙夌厠"閹稿妫╅張鐔峰瀻缂?閻ㄥ嫮娴夐崘灞藉灙鐞?/li>
                                    <li>娴犲懎婀涵顔肩杽閺冪姷鍙庨悧鍥ㄦ殶閹诡喗妞傞幍宥嗘▔缁€?閺嗗倹妫ら悡褏澧?閹绘劗銇?/li>
                                </ul>
                            </li>
                            <li><strong>閸忋劌鐫嗘０鍕潔娴溿倓绨版导妯哄</strong>
                                <ul>
                                    <li>閸欏本瀵氱紓鈺傛杹閿涙碍鏌婃晶鐎檖ApplyPinchTransformImmediate閻╁瓨甯存惔鏃傛暏transform閿涘矁鐑︽潻鍣怉F瀵ゆ儼绻滈敍灞惧絹閸楀洩绐￠幍瀣偓?/li>
                                    <li>閼奉亪鈧倸绨茬敮褔顣╃粻妤嬬窗3鏉烆啔?0鐢傝厬閸婂ジ鍣伴弽閿嬵梾濞?20Hz/90Hz/60Hz閸掗攱鏌婇悳鍥风礉缁儳鍣崚鍡涘帳鐢囶暕缁?/li>
                                    <li>閸ュ墽澧栭崚鍥ㄥ床濞戝牓娅庢鎴濈潌閿涙pDecodeImage妫板嫬濮炴潪?img.decode()绾喕绻氱憴锝囩垳鐎瑰本鍨氶崥搴″晙閺勫墽銇氶敍瀹眕acity楠炶櫕绮︽潻鍥ㄦ诞</li>
                                    <li>閸撳秴鎮楅崥?瀵姷鍙庨悧鍥ㄥ絹閸撳秹顣╅崝鐘烘祰閿涘苯鐤勯悳浼淬€庡鎴犳畱閸楄櫕妞傞崚鍥ㄥ床</li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭婢ф瑦膩閸ф鍣搁弸鍕旂€规碍鈧傛叏婢?/strong>
                                <ul>
                                    <li>photo-wall.js娑撶挶nitPhotoWall閸戣姤鏆熼柅姘崇箖window鐎电钖勭€电厧鍤敍瀹憃re.js鐠嬪啰鏁ら弮璺侯杻閸旂垚ypeof鐎瑰鍙忓Λ鈧弻?/li>
                                    <li>preview.js娑擃厺鎱ㄦ径宄眕EventsBound閺嶅洤绻旀担宥忕礉绾喕绻氶棃娆愨偓涓燭ML鐟曞棛娲婄仦鍌欑皑娴犺埖顒滅涵顔剧拨鐎?/li>
                                    <li>娣囶喖顦瞤hotocurImg閹风厧鍟撻柨娆掝嚖娑撶urImg</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.50',
                    date: '2026-05-25',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>閻撗呭婢ф瑥濮涢懗钘夊弿闂堛垹鐣崰?/strong>
                                <ul>
                                    <li>閺傛澘顤冮幐澶嬫）閺堢喆鈧礁鎮曠粔鑸偓浣哄劰鎼达缚绗佺粔宥嗘蒋娴犲墎娈戠粵娑⑩偓澶嬪笓鎼村繐濮涢懗鏂ょ礉閸掑洦宕查崥搴ｇ彌閸楀啿鎼锋惔?/li>
                                    <li>娣囶喖顦查惄绋垮斀鐟欏棗娴橀弰鍓с仛"閺嗗倹妫ら悡褏澧?閻ㄥ嫮鈹栭惂浠嬫６妫版﹫绱濋悙鐟板毊閻╃鍞介幐澶愭尦濮濓絿鈥橀崝鐘烘祰鐎电懓绨查崘鍛啇</li>
                                    <li>鐎佃壈鍩呴弽蹇涙娑撳﹣绗呭鎴濆З閼奉亜濮╅梾鎰/閺勫墽銇氶敍灞剧セ鐟欏牏鍙庨悧鍥ㄦ娑撳秴鍟€闁喗灏呴崘鍛啇</li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭妫板嫯顫嶆禍銈勭鞍娴兼ê瀵?/strong>
                                <ul>
                                    <li>娣囶喖顦查崗銊ョ潌妫板嫯顫嶆稉瀣礋閻愬綊鈧偓閸戣桨绗岄崣灞藉毊閺€鎯с亣閻ㄥ嫬鍟跨粣渚€妫舵０姗堢礉娑撱倗顫掗幙宥勭稊娴滄帊绗夐獮鍙夊</li>
                                    <li>閸掔娀娅庨幐澶愭尦閸ョ偓鐖ｉ悽?x"閺囨寧宕叉稉鍝勭€崷鐐€奡VG閸ョ偓鐖ｉ敍灞肩瑢閸忔娊妫撮幐澶愭尦濞撳懏娅氶崠鍝勫瀻</li>
                                    <li>娴兼ê瀵插锕€褰稿鎴濆З妫板嫯顫嶉弮鍓佹畱閸ュ墽澧栭崝鐘烘祰缁涙牜鏆愰敍灞剧Х闂勩倝绮︾仦蹇ョ礉闁插洨鏁ら崶鍓у缂傛挸鐡?瀵ゆ儼绻滈崝鐘烘祰閸撳秴鎮楅崶鍓у娴兼ê鍘涚痪褎鏌熷?/li>
                                    <li>閸ュ墽澧栭崝鐘烘祰閺冭埖妯夌粈楦垮墻閸愭彃濮╅悽鏄忓剹閺咁垽绱濋弴澶稿敩缁绢垶绮﹂懗灞炬珯閿涘本褰侀崡鍥潒鐟欏缍嬫?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.40',
                    date: '2026-05-24',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>UI鐟欏棜顫庢导妯哄</strong>
                                <ul>
                                    <li>鎼存洟鍎寸€佃壈鍩呴弽蹇撳箵濡楀棜鐎洪崥鍫窗缁夊娅庨懗灞炬珯閵嗕浇绔熷鍡愨偓渚€妲捐ぐ鎲嬬礉娴犲懍绻氶悾娆忔磽娑擃亝瀵滈柦顔煎讲鐟欎緤绱濋幐澶愭尦闂傛潙灏崺鐔峰讲缁屽潡鈧繒鍋ｉ崙?/li>
                                    <li>缂佺喍绔撮棃銏℃緲/妞ょ敻娼伴懗灞炬珯娑撹桨鑵戦幀褑澹婇敍鍫熺ガ閻?濞ｈ京浼嗛敍澶涚礉缁夊娅庣紒鑳閼硅尪鐨熼敍宀冃掗崘鐮砄S鎼存洟鍎寸紒鑳闁繑妯夐梻顕€顣?/li>
                                </ul>
                            </li>
                            <li><strong>閻撗呭婢ф瑥濮涢懗钘夘杻瀵?/strong>
                                <ul>
                                    <li>閺傛澘顤冮崗銊ョ潌濞村繗顫嶅锕€褰稿鎴濆З閸掑洦宕查崶鍓у閸旂喕鍏橀敍灞炬暜閹镐焦澧滈崝鎸庡珛閹疯棄顕遍懜?/li>
                                    <li>妫ｆ牕鐔潏鍦櫕婢跺嫮鎮婇敍姘鳖儑娑撯偓瀵姳绗夐懗钘変箯濠婃埊绱濋張鈧崥搴濈瀵姳绗夐懗钘夊礁濠婃埊绱濈敮锕傛▎閸旀稑寮芥＃鍫濇嫲瀵懓娲栭崝銊ф暰</li>
                                    <li>閸欐牗绉锋潻鍥ㄦ诞闂傤亞鍎婇敍姘叏婢跺秴鍨忛幑銏犳禈閻楀洦妞傞惃鍕秴缂冾喛鐑︾捄鍐ㄦ嫲闂傤亞娅ug</li>
                                    <li>閸欏本瀵氱紓鈺傛杹娴兼ê瀵查敍姘毙╅梽顥窤F閹电懓顦╅悶鍡楁鏉╃噦绱濋惄瀛樺复鎼存梻鏁ransform鐎圭偟骞囬崢鐔烘晸缁狙嗙閹靛绁﹂悾鍛</li>
                                    <li>閺佺繝缍嬪鎴濆З濞翠胶鏅犳惔锔跨喘閸栨牭绱皐ill-change閵嗕辜ransition缁墽绮忛崠鏍ㄥ付閸?/li>
                                </ul>
                            </li>
                            <li><strong>閸濆秴绨插蹇涒偓鍌炲帳</strong>
                                <ul>
                                    <li>楠炶櫕婢橀敍?68px+閿涘绱扮€圭懓娅掑鈥愁啍閵嗕焦娲挎径褏娈戦梻纾嬬獩閸滃苯鐡ф担鎾扁偓浣规瀮缁旂姴宕遍悧鍥х湷娑?/li>
                                    <li>濡楀矂娼伴敍?024px+閿涘绱伴悡褏澧栨晶?閸掓ぜ鈧焦鏋冪粩鐘插幢閻楀洦娲跨€瑰鈧礁鐡ф担鎾存纯婢?/li>
                                    <li>鐎硅棄鐫嗛敍?280px+閿涘绱伴悡褏澧栨晶?閸掓ぜ鈧焦娲挎径姘辨殌閻?/li>
                                    <li>濡亜鐫嗛幍瀣簚娴兼ê瀵查敍姘辩級鐏忓繐绨抽柈銊ヮ嚤閼割亝鐖崡鐘垫暏缁屾椽妫?/li>
                                </ul>
                            </li>
                            <li><strong>娴狅絿鐖滃〒鍛倞</strong>
                                <ul>
                                    <li>閸掔娀娅庨柆妤冩殌閻ㄥ埇18n缂堟槒鐦ф禒锝囩垳閿涘澅ranslations鐎涙鍚€閵嗕辜ranslatePage閸戣姤鏆熼妴浣筋嚔鐟封偓闁瀚║I閿?/li>
                                    <li>缁墽鐣漵yncProfileUser缁涘鍤遍弫甯礉缁夊娅庣€靛湱鐐曠拠鎴濈摟閸忓摜娈戞笟婵婄</li>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>娴狅絿鐖滃〒鍛倞娑撳海绨跨粻鈧?/strong>
                                <ul>
                                    <li>瑜拌绨崇粔濠氭珟闂嗗懏鈧繂宕熺拠宥咁劅娑旂姷閮寸紒鐔峰弿闁劋鍞惍渚婄礄CSS閺嶅嘲绱￠妴涓闁槒绶妴涓燭ML缂佹挻鐎敍?/li>
                                    <li>閸掔娀娅庣拋鍓х枂妞ゅ吀鑵戦惃鍕鐠?闂娾晞顕㈤崚鍥ㄥ床闁銆嶉敍灞肩矌娣囨繄鏆€娑擃厽鏋?/li>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>闂嗗懏鈧繂宕熺拠宥囧閸ф鍙忛棃銏ゅ櫢閸嬫矮璐熼悡褏澧栨晶娆欑礄閻╃鍞介崝鐔诲厴閿?/strong>
                                <ul>
                                    <li>鐎瑰苯鍙忛弴鎸庡床panelAi闂堛垺婢樻稉铏瑰弾閻楀洤顣綡TML缂佹挻鐎敍宀€些闂勩倖澧嶉張澶婂礋鐠囧秴顒熸稊鐘垫櫕闂?/li>
                                    <li>濮ｅ繋缍呴悽銊﹀煕閸欘垳瀚粩瀣╃瑐娴肩姷鍙庨悧鍥风礄base64鐎涙ê鍋嶉懛鐮給calStorage閿涘苯宕熷鐘绘閸?0MB閿?/li>
                                    <li>濡亝甯?瀵姷缍夐弽鐓庣鐏炩偓閿涘潛rid-template-columns: repeat(5, 1fr)閿涘绱濈粩鏍ㄥ笓閺冪娀妾哄姘З閹烘帒鍨?/li>
                                    <li>閻撗呭閸楋紕澧杊over閺冭埖妯夌粈鍝勫絺鐢啳鈧懎鎮曠粔鑸偓浣稿絺鐢啯妞傞梻娣偓浣圭セ鐟欏牓鍣?/li>
                                    <li>閻愮懓鍤禒缁樺壈閻撗呭鏉╂稑鍙嗛崗銊ョ潌妫板嫯顫嶉敍姘祼鐎规艾鐣炬担宥変紕缂冣晛鐪伴敍灞藉斧閻㈡槒宸濈仦鍛厬鐏炴洜銇?/li>
                                    <li>妫板嫯顫嶆い鍨▔缁€鍝勫絺鐢啰鏁ら幋鏋偓浣稿絺鐢啯妞傞梻娣偓浣圭セ鐟欏牓鍣洪敍鍫㈠仯閸戞槒鍤滈崝?1鐠佲剝鏆熼敍?/li>
                                    <li>閻撗呭閹稿绗傛导鐘虫闂傛潙鈧帒绨幒鎺戝灙閿涘牊娓堕弬鏉挎躬閸撳稄绱氶敍灞炬暜閹镐焦娅ら懗鑺ユ闂傚瓨鐗稿蹇撳</li>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>瑜拌绨虫穱顔碱槻閹碘偓閺堝妫舵０姗堢礉鐎圭偟骞囬弸浣藉毀閻ㄥ嫭鎭幀浣哄箵閻犲啯鏅ラ弸?/strong>
                                <ul>
                                    <li>缂佹瑥宕熺拠宥夈€夐棃銏″潑閸旂姴顦查弶鍌涚瑤閸欐姹楅悶鍡氬剹閺咁垽绱濈拋銈渁ckdrop-filter閼崇晫婀″锝呭絺閹搞儱鍤悳鑽ゆ嫅閺佸牊鐏?/li>
                                    <li>閹跺シock-panel閻ㄥ嫭绮撮崝銊ь洣閻㈩煉绱濈拋鈺佸礋鐠囧秹銆夐棃銏ｅ殰瀹歌京顓搁悶鍡樼泊閸旑煉绱濈憴锝呭枀閹烘帞澧楀ǎ铚傝础闂傤噣顣?/li>
                                    <li>閸楋紕澧栭妴渚€鈧銆嶉妴浣稿冀妫ｅ牓娼伴弶鍧楀厴濞ｈ濮為弸浣藉毀閻ㄥ嫮骞撻悹鍐窛閹扮噦绱版径姘湴鏉堣顢嬮妴浣稿敶妤傛ê鍘滈妴浣割樆闂冩潙濂栭妴渚€鐝鍝勫blur</li>
                                    <li>閹碘偓閺堝鍘撶槐鐘插娴碱亜鍘撶槐鐘荤彯閸忓鐪伴敍灞筋杻瀵櫣骞撻悹鍐畱闁岸鈧繐鎷扮粩瀣╃秼閹?/li>
                                    <li>閸欏秹顩棃銏℃緲缁夎娲杤ocab-scroll闁插矉绱濈憴锝呭枀闁喗灏呴柅澶愩€嶉惃鍕６妫?/li>
                                    <li>閺嗘澹婂Ο鈥崇础閸氬本顒為崡鍥╅獓閿涘矁鍎楅弲顖滄暏濞ｈ精澹婂〒鎰綁+閻滆崵鎷戦崗鍐</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.35',
                    date: '2026-05-13',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>娣囶喖顦茬€靛綊鏁婇棅铏櫏娑撳秶鏁撻弫鍫ユ６妫?/strong>
                                <ul>
                                    <li>娣囶喖顦睞udioContext鐞氼偅绁荤憴鍫濇珤閹稿倽鎹ｇ€佃壈鍤ч弮鐘诧紣閿涘牆顤冮崝鐖巈sume()閸炪倝鍟嬮敍?/li>
                                    <li>閹绘劙鐝棅铏櫏闂婃娊鍣洪敍鍧揳in娴?.1閹绘劕宕岄懛?.18閿涘绱濋柨娆掝嚖闂婅櫕鏁奸悽鈺皉iangle濞夈垺娲垮〒鍛珰</li>
                                    <li>妞ょ敻娼版＃鏍偧閻愮懓鍤懛顏勫З鐟欙綁鏀ｉ棅鎶筋暥娑撳﹣绗呴弬?/li>
                                </ul>
                            </li>
                            <li><strong>娣囶喖顦茬紒褏鐢婚幐澶愭尦娴ｅ秶鐤嗛棃鐘辩瑐</strong>
                                <ul>
                                    <li>鐎圭懓娅掓惔鏇㈠劥閸愬懓绔熺捄婵嗩杻閸旂姾鍤?6px閿涘矂鈧銆嶉崠鍝勭俺闁劑妫块梾娆忣杻閸旂姾鍤?0px</li>
                                    <li>鎼存洟鍎磃lex闂傛挳娈禒?0px閹绘劕宕岄懛?6px閿涘本瀵滈柦顔款攽婢х偛濮炴稉濠呯珶鐠?/li>
                                </ul>
                            </li>
                            <li><strong>濞戝弶鈧胶骞撻悹鍐╂櫏閺嬫粌銇囬獮鍛杻瀵?/strong>
                                <ul>
                                    <li>閸楋紕澧栭敍姝砱ba 0.85 + blur(32px) saturate(220%)閿涘矂妲捐ぐ杈╃倳閸?/li>
                                    <li>闁銆嶉敍姝砱ba 0.72 + blur(16px) saturate(180%)</li>
                                    <li>閸欏秹顩棃銏℃緲閿涙gba 0.82 + blur(30px) saturate(220%)</li>
                                    <li>閺嗘澹婂Ο鈥崇础閸氬本顒炴晶鐐插繁</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.34',
                    date: '2026-05-13',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>闂嗗懏鈧繂宕熺拠宥夈€夐棃銏犲弿闂堛垽鍣搁弸鍕喘閸?/strong>
                                <ul>
                                    <li>娣囶喖顦茬紒褏鐢婚幐澶愭尦娴ｅ秶鐤嗛棃鐘辩瑐闂傤噣顣介敍灞藉冀妫ｅ牓娼伴弶璺ㄐ╅懛鍐茬俺闁劎鎻ｉ柇鑽ゆ埛缂侇厽瀵滈柦?/li>
                                    <li>鐎靛綊鏁婇崣宥夘洯娴犲じ绗夐懗灞藉礋鐠囧秹顥撻弽濂稿櫢閸嬫熬绱版径褍娴橀弽?閸楁洝鐦濋棅铏垼+闁插﹣绠?娓氬褰為悪顒傜彌鐏炴洜銇?/li>
                                    <li>婢х偛濮炵€靛綊鏁婇棅铏櫏閿涘湹eb Audio API 閻㈢喐鍨氶惌顓濈妇閹绘劗銇氶棅绛圭礉濮濓絿鈥橀崡鍥殶/闁挎瑨顕ら梽宥堢殶閿?/li>
                                    <li>閺囨寧宕查崚鍥ㄥ床閸斻劎鏁炬稉铏圭級閺€?濞ｂ€冲弳濞ｂ€冲毉缂佸嫬鎮庨敍灞炬纯閸旂姵绁﹂悾鍛板殰閻?/li>
                                    <li>婢х偛宸卞☉鍙夆偓浣哄箵閻犲啯鏅ラ弸婊愮窗閼冲本娅欓柅蹇旀鎼达附褰佹妯垮殾0.78閿涘本膩缁﹥褰侀崡鍥殾26px</li>
                                    <li>娣囶喖顦查崡鏇＄槤闁插秴顦查梻顕€顣介敍姘暭娑撴椽娈㈤張娲Е閸掓绀傞悧宀€鐣诲▔鏇礉绾喕绻?00鐠囧秴鍙忛柈銊ㄧ枂鐎瑰本澧犻柌宥咁槻</li>
                                </ul>
                            </li>
                            <li><strong>TTS鐠囶參鐓舵潻娑楃濮濄儰绱崠?/strong>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>闂嗗懏鈧繂宕熺拠宥囬兇缂佺喎鍙忛棃顫喘閸?/strong>
                                <ul>
                                    <li>閹烘帞澧楅柌宥嗘煀鐠佹崘顓搁敍灞灸侀幏鐔剁瑝閼冲苯宕熺拠?閻ф崘鐦濋弬鈺咁棑閺嶇》绱濋獮鎻掑櫍閻ц棄绨抽弮鐘冲亾濞搭喗鏅ラ弸?/li>
                                    <li>TTS鐠囶參鐓舵导妯哄閿涘矁鍤滈崝銊┾偓澶嬪閺堚偓閼奉亞鍔ч懟杈ㄦ瀮鐠囶參鐓堕敍宀冾嚔闁喐娲块惇鐔风杽</li>
                                    <li>婢х偛濮炵€靛綊鏁婇弫浼村櫤鐠佹澘缍嶉敍鍧檕calStorage閹镐椒绠欓崠鏍电礆閿涘本顒滅涵顔惧芳鏉╂稑瀹抽弶鈩冩▔缁€?/li>
                                    <li>閸楋紕澧栧鎴濆弳/濠婃垵鍤潻鍥ㄦ诞閸斻劎鏁鹃敍灞惧絹閸楀洣姘︽禍鎺撶ウ閻ｅ懎瀹?/li>
                                    <li>闁銆嶉弨閫涜礋2閸掓缍夐弽鐓庣鐏炩偓閿涘瞼鐡熷鍫燁劀绾?闁挎瑨顕ゆ潏瑙勵攱妫版粏澹婇崣宥夘洯</li>
                                </ul>
                            </li>
                            <li><strong>濞撳懐鎮婇柆妤冩殌閺冄傚敩閻?/strong>
                                <ul>
                                    <li>缁夊娅庨弮褏娈?toggleAIChat 閺冪姷鏁ら崙鑺ユ殶</li>
                                    <li>閸掔娀娅庨幍鈧張澶嬫＋AI濡剝婢橀惄绋垮彠閻ㄥ嫮鐐曠拠鎴︽暛閿涘潊iWelcome閵嗕躬nterYourQuestion閵嗕够end閿?/li>
                                    <li>閸掔娀娅庨弮顪嘔濮樻梹鍦篊SS閺嶅嘲绱￠敍?ai-msg閿?/li>
                                    <li>閸掔娀娅嶵aylor Swift閻㈣绮栭弮褌鍞惍渚婄礄initTSGallery閿?/li>
                                </ul>
                            </li>
                            <li><strong>娣囶喖顦睪it閸氬牆鑻熼崘鑼崐鐎佃壈鍤х純鎴犵彲瀹曗晜绨?/strong>
                                <ul>
                                    <li>娣囶喖顦?婢跺嫭鐣悾娆戞畱閸氬牆鑻熼崘鑼崐閺嶅洩顔囬敍鍦昐S/HTML/JS閿涘绱濇い鐢告桨閹垹顦插锝呯埗</li>
                                </ul>
                            </li>
                            <li><strong>闂嗗懏鈧繂宕熺拠宥夈€夐棃銏℃伀閹胶骞撻悹鍐棑閺嶅ジ鍣搁崑?/strong>
                                <ul>
                                    <li>閸欐垿鐓堕幐澶愭尦娴犲穲moji閺€閫涜礋SVG閸犲洤褰崶鐐垼+婢圭増灏濋崝銊ф暰+濞戝弶鈧胶骞撻悹鍐啇閸?/li>
                                    <li>TTS鐠囶參鐓舵导姗€鈧?2缁夊秷鍤滈悞鎯邦嚔闂婄绱橤oogle UK Female/Microsoft Zira缁涘绱氶敍宀冾嚔闁?.85闂婂疇鐨?.05</li>
                                    <li>閸樼粯甯€娓氬褰為張妤勵嚢閿涘苯褰ч張妤勵嚢閸楁洝鐦濋張顒冮煩</li>
                                    <li>閸楋紕澧?闁銆?閸欏秹顩棃銏℃緲閸忋劑鍎撮弨閫涜礋濞戝弶鈧胶骞撻悹鍐╂櫏閺嬫粣绱檅ackdrop-filter濮ｆ稓骞撻悹鍐跨礆</li>
                                    <li>闁銆嶉悙鐟板毊濮樺瓨灏濈痪鐟板З閻?濮濓絿鈥樺瑙勨偓褍鑴婄捄?闁挎瑨顕ら幎鏍уЗ閸欏秹顩?/li>
                                    <li>鐎靛綊鏁婇崣宥夘洯閺嶅洭顣介崠鍝勫瀻閺勫墽銇氶敍鍫氭附濮濓絿鈥?閴傚瞼鐡熷鍫熸Ц閿?/li>
                                    <li>閸掑棙鏆熼弫鏉跨摟閻愮懓鍤瑙勨偓褎鏂佹径褍濮╅悽?/li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.32',
                    date: '2026-05-12',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li><strong>闂嗗懏鈧繆鐦濆Ч鍥х氨閸忋劑娼伴崡鍥╅獓</strong>
                                <ul>
                                    <li>鐏忓棗甯張澶婂灥娑擃厽鎸夐獮鍐茬唨绾偓鐠囧秵鐪归崗銊╂桨閺囨寧宕叉稉娲长閹繈鐝０鎴ｂ偓鍐仯閸楁洝鐦?/li>
                                    <li>鐠囧秴绨遍幍鈺佸帠閼?00+娑擃亞婀″锝囨畱闂嗗懏鈧繃鐗宠箛鍐槤濮?/li>
                                    <li>鐠囧秵鐪瑰☉鐢垫磰 abandon 閸?yield 缁涘娉ら幀婵嗙箑婢跺洩鐦濆Ч?/li>
                                    <li>濮ｅ繋閲滈崡鏇＄槤閸у洤瀵橀崥顐ｇ垼閸戝棝鐓堕弽鍥モ偓浣藉閺傚洣绶ラ崣銉ュ挤娑擃厽鏋冪紙鏄忕槯</li>
                                </ul>
                            </li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.31',
                    date: '2026-05-12',
                    content: `
                        &lt;h4&gt;閺囧瓨鏌婇崘鍛啇&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift &amp; Jennie娑撴捇顣介悽璇茬矕閺囨寧宕叉稉娲长閹繂宕熺拠宥咁劅娑旂姷閮寸紒?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;閸掔娀娅庨幍鈧張澶婂斧娑撴捇顣芥い鐢垫畱CSS閺嶅嘲绱￠敍?idol-閵?ts-瀵偓婢跺瓨鐗卞蹇ョ礆&lt;/li&gt;
                                    &lt;li&gt;閺傛澘顤冮梿鍛偓婵嗗礋鐠囧秴顒熸稊鐘甸兇缂佺喎鐣弫瀛樼壉瀵骏绱?vocab-閸涜棄鎮曠粚娲？閿?lt;/li&gt;
                                    &lt;li&gt;閺囨寧宕瞤anelAi闂堛垺婢楬TML缂佹挻鐎稉鍝勫礋鐠囧秴顒熸稊鐘垫櫕闂?lt;/li&gt;
                                    &lt;li&gt;閺傛澘顤?00娑擃亪娉ら幀婵囩壋韫囧啳鐦濇惔鎿勭礉閸栧懎鎯堥崡鏇＄槤閵嗕線鐓堕弽鍥モ偓渚€鍣存稊澶堚偓浣风伐閸?lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;闂嗗懏鈧繂宕熺拠宥咁劅娑旂姷閮寸紒鐔峰閼?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;閸欏本膩瀵繐顒熸稊鐙呯窗閼昏精鐦ф稉顓熌佸蹇嬧偓浣疯厬鐠囨垼瀚冲Ο鈥崇础&lt;/li&gt;
                                    &lt;li&gt;閻愮懓鍤鏀伴幐澶愭尦閸欘垱婀曠拠鏄忓閺傚洤宕熺拠?lt;/li&gt;
                                    &lt;li&gt;缁涙柨鐣０妯垮殰閸斻劍婀曠拠璇插礋鐠囧秴鎷伴懟杈ㄦ瀮娓氬褰?lt;/li&gt;
                                    &lt;li&gt;濮ｅ繑顐奸梾蹇旀簚閻㈢喐鍨?娑擃亪鈧銆嶆笟娑⑩偓澶嬪&lt;/li&gt;
                                    &lt;li&gt;濮濓絿鈥樼粵鏃€顢嶇紒鑳妤傛ü瀵掗敍宀勬晩鐠囶垳鐡熷鍫㈠閼瑰弶濮堥崝?lt;/li&gt;
                                    &lt;li&gt;缁涙棃顣介崥搴㈡▔缁€楦款嚊缂佸棜袙閺嬫劕鎷版笟瀣綖&lt;/li&gt;
                                    &lt;li&gt;鐎瑰苯鍙忛弨顖涘瘮濞ｈ精澹?濞村懓澹婃稉濠氼暯閼奉亜濮╅柅鍌炲帳&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                        &lt;/ul&gt;
                    `
                },
                {
                    version: 'v0.0.30',
                    date: '2026-05-03 16:00',
                    content: `
                        &lt;h4&gt;閺囧瓨鏌婇崘鍛啇&lt;/h4&gt;
                        &lt;ul&gt;
                            &lt;li&gt;&lt;strong&gt;Taylor Swift娑撴捇顣芥い浣冾潒鐟欏绗岄弸鑸电€崗銊╂桨闁插秵鐎?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;閸掔娀娅庨幍鈧張澶嬫＋閻?.ts- 瀵偓婢剁SS閺嶅嘲绱?lt;/li&gt;
                                    &lt;li&gt;閺傛澘顤冮崣灞兼眽娑撴捁绶仦鏇犮仛婢ф瑦鐗卞蹇ョ礄.idol- 閸涜棄鎮曠粚娲？閿?lt;/li&gt;
                                    &lt;li&gt;瀵洖鍙咷oogle Fonts Great Vibes閹靛鍟撴担?lt;/li&gt;
                                    &lt;li&gt;娑撴捁绶崡锛勫hover閺冨墎缂夐弨?绾俱劎鐖為悳鑽ゆ嫅闁喚鍍甸弫鍫熺亯&lt;/li&gt;
                                    &lt;li&gt;SVG缁涙儳鎮曢幓蹇氱珶閸斻劎鏁?鐎圭偛绺炬繅顐㈠帠濞ｂ€冲弳&lt;/li&gt;
                                &lt;/ul&gt;
                            &lt;/li&gt;
                            &lt;li&gt;&lt;strong&gt;娴狅絿鐖滃〒鍛倞娴兼ê瀵?lt;/strong&gt;
                                &lt;ul&gt;
                                    &lt;li&gt;閸掔娀娅庨崗銊╁劥Taylor Swift閻㈣绮朖avaScript娴狅絿鐖?lt;/li&gt;
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>Taylor Swift娑撴捇顣芥い鍏告唉娴滄帒宕岀痪?/li>
                            <ul>
                                <li>缁涙儳鎮曢幍瀣晸閸斻劎鏁炬潻娑樺弳娑撴捇顣芥い鍨闁插秵鏌婇幘顓熸杹閿涘苯鑻熷В蹇涙閺佹壆顫楀顏嗗箚閹绢厽鏂?/li>
                                <li>12瀵姳绗撴潏鎴炴崳閹躲儲鏁兼稉鐑樺瘻閺冨爼妫块崐鎺戠碍鐏炴洜銇氶敍鍫熸付閺傞绗撴潏鎴濇躬閸撳稄绱?/li>
                                <li>濮ｅ繐绱舵稉鎾圭帆閺€顖涘瘮閻愮懓鍤潻娑樺弳鐠囷附鍎忔い?/li>
                                <li>娑撴捁绶拠锔藉剰妞ゅ灚鏌婃晶鐐扮瑩鏉堟垵鐨濋棃顫偓浣规閺堢喓鍙庨悧鍥モ偓浣风瑩鏉堟垶鏅犳禍瀣ㄢ偓浣圭摃閺囨彃鍨悰銊ｂ偓浣藉剹閺咁垱鏅犳禍?/li>
                                <li>娑撴捁绶亸渚€娼伴崪宀冾嚊閹懐鍙庨悧鍥у閸忋儱濮╅幀浣圭磽缁夎濮╅悽?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.28',
                    date: '2026-05-03 15:00',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>Taylor Swift娑撴捇顣芥い闈涘磳缁狙傝礋鐎瑰本鏆?2瀵姴缍嶉棅鍐差吇娑撴捁绶ù閿嬪Г婢?/li>
                            <ul>
                                <li>閺傛澘顤僥vermore閵嗕府idnights閵嗕箑he Tortured Poets Department閵嗕箑he Life of a Showgirl</li>
                                <li>妞ゅ爼鍎碩aylor Swift缁涙儳鎮曢弨閫涜礋濡剝瀚欓惇鐔风杽閹靛鍟撻幓蹇氱珶閸斻劎鏁?/li>
                                <li>娑撴捁绶崡锛勫閸旂姴鍙嗛惇鐔风杽鐏忎線娼伴崶淇扁偓浣规崳閹躲儱绱￠幒鎺斿閵嗕焦绗庨崗銉ユ嫲閹剙浠犳潻鍥ㄦ诞</li>
                                <li>閺傛澘顤冮崗顒€绱戦悳鏉挎簚閻撗呭閸栧搫鐓欓敍灞筋杻瀵桨绗撴０姗€銆夌憴鍡氼潕鐏炲倹顐?/li>
                            </ul>
                            <li>閺囧瓨鏌婇垾婊勫灉閻ㄥ嫧鈧繈銆夐棃銏㈠閺堫剙褰挎稉绨?.0.28</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.27',
                    date: '2026-05-03 14:00',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>AI閼卞﹤銇夐崗銊╂桨閺囨寧宕叉稉绡ylor Swift娑撴捇顣介悽璇茬矕</li>
                            <ul>
                                <li>缁夊娅嶥eepSeek AI閼卞﹤銇夐崣澶綪I鐎靛棝鎸?/li>
                                <li>閺傛澘顤僒aylor Swift缁涙儳鎮昐VG閺嶅洭顣?/li>
                                <li>8瀵姳绗撴潏鎴濆幢閻楀洨鏁惧濠忕礄Debut閼风牤olklore閿?/li>
                                <li>濮ｅ繐绱堕崡锛勫濞撴劕鍙嗛崝銊ф暰+閹剙浠犻弨鎯с亣閺佸牊鐏?/li>
                                <li>娑撴捁绶稉鎾崇潣濞撴劕褰夐懝?SVG鐟佸懘銈伴崶鐐垼</li>
                            </ul>
                            <li>閸忋劑娼版禒锝囩垳鐎孤ゎ吀娣囶喖顦?妞ょug</li>
                            <li>娣囶喖顦查懕濠傘亯鏉堟挸鍙嗗鍡楁躬iOS娑撳﹣缍呯純顔肩磽鐢?/li>
                            <li>缁夊娅庨幍鈧張鍫縄閻╃鍙ф禒锝囩垳</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦睵C濞村繗顫嶉崳銊﹀ⅵ瀵偓缁岃櫣娅фい鐢告６妫?/li>
                            <li>娣囶喖顦瞚OS閻忛潧濮╁畝?閸掓ɑ鎹ｇ仦蹇撳隘閸╃喕顫嬬憴澶愨偓鍌炲帳</li>
                            <li>娣囶喖顦茬櫥褰曢弮鍫曟？娑撳秵娲块弬浼存６妫?/li>
                            <li>娣囶喖顦叉敞鍐岄弮鍫曟？/鐧诲綍閺冨爼妫块弰鍓с仛娑?-"閻ㄥ嫰妫舵０?/li>
                            <li>iOS Safari濞村繗顫嶉崳銊ョ暚閺佹挳鈧倿鍘?/li>
                            <li>娣囶喖顦叉惔鏇㈠劥鐎佃壈鍩呴弽?闁氨鐓?Toast閸︹暐OS閸掓ɑ鎹ｇ仦蹇庣瑓娴ｅ秶鐤嗗鍌氱埗</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>缂佺喍绔撮崗顒€鎲￠崚妤勩€?鐠囷附鍎?閺囧瓨鏌婇弮銉ョ箶閻ㄥ嫭鐗卞蹇撱亣鐏忓骏绱欑€涙ぞ缍?闂傜绐涢柈鐣岀埠娑撯偓鐠虹喐娲块弬鐗堟）韫囨ぞ绔撮懛杈剧礆</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>瑜拌绨虫穱顔碱槻澶村儚閺屻儴顕楅敍姘閺堝銇旈崓蹇旂叀鐠囥垹宸遍崚璺哄 actor_key=__avatar__閿涘苯浜ゆ惔鏇熷笓闂勩倖妫弫鐗堝祦楠炲弶澹?/li>
                            <li>娣囶喖顦查幍瀣簚鎼存洟鍎寸€佃壈鍩呭鈧稉濠囶棟閿涘潷osition:fixed+闁倿鍘ょ€瑰鍙忛崠鍝勭厵閿?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦查崗顒€鎲￠崣鎴濈婢惰精瑙ug閿涘牅绗夐悽鈺癷tle閸掓绱滼SON鐎涙ontent閿?/li>
                            <li>娣囶喖顦查悙鐟板毊澶村儚/娑擃亙姹夌挧鍕灐閺勫墽銇氶弮褍銇旈崓蹇ョ礄maybeSingle閳姡imit(1)+娑撳﹣绱堕崗鍫濆灩閸氬孩褰冮敍灞炬建缂佹繈鍣告径宥堫唶瑜版洩绱?/li>
                            <li>娣囶喖顦查懕濠傘亯閸掓銆冮崝鐘烘祰閹鳖澁绱檒imit 1000閳?00閿涘瞼绱︾€?0缁夋巻鍟?20缁夋帪绱?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦查崗鏈电铂閻劍鍩涢惇瀣╃瑝閸掔増娓堕弬鏉裤仈閸嶅骏绱檒oadAvatarsForUsers閹烘帒绨崣鏍ㄦ付閺傚府绱?/li>
                            <li>娣囶喖顦叉惔鏇㈠劥鐎佃壈鍩呴弽蹇撳讲鐞氼偅绮﹂崝銊╂６妫版﹫绱檛ouch-action缁備焦顒涢幍瀣◢閿?/li>
                            <li>瑜拌绨抽崢缁樺竴妞ょ敻娼伴崣鍏呮櫠缁旀牗绮﹂崝銊︽蒋閿涘潝tml/body overflow:hidden閿?/li>
                            <li>娣囶喖顦茬櫥褰曢弮鍫曟？娑撳秵娲块弬鐧皍g閿涘牊鐦″▎鈩冨ⅵ瀵偓妞ょ敻娼伴崚閿嬫煀鐧诲綍閺冨爼妫块敍?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦插ご鍍忔潻鍥︾娴兼艾鍔归懛顏勫З閸ョ偤鈧偓bug閿涘潤ocalStorage閺夊啫鈻夋导妯哄帥閿涘瓕B娑撳秴鍟€鐟曞棛娲婇敍?/li>
                            <li>閸樼粯甯€鐠囧嫯顔戝ご鍍忛敍灞藉涧閺勫墽銇氶崥宥呯摟</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦查懕濠傘亯閸掓銆冮幍鎾崇磻缁岃櫣娅?閸旂姾娴囬幈銏ゆ６妫?/li>
                            <li>閼卞﹤銇夐崚妤勩€冮崥搴″酱妫板嫬濮炴潪鏂ょ礉閻愮懓绱戠粔鎺戝毉</li>
                            <li>瑜拌绨抽崢缁樺竴鐢牕鐡欓崚妤勩€冮崣鍏呮櫠缁旀牗绮﹂崝銊︽蒋</li>
                            <li>娣囶喖顦茬敮鏍х摍濠婃垵濮╅崡锟犮€?閹惰姤鎮欓幎鏍уЗ閿涘牅绮庡ǎ鈥冲弳娑撯偓濞?閸ュ墽澧栭崝鐘烘祰娴兼ê瀵查敍?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.19',
                    date: '2026-05-03 09:10',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦查崚閿嬫煀缂冩垿銆夐崥搴°仈閸嶅繐娲栭柅鈧琤ug</li>
                            <li>澶村儚閻撗呭閸樺缂夋潻娑楃濮濄儱鍣虹亸蹇ョ礄80x80 @0.4閿?/li>
                            <li>娣囶喖顦查弴瀛樺床澶村儚閸氬簼绗夐弴瀛樻煀閻ㄥ垺ug</li>
                            <li>鐢牕鐡欓崚鎺戝弳閸掓帒鍤崝銊ф暰闁插秷顔曠拋鈽呯窗濞ｂ€冲弳+娑撳﹦些閵嗕焦璐伴崙?娑撳些</li>
                            <li>閸樼粯甯€鐢牕鐡欓崪宀冪槑鐠佽櫣娈慼over閹剚璇為弫鍫熺亯</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.18',
                    date: '2026-05-03 08:30',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娣囶喖顦查弴瀛樺床澶村儚閸氬簼绗夐弴瀛樻煀閻ㄥ垺ug閿涘牆浜ゆ惔鏇氭叏婢跺稄绱?/li>
                            <li>閸樼粯甯€鎼存洟鍎寸€佃壈鍩呴弽蹇曞仯閸戠粯妞傞惃鍕拨閼瑰弶顢嬮敍鍫濅氦鎼存洑鎱ㄦ径宥忕礆</li>
                            <li>鐢牕鐡欓崝鐘烘祰閸斻劎鏁炬禒搴㈢拨閸忋儲鏁奸幋鎰窗閸?/li>
                            <li>娣囶喖顦叉敞鍐岄弮鍫曟？娑撳海娅ヨぐ鏇熸闂傚娴夐崥宀€娈慴ug閿涘牆浜ゆ惔鏇氭叏婢跺稄绱?/li>
                            <li>澶村儚娑撳﹣绱堕崢瀣級娴兼ê瀵查敍?28x128閿?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.17',
                    date: '2026-05-02 17:00',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>閸斻劎鏁鹃弫鍫熺亯閸戝繐宕愭导妯哄</li>
                            <ul>
                                <li>鐢牕鐡欏鎴濆弳閸斻劎鏁鹃柅鐔峰閸戝繐宕愰敍瀹紃anslateY鐠烘繄顬囬崙蹇撳磹</li>
                                <li>閹碘偓閺堝瀵滈柦鐢磑ver閸斻劎鏁鹃獮鍛閸戝繐宕愰敍鍫濈俺闁劌顕遍懜顏呯埉闂勩倕顦婚敍?/li>
                                <li>閸栧懏瀚環over娑撳﹥璇為妴浣虹級閺€淇扁偓浣规鏉烆剛鐡戦崝銊ф暰閸у洤鍣洪崡?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.16',
                    date: '2026-05-02 16:53',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>澶村儚閻愮懓鍤悰灞艰礋娴兼ê瀵?/li>
                            <ul>
                                <li>閻愮懓鍤敮鏍х摍閸滃矁鐦庣拋杞拌厬閻ㄥ嫬銇旈崓蹇庣瑝閸愬秶娲块幒銉ㄧ儲鏉烆剝浜版径?/li>
                                <li>閺傛澘顤冮悽銊﹀煕鐠у嫭鏋￠崡锛勫瀵湱鐛ラ敍灞炬▔缁€鍝勩仈閸嶅繈鈧胶鏁ら幋宄版倳閵嗕焦娓舵潻鎴犳瑜版洘妞傞梻?/li>
                                <li>鐠у嫭鏋￠崡锛勫娑擃厾鍋ｉ崙?閸欐垶绉烽幁?閹稿鎸抽幍宥堢儲鏉烆剙鍩岄懕濠傘亯鐎电鐦?/li>
                            </ul>
                            <li>缂佺喕顓搁悧鍫濇健閸旂姾娴囬柅鐔峰娴兼ê瀵?/li>
                            <ul>
                                <li>缂佺喕顓搁弫鐗堝祦婢х偛濮?0缁夋帒鍞寸€涙绱︾€涙﹫绱濇禍灞绢偧閹垫挸绱戠粔鎺戝毉</li>
                                <li>閸氬骸褰存０鍕鏉炵晫绮虹拋鈩冩殶閹诡噯绱濇＃鏍偧閹垫挸绱戞稊鐔告纯韫?/li>
                            </ul>
                            <li>閼卞﹤銇夐崝鐔诲厴澶村儚閺勫墽銇?/li>
                            <ul>
                                <li>閻劍鍩涢懕濠傘亯濞戝牊浼呮晶鐐插閸欏本鏌熷ご鍍忛弰鍓с仛</li>
                                <li>閼卞﹤銇夐崚妤勩€冮弰鍓с仛閼辨梻閮存禍铏规埂鐎圭偛銇旈崓?/li>
                                <li>AI鐎电鐦芥稉顓熸▔缁€铏规暏閹撮婀＄€圭偛銇旈崓?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.15',
                    date: '2026-05-02 16:30',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>澶村儚娑撳﹣绱堕崢瀣級娴兼ê瀵?/li>
                            <ul>
                                <li>澶村儚娑撳﹣绱堕崜宥堝殰閸斻劌甯囩紓鈺勫殾256x256閿涘瓰PEG鐠愩劑鍣?.7</li>
                                <li>婢堆冪畽閸戝繐鐨痓ase64娴ｆ挾袧閿涘矂妲诲銏犵摠閸屻劍瀛╅崙鍝勬嫲閸旂姾娴囨径杈Е</li>
                                <li>娑撳﹣绱舵径褍鐨梽鎰煑閺€鎯ь啍閼?0MB</li>
                            </ul>
                            <li>閻劍鍩涙敞鍐?鐧诲綍閺冨爼妫胯ぐ璇茬俺娣囶喖顦?/li>
                            <ul>
                                <li>闁插秵鐎悽銊﹀煕娣団剝浼呯€涙ê褰囨稉铏圭埠娑撯偓saveUserInfo閸戣姤鏆?/li>
                                <li>update婢惰精瑙﹂弮鎯板殰閸斺暍allback閸掔櫜elete+insert</li>
                                <li>缁狅紕鎮婇崨妯兼瑜版洖鎮撻弽閿嬵劀绾喛顔囪ぐ鏇犳瑜版洘妞傞梻?/li>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>澶村儚娑撳﹣绱剁€佃壈鍤ч惃鍕箾闁夸線妫舵０妯规叏婢?/li>
                            <ul>
                                <li>娣囶喖顦叉稉濠佺炊澶村儚閸氬骸绗樼€涙劙銆夋稉鈧惄瀛樻▔缁€?閸旂姾娴囨径杈Е閿涘苯鍩涢弬浼村櫢鐠?閻ㄥ嫪寮楅柌宄泆g</li>
                                <li>娣囶喖顦插ご鍍廱ase64閺佺増宓侀幘鎴犲瀻localStorage鐎佃壈鍤фい鐢告桨瀹曗晜绨?/li>
                                <li>娣囶喖顦?閹存垹娈戞い鐢告桨"澶村儚娑撳秵妯夌粈铏规畱闂傤噣顣?/li>
                                <li>娣囶喖顦查柅鈧崙铏规瑜版洖鎮楅弮褏绱︾€涙ê鍏遍幍鎵畱闂傤噣顣?/li>
                                <li>娴兼ê瀵查弫鐗堝祦閺屻儴顕楅敍灞惧笓闂勩倕銇旈崓蹇氼唶瑜版洖鍣虹亸鎴濇惙鎼存柧缍嬬粔?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.13',
                    date: '2026-05-02 14:58',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>澶村儚閸旂喕鍏樻穱顔碱槻</li>
                            <ul>
                                <li>娣囶喖顦插ご鍍忔稉濠佺炊閸氬簼缍旀稉鍝勭瑯鐎涙劖妯夌粈铏规畱闂傤噣顣?/li>
                                <li>娣囶喖顦查崚閿嬫煀妞ょ敻娼伴崥搴°仈閸嶅繑绉锋径杈╂畱闂傤噣顣?/li>
                                <li>澶村儚娑撳﹣绱堕幋鎰閸氬氦鍤滈崝銊ュ煕閺傜櫞eed閺勫墽銇氶弬鏉裤仈閸?/li>
                                <li>閺囧瓨鏌婂ご鍍忕紓鎾崇摠閺堝搫鍩楅敍宀€鈥樻穱婵嗐仈閸嶅繑顒滅涵顔芥▔缁€?/li>
                            </ul>
                            <li>閹嗗厴娴兼ê瀵?/li>
                            <ul>
                                <li>娴兼ê瀵茬敮鏍х摍濞撳弶鐓嬮幀褑鍏橀敍宀勵暕閺嬪嫬缂撶拠鍕啈閸滃瞼鍋ｇ挧鐐存Ё鐏忓嫯銆?/li>
                                <li>閹绘劕宕岄弫缈犵秼濞翠胶鏅犳惔锔肩礉閸戝繐鐨崡锟犮€?/li>
                            </ul>
                            <li>閸忣剙鎲＄化鑽ょ埠娴兼ê瀵?/li>
                            <ul>
                                <li>娣囶喖顦查崗顒€鎲￠崣鎴濈閸栧搫鐓欓崶鍝勭暰娑撳秴濮╅惃鍕６妫版﹫绱濋悳鏉挎躬娴兼岸娈㈤崘鍛啇濠婃艾濮?/li>
                            </ul>
                            <li>閸氬骸褰寸粻锛勬倞娴兼ê瀵?/li>
                            <ul>
                                <li>娣囶喖顦查悽銊﹀煕娉ㄥ唽閸滃瞼娅ヨぐ鏇熸闂傜繝绻氱€涙﹢妫舵０姗堢礉濞ｈ濮瀉ctor_key绾喕绻氶弫鐗堝祦濮濓絿鈥橀崘娆忓弳</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.12',
                    date: '2026-05-02 01:00',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>閺傛澘顤冨☉鍫熶紖闁氨鐓￠崝鐔诲厴</li>
                            <ul>
                                <li>閺€璺哄煂閺傜増绉烽幁顖涙妞ゅ爼鍎村鐟板毉濞戝弶鈧胶骞撻悹鍐棑閺嶅ジ鈧氨鐓?/li>
                                <li>閺勫墽銇氶崣鎴︹偓浣解偓鍛仈閸嶅繈鈧胶鏁ら幋宄版倳閸滃本绉烽幁顖氬敶鐎?/li>
                                <li>闁氨鐓?缁夋帒鎮楅懛顏勫З濞ｂ€冲毉閺€璺烘礀</li>
                                <li>閻愮懓鍤柅姘辩叀閻╁瓨甯寸捄瀹犳祮閸掓澘顕惔鏃囦喊婢垛晛顕拠?/li>
                                <li>閺呴缚鍏橀崚銈嗘焽閿涙艾鍑￠崷銊ㄤ喊婢垛晜妞傛稉宥夊櫢婢跺秴鑴婇崙?/li>
                            </ul>
                            <li>閸氬骸褰寸粻锛勬倞閸旂喕鍏樻穱顔碱槻</li>
                            <ul>
                                <li>娣囶喖顦查弬鐗堟暈閸愬瞼鏁ら幋鍑ょ礄閺冪姴褰傜敮鏍唶瑜版洩绱氭稉宥嗘▔缁€铏规畱闂傤噣顣?/li>
                                <li>绾喕绻氶幍鈧張澶嬫暈閸愬瞼鏁ら幋鐑藉厴閼宠棄婀崥搴″酱濮濓絿鈥樼仦鏇犮仛</li>
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
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娑擃亙姹夌挧鍕灐缁崵绮洪崗銊╂桨閸楀洨楠?/li>
                            <ul>
                                <li>閺傛澘顤冩稉顏冩眽鐠у嫭鏋＄拠锔藉剰妞ょ绱欐径褍銇旈崓蹇嬧偓浣烘暏閹村嘲鎮曢妴浣烘暏閹寸īD閵嗕焦鏁為崘灞炬闂傝揪绱?/li>
                                <li>閺€顖涘瘮閼奉亜鐣炬稊澶娿仈閸嶅繋绗傛导鐙呯礄閺堚偓婢?MB閿?/li>
                                <li>鐢牕鐡欓崪宀冪槑鐠佸搫灏崺鐔告▔缁€铏规暏閹寸柉鍤滅€规矮绠熷ご鍍?/li>
                                <li>娑擃亙姹夌挧鍕灐妞ゅ灚鏌婃晶鐐衡偓鈧崙铏规瑜版洘瀵滈柦?/li>
                            </ul>
                            <li>濞撶顓瑰Ο鈥崇础鐎瑰苯鏉?/li>
                            <ul>
                                <li>閺堫亞娅ヨぐ鏇犳暏閹村嘲褰ч懗鑺ョ叀閻绱濇稉宥堝厴閸欐垵绔?閻愮绂?鐠囧嫯顔?/li>
                                <li>閺堫亞娅ヨぐ鏇熸閸欐垵绔烽崠鍝勭厵閼奉亜濮╅梾鎰</li>
                                <li>閻愮懓鍤幙宥勭稊閺冩儼鍤滈崝銊﹀絹缁€铏规瑜?/li>
                            </ul>
                            <li>閸忣剙鎲＄化鑽ょ埠娣囶喖顦?/li>
                            <ul>
                                <li>娣囶喖顦查崗顒€鎲＄拠锔藉剰妞ょ敻娼伴崘鍛啇娑撳秵妯夌粈铏规畱闂傤噣顣?/li>
                            </ul>
                            <li>閸氬骸褰寸粻锛勬倞閸旂喕鍏樻晶鐐插繁</li>
                            <ul>
                                <li>閺傛澘顤冮悽銊﹀煕娉ㄥ唽閺冨爼妫块崪灞炬付鏉╂垹娅ヨぐ鏇熸闂傚瓨妯夌粈?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.10',
                    date: '2026-05-02',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>閺傛澘顤冮妴灞惧灉閻ㄥ嫨鈧秹銆夐棃?/li>
                            <ul>
                                <li>濞ｈ精澹?濞村懓澹婂Ο鈥崇础閸掑洦宕插鈧崗?/li>
                                <li>鐠囶叀鈻堥崚鍥ㄥ床閸旂喕鍏?/li>
                                <li>闁氨鐓＄拋鍓х枂闁銆?/li>
                                <li>閸忓厖绨惔鏃傛暏娣団剝浼?/li>
                                <li>缂佺喍绔撮惂鍊熷绾俱劎鐖炴搴㈢壐鐠佹崘顓?/li>
                            </ul>
                            <li>閵嗗本鍨滈惃鍕┾偓宥嗗瘻闁筋喖濮╅悽璁崇喘閸?/li>
                            <ul>
                                <li>閻愮懓鍤幐澶愭尦閺冭埖妯夌粈?閺夆€冲兊閼规彃鍘滃▔顫矤鐏忓繋姹夐懘鎴ｎ暟娑撳﹥鏌熼弫锝呯殸閻ㄥ嫬濮╅悽?/li>
                            </ul>
                            <li>鎼存洟鍎寸€佃壈鍩呴弽蹇旀殻娴ｆ挷绱崠?/li>
                            <ul>
                                <li>AI閼鸿鲸婀归幐澶愭尦閻愮懓鍤懠鍐ㄦ纯鐎靛綊缍?/li>
                                <li>閸ユ稒瀵滈柦顔笺亣鐏忓繒绮烘稉鈧憴鍕瘱</li>
                                <li>鐟欏棜顫庨獮瀹犮€€鎼达附褰侀崡?/li>
                            </ul>
                            <li>AI妞ょ敻娼伴崝銊ф暰閸楀洨楠?/li>
                            <ul>
                                <li>閼鸿鲸婀归崝銊ф暰閺€閫涜礋闁劗鎽氭鐐存殠閺佸牊鐏夐敍鍫滅瑢鐎佃壈鍩呴弽蹇斿瘻闁筋喕绻氶幐浣风閼疯揪绱?/li>
                                <li>闂傤亞鏁搁崚鍥ㄥ床閹稿鎸抽弨閫涜礋SVG閸ョ偓鐖ｉ敍宀冾潒鐟欏娲跨划鎹愬毀</li>
                                <li>閸斻劎鏁炬潻鍥ㄦ诞閺囧瓨绁﹂悾鍛板殰閻?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.9',
                    date: '2026-05-02',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>閸忣剙鎲＄化鑽ょ埠閸旂喕鍏樻晶鐐插繁</li>
                            <ul>
                                <li>缁狅紕鎮婇崨妯哄絺鐢啫鍙曢崨濠冩閸欘垶鈧瀚ㄦ潏鎾冲弳閺嶅洭顣介崪灞藉敶鐎圭櫢绱欐稉宥呭繁閸掕绱濋懛鍐茬毌婵夘偄鍟撴稉鈧い鐧哥礆</li>
                                <li>閻劍鍩涢弻銉ф箙閸忣剙鎲￠崚妤勩€冮弮璺虹潔缁€鍝勫彆閸涘﹥鐖ｆ０?/li>
                                <li>閸忣剙鎲＄拠锔藉剰妞ゅ灚鏌婃晶鐐插絺鐢啳鈧懍淇婇幁顖氱潔缁€鐚寸礄澶村儚 + 閻劍鍩涢崥宥忕礆</li>
                                <li>缁狅紕鎮婇崥搴″酱閸忣剙鎲￠崚妤勩€冮弬鏉款杻閺嶅洭顣介妴浣稿絺鐢啳鈧懎鍨弰鍓с仛</li>
                                <li>缁狅紕鎮婇崥搴″酱閺傛澘顤冮弽鍥暯鏉堟挸鍙嗗?/li>
                                <li>闁倿鍘ゅǎ杈/濞村懓澹婃稉濠氼暯</li>
                                <li>娣囨繃瀵旈崢鐔告箒閻у€熷绾俱劎鐖炴搴㈢壐缂佺喍绔?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.8',
                    date: '2026-05-02',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>閸忣剙鎲＄化鑽ょ埠鐟欏棜顫庢稉搴濇唉娴滄帊绱崠?/li>
                            <ul>
                                <li>閸忣剙鎲″Ο鈩冣偓浣诡攱閺€閫涜礋娑撳孩鈧濮╅幀浣光偓缁樼セ鐟欏牆鐣崗銊ょ閼峰娈戦惂鍊熷绾俱劎鐖炴搴㈢壐</li>
                                <li>閸忣剙鎲￠崚妤勩€冩い瑙勭壉瀵繒绮烘稉鈧稉铏规閼硅尙锛堥惍鍌涙櫏閺?/li>
                                <li>鐎瑰苯鍙忕粔濠氭珟閸忣剙鎲￠崘鍛啇閸栧搫鐓欓惃鍕泊閸斻劍娼?/li>
                                <li>缁備焦顒涢崗顒€鎲￠崠鍝勭厵濡亜鎮滈幏鏍ㄥ濠婃艾濮?/li>
                                <li>閸忣剙鎲＄拠锔藉剰婢舵挳鍎存导妯哄鐢啫鐪敍灞兼叏婢跺秴鍨归梽銈嗗瘻闁筋喕缍呯純?/li>
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
                                <li>閸忣剙鎲＄化鑽ょ埠濞ｈ精澹婂Ο鈥崇础鐎瑰苯鍙忕€靛綊缍堥幀璇插З閹線顥撻弽?/li>
                                <li>閹碘偓閺堝鍘撶槐鐘虫暜閹镐椒瀵屾０妯垮殰閸斻劌鍨忛幑?/li>
                            </ul>
                            <li>閹嗗厴娑撳孩绁﹂悾鍛娴兼ê瀵?/li>
                            <ul>
                                <li>娴兼ê瀵查崗顒€鎲￠崚妤勩€冮崝銊ф暰閺佸牊鐏?/li>
                                <li>濞ｈ濮瀢ill-change鐏炵偞鈧勫絹閸楀洦瑕嗛弻鎾粹偓褑鍏?/li>
                                <li>娴兼ê瀵叉禍瀣╂婢跺嫮鎮婇柅鏄忕帆</li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.7',
                    date: '2026-05-02',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>閺傛澘顤冮崗顒€鎲￠柅姘辩叀缁崵绮?/li>
                            <ul>
                                <li>閸忣剙鎲￠柧鍐憦閹稿鎸抽敍鍫㈡瑜版洖鎮楅崣顖濐潌閿?/li>
                                <li>閺堫亣顕伴崗顒€鎲＄拋鈩冩殶閹绘劗銇?/li>
                                <li>閸忣剙鎲＄拠锔藉剰閺屻儳婀呮稉搴″灙鐞涖劏绻戦崶鐐插閼?/li>
                                <li>閸忣剙鎲￠崣鎴濈娑撳骸鍨归梽銈囶吀閻炲棙娼堥梽?/li>
                            </ul>
                            <li>閺傛澘顤冮悪顒傜彌缁狅紕鎮婇崥搴″酱妞ょ敻娼?/li>
                            <ul>
                                <li>婢舵氨娣惔锔芥殶閹诡喚顓搁悶鍡涙桨閺?/li>
                                <li>閸忣剙鎲￠崣鎴濈缁狅紕鎮?/li>
                                <li>閻劍鍩涢崣濠傚敶鐎硅鏆熼幑顔界叀閻?/li>
                                <li>閸濆秴绨插蹇氼啎鐠侊繝鈧倿鍘?/li>
                            </ul>
                            <li>閸忣剙鎲￠弫鐗堝祦娑撳簼瀵屾惔鏃傛暏鐎瑰苯鍙忔禍鎺椻偓?/li>
                            <li>娴兼ê瀵叉禍銈勭鞍鏉╁洦娴崝銊ф暰閹绘劕宕屽ù浣烘櫊鎼?/li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娴兼ê瀵叉い鍫曞劥鐎佃壈鍩呴弽蹇庢唉娴?/li>
                            <ul>
                                <li>閸樺娅庨柌宥咁槻閼卞﹤銇夐崗銉ュ經</li>
                                <li>娴兼ê瀵叉惔鏇㈠劥 Dock 閺嶅繒鍋ｉ崙璇插隘閸╃噦绱濋崗浣筋啅濡楀棗顦婚崠鍝勭厵娴溿倓绨?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.5',
                    date: '2026-04-30',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
                        <ul>
                            <li>娑撳銇囬弽绋跨妇閸旂喕鍏橀幐澶愭尦SVG閸斻劎鏁炬导妯哄</li>
                            <ul>
                                <li>闁插秵鏌婄拋鎹愵吀鐢牕鐡欓幐澶愭尦闁姐垻鐟紒妯哄煑閸斻劎鏁?/li>
                                <li>闁插秵鏌婄拋鎹愵吀閼卞﹤銇夐幐澶愭尦濮樻梹鍦洪崝銊ф暰</li>
                                <li>AI閹稿鎸抽弴瀛樺床娑撻缚濮抽張鐢靛敜閺€鍙ョ瑢閼鸿京鎽氳ぐ鎺嶇秴閸斻劎鏁?/li>
                                <li>閹碘偓閺堝濮╅悽缁樻暜閹镐焦瀵滈柦顔碱樆閸栧搫鐓欓弰鍓с仛</li>
                                <li>娑撱儲鐗告担璺ㄦ暏CSS @keyframes鐎圭偟骞?/li>
                            </ul>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.4',
                    date: '2026-04-29',
                    content: `
                        <h4>閺囧瓨鏌婇崘鍛啇</h4>
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
                        <h4>閸掓繂顫愰悧鍫熸拱</h4>
                        <ul>
                            <li>閸╄櫣顢呴崝鐔诲厴濡楀棙鐏﹂幖顓炵紦</li>
                            <li>閻劍鍩涚拋銈堢槈缁崵绮?/li>
                            <li>鐢牕鐡欓崣鎴濈娑撳孩绁荤憴?/li>
                            <li>鐠囧嫯顔戞稉搴ｅ仯鐠х偛濮涢懗?/li>
                            <li>缁変椒淇婇懕濠傘亯缁崵绮?/li>
                            <li>AI鐎电鐦介崝鐔诲厴</li>
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
                            <div class="changelog-version">棣冩畬 ${item.version}</div>
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
            // 缂佹垵鐣鹃崚鍥ㄥ床娴滃娆?
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 娣囶喗鏁奸崢鐔告箒閻?showAnnouncementList 娴犮儲鏁幐浣哥秼閸撳秵鐖ｇ粵鍓уЦ閹?
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
        })();

