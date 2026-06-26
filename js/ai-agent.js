(function() {
  'use strict';

  // ===================== 配置 =====================
  var API_BASE = '/api/agent';
  var HISTORY_LIMIT = 50;
  var THINKING_LEVELS = [
    { value: 'off', label: '关闭', icon: '' },
    { value: 'low', label: '低', icon: '⚡' },
    { value: 'medium', label: '中', icon: '🧠' },
    { value: 'high', label: '高', icon: '🔥' }
  ];
  var DRAFT_KEY = 'ai_chat_draft';

  var state = {
    config: null,
    messages: [],
    conversationId: null,
    loading: false,
    sending: false,
    thinkingMode: localStorage.getItem('ai_thinking_mode') || 'off',
    remaining: { hour: 10, day: 50 }
  };

  // ===================== 工具 =====================
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (k === 'class') { node.className = v; }
        else if (k === 'text') { node.textContent = v; }
        else if (k === 'html') { node.innerHTML = v; }
        else if (k === 'style') { node.style.cssText = v; }
        else if (k.indexOf('on') === 0) { node.addEventListener(k.slice(2).toLowerCase(), v); }
        else { node.setAttribute(k, v); }
      }
    }
    if (children) {
      if (typeof children === 'string') { node.textContent = children; }
      else if (Array.isArray(children)) {
        children.forEach(function(c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      }
    }
    return node;
  }

  function notify(msg) {
    if (typeof window.showToast === 'function') { window.showToast(msg); }
    else if (typeof window.showNotify === 'function') { window.showNotify(msg); }
  }

  function scrollToBottom(el) {
    if (!el) return;
    requestAnimationFrame(function() { el.scrollTop = el.scrollHeight; });
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ===================== API（静默失败，不 throw）=====================
  async function getAuthHeaders() {
    var token = '';
    try {
      if (typeof window.ensureUserToken === 'function') {
        token = await window.ensureUserToken();
      }
    } catch (e) { /* 静默 */ }
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  async function apiGetConfig() {
    try {
      var headers = await getAuthHeaders();
      var resp = await fetch(API_BASE + '/config', { method: 'GET', headers: headers });
      var data = resp.ok ? await resp.json().catch(function() { return null; }) : null;
      return data || null;
    } catch(e) { return null; }
  }

  async function apiGetHistory(convId) {
    try {
      var headers = await getAuthHeaders();
      var url = API_BASE + '/chat/history?limit=' + HISTORY_LIMIT;
      if (convId) url += '&conversation_id=' + encodeURIComponent(convId);
      var resp = await fetch(url, { method: 'GET', headers: headers });
      return resp.ok ? await resp.json().catch(function() { return null; }) : null;
    } catch(e) { return null; }
  }

  async function apiPostChat(message) {
    try {
      var headers = await getAuthHeaders();
      var body = {
        message: message,
        thinking_mode: state.thinkingMode,
        conversation_id: state.conversationId
      };
      var resp = await fetch(API_BASE + '/chat', {
        method: 'POST', headers: headers,
        body: JSON.stringify(body)
      });
      return resp.ok ? await resp.json().catch(function() { return null; }) : null;
    } catch(e) { return null; }
  }

  async function apiNewConversation() {
    try {
      var headers = await getAuthHeaders();
      var resp = await fetch(API_BASE + '/chat/new', {
        method: 'POST', headers: headers
      });
      var data = resp.ok ? await resp.json().catch(function() { return null; }) : null;
      return data || null;
    } catch(e) { return null; }
  }

  // ===================== 消息气泡 =====================
  function buildMessageNode(msg) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    var wrapper = el('div', { class: 'ai-msg ' + role });

    var bubble = el('div', { class: 'ai-msg-bubble' });
    bubble.textContent = msg.content || '';
    wrapper.appendChild(bubble);

    // tokens/费用展示（仅 AI 回复显示）
    if (role === 'assistant' && msg.usage) {
      var usageMeta = el('div', { class: 'ai-msg-usage' });
      var parts = [];
      if (msg.usage.total_tokens) {
        parts.push('输入 ' + msg.usage.prompt_tokens + ' · 输出 ' + msg.usage.completion_tokens + ' · 合计 ' + msg.usage.total_tokens);
      }
      if (msg.usage.cost !== null && msg.usage.cost !== undefined) {
        parts.push('¥' + Number(msg.usage.cost).toFixed(6) + ' ' + (msg.usage.currency || 'CNY'));
      } else if (msg.usage.total_tokens) {
        parts.push('费用未配置');
      }
      if (msg.thinking_mode && msg.thinking_mode !== 'off') {
        parts.push('思考：' + msg.thinking_mode);
      }
      if (msg.model) {
        parts.push(msg.model);
      }
      if (parts.length === 0) {
        parts.push('tokens 暂不可用');
      }
      usageMeta.textContent = parts.join(' · ');
      wrapper.appendChild(usageMeta);
    }

    // 时间戳
    if (msg.created_at) {
      var timeEl = el('div', { class: 'ai-msg-time' });
      try {
        var d = new Date(msg.created_at);
        timeEl.textContent = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      } catch(e) { timeEl.textContent = ''; }
      wrapper.appendChild(timeEl);
    }
    return wrapper;
  }

  function buildTypingNode() {
    var wrapper = el('div', { class: 'ai-msg assistant typing' });
    var bubble = el('div', { class: 'ai-msg-bubble' });
    for (var i = 0; i < 3; i++) {
      bubble.appendChild(el('span'));
    }
    wrapper.appendChild(bubble);
    return wrapper;
  }

  function showEmptyState(container, config) {
    container.innerHTML = '';
    var empty = el('div', { class: 'ai-chat-empty' });
    var avatar = (config && config.avatar) || '🐱';
    var name = (config && config.name) || '徐旭泽的小猫';
    var welcome = (config && config.welcome_message) || '喵，来聊天吧。';

    empty.appendChild(el('div', { class: 'ai-chat-empty-emoji', text: avatar }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和' + name + '聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: welcome }));
    container.appendChild(empty);
  }

  // ===================== 发送消息 =====================
  async function handleSendMessage(input, btn, messagesEl, usageBar) {
    if (state.sending) return;
    var text = input.value.trim();
    if (!text) return;

    state.sending = true;
    btn.disabled = true;
    btn.textContent = '发送中…';
    input.value = '';
    input.style.height = 'auto';
    try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}

    // 在消息列表添加用户消息
    state.messages.push({ role: 'user', content: text, created_at: new Date().toISOString() });
    messagesEl.appendChild(buildMessageNode({ role: 'user', content: text, created_at: new Date().toISOString() }));
    scrollToBottom(messagesEl);

    // 打字指示器
    var typingNode = buildTypingNode();
    messagesEl.appendChild(typingNode);
    scrollToBottom(messagesEl);

    try {
      var data = await apiPostChat(text);
      typingNode.remove();

      if (data && data.reply) {
        var aiMsg = {
          role: 'assistant',
          content: data.reply,
          created_at: new Date().toISOString(),
          usage: data.usage || null,
          thinking_mode: data.thinking_mode || null,
          model: data.model || null
        };
        state.messages.push(aiMsg);
        if (data.conversation_id) state.conversationId = data.conversation_id;
        messagesEl.appendChild(buildMessageNode(aiMsg));
        if (data.remaining) state.remaining = data.remaining;
        updateUsageBar(usageBar);
        scrollToBottom(messagesEl);
      } else {
        notify('AI 暂时没有回应，请稍后再试');
      }
    } catch (e) {
      typingNode.remove();
      notify('发送失败，请稍后再试');
    } finally {
      state.sending = false;
      btn.disabled = false;
      btn.textContent = '发送';
      input.focus();
    }
  }

  function updateUsageBar(bar) {
    if (!bar) return;
    var parts = [];
    parts.push('本小时内还可聊 ' + state.remaining.hour + ' 次');
    if (state.thinkingMode !== 'off') {
      parts.push('思考：' + state.thinkingMode);
    }
    bar.textContent = parts.join(' · ');
  }

  // ===================== 加载历史 =====================
  async function loadHistory(messagesEl, usageBar) {
    if (!messagesEl || state.loading) return;
    state.loading = true;

    // 先显示空状态
    showEmptyState(messagesEl, state.config);

    var data = await apiGetHistory(state.conversationId);
    if (data && Array.isArray(data.messages) && data.messages.length > 0) {
      messagesEl.innerHTML = '';
      state.messages = data.messages;
      if (data.conversation_id) state.conversationId = data.conversation_id;
      data.messages.forEach(function(msg) {
        messagesEl.appendChild(buildMessageNode(msg));
      });
      scrollToBottom(messagesEl);
    }
    updateUsageBar(usageBar);
    state.loading = false;
  }

  // ===================== 主渲染 =====================
  function renderChatView(container) {
    if (!container) return;
    container.innerHTML = '';

    var name = state.config ? state.config.name : '徐旭泽的小猫';
    var avatar = state.config ? (state.config.avatar || '🐱') : '🐱';

    // ===== 头部 =====
    var header = el('div', { class: 'ai-chat-header' });

    // 返回按钮
    var backBtn = el('button', {
      type: 'button', class: 'ai-chat-back',
      html: '‹'
    });
    backBtn.addEventListener('click', function() {
      window.__xtjAiChatActive = false;
      var ml = document.getElementById('dockChatMessages');
      if (ml) ml.classList.remove('ai-chat-container');
      if (typeof window.renderDockChatList === 'function') window.renderDockChatList();
    });
    header.appendChild(backBtn);

    // 头像
    var headerAvatar = el('span', { class: 'ai-chat-header-avatar', text: avatar });
    header.appendChild(headerAvatar);

    // 标题区
    var headerInfo = el('div', { class: 'ai-chat-header-info' });
    headerInfo.appendChild(el('div', { class: 'ai-chat-header-name', text: name }));
    var desc = state.config ? state.config.description : '';
    if (desc) {
      headerInfo.appendChild(el('div', { class: 'ai-chat-header-status', text: desc }));
    } else {
      headerInfo.appendChild(el('div', { class: 'ai-chat-header-status', text: '在线' }));
    }
    header.appendChild(headerInfo);

    // 新对话按钮
    var newBtn = el('button', { type: 'button', class: 'ai-chat-new-btn', text: '新对话' });
    newBtn.addEventListener('click', async function() {
      if (state.messages.length === 0 && !state.conversationId) { notify('已经是新对话了'); return; }
      var data = await apiNewConversation();
      if (data && data.conversation_id) {
        state.conversationId = data.conversation_id;
        state.messages = [];
        var me = document.getElementById('aiChatMessagesArea');
        if (me) { me.innerHTML = ''; showEmptyState(me, state.config); }
        notify('已开始新对话');
      } else {
        notify('创建新对话失败');
      }
    });
    header.appendChild(newBtn);

    // 思考模式
    function getLevelLabel(lvl) {
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === lvl) return THINKING_LEVELS[k];
      }
      return THINKING_LEVELS[0];
    }
    var cur = getLevelLabel(state.thinkingMode);
    var thinkBtn = el('button', {
      type: 'button', class: 'ai-chat-think-btn',
      text: (cur.icon ? cur.icon + ' ' : '') + cur.label
    });
    thinkBtn.addEventListener('click', function() {
      var idx = 0;
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === state.thinkingMode) { idx = k; break; }
      }
      var next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
      state.thinkingMode = next.value;
      localStorage.setItem('ai_thinking_mode', next.value);
      thinkBtn.textContent = (next.icon ? next.icon + ' ' : '') + next.label;
      if (next.value !== 'off') thinkBtn.classList.add('active');
      else thinkBtn.classList.remove('active');
      var ub = document.getElementById('aiChatUsageBar');
      if (ub) updateUsageBar(ub);
    });
    if (state.thinkingMode !== 'off') thinkBtn.classList.add('active');
    header.appendChild(thinkBtn);

    container.appendChild(header);

    // ===== 消息区 =====
    var messagesEl = el('div', { class: 'ai-chat-messages', id: 'aiChatMessagesArea' });
    container.appendChild(messagesEl);

    // ===== usage 栏 =====
    var usageBar = el('div', { class: 'ai-chat-usage-bar', id: 'aiChatUsageBar' });
    container.appendChild(usageBar);

    // ===== 输入区 =====
    var inputBar = el('div', { class: 'ai-chat-input-bar' });
    var input = el('textarea', {
      class: 'ai-chat-input', id: 'aiChatMsgInput',
      placeholder: '和' + name + '说点什么吧…', rows: 1
    });
    var sendBtn = el('button', {
      type: 'button', class: 'ai-chat-send', id: 'aiChatSendBtn', text: '发送'
    });

    // 发送事件
    sendBtn.addEventListener('click', function() {
      handleSendMessage(input, sendBtn, messagesEl, usageBar);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage(input, sendBtn, messagesEl, usageBar);
      }
    });
    // 自动增高
    input.addEventListener('input', function() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      try { localStorage.setItem(DRAFT_KEY, input.value); } catch(e) {}
    });
    // 恢复草稿
    try {
      var saved = localStorage.getItem(DRAFT_KEY);
      if (saved) { input.value = saved; input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
    } catch(e) {}

    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    container.appendChild(inputBar);

    // 加载历史
    loadHistory(messagesEl, usageBar);
  }

  // ===================== 入口 =====================
  window.__xtjAiChatActive = false;
  window.__xtjAiChatLoading = false;

  window.__xtjOpenAiChat = async function() {
    if (window.__xtjAiChatLoading) return;
    window.__xtjAiChatLoading = true;

    if (!window.currentUser) {
      window.__xtjAiChatLoading = false;
      notify('请先登录后再和徐旭泽的小猫聊天');
      return;
    }

    // 切 tab
    if (typeof window.switchDockTab === 'function') {
      window.switchDockTab('chat', true);
    }

    var name = '徐旭泽的小猫';
    var avatar = '🐱';

    window.__xtjAiChatActive = true;
    window.__xtjAiChatLoading = false;

    var titleEl = document.getElementById('dockChatTitle');
    var backBtn = document.getElementById('dockChatBackBtn');
    var listView = document.getElementById('dockChatListView');
    var detailView = document.getElementById('dockChatDetailView');
    var messagesEl = document.getElementById('dockChatMessages');

    if (titleEl) titleEl.textContent = avatar + ' ' + name;
    if (backBtn) backBtn.style.display = 'flex';
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');

    var chatInputArea = document.querySelector('.chat-input-area');
    if (chatInputArea) chatInputArea.style.display = 'none';

    if (messagesEl) {
      messagesEl.innerHTML = '';
      messagesEl.classList.add('ai-chat-container');
      renderChatView(messagesEl);
    }

    if (typeof window.stopDMPolling === 'function') {
      window.stopDMPolling();
    }

    // 异步加载配置后更新
    apiGetConfig().then(function(data) {
      if (!data || !data.config) return;
      state.config = data.config;
      var name2 = state.config.name || '徐旭泽的小猫';
      var avatar2 = state.config.avatar || '🐱';
      var desc2 = state.config.description || '';
      var container = document.getElementById('dockChatMessages');
      if (!container) return;

      // 更新 header
      var hdr = container.querySelector('.ai-chat-header-avatar');
      if (hdr) hdr.textContent = avatar2;
      var hdrName = container.querySelector('.ai-chat-header-name');
      if (hdrName) hdrName.textContent = name2;
      var hdrStatus = container.querySelector('.ai-chat-header-status');
      if (hdrStatus) hdrStatus.textContent = desc2 || '在线';

      // 更新 input placeholder
      var inp = document.getElementById('aiChatMsgInput');
      if (inp) inp.placeholder = '和' + name2 + '说点什么吧…';

      // 更新 title
      var t = document.getElementById('dockChatTitle');
      if (t) t.textContent = avatar2 + ' ' + name2;

      // 更新空状态
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
  };

  // 关闭 AI 聊天
  window.__xtjCloseAiChat = function() {
    window.__xtjAiChatActive = false;
    var ml = document.getElementById('dockChatMessages');
    if (ml) ml.classList.remove('ai-chat-container');
  };
})();
