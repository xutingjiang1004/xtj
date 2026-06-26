/* ===================== AI 智能体 / AI 宠物 前端 =====================
 * 第一版：profile + chat
 * - 位置：我的页 - Pro 装扮的下面
 * - 二级页（profileAiAgentPage），与 Pro 装扮二级页平级
 * - 数据：/api/agent/profile (GET/POST) + /api/agent/chat (POST) + /api/agent/chat/history (GET)
 * - 鉴权：window.ensureUserToken() 获取 Bearer token
 * - 风格：浅绿色玻璃 + 暗色模式适配
 * - 第一版不做 actions/confirm / pending_action
 */
(function() {
    'use strict';

    if (window.__xtjAiAgent) return; // 防止重复初始化

    // ===================== 常量 =====================
    var API_BASE = '/api/agent';
    var MAX_AGENT_NAME = 20;
    var MAX_PERSONA = 500;
    var MAX_TONE = 200;
    var MAX_MESSAGE = 2000;
    var HISTORY_LIMIT = 50;

    var MOOD_EMOJI = {
        curious: '🤔',
        happy: '😊',
        playful: '😺',
        sleepy: '😴',
        thoughtful: '💭',
        default: '🐾'
    };
    var MOOD_LABEL = {
        curious: '好奇',
        happy: '开心',
        playful: '调皮',
        sleepy: '困倦',
        thoughtful: '沉思',
        default: '陪伴中'
    };

    // ===================== 状态 =====================
    var state = {
        profile: null,    // { agent_name, persona, tone, level, intimacy, mood, autonomy_enabled, tools_enabled, updated_at }
        messages: [],     // [{ id, role: 'user'|'assistant', content, created_at }]
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
    function moodEmoji(m) { return MOOD_EMOJI[m] || MOOD_EMOJI.default; }
    function moodLabel(m) { return MOOD_LABEL[m] || MOOD_LABEL.default; }

    // toast：复用 core.js 的全局 showToast（如果存在），否则降级
    function notify(msg, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
            return;
        }
        // 降级：自己创建一个临时 toast
        var t = el('div', { class: 'ai-toast-fallback', text: msg });
        t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:10px;background:rgba(5,150,105,0.92);color:#fff;font-size:13px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 2400);
    }

    // ===================== API 调用 =====================
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

    async function apiGetProfile() {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/profile', { method: 'GET', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) {
            var err = (data && data.error) || ('请求失败（' + resp.status + '）');
            throw new Error(err);
        }
        return data;
    }

    async function apiPostProfile(body) {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/profile', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) {
            var err = (data && data.error) || ('保存失败（' + resp.status + '）');
            throw new Error(err);
        }
        return data;
    }

    async function apiGetHistory(limit) {
        var headers = await getAuthHeaders();
        var l = Math.min(Math.max(limit || HISTORY_LIMIT, 1), 100);
        var resp = await fetch(API_BASE + '/chat/history?limit=' + l, { method: 'GET', headers: headers });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) {
            var err = (data && data.error) || ('获取历史失败（' + resp.status + '）');
            throw new Error(err);
        }
        return data;
    }

    async function apiPostChat(message) {
        var headers = await getAuthHeaders();
        var resp = await fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ message: message, mode: 'chat' })
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) {
            var err = (data && data.error) || ('聊天失败（' + resp.status + '）');
            throw new Error(err);
        }
        return data;
    }

    // ===================== 渲染：入口卡片（在我的页 - Pro 装扮下面） =====================
    function renderEntryCard() {
        var entry = document.getElementById('aiAgentEntry');
        if (!entry) return;
        // 子标题根据 profile 状态显示
        var sub = entry.querySelector('.ai-agent-entry-text small');
        if (sub) {
            if (state.profile && state.profile.agent_name) {
                sub.textContent = '你的 AI 宠物：' + state.profile.agent_name;
            } else {
                sub.textContent = '创建你的专属 AI 宠物';
            }
        }
    }

    // ===================== 渲染：二级页 - 创建资料表单 =====================
    function renderCreateForm() {
        var page = document.getElementById('profileAiAgentPage');
        if (!page) return;
        page.innerHTML = '';

        var backBtn = el('button', {
            class: 'ai-agent-page-back',
            type: 'button',
            onclick: function() { window.__xtjAiAgent.close(); }
        }, ['‹ 返回']);

        var header = el('div', { class: 'ai-agent-page-header' }, [
            el('div', { class: 'ai-agent-page-title' }, [
                el('span', { class: 'ai-agent-page-title-dot' }),
                'AI 宠物'
            ]),
            backBtn
        ]);

        var card = el('div', { class: 'ai-profile-card' });

        var title = el('div', {
            style: 'font-size:15px;font-weight:800;margin-bottom:6px;color:var(--text,#1d1d24);'
        }, '🐾 欢迎，先给你的 AI 宠物起个名字');
        var sub = el('div', {
            style: 'font-size:12px;color:var(--text-muted,#6b6c7a);line-height:1.6;margin-bottom:14px;'
        }, '它会陪在你身边，可以聊你的想法、帮你润色文案、总结最近的动态。所有数据只属于你，不会出现在首页。');

        var nameInput = el('input', {
            class: 'ai-form-input',
            type: 'text',
            maxlength: MAX_AGENT_NAME,
            placeholder: '比如：小藤、阿喵、萝卜',
            id: 'aiAgentNameInput'
        });
        var personaInput = el('textarea', {
            class: 'ai-form-textarea',
            maxlength: MAX_PERSONA,
            placeholder: '比如：温柔、聪明、有点吐槽，像宠物一样陪伴我',
            id: 'aiAgentPersonaInput',
            rows: 3
        });
        var toneInput = el('textarea', {
            class: 'ai-form-textarea',
            maxlength: MAX_TONE,
            placeholder: '比如：自然、轻松、不要太机械',
            id: 'aiAgentToneInput',
            rows: 2
        });

        var errBox = el('div', { class: 'ai-form-error', id: 'aiAgentFormError' });

        var submitBtn = el('button', {
            class: 'ai-form-submit',
            type: 'button',
            id: 'aiAgentSubmitBtn'
        }, '创建 AI 宠物');

        submitBtn.addEventListener('click', function() {
            handleCreateProfile(nameInput.value, personaInput.value, toneInput.value, submitBtn, errBox);
        });

        // Enter 提交
        nameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); handleCreateProfile(nameInput.value, personaInput.value, toneInput.value, submitBtn, errBox); }
        });

        // 字符计数
        function updateCounter(input, counter, max) {
            var len = (input.value || '').length;
            counter.textContent = len + ' / ' + max;
        }
        var nameCounter = el('span', { class: 'ai-form-counter', text: '0 / ' + MAX_AGENT_NAME });
        nameInput.addEventListener('input', function() { updateCounter(nameInput, nameCounter, MAX_AGENT_NAME); });
        var personaCounter = el('span', { class: 'ai-form-counter', text: '0 / ' + MAX_PERSONA });
        personaInput.addEventListener('input', function() { updateCounter(personaInput, personaCounter, MAX_PERSONA); });
        var toneCounter = el('span', { class: 'ai-form-counter', text: '0 / ' + MAX_TONE });
        toneInput.addEventListener('input', function() { updateCounter(toneInput, toneCounter, MAX_TONE); });

        card.appendChild(title);
        card.appendChild(sub);
        card.appendChild(el('div', { class: 'ai-form-group' }, [
            el('label', { class: 'ai-form-label' }, ['智能体名字', nameCounter]),
            nameInput,
            el('div', { class: 'ai-form-helper' }, '最长 ' + MAX_AGENT_NAME + ' 字')
        ]));
        card.appendChild(el('div', { class: 'ai-form-group' }, [
            el('label', { class: 'ai-form-label' }, ['性格设定', personaCounter]),
            personaInput,
            el('div', { class: 'ai-form-helper' }, '描述它的性格、说话方式、对你的态度（最长 ' + MAX_PERSONA + ' 字）')
        ]));
        card.appendChild(el('div', { class: 'ai-form-group' }, [
            el('label', { class: 'ai-form-label' }, ['说话风格', toneCounter]),
            toneInput,
            el('div', { class: 'ai-form-helper' }, '它说话的感觉（最长 ' + MAX_TONE + ' 字）')
        ]));
        card.appendChild(errBox);
        card.appendChild(submitBtn);

        page.appendChild(header);
        page.appendChild(card);
    }

    async function handleCreateProfile(name, persona, tone, btn, errBox) {
        if (state.loading) return;
        errBox.textContent = '';
        var n = String(name || '').trim();
        var p = String(persona || '').trim();
        var t = String(tone || '').trim();
        if (!n) { errBox.textContent = '智能体名字不能为空'; return; }
        if (n.length > MAX_AGENT_NAME) { errBox.textContent = '智能体名字不能超过 ' + MAX_AGENT_NAME + ' 字'; return; }
        if (!p) { errBox.textContent = '性格设定不能为空'; return; }
        if (p.length > MAX_PERSONA) { errBox.textContent = '性格设定不能超过 ' + MAX_PERSONA + ' 字'; return; }
        if (!t) { errBox.textContent = '说话风格不能为空'; return; }
        if (t.length > MAX_TONE) { errBox.textContent = '说话风格不能超过 ' + MAX_TONE + ' 字'; return; }

        state.loading = true;
        btn.disabled = true;
        btn.textContent = '创建中…';

        try {
            var data = await apiPostProfile({ agent_name: n, persona: p, tone: t, autonomy_enabled: false });
            if (data && data.profile) {
                state.profile = data.profile;
                renderEntryCard();
                renderChatView();
                notify('已创建 ' + data.profile.agent_name + '！');
            }
        } catch (e) {
            errBox.textContent = e && e.message ? e.message : '创建失败';
        } finally {
            state.loading = false;
            btn.disabled = false;
            btn.textContent = '创建 AI 宠物';
        }
    }

    // ===================== 渲染：二级页 - 聊天视图 =====================
    function renderChatView() {
        var page = document.getElementById('profileAiAgentPage');
        if (!page) return;
        page.innerHTML = '';

        var backBtn = el('button', {
            class: 'ai-agent-page-back',
            type: 'button',
            onclick: function() { window.__xtjAiAgent.close(); }
        }, ['‹ 返回']);

        var header = el('div', { class: 'ai-agent-page-header' }, [
            el('div', { class: 'ai-agent-page-title' }, [
                el('span', { class: 'ai-agent-page-title-dot' }),
                'AI 宠物'
            ]),
            backBtn
        ]);

        // 资料卡
        var profileCard = el('div', { class: 'ai-profile-card' });
        var p = state.profile || {};
        var intimacy = typeof p.intimacy === 'number' ? p.intimacy : 0;
        var level = typeof p.level === 'number' ? p.level : 1;
        var mood = p.mood || 'curious';

        var head = el('div', { class: 'ai-pet-head' }, [
            el('div', { class: 'ai-pet-avatar' }, [moodEmoji(mood)]),
            el('div', { class: 'ai-pet-info' }, [
                el('div', { class: 'ai-pet-name' }, [
                    el('span', { text: p.agent_name || 'AI 宠物' })
                ]),
                el('div', { class: 'ai-pet-meta' }, [
                    el('span', { class: 'ai-pet-meta-pill' }, [el('span', { class: 'emoji', text: '💕' }), '亲密度 ' + intimacy]),
                    el('span', { class: 'ai-pet-meta-pill' }, [el('span', { class: 'emoji', text: '⭐' }), 'Lv. ' + level]),
                    el('span', { class: 'ai-pet-meta-pill' }, [el('span', { class: 'emoji', text: moodEmoji(mood) }), moodLabel(mood)])
                ])
            ])
        ]);
        profileCard.appendChild(head);

        // 聊天窗口
        var chatShell = el('div', { class: 'ai-chat-shell', id: 'aiChatShell' });
        var messages = el('div', { class: 'ai-chat-messages', id: 'aiChatMessages' });
        var inputBar = el('div', { class: 'ai-chat-input-bar' });
        var input = el('textarea', {
            class: 'ai-chat-input',
            id: 'aiChatInput',
            placeholder: '和 ' + (p.agent_name || 'AI 宠物') + ' 聊聊…',
            rows: 1
        });
        var sendBtn = el('button', {
            class: 'ai-chat-send',
            type: 'button',
            id: 'aiChatSendBtn'
        }, '发送');
        var foot = el('div', { class: 'ai-chat-foot' }, [
            el('span', { id: 'aiChatFootStatus', text: '本小时内还可聊 ' + state.remaining.hour + ' 次 · 今日剩余 ' + state.remaining.day + ' 次' }),
            el('span', { text: 'DeepSeek 模型' })
        ]);

        sendBtn.addEventListener('click', function() { handleSendMessage(input, sendBtn, messages, foot); });
        input.addEventListener('keydown', function(e) {
            // Enter 发送，Shift+Enter 换行
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(input, sendBtn, messages, foot);
            }
        });
        // 自动调整高度
        input.addEventListener('input', function() {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        inputBar.appendChild(input);
        inputBar.appendChild(sendBtn);

        chatShell.appendChild(messages);
        chatShell.appendChild(inputBar);
        chatShell.appendChild(foot);

        page.appendChild(header);
        page.appendChild(profileCard);
        page.appendChild(chatShell);

        // 加载历史消息
        loadHistory(messages, foot);
    }

    async function loadHistory(messagesEl, footEl) {
        if (!messagesEl) return;
        if (state.messages.length > 0) {
            // 已加载过，直接渲染
            renderMessages(messagesEl, footEl);
            return;
        }
        try {
            var data = await apiGetHistory(HISTORY_LIMIT);
            state.messages = (data && data.messages) || [];
            if (state.messages.length === 0) {
                showEmptyState(messagesEl);
            } else {
                renderMessages(messagesEl, footEl);
            }
        } catch (e) {
            showEmptyState(messagesEl);
            if (e && e.message) notify('加载历史失败：' + e.message);
        }
    }

    function showEmptyState(messagesEl) {
        messagesEl.innerHTML = '';
        var empty = el('div', { class: 'ai-chat-empty' }, [
            el('div', { class: 'ai-chat-empty-emoji', text: '🐾' }),
            el('div', { class: 'ai-chat-empty-title', text: '开始你们的第一次对话' }),
            el('div', { class: 'ai-chat-empty-tip', text: '说点什么吧，比如"今天心情不太好"或者"帮我写一条帖子草稿"。' })
        ]);
        messagesEl.appendChild(empty);
    }

    function renderMessages(messagesEl, footEl) {
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

        // 移除空态
        var empty = messagesEl.querySelector('.ai-chat-empty');
        if (empty) empty.remove();

        // 立即显示用户消息
        var userMsg = { role: 'user', content: text, created_at: new Date().toISOString() };
        state.messages.push(userMsg);
        messagesEl.appendChild(buildMessageNode(userMsg));

        // 显示 typing
        var typingNode = el('div', { class: 'ai-msg assistant typing' }, [
            el('div', { class: 'ai-msg-bubble' }, [
                el('span'), el('span'), el('span')
            ])
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
                if (data.mood) state.profile.mood = data.mood;
                if (typeof data.intimacy === 'number') state.profile.intimacy = data.intimacy;
                if (data.remaining) {
                    state.remaining = data.remaining;
                    var status = document.getElementById('aiChatFootStatus');
                    if (status) status.textContent = '本小时内还可聊 ' + state.remaining.hour + ' 次 · 今日剩余 ' + state.remaining.day + ' 次';
                }
                scrollToBottom(messagesEl);
                renderEntryCard();
            } else {
                notify('AI 没有回复');
            }
        } catch (e) {
            typingNode.remove();
            if (e && e.message) {
                notify(e.message);
                // 把用户消息保留在列表里
            }
        } finally {
            state.sending = false;
            btn.disabled = false;
            btn.textContent = '发送';
            input.focus();
        }
    }

    // ===================== 页面切换 =====================
    function openAiAgentPage() {
        var main = document.getElementById('profileMainView');
        var page = document.getElementById('profileAiAgentPage');
        var proPage = document.getElementById('profileProStylePage');
        var panel = document.getElementById('panelProfile');

        // 确保 Pro 装扮页先关掉（互斥）
        if (proPage) { proPage.hidden = true; proPage.classList.remove('active'); }

        if (main) main.hidden = true;
        if (page) {
            page.hidden = false;
            page.classList.add('active');
        }
        if (panel && typeof panel.scrollTo === 'function') {
            panel.scrollTo({ top: 0, behavior: 'smooth' });
        }
        // 根据 profile 状态决定渲染哪种视图
        if (state.profile && state.profile.agent_name) {
            renderChatView();
        } else {
            renderCreateForm();
        }
    }

    function closeAiAgentPage() {
        var main = document.getElementById('profileMainView');
        var page = document.getElementById('profileAiAgentPage');
        var panel = document.getElementById('panelProfile');
        if (page) { page.classList.remove('active'); page.hidden = true; }
        if (main) main.hidden = false;
        if (panel && typeof panel.scrollTo === 'function') {
            panel.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // ===================== 初始化 =====================
    async function loadInitialProfile() {
        try {
            var data = await apiGetProfile();
            if (data && data.exists && data.profile) {
                state.profile = data.profile;
            } else {
                state.profile = null;
            }
            renderEntryCard();
        } catch (e) {
            // 静默：未登录时 profile 加载失败不算错
            state.profile = null;
            renderEntryCard();
        }
    }

    function init() {
        // 绑定入口卡片点击
        var entry = document.getElementById('aiAgentEntry');
        if (entry) {
            entry.addEventListener('click', function() { openAiAgentPage(); });
        }
        // 暴露给外部
        window.__xtjAiAgent = {
            open: openAiAgentPage,
            close: closeAiAgentPage,
            refresh: loadInitialProfile,
            getProfile: function() { return state.profile; }
        };
        // 加载 profile
        loadInitialProfile();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
