/* ===================== XTJ AI 聊天（徐旭泽的小猫）=====================
 * - 统一 AI 名称：徐旭泽的小猫（管理员 xxz 配置）
 * - 位置：聊天页会话列表 -> 点击"徐旭泽的小猫"进入聊天
 * - 普通用户不能修改 AI 名字/性格/提示词
 * - 数据：/api/agent/config (GET) + /api/agent/chat (POST) + /api/agent/chat/history (GET)
 * - 鉴权：window.ensureUserToken() 获取 Bearer token
 * - 不出现：宠物等级 / 亲密度 / 心情 / 用户自定义 profile
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
        remaining: { hour: 10, day: 50 }
    };

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

    // ===================== API =====================
    async function ensureLoggedIn() {
        if (!window.currentUser) {
            notify('请先登录后再和' + (state.config ? state.config.name : 'AI') + '聊天');
            return false;
        }
        try {
            if (typeof window.ensureUserToken === 'function') {
                var token = await window.ensureUserToken();
                if (token) return true;
            }
        } catch (e) { /* fall through */ }
        notify('登录已过期，请重新登录');
        return false;
    }

    async function getAuthHeaders() {
        try {
            if (typeof window.ensureUserToken === 'function') {
                var token = await window.ensureUserToken();
                if (token) {
                    return {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    };
                }
            }
        } catch (e) { /* 静默 */ }
        return { 'Content-Type': 'application/json' };
    }

    async function apiGetConfig() {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/config', { method: 'GET', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) throw new Error(data && data.error || '获取配置失败');
        return data;
    }

    async function apiGetHistory(limit) {
        var headers = await getAuthHeaders();
        var l = Math.min(Math.max(limit || HISTORY_LIMIT, 1), 100);
        var resp = await fetch(API_BASE + '/chat/history?limit=' + l, { method: 'GET', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) throw new Error(data && data.error || '获取历史失败');
        return data;
    }

    async function apiPostChat(message) {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ message: message })
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) throw new Error(data && data.error || '聊天失败，请稍后再试');
        return data;
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
        input.addEventListener('input', function() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

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
                notify((state.config && state.config.name) + '暂时没有回应，请稍后再试');
            }
        } catch (e) {
            typingNode.remove();
            if (e && e.message) notify(e.message);
        } finally {
            state.sending = false;
            btn.disabled = false;
            btn.textContent = '发送';
            if (input) input.focus();
        }
    }

    // ===================== 入口：打开/关闭 AI 聊天 =====================
    // 在聊天页会话列表中点击"徐旭泽的小猫"时调用
    window.__xtjOpenAiChat = async function() {
        // 1. 检查登录
        if (!window.currentUser) {
            notify('请先登录后再和' + (state.config ? state.config.name : 'AI') + '聊天');
            return;
        }
        try {
            if (typeof window.ensureUserToken === 'function') {
                var token = await window.ensureUserToken();
                if (!token) { notify('登录已过期，请重新登录'); return; }
            }
        } catch (e) {
            notify('登录已过期，请重新登录');
            return;
        }

        // 2. 切换到聊天 tab，打开详情视图
        if (typeof window.switchDockTab === 'function') {
            window.switchDockTab('chat', true);
        }

        // 3. 先加载配置
        try {
            var data = await apiGetConfig();
            if (data && data.config) state.config = data.config;
        } catch (e) { /* 使用默认值 */ }

        var name = state.config ? state.config.name : '徐旭泽的小猫';
        var avatar = state.config ? (state.config.avatar || '🐱') : '🐱';

        // 4. 修改聊天页标题和 UI
        var titleEl = document.getElementById('dockChatTitle');
        var backBtn = document.getElementById('dockChatBackBtn');
        var listView = document.getElementById('dockChatListView');
        var detailView = document.getElementById('dockChatDetailView');
        var messagesEl = document.getElementById('dockChatMessages');

        if (titleEl) titleEl.textContent = avatar + ' ' + name;
        if (backBtn) backBtn.style.display = 'flex';
        if (listView) listView.classList.add('hidden');
        if (detailView) detailView.classList.remove('hidden');

        // 5. 隐藏标准聊天输入（AI 聊天使用独立 UI）
        var chatInputArea = document.querySelector('.chat-input-area');
        if (chatInputArea) chatInputArea.style.display = 'none';

        // 6. 在消息区渲染 AI 聊天界面
        if (messagesEl) {
            messagesEl.innerHTML = '';
            messagesEl.classList.add('ai-chat-container');
            renderChatView(messagesEl);
        }

        // 关闭 DM 轮询，防止干扰
        if (typeof window.stopDMPolling === 'function') {
            window.stopDMPolling();
        }
    };

    window.__xtjCloseAiChat = function() {
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
