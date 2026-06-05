(function() {
    var SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";
    var ADMIN = "xxz";
    var ADMIN_PW = "xxz123";
    var AUTH_MARKER = "__auth__";
    var DM_MARKER = "__dm__";
    var ANN_MARKER = "__ann__";
    var SESSION_KEY = "xtj_admin_session";
    var TAB_KEY = "xtj_admin_tab";

    var sb = null;
    var allPosts = [], allLikes = [], allComments = [], allUsers = [], annList = [];
    var searchUser = '', searchPost = '';
    var userFilterStatus = 'all'; // all | admin | banned | muted
    var userSortBy = 'reg'; // reg | login | posts
    var confirmCallback = null;
    var currentTab = 'ann';

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
    }

    function hasSession() {
        try {
            var raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return false;
            var s = JSON.parse(raw);
            return (Date.now() - s.t) < 24 * 60 * 60 * 1000;
        } catch(e) { return false; }
    }

    async function initAdminClient() {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        document.getElementById('loginWrap').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        saveSession();
        
        var savedTab = localStorage.getItem(TAB_KEY);
        if (savedTab && ['ann','users','posts','likes','comments','reports','bans','mutes','photos'].indexOf(savedTab) !== -1) {
            currentTab = savedTab;
            await loadAllData(true);
            ['ann','users','posts','likes','comments','reports','bans','mutes','photos'].forEach(function(t) {
                document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.remove('active');
                document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1) + 'Btn').classList.remove('active');
            });
            document.getElementById('tab' + savedTab.charAt(0).toUpperCase() + savedTab.slice(1)).classList.add('active');
            document.getElementById('tab' + savedTab.charAt(0).toUpperCase() + savedTab.slice(1) + 'Btn').classList.add('active');
        } else {
            await loadAllData();
        }
    }

    window.doAdminLogin = async function() {
        var name = document.getElementById('loginName').value.trim();
        var pw = document.getElementById('loginPw').value;
        var err = document.getElementById('loginErr');
        if (name !== ADMIN) { err.textContent = '账号不正确'; return; }
        if (pw !== ADMIN_PW) { err.textContent = '密码错误'; return; }
        err.textContent = '';
        await initAdminClient();
    };

    window.doAdminLogout = function() {
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
            var postRes = await sb.from('posts').select('*').neq('media_type', '__avatar__').order('created_at', {ascending: false}).limit(5000);
            var likeRes = await sb.from('likes').select('*').order('created_at', {ascending: false}).limit(5000);
            var commRes = await sb.from('comments').select('*').order('created_at', {ascending: false}).limit(5000);

            allPosts = (postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__user_info__'; });
            annList = (postRes.data || []).filter(function(p) { return p.media_type === ANN_MARKER; });
            allLikes = likeRes.data || [];
            allComments = commRes.data || [];

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });
            
            var userInfoList = (postRes.data || []).filter(function(p) { return p.media_type === '__user_info__'; });
            // 注意：postRes 按 created_at DESC 排序（最新在前）
            // 所以对于每个用户，只取第一条（最新）记录，避免被旧记录覆盖
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

            await loadBansData();
            await loadMutesData();

            if (!keepTab) {
                switchTab('ann');
            } else {
                renderTab(currentTab);
            }
        } catch(e) {
            console.error(e);
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

    /* function buildAdminUserPicker(inputId, listId, placeholder) {
        var users = getSelectableAdminUsers();
        var options = users.map(function(name) {
            return '<option value="' + escapeHtml(name) + '"></option>';
        }).join('');
        return [
            '<div class="admin-user-picker">',
            '<input id="' + inputId + '" class="admin-user-input" list="' + listId + '" placeholder="' + escapeHtml(users.length ? (placeholder || '选择用户') : '暂无可选用户') + '" autocomplete="off" spellcheck="false" onfocus="showAdminUserPicker(\\'' + inputId + '\\')" onclick="showAdminUserPicker(\\'' + inputId + '\\")"' + (users.length ? '' : ' disabled') + '>',
            '<datalist id="' + listId + '">' + options + '</datalist>',
            '</div>'
        ].join('');
    } */

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

    /* function buildAdminUserPicker(inputId, listId, placeholder) {
        var users = getSelectableAdminUsers();
        var options = users.map(function(name) {
            return '<option value="' + escapeHtml(name) + '"></option>';
        }).join('');
        var placeholderText = users.length ? (placeholder || '选择用户') : '暂无可选用户';
        return [
            '<div class="admin-user-picker">',
            '<input id="' + inputId + '" class="admin-user-input" list="' + listId + '" placeholder="' + escapeHtml(placeholderText) + '" autocomplete="off" spellcheck="false" onfocus="showAdminUserPicker(\'' + inputId + '\')" onclick="showAdminUserPicker(\'' + inputId + '\')"' + (users.length ? '' : ' disabled') + '>',
            '<datalist id="' + listId + '">' + options + '</datalist>',
            '</div>'
        ].join('');
    } */

    function buildAdminUserPicker(inputId, listId, placeholder) {
        var users = getSelectableAdminUsers();
        var options = users.map(function(name) {
            return '<option value="' + escapeHtml(name) + '"></option>';
        }).join('');
        var placeholderText = users.length ? (placeholder || '选择用户') : '暂无可选用户';
        return [
            '<div class="admin-user-picker">',
            '<input id="' + inputId + '" class="admin-user-input" list="' + listId + '" placeholder="' + escapeHtml(placeholderText) + '" autocomplete="off" spellcheck="false" onfocus="showAdminUserPicker(\'' + inputId + '\')" onclick="showAdminUserPicker(\'' + inputId + '\')"' + (users.length ? '' : ' disabled') + '>',
            '<datalist id="' + listId + '">' + options + '</datalist>',
            '</div>'
        ].join('');
    }

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
        var h = '<div class="card"><h3>📢 发布新公告</h3>';
        h += '<input type="text" id="adminAnnTitleInp" placeholder="输入公告标题（可选）" style="width:100%;margin-bottom:8px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,0.15);font-size:14px;outline:none;box-sizing:border-box;">';
        h += '<textarea id="adminAnnInp" placeholder="输入公告内容（可选）" maxlength="2000"></textarea>';
        h += '<div class="publish-row"><button class="btn-sm primary" onclick="publishAdminAnn()">发布公告</button></div></div>';
        h += '<div class="card"><h3>📋 公告列表（' + annList.length + '条）</h3>';
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

        // 筛选排序栏
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

        // 筛选
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

        // 排序
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

        h += '<div class="card"><h3>👥 用户列表 <span style="font-weight:400;font-size:12px;color:var(--text-muted);">共 ' + filtered.length + ' 位用户</span></h3>';
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
                    h += '<button class="btn-sm" onclick="quickMuteUser(\'' + safeName + '\')" style="margin-right:4px;">🤐禁言</button>';
                    h += '<button class="btn-sm" onclick="quickBanUser(\'' + safeName + '\')">🔒拉黑</button>';
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

    // ===================== 用户列表一键操作（拉黑封禁/禁言） =====================
    window.quickMuteUser = function(userName) {
        var hours = prompt('请输入禁言时长（小时），0=永久禁言：', '24');
        if (hours === null) return;
        hours = parseInt(hours);
        if (isNaN(hours) || hours < 0) { showToast('请输入有效的小时数', 'error'); return; }
        showConfirm('禁言用户', '确认禁言 ' + userName + (hours > 0 ? ' ' + hours + '小时' : ' 永久') + '？', '确认禁言', async function() {
            try {
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
                await loadMutesData();
                showToast('✅ 已禁言 ' + userName, 'success');
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
                var expiresAt = null;
                if (hours > 0) {
                    var d = new Date();
                    d.setHours(d.getHours() + hours);
                    expiresAt = d.toISOString();
                }
                var { error } = await sb.from('bans').insert([{
                    user_name: userName,
                    ban_reason: '管理员操作',
                    ban_duration_hours: hours,
                    ban_type: hours > 0 ? 'temporary' : 'permanent',
                    banned_by: ADMIN,
                    expires_at: expiresAt,
                    is_active: true,
                    banned_at: new Date().toISOString()
                }]);
                if (error) { showToast('拉黑封禁失败: ' + error.message, 'error'); return; }
                await loadBansData();
                showToast('✅ 已拉黑封禁 ' + userName, 'success');
            } catch(e) { showToast('拉黑封禁失败: ' + e.message, 'error'); }
        });
    };



    function renderPostsTab(el) {
        var visiblePosts = allPosts.filter(function(p) { return p.media_type !== ANN_MARKER && p.media_type !== '__photo_wall__'; });
        var h = '<div class="card"><h3>📝 帖子管理（' + visiblePosts.length + '条）</h3>';
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
        var h = '<div class="card"><h3>❤️ 点赞记录（' + allLikes.length + '条）</h3>';
        if (!allLikes.length) { h += '<div class="empty">暂无点赞数据</div>'; }
        else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户</th><th>帖子作者</th><th>帖子内容</th><th>时间</th></tr></thead><tbody>';
            var recentLikes = allLikes.slice(0, 500);
            recentLikes.forEach(function(l) {
                var post = allPosts.find(function(p) { return p.id === l.post_id; });
                var rawContent = post ? (post.content || '') : '(已删除)';
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
        var h = '<div class="card"><h3>💬 评论记录（' + allComments.length + '条）</h3>';
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

    window.publishAdminAnn = async function() {
        var titleInp = document.getElementById('adminAnnTitleInp');
        var contentInp = document.getElementById('adminAnnInp');
        var title = (titleInp.value || '').trim();
        var content = (contentInp.value || '').trim();
        
        if (!title && !content) { 
            showToast('请至少填写标题或内容', 'error'); 
            return; 
        }
        
        try {
            var storeData = JSON.stringify({ title: title, content: content });
            var res = await sb.from('posts').insert([{
                user_name: ADMIN, content: storeData,
                media_type: ANN_MARKER, media_url: '',
                actor_key: 'admin_' + Date.now()
            }]);
            if (res.error) { showToast('发布失败: ' + res.error.message, 'error'); return; }
            titleInp.value = '';
            contentInp.value = '';
            await loadAllData(true);
            showToast('公告已发布', 'success');
        } catch(e) { showToast('发布失败: ' + e.message, 'error'); }
    };

    window.deleteAdminAnn = function(id) {
        var ann = annList.find(function(x) { return x.id === id; });
        var preview = ann ? (ann.content || '').slice(0, 50) : '';
        if (preview && ann.content && ann.content.length > 50) preview += '...';
        
        showConfirm(
            '⚠️ 删除公告',
            '您确定要删除此公告吗？\n\n' + (preview ? '公告内容：' + preview + '\n\n' : '') + '删除后所有用户将无法查看此公告，此操作不可恢复。',
            '🗑️ 确认删除',
            async function() {
                try {
                    var key = ann ? ann.actor_key : 'admin_' + Date.now();
                    var res = await sb.rpc('delete_post_with_actor', { p_post_id: id, p_actor_key: key });
                    if (res.error) { showToast('删除失败: ' + res.error.message, 'error'); return; }
                    if (!res.data) { showToast('公告不存在或已被删除', 'info'); }
                    await loadAllData(true);
                    showToast('✅ 公告已成功删除', 'success');
                } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
            }
        );
    };

    window.deleteAdminPost = function(id) {
        var post = allPosts.find(function(x) { return x.id === id; });
        var displayText = post ? getDisplayContent(post.content) : '';
        var preview = (displayText || '').slice(0, 50);
        if (displayText && displayText.length > 50) preview += '...';
        
        showConfirm(
            '⚠️ 删除帖子',
            '您确定要删除此帖子吗？\n\n' + 
            (post ? '发布者：' + (post.user_name || '') + '\n' : '') +
            (preview ? '内容：' + preview + '\n\n' : '') + 
            '删除后此帖子及相关的点赞和评论都会被移除，此操作不可恢复。',
            '🗑️ 确认删除',
            async function() {
                try {
                    var key = post ? post.actor_key : 'admin_' + Date.now();
                    var res = await sb.rpc('delete_post_with_actor', { p_post_id: id, p_actor_key: key });
                    if (res.error) { showToast('删除失败: ' + res.error.message, 'error'); return; }
                    if (!res.data) { showToast('帖子不存在或已被删除', 'info'); }
                    await loadAllData(true);
                    showToast('✅ 帖子已成功删除', 'success');
                } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
            }
        );
    };

    window.deleteAdminComment = function(id, actorKey) {
        var comment = allComments.find(function(c) { return c.id === id; });
        var preview = comment ? (comment.content || '').slice(0, 50) : '';
        if (preview && comment.content && comment.content.length > 50) preview += '...';
        
        showConfirm(
            '⚠️ 删除评论',
            '您确定要删除此评论吗？\n\n' + 
            (comment ? '发布者：' + (comment.user_name || '') + '\n' : '') +
            (preview ? '内容：' + preview + '\n\n' : '') + 
            '评论将标记为删除，但记录会保留在数据库中。',
            '🗑️ 确认删除',
            async function() {
                try {
                    var { data, error } = await sb.rpc('delete_comment_v2', {
                        p_comment_id: id,
                        p_deleted_by: ADMIN
                    });
                    if (error) {
                        showToast('删除失败: ' + error.message, 'error');
                        return;
                    }
                    if (data === true) {
                        await loadAllData(true);
                        showToast('✅ 评论已标记为删除', 'success');
                    } else {
                        showToast('删除失败: 评论不存在或已被删除', 'error');
                    }
                } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
            }
        );
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

    async function loadReportsData() {
        try {
            var res = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(500);
            reportsData = res.data || [];
        } catch(e) {
            reportsData = [];
        }
    }

    async function renderReportsTab(el) {
        if (!reportsData.length) {
            await loadReportsData();
        }
        var h = '<div class="stats-row">';
        var pending = reportsData.filter(function(r) { return r.status === 'pending'; }).length;
        h += '<div class="stat-box"><div class="val">' + reportsData.length + '</div><div class="lbl">总举报数</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + pending + '</div><div class="lbl">待处理</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--primary)">' + reportsData.filter(function(r) { return r.status === 'actioned'; }).length + '</div><div class="lbl">已处理</div></div>';
        h += '</div>';
        
        h += '<div class="card"><h3>🚨 举报列表</h3>';
        if (!reportsData.length) {
            h += '<div class="empty">暂无举报</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>举报人</th><th>类型</th><th>目标</th><th>分类</th><th>原因</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>';
            reportsData.forEach(function(r) {
                var statusBadge = r.status === 'pending' ? '<span class="badge badge-red">待处理</span>' :
                                 r.status === 'reviewed' ? '<span class="badge badge-green">已审阅</span>' :
                                 r.status === 'dismissed' ? '<span class="badge" style="background:rgba(128,128,128,0.15);color:var(--text-muted)">已驳回</span>' :
                                 '<span class="badge badge-green">已处理</span>';
                h += '<tr><td>' + escapeHtml(r.reporter_name) + '</td>';
                h += '<td>' + r.target_type + '</td>';
                h += '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(r.target_id) + '</td>';
                h += '<td>' + r.report_category + '</td>';
                h += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(r.report_reason || '-') + '</td>';
                h += '<td>' + formatTime(r.created_at) + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td style="white-space:nowrap;">';
                if (r.status === 'pending') {
                    h += '<button class="btn-sm primary" onclick="approveReport(\'' + r.id + '\')">处理</button> ';
                    h += '<button class="btn-sm" onclick="dismissReport(\'' + r.id + '\')">驳回</button>';
                } else {
                    h += '<button class="btn-sm" onclick="viewReportDetail(\'' + r.id + '\')">详情</button>';
                }
                h += '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.approveReport = function(id) {
        var r = reportsData.find(function(x) { return x.id === id; });
        showConfirm('处理举报', '确认将此举报标记为"已处理"？\n\n目标：' + (r ? r.target_id : '') + '\n分类：' + (r ? r.report_category : ''), '确认处理', async function() {
            try {
                await sb.from('reports').update({ status: 'actioned', reviewed_at: new Date().toISOString(), reviewed_by: ADMIN }).eq('id', id);
                await loadReportsData();
                renderTab('reports');
                showToast('举报已处理', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    window.dismissReport = function(id) {
        showConfirm('驳回举报', '确认将此举报标记为"已驳回"？', '确认驳回', async function() {
            try {
                await sb.from('reports').update({ status: 'dismissed', reviewed_at: new Date().toISOString(), reviewed_by: ADMIN }).eq('id', id);
                await loadReportsData();
                renderTab('reports');
                showToast('举报已驳回', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    window.viewReportDetail = function(id) {
        var r = reportsData.find(function(x) { return x.id === id; });
        if (!r) return;
        var detail = '举报人：' + r.reporter_name + '\n类型：' + r.target_type + '\n目标ID：' + r.target_id + '\n目标用户：' + (r.target_user || '-') + '\n分类：' + r.report_category + '\n原因：' + (r.report_reason || '-') + '\n证据：' + (r.evidence_url || '-') + '\n状态：' + r.status + '\n时间：' + formatTime(r.created_at) + '\n处理人：' + (r.reviewed_by || '-');
        alert(detail);
    };

    var bansData = [];

    async function loadBansData() {
        try {
            var res = await sb.from('bans').select('*').order('banned_at', { ascending: false }).limit(500);
            bansData = res.data || [];
        } catch(e) {
            bansData = [];
        }
    }

    async function renderBansTab(el) {
        if (!bansData.length) {
            await loadBansData();
        }
        var active = bansData.filter(function(b) { return b.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + bansData.length + '</div><div class="lbl">总拉黑封禁记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前拉黑封禁</div></div>';
        h += '</div>';

        h += '<div class="card"><h3>🔒 添加拉黑封禁</h3>';
        h += '<div class="admin-user-form-row">';
        h += '<div class="admin-field"><label>用户名</label>' + buildAdminUserPicker('banUserName', '选择拉黑封禁用户') + '</div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px;"><label style="font-size:11px;color:var(--text-muted);">拉黑封禁时长</label><select id="banDuration" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.15);font-size:13px;outline:none;color:var(--text);">';
        h += '<option value="1">1小时</option>';
        h += '<option value="6">6小时</option>';
        h += '<option value="12">12小时</option>';
        h += '<option value="24" selected>1天</option>';
        h += '<option value="72">3天</option>';
        h += '<option value="168">7天</option>';
        h += '<option value="720">30天</option>';
        h += '<option value="0">永久拉黑封禁</option>';
        h += '</select></div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px;"><label style="font-size:11px;color:var(--text-muted);">拉黑封禁原因</label><input id="banReason" placeholder="输入原因" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.15);font-size:13px;outline:none;color:var(--text);width:180px;"></div>';
        h += '<button class="btn-sm primary" onclick="addBan()" style="height:36px;">执行拉黑封禁</button>';
        h += '</div></div>';

        h += '<div class="card"><h3>🔒 拉黑封禁列表</h3>';
        if (!bansData.length) {
            h += '<div class="empty">暂无拉黑封禁记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>类型</th><th>原因</th><th>操作人</th><th>拉黑封禁时间</th><th>过期时间</th><th>状态</th><th>解除时间</th></tr></thead><tbody>';
            bansData.forEach(function(b) {
                var statusBadge = b.is_active ? '<span class="badge badge-red">拉黑封禁中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftTime = !b.is_active && b.lifted_at ? formatTime(b.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(b.user_name) + '</strong></td>';
                h += '<td>' + (b.ban_type === 'permanent' ? '永久' : formatDuration(b.ban_duration_hours || 0)) + '</td>';
                h += '<td style="max-width:150px;">' + escapeHtml(b.ban_reason || '-') + '</td>';
                h += '<td>' + escapeHtml(b.banned_by || '-') + '</td>';
                h += '<td>' + formatTime(b.banned_at) + '</td>';
                h += '<td>' + (b.expires_at ? formatTime(b.expires_at) : '-') + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td>' + (b.is_active ? (b.expires_at ? formatTime(b.expires_at) : '永久') + ' <button class="btn-sm" onclick="liftBan(\'' + b.id + '\')">提前解除</button>' : liftTime) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

    window.addBan = async function() {
        var userName = document.getElementById('banUserName').value.trim();
        var duration = parseInt(document.getElementById('banDuration').value);
        var reason = document.getElementById('banReason').value.trim();
        if (!validateAdminTargetUser(userName, 'banUserName')) return;
        var banType = duration === 0 ? 'permanent' : 'temporary';
        var expiresAt = null;
        if (duration > 0) {
            var d = new Date();
            d.setHours(d.getHours() + duration);
            expiresAt = d.toISOString();
        }
        try {
            var { error } = await sb.from('bans').insert([{
                user_name: userName, ban_type: banType, ban_reason: reason || '违反社区规定',
                ban_duration_hours: duration,
                banned_by: ADMIN, expires_at: expiresAt, is_active: true
            }]);
            if (error) {
                if (error.code === '23505') { showToast('该用户已被拉黑封禁', 'error'); return; }
                showToast('拉黑封禁失败: ' + error.message, 'error'); return;
            }
            document.getElementById('banUserName').value = '';
            document.getElementById('banReason').value = '';
            await loadBansData();
            renderTab('bans');
            showToast('✅ 已拉黑封禁 ' + userName, 'success');
        } catch(e) { showToast('拉黑封禁失败: ' + e.message, 'error'); }
    };

    window.liftBan = function(id) {
        showConfirm('解除拉黑封禁', '确认解除该用户的拉黑封禁？', '确认解除', async function() {
            try {
                await sb.from('bans').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN }).eq('id', id);
                await loadBansData();
                renderTab('bans');
                showToast('✅ 已解除拉黑封禁', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    var mutesData = [];

    async function loadMutesData() {
        try {
            var res = await sb.from('mutes').select('*').order('created_at', { ascending: false }).limit(500);
            mutesData = res.data || [];
        } catch(e) {
            mutesData = [];
        }
    }

    async function renderMutesTab(el) {
        if (!mutesData.length) {
            await loadMutesData();
        }
        var active = mutesData.filter(function(m) { return m.is_active; }).length;
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + mutesData.length + '</div><div class="lbl">总禁言记录</div></div>';
        h += '<div class="stat-box"><div class="val" style="color:var(--danger)">' + active + '</div><div class="lbl">当前禁言</div></div>';
        h += '</div>';

        h += '<div class="card"><h3>🤐 添加禁言</h3>';
        h += '<div class="admin-user-form-row">';
        h += '<div class="admin-field"><label>用户名</label>' + buildAdminUserPicker('muteUserName', '选择禁言用户') + '</div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px;"><label style="font-size:11px;color:var(--text-muted);">禁言时长</label><select id="muteDuration" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.15);font-size:13px;outline:none;color:var(--text);">';
        h += '<option value="1">1小时</option>';
        h += '<option value="6">6小时</option>';
        h += '<option value="12">12小时</option>';
        h += '<option value="24" selected>1天</option>';
        h += '<option value="72">3天</option>';
        h += '<option value="168">7天</option>';
        h += '<option value="720">30天</option>';
        h += '<option value="0">永久禁言</option>';
        h += '</select></div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px;"><label style="font-size:11px;color:var(--text-muted);">禁言原因</label><input id="muteReason" placeholder="输入原因" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.15);font-size:13px;outline:none;color:var(--text);width:180px;"></div>';
        h += '<button class="btn-sm primary" onclick="addMute()" style="height:36px;">执行禁言</button>';
        h += '</div></div>';

        h += '<div class="card"><h3>🤐 禁言列表</h3>';
        if (!mutesData.length) {
            h += '<div class="empty">暂无禁言记录</div>';
        } else {
            h += '<div class="table-wrap"><table><thead><tr><th>用户名</th><th>时长</th><th>原因</th><th>操作人</th><th>开始时间</th><th>过期时间</th><th>状态</th><th>解除时间</th></tr></thead><tbody>';
            mutesData.forEach(function(m) {
                var durationLabel = m.duration_hours > 0 ? formatDuration(m.duration_hours) : '永久';
                var statusBadge = m.is_active ? '<span class="badge badge-red">禁言中</span>' : '<span class="badge badge-green">已解除</span>';
                var liftTime = !m.is_active && m.lifted_at ? formatTime(m.lifted_at) : '-';
                h += '<tr><td><strong>' + escapeHtml(m.user_name) + '</strong></td>';
                h += '<td>' + durationLabel + '</td>';
                h += '<td style="max-width:150px;">' + escapeHtml(m.reason || '-') + '</td>';
                h += '<td>' + escapeHtml(m.muted_by || '-') + '</td>';
                h += '<td>' + formatTime(m.created_at) + '</td>';
                h += '<td>' + (m.expires_at ? formatTime(m.expires_at) : '永久') + '</td>';
                h += '<td>' + statusBadge + '</td>';
                h += '<td>' + (m.is_active ? (m.expires_at ? formatTime(m.expires_at) : '永久') + ' <button class="btn-sm" onclick="liftMute(\'' + m.id + '\')">提前解除</button>' : liftTime) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        }
        h += '</div>';
        el.innerHTML = h;
    }

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
        var expiresAt = null;
        if (duration > 0) {
            var d = new Date();
            d.setHours(d.getHours() + duration);
            expiresAt = d.toISOString();
        }
        try {
            var { error } = await sb.from('mutes').insert([{
                user_name: userName,
                reason: reason || '违反社区规定',
                duration_hours: duration,
                muted_by: ADMIN,
                expires_at: expiresAt,
                is_active: true
            }]);
            if (error) {
                showToast('禁言失败: ' + error.message, 'error');
                return;
            }
            document.getElementById('muteUserName').value = '';
            document.getElementById('muteReason').value = '';
            await loadMutesData();
            renderTab('mutes');
            showToast('✅ 已禁言 ' + userName, 'success');
        } catch(e) { showToast('禁言失败: ' + e.message, 'error'); }
    };

    window.liftMute = function(id) {
        showConfirm('解除禁言', '确认解除该用户的禁言？', '确认解除', async function() {
            try {
                await sb.from('mutes').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN }).eq('id', id);
                await loadMutesData();
                renderTab('mutes');
                showToast('✅ 已解除禁言', 'success');
            } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
        });
    };

    // 黑名单功能已合并到「拉黑封禁」，相关函数已移除

    var photosAdminData = [];

    async function loadPhotosAdminData() {
        try {
            var res = await sb.from('posts').select('id,user_name,media_url,content,created_at,views,actor_key').eq('media_type', '__photo_wall__').order('created_at', { ascending: false }).limit(500);
            photosAdminData = res.data || [];
        } catch(e) {
            photosAdminData = [];
        }
    }

    async function renderPhotosTab(el) {
        if (!photosAdminData.length) {
            await loadPhotosAdminData();
        }
        var h = '<div class="stats-row">';
        h += '<div class="stat-box"><div class="val">' + photosAdminData.length + '</div><div class="lbl">总照片数</div></div>';
        h += '</div>';

        h += '<div class="card"><h3>📷 照片管理</h3>';
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
                await sb.from('posts').delete().eq('id', id);
                await loadPhotosAdminData();
                renderTab('photos');
                showToast('照片已删除', 'success');
            } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
        });
    };

    var _origSwitchTab = window.switchTab;
    window.switchTab = function(tab) {
        currentTab = tab;
        saveCurrentTab();
        ['ann','users','posts','likes','comments','reports','bans','mutes','photos'].forEach(function(t) {
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
            case 'photos': renderPhotosTab(el); break;
        }
    };

    var _origLoadAllData = window.loadAllData;
    window.loadAllData = async function(keepTab) {
        try {
            var postRes = await sb.from('posts').select('*').neq('media_type', '__avatar__').order('created_at', {ascending: false}).limit(5000);
            var likeRes = await sb.from('likes').select('*').order('created_at', {ascending: false}).limit(5000);
            var commRes = await sb.from('comments').select('*').order('created_at', {ascending: false}).limit(5000);

            allPosts = (postRes.data || []).filter(function(p) { return p.media_type !== AUTH_MARKER && p.media_type !== DM_MARKER && p.media_type !== '__user_info__'; });
            annList = (postRes.data || []).filter(function(p) { return p.media_type === ANN_MARKER; });
            allLikes = likeRes.data || [];
            allComments = commRes.data || [];

            var userMap = {};
            allPosts.forEach(function(p) { userMap[p.user_name] = true; });
            allLikes.forEach(function(l) { userMap[l.user_name] = true; });
            allComments.forEach(function(c) { userMap[c.user_name] = true; });

            var userInfoList = (postRes.data || []).filter(function(p) { return p.media_type === '__user_info__'; });
            // postRes 按 created_at DESC 排序（最新在前），只保留每个用户第一条（最新）记录
            var userInfoMap = {};
            userInfoList.forEach(function(ui) {
                try { if (!userInfoMap[ui.user_name]) { var info = JSON.parse(ui.content); userInfoMap[ui.user_name] = info; userMap[ui.user_name] = true; } } catch(e) {}
            });

            allUsers = Object.keys(userMap).sort().map(function(u) {
                return { name: u, info: userInfoMap[u] || null };
            });

            await loadReportsData();
            await loadBansData();
            await loadMutesData();
            await loadPhotosAdminData();

            if (!keepTab) { switchTab('ann'); }
            else { window.renderTab(currentTab); }
        } catch(e) {
            console.error(e);
            showToast('数据加载失败，请刷新重试', 'error');
        }
    };
})();
