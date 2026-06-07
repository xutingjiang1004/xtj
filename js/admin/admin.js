(function() {
    var SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";
    var ADMIN = "xxz";
    // 管理员密码不再硬编码 — 由后端 API 的 ADMIN_PASSWORD 环境变量控制
    // API 地址：部署后设为实际地址，本地开发留空则回退到直接 Supabase 调用
    var API_BASE = "";
    var AUTH_MARKER = "__auth__";
    var DM_MARKER = "__dm__";
    var ANN_MARKER = "__ann__";
    var REPORT_MARKER = '__report__';
    var SESSION_KEY = "xtj_admin_session";
    var TOKEN_KEY = "xtj_admin_token";
    var TAB_KEY = "xtj_admin_tab";

    // 初始化 Supabase 客户端（直连模式使用）
    var sb = null;
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        try {
            sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } catch(e) {
            console.warn('[admin] Supabase client init failed:', e.message);
        }
    }
    window.sb = sb;
    // 简单的 token 混淆（非加密，仅防止直接读取 localStorage）

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

    var allPosts = [], allLikes = [], allComments = [], allUsers = [], annList = [];
    var searchUser = '', searchPost = '';
    var userFilterStatus = 'all';
    var userSortBy = 'reg';
    var confirmCallback = null;
    var currentTab = 'ann';

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

    async function initAdminClient() {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        document.getElementById('loginWrap').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        saveSession();
        
        var savedTab = localStorage.getItem(TAB_KEY);
        if (savedTab === 'blacklist') savedTab = 'bans';
        if (savedTab && ['ann','users','posts','likes','comments','reports','bans','mutes','photos','stats'].indexOf(savedTab) !== -1) {
            currentTab = savedTab;
            await loadAllData(true);
            ['ann','users','posts','likes','comments','reports','bans','mutes','photos','stats'].forEach(function(t) {
                var panel = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
                var btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1) + 'Btn');
                if (panel) panel.classList.remove('active');
                if (btn) btn.classList.remove('active');
            });
            var activePanel = document.getElementById('tab' + savedTab.charAt(0).toUpperCase() + savedTab.slice(1));
            var activeBtn = document.getElementById('tab' + savedTab.charAt(0).toUpperCase() + savedTab.slice(1) + 'Btn');
            if (activePanel) activePanel.classList.add('active');
            if (activeBtn) activeBtn.classList.add('active');
        } else {
            await loadAllData();
        }

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
        
        if (name !== ADMIN) { err.textContent = '账号不正确'; return; }
        if (!pw) { err.textContent = '请输入密码'; return; }
        
        err.textContent = '';
        
        if (API_BASE) {
            // 通过 API 认证
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
                await initAdminClient();
            } catch(e) {
                err.textContent = 'API 连接失败: ' + e.message;
                btn.disabled = false;
                btn.textContent = '登录';
            }
        } else {
            // 回退：API 未配置时使用 Supabase auth 记录校验（仅开发环境）
            var tempSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            var storedPw = null;
            try {
                var { data: pwData } = await tempSb
                    .from('posts')
                    .select('media_url')
                    .eq('user_name', ADMIN)
                    .eq('media_type', AUTH_MARKER)
                    .maybeSingle();
                if (pwData && pwData.media_url) {
                    storedPw = pwData.media_url;
                }
            } catch(e) {}
            
            if (!storedPw) {
                // 自动注册管理员 auth 记录，无需手动去前端注册
                try {
                    var encoder = new TextEncoder();
                    var hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pw));
                    var hashArray = Array.from(new Uint8Array(hashBuffer));
                    var pwHash = hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                    await tempSb.from('posts').insert({
                        user_name: ADMIN,
                        media_url: pwHash,
                        media_type: AUTH_MARKER,
                        actor_key: AUTH_MARKER,
                        created_at: new Date().toISOString()
                    });
                    storedPw = pwHash;
                } catch(regErr) {
                    err.textContent = '初始化管理员账号失败: ' + (regErr.message || '未知错误');
                    btn.disabled = false;
                    btn.textContent = '登录';
                    return;
                }
            }
            var encoder = new TextEncoder();
            var hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pw));
            var hashArray = Array.from(new Uint8Array(hashBuffer));
            var inputHash = hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
            
            if (inputHash !== storedPw) {
                err.textContent = '密码错误';
                btn.disabled = false;
                btn.textContent = '登录';
                return;
            }
            await initAdminClient();
        }
    };

    window.doAdminLogout = function() {
        if (API_BASE && getToken()) {
            fetch(API_BASE + '/admin/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            }).catch(function() {});
        }
        sb = null;
        allPosts = []; allLikes = []; allComments = []; allUsers = [];
        annList = [];
        clearSession();
        document.getElementById('loginWrap').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginName').value = '';
        document.getElementById('loginPw').value = '';
    };

    async function loadAllData(keepTab) {
        try {
            if (API_BASE && getToken()) {
                // 通过 API 加载数据
                var apiData = await apiCall('GET', '/admin/data');
                var postData = apiData.posts || [];
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__'; });
                annList = postData.filter(function(p) { return p.media_type === ANN_MARKER; });
                allLikes = apiData.likes || [];
                allComments = apiData.comments || [];
                reportsData = apiData.reports || [];
                updateReportBadge();
                bansData = apiData.bans || [];
                mutesData = apiData.mutes || [];
                blacklistData = apiData.blacklist || [];
            } else {
                // 直接 Supabase 查询
                var postRes = await sb.from('posts').select('*').neq('media_type', '__avatar__').order('created_at', {ascending: false}).limit(5000);
                var likeRes = await sb.from('likes').select('*').order('created_at', {ascending: false}).limit(5000);
                var commRes = await sb.from('comments').select('*').order('created_at', {ascending: false}).limit(5000);

                allPosts = (postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__'; });
                annList = (postRes.data || []).filter(function(p) { return p.media_type === ANN_MARKER; });
                allLikes = likeRes.data || [];
                allComments = commRes.data || [];
                await loadReportsData();
                await loadBansData();
                await loadMutesData();
                await loadBlacklistData();
            }

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });
            
            // 加载用户信息
            var userInfoList = [];
            if (API_BASE && getToken()) {
                try { var userRes = await apiCall('GET', '/admin/users'); userInfoList = userRes.data || []; } catch(e) {}
            }
            if (!userInfoList.length) {
                userInfoList = (sb ? (await sb.from('posts').select('user_name, content, created_at').eq('media_type', '__user_info__').order('created_at', {ascending: false}).limit(5000)).data : []) || [];
            }
            
            var userInfoMap = {};
            userInfoList.forEach(function(ui) {
                try {
                    if (!userInfoMap[ui.user_name]) {
                        var info = JSON.parse(ui.content);
                        userInfoMap[ui.user_name] = info;
                        userMap[ui.user_name] = true;
                    }
                } catch(e) {}
            });
            
            allUsers = Object.keys(userMap).sort().map(function(u) {
                return {
                    name: u,
                    info: userInfoMap[u] || null
                };
            });

            if (!API_BASE || !getToken()) {
                await loadReportsData();
                await loadBansData();
                await loadMutesData();
                await loadBlacklistData();
            }
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

    window.switchTab = function(tab) {
        currentTab = tab;
        saveCurrentTab();
        ['ann','users','posts','likes','comments'].forEach(function(t) {
            document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.remove('active');
            document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1) + 'Btn').classList.remove('active');
        });
        document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
        document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Btn').classList.add('active');
        window.renderTab(tab);
    };

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
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

    function formatTime(d) {
        if (!d) return '';
        return new Date(d).toLocaleString();
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
                '<div class="meta-row"><span class="label">最近登录</span><span class="value">' + escapeHtml(info.last_login ? formatTime(info.last_login) : '-') + '</span></div>',
                '<div class="meta-row"><span class="label">注册时间</span><span class="value">' + escapeHtml(info.reg_time ? formatTime(info.reg_time) : '-') + '</span></div>',
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
        var el = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
        if (!el) return;
        switch(tab) {
            case 'ann': renderAnnTab(el); break;
            case 'users': renderUsersTab(el); break;
            case 'posts': renderPostsTab(el); break;
            case 'likes': renderLikesTab(el); break;
            case 'comments': renderCommentsTab(el); break;
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
                var la = a.info && a.info.last_login ? new Date(a.info.last_login).getTime() : 0;
                var lb = b.info && b.info.last_login ? new Date(b.info.last_login).getTime() : 0;
                return lb - la;
            }
            var ra = a.info && a.info.reg_time ? new Date(a.info.reg_time).getTime() : 0;
            var rb = b.info && b.info.reg_time ? new Date(b.info.reg_time).getTime() : 0;
            return rb - ra;
        });

        h += '<div class="card"><h3>用户列表 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + filtered.length + ' 位用户</span></h3>';
        if (!filtered.length) {
            h += '<div class="empty">无匹配用户</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>帖子</th><th>点赞</th><th>评论</th><th>操作</th></tr></thead><tbody>';
            filtered.forEach(function(u) {
                var pc = allPosts.filter(function(p) { return p.user_name === u.name; }).length;
                var lc = allLikes.filter(function(l) { return l.user_name === u.name; }).length;
                var cc = allComments.filter(function(c) { return c.user_name === u.name; }).length;
                var regTime = u.info && u.info.reg_time ? formatTime(u.info.reg_time) : '-';
                var lastLogin = u.info && u.info.last_login ? formatTime(u.info.last_login) : '-';
                var isAdmin = u.name === ADMIN;
                var isBanned = bansData.some(function(b) { return b.user_name === u.name && b.is_active; });
                var isMuted = mutesData.some(function(m) { return m.user_name === u.name && m.is_active; });
                var safeName = u.name.replace(/'/g, "\\'");

                var statusBadge = isAdmin ? '<span class="badge" style="background:rgba(99,102,241,0.15);color:#818cf8">管理员</span>' :
                                  isBanned ? '<span class="badge badge-red">拉黑封禁中</span>' :
                                  isMuted ? '<span class="badge" style="background:rgba(251,191,36,0.15);color:#fbbf24">禁言中</span>' :
                                  '<span class="badge badge-green">正常</span>';

                h += '<tr><td><strong>' + escapeHtml(u.name) + '</strong></td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td>' + regTime + '</td>';
                h += '<td>' + lastLogin + '</td>';
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
                if (API_BASE && getToken()) {
                    await apiCall('POST', '/admin/mute', {
                        user_name: userName,
                        duration_hours: hours,
                        reason: '管理员操作'
                    });
                } else {
                    var expiresAt = null;
                    if (hours > 0) {
                        var d = new Date();
                        d.setHours(d.getHours() + hours);
                        expiresAt = d.toISOString();
                    }
                    var { error } = await sb.from('mutes').insert([{
                        user_name: userName,
                        reason: '管理员操作',
                        duration_hours: hours,
                        muted_by: ADMIN,
                        expires_at: expiresAt,
                        is_active: true
                    }]);
                    if (error) { showToast('禁言失败: ' + error.message, 'error'); return; }
                }
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
                if (API_BASE && getToken()) {
                    await apiCall('POST', '/admin/ban', {
                        user_name: userName,
                        duration_hours: hours,
                        reason: '管理员操作'
                    });
                } else {
                    var expiresAt = null;
                    if (hours > 0) {
                        var d = new Date();
                        d.setHours(d.getHours() + hours);
                        expiresAt = d.toISOString();
                    }
                    var { data: existingBans, error: findErr } = await sb.from('bans').select('id, is_active').eq('user_name', userName);
                    if (findErr) { showToast('查询失败: ' + findErr.message, 'error'); return; }
                    if (existingBans && existingBans.length) {
                        var activeBan = existingBans.find(function(b) { return b.is_active; });
                        if (activeBan) { showToast('该用户已被拉黑封禁', 'error'); return; }
                        var { error: updErr } = await sb.from('bans').update({
                            ban_reason: '管理员操作', ban_duration_hours: hours,
                            ban_type: hours > 0 ? 'temporary' : 'permanent',
                            banned_by: ADMIN, expires_at: expiresAt, is_active: true,
                            banned_at: new Date().toISOString()
                        }).eq('id', existingBans[0].id);
                        if (updErr) { showToast('拉黑封禁失败: ' + updErr.message, 'error'); return; }
                    } else {
                        var { error } = await sb.from('bans').insert([{
                            user_name: userName, ban_reason: '管理员操作',
                            ban_duration_hours: hours,
                            ban_type: hours > 0 ? 'temporary' : 'permanent',
                            banned_by: ADMIN, expires_at: expiresAt, is_active: true,
                            banned_at: new Date().toISOString()
                        }]);
                        if (error) {
                            if (error.code === '23505') {
                                var { error: updErr2 } = await sb.from('bans').update({
                                    ban_reason: '管理员操作', ban_duration_hours: hours,
                                    ban_type: hours > 0 ? 'temporary' : 'permanent',
                                    banned_by: ADMIN, expires_at: expiresAt, is_active: true,
                                    banned_at: new Date().toISOString()
                                }).eq('user_name', userName);
                                if (updErr2) { showToast('拉黑封禁失败: ' + updErr2.message, 'error'); return; }
                            } else {
                                showToast('拉黑封禁失败: ' + error.message, 'error'); return;
                            }
                        }
                    }
                }
                await loadBansData();
                showToast('已拉黑封禁 ' + userName, 'success');
            } catch(e) { showToast('拉黑封禁失败: ' + e.message, 'error'); }
        });
    };

    function renderPostsTab(el) {
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
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>内容</th><th>浏览</th><th>时间</th><th>操作</th></tr></thead><tbody>';
            filtered.forEach(function(p) {
                var displayText = getDisplayContent(p.content);
                var content = (displayText || '').slice(0, 50);
                if (displayText && displayText.length > 50) content += '...';
                h += '<tr><td>' + escapeHtml(p.user_name || '') + '</td>';
                h += '<td>' + escapeHtml(content) + (p.media_url ? ' 📎' : '') + '</td>';
                h += '<td>' + (p.views || 0) + '</td>';
                h += '<td>' + formatTime(p.created_at) + '</td>';
                h += '<td><button class="btn-sm del" onclick="deleteAdminPost(\'' + p.id + '\')">删除</button></td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    function renderLikesTab(el) {
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

    function renderCommentsTab(el) {
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
            if (API_BASE && getToken()) {
                await apiCall('POST', '/admin/announcement', { title: title, content: content });
            } else {
                var storeData = JSON.stringify({ title: title, content: content });
                var res = await sb.from('posts').insert([{
                    user_name: ADMIN, content: storeData,
                    media_type: ANN_MARKER, media_url: '',
                    actor_key: 'admin_' + Date.now()
                }]);
                if (res.error) { showToast('发布失败: ' + res.error.message, 'error'); return; }
            }
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

    (function() {
        var saved = localStorage.getItem('xtj-admin-theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }

        if (hasSession()) {
            initAdminClient();
        }
    })();

    var reportsData = [];

    function parseReportFromPost(p) {
        var c = {};
        try { c = JSON.parse(p.content || '{}'); } catch(e) {}
        return {
            id: p.id,
            created_at: p.created_at,
            reporter_name: p.user_name,
            target_type: c.target_type || 'post',
            target_id: c.target_id || '',
            target_user: c.target_user || '',
            report_category: c.report_category || '',
            report_reason: c.report_reason || '',
            status: c.status || 'pending',
            admin_response: c.admin_response || null,
            reviewed_at: c.reviewed_at || null,
            reviewed_by: c.reviewed_by || null,
            response_at: c.response_at || null
        };
    }

    async function updateReportInPost(id, updates) {
        var { data: post, error: getErr } = await sb.from('posts').select('id, content').eq('id', id).maybeSingle();
        if (getErr) throw getErr;
        if (!post) throw new Error('举报记录不存在');
        var c = {};
        try { c = JSON.parse(post.content || '{}'); } catch(e) {}
        Object.keys(updates).forEach(function(k) { c[k] = updates[k]; });
        var { error: updErr } = await sb.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
        if (updErr) throw updErr;
    }

    async function loadReportsData() {
        try {
            if (API_BASE && getToken()) {
                var data = await apiCall('GET', '/admin/reports');
                reportsData = data.data || [];
            } else {
                var res = await sb.from('posts').select('*').eq('media_type', REPORT_MARKER).order('created_at', { ascending: false }).limit(500);
                reportsData = (res.data || []).map(parseReportFromPost);
            }
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
                if (API_BASE && getToken()) {
                    await apiCall('POST', '/admin/report/' + id + '/delete-post');
                } else {
                    if (r && (r.target_type === 'post' || r.target_type === 'photo')) {
                        var postRes = await sb.from('posts').select('actor_key').eq('id', r.target_id).maybeSingle();
                        var actorKey = (postRes && postRes.data && postRes.data.actor_key) || 'admin_' + Date.now();
                        await sb.rpc('delete_post_with_actor', { p_post_id: r.target_id, p_actor_key: actorKey });
                    }
                    await updateReportInPost(id, { status: 'actioned', reviewed_at: new Date().toISOString(), reviewed_by: ADMIN });
                }
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
                if (API_BASE && getToken()) {
                    await apiCall('POST', '/admin/report/' + id + '/ban-user', { duration_hours: 72 });
                } else {
                    await updateReportInPost(id, { status: 'actioned', reviewed_at: new Date().toISOString(), reviewed_by: ADMIN });
                    // 封禁用户
                    var existing = await sb.from('bans').select('id, is_active').eq('user_name', r.target_user);
                    var banData = { user_name: r.target_user, ban_type: 'temporary', ban_reason: '举报处理：' + (r.report_reason || '违规内容'), ban_duration_hours: 72, banned_by: ADMIN, is_active: true };
                    if (existing && existing.data && existing.data.length) {
                        await sb.from('bans').update(banData).eq('id', existing.data[0].id);
                    } else {
                        banData.expires_at = new Date(Date.now() + 72 * 3600000).toISOString();
                        await sb.from('bans').insert([banData]);
                    }
                }
                await loadReportsData();
                await loadBansData();
                document.querySelector('.report-detail-modal')?.remove();
                renderTab('reports');
                showToast('用户已封禁，举报已处理', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    window.doMarkReportActioned = function(id) {
        showConfirm('标记处理', '确认将此举报标记为已处理？', '确认', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('PUT', '/admin/report/' + id, { status: 'actioned' });
                } else {
                    await updateReportInPost(id, { status: 'actioned', reviewed_at: new Date().toISOString(), reviewed_by: ADMIN });
                }
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
            if (API_BASE && getToken()) {
                apiCall('PUT', '/admin/report/' + id + '/respond', { response: response }).then(async function() {
                    await loadReportsData();
                    document.querySelector('.report-detail-modal')?.remove();
                    renderTab('reports');
                    showToast('已回复并处理', 'success');
                }).catch(function(e) { showToast('操作失败: ' + e.message, 'error'); });
            } else {
                updateReportInPost(id, {
                    admin_response: response,
                    response_at: new Date().toISOString(),
                    status: 'actioned',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: ADMIN
                }).then(async function() {
                    await loadReportsData();
                    document.querySelector('.report-detail-modal')?.remove();
                    renderTab('reports');
                    showToast('已回复并处理', 'success');
                }).catch(function(e) { showToast('操作失败: ' + e.message, 'error'); });
            }
        } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
    };

    window.dismissReport = function(id) {
        showConfirm('驳回举报', '确认将此举报标记为已驳回？', '确认驳回', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('PUT', '/admin/report/' + id, { status: 'dismissed' });
                } else {
                    await updateReportInPost(id, { status: 'dismissed', reviewed_at: new Date().toISOString(), reviewed_by: ADMIN });
                }
                await loadReportsData();
                renderTab('reports');
                showToast('举报已驳回', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    var bansData = [];

    async function loadBansData() {
        try {
            if (API_BASE && getToken()) {
                var data = await apiCall('GET', '/admin/bans');
                bansData = data.data || [];
            } else {
                var res = await sb.from('bans').select('*').order('banned_at', { ascending: false }).limit(500);
                bansData = res.data || [];
            }
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
            if (API_BASE && getToken()) {
                await apiCall('POST', '/admin/ban', { user_name: userName, duration_hours: duration, reason: reason || '违反社区规定' });
            } else {
                var banType = duration === 0 ? 'permanent' : 'temporary';
                var expiresAt = null;
                if (duration > 0) { var d = new Date(); d.setHours(d.getHours() + duration); expiresAt = d.toISOString(); }
                var { data: existingBans, error: findErr } = await sb.from('bans').select('id, is_active').eq('user_name', userName);
                if (findErr) { showToast('查询失败: ' + findErr.message, 'error'); return; }
                if (existingBans && existingBans.length) {
                    var activeBan = existingBans.find(function(b) { return b.is_active; });
                    if (activeBan) { showToast('该用户已被拉黑封禁', 'error'); return; }
                    var { error: updErr } = await sb.from('bans').update({ ban_reason: reason || '违反社区规定', ban_duration_hours: duration, ban_type: banType, banned_by: ADMIN, expires_at: expiresAt, is_active: true, banned_at: new Date().toISOString() }).eq('id', existingBans[0].id);
                    if (updErr) { showToast('拉黑封禁失败: ' + updErr.message, 'error'); return; }
                } else {
                    var { error } = await sb.from('bans').insert([{ user_name: userName, ban_type: banType, ban_reason: reason || '违反社区规定', ban_duration_hours: duration, banned_by: ADMIN, expires_at: expiresAt, is_active: true }]);
                    if (error) {
                        if (error.code === '23505') {
                            var { error: updErr2 } = await sb.from('bans').update({ ban_reason: reason || '违反社区规定', ban_duration_hours: duration, ban_type: banType, banned_by: ADMIN, expires_at: expiresAt, is_active: true, banned_at: new Date().toISOString() }).eq('user_name', userName);
                            if (updErr2) { showToast('拉黑封禁失败: ' + updErr2.message, 'error'); return; }
                        } else { showToast('拉黑封禁失败: ' + error.message, 'error'); return; }
                    }
                }
            }
            document.querySelector('.report-detail-modal')?.remove();
            await loadBansData();
            renderTab('bans');
            showToast('已拉黑封禁 ' + userName, 'success');
        } catch(e) { showToast('拉黑封禁失败: ' + e.message, 'error'); }
    };

    window.liftBan = function(id) {
        showConfirm('解除拉黑封禁', '确认解除该用户的拉黑封禁？', '确认解除', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('PUT', '/admin/ban/' + id + '/lift');
                } else {
                    await sb.from('bans').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN }).eq('id', id);
                }
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
            if (API_BASE && getToken()) {
                var data = await apiCall('GET', '/admin/mutes');
                mutesData = data.data || [];
            } else {
                var res = await sb.from('mutes').select('*').order('created_at', { ascending: false }).limit(500);
                mutesData = res.data || [];
            }
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
            if (API_BASE && getToken()) {
                await apiCall('POST', '/admin/mute', { user_name: userName, duration_hours: duration, reason: reason || '违反社区规定' });
            } else {
                var expiresAt = null;
                if (duration > 0) { var d = new Date(); d.setHours(d.getHours() + duration); expiresAt = d.toISOString(); }
                var { error } = await sb.from('mutes').insert([{ user_name: userName, reason: reason || '违反社区规定', duration_hours: duration, muted_by: ADMIN, expires_at: expiresAt, is_active: true }]);
                if (error) { showToast('禁言失败: ' + error.message, 'error'); return; }
            }
            document.querySelector('.report-detail-modal')?.remove();
            await loadMutesData();
            renderTab('mutes');
            showToast('已禁言 ' + userName, 'success');
        } catch(e) { showToast('禁言失败: ' + e.message, 'error'); }
    };

    window.liftMute = function(id) {
        showConfirm('解除禁言', '确认解除该用户的禁言？', '确认解除', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('PUT', '/admin/mute/' + id + '/lift');
                } else {
                    await sb.from('mutes').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN }).eq('id', id);
                }
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
            } else {
                var res = await sb.from('blacklist').select('*').order('created_at', { ascending: false }).limit(500);
                blacklistData = res.data || [];
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
            if (API_BASE && getToken()) {
                await apiCall('POST', '/admin/blacklist', { user_name: userName, duration_hours: duration, reason: reason || '违反社区规定' });
            } else {
                var expiresAt = null;
                if (duration > 0) { var d = new Date(); d.setHours(d.getHours() + duration); expiresAt = d.toISOString(); }
                var { error } = await sb.from('blacklist').insert([{ user_name: userName, reason: reason || '违反社区规定', duration_hours: duration, added_by: ADMIN, expires_at: expiresAt, is_active: true }]);
                if (error) { showToast('加入黑名单失败: ' + error.message, 'error'); return; }
            }
            document.querySelector('.report-detail-modal')?.remove();
            await loadBlacklistData();
            renderTab('blacklist');
            showToast('已加入黑名单 ' + userName, 'success');
        } catch(e) { showToast('加入黑名单失败: ' + e.message, 'error'); }
    };

    window.liftBlacklist = function(id) {
        showConfirm('解除黑名单', '确认解除该用户的黑名单？', '确认解除', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('PUT', '/admin/blacklist/' + id + '/lift');
                } else {
                    await sb.from('blacklist').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN }).eq('id', id);
                }
                await loadBlacklistData();
                renderTab('blacklist');
                showToast('已解除黑名单', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    var photosAdminData = [];

    async function loadPhotosAdminData() {
        try {
            var res = await sb.from('posts').select('id,user_name,media_url,content,created_at,views,actor_key').eq('media_type', '__photo_wall__').order('created_at', { ascending: false }).limit(500);
            photosAdminData = res.data || [];
        } catch(e) { photosAdminData = []; }
    }

    async function renderPhotosTab(el) {
        if (!photosAdminData.length) { await loadPhotosAdminData(); }
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + photosAdminData.length + '</div><div class="lbl">总照片数</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>照片管理</h3>';
        if (!photosAdminData.length) {
            h += '<div class="empty">暂无照片数据</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>缩略图</th><th>用户</th><th>大小</th><th>浏览</th><th>上传时间</th><th>操作</th></tr></thead><tbody>';
            photosAdminData.forEach(function(p) {
                var extra = {};
                try { extra = JSON.parse(p.content || '{}'); } catch(e) {}
                var thumbUrl = extra.thumb || p.media_url || '';
                var thumbHtml = thumbUrl ? '<img src="' + thumbUrl + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" loading="lazy">' : '-';
                h += '<tr><td>' + thumbHtml + '</td>';
                h += '<td>' + escapeHtml(p.user_name || '') + '</td>';
                h += '<td>' + (extra.fileSize ? (extra.fileSize / 1024).toFixed(0) + 'KB' : '-') + '</td>';
                h += '<td>' + (p.views || 0) + '</td>';
                h += '<td>' + formatTime(p.created_at) + '</td>';
                h += '<td><button class="btn-sm del" onclick="deleteAdminPhoto(\'' + p.id + '\', \'' + (p.actor_key || '') + '\')">删除</button></td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.deleteAdminPhoto = function(id, actorKey) {
        showConfirm('删除照片', '确认删除此照片？此操作不可恢复。', '确认删除', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('DELETE', '/admin/photo/' + id);
                } else {
                    await sb.from('posts').delete().eq('id', id);
                }
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
                // 模式1：通过后端 API
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
            } else if (sb) {
                // 模式2：直连 Supabase（全部并行查询，只取必要字段，极速加载）
                var EXCLUDE = [AUTH_MARKER, DM_MARKER, REPORT_MARKER, '__user_info__', '__visit__', '__attack__', '__user_visit__'];
                var BASE_FILTER = function(q) {
                    EXCLUDE.forEach(function(m) { q = q.neq('media_type', m); });
                    return q.neq('media_type', '__avatar__');
                };

                // 日期筛选辅助：对数据查询添加数据库级日期过滤
                var sd = window.statsDateStart, ed = window.statsDateEnd;
                function dateFilter(q, field) {
                    if (sd) q = q.gte(field, sd);
                    if (ed) q = q.lte(field, ed);
                    return q;
                }
                function dateCreatedFilter(q) {
                    if (sd) q = q.gte('created_at', sd + 'T00:00:00.000Z');
                    if (ed) q = q.lte('created_at', ed + 'T23:59:59.999Z');
                    return q;
                }
                // 有日期筛选时不需要limit（数据库已过滤），否则保留较大limit
                var dataLimit = (sd || ed) ? undefined : 100000;

                // 并行发起所有查询（只取需要的字段，大幅减少数据传输）
                var Q = [
                    // 0: 帖子计数
                    BASE_FILTER(sb.from('posts').select('id', { count: 'exact', head: true })).limit(5000),
                    // 1: 点赞计数
                    sb.from('likes').select('id', { count: 'exact', head: true }).limit(5000),
                    // 2: 评论计数
                    sb.from('comments').select('id', { count: 'exact', head: true }).limit(5000),
                    // 3: 用户信息计数
                    sb.from('posts').select('id', { count: 'exact', head: true }).eq('media_type', '__user_info__').limit(5000),
                    // 4: IP访问计数
                    sb.from('posts').select('id', { count: 'exact', head: true }).eq('media_type', '__visit__').limit(5000),
                    // 5: 攻击计数
                    sb.from('posts').select('id', { count: 'exact', head: true }).eq('media_type', '__attack__').limit(5000),
                    // 6: 用户访问计数
                    sb.from('posts').select('id', { count: 'exact', head: true }).eq('media_type', '__user_visit__').limit(5000),
                    // 7: 每日帖子 created_at（有日期筛选时数据库级过滤）
                    dateCreatedFilter(BASE_FILTER(sb.from('posts').select('created_at'))),
                    // 8: 每日评论 created_at
                    dateCreatedFilter(sb.from('comments').select('created_at')),
                    // 9: 每日点赞 created_at
                    dateCreatedFilter(sb.from('likes').select('created_at')),
                    // 10: 每日新用户 created_at
                    dateCreatedFilter(sb.from('posts').select('created_at').eq('media_type', '__user_info__')),
                    // 11: 每日访问（IP级）media_url, content
                    dateFilter(sb.from('posts').select('media_url, content').eq('media_type', '__visit__'), 'media_url'),
                    // 12: 每日用户访问 media_url, content
                    dateFilter(sb.from('posts').select('media_url, content').eq('media_type', '__user_visit__'), 'media_url'),
                    // 13: 每日攻击 media_url, content
                    dateCreatedFilter(sb.from('posts').select('media_url, content').eq('media_type', '__attack__')),
                    // 14: 照片计数 media_url
                    BASE_FILTER(sb.from('posts').select('media_url')).limit(5000),
                ];

                // 对数据查询（7-14）在无日期筛选时设置limit
                for (var i = 7; i <= 13; i++) {
                    if (dataLimit && Q[i]) Q[i] = Q[i].limit(dataLimit);
                }
                // 注意：query 14 照片计数仍保留原limit(5000)

                var results = await Promise.all(Q.map(function(q) { return q; }));

                // 汇总计数（从 count 查询获取）
                var totalPosts = results[0].count || 0;
                var totalLikes = results[1].count || 0;
                var totalComments = results[2].count || 0;
                var totalUsers = results[3].count || 0;
                var totalIpVisits = results[4].count || 0;
                var totalAttacks = results[5].count || 0;
                var totalUserVisits = results[6].count || 0;

                // 照片计数
                var photoCount = 0;
                (results[14].data || []).forEach(function(p) {
                    if (p.media_url && /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(p.media_url)) photoCount++;
                });

                // 攻击类型分布
                var attackTypes = {};
                (results[13].data || []).forEach(function(a) {
                    var ct = a.content || '';
                    var type = '未知';
                    if (ct.indexOf('RATE_LIMIT') >= 0) type = 'RATE_LIMIT';
                    else if (ct.indexOf('CSRF') >= 0) type = 'CSRF';
                    else if (ct.indexOf('CORS') >= 0) type = 'CORS';
                    else if (ct.indexOf('XSS') >= 0) type = 'XSS';
                    else if (ct.indexOf('PATH') >= 0) type = 'PATH_TRAVERSAL';
                    else type = ct.slice(0, 30) || '未知';
                    attackTypes[type] = (attackTypes[type] || 0) + 1;
                });
                // API防火墙拦截 = RATE_LIMIT + CORS + CSRF（API层面的拦截）
                var firewallIntercepts = (attackTypes['CORS'] || 0) + (attackTypes['CSRF'] || 0);

                summary = {
                    total_users: totalUsers,
                    total_posts: totalPosts,
                    total_comments: totalComments,
                    total_likes: totalLikes,
                    total_photos: photoCount,
                    total_visits: totalIpVisits + totalUserVisits,
                    total_attacks: totalAttacks,
                    firewall_intercepts: firewallIntercepts,
                    attack_types: attackTypes,
                    cached_at: new Date().toISOString()
                };

                // 每日数据聚合
                var dailyMap = {};

                function addToDaily(date, key, val) {
                    if (!date) return;
                    if (window.statsDateStart && date < window.statsDateStart) return;
                    if (window.statsDateEnd && date > window.statsDateEnd) return;
                    if (!dailyMap[date]) {
                        dailyMap[date] = { date: date, visits: 0, attacks: 0, posts: 0, comments: 0, likes: 0, new_users: 0 };
                    }
                    dailyMap[date][key] = (dailyMap[date][key] || 0) + val;
                }

                function addList(data, key, dateField) {
                    (data || []).forEach(function(item) {
                        var d = dateField === 'created_at' ? (item.created_at || '').slice(0, 10) : (item.media_url || '');
                        if (!d && dateField === 'media_url') {
                            try { var c = JSON.parse(item.content || '{}'); d = c.date || ''; } catch(e) {}
                        }
                        addToDaily(d, key, 1);
                    });
                }

                addList(results[7].data, 'posts', 'created_at');
                addList(results[8].data, 'comments', 'created_at');
                addList(results[9].data, 'likes', 'created_at');
                addList(results[10].data, 'new_users', 'created_at');
                addList(results[11].data, 'visits', 'media_url');
                addList(results[12].data, 'visits', 'media_url');
                addList(results[13].data, 'attacks', 'created_at');

                dailyData = { daily: Object.values(dailyMap).sort(function(a, b) { return a.date.localeCompare(b.date); }) };
            }

            if (!summary) {
                el.innerHTML = '<div class="empty-state"><div class="icon">📊</div><div class="text">统计数据加载失败：无法连接后端 API 或 Supabase</div></div>';
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
                h += '<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:8px;">数据缓存时间: ' + formatTime(summary.cached_at) + (API_BASE && getToken() ? '（每60秒刷新）' : '（直连Supabase实时查询）') + '</div>';
            }

            el.innerHTML = h;

            // ===== 异步加载用户访问明细 =====
            loadUserVisitStats(el);
        } catch(e) {
            el.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div class="text">统计数据加载失败: ' + escapeHtml(e.message) + '</div></div>';
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
            } else if (sb) {
                // Supabase 直接模式（并行查询 + 只取必要字段）
                var uvR = sb.from('posts').select('user_name, media_url, content, created_at').eq('media_type', '__user_visit__').order('created_at', { ascending: false }).limit(5000);
                var uiR = sb.from('posts').select('user_name, content, created_at').eq('media_type', '__user_info__').order('created_at', { ascending: false }).limit(5000);

                var uvRes = await uvR, uiRes = await uiR;
                var userVisitsData = uvRes.data || [];
                var userInfoList = uiRes.data || [];

                // 按用户聚合
                var userVisitMap = {};
                userVisitsData.forEach(function(v) {
                    var name = v.user_name;
                    if (!name) return;
                    if (!userVisitMap[name]) userVisitMap[name] = { total: 0, daily: {}, last_visit: '' };
                    userVisitMap[name].total++;
                    var d = v.media_url || '';
                    if (!d) { try { var c = JSON.parse(v.content || '{}'); d = c.date || ''; } catch(e) {} }
                    if (d) userVisitMap[name].daily[d] = (userVisitMap[name].daily[d] || 0) + 1;
                    var vt = v.created_at || '';
                    if (vt && vt > userVisitMap[name].last_visit) userVisitMap[name].last_visit = vt;
                });

                var userInfoMap = {};
                userInfoList.forEach(function(ui) {
                    try {
                        var parsed = JSON.parse(ui.content || '{}');
                        // 保留最早（最旧）的 reg_time，只覆盖更新 last_login
                        if (userInfoMap[ui.user_name]) {
                            if (parsed.last_login) userInfoMap[ui.user_name].last_login = parsed.last_login;
                            if (parsed.reg_time && (!userInfoMap[ui.user_name].reg_time || parsed.reg_time < userInfoMap[ui.user_name].reg_time)) {
                                userInfoMap[ui.user_name].reg_time = parsed.reg_time;
                            }
                        } else {
                            userInfoMap[ui.user_name] = parsed;
                        }
                    } catch(e) {}
                });

                var users = Object.keys(userVisitMap).map(function(name) {
                    var v = userVisitMap[name];
                    var info = userInfoMap[name] || {};
                    return {
                        user_name: name,
                        total_visits: v.total,
                        daily_visits: v.daily,
                        last_visit: v.last_visit || info.last_login || null,
                        last_login: info.last_login || null,
                        reg_time: info.reg_time || null
                    };
                });
                users.sort(function(a, b) { return b.total_visits - a.total_visits; });

                userData = { users: users, total: users.length };
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
        ['ann','users','posts','likes','comments','reports','bans','mutes','blacklist','photos','stats'].forEach(function(t) {
            var panel = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
            var btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1) + 'Btn');
            if (panel) panel.classList.remove('active');
            if (btn) btn.classList.remove('active');
        });
        var panel = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
        var btn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Btn');
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        window.renderTab(tab);
    };

    var _origRenderTab = window.renderTab;
    window.renderTab = function(tab) {
        var el = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
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
        }
    };

    window.quickBlacklistUser = function(userName) {
        var hours = prompt('请输入拉黑时长（小时），0=永久拉黑：', '24');
        if (hours === null) return;
        hours = parseInt(hours, 10);
        if (isNaN(hours) || hours < 0) { showToast('请输入有效的小时数', 'error'); return; }
        showConfirm('加入黑名单', '确认将 ' + userName + (hours > 0 ? ' 拉黑 ' + hours + ' 小时' : ' 永久拉黑') + '？', '确认拉黑', async function() {
            try {
                if (API_BASE && getToken()) {
                    await apiCall('POST', '/admin/blacklist', {
                        user_name: userName,
                        duration_hours: hours,
                        reason: '管理员操作'
                    });
                } else {
                    var expiresAt = null;
                    if (hours > 0) {
                        var d = new Date();
                        d.setHours(d.getHours() + hours);
                        expiresAt = d.toISOString();
                    }
                    if (findActiveRecordByUser(blacklistData, userName)) {
                        showToast('该用户已在黑名单中', 'error');
                        return;
                    }
                    var insertRes = await sb.from('blacklist').insert([{
                        user_name: userName,
                        reason: '管理员操作',
                        duration_hours: hours,
                        added_by: ADMIN,
                        expires_at: expiresAt,
                        is_active: true
                    }]);
                    if (insertRes.error) {
                        showToast('拉黑失败: ' + insertRes.error.message, 'error');
                        return;
                    }
                }
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
                return (b.info && b.info.last_login ? new Date(b.info.last_login).getTime() : 0) - (a.info && a.info.last_login ? new Date(a.info.last_login).getTime() : 0);
            }
            return (b.info && b.info.reg_time ? new Date(b.info.reg_time).getTime() : 0) - (a.info && a.info.reg_time ? new Date(a.info.reg_time).getTime() : 0);
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
                var regTime = u.info && u.info.reg_time ? formatTime(u.info.reg_time) : '-';
                var lastLogin = u.info && u.info.last_login ? formatTime(u.info.last_login) : '-';
                h += '<div class="user-card' + (flags.isBanned ? ' is-banned' : '') + (flags.isMuted ? ' is-muted' : '') + (flags.isAdmin ? ' is-admin' : '') + '">';
                h += '<div class="user-card-head"><div class="user-avatar' + (flags.isAdmin ? ' admin-avatar' : (flags.isBanned ? ' banned-avatar' : (flags.isMuted ? ' muted-avatar' : ''))) + '">' + escapeHtml((u.name || '?').slice(0, 1).toUpperCase()) + '</div><div class="user-card-name"><strong>' + escapeHtml(u.name) + '</strong><div class="user-tags">' + buildUserTagMarkup(flags) + '</div></div></div>';
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
        h += '</select></div>';

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
            if (userSortBy === 'login') return (b.info && b.info.last_login ? new Date(b.info.last_login).getTime() : 0) - (a.info && a.info.last_login ? new Date(a.info.last_login).getTime() : 0);
            return (b.info && b.info.reg_time ? new Date(b.info.reg_time).getTime() : 0) - (a.info && a.info.reg_time ? new Date(a.info.reg_time).getTime() : 0);
        });

        h += '<div class="card"><h3>用户列表 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + filtered.length + ' 位用户</span></h3>';
        if (!filtered.length) {
            h += '<div class="empty">没有匹配用户</div>';
        } else {
            h += '<div class="admin-stack-list">';
            filtered.forEach(function(u) {
                var stats = getUserActivityStats(u.name);
                var flags = getUserStateFlags(u.name);
                var safeName = u.name.replace(/'/g, "\\'");
                var actions = flags.isAdmin
                    ? '<span style="color:var(--text-muted);font-size:12px;">管理员不可操作</span>'
                    : '<button class="btn-sm" onclick="quickMuteUser(\'' + safeName + '\')">禁言</button><button class="btn-sm del" onclick="quickBanUser(\'' + safeName + '\')">封禁</button>';
                h += buildAdminStackItemV2({
                    itemClass: (flags.isBanned ? 'is-banned ' : '') + (flags.isMuted ? 'is-muted ' : '') + (flags.isAdmin ? 'is-admin' : ''),
                    title: escapeHtml(u.name),
                    tags: '<div class="user-tags">' + window.buildUserTagMarkup(flags) + '</div>',
                    metrics: '<span>帖子 ' + stats.posts + '</span><span>点赞 ' + stats.likes + '</span><span>评论 ' + stats.comments + '</span>',
                    meta: '<span>注册时间：' + escapeHtml(u.info && u.info.reg_time ? formatTime(u.info.reg_time) : '-') + '</span><span>最近登录：' + escapeHtml(u.info && u.info.last_login ? formatTime(u.info.last_login) : '-') + '</span>',
                    badge: flags.isBanned ? '<span class="badge badge-red">封禁中</span>' : (flags.isMuted ? '<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;">禁言中</span>' : '<span class="badge badge-green">正常</span>'),
                    actions: actions
                });
            });
            h += '</div>';
        }
        h += '</div>';
        el.innerHTML = h;
    };

    renderBansTab = async function(el) {
        if (!bansData.length) await loadBansData();
        var active = bansData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + bansData.length + '</div><div class="lbl">总封禁记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前封禁</div></div>';
        h += '</div>';
        h += '<div class="card"><h3>快速封禁用户</h3>' + buildAdminActionToolbar('banUserName', 'banDuration', 'banReason', '封禁时长', '封禁原因', '输入封禁原因') + buildAdminActionUserCards('ban') + '</div>';
        h += '<div class="card"><h3>封禁记录</h3>' + buildAdminModerationRecordListV2('ban', bansData) + '</div>';
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
        h += '<div class="card"><h3>禁言记录</h3>' + buildAdminModerationRecordListV2('mute', mutesData) + '</div>';
        el.innerHTML = h;
    };

    var _origSwitchTabV2 = window.switchTab;
    window.switchTab = function(tab) {
        var normalized = tab === 'blacklist' ? 'bans' : tab;
        var allTabs = ['ann','stats','users','posts','likes','comments','reports','bans','mutes','photos'];
        currentTab = normalized;
        localStorage.setItem('admin_tab', normalized);
        allTabs.forEach(function(t) {
            var panel = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
            var btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1) + 'Btn');
            if (panel) panel.classList.remove('active');
            if (btn) btn.classList.remove('active');
        });
        var panel = document.getElementById('tab' + normalized.charAt(0).toUpperCase() + normalized.slice(1));
        var btn = document.getElementById('tab' + normalized.charAt(0).toUpperCase() + normalized.slice(1) + 'Btn');
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        window.renderTab(normalized);
    };

    window.renderTab = function(tab) {
        var normalized = tab === 'blacklist' ? 'bans' : tab;
        var el = document.getElementById('tab' + normalized.charAt(0).toUpperCase() + normalized.slice(1));
        if (!el) return;
        switch(normalized) {
            case 'ann': renderAnnTab(el); break;
            case 'users': renderUsersTab(el); break;
            case 'posts': renderPostsTab(el); break;
            case 'likes': renderLikesTab(el); break;
            case 'comments': renderCommentsTab(el); break;
            case 'reports': renderReportsTab(el); break;
            case 'bans': renderBansTab(el); break;
            case 'mutes': renderMutesTab(el); break;
            case 'photos': renderPhotosTab(el); break;
            case 'stats': renderStatsTab(el); break;
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
                allPosts = postData.filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__'; });
                annList = postData.filter(function(p) { return p.media_type === ANN_MARKER; });
                allLikes = apiData.likes || [];
                allComments = apiData.comments || [];
                reportsData = apiData.reports || [];
                updateReportBadge();
                bansData = apiData.bans || [];
                mutesData = apiData.mutes || [];
                blacklistData = apiData.blacklist || [];
            } else {
                var postRes = await sb.from('posts').select('*').neq('media_type', '__avatar__').order('created_at', {ascending: false}).limit(5000);
                var likeRes = await sb.from('likes').select('*').order('created_at', {ascending: false}).limit(5000);
                var commRes = await sb.from('comments').select('*').order('created_at', {ascending: false}).limit(5000);
                allPosts = (postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== REPORT_MARKER && p.media_type !== '__user_info__'; });
                annList = (postRes.data || []).filter(function(p) { return p.media_type === ANN_MARKER; });
                allLikes = likeRes.data || [];
                allComments = commRes.data || [];
                await loadReportsData();
                await loadBansData();
                await loadMutesData();
                await loadBlacklistData();
            }

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });

            var userInfoList = [];
            if (API_BASE && getToken()) {
                try { var userRes = await apiCall('GET', '/admin/users'); userInfoList = userRes.data || []; } catch(e) {}
            }
            if (!userInfoList.length) {
                userInfoList = (sb ? (await sb.from('posts').select('user_name, content, created_at').eq('media_type', '__user_info__').order('created_at', {ascending: false}).limit(5000)).data : []) || [];
            }

            var userInfoMap = {};
            userInfoList.forEach(function(ui) {
                try { if (!userInfoMap[ui.user_name]) { var info = JSON.parse(ui.content); userInfoMap[ui.user_name] = info; userMap[ui.user_name] = true; } } catch(e) {}
            });

            allUsers = Object.keys(userMap).sort().map(function(u) {
                return { name: u, info: userInfoMap[u] || null };
            });

            if (!API_BASE || !getToken()) {
                await loadReportsData();
                await loadBansData();
                await loadMutesData();
                await loadBlacklistData();
            }
            await loadPhotosAdminData();

            if (!keepTab) { switchTab('ann'); }
            else { window.renderTab(currentTab); }
        } catch(e) {
            showToast('数据加载失败，请刷新重试', 'error');
        }
    };
})();
