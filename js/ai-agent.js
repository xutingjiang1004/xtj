/* ===================== XTJ AI 聊天（徐旭泽的小猫）=====================
 * - 统一 AI 名称：徐旭泽的小猫（管理员 xxz 配置）
 * - 位置：聊天页会话列表 -> 点击"徐旭泽的小猫"进入聊天
 * - 普通用户不能修改 AI 名字/性格/提示词
 * - 数据：/api/agent/config (GET) + /api/agent/chat (POST) + /api/agent/chat/history (GET)
 * - 鉴权：window.ensureUserToken() 获取 Bearer token
 * - 不出现：用户自定义 profile
 */
(function() {
    'use strict';

    if (window.__xtjAiAgent) return;

    var API_BASE = '/api/agent';
    var MAX_MESSAGE = 2000;
    var HISTORY_LIMIT = 50;

    var state = {
        config: null,
        messages: [],
        loading: false,
        sending: false,
        thinkingMode: localStorage.getItem('ai_thinking_mode') || 'off',
        remaining: { hour: 10, day: 50 }
    };

    var THINKING_LEVELS = [
        { value: 'off', label: '关闭', icon: '' },
        { value: 'low', label: '低', icon: '⚡' },
        { value: 'medium', label: '中', icon: '🧠' },
        { value: 'high', label: '高', icon: '🔥' }
    ];

    var DRAFT_KEY_PREFIX = 'ai_draft_';

    // ===================== 工具函数 =====================
    function $(sel) { return document.querySelector(sel); }

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'style') node.style.cssText = attrs[k];
                else if (k === 'text') node.textContent = attrs[k];
                else if (k === 'html') node.innerHTML = attrs[k];
                else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
                else node.setAttribute(k, attrs[k]);
            }
        }
        if (children) {
            if (Array.isArray(children)) {
                children.forEach(function(c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
            } else if (typeof children === 'string') {
                node.textContent = children;
            } else if (children) {
                node.appendChild(children);
            }
        }
        return node;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatTime(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            var now = new Date();
            var diff = (now - d) / 1000;
            if (diff < 60) return '刚刚';
            if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
            if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
            var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
            return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        } catch (e) { return ''; }
    }

    function notify(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
            return;
        }
        var t = el('div', { class: 'ai-toast-fallback', text: msg });
        t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:10px;background:rgba(5,150,105,0.92);color:#fff;font-size:13px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 2400);
    }

    // ===================== API（静默失败，不 throw，不弹 401 通知）=====================
    async function getAuthHeaders() {
        var token = '';
        try {
            if (typeof window.ensureUserToken === 'function') {
                token = await window.ensureUserToken();
            }
        } catch (e) { /* 静默 */ }
        if (token) {
            return {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            };
        }
        return { 'Content-Type': 'application/json' };
    }

    async function apiGetConfig() {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/config', { method: 'GET', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        return resp.ok ? data : null;
    }

    async function apiGetHistory(limit) {
        var headers = await getAuthHeaders();
        var l = Math.min(Math.max(limit || HISTORY_LIMIT, 1), 100);
        var resp = await fetch(API_BASE + '/chat/history?limit=' + l, { method: 'GET', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        return resp.ok ? data : null;
    }

    async function apiPostChat(message) {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ message: message, thinking_mode: state.thinkingMode })
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        return resp.ok ? data : null;
    }

    async function apiClearChat() {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/chat', { method: 'DELETE', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        return resp.ok ? data : null;
    }

    // ===================== 渲染：聊天界面 =====================
    function renderChatView(container) {
        if (!container) return;
        container.innerHTML = '';

        var name = state.config ? state.config.name : '徐旭泽的小猫';
        var avatar = state.config ? (state.config.avatar || '🐱') : '🐱';
        var desc = state.config ? state.config.description : '陪你聊天的小猫';

        // 顶栏
        var topBar = el('div', { class: 'ai-chat-topbar' }, [
            el('span', { class: 'ai-chat-topbar-avatar', text: avatar }),
            el('span', { class: 'ai-chat-topbar-name', text: name }),
            el('span', { class: 'ai-chat-topbar-desc', text: desc })
        ]);
        // 思考模式选择器
        function getThinkingLabel(lvl) {
            for (var k = 0; k < THINKING_LEVELS.length; k++) {
                if (THINKING_LEVELS[k].value === lvl) return THINKING_LEVELS[k];
            }
            return THINKING_LEVELS[0];
        }
        var curLevel = getThinkingLabel(state.thinkingMode);
        var thinkBtn = el('button', {
            type: 'button',
            style: 'margin-left:auto;flex-shrink:0;background:none;border:1px solid ' + (state.thinkingMode !== 'off' ? 'rgba(46,148,101,0.7)' : 'rgba(140,196,158,0.28)') + ';border-radius:14px;padding:2px 10px;font-size:11px;color:' + (state.thinkingMode !== 'off' ? 'rgba(46,148,101,0.96)' : 'var(--text-muted,#6b6c7a)') + ';cursor:pointer;white-space:nowrap;',
            text: (curLevel.icon ? curLevel.icon + ' ' : '') + curLevel.label
        });
        thinkBtn.addEventListener('click', function() {
            var idx = 0;
            for (var k = 0; k < THINKING_LEVELS.length; k++) {
                if (THINKING_LEVELS[k].value === state.thinkingMode) { idx = k; break; }
            }
            var next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
            state.thinkingMode = next.value;
            localStorage.setItem('ai_thinking_mode', next.value);
            thinkBtn.style.borderColor = next.value !== 'off' ? 'rgba(46,148,101,0.7)' : 'rgba(140,196,158,0.28)';
            thinkBtn.style.color = next.value !== 'off' ? 'rgba(46,148,101,0.96)' : 'var(--text-muted,#6b6c7a)';
            thinkBtn.textContent = (next.icon ? next.icon + ' ' : '') + next.label;
        });
        topBar.appendChild(thinkBtn);

        // 新对话按钮
        var newBtn = el('button', {
            type: 'button',
            style: 'margin-left:4px;flex-shrink:0;background:none;border:1px solid rgba(140,196,158,0.28);border-radius:14px;padding:2px 10px;font-size:11px;color:var(--text-muted,#6b6c7a);cursor:pointer;white-space:nowrap;',
            text: '新对话'
        });
        newBtn.addEventListener('click', function() {
            if (state.messages.length === 0) { notify('已经是新对话了'); return; }
            if (!confirm('清空当前对话，重新开始？\n（聊天记录会保存在历史中，新对话不再带旧上下文）')) return;
            state.messages = [];
            var messagesEl = document.getElementById('aiChatMessagesArea');
            if (messagesEl) {
                messagesEl.innerHTML = '';
                showEmptyState(messagesEl);
            }
            apiClearChat().catch(function() {});
            notify('已开始新对话');
        });
        topBar.appendChild(newBtn);

        // 消息区
        var messagesEl = el('div', { class: 'ai-chat-messages', id: 'aiChatMessagesArea' });

        // 输入区
        var inputBar = el('div', { class: 'ai-chat-input-bar' });
        var input = el('textarea', {
            class: 'ai-chat-input',
            id: 'aiChatMsgInput',
            placeholder: '和' + name + '说点什么吧…',
            rows: 1
        });
        var sendBtn = el('button', {
            class: 'ai-chat-send',
            type: 'button',
            id: 'aiChatSendBtn'
        }, '发送');

        var foot = el('div', { class: 'ai-chat-foot' }, [
            el('span', { id: 'aiChatFootStatus', text: '本小时内还可聊 ' + state.remaining.hour + ' 次' })
        ]);

        sendBtn.addEventListener('click', function() {
            handleSendMessage(input, sendBtn, messagesEl, foot);
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(input, sendBtn, messagesEl, foot);
            }
        });
        // 输入缓存：每次打字保存草稿到 localStorage
        input.addEventListener('input', function() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            try { localStorage.setItem(DRAFT_KEY_PREFIX + 'default', input.value); } catch(e) {}
        });

        // 恢复之前缓存的草稿
        try {
            var savedDraft = localStorage.getItem(DRAFT_KEY_PREFIX + 'default');
            if (savedDraft) { input.value = savedDraft; input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
        } catch(e) {}

        inputBar.appendChild(input);
        inputBar.appendChild(sendBtn);

        container.appendChild(topBar);
        container.appendChild(messagesEl);
        container.appendChild(inputBar);
        container.appendChild(foot);

        // 加载历史
        loadHistory(messagesEl, foot);
    }

    async function loadHistory(messagesEl, footEl) {
        if (!messagesEl) return;
        if (state.messages.length > 0) {
            renderMessages(messagesEl);
            return;
        }
        try {
            var data = await apiGetHistory(HISTORY_LIMIT);
            state.messages = (data && data.messages) || [];
            if (state.messages.length === 0) {
                showEmptyState(messagesEl);
            } else {
                renderMessages(messagesEl);
            }
        } catch (e) {
            showEmptyState(messagesEl);
        }
    }

    function showEmptyState(messagesEl) {
        if (!messagesEl) return;
        var welcome = state.config && state.config.welcome_message ? state.config.welcome_message : '喵，来聊天吧。';
        messagesEl.innerHTML = '';
        var empty = el('div', { class: 'ai-chat-empty' }, [
            el('div', { class: 'ai-chat-empty-emoji', text: (state.config && state.config.avatar) || '🐱' }),
            el('div', { class: 'ai-chat-empty-title', text: '和' + ((state.config && state.config.name) || 'AI') + '聊聊天' }),
            el('div', { class: 'ai-chat-empty-tip', text: welcome })
        ]);
        messagesEl.appendChild(empty);
    }

    function renderMessages(messagesEl) {
        if (!messagesEl) return;
        messagesEl.innerHTML = '';
        var msgs = state.messages || [];
        if (msgs.length === 0) { showEmptyState(messagesEl); return; }
        msgs.forEach(function(m) {
            messagesEl.appendChild(buildMessageNode(m));
        });
        scrollToBottom(messagesEl);
    }

    function buildMessageNode(m) {
        var role = m.role === 'assistant' ? 'assistant' : 'user';
        var bubble = el('div', { class: 'ai-msg-bubble', text: m.content || '' });
        var time = el('div', { class: 'ai-msg-time', text: formatTime(m.created_at) });
        return el('div', { class: 'ai-msg ' + role }, [bubble, time]);
    }

    function scrollToBottom(messagesEl) {
        if (!messagesEl) return;
        try { messagesEl.scrollTop = messagesEl.scrollHeight; } catch (e) { /* 静默 */ }
    }

    async function handleSendMessage(input, btn, messagesEl, footEl) {
        if (state.sending) return;
        var text = String(input.value || '').trim();
        if (!text) return;
        if (text.length > MAX_MESSAGE) {
            notify('消息不能超过 ' + MAX_MESSAGE + ' 字');
            return;
        }

        state.sending = true;
        btn.disabled = true;
        btn.textContent = '发送中…';
        input.value = '';
        input.style.height = 'auto';
        try { localStorage.removeItem(DRAFT_KEY_PREFIX + 'default'); } catch(e) {}

        var empty = messagesEl.querySelector('.ai-chat-empty');
        if (empty) empty.remove();

        var userMsg = { role: 'user', content: text, created_at: new Date().toISOString() };
        state.messages.push(userMsg);
        messagesEl.appendChild(buildMessageNode(userMsg));

        var typingNode = el('div', { class: 'ai-msg assistant typing' }, [
            el('div', { class: 'ai-msg-bubble' }, [el('span'), el('span'), el('span')])
        ]);
        messagesEl.appendChild(typingNode);
        scrollToBottom(messagesEl);

        try {
            var data = await apiPostChat(text);
            typingNode.remove();
            if (data && data.reply) {
                var aiMsg = { role: 'assistant', content: data.reply, created_at: new Date().toISOString() };
                state.messages.push(aiMsg);
                messagesEl.appendChild(buildMessageNode(aiMsg));
                if (data.remaining) {
                    state.remaining = data.remaining;
                    var status = document.getElementById('aiChatFootStatus');
                    if (status) status.textContent = '本小时内还可聊 ' + state.remaining.hour + ' 次';
                }
                scrollToBottom(messagesEl);
            } else {
                typingNode.remove();
                notify('AI 暂时没有回应，请稍后再试');
            }
        } catch (e) {
            typingNode.remove();
        } finally {
            state.sending = false;
            btn.disabled = false;
            btn.textContent = '发送';
            if (input) input.focus();
        }
    }

    // ===================== 入口：打开/关闭 AI 聊天 =====================
    window.__xtjAiChatActive = false;

    // 在聊天页会话列表中点击"徐旭泽的小猫"时调用
    window.__xtjOpenAiChat = async function() {
        // 1. 防重复：如果正在加载中，不重复执行
        if (window.__xtjAiChatLoading) return;
        window.__xtjAiChatLoading = true;

        // 2. 检查登录
        if (!window.currentUser) {
            window.__xtjAiChatLoading = false;
            notify('请先登录后再和徐旭泽的小猫聊天');
            return;
        }

        // 3. 先切到聊天 tab（即时反馈，用户马上看到界面变化）
        if (typeof window.switchDockTab === 'function') {
            window.switchDockTab('chat', true);
        }

        // 4. 异步加载配置（只调用一次，加载完成后更新 UI）
        apiGetConfig().then(function(cfgData) {
            if (!cfgData || !cfgData.config) return;
            state.config = cfgData.config;
            var name2 = state.config.name || '徐旭泽的小猫';
            var avatar2 = state.config.avatar || '🐱';
            var desc2 = state.config.description || '';
            var container = document.getElementById('dockChatMessages');
            if (!container) return;
            var tb = container.querySelector('.ai-chat-topbar');
            if (tb) {
                var spans = tb.children;
                if (spans[0]) spans[0].textContent = avatar2;
                if (spans[1]) spans[1].textContent = name2;
                if (spans[2]) spans[2].textContent = desc2;
            }
            var inp = document.getElementById('aiChatMsgInput');
            if (inp) inp.placeholder = '和' + name2 + '说点什么吧…';
            var titleEl2 = document.getElementById('dockChatTitle');
            if (titleEl2) titleEl2.textContent = avatar2 + ' ' + name2;
            var emptyEl = container.querySelector('.ai-chat-empty');
            if (emptyEl) {
                var emoji = emptyEl.querySelector('.ai-chat-empty-emoji');
                if (emoji) emoji.textContent = avatar2;
                var title = emptyEl.querySelector('.ai-chat-empty-title');
                if (title) title.textContent = '和' + name2 + '聊聊天';
                var tip = emptyEl.querySelector('.ai-chat-empty-tip');
                if (tip) tip.textContent = (state.config.welcome_message || '喵，来聊天吧。');
            }
        }).catch(function() {});

        var name = state.config ? state.config.name : '徐旭泽的小猫';
        var avatar = state.config ? (state.config.avatar || '🐱') : '🐱';

        // 5. 标记为 AI 聊天活跃
        window.__xtjAiChatActive = true;
        window.__xtjAiChatLoading = false;

        // 6. 修改聊天页标题和 UI
        var titleEl = document.getElementById('dockChatTitle');
        var backBtn = document.getElementById('dockChatBackBtn');
        var listView = document.getElementById('dockChatListView');
        var detailView = document.getElementById('dockChatDetailView');
        var messagesEl = document.getElementById('dockChatMessages');

        if (titleEl) titleEl.textContent = avatar + ' ' + name;
        if (backBtn) backBtn.style.display = 'flex';
        if (listView) listView.classList.add('hidden');
        if (detailView) detailView.classList.remove('hidden');

        // 7. 隐藏标准聊天输入
        var chatInputArea = document.querySelector('.chat-input-area');
        if (chatInputArea) chatInputArea.style.display = 'none';

        // 8. 在消息区渲染 AI 聊天界面
        if (messagesEl) {
            messagesEl.innerHTML = '';
            messagesEl.classList.add('ai-chat-container');
            renderChatView(messagesEl);
        }

        // 关闭 DM 轮询
        if (typeof window.stopDMPolling === 'function') {
            window.stopDMPolling();
        }
    };

    window.__xtjCloseAiChat = function() {
        if (!window.__xtjAiChatActive) return;
        window.__xtjAiChatActive = false;
        state.messages = [];
        var messagesEl = document.getElementById('dockChatMessages');
        if (messagesEl) {
            messagesEl.classList.remove('ai-chat-container');
        }
        var chatInputArea = document.querySelector('.chat-input-area');
        if (chatInputArea) chatInputArea.style.display = '';
    };

    window.__xtjAiAgent = {
        open: window.__xtjOpenAiChat,
        close: window.__xtjCloseAiChat
    };
})();
