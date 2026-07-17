(function() {
    // ===================== 安全配置（从 window.XTJ_CONFIG 读取） =====================
    // 重要：禁止在本文件中硬编码 API_BASE
    // API_BASE 由 js/config.js 注入，或由 Render 部署环境动态设置
    var AUTH_MARKER = "__auth__";
    var ADMIN_AUTH_MARKER = "__admin_auth__";
    var DM_MARKER = "__dm__";
    var ANN_MARKER = "__ann__";
    var REPORT_MARKER = '__report__';
    var SECURITY_ALERT_MARKER = '__security_alert__';
    var AUDIT_LOG_MARKER = '__admin_audit__';
    var CLIENT_ERROR_MARKER = '__client_error__';
    var SESSION_KEY = "xtj_admin_session";
    var TOKEN_KEY = "xtj_admin_token";
    var TAB_KEY = "xtj_admin_tab";
    var ADMIN = '';


    // 根据 iOS/Safari 可见参数推测 iPhone 疑似型号；仅供管理员后台辅助判断，非精确识别
    // 从 User-Agent 提取 iOS 主版本号
    function getIosMajorVersion(ua) {
        var match = ua.match(/iPhone OS (\d+)_/);
        if (match) return parseInt(match[1], 10);
        return null;
    }

    // 根据 iOS/Safari 暴露的屏幕参数推测 iPhone 疑似型号；结合 iOS 版本号缩小猜测范围
    function getPossibleDeviceModel(info) {
        info = info || {};
        var meta = info.device_meta || info;
        var ua = String(info.user_agent || meta.user_agent || '');
        var platform = String(meta.platform || info.platform || '');
        var maxTouchPoints = Number(meta.max_touch_points || info.max_touch_points || 0);
        var sw = Number(meta.screen_width || info.screen_width || (meta.screen && String(meta.screen).split('x')[0])) || 0;
        var sh = Number(meta.screen_height || info.screen_height || (meta.screen && String(meta.screen).split('x')[1])) || 0;
        if (!sw || !sh) {
            sw = Number(meta.visual_viewport_width || info.visual_viewport_width) || Number(meta.inner_width || info.inner_width) || 0;
            sh = Number(meta.visual_viewport_height || info.visual_viewport_height) || Number(meta.inner_height || info.inner_height) || 0;
        }
        var dpr = Number(meta.device_pixel_ratio || meta.dpr || info.device_pixel_ratio || info.dpr) || 0;
        var isIPhone = /iPhone/i.test(ua) || String(info.device_type || '').toLowerCase() === 'iphone' || (/Mac/i.test(platform) && maxTouchPoints > 1 && Math.min(sw, sh) < 600);
        if (!isIPhone) return '';

        var key = Math.min(sw, sh) + 'x' + Math.max(sw, sh) + '@' + (dpr || '');
        if (!sw || !sh) return '';
        var iosVer = getIosMajorVersion(ua);
        // 优先用 UA 中的设备型号标识符精确匹配
        var uaModel = (ua.match(/iPhone\d+,\d+/) || [''])[0];
        // UA 设备型号标识符 → 型号名称映射（优先于分辨率推断）
        var uaModelMap = {
            'iPhone17,4': 'iPhone 16 Plus',
            'iPhone17,3': 'iPhone 16',
            'iPhone17,2': 'iPhone 16 Pro Max',
            'iPhone17,1': 'iPhone 16 Pro',
            'iPhone16,2': 'iPhone 15 Pro Max',
            'iPhone16,1': 'iPhone 15 Pro',
            'iPhone15,5': 'iPhone 15 Plus',
            'iPhone15,4': 'iPhone 15',
            'iPhone15,3': 'iPhone 14 Pro Max',
            'iPhone15,2': 'iPhone 14 Pro',
            'iPhone14,8': 'iPhone 14 Plus',
            'iPhone14,7': 'iPhone 14',
            'iPhone15,1': 'iPhone 13 mini',
            'iPhone14,6': 'iPhone SE (3rd gen)',
            'iPhone14,5': 'iPhone 13',
            'iPhone14,4': 'iPhone 13 mini',
            'iPhone14,2': 'iPhone 13 Pro',
            'iPhone14,3': 'iPhone 13 Pro Max',
            'iPhone13,4': 'iPhone 12 Pro Max',
            'iPhone13,3': 'iPhone 12 Pro',
            'iPhone13,2': 'iPhone 12',
            'iPhone13,1': 'iPhone 12 mini',
            'iPhone12,8': 'iPhone SE (2nd gen)',
            'iPhone12,5': 'iPhone 11 Pro Max',
            'iPhone12,3': 'iPhone 11 Pro',
            'iPhone12,1': 'iPhone 11',
            'iPhone11,8': 'iPhone XR',
            'iPhone11,6': 'iPhone XS Max',
            'iPhone11,2': 'iPhone XS',
            'iPhone10,6': 'iPhone X',
            'iPhone10,3': 'iPhone X',
            'iPhone10,5': 'iPhone 8 Plus',
            'iPhone10,2': 'iPhone 8 Plus',
            'iPhone10,4': 'iPhone 8',
            'iPhone10,1': 'iPhone 8',
            'iPhone9,4': 'iPhone 7 Plus',
            'iPhone9,3': 'iPhone 7',
            'iPhone9,2': 'iPhone 7 Plus',
            'iPhone9,1': 'iPhone 7',
            'iPhone8,4': 'iPhone SE (1st gen)',
            'iPhone8,2': 'iPhone 6s Plus',
            'iPhone8,1': 'iPhone 6s'
        };
        var uaModelName = uaModelMap[uaModel];
        if (uaModelName) return uaModelName;
        var modelMap = {
            '440x956@3': function() {
                if (iosVer !== null && iosVer < 19) return 'iPhone 16 Pro Max';
                return 'iPhone 16 Pro Max / iPhone 17 Pro Max';
            },
            '402x874@3': function() {
                if (iosVer !== null && iosVer < 19) return 'iPhone 16 Pro';
                if (iosVer !== null && iosVer >= 19) return 'iPhone 17 / iPhone 17 Pro';
                return 'iPhone 16 Pro / iPhone 17 / iPhone 17 Pro';
            },
            '393x852@3': function() {
                if (iosVer !== null && iosVer === 16) return 'iPhone 14 Pro';
                if (iosVer !== null && iosVer === 17) return 'iPhone 15 / iPhone 15 Pro';
                if (iosVer !== null && iosVer >= 18) return 'iPhone 16';
                return 'iPhone 14 Pro / iPhone 15 / iPhone 15 Pro / iPhone 16';
            },
            '430x932@3': function() {
                if (iosVer !== null && iosVer === 16) return 'iPhone 14 Pro Max';
                if (iosVer !== null && iosVer === 17) return 'iPhone 15 Plus / iPhone 15 Pro Max';
                if (iosVer !== null && iosVer >= 18) return 'iPhone 16 Plus';
                return 'iPhone 14 Pro Max / iPhone 15 Plus / iPhone 15 Pro Max / iPhone 16 Plus';
            },
            '428x926@3': function() {
                if (iosVer !== null && iosVer <= 15) return 'iPhone 12 Pro Max / iPhone 13 Pro Max';
                if (iosVer !== null && iosVer >= 16) return 'iPhone 14 Plus';
                return 'iPhone 12 Pro Max / iPhone 13 Pro Max / iPhone 14 Plus';
            },
            '390x844@3': function() {
                if (iosVer !== null && iosVer <= 14) return 'iPhone 12 / iPhone 12 Pro';
                if (iosVer !== null && iosVer === 15) return 'iPhone 13 / iPhone 13 Pro';
                if (iosVer !== null && iosVer >= 16) return 'iPhone 14';
                return 'iPhone 12 / iPhone 12 Pro / iPhone 13 / iPhone 13 Pro / iPhone 14';
            },
            '375x812@3': function() {
                if (iosVer !== null && iosVer <= 11) return 'iPhone X';
                if (iosVer !== null && iosVer === 12) return 'iPhone XS';
                if (iosVer !== null && iosVer === 13) return 'iPhone 11 Pro';
                if (iosVer !== null && iosVer === 14) return 'iPhone 12 mini';
                if (iosVer !== null && iosVer >= 15) return 'iPhone 13 mini';
                return 'iPhone X / iPhone XS / iPhone 11 Pro / iPhone 12 mini / iPhone 13 mini';
            },
            '414x896@3': function() {
                if (iosVer !== null && iosVer <= 12) return 'iPhone XS Max';
                if (iosVer !== null && iosVer >= 13) return 'iPhone 11 Pro Max';
                return 'iPhone XS Max / iPhone 11 Pro Max';
            },
            '414x896@2': function() {
                if (iosVer !== null && iosVer <= 12) return 'iPhone XR';
                if (iosVer !== null && iosVer >= 13) return 'iPhone 11';
                return 'iPhone XR / iPhone 11';
            },
            '414x736@3': 'iPhone 6 Plus / 6s Plus / 7 Plus / 8 Plus',
            '375x667@2': 'iPhone 6 / 6s / 7 / 8 / SE（第 2/3 代）',
            '320x568@2': 'iPhone 5 / 5s / SE（第 1 代）'
        };
        var matcher = modelMap[key];
        if (typeof matcher === 'function') return matcher();
        return matcher || '';
    }

    // ===================== API_BASE 安全检测 =====================
    // 取全局配置，若未配置则拒绝进入管理后台
    var API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || "";
    if (!API_BASE) {
        console.error('[admin] 后台 API 未配置（window.XTJ_CONFIG.API_BASE 为空），已拒绝进入管理后台');
        // 页面加载后显示错误
        document.addEventListener('DOMContentLoaded', function() {
            var container = document.getElementById('loginContainer') || document.body;
            if (container) {
                container.innerHTML = '<div style="padding:40px;text-align:center;font-size:18px;color:#e74c3c;">'
                    + '<h2>安全拒绝</h2>'
                    + '<p>后台 API 未配置，已拒绝进入管理后台。</p>'
                    + '<p style="font-size:14px;color:#888;">请联系管理员配置 <code>window.XTJ_CONFIG.API_BASE</code></p>'
                    + '</div>';
            }
        });
    }

    // 禁止创建 Supabase 直连客户端 — 所有管理操作必须通过 API_BASE
    // 不移除 window.sb，避免影响前台页面功能

    // ===================== Token 管理（前后端共享，仅用于 API 鉴权） =====================
    var TOKEN_SALT = 'xtj_7k3m';

    // localStorage存储（非安全措施，仅防明文泄露）
    function _obfuscateToken(raw) {
        if (!raw) return '';
        var result = '';
        for (var i = 0; i < raw.length; i++) {
            result += String.fromCharCode(raw.charCodeAt(i) ^ TOKEN_SALT.charCodeAt(i % TOKEN_SALT.length));
        }
        return btoa(result);
    }

    function _deobfuscateToken(encoded) {
        if (!encoded) return '';
        try {
            var raw = atob(encoded);
            var result = '';
            for (var i = 0; i < raw.length; i++) {
                result += String.fromCharCode(raw.charCodeAt(i) ^ TOKEN_SALT.charCodeAt(i % TOKEN_SALT.length));
            }
            return result;
        } catch(e) { return ''; }
    }

    // ===================== 密码哈希（前端不再验证密码，仅保留供其他场景使用） =====================
    // 注意：管理员密码验证只发生在后端 /admin/login
    // 以下函数保留但不用于管理员登录验证
    async function adminPbkdf2Hash(password, salt) {
        var enc = new TextEncoder();
        var keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
        );
        var bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
            keyMaterial, 256
        );
        return Array.from(new Uint8Array(bits)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    // ===================== Session 超时管理（24小时无操作自动登出） =====================
    var ADMIN_SESSION_TTL_MS = 72 * 60 * 60 * 1000; // 72小时
    var SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24小时无操作自动退出
    var lastActivityTime = Date.now();
    var sessionTimeoutMonitorStarted = false;
    var _adminSessionTimer = null;
    var _adminReportPollTimer = null;
    function resetActivityTimer() { lastActivityTime = Date.now(); }
    function startSessionTimeoutMonitor() {
        if (sessionTimeoutMonitorStarted) return;
        sessionTimeoutMonitorStarted = true;
        ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt) {
            document.addEventListener(evt, resetActivityTimer, { passive: true });
        });
        _adminSessionTimer = setInterval(function() {
            if (Date.now() - lastActivityTime > SESSION_TIMEOUT_MS) {
                console.warn('[admin] 会话超时，自动登出');
                window.doAdminLogout();
            }
        }, 30000); // 每30秒检查一次
    }

    var allPosts = [], allLikes = [], allComments = [], allUsers = [], annList = [], allLoginEvents = [], allBehaviorEvents = [], allClipboardEntries = [], allSecurityAlerts = [], allAuditLogs = [], allErrorLogs = [];
    var adminDataLoadedAt = 0;
    var adminDataLoading = false;
    var adminTabDataLoaded = {};
    var adminDataLoadPromises = {};
    var adminTabSwitchGeneration = 0;
    var adminClipboardPage = 1, adminClipboardTotal = 0, adminClipboardPages = 1;
    var searchUser = '', searchPost = '';

    function getTabDomName(tab) {
        if (tab === 'errorlog') return 'ErrorLog';
        return tab.charAt(0).toUpperCase() + tab.slice(1);
    }
    var userFilterStatus = 'all';
    var userSortBy = 'reg';
    var confirmCallback = null;
    var currentTab = 'ann';
    var registerAlertState = {
        data: null,
        pollTimer: null,
        pollInFlight: false,
        readInFlight: false
    };

    function ensureRegisterAlertBadge() {
        var btn = document.getElementById('tabUsersBtn');
        if (!btn) return null;
        btn.style.position = 'relative';
        btn.style.overflow = 'visible';
        var badge = document.getElementById('registerAlertBadge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'registerAlertBadge';
            badge.className = 'notif-badge';
            badge.style.display = 'none';
            btn.appendChild(badge);
        }
        return badge;
    }

    function renderRegisterAlertBadge(unreadCount) {
        var badge = ensureRegisterAlertBadge();
        if (!badge) return;
        var count = Number(unreadCount || 0);
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    function clearRegisterAlertBadge() {
        renderRegisterAlertBadge(0);
    }

    async function fetchRegisterAlerts() {
        if (!API_BASE) return null;
        try {
            return await apiCall('GET', '/admin/users/register-alerts');
        } catch (e) {
            console.warn('[admin] 新用户注册提醒加载失败:', e.message);
            return null;
        }
    }

    async function markRegisterAlertsRead() {
        if (!API_BASE || registerAlertState.readInFlight) return false;
        registerAlertState.readInFlight = true;
        try {
            var res = await apiCall('POST', '/admin/users/register-alerts/read');
            registerAlertState.data = {
                ok: true,
                unread_count: 0,
                last_seen_at: (res && res.last_seen_at) || new Date().toISOString(),
                latest_register_at: null,
                users: []
            };
            clearRegisterAlertBadge();
            return true;
        } catch (e) {
            console.warn('[admin] 新用户注册提醒已读写入失败:', e.message);
            return false;
        } finally {
            registerAlertState.readInFlight = false;
        }
    }

    async function refreshRegisterAlerts() {
        if (registerAlertState.pollInFlight) return;
        registerAlertState.pollInFlight = true;
        try {
            var data = await fetchRegisterAlerts();
            if (!data || data.ok !== true) return;
            registerAlertState.data = data;
            var unreadCount = Number(data.unread_count || 0);
            if (currentTab === 'users' && unreadCount > 0) {
                var didRead = await markRegisterAlertsRead();
                if (!didRead) renderRegisterAlertBadge(unreadCount);
                return;
            }
            renderRegisterAlertBadge(unreadCount);
        } finally {
            registerAlertState.pollInFlight = false;
        }
    }

    function startRegisterAlertPolling() {
        ensureRegisterAlertBadge();
        if (registerAlertState.pollTimer) {
            clearInterval(registerAlertState.pollTimer);
        }
        refreshRegisterAlerts().catch(function() {});
        registerAlertState.pollTimer = setInterval(function() {
            refreshRegisterAlerts().catch(function() {});
        }, 60000);
    }

    function stopRegisterAlertPolling() {
        if (registerAlertState.pollTimer) {
            clearInterval(registerAlertState.pollTimer);
            registerAlertState.pollTimer = null;
        }
        registerAlertState.pollInFlight = false;
        registerAlertState.readInFlight = false;
        registerAlertState.data = null;
        clearRegisterAlertBadge();
    }

    (function installAdminButtonMotion() {
        if (window.__xtjAdminButtonMotionV1) return;
        window.__xtjAdminButtonMotionV1 = true;
        var selector = [
            'button',
            '[role="button"]',
            'input[type="button"]',
            'input[type="submit"]',
            'input[type="reset"]',
            '.admin-tab',
            '.filter-chip',
            '.action-pill',
            '.user-option'
        ].join(',');

        function getMotionTarget(event) {
            var target = event.target && event.target.closest ? event.target.closest(selector) : null;
            if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return null;
            return target;
        }

        document.addEventListener('pointerdown', function(event) {
            var target = getMotionTarget(event);
            if (!target) return;
            target.classList.remove('xtj-btn-release');
            target.classList.add('xtj-btn-pressing');
        }, true);

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(type) {
            document.addEventListener(type, function(event) {
                var target = getMotionTarget(event);
                if (!target || !target.classList.contains('xtj-btn-pressing')) return;
                target.classList.remove('xtj-btn-pressing');
                target.classList.add('xtj-btn-release');
                setTimeout(function() {
                    target.classList.remove('xtj-btn-release');
                }, 240);
            }, true);
        });

        document.addEventListener('click', function(event) {
            var target = getMotionTarget(event);
            if (!target) return;
            target.classList.add('xtj-btn-clicked');
            try {
                var rect = target.getBoundingClientRect();
                var ripple = document.createElement('span');
                var size = Math.max(rect.width, rect.height) * 1.35;
                ripple.className = 'xtj-btn-ripple';
                ripple.style.width = size + 'px';
                ripple.style.height = size + 'px';
                ripple.style.left = (event.clientX - rect.left - size / 2) + 'px';
                ripple.style.top = (event.clientY - rect.top - size / 2) + 'px';
                target.appendChild(ripple);
                setTimeout(function() {
                    if (ripple && ripple.parentNode) ripple.parentNode.removeChild(ripple);
                }, 360);
            } catch (e) {}
            setTimeout(function() {
                target.classList.remove('xtj-btn-clicked');
            }, 260);
        }, true);
    })();

    // ===================== API 辅助函数 =====================
    function getToken() {
        try { return _deobfuscateToken(localStorage.getItem(TOKEN_KEY) || ''); } catch(e) { return ''; }
    }

    function setToken(t) {
        try { localStorage.setItem(TOKEN_KEY, _obfuscateToken(t)); } catch(e) {}
    }

    function clearToken() {
        try { localStorage.removeItem(TOKEN_KEY); } catch(e) {}
    }

    function isFetchAbortError(e) {
        var msg = String((e && e.message) || e || '').toLowerCase();
        return (e && e.name === 'AbortError') || msg.indexOf('abort') >= 0 || msg.indexOf('fetch is aborted') >= 0;
    }

    async function apiCall(method, path, body, options) {
        options = options || {};
        if (!API_BASE) {
            throw new Error('API_BASE 未配置');
        }
        var opts = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        var token = getToken();
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        if (body) opts.body = JSON.stringify(body);
        var timeoutMs = Number(options.timeoutMs) || 30000;
        var ac = new AbortController();
        var at = setTimeout(function() { ac.abort(); }, timeoutMs);
        opts.signal = ac.signal;
        opts.credentials = 'same-origin';
        var res;
        try { res = await fetch(API_BASE + path, opts); } finally { clearTimeout(at); }
        var data = await res.json();
        if (res.status === 401) {
            clearSession();
            try {
                document.getElementById('dashboard').style.display = 'none';
                document.getElementById('loginWrap').style.display = 'flex';
            } catch (e) {}
        }
        if (!res.ok) throw new Error(data.error || '请求失败 (' + res.status + ')');
        saveSession();
        return data;
    }

    function showToast(msg, type) {
        var wrap = document.getElementById('toastWrap');
        if (!wrap) return;
        var item = document.createElement('div');
        item.className = 'toast-item toast-' + (type || 'info');
        item.textContent = msg;
        wrap.appendChild(item);
        setTimeout(function() {
            if (item.parentNode) item.parentNode.removeChild(item);
        }, 2600);
    }

    window.showConfirm = function(title, msg, btnText, cb) {
        document.getElementById('confirmTitle').textContent = title || '确认操作';
        document.getElementById('confirmMsg').textContent = msg || '确定要执行此操作吗？';
        document.getElementById('confirmOkBtn').textContent = btnText || '确认删除';
        confirmCallback = cb;
        document.getElementById('confirmModal').classList.add('active');
    };

    window.closeConfirm = function() {
        document.getElementById('confirmModal').classList.remove('active');
        confirmCallback = null;
    };

    window.execConfirm = function() {
        document.getElementById('confirmModal').classList.remove('active');
        if (typeof confirmCallback === 'function') {
            var cb = confirmCallback;
            confirmCallback = null;
            cb();
        }
    };

    function saveSession() {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ t: Date.now() }));
    }

    function saveCurrentTab() {
        localStorage.setItem(TAB_KEY, currentTab);
    }

    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
        clearToken();
    }

    function hasSession() {
        try {
            var raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return false;
            var s = JSON.parse(raw);
            return !!s && (Date.now() - Number(s.t || 0)) < ADMIN_SESSION_TTL_MS;
        } catch(e) { return false; }
    }

    async function tryRestoreAdminSession() {
        if (!API_BASE || !hasSession()) {
            clearSession();
            return false;
        }

        try {
            var res = await apiCall('GET', '/admin/verify');
            if (res && res.ok === true) {
                await initAdminClient();
                return true;
            }
            clearSession();
        } catch (e) {
            clearSession();
        }

        return false;
    }

    // 安全说明：不再创建 Supabase 客户端，所有管理操作通过 API_BASE 执行
    // ===================== 双击 Tab 刷新数据 =====================
    window.refreshAdminTab = async function(tab) {
        var normalized = tab || currentTab || 'ann';
        try {
            currentTab = normalized;
            saveCurrentTab();
            showToast('正在刷新数据...', 'info');

            var allTabs = ['ann','stats','users','clipboard','security','posts','likes','comments','reports','bans','mutes','photos','email','audit','errorlog','ai'];
            allTabs.forEach(function(t) {
                var panel = document.getElementById('tab' + getTabDomName(t));
                var btn = document.getElementById('tab' + getTabDomName(t) + 'Btn');
                if (panel) panel.classList.remove('active');
                if (btn) btn.classList.remove('active');
            });

            var panel = document.getElementById('tab' + getTabDomName(normalized));
            var btn = document.getElementById('tab' + getTabDomName(normalized) + 'Btn');
            if (panel) panel.classList.add('active');
            if (btn) btn.classList.add('active');

            await loadAllData(true);
            await loadTabDataIfNeeded(normalized);
            renderTab(normalized);
            showToast('数据已刷新', 'success');
        } catch(e) {
            showToast('刷新失败：' + e.message, 'error');
        }
    };

    function installAdminTabDoubleClickRefresh() {
        if (window.__xtjAdminTabDblRefresh) return;
        window.__xtjAdminTabDblRefresh = true;

        document.addEventListener('dblclick', function(e) {
            var btn = e.target && e.target.closest ? e.target.closest('.dash-header .dh-right button[id^="tab"]') : null;
            if (!btn) return;

            var onclickText = btn.getAttribute('onclick') || '';
            var match = onclickText.match(/switchTab\('([^']+)'\)/);
            if (!match || !match[1]) return;

            e.preventDefault();
            e.stopPropagation();
            window.refreshAdminTab(match[1]);
        }, true);
    }

async function initAdminClient() {
        document.getElementById('loginWrap').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        resetActivityTimer();
        saveSession();
        ensureRegisterAlertBadge();
        startSessionTimeoutMonitor();
        installAdminTabDoubleClickRefresh();
        
        var allowedTabs = ['ann','stats','users','clipboard','security','audit','errorlog','posts','likes','comments','reports','bans','mutes','photos','email','ai'];
        var savedTab = localStorage.getItem(TAB_KEY);
        if (savedTab && allowedTabs.indexOf(savedTab) !== -1) {
            currentTab = savedTab;
            await loadAllData(true);
            allowedTabs.forEach(function(t) {
                var panel = document.getElementById('tab' + getTabDomName(t));
                var btn = document.getElementById('tab' + getTabDomName(t) + 'Btn');
                if (panel) panel.classList.remove('active');
                if (btn) btn.classList.remove('active');
            });
            var activePanel = document.getElementById('tab' + getTabDomName(savedTab));
            var activeBtn = document.getElementById('tab' + getTabDomName(savedTab) + 'Btn');
            if (activePanel) activePanel.classList.add('active');
            if (activeBtn) activeBtn.classList.add('active');
            await loadTabDataIfNeeded(savedTab);
            await window.renderTab(savedTab);
        } else {
            await loadAllData();
        }
        startRegisterAlertPolling();

        if (_adminReportPollTimer) clearInterval(_adminReportPollTimer);
        _adminReportPollTimer = setInterval(async function() {
            try {
                var prevLen = reportsData.length;
                await loadReportsData();
                if (currentTab === 'reports' && reportsData.length !== prevLen) {
                    var el = document.getElementById('tabReports');
                    if (el) renderReportsTab(el);
                }
            } catch (e) { /* 静默, 下次重试 */ }
        }, 30000);
    }

    // ===================== 管理员登录（通过 API 或本地回退） =====================
    window.doAdminLogin = async function() {
        var name = document.getElementById('loginName').value.trim();
        var pw = document.getElementById('loginPw').value;
        var err = document.getElementById('loginErr');
        var btn = document.querySelector('#loginWrap button');
        
        if (!API_BASE) {
            err.textContent = '后台 API 未配置，拒绝登录';
            return;
        }
        if (!name) { err.textContent = '请输入管理员账号'; return; }
        if (!pw) { err.textContent = '请输入密码'; return; }
        
        err.textContent = '';
        
        // 仅通过 API 认证 — 禁止直连 Supabase
        btn.disabled = true;
        btn.textContent = '验证中...';
        try {
            var res = await fetch(API_BASE + '/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: name, password: pw })
            });
            var data = await res.json();
            if (!res.ok || !data || data.ok !== true) {
                err.textContent = data && data.error ? data.error : '登录失败 (' + res.status + ')';
                btn.disabled = false;
                btn.textContent = '登录';
                return;
            }
            if (!data.token || typeof data.token !== 'string' || !data.token.trim()) {
                err.textContent = '服务端未返回有效 Token，请重试';
                btn.disabled = false;
                btn.textContent = '登录';
                return;
            }
            ADMIN = name;
            setToken(data.token);
            try {
                await initAdminClient();
            } catch (initErr) {
                ADMIN = null;
                clearToken();
                err.textContent = '初始化失败：' + (initErr && initErr.message || '未知错误');
                btn.disabled = false;
                btn.textContent = '登录';
                document.getElementById('loginWrap').style.display = 'flex';
                document.getElementById('dashboard').style.display = 'none';
                return;
            }
        } catch(e) {
            ADMIN = null;
            err.textContent = 'API 连接失败，请检查网络';
            btn.disabled = false;
            btn.textContent = '登录';
        }
    };

    window.confirmLogout = function() {
        showConfirm('退出管理后台', '确定要退出当前管理账号吗？', '确定退出', function() {
            window.doAdminLogout();
        });
    };

    window.doAdminLogout = function() {
        if (API_BASE) {
            var _token = getToken();
            var _opts = { method: 'POST', credentials: 'same-origin' };
            if (_token) _opts.headers = { 'Authorization': 'Bearer ' + _token };
            fetch(API_BASE + '/admin/logout', _opts).catch(function() {});
        }
        stopRegisterAlertPolling();
        // 清理定时器和事件监听
        if (_adminSessionTimer) { clearInterval(_adminSessionTimer); _adminSessionTimer = null; }
        if (_adminReportPollTimer) { clearInterval(_adminReportPollTimer); _adminReportPollTimer = null; }
        ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt) {
            document.removeEventListener(evt, resetActivityTimer);
        });
        allPosts = []; allLikes = []; allComments = []; allUsers = [];
        allLoginEvents = []; allBehaviorEvents = []; allClipboardEntries = []; allSecurityAlerts = [];
        allAuditLogs = []; allErrorLogs = [];
        annList = [];
        adminTabDataLoaded = {}
        adminDataLoadPromises = {};
        adminTabSwitchGeneration++;
        clearSession();
        document.getElementById('loginWrap').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginName').value = '';
        document.getElementById('loginPw').value = '';
    };

    // 登录表单键盘导航：Enter 切换到下一栏/提交
    var loginNameEl = document.getElementById('loginName');
    var loginPwEl = document.getElementById('loginPw');
    if (loginNameEl) loginNameEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (loginPwEl) loginPwEl.focus();
        }
    });
    if (loginPwEl) loginPwEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            window.doAdminLogin();
        }
    });

    async function loadAllData(keepTab) {
        if (adminDataLoading) return;
        adminDataLoading = true;
        var lockTimeout = setTimeout(function() { adminDataLoading = false; }, 30000);
        try {
            if (!API_BASE) {
            throw new Error('API 未配置或未登录，拒绝加载数据');
        }
        var apiData = await apiCall('GET', '/admin/data');
            var postData = apiData.posts || [];
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__' && p.media_type !== SECURITY_ALERT_MARKER && p.media_type !== AUDIT_LOG_MARKER && p.media_type !== CLIENT_ERROR_MARKER; });
            annList = apiData.announcements || [];
            allLikes = apiData.likes || [];
            allComments = apiData.comments || [];
            bansData = apiData.bans || [];
            adminTabDataLoaded.posts = true;
            adminTabDataLoaded.likes = true;
            adminTabDataLoaded.comments = true;
            adminTabDataLoaded.anns = true;
            adminTabDataLoaded.bans = true;

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });
            
            allUsers = Object.keys(userMap).sort().map(function(u) {
                return {
                    name: u,
                    info: null
                };
            });

            if (!keepTab) {
                switchTab('ann');
            } else {
                await loadTabDataIfNeeded(currentTab);
                window.renderTab(currentTab);
            }
            adminDataLoadedAt = Date.now();
        } catch(e) {
            showToast('数据加载失败，请刷新重试', 'error');
        } finally {
            adminDataLoading = false;
            try { clearTimeout(lockTimeout); } catch (e) {}
        }
    }

    async function loadTabDataIfNeeded(tab) {
        var normalized = tab; // blacklist 保持原样，不 normalize 为 bans
        var tabDataMap = {
            'ann': { key: 'anns' },
            'posts': { key: 'posts' },
            'likes': { key: 'likes' },
            'comments': { key: 'comments' },
            'bans': { key: 'bans' },
            'mutes': { key: 'mutes' },
            'reports': { key: 'reports' },
            'blacklist': { key: 'blacklist' },
            'stats': { key: 'stats' },
            'users': { key: 'users', loaders: ['users', 'logins', 'security-alerts', 'mutes'] },
            'clipboard': { key: 'clipboard', loaders: ['users', 'clipboard'] },
            'uservisit': { key: 'users', loaders: ['users', 'logins', 'security-alerts', 'mutes'] },
            'security': { key: 'security-alerts', loaders: ['security-alerts', 'security-settings'] },
            'audit': { key: 'audit-logs' },
            'behavior': { key: 'behavior', loaders: ['logins'] },
            'errorlog': { key: 'error-logs' },
            'photos': { key: 'photos' },
            'logins': { key: 'login-events' },
            'errors': { key: 'error-logs' }
        };
        var info = tabDataMap[normalized];
        if (!info) return;
        if (info.loaders) {
            await Promise.all(info.loaders.map(function(dataType) {
                return _loadSingleDataType(dataType);
            }));
        } else {
            await _loadSingleDataType(info.key);
        }
    }

    async function _loadSingleDataType(dataType) {
        if (adminTabDataLoaded[dataType]) return;
        if (adminDataLoadPromises[dataType]) return adminDataLoadPromises[dataType];
        var pending = _loadSingleDataTypeUncached(dataType);
        adminDataLoadPromises[dataType] = pending;
        try {
            return await pending;
        } finally {
            if (adminDataLoadPromises[dataType] === pending) {
                delete adminDataLoadPromises[dataType];
            }
        }
    }

    async function _loadSingleDataTypeUncached(dataType) {
        try {
            if (dataType === 'users') {
                var userRes = await apiCall('GET', '/admin/users');
                var userInfoList = userRes.data || [];
                var userMap = {};
                allUsers.forEach(function(u) { userMap[u.name] = u; });
                userInfoList.forEach(function(ui) {
                    try {
                        var info = JSON.parse(ui.content || '{}');
                        var existing = userMap[ui.user_name];
                        if (existing) {
                            existing.info = mergeAdminUserInfo(existing.info, info);
                        } else {
                            var newUser = { name: ui.user_name, info: mergeAdminUserInfo(null, info) };
                            allUsers.push(newUser);
                            userMap[ui.user_name] = newUser;
                        }
                    } catch(e) {}
                });
                adminTabDataLoaded.users = true;
            } else if (dataType === 'logins' || dataType === 'login-events') {
                var loginRes = await apiCall('GET', '/admin/login-events');
                allLoginEvents = (loginRes && loginRes.data) || [];
                allBehaviorEvents = (loginRes && loginRes.behavior) || [];
                adminTabDataLoaded.logins = true;
                adminTabDataLoaded['login-events'] = true;
            } else if (dataType === 'clipboard') {
                var clipboardRes = await apiCall('GET', '/admin/clipboard-data?page=' + adminClipboardPage + '&limit=50');
                allClipboardEntries = normalizeAdminClipboardEntries(clipboardRes && (clipboardRes.data || clipboardRes.entries || clipboardRes.users) || []);
                adminClipboardTotal = Math.max(0, Number(clipboardRes && clipboardRes.total) || allClipboardEntries.length);
                adminClipboardPages = Math.max(1, Number(clipboardRes && clipboardRes.pages) || 1);
                adminTabDataLoaded.clipboard = true;
            } else if (dataType === 'security-alerts') {
                var secRes = await apiCall('GET', '/admin/security-alerts');
                allSecurityAlerts = secRes.data || [];
                adminTabDataLoaded['security-alerts'] = true;
            } else if (dataType === 'security-settings') {
                var settingsRes = await apiCall('GET', '/admin/security-settings');
                if (settingsRes && settingsRes.settings) securitySettings = settingsRes.settings;
                adminTabDataLoaded['security-settings'] = true;
            } else if (dataType === 'audit-logs') {
                var auditRes = await apiCall('GET', '/admin/audit-logs');
                allAuditLogs = auditRes.data || [];
                adminTabDataLoaded['audit-logs'] = true;
            } else if (dataType === 'error-logs') {
                var errorRes = await apiCall('GET', '/admin/error-logs');
                allErrorLogs = errorRes.data || [];
                adminTabDataLoaded['error-logs'] = true;
            } else if (dataType === 'photos') {
                await loadPhotosAdminData();
                adminTabDataLoaded.photos = true;
            } else if (dataType === 'reports') {
                var reportRes = await apiCall('GET', '/admin/reports');
                reportsData = reportRes.data || [];
                updateReportBadge();
                adminTabDataLoaded.reports = true;
            } else if (dataType === 'mutes') {
                var muteRes = await apiCall('GET', '/admin/mutes');
                mutesData = muteRes.data || [];
                adminTabDataLoaded.mutes = true;
            } else if (dataType === 'blacklist') {
                var blacklistRes = await apiCall('GET', '/admin/blacklist');
                blacklistData = blacklistRes.data || [];
                adminTabDataLoaded.blacklist = true;
            }
        } catch(e) {
            console.warn('[admin] 懒加载数据失败:', dataType, e.message);
            throw e;
        }
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function safeJsStr(s) {
        if (!s) return '';
        return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/</g, '\\x3C').replace(/>/g, '\\x3E').replace(/\n/g, '\\n');
    }

    function getDisplayContent(content) {
        if (!content) return '';
        try {
            var parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
                if (parsed.type === 'photo_wall') {
                    return '[照片] ' + (parsed.fileSize ? (parsed.fileSize / 1024).toFixed(0) + 'KB' : '');
                }
                if (parsed.text) return parsed.text;
                if (parsed.content) return parsed.content;
                if (parsed.title) return parsed.title;
            }
        } catch(e) {}
        return content;
    }

    function getAdminPostSummary(post) {
        var mediaType = String(post && post.media_type || '').toLowerCase();
        var hasImage = mediaType.indexOf('image') === 0 && !!(post && post.media_url);
        var rawContent = post && typeof post.content === 'string' ? post.content : '';
        var displayText = getDisplayContent(rawContent);
        var trimmedText = String(displayText || '').trim();
        try {
            var parsed = JSON.parse(rawContent || '{}');
            if (parsed && typeof parsed === 'object' && parsed.__type === '__xtj_post_v2__') {
                var parsedText = String(parsed.text || parsed.content || parsed.title || '').trim();
                return {
                    text: parsedText,
                    hasImage: hasImage,
                    isStructured: true
                };
            }
        } catch(e) {}
        return {
            text: trimmedText,
            hasImage: hasImage,
            isStructured: false
        };
    }

    function formatTime(d) {
        if (!d) return '';
        return new Date(d).toLocaleString();
    }

    function toAdminTimeMs(value) {
        var time = value ? new Date(value).getTime() : NaN;
        return Number.isFinite(time) ? time : 0;
    }

    function pickEarlierAdminIso(a, b) {
        if (!a) return b || null;
        if (!b) return a || null;
        return toAdminTimeMs(a) <= toAdminTimeMs(b) ? a : b;
    }

    function pickLaterAdminIso(a, b) {
        if (!a) return b || null;
        if (!b) return a || null;
        return toAdminTimeMs(a) >= toAdminTimeMs(b) ? a : b;
    }

    function getAdminUserEffectiveRegTime(info) {
        if (!info) return '';
        return info.reg_time || info.auth_created_at || '';
    }

    function mergeAdminUserInfo(base, next) {
        var left = base || {};
        var right = next || {};
        var merged = Object.assign({}, left, right);
        merged.reg_time = pickEarlierAdminIso(left.reg_time, right.reg_time);
        merged.auth_created_at = pickEarlierAdminIso(left.auth_created_at, right.auth_created_at);
        merged.last_login = pickLaterAdminIso(left.last_login, right.last_login);
        merged.last_visit = pickLaterAdminIso(left.last_visit, right.last_visit);
        return merged;
    }

    function getSelectableAdminUsers() {
        return allUsers
            .map(function(u) { return (u && u.name ? String(u.name).trim() : ''); })
            .filter(function(name) { return !!name && name !== ADMIN; })
            .sort(function(a, b) { return a.localeCompare(b, 'zh-CN'); });
    }

    function isSelectableAdminUser(userName) {
        var normalized = String(userName || '').trim();
        if (!normalized || normalized === ADMIN) return false;
        return getSelectableAdminUsers().indexOf(normalized) !== -1;
    }

    function getAdminUserPickerElements(inputId) {
        return {
            root: document.getElementById(inputId + 'Picker'),
            hidden: document.getElementById(inputId),
            search: document.getElementById(inputId + 'Search'),
            list: document.getElementById(inputId + 'List')
        };
    }

    function buildAdminUserOptionsMarkup(inputId, query, selectedName) {
        var normalizedQuery = String(query || '').trim().toLowerCase();
        var selected = String(selectedName || '').trim();
        var users = getSelectableAdminUsers().filter(function(name) {
            return !normalizedQuery || name.toLowerCase().indexOf(normalizedQuery) !== -1;
        });
        if (!users.length) {
            return '<div class="admin-user-option admin-user-option-empty">无匹配用户</div>';
        }
        return users.map(function(name) {
            var activeClass = name === selected ? ' is-selected' : '';
            var escapedName = safeJsStr(name);
            return '<button type="button" class="admin-user-option' + activeClass + '" onclick="selectAdminUserOption(\'' + inputId + '\', \'' + escapedName + '\')">' + escapeHtml(name) + '</button>';
        }).join('');
    }

    window.filterAdminUserOptions = function(inputId) {
        var els = getAdminUserPickerElements(inputId);
        if (!els.search || !els.hidden || !els.list) return;
        var query = els.search.value || '';
        var selected = els.hidden.value || '';
        if (query.trim() !== selected.trim()) {
            els.hidden.value = '';
            if (els.root) els.root.classList.remove('has-selection');
        }
        els.list.innerHTML = buildAdminUserOptionsMarkup(inputId, query, selected);
    };

    window.selectAdminUserOption = function(inputId, userName) {
        var els = getAdminUserPickerElements(inputId);
        if (!els.search || !els.hidden || !els.list) return;
        els.hidden.value = userName;
        els.search.value = userName;
        if (els.root) els.root.classList.add('has-selection');
        els.list.innerHTML = buildAdminUserOptionsMarkup(inputId, userName, userName);
    };

    function buildAdminUserPicker(inputId, placeholder) {
        var users = getSelectableAdminUsers();
        var placeholderText = users.length ? (placeholder || '选择用户') : '暂无可选用户';
        return [
            '<div class="admin-user-picker' + (users.length ? '' : ' is-disabled') + '" id="' + inputId + 'Picker">',
            '<input type="hidden" id="' + inputId + '" value="">',
            '<div class="admin-user-picker-shell">',
            '<input id="' + inputId + 'Search" class="admin-user-input" placeholder="' + escapeHtml(placeholderText) + '" autocomplete="off" spellcheck="false" oninput="filterAdminUserOptions(\'' + inputId + '\')"' + (users.length ? '' : ' disabled') + '>',
            '<div class="admin-user-list" id="' + inputId + 'List">' + buildAdminUserOptionsMarkup(inputId, '', '') + '</div>',
            '</div>',
            '</div>'
        ].join('');
    }

    function validateAdminTargetUser(userName, inputId) {
        var normalized = String(userName || '').trim();
        var els = getAdminUserPickerElements(inputId);
        var input = els.search || els.hidden || document.getElementById(inputId);
        if (!normalized) {
            showToast('请选择用户', 'error');
            if (input) input.focus();
            return false;
        }
        if (normalized === ADMIN) {
            showToast('管理员不能在这里对自己执行操作', 'error');
            if (input) input.focus();
            return false;
        }
        if (!isSelectableAdminUser(normalized)) {
            showToast('请从用户列表中选择真实用户', 'error');
            if (input) input.focus();
            return false;
        }
        return true;
    }

    function getUserActivityStats(userName) {
        return {
            posts: allPosts.filter(function(p) { return p.user_name === userName; }).length,
            likes: allLikes.filter(function(l) { return l.user_name === userName; }).length,
            comments: allComments.filter(function(c) { return c.user_name === userName; }).length
        };
    }

    function getUserStateFlags(userName) {
        return {
            isAdmin: userName === ADMIN,
            isBanned: bansData.some(function(b) { return b.user_name === userName && b.is_active; }),
            isMuted: mutesData.some(function(m) { return m.user_name === userName && m.is_active; }),
            isBlacklisted: blacklistData.some(function(b) { return b.user_name === userName && b.is_active; })
        };
    }

    function buildUserTagMarkup(flags) {
        var html = '';
        if (flags.isAdmin) html += '<span class="tag tag-admin">管理员</span>';
        if (flags.isBanned) html += '<span class="tag tag-banned">封禁中</span>';
        if (flags.isMuted) html += '<span class="tag tag-muted">禁言中</span>';
        if (flags.isBlacklisted) html += '<span class="tag tag-banned">黑名单</span>';
        return html;
    }

    function findActiveRecordByUser(list, userName) {
        return (list || []).find(function(item) {
            return item && item.user_name === userName && item.is_active;
        }) || null;
    }

    function buildAdminActionToolbar(inputId, durationId, reasonId, durationLabel, reasonLabel, reasonPlaceholder) {
        return [
            '<input type="hidden" id="' + inputId + '" value="">',
            '<div class="admin-action-note">先设置时长和原因，再直接点击下方用户执行。</div>',
            '<div class="admin-action-toolbar">',
            '<div class="admin-field"><label>' + durationLabel + '</label><select id="' + durationId + '">',
            '<option value="1">1小时</option><option value="6">6小时</option><option value="12">12小时</option><option value="24" selected>1天</option><option value="72">3天</option><option value="168">7天</option><option value="720">30天</option><option value="0">永久</option>',
            '</select></div>',
            '<div class="admin-field"><label>' + reasonLabel + '</label><input id="' + reasonId + '" placeholder="' + escapeHtml(reasonPlaceholder) + '"></div>',
            '</div>'
        ].join('');
    }

    function buildAdminActionUserCards(kind) {
        var users = allUsers.filter(function(u) { return u.name !== ADMIN; }).slice();
        var activeList = kind === 'ban' ? bansData : (kind === 'mute' ? mutesData : blacklistData);
        users.sort(function(a, b) {
            var aActive = findActiveRecordByUser(activeList, a.name) ? 1 : 0;
            var bActive = findActiveRecordByUser(activeList, b.name) ? 1 : 0;
            if (bActive !== aActive) return bActive - aActive;
            var aStats = getUserActivityStats(a.name);
            var bStats = getUserActivityStats(b.name);
            return (bStats.posts - aStats.posts) || a.name.localeCompare(b.name);
        });
        if (!users.length) return '<div class="empty-state"><div class="text">暂无可操作用户</div></div>';
        return '<div class="admin-action-grid">' + users.map(function(u) {
            var stats = getUserActivityStats(u.name);
            var flags = getUserStateFlags(u.name);
            var info = u.info || {};
            var safeName = safeJsStr(u.name);
            var activeRecord = findActiveRecordByUser(activeList, u.name);
            var primaryLabel = kind === 'ban' ? '执行封禁' : (kind === 'mute' ? '执行禁言' : '加入黑名单');
            var primaryAction = kind === 'ban' ? 'applyBanToUser' : (kind === 'mute' ? 'applyMuteToUser' : 'applyBlacklistToUser');
            var liftAction = kind === 'ban' ? 'liftBanByUser' : (kind === 'mute' ? 'liftMuteByUser' : 'liftBlacklistByUser');
            var activeText = kind === 'ban' ? '当前封禁中' : (kind === 'mute' ? '当前禁言中' : '当前在黑名单');
            return [
                '<div class="user-card admin-action-card' + (flags.isBanned ? ' is-banned' : '') + (flags.isMuted ? ' is-muted' : '') + '">',
                '<div class="user-card-head">',
                '<div class="user-avatar' + (flags.isBanned ? ' banned-avatar' : (flags.isMuted ? ' muted-avatar' : '')) + '">' + escapeHtml((u.name || '?').slice(0, 1).toUpperCase()) + '</div>',
                '<div class="user-card-name"><strong>' + escapeHtml(u.name) + '</strong><div class="user-tags">' + buildUserTagMarkup(flags) + '</div></div>',
                '</div>',
                '<div class="user-card-stats"><div class="user-stat-item"><div class="num">' + stats.posts + '</div><div class="lbl">帖子</div></div><div class="user-stat-item"><div class="num">' + stats.likes + '</div><div class="lbl">点赞</div></div><div class="user-stat-item"><div class="num">' + stats.comments + '</div><div class="lbl">评论</div></div></div>',
                '<div class="user-card-meta">',
                '<div class="meta-row"><span class="label">最近登录</span><span class="value">' + escapeHtml((info.last_login || info.last_visit) ? formatTime(info.last_login || info.last_visit) : '-') + '</span></div>',
                '<div class="meta-row"><span class="label">注册时间</span><span class="value">' + escapeHtml(getAdminUserEffectiveRegTime(info) ? formatTime(getAdminUserEffectiveRegTime(info)) : '-') + '</span></div>',
                '<div class="meta-row"><span class="label">当前状态</span><span class="value">' + escapeHtml(activeRecord ? activeText : '可执行操作') + '</span></div>',
                '</div>',
                '<div class="user-card-actions">',
                activeRecord
                    ? '<button class="btn-sm del" onclick="' + liftAction + '(\'' + safeName + '\')">解除</button>'
                    : '<button class="btn-sm primary" onclick="' + primaryAction + '(\'' + safeName + '\')">' + primaryLabel + '</button>',
                '</div>',
                '</div>'
            ].join('');
        }).join('') + '</div>';
    }

    window.applyBanToUser = function(userName) {
        var input = document.getElementById('banUserName');
        if (input) input.value = userName;
        window.addBan();
    };

    window.applyMuteToUser = function(userName) {
        var input = document.getElementById('muteUserName');
        if (input) input.value = userName;
        window.addMute();
    };

    window.applyBlacklistToUser = function(userName) {
        var input = document.getElementById('blacklistUserName');
        if (input) input.value = userName;
        window.addBlacklist();
    };

    window.liftBanByUser = function(userName) {
        var activeRecord = findActiveRecordByUser(bansData, userName);
        if (activeRecord) window.liftBan(activeRecord.id);
    };

    window.liftMuteByUser = function(userName) {
        var activeRecord = findActiveRecordByUser(mutesData, userName);
        if (activeRecord) window.liftMute(activeRecord.id);
    };

    window.liftBlacklistByUser = function(userName) {
        var activeRecord = findActiveRecordByUser(blacklistData, userName);
        if (activeRecord) window.liftBlacklist(activeRecord.id);
    };

    function renderTab(tab) {
        return window.renderTab(tab);
    }

    function renderAnnTab(el) {
        var h = '<div class="card"><h3>发布新公告</h3>';
        h += '<input type="text" id="adminAnnTitleInp" placeholder="输入公告标题（可选）" style="width:100%;margin-bottom:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.15);font-size:14px;outline:none;box-sizing:border-box;">';
        h += '<textarea id="adminAnnInp" placeholder="输入公告内容（可选）" maxlength="2000"></textarea>';
        h += '<div class="publish-row"><button class="btn-sm primary" onclick="publishAdminAnn()">发布公告</button></div></div>';
        h += '<div class="card"><h3>公告列表（' + annList.length + '条）</h3>';
        if (!annList.length) {
            h += '<div class="empty">暂无公告</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>标题</th><th>内容</th><th>发布者</th><th>发布时间</th><th>操作</th></tr></thead><tbody>';
            annList.forEach(function(a) {
                var displayTitle = '-', displayContent = a.content || '';
                if (a.content) {
                    try { var p = JSON.parse(a.content); if (p.title !== undefined) { displayTitle = p.title || '-'; displayContent = p.content || ''; } } catch(e) {}
                }
                var titlePreview = displayTitle ? escapeHtml(displayTitle) : '-';
                var preview = (displayContent || '').slice(0, 60);
                if (displayContent && displayContent.length > 60) preview += '...';
                h += '<tr><td>' + titlePreview + '</td><td>' + escapeHtml(preview || '-') + '</td><td>' + escapeHtml(a.user_name) + '</td><td>' + formatTime(a.created_at) + '</td>';
                h += '<td><button class="btn-sm del" onclick="deleteAdminAnn(\'' + a.id + '\')">删除</button></td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    function renderUsersTab(el) {
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + allUsers.length + '</div><div class="lbl">注册用户总数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allPosts.length + '</div><div class="lbl">总帖子数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allLikes.length + '</div><div class="lbl">总点赞数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allComments.length + '</div><div class="lbl">总评论数</div></div>';
        h += '</div>';

        h += '<div class="filter-bar">';
        h += '<div class="search-wrap"><span class="search-icon">🔍</span><input id="userSearchInp" placeholder="搜索用户名..." oninput="searchUserInp()" value="' + escapeHtml(searchUser) + '"></div>';
        h += '<div class="filter-chips">';
        h += '<span class="filter-chip' + (userFilterStatus === 'all' ? ' active' : '') + '" onclick="userFilterStatus=\'all\';renderTab(\'users\')">全部</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'admin' ? ' active' : '') + '" onclick="userFilterStatus=\'admin\';renderTab(\'users\')">管理员</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'banned' ? ' active active-del' : '') + '" onclick="userFilterStatus=\'banned\';renderTab(\'users\')">拉黑封禁中</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'muted' ? ' active active-warn' : '') + '" onclick="userFilterStatus=\'muted\';renderTab(\'users\')">禁言中</span>';
        h += '</div>';
        h += '<select onchange="userSortBy=this.value;renderTab(\'users\')">';
        h += '<option value="reg"' + (userSortBy === 'reg' ? ' selected' : '') + '>按注册时间</option>';
        h += '<option value="login"' + (userSortBy === 'login' ? ' selected' : '') + '>按最近登录</option>';
        h += '<option value="posts"' + (userSortBy === 'posts' ? ' selected' : '') + '>按帖子数</option>';
        h += '</select>';
        h += '</div>';

        var filtered = allUsers.slice();
        if (searchUser) {
            var sq = searchUser.toLowerCase();
            filtered = filtered.filter(function(u) { return u.name.toLowerCase().includes(sq); });
        }
        if (userFilterStatus === 'admin') {
            filtered = filtered.filter(function(u) { return u.name === ADMIN; });
        } else if (userFilterStatus === 'banned') {
            filtered = filtered.filter(function(u) { return bansData.some(function(b) { return b.user_name === u.name && b.is_active; }); });
        } else if (userFilterStatus === 'muted') {
            filtered = filtered.filter(function(u) { return mutesData.some(function(m) { return m.user_name === u.name && m.is_active; }); });
        }

        filtered.sort(function(a, b) {
            if (userSortBy === 'posts') {
                var pa = allPosts.filter(function(p) { return p.user_name === a.name; }).length;
                var pb = allPosts.filter(function(p) { return p.user_name === b.name; }).length;
                return pb - pa;
            }
            if (userSortBy === 'login') {
                return toAdminTimeMs(b.info && (b.info.last_login || b.info.last_visit)) - toAdminTimeMs(a.info && (a.info.last_login || a.info.last_visit));
            }
            return toAdminTimeMs(getAdminUserEffectiveRegTime(b.info)) - toAdminTimeMs(getAdminUserEffectiveRegTime(a.info));
        });

        h += '<div class="card"><h3>用户列表 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + filtered.length + ' 位用户</span></h3>';
        if (!filtered.length) {
            h += '<div class="empty">无匹配用户</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>最近设备</th><th>地区</th><th>最近IP</th><th>帖子</th><th>点赞</th><th>评论</th><th>操作</th></tr></thead><tbody>';
            filtered.forEach(function(u) {
                var pc = allPosts.filter(function(p) { return p.user_name === u.name; }).length;
                var lc = allLikes.filter(function(l) { return l.user_name === u.name; }).length;
                var cc = allComments.filter(function(c) { return c.user_name === u.name; }).length;
                var regTime = getAdminUserEffectiveRegTime(u.info) ? formatTime(getAdminUserEffectiveRegTime(u.info)) : '-';
                var isAdmin = u.name === ADMIN;
                var isBanned = bansData.some(function(b) { return b.user_name === u.name && b.is_active; });
                var isMuted = mutesData.some(function(m) { return m.user_name === u.name && m.is_active; });
                var safeName = safeJsStr(u.name);

                // 最近登录设备 & IP
                var userEvents = allLoginEvents.filter(function(ev) { return ev.user_name === u.name; }).map(function(ev) {
                    var info = {};
                    try { info = JSON.parse(ev.content || '{}'); } catch(e) {}
                    return { raw: ev, info: info };
                }).sort(function(a, b) {
                    return toAdminTimeMs((b.info && b.info.login_at) || (b.raw && b.raw.created_at))
                         - toAdminTimeMs((a.info && a.info.login_at) || (a.raw && a.raw.created_at));
                });
                var latestLoginEvent = userEvents[0] || null;
                var deviceCell = '-';
                var regionCellV1 = '-';
                var ipCell = '-';
                var latestLoginTimeV1 = '';
                if (latestLoginEvent) {
                    deviceCell = escapeHtml((latestLoginEvent.info.device_type || '?') + ' · ' + (latestLoginEvent.info.os || '?') + ' · ' + (latestLoginEvent.info.browser || '?'));
                    ipCell = escapeHtml(latestLoginEvent.info.ip || '-');
                    if (latestLoginEvent.info.ip_location && latestLoginEvent.info.ip_location.text) {
                        regionCellV1 = escapeHtml(latestLoginEvent.info.ip_location.text);
                    } else {
                        // 回退：使用用户信息中存储的IP位置或精确定位
                        try {
                            var ui = JSON.parse(user.content || '{}');
                            if (ui.last_ip_location && ui.last_ip_location.text) {
                                regionCellV1 = escapeHtml(ui.last_ip_location.text);
                            } else if (ui.last_location && ui.last_location.address) {
                                regionCellV1 = escapeHtml(ui.last_location.address);
                            } else if (ui.last_location && ui.last_location.text) {
                                regionCellV1 = escapeHtml(ui.last_location.text);
                            }
                        } catch(e) {}
                    }
                    latestLoginTimeV1 = latestLoginEvent.info.login_at || (latestLoginEvent.raw && latestLoginEvent.raw.created_at) || '';
                    deviceCell = '<a href="#" onclick="showUserLoginDetail(\'' + safeName + '\');return false;" style="color:var(--primary);text-decoration:underline;">' + deviceCell + '</a>';
                }

                var lastLogin = latestLoginTimeV1 || (u.info && (u.info.last_login || u.info.last_visit)) ? formatTime(latestLoginTimeV1 || u.info.last_login || u.info.last_visit) : '-';

                var statusText = isAdmin ? '管理员' :
                                  isBanned ? '封禁中' :
                                  isMuted ? '禁言中' :
                                  '正常';

                h += '<tr><td><strong>' + escapeHtml(u.name) + '</strong></td>';
                h += '<td>' + escapeHtml(statusText) + '</td>';
                h += '<td>' + regTime + '</td>';
                h += '<td>' + lastLogin + '</td>';
                h += '<td>' + deviceCell + '</td>';
                h += '<td>' + regionCellV1 + '</td>';
                h += '<td>' + ipCell + '</td>';
                h += '<td>' + pc + '</td>';
                h += '<td>' + lc + '</td>';
                h += '<td>' + cc + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (!isAdmin) {
                    h += '<button class="btn-sm" onclick="quickMuteUser(\'' + safeName + '\')" style="margin-right:4px;">禁言</button>';
                    h += '<button class="btn-sm" onclick="quickBanUser(\'' + safeName + '\')">拉黑</button>';
                } else {
                    h += '<span style="color:var(--text-muted);font-size:12px;">-</span>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        h += '<div id="userLoginDetail" style="display:none;margin-top:12px;"></div>';

        el.innerHTML = h;
    }

    // ===================== 用户列表一键操作（通过 API） =====================
    window.quickMuteUser = function(userName) {
        var hours = prompt('请输入禁言时长（小时），0=永久禁言：', '24');
        if (hours === null) return;
        hours = parseInt(hours);
        if (isNaN(hours) || hours < 0) { showToast('请输入有效的小时数', 'error'); return; }
        showConfirm('禁言用户', '确认禁言 ' + userName + (hours > 0 ? ' ' + hours + '小时' : ' 永久') + '？', '确认禁言', async function() {
            try {
                await apiCall('POST', '/admin/mute', {
                        user_name: userName,
                        duration_hours: hours,
                        reason: '管理员操作'
                    });
                await loadMutesData();
                showToast('已禁言 ' + userName, 'success');
            } catch(e) { showToast('禁言失败: ' + e.message, 'error'); }
        });
    };

    window.quickBanUser = function(userName) {
        var hours = prompt('请输入拉黑封禁时长（小时），0=永久拉黑封禁：', '24');
        if (hours === null) return;
        hours = parseInt(hours);
        if (isNaN(hours) || hours < 0) { showToast('请输入有效的小时数', 'error'); return; }
        showConfirm('拉黑封禁', '确认拉黑封禁 ' + userName + (hours > 0 ? ' ' + hours + '小时' : ' 永久') + '？', '确认拉黑封禁', async function() {
            try {
                await apiCall('POST', '/admin/ban', {
                    user_name: userName,
                    duration_hours: hours,
                    reason: '管理员操作'
                });
                await loadBansData();
                showToast('已拉黑封禁 ' + userName, 'success');
            } catch(e) { showToast('拉黑封禁失败: ' + e.message, 'error'); }
        });
    };

    window.confirmDeleteUser = function(userName) {
        showConfirm('删除用户账号', '确认删除用户「' + userName + '」吗？此操作不可恢复，会删除账号登录信息、帖子、照片、点赞、评论等用户数据。', '确认删除', function() {
            window.deleteUserAccount(userName);
        });
    };

    window.deleteUserAccount = async function(userName) {
        try {
            await apiCall('DELETE', '/admin/user/' + encodeURIComponent(userName));
            showToast('用户账号已删除', 'success');
            await loadAllData(true);
            renderTab('users');
        } catch(e) {
            showToast('删除用户失败：' + e.message, 'error');
        }
    };

    async function renderPostsTab(el) {
        if (API_BASE) {
            try {
                var apiData = await apiCall('GET', '/admin/data');
                var postData = apiData.posts || [];
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__' && p.media_type !== SECURITY_ALERT_MARKER && p.media_type !== AUDIT_LOG_MARKER && p.media_type !== CLIENT_ERROR_MARKER; });
                annList = apiData.announcements || [];
                allLikes = apiData.likes || [];
                allComments = apiData.comments || [];
                bansData = apiData.bans || [];
            } catch(e) {}
        }
        var visiblePosts = allPosts.filter(function(p) { return [ANN_MARKER, '__photo_wall__', REPORT_MARKER, '__vip__', '__vip_order__', '__vip_plan__', '__pro_gift__', '__pro_gift_claim__', '__user_style__', '__auth__', '__admin_auth__', '__user_info__', '__user_visit__', '__login_event__', '__user_behavior__', '__security_alert__', '__admin_audit__', '__client_error__', '__email_sent__', '__email_recipient_history__'].indexOf(p.media_type) < 0; });
        var h = '<div class="card"><h3>帖子管理（' + visiblePosts.length + '条）</h3>';
        h += '<div class="search-bar"><input id="postSearchInp" placeholder="搜索帖子内容或用户名..." oninput="searchPostInp()" /></div>';
        var filtered = visiblePosts;
        if (searchPost) {
            var q = searchPost.toLowerCase();
            filtered = visiblePosts.filter(function(p) {
                return (p.user_name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q);
            });
        }
        if (!filtered.length) { h += '<div class="empty">无匹配帖子</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>内容</th><th>附件</th><th>浏览</th><th>时间</th><th>操作</th></tr></thead><tbody>';
            filtered.forEach(function(p) {
                var summary = getAdminPostSummary(p);
                var content = summary.hasImage && !summary.text ? '' : String(summary.text || '').slice(0, 60);
                if (summary.text && summary.text.length > 60) content += '...';
                // 图片预览
                var imgHtml = '';
                if (p.media_url && p.media_url.indexOf('http') === 0) {
                    imgHtml = '<img src="' + escapeHtml(p.media_url) + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="previewAdminPhoto(\'' + safeJsStr(p.media_url) + '\',\'' + safeJsStr(p.user_name || '') + '\',\'' + safeJsStr(p.created_at || '') + '\')" title="点击预览大图">';
                } else if (p.media_url) {
                    imgHtml = '📎';
                }
                h += '<tr><td>' + escapeHtml(p.user_name || '') + '</td>';
                h += '<td>' + escapeHtml(content) + '</td>';
                h += '<td>' + (imgHtml || '-') + '</td>';
                h += '<td>' + (p.views || 0) + '</td>';
                h += '<td>' + formatTime(p.created_at) + '</td>';
                h += '<td><button class="btn-sm del" onclick="deleteAdminPost(\'' + p.id + '\')">删除</button></td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    async function renderLikesTab(el) {
        if (API_BASE) {
            try { var apiData = await apiCall('GET', '/admin/data'); allLikes = apiData.likes || []; allPosts = (apiData.posts || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER; }); } catch(e) {}
        }
        var h = '<div class="card"><h3>点赞记录（' + allLikes.length + '条）</h3>';
        if (!allLikes.length) { h += '<div class="empty">暂无点赞数据</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>帖子作者</th><th>帖子内容</th><th>时间</th></tr></thead><tbody>';
            var recentLikes = allLikes.slice(0, 500);
            recentLikes.forEach(function(l) {
                var post = allPosts.find(function(p) { return p.id === l.post_id; });
                var displayText = post ? getDisplayContent(post.content) : '(已删除)';
                var postContent = (displayText || '').slice(0, 30);
                if (displayText && displayText.length > 30) postContent += '...';
                h += '<tr><td>' + escapeHtml(l.user_name || '') + '</td>';
                h += '<td>' + escapeHtml((post && post.user_name) || '') + '</td>';
                h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(postContent) + '</td>';
                h += '<td>' + formatTime(l.created_at) + '</td></tr>';
            });
            h += '</tbody></table></div>';
            if (allLikes.length > 500) h += '<div class="empty">仅显示最近500条记录</div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    async function renderCommentsTab(el) {
        var h = '<div class="card"><h3>评论记录（' + allComments.length + '条）</h3>';
        if (!allComments.length) { h += '<div class="empty">暂无评论数据</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>评论内容</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            var recentComments = allComments.slice(0, 500);
            recentComments.forEach(function(c) {
                var isDeleted = c.content && c.content.startsWith('__DELETED_BY_');
                var displayContent = c.content || '';
                var deletedBy = '';
                if (isDeleted) {
                    var m = c.content.match(/^__DELETED_BY_(.+?)__/);
                    deletedBy = m ? m[1] : 'unknown';
                    displayContent = c.content.replace(/^__DELETED_BY_.+?__/, '');
                }
                h += '<tr><td>' + escapeHtml(c.user_name || '') + '</td>';
                h += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(displayContent) + '</td>';
                h += '<td>' + formatTime(c.created_at) + '</td>';
                if (isDeleted) {
                    h += '<td><span class="badge badge-red">已删除</span><br><span style="font-size:11px;color:var(--text-muted);">by ' + escapeHtml(deletedBy) + '</span></td>';
                    h += '<td>-</td>';
                } else {
                    h += '<td><span class="badge badge-green">正常</span></td>';
                    h += '<td><button class="btn-sm del" onclick="deleteAdminComment(\'' + c.id + '\', \'' + (c.actor_key || '') + '\')">删除</button></td>';
                }
                h += '</tr>';
            });
            h += '</tbody></table></div>';
            if (allComments.length > 500) h += '<div class="empty">仅显示最近500条记录</div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    // ===================== 公告：通过 API 发布 =====================
    window.publishAdminAnn = async function() {
        var titleInp = document.getElementById('adminAnnTitleInp');
        var contentInp = document.getElementById('adminAnnInp');
        var title = (titleInp.value || '').trim();
        var content = (contentInp.value || '').trim();
        
        if (!title && !content) { showToast('请至少填写标题或内容', 'error'); return; }
        
        try {
            await apiCall('POST', '/admin/announcement', { title: title, content: content });
            titleInp.value = '';
            contentInp.value = '';
            await loadAllData(true);
            showToast('公告已发布', 'success');
        } catch(e) { showToast('发布失败: ' + e.message, 'error'); }
    };

    // ===================== 通过 API 删除 =====================
    window.deleteAdminAnn = function(id) {
        var ann = annList.find(function(x) { return x.id === id; });
        var preview = ann ? (ann.content || '').slice(0, 50) : '';
        if (preview && ann.content && ann.content.length > 50) preview += '...';
        
        showConfirm('删除公告', '您确定要删除此公告吗？\n\n' + (preview ? '公告内容：' + preview + '\n\n' : '') + '删除后所有用户将无法查看此公告，此操作不可恢复。', '确认删除', async function() {
            try {
                if (API_BASE) {
                    await apiCall('DELETE', '/admin/announcement/' + id);
                } else if (typeof sb !== 'undefined' && sb && sb.rpc) {
                    var key = ann ? ann.actor_key : 'admin_' + Date.now();
                    var res = await sb.rpc('delete_post_with_actor', { p_post_id: id, p_actor_key: key });
                    if (res.error) { showToast('删除失败: ' + res.error.message, 'error'); return; }
                }
                await loadAllData(true);
                showToast('公告已成功删除', 'success');
            } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
        });
    };

    window.deleteAdminPost = function(id) {
        var post = allPosts.find(function(x) { return x.id === id; });
        var displayText = post ? getDisplayContent(post.content) : '';
        var preview = (displayText || '').slice(0, 50);
        if (displayText && displayText.length > 50) preview += '...';
        
        showConfirm('删除帖子', '您确定要删除此帖子吗？\n\n' + (post ? '发布者：' + (post.user_name || '') + '\n' : '') + (preview ? '内容：' + preview + '\n\n' : '') + '删除后此帖子及相关的点赞和评论都会被移除，此操作不可恢复。', '确认删除', async function() {
            try {
                if (API_BASE) {
                    await apiCall('DELETE', '/admin/post/' + id);
                } else {
                    var key = post ? post.actor_key : 'admin_' + Date.now();
                    var res = await sb.rpc('delete_post_with_actor', { p_post_id: id, p_actor_key: key });
                    if (res.error) { showToast('删除失败: ' + res.error.message, 'error'); return; }
                }
                await loadAllData(true);
                showToast('帖子已成功删除', 'success');
            } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
        });
    };

    window.deleteAdminComment = function(id, actorKey) {
        var comment = allComments.find(function(c) { return c.id === id; });
        var preview = comment ? (comment.content || '').slice(0, 50) : '';
        if (preview && comment.content && comment.content.length > 50) preview += '...';
        
        showConfirm('删除评论', '您确定要删除此评论吗？\n\n' + (comment ? '发布者：' + (comment.user_name || '') + '\n' : '') + (preview ? '内容：' + preview + '\n\n' : '') + '评论将标记为删除，但记录会保留在数据库中。', '确认删除', async function() {
            try {
                if (API_BASE) {
                    await apiCall('DELETE', '/admin/comment/' + id);
                } else {
                    var { data, error } = await sb.rpc('delete_comment_v2', { p_comment_id: id, p_deleted_by: ADMIN });
                    if (error) { showToast('删除失败: ' + error.message, 'error'); return; }
                }
                await loadAllData(true);
                showToast('评论已标记为删除', 'success');
            } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
        });
    };

    window.searchUserInp = function() {
        searchUser = document.getElementById('userSearchInp').value.trim();
        renderTab('users');
    };
    window.searchPostInp = function() {
        searchPost = document.getElementById('postSearchInp').value.trim();
        renderTab('posts');
    };

    window.toggleTheme = function() {
        var html = document.documentElement;
        var isDark = html.getAttribute('data-theme') === 'dark';
        if (isDark) { html.removeAttribute('data-theme'); localStorage.setItem('xtj-admin-theme', 'light'); }
        else { html.setAttribute('data-theme', 'dark'); localStorage.setItem('xtj-admin-theme', 'dark'); }
    };

    function applySavedAdminTheme() {
        var saved = localStorage.getItem('xtj-admin-theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    var adminSessionRestoreStarted = false;

    (function bootAdminSessionRestore() {
        function runRestore() {
            if (adminSessionRestoreStarted) return;
            adminSessionRestoreStarted = true;
            applySavedAdminTheme();
            tryRestoreAdminSession().then(function(restored) {
                if (!restored) {
                    try {
                        document.getElementById('loginWrap').style.display = 'flex';
                        document.getElementById('dashboard').style.display = 'none';
                    } catch (e) {}
                }
            }).catch(function() {
                clearSession();
                try {
                    document.getElementById('loginWrap').style.display = 'flex';
                    document.getElementById('dashboard').style.display = 'none';
                } catch (e) {}
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', runRestore, { once: true });
            return;
        }
        runRestore();
    })();

    var reportsData = [];

    async function loadReportsData() {
        try {
            var data = await apiCall('GET', '/admin/reports');
            reportsData = data.data || [];
        } catch(e) { reportsData = []; }
        updateReportBadge();
    }

    function updateReportBadge() {
        var badge = document.getElementById('reportBadge');
        if (!badge) return;
        var pending = reportsData.filter(function(r) { return r.status === 'pending'; }).length;
        if (pending > 0) {
            badge.textContent = pending > 99 ? '99+' : pending;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    async function renderReportsTab(el) {
        if (!reportsData.length) { await loadReportsData(); }
        var h = '<div class="stats-row">';
        var pending = reportsData.filter(function(r) { return r.status === 'pending'; }).length;
        h += '<div class="stat-box"><div class="val">' + reportsData.length + '</div><div class="lbl">总举报数</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + pending + '</div><div class="lbl">待处理</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--primary)">' + reportsData.filter(function(r) { return r.status === 'actioned'; }).length + '</div><div class="lbl">已处理</div></div>';
        h += '</div>';
        
        h += '<div class="card"><h3>举报列表</h3>';
        if (!reportsData.length) {
            h += '<div class="empty">暂无举报</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>举报人</th><th>类型</th><th>被举报人</th><th>分类</th><th>原因</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            reportsData.forEach(function(r) {
                var statusBadge = r.status === 'pending' ? '<span class="badge badge-red">待处理</span>' :
                                 r.status === 'reviewed' ? '<span class="badge badge-green">已审阅</span>' :
                                 r.status === 'dismissed' ? '<span class="badge" style="background:rgba(128,128,128,0.15);color:var(--text-muted)">已驳回</span>' :
                                 '<span class="badge badge-green">已处理</span>';
                h += '<tr><td>' + escapeHtml(r.reporter_name) + '</td>';
                h += '<td>' + (r.target_type === 'photo' ? '照片墙' : '帖子') + '</td>';
                h += '<td><strong>' + escapeHtml(r.target_user || '-') + '</strong></td>';
                h += '<td>' + escapeHtml(r.report_category) + '</td>';
                h += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(r.report_reason || '-') + '</td>';
                h += '<td>' + formatTime(r.created_at) + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (r.status === 'pending') {
                    h += '<button class="btn-sm primary" onclick="handleReportDetail(\'' + r.id + '\')">处理</button> ';
                    h += '<button class="btn-sm" onclick="dismissReport(\'' + r.id + '\')">驳回</button>';
                } else {
                    h += '<button class="btn-sm" onclick="handleReportDetail(\'' + r.id + '\')">详情</button>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.handleReportDetail = function(id) {
        var r = reportsData.find(function(x) { return x.id === id; });
        if (!r) return;
        
        var modal = document.createElement('div');
        modal.className = 'report-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
        
        var box = document.createElement('div');
        box.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:16px;padding:24px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.onclick = function(e) { e.stopPropagation(); };
        
        var typeLabel = r.target_type === 'photo' ? '照片墙' : '帖子';
        var statusLabel = r.status === 'pending' ? '待处理' : r.status === 'actioned' ? '已处理' : r.status === 'dismissed' ? '已驳回' : r.status;
        
        var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;"><h3 style="margin:0;">举报详情</h3><button onclick="this.closest(\'.report-detail-modal\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted);padding:4px;line-height:1;">×</button></div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:16px;">';
        html += '<div><strong>举报人：</strong>' + escapeHtml(r.reporter_name) + '</div>';
        html += '<div><strong>被举报人：</strong>' + escapeHtml(r.target_user || '-') + '</div>';
        html += '<div><strong>类型：</strong>' + typeLabel + '</div>';
        html += '<div><strong>分类：</strong>' + escapeHtml(r.report_category) + '</div>';
        html += '<div><strong>状态：</strong>' + statusLabel + '</div>';
        html += '<div><strong>时间：</strong>' + formatTime(r.created_at) + '</div>';
        html += '</div>';
        html += '<div style="margin-bottom:12px;"><strong>目标ID：</strong><code>' + escapeHtml(r.target_id) + '</code></div>';
        html += '<div style="margin-bottom:12px;padding:10px;background:rgba(0,0,0,0.05);border-radius:8px;"><strong>举报原因：</strong>' + escapeHtml(r.report_reason || '-') + '</div>';
        if (r.admin_response) {
            html += '<div style="margin-bottom:12px;padding:10px;background:rgba(5,150,105,0.08);border-radius:8px;"><strong>管理员回复：</strong>' + escapeHtml(r.admin_response) + '</div>';
        }
        if (r.reviewed_by) {
            html += '<div style="margin-bottom:12px;font-size:12px;color:var(--text-muted);">处理人：' + escapeHtml(r.reviewed_by) + ' · 处理时间：' + formatTime(r.reviewed_at) + '</div>';
        }
        
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        if (r.status === 'pending') {
            html += '<button class="btn-sm primary" onclick="doDeleteReportPost(\'' + r.id + '\')">删除内容</button>';
            html += '<button class="btn-sm" style="background:rgba(255,59,96,0.1);color:#ff3b60;border:1px solid rgba(255,59,96,0.3);" onclick="doBanReportUser(\'' + r.id + '\')">封禁用户</button>';
            html += '<button class="btn-sm" onclick="doMarkReportActioned(\'' + r.id + '\')">标记已处理</button>';
        }
        html += '<button class="btn-sm" style="margin-left:auto;" onclick="this.closest(\'.report-detail-modal\').remove()">关闭</button>';
        html += '</div>';
        
        if (r.status === 'pending') {
            html += '<div style="border-top:1px solid rgba(0,0,0,0.1);padding-top:12px;margin-top:8px;">';
            html += '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">回复举报人（选填）</label>';
            html += '<textarea id="reportResponse_' + r.id + '" rows="2" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);font-size:13px;resize:vertical;font-family:inherit;" placeholder="输入回复内容..."></textarea>';
            html += '<button class="btn-sm primary" style="margin-top:8px;" onclick="doRespondReport(\'' + r.id + '\')">回复并处理</button>';
            html += '</div>';
        }
        
        box.innerHTML = html;
        modal.appendChild(box);
        document.body.appendChild(modal);
    };

    window.doDeleteReportPost = function(id) {
        var r = reportsData.find(function(x) { return x.id === id; });
        showConfirm('删除内容', '确认删除被举报的' + (r && r.target_type === 'photo' ? '照片' : '帖子') + '？此操作不可撤销。', '确认删除', async function() {
            try {
                await apiCall('POST', '/admin/report/' + id + '/delete-post');
                await loadReportsData();
                document.querySelector('.report-detail-modal')?.remove();
                renderTab('reports');
                showToast('内容已删除，举报已处理', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    window.doBanReportUser = function(id) {
        var r = reportsData.find(function(x) { return x.id === id; });
        if (!r || !r.target_user) { showToast('无法确定被举报用户', 'error'); return; }
        showConfirm('封禁用户', '确认封禁用户 ' + r.target_user + '？\n\n选择封禁时长：', '确认封禁', async function() {
            try {
                if (!API_BASE) {
                    throw new Error('API 未配置，拒绝操作');
                }
                await apiCall('POST', '/admin/report/' + id + '/ban-user', { duration_hours: 72 });
                await loadReportsData();
                await loadBansData();
                document.querySelector('.report-detail-modal')?.remove();
                renderTab('reports');
                showToast('用户已封禁，举报已处理', 'success');
            } catch(e) { showToast('操作失败', 'error'); }
        });
    };

    window.doMarkReportActioned = function(id) {
        showConfirm('标记处理', '确认将此举报标记为已处理？', '确认', async function() {
            try {
                await apiCall('PUT', '/admin/report/' + id, { status: 'actioned' });
                await loadReportsData();
                document.querySelector('.report-detail-modal')?.remove();
                renderTab('reports');
                showToast('举报已处理', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    window.doRespondReport = async function(id) {
        var textarea = document.getElementById('reportResponse_' + id);
        if (!textarea) return;
        var response = textarea.value.trim();
        if (!response) { showToast('请输入回复内容', 'error'); return; }
        try {
            await apiCall('PUT', '/admin/report/' + id + '/respond', { response: response });
            await loadReportsData();
            document.querySelector('.report-detail-modal')?.remove();
            renderTab('reports');
            showToast('已回复并处理', 'success');
        } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
    };

    window.dismissReport = function(id) {
        showConfirm('驳回举报', '确认将此举报标记为已驳回？', '确认驳回', async function() {
            try {
                await apiCall('PUT', '/admin/report/' + id, { status: 'dismissed' });
                await loadReportsData();
                renderTab('reports');
                showToast('举报已驳回', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    var bansData = [];

    async function loadBansData() {
        try {
            var data = await apiCall('GET', '/admin/bans');
            bansData = data.data || [];
        } catch(e) { bansData = []; }
    }

    async function renderBansTab(el) {
        if (!bansData.length) { await loadBansData(); }
        var active = bansData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + bansData.length + '</div><div class="lbl">总拉黑封禁记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前拉黑封禁</div></div>';
        h += '</div>';

        h += '<div class="card">';
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
        h += '<h3 style="margin:0;">拉黑封禁列表</h3>';
        h += '<button class="btn-sm primary" onclick="showAddBanModal()">+ 添加拉黑封禁</button>';
        h += '</div>';
        if (!bansData.length) {
            h += '<div class="empty">暂无拉黑封禁记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>类型</th><th>原因</th><th>操作人</th><th>时间</th><th>过期</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            bansData.forEach(function(b) {
                var statusBadge = b.is_active ? '<span class="badge badge-red">拉黑封禁中</span>' : '<span class="badge badge-green">已解除</span>';
                h += '<tr>';
                h += '<td><strong>' + escapeHtml(b.user_name) + '</strong></td>';
                h += '<td>' + (b.ban_type === 'permanent' ? '永久' : formatDuration(b.ban_duration_hours || 0)) + '</td>';
                h += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(b.ban_reason || '-') + '</td>';
                h += '<td>' + escapeHtml(b.banned_by || '-') + '</td>';
                h += '<td style="font-size:12px;">' + formatTime(b.banned_at) + '</td>';
                h += '<td style="font-size:12px;">' + (b.expires_at ? formatTime(b.expires_at) : '永久') + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (b.is_active) {
                    h += '<button class="btn-sm" onclick="liftBan(\'' + b.id + '\')">解除</button>';
                } else {
                    h += '<span style="font-size:11px;color:var(--text-muted);">' + (b.lifted_at ? formatTime(b.lifted_at) : '-') + '</span>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.showAddBanModal = function() {
        var modal = document.createElement('div');
        modal.className = 'report-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

        var box = document.createElement('div');
        box.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:16px;padding:24px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.onclick = function(e) { e.stopPropagation(); };

        var html = '<h3 style="margin:0 0 16px;">添加拉黑封禁</h3>';
        html += '<div style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">用户名</label>';
        html += buildAdminUserPicker('banUserName', '选择拉黑封禁用户');
        html += '</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
        html += '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">拉黑封禁时长</label><select id="banDuration" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);background:rgba(255,255,255,0.8);font-size:13px;outline:none;">';
        html += '<option value="1">1小时</option><option value="6">6小时</option><option value="12">12小时</option><option value="24" selected>1天</option><option value="72">3天</option><option value="168">7天</option><option value="720">30天</option><option value="0">永久</option>';
        html += '</select></div>';
        html += '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">原因</label><input id="banReason" placeholder="违反社区规定" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);background:rgba(255,255,255,0.8);font-size:13px;outline:none;"></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
        html += '<button class="btn-sm" onclick="this.closest(\'.report-detail-modal\').remove()">取消</button>';
        html += '<button class="btn-sm primary" onclick="addBan()">确认拉黑封禁</button>';
        html += '</div>';

        box.innerHTML = html;
        modal.appendChild(box);
        document.body.appendChild(modal);
    };

    window.addBan = async function() {
        var userName = document.getElementById('banUserName').value.trim();
        var duration = parseInt(document.getElementById('banDuration').value);
        var reason = document.getElementById('banReason').value.trim();
        if (!validateAdminTargetUser(userName, 'banUserName')) return;
        try {
            await apiCall('POST', '/admin/ban', { user_name: userName, duration_hours: duration, reason: reason || '违反社区规定' });
            document.querySelector('.report-detail-modal')?.remove();
            await loadBansData();
            renderTab('bans');
            showToast('已拉黑封禁 ' + userName, 'success');
        } catch(e) { showToast('拉黑封禁失败: ' + e.message, 'error'); }
    };

    window.liftBan = function(id) {
        showConfirm('解除拉黑封禁', '确认解除该用户的拉黑封禁？', '确认解除', async function() {
            try {
                await apiCall('PUT', '/admin/ban/' + id + '/lift');
                await loadBansData();
                renderTab('bans');
                showToast('已解除拉黑封禁', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    var mutesData = [];

    var blacklistData = [];

    async function loadMutesData() {
        try {
            var data = await apiCall('GET', '/admin/mutes');
            mutesData = data.data || [];
        } catch(e) { mutesData = []; }
    }

    async function renderMutesTab(el) {
        if (!mutesData.length) { await loadMutesData(); }
        var active = mutesData.filter(function(m) { return m.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + mutesData.length + '</div><div class="lbl">总禁言记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前禁言</div></div>';
        h += '</div>';

        h += '<div class="card">';
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
        h += '<h3 style="margin:0;">禁言列表</h3>';
        h += '<button class="btn-sm primary" onclick="showAddMuteModal()">+ 添加禁言</button>';
        h += '</div>';
        if (!mutesData.length) {
            h += '<div class="empty">暂无禁言记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>时间</th><th>过期</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            mutesData.forEach(function(m) {
                var statusBadge = m.is_active ? '<span class="badge badge-red">禁言中</span>' : '<span class="badge badge-green">已解除</span>';
                h += '<tr>';
                h += '<td><strong>' + escapeHtml(m.user_name) + '</strong></td>';
                h += '<td>' + (m.duration_hours > 0 ? formatDuration(m.duration_hours) : '永久') + '</td>';
                h += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(m.reason || '-') + '</td>';
                h += '<td>' + escapeHtml(m.muted_by || '-') + '</td>';
                h += '<td style="font-size:12px;">' + formatTime(m.created_at) + '</td>';
                h += '<td style="font-size:12px;">' + (m.expires_at ? formatTime(m.expires_at) : '永久') + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (m.is_active) {
                    h += '<button class="btn-sm" onclick="liftMute(\'' + m.id + '\')">解除</button>';
                } else {
                    h += '<span style="font-size:11px;color:var(--text-muted);">' + (m.lifted_at ? formatTime(m.lifted_at) : '-') + '</span>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.showAddMuteModal = function() {
        var modal = document.createElement('div');
        modal.className = 'report-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

        var box = document.createElement('div');
        box.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:16px;padding:24px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.onclick = function(e) { e.stopPropagation(); };

        var html = '<h3 style="margin:0 0 16px;">添加禁言</h3>';
        html += '<div style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">用户名</label>';
        html += buildAdminUserPicker('muteUserName', '选择禁言用户');
        html += '</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
        html += '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">禁言时长</label><select id="muteDuration" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);background:rgba(255,255,255,0.8);font-size:13px;outline:none;">';
        html += '<option value="1">1小时</option><option value="6">6小时</option><option value="12">12小时</option><option value="24" selected>1天</option><option value="72">3天</option><option value="168">7天</option><option value="720">30天</option><option value="0">永久</option>';
        html += '</select></div>';
        html += '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">原因</label><input id="muteReason" placeholder="违反社区规定" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);background:rgba(255,255,255,0.8);font-size:13px;outline:none;"></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
        html += '<button class="btn-sm" onclick="this.closest(\'.report-detail-modal\').remove()">取消</button>';
        html += '<button class="btn-sm primary" onclick="addMute()">确认禁言</button>';
        html += '</div>';

        box.innerHTML = html;
        modal.appendChild(box);
        document.body.appendChild(modal);
    };

    function formatDuration(hours) {
        if (hours >= 720) return Math.floor(hours / 720) + '个月';
        if (hours >= 168) return Math.floor(hours / 168) + '周';
        if (hours >= 24) return Math.floor(hours / 24) + '天';
        return hours + '小时';
    }

    window.addMute = async function() {
        var userName = document.getElementById('muteUserName').value.trim();
        var duration = parseInt(document.getElementById('muteDuration').value);
        var reason = document.getElementById('muteReason').value.trim();
        if (!validateAdminTargetUser(userName, 'muteUserName')) return;
        try {
            await apiCall('POST', '/admin/mute', { user_name: userName, duration_hours: duration, reason: reason || '违反社区规定' });
            document.querySelector('.report-detail-modal')?.remove();
            await loadMutesData();
            renderTab('mutes');
            showToast('已禁言 ' + userName, 'success');
        } catch(e) { showToast('禁言失败: ' + e.message, 'error'); }
    };

    window.liftMute = function(id) {
        showConfirm('解除禁言', '确认解除该用户的禁言？', '确认解除', async function() {
            try {
                await apiCall('PUT', '/admin/mute/' + id + '/lift');
                await loadMutesData();
                renderTab('mutes');
                showToast('已解除禁言', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    // ===================== 黑名单管理 =====================
    async function loadBlacklistData() {
        try {
            if (API_BASE) {
                var data = await apiCall('GET', '/admin/blacklist');
                blacklistData = data.data || [];
            }
        } catch(e) { blacklistData = []; }
    }

    async function renderBlacklistTab(el) {
        if (!blacklistData.length) { await loadBlacklistData(); }
        var active = blacklistData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + blacklistData.length + '</div><div class="lbl">总黑名单记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前黑名单</div></div>';
        h += '</div>';

        h += '<div class="card">';
        h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
        h += '<h3 style="margin:0;">黑名单列表</h3>';
        h += '<button class="btn-sm primary" onclick="showAddBlacklistModal()">+ 添加黑名单</button>';
        h += '</div>';
        if (!blacklistData.length) {
            h += '<div class="empty">暂无黑名单记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>时间</th><th>过期</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            blacklistData.forEach(function(b) {
                var statusBadge = b.is_active ? '<span class="badge badge-red">黑名单中</span>' : '<span class="badge badge-green">已解除</span>';
                h += '<tr>';
                h += '<td><strong>' + escapeHtml(b.user_name) + '</strong></td>';
                h += '<td>' + (b.duration_hours > 0 ? formatDuration(b.duration_hours) : '永久') + '</td>';
                h += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(b.reason || '-') + '</td>';
                h += '<td>' + escapeHtml(b.added_by || '-') + '</td>';
                h += '<td style="font-size:12px;">' + formatTime(b.created_at) + '</td>';
                h += '<td style="font-size:12px;">' + (b.expires_at ? formatTime(b.expires_at) : '永久') + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (b.is_active) {
                    h += '<button class="btn-sm" onclick="liftBlacklist(\'' + b.id + '\')">解除</button>';
                } else {
                    h += '<span style="font-size:11px;color:var(--text-muted);">' + (b.lifted_at ? formatTime(b.lifted_at) : '-') + '</span>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.showAddBlacklistModal = function() {
        var modal = document.createElement('div');
        modal.className = 'report-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

        var box = document.createElement('div');
        box.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:16px;padding:24px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.onclick = function(e) { e.stopPropagation(); };

        var html = '<h3 style="margin:0 0 16px;">添加黑名单</h3>';
        html += '<div style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">用户名</label>';
        html += buildAdminUserPicker('blacklistUserName', '选择黑名单用户');
        html += '</div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';
        html += '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">时长</label><select id="blacklistDuration" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);background:rgba(255,255,255,0.8);font-size:13px;outline:none;">';
        html += '<option value="1">1小时</option><option value="6">6小时</option><option value="12">12小时</option><option value="24" selected>1天</option><option value="72">3天</option><option value="168">7天</option><option value="720">30天</option><option value="0">永久</option>';
        html += '</select></div>';
        html += '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">原因</label><input id="blacklistReason" placeholder="违反社区规定" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);background:rgba(255,255,255,0.8);font-size:13px;outline:none;"></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
        html += '<button class="btn-sm" onclick="this.closest(\'.report-detail-modal\').remove()">取消</button>';
        html += '<button class="btn-sm primary" onclick="addBlacklist()">加入黑名单</button>';
        html += '</div>';

        box.innerHTML = html;
        modal.appendChild(box);
        document.body.appendChild(modal);
    };

    window.addBlacklist = async function() {
        var userName = document.getElementById('blacklistUserName').value.trim();
        var duration = parseInt(document.getElementById('blacklistDuration').value);
        var reason = document.getElementById('blacklistReason').value.trim();
        if (!validateAdminTargetUser(userName, 'blacklistUserName')) return;
        try {
            await apiCall('POST', '/admin/blacklist', { user_name: userName, duration_hours: duration, reason: reason || '违反社区规定' });
            document.querySelector('.report-detail-modal')?.remove();
            await loadBlacklistData();
            renderTab('blacklist');
            showToast('已加入黑名单 ' + userName, 'success');
        } catch(e) { showToast('加入黑名单失败: ' + e.message, 'error'); }
    };

    window.liftBlacklist = function(id) {
        showConfirm('解除黑名单', '确认解除该用户的黑名单？', '确认解除', async function() {
            try {
                await apiCall('PUT', '/admin/blacklist/' + id + '/lift');
                await loadBlacklistData();
                renderTab('blacklist');
                showToast('已解除黑名单', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    var photosAdminData = [];

    async function loadPhotosAdminData() {
        try {
            var res = await apiCall('GET', '/admin/photos');
            photosAdminData = res.data || [];
        } catch(e) { photosAdminData = []; }
    }

    async function renderPhotosTab(el) {
        var h = '<div class="card"><h3>\u7167\u7247\u7ba1\u7406\uff08\u6570\u91cf\uff1a' + photosAdminData.length + '\uff09</h3>';
        if (!photosAdminData.length) {
            h += '<div class="empty">\u6682\u65e0\u7167\u7247\u6570\u636e</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>\u7f29\u7565\u56fe</th><th>\u7528\u6237</th><th>\u5927\u5c0f</th><th>\u6d4f\u89c8</th><th>\u4e0a\u4f20\u65f6\u95f4</th><th>\u64cd\u4f5c</th></tr></thead><tbody>';
            photosAdminData.forEach(function(p) {
                var extra = {};
                try { extra = JSON.parse(p.content || '{}'); } catch(e) {}
                var thumbUrl = extra.thumb || p.media_url || '';
                var fullUrl = p.media_url || extra.thumb || '';
                var previewUrl = fullUrl || thumbUrl;
                var thumbHtml = thumbUrl ? '<img src="' + escapeHtml(thumbUrl) + '" style="width:44px;height:44px;object-fit:cover;border-radius:6px;cursor:pointer;" loading="lazy" onclick="previewAdminPhoto(\'' + safeJsStr(previewUrl) + '\', \'' + safeJsStr(thumbUrl) + '\', \'' + safeJsStr(p.user_name || '') + '\', \'' + safeJsStr(p.created_at || '') + '\')" title="\u70b9\u51fb\u9884\u89c8\u5927\u56fe">' : '-';
                var actions = '<button class="btn-sm del" onclick="deleteAdminPhoto(\'' + p.id + '\')">\u5220\u9664</button>';
                h += '<tr><td>' + thumbHtml + '</td>';
                h += '<td>' + escapeHtml(p.user_name || '') + '</td>';
                h += '<td>' + (extra.fileSize ? (extra.fileSize / (1024 * 1024)).toFixed(2) + 'MB' : '-') + '</td>';
                h += '<td>' + (p.views || 0) + '</td>';
                h += '<td>' + formatTime(p.created_at) + '</td>';
                h += '<td>' + actions + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.previewAdminPhoto = function(url, fallbackUrl, username, time) {
        var modal = document.getElementById('photoPreviewModal');
        var img = document.getElementById('photoPreviewImg');
        var info = document.getElementById('photoPreviewInfo');
        if (!modal || !img) return;
        if (typeof time === 'undefined') {
            time = username;
            username = fallbackUrl;
            fallbackUrl = '';
        }
        img.onerror = function() {
            if (fallbackUrl && img.src !== fallbackUrl) {
                img.onerror = null;
                img.src = fallbackUrl;
                return;
            }
            img.onerror = null;
            img.removeAttribute('src');
        };
        img.src = url || fallbackUrl || '';
        img.alt = username + ' - ' + time;
        info.textContent = '用户: ' + (username || '未知') + ' | 时间: ' + (time || '未知');
        modal.style.display = 'flex';
    };

    window.closePhotoPreview = function() {
        var modal = document.getElementById('photoPreviewModal');
        if (modal) {
            modal.style.display = 'none';
            document.getElementById('photoPreviewImg').src = '';
        }
    };

    window.deleteAdminPhoto = function(id) {
        showConfirm('彻底删除照片', '删除后将从全站照片墙、数据库和存储中移除，且无法恢复。', '确认删除', async function() {
            try {
                await apiCall('DELETE', '/admin/photo/' + id);
                await loadPhotosAdminData();
                renderTab('photos');
                showToast('照片已删除', 'success');
            } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
        });
    };

    // ===================== 数据统计仪表盘 =====================
    window.statsDateStart = window.statsDateStart || '';
    window.statsDateEnd = window.statsDateEnd || '';
    window.statsChartMode = window.statsChartMode || 'visits'; // visits | attacks | posts | comments | likes

    async function renderStatsTab(el) {
        // ===== 先渲染骨架屏 =====
        var skeletonHtml = '<div class="card"><div class="date-filter-row">';
        skeletonHtml += '<span style="font-weight:600;font-size:14px;">日期筛选：</span>';
        skeletonHtml += '<input type="date" value="' + escapeHtml(window.statsDateStart) + '" disabled>';
        skeletonHtml += '<span style="color:var(--text-muted);">至</span>';
        skeletonHtml += '<input type="date" value="' + escapeHtml(window.statsDateEnd) + '" disabled>';
        skeletonHtml += '</div></div>';
        skeletonHtml += '<div class="stats-row">';
        var labels = ['用户数量','帖子数量','评论数量','点赞数量','照片数量','访问总次数','被攻击次数','API防火墙拦截'];
        labels.forEach(function(l) {
            skeletonHtml += '<div class="stat-box skeleton-pulse"><div class="val" style="height:28px;width:60%;background:rgba(255,255,255,0.08);border-radius:6px;">&nbsp;</div><div class="lbl">' + l + '</div></div>';
        });
        skeletonHtml += '</div>';
        skeletonHtml += '<div class="card"><h3>每日数据趋势</h3><div class="skeleton-pulse" style="height:120px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>攻击类型分布</h3><div class="skeleton-pulse" style="height:80px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>用户访问明细</h3><div class="skeleton-pulse" style="height:60px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        el.innerHTML = skeletonHtml;

        try {
            var summary, dailyData;

            if (API_BASE) {
                // 通过后端 API
                var dailyQuery = '/admin/stats/daily';
                var summaryQuery = '/admin/stats';
                if (window.statsDateStart) dailyQuery += '?start=' + window.statsDateStart;
                if (window.statsDateEnd) dailyQuery += (window.statsDateStart ? '&' : '?') + 'end=' + window.statsDateEnd;

                // summary也支持日期筛选
                if (window.statsDateStart || window.statsDateEnd) {
                    summaryQuery += '?';
                    if (window.statsDateStart) summaryQuery += 'start=' + window.statsDateStart;
                    if (window.statsDateEnd) summaryQuery += (window.statsDateStart ? '&' : '') + 'end=' + window.statsDateEnd;
                }

                var summaryR = apiCall('GET', summaryQuery);
                var dailyR = apiCall('GET', dailyQuery);
                summary = await summaryR;
                dailyData = await dailyR;
            }

            if (!summary) {
                el.innerHTML = '<div class="empty-state"><div class="icon">📊</div><div class="text">统计数据加载失败：无法连接后端 API</div></div>';
                return;
            }

            var daily = (dailyData && dailyData.daily) || [];

            // ===== 渲染真实内容 =====
            var h = '<div class="card"><div class="date-filter-row">';
            h += '<span style="font-weight:600;font-size:14px;">日期筛选：</span>';
            h += '<input type="date" id="statsDateStart" value="' + escapeHtml(window.statsDateStart) + '" onchange="window.statsDateStart=this.value;renderTab(\'stats\')" title="开始日期">';
            h += '<span style="color:var(--text-muted);">至</span>';
            h += '<input type="date" id="statsDateEnd" value="' + escapeHtml(window.statsDateEnd) + '" onchange="window.statsDateEnd=this.value;renderTab(\'stats\')" title="结束日期">';
            if (window.statsDateStart || window.statsDateEnd) {
                h += '<button onclick="window.statsDateStart=\'\';window.statsDateEnd=\'\';renderTab(\'stats\')">清除筛选</button>';
            }
            if (API_BASE) {
                h += '<button class="btn-sm primary" style="margin-left:auto;" onclick="apiCall(\'POST\',\'/admin/stats/refresh\').then(function(){renderTab(\'stats\');}).catch(function(){})">刷新缓存</button>';
            }
            h += '</div></div>';

            // ===== 总览数据卡片 =====
            h += '<div class="stats-row">';
            h += '<div class="stat-box"><div class="val">' + (summary.total_users || 0) + '</div><div class="lbl">用户数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_posts || 0) + '</div><div class="lbl">帖子数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_comments || 0) + '</div><div class="lbl">评论数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_likes || 0) + '</div><div class="lbl">点赞数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_photos || 0) + '</div><div class="lbl">照片数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_visits || 0) + '</div><div class="lbl">访问总次数</div></div>';
            h += '<div class="stat-box danger"><div class="val">' + (summary.total_attacks || 0) + '</div><div class="lbl">被攻击次数</div></div>';
            h += '<div class="stat-box warn"><div class="val">' + (summary.firewall_intercepts || 0) + '</div><div class="lbl">API防火墙拦截</div></div>';
            h += '</div>';

            // ===== 每日图表 =====
            var modes = [
                { key: 'visits', label: '访问量', color: '#059669' },
                { key: 'attacks', label: '攻击量', color: '#ff3b60' },
                { key: 'posts', label: '发帖量', color: '#3b82f6' },
                { key: 'comments', label: '评论量', color: '#f59e0b' },
                { key: 'likes', label: '点赞量', color: '#ec4899' },
                { key: 'new_users', label: '新用户', color: '#8b5cf6' }
            ];

            h += '<div class="card"><h3>每日数据趋势</h3>';
            h += '<div class="filter-chips" style="margin-bottom:12px;">';
            modes.forEach(function(m) {
                h += '<span class="filter-chip' + (window.statsChartMode === m.key ? ' active' : '') + '" onclick="window.statsChartMode=\'' + m.key + '\';renderTab(\'stats\')" style="cursor:pointer;">' + m.label + '</span>';
            });
            h += '</div>';

            if (daily.length === 0) {
                h += '<div class="empty" style="padding:24px;text-align:center;color:var(--text-muted);">暂无每日数据，刷新页面后开始记录访问</div>';
            } else {
                var maxVal = 0;
                daily.forEach(function(d) { var v = d[window.statsChartMode] || 0; if (v > maxVal) maxVal = v; });
                if (maxVal === 0) maxVal = 1;

                var activeMode = modes.find(function(m) { return m.key === window.statsChartMode; }) || modes[0];
                // 如果数据太多，只显示最近30天以防止图表过密
                var chartData = daily.length > 30 ? daily.slice(-30) : daily;

                h += '<div class="chart-legend">';
                h += '<span><span class="dot" style="background:' + activeMode.color + ';"></span>' + activeMode.label + '</span>';
                h += '<span style="color:var(--text-muted);font-size:11px;">最高: ' + maxVal + '</span>';
                h += '<span style="color:var(--text-muted);font-size:11px;">共 ' + daily.length + ' 天</span>';
                h += '</div>';
                h += '<div class="chart-bar-row">';
                chartData.forEach(function(d) {
                    var v = d[window.statsChartMode] || 0;
                    var heightPct = Math.max(4, Math.round((v / maxVal) * 100));
                    h += '<div class="chart-bar" style="height:' + heightPct + '%;background:' + activeMode.color + ';" title="' + escapeHtml(d.date) + ': ' + v + '">';
                    h += '<span class="bar-tip">' + v + '</span>';
                    h += '</div>';
                });
                h += '</div>';

                var labelStep = chartData.length > 18 ? 2 : 1;
                h += '<div class="chart-bar-labels">';
                chartData.forEach(function(d, index) {
                    var shortDate = d.date ? d.date.slice(5) : '';
                    h += '<div class="chart-bar-label">' + ((index % labelStep === 0 || index === chartData.length - 1) ? escapeHtml(shortDate) : '') + '</div>';
                });
                h += '</div>';
            }
            h += '</div>';

            // ===== 攻击类型分布 =====
            if (summary.attack_types && Object.keys(summary.attack_types).length > 0) {
                h += '<div class="card"><h3>攻击类型分布</h3>';
                var attackEntries = Object.entries(summary.attack_types).sort(function(a, b) { return b[1] - a[1]; });
                var attackMax = attackEntries[0] ? attackEntries[0][1] : 1;
                h += '<div style="display:flex;flex-direction:column;gap:8px;">';
                attackEntries.forEach(function(entry) {
                    var pct = Math.round((entry[1] / attackMax) * 100);
                    h += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;">';
                    h += '<span style="width:120px;text-align:right;color:var(--text-muted);">' + escapeHtml(entry[0]) + '</span>';
                    h += '<div style="flex:1;height:18px;background:rgba(255,59,96,0.1);border-radius:9px;overflow:hidden;">';
                    h += '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg, #ff3b60, #fb7185);border-radius:9px;transition:width 0.5s ease;"></div>';
                    h += '</div>';
                    h += '<span style="width:40px;font-weight:600;">' + entry[1] + '</span>';
                    h += '</div>';
                });
                h += '</div></div>';
            }

            // ===== 攻击详情占位（异步加载） =====
            h += '<div id="attackDetailsContainer"></div>';
            // ===== API防火墙拦截详情占位（异步加载） =====
            h += '<div id="firewallDetailsContainer"></div>';

            // ===== 每日数据详表 =====
            if (daily.length > 0) {
                h += '<div class="card"><h3>每日数据明细 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + daily.length + ' 天</span></h3>';
                h += '<div class="table-wrap"><table><thead><tr><th>日期</th><th>访问</th><th>攻击</th><th>帖子</th><th>评论</th><th>点赞</th><th>新用户</th></tr></thead><tbody>';
                var reversed = daily.slice().reverse();
                reversed.forEach(function(d, idx) {
                    // 跳过全0行（访问/攻击/帖子/评论/点赞/新用户全为0）
                    var total = (d.visits || 0) + (d.attacks || 0) + (d.posts || 0) + (d.comments || 0) + (d.likes || 0) + (d.new_users || 0);
                    if (total === 0) return;
                    h += '<tr>';
                    h += '<td><strong>' + escapeHtml(d.date) + '</strong></td>';
                    h += '<td' + (d.visits ? '' : ' class="zero-val"') + '>' + (d.visits || '') + '</td>';
                    h += '<td' + (d.attacks ? '' : ' class="zero-val"') + ' style="color:' + (d.attacks > 0 ? 'var(--danger)' : 'var(--text-muted)') + ';">' + (d.attacks || '') + '</td>';
                    h += '<td' + (d.posts ? '' : ' class="zero-val"') + '>' + (d.posts || '') + '</td>';
                    h += '<td' + (d.comments ? '' : ' class="zero-val"') + '>' + (d.comments || '') + '</td>';
                    h += '<td' + (d.likes ? '' : ' class="zero-val"') + '>' + (d.likes || '') + '</td>';
                    h += '<td' + (d.new_users ? '' : ' class="zero-val"') + '>' + (d.new_users || '') + '</td>';
                    h += '</tr>';
                    // 每行数据之间加分隔横线
                    h += '<tr class="divider-row"><td colspan="7"></td></tr>';
                });
                h += '</tbody></table></div></div>';
            }

            if (summary.cached_at) {
                h += '<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:8px;">数据缓存时间: ' + formatTime(summary.cached_at) + '（每60秒刷新）</div>';
            }

            el.innerHTML = h;

            // ===== 异步加载攻击详情 =====
            loadAttackDetails(el);
            // ===== 异步加载防火墙拦截详情 =====
            loadFirewallDetails(el);
            // ===== 异步加载用户访问明细 =====
            loadUserVisitStats(el);
        } catch(e) {
            el.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div class="text">统计数据加载失败: ' + escapeHtml(e.message) + '</div></div>';
        }
    }

    // ===================== 攻击详情（异步加载） =====================
    async function loadAttackDetails(el) {
        var container = document.createElement('div');
        container.id = 'attackDetailsCard';
        container.className = 'card';
        container.innerHTML = '<h3>被攻击详情 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">加载中...</span></h3><div class="loading">加载攻击记录中...</div>';
        // 替换占位符
        var placeholder = document.getElementById('attackDetailsContainer');
        if (placeholder) placeholder.replaceWith(container);

        try {
            var attackData;

            if (API_BASE) {
                attackData = await apiCall('GET', '/admin/stats/attacks?limit=200');
            }

            if (!attackData || !attackData.data || attackData.data.length === 0) {
                container.innerHTML = '<h3>被攻击详情</h3><div class="empty">暂无攻击记录</div>';
                return;
            }

            var attacks = attackData.data;
            var h = '<h3>被攻击详情 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + attackData.total + ' 条记录</span></h3>';
            h += '<div class="filter-chips" style="margin-bottom:10px;">';
            // 攻击类型过滤按钮
            var typeCounts = {};
            attacks.forEach(function(a) {
                typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
            });
            var allTypes = Object.keys(typeCounts).sort();
            h += '<span class="filter-chip active" id="attackFilterAll" onclick="filterAttacks(\'all\')">全部 (' + attacks.length + ')</span>';
            allTypes.forEach(function(t) {
                h += '<span class="filter-chip" id="attackFilter_' + escapeHtml(t) + '" onclick="filterAttacks(\'' + encodeURIComponent(t) + '\')">' + escapeHtml(t) + ' (' + typeCounts[t] + ')</span>';
            });
            h += '</div>';

            h += '<div class="table-wrap" style="max-height:500px;"><table class="table-modern"><thead><tr>';
            h += '<th>时间</th><th>IP地址</th><th>攻击类型</th><th>详情</th>';
            h += '</tr></thead><tbody id="attackTableBody">';

            attacks.forEach(function(a) {
                var typeColor = a.type === 'CORS' ? '#f59e0b' :
                               a.type === 'CSRF' ? '#ff3b60' :
                               a.type === 'RATE_LIMIT' ? '#8b5cf6' :
                               '#6b7280';
                var timeStr = a.created_at ? formatTime(a.created_at) : (a.attack_date || '--');
                h += '<tr class="attack-row" data-type="' + escapeHtml(a.type) + '">';
                h += '<td style="font-size:11px;white-space:nowrap;">' + timeStr + '</td>';
                h += '<td><code style="font-size:12px;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;">' + escapeHtml(a.ip) + '</code></td>';
                h += '<td><span class="badge" style="background:' + typeColor + '20;color:' + typeColor + ';font-size:11px;">' + escapeHtml(a.type) + '</span></td>';
                h += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-muted);">' + escapeHtml(a.detail) + '</td>';
                h += '</tr>';
            });

            h += '</tbody></table></div>';
            h += '<div style="font-size:11px;color:var(--text-muted);padding:8px 0 0;text-align:center;">仅显示最近 200 条记录</div>';

            container.innerHTML = h;

            // 添加全局过滤函数
            if (!window.filterAttacks) {
                window.filterAttacks = function(type) {
                    var decodedType = decodeURIComponent(type);
                    document.querySelectorAll('#attackDetailsCard .filter-chip').forEach(function(c) {
                        c.classList.remove('active');
                    });
                    if (decodedType === 'all') {
                        document.getElementById('attackFilterAll')?.classList.add('active');
                    } else {
                        var btn = document.getElementById('attackFilter_' + decodedType);
                        if (btn) btn.classList.add('active');
                    }
                    document.querySelectorAll('#attackTableBody .attack-row').forEach(function(row) {
                        if (decodedType === 'all' || row.getAttribute('data-type') === decodedType) {
                            row.style.display = '';
                        } else {
                            row.style.display = 'none';
                        }
                    });
                };
            }
        } catch(e) {
            container.innerHTML = '<h3>被攻击详情</h3><div class="empty">攻击记录加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    // ===================== API防火墙拦截详情（异步加载） =====================
    async function loadFirewallDetails(el) {
        var container = document.createElement('div');
        container.id = 'firewallDetailsCard';
        container.className = 'card';
        container.innerHTML = '<h3>API防火墙拦截详情 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">加载中...</span></h3><div class="loading">加载防火墙拦截记录中...</div>';
        var placeholder = document.getElementById('firewallDetailsContainer');
        if (placeholder) placeholder.replaceWith(container);

        try {
            var firewallData;

            if (API_BASE) {
                // 分别获取CORS和CSRF拦截记录
                var corsData = await apiCall('GET', '/admin/stats/attacks?limit=100&type=CORS');
                var csrfData = await apiCall('GET', '/admin/stats/attacks?limit=100&type=CSRF');
                firewallData = {
                    data: (corsData.data || []).concat(csrfData.data || []),
                    cors_total: corsData.total || 0,
                    csrf_total: csrfData.total || 0
                };
            }

            if (!firewallData || !firewallData.data || firewallData.data.length === 0) {
                container.innerHTML = '<h3>API防火墙拦截详情</h3><div class="empty">暂无防火墙拦截记录</div>';
                return;
            }

            var records = firewallData.data;
            records.sort(function(a, b) {
                return (b.created_at || '').localeCompare(a.created_at || '');
            });

            var h = '<h3>API防火墙拦截详情 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">CORS: ' + (firewallData.cors_total || 0) + ' 次 | CSRF: ' + (firewallData.csrf_total || 0) + ' 次</span></h3>';
            h += '<div class="table-wrap" style="max-height:400px;"><table class="table-modern"><thead><tr>';
            h += '<th>时间</th><th>来源IP</th><th>拦截类型</th><th>详情</th>';
            h += '</tr></thead><tbody>';

            records.forEach(function(r) {
                var isCors = r.type === 'CORS';
                var badgeColor = isCors ? '#f59e0b' : '#ff3b60';
                var badgeLabel = isCors ? 'CORS跨域' : 'CSRF跨站';
                var timeStr = r.created_at ? formatTime(r.created_at) : (r.attack_date || '--');
                h += '<tr>';
                h += '<td style="font-size:11px;white-space:nowrap;">' + timeStr + '</td>';
                h += '<td><code style="font-size:12px;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;">' + escapeHtml(r.ip) + '</code></td>';
                h += '<td><span class="badge" style="background:' + badgeColor + '20;color:' + badgeColor + ';font-size:11px;">' + badgeLabel + '</span></td>';
                h += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-muted);">' + escapeHtml(r.detail) + '</td>';
                h += '</tr>';
            });

            h += '</tbody></table></div>';

            container.innerHTML = h;
        } catch(e) {
            container.innerHTML = '<h3>API防火墙拦截详情</h3><div class="empty">防火墙拦截记录加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    // ===================== 用户访问明细（异步加载） =====================
    async function loadUserVisitStats(el) {
        var container = document.createElement('div');
        container.className = 'card';
        container.innerHTML = '<h3>用户访问明细 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">加载中...</span></h3><div class="loading">加载用户访问数据中...</div>';
        el.appendChild(container);

        try {
            var userData;

            if (API_BASE) {
                userData = await apiCall('GET', '/admin/stats/users');
            }

            if (!userData || !userData.users) {
                container.innerHTML = '<h3>用户访问明细</h3><div class="empty">暂无用户访问数据</div>';
                return;
            }

            var users = userData.users;
            var totalUsers = userData.total || 0;

            var h = '<h3>用户访问明细 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + totalUsers + ' 个用户</span></h3>';

            if (users.length === 0) {
                h += '<div class="empty">暂无用户访问数据</div>';
            } else {
                h += '<div class="table-wrap"><table><thead><tr>';
                h += '<th>用户</th><th>总访问次数</th><th>今日访问</th><th>最近登录</th><th>注册时间</th>';
                h += '</tr></thead><tbody>';

                var today = new Date().toISOString().slice(0, 10);
                users.forEach(function(u) {
                    var todayVisits = u.daily_visits && u.daily_visits[today] ? u.daily_visits[today] : 0;
                    var lastLogin = u.last_login || u.last_visit || '';
                    var regTime = u.reg_time || '';

                    h += '<tr>';
                    h += '<td><strong>' + escapeHtml(u.user_name) + '</strong></td>';
                    h += '<td><span style="color:var(--primary);font-weight:600;">' + u.total_visits + '</span></td>';
                    h += '<td>' + (todayVisits > 0 ? '<span style="color:#059669;font-weight:600;">' + todayVisits + '</span>' : '0') + '</td>';
                    h += '<td style="font-size:11px;color:var(--text-muted);">' + (lastLogin ? formatTime(lastLogin) : '--') + '</td>';
                    h += '<td style="font-size:11px;color:var(--text-muted);">' + (regTime ? formatTime(regTime) : '--') + '</td>';
                    h += '</tr>';
                });

                h += '</tbody></table></div>';
            }

            container.innerHTML = h;
        } catch(e) {
            container.innerHTML = '<h3>用户访问明细</h3><div class="empty">用户访问数据加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    window.quickBlacklistUser = function(userName) {
        var hours = prompt('请输入拉黑时长（小时），0=永久拉黑：', '24');
        if (hours === null) return;
        hours = parseInt(hours, 10);
        if (isNaN(hours) || hours < 0) { showToast('请输入有效的小时数', 'error'); return; }
        showConfirm('加入黑名单', '确认将 ' + userName + (hours > 0 ? ' 拉黑 ' + hours + ' 小时' : ' 永久拉黑') + '？', '确认拉黑', async function() {
            try {
                await apiCall('POST', '/admin/blacklist', {
                    user_name: userName,
                    duration_hours: hours,
                    reason: '管理员操作'
                });
                await loadBlacklistData();
                renderTab('blacklist');
                showToast('已拉黑 ' + userName, 'success');
            } catch(e) {
                showToast('拉黑失败: ' + e.message, 'error');
            }
        });
    };

    // 安全设置
    var securitySettings = { record_device: true, browser_fingerprint: true, canvas_fingerprint: true, security_alerts: true };

    async function loadSecuritySettings() {
        try {
            var res = await apiCall('GET', '/admin/security-settings');
            if (res && res.settings) securitySettings = res.settings;
        } catch(e) {}
    }

    window.saveSecuritySetting = async function(key, value) {
        var body = {};
        body[key] = value;
        try {
            await apiCall('POST', '/admin/security-settings', body);
            securitySettings[key] = value;
            showToast('设置已保存', 'success');
        } catch(e) {
            showToast('保存失败', 'error');
        }
    }

    window.cleanupOldLogs = async function() {
        if (!confirm('确定要清理过期日志吗？\n- 90天前的登录/安全日志\n- 30天前的错误日志\n此操作不会影响帖子、照片、评论、点赞。')) return;
        var resultEl = document.getElementById('cleanupResult');
        if (resultEl) resultEl.textContent = '清理中...';
        try {
            var res = await apiCall('POST', '/admin/cleanup-logs', { types: ['login','security','error'] });
            if (resultEl) resultEl.textContent = '已清理 ' + (res.total_deleted || 0) + ' 条记录';
            showToast('清理完成，共删除 ' + (res.total_deleted || 0) + ' 条', 'success');
        } catch(e) {
            if (resultEl) resultEl.textContent = '清理失败';
            showToast('清理失败', 'error');
        }
    };

    window.setSecurityTypeFilter = function(type) {
        securityTypeFilter = type;
        renderTab('security');
    };

    // 安全中心
    var securityTypeFilter = 'all';
    renderSecurityTab = function(el) {
        var alerts = allSecurityAlerts.slice();
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

        var todayAlerts = alerts.filter(function(a) { return a.created_at >= todayStart; });
        var highRiskCount = todayAlerts.filter(function(a) { return a.level === 'high'; }).length;
        var unreadCount = alerts.filter(function(a) { return !a.is_read; }).length;

        var typeLabels = {
            'same_ip_multi_users': '同 IP 多账号',
            'same_device_multi_users': '同设备多账号',
            'multi_ip_same_user': '同账号多 IP',
            'geo_change': '地区变化',
            'high_frequency_visit': '高频访问',
            'same_browser_fp_multi_users': '同浏览器指纹多账号',
            'same_canvas_fp_multi_users': '同 Canvas 指纹多账号'
        };

        var typeLevelClass = {
            'same_ip_multi_users': 'warn',
            'same_device_multi_users': 'danger',
            'multi_ip_same_user': 'danger',
            'geo_change': '',
            'high_frequency_visit': '',
            'same_browser_fp_multi_users': 'warn',
            'same_canvas_fp_multi_users': 'warn'
        };

        if (securityTypeFilter !== 'all') {
            alerts = alerts.filter(function(a) { return a.type === securityTypeFilter; });
        }

        var h = '';
        // 安全设置卡片
        h += '<div class="card" style="margin-bottom:12px;"><h3>⚙️ 安全识别开关</h3>';
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.record_device ? 'checked' : '') + ' onchange="saveSecuritySetting(\'record_device\',this.checked)" /> 基础设备记录</label></div>';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.browser_fingerprint ? 'checked' : '') + ' onchange="saveSecuritySetting(\'browser_fingerprint\',this.checked)" /> 浏览器指纹 Hash</label></div>';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.canvas_fingerprint ? 'checked' : '') + ' onchange="saveSecuritySetting(\'canvas_fingerprint\',this.checked)" /> Canvas 指纹 Hash</label></div>';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.webgl_fingerprint ? 'checked' : '') + ' onchange="saveSecuritySetting(\'webgl_fingerprint\',this.checked)" /> WebGL 指纹 (GPU)</label></div>';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.webrtc_local_ip ? 'checked' : '') + ' onchange="saveSecuritySetting(\'webrtc_local_ip\',this.checked)" /> WebRTC 内网IP检测</label></div>';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.advanced_fingerprint ? 'checked' : '') + ' onchange="saveSecuritySetting(\'advanced_fingerprint\',this.checked)" /> 增强指纹 (GPU+内网IP)</label></div>';
        h += '<div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ' + (securitySettings.security_alerts ? 'checked' : '') + ' onchange="saveSecuritySetting(\'security_alerts\',this.checked)" /> 安全提醒生成</label></div>';
        h += '</div></div>';

        // 日志清理按钮
        h += '<div class="card" style="margin-bottom:12px;">';
        h += '<h3>🗑️ 日志清理</h3>';
        h += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">登录/安全日志保留90天，错误日志保留30天</p>';
        h += '<button class="btn-sm del" onclick="cleanupOldLogs()">一键清理过期日志</button>';
        h += '<span id="cleanupResult" style="margin-left:8px;font-size:12px;"></span>';
        h += '</div>';

        h += '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + todayAlerts.length + '</div><div class="lbl">今日异常数</div></div>';
        h += '<div class="stat-box danger"><div class="val">' + highRiskCount + '</div><div class="lbl">高风险</div></div>';
        h += '<div class="stat-box warn"><div class="val">' + unreadCount + '</div><div class="lbl">未读</div></div>';
        h += '<div class="stat-box"><div class="val">' + alerts.length + '</div><div class="lbl">总提醒数</div></div>';
        h += '</div>';

        h += '<div class="card"><h3>安全提醒</h3>';

        // 类型筛选
        h += '<div class="filter-chips" style="margin-bottom:10px;">';
        h += '<span class="filter-chip' + (securityTypeFilter === 'all' ? ' active' : '') + '" onclick="window.setSecurityTypeFilter(\'all\')">全部</span>';
        Object.keys(typeLabels).forEach(function(k) {
            h += '<span class="filter-chip' + (securityTypeFilter === k ? ' active' : '') + '" onclick="window.setSecurityTypeFilter(\'' + k + '\')">' + typeLabels[k] + '</span>';
        });
        h += '</div>';

        if (!alerts.length) {
            h += '<div class="empty">暂无安全提醒</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>等级</th><th>用户</th><th>说明</th><th>关联</th><th>操作</th></tr></thead><tbody>';
            alerts.forEach(function(a) {
                var levelBadge = a.level === 'high' ? '<span class="badge badge-red">高风险</span>' : (a.level === 'warning' ? '<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;">警告</span>' : '<span class="badge badge-green">信息</span>');
                var typeLabel = typeLabels[a.type] || a.type;
                var relatedHtml = (a.related_users || []).slice(0, 3).map(function(u) { return escapeHtml(u); }).join(', ');
                if ((a.related_users || []).length > 3) relatedHtml += ' ...';
                var actionsHtml = '';
                if (!a.is_read) {
                    actionsHtml += '<button class="btn-sm" onclick="markSecurityAlertRead(\'' + a.id + '\')">已读</button>';
                }
                var ignored = a.ignored || false;
                var fpVal = a.false_positive || false;
                if (!fpVal) {
                    actionsHtml += '<button class="btn-sm" onclick="setSecurityAlertStatus(\'' + a.id + '\',\'ignored\')">忽略</button>';
                    actionsHtml += '<button class="btn-sm del" onclick="setSecurityAlertStatus(\'' + a.id + '\',\'false_positive\')">误报</button>';
                }
                if (ignored || fpVal) {
                    actionsHtml += '<span style="font-size:10px;color:var(--text-muted);">' + (fpVal ? '已标记误报' : '已忽略') + '</span>';
                }
                var rowClass = !a.is_read ? ' style="background:rgba(255,59,96,0.03);"' : '';
                h += '<tr' + rowClass + '><td>' + escapeHtml(formatTime(a.created_at)) + '</td><td>' + escapeHtml(typeLabel) + '</td><td>' + levelBadge + '</td><td><strong>' + escapeHtml(a.user_name) + '</strong></td><td style="max-width:240px;white-space:normal;word-break:break-word;">' + escapeHtml(a.reason || '-') + '</td><td style="font-size:11px;max-width:160px;white-space:normal;word-break:break-word;">' + relatedHtml + '</td><td>' + actionsHtml + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    // 标记安全提醒已读
    window.markSecurityAlertRead = async function(alertId) {
        if (!alertId) return;
        try {
            await apiCall('POST', '/admin/security-alerts/status', { id: alertId, status: 'read' });
            var alert = allSecurityAlerts.find(function(a) { return a.id === alertId; });
            if (alert) alert.is_read = true;
            renderTab('security');
        } catch(e) {
            showToast('操作失败', 'error');
        }
    };

    window.setSecurityAlertStatus = async function(alertId, status) {
        if (!alertId) return;
        try {
            await apiCall('POST', '/admin/security-alerts/status', { id: alertId, status: status });
            // Reload alerts
            var secRes = await apiCall('GET', '/admin/security-alerts');
            allSecurityAlerts = secRes.data || [];
            renderTab('security');
            showToast(status === 'ignored' ? '已忽略' : '已标记误报', 'success');
        } catch(e) {
            showToast('操作失败', 'error');
        }
    };

    renderBansTab = async function(el) {
        if (!bansData.length) await loadBansData();
        var active = bansData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + bansData.length + '</div><div class="lbl">总封禁记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前封禁</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>快速封禁用户</h3>' + buildAdminActionToolbar('banUserName', 'banDuration', 'banReason', '封禁时长', '封禁原因', '输入封禁原因') + buildAdminActionUserCards('ban') + '</div>';
        h += '<div class="card"><h3>封禁记录</h3>';
        if (!bansData.length) {
            h += '<div class="empty">暂无封禁记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>封禁时间</th><th>过期时间</th><th>状态</th><th>解除</th></tr></thead><tbody>';
            bansData.forEach(function(b) {
                var statusBadge = b.is_active ? '<span class="badge badge-red">封禁中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftTime = !b.is_active && b.lifted_at ? formatTime(b.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(b.user_name) + '</strong></td><td>' + (b.ban_type === 'permanent' ? '永久' : formatDuration(b.ban_duration_hours || 0)) + '</td><td style="max-width:150px;">' + escapeHtml(b.ban_reason || '-') + '</td><td>' + escapeHtml(b.banned_by || '-') + '</td><td>' + formatTime(b.banned_at) + '</td><td>' + (b.expires_at ? formatTime(b.expires_at) : '-') + '</td><td>' + statusBadge + '</td><td>' + (b.is_active ? '<button class="btn-sm" onclick="liftBan(\'' + b.id + '\')">解除</button>' : liftTime) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    renderMutesTab = async function(el) {
        if (!mutesData.length) await loadMutesData();
        var active = mutesData.filter(function(m) { return m.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + mutesData.length + '</div><div class="lbl">总禁言记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前禁言</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>快速禁言用户</h3>' + buildAdminActionToolbar('muteUserName', 'muteDuration', 'muteReason', '禁言时长', '禁言原因', '输入禁言原因') + buildAdminActionUserCards('mute') + '</div>';
        h += '<div class="card"><h3>禁言记录</h3>';
        if (!mutesData.length) {
            h += '<div class="empty">暂无禁言记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>开始时间</th><th>过期时间</th><th>状态</th><th>解除</th></tr></thead><tbody>';
            mutesData.forEach(function(m) {
                var statusBadge = m.is_active ? '<span class="badge badge-red">禁言中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftTime = !m.is_active && m.lifted_at ? formatTime(m.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(m.user_name) + '</strong></td><td>' + (m.duration_hours > 0 ? formatDuration(m.duration_hours) : '永久') + '</td><td style="max-width:150px;">' + escapeHtml(m.reason || '-') + '</td><td>' + escapeHtml(m.muted_by || '-') + '</td><td>' + formatTime(m.created_at) + '</td><td>' + (m.expires_at ? formatTime(m.expires_at) : '永久') + '</td><td>' + statusBadge + '</td><td>' + (m.is_active ? '<button class="btn-sm" onclick="liftMute(\'' + m.id + '\')">解除</button>' : liftTime) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    renderBlacklistTab = async function(el) {
        if (!blacklistData.length) await loadBlacklistData();
        var active = blacklistData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + blacklistData.length + '</div><div class="lbl">总黑名单记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前黑名单</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>快速拉黑用户</h3>' + buildAdminActionToolbar('blacklistUserName', 'blacklistDuration', 'blacklistReason', '拉黑时长', '拉黑原因', '输入拉黑原因') + buildAdminActionUserCards('blacklist') + '</div>';
        h += '<div class="card"><h3>黑名单记录</h3>';
        if (!blacklistData.length) {
            h += '<div class="empty">暂无黑名单记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>加入时间</th><th>过期时间</th><th>状态</th><th>解除</th></tr></thead><tbody>';
            blacklistData.forEach(function(b) {
                var statusBadge = b.is_active ? '<span class="badge badge-red">黑名单中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftTime = !b.is_active && b.lifted_at ? formatTime(b.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(b.user_name) + '</strong></td><td>' + (b.duration_hours > 0 ? formatDuration(b.duration_hours) : '永久') + '</td><td style="max-width:150px;">' + escapeHtml(b.reason || '-') + '</td><td>' + escapeHtml(b.added_by || '-') + '</td><td>' + formatTime(b.created_at) + '</td><td>' + (b.expires_at ? formatTime(b.expires_at) : '永久') + '</td><td>' + statusBadge + '</td><td>' + (b.is_active ? '<button class="btn-sm" onclick="liftBlacklist(\'' + b.id + '\')">解除</button>' : liftTime) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    function buildAdminStackItemV2(config) {
        return [
            '<div class="admin-stack-item' + (config.itemClass ? ' ' + config.itemClass : '') + '">',
            '<div class="admin-stack-main">',
            '<div class="admin-stack-title"><strong>' + config.title + '</strong>' + (config.tags || '') + '</div>',
            '<div class="admin-stack-metrics">' + (config.metrics || '') + '</div>',
            '<div class="admin-stack-meta">' + (config.meta || '') + '</div>',
            '</div>',
            '<div class="admin-stack-side">',
            config.badge || '',
            '<div class="admin-stack-actions">' + (config.actions || '') + '</div>',
            '</div>',
            '</div>'
        ].join('');
    }

    function buildAdminModerationRecordListV2(kind, records) {
        if (!records.length) return '<div class="empty">暂无记录</div>';
        return '<div class="admin-stack-list">' + records.map(function(record) {
            var isBan = kind === 'ban';
            var reason = escapeHtml((isBan ? record.ban_reason : record.reason) || '-');
            var duration = isBan
                ? (record.ban_type === 'permanent' ? '永久' : formatDuration(record.ban_duration_hours || 0))
                : ((record.duration_hours || 0) > 0 ? formatDuration(record.duration_hours) : '永久');
            var startTime = isBan ? formatTime(record.banned_at) : formatTime(record.created_at);
            var operator = escapeHtml((isBan ? record.banned_by : record.muted_by) || '-');
            var badge = record.is_active
                ? '<span class="badge badge-red">' + (isBan ? '封禁中' : '禁言中') + '</span>'
                : '<span class="badge badge-green">已解除</span>';
            var actions = record.is_active
                ? '<button class="btn-sm' + (isBan ? ' del' : '') + '" onclick="' + (isBan ? 'liftBan' : 'liftMute') + '(' + "'" + escapeHtml(String(record.id || '')) + "'" + ')">解除</button>'
                : '<span style="color:var(--text-muted);font-size:12px;">' + escapeHtml(record.lifted_at ? formatTime(record.lifted_at) : '已结束') + '</span>';
            return buildAdminStackItemV2({
                itemClass: record.is_active ? (isBan ? 'is-banned' : 'is-muted') : '',
                title: escapeHtml(record.user_name || '-'),
                metrics: '<span>时长：' + escapeHtml(duration) + '</span><span>原因：' + reason + '</span>',
                meta: '<span>操作人：' + operator + '</span><span>' + (isBan ? '封禁时间：' : '开始时间：') + escapeHtml(startTime) + '</span><span>到期时间：' + escapeHtml(record.expires_at ? formatTime(record.expires_at) : '永久') + '</span>',
                badge: badge,
                actions: actions
            });
        }).join('') + '</div>';
    }

    window.buildUserTagMarkup = function(flags) {
        var html = '';
        if (flags.isAdmin) html += '<span class="tag tag-admin">管理员</span>';
        if (flags.isBanned) html += '<span class="tag tag-banned">封禁中</span>';
        if (flags.isMuted) html += '<span class="tag tag-muted">禁言中</span>';
        return html;
    };
    buildUserTagMarkup = window.buildUserTagMarkup;

    renderUsersTab = function(el) {
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + allUsers.length + '</div><div class="lbl">注册用户</div></div>';
        h += '<div class="stat-box"><div class="val">' + allPosts.length + '</div><div class="lbl">帖子总数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allLikes.length + '</div><div class="lbl">点赞总数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allComments.length + '</div><div class="lbl">评论总数</div></div>';
        h += '</div>';

        var filtered = allUsers.slice();
        if (searchUser) {
            var sq = searchUser.toLowerCase();
            filtered = filtered.filter(function(u) { return u.name.toLowerCase().includes(sq); });
        }
        if (userFilterStatus === 'admin') {
            filtered = filtered.filter(function(u) { return u.name === ADMIN; });
        } else if (userFilterStatus === 'banned') {
            filtered = filtered.filter(function(u) { return bansData.some(function(b) { return b.user_name === u.name && b.is_active; }); });
        } else if (userFilterStatus === 'muted') {
            filtered = filtered.filter(function(u) { return mutesData.some(function(m) { return m.user_name === u.name && m.is_active; }); });
        }
        filtered.sort(function(a, b) {
            if (userSortBy === 'posts') return getUserActivityStats(b.name).posts - getUserActivityStats(a.name).posts;
            if (userSortBy === 'login') return toAdminTimeMs(b.info && (b.info.last_login || b.info.last_visit)) - toAdminTimeMs(a.info && (a.info.last_login || a.info.last_visit));
            return toAdminTimeMs(getAdminUserEffectiveRegTime(b.info)) - toAdminTimeMs(getAdminUserEffectiveRegTime(a.info));
        });

        h += '<div class="card"><h3>用户列表（' + filtered.length + '位）</h3>';
        h += '<div class="search-bar"><input id="userSearchInp" placeholder="搜索用户名..." oninput="searchUserInp()" value="' + escapeHtml(searchUser) + '" /></div>';
        h += '<div class="filter-chips" style="margin-bottom:10px;">';
        h += '<span class="filter-chip' + (userFilterStatus === 'all' ? ' active' : '') + '" onclick="userFilterStatus=\'all\';renderTab(\'users\')">全部</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'admin' ? ' active' : '') + '" onclick="userFilterStatus=\'admin\';renderTab(\'users\')">管理员</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'banned' ? ' active active-del' : '') + '" onclick="userFilterStatus=\'banned\';renderTab(\'users\')">封禁中</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'muted' ? ' active active-warn' : '') + '" onclick="userFilterStatus=\'muted\';renderTab(\'users\')">禁言中</span>';
        h += '</div>';
        if (!filtered.length) { h += '<div class="empty">没有匹配用户</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>最近设备</th><th>地区</th><th>最近IP</th><th>帖子</th><th>点赞</th><th>评论</th><th>操作</th></tr></thead><tbody>';
            filtered.forEach(function(u) {
                var stats = getUserActivityStats(u.name);
                var flags = getUserStateFlags(u.name);
                var statusText = flags.isAdmin
                    ? '管理员'
                    : (flags.isBanned
                        ? '封禁中'
                        : (flags.isMuted
                            ? '禁言中'
                            : '正常'));
                var safeName = safeJsStr(u.name);
                var actions = flags.isAdmin
                    ? '-'
                    : '<button class="btn-sm" onclick="quickMuteUser(\'' + safeName + '\')">禁言</button><button class="btn-sm del" onclick="quickBanUser(\'' + safeName + '\')">封禁</button><button class="btn-sm del" onclick="confirmDeleteUser(\'' + safeName + '\')">删除账号</button>';
                var regTime = getAdminUserEffectiveRegTime(u.info);

                // 最近登录设备 & IP（从 allLoginEvents 筛选并排序）
                var userEvents = allLoginEvents.filter(function(ev) { return ev.user_name === u.name; });
                userEvents.sort(function(a, b) {
                    var infoA = {}; try { infoA = JSON.parse(a.content || '{}'); } catch(e) {}
                    var infoB = {}; try { infoB = JSON.parse(b.content || '{}'); } catch(e) {}
                    var ta = (infoA.login_at || a.created_at || '');
                    var tb = (infoB.login_at || b.created_at || '');
                    return (new Date(tb).getTime() || 0) - (new Date(ta).getTime() || 0);
                });
                var latestEvent = userEvents[0];
                var deviceCell = '-';
                var regionCell = '-';
                var ipCell = '-';
                var latestLoginTime = '';
                if (latestEvent) {
                    try {
                        var lc = JSON.parse(latestEvent.content || '{}');
                        var deviceText = escapeHtml((lc.device_type || '?') + ' · ' + (lc.os || '?') + ' · ' + (lc.browser || '?'));
                        ipCell = escapeHtml(lc.ip || '-');
                        if (lc.ip_location && lc.ip_location.text) {
                            regionCell = escapeHtml(lc.ip_location.text);
                        } else {
                            // 回退：使用用户信息中存储的IP位置或精确定位
                            try {
                                var ui2 = JSON.parse(user.content || '{}');
                                if (ui2.last_ip_location && ui2.last_ip_location.text) {
                                    regionCell = escapeHtml(ui2.last_ip_location.text);
                                } else if (ui2.last_location && ui2.last_location.address) {
                                    regionCell = escapeHtml(ui2.last_location.address);
                                } else if (ui2.last_location && ui2.last_location.text) {
                                    regionCell = escapeHtml(ui2.last_location.text);
                                }
                            } catch(e) {}
                        }
                        latestLoginTime = lc.login_at || latestEvent.created_at || '';
                        var escapedName = safeJsStr(u.name);
                        deviceCell = '<a href="#" onclick="showUserLoginDetail(\'' + escapedName + '\');return false;" style="color:var(--primary);text-decoration:underline;">' + deviceText + '</a>';
                    } catch(ex) {}
                }

                // 最近登录时间优先用最新 login 事件
                var displayLastLogin = latestLoginTime || (u.info && (u.info.last_login || u.info.last_visit));
                var lastLogin = displayLastLogin ? formatTime(displayLastLogin) : '-';

                h += '<tr><td><strong><a href="#" onclick="showUserDetailModal(\'' + safeName + '\');return false;" style="color:var(--primary);font-weight:700;text-decoration:underline;text-underline-offset:3px;">' + escapeHtml(u.name) + '</a></strong></td><td>' + escapeHtml(statusText) + '</td><td>' + escapeHtml(regTime ? formatTime(regTime) : '-') + '</td><td>' + escapeHtml(lastLogin) + '</td><td>' + deviceCell + '</td><td>' + regionCell + '</td><td>' + ipCell + '</td><td>' + stats.posts + '</td><td>' + stats.likes + '</td><td>' + stats.comments + '</td><td>' + actions + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        h += '<div id="userLoginDetail" style="display:none;margin-top:12px;"></div>';
        el.innerHTML = h;
    };

    renderBansTab = async function(el) {
        if (!bansData.length) await loadBansData();
        var active = bansData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + bansData.length + '</div><div class="lbl">总封禁记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前封禁</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>封禁记录（' + bansData.length + '条）</h3>';
        if (!bansData.length) { h += '<div class="empty">暂无封禁记录</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>封禁时间</th><th>到期时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            bansData.forEach(function(b) {
                var statusBadge = b.is_active ? '<span class="badge badge-red">封禁中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftInfo = !b.is_active && b.lifted_at ? formatTime(b.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(b.user_name) + '</strong></td><td>' + (b.ban_type === 'permanent' ? '永久' : formatDuration(b.ban_duration_hours || 0)) + '</td><td style="max-width:150px;">' + escapeHtml(b.ban_reason || '-') + '</td><td>' + escapeHtml(b.banned_by || '-') + '</td><td>' + formatTime(b.banned_at) + '</td><td>' + (b.expires_at ? formatTime(b.expires_at) : '永久') + '</td><td>' + statusBadge + '</td><td>' + (b.is_active ? '<button class="btn-sm del" onclick="liftBan(\'' + b.id + '\')">解除</button>' : liftInfo) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    renderMutesTab = async function(el) {
        if (!mutesData.length) await loadMutesData();
        var active = mutesData.filter(function(m) { return m.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + mutesData.length + '</div><div class="lbl">总禁言记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前禁言</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>禁言记录（' + mutesData.length + '条）</h3>';
        if (!mutesData.length) { h += '<div class="empty">暂无禁言记录</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>开始时间</th><th>到期时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            mutesData.forEach(function(m) {
                var statusBadge = m.is_active ? '<span class="badge badge-red">禁言中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftInfo = !m.is_active && m.lifted_at ? formatTime(m.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(m.user_name) + '</strong></td><td>' + ((m.duration_hours || 0) > 0 ? formatDuration(m.duration_hours) : '永久') + '</td><td style="max-width:150px;">' + escapeHtml(m.reason || '-') + '</td><td>' + escapeHtml(m.muted_by || '-') + '</td><td>' + formatTime(m.created_at) + '</td><td>' + (m.expires_at ? formatTime(m.expires_at) : '永久') + '</td><td>' + statusBadge + '</td><td>' + (m.is_active ? '<button class="btn-sm" onclick="liftMute(\'' + m.id + '\')">解除</button>' : liftInfo) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    function renderAdminTabLoading(panel, tab) {
        if (!panel || panel.childElementCount > 0) return;
        panel.setAttribute('aria-busy', 'true');
        panel.innerHTML = '<div class="admin-tab-loading" role="status" aria-live="polite">' +
            '<div class="admin-tab-loading-card skeleton-pulse"></div>' +
            '<div class="admin-tab-loading-card skeleton-pulse"></div>' +
            '<span class="admin-tab-loading-label">正在加载' + escapeHtml(tab || '页面') + '数据…</span>' +
            '</div>';
    }

    function renderAdminTabLoadError(panel, tab, message) {
        if (!panel) return;
        panel.removeAttribute('aria-busy');
        panel.innerHTML = '<div class="empty-state" role="alert"><div class="icon">!</div>' +
            '<div class="text">数据加载失败：' + escapeHtml(message || '请重试') + '</div>' +
            '<button class="btn-sm primary" type="button" onclick="refreshAdminTab(\'' + safeJsStr(tab) + '\')">重新加载</button></div>';
    }

    window.switchTab = async function(tab) {
        var normalized = tab;
        var allTabs = ['ann','stats','users','clipboard','security','posts','likes','comments','reports','bans','mutes','photos','email','audit','behavior','errorlog','blacklist','ai'];
        if (allTabs.indexOf(normalized) === -1) return;
        var switchGeneration = ++adminTabSwitchGeneration;
        currentTab = normalized;
        saveCurrentTab();
        if (normalized === 'reports') {
            var badge = document.getElementById('reportBadge');
            if (badge) badge.style.display = 'none';
        }
        allTabs.forEach(function(t) {
            var panel = document.getElementById('tab' + getTabDomName(t));
            var btn = document.getElementById('tab' + getTabDomName(t) + 'Btn');
            if (panel) panel.classList.remove('active');
            if (btn) btn.classList.remove('active');
        });
        var panel = document.getElementById('tab' + getTabDomName(normalized));
        var btn = document.getElementById('tab' + getTabDomName(normalized) + 'Btn');
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        renderAdminTabLoading(panel, normalized);

        // 视觉切换不能等待提醒写入；后台完成即可。
        if (normalized === 'users') markRegisterAlertsRead().catch(function() {});

        try {
            await loadTabDataIfNeeded(normalized);
            if (switchGeneration !== adminTabSwitchGeneration || currentTab !== normalized) return;
            if (panel) panel.removeAttribute('aria-busy');
            window.renderTab(normalized);
        } catch (e) {
            if (switchGeneration !== adminTabSwitchGeneration || currentTab !== normalized) return;
            renderAdminTabLoadError(panel, normalized, e && e.message);
        }
    };

    window.renderTab = function(tab) {
        var normalized = tab;
        var el = document.getElementById('tab' + getTabDomName(normalized));
        if (!el) return;
        switch(normalized) {
            case 'ann': renderAnnTab(el); break;
            case 'users': renderUsersTab(el); break;
            case 'clipboard': renderClipboardTab(el); break;
            case 'security': renderSecurityTab(el); break;
            case 'posts': renderPostsTab(el); break;
            case 'likes': renderLikesTab(el); break;
            case 'comments': renderCommentsTab(el); break;
            case 'reports': renderReportsTab(el); break;
            case 'bans': renderBansTab(el); break;
            case 'mutes': renderMutesTab(el); break;
            case 'photos': renderPhotosTab(el); break;
            case 'stats': renderStatsTab(el); break;
            case 'audit': renderAuditTab(el); break;
            case 'behavior': renderBehaviorTab(el); break;
            case 'errorlog': renderErrorLogTab(el); break;
            case 'email': renderEmailTab(el); break;
            case 'ai': renderAiTab(el); break;
        }
    };

    (function retireBlacklistUi() {
        var btn = document.getElementById('tabBlacklistBtn');
        var panel = document.getElementById('tabBlacklist');
        if (btn) btn.remove();
        if (panel) panel.remove();
        try {
            if (localStorage.getItem(TAB_KEY) === 'blacklist') {
                localStorage.setItem(TAB_KEY, 'bans');
            }
        } catch(_) {}
    })();

    function buildAdminMediaThumb(post, username, createdAt) {
        if (!post || !post.media_url) return '-';
        if (String(post.media_url).indexOf('http') === 0) {
            return '<img src="' + escapeHtml(post.media_url) + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="previewAdminPhoto(\'' + safeJsStr(post.media_url) + '\',\'' + safeJsStr(username || post.user_name || '') + '\',\'' + safeJsStr(createdAt || post.created_at || '') + '\')" title="点击预览大图">';
        }
        return '📎';
    }

    renderPostsTab = async function(el) {
        var visiblePosts = allPosts.filter(function(p) { return [ANN_MARKER, '__photo_wall__', REPORT_MARKER, '__vip__', '__vip_order__', '__vip_plan__', '__pro_gift__', '__pro_gift_claim__', '__user_style__', '__auth__', '__admin_auth__', '__user_info__', '__user_visit__', '__login_event__', '__user_behavior__', '__security_alert__', '__admin_audit__', '__client_error__', '__email_sent__', '__email_recipient_history__'].indexOf(p.media_type) < 0; });
        var h = '<div class="card"><h3>帖子管理（' + visiblePosts.length + '条）</h3>';
        h += '<div class="search-bar"><input id="postSearchInp" placeholder="搜索帖子内容或用户名..." oninput="searchPostInp()" /></div>';
        var filtered = visiblePosts;
        if (searchPost) {
            var q = searchPost.toLowerCase();
            filtered = visiblePosts.filter(function(p) {
                return (p.user_name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q);
            });
        }
        if (!filtered.length) {
            h += '<div class="empty">无匹配帖子</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>内容</th><th>附件</th><th>浏览</th><th>时间</th><th>操作</th></tr></thead><tbody>';
            filtered.forEach(function(p) {
                var summary = getAdminPostSummary(p);
                var content = summary.hasImage && !summary.text ? '' : String(summary.text || '').slice(0, 60);
                if (summary.text && summary.text.length > 60) content += '...';
                h += '<tr><td>' + escapeHtml(p.user_name || '') + '</td>';
                h += '<td>' + escapeHtml(content) + '</td>';
                h += '<td>' + buildAdminMediaThumb(p) + '</td>';
                h += '<td>' + (p.views || 0) + '</td>';
                h += '<td>' + formatTime(p.created_at) + '</td>';
                h += '<td><button class="btn-sm del" onclick="deleteAdminPost(\'' + p.id + '\')">删除</button></td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    renderLikesTab = async function(el) {
        var h = '<div class="card"><h3>点赞记录（' + allLikes.length + '条）</h3>';
        if (!allLikes.length) {
            h += '<div class="empty">暂无点赞数据</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>帖子作者</th><th>帖子内容</th><th>附件</th><th>时间</th></tr></thead><tbody>';
            allLikes.slice(0, 500).forEach(function(l) {
                var post = allPosts.find(function(p) { return p.id === l.post_id; });
                var summary = post ? getAdminPostSummary(post) : { text: '(已删除)', hasImage: false };
                var postContent = summary.hasImage && !summary.text ? '' : String(summary.text || '').slice(0, 30);
                if (summary.text && summary.text.length > 30) postContent += '...';
                h += '<tr><td>' + escapeHtml(l.user_name || '') + '</td>';
                h += '<td>' + escapeHtml((post && post.user_name) || '') + '</td>';
                h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(postContent) + '</td>';
                h += '<td>' + (post ? buildAdminMediaThumb(post) : '-') + '</td>';
                h += '<td>' + formatTime(l.created_at) + '</td></tr>';
            });
            h += '</tbody></table></div>';
            if (allLikes.length > 500) h += '<div class="empty">仅显示最近500条记录</div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    loadReportsData = async function() {
        try {
            var data = await apiCall('GET', '/admin/reports');
            reportsData = Array.isArray(data.data) ? data.data : [];
        } catch(e) {
            reportsData = [];
        }
        updateReportBadge();
    };

    renderReportsTab = async function(el) {
        var pending = reportsData.filter(function(r) { return r.status === 'pending'; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + reportsData.length + '</div><div class="lbl">总举报数</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + pending + '</div><div class="lbl">待处理</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--primary)">' + reportsData.filter(function(r) { return r.status === 'actioned'; }).length + '</div><div class="lbl">已处理</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>举报管理</h3>';
        if (!reportsData.length) {
            h += '<div class="empty">暂无举报</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>举报人</th><th>类型</th><th>被举报人</th><th>分类</th><th>原因</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            reportsData.forEach(function(r) {
                var statusBadge = r.status === 'pending' ? '<span class="badge badge-red">待处理</span>' :
                    r.status === 'reviewed' ? '<span class="badge badge-green">已审核</span>' :
                    r.status === 'dismissed' ? '<span class="badge" style="background:rgba(128,128,128,0.15);color:var(--text-muted)">已驳回</span>' :
                    '<span class="badge badge-green">已处理</span>';
                var typeLabel = r.target_type === 'photo' ? '照片墙' : '帖子';
                h += '<tr><td>' + escapeHtml(r.reporter_name || '-') + '</td>';
                h += '<td>' + escapeHtml(typeLabel) + '</td>';
                h += '<td><strong>' + escapeHtml(r.target_user || '-') + '</strong></td>';
                h += '<td>' + escapeHtml(r.report_category || '-') + '</td>';
                h += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(r.report_reason || '-') + '</td>';
                h += '<td>' + formatTime(r.created_at) + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (r.status === 'pending') {
                    h += '<button class="btn-sm primary" onclick="handleReportDetail(\'' + r.id + '\')">处理</button> ';
                    h += '<button class="btn-sm" onclick="dismissReport(\'' + r.id + '\')">驳回</button>';
                } else {
                    h += '<button class="btn-sm" onclick="handleReportDetail(\'' + r.id + '\')">详情</button>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    loadUserVisitStats = async function(el) {
        var container = document.createElement('div');
        container.id = 'userVisitStatsCard';
        container.className = 'card';
        container.innerHTML = '<h3>用户访问明细 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">加载中...</span></h3><div class="loading">加载用户访问数据中...</div>';
        var placeholder = document.getElementById('userVisitStatsContainer');
        if (placeholder) placeholder.replaceWith(container);
        else el.appendChild(container);
        try {
            var userData;
            if (API_BASE) {
                userData = await apiCall('GET', '/admin/stats/users');
            }
            if (!userData || !userData.users) {
                container.innerHTML = '<h3>用户访问明细</h3><div class="empty">暂无用户访问数据</div>';
                return;
            }
            var users = userData.users;
            var totalUsers = userData.total || 0;
            var h = '<h3>用户访问明细 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + totalUsers + ' 个用户</span></h3>';
            if (users.length === 0) {
                h += '<div class="empty">暂无用户访问数据</div>';
            } else {
                h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>总访问次数</th><th>今日访问</th><th>最近登录</th><th>注册时间</th></tr></thead><tbody>';
                var today = new Date().toISOString().slice(0, 10);
                users.forEach(function(u) {
                    var todayVisits = u.daily_visits && u.daily_visits[today] ? u.daily_visits[today] : 0;
                    var lastLogin = u.last_login || u.last_visit || '';
                    var regTime = u.reg_time || '';
                    h += '<tr><td><strong>' + escapeHtml(u.user_name) + '</strong></td>';
                    h += '<td><span style="color:var(--primary);font-weight:600;">' + u.total_visits + '</span></td>';
                    h += '<td>' + (todayVisits > 0 ? '<span style="color:#059669;font-weight:600;">' + todayVisits + '</span>' : '0') + '</td>';
                    h += '<td style="font-size:11px;color:var(--text-muted);">' + (lastLogin ? formatTime(lastLogin) : '--') + '</td>';
                    h += '<td style="font-size:11px;color:var(--text-muted);">' + (regTime ? formatTime(regTime) : '--') + '</td></tr>';
                });
                h += '</tbody></table></div>';
            }
            container.innerHTML = h;
        } catch(e) {
            container.innerHTML = '<h3>用户访问明细</h3><div class="empty">用户访问数据加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    };

    renderStatsTab = async function(el) {
        var skeletonHtml = '<div class="card"><div class="date-filter-row"><div class="skeleton-pulse" style="height:36px;width:100%;background:rgba(255,255,255,0.05);border-radius:12px;"></div></div></div>';
        skeletonHtml += '<div class="stats-row">';
        ['用户数量', '帖子数量', '评论数量', '点赞数量', '照片数量', '访问总次数', '被攻击次数', 'API防火墙拦截'].forEach(function(l) {
            skeletonHtml += '<div class="stat-box skeleton-pulse"><div class="val" style="height:28px;width:60%;background:rgba(255,255,255,0.08);border-radius:6px;">&nbsp;</div><div class="lbl">' + l + '</div></div>';
        });
        skeletonHtml += '</div>';
        skeletonHtml += '<div class="card"><h3>用户访问明细</h3><div class="skeleton-pulse" style="height:100px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>每日数据明细</h3><div class="skeleton-pulse" style="height:120px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>每日数据趋势</h3><div class="skeleton-pulse" style="height:120px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>攻击类型分布</h3><div class="skeleton-pulse" style="height:80px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>被攻击详情</h3><div class="skeleton-pulse" style="height:80px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        skeletonHtml += '<div class="card"><h3>API防火墙拦截详情</h3><div class="skeleton-pulse" style="height:80px;background:rgba(255,255,255,0.05);border-radius:12px;margin:12px 0;"></div></div>';
        el.innerHTML = skeletonHtml;
        try {
            var summary, dailyData;
            if (API_BASE) {
                var dailyQuery = '/admin/stats/daily';
                var summaryQuery = '/admin/stats';
                if (window.statsDateStart) dailyQuery += '?start=' + window.statsDateStart;
                if (window.statsDateEnd) dailyQuery += (window.statsDateStart ? '&' : '?') + 'end=' + window.statsDateEnd;
                if (window.statsDateStart || window.statsDateEnd) {
                    summaryQuery += '?';
                    if (window.statsDateStart) summaryQuery += 'start=' + window.statsDateStart;
                    if (window.statsDateEnd) summaryQuery += (window.statsDateStart ? '&' : '') + 'end=' + window.statsDateEnd;
                }
                summary = await apiCall('GET', summaryQuery);
                dailyData = await apiCall('GET', dailyQuery);
            }
            if (!summary) {
                el.innerHTML = '<div class="empty-state"><div class="icon">📳</div><div class="text">统计数据加载失败：无法连接后端 API</div></div>';
                return;
            }
            var daily = (dailyData && dailyData.daily) || [];
            var h = '<div class="card"><div class="date-filter-row">';
            h += '<span style="font-weight:600;font-size:14px;">日期筛选：</span>';
            h += '<input type="date" id="statsDateStart" value="' + escapeHtml(window.statsDateStart) + '" onchange="window.statsDateStart=this.value;renderTab(\'stats\')" title="开始日期">';
            h += '<span style="color:var(--text-muted);">至</span>';
            h += '<input type="date" id="statsDateEnd" value="' + escapeHtml(window.statsDateEnd) + '" onchange="window.statsDateEnd=this.value;renderTab(\'stats\')" title="结束日期">';
            if (window.statsDateStart || window.statsDateEnd) h += '<button onclick="window.statsDateStart=\'\';window.statsDateEnd=\'\';renderTab(\'stats\')">清除筛选</button>';
            if (API_BASE) h += '<button class="btn-sm primary" style="margin-left:auto;" onclick="apiCall(\'POST\',\'/admin/stats/refresh\').then(function(){renderTab(\'stats\');}).catch(function(){})">刷新缓存</button>';
            h += '</div></div>';
            h += '<div class="stats-row">';
            h += '<div class="stat-box"><div class="val">' + (summary.total_users || 0) + '</div><div class="lbl">用户数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_posts || 0) + '</div><div class="lbl">帖子数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_comments || 0) + '</div><div class="lbl">评论数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_likes || 0) + '</div><div class="lbl">点赞数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_photos || 0) + '</div><div class="lbl">照片数量</div></div>';
            h += '<div class="stat-box"><div class="val">' + (summary.total_visits || 0) + '</div><div class="lbl">访问总次数</div></div>';
            h += '<div class="stat-box danger"><div class="val">' + (summary.total_attacks || 0) + '</div><div class="lbl">被攻击次数</div></div>';
            h += '<div class="stat-box warn"><div class="val">' + (summary.firewall_intercepts || 0) + '</div><div class="lbl">API防火墙拦截</div></div>';
            h += '</div>';
            h += '<div id="userVisitStatsContainer"></div>';
            if (daily.length > 0) {
                h += '<div class="card"><h3>每日数据明细 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + daily.length + ' 天</span></h3>';
                h += '<div class="table-wrap"><table><thead><tr><th>日期</th><th>访问</th><th>攻击</th><th>帖子</th><th>评论</th><th>点赞</th><th>新用户</th></tr></thead><tbody>';
                daily.slice().reverse().forEach(function(d) {
                    var total = (d.visits || 0) + (d.attacks || 0) + (d.posts || 0) + (d.comments || 0) + (d.likes || 0) + (d.new_users || 0);
                    if (total === 0) return;
                    h += '<tr><td><strong>' + escapeHtml(d.date) + '</strong></td>';
                    h += '<td' + (d.visits ? '' : ' class="zero-val"') + '>' + (d.visits || '') + '</td>';
                    h += '<td' + (d.attacks ? '' : ' class="zero-val"') + ' style="color:' + (d.attacks > 0 ? 'var(--danger)' : 'var(--text-muted)') + ';">' + (d.attacks || '') + '</td>';
                    h += '<td' + (d.posts ? '' : ' class="zero-val"') + '>' + (d.posts || '') + '</td>';
                    h += '<td' + (d.comments ? '' : ' class="zero-val"') + '>' + (d.comments || '') + '</td>';
                    h += '<td' + (d.likes ? '' : ' class="zero-val"') + '>' + (d.likes || '') + '</td>';
                    h += '<td' + (d.new_users ? '' : ' class="zero-val"') + '>' + (d.new_users || '') + '</td></tr><tr class="divider-row"><td colspan="7"></td></tr>';
                });
                h += '</tbody></table></div></div>';
            }
            var modes = [
                { key: 'visits', label: '访问量', color: '#059669' },
                { key: 'attacks', label: '攻击量', color: '#ff3b60' },
                { key: 'posts', label: '发帖量', color: '#3b82f6' },
                { key: 'comments', label: '评论量', color: '#f59e0b' },
                { key: 'likes', label: '点赞量', color: '#ec4899' },
                { key: 'new_users', label: '新用户', color: '#8b5cf6' }
            ];
            h += '<div class="card"><h3>每日数据趋势</h3><div class="filter-chips" style="margin-bottom:12px;">';
            modes.forEach(function(m) {
                h += '<span class="filter-chip' + (window.statsChartMode === m.key ? ' active' : '') + '" onclick="window.statsChartMode=\'' + m.key + '\';renderTab(\'stats\')" style="cursor:pointer;">' + m.label + '</span>';
            });
            h += '</div>';
            if (daily.length === 0) {
                h += '<div class="empty" style="padding:24px;text-align:center;color:var(--text-muted);">暂无每日数据，刷新页面后开始记录访问</div>';
            } else {
                var maxVal = 1;
                daily.forEach(function(d) { maxVal = Math.max(maxVal, d[window.statsChartMode] || 0); });
                var activeMode = modes.find(function(m) { return m.key === window.statsChartMode; }) || modes[0];
                var chartData = daily.length > 30 ? daily.slice(-30) : daily;
                h += '<div class="chart-legend"><span><span class="dot" style="background:' + activeMode.color + ';"></span>' + activeMode.label + '</span><span style="color:var(--text-muted);font-size:11px;">最高 ' + maxVal + '</span><span style="color:var(--text-muted);font-size:11px;">共 ' + daily.length + ' 天</span></div>';
                h += '<div class="chart-bar-row">';
                chartData.forEach(function(d) {
                    var v = d[window.statsChartMode] || 0;
                    var heightPct = Math.max(4, Math.round((v / maxVal) * 100));
                    h += '<div class="chart-bar" style="height:' + heightPct + '%;background:' + activeMode.color + ';" title="' + escapeHtml(d.date) + ': ' + v + '"><span class="bar-tip">' + v + '</span></div>';
                });
                h += '</div><div class="chart-bar-labels">';
                var labelStep = chartData.length > 18 ? 2 : 1;
                chartData.forEach(function(d, index) {
                    var shortDate = d.date ? d.date.slice(5) : '';
                    h += '<div class="chart-bar-label">' + ((index % labelStep === 0 || index === chartData.length - 1) ? escapeHtml(shortDate) : '') + '</div>';
                });
                h += '</div>';
            }
            h += '</div>';
            if (summary.attack_types && Object.keys(summary.attack_types).length > 0) {
                h += '<div class="card"><h3>攻击类型分布</h3><div style="display:flex;flex-direction:column;gap:8px;">';
                var attackEntries = Object.entries(summary.attack_types).sort(function(a, b) { return b[1] - a[1]; });
                var attackMax = attackEntries[0] ? attackEntries[0][1] : 1;
                attackEntries.forEach(function(entry) {
                    var pct = Math.round((entry[1] / attackMax) * 100);
                    h += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;"><span style="width:120px;text-align:right;color:var(--text-muted);">' + escapeHtml(entry[0]) + '</span><div style="flex:1;height:18px;background:rgba(255,59,96,0.1);border-radius:9px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg, #ff3b60, #fb7185);border-radius:9px;transition:width 0.5s ease;"></div></div><span style="width:40px;font-weight:600;">' + entry[1] + '</span></div>';
                });
                h += '</div></div>';
            }
            h += '<div id="attackDetailsContainer"></div><div id="firewallDetailsContainer"></div>';
            if (summary.cached_at) h += '<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:8px;">数据缓存时间: ' + formatTime(summary.cached_at) + '（每60秒刷新）</div>';
            el.innerHTML = h;
            loadUserVisitStats(el);
            loadAttackDetails(el);
            loadFirewallDetails(el);
        } catch(e) {
            el.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div class="text">统计数据加载失败: ' + escapeHtml(e.message) + '</div></div>';
        }
    };

    function getAdminReportDisplayReason(report) {
        var reason = String(report && report.report_reason || '').trim();
        var category = String(report && report.report_category || '').trim();
        if (reason) return reason;
        if (category) return category;
        return '-';
    }

    renderReportsTab = async function(el) {
        var pending = reportsData.filter(function(r) { return r.status === 'pending'; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + reportsData.length + '</div><div class="lbl">总举报数</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + pending + '</div><div class="lbl">待处理</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--primary)">' + reportsData.filter(function(r) { return r.status === 'actioned'; }).length + '</div><div class="lbl">已处理</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>举报管理</h3>';
        if (!reportsData.length) {
            h += '<div class="empty">暂无举报</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>举报人</th><th>类型</th><th>被举报人</th><th>原因</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            reportsData.forEach(function(r) {
                var statusBadge = r.status === 'pending' ? '<span class="badge badge-red">待处理</span>' :
                    r.status === 'reviewed' ? '<span class="badge badge-green">已审核</span>' :
                    r.status === 'dismissed' ? '<span class="badge" style="background:rgba(128,128,128,0.15);color:var(--text-muted)">已驳回</span>' :
                    '<span class="badge badge-green">已处理</span>';
                var typeLabel = r.target_type === 'photo' ? '照片墙' : '帖子';
                h += '<tr><td>' + escapeHtml(r.reporter_name || '-') + '</td>';
                h += '<td>' + escapeHtml(typeLabel) + '</td>';
                h += '<td><strong>' + escapeHtml(r.target_user || '-') + '</strong></td>';
                h += '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(getAdminReportDisplayReason(r)) + '</td>';
                h += '<td>' + formatTime(r.created_at) + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (r.status === 'pending') {
                    h += '<button class="btn-sm primary" onclick="handleReportDetail(\'' + r.id + '\')">处理</button> ';
                    h += '<button class="btn-sm" onclick="dismissReport(\'' + r.id + '\')">驳回</button>';
                } else {
                    h += '<button class="btn-sm" onclick="handleReportDetail(\'' + r.id + '\')">详情</button>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    window.handleReportDetail = function(id) {
        var r = reportsData.find(function(x) { return x.id === id; });
        if (!r) return;
        var modal = document.createElement('div');
        modal.className = 'report-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

        var box = document.createElement('div');
        box.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:16px;padding:24px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.onclick = function(e) { e.stopPropagation(); };

        var typeLabel = r.target_type === 'photo' ? '照片墙' : '帖子';
        var statusLabel = r.status === 'pending' ? '待处理' : r.status === 'actioned' ? '已处理' : r.status === 'dismissed' ? '已驳回' : r.status;

        var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;"><h3 style="margin:0;">举报详情</h3><button onclick="this.closest(\'.report-detail-modal\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted);padding:4px;line-height:1;">×</button></div>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:16px;">';
        html += '<div><strong>举报人：</strong>' + escapeHtml(r.reporter_name || '-') + '</div>';
        html += '<div><strong>被举报人：</strong>' + escapeHtml(r.target_user || '-') + '</div>';
        html += '<div><strong>类型：</strong>' + escapeHtml(typeLabel) + '</div>';
        html += '<div><strong>状态：</strong>' + escapeHtml(statusLabel) + '</div>';
        html += '<div><strong>时间：</strong>' + formatTime(r.created_at) + '</div>';
        html += '</div>';
        html += '<div style="margin-bottom:12px;"><strong>目标ID：</strong><code>' + escapeHtml(r.target_id || '-') + '</code></div>';
        html += '<div style="margin-bottom:12px;padding:10px;background:rgba(0,0,0,0.05);border-radius:8px;"><strong>举报原因：</strong>' + escapeHtml(getAdminReportDisplayReason(r)) + '</div>';
        if (r.admin_response) {
            html += '<div style="margin-bottom:12px;padding:10px;background:rgba(5,150,105,0.08);border-radius:8px;"><strong>管理员回复：</strong>' + escapeHtml(r.admin_response) + '</div>';
        }
        if (r.reviewed_by) {
            html += '<div style="margin-bottom:12px;font-size:12px;color:var(--text-muted);">处理人：' + escapeHtml(r.reviewed_by) + ' · 处理时间：' + formatTime(r.reviewed_at) + '</div>';
        }
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        if (r.status === 'pending') {
            html += '<button class="btn-sm primary" onclick="doDeleteReportPost(\'' + r.id + '\')">删除内容</button>';
            html += '<button class="btn-sm" style="background:rgba(255,59,96,0.1);color:#ff3b60;border:1px solid rgba(255,59,96,0.3);" onclick="doBanReportUser(\'' + r.id + '\')">封禁用户</button>';
            html += '<button class="btn-sm" onclick="doMarkReportActioned(\'' + r.id + '\')">标记已处理</button>';
        }
        html += '<button class="btn-sm" style="margin-left:auto;" onclick="this.closest(\'.report-detail-modal\').remove()">关闭</button>';
        html += '</div>';
        if (r.status === 'pending') {
            html += '<div style="border-top:1px solid rgba(0,0,0,0.1);padding-top:12px;margin-top:8px;">';
            html += '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">回复举报人（选填）</label>';
            html += '<textarea id="reportResponse_' + r.id + '" rows="2" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.2);font-size:13px;resize:vertical;font-family:inherit;" placeholder="输入回复内容..."></textarea>';
            html += '<button class="btn-sm primary" style="margin-top:8px;" onclick="doRespondReport(\'' + r.id + '\')">回复并处理</button>';
            html += '</div>';
        }
        box.innerHTML = html;
        modal.appendChild(box);
        document.body.appendChild(modal);
    };

    // 登录记录设备型号文案（不显示“需重新登录后记录”）
    function getLoginRecordModelText(info) {
        info = info || {};
        if (info.exact_device_model) return info.exact_device_model;
        var savedModel = info.possible_device_model || (info.device_meta && info.device_meta.possible_device_model);
        if (savedModel) return savedModel;

        var deviceType = String(info.device_type || '').toLowerCase();
        var ua = String(info.user_agent || '');
        var meta = info.device_meta || {};
        var platform = String(meta.platform || info.platform || '');

        var isIPhone = deviceType.indexOf('iphone') >= 0 || /iPhone/i.test(ua);
        if (isIPhone) {
            var modelGuess = getPossibleDeviceModel(info);
            if (modelGuess && modelGuess.indexOf('未匹配') !== 0) return modelGuess;
            if (modelGuess) return modelGuess;
            var sw = Number(meta.screen_width || info.screen_width) || 0;
            var sh = Number(meta.screen_height || info.screen_height) || 0;
            var dpr = Number(meta.device_pixel_ratio || info.device_pixel_ratio || meta.dpr || info.dpr) || 0;
            if (sw && sh) {
                return 'iPhone（未匹配尺寸：' + Math.min(sw, sh) + 'x' + Math.max(sw, sh) + '@' + dpr + '）';
            }
            return 'iPhone（Safari 不提供具体型号）';
        }

        var isDesktop = deviceType.indexOf('desktop') >= 0 || /Windows|Macintosh|Linux/i.test(ua) || /Win|Mac|Linux/i.test(platform);
        if (isDesktop) return '-';

        return '-';
    }

    // 格式化地区显示：China · Guangdong · Guangzhou → 广东广州
    function adminFormatLocation(location) {
        if (!location) return '';
        var text = location.text || location;
        if (typeof text !== 'string') return '';
        var parts = text.split(' · ');
        var provinceMap = {
            'Guangdong': '广东', 'Zhejiang': '浙江', 'Shanghai': '上海', 'Beijing': '北京',
            'Jiangsu': '江苏', 'Fujian': '福建', 'Sichuan': '四川', 'Chongqing': '重庆',
            'Hunan': '湖南', 'Hubei': '湖北', 'Henan': '河南', 'Hebei': '河北',
            'Shandong': '山东', 'Shanxi': '山西', 'Shaanxi': '陕西', 'Anhui': '安徽',
            'Jiangxi': '江西', 'Guangxi': '广西', 'Guizhou': '贵州', 'Yunnan': '云南',
            'Hainan': '海南', 'Liaoning': '辽宁', 'Jilin': '吉林', 'Heilongjiang': '黑龙江',
            'Inner Mongolia': '内蒙古', 'Xinjiang': '新疆', 'Tibet': '西藏',
            'Ningxia': '宁夏', 'Qinghai': '青海', 'Gansu': '甘肃', 'Tianjin': '天津',
            'Macau': '澳门', 'Macao': '澳门', 'Hong Kong': '香港', 'Taiwan': '台湾'
        };
        var cityMap = {
            'Guangzhou': '广州', 'Shenzhen': '深圳', 'Hangzhou': '杭州', 'Ningbo': '宁波',
            'Suzhou': '苏州', 'Nanjing': '南京', 'Wuxi': '无锡', 'Xiamen': '厦门',
            'Fuzhou': '福州', 'Chengdu': '成都', 'Wuhan': '武汉', 'Changsha': '长沙',
            'Zhengzhou': '郑州', 'Jinan': '济南', 'Qingdao': '青岛', 'Hefei': '合肥',
            'Dongguan': '东莞', 'Foshan': '佛山', 'Zhuhai': '珠海', 'Shanghai': '上海',
            'Beijing': '北京', 'Chongqing': '重庆', 'Tianjin': '天津'
        };
        var countryMap = {
            'Japan': '日本', 'South Korea': '韩国', 'Singapore': '新加坡',
            'United States': '美国', 'Thailand': '泰国', 'Malaysia': '马来西亚',
            'United Kingdom': '英国', 'Canada': '加拿大', 'Australia': '澳大利亚',
            'Germany': '德国', 'France': '法国', 'Italy': '意大利', 'Spain': '西班牙',
            'Russia': '俄罗斯', 'Brazil': '巴西', 'India': '印度', 'Vietnam': '越南',
            'Philippines': '菲律宾', 'Indonesia': '印度尼西亚'
        };
        var isChina = false;
        var pp = parts.map(function(p) {
            var trimmed = p.trim();
            var lower = trimmed.toLowerCase();
            if (lower === 'china' || lower === "people's republic of china" || lower === 'cn') {
                isChina = true;
                return '';
            }
            return trimmed;
        }).filter(Boolean);
        if (isChina && pp.length) {
            var provinceName = provinceMap[pp[0]] || pp[0];
            var cityName = pp.length > 1 ? (cityMap[pp[1]] || pp[1]) : '';
            if (provinceName === cityName || (pp.length === 1 && (pp[0] === 'Shanghai' || pp[0] === 'Beijing' || pp[0] === 'Chongqing' || pp[0] === 'Tianjin'))) {
                return provinceName;
            }
            return provinceName + (cityName || '');
        }
        if (parts.length === 1) {
            return countryMap[parts[0].trim()] || parts[0].trim();
        }
        return parts.map(function(p) {
            var trimmed = p.trim();
            return countryMap[trimmed] || cityMap[trimmed] || provinceMap[trimmed] || trimmed;
        }).join('');
    }

    // 登录设备详情展示
    window.showUserLoginDetail = function(userName) {
        // 从 allLoginEvents 筛选该用户的全部登录记录
        var userEvents = allLoginEvents.filter(function(ev) {
            return ev.user_name === userName;
        }).map(function(ev) {
            var info = {};
            try { info = JSON.parse(ev.content || '{}'); } catch(e) {}
            return { raw: ev, info: info };
        }).sort(function(a, b) {
            return toAdminTimeMs((b.info && b.info.login_at) || (b.raw && b.raw.created_at))
                 - toAdminTimeMs((a.info && a.info.login_at) || (a.raw && a.raw.created_at));
        });

        if (!userEvents.length) {
            showToast('暂无登录记录');
            return;
        }

        // 获取最新指纹信息
        var latestFpEvent = null;
        for (var i = 0; i < userEvents.length; i++) {
            if (userEvents[i].info.browser_fingerprint_hash || userEvents[i].info.canvas_fingerprint_hash) {
                latestFpEvent = userEvents[i];
                break;
            }
        }
        var bfHash = latestFpEvent ? (latestFpEvent.info.browser_fingerprint_hash || null) : null;
        var cfHash = latestFpEvent ? (latestFpEvent.info.canvas_fingerprint_hash || null) : null;

        // 查找关联账号（同一 IP 或同一 device_id）
        var userIps = {};
        var userDevices = {};
        userEvents.forEach(function(ev) {
            if (ev.info.ip) userIps[ev.info.ip] = true;
            if (ev.info.device_id) userDevices[ev.info.device_id] = true;
        });

        var relatedAccounts = {};
        allLoginEvents.forEach(function(ev) {
            if (ev.user_name === userName) return;
            var info = {};
            try { info = JSON.parse(ev.content || '{}'); } catch(e) {}
            if (info.ip && userIps[info.ip]) relatedAccounts[ev.user_name] = (relatedAccounts[ev.user_name] || 0) + 1;
            if (info.device_id && userDevices[info.device_id]) relatedAccounts[ev.user_name] = (relatedAccounts[ev.user_name] || 0) + 1;
        });
        var relatedList = Object.keys(relatedAccounts).sort(function(a, b) { return relatedAccounts[b] - relatedAccounts[a]; }).slice(0, 10);

        // 查找该用户的安全提醒
        var userAlerts = allSecurityAlerts.filter(function(a) {
            return a.user_name === userName || (a.related_users && a.related_users.indexOf(userName) >= 0);
        }).slice(0, 5);

        var sourceLabels = {
            'login_success': '登录成功',
            'page_visit': '页面访问',
            'register_success': '注册成功',
            'admin_login': '管理员登录'
        };

        var html = '<div class="card" style="max-width:820px;margin:0 auto;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><h3 style="margin:0;">设备详情：' + escapeHtml(userName) + '</h3><button onclick="this.closest(\'.report-detail-modal\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted);padding:4px;line-height:1;">×</button></div>';

        // 设备指纹信息
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:14px;padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;">';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">浏览器指纹</span><br><span style="font-size:12px;font-family:monospace;">' + (bfHash ? escapeHtml(bfHash.slice(0, 16)) + '...' : '-') + '</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">Canvas 指纹</span><br><span style="font-size:12px;font-family:monospace;">' + (cfHash ? escapeHtml(cfHash.slice(0, 16)) + '...' : '-') + '</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">登录记录</span><br><span style="font-size:12px;font-weight:600;">' + userEvents.length + ' 条</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">关联账号</span><br><span style="font-size:12px;font-weight:600;">' + relatedList.length + ' 个</span></div>';
        html += '</div>';

        // 关联账号
        if (relatedList.length > 0) {
            html += '<div style="margin-bottom:12px;"><span style="font-size:12px;font-weight:600;color:var(--text-muted);">关联账号：</span>';
            relatedList.forEach(function(r) {
                html += '<span style="display:inline-block;margin:2px 4px;padding:2px 8px;background:rgba(5,150,105,0.08);border-radius:99px;font-size:11px;">' + escapeHtml(r) + '</span>';
            });
            html += '</div>';
        }

        // 安全提醒
        if (userAlerts.length > 0) {
            html += '<div style="margin-bottom:14px;"><span style="font-size:12px;font-weight:600;color:var(--danger);">最近安全提醒：</span>';
            html += '<div style="margin-top:4px;">';
            userAlerts.forEach(function(a) {
                var alertTypeLabels = { 'same_ip_multi_users': '同IP多账号', 'same_device_multi_users': '同设备多账号', 'multi_ip_same_user': '多IP同账号', 'geo_change': '地区变化', 'high_frequency_visit': '高频访问', 'same_browser_fp_multi_users': '同浏览器指纹多账号', 'same_canvas_fp_multi_users': '同Canvas指纹多账号' };
                html += '<div style="font-size:11px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.04);"><span style="color:var(--danger);">' + (alertTypeLabels[a.type] || a.type) + '</span> ' + escapeHtml(a.reason) + ' <span style="color:var(--text-muted);">' + escapeHtml(formatTime(a.created_at)) + '</span></div>';
            });
            html += '</div></div>';
        }

        // 登录记录表格（带指纹列）
        html += '<h4 style="margin-bottom:8px;">登录记录（共 ' + userEvents.length + ' 条）</h4>' +
            '<div>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid rgba(0,0,0,0.1);">' +
            '<th style="padding:6px 8px;text-align:left;">登录时间</th>' +
            '<th style="padding:6px 8px;text-align:left;">来源</th>' +
            '<th style="padding:6px 8px;text-align:left;">设备类型</th>' +
            '<th style="padding:6px 8px;text-align:left;">疑似型号</th>' +
            '<th style="padding:6px 8px;text-align:left;">系统</th>' +
            '<th style="padding:6px 8px;text-align:left;">浏览器</th>' +
            '<th style="padding:6px 8px;text-align:left;">IP</th>' +
            '<th style="padding:6px 8px;text-align:left;">地区</th>' +
            '<th style="padding:6px 8px;text-align:left;">ASN/ISP</th>' +
            '<th style="padding:6px 8px;text-align:left;">指纹Hash</th>' +
            '</tr></thead><tbody>';

        userEvents.forEach(function(ev) {
            var loginTime = ev.info.login_at || (ev.raw && ev.raw.created_at) || '';
            var srcLabel = sourceLabels[ev.info.source] || '登录记录';
            var evLoc = ev.info.ip_location;
            if (!evLoc && userInfo) {
                evLoc = userInfo.last_ip_location || userInfo.last_location || null;
            }
            var locText = evLoc ? escapeHtml(adminFormatLocation(evLoc)) : '暂未解析';
            var fullIp = ev.info.ip || '-';
            var possibleModel = getLoginRecordModelText(ev.info);
            var asnIsp = '-';
            if (ev.info.asn_info && ev.info.asn_info.isp) {
                asnIsp = escapeHtml(ev.info.asn_info.isp.slice(0, 20));
                if (ev.info.asn_info.is_proxy) asnIsp += ' <span style="color:var(--warning);">[代理]</span>';
                if (ev.info.asn_info.is_hosting) asnIsp += ' <span style="color:var(--danger);">[机房]</span>';
                if (ev.info.asn_info.is_mobile) asnIsp += ' [移动]';
            }
            var fpShort = '-';
            if (ev.info.webgl_fingerprint_hash) fpShort = 'W:' + escapeHtml(ev.info.webgl_fingerprint_hash.slice(0, 10)) + '...';
            else if (ev.info.browser_fingerprint_hash) fpShort = 'B:' + escapeHtml(ev.info.browser_fingerprint_hash.slice(0, 10)) + '...';
            else if (ev.info.canvas_fingerprint_hash) fpShort = 'C:' + escapeHtml(ev.info.canvas_fingerprint_hash.slice(0, 10)) + '...';
            html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">' +
                '<td style="padding:6px 8px;">' + (loginTime ? escapeHtml(formatTime(loginTime)) : '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(srcLabel) + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(ev.info.device_type || '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(possibleModel) + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(ev.info.os || '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(ev.info.browser || '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(fullIp) + '</td>' +
                '<td style="padding:6px 8px;">' + locText + '</td>' +
                '<td style="padding:6px 8px;font-size:11px;">' + asnIsp + '</td>' +
                '<td style="padding:6px 8px;font-size:11px;font-family:monospace;">' + fpShort + '</td>' +
                '</tr>';
        });

        html += '</tbody></table></div></div>';

        // 创建模态框展示
        var modal = document.createElement('div');
        modal.className = 'report-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

        var box = document.createElement('div');
        box.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:16px;padding:24px;max-width:860px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
        box.onclick = function(e) { e.stopPropagation(); };
        box.innerHTML = html;
        modal.appendChild(box);
        document.body.appendChild(modal);
    };

    var auditTypeFilter = 'all';
    renderAuditTab = function(el) {
        var h = '<div class="card"><h3>📋 操作审计日志</h3>';
        if (!allAuditLogs.length) {
            h += '<div class="empty">暂无审计记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>详情</th></tr></thead><tbody>';
            var actionLabels = {
                'delete_post': '删除帖子',
                'delete_photo': '删除照片',
                'ban_user': '封禁用户',
                'unban_user': '解除封禁',
                'mute_user': '禁言用户',
                'unmute_user': '解除禁言',
                'cleanup_logs': '清理日志',
                'update_security_settings': '修改安全设置',
                'review_security_alert': '审查安全提醒',
                'delete_user': '删除用户账号'
            };
            allAuditLogs.forEach(function(log) {
                h += '<tr><td>' + escapeHtml(formatTime(log.created_at)) + '</td><td>' + escapeHtml(actionLabels[log.action] || log.action) + '</td><td>' + escapeHtml(log.operator) + '</td><td style="max-width:300px;white-space:normal;word-break:break-word;">' + escapeHtml(log.detail || '-') + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    // ===================== 用户行为 Tab =====================
    var behaviorTypeLabels = {
        'control_click': '点击控件',
        'visibility': '页面可见性',
        'page_view': '页面浏览',
        'scroll': '页面滚动',
        'input_focus': '输入框聚焦',
        'input_blur': '输入框失焦',
        'toggle': '开关切换',
        'navigation': '页面跳转'
    };
    var behaviorVisibilityLabels = {
        'visible': '页面可见（前台）',
        'hidden': '页面隐藏（后台）',
        'prerender': '预渲染中'
    };
    var behaviorTargetLabels = {
        'button': '按钮',
        'a': '链接',
        'input': '输入框',
        'textarea': '文本域',
        'select': '下拉框'
    };

    function formatBehaviorType(type) {
        if (behaviorTypeLabels[type]) return behaviorTypeLabels[type];
        if (type && type.startsWith('visibility_')) return '可见性: ' + (behaviorVisibilityLabels[type.replace('visibility_','')] || type.replace('visibility_',''));
        return type || '-';
    }

    function formatBehaviorTarget(type, target) {
        if (!target) return '-';
        if (type === 'visibility') {
            return behaviorVisibilityLabels[target] || target;
        }
        if (type === 'page_view') {
            if (target === '/') return '首页';
            if (target === '/admin.html') return '管理后台';
            return '路径: ' + target;
        }
        if (behaviorTargetLabels[target]) return behaviorTargetLabels[target];
        var idLabels = {
            'loginSubmitBtn': '登录按钮', 'registerSubmitBtn': '注册按钮',
            'postSubmitBtn': '发帖按钮', 'postTextarea': '发帖输入框',
            'themeToggle': '主题切换', 'searchInput': '搜索框',
            'navHome': '导航-首页', 'navExplore': '导航-探索',
            'postSearchInput': '帖子搜索', 'postUserFilter': '用户筛选',
            'dmToggle': '私信开关', 'dmPanel': '私信面板',
            'profileSettingsBtn': '设置按钮', 'logoutBtn': '退出登录',
            'adminLoginBtn': '管理登录', 'closeModal': '关闭弹窗',
            'likeBtn': '点赞按钮', 'commentBtn': '评论按钮',
            'shareBtn': '分享按钮', 'deleteBtn': '删除按钮',
            'reportBtn': '举报按钮', 'editBtn': '编辑按钮',
            'refreshBtn': '刷新按钮', 'loadMoreBtn': '加载更多',
            'navToggle': '导航切换', 'sidebarToggle': '侧栏切换',
            'notificationBtn': '通知按钮', 'photoUploadBtn': '上传照片',
            'avatarUploadBtn': '上传头像', 'filterBtn': '筛选按钮',
            'sortBtn': '排序按钮', 'exportBtn': '导出按钮',
            'importBtn': '导入按钮', 'saveBtn': '保存按钮',
            'cancelBtn': '取消按钮', 'confirmBtn': '确认按钮',
            'retryBtn': '重试按钮', 'dismissBtn': '关闭按钮',
            'annDismiss': '公告关闭', 'annReadBtn': '公告已读',
            'aiChatToggle': 'AI聊天切换', 'aiChatSend': 'AI发送',
            'banBtn': '封禁按钮', 'muteBtn': '禁言按钮',
            'unbanBtn': '解封按钮', 'unmuteBtn': '解除禁言',
            'deletePostBtn': '删除帖子', 'deletePhotoBtn': '删除照片',
            'deleteUserBtn': '删除用户', 'deleteCommentBtn': '删除评论',
            'ipDetailBtn': 'IP详情', 'reResolveBtn': '重新解析',
            'locationDetailBtn': '位置详情', 'clipboardBtn': '剪贴板查看',
            'behaviorBtn': '行为查看', 'securityBtn': '安全查看',
            'userDetailBtn': '用户详情', 'userEditBtn': '编辑用户',
            'postDetailBtn': '帖子详情', 'photoDetailBtn': '照片详情',
            'dmSendBtn': '发送私信', 'dmCloseBtn': '关闭私信',
            'pageTopBtn': '回到顶部', 'pageBottomBtn': '滚动到底部',
            'prevPageBtn': '上一页', 'nextPageBtn': '下一页',
            'tabAnnBtn': '公告管理Tab', 'tabStatsBtn': '数据统计Tab',
            'tabUsersBtn': '用户数据Tab', 'tabClipboardBtn': '用户剪贴板Tab',
            'tabSecurityBtn': '安全中心Tab', 'tabAuditBtn': '操作审计Tab',
            'tabBehaviorBtn': '用户行为Tab', 'tabErrorLogBtn': '错误日志Tab',
            'tabPostsBtn': '帖子管理Tab', 'tabLikesBtn': '点赞数据Tab',
            'tabCommentsBtn': '评论数据Tab', 'tabReportsBtn': '举报管理Tab',
            'tabBansBtn': '拉黑封禁Tab', 'tabMutesBtn': '禁言管理Tab',
            'tabPhotosBtn': '照片管理Tab', 'tabEmailBtn': '邮件通知Tab',
            'tabAiBtn': 'AI管理Tab', 'tabBlacklistBtn': '黑名单Tab'
        };
        if (idLabels[target]) return idLabels[target];
        return target;
    }

    renderBehaviorTab = function(el) {
        var allBehaviorItems = [];
        allBehaviorEvents.forEach(function(row) {
            try {
                var parsedBehavior = JSON.parse(row.content || '{}');
                (parsedBehavior.events || []).forEach(function(event) {
                    allBehaviorItems.push({
                        user_name: row.user_name,
                        type: event.type,
                        target: event.target,
                        at: event.at
                    });
                });
            } catch (e) {}
        });
        allBehaviorItems.sort(function(a, b) { return toAdminTimeMs(b.at) - toAdminTimeMs(a.at); });

        var h = '<div class="card"><h3>用户行为追踪</h3>';
        h += '<p style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">记录所有用户的点击、浏览、页面切换等操作行为，共 ' + allBehaviorItems.length + ' 条记录</p>';

        if (!allBehaviorItems.length) {
            h += '<div class="empty">暂无用户行为记录</div>';
        } else {
            var uniqueUsers = [];
            var seenUsers = {};
            allBehaviorItems.forEach(function(item) {
                if (!seenUsers[item.user_name]) {
                    seenUsers[item.user_name] = true;
                    uniqueUsers.push(item.user_name);
                }
            });
            uniqueUsers.sort();

            h += '<div class="filter-chips" style="margin-bottom:10px;">';
            h += '<span class="filter-chip active" id="behaviorFilterAll" onclick="window.setBehaviorFilter(\'all\')">全部用户</span>';
            uniqueUsers.slice(0, 20).forEach(function(u) {
                h += '<span class="filter-chip" id="behaviorFilter_' + escapeHtml(u) + '" onclick="window.setBehaviorFilter(\'' + safeJsStr(u) + '\')">' + escapeHtml(u) + '</span>';
            });
            if (uniqueUsers.length > 20) {
                h += '<span class="filter-chip" style="opacity:0.5">+ ' + (uniqueUsers.length - 20) + ' 更多...</span>';
            }
            h += '</div>';

            var filteredItems = behaviorFilterUser === 'all' ? allBehaviorItems : allBehaviorItems.filter(function(item) { return item.user_name === behaviorFilterUser; });

            h += '<div class="table-wrap"><table><thead><tr><th style="width:140px;">时间</th><th style="width:100px;">用户</th><th style="width:100px;">行为类型</th><th>目标/详情</th></tr></thead><tbody>';
            filteredItems.slice(0, 200).forEach(function(item) {
                var typeLabel = formatBehaviorType(item.type);
                var targetLabel = formatBehaviorTarget(item.type, item.target);
                var typeColor = item.type === 'control_click' ? 'var(--accent)' : (item.type === 'page_view' ? 'var(--success)' : (item.type === 'visibility' ? 'var(--text-muted)' : 'var(--text-muted)'));
                h += '<tr>';
                h += '<td style="font-size:10px;">' + escapeHtml(formatTime(item.at || '')) + '</td>';
                h += '<td><b>' + escapeHtml(item.user_name) + '</b></td>';
                h += '<td><span style="color:' + typeColor + ';">' + escapeHtml(typeLabel) + '</span></td>';
                h += '<td style="max-width:300px;white-space:normal;word-break:break-word;">' + escapeHtml(targetLabel) + '</td>';
                h += '</tr>';
            });
            h += '</tbody></table></div>';
            if (filteredItems.length > 200) {
                h += '<p style="font-size:11px;color:var(--text-muted);margin-top:8px;">仅显示最近 200 条记录（共 ' + filteredItems.length + ' 条）</p>';
            }
        }
        h += '</div>';
        el.innerHTML = h;
    };

    window.setBehaviorFilter = function(user) {
        behaviorFilterUser = user;
        var allChips = document.querySelectorAll('#tabBehavior .filter-chip');
        allChips.forEach(function(chip) { chip.classList.remove('active'); });
        var activeChip = user === 'all' ? document.getElementById('behaviorFilterAll') : document.getElementById('behaviorFilter_' + user);
        if (activeChip) activeChip.classList.add('active');
        renderTab('behavior');
    };

    var behaviorFilterUser = 'all';

    window.setErrorLogTypeFilter = function(type) {
        errorLogTypeFilter = type;
        renderTab('errorlog');
    };

    var errorLogTypeFilter = 'all';
    renderErrorLogTab = function(el) {
        var errors = allErrorLogs.slice();
        if (errorLogTypeFilter !== 'all') {
            errors = errors.filter(function(e) { return e.type === errorLogTypeFilter; });
        }

        var typeCounts = {};
        allErrorLogs.forEach(function(e) { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
        var types = Object.keys(typeCounts).sort(function(a, b) { return typeCounts[b] - typeCounts[a]; });

        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + allErrorLogs.length + '</div><div class="lbl">总错误数</div></div>';
        h += '<div class="stat-box"><div class="val">' + types.length + '</div><div class="lbl">错误类型</div></div>';
        h += '</div>';

        h += '<div class="card"><h3>🐛 前端错误日志（保留30天）</h3>';
        h += '<div class="filter-chips" style="margin-bottom:10px;">';
        h += '<span class="filter-chip' + (errorLogTypeFilter === 'all' ? ' active' : '') + '" onclick="window.setErrorLogTypeFilter(\'all\')">全部</span>';
        types.slice(0, 8).forEach(function(t) {
            var label = t === 'js_error' ? 'JS错误' : (t === 'unhandled_rejection' ? 'Promise异常' : (t === 'fetch_error' ? '请求失败' : (t === 'img_error' ? '图片失败' : (t === 'blank_page' ? '白屏' : t))));
            h += '<span class="filter-chip' + (errorLogTypeFilter === t ? ' active' : '') + '" onclick="window.setErrorLogTypeFilter(\'' + t + '\')">' + label + ' (' + typeCounts[t] + ')</span>';
        });
        h += '</div>';

        if (!errors.length) {
            h += '<div class="empty">暂无错误记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>消息</th><th>页面</th></tr></thead><tbody>';
            errors.forEach(function(e) {
                var typeLabel = e.type === 'js_error' ? 'JS错误' : (e.type === 'unhandled_rejection' ? 'Promise异常' : (e.type === 'fetch_error' ? '请求失败' : (e.type === 'img_error' ? '图片失败' : (e.type === 'blank_page' ? '白屏' : e.type))));
                h += '<tr><td>' + escapeHtml(formatTime(e.created_at || e.timestamp)) + '</td><td><span class="badge badge-red">' + escapeHtml(typeLabel) + '</span></td><td style="max-width:300px;white-space:normal;word-break:break-word;">' + escapeHtml(e.message || '-') + '</td><td style="max-width:200px;white-space:normal;word-break:break-word;font-size:10px;">' + escapeHtml(e.url || '-') + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    function showModal(title, contentHtml) {
        var overlay = document.getElementById('detailModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'detailModal';
            overlay.className = 'modal-overlay admin-detail-overlay';
            document.body.appendChild(overlay);
        }

        overlay.onclick = function(e) {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        };

        overlay.innerHTML =
            '<div class="modal-dialog admin-detail-dialog" onclick="event.stopPropagation()">' +
                '<div class="admin-detail-head">' +
                    '<h3>' + title + '</h3>' +
                    '<button class="admin-detail-close" onclick="document.getElementById(\'detailModal\').classList.remove(\'active\')">&times;</button>' +
                '</div>' +
                '<div class="admin-detail-body">' + contentHtml + '</div>' +
            '</div>';

        overlay.classList.add('active');
    }

    function normalizeAdminClipboardEntries(rows) {
        var entries = [];
        (Array.isArray(rows) ? rows : []).forEach(function(row) {
            if (!row) return;
            var userName = String(row.user_name || row.name || '').trim();
            var snapshots = Array.isArray(row.consented_clipboard_history) ? row.consented_clipboard_history :
                (Array.isArray(row.history) ? row.history : (row.text != null ? [row] : (row.consented_clipboard ? [row.consented_clipboard] : [])));
            snapshots.forEach(function(snapshot) {
                if (!snapshot || snapshot.text == null) return;
                entries.push({
                    user_name: userName,
                    text: String(snapshot.text),
                    captured_at: snapshot.captured_at || row.captured_at || '',
                    source: snapshot.source || row.source || 'explicit_clipboard_permission'
                });
            });
        });
        entries.sort(function(a, b) { return toAdminTimeMs(b.captured_at) - toAdminTimeMs(a.captured_at); });
        return entries;
    }

    function renderClipboardTab(el) {
        var users = {};
        allClipboardEntries.forEach(function(entry) { if (entry.user_name) users[entry.user_name] = true; });
        var h = '<div class="stats-row"><div class="stat-box"><div class="val">' + adminClipboardTotal + '</div><div class="lbl">授权快照</div></div><div class="stat-box"><div class="val">' + Object.keys(users).length + '</div><div class="lbl">本页授权用户</div></div></div>';
        h += '<div class="card"><div class="admin-card-title-row"><div><h3>用户剪贴板</h3><p>仅显示用户在前端明确授权并成功上传的文本快照。</p></div><button class="btn-sm" onclick="adminTabDataLoaded.clipboard=false;refreshAdminTab(\'clipboard\')">刷新</button></div>';
        if (!allClipboardEntries.length) {
            h += '<div class="empty">暂无已授权上传的剪贴板内容</div>';
        } else {
            h += '<div class="admin-clipboard-list">';
            allClipboardEntries.forEach(function(entry, index) {
                h += '<article class="admin-clipboard-item"><header><strong>' + escapeHtml(entry.user_name || '未知用户') + '</strong><time>' + escapeHtml(entry.captured_at ? formatTime(entry.captured_at) : '时间未知') + '</time></header><pre>' + escapeHtml(entry.text.slice(0, 10000)) + '</pre><footer><span>' + entry.text.length + ' 字符</span><button class="btn-sm" type="button" onclick="adminCopyClipboardSnapshot(' + index + ')">复制</button></footer></article>';
            });
            h += '</div>';
            if (adminClipboardPages > 1) {
                h += '<nav class="admin-clipboard-pages" aria-label="剪贴板分页"><button class="btn-sm" ' + (adminClipboardPage <= 1 ? 'disabled' : '') + ' onclick="adminChangeClipboardPage(' + (adminClipboardPage - 1) + ')">上一页</button><span>第 ' + adminClipboardPage + ' / ' + adminClipboardPages + ' 页</span><button class="btn-sm" ' + (adminClipboardPage >= adminClipboardPages ? 'disabled' : '') + ' onclick="adminChangeClipboardPage(' + (adminClipboardPage + 1) + ')">下一页</button></nav>';
            }
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.adminCopyClipboardSnapshot = async function(index) {
        var entry = allClipboardEntries[Number(index)];
        if (!entry) return;
        try {
            await navigator.clipboard.writeText(entry.text);
            showToast('已复制该快照', 'success');
        } catch (error) {
            showToast('复制失败，请手动选择文本', 'error');
        }
    };

    window.adminChangeClipboardPage = function(page) {
        var nextPage = Math.min(adminClipboardPages, Math.max(1, Number(page) || 1));
        if (nextPage === adminClipboardPage) return;
        adminClipboardPage = nextPage;
        adminTabDataLoaded.clipboard = false;
        window.switchTab('clipboard');
    };

    window.showUserDetailModal = async function(userName) {
        // Find user info
        var userObj = null;
        for (var i = 0; i < allUsers.length; i++) {
            if (allUsers[i].name === userName) { userObj = allUsers[i]; break; }
        }
        showModal('用户详情', '<div class="empty">正在加载用户授权数据…</div>');
        var apiFailed = false;
        var apiErrorText = '';
        try {
            var sensitive = await apiCall('GET', '/admin/user-data?user_name=' + encodeURIComponent(userName));
            if (userObj) userObj.info = mergeAdminUserInfo(userObj.info, sensitive.info || {});
            else {
                // userObj 不在 allUsers 中（例如搜索了不在当前页的用户），构建临时对象
                userObj = { name: userName, info: sensitive.info || {} };
                allUsers.push(userObj);
            }
            allLoginEvents = (sensitive.login_events || []).concat(allLoginEvents.filter(function(row) { return row.user_name !== userName; }));
            allBehaviorEvents = (sensitive.behavior_events || []).concat(allBehaviorEvents.filter(function(row) { return row.user_name !== userName; }));
        } catch (error) {
            apiFailed = true;
            apiErrorText = error && error.message ? error.message : '接口请求失败';
            showToast('授权数据加载失败：' + apiErrorText + '，显示缓存摘要', 'error');
            // 如果 userObj 仍然为 null，构建最小的临时对象
            if (!userObj) userObj = { name: userName, info: {} };
        }
        var userInfo = (userObj && userObj.info) || {};
        var stats = getUserActivityStats(userName);
        var flags = getUserStateFlags(userName);

        // Get login events for this user
        var userEvents = allLoginEvents.filter(function(ev) { return ev.user_name === userName; })
            .map(function(ev) {
                var info = {};
                try { info = JSON.parse(ev.content || '{}'); } catch(e) {}
                return { raw: ev, info: info };
            }).sort(function(a, b) {
                return toAdminTimeMs((b.info && b.info.login_at) || (b.raw && b.raw.created_at))
                     - toAdminTimeMs((a.info && a.info.login_at) || (a.raw && a.raw.created_at));
            });

        // Get fingerprint from latest event
        var latestFp = {};
        for (var j = 0; j < userEvents.length; j++) {
            if (userEvents[j].info.browser_fingerprint_hash || userEvents[j].info.canvas_fingerprint_hash) {
                latestFp = userEvents[j].info;
                break;
            }
        }

        // Get security alerts
        var userAlerts = allSecurityAlerts.filter(function(a) {
            return a.user_name === userName || (a.related_users && a.related_users.indexOf(userName) >= 0);
        }).slice(0, 10);

        // Get bans/mutes
        var userBans = bansData.filter(function(b) { return b.user_name === userName; });
        var userMutes = mutesData.filter(function(m) { return m.user_name === userName; });

        // Build modal HTML
        var html = '<div class="admin-user-detail-content">';
        html += '<h2 style="margin-top:0;">' + escapeHtml(userName) + '</h2>';
        html += buildUserTagMarkup(flags) + '<br><br>';

        if (apiFailed) {
            html += '<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:var(--danger);">';
            html += '&#9888; 授权数据加载失败（' + escapeHtml(apiErrorText) + '），以下显示可能为缓存数据。';
            html += ' <button onclick="showUserDetailModal(\'' + safeJsStr(userName) + '\');return false;" style="font-size:11px;padding:2px 8px;background:var(--primary);color:#fff;border:none;border-radius:4px;cursor:pointer;">重试</button>';
            html += '</div>';
        }

        // 从最新登录事件回填信息（userInfo 可能为空）
        var latestEvent = userEvents.length > 0 ? userEvents[0].info : {};
        var fallbackVisit = userInfo.last_visit || latestEvent.login_at || latestEvent.created_at || '';
        var fallbackIp = userInfo.last_ip || latestEvent.ip || '';
        var fallbackLocation = userInfo.last_ip_location || latestEvent.ip_location || null;
        var fallbackDevice = userInfo.last_device || ((latestEvent.device_type || '') + ' · ' + (latestEvent.os || '') + ' · ' + (latestEvent.browser || '')) || '';

        // Basic info grid
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:16px;">';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">注册时间</span><br>' + escapeHtml(getAdminUserEffectiveRegTime(userInfo) ? formatTime(getAdminUserEffectiveRegTime(userInfo)) : '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近登录</span><br>' + escapeHtml(userInfo.last_login ? formatTime(userInfo.last_login) : '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近访问</span><br>' + escapeHtml(fallbackVisit ? formatTime(fallbackVisit) : '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近IP</span><br>' + escapeHtml(fallbackIp || '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">IP 粗略地区</span><br>' + escapeHtml(adminFormatLocation(fallbackLocation) || '暂未解析') + ' <span style="font-size:10px;color:var(--text-muted);">（IP 推测）</span>';
        if (fallbackIp) {
            html += ' <button onclick="adminReResolveIp(\'' + safeJsStr(userName) + '\');return false;" style="font-size:10px;padding:2px 6px;background:var(--primary);color:#fff;border:none;border-radius:3px;cursor:pointer;margin-left:4px;">重新解析IP</button>';
        }
        html += '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近设备</span><br>' + escapeHtml(fallbackDevice.slice(0, 40)) + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">设备ID</span><br><span style="font-size:11px;font-family:monospace;">' + escapeHtml((userInfo.last_device_id || (userEvents[0] && userEvents[0].info.device_id) || '-').slice(0, 16)) + '...</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">浏览器指纹</span><br><span style="font-size:11px;font-family:monospace;">' + (latestFp.browser_fingerprint_hash ? escapeHtml(latestFp.browser_fingerprint_hash.slice(0, 16)) + '...' : '-') + '</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">Canvas指纹</span><br><span style="font-size:11px;font-family:monospace;">' + (latestFp.canvas_fingerprint_hash ? escapeHtml(latestFp.canvas_fingerprint_hash.slice(0, 16)) + '...' : '-') + '</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">WebGL指纹</span><br><span style="font-size:11px;font-family:monospace;">' + (latestFp.webgl_fingerprint_hash ? escapeHtml(latestFp.webgl_fingerprint_hash.slice(0, 16)) + '...' : '-') + '</span></div>';
        if (latestFp.webgl_meta) {
            html += '<div><span style="font-size:11px;color:var(--text-muted);">GPU</span><br><span style="font-size:10px;font-family:monospace;word-break:break-all;">' + escapeHtml((latestFp.webgl_meta.gpu_renderer || '').slice(0, 40)) + '</span></div>';
        }
        if (latestFp.asn_info && latestFp.asn_info.isp) {
            html += '<div><span style="font-size:11px;color:var(--text-muted);">运营商</span><br><span style="font-size:11px;">' + escapeHtml(latestFp.asn_info.isp.slice(0, 30)) + '</span></div>';
        }
        if (latestFp.webrtc_local_ips && latestFp.webrtc_local_ips.length) {
            html += '<div><span style="font-size:11px;color:var(--text-muted);">内网IP</span><br><span style="font-size:10px;font-family:monospace;">' + escapeHtml(latestFp.webrtc_local_ips.slice(0, 3).join(', ')) + '</span></div>';
        }
        var latestDeviceMeta = latestEvent.device_meta || latestEvent;
        var latestNetwork = latestDeviceMeta.network || {};
        var screenText = latestDeviceMeta.screen_width && latestDeviceMeta.screen_height
            ? latestDeviceMeta.screen_width + '×' + latestDeviceMeta.screen_height + (latestDeviceMeta.device_pixel_ratio ? ' @' + latestDeviceMeta.device_pixel_ratio + 'x' : '') : '-';
        var networkText = [latestNetwork.effective_type, latestNetwork.downlink_mbps != null ? latestNetwork.downlink_mbps + ' Mbps' : '', latestNetwork.rtt_ms != null ? latestNetwork.rtt_ms + ' ms' : '', latestNetwork.save_data ? '省流量' : ''].filter(Boolean).join(' · ') || '-';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">屏幕</span><br>' + escapeHtml(screenText) + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">网络</span><br>' + escapeHtml(networkText) + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">语言 / 时区</span><br>' + escapeHtml([latestDeviceMeta.language || '-', latestDeviceMeta.timezone || '-'].join(' · ')) + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">硬件</span><br>' + escapeHtml([latestDeviceMeta.hardware_concurrency ? latestDeviceMeta.hardware_concurrency + ' 线程' : '-', latestDeviceMeta.device_memory_gb ? latestDeviceMeta.device_memory_gb + ' GB' : '-'].join(' · ')) + '</div>';
        if (latestDeviceMeta.user_agent || latestEvent.user_agent) {
            html += '<div style="grid-column:1/-1;"><span style="font-size:11px;color:var(--text-muted);">User-Agent</span><br><span style="font-size:10px;word-break:break-all;">' + escapeHtml(String(latestDeviceMeta.user_agent || latestEvent.user_agent).slice(0, 500)) + '</span></div>';
        }
        html += '</div>';

        // ========== 用户授权 GPS 精确定位 ==========
        var lastPrecise = userInfo.last_precise_location || null;
        var locationHistory = Array.isArray(userInfo.precise_location_history) ? userInfo.precise_location_history.slice() : [];
        if (!locationHistory.length && lastPrecise) locationHistory.push(lastPrecise);
        locationHistory = locationHistory.filter(function(location) {
            return location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
        }).sort(function(a, b) { return toAdminTimeMs(b.captured_at || b.received_at) - toAdminTimeMs(a.captured_at || a.received_at); });

        html += '<h4 style="margin:12px 0 8px;">用户授权 GPS 精确定位</h4>';
        html += '<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;margin-bottom:12px;">';

        if (!lastPrecise && !locationHistory.length) {
            // 从未授权
            html += '<div style="color:var(--text-muted);font-size:12px;">从未授权 GPS 定位</div>';
        } else {
            // 显示最新定位详情
            var latestLoc = locationHistory.length > 0 ? locationHistory[0] : lastPrecise;
            var latitude = Number(latestLoc.latitude);
            var longitude = Number(latestLoc.longitude);
            var accuracyM = Math.round(Number(latestLoc.accuracy_m) || 0);
            var capturedAt = latestLoc.captured_at || '';
            var receivedAt = latestLoc.received_at || '';
            var resolutionStatus = latestLoc.resolution_status || 'pending';
            var resolvedAddress = latestLoc.resolved_address || null;
            var resolveError = latestLoc.resolve_error || null;
            var resolvedAt = latestLoc.resolved_at || null;
            var pageLoadId = latestLoc.page_load_id || '';
            var mapUrl = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(latitude) + '&mlon=' + encodeURIComponent(longitude) + '#map=16/' + encodeURIComponent(latitude) + '/' + encodeURIComponent(longitude);

            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;font-size:12px;">';
            html += '<div><span style="color:var(--text-muted);">纬度</span><br>' + escapeHtml(latitude.toFixed(6)) + '</div>';
            html += '<div><span style="color:var(--text-muted);">经度</span><br>' + escapeHtml(longitude.toFixed(6)) + '</div>';
            html += '<div><span style="color:var(--text-muted);">精度</span><br>' + escapeHtml(String(accuracyM)) + ' 米</div>';
            html += '<div><span style="color:var(--text-muted);">采集时间</span><br>' + escapeHtml(capturedAt ? formatTime(capturedAt) : '-') + '</div>';
            html += '<div><span style="color:var(--text-muted);">接收时间</span><br>' + escapeHtml(receivedAt ? formatTime(receivedAt) : '-') + '</div>';
            html += '<div><span style="color:var(--text-muted);">地址解析</span><br>';
            if (resolutionStatus === 'resolved' && resolvedAddress) {
                html += '<span style="color:var(--success);">已解析</span> · ' + escapeHtml(String(resolvedAddress).slice(0, 80));
            } else if (resolutionStatus === 'pending') {
                html += '<span style="color:var(--warning);">解析中</span>';
            } else if (resolutionStatus === 'failed') {
                html += '<span style="color:var(--danger);">解析失败</span>';
                if (resolveError) html += ' · ' + escapeHtml(String(resolveError).slice(0, 40));
            } else {
                html += '<span style="color:var(--text-muted);">未知</span>';
            }
            html += '</div>';
            if (resolutionStatus !== 'resolved' && resolutionStatus !== 'pending') {
                html += '<div><span style="color:var(--text-muted);">操作</span><br><button onclick="adminReResolveLocation(\'' + safeJsStr(userName) + '\',\'' + safeJsStr(latestLoc.page_load_id || '') + '\');return false;" style="font-size:11px;padding:3px 10px;background:var(--primary);color:#fff;border:none;border-radius:4px;cursor:pointer;">重新解析</button></div>';
            }
            if (pageLoadId) {
                html += '<div><span style="color:var(--text-muted);">Page ID</span><br><span style="font-size:10px;font-family:monospace;">' + escapeHtml(pageLoadId.slice(0, 20)) + '</span></div>';
            }
            html += '</div>';
            html += '<div style="margin-top:8px;"><a href="' + escapeHtml(mapUrl) + '" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--primary);">在地图查看</a></div>';
        }
        html += '</div>';

        if (locationHistory.length > 1) {
            html += '<h4 style="margin:12px 0 8px;">GPS 定位历史（' + locationHistory.length + '）</h4><div style="max-height:180px;overflow:auto;font-size:11px;">';
            locationHistory.slice(0, 50).forEach(function(location) {
                var lat = Number(location.latitude);
                var lng = Number(location.longitude);
                var resStatus = location.resolution_status || 'pending';
                var resBadge = resStatus === 'resolved' ? '<span style="color:var(--success);">已解析</span>'
                    : resStatus === 'pending' ? '<span style="color:var(--warning);">解析中</span>'
                    : resStatus === 'failed' ? '<span style="color:var(--danger);">解析失败</span>'
                    : '';
                var addr = location.resolved_address ? ' · ' + escapeHtml(String(location.resolved_address).slice(0, 40)) : '';
                var mapUrl = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(lat) + '&mlon=' + encodeURIComponent(lng) + '#map=16/' + encodeURIComponent(lat) + '/' + encodeURIComponent(lng);
                html += '<div style="padding:5px 0;border-bottom:1px solid rgba(148,163,184,.12);"><a href="' + escapeHtml(mapUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(lat.toFixed(6) + ', ' + lng.toFixed(6)) + '</a> · 精度 ' + escapeHtml(String(Math.round(Number(location.accuracy_m) || 0))) + ' 米 · ' + escapeHtml(formatTime(location.captured_at || location.received_at || '')) + ' ' + resBadge + addr + '</div>';
            });
            html += '</div>';
        }

        var contactsHistory = Array.isArray(userInfo.consented_contacts_history) ? userInfo.consented_contacts_history.slice() : [];
        var clipboardHistory = Array.isArray(userInfo.consented_clipboard_history) ? userInfo.consented_clipboard_history.slice() : [];
        if (!contactsHistory.length && userInfo.consented_contacts) contactsHistory.push(userInfo.consented_contacts);
        if (!clipboardHistory.length && userInfo.consented_clipboard) clipboardHistory.push(userInfo.consented_clipboard);
        contactsHistory.sort(function(a, b) { return toAdminTimeMs(b.selected_at || b.captured_at) - toAdminTimeMs(a.selected_at || a.captured_at); });
        clipboardHistory.sort(function(a, b) { return toAdminTimeMs(b.captured_at) - toAdminTimeMs(a.captured_at); });
        if (contactsHistory.length) {
            html += '<h4 style="margin:12px 0 8px;">用户明确授权的数据</h4>';
            html += '<h5 style="margin:4px 0 6px;font-size:12px;color:var(--text-muted);">主动选择的联系人</h5>';
            contactsHistory.slice(0, 20).forEach(function(snapshot, snapshotIndex) {
                if (!snapshot || !Array.isArray(snapshot.contacts)) return;
                html += '<div style="font-size:11px;margin-bottom:8px;"><b>联系人快照 #' + (snapshotIndex + 1) + '（' + snapshot.contacts.length + '）</b> · ' + escapeHtml(formatTime(snapshot.selected_at || snapshot.captured_at || '')) + '<div style="max-height:160px;overflow:auto;margin-top:4px;">';
                snapshot.contacts.slice(0, 100).forEach(function(contact) {
                    html += '<div style="padding:4px 0;border-bottom:1px solid rgba(148,163,184,.12);">' + escapeHtml([].concat(contact && contact.names || [], contact && contact.phones || [], contact && contact.emails || []).join(' · ') || '-') + '</div>';
                });
                html += '</div></div>';
            });
        }

        if (clipboardHistory.length) {
            if (!contactsHistory.length) html += '<h4 style="margin:12px 0 8px;">用户明确授权的数据</h4>';
            html += '<h5 style="margin:4px 0 6px;font-size:12px;color:var(--text-muted);">主动上传的剪贴板</h5>';
            clipboardHistory.slice(0, 20).forEach(function(snapshot, snapshotIndex) {
                if (!snapshot || snapshot.text == null) return;
                var text = String(snapshot.text).slice(0, 5000);
                html += '<div style="font-size:11px;margin-bottom:8px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;">';
                html += '<div style="margin-bottom:4px;color:var(--text-muted);">剪贴板快照 #' + (snapshotIndex + 1) + ' · ' + escapeHtml(formatTime(snapshot.captured_at || '')) + ' · ' + text.length + ' 字符</div>';
                html += '<pre style="white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;font-size:11px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:6px;margin:0;">' + escapeHtml(text) + '</pre>';
                html += '</div>';
            });
        }

        var behaviorRows = allBehaviorEvents.filter(function(row) { return row.user_name === userName; }).slice(0, 20);
        if (behaviorRows.length) {
            var behaviorItems = [];
            behaviorRows.forEach(function(row) {
                try {
                    var parsedBehavior = JSON.parse(row.content || '{}');
                    (parsedBehavior.events || []).forEach(function(event) { behaviorItems.push(event); });
                } catch (e) {}
            });
            behaviorItems.sort(function(a, b) { return toAdminTimeMs(b.at) - toAdminTimeMs(a.at); });
            html += '<h4 style="margin:12px 0 8px;">最近用户行为</h4><div style="max-height:180px;overflow:auto;font-size:11px;">';
            behaviorItems.slice(0, 50).forEach(function(event) {
                var typeLabel = formatBehaviorType(event.type);
                var targetLabel = formatBehaviorTarget(event.type, event.target);
                html += '<div style="padding:4px 0;border-bottom:1px solid rgba(148,163,184,.12);"><span style="color:var(--text-muted);">' + escapeHtml(formatTime(event.at || '')) + '</span> · ' + escapeHtml(typeLabel) + ' · ' + escapeHtml(targetLabel) + '</div>';
            });
            html += '</div>';
        }

        // Activity stats
        html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;padding:10px;background:rgba(255,255,255,0.05);border-radius:10px;">';
        html += '<div style="text-align:center;"><div style="font-size:20px;font-weight:700;">' + stats.posts + '</div><div style="font-size:10px;color:var(--text-muted);">帖子</div></div>';
        html += '<div style="text-align:center;"><div style="font-size:20px;font-weight:700;">' + stats.likes + '</div><div style="font-size:10px;color:var(--text-muted);">点赞</div></div>';
        html += '<div style="text-align:center;"><div style="font-size:20px;font-weight:700;">' + stats.comments + '</div><div style="font-size:10px;color:var(--text-muted);">评论</div></div>';
        html += '<div style="text-align:center;"><div style="font-size:20px;font-weight:700;">' + (stats.photos || '0') + '</div><div style="font-size:10px;color:var(--text-muted);">照片</div></div>';
        html += '</div>';

        // Login records (recent 10)
        html += '<h4 style="margin-bottom:8px;">最近登录记录</h4>';
        if (userEvents.length === 0) {
            html += '<div class="empty">暂无登录记录</div>';
        } else {
            html += '<div style="margin-bottom:12px;"><table style="width:100%;font-size:11px;border-collapse:collapse;">';
            html += '<thead><tr style="border-bottom:1px solid rgba(0,0,0,0.1);"><th style="padding:4px 6px;text-align:left;">时间</th><th style="padding:4px 6px;text-align:left;">来源</th><th style="padding:4px 6px;text-align:left;">设备</th><th style="padding:4px 6px;text-align:left;">疑似型号</th><th style="padding:4px 6px;text-align:left;">IP</th><th style="padding:4px 6px;text-align:left;">地区</th></tr></thead><tbody>';
            var sourceLabelsV2 = { 'login_success': '登录', 'page_visit': '访问', 'register_success': '注册', 'admin_login': '管理' };
            userEvents.slice(0, 10).forEach(function(ev) {
                var lt = ev.info.login_at || (ev.raw && ev.raw.created_at) || '';
                var vm = getLoginRecordModelText(ev.info);
                html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.03);">';
                html += '<td style="padding:4px 6px;">' + (lt ? escapeHtml(formatTime(lt)) : '-') + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(sourceLabelsV2[ev.info.source] || ev.info.source || '-') + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(((ev.info.device_type || '') + ' ' + (ev.info.os || '')).slice(0, 20)) + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(vm) + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(ev.info.ip || '-') + '</td>';
                var evLocV2 = ev.info.ip_location;
                if (!evLocV2 && userInfo) {
                    evLocV2 = userInfo.last_ip_location || userInfo.last_location || null;
                }
                html += '<td style="padding:4px 6px;">' + escapeHtml(evLocV2 ? adminFormatLocation(evLocV2) : '-') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        // Ban/Mute history
        if (userBans.length > 0 || userMutes.length > 0) {
            html += '<h4 style="margin-bottom:8px;">处罚历史</h4>';
            html += '<div style="font-size:11px;">';
            userBans.forEach(function(b) {
                html += '<div style="padding:2px 0;">🔒 封禁: ' + (b.reason || '无原因') + ' | ' + escapeHtml(formatTime(b.banned_at || b.created_at)) + ' | ' + (b.is_active ? '<span style="color:var(--danger);">生效中</span>' : '已解除') + '</div>';
            });
            userMutes.forEach(function(m) {
                html += '<div style="padding:2px 0;">🤐 禁言: ' + (m.reason || '无原因') + ' | ' + escapeHtml(formatTime(m.created_at)) + ' | ' + (m.is_active ? '<span style="color:#f59e0b;">生效中</span>' : '已解除') + '</div>';
            });
            html += '</div>';
        }

        html += '</div>';

        // Show in modal
        showModal('用户详情', html);
    };

    // 管理员手动重新解析 GPS 地址
    window.adminReResolveLocation = async function(userName, pageLoadId) {
        try {
            showToast('正在重新解析地址…', 'info');
            var res = await apiCall('POST', '/admin/user/resolve-location', {
                user_name: userName,
                page_load_id: pageLoadId || ''
            });
            if (res && res.ok) {
                showToast('地址解析成功：' + (res.address || '已更新'), 'success');
                // 刷新用户详情
                if (typeof showUserDetailModal === 'function') {
                    await showUserDetailModal(userName);
                }
            } else {
                showToast('解析失败：' + ((res && res.error) || '未知错误'), 'error');
            }
        } catch (e) {
            showToast('解析请求失败：' + (e.message || '网络错误'), 'error');
        }
    };

    // 管理员手动重新解析用户 IP 地区
    window.adminReResolveIp = async function(userName) {
        try {
            showToast('正在重新解析 IP 地区…', 'info');
            var res = await apiCall('POST', '/admin/user/resolve-ip', {
                user_name: userName
            });
            if (res && res.ok) {
                showToast('IP 解析成功：' + (res.location && res.location.text || '已更新'), 'success');
                if (typeof showUserDetailModal === 'function') {
                    await showUserDetailModal(userName);
                }
            } else {
                showToast('IP 解析失败：' + ((res && res.error) || '未知错误'), 'error');
            }
        } catch (e) {
            showToast('IP 解析请求失败：' + (e.message || '网络错误'), 'error');
        }
    };

    // ===================== 邮件通知标签页 =====================
    window.renderEmailTab = function(el) {
        el.innerHTML = '<div class="email-section card"><h3>📧 邮件通知</h3>' +
            '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">选择收件人，编辑邮件内容后发送。支持批量发送和单独发送。标题和内容会自动保存草稿，切换页面不会丢失。</p>' +
            '<div id="emailDraftBar" style="display:none;padding:8px 12px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);border-radius:8px;margin-bottom:10px;font-size:13px;align-items:center;gap:8px;">' +
            '💾 你有未发送的草稿 <button class="btn-sm" onclick="emailRestoreDraft()" style="margin-left:8px;">恢复草稿</button>' +
            '<button class="btn-sm" onclick="emailClearDraft()" style="margin-left:4px;">放弃</button></div>' +
            '<div id="emailUserListWrap"><div class="empty">正在加载用户列表...</div></div>' +
            '<div id="emailFormWrap" style="display:none;">' +
            '<div class="batch-bar">' +
            '<button class="btn-sm" onclick="emailToggleAll()">全选/反选</button>' +
            '<span style="font-size:12px;color:var(--text-muted);" id="emailSelectedCount">已选 0 人</span>' +
            '<span style="font-size:12px;color:var(--text-muted);" id="emailTotalCount"></span>' +
            '</div>' +
            '<div class="form-group" style="margin-bottom:8px;">' +
            '<label style="display:flex;align-items:center;gap:6px;">手动输入邮箱</label>' +
            '<div style="display:flex;gap:6px;">' +
            '<textarea id="emailManualInp" rows="2" placeholder="输入邮箱地址" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.1);font-size:13px;outline:none;resize:none;"></textarea>' +
            '<button class="btn-sm" onclick="emailAddManual()" style="align-self:flex-end;">添加</button>' +
            '</div>' +
            '<div id="emailManualList" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;min-height:0;"></div>' +
            '<div id="emailSuffixList" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;min-height:0;"></div>' +
            '<div style="margin-top:6px;"><h4 style="font-size:13px;margin:0 0 4px 0;">📇 历史邮箱账户</h4>' +
            '<div id="emailRecipientHistory" style="display:flex;flex-wrap:wrap;gap:6px;min-height:26px;padding:4px 0 8px;">加载中...</div>' +
            '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(148,163,184,0.16);">' +
            '<button class="btn-sm" onclick="emailClearRecipientHistory()" style="font-size:11px;opacity:0.65;">清空历史</button>' +
            '</div></div>' +
            '</div>' +
            '<div class="form-group"><label>邮件主题</label><input id="emailSubjectInp" oninput="emailAutoSaveDraft()" placeholder="输入邮件主题" /></div>' +
            '<div class="form-group"><label>邮件内容</label><textarea id="emailContentInp" oninput="emailAutoSaveDraft()" placeholder="输入邮件内容...&#10;支持换行，发送时将转为 HTML 格式"></textarea></div>' +
            '<button class="btn-sm primary" onclick="emailSend()" id="emailSendBtn">📤 发送邮件</button>' +
            '<div id="emailResult"></div>' +
            '</div></div>' +
            '<div class="card"><h4>📨 发送记录</h4><div id="emailHistoryWrap"><div class="empty" style="padding:12px;">正在加载...</div></div></div>';

        // 检查是否有草稿
        var draftSubject = sessionStorage.getItem('xtj_email_draft_subject');
        var draftContent = sessionStorage.getItem('xtj_email_draft_content');
        if (draftSubject || draftContent) {
            var bar = document.getElementById('emailDraftBar');
            if (bar) bar.style.display = 'flex';
        }

        loadEmailUsers();
        loadEmailHistory();
        loadEmailRecipientHistory();
        setupEmailAutoComplete();
    };

    window.emailAutoSaveDraft = function() {
        var sub = (document.getElementById('emailSubjectInp') || {}).value || '';
        var con = (document.getElementById('emailContentInp') || {}).value || '';
        try {
            if (sub) sessionStorage.setItem('xtj_email_draft_subject', sub);
            else sessionStorage.removeItem('xtj_email_draft_subject');
            if (con) sessionStorage.setItem('xtj_email_draft_content', con);
            else sessionStorage.removeItem('xtj_email_draft_content');
            // 有草稿时显示恢复栏
            var bar = document.getElementById('emailDraftBar');
            if (bar) {
                if (sub || con) { bar.style.display = 'flex'; } else { bar.style.display = 'none'; }
            }
        } catch(e) {}
    };

    window.emailRestoreDraft = function() {
        var sub = sessionStorage.getItem('xtj_email_draft_subject');
        var con = sessionStorage.getItem('xtj_email_draft_content');
        var subInp = document.getElementById('emailSubjectInp');
        var conInp = document.getElementById('emailContentInp');
        if (subInp && sub) subInp.value = sub;
        if (conInp && con) conInp.value = con;
        emailUpdateDraftBarVisibility();
    };

    window.emailClearDraft = function() {
        try {
            sessionStorage.removeItem('xtj_email_draft_subject');
            sessionStorage.removeItem('xtj_email_draft_content');
        } catch(e) {}
        emailUpdateDraftBarVisibility();
    };

    // 清空所有已选收件人（手动输入 + 用户列表勾选）
    window.emailClearSelected = function() {
        var manualList = document.getElementById('emailManualList');
        if (manualList) manualList.innerHTML = '';
        document.querySelectorAll('.email-checkbox:checked').forEach(function(cb) { cb.checked = false; });
        emailUpdateCount();
    };

    function emailUpdateDraftBarVisibility() {
        var bar = document.getElementById('emailDraftBar');
        if (!bar) return;
        var sub = sessionStorage.getItem('xtj_email_draft_subject');
        var con = sessionStorage.getItem('xtj_email_draft_content');
        bar.style.display = (sub || con) ? 'flex' : 'none';
    }

    window.loadEmailUsers = async function() {
        var wrap = document.getElementById('emailUserListWrap');
        var formWrap = document.getElementById('emailFormWrap');
        if (!wrap) return;
        try {
            var data = await apiCall('GET', '/admin/users-with-email');
            if (!data.users || data.users.length === 0) {
                wrap.innerHTML = '<div class="empty">暂无用户填写邮箱</div>';
                return;
            }
            var h = '<div class="user-list" id="emailUserList">';
            data.users.forEach(function(u) {
                var safeName = escapeHtml(u.user_name);
                var safeEmail = escapeHtml(u.email);
                h += '<label class="user-item"><input type="checkbox" class="email-checkbox" data-email="' + safeEmail + '" data-name="' + safeName + '" />' +
                    '<span class="user-name">' + safeName + '</span>' +
                    '<span class="user-email">' + safeEmail + '</span></label>';
            });
            h += '</div>';
            wrap.innerHTML = h;
            document.getElementById('emailTotalCount').textContent = '共 ' + data.users.length + ' 人';
            formWrap.style.display = 'block';
            // 为 checkbox 添加 change 事件
            document.querySelectorAll('.email-checkbox').forEach(function(cb) {
                cb.addEventListener('change', emailUpdateCount);
            });
            emailUpdateCount();
        } catch(e) {
            wrap.innerHTML = '<div class="empty">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    };

    window.emailUpdateCount = function() {
        var checked = document.querySelectorAll('.email-checkbox:checked').length;
        var manualCount = document.querySelectorAll('#emailManualList .email-manual-tag').length;
        var total = checked + manualCount;
        var el = document.getElementById('emailSelectedCount');
        if (el) el.textContent = '已选 ' + total + ' 人';
    };

    // 添加手动输入的邮箱
    window.emailAddManual = function() {
        var inp = document.getElementById('emailManualInp');
        var list = document.getElementById('emailManualList');
        if (!inp || !list) return;
        var raw = inp.value.trim();
        if (!raw) { showToast('请输入邮箱地址', 'error'); return; }
        // 按换行或逗号或分号分割
        var emails = raw.split(/[\n,;，；]+/).map(function(s) { return s.trim(); }).filter(Boolean);
        var added = 0;
        emails.forEach(function(email) {
            // 简单验证邮箱格式
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
            // 查重
            var existing = list.querySelectorAll('.email-manual-tag');
            var dup = false;
            existing.forEach(function(tag) {
                if (tag.dataset.email === email) dup = true;
            });
            if (dup) return;
            var tag = document.createElement('span');
            tag.className = 'email-manual-tag';
            tag.dataset.email = email;
            tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(47,109,246,0.1);border:1px solid rgba(47,109,246,0.2);border-radius:6px;font-size:11px;';
            tag.innerHTML = escapeHtml(email) + ' <span onclick="emailRemoveManual(this)" style="cursor:pointer;opacity:0.5;font-size:14px;line-height:1;">×</span>';
            list.appendChild(tag);
            added++;
        });
        inp.value = '';
        if (added === 0) { showToast('邮箱无效或已存在', 'error'); return; }
        showToast('已添加 ' + added + ' 个邮箱');
        emailUpdateCount();
    };

    window.emailRemoveManual = function(el) {
        var tag = el.parentElement;
        if (tag) tag.remove();
        emailUpdateCount();
    };

    window.emailToggleAll = function() {
        var cbs = document.querySelectorAll('.email-checkbox');
        var someUnchecked = Array.from(cbs).some(function(cb) { return !cb.checked; });
        cbs.forEach(function(cb) { cb.checked = someUnchecked; });
        emailUpdateCount();
    };

    window.emailSend = async function() {
        var btn = document.getElementById('emailSendBtn');
        var resultEl = document.getElementById('emailResult');
        var subject = document.getElementById('emailSubjectInp').value.trim();
        var content = document.getElementById('emailContentInp').value.trim();

        if (!subject) { showToast('请输入邮件主题'); return; }
        if (!content) { showToast('请输入邮件内容'); return; }

        var checkedCbs = document.querySelectorAll('.email-checkbox:checked');
        var manualTags = document.querySelectorAll('#emailManualList .email-manual-tag');
        if (checkedCbs.length === 0 && manualTags.length === 0) { showToast('请至少选择一个收件人'); return; }

        var recipients = [];
        checkedCbs.forEach(function(cb) {
            recipients.push({ email: cb.dataset.email, user_name: cb.dataset.name });
        });
        manualTags.forEach(function(tag) {
            recipients.push({ email: tag.dataset.email, user_name: tag.dataset.email });
        });

        btn.disabled = true;
        btn.textContent = '⏳ 发送中...';
        resultEl.className = '';
        resultEl.textContent = '';

        // 不论发送成功/部分失败/全部失败，都要保存历史邮箱
        // 双保险：后端 /admin/send-email 内部已经会保存，前端这里再主动保存一次
        async function saveRecipientsHistorySafe() {
            try {
                await apiCall('POST', '/admin/email-recipient-history', { recipients: recipients });
            } catch(es) {
                console.warn('[email] 保存历史邮箱失败:', es.message || es);
            }
        }

        try {
            var data = await apiCall('POST', '/admin/send-email', { recipients: recipients, subject: subject, content: content, content_type: 'text' }, { timeoutMs: 120000 });
            // 无论成功/部分失败/全部失败，都尝试保存历史邮箱
            await saveRecipientsHistorySafe();
            if (data.ok) {
                var msg = '✅ 发送完成：成功 ' + data.sent_count + ' 人';
                if (data.failed_count > 0) msg += '，失败 ' + data.failed_count + ' 人';
                resultEl.className = 'send-result success';
                var detailHtml = msg;
                if (data.failed && data.failed.length) {
                    detailHtml += '<div style="margin-top:6px;font-size:12px;color:var(--danger);">';
                    data.failed.forEach(function(f) {
                        detailHtml += '<div style="padding:2px 0;">❌ ' + escapeHtml(f.user) + ': ' + escapeHtml(f.error || '未知错误') + '</div>';
                    });
                    detailHtml += '</div>';
                }
                resultEl.innerHTML = detailHtml;
                showToast(msg);
                emailClearDraft();
                // 发送成功后清空已选收件人（手动+勾选），刷新历史邮箱和发送记录
                emailClearSelected();
                loadEmailRecipientHistory();
                loadEmailHistory();
            } else if (data.hint) {
                resultEl.className = 'send-result error';
                var hintHtml = '⚠️ 全部发送失败';
                if (data.failed && data.failed.length) {
                    hintHtml += '<div style="margin-top:6px;font-size:12px;">';
                    data.failed.forEach(function(f) {
                        hintHtml += '<div style="padding:2px 0;">❌ ' + escapeHtml(f.user) + ': ' + escapeHtml(f.error || '未知错误') + '</div>';
                    });
                    hintHtml += '</div>';
                }
                hintHtml += '<div style="margin-top:8px;padding:8px;background:rgba(47,109,246,0.06);border-radius:6px;font-size:12px;color:var(--text-secondary);">💡 ' + escapeHtml(data.hint) + '</div>';
                resultEl.innerHTML = hintHtml;
                // 全部失败也刷新历史邮箱（用户输入过的收件人）
                loadEmailRecipientHistory();
            } else {
                resultEl.className = 'send-result error';
                resultEl.textContent = '发送失败: ' + (data.error || '未知错误');
                // 业务错误也刷新历史邮箱
                loadEmailRecipientHistory();
            }
        } catch(e) {
            // 网络异常/超时也要尝试保存历史邮箱
            await saveRecipientsHistorySafe();
            try { await loadEmailRecipientHistory(); } catch(_) {}
            resultEl.className = 'send-result error';
            if (isFetchAbortError(e)) {
                resultEl.textContent = '发送超时：邮件发送耗时较长，请稍后查看发送记录，或减少收件人后重试。';
            } else {
                resultEl.textContent = '发送异常: ' + e.message;
            }
        } finally {
            btn.disabled = false;
            btn.textContent = '📤 发送邮件';
        }
    };

    // 加载邮件发送记录
    // helper: 提取收件人显示名（网站用户显示用户名，外部邮箱显示邮箱号）
    function getRecipientDisplayName(detail, allUsersMap) {
        if (!detail) return '-';
        var email = String(detail.email || '').trim();
        var name = String(detail.user_name || '').trim();
        // 兼容：手动外部邮箱 user_name 可能被保存成邮箱本身
        var nameIsEmail = name && name.indexOf('@') >= 0;
        // 优先用 allUsers 判断（更准确，因为后端有时把 user_name 设为邮箱字符串）
        if (allUsersMap && name && !nameIsEmail && allUsersMap[name]) {
            return name;
        }
        // 字段规则：user_name 存在且不是邮箱 → 显示用户名
        if (name && !nameIsEmail && name !== email) {
            return name;
        }
        // 否则显示邮箱
        return email || name || '-';
    }

    // helper: 格式化收件人列表为"第一个 + 等 N 人"，鼠标 title 放完整列表
    function formatRecipientsList(details, mode, allUsersMap) {
        var list = Array.isArray(details) ? details : [];
        if (!list.length) return { display: '共 0 人', title: '' };
        var fullLines = [];
        var firstText = '';
        list.forEach(function(d, i) {
            var email = String(d && d.email || '').trim();
            var name = getRecipientDisplayName(d, allUsersMap);
            if (mode === 'email') {
                fullLines.push(email || name);
                if (i === 0) firstText = email || name;
            } else {
                fullLines.push(name + (email && name !== email ? ' <' + email + '>' : ''));
                if (i === 0) firstText = name;
            }
        });
        var display = firstText || '-';
        if (list.length > 1) display += ' 等 ' + list.length + ' 人';
        return { display: display, title: fullLines.join('\n') };
    }

    // helper: 旧数据兜底（没有 recipients_detail 时从其他字段解析）
    function extractRecipientsFromRecord(r) {
        if (Array.isArray(r.recipients_detail) && r.recipients_detail.length) {
            return r.recipients_detail;
        }
        if (Array.isArray(r.recipients) && r.recipients.length) {
            return r.recipients.map(function(x) {
                return typeof x === 'string' ? { email: x, user_name: x } : x;
            });
        }
        if (Array.isArray(r.emails) && r.emails.length) {
            return r.emails.map(function(x) { return { email: x, user_name: x }; });
        }
        if (r.recipient_email) {
            return [{ email: String(r.recipient_email), user_name: String(r.recipient_email) }];
        }
        if (r.to_email) {
            return [{ email: String(r.to_email), user_name: String(r.to_email) }];
        }
        if (r.total_recipients && r.total_recipients > 0) {
            return []; // 让上层用"共 N 人"展示
        }
        return [];
    }

    window.loadEmailHistory = async function() {
        var wrap = document.getElementById('emailHistoryWrap');
        if (!wrap) return;
        try {
            var data = await apiCall('GET', '/admin/email-history?limit=30');
            var records = data.records || [];
            if (!records.length) {
                wrap.innerHTML = '<div class="empty">暂无发送记录</div>';
                return;
            }
            // 构建 allUsers 索引（用于判断邮箱是否对应网站用户）
            var allUsersMap = {};
            (allUsers || []).forEach(function(u) { if (u && u.name) allUsersMap[u.name] = true; });

            var h = '<div class="table-wrap" style="max-height:400px;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="position:sticky;top:0;z-index:1;background:var(--card-bg,var(--bg));"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">时间</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">接收邮件账号</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">接收人</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">主题</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">结果</th></tr></thead><tbody>';
            records.forEach(function(r) {
                var resultText = r.failed_count > 0
                    ? '<span style="color:var(--danger);">' + r.sent_count + '/' + r.total_recipients + '（失败' + r.failed_count + '）</span>'
                    : '<span style="color:var(--success);">✅ ' + r.sent_count + '/' + r.total_recipients + '</span>';
                var detailList = extractRecipientsFromRecord(r);
                var emailCol, recipientCol;
                if (!detailList.length) {
                    var totalN = r.total_recipients || 0;
                    emailCol = '<span style="color:var(--text-muted);">共 ' + totalN + ' 人</span>';
                    recipientCol = '<span style="color:var(--text-muted);">共 ' + totalN + ' 人</span>';
                } else {
                    var e1 = formatRecipientsList(detailList, 'email', allUsersMap);
                    var n1 = formatRecipientsList(detailList, 'name', allUsersMap);
                    emailCol = '<span title="' + escapeHtml(e1.title) + '" style="display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;">' + escapeHtml(e1.display) + '</span>';
                    recipientCol = '<span title="' + escapeHtml(n1.title) + '" style="display:inline-block;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;">' + escapeHtml(n1.display) + '</span>';
                }
                h += '<tr style="border-bottom:1px solid var(--border);">';
                h += '<td style="padding:6px 8px;white-space:nowrap;">' + formatTime(r.sent_at) + '</td>';
                h += '<td style="padding:6px 8px;">' + emailCol + '</td>';
                h += '<td style="padding:6px 8px;">' + recipientCol + '</td>';
                h += '<td style="padding:6px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(r.subject || '') + '">' + escapeHtml(r.subject || '') + '</td>';
                h += '<td style="padding:6px 8px;">' + resultText + '</td>';
                h += '</tr>';
            });
            h += '</tbody></table></div>';
            wrap.innerHTML = h;
        } catch(e) {
            wrap.innerHTML = '<div class="empty">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    };

    // 兼容保留：emailToggleDetail 不再从邮件发送记录表格调用
    window.emailToggleDetail = function(idx) {
        var el = document.getElementById('emailDetail_' + idx);
        if (!el) return;
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
    };

    var EMAIL_SUFFIXES = ['@qq.com','@163.com','@gmail.com','@outlook.com','@hotmail.com','@icloud.com','@foxmail.com','@126.com','@sina.com'];

    window.emailUpdateSuffixes = function() {
      var inp = document.getElementById('emailManualInp');
      var list = document.getElementById('emailSuffixList');
      if (!inp || !list) return;
      var val = inp.value.trim();
      var atIdx = val.indexOf('@');
      var prefix = atIdx >= 0 ? val.substring(0, atIdx) : val;
      var partialDomain = atIdx >= 0 ? val.substring(atIdx).toLowerCase() : '';
      if (!prefix) { list.innerHTML = ''; return; }
      var suggestions = [];
      EMAIL_SUFFIXES.forEach(function(suf) {
        var full = prefix + suf;
        if (!partialDomain || suf.indexOf(partialDomain) === 0) {
          suggestions.push({ display: full, full: full });
        }
      });
      if (!suggestions.length) { list.innerHTML = ''; return; }
      var h = '';
      suggestions.forEach(function(s) {
        h += '<span class="email-suffix-item" onclick="emailSelectSuggestion(\'' + s.full.replace(/'/g,"\\'") + '\')" style="cursor:pointer;padding:3px 8px;background:rgba(47,109,246,0.08);border:1px solid rgba(47,109,246,0.15);border-radius:6px;font-size:12px;">' + escapeHtml(s.display) + '</span>';
      });
      list.innerHTML = h;
    };

    window.emailSelectSuggestion = function(email) {
      var inp = document.getElementById('emailManualInp');
      if (!inp) return;
      inp.value = email;
      var list = document.getElementById('emailSuffixList');
      if (list) list.innerHTML = '';
      emailAddManual();
    };

    window.setupEmailAutoComplete = function() {
      var inp = document.getElementById('emailManualInp');
      if (inp) {
        inp.addEventListener('input', window.emailUpdateSuffixes);
      }
    };

    window.loadEmailRecipientHistory = async function() {
      var wrap = document.getElementById('emailRecipientHistory');
      if (!wrap) return;
      try {
        var data = await apiCall('GET', '/admin/email-recipient-history?limit=100');
        var recipients = data.recipients || [];
        if (!recipients.length) {
          wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">暂无历史邮箱</span>';
          return;
        }
        var h = '';
        recipients.forEach(function(r) {
          var displayName = (r.user_name && r.user_name !== r.email) ? r.user_name : '';
          var label = displayName ? (displayName + ' <' + r.email + '>') : r.email;
          var escapedEmail = r.email.replace(/'/g,"\\'");
          var escapedLabel = label.replace(/'/g, "\\'");
          h += '<span class="email-manual-tag" data-email="' + escapeHtml(r.email) + '" title="' + escapeHtml(r.email) + '" onclick="emailAddFromHistory(\'' + safeJsStr(r.email) + '\')" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(47,109,246,0.1);border:1px solid rgba(47,109,246,0.2);border-radius:6px;font-size:11px;">' + escapeHtml(label) + ' <span class="email-history-remove" onclick="event.stopPropagation();emailConfirmDeleteRecipientHistory(\'' + safeJsStr(r.email) + '\',\'' + safeJsStr(label) + '\')" style="cursor:pointer;opacity:0.55;font-size:14px;line-height:1;padding:0 2px;border-radius:999px;" title="删除此历史邮箱">×</span></span>';
        });
        wrap.innerHTML = h;
      } catch(e) {
        wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">加载失败</span>';
      }
    };

    window.emailAddFromHistory = function(email) {
      emailAddManualFromString(email);
    };

    window.emailAddManualFromString = function(email) {
      var list = document.getElementById('emailManualList');
      if (!list) return;
      var existing = list.querySelectorAll('.email-manual-tag');
      var dup = false;
      existing.forEach(function(tag) {
        if (tag.dataset.email === email) dup = true;
      });
      if (dup) { showToast('该邮箱已在列表中'); return; }
      var tag = document.createElement('span');
      tag.className = 'email-manual-tag';
      tag.dataset.email = email;
      tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(47,109,246,0.1);border:1px solid rgba(47,109,246,0.2);border-radius:6px;font-size:11px;';
      tag.innerHTML = email + ' <span onclick="emailRemoveManual(this)" style="cursor:pointer;opacity:0.5;font-size:14px;line-height:1;">×</span>';
      list.appendChild(tag);
      emailUpdateCount();
    };

    // 二次确认：删除单个历史邮箱
    // 优先使用项目内的 showConfirm 模态框；不可用时降级为 window.confirm
    window.emailConfirmDeleteRecipientHistory = function(email, label) {
      var display = label || email || '';
      var msg = '确定要从历史邮箱账户中删除「' + display + '」吗？\n\n删除后不会影响已经发送过的邮件记录。';
      if (typeof window.showConfirm === 'function') {
        window.showConfirm('删除历史邮箱', msg, '确认删除', function() {
          emailDeleteRecipientHistory(email);
        });
      } else if (typeof confirm === 'function') {
        if (confirm(msg)) emailDeleteRecipientHistory(email);
      } else {
        // 极端降级：直接删除
        emailDeleteRecipientHistory(email);
      }
    };

    window.emailDeleteRecipientHistory = async function(email) {
      try {
        await apiCall('POST', '/admin/email-recipient-history/delete', { email: email });
        loadEmailRecipientHistory();
      } catch(e) {
        showToast('删除失败: ' + e.message, 'error');
      }
    };

    window.emailClearRecipientHistory = async function() {
      if (!confirm('确定清空所有历史邮箱账户？')) return;
      try {
        await apiCall('POST', '/admin/email-recipient-history/clear', {});
        loadEmailRecipientHistory();
        showToast('已清空');
      } catch(e) {
        showToast('清空失败: ' + e.message, 'error');
      }
    };

    // ===================== AI 管理 Tab =====================
    var _aiAdminSubTab = 'settings'; // 'settings' | 'users'
    var _aiAdminConvUser = null;
    var _aiAdminConvId = null;

    function renderAiTab(el) {
        if (!el) return;
        el.innerHTML = [
            '<div class="ai-admin-tabs">',
            '<button class="ai-admin-tab' + (_aiAdminSubTab === 'settings' ? ' active' : '') + '" id="aiSubTabSettingsBtn" onclick="window._switchAiAdminSubTab(\'settings\')">智能体设置</button>',
            '<button class="ai-admin-tab' + (_aiAdminSubTab === 'users' ? ' active' : '') + '" id="aiSubTabUsersBtn" onclick="window._switchAiAdminSubTab(\'users\')">用户对话记录</button>',
            '</div>',
            '<div id="aiAdminContent"></div>'
        ].join('');

        if (!window._switchAiAdminSubTab) {
            window._switchAiAdminSubTab = function(sub) {
                _aiAdminSubTab = sub;
                _aiAdminConvUser = null;
                _aiAdminConvId = null;
                var settingsBtn = document.getElementById('aiSubTabSettingsBtn');
                var usersBtn = document.getElementById('aiSubTabUsersBtn');
                if (settingsBtn) settingsBtn.className = 'ai-admin-tab' + (sub === 'settings' ? ' active' : '');
                if (usersBtn) usersBtn.className = 'ai-admin-tab' + (sub === 'users' ? ' active' : '');
                renderAiAdminContent();
            };
        }

        window._switchAiAdminSubTab(_aiAdminSubTab);
    }

    function renderAiAdminContent() {
        var content = document.getElementById('aiAdminContent');
        if (!content) return;
        if (_aiAdminSubTab === 'settings') {
            renderAiAdminSettings(content);
        } else if (_aiAdminSubTab === 'users') {
            if (_aiAdminConvId && _aiAdminConvUser) {
                renderAiAdminConvDetail(content);
            } else if (_aiAdminConvUser) {
                renderAiAdminUserConvs(content);
            } else {
                renderAiAdminUsageSummary(content);
            }
        }
    }

    function getCfgVal(cfg, path, def) {
        var parts = path.split('.');
        var cur = cfg;
        for (var i = 0; i < parts.length; i++) {
            if (cur == null || typeof cur !== 'object') return def;
            cur = cur[parts[i]];
        }
        return cur !== undefined && cur !== null ? cur : def;
    }

    function selOpts(selected, options) {
        var html = '';
        for (var i = 0; i < options.length; i++) {
            html += '<option value="' + options[i].val + '"' + (selected === options[i].val ? ' selected' : '') + '>' + options[i].label + '</option>';
        }
        return html;
    }

    async function renderAiAdminSettings(content) {
        if (!content) return;
        content.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';
        try {
            var data = await apiCall('GET', '/admin/ai-agent/config');
            var cfg = data && data.config ? data.config : {
                name: '徐旭泽的小猫', avatar: '🐱', description: '', persona: '',
                tone: '', system_prompt: '', welcome_message: ''
            };
            var rs = cfg.reply_style || {};
            var rp = cfg.roleplay || {};
            var or = cfg.output_rules || {};
            var sc = cfg.search || {};
            var mdl = cfg.model || {};
            var dt = cfg.deep_think || {};  // ★ P 新增: 深度思考子配置
            var sec = cfg.security || {};
            var dbg = cfg.admin_debug || {};

            var html = [
                '<div class="ai-admin-settings">',

                // ---- 模块1: 基础信息 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">基础信息</h4>',
                '<div class="form-group"><label>AI 名称</label><input id="aiCfgName" value="' + escapeHtml(cfg.name) + '" maxlength="30" /></div>',
                '<div class="form-group"><label>头像图片</label>',
                '<div style="display:flex;align-items:center;gap:12px;">',
                '<div id="aiAvatarPreview" style="width:60px;height:60px;border-radius:50%;overflow:hidden;background:#f0f8ef;display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">',
                (cfg.avatar_url ? '<img src="' + escapeHtml(cfg.avatar_url) + '?v=' + (cfg.avatar_version || 0) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentElement.textContent=\'' + escapeHtml(cfg.avatar || '🐱') + '\'">' : escapeHtml(cfg.avatar || '🐱')),
                '</div>',
                '<input type="file" id="aiAvatarFileInput" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />',
                '<button class="btn" id="aiAvatarUploadBtn" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:transparent;">选择图片</button>',
                '<span id="aiAvatarStatus" style="font-size:12px;color:var(--text-muted)"></span>',
                '</div>',
                '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">支持 png/jpg/webp/gif，最大 5MB。上传后保存配置才会生效。</div>',
                '</div>',
                '<div class="form-group"><label>头像文字（如 🐱）</label><input id="aiCfgAvatar" value="' + escapeHtml(cfg.avatar) + '" maxlength="10" /></div>',
                '<div class="form-group"><label>简介 description</label><input id="aiCfgDesc" value="' + escapeHtml(cfg.description || '') + '" maxlength="200" /></div>',
                '<div class="form-group"><label>欢迎语 welcome_message</label><input id="aiCfgWelcome" value="' + escapeHtml(cfg.welcome_message || '') + '" maxlength="200" /></div>',
                '</div>',

                // ---- 模块2: 人设与语气 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">人设与语气</h4>',
                '<div class="form-group"><label>性格设定 persona（最多 500 字）</label><textarea id="aiCfgPersona" maxlength="500">' + escapeHtml(cfg.persona || '') + '</textarea></div>',
                '<div class="form-group"><label>说话风格 tone（最多 200 字）</label><input id="aiCfgTone" value="' + escapeHtml(cfg.tone || '') + '" maxlength="200" /></div>',
                '<div class="form-group"><label>回复直接程度</label><select id="styleDirectness">' + selOpts(rs.directness, [{val:'direct',label:'直接'},{val:'gentle',label:'委婉'},{val:'balanced',label:'适中'}]) + '</select></div>',
                '<div class="form-group"><label>详细程度</label><select id="styleDetail">' + selOpts(rs.detail_level, [{val:'brief',label:'简洁'},{val:'medium',label:'适中'},{val:'detailed',label:'详细'}]) + '</select></div>',
                '<div class="form-group"><label>幽默程度</label><select id="styleHumor">' + selOpts(rs.humor_level, [{val:'low',label:'低'},{val:'medium',label:'中'},{val:'high',label:'高'}]) + '</select></div>',
                '<div class="form-group"><label>毒舌程度</label><select id="styleSarcasm">' + selOpts(rs.sarcasm_level, [{val:'low',label:'低'},{val:'medium',label:'中'},{val:'high',label:'高'}]) + '</select></div>',
                '<div class="form-group"><label>温暖程度</label><select id="styleWarmth">' + selOpts(rs.warmth_level, [{val:'low',label:'低'},{val:'medium',label:'中'},{val:'high',label:'高'}]) + '</select></div>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="styleMarkdown"' + (rs.use_markdown ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 使用 Markdown</label>',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="styleEmoji"' + (rs.use_emoji ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 使用 emoji</label>',
                '</div>',
                '<div class="form-group"><label>最大回复字数</label><input type="number" id="styleMaxChars" value="' + (rs.max_reply_chars || 1200) + '" min="100" max="8000" /></div>',
                '</div>',

                // ---- 模块3: 最终回复规则 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">最终回复规则</h4>',
                '<div class="form-group"><label>【必须遵守】（每行一条）</label><textarea id="orMust" style="min-height:60px;">' + escapeHtml((or.must || []).join('\n')) + '</textarea></div>',
                '<div class="form-group"><label>【禁止】（每行一条）</label><textarea id="orAvoid" style="min-height:60px;">' + escapeHtml((or.avoid || []).join('\n')) + '</textarea></div>',
                '<div class="form-group"><label>【格式要求】（每行一条）</label><textarea id="orFormat" style="min-height:60px;">' + escapeHtml((or.format || []).join('\n')) + '</textarea></div>',
                '</div>',

                // ---- 模块4: 角色扮演控制 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">角色扮演控制</h4>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="rpEnabled"' + (getCfgVal(cfg,'roleplay.enabled') ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 允许角色扮演</label>',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="rpStage"' + (getCfgVal(cfg,'roleplay.allow_stage_directions') ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 允许括号动作</label>',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="rpCat"' + (getCfgVal(cfg,'roleplay.allow_cat_actions') ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 允许猫咪动作</label>',
                '</div>',
                '<div class="form-group"><label>禁止动作关键词（逗号分隔）</label><input id="rpPatterns" value="' + escapeHtml((rp.forbidden_action_patterns || []).join(',')) + '" placeholder="例如: 摇尾巴,蹭蹭" /></div>',
                '</div>',

                // ---- 模块5: 联网搜索 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">联网搜索</h4>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="searchEnabled"' + (getCfgVal(cfg,'search.allow_web_search') || cfg.allow_web_search ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 开启联网搜索</label>',
                '</div>',
                '<div style="font-size:11px;color:#c44;margin:4px 0 8px 0;line-height:1.4;padding:6px 8px;background:rgba(204,68,68,0.08);border-radius:4px;"><strong>⚠ 注意：</strong>如未在 Render 环境变量中配置 <code>TAVILY_API_KEY</code>、<code>BRAVE_SEARCH_API_KEY</code> 或 <code>SERPER_API_KEY</code>，将使用公共 SearXNG / Bing HTML 作为兜底，可能因网络限制而搜索失败。</div>',
                '<div class="form-group"><label>搜索提供商</label><input id="searchProvider" value="' + escapeHtml(sc.search_provider || 'searxng') + '" placeholder="searxng" /></div>',
                '<div class="form-group"><label>最大结果数</label><input type="number" id="searchMaxResults" value="' + (sc.max_results || 5) + '" min="1" max="20" /></div>',
                '<div class="form-group"><label>搜索超时(ms)</label><input type="number" id="searchTimeout" value="' + (sc.timeout_ms || 4000) + '" min="1000" max="30000" step="500" /></div>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="searchWeather"' + (sc.use_weather_tool ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 开启天气工具</label>',
                '</div>',
                '<div style="margin:8px 0;"><button onclick="checkSearchHealth()" style="font-size:12px;padding:4px 10px;border:1px solid var(--border,rgba(140,196,158,0.3));border-radius:4px;background:transparent;cursor:pointer;">检查搜索健康状态</button> <span id="searchHealthResult" style="font-size:11px;color:#888;"></span></div>',
                '</div>',

                // ---- 模块7: 模型与思考模式 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">模型与思考模式</h4>',
                '<div class="form-group"><label>reasoner 模型名</label><input id="modelReasoner" value="' + escapeHtml(mdl.reasoner_model || '') + '" placeholder="例如: deepseek-reasoner" /></div>',
                '<div class="form-group"><label>默认思考模式</label><select id="modelThinkingMode">' + selOpts(mdl.default_thinking_mode, [{val:'off',label:'关闭'},{val:'low',label:'低'},{val:'medium',label:'中'},{val:'high',label:'高'},{val:'max',label:'极高 (max)'}]) + '</select></div>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="modelMultiAgent"' + (mdl.multi_agent ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 多Agent协作（拆解问题→多关键词并行搜索→合成回答，思考/非思考模式均可）</label>',
                '</div>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="modelUserSwitch"' + (mdl.allow_user_thinking_switch ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 允许用户切换（已禁用，由后台统一控制）</label>',
                '</div>',
                '</div>',

                // ★ P 新增: 模块7.5: 深度思考模式 (Deep Think)
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">深度思考模式 (Deep Think)</h4>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="dtEnabled"' + (dt.enabled !== false ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 启用深度思考模式</label>',
                '</div>',
                '<div class="form-group"><label>默认思考程度</label><select id="dtThinkingMode">' + selOpts(dt.default_thinking_mode, [{val:'low',label:'低'},{val:'medium',label:'中'},{val:'high',label:'高'},{val:'max',label:'极高 (max)'}]) + '</select></div>',

                '<h5 style="font-size:12px;font-weight:600;margin:12px 0 6px 0;color:var(--text-muted);">多智能体参数 (max 模式)</h5>',
                '<div class="form-group"><label>最大并行 agent 数</label><input type="number" id="dtMaxWorkers" value="' + (dt.max_workers || 6) + '" min="1" max="10" /></div>',
                '<div class="form-group"><label>最小 agent 数 (0=允许直接回答)</label><input type="number" id="dtMinWorkers" value="' + (dt.min_workers || 0) + '" min="0" max="5" /></div>',
                '<div class="form-group"><label>强制拆分最小字数 (超过则强制拆 agent)</label><input type="number" id="dtForceSplitLen" value="' + (dt.force_split_min_length || 24) + '" min="10" max="200" /></div>',
                '<div class="form-group"><label>Worker 最大工具轮数</label><input type="number" id="dtWorkerToolRounds" value="' + (dt.worker_max_tool_rounds || 5) + '" min="1" max="10" /></div>',

                '<h5 style="font-size:12px;font-weight:600;margin:12px 0 6px 0;color:var(--text-muted);">单智能体参数 (low/medium/high 模式)</h5>',
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">',
                '<div><label style="font-size:11px;">low 最大 token</label><input type="number" id="dtLowTokens" value="' + (dt.low_max_tokens || 4096) + '" min="512" max="32768" style="width:100%;" /></div>',
                '<div><label style="font-size:11px;">medium 最大 token</label><input type="number" id="dtMedTokens" value="' + (dt.medium_max_tokens || 16384) + '" min="512" max="65536" style="width:100%;" /></div>',
                '<div><label style="font-size:11px;">high 最大 token</label><input type="number" id="dtHighTokens" value="' + (dt.high_max_tokens || 32768) + '" min="512" max="65536" style="width:100%;" /></div>',
                '<div><label style="font-size:11px;">low 工具轮数</label><input type="number" id="dtLowToolRounds" value="' + (dt.low_max_tool_rounds || 0) + '" min="0" max="3" style="width:100%;" /></div>',
                '<div><label style="font-size:11px;">medium 工具轮数</label><input type="number" id="dtMedToolRounds" value="' + (dt.medium_max_tool_rounds || 2) + '" min="0" max="5" style="width:100%;" /></div>',
                '<div><label style="font-size:11px;">high 工具轮数</label><input type="number" id="dtHighToolRounds" value="' + (dt.high_max_tool_rounds || 4) + '" min="0" max="8" style="width:100%;" /></div>',
                '</div>',

                '<div style="font-size:11px;color:#888;margin:4px 0;line-height:1.5;padding:6px 8px;background:rgba(46,148,101,0.06);border-radius:4px;">',
                '<strong>📌 深度思考说明:</strong><br>',
                '• max 模式 = Planner 拆解 + Worker 并行 + Synthesizer 整合 (多智能体)<br>',
                '• high/medium/low = 单智能体自行决定是否搜索 (参数区别见上)<br>',
                '• 景点/地点/旅游类问题会自动触发搜索获取最新信息<br>',
                '• 聊天记录 30 天后彻底删除，不可恢复',
                '</div>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="dtRequireHistory"' + (dt.require_history_injection !== false ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 注入历史对话上下文</label>',
                '</div>',
                '</div>',

                // ---- 模块8: 安全 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">安全规则</h4>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="secHidePrompt"' + (sec.hide_system_prompt_in_reasoning !== false ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 禁止在AI思考过程中复述系统提示词（防止深度思考模式泄露配置规则）</label>',
                '</div>',
                '</div>',

                // ---- 模块9: 管理员调试 ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">管理员调试</h4>',
                '<div class="form-group" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="debugPrompt"' + (dbg.show_effective_prompt ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 显示当前生效 prompt</label>',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="debugModelInfo"' + (dbg.show_model_info ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 显示模型信息</label>',
                '<label style="display:flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;"><input type="checkbox" id="debugReasonLen"' + (dbg.show_reasoning_length ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--primary,#2E9465);" /> 显示 reasoning_length</label>',
                '</div>',
                '</div>',

                // ---- 模块9: system_prompt（保留旧字段） ----
                '<div class="ai-settings-section">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">系统提示词</h4>',
                '<div class="form-group"><label>system_prompt（最多 2000 字）</label><textarea id="aiCfgSysPrompt" maxlength="2000" style="min-height:120px;">' + escapeHtml(cfg.system_prompt || '') + '</textarea></div>',
                '</div>',

                // ---- 模块10: 保存按钮 ----
                '<button class="save-btn" id="aiCfgSaveBtn">保存配置</button>',

                // ---- 模块11: 当前生效 Prompt 预览 ----
                '<div class="ai-settings-section" style="margin-top:20px;">',
                '<h4 style="font-size:14px;font-weight:700;margin:16px 0 10px 0;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(140,196,158,0.25));">当前生效 Prompt 预览</h4>',
                '<div id="aiEffectivePrompt">',
                '<button id="aiLoadEffectiveBtn" class="save-btn" style="background:transparent;color:var(--primary);">查看当前生效 Prompt</button>',
                '<pre id="aiEffectivePromptContent" style="display:none;white-space:pre-wrap;font-size:12px;background:#f5f5f5;padding:8px;border-radius:4px;max-height:400px;overflow-y:auto;"></pre>',
                '</div>',
                '</div>',



                '</div>'
            ].join('\n');
            content.innerHTML = html;

            // 头像上传
            var uploadBtn = document.getElementById('aiAvatarUploadBtn');
            var fileInput = document.getElementById('aiAvatarFileInput');
            var statusEl = document.getElementById('aiAvatarStatus');
            var previewEl = document.getElementById('aiAvatarPreview');
            if (uploadBtn && fileInput) {
                uploadBtn.addEventListener('click', function() { fileInput.click(); });
                fileInput.addEventListener('change', async function() {
                    var file = fileInput.files && fileInput.files[0];
                    if (!file) return;
                    if (!file.type.match(/^image\/(png|jpeg|webp|gif)$/)) {
                        if (statusEl) statusEl.textContent = '只支持 png/jpg/webp/gif';
                        return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                        if (statusEl) statusEl.textContent = '图片不能超过 5MB';
                        return;
                    }
                    if (statusEl) statusEl.textContent = '上传中...';
                    try {
                        var adminToken = getToken();
                        var reader = new FileReader();
                        var ext = (file.name.split('.').pop() || 'png').toLowerCase();
                        var base64Data = await new Promise(function(resolve, reject) {
                            reader.onload = function() { resolve(reader.result); };
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        var resp = await fetch(API_BASE + '/admin/ai-agent/avatar', {
                            method: 'POST',
                            headers: adminToken ? {
                                'Authorization': 'Bearer ' + adminToken,
                                'Content-Type': 'application/json'
                            } : { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ image: base64Data, ext: ext })
                        });
                        var result = await resp.json().catch(function() { return {}; });
                        if (result && result.ok && result.avatar_url) {
                            if (previewEl) previewEl.innerHTML = '<img src="' + escapeHtml(result.avatar_url) + '?v=' + (result.avatar_version || 0) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentElement.textContent=\'🐱\'">';
                            if (statusEl) statusEl.textContent = '上传成功，记得保存配置';
                            showToast('头像上传成功，请点击保存配置');
                        } else {
                            if (statusEl) statusEl.textContent = '上传失败: ' + (result && result.error ? result.error : '未知错误');
                        }
                    } catch(e) {
                        if (statusEl) statusEl.textContent = '上传异常';
                        showToast('头像上传失败', 'error');
                    }
                });
            }

            // 保存按钮
            var saveBtn = document.getElementById('aiCfgSaveBtn');
            if (saveBtn) {
                saveBtn.addEventListener('click', async function() {
                    saveBtn.textContent = '保存中...';
                    saveBtn.disabled = true;
                    try {
                        var configPayload = {
                            name: document.getElementById('aiCfgName').value.trim(),
                            description: document.getElementById('aiCfgDesc').value.trim(),
                            welcome_message: document.getElementById('aiCfgWelcome').value.trim(),
                            persona: document.getElementById('aiCfgPersona').value.trim(),
                            tone: document.getElementById('aiCfgTone').value.trim(),
                            system_prompt: document.getElementById('aiCfgSysPrompt').value.trim(),
                            avatar: document.getElementById('aiCfgAvatar').value.trim(),
                            reply_style: {
                                directness: document.getElementById('styleDirectness').value,
                                detail_level: document.getElementById('styleDetail').value,
                                humor_level: document.getElementById('styleHumor').value,
                                sarcasm_level: document.getElementById('styleSarcasm').value,
                                warmth_level: document.getElementById('styleWarmth').value,
                                use_markdown: document.getElementById('styleMarkdown').checked,
                                use_emoji: document.getElementById('styleEmoji').checked,
                                max_reply_chars: parseInt(document.getElementById('styleMaxChars').value) || 1200
                            },
                            roleplay: {
                                enabled: document.getElementById('rpEnabled').checked,
                                allow_stage_directions: document.getElementById('rpStage').checked,
                                allow_cat_actions: document.getElementById('rpCat').checked,
                                forbidden_action_patterns: document.getElementById('rpPatterns').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
                            },
                            output_rules: {
                                must: document.getElementById('orMust').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean),
                                avoid: document.getElementById('orAvoid').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean),
                                format: document.getElementById('orFormat').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean)
                            },
                            search: {
                                allow_web_search: document.getElementById('searchEnabled').checked,
                                search_provider: document.getElementById('searchProvider').value.trim() || 'searxng',
                                max_results: parseInt(document.getElementById('searchMaxResults').value) || 5,
                                timeout_ms: parseInt(document.getElementById('searchTimeout').value) || 4000,
                                use_weather_tool: document.getElementById('searchWeather').checked
                            },

                            model: {
                                reasoner_model: document.getElementById('modelReasoner').value.trim(),
                                default_thinking_mode: document.getElementById('modelThinkingMode').value,
                                allow_user_thinking_switch: document.getElementById('modelUserSwitch').checked,
                                multi_agent: document.getElementById('modelMultiAgent').checked
                            },
                            // ★ P 新增: 深度思考子配置
                            deep_think: {
                                enabled: document.getElementById('dtEnabled').checked,
                                default_thinking_mode: document.getElementById('dtThinkingMode').value,
                                max_workers: parseInt(document.getElementById('dtMaxWorkers').value) || 6,
                                min_workers: parseInt(document.getElementById('dtMinWorkers').value) || 0,
                                force_split_min_length: parseInt(document.getElementById('dtForceSplitLen').value) || 24,
                                worker_max_tool_rounds: parseInt(document.getElementById('dtWorkerToolRounds').value) || 5,
                                low_max_tokens: parseInt(document.getElementById('dtLowTokens').value) || 4096,
                                medium_max_tokens: parseInt(document.getElementById('dtMedTokens').value) || 16384,
                                high_max_tokens: parseInt(document.getElementById('dtHighTokens').value) || 32768,
                                low_max_tool_rounds: parseInt(document.getElementById('dtLowToolRounds').value) || 0,
                                medium_max_tool_rounds: parseInt(document.getElementById('dtMedToolRounds').value) || 2,
                                high_max_tool_rounds: parseInt(document.getElementById('dtHighToolRounds').value) || 4,
                                require_history_injection: document.getElementById('dtRequireHistory').checked
                            },
                            security: {
                                hide_system_prompt_in_reasoning: document.getElementById('secHidePrompt').checked
                            },
                            admin_debug: {
                                show_effective_prompt: document.getElementById('debugPrompt').checked,
                                show_model_info: document.getElementById('debugModelInfo').checked,
                                show_reasoning_length: document.getElementById('debugReasonLen').checked
                            }
                        };
                        if (!configPayload.name || configPayload.name.length > 30) { showToast('名称不能为空且不超过30字'); saveBtn.textContent = '保存配置'; saveBtn.disabled = false; return; }
                        if (configPayload.description.length > 200) { showToast('描述不超过200字'); saveBtn.textContent = '保存配置'; saveBtn.disabled = false; return; }
                        if (configPayload.welcome_message.length > 200) { showToast('欢迎语不超过200字'); saveBtn.textContent = '保存配置'; saveBtn.disabled = false; return; }
                        if (configPayload.persona.length > 500) { showToast('人设不超过500字'); saveBtn.textContent = '保存配置'; saveBtn.disabled = false; return; }
                        if (configPayload.system_prompt.length > 2000) { showToast('系统提示词不超过2000字'); saveBtn.textContent = '保存配置'; saveBtn.disabled = false; return; }
                        if (!configPayload.model.reasoner_model) { showToast('请填写模型名称'); saveBtn.textContent = '保存配置'; saveBtn.disabled = false; return; }
                        configPayload.allow_web_search = configPayload.search.allow_web_search;
                        var r = await apiCall('POST', '/admin/ai-agent/config', configPayload);
                        if (r && r.ok) {
                            showToast('配置已保存，用户端刷新后生效');
                        } else {
                            showToast('保存失败');
                        }
                    } catch(e) {
                        showToast('保存异常: ' + (e && e.message ? e.message : ''), 'error');
                    } finally {
                        saveBtn.textContent = '保存配置';
                        saveBtn.disabled = false;
                    }
                });
            }

            // 检查搜索健康状态
            var _searchHealthChecking = false;
            function checkSearchHealth() {
                if (_searchHealthChecking) return;
                _searchHealthChecking = true;
                var resultEl = document.getElementById('searchHealthResult');
                if (!resultEl) { _searchHealthChecking = false; return; }
                resultEl.textContent = '检查中...';
                fetch((window.API_BASE || '') + '/api/agent/search-health?q=测试搜索健康')
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (!data || data.ok === false) {
                            resultEl.textContent = '搜索异常: ' + (data && data.error || '无有效结果');
                            return;
                        }
                        var done = data.diagnostics || {};
                        var parts = [];
                        var envs = done.env_status || {};
                        var hasStable = envs.TAVILY_API_KEY || envs.BRAVE_SEARCH_API_KEY || envs.SERPER_API_KEY;
                        if (hasStable) {
                            parts.push('已配置稳定 API');
                        } else {
                            parts.push('无稳定 API');
                        }
                        if (done.enabled_providers && done.enabled_providers.length) {
                            parts.push('可用: ' + done.enabled_providers.join(','));
                        } else {
                            parts.push('无可用的搜索提供商');
                        }
                        if (done.provider_errors && done.provider_errors.length) {
                            parts.push('失败: ' + done.provider_errors.map(function(p) { return p.provider + '(' + (p.error || '').slice(0, 40) + ')'; }).join(','));
                        }
                        if (done.missing_env && done.missing_env.length) {
                            parts.push('缺少: ' + done.missing_env.join(','));
                        }
                        if (data.used_provider) {
                            parts.push('当前使用: ' + data.used_provider);
                        }
                        resultEl.textContent = parts.join(' | ');
                    })
                    .catch(function(e) {
                        resultEl.textContent = '检查失败: ' + (e && e.message || '网络错误');
                    })
                    .finally(function() { _searchHealthChecking = false; });
            }
            // 暴露到全局
            window.checkSearchHealth = checkSearchHealth;

            // 查看当前生效 Prompt
            var loadEffectiveBtn = document.getElementById('aiLoadEffectiveBtn');
            var effectiveContent = document.getElementById('aiEffectivePromptContent');
            if (loadEffectiveBtn && effectiveContent) {
                loadEffectiveBtn.addEventListener('click', async function() {
                    if (effectiveContent.style.display !== 'none') {
                        effectiveContent.style.display = 'none';
                        loadEffectiveBtn.textContent = '查看当前生效 Prompt';
                        return;
                    }
                    try {
                        var r = await apiCall('GET', '/admin/ai-agent/effective-prompt');
                        if (r && r.core_prompt) {
                            effectiveContent.textContent = r.core_prompt;
                            effectiveContent.style.display = 'block';
                            loadEffectiveBtn.textContent = '收起';
                        } else {
                            showToast('无法获取生效 prompt');
                        }
                    } catch (e) {
                        showToast('获取失败: ' + (e && e.message ? e.message : ''), 'error');
                    }
                });
            }

        } catch(e) {
            content.innerHTML = '<div style="text-align:center;padding:20px;color:red">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    async function renderAiAdminUsageSummary(content) {
        if (!content) return;
        content.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';
        try {
            // 加载统计 + 用户列表
            var [summaryData, usersData] = await Promise.all([
                apiCall('GET', '/admin/ai-agent/usage-summary').catch(function() { return null; }),
                apiCall('GET', '/admin/ai-agent/users').catch(function() { return null; })
            ]);
            var summary = summaryData && summaryData.summary ? summaryData.summary : null;
            var users = usersData && usersData.users ? usersData.users : [];

            var html = [];

            // 统计卡片
            if (summary) {
                html.push('<div class="ai-usage-cards">');
                html.push('<div class="ai-usage-card"><div class="lbl">今日调用</div><div class="val">' + summary.today_calls + '</div></div>');
                html.push('<div class="ai-usage-card"><div class="lbl">今日 Token</div><div class="val">' + (summary.today_total_tokens || 0).toLocaleString() + '</div></div>');
                html.push('<div class="ai-usage-card"><div class="lbl">今日费用</div><div class="val">¥' + (summary.today_cost || 0).toFixed(6) + '</div><div class="sub">' + (summary.currency || 'CNY') + '</div></div>');
                html.push('<div class="ai-usage-card"><div class="lbl">累计调用</div><div class="val">' + (summary.total_calls || 0).toLocaleString() + '</div></div>');
                html.push('<div class="ai-usage-card"><div class="lbl">累计 Token</div><div class="val">' + (summary.total_tokens || 0).toLocaleString() + '</div></div>');
                html.push('<div class="ai-usage-card"><div class="lbl">累计费用</div><div class="val">¥' + (summary.total_cost || 0).toFixed(6) + '</div><div class="sub">用户 ' + (summary.total_users || 0) + ' 人</div></div>');
                html.push('</div>');
            }

            // 用户列表
            if (!users.length) {
                html.push('<div style="text-align:center;padding:30px;color:var(--text-muted)">暂无用户 AI 聊天记录</div>');
            } else {
                html.push('<div class="ai-section-header">用户列表（' + users.length + ' 人）</div>');
                html.push('<ul class="ai-conv-users-list">');
                users.forEach(function(u) {
                    var lastAt = u.last_at ? new Date(u.last_at).toLocaleString() : '未知';
                    var safeName = escapeHtml(u.user_name);
                    html.push('<li data-user-name="' + safeName + '">');
                    html.push('<span class="user-name">' + safeName + '</span>');
                    var metaParts = [];
                    metaParts.push(u.message_count + ' 条');
                    if (u.conversation_count) metaParts.push(u.conversation_count + ' 会话');
                    if (u.total_tokens) metaParts.push((u.total_tokens || 0).toLocaleString() + ' tokens');
                    if (u.total_cost) metaParts.push('¥' + u.total_cost.toFixed(6));
                    metaParts.push(lastAt);
                    html.push('<span class="user-meta">' + metaParts.join(' · ') + '</span>');
                    html.push('</li>');
                });
                html.push('</ul>');
            }
            html.push('');

            content.innerHTML = html.join('\n');

            // 绑定点击
            content.querySelectorAll('.ai-conv-users-list li').forEach(function(li) {
                var un = li.dataset.userName;
                if (un) {
                    li.addEventListener('click', function() {
                        _aiAdminConvUser = un;
                        _aiAdminConvId = null;
                        renderAiAdminContent();
                    });
                }
            });
        } catch(e) {
            content.innerHTML = '<div style="text-align:center;padding:20px;color:red">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    async function renderAiAdminUserConvs(content) {
        if (!content || !_aiAdminConvUser) return;
        content.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';
        try {
            var data = await apiCall('GET', '/admin/ai-agent/conversations?user_name=' + encodeURIComponent(_aiAdminConvUser));
            var convs = data && data.conversations ? data.conversations : [];

            var html = [
                '<button class="ai-admin-back" onclick="window._backAiUserList()">← 返回用户列表</button>',
                '<div class="ai-conv-header"><h3>' + escapeHtml(_aiAdminConvUser) + ' 的会话</h3><div class="conv-stat-line">共 ' + convs.length + ' 个会话</div></div>'
            ];

            if (!convs.length) {
                html.push('<div style="text-align:center;padding:30px;color:var(--text-muted)">该用户暂无 AI 聊天记录</div>');
            } else {
                html.push('<div class="ai-conversation-list">');
                convs.forEach(function(c) {
                    var cid = escapeHtml(c.conversation_id);
                    var created = c.created_at ? new Date(c.created_at).toLocaleString() : '';
                    var lastAt = c.last_at ? new Date(c.last_at).toLocaleString() : '';
                    html.push('<div class="ai-conversation-item" data-conv-id="' + cid + '">');
                    html.push('<div><div class="conv-id">' + (c.conversation_id === 'legacy' ? '旧数据' : c.conversation_id.slice(0, 14)) + '</div>');
                    html.push('<div class="ai-conv-time">' + created + '</div></div>');
                    html.push('<div class="conv-stats">');
                    html.push('<span>' + c.message_count + ' 条</span>');
                    if (c.total_tokens) html.push('<span>' + (c.total_tokens || 0).toLocaleString() + ' tokens</span>');
                    if (c.total_cost) html.push('<span>¥' + (c.total_cost || 0).toFixed(6) + '</span>');
                    if (c.last_thinking_mode && c.last_thinking_mode !== 'off') html.push('<span>思考：' + escapeHtml(c.last_thinking_mode) + '</span>');
                    html.push('</div>');
                    html.push('</div>');
                });
                html.push('</div>');
            }

            content.innerHTML = html.join('\n');

            // 绑定点击
            content.querySelectorAll('.ai-conversation-item').forEach(function(item) {
                var cid = item.dataset.convId;
                if (cid) {
                    item.addEventListener('click', function() {
                        _aiAdminConvId = cid;
                        renderAiAdminContent();
                    });
                }
            });

            if (!window._backAiUserList) {
                window._backAiUserList = function() {
                    _aiAdminConvUser = null;
                    _aiAdminConvId = null;
                    renderAiAdminContent();
                };
            }
        } catch(e) {
            content.innerHTML = '<div style="text-align:center;padding:20px;color:red">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    async function renderAiAdminConvDetail(content) {
        if (!content || !_aiAdminConvUser || !_aiAdminConvId) return;
        content.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';
        try {
            var data = await apiCall('GET', '/admin/ai-agent/conversation?user_name=' + encodeURIComponent(_aiAdminConvUser) + '&conversation_id=' + encodeURIComponent(_aiAdminConvId));
            var msgs = data && data.messages ? data.messages : [];

            // 统计
            var totalTokens = 0, totalCost = 0;
            msgs.forEach(function(m) {
                if (m.role === 'assistant' && m.usage) {
                    totalTokens += m.usage.total_tokens || 0;
                    if (m.usage.cost) totalCost += m.usage.cost;
                }
            });

            var html = [
                '<button class="ai-admin-back" onclick="window._backAiConvList()">← 返回会话列表</button>',
                '<div class="ai-conv-header"><h3>' + escapeHtml(_aiAdminConvUser) + ' · ' + _aiAdminConvId.slice(0, 14) + '</h3><div class="conv-stat-line">' + msgs.length + ' 条消息 · ' + (totalTokens || 0).toLocaleString() + ' tokens · ¥' + totalCost.toFixed(6) + '</div></div>',
                '<div class="ai-conv-view">'
            ];

            msgs.forEach(function(m) {
                var role = m.role === 'assistant' ? 'assistant' : 'user';
                var label = role === 'assistant' ? 'AI' : escapeHtml(_aiAdminConvUser);
                var time = m.created_at ? new Date(m.created_at).toLocaleString() : '';
                html.push('<div class="msg-row ' + role + '">');
                html.push('<div class="msg-content-wrap">');
                // 思考过程（与前端一致的可折叠样式）
                if (m.reasoning) {
                    var rId = 'think_' + (m.id || Math.random().toString(36).slice(2, 8));
                    html.push('<div class="ai-thinking-admin" id="' + rId + '">');
                    html.push('<button type="button" class="ai-thinking-toggle-admin" onclick="var p=document.getElementById(\'' + rId + '\');p.classList.toggle(\'expanded\');" aria-expanded="false">');
                    html.push('<span class="ai-thinking-label-admin">思考</span>');
                    html.push('<span class="ai-thinking-caret-admin">▾</span>');
                    html.push('</button>');
                    html.push('<div class="ai-thinking-panel-admin">' + escapeHtml(m.reasoning) + '</div>');
                    html.push('</div>');
                }
                html.push('<div class="msg-bubble">' + escapeHtml(m.content || '') + '</div>');
                html.push('<div class="msg-role-label">' + label + ' · ' + time + '</div>');
                // token 信息
                if (m.role === 'assistant' && m.usage) {
                    html.push('<div class="ai-token-meta">');
                    if (m.usage.total_tokens) html.push('<span>输入 ' + m.usage.prompt_tokens + '</span><span>输出 ' + m.usage.completion_tokens + '</span><span>合计 ' + m.usage.total_tokens + '</span>');
                    if (m.usage.cost !== null && m.usage.cost !== undefined) html.push('<span>¥' + Number(m.usage.cost).toFixed(6) + '</span>');
                    if (m.usage.thinking_mode && m.usage.thinking_mode !== 'off') html.push('<span>思考：' + escapeHtml(m.usage.thinking_mode) + '</span>');
                    html.push('</div>');
                }
                html.push('</div></div>');
            });

            html.push('</div>');
            content.innerHTML = html.join('\n');

            if (!window._backAiConvList) {
                window._backAiConvList = function() {
                    _aiAdminConvId = null;
                    renderAiAdminContent();
                };
            }
        } catch(e) {
            content.innerHTML = '<div style="text-align:center;padding:20px;color:red">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }
})();
