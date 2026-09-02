/**
 * AUTO-ASSEMBLED from js/core-parts (see MANIFEST.json).
 * Edit the part files, then run: node scripts/assemble-core.js
 * Runtime also loads js/core-utils.min.js before this file.
 */

/**
 * core-parts/01-bootstrap.js
 * Config, session bootstrap, secondary-page state
 * Lines from original core.js: 63-2306
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
// console.log('[XTJ] core.js loaded, starting...');

            var XTJ_RUNTIME_CONFIG = window.XTJ_CONFIG || {
                API_BASE: window.location.origin,
                SUPABASE_URL: "https://ithowxqignlhkwaykglt.supabase.co",
                SUPABASE_ANON_KEY: "eyJhbG...yDDA"
            };
            if (!window.XTJ_CONFIG) {
                console.warn('[XTJ] config.js 未加载，使用默认配置');
            }
            window.XTJ_CONFIG = XTJ_RUNTIME_CONFIG;
            // 小猫 AI 统一身份配置
            window.XTJ_AI_IDENTITY = {
              name: '小猫',
              badge: 'AI',
              description: '徐旭泽的犀利毒舌 AI 分身',
              avatar: 'cat_ai',
              username: 'cat_ai'
            };
            const SUPABASE_URL = XTJ_RUNTIME_CONFIG.SUPABASE_URL;
            const SUPABASE_ANON_KEY = XTJ_RUNTIME_CONFIG.SUPABASE_ANON_KEY;
            var API_BASE = XTJ_RUNTIME_CONFIG.API_BASE;
            var sb;
            function initSupabaseClient() {
                if (sb) return true;
                if (!window.supabase || typeof window.supabase.createClient !== 'function') return false;
                try {
                    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                    window.sb = sb;
                    return true;
                } catch (e) {
                    console.error('[XTJ] Supabase client initialization failed:', e && e.message);
                    return false;
                }
            }
            // ★ 修复 M6：检查配置完整性，避免静默失败。
            // 占位符 key（含省略号，如 "eyJhbG...yDDA"）是构建期未注入 env 的标志。
            // ★ 审计修复：不再显式容忍占位符——真实 anon key 由构建/部署注入，
            // 本地/CI 遇到占位符一律 console.error 硬警告（fail-fast），
            // 避免 Supabase 全链路（Realtime/Storage/anon 直连）静默失效掩盖故障。
            var _anonKey = String(SUPABASE_ANON_KEY || '');
            var _sbConfigOk = !!SUPABASE_URL && !!_anonKey && (
              /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(_anonKey)
              || /^sb_publishable_/.test(_anonKey)
            );
            if (!_sbConfigOk) {
                console.error('[XTJ] Supabase 配置缺失或格式不正确，请检查 config.js 或环境变量');
                console.error('[XTJ] SUPABASE_ANON_KEY 当前为' + (_anonKey ? '占位符/无效 key（需在构建/部署时注入真实 anon key）' : '空值'));
                sb = null;
                document.addEventListener('DOMContentLoaded', function () {
                    var _feedEl = document.getElementById('feed');
                    if (_feedEl) _feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">配置错误：Supabase 配置缺失或格式不正确，请检查 config.js</div>';
                });
            } else if (typeof window.supabase !== 'undefined') {
                initSupabaseClient();
            } else {
                console.error('Supabase SDK not loaded');
                window.addEventListener('xtj:supabase-ready', function () {
                    if (!initSupabaseClient()) return;
                    if (typeof window.initialLoad === 'function') {
                        window.initialLoad(true).catch(function (e) {
                            console.warn('[XTJ] delayed Supabase feed restore failed:', e && e.message);
                        });
                    }
                }, { once: true });
                document.addEventListener('DOMContentLoaded', function() {
                    var feedEl = document.getElementById('feed');
                    if (feedEl) feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;">服务加载失败，请刷新页面重试</div>';
                });
            }
            window.sb = sb;


(function() {
    if (window.XTJSecondaryPageState && window.restoreMainNavigationState) return;

    // 保存原始 overflow 和 touchAction，用于恢复
    var _origDocOverflow = null;
    var _origBodyOverflow = null;
    var _origBodyTouchAction = null;

    function saveOriginalStyles() {
        if (_origDocOverflow === null) {
            _origDocOverflow = document.documentElement.style.overflow || '';
            _origBodyOverflow = document.body.style.overflow || '';
            _origBodyTouchAction = document.body.style.touchAction || '';
        }
    }

    function restoreOriginalStyles() {
        if (_origDocOverflow !== null) {
            document.documentElement.style.overflow = _origDocOverflow;
            document.body.style.overflow = _origBodyOverflow;
            document.body.style.touchAction = _origBodyTouchAction;
            _origDocOverflow = null;
            _origBodyOverflow = null;
            _origBodyTouchAction = null;
        } else {
            // A bfcache restore or legacy secondary page can leave inline
            // locks behind without going through saveOriginalStyles().
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            document.body.style.touchAction = '';
        }
    }

    function isVisiblePanel(id, activeClass) {
        var panel = document.getElementById(id);
        if (!panel) return false;
        if (panel.hidden || panel.classList.contains('hidden')) return false;
        if (panel.getAttribute('aria-hidden') === 'true') return false;
        if (activeClass && !panel.classList.contains(activeClass)) return false;
        return true;
    }

    function hasVisibleSecondaryPage() {
        // 通用检查：任何 dock-panel 非默认的可见面板
        return isVisiblePanel('panelDeepThink', 'active');
    }

    function clearStaleDockDisplay() {
        var dockBar = document.getElementById('dockBar') || document.querySelector('.dock-bar');
        if (dockBar && dockBar.style && dockBar.style.display === 'none') {
            dockBar.style.display = '';
        }
    }

    // Owner 契约：同一 owner 真正幂等，open 多次只需一次 close
    // 每个 owner 记录 { handle: releaseFn, domRef: WeakRef|null }
    var _openOwners = {};
    var _ownerSerial = 0;

    function applySecondaryPageState(locked) {
        try {
            document.body.classList.toggle('secondary-page-open', !!locked);
            if (locked) {
                saveOriginalStyles();
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';
                document.body.style.touchAction = 'none';
            } else {
                restoreOriginalStyles();
                document.body.classList.remove('secondary-page-open');
                clearStaleDockDisplay();
            }
        } catch (e) {}
    }

    function getAllOpenOwners() {
        var owners = [];
        for (var k in _openOwners) {
            if (Object.prototype.hasOwnProperty.call(_openOwners, k) && _openOwners[k]) {
                owners.push(k);
            }
        }
        return owners;
    }

    // 清理 stale owner：DOM 不存在、已断开或隐藏时移除
    function cleanStaleOwners() {
        var changed = false;
        for (var k in _openOwners) {
            if (!Object.prototype.hasOwnProperty.call(_openOwners, k)) continue;
            var entry = _openOwners[k];
            if (!entry) { delete _openOwners[k]; changed = true; continue; }
            // 检查 owner 关联的 DOM 是否仍然连接
            if (entry.domRef) {
                var el = entry.domRef.deref();
                if (!el || !el.isConnected || el.hidden ||
                    el.classList.contains('hidden') ||
                    el.getAttribute('aria-hidden') === 'true') {
                    delete _openOwners[k];
                    changed = true;
                }
            }
        }
        return changed;
    }

    function reconcile() {
        cleanStaleOwners();
        var owners = getAllOpenOwners();
        if (owners.length > 0) {
            applySecondaryPageState(true);
            return true;
        }
        applySecondaryPageState(false);
        return false;
    }

    window.XTJSecondaryPageState = {
        // open 真正幂等：同一 owner 已 open 时不重复计数
        // 返回 release handle，调用后等同于 close(ownerName)
        open: function(ownerName, domElement) {
            if (!ownerName) return function(){};
            ownerName = String(ownerName);
            // 已 open 的 owner 不重复计数
            if (_openOwners[ownerName]) {
                // 返回已存在的 release handle
                return _openOwners[ownerName].handle;
            }
            var released = false;
            var handle = function() {
                if (released) return;
                released = true;
                if (_openOwners[ownerName]) delete _openOwners[ownerName];
                reconcile();
            };
            _openOwners[ownerName] = {
                handle: handle,
                domRef: (domElement && typeof WeakRef !== 'undefined') ? new WeakRef(domElement) : null,
                serial: ++_ownerSerial
            };
            reconcile();
            return handle;
        },
        close: function(ownerName) {
            if (!ownerName) return;
            ownerName = String(ownerName);
            if (_openOwners[ownerName]) delete _openOwners[ownerName];
            reconcile();
        },
        reset: function() {
            _openOwners = {};
            reconcile();
        },
        isActive: function(ownerName) {
            if (!ownerName) return false;
            return !!_openOwners[String(ownerName)];
        },
        hasVisibleSecondaryPage: hasVisibleSecondaryPage,
        getOpenOwners: getAllOpenOwners
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
    // pageshow 恢复逻辑：browser back/forward 时重新检测
    window.addEventListener('pageshow', function(e) {
        // 仅当从 bfcache 恢复时才需要重新 reconcile
        if (e.persisted) scheduleRestore();
    });
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') scheduleRestore();
    });
    // 路由切换时重新对账（popstate 覆盖浏览器后退/前进）
    window.addEventListener('popstate', function() { scheduleRestore(); });
})();

window.safeLocalStorageGetJSON = function(key, fallback) {
    try {
        var v = window.safeStorage.get(key);
        if (v === null) return fallback;
        return JSON.parse(v);
    } catch(e) {
        window.safeStorage.remove(key);
        return fallback;
    }
};
window.safeLocalStorageGet = function(key, fallback) {
    try {
        var v = window.safeStorage.get(key);
        return v !== null ? v : fallback;
    } catch(e) {
        return fallback;
    }
};
window.safeLocalStorageSet = function(key, value) {
    window.safeStorage.set(key, String(value));
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
    if (type === 'feed') {
        return '<div class="xtj-loading-skeleton">' +
               '<div class="xtj-skeleton-card"><div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div><div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div></div>' +
               '<div class="xtj-skeleton-card"><div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div><div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div></div>' +
               '</div>';
    }
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
            const AVATAR_CACHE_KEY = "xtj_avatars_v2";
            const AVATAR_CACHE_VERSION = 2;
            const AVATAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时 — localStorage 中 has_avatar 的有效期
            // P7: 显式四态头像缓存的内存有效期（has_avatar 重查间隔、confirmed_none/fetch_failed 的 TTL）
            const AVATAR_FETCH_TTL_MS = 5 * 60 * 1000; // 5 分钟
            const USER_SESSION_KEY = "xtj_user_session";
            const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
            const USER_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
            var memoryUserToken = '';
            var memoryUserTokenIssuedAt = 0;
            var _protectedAuthFailureHandled = false;
            var _lastRefreshAuthResult = { ok: false, reason: 'not_attempted', status: 0 };
            // ★ 刷新时服务端返回的规范 user_name
            var _lastRefreshUser = '';
            // 会话写入时间戳。声明上移，保证 clearUserToken（TDZ 安全）
            // 及其后续所有引用均在此 let 声明之后。
            let lastUserSessionWriteAt = 0;

            function getUserToken() {
                // 仅从内存读取（会话内缓存；持久化令牌机制已移除）
                // 过期时不主动销毁：由 ensureUserToken / 401 刷新路径处理，
                // 避免同步上报路径静默丢 Authorization 且无法触发 refresh。
                var token = memoryUserToken || '';
                if (token) {
                    var ts = memoryUserTokenIssuedAt;
                    if (ts && (Date.now() - ts > 15 * 60 * 1000)) {
                        // 标记可能过期，仍返回 token 让服务端判定；调用方应优先 ensureUserToken
                        try { window.__xtjAccessTokenMaybeStale = true; } catch (e) {}
                    } else {
                        try { window.__xtjAccessTokenMaybeStale = false; } catch (e) {}
                    }
                }
                return token;
            }

            function setUserToken(token) {
                if (token) {
                    // ★ 修复：拿到有效 token 说明会话已就绪，清除 refresh 冷却（登录后立即可刷新）
                    try { _refreshCooldownUntil = 0; } catch (e) {}
                    memoryUserToken = String(token);
                    memoryUserTokenIssuedAt = Date.now();
                    try {
                        if (typeof window.__xtjRememberBehaviorToken === 'function') {
                            window.__xtjRememberBehaviorToken(token);
                        } else {
                            // H-38: 回退分支只记录"已观察到 token"的存在性标志，
                            // 不再把明文 access token 挂到 window（任何脚本都可读）。
                            window.__xtjBehaviorTokenKnown = true;
                        }
                    } catch(e) {}
                    // 通知其他模块用户认证已就绪（用于自动定位等）
                    // ★ 审计修复：事件 detail 不再携带明文 access token（任何脚本均可监听窃取），
                    // 需要 token 的模块直接调 window.getUserToken()。
                    try {
                        window.__xtjAuthReady = true;
                        window.dispatchEvent(new CustomEvent('auth-ready', { detail: { authenticated: true, user_name: String(window.currentUser || window._lastKnownUser || '') } }));
                    } catch(e) {}
                }
            }

            function clearUserToken() {
                memoryUserToken = '';
                memoryUserTokenIssuedAt = 0;
                lastUserSessionWriteAt = 0;
            }

            // Clear all browser-side authentication state in one place. Password
            // hashes are never retained as a session fallback.
            function clearAllAuthState(options) {
                options = options || {};
                var revokeRemote = options.revokeRemote !== false;
                var shouldBroadcast = options.broadcast !== false;
                var reason = options.reason || 'manual';
                var tokenForRevocation = getUserToken();
                clearUserToken();
                lastUserSessionWriteAt = 0;
                try { sessionStorage.removeItem('xtj_pw_hash'); } catch(e) {}
                try { window.safeStorage.remove('xtj_pw_hash'); } catch(e) {}
                try { window.safeStorage.remove('xtj_user'); } catch(e) {}
                try { window.safeStorage.remove(USER_SESSION_KEY); } catch(e) {}
                try { sessionStorage.removeItem('xtj_user'); } catch(e) {}
                try { if (typeof window.clearAiHistoryCacheForUser === 'function') window.clearAiHistoryCacheForUser(); } catch(eCache) {}
                // ★ 清理 AI 聊天缓存
                try { window.safeStorage.remove('xtj_ai_history'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_ai_history'); } catch(e) {}
                // ★ 清理个人资料缓存
                try { window.safeStorage.remove('xtj_profile_cache'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_profile_cache'); } catch(e) {}
                // ★ 清理头像缓存
                try { avatarCache = {}; } catch(e) {}
                try { currentUser = ''; window.currentUser = ''; window._lastKnownUser = ''; } catch(e) {}
                // ★ 清理浏览历史与 feed 缓存：不含用户名的缓存键必须随账号切换清空，防止跨用户串扰（隐私泄漏）
                try { window.safeStorage.remove('xtj_view_history'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_view_history'); } catch(e) {}
                try { window.safeStorage.remove('xtj_feed_cache_v7'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_feed_cache_v7'); } catch(e) {}
                // ★ 清理 AI 相关的异步请求和 pending 状态
                try {
                    if (typeof window.__xtjAbortAiRequests === 'function') window.__xtjAbortAiRequests();
                } catch(e) {}
                try {
                    // Phase 3-P0-2: 使用统一清理函数，替代分散的内联清理
                    // 统一清理 timer / AbortController / status DOM / cache 并设置迟到回调防护
                    if (typeof cancelCatAiTask === 'function') cancelCatAiTask();
                } catch(e) {}
                // Explicit logout revokes the refresh cookie. An expired session
                // must not make another request just to report that it expired.
                if (revokeRemote) try {
                    var logoutHeaders = {};
                    if (tokenForRevocation) logoutHeaders.Authorization = 'Bearer ' + tokenForRevocation;
                    // ★ 审计修复：logout 请求复用 xtjFetch 超时封装（8s），
                    // 避免 VPN/半开连接下 fetch 永不 settle（与 doLogout 的 8s 超时对齐）。
                    var logoutFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                    logoutFetch(API_BASE + '/api/user/logout', {
                        method: 'POST', credentials: 'include', headers: logoutHeaders
                    }, 8000).catch(function(){});
                } catch(e) {}

                // ★ 广播退出事件到其他标签页（仅当非远程同步触发时）
                if (shouldBroadcast) {
                    try { if (typeof window.__xtjBroadcastLogout === 'function') window.__xtjBroadcastLogout(reason); } catch(e) {}
                }
            }
            window.clearAllAuthState = clearAllAuthState;

            function handleProtectedAuthFailure() {
                if (_protectedAuthFailureHandled) return;
                _protectedAuthFailureHandled = true;
                clearAllAuthState({ revokeRemote: false });
                try { if (typeof showToast === 'function') showToast('登录已失效，请重新登录', 'error'); } catch (e) {}
                try { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); } catch (e2) {}
                // ★ 30秒后重置，允许用户关闭弹窗后再次触发
                setTimeout(function() { _protectedAuthFailureHandled = false; }, 30000);
            }
            window.handleProtectedAuthFailure = handleProtectedAuthFailure;

            async function ensureUserToken() {
                var existingToken = memoryUserToken || '';
                var ts = memoryUserTokenIssuedAt;
                var maybeStale = !!(existingToken && ts && (Date.now() - ts > 15 * 60 * 1000));
                if (existingToken && !maybeStale) return existingToken;
                // 无 token 或可能过期：用 refresh cookie 刷新
                var result = await refreshUserTokenViaCookie();
                return (result && result.token) || existingToken || '';
            }

            // 通过 HttpOnly cookie 中的 refresh token 刷新 access token
            var _refreshPromise = null;
            // ★ 修复：未登录/会话失效（401/403）后进入 30 秒冷却期，
            // 避免每次切换导航都重复发起 refresh 请求（此前产生 401 噪音与冗余请求）。
            var _refreshCooldownUntil = 0;
            async function refreshUserTokenViaCookie() {
                if (_refreshPromise) return _refreshPromise;
                if (_refreshCooldownUntil && Date.now() < _refreshCooldownUntil) {
                    return { token: '', user_name: '' };
                }
                _refreshPromise = (async function() {
                    try {
                        // VPN/代理下无超时的 refresh 会卡住 ensureUserToken → feed 永久 skeleton
                        var refreshFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        var res = await refreshFetch(API_BASE + '/api/user/refresh', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' }
                        }, 10000);
                        if (res.ok) {
                            var data = await res.json().catch(function(){ return {}; });
                            if (data && data.token) {
                                setUserToken(data.token);
                                // ★ 使用服务端返回的规范 user_name
                                var serverUserName = (data.user_name || '').trim();
                                if (serverUserName) {
                                    _lastRefreshUser = serverUserName;
                                }
                                _lastRefreshAuthResult = { ok: true, reason: 'ok', status: res.status };
                                return { token: data.token, user_name: serverUserName || '' };
                            }
                            _lastRefreshAuthResult = { ok: false, reason: 'invalid_response', status: res.status };
                            return { token: '', user_name: '' };
                        }
                        _lastRefreshAuthResult = {
                            ok: false,
                            reason: res.status === 401 ? 'expired' : (res.status === 403 ? 'forbidden' : 'unavailable'),
                            status: res.status
                        };
                        // ★ 修复：401/403（未登录或会话失效）进入冷却期，抑制短时间内的重复刷新请求
                        if (res.status === 401 || res.status === 403) {
                            _refreshCooldownUntil = Date.now() + 30000;
                        }
                        return { token: '', user_name: '' };
                    } catch(e) {
                        _lastRefreshAuthResult = { ok: false, reason: 'network_error', status: 0 };
                        return { token: '', user_name: '' };
                    } finally {
                        _refreshPromise = null;
                    }
                })();
                return _refreshPromise;
            }

            /**
             * 返回统一认证请求头对象。
             * 使用短期 access token，过期时仅通过 HttpOnly refresh cookie 刷新。
             */
            window.getUserAuthHeaders = async function() {
                // 先尝试从 cookie 刷新
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
             * 使用 refresh token cookie 强制刷新。
             */
            window.refreshUserToken = async function(force) {
                try {
                    if (!force) {
                        var existing = getUserToken();
                        if (existing) return existing;
                    }
                    // 优先 cookie 刷新
                    var result = await refreshUserTokenViaCookie();
                    if (result && result.token) return result.token;
                } catch (e) {}
                return '';
            };

            /**
             * ★ 新增：统一鉴权状态检查（AI 模块用）
             *  - 仅当 currentUser + 真实 token 都存在时，返回 ok=true
             *  - 没有 access token 时，仅尝试 HttpOnly refresh cookie
             * 返回 { ok, reason, token, user_name }
             *   - reason: 'ok' | 'no_user' | 'missing_auth_credentials' | 'refresh_failed'
             */
            window.ensureProtectedOperationAuth = async function() {
                // ★ 启动验证未完成时，等待验证完成（最多 5 秒）
                if (window._xtjAuthState === 'auth_pending') {
                    var waitStart = Date.now();
                    while (window._xtjAuthState === 'auth_pending' && (Date.now() - waitStart) < 5000) {
                        await new Promise(function(r) { setTimeout(r, 150); });
                    }
                }
                try {
                    var userName = '';
                    try {
                        if (typeof currentUser === 'string') userName = currentUser;
                        else if (currentUser && currentUser.user_name) userName = currentUser.user_name;
                    } catch (e) { userName = ''; }
                    if (!userName) {
                        try { userName = window.safeStorage.get('xtj_user') || ''; } catch (e) {}
                    }
                    userName = String(userName || '').trim();
                    if (!userName) return { ok: false, reason: 'no_user', token: '', user_name: '' };

                    var token = await ensureUserToken();
                    if (token) {
                        // ★ 验证 token 身份与 UI 身份一致
                        // 优先使用刷新时服务端返回的规范 user_name
                        if (_lastRefreshUser && _lastRefreshUser !== userName) {
                            // Token 对应的是另一个账号，UI 身份过期
                            _protectedAuthFailureHandled = true;
                            clearAllAuthState({ revokeRemote: false, broadcast: false, reason: 'identity_mismatch' });
                            try { if (typeof showToast === 'function') showToast('账号认证状态异常，请重新登录', 'error'); } catch (e) {}
                            try { if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); } catch (e2) {}
                            return { ok: false, reason: 'identity_mismatch', token: token, user_name: userName };
                        }
                        _protectedAuthFailureHandled = false;
                        try { touchUserSession(false); } catch (e2) {}
                        return { ok: true, reason: 'ok', token: token, user_name: userName };
                    }
                    if (_lastRefreshAuthResult.reason === 'expired') {
                        handleProtectedAuthFailure();
                        return { ok: false, reason: 'expired', status: _lastRefreshAuthResult.status, token: '', user_name: userName };
                    }
                    return {
                        ok: false,
                        reason: _lastRefreshAuthResult.reason || 'unavailable',
                        status: _lastRefreshAuthResult.status || 0,
                        token: '',
                        user_name: userName
                    };
                } catch (e) {
                    return { ok: false, reason: 'exception', status: 0, token: '', user_name: '' };
                }
            };
            window.ensureRealUserAuth = window.ensureProtectedOperationAuth;

            window.xtjProtectedFetch = async function(path, options) {
                options = options || {};
                var timeoutMs = options.timeoutMs != null ? options.timeoutMs : 15000;
                var auth = await window.ensureProtectedOperationAuth();
                if (!auth.ok) {
                    var authError = new Error(auth.reason === 'expired' ? '登录已失效' : '认证服务暂时不可用');
                    authError.code = auth.reason || 'auth_unavailable';
                    authError.status = auth.status || 0;
                    throw authError;
                }
                async function send(token) {
                    var headers = Object.assign({}, options.headers || {});
                    var isFormData = options.body instanceof FormData;
                    if (!isFormData && !headers['Content-Type'] && options.body != null) {
                        headers['Content-Type'] = 'application/json';
                    }
                    headers.Authorization = 'Bearer ' + token;
                    var fetchOpts = Object.assign({}, options, {
                        credentials: 'include',
                        headers: headers
                    });
                    delete fetchOpts.timeoutMs;
                    var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                    return doFetch((window.API_BASE || '') + path, fetchOpts, timeoutMs);
                }
                var response = await send(auth.token);
                if (response.status === 401) {
                    var renewed = await window.refreshUserToken(true);
                    if (renewed) response = await send(renewed);
                }
                if (response.status === 401) {
                    window.handleProtectedAuthFailure();
                }
                return response;
            };

            // Public feed endpoints may use identity when available, but must never force login.
            window.xtjOptionalAuthFetch = async function(path, options) {
                options = options || {};
                var timeoutMs = options.timeoutMs != null ? options.timeoutMs : 15000;
                var knownUser = String(currentUser || window.safeStorage.get('xtj_user') || '').trim();

                async function send(token) {
                    var headers = Object.assign({}, options.headers || {});
                    if (token) headers.Authorization = 'Bearer ' + token;
                    var fetchOpts = Object.assign({}, options, {
                        credentials: 'include',
                        headers: headers
                    });
                    delete fetchOpts.timeoutMs;
                    var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                    return doFetch((window.API_BASE || '') + path, fetchOpts, timeoutMs);
                }

                var token = getUserToken();
                // 已登录但无 access token 时 refresh 可能因 VPN 挂起；ensureUserToken 内已有超时
                if (!token && knownUser) {
                    try {
                        token = await ensureUserToken();
                    } catch (tokenErr) {
                        console.warn('[XTJ] optional-auth token refresh failed:', tokenErr && tokenErr.message);
                        token = '';
                    }
                }
                var response = await send(token);
                if (token && response.status === 401) {
                    var renewed = await window.refreshUserToken(true);
                    response = await send(renewed || '');
                }
                return response;
            };

            // P7: 头像缓存改为显式四态结构。
            // 每个条目形如 { state, url, fetched_at }：
            //   state: 'has_avatar' | 'confirmed_none' | 'fetch_failed' | 'not_fetched'
            //   url:   有头像时为 URL 字符串；confirmed_none 为 null；
            //          fetch_failed 保留上一次成功获取的 URL（降级用，可能为 null）
            //   fetched_at: 写入时间戳（ms）
            let avatarCache = {};

            // 读取内存缓存中的头像 URL（用于展示）。返回 string 或 null。
            // - has_avatar     → entry.url
            // - confirmed_none → null（TTL 内不重查）
            // - fetch_failed   → entry.url（旧 URL 降级，可能为 null）
            // - not_fetched    → null
            function getAvatarUrl(userName) {
                if (!userName) return null;
                var entry = avatarCache[userName];
                if (!entry) return null;
                return entry.url || null;
            }

            // 内存缓存是否仍处于 TTL 内（调用方不应重新查询后端）。
            function hasFreshAvatarCache(userName) {
                if (!userName) return false;
                var entry = avatarCache[userName];
                if (!entry || entry.state === 'not_fetched') return false;
                var age = Date.now() - (entry.fetched_at || 0);
                return age < AVATAR_FETCH_TTL_MS;
            }

            // 写入内存缓存条目。fetch_failed 时若 url 为空则保留旧 URL（降级）。
            function setAvatarCacheEntry(userName, state, url) {
                if (!userName) return;
                var now = Date.now();
                var prevUrl = (avatarCache[userName] && avatarCache[userName].url) || null;
                var resolvedUrl;
                if (state === 'has_avatar') {
                    resolvedUrl = url || null;
                } else if (state === 'fetch_failed') {
                    resolvedUrl = url || prevUrl;
                } else {
                    resolvedUrl = null;
                }
                avatarCache[userName] = {
                    state: state,
                    url: resolvedUrl,
                    fetched_at: now
                };
            }

            // ★ 头像缓存版本化读写（含 TTL 和 fetched_at）
            // 返回 { username: { state, url, fetched_at } } 对象映射。
            function readAvatarCacheFromStorage() {
                try {
                    var raw = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, null);
                    var now = Date.now();
                    if (raw && raw.version === AVATAR_CACHE_VERSION && raw.data) {
                        var result = {};
                        var keys = Object.keys(raw.data);
                        for (var i = 0; i < keys.length; i++) {
                            var entry = raw.data[keys[i]];
                            if (!entry || typeof entry !== 'object') continue;
                            // 迁移旧格式：无 state 字段但有 url → 视为 has_avatar
                            var state = entry.state || (entry.url ? 'has_avatar' : null);
                            if (!state) continue;
                            // fetch_failed 不持久化（仅内存），防御性跳过
                            if (state === 'fetch_failed') continue;
                            var fetchedAt = entry.fetched_at || 0;
                            // TTL 按状态区分：has_avatar 24h，confirmed_none 5min
                            var ttl = state === 'confirmed_none' ? AVATAR_FETCH_TTL_MS : AVATAR_CACHE_TTL_MS;
                            if ((now - fetchedAt) >= ttl) continue;
                            // has_avatar 必须有 url
                            if (state === 'has_avatar' && !entry.url) continue;
                            result[keys[i]] = {
                                state: state,
                                url: entry.url || null,
                                fetched_at: fetchedAt
                            };
                        }
                        return result;
                    }
                    // 迁移旧格式 { username: url }
                    var old = window.safeLocalStorageGetJSON("xtj_avatars", null);
                    if (old && typeof old === 'object' && !old.version) {
                        var migrated = { version: AVATAR_CACHE_VERSION, data: {} };
                        var oldKeys = Object.keys(old);
                        for (var j = 0; j < oldKeys.length; j++) {
                            if (typeof old[oldKeys[j]] === 'string') {
                                migrated.data[oldKeys[j]] = {
                                    state: 'has_avatar',
                                    url: old[oldKeys[j]],
                                    fetched_at: Date.now()
                                };
                            }
                        }
                        window.safeStorage.set(AVATAR_CACHE_KEY, JSON.stringify(migrated));
                        // 迁移后删除旧缓存
                        try { window.safeStorage.remove("xtj_avatars"); } catch(e) {}
                        var mResult = {};
                        var mKeys = Object.keys(migrated.data);
                        for (var k = 0; k < mKeys.length; k++) {
                            mResult[mKeys[k]] = migrated.data[mKeys[k]];
                        }
                        return mResult;
                    }
                } catch(e) {}
                return {};
            }
            // data 为 { username: { state, url, fetched_at } } 对象映射。
            // 只持久化 has_avatar 与 confirmed_none；fetch_failed 不写入 localStorage。
            function writeAvatarCacheToStorage(data) {
                try {
                    var now = Date.now();
                    var wrapped = { version: AVATAR_CACHE_VERSION, data: {} };
                    var keys = Object.keys(data || {});
                    for (var i = 0; i < keys.length; i++) {
                        var entry = data[keys[i]];
                        if (!entry || typeof entry !== 'object') continue;
                        // 只持久化 has_avatar 和 confirmed_none
                        if (entry.state !== 'has_avatar' && entry.state !== 'confirmed_none') continue;
                        // 跳过已过期的 confirmed_none（5min TTL）
                        if (entry.state === 'confirmed_none' &&
                            (now - (entry.fetched_at || 0)) >= AVATAR_FETCH_TTL_MS) continue;
                        // has_avatar 必须有 url
                        if (entry.state === 'has_avatar' && !entry.url) continue;
                        wrapped.data[keys[i]] = {
                            state: entry.state,
                            url: entry.url || null,
                            fetched_at: entry.fetched_at || now
                        };
                    }
                    window.safeStorage.set(AVATAR_CACHE_KEY, JSON.stringify(wrapped));
                } catch(e) {}
            }
            function invalidateAvatarCacheEntry(username) {
                if (!username) return;
                // P7: 上传头像后立即失效 confirmed_none 缓存（设置为 not_fetched），
                // 这样下次 fetchAvatarUrl 会重新查询后端获取新头像。
                // 清除 url（与原 delete 行为一致），避免 onerror 后重渲染复用已失效的 URL。
                avatarCache[username] = {
                    state: 'not_fetched',
                    url: null,
                    fetched_at: 0
                };
                try {
                    var raw = window.safeLocalStorageGetJSON(AVATAR_CACHE_KEY, null);
                    if (raw && raw.version === AVATAR_CACHE_VERSION && raw.data) {
                        delete raw.data[username];
                        window.safeStorage.set(AVATAR_CACHE_KEY, JSON.stringify(raw));
                    }
                } catch(e) {}
            }
            // ★ 暴露为全局函数，供 inline onerror 调用
            window.__xtjInvalidateAvatarCache = function(username) {
                invalidateAvatarCacheEntry(username);
            };

            // 从后端 API 获取用户头像（修复 RLS 权限问题，不再直接查询 __avatar__）
            // P7: 显式四态 — has_avatar / confirmed_none / fetch_failed / not_fetched
            async function fetchAvatarUrl(userName) {
                if (!userName) return null;
                // P7: TTL 内的缓存直接返回，不重新查询后端。
                // - has_avatar     → 返回 url
                // - confirmed_none → 返回 null（TTL 内不重查）
                // - fetch_failed   → 返回旧 url（降级，可能为 null）
                if (hasFreshAvatarCache(userName)) {
                    return getAvatarUrl(userName);
                }
                try {
                    var resp = await fetch(API_BASE + '/api/avatar/public/' + encodeURIComponent(userName));
                    if (!resp.ok) {
                        // P7: 网络失败 — 设置 fetch_failed，不缓存为无头像。
                        // 保留旧 URL 用于降级展示。
                        setAvatarCacheEntry(userName, 'fetch_failed', null);
                        return getAvatarUrl(userName);
                    }
                    var result = await resp.json();
                    if (result.ok && result.avatar_url) {
                        setAvatarCacheEntry(userName, 'has_avatar', result.avatar_url);
                        return result.avatar_url;
                    }
                    if (result.ok && result.avatar_url === null) {
                    // P7: 后端确认无头像 — 清除旧缓存并设置 confirmed_none，TTL 内有效。
                    delete avatarCache[userName];
                    setAvatarCacheEntry(userName, 'confirmed_none', null);
                    return null;
                }
                    // 后端返回非预期结构 — 视为失败
                    setAvatarCacheEntry(userName, 'fetch_failed', null);
                    return getAvatarUrl(userName);
                } catch(e) {
                    // P7: 网络异常 — 设置 fetch_failed，降级返回旧缓存 URL。
                    setAvatarCacheEntry(userName, 'fetch_failed', null);
                    return getAvatarUrl(userName);
                }
            }

        function readUserSession() {
            try {
                var raw = window.safeStorage.get(USER_SESSION_KEY);
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
            window.safeStorage.set(USER_SESSION_KEY, JSON.stringify(next));
            window.safeStorage.set("xtj_user", name);
            lastUserSessionWriteAt = now;
            return next;
        }

        // Remove credentials left by earlier clients; ongoing sessions are renewed
        // exclusively through the HttpOnly refresh cookie.
        try { sessionStorage.removeItem('xtj_pw_hash'); window.safeStorage.remove('xtj_pw_hash'); } catch(e) {}

        function clearUserSessionStorage() {
            try { window.safeStorage.remove(USER_SESSION_KEY); } catch (e) {}
            try { window.safeStorage.remove("xtj_user"); } catch (e) {}
            try { sessionStorage.removeItem("xtj_pw_hash"); } catch (e) {}
            try { window.safeStorage.remove("xtj_pw_hash"); } catch (e) {}
            lastUserSessionWriteAt = 0;
        }

        function restoreCurrentUserFromSession() {
            var now = Date.now();
            var session = readUserSession();
            if (!session) {
                var legacyUser = "";
                try { legacyUser = window.safeStorage.get("xtj_user") || ""; } catch (e) { legacyUser = ""; }
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
                window.safeStorage.set("xtj_user", userName);
            } catch (e) {}
            lastUserSessionWriteAt = now;
            return userName;
        }

        function touchUserSession(force) {
            // ★ 幽灵会话防护：当前认证状态已是登出（显式登出/启动时身份不匹配/会话过期清理后），
            // 直接 return，绝不把残留的 xtj_user 重新写回 storage，避免"UI 未登录但 storage 显示已登录"。
            if (window._xtjAuthState === 'unauthenticated') return;
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
        // ★ 认证状态机：auth_pending | authenticated | unauthenticated | offline_unverified
        window._xtjAuthState = currentUser ? 'auth_pending' : 'unauthenticated';
        window._xtjCanonicalUser = ''; // 服务端确认的权威用户名

        // ★ 是否已通过服务端验证（auth_pending 期间禁止所有受保护操作）
        window.isAuthenticated = function() {
            return window._xtjAuthState === 'authenticated';
        };
        window.getCanonicalUser = function() {
            return window._xtjCanonicalUser || window.currentUser || '';
        };

        // ★ 启动时尝试验证会话：如果从 session 恢复了用户，用 refresh cookie 验证
        var _startupAuthVerified = false;
        if (currentUser) {
            loadCurrentUserInfoSnapshot(currentUser).catch(function() {});
            // 异步验证：尝试用 refresh cookie 获取 token 并校验身份
            (async function() {
                try {
                    var refreshResult = await refreshUserTokenViaCookie();
                    var serverUser = (refreshResult && refreshResult.user_name) || '';
                    if (serverUser && serverUser !== currentUser) {
                        // Token 身份与会话不一致，清除幽灵登录状态
                        clearAllAuthState({ revokeRemote: false, broadcast: false, reason: 'startup_identity_mismatch' });
                        currentUser = '';
                        window.currentUser = '';
                        window._lastKnownUser = '';
                        window._xtjAuthState = 'unauthenticated';
                        window._xtjCanonicalUser = '';
                        // 刷新 UI
                        if (typeof initUI === 'function') initUI().catch(function() {});
                    } else if (serverUser) {
                        _startupAuthVerified = true;
                        window._xtjAuthState = 'authenticated';
                        window._xtjCanonicalUser = serverUser;
                        // 确保内部状态一致
                        if (serverUser !== currentUser) {
                            currentUser = serverUser;
                            window.currentUser = serverUser;
                            window._lastKnownUser = serverUser;
                            writeUserSession(serverUser, { resetLoginAt: false });
                        }
                    }
                } catch (e) {
                    // 验证失败，如果 refresh cookie 不存在则清除幽灵状态
                    if (_lastRefreshAuthResult.reason === 'expired' || _lastRefreshAuthResult.reason === 'no_cookie') {
                        clearAllAuthState({ revokeRemote: false, broadcast: false, reason: 'startup_refresh_expired' });
                        currentUser = '';
                        window.currentUser = '';
                        window._lastKnownUser = '';
                        window._xtjAuthState = 'unauthenticated';
                        window._xtjCanonicalUser = '';
                        if (typeof initUI === 'function') initUI().catch(function() {});
                    } else {
                        // 网络暂时失败，保留本地用户名但标记为 offline_unverified
                        window._xtjAuthState = 'offline_unverified';
                    }
                }
            })();
        }

        // ★ 多标签页账号切换同步 (BroadcastChannel) - 带事件去重
        (function() {
            try {
                // ★ 生成稳定的 sourceTabId
                var _sourceTabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                var _processedEventIds = {};
                var _MAX_PROCESSED_EVENTS = 50;

                function _isOwnMessage(msg) {
                    return msg && msg.sourceTabId === _sourceTabId;
                }
                function _isEventProcessed(eventId) {
                    if (!eventId) return false;
                    return !!_processedEventIds[eventId];
                }
                function _markEventProcessed(eventId) {
                    if (!eventId) return;
                    _processedEventIds[eventId] = Date.now();
                    // 清理超过50条旧记录
                    var keys = Object.keys(_processedEventIds);
                    if (keys.length > _MAX_PROCESSED_EVENTS) {
                        keys.sort(function(a, b) { return _processedEventIds[a] - _processedEventIds[b]; });
                        var toRemove = keys.length - _MAX_PROCESSED_EVENTS;
                        for (var i = 0; i < toRemove; i++) { delete _processedEventIds[keys[i]]; }
                    }
                }

                var authChannel = new BroadcastChannel('xtj_auth_sync');
                authChannel.addEventListener('message', function(event) {
                    var msg = event && event.data;
                    if (!msg || !msg.type) return;
                    // ★ 忽略自己发出的消息
                    if (_isOwnMessage(msg)) return;
                    // ★ 防止重复消费
                    if (_isEventProcessed(msg.eventId)) return;
                    _markEventProcessed(msg.eventId);

                    if (msg.type === 'account_switched' || msg.type === 'logout') {
                        // 其他标签页切换了账号，本标签页必须清除旧状态
                        // ★ broadcast:false 防止形成循环广播
                        clearAllAuthState({ revokeRemote: false, broadcast: false, reason: 'remote_sync' });
                        currentUser = '';
                        window.currentUser = '';
                        window._lastKnownUser = '';
                        if (typeof initUI === 'function') initUI().catch(function() {});
                        if (typeof showToast === 'function') showToast('账号已在其他窗口切换，请重新登录', 'info');
                    }
                });
                // 登录成功后广播
                window.__xtjBroadcastAuthChange = function(newUser) {
                    try {
                        var eventId = 'auth_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                        _markEventProcessed(eventId);
                        authChannel.postMessage({
                            type: 'account_switched',
                            eventId: eventId,
                            sourceTabId: _sourceTabId,
                            user: newUser,
                            timestamp: Date.now()
                        });
                    } catch (e) {}
                };
                // 退出时广播
                window.__xtjBroadcastLogout = function(reason) {
                    try {
                        var eventId = 'logout_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                        _markEventProcessed(eventId);
                        authChannel.postMessage({
                            type: 'logout',
                            eventId: eventId,
                            sourceTabId: _sourceTabId,
                            reason: reason || 'manual',
                            timestamp: Date.now()
                        });
                    } catch (e) {}
                };
                // ★ 审计修复：页面卸载时关闭 BroadcastChannel，避免 bfcache 往返/多实例累积
                try {
                    window.addEventListener('pagehide', function() {
                        try { authChannel.close(); } catch (eClose) {}
                    }, { once: true });
                } catch (eBind) {}
            } catch (e) {
                // BroadcastChannel 不可用（旧浏览器），静默降级
            }
        })();

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
                    fetch(API_BASE + '/api/log-user-visit', {
                        method: 'POST', headers: headers, body: JSON.stringify(body)
                    }).catch(function(){
                        try { checkReportReplies(); } catch (_) {}
                    });
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

        // ★ 审计修复：原"前端攻击检测"（RAPID_CLICK >8次/秒 写 Supabase）是死逻辑——
        // logFrontendAttack 首行 `if (typeof API_BASE !== 'undefined' && API_BASE) return;`
        // 而 API_BASE 恒存在，检测从未生效，却长期占用一个全局 capture click 监听。
        // 已删除该死代码与全局监听；如确需攻击检测，应改走后端 API 上报。

        let dockChatListCacheTime = 0;
        const DOCK_CHAT_CACHE_DURATION = 120000;
        let deviceId;
        try { deviceId = window.safeStorage.get("xtj_device_id"); } catch(e) { deviceId = null; }
        if (!deviceId) {
            try { deviceId = crypto.randomUUID(); } catch(e) { deviceId = 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }
            window.safeStorage.set("xtj_device_id", deviceId);
        }
        window.deviceId = deviceId;

        let delPostId = null, delOwnerKey = null;
        let activePostId = null;
        const viewTracked = new Set();
        // 挂到 window：登出清理 clearAllAuthState 中 window.viewTracked.clear() 依赖此引用
        window.viewTracked = viewTracked;
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
            var list = Array.from(nodes || []).filter(Boolean);
            // Paint the first few posts immediately so mobile users never sit on
            // blank opacity-0 cards while IntersectionObserver catches up.
            list.slice(0, 6).forEach(function(post) {
                if (!post.classList.contains('visible')) post.classList.add('visible');
            });
            list.forEach(function(post) {
                getPostVisibilityObserver().observe(post);
                getPostDwellObserver().observe(post);
            });
            // Failsafe: any remaining hidden posts become visible shortly after.
            if (list.some(function(post) { return !post.classList.contains('visible'); })) {
                setTimeout(function() {
                    list.forEach(function(post) {
                        if (post && post.isConnected && !post.classList.contains('visible')) {
                            post.classList.add('visible');
                        }
                    });
                }, 400);
            }
        }
        const CACHE_KEY = "xtj_feed_cache_v7";
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

function isAdmin() { return (currentUser || window.currentUser) === ADMIN_NAME; }
        function clearFeedCache() {
            try { window.safeStorage.remove(CACHE_KEY); } catch (e) {}
            feedVisiblePostsCache = null;
            feedMapsCache = null;
        }
        window.clearFeedCache = clearFeedCache;

        window.syncProfileUser = window.syncProfileUser || function() {
            var name = document.getElementById('profileName');
            var status = document.getElementById('profileStatus');
            var avatar = document.getElementById('profileAvatar');
            if (!name) return;
            if (window.currentUser) {
                name.textContent = window.currentUser;
                if (status) status.textContent = '查看资料';
                if (avatar) avatar.textContent = window.currentUser[0].toUpperCase();
            } else {
                name.textContent = '未登录';
                if (status) status.textContent = '请先登录';
                if (avatar) avatar.textContent = '?';
            }
        };

        // ★ 修复 M-1：个人中心"通知"开关此前完全没有绑定，拨动无任何持久化效果。
        // 初始化时读取 xtj-notif 设置 checked 状态，change 时写入偏好（'off' 表示关闭）。
        function initProfileNotificationToggle() {
            var toggle = document.getElementById('profileNotifToggle');
            if (!toggle || toggle.__xtjNotifBound) return;
            toggle.__xtjNotifBound = true;
            try {
                toggle.checked = window.safeStorage.get('xtj-notif') !== 'off';
            } catch (e) {}
            toggle.addEventListener('change', function() {
                try {
                    window.safeStorage.set('xtj-notif', toggle.checked ? 'on' : 'off');
                } catch (e) {}
            });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initProfileNotificationToggle);
        } else {
            initProfileNotificationToggle();
        }

        var xtjModuleDefinitions = {
            enhancements: { scripts: ['xtj-module-core-animations', 'xtj-module-features', 'xtj-module-ui-effects'] },
            'ai-agent': { styles: ['xtj-module-ai-style'], scripts: ['xtj-module-ai-script'] },
            'code-workbench': { dependencies: ['ai-agent'], scripts: ['xtj-module-code-workbench'] },
            'photo-wall': { scripts: ['xtj-module-photo-data', 'xtj-module-photo-render', 'xtj-module-photo-main'] },
            'photo-preview': { styles: ['xtj-module-photo-preview-style'], scripts: ['xtj-module-photo-preview', 'xtj-module-photo-preview-hotfix'] },
            'photo-upload': { dependencies: ['photo-wall'], scripts: ['xtj-module-photo-upload'] },
            // TODO(安全): gsap 外部 CDN 暂未加 SRI（integrity）——需在部署环境计算真实 hash 后补充，
            // 或改为同源自托管；错误的 hash 会导致加载失败，故不在源码中伪造。
            gsap: { externalScripts: ['https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'] }
        };
        var xtjModulePromises = Object.create(null);
        var XTJ_MODULE_LOAD_TIMEOUT = 45000;

        function moduleAssetUrl(metaName) {
            var meta = document.querySelector('meta[name="' + metaName + '"]');
            return meta && String(meta.content || '').trim();
        }

        function loadModuleStyle(moduleName, metaName) {
            var url = moduleAssetUrl(metaName);
            if (!url) return Promise.reject(new Error('missing_module_asset:' + metaName));
            return new Promise(function(resolve, reject) {
                var selector = 'link[data-xtj-asset="' + metaName + '"]';
                var existing = document.querySelector(selector);
                if (existing && existing.dataset.xtjLoaded === '1') return resolve(existing);
                if (existing && existing.dataset.xtjFailed === '1') { existing.remove(); existing = null; }
                var node = existing || document.createElement('link');
                var settled = false;
                var timer = null;
                function cleanup() { timer && clearTimeout(timer); timer = null; node.onload = null; node.onerror = null; }
                function fail(code) {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    node.dataset.xtjFailed = '1';
                    if (node.parentNode) node.remove();
                    reject(new Error(code + ':' + moduleName));
                }
                node.onload = function() {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    node.dataset.xtjLoaded = '1';
                    delete node.dataset.xtjFailed;
                    resolve(node);
                };
                node.onerror = function() { fail('module_style_failed'); };
                timer = setTimeout(function() { fail('module_style_timeout'); }, XTJ_MODULE_LOAD_TIMEOUT);
                if (!existing) {
                    node.rel = 'stylesheet';
                    node.href = url;
                    node.dataset.xtjAsset = metaName;
                    node.dataset.xtjModule = moduleName;
                    document.head.appendChild(node);
                }
            });
        }

        function loadModuleScript(moduleName, assetKey, directUrl) {
            var url = directUrl || moduleAssetUrl(assetKey);
            if (!url) return Promise.reject(new Error('missing_module_asset:' + assetKey));
            return new Promise(function(resolve, reject) {
                var selector = 'script[data-xtj-asset="' + assetKey.replace(/"/g, '\\"') + '"]';
                var existing = document.querySelector(selector);
                if (existing && existing.dataset.xtjLoaded === '1') return resolve(existing);
                if (existing && existing.dataset.xtjFailed === '1') { existing.remove(); existing = null; }
                var node = existing || document.createElement('script');
                var settled = false;
                var timer = null;
                function cleanup() { timer && clearTimeout(timer); timer = null; node.onload = null; node.onerror = null; }
                function fail(code) {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    node.dataset.xtjFailed = '1';
                    if (node.parentNode) node.remove();
                    reject(new Error(code + ':' + moduleName));
                }
                node.onload = function() {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    node.dataset.xtjLoaded = '1';
                    delete node.dataset.xtjFailed;
                    resolve(node);
                };
                node.onerror = function() { fail('module_script_failed'); };
                timer = setTimeout(function() { fail('module_script_timeout'); }, XTJ_MODULE_LOAD_TIMEOUT);
                if (!existing) {
                    node.src = url;
                    node.defer = true;
                    node.dataset.xtjAsset = assetKey;
                    node.dataset.xtjModule = moduleName;
                    (document.body || document.head).appendChild(node);
                }
            });
        }

        function loadXtjModule(name) {
            var moduleName = String(name || '');
            var definition = xtjModuleDefinitions[moduleName];
            if (!definition) return Promise.reject(new Error('unknown_module:' + moduleName));
            if (xtjModulePromises[moduleName]) return xtjModulePromises[moduleName];
            var dependencyChain = (definition.dependencies || []).reduce(function(chain, dependency) {
                return chain.then(function() { return loadXtjModule(dependency); });
            }, Promise.resolve());
            xtjModulePromises[moduleName] = dependencyChain.then(function() {
                // 并行加载 CSS 和 JS，避免串行等待
                var cssPromise = (definition.styles || []).length > 0
                    ? Promise.all((definition.styles || []).map(function(metaName) { return loadModuleStyle(moduleName, metaName); }))
                    : Promise.resolve();
                var scripts = (definition.scripts || []).map(function(metaName) { return { key: metaName, url: null }; });
                (definition.externalScripts || []).forEach(function(url) { scripts.push({ key: moduleName + '-external-' + url, url: url }); });
                var jsPromise = scripts.length > 0
                    ? scripts.reduce(function(chain, item) {
                        return chain.then(function() { return loadModuleScript(moduleName, item.key, item.url); });
                    }, Promise.resolve())
                    : Promise.resolve();
                return Promise.all([cssPromise, jsPromise]).then(function() {
                    var valid = true;
                    if (moduleName === 'ai-agent') valid = !!(window.__xtjAiAgent && typeof window.__xtjAiAgent.open === 'function');
                    if (!valid) throw new Error('module_export_missing:' + moduleName);
                    return { name: moduleName, loadedAt: Date.now() };
                });
            }).catch(function(error) {
                delete xtjModulePromises[moduleName];
                throw error;
            });
            return xtjModulePromises[moduleName];
        }
        window.XTJModuleLoader = {
            load: loadXtjModule,
            diagnose: function(name) {
                var definition = xtjModuleDefinitions[String(name || '')] || {};
                return {
                    name: String(name || ''),
                    scripts: (definition.scripts || []).map(moduleAssetUrl),
                    styles: (definition.styles || []).map(moduleAssetUrl),
                    state: xtjModulePromises[String(name || '')] ? 'loading-or-ready' : 'idle'
                };
            }
        };

        function ensureGsap() {
            if (window.gsap) return Promise.resolve(window.gsap);
            return loadXtjModule('gsap').then(function() { return window.gsap || null; });
        }
        window.ensureGsap = ensureGsap;
        window.__xtjEnsureGsap = ensureGsap;

        function ensurePhotoWallLoaded() {
            return loadXtjModule('photo-wall');
        }

        function ensurePhotoWallPreviewLoaded() {
            return loadXtjModule('photo-preview');
        }

        function ensurePhotoWallUploadLoaded() {
            return loadXtjModule('photo-upload');
        }

        function ensureAiAgentLoaded() {
            return loadXtjModule('ai-agent');
        }
        window.__xtjEnsureAiAgentLoaded = ensureAiAgentLoaded;

        function bindTopAiToolsLauncher() {
            var nav = document.getElementById('aiToolsNav');
            var trigger = document.getElementById('aiToolsBtn');
            var menu = document.getElementById('aiToolsMenu');
            if (!nav || !trigger || !menu || nav.__xtjAiToolsBound) return;
            nav.__xtjAiToolsBound = true;

            // 去掉遗留的 Win 空弹原生 select
            var legacySelect = document.getElementById('aiToolsNativeSelect');
            if (legacySelect && legacySelect.parentNode) {
                try { legacySelect.parentNode.removeChild(legacySelect); } catch (eRem) {}
            }

            trigger.removeAttribute('aria-hidden');
            trigger.removeAttribute('tabindex');
            trigger.setAttribute('aria-haspopup', 'menu');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-controls', 'aiToolsMenu');

            var open = false;

            function setOpen(next) {
                open = !!next;
                menu.hidden = !open;
                menu.setAttribute('aria-hidden', open ? 'false' : 'true');
                trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
                nav.classList.toggle('is-open', open);
            }

            function runTool(tool) {
                setOpen(false);
                return ensureAiAgentLoaded().then(function() {
                    if (tool === 'research' && window.__xtjAiAgent && typeof window.__xtjAiAgent.openDeepThink === 'function') return window.__xtjAiAgent.openDeepThink();
                    if (tool === 'search' && window.__xtjAiAgent && typeof window.__xtjAiAgent.openSiteSearch === 'function') return window.__xtjAiAgent.openSiteSearch();
                    if (tool === 'chat' && window.__xtjAiAgent && typeof window.__xtjAiAgent.open === 'function') return window.__xtjAiAgent.open();
                    if (typeof window.__xtjOpenAiChat === 'function') return window.__xtjOpenAiChat();
                }).catch(function(error) {
                    console.error('[XTJ] top AI tools load failed:', error);
                    if (typeof window.showToast === 'function') window.showToast('AI 工具加载失败，请重试');
                });
            }

            nav.addEventListener('pointerenter', function() {
                ensureAiAgentLoaded().catch(function() {});
            }, { passive: true });
            nav.addEventListener('focusin', function() {
                ensureAiAgentLoaded().catch(function() {});
            });

            trigger.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                ensureAiAgentLoaded().catch(function() {});
                setOpen(!open);
            });

            menu.addEventListener('click', function(event) {
                event.stopPropagation();
                var btn = event.target && event.target.closest ? event.target.closest('[data-ai-tool]') : null;
                if (!btn) return;
                var tool = btn.getAttribute('data-ai-tool');
                if (!tool) return;
                runTool(tool);
            });

            document.addEventListener('click', function(event) {
                if (!open) return;
                if (nav.contains(event.target)) return;
                setOpen(false);
            });
            document.addEventListener('keydown', function(event) {
                if (event.key === 'Escape' && open) setOpen(false);
            });
        }
        bindTopAiToolsLauncher();
        scheduleAiPreload();

        function ensureCoreAnimationsLoaded() {
            return loadXtjModule('enhancements');
        }
        window.__xtjEnsureCoreAnimationsLoaded = ensureCoreAnimationsLoaded;

        function loadEnhancementsAfterInteraction() {
            document.removeEventListener('pointerdown', loadEnhancementsAfterInteraction, true);
            document.removeEventListener('keydown', loadEnhancementsAfterInteraction, true);
            ensureCoreAnimationsLoaded().catch(function(error) {
                console.error('[XTJ] enhancement module load failed:', error);
            });
        }
        document.addEventListener('pointerdown', loadEnhancementsAfterInteraction, true);
        document.addEventListener('keydown', loadEnhancementsAfterInteraction, true);

        function lazyAiChatLauncher() {
            var _aiChatOpenInProgress = false;
            var _aiChatOpenPromise = null;
            var _aiChatLastError = null;
            var _aiChatOpenGeneration = 0;

            // A Code navigation must be able to invalidate a lazy AI load.
            // Without this, an old ensureAiAgentLoaded()/ensureUserToken()
            // continuation can re-open panelAiChat over Code after the user
            // has already left it.
            window.__xtjCancelPendingAiChatOpen = function() {
                _aiChatOpenGeneration += 1;
                _aiChatOpenInProgress = false;
                _aiChatOpenPromise = null;
            };

            window.__xtjOpenAiChat = function() {
                if (_aiChatOpenInProgress) return;
                _aiChatOpenInProgress = true;
                _aiChatLastError = null;
                var openGeneration = ++_aiChatOpenGeneration;

                // 立即进入 AI 页面骨架（300ms 内）
                var aiChatPanel = document.getElementById('panelAiChat');
                if (aiChatPanel) {
                    // 清理旧状态
                    if (aiChatPanel.classList.contains('is-entering')) aiChatPanel.classList.remove('is-entering');
                    if (aiChatPanel.classList.contains('is-leaving')) aiChatPanel.classList.remove('is-leaving');
                    aiChatPanel.classList.remove('hidden');
                    aiChatPanel.style.display = '';
                    aiChatPanel.innerHTML = getAiChatSkeleton();
                    aiChatPanel.classList.add('active');
                    aiChatPanel.setAttribute('aria-hidden', 'false');
                    aiChatPanel.setAttribute('aria-busy', 'true');
                }

                // 显示 loading 在 AI 页面内部
                var loadingEl = aiChatPanel ? aiChatPanel.querySelector('.ai-chat-loading') : null;
                if (loadingEl) loadingEl.textContent = '正在加载 AI 模块...';

                // 初始化分阶段错误状态
                var errorState = { resource: false, auth: false, config: false, sessions: false, history: false };

                _aiChatOpenPromise = ensureAiAgentLoaded().then(function() {
                    if (openGeneration !== _aiChatOpenGeneration) return;
                    if (loadingEl) loadingEl.textContent = '正在恢复登录状态...';
                    return ensureUserToken().then(function(token) {
                        if (openGeneration !== _aiChatOpenGeneration) return;
                        if (!token) { errorState.auth = true; throw new Error('auth_expired'); }
                        if (loadingEl) loadingEl.textContent = '正在加载 AI 配置...';
                        if (typeof window.__xtjOpenAiChat === 'function' && window.__xtjOpenAiChat !== lazyAiChatLauncher._realOpen) {
                            if (openGeneration !== _aiChatOpenGeneration) return;
                            window.__xtjOpenAiChat();
                            if (window.XTJPerf) window.XTJPerf.mark('ai-first-open');
                            return;
                        }
                        errorState.config = true;
                        throw new Error('ai_module_not_ready');
                    });
                }).catch(function(err) {
                    if (openGeneration !== _aiChatOpenGeneration) return;
                    _aiChatLastError = err;
                    _aiChatOpenInProgress = false;
                    if (aiChatPanel) {
                        aiChatPanel.removeAttribute('aria-busy');
                        renderAiChatErrorState(aiChatPanel, errorState, err);
                    }
                    console.error('[XTJ] ai-agent lazy load failed:', err);
                }).finally(function() {
                    if (openGeneration === _aiChatOpenGeneration) {
                        _aiChatOpenInProgress = false;
                        if (loadingEl) loadingEl.textContent = '';
                    }
                });
            };
            lazyAiChatLauncher._realOpen = window.__xtjOpenAiChat;
        }
        lazyAiChatLauncher();

        function getAiChatSkeleton() {
            return '<div class="ai-chat-container" style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px 160px;background:var(--bg-primary, #fff);">'
                + '<div class="ai-chat-loading" style="font-size:15px;color:var(--text-secondary, #888);margin-bottom:20px;text-align:center;"></div>'
                + '<div class="ai-chat-error" style="display:none;max-width:360px;text-align:center;color:var(--text-primary, #333);"></div>'
                + '</div>';
        }

        function renderAiChatErrorState(panel, errorState, err) {
            var errorEl = panel.querySelector('.ai-chat-error');
            var loadingEl = panel.querySelector('.ai-chat-loading');
            if (loadingEl) loadingEl.style.display = 'none';
            if (!errorEl) return;
            errorEl.style.display = '';

            var msgs = [];
            var errMsg = err && err.message || '';

            if (errorState.resource) {
                msgs.push('<div class="ai-chat-error-item" style="margin-bottom:14px;padding:12px;background:var(--bg-error, #fff0f0);border-radius:8px;">'
                    + '<strong>AI 资源加载失败</strong><br><small style="color:var(--text-secondary);">请检查网络连接后重试</small><br>'
                    + '<button onclick="window.__xtjOpenAiChat()" style="margin-top:8px;padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">重试加载</button>'
                    + '</div>');
            }
            if (errorState.auth) {
                msgs.push('<div class="ai-chat-error-item" style="margin-bottom:14px;padding:12px;background:var(--bg-error, #fff0f0);border-radius:8px;">'
                    + '<strong>登录已过期</strong><br><small style="color:var(--text-secondary);">请重新登录后继续使用 AI</small><br>'
                    + '<button onclick="window.openAuthModal(\'login\')" style="margin-top:8px;padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">重新登录</button>'
                    + '</div>');
            }
            if (errorState.config) {
                msgs.push('<div class="ai-chat-error-item" style="margin-bottom:14px;padding:12px;background:var(--bg-error, #fff0f0);border-radius:8px;">'
                    + '<strong>AI 配置加载失败</strong><br><small style="color:var(--text-secondary);">服务器暂不可用</small><br>'
                    + '<button onclick="window.__xtjOpenAiChat()" style="margin-top:8px;padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">重试</button>'
                    + '</div>');
            }
            if (msgs.length === 0) {
                msgs.push('<div class="ai-chat-error-item" style="padding:12px;background:var(--bg-error, #fff0f0);border-radius:8px;">'
                    + '<strong>加载失败</strong><br><small style="color:var(--text-secondary);">' + escapeHtml(errMsg || '未知错误') + '</small><br>'
                    + '<button onclick="window.__xtjOpenAiChat()" style="margin-top:8px;padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">重试</button>'
                    + '</div>');
            }
            errorEl.innerHTML = msgs.join('');
        }

        // 空闲时预加载 AI 模块（不阻塞消息列表首屏渲染）
        var _aiPreloadScheduled = false;
        function scheduleAiPreload() {
            if (_aiPreloadScheduled) return;
            _aiPreloadScheduled = true;
            var preloadFn = function() {
                try {
                    ensureAiAgentLoaded().then(function() {
                        console.log('[XTJ] AI module preloaded');
                    }).catch(function(err) {
                        console.warn('[XTJ] AI module preload failed:', err && err.message);
                    });
                } catch(e) {}
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(preloadFn, { timeout: 2000 });
            } else {
                setTimeout(preloadFn, 2000);
            }
        }
        // 在消息页面加载后触发预加载
        window.__xtjScheduleAiPreload = scheduleAiPreload;

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
            var metaLocationName = meta.location_name || "";
            var metaLocationProvince = meta.location_province || "";
            var metaLocationCity = meta.location_city || "";
            var metaLocationDistrict = meta.location_district || "";
            var metaLocationLevel = meta.location_level || "";
            return Object.assign({}, post, {
                content: parsed.text || "",
                visibility: realVisibility || meta.visibility || "public",
                is_pinned: hasRealPinned ? !!post.is_pinned : !!meta.is_pinned,
                pinned_at: hasRealPinnedAt ? post.pinned_at : (meta.pinned_at || null),
                updated_at: hasRealUpdatedAt ? post.updated_at : (meta.updated_at || null),
                location_name: post && post.location_name ? post.location_name : metaLocationName,
                location_province: post && post.location_province ? post.location_province : metaLocationProvince,
                location_city: post && post.location_city ? post.location_city : metaLocationCity,
                location_district: post && post.location_district ? post.location_district : metaLocationDistrict,
                location_level: post && post.location_level ? post.location_level : metaLocationLevel,
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
            var p = normalizePost(post);
            return isAdmin() || (!!p && p.user_name === currentUser);
        }
        window.canPinPost = canPinPost;

        // Authors may pin their own post; the server enforces one pinned post per author.
        async function canPinThisPost(post) {
            if (isAdmin()) return true;
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
            get deviceId() { return window.deviceId; }
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

/**
 * core-parts/03-profile-report-ai.js
 * Profile card, activity, reports, cat-AI comment polling
 * Lines from original core.js: 2850-4752
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            // ========== 查看用户资料卡 ==========
            let upcTargetUser = null;
            // S7 修复：资料卡请求代次号，防止快速切换用户时旧响应覆盖新用户资料
            let upcRequestSeq = 0;

            window.openUserProfile = async function(userName) {
                upcTargetUser = userName;
                var _seq = ++upcRequestSeq;
                document.getElementById('upcName').textContent = userName;
                document.getElementById('upcLogin').textContent = '最近登录：加载中...';
                
                var avatarEl = document.getElementById('upcAvatar');
                if (!avatarEl) return;
                // localStorage 取头像缓存，失败用字母占位
                var showAvatar = getAvatarUrl(userName);
                if (!showAvatar && userName === currentUser) {
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                            showAvatar = cachedAvatars[currentUser].url || null;
                        }
                    } catch(e) {}
                }
                if (showAvatar) {
                    avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(showAvatar)) + '" alt="头像">';
                } else {
                    avatarEl.innerHTML = '<span id="upcAvatarText">' + escapeHtml(String(userName || '?').charAt(0).toUpperCase()) + '</span>';
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
                
                // 加载用户头像
                try {
                    // 当前用户优先使用localStorage缓存
                    if (userName === currentUser) {
                        try {
                            var cv = readAvatarCacheFromStorage();
                            if (cv[currentUser]) {
                                avatarCache[currentUser] = cv[currentUser];
                                if (document.getElementById('userProfileModal').classList.contains('active')) {
                                    avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(cv[currentUser].url)) + '" alt="头像">';
                                }
                            }
                        } catch(e) {}
                    }

                    var avatarUrl = await fetchAvatarUrl(userName);

                    // S7 修复：响应落地前校验目标用户是否已切换，旧响应不得覆盖新资料
                    if (_seq !== upcRequestSeq || upcTargetUser !== userName) return;

                    if (avatarUrl) {
                        if (userName !== currentUser) {
                            setAvatarCacheEntry(userName, 'has_avatar', avatarUrl);
                        } else if (!getAvatarUrl(currentUser)) {
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                        }
                        if (document.getElementById('userProfileModal').classList.contains('active')) {
                            var url = (userName === currentUser && getAvatarUrl(currentUser)) ? getAvatarUrl(currentUser) : avatarUrl;
                            var imgHtml = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(url)) + '" alt="头像" onerror="this.style.display=\'none\';var s=document.createElement(\'span\');s.textContent=this.alt[0]?this.alt[0].toUpperCase():\'?\';s.className=\'avatar-fallback\';this.parentNode.appendChild(s);">';
                            avatarEl.innerHTML = imgHtml;
                            // 写入本地缓存
                            if (userName === currentUser) {
                                try { var cv = readAvatarCacheFromStorage(); cv[currentUser] = { state: 'has_avatar', url: url, fetched_at: Date.now() }; writeAvatarCacheToStorage(cv); } catch(_) {}
                            }
                        }
                    }
                    
                    // 隐私收紧：__user_info__ 仅允许本人读取（RLS 035 已强制），
                    // 非本人不再发起 anon 直读，直接显示占位。
                    var userInfoRes = null;
                    if (userName === currentUser) {
                        userInfoRes = await sb.from("posts")
                            .select("content")
                            .eq("user_name", userName)
                            .eq("media_type", "__user_info__")
                            .order("created_at", { ascending: false })
                            .limit(1);
                    }
                    
                    // S7 修复：同上，用户已切换则丢弃本次结果
                    if (_seq !== upcRequestSeq || upcTargetUser !== userName) return;
                    
                    if (userInfoRes.data && userInfoRes.data.length > 0) {
                        try {
                            var info = JSON.parse(userInfoRes.data[0].content);
                            if (info.last_login) {
                                document.getElementById('upcLogin').textContent = '最近登录：' + window.safeParseDate(info.last_login).toLocaleString();
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

            // ========== 个人资料详情功能 ==========
            window.openProfileDetail = async function() {
                if (!currentUser) {
                    openAuthModal('login');
                    return;
                }
                
                // 打开个人资料详情
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
                                document.getElementById('profileDetailRegTime').textContent = window.safeParseDate(userInfo.reg_time).toLocaleString();
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
                if (!avatarEl) return;
                
                // localStorage 兼容处理
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[currentUser] && cachedAvatars[currentUser].url) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(cachedAvatars[currentUser].url)) + '" alt="头像">';
                        return;
                    }
                } catch(e) {}

                // 优先使用内存缓存中的头像 URL
                var memUrl = getAvatarUrl(currentUser);
                if (memUrl) {
                    avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(memUrl)) + '" alt="头像">';
                }

                try {
                    var avatarUrl = await fetchAvatarUrl(currentUser);

                    if (avatarUrl) {
                        var safeAvatarUrl = escapeHtml(sanitizeUrl(avatarUrl));
                        avatarEl.innerHTML = '<img loading="lazy" decoding="async" src="' + safeAvatarUrl + '" alt="头像">';
                        setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                        // 写入 localStorage
                        try {
                            var cv = readAvatarCacheFromStorage();
                            cv[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                            writeAvatarCacheToStorage(cv);
                        } catch(e) {}
                    } else if (!getAvatarUrl(currentUser)) {
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
                        // 使用 createImageBitmap 进行图片压缩（若支持）
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
                                // fallback: 使用 canvas 压缩
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
                // ★ 修复 S5：前端同样拒绝 SVG（服务端已拒），避免 SVG 先上传到公共桶、
                // 后端再拒绝造成的"存储桶残留可执行脚本文件"窗口。
                if (/\.svgz?$/i.test(String(file.name || '')) || file.type === 'image/svg+xml') {
                    showToast('不支持 SVG 头像（存在安全风险）');
                    return;
                }
                
                if (file.size > 10 * 1024 * 1024) {
                    showToast('图片大小不能超过10MB');
                    return;
                }
                
                showToast('正在压缩并上传头像..');
                
                try {
                    // ★ 修复：compressImage 此前定义了却从未被调用，原图直传（浪费带宽/存储）。
                    // 仅对大文件（>1.5MB）压缩为 JPEG 再上传；小图保持原样避免透明背景被压平，
                    // 压缩失败则回退原图上传，不影响可用性。
                    var uploadFile = file;
                    var path = buildStorageUploadPath('avatars', file.name);
                    if (file.size > 1.5 * 1024 * 1024) {
                        try {
                            var compressedDataUrl = await compressImage(file, 1024, 1024, 0.82);
                            if (compressedDataUrl && compressedDataUrl.length > 0) {
                                var compressedBlob = await (await window.fetch(compressedDataUrl)).blob();
                                if (compressedBlob && compressedBlob.size > 0 && compressedBlob.size < file.size) {
                                    uploadFile = compressedBlob;
                                    path = buildStorageUploadPath('avatars', 'avatar-' + Date.now() + '.jpg');
                                }
                            }
                        } catch (compressErr) { console.warn('[avatar] compress failed, upload raw', compressErr); }
                    }
                    
                    // 上传到 Supabase Storage
                    if (/\.(svgz?|html?|xml|swf)$/i.test(String(file && file.name || '')) || /^image\/svg\+xml/i.test(String(file && file.type || ''))) {
                        throw new Error('file type not allowed');
                    }
                    const { error: uploadErr } = await sb.storage.from('uploads').upload(path, uploadFile);
                    if (uploadErr) throw uploadErr;
                    
                    // 获取 Public URL
                    const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
                    
                    // 头像记录必须由服务端校验当前用户并写入，不能在 anon
                    // 客户端保留一条绕过 RLS/归属校验的旧写入路径。
                    try {
                        if (typeof window.API_BASE !== 'string' || !window.API_BASE) {
                            throw new Error('头像服务不可用');
                        }
                        var avAuthHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                        var avResp = await fetch(window.API_BASE.replace(/\/$/, '') + '/api/avatar', {
                            method: 'POST',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, avAuthHeaders || {}),
                            body: JSON.stringify({ media_url: avatarUrl })
                        });
                        var avData = await avResp.json().catch(function() { return {}; });
                        if (!avResp.ok || !avData || !avData.ok) {
                            throw new Error((avData && avData.error) || '头像保存失败');
                        }
                    } catch (avErr) {
                        // The request may have committed before its response
                        // was lost. Confirm ownership server-side before
                        // deleting the uploaded object, otherwise a valid
                        // avatar row can point at a deleted file.
                        var avatarCommitted = false;
                        try {
                            var statusAuthHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                            var statusResp = await fetch(window.API_BASE.replace(/\/$/, '') + '/api/avatar/status', {
                                method: 'POST',
                                headers: Object.assign({ 'Content-Type': 'application/json' }, statusAuthHeaders || {}),
                                credentials: 'include',
                                body: JSON.stringify({ media_url: avatarUrl })
                            });
                            var statusData = await statusResp.json().catch(function() { return {}; });
                            avatarCommitted = !!(statusResp.ok && statusData && statusData.committed);
                        } catch (statusErr) {}
                        if (avatarCommitted) {
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                            try {
                                var committedCache = readAvatarCacheFromStorage();
                                committedCache[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                                writeAvatarCacheToStorage(committedCache);
                            } catch (cacheErr) {}
                            updateAllAvatarElements(avatarUrl);
                            showToast('头像已更新');
                            event.target.value = '';
                            return;
                        }
                        try { await sb.storage.from('uploads').remove([path]); } catch (cleanupErr) {}
                        showToast('头像上传失败: ' + (avErr && avErr.message || '网络错误'));
                        event.target.value = '';
                        return;
                    }
                    
                    setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                    // 保存到localStorage持久化存储
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        cachedAvatars[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                        writeAvatarCacheToStorage(cachedAvatars);
                    } catch(e) {}
                    updateAllAvatarElements(avatarUrl);

                    showToast('头像更新成功');
                    window.safeStorage.remove(CACHE_KEY);
                    await loadFeed(true);
                    setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
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
                var avatarContent = renderAvatarContent(currentUser, avatarUrl);
                var els = [
                    document.getElementById('profileAvatar'),
                    document.getElementById('myAvatar'),
                    document.getElementById('profileDetailAvatar'),
                    document.getElementById('upcAvatar')
                ];
                els.forEach(function(el) {
                    if (el) {
                        el.innerHTML = avatarContent;
                    }
                });
                document.querySelectorAll('#feed .post .avatar').forEach(function(el) {
                    var header = el.closest('.post-header');
                    if (header) {
                        var nameEl = header.querySelector('.user-name');
                        if (nameEl && nameEl.textContent === currentUser) {
                            el.innerHTML = avatarContent;
                        }
                    }
                });
                document.querySelectorAll('#dockChatMessages .chat-msg-avatar').forEach(function(el) {
                    if (el.closest('.chat-msg-row.sent')) {
                        el.innerHTML = avatarContent;
                    }
                });
                document.querySelectorAll('#dockChatList .chat-list-item').forEach(function(el) {
                    var nameEl = el.querySelector('.cli-name');
                    if (nameEl && nameEl.textContent === currentUser) {
                        var avEl = el.querySelector('.cli-avatar');
                        if (avEl) {
                            avEl.innerHTML = avatarContent;
                        }
                    }
                });
            }

            async function updateAllAvatars() {
                // 统一更新所有用户头像缓存（含 localStorage）
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[currentUser] && cachedAvatars[currentUser].url) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        const profileAvatar = document.getElementById('profileAvatar');
                        if (profileAvatar) {
                            profileAvatar.innerHTML = renderAvatarContent(currentUser, cachedAvatars[currentUser].url);
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
                            profileAvatar.innerHTML = renderAvatarContent(currentUser, avatarRes.data[0].media_url);
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarRes.data[0].media_url);
                            try {
                                var cv = readAvatarCacheFromStorage();
                                cv[currentUser] = { state: 'has_avatar', url: avatarRes.data[0].media_url, fetched_at: Date.now() };
                                writeAvatarCacheToStorage(cv);
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

            var _isLoggingOut = false;
            window.doLogout = async function () {
                if (_isLoggingOut) return;
                _isLoggingOut = true;

                try { if (typeof window.xtjStopLocationSharing === 'function') window.xtjStopLocationSharing('位置共享已关闭'); } catch (e) {}

                var savedToken = '';
                var savedUser = '';
                try { savedToken = getUserToken() || ''; } catch (e) {}
                try { savedUser = currentUser || window.currentUser || ''; } catch (e) {}

                var logoutCallSucceeded = false;
                try {
                    var logoutHeaders = { 'Content-Type': 'application/json' };
                    if (savedToken) logoutHeaders.Authorization = 'Bearer ' + savedToken;
                    // H-37: 登出请求加 8s 超时，避免请求悬挂时 _isLoggingOut 永真，
                    // 导致之后所有登出点击无效、本地状态永不清除。
                    var logoutAbortCtl = null;
                    var logoutTimeoutTimer = null;
                    if (typeof AbortController === 'function') {
                        logoutAbortCtl = new AbortController();
                        logoutTimeoutTimer = setTimeout(function() { try { logoutAbortCtl.abort(); } catch (e) {} }, 8000);
                    }
                    var resp = await fetch(API_BASE + '/api/user/logout', {
                        method: 'POST',
                        credentials: 'include',
                        headers: logoutHeaders,
                        signal: logoutAbortCtl ? logoutAbortCtl.signal : undefined
                    });
                    if (logoutTimeoutTimer) clearTimeout(logoutTimeoutTimer);
                    if (resp && resp.ok) logoutCallSucceeded = true;
                } catch (e) {
                    console.error('API logout failed (will still clear local state):', e);
                }

                try {
                    if (typeof window.__xtjAbortAiRequests === 'function') window.__xtjAbortAiRequests();
                } catch (e) {}
                try {
                    // Phase 3-P0-2: 使用统一清理函数，替代分散的内联清理
                    if (typeof cancelCatAiTask === 'function') cancelCatAiTask();
                } catch (e) {}
                try { stopRestrictionPolling(); } catch (e) {}
                try { stopDMPolling(); } catch (e) {}
                try { stopReportReplyPolling(); } catch (e) {}
                try { if (chatRealtime) { sb.removeChannel(chatRealtime); chatRealtime = null; } } catch (e) {}
                try { if (commentRealtime) { sb.removeChannel(commentRealtime); commentRealtime = null; } } catch (e) {}
                try { if (annRealtime) { sb.removeChannel(annRealtime); annRealtime = null; } } catch (e) {}

                clearUserToken();
                lastUserSessionWriteAt = 0;
                try { sessionStorage.removeItem('xtj_pw_hash'); } catch(e) {}
                try { window.safeStorage.remove('xtj_pw_hash'); } catch(e) {}
                try { window.safeStorage.remove('xtj_user'); } catch(e) {}
                try { window.safeStorage.remove(USER_SESSION_KEY); } catch(e) {}
                try { sessionStorage.removeItem('xtj_user'); } catch(e) {}
                try { if (typeof window.clearAiHistoryCacheForUser === 'function') window.clearAiHistoryCacheForUser(); } catch(e) {}
                try { window.safeStorage.remove('xtj_ai_history'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_ai_history'); } catch(e) {}
                try { window.safeStorage.remove('xtj_profile_cache'); } catch(e) {}
                try { sessionStorage.removeItem('xtj_profile_cache'); } catch(e) {}
                try { avatarCache = {}; } catch(e) {}
                try { window.safeStorage.remove(AVATAR_CACHE_KEY); } catch(e) {}

                currentUser = '';
                window.currentUser = '';
                window._lastKnownUser = '';
                window.currentUserInfoSnapshot = null;
                _chatCache = {};
                // M-2d: 登出时复位聊天面板会话状态，防止切换账号后残留上一账号的
                // 聊天标题/渲染签名，导致串号或列表不刷新
                try { dockChatActiveUser = null; } catch(e) {}
                try { _dockChatListRenderSignature = ''; } catch(e) {}
                try { _chatRenderSignature = {}; } catch(e) {}
                window.dockChatListCacheTime = 0;
                window._xtjAuthState = 'unauthenticated';
                // L11 修复：登出时断开浏览量 Observer 并清空跨会话缓存，避免单页长开内存缓慢增长
                try { if (typeof window.__xtjCleanupObservers === 'function') window.__xtjCleanupObservers(); } catch(e) {}
                try { if (typeof window.viewTracked === 'object' && window.viewTracked.clear) window.viewTracked.clear(); } catch(e) {}
                try { if (typeof window.postInfoCache === 'object') { Object.keys(window.postInfoCache).forEach(function(k) { delete window.postInfoCache[k]; }); } } catch(e) {}

                var xtjKeys = [];
                // H-36: 登出只清除会话相关键，保留用户偏好与设备身份：
                // xtj-theme（主题偏好，theme-toggle.js 实际使用连字符 key）、xtj_device_id（设备 ID，设备追踪）、
                // xtj_pending_behavior（未上报的遥测队列）。
                // ★ 修复：新增 xtj-notif（通知开关偏好）、xtj_report_reply_check（举报回复提醒）、
                // xtj_current_tab（最近停留 tab）等用户偏好键，避免登出静默重置用户设置。
                var xtjPreserveKeys = {
                    'xtj-theme': 1,
                    'xtj_theme': 1,
                    'xtj_device_id': 1,
                    'xtj_pending_behavior': 1,
                    'xtj-notif': 1,
                    'xtj_report_reply_check': 1,
                    'xtj_current_tab': 1
                };
                try {
                    for (var i = 0; i < localStorage.length; i++) {
                        var key = localStorage.key(i);
                        if (key && (key.indexOf('xtj_') === 0 || key.indexOf('xtj-') === 0) && !xtjPreserveKeys[key]) {
                            xtjKeys.push(key);
                        }
                    }
                } catch (e) {}
                xtjKeys.forEach(function(k) {
                    try { window.safeStorage.remove(k); } catch(e) {}
                });
                clearUserSessionStorage();
                try {
                    var loginNick = document.getElementById('loginNickInp');
                    var loginPw = document.getElementById('loginPwInp');
                    var regNick = document.getElementById('regNickInp');
                    var regPw = document.getElementById('regPwInp');
                    if (loginNick) loginNick.value = '';
                    if (loginPw) loginPw.value = '';
                    if (regNick) regNick.value = '';
                    if (regPw) regPw.value = '';
                } catch (e) {}
                document.body.style.overflow = '';

                try { if (typeof window.__xtjBroadcastLogout === 'function') window.__xtjBroadcastLogout('manual'); } catch(e) {}
                try { if (typeof window.queueBehavior === 'function') window.queueBehavior('logout', '用户退出登录'); } catch(e) {}

                showToast('已退出登录');
                try { await initUI(); } catch (e) {}
                initialLoad(true).catch(function() {});
                _isLoggingOut = false;
            };

            // 处理"我的"页面卡片点击
            window.handleProfileCardClick = function() {
                if (currentUser) {
                    // 已登录：打开个人资料详情
                    openProfileDetail();
                } else {
                    // 未登录：弹出登录框
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
                    || mediaType === '__revoked_token__'
                    || mediaType === '__refresh_token__';
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

            // 返回列表副本（状态快照使用，避免外部数组被后续修改污染内部状态）
            function cloneProfileLikes(items) {
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
                    var titleText = escapeHtml((typeof currentUser === 'object' && currentUser ? (currentUser.user_metadata?.full_name || currentUser.email) : (typeof currentUser === 'string' ? currentUser : '')) || '我') + (isLikes ? ' 点赞了这条帖子' : ' 评论了这条帖子');
                    var metaHtml = [
                        '<div class="profile-activity-record__meta">',
                        '<span class="profile-activity-record__time">' + window.safeParseDate(item.created_at).toLocaleString() + '</span>',
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
                // ★ 修复：缓存窗口从 45000ms 缩短到 8000ms —— 用户在其他页面点赞/评论后，
                // 45 秒内切回"我的"面板看不到更新；缩短后切回即可较快看到最新互动数据。
                if (!forceRefresh && profileActivityState.loadedUser === currentUser && Date.now() - profileActivityState.lastLoadedAt < 8000) {
                    renderProfileActivity();
                    return;
                }
                profileActivityState.loading = true;
                try {
                    var results = await Promise.all([
                        window.xtjProtectedFetch('/api/likes/user/' + encodeURIComponent(currentUser) + '?limit=160')
                            .then(function(r) { return r.json(); })
                            .catch(function(e) { return { ok: false, error: e.message }; }),
                        window.xtjProtectedFetch('/api/comments/user/' + encodeURIComponent(currentUser) + '?limit=160')
                            .then(async function(response) {
                                var body = await response.json();
                                if (!response.ok || !body.ok) throw new Error(body.error || '评论记录加载失败');
                                return body;
                            })
                            .catch(function(error) { return { error: error, data: [], count: 0 }; }),
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
                    if (likesRes && !likesRes.ok) console.warn('likes load warning:', likesRes.error);
                    if (commentsRes.error) throw commentsRes.error;
                    if (postsCountRes.error) throw postsCountRes.error;
                    if (reportsRes && reportsRes.error) console.warn('reports load warning:', reportsRes.error);

                    profileActivityState.likes = cloneProfileLikes(likesRes && likesRes.data || []);
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
                    var resp = await window.xtjProtectedFetch('/api/likes/user/' + encodeURIComponent(currentUser) + '/post/' + postId, { method: 'DELETE' });
                    var result = await resp.json();
                    if (!resp.ok || !result.ok) throw new Error(result.error || '删除失败');

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

            window.deleteFeedComment = async function(commentId, btn) {
                if (!confirm('确定要永久删除这条评论吗？')) return;
                var originalText = btn ? btn.textContent : '删除';
                var controller = typeof AbortController === 'function' ? new AbortController() : null;
                var timeout = setTimeout(function() {
                    if (controller) controller.abort();
                }, 10000);
                try {
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '删除中..';
                    }
                    var response = await window.xtjProtectedFetch('/api/post/comment/' + encodeURIComponent(commentId), {
                        method: 'DELETE',
                        signal: controller ? controller.signal : undefined
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) throw new Error(result.error || '删除评论失败');
                    
                    feedAllComments = (feedAllComments || []).filter(function(item) {
                        return String(item.id) !== String(commentId);
                    });
                    if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                    if (typeof renderFeedFromMemoryState === 'function') {
                        renderFeedFromMemoryState();
                    } else if (typeof rebuildFeedFromCurrentState === 'function') {
                        rebuildFeedFromCurrentState().catch(function() {});
                    }
                    // 成功路径同样恢复按钮（disabled/textContent），
                    // 与 catch/finally 行为保持一致，避免按钮残留"删除中.."
                    if (btn) {
                        btn.disabled = false;
                        if (btn.textContent === '删除中..') btn.textContent = originalText || '删除';
                    }
                    showToast('评论已删除');
                } catch (e) {
                    console.error('deleteFeedComment error:', e);
                    showToast(e && e.name === 'AbortError' ? '删除超时，请重试' : (e.message || '删除失败'));
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                    }
                } finally {
                    clearTimeout(timeout);
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
                    var response = await window.xtjProtectedFetch('/api/post/comment/' + encodeURIComponent(commentId), {
                        method: 'DELETE'
                    });
                    var result = await response.json();
                    if (!response.ok || !result.ok) throw new Error(result.error || '删除评论失败');

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

            // ===================== 小猫 AI 自动回复状态轮询 =====================
            window.__catAiPollTimers = window.__catAiPollTimers || {};
            window.__catAiPollStatus = window.__catAiPollStatus || {};
            window.__catAiPollControllers = window.__catAiPollControllers || {};
            window.__catAiCancelledByComment = window.__catAiCancelledByComment || {};

            // Phase 4: 重写为接受 (commentId, reason) 参数，支持按 commentId 精确清理。
            // 不传 commentId 或 commentId 为 null/undefined 时向后兼容：清理所有。
            // 集中清理 timer / AbortController / status DOM / cache，并通过 _catAiCancelled
            // 纪元标志防止正在进行的 fetch 回调在清理后仍写入状态（迟到回调防护）。
            // 替代各处分散的内联清理逻辑，避免遗漏 controller 或 status DOM。
            function cancelCatAiTask(commentId, reason) {
                var isGlobal = (commentId == null);
                var commentIdStr = commentId != null ? String(commentId) : null;
                // 1. 递增取消纪元，让 pollCatAiReply 中正在进行的 fetch 回调检查后跳过
                if (isGlobal) {
                    window._catAiCancelled = (window._catAiCancelled || 0) + 1;
                } else if (commentIdStr) {
                    window.__catAiCancelledByComment[commentIdStr] = (window.__catAiCancelledByComment[commentIdStr] || 0) + 1;
                }
                // 2. 清理轮询 timer
                try {
                    var timers = window.__catAiPollTimers || {};
                    if (isGlobal) {
                        Object.keys(timers).forEach(function(k) { clearTimeout(timers[k]); });
                        window.__catAiPollTimers = {};
                    } else if (timers[commentIdStr]) {
                        clearTimeout(timers[commentIdStr]);
                        delete timers[commentIdStr];
                    }
                } catch(e) {}
                // 3. abort 进行中的 AbortController
                try {
                    var controllers = window.__catAiPollControllers || {};
                    if (isGlobal) {
                        Object.keys(controllers).forEach(function(k) {
                            try { controllers[k].abort(); } catch(err) {}
                        });
                        window.__catAiPollControllers = {};
                    } else if (controllers[commentIdStr]) {
                        try { controllers[commentIdStr].abort(); } catch(err) {}
                        delete controllers[commentIdStr];
                    }
                } catch(e) {}
                // 4. 移除状态元素
                try {
                    if (isGlobal) {
                        var statusEls = document.querySelectorAll('.cat-ai-status');
                        Array.prototype.forEach.call(statusEls, function(el) {
                            if (el && el.parentNode) el.parentNode.removeChild(el);
                        });
                    } else if (commentIdStr) {
                        var statusEl = document.querySelector('.cat-ai-status[data-comment-id="' + commentIdStr + '"]');
                        if (statusEl && statusEl.parentNode) statusEl.parentNode.removeChild(statusEl);
                    }
                } catch(e) {}
                // 5. 清空状态缓存
                try {
                    if (isGlobal) {
                        window.__catAiPollStatus = {};
                    } else if (commentIdStr) {
                        delete window.__catAiPollStatus[commentIdStr];
                    }
                } catch(e) {}
                // 6. 记录取消原因（全局清理时忽略）
                if (!isGlobal && reason) {
                    console.log('[CAT_AI] task cancelled for comment', commentIdStr, 'reason:', reason);
                }
            }

            function pollCatAiReply(commentId, postId, immediate) {
                // 清理旧轮询
                if (window.__catAiPollTimers[commentId]) {
                    clearTimeout(window.__catAiPollTimers[commentId]);
                }
                if (window.__catAiPollControllers[commentId]) {
                    try { window.__catAiPollControllers[commentId].abort(); } catch(e) {}
                    delete window.__catAiPollControllers[commentId];
                }
                var baseInterval = 2000; // 基础间隔2秒
                var retryCount = 0;
                var maxRetries = 5;
                // F1：以“前台活跃耗时”作为超时口径。旧实现只累加单次请求飞行耗时、漏掉了
                // 两次轮询之间的等待间隔，名义 90s 实际可空转十几分钟；现在每轮把“上一轮请求
                // + 等待间隔”一并计入。页面隐藏（后台 setTimeout 被挂起）期间仍不计入，避免切
                // 后台很久回来被立即判超时（保留 pausedAt 机制）。
                var accumulatedRunTime = 0;
                var activeTickStart = Date.now();
                var maxRunTime = 90000; // 前台累计活跃最多 90 秒
                var lastPollStart = 0;
                var pausedAt = 0;
                var notTriggeredCount = 0; // not_triggered 连续计数
                var commentIdStr = String(commentId);
                // A per-comment generation is required here: deleting one
                // comment must invalidate only its in-flight callback. The
                // old global epoch protected logout, but not single-comment
                // cancellation, so a late response could recreate ghost UI.
                window.__catAiCancelledByComment = window.__catAiCancelledByComment || {};
                window.__catAiCancelledByComment[commentIdStr] = (window.__catAiCancelledByComment[commentIdStr] || 0) + 1;
                var myGlobalEpoch = window._catAiCancelled || 0;
                var myCommentEpoch = window.__catAiCancelledByComment[commentIdStr];
                // Phase 3-P0-5: 记录 postId 以供 visibilitychange 恢复轮询使用
                window.__catAiPollStatus[commentIdStr] = { postId: String(postId) };

                // 显示临时状态
                showCatAiStatus(commentIdStr, '小猫正在组织毒液……');

                function poll() {
                    if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                        (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) return;
                    // ★ 页面隐藏时记录暂停时间，不删除任务，不消耗运行时间
                    if (document.hidden) {
                        if (!pausedAt) pausedAt = Date.now();
                        // ★ 修复：先清掉旧 timer 再设新 timer，避免隐藏期间重复进入
                        // 本分支时多个 setTimeout 并存造成双链轮询/定时器堆积
                        if (window.__catAiPollTimers[commentIdStr]) clearTimeout(window.__catAiPollTimers[commentIdStr]);
                        window.__catAiPollTimers[commentIdStr] = setTimeout(poll, 3000);
                        return;
                    }
                    // F1：活跃时间核算
                    var nowTs = Date.now();
                    if (pausedAt) {
                        // 刚从隐藏恢复：丢弃后台挂起区间，重置活跃起点
                        pausedAt = 0;
                        activeTickStart = nowTs;
                    } else {
                        // 前台连续轮询：把上一轮“请求 + 等待间隔”计入活跃耗时
                        accumulatedRunTime += nowTs - activeTickStart;
                    }
                    activeTickStart = nowTs;
                    // 前台累计活跃到点必停，避免超长空转
                    if (accumulatedRunTime > maxRunTime) {
                        showCatAiStatus(commentIdStr, '小猫暂时无法回复，点击重试', true);
                        retryBtnSetup(commentIdStr, postId);
                        delete window.__catAiPollTimers[commentIdStr];
                        delete window.__catAiPollControllers[commentIdStr];
                        return;
                    }
                    // Phase 3-P0-2: 捕获取消纪元，用于迟到回调防护
                    lastPollStart = Date.now();

                    var controller = new AbortController();
                    var timeoutId = setTimeout(function() { controller.abort(); }, 10000);
                    window.__catAiPollControllers[commentIdStr] = controller;

                    window.xtjProtectedFetch('/api/comments/ai-reply-status?comment_id=' + encodeURIComponent(commentIdStr), { signal: controller.signal })
                        .then(function(r) {
                            // Phase 3-P0-2: 迟到回调防护——任务已取消则跳过，避免清理后仍写入状态
                            if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                                (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) { clearTimeout(timeoutId); return null; }
                            // F1：请求耗时在下一轮 poll 开头统一计入 accumulatedRunTime，此处不累加
                            // ★ 先检查 HTTP 状态码，400 不是网络错误
                            if (!r.ok) {
                                return r.json().catch(function() { return {}; }).then(function(payload) {
                                    if (r.status === 400 && (payload.code === 'invalid_comment_id')) {
                                        clearTimeout(timeoutId); // F5：终态分支同步清掉 abort 定时器，避免冗余 abort
                                        console.error('[CatAI] invalid comment_id:', commentIdStr);
                                        showCatAiStatus(commentIdStr, '评论ID格式错误，请刷新页面重试', true);
                                        delete window.__catAiPollTimers[commentIdStr];
                                        delete window.__catAiPollControllers[commentIdStr];
                                        return;
                                    }
                                    throw new Error('http_error_' + r.status);
                                });
                            }
                            return r.json();
                        })
                        .then(function(data) {
                            if (!data) return;
                            // Phase 3-P0-2: 迟到回调防护——任务已取消则跳过
                            if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                                (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) { return; }
                            clearTimeout(timeoutId);
                            retryCount = 0; // 成功请求后重置重试计数
                            if (data.status === 'completed') {
                                // ★ 严格验证：必须包含完整字段，使用 String() 比较
                                var aiComment = data.data;
                                if (aiComment && aiComment.id && typeof aiComment.content === 'string' && aiComment.content.trim() && aiComment.user_name === 'cat_ai' && aiComment.generated_by_ai && String(aiComment.parent_comment_id) === commentIdStr) {
                                    removeCatAiStatus(commentIdStr);
                                    delete window.__catAiPollTimers[commentIdStr];
                                    delete window.__catAiPollControllers[commentIdStr];
                                    // 通过统一 upsert 函数插入
                                    upsertAiComment(aiComment, commentIdStr, postId);
                                } else {
                                    // 数据不完整，回退到全量刷新
                                    if (typeof loadFeed === 'function') loadFeed(true).catch(function() {});
                                    window.__catAiPollTimers[commentIdStr] = setTimeout(poll, baseInterval);
                                }
                            } else if (data.status === 'not_triggered') {
                                // F4：not_triggered 视为“任务尚未同步”，继续轮询。
                                // 旧实现 commentAge 为 NaN（后端缺字段/弱网）时比较恒 false 会过早判失败，
                                // 这里对未知年龄兜底继续轮询，并把同步窗口由 10s 放宽到 15s、次数到 8 次。
                                notTriggeredCount++;
                                var commentAge = 0;
                                var catAgeKnown = true;
                                try {
                                    var catCreatedTs = data.comment_created_at ? new Date(data.comment_created_at).getTime() : NaN;
                                    catAgeKnown = !isNaN(catCreatedTs);
                                    commentAge = catAgeKnown ? Date.now() - catCreatedTs : 0;
                                } catch(e) { catAgeKnown = false; }
                                if (notTriggeredCount <= 8 && (catAgeKnown === false || commentAge < 15000)) {
                                    showCatAiStatus(commentIdStr, '小猫正在准备回复……');
                                    window.__catAiPollTimers[commentIdStr] = setTimeout(poll, 1500);
                                } else {
                                    showCatAiStatus(commentIdStr, '未能创建回复任务，点击重试', true);
                                    retryBtnSetup(commentIdStr, postId);
                                    delete window.__catAiPollTimers[commentIdStr];
                                    delete window.__catAiPollControllers[commentIdStr];
                                }
                            } else if (data.status === 'rate_limited') {
                                showCatAiStatus(commentIdStr, data.message || '小猫今天被叫得有点烦，稍后再试', true);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'failed') {
                                showCatAiStatus(commentIdStr, '小猫暂时不想说话', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'blocked') {
                                // B2：安全拦截不再静默移除——展示后端温和文案并在 3s 后淡出，停止轮询
                                showCatAiStatus(commentIdStr, data.message || '这个问题小猫不方便接话，换个问法试试', true);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'reply_deleted' || data.status === 'reply_missing') {
                                // Phase 4: 回复被删除或缺失 → 显示重试按钮
                                showCatAiStatus(commentIdStr, data.message || '小猫的回复异常，点击重试', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'repair_required') {
                                // Phase 4: 需要修复 → 显示重试按钮
                                showCatAiStatus(commentIdStr, data.message || '回复记录异常，点击重试', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            } else if (data.status === 'processing' || data.status === 'pending') {
                                // F2：每次 processing/pending 都维持进行中提示。旧实现仅在含“同步”时才
                                // show，期间一次普通评论触发的全量重绘会把状态气泡冲掉且不再出现，看起来像卡死。
                                // showCatAiStatus 对已存在节点只更新文本，不会重复创建。
                                if (data.message && data.message.includes('同步')) {
                                    showCatAiStatus(commentIdStr, '回复已生成，正在同步……');
                                } else {
                                    showCatAiStatus(commentIdStr, '小猫正在组织毒液……');
                                }
                                window.__catAiPollTimers[commentIdStr] = setTimeout(poll, baseInterval);
                            } else {
                                removeCatAiStatus(commentIdStr);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            }
                        })
                        .catch(function(err) {
                            clearTimeout(timeoutId);
                            // Phase 3-P0-2: 迟到回调防护——任务已取消则跳过，避免清理后重新调度轮询
                            if ((window._catAiCancelled || 0) !== myGlobalEpoch ||
                                (window.__catAiCancelledByComment[commentIdStr] || 0) !== myCommentEpoch) { return; }
                            // F1：请求与退避等待耗时在下一轮 poll 开头统一计入 accumulatedRunTime
                            // 指数退避重试，而不是永久终止
                            if (retryCount < maxRetries) {
                                retryCount++;
                                var backoff = Math.min(baseInterval * Math.pow(2, retryCount), 30000);
                                window.__catAiPollTimers[commentIdStr] = setTimeout(poll, backoff);
                            } else {
                                showCatAiStatus(commentIdStr, '小猫暂时无法回复，点击重试', true);
                                retryBtnSetup(commentIdStr, postId);
                                delete window.__catAiPollTimers[commentIdStr];
                                delete window.__catAiPollControllers[commentIdStr];
                            }
                        });
                }
                // F3：immediate=true（页面从隐藏恢复）时立即首查，不再固定等 2s
                window.__catAiPollTimers[commentIdStr] = setTimeout(poll, immediate ? 0 : baseInterval);
            }

            // ★ 显示重试按钮
            function retryBtnSetup(commentId, postId) {
                var statusEl = document.querySelector('.cat-ai-status[data-comment-id="' + commentId + '"]');
                if (statusEl) {
                    statusEl.innerHTML = '小猫暂时无法回复 <button type="button" class="cat-ai-retry-btn" onclick="window.__xtjRetryCatAi(\'' + safeJsStr(commentId) + '\', \'' + safeJsStr(postId) + '\')">重试</button>';
                }
            }
            window.__xtjRetryCatAi = async function(commentId, postId) {
                var commentIdStr = String(commentId);
                // ★ 修复：状态元素由 showCatAiStatus 创建，类名为 cat-ai-status + data-comment-id，
                // 不存在 id="cat-ai-status-<id>" 的元素，改用 querySelector 定位。
                var statusEl = document.querySelector('.cat-ai-status[data-comment-id="' + commentIdStr + '"]');
                if (statusEl) statusEl.innerHTML = '小猫正在恢复……';
                try {
                    var resp = await window.xtjProtectedFetch('/api/comments/ai-reply-retry', {
                        method: 'POST',
                        body: JSON.stringify({ comment_id: commentIdStr })
                    });
                    var payload = await resp.json().catch(function() { return {}; });
                    if (!resp.ok) {
                        var errMsg = payload.message || payload.error || '重试失败';
                        showCatAiStatus(commentIdStr, errMsg, true);
                        return;
                    }
                    if (payload.status === 'completed') {
                        var aiComment = payload.data || payload;
                        if (aiComment && aiComment.id) {
                            upsertAiComment(aiComment, commentIdStr, postId);
                            removeCatAiStatus(commentIdStr);
                            return;
                        }
                    }
                    if (payload.status === 'rate_limited') {
                        showCatAiStatus(commentIdStr, payload.message || '调用过于频繁，请稍后再试', true);
                        return;
                    }
                    // pending/processing - 开始轮询
                    removeCatAiStatus(commentIdStr);
                    pollCatAiReply(commentIdStr, postId);
                } catch (e) {
                    console.error('[CatAI] retry failed:', e);
                    showCatAiStatus(commentIdStr, '重试失败，请检查网络后重试', true);
                }
            };

            // ★ 统一 AI 评论插入函数（polling 和 Realtime 共用）
            function upsertAiComment(aiComment, sourceCommentId, postId) {
                if (!aiComment || !aiComment.id || !aiComment.content || !aiComment.content.trim()) return;
                // Realtime and polling must accept exactly the same AI reply
                // shape; a generated comment from another post must not be
                // rendered under the current source comment.
                if (aiComment.generated_by_ai !== true || String(aiComment.user_name || '') !== 'cat_ai') return;
                var aiIdStr = String(aiComment.id);
                var srcIdStr = String(sourceCommentId);
                if (String(aiComment.parent_comment_id || '') !== srcIdStr) return;
                if (postId != null && aiComment.post_id != null && String(aiComment.post_id) !== String(postId)) return;
                // 去重：检查 feedAllComments 和 DOM
                var existingInFeed = (feedAllComments || []).some(function(item) {
                    return item && item.id != null && String(item.id) === aiIdStr;
                });
                var existingInDom = document.querySelector('.comment-item[data-comment-id="' + aiIdStr + '"]');
                if (existingInFeed && existingInDom) return; // 已存在，跳过
                // 加入 feedAllComments
                feedAllComments = (feedAllComments || []).filter(function(item) {
                    return !(item && item.id != null && String(item.id) === aiIdStr);
                });
                feedAllComments.push(aiComment);
                // Phase 3-P0-3: 修复缓存写入顺序——先插入 DOM，成功后再写缓存。
                // 原代码在 DOM 插入前写缓存，若 insertCatAiCommentIntoDOM 返回
                // source_comment_missing，AI 回复已写入缓存却不在 DOM，产生孤儿缓存。
                // 插入 DOM，返回结果
                var result = insertCatAiCommentIntoDOM(aiComment, srcIdStr, postId);
                if (!result.inserted) {
                    // ★ 插入失败：定向重渲染对应帖子
                    if (result.reason === 'source_comment_missing') {
                        try {
                            // 尝试对对应 postId 执行一次定向帖子重渲染
                            var postEl = document.querySelector('.post[data-post-id="' + String(postId) + '"]');
                            if (postEl && typeof renderPostCardSafely === 'function') {
                                // 查找该帖子的评论数据
                                var postComms = (feedAllComments || []).filter(function(c) {
                                    return String(c.post_id) === String(postId);
                                });
                                var maps = buildPostMaps([], postComms);
                                var template = document.createElement('template');
                                template.innerHTML = renderPostCardSafely({ id: postId }, maps.commentMap, maps.likeMap, maps.likeUserMap);
                                var newPost = template.content.firstElementChild;
                                if (newPost && postEl.parentNode) {
                                    postEl.parentNode.replaceChild(newPost, postEl);
                                }
                            }
                            // 重渲染后再次确认
                            var confirmExisting = document.querySelector('.comment-item[data-comment-id="' + aiIdStr + '"]');
                            if (!confirmExisting) {
                                console.warn('[CatAI] upsert retry failed for comment:', aiIdStr);
                            }
                        } catch (e) {
                            console.warn('[CatAI] upsert re-render failed:', e);
                        }
                        // Phase 3-P0-3: source_comment_missing 时不写入缓存，避免孤儿缓存
                    }
                } else {
                    // Phase 3-P0-3: DOM 插入成功后再写缓存，保证缓存与 DOM 一致
                    try { writeFeedCacheSnapshot(); } catch(e) {}
                }
                // 同步评论数量
                if (typeof syncPostCommentCount === 'function') syncPostCommentCount(postId);
                // 更新个人活动
                if (typeof renderProfileActivity === 'function') renderProfileActivity();
            }

            // ★ 直接将 AI 回复插入 DOM（正确层级：源评论的 .comment-replies 容器内）
            function insertCatAiCommentIntoDOM(aiComment, sourceCommentId, postId) {
                if (!aiComment || !aiComment.id) return { inserted: false, reason: 'invalid_data' };
                var aiIdStr = String(aiComment.id);
                var srcIdStr = String(sourceCommentId);
                var sourceEl = document.querySelector('.comment-item[data-comment-id="' + srcIdStr + '"]');
                if (!sourceEl) return { inserted: false, reason: 'source_comment_missing' };
                // 移除旧状态
                removeCatAiStatus(srcIdStr);
                // 检查是否已存在
                var existing = document.querySelector('.comment-item[data-comment-id="' + aiIdStr + '"]');
                if (existing) return { inserted: false, reason: 'already_exists' };
                // ★ 查找或创建 .comment-replies 容器
                var repliesContainer = sourceEl.querySelector('.comment-replies');
                if (!repliesContainer) {
                    repliesContainer = document.createElement('div');
                    repliesContainer.className = 'comment-replies';
                    sourceEl.appendChild(repliesContainer);
                }
                // 创建 AI 评论 DOM（与 renderCatAiComment 渲染结构一致）
                var aiEl = document.createElement('div');
                aiEl.className = 'comment-item cat-ai-comment';
                aiEl.setAttribute('data-comment-id', aiIdStr);
                aiEl.setAttribute('data-parent-comment-id', srcIdStr);
                var timeStr = (typeof formatRelativeTime === 'function' ? formatRelativeTime(aiComment.created_at) : (aiComment.created_at || '刚刚'));
                var delBtn = isAdmin() ? '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(aiIdStr) + '\', this)">删除</button>' : '';
                aiEl.innerHTML = '<div class="comment-item-inner">' +
                    '<span class="cat-ai-avatar" aria-label="小猫">🐱</span>' +
                    '<div class="comment-item-body">' +
                    '<div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">' + escapeHtml(timeStr) + '</span>' + delBtn + '</div>' +
                    '<div class="comment-item-content">' + escapeHtml(aiComment.content || '') + '</div>' +
                    '</div></div>';
                // ★ 追加到 .comment-replies 容器内，而非源评论的兄弟节点
                repliesContainer.appendChild(aiEl);
                return { inserted: true, reason: 'ok' };
            }

            function showCatAiStatus(commentId, message, fadeOut) {
                // Phase 3-P0-4: 当状态包含"重试"文字时不自动 fadeOut。
                // retryBtnSetup 会在该元素内插入重试按钮，原逻辑 3 秒后移除整个元素导致
                // 重试按钮不可用。包含"重试"时保持元素常驻，直到用户操作或新状态覆盖。
                if (fadeOut && typeof message === 'string' && message.indexOf('重试') !== -1) {
                    fadeOut = false;
                }
                // Phase 3-P0-5: retryable 状态持久化到 localStorage，避免评论重渲染后丢失。
                // 仅对带"重试"的状态持久化（真正的 retryable 状态）。
                if (typeof message === 'string' && message.indexOf('重试') !== -1) {
                    try {
                        var postId = (window.__catAiPollStatus && window.__catAiPollStatus[String(commentId)])
                            ? window.__catAiPollStatus[String(commentId)].postId : null;
                        var retryableEntry = { message: message, postId: postId, ts: Date.now() };
                        localStorage.setItem('xtj_cat_ai_retryable_' + String(commentId), JSON.stringify(retryableEntry));
                    } catch(e) {}
                }
                var existing = document.querySelector('.cat-ai-status[data-comment-id="' + commentId + '"]');
                if (existing) {
                    existing.textContent = message;
                    if (fadeOut) {
                        existing.classList.add('cat-ai-fade-out');
                        setTimeout(function() { if (existing.parentNode) existing.parentNode.removeChild(existing); }, 3000);
                    }
                    return;
                }
                var commentEl = document.querySelector('.comment-item[data-comment-id="' + commentId + '"]');
                if (!commentEl) return;
                var statusEl = document.createElement('div');
                statusEl.className = 'cat-ai-status';
                statusEl.setAttribute('data-comment-id', commentId);
                statusEl.textContent = message;
                statusEl.style.cssText = 'font-size:12px;color:var(--text-muted);padding:4px 0 4px 8px;font-style:italic;margin-left:36px;animation:catAiPulse 1.5s ease-in-out infinite;';
                if (fadeOut) {
                    statusEl.classList.add('cat-ai-fade-out');
                    setTimeout(function() { if (statusEl.parentNode) statusEl.parentNode.removeChild(statusEl); }, 3000);
                }
                commentEl.parentNode.insertBefore(statusEl, commentEl.nextSibling);
            }

            function removeCatAiStatus(commentId) {
                var el = document.querySelector('.cat-ai-status[data-comment-id="' + commentId + '"]');
                if (el && el.parentNode) el.parentNode.removeChild(el);
                // Phase 3-P0-5: 状态被显式移除（completed/blocked）时也清除 retryable 缓存。
                try { localStorage.removeItem('xtj_cat_ai_retryable_' + String(commentId)); } catch(e) {}
            }

            // Phase 3-P0-5: 恢复持久化的 retryable 状态。
            // 在评论重新渲染后调用，遍历 DOM 中的评论项，对仍有持久化 retryable 状态的
            // 评论重新显示重试按钮。超过 1 小时的 retryable 状态视为过期并清除。
            function restoreCatAiRetryableStatuses() {
                var toRestore = [];
                var now = Date.now();
                var keysToRemove = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (!key || key.indexOf('xtj_cat_ai_retryable_') !== 0) continue;
                    var commentId = key.substring('xtj_cat_ai_retryable_'.length);
                    try {
                        var entry = JSON.parse(localStorage.getItem(key) || '{}');
                        if (!entry.ts || (now - entry.ts) > 60 * 60 * 1000) {
                            keysToRemove.push(key);
                            continue;
                        }
                        toRestore.push({ commentId: commentId, message: entry.message, postId: entry.postId });
                    } catch(e) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(function(k) { try { localStorage.removeItem(k); } catch(e) {} });
                toRestore.forEach(function(item) {
                    var commentEl = document.querySelector('.comment-item[data-comment-id="' + item.commentId + '"]');
                    if (!commentEl) return;
                    var existingStatus = document.querySelector('.cat-ai-status[data-comment-id="' + item.commentId + '"]');
                    if (existingStatus) return; // 状态已存在，不重复
                    // 重新显示 retryable 状态和重试按钮
                    var statusEl = document.createElement('div');
                    statusEl.className = 'cat-ai-status';
                    statusEl.setAttribute('data-comment-id', item.commentId);
                    statusEl.textContent = item.message || '小猫暂时无法回复，点击重试';
                    statusEl.style.cssText = 'font-size:12px;color:var(--text-muted);padding:4px 0 4px 8px;font-style:italic;margin-left:36px;';
                    commentEl.parentNode.insertBefore(statusEl, commentEl.nextSibling);
                    if (item.postId) {
                        retryBtnSetup(item.commentId, item.postId);
                    }
                });
            }
            window.__xtjRestoreCatAiRetryable = restoreCatAiRetryableStatuses;

            // ===================== 小猫 AI 评论渲染 =====================
            function renderCatAiComment(comment) {
                if (!comment || comment.user_name !== 'cat_ai' || !comment.generated_by_ai) return '';
                var avatarHtml = '<span class="cat-ai-avatar" aria-label="小猫">🐱</span>';
                var badgeHtml = '<span class="cat-ai-badge">AI</span>';
                var timeStr = (typeof formatRelativeTime === 'function' ? formatRelativeTime(comment.created_at) : (comment.created_at || '刚刚'));
                var delBtn = isAdmin() ? '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(comment.id) + '\', this)">删除</button>' : '';
                return '<div class="comment-item cat-ai-comment" data-comment-id="' + escapeHtml(comment.id) + '" data-parent-comment-id="' + escapeHtml(comment.parent_comment_id || '') + '"><div class="comment-item-inner">' + avatarHtml + '<div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b>' + badgeHtml + '<span class="comment-item-time">' + escapeHtml(timeStr) + '</span>' + delBtn + '</div><div class="comment-item-content">' + escapeHtml(comment.content || '') + '</div></div></div></div>';
            }

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
                    try { subscribeToComments(); } catch(_) {}
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

                // 缺失关键元素时不崩溃：仅做必要的登录态兜底
                if (!unauthUI || !authUI || !annBtnWrapper) {
                    if (currentUser) {
                        queueDeferredStartupTasks();
                    } else {
                        __xtjDeferredWarmupQueued = false;
                        stopRestrictionPolling();
                        hideBlockedScreen();
                        hideMuteIndicator();
                    }
                    return;
                }
                
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
                    
                    // 更新我的页面显示
                    profileName.textContent = currentUser;
                    profileStatus.textContent = "查看资料";
                    
                    // 显示发布框
                    if (publishBox) publishBox.style.display = "block";
                    
                    // 加载头像
                    loadUserAvatar();
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
                    
                    // 更新"我的"页面显示（未登录状态）
                    profileName.textContent = "未登录";
                    profileStatus.textContent = "点击登录";
                    
                    // 隐藏发布区域
                    if (publishBox) publishBox.style.display = "none";
                    
                    // 更新头像显示
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
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[currentUser] && cachedAvatars[currentUser].url) {
                        avatarCache[currentUser] = cachedAvatars[currentUser];
                        updateAllAvatarElements(cachedAvatars[currentUser].url);
                    } else {
                        // localStorage 无缓存：远程获取头像
                        var avatarUrl = await fetchAvatarUrl(currentUser);
                        if (avatarUrl) {
                            setAvatarCacheEntry(currentUser, 'has_avatar', avatarUrl);
                            try {
                                cachedAvatars[currentUser] = { state: 'has_avatar', url: avatarUrl, fetched_at: Date.now() };
                                writeAvatarCacheToStorage(cachedAvatars);
                            } catch(e) {}
                            updateAllAvatarElements(avatarUrl);
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
                btn.textContent = liked ? '❤️' : '🤍';
                btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
            }

            function persistFeedLikesCache() {
                try {
                    var raw = window.safeStorage.get(CACHE_KEY);
                    if (!raw) return;
                    var parsed = JSON.parse(raw);
                    if (!parsed || typeof parsed !== 'object') return;
                    if (!parsed.data || typeof parsed.data !== 'object') parsed.data = {};
                    parsed.data.likes = Array.isArray(feedAllLikes) ? feedAllLikes : [];
                    parsed.timestamp = Date.now();
                    window.safeStorage.set(CACHE_KEY, JSON.stringify(parsed));
                } catch (e) {}
            }

            function updateLikeStatsText(statsEl, liked) {
                if (!statsEl) return;
                var text = statsEl.textContent || '';
                var match = text.match(/(?:点赞|❤)\s*(\d+)/);
                if (!match) return;
                var current = parseInt(match[1], 10) || 0;
                var next = liked ? current + 1 : Math.max(0, current - 1);
                statsEl.textContent = text.replace(/(点赞|❤)\s*\d+/, '$1 ' + next);
            }

            function updatePostLikeCount(postId, likeCount) {
                var count = Number(likeCount);
                if (!Number.isFinite(count) || count < 0) return;
                var pid = String(postId || '');
                document.querySelectorAll('.post[data-post-id]').forEach(function(postEl) {
                    if (String(postEl.getAttribute('data-post-id') || '') !== pid) return;
                    var statsEl = postEl.querySelector('.post-stats-text');
                    if (!statsEl) return;
                    statsEl.textContent = (statsEl.textContent || '').replace(/(点赞|❤)\s*\d+/, '$1 ' + count);
                });
            }

            function getPostLikeButtons(postId) {
                var pid = String(postId || '');
                var buttons = [];
                document.querySelectorAll('.post[data-post-id]').forEach(function(postEl) {
                    if (String(postEl.getAttribute('data-post-id') || '') !== pid) return;
                    var likeBtn = postEl.querySelector('.actions .like-btn') || postEl.querySelector('.actions .action-btn');
                    if (likeBtn) buttons.push(likeBtn);
                });
                return buttons;
            }

            function setPostLikePending(postId, pending) {
                getPostLikeButtons(postId).forEach(function(likeBtn) {
                    // Keep the control available so rapid toggles feel immediate while the latest intent syncs.
                    likeBtn.disabled = false;
                    if (pending) likeBtn.setAttribute('aria-busy', 'true');
                    else likeBtn.removeAttribute('aria-busy');
                    if (pending) likeBtn.dataset.likePending = '1';
                    else delete likeBtn.dataset.likePending;
                });
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
                    var likeBtn = postEl.querySelector('.actions .like-btn') || postEl.querySelector('.actions .action-btn');
                    var statsEl = postEl.querySelector('.post-stats-text');
                    var stateChanged = !!likeBtn && likeBtn.classList.contains('liked') !== !!liked;
                    setLikeButtonState(likeBtn, liked);
                    if (stateChanged) updateLikeStatsText(statsEl, liked);
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

            var likeOperations = Object.create(null);

            function applyPostLikeIntent(postId, liked, sourceButton) {
                updatePostLikeUi(postId, liked, { post_id: postId, user_name: currentUser, actor_key: deviceId });
                updateFeedStats();
                if (liked && sourceButton) createLikeBlossom(sourceButton);
            }

            function flushPostLikeOperation(postId, operation) {
                if (likeOperations[postId] !== operation) return Promise.resolve();
                var requestedLiked = operation.desired;
                operation.running = true;
                operation.requested = requestedLiked;
                var normalizedPostId = postId.trim().toLowerCase();
                return window.xtjProtectedFetch('/api/post/like', {
                    method: 'POST',
                    body: JSON.stringify({ post_id: normalizedPostId, liked: requestedLiked })
                }).then(function(likeResponse) {
                    return likeResponse.json().catch(function() { return {}; }).then(function(likeResult) {
                        if (!likeResponse.ok || !likeResult.ok || !!likeResult.liked !== requestedLiked) {
                            throw new Error(likeResult.error || 'like_state_sync_failed');
                        }
                        operation.confirmed = requestedLiked;
                        updatePostLikeCount(postId, likeResult.like_count);
                        touchUserSession(false);
                        scheduleLikeStatRefresh();
                        if (currentDockTab === 'profile' && typeof loadProfileActivity === 'function') loadProfileActivity(true);
                        try { if (typeof window.queueBehavior === 'function') window.queueBehavior(requestedLiked ? 'post_like' : 'post_unlike', 'post ' + postId.slice(0, 8)); } catch(e) {}
                        if (operation.desired !== operation.confirmed) return flushPostLikeOperation(postId, operation);
                    });
                }).catch(function(error) {
                    console.error(error);
                    if (likeOperations[postId] !== operation) return;
                    if (operation.desired !== operation.confirmed) {
                        applyPostLikeIntent(postId, operation.confirmed);
                        showToast("点赞失败，请重试");
                    }
                }).finally(function() {
                    // ★ 修复：无条件复位 running——此前仅当 desired===confirmed 时才删除条目，
                    // 若"请求在途时再点取消 → 第一次成功触发 re-flush → 第二次失败"，条目会永久
                    // 残留在 running=true 状态，此后 toggleLike 不再发起任何请求，点赞态与服务器
                    // 永久失同步（P1）。现在 running 始终复位：状态未同步时下次点击可重新 flush。
                    operation.running = false;
                    setPostLikePending(postId, false);
                    if (likeOperations[postId] === operation && operation.desired === operation.confirmed) {
                        delete likeOperations[postId];
                    }
                });
            }

            window.toggleLike = function (btn, postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法点赞"); return; }
                var pid = String(postId || '');
                if (!btn || !pid) return;
                var normalizedPostId = pid.trim().toLowerCase();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedPostId)) {
                    showToast("帖子参数无效");
                    return;
                }
                var operation = likeOperations[pid];
                var visibleButton = getPostLikeButtons(pid)[0] || btn;
                var currentLiked = operation ? operation.desired : visibleButton.classList.contains('liked');
                var nextLiked = !currentLiked;
                if (!operation) {
                    operation = { confirmed: currentLiked, desired: currentLiked, running: false, promise: null };
                    likeOperations[pid] = operation;
                }
                operation.desired = nextLiked;
                setPostLikePending(pid, true);
                applyPostLikeIntent(pid, nextLiked, btn);
                if (!operation.running) operation.promise = flushPostLikeOperation(pid, operation);
                return operation.promise;
            };

            var likeBlossomSequence = 0;

            function createLikeBlossom(btn) {
                var perfProfile = window.__xtjPerfProfile || 'full';
                if (perfProfile === 'lite') return;
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                var layer = btn.closest ? btn.closest('.actions') : btn.parentElement;
                if (!layer) return;

                var existing = btn._likeBlossom;
                if (existing) {
                    if (existing.timer) clearTimeout(existing.timer);
                    if (existing.node && existing.node.parentNode) existing.node.remove();
                }

                var buttonRect = btn.getBoundingClientRect();
                var layerRect = layer.getBoundingClientRect();
                var blossom = document.createElement('span');
                var gradientId = 'xtj-like-blossom-gradient-' + (++likeBlossomSequence);
                blossom.className = 'like-blossom';
                blossom.setAttribute('aria-hidden', 'true');
                blossom.style.left = (buttonRect.left - layerRect.left + buttonRect.width / 2) + 'px';
                blossom.style.top = (buttonRect.top - layerRect.top + buttonRect.height / 2) + 'px';
                blossom.innerHTML = '<svg viewBox="0 0 100 100" focusable="false"><defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe8f0"/><stop offset=".62" stop-color="#ffb4c8"/><stop offset="1" stop-color="#ff91ad"/></linearGradient></defs><g transform="translate(50 50)"><g transform="rotate(0)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(72)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(144)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(216)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(288)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><circle cx="0" cy="0" r="7.5" fill="#ffd96b"/><circle cx="-2" cy="-1" r="2.2" fill="#fff2ad"/></g></svg>';
                btn.classList.add('like-bloom-origin');
                layer.appendChild(blossom);

                var cleanup = function() {
                    if (btn._likeBlossom && btn._likeBlossom.node === blossom) btn._likeBlossom = null;
                    if (blossom.parentNode) blossom.remove();
                };
                blossom.addEventListener('animationend', cleanup, { once: true });
                btn._likeBlossom = {
                    node: blossom,
                    timer: setTimeout(cleanup, perfProfile === 'balanced' ? 620 : 820)
                };
            }

            // ===================== 帖子操作弹窗 =====================
            const POST_ACTION_MODAL_IDS = ['commentModal', 'delModal'];

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
                
                var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                if (!postEl) return;
                
                // 如果已经存在，则收起（切换显示状态）
                var existingBox = postEl.querySelector('.inline-comment-box');
                if (existingBox) {
                    existingBox.style.gridTemplateRows = '0fr';
                    existingBox.style.opacity = '0';
                    existingBox.style.marginTop = '0px';
                    setTimeout(() => existingBox.remove(), 300);
                    return;
                }
                
                // 移除其他帖子下可能打开的内联输入框，保持界面整洁
                document.querySelectorAll('.inline-comment-box').forEach(function(el) {
                    el.style.gridTemplateRows = '0fr';
                    el.style.opacity = '0';
                    el.style.marginTop = '0px';
                    setTimeout(() => el.remove(), 300);
                });
                
                // 创建内联评论框容器 (带动画)
                var box = document.createElement('div');
                box.className = 'inline-comment-box';
                box.style.display = 'grid';
                box.style.gridTemplateRows = '0fr';
                box.style.opacity = '0';
                box.style.marginTop = '0px';
                box.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                box.style.background = 'transparent'; // 修复底色不统一的问题
                box.style.borderBottomLeftRadius = '16px';
                box.style.borderBottomRightRadius = '16px';
                
                var gridInner = document.createElement('div');
                gridInner.style.overflow = 'hidden';
                
                var innerWrap = document.createElement('div');
                innerWrap.style.padding = '0px 16px 16px 16px'; // 取消上边距和线，让它自然融入 actions 之下
                innerWrap.style.display = 'flex';
                innerWrap.style.gap = '8px';
                innerWrap.style.alignItems = 'center';
                
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'inline-comment-inp';
                inp.placeholder = '写下你的想法...';
                inp.style.flex = '1';
                inp.style.padding = '8px 12px';
                inp.style.border = '1px solid var(--border)';
                inp.style.borderRadius = '20px';
                inp.style.background = 'var(--bg-secondary)';
                inp.style.outline = 'none';
                inp.style.fontSize = '14px';
                
                // ★ @ mention autocomplete
                var mentionDropdown = null;
                var mentionActiveIndex = 0;
                function closeMentionDropdown() {
                    if (mentionDropdown && mentionDropdown.parentNode) {
                        mentionDropdown.parentNode.removeChild(mentionDropdown);
                    }
                    mentionDropdown = null;
                    mentionActiveIndex = 0;
                }
                function insertMentionAtCursor(inp, mentionText) {
                    var start = inp.selectionStart || 0;
                    var text = inp.value;
                    // 找到光标前最近的 @ 位置
                    var atPos = -1;
                    for (var i = start - 1; i >= 0; i--) {
                        if (text[i] === '@' || text[i] === '＠') {
                            // 检查 @ 是否在开头、空格后或换行后
                            if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n' || text[i - 1] === '\r') {
                                atPos = i;
                                break;
                            }
                        }
                    }
                    if (atPos >= 0) {
                        var before = text.slice(0, atPos);
                        var after = text.slice(start);
                        inp.value = before + mentionText + after;
                        var newCursor = atPos + mentionText.length;
                        inp.setSelectionRange(newCursor, newCursor);
                    }
                    closeMentionDropdown();
                    inp.focus();
                }
                function showMentionDropdown(inp) {
                    var start = inp.selectionStart || 0;
                    var text = inp.value;
                    // 查找光标前最近的 @
                    var atPos = -1;
                    for (var i = start - 1; i >= 0; i--) {
                        if (text[i] === '@' || text[i] === '＠') {
                            if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n' || text[i - 1] === '\r') {
                                atPos = i;
                                break;
                            }
                        }
                    }
                    if (atPos < 0) { closeMentionDropdown(); return; }
                    // 检查 @ 后面是否已经有非空内容（排除空格）
                    var afterAt = text.slice(atPos + 1, start);
                    if (afterAt.length > 0 && !/^\s*$/.test(afterAt)) {
                        // 用户已经开始输入了，检查是否匹配"小猫"的前缀
                        if (!'小猫'.startsWith(afterAt) && !'小猫'.includes(afterAt)) {
                            closeMentionDropdown(); return;
                        }
                    }
                    closeMentionDropdown();
                    mentionDropdown = document.createElement('div');
                    mentionDropdown.className = 'mention-dropdown';
                    mentionDropdown.setAttribute('role', 'listbox');
                    mentionDropdown.setAttribute('aria-label', '提及候选');
                    mentionDropdown.innerHTML = 
                        '<div class="mention-item mention-active" role="option" aria-selected="true" id="mention-cat-ai" data-insert="@小猫 ">' +
                        '<span class="mention-avatar">🐱</span>' +
                        '<span class="mention-name">小猫</span>' +
                        '<span class="mention-badge">AI</span>' +
                        '<span class="mention-desc">犀利毒舌回复</span>' +
                        '</div>';
                    mentionActiveIndex = 0;
                    // 定位在输入框下方
                    var rect = inp.getBoundingClientRect();
                    mentionDropdown.style.position = 'fixed';
                    mentionDropdown.style.left = rect.left + 'px';
                    mentionDropdown.style.top = (rect.bottom + 4) + 'px';
                    mentionDropdown.style.minWidth = rect.width + 'px';
                    mentionDropdown.style.zIndex = '99999';
                    document.body.appendChild(mentionDropdown);
                    // 点击选中
                    mentionDropdown.addEventListener('click', function(e) {
                        var item = e.target.closest('.mention-item');
                        if (item) {
                            insertMentionAtCursor(inp, item.getAttribute('data-insert'));
                        }
                    });
                    // 触摸支持
                    mentionDropdown.addEventListener('touchend', function(e) {
                        var item = e.target.closest('.mention-item');
                        if (item) {
                            insertMentionAtCursor(inp, item.getAttribute('data-insert'));
                        }
                    });
                    // 设置 aria-expanded
                    inp.setAttribute('aria-expanded', 'true');
                    inp.setAttribute('role', 'combobox');
                    inp.setAttribute('aria-activedescendant', 'mention-cat-ai');
                }
                function updateMentionActive(delta) {
                    if (!mentionDropdown) return;
                    var items = mentionDropdown.querySelectorAll('.mention-item');
                    if (!items.length) return;
                    items[mentionActiveIndex].classList.remove('mention-active');
                    items[mentionActiveIndex].setAttribute('aria-selected', 'false');
                    mentionActiveIndex = (mentionActiveIndex + delta + items.length) % items.length;
                    items[mentionActiveIndex].classList.add('mention-active');
                    items[mentionActiveIndex].setAttribute('aria-selected', 'true');
                    inp.setAttribute('aria-activedescendant', items[mentionActiveIndex].id || '');
                }
                inp.addEventListener('input', function() {
                    showMentionDropdown(inp);
                });
                inp.addEventListener('keydown', function(e) {
                    // ★ 统一 keydown 处理器：mention dropdown 优先
                    if (mentionDropdown) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); updateMentionActive(1); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); updateMentionActive(-1); return; }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            var items = mentionDropdown.querySelectorAll('.mention-item');
                            if (items[mentionActiveIndex]) {
                                insertMentionAtCursor(inp, items[mentionActiveIndex].getAttribute('data-insert'));
                            }
                            return;
                        }
                        if (e.key === 'Escape') { e.preventDefault(); closeMentionDropdown(); return; }
                    }
                    // ★ 没有 mention dropdown 时，Enter 发送评论
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        btn.click();
                    }
                });
                inp.addEventListener('click', function() {
                    showMentionDropdown(inp);
                });
                // 全局关闭（使用命名函数，注释框销毁时移除）
                var _mentionGlobalClick = function(e) {
                    if (mentionDropdown && e.target !== inp && !mentionDropdown.contains(e.target)) {
                        closeMentionDropdown();
                    }
                };
                document.addEventListener('click', _mentionGlobalClick, true);
                // ★ 修复：监听器泄漏。feed 重渲染会直接替换 #feed.innerHTML，正在
                // 展开的 .inline-comment-box 被整体丢弃，不会触发 box.remove()，导致
                // document 级 capture 点击监听反复累积。这里把清理函数登记到全局
                // 注册表，渲染 feed 前统一执行（见 renderFeed* 入口）。
                window.__xtjMentionCleanups = window.__xtjMentionCleanups || [];
                var _mentionCleanup = function() {
                    document.removeEventListener('click', _mentionGlobalClick, true);
                };
                window.__xtjMentionCleanups.push(_mentionCleanup);
                if (!window.__xtjRunMentionCleanups) {
                    window.__xtjRunMentionCleanups = function() {
                        var _arr = window.__xtjMentionCleanups || [];
                        for (var _ci = 0; _ci < _arr.length; _ci++) { try { _arr[_ci](); } catch (_ce) {} }
                        window.__xtjMentionCleanups = [];
                    };
                }
                // 帖子关闭或重绘时关闭 + 移除全局监听器
                var _origBoxRemove = box.remove;
                box.remove = function() {
                    closeMentionDropdown();
                    _mentionCleanup();
                    var _ri = window.__xtjMentionCleanups ? window.__xtjMentionCleanups.indexOf(_mentionCleanup) : -1;
                    if (_ri !== -1) window.__xtjMentionCleanups.splice(_ri, 1);
                    _origBoxRemove.call(box);
                };
                
                var btn = document.createElement('button');
                btn.className = 'btn-sm btn-primary';
                btn.textContent = '发送';
                btn.style.borderRadius = '20px';
                btn.style.padding = '6px 14px';
                
                btn.onclick = async function() {
                    if (btn.disabled) return;
                    if (isUserMuted()) { showToast("您已被禁言，无法发表评论"); return; }
                    var content = inp.value.trim();
                    if (!content) { showToast("请输入评论内容"); return; }
                    var targetPostId = String(postId || '').trim().toLowerCase();
                    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(targetPostId)) {
                        showToast("帖子参数无效");
                        return;
                    }
                    
                    btn.disabled = true;
                    btn.textContent = "发送中..";
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);
                    try {
                        const response = await window.xtjProtectedFetch('/api/post/comment', {
                            signal: controller.signal,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ post_id: targetPostId, content: content })
                        });
                        clearTimeout(timeoutId);
                        const result = await response.json().catch(function() { return {}; });
                        if (!response.ok || !result.ok) throw new Error(result.error || '评论失败');
                        
                        touchUserSession(false);
                        showToast("评论成功");
                        box.style.gridTemplateRows = '0fr';
                        box.style.opacity = '0';
                        box.style.marginTop = '0px';
                        setTimeout(() => box.remove(), 300);
                        
                        var scrollEl = document.getElementById('panelPosts');
                        var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
                        var insertedComment = result.data && String(result.data.post_id) === targetPostId ? result.data : null;
                        
                        if (insertedComment) {
                            feedAllComments = (feedAllComments || []).filter(function(item) {
                                return !(item && item.id != null && String(item.id) === String(insertedComment.id));
                            }).concat([insertedComment]);
                            writeFeedCacheSnapshot();
                            await renderFeedFromMemoryState();
                        } else {
                            await loadFeed(true);
                        }
                        
                        requestAnimationFrame(function() {
                            var p = document.getElementById('panelPosts');
                            if (p && savedScroll > 0) p.scrollTop = savedScroll;
                            var newEl = document.querySelector('.post[data-post-id="' + targetPostId + '"]');
                            if (newEl) newEl.classList.add('visible');
                        });
                        loadProfileActivity(true);
                        
                        // 小猫 AI 自动回复轮询
                        // Phase 3-P0-1: 修复 @小猫 正则。原 lookahead (?=\s|$|[^\w\u4e00-\u9fa5]) 要求
                        // 小猫后跟非汉字字符，导致 @小猫帮我看看 不匹配（"帮"是汉字）。
                        // 改为负向断言 (?![猫])：仅排除 小猫咪，@小猫帮我看看 可匹配。
                        if (content && /[@＠]小猫(?![猫咪])/.test(content) && insertedComment) {
                            pollCatAiReply(insertedComment.id, targetPostId);
                        }
                    } catch (e) {
                        showToast("评论失败: " + (e.message || "未知错误"));
                        btn.disabled = false;
                        btn.textContent = '发送';
                    }
                };

                // ★ 不再使用独立的 inp.onkeydown，统一由 addEventListener 处理
                
                innerWrap.appendChild(inp);
                innerWrap.appendChild(btn);
                gridInner.appendChild(innerWrap);
                box.appendChild(gridInner);
                
                var actionsEl = postEl.querySelector('.actions');
                if (actionsEl) {
                    actionsEl.parentNode.insertBefore(box, actionsEl.nextSibling);
                } else {
                    postEl.appendChild(box);
                }
                
                // 触发展开动画
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        box.style.gridTemplateRows = '1fr';
                        box.style.opacity = '1';
                        box.style.marginTop = '8px';
                    });
                });
                
                setTimeout(() => inp.focus(), 300); // 动画结束后再 focus
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
            async function confirmPostDeleteStatus(postId) {
                var controller = typeof AbortController === 'function' ? new AbortController() : null;
                var statusTimeoutMs = Number(window.__xtjPostDeleteStatusTimeoutMs) > 0 ? Number(window.__xtjPostDeleteStatusTimeoutMs) : 8000;
                var timer = setTimeout(function() { if (controller) controller.abort(); }, statusTimeoutMs);
                try {
                    var response = await window.xtjProtectedFetch('/api/post/delete-status', {
                        method: 'POST',
                        body: JSON.stringify({ post_id: postId }),
                        signal: controller ? controller.signal : undefined
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) return { confirmed: false };
                    return { confirmed: true, deleted: result.deleted === true && result.exists === false };
                } catch (_) {
                    return { confirmed: false };
                } finally {
                    clearTimeout(timer);
                }
            }
            // 快速本地检查帖子是否存在（不依赖网络，避免二次超时）
            function quickPostExistsCheck(postId) {
                try {
                    var allPosts = normalizePosts(feedAllPosts);
                    var found = allPosts.find(function(p) { return String(p.id) === String(postId); });
                    if (found) return 'exists';
                    // 如果本地feed中已不存在，视为已删除
                    return 'deleted';
                } catch (_) {
                    return 'unknown';
                }
            }
            function applyConfirmedPostDeletion(postId, session) {
                removeDeletedPostFromFeed(postId);
                if (typeof clearFeedCache === 'function') { try { clearFeedCache(); } catch (e) {} }

                // 乐观删除动画：透明度+位移+高度收缩，180-220ms
                if (session.postEl && session.postEl.parentNode) {
                    var el = session.postEl;
                    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (reducedMotion) {
                        try { el.remove(); } catch (e) {}
                    } else {
                        el.style.transition = 'opacity 200ms ease, transform 200ms ease, max-height 200ms ease, margin 200ms ease, padding 200ms ease';
                        el.style.opacity = '0';
                        el.style.transform = 'translateY(-8px) scale(0.98)';
                        el.style.maxHeight = '0';
                        el.style.overflow = 'hidden';
                        el.style.margin = '0';
                        el.style.padding = '0';
                        el.style.border = 'none';
                        el.style.pointerEvents = 'none';
                        var onTransitionEnd = function() {
                            try { el.remove(); } catch (e) {}
                            el.removeEventListener('transitionend', onTransitionEnd);
                        };
                        el.addEventListener('transitionend', onTransitionEnd);
                        // 兜底：250ms 后强制移除
                        setTimeout(function() {
                            try { if (el.parentNode) el.remove(); } catch (e) {}
                        }, 250);
                    }
                }

                if (typeof updateFeedStats === 'function') { try { updateFeedStats(); } catch (e) {} }
                cleanupDeleteSession({ restoreVisual: false, hideModal: true, resetTarget: true });
                showToast("帖子已删除");
                // 不再调用 loadFeed(true)，避免整页重建和闪白
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
                if (currentPost && !canDeletePost(currentPost)) {
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
                    console.warn('[delBtn] delete flow exceeded safety deadline');
                    finished = true;
                    cleanupDeleteSession({ toast: "删除状态确认超时，请刷新后重试" });
                    // 不再调用 loadFeed(true)，防止整页重建
                }, 30000);

                try {
                    var deleteController = typeof AbortController === 'function' ? new AbortController() : null;
                    var deleteTimedOut = false;
                    var deleteTimeoutMs = Number(window.__xtjPostDeleteRequestTimeoutMs) > 0 ? Number(window.__xtjPostDeleteRequestTimeoutMs) : 10000;
                    var deleteTimer = setTimeout(function() {
                        deleteTimedOut = true;
                        if (deleteController) deleteController.abort();
                    }, deleteTimeoutMs);
                    let deleteResponse;
                    try {
                        deleteResponse = await window.xtjProtectedFetch('/api/post/delete', {
                            method: 'POST',
                            body: JSON.stringify({ post_id: targetPostId }),
                            signal: deleteController ? deleteController.signal : undefined
                        });
                    } catch (raceErr) {
                        if (finished) return;
                        if (deleteTimedOut) {
                            console.warn('[delBtn] delete request timed out; checking locally');
                            // The delete request may have reached the server before this
                            // browser timed out. Confirm with the authoritative endpoint
                            // before deciding whether to restore the optimistic UI.
                            var authoritativeStatus = await confirmPostDeleteStatus(targetPostId);
                            if (finished) return;
                            finished = true;
                            if (authoritativeStatus.confirmed && authoritativeStatus.deleted) {
                                applyConfirmedPostDeletion(targetPostId, session);
                            } else {
                                cleanupDeleteSession({ toast: "删除超时，帖子仍然存在，请重试" });
                            }
                            return;
                            // 说明：原先此处有"快速本地检查"兜底，但被上方 return 短路成为死代码。
                            // 超时后必须以权威接口 confirmPostDeleteStatus 的结果为准（避免误删/误恢复），
                            // 本地缓存检查不可靠，故移除。
                            // [dead code removed - quickPostExistsCheck local fallback]
                        }
                        throw raceErr;
                    } finally {
                        clearTimeout(deleteTimer);
                    }
                    if (finished) return;
                    const deleteResult = await deleteResponse.json().catch(function() { return {}; });
                    if (!deleteResponse.ok || !deleteResult.ok || (!deleteResult.deleted && !deleteResult.already_deleted)) {
                        finished = true;
                        cleanupDeleteSession({ toast: "删除失败: " + (deleteResult.error || "服务器未确认删除") });
                        return;
                    }
                    finished = true;
                    applyConfirmedPostDeletion(targetPostId, session);
                } catch (e) {
                    if (finished) return;
                    console.error('[delBtn] 删除异常:', e);
                    finished = true;
                    // 恢复目标帖子视觉状态
                    if (session.postEl) {
                        try {
                            session.postEl.style.opacity = session.originalOpacity || '';
                            session.postEl.style.pointerEvents = session.originalPointerEvents || '';
                            session.postEl.style.filter = session.originalFilter || '';
                            session.postEl.style.transition = '';
                            session.postEl.style.transform = '';
                            session.postEl.style.maxHeight = '';
                            session.postEl.style.overflow = '';
                            session.postEl.style.margin = '';
                            session.postEl.style.padding = '';
                            session.postEl.style.border = '';
                        } catch(e) {}
                    }
                    cleanupDeleteSession({ toast: "删除帖子失败: " + (e && e.message || "未知错误"), restoreVisual: false });
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
                // 删除弹窗取消时立即清理，不播放动画
                if (id === 'delModal') {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                if (id === 'loginModal' || id === 'registerModal') {
                    if (authModalFocusOrigin && typeof authModalFocusOrigin.focus === 'function') {
                        try { authModalFocusOrigin.focus(); } catch (_) {}
                    }
                    authModalFocusOrigin = null;
                }
                if (id === 'statModal' && statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }
            };
            resetPostActionModals();

            // ===================== 图片查看器 =====================
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
                if (!img) return;
                const v = ivZoomState;
                const t = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.scale})`;
                img.style.transform = t;
                img.style.webkitTransform = t;
            }

            function ivResetZoom(instant = false) {
                const img = document.getElementById('ivImg');
                if (!img) return;
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
                if (!h) return;
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
                    viewer.classList.add('img-transition');
                    img.classList.add('instant');
                    void img.offsetWidth;
                    img.classList.remove('instant');
                    viewer.classList.add('active');
                    setTimeout(function() { viewer.classList.add('show'); }, 10);
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
                viewer.classList.remove('show');
                setTimeout(function() {
                    viewer.classList.remove('active');
                    viewer.classList.remove('img-transition');
                }, 300);
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

            // 判空保护：图片查看器元素缺失时跳过绑定，不得中断 core.js 后续逻辑
            if (ivViewerEl) {
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

            var _ivMoveTicking = false;
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
                    if (!_ivMoveTicking) {
                        _ivMoveTicking = true;
                        requestAnimationFrame(function() {
                            ivApplyTransform();
                            ivShowHint();
                            _ivMoveTicking = false;
                        });
                    }
                } else if (ivIsPanning && e.touches.length === 1) {
                    e.preventDefault();
                    const dx = e.touches[0].clientX - ivPanStartX;
                    const dy = e.touches[0].clientY - ivPanStartY;
                    ivZoomState.tx = ivStartTx + dx;
                    ivZoomState.ty = ivStartTy + dy;
                    if (!_ivMoveTicking) {
                        _ivMoveTicking = true;
                        requestAnimationFrame(function() {
                            ivApplyTransform();
                            _ivMoveTicking = false;
                        });
                    }
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
            } // end if (ivViewerEl)

            // ===================== 浏览历史缓存 =====================
            // 帖子信息缓存：用于浏览历史与媒体标签
            const postInfoCache = {};
            // 挂到 window：登出清理 clearAllAuthState 中 window.postInfoCache 清理依赖此引用
            window.postInfoCache = postInfoCache;
            const VIEW_HISTORY_KEY = 'xtj_view_history';
            const VIEW_TRACK_TTL = 5 * 60 * 1000;
            const VIEW_HISTORY_MEDIA_LABEL = '(\u56fe\u7247/\u89c6\u9891)';
            const VIEW_HISTORY_DELETED_AUTHOR = '\u5df2\u5220\u9664\u7528\u6237';

            function normalizeViewHistoryText(value, fallback) {
                var text = String(value == null ? '' : value).trim();
                if (!text) return fallback;
                // ★ 修复：媒体标记检测关键词此前为编码损坏的乱码（永不匹配），
                // 替换为正常中文关键词，使媒体帖子的历史标签能正确显示
                if (text.indexOf('图片') !== -1 || text.indexOf('视频') !== -1 || text.indexOf('音频') !== -1 || text.indexOf('(图片/视频)') !== -1) return VIEW_HISTORY_MEDIA_LABEL;
                // ★ 修复：已删除用户标记检测关键词同上（乱码→正常中文）
                if (text.indexOf('已删除') !== -1 || text.indexOf('未知') !== -1) return VIEW_HISTORY_DELETED_AUTHOR;
                // 兼容旧数据：如果存储的是原始 JSON，解析出 text 字段
                if (text.startsWith('{') && text.indexOf('"__type"') !== -1) {
                    try { var pc = JSON.parse(text); if (pc && pc.text !== undefined) return pc.text || fallback; } catch(e) {}
                }
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
                        window.safeStorage.set(VIEW_HISTORY_KEY, JSON.stringify(filtered));
                    }
                    return filtered;
                } catch(e) { return []; }
            }

            // ===================== 浏览历史加载 =====================
            // 保存浏览历史：分页加载相关变量
            // (已收敛单一实现：旧 function saveViewHistory 声明为死代码，删除)
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
                    window.safeStorage.set(VIEW_HISTORY_KEY, JSON.stringify(history));
                }
            };

            function canTrackViewNow(postId) {
                const key = `xtj_v_${postId}`;
                const now = Date.now();
                var last = 0;
                try { last = Number(window.safeStorage.get(key) || 0); } catch (e) { last = 0; }
                if (viewTracked.has(postId) && now - last < VIEW_TRACK_TTL) return false;
                if (last && now - last < VIEW_TRACK_TTL) return false;
                return true;
            }

            trackView = function(postId) {
                const key = `xtj_v_${postId}`;
                if (!canTrackViewNow(postId)) return false;
                // ★ 修复：未登录时不记录浏览——静默返回（此前 throw + console.error
                // 导致每次滚动浏览都报错刷屏，且删除节流标记造成无限重复触发）。
                if (!currentUser || typeof window.xtjProtectedFetch !== 'function') return false;
                viewTracked.add(postId);
                // ★ 修复：请求发出前先写节流键，防止键仅成功后写入期间
                // 1 秒内重复触发并发 POST（在途请求保护）
                window.safeStorage.set(key, String(Date.now()));
                setTimeout(async () => {
                    try {
                        if (!currentUser || typeof window.xtjProtectedFetch !== 'function') throw new Error('view_auth_required');
                        var response = await window.xtjProtectedFetch('/api/post/view', {
                            method: 'POST',
                            body: JSON.stringify({ post_id: String(postId) })
                        });
                        var result = await response.json().catch(function() { return {}; });
                        if (!response.ok || !result.ok) throw new Error(result.error || 'view_record_failed');
                        var authoritativeViews = Number(result.views);
                        if (Number.isFinite(authoritativeViews)) {
                            var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                            var statsEl = postEl && postEl.querySelector('.post-stats-text');
                            if (statsEl) statsEl.textContent = statsEl.textContent.replace(/\d+/, String(authoritativeViews));
                            if (Array.isArray(feedAllPosts)) {
                                feedAllPosts = feedAllPosts.map(function(post) {
                                    return post && String(post.id) === String(postId) ? Object.assign({}, post, { views: authoritativeViews }) : post;
                                });
                                if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                            }
                            if (postInfoCache[postId]) postInfoCache[postId].views = authoritativeViews;
                        }
                        window.safeStorage.set(key, String(Date.now()));
                        if (result.recorded && currentUser && postInfoCache[postId]) {
                            var cachedPost = postInfoCache[postId];
                            var rawContent = cachedPost.content || '';
                            var displayContent = rawContent;
                            try { var pc = JSON.parse(rawContent); if (pc && pc.__type && pc.text !== undefined) { displayContent = pc.text; } } catch(e) {}
                            saveViewHistory({ user_name: currentUser, post_id: postId,
                                post_content: displayContent.length > 200 ? displayContent.slice(0, 200) + '...' : (displayContent || VIEW_HISTORY_MEDIA_LABEL),
                                post_author: cachedPost.user_name || VIEW_HISTORY_DELETED_AUTHOR,
                                media_url: cachedPost.media_url || '', media_type: cachedPost.media_type || '',
                                viewed_at: result.viewed_at || new Date().toISOString() });
                        }
                        updateFeedStats();
                    } catch (e) {
                        viewTracked.delete(postId);
                        try { window.safeStorage.remove(key); } catch (_) {}
                        console.error(e);
                    }
                }, 1000);
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

            let feedPage = 1;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;
            let feedLoadRequestId = 0;
            let feedStateVersion = 0;
            let feedNextOffset = 0;
            let feedLoadedPages = [];
            let feedPageFetchPending = false;
            // ★ 修复：加载更多失败后置位，哨兵不再自动触发（防无限重复请求），
            // 需用户点击错误提示"重试"才清除并重新加载
            let feedLoadMoreFailed = false;

            function markFeedStateChanged() {
                feedStateVersion += 1;
                feedVisiblePostsCache = null;
                feedMapsCache = null;
                return feedStateVersion;
            }

            function syncPostInfoCache(post) {
                var normalized = normalizePost(post || {});
                if (!normalized || !normalized.id) return;
                postInfoCache[normalized.id] = {
                    id: normalized.id,
                    content: normalized.content || '',
                    user_name: normalized.user_name || '',
                    media_url: normalized.media_url || '',
                    media_type: normalized.media_type || '',
                    created_at: normalized.created_at || '',
                    views: Number(normalized.views || 0)
                };
            }
            let feedVisiblePostsCache = null; // 缓存过滤后的帖子
            let feedMapsCache = null; // 缓存 buildPostMaps 结果

            // 无限滚动监听

            // 无限滚动监听
            function setupFeedInfiniteScroll() {
                if (feedScrollObserver) feedScrollObserver.disconnect();
                
                const feed = document.getElementById('feed');
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting && !feedEndReached && !feedLoadMoreFailed) {
                            loadMoreFeedPosts();
                        }
                    });
                }, { rootMargin: '200px' });
                
                // 在 feed 底部添加哨兵元素（sentinel）
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


            // 构建帖子评论/点赞映射（用于渲染）
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

            // 缓存头像 URL

            async function loadAvatarsForUsers(usernames) {
                var normalizedUsers = Array.from(new Set(
                    (usernames || [])
                        .map(function(value) {
                            return String(value || '').trim();
                        })
                        .filter(Boolean)
                ));

                if (normalizedUsers.length === 0) return;
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    normalizedUsers.forEach(function(username) {
                        if (username && cachedAvatars[username] && !avatarCache[username]) {
                            avatarCache[username] = cachedAvatars[username];
                        }
                    });
                } catch (e) {}

                // P7: 只为没有新鲜缓存（TTL 内）的用户发起批量请求。
                // confirmed_none / has_avatar / fetch_failed 在 TTL 内均不重查。
                var uncached = normalizedUsers.filter(function(username) {
                    return !hasFreshAvatarCache(username);
                });
                if (uncached.length === 0) return;
                try {
                    var resp = await fetch(API_BASE + '/api/avatar/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ users: uncached })
                    });
                    var result = await resp.json();
                    if (resp.ok && result.ok && result.avatars) {
                        var avatars = result.avatars;
                        var keys = Object.keys(avatars);
                        for (var ki = 0; ki < keys.length; ki++) {
                            var k = keys[ki];
                            // P7: null → confirmed_none；有 URL → has_avatar
                            if (avatars[k]) {
                                setAvatarCacheEntry(k, 'has_avatar', avatars[k]);
                            } else if (avatars[k] === null) {
                                setAvatarCacheEntry(k, 'confirmed_none', null);
                            }
                        }
                        // 写入本地缓存，避免下次访问重新请求
                        try {
                            var cachedAvatars = readAvatarCacheFromStorage();
                            for (var ki2 = 0; ki2 < keys.length; ki2++) {
                                var k2 = keys[ki2];
                                if (avatars[k2]) {
                                    cachedAvatars[k2] = { state: 'has_avatar', url: avatars[k2], fetched_at: Date.now() };
                                } else if (avatars[k2] === null) {
                                    cachedAvatars[k2] = { state: 'confirmed_none', url: null, fetched_at: Date.now() };
                                }
                            }
                            writeAvatarCacheToStorage(cachedAvatars);
                        } catch(e) {}
                    } else {
                        // P7: 批量接口失败时降级到旧缓存（与单用户接口一致）
                        uncached.forEach(function(username) {
                            setAvatarCacheEntry(username, 'fetch_failed', null);
                        });
                    }
                } catch(e) {
                    // P7: 网络异常时降级到旧缓存（与单用户接口一致）
                    uncached.forEach(function(username) {
                        setAvatarCacheEntry(username, 'fetch_failed', null);
                    });
                    console.error('批量头像加载失败:', e);
                }
            }

            function renderAvatarContent(username, avatarUrl) {
                var safeUser = String(username || '').trim();
                var fallbackInitial = (Array.from(safeUser)[0] || '?').toUpperCase();
                var fallbackSpan = '<span class="avatar-fallback" data-user-name="' + escapeHtml(safeUser) + '">' + escapeHtml(fallbackInitial) + '</span>';
                if (avatarUrl && sanitizeUrl(avatarUrl)) {
                    return '<img class="avatar-image" src="' + escapeHtml(sanitizeUrl(avatarUrl)) +
                        '" alt="' + escapeHtml(safeUser) + '" data-user-name="' + escapeHtml(safeUser) +
                        '" loading="lazy" decoding="async" style="opacity:0;transition:opacity 0.2s"' +
                        ' onload="var p=this.closest(\'.avatar\');if(p){p.classList.add(\'has-image\');this.style.opacity=\'1\'}"' +
                        ' onerror="var p=this.closest(\'.avatar\');if(p){p.classList.remove(\'has-image\');this.remove();var f=p.querySelector(\'.avatar-fallback\');if(f)f.style.visibility=\'visible\'};var u=this.getAttribute(\'data-user-name\');if(u&&window.__xtjInvalidateAvatarCache)window.__xtjInvalidateAvatarCache(u)">' +
                        fallbackSpan;
                }
                return fallbackSpan;
            }

            function getAvatarHtml(username, post) {
                var safeUser = String(username || '').trim();
                var fallbackInitial = (Array.from(safeUser)[0] || '?').toUpperCase();
                var avatarUrl = getAvatarUrl(safeUser) || '';

                if (!avatarUrl && safeUser) {
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        if (cachedAvatars[safeUser] && cachedAvatars[safeUser].url) {
                            avatarCache[safeUser] = cachedAvatars[safeUser];
                            avatarUrl = cachedAvatars[safeUser].url;
                        }
                    } catch (e) {}
                }

                var safeName = escapeHtml(safeUser);
                var safeNameJs = safeJsStr(safeUser);

                if (avatarUrl && sanitizeUrl(avatarUrl)) {
                    return '<div class="avatar-wrap" onclick="openUserProfile(\'' +
                        safeNameJs +
                        '\')" data-user-name="' + safeName +
                        '"><div class="avatar clickable">' +
                        renderAvatarContent(safeUser, avatarUrl) +
                        '</div></div>';
                }

                return '<div class="avatar clickable" onclick="openUserProfile(\'' +
                    safeNameJs +
                    '\')" data-user-name="' + safeName +
                    '">' +
                    escapeHtml(fallbackInitial) +
                    '</div>';
            }

            // DEPRECATED_DO_NOT_EDIT ====== [??????]
            function getPostFilterUserAvatar(username) {
                var safeName = escapeHtml(username || "");
                var avatarUrl = getAvatarUrl(username);
                if (avatarUrl) {
                    return '<span class="post-user-chip-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(avatarUrl) + '" alt="' + safeName + '"></span>';
                }
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[username] && cachedAvatars[username].url) {
                        avatarCache[username] = cachedAvatars[username];
                        return '<span class="post-user-chip-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(cachedAvatars[username].url) + '" alt="' + safeName + '"></span>';
                    }
                } catch(e) {}
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
                    var safeJsName = safeJsStr(String(username));
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
                    var authRes = await window.xtjOptionalAuthFetch('/api/feed/authors');
                    if (!authRes.ok) throw new Error('authors_query_failed');
                    var authorPayload = await authRes.json();
                    if (!authorPayload || !authorPayload.ok) throw new Error('authors_query_failed');
                    var seen = {};
                    postFilterUsers = (authorPayload.authors || []).map(function(name) {
                        return String(name || "").trim();
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

            function buildPostContentHtml(content) {
                // ★ 修复：多行帖正文换行——escapeHtml 后把 \n 替换为 <br>（与 early-feed.js 行为一致）；
                // 仅作用于 feed 正文渲染，评论/标题等不走本函数，不受影响。
                return escapeHtml(String(content || '')).replace(/\n/g, '<br>');
            }
            window.buildPostContentHtml = buildPostContentHtml;

            function initPostScrollAnimation() {
                var posts = document.querySelectorAll('.post');
                primePostReveal(posts);
                observePostViewportState(posts);
            }

            let _cachedSPosts = null, _cachedSViews = null, _cachedSLikes = null;
            function updateFeedStats() {
    // 统一统计口径：优先使用内存全量数据（feedAll* 缓存），
    // 避免筛选/分页后 DOM 只含部分帖子导致统计数字错乱；内存数据缺失时回退 DOM 统计。
    var posts = [];
    var totalLikes = 0, totalComments = 0, totalViews = 0;
    // feedAll* 是与 updateFeedStats 同作用域的闭包变量（let 声明），直接访问；
    // 未初始化（undefined）时回退 DOM 统计，避免筛选/分页后统计错乱。
    var hasFullData = Array.isArray(feedAllPosts) && Array.isArray(feedAllLikes) && Array.isArray(feedAllComments);
    if (hasFullData) {
        posts = feedAllPosts;
        feedAllLikes.forEach(function(like) {
            if (!(like && (like.is_like === false || like.like_type === 'unlike'))) totalLikes += 1;
        });
        totalComments = feedAllComments.length;
        posts.forEach(function(p) {
            if (p && Number(p.views)) totalViews += Number(p.views);
        });
    } else {
        posts = Array.prototype.slice.call(document.querySelectorAll('.post'));
        posts.forEach(function(p) {
            var text = (p.querySelector('.post-stats-text') || {}).textContent || '';
            var matchV = text.match(/(?:浏览|👁)\s*(\d+)/);
            if (matchV) totalViews += parseInt(matchV[1], 10) || 0;
            var matchL = text.match(/(?:点赞|❤)\s*(\d+)/);
            if (matchL) totalLikes += parseInt(matchL[1], 10) || 0;
            var matchC = text.match(/(?:评论|💬)\s*(\d+)/);
            if (matchC) totalComments += parseInt(matchC[1], 10) || 0;
        });
    }
                // 缓存引用前先校验节点仍在文档中，避免节点被 innerHTML 重写后写入已脱离文档的旧节点
                var sPosts = (_cachedSPosts && document.body.contains(_cachedSPosts)) ? _cachedSPosts : (_cachedSPosts = document.getElementById('sPosts'));
                var sViews = (_cachedSViews && document.body.contains(_cachedSViews)) ? _cachedSViews : (_cachedSViews = document.getElementById('sViews'));
                var sLikes = (_cachedSLikes && document.body.contains(_cachedSLikes)) ? _cachedSLikes : (_cachedSLikes = document.getElementById('sLikes'));
                if (sPosts) sPosts.textContent = posts.length;
                if (sViews) sViews.textContent = totalViews;
                // 只显示点赞数；互动合计见统计弹层文案
                if (sLikes) sLikes.textContent = totalLikes;
            }

            async function initialLoad(skipCache = false) {
                if (!skipCache) {
                    const cached = window.safeStorage.get(CACHE_KEY);
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
                var meta = Object.assign({}, POST_META_DEFAULTS, {
                    visibility: visibility || "public"
                }, overrides || {});
                if (overrides && overrides.location && typeof overrides.location === "object") {
                    meta.location_name = overrides.location.name || "";
                    meta.location_province = overrides.location.province || "";
                    meta.location_city = overrides.location.city || "";
                    meta.location_district = overrides.location.district || "";
                    meta.location_level = overrides.location.level || "";
                }
                return meta;
            }

            async function insertPostRecord(payload, fallbackContent) {
                try {
                    var body = {
                        content: payload.content || fallbackContent || '',
                        media_url: payload.media_url || '',
                        media_type: payload.media_type || '',
                        actor_key: payload.actor_key || '',
                        visibility: payload.visibility || 'public'
                    };
                    // 位置字段（可选，用户主动选择）
                    if (payload.location && payload.location.name) {
                        body.location = {
                            name: payload.location.name || '',
                            province: payload.location.province || '',
                            city: payload.location.city || '',
                            district: payload.location.district || '',
                            level: payload.location.level || ''
                        };
                    }
                    var response = await window.xtjProtectedFetch('/api/post/create', {
                        method: 'POST',
                        body: JSON.stringify(body)
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok || !result.data) {
                        return { ok: false, error: new Error(result.error || '发布失败') };
                    }
                    var data = normalizePost(result.data);
                    if (data && data.id && (!data.ip_region_text || !data.ip_region_status || !data.location_name)) {
                        try {
                            var fresh = await fetchPostSnapshot(data.id);
                            if (fresh) data = normalizePost(fresh);
                        } catch (snapshotError) {
                            console.warn('[post-create] snapshot refresh failed', snapshotError);
                        }
                    }
                    return { ok: true, fallback: false, data: data };
                } catch (error) {
                    return { ok: false, error: error };
                }
            }

            function insertPublishedPostIntoFeed(post) {
                if (!post || !post.id) return false;
                post = normalizePost(post);
                if (!Array.isArray(feedAllPosts)) feedAllPosts = [];
                feedAllPosts = feedAllPosts.filter(function(item) { return String(item.id) !== String(post.id); });
                feedAllPosts.unshift(post);
                feedAllPosts = sortPosts(feedAllPosts);
                syncPostInfoCache(post);
                var firstPage = (feedLoadedPages || []).find(function(page) { return page && page.offset === 0; });
                if (firstPage) {
                    firstPage.postIds = [String(post.id)].concat((firstPage.postIds || []).filter(function(id) { return String(id) !== String(post.id); }));
                } else {
                    feedLoadedPages = [{ offset: 0, postIds: [String(post.id)] }].concat(feedLoadedPages || []);
                }
                markFeedStateChanged();
                var feed = document.getElementById('feed');
                if (!feed) return false;
                var maps = buildPostMaps(feedAllComments || [], feedAllLikes || []);
                var template = document.createElement('template');
                template.innerHTML = renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap).trim();
                var postEl = template.content.firstElementChild;
                if (!postEl) return false;
                postEl.classList.add('visible', 'is-newly-published');
                postEl.style.setProperty('--post-enter-delay', '0ms');
                feed.insertBefore(postEl, feed.firstChild);
                observePostViewportState([postEl]);
                var clearPublishedAnimation = function() { postEl.classList.remove('is-newly-published'); };
                postEl.addEventListener('animationend', clearPublishedAnimation, { once: true });
                setTimeout(clearPublishedAnimation, 420);
                writeFeedCacheSnapshot();
                updateFeedStats();
                return true;
            }

            function postHasRenderableIpData(post) {
                if (!post) return false;
                return !!(
                    String(post.ip_region_text || "").trim() ||
                    String(post.ip_region_status || "").trim() ||
                    String(post.ip_province || "").trim() ||
                    String(post.ip_city || "").trim() ||
                    String(post.ip_lookup_started_at || "").trim()
                );
            }

            function postNeedsIpRefresh(post) {
                if (!post || !post.id) return false;
                var status = String(post.ip_region_status || "").trim();
                var hasLookupStarted = !!String(post.ip_lookup_started_at || "").trim();
                var hasRegionText = !!String(post.ip_region_text || "").trim();
                return status === 'pending' || (hasLookupStarted && !hasRegionText);
            }

            function refreshPublishedPostCard(post) {
                if (!post || !post.id) return false;
                if (!Array.isArray(feedAllPosts)) feedAllPosts = [];
                var postId = String(post.id);
                feedAllPosts = feedAllPosts.map(function(item) {
                    return String(item && item.id) === postId ? post : item;
                });
                syncPostInfoCache(post);
                markFeedStateChanged();
                var feed = document.getElementById('feed');
                if (!feed) return false;
                var existing = feed.querySelector('.post[data-post-id="' + postId.replace(/"/g, '\\"') + '"]');
                if (!existing) return false;
                var maps = buildPostMaps(feedAllComments || [], feedAllLikes || []);
                var template = document.createElement('template');
                template.innerHTML = renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap).trim();
                var nextPostEl = template.content.firstElementChild;
                if (!nextPostEl) return false;
                nextPostEl.classList.add('visible');
                existing.replaceWith(nextPostEl);
                observePostViewportState([nextPostEl]);
                writeFeedCacheSnapshot();
                updateFeedStats();
                return true;
            }

            var publishedPostIpRefreshTimers = Object.create(null);
            function schedulePublishedPostIpRefresh(postId) {
                if (!postId) return;
                var key = String(postId);
                if (publishedPostIpRefreshTimers[key]) return;
                publishedPostIpRefreshTimers[key] = true;
                var attempts = 0;
                var maxAttempts = 4;
                function cleanup() {
                    delete publishedPostIpRefreshTimers[key];
                }
                function run() {
                    attempts++;
                    fetchPostSnapshot(postId).then(function(freshPost) {
                        var normalized = freshPost ? normalizePost(freshPost) : null;
                        var ipText = normalized ? String(normalized.ip_region_text || "").trim() : "";
                        var ipStatus = normalized ? String(normalized.ip_region_status || "").trim() : "";
                        var hasFinalIpDisplay = !!ipText || ipStatus === 'resolved' || ipStatus === 'failed';
                        if (normalized && hasFinalIpDisplay) {
                            refreshPublishedPostCard(normalized);
                            cleanup();
                            return;
                        }
                        if (normalized && (ipStatus === 'pending' || String(normalized.ip_lookup_started_at || "").trim())) {
                            if (attempts < maxAttempts) {
                                setTimeout(run, attempts === 1 ? 600 : 900);
                            } else {
                                cleanup();
                            }
                            return;
                        }
                        if (attempts < maxAttempts) {
                            setTimeout(run, attempts === 1 ? 600 : 900);
                        } else {
                            cleanup();
                        }
                    }).catch(function() {
                        if (attempts < maxAttempts) {
                            setTimeout(run, 900);
                        } else {
                            cleanup();
                        }
                    });
                }
                setTimeout(run, 450);
            }

            function refreshPendingFeedIpPosts(posts) {
                if (!Array.isArray(posts) || !posts.length) return;
                posts.forEach(function(post) {
                    if (!postNeedsIpRefresh(post)) return;
                    schedulePublishedPostIpRefresh(post.id);
                });
            }

            function resetPostComposer() {
                var postInp = document.getElementById("postInp");
                var fileInp = document.getElementById("fileInp");
                var visibilityEl = document.getElementById("postVisibility");
                if (postInp) postInp.value = "";
                if (fileInp) fileInp.value = "";
                if (visibilityEl) visibilityEl.value = "public";
                resetPostLocation();
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
                    visibility: nextVisibility
                };
                var resp = await window.xtjProtectedFetch('/api/post/update', {
                    method: 'POST',
                    body: JSON.stringify(updatePayload)
                });
                var result = await resp.json().catch(function() { return {}; });
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

            function formatRelativeTime(dateStr) {
                var d = window.safeParseDate ? window.safeParseDate(dateStr) : new Date(dateStr);
                var diff = Math.floor((Date.now() - d.getTime()) / 1000);
                if (diff < 60) return "刚刚";
                if (diff < 3600) return Math.floor(diff / 60) + "分钟前";
                if (diff < 86400) return Math.floor(diff / 3600) + "小时前";
                if (diff < 86400 * 30) return Math.floor(diff / 86400) + "天前";
                return d.toLocaleDateString();
            }

            function formatPostTime(post) {
                var normalized = normalizePost(post);
                var time = normalized.created_at ? window.safeParseDate(normalized.created_at).toLocaleString() : "";
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
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '❤️' : '🤍') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + idJs + '\')">评论</button>'
                ];
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" data-post-id="' + idHtml + '">' + (normalizePost(post).is_pinned ? '取消置顶' : '置顶') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + idJs + '\', \'' + actorKeyJs + '\')">删除</button>');
                }
                actions.push('<button type="button" class="action-btn post-tools-trigger" data-post-id="' + idHtml + '" aria-haspopup="menu" aria-expanded="false" aria-label="更多帖子工具">•••</button>');
                return actions.join("");
            }

            var activePostToolsMenu = null;
            function closePostToolsMenu() {
                if (!activePostToolsMenu) return;
                var trigger = activePostToolsMenu.trigger;
                activePostToolsMenu.menu.remove();
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
                activePostToolsMenu = null;
            }

            function openPostToolsMenu(trigger) {
                if (!trigger) return;
                if (activePostToolsMenu && activePostToolsMenu.trigger === trigger) {
                    closePostToolsMenu();
                    return;
                }
                closePostToolsMenu();
                var postId = String(trigger.getAttribute('data-post-id') || '');
                if (!postId) return;
                var menu = document.createElement('div');
                menu.className = 'post-tools-menu';
                menu.setAttribute('role', 'menu');
                var svgTranslate = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
                var svgAi = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3l1.9 5.8 1.9-5.8a2 2 0 0 1 1.3-1.3l5.8-1.9-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>';
                var svgReport = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>';
                var post = feedAllPosts.find(function(p) { return p.id == postId; });
                if (!post && window.currentPost && window.currentPost.id == postId) post = window.currentPost;
                var hasText = post && String(post.content || '').trim().length > 0;
                var btnTranslate = hasText ? '<button type="button" role="menuitem" data-post-tool="translate" data-post-id="' + escapeHtml(postId) + '">' + svgTranslate + '<span>翻译帖子</span></button>' : '';
                var btnAi = hasText ? '<button type="button" role="menuitem" data-post-tool="ask-ai" data-post-id="' + escapeHtml(postId) + '">' + svgAi + '<span>锐评 AI</span></button>' : '';
                menu.innerHTML = btnTranslate + btnAi +
                                 '<button type="button" role="menuitem" data-post-tool="report" data-post-id="' + escapeHtml(postId) + '">' + svgReport + '<span>举报帖子</span></button>';
                document.body.appendChild(menu);
                var rect = trigger.getBoundingClientRect();
                var width = menu.offsetWidth || 148;
                menu.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)) + 'px';
                menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 6)) + 'px';
                trigger.setAttribute('aria-expanded', 'true');
                activePostToolsMenu = { menu: menu, trigger: trigger };
            }
            window.closePostToolsMenu = closePostToolsMenu;
            window.addEventListener('pagehide', closePostToolsMenu);
            window.addEventListener('scroll', closePostToolsMenu, { passive: true });
            window.addEventListener('resize', closePostToolsMenu, { passive: true });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', closePostToolsMenu, { passive: true });
                window.visualViewport.addEventListener('scroll', closePostToolsMenu, { passive: true });
            }
            // Capture scroll from dock panels as well as the document; the menu is appended to body.
            document.addEventListener('scroll', closePostToolsMenu, { capture: true, passive: true });
            document.addEventListener('visibilitychange', function() {
                if (document.hidden) closePostToolsMenu();
            });

            var activePostAiSession = null;
            function getPostToolAnchor(postId) {
                return document.querySelector('.post-tools-trigger[data-post-id="' + String(postId).replace(/"/g, '\\"') + '"]');
            }
            function postToolFetch(body) {
                return window.xtjProtectedFetch('/api/agent/post-tools', { method: 'POST', body: JSON.stringify(body) }).then(function(resp) {
                    return resp.json().then(function(data) { if (!resp.ok) throw new Error(data.error || 'post_tool_failed'); return data; });
                });
            }
            window.requestPostTranslation = function(postId) {
                var anchor = getPostToolAnchor(postId);
                if (!anchor) return;
                var host = anchor.closest('.post');
                if (!host) return;
                var actions = anchor.closest('.actions');
                if (!actions) return;
                var existing = host.querySelector('.post-tool-translation');
                if (existing) { existing.hidden = !existing.hidden; return; }
                var panel = document.createElement('section');
                panel.className = 'post-tool-translation';
                panel.textContent = '正在翻译...';
                actions.insertAdjacentElement('afterend', panel);
                postToolFetch({ post_id: postId, action: 'translate' }).then(function(data) {
                    panel.textContent = data.translation || '暂时无法翻译该帖子。';
                    panel.classList.toggle('is-original-chinese', !!data.already_chinese);
                }).catch(function() { panel.textContent = '翻译暂时不可用。'; panel.classList.add('is-error'); });
            };
            function runPostAiRequest(session, payload) {
                var requestId = ++session.requestId;
                session.output.textContent = 'AI 正在锐评...';
                session.output.classList.remove('is-error');
                session.controller.abort();
                session.controller = new AbortController();
                window.xtjProtectedFetch('/api/agent/post-chat/stream', { method: 'POST', body: JSON.stringify(payload), signal: session.controller.signal }).then(function(resp) {
                    if (!resp.ok || !resp.body) throw new Error('post_chat_failed');
                    return resp.body.getReader();
                }).then(function(reader) {
                    var decoder = new TextDecoder(), buffer = '';
                    var receivedContent = false;
                    function read() { return reader.read().then(function(chunk) {
                        if (chunk.done) {
                            if (!receivedContent) {
                                session.output.textContent = 'AI 暂时不可用。';
                                session.output.classList.add('is-error');
                            }
                            return;
                        }
                        buffer += decoder.decode(chunk.value, { stream: true });
                        var events = buffer.split('\n\n'); buffer = events.pop();
                        events.forEach(function(event) {
                            var dataLine = event.split('\n').filter(function(line) { return line.indexOf('data: ') === 0; })[0];
                            if (!dataLine || session.isClosed || requestId !== session.requestId) return;
                            var data; try { data = JSON.parse(dataLine.slice(6)); } catch (e) { return; }
                            if (data.content) {
                                receivedContent = true;
                                session.conversationId = data.conversation_id || session.conversationId;
                                session.output.textContent = event.indexOf('event: delta') === 0 ? (session.output.textContent === 'AI 正在锐评...' ? '' : session.output.textContent) + data.content : data.content;
                            }
                            if (data.error) { session.output.textContent = 'AI 暂时不可用。'; session.output.classList.add('is-error'); }
                        });
                        return read();
                    }); }
                    return read();
                }).catch(function(error) {
                    if (error.name !== 'AbortError' && !session.isClosed && requestId === session.requestId) {
                        session.output.textContent = 'AI 暂时不可用。';
                        session.output.classList.add('is-error');
                    }
                });
            }
            window.openPostAiChat = function(postId) {
                var anchor = getPostToolAnchor(postId);
                if (!anchor) return;
                var host = anchor.closest('.post');
                if (!host) return;
                var actions = anchor.closest('.actions');
                if (!actions) return;
                var existing = host.querySelector('.post-tool-critique');
                if (existing) {
                    if (existing.classList.contains('is-error')) {
                        existing.classList.remove('is-error');
                        existing.textContent = 'AI 正在锐评...';
                        var existingSession = existing.__aiSession;
                        if (existingSession) runPostAiRequest(existingSession, { post_id: String(postId), initial: true });
                    } else {
                        existing.hidden = !existing.hidden;
                    }
                    return;
                }
                
                var panel = document.createElement('section');
                panel.className = 'post-tool-critique';
                panel.textContent = 'AI 正在锐评...';
                actions.insertAdjacentElement('afterend', panel);
                
                var session = { output: panel, controller: new AbortController(), requestId: 0, conversationId: '', isClosed: false };
                panel.__aiSession = session;
                runPostAiRequest(session, { post_id: String(postId), initial: true });
            };
            window.openPostReport = function(postId) {
                window.__xtjReportTargetPostId = String(postId);
                if (typeof window.openReportModal === 'function') window.openReportModal();
                var reportList = document.getElementById('reportContentList');
                var selectTarget = function() {
                    var item = reportList && reportList.querySelector('[data-id="' + String(postId).replace(/"/g, '\\"') + '"]');
                    if (item) { item.click(); return true; }
                    return false;
                };
                if (!selectTarget() && reportList) {
                    var observer = new MutationObserver(function() { if (selectTarget()) observer.disconnect(); });
                    observer.observe(reportList, { childList: true, subtree: true });
                    // 兜底：目标始终未出现时 5s 强制断开，避免监听器常驻泄漏
                    window.setTimeout(function() { try { observer.disconnect(); } catch (e) {} }, 5000);
                }
                postToolFetch({ post_id: postId, action: 'report_scan' }).then(function(data) {
                    window.__xtjReportAiScan = data.scan || null;
                    var form = document.getElementById('reportModal');
                    if (!form || !data.scan) return;
                    var old = form.querySelector('.report-ai-scan'); if (old) old.remove();
                    var scan = document.createElement('div'); scan.className = 'report-ai-scan';
                    scan.textContent = 'AI 检测：' + String(data.scan.summary || '未发现明确风险');
                    form.querySelector('.report-form, .report-content, .modal-box').appendChild(scan);
                }).catch(function() { window.__xtjReportAiScan = null; });
            };

            function buildPostLocationHtml(normalized) {
                var parts = [];
                var locationName = String(normalized.location_name || normalized.location || "").trim();
                if (!locationName && normalized._contentMeta) {
                    locationName = String((normalized._contentMeta.location_name || "")).trim();
                }
                if (locationName) {
                    parts.push('<div class="post-location-display"><span class="post-location-icon">📍</span> ' + escapeHtml(locationName) + '</div>');
                }
                var ipText = String(normalized.ip_region_text || "").trim();
                var ipStatus = String(normalized.ip_region_status || "").trim();
                var ipProvince = String(normalized.ip_province || "").trim();
                var ipCity = String(normalized.ip_city || "").trim();
                if (!ipText && normalized._contentMeta) {
                    var ipMeta = normalized._contentMeta || {};
                    if (!ipText) ipText = String(ipMeta.ip_region_text || "").trim();
                    if (!ipStatus) ipStatus = String(ipMeta.ip_region_status || "").trim();
                    if (!ipProvince) ipProvince = String(ipMeta.ip_province || "").trim();
                    if (!ipCity) ipCity = String(ipMeta.ip_city || "").trim();
                }
                var hasLookupStarted = !!normalized.ip_lookup_started_at || ipStatus === 'resolved' || ipStatus === 'pending' || ipStatus === 'failed';
                if (!ipText && (ipProvince || ipCity)) {
                    ipText = [ipProvince, ipCity].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                }
                if (hasLookupStarted || ipText) {
                    if (!ipText && ipStatus === 'pending') ipText = '解析中';
                    if (!ipText && (ipStatus === 'failed' || ipStatus === 'resolved')) ipText = '未知';
                    if (!ipText) ipText = '未知';
                }
                if (ipText) {
                    parts.push('<div class="post-ip-region">IP属地：' + escapeHtml(ipText) + '</div>');
                }
                return parts.length ? '<div class="post-location-info">' + parts.join('') + '</div>' : '';
            }

            function looksLikeSystemTelemetry(content) {
                if (!content) return false;
                try {
                    var obj = JSON.parse(String(content).trim());
                    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
                    var telemetryKeys = [
                        'page_load_id', 'last_attempt_at', 'resolved_address', 'resolved_at',
                        'capture_reason', 'precise_location_history',
                        'device_id', 'browser_fingerprint_hash', 'canvas_fingerprint_hash',
                        'webgl_fingerprint_hash'
                    ];
                    var matchCount = 0;
                    for (var i = 0; i < telemetryKeys.length; i++) {
                        if (telemetryKeys[i] in obj) matchCount++;
                    }
                    return matchCount >= 2;
                } catch (e) {
                    return false;
                }
            }

            function renderPostCard(post, commentMap, likeMap, likeUserMap) {
                var normalized = normalizePost(post);
                // 安全兜底：content 是系统遥测/定位 JSON 则跳过
                if (looksLikeSystemTelemetry(normalized.content)) {
                    return '';
                }
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = isPostLikedByCurrentUser(likeUserMap, normalized.id);
                var canDelete = canDeletePost(normalized);
                function commentDeleteButton(comment) {
                    if (!comment || !currentUser || !(isAdmin() || String(comment.user_name || '') === String(currentUser))) return '';
                    return '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(comment.id) + '\', this)">删除</button>';
                }
                // ★ 修复：媒体 URL 复用 sanitizeUrl 清洗（拒绝 javascript:/data: 等非白名单协议）
                var safeMediaUrl = sanitizeUrl(normalized.media_url || '');
                var mediaDataAttrs = [
                    'data-post-id="' + escapeHtml(String(normalized.id)) + '"',
                    'data-media-url="' + escapeHtml(safeMediaUrl) + '"',
                    'data-post-user="' + escapeHtml(String(normalized.user_name || "")) + '"',
                    'data-post-created-at="' + escapeHtml(String(normalized.created_at || "")) + '"',
                    'data-post-views="' + escapeHtml(String(normalized.views || 0)) + '"',
                    'data-file-size="' + escapeHtml(String((normalized._contentMeta && normalized._contentMeta.fileSize) || "")) + '"',
                    'data-original-size="' + escapeHtml(String((normalized._contentMeta && normalized._contentMeta.originalSize) || "")) + '"'
                ].join(" ");
                var mediaMarkup = '';
                if (safeMediaUrl) {
                    if (normalized.media_type === 'video') mediaMarkup = '<div class="media"><video src="' + escapeHtml(safeMediaUrl) + '" controls preload="none" playsinline></video></div>';
                    else if (normalized.media_type === 'audio') mediaMarkup = '<div class="media"><audio src="' + escapeHtml(safeMediaUrl) + '" controls preload="metadata"></audio></div>';
                    else mediaMarkup = '<div class="media"><img ' + mediaDataAttrs + ' data-actor-key="' + escapeHtml(String(normalized.actor_key || '')) + '" data-can-delete="' + (canDelete ? '1' : '0') + '" src="' + escapeHtml(safeMediaUrl) + '" loading="lazy" decoding="async" fetchpriority="low" onclick="openImageViewer(\'' + safeJsStr(safeMediaUrl) + '\', this)"></div>';
                }
                return `
                <div class="post glass" data-post-id="${escapeHtml(normalized.id)}" data-post-user="${escapeHtml(normalized.user_name || "")}">
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
                  <div class="content">${buildPostContentHtml(normalized.content)}</div>
                  ${mediaMarkup}
                  ${buildPostLocationHtml(normalized)}
                  <div class="post-stats-text">${buildPostStatsLine(normalized, pLikes.length, pComms.length)}</div>
                  <div class="actions">${buildPostActionHtml(normalized, isLiked, canDelete)}</div>
                  ${pComms.length ? `<div class="comments">${(function(){
                      // ★ 修复：递归建树渲染评论。旧实现只把 parent 是 root 的回复当
                      // 子节点，回复的回复（grandchild）被当成 root 直接子级错乱嵌套；
                      // 父评论缺失/已删的回复既不渲染却仍计入评论数（数量不一致）。
                      // 现按 parent_comment_id 递归建树：父缺失的回复提升为顶层展示，
                      // 全部 pComms 均被渲染，评论数口径与实际渲染一致。
                      var _byId = {};
                      pComms.forEach(function(c) { _byId[String(c.id)] = c; });
                      var _childrenOf = {};
                      var _roots = [];
                      pComms.forEach(function(c) {
                        var _pid = (c.parent_comment_id != null && String(c.parent_comment_id) !== '') ? String(c.parent_comment_id) : '';
                        if (_pid && _byId[_pid]) {
                          (_childrenOf[_pid] = _childrenOf[_pid] || []).push(c);
                        } else {
                          _roots.push(c);
                        }
                      });
                      function _renderCommentNode(c) {
                        var _node;
                        if (c.user_name === 'cat_ai' && c.generated_by_ai) {
                          _node = '<div class="comment-item cat-ai-comment" data-comment-id="' + escapeHtml(c.id) + '" data-parent-comment-id="' + escapeHtml(c.parent_comment_id || '') + '"><div class="comment-item-inner"><span class="cat-ai-avatar" aria-label="小猫">🐱</span><div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">' + escapeHtml(c.created_at ? formatRelativeTime(c.created_at) : '刚刚') + '</span>' + commentDeleteButton(c) + '</div><div class="comment-item-content">' + escapeHtml(c.content) + '</div></div></div></div>';
                        } else {
                          _node = '<div class="comment-item" data-comment-id="' + escapeHtml(c.id) + '"><div><b>' + escapeHtml(c.user_name) + ':</b> ' + escapeHtml(c.content) + '</div>' + commentDeleteButton(c) + '</div>';
                        }
                        var _kids = _childrenOf[String(c.id)] || [];
                        if (_kids.length) {
                          _node += '<div class="comment-replies" style="margin-left:24px; margin-top:8px;">' + _kids.map(_renderCommentNode).join('') + '</div>';
                        }
                        return _node;
                      }
                      return _roots.map(_renderCommentNode).join('');
                  })()}</div>` : ''}
                </div>`;
            }

            // A malformed legacy record must not take down the complete feed.
            function renderPostCardSafely(post, commentMap, likeMap, likeUserMap) {
                try {
                    return renderPostCard(post, commentMap, likeMap, likeUserMap);
                } catch (error) {
                    console.error('[feed-render] failed post:', {
                        postId: post && post.id,
                        userName: post && post.user_name,
                        error: error
                    });
                    return '';
                }
            }

            function hydrateCachedAvatarsForUsers(usernames) {
                var users = Array.from(new Set((usernames || []).map(function(value) {
                    return String(value || '').trim();
                }).filter(Boolean)));
                if (!users.length) return;
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    users.forEach(function(userName) {
                        if (!avatarCache[userName] && cachedAvatars[userName]) avatarCache[userName] = cachedAvatars[userName];
                    });
                } catch (e) {}
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
                feedPage = 1;
                feedEndReached = false;
                feedLoadMoreFailed = false;
                var errEl = document.getElementById('feedLoadMoreError');
                if (errEl && errEl.parentNode) errEl.parentNode.removeChild(errEl);
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
                feedPage = 1;
                feedEndReached = false;
                feedLoadMoreFailed = false;
                try {
                    var clearErr = document.getElementById('feedLoadMoreError');
                    if (clearErr && clearErr.parentNode) clearErr.parentNode.removeChild(clearErr);
                } catch (_eClr) {}
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
                    if (eventName === "input") {
                        // ★ 修复：搜索输入防抖 300ms，避免每次击键全量重建 feed DOM
                        var debounceTimer = null;
                        el.addEventListener(eventName, function() {
                            if (debounceTimer) clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(function() {
                                debounceTimer = null;
                                window.applyPostFilters();
                            }, 300);
                        });
                    } else {
                        el.addEventListener(eventName, function() {
                            window.applyPostFilters();
                        });
                    }
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
                            !isSystemPost(post);
                    }).map(toLightweightFeedPost);
                    var cacheComments = (feedAllComments || []).filter(function(comment) {
                        return comment && firstPageIds.has(String(comment.post_id || ''));
                    });
                    var cacheLikes = (feedAllLikes || []).filter(function(like) {
                        return like && firstPageIds.has(String(like.post_id || ''));
                    });
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        version: 7,
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
                var posts = normalizePosts(data.posts || []).filter(function(post) {
                    return !(typeof isSystemPost === 'function' && isSystemPost(post));
                });
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
                    version: parsed.version || 7, // 必须与 CACHE_KEY v7 一致，旧缓存自动以新版本重写
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
                query = query
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
                    .neq("media_type", "__post_view__")
                    .neq("media_type", "__ann__")
                    .neq("media_type", "__ann_read__")
                    .neq("media_type", "__vip__")
                    .neq("media_type", "__vip_order__")
                    .neq("media_type", "__vip_plan__")
                    .neq("media_type", "__user_style__")
                    .neq("media_type", "__pro_gift__")
                    .neq("media_type", "__pro_gift_claim__")
                    .neq("media_type", "__login_event__")
                    .neq("media_type", "__user_behavior__")
                    .neq("media_type", "__security_alert__")
                    .neq("media_type", "__admin_audit__")
                    .neq("media_type", "__client_error__")
                    .neq("media_type", "__email_sent__")
                    .neq("media_type", "__email_recipient_history__")
                    .neq("media_type", "__ai_agent_profile__")
                    .neq("media_type", "__ai_agent_msg__")
                    .neq("media_type", "__ai_agent_memory__")
                    .neq("media_type", "__ai_agent_config__")
                    .neq("media_type", "**ai_agent_memory_box**")
                    .neq("media_type", "**ai_agent_conv_summary**")
                    .neq("media_type", "**ai_agent_memory_log**")
                    .neq("media_type", "__refresh_token__")
                    .neq("media_type", "__revoked_token__")
                    .neq("media_type", "__ai_english_learning__")  // 退役模块，保留过滤防止旧数据泄漏
                    .neq("media_type", "__location_task__");
                // 回退查询显式加可见性 fortify：公开帖 + 本人私密帖（不单依赖 RLS）
                try {
                    var me = String(window.currentUser || '').trim();
                    if (typeof query.or === 'function') {
                        if (me) {
                            var safeMe = me.replace(/[,.()]/g, '');
                            query = query.or('visibility.is.null,visibility.eq.public,and(visibility.eq.private,user_name.eq.' + safeMe + ')');
                        } else {
                            query = query.or('visibility.is.null,visibility.eq.public');
                        }
                    }
                } catch (_visErr) {}
                return query;
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
                    "__attack__", "__user_visit__", "__post_view__", "__ann__", "__ann_read__",
                    "__vip__", "__vip_order__", "__vip_plan__", "__user_style__",
                    "__pro_gift__", "__pro_gift_claim__",
                    "__login_event__", "__user_behavior__", "__security_alert__", "__admin_audit__", "__client_error__",
                    "__email_sent__", "__email_recipient_history__",
                    "__refresh_token__", "__revoked_token__",
                    "__ai_agent_profile__", "__ai_agent_msg__", "__ai_agent_memory__", "__ai_agent_config__",
                    "**ai_agent_memory_box**", "**ai_agent_conv_summary**", "**ai_agent_memory_log**",
                    "__location_task__",
                    "__ai_english_learning__"  // 退役模块，保留过滤防止旧数据泄漏
                ];
                return SYSTEM_MARKERS.indexOf(mt) >= 0;
            }
            window.isSystemPost = isSystemPost;

            function getFeedBasePostQuery() {
                if (!sb) {
                    return {
                        range: function() { return Promise.resolve({ data: [], error: null }); }
                    };
                }
                return applyVisiblePostQueryFilters(
                    sb.from("posts").select("*")
                ).order("created_at", { ascending: false });
            }

            async function fetchFeedPageChunk(offset, requestId, deferRelated) {
                var start = Math.max(0, Number(offset) || 0);
                var page = Math.floor(start / FEED_PAGE_SIZE);
                var posts = [];
                var comments = [];
                var likes = [];
                var endReached = false;
                var usedApi = false;
                // ★ 修复：记录服务端返回的"下一页起始绝对偏移"（已含页宽），
                // 仅 API/early 路径设置；start 保持为本次请求的起始偏移，不再被改写。
                var serverNextOffset = null;
                var FEED_NET_TIMEOUT_MS = 18000;
                var withTimeout = (typeof window.xtjWithTimeout === 'function')
                    ? window.xtjWithTimeout
                    : function(p) { return p; };

                // 优先使用后端 API（支持私密帖子可见性过滤）
                // 公开首屏：裸 fetch + 硬超时，避免登录态 refresh / optionalAuth 路径拖死 skeleton
                try {
                    // 复用 early-feed.js 已发起的首屏请求，避免重复等待
                    if (page === 0 && !usedApi && window.__xtjEarlyFeed && window.__xtjEarlyFeed.status === 'ok' && window.__xtjEarlyFeed.data) {
                        var early = window.__xtjEarlyFeed.data;
                        posts = normalizePosts(early.posts || []);
                        comments = early.comments || [];
                        likes = early.likes || [];
                        endReached = early.endReached || false;
                        if (typeof early.total_post_count === 'number') window._xtjTotalPostCount = early.total_post_count;
                        serverNextOffset = early.next_offset != null ? Number(early.next_offset) : null;
                        usedApi = true;
                    } else if (page === 0 && !usedApi && window.__xtjEarlyFeedPromise) {
                        try {
                            var early2 = await (typeof window.xtjWithTimeout === 'function'
                                ? window.xtjWithTimeout(window.__xtjEarlyFeedPromise, Math.min(FEED_NET_TIMEOUT_MS, 12000), 'early-feed')
                                : window.__xtjEarlyFeedPromise);
                            if (early2 && early2.ok) {
                                posts = normalizePosts(early2.posts || []);
                                comments = early2.comments || [];
                                likes = early2.likes || [];
                                endReached = early2.endReached || false;
                                if (typeof early2.total_post_count === 'number') window._xtjTotalPostCount = early2.total_post_count;
                                serverNextOffset = early2.next_offset != null ? Number(early2.next_offset) : null;
                                usedApi = true;
                            }
                        } catch (earlyErr) {
                            console.warn('[feed] early-feed unavailable:', earlyErr && earlyErr.message);
                        }
                    }
                    var feedPath = '/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE;
                    var apiResp = null;
                    if (!usedApi) {
                    var knownUser = '';
                    try {
                        knownUser = String((typeof currentUser === 'string' ? currentUser : '') || (window.safeStorage && window.safeStorage.get('xtj_user')) || '').trim();
                    } catch (eUser) { knownUser = ''; }
                    var hasToken = false;
                    try { hasToken = !!(typeof getUserToken === 'function' && getUserToken()); } catch (eTok) { hasToken = false; }

                    if (!knownUser && !hasToken) {
                        var feedUrl = (window.API_BASE || (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin || '').replace(/\/$/, '') + feedPath;
                        var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch(feedUrl, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }, FEED_NET_TIMEOUT_MS);
                    } else if (typeof window.xtjOptionalAuthFetch === 'function') {
                        apiResp = await window.xtjOptionalAuthFetch(feedPath, { timeoutMs: FEED_NET_TIMEOUT_MS });
                    } else {
                        var feedUrl2 = (window.API_BASE || window.location.origin || '').replace(/\/$/, '') + feedPath;
                        var doFetch2 = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch2(feedUrl2, { method: 'GET', credentials: 'include' }, FEED_NET_TIMEOUT_MS);
                    }

                    if (apiResp && apiResp.ok) {
                        var apiData = await apiResp.json();
                        if (apiData && apiData.ok) {
                            posts = normalizePosts(apiData.posts || []);
                            comments = apiData.comments || [];
                            likes = apiData.likes || [];
                            endReached = apiData.endReached || false;
                            if (typeof apiData.total_post_count === 'number') window._xtjTotalPostCount = apiData.total_post_count;
                            // 使用服务器返回的 next_offset，不自行计算、不再叠加 posts.length
                            serverNextOffset = apiData.next_offset != null ? Number(apiData.next_offset) : null;
                            usedApi = true;
                        }
                    }
                    }
                } catch (apiErr) {
                    console.warn('[feed] API unavailable, fallback to Supabase:', apiErr && apiErr.message);
                }

                if (!usedApi) {
                    // 回退：Supabase 直连（RLS 仅返回公开帖子）
                    // VPN 下 supabase.co 也可能半开连接，必须有硬超时，否则永久转圈
                    var end = start + FEED_PAGE_SIZE - 1;
                    var postRes = await withTimeout(
                        getFeedBasePostQuery().range(start, end),
                        FEED_NET_TIMEOUT_MS,
                        'feed-supabase'
                    );
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (postRes.error) throw postRes.error;
                    posts = normalizePosts(postRes.data || []);
                    endReached = posts.length < FEED_PAGE_SIZE;
                    try {
                        var countRes = await withTimeout(
                            applyVisiblePostQueryFilters(sb.from('posts').select('id', { count: 'exact', head: true })),
                            Math.min(FEED_NET_TIMEOUT_MS, 8000),
                            'feed-count'
                        );
                        if (countRes.count !== null) window._xtjTotalPostCount = countRes.count;
                    } catch(e) {}
                }

                // ★ 修复：计算下一次请求的起始偏移。
                // 服务端 next_offset 已是"下一页起始绝对偏移"，直接作为下一次请求起点；
                // 为 null/0/不大于当前起点（无前进）时视为已到末尾，停止加载，避免死循环/丢页。
                var computedNextOffset;
                if (usedApi && typeof serverNextOffset === 'number' && serverNextOffset > start) {
                    computedNextOffset = serverNextOffset;
                } else if (usedApi) {
                    endReached = true;
                    computedNextOffset = null;
                } else {
                    // Supabase 回退：无服务端游标，按实际拉取条数推进
                    computedNextOffset = start + posts.length;
                    if (!posts.length) endReached = true;
                }

                if (requestId && requestId !== feedLoadRequestId) return null;
                var postIds = posts.map(function(post) { return String(post.id); }).filter(Boolean);
                var relatedPromise = null;

                if (postIds.length && !usedApi) {
                    // 仅 Supabase 直连时需要单独获取评论和点赞
                    if (!sb) {
                        relatedPromise = Promise.resolve([ { data: [], error: null }, { data: [], error: null } ]);
                    } else {
                        relatedPromise = Promise.all([
                            sb.from("comments").select("*").in("post_id", postIds).order("created_at"),
                            sb.from("likes").select("*").in("post_id", postIds)
                        ]);
                    }
                    if (deferRelated) {
                        return {
                            offset: start,
                            posts: posts,
                            comments: comments,
                            likes: likes,
                            nextOffset: computedNextOffset,
                            endReached: endReached,
                            postIds: postIds,
                            relatedPromise: relatedPromise
                        };
                    }
                    var related = await relatedPromise;
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
                    nextOffset: computedNextOffset,
                    endReached: endReached,
                    postIds: postIds
                };
            }

            function hydrateDeferredFeedRelations(chunk, requestId) {
                if (!chunk || !chunk.relatedPromise) return Promise.resolve(false);
                return chunk.relatedPromise.then(function(related) {
                    if (requestId !== feedLoadRequestId) return false;
                    if (related[0].error || related[1].error) {
                        throw (related[0].error || related[1].error);
                    }
                    mergeFeedPageIntoState({
                        offset: chunk.offset,
                        posts: [],
                        comments: related[0].data || [],
                        likes: related[1].data || [],
                        nextOffset: chunk.nextOffset,
                        endReached: chunk.endReached,
                        postIds: chunk.postIds
                    });
                    writeFeedCacheSnapshot();
                    return renderFeedFromMemoryState().then(function() { return true; });
                }).catch(function(error) {
                    console.warn('[feed] engagement hydration failed:', error);
                    return false;
                });
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
                // ★ 修复：nextOffset 为 null/0/缺失时视为已到末尾，禁止退化为 0 无限重拉 page0
                if (chunk.nextOffset == null || chunk.nextOffset <= 0) {
                    feedEndReached = true;
                } else {
                    feedNextOffset = Math.max(feedNextOffset || 0, chunk.nextOffset);
                }
                if (chunk.endReached) feedEndReached = true;
                (chunk.posts || []).forEach(syncPostInfoCache);
                markFeedStateChanged();
            }

            function hasActiveFeedFilters() {
                var state = getPostSearchState();
                return !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
            }

            // ★ 修复：单轮最多拉 3 页 + 2s 节流，避免筛选开启且匹配不足时哨兵
            // 反复进视口触发整批重拉，撞 /api/feed 限流。
            var FEED_COVERAGE_MAX_PAGES_PER_RUN = 3;
            var FEED_COVERAGE_THROTTLE_MS = 2000;
            var _feedCoverageLastFetchAt = 0;

            async function ensureFeedCoverageForVisibleSlice(minVisiblePosts, requestId) {
                var target = Math.max(Number(minVisiblePosts) || 0, FEED_PAGE_SIZE);
                var filteredPosts = getFilteredPosts(feedAllPosts || [], feedAllComments || []);
                if (filteredPosts.length >= target) return true;
                var now = Date.now();
                if (_feedCoverageLastFetchAt && now - _feedCoverageLastFetchAt < FEED_COVERAGE_THROTTLE_MS) return true;
                var guard = 0;
                while (!feedEndReached && guard < FEED_COVERAGE_MAX_PAGES_PER_RUN) {
                    filteredPosts = getFilteredPosts(feedAllPosts || [], feedAllComments || []);
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
                _feedCoverageLastFetchAt = Date.now();
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
                // Phase 3-P0-5: Feed 重渲染后恢复持久化的 retryable 状态，
                // 避免评论重渲染导致小猫 AI 重试按钮丢失。
                try { if (typeof restoreCatAiRetryableStatuses === 'function') restoreCatAiRetryableStatuses(); } catch(e) {}
            }

            async function rebuildFeedFromCurrentState() {
                feedPage = 1;
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

            function pinMotionReduced() {
                return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            }

            function getActualScrollSurface(startNode) {
                var current = startNode || document.getElementById('feed');
                while (current && current !== document.body && current !== document.documentElement) {
                    if (current.scrollHeight > current.clientHeight) {
                        var style = window.getComputedStyle(current);
                        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return current;
                    }
                    current = current.parentElement;
                }
                
                var se = document.scrollingElement || document.documentElement;
                if (se && se.scrollHeight > se.clientHeight) {
                    var seStyle = window.getComputedStyle(se);
                    if (seStyle.overflowY !== 'hidden' && seStyle.overflowY !== 'clip') {
                        return window;
                    }
                }
                return window;
            }

            function waitForPinScroll(surface, targetTop, timeoutMs) {
                return new Promise(function(resolve) {
                    var actualSurface = getActualScrollSurface(surface);
                    if (!actualSurface || pinMotionReduced()) return resolve();
                    
                    var getScroll = function() { return actualSurface === window ? window.scrollY : actualSurface.scrollTop; };
                    if (Math.abs(getScroll() - targetTop) <= 2) return resolve();
                    
                    var isResolved = false;
                    var timeoutId;
                    
                    function finish() {
                        if (isResolved) return;
                        isResolved = true;
                        clearTimeout(timeoutId);
                        actualSurface.removeEventListener('scrollend', onScrollEnd);
                        resolve();
                    }
                    
                    function onScrollEnd() {
                        if (Math.abs(getScroll() - targetTop) <= 2) finish();
                    }
                    
                    actualSurface.addEventListener('scrollend', onScrollEnd);
                    timeoutId = setTimeout(finish, timeoutMs);
                });
            }

            function getPinnedPostScrollTarget(surface) {
                var feed = document.getElementById('feed');
                if (!feed) return 0;
                var actualSurface = getActualScrollSurface(surface);
                var feedRect = feed.getBoundingClientRect();
                var nav = document.querySelector('.posts-nav.sticky-header') || (surface ? surface.querySelector('.posts-nav') : null);
                var navRect = nav ? nav.getBoundingClientRect() : null;
                
                if (actualSurface === window) {
                    var navHeight = navRect && navRect.bottom > 0 ? Math.max(0, navRect.height) : 0;
                    return Math.max(0, Math.round(window.scrollY + feedRect.top - navHeight - 12));
                } else {
                    var surfaceRect = actualSurface.getBoundingClientRect();
                    var navHeight = navRect && navRect.bottom > surfaceRect.top ? Math.max(0, navRect.height) : 0;
                    return Math.max(0, Math.round(actualSurface.scrollTop + feedRect.top - surfaceRect.top - navHeight - 12));
                }
            }

            async function beginPinnedPostTransition(postEl) {
                var surface = document.getElementById('panelPosts');
                if (postEl && postEl.isConnected && !pinMotionReduced()) {
                    postEl.classList.add('post-pin-departing');
                }
                var actualSurface = getActualScrollSurface(surface);
                var targetTop = getPinnedPostScrollTarget(surface);
                if (pinMotionReduced()) {
                    actualSurface.scrollTo(0, targetTop);
                    return;
                }
                actualSurface.scrollTo({ top: targetTop, behavior: 'smooth' });
                await Promise.all([
                    new Promise(function(resolve) { setTimeout(resolve, 320); }),
                    waitForPinScroll(surface, targetTop, 620)
                ]);
            }

            function completePinnedPostTransition(postId) {
                var selector = '.post[data-post-id="' + String(postId).replace(/"/g, '\\"') + '"]';
                var postEl = document.querySelector(selector);
                var surface = document.getElementById('panelPosts');
                if (!postEl) return Promise.resolve(false);
                var actualSurface = getActualScrollSurface(surface);
                actualSurface.scrollTo(0, getPinnedPostScrollTarget(surface));
                if (pinMotionReduced()) return Promise.resolve(true);
                return new Promise(function(resolve) {
                    var completed = false;
                    var finish = function() {
                        if (completed) return;
                        completed = true;
                        postEl.classList.remove('post-pin-arriving');
                        postEl.removeEventListener('animationend', onAnimationEnd);
                        resolve(true);
                    };
                    var onAnimationEnd = function(event) {
                        if (event.target === postEl && event.animationName === 'xtj-pin-arrive') finish();
                    };
                    postEl.classList.remove('post-pin-arriving');
                    void postEl.offsetWidth;
                    postEl.addEventListener('animationend', onAnimationEnd);
                    postEl.classList.add('post-pin-arriving');
                    setTimeout(finish, 760);
                });
            }


            // Final pin action: server-side RPC enforces one pinned post per author.
            window.isPinningPost = false;
            window.togglePostPin = async function(postId, btn) {
                if (!postId) return;
                var normalizedPostId = String(postId || '').trim().toLowerCase();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedPostId)) {
                    showToast('置顶失败：帖子参数无效');
                    return;
                }
                
                if (window.isPinningPost) return;
                window.isPinningPost = true;
                
                var originalText = btn ? btn.textContent : '';
                var nextPinned = false;
                var didSucceed = false;
                var serverSucceeded = false;
                var authoritativePinnedState = null;
                try {
                    if (btn) { btn.disabled = true; btn.textContent = '...'; }
                    var auth = typeof window.ensureProtectedOperationAuth === 'function'
                        ? await window.ensureProtectedOperationAuth()
                        : { ok: !!(typeof window.getUserAuthHeaders === 'function' && await window.getUserAuthHeaders()) };
                    if (!auth.ok) {
                        if (auth.reason !== 'expired' && auth.reason !== 'no_user') {
                            showToast('认证服务暂时不可用，请稍后重试');
                        }
                        return;
                    }

                    var currentPost = normalizePosts(feedAllPosts).find(function(item) {
                        return String(item.id).toLowerCase() === normalizedPostId;
                    });
                    
                    // Allow pinning even if not in feedAllPosts (e.g. detail view)
                    var isOwner = currentPost && String(currentUser || '').toLowerCase() === String(currentPost.user_name || '').toLowerCase();
                    if (currentPost && !isOwner && currentUser !== ADMIN_NAME) {
                        showToast('无权置顶此帖子');
                        return;
                    }
                    var isCurrentlyPinned = currentPost ? !!currentPost.is_pinned : (btn && (btn.getAttribute('data-pinned') === 'true' || originalText.indexOf('取消') !== -1));
                    nextPinned = !isCurrentlyPinned;
                    
                    var response = await window.xtjProtectedFetch('/api/post/pin', {
                        method: 'POST',
                        body: JSON.stringify({ post_id: normalizedPostId, is_pinned: Boolean(nextPinned) })
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (response.status === 401) {
                        return;
                    }
                    if (result.code === 'pin_migration_required') {
                        throw new Error('置顶服务尚未完成数据库升级，请部署迁移 008_atomic_post_pin.sql');
                    }
                    if (!response.ok || !result.ok || !result.data) throw new Error(result.error || '置顶操作失败');
                    serverSucceeded = true;
                    authoritativePinnedState = result.data.is_pinned;

                    (Array.isArray(result.unpinned_post_ids) ? result.unpinned_post_ids : []).forEach(function(id) {
                        syncPinnedPostIntoFeedState({ id: id, is_pinned: false, pinned_at: null });
                    });
                    
                    var postEl = document.querySelector('.post[data-post-id="' + normalizedPostId + '"]');
                    var willAnimatePin = nextPinned;
                    if (willAnimatePin) await beginPinnedPostTransition(postEl);

                    if (!syncPinnedPostIntoFeedState(result.data)) {
                        clearFeedCache();
                        await loadFeed(true);
                    } else {
                        writeFeedCacheSnapshot();
                        await rebuildFeedFromCurrentState();
                    }
                    await refreshPostDetailIfActive(normalizedPostId);
                    if (willAnimatePin) await completePinnedPostTransition(normalizedPostId);
                    didSucceed = true;
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                } catch (e) {
                    if (serverSucceeded) {
                        console.error('[pin] render failed after server success', e);
                        showToast('置顶已更新，正在尝试恢复界面同步');
                        clearFeedCache();
                        loadFeed(true).catch(function(err){ console.error('loadFeed failed in catch', err); });
                        refreshPostDetailIfActive(normalizedPostId).catch(function(err){ console.error('refreshPostDetailIfActive failed in catch', err); });
                    } else {
                        console.error('[pin] atomic update failed', e);
                        showToast('置顶失败：' + (e && e.message ? e.message : '未知错误'));
                    }
                } finally {
                    var postEl = document.querySelector('.post[data-post-id="' + normalizedPostId + '"]');
                    if (postEl) postEl.classList.remove('post-pin-departing');
                    if (btn) {
                        btn.disabled = false;
                        if (authoritativePinnedState !== null) {
                            btn.textContent = authoritativePinnedState ? '取消置顶' : '置顶';
                            btn.setAttribute('data-pinned', authoritativePinnedState ? 'true' : 'false');
                        } else {
                            btn.textContent = didSucceed ? (nextPinned ? '取消置顶' : '置顶') : (originalText || '置顶');
                        }
                    }
                    window.isPinningPost = false;
                }
            };

            // G10 修复：可见性切换并发锁（与 togglePostPin 的 isPinningPost 对齐），
            // 防止双击基于同一旧 visibility 发两次更新 + 两次整页刷新
            window.isTogglingPostVisibility = false;
            window.togglePostVisibility = async function(postId, btn) {
                if (window.isTogglingPostVisibility) return;
                var post;
                var nextVisibility;
                // ★ 修复：失败分支已设置失败文案，若 finally 仍无条件重置为成功态文案
                // 会覆盖"操作失败/操作异常"的提示；handled 置位后 finally 不再重置。
                var handled = false;
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
                    window.isTogglingPostVisibility = true;
                    nextVisibility = post.visibility === "private" ? "public" : "private";
                    var result = await updatePostRecord(post, {
                        visibility: nextVisibility
                    });
                    if (!result.ok) {
                        handled = true;
                        if (btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "🔒 设为私密" : "🌐 设为公开"; }
                        showToast("操作失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    showToast(nextVisibility === "private" ? "已设为私密" : "已设为公开");
                    await loadFeed(true);
                } catch (e) {
                    handled = true;
                    console.error("togglePostVisibility error:", e);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = "🔒 设为私密";
                    }
                    showToast("操作异常: " + (e && e.message ? e.message : "未知错误，请查看控制台"));
                } finally {
                    window.isTogglingPostVisibility = false;
                    if (!handled && btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "🌐 设为公开" : "🔒 设为私密"; }
                }
            };
            // ============== Global click delegation ==============
            document.addEventListener('click', function(e) {
                var postToolTrigger = e.target.closest('.post-tools-trigger');
                if (postToolTrigger) {
                    e.preventDefault();
                    openPostToolsMenu(postToolTrigger);
                    return;
                }
                var postToolAction = e.target.closest('[data-post-tool]');
                if (postToolAction) {
                    e.preventDefault();
                    if (!window.currentUser) { showToast('请先登录'); return; }
                    var postTool = postToolAction.getAttribute('data-post-tool');
                    var postToolPostId = postToolAction.getAttribute('data-post-id');
                    closePostToolsMenu();
                    if (postTool === 'translate' && typeof window.requestPostTranslation === 'function') {
                        window.requestPostTranslation(postToolPostId);
                    } else if (postTool === 'ask-ai' && typeof window.openPostAiChat === 'function') {
                        window.openPostAiChat(postToolPostId);
                    } else if (postTool === 'report' && typeof window.openPostReport === 'function') {
                        window.openPostReport(postToolPostId);
                    }
                    return;
                }
                if (activePostToolsMenu && !e.target.closest('.post-tools-menu')) closePostToolsMenu();
                // Pin button: delegate only (no inline onclick)
                var pinBtn = e.target.closest('.action-btn.pin');
                if (pinBtn) {
                    if (pinBtn.disabled) { return; }
                    var pid = pinBtn.getAttribute('data-post-id');
                    if (!pid) { return; }
                    window.togglePostPin(pid, pinBtn);
                    return;
                }
            });
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closePostToolsMenu();
            });
            // ── 帖子位置功能 ──
            var postLocationData = null;
            var postLocationRequesting = false;

            window.requestPostLocation = function() {
                if (postLocationRequesting) return;
                var btn = document.getElementById('postLocationAddBtn');
                if (!btn) return;
                if (!navigator.geolocation) {
                    showToast('您的浏览器不支持定位功能');
                    return;
                }
                postLocationRequesting = true;
                btn.disabled = true;
                btn.textContent = '正在获取位置...';
                function requestPostLocationFix(options, onError) {
                    navigator.geolocation.getCurrentPosition(function(position) {
                        reverseGeocodePostLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
                    }, onError, options);
                }
                function finishLocationRequest(error) {
                    postLocationRequesting = false;
                    btn.disabled = false;
                    btn.textContent = '添加位置';
                    showToast(error && error.code === 1 ? '位置权限被拒绝，请在浏览器设置中允许定位' : '定位失败，请重试');
                }
                requestPostLocationFix({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, function(error) {
                    if (error && error.code !== 1) {
                        // A timeout or unavailable GPS fix gets one bounded fallback request.
                        btn.textContent = '正在尝试备用定位...';
                        requestPostLocationFix({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }, function(fallbackError) {
                            postLocationRequesting = false;
                            btn.disabled = false;
                            btn.textContent = '📍 添加位置';
                            showToast('定位失败，请重试');
                        });
                        return;
                    }
                    finishLocationRequest(error);
                    return;
                });
            };

            async function reverseGeocodePostLocation(lat, lng, accuracy) {
                var btn = document.getElementById('postLocationAddBtn');
                try {
                    var resp = await window.xtjProtectedFetch('/api/location/reverse', {
                        method: 'POST',
                        body: JSON.stringify({ latitude: lat, longitude: lng, accuracy: Number(accuracy) || null })
                    });
                    var data = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !data.ok) {
                        showToast('地址解析失败: ' + (data.error || '请重试'));
                        postLocationRequesting = false;
                        if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
                        return;
                    }
                    data.accuracy = Number(accuracy) || null;
                    showPostLocationOptions(data);
                } catch (e) {
                    showToast('地址解析失败，请检查网络');
                    postLocationRequesting = false;
                    if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
                }
            }

            function showPostLocationOptions(geoData) {
                var panel = document.getElementById('postLocationPanel');
                var optionsEl = document.getElementById('postLocationOptions');
                if (!panel || !optionsEl) return;
                optionsEl.innerHTML = '';
                var options = geoData.options || [];
                if (options.length === 0) {
                    if (geoData.province && geoData.city) {
                        options.push({ level: 'city', name: geoData.province + geoData.city, province: geoData.province, city: geoData.city });
                    }
                    if (geoData.city && geoData.district) {
                        options.push({ level: 'district', name: geoData.city + geoData.district, province: geoData.province, city: geoData.city, district: geoData.district });
                    }
                }
                for (var i = 0; i < options.length; i++) {
                    var opt = options[i];
                    var optEl = document.createElement('div');
                    optEl.className = 'post-location-option';
                    optEl.textContent = opt.name;
                    optEl.setAttribute('role', 'button');
                    optEl.setAttribute('tabindex', '0');
                    (function(option) {
                        optEl.addEventListener('click', function() { selectPostLocationOption(option); });
                        optEl.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPostLocationOption(option); }
                        });
                    })(opt);
                    optionsEl.appendChild(optEl);
                }
                panel.style.display = 'block';
                var addRow = document.getElementById('postLocationAddRow');
                if (addRow) addRow.style.display = 'none';
                postLocationRequesting = false;
                var btn = document.getElementById('postLocationAddBtn');
                if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
            }

            window.selectPostLocationOption = function(option) {
                var panel = document.getElementById('postLocationPanel');
                var addRow = document.getElementById('postLocationAddRow');
                var preview = document.getElementById('postLocationPreview');
                var nameEl = document.getElementById('postLocationName');
                if (panel) panel.style.display = 'none';
                if (option && option.name) {
                    postLocationData = {
                        name: option.name,
                        province: option.province || '',
                        city: option.city || '',
                        district: option.district || '',
                        level: option.level || ''
                    };
                    if (nameEl) nameEl.textContent = option.name;
                    if (preview) preview.style.display = 'flex';
                    if (addRow) addRow.style.display = 'none';
                } else {
                    postLocationData = null;
                    if (preview) preview.style.display = 'none';
                    if (addRow) addRow.style.display = 'block';
                }
            };

            window.removePostLocation = function() {
                postLocationData = null;
                var preview = document.getElementById('postLocationPreview');
                var addRow = document.getElementById('postLocationAddRow');
                if (preview) preview.style.display = 'none';
                if (addRow) addRow.style.display = 'block';
            };

            function resetPostLocation() {
                postLocationData = null;
                postLocationRequesting = false;
                var panel = document.getElementById('postLocationPanel');
                var preview = document.getElementById('postLocationPreview');
                var addRow = document.getElementById('postLocationAddRow');
                var btn = document.getElementById('postLocationAddBtn');
                if (panel) panel.style.display = 'none';
                if (preview) preview.style.display = 'none';
                if (addRow) addRow.style.display = 'block';
                if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
            }

            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var btn = document.getElementById("pubBtn");
                if (!btn || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
                if (isUserMuted()) { showToast("您已被禁言，无法发布内容"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
                var maxFileSize = 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过50MB"); return; }
                if (file) {
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = allowedTypes.some(function(t) { return file.type.startsWith(t); });
                    if (!typeOk) { showToast("不支持的文件类型，仅支持图片、视频、音频"); return; }
                }
                btn.disabled = true;
                btn.classList.add('is-loading');
                btn.setAttribute('aria-busy', 'true');
                btn.dataset.originalText = btn.textContent;
                btn.innerHTML = '<span>发布中</span>';
                var uploadedPath = '';
                try {
                    var media_url = "";
                    var media_type = "";
                    if (file) {
                        // ★ 类型黑名单：anon 直传 Storage 拒绝可执行/脚本类文件（svg/svgz/html/xml/swf）
                        var blockedUpload = /\.(svgz?|html?|xml|swf)$/i.test(String(file && file.name || '')) || /^image\/svg\+xml/i.test(String(file && file.type || ''));
                        if (blockedUpload) throw new Error('file type not allowed');
                        var path = buildStorageUploadPath('posts', file.name);
                        var uploadRes = await sb.storage.from("uploads").upload(path, file);
                        if (uploadRes.error) throw uploadRes.error;
                        uploadedPath = path;
                        media_url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                        media_type = file.type.startsWith("image/") ? "image" : (file.type.startsWith("audio/") ? "audio" : "video");
                    }
                    var plainText = content.slice(0, 2000);
                    var metadata = collectPostMetadata ? collectPostMetadata(visibility, { location: postLocationData || null }) : { visibility: visibility || "public" };
                    var contentPayload = buildPostContentPayload(plainText, metadata);
                    var payload = {
                        user_name: currentUser,
                        content: contentPayload,
                        media_url: media_url,
                        media_type: media_type || null,
                        actor_key: deviceId,
                        visibility: metadata.visibility,
                        is_pinned: false,
                        pinned_at: null,
                        updated_at: null,
                        location: postLocationData || null
                    };
                    var insertRes = await insertPostRecord(payload, contentPayload);
                    if (!insertRes.ok) {
                        if (uploadedPath) {
                            try {
                                var cleanupResult = await sb.storage.from('uploads').remove([uploadedPath]);
                                if (cleanupResult && cleanupResult.error) console.warn('[post-publish] orphan cleanup failed', cleanupResult.error);
                            } catch (cleanupError) { console.warn('[post-publish] orphan cleanup failed', cleanupError); }
                            uploadedPath = '';
                        }
                        showToast("发布失败: " + ((insertRes.error && insertRes.error.message) || "未知错误"));
                        return;
                    }
                    uploadedPath = '';
                    touchUserSession(false);
                    resetPostComposer();
                    showToast(insertRes.fallback ? "发布成功，已兼容旧数据结构" : "发布成功");
                    if (!insertPublishedPostIntoFeed(insertRes.data)) {
                        clearFeedCache();
                        await loadFeed(true);
                    } else {
                        writeFeedCacheSnapshot();
                    }
                    if (insertRes.data && insertRes.data.id) {
                        schedulePublishedPostIpRefresh(insertRes.data.id);
                    }
                    loadProfileActivity(true);
                } catch (e) {
                    if (uploadedPath) {
                        try {
                            var catchCleanupResult = await sb.storage.from('uploads').remove([uploadedPath]);
                            if (catchCleanupResult && catchCleanupResult.error) console.warn('[post-publish] orphan cleanup failed', catchCleanupResult.error);
                        } catch (cleanupError) { console.warn('[post-publish] orphan cleanup failed', cleanupError); }
                    }
                    showToast("发布失败: " + (e.message || "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.classList.remove('is-loading');
                    btn.setAttribute('aria-busy', 'false');
                    btn.textContent = btn.dataset.originalText || "发布动态";
                    delete btn.dataset.originalText;
                    // ★ 修复：成功/失败路径统一回收 postPreviewUrls（blob:），
                    // 避免反复发帖失败时 blob URL 内存累积。幂等，重复调用安全。
                    if (typeof window.resetPostPreview === "function") window.resetPostPreview();
                }
            };

            loadFeed = async function(forceRefresh) {
                // ★ 修复：loadFeed 语义为"重新加载 feed"——所有路径（缓存快路径/
                //   成功刷新/失败回退）都重置旧式 feedPage 计数器。此前刷新后
                //   feedPage 残留旧值，加载更多按旧页码计算导致误判 feedEndReached，
                //   无限滚动永久失效（"没有更多帖子"）直至刷新页面。
                feedPage = 1;
                // 重置"加载更多失败"标志，避免 feed 重绘后哨兵永久不再触发
                feedLoadMoreFailed = false;
                try {
                    var moreErr = document.getElementById('feedLoadMoreError');
                    if (moreErr && moreErr.parentNode) moreErr.parentNode.removeChild(moreErr);
                } catch (_eMore) {}
                var now = Date.now();
                var requestId = ++feedLoadRequestId;
                var stateVersionAtRequest = feedStateVersion;
                var hadLiveFeed = Array.isArray(feedAllPosts) && feedAllPosts.length > 0;
                if (forceRefresh) {
                    // Keep the rendered feed intact until a replacement page succeeds.
                    // A transient empty response must not turn a populated page into an empty one.
                    feedPageFetchPending = false;
                    // ★ 修复：强制刷新时 early-feed 快照已过期（发帖/删除/置顶后仍复用旧快照
                    // 会拿到旧数据），标记过期并清空，强制走真实 API 重新请求。
                    try {
                        if (window.__xtjEarlyFeed) {
                            window.__xtjEarlyFeed.status = 'stale';
                            window.__xtjEarlyFeed.data = null;
                        }
                        window.__xtjEarlyFeedPromise = null;
                    } catch (_ef) {}
                }
                bindPostFilterEvents();
                if (!forceRefresh) {
                    try {
                        var cached = window.safeStorage.get(CACHE_KEY);
                        if (cached) {
                            var parsed = JSON.parse(cached);
                            if (parsed && parsed.data && now - parsed.timestamp < CACHE_DURATION && hydrateFeedStateFromSnapshot(parsed)) {
                                if (requestId !== feedLoadRequestId) return;
                                await renderFeedFromMemoryState();
                                setupFeedInfiniteScroll();
                                ensureFeedCoverageForVisibleSlice(FEED_PAGE_SIZE, requestId).then(function() {
                                    if (requestId !== feedLoadRequestId) return;
                                    return renderFeedFromMemoryState();
                                }).catch(function(error) {
                                    console.warn('[feed] cached coverage refresh failed:', error);
                                });
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
                    var chunk = await fetchFeedPageChunk(0, requestId, true);
                    if (!chunk || requestId !== feedLoadRequestId) {
                        // 竞态取消时不要把 HTML skeleton 永久留住
                        if (feed && !hadLiveFeed) {
                            var stillSkeleton = /xtj-loading-skeleton|xtj-skeleton-card|内容加载中/.test(feed.innerHTML || '');
                            if (stillSkeleton && requestId === feedLoadRequestId) {
                                feed.innerHTML = '<div class="loading feed-load-more-error" id="feedBootError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;">加载中断，点击重试</div>';
                                var bootErr = document.getElementById('feedBootError');
                                if (bootErr && !bootErr.__xtjBound) {
                                    bootErr.__xtjBound = true;
                                    bootErr.addEventListener('click', function() { loadFeed(true); });
                                }
                            }
                        }
                        return;
                    }
                    // A publish may finish while this request is in flight.
                    // Preserve current state and merge this page when that happens.
                    if (stateVersionAtRequest === feedStateVersion) {
                        if (!chunk.posts.length && hadLiveFeed) {
                            console.warn('[feed] ignored empty refresh response while posts are visible');
                            return;
                        }
                        feedAllPosts = [];
                        feedAllComments = [];
                        feedAllLikes = [];
                        feedLoadedPages = [];
                        feedNextOffset = 0;
                        feedEndReached = false;
                        markFeedStateChanged();
                    }
                    if (chunk.posts.length) mergeFeedPageIntoState(chunk);
                    else feedEndReached = true;
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
                    window.__xtjCoreFeedReady = true;
                    await renderFeedFromMemoryState();
                    setupFeedInfiniteScroll();
                    hydrateDeferredFeedRelations(chunk, requestId).then(function() {
                        if (requestId !== feedLoadRequestId) return;
                        return ensureFeedCoverageForVisibleSlice(FEED_PAGE_SIZE, requestId);
                    }).then(function() {
                        if (requestId !== feedLoadRequestId) return;
                        writeFeedCacheSnapshot();
                    }).catch(function(error) {
                        console.warn('[feed] background hydration failed:', error);
                    });
                } catch (e) {
                    console.error(e);
                    var cacheFallbackShown = false;
                    if (!hadLiveFeed && feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>';
                    try {
                        var fallbackRaw = window.safeStorage.get(CACHE_KEY);
                        if (fallbackRaw) {
                            var fallbackParsed = JSON.parse(fallbackRaw);
                            if (fallbackParsed && fallbackParsed.data && hydrateFeedStateFromSnapshot(fallbackParsed)) {
                                await renderFeedFromMemoryState();
                                setupFeedInfiniteScroll();
                                cacheFallbackShown = true;
                            }
                        }
                    } catch (fbErr) {
                        console.error('[loadFeed] cache fallback failed:', fbErr);
                    }
                    // ★ 修复：缓存回退显示时必须给用户可感知反馈（数据可能过期），
                    // 并提供点击重试入口。此前静默显示旧缓存，用户无法感知加载失败。
                    if (cacheFallbackShown && feed) {
                        var staleNotice = document.getElementById('feedStaleNotice');
                        if (!staleNotice) {
                            staleNotice = document.createElement('div');
                            staleNotice.id = 'feedStaleNotice';
                            staleNotice.className = 'loading feed-load-more-error';
                            staleNotice.setAttribute('role', 'button');
                            staleNotice.setAttribute('tabindex', '0');
                            staleNotice.textContent = '网络加载失败，当前显示缓存内容，点击重试';
                            staleNotice.addEventListener('click', function() {
                                var el = document.getElementById('feedStaleNotice');
                                if (el && el.parentNode) el.parentNode.removeChild(el);
                                loadFeed(true);
                            });
                            feed.appendChild(staleNotice);
                        }
                    }
                } finally {
                    feedPageFetchPending = false;
                }
            };
            window.loadFeed = loadFeed;

            loadMoreFeedPosts = async function() {
                if (feedEndReached || feedPageFetchPending || feedLoadMoreFailed) return;
                var feed = document.getElementById("feed");
                var pageLoading = document.createElement("div");
                pageLoading.className = "feed-page-loading";
                pageLoading.setAttribute("role", "status");
                pageLoading.setAttribute("aria-live", "polite");
                pageLoading.textContent = "正在加载更多帖子";
                var sentinel = document.getElementById("feedSentinel");
                feed.insertBefore(pageLoading, sentinel || null);
                // ★ 修复：切片起点统一以"已渲染条数"计算，不再用 feedPage（显示计数）
                // 推算。feedPage 仅作显示计数，由 applyPostFilters/clearPostFilters 重置为 1，
                // 但 feedNextOffset（服务端游标）不随之重置；若用 feedPage 推算切片，
                // 筛选开启时 filteredPosts 远小于 feedAllPosts 会提前判定"没有更多"，
                // 或 20 页后游标与切片错位导致循环不满足。是否还有更多只由 feedNextOffset/
                // feedEndReached 判定，切片长度只受当前内存过滤结果约束。
                var renderedCount = feed.querySelectorAll(".post").length;
                var startIdx = Math.max(renderedCount, 0);
                var endIdx = startIdx + FEED_PAGE_SIZE;
                var filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                var fetchFailed = false;
                if (filteredPosts.length < endIdx && !feedEndReached) {
                    try {
                        feedPageFetchPending = true;
                        // ★ 修复：ensureFeedCoverageForVisibleSlice 内部以 feedNextOffset（服务端游标）拉取，
                        // 不再依赖 feedPage 推算 offset，避免并发发帖/删除导致 offset 漂移时帖子重复或永久跳过。
                        // 拉取成功后以当前内存过滤结果重新计算切片。
                        await ensureFeedCoverageForVisibleSlice(endIdx, feedLoadRequestId);
                        writeFeedCacheSnapshot();
                    } catch (e) {
                        fetchFailed = true;
                        console.error('[feed] loadMore ensure coverage failed:', e);
                    } finally {
                        feedPageFetchPending = false;
                    }
                    filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                }
                pageLoading.remove();
                if (fetchFailed) {
                    // ★ 修复：加载更多失败必须给用户可感知反馈 + 可点击重试入口。
                    // 此前静默失败且 feedEndReached 不置位，哨兵每次进入视口都会
                    // 无限重复触发请求。失败后置位 feedLoadMoreFailed 暂停自动触发，
                    // 用户点击"重试"后清除并重新加载。
                    feedLoadMoreFailed = true;
                    var failEl = document.getElementById('feedLoadMoreError');
                    if (!failEl) {
                        failEl = document.createElement('div');
                        failEl.id = 'feedLoadMoreError';
                        failEl.className = 'loading feed-load-more-error';
                        failEl.setAttribute('role', 'button');
                        failEl.setAttribute('tabindex', '0');
                        failEl.textContent = '加载更多失败，点击重试';
                        failEl.addEventListener('click', function() {
                            feedLoadMoreFailed = false;
                            var errEl = document.getElementById('feedLoadMoreError');
                            if (errEl && errEl.parentNode) errEl.parentNode.removeChild(errEl);
                            loadMoreFeedPosts();
                        });
                        feed.appendChild(failEl);
                    }
                    return;
                }
                // ★ 修复：只有"服务端已到末尾"才置 feedEndReached 并显示"没有更多"。
                // 筛选开启时 filteredPosts 可能远小于已拉取总量（feedNextOffset 尚未到末尾），
                // 此时不能因为切片末尾超过 filteredPosts 就提前终止无限滚动——继续滚动应
                // 继续用 feedNextOffset 拉取，让更多可匹配筛选的帖子进入内存后再渲染。
                if (feedEndReached && startIdx >= filteredPosts.length) {
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
                if (startIdx < filteredPosts.length) {
                    var filteredPostIds = new Set();
                    filteredPosts.forEach(function(p) { filteredPostIds.add(String(p.id)); });
                    var scopedComments = getRenderableComments(feedAllComments, filteredPosts);
                    var scopedLikes = (feedAllLikes || []).filter(function(l) { return filteredPostIds.has(String(l.post_id)); });
                    appendMorePosts(filteredPosts.slice(startIdx, endIdx), scopedComments, scopedLikes);
                }
                feedPage++;
            };

            appendMorePosts = function(posts, comments, likes) {
                var feed = document.getElementById("feed");
                var maps = buildPostMaps(getRenderableComments(comments, posts), likes);
                var postsHtml = posts.map(function(post) {
                    return renderPostCardSafely(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
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
                if (window.__xtjRunMentionCleanups) window.__xtjRunMentionCleanups();
                var feed = document.getElementById("feed");
                var scopedComments = getRenderableComments(comments, visiblePosts);
                var maps = buildPostMaps(scopedComments, likes);
                var state = getPostSearchState();
                var hasFilters = !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
                if (visiblePosts.length) {
                    feed.innerHTML = visiblePosts.map(function(post) {
                        return renderPostCardSafely(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                    }).join("");
                } else {
                    feed.innerHTML = '<div class="loading">' + (hasFilters ? '暂无匹配的帖子' : '快去发布第一条动态吧~') + '</div>';
                }
                initPostScrollAnimation();
            };

            renderFeed = async function(payload) {
                if (window.__xtjRunMentionCleanups) window.__xtjRunMentionCleanups();
                bindPostFilterEvents();
                var filteredPosts = getFilteredPosts(payload.posts, payload.comments);
                var visibleComments = getRenderableComments(payload.comments, filteredPosts);
                var totalPosts = window._xtjTotalPostCount || filteredPosts.length;
                var sPostsEl = document.getElementById("sPosts");
                if (sPostsEl) sPostsEl.textContent = totalPosts;
                var sViewsEl = document.getElementById("sViews");
                if (sViewsEl) sViewsEl.textContent = filteredPosts.reduce(function(sum, post) { return sum + (post.views || 0); }, 0);
                var visiblePostIds = new Set();
                filteredPosts.forEach(function(p) { visiblePostIds.add(String(p.id)); });
                var scopedLikes = (payload.likes || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                var sLikesEl = document.getElementById("sLikes");
                // ★ 修复：首屏统计只显示点赞数，与 updateFeedStats（6624 行）口径一致，不再混入评论数
                if (sLikesEl) sLikesEl.textContent = scopedLikes.length;
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
                // Render local avatar cache before the first paint; remote lookup stays background-only.
                hydrateCachedAvatarsForUsers(Array.from(allUsers));
                var visibleCount = feedPage * FEED_PAGE_SIZE;
                var currentPages = filteredPosts.slice(0, Math.max(FEED_PAGE_SIZE, visibleCount));
                // 不在 renderFeed 中重置 feedPage，避免后台渲染破坏滚动状态
                // ★ 修复：不再用 `currentPages.length >= filteredPosts.length` 反向置 feedEndReached。
                // 缓存 hydrate 或帖数恰为 20 的倍数时会把 endReached 误置 true，导致无限滚动提前终止。
                // feedEndReached 只由服务端 endReached / 空 chunk / 游标越界判定。
                renderFeedWithAvatars(currentPages, visibleComments, scopedLikes);
                refreshPendingFeedIpPosts(currentPages);
                renderFilterSummary(filteredPosts.length);
                if (typeof setupFeedInfiniteScroll === 'function') setupFeedInfiniteScroll();

                loadAvatarsForUsers(Array.from(allUsers)).then(function() {
                    var feedEl = document.getElementById('feed');
                    if (!feedEl) return;
                    var avatars = feedEl.querySelectorAll('.avatar.clickable');
                    avatars.forEach(function(avatarEl) {
                        if (avatarEl.querySelector('img')) return;
                        var username = avatarEl.getAttribute('data-user-name') ||
                            avatarEl.parentElement && avatarEl.parentElement.getAttribute('data-user-name') ||
                            avatarEl.closest && avatarEl.closest('[data-user-name]') && avatarEl.closest('[data-user-name]').getAttribute('data-user-name');
                        if (!username) {
                            // 兼容旧版 onclick 解析
                            var onclick = avatarEl.getAttribute('onclick') || '';
                            username = onclick.replace(/^.*openUserProfile\('([^']*)'.*$/, '$1');
                            if (!username || username === onclick) username = '';
                        }
                        if (!username) return;
                        var avatarUrl = getAvatarUrl(username);
                        if (avatarUrl) {
                            avatarEl.innerHTML = renderAvatarContent(username, avatarUrl);
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

            // 统计预加载（使用后端快照接口，避免全量读取）

/**

/**

/**
 * core-parts/05-feed-stats.js
 * Feed render, filters, stats state (pre-chat)
 * Lines from original core.js: 8929-10043
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            // ===================== 数据统计详情功能 =====================
            // 存储统计前的基础状态
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statViewEvents = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30秒缓存

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

            // ===================== 帖子渲染函数 =====================
            let activeNotifications = [];

            function showNotification(userName, message) {
                if (!userName || !message) return;
                if (window.safeStorage.get('xtj-notif') === 'off') return;
                if (currentDockTab === 'chat' && dockChatActiveUser === userName) return;

                const container = document.getElementById('notificationContainer');
                if (!container) return;

                const bubble = document.createElement('div');
                bubble.className = 'notification-bubble';

                const safeAvatarUrl = getAvatarUrl(userName) ? sanitizeUrl(getAvatarUrl(userName)) : '';
                const avatarHtml = safeAvatarUrl ? 
                    `<img loading="lazy" decoding="async" src="${escapeHtml(safeAvatarUrl)}" alt="${escapeHtml(userName)}">` : 
                    escapeHtml(String(userName)[0] || '').toUpperCase();

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

                // 强制浏览器完成布局后再添加 show（触发 CSS transition）
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

            // ==== 测试通知：testNotification() ====
            window.testNotification = function() {
                showNotification('张三', '这是一条测试消息，检查通知文本显示是否正常');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常长的测试消息，用来检查文本截断效果到底怎么样，超过300个字符也不怕');
            };

            // ===================== 悬浮 Dock（底部导航） =====================
            let chatRealtime = null;
            let commentRealtime = null;
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
                // innerHTML serialization does NOT escape quotes in text, which
                // would break values placed inside double-quoted attributes
                // (e.g. long data: URLs used as avatar src). Escape them here.
                return _escapeDiv.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
                // 相对路径也允许（以 / 或 ./ 开头，但排除协议相对 URL //）
                if (/^\./.test(s) || (/^\//.test(s) && !/^\/\//.test(s))) return s;
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
                var userPart = '';
                try {
                    var u = String(window.currentUser || '').trim();
                    if (u) userPart = u.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_').slice(0, 32) + '_';
                } catch (_e) {}
                return String(scope || "misc") + "/" + userPart + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "_" + sanitizeStorageFileName(fileName);
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
                // P6: support audio media — previously __dm_aud__ was never parsed,
                // causing audio messages to render as plain text with no player.
                if (actorKey.indexOf('__dm_aud__') === 0) {
                    var rawAudio = actorKey.replace('__dm_aud__', '');
                    var audioSrc = /^https?:\/\//i.test(rawAudio) ? rawAudio : getMediaUrl('__dm_aud__', rawAudio);
                    return { kind: 'audio', src: audioSrc, fullSrc: audioSrc };
                }
                var text = getDMMessageText(message).trim();
                if (/^https?:\/\/\S+$/i.test(text) && !/^data:/i.test(text)) {
                    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) {
                        return { kind: 'image', src: text, fullSrc: text };
                    }
                    if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(text)) {
                        return { kind: 'video', src: text, fullSrc: text };
                    }
                    // P6: detect audio URLs in text messages
                    if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(text)) {
                        return { kind: 'audio', src: text, fullSrc: text };
                    }
                }
                return null;
            }

            function getDockChatMessagePreview(message) {
                var text = getDMMessageText(message).trim();
                if (text) return text;
                var media = resolveDockChatMedia(message);
                if (!media) return '新消息';
                // P6: support audio preview text
                if (media.kind === 'audio') return '[音频]';
                if (media.kind === 'video') return '[视频]';
                return '[图片]';
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
                return ((msg && msg.views) || 0) > 0;
            }
            // ★ 修复：导出到 window——此前仅同作用域可调用，而 9826/10652 行
            //   通过 window.isMsgReadByMe 调用必然 TypeError，DM 未读角标恒为 0。
            window.isMsgReadByMe = isMsgReadByMe;

            async function markMessagesRead(senderName, messages, pendingUpdates) {
                if (!window.currentUser || !senderName) return;
                var updates = Array.isArray(pendingUpdates) ? pendingUpdates.slice() : [];
                if (!updates.length && Array.isArray(messages)) {
                    messages.forEach(function(m) {
                        if (!m || m.user_name !== senderName || m.media_url !== window.currentUser || getDMMessageReadAt(m)) return;
                        updates.push({ id: m.id });
                    });
                }
                if (updates.length) {
                    var response = await window.xtjProtectedFetch('/api/dm/read', {
                        method: 'POST',
                        body: JSON.stringify({ message_ids: updates.map(function(update) { return update.id; }) })
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) throw new Error(result.error || 'DM read update failed');
                    var readRows = Array.isArray(result.data) ? result.data : [];
                    var readById = new Map(readRows.map(function(row) { return [String(row.id), row]; }));
                    var cacheKey = getDockChatCacheKey(senderName);
                    var cached = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                    _chatCache[cacheKey] = cached.map(function(message) {
                        var authoritative = readById.get(String(message && message.id));
                        return authoritative ? Object.assign({}, message, authoritative) : message;
                    });
                    if (dockChatActiveUser === senderName) renderDockMessages(senderName, _chatCache[cacheKey], false);
                }
                scheduleDockChatListRefresh(updates.length ? 120 : 40);
                updateUnreadBadge();
            }
            window.markMessagesRead = markMessagesRead;

            function subscribeToMessages() {
                // H-10 修复：sb 在 SUPABASE_URL/ANON_KEY 缺失时为 null，
                // 缺守卫会抛 TypeError（与 subscribeToComments 对齐）
                if (!sb) return;
                if (chatRealtime) {
                    try { sb.removeChannel(chatRealtime); } catch(e) {}
                    chatRealtime = null;
                }
                // ★ 修复：DM 订阅此前完全没有断线重连（对比 subscribeToComments），
                //   CHANNEL_ERROR/TIMED_OUT/CLOSED 后永久失去实时推送，只能靠 5 分钟轮询兜底。
                //   现与评论订阅对齐：指数退避自动重连（最多 10 次）。
                var _dmReconnectAttempts = 0;
                var _dmMaxReconnectAttempts = 10;

                function createDmChannel() {
                    chatRealtime = sb.channel('chat-dms')
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: 'media_type=eq.' + DM_MARKER }, function(payload) {
                            var m = payload.new || payload.old;
                            if (m.media_type !== DM_MARKER) return;
                            if (!window.currentUser) return;
                            if (m.user_name !== window.currentUser && m.media_url !== window.currentUser) return;
                            var otherUser = m.user_name === window.currentUser ? m.media_url : m.user_name;
                            if (payload.eventType === 'INSERT' && m.media_url === window.currentUser && m.user_name !== window.currentUser) {
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
                                // ★ 修复：正在看 A 的会话、B 发来新消息时，仅加未读数不刷新
                                //   会话列表，导致列表排序/预览/B 红点停留在旧快照。缓存已失效，
                                //   这里补一次列表刷新，回到列表页即可看到最新会话。
                                window.dockChatListCacheTime = 0;
                                loadDockChatList();
                                updateUnreadBadge();
                            }
                        })
                        .subscribe(function(status, err) {
                            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                                console.warn('[CHAT-REALTIME]', status, err);
                                if (_dmReconnectAttempts < _dmMaxReconnectAttempts) {
                                    _dmReconnectAttempts++;
                                    var backoff = Math.min(1000 * Math.pow(2, _dmReconnectAttempts), 30000);
                                    setTimeout(function() {
                                        if (chatRealtime) {
                                            try { sb.removeChannel(chatRealtime); } catch(e) {}
                                            chatRealtime = null;
                                        }
                                        createDmChannel();
                                    }, backoff);
                                }
                            } else if (status === 'SUBSCRIBED') {
                                _dmReconnectAttempts = 0;
                            } else if (err) {
                                console.error('[CHAT-REALTIME]', err);
                            }
                        });
                }
                createDmChannel();
            }

            function subscribeToComments() {
                if (!sb) return;
                // F6：订阅代次。断线 backoff 等待期间若又因可见性变化重建订阅，
                // 旧 backoff 到期不得再建通道，避免并存多个 feed-comments 通道。
                window.__commentSubEpoch = (window.__commentSubEpoch || 0) + 1;
                var mySubEpoch = window.__commentSubEpoch;
                if (commentRealtime) {
                    try { sb.removeChannel(commentRealtime); } catch(e) {}
                    commentRealtime = null;
                }
                var _reconnectAttempts = 0;
                var _maxReconnectAttempts = 10;

                function createChannel() {
                    if (mySubEpoch !== window.__commentSubEpoch) return; // 已被更新的订阅取代
                    commentRealtime = sb.channel('feed-comments')
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, function(payload) {
                            var row = payload.new || payload.old;
                            if (!row || row.id == null) return;
                            var commentId = String(row.id);
                            if (payload.eventType === 'DELETE') {
                                feedAllComments = (feedAllComments || []).filter(function(comment) {
                                    return String(comment && comment.id) !== commentId;
                                });
                                profileActivityState.comments = (profileActivityState.comments || []).filter(function(comment) {
                                    return String(comment && comment.id) !== commentId;
                                });
                                // 删除对应的 DOM 元素
                                var domEl = document.querySelector('.comment-item[data-comment-id="' + commentId + '"]');
                                if (domEl && domEl.parentNode) domEl.parentNode.removeChild(domEl);
                                // Phase 4: 取消对应的 cat AI 轮询任务
                                if (typeof cancelCatAiTask === 'function') {
                                    cancelCatAiTask(commentId, 'comment deleted via Realtime');
                                }
                            } else if (payload.eventType === 'INSERT') {
                                var postIsVisible = (feedAllPosts || []).some(function(post) {
                                    return String(post && post.id) === String(row.post_id);
                                });
                                if (!postIsVisible) return;
                                // 去重
                                feedAllComments = (feedAllComments || []).filter(function(comment) {
                                    return String(comment && comment.id) !== commentId;
                                });
                                feedAllComments.push(row);
                                // F7：先判定“是否小猫回复行”，是则无论 post_id 是否齐全都先移除进行中状态，
                                // 避免缺 post_id 时落到普通全量刷新分支、导致“正在组织”气泡残留。
                                var isCatAiReplyRow = row.generated_by_ai === true && row.user_name === 'cat_ai' && row.parent_comment_id;
                                if (isCatAiReplyRow) {
                                    removeCatAiStatus(String(row.parent_comment_id));
                                    if (row.post_id != null) {
                                        upsertAiComment(row, String(row.parent_comment_id), row.post_id);
                                    } else if (typeof renderFeedFromMemoryState === 'function') {
                                        renderFeedFromMemoryState().catch(function() {});
                                    }
                                } else {
                                    // 普通评论，全量刷新
                                    if (typeof renderFeedFromMemoryState === 'function') renderFeedFromMemoryState().catch(function() {});
                                }
                            } else if (payload.eventType === 'UPDATE') {
                                // 更新已有评论
                                feedAllComments = (feedAllComments || []).map(function(comment) {
                                    if (String(comment && comment.id) === commentId) return row;
                                    return comment;
                                });
                            }
                            if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                            if (typeof renderProfileActivity === 'function') renderProfileActivity();
                        })
                        .subscribe(function(status, err) {
                            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                                console.warn('[COMMENT-REALTIME]', status, err);
                                // 自动重连
                                if (_reconnectAttempts < _maxReconnectAttempts) {
                                    _reconnectAttempts++;
                                    var backoff = Math.min(1000 * Math.pow(2, _reconnectAttempts), 30000);
                                    setTimeout(function() {
                                        if (mySubEpoch !== window.__commentSubEpoch) return;
                                        if (commentRealtime) {
                                            try { sb.removeChannel(commentRealtime); } catch(e) {}
                                            commentRealtime = null;
                                        }
                                        createChannel();
                                    }, backoff);
                                }
                            } else if (status === 'SUBSCRIBED') {
                                _reconnectAttempts = 0;
                            }
                        });
                }
                createChannel();
            }

            // ★ 页面可见时检查并恢复实时订阅 + 恢复轮询任务
            document.addEventListener('visibilitychange', function() {
                if (!document.hidden && window.currentUser) {
                    if (!commentRealtime || commentRealtime.state === 'closed') {
                        subscribeToComments();
                    }
                    // ★ 修复：DM 实时订阅同样需要在页面恢复可见时重建，
                    //   此前只恢复评论订阅，DM 通道断开后无法自动恢复
                    if (!chatRealtime || chatRealtime.state === 'closed') {
                        subscribeToMessages();
                    }
                    // ★ 恢复所有暂停的轮询
                    // Phase 3-P0-5: 原循环体为空，页面恢复可见时未触发立即轮询。
                    // 现遍历存活的轮询任务，从 __catAiPollStatus 取出 postId 后调用
                    // pollCatAiReply 触发一次立即轮询，避免隐藏期间任务长时间停滞。
                    var timers = window.__catAiPollTimers || {};
                    var statusMap = window.__catAiPollStatus || {};
                    Object.keys(timers).forEach(function(k) {
                        try {
                            var pid = (statusMap[k] && statusMap[k].postId) || null;
                            if (pid) {
                                pollCatAiReply(k, pid, true); // F3：恢复可见时立即首查
                            }
                        } catch(e) {}
                    });
                }
            });
            window.addEventListener('online', function() {
                if (window.currentUser) {
                    if (!commentRealtime || commentRealtime.state === 'closed') {
                        subscribeToComments();
                    }
                    // ★ 修复：网络恢复时同时重建 DM 订阅
                    if (!chatRealtime || chatRealtime.state === 'closed') {
                        subscribeToMessages();
                    }
                }
            });
            window.addEventListener('pageshow', function() {
                if (window.currentUser) {
                    if (!commentRealtime || commentRealtime.state === 'closed') {
                        subscribeToComments();
                    }
                    // ★ 修复：页面重新显示时同时重建 DM 订阅
                    if (!chatRealtime || chatRealtime.state === 'closed') {
                        subscribeToMessages();
                    }
                }
            });

            function startDMPolling(interval, skipImmediate) {
                // 修复：5 分钟（300000ms）内不重复轮询
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
                if (!skipImmediate) pollNow();
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
                    // ★ 修复：口径对齐 —— loadDockChatList 用最近 180 条按会话聚合再求和，
                    // 这里原为 120 条直接逐条计数（去重 120 条），两处结果不一致导致切换 tab 时数字跳动。
                    // 现将查询上限提高到 200，并同样先按会话（media_url）聚合每条会话的未读数
                    // （封顶 99），再对所有会话求和，与 loadDockChatList 的统计口径保持一致。
                    var result = await sb.from('posts')
                        .select('id, user_name, content, views, created_at')
                        .eq('media_type', DM_MARKER)
                        .eq('media_url', window.currentUser)
                        .order('created_at', { ascending: false })
                        .limit(200);

                    var data = result.data;
                    var error = result.error;
                    if (error) return;
                    var convUnreadMap = {};
                    (data || []).forEach(function(m) {
                        var sender = m && m.user_name;
                        if (!sender) return;
                        if (window.isMsgReadByMe(m)) return;
                        convUnreadMap[sender] = Math.min((convUnreadMap[sender] || 0) + 1, 99);
                    });
                    var cnt = 0;
                    Object.keys(convUnreadMap).forEach(function(sender) {
                        cnt += convUnreadMap[sender];
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
                    if (typeof window.xtjProtectedFetch !== 'function') return;
                    var notifRes = await window.xtjProtectedFetch('/api/report/notifications');
                    if (!notifRes.ok) return;
                    var notifData = await notifRes.json().catch(function() { return {}; });
                    unread = Number(notifData.unread) || 0;
                        // 降级：本地检测旧版 admin_response（兼容旧逻辑）
                                // 检查通知数组
                                // 兼容旧版 admin_response
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

            // S8 修复：登出/会话销毁时必须停止举报轮询，避免定时器残留
            function stopReportReplyPolling() {
                if (reportReplyPollTimer) {
                    clearInterval(reportReplyPollTimer);
                    reportReplyPollTimer = null;
                }
            }

            function clearReportReplyBadge() {
                if (!window.currentUser || typeof window.xtjProtectedFetch !== 'function') return;
                window.xtjProtectedFetch('/api/report/notifications/mark-read', {
                    method: 'POST',
                    body: JSON.stringify({})
                }).then(function(response) {
                    if (!response.ok) throw new Error('report_mark_read_failed');
                window.safeStorage.set('xtj_report_reply_check', String(Date.now()));
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
                // ★ 修复：原 200ms 内后端未必完成"已读"落库，checkReportReplies
                // 会读到旧 unread>0 把刚清掉的红点又点亮（闪烁/残留）。
                // 延迟重查让后端落库完成；本地角标已即时清空。
                setTimeout(checkReportReplies, 3000);
                }).catch(function() {});
            }

            let refreshTimeout = null;
            const debouncedLoadFeed = (forceRefresh = false) => {
                if (refreshTimeout) clearTimeout(refreshTimeout);
                refreshTimeout = setTimeout(() => loadFeed(forceRefresh), 500);
            };

            // ========== Dock 底部导航 ==========
            let currentDockTab = window.safeStorage.get('xtj_current_tab') || 'posts';
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
                    if(!window._throttledDragMove) window._throttledDragMove = window.throttleRAF(onDragMove);
                    document.addEventListener('pointermove', window._throttledDragMove, {passive: false});
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
                    document.removeEventListener('pointermove', window._throttledDragMove || onDragMove);
                    document.removeEventListener('pointerup', onDragUp);
                    document.removeEventListener('pointercancel', onDragCancel);
                }

                function onDragUp(e) {
                    if (!drag) { cleanupDrag(); return; }
                    if (e.pointerId !== drag.id) return;
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
                    if (!drag) { cleanupDrag(); return; }
                    if (e.pointerId !== drag.id) return;
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

            var dockPanelTransitionTimer = null;
            var dockPanelAnimation = null;
            window.switchDockTab = function(tab, skipReturn, options) {
                options = options || {};
                // ★ 小猫AI dock 中间 tab：打开独立二级浮层(panelAiChat)，不走 dock-panel 显隐
                if (tab === 'ai-chat') {
                    document.querySelectorAll('.dock-tab').forEach(function(t) { t.classList.remove('active'); });
                    var aicBtn = document.querySelector('.dock-tab[data-tab="ai-chat"]');
                    if (aicBtn) aicBtn.classList.add('active');
                    currentDockTab = 'ai-chat';
                    window.safeStorage.set('xtj_current_tab', 'ai-chat');
                    requestAnimationFrame(syncDockIndicator);
                    var _opener = window.__xtjOpenAiChatFromDock || window.__xtjOpenAiChat;
                    if (typeof _opener === 'function') { try { _opener(); } catch (eDock) { console.warn('[dock] open ai-chat failed', eDock); } }
                    else { try { window.__xtjPendingAiChatOpen = true; } catch (ePend) {} }
                    // ★ 小猫AI 点击动画
                    if (aicBtn) {
                        if (typeof triggerTabAnimation === 'function') {
                            try { triggerTabAnimation(aicBtn, 'ai-chat'); } catch (eAnim) {}
                        } else {
                            try {
                                aicBtn.classList.remove('anim-brain'); void aicBtn.offsetWidth;
                                aicBtn.classList.add('anim-brain');
                                setTimeout(function() { aicBtn.classList.remove('anim-brain'); }, 950);
                            } catch (eAnim2) {}
                        }
                    }
                    return;
                }
                // 离开小猫AI 到其它 tab → 关闭小猫AI 浮层
                if (currentDockTab === 'ai-chat') {
                    if (typeof window.__xtjCloseAiChat === 'function') {
                        try { window.__xtjCloseAiChat(); } catch (eClose) {}
                    }
                }
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
                
                // 双击当前 tab 触发刷新（300ms 内再次点击）
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);
                
                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 双击：执行刷新
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;
                        
                        if (tab === 'ai') {
                            if (!window.currentUser) {
                                // ★ 修复：双击刷新在未登录时不再调用 renderPhotoWallLockedState()
                                // 把整个 photoGrid 替换成"登录提示"锁定页（破坏照片墙网格且无恢复入口）。
                                // 改为与单击分支一致的 ensurePhotoWallVisibleContent()（未登录时它只做
                                // 加载/兜底渲染，不替换网格），并复位刷新锁，保留网格不被破坏。
                                isRefreshing[tab] = false;
                                window.showToast('请先登录');
                                ensurePhotoWallVisibleContent().catch(function(err) {
                                    console.warn('[photo-wall] double-tap refresh visibility check failed', err);
                                });
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
                            // 帖子页刷新
                            window.showToast('正在刷新...');
                            // ★ 修复：不再先删缓存再刷新。若网络失败，用户仍可看到旧数据与重试入口；
                            // 刷新成功时 loadFeed 会写入新快照自然覆盖旧缓存。
                            if (typeof window.initialLoad === 'function') {
                                rebuildFeedFromCurrentState()
                                    .then(function() {
                                        isRefreshing[tab] = false;
                                        return syncFeedDataInBackground();
                                    }).then(function() {
                                        window.showToast('刷新完成');
                                    })
                                    .catch(function(err) {
                                        isRefreshing[tab] = false;
                                        console.error('[posts] fast refresh failed', err);
                                        window.showToast('刷新失败');
                                    });
                            }
                            // 回到顶部
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 聊天 tab 刷新逻辑
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
                            // 我的页面：回到顶部
                            const panel = document.getElementById('panelProfile');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }
                    lastTabTapTime[tab] = now;
                    return;
                }
                
                // 记录本次点击的 tab
                lastTabTapTime[tab] = now;
                lastTabTapCount[tab] = 1;
                if (currentDockTab === 'ai' && tab !== 'ai' && typeof window.cleanupPhotoWallTransientState === 'function') {
                    window.cleanupPhotoWallTransientState();
                }
                var previousPanel = document.querySelector('.dock-panel.active');
                currentDockTab = tab;
                window.safeStorage.set('xtj_current_tab', tab);
                document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
                const panel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
                if (dockPanelTransitionTimer) clearTimeout(dockPanelTransitionTimer);
                if (dockPanelAnimation) {
                    try { dockPanelAnimation.cancel(); } catch (_) {}
                    dockPanelAnimation = null;
                }
                var reduceDockMotion = false;
                try { reduceDockMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
                document.querySelectorAll('.dock-panel').forEach(function(candidate) {
                    if (candidate !== previousPanel && candidate !== panel) candidate.classList.remove('active', 'is-entering', 'is-leaving');
                });
                if (panel) {
                    if (!previousPanel || previousPanel === panel || reduceDockMotion) {
                        if (previousPanel && previousPanel !== panel) previousPanel.classList.remove('active', 'is-entering', 'is-leaving');
                        panel.classList.add('active');
                        panel.classList.remove('is-entering', 'is-leaving');
                    } else {
                        previousPanel.classList.remove('active', 'is-entering', 'is-leaving');
                        panel.classList.add('active');
                        panel.classList.remove('is-entering', 'is-leaving');
                        var animatedSurface = panel.firstElementChild || panel;
                        if (animatedSurface && typeof animatedSurface.animate === 'function') {
                            dockPanelAnimation = animatedSurface.animate([
                                { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
                                { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                            ], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
                            dockPanelAnimation.onfinish = dockPanelAnimation.oncancel = function() {
                                dockPanelAnimation = null;
                            };
                        }
                    }
                }
                const tabBtn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (tabBtn) tabBtn.classList.add('active');
                requestAnimationFrame(syncDockIndicator);
                if (tab === 'posts') { if (window._rainResume) window._rainResume(); }
                else { if (window._rainPause) window._rainPause(); }
                if (tab === 'chat') {
                    updateChatAuthUI();
                    if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {

/**
 * core-parts/06-chat-and-nav.js
 * Dock chat, switchDockTab, announcements/report mid-layer (behavior preserved)
 * Lines from original core.js: 10044-13870
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
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
                    syncDockChatLayoutState();
                    startDMPolling(300000, !!(options && options.source === 'openChat'));
                }
                if (tab === 'ai') {
                    if (!window.currentUser) {
                        // ★ 修复：未登录时不再把整个 photoGrid 替换成"登录提示"锁定页
                        // （破坏网格且登录后不自动恢复），与 05 双击刷新分支策略对齐：
                        // 仅提示登录并做可见性兜底，保留网格结构。
                        if (typeof window.showToast === 'function') window.showToast('请先登录');
                        ensurePhotoWallVisibleContent().catch(function(err) {
                            console.warn('[photo-wall] visibility check failed', err);
                        });
                    } else {
                        setPhotoWallLockedState(false);
                        ensurePhotoWallLoaded().then(function() {
                            if (typeof window.initPhotoWall !== 'function') {
                                throw new Error('photo_wall_init_missing');
                            }
                            return window.initPhotoWall();
                        }).catch(function(error) {
                            var grid = document.getElementById('photoGrid');
                            if (grid) {
                                grid.innerHTML =
                                    '<div class="photo-wall-empty">' +
                                    '<div>照片墙模块加载失败，请重试</div>' +
                                    '</div>';
                            }
                            console.error('[PhotoWall] module load failed:', error);
                        });
                        // 自动兜底：延迟 100ms 检查 photoGrid 是否仍为空
                        setTimeout(function() {
                            var grid = document.getElementById('photoGrid');
                            if (!grid || grid.children.length > 0) return;
                            if (typeof window.renderPhotoWall === 'function') {
                                window.renderPhotoWall().catch(function(e) {
                                    console.error('[PhotoWall] auto-fallback render failed:', e);
                                });
                            } else if (typeof window.initPhotoWall === 'function') {
                                window.initPhotoWall(true).catch(function(e) {
                                    console.error('[PhotoWall] auto-fallback init failed:', e);
                                });
                            }
                        }, 100);
                    }
                }
                if (tab === 'profile') { syncProfileUser(); if (currentUser) loadUserAvatar(); loadProfileActivity(false); if (typeof clearReportReplyBadge === 'function') clearReportReplyBadge(); }
            };

            // Animation class mapping
            var animClassMap = { posts: 'anim-post', chat: 'anim-chat', ai: 'anim-ai', 'ai-chat': 'anim-brain', profile: 'anim-profile' };
            // Track which buttons currently have animation playing
            var animatingTabs = {};
            // Animation durations by tab (in ms, matching CSS)
            var animDurations = { posts: 900, chat: 900, ai: 900, 'ai-chat': 900, profile: 900 };
            var dockTabAnimationTimers = {};
            var dockTabAnimationElements = {};
            var dockTabAnimationGeneration = 0;

            function clearTabAnimation(el, tab) {
                if (dockTabAnimationTimers[tab]) {
                    clearTimeout(dockTabAnimationTimers[tab]);
                    delete dockTabAnimationTimers[tab];
                }
                if (el) {
                    el.classList.remove(animClassMap[tab]);
                    var animLayer = el.querySelector('.anim-layer');
                    if (animLayer) animLayer.style.willChange = '';
                }
                delete dockTabAnimationElements[tab];
                animatingTabs[tab] = false;
            }

            function clearAllTabAnimations() {
                Object.keys(animClassMap).forEach(function(tabName) {
                    clearTabAnimation(dockTabAnimationElements[tabName], tabName);
                });
            }

            function triggerTabAnimation(el, tab) {
                var cls = animClassMap[tab];
                if (!cls) return;
                var generation = ++dockTabAnimationGeneration;
                clearAllTabAnimations();
                try {
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                } catch (_) {}
                animatingTabs[tab] = true;
                dockTabAnimationElements[tab] = el;
                requestAnimationFrame(function() {
                    if (generation !== dockTabAnimationGeneration) return;
                    var animLayer = el.querySelector('.anim-layer');
                    if (animLayer) animLayer.style.willChange = 'transform, opacity';
                    el.classList.add(cls);
                    dockTabAnimationTimers[tab] = setTimeout(function() {
                        if (generation === dockTabAnimationGeneration) {
                            clearTabAnimation(el, tab);
                        }
                    }, animDurations[tab] + 50);
                });
            }

            // 按钮点击由 HTML onclick 属性处理，不再需要 JS 委托
            installDockIndicatorDrag();
            window.addEventListener('resize', function() {
                requestAnimationFrame(syncDockIndicator);
                requestAnimationFrame(syncDockChatLayoutState);
            });
            setTimeout(function() {
                requestAnimationFrame(syncDockIndicator);
            }, 0);
            // ========== Dock 相关功能 ==========
            let dockChatActiveUser = null;
            let dockChatSending = false;
            let _dockPreviewUrl = null;

            function shouldUseDesktopChatSplitLayout() {
                var width = Math.max(
                    window.innerWidth || 0,
                    document.documentElement ? (document.documentElement.clientWidth || 0) : 0
                );
                return width >= 768;
            }

            function renderDockChatDesktopEmptyState() {
                var messages = document.getElementById('dockChatMessages');
                if (!messages || window.__xtjAiChatActive) return;
                if (!window.currentUser) {
                    messages.innerHTML = '<div class="chat-empty chat-empty-state"><div class="ce-icon">🔒</div><div>登录后可查看消息</div><div style="font-size:12px;">登录后即可查看和发送私信</div></div>';
                    return;
                }
                messages.innerHTML = '<div class="chat-empty chat-empty-state"><div class="ce-icon">💬</div><div>选择一条会话开始聊天</div><div style="font-size:12px;">左侧列表会保持可见，方便切换会话</div></div>';
            }

            function syncDockChatLayoutState() {
                if (window.__xtjAiChatActive) return;
                var listView = document.getElementById('dockChatListView');
                var detailView = document.getElementById('dockChatDetailView');
                var container = document.getElementById('dockChatContainer');
                var backBtn = document.getElementById('dockChatBackBtn');
                var titleEl = document.getElementById('dockChatTitle');
                var inputArea = document.querySelector('#panelChat .chat-input-area');
                if (!listView || !detailView) return;

                if (shouldUseDesktopChatSplitLayout()) {
                    if (container) container.classList.add('desktop-split');
                    listView.classList.remove('hidden');
                    detailView.classList.remove('hidden');
                    if (backBtn) backBtn.style.display = 'none';
                    if (!dockChatActiveUser) {
                        if (titleEl) titleEl.textContent = '消息';
                        if (inputArea) inputArea.style.display = 'none';
                        renderDockChatDesktopEmptyState();
                    } else if (inputArea) {
                        inputArea.style.display = '';
                    }
                    return;
                }

                if (container) container.classList.remove('desktop-split');
                if (!dockChatActiveUser) {
                    detailView.classList.add('hidden');
                    listView.classList.remove('hidden');
                    if (backBtn) backBtn.style.display = 'none';
                    if (titleEl) titleEl.textContent = '消息';
                } else {
                    listView.classList.add('hidden');
                    detailView.classList.remove('hidden');
                    if (backBtn) backBtn.style.display = 'flex';
                }
                if (inputArea) inputArea.style.display = '';
            }

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
                window.dockChatListCacheTime = 0;
                syncDockChatLayoutState();
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
                startDMPolling(60000, true);
            };

            async function loadDockChatList() {
                const el = document.getElementById('dockChatList');
                if (!el) return;
                if (!window.currentUser) {
                    el.innerHTML = '<div class="chat-empty"><div style="color:var(--xtj-text-muted);font-size:13px;padding:20px 0;">登录后可查看消息</div></div>';
                    setUnreadBadgeCount(0);
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    return;
                }
                if (!dockChatActiveUser) {
                    syncDockChatLayoutState();
                }
                if (Date.now() - (window.dockChatListCacheTime || 0) < DOCK_CHAT_CACHE_DURATION) return;
                var listLoadSeq = ++_dockChatListLoadSeq;
                var hadRenderedList = !!el.children.length;
                try {
                    if (!hadRenderedList) {
                        renderChatLoadingState(el, {
                            title: '加载中...',
                            subtitle: '正在取回最近消息',
                            variant: 'chat-list'
                        });
                    }
                    const dmResp = await window.xtjProtectedFetch('/api/dm/list');
                    if (!dmResp.ok) throw new Error('DM list fetch failed');
                    const dmResult = await dmResp.json();
                    if (!dmResult.ok) throw new Error(dmResult.error || 'DM list failed');
                    if (listLoadSeq !== _dockChatListLoadSeq) return;
                    const allMsgs = mergeDockChatRowsById(dmResult.data || [], false, 180);
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div style="color:var(--xtj-text-muted);font-size:13px;padding:20px 0;">暂无最近会话</div></div>';
                        setUnreadBadgeCount(0);
                        window.dockChatListCacheTime = Date.now();
                        renderDockChatFixedEntry(el);
                        syncDockChatLayoutState();
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
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    // 非阻塞加载头像: 先显示列表, 头像后台补上（包含固定入口 xxz）
                    var avatarUsers = convs.map(function(c) { return c.other_user; });
                    if (window.currentUser !== 'xxz') avatarUsers.push('xxz');
                    hydrateDockChatAvatars(avatarUsers, function(changed) {
                        if (changed) patchDockChatConversationAvatars(el);
                    });
                } catch(e) {
                    if (listLoadSeq !== _dockChatListLoadSeq) return;
                    // ★ 修复：已有列表时保留旧列表并仅 toast 提示失败，不追加重试按钮；
                    // 此前无条件追加 retry 且 dockChatListCacheTime=0 会立刻触发下次重试，
                    // 可能反复请求。重试按钮只在无列表（首屏加载失败）时显示。
                    if (!hadRenderedList) {
                        el.innerHTML = '';
                        var previousRetry = el.querySelector('.chat-load-retry');
                        if (previousRetry) previousRetry.remove();
                        var retry = document.createElement('button');
                        retry.type = 'button';
                        retry.className = 'chat-load-retry';
                        retry.textContent = '消息加载失败，点击重试';
                        retry.addEventListener('click', function() {
                            retry.remove();
                            loadDockChatList();
                        }, { once: true });
                        el.appendChild(retry);
                        window.dockChatListCacheTime = 0;
                    } else {
                        showToast('消息列表刷新失败，请稍后重试');
                    }
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
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
                // P7: 先从 localStorage 补全内存缓存
                try {
                    var storedAvatars = readAvatarCacheFromStorage();
                    users.forEach(function(username) {
                        if (storedAvatars[username] && !avatarCache[username]) {
                            avatarCache[username] = storedAvatars[username];
                        }
                    });
                } catch (e) {}
                // P7: 只为没有新鲜缓存（TTL 内）的用户发起批量请求
                var uncached = users.filter(function(username) {
                    return !hasFreshAvatarCache(username);
                });
                if (!uncached.length) {
                    if (typeof onReady === 'function') onReady(false);
                    return Promise.resolve(false);
                }
                return window.xtjProtectedFetch('/api/avatar/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ users: uncached })
                })
                    .then(function(resp) { return resp.json(); })
                    .then(function(result) {
                        var changed = false;
                        if (result && result.ok && result.avatars) {
                            var keys = Object.keys(result.avatars);
                            for (var ki = 0; ki < keys.length; ki++) {
                                var k = keys[ki];
                                var v = result.avatars[k];
                                if (v) {
                                    // P7: 有 URL → has_avatar
                                    if (getAvatarUrl(k) !== v) {
                                        changed = true;
                                    }
                                    setAvatarCacheEntry(k, 'has_avatar', v);
                                } else if (v === null) {
                                    // P7: null → 清除旧缓存并设为 confirmed_none（TTL 内不重查）
                                    var prevEntry = avatarCache[k];
                                    if (v === null && avatarCache[k]) {
                                        delete avatarCache[k];
                                    }
                                    if (!prevEntry || prevEntry.state !== 'confirmed_none') {
                                        changed = true;
                                    }
                                    setAvatarCacheEntry(k, 'confirmed_none', null);
                                }
                            }
                            // 写入本地缓存
                            try {
                                var cachedAvatars = readAvatarCacheFromStorage();
                                for (var ki2 = 0; ki2 < keys.length; ki2++) {
                                    var k2 = keys[ki2];
                                    if (result.avatars[k2]) {
                                        cachedAvatars[k2] = { state: 'has_avatar', url: result.avatars[k2], fetched_at: Date.now() };
                                    } else if (result.avatars[k2] === null) {
                                        delete cachedAvatars[k2];
                                        cachedAvatars[k2] = { state: 'confirmed_none', url: null, fetched_at: Date.now() };
                                    }
                                }
                                writeAvatarCacheToStorage(cachedAvatars);
                            } catch(e) {}
                        } else {
                            // P7: 批量接口失败时降级到旧缓存（与单用户接口一致）
                            uncached.forEach(function(username) {
                                setAvatarCacheEntry(username, 'fetch_failed', null);
                            });
                        }
                        if (typeof onReady === 'function') onReady(changed || uncached.length > 0);
                        return changed || uncached.length > 0;
                    })
                    .catch(function() {
                        // P7: 网络异常时降级到旧缓存（与单用户接口一致）
                        uncached.forEach(function(username) {
                            setAvatarCacheEntry(username, 'fetch_failed', null);
                        });
                        if (typeof onReady === 'function') onReady(false);
                        return false;
                    });
            }

            // 聊天消息缓存
            var _chatCache = {};
            var _chatRenderSignature = {};
            var _dockChatLoadSeq = 0;
            var _dockChatListLoadSeq = 0;
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
                var avatarUrl = getAvatarUrl(userName);
                if (avatarUrl) {
                    var safeAvatarUrl = escapeHtml(sanitizeUrl(avatarUrl));
                    if (safeAvatarUrl) {
                        return '<img loading="lazy" decoding="async" src="' + safeAvatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\';this.parentElement.textContent=\'' + safeJsStr(String(userName || '?').slice(0, 1).toUpperCase()) + '\'">';
                    }
                }
                // 无头像时显示首字母（xxz → X）
                return escapeHtml(String(userName || '?').slice(0, 1).toUpperCase());
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
                    getAvatarUrl(conversation && conversation.other_user ? conversation.other_user : '') || ''
                ].join('~');
            }

            function getDockChatConversationAvatarHtml(userName) {
                return getDockChatAvatarMarkup(userName);
            }

            function buildDockChatListItemMarkup(conversation, index) {
                var safeUser = safeJsStr(conversation.other_user);
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

            // The chat list contains real direct-message contacts only. AI is
            // intentionally launched from the homepage AI tools button.
            function renderDockChatFixedEntry(el) {
                if (!el) return;
                // The administrator contact remains a normal direct-message entry.
                if (window.currentUser === 'xxz') {
                    var selfEntry = el.querySelector('.chat-list-item[data-chat-user="xxz"]');
                    if (selfEntry) selfEntry.remove();
                    return;
                }
                var existingAdmin = el.querySelector('.chat-list-item[data-chat-user="xxz"]');
                if (existingAdmin) {
                    if (el.firstChild !== existingAdmin) el.insertBefore(existingAdmin, el.firstChild);
                    // 更新头像（可能已有缓存）
                    var adminAvatar = existingAdmin.querySelector('.cli-avatar');
                    if (adminAvatar) adminAvatar.innerHTML = getDockChatAvatarMarkup('xxz');
                } else {
                    var adminHtml = [
                        '<div class="chat-list-item admin-chat-entry" data-chat-user="xxz" role="button" tabindex="0" style="--xtj-enter-delay:50ms">',
                        '<div class="cli-avatar">', getDockChatAvatarMarkup('xxz'), '</div>',
                        '<div class="cli-info"><div class="cli-name">xxz<span class="admin-tag-mini">管理员</span></div><div class="cli-preview">想我就给我发消息</div></div>',
                        '<div class="cli-right"></div>',
                        '</div>'
                    ].join('');
                    var adminTemplate = document.createElement('template');
                    adminTemplate.innerHTML = adminHtml.trim();
                    var adminRow = adminTemplate.content.firstElementChild;
                    // 整行可点击，统一调用 openChat
                    adminRow.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (typeof window.openChat === 'function') {
                            window.openChat('xxz');
                        }
                    });
                    adminRow.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adminRow.click(); }
                    });
                    el.insertBefore(adminRow, el.firstChild);
                }
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
                    var payload = getDMMessagePayload(m) || {};
                    return [
                        m && m.id ? m.id : '',
                        m && m.__tempId ? m.__tempId : '',
                        m && m.user_name ? m.user_name : '',
                        m && m.media_url ? m.media_url : '',
                        m && m.content ? m.content : '',
                        m && m.created_at ? m.created_at : '',
                        m && m.actor_key ? m.actor_key : '',
                        m && m.views ? m.views : 0,
                        m && m.__optimistic ? 1 : 0,
                        // ★ 修复：签名纳入 read_at 与 withdrawn，已读状态/撤回后必须重渲染
                        getDMMessageReadAt(m),
                        payload.withdrawn ? 1 : 0
                    ].join('~');
                }).join('|');
            }

            function mergeDockChatMessages(userName, msgs) {
                // ★ 修复：发送成功会把乐观消息替换成服务端真实消息（不再带 __optimistic）。
                //   此前该函数只保留带 __optimistic 的缓存消息，若此刻刚好有「更早快照」的
                //   /api/dm/messages 请求在途并写回缓存，刚提交的新消息会从会话里消失。
                //   现改为：以服务端快照为底，把缓存中仍缺失的「乐观消息」以及「比快照更近
                //   （窗口期新提交）的非乐观消息」按 id 合并回去，避免发送成功即丢失。
                var cacheKey = getDockChatCacheKey(userName);
                var cached = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                var snapshot = (msgs || []).slice();
                // 快照为空时以快照为准，避免整段恢复已删除/过期缓存
                if (!snapshot.length) return sortDockChatMessages(snapshot);
                var snapshotNewestAt = 0;
                var lastMsg = snapshot[snapshot.length - 1];
                if (lastMsg && lastMsg.created_at) {
                    var lastTs = Date.parse(lastMsg.created_at);
                    if (!isNaN(lastTs)) snapshotNewestAt = lastTs;
                }
                var merged = snapshot.slice();
                cached.forEach(function(msg) {
                    if (!msg || !msg.id) return;
                    var exists = merged.some(function(existing) {
                        return existing && existing.id && msg.id && existing.id === msg.id;
                    });
                    if (exists) return; // 快照已是服务端权威
                    if (msg.__optimistic) { merged.push(msg); return; }
                    var ts = msg.created_at ? Date.parse(msg.created_at) : NaN;
                    // 仅合并比快照新（发送成功后才落库的窗口期消息），不复活旧历史
                    if (!isNaN(ts) && ts >= snapshotNewestAt) merged.push(msg);
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
                var payload = getDMMessagePayload(message);
                if (payload && payload.withdrawn) {
                    return '<span class="msg-text withdrawn">[此消息已被撤回]</span>';
                }
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
                // P6: render audio messages with <audio> player
                if (media && media.kind === 'audio') {
                    var audioBody = '<audio class="msg-audio" src="' + escapeHtml(media.src) + '" controls preload="metadata" onclick="event.stopPropagation()" style="max-width:240px;cursor:default;"></audio>';
                    if (messageText) audioBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return audioBody;
                }
                return '<span class="msg-text">' + escapeHtml(messageText || '') + '</span>';
            }

                        function buildDockChatRowMarkup(message, avatars, disableAnim) {
                var sent = message.user_name === currentUser;
                var avatarHtml = sent ? avatars.mine : avatars.other;
                var readStatus = sent ? (isMsgReadByMe(message) ? '<span class="msg-read-status">已读</span>' : '<span class="msg-read-status">未读</span>') : '';
                
                var payload = getDMMessagePayload(message);
                var isWithdrawn = payload && payload.withdrawn;
                
                var elapsed = Date.now() - new Date(message.created_at).getTime();
                var timeLimit = 3 * 60 * 1000;
                var canWithdraw = sent && !message.__optimistic && !isWithdrawn && (elapsed <= timeLimit);
                
                var withdrawBtn = canWithdraw ? '<span class="msg-withdraw-btn" onclick="window.withdrawDMMessage(\'' + safeJsStr(String(message.id)) + '\', this)" style="cursor:pointer; font-size: 11px; margin-left: 6px; color: #999;">撤回</span>' : '';
                
                var bubbleClass = 'chat-msg ' + (sent ? 'sent' : 'received');
                if (message.__optimistic && sent) bubbleClass += ' sent-anim';
                else if (disableAnim) bubbleClass += ' no-anim';
                if (message.__optimistic) bubbleClass += ' pending';
                if (isWithdrawn) bubbleClass += ' is-withdrawn';
                
                var tempAttr = message.__tempId ? ' data-temp-id="' + message.__tempId + '"' : '';
                var bubble = '<div class="' + bubbleClass + '"' + tempAttr + '>' + buildDockChatBodyMarkup(message) + readStatus + '<span class="msg-time">' + formatMsgTime(message.created_at) + withdrawBtn + '</span></div>';
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
                // 当前用户优先使用 localStorage 缓存的头像
                if (currentUser) {
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 获取聊天缓存键
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
                    var requestController = typeof AbortController === 'function' ? new AbortController() : null;
                    var requestTimeout = setTimeout(function() {
                        if (requestController) requestController.abort();
                    }, 12000);
                    var messagesResp;
                    try {
                        messagesResp = await window.xtjProtectedFetch('/api/dm/messages?target=' + encodeURIComponent(userName) + '&limit=180', {
                            signal: requestController ? requestController.signal : undefined
                        });
                    } finally {
                        clearTimeout(requestTimeout);
                    }
                    var messagesResult = await messagesResp.json().catch(function() { return {}; });
                    if (!messagesResp.ok || !messagesResult.ok) throw new Error(messagesResult.error || 'DM messages failed');
                    if (loadSeq !== _dockChatLoadSeq || dockChatActiveUser !== userName) return;
                    var mergedMessages = mergeDockChatMessages(userName, mergeDockChatRowsById(messagesResult.data || [], true, 180));
                    var pendingReadUpdates = [];
                    mergedMessages.forEach(function(message) {
                        if (!message || message.user_name !== userName || message.media_url !== window.currentUser || getDMMessageReadAt(message)) {
                            return;
                        }
                        pendingReadUpdates.push({ id: message.id });
                    });
                    _chatCache[cacheKey] = mergedMessages;
                    renderDockMessages(userName, mergedMessages, forceScroll);
                    if (pendingReadUpdates.length) {
                        window.markMessagesRead(userName, mergedMessages, pendingReadUpdates).catch(function() {
                            scheduleDockChatListRefresh(120);
                        });
                    } else {
                        updateUnreadBadge();
                    }
                } catch(e) {
                    if (loadSeq === _dockChatLoadSeq && dockChatActiveUser === userName) {
                        if (!(_chatCache[cacheKey] && _chatCache[cacheKey].length)) el.innerHTML = '';
                        var previousRetry = el.querySelector('.chat-load-retry');
                        if (previousRetry) previousRetry.remove();
                        var retry = document.createElement('button');
                        retry.type = 'button';
                        retry.className = 'chat-load-retry';
                        retry.textContent = '消息加载失败，点击重试';
                        retry.addEventListener('click', function() {
                            retry.remove();
                            loadDockChatMessages(userName, false);
                        }, { once: true });
                        el.appendChild(retry);
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

            window.withdrawDMMessage = async function(id, btnEl) {
                if (!id) return;
                var oldText = btnEl.textContent;
                btnEl.textContent = '撤回中...';
                btnEl.style.pointerEvents = 'none';
                try {
                    var resp = await window.xtjProtectedFetch('/api/dm/withdraw', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: id })
                    });
                    var result = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !result.ok) {
                        throw new Error(result.error || '撤回失败');
                    }
                    if (result.message && dockChatActiveUser) {
                        upsertDockChatCacheMessage(dockChatActiveUser, result.message);
                        loadDockChatMessages(dockChatActiveUser, false);
                    }
                } catch (e) {
                    window.showToast(e.message || '撤回请求失败');
                    btnEl.textContent = oldText;
                    btnEl.style.pointerEvents = 'auto';
                }
            };

            function scrollDockChatBottom() {
                const el = document.getElementById('dockChatMessages');
                if (el) el.scrollTop = el.scrollHeight;
            }

            async function sendDockChatMessage() {
                if (!currentUser) { showToast('请先登录'); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                const inp = document.getElementById('dockChatInput');
                if (!inp) return;
                const content = inp.value.trim();
                const fileInput = document.getElementById('dockChatFileInp');
                const file = fileInput && fileInput.files[0];
                if ((!content && !file) || !dockChatActiveUser || dockChatSending) {
                if (!dockChatActiveUser && content) showToast('请先选择一个聊天对象');
                return;
            }
                var targetUser = dockChatActiveUser;
                if (targetUser === currentUser) { showToast('不能给自己发送消息'); return; }
                var maxFileSize = 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过50MB"); return; }
                if (file) {
                    // ★ 修复：显式拒绝 SVG（image/svg+xml 会通过 image/ 前缀白名单），
                    // 后端 dm-media 拒绝 SVG 后文件已先落桶，留下 Storage 孤儿 + 公共桶
                    // 存储型 XSS 窗口。这里与照片墙 upload-ui 的拒绝策略对齐。
                    var svgBlocked = /^image\/svg\+xml/i.test(String(file.type || '')) || /\.svgz?$/i.test(String(file.name || '').toLowerCase());
                    if (svgBlocked) { showToast("不支持 SVG 文件，仅支持图片、视频、音频"); return; }
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = allowedTypes.some(function(t) { return file.type.startsWith(t); });
                    if (!typeOk) { showToast("不支持的文件类型，仅支持图片、视频、音频"); return; }
                }
                dockChatSending = true; inp.value = '';
                var capturedContent = content;
                var tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                var optimisticCreatedAt = new Date().toISOString();
                try {
                    var storagePath = null;
                    var mediaKind = null;
                    var actorKey = DM_MARKER;
                    var mediaPayload = null;
                    if (file) {
                        const path = buildStorageUploadPath('chat', file.name);
                        // P6: 检查 Storage 上传返回的 error — Supabase JS 客户端在
                        // Storage 业务错误（配额超限、权限拒绝、路径冲突）时返回
                        // { data: null, error } 而非 throw。之前不检查 error，导致
                        // 媒体文件实际不存在时仍继续发送私信。
                        var uploadResult = await sb.storage.from("uploads").upload(path, file, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: file.type || 'application/octet-stream'
                        });
                        if (uploadResult && uploadResult.error) {
                            throw new Error('媒体上传失败: ' + (uploadResult.error.message || '未知错误'));
                        }
                        storagePath = path;
                        if (file.type.startsWith('video/')) {
                            mediaKind = 'video';
                            actorKey = '__dm_vid__' + path;
                            mediaPayload = { kind: 'video', url: getMediaUrl('__dm_vid__', path), mimeType: file.type || '' };
                        } else if (file.type.startsWith('image/')) {
                            mediaKind = 'image';
                            actorKey = '__dm_img__' + path;
                            mediaPayload = { kind: 'image', url: getMediaUrl('__dm_img__', path), mimeType: file.type || '' };
                        } else if (file.type.startsWith('audio/')) {
                            // P6: 明确支持音频 — 之前校验允许 audio/ 但上传分支和解析/渲染
                            // 全链路缺失，导致音频文件成为 Storage 孤儿。
                            mediaKind = 'audio';
                            actorKey = '__dm_aud__' + path;
                            mediaPayload = { kind: 'audio', url: getMediaUrl('__dm_aud__', path), mimeType: file.type || '' };
                        } else {
                            // P6: 不支持的类型 — 在上传前就应该被拦截，但作为最后一道防线
                            throw new Error('不支持的媒体类型: ' + file.type);
                        }
                    }
                    // P6: 构建乐观消息的 contentPayload（含媒体信息，用于本地即时渲染）
                    var optimisticContentPayload = buildDMMessageContent({ content: capturedContent }, { text: capturedContent, read_at: null, media: mediaPayload });

                    var optimisticMessage = {
                        id: tempId,
                        __tempId: tempId,
                        __optimistic: true,
                        user_name: currentUser,
                        content: optimisticContentPayload,
                        media_type: DM_MARKER,
                        media_url: targetUser,
                        actor_key: actorKey,
                        created_at: optimisticCreatedAt,
                        views: 0
                    };
                    renderDockMessages(targetUser, upsertDockChatCacheMessage(targetUser, optimisticMessage), true);
                    applyDockChatConversationPreview(targetUser, optimisticMessage, 0);

                    // P6: 客户端只提交 storage_path / kind / mime_type，后端生成 URL 和 actor_key
                    // 禁止前端直接发送 actor_key 和 media_type，防止篡改。
                    var requestBody = {
                        target_user: targetUser,
                        content: capturedContent
                    };
                    if (storagePath) {
                        requestBody.storage_path = storagePath;
                        requestBody.kind = mediaKind;
                        requestBody.mime_type = file.type;
                    }

                    // ★ 通过后端认证接口发送，禁止前端直连 Supabase
                    var sendResp = await window.xtjProtectedFetch('/api/dm/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                    if (!sendResp.ok) {
                        var sendErrData = await sendResp.json().catch(function() { return {}; });
                        throw new Error(sendErrData.error || '发送失败 (HTTP ' + sendResp.status + ')');
                    }
                    var sendResult = await sendResp.json();
                    if (!sendResult.ok || !sendResult.message) throw new Error('服务端未确认发送');

                    var insertedMessage = sendResult.message;
                    touchUserSession(false);
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('message_send', '发送消息给 [' + targetUser + ']'); } catch(e) {}
                    clearDockChatFilePreview(false);
                    replaceDockChatCacheMessage(targetUser, tempId, insertedMessage);
                    if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                    applyDockChatConversationPreview(targetUser, insertedMessage, 0);
                    scheduleDockChatListRefresh(320);
                    if (typeof window.__xtjRefreshIOSChatViewport === 'function') {
                        window.__xtjRefreshIOSChatViewport({ preserveFocus: true, forceScroll: true });
                    }
                } catch(e) {
                    // ★ 修复：发送失败时回收已上传的 Storage 文件，避免孤儿媒体永久泄漏
                    //   （前端先直传 Storage、后调 /api/dm/send；若 send 失败/超时，后端
                    //   从未感知该路径，文件会残留在公共桶）。
                    if (storagePath) {
                        try {
                            var dmOrphanRes = await sb.storage.from('uploads').remove([storagePath]);
                            if (dmOrphanRes && dmOrphanRes.error) console.warn('[dm-send] orphan media cleanup failed', dmOrphanRes.error);
                        } catch (dmCleanupErr) { console.warn('[dm-send] orphan media cleanup failed', dmCleanupErr); }
                        storagePath = null;
                    }
                    removeDockChatCacheMessage(targetUser, tempId);
                    if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                    // ★ 修复：发送失败恢复输入框内容时，若用户失败提示期间已输入新内容，
                    // 直接赋值会覆盖用户正在输入的内容；仅当输入框当前为空时才恢复原文。
                    if (!inp.value) { inp.value = capturedContent; }
                    showToast('发送失败: ' + (e && e.message ? e.message : '未知错误'));
                }
                finally { dockChatSending = false; }
            }

            function showDockChatFilePreview(file) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const thumb = document.getElementById('dockCfpThumb'), name = document.getElementById('dockCfpName');
                if (!preview || !input || !thumb || !name) return;
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                const xBtn = thumb.querySelector('.cfp-x'); thumb.innerHTML = '';
                if (file.type.startsWith('video/')) { thumb.innerHTML = '<span class="cfp-video-icon">视频</span>'; }
                else if (file.type.startsWith('audio/')) { thumb.innerHTML = '<span class="cfp-audio-icon">音频</span>'; }
                else { const img = document.createElement('img'); _dockPreviewUrl = URL.createObjectURL(file); img.src = _dockPreviewUrl; thumb.appendChild(img); }
                if (xBtn) thumb.appendChild(xBtn);
                name.textContent = file.name; input.classList.add('hidden'); preview.classList.remove('hidden');
            }

            function clearDockChatFilePreview(restoreFocus) {
                const preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
                const fileInput = document.getElementById('dockChatFileInp');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                if (preview) preview.classList.add('hidden');
                if (input) input.classList.remove('hidden');
                if (fileInput) fileInput.value = '';
                if (restoreFocus !== false && input) input.focus();
            }

            /** Normalize clipboard/drag files (often nameless blobs) and assign into #dockChatFileInp. */
            function normalizeDockChatMediaFile(file) {
                if (!file) return null;
                var type = String(file.type || '');
                var name = String(file.name || '').trim();
                if (!name || name === 'blob' || name === 'image') {
                    var ext = 'bin';
                    if (type.indexOf('image/') === 0) {
                        ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
                    } else if (type.indexOf('video/') === 0) {
                        ext = (type.split('/')[1] || 'mp4').split(';')[0];
                    } else if (type.indexOf('audio/') === 0) {
                        ext = (type.split('/')[1] || 'mp3').split(';')[0];
                    }
                    name = 'paste-' + Date.now() + '.' + ext;
                    try {
                        return new File([file], name, { type: type || 'application/octet-stream', lastModified: Date.now() });
                    } catch (e) {
                        return file;
                    }
                }
                return file;
            }

            function assignDockChatFile(rawFile) {
                var fileInput = document.getElementById('dockChatFileInp');
                if (!fileInput || !rawFile) return false;
                var file = normalizeDockChatMediaFile(rawFile);
                var maxFileSize = 50 * 1024 * 1024;
                if (file.size > maxFileSize) { showToast('文件大小不能超过50MB'); return false; }
                var allowedTypes = ['image/', 'video/', 'audio/'];
                var typeOk = allowedTypes.some(function(t) { return String(file.type || '').indexOf(t) === 0; });
                if (!typeOk) { showToast('不支持的文件类型，仅支持图片、视频、音频'); return false; }
                try {
                    var dt = new DataTransfer();
                    dt.items.add(file);
                    fileInput.files = dt.files;
                } catch (e) {
                    showToast('当前浏览器不支持粘贴/拖拽上传，请点 📷 选择文件');
                    return false;
                }
                showDockChatFilePreview(file);
                return true;
            }

            function pickFirstDockChatMedia(fileList) {
                if (!fileList || !fileList.length) return null;
                for (var i = 0; i < fileList.length; i++) {
                    var f = fileList[i];
                    if (f && /^(image|video|audio)\//.test(String(f.type || ''))) return f;
                }
                return null;
            }

            function extractClipboardMediaFile(clipboardData) {
                if (!clipboardData) return null;
                var items = clipboardData.items;
                if (items && items.length) {
                    for (var i = 0; i < items.length; i++) {
                        var item = items[i];
                        if (item && item.kind === 'file' && /^(image|video|audio)\//.test(String(item.type || ''))) {
                            var asFile = item.getAsFile && item.getAsFile();
                            if (asFile) return asFile;
                        }
                    }
                }
                return pickFirstDockChatMedia(clipboardData.files);
            }

            function bindDockChatPasteAndDrop() {
                var input = document.getElementById('dockChatInput');
                var dropZone = document.querySelector('#dockChatDetailView .chat-input-area') ||
                    document.querySelector('#panelChat .chat-input-area');
                var dragDepth = 0;

                function onPaste(e) {
                    var clip = e.clipboardData || (window.clipboardData || null);
                    var media = extractClipboardMediaFile(clip);
                    if (!media) return;
                    e.preventDefault();
                    assignDockChatFile(media);
                }

                function hasDragFiles(e) {
                    var types = e.dataTransfer && e.dataTransfer.types;
                    if (!types) return false;
                    if (typeof types.contains === 'function') return types.contains('Files');
                    for (var i = 0; i < types.length; i++) {
                        if (types[i] === 'Files') return true;
                    }
                    return false;
                }

                function setDropActive(on) {
                    if (!dropZone) return;
                    if (on) dropZone.classList.add('is-file-dragover');
                    else dropZone.classList.remove('is-file-dragover');
                }

                if (input) {
                    input.addEventListener('paste', onPaste);
                }
                if (dropZone) {
                    dropZone.addEventListener('paste', onPaste);
                    dropZone.addEventListener('dragenter', function(e) {
                        if (!hasDragFiles(e)) return;
                        e.preventDefault();
                        dragDepth++;
                        setDropActive(true);
                    });
                    dropZone.addEventListener('dragover', function(e) {
                        if (!hasDragFiles(e)) return;
                        e.preventDefault();
                        try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
                        setDropActive(true);
                    });
                    dropZone.addEventListener('dragleave', function(e) {
                        if (!hasDragFiles(e) && dragDepth === 0) return;
                        e.preventDefault();
                        dragDepth = Math.max(0, dragDepth - 1);
                        if (dragDepth === 0) setDropActive(false);
                    });
                    dropZone.addEventListener('drop', function(e) {
                        if (!hasDragFiles(e)) return;
                        e.preventDefault();
                        dragDepth = 0;
                        setDropActive(false);
                        var media = pickFirstDockChatMedia(e.dataTransfer && e.dataTransfer.files);
                        if (media) assignDockChatFile(media);
                        else showToast('请拖入图片、视频或音频文件');
                    });
                    dropZone.addEventListener('dragend', function() {
                        dragDepth = 0;
                        setDropActive(false);
                    });
                }
            }

            try {
                var _dsb = document.getElementById('dockChatSendBtn'); if (_dsb) _dsb.addEventListener('click', sendDockChatMessage);
                var _dci = document.getElementById('dockChatInput'); if (_dci) _dci.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDockChatMessage(); } });
                var _dib = document.getElementById('dockChatImgBtn'); if (_dib) _dib.addEventListener('click', function() { document.getElementById('dockChatFileInp').click(); });
                var _dfi = document.getElementById('dockChatFileInp'); if (_dfi) _dfi.addEventListener('change', function() { if (this.files.length) showDockChatFilePreview(this.files[0]); });
                var _dcr = document.getElementById('dockCfpRemove'); if (_dcr) _dcr.addEventListener('click', clearDockChatFilePreview);
                bindDockChatPasteAndDrop();
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
                syncDockChatLayoutState();
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
                    root.classList.add('xtj-ios-viewport');
                    let keyboardOpen = false;

                    function hasActiveInput() {
                        var active = document.activeElement;
                        return !!(active && inputs.indexOf(active.id) >= 0);
                    }

                    function updateIOSViewport() {
                        var vv = window.visualViewport;
                        var appHeight = vv ? Math.round(vv.height) : window.innerHeight;
                        root.style.setProperty('--xtj-app-height', appHeight + 'px');
                        var viewportBottom = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
                        root.style.setProperty('--xtj-visual-bottom', viewportBottom + 'px');
                        if (dockBar) {
                            // Reserve the real Dock footprint so the last post never scrolls behind it.
                            root.style.setProperty('--xtj-dock-reserve', (Math.ceil(dockBar.getBoundingClientRect().height) + 20) + 'px');
                        }
                        var keyboardGap = viewportBottom;
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
                        var _iosVvTicking = false;
                        function _iosVvHandler() {
                            if (!_iosVvTicking) {
                                _iosVvTicking = true;
                                requestAnimationFrame(function() {
                                    updateIOSViewport();
                                    _iosVvTicking = false;
                                });
                            }
                        }
                        window.visualViewport.addEventListener('resize', _iosVvHandler);
                        window.visualViewport.addEventListener('scroll', _iosVvHandler);
                    }
                    window.addEventListener('orientationchange', function() {
                        setTimeout(updateIOSViewport, 180);
                    });
                    window.addEventListener('resize', function() {
                        if (!keyboardOpen) updateIOSViewport();
                    });
                    updateIOSViewport();
                })();

                // 修复 100dvh 在 iOS 上的问题：改用 --vh 方案，移除旧逻辑
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI();
                normalizeReportModalStructure();
                requestAnimationFrame(function() {
                    Promise.resolve()
                        .then(function() { return initialLoad(); })
                        .catch(function(err) {
                            console.error('[XTJ] initialLoad failed:', err);
                            try {
                                var feedEl = document.getElementById('feed');
                                if (feedEl && /xtj-loading-skeleton|xtj-skeleton-card/.test(feedEl.innerHTML || '')) {
                                    feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;cursor:pointer;" id="feedInitError">启动加载失败，点击重试</div>';
                                    var initErr = document.getElementById('feedInitError');
                                    if (initErr) initErr.onclick = function() {
                                        if (typeof window.loadFeed === 'function') window.loadFeed(true);
                                    };
                                }
                            } catch (e2) {}
                        });
                });
                // 帖子区看门狗：skeleton 卡住 / 白屏空 feed 时给出可点重试（含 Render 冷启动）
                (function setupFeedBootWatchdog() {
                    if (window.__xtjFeedBootWatchdog) return;
                    window.__xtjFeedBootWatchdog = true;
                    var tries = 0;
                    var timer = setInterval(function() {
                        tries += 1;
                        var feedEl = document.getElementById('feed');
                        if (!feedEl) {
                            if (tries >= 12) clearInterval(timer);
                            return;
                        }
                        var hasPosts = !!feedEl.querySelector('.post');
                        var hasSkeleton = !!feedEl.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card, .xtj-magic-loading, .loading')
                            || /内容加载中|加载中/.test(feedEl.innerHTML || '');
                        var hasError = !!feedEl.querySelector('#feedBootError, #feedInitError, #feedWatchdogError, .feed-load-more-error')
                            || /加载失败|加载中断|启动加载失败|加载超时/.test(feedEl.innerText || '');
                        var isEmpty = !hasPosts && !hasError && String(feedEl.textContent || '').trim().length < 8;
                        if (hasPosts || hasError) {
                            clearInterval(timer);
                            return;
                        }
                        if ((tries >= 10 && hasSkeleton) || (tries >= 8 && isEmpty)) {
                            clearInterval(timer);
                            console.warn('[XTJ] feed boot watchdog: recovery after ' + tries + 's');
                            feedEl.innerHTML = '<div class="loading" id="feedWatchdogError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;padding:24px;text-align:center;">帖子加载超时，点击重试<br><small style="opacity:.7">若底部一直显示「正在等待…」，多半是 Render 冷启动或网络慢，请稍候再点</small></div>';
                            var w = document.getElementById('feedWatchdogError');
                            if (w) {
                                w.onclick = function() {
                                    if (typeof window.loadFeed === 'function') {
                                        window.loadFeed(true).catch(function() {});
                                    } else {
                                        window.location.reload();
                                    }
                                };
                            }
                            try {
                                if (typeof window.loadFeed === 'function') {
                                    window.loadFeed(true).catch(function() {});
                                }
                            } catch (e3) {}
                        }
                    }, 1000);
                })();
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
                // 恢复/停止保存当前 tab
                const savedTab = window.safeStorage.get('xtj_current_tab');
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
                    window.safeStorage.set(THEME_STORAGE_KEY, 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到深色模式');
                        themeBtn.setAttribute('title', '切换到深色模式');
                    }
                    // G7 修复：仅当用户显式选择了浅色（此前存过偏好）时才落盘 'light'；
                    // 首次访问跟随系统浅色时不写 localStorage，保证系统深色监听（11441 行）持续生效
                    if (window.safeStorage.get(THEME_STORAGE_KEY)) {
                        window.safeStorage.set(THEME_STORAGE_KEY, 'light');
                    } else {
                        window.safeStorage.remove(THEME_STORAGE_KEY);
                    }
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
                themeBtn.__xtjLegacyThemeClick = function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    const nextTheme = !isDark ? '深色模式' : '浅色模式';
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('settings_change', '切换主题 → ' + nextTheme); } catch(e) {}
                    animateThemeToggle(!isDark, themeBtn);
                };
                themeBtn.addEventListener('click', themeBtn.__xtjLegacyThemeClick);
            }
            // 初始化时从 localStorage 读取主题设置
            const savedTheme = window.safeStorage.get(THEME_STORAGE_KEY);
            if (savedTheme === 'dark') {
                setThemeState(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                setThemeState(true);
            } else {
                setThemeState(false);
            }
            // 监听系统主题变化
            try {
                var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
                if (mqDark && mqDark.addEventListener) {
                    mqDark.addEventListener('change', function(e) {
                        if (!window.safeStorage.get(THEME_STORAGE_KEY)) {
                            setThemeState(e.matches);
                        }
                    });
                }
            } catch (_) {}
            // ★ 修复 M-2：本旧主题块在 core.js 顶层立即执行，此时 theme-toggle.js
            // （V2 控制器）尚未加载（defer 顺序在 core 之后）。DOMContentLoaded 时
            // 所有 defer 脚本已执行完毕，若 V2 已接管（__xtjThemeControllerV2 被设置），
            // 移除旧块对 themeToggle 的 click 绑定，避免双 handler 同时响应导致
            // 动画/存储键（xtj-theme vs xtj_theme）互相覆盖。主题统一由 V2 管理。
            if (themeBtn) {
                document.addEventListener('DOMContentLoaded', function() {
                    try {
                        if (window.__xtjThemeControllerV2 && themeBtn.__xtjLegacyThemeClick) {
                            themeBtn.removeEventListener('click', themeBtn.__xtjLegacyThemeClick);
                            themeBtn.__xtjLegacyThemeClick = null;
                        }
                    } catch (e3) {}
                });
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
                    var raw = window.safeStorage.get(getAnnouncementReadKey());
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
                    var raw = window.safeStorage.get(key);
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
                        window.safeStorage.set(key, JSON.stringify(obj));
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
                window.safeStorage.set(ANN_READ_KEY_PREFIX + 'legacy', JSON.stringify(arr || []));
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
                // 公告：管理员专属的发布区域
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

                // 进入公告详情：隐藏管理区域
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = window.safeParseDate(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;
                
                // 设置公告发布者信息显示
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = getAvatarUrl(ann.user_name) ? sanitizeUrl(getAvatarUrl(ann.user_name)) : '';
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(avUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + escapeHtml(String(ann.user_name).charAt(0) || '').toUpperCase() + '</div>';
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

                renderAnnouncementList(); // 重新渲染列表，清理新增
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
                            <div class="announcement-item-time">${window.safeParseDate(ann.created_at).toLocaleString('zh-CN')}</div>
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
                if (!window.isAdmin()) { if (window.showToast) showToast('无权限'); return; }
                const titleInput = document.getElementById('announcementAdminTitle');
                const contentInput = document.getElementById('announcementAdminInput');
                const title = titleInput.value.trim();
                const content = contentInput.value.trim();
                
                if (!title && !content) {
                    showToast('请至少填写标题或内容');
                    return;
                }

                try {
                    // 走后端 /api/admin/announcement（access token + ADMIN_USERNAME），禁止 anon 直写
                    var resp;
                    if (typeof window.xtjProtectedFetch === 'function') {
                        resp = await window.xtjProtectedFetch('/api/admin/announcement', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: title, content: content })
                        });
                    } else {
                        var authHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                        resp = await fetch((window.API_BASE || '').replace(/\/$/, '') + '/api/admin/announcement', {
                            method: 'POST',
                            credentials: 'include',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
                            body: JSON.stringify({ title: title, content: content })
                        });
                    }
                    var data = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !data || data.ok === false) {
                        throw new Error((data && data.error) || ('发布失败 (' + resp.status + ')'));
                    }
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
                if (!window.isAdmin()) { if (window.showToast) showToast('无权限'); return; }
                showConfirm('删除公告', '确定要删除这条公告吗？', '确定', async function() {
                    try {
                        var delPath = '/api/admin/announcement/' + encodeURIComponent(ann.id);
                        var delResp;
                        if (typeof window.xtjProtectedFetch === 'function') {
                            delResp = await window.xtjProtectedFetch(delPath, { method: 'DELETE' });
                        } else {
                            var delAuth = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                            delResp = await fetch((window.API_BASE || '').replace(/\/$/, '') + delPath, {
                                method: 'DELETE',
                                credentials: 'include',
                                headers: delAuth || {}
                            });
                        }
                        var delData = await delResp.json().catch(function() { return {}; });
                        if (!delResp.ok || (delData && delData.ok === false)) {
                            throw new Error((delData && delData.error) || ('删除失败 (' + delResp.status + ')'));
                        }

                        const readIds = getReadAnnouncements();
                        var annReadId = window.getAnnouncementId ? window.getAnnouncementId(ann) : ('a_' + ann.id);
                        const filteredReadIds = readIds.filter(id => id !== annReadId);
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
                            <li>TTS 语音优化，自动选择最自然发音</li>
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
            // 绑定公告 tab 切换事件
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 增强 showAnnouncementList 以支持当前标签状态
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
                return window.safeParseDate(value).toLocaleString();
            } catch(_) {
                return '';
            }
        }

        function formatReportDate(value) {
            if (!value) return '';
            try {
                return window.safeParseDate(value).toLocaleDateString();
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
            _reportSelectedId = window.__xtjReportTargetPostId || null;
            window.__xtjReportTargetPostId = null;
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

        var _reportLoadId = 0;
        function loadReportContentList() {
            var reqId = ++_reportLoadId;
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
                            if (reqId !== _reportLoadId) return;
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
                    fetch(API_BASE + '/api/photos/public?limit=200')
                        .then(function(resp) { return resp.json(); })
                        .then(function(result) {
                            if (reqId !== _reportLoadId) return;
                            _reportContentData = (result.data || []).map(resolveReportPhotoWallItem).filter(Boolean);
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
                var selected = _reportSelectedId === String(item.id) ? ' selected' : '';
                if (selected && !_reportTargetUser) _reportTargetUser = item.user_name;
                var isTextOnly = !item.thumb && item.type !== 'photo';
                var thumbHtml = item.thumb
                    ? '<img class="rc-thumb" src="' + escapeHtml(item.thumb) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;rc-thumb rc-thumb--text&quot; aria-hidden=&quot;true&quot;><span>' + safeJsStr((item.user_name || '?').slice(0,1).toUpperCase()) + '</span></div>\'">'
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
                    var reportHeaders = { 'Content-Type': 'application/json' };
                    var reportToken = getUserToken();
                    if (reportToken) reportHeaders['Authorization'] = 'Bearer ' + reportToken;
                    var res = await fetch(API_BASE + '/api/report', {
                        method: 'POST',
                        headers: reportHeaders,
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
                var funcs = ['togglePostPin', 'safeJsStr', 'escapeHtml'];
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
                        : (normalizedPost.media_type === 'audio'
                            ? '<audio src="' + escapeHtml(normalizedPost.media_url) + '" controls preload="metadata"></audio>'
                            : '<img ' + detailMediaAttrs + ' data-actor-key="' + escapeHtml(String(normalizedPost.actor_key || "")) + '" data-can-delete="' + (canDeletePost(normalizedPost) ? '1' : '0') + '" src="' + escapeHtml(normalizedPost.media_url) + '" onclick="openImageViewer(\'' + safeJsStr(normalizedPost.media_url) + '\', this)" loading="lazy" decoding="async" fetchpriority="low" />')
                ) : '';
                var visibilityLabel = normalizedPost.visibility === 'private' ? '私密' : '公开';
                var contentText = String(normalizedPost.content || '').trim();
                var detailActions = [];
                detailActions.push('<button type="button" class="action-btn post-tools-trigger" data-post-id="' + escapeHtml(String(normalizedPost.id)) + '" aria-haspopup="menu" aria-expanded="false" aria-label="更多帖子工具">•••</button>');
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
                    '          <div class="pdh-time">' + window.safeParseDate(normalizedPost.created_at).toLocaleString() + '</div>',
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
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(l.user_name) + '</div><div class="post-detail-mini-copy">留下了喜欢</div></div><span class="post-detail-mini-time">' + window.safeParseDate(l.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无点赞</div>',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack">',
                    '    <div class="post-detail-panel-title">评论记录 <span>' + comments.length + '</span></div>',
                    comments.length ? comments.map(function(c) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(c.user_name) + '</div><div class="post-detail-mini-copy">' + escapeHtml(c.content || '无评论内容') + '</div></div><span class="post-detail-mini-time">' + window.safeParseDate(c.created_at).toLocaleString() + '</span></article>';
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

            window.closeStatRecordsModal = function() {
                var modal = document.getElementById('statRecordsModal');
                if (modal) modal.classList.remove('active');
            };

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


            // S7 修复：帖子详情请求代次号，防止快速切换详情时旧响应覆盖新内容
            var _postDetailReqSeq = 0;

            window.openPostDetail = async function(postId) {
                var _seq = ++_postDetailReqSeq;
                var title = document.getElementById('postDetailTitle');
                var body = document.getElementById('postDetailBody');
                var modal = document.getElementById('postDetailModal');
                if (title) title.textContent = '帖子详情';
                if (body) body.innerHTML = getXtjLoadingHtml('加载中..', '加载中..', 'feed');
                if (modal) modal.classList.add('active');

                try {
                    var apiUrl = (window.API_BASE || '') + '/api/post/detail/' + encodeURIComponent(postId);
                    var apiRes = await fetch(apiUrl, { credentials: 'include' });
                    if (!apiRes.ok && (!apiRes.headers.get('content-type') || !apiRes.headers.get('content-type').includes('application/json'))) {
                        if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">无法获取帖子详情（' + apiRes.status + '）。</div>';
                        return;
                    }
                    var apiData;
                    try {
                        apiData = await apiRes.json();
                    } catch(e) {
                        if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">解析帖子详情失败，请稍后重试。</div>';
                        return;
                    }
                    if (!apiRes.ok || !apiData || !apiData.ok) {
                        var errMsg = (apiData && apiData.message) || '该帖子不存在、已删除或不可查看。';
                        // 错误消息来自服务端，先转义再拼 HTML，防 XSS 注入
                        if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">' + escapeHtml(errMsg) + '</div>';
                        return;
                    }
                    // S7 修复：响应落地前校验是否已被新请求替代
                    if (_seq !== _postDetailReqSeq) return;
                    var post = apiData.post;
                    var likes = apiData.likes || [];
                    var comments = apiData.comments || [];
                    // normalize to match renderPostDetail expectations；避免真实 views 被清零
                    post.views = (post.view_count != null ? post.view_count : (post.views != null ? post.views : 0));
                    if (!post.user_name || !post.created_at) {
                        if (body) body.innerHTML = '<div class="stat-empty">该帖子不存在、已删除或不可查看。</div>';
                        return;
                    }
                    trackView(postId);
                    renderPostDetail(post, likes, comments);
                } catch (e) {
                    if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error(e);
                }
            };

        })();

/**
 * core-parts/07-final-overrides.js
 * Emergency rescue + final UI/data overrides
 * Lines from original core.js: 13871-14624
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
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
                var date = value ? window.safeParseDate(value) : new Date();
                if (Number.isNaN(date.getTime())) date = new Date();
                return date.toLocaleString();
            }

            function renderStatThumb(summary) {
                if (summary && summary.hasImg && summary.thumbUrl) {
                    return '<img class="spi-thumb" loading="lazy" decoding="async" src="' + escapeHtml(summary.thumbUrl) + '" alt="帖子缩略图" loading="lazy">';
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
                var history = (Array.isArray(statViewEvents) ? statViewEvents : []).map(function(event) {
                    var detail = {};
                    try { detail = JSON.parse(event && event.content || '{}'); } catch (_) {}
                    return {
                        user_name: event && event.user_name,
                        post_id: detail.post_id || (event && event.media_url),
                        post_author: detail.post_author,
                        post_content: detail.post_content,
                        media_url: detail.media_url,
                        media_type: detail.media_type,
                        viewed_at: detail.viewed_at || (event && event.created_at)
                    };
                });
                if (!history.length) {
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无用户浏览记录</div>';
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
                    var raw = window.safeStorage.get(CACHE_KEY);
                    if (!raw) return null;
                    var parsed = JSON.parse(raw);
                    return normalizeFeedSnapshotCache(parsed);
                } catch (e) {
                    return null;
                }
            }

            function readAnnouncementCache() {
                try {
                    var raw = window.safeStorage.get(ANN_CACHE_KEY);
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

            function applyStatSnapshot(posts, comments, likes, viewEvents) {
                var visiblePosts = normalizePosts(Array.isArray(posts) ? posts : []).filter(function(p) {
                    return p && !isSystemPost(p) && canViewPost(p);
                });
                var visiblePostIds = new Set(visiblePosts.map(function(p) { return String(p.id); }));
                statAllPosts = visiblePosts;
                statAllComments = (Array.isArray(comments) ? comments : []).filter(function(c) {
                    return c && visiblePostIds.has(String(c.post_id));
                });
                statAllLikes = (Array.isArray(likes) ? likes : []).filter(function(l) {
                    return l && visiblePostIds.has(String(l.post_id));
                });
                if (Array.isArray(viewEvents)) {
                    // 本人过滤：仅保留"他人浏览了我（当前用户）的帖子"的记录，
                    // 避免泄露全站任意用户间的浏览关系（post_author 存于 content JSON）。
                    var me = String(window.currentUser || '').trim();
                    statViewEvents = viewEvents.filter(function(event) {
                        if (!event) return false;
                        if (!visiblePostIds.has(String(event.media_url))) return false;
                        if (!me) return false; // 未登录时不展示任何浏览记录
                        var author = '';
                        try {
                            var parsed = JSON.parse(String(event.content || '{}'));
                            if (parsed && typeof parsed === 'object') author = String(parsed.post_author || '').trim();
                        } catch (e) {}
                        if (author) return author === me;
                        // content 缺失时按帖子归属兜底
                        var owner = postInfoCache && postInfoCache[String(event.media_url)] && postInfoCache[String(event.media_url)].user_name;
                        return owner ? String(owner) === me : false;
                    });
                }
                var postsCountEl = document.getElementById('sPosts');
                var viewsCountEl = document.getElementById('sViews');
                var likesCountEl = document.getElementById('sLikes');
                if (postsCountEl) postsCountEl.textContent = String(visiblePosts.length);
                if (viewsCountEl) viewsCountEl.textContent = String(statViewEvents.length);
                // 只显示点赞数，不再把评论混进"总点赞"
                if (likesCountEl) likesCountEl.textContent = String(statAllLikes.length);
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
                        likes: statAllLikes,
                        view_events: statViewEvents
                    };
                }
                if (!force && statDataPromise) return statDataPromise;
                statDataPromise = fetchStatSnapshotWithTimeout(5000).then(function(snapshot) {
                    if (snapshot) {
                        applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes, snapshot.view_events);
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
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes, snapshot.view_events);
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
                var request = window.xtjProtectedFetch('/api/stats/snapshot?limit=1000')
                .then(function(response) {
                    return response.json().then(function(result) {
                        if (!response.ok || !result.ok) throw new Error(result.error || '统计加载失败');
                        return {
                            posts: result.posts || [],
                            comments: result.comments || [],
                            likes: result.likes || [],
                            view_events: result.view_events || [],
                            totals: result.totals || {}
                        };
                    });
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
                    if (gsapCache === false) gsapCache = typeof window.gsap !== 'undefined';
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
                await loadFeed(true);
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
            
            // Add sticky header behavior and class
            var _navHeader = document.querySelector('.posts-nav');
            if (_navHeader) _navHeader.classList.add('sticky-header');
            
            var _panelPosts = document.getElementById('panelPosts');
            var _scrollTarget = _panelPosts || window;
            _scrollTarget.addEventListener('scroll', window.throttleRAF(function() {
                var header = document.querySelector('.posts-nav.sticky-header');
                if (!header) return;
                var currentScrollY = _scrollTarget.scrollTop || window.scrollY;
                if (typeof window._lastHeaderScrollY === 'undefined') window._lastHeaderScrollY = 0;
                if (currentScrollY > 50 && currentScrollY > window._lastHeaderScrollY) {
                    header.classList.add('hidden-header');
                } else {
                    header.classList.remove('hidden-header');
                }
                window._lastHeaderScrollY = currentScrollY;
            }));
            
        })();
