// console.log('[XTJ] core.js loaded, starting...');

            var XTJ_RUNTIME_CONFIG = window.XTJ_CONFIG || {
                API_BASE: window.location.origin,
                SUPABASE_URL: "https://ithowxqignlhkwaykglt.supabase.co",
                SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA"
            };
            window.XTJ_CONFIG = XTJ_RUNTIME_CONFIG;
            const SUPABASE_URL = XTJ_RUNTIME_CONFIG.SUPABASE_URL;
            const SUPABASE_ANON_KEY = XTJ_RUNTIME_CONFIG.SUPABASE_ANON_KEY;
            var API_BASE = XTJ_RUNTIME_CONFIG.API_BASE;
            var sb;
            // ★ 修复 M6：检查配置完整性，避免静默失败
            if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
                console.error('[XTJ] Supabase 配置缺失，请检查 config.js 或环境变量');
                sb = null;
            } else if (typeof window.supabase !== 'undefined') {
                sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            } else {
                console.error('Supabase SDK not loaded');
                document.addEventListener('DOMContentLoaded', function() {
                    var feedEl = document.getElementById('feed');
                    if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">服务加载失败，请刷新页面重试</div>';
                });
            }
            window.sb = sb;


(function() {
    if (window.XTJSecondaryPageState && window.restoreMainNavigationState) return;

    function isVisiblePanel(id, activeClass) {
        var panel = document.getElementById(id);
        if (!panel) return false;
        if (panel.hidden || panel.classList.contains('hidden')) return false;
        if (panel.getAttribute('aria-hidden') === 'true') return false;
        if (activeClass && !panel.classList.contains(activeClass)) return false;
        return true;
    }

    function hasVisibleSecondaryPage() {
        return isVisiblePanel('panelEnglishLearning', 'el-show') || isVisiblePanel('panelDeepThink', 'active');
    }

    function clearStaleDockDisplay() {
        var dockBar = document.getElementById('dockBar') || document.querySelector('.dock-bar');
        if (dockBar && dockBar.style && dockBar.style.display === 'none') {
            dockBar.style.display = '';
        }
    }

    function applySecondaryPageState(locked) {
        try {
            document.body.classList.toggle('secondary-page-open', !!locked);
            document.body.classList.toggle('english-learning-open', isVisiblePanel('panelEnglishLearning', 'el-show'));
            if (locked) {
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';
                document.body.style.touchAction = 'none';
            } else {
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
                document.body.style.touchAction = '';
                document.body.classList.remove('secondary-page-open');
                document.body.classList.remove('english-learning-open');
                clearStaleDockDisplay();
            }
        } catch (e) {}
    }

    var openPanels = new Set();

    function reconcile() {
        if (hasVisibleSecondaryPage()) {
            if (isVisiblePanel('panelEnglishLearning', 'el-show')) openPanels.add('english-learning');
            else openPanels.delete('english-learning');
            if (isVisiblePanel('panelDeepThink', 'active')) openPanels.add('deep-think');
            else openPanels.delete('deep-think');
            applySecondaryPageState(true);
            return true;
        }
        openPanels.clear();
        applySecondaryPageState(false);
        return false;
    }

    window.XTJSecondaryPageState = {
        open: function(panelName) {
            if (panelName) openPanels.add(String(panelName));
            reconcile();
        },
        close: function(panelName) {
            if (panelName) openPanels.delete(String(panelName));
            reconcile();
        },
        reset: function() {
            reconcile();
        },
        hasVisibleSecondaryPage: hasVisibleSecondaryPage
    };

    window.restoreMainNavigationState = function() {
        return reconcile();
    };

    function scheduleRestore() {
        setTimeout(function() {
            try { window.restoreMainNavigationState(); } catch (e) {}
        }, 0);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleRestore);
    else scheduleRestore();
    window.addEventListener('pageshow', scheduleRestore);
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') scheduleRestore();
    });
    window.addEventListener('error', function() {
        setTimeout(function() {
            try { window.restoreMainNavigationState(); } catch (e) {}
        }, 80);
    });
})();

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
window.safeLocalStorageGet = function(key, fallback) {
    try {
        var v = localStorage.getItem(key);
        return v !== null ? v : fallback;
    } catch(e) {
        return fallback;
    }
};
window.safeLocalStorageSet = function(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch(e) {}
};

function xtjLoadingEscapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function buildXtjLoadingHtmlFallback(title, subtitle, type) {
    var safeTitle = xtjLoadingEscapeHtml(title || '加载中..');
    var safeSubtitle = subtitle ? xtjLoadingEscapeHtml(subtitle) : '';
    return '<div class="xtj-magic-loading loading" style="display:flex;align-items:center;justify-content:center;min-height:160px;padding:24px;text-align:center;color:var(--text-muted);">'
        + '<div><div style="font-size:28px;line-height:1;margin-bottom:10px;">!</div>'
        + '<div>' + safeTitle + '</div>'
        + (safeSubtitle ? '<div style="font-size:12px;margin-top:6px;opacity:.7;">' + safeSubtitle + '</div>' : '')
        + '</div></div>';
}
function getXtjLoadingHtml(title, subtitle, type) {
    var loader = window.xtjMagicLoadingHtml;
    if (typeof loader === 'function' && loader !== window.__xtjFallbackLoadingHtml) {
        try {
            return loader(title, subtitle, type);
        } catch (_) {}
    }
    return buildXtjLoadingHtmlFallback(title, subtitle, type);
}
window.buildXtjLoadingHtmlFallback = buildXtjLoadingHtmlFallback;
window.getXtjLoadingHtml = getXtjLoadingHtml;
if (typeof window.xtjMagicLoadingHtml !== 'function') {
    window.__xtjFallbackLoadingHtml = function(title, subtitle, type) {
        return buildXtjLoadingHtmlFallback(title, subtitle, type);
    };
    window.xtjMagicLoadingHtml = window.__xtjFallbackLoadingHtml;
}

const ADMIN_NAME = "xxz";
            const ADMIN_TOKEN_KEY = "xtj_admin_token";
            const AVATAR_CACHE_KEY = "xtj_avatars";
            const USER_SESSION_KEY = "xtj_user_session";
            const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
            const USER_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
            var USER_TOKEN_KEY = 'xtj_user_token';
            var USER_TOKEN_TS_KEY = 'xtj_user_token_ts';

            function getUserToken() {
                var token = sessionStorage.getItem(USER_TOKEN_KEY) || localStorage.getItem(USER_TOKEN_KEY);
                // 校验 localStorage token 是否过期（30天）
                if (token && localStorage.getItem(USER_TOKEN_KEY)) {
                    var ts = parseInt(localStorage.getItem(USER_TOKEN_TS_KEY), 10);
                    if (ts && (Date.now() - ts > 30 * 24 * 60 * 60 * 1000)) {
                        localStorage.removeItem(USER_TOKEN_KEY);
                        localStorage.removeItem(USER_TOKEN_TS_KEY);
                        token = null;
                    }
                }
                return token || '';
            }

            function setUserToken(token) {
                if (token) {
                    sessionStorage.setItem(USER_TOKEN_KEY, token);
                    localStorage.setItem(USER_TOKEN_KEY, token);
                    localStorage.setItem(USER_TOKEN_TS_KEY, Date.now());
                }
            }

            function clearUserToken() {
                try { sessionStorage.removeItem(USER_TOKEN_KEY); } catch(e) {}
                try { localStorage.removeItem(USER_TOKEN_KEY); } catch(e) {}
                try { localStorage.removeItem(USER_TOKEN_TS_KEY); } catch(e) {}
            }

            async function ensureUserToken() {
                var existingToken = getUserToken();
                if (existingToken) return existingToken;
                if (!currentUser || !API_BASE) return '';
                var pwHash = '';
                try {
pwHash = sessionStorage.getItem('xtj_pw_hash') || '';
                } catch (e) {
                    pwHash = '';
                }
                if (!pwHash) return '';
                try {
                    var tokenRes = await fetch(API_BASE + '/api/user/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_name: currentUser, password_hash: pwHash })
                    });
                    var tokenData = await tokenRes.json().catch(function() { return {}; });
                    if (tokenRes.ok && tokenData && tokenData.token) {
                        setUserToken(tokenData.token);
                        return tokenData.token;
                    }
                    if (tokenRes.status === 401 || tokenRes.status === 403) {
                        clearUserToken();
                    }
                } catch (e) {}
                return '';
            }

            /**
             * 返回统一认证请求头对象。
             * 优先使用 JWT Bearer token；无 token 且无 password_hash 时返回 null。
             * 有 token → 返回 { Authorization, Content-Type }
             * 无 token 但有 currentUser + password_hash → 返回 null（调用方应传参兼容旧逻辑）
             */
            window.getUserAuthHeaders = async function() {
                var token = await ensureUserToken();
                if (token) {
                    return {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    };
                }
                return null;
            }
            window.getUserToken = getUserToken;
            window.ensureUserToken = ensureUserToken;
            window.clearUserToken = clearUserToken;

            /**
             * 强制刷新 token。
             *  - force=false（默认）：和 ensureUserToken 一样，有旧 token 就直接返回
             *  - force=true：忽略旧 token，主动用 currentUser + xtj_pw_hash 调 /api/user/login 换新 token
             * 用途：AI 401/403 后由 ai-agent.js 调用，避开"旧 token 永远优先"的死循环
             */
            window.refreshUserToken = async function(force) {
                try {
                    if (!force) {
                        var existing = getUserToken();
                        if (existing) return existing;
                    }
                    var userName = '';
                    try { userName = (typeof currentUser === 'string' ? currentUser : (currentUser && currentUser.user_name) || '') || ''; } catch (e) { userName = ''; }
                    if (!userName) {
                        try { userName = localStorage.getItem('xtj_user') || sessionStorage.getItem('xtj_user') || ''; } catch (e) {}
                    }
                    var pwHash = '';
                    try { pwHash = sessionStorage.getItem('xtj_pw_hash') || ''; } catch (e) { pwHash = ''; }
                    if (!userName || !pwHash) return '';
                    clearUserToken();
                    var tokenRes = await fetch(API_BASE + '/api/user/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_name: userName, password_hash: pwHash })
                    });
                    var tokenData = await tokenRes.json().catch(function() { return {}; });
                    if (tokenRes.ok && tokenData && tokenData.token) {
                        setUserToken(tokenData.token);
                        return tokenData.token;
                    }
                    if (tokenRes.status === 401 || tokenRes.status === 403) {
                        clearUserToken();
                    }
                } catch (e) {}
                return '';
            };

            /**
             * ★ 新增：统一鉴权状态检查（AI 模块用）
             *  - 仅当 currentUser + 真实 token 都存在时，返回 ok=true
             *  - 没 token 但有 pw_hash 时，主动用 refreshUserToken(true) 换新
             *  - 都没了返回 ok=false（调用方应提示重新登录）
             * 返回 { ok, reason, token, user_name }
             *   - reason: 'ok' | 'no_user' | 'missing_auth_credentials' | 'refresh_failed'
             */
            window.ensureRealUserAuth = async function() {
                try {
                    var userName = '';
                    try {
                        if (typeof currentUser === 'string') userName = currentUser;
                        else if (currentUser && currentUser.user_name) userName = currentUser.user_name;
                    } catch (e) { userName = ''; }
                    if (!userName) {
                        try { userName = localStorage.getItem('xtj_user') || ''; } catch (e) {}
                    }
                    userName = String(userName || '').trim();
                    if (!userName) return { ok: false, reason: 'no_user', token: '', user_name: '' };

                    var token = '';
                    try { token = sessionStorage.getItem('xtj_user_token') || localStorage.getItem('xtj_user_token') || ''; } catch (e) { token = ''; }
                    if (token) return { ok: true, reason: 'ok', token: token, user_name: userName };

                    // 没 token，看是否有 password_hash
                    var pwHash = '';
                    try { pwHash = sessionStorage.getItem('xtj_pw_hash') || ''; } catch (e) { pwHash = ''; }
                    if (pwHash && typeof window.refreshUserToken === 'function') {
                        var newToken = await window.refreshUserToken(true);
                        if (newToken) return { ok: true, reason: 'ok_refreshed', token: newToken, user_name: userName };
                    }
                    return { ok: false, reason: pwHash ? 'refresh_failed' : 'missing_auth_credentials', token: '', user_name: userName };
                } catch (e) {
                    return { ok: false, reason: 'exception', token: '', user_name: '' };
                }
            };

            let avatarCache = {};
            let lastUserSessionWriteAt = 0;

        function readUserSession() {
            try {
                var raw = localStorage.getItem(USER_SESSION_KEY);
                if (!raw) return null;
                var parsed = JSON.parse(raw);
                return parsed && typeof parsed === "object" ? parsed : null;
            } catch (e) {
                return null;
            }
        }

        function writeUserSession(userName, options) {
            var name = String(userName || "").trim();
            if (!name) return null;
            var now = Date.now();
            var existing = readUserSession();
            var resetLoginAt = !!(options && options.resetLoginAt);
            var loginAt = resetLoginAt ? now : Number(existing && existing.user_name === name ? existing.login_at : 0);
            if (!Number.isFinite(loginAt) || loginAt <= 0) loginAt = now;
            var next = {
                user_name: name,
                login_at: loginAt,
                last_active_at: now
            };
            try { localStorage.setItem(USER_SESSION_KEY, JSON.stringify(next)); } catch (e) {}
            try { localStorage.setItem("xtj_user", name); } catch (e) {}
            lastUserSessionWriteAt = now;
            return next;
        }

        // 一次性迁移：将 localStorage 的 xtj_pw_hash 复制到 sessionStorage 后立刻删除旧值
        try { if (localStorage.getItem('xtj_pw_hash')) { if (!sessionStorage.getItem('xtj_pw_hash')) sessionStorage.setItem('xtj_pw_hash', localStorage.getItem('xtj_pw_hash')); localStorage.removeItem('xtj_pw_hash'); } } catch(e) {}

        function clearUserSessionStorage() {
            try { localStorage.removeItem(USER_SESSION_KEY); } catch (e) {}
            try { localStorage.removeItem("xtj_user"); } catch (e) {}
            try { sessionStorage.removeItem("xtj_pw_hash"); } catch (e) {}
            try { localStorage.removeItem("xtj_pw_hash"); } catch (e) {}
            lastUserSessionWriteAt = 0;
        }

        function restoreCurrentUserFromSession() {
            var now = Date.now();
            var session = readUserSession();
            if (!session) {
                var legacyUser = "";
                try { legacyUser = localStorage.getItem("xtj_user") || ""; } catch (e) { legacyUser = ""; }
                legacyUser = String(legacyUser || "").trim();
                if (legacyUser) {
                    writeUserSession(legacyUser, { resetLoginAt: true });
                    return legacyUser;
                }
                return "";
            }
            var userName = String(session.user_name || "").trim();
            var lastActiveAt = Number(session.last_active_at || 0);
            if (!userName || !Number.isFinite(lastActiveAt) || lastActiveAt <= 0 || (now - lastActiveAt) > USER_SESSION_TTL_MS) {
                clearUserSessionStorage();
                return "";
            }
            var loginAt = Number(session.login_at || 0);
            if (!Number.isFinite(loginAt) || loginAt <= 0) loginAt = lastActiveAt;
            try {
                localStorage.setItem(USER_SESSION_KEY, JSON.stringify({
                    user_name: userName,
                    login_at: loginAt,
                    last_active_at: now
                }));
                localStorage.setItem("xtj_user", userName);
            } catch (e) {}
            lastUserSessionWriteAt = now;
            // ★ 关键修复：检查真实鉴权凭据
            try {
                var _rt = !!(sessionStorage.getItem('xtj_user_token') || localStorage.getItem('xtj_user_token'));
                var _rp = !!(sessionStorage.getItem('xtj_pw_hash'));
                if (!_rt && !_rp) {
                    try { console.warn('[AUTH] restore: 假登录态（token + pwHash 缺失），自动登出'); } catch (e) {}
                    clearUserSessionStorage();
                    return "";
                }
                // token 缺失但 pwHash 存在 → 自动刷新 token（不阻塞页面加载）
                if (!_rt && _rp && typeof window.refreshUserToken === 'function') {
                    try { console.warn('[AUTH] restore: token 缺失但 pwHash 存在，自动刷新 token'); } catch (e) {}
                    window.refreshUserToken(true).catch(function(){});
                }
            } catch (e) {}
            return userName;
        }

        function touchUserSession(force) {
            var userName = String(window.currentUser || window._lastKnownUser || "").trim();
            if (!userName) return;
            var now = Date.now();
            if (!force && lastUserSessionWriteAt && (now - lastUserSessionWriteAt) < USER_SESSION_TOUCH_INTERVAL_MS) return;
            writeUserSession(userName, { resetLoginAt: false });
        }

        window.touchUserSession = touchUserSession;
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) touchUserSession(false);
        });
        window.addEventListener("focus", function () {
            touchUserSession(false);
        });

        let currentUser = restoreCurrentUserFromSession();
        window.currentUser = currentUser;
        window._lastKnownUser = currentUser;

        var statsEl = document.getElementById('statsSection');
        if (statsEl && !currentUser) statsEl.style.display = 'none';

        // 记录用户访问到后端统计（API优先，Supabase直连兜底）
        var _visitLoggedToday = false;
        function logUserVisitToApi(userName) {
            if (!userName) return;
            if (typeof API_BASE !== 'undefined' && API_BASE) {
                try {
                    var userToken = getUserToken();
                    var headers = { 'Content-Type': 'application/json' };
                    if (userToken) headers['Authorization'] = 'Bearer ' + userToken;
                    var body = { user_name: userName };
                    if (!userToken) {
                        body.password_hash = sessionStorage.getItem("xtj_pw_hash") || "";
                    }
                    fetch(API_BASE + '/api/log-user-visit', {
                        method: 'POST', headers: headers, body: JSON.stringify(body)
                    }).catch(function(){});
                } catch(e) {}
            } else if (sb && !_visitLoggedToday) {
                // 无后端API时直接写Supabase，同天只记录一次
                _visitLoggedToday = true;
                var today = new Date().toISOString().slice(0, 10);
                try {
                    sb.from('posts').insert([{
                        user_name: userName || 'anonymous',
                        content: JSON.stringify({ date: today }),
                        media_type: '__user_visit__',
                        media_url: today,
                        actor_key: 'uvisit_' + Date.now()
                    }]).then(function(){}, function(){});
                } catch(e) {}
            }
        }

        // IP级访问记录（无后端API时直接写Supabase）
        var _ipVisitDay = '';
        function logIpVisitToSupabase() {
            if (typeof API_BASE !== 'undefined' && API_BASE) return; // 有后端API时不重复记录
            if (!sb) return;
            var today = new Date().toISOString().slice(0, 10);
            if (_ipVisitDay === today) return; // 同天只记一次
            _ipVisitDay = today;
            try {
                sb.from('posts').insert([{
                    user_name: 'visitor',
                    content: JSON.stringify({ date: today }),
                    media_type: '__visit__',
                    media_url: today,
                    actor_key: 'visit_' + Date.now()
                }]).then(function(){}, function(){});
            } catch(e) {}
        }

        // 前端攻击检测（无后端API时记录到Supabase）
        var _attackClickTimes = [];
        var _attackLoggedToday = false;
        function logFrontendAttack(type, detail) {
            if (typeof API_BASE !== 'undefined' && API_BASE) return;
            if (!sb) return;
            var today = new Date().toISOString().slice(0, 10);
            try {
                sb.from('posts').insert([{
                    user_name: 'frontend',
                    content: JSON.stringify({ type: type, detail: String(detail || '').slice(0, 200), date: today }),
                    media_type: '__attack__',
                    media_url: type,
                    actor_key: 'fa_' + Date.now()
                }]).then(function(){}, function(){});
            } catch(e) {}
        }
        // 检测异常快速点击（>8次/秒）
        document.addEventListener('click', function() {
            var now = Date.now();
            _attackClickTimes.push(now);
            _attackClickTimes = _attackClickTimes.filter(function(t) { return now - t < 1000; });
            if (_attackClickTimes.length > 8 && !_attackLoggedToday) {
                _attackLoggedToday = true;
                logFrontendAttack('RAPID_CLICK', '异常高频点击 ' + _attackClickTimes.length + '次/秒');
                setTimeout(function() { _attackLoggedToday = false; }, 60000);
            }
        }, true);

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
        let postDwellObserver = null;
        const postDwellTimers = new Map();
        const POST_DWELL_THRESHOLD = 0.5;
        const POST_DWELL_DELAY = 1200;

        // ★ 修复 M4：页面卸载 / 面板切换时清理 Observer 和 Timer
        function cleanupObservers() {
            if (postVisibilityObserver) {
                try { postVisibilityObserver.disconnect(); } catch(e) {}
                postVisibilityObserver = null;
            }
            if (postDwellObserver) {
                try { postDwellObserver.disconnect(); } catch(e) {}
                postDwellObserver = null;
            }
            postDwellTimers.forEach(function(timerId, postId) {
                clearTimeout(timerId);
            });
            postDwellTimers.clear();
        }
        window.addEventListener('beforeunload', cleanupObservers);
        // 在面板切换时也清理（由 switchTab 调用）
        window.__xtjCleanupObservers = cleanupObservers;
        function primePostReveal(nodes) {
            Array.from(nodes || []).forEach(function(post, index) {
                if (!post || post.classList.contains('visible')) return;
                post.style.setProperty('--post-enter-delay', Math.min(index, 5) * 42 + 'ms');
            });
        }
        function clearPostDwellTimer(postId) {
            if (!postId || !postDwellTimers.has(postId)) return;
            clearTimeout(postDwellTimers.get(postId));
            postDwellTimers.delete(postId);
        }
        function schedulePostDwellTracking(postId) {
            if (!postId || postDwellTimers.has(postId) || !canTrackViewNow(postId)) return;
            var timerId = setTimeout(function() {
                postDwellTimers.delete(postId);
                trackView(postId);
            }, POST_DWELL_DELAY);
            postDwellTimers.set(postId, timerId);
        }
        function getPostVisibilityObserver() {
            if (!postVisibilityObserver) {
                try {
                    postVisibilityObserver = new IntersectionObserver(e => {
                        e.forEach(i => {
                            if (i.isIntersecting) {
                                i.target.classList.add('visible');
                            }
                        });
                    }, { threshold: 0.05 });
                } catch(_) {
                    postVisibilityObserver = { observe: function(el) { el.classList.add('visible'); } };
                }
            }
            return postVisibilityObserver;
        }
        function getPostDwellObserver() {
            if (!postDwellObserver) {
                try {
                    postDwellObserver = new IntersectionObserver(function(entries) {
                        entries.forEach(function(entry) {
                            var target = entry && entry.target;
                            var postId = target ? String(target.getAttribute('data-post-id') || '').trim() : '';
                            if (!postId) return;
                            if (entry.isIntersecting && entry.intersectionRatio >= POST_DWELL_THRESHOLD) {
                                schedulePostDwellTracking(postId);
                            } else {
                                clearPostDwellTimer(postId);
                            }
                        });
                    }, { threshold: [0, POST_DWELL_THRESHOLD, 1] });
                } catch (_) {
                    postDwellObserver = {
                        observe: function() {},
                        unobserve: function() {}
                    };
                }
            }
            return postDwellObserver;
        }
        function observePostViewportState(nodes) {
            Array.from(nodes || []).forEach(function(post) {
                if (!post) return;
                getPostVisibilityObserver().observe(post);
                getPostDwellObserver().observe(post);
            });
        }
        const CACHE_KEY = "xtj_feed_cache_v6";
        const CACHE_DURATION = 5 * 60 * 1000; // 5分钟

        const POST_METADATA_MARKER = "__xtj_post_v2__";
        const POST_META_DEFAULTS = {
            visibility: "public",
            is_pinned: false,
            pinned_at: null,
            updated_at: null,
            edited_at: null,
            fileSize: null,
            originalSize: null,
            mimeType: "",
            pro_at_post: false  // 发布时是否为 Pro 会员（冻结的 Pro 状态）
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
            return '<div class="xtj-magic-loading" style="display:flex;align-items:center;justify-content:center;min-height:140px;padding:16px 0;"><div class="xtj-loading-skeleton" style="width:100%"><div class="xtj-skeleton-card"><div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div><div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div></div></div></div>';
        }

        function isAdmin() { return currentUser === ADMIN_NAME; }

        var __vipStatus = { is_vip: false, vip_info: null };
        var vipStatusRefreshPromise = null;
        function isVipUser() {
            if (!currentUser) return false;
            if (currentUser === ADMIN_NAME) return true;
            if (typeof window.__xtjCheckLocalVip === 'function') {
                var localVip = window.__xtjCheckLocalVip(currentUser);
                if (localVip) {
                    __vipStatus.is_vip = true;
                    __vipStatus.vip_info = localVip;
                    return true;
                }
            }
            if (__vipStatus.is_vip !== true) return false;
            var info = __vipStatus.vip_info;
            if (!info || !info.expire_at) {
                __vipStatus.is_vip = false;
                return false;
            }
            var expireTs = new Date(info.expire_at).getTime();
            if (!isNaN(expireTs) && expireTs <= Date.now()) {
                __vipStatus.is_vip = false;
                return false;
            }
            return true;
        }
        function setVipStatus(v) {
            __vipStatus.is_vip = !!v;
            if (!v) __vipStatus.vip_info = null;
        }
        function getVipInfo() { return __vipStatus.vip_info; }

        var USER_STYLE_MARKER = '__user_style__';
        var USER_STYLE_STORAGE_PREFIX = 'xtj_user_style_';
        var PRO_VISUAL_FEATURE_KEYS = ['custom_theme', 'pro_chat_bubble', 'pro_post_style'];
        var currentUserStyleRecordId = '';
        var currentUserStyle = createDefaultUserStyle();
        var currentUserStylePreview = null;

        function createDefaultUserStyle() {
            return {
                theme: 'default',
                chat_bubble_style: 'default',
                post_card_style: 'default',
                updated_at: ''
            };
        }

        function getUserStyleStorageKey(userName) {
            return USER_STYLE_STORAGE_PREFIX + String(userName || '').trim();
        }

        function normalizeUserStyle(payload) {
            var style = Object.assign({}, createDefaultUserStyle(), payload || {});
            var theme = String(style.theme || 'default');
            var bubble = String(style.chat_bubble_style || 'default');
            var postStyle = String(style.post_card_style || 'default');
            if (['default', 'mint', 'aqua', 'sakura', 'lavender'].indexOf(theme) < 0) theme = 'default';
            if (['default', 'mint', 'aqua', 'cream', 'sakura', 'lavender'].indexOf(bubble) < 0) bubble = 'default';
            if (['default', 'clean_border', 'leaf_corner', 'soft_glow', 'minimal_pro'].indexOf(postStyle) < 0) postStyle = 'default';
            style.theme = theme;
            style.chat_bubble_style = bubble;
            style.post_card_style = postStyle;
            style.updated_at = style.updated_at ? String(style.updated_at) : '';
            return style;
        }

        function readCachedUserStyle(userName) {
            if (!userName) return null;
            try {
                return normalizeUserStyle(window.safeLocalStorageGetJSON(getUserStyleStorageKey(userName), null));
            } catch(e) {
                return null;
            }
        }

        function writeCachedUserStyle(userName, style) {
            if (!userName) return;
            try {
                localStorage.setItem(getUserStyleStorageKey(userName), JSON.stringify(normalizeUserStyle(style)));
            } catch(e) {}
        }

        function getCurrentProFeatures() {
            if (currentUser === ADMIN_NAME) return PRO_VISUAL_FEATURE_KEYS.slice();
            if (!currentUser || !isVipUser()) return [];
            var info = getVipInfo();
            var features = Array.isArray(info && info.features) ? info.features : [];
            return PRO_VISUAL_FEATURE_KEYS.filter(function(feature) {
                return features.indexOf(feature) >= 0;
            });
        }
        window.getCurrentProFeatures = getCurrentProFeatures;

        function hasProFeature(feature) {
            if (currentUser === ADMIN_NAME) return true;
            if (!currentUser || !isVipUser()) return false;
            return getCurrentProFeatures().indexOf(String(feature || '')) >= 0;
        }
        window.hasProFeature = hasProFeature;

        function getCurrentStyleDraft() {
            return normalizeUserStyle(currentUserStylePreview || currentUserStyle);
        }

        function getProStyleSelectMeta(type) {
            if (type === 'theme') {
                return {
                    selectId: 'proThemeSelect',
                    feature: 'custom_theme',
                    key: 'theme',
                    label: '专属主题'
                };
            }
            if (type === 'bubble') {
                return {
                    selectId: 'proBubbleSelect',
                    feature: 'pro_chat_bubble',
                    key: 'chat_bubble_style',
                    label: '聊天气泡'
                };
            }
            return {
                selectId: 'proPostStyleSelect',
                feature: 'pro_post_style',
                key: 'post_card_style',
                label: '帖子卡片装饰'
            };
        }

        function getUserStyleDraftFromControls() {
            var draft = getCurrentStyleDraft();
            var themeSelect = document.getElementById('proThemeSelect');
            var bubbleSelect = document.getElementById('proBubbleSelect');
            var postSelect = document.getElementById('proPostStyleSelect');
            return normalizeUserStyle({
                theme: themeSelect ? themeSelect.value : draft.theme,
                chat_bubble_style: bubbleSelect ? bubbleSelect.value : draft.chat_bubble_style,
                post_card_style: postSelect ? postSelect.value : draft.post_card_style,
                updated_at: draft.updated_at || currentUserStyle.updated_at || ''
            });
        }

        function setProStyleSelectValue(type, value) {
            var meta = getProStyleSelectMeta(type);
            var select = document.getElementById(meta.selectId);
            if (!select) return false;
            select.value = value;
            currentUserStylePreview = getUserStyleDraftFromControls();
            return true;
        }
        window.setProStyleSelectValue = setProStyleSelectValue;

        function updateProStylePreviewActiveStates() {
            var page = document.getElementById('profileProStylePage');
            if (!page) return;
            ['theme', 'bubble', 'post'].forEach(function(type) {
                var meta = getProStyleSelectMeta(type);
                var select = document.getElementById(meta.selectId);
                var selectedValue = select ? String(select.value || 'default') : 'default';
                var enabled = currentUser === ADMIN_NAME || hasProFeature(meta.feature);
                page.querySelectorAll('.pro-style-option-card[data-pro-style-type="' + type + '"]').forEach(function(card) {
                    var cardValue = String(card.getAttribute('data-pro-style-value') || '');
                    var active = cardValue === selectedValue;
                    card.classList.toggle('active', active);
                    card.classList.toggle('locked', !enabled && cardValue !== 'default');
                    card.disabled = !enabled && cardValue !== 'default';
                    card.setAttribute('aria-pressed', active ? 'true' : 'false');
                    card.setAttribute('aria-disabled', (!enabled && cardValue !== 'default') ? 'true' : 'false');
                });
            });
        }
        window.updateProStylePreviewActiveStates = updateProStylePreviewActiveStates;

        function bindProStylePreviewCards() {
            var page = document.getElementById('profileProStylePage');
            if (!page || page.dataset.previewCardsBound === '1') return;
            page.dataset.previewCardsBound = '1';

            page.addEventListener('click', function(evt) {
                var card = evt.target && evt.target.closest ? evt.target.closest('.pro-style-option-card[data-pro-style-type]') : null;
                if (!card) return;
                var type = String(card.getAttribute('data-pro-style-type') || '');
                var value = String(card.getAttribute('data-pro-style-value') || '');
                var meta = getProStyleSelectMeta(type);
                // 0.97i：移除非 Pro 用户点击预览的拦截
                // 非 Pro 用户可以预览/查看所有 Pro 视觉权益（动画 + 切换预览）
                // 权限校验在保存时（saveCurrentUserStylePart）进行
                if (setProStyleSelectValue(type, value)) {
                    updateProStylePreviewActiveStates();
                    applyCurrentUserStyle();
                }
            });

            ['proThemeSelect', 'proBubbleSelect', 'proPostStyleSelect'].forEach(function(id) {
                var select = document.getElementById(id);
                if (!select || select.dataset.previewSyncBound === '1') return;
                select.dataset.previewSyncBound = '1';
                select.addEventListener('change', function() {
                    currentUserStylePreview = getUserStyleDraftFromControls();
                    updateProStylePreviewActiveStates();
                    applyCurrentUserStyle();
                });
            });
        }
        window.bindProStylePreviewCards = bindProStylePreviewCards;

        function getResolvedUserStyle() {
            var raw = getCurrentStyleDraft();
            return {
                theme: hasProFeature('custom_theme') ? raw.theme : 'default',
                chat_bubble_style: hasProFeature('pro_chat_bubble') ? raw.chat_bubble_style : 'default',
                post_card_style: hasProFeature('pro_post_style') ? raw.post_card_style : 'default'
            };
        }

        function getCurrentUserPostStyleClass(post) {
            if (!currentUser || !post || String(post.user_name || '') !== String(currentUser)) return '';
            var resolved = getResolvedUserStyle();
            if (!resolved.post_card_style || resolved.post_card_style === 'default') return ' is-self-post';
            return ' is-self-post post-style-' + resolved.post_card_style;
        }

        function applyCurrentUserPostStyleToDom() {
            var feed = document.getElementById('feed');
            if (!feed || !currentUser) return;
            var resolved = getResolvedUserStyle();
            var styleClass = resolved.post_card_style && resolved.post_card_style !== 'default'
                ? 'post-style-' + resolved.post_card_style
                : '';
            Array.prototype.forEach.call(feed.querySelectorAll('.post'), function(node) {
                var postUser = node.getAttribute('data-post-user');
                if (postUser !== String(currentUser)) return;
                node.classList.add('is-self-post');
                node.classList.remove('post-style-clean_border', 'post-style-leaf_corner', 'post-style-soft_glow', 'post-style-minimal_pro');
                if (styleClass) node.classList.add(styleClass);
            });
        }

        function renderProStyleSettings() {
            // 0.97g 简化：landing 不再有 #proStylePanelLanding 包装（直接展示 3 个入口卡）
            // 这里只做：刷新每个 select 的值 + 重新计算 preview 选中状态 + 更新入口卡描述
            if (!currentUser) {
                if (typeof updateProStyleEntry === 'function') updateProStyleEntry();
                return;
            }
            // 同步所有分类面板的 select 值
            var themeSelect = document.getElementById('proThemeSelect');
            var bubbleSelect = document.getElementById('proBubbleSelect');
            var postSelect = document.getElementById('proPostStyleSelect');
            bindProStylePreviewCards();
            var saved = getCurrentStyleDraft();
            if (themeSelect) themeSelect.value = saved.theme;
            if (bubbleSelect) bubbleSelect.value = saved.chat_bubble_style;
            if (postSelect) postSelect.value = saved.post_card_style;
            if (themeSelect) themeSelect.disabled = !hasProFeature('custom_theme');
            if (bubbleSelect) bubbleSelect.disabled = !hasProFeature('pro_chat_bubble');
            if (postSelect) postSelect.disabled = !hasProFeature('pro_post_style');
            updateProStylePreviewActiveStates();
            // 注意：此处不再强制 showProStyleLanding() ——
            //      openProStylePage() 会在第一次进入时显式调用，
            //      避免用户在子面板中编辑时被打回总览。
            if (typeof updateProStyleEntry === 'function') {
                updateProStyleEntry();
            }
        }

        function updateProStyleEntry() {
            var entry = document.getElementById('profileProStyleEntry');
            var sub = document.getElementById('proStyleEntryStatus');
            var badge = document.getElementById('proStyleEntryBadge');

            if (!entry) return;

            if (!currentUser) {
                entry.classList.add('is-locked');
                if (sub) sub.textContent = '登录后可查看和保存 Pro 视觉偏好';
                if (badge) badge.textContent = '登录';
                return;
            }

            entry.classList.remove('is-locked');

            var features = typeof getCurrentProFeatures === 'function'
                ? getCurrentProFeatures()
                : [];

            if (badge) {
                badge.textContent = features.length ? ('已解锁 ' + features.length + ' 项') : '默认';
            }

            if (sub) {
                var draft = typeof getCurrentStyleDraft === 'function'
                    ? getCurrentStyleDraft()
                    : null;

                if (features.length) {
                    sub.textContent = '专属主题、聊天气泡、帖子卡片装饰已可配置';
                } else if (draft && (
                    draft.theme !== 'default' ||
                    draft.chat_bubble_style !== 'default' ||
                    draft.post_card_style !== 'default'
                )) {
                    sub.textContent = '已保存偏好，重新获得 Pro 权益后自动恢复';
                } else {
                    sub.textContent = '当前使用默认视觉样式';
                }
            }
        }
        window.updateProStyleEntry = updateProStyleEntry;

        // 三级分组入口：显示某个分类面板
        window.showProStyleCategory = function(category) {
            var entries = document.getElementById('proStyleCategoryCards');
            // 外层总保存按钮已删除（每个板块独立保存），保留查找以便向后兼容
            var actions = document.getElementById('proStylePanelActions');
            var panels = {
                theme: document.getElementById('proStylePanelTheme'),
                bubble: document.getElementById('proStylePanelBubble'),
                post: document.getElementById('proStylePanelPost')
            };
            if (entries) {
                entries.hidden = true;
                entries.classList.remove('is-enter');
            }
            if (actions) actions.hidden = true; // 兼容旧结构
            var target = panels[category];
            Object.keys(panels).forEach(function(key) {
                if (panels[key]) {
                    panels[key].hidden = (key !== category);
                    panels[key].classList.remove('is-enter');
                }
            });
            // 子面板淡入 + 轻微上浮
            if (target) {
                target.hidden = false;
                try {
                    // 强制 reflow 重启动画
                    void target.offsetWidth;
                    target.classList.add('is-enter');
                } catch (e) {}
            }
            // 重新计算 preview 选中状态
            if (typeof updateProStylePreviewActiveStates === 'function') {
                try { updateProStylePreviewActiveStates(); } catch (_) {}
            }
            var panel = document.getElementById('profileProStylePage');
            if (panel && typeof panel.scrollTo === 'function') {
                panel.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        // 三级分组入口：返回总览
        window.showProStyleLanding = function() {
            // 0.97g 简化：landing 不再有 #proStylePanelLanding 包装
            // 直接隐藏三个子面板 + 显示入口卡组
            var entries = document.getElementById('proStyleCategoryCards');
            var actions = document.getElementById('proStylePanelActions');
            var panels = ['proStylePanelTheme', 'proStylePanelBubble', 'proStylePanelPost'];
            panels.forEach(function(id) {
                var el = document.getElementById(id);
                if (el) {
                    el.hidden = true;
                    el.classList.remove('is-enter');
                }
            });
            if (entries) {
                entries.hidden = false;
                entries.classList.remove('is-enter');
                try {
                    void entries.offsetWidth;
                    entries.classList.add('is-enter');
                } catch (e) {}
            }
            if (actions) actions.hidden = true; // 兼容旧结构
            var panel = document.getElementById('profileProStylePage');
            if (panel && typeof panel.scrollTo === 'function') {
                panel.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        window.openProStylePage = function() {
            if (!currentUser) {
                showToast('请先登录');
                return;
            }

            var main = document.getElementById('profileMainView');
            var page = document.getElementById('profileProStylePage');
            var panel = document.getElementById('panelProfile');

            if (!page) return;

            if (main) main.hidden = true;
            page.hidden = false;
            page.classList.add('active');

            if (typeof renderProStyleSettings === 'function') {
                renderProStyleSettings();
            }
            // 第一次进入时显式显示总览
            // (renderProStyleSettings 不再自动 showLanding，避免在子面板编辑时被强制重置)
            if (typeof window.showProStyleLanding === 'function') {
                window.showProStyleLanding();
            }

            if (panel && typeof panel.scrollTo === 'function') {
                panel.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        window.closeProStylePage = function() {
            var main = document.getElementById('profileMainView');
            var page = document.getElementById('profileProStylePage');
            var panel = document.getElementById('panelProfile');

            if (page) {
                page.classList.remove('active');
                page.hidden = true;
            }

            if (main) main.hidden = false;

            if (panel && typeof panel.scrollTo === 'function') {
                panel.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        function applyCurrentUserStyle() {
            var root = document.documentElement;
            var resolved = getResolvedUserStyle();
            root.setAttribute('data-pro-theme', resolved.theme || 'default');
            root.setAttribute('data-pro-chat-bubble', resolved.chat_bubble_style || 'default');
            root.setAttribute('data-pro-post-style', resolved.post_card_style || 'default');
            renderProStyleSettings();
            applyCurrentUserPostStyleToDom();
        }
        window.__xtjApplyCurrentUserStyle = applyCurrentUserStyle;

        async function loadCurrentUserStyle() {
            currentUserStyleRecordId = '';
            currentUserStyle = createDefaultUserStyle();
            currentUserStylePreview = null;
            if (!currentUser) {
                applyCurrentUserStyle();
                return currentUserStyle;
            }
            var cached = readCachedUserStyle(currentUser);
            if (cached) {
                currentUserStyle = cached;
                applyCurrentUserStyle();
            } else {
                applyCurrentUserStyle();
            }
            if (!window.sb) return currentUserStyle;
            try {
                var styleRes = await sb.from("posts")
                    .select("id, content")
                    .eq("user_name", currentUser)
                    .eq("media_type", USER_STYLE_MARKER)
                    .order("created_at", { ascending: false })
                    .limit(1);
                if (styleRes.data && styleRes.data.length > 0) {
                    currentUserStyleRecordId = styleRes.data[0].id || '';
                    try {
                        currentUserStyle = normalizeUserStyle(JSON.parse(styleRes.data[0].content || '{}'));
                    } catch(e) {
                        currentUserStyle = createDefaultUserStyle();
                    }
                    writeCachedUserStyle(currentUser, currentUserStyle);
                }
            } catch(e) {
                if (!cached) currentUserStyle = createDefaultUserStyle();
            }
            applyCurrentUserStyle();
            return currentUserStyle;
        }
        window.loadCurrentUserStyle = loadCurrentUserStyle;

        window.saveCurrentUserStyle = async function() {
            if (!currentUser) { showToast('请先登录'); return; }
            var themeSelect = document.getElementById('proThemeSelect');
            var bubbleSelect = document.getElementById('proBubbleSelect');
            var postSelect = document.getElementById('proPostStyleSelect');
            var saveBtn = document.getElementById('proStyleSaveBtn');
            var nextStyle = normalizeUserStyle({
                theme: themeSelect ? themeSelect.value : currentUserStyle.theme,
                chat_bubble_style: bubbleSelect ? bubbleSelect.value : currentUserStyle.chat_bubble_style,
                post_card_style: postSelect ? postSelect.value : currentUserStyle.post_card_style,
                updated_at: new Date().toISOString()
            });
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.dataset.originText = saveBtn.textContent || '保存视觉偏好';
                saveBtn.textContent = '保存中...';
            }
            try {
                var payload = {
                    user_name: currentUser,
                    content: JSON.stringify(nextStyle),
                    media_type: USER_STYLE_MARKER,
                    actor_key: USER_STYLE_MARKER
                };
                if (currentUserStyleRecordId) {
                    var updateRes = await sb.from("posts")
                        .update({ content: payload.content, actor_key: USER_STYLE_MARKER })
                        .eq("id", currentUserStyleRecordId);
                    if (updateRes.error) throw updateRes.error;
                } else {
                    var insertRes = await sb.from("posts").insert([payload]).select("id");
                    if (insertRes.error) throw insertRes.error;
                    if (insertRes.data && insertRes.data[0] && insertRes.data[0].id) {
                        currentUserStyleRecordId = insertRes.data[0].id;
                    }
                }
                currentUserStyle = nextStyle;
                currentUserStylePreview = nextStyle;
                writeCachedUserStyle(currentUser, currentUserStyle);
                applyCurrentUserStyle();
                showToast('视觉偏好已保存');
            } catch(e) {
                showToast('保存失败: ' + (e && e.message ? e.message : '未知错误'), 'error');
                applyCurrentUserStyle();
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = saveBtn.dataset.originText || '保存视觉偏好';
                    saveBtn.removeAttribute('data-origin-text');
                }
            }
        };

        // 板块级保存：只保存 type 指定的字段，保留其他两个板块的已保存值
        // type ∈ 'theme' | 'bubble' | 'post'
        window.saveCurrentUserStylePart = async function(type) {
            if (!currentUser) { showToast('请先登录'); return; }
            if (!type) return;
            var meta = getProStyleSelectMeta(type);
            var selectEl = document.getElementById(meta.selectId);
            if (!selectEl) {
                showToast('未找到对应选项');
                return;
            }
            // 权限校验
            var enabled = currentUser === ADMIN_NAME || hasProFeature(meta.feature);
            if (!enabled && selectEl.value !== 'default') {
                showToast('这是 Pro 视觉权益，领取包含该权益的 Pro 活动后可使用');
                return;
            }
            // 找到本板块的"保存"按钮
            var saveBtn = document.querySelector(
                '.pro-style-save-btn[data-pro-style-save-type="' + type + '"]'
            );
            // 从 currentUserStyle 中读取其他两个板块已保存值（关键：保留！不能覆盖！）
            var next = normalizeUserStyle({
                theme: type === 'theme' ? selectEl.value : (currentUserStyle.theme || 'default'),
                chat_bubble_style: type === 'bubble' ? selectEl.value : (currentUserStyle.chat_bubble_style || 'default'),
                post_card_style: type === 'post' ? selectEl.value : (currentUserStyle.post_card_style || 'default'),
                updated_at: new Date().toISOString()
            });
            var originText = '';
            if (saveBtn) {
                saveBtn.disabled = true;
                originText = saveBtn.textContent || '保存';
                saveBtn.dataset.originText = originText;
                saveBtn.textContent = '保存中...';
            }
            try {
                var payload = {
                    user_name: currentUser,
                    content: JSON.stringify(next),
                    media_type: USER_STYLE_MARKER,
                    actor_key: USER_STYLE_MARKER
                };
                if (currentUserStyleRecordId) {
                    var updateRes = await sb.from("posts")
                        .update({ content: payload.content, actor_key: USER_STYLE_MARKER })
                        .eq("id", currentUserStyleRecordId);
                    if (updateRes.error) throw updateRes.error;
                } else {
                    var insertRes = await sb.from("posts").insert([payload]).select("id");
                    if (insertRes.error) throw insertRes.error;
                    if (insertRes.data && insertRes.data[0] && insertRes.data[0].id) {
                        currentUserStyleRecordId = insertRes.data[0].id;
                    }
                }
                currentUserStyle = next;
                currentUserStylePreview = next;
                writeCachedUserStyle(currentUser, currentUserStyle);
                applyCurrentUserStyle();
                showToast('已保存「' + (meta.label || type) + '」板块');
            } catch(e) {
                showToast('保存失败: ' + (e && e.message ? e.message : '未知错误'), 'error');
                applyCurrentUserStyle();
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = saveBtn.dataset.originText || '保存';
                    saveBtn.removeAttribute('data-origin-text');
                }
            }
        };

        async function updateVipStatus() {
            if (!currentUser) return;

            // 先检查本地缓存（即使API不可用也能识别VIP状态）
            if (typeof window.__xtjCheckLocalVip === 'function') {
                var localVip = window.__xtjCheckLocalVip(currentUser);
                if (localVip) {
                    __vipStatus.is_vip = true;
                    __vipStatus.vip_info = localVip;
                    updateVipUI();
                    if (typeof window.__xtjApplyProTheme === 'function') window.__xtjApplyProTheme(true);
                    return;
                }
            }

            // 尝试API查询
            try {
                var url = API_BASE + '/api/vip/status?user_name=' + encodeURIComponent(currentUser);
                var vc = new AbortController();
                var vt = setTimeout(function() { vc.abort(); }, 8000);
                var resp = await fetch(url, { signal: vc.signal });
                clearTimeout(vt);
                var data = await resp.json();
                var apiIsVip = data.is_vip === true;
                if (apiIsVip) {
                    if (!data.active_vip || !data.active_vip.expire_at) {
                        apiIsVip = false;
                    } else {
                        var apiExpireTs = new Date(data.active_vip.expire_at).getTime();
                        if (!isNaN(apiExpireTs) && apiExpireTs <= Date.now()) {
                            apiIsVip = false;
                        }
                    }
                }
                __vipStatus.is_vip = apiIsVip;
                __vipStatus.vip_info = apiIsVip ? (data.active_vip || null) : null;
                updateVipUI();
                if (typeof window.__xtjApplyProTheme === 'function') window.__xtjApplyProTheme(__vipStatus.is_vip);
                return;
            } catch(e) {}

            // 回退到Supabase直接查询
            if (typeof window.__xtjQueryVipStatus === 'function') {
                try {
                    var vipData = await window.__xtjQueryVipStatus(currentUser);
                    if (vipData && vipData.is_active) {
                        __vipStatus.is_vip = true;
                        __vipStatus.vip_info = vipData;
                        updateVipUI();
                        if (typeof window.__xtjApplyProTheme === 'function') window.__xtjApplyProTheme(true);
                    }
                } catch(e) {}
            }
        }
        async function ensureVipStatusFresh(force) {
            if (!currentUser) {
                __vipStatus.is_vip = false;
                __vipStatus.vip_info = null;
                return __vipStatus;
            }
            if (!force && isVipUser()) return __vipStatus;
            if (!vipStatusRefreshPromise || force) {
                vipStatusRefreshPromise = Promise.resolve()
                    .then(function() { return updateVipStatus(); })
                    .catch(function() {})
                    .finally(function() {
                        vipStatusRefreshPromise = null;
                    });
            }
            await vipStatusRefreshPromise;
            return __vipStatus;
        }
        window.ensureVipStatusFresh = ensureVipStatusFresh;

        function updateVipUI() {
            var badge = document.getElementById('vipCardBadge');
            var sub = document.getElementById('vipCardSub');
            if (__vipStatus.is_vip) {
                if (badge) { badge.textContent = '已激活'; badge.className = 'xtj-vip-card-badge active'; }
                if (sub) {
                    var info = getVipInfo();
                    if (info && info.expire_at) {
                        var d = new Date(info.expire_at);
                        sub.textContent = '有效期至 ' + d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
                    } else {
                        sub.textContent = 'VIP 会员已激活';
                    }
                }
            } else {
                // 旧版"¥3/月"已彻底去除：不显示价格，引导用户进入弹窗查看活动
                if (badge) { badge.textContent = '查看活动'; badge.className = 'xtj-vip-card-badge'; }
                if (sub) sub.textContent = '活动由管理员限时发布';
            }
            // 刷新帖子列表
            applyCurrentUserStyle();
        }

        function requestProGiftRelogin() {
            window.__xtjPendingProRelogin = true;
            if (typeof openAuthModal === 'function') {
                openAuthModal('login');
            } else {
                var loginModal = document.getElementById('loginModal');
                if (loginModal) loginModal.classList.add('active');
            }
        }
        window.requestProGiftRelogin = requestProGiftRelogin;

        async function resolvePendingProRelogin() {
            if (!window.__xtjPendingProRelogin) return;
            window.__xtjPendingProRelogin = false;
            try { await ensureVipStatusFresh(true); } catch(e) {}
            try { updateVipModalUI(); } catch(e) {}
            try { await loadProGiftCampaigns(); } catch(e) {}
        }

        async function openVipModal() {
            if (!currentUser) { showToast('请先登录'); return; }
            try { await ensureUserToken(); } catch(e) {}
            openModal('vipModal');
            updateVipModalUI();
        }

        // 兼容保留：vipPayBtn 已被移除，这里只安全检查一下，不报错
        function updateVipModalUI() {
            // 旧版的"立即开通 ¥3"按钮和"已是VIP会员"状态卡已彻底移除
            // 新版 Pro 弹窗只显示当前 Pro 状态 + Pro 活动列表
            renderVipStatusBanner();
            loadProGiftCampaigns();
        }

        // 弹窗顶部轻量 Pro 状态条（不显示任何价格/套餐）
        function renderVipStatusBanner() {
            var banner = document.getElementById('vipStatusBanner');
            if (!banner) return;
            var info = __vipStatus && __vipStatus.vip_info;
            if (__vipStatus && __vipStatus.is_vip) {
                var expireText = '';
                if (info && info.expire_at) {
                    try {
                        expireText = new Date(info.expire_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                    } catch (e) {
                        expireText = String(info.expire_at);
                    }
                }
                banner.style.display = '';
                banner.classList.add('is-pro');
                banner.innerHTML = [
                    '<span class="vip-status-banner-icon">👑</span>',
                    '<span class="vip-status-banner-text">',
                    '  当前是 Pro 会员',
                    expireText ? ' · 有效至 ' + escapeHtml(expireText) : '',
                    '</span>'
                ].join('');
            } else {
                banner.style.display = 'none';
                banner.classList.remove('is-pro');
                banner.innerHTML = '';
            }
        }

        // 兼容保留 handleVipPurchase 函数名（被删除按钮的旧 onclick 引用）
        // 新规则：前端禁止直接开通 Pro，必须由后端管理发布的活动领取
        async function handleVipPurchase() {
            if (!currentUser) { showToast('请先登录'); return; }
            if (__vipStatus && __vipStatus.is_vip) {
                showToast('您已是 Pro 会员');
                return;
            }
            // 前端已禁用直接开通入口；引导用户到下方活动区领取
            showToast('Pro 会员由管理员限时发布，请等待活动开放后领取');
        }

        // 加载可领取的 Pro 赠送活动
        async function loadProGiftCampaigns() {
            var section = document.getElementById('proGiftSection');
            var list = document.getElementById('proGiftList');
            if (!section || !list || !currentUser) return;

            // 渲染空状态（无活动时显示）
            function renderEmpty(msg, sub) {
                section.style.display = '';
                list.innerHTML = [
                    '<div class="pro-gift-empty">',
                    '  <div class="pro-gift-empty-icon">🎁</div>',
                    '  <div class="pro-gift-empty-text">' + escapeHtml(msg) + '</div>',
                    sub ? '<div class="pro-gift-empty-sub">' + escapeHtml(sub) + '</div>' : '',
                    '</div>'
                ].join('');
            }

            // 区分两种"无法请求"场景：
            //  1. fake_login  — currentUser 存在但 token / password_hash 都没有，是页面级假登录
            //                   提示文案："登录状态已过期，请重新登录后查看活动"
            //  2. expired     — token 真的过期了，重试一次后仍 401/403
            //                   提示文案："登录凭证需要刷新" + 重新登录按钮
            function renderFakeLogin() {
                section.style.display = '';
                list.innerHTML = [
                    '<div class="pro-gift-auth-card">',
                    '  <div class="pro-gift-empty-icon">🔐</div>',
                    '  <div class="pro-gift-auth-title">登录状态已过期</div>',
                    '  <div class="pro-gift-auth-copy">你的登录状态已过期，请重新登录后查看 Pro 活动。</div>',
                    '  <div class="pro-gift-auth-actions"><button type="button" class="btn primary pro-gift-auth-btn" onclick="openAuthModal(\'login\')">重新登录</button></div>',
                    '</div>'
                ].join('');
            }

            function renderAuthExpired() {
                section.style.display = '';
                list.innerHTML = [
                    '<div class="pro-gift-auth-card">',
                    '  <div class="pro-gift-empty-icon">🔐</div>',
                    '  <div class="pro-gift-auth-title">登录凭证需要刷新</div>',
                    '  <div class="pro-gift-auth-copy">你当前账号仍显示为已登录，但领取 Pro 活动需要重新验证一次身份。</div>',
                    '  <div class="pro-gift-auth-actions"><button type="button" class="btn primary pro-gift-auth-btn" onclick="requestProGiftRelogin()">重新登录</button></div>',
                    '</div>'
                ].join('');
            }

            // 检查是否处于"假登录"状态：有 currentUser 但完全没有 token / password_hash
            function isFakeLogin() {
                if (getUserToken()) return false;
                try {
                    var pwHash = sessionStorage.getItem('xtj_pw_hash') || '';
                    if (pwHash) return false;
                } catch (e) {}
                return true;
            }

            try {
                var tok = await ensureUserToken();
                if (!tok) {
                    // 没拿到 token：先判别是 fake login 还是真正缺凭据
                    if (isFakeLogin()) {
                        renderFakeLogin();
                    } else {
                        renderAuthExpired();
                    }
                    return;
                }
                var headers = { 'Authorization': 'Bearer ' + tok };
                var resp = await fetch(API_BASE + '/api/pro-gifts/available?user_name=' + encodeURIComponent(currentUser), {
                    headers: headers,
                    signal: AbortSignal.timeout(8000)
                });
                if (resp.status === 401 || resp.status === 403) {
                    clearUserToken();
                    // token 过期，尝试补一次 token 后重试
                    var newTok = await ensureUserToken();
                    if (newTok) {
                        headers['Authorization'] = 'Bearer ' + newTok;
                        resp = await fetch(API_BASE + '/api/pro-gifts/available?user_name=' + encodeURIComponent(currentUser), {
                            headers: headers,
                            signal: AbortSignal.timeout(8000)
                        });
                        if (resp.status === 401 || resp.status === 403) {
                            clearUserToken();
                            renderAuthExpired();
                            return;
                        }
                    } else {
                        // 重试后还是拿不到 token：先看是不是 fake login
                        if (isFakeLogin()) {
                            renderFakeLogin();
                        } else {
                            renderAuthExpired();
                        }
                        return;
                    }
                }
                var data = await resp.json();
                if (data && data.error) {
                    renderEmpty('Pro 活动加载失败', data.error || '请稍后重试');
                    return;
                }
                var gifts = (data && data.gifts) || [];
                if (!gifts.length) {
                    renderEmpty('暂无可领取的 Pro 活动', '活动由管理员限时发布，请等待下一次开放。');
                    return;
                }
                section.style.display = '';
                list.innerHTML = gifts.map(function(g) {
                    var cardClass = 'pro-gift-card' + (g.already_claimed ? ' claimed' : '');
                    var durationText = (g.duration_days || 30) + ' 天 Pro';
                    if (g.claim_expire_at) {
                        var expireDate = new Date(g.claim_expire_at);
                        if (expireDate > new Date()) {
                            var daysLeft = Math.ceil((expireDate - new Date()) / (1000 * 60 * 60 * 24));
                            durationText += ' · 还剩 ' + daysLeft + ' 天';
                        }
                    }
                    // 限定/专属活动标识
                    var exclusiveTag = (g.exclusive || g.allowed_users || g.exclusive_users || g.target_users)
                        ? '<span class="pro-gift-card-tag">专属</span>' : '';
                    // 剩余名额
                    var remainText = '';
                    if (typeof g.remaining_count === 'number' && typeof g.claim_limit === 'number') {
                        remainText = '<span class="pro-gift-card-remain">剩余 ' + g.remaining_count + ' / ' + g.claim_limit + ' 名额</span>';
                    } else if (typeof g.remaining_count === 'number') {
                        remainText = '<span class="pro-gift-card-remain">剩余 ' + g.remaining_count + ' 名额</span>';
                    }
                    // 截止时间
                    var expireText = '';
                    if (g.claim_expire_at) {
                        try {
                            expireText = new Date(g.claim_expire_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                        } catch (e) { expireText = String(g.claim_expire_at); }
                    }

                    // 按钮状态：未领取 / 已领取 / 名额满 / 已结束
                    var buttonHtml;
                    if (g.already_claimed) {
                        buttonHtml = '<div class="pro-gift-claimed-badge">' +
                            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>已领取</div>';
                    } else if (g.full || g.remaining_count === 0) {
                        buttonHtml = '<div class="pro-gift-claimed-badge disabled">名额已满</div>';
                    } else if (g.expired) {
                        buttonHtml = '<div class="pro-gift-claimed-badge disabled">已结束</div>';
                    } else {
                        buttonHtml = '<button class="pro-gift-claim-btn" data-gift-id="' + escapeHtml(g.id) + '" onclick="claimProGift(\'' + escapeHtml(g.id) + '\')">领取 Pro</button>';
                    }

                    var card = '<div class="' + cardClass + '" data-gift-id="' + escapeHtml(g.id) + '">';
                    card += '<div class="pro-gift-card-main">';
                    card += '<div class="pro-gift-card-info">';
                    card += '<div class="pro-gift-card-title">' + exclusiveTag + escapeHtml(g.title || '') + '</div>';
                    if (g.description) {
                        card += '<div class="pro-gift-card-desc">' + escapeHtml(g.description) + '</div>';
                    }
                    card += '<div class="pro-gift-card-meta">';
                    card += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
                    card += '<span>' + durationText + '</span>';
                    if (remainText) card += '<span class="pro-gift-card-dot">·</span>' + remainText;
                    if (expireText) card += '<span class="pro-gift-card-dot">·</span><span>截止 ' + escapeHtml(expireText) + '</span>';
                    card += '</div>';
                    // 功能权益（来自后端活动 features）
                    if (Array.isArray(g.features) && g.features.length) {
                        var featureMap = {
                            'vip_badge': '👑 身份标识',
                            'photo_wall_unlimited': '📸 照片墙无限',
                            'large_file_upload': '⬆️ 大文件上传',
                            'pin_post': '📌 帖子置顶',
                            'custom_theme': '🎨 专属主题',
                            'profile_effects': '✨ 头像特效',
                            'pro_chat_bubble': '💬 聊天气泡',
                            'pro_post_style': '🪴 帖子卡片装饰'
                        };
                        var featNames = g.features.map(function(f) { return featureMap[f] || f; });
                        card += '<div class="pro-gift-card-features">' + featNames.map(function(n) {
                            return '<span class="pro-gift-card-feature">' + escapeHtml(n) + '</span>';
                        }).join('') + '</div>';
                    }
                    card += '</div>';
                    card += buttonHtml;
                    card += '</div></div>';
                    return card;
                }).join('');
            } catch(e) {
                renderEmpty('Pro 活动加载失败', '请稍后重试');
            }
        }

        // 领取 Pro 赠送活动
        window.claimProGift = async function(giftId) {
            if (!currentUser) { showToast('请先登录'); return; }
            var btn = document.querySelector('.pro-gift-claim-btn[data-gift-id="' + giftId + '"]');
            var card = document.querySelector('.pro-gift-card[data-gift-id="' + giftId + '"]');
            if (btn) {
                btn.classList.add('loading');
                btn.textContent = '领取中...';
            }
            try {
                var claimHeaders = { 'Content-Type': 'application/json' };
                var tok2 = await ensureUserToken();
                if (!tok2) {
                    if (btn) {
                        btn.classList.remove('loading');
                        btn.textContent = '领取 Pro';
                    }
                    showToast('登录凭证需要刷新，请重新登录后领取', 'error');
                    requestProGiftRelogin();
                    return;
                }
                claimHeaders['Authorization'] = 'Bearer ' + tok2;
                var resp = await fetch(API_BASE + '/api/pro-gifts/claim', {
                    method: 'POST',
                    headers: claimHeaders,
                    body: JSON.stringify({ user_name: currentUser, gift_id: giftId })
                });
                var data = await resp.json();
                if (resp.status === 401 || resp.status === 403) {
                    clearUserToken();
                    // token 过期，尝试补一次 token 后重试
                    var newTok2 = await ensureUserToken();
                    if (newTok2) {
                        claimHeaders['Authorization'] = 'Bearer ' + newTok2;
                        resp = await fetch(API_BASE + '/api/pro-gifts/claim', {
                            method: 'POST',
                            headers: claimHeaders,
                            body: JSON.stringify({ user_name: currentUser, gift_id: giftId })
                        });
                        data = await resp.json();
                        if (resp.status === 401 || resp.status === 403) {
                            clearUserToken();
                            if (btn) { btn.classList.remove('loading'); btn.textContent = '领取 Pro'; }
                            showToast((data && data.error) || '登录凭证需要刷新，请重新登录后领取', 'error');
                            return;
                        }
                        // 重试成功，继续处理
                    } else {
                        if (btn) { btn.classList.remove('loading'); btn.textContent = '领取 Pro'; }
                        showToast((data && data.error) || '登录凭证需要刷新，请重新登录后领取', 'error');
                        requestProGiftRelogin();
                        return;
                    }
                }
                if (data.ok) {
                    // 更新卡片状态
                    if (card) {
                        card.classList.add('claimed');
                        if (btn) btn.remove();
                        var infoDiv = card.querySelector('.pro-gift-card-info');
                        if (infoDiv && infoDiv.parentNode) {
                            var badge = document.createElement('div');
                            badge.className = 'pro-gift-claimed-badge';
                            badge.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>已领取';
                            infoDiv.parentNode.insertBefore(badge, infoDiv.nextSibling);
                        }
                    }
                    showToast('🎉 Pro 已激活至 ' + new Date(data.expire_at).toLocaleDateString());
                    // 刷新VIP状态和UI
                    if (typeof window.__xtjSaveLocalVip === 'function') {
                        window.__xtjSaveLocalVip(data);
                    }
                    ensureVipStatusFresh(true);
                    updateVipUI();
                    updateVipModalUI();
                    if (typeof window.__xtjApplyProTheme === 'function') {
                        window.__xtjApplyProTheme(true);
                    }
                    // 弹出庆祝动画
                    setTimeout(function() {
                        if (typeof window.__xtjShowProCelebration === 'function') {
                            window.__xtjShowProCelebration(data);
                        }
                    }, 300);
                    loadProGiftCampaigns();
                } else {
                    if (btn) {
                        btn.classList.remove('loading');
                        btn.textContent = '领取 Pro';
                    }
                    showToast(data.error || '领取失败', 'error');
                }
            } catch(e) {
                if (btn) {
                    btn.classList.remove('loading');
                    btn.textContent = '领取 Pro';
                }
                showToast('领取失败: ' + e.message, 'error');
            }
        };

        window.openVipModal = openVipModal;
        window.handleVipPurchase = handleVipPurchase;

        window.handleCancelPro = async function() {
            if (!currentUser) { showToast('请先登录'); return; }
            if (!__vipStatus.is_vip) { showToast('您还不是VIP会员'); return; }

            if (!confirm('确定取消 XTJ Pro 订阅吗？\n取消后VIP权益将立即失效。')) return;

            // 1. 清除本地VIP缓存
            if (typeof window.__xtjClearLocalVip === 'function') {
                window.__xtjClearLocalVip();
            }

            // 2. 尝试在Supabase标记取消
            if (window.sb) {
                try {
                    var { data: vipRows } = await window.sb.from('posts')
                        .select('id, content')
                        .eq('user_name', currentUser)
                        .eq('media_type', '__vip__')
                        .order('created_at', { ascending: false })
                        .limit(5);
                    if (vipRows && vipRows.length > 0) {
                        for (var i = 0; i < vipRows.length; i++) {
                            try {
                                var c = JSON.parse(vipRows[i].content || '{}');
                                if (c.is_active) {
                                    c.is_active = false;
                                    c.cancelled_at = new Date().toISOString();
                                    await window.sb.from('posts')
                                        .update({ content: JSON.stringify(c) })
                                        .eq('id', vipRows[i].id);
                                }
                            } catch(e) {}
                        }
                    }
                } catch(e) {
                    console.warn('[Pro] cancel supabase update failed', e);
                }
            }

            // 3. 重置VIP状态
            __vipStatus.is_vip = false;
            __vipStatus.vip_info = null;
            updateVipUI();
            updateVipModalUI();
            if (typeof window.__xtjApplyProTheme === 'function') window.__xtjApplyProTheme(false);

            // 4. 刷新帖子列表

            showToast('已取消 Pro 订阅');
        };

        function clearFeedCache() {
            try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
            feedVisiblePostsCache = null;
            feedMapsCache = null;
        }
        window.clearFeedCache = clearFeedCache;

        var __xtjScriptLoadRegistry = Object.create(null);
        function xtjLoadScriptOnce(src, key) {
            var loadKey = String(key || src || '').trim();
            if (!src || !loadKey) return Promise.reject(new Error('script_src_required'));
            if (__xtjScriptLoadRegistry[loadKey]) return __xtjScriptLoadRegistry[loadKey];
            __xtjScriptLoadRegistry[loadKey] = new Promise(function(resolve, reject) {
                var selector = 'script[data-xtj-script-key="' + loadKey.replace(/"/g, '\\"') + '"]';
                var existing = document.querySelector(selector);
                function handleLoaded(node) {
                    try {
                        node.dataset.xtjLoaded = '1';
                        node.dataset.xtjScriptKey = loadKey;
                    } catch (e) {}
                    resolve(node);
                }
                function handleFailed(err) {
                    delete __xtjScriptLoadRegistry[loadKey];
                    reject(err instanceof Error ? err : new Error(String(err || ('Failed to load ' + src))));
                }
                if (existing) {
                    if (existing.dataset.xtjLoaded === '1') {
                        resolve(existing);
                        return;
                    }
                    existing.addEventListener('load', function onLoad() {
                        existing.removeEventListener('load', onLoad);
                        handleLoaded(existing);
                    }, { once: true });
                    existing.addEventListener('error', function onError() {
                        existing.removeEventListener('error', onError);
                        handleFailed(new Error('Failed to load ' + src));
                    }, { once: true });
                    return;
                }
                var node = document.createElement('script');
                node.src = src;
                node.defer = true;
                node.dataset.xtjScriptKey = loadKey;
                node.onload = function() { handleLoaded(node); };
                node.onerror = function() { handleFailed(new Error('Failed to load ' + src)); };
                (document.body || document.head || document.documentElement).appendChild(node);
            });
            return __xtjScriptLoadRegistry[loadKey];
        }
        window.xtjLoadScriptOnce = xtjLoadScriptOnce;

        function xtjLoadScriptSequence(items) {
            return (items || []).reduce(function(chain, item) {
                return chain.then(function() {
                    return xtjLoadScriptOnce(item.src, item.key);
                });
            }, Promise.resolve());
        }

        var _photoWallLoaded = false;
        var _photoWallLoading = null;
        var _photoWallPreviewLoaded = false;
        var _photoWallPreviewLoading = null;
        var _photoWallUploadLoaded = false;
        var _photoWallUploadLoading = null;
        var _aiAgentLoaded = false;
        var _aiAgentLoading = null;
        var _englishLearningLoaded = false;
        var _englishLearningLoading = null;
        var _interactiveEnhancementsBooted = false;
        var _coreAnimationsLoaded = false;
        var _coreAnimationsLoading = null;

        function ensurePhotoWallLoaded() {
            if (_photoWallLoaded) return Promise.resolve();
            if (_photoWallLoading) return _photoWallLoading;
            _photoWallLoading = xtjLoadScriptSequence([
                { src: 'js/photo-wall/data.min.js?v=20260618_2', key: 'photo-wall-data' },
                { src: 'js/photo-wall/render.min.js?v=20260618_2', key: 'photo-wall-render' },
                { src: 'js/photo-wall/photo-wall.min.js?v=20260618_2', key: 'photo-wall-main' }
            ]).then(function() {
                _photoWallLoaded = true;
            }).finally(function() {
                if (!_photoWallLoaded) _photoWallLoading = null;
            });
            return _photoWallLoading;
        }

        function ensurePhotoWallPreviewLoaded() {
            if (_photoWallPreviewLoaded && typeof window.openPhotoPreview === 'function') return Promise.resolve();
            if (_photoWallPreviewLoading) return _photoWallPreviewLoading;
            _photoWallPreviewLoading = xtjLoadScriptSequence([
                { src: 'js/photo-wall/preview.min.js?v=20260627_hotfix_v22', key: 'photo-wall-preview' },
                { src: 'js/photo-wall/preview-hotfix.js?v=20260627_hotfix_v22', key: 'photo-wall-preview-hotfix' }
            ]).then(function() {
                _photoWallPreviewLoaded = true;
            }).finally(function() {
                if (!_photoWallPreviewLoaded) _photoWallPreviewLoading = null;
            });
            return _photoWallPreviewLoading;
        }

        function ensurePhotoWallUploadLoaded() {
            if (_photoWallUploadLoaded && typeof window.xtjUploadBtn === 'function' && window.xtjUploadBtn !== lazyPhotoUploadLauncher) return Promise.resolve();
            if (_photoWallUploadLoading) return _photoWallUploadLoading;
            _photoWallUploadLoading = xtjLoadScriptOnce('js/photo-wall/upload-ui.min.js?v=20260623_v2', 'photo-wall-upload-ui').then(function() {
                _photoWallUploadLoaded = true;
            }).finally(function() {
                if (!_photoWallUploadLoaded) _photoWallUploadLoading = null;
            });
            return _photoWallUploadLoading;
        }

        function ensureAiAgentLoaded() {
            if (_aiAgentLoaded && typeof window.__xtjOpenAiChat === 'function' && window.__xtjOpenAiChat !== lazyAiChatLauncher) return Promise.resolve();
            if (_aiAgentLoading) return _aiAgentLoading;
            _aiAgentLoading = xtjLoadScriptOnce('js/ai-agent.js?v=20260708_perf_v1', 'ai-agent').then(function() {
                _aiAgentLoaded = true;
            }).finally(function() {
                if (!_aiAgentLoaded) _aiAgentLoading = null;
            });
            return _aiAgentLoading;
        }
        window.__xtjEnsureAiAgentLoaded = ensureAiAgentLoaded;

        function ensureEnglishLearningLoaded() {
            if (_englishLearningLoaded && window.EnglishLearning && typeof window.EnglishLearning.open === 'function') return Promise.resolve();
            if (_englishLearningLoading) return _englishLearningLoading;
            _englishLearningLoading = xtjLoadScriptSequence([
                { src: 'js/english-dict.js?v=20260708_perf_v1', key: 'english-dict' },
                { src: 'js/english-learning.js?v=20260708_perf_v1', key: 'english-learning' }
            ]).then(function() {
                _englishLearningLoaded = true;
            }).finally(function() {
                if (!_englishLearningLoaded) _englishLearningLoading = null;
            });
            return _englishLearningLoading;
        }
        window.__xtjEnsureEnglishLearningLoaded = ensureEnglishLearningLoaded;

        function ensureCoreAnimationsLoaded() {
            if (_coreAnimationsLoaded) return Promise.resolve();
            if (_coreAnimationsLoading) return _coreAnimationsLoading;
            _coreAnimationsLoading = Promise.all([
                xtjLoadScriptOnce('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js', 'gsap'),
                xtjLoadScriptOnce('js/core-animations.js?v=20260708_perf_v1', 'core-animations')
            ]).then(function() {
                _coreAnimationsLoaded = true;
            }).finally(function() {
                if (!_coreAnimationsLoaded) _coreAnimationsLoading = null;
            });
            return _coreAnimationsLoading;
        }
        window.__xtjEnsureCoreAnimationsLoaded = ensureCoreAnimationsLoaded;

        function scheduleInteractiveEnhancements() {
            if (_interactiveEnhancementsBooted) return;
            _interactiveEnhancementsBooted = true;
            var run = function() {
                xtjLoadScriptSequence([
                    { src: 'js/login-device.js?v=20260629_abortfix_v1', key: 'login-device' },
                    { src: 'js/features.js?v=20260623_1', key: 'features' },
                    { src: 'js/ui-effects.js?v=20260708_perf_v1', key: 'ui-effects' },
                    { src: 'js/pro-upgrade.js?v=20260627_profile_v3', key: 'pro-upgrade' },
                    { src: 'js/pro-style.js?v=20260708_perf_v1', key: 'pro-style' }
                ]).catch(function(err) {
                    console.warn('[XTJ] deferred enhancement load failed:', err && err.message ? err.message : err);
                });
            };
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(run, { timeout: 2200 });
            } else {
                setTimeout(run, 1200);
            }
        }

        function armCoreAnimationLoader() {
            var fired = false;
            function trigger() {
                if (fired) return;
                fired = true;
                document.removeEventListener('pointerdown', trigger, true);
                document.removeEventListener('keydown', trigger, true);
                if (typeof window.requestIdleCallback === 'function') {
                    window.requestIdleCallback(function() {
                        ensureCoreAnimationsLoaded().catch(function() {});
                    }, { timeout: 2500 });
                } else {
                    setTimeout(function() { ensureCoreAnimationsLoaded().catch(function() {}); }, 1500);
                }
            }
            document.addEventListener('pointerdown', trigger, true);
            document.addEventListener('keydown', trigger, true);
            setTimeout(trigger, 3500);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scheduleInteractiveEnhancements, { once: true });
        } else {
            scheduleInteractiveEnhancements();
        }
        armCoreAnimationLoader();

        function lazyAiChatLauncher() {
            ensureAiAgentLoaded().then(function() {
                if (typeof window.__xtjOpenAiChat === 'function' && window.__xtjOpenAiChat !== lazyAiChatLauncher) {
                    window.__xtjOpenAiChat();
                }
            }).catch(function(err) {
                if (typeof window.showToast === 'function') window.showToast('AI 模块加载失败，请稍后重试');
                console.error('[XTJ] ai-agent lazy load failed:', err);
            });
        }
        window.__xtjOpenAiChat = lazyAiChatLauncher;

        function lazyEnglishLearningLauncher() {
            ensureEnglishLearningLoaded().then(function() {
                if (window.EnglishLearning && typeof window.EnglishLearning.open === 'function') {
                    window.EnglishLearning.open();
                }
            }).catch(function(err) {
                if (typeof window.showToast === 'function') window.showToast('英语学习模块加载失败，请稍后重试');
                console.error('[XTJ] english-learning lazy load failed:', err);
            });
        }
        window.__xtjOpenEnglishLearning = lazyEnglishLearningLauncher;

        function lazyPhotoUploadLauncher() {
            ensurePhotoWallUploadLoaded().then(function() {
                if (typeof window.xtjUploadBtn === 'function' && window.xtjUploadBtn !== lazyPhotoUploadLauncher) {
                    window.xtjUploadBtn();
                }
            }).catch(function(err) {
                if (typeof window.showToast === 'function') window.showToast('上传模块加载失败，请稍后重试');
                console.error('[XTJ] photo upload lazy load failed:', err);
            });
        }
        function lazyPhotoWallSubmitLauncher() {
            ensurePhotoWallUploadLoaded().then(function() {
                if (typeof window.triggerPhotoWallUpload === 'function' && window.triggerPhotoWallUpload !== lazyPhotoWallSubmitLauncher) {
                    window.triggerPhotoWallUpload();
                }
            }).catch(function(err) {
                if (typeof window.showToast === 'function') window.showToast('上传模块加载失败，请稍后重试');
                console.error('[XTJ] photo upload submit lazy load failed:', err);
            });
        }
        window.xtjUploadBtn = lazyPhotoUploadLauncher;
        window.triggerPhotoUpload = lazyPhotoUploadLauncher;
        window.triggerPhotoWallUpload = lazyPhotoWallSubmitLauncher;

        function lazyOpenPhotoPreview() {
            var args = Array.prototype.slice.call(arguments);
            return ensurePhotoWallPreviewLoaded().then(function() {
                if (typeof window.openPhotoPreview === 'function' && window.openPhotoPreview !== lazyOpenPhotoPreview) {
                    return window.openPhotoPreview.apply(window, args);
                }
            }).catch(function(err) {
                console.error('[XTJ] photo preview lazy load failed:', err);
            });
        }
        if (typeof window.openPhotoPreview !== 'function') {
            window.openPhotoPreview = lazyOpenPhotoPreview;
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
            if (!currentUser) return false;
            if (isAdmin()) return true;
            if (isVipUser()) return true;
            return false;
        }
        window.canPinPost = canPinPost;

        // Check if user can pin this specific post (own post limit: 1 per VIP)
        async function canPinThisPost(post) {
            if (isAdmin()) return true;
            if (!isVipUser()) return false;
            var p = normalizePost(post);
            if (!p || p.user_name !== currentUser) return false;
            try {
                if (!sb) return false;
                var { data: pinnedPosts } = await sb.from('posts')
                    .select('id')
                    .eq('user_name', currentUser)
                    .eq('is_pinned', true);
                return !pinnedPosts || pinnedPosts.length < 1;
            } catch(e) { return false; }
        }

        function canDeletePost(post) {
            var p = normalizePost(post);
            if (!currentUser) return false;
            if (isAdmin()) return true;
            if (p.user_name && p.user_name === currentUser) return true;
            return !p.user_name && !!deviceId && !!p.actor_key && p.actor_key === deviceId;
        }
        window.canDeletePost = canDeletePost;
        window.isAdmin = isAdmin;

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
                if (typeof isSystemPost === 'function' && isSystemPost(post)) return false;
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

        // ========== 应用状态（向后兼容） ==========
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

        function showToast(message, type) {
            const container = document.getElementById('toastContainer');
            if (!container) { console.warn("showToast: toastContainer not found"); return; }
            const toast = document.createElement('div');
            toast.className = 'toast' + (type === 'error' ? ' toast-error' : '');
            if (typeof window.__xtjUiTextRepair === 'function') {
                try { var _repaired = window.__xtjUiTextRepair(message); if (_repaired != null) message = _repaired; } catch (e) {}
            }
            toast.textContent = message == null ? '' : String(message);
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'toastFade 0.3s ease-out forwards';
                setTimeout(() => toast.remove(), 300);
            }, type === 'error' ? 4000 : 2500);
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
            
            // FLIP Animation: Step 3 - Invert (计算反转偏移)
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
                    
                    // FLIP Animation for Close: 获取删除按钮前位置
                    var dialogRect = dialog.getBoundingClientRect();
                    
                    // 获取删除按钮前位置
                    var deleteBtn = document.getElementById('ppDeleteBtn');
                    var btnRect = deleteBtn ? deleteBtn.getBoundingClientRect() : null;
                    
                    var targetDx = o.dx;
                    var targetDy = o.dy;
                    var targetScale = o.scale || 0.3;
                    
                    if (btnRect) {
                        // 使用按钮前位置，计算变换
                        targetDx = btnRect.left + btnRect.width / 2 - dialogRect.left - dialogRect.width / 2;
                        targetDy = btnRect.top + btnRect.height / 2 - dialogRect.top - dialogRect.height / 2;
                        
                        var btnSize = Math.sqrt(btnRect.width * btnRect.width + btnRect.height * btnRect.height);
                        var dialogSize = Math.sqrt(dialogRect.width * dialogRect.width + dialogRect.height * dialogRect.height);
                        targetScale = btnSize / dialogSize * 0.6;
                    }
                    
                    // Step 3 - Invert: 计算飞回偏移
                    dialog.style.transition = 'none';
                    dialog.style.transform = 'translate(0, 0) scale(1)';
                    dialog.style.opacity = '1';
                    void dialog.offsetHeight;
                    
                    // Step 4 - Play: 播放飞回动画
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

            // ===================== 密码哈希（PBKDF2） =====================
            // 使用 PBKDF2-SHA256，100000 次迭代，16字节随机盐
            // 存储格式：盐(hex):哈希(hex)，如 "a1b2c3...:d4e5f6..."
            async function pbkdf2Hash(password, salt) {
                const enc = new TextEncoder();
                const keyMaterial = await crypto.subtle.importKey(
                    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
                );
                const bits = await crypto.subtle.deriveBits(
                    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
                    keyMaterial, 256
                );
                return Array.from(new Uint8Array(bits)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
            }
            async function hashPasswordWithSalt(password, _username) {
                var saltBytes = crypto.getRandomValues(new Uint8Array(16));
                var salt = Array.from(saltBytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                var hash = await pbkdf2Hash(password, salt);
                return salt + ':' + hash;
            }
            // 验证密码：支持 PBKDF2（新格式 salt:hash）和旧版 SHA-256 回退
            async function verifyPassword(inputPw, stored, _username) {
                if (!inputPw || !stored) return false;
                // PBKDF2 格式：salt:hash
                if (stored.indexOf(':') !== -1) {
                    var parts = stored.split(':');
                    var inputHash = await pbkdf2Hash(inputPw, parts[0]);
                    return inputHash === parts[1];
                }
                // 回退旧版 SHA-256（无盐或用户名为盐）
                var enc = new TextEncoder();
                var buf = await crypto.subtle.digest('SHA-256', enc.encode(inputPw));
                var oldHash = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                if (oldHash === stored) return true;
                // 旧版用户名为盐
                if (_username) {
                    var saltedBuf = await crypto.subtle.digest('SHA-256', enc.encode(_username + ':' + inputPw));
                    var saltedHash = Array.from(new Uint8Array(saltedBuf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                    return saltedHash === stored;
                }
                return false;
            }

            // ===================== 闁谎嗩嚙缂?/ 婵炲鍔岄崬?/ 闁谎嗩嚙閸?=====================
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
                    var { data, error } = await sb.rpc('get_user_restrictions', { p_user_name: currentUser });
                    if (error) { return; }
                    var prev = JSON.stringify(userRestrictions);
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
                return userRestrictions.is_muted && currentUser !== ADMIN_NAME;
            }

            function isUserBlocked() {
                return (userRestrictions.is_blacklisted || userRestrictions.is_banned) && currentUser !== ADMIN_NAME;
            }

            function startRestrictionPolling() {
                stopRestrictionPolling();
                checkUserRestrictions();
                updateVipStatus();
                restrictionPollTimer = setInterval(function() {
                    checkUserRestrictions();
                    updateVipStatus();
                }, RESTRICTION_POLL_INTERVAL);
            }

            function stopRestrictionPolling() {
                if (restrictionPollTimer) { clearInterval(restrictionPollTimer); restrictionPollTimer = null; }
            }

            async function findAuthRecord(nickname) {
                const { data } = await sb.from("posts")
                    .select("id, user_name, media_url")
                    .eq("user_name", nickname)
                    .eq("media_type", AUTH_MARKER)
                    .maybeSingle();
                return data;
            }

            async function saveUserInfo(name, isNewUser, email) {
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
                } catch(e) {
                    try { console.warn('[saveUserInfo] failed:', e && e.message); } catch(_) {}
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
                var data = await res.json();
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
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
                        try {
                            var loginRes = await apiCall('POST', '/admin/login', {
                                username: name,
                                password: pw
                            });
                            if (!loginRes || !loginRes.ok) {
                                showToast((loginRes && loginRes.error) || "管理员登录失败");
                                btn.disabled = false; btn.textContent = "登录";
                                return;
                            }
                            if (loginRes.token) {
                                localStorage.setItem(ADMIN_TOKEN_KEY, loginRes.token);
                            }
                            // ★ 管理员也写入 xtj_pw_hash，以便 AI 聊天等模块鉴权
                            try {
                                var adminAuthRec = await findAuthRecord(name);
                                if (adminAuthRec && adminAuthRec.media_url) {
            try { sessionStorage.setItem("xtj_pw_hash", adminAuthRec.media_url); } catch(e) {}
            try { localStorage.removeItem("xtj_pw_hash"); } catch(e) {}
                                }
                            } catch(e) { console.warn('[Admin] 写入 xtj_pw_hash 失败:', e); }
                        } catch (apiErr) {
                            showToast("管理员登录失败: 无法连接后端 API");
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
                        var pwOk = await verifyPassword(pw, authRec.media_url, name);
                        if (!pwOk) {
                            showToast("密码错误");
                            btn.disabled = false; btn.textContent = "登录";
                            return;
                        }
            try { sessionStorage.setItem("xtj_pw_hash", authRec.media_url); } catch(e) {}
            try { localStorage.removeItem("xtj_pw_hash"); } catch(e) {}
                    }

                    // 获取 JWT token（替代 password_hash 认证）
                    // ★ 关键修复：拿不到 token 时也要继续登录流程，但 console.warn 提示
                    //   AI 模块会用 ensureRealUserAuth 主动补救
                    try {
                        var _pwHash = sessionStorage.getItem("xtj_pw_hash") || "";
                        if (_pwHash && API_BASE) {
                            var tokenRes = await fetch(API_BASE + '/api/user/login', {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ user_name: name, password_hash: _pwHash })
                            });
                            if (tokenRes.ok) {
                                var tokenData = await tokenRes.json().catch(function(){ return {}; });
                                if (tokenData && tokenData.token) {
                                    setUserToken(tokenData.token);
                                } else {
                                    try { console.warn('[AUTH] login /api/user/login ok but no token in response'); } catch(e) {}
                                }
                            } else {
                                try { console.warn('[AUTH] login /api/user/login failed, status =', tokenRes.status); } catch(e) {}
                            }
                        } else if (!_pwHash) {
                            try { console.warn('[AUTH] login: no password_hash, skip token fetch'); } catch(e) {}
                        } else if (name === ADMIN_NAME) {
                            try { console.warn('[AUTH] login: admin user, skip token fetch'); } catch(e) {}
                        } else if (!API_BASE) {
                            try { console.warn('[AUTH] login: no API_BASE, skip token fetch'); } catch(e) {}
                        }
                    } catch(e) { try { console.warn('[AUTH] login token fetch exception:', e && e.message); } catch(e2) {} }

                    currentUser = name;
                    window.currentUser = currentUser;
                    localStorage.setItem("xtj_user", currentUser);
                    writeUserSession(currentUser, { resetLoginAt: true });
                    try {
                        if (typeof window.logLoginEventSafe === "function" && name !== ADMIN_NAME) {
                            window.logLoginEventSafe(name);
                        }
                    } catch(e) {}
                    showToast("登录成功，欢迎回来！" + name);
                    closeModal('loginModal');

                    // 更新闁哄牃鍋撻弶鈺傚灩濞呫儴銇愭洘锟筋槯闂?
                    await saveUserInfo(name, false);

                    await initUI();
                    initialLoad(true);
                    await resolvePendingProRelogin();
                    try { if (typeof window.updateProStyle === 'function') window.updateProStyle(currentUser); } catch(e) {}
                    // 记录用户访问
                    logUserVisitToApi(name);

                    // 公告已读：拉取远端已读记录，跨设备同步红点
                    try {
                        if (typeof window.loadRemoteAnnouncementReads === 'function') {
                            await window.loadRemoteAnnouncementReads();
                            if (typeof window.updateAnnouncementBadge === 'function') {
                                window.updateAnnouncementBadge();
                            }
                        }
                    } catch (e) { console.warn('[ann_read_sync_login]', e); }
                } catch (e) {
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
                if (e.key === 'Enter') document.getElementById('regEmailInp').focus();
            });
            document.getElementById('regEmailInp').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') document.getElementById('regPwInp').focus();
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
                    const existing = await findAuthRecord(name);
                    if (existing) {
                        showToast("昵称 '" + name + "' 已被注册，请换一个");
                        btn.disabled = false; btn.textContent = "注册中..";
                        return;
                    }

                    const pwHash = await hashPasswordWithSalt(pw, name);
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
            try { sessionStorage.setItem("xtj_pw_hash", pwHash); } catch(e) {}
            try { localStorage.removeItem("xtj_pw_hash"); } catch(e) {}
                    // 获取 JWT token（替代 password_hash 认证）
                    // ★ 关键修复：拿不到 token 时也要继续注册流程，但 console.warn 提示
                    try {
                        if (API_BASE) {
                            var _regTokenRes = await fetch(API_BASE + '/api/user/login', {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ user_name: name, password_hash: pwHash })
                            });
                            if (_regTokenRes.ok) {
                                var _regTokenData = await _regTokenRes.json().catch(function(){ return {}; });
                                if (_regTokenData && _regTokenData.token) {
                                    setUserToken(_regTokenData.token);
                                } else {
                                    try { console.warn('[AUTH] register /api/user/login ok but no token in response'); } catch(e) {}
                                }
                            } else {
                                try { console.warn('[AUTH] register /api/user/login failed, status =', _regTokenRes.status); } catch(e) {}
                            }
                        } else {
                            try { console.warn('[AUTH] register: no API_BASE, skip token fetch'); } catch(e) {}
                        }
                    } catch(e) { try { console.warn('[AUTH] register token fetch exception:', e && e.message); } catch(e2) {} }
                    writeUserSession(currentUser, { resetLoginAt: true });
                    try {
                        if (typeof window.logLoginEventSafe === "function") {
                            window.logLoginEventSafe(name, "register_success");
                        }
                    } catch(e) {}
                    showToast("注册成功，欢迎你！" + name);
                    closeModal('registerModal');

                    // 濞ｅ洦绻傞悺銊╂偨閵婏箑鐓曟繛澶堝妼閸炶姤空遍鐟板⒉濞?
                    await saveUserInfo(name, true, email);

                    await initUI();
                    initialLoad(true);
                    await resolvePendingProRelogin();
                    try { if (typeof window.updateProStyle === 'function') window.updateProStyle(currentUser); } catch(e) {}
                    // 记录用户访问
                    logUserVisitToApi(name);

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

            // ========== 查看用户资料卡 ==========
            let upcTargetUser = null;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '最近登录：加载中...';
                
                var avatarEl = document.getElementById('upcAvatar');
                // localStorage 取头像缓存，失败用字母占位
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
                    avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(showAvatar)) + '" alt="头像">';
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
                
                // 瀵倹加载头像閸滃瞼娅ヨぐ鏇熸??
                try {
                    // 褰撳墠用户浼樺厛浣跨敤localStorage闂佸搫顦崯顐﹀煝婢跺瞼澶勯悗?
                    if (userName === currentUser) {
                        try {
                            var cv = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            if (cv[currentUser]) {
                                avatarCache[currentUser] = cv[currentUser];
                                if (document.getElementById('userProfileModal').classList.contains('active')) {
                                    avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(cv[currentUser])) + '" alt="头像">';
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
                        // 非当前用户才用DB閸婂吋娲块弬鎵处鐎涙﹫绱欓敓鏂ゆ嫹鍓嶉敓鐭紮鎷峰鎻掓躬娑撳﹪娼伴悽鈺╫calStorage设置閿?
                        if (userName !== currentUser) {
                            avatarCache[userName] = avatarRes.data[0].media_url;
                        } else if (!avatarCache[currentUser]) {
                            avatarCache[currentUser] = avatarRes.data[0].media_url;
                        }
                        if (document.getElementById('userProfileModal').classList.contains('active')) {
                            var url = (userName === currentUser && avatarCache[currentUser]) ? avatarCache[currentUser] : avatarRes.data[0].media_url;
                            avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(url)) + '" alt="头像">';
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
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                closeModal('userProfileModal');
                setTimeout(function() { openChat(upcTargetUser); }, 300);
            };

            // ========== 娑撴眽璧勬枡璇︽儏功能 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 濠靛鍋勯崢鏍春閻戞ɑ鎷卞ǎ鍥ｅ墲浼?
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
                
                // localStorage鏉冿拷鈻夐敓鏂ゆ嫹閿熸枻鎷烽敍姘帥濡澁鎷烽弻銉︽拱閸︽壆绱﹂敓?
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(cachedAvatars[currentUser])) + '" alt="头像">';
                        return;
                    }
                } catch(e) {}
                
                // 鍏煎牏锟姐倝宕橀崨顓犳憼缂傛挸鐡ㄩ弰鍓э拷?
                if (avatarCache[currentUser]) {
                    avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(avatarCache[currentUser])) + '" alt="头像">';
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
                        var safeAvatarUrl = escapeHtml(sanitizeUrl(avatarRes.data[0].media_url));
                        avatarEl.innerHTML = '<img src="' + safeAvatarUrl + '" alt="头像">';
                        avatarCache[currentUser] = avatarRes.data[0].media_url;
                        // 閸氬本顒為柛鎺旀ocalStorage
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
                        // 浣匡拷锟?createImageBitmap 灏嗗浘锟斤拷顎帡鏁?缂傚倵鏅滈弬渚€宕欐潪鏉跨槣缂佹崘娉曢埢?
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
                                // fallback: 闂佹悶鍎抽崑銈夊焵椤戣棄浜鹃梺?canvas 缂傗晜鏂?
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
                    const path = buildStorageUploadPath('avatars', file.name);
                    
                    // 上传到 Supabase Storage
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
                    if (uploadErr) throw uploadErr;
                    
                    // 获取 Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // ★ 修复 B2：先插入新头像记录，成功后再删除旧记录
                    // 避免"旧头像已删但新头像插入失败"导致用户头像空
                    var { error } = await sb.from("posts").insert([{
                        user_name: currentUser,
                        content: "用户头像",
                        media_url: avatarUrl,
                        media_type: "__avatar__",
                        actor_key: "__avatar__"
                    }]);
                    
                    if (error) {
                        // 新头像插入失败——不删旧头像，保证用户至少有一个头像
                        showToast('上传失败: ' + error.message);
                        return;
                    }
                    
                    // 新头像插入成功，安全删除旧头像记录
                    var oldIds = await sb.from("posts")
                        .select("id")
                        .eq("user_name", currentUser)
                        .eq("media_type", "__avatar__")
                        .eq("actor_key", "__avatar__");
                    if (oldIds.data && oldIds.data.length > 1) {
                        for (var oi of oldIds.data) {
                            // 跳过刚插入的新记录（用 media_url 匹配）
                            if (String(oi.media_url) === String(avatarUrl)) continue;
                            try {
                                await sb.rpc('delete_post_with_actor', {
                                    p_post_id: oi.id,
                                    p_actor_key: '__avatar__'
                                });
                            } catch(e) {}
                        }
                    }
                    
                    avatarCache[currentUser] = avatarUrl;
                    // 保存到localStorage持久化存储
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
                var safeUrl = escapeHtml(sanitizeUrl(avatarUrl));
                if (!safeUrl) return;
                var imgHtml = '<img src="' + safeUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                var els = [
                    document.getElementById('profileAvatar'),
                    document.getElementById('myAvatar'),
                    document.getElementById('profileDetailAvatar'),
                    document.getElementById('upcAvatar')
                ];
                els.forEach(function(el) {
                    if (el) {
                        el.innerHTML = imgHtml;
                    }
                });
                document.querySelectorAll('#feed .post .avatar').forEach(function(el) {
                    var header = el.closest('.post-header');
                    if (header) {
                        var nameEl = header.querySelector('.user-name');
                        if (nameEl && nameEl.textContent === currentUser) {
                            el.innerHTML = imgHtml;
                        }
                    }
                });
                document.querySelectorAll('#dockChatMessages .chat-msg-avatar').forEach(function(el) {
                    if (el.closest('.chat-msg-row.sent')) {
                        el.innerHTML = imgHtml;
                    }
                });
                document.querySelectorAll('#dockChatList .chat-list-item').forEach(function(el) {
                    var nameEl = el.querySelector('.cli-name');
                    if (nameEl && nameEl.textContent === currentUser) {
                        var avEl = el.querySelector('.cli-avatar');
                        if (avEl) {
                            avEl.innerHTML = imgHtml;
                        }
                    }
                });
            }

            async function updateAllAvatars() {
                // 闁哄洤鐡ㄩ弻濠囧箣閹寸姵鐣卞銈囨暬濞间即鏌ｉ妸銉ヮ仼闁靛洦妫冨畷鎾圭疀閵壯咁槱localStorage闂佸搫顦崯顐﹀煝婢跺鍠橀柛蹇撶墳缁?
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                    if (cachedAvatars[currentUser]) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        const profileAvatar = document.getElementById('profileAvatar');
                        if (profileAvatar) {
                            profileAvatar.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(cachedAvatars[currentUser])) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
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
                            var safeProfileAvatarUrl = escapeHtml(sanitizeUrl(avatarRes.data[0].media_url));
                            profileAvatar.innerHTML = '<img src="' + safeProfileAvatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                            avatarCache[currentUser] = avatarRes.data[0].media_url;
                            // 閸氬本顒為柛鎺旀ocalStorage
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
                clearUserSessionStorage();
                // ★ 修复 M5：停止限制轮询（避免内存泄漏）
                stopRestrictionPolling();
                // ★ 修复 M1：清理所有用户相关的 localStorage 缓存
                // 避免用户A登出后用户B看到A的头像、VIP、已读消息等
                var xtjKeys = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (key && (key.indexOf('xtj_') === 0 || key.indexOf('xtj-') === 0)) {
                        xtjKeys.push(key);
                    }
                }
                xtjKeys.forEach(function(k) {
                    try { localStorage.removeItem(k); } catch(e) {}
                });
                // 也清理 sessionStorage 中的密码 hash
                try { sessionStorage.removeItem("xtj_pw_hash"); } catch(e) {}
                clearUserToken();
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
                // 退出登录时关闭 Pro 装扮二级页面 + 恢复主页面
                var proStylePage = document.getElementById('profileProStylePage');
                var profileMainView = document.getElementById('profileMainView');
                if (proStylePage) {
                    proStylePage.hidden = true;
                    proStylePage.classList.remove('active');
                }
                if (profileMainView) {
                    profileMainView.hidden = false;
                }
                showToast("已退出登录");
                await initUI();
                initialLoad(true);
                try { if (typeof window.updateProStyle === 'function') window.updateProStyle(''); } catch(e) {}
            };

            // 处理鎴戠殑椤甸潰锟矫伙拷卡片鐐癸拷??
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 鐎规瓕灏欙拷鈻嶉妷銊ｄ汗闁哄浂浜炵粣妤呭箥閹惧磭纾绘繛鎴炴尰閻晫鎸ч崟顒佺亹閻犲浄闄勯崕?
                    openProfileDetail();
                } else {
                    // 閺堫亞娅ヨぐ鏇窗閿熸触寮€纰夋嫹锟?娉ㄩ敓鏂ゆ嫹妞ょ敻锟?
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
                    || mediaType === '__revoked_token__';
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

            function dedupeProfileLikes(items) {
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
                    var titleText = escapeHtml(currentUser.user_metadata?.full_name || currentUser.email || '我') + (isLikes ? ' 点赞了这条帖子' : ' 评论了这条帖子');
                    var metaHtml = [
                        '<div class="profile-activity-record__meta">',
                        '<span class="profile-activity-record__time">' + new Date(item.created_at).toLocaleString() + '</span>',
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
                    if (likesRes.error) throw likesRes.error;
                    if (commentsRes.error) throw commentsRes.error;
                    if (postsCountRes.error) throw postsCountRes.error;
                    if (reportsRes && reportsRes.error) console.warn('reports load warning:', reportsRes.error);

                    profileActivityState.likes = dedupeProfileLikes(likesRes.data || []);
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
                    
                    // 更新鎴戠殑椤甸潰显示
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "查看资料";
                    
                    // 显示发布閸栧搫锟?
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 加载头像
                    loadUserAvatar();
                    await loadCurrentUserStyle();
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
                    
                    // 更新鎴戠殑椤甸潰显示閿涘牊婀櫥褰曪拷??
                    profileName.textContent = "未登录";
                    profileStatus.textContent = "点击登录";
                    
                    // 闅愯棌发布鍖哄煙
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 闂佹彃绉堕悿鍡椼仈锟?
                    var profileAvatar = document.getElementById('profileAvatar');
                    if (profileAvatar) {
                        profileAvatar.innerHTML = '?';
                    }
                    await loadCurrentUserStyle();
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

            // ===================== 点赞 =====================
            function getCurrentLikeIdentityValues() {
                var values = [];
                if (deviceId) values.push(String(deviceId));
                if (currentUser) values.push(String(currentUser));
                return Array.from(new Set(values.filter(Boolean)));
            }

            function makeLikeLookupKeys(postId, actorKey, userName) {
                var pid = String(postId || '');
                var keys = [];
                if (actorKey) keys.push(pid + '|' + String(actorKey));
                if (userName) keys.push(pid + '|' + String(userName));
                return Array.from(new Set(keys));
            }

            function isLikeOwnedByCurrentUser(like, postId) {
                if (!like) return false;
                if (postId != null && String(like.post_id || '') !== String(postId)) return false;
                if (currentUser && String(like.user_name || '') === String(currentUser)) return true;
                var actor = String(like.actor_key || '');
                if (!actor) return false;
                return getCurrentLikeIdentityValues().indexOf(actor) >= 0;
            }

            function isPostLikedByCurrentUser(likeUserMap, postId) {
                var keys = makeLikeLookupKeys(postId, deviceId, currentUser);
                for (var i = 0; i < keys.length; i++) {
                    if (likeUserMap && likeUserMap[keys[i]]) return true;
                }
                return false;
            }

            function setLikeButtonState(btn, liked) {
                if (!btn) return;
                btn.classList.toggle('liked', !!liked);
                btn.textContent = liked ? '已赞' : '点赞';
                btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
            }

            function persistFeedLikesCache() {
                try {
                    var raw = localStorage.getItem(CACHE_KEY);
                    if (!raw) return;
                    var parsed = JSON.parse(raw);
                    if (!parsed || typeof parsed !== 'object') return;
                    if (!parsed.data || typeof parsed.data !== 'object') parsed.data = {};
                    parsed.data.likes = Array.isArray(feedAllLikes) ? feedAllLikes : [];
                    parsed.timestamp = Date.now();
                    localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
                } catch (e) {}
            }

            function updateLikeStatsText(statsEl, liked) {
                if (!statsEl) return;
                var text = statsEl.textContent || '';
                var match = text.match(/点赞 (\d+)/);
                if (!match) return;
                var current = parseInt(match[1], 10) || 0;
                var next = liked ? current + 1 : Math.max(0, current - 1);
                statsEl.textContent = text.replace(/点赞 \d+/, '点赞 ' + next);
            }

            function updatePostLikeUi(postId, liked, likeRecord) {
                var pid = String(postId || '');
                if (!Array.isArray(feedAllLikes)) feedAllLikes = [];
                feedAllLikes = feedAllLikes.filter(function(item) {
                    return !isLikeOwnedByCurrentUser(item, pid);
                });
                if (liked) {
                    feedAllLikes.push(likeRecord || {
                        post_id: pid,
                        user_name: currentUser,
                        actor_key: deviceId
                    });
                }
                persistFeedLikesCache();

                document.querySelectorAll('.post[data-post-id]').forEach(function(postEl) {
                    if (String(postEl.getAttribute('data-post-id') || '') !== pid) return;
                    var likeBtn = postEl.querySelector('.actions .action-btn');
                    var statsEl = postEl.querySelector('.post-stats-text');
                    setLikeButtonState(likeBtn, liked);
                    updateLikeStatsText(statsEl, liked);
                });
            }
            var likeStatRefreshTimer = null;
            function scheduleLikeStatRefresh() {
                var modal = document.getElementById('statModal');
                if (!modal || !modal.classList.contains('active') || statCurrentType !== 'likes') return;
                if (likeStatRefreshTimer) clearTimeout(likeStatRefreshTimer);
                likeStatRefreshTimer = setTimeout(function() {
                    likeStatRefreshTimer = null;
                    refreshStatModal();
                }, 300);
            }

            window.toggleLike = async function (btn, postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法互动"); return; }
                if (!btn || btn.dataset.likePending === '1') return;
                var wasLiked = btn.classList.contains("liked");
                btn.dataset.likePending = '1';
                btn.disabled = true;

                try {
                    var nextLiked = !wasLiked;
                    var optimisticLikeRecord = { post_id: postId, user_name: currentUser, actor_key: deviceId };
                    updatePostLikeUi(postId, nextLiked, optimisticLikeRecord);
                    updateFeedStats();
                    if (wasLiked) {
                        var deleteQuery = sb.from("likes").delete().eq("post_id", postId);
                        var currentIds = getCurrentLikeIdentityValues();
                        var orParts = [];
                        if (currentUser) orParts.push('user_name.eq.' + currentUser);
                        currentIds.forEach(function(value) {
                            orParts.push('actor_key.eq.' + value);
                        });
                        if (orParts.length) {
                            await deleteQuery.or(orParts.join(','));
                        } else {
                            await deleteQuery.eq("actor_key", deviceId);
                        }
                    } else {
                        await sb.from("likes").insert([optimisticLikeRecord]);
                        createHeartParticles(btn);
                    }
                    touchUserSession(false);
                    scheduleLikeStatRefresh();
                    if (currentDockTab === 'profile' && typeof loadProfileActivity === 'function') {
                        loadProfileActivity(true);
                    }
                } catch (e) {
                    console.error(e);
                    updatePostLikeUi(postId, wasLiked);
                    updateFeedStats();
                    scheduleLikeStatRefresh();
                    showToast('点赞操作失败');
                } finally {
                    setLikeButtonState(btn, btn.classList.contains('liked'));
                    btn.disabled = false;
                    delete btn.dataset.likePending;
                }
            };

            function createHeartParticles(btn) {
                var perfProfile = window.__xtjPerfProfile || 'full';
                if (perfProfile === 'lite') return;
                if (typeof xtjHeartBurst === 'function') {
                    xtjHeartBurst(btn);
                }
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                const emojis = ["❤️","💜","💙","💚","💛","🧡"];
                const burstCount = perfProfile === 'balanced' ? 4 : 8;
                for (let i=0; i<burstCount; i++) {
                    const heart = document.createElement('div');
                    heart.className = 'heart-particle';
                    heart.textContent = emojis[Math.floor(Math.random()*emojis.length)];
                    const angle = (Math.PI*2*i/burstCount) + (Math.random()-0.5)*0.4;
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
            const POST_ACTION_MODAL_IDS = ['commentModal', 'editPostModal', 'delModal'];

            function resetCommentModalState() {
                var input = document.getElementById("commInp");
                var btn = document.getElementById("commBtn");
                activePostId = null;
                if (input) input.value = "";
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "发布评论";
                }
            }

            function resetEditModalState() {
                var btn = document.getElementById("saveEditPostBtn");
                var visWrap = document.getElementById("editPostVisibility");
                editPostId = null;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
                    btn.classList.remove("is-submitting");
                    btn.classList.remove("is-success");
                }
                if (visWrap) {
                    visWrap.classList.remove("is-switching");
                    visWrap.classList.remove("is-saved");
                }
            }

            function clearPostActionConfirmOverlay() {
                var overlay = document.getElementById('ppConfirmOverlay');
                var okBtn = document.getElementById('ppConfirmOkBtn');
                if (!overlay) return;
                if (overlay._closeTimer) {
                    clearTimeout(overlay._closeTimer);
                    overlay._closeTimer = null;
                }
                overlay.classList.remove('active');
                overlay.classList.remove('closing');
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.style.pointerEvents = '';
                overlay._ppDeleteOrigin = null;
                window._confirmCallback = null;
                if (okBtn) okBtn.disabled = false;
                var dialog = overlay.querySelector('.pp-confirm-dialog');
                if (dialog) {
                    dialog.style.transition = '';
                    dialog.style.transform = '';
                    dialog.style.opacity = '';
                    dialog.style.transformOrigin = '';
                }
            }

            function isPostActionModalId(id) {
                return POST_ACTION_MODAL_IDS.indexOf(String(id || '')) !== -1;
            }

            function forceClosePostActionModal(id) {
                var el = document.getElementById(id);
                if (el) {
                    el.classList.remove("active");
                    el.classList.remove("closing");
                    el.style.display = '';
                    el.style.pointerEvents = '';
                }
                if (id === 'commentModal') {
                    resetCommentModalState();
                } else if (id === 'editPostModal') {
                    resetEditModalState();
                } else if (id === 'delModal') {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: false, resetTarget: true });
                }
            }

            function closeOtherPostActionModals(exceptId) {
                POST_ACTION_MODAL_IDS.forEach(function(id) {
                    if (id !== exceptId) forceClosePostActionModal(id);
                });
                clearPostActionConfirmOverlay();
            }

            function resetPostActionModals() {
                closeOtherPostActionModals('');
            }

            window.openComment = function (postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                if (window.__xtjDeleteInProgress) {
                    if (Date.now() - window.__xtjDeleteStartTime > 12000) {
                        cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                    } else {
                        showToast("正在删除中，请稍后..");
                        return;
                    }
                }
                closeOtherPostActionModals('commentModal');
                activePostId = postId;
                var input = document.getElementById("commInp");
                if (input) input.value = "";
                openModal("commentModal");
                setTimeout(() => document.getElementById("commInp").focus(), 100);
            };
            var commBtn = document.getElementById("commBtn");
            if (commBtn) commBtn.onclick = async () => {
                if (isUserMuted()) { showToast("您已被禁言，无法发表评论"); return; }
                const content = document.getElementById("commInp").value.trim();
                if (!content) { showToast("请输入评论内容"); return; }
                const btn = document.getElementById("commBtn");
                btn.textContent = "提交中..";
                btn.disabled = true;
                try {
                    const { error } = await sb.from("comments").insert([{ post_id: activePostId, user_name: currentUser, content, actor_key: deviceId }]);
                    if (error) throw error;
                    touchUserSession(false);
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

            // ===================== 删除帖子 =====================
            // 用 window 挂载，确保不同 IIFE 共享
            if (typeof window.__xtjDeleteInProgress === 'undefined') window.__xtjDeleteInProgress = false;
            if (typeof window.__xtjDeleteStartTime === 'undefined') window.__xtjDeleteStartTime = 0;
            if (!window.__xtjDeleteSession) {
                window.__xtjDeleteSession = {
                    timeoutId: null,
                    postId: null,
                    ownerKey: null,
                    postEl: null,
                    originalOpacity: '',
                    originalPointerEvents: '',
                    originalFilter: ''
                };
            }
            function getDeleteSession() {
                return window.__xtjDeleteSession;
            }
            function restoreDeleteTargetVisual() {
                var session = getDeleteSession();
                if (!session.postEl) return;
                try { session.postEl.style.opacity = session.originalOpacity || ''; } catch (e) {}
                try { session.postEl.style.pointerEvents = session.originalPointerEvents || ''; } catch (e) {}
                try { session.postEl.style.filter = session.originalFilter || ''; } catch (e) {}
                session.postEl = null;
                session.originalOpacity = '';
                session.originalPointerEvents = '';
                session.originalFilter = '';
            }
            function resetDeleteButtonState() {
                var btn = document.getElementById("delBtn");
                if (!btn) return;
                try { btn.disabled = false; } catch (e) {}
                try { btn.textContent = "确认删除"; } catch (e) {}
            }
            function cleanupDeleteSession(options) {
                var opts = options || {};
                var session = getDeleteSession();
                if (session.timeoutId) {
                    clearTimeout(session.timeoutId);
                    session.timeoutId = null;
                }
                if (opts.restoreVisual !== false) {
                    restoreDeleteTargetVisual();
                } else {
                    session.postEl = null;
                    session.originalOpacity = '';
                    session.originalPointerEvents = '';
                    session.originalFilter = '';
                }
                if (opts.hideModal !== false) {
                    var modalEl = document.getElementById("delModal");
                    if (modalEl) modalEl.classList.remove("active");
                }
                if (opts.resetTarget !== false) {
                    delPostId = null;
                    delOwnerKey = null;
                    session.postId = null;
                    session.ownerKey = null;
                }
                resetDeleteButtonState();
                window.__xtjDeleteInProgress = false;
                window.__xtjDeleteStartTime = 0;
                if (opts.toast && typeof showToast === 'function') {
                    showToast(opts.toast);
                }
            }
            function findPostCardElement(postId) {
                return document.querySelector('.post[data-post-id="' + postId + '"]');
            }
            function removeDeletedPostFromFeed(postId) {
                if (!Array.isArray(feedAllPosts)) return;
                feedAllPosts = feedAllPosts.filter(function(post) {
                    return String(post.id) !== String(postId);
                });
            }
            window.openDelete = function (postId, ownerKey) {
                // ★ 入口强制解锁：超过 12 秒仍处于 in-progress 状态，强制重置（防卡死兜底）
                if (window.__xtjDeleteInProgress && Date.now() - window.__xtjDeleteStartTime > 12000) {
                    console.warn('[openDelete] 检测到上一次删除超时卡死，强制解锁');
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                if (window.__xtjDeleteInProgress) {
                    showToast("正在删除中，请稍后..");
                    return;
                }
                var targetPost = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(postId); });
                if (targetPost && !canDeletePost(targetPost)) {
                    showToast("无权删除这条帖子");
                    return;
                }
                delPostId = postId;
                delOwnerKey = ownerKey;
                var session = getDeleteSession();
                session.postId = postId;
                session.ownerKey = ownerKey;
                closeOtherPostActionModals('delModal');
                openModal("delModal");
            };
            var delBtn = document.getElementById("delBtn");
            if (delBtn) delBtn.onclick = async () => {
                if (!delPostId) return;
                // ★ 入口强制解锁（同 openDelete）
                if (window.__xtjDeleteInProgress && Date.now() - window.__xtjDeleteStartTime > 12000) {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                if (window.__xtjDeleteInProgress) return;
                const btn = document.getElementById("delBtn");
                const session = getDeleteSession();
                const targetPostId = String(delPostId);
                const currentPost = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === targetPostId; });
                if (!currentPost) {
                    cleanupDeleteSession({ toast: "帖子不存在或已被删除" });
                    if (typeof loadFeed === 'function') {
                        try { loadFeed(true); } catch (e) {}
                    }
                    return;
                }
                if (!canDeletePost(currentPost)) {
                    cleanupDeleteSession({ toast: "无权删除这条帖子" });
                    return;
                }
                window.__xtjDeleteInProgress = true;
                window.__xtjDeleteStartTime = Date.now();
                btn.disabled = true;
                btn.textContent = "删除中..";
                var finished = false;
                session.postEl = findPostCardElement(targetPostId);
                if (session.postEl) {
                    session.originalOpacity = session.postEl.style.opacity || '';
                    session.originalPointerEvents = session.postEl.style.pointerEvents || '';
                    session.originalFilter = session.postEl.style.filter || '';
                    session.postEl.style.opacity = '0.56';
                    session.postEl.style.pointerEvents = 'none';
                    session.postEl.style.filter = 'grayscale(0.08)';
                }
                session.timeoutId = setTimeout(function() {
                    if (finished) return;
                    console.warn('[delBtn] 删除超时');
                    finished = true;
                    cleanupDeleteSession({ toast: "删除超时，帖子可能已删除，请刷新查看" });
                    // 超时后强制后台刷新 feed（fire-and-forget）
                    if (typeof loadFeed === 'function') {
                        try { loadFeed(true); } catch (e) {}
                    }
                }, 10000);

                try {
                    const key = isAdmin() ? delOwnerKey : deviceId;
                    const rpcPromise = sb.rpc("delete_post_with_actor", {
                        p_post_id: targetPostId,
                        p_actor_key: key
                    });
                    const rpcTimeout = new Promise(function(_, reject) {
                        setTimeout(function() { reject(new Error('rpc_timeout')); }, 8000);
                    });
                    let rpcResult;
                    try {
                        rpcResult = await Promise.race([rpcPromise, rpcTimeout]);
                    } catch (raceErr) {
                        if (finished) return;
                        if (raceErr && raceErr.message === 'rpc_timeout') {
                            console.warn('[delBtn] RPC 超时');
                            finished = true;
                            cleanupDeleteSession({ toast: "删除请求超时，请刷新查看" });
                            if (typeof loadFeed === 'function') { try { loadFeed(true); } catch(e) {} }
                            return;
                        }
                        throw raceErr;
                    }
                    if (finished) return;
                    const error = rpcResult && rpcResult.error;
                    if (error) {
                        finished = true;
                        cleanupDeleteSession({ toast: "删除失败: " + (error.message || "未知错误") });
                        return;
                    }
                    removeDeletedPostFromFeed(targetPostId);
                    if (typeof clearFeedCache === 'function') {
                        try { clearFeedCache(); } catch (e) {}
                    }
                    if (session.postEl && session.postEl.parentNode) {
                        try { session.postEl.remove(); } catch (e) {}
                    }
                    // 同步更新帖子计数（DOM 已移除，sPosts 随之更新）
                    if (typeof updateFeedStats === 'function') {
                        try { updateFeedStats(); } catch (e) {}
                    }
                    finished = true;
                    cleanupDeleteSession({ restoreVisual: false, hideModal: true, resetTarget: true });
                    showToast("帖子已删除");
                    // 不再 await，fire-and-forget 后台刷新（用 setTimeout 0 让删除响应先回到 UI）
                    if (typeof loadFeed === 'function') {
                        try { setTimeout(function() { loadFeed(true); }, 0); } catch(e) {}
                    }
                } catch (e) {
                    if (finished) return;
                    console.error('[delBtn] 删除异常:', e);
                    finished = true;
                    cleanupDeleteSession({ toast: "删除帖子失败: " + (e && e.message || "未知错误") });
                } finally {
                    if (!finished) {
                        cleanupDeleteSession({ restoreVisual: true, hideModal: false, resetTarget: false });
                    }
                }
            };

            window.openModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                if (isPostActionModalId(id)) {
                    closeOtherPostActionModals(id);
                }
                el.style.display = '';
                el.classList.add("active");
            };

            window.closeModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                if (isPostActionModalId(id)) {
                    forceClosePostActionModal(id);
                } else {
                    el.classList.remove("active");
                }
                if (id === 'statModal' && statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }
            };
            resetPostActionModals();

            // ===================== 图片锟姐儳婀咃拷?=====================
            const ivZoomState = { scale: 1, tx: 0, ty: 0 };
            let ivIsZooming = false;
            let ivIsPanning = false;
            let ivLastDist = 0;
            let ivPanStartX = 0, ivPanStartY = 0;
            let ivStartTx = 0, ivStartTy = 0;
            let ivStartScale = 1;
            let ivPinchAnchorX = 0, ivPinchAnchorY = 0;
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

            function ivZoomAt(clientX, clientY, nextScale) {
                const oldScale = ivZoomState.scale || 1;
                const x = clientX == null ? window.innerWidth / 2 : clientX;
                const y = clientY == null ? window.innerHeight / 2 : clientY;
                const anchorX = (x - window.innerWidth / 2 - ivZoomState.tx) / oldScale;
                const anchorY = (y - window.innerHeight / 2 - ivZoomState.ty) / oldScale;
                ivZoomState.scale = Math.max(1, Math.min(6, nextScale));
                ivZoomState.tx = x - window.innerWidth / 2 - anchorX * ivZoomState.scale;
                ivZoomState.ty = y - window.innerHeight / 2 - anchorY * ivZoomState.scale;
                if (ivZoomState.scale <= 1.01) {
                    ivResetZoom(false);
                } else {
                    ivApplyTransform();
                    ivShowHint();
                }
            }

            function ivShowHint() {
                const h = document.getElementById('ivZoomHint');
                h.classList.add('show');
                clearTimeout(ivHintTimer);
                ivHintTimer = setTimeout(() => h.classList.remove('show'), 2000);
            }

            function buildPostPreviewItemFromTrigger(src, triggerEl) {
                var el = triggerEl && triggerEl.getAttribute ? triggerEl : null;
                if (!el) return null;
                var postId = String(el.getAttribute('data-post-id') || '').trim();
                if (!postId) return null;
                var userName = String(el.getAttribute('data-post-user') || '').trim();
                var createdAt = String(el.getAttribute('data-post-created-at') || '').trim();
                var views = Number(el.getAttribute('data-post-views') || 0) || 0;
                var fileSize = Number(el.getAttribute('data-file-size') || 0) || null;
                var originalSize = Number(el.getAttribute('data-original-size') || 0) || null;
                return {
                    id: 'post_' + postId,
                    imageUrl: sanitizeUrl(src || el.getAttribute('src') || ''),
                    thumbUrl: sanitizeUrl(src || el.getAttribute('src') || ''),
                    username: userName || '',
                    timestamp: createdAt || '',
                    views: views,
                    fileSize: fileSize,
                    originalSize: originalSize,
                    __xtjSource: 'post',
                    __xtjPostId: postId,
                    __xtjActorKey: String(el.getAttribute('data-actor-key') || ''),
                    __xtjCanDelete: String(el.getAttribute('data-can-delete') || '') === '1'
                };
            }

            function syncPostPhotoPreviewChrome(photo) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay) return;
                var isPostPhoto = !!(photo && photo.__xtjSource === 'post');
                overlay.classList.toggle('pp-post-mode', isPostPhoto);
                var prevBtn = document.getElementById('ppPrevBtn');
                var nextBtn = document.getElementById('ppNextBtn');
                if (prevBtn) prevBtn.style.display = isPostPhoto ? 'none' : '';
                if (nextBtn) nextBtn.style.display = isPostPhoto ? 'none' : '';
                var deleteBtn = document.getElementById('ppDeleteBtn');
                if (deleteBtn && isPostPhoto) {
                    deleteBtn.style.display = photo.__xtjCanDelete ? 'flex' : 'none';
                    deleteBtn.title = '删除帖子';
                }
            }

            function ensurePhotoPreviewContextHooks() {
                if (window.__xtjPhotoPreviewContextHooked) return;
                if (typeof window.closePhotoPreview !== 'function') return;
                var originalClosePhotoPreview = window.closePhotoPreview;
                window.closePhotoPreview = function() {
                    var overlay = document.getElementById('photoPreviewOverlay');
                    if (overlay) overlay.classList.remove('pp-post-mode');
                    window.__xtjPhotoPreviewContext = null;
                    return originalClosePhotoPreview.apply(this, arguments);
                };
                window.__xtjPhotoPreviewContextHooked = true;
            }

            function openPostImagePreview(src, triggerEl) {
                var photo = buildPostPreviewItemFromTrigger(src, triggerEl);
                if (!photo || !photo.imageUrl || typeof window.openPhotoPreview !== 'function') return false;
                ensurePhotoPreviewContextHooks();
                if (typeof window.closeImageViewer === 'function') {
                    try { window.closeImageViewer(); } catch (e) {}
                }
                window.__xtjPhotoPreviewContext = {
                    kind: 'post',
                    postId: photo.__xtjPostId,
                    actorKey: photo.__xtjActorKey || '',
                    canDelete: !!photo.__xtjCanDelete
                };
                window.openPhotoPreview(0, { photos: [photo], originEl: triggerEl && triggerEl.getBoundingClientRect ? triggerEl : null });
                window.photoPreviewCurrent = photo;
                setTimeout(function() {
                    syncPostPhotoPreviewChrome(photo);
                }, 30);
                return true;
            }
            window.openPostImagePreview = openPostImagePreview;

            window.openImageViewer = function (src, triggerEl) {
                function fallbackOpen() {
                    if (typeof window.forceClosePhotoPreview === 'function') {
                        try { window.forceClosePhotoPreview(); } catch (e) {}
                    } else if (typeof window.closePhotoPreview === 'function') {
                        try { window.closePhotoPreview(); } catch (e) {}
                    }
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
                }
                if ((typeof window.openPhotoPreview !== 'function' || window.openPhotoPreview === lazyOpenPhotoPreview) && typeof ensurePhotoWallPreviewLoaded === 'function') {
                    ensurePhotoWallPreviewLoaded().then(function() {
                        if (!openPostImagePreview(src, triggerEl)) fallbackOpen();
                    }).catch(function() {
                        fallbackOpen();
                    });
                    return;
                }
                if (openPostImagePreview(src, triggerEl)) return;
                fallbackOpen();
            };

            window.closeImageViewer = function () {
                const viewer = document.getElementById('imgViewer');
                const wrapper = document.getElementById('ivWrapper');
                ivResetZoom(true);
                wrapper.classList.remove('open-anim');
                viewer.classList.remove('active');
                document.body.style.overflow = '';
            };

            window.deleteCurrentPhoto = function() {
                var ctx = window.__xtjPhotoPreviewContext || null;
                var current = window.photoPreviewCurrent || null;
                if (ctx && ctx.kind === 'post' && current && current.__xtjSource === 'post') {
                    if (!ctx.canDelete) {
                        showToast('仅发布者可删除');
                        return;
                    }
                    if (typeof window.closePhotoPreview === 'function') window.closePhotoPreview();
                    setTimeout(function() {
                        openDelete(ctx.postId, ctx.actorKey || '');
                    }, 60);
                    return;
                }
                if (typeof window.deletePhotoFromPreview === 'function') {
                    window.deletePhotoFromPreview();
                }
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
                    const cx = (t[0].clientX + t[1].clientX) / 2;
                    const cy = (t[0].clientY + t[1].clientY) / 2;
                    ivPinchAnchorX = (cx - window.innerWidth / 2 - ivStartTx) / ivStartScale;
                    ivPinchAnchorY = (cy - window.innerHeight / 2 - ivStartTy) / ivStartScale;
                    ivImgEl.classList.add('instant');
                } else if (e.touches.length === 1) {
                    const now = Date.now();
                    if (now - ivLastTapTime < 320) {
                        clearTimeout(ivDoubleTapTimer);
                        ivLastTapTime = 0;
                        if (ivZoomState.scale > 1.5) {
                            ivResetZoom(false);
                        } else {
                            ivZoomAt(e.touches[0].clientX, e.touches[0].clientY, 2.5);
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
                    ivZoomState.scale = newScale;
                    ivZoomState.tx = cx - window.innerWidth / 2 - ivPinchAnchorX * newScale;
                    ivZoomState.ty = cy - window.innerHeight / 2 - ivPinchAnchorY * newScale;
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

            // ===================== 濞村繗顫嶉梺鎻掔箳缁櫣锟?=====================
            // 閸忋劌锟斤拷帖子锟解剝浼呴敓鏂ゆ嫹閿熸枻鎷烽敍宀€鏁ゆ禍搴㈢セ鐟欏牐顔囬敓?
            const postInfoCache = {};
            const VIEW_HISTORY_KEY = 'xtj_view_history';
            const VIEW_TRACK_TTL = 5 * 60 * 1000;
            const VIEW_HISTORY_MEDIA_LABEL = '(\u56fe\u7247/\u89c6\u9891)';
            const VIEW_HISTORY_DELETED_AUTHOR = '\u5df2\u5220\u9664\u7528\u6237';

            function normalizeViewHistoryText(value, fallback) {
                var text = String(value == null ? '' : value).trim();
                if (!text) return fallback;
                if (text.indexOf('閸ュ墽澧') !== -1 || text.indexOf('瑙嗛') !== -1 || text.indexOf('闁搞儱澧') !== -1 || text.indexOf('閻熸瑥妫') !== -1) return VIEW_HISTORY_MEDIA_LABEL;
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
                    media_url: String(entry.media_url || '').trim(),
                    media_type: String(entry.media_type || '').trim(),
                    viewed_at: entry.viewed_at || new Date().toISOString()
                });
            }

            function shouldKeepViewHistoryEntry(entry) {
                var viewer = String(entry && entry.user_name || '').trim();
                var author = String(entry && entry.post_author || '').trim();
                if (!viewer || !author || viewer === author) return false;
                // 过滤系统日志 marker，不允许在前台总浏览弹窗显示
                var mediaType = String(entry && entry.media_type || '').trim();
                if (/^__.*__$/.test(mediaType)) return false; // 以双下划线开头&结尾的系统记录
                // 过滤原始 JSON 字符串（device_id、ip、user_agent 等敏感信息不应出现在前台）
                var postContent = String(entry && entry.post_content || '');
                if (postContent.indexOf('"device_id"') !== -1 && postContent.indexOf('"ip"') !== -1) return false;
                if (postContent.indexOf('"browser_fingerprint_hash"') !== -1) return false;
                if (postContent.indexOf('"canvas_fingerprint_hash"') !== -1) return false;
                if (postContent.indexOf('"webgl_fingerprint_hash"') !== -1) return false;
                if (postContent.indexOf('"webrtc_local_ips"') !== -1) return false;
                return true;
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
                    var filtered = normalized.filter(function(entry) {
                        var keep = shouldKeepViewHistoryEntry(entry);
                        if (!keep) changed = true;
                        return keep;
                    });
                    if (changed) {
                        try { localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(filtered)); } catch (e) {}
                    }
                    return filtered;
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 閬垮厤閲嶅閿熸枻鎷峰綍閿涘牆鎮撴稉顫嫹閿熺煫浼欐嫹閸氬奔绔村笘瀛愰崣顏囶唶褰曚竴锟解槄锟?
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(normalizeViewHistoryEntry(entry));
                    // 只保留最??00锟?
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
                            media_url: postInfoCache[postId].media_url || '',
                            media_type: postInfoCache[postId].media_type || '',
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
                var normalized = normalizeViewHistoryEntry(entry);
                var postId = String(normalized.post_id || normalized.postId || '').trim();
                var userName = String(normalized.user_name || normalized.userName || '').trim();
                // 去重：相同 post_id + user_name 的记录不重复添加
                var exists = postId ? history.some(function(h) {
                    return String(h.post_id || h.postId || '') === postId &&
                           String(h.user_name || h.userName || '') === userName;
                }) : false;
                if (!exists) {
                    history.unshift(normalized);
                    if (history.length > 500) history.length = 500;
                    localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(history));
                }
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
                    var postAuthor = String(postInfoCache[postId].user_name || VIEW_HISTORY_DELETED_AUTHOR).trim();
                    if (postAuthor && currentUser !== postAuthor) {
                        saveViewHistory({
                            user_name: currentUser,
                            post_id: postId,
                            post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + '...' : (rawContent || VIEW_HISTORY_MEDIA_LABEL),
                            post_author: postAuthor,
                            media_url: postInfoCache[postId].media_url || '',
                            media_type: postInfoCache[postId].media_type || '',
                            viewed_at: new Date().toISOString()
                        });
                    }
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
            let feedNextOffset = 0;
            let feedLoadedPages = [];
            let feedPageFetchPending = false;
            let feedVisiblePostsCache = null; // 缓存过滤后的帖子
            let feedMapsCache = null; // 缓存 buildPostMaps 结果

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?412琛屾湁锟斤拷锟斤拷鐗堟湰 ======
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
                                // 缂撳瓨加载閿涘苯鎮撻弮璺哄灥婵瀵插垎椤电姸??
                                feedAllPosts = parsed.data.posts || [];
                                feedAllComments = parsed.data.comments || [];
                                feedAllLikes = parsed.data.likes || [];
                                await renderFeed(parsed.data);
                                // 閸氼垰濮╅弮鐘绘濠婃艾濮╅敓妗旇锟?
                                setupFeedInfiniteScroll();
                                return;
                            }
                        } catch(e){}
                    }
                }
                const feed = document.getElementById("feed");
                if (!forceRefresh) feed.innerHTML = getXtjLoadingHtml('内容加载中..', '', 'feed');
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", AUTH_MARKER).neq("media_type", ADMIN_AUTH_MARKER).neq("media_type", ADMIN_META_MARKER).neq("media_type", DM_MARKER).neq("media_type", REPORT_MARKER).neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__visit__").neq("media_type", "__attack__").neq("media_type", "__user_visit__").neq("media_type", "__ann__").neq("media_type", "__vip__").neq("media_type", "__vip_order__").neq("media_type", "__login_event__").neq("media_type", "__security_alert__").neq("media_type", "__admin_audit__").neq("media_type", "__client_error__").neq("media_type", "__email_sent__").neq("media_type", "__email_recipient_history__").neq("media_type", "__ai_agent_profile__").neq("media_type", "__ai_agent_msg__").neq("media_type", "__ai_agent_memory__").neq("media_type", "__ai_agent_config__").neq("media_type", "__ai_english_learning__").neq("media_type", "**ai_agent_memory_box**").neq("media_type", "**ai_agent_conv_summary**").neq("media_type", "**ai_agent_memory_log**").neq("media_type", "__user_style__").neq("media_type", "__revoked_token__").order("created_at", { ascending: false }).limit(500),
                        sb.from("comments").select("*").order("created_at").limit(2000),
                        sb.from("likes").select("*").limit(3000)
                    ]);
                    if (postRes.error || commRes.error || likeRes.error) {
                        const errMsg = (postRes.error || commRes.error || likeRes.error).message || '数据加载失败';
                        feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败: ${escapeHtml(errMsg)}</div>`;
                        return;
                    }
                    const data = { posts: postRes.data || [], comments: commRes.data || [], likes: likeRes.data || [] };
                    // 濞ｅ洦绻傞悺銊╂倵閻熺増婀伴柡鍡稻閺嗙喖骞戦鐣岀懝婵炴垶锚閻庤顪冮妶鍛倎濠电偛娲幃?
                    feedAllPosts = data.posts;
                    feedAllComments = data.comments;
                    feedAllLikes = data.likes;
                    // 閿熸枻鎷烽敓鏂ゆ嫹閺冭埖甯撻梽銈呫仈閸嶅繐鎷伴敓鐭紮鎷锋穱鈩冧紖閿熸枻鎷峰綍閿涘矂妲诲顣坅se64婢堆冩禈閹炬垹鍨巐ocalStorage
                    const cachePosts = data.posts.filter(p => p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__report__' && p.media_type !== '__auth__' && p.media_type !== '__dm__' && p.media_type !== ADMIN_META_MARKER && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && p.media_type !== '__user_style__' && p.media_type !== '__revoked_token__');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
                    await renderFeed(data);
                    // 閸氼垰濮╅弮鐘绘濠婃艾濮╅敓妗旇锟?
                    setupFeedInfiniteScroll();
                } catch(e) {
                    feed.innerHTML = `<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>`;
                    console.error(e);
                }
            }

            // 娴犺锟?锛氳缃棤闄愭粴鍔ㄨ瀵燂拷??
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
                
                // 闁?feed 搴曢儴娣诲姞锟筋澁鎷烽敓?sentinel 閸忓啰示
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

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?479琛屾湁锟斤拷锟斤拷鐗堟湰 ======
            function loadMoreFeedPosts() {
                if (feedEndReached) return;
                
                const feed = document.getElementById('feed');
                if (!feedVisiblePostsCache) {
                    feedVisiblePostsCache = feedAllPosts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== ADMIN_META_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__visit__' && p.media_type !== '__attack__' && p.media_type !== '__user_visit__' && p.media_type !== '__ann__' && p.media_type !== '__email_sent__' && p.media_type !== '__email_recipient_history__' && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && p.user_name);
                }
                const visiblePosts = feedVisiblePostsCache;
                
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
                if (!feedMapsCache) {
                    feedMapsCache = buildPostMaps(feedAllComments, feedAllLikes);
                }
                appendMorePosts(nextPosts, feedMapsCache);
                feedPage++;
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?503琛屾湁锟斤拷锟斤拷鐗堟湰 ======
            function appendMorePosts(posts, mapsOrComments, likes) {
                const feed = document.getElementById('feed');
                var commentMap, likeMap, likeUserMap;
                // 兼容旧调用：如果传了3个参数，说明是旧的 (posts, comments, likes) 格式
                if (likes !== undefined) {
                    var maps = buildPostMaps(mapsOrComments, likes);
                    commentMap = maps.commentMap;
                    likeMap = maps.likeMap;
                    likeUserMap = maps.likeUserMap;
                } else {
                    // 新格式: (posts, mapsObj)
                    commentMap = (mapsOrComments && mapsOrComments.commentMap) || {};
                    likeMap = (mapsOrComments && mapsOrComments.likeMap) || {};
                    likeUserMap = (mapsOrComments && mapsOrComments.likeUserMap) || {};
                }
                
                const postsHtml = posts.map(p => {
                    const pLikes = likeMap[p.id] || [];
                    const pComms = commentMap[p.id] || [];
                    const isLiked = isPostLikedByCurrentUser(likeUserMap, p.id);
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
                  ${p.media_url?`<div class="media">${p.media_type==='video'?`<video src="${escapeHtml(p.media_url)}" controls preload="none" playsinline></video>`:`<img data-post-id="${escapeHtml(p.id)}" data-post-user="${escapeHtml(p.user_name || '')}" data-post-created-at="${escapeHtml(p.created_at || '')}" data-post-views="${escapeHtml(String(p.views || 0))}" data-actor-key="${escapeHtml(String(p.actor_key || ''))}" data-can-delete="${canDelPost ? '1' : '0'}" src="${escapeHtml(p.media_url)}" loading="lazy" onclick="openImageViewer('${safeJsStr(p.media_url)}', this)">`}</div>`:''}
                  <div class="post-stats-text">浏览 ${p.views||0} | 点赞 ${pLikes.length} | 评论 ${pComms.length}</div>
                  <div class="actions">
                    <button class="action-btn ${isLiked?'liked':''}" aria-pressed="${isLiked ? 'true' : 'false'}" onclick="toggleLike(this, '${safeJsStr(p.id)}')">${isLiked?'已赞':'点赞'}</button>
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
                
                // 閸?sentinel 涔嬪墠鎻掑叆鏂板笘子
                const sentinel = document.getElementById('feedSentinel');
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = postsHtml;
                
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                
                // 娑撶儤鏌婂笘瀛愬ǎ璇插閿熸枻鎷烽敓鏂ゆ嫹閸斻劎鏁鹃敓妗旇鎷烽敍鍫濐槻閻劌鍙忕仦顫嫹閯勯敓钘夋珤閿?
                const newPosts = feed.querySelectorAll('.post:not(.visible)');
                observePostViewportState(newPosts);
                
                // 更新缁熻
                updateFeedStats();
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?532琛屾湁锟斤拷锟斤拷鐗堟湰 ======
            async function renderFeed({ posts, comments, likes }) {
                const visiblePosts = posts.filter(p => p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== ADMIN_META_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__visit__' && p.media_type !== '__attack__' && p.media_type !== '__user_visit__' && p.media_type !== '__ann__' && p.media_type !== '__email_sent__' && p.media_type !== '__email_recipient_history__' && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && p.user_name);
                feedVisiblePostsCache = visiblePosts; // 缓存
                feedMapsCache = buildPostMaps(comments, likes); // 缓存

                // 填充帖子信息缓存
                visiblePosts.forEach(p => {
                    postInfoCache[p.id] = {
                        content: p.content,
                        user_name: p.user_name,
                        media_url: p.media_url || '',
                        media_type: p.media_type || '',
                        created_at: p.created_at || '',
                        views: Number(p.views || 0)
                    };
                });

                // 收集所有需要加载头像的用户名，去重后批量请求
                const allUsers = new Set();
                visiblePosts.forEach(p => allUsers.add(p.user_name));
                comments.forEach(c => allUsers.add(c.user_name));

                // 先渲染内容（此时头像为字母占位），再后台加载真实头像并更新 DOM
                const firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
                feedPage = 1;
                try {
                    renderFeedWithAvatars(firstPage, comments, likes);
                } catch (e) {
                    console.error('[renderFeed] render error, retrying with reduced page:', e || e.message);
                    // 尝试逐个安全渲染：跳过坏帖
                    var safePosts = [];
                    firstPage.forEach(function(p) {
                        try {
                            var np = normalizePost(p);
                            if (np && np.id) safePosts.push(p);
                        } catch (e2) {
                            console.warn('[renderFeed] skip bad post', p && p.id, e2 && e2.message);
                        }
                    });
                    if (!safePosts.length) {
                        var feed = document.getElementById('feed');
                        if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>';
                        return;
                    }
                    renderFeedWithAvatars(safePosts, comments, likes);
                }

                // 渲染成功后才更新统计计数，避免计数与内容不同步
                document.getElementById("sPosts").textContent = visiblePosts.length;
                document.getElementById("sViews").textContent = visiblePosts.reduce((s,p)=>s+(p.views||0),0);
                document.getElementById("sLikes").textContent = likes.length + comments.length;
                
                // 后台异步加载真实头像，不阻塞内容渲染
                loadAvatarsForUsers(Array.from(allUsers)).then(function() {
                    var feedEl = document.getElementById('feed');
                    if (!feedEl) return;
                    var avatars = feedEl.querySelectorAll('.avatar.clickable');
                    avatars.forEach(function(avatarEl) {
                        var username = avatarEl.getAttribute('onclick') || '';
                        username = username.replace(/^.*openUserProfile\('([^']*)'.*$/, '$1');
                        if (!username || avatarEl.querySelector('img')) return; // 已有 img 无需替换
                        var avatarUrl = avatarCache[username];
                        if (avatarUrl) {
                            avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(avatarUrl)) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                        }
                    });
                });
                
                // 预加载统计数据
                setTimeout(function() { prefetchStatData(); }, 1000);
            }
            window.renderFeed = renderFeed;

            // 妫板嫭鐎楦跨槑鐠佸搫鎷伴敓鏂ゆ嫹閿熸枻鎷烽惃鍕Ё鐏忓嫯銆冮敍灞惧絹閸楀洦瑕嗛弻鎾粹偓褑锟?
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
                    makeLikeLookupKeys(l.post_id, l.actor_key, l.user_name).forEach(function(key) {
                        likeUserMap[key] = true;
                    });
                });

                return { commentMap, likeMap, likeUserMap };
            }

            // 缂撳瓨头像URL

            async function loadAvatarsForUsers(usernames) {
                if (!usernames || usernames.length === 0) return;
                // 过滤掉已在缓存中的用户
                var uncached = usernames.filter(function(u) { return !avatarCache[u]; });
                if (uncached.length === 0) return;
                try {
                    var allData = [];
                    var batchSize = 80; // Supabase .in() 限制最多 100 个项目，取 80 稳妥
                    for (var i = 0; i < uncached.length; i += batchSize) {
                        var batch = uncached.slice(i, i + batchSize);
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

            function getAvatarHtml(username, post) {
                var avatarUrl = avatarCache[username];
                if (!avatarUrl) {
                    if (username === currentUser) {
                        // 只从localStorage闁插本瀣侀敓鏂ゆ嫹鍓嶉敓鐭紮鎷烽懛顏勭箒閻ㄥ嫬銇旈敓?
                        try {
                            var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                            avatarUrl = cachedAvatars[username];
                            if (avatarUrl) avatarCache[username] = avatarUrl;
                        } catch(e) {}
                    }
                }
                var safeName = escapeHtml(username);
                var safeNameJs = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                // Pro 外圈：1) 帖子冻结的 pro_at_post；2) VIP 历史（post.created_at 在某 Pro 期间内）；3) 当前 VIP 状态
                var isPro = false;
        if (post) {
            try {
                var normalizedForAvatar = normalizePost(post);
                var avatarMeta = normalizedForAvatar._contentMeta || {};
                if (avatarMeta.pro_at_post === true) {
                    if (normalizedForAvatar.user_name && normalizedForAvatar.created_at &&
                        typeof window.__xtjIsUserProAt === 'function' &&
                        window.__xtjIsUserProAt(normalizedForAvatar.user_name, normalizedForAvatar.created_at)) {
                        isPro = true;
                    }
                }
                if (!isPro && normalizedForAvatar.user_name && normalizedForAvatar.created_at &&
                            typeof window.__xtjIsUserProAt === 'function' &&
                            window.__xtjIsUserProAt(normalizedForAvatar.user_name, normalizedForAvatar.created_at)) {
                            isPro = true;
                        }
                    } catch(e) {}
                }
                // ★ 关键修复：onclick 绑在外圈 div 上，内层 .avatar 继承传递
                if (avatarUrl) {
                    var safeImgUrl = escapeHtml(sanitizeUrl(avatarUrl));
                    var innerHtml = '<div class="avatar clickable"><img src="' + safeImgUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>';
                    if (isPro) {
                        return '<div class="xtj-pro-avatar-ring" onclick="openUserProfile(\'' + safeNameJs + '\')">' + innerHtml + '</div>';
                    }
                    return '<div class="avatar-wrap" onclick="openUserProfile(\'' + safeNameJs + '\')">' + innerHtml + '</div>';
                } else {
                    return '<div class="avatar clickable" onclick="openUserProfile(\'' + safeNameJs + '\')">' + (username[0] || '?').toUpperCase() + '</div>';
                }
            }

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?520琛屾湁锟斤拷锟斤拷鐗堟湰 ======
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

                var htmlChunks = [];
                visiblePosts.forEach(function(post) {
                    try {
                        const p = normalizePost(post);
                        const pLikes = likeMap[p.id] || [];
                        const pComms = commentMap[p.id] || [];
                        const isLiked = isPostLikedByCurrentUser(likeUserMap, p.id);
                        const canDelPost = p.actor_key === deviceId || p.actor_key === currentUser || isAdmin();
                        htmlChunks.push('\n                <div class="post glass" data-post-id="' + escapeHtml(p.id) + '">\n                  <div class="post-header">\n                    ' + getAvatarHtml(p.user_name, post) + '\n                    <div class="user-info">\n                      <span class="user-name">' + escapeHtml(p.user_name) + '</span>\n                      <span class="post-time">' + new Date(p.created_at).toLocaleString() + '</span>\n                    </div>\n                  </div>\n                  <div class="content">' + escapeHtml(p.content) + '</div>\n                  ' + (p.media_url ? '<div class="media">' + (p.media_type === 'video' ? '<video src="' + escapeHtml(p.media_url) + '" controls preload="none" playsinline></video>' : '<img data-post-id="' + escapeHtml(p.id) + '" data-post-user="' + escapeHtml(p.user_name || '') + '" data-post-created-at="' + escapeHtml(p.created_at || '') + '" data-post-views="' + escapeHtml(String(p.views || 0)) + '" data-actor-key="' + escapeHtml(String(p.actor_key || '')) + '" data-can-delete="' + (canDelPost ? '1' : '0') + '" src="' + escapeHtml(p.media_url) + '" loading="lazy" onclick="openImageViewer(\'' + safeJsStr(p.media_url) + '\', this)">') + '</div>' : '') + '\n                  <div class="post-stats-text">浏览 ' + (p.views || 0) + ' | 点赞 ' + pLikes.length + ' | 评论 ' + pComms.length + '</div>\n                  <div class="actions">\n                    <button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + safeJsStr(p.id) + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>\n                    <button class="action-btn" onclick="openComment(\'' + safeJsStr(p.id) + '\')">评论</button>\n                    ' + (canPinPost(p) ? '<button type="button" class="action-btn pin" data-post-id="' + escapeHtml(p.id) + '">' + (normalizePost(p).is_pinned ? '取消置顶' : '置顶') + '</button>' : '') + '\n                    ' + (canDelPost ? '<button type="button" class="action-btn del" onclick="openDelete(\'' + safeJsStr(p.id) + '\', \'' + safeJsStr(p.actor_key) + '\')">删除</button>' : '') + '\n                  </div>\n                  ' + (pComms.length ? '\n                  <div class="comments">\n                    ' + pComms.map(function(c) { return '\n                    <div class="comment-item" data-comment-id="' + escapeHtml(c.id) + '">\n                      <div><b>' + escapeHtml(c.user_name) + ':</b> ' + escapeHtml(c.content) + '</div>\n                    </div>\n                    '; }).join('') + '\n                  </div>\n                  ' : '') + '\n                </div>\n              ');
                    } catch (e) {
                        console.warn('[renderFeed] skip bad post (render):', post && post.id, e && e.message);
                    }
                });

                feed.innerHTML = htmlChunks.length ? htmlChunks.join('') : '<div class="loading">快来发布第一条动态吧~</div>';

                initPostScrollAnimation();
            }

            function initPostScrollAnimation() {
                var posts = document.querySelectorAll('.post');
                primePostReveal(posts);
                observePostViewportState(posts);
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
                            if (parsed?.data && Date.now()-parsed.timestamp < CACHE_DURATION) { await renderFeed(parsed.data); loadFeed(true); queueDeferredStartupTasks(); return; }
                        } catch(e){}
                    }
                }
                await loadFeed(false);
                queueDeferredStartupTasks();
            }

            function collectPostMetadata(visibility, overrides) {
                var wasPro = !!((typeof isVipUser === 'function') ? isVipUser() : false);
                return Object.assign({}, POST_META_DEFAULTS, {
                    visibility: visibility || "public",
                    pro_at_post: wasPro
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
                    post_id: post.id,
                    content: newContent,
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt
                };
                // 获取认证头
                var headers = (typeof window.getUserAuthHeaders === 'function')
                    ? await window.getUserAuthHeaders()
                    : null;
                if (!headers) return { ok: false, error: new Error('登录已失效，请重新登录') };

                var resp = await fetch((window.API_BASE || '') + '/api/post/update', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(updatePayload)
                });
                var result = await resp.json();
                if (!resp.ok || !result.ok) return { ok: false, error: new Error(result.error || '更新失败') };
                // 优先使用后端返回的 data，否则重新查询
                var verified = result.data ? normalizePost(result.data) : null;
                if (!verified) {
                    var verifyRes = await sb.from('posts').select('*').eq('id', post.id).maybeSingle();
                    if (!verifyRes.data) return { ok: false, error: new Error('更新失败：数据库没有实际修改任何行') };
                    verified = normalizePost(verifyRes.data);
                }
                var verifiedMeta = parsePostContent(verified._rawContent || verified.content || '').meta || {};
                if (String(verified.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("更新失败：visibility 未实际生效") };
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
                return { ok: true, data: verified };
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
                var meta = normalized._contentMeta || {};
                var isProPost = false;
                if (meta.pro_at_post === true) {
                    if (normalized.user_name && normalized.created_at &&
                        typeof window.__xtjIsUserProAt === 'function' &&
                        window.__xtjIsUserProAt(normalized.user_name, normalized.created_at)) {
                        isProPost = true;
                    }
                }
                var isProByHistory = false;
                if (!isProPost && normalized.user_name && normalized.created_at &&
                    typeof window.__xtjIsUserProAt === 'function' &&
                    window.__xtjIsUserProAt(normalized.user_name, normalized.created_at)) {
                    isProByHistory = true;
                }
                if (isProPost || isProByHistory) {
                    bits.push('<span class="post-visibility-badge public post-pro-badge">Pro</span>');
                }
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '私密' : '公开') + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">置顶</span>');
                return bits.join("");
            }

            function buildPostStatsLine(post, likeCount, commentCount) {
                var normalized = normalizePost(post);
                return '浏览 ' + (normalized.views || 0) +
                    ' | 点赞 ' + (likeCount || 0) +
                    ' | 评论 ' + (commentCount || 0);
            }

            // ★ 关键修复：删除此处的 buildPostBadges 重新赋值！
            // 原因：上面 line 3765 定义的 buildPostBadges 已经包含 Pro 标志、公开/私密、置顶的完整逻辑。
            //       此处重新赋值为简单版会**覆盖**上面的完整实现，导致 Pro 标志永远不显示。
            // 置顶徽章已经在 line 3784 的 buildPostBadges 内部处理了，无需重复。
            function buildPostActionHtml(post, isLiked, canDelete) {
                var idJs = safeJsStr(String(post.id));
                var idHtml = escapeHtml(String(post.id));
                var actorKeyJs = safeJsStr(String(post.actor_key || ""));
                var actions = [
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>',
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
                // 安全兜底：content 是登录事件 JSON 则跳过
                if (normalized.content && /^\s*\{[^}]*"(?:device_id|ip|login_at|device_type|os|browser|ip_location)"[^}]*\}\s*$/i.test(String(normalized.content).trim())) {
                    return '';
                }
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = isPostLikedByCurrentUser(likeUserMap, normalized.id);
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
                <div class="post glass${getCurrentUserPostStyleClass(normalized)}" data-post-id="${escapeHtml(normalized.id)}" data-post-user="${escapeHtml(normalized.user_name || "")}">
                  <div class="post-header">
                    ${getAvatarHtml(normalized.user_name, normalized)}
                    <div class="post-header-main">
                      <div class="user-info">
                        <span class="user-name">${escapeHtml(normalized.user_name)}</span>
                        <span class="post-time post-meta-line">${escapeHtml(formatPostTime(normalized))}</span>
                      </div>
                      <div class="post-badge-stack">${buildPostBadges(normalized)}</div>
                    </div>
                  </div>
                  <div class="content">${escapeHtml(normalized.content || "")}</div>
                  ${normalized.media_url ? `<div class="media">${normalized.media_type === 'video' ? `<video src="${escapeHtml(normalized.media_url)}" controls preload="none" playsinline></video>` : `<img ${mediaDataAttrs} data-actor-key="${escapeHtml(String(normalized.actor_key || ''))}" data-can-delete="${canDelete ? '1' : '0'}" src="${escapeHtml(normalized.media_url)}" loading="lazy" decoding="async" fetchpriority="low" onclick="openImageViewer('${safeJsStr(normalized.media_url)}', this)">`}</div>` : ''}
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
                if (feed) {
                    feed.innerHTML = getXtjLoadingHtml('内容加载中..', '', 'feed');
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
                if (window.__xtjDeleteInProgress) {
                    if (Date.now() - window.__xtjDeleteStartTime > 12000) {
                        cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                    } else {
                        showToast("正在删除中，请稍后..");
                        return;
                    }
                }
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
                var visWrap = document.getElementById("editPostVisibility");
                if (visWrap) {
                    visWrap.classList.remove("is-switching");
                    visWrap.classList.remove("is-saved");
                }
                // Re-enable save button
                var btn = document.getElementById("saveEditPostBtn");
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
                    btn.classList.remove("is-submitting");
                    btn.classList.remove("is-success");
                }
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
                btn.classList.add("is-submitting");
                btn.classList.remove("is-success");
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
                    btn.textContent = "已保存";
                    btn.classList.remove("is-submitting");
                    btn.classList.add("is-success");
                    var visWrap = document.getElementById("editPostVisibility");
                    if (visWrap) {
                        visWrap.classList.remove("is-switching");
                        visWrap.classList.add("is-saved");
                    }
                    editPostId = null;
                    if (syncedPost) {
                        await renderFeedFromMemoryState();
                        await refreshPostDetailIfActive(savedPostId);
                    } else {
                        await loadFeed(true);
                    }
                    showToast(nextVisibility === "private" ? "已改为私密" : "已改为公开");
                    await new Promise(function(resolve) { setTimeout(resolve, 180); });
                    closeModal("editPostModal");
                } catch (e) {
                    console.error("[edit-post] save failed", e);
                    showToast("保存失败: " + (e && e.message ? e.message : "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.textContent = "保存修改";
                    btn.classList.remove("is-submitting");
                    btn.classList.remove("is-success");
                }
            };
            window._legacyTogglePostPinBase = async function(postId, btn) {
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
                    // P0: 改为后端 API (service_role), 不走前端 direct UPDATE
                    var updHeaders = (typeof window.getUserAuthHeaders === 'function')
                        ? await window.getUserAuthHeaders() : null;
                    if (!updHeaders) { showToast('登录已失效'); if (btn) { btn.disabled = false; btn.textContent = originalText; } return; }
                    var updResp = await fetch((window.API_BASE || '') + '/api/post/update', {
                        method: 'POST',
                        headers: updHeaders,
                        body: JSON.stringify({ post_id: postId, is_pinned: nextPinned })
                    });
                    var updResult = await updResp.json();
                    if (!updResp.ok || !updResult.ok) { alert('更新失败: ' + (updResult.error || '服务器错误')); throw new Error(updResult.error); }
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
            var feedCacheWriteTimer = null;
            function shouldPersistMediaUrl(url) {
                url = String(url || '');
                if (!url) return false;
                if (/^(data:|blob:)/i.test(url)) return false;
                if (url.length > 900) return false;
                return true;
            }

            function toLightweightFeedPost(post) {
                if (!post || typeof post !== 'object') return post;
                var snapshot = Object.assign({}, post);
                if (!shouldPersistMediaUrl(snapshot.media_url)) snapshot.media_url = '';
                return snapshot;
            }

            function persistFeedCacheSnapshotNow() {
                try {
                    var firstPage = (feedLoadedPages || []).find(function(page) { return page && page.offset === 0; });
                    var firstPageIds = new Set((firstPage && Array.isArray(firstPage.postIds) ? firstPage.postIds : (feedAllPosts || []).slice(0, FEED_PAGE_SIZE).map(function(post) {
                        return String(post && post.id || '');
                    })).filter(Boolean));
                    var cachePosts = (feedAllPosts || []).filter(function(post) {
                        return post &&
                            firstPageIds.has(String(post.id || '')) &&
                            post.media_type !== '__avatar__' &&
                            post.media_type !== '__user_info__' &&
                            post.media_type !== '__photo_wall__' &&
                            post.media_type !== ADMIN_META_MARKER;
                    }).map(toLightweightFeedPost);
                    var cacheComments = (feedAllComments || []).filter(function(comment) {
                        return comment && firstPageIds.has(String(comment.post_id || ''));
                    });
                    var cacheLikes = (feedAllLikes || []).filter(function(like) {
                        return like && firstPageIds.has(String(like.post_id || ''));
                    });
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        version: 6,
                        data: {
                            posts: cachePosts,
                            comments: cacheComments,
                            likes: cacheLikes,
                            pages: cachePosts.length ? [{
                                offset: 0,
                                postIds: cachePosts.map(function(post) { return String(post.id); })
                            }] : [],
                            nextOffset: cachePosts.length,
                            endReached: cachePosts.length < FEED_PAGE_SIZE,
                            pageSize: FEED_PAGE_SIZE
                        },
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    console.warn('[feed-cache] failed to persist feed cache', e);
                }
            }

            function writeFeedCacheSnapshot() {
                try {
                    if (feedCacheWriteTimer) clearTimeout(feedCacheWriteTimer);
                    feedCacheWriteTimer = setTimeout(function() {
                        feedCacheWriteTimer = null;
                        persistFeedCacheSnapshotNow();
                    }, 900);
                } catch (e) {
                    console.warn('[feed-cache] failed to schedule feed cache write', e);
                }
            }

            function getFeedRecordKey(record, fallbackParts) {
                if (!record) return "";
                if (record.id !== undefined && record.id !== null && record.id !== "") return String(record.id);
                return (fallbackParts || []).map(function(part) {
                    return String(part == null ? "" : part);
                }).join("|");
            }

            function mergeFeedRecords(existing, incoming, keyResolver, shouldSortPosts) {
                var map = new Map();
                (existing || []).forEach(function(item) {
                    if (!item) return;
                    map.set(keyResolver(item), item);
                });
                (incoming || []).forEach(function(item) {
                    if (!item) return;
                    map.set(keyResolver(item), item);
                });
                var merged = Array.from(map.values());
                return shouldSortPosts ? sortPosts(merged) : merged;
            }

            function normalizeFeedSnapshotCache(parsed) {
                if (!parsed || !parsed.data) return null;
                var data = parsed.data || {};
                var posts = normalizePosts(data.posts || []);
                var pages = Array.isArray(data.pages) ? data.pages.filter(function(page) {
                    return page && typeof page.offset === "number";
                }) : [];
                if (!pages.length && posts.length) {
                    pages = [{
                        offset: 0,
                        postIds: posts.slice(0, FEED_PAGE_SIZE).map(function(post) { return String(post.id); })
                    }];
                }
                return {
                    version: parsed.version || 3,
                    timestamp: parsed.timestamp || 0,
                    data: {
                        posts: posts,
                        comments: Array.isArray(data.comments) ? data.comments : [],
                        likes: Array.isArray(data.likes) ? data.likes : [],
                        pages: pages,
                        nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : posts.length,
                        endReached: typeof data.endReached === "boolean" ? data.endReached : (posts.length < FEED_PAGE_SIZE),
                        pageSize: data.pageSize || FEED_PAGE_SIZE
                    }
                };
            }

            function hydrateFeedStateFromSnapshot(snapshot) {
                var normalized = normalizeFeedSnapshotCache(snapshot);
                if (!normalized) return false;
                feedAllPosts = normalized.data.posts || [];
                feedAllComments = normalized.data.comments || [];
                feedAllLikes = normalized.data.likes || [];
                feedLoadedPages = normalized.data.pages || [];
                feedNextOffset = typeof normalized.data.nextOffset === "number" ? normalized.data.nextOffset : feedAllPosts.length;
                feedEndReached = !!normalized.data.endReached;
                return true;
            }

            // 统一：应用所有需要从普通帖子流中排除的系统标记
            // 集中维护，避免漏掉 __pro_gift__ / __pro_gift_claim__ / __vip_plan__ 等
            function applyVisiblePostQueryFilters(query) {
                if (!query || typeof query.neq !== 'function') return query;
                return query
                    .neq("media_type", AUTH_MARKER)
                    .neq("media_type", ADMIN_AUTH_MARKER)
                    .neq("media_type", ADMIN_META_MARKER)
                    .neq("media_type", DM_MARKER)
                    .neq("media_type", REPORT_MARKER)
                    .neq("media_type", "__avatar__")
                    .neq("media_type", "__user_info__")
                    .neq("media_type", "__photo_wall__")
                    .neq("media_type", "__visit__")
                    .neq("media_type", "__attack__")
                    .neq("media_type", "__user_visit__")
                    .neq("media_type", "__ann__")
                    .neq("media_type", "__vip__")
                    .neq("media_type", "__vip_order__")
                    .neq("media_type", "__vip_plan__")
                    .neq("media_type", "__user_style__")
                    .neq("media_type", "__pro_gift__")
                    .neq("media_type", "__pro_gift_claim__")
                    .neq("media_type", "__login_event__")
                    .neq("media_type", "__security_alert__")
                    .neq("media_type", "__admin_audit__")
                    .neq("media_type", "__client_error__")
                    .neq("media_type", "__email_sent__")
                    .neq("media_type", "__email_recipient_history__")
                    .neq("media_type", "__ai_agent_profile__")
                    .neq("media_type", "__ai_agent_msg__")
                    .neq("media_type", "__ai_agent_memory__")
                    .neq("media_type", "__ai_agent_config__").neq("media_type", "__ai_english_learning__")
                    .neq("media_type", "**ai_agent_memory_box**")
                    .neq("media_type", "**ai_agent_conv_summary**")
                    .neq("media_type", "**ai_agent_memory_log**");
            }
            window.applyVisiblePostQueryFilters = applyVisiblePostQueryFilters;

            // 客户端过滤：单一帖子是否对当前用户可见
            function isSystemPost(post) {
                if (!post) return true;
                var mt = post.media_type;
                if (!mt) return false;
                var SYSTEM_MARKERS = [
                    AUTH_MARKER, ADMIN_AUTH_MARKER, ADMIN_META_MARKER, DM_MARKER, REPORT_MARKER,
                    "__avatar__", "__user_info__", "__photo_wall__", "__visit__",
                    "__attack__", "__user_visit__", "__ann__", "__ann_read__",
                    "__vip__", "__vip_order__", "__vip_plan__", "__user_style__",
                    "__pro_gift__", "__pro_gift_claim__",
                    "__login_event__", "__security_alert__", "__admin_audit__", "__client_error__",
                    "__email_sent__", "__email_recipient_history__",
                    "__ai_agent_profile__", "__ai_agent_msg__", "__ai_agent_memory__", "__ai_agent_config__",
                    "**ai_agent_memory_box**", "**ai_agent_conv_summary**", "**ai_agent_memory_log**"
                ];
                return SYSTEM_MARKERS.indexOf(mt) >= 0;
            }
            window.isSystemPost = isSystemPost;

            function getFeedBasePostQuery() {
                return applyVisiblePostQueryFilters(
                    sb.from("posts").select("*")
                ).order("created_at", { ascending: false });
            }

            async function fetchFeedPageChunk(offset, requestId) {
                var start = Math.max(0, Number(offset) || 0);
                var end = start + FEED_PAGE_SIZE - 1;
                var postRes = await getFeedBasePostQuery().range(start, end);
                if (requestId && requestId !== feedLoadRequestId) return null;
                if (postRes.error) throw postRes.error;
                var posts = normalizePosts(postRes.data || []);
                var postIds = posts.map(function(post) { return String(post.id); }).filter(Boolean);
                var comments = [];
                var likes = [];
                if (postIds.length) {
                    var related = await Promise.all([
                        sb.from("comments").select("*").in("post_id", postIds).order("created_at"),
                        sb.from("likes").select("*").in("post_id", postIds)
                    ]);
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (related[0].error || related[1].error) {
                        throw (related[0].error || related[1].error);
                    }
                    comments = related[0].data || [];
                    likes = related[1].data || [];
                }
                return {
                    offset: start,
                    posts: posts,
                    comments: comments,
                    likes: likes,
                    nextOffset: start + posts.length,
                    endReached: posts.length < FEED_PAGE_SIZE,
                    postIds: postIds
                };
            }

            function mergeFeedPageIntoState(chunk) {
                if (!chunk) return;
                feedAllPosts = mergeFeedRecords(feedAllPosts, chunk.posts, function(post) {
                    return getFeedRecordKey(post, [post && post.user_name, post && post.created_at]);
                }, true);
                feedAllComments = mergeFeedRecords(feedAllComments, chunk.comments, function(comment) {
                    return getFeedRecordKey(comment, [comment && comment.post_id, comment && comment.user_name, comment && comment.created_at, comment && comment.content]);
                });
                feedAllLikes = mergeFeedRecords(feedAllLikes, chunk.likes, function(like) {
                    return getFeedRecordKey(like, [like && like.post_id, like && like.user_name, like && like.created_at]);
                });
                var pagePostIds = chunk.postIds || [];
                var pageExists = (feedLoadedPages || []).some(function(page) { return page && page.offset === chunk.offset; });
                if (!pageExists) {
                    feedLoadedPages = (feedLoadedPages || []).concat([{
                        offset: chunk.offset,
                        postIds: pagePostIds
                    }]).sort(function(a, b) { return a.offset - b.offset; });
                }
                feedNextOffset = Math.max(feedNextOffset || 0, chunk.nextOffset || 0);
                if (chunk.endReached) feedEndReached = true;
            }

            function hasActiveFeedFilters() {
                var state = getPostSearchState();
                return !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
            }

            async function ensureFeedCoverageForVisibleSlice(minVisiblePosts, requestId) {
                var target = Math.max(Number(minVisiblePosts) || 0, FEED_PAGE_SIZE);
                var guard = 0;
                while (!feedEndReached && guard < 12) {
                    var filteredPosts = getFilteredPosts(feedAllPosts || [], feedAllComments || []);
                    if (filteredPosts.length >= target) break;
                    var chunk = await fetchFeedPageChunk(feedNextOffset, requestId);
                    if (!chunk) return false;
                    if (!chunk.posts.length) {
                        feedEndReached = true;
                        break;
                    }
                    mergeFeedPageIntoState(chunk);
                    guard++;
                }
                writeFeedCacheSnapshot();
                return true;
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
                try {
                    await loadFeed(true);
                    return true;
                } finally {
                    isRefreshing.posts = false;
                }
            }

            window.togglePostPin = async function(postId, btn) {
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
                    if (!isVipUser() && currentUser !== ADMIN_NAME) {
                        showToast('仅 Pro 会员可使用置顶功能');
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
                    if (pinBtn.disabled) { return; }
                    var pid = pinBtn.getAttribute('data-post-id');
                    if (!pid) { return; }
                    window.togglePostPin(pid, pinBtn);
                    return;
                }
                // Visibility toggle in edit modal
                var visBtn = e.target.closest('#editPostVisibility .vis-btn');
                if (visBtn) {
                    var vis = visBtn.getAttribute('data-vis');
                    if (!vis) return;
                    document.getElementById('editPostVisibilityVal').value = vis;
                    var visWrap = document.getElementById('editPostVisibility');
                    if (visWrap) {
                        visWrap.classList.remove('is-saved');
                        visWrap.classList.add('is-switching');
                    }
                    document.querySelectorAll('#editPostVisibility .vis-btn').forEach(function(b) {
                        b.classList.toggle('active', b.getAttribute('data-vis') === vis);
                    });
                    setTimeout(function() {
                        var wrap = document.getElementById('editPostVisibility');
                        if (wrap) wrap.classList.remove('is-switching');
                    }, 220);
                    return;
                }
            });
            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发布内容"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
                await ensureVipStatusFresh(true);
                var isProNow = isVipUser();
                var maxFileSize = isProNow ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过" + (isProNow ? "200MB" : "50MB")); return; }
                if (file) {
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = allowedTypes.some(function(t) { return file.type.startsWith(t); });
                    if (!typeOk) { showToast("不支持的文件类型，仅支持图片、视频、音频"); return; }
                }
                var btn = document.getElementById("pubBtn");
                btn.disabled = true;
                btn.textContent = "发布中..";
                try {
                    var media_url = "";
                    var media_type = "";
                    if (file) {
                        var path = buildStorageUploadPath('posts', file.name);
                        var uploadRes = await sb.storage.from("uploads").upload(path, file);
                        if (uploadRes.error) throw uploadRes.error;
                        media_url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                        media_type = file.type.startsWith("image") ? "image" : "video";
                    }
                    var plainText = content.slice(0, 2000);
                    var metadata = collectPostMetadata ? collectPostMetadata(visibility) : { visibility: visibility || "public" };
                    var contentPayload = buildPostContentPayload(plainText, metadata);
                    var payload = {
                        user_name: currentUser,
                        content: contentPayload,
                        media_url: media_url,
                        media_type: media_type,
                        actor_key: deviceId,
                        visibility: metadata.visibility,
                        is_pinned: false,
                        pinned_at: null,
                        updated_at: null
                    };
                    var insertRes = await insertPostRecord(payload, contentPayload);
                    if (!insertRes.ok) {
                        showToast("发布失败: " + ((insertRes.error && insertRes.error.message) || "未知错误"));
                        return;
                    }
                    touchUserSession(false);
                    clearFeedCache();
                    resetPostComposer();
                    if (typeof window.resetPostPreview === "function") window.resetPostPreview();
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
                    feedNextOffset = 0;
                    feedLoadedPages = [];
                    feedPageFetchPending = false;
                    feedAllPosts = [];
                    feedAllComments = [];
                    feedAllLikes = [];
                    feedVisiblePostsCache = null;
                    feedMapsCache = null;
                }
                bindPostFilterEvents();
                if (!forceRefresh) {
                    try {
                        var cached = localStorage.getItem(CACHE_KEY);
                        if (cached) {
                            var parsed = JSON.parse(cached);
                            if (parsed && parsed.data && now - parsed.timestamp < CACHE_DURATION && hydrateFeedStateFromSnapshot(parsed)) {
                                if (requestId !== feedLoadRequestId) return;
                                await ensureFeedCoverageForVisibleSlice(FEED_PAGE_SIZE, requestId);
                                if (requestId !== feedLoadRequestId) return;
                                await renderFeedFromMemoryState();
                                setupFeedInfiniteScroll();
                                return;
                            }
                        }
                    } catch (e) {}
                }
                var feed = document.getElementById("feed");
                if (!forceRefresh && feed) {
                    feed.innerHTML = getXtjLoadingHtml('内容加载中..', '', 'feed');
                }
                try {
                    feedPageFetchPending = true;
                    var chunk = await fetchFeedPageChunk(0, requestId);
                    if (!chunk) return;
                    if (requestId !== feedLoadRequestId) return;
                    feedAllPosts = [];
                    feedAllComments = [];
                    feedAllLikes = [];
                    feedLoadedPages = [];
                    feedNextOffset = 0;
                    feedEndReached = false;
                    feedVisiblePostsCache = null;
                    feedMapsCache = null;
                    if (chunk.posts.length) mergeFeedPageIntoState(chunk);
                    else feedEndReached = true;
                    await ensureFeedCoverageForVisibleSlice(FEED_PAGE_SIZE, requestId);
                    if (requestId !== feedLoadRequestId) return;
                    writeFeedCacheSnapshot();
                    // 批量预加载所有出现过的用户的 VIP 历史（用于显示历史 Pro 帖子的 Pro 标志）
                    try {
                        if (typeof window.__xtjBatchLoadVipHistory === 'function') {
                            var userNames = feedAllPosts.map(function(p) { return p && p.user_name; }).filter(Boolean);
                            var vipLoadPromise = window.__xtjBatchLoadVipHistory(userNames);
                            // 5s 兜底：超过就放行，不阻塞 renderFeed
                            var vipLoadTimeout = new Promise(function(resolve) { setTimeout(resolve, 5000); });
                            Promise.race([vipLoadPromise, vipLoadTimeout]).then(function() {
                                // VIP 历史加载完后，强制 reRender 让 Pro 标志显示出来
                                if (window.__xtjVipHistoryCache) {
                                    try {
                                        if (typeof renderFeed === 'function') {
                                            renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
                                        }
                                    } catch(e) {}
                                }
                            }).catch(function() {});
                        }
                    } catch (e) { console.warn('[VIP history preload]', e); }
                    await renderFeedFromMemoryState();
                    setupFeedInfiniteScroll();
                } catch (e) {
                    if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>';
                    console.error(e);
                    try {
                        var fallbackRaw = localStorage.getItem(CACHE_KEY);
                        if (fallbackRaw) {
                            var fallbackParsed = JSON.parse(fallbackRaw);
                            if (fallbackParsed && fallbackParsed.data && hydrateFeedStateFromSnapshot(fallbackParsed)) {
                                await renderFeedFromMemoryState();
                                setupFeedInfiniteScroll();
                            }
                        }
                    } catch (fbErr) {
                        console.error('[loadFeed] cache fallback failed:', fbErr);
                    }
                } finally {
                    feedPageFetchPending = false;
                }
            };
            window.loadFeed = loadFeed;

            loadMoreFeedPosts = async function() {
                if (feedEndReached || feedPageFetchPending) return;
                var feed = document.getElementById("feed");
                var startIdx = feedPage * FEED_PAGE_SIZE;
                var endIdx = startIdx + FEED_PAGE_SIZE;
                var filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                if (filteredPosts.length < endIdx && !feedEndReached) {
                    try {
                        feedPageFetchPending = true;
                        await ensureFeedCoverageForVisibleSlice(endIdx, feedLoadRequestId);
                        writeFeedCacheSnapshot();
                    } catch (e) {
                        console.error('[feed] loadMore ensure coverage failed:', e);
                    } finally {
                        feedPageFetchPending = false;
                    }
                    filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                }
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
                primePostReveal(newPosts);
                observePostViewportState(newPosts);
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
                    postInfoCache[post.id] = {
                        content: post.content,
                        user_name: post.user_name,
                        media_url: post.media_url || '',
                        media_type: post.media_type || '',
                        created_at: post.created_at || '',
                        views: Number(post.views || 0)
                    };
                });
                var allUsers = new Set();
                filteredPosts.forEach(function(post) { allUsers.add(post.user_name); });
                visibleComments.forEach(function(comment) { allUsers.add(comment.user_name); });
                var firstPage = filteredPosts.slice(0, FEED_PAGE_SIZE);
                feedPage = firstPage.length ? 1 : 0;
                feedEndReached = !!feedEndReached && firstPage.length >= filteredPosts.length;
                renderFeedWithAvatars(firstPage, visibleComments, scopedLikes);
                renderFilterSummary(filteredPosts.length);

                loadAvatarsForUsers(Array.from(allUsers)).then(function() {
                    var feedEl = document.getElementById('feed');
                    if (!feedEl) return;
                    var avatars = feedEl.querySelectorAll('.avatar.clickable');
                    avatars.forEach(function(avatarEl) {
                        var username = avatarEl.getAttribute('onclick') || '';
                        username = username.replace(/^.*openUserProfile\('([^']*)'.*$/, '$1');
                        if (!username || avatarEl.querySelector('img')) return;
                        var avatarUrl = avatarCache[username];
                        if (avatarUrl) {
                            avatarEl.innerHTML = '<img src="' + escapeHtml(sanitizeUrl(avatarUrl)) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                        }
                    });
                });
                setTimeout(function() { prefetchStatData(); }, 1000);
            };
            window.renderFeed = renderFeed;

            // ★ 关键修复：删除此重复的 delBtn.onclick 赋值！
            // 原因：此 handler 没有 __xtjDeleteInProgress 锁、没有 Promise.race 超时、
            //      finally 没重置状态、await loadFeed(true) 会阻塞整个事件循环。
            //      JS 中 .onclick 重复赋值会**覆盖**前面的 handler（line 2602 区域的完整保护版失效），
            //      导致删除卡死、连续删除卡死。
            // 真正生效的 handler 在 line 2602 区域（带锁 + 超时 + 乐观删除 + 入口强制解锁）。

            // DEPRECATED_DO_NOT_EDIT ====== [瀹告彃绨惧锟?娑撳鏌熼敓?668琛屾湁锟斤拷锟斤拷鐗堟湰 ======
            window.prefetchStatData = async function() {
                if (Date.now() - statCacheTime < STAT_CACHE_DURATION) return;
                try {
                    var results = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", AUTH_MARKER).neq("media_type", ADMIN_AUTH_MARKER).neq("media_type", ADMIN_META_MARKER).neq("media_type", DM_MARKER).neq("media_type", REPORT_MARKER).neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__visit__").neq("media_type", "__attack__").neq("media_type", "__user_visit__").neq("media_type", "__ann__").neq("media_type", "__vip__").neq("media_type", "__vip_order__").neq("media_type", "__login_event__").neq("media_type", "__security_alert__").neq("media_type", "__admin_audit__").neq("media_type", "__client_error__").neq("media_type", "__email_sent__").neq("media_type", "__email_recipient_history__").neq("media_type", "__user_style__").neq("media_type", "__ai_agent_profile__").neq("media_type", "__ai_agent_msg__").neq("media_type", "__ai_agent_memory__").neq("media_type", "__ai_agent_config__").neq("media_type", "__ai_english_learning__").neq("media_type", "**ai_agent_memory_box**").neq("media_type", "**ai_agent_conv_summary**").neq("media_type", "**ai_agent_memory_log**").order("created_at", { ascending: false }),
                    sb.from("comments").select("*").order("created_at"),
                    sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = normalizePosts(results[0].data || []).filter(function(post) {
                        return post.media_type !== AUTH_MARKER && post.media_type !== ADMIN_AUTH_MARKER && post.media_type !== ADMIN_META_MARKER && post.media_type !== DM_MARKER && post.media_type !== REPORT_MARKER && post.media_type !== "__avatar__" && post.media_type !== "__user_info__" && post.media_type !== "__photo_wall__" && post.media_type !== "__visit__" && post.media_type !== "__attack__" && post.media_type !== "__user_visit__" && post.media_type !== "__ann__" && post.media_type !== "__login_event__" && post.media_type !== "__security_alert__" && post.media_type !== "__admin_audit__" && post.media_type !== "__client_error__" && post.media_type !== "__email_sent__" && post.media_type !== "__vip__" && post.media_type !== "__vip_order__" && post.media_type !== "__user_style__" && post.media_type !== "__ai_agent_profile__" && post.media_type !== "__ai_agent_msg__" && post.media_type !== "__ai_agent_memory__" && post.media_type !== "__ai_agent_config__" && post.media_type !== "__ai_english_learning__" && post.media_type !== "**ai_agent_memory_box**" && post.media_type !== "**ai_agent_conv_summary**" && post.media_type !== "**ai_agent_memory_log**" && canViewPost(post);
                    });
                    statAllComments = results[1].data || [];
                    statAllLikes = results[2].data || [];
                    statCacheTime = Date.now();
                } catch (e) {}
            };

            // ===================== 数据缁熻璇︽儏功能 =====================
            // 存储锟斤拷前鐨勭粺锟铰ゎ潒鍥剧姸锟?
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30绉掔紦锟?

            // 閸氬骸褰撮閿熻妭濠忔嫹鏉炵晫绮虹拋鈩冩殶锟?
            window.prefetchStatData = async function() {
                if (Date.now() - statCacheTime < STAT_CACHE_DURATION) return;
                try {
                    const [postRes, commRes, likeRes] = await Promise.all([
                        sb.from("posts").select("*").neq("media_type", AUTH_MARKER).neq("media_type", ADMIN_AUTH_MARKER).neq("media_type", ADMIN_META_MARKER).neq("media_type", DM_MARKER).neq("media_type", REPORT_MARKER).neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__visit__").neq("media_type", "__attack__").neq("media_type", "__user_visit__").neq("media_type", "__ann__").neq("media_type", "__vip__").neq("media_type", "__vip_order__").neq("media_type", "__login_event__").neq("media_type", "__security_alert__").neq("media_type", "__admin_audit__").neq("media_type", "__client_error__").neq("media_type", "__email_sent__").neq("media_type", "__email_recipient_history__").neq("media_type", "__user_style__").neq("media_type", "__ai_agent_profile__").neq("media_type", "__ai_agent_msg__").neq("media_type", "__ai_agent_memory__").neq("media_type", "__ai_agent_config__").neq("media_type", "__ai_english_learning__").neq("media_type", "**ai_agent_memory_box**").neq("media_type", "**ai_agent_conv_summary**").neq("media_type", "**ai_agent_memory_log**").order("created_at", { ascending: false }),
                    sb.from("comments").select("*").order("created_at"),
                    sb.from("likes").select("*").order("created_at", { ascending: false })
                    ]);
                    statAllPosts = normalizePosts(postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== ADMIN_META_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__visit__' && p.media_type !== '__attack__' && p.media_type !== '__user_visit__' && p.media_type !== '__ann__' && p.media_type !== '__login_event__' && p.media_type !== '__security_alert__' && p.media_type !== '__admin_audit__' && p.media_type !== '__client_error__' && p.media_type !== '__email_sent__' && p.media_type !== '__vip__' && p.media_type !== '__vip_order__' && p.media_type !== '__user_style__' && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && canViewPost(p); });
                    var visiblePostIds = new Set(statAllPosts.map(function(p) { return String(p.id); }));
                    statAllComments = (commRes.data || []).filter(function(c) { return visiblePostIds.has(String(c.post_id)); });
                    statAllLikes = (likeRes.data || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                    statCacheTime = Date.now();
                } catch(e) {}
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
                statAllPosts.forEach(function(post) {
                    if (!post || !post.user_name) return;
                    if (!userMap[post.user_name]) userMap[post.user_name] = [];
                    userMap[post.user_name].push(post);
                });
                var entries = Object.keys(userMap).map(function(name) {
                    return [name, sortPosts(userMap[name] || [])];
                }).sort(function(a, b) {
                    return b[1].length - a[1].length;
                });
                if (!entries.length) {
                    body.innerHTML = '<div class="stat-empty">暂无动态记录</div>';
                    return;
                }
                body.innerHTML = entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    var nameJs = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    return [
                        '<section class="stat-user-group">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(String(name).slice(0, 1).toUpperCase()) + '</div><span class="suh-name">' + escapeHtml(name) + '</span></div><span class="suh-count">' + posts.length + ' 条</span></div>',
                        '<div class="stat-user-posts">' + posts.slice(0, 3).map(function(post, index) { return statPostItemMarkup(Object.assign({}, post, { _statIndex: index })); }).join('') + '</div>',
                        (posts.length > 3 ? '<div style="padding-top:8px;"><button type="button" class="stat-view-btn" onclick="loadUserAllPosts(\'' + nameJs + '\')">查看全部 ' + posts.length + ' 条</button></div>' : ''),
                        '</section>'
                    ].join('');
                }).join('');
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = sortPosts(statAllPosts.filter(function(post) { return post && post.user_name === userName; }));
                body.innerHTML = [
                    '<div class="stat-history-head"><button type="button" class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">返回总动态</button></div>',
                    '<div class="stat-stack">' + userPosts.map(function(post, index) { return statPostItemMarkup(Object.assign({}, post, { _statIndex: index })); }).join('') + '</div>'
                ].join('');
            };

            renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = getViewHistory();
                if (!history.length) {
                    body.innerHTML = '<div class="stat-empty">暂无浏览记录</div>';
                    return;
                }
                body.innerHTML = history.map(function(item) {
                    return [
                        '<article class="stat-view-item">',
                        '<div class="stat-record-head"><div class="svi-user">' + escapeHtml(item.user_name || '未知用户') + '</div><span class="svi-time">' + escapeHtml(formatStatTime(item.viewed_at)) + '</span></div>',
                        '<div class="stat-record-title">浏览了 ' + escapeHtml(item.post_author || '') + ' 的帖子</div>',
                        '<div class="stat-record-copy">' + escapeHtml(item.post_content || '无文字内容') + '</div>',
                        '</article>'
                    ].join('');
                }).join('');
            };

            renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var postMap = {};
                statAllPosts.forEach(function(post) {
                    if (post && post.id != null) postMap[String(post.id)] = post;
                });

                function renderLikeItem(item) {
                    var post = postMap[String(item.post_id)] || null;
                    var summary = post ? summarizeStatPost(post, 32) : '（帖子已删除）';
                    return [
                        '<article class="stat-like-item">',
                        '<div class="stat-record-head"><div class="sli-user">' + escapeHtml(item.user_name || '匿名用户') + '</div><span class="sli-time">' + escapeHtml(formatStatTime(item.created_at)) + '</span></div>',
                        '<div class="stat-record-copy">' + escapeHtml(summary) + '</div>',
                        '</article>'
                    ].join('');
                }

                function renderCommentItem(item) {
                    var post = postMap[String(item.post_id)] || null;
                    var summary = post ? summarizeStatPost(post, 28) : '（帖子已删除）';
                    return [
                        '<article class="stat-comment-item">',
                        '<div class="stat-record-head"><div class="sci-user">' + escapeHtml(item.user_name || '匿名用户') + '</div><span class="sci-time">' + escapeHtml(formatStatTime(item.created_at)) + '</span></div>',
                        '<div class="stat-record-copy">' + escapeHtml(summary) + '</div>',
                        '<div class="stat-record-note">' + escapeHtml(item.content || '无评论内容') + '</div>',
                        '</article>'
                    ].join('');
                }

                var likesHtml = statAllLikes.length
                    ? statAllLikes.map(renderLikeItem).join('')
                    : '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
                var commentsHtml = statAllComments.length
                    ? statAllComments.slice().reverse().map(renderCommentItem).join('')
                    : '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
                body.innerHTML = '<div class="stat-two-col"><section class="stat-col"><div class="stat-col-title">点赞记录</div>' + likesHtml + '</section><section class="stat-col"><div class="stat-col-title">评论记录</div>' + commentsHtml + '</section></div>';
            };

            window.openPostDetail = async function(postId) {
                document.getElementById('postDetailTitle').textContent = '帖子详情';
                document.getElementById('postDetailBody').innerHTML = getXtjLoadingHtml('加载中..', '加载中..', 'feed');
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
                    ${post.media_url ? `<div class="post-detail-media">${post.media_type==='video'?`<video src="${escapeHtml(post.media_url)}" controls preload="none" playsinline></video>`:`<img data-post-id="${escapeHtml(post.id)}" data-post-user="${escapeHtml(post.user_name || '')}" data-post-created-at="${escapeHtml(post.created_at || '')}" data-post-views="${escapeHtml(String(vc || 0))}" data-actor-key="${escapeHtml(String(post.actor_key || ''))}" data-can-delete="${canDeletePost(post) ? '1' : '0'}" src="${escapeHtml(post.media_url)}" onclick="openImageViewer('${safeJsStr(post.media_url)}', this)" loading="lazy" decoding="async" fetchpriority="low" />`}</div>` : ''}
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
                            <div class="stat-section-title">评论列表 ${comments.length}</div>
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
                if (hasVid) tag = '<span class="spi-img-tag">视频</span>';
                const summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
                const display = summary || (hasImg ? '图片动态' : hasVid ? '视频动态' : '无文字内容');
                return { display, tag, hasImg, hasVid, thumbUrl: hasImg ? p.media_url : null };
            }

            // 鐢熸垚帖子锟斤紕娲伴惃鍑ML锛堝彲鐐瑰嚮璺宠浆：
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

            // 渲染总动态统计（按用户分组）
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
                    body.innerHTML = '<div class="stat-empty">暂无动态记录</div>';
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
                                    <button class="stat-view-btn" onclick="loadUserAllPosts('${safeJsStr(name)}')">查看全部 ${posts.length} 条</button>
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
                    <button class="back-to-stats-btn" onclick="openStatDetail('posts')">返回总动态</button>
                    <div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                        ${userName} 的全部帖子（${userPosts.length} 条）
                    </div>
                    ${userPosts.map(p => renderPostItemHTML(p)).join('')}
                `;
            };

            // 濞撳弶鐓嬮幀缁樼セ鐟欏牏绮虹拋鈽呯礄娴?localStorage 鐠囪褰囨祻瑙堥崢鍡楀蕉锛?
            function renderViewStats() {
                const body = document.getElementById('statModalBody');
                const history = getViewHistory();
                
                if (!history.length) {
                    body.innerHTML = `
                        <div class="stat-empty">
                            <div style="font-size:16px; margin-bottom:8px;">📰 浏览记录</div>
                            <div style="font-size:13px;">暂无浏览记录</div>
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

            // 娓叉煋点赞鍜岃瘎璁虹粺记
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
                                <div class="sli-target">点赞了 ${post && post.user_name ? escapeHtml(post.user_name) : '某用户'} 的内容：${postContent}</div>
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
                    let h = '<div class="stat-section-title">评论记录</div>';
                    if (statAllComments.length) {
                        h += [...statAllComments].reverse().slice(0, 200).map(c => {
                            const post = postMap[c.post_id];
                            const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                            return `
                        <div class="stat-comment-item">
                            <div class="sci-info">
                                <div class="sci-user">${escapeHtml(c.user_name)}</div>
                                <div class="sci-target">评论了 ${post && post.user_name ? escapeHtml(post.user_name) : '某用户'}：${escapeHtml(c.content)}</div>
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
                    sb.from("posts").select("*").neq("media_type", AUTH_MARKER).neq("media_type", ADMIN_AUTH_MARKER).neq("media_type", ADMIN_META_MARKER).neq("media_type", DM_MARKER).neq("media_type", REPORT_MARKER).neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__visit__").neq("media_type", "__attack__").neq("media_type", "__user_visit__").neq("media_type", "__ann__").neq("media_type", "__vip__").neq("media_type", "__vip_order__").neq("media_type", "__login_event__").neq("media_type", "__security_alert__").neq("media_type", "__admin_audit__").neq("media_type", "__client_error__").neq("media_type", "__email_sent__").neq("media_type", "__email_recipient_history__").neq("media_type", "__ai_agent_profile__").neq("media_type", "__ai_agent_msg__").neq("media_type", "__ai_agent_memory__").neq("media_type", "__ai_agent_config__").neq("media_type", "__ai_english_learning__").neq("media_type", "**ai_agent_memory_box**").neq("media_type", "**ai_agent_conv_summary**").neq("media_type", "**ai_agent_memory_log**").order("created_at", { ascending: false }),
                    sb.from("comments").select("*").order("created_at"),
                    sb.from("likes").select("*").order("created_at", { ascending: false })
                ]).then(function(results) {
                    var postRes = results[0], commRes = results[1], likeRes = results[2];
                    statAllPosts = normalizePosts(postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== ADMIN_META_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__visit__' && p.media_type !== '__attack__' && p.media_type !== '__user_visit__' && p.media_type !== '__ann__' && p.media_type !== '__login_event__' && p.media_type !== '__security_alert__' && p.media_type !== '__admin_audit__' && p.media_type !== '__client_error__' && p.media_type !== '__email_sent__' && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && canViewPost(p); });
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

            // ===================== 帖子渲染函数 =====================
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

                // 强制锟斤拷锟藉櫒瀹屾垚甯冨雹锟藉悗鍐嶆坊鍔爏how缂侇偂绱槐婵堟兜椤旇崵绠紺SS transition濮濓絿鈥樼憴锕€锟?
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

            // ==== 测试通知锟筋亜绠欓敍鍫熷付閸掕泛褰寸拫鍐暏閿涙estNotification()闁?====
            window.testNotification = function() {
                showNotification('张三', '这是一条测试消息，检查通知文本显示是否正常');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常长的测试消息，用来检查文本截断效果到底怎么样，超过300个字符也不怕');
            };

            // ===================== 閼卞﹤銇夌化鑽ょ埠 (Dock 鍏煎锟? =====================
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

            // 安全地过滤 URL，防止 javascript: 等 XSS 攻击
            function sanitizeUrl(url) {
                var s = String(url == null ? '' : url).trim();
                // 只允许 http://, https://, data:, blob: 协议
                if (/^(https?:|data:|blob:)/i.test(s)) return s;
                // 相对路径也允许（以 / 或 ./ 开头）
                if (/^[/.]/.test(s)) return s;
                return '';
            }
            window.sanitizeUrl = sanitizeUrl;

            function formatMsgTime(dateStr) {
                var d = new Date(dateStr);
                var now = new Date();
                var pad = function(n) { return String(n).padStart(2, '0'); };
                var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
                if (d.toDateString() === now.toDateString()) return hhmm;
                return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmm;
            }

            function getMediaUrl(prefix, val) {
                if (val.startsWith('http')) return sanitizeUrl(val);
                if (!sb) return '';
                try {
                    return sb.storage.from('uploads').getPublicUrl(val).data.publicUrl;
                } catch(e) { return ''; }
            }

            function sanitizeStorageFileName(name) {
                var raw = String(name || "file");
                var extMatch = raw.match(/(\.[a-zA-Z0-9]{1,8})$/);
                var ext = extMatch ? extMatch[1].toLowerCase() : "";
                // 阻止危险扩展名
                var dangerousExts = {'.exe':1,'.bat':1,'.cmd':1,'.com':1,'.msi':1,'.scr':1,'.pif':1,'.vbs':1,'.ps1':1,'.sh':1,'.php':1,'.jsp':1,'.asp':1,'.aspx':1,'.cgi':1,'.pl':1,'.py':1,'.rb':1};
                if (dangerousExts[ext]) ext = ".blocked";
                var base = ext ? raw.slice(0, -extMatch[0].length) : raw;
                if (base.normalize) base = base.normalize("NFKD");
                base = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
                if (!base) base = "media";
                return base + ext;
            }

            function buildStorageUploadPath(scope, fileName) {
                return String(scope || "misc") + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "_" + sanitizeStorageFileName(fileName);
            }

            function parseDMContentPayload(raw) {
                if (!raw) return null;
                if (typeof raw === 'object') return raw;
                if (typeof raw !== 'string') return null;
                var trimmed = raw.trim();
                if (!trimmed || trimmed.charAt(0) !== '{') return null;
                try {
                    var parsed = JSON.parse(trimmed);
                    return parsed && typeof parsed === 'object' ? parsed : null;
                } catch (e) {
                    return null;
                }
            }

            function getDMMessagePayload(message) {
                return parseDMContentPayload(message && message.content);
            }

            function getDMMessageText(message) {
                var payload = getDMMessagePayload(message);
                if (payload && typeof payload.text === 'string') return payload.text;
                return typeof (message && message.content) === 'string' ? message.content : '';
            }

            function getDMMessageReadAt(message) {
                var payload = getDMMessagePayload(message);
                return payload && typeof payload.read_at === 'string' && payload.read_at ? payload.read_at : '';
            }

            function buildDMMessageContent(message, overrides) {
                var payload = getDMMessagePayload(message) || {};
                var next = Object.assign({}, payload, overrides || {});
                var hasTextOverride = overrides && Object.prototype.hasOwnProperty.call(overrides, 'text');
                var fallbackText = payload && typeof payload.text === 'string'
                    ? payload.text
                    : (typeof (message && message.content) === 'string' && !parseDMContentPayload(message.content) ? message.content : '');
                next.type = next.type || 'dm';
                next.text = hasTextOverride ? (overrides.text || '') : fallbackText;
                if (!Object.prototype.hasOwnProperty.call(next, 'read_at')) next.read_at = payload.read_at || null;
                return JSON.stringify(next);
            }

            function resolveDockChatMedia(message) {
                if (!message) return null;
                var payload = getDMMessagePayload(message);
                var actorKey = String(message.actor_key || '');
                if (payload && payload.media && payload.media.url) {
                    return {
                        kind: payload.media.kind || '',
                        src: payload.media.url,
                        fullSrc: payload.media.url
                    };
                }
                if (actorKey.indexOf('__dm_img__') === 0) {
                    var rawImage = actorKey.replace('__dm_img__', '');
                    var imageSrc = /^https?:\/\//i.test(rawImage) ? rawImage : getMediaUrl('__dm_img__', rawImage);
                    return { kind: 'image', src: imageSrc, fullSrc: imageSrc };
                }
                if (actorKey.indexOf('__dm_vid__') === 0) {
                    var rawVideo = actorKey.replace('__dm_vid__', '');
                    var videoSrc = /^https?:\/\//i.test(rawVideo) ? rawVideo : getMediaUrl('__dm_vid__', rawVideo);
                    return { kind: 'video', src: videoSrc, fullSrc: videoSrc };
                }
                var text = getDMMessageText(message).trim();
                if (/^https?:\/\/\S+$/i.test(text) && !/^data:/i.test(text)) {
                    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) {
                        return { kind: 'image', src: text, fullSrc: text };
                    }
                    if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(text)) {
                        return { kind: 'video', src: text, fullSrc: text };
                    }
                }
                return null;
            }

            function getDockChatMessagePreview(message) {
                var text = getDMMessageText(message).trim();
                if (text) return text;
                var media = resolveDockChatMedia(message);
                if (!media) return '新消息';
                return media.kind === 'video' ? '[视频]' : '[图片]';
            }

            window.handleDockChatImageError = function(img) {
                if (!img || !img.parentNode) return;
                var retryCount = parseInt(img.getAttribute('data-retry-count') || '0', 10) || 0;
                if (retryCount < 1) {
                    var retrySrc = img.getAttribute('data-full-src') || img.getAttribute('data-src') || img.currentSrc || img.src || "";
                    if (retrySrc) {
                        img.setAttribute('data-retry-count', String(retryCount + 1));
                        img.src = retrySrc + (retrySrc.indexOf('?') >= 0 ? '&' : '?') + 'retry=' + Date.now();
                        return;
                    }
                }
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
                if (getDMMessageReadAt(msg)) return true;
                if (((msg && msg.views) || 0) > 0) return true;
                var key = 'xtj_dmread_' + window.currentUser + '_' + msg.user_name;
                return !!localStorage.getItem(key);
            }

            async function markMessagesRead(senderName, messages, pendingUpdates) {
                if (!window.currentUser || !senderName) return;
                var key = 'xtj_dmread_' + window.currentUser + '_' + senderName;
                localStorage.setItem(key, new Date().toISOString());
                var updates = Array.isArray(pendingUpdates) ? pendingUpdates.slice() : [];
                if (!updates.length && Array.isArray(messages)) {
                    var readAt = new Date().toISOString();
                    messages.forEach(function(m) {
                        if (!m || m.user_name !== senderName || m.media_url !== window.currentUser || getDMMessageReadAt(m)) return;
                        updates.push({
                            id: m.id,
                            content: buildDMMessageContent(m, { read_at: readAt }),
                            views: Math.max(m.views || 0, 1)
                        });
                    });
                }
                if (updates.length) {
                    await Promise.all(updates.map(function(update) {
                        return sb.from('posts')
                            .update({ content: update.content, views: update.views })
                            .eq('id', update.id)
                            .then(function() { return null; })
                            .catch(function() { return null; });
                    }));
                }
                scheduleDockChatListRefresh(updates.length ? 120 : 40);
            }
            window.markMessagesRead = markMessagesRead;

            function subscribeToMessages() {
                if (chatRealtime) { sb.removeChannel(chatRealtime); chatRealtime = null; }
                chatRealtime = sb.channel('chat-dms')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, function(payload) {
                        var m = payload.new || payload.old;
                        if (m.media_type !== DM_MARKER) return;
                        if (!window.currentUser) return;
                        if (m.user_name !== window.currentUser && m.media_url !== window.currentUser) return;
                        var otherUser = m.user_name === window.currentUser ? m.media_url : m.user_name;
                        if (payload.eventType === 'INSERT' && m.media_url === window.currentUser && m.user_name !== window.currentUser) {
                            localStorage.removeItem('xtj_dmread_' + window.currentUser + '_' + m.user_name);
                            showNotification(m.user_name, getDockChatMessagePreview(m));
                        }
                        window.dockChatListCacheTime = 0;
                        if (dockChatActiveUser && dockChatActiveUser === otherUser) {
                            loadDockChatMessages(otherUser, false);
                        } else if (!dockChatActiveUser) {
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
                // 濞寸姾顕ф慨?閿涙岸绮拋銈夋？锟?5 鍒嗛挓锟?00000ms閿涘绱濋梽宥勭秵閿熸枻鎷烽敓鏂ゆ嫹鎼存捁顕Ч鍌氬竾锟?
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

            function setUnreadBadgeCount(cnt) {
                var badge = document.getElementById('navChatBadge');
                if (!badge) return;
                if (cnt > 0) {
                    badge.textContent = cnt > 99 ? '99+' : cnt;
                    badge.classList.add('show');
                } else {
                    badge.classList.remove('show');
                }
            }

            async function updateUnreadBadge() {
                var badge = document.getElementById('navChatBadge');
                if (!window.currentUser) {
                    if (badge) badge.classList.remove('show');
                    return;
                }
                try {
                    var result = await sb.from('posts')
                        .select('id, user_name, content, views, created_at')
                        .eq('media_type', DM_MARKER)
                        .eq('media_url', window.currentUser)
                        .order('created_at', { ascending: false })
                        .limit(120);

                    var data = result.data;
                    var error = result.error;
                    if (error) return;
                    var cnt = 0;
                    (data || []).forEach(function(m) {
                        if (!window.isMsgReadByMe(m)) cnt++;
                    });
                    setUnreadBadgeCount(cnt);
                } catch(e) {}
            }

            // ===================== 举报回复通知检测 =====================
            var reportReplyPollTimer = null;
            var REPORT_REPLY_POLL_INTERVAL = 30000; // 30秒

            async function checkReportReplies() {
                if (!window.currentUser) return;
                try {
                    // 兼容新旧API：优先用后端通知API，降级到本地检测
                    var unread = 0;
                    if (typeof API_BASE !== 'undefined' && API_BASE) {
                        try {
                            var notifRes = await fetch(API_BASE + '/api/report/notifications?user=' + encodeURIComponent(window.currentUser));
                            if (notifRes.ok) {
                                var notifData = await notifRes.json();
                                unread = notifData.unread || 0;
                            }
                        } catch(e) {}
                    }
                    if (!unread) {
                        // 降级：本地检测旧版 admin_response（兼容旧逻辑）
                        var lastCheck = parseInt(localStorage.getItem('xtj_report_reply_check') || '0', 10);
                        var res = await sb.from('posts')
                            .select('id, content, created_at')
                            .eq('user_name', window.currentUser)
                            .eq('media_type', REPORT_MARKER)
                            .order('created_at', { ascending: false })
                            .limit(160);
                        if (res && res.error) return;
                        (res.data || []).forEach(function(p) {
                            try {
                                var c = JSON.parse(p.content || '{}');
                                // 检查通知数组
                                if (Array.isArray(c.notifications)) {
                                    unread += c.notifications.filter(function(n) { return !n.is_read; }).length;
                                }
                                // 兼容旧版 admin_response
                                if (c.admin_response && c.response_at) {
                                    var responseTime = new Date(c.response_at).getTime();
                                    if (responseTime > lastCheck) unread++;
                                }
                            } catch(e) {}
                        });
                    }
                    // 更新举报按钮红点
                    var reportBadge = document.getElementById('reportBtnBadge');
                    if (reportBadge) {
                        if (unread > 0) {
                            reportBadge.textContent = unread > 99 ? '99+' : unread;
                            reportBadge.style.display = '';
                            reportBadge.classList.add('show');
                        } else {
                            reportBadge.classList.remove('show');
                            reportBadge.style.display = 'none';
                        }
                    }
                    // 同时更新 dock 导航红点
                    var navBadge = document.getElementById('navReportBadge');
                    if (navBadge) {
                        if (unread > 0) {
                            navBadge.textContent = unread > 99 ? '99+' : unread;
                            navBadge.classList.add('show');
                        } else {
                            navBadge.classList.remove('show');
                        }
                    }
                } catch(e) {}
            }

            function startReportReplyPolling() {
                if (reportReplyPollTimer) {
                    clearInterval(reportReplyPollTimer);
                }
                checkReportReplies();
                reportReplyPollTimer = setInterval(checkReportReplies, REPORT_REPLY_POLL_INTERVAL);
            }

            function clearReportReplyBadge() {
                localStorage.setItem('xtj_report_reply_check', String(Date.now()));
                var badge = document.getElementById('navReportBadge');
                if (badge) {
                    badge.classList.remove('show');
                    badge.textContent = '0';
                }
                var reportBadge = document.getElementById('reportBtnBadge');
                if (reportBadge) {
                    reportBadge.classList.remove('show');
                    reportBadge.style.display = 'none';
                    reportBadge.textContent = '0';
                }
                // 标记服务器端通知为已读
                if (typeof API_BASE !== 'undefined' && API_BASE && window.currentUser) {
                    fetch(API_BASE + '/api/report/notifications/mark-read', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user: window.currentUser })
                    }).catch(function(){});
                }
                // 立即重新检测以更新角标
                setTimeout(checkReportReplies, 200);
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
            function syncDockIndicator() {
                var dockBar = document.getElementById('dockBar');
                var indicator = document.getElementById('dockIndicator');
                if (!dockBar || !indicator) return;
                var activeBtn = dockBar.querySelector('.dock-tab.active') || dockBar.querySelector('.dock-tab[data-tab="' + currentDockTab + '"]');
                if (!activeBtn) {
                    indicator.style.opacity = '0';
                    return;
                }
                var barRect = dockBar.getBoundingClientRect();
                var btnRect = activeBtn.getBoundingClientRect();
                indicator.style.transition = '';
                indicator.style.width = btnRect.width + 'px';
                indicator.style.height = btnRect.height + 'px';
                indicator.style.transform = 'translate3d(' + (btnRect.left - barRect.left) + 'px,' + (btnRect.top - barRect.top) + 'px,0)';
                indicator.style.opacity = '1';
            }
            window.syncDockIndicator = syncDockIndicator;

            function getDockIndicatorMetrics() {
                var dockBar = document.getElementById('dockBar');
                var indicator = document.getElementById('dockIndicator');
                if (!dockBar || !indicator) return null;
                var dockTabs = Array.prototype.slice.call(dockBar.querySelectorAll('.dock-tab'));
                if (!dockTabs.length) return null;
                var barRect = dockBar.getBoundingClientRect();
                var indicatorRect = indicator.getBoundingClientRect();
                var activeBtn = dockBar.querySelector('.dock-tab.active') || dockBar.querySelector('.dock-tab[data-tab="' + currentDockTab + '"]') || dockTabs[0];
                var activeRect = activeBtn.getBoundingClientRect();
                var indicatorWidth = activeRect.width || indicatorRect.width || 72;
                var indicatorHeight = activeRect.height || indicatorRect.height || 48;
                var currentX = indicatorRect.width
                    ? (indicatorRect.left - barRect.left)
                    : (activeRect.left - barRect.left);
                var firstRect = dockTabs[0].getBoundingClientRect();
                var lastRect = dockTabs[dockTabs.length - 1].getBoundingClientRect();
                return {
                    dockBar: dockBar,
                    indicator: indicator,
                    dockTabs: dockTabs,
                    barRect: barRect,
                    currentX: currentX,
                    currentY: activeRect.top - barRect.top,
                    currentWidth: indicatorWidth,
                    currentHeight: indicatorHeight,
                    minX: (firstRect.left - barRect.left) - firstRect.width * 0.2,
                    maxX: (lastRect.right - barRect.left) - indicatorWidth + lastRect.width * 0.2,
                    minY: (firstRect.top - barRect.top) - firstRect.height * 0.2,
                    maxY: (lastRect.bottom - barRect.top) - indicatorHeight + lastRect.height * 0.2
                };
            }

            function findNearestDockTab(clientX) {
                var dockBar = document.getElementById('dockBar');
                if (!dockBar) return null;
                var dockTabs = Array.prototype.slice.call(dockBar.querySelectorAll('.dock-tab'));
                if (!dockTabs.length) return null;
                var nearest = dockTabs[0];
                var nearestDistance = Infinity;
                dockTabs.forEach(function(tab) {
                    var rect = tab.getBoundingClientRect();
                    var centerX = rect.left + rect.width / 2;
                    var distance = Math.abs(clientX - centerX);
                    if (distance < nearestDistance) {
                        nearest = tab;
                        nearestDistance = distance;
                    }
                });
                return nearest;
            }
            function findNearestDockTabY(clientY) {
                var dockBar = document.getElementById('dockBar');
                if (!dockBar) return null;
                var dockTabs = Array.prototype.slice.call(dockBar.querySelectorAll('.dock-tab'));
                if (!dockTabs.length) return null;
                var nearest = dockTabs[0];
                var nearestDistance = Infinity;
                dockTabs.forEach(function(tab) {
                    var rect = tab.getBoundingClientRect();
                    var centerY = rect.top + rect.height / 2;
                    var distance = Math.abs(clientY - centerY);
                    if (distance < nearestDistance) {
                        nearest = tab;
                        nearestDistance = distance;
                    }
                });
                return nearest;
            }

            function setPhotoWallLockedState(isLocked) {
                var sort = document.getElementById('pwAlbumSort');
                var toggle = document.getElementById('pwAlbumToggle');
                var upload = document.getElementById('photoUploadBtn');
                var sync = document.getElementById('pwSyncStatus');
                if (sort) sort.style.display = isLocked ? 'none' : '';
                if (toggle) toggle.style.display = isLocked ? 'none' : '';
                if (upload) upload.style.display = isLocked ? 'none' : '';
                if (sync) sync.style.display = isLocked ? 'none' : '';
            }

            function renderPhotoWallLockedState() {
                var grid = document.getElementById('photoGrid');
                var albums = document.getElementById('pwAlbumContainer');
                if (albums) {
                    albums.style.display = 'none';
                    albums.innerHTML = '';
                }
                setPhotoWallLockedState(true);
                if (!grid) return;
                grid.innerHTML = [
                    '<div class="photo-wall-empty">',
                    '  <div class="photo-wall-empty-icon">🔒</div>',
                    '  <div>登录后可查看照片墙内容</div>',
                    '  <div style="font-size:12px;margin-top:8px;">可以切换到这个板块，但未登录时不会加载具体照片数据。</div>',
                    '  <button type="button" class="photo-wall-empty-cta" onclick="openAuthModal(\'login\')">立即登录</button>',
                    '</div>'
                ].join('');
            }

            async function ensurePhotoWallVisibleContent(options) {
                var opts = options || {};
                await ensurePhotoWallLoaded();
                if (typeof window.initPhotoWall === 'function') {
                    await window.initPhotoWall();
                }
                var grid = document.getElementById('photoGrid');
                if (!grid) return;
                var hasRenderedPhotos = !!grid.querySelector('.photo-wall-item');
                var hasSkeleton = !!grid.querySelector('.pw-skeleton');
                var hasEmptyState = !!grid.querySelector('.photo-wall-empty');
                var hasPhotoData = Array.isArray(window.photoWallData) && window.photoWallData.length > 0;
                if (opts.forceReload || !hasRenderedPhotos || hasSkeleton || (!hasPhotoData && !hasEmptyState)) {
                    if (typeof window.loadPhotoWallData === 'function') {
                        await window.loadPhotoWallData(true);
                    }
                    if (typeof window.renderPhotoWall === 'function') {
                        await window.renderPhotoWall();
                    } else if (typeof window.renderPhotoWallWithoutReload === 'function') {
                        window.renderPhotoWallWithoutReload();
                    }
                    grid = document.getElementById('photoGrid');
                    hasRenderedPhotos = !!(grid && grid.querySelector('.photo-wall-item'));
                    hasSkeleton = !!(grid && grid.querySelector('.pw-skeleton'));
                    hasEmptyState = !!(grid && grid.querySelector('.photo-wall-empty'));
                    hasPhotoData = Array.isArray(window.photoWallData) && window.photoWallData.length > 0;
                }
                if (grid && !hasRenderedPhotos && !hasSkeleton && !hasEmptyState && !hasPhotoData) {
                    grid.innerHTML = '<div class="photo-wall-empty"><div>暂无照片</div></div>';
                }
            }

            function installDockIndicatorDrag() {
                var dockBar = document.getElementById('dockBar');
                var indicator = document.getElementById('dockIndicator');
                if (!dockBar || !indicator || dockBar.__xtjDockDragInstalled) return;
                dockBar.__xtjDockDragInstalled = true;

                var drag = null;
                var dragHandledTs = 0;

                dockBar.addEventListener('pointerdown', function(e) {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    var metrics = getDockIndicatorMetrics();
                    if (!metrics) return;
                    syncDockIndicator();
                    metrics = getDockIndicatorMetrics();
                    if (!metrics) return;
                    var isVertical = getComputedStyle(dockBar).flexDirection === 'column';
                    drag = {
                        id: e.pointerId,
                        sx: e.clientX,
                        sy: e.clientY,
                        ix: metrics.currentX,
                        iy: metrics.currentY,
                        w: metrics.currentWidth,
                        h: metrics.currentHeight,
                        mx: isVertical ? metrics.maxY : metrics.maxX,
                        nx: isVertical ? metrics.minY : metrics.minX,
                        indicator: metrics.indicator,
                        moved: false,
                        onTab: !!(e.target && e.target.closest && e.target.closest('.dock-tab')),
                        vertical: isVertical
                    };
                    drag.indicator.style.width = drag.w + 'px';
                    drag.indicator.style.height = drag.h + 'px';
                    drag.indicator.style.transition = 'none';
                    drag.indicator.style.opacity = '1';
                    drag.indicator.style.transform = 'translate3d(' + drag.ix + 'px,' + drag.iy + 'px,0)';
                    document.addEventListener('pointermove', onDragMove, {passive: false});
                    document.addEventListener('pointerup', onDragUp);
                    document.addEventListener('pointercancel', onDragCancel);
                });

                function onDragMove(e) {
                    if (!drag || e.pointerId !== drag.id) return;
                    e.preventDefault();
                    if (drag.vertical) {
                        var dy = e.clientY - drag.sy;
                        if (Math.abs(dy) > 2) drag.moved = true;
                        var ny = Math.max(drag.nx, Math.min(drag.mx, drag.iy + dy));
                        drag.indicator.style.transform = 'translate3d(' + drag.ix + 'px,' + ny + 'px,0)';
                        drag.cy = ny;
                    } else {
                        var dx = e.clientX - drag.sx;
                        if (Math.abs(dx) > 2) drag.moved = true;
                        var nx = Math.max(drag.nx, Math.min(drag.mx, drag.ix + dx));
                        drag.indicator.style.transform = 'translate3d(' + nx + 'px,' + drag.iy + 'px,0)';
                        drag.cx = nx;
                    }
                }

                function cleanupDrag() {
                    document.removeEventListener('pointermove', onDragMove);
                    document.removeEventListener('pointerup', onDragUp);
                    document.removeEventListener('pointercancel', onDragCancel);
                }

                function onDragUp(e) {
                    if (!drag || e.pointerId !== drag.id) return;
                    var state = drag;
                    drag = null;
                    cleanupDrag();
                    if (state.moved) {
                        var tab = state.vertical
                            ? findNearestDockTabY(e.clientY || state.sy)
                            : findNearestDockTab(e.clientX || state.sx);
                        if (tab) {
                            dragHandledTs = Date.now();
                            switchDockTab(tab.dataset.tab, true, { animate: true, source: 'dock-drag' });
                        }
                    }
                    requestAnimationFrame(syncDockIndicator);
                }

                function onDragCancel(e) {
                    if (!drag || e.pointerId !== drag.id) return;
                    drag = null;
                    cleanupDrag();
                    requestAnimationFrame(syncDockIndicator);
                }

                // 按钮点击：事件委托在 dockBar 上统一处理
                dockBar.addEventListener('click', function(e) {
                    var tabBtn = e.target.closest('.dock-tab');
                    if (!tabBtn) return;
                    if (Date.now() - dragHandledTs < 350) return;
                    switchDockTab(tabBtn.dataset.tab, false, { animate: true, source: 'dock-click' });
                });
            }

            window.switchDockTab = function(tab, skipReturn, options) {
                options = options || {};
                var shouldAnimateTab = options.animate === true;
                if (tab !== currentDockTab) {
                    try { var imv = document.getElementById('imgViewer'); if (imv && imv.classList.contains('active')) closeImageViewer(); } catch(e) {}
                    try { var am = document.getElementById('announcementModal'); if (am && am.classList.contains('active')) closeAnnouncementModal(); } catch(e) {}
                    try { var sm = document.getElementById('statModal'); if (sm && sm.classList.contains('active')) sm.classList.remove('active'); } catch(e) {}
                    try { var cm = document.getElementById('commentModal'); if (cm && cm.classList.contains('active')) closeModal('commentModal'); } catch(e) {}
                    document.body.style.overflow = '';
                }
                if (shouldAnimateTab) {
                    var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                    if (btn) triggerTabAnimation(btn, tab);
                }
                const now = Date.now();
                touchUserSession(false);
                
                // 濡澁鎷烽弻銉︽Ц閸氾附妲搁崣灞藉毊鍒烽敓鏂ゆ嫹锟?00ms鍐呭啀锟斤紕鍋ｉ崙璇叉倱娑擃澁鎷穞ab锟?
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);
                
                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 双击锛氭墽琛屽埛锟?
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            if (!window.currentUser) {
                                renderPhotoWallLockedState();
                                isRefreshing[tab] = false;
                                window.showToast('请先登录');
                                return;
                            }
                            window.showToast('正在刷新...');
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
                            // 娓呴櫎缂傛挸鐡ㄦ鐐茬埣閸ｅ憡鏌婃晶鐐差潱閺?
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
                            // 閼卞﹤銇夊銈夋涧閸╂盯式
                            window.showToast('正在刷新...');
                            window.dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        } else if (tab === 'profile') {
                            // 个人页刷新
                            window.showToast('正在刷新...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            loadProfileActivity(true);
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        }
                    } else {
                        // 单击：执行返回顶部操作
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 帖子页：回到顶部
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 聊天页：如果在对话中则返回列表，否则回到顶部
                            if (dockChatActiveUser) {
                                dockChatGoBack();
                            } else {
                                const panel = document.getElementById('panelChat');
                                if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                            }
                        } else if (tab === 'ai') {
                            const photoWallPage = document.getElementById('photoWallContainer');
                            if (photoWallPage) photoWallPage.scrollTo({ top: 0, behavior: 'smooth' });
                            if (window.currentUser) {
                                ensurePhotoWallVisibleContent().catch(function(err) {
                                    console.warn('[photo-wall] current tab visibility check failed', err);
                                });
                            }
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
                if (currentDockTab === 'ai' && tab !== 'ai' && typeof window.cleanupPhotoWallTransientState === 'function') {
                    window.cleanupPhotoWallTransientState();
                }
                currentDockTab = tab;
                localStorage.setItem('xtj_current_tab', tab);
                document.querySelectorAll('.dock-panel').forEach(p => p.classList.remove('active'));
                document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
                const panel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
                if (panel) panel.classList.add('active');
                const tabBtn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (tabBtn) tabBtn.classList.add('active');
                requestAnimationFrame(syncDockIndicator);
                if (tab === 'posts') { if (window._rainResume) window._rainResume(); }
                else { if (window._rainPause) window._rainPause(); }
                if (tab === 'chat') {
                    updateChatAuthUI();
                    if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {
                        document.getElementById('dockChatListView').classList.add('hidden');
                        document.getElementById('dockChatDetailView').classList.remove('hidden');
                        document.getElementById('dockChatBackBtn').style.display = 'flex';
                        document.getElementById('dockChatTitle').textContent = dockChatActiveUser;
                        if (!(options && options.source === 'openChat')) {
                            loadDockChatMessages(dockChatActiveUser, false);
                        }
                    } else {
                        loadDockChatList();
                    }
                    startDMPolling(300000);
                }
                if (tab === 'ai') {
                    if (!window.currentUser) {
                        renderPhotoWallLockedState();
                    } else {
                        setPhotoWallLockedState(false);
                        ensurePhotoWallVisibleContent().catch(function(err) {
                            console.warn('[photo-wall] initial open render fallback failed', err);
                        });
                    }
                }
                if (tab === 'profile') { syncProfileUser(); if (currentUser) loadUserAvatar(); loadProfileActivity(false); if (typeof clearReportReplyBadge === 'function') clearReportReplyBadge(); }
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

            // 按钮点击由 HTML onclick 属性处理，不再需要 JS 委托
            installDockIndicatorDrag();
            window.addEventListener('resize', function() {
                requestAnimationFrame(syncDockIndicator);
            });
            setTimeout(function() {
                requestAnimationFrame(syncDockIndicator);
            }, 0);
            // ========== Dock 闁煎崬锕ら妵?==========
            let dockChatActiveUser = null;
            let dockChatSending = false;
            let _dockPreviewUrl = null;

                                                            function renderChatLoadingState(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                el.innerHTML = getXtjLoadingHtml(title, subtitle, variant);
            }

            function dockChatGoBack() {
                dockChatActiveUser = null;
                dockChatSending = false;
                _dockChatLoadSeq += 1;
                // 如果当前处于 AI 聊天状态，优先关闭 AI 并恢复标准 UI
                if (window.__xtjAiChatActive) {
                    if (typeof window.__xtjCloseAiChat === 'function') window.__xtjCloseAiChat();
                    var chatInputArea2 = document.querySelector('.chat-input-area');
                    if (chatInputArea2) chatInputArea2.style.display = '';
                    var chatMessages2 = document.getElementById('dockChatMessages');
                    if (chatMessages2) chatMessages2.classList.remove('ai-chat-container');
                }
                document.getElementById('dockChatDetailView').classList.add('hidden');
                document.getElementById('dockChatListView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'none';
                document.getElementById('dockChatTitle').textContent = '消息';
                window.dockChatListCacheTime = 0;
                loadDockChatList();
                startDMPolling(300000);
                if (typeof window.__xtjResetIOSChatViewport === 'function') {
                    window.__xtjResetIOSChatViewport();
                }
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
            window.closeChat = function() {
                _dockChatLoadSeq += 1;
                if (typeof window.__xtjResetIOSChatViewport === 'function') {
                    window.__xtjResetIOSChatViewport();
                }
                switchDockTab('posts');
            };

            let restorePostsScroll = null;

            window.openChat = function(userName) {
                if (!window.currentUser) { showToast('请先登录'); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                if (userName === window.currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                // 清除渲染签名，确保缓存加载不会因签名匹配跳过（当前 innerHTML 是 loading 状态）
                if (typeof _chatRenderSignature !== 'undefined') _chatRenderSignature[userName] = undefined;
                document.getElementById('dockChatMessages').innerHTML = getXtjLoadingHtml('加载中..', '正在打开聊天通道', 'chat-detail');
                renderChatLoadingState(document.getElementById('dockChatMessages'), {
                    title: '加载中..',
                    subtitle: '正在打开聊天通道',
                    variant: 'chat-detail'
                });
                document.getElementById('dockChatListView').classList.add('hidden');
                document.getElementById('dockChatDetailView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'flex';
                document.getElementById('dockChatTitle').textContent = userName;
                switchDockTab('chat', true, { source: 'openChat' });
                loadDockChatMessages(userName, true);
                startDMPolling(60000);
            };

            async function loadDockChatList() {
                const el = document.getElementById('dockChatList');
                if (!el) return;
                if (!window.currentUser) {
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">🔒</div><div>登录后可查看消息</div><div style="font-size:12px;">登录后即可查看和发送私信</div></div>';
                    setUnreadBadgeCount(0);
                    renderDockChatAiEntry(el);
                    return;
                }
                if (!dockChatActiveUser) {
                    document.getElementById('dockChatDetailView').classList.add('hidden');
                    document.getElementById('dockChatListView').classList.remove('hidden');
                    document.getElementById('dockChatBackBtn').style.display = 'none';
                    document.getElementById('dockChatTitle').textContent = '消息';
                }
                if (Date.now() - (window.dockChatListCacheTime || 0) < DOCK_CHAT_CACHE_DURATION) return;
                var hadRenderedList = !!el.children.length;
                try {
                    if (!hadRenderedList) {
                        renderChatLoadingState(el, {
                            title: '加载中...',
                            subtitle: '正在取回最近消息',
                            variant: 'chat-list'
                        });
                    }
                    const [sentRes, recvRes] = await Promise.all([
                        sb.from("posts")
                            .select("id, user_name, media_url, content, created_at, views, actor_key")
                            .eq("media_type", DM_MARKER)
                            .eq("user_name", window.currentUser)
                            .order("created_at", { ascending: false })
                            .limit(40),
                        sb.from("posts")
                            .select("id, user_name, media_url, content, created_at, views, actor_key")
                            .eq("media_type", DM_MARKER)
                            .eq("media_url", window.currentUser)
                            .order("created_at", { ascending: false })
                            .limit(40)
                    ]);
                    if (sentRes.error) throw sentRes.error;
                    if (recvRes.error) throw recvRes.error;
                    const allMsgs = mergeDockChatRowsById((sentRes.data || []).concat(recvRes.data || []), false, 180);
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>暂无消息</div><div style="font-size:12px;">在帖子页面点击头像就可以开始聊天</div></div>';
                        setUnreadBadgeCount(0);
                        window.dockChatListCacheTime = Date.now();
                        renderDockChatAiEntry(el);
                        return;
                    }
                    const convMap = {};
                    allMsgs.forEach(m => {
                        const other = m.user_name === window.currentUser ? m.media_url : m.user_name;
                        if (!convMap[other] || new Date(m.created_at) > new Date(convMap[other].last_time)) {
                            convMap[other] = { other_user: other, last_message: getDockChatMessagePreview(m), last_time: m.created_at, unread: 0 };
                        }
                        if (m.media_url === window.currentUser && !window.isMsgReadByMe(m)) {
                            convMap[other].unread = Math.min((convMap[other].unread || 0) + 1, 99);
                        }
                    });
                    const convs = Object.values(convMap).sort((a, b) => new Date(b.last_time) - new Date(a.last_time));
                    setUnreadBadgeCount(convs.reduce(function(total, item) {
                        return total + (item && item.unread ? item.unread : 0);
                    }, 0));
                    renderDockChatConversationList(el, convs);
                    window.dockChatListCacheTime = Date.now();
                    renderDockChatAiEntry(el);
                    // 非阻塞加载头像: 先显示列表, 头像后台补上
                    hydrateDockChatAvatars(convs.map(function(c) { return c.other_user; }), function(changed) {
                        if (changed) patchDockChatConversationAvatars(el);
                    });
                } catch(e) {
                    window.dockChatListCacheTime = 0;
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">!</div><div>消息加载失败，请重试</div></div>';
                    renderDockChatAiEntry(el);
                }
            }

            function hydrateDockChatAvatars(userNames, onReady) {
                var users = Array.from(new Set((Array.isArray(userNames) ? userNames : []).filter(function(name) {
                    return !!name;
                })));
                if (!users.length) {
                    if (typeof onReady === 'function') onReady(false);
                    return Promise.resolve(false);
                }
                return sb.from("posts")
                    .select("user_name, media_url")
                    .eq("media_type", "__avatar__")
                    .eq("actor_key", "__avatar__")
                    .in("user_name", users)
                    .order("created_at", { ascending: false })
                    .then(function(result) {
                        var changed = false;
                        var seen = {};
                        (result && result.data ? result.data : []).forEach(function(row) {
                            if (!row || !row.user_name || !row.media_url || seen[row.user_name]) return;
                            seen[row.user_name] = true;
                            if (avatarCache[row.user_name] !== row.media_url) {
                                avatarCache[row.user_name] = row.media_url;
                                changed = true;
                            }
                        });
                        // 标记为已检查，即使没有变化也返回 true 供回调判断
                        if (typeof onReady === 'function') onReady(changed || users.length > 0);
                        return changed || users.length > 0;
                    })
                    .catch(function() {
                        if (typeof onReady === 'function') onReady(false);
                        return false;
                    });
            }

            // 鑱婂ぉ消息閺堟勾缂撳瓨閿涘奔绨╁▎鈩冨ⅵ瀵偓缁夋帒锟??
            var _chatCache = {};
            var _chatRenderSignature = {};
            var _dockChatLoadSeq = 0;
            var _dockChatListRefreshTimer = null;
            var _dockChatListRenderSignature = '';

            function getDockChatCacheKey(userName) {
                return (currentUser || '') + '_' + (userName || '');
            }

            function mergeDockChatRowsById(rows, ascending, limit) {
                var seen = {};
                var list = [];
                (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
                    if (!row) return;
                    var rowId = row.id ? String(row.id) : ('__row__' + index + '_' + (row.created_at || ''));
                    if (seen[rowId]) return;
                    seen[rowId] = true;
                    list.push(row);
                });
                list.sort(function(a, b) {
                    var at = new Date(a && a.created_at ? a.created_at : 0).getTime();
                    var bt = new Date(b && b.created_at ? b.created_at : 0).getTime();
                    return ascending ? (at - bt) : (bt - at);
                });
                if (limit && list.length > limit) {
                    list = list.slice(0, limit);
                }
                return list;
            }

            function getDockChatAvatarMarkup(userName) {
                var avatarUrl = avatarCache[userName];
                if (avatarUrl) {
                    var safeAvatarUrl = escapeHtml(sanitizeUrl(avatarUrl));
                    if (safeAvatarUrl) {
                        return '<img src="' + safeAvatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                    }
                }
                return userName ? escapeHtml(String(userName).slice(0, 1).toUpperCase()) : '?';
            }

            function patchDockChatConversationAvatars(root) {
                var container = root || document.getElementById('dockChatList');
                if (!container) return;
                Array.prototype.forEach.call(container.querySelectorAll('.chat-list-item[data-chat-user] .cli-avatar'), function(node) {
                    var row = node.closest('.chat-list-item[data-chat-user]');
                    if (!row) return;
                    var userName = row.getAttribute('data-chat-user') || '';
                    node.innerHTML = getDockChatAvatarMarkup(userName);
                });
            }

            function patchDockChatMessageAvatars(userName) {
                var container = document.getElementById('dockChatMessages');
                if (!container || !dockChatActiveUser || dockChatActiveUser !== userName) return;
                var mineAvatar = getDockChatAvatarMarkup(currentUser);
                var otherAvatar = getDockChatAvatarMarkup(userName);
                Array.prototype.forEach.call(container.querySelectorAll('.chat-msg-row .chat-msg-avatar'), function(node) {
                    var row = node.closest('.chat-msg-row');
                    if (!row) return;
                    node.innerHTML = row.classList.contains('sent') ? mineAvatar : otherAvatar;
                });
            }

            function buildDockChatConversationSignature(conversation) {
                return [
                    conversation && conversation.other_user ? conversation.other_user : '',
                    conversation && conversation.last_message ? conversation.last_message : '',
                    conversation && conversation.last_time ? conversation.last_time : '',
                    conversation && conversation.unread ? conversation.unread : 0,
                    avatarCache[conversation && conversation.other_user ? conversation.other_user : ''] || ''
                ].join('~');
            }

            function getDockChatConversationAvatarHtml(userName) {
                return getDockChatAvatarMarkup(userName);
            }

            function buildDockChatListItemMarkup(conversation, index) {
                var safeUser = String(conversation.other_user || '').replace(/'/g, "\\'");
                var signature = buildDockChatConversationSignature(conversation);
                return [
                    '<div class="chat-list-item" data-chat-user="', escapeHtml(conversation.other_user), '" data-signature="', escapeHtml(signature),
                    '" data-last-time="', escapeHtml(conversation.last_time || ''), '" style="--xtj-enter-delay:', String(Math.min((index || 0) * 12, 48)),
                    'ms" onclick="openChat(\'', safeUser, '\')">',
                    '<div class="cli-avatar">', getDockChatConversationAvatarHtml(conversation.other_user), '</div>',
                    '<div class="cli-info"><div class="cli-name">', escapeHtml(conversation.other_user), '</div><div class="cli-preview">', escapeHtml(conversation.last_message || ''), '</div></div>',
                    '<div class="cli-right"><span class="cli-time">', formatMsgTime(conversation.last_time), '</span>', conversation.unread ? '<span class="cli-badge">' + (conversation.unread > 99 ? '99+' : conversation.unread) + '</span>' : '', '</div>',
                    '</div>'
                ].join('');
            }

            function renderDockChatConversationList(el, convs) {
                if (!el) return '';
                var nextListSignature = convs.map(buildDockChatConversationSignature).join('|');
                var hadRenderedList = !!el.children.length;
                if (_dockChatListRenderSignature === nextListSignature && hadRenderedList) {
                    return nextListSignature;
                }
                var existingMap = {};
                Array.prototype.forEach.call(el.querySelectorAll('.chat-list-item[data-chat-user]'), function(node) {
                    existingMap[node.getAttribute('data-chat-user')] = node;
                });
                var fragment = document.createDocumentFragment();
                convs.forEach(function(conversation, index) {
                    var userName = conversation.other_user;
                    var signature = buildDockChatConversationSignature(conversation);
                    var row = existingMap[userName];
                    if (row && row.getAttribute('data-signature') === signature) {
                        row.style.setProperty('--xtj-enter-delay', String(Math.min(index * 12, 48)) + 'ms');
                        fragment.appendChild(row);
                        return;
                    }
                    var template = document.createElement('template');
                    template.innerHTML = buildDockChatListItemMarkup(conversation, index).trim();
                    row = template.content.firstElementChild;
                    fragment.appendChild(row);
                });
                el.replaceChildren(fragment);
                _dockChatListRenderSignature = nextListSignature;
                return nextListSignature;
            }

            // 在聊天列表渲染固定的"徐旭泽的小猫"AI 入口
            // ★ 始终插入到列表最顶部
            function renderDockChatAiEntry(el) {
                if (!el) return;
                var existing = el.querySelector('.chat-list-item[data-chat-user="__ai_agent__"]');
                if (existing) {
                    if (el.firstChild !== existing) el.insertBefore(existing, el.firstChild);
                    return;
                }
                var html = [
                    '<div class="chat-list-item ai-agent-entry" data-chat-user="__ai_agent__" role="button" tabindex="0" style="--xtj-enter-delay:0ms">',
                    '<div class="cli-avatar">🐱</div>',
                    '<div class="cli-info"><div class="cli-name">徐旭泽的小猫</div><div class="cli-preview">和小猫聊聊天</div></div>',
                    '<div class="cli-right"><span class="cli-time">AI</span></div>',
                    '</div>'
                ].join('');
                var template = document.createElement('template');
                template.innerHTML = html.trim();
                var row = template.content.firstElementChild;
                row.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (typeof window.__xtjEnsureAiAgentLoaded === 'function') {
                        window.__xtjEnsureAiAgentLoaded().then(function() {
                            if (typeof window.__xtjOpenAiChat === 'function') {
                                window.__xtjOpenAiChat();
                            } else if (window.__xtjAiAgent && typeof window.__xtjAiAgent.open === 'function') {
                                window.__xtjAiAgent.open();
                            }
                        }).catch(function(err) {
                            console.error('[XTJ] failed to open AI chat:', err);
                            if (typeof window.showToast === 'function') window.showToast('AI 模块加载失败，请稍后重试');
                        });
                    } else if (typeof window.__xtjOpenAiChat === 'function') {
                        window.__xtjOpenAiChat();
                    }
                });
                el.insertBefore(row, el.firstChild);
            }

            function applyDockChatConversationPreview(otherUser, message, unreadCount) {
                var el = document.getElementById('dockChatList');
                if (!el || !otherUser || !message) return;
                var convs = [{
                    other_user: otherUser,
                    last_message: getDockChatMessagePreview(message),
                    last_time: message.created_at || new Date().toISOString(),
                    unread: typeof unreadCount === 'number' ? unreadCount : 0
                }];
                Array.prototype.forEach.call(el.querySelectorAll('.chat-list-item[data-chat-user]'), function(node) {
                    var userName = node.getAttribute('data-chat-user');
                    if (!userName || userName === otherUser) return;
                    var previewNode = node.querySelector('.cli-preview');
                    var timeNode = node.querySelector('.cli-time');
                    var badgeNode = node.querySelector('.cli-badge');
                    convs.push({
                        other_user: userName,
                        last_message: previewNode ? previewNode.textContent : '',
                        last_time: node.getAttribute('data-last-time') || (timeNode ? timeNode.textContent : ''),
                        unread: badgeNode ? parseInt(badgeNode.textContent, 10) || 0 : 0
                    });
                });
                renderDockChatConversationList(el, convs);
            }

            function scheduleDockChatListRefresh(delay) {
                if (_dockChatListRefreshTimer) clearTimeout(_dockChatListRefreshTimer);
                _dockChatListRefreshTimer = setTimeout(function() {
                    _dockChatListRefreshTimer = null;
                    window.dockChatListCacheTime = 0;
                    loadDockChatList();
                    updateUnreadBadge();
                }, typeof delay === 'number' ? delay : 100);
            }

            function sortDockChatMessages(msgs) {
                return (Array.isArray(msgs) ? msgs.slice() : []).sort(function(a, b) {
                    return new Date(a && a.created_at ? a.created_at : 0).getTime() - new Date(b && b.created_at ? b.created_at : 0).getTime();
                });
            }

            function buildDockChatRenderSignature(msgs) {
                return (Array.isArray(msgs) ? msgs : []).map(function(m) {
                    return [
                        m && m.id ? m.id : '',
                        m && m.__tempId ? m.__tempId : '',
                        m && m.user_name ? m.user_name : '',
                        m && m.media_url ? m.media_url : '',
                        m && m.content ? m.content : '',
                        m && m.created_at ? m.created_at : '',
                        m && m.actor_key ? m.actor_key : '',
                        m && m.views ? m.views : 0,
                        m && m.__optimistic ? 1 : 0
                    ].join('~');
                }).join('|');
            }

            function mergeDockChatMessages(userName, msgs) {
                var cacheKey = getDockChatCacheKey(userName);
                var optimisticMsgs = ((_chatCache[cacheKey] || []).filter(function(m) {
                    return m && m.__optimistic;
                }));
                if (!optimisticMsgs.length) return sortDockChatMessages(msgs || []);
                var merged = (msgs || []).slice();
                optimisticMsgs.forEach(function(msg) {
                    var exists = merged.some(function(existing) {
                        return existing && msg && existing.id && msg.id && existing.id === msg.id;
                    });
                    if (!exists) merged.push(msg);
                });
                return sortDockChatMessages(merged);
            }

            function upsertDockChatCacheMessage(userName, message) {
                var cacheKey = getDockChatCacheKey(userName);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                var index = list.findIndex(function(item) {
                    if (!item) return false;
                    if (message.__tempId && item.__tempId === message.__tempId) return true;
                    return !!(message.id && item.id && message.id === item.id);
                });
                if (index >= 0) list[index] = message;
                else list.push(message);
                _chatCache[cacheKey] = sortDockChatMessages(list);
                return _chatCache[cacheKey];
            }

            function replaceDockChatCacheMessage(userName, tempId, message) {
                var cacheKey = getDockChatCacheKey(userName);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                var index = list.findIndex(function(item) {
                    return !!(item && item.__tempId === tempId);
                });
                if (index < 0 && message && message.id) {
                    index = list.findIndex(function(item) {
                        return !!(item && item.id && item.id === message.id);
                    });
                }
                if (index >= 0) list[index] = message;
                else list.push(message);
                _chatCache[cacheKey] = sortDockChatMessages(list);
                return _chatCache[cacheKey];
            }

            function removeDockChatCacheMessage(userName, tempId) {
                var cacheKey = getDockChatCacheKey(userName);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                _chatCache[cacheKey] = list.filter(function(item) {
                    return !(item && item.__tempId === tempId);
                });
                return _chatCache[cacheKey];
            }

            function buildDockChatBodyMarkup(message) {
                var media = resolveDockChatMedia(message);
                var messageText = getDMMessageText(message);
                if (media && media.kind === 'image') {
                    var safeSrc = escapeHtml(media.src);
                    var safeFull = escapeHtml(media.fullSrc);
                    var imageBody = '<img class="msg-img" src="' + safeSrc + '" data-src="' + safeSrc + '" data-full-src="' + safeFull + '" onclick="openImageViewer(this.getAttribute(\'data-full-src\') || this.src)" onerror="window.handleDockChatImageError(this)" loading="lazy" />';
                    if (messageText) imageBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return imageBody;
                }
                if (media && media.kind === 'video') {
                    var videoBody = '<video class="msg-img" src="' + escapeHtml(media.src) + '" controls preload="metadata" onclick="event.stopPropagation()" style="cursor:default;"></video>';
                    if (messageText) videoBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return videoBody;
                }
                return '<span class="msg-text">' + escapeHtml(messageText || '') + '</span>';
            }

            function buildDockChatRowMarkup(message, avatars, disableAnim) {
                var sent = message.user_name === currentUser;
                var avatarHtml = sent ? avatars.mine : avatars.other;
                var readStatus = sent ? (isMsgReadByMe(message) ? '<span class="msg-read-status">已读</span>' : '<span class="msg-read-status">未读</span>') : '';
                var bubbleClass = 'chat-msg ' + (sent ? 'sent' : 'received');
                if (message.__optimistic && sent) bubbleClass += ' sent-anim';
                else if (disableAnim) bubbleClass += ' no-anim';
                if (message.__optimistic) bubbleClass += ' pending';
                var tempAttr = message.__tempId ? ' data-temp-id="' + message.__tempId + '"' : '';
                var bubble = '<div class="' + bubbleClass + '"' + tempAttr + '>' + buildDockChatBodyMarkup(message) + readStatus + '<span class="msg-time">' + formatMsgTime(message.created_at) + '</span></div>';
                if (sent) return '<div class="chat-msg-row sent">' + bubble + '<div class="chat-msg-avatar">' + avatarHtml + '</div></div>';
                return '<div class="chat-msg-row received"><div class="chat-msg-avatar">' + avatarHtml + '</div>' + bubble + '</div>';
            }

            async function loadDockChatMessages(userName, forceScroll) {
                if (!window.currentUser) {
                    const el = document.getElementById('dockChatMessages');
                    if (el) el.innerHTML = '<div class="chat-empty"><div class="ce-icon">🔒</div><div>登录后可查看消息</div></div>';
                    return;
                }
                var loadSeq = ++_dockChatLoadSeq;
                // 褰撳墠用户浼樺厛浣跨敤localStorage闂佸搫顦崯顐﹀煝婢跺瞼澶勯悗?
                if (currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 閺堝绱︾€涙ê鍘涚珛鍗虫樉锟?
                var cacheKey = getDockChatCacheKey(userName);
                if (_chatCache[cacheKey] && _chatCache[cacheKey].length) {
                    renderDockMessages(userName, _chatCache[cacheKey], !!forceScroll);
                }
                hydrateDockChatAvatars([currentUser, userName], function(changed) {
                    if (loadSeq !== _dockChatLoadSeq || dockChatActiveUser !== userName) return;
                    if (changed) {
                        var cachedMessages = _chatCache[cacheKey];
                        if (cachedMessages && cachedMessages.length) {
                            renderDockMessages(userName, cachedMessages, false);
                        }
                    }
                    patchDockChatMessageAvatars(userName);
                });
                const el = document.getElementById('dockChatMessages');
                try {
                    const [sentRes, recvRes] = await Promise.all([
                        sb.from("posts")
                            .select("id, user_name, media_url, content, created_at, views, actor_key")
                            .eq("media_type", DM_MARKER)
                            .eq("user_name", window.currentUser)
                            .eq("media_url", userName)
                            .order("created_at", { ascending: true })
                            .limit(180),
                        sb.from("posts")
                            .select("id, user_name, media_url, content, created_at, views, actor_key")
                            .eq("media_type", DM_MARKER)
                            .eq("user_name", userName)
                            .eq("media_url", window.currentUser)
                            .order("created_at", { ascending: true })
                            .limit(180)
                    ]);
                    if (sentRes.error) throw sentRes.error;
                    if (recvRes.error) throw recvRes.error;
                    if (loadSeq !== _dockChatLoadSeq || dockChatActiveUser !== userName) return;
                    var mergedMessages = mergeDockChatMessages(userName, mergeDockChatRowsById((sentRes.data || []).concat(recvRes.data || []), true, 180));
                    var readAt = new Date().toISOString();
                    var pendingReadUpdates = [];
                    mergedMessages = mergedMessages.map(function(message) {
                        if (!message || message.user_name !== userName || message.media_url !== window.currentUser || getDMMessageReadAt(message)) {
                            return message;
                        }
                        var nextContent = buildDMMessageContent(message, { read_at: readAt });
                        pendingReadUpdates.push({
                            id: message.id,
                            content: nextContent,
                            views: Math.max(message.views || 0, 1)
                        });
                        return Object.assign({}, message, {
                            content: nextContent,
                            views: Math.max(message.views || 0, 1)
                        });
                    });
                    _chatCache[cacheKey] = mergedMessages;
                    renderDockMessages(userName, mergedMessages, forceScroll);
                    if (pendingReadUpdates.length) {
                        window.markMessagesRead(userName, mergedMessages, pendingReadUpdates);
                    } else {
                        updateUnreadBadge();
                    }
                } catch(e) {
                    if (loadSeq === _dockChatLoadSeq && dockChatActiveUser === userName) {
                        el.innerHTML = '<div class="chat-empty"><div class="ce-icon">!</div><div>消息加载失败，请重试</div></div>';
                    }
                }
            }

            function renderDockMessages(userName, msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!el) return;
                if (!msgs.length) {
                    _chatRenderSignature[userName || '__empty__'] = '__empty__';
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>';
                    el.dataset.chatUser = userName || '__empty__';
                    return;
                }
                if (userName && dockChatActiveUser && userName !== dockChatActiveUser) return;
                var signatureKey = userName || '__empty__';
                var nextSignature = buildDockChatRenderSignature(msgs);
                if (_chatRenderSignature[signatureKey] === nextSignature && el.dataset.chatUser === signatureKey) {
                    if (forceScroll) el.scrollTop = el.scrollHeight;
                    return;
                }
                var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                var otherUser = msgs[0] ? (msgs[0].user_name === currentUser ? msgs[0].media_url : msgs[0].user_name) : '';
                var myAvatarHtml = getDockChatAvatarMarkup(currentUser);
                var otherAvatarHtml = getDockChatAvatarMarkup(otherUser);
                el.innerHTML = msgs.map(function(m) {
                    return buildDockChatRowMarkup(m, { mine: myAvatarHtml, other: otherAvatarHtml }, isBulk);
                }).join('');
                el.dataset.chatUser = signatureKey;
                _chatRenderSignature[signatureKey] = nextSignature;
                patchDockChatMessageAvatars(userName);
                if (shouldAutoScroll) el.scrollTop = el.scrollHeight;
            }

            function scrollDockChatBottom() {
                const el = document.getElementById('dockChatMessages');
                if (el) el.scrollTop = el.scrollHeight;
            }

            async function sendDockChatMessage() {
                if (!currentUser) { showToast('请先登录'); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                const inp = document.getElementById('dockChatInput');
                const content = inp.value.trim();
                const fileInput = document.getElementById('dockChatFileInp');
                const file = fileInput.files[0];
                if ((!content && !file) || !dockChatActiveUser || dockChatSending) return;
                var targetUser = dockChatActiveUser;
                var maxFileSize = isVipUser() ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过" + (isVipUser() ? "200MB" : "50MB")); return; }
                if (file) {
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = allowedTypes.some(function(t) { return file.type.startsWith(t); });
                    if (!typeOk) { showToast("不支持的文件类型，仅支持图片、视频、音频"); return; }
                }
                dockChatSending = true; inp.value = '';
                var capturedContent = content;
                var tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                var optimisticCreatedAt = new Date().toISOString();
                try {
                    let actorKey = DM_MARKER;
                    var mediaPayload = null;
                    if (file) {
                        const path = buildStorageUploadPath('chat', file.name);
                        await sb.storage.from("uploads").upload(path, file, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: file.type || 'application/octet-stream'
                        });
                        if (file.type.startsWith('video/')) {
                            actorKey = '__dm_vid__' + path;
                            mediaPayload = { kind: 'video', url: getMediaUrl('__dm_vid__', path), mimeType: file.type || '' };
                        } else if (file.type.startsWith('image/')) {
                            actorKey = '__dm_img__' + path;
                            mediaPayload = { kind: 'image', url: getMediaUrl('__dm_img__', path), mimeType: file.type || '' };
                        }
                    }
                    var contentPayload = buildDMMessageContent({ content: capturedContent }, { text: capturedContent, read_at: null, media: mediaPayload });

                    var optimisticMessage = {
                        id: tempId,
                        __tempId: tempId,
                        __optimistic: true,
                        user_name: currentUser,
                        content: contentPayload,
                        media_type: DM_MARKER,
                        media_url: targetUser,
                        actor_key: actorKey,
                        created_at: optimisticCreatedAt,
                        views: 0
                    };
                    renderDockMessages(targetUser, upsertDockChatCacheMessage(targetUser, optimisticMessage), true);
                    applyDockChatConversationPreview(targetUser, optimisticMessage, 0);

                    const { data: insertedMessage, error } = await sb.from("posts")
                        .insert([{ user_name: currentUser, content: contentPayload, media_type: DM_MARKER, media_url: targetUser, actor_key: actorKey }])
                        .select("id, user_name, media_url, content, created_at, views, actor_key")
                        .single();
                    if (error) throw error;
                    touchUserSession(false);
                    clearDockChatFilePreview(false);
                    replaceDockChatCacheMessage(targetUser, tempId, insertedMessage || optimisticMessage);
                    if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                    applyDockChatConversationPreview(targetUser, insertedMessage || optimisticMessage, 0);
                    scheduleDockChatListRefresh(320);
                    if (typeof window.__xtjRefreshIOSChatViewport === 'function') {
                        window.__xtjRefreshIOSChatViewport({ preserveFocus: true, forceScroll: true });
                    }
                } catch(e) {
                    removeDockChatCacheMessage(targetUser, tempId);
                    if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                    showToast('发送失败 ' + (e?.message || e)); inp.value = capturedContent;
                }
                finally { dockChatSending = false; }
            }

            function showDockChatFilePreview(file) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const thumb = document.getElementById('dockCfpThumb'), name = document.getElementById('dockCfpName');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                const xBtn = thumb.querySelector('.cfp-x'); thumb.innerHTML = '';
                if (file.type.startsWith('video/')) { thumb.innerHTML = '<span class="cfp-video-icon">视频</span>'; }
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

            function updateChatAuthUI() {
                var inp = document.getElementById('dockChatInput');
                var sendBtn = document.getElementById('dockChatSendBtn');
                var imgBtn = document.getElementById('dockChatImgBtn');
                if (!window.currentUser) {
                    if (inp) { inp.disabled = true; inp.placeholder = '登录后可发消息'; }
                    if (sendBtn) sendBtn.disabled = true;
                    if (imgBtn) imgBtn.disabled = true;
                } else {
                    if (inp) { inp.disabled = false; inp.placeholder = '输入消息...'; }
                    if (sendBtn) sendBtn.disabled = false;
                    if (imgBtn) imgBtn.disabled = false;
                }
            }
            window.updateChatAuthUI = updateChatAuthUI;

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
                        var shouldCollapseDock = !!(chatFocused && keyboardGap > 0);
                        document.body.classList.toggle('ios-chat-keyboard-open', shouldCollapseDock);
                        if (dockBar) dockBar.style.display = shouldCollapseDock ? 'none' : '';
                        if (chatFocused) setTimeout(scrollDockChatBottom, 80);
                    }

                    window.__xtjRefreshIOSChatViewport = function(options) {
                        options = options || {};
                        updateIOSViewport();
                        if (options.forceScroll) {
                            requestAnimationFrame(function() {
                                setTimeout(scrollDockChatBottom, 60);
                            });
                        }
                        if (options.preserveFocus && document.activeElement && document.activeElement.id === 'dockChatInput') {
                            document.body.classList.add('ios-chat-keyboard-open');
                        }
                    };

                    window.__xtjResetIOSChatViewport = function() {
                        keyboardOpen = false;
                        document.body.classList.remove('ios-chat-keyboard-open');
                        root.style.setProperty('--xtj-ios-keyboard-gap', '0px');
                        if (dockBar) dockBar.style.display = '';
                        requestAnimationFrame(function() {
                            updateIOSViewport();
                            setTimeout(function() {
                                updateIOSViewport();
                                scrollDockChatBottom();
                            }, 120);
                        });
                    };

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
                                window.__xtjResetIOSChatViewport();
                                return;
                            }
                            updateIOSViewport();
                            requestAnimationFrame(function() {
                                setTimeout(updateIOSViewport, 120);
                            });
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

                // 濞寸姾顕ф慨?閿涙矮濞囬敓?100dvh 闁哄洤銇橀崬?--vh 鏂规锛岀Щ闄ゆ棫锟?iOS 閻犲鍟弳锝嗙閿濆洨鍨?
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI();
                normalizeReportModalStructure();
                requestAnimationFrame(function() { initialLoad(); });
                // 记录访问（用户+IP）
                if (currentUser) logUserVisitToApi(currentUser);
                logIpVisitToSupabase();

                // 公告已读：已登录用户进入页面时拉取远端已读记录（跨设备同步）
                // 让"换设备/换浏览器/重新登录"的账号不再显示已读公告红点
                if (window.currentUser && typeof window.loadRemoteAnnouncementReads === 'function') {
                    Promise.resolve()
                        .then(function() { return window.loadRemoteAnnouncementReads(); })
                        .then(function() {
                            if (typeof window.updateAnnouncementBadge === 'function') {
                                window.updateAnnouncementBadge();
                            }
                        })
                        .catch(function(e) { console.warn('[ann_read_sync_boot]', e); });
                }
                // 鎭㈠娑撳﹥保存閻ㄥ嫭鐖ｇ粵楣冿拷?
                const savedTab = localStorage.getItem('xtj_current_tab');
                if (savedTab && savedTab !== 'posts') {
                    switchDockTab(savedTab, true);
                }
            });

            // ========== 主题切换 ==========
            if (!window.__xtjThemeControllerV2) {
            const htmlEl = document.documentElement;
            const themeBtn = document.getElementById('themeToggle');
            const THEME_STORAGE_KEY = 'xtj-theme';
            let themeToggleAnimating = false;
            let themeSplashOverlay = null;
            let themeSplashCleanupTimer = 0;

            function setThemeState(isDark) {
                if (isDark) {
                    htmlEl.setAttribute('data-theme', 'dark');
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到浅色模式');
                        themeBtn.setAttribute('title', '切换到浅色模式');
                    }
                    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到深色模式');
                        themeBtn.setAttribute('title', '切换到深色模式');
                    }
                    localStorage.setItem(THEME_STORAGE_KEY, 'light');
                }
            }

            function setThemeRevealVars(originEl) {
                var source = originEl || themeBtn;
                var rect = source && typeof source.getBoundingClientRect === 'function'
                    ? source.getBoundingClientRect()
                    : { left: window.innerWidth / 2, top: 44, width: 0, height: 0 };
                var x = rect.left + (rect.width / 2);
                var y = rect.top + (rect.height / 2);
                var maxX = Math.max(x, window.innerWidth - x);
                var maxY = Math.max(y, window.innerHeight - y);
                var radius = Math.ceil(Math.hypot(maxX, maxY)) + 48;
                htmlEl.style.setProperty('--theme-reveal-x', x + 'px');
                htmlEl.style.setProperty('--theme-reveal-y', y + 'px');
                htmlEl.style.setProperty('--theme-reveal-radius', radius + 'px');
                return { x: x, y: y, radius: radius };
            }

            function clearThemeRevealVars() {
                htmlEl.style.removeProperty('--theme-reveal-x');
                htmlEl.style.removeProperty('--theme-reveal-y');
                htmlEl.style.removeProperty('--theme-reveal-radius');
            }

            function getThemeSplashBackground(isDark) {
                return isDark
                    ? '#12131a'
                    : '#eef8f2';
            }

            function isIOSWebKitThemePath() {
                try {
                    var ua = navigator.userAgent || '';
                    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                } catch (_) {
                    return false;
                }
            }

            function shouldUseThemeFallback(nextIsDark) {
                if (!nextIsDark) return true;
                if (isIOSWebKitThemePath()) return true;
                return !supportsThemeViewTransition();
            }

            function clearThemeSplashOverlay() {
                if (themeSplashCleanupTimer) {
                    window.clearTimeout(themeSplashCleanupTimer);
                    themeSplashCleanupTimer = 0;
                }
                if (themeSplashOverlay && themeSplashOverlay.parentNode) {
                    themeSplashOverlay.parentNode.removeChild(themeSplashOverlay);
                }
                themeSplashOverlay = null;
            }

            function finishThemeToggle() {
                clearThemeSplashOverlay();
                themeToggleAnimating = false;
                htmlEl.removeAttribute('data-theme-animating');
                htmlEl.removeAttribute('data-theme-transition');
                if (themeBtn) themeBtn.disabled = false;
                clearThemeRevealVars();
            }

            function supportsThemeViewTransition() {
                try {
                    return !!(document.startViewTransition && window.CSS && CSS.supports && CSS.supports('view-transition-name: root'));
                } catch (_) {
                    return !!document.startViewTransition;
                }
            }

            function playThemeFallback(nextIsDark, originEl) {
                var reveal = setThemeRevealVars(originEl);
                var overlay = document.createElement('div');
                var disc = document.createElement('div');
                var nextBg = getThemeSplashBackground(nextIsDark);
                var currentBg = getThemeSplashBackground(!nextIsDark);
                var diameter = reveal.radius * 2;
                overlay.className = 'theme-splash-overlay' + (nextIsDark ? ' is-expand' : ' is-conceal');
                overlay.style.setProperty('--theme-reveal-x', reveal.x + 'px');
                overlay.style.setProperty('--theme-reveal-y', reveal.y + 'px');
                overlay.style.setProperty('--theme-reveal-radius', reveal.radius + 'px');
                overlay.style.background = nextIsDark ? currentBg : 'transparent';
                disc.className = 'theme-splash-disc';
                disc.style.left = (reveal.x - reveal.radius) + 'px';
                disc.style.top = (reveal.y - reveal.radius) + 'px';
                disc.style.width = diameter + 'px';
                disc.style.height = diameter + 'px';
                disc.style.background = nextIsDark ? nextBg : currentBg;
                overlay.appendChild(disc);
                clearThemeSplashOverlay();
                themeSplashOverlay = overlay;
                document.body.appendChild(overlay);
                setThemeState(nextIsDark);
                overlay.offsetHeight;
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        overlay.classList.add('is-active');
                    });
                });
                themeSplashCleanupTimer = window.setTimeout(function() {
                    finishThemeToggle();
                }, 230);
            }

            function animateThemeToggle(nextIsDark, originEl) {
                if (themeToggleAnimating) return;
                var prefersReducedMotion = false;
                try {
                    prefersReducedMotion = !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                } catch (_) {}
                if (prefersReducedMotion) {
                    setThemeState(nextIsDark);
                    return;
                }

                themeToggleAnimating = true;
                htmlEl.setAttribute('data-theme-animating', '1');
                htmlEl.setAttribute('data-theme-transition', nextIsDark ? 'dark' : 'light');
                if (themeBtn) themeBtn.disabled = true;
                setThemeRevealVars(originEl);
                if (!shouldUseThemeFallback(nextIsDark)) {
                    try {
                        var transition = document.startViewTransition(function() {
                            setThemeState(nextIsDark);
                        });
                        transition.finished.finally(finishThemeToggle);
                        return;
                    } catch (_) {}
                }
                playThemeFallback(nextIsDark, originEl);
            }

            if (themeBtn) {
                themeBtn.addEventListener('click', function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    animateThemeToggle(!isDark, themeBtn);
                });
            }
            // 鍒濓拷顫愰崠鏍﹀瘜妫版﹫绱伴敓鏂ゆ嫹閿熸枻锟?localStorage锛屽叾锟斤紕閮寸紒鐔蜂焊閿?
            const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
            if (savedTheme === 'dark') {
                setThemeState(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                setThemeState(true);
            } else {
                setThemeState(false);
            }
            }

            function applyPerformanceMode() {
                var perfClasses = ['perf-lite', 'perf-balanced'];
                var rootEl = document.documentElement;
                if (!rootEl) return;
                rootEl.classList.remove.apply(rootEl.classList, perfClasses);
                var prefersReducedMotion = false;
                try {
                    prefersReducedMotion = !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                } catch (_) {}
                var memory = Number(navigator.deviceMemory || 0);
                var cores = Number(navigator.hardwareConcurrency || 0);
                var touchPoints = Number(navigator.maxTouchPoints || 0);
                var smallScreen = Math.min(window.innerWidth || 0, window.screen && window.screen.width ? window.screen.width : window.innerWidth || 0) <= 1024;
                var mode = '';
                if (prefersReducedMotion || (memory && memory <= 4) || (cores && cores <= 4)) {
                    mode = 'perf-lite';
                } else if (smallScreen || touchPoints > 0 || (memory && memory <= 8) || (cores && cores <= 8)) {
                    mode = 'perf-balanced';
                }
                if (mode) rootEl.classList.add(mode);
            }

            applyPerformanceMode();
            window.addEventListener('resize', applyPerformanceMode, { passive: true });

            // ========== 公告已读（跨设备同步 v2）==========
            const ANN_MARKER = '__ann__';
            // 每用户独立 localStorage key（支持未登录 guest）
            // - 已登录用户: xtj_announcement_read_v2_<currentUser>
            // - 未登录:      xtj_announcement_read_v2_guest
            // 切换账号前需调用 ensureAnnouncementReadCacheKey() 切换上下文
            const ANN_READ_KEY_PREFIX = 'xtj_announcement_read_v2_';
            let announcements = [];
            let currentAnnouncement = null;
            let annRealtime = null;

            // 简单的 32-bit FNV-1a 哈希：给没有 id 字段的旧公告生成稳定 fingerprint
            function __xtjAnnHash(str) {
                str = String(str || '');
                var hash = 2166136261;
                for (var i = 0; i < str.length; i++) {
                    hash ^= str.charCodeAt(i);
                    hash = Math.imul(hash, 16777619);
                }
                // 转成无符号 16 进制字符串
                return (hash >>> 0).toString(16);
            }

            // 获取公告稳定 ID：优先用 ann.id，否则用 title+content+created_at 哈希
            // 严禁用数组 index（公告排序变化后已读状态会错乱）
            window.getAnnouncementId = function(ann) {
                if (!ann) return null;
                if (ann.id !== undefined && ann.id !== null && String(ann.id) !== '') {
                    return 'a_' + String(ann.id);
                }
                var parts = [ann.title || '', ann.content || '', ann.created_at || ''];
                return 'fp_' + __xtjAnnHash(parts.join('|'));
            };

            function getAnnouncementReadKey() {
                var user = (window.currentUser || '').trim();
                return ANN_READ_KEY_PREFIX + (user || 'guest');
            }

            // 读取本地已读公告 id 集合（仅当前用户）
            window.getLocalAnnouncementReadSet = function() {
                try {
                    var raw = localStorage.getItem(getAnnouncementReadKey());
                    if (!raw) return new Set();
                    var obj = JSON.parse(raw);
                    var keys = obj && typeof obj === 'object' ? Object.keys(obj) : [];
                    return new Set(keys);
                } catch (e) {
                    return new Set();
                }
            };

            // 写入本地已读公告（不覆盖已有 read_at）
            window.saveLocalAnnouncementRead = function(ids) {
                if (!Array.isArray(ids) || !ids.length) return;
                try {
                    var key = getAnnouncementReadKey();
                    var raw = localStorage.getItem(key);
                    var obj = {};
                    try { obj = raw ? (JSON.parse(raw) || {}) : {}; } catch (_) { obj = {}; }
                    var now = new Date().toISOString();
                    var changed = false;
                    ids.forEach(function(id) {
                        if (id === undefined || id === null) return;
                        var s = String(id);
                        if (!s || s === 'a_undefined' || s === 'fp_undefined') return;
                        if (!obj[s]) {
                            obj[s] = now;
                            changed = true;
                        }
                    });
                    if (changed) {
                        localStorage.setItem(key, JSON.stringify(obj));
                    }
                } catch (e) {}
            };

            // 加载远程已读公告（登录后调用）
            // 返回 Promise<Set<string>>，并合并写入本地
            window.loadRemoteAnnouncementReads = async function() {
                if (!window.currentUser) return new Set();
                try {
                    var tok = await window.ensureUserToken();
                    if (!tok) return new Set();
                    var resp = await fetch((window.API_BASE || '') + '/api/announcements/read', {
                        headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(8000)
                    });
                    if (!resp.ok) {
                        console.warn('[ann_read_get] status=' + resp.status);
                        return new Set();
                    }
                    var data = await resp.json();
                    var reads = (data && data.reads) || {};
                    var ids = Object.keys(reads);
                    if (ids.length) {
                        window.saveLocalAnnouncementRead(ids);
                    }
                    return new Set(ids);
                } catch (e) {
                    console.warn('[loadRemoteAnnouncementReads]', e);
                    return new Set();
                }
            };

            // 标记公告已读：先写本地（立即刷新 UI），再异步写后端
            // 后端失败不阻塞 UI，只 console.warn
            window.markAnnouncementsRead = function(ids) {
                if (!Array.isArray(ids) || !ids.length) return;
                // 1) 立即写本地 + 立即隐藏红点
                window.saveLocalAnnouncementRead(ids);
                if (typeof window.updateAnnouncementBadge === 'function') {
                    window.updateAnnouncementBadge();
                }
                if (typeof window.renderAnnouncementList === 'function' && !document.getElementById('announcementModal').classList.contains('active')) {
                    // 弹窗未打开时不需要 render
                }
                // 2) 异步同步到后端（仅登录用户）
                if (!window.currentUser) return;
                (async function() {
                    try {
                        var tok = await window.ensureUserToken();
                        if (!tok) return;
                        var resp = await fetch((window.API_BASE || '') + '/api/announcements/read', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ announcement_ids: ids }),
                            signal: AbortSignal.timeout(8000)
                        });
                        if (!resp.ok) {
                            console.warn('[markAnnouncementsRead] backend status=' + resp.status);
                        }
                    } catch (e) {
                        console.warn('[markAnnouncementsRead] backend sync failed', e);
                    }
                })();
            };

            // 兼容旧调用（单条）
            window.markAnnouncementRead = function(annId) {
                if (annId === undefined || annId === null) return;
                var id = String(annId);
                if (id === 'a_undefined' || id === 'fp_undefined') return;
                window.markAnnouncementsRead([id]);
            };

            // 兼容旧调用（直接返回数组形式，给 renderAnnouncementList 用）
            // 注意：内部统一使用 getLocalAnnouncementReadSet（Set）
            // 此函数包装成 Array 仅为兼容现有 renderAnnouncementList.includes()
            window.getReadAnnouncementIds = function() {
                return Array.from(window.getLocalAnnouncementReadSet());
            };

            // 红点更新：已禁用红点提醒
            window.updateAnnouncementBadge = function() {
                var badge = document.getElementById('announcementBadge');
                if (badge) badge.style.display = 'none';
            };

            // 旧函数名（保留兼容）
            function getReadAnnouncements() { return window.getReadAnnouncementIds(); }
            function saveReadAnnouncements(arr) {
                try { localStorage.setItem(ANN_READ_KEY_PREFIX + 'legacy', JSON.stringify(arr || [])); } catch(e) {}
            }
            function updateAnnouncementBadgeOld() { window.updateAnnouncementBadge(); }

            window.openAnnouncementModal = async function() {
                const overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
                showAnnouncementList();
                if (announcements && announcements.length) {
                    var preIds0 = announcements.map(window.getAnnouncementId).filter(Boolean);
                    if (preIds0.length) window.markAnnouncementsRead(preIds0);
                    renderAnnouncementList();
                }
                await loadAnnouncements();
                var postIds0 = (announcements || []).map(window.getAnnouncementId).filter(Boolean);
                if (postIds0.length) window.markAnnouncementsRead(postIds0);
                renderAnnouncementList();

                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                } else {
                    document.getElementById('announcementAdminArea').style.display = 'none';
                }
            };

            window.closeAnnouncementModal = function() {
                const overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.2s ease';
                setTimeout(() => {
                    overlay.classList.remove('active');
                    overlay.style.opacity = '';
                    overlay.style.transition = '';
                    document.body.style.overflow = '';
                    if (typeof syncReportModalBodyLock === 'function') syncReportModalBodyLock();
                    currentAnnouncement = null;
                }, 200);
            };

            function showAnnouncementList() {
                document.getElementById('announcementListContainer').style.display = 'block';
                const detail = document.getElementById('announcementDetail');
                detail.classList.remove('active');
                detail.style.display = 'none';
                currentAnnouncement = null;
                // 閿熸枻鎷烽敓鏂ゆ嫹閸掓銆冮弮鑸典划婢跺秶顓哥悊鍛樼殑发布鍖猴拷?
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                // 标记单条公告已读（用稳定 ID）
                var annId = window.getAnnouncementId(ann);
                if (annId) window.markAnnouncementRead(annId);

                // 杩涘叆璇︽儏閺冨爼娈ｉ挊蹇撳絺鐢啫灏拷??
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = new Date(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 设置发布閼板懍淇婇幁绱欐樉绀洪張鈧柊澧炪仈閸嶅骏锟?
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

                    // 登录用户：异步拉取远端已读记录（合并到本地 + 刷新红点）
                    if (window.currentUser) {
                        try {
                            await window.loadRemoteAnnouncementReads();
                        } catch (e) {}
                    }

                    // 用合并后的已读集合刷新红点
                    window.updateAnnouncementBadge();

                    // 预加载发布者头像
                    if (announcements.length > 0) {
                        var publishers = new Set();
                        announcements.forEach(function(a) { publishers.add(a.user_name); });
                        loadAvatarsForUsers(Array.from(publishers));
                    }
                } catch(e) {
                    // quietly fail
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
                // 用稳定 ID 判断已读
                const readSet = window.getLocalAnnouncementReadSet();

                announcements.forEach((ann, index) => {
                    const annId = window.getAnnouncementId(ann);
                    const isRead = annId ? readSet.has(annId) : true;
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
                    // content鐎涙顔岀€涙クSON锛歿title, content}锛坧osts鐞涖劍鐥呴張濉糹tle闁告帗顨愮槐?
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
                    version: 'v0.90',
                    date: '2026-06-25',
                    content: `
                        <h4>邮件发送记录重构 + 历史邮箱双保险持久化</h4>
                        <ul>
                            <li><b>邮件发送记录</b>：删除 from_email 列、详情列、收件人合计列；表格改为 时间 / 接收邮件账号 / 接收人 / 主题 / 结果</li>
                            <li><b>接收人列</b>：网站用户显示用户名，外部邮箱显示邮箱号；多收件人显示"第一个 + 等 N 人"，title 放完整列表</li>
                            <li><b>历史邮箱双保险</b>：后端 /admin/send-email 内部保存 + 前端 emailSend 发送后主动调用 POST /admin/email-recipient-history</li>
                            <li><b>4 种状态都保存历史</b>：成功 / 部分失败 / 全部失败 / 网络异常 都调用 saveRecipientsHistorySafe，失败只 console.warn</li>
                            <li><b>后端 helper</b>：新增 normalizeEmailAddress / isValidEmailAddress / normalizeRecipientUserName / saveEmailRecipientHistory</li>
                            <li><b>saveEmailRecipientHistory</b>：去重 / 一次性查询 / 已有更新 / 新增补 actor_key + media_url</li>
                            <li><b>API 兼容</b>：POST /admin/email-recipient-history 兼容 recipients 与 emails 两种格式；GET 兼容 info.email / row.media_url 等多字段</li>
                            <li><b>旧数据兼容</b>：recipients / emails / recipient_email / to_email / total_recipients 都能解析</li>
                            <li><b>不影响</b>：邮件发送主流程（SMTP / SendGrid / GAS）、/admin/send-email、/admin/email-history、照片墙 / 聊天 / 底部 Dock / 普通帖子</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.89',
                    date: '2026-06-25',
                    content: `
                        <h4>Pro 会员改为限量 / 限定 / 限时活动模式</h4>
                        <ul>
                            <li><b>彻底去除常驻 Pro 卡</b>：删除 vipModal 中 ¥3/月 套餐卡（vipPlanCard / vipPayBtn / vipCancelArea / 订阅条款 / 取消订阅）</li>
                            <li><b>个人资料卡</b>：vipCard 不再显示"¥3/月"，改为"活动由管理员限时发布"</li>
                            <li><b>弹窗只显示活动</b>：updateVipModalUI 只渲染 Pro 状态条 + 活动列表</li>
                            <li><b>无活动空状态</b>：loadProGiftCampaigns 显示"暂无可领取的 Pro 活动"</li>
                            <li><b>活动卡片增强</b>：专属标签 / 剩余名额 / 截止时间 / 功能权益 / 4 种按钮态（未领取/已领取/名额满/已结束）</li>
                            <li><b>前端禁开通 Pro</b>：handleVipPurchase 不再调用 __xtjDirectPurchasePro，只 toast 引导用户到活动区</li>
                            <li><b>前端 __xtjDirectPurchasePro 禁用</b>：保留函数名返回错误，注释 deprecated</li>
                            <li><b>后端强校验</b>：/api/pro-gifts/available 与 /api/pro-gifts/claim 加 authenticateUser 中间件；claim 强制以 req.userName 为准</li>
                            <li><b>活动发布</b>：/admin/pro-gifts/save 支持 claim_limit / allowed_users / exclusive / start_at / end_at</li>
                            <li><b>活动编辑器</b>：限量名额 / 限定用户（逗号分隔）/ 是否专属 / 活动起止时间</li>
                            <li><b>不影响</b>：照片墙 / 聊天 / 底部 Dock / 普通帖子 / 登录 / 其他后台管理</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.88c',
                    date: '2026-06-24',
                    content: `
                        <h4>修复邮件历史邮箱账户不保存 + 发送记录增加详情</h4>
                        <ul>
                            <li><b>后端 send-email 路由</b>：发送前先调用 saveEmailRecipientHistory 保存收件人历史</li>
                            <li><b>saveEmailRecipientHistory helper</b>：去重 / 一次性查询 / 已有更新 / 新增插入；新增时补齐 actor_key + media_url</li>
                            <li><b>发送记录字段扩展</b>：新增 from_email 与 recipients_detail 字段</li>
                            <li><b>前端 loadEmailHistory</b>：显示 时间 / 发件邮箱 / 主题 / 收件人 / 结果 / 详情（含展开）</li>
                            <li><b>前端 loadEmailRecipientHistory</b>：展示 用户名 &lt;邮箱&gt; / 邮箱 两种形式</li>
                            <li><b>发送成功后</b>：自动清空已选 + 刷新历史 + 刷新记录</li>
                            <li>emailClearSelected 添加到发送成功链</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.88b',
                    date: '2026-06-24',
                    content: `
                        <h4>邮件配置健康检查端点 + bug 修复</h4>
                        <ul>
                            <li><b>/health/mail</b>：返回 active_provider（GAS / SendGrid / Gmail_SMTP）以及 env 加载状态</li>
                            <li>修复 SENDGRID_API_KEY 误用 var 声明被覆盖的隐患</li>
                            <li>修复 /admin/report/:id/delete-post 和 /admin/report/:id/ban-user 端点缺少顶层 try-catch</li>
                            <li>修复 index.html / README.md / CHANGELOG.md 版本号不一致</li>
                            <li>升级 pro-upgrade.js query string 版本号到 20260624_progift</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.88a',
                    date: '2026-06-24',
                    content: `
                        <h4>Google Apps Script (GAS) 邮件中转通道上线</h4>
                        <ul>
                            <li><b>GAS HTTPS 443 中转</b>：绕过 Render SMTP 465/587 端口封锁</li>
                            <li><b>发送优先级</b>：GAS (HTTPS 443) > SendGrid > Gmail SMTP（最终兜底）</li>
                            <li><b>失败链</b>：GAS 失败 → SendGrid → Gmail SMTP</li>
                            <li><b>GMAIL_GAS_URL 环境变量</b>：必须在 Render Dashboard 准确填入 Key/Value，不能有空格</li>
                            <li><b>GAS Web App</b>：部署权限必须设为"任何人"（Anyone）以允许未认证请求</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.87',
                    date: '2026-06-24',
                    content: `
                        <h4>安全修复</h4>
                        <ul>
                            <li><b>【严重】</b>邮件发送记录泄露到帖子首页：<code>__email_sent__</code> 全量加入所有 SQL 过滤链 + 客户端过滤链（共 21 处），刷新即消失</li>
                            <li><b>Cookie maxAge 单位修复</b>：原来写的是秒（72秒过期），改为毫秒（72小时）</li>
                            <li><b>管理员 token 不再暴露前端 localStorage</b>：/admin/login 不再返回 token，前端登录后不写 localStorage，全走 HttpOnly Cookie + credentials: same-origin</li>
                            <li><b>吊销 token 持久化修复</b>：loadRevokedTokenHashes select 补 id 字段，清理时 r.id 存在；persistRevokedToken 后立即加入内存集合</li>
                            <li><b>用户删除后旧 token 失效</b>：authenticateUser 额外查询 __auth__ 记录确认用户仍存在</li>
                            <li><b>移除 query.password_hash</b>：authenticateUser 不再接受 URL query 传 password_hash，只允许 body/Authorization</li>
                            <li><b>审计日志 operator 修复</b>：verifyToken 统一设置 req.adminUser</li>
                        </ul>
                        <h4>Bug 修复</h4>
                        <ul>
                            <li><b>Pro badge 过期显示修复</b>：isVipUser() 加强 expire_at 判断，updateVipStatus() 防止 API 返回空 active_vip 时错误标记为 Pro</li>
                            <li><b>Pro 赠送创建新活动按钮</b>：添加 progift 懒加载映射，Cookie 适配后按钮可正常打开</li>
                            <li><b>懒加载数据赋值修复</b>：reports 数据赋值到 reportsData、mutes 到 mutesData、新增 blacklist 分支</li>
                            <li><b>page_visit 无 password_hash 不发送</b>：改为有 token 也能发送</li>
                            <li><b>Cookie 登录后后台卡死</b>：loadAllData / fetchRegisterAlerts / renderPostsTab 等 5 处 getToken() 门禁全部移除</li>
                            <li><b>退出登录不清理 Cookie</b>：doAdminLogout 无论有无 localStorage token 都请求 /admin/logout</li>
                        </ul>
                        <h4>新增</h4>
                        <ul>
                            <li><b>邮件历史邮箱账户</b>：发送邮件后自动保存收件人历史，管理员可点选/删除/清空</li>
                            <li><b>邮箱后缀快速补全</b>：输入账号时实时显示 @qq.com / @163.com / @gmail.com 等 9 个后缀</li>
                        </ul>
                        <h4>性能</h4>
                        <ul>
                            <li>/admin/data 去掉 3 个重量级查询（reports/mutes/blacklist），改为按 tab 懒加载</li>
                            <li>移除初始化 500ms 后自动预加载 users/security/audit/errorlog/photos</li>
                            <li>邮件 SMTP 端口自动回退：465 SSL 失败自动重试 587 STARTTLS</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.86',
                    date: '2026-06-23',
                    content: `
                        <h4>全面 Bug 修复 & 支付事务保护</h4>
                        <ul>
                            <li><b>VIP 支付事务保护</b>：先写 VIP 记录再更新订单状态，避免"付了钱没开通"</li>
                            <li><b>头像上传回滚</b>：先插入新记录再删旧记录，防止头像丢失</li>
                            <li><b>登出彻底清理</b>：遍历所有 xtj_* 前缀 localStorage，避免跨用户缓存泄露</li>
                            <li><b>Observer 内存泄漏</b>：beforeunload 时 disconnect 所有 IntersectionObserver</li>
                            <li><b>乱码修复立即生效</b>：_buildMjRegex IIFE 加载时执行，任意时机可用</li>
                            <li><b>浏览器兼容</b>：deviceMemory / hardwareConcurrency 加 typeof 检查</li>
                            <li>visitCache 改为 setTimeout 异步清理，不阻塞事件循环</li>
                            <li>Supabase 初始化检查，无效时 sb = null</li>
                            <li>desktop.css / core.js 等 query string 版本号升级</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.85',
                    date: '2026-06-23',
                    content: `
                        <h4>全量安全审计修复、设备识别大幅升级、聊天头像即时更新</h4>
                        <ul>
                            <li><b>Pro 赠送活动系统</b>：管理员后台创建/编辑/发布 Pro 赠送活动，用户一键免费领取</li>
                            <li><b>Pro 历史记录系统</b>：后台新增「Pro记录」子标签，展示用户开通次数/来源/时间线</li>
                            <li>Pro 领取庆祝动画重做：暗色渐变卡片，显示来源信息，GSAP 分段入场</li>
                            <li><b>【安全】</b>XSS 高危漏洞修复（safeJsStr 全转义 + 注册字符限制）</li>
                            <li><b>【安全】</b>Storage 路径遍历防护、后端错误信息不返回前端</li>
                            <li><b>【安全】</b>RateLimit 边界修复、fetch 超时保护、currentUser TDZ 修复</li>
                            <li><b>【安全】</b><code>window.sb</code> 不再被 admin.js 删除，前后台可共存</li>
                            <li>设备型号识别升级：新增 UA 标识符映射表，15 Pro Max 不再误判为 16 Plus</li>
                            <li>聊天列表头像即时更新：全量检查头像并刷新列表 DOM</li>
                            <li>地区中文显示：<code>China·Guangdong·Guangzhou</code> → 广东广州</li>
                            <li>用户详情卡片数据回填：最近访问/IP/地区/设备从登录事件自动回填</li>
                            <li>用户详情弹窗去掉最近安全提醒区块</li>
                            <li>举报弹窗 × 按钮独立样式修复</li>
                            <li>点赞/评论记录显示被操作人（xxz 点赞了 yy 的内容）</li>
                            <li>未登录用户隐藏帖子页三大数据版块</li>
                            <li>管理员登出清理定时器与事件监听</li>
                            <li>邮箱发件地址修正：Resend 免费版强制使用 onboarding@resend.dev</li>
                            <li>管理员邮箱发送结果展示详细失败原因</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>设备识别链路重做：UA 标识符优先，分辨率推断降级为兜底</li>
                            <li>注册入口增加字符集与长度双重校验</li>
                            <li>设备详情弹出卡从内联展开改为 860px 模态框</li>
                            <li>后台登出时完整清理定时器与事件监听</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做设备型号识别引擎：UA 标识符映射优先</li>
                            <li>重做聊天列表头像更新机制：每次全量刷新</li>
                            <li>重做后台会话管理：登出时完整清理</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.84',
                    date: '2026-06-22',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>管理后台新增"🛡️ 安全中心"：同 IP 多账号、同设备多账号、多 IP 同账号、地区变化、高频访问五类安全提醒</li>
                            <li>安全提醒支持已读、忽略、误报三种处理状态</li>
                            <li>客户端温和浏览器指纹 + Canvas 指纹 Hash（仅保存 hash，不存图像/像素）</li>
                            <li>前端错误监控：JS error、unhandledrejection、fetch 失败、图片加载失败、白屏检测自动上报</li>
                            <li>管理员操作审计日志：所有敏感操作全记录</li>
                            <li>日志保留与清理：登录/安全日志 90 天，错误日志 30 天</li>
                            <li>用户详情弹窗：点击用户名查看完整信息（IP、地区、设备、指纹、统计、登录记录、安全提醒、处罚历史）</li>
                            <li>风险评分系统：用户列表显示"正常/低风险/中风险/高风险"</li>
                            <li>安全识别开关：可独立控制基础设备、浏览器指纹、Canvas 指纹、安全提醒的采集与生成</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>用户列表最近 IP 改为完整显示，不再打码</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>IP 地区解析改为多源 fallback</li>
                            <li>登录事件写入后同步更新用户信息</li>
                            <li>页面访问冷却改为 15 秒</li>
                        </ul>
                        <h4>安全</h4>
                        <ul>
                            <li>所有敏感数据仅限管理员后台查看，前台不泄露</li>
                            <li>指纹仅作辅助判断，不做跨站追踪</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.83',
                    date: '2026-06-21',
                    content: `
                        <h4>修复</h4>
                        <ul>
                            <li>统计弹窗恢复到旧版记录布局，不再继续沿用 <code>statHero</code> / <code>stat-row</code> 的面板化样式</li>
                            <li>“总动态”恢复为按用户分组的列表结构，组头只保留头像首字母、用户名和条数胶囊</li>
                            <li>修复总动态中坏标签、乱码、时间与内容挤在一起、移动端时间断行等问题</li>
                            <li>修复“总浏览”“点赞和评论”里图片帖只剩文字、原帖缩略图缺失、评论内容不独立显示的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>总浏览统一改回图文记录卡，浏览图片帖时优先显示真实缩略图，视频帖显示视频占位</li>
                            <li>点赞记录与评论记录统一为旧版风格记录卡，原帖查不到时明确显示“原帖已删除”</li>
                            <li>统计弹窗移动端布局收口为横向卡片，时间保持单行省略，不再退回竖排</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做统计弹窗恢复策略：以 Git 历史旧版结构为基线回退，而不是继续在当前救火覆盖层上叠补丁</li>
                            <li>重做版本同步到 <code>v0.83</code>，让关于页、站内 changelog、仓库文档与构建产物保持一致</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.82',
                    date: '2026-06-21',
                    content: `
                        <h4>修复</h4>
                        <ul>
                            <li>修复首页三大统计卡片点击后弹窗无响应的问题，“总动态 / 总浏览 / 点赞和评论” 重新可打开 <code>#statModal</code></li>
                            <li>修复 <code>js/core.js</code> 中 <code>applyPerformanceMode()</code> 的作用域错误，避免脚本在初始化阶段中断</li>
                            <li>修复旧版 <code>bindHeaderActionButtons()</code> 与最终全局导出互相干扰，导致公告与举报入口失效的问题</li>
                            <li>修复顶部公告按钮与举报按钮的运行时入口链路，点击后不再被前序异常打断</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>首页入口排查改为以浏览器真实点击结果为准，优先定位真实 <code>runtime blocker</code></li>
                            <li>入口验证改为 <code>node --check</code>、<code>npm run build</code> 与浏览器点击结果三层校验</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做首页入口修复思路：从静态绑定补丁改为先清理前序 runtime blocker，再让最终全局入口生效</li>
                            <li>重做统计 / 公告 / 举报的修复标准，以真实 modal 打开结果为准，而不是只看函数名是否存在</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.81',
                    date: '2026-06-20',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>后台新增“新用户注册提醒”，只统计 <code>__auth__</code> 注册记录，并在“用户数据”入口显示红点数字</li>
                            <li>新增 <code>/admin/users/register-alerts</code> 和 <code>/admin/users/register-alerts/read</code> 两个后台接口</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复后台用户统计口径不一致：<code>/admin/stats/users</code> 现在统一聚合 <code>__auth__</code>、<code>__user_info__</code>、<code>__user_visit__</code></li>
                            <li>修复 <code>/admin/stats/daily</code> 中 <code>new_users</code> 被重复注册记录放大的问题，改为按用户名去重后只认最早注册时间</li>
                            <li>修复 <code>/admin/stats</code> 顶部 <code>total_users</code> 被重复 <code>__auth__</code> 记录放大的问题</li>
                            <li>修复照片墙全屏预览在 iPhone / iPad 上双指缩放乱飞、松手跳变、误触单击缩放的问题</li>
                            <li>修复 pinch 结束后松开一根手指继续拖图时沿用旧起点，导致图片突然跳回旧坐标的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>照片墙移动端预览手势统一为单一状态机，pinch / pan / swipe / dismiss 明确互斥</li>
                            <li>后台首次打开注册提醒时默认只统计最近 24 小时新注册用户，避免历史数据一次性冲上红点</li>
                            <li>pinch 结束后增加至少 <code>350ms</code> 的 tap / doubleTap 屏蔽窗口，避免误触把图片立刻缩回原图</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做后台注册用户统计链路，让注册数、用户总数、访问明细三处统一按用户名去重</li>
                            <li>重做照片墙移动端预览热修复策略，改为由 <code>preview-hotfix.js</code> 统一接管移动端触摸手势，并对齐 hotfix 标记</li>
                            <li>重做 pinch 到 pan 的交接逻辑，双指结束后立即以剩余手指重建拖拽起点</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.80',
                    date: '2026-06-18',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>照片墙单次加载数量从 20 提升到 60，首次进入即可看到更多历史内容</li>
                            <li>导出 <code>window.normalizePhotoWallRow</code>，上传完成后新照片可以即时插入当前列表</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复照片墙仍命中旧缓存导致只显示陈旧数据的问题</li>
                            <li>修复老视频无 thumb 时直接显示空白块的问题，补上运行时首帧封面兜底</li>
                            <li>修复多处前端 XSS 风险、调试输出残留与重复 BOM 问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>将 <code>admin.html</code> 的 Supabase CDN 脚本改为 defer，减少阻塞</li>
                            <li>将 <code>ui-enhance.css</code> 提前到 head 加载，减少样式闪动</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做照片墙数据链路，从缓存优先收口为实时读取 + 更大首屏批量</li>
                            <li>重做上传后同步链路，标准化数据、即时插入、清缓存、强制重取统一到一条路径</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.79',
                    date: '2026-06-15',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>帖子视频与照片墙视频统一按 10MB 规则处理，超过阈值会先尝试浏览器端压缩</li>
                            <li>照片墙老视频补上运行时首帧封面兜底，避免无 thumb 时直接露出空白块</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复非 Pro 用户帖子误显示 Pro 标记的问题，渲染只认发帖冻结状态与历史有效期</li>
                            <li>修复举报弹层文字帖重复显示作者名与“文字帖”标签挡内容的问题</li>
                            <li>修复照片墙视频点击入口与全屏预览链路不一致的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>视频大小信息统一优先展示最终上传大小 fileSize，并保留 originalSize 供详情查看</li>
                            <li>举报弹层顶部收敛为单标题 + 图标按钮，减少重复入口</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做举报弹层文字帖卡片骨架与记录入口样式，统一成更简洁的内容优先结构</li>
                            <li>重做 v0.79 版本同步链路，关于页、站内 changelog、仓库 CHANGELOG.md 三处统一</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.78',
                    date: '2026-06-14',
                    content: `
                        <h4>版本与更新日志同步</h4>
                        <ul>
                            <li>关于页版本显示统一更新为 xtj v0.78</li>
                            <li>站内更新日志补充 v0.78 版本记录</li>
                            <li>仓库 CHANGELOG.md 与站内版本记录同步，避免版本信息分裂</li>
                        </ul>
                        <h4>文案整理</h4>
                        <ul>
                            <li>本次版本记录按正式发布口径重新整理，保留清晰的分节结构</li>
                            <li>继续保留 Remade 板块，用来标记重做、重写、重构类更新</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做了版本记录的同步方式，让关于页版本号、站内 changelog、仓库 changelog 三处保持一致</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.77',
                    date: '2026-06-13',
                    content: `
                        <h4>版本号与更新日志同步</h4>
                        <ul>
                            <li>版本展示统一更新为 xtj v0.77</li>
                            <li>更新日志补充 v0.77 版本记录</li>
                            <li>保持当时的浅绿色 UI 基底，不引入后续蓝化样式调整</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.76',
                    date: '2026-06-12',
                    content: `
                        <h4>按钮点击修复、安全加固与全模块 Bug 修复</h4>
                        <ul>
                            <li>通知/举报/Pro/点赞评论记录按钮点击无响应问题全面修复</li>
                            <li>帖子显示兜底机制：IntersectionObserver 异常时自动降级为可见</li>
                            <li>举报弹窗顶部新增「举报表单」「举报记录」切换标签，与 JS 事件绑定对齐</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>API_BASE 始终使用 window.location.origin，支持任意自定义域名</li>
                            <li>照片墙 upload.min.js 被重复加载导致事件重复绑定</li>
                            <li>/api/photo/delete 安全漏洞：username 不允许为空，必须校验照片归属</li>
                            <li>访问统计中间件放在 express.static 之后导致 GET / 不记录访问</li>
                            <li>删除公告时重新生成 actor_key 导致 RLS 校验失败</li>
                            <li>举报列表未过滤 __vip__、__vip_order__、__user_visit__ 等内部记录</li>
                        </ul>
                        <h4>安全</h4>
                        <ul>
                            <li>照片删除 API 未校验 username 可被任意删除照片的安全漏洞</li>
                            <li>公告删除 RPC 调用传递错误 actor_key 导致 RLS 校验失败的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>IntersectionObserver 增加 try/catch 保护，兼容不支持该 API 的旧浏览器</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.74',
                    date: '2026-06-10',
                    content: `
                        <h4>安全审计全面修复</h4>
                        <ul>
                            <li>修复 Supabase RLS 策略中 AUTH_MARKER 未正确排除 __auth__ 记录的安全漏洞</li>
                            <li>修复 X-Forwarded-For IP 伪造防护：改用 express trust proxy + req.ip</li>
                            <li>修复 CSRF Origin 校验使用 includes() 子串匹配可被绕过的漏洞</li>
                            <li>移除前端重复硬编码的 Supabase URL 和 Anon Key，统一从 config.js 读取</li>
                            <li>管理后台举报处理 API 全部增加数据库操作错误检查和回滚逻辑</li>
                        </ul>
                        <h4>性能与内存泄漏修复</h4>
                        <ul>
                            <li>rateLimitStore 新增每5分钟过期记录自动清理，防止内存无限增长</li>
                            <li>adminTokens 新增每10分钟过期 token 自动清理</li>
                            <li>visitCache 访问去重改用按天清理旧记录，不再全量清除导致统计虚高</li>
                            <li>statsCache 新增并发锁防止多请求重复触发数据库查询</li>
                            <li>统计查询 limit(100000) 降为 20000，减少数据库压力</li>
                            <li>新增 8 条数据库性能索引 SQL（posts/likes/comments/bans/mutes/blacklist）</li>
                        </ul>
                        <h4>加载动画全面升级</h4>
                        <ul>
                            <li>移除旧版 Canvas 春日藤蔓蝴蝶加载动画（~530 行 JS），替换为纯 CSS 照片墙同款动画</li>
                            <li>新动画采用双旋转光环 + 脉冲核心 + 光点轨道设计，GPU 加速渲染流畅不掉帧</li>
                            <li>修复加载动画阻塞内容渲染问题：头像改为后台异步加载，内容立即渲染字母占位头像</li>
                            <li>清理 upload-ui.js 中重复定义的 buildPostPreviewItems 和 ppRotatePhoto 死代码</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重写了加载动画系统，从 Canvas 逐帧绘制改为纯 CSS 动画，页面冷启动加载速度显著提升</li>
                            <li>重构了帖子渲染管线，头像和内容解耦，首屏内容即刻可见不再等待头像加载</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.73',
                    date: '2026-06-08',
                    content: `
                        <h4>管理员禁言拉黑功能验证与全面更新</h4>
                        <ul>
                            <li>后台“用户数据-禁言拉黑”空白问题完整诊断：确认是数据库无活跃记录导致的正常空状态</li>
                            <li>插入三条测试禁言记录验证全链路：API → 数据库 → 前端渲染均正常工作</li>
                            <li>测试覆盖真实用户 11（24小时禁言）、徐廷江（永久禁言），状态徽章和筛选正确展示</li>
                            <li>标签页切换时按需自动拉取最新 bans/mutes/blacklist 数据，数据实时同步</li>
                            <li>用户列表页禁言中/拉黑封禁中筛选与数据库实时同步，筛选结果准确</li>
                        </ul>
                        <h4>安全加固</h4>
                        <ul>
                            <li>通过 Supabase service_role key 验证 RLS 策略配置正确，管理员 API 可绕过行级安全策略</li>
                            <li>确认 JWT 鉴权 + 速率限制 + 输入校验三层防护在禁言拉黑 API 上全部生效</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重写了管理员后台数据加载策略，从一次性加载改为按标签页按需拉取，性能更优</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.71',
                    date: '2026-06-06',
                    content: `
                        <h4>安全审计全面修复与黑名单管理上线</h4>
                        <ul>
                            <li>移除前端硬编码管理员密码，改为后端 API + 环境变量认证</li>
                            <li>新增 CORS 白名单限制、安全响应头、API 频率限制</li>
                            <li>新增输入长度校验、错误信息脱敏、文件上传类型与大小校验</li>
                            <li>增强密码策略：注册密码最小长度提升至 6 位</li>
                            <li>黑名单管理上线：后端 API + 管理后台界面全套 CRUD</li>
                            <li>用户限制状态轮询：15 秒检查拉黑/封禁/禁言状态，即时生效</li>
                            <li>后端管理 API 全面重写：JWT Token 鉴权 + 频率限制 + 输入校验 + 错误脱敏四层防护</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.70',
                    date: '2026-06-05',
                    content: `
                        <h4>后台管理大更新</h4>
                        <ul>
                            <li>用户列表 UI 全面美化：卡片式网格布局 + 筛选排序搜索</li>
                            <li>筛选功能：按状态（全部/管理员/拉黑封禁中/禁言中）快速筛选</li>
                            <li>排序功能：按注册时间/最近登录/帖子数排序</li>
                            <li>拉黑封禁表和禁言表新增解除时间列，一目了然</li>
                            <li>封禁改名为拉黑封禁，移除冗余的黑名单版块</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复用户列表最近登录时间显示旧数据问题</li>
                            <li>修复管理面板初始化未加载 bans/mutes 数据</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做了后台用户列表 UI 和交互体验，更清晰直观</li>
                        </ul>
                    `
                },
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
            // 缁戝畾锟叫伙拷浜嬩欢
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 娣囶喗鏁奸崢鐔告箒锟?showAnnouncementList 以支持当前标签状??
            const originalShowAnnouncementList = showAnnouncementList;
            window.showAnnouncementList = function() {
                if (currentAnnouncementTab !== 'announcements') {
                    switchAnnouncementTab('announcements');
                }
                originalShowAnnouncementList();
            };

        // ===================== 举报功能 =====================
        var _reportType = 'post';
        var _reportView = 'form';
        var _reportSelectedId = null;
        var _reportSelectedReason = null;
        var _reportTargetUser = null;
        var _reportContentData = [];

        function getReportViewNodes() {
            return {
                formPanel: document.getElementById('reportModalFormBody')
            };
        }

        function resetReportModalScroll() {
            var scroller = document.querySelector('#reportModal .report-modal-content');
            if (scroller) scroller.scrollTop = 0;
        }

            function normalizeReportModalStructure() {
                var overlay = document.getElementById('reportModal');
                if (!overlay || overlay.dataset.normalized === '1') return;
            var headerLeft = overlay.querySelector('.report-modal-header-left');
            if (headerLeft) {
                headerLeft.innerHTML = '<span>举报</span><button class="report-records-btn" id="reportRecordsToggleBtn" onclick="toggleReportRecords()" aria-label="打开举报记录">举报记录</button>';
            }
            var closeBtn = overlay.querySelector('.report-modal-close');
            if (closeBtn) {
                closeBtn.setAttribute('aria-label', '关闭');
                closeBtn.textContent = '✕';
            }
            var recordsPanel = document.getElementById('reportRecordsPanel');
            if (recordsPanel && recordsPanel.parentNode) {
                recordsPanel.parentNode.removeChild(recordsPanel);
            }
            var labels = overlay.querySelectorAll('.report-field > label');
            if (labels[0]) labels[0].textContent = '选择举报类型';
            if (labels[1]) labels[1].textContent = '选择要举报的内容';
            if (labels[2]) labels[2].textContent = '举报原因';
            var typeButtons = overlay.querySelectorAll('.report-type-tab');
            if (typeButtons[0]) typeButtons[0].textContent = '帖子';
            if (typeButtons[1]) typeButtons[1].textContent = '照片墙';
            var reasonMap = ['垃圾广告', '色情低俗', '人身攻击', '虚假信息', '侵权内容', '违规内容'];
            overlay.querySelectorAll('.report-reason-btn').forEach(function(btn, index) {
                var label = reasonMap[index];
                if (!label) return;
                btn.dataset.reason = label;
                btn.textContent = label;
            });
            var customReason = document.getElementById('reportCustomReason');
            if (customReason) customReason.setAttribute('placeholder', '补充说明（选填）');
            var submitBtn = document.getElementById('reportSubmitBtn');
            if (submitBtn) submitBtn.textContent = '提交举报';
            var loadingNode = document.querySelector('#reportContentList .report-loading');
            if (loadingNode) loadingNode.textContent = '加载中...';
            overlay.dataset.normalized = '1';
        }

        function getReportSelectedItem() {
            return (_reportContentData || []).find(function(item) {
                return String(item.id) === String(_reportSelectedId);
            }) || null;
        }

        function formatReportTime(value) {
            if (!value) return '';
            try {
                return new Date(value).toLocaleString();
            } catch(_) {
                return '';
            }
        }

        function formatReportDate(value) {
            if (!value) return '';
            try {
                return new Date(value).toLocaleDateString();
            } catch(_) {
                return '';
            }
        }

        function getReportTextThumbLabel(userName) {
            var name = String(userName || '匿名').trim();
            return escapeHtml(name.length > 4 ? name.slice(0, 4) : name);
        }

        function buildReportSelectedPreview(item) {
            if (!item) {
                return '<div class="report-selected-empty">还没有选择举报对象，请先从上方列表中选择一条内容。</div>';
            }
            var itemType = item.type === 'photo' ? '照片墙' : '帖子';
            var userName = escapeHtml(item.user_name || _reportTargetUser || '未知');
            var text = escapeHtml(item.text || (item.thumb ? '已选择图片内容' : '已选择内容'));
            var isTextOnly = !item.thumb && item.type !== 'photo';
            if (isTextOnly) {
                return [
                    '<div class="report-selected-top report-selected-top--text">',
                    '<span class="report-selected-name-badge">' + getReportTextThumbLabel(item.user_name) + '</span>',
                    item.created_at ? '<span class="report-selected-time">' + escapeHtml(formatReportDate(item.created_at)) + '</span>' : '',
                    '</div>',
                    '<div class="report-selected-text">' + text + '</div>'
                ].join('');
            }
            return [
                '<div class="report-selected-top">',
                '<span class="report-selected-chip">' + escapeHtml(itemType) + '</span>',
                '<span class="report-selected-user">发布者：' + userName + '</span>',
                '</div>',
                '<div class="report-selected-text">' + text + '</div>'
            ].join('');
        }

        function updateReportSelectedPreview() {
            var info = document.getElementById('reportSelectedInfo');
            if (!info) return;
            var preview = info.querySelector('.report-selected-preview');
            if (!preview) return;
            preview.innerHTML = buildReportSelectedPreview(getReportSelectedItem());
        }

        window.switchReportView = async function(view) {
            if (view === 'records') {
                _reportView = 'records';
                await window.toggleReportRecords();
                return;
            }
            _reportView = 'form';
            var nodes = getReportViewNodes();
            if (nodes.formPanel) {
                nodes.formPanel.classList.add('active');
                nodes.formPanel.setAttribute('aria-hidden', 'false');
            }
            resetReportModalScroll();
        };

        window.openReportModal = function() {
            if (!currentUser) { showToast('请先登录'); return; }
            if (typeof clearReportReplyBadge === 'function') clearReportReplyBadge();
            var overlay = document.getElementById('reportModal');
            if (!overlay) return;
            normalizeReportModalStructure();
            if (!window.__xtjReportModalPrimedV1) {
                ensureReportHistoryModal();
                window.__xtjReportModalPrimedV1 = true;
            }
            _reportType = 'post';
            _reportView = 'form';
            _reportSelectedId = null;
            _reportSelectedReason = null;
            _reportTargetUser = null;
            _reportContentData = [];
            document.querySelectorAll('.report-type-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.type === 'post');
            });
            document.querySelectorAll('.report-reason-btn').forEach(function(b) { b.classList.remove('selected'); });
            document.getElementById('reportCustomReason').value = '';
            document.getElementById('reportSubmitBtn').disabled = true;
            document.getElementById('reportError').style.display = 'none';
            document.getElementById('reportError').textContent = '';
            updateReportSelectedPreview();
            overlay.classList.add('active');
            window.closeReportHistoryModal();
            syncReportModalBodyLock();
            resetReportModalScroll();
            var formBody = document.getElementById('reportModalFormBody');
            if (formBody) {
                formBody.classList.add('active');
                formBody.setAttribute('aria-hidden', 'false');
            }
            loadReportContentList();
            var dialog = document.getElementById('reportModalDialog');
            if (dialog && typeof dialog.focus === 'function') {
                setTimeout(function() {
                    try { dialog.focus(); } catch(_) {}
                }, 0);
            }
        };

        window.closeReportModal = function() {
            var overlay = document.getElementById('reportModal');
            if (!overlay) return;
            overlay.classList.remove('active');
            window.closeReportHistoryModal();
            syncReportModalBodyLock();
        };

        window.switchReportType = function(type) {
            _reportType = type;
            _reportSelectedId = null;
            _reportTargetUser = null;
            document.querySelectorAll('.report-type-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.type === type);
            });
            document.getElementById('reportSubmitBtn').disabled = true;
            updateReportSelectedPreview();
            loadReportContentList();
        };

        function resolveReportPhotoWallItem(post) {
            if (!post) return null;
            var parsed = {};
            try { parsed = post.content ? JSON.parse(post.content) : {}; } catch(_) {}
            if (post.media_url === '__deleted__' || parsed.__pw_del__ === true) {
                return null;
            }
            var normalized = null;
            if (typeof window.normalizePhotoWallRow === 'function') {
                try { normalized = window.normalizePhotoWallRow(post); } catch(_) {}
            }
            var thumb = '';
            if (normalized) {
                thumb = normalized.thumbUrl || normalized.thumb || normalized.imageUrl || '';
            }
            if (!thumb) {
                thumb = parsed.thumb || parsed.thumbUrl || parsed.url || parsed.image_url || post.media_url || '';
            }
            if (!thumb || thumb === '__deleted__') {
                return null;
            }
            var text = parsed.caption || parsed.title || parsed.content || '';
            if (text.length > 72) text = text.substring(0, 72) + '...';
            return {
                id: post.id,
                user_name: post.user_name,
                text: text || (normalized && normalized.mediaKind === 'video' ? '(视频)' : '(照片)'),
                thumb: thumb,
                type: 'photo',
                created_at: post.created_at,
                kindLabel: normalized && normalized.mediaKind === 'video' ? '照片墙视频' : '照片墙'
            };
        }

        function loadReportContentList() {
            var container = document.getElementById('reportContentList');
            if (!container) return;
            container.innerHTML = '<div class="report-loading">加载中...</div>';

            if (_reportType === 'post') {
                try {
                    applyVisiblePostQueryFilters(
                        sb.from('posts').select('id, user_name, content, media_url, media_type, created_at')
                    )
                        .order('created_at', { ascending: false })
                        .limit(200)
                        .then(function(res) {
                            _reportContentData = (res.data || []).map(function(p) {
                                var txt = p.content || '';
                                try {
                                    var j = JSON.parse(txt);
                                    txt = j.content || j.title || j.caption || j.text || (typeof j === 'object' ? '' : txt) || '';
                                } catch(e) {}
                                var mediaType = String(p.media_type || '').toLowerCase();
                                var hasRenderableThumb = !!p.media_url && /^(https?:|data:|blob:)/i.test(String(p.media_url || ''));
                                if (!txt && hasRenderableThumb) txt = mediaType === 'video' ? '(视频)' : '(图片)';
                                if (txt.length > 72) txt = txt.substring(0, 72) + '...';
                                return {
                                    id: p.id,
                                    user_name: p.user_name,
                                    text: txt,
                                    thumb: hasRenderableThumb ? p.media_url : '',
                                    type: 'post',
                                    created_at: p.created_at,
                                    kindLabel: hasRenderableThumb ? (mediaType === 'video' ? '视频帖' : '图片帖') : '文字帖'
                                };
                            }).filter(function(item) { return item.text || item.thumb; });
                            renderReportContentList(container);
                        }).catch(function() {
                            container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                        });
                } catch(e) {
                    container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                }
            } else {
                try {
                    sb.from('posts')
                        .select('id, user_name, content, media_url, media_type, created_at')
                        .eq('media_type', '__photo_wall__')
                        .order('created_at', { ascending: false })
                        .limit(200)
                        .then(function(res) {
                            _reportContentData = (res.data || []).map(resolveReportPhotoWallItem).filter(Boolean);
                            renderReportContentList(container);
                        }).catch(function() {
                            container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                        });
                } catch(e) {
                    container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                }
            }
        }

        function renderReportContentList(container) {
            if (!_reportContentData.length) {
                container.innerHTML = '<div class="report-loading">暂无内容</div>';
                return;
            }
            var h = '';
            _reportContentData.forEach(function(item) {
                var selected = _reportSelectedId === item.id ? ' selected' : '';
                var isTextOnly = !item.thumb && item.type !== 'photo';
                var thumbHtml = item.thumb
                    ? '<img class="rc-thumb" src="' + escapeHtml(item.thumb) + '" alt="" loading="lazy" onerror="var card=this.closest(&quot;.report-content-item&quot;); if(card){card.remove();}">'
                    : '<div class="rc-thumb rc-thumb--text" aria-hidden="true"><span>' + getReportTextThumbLabel(item.user_name) + '</span></div>';
                h += '<div class="report-content-item' + selected + (isTextOnly ? ' report-content-item--text' : '') + '" data-id="' + escapeHtml(item.id) + '" data-user="' + escapeHtml(item.user_name) + '" onclick="selectReportContent(this)">';
                h += thumbHtml;
                h += '<div class="rc-info' + (isTextOnly ? ' rc-info--text' : '') + '">';
                if (isTextOnly) {
                    h += '<div class="rc-meta rc-meta--text">' + (item.created_at ? '<span class="rc-time">' + escapeHtml(formatReportDate(item.created_at)) + '</span>' : '') + '</div>';
                } else {
                    h += '<div class="rc-meta"><div class="rc-user">' + escapeHtml(item.user_name) + '</div><span class="rc-type">' + escapeHtml(item.kindLabel || (item.type === 'photo' ? '照片墙' : '帖子')) + '</span>' + (item.created_at ? '<span class="rc-time">' + escapeHtml(formatReportDate(item.created_at)) + '</span>' : '') + '</div>';
                }
                h += '<div class="rc-text">' + escapeHtml(item.text || (item.thumb ? '图片内容' : '无文字内容')) + '</div>';
                h += '</div></div>';
            });
            container.innerHTML = h;
            updateReportSelectedPreview();
        }

        window.selectReportContent = function(el) {
            var id = el.dataset.id;
            _reportSelectedId = id;
            _reportTargetUser = el.dataset.user;
            document.querySelectorAll('#reportContentList .report-content-item').forEach(function(item) {
                item.classList.toggle('selected', item.dataset.id === id);
            });
            updateReportSubmitState();
            updateReportSelectedPreview();
        };

        window.selectReportReason = function(btn) {
            var reason = btn.dataset.reason;
            if (_reportSelectedReason === reason) {
                _reportSelectedReason = null;
                btn.classList.remove('selected');
            } else {
                document.querySelectorAll('.report-reason-btn').forEach(function(b) { b.classList.remove('selected'); });
                _reportSelectedReason = reason;
                btn.classList.add('selected');
            }
            updateReportSubmitState();
        };

        function updateReportSubmitState() {
            var btn = document.getElementById('reportSubmitBtn');
            if (!btn) return;
            btn.disabled = !(_reportSelectedId && _reportSelectedReason);
        }

        window.submitReport = async function() {
            if (!_reportSelectedId || !_reportSelectedReason) {
                document.getElementById('reportError').style.display = 'block';
                document.getElementById('reportError').textContent = '请选择举报内容和举报原因';
                return;
            }
            var btn = document.getElementById('reportSubmitBtn');
            var errEl = document.getElementById('reportError');
            btn.disabled = true;
            btn.textContent = '提交中...';
            errEl.style.display = 'none';

            var customReason = document.getElementById('reportCustomReason').value.trim();
            var finalReason = customReason ? _reportSelectedReason + '：' + customReason : _reportSelectedReason;

            try {
                if (typeof API_BASE !== 'undefined' && API_BASE) {
                    var res = await fetch(API_BASE + '/api/report', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            reporter_name: currentUser,
                            target_type: _reportType,
                            target_id: _reportSelectedId,
                            target_user: _reportTargetUser,
                            report_category: _reportSelectedReason,
                            report_reason: finalReason
                        })
                    });
                    var data = await res.json();
                    if (!res.ok) throw new Error(data.error || '提交失败');
                } else {
                    if (!window.sb) throw new Error('数据库连接未初始化，请刷新页面重试');
                    if (!currentUser) throw new Error('请先登录');
                    var reportContent = JSON.stringify({
                        target_type: _reportType,
                        target_id: _reportSelectedId,
                        target_user: _reportTargetUser,
                        report_category: _reportSelectedReason,
                        report_reason: finalReason,
                        status: 'pending'
                    });
                    var result = await window.sb.from('posts').insert([{
                        user_name: currentUser,
                        content: reportContent,
                        media_type: REPORT_MARKER,
                        actor_key: REPORT_MARKER
                    }]);
                    if (result.error) throw new Error(result.error.message);
                }
                window.showToast('举报已提交，管理员会尽快处理', 'success');
                closeReportModal();
            } catch(e) {
                console.error('[XTJ] submitReport error:', e);
                errEl.style.display = 'block';
                errEl.textContent = '提交失败：' + e.message;
                try { window.showToast('提交失败：' + e.message, 'error'); } catch(_) {}
            } finally {
                btn.disabled = false;
                btn.textContent = '提交举报';
            }
        };

        var reportOverlay = document.getElementById('reportModal');
        if (reportOverlay) {
            reportOverlay.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closeReportModal();
            });
        }

        (function installUiTextRepair() {
            // This repair system is superseded by features.js which handles mojibake more accurately.
            // Only expose stop/repair hooks for backward compatibility.
            window.__xtjUiTextRepair = function(node) { return node; };
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
                    // console.log('[XTJ] All key functions loaded OK');
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

            var skeletonCardHtml = function(isChat) {
                if (isChat) {
                    return [
                        '<div class="xtj-loading-skeleton xtj-loading-skeleton--chat">',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '</div>'
                    ].join('');
                }
                return [
                    '<div class="xtj-loading-skeleton">',
                    '  <div class="xtj-skeleton-card">',
                    '    <div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                    '    <div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div>',
                    '  </div>',
                    '  <div class="xtj-skeleton-card">',
                    '    <div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                    '    <div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div>',
                    '  </div>',
                    '  <div class="xtj-skeleton-card">',
                    '    <div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                    '    <div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div>',
                    '  </div>',
                    '</div>'
                ].join('');
            };
            window.__xtjSkeletonCardHtml = skeletonCardHtml;

            window.xtjMagicLoadingHtml = function(title, subtitle, variant) {
                var mode = String(variant || '');
                if (mode === 'chat-list' || mode === 'chat-detail') {
                    return skeletonCardHtml(true);
                }
                return skeletonCardHtml(false);
            };
            window.xtjInitSpringUltLoaders = function(root) {
                // No-op: spring loader removed
            };

            // Disabled on purpose: this global loader patch was replacing live content areas
            // after render, which could cause feed/chat content loss and persistent jank.
            if (false && typeof loadFeed === 'function' && !loadFeed.__xtjMagicLoaderV4) {
                var orig = loadFeed;
                loadFeed = window.loadFeed = function(forceRefresh) {
                    var r = orig.apply(this, arguments);
                    var feed = document.getElementById('feed');
                    if (feed && /loading-spinner|loading-text|内容加载中/.test(feed.innerHTML || '')) {
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
                    if (el && (el.querySelector('.chat-empty') || /加载中/.test(el.textContent || ''))) {
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
                    if (body && /loading-spinner|loading-text|加载中/.test(body.innerHTML || '')) {
                        body.innerHTML = magicHtml();
                        if (window.initAllSpringLoaders) {
                            window.initAllSpringLoaders(body);
                        }
                    }
                    return r;
                };
                openPostDetail.__xtjMagicLoaderV4 = true;
            }

            function patchNode(root) {
                // spring canvas loader removed — dead code
                return;
            }

            patchNode(document);
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
                        : '<img ' + detailMediaAttrs + ' data-actor-key="' + escapeHtml(String(normalizedPost.actor_key || "")) + '" data-can-delete="' + (canDeletePost(normalizedPost) ? '1' : '0') + '" src="' + escapeHtml(normalizedPost.media_url) + '" onclick="openImageViewer(\'' + safeJsStr(normalizedPost.media_url) + '\', this)" loading="lazy" decoding="async" fetchpriority="low" />'
                ) : '';
                var visibilityLabel = normalizedPost.visibility === 'private' ? '私密' : '公开';
                var contentText = String(normalizedPost.content || '').trim();
                var detailActions = [];
                if (canEditPost(normalizedPost)) {
                    detailActions.push('<button type="button" class="action-btn edit" onclick="openEditPost(\'' + String(normalizedPost.id).replace(/'/g, "\\'") + '\')">编辑</button>');
                }
                if (canDeletePost(normalizedPost)) {
                    detailActions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + String(normalizedPost.id).replace(/'/g, "\\'") + '\', \'' + String(normalizedPost.actor_key || "").replace(/'/g, "\\'") + '\')">删除</button>');
                }
                return [
                    '<article class="post-detail-shell post-detail-shell--clean">',
                    '  <section class="post-detail-main-card">',
                    '    <header class="post-detail-top">',
                    '      <div class="post-detail-owner">',
                    '        <div class="post-detail-avatar">' + escapeHtml(String(normalizedPost.user_name || '?').slice(0, 1).toUpperCase()) + '</div>',
                    '        <div class="post-detail-owner-copy">',
                    '          <div class="pdh-name">' + escapeHtml(normalizedPost.user_name || '未知用户') + '</div>',
                    '          <div class="pdh-time">' + new Date(normalizedPost.created_at).toLocaleString() + '</div>',
                    '        </div>',
                    '      </div>',
                    '      <span class="post-detail-visibility">' + visibilityLabel + '</span>',
                    '    </header>',
                    mediaHtml ? '<div class="post-detail-media-card"><div class="post-detail-media">' + mediaHtml + '</div></div>' : '',
                    contentText ? '<div class="post-detail-content">' + escapeHtml(contentText) + '</div>' : '',
                    '    <div class="post-detail-stats">' + buildPostStatsLine(normalizedPost, (likes || []).length, (comments || []).length) + '</div>',
                    detailActions.length ? '<div class="post-detail-actions">' + detailActions.join("") + '</div>' : '',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack">',
                    '    <div class="post-detail-panel-title">点赞用户 <span>' + likes.length + '</span></div>',
                    likes.length ? likes.map(function(l) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(l.user_name) + '</div><div class="post-detail-mini-copy">留下了喜欢</div></div><span class="post-detail-mini-time">' + new Date(l.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无点赞</div>',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack">',
                    '    <div class="post-detail-panel-title">评论记录 <span>' + comments.length + '</span></div>',
                    comments.length ? comments.map(function(c) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(c.user_name) + '</div><div class="post-detail-mini-copy">' + escapeHtml(c.content || '无评论内容') + '</div></div><span class="post-detail-mini-time">' + new Date(c.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无评论</div>',
                    '  </section>',
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
                    return '<img class="' + thumbClass + '" src="' + escapeHtml(normalized.media_url) + '" alt="" loading="lazy" decoding="async" fetchpriority="low"' + clickAttr + titleAttr + ' />';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="' + thumbClass + ' ' + thumbClass + '--video"' + clickAttr + titleAttr + '>视频</div>';
                }
                return '';
            }

            function statMediaColumnMarkup(mediaHtml) {
                return mediaHtml ? '<div class="stat-row-media">' + mediaHtml + '</div>' : '';
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
                if (post.media_type === 'image' && post.media_url && typeof window.openPhotoPreview === 'function') {
                    var statPreviewPhoto = {
                        id: 'post_' + String(post.id || ''),
                        imageUrl: sanitizeUrl(post.media_url),
                        thumbUrl: sanitizeUrl(post.media_url),
                        username: String(post.user_name || ''),
                        timestamp: String(post.created_at || ''),
                        views: Number(post.views || 0) || 0,
                        fileSize: ((normalizePost(post)._contentMeta || {}).fileSize) || null,
                        originalSize: ((normalizePost(post)._contentMeta || {}).originalSize) || null,
                        __xtjSource: 'post',
                        __xtjPostId: String(post.id || ''),
                        __xtjActorKey: String(post.actor_key || ''),
                        __xtjCanDelete: !!canDeletePost(post)
                    };
                    window.__xtjPhotoPreviewContext = {
                        kind: 'post',
                        postId: statPreviewPhoto.__xtjPostId,
                        actorKey: statPreviewPhoto.__xtjActorKey,
                        canDelete: statPreviewPhoto.__xtjCanDelete
                    };
                    window.openPhotoPreview(0, [statPreviewPhoto]);
                    setTimeout(function() {
                        syncPostPhotoPreviewChrome(statPreviewPhoto);
                    }, 30);
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
                if (display.length > 52) display = display.slice(0, 52) + '...';
                var detailOnclick = "openStatPostDetail('" + safeJsStr(String(normalized.id)) + "')";
                var mediaOnclick = "openStatPostMedia('" + safeJsStr(String(normalized.id)) + "')";
                var mediaHtml = statMediaThumbMarkup(normalized, 'spi-thumb', mediaOnclick, normalized.media_type === 'video' ? '点击查看视频' : '点击全屏预览');
                var delay = Math.min((Number(normalized._statIndex) || 0) * 26, 220);
                return [
                    '<article class="stat-post-item stat-row' + (mediaHtml ? '' : ' stat-row--no-media') + '" role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}" style="--xtj-enter-delay:' + delay + 'ms;">',
                    statMediaColumnMarkup(mediaHtml),
                    '<div class="stat-row-main">',
                    '<div class="stat-row-title">' + (display ? escapeHtml(display) : escapeHtml(statPostSummary(normalized, 'plain'))) + '</div>',
                    '<div class="stat-row-meta"><span>' + new Date(normalized.created_at).toLocaleString() + '</span>' + tag + '</div>',
                    '</div>',
                    '<button type="button" class="spi-open-btn stat-row-action" onclick="event.stopPropagation();' + detailOnclick + '">查看详情</button>',
                    '</article>'
                ].join('');
            }

            function renderStatByType(type) {
                if (type === 'posts') renderPostStats();
                else if (type === 'views') renderViewStats();
                else if (type === 'likes') renderLikeStats();
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
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无记录</div>';
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
                        '<button type="button" class="stat-user-summary stat-user-summary-card" onclick="loadUserAllPosts(\'' + nameJs + '\')" style="--xtj-enter-delay:' + Math.min(index * 42, 240) + 'ms;">',
                        '<div class="stat-user-main stat-user-main--simple">',
                        '<div class="suh-copy"><span class="suh-name">' + escapeHtml(name) + '</span><span class="suh-sub">' + escapeHtml(latest) + '</span></div>',
                        '<span class="suh-count">' + posts.length + ' 条</span>',
                        '</div>',
                        previewMedia ? '<div class="stat-user-preview">' + previewMedia + '</div>' : '',
                        '<div class="stat-user-cta"><span class="stat-user-note">' + escapeHtml(statPostSummary(posts[0], 'plain')) + '</span><span class="stat-user-link">查看记录</span></div>',
                        '</button>'
                    ].join('');
                }).join('');
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = sortPosts(statAllPosts.filter(function(p) { return p.user_name === userName; }));
                body.innerHTML = [
                    '<div class="stat-history-head"><button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">返回总动态</button></div>',
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
                    noteHtml = '<div class="stat-record-note"><strong>评论内容：</strong>' + escapeHtml(item.content) + '</div>';
                }
                return [
                    '<article class="stat-record-entry stat-row ' + (isLike ? 'stat-like-item' : 'stat-comment-item') + (mediaHtml ? '' : ' stat-row--no-media') + '"' + cardAttrs + ' style="--xtj-enter-delay:' + Math.min(index * 12, 48) + 'ms;">',
                    '<div class="stat-row-main">',
                    '<div class="stat-row-title">' + actorName + (isLike ? ' 点赞了 ' : ' 评论了 ') + (post && post.user_name ? escapeHtml(post.user_name) : '某用户') + ' 的内容</div>',
                    '<div class="stat-row-copy"><div class="stat-record-summary">' + escapeHtml(summary) + '</div>' + noteHtml + '</div>',
                    statMediaColumnMarkup(mediaHtml),
                    '<div class="stat-row-side"><span class="stat-row-time">' + timeText + '</span>' + (post ? '<div class="stat-row-actions"><button type="button" class="stat-record-action" onclick="event.stopPropagation();' + detailOnclick + '">查看详情</button></div>' : '') + '</div>',
                    '</div>',
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
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无记录</div>';
                    return;
                }
                body.innerHTML = history.map(function(v, index) {
                    var post = postMap[String(v.post_id)] || null;
                    var detailOnclick = post ? "openStatPostDetail('" + safeJsStr(String(post.id)) + "')" : '';
                    var mediaOnclick = post ? "event.stopPropagation();openStatPostMedia('" + safeJsStr(String(post.id)) + "')" : '';
                    var mediaHtml = post ? statMediaThumbMarkup(post, 'stat-record-thumb', mediaOnclick, post.media_type === 'video' ? '点击查看视频' : '点击全屏预览') : '';
                    var postText = post ? statPostSummary(post, 'bracket') : (v.post_content || '（内容已不可用）');
                    return [
                        '<article class="stat-view-item stat-row' + (mediaHtml ? '' : ' stat-row--no-media') + '" ' + (post ? 'role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}"' : '') + ' style="--xtj-enter-delay:' + Math.min(index * 12, 48) + 'ms;">',
                        '<div class="stat-row-main">',
                        '<div class="stat-row-title">' + escapeHtml(v.user_name) + ' 浏览了 ' + escapeHtml(v.post_author || '') + ' 的帖子</div>',
                        '<div class="stat-row-copy"><div class="stat-record-summary">' + escapeHtml(v.post_content || postText) + '</div></div>',
                        statMediaColumnMarkup(mediaHtml),
                        '<div class="stat-row-side"><span class="stat-row-time">' + new Date(v.viewed_at).toLocaleString() + '</span>' + (post ? '<div class="stat-row-actions"><button type="button" class="stat-record-action" onclick="event.stopPropagation();' + detailOnclick + '">查看详情</button></div>' : '') + '</div>',
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
                    var h = '';
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
                    var h = '';
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

                body.innerHTML = '<div class="stat-two-col stat-two-col--flat"><section class="stat-col stat-col--flat"><div class="stat-col-title">点赞记录 <span>' + statAllLikes.length + '</span></div>' + buildLikesCol() + '</section><section class="stat-col stat-col--flat"><div class="stat-col-title">评论记录 <span>' + statAllComments.length + '</span></div>' + buildCommentsCol() + '</section></div>';
            };

            window.openPostDetail = async function(postId) {
                var title = document.getElementById('postDetailTitle');
                var body = document.getElementById('postDetailBody');
                var modal = document.getElementById('postDetailModal');
                if (title) title.textContent = '帖子详情';
                if (body) body.innerHTML = getXtjLoadingHtml('加载中..', '加载中..', 'feed');
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

        })();

        (function installEmergencyActionRescue() {
            if (window.__xtjEmergencyActionRescueV1) return;
            window.__xtjEmergencyActionRescueV1 = true;

            function setBodyLockFromVisibleModals() {
                var activeIds = ['announcementModal', 'reportModal', 'reportHistoryModal', 'statModal'];
                var hasActive = activeIds.some(function(id) {
                    var el = document.getElementById(id);
                    return !!(el && el.classList.contains('active'));
                });
                document.body.style.overflow = hasActive ? 'hidden' : '';
            }

            function getSimpleStatPostMap() {
                var map = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (post && post.id != null) map[String(post.id)] = normalizePost(post);
                });
                Object.keys(postInfoCache || {}).forEach(function(id) {
                    if (!id || map[id]) return;
                    var cached = postInfoCache[id] || {};
                    map[id] = normalizePost({
                        id: cached.id || id,
                        content: cached.content || '',
                        user_name: cached.user_name || '',
                        media_url: cached.media_url || '',
                        media_type: cached.media_type || '',
                        created_at: cached.created_at || '',
                        views: Number(cached.views || 0)
                    });
                });
                return map;
            }

            function getStatPostById(postId) {
                if (postId == null || postId === '') return null;
                var key = String(postId);
                var direct = (Array.isArray(statAllPosts) ? statAllPosts : []).find(function(post) {
                    return post && String(post.id) === key;
                });
                if (direct) return normalizePost(direct);
                var cached = postInfoCache && postInfoCache[key];
                if (!cached) return null;
                return normalizePost({
                    id: cached.id || key,
                    content: cached.content || '',
                    user_name: cached.user_name || '',
                    media_url: cached.media_url || '',
                    media_type: cached.media_type || '',
                    created_at: cached.created_at || '',
                    views: Number(cached.views || 0)
                });
            }

            function formatPostSummary(post) {
                var normalized = normalizePost(post || {});
                var text = String(normalized.content || '').trim();
                var hasImg = !!(normalized.media_url && normalized.media_type === 'image');
                var hasVid = !!(normalized.media_url && normalized.media_type === 'video');
                var summary = text.length > 28 ? text.slice(0, 28) + '...' : text;
                return {
                    display: summary || (hasImg ? '图片动态' : (hasVid ? '视频动态' : '无文字内容')),
                    hasImg: hasImg,
                    hasVid: hasVid,
                    thumbUrl: hasImg ? normalized.media_url : null,
                    normalized: normalized
                };
            }

            function getStatPostSummary(post) {
                if (!post) return '原帖已删除';
                return formatPostSummary(post).display || '原帖已删除';
            }

            function formatStatDateTime(value) {
                var date = value ? new Date(value) : new Date();
                if (Number.isNaN(date.getTime())) date = new Date();
                return date.toLocaleString();
            }

            function renderStatThumb(summary) {
                if (summary && summary.hasImg && summary.thumbUrl) {
                    return '<img class="spi-thumb" src="' + escapeHtml(summary.thumbUrl) + '" alt="帖子缩略图" loading="lazy">';
                }
                if (summary && summary.hasVid) {
                    return '<div class="spi-thumb spi-thumb--video" aria-hidden="true">视频</div>';
                }
                return '';
            }

            function renderPostItemHTML(post, index) {
                var normalized = normalizePost(post || {});
                var summary = formatPostSummary(normalized);
                var detailOnclick = "openStatPostDetail('" + safeJsStr(String(normalized.id || '')) + "')";
                var thumb = renderStatThumb(summary);
                return [
                    '<article class="stat-post-item' + (thumb ? '' : ' stat-post-item--no-thumb') + '" role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}" style="--xtj-enter-delay:' + Math.min((index || 0) * 20, 180) + 'ms;">',
                    '<div class="spi-main">',
                    '<div class="spi-content">' + escapeHtml(summary.display) + '</div>',
                    '<div class="spi-time">' + escapeHtml(formatStatDateTime(normalized.created_at)) + '</div>',
                    '</div>',
                    thumb,
                    '</article>'
                ].join('');
            }

            function getStatPostMediaHtml(post, postId) {
                var normalized = post ? normalizePost(post) : null;
                if (!normalized || !normalized.media_url) return '';
                if (normalized.media_type === 'image') {
                    return '<img class="stat-record-thumb" src="' + escapeHtml(normalized.media_url) + '" alt="记录缩略图" loading="lazy">';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="stat-record-thumb stat-record-thumb--video" aria-hidden="true">视频</div>';
                }
                return '';
            }

            function renderStatRecordCard(options) {
                var title = String(options && options.title || '');
                var copy = String(options && options.copy || '');
                var note = String(options && options.note || '');
                var time = String(options && options.time || '');
                var postId = options && options.postId != null ? String(options.postId) : '';
                var thumbHtml = String(options && options.thumbHtml || '');
                var detailOnclick = postId ? "openStatPostDetail('" + safeJsStr(postId) + "')" : '';
                var clickAttr = detailOnclick ? ' role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}"' : '';
                var enterStyle = String(options && options.enterStyle || '');
                return [
                    '<article class="stat-record-card' + (thumbHtml ? '' : ' stat-record-card--no-thumb') + '"' + clickAttr + enterStyle + '>',
                    '<div class="stat-record-main">',
                    '<div class="stat-record-title">' + escapeHtml(title) + '</div>',
                    '<div class="stat-record-copy">' + escapeHtml(copy || '无文字内容') + '</div>',
                    note ? '<div class="stat-record-note">' + escapeHtml(note) + '</div>' : '',
                    '<div class="stat-record-meta">' + escapeHtml(time) + '</div>',
                    '</div>',
                    thumbHtml,
                    '</article>'
                ].join('');
            }

            function resolveStatRecordPost(item) {
                var postId = item && item.post_id != null ? String(item.post_id) : '';
                var direct = postId ? getStatPostById(postId) : null;
                if (direct) return direct;
                if (!item) return null;
                if (!item.post_content && !item.post_author && !item.media_url && !item.media_type) return null;
                return normalizePost({
                    id: postId || '',
                    content: item.post_content || '',
                    user_name: item.post_author || '',
                    media_url: item.media_url || '',
                    media_type: item.media_type || '',
                    created_at: item.created_at || item.viewed_at || ''
                });
            }

            renderPostStats = window.renderPostStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userMap = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (!post || !post.user_name) return;
                    if (!userMap[post.user_name]) userMap[post.user_name] = [];
                    userMap[post.user_name].push(post);
                });
                var entries = Object.keys(userMap).map(function(name) {
                    return [name, sortPosts(userMap[name] || [])];
                }).sort(function(a, b) {
                    return b[1].length - a[1].length;
                });
                if (!entries.length) {
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无动态记录</div>';
                    return;
                }
                body.innerHTML = entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    return [
                        '<section class="stat-user-group">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(String(name).slice(0, 1).toUpperCase()) + '</div><span class="suh-name">' + escapeHtml(name) + '</span></div><span class="suh-count">' + posts.length + ' 条</span></div>',
                        '<div class="stat-user-posts">' + posts.slice(0, 3).map(function(post, index) { return renderPostItemHTML(post, index); }).join('') + '</div>',
                        (posts.length > 3 ? '<div style="padding-top:8px;"><button type="button" class="stat-view-btn" onclick="loadUserAllPosts(\'' + safeJsStr(name) + '\')">查看全部 ' + posts.length + ' 条</button></div>' : ''),
                        '</section>'
                    ].join('');
                }).join('');
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = sortPosts((Array.isArray(statAllPosts) ? statAllPosts : []).filter(function(post) {
                    return post && post.user_name === userName;
                }));
                body.innerHTML = [
                    '<div class="stat-history-head"><button type="button" class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">返回总动态</button></div>',
                    '<div class="stat-stack">' + userPosts.map(function(post, index) { return renderPostItemHTML(post, index); }).join('') + '</div>'
                ].join('');
            };

            renderViewStats = window.renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = typeof getViewHistory === 'function' ? getViewHistory() : [];
                if (!history.length) {
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无浏览记录</div>';
                    return;
                }
                body.innerHTML = history.map(function(item, index) {
                    var post = resolveStatRecordPost(item);
                    var viewerName = String(item.user_name || '').trim() || '未知用户';
                    var targetAuthor = String(item.post_author || (post && post.user_name) || '该用户').trim();
                    return renderStatRecordCard({
                        title: viewerName + ' 浏览了 ' + targetAuthor + ' 的帖子',
                        copy: String(item.post_content || getStatPostSummary(post)),
                        postId: post && post.id ? String(post.id) : '',
                        time: formatStatDateTime(item.viewed_at),
                        thumbHtml: getStatPostMediaHtml(post, post && post.id ? String(post.id) : ''),
                        enterStyle: ' style="--xtj-enter-delay:' + Math.min(index * 16, 160) + 'ms;"'
                    });
                }).join('');
            };

            renderLikeStats = window.renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                function renderRecord(kind, item, index) {
                    var post = getStatPostById(item && item.post_id);
                    var copyText = kind === 'likes'
                        ? getStatPostSummary(post)
                        : '原帖：' + getStatPostSummary(post);
                    return renderStatRecordCard({
                        title: String(item.user_name || '匿名用户') + (kind === 'likes' ? ' 点赞了 ' : ' 评论了 ') + (post && post.user_name ? escapeHtml(post.user_name) : '某用户') + ' 的内容',
                        copy: copyText,
                        note: kind === 'comments' ? ('评论：' + String(item.content || '')) : '',
                        postId: post && post.id ? String(post.id) : '',
                        time: formatStatDateTime(item.created_at),
                        thumbHtml: getStatPostMediaHtml(post, post && post.id ? String(post.id) : ''),
                        enterStyle: ' style="--xtj-enter-delay:' + Math.min(index * 14, 160) + 'ms;"'
                    });
                }
                var likesHtml = statAllLikes.length
                    ? statAllLikes.map(function(item, index) { return renderRecord('likes', item, index); }).join('')
                    : '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
                var commentsHtml = statAllComments.length
                    ? statAllComments.slice().reverse().map(function(item, index) { return renderRecord('comments', item, index); }).join('')
                    : '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
                body.innerHTML = '<div class="stat-two-col stat-two-col--bare"><section class="stat-col stat-col--bare"><div class="stat-section-title">点赞记录</div>' + likesHtml + '</section><section class="stat-col stat-col--bare"><div class="stat-section-title">评论记录</div>' + commentsHtml + '</section></div>';
            };

            function applySimpleStatSnapshot(snapshot) {
                if (!snapshot) return;
                var posts = Array.isArray(snapshot.posts) ? snapshot.posts : [];
                var comments = Array.isArray(snapshot.comments) ? snapshot.comments : [];
                var likes = Array.isArray(snapshot.likes) ? snapshot.likes : [];
                var visiblePosts = normalizePosts(posts).filter(function(p) {
                    return p && p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== ADMIN_META_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__visit__' && p.media_type !== '__attack__' && p.media_type !== '__user_visit__' && p.media_type !== '__ann__' && p.media_type !== '__login_event__' && p.media_type !== '__security_alert__' && p.media_type !== '__admin_audit__' && p.media_type !== '__client_error__' && p.media_type !== '__email_sent__' && p.media_type !== '__vip__' && p.media_type !== '__vip_order__' && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && canViewPost(p);
                });
                var visiblePostIds = new Set(visiblePosts.map(function(post) { return String(post.id); }));
                statAllPosts = visiblePosts;
                statAllComments = comments.filter(function(item) { return item && visiblePostIds.has(String(item.post_id)); });
                statAllLikes = likes.filter(function(item) { return item && visiblePostIds.has(String(item.post_id)); });
                statCacheTime = Date.now();
            }

            async function fetchSimpleStatSnapshot() {
                var result = await Promise.all([
                    applyVisiblePostQueryFilters(sb.from("posts").select("*")).order("created_at", { ascending: false }),
                    sb.from("comments").select("*").order("created_at"),
                    sb.from("likes").select("*").order("created_at", { ascending: false })
                ]);
                return {
                    posts: result[0].data || [],
                    comments: result[1].data || [],
                    likes: result[2].data || []
                };
            }

            refreshStatModal = window.refreshStatModal = function() {
                var modal = document.getElementById('statModal');
                if (!modal || !modal.classList.contains('active') || !statCurrentType) return;
                renderStatByType(statCurrentType);
            };

            window.openAnnouncementModal = function() {
                var overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                var listContainer = document.getElementById('announcementListContainer');
                var detail = document.getElementById('announcementDetail');
                var adminArea = document.getElementById('announcementAdminArea');
                var list = document.getElementById('announcementList');
                overlay.classList.add('active');
                if (listContainer) listContainer.style.display = 'block';
                if (detail) {
                    detail.classList.remove('active');
                    detail.style.display = 'none';
                }
                if (adminArea) adminArea.style.display = isAdmin() ? 'block' : 'none';
                if (list && !list.innerHTML.trim()) {
                    list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                }
                try {
                    if (typeof loadAnnouncements === 'function') {
                        Promise.resolve(loadAnnouncements()).then(function() {
                            if (typeof renderAnnouncementList === 'function') {
                                renderAnnouncementList();
                            } else if (list && !list.innerHTML.trim()) {
                                list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                            }
                        }).catch(function() {
                            if (list && !list.innerHTML.trim()) {
                                list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                            }
                        });
                    }
                } catch (_) {}
                setBodyLockFromVisibleModals();
            };

            window.closeAnnouncementModal = function() {
                var overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.classList.remove('active');
                setBodyLockFromVisibleModals();
            };

            window.switchReportView = typeof window.switchReportView === 'function' ? window.switchReportView : function(view) {
                var formBody = document.getElementById('reportModalFormBody');
                var recordsPanel = document.getElementById('reportRecordsPanel');
                if (formBody) formBody.style.display = view === 'records' ? 'none' : 'block';
                if (recordsPanel) recordsPanel.style.display = view === 'records' ? 'block' : 'none';
            };

            window.switchReportType = typeof window.switchReportType === 'function' ? window.switchReportType : function(type) {
                _reportType = type || 'post';
            };

            window.toggleReportRecords = typeof window.toggleReportRecords === 'function' ? window.toggleReportRecords : function() {
                if (typeof window.switchReportView === 'function') window.switchReportView('records');
            };

            window.selectReportReason = typeof window.selectReportReason === 'function' ? window.selectReportReason : function(btn) {
                document.querySelectorAll('.report-reason-btn').forEach(function(node) { node.classList.remove('selected'); });
                if (btn) btn.classList.add('selected');
                _reportSelectedReason = btn ? String(btn.dataset.reason || btn.textContent || '') : null;
                var submitBtn = document.getElementById('reportSubmitBtn');
                if (submitBtn) submitBtn.disabled = false;
            };

            window.submitReport = typeof window.submitReport === 'function' ? window.submitReport : function() {
                showToast('举报功能暂不可用，请稍后重试');
            };

            window.openReportModal = function() {
                if (!currentUser) { showToast('请先登录'); return; }
                var overlay = document.getElementById('reportModal');
                if (!overlay) return;
                _reportType = 'post';
                _reportView = 'form';
                _reportSelectedId = null;
                _reportSelectedReason = null;
                _reportTargetUser = null;
                _reportContentData = [];
                overlay.classList.add('active');
                var formBody = document.getElementById('reportModalFormBody');
                var recordsPanel = document.getElementById('reportRecordsPanel');
                if (formBody) formBody.style.display = 'block';
                if (recordsPanel) recordsPanel.style.display = 'none';
                document.querySelectorAll('.report-type-tab').forEach(function(node) {
                    node.classList.toggle('active', node.dataset.type === 'post');
                });
                document.querySelectorAll('.report-reason-btn').forEach(function(node) {
                    node.classList.remove('selected');
                });
                var reportError = document.getElementById('reportError');
                if (reportError) {
                    reportError.style.display = 'none';
                    reportError.textContent = '';
                }
                var list = document.getElementById('reportContentList');
                if (list) {
                    list.innerHTML = '<div class="report-loading">加载中...</div>';
                }
                try {
                    if (typeof loadReportContentList === 'function') {
                        Promise.resolve(loadReportContentList()).catch(function() {
                            if (list) list.innerHTML = '<div class="report-loading">加载失败，请稍后重试</div>';
                        });
                    } else if (list) {
                        list.innerHTML = '<div class="report-loading">加载失败，请稍后重试</div>';
                    }
                } catch (_) {
                    if (list) list.innerHTML = '<div class="report-loading">加载失败，请稍后重试</div>';
                }
                setBodyLockFromVisibleModals();
            };

            window.closeReportModal = function() {
                var overlay = document.getElementById('reportModal');
                if (!overlay) return;
                overlay.classList.remove('active');
                setBodyLockFromVisibleModals();
            };

            window.bindHeaderActionButtons = function() {
                var annBtn = document.getElementById('announcementBtn');
                var reportBtn = document.getElementById('reportBtn');
                if (!annBtn && !reportBtn) return;
                if (window.__xtjHeaderActionsBound) return;
                window.__xtjHeaderActionsBound = true;
                if (annBtn) {
                    annBtn.type = 'button';
                    annBtn.onclick = null;
                    annBtn.addEventListener('click', function(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.openAnnouncementModal();
                    });
                }
                if (reportBtn) {
                    reportBtn.type = 'button';
                    reportBtn.onclick = null;
                    reportBtn.addEventListener('click', function(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.openReportModal();
                    });
                }
            };

            document.addEventListener('DOMContentLoaded', function() {
                if (typeof window.bindHeaderActionButtons === 'function') window.bindHeaderActionButtons();
            });
            if (typeof window.bindHeaderActionButtons === 'function') window.bindHeaderActionButtons();

            var originalCloseModal = window.closeModal;
            window.closeModal = function(id) {
                if (typeof originalCloseModal === 'function') {
                    originalCloseModal(id);
                }
                if (id === 'statModal') {
                    setBodyLockFromVisibleModals();
                }
            };
        })();

        (function installFinalUiAndDataOverrides() {
            if (window.__xtjFinalUiOverridesV1) return;
            window.__xtjFinalUiOverridesV1 = true;
            var ANN_CACHE_KEY = "xtj_announcements_cache_v1";
            var ANN_CACHE_DURATION = 3 * 60 * 1000;

            function sleep(ms) {
                return new Promise(function(resolve) { setTimeout(resolve, ms); });
            }

            function readFeedSnapshotCache() {
                try {
                    var raw = localStorage.getItem(CACHE_KEY);
                    if (!raw) return null;
                    var parsed = JSON.parse(raw);
                    return normalizeFeedSnapshotCache(parsed);
                } catch (e) {
                    return null;
                }
            }

            function readAnnouncementCache() {
                try {
                    var raw = localStorage.getItem(ANN_CACHE_KEY);
                    if (!raw) return null;
                    var parsed = JSON.parse(raw);
                    if (!parsed || !Array.isArray(parsed.data)) return null;
                    return parsed;
                } catch (e) {
                    return null;
                }
            }

            function writeAnnouncementCache(items) {
                try {
                    localStorage.setItem(ANN_CACHE_KEY, JSON.stringify({
                        data: Array.isArray(items) ? items : [],
                        timestamp: Date.now()
                    }));
                } catch (e) {}
            }

            function applyStatSnapshot(posts, comments, likes) {
                var visiblePosts = normalizePosts(Array.isArray(posts) ? posts : []).filter(function(p) {
                    return p && p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== ADMIN_META_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__visit__' && p.media_type !== '__attack__' && p.media_type !== '__user_visit__' && p.media_type !== '__ann__' && p.media_type !== '__login_event__' && p.media_type !== '__security_alert__' && p.media_type !== '__admin_audit__' && p.media_type !== '__client_error__' && p.media_type !== '__email_sent__' && p.media_type !== '__vip__' && p.media_type !== '__vip_order__' && p.media_type !== USER_STYLE_MARKER && p.media_type !== '__ai_agent_profile__' && p.media_type !== '__ai_agent_msg__' && p.media_type !== '__ai_agent_memory__' && p.media_type !== '__ai_agent_config__' && p.media_type !== '__ai_english_learning__' && p.media_type !== '**ai_agent_memory_box**' && p.media_type !== '**ai_agent_conv_summary**' && p.media_type !== '**ai_agent_memory_log**' && canViewPost(p);
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

            var statRequestId = 0;
            var statDataPromise = null;

            function hasUsableStatCache() {
                return statCacheTime > 0 && (Date.now() - statCacheTime < STAT_CACHE_DURATION);
            }

            async function ensureStatDataLoaded(force) {
                if (!force && hasUsableStatCache()) {
                    return {
                        posts: statAllPosts,
                        comments: statAllComments,
                        likes: statAllLikes
                    };
                }
                if (!force && statDataPromise) return statDataPromise;
                statDataPromise = fetchStatSnapshotWithTimeout(5000).then(function(snapshot) {
                    if (snapshot) {
                        applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                    }
                    return snapshot;
                }).finally(function() {
                    statDataPromise = null;
                });
                return statDataPromise;
            }

            function syncHeaderModalBodyLock() {
                var activeIds = ['announcementModal', 'reportModal', 'reportHistoryModal', 'statModal'];
                var hasActive = activeIds.some(function(id) {
                    var el = document.getElementById(id);
                    return !!(el && el.classList.contains('active'));
                });
                document.body.style.overflow = hasActive ? 'hidden' : '';
            }

            function renderStatByTypeFinal(type) {
                if (type === 'posts') {
                    if (typeof renderPostStats === 'function') renderPostStats();
                    return;
                }
                if (type === 'views') {
                    if (typeof renderViewStats === 'function') renderViewStats();
                    return;
                }
                if (type === 'likes') {
                    if (typeof renderLikeStats === 'function') renderLikeStats();
                }
            }

            function setAnnouncementModalToListMode() {
                currentAnnouncementTab = 'announcements';
                document.querySelectorAll('.announcement-tab').forEach(function(tab) {
                    tab.classList.toggle('active', tab.dataset.tab === 'announcements');
                });
                var adminArea = document.getElementById('announcementAdminArea');
                var listContainer = document.getElementById('announcementListContainer');
                var detail = document.getElementById('announcementDetail');
                var changelog = document.getElementById('changelogContainer');
                var list = document.getElementById('announcementList');
                if (adminArea) adminArea.style.display = isAdmin() ? 'block' : 'none';
                if (listContainer) listContainer.style.display = 'block';
                if (detail) {
                    detail.classList.remove('active');
                    detail.style.display = 'none';
                }
                if (changelog) changelog.style.display = 'none';
                if (list && !String(list.innerHTML || '').trim()) {
                    list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                }
            }

            refreshStatModal = window.refreshStatModal = function() {
                var modal = document.getElementById('statModal');
                if (!modal || !modal.classList.contains('active') || !statCurrentType) return;
                var sourcePosts = Array.isArray(feedAllPosts) && feedAllPosts.length ? feedAllPosts : statAllPosts;
                var sourceComments = Array.isArray(feedAllComments) && feedAllComments.length ? feedAllComments : statAllComments;
                var sourceLikes = Array.isArray(feedAllLikes) && feedAllLikes.length ? feedAllLikes : statAllLikes;
                if (sourcePosts.length || sourceComments.length || sourceLikes.length) {
                    applyStatSnapshot(sourcePosts, sourceComments, sourceLikes);
                }
                renderStatByTypeFinal(statCurrentType);
                ensureStatDataLoaded(false).then(function(snapshot) {
                    if (!snapshot || !modal.classList.contains('active') || !statCurrentType) return;
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                    renderStatByTypeFinal(statCurrentType);
                }).catch(function() {});
            };

            window.prefetchStatData = function() {
                return ensureStatDataLoaded(false).catch(function() { return null; });
            };

            async function fetchStatSnapshotWithTimeout(timeoutMs) {
                var timeout = new Promise(function(resolve) {
                    setTimeout(function() { resolve(null); }, timeoutMs);
                });
                var request = Promise.all([
                    applyVisiblePostQueryFilters(sb.from("posts").select("*")).order("created_at", { ascending: false }),
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

            window.openAnnouncementModal = function() {
                var overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                var list = document.getElementById('announcementList');
                overlay.classList.add('active');
                setAnnouncementModalToListMode();
                syncHeaderModalBodyLock();
                // 立即标记已加载的公告为已读（用稳定 ID）
                // 即使 loadAnnouncements 后续重新拉取也会再次 mark
                try {
                    if (announcements && announcements.length) {
                        var preIds = announcements.map(window.getAnnouncementId).filter(Boolean);
                        if (preIds.length) window.markAnnouncementsRead(preIds);
                    }
                } catch (_) {}
                try {
                    if (typeof loadAnnouncements === 'function') {
                        Promise.resolve(loadAnnouncements()).then(function() {
                            if (typeof renderAnnouncementList === 'function') {
                                renderAnnouncementList();
                                // 重新拉取后再次标记
                                if (announcements && announcements.length) {
                                    var postIds = announcements.map(window.getAnnouncementId).filter(Boolean);
                                    if (postIds.length) window.markAnnouncementsRead(postIds);
                                }
                            } else if (list && !String(list.innerHTML || '').trim()) {
                                list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                            }
                        }).catch(function() {
                            if (list && !String(list.innerHTML || '').trim()) {
                                list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                            }
                        });
                    }
                } catch (_) {
                    if (list && !String(list.innerHTML || '').trim()) {
                        list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                    }
                }
            };

            window.closeAnnouncementModal = function() {
                var overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.classList.remove('active');
                syncHeaderModalBodyLock();
            };

            window.openReportModal = function() {
                if (!currentUser) {
                    showToast('请先登录');
                    return;
                }
                var overlay = document.getElementById('reportModal');
                if (!overlay) return;
                _reportType = 'post';
                _reportView = 'form';
                _reportSelectedId = null;
                _reportSelectedReason = null;
                _reportTargetUser = null;
                _reportContentData = [];
                overlay.classList.add('active');
                var formBody = document.getElementById('reportModalFormBody');
                var recordsPanel = document.getElementById('reportRecordsPanel');
                var list = document.getElementById('reportContentList');
                var errorBox = document.getElementById('reportError');
                document.querySelectorAll('.report-type-tab').forEach(function(node) {
                    node.classList.toggle('active', node.dataset.type === 'post');
                });
                document.querySelectorAll('.report-reason-btn').forEach(function(node) {
                    node.classList.remove('selected');
                });
                if (formBody) {
                    formBody.classList.add('active');
                    formBody.style.display = 'block';
                    formBody.setAttribute('aria-hidden', 'false');
                }
                if (recordsPanel) recordsPanel.style.display = 'none';
                if (typeof window.closeReportHistoryModal === 'function') {
                    try { window.closeReportHistoryModal(); } catch (_) {}
                }
                if (errorBox) {
                    errorBox.style.display = 'none';
                    errorBox.textContent = '';
                }
                var customReason = document.getElementById('reportCustomReason');
                if (customReason) customReason.value = '';
                var submitBtn = document.getElementById('reportSubmitBtn');
                if (submitBtn) submitBtn.disabled = true;
                if (typeof updateReportSelectedPreview === 'function') {
                    try { updateReportSelectedPreview(); } catch (_) {}
                }
                if (list) {
                    list.innerHTML = '<div class="report-loading">加载中...</div>';
                }
                if (typeof syncReportModalBodyLock === 'function') {
                    syncReportModalBodyLock();
                } else {
                    syncHeaderModalBodyLock();
                }
                try {
                    if (typeof loadReportContentList === 'function') {
                        Promise.resolve(loadReportContentList()).catch(function() {
                            if (list) list.innerHTML = '<div class="report-loading">加载失败，请稍后重试</div>';
                        });
                    } else if (list) {
                        list.innerHTML = '<div class="report-loading">加载失败，请稍后重试</div>';
                    }
                } catch (_) {
                    if (list) list.innerHTML = '<div class="report-loading">加载失败，请稍后重试</div>';
                }
            };

            window.closeReportModal = function() {
                var overlay = document.getElementById('reportModal');
                if (!overlay) return;
                overlay.classList.remove('active');
                if (typeof window.closeReportHistoryModal === 'function') {
                    try { window.closeReportHistoryModal(); } catch (_) {}
                }
                if (typeof syncReportModalBodyLock === 'function') {
                    syncReportModalBodyLock();
                } else {
                    syncHeaderModalBodyLock();
                }
            };

            window.bindHeaderActionButtons = function() {
                var annBtn = document.getElementById('announcementBtn');
                var reportBtn = document.getElementById('reportBtn');
                if (!annBtn && !reportBtn) return;
                if (window.__xtjHeaderActionsBound) return;
                window.__xtjHeaderActionsBound = true;
                if (annBtn) {
                    annBtn.type = 'button';
                    annBtn.onclick = null;
                    annBtn.addEventListener('click', function(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.openAnnouncementModal();
                    });
                }
                if (reportBtn) {
                    reportBtn.type = 'button';
                    reportBtn.onclick = null;
                    reportBtn.addEventListener('click', function(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        window.openReportModal();
                    });
                }
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    if (typeof window.bindHeaderActionButtons === 'function') window.bindHeaderActionButtons();
                });
            } else if (typeof window.bindHeaderActionButtons === 'function') {
                window.bindHeaderActionButtons();
            }

            renderChatLoadingState = function(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                el.classList.add('xtj-chat-photo-loading');
                el.innerHTML = window.__xtjSharedPhotoLoaderHtml || getXtjLoadingHtml(title, subtitle, variant.indexOf('chat') === -1 ? 'chat-list' : variant);
            };

            (function installChatPhotoLoaderFinal() {
                if (window.__xtjChatPhotoLoaderFinalV1) return;
                window.__xtjChatPhotoLoaderFinalV1 = true;
                var originalMagicLoader = window.xtjMagicLoadingHtml;
                window.__xtjSharedPhotoLoaderHtml = window.__xtjSharedPhotoLoaderHtml || (window.__xtjSkeletonCardHtml ? window.__xtjSkeletonCardHtml(true) : '');
                window.xtjMagicLoadingHtml = function(title, subtitle, variant) {
                    var mode = String(variant || '');
                    if (mode.indexOf('chat') !== -1 || /聊天|消息/.test(String(title || '') + String(subtitle || ''))) {
                        return window.__xtjSharedPhotoLoaderHtml;
                    }
                    return originalMagicLoader ? originalMagicLoader.apply(this, arguments) : '';
                };
            })();

            (function installButtonMotionFinal() {
                if (window.__xtjButtonMotionFinalV1) return;
                window.__xtjButtonMotionFinalV1 = true;
                var selector = '.user-filter-btn,.search-toggle,.filter-toggle';
                var gsapCache = false;

                function isDock(target) {
                    return !!(target && target.closest && target.closest('#dockBar, .dock-bar, .dock-tab'));
                }

                document.addEventListener('click', function(event) {
                    if (gsapCache === false) gsapCache = typeof gsap !== 'undefined';
                    var target = event.target;
                    if (!target) return;
                    var btn = target.closest(selector);
                    if (!btn) return;
                    if (isDock(btn)) return;

                    if (gsapCache) {
                        var icon = btn.querySelector('svg, img, i');
                        if (icon) {
                            gsap.fromTo(icon, {scale:1}, {scale:1.18, duration:0.16, ease:'back.out(2.5)', clearProps:'scale'});
                        }
                    } else {
                        btn.style.transform = 'scale(0.96)';
                        window.setTimeout(function(){btn.style.transform='';}, 120);
                    }
                }, true);

                document.addEventListener('pointerdown', function(event) {
                    var target = event.target;
                    if (!target || isDock(target)) return;
                    if (target.closest('button:not(.dock-tab),[role="button"]:not(.dock-tab),.action-btn,.send-btn,.chat-img-btn,.photo-wall-btn,.file-label')) {
                        target.style.transition = 'transform 0.12s ease';
                        target.style.transform = 'scale(0.96)';
                    }
                }, true);

                document.addEventListener('pointerup', function(event) {
                    var target = event.target;
                    if (!target) return;
                    if (target.style.transform) {
                        target.style.transition = 'transform 0.25s cubic-bezier(.34,1.4,.64,1)';
                        target.style.transform = 'scale(1)';
                        window.setTimeout(function(){target.style.transition='';target.style.transform='';}, 280);
                    }
                }, true);

                document.addEventListener('pointercancel', function(event) {
                    var target = event.target;
                    if (!target) return;
                    target.style.transform = '';
                    target.style.transition = '';
                }, true);
            })();

            renderPostFilterUserLoader = function() {
                return '<div class="xtj-magic-loading" style="display:flex;align-items:center;justify-content:center;min-height:140px;padding:16px 0;"><div class="xtj-loading-skeleton" style="width:100%"><div class="xtj-skeleton-card"><div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div><div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div></div></div></div>';
            };

            window.openStatDetail = async function(type) {
                if (['posts', 'views', 'likes'].indexOf(type) === -1) return;
                statCurrentType = type;
                var requestId = ++statRequestId;
                var titles = {
                    posts: '总动态',
                    views: '总浏览',
                    likes: '点赞和评论'
                };
                var title = document.getElementById('statModalTitle');
                var body = document.getElementById('statModalBody');
                var modal = document.getElementById('statModal');
                if (title) title.textContent = titles[type] || '统计详情';
                if (modal && !modal.classList.contains('active')) modal.classList.add('active');
                syncHeaderModalBodyLock();
                if (body) body.innerHTML = getXtjLoadingHtml('加载中..', '', 'feed');
                // 全面清除GSAP残留在弹窗上的内联样式，并杀死正在运行的GSAP动画
                var box = modal ? modal.querySelector('.stat-detail-modal') : null;
                if (box) {
                    if (typeof gsap !== 'undefined' && gsap.killTweensOf) {
                        gsap.killTweensOf(box);
                        gsap.set(box, { y: 0, scale: 1, opacity: 1, filter: 'blur(0px)', clearProps: 'filter' });
                    }
                    box.style.transform = ''; box.style.opacity = ''; box.style.filter = '';
                    box.style.translate = ''; box.style.scale = ''; box.style.rotate = '';
                }
                if (modal) {
                    if (typeof gsap !== 'undefined' && gsap.killTweensOf) {
                        gsap.killTweensOf(modal);
                        gsap.set(modal, { backdropFilter: '', backgroundColor: '' });
                    }
                    modal.style.backdropFilter = ''; modal.style.backgroundColor = '';
                }

                var sourcePosts = Array.isArray(feedAllPosts) && feedAllPosts.length ? feedAllPosts : statAllPosts;
                var sourceComments = Array.isArray(feedAllComments) && feedAllComments.length ? feedAllComments : statAllComments;
                var sourceLikes = Array.isArray(feedAllLikes) && feedAllLikes.length ? feedAllLikes : statAllLikes;
                if (statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }

                if (sourcePosts.length || sourceComments.length || sourceLikes.length) {
                    applyStatSnapshot(sourcePosts, sourceComments, sourceLikes);
                    if (requestId !== statRequestId) return;
                    renderStatByTypeFinal(type);
                    ensureStatDataLoaded(false).then(function(snapshot) {
                        if (!snapshot || !modal || !modal.classList.contains('active') || statCurrentType !== type || requestId !== statRequestId) return;
                        applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                        renderStatByTypeFinal(type);
                    }).catch(function() {});
                    return;
                }

                var snapshot = await ensureStatDataLoaded(true);
                if (!modal || !modal.classList.contains('active') || statCurrentType !== type || requestId !== statRequestId) return;
                if (snapshot) {
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                    renderStatByTypeFinal(type);
                } else if (body) {
                    body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                }
            };

            var originalInitialLoad = initialLoad;
            initialLoad = async function(skipCache) {
                var usedFastSnapshot = false;
                if (!skipCache) {
                    if (Array.isArray(feedAllPosts) && feedAllPosts.length) {
                        usedFastSnapshot = true;
                        await renderFeed({
                            posts: feedAllPosts,
                            comments: feedAllComments || [],
                            likes: feedAllLikes || []
                        });
                    } else {
                        var cachedFeed = readFeedSnapshotCache();
                        if (cachedFeed && cachedFeed.data) {
                            usedFastSnapshot = hydrateFeedStateFromSnapshot(cachedFeed);
                            if (usedFastSnapshot) {
                                await renderFeed({
                                    posts: feedAllPosts,
                                    comments: feedAllComments,
                                    likes: feedAllLikes
                                });
                            }
                        }
                    }
                }
                queueDeferredStartupTasks();
                if (!usedFastSnapshot || skipCache) {
                    return originalInitialLoad.call(this, skipCache);
                }
                loadFeed(true);
            };
            window.initialLoad = initialLoad;

            var originalLoadAnnouncements = loadAnnouncements;
            loadAnnouncements = async function() {
                var listEl = document.getElementById('announcementList');
                var cachedAnnouncements = readAnnouncementCache();
                if (cachedAnnouncements && cachedAnnouncements.data.length && Date.now() - cachedAnnouncements.timestamp < ANN_CACHE_DURATION) {
                    announcements = cachedAnnouncements.data;
                    updateAnnouncementBadge();
                    if (listEl && !listEl.children.length) {
                        renderAnnouncementList();
                    }
                }
                try {
                    await originalLoadAnnouncements.apply(this, arguments);
                    writeAnnouncementCache(announcements || []);
                    if (listEl && announcements && announcements.length) {
                        renderAnnouncementList();
                    }
                } catch (e) {
                    if (cachedAnnouncements && cachedAnnouncements.data.length) {
                        announcements = cachedAnnouncements.data;
                        updateAnnouncementBadge();
                        if (listEl) renderAnnouncementList();
                        return;
                    }
                    throw e;
                }
            };
        })();


