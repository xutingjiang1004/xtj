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
            // 占位符 key（含省略号，如 "eyJhbG...yDDA"）是构建期未注入 env 的标志——
            // 本地开发/静态托管时降级继续（REST 主流程可用），不硬失败；其余格式错误 fail-fast
            var _anonKey = String(SUPABASE_ANON_KEY || '');
            var _sbConfigOk = !!SUPABASE_URL && !!_anonKey && (
              /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(_anonKey)
              || /^sb_publishable_/.test(_anonKey)
              || _anonKey.indexOf('...') > -1
            );
            if (!_sbConfigOk) {
                console.error('[XTJ] Supabase 配置缺失或格式不正确，请检查 config.js 或环境变量');
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
            var USER_TOKEN_KEY = 'xtj_user_token';
            var USER_TOKEN_TS_KEY = 'xtj_user_token_ts';
            var memoryUserToken = '';
            var memoryUserTokenIssuedAt = 0;
            // 共享 refresh promise，避免多个 API 同时刷新
            var _refreshPromise = null;
            var _protectedAuthFailureHandled = false;
            var _lastRefreshAuthResult = { ok: false, reason: 'not_attempted', status: 0 };
            // ★ 刷新时服务端返回的规范 user_name
            var _lastRefreshUser = '';
            // 持久化登录标记（用户选择"保持登录"）
            var PERSISTENT_AUTH_KEY = 'xtj_persistent_auth';
            // 会话写入时间戳。声明上移，保证 clearUserToken（TDZ 安全）
            // 及其后续所有引用均在此 let 声明之后。
            let lastUserSessionWriteAt = 0;

            function getUserToken() {
                // 仅从内存读取（会话内缓存；持久化令牌机制已移除）
                var token = memoryUserToken || '';
                // 检查是否过期
                if (token) {
                    var ts = memoryUserTokenIssuedAt;
                    if (ts && (Date.now() - ts > 15 * 60 * 1000)) {
                        // access token 可能已过期，尝试刷新
                        memoryUserToken = '';
                        memoryUserTokenIssuedAt = 0;
                        token = '';
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
                    try {
                        window.__xtjAuthReady = true;
                        window.dispatchEvent(new CustomEvent('auth-ready', { detail: { token: String(token) } }));
                    } catch(e) {}
                }
            }

            function setPersistentAuth(enabled) {
                try {
                    if (enabled) {
                        window.safeStorage.set(PERSISTENT_AUTH_KEY, '1');
                    } else {
                        window.safeStorage.remove(PERSISTENT_AUTH_KEY);
                    }
                } catch(e) {}
            }

            function isPersistentAuth() {
                try {
                    return window.safeStorage.get(PERSISTENT_AUTH_KEY) === '1';
                } catch(e) { return false; }
            }

            function clearUserToken() {
                memoryUserToken = '';
                memoryUserTokenIssuedAt = 0;
                lastUserSessionWriteAt = 0;
                try { sessionStorage.removeItem(USER_TOKEN_KEY); } catch(e) {}
                try { sessionStorage.removeItem(USER_TOKEN_TS_KEY); } catch(e) {}
                try { window.safeStorage.remove(USER_TOKEN_KEY); } catch(e) {}
                try { window.safeStorage.remove(USER_TOKEN_TS_KEY); } catch(e) {}
                try { window.safeStorage.remove(PERSISTENT_AUTH_KEY); } catch(e) {}
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
                    fetch(API_BASE + '/api/user/logout', {
                        method: 'POST', credentials: 'include', headers: logoutHeaders
                    }).catch(function(){});
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
                var existingToken = getUserToken();
                if (existingToken) return existingToken;
                // 尝试用 refresh token 刷新
                var result = await refreshUserTokenViaCookie();
                return (result && result.token) || '';
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
            // Code must load its filesystem bridge before evaluating the workspace.
            'code-fs': { scripts: ['xtj-module-code-fs'] },
            'code-workspace': {
                dependencies: ['code-fs'],
                styles: ['xtj-module-code-style', 'xtj-module-code-claude-style'],
                scripts: ['xtj-module-code-workspace']
            },
            'photo-wall': { scripts: ['xtj-module-photo-data', 'xtj-module-photo-render', 'xtj-module-photo-main'] },
            'photo-preview': { styles: ['xtj-module-photo-preview-style'], scripts: ['xtj-module-photo-preview', 'xtj-module-photo-preview-hotfix'] },
            'photo-upload': { dependencies: ['photo-wall'], scripts: ['xtj-module-photo-upload'] },
            gsap: { externalScripts: ['https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'] }
        };
        var xtjModulePromises = Object.create(null);
        // Render can take longer than 15 seconds to cold-deliver the lazy Code bundle.
        // Keep one bounded retry window instead of failing into an empty Code surface.
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
                    if (moduleName === 'code-fs') valid = !!(window.__xtjCodeFS && typeof window.__xtjCodeFS.readFileByPath === 'function');
                    if (moduleName === 'code-workspace') valid = !!(window.__xtjCodeWorkspaceAPI && typeof window.__xtjCodeWorkspaceAPI.init === 'function');
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

