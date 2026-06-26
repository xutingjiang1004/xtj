(function() {
  'use strict';

  // ===================== 配置 =====================
  var API_BASE = '/api/agent';
  var HISTORY_LIMIT = 50;
  var THINKING_LEVELS = [
    { value: 'off',   label: '关',   icon: ''   },
    { value: 'low',   label: '低',   icon: '⚡' },
    { value: 'medium', label: '中',   icon: '🧠' },
    { value: 'high',  label: '高',   icon: '🔥' }
  ];

  // 全局状态（单实例）
  var state = {
    config: null,         // { name, avatar, description, welcome_message }
    messages: [],         // 当前 conversation 加载到的消息
    conversationId: null, // 当前 conversation_id
    loading: false,       // 正在加载历史
    sending: false,       // 正在发送
    thinkingMode: (function() {
      try { return localStorage.getItem('ai_thinking_mode') || 'off'; } catch(e) { return 'off'; }
    })(),
    remaining: { hour: 10, day: 50 }
  };

  // ===================== 工具 =====================
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === undefined || v === null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') node.style.cssText = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    if (children !== undefined && children !== null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) {
        children.forEach(function(c) {
          if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      }
    }
    return node;
  }

  function notify(msg) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg); return; }
      if (typeof window.showNotify === 'function') { window.showNotify(msg); return; }
    } catch (e) {}
    try { alert(msg); } catch (e) {}
  }

  function scrollToBottom(container) {
    if (!container) return;
    try { requestAnimationFrame(function() { container.scrollTop = container.scrollHeight; }); } catch (e) {}
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // ===================== API（带 status 区分） =====================
  async function getAuthHeaders() {
    var token = '';
    try {
      if (typeof window.ensureUserToken === 'function') {
        token = await window.ensureUserToken();
      }
    } catch (e) {}
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  // 统一返回：{ ok: bool, status: int, data: object|null, error: string|null }
  async function apiRequest(method, path, body) {
    try {
      var headers = await getAuthHeaders();
      var opts = { method: method, headers: headers };
      if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
      var resp = await fetch(API_BASE + path, opts);
      var data = null;
      try { data = await resp.json(); } catch (e) { data = null; }
      return { ok: resp.ok, status: resp.status, data: data, error: data && data.error ? data.error : null };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e && e.message ? e.message : '网络异常' };
    }
  }

  async function apiGetConfig() {
    var r = await apiRequest('GET', '/config');
    return r.ok && r.data ? r.data : null;
  }
  async function apiGetHistory(convId, limit) {
    var qs = '?limit=' + (limit || HISTORY_LIMIT);
    if (convId) qs += '&conversation_id=' + encodeURIComponent(convId);
    var r = await apiRequest('GET', '/chat/history' + qs);
    return r.ok ? r.data : null;
  }
  async function apiPostChat(message) {
    return await apiRequest('POST', '/chat', {
      message: message,
      thinking_mode: state.thinkingMode,
      conversation_id: state.conversationId
    });
  }
  async function apiNewConversation() {
    return await apiRequest('POST', '/chat/new', null);
  }

  // ===================== 错误信息归一化 =====================
  function describeError(r, fallback) {
    if (!r) return fallback || '请求失败';
    if (r.status === 401 || r.status === 403) return '请重新登录后再试';
    if (r.status === 429) {
      if (r.data && r.data.remainingHour === 0) return '本小时聊天次数已用完，休息一下';
      return '今日 AI 聊天次数已达上限';
    }
    if (r.status === 502) return 'AI 服务调用失败，请稍后再试';
    if (r.status === 500) return '服务器错误，请稍后再试';
    if (r.status === 0) return '网络异常，请检查连接';
    if (r.error) return r.error;
    return fallback || '请求失败';
  }

  // ===================== 消息渲染 =====================
  function buildUsageLine(usage, thinkingMode, model) {
    if (!usage || typeof usage !== 'object') return null;
    var parts = [];
    var pt = usage.prompt_tokens || 0;
    var ct = usage.completion_tokens || 0;
    var hit = usage.prompt_cache_hit_tokens;
    var miss = usage.prompt_cache_miss_tokens;
    var cost = usage.cost;

    if (pt)  parts.push('输入 ' + pt);
    if (ct)  parts.push('输出 ' + ct);
    if (typeof hit === 'number' && hit > 0)  parts.push('缓存命中 ' + hit);
    if (typeof miss === 'number' && miss > 0) parts.push('未命中 ' + miss);
    if (typeof cost === 'number' && cost > 0) {
      var cur = usage.currency || 'CNY';
      parts.push('¥' + cost.toFixed(6) + ' ' + cur);
    }
    if (thinkingMode && thinkingMode !== 'off') parts.push('思考 ' + thinkingMode);
    if (model) parts.push(model);
    return parts.length ? parts.join(' · ') : null;
  }

  function buildMessageNode(msg) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    var wrapper = el('div', { class: 'ai-msg ' + role });

    var bubble = el('div', { class: 'ai-msg-bubble' });
    bubble.textContent = msg.content || '';
    wrapper.appendChild(bubble);

    if (role === 'assistant' && msg.usage) {
      var line = buildUsageLine(msg.usage, msg.thinking_mode, msg.model);
      if (line) {
        var usageMeta = el('div', { class: 'ai-msg-usage', text: line });
        wrapper.appendChild(usageMeta);
      }
    }
    if (msg.created_at) {
      var timeEl = el('div', { class: 'ai-msg-time', text: fmtTime(msg.created_at) });
      wrapper.appendChild(timeEl);
    }
    return wrapper;
  }

  function buildTypingNode() {
    var wrapper = el('div', { class: 'ai-msg assistant typing' });
    var bubble = el('div', { class: 'ai-msg-bubble' });
    for (var i = 0; i < 3; i++) bubble.appendChild(el('span'));
    wrapper.appendChild(bubble);
    return wrapper;
  }

  function buildEmptyState() {
    var cfg = state.config || {};
    var name = cfg.name || '徐旭泽的小猫';
    var avatar = cfg.avatar || '🐱';
    var tip = cfg.welcome_message || '喵，来聊天吧。';

    var empty = el('div', { class: 'ai-chat-empty' });
    empty.appendChild(el('div', { class: 'ai-chat-empty-emoji', text: avatar }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和' + name + '聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: tip }));
    return empty;
  }

  // ===================== 发送消息 =====================
  async function handleSendMessage(input, sendBtn, messagesEl, usageBar) {
    if (state.sending) return;
    var text = (input.value || '').trim();
    if (!text) return;

    state.sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中…';
    input.value = '';
    input.style.height = 'auto';

    // 乐观渲染用户消息
    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: text, created_at: nowIso };
    state.messages.push(userMsg);
    messagesEl.appendChild(buildMessageNode(userMsg));
    scrollToBottom(messagesEl);

    // 打字指示器
    var typingNode = buildTypingNode();
    messagesEl.appendChild(typingNode);
    scrollToBottom(messagesEl);

    var r = await apiPostChat(text);
    try { typingNode.remove(); } catch (e) {}

    if (r && r.ok && r.data && r.data.reply) {
      var d = r.data;
      var aiMsg = {
        role: 'assistant',
        content: d.reply,
        created_at: d.created_at || new Date().toISOString(),
        usage: d.usage || null,
        thinking_mode: d.thinking_mode || state.thinkingMode,
        model: d.model || null
      };
      state.messages.push(aiMsg);
      if (d.conversation_id) state.conversationId = d.conversation_id;
      messagesEl.appendChild(buildMessageNode(aiMsg));
      if (d.remaining) state.remaining = d.remaining;
      updateUsageBar(usageBar);
      scrollToBottom(messagesEl);
    } else {
      // 错误：把乐观渲染的用户消息回滚（不删除数据库中的，只是不在 UI 显示）
      state.messages.pop();
      try {
        if (messagesEl.lastChild === userMsg._node) messagesEl.removeChild(userMsg._node);
      } catch (e) {}
      // 但实际发送已到达数据库；这里我们从 messagesEl 找到对应 user 消息节点移除
      try {
        var last = messagesEl.lastElementChild;
        if (last && last.classList && last.classList.contains('user')) {
          messagesEl.removeChild(last);
        }
      } catch (e) {}
      notify(describeError(r, 'AI 暂时没有回应，请稍后再试'));
    }

    state.sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
    try { input.focus(); } catch (e) {}
  }

  function updateUsageBar(bar) {
    if (!bar) return;
    var parts = [];
    if (state.remaining) {
      if (typeof state.remaining.hour === 'number') parts.push('本小时剩 ' + state.remaining.hour + ' 次');
      if (typeof state.remaining.day === 'number')  parts.push('今日剩 '  + state.remaining.day  + ' 次');
    }
    if (state.thinkingMode && state.thinkingMode !== 'off') {
      var lvl = '思考';
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === state.thinkingMode) { lvl = THINKING_LEVELS[k].label; break; }
      }
      parts.push('思考 ' + lvl);
    }
    bar.textContent = parts.length ? parts.join(' · ') : '';
  }

  // ===================== 加载历史 =====================
  async function loadHistory(messagesEl, usageBar) {
    if (!messagesEl || state.loading) return;
    state.loading = true;
    try {
      // 先显示空状态占位
      messagesEl.innerHTML = '';
      messagesEl.appendChild(buildEmptyState());

      var data = await apiGetHistory(state.conversationId, HISTORY_LIMIT);
      if (data && Array.isArray(data.messages) && data.messages.length > 0) {
        // 后端已经按时间正序返回，直接渲染
        state.messages = data.messages;
        if (data.conversation_id) state.conversationId = data.conversation_id;
        messagesEl.innerHTML = '';
        data.messages.forEach(function(msg) {
          messagesEl.appendChild(buildMessageNode(msg));
        });
      } else {
        // 没有历史 → 保持空状态
        state.messages = [];
        messagesEl.innerHTML = '';
        messagesEl.appendChild(buildEmptyState());
      }
      updateUsageBar(usageBar);
      scrollToBottom(messagesEl);
    } finally {
      state.loading = false;
    }
  }

  // ===================== 主渲染（核心：完全接管 detail view） =====================
  // container 是 dock 的 dockChatMessages 容器
  function renderChatView(container) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('ai-chat-container');

    var name = (state.config && state.config.name) || '徐旭泽的小猫';
    var avatar = (state.config && state.config.avatar) || '🐱';
    var desc = (state.config && state.config.description) || '在线';

    // ===== 头部（独立一套，不依赖 dock 的 chat-header） =====
    var header = el('div', { class: 'ai-chat-header' });

    // 返回按钮
    var backBtn = el('button', { type: 'button', class: 'ai-chat-back', 'aria-label': '返回' }, '‹');
    backBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      try { window.__xtjCloseAiChat(); } catch (e) {}
    });
    header.appendChild(backBtn);

    // 头像
    header.appendChild(el('span', { class: 'ai-chat-header-avatar', text: avatar }));

    // 名字 + 状态
    var info = el('div', { class: 'ai-chat-header-info' });
    info.appendChild(el('div', { class: 'ai-chat-header-name', text: name }));
    info.appendChild(el('div', { class: 'ai-chat-header-status', text: desc }));
    header.appendChild(info);

    // 思考模式按钮（注意：放在新对话左侧）
    function getLevelMeta(v) {
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === v) return THINKING_LEVELS[k];
      }
      return THINKING_LEVELS[0];
    }
    var curLvl = getLevelMeta(state.thinkingMode);
    var thinkBtn = el('button', {
      type: 'button', class: 'ai-chat-think-btn', 'aria-label': '思考模式',
      title: '思考模式：' + curLvl.label
    }, (curLvl.icon ? curLvl.icon + ' ' : '') + '思考 ' + curLvl.label);
    if (state.thinkingMode !== 'off') thinkBtn.classList.add('active');
    thinkBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var idx = 0;
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === state.thinkingMode) { idx = k; break; }
      }
      var next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
      state.thinkingMode = next.value;
      try { localStorage.setItem('ai_thinking_mode', next.value); } catch (e) {}
      thinkBtn.textContent = (next.icon ? next.icon + ' ' : '') + '思考 ' + next.label;
      thinkBtn.title = '思考模式：' + next.label;
      if (next.value !== 'off') thinkBtn.classList.add('active');
      else thinkBtn.classList.remove('active');
      updateUsageBar(usageBar);
    });
    header.appendChild(thinkBtn);

    // 新对话按钮（最右）
    var newBtn = el('button', {
      type: 'button', class: 'ai-chat-new-btn', 'aria-label': '新对话',
      title: '开始新对话（不删除历史）'
    }, '新对话');
    newBtn.addEventListener('click', async function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.messages.length === 0 && !state.conversationId) {
        notify('已经是新对话了');
        return;
      }
      newBtn.disabled = true;
      try {
        var r = await apiNewConversation();
        if (r && r.ok && r.data && r.data.conversation_id) {
          state.conversationId = r.data.conversation_id;
          state.messages = [];
          messagesEl.innerHTML = '';
          messagesEl.appendChild(buildEmptyState());
          notify('已开始新对话，旧对话已保留在历史中');
        } else {
          notify(describeError(r, '创建新对话失败'));
        }
      } finally {
        newBtn.disabled = false;
      }
    });
    header.appendChild(newBtn);

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
      placeholder: '和' + name + '说点什么吧…',
      rows: '1', 'aria-label': '聊天输入框'
    });
    var sendBtn = el('button', {
      type: 'button', class: 'ai-chat-send', id: 'aiChatSendBtn',
      'aria-label': '发送'
    }, '发送');

    function doSend() { handleSendMessage(input, sendBtn, messagesEl, usageBar); }
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    // 自动增高
    function autoresize() {
      try {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      } catch (e) {}
    }
    input.addEventListener('input', autoresize);
    // 初次执行一次（防止初始 placeholder 行高异常）
    setTimeout(autoresize, 0);

    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    container.appendChild(inputBar);

    // 加载历史
    loadHistory(messagesEl, usageBar);
  }

  // ===================== 打开 AI 聊天（完全接管 dock detail view） =====================
  window.__xtjAiChatActive = false;
  window.__xtjAiChatLoading = false;

  window.__xtjOpenAiChat = async function() {
    if (window.__xtjAiChatLoading) return;
    window.__xtjAiChatLoading = true;
    try {
      if (!window.currentUser) {
        notify('请先登录后再和徐旭泽的小猫聊天');
        return;
      }

      // 切到 chat tab
      if (typeof window.switchDockTab === 'function') {
        try { window.switchDockTab('chat', true); } catch (e) {}
      }

      // 切到 detail view
      var listView = document.getElementById('dockChatListView');
      var detailView = document.getElementById('dockChatDetailView');
      if (listView) listView.classList.add('hidden');
      if (detailView) detailView.classList.remove('hidden');

      // ★ 关键：隐藏 dock 自带的 chat-header（避免双层套叠）
      try {
        var dockHeader = document.querySelector('#dockChatContainer .chat-header');
        if (dockHeader) dockHeader.style.display = 'none';
      } catch (e) {}

      // 隐藏普通 chat input
      try {
        var inputArea = document.querySelector('#dockChatDetailView .chat-input-area');
        if (inputArea) inputArea.style.display = 'none';
      } catch (e) {}

      // 渲染 AI 聊天 UI
      var messagesEl = document.getElementById('dockChatMessages');
      if (!messagesEl) {
        notify('聊天容器未找到');
        return;
      }
      renderChatView(messagesEl);

      // 停止 DM 轮询
      if (typeof window.stopDMPolling === 'function') {
        try { window.stopDMPolling(); } catch (e) {}
      }

      window.__xtjAiChatActive = true;

      // 加载 AI 公共配置
      var cfg = await apiGetConfig();
      if (cfg && cfg.config) {
        state.config = cfg.config;
        // 重新更新已渲染的 UI
        var name2 = state.config.name || '徐旭泽的小猫';
        var avatar2 = state.config.avatar || '🐱';
        var desc2 = state.config.description || '在线';
        var h = messagesEl.querySelector('.ai-chat-header-avatar');
        if (h) h.textContent = avatar2;
        var hn = messagesEl.querySelector('.ai-chat-header-name');
        if (hn) hn.textContent = name2;
        var hs = messagesEl.querySelector('.ai-chat-header-status');
        if (hs) hs.textContent = desc2;
        var inp = document.getElementById('aiChatMsgInput');
        if (inp) inp.placeholder = '和' + name2 + '说点什么吧…';
        var empty = messagesEl.querySelector('.ai-chat-empty');
        if (empty) {
          var e1 = empty.querySelector('.ai-chat-empty-emoji');
          if (e1) e1.textContent = avatar2;
          var e2 = empty.querySelector('.ai-chat-empty-title');
          if (e2) e2.textContent = '和' + name2 + '聊聊天';
          var e3 = empty.querySelector('.ai-chat-empty-tip');
          if (e3) e3.textContent = state.config.welcome_message || '喵，来聊天吧。';
        }
      }
    } finally {
      window.__xtjAiChatLoading = false;
    }
  };

  // 关闭 AI 聊天（恢复 dock 默认状态）
  window.__xtjCloseAiChat = function() {
    try {
      // 恢复 dock 的 chat-header 显示
      var dockHeader = document.querySelector('#dockChatContainer .chat-header');
      if (dockHeader) dockHeader.style.display = '';
      // 恢复普通 chat input
      var inputArea = document.querySelector('#dockChatDetailView .chat-input-area');
      if (inputArea) inputArea.style.display = '';
      // 清理 ai-chat-container 类
      var ml = document.getElementById('dockChatMessages');
      if (ml) {
        ml.classList.remove('ai-chat-container');
        ml.innerHTML = '';
      }
      // 切回 list view
      var listView = document.getElementById('dockChatListView');
      var detailView = document.getElementById('dockChatDetailView');
      if (detailView) detailView.classList.add('hidden');
      if (listView) listView.classList.remove('hidden');
      // 恢复 dock title
      var titleEl = document.getElementById('dockChatTitle');
      if (titleEl) titleEl.textContent = '消息';
    } catch (e) {}
    window.__xtjAiChatActive = false;
    // 触发 dock 列表刷新
    try { if (typeof window.renderDockChatList === 'function') window.renderDockChatList(); } catch (e) {}
  };
})();
