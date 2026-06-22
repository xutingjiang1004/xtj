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
    // 移除 window.sb 避免其他代码意外使用
    if (window.sb) {
        delete window.sb;
    }

    // ===================== Token 管理（前后端共享，仅用于 API 鉴权） =====================
    var TOKEN_SALT = 'xtj_7k3m';

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
    async function adminHashPassword(password) {
        var saltBytes = crypto.getRandomValues(new Uint8Array(16));
        var salt = Array.from(saltBytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        var hash = await adminPbkdf2Hash(password, salt);
        return salt + ':' + hash;
    }

    // ===================== Session 超时管理（30分钟无操作自动登出） =====================
    var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分钟
    var lastActivityTime = Date.now();
    function resetActivityTimer() { lastActivityTime = Date.now(); }
    function startSessionTimeoutMonitor() {
        ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt) {
            document.addEventListener(evt, resetActivityTimer, { passive: true });
        });
        setInterval(function() {
            if (Date.now() - lastActivityTime > SESSION_TIMEOUT_MS) {
                console.warn('[admin] 会话超时，自动登出');
                window.doAdminLogout();
            }
        }, 30000); // 每30秒检查一次
    }

    var allPosts = [], allLikes = [], allComments = [], allUsers = [], annList = [], allLoginEvents = [], allSecurityAlerts = [], allAuditLogs = [], allErrorLogs = [];
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
        if (!API_BASE || !getToken()) return null;
        try {
            return await apiCall('GET', '/admin/users/register-alerts');
        } catch (e) {
            console.warn('[admin] 新用户注册提醒加载失败:', e.message);
            return null;
        }
    }

    async function markRegisterAlertsRead() {
        if (!API_BASE || !getToken() || registerAlertState.readInFlight) return false;
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
        refreshRegisterAlerts();
        registerAlertState.pollTimer = setInterval(function() {
            refreshRegisterAlerts();
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

    async function apiCall(method, path, body) {
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
        var res = await fetch(API_BASE + path, opts);
        var data = await res.json();
        if (res.status === 401) {
            clearSession();
            try {
                document.getElementById('dashboard').style.display = 'none';
                document.getElementById('loginWrap').style.display = 'flex';
            } catch (e) {}
        }
        if (!res.ok) throw new Error(data.error || '请求失败 (' + res.status + ')');
        if (hasApiToken()) saveSession();
        return data;
    }

    function showToast(msg, type) {
        var wrap = document.getElementById('toastWrap');
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
            return (Date.now() - s.t) < 2 * 60 * 60 * 1000;
        } catch(e) { return false; }
    }

    function hasApiToken() {
        return !!getToken();
    }

    // 安全说明：不再创建 Supabase 客户端，所有管理操作通过 API_BASE 执行
    async function initAdminClient() {
        document.getElementById('loginWrap').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        saveSession();
        ensureRegisterAlertBadge();
        startSessionTimeoutMonitor(); // 启动30分钟无操作自动登出
        
        var allowedTabs = ['ann','stats','users','security','audit','errorlog','posts','likes','comments','reports','bans','mutes','blacklist','photos'];
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
        } else {
            await loadAllData();
        }
        startRegisterAlertPolling();

        // 启动举报轮询（每 30 秒检查新举报）
        setInterval(async function() {
            var prevLen = reportsData.length;
            await loadReportsData();
            if (currentTab === 'reports' && reportsData.length !== prevLen) {
                var el = document.getElementById('tabReports');
                if (el) renderReportsTab(el);
            }
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
            if (!res.ok) {
                err.textContent = data.error || '登录失败';
                btn.disabled = false;
                btn.textContent = '登录';
                return;
            }
            setToken(data.token);
            ADMIN = name;
            await initAdminClient();
        } catch(e) {
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
        if (API_BASE && getToken()) {
            fetch(API_BASE + '/admin/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            }).catch(function() {});
        }
        stopRegisterAlertPolling();
        allPosts = []; allLikes = []; allComments = []; allUsers = [];
        annList = [];
        clearSession();
        document.getElementById('loginWrap').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginName').value = '';
        document.getElementById('loginPw').value = '';
    };

    // 登录表单键盘导航：Enter 切换到下一栏/提交
    document.getElementById('loginName').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('loginPw').focus();
        }
    });
    document.getElementById('loginPw').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            window.doAdminLogin();
        }
    });

    async function loadAllData(keepTab) {
        try {
            if (!API_BASE || !getToken()) {
                throw new Error('API 未配置或未登录，拒绝加载数据');
            }
            // 通过 API 加载数据（安全：仅服务端密钥可访问敏感数据）
            var apiData = await apiCall('GET', '/admin/data');
            var postData = apiData.posts || [];
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__' && p.media_type !== SECURITY_ALERT_MARKER && p.media_type !== AUDIT_LOG_MARKER && p.media_type !== CLIENT_ERROR_MARKER; });
            annList = apiData.announcements || [];
            allLikes = apiData.likes || [];
            allComments = apiData.comments || [];
            updateReportBadge();
            bansData = apiData.bans || [];
            mutesData = apiData.mutes || [];
            blacklistData = apiData.blacklist || [];

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });
            
            // 加载用户信息（仅通过 API）
            var userInfoList = [];
            try { 
                var userRes = await apiCall('GET', '/admin/users'); 
                userInfoList = userRes.data || []; 
            } catch(e) {
                console.warn('[admin] 加载用户信息失败:', e.message);
            }
            
            var userInfoMap = {};
            userInfoList.forEach(function(ui) {
                try {
                    var info = JSON.parse(ui.content || '{}');
                    userInfoMap[ui.user_name] = mergeAdminUserInfo(userInfoMap[ui.user_name], info);
                    userMap[ui.user_name] = true;
                } catch(e) {}
            });
            
            allUsers = Object.keys(userMap).sort().map(function(u) {
                return {
                    name: u,
                    info: userInfoMap[u] || null
                };
            });

            // 加载登录事件记录
            try {
                var loginRes = await apiCall('GET', '/admin/login-events');
                allLoginEvents = loginRes.data || [];
            } catch(e) {
                allLoginEvents = [];
            }

            // 数据已经在 /admin/data 中加载，不需要单独加载
            await loadPhotosAdminData();

            if (!keepTab) {
                switchTab('ann');
            } else {
                renderTab(currentTab);
            }
        } catch(e) {
            showToast('数据加载失败，请刷新重试', 'error');
        }
    }

    window.switchTab = async function(tab) {
        currentTab = tab;
        saveCurrentTab();
        if (tab === 'reports') {
            var badge = document.getElementById('reportBadge');
            if (badge) badge.style.display = 'none';
        }
        ['ann','users','posts','likes','comments'].forEach(function(t) {
            document.getElementById('tab' + getTabDomName(t)).classList.remove('active');
            document.getElementById('tab' + getTabDomName(t) + 'Btn').classList.remove('active');
        });
        document.getElementById('tab' + getTabDomName(tab)).classList.add('active');
        document.getElementById('tab' + getTabDomName(tab) + 'Btn').classList.add('active');
        window.renderTab(tab);
    };

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function maskIp(ip) {
        if (!ip) return '-';
        var s = String(ip).trim();
        var parts = s.split('.');
        if (parts.length === 4) return parts[0] + '.xxx.xxx.xxx';
        return s.slice(0, 4) + 'xxx';
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
        return {
            reg_time: pickEarlierAdminIso(left.reg_time, right.reg_time),
            auth_created_at: pickEarlierAdminIso(left.auth_created_at, right.auth_created_at),
            last_login: pickLaterAdminIso(left.last_login, right.last_login),
            last_visit: pickLaterAdminIso(left.last_visit, right.last_visit)
        };
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
            var escapedName = escapeHtml(name).replace(/'/g, '&#39;');
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
            var safeName = u.name.replace(/'/g, "\\'");
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
        var el = document.getElementById('tab' + getTabDomName(tab));
        if (!el) return;
        switch(tab) {
            case 'ann': renderAnnTab(el); break;
            case 'stats': renderStatsTab(el); break;
            case 'users': renderUsersTab(el); break;
            case 'security': renderSecurityTab(el); break;
            case 'audit': renderAuditTab(el); break;
            case 'errorlog': renderErrorLogTab(el); break;
            case 'posts': renderPostsTab(el); break;
            case 'likes': renderLikesTab(el); break;
            case 'comments': renderCommentsTab(el); break;
            case 'reports': renderReportsTab(el); break;
            case 'bans': renderBansTab(el); break;
            case 'mutes': renderMutesTab(el); break;
            case 'blacklist': renderBlacklistTab(el); break;
            case 'photos': renderPhotosTab(el); break;
        }
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
                var safeName = u.name.replace(/'/g, "\\'");

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

    async function renderPostsTab(el) {
        // 每次切到帖子管理时自动刷新数据
        if (API_BASE && getToken()) {
            try {
                var apiData = await apiCall('GET', '/admin/data');
                var postData = apiData.posts || [];
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__' && p.media_type !== SECURITY_ALERT_MARKER && p.media_type !== AUDIT_LOG_MARKER && p.media_type !== CLIENT_ERROR_MARKER; });
                annList = apiData.announcements || [];
                allLikes = apiData.likes || [];
                allComments = apiData.comments || [];
                updateReportBadge();
                bansData = apiData.bans || [];
                mutesData = apiData.mutes || [];
                blacklistData = apiData.blacklist || [];
            } catch(e) {}
        }
        var visiblePosts = allPosts.filter(function(p) { return p.media_type !== ANN_MARKER && p.media_type !== '__photo_wall__' && p.media_type !== REPORT_MARKER; });
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
                    imgHtml = '<img src="' + escapeHtml(p.media_url) + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="previewAdminPhoto(\'' + escapeHtml(p.media_url) + '\',\'' + escapeHtml(p.user_name || '') + '\',\'' + escapeHtml(p.created_at || '') + '\')" title="点击预览大图">';
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
        // 自动刷新
        if (API_BASE && getToken()) {
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
        // 自动刷新
        if (API_BASE && getToken()) {
            try { var apiData = await apiCall('GET', '/admin/data'); allComments = apiData.comments || []; } catch(e) {}
        }
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
                if (API_BASE && getToken()) {
                    await apiCall('DELETE', '/admin/announcement/' + id);
                } else {
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
                if (API_BASE && getToken()) {
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
                if (API_BASE && getToken()) {
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

    (async function() {
        var saved = localStorage.getItem('xtj-admin-theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }

        if (hasApiToken()) {
            try {
                await apiCall('GET', '/admin/verify');
                initAdminClient();
            } catch(e) {
                clearSession();
            }
        }
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
        
        var html = '<h3 style="margin:0 0 16px;">举报详情</h3>';
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
                if (!API_BASE || !getToken()) {
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

    window.doRespondReport = function(id) {
        var textarea = document.getElementById('reportResponse_' + id);
        if (!textarea) return;
        var response = textarea.value.trim();
        if (!response) { showToast('请输入回复内容', 'error'); return; }
        try {
            apiCall('PUT', '/admin/report/' + id + '/respond', { response: response }).then(async function() {
                await loadReportsData();
                document.querySelector('.report-detail-modal')?.remove();
                renderTab('reports');
                showToast('已回复并处理', 'success');
            }).catch(function(e) { showToast('操作失败: ' + e.message, 'error'); });
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
            if (API_BASE && getToken()) {
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
        await loadPhotosAdminData();
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
                var thumbHtml = thumbUrl ? '<img src="' + escapeHtml(thumbUrl) + '" style="width:44px;height:44px;object-fit:cover;border-radius:6px;cursor:pointer;" loading="lazy" onclick="previewAdminPhoto(\'' + escapeHtml(previewUrl) + '\', \'' + escapeHtml(thumbUrl) + '\', \'' + escapeHtml(p.user_name || '') + '\', \'' + escapeHtml(p.created_at || '') + '\')" title="\u70b9\u51fb\u9884\u89c8\u5927\u56fe">' : '-';
                var actions = '';
                if (p.is_deleted) {
                    actions += '<button class="btn-sm" onclick="restoreAdminPhoto(\'' + p.id + '\')" style="background:#10b981;color:#fff;margin-right:4px;">\u6062\u590d</button>';
                } else {
                    actions += '<button class="btn-sm del" onclick="deleteAdminPhoto(\'' + p.id + '\', \'' + (p.actor_key || '') + '\')">\u5220\u9664</button>';
                }
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

    window.restoreAdminPhoto = function(id) {
        showConfirm('恢复照片', '确认恢复此照片？恢复后将在前端照片墙重新可见。', '确认恢复', async function() {
            try {
                await apiCall('POST', '/admin/photo/restore/' + id);
                await loadPhotosAdminData();
                renderTab('photos');
                showToast('照片已恢复', 'success');
            } catch(e) { showToast('恢复失败: ' + e.message, 'error'); }
        });
    };

    window.deleteAdminPhoto = function(id, actorKey) {
        showConfirm('删除照片', '确认删除此照片？照片数据将被保留，管理端仍可查看，但前端用户不可见。', '确认删除', async function() {
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

            if (API_BASE && getToken()) {
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
            if (API_BASE && getToken()) {
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

            if (API_BASE && getToken()) {
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

            if (API_BASE && getToken()) {
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

            if (API_BASE && getToken()) {
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

    var _origSwitchTab = window.switchTab;
    window.switchTab = function(tab) {
        currentTab = tab;
        saveCurrentTab();
        if (tab === 'reports') {
            var badge = document.getElementById('reportBadge');
            if (badge) badge.style.display = 'none';
        }
        ['ann','users','posts','likes','comments','reports','bans','mutes','blacklist','photos','stats','security','audit','errorlog'].forEach(function(t) {
            var panel = document.getElementById('tab' + getTabDomName(t));
            var btn = document.getElementById('tab' + getTabDomName(t) + 'Btn');
            if (panel) panel.classList.remove('active');
            if (btn) btn.classList.remove('active');
        });
        var panel = document.getElementById('tab' + getTabDomName(tab));
        var btn = document.getElementById('tab' + getTabDomName(tab) + 'Btn');
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        window.renderTab(tab);
    };

    var _origRenderTab = window.renderTab;
    window.renderTab = function(tab) {
        var el = document.getElementById('tab' + getTabDomName(tab));
        if (!el) return;
        switch(tab) {
            case 'ann': renderAnnTab(el); break;
            case 'users': renderUsersTab(el); break;
            case 'posts': renderPostsTab(el); break;
            case 'likes': renderLikesTab(el); break;
            case 'comments': renderCommentsTab(el); break;
            case 'reports': renderReportsTab(el); break;
            case 'bans': renderBansTab(el); break;
            case 'mutes': renderMutesTab(el); break;
            case 'blacklist': renderBlacklistTab(el); break;
            case 'photos': renderPhotosTab(el); break;
            case 'stats': renderStatsTab(el); break;
            case 'security': renderSecurityTab(el); break;
            case 'audit': renderAuditTab(el); break;
            case 'errorlog': renderErrorLogTab(el); break;
        }
    };

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

    renderUsersTab = function(el) {
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + allUsers.length + '</div><div class="lbl">注册用户总数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allPosts.length + '</div><div class="lbl">帖子总数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allLikes.length + '</div><div class="lbl">点赞总数</div></div>';
        h += '<div class="stat-box"><div class="val">' + allComments.length + '</div><div class="lbl">评论总数</div></div>';
        h += '</div>';
        h += '<div class="filter-bar">';
        h += '<div class="search-wrap"><span class="search-icon">搜</span><input id="userSearchInp" placeholder="搜索用户名..." oninput="searchUserInp()" value="' + escapeHtml(searchUser) + '"></div>';
        h += '<div class="filter-chips">';
        h += '<span class="filter-chip' + (userFilterStatus === 'all' ? ' active' : '') + '" onclick="userFilterStatus=\'all\';renderTab(\'users\')">全部</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'admin' ? ' active' : '') + '" onclick="userFilterStatus=\'admin\';renderTab(\'users\')">管理员</span>';
        h += '<span class="filter-chip' + (userFilterStatus === 'banned' ? ' active active-del' : '') + '" onclick="userFilterStatus=\'banned\';renderTab(\'users\')">封禁中</span>';
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
            if (userSortBy === 'posts') return getUserActivityStats(b.name).posts - getUserActivityStats(a.name).posts;
            if (userSortBy === 'login') {
                return toAdminTimeMs(b.info && (b.info.last_login || b.info.last_visit)) - toAdminTimeMs(a.info && (a.info.last_login || a.info.last_visit));
            }
            return toAdminTimeMs(getAdminUserEffectiveRegTime(b.info)) - toAdminTimeMs(getAdminUserEffectiveRegTime(a.info));
        });

        h += '<div class="card"><h3>用户列表 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + filtered.length + ' 位用户</span></h3>';
        if (!filtered.length) {
            h += '<div class="empty">没有匹配用户</div>';
        } else {
            h += '<div class="user-grid">';
            filtered.forEach(function(u) {
                var stats = getUserActivityStats(u.name);
                var flags = getUserStateFlags(u.name);
                var safeName = u.name.replace(/'/g, "\\'");
                var regTime = getAdminUserEffectiveRegTime(u.info) ? formatTime(getAdminUserEffectiveRegTime(u.info)) : '-';
                var lastLogin = u.info && (u.info.last_login || u.info.last_visit) ? formatTime(u.info.last_login || u.info.last_visit) : '-';
                h += '<div class="user-card' + (flags.isBanned ? ' is-banned' : '') + (flags.isMuted ? ' is-muted' : '') + (flags.isAdmin ? ' is-admin' : '') + '">';
                h += '<div class="user-card-head"><div class="user-avatar' + (flags.isAdmin ? ' admin-avatar' : (flags.isBanned ? ' banned-avatar' : (flags.isMuted ? ' muted-avatar' : ''))) + '">' + escapeHtml((u.name || '?').slice(0, 1).toUpperCase()) + '</div><div class="user-card-name"><strong><a href="#" onclick="showUserDetailModal(\'' + safeName + '\');return false;" style="color:var(--text);text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escapeHtml(u.name) + '</a></strong><div class="user-tags">' + buildUserTagMarkup(flags) + '</div></div></div>';
                h += '<div class="user-card-stats"><div class="user-stat-item"><div class="num">' + stats.posts + '</div><div class="lbl">帖子</div></div><div class="user-stat-item"><div class="num">' + stats.likes + '</div><div class="lbl">点赞</div></div><div class="user-stat-item"><div class="num">' + stats.comments + '</div><div class="lbl">评论</div></div></div>';
                h += '<div class="user-card-meta"><div class="meta-row"><span class="label">注册时间</span><span class="value">' + regTime + '</span></div><div class="meta-row"><span class="label">最近登录</span><span class="value">' + lastLogin + '</span></div></div>';
                h += '<div class="user-card-actions">';
                if (!flags.isAdmin) {
                    h += '<button class="btn-sm" onclick="quickMuteUser(\'' + safeName + '\')">禁言</button>';
                    h += '<button class="btn-sm" onclick="quickBanUser(\'' + safeName + '\')">封禁</button>';
                    h += '<button class="btn-sm" onclick="quickBlacklistUser(\'' + safeName + '\')">拉黑</button>';
                } else {
                    h += '<span style="color:var(--text-muted);font-size:12px;">管理员不可操作</span>';
                }
                h += '</div></div>';
            });
            h += '</div>';
        }
        h += '</div>';
        el.innerHTML = h;
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
                var safeName = u.name.replace(/'/g, "\\'");
                var actions = flags.isAdmin
                    ? '-'
                    : '<button class="btn-sm" onclick="quickMuteUser(\'' + safeName + '\')">禁言</button><button class="btn-sm del" onclick="quickBanUser(\'' + safeName + '\')">封禁</button>';
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
                        }
                        latestLoginTime = lc.login_at || latestEvent.created_at || '';
                        var escapedName = u.name.replace(/'/g, "\\'");
                        deviceCell = '<a href="#" onclick="showUserLoginDetail(\'' + escapedName + '\');return false;" style="color:var(--primary);text-decoration:underline;">' + deviceText + '</a>';
                    } catch(ex) {}
                }

                // 最近登录时间优先用最新 login 事件
                var displayLastLogin = latestLoginTime || (u.info && (u.info.last_login || u.info.last_visit));
                var lastLogin = displayLastLogin ? formatTime(displayLastLogin) : '-';

                h += '<tr><td><strong>' + escapeHtml(u.name) + '</strong></td><td>' + escapeHtml(statusText) + '</td><td>' + escapeHtml(regTime ? formatTime(regTime) : '-') + '</td><td>' + escapeHtml(lastLogin) + '</td><td>' + deviceCell + '</td><td>' + regionCell + '</td><td>' + ipCell + '</td><td>' + stats.posts + '</td><td>' + stats.likes + '</td><td>' + stats.comments + '</td><td>' + actions + '</td></tr>';
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

    var _origSwitchTabV2 = window.switchTab;
    window.switchTab = async function(tab) {
        var normalized = tab === 'blacklist' ? 'bans' : tab;
        var allTabs = ['ann','stats','users','security','posts','likes','comments','reports','bans','mutes','photos','audit','errorlog','blacklist'];
        currentTab = normalized;
        localStorage.setItem('admin_tab', normalized);
        if (normalized === 'users') {
            await markRegisterAlertsRead();
        }
        // 切换到举报管理时清除红点
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
        window.renderTab(normalized);
    };

    window.renderTab = function(tab) {
        var normalized = tab === 'blacklist' ? 'bans' : tab;
        var el = document.getElementById('tab' + getTabDomName(normalized));
        if (!el) return;
        switch(normalized) {
            case 'ann': renderAnnTab(el); break;
            case 'users': renderUsersTab(el); break;
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
            case 'errorlog': renderErrorLogTab(el); break;
        }
    };

    (function retireBlacklistUi() {
        var btn = document.getElementById('tabBlacklistBtn');
        var panel = document.getElementById('tabBlacklist');
        if (btn) btn.remove();
        if (panel) panel.remove();
        try {
            if (localStorage.getItem('admin_tab') === 'blacklist') {
                localStorage.setItem('admin_tab', 'bans');
            }
        } catch(_) {}
    })();

    var _origLoadAllData = window.loadAllData;
    window.loadAllData = async function(keepTab) {
        try {
            if (API_BASE && getToken()) {
                var apiData = await apiCall('GET', '/admin/data');
                var postData = apiData.posts || [];
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__' && p.media_type !== SECURITY_ALERT_MARKER && p.media_type !== AUDIT_LOG_MARKER && p.media_type !== CLIENT_ERROR_MARKER; });
                annList = apiData.announcements || [];
                allLikes = apiData.likes || [];
                allComments = apiData.comments || [];
                updateReportBadge();
                bansData = apiData.bans || [];
                mutesData = apiData.mutes || [];
                blacklistData = apiData.blacklist || [];
            }

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });

            var userInfoList = [];
            if (API_BASE && getToken()) {
                try { var userRes = await apiCall('GET', '/admin/users'); userInfoList = userRes.data || []; } catch(e) {}
            }

            var userInfoMap = {};
            userInfoList.forEach(function(ui) {
                try {
                    var info = JSON.parse(ui.content || '{}');
                    userInfoMap[ui.user_name] = mergeAdminUserInfo(userInfoMap[ui.user_name], info);
                    userMap[ui.user_name] = true;
                } catch(e) {}
            });

            allUsers = Object.keys(userMap).sort().map(function(u) {
                return { name: u, info: userInfoMap[u] || null };
            });

            // 加载登录事件记录
            try {
                var loginRes = await apiCall('GET', '/admin/login-events');
                allLoginEvents = loginRes.data || [];
            } catch(e) {
                allLoginEvents = [];
            }

            // 加载安全提醒
            try {
                var secRes = await apiCall('GET', '/admin/security-alerts');
                allSecurityAlerts = secRes.data || [];
            } catch(e) {
                allSecurityAlerts = [];
            }

            // 加载审计日志
            try {
                var auditRes = await apiCall('GET', '/admin/audit-logs');
                allAuditLogs = auditRes.data || [];
            } catch(e) {
                allAuditLogs = [];
            }

            // 加载错误日志
            try {
                var errLogRes = await apiCall('GET', '/admin/error-logs');
                allErrorLogs = errLogRes.data || [];
            } catch(e) {
                allErrorLogs = [];
            }

            // 加载安全设置
            await loadSecuritySettings();

            // 数据已在 API 路径中统一加载
            await loadPhotosAdminData();

            if (!keepTab) { switchTab('ann'); }
            else { window.renderTab(currentTab); }
        } catch(e) {
            showToast('数据加载失败，请刷新重试', 'error');
        }
    };
    function buildAdminMediaThumb(post, username, createdAt) {
        if (!post || !post.media_url) return '-';
        if (String(post.media_url).indexOf('http') === 0) {
            return '<img src="' + escapeHtml(post.media_url) + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="previewAdminPhoto(\'' + escapeHtml(post.media_url) + '\',\'' + escapeHtml(username || post.user_name || '') + '\',\'' + escapeHtml(createdAt || post.created_at || '') + '\')" title="点击预览大图">';
        }
        return '📎';
    }

    renderPostsTab = async function(el) {
        if (API_BASE && getToken()) {
            try {
                var apiData = await apiCall('GET', '/admin/data');
                allPosts = (apiData.posts || []).filter(function(p) {
                    return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER;
                });
                allLikes = apiData.likes || [];
                allComments = apiData.comments || [];
                updateReportBadge();
                bansData = apiData.bans || [];
                mutesData = apiData.mutes || [];
                blacklistData = apiData.blacklist || [];
            } catch(e) {}
        }
        var visiblePosts = allPosts.filter(function(p) { return p.media_type !== ANN_MARKER && p.media_type !== '__photo_wall__' && p.media_type !== REPORT_MARKER; });
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
        if (API_BASE && getToken()) {
            try {
                var apiData = await apiCall('GET', '/admin/data');
                allLikes = apiData.likes || [];
                allPosts = (apiData.posts || []).filter(function(p) {
                    return p.media_type !== AUTH_MARKER && p.media_type !== ADMIN_AUTH_MARKER && p.media_type !== DM_MARKER;
                });
            } catch(e) {}
        }
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
        await loadReportsData();
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
            if (API_BASE && getToken()) {
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
            if (API_BASE && getToken()) {
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
            if (API_BASE && getToken()) h += '<button class="btn-sm primary" style="margin-left:auto;" onclick="apiCall(\'POST\',\'/admin/stats/refresh\').then(function(){renderTab(\'stats\');}).catch(function(){})">刷新缓存</button>';
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
        await loadReportsData();
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

        var html = '<h3 style="margin:0 0 16px;">举报详情</h3>';
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

    // 登录设备详情展示
    window.showUserLoginDetail = function(userName) {
        var box = document.getElementById('userLoginDetail');
        if (!box) return;

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
            box.innerHTML = '<div class="card"><div class="empty">暂无登录记录</div></div>';
            box.style.display = 'block';
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

        var html = '<div class="card">' +
            '<h3 style="margin-top:0;">用户详情：' + escapeHtml(userName) + '</h3>';

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
            '<div style="max-height:360px;overflow-y:auto;">' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid rgba(0,0,0,0.1);">' +
            '<th style="padding:6px 8px;text-align:left;">登录时间</th>' +
            '<th style="padding:6px 8px;text-align:left;">来源</th>' +
            '<th style="padding:6px 8px;text-align:left;">设备类型</th>' +
            '<th style="padding:6px 8px;text-align:left;">系统</th>' +
            '<th style="padding:6px 8px;text-align:left;">浏览器</th>' +
            '<th style="padding:6px 8px;text-align:left;">IP</th>' +
            '<th style="padding:6px 8px;text-align:left;">地区</th>' +
            '<th style="padding:6px 8px;text-align:left;">指纹Hash</th>' +
            '</tr></thead><tbody>';

        userEvents.forEach(function(ev) {
            var loginTime = ev.info.login_at || (ev.raw && ev.raw.created_at) || '';
            var srcLabel = sourceLabels[ev.info.source] || '登录记录';
            var locText = (ev.info.ip_location && ev.info.ip_location.text) ? escapeHtml(ev.info.ip_location.text) : '暂未解析';
            var fullIp = ev.info.ip || '-';
            var fpShort = '-';
            if (ev.info.browser_fingerprint_hash) fpShort = escapeHtml(ev.info.browser_fingerprint_hash.slice(0, 10)) + '...';
            else if (ev.info.canvas_fingerprint_hash) fpShort = 'C:' + escapeHtml(ev.info.canvas_fingerprint_hash.slice(0, 10)) + '...';
            html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.05);">' +
                '<td style="padding:6px 8px;">' + (loginTime ? escapeHtml(formatTime(loginTime)) : '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(srcLabel) + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(ev.info.device_type || '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(ev.info.os || '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(ev.info.browser || '-') + '</td>' +
                '<td style="padding:6px 8px;">' + escapeHtml(fullIp) + '</td>' +
                '<td style="padding:6px 8px;">' + locText + '</td>' +
                '<td style="padding:6px 8px;font-size:11px;font-family:monospace;">' + fpShort + '</td>' +
                '</tr>';
        });

        html += '</tbody></table></div></div>';
        box.innerHTML = html;
        box.style.display = 'block';
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
                'review_security_alert': '审查安全提醒'
            };
            allAuditLogs.forEach(function(log) {
                h += '<tr><td>' + escapeHtml(formatTime(log.created_at)) + '</td><td>' + escapeHtml(actionLabels[log.action] || log.action) + '</td><td>' + escapeHtml(log.operator) + '</td><td style="max-width:300px;white-space:normal;word-break:break-word;">' + escapeHtml(log.detail || '-') + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

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
            overlay.className = 'modal-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = '<div class="modal-dialog" style="max-width:600px;max-height:80vh;overflow-y:auto;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<h3 style="margin:0;">' + title + '</h3>' +
            '<button onclick="document.getElementById(\'detailModal\').classList.remove(\'active\')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text);">&times;</button>' +
            '</div>' + contentHtml + '</div>';
        overlay.classList.add('active');
    }

    window.showUserDetailModal = function(userName) {
        // Find user info
        var userObj = null;
        for (var i = 0; i < allUsers.length; i++) {
            if (allUsers[i].name === userName) { userObj = allUsers[i]; break; }
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
        var html = '<div style="padding:20px;max-height:70vh;overflow-y:auto;">';
        html += '<h2 style="margin-top:0;">' + escapeHtml(userName) + '</h2>';
        html += buildUserTagMarkup(flags) + '<br><br>';

        // Basic info grid
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:16px;">';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">注册时间</span><br>' + escapeHtml(getAdminUserEffectiveRegTime(userInfo) ? formatTime(getAdminUserEffectiveRegTime(userInfo)) : '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近登录</span><br>' + escapeHtml(userInfo.last_login ? formatTime(userInfo.last_login) : '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近访问</span><br>' + escapeHtml(userInfo.last_visit ? formatTime(userInfo.last_visit) : '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近IP</span><br>' + escapeHtml(userInfo.last_ip || '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">地区</span><br>' + escapeHtml((userInfo.last_ip_location && userInfo.last_ip_location.text) || '-') + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">最近设备</span><br>' + escapeHtml((userInfo.last_device || '-').slice(0, 40)) + '</div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">设备ID</span><br><span style="font-size:11px;font-family:monospace;">' + escapeHtml((userInfo.last_device_id || (userEvents[0] && userEvents[0].info.device_id) || '-').slice(0, 16)) + '...</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">浏览器指纹</span><br><span style="font-size:11px;font-family:monospace;">' + (latestFp.browser_fingerprint_hash ? escapeHtml(latestFp.browser_fingerprint_hash.slice(0, 16)) + '...' : '-') + '</span></div>';
        html += '<div><span style="font-size:11px;color:var(--text-muted);">Canvas指纹</span><br><span style="font-size:11px;font-family:monospace;">' + (latestFp.canvas_fingerprint_hash ? escapeHtml(latestFp.canvas_fingerprint_hash.slice(0, 16)) + '...' : '-') + '</span></div>';
        html += '</div>';

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
            html += '<div style="max-height:200px;overflow-y:auto;margin-bottom:12px;"><table style="width:100%;font-size:11px;border-collapse:collapse;">';
            html += '<thead><tr style="border-bottom:1px solid rgba(0,0,0,0.1);"><th style="padding:4px 6px;text-align:left;">时间</th><th style="padding:4px 6px;text-align:left;">来源</th><th style="padding:4px 6px;text-align:left;">设备</th><th style="padding:4px 6px;text-align:left;">IP</th><th style="padding:4px 6px;text-align:left;">地区</th></tr></thead><tbody>';
            var sourceLabelsV2 = { 'login_success': '登录', 'page_visit': '访问', 'register_success': '注册', 'admin_login': '管理' };
            userEvents.slice(0, 10).forEach(function(ev) {
                var lt = ev.info.login_at || (ev.raw && ev.raw.created_at) || '';
                html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.03);">';
                html += '<td style="padding:4px 6px;">' + (lt ? escapeHtml(formatTime(lt)) : '-') + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(sourceLabelsV2[ev.info.source] || ev.info.source || '-') + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(((ev.info.device_type || '') + ' ' + (ev.info.os || '')).slice(0, 20)) + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml(ev.info.ip || '-') + '</td>';
                html += '<td style="padding:4px 6px;">' + escapeHtml((ev.info.ip_location && ev.info.ip_location.text) || '-') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        // Security alerts
        html += '<h4 style="margin-bottom:8px;">最近安全提醒</h4>';
        if (userAlerts.length === 0) {
            html += '<div class="empty">暂无安全提醒</div>';
        } else {
            var alertTypeLabels = { 'same_ip_multi_users': '同IP多账号', 'same_device_multi_users': '同设备多账号', 'multi_ip_same_user': '多IP同账号', 'geo_change': '地区变化', 'high_frequency_visit': '高频访问', 'same_browser_fp_multi_users': '同浏览器指纹多账号', 'same_canvas_fp_multi_users': '同Canvas指纹多账号' };
            html += '<div style="margin-bottom:12px;">';
            userAlerts.forEach(function(a) {
                html += '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid rgba(0,0,0,0.03);">';
                html += '<span style="color:var(--danger);">[' + (alertTypeLabels[a.type] || a.type) + ']</span> ';
                html += escapeHtml(a.reason) + ' ';
                html += '<span style="color:var(--text-muted);">' + escapeHtml(formatTime(a.created_at)) + '</span>';
                if (a.false_positive) html += '<span class="badge badge-green" style="font-size:9px;">误报</span>';
                else if (a.ignored) html += '<span class="badge" style="font-size:9px;background:rgba(100,100,100,0.15);">已忽略</span>';
                html += '</div>';
            });
            html += '</div>';
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
})();
