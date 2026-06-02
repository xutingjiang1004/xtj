(function() {
    // ===================== 聊天系统 (Dock 兼容版) =====================
    var chatRealtime = null;
    window.chatRealtime = chatRealtime;

    var dmpollTimer = null;
    var dmpollInterval = null;

    var dockChatActiveUser = null;
    var dockChatSending = false;
    var dockChatMsgsBusy = false;
    var dockChatMsgsDirty = '';
    var dockChatMsgsUser = null;
    var _dockPreviewUrl = null;
    var restorePostsScroll = null;

    var _chatCache = {};
    window._chatCache = _chatCache;

    window.dockChatListCacheTime = 0;
    var DOCK_CHAT_CACHE_DURATION = 120000;

    function renderChatLoading(el, options) {
        if (!el) return;
        el.innerHTML = window.xtjMagicLoadingHtml();
        if (window.initAllSpringLoaders) {
            window.initAllSpringLoaders(el);
        }
    }
    window.renderChatLoading = renderChatLoading;

    // ===================== 通知系统 =====================
    var activeNotifications = [];

    function showNotification(userName, message) {
        if (!userName || !message) return;
        if (localStorage.getItem('xtj-notif') === 'off') return;
        if (window.currentDockTab === 'chat' && dockChatActiveUser === userName) return;

        var container = document.getElementById('notificationContainer');
        if (!container) return;

        var bubble = document.createElement('div');
        bubble.className = 'notification-bubble';

        var avatarHtml = window.avatarCache && window.avatarCache[userName]
            ? '<img src="' + window.avatarCache[userName] + '" alt="' + userName + '">'
            : userName[0].toUpperCase();

        var truncatedMsg = message.length > 50 ? message.slice(0, 50) + '...' : message;

        bubble.innerHTML = '<div class="notification-avatar">' + avatarHtml + '</div><div class="notification-content"><div class="notification-name">' + window.escapeHtml(userName) + '</div><div class="notification-text">' + window.escapeHtml(truncatedMsg) + '</div></div>';

        bubble.addEventListener('click', function() {
            window.switchDockTab('chat');
            window.openChat(userName);
            bubble.classList.remove('show');
            bubble.classList.add('hide');
            setTimeout(function() {
                if (bubble.parentNode) bubble.remove();
            }, 400);
        });

        container.appendChild(bubble);

        bubble.offsetHeight;
        setTimeout(function() {
            bubble.classList.add('show');
        }, 16);

        var notifId = Date.now() + Math.random();
        activeNotifications.push({ id: notifId, element: bubble });

        setTimeout(function() {
            bubble.classList.remove('show');
            bubble.classList.add('hide');
            setTimeout(function() {
                if (bubble.parentNode) bubble.remove();
                activeNotifications = activeNotifications.filter(function(n) { return n.id !== notifId; });
            }, 400);
        }, 3000);
    }

    // ===================== 辅助函数 =====================
    function getMediaUrl(prefix, val) {
        if (val.startsWith('http')) return val;
        return window.sb.storage.from('uploads').getPublicUrl(val).data.publicUrl;
    }

    function isMsgReadByMe(msg) {
        var key = 'xtj_dmread_' + window.currentUser + '_' + msg.user_name;
        var t = localStorage.getItem(key);
        return t && new Date(msg.created_at) <= new Date(t);
    }
    window.isMsgReadByMe = isMsgReadByMe;

    function markMessagesRead(senderName) {
        var key = 'xtj_dmread_' + window.currentUser + '_' + senderName;
        localStorage.setItem(key, new Date().toISOString());
        window.dockChatListCacheTime = 0;
        loadDockChatList();
        window.updateUnreadBadge();
    }
    window.markMessagesRead = markMessagesRead;

    // ===================== 实时订阅 =====================
    function subscribeToMessages() {
        if (chatRealtime) { window.sb.removeChannel(chatRealtime); }
        chatRealtime = window.sb.channel('chat-dms')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, function(payload) {
                var m = payload.new;
                if (m.media_type !== window.DM_MARKER) return;
                if (!window.currentUser) return;
                if (m.media_url !== window.currentUser) return;
                if (m.user_name === window.currentUser) return;
                showNotification(m.user_name, m.content || '发送了一张图片/视频');
                if (dockChatActiveUser === m.user_name) {
                    loadDockChatMessages(m.user_name, false);
                } else if (!dockChatActiveUser) {
                    loadDockChatList();
                } else {
                    updateUnreadBadge();
                }
            })
            .subscribe(function(status, err) {
                if (err) { console.error('[CHAT-REALTIME]', err); }
                else if (status === 'SUBSCRIBED') { console.log('[CHAT-REALTIME] 已连接'); }
            });
        window.chatRealtime = chatRealtime;
    }
    window.subscribeToMessages = subscribeToMessages;

    // ===================== 轮询 =====================
    async function pollNow() {
        if (!window.currentUser) return;
        try {
            if (dockChatActiveUser) {
                await loadDockChatMessages(dockChatActiveUser, false);
            } else {
                await updateUnreadBadge();
            }
        } catch(e) {}
    }
    window.pollNow = pollNow;

    function startDMPolling(interval) {
        interval = interval || 300000;
        if (dmpollTimer) {
            if (dmpollInterval === interval) return;
            clearInterval(dmpollTimer); dmpollTimer = null;
        }
        dmpollInterval = interval;
        pollNow();
        dmpollTimer = setInterval(pollNow, interval);
    }
    window.startDMPolling = startDMPolling;

    function stopDMPolling() {
        if (dmpollTimer) { clearInterval(dmpollTimer); dmpollTimer = null; dmpollInterval = null; }
    }
    window.stopDMPolling = stopDMPolling;

    // ===================== 未读徽章 =====================
    async function updateUnreadBadge() {
        try {
            var result = await window.sb.from('posts')
                .select('id, user_name, created_at')
                .eq('media_type', window.DM_MARKER)
                .eq('media_url', window.currentUser)
                .order('created_at', { ascending: false })
                .limit(200);

            var data = result.data;
            if (result.error) return;
            var cnt = 0;
            (data || []).forEach(function(m) {
                if (!window.isMsgReadByMe(m)) cnt++;
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
    window.updateUnreadBadge = updateUnreadBadge;

    // ===================== Tab 动画 =====================
    var animClassMap = { posts: 'anim-post', chat: 'anim-chat', ai: 'anim-ai', profile: 'anim-profile' };
    var animatingTabs = {};
    var animDurations = { posts: 1500, chat: 2500, ai: 1400, profile: 1400 };

    function triggerTabAnimation(el, tab) {
        var cls = animClassMap[tab];
        if (!cls) return;
        if (animatingTabs[tab]) return;
        animatingTabs[tab] = true;
        el.classList.add(cls);
        setTimeout(function() {
            el.classList.remove(cls);
            animatingTabs[tab] = false;
        }, animDurations[tab] + 50);
    }
    window.triggerTabAnimation = triggerTabAnimation;

    // ===================== 聊天导航 =====================
    function dockChatGoBack() {
        dockChatActiveUser = null;
        document.getElementById('dockChatDetailView').classList.add('hidden');
        document.getElementById('dockChatListView').classList.remove('hidden');
        document.getElementById('dockChatBackBtn').style.display = 'none';
        document.getElementById('dockChatTitle').textContent = '消息';
        window.dockChatListCacheTime = 0;
        loadDockChatList();
        startDMPolling(300000);
        if (restorePostsScroll !== null) {
            window.switchDockTab('posts');
            requestAnimationFrame(function() {
                var postsPanel = document.getElementById('panelPosts');
                if (postsPanel) postsPanel.scrollTop = restorePostsScroll;
                restorePostsScroll = null;
            });
        }
    }
    window.dockChatGoBack = dockChatGoBack;

    // ===================== 打开聊天 =====================
    function openChat(userName) {
        if (!window.currentUser) { window.showToast('请先登录'); return; }
        if (userName === window.currentUser) { window.switchDockTab('chat', true); return; }
        if (window.currentDockTab === 'posts') {
            var postsPanel = document.getElementById('panelPosts');
            if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
        }
        dockChatActiveUser = userName;
        renderChatLoading(document.getElementById('dockChatMessages'), {
            title: '正在进入聊天',
            subtitle: '同步最近消息中',
            variant: 'detail'
        });
        document.getElementById('dockChatListView').classList.add('hidden');
        document.getElementById('dockChatDetailView').classList.remove('hidden');
        document.getElementById('dockChatBackBtn').style.display = 'flex';
        document.getElementById('dockChatTitle').textContent = userName;
        window.switchDockTab('chat', true);
        loadDockChatMessages(userName);
        startDMPolling(60000);
    }
    window.openChat = openChat;

    // ===================== 加载聊天列表 =====================
    async function loadDockChatList() {
        var el = document.getElementById('dockChatList');
        if (!el) return;
        if (Date.now() - window.dockChatListCacheTime < DOCK_CHAT_CACHE_DURATION) return;
        window.dockChatListCacheTime = Date.now();
        renderChatLoading(el, {
            title: '正在读取消息列表',
            subtitle: '同步联系人与未读状态',
            variant: 'list'
        });
        try {
            var result = await window.sb.from("posts")
                .select("id, user_name, media_url, content, created_at")
                .eq("media_type", window.DM_MARKER)
                .or("user_name.eq." + window.currentUser + ",media_url.eq." + window.currentUser)
                .order("created_at", { ascending: false })
                .limit(200);
            if (result.error) throw result.error;
            var allMsgs = result.data;
            if (!allMsgs || !allMsgs.length) {
                el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>暂无消息</div><div style="font-size:12px;">在帖子页面点击头像开始聊天</div></div>';
                updateUnreadBadge();
                return;
            }
            var convMap = {};
            allMsgs.forEach(function(m) {
                var other = m.user_name === window.currentUser ? m.media_url : m.user_name;
                if (!convMap[other] || new Date(m.created_at) > new Date(convMap[other].last_time)) {
                    convMap[other] = { other_user: other, last_message: m.content, last_time: m.created_at, unread: 0 };
                }
                if (m.media_url === window.currentUser && !window.isMsgReadByMe(m)) {
                    convMap[other].unread = Math.min((convMap[other].unread || 0) + 1, 99);
                }
            });
            var convs = Object.values(convMap).sort(function(a, b) { return new Date(b.last_time) - new Date(a.last_time); });
            // 预加载聊天列表头像
            var chatUsers = convs.map(function(c) { return c.other_user; });
            if (chatUsers.length > 0) {
                var uncachedUsers = chatUsers.filter(function(u) { return !window.avatarCache[u]; });
                if (uncachedUsers.length > 0) {
                    try {
                        var avatarRes = await window.sb.from("posts")
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
                                    window.avatarCache[a.user_name] = a.media_url;
                                }
                            });
                        }
                    } catch(e) {}
                }
            }
            el.innerHTML = convs.map(function(c) {
                var avHtml = window.avatarCache[c.other_user]
                    ? '<img src="' + window.avatarCache[c.other_user] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                    : c.other_user[0].toUpperCase();
                return '<div class="chat-list-item" onclick="window.openChat(\'' + c.other_user.replace(/'/g, "\\'") + '\')"><div class="cli-avatar">' + avHtml + '</div><div class="cli-info"><div class="cli-name">' + c.other_user + '</div><div class="cli-preview">' + c.last_message + '</div></div><div class="cli-right"><span class="cli-time">' + window.formatMsgTime(c.last_time) + '</span>' + (c.unread ? '<span class="cli-badge">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '') + '</div></div>';
            }).join('');
            updateUnreadBadge();
        } catch(e) {
            el.innerHTML = '<div class="chat-empty"><div class="ce-icon">⚠️</div><div>' + (e.message || '加载失败') + '</div></div>';
        }
    }
    window.loadDockChatList = loadDockChatList;

    // ===================== 加载聊天消息 =====================
    async function loadDockChatMessages(userName, forceScroll) {
        if (dockChatMsgsBusy && dockChatMsgsUser === userName) { dockChatMsgsDirty = userName; return; }
        // 预加载双方头像
        var needAvatars = [];
        if (window.currentUser && !window.avatarCache[window.currentUser]) needAvatars.push(window.currentUser);
        if (userName && !window.avatarCache[userName]) needAvatars.push(userName);
        if (needAvatars.length > 0) {
            try {
                var avatarRes = await window.sb.from("posts")
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
                            window.avatarCache[a.user_name] = a.media_url;
                        }
                    });
                }
            } catch(e) {}
        }
        // 当前用户优先使用localStorage权威缓存
        if (window.currentUser) {
            try {
                var cachedAvatars = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
                if (cachedAvatars[window.currentUser]) {
                    window.avatarCache[window.currentUser] = cachedAvatars[window.currentUser];
                }
            } catch(e) {}
        }
        // 有缓存先立即显示
        var cacheKey = window.currentUser + '_' + userName;
        if (_chatCache[cacheKey] && !forceScroll) {
            renderDockMessages(_chatCache[cacheKey], true);
        }
        dockChatMsgsBusy = true; dockChatMsgsUser = userName; dockChatMsgsDirty = '';
        var el = document.getElementById('dockChatMessages');
        try {
            var result = await window.sb.from("posts").select("id, user_name, media_url, content, created_at, views, actor_key")
                .eq("media_type", window.DM_MARKER)
                .or("and(user_name.eq." + window.currentUser + ",media_url.eq." + userName + "),and(user_name.eq." + userName + ",media_url.eq." + window.currentUser + ")")
                .order("created_at").limit(500);
            if (result.error) throw result.error;
            var msgs = result.data;
            // 缓存消息
            _chatCache[cacheKey] = msgs || [];
            var toMark = (msgs || []).filter(function(m) { return m.user_name === userName && m.media_url === window.currentUser && (m.views || 0) === 0; });
            for (var i = 0; i < toMark.length; i++) {
                try { await window.sb.rpc("increment_post_views", { p_post_id: toMark[i].id }); toMark[i].views = 1; } catch(e) {}
            }
            window.markMessagesRead(userName);
            renderDockMessages(msgs || [], forceScroll);
        } catch(e) {
            if (!_chatCache[cacheKey]) {
                el.innerHTML = '<div class="chat-empty"><div class="ce-icon">⚠️</div><div>' + (e.message || '加载失败') + '</div></div>';
            }
        } finally {
            dockChatMsgsBusy = false;
            if (dockChatMsgsDirty === userName) { dockChatMsgsDirty = ''; loadDockChatMessages(userName); }
        }
    }
    window.loadDockChatMessages = loadDockChatMessages;

    // ===================== 渲染消息 =====================
    function renderDockMessages(msgs, forceScroll) {
        var el = document.getElementById('dockChatMessages');
        if (!msgs.length) { el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>'; return; }
        var isNearBottom = !el.scrollHeight || (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
        var shouldAutoScroll = forceScroll || isNearBottom;
        var isBulk = msgs.length > 2;
        var wasHidden = false;
        if (shouldAutoScroll && isBulk) {
            el.style.visibility = 'hidden';
            wasHidden = true;
        }
        var otherUser = msgs[0] ? (msgs[0].user_name === window.currentUser ? msgs[0].media_url : msgs[0].user_name) : '';
        var myAvatarHtml = window.avatarCache[window.currentUser] ? '<img src="' + window.avatarCache[window.currentUser] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' : (window.currentUser ? window.currentUser[0].toUpperCase() : '?');
        var otherAvatarHtml = window.avatarCache[otherUser] ? '<img src="' + window.avatarCache[otherUser] + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' : (otherUser ? otherUser[0].toUpperCase() : '?');
        el.innerHTML = msgs.map(function(m) {
            var sent = m.user_name === window.currentUser;
            var readStatus = sent ? ((m.views || 0) > 0 ? '<span class="msg-read-status">已读</span>' : '<span class="msg-read-status">未读</span>') : '';
            var body = '';
            if (m.actor_key && m.actor_key.startsWith('__dm_img__')) {
                body = '<img class="msg-img" src="' + getMediaUrl('__dm_img__', m.actor_key.replace('__dm_img__', '')) + '" onclick="window.openImageViewer(this.src)" loading="lazy" />';
                if (m.content) body += '<div class="msg-text">' + window.escapeHtml(m.content) + '</div>';
            } else if (m.actor_key && m.actor_key.startsWith('__dm_vid__')) {
                body = '<video class="msg-img" src="' + getMediaUrl('__dm_vid__', m.actor_key.replace('__dm_vid__', '')) + '" controls preload="metadata" onclick="event.stopPropagation()" style="cursor:default;"></video>';
                if (m.content) body += '<div class="msg-text">' + window.escapeHtml(m.content) + '</div>';
            } else { body = '<span class="msg-text">' + window.escapeHtml(m.content || '') + '</span>'; }
            var avatarHtml = sent ? myAvatarHtml : otherAvatarHtml;
            var bubble = '<div class="chat-msg ' + (sent ? 'sent' : 'received') + (isBulk ? ' no-anim' : '') + '">' + body + readStatus + '<span class="msg-time">' + window.formatMsgTime(m.created_at) + '</span></div>';
            if (sent) {
                return '<div class="chat-msg-row sent">' + bubble + '<div class="chat-msg-avatar">' + avatarHtml + '</div></div>';
            } else {
                return '<div class="chat-msg-row received"><div class="chat-msg-avatar">' + avatarHtml + '</div>' + bubble + '</div>';
            }
        }).join('');
        if (shouldAutoScroll) {
            el.scrollTop = el.scrollHeight;
        }
        if (wasHidden) {
            el.style.visibility = '';
        }
    }
    window.renderDockMessages = renderDockMessages;

    // ===================== 滚动到底部 =====================
    function scrollDockChatBottom() {
        var el = document.getElementById('dockChatMessages');
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    window.scrollDockChatBottom = scrollDockChatBottom;

    // ===================== 发送消息 =====================
    async function sendDockChatMessage() {
        var inp = document.getElementById('dockChatInput');
        var content = inp.value.trim();
        var fileInput = document.getElementById('dockChatFileInp');
        var file = fileInput.files[0];
        if ((!content && !file) || !dockChatActiveUser || dockChatSending) return;
        dockChatSending = true; inp.value = '';
        try {
            var actorKey = window.DM_MARKER;
            if (file) {
                var path = 'chat/' + Date.now() + '_' + file.name;
                await window.sb.storage.from("uploads").upload(path, file);
                actorKey = file.type.startsWith('video/') ? '__dm_vid__' + path : '__dm_img__' + path;
            }
            var result = await window.sb.from("posts").insert([{ user_name: window.currentUser, content: content, media_type: window.DM_MARKER, media_url: dockChatActiveUser, actor_key: actorKey }]);
            if (result.error) throw result.error;
            clearDockChatFilePreview();
            await loadDockChatMessages(dockChatActiveUser, true);
            var msgs = document.getElementById('dockChatMessages');
            if (msgs) {
                msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
                var lastMsg = msgs.lastElementChild;
                if (lastMsg && lastMsg.classList.contains('chat-msg')) {
                    lastMsg.classList.add('sent-anim');
                    setTimeout(function() {
                        msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
                    }, 200);
                }
            }
        } catch(e) { window.showToast('发送失败: ' + (e && e.message || e)); inp.value = content; }
        finally { dockChatSending = false; }
    }
    window.sendDockChatMessage = sendDockChatMessage;

    // ===================== 文件预览 =====================
    function showDockChatFilePreview(file) {
        var preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
        var thumb = document.getElementById('dockCfpThumb'), name = document.getElementById('dockCfpName');
        if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
        var xBtn = thumb.querySelector('.cfp-x'); thumb.innerHTML = '';
        if (file.type.startsWith('video/')) { thumb.innerHTML = '<span class="cfp-video-icon">🎬</span>'; }
        else { var img = document.createElement('img'); _dockPreviewUrl = URL.createObjectURL(file); img.src = _dockPreviewUrl; thumb.appendChild(img); }
        if (xBtn) thumb.appendChild(xBtn);
        name.textContent = file.name; input.classList.add('hidden'); preview.classList.remove('hidden');
    }
    window.showDockChatFilePreview = showDockChatFilePreview;

    function clearDockChatFilePreview() {
        var preview = document.getElementById('dockChatFilePreview'), input = document.getElementById('dockChatInput');
        var fileInput = document.getElementById('dockChatFileInp');
        if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
        preview.classList.add('hidden'); input.classList.remove('hidden'); fileInput.value = ''; input.focus();
    }
    window.clearDockChatFilePreview = clearDockChatFilePreview;

    // ===================== iOS 键盘处理 =====================
    var keyboardOpen = false;

    function handleFocus(e) {
        var dockBar = document.getElementById('dockBar');
        if (dockBar) dockBar.style.display = 'none';
        keyboardOpen = true;
        setTimeout(function() {
            if (e.target && e.target.scrollIntoViewIfNeeded) {
                e.target.scrollIntoViewIfNeeded(true);
            } else if (e.target && e.target.scrollIntoView) {
                e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 300);
    }
    window.handleFocus = handleFocus;

    function handleBlur() {
        if (document.body.classList.contains('photo-previewing')) return;
        var dockBar = document.getElementById('dockBar');
        if (dockBar) dockBar.style.display = 'flex';
        keyboardOpen = false;
    }
    window.handleBlur = handleBlur;

    // ===================== 事件绑定 =====================
    // iOS 键盘弹出修复
    (function() {
        var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!isIOS) return;
        var inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
        inputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('focus', handleFocus);
                el.addEventListener('blur', handleBlur);
            }
        });
    })();

    // 聊天UI事件监听
    document.getElementById('dockChatSendBtn').addEventListener('click', sendDockChatMessage);
    document.getElementById('dockChatInput').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDockChatMessage(); } });
    document.getElementById('dockChatImgBtn').addEventListener('click', function() { document.getElementById('dockChatFileInp').click(); });
    document.getElementById('dockChatFileInp').addEventListener('change', function() { if (this.files.length) showDockChatFilePreview(this.files[0]); });
    document.getElementById('dockCfpRemove').addEventListener('click', clearDockChatFilePreview);

    // 通知测试
    window.testNotification = function() {
        showNotification('张三', '你好！这是一条测试消息～看看液态玻璃效果如何？');
    };
    window.testNotificationLong = function() {
        showNotification('李四', '这是一条非常非常长的测试消息用来检查文本截断效果到底怎么样超出50个字符');
    };

    // openChatList / closeChat 快捷入口
    window.openChatList = function() { window.switchDockTab('chat', true); };
    window.closeChat = function() { window.switchDockTab('posts'); };
})();
