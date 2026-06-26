(function() {
  'use strict';

  // ===================== 配置 =====================
  var API_BASE = '/api/agent';
  var HISTORY_PAGE_SIZE = 30;        // 一次加载多少条
  var CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 分钟 config 缓存
  var CONV_ID_KEY = 'xtj_ai_last_conversation_id';
  var THINKING_MODE_KEY = 'xtj_ai_thinking_mode';
  var THINKING_LEVELS = [
    { value: 'off',    label: '关', icon: ''  },
    { value: 'low',    label: '低', icon: '⚡' },
    { value: 'medium', label: '中', icon: '🧠' },
    { value: 'high',   label: '高', icon: '🔥' }
  ];

  // ===================== 状态（全局单例） =====================
  var S = {
    config: null,           // { name, avatar, description, welcome_message }
    configFetchedAt: 0,     // 0 = 未拉过
    conversationId: null,   // 当前 convId
    messages: [],           // 当前已加载消息
    oldestCursor: null,     // 滚动加载的 cursor
    hasMore: false,
    sending: false,
    loading: false,         // 首次加载
    loadingMore: false,     // 滚动加载
    thinkingMode: (function() {
      try { return localStorage.getItem(THINKING_MODE_KEY) || 'off'; } catch (e) { return 'off'; }
    })(),
    active: false,          // AI 模式是否激活
    rootEl: null,           // #aiChatRoot 引用
    bound: false            // 是否已绑全局事件
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
    try { console.warn('[AI]', msg); } catch (e) {}
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    } catch (e) { return ''; }
  }

  function readConvId() {
    try { return localStorage.getItem(CONV_ID_KEY) || null; } catch (e) { return null; }
  }
  function writeConvId(v) {
    try {
      if (v) localStorage.setItem(CONV_ID_KEY, v);
      else localStorage.removeItem(CONV_ID_KEY);
    } catch (e) {}
  }

  // ===================== API（统一封装） =====================
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
      return { ok: false, status: 0, data: null, error: (e && e.message) || '网络异常' };
    }
  }

  function describeError(r, fallback) {
    if (!r) return fallback || '请求失败';
    if (r.status === 401 || r.status === 403) return '请重新登录后再试';
    if (r.status === 429) return 'AI 聊天次数已达上限，休息一下再来吧';
    if (r.status === 502) return 'AI 服务调用失败，请稍后再试';
    if (r.status === 500) return '服务器错误，请稍后再试';
    if (r.status === 0)  return '网络异常，请检查连接';
    if (r.error) return r.error;
    return fallback || '请求失败';
  }

  // ===================== Config 缓存 =====================
  async function ensureConfig() {
    var now = Date.now();
    if (S.config && (now - S.configFetchedAt) < CONFIG_CACHE_TTL) return S.config;
    var r = await apiRequest('GET', '/config');
    if (r.ok && r.data && r.data.config) {
      S.config = r.data.config;
      S.configFetchedAt = now;
      return S.config;
    }
    // 失败兜底（不阻塞 UI）
    S.config = S.config || {
      name: '徐旭泽的小猫',
      avatar: '🐱',
      description: '在线',
      welcome_message: '喵，来聊天吧。'
    };
    return S.config;
  }

  // ===================== 消息渲染 =====================
  function buildUsageLine(usage) {
    if (!usage || typeof usage !== 'object') return null;
    var parts = [];
    var pt = usage.prompt_tokens || 0;
    var ct = usage.completion_tokens || 0;
    var hit = usage.prompt_cache_hit_tokens;
    var miss = usage.prompt_cache_miss_tokens;
    var cost = usage.cost;
    if (pt) parts.push('输入 ' + pt);
    if (ct) parts.push('输出 ' + ct);
    if (typeof hit === 'number' && hit > 0) parts.push('命中 ' + hit);
    if (typeof miss === 'number' && miss > 0) parts.push('未命中 ' + miss);
    if (typeof cost === 'number' && cost > 0) {
      var cur = usage.currency || 'CNY';
      parts.push('¥' + cost.toFixed(6) + ' ' + cur);
    }
    if (usage.thinking_mode && usage.thinking_mode !== 'off') parts.push('思考 ' + usage.thinking_mode);
    if (usage.model) parts.push(usage.model);
    return parts.length ? parts.join(' · ') : null;
  }

  function buildMessageNode(msg) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    var node = el('div', { class: 'ai-msg ' + role });
    node.appendChild(el('div', { class: 'ai-msg-bubble', text: msg.content || '' }));
    if (role === 'assistant' && msg.usage) {
      var line = buildUsageLine(msg.usage);
      if (line) node.appendChild(el('div', { class: 'ai-msg-usage', text: line }));
    }
    if (msg.created_at) {
      node.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
    }
    return node;
  }

  function buildTypingNode() {
    var node = el('div', { class: 'ai-msg assistant typing' });
    var bubble = el('div', { class: 'ai-msg-bubble' });
    for (var i = 0; i < 3; i++) bubble.appendChild(el('span'));
    node.appendChild(bubble);
    return node;
  }

  function buildEmptyState() {
    var cfg = S.config || {};
    var empty = el('div', { class: 'ai-chat-empty' });
    empty.appendChild(el('div', { class: 'ai-chat-empty-emoji', text: cfg.avatar || '🐱' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和' + (cfg.name || '徐旭泽的小猫') + '聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: cfg.welcome_message || '喵，来聊天吧。' }));
    return empty;
  }

  // ===================== 发送消息 =====================
  async function handleSendMessage(input, sendBtn, messagesEl) {
    if (S.sending) return;
    var text = (input.value || '').trim();
    if (!text) return;

    S.sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中…';
    var oldPlaceholder = input.placeholder;
    input.disabled = true;

    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: text, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);

    var typingNode = buildTypingNode();
    messagesEl.appendChild(typingNode);
    scrollToBottom(messagesEl);

    var r = await apiRequest('POST', '/chat', {
      message: text,
      thinking_mode: S.thinkingMode,
      conversation_id: S.conversationId
    });

    try { typingNode.remove(); } catch (e) {}

    if (r && r.ok && r.data && r.data.reply) {
      var d = r.data;
      if (d.conversation_id) {
        S.conversationId = d.conversation_id;
        writeConvId(d.conversation_id);
      }
      var aiMsg = {
        role: 'assistant',
        content: d.reply,
        created_at: d.created_at || new Date().toISOString(),
        usage: d.usage || null
      };
      S.messages.push(aiMsg);
      appendMessage(messagesEl, aiMsg);
      scrollToBottom(messagesEl);
    } else {
      // 失败：移除乐观渲染的 user 消息（数据库不动）
      S.messages.pop();
      removeLastUserMessage(messagesEl);
      notify(describeError(r, 'AI 暂时没有回应，请稍后再试'));
    }

    S.sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
    input.disabled = false;
    input.value = '';
    input.style.height = 'auto';
    input.placeholder = oldPlaceholder;
    try { input.focus(); } catch (e) {}
  }

  function appendMessage(messagesEl, msg) {
    // 移除空状态
    var empty = messagesEl.querySelector('.ai-chat-empty');
    if (empty) empty.remove();
    messagesEl.appendChild(buildMessageNode(msg));
  }
  function removeLastUserMessage(messagesEl) {
    var nodes = messagesEl.querySelectorAll('.ai-msg.user');
    if (nodes && nodes.length) {
      try { nodes[nodes.length - 1].remove(); } catch (e) {}
    }
  }

  function scrollToBottom(container) {
    if (!container) return;
    try { requestAnimationFrame(function() { container.scrollTop = container.scrollHeight; }); } catch (e) {}
  }

  // ===================== 加载历史 =====================
  async function loadHistory(messagesEl, before) {
    if (S.loading || S.loadingMore) return;
    if (before) S.loadingMore = true; else S.loading = true;
    try {
      var qs = '?limit=' + HISTORY_PAGE_SIZE;
      if (S.conversationId) qs += '&conversation_id=' + encodeURIComponent(S.conversationId);
      else {
        // ★ 不带 convId：后端会查最近一条 AI 消息的 conv 再返回该 conv
        //   如果从没聊过，convId 仍为 null
      }
      if (before) qs += '&before=' + encodeURIComponent(before);
      var r = await apiRequest('GET', '/chat/history' + qs);
      if (!r.ok || !r.data) {
        if (!before) showEmptyOrError(messagesEl, r);
        return;
      }
      if (r.data.conversation_id) {
        S.conversationId = r.data.conversation_id;
        writeConvId(r.data.conversation_id);
      }
      S.hasMore = !!r.data.has_more;
      S.oldestCursor = r.data.oldest || S.oldestCursor;
      var msgs = r.data.messages || [];
      if (!msgs.length && !before) {
        // 没历史 → 空状态
        S.messages = [];
        messagesEl.innerHTML = '';
        messagesEl.appendChild(buildEmptyState());
        return;
      }
      if (!before) {
        // 首次加载
        S.messages = msgs;
        messagesEl.innerHTML = '';
        msgs.forEach(function(m) { messagesEl.appendChild(buildMessageNode(m)); });
        scrollToBottom(messagesEl);
      } else {
        // 滚动加载更多
        var oldScroll = messagesEl.scrollHeight;
        msgs.forEach(function(m) { messagesEl.insertBefore(buildMessageNode(m), messagesEl.firstChild); });
        // 保持视觉位置
        try {
          requestAnimationFrame(function() {
            var newScroll = messagesEl.scrollHeight;
            messagesEl.scrollTop = newScroll - oldScroll;
          });
        } catch (e) {}
      }
    } finally {
      S.loading = false;
      S.loadingMore = false;
    }
  }

  function showEmptyOrError(messagesEl, r) {
    messagesEl.innerHTML = '';
    messagesEl.appendChild(buildEmptyState());
    if (r && !r.ok) notify(describeError(r, '历史加载失败'));
  }

  // ===================== 渲染 AI 聊天页（独立 #aiChatRoot） =====================
  function renderAiRoot() {
    // ★ 关键：先确保旧的 #aiChatRoot 不存在
    var old = document.getElementById('aiChatRoot');
    if (old) try { old.remove(); } catch (e) {}

    var root = el('div', { id: 'aiChatRoot', class: 'ai-chat-root' });

    // ----- Header -----
    var header = el('div', { class: 'ai-chat-header' });

    var backBtn = el('button', { type: 'button', class: 'ai-chat-back', 'aria-label': '返回', text: '‹' });
    backBtn.addEventListener('click', function(ev) {
      ev.preventDefault(); ev.stopPropagation();
      closeAiChat();
    });
    header.appendChild(backBtn);

    header.appendChild(el('div', { class: 'ai-chat-header-avatar', id: 'aiChatHeaderAvatar', text: '🐱' }));
    var info = el('div', { class: 'ai-chat-header-info' });
    info.appendChild(el('div', { class: 'ai-chat-header-name', id: 'aiChatHeaderName', text: '徐旭泽的小猫' }));
    info.appendChild(el('div', { class: 'ai-chat-header-status', id: 'aiChatHeaderStatus', text: '在线' }));
    header.appendChild(info);

    // 思考模式按钮
    function getLevelMeta(v) {
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === v) return THINKING_LEVELS[k];
      }
      return THINKING_LEVELS[0];
    }
    var curLvl = getLevelMeta(S.thinkingMode);
    var thinkBtn = el('button', {
      type: 'button', class: 'ai-chat-think-btn', 'aria-label': '思考模式',
      title: '思考模式：' + curLvl.label
    }, (curLvl.icon ? curLvl.icon + ' ' : '') + '思考 ' + curLvl.label);
    if (S.thinkingMode !== 'off') thinkBtn.classList.add('active');
    thinkBtn.addEventListener('click', function(ev) {
      ev.preventDefault(); ev.stopPropagation();
      var idx = 0;
      for (var k = 0; k < THINKING_LEVELS.length; k++) {
        if (THINKING_LEVELS[k].value === S.thinkingMode) { idx = k; break; }
      }
      var next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
      S.thinkingMode = next.value;
      try { localStorage.setItem(THINKING_MODE_KEY, next.value); } catch (e) {}
      thinkBtn.textContent = (next.icon ? next.icon + ' ' : '') + '思考 ' + next.label;
      thinkBtn.title = '思考模式：' + next.label;
      if (next.value !== 'off') thinkBtn.classList.add('active');
      else thinkBtn.classList.remove('active');
    });
    header.appendChild(thinkBtn);

    // 新对话按钮
    var newBtn = el('button', {
      type: 'button', class: 'ai-chat-new-btn', 'aria-label': '新对话',
      title: '开始新对话（不删除历史）'
    }, '新对话');
    newBtn.addEventListener('click', async function(ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (S.sending) return;
      newBtn.disabled = true;
      try {
        var r = await apiRequest('POST', '/chat/new', null);
        if (r && r.ok && r.data && r.data.conversation_id) {
          S.conversationId = r.data.conversation_id;
          writeConvId(r.data.conversation_id);
          S.messages = [];
          S.oldestCursor = null;
          S.hasMore = false;
          var messagesEl2 = document.getElementById('aiChatMessagesArea');
          if (messagesEl2) {
            messagesEl2.innerHTML = '';
            messagesEl2.appendChild(buildEmptyState());
          }
          notify('已开始新对话，旧对话已保留在历史中');
        } else {
          notify(describeError(r, '创建新对话失败'));
        }
      } finally {
        newBtn.disabled = false;
      }
    });
    header.appendChild(newBtn);

    root.appendChild(header);

    // ----- Messages -----
    var messagesEl = el('div', { class: 'ai-chat-messages', id: 'aiChatMessagesArea' });
    // 滚动到顶加载更多
    messagesEl.addEventListener('scroll', function() {
      if (messagesEl.scrollTop < 60 && S.hasMore && !S.loading && !S.loadingMore && S.oldestCursor) {
        loadHistory(messagesEl, S.oldestCursor);
      }
    });
    root.appendChild(messagesEl);

    // ----- Input -----
    var inputBar = el('div', { class: 'ai-chat-input-bar' });
    var input = el('textarea', {
      class: 'ai-chat-input', id: 'aiChatMsgInput',
      placeholder: '和徐旭泽的小猫说点什么吧…',
      rows: '1', 'aria-label': '聊天输入框',
      autocapitalize: 'sentences', autocorrect: 'on', spellcheck: 'true'
    });
    var sendBtn = el('button', {
      type: 'button', class: 'ai-chat-send', id: 'aiChatSendBtn',
      'aria-label': '发送'
    }, '发送');
    function doSend() { handleSendMessage(input, sendBtn, messagesEl); }
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    function autoresize() {
      try {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      } catch (e) {}
    }
    input.addEventListener('input', autoresize);
    setTimeout(autoresize, 0);

    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    root.appendChild(inputBar);

    return { root: root, messagesEl: messagesEl, input: input };
  }

  // ===================== 打开 AI 聊天 =====================
  async function openAiChat() {
    if (S.active) return;
    if (!window.currentUser) {
      notify('请先登录后再和徐旭泽的小猫聊天');
      return;
    }
    S.active = true;

    // 切到 chat tab
    if (typeof window.switchDockTab === 'function') {
      try { window.switchDockTab('chat', true); } catch (e) {}
    }

    // 切到 detail view
    var listView = document.getElementById('dockChatListView');
    var detailView = document.getElementById('dockChatDetailView');
    var panelChat = document.getElementById('panelChat');
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');
    if (panelChat) panelChat.classList.add('ai-mode');
    if (detailView) detailView.classList.add('ai-mode');

    // 渲染独立 root
    var r = renderAiRoot();
    if (detailView) detailView.appendChild(r.root);
    S.rootEl = r.root;

    // 恢复 localStorage 中的 convId
    S.conversationId = readConvId();

    // 加载 config + 历史
    try {
      var cfg = await ensureConfig();
      applyConfigToUI(cfg);
    } catch (e) {}
    await loadHistory(r.messagesEl, null);

    // 隐藏 dock 自带的 chat-header / input-area
    // ★ 既然用了独立 root + .ai-mode 作用域，CSS 处理即可，无需 inline style
    //   仍然保留防御性 inline 隐藏
    try {
      var hdr = document.querySelector('#dockChatContainer .chat-header');
      if (hdr) hdr.style.display = 'none';
      var ina = document.querySelector('#dockChatDetailView .chat-input-area');
      if (ina) ina.style.display = 'none';
      var dcm = document.getElementById('dockChatMessages');
      if (dcm) dcm.style.display = 'none';
    } catch (e) {}

    // 停止 DM 轮询
    if (typeof window.stopDMPolling === 'function') {
      try { window.stopDMPolling(); } catch (e) {}
    }

    // focus input
    setTimeout(function() { try { r.input.focus(); } catch (e) {} }, 80);
  }

  function applyConfigToUI(cfg) {
    if (!cfg) return;
    var avatar = cfg.avatar || '🐱';
    var name = cfg.name || '徐旭泽的小猫';
    var desc = cfg.description || '在线';
    var avatarEl = document.getElementById('aiChatHeaderAvatar');
    var nameEl = document.getElementById('aiChatHeaderName');
    var statusEl = document.getElementById('aiChatHeaderStatus');
    if (avatarEl) avatarEl.textContent = avatar;
    if (nameEl) nameEl.textContent = name;
    if (statusEl) statusEl.textContent = desc;
    var inp = document.getElementById('aiChatMsgInput');
    if (inp) inp.placeholder = '和' + name + '说点什么吧…';
    var empty = document.querySelector('#aiChatRoot .ai-chat-empty');
    if (empty) {
      var e1 = empty.querySelector('.ai-chat-empty-emoji');
      if (e1) e1.textContent = avatar;
      var e2 = empty.querySelector('.ai-chat-empty-title');
      if (e2) e2.textContent = '和' + name + '聊聊天';
      var e3 = empty.querySelector('.ai-chat-empty-tip');
      if (e3) e3.textContent = cfg.welcome_message || '喵，来聊天吧。';
    }
  }

  // ===================== 关闭 AI 聊天 =====================
  function closeAiChat() {
    if (!S.active) return;
    S.active = false;

    // 移除 .ai-mode
    var panelChat = document.getElementById('panelChat');
    var detailView = document.getElementById('dockChatDetailView');
    if (panelChat) panelChat.classList.remove('ai-mode');
    if (detailView) detailView.classList.remove('ai-mode');

    // 恢复 dock 元素显示
    try {
      var hdr = document.querySelector('#dockChatContainer .chat-header');
      if (hdr) hdr.style.display = '';
      var ina = document.querySelector('#dockChatDetailView .chat-input-area');
      if (ina) ina.style.display = '';
      var dcm = document.getElementById('dockChatMessages');
      if (dcm) dcm.style.display = '';
    } catch (e) {}

    // 移除 root
    if (S.rootEl) { try { S.rootEl.remove(); } catch (e) {} S.rootEl = null; }

    // 切回 list view
    // ★ 关键：必须用 var 声明，避免 if (listView = ...) 隐式创建全局变量
    var listView2 = document.getElementById('dockChatListView');
    if (listView2) listView2.classList.remove('hidden');
    if (detailView) detailView.classList.add('hidden');

    // 恢复 dock title
    var titleEl = document.getElementById('dockChatTitle');
    if (titleEl) titleEl.textContent = '消息';

    // 触发列表刷新
    if (typeof window.renderDockChatList === 'function') {
      try { window.renderDockChatList(); } catch (e) {}
    }
  }

  // ===================== 插入 AI 入口到聊天列表 =====================
  function insertEntry() {
    var listView = document.getElementById('dockChatListView');
    if (!listView) return;

    // 移除旧的
    var old = listView.querySelector('[data-chat-user="__ai_agent__"]');
    if (old) try { old.remove(); } catch (e) {}

    var cfg = S.config || { name: '徐旭泽的小猫', avatar: '🐱' };
    var name = cfg.name || '徐旭泽的小猫';
    var avatar = cfg.avatar || '🐱';
    var desc = cfg.description || 'AI 智能体';

    var item = el('div', {
      class: 'chat-list-item ai-agent-entry',
      'data-chat-user': '__ai_agent__',
      role: 'button',
      tabindex: '0',
      'aria-label': '打开 ' + name
    });
    item.appendChild(el('span', { class: 'chat-list-avatar', text: avatar }));
    var meta = el('div', { class: 'chat-list-meta' });
    meta.appendChild(el('div', { class: 'chat-list-name', text: name }));
    meta.appendChild(el('div', { class: 'chat-list-preview', text: desc }));
    item.appendChild(meta);
    item.appendChild(el('span', { class: 'chat-list-arrow', text: '›' }));

    function onActivate() {
      if (!window.currentUser) {
        notify('请先登录后再和' + name + '聊天');
        return;
      }
      openAiChat();
    }
    item.addEventListener('click', onActivate);
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    });

    // 置顶插入
    listView.insertBefore(item, listView.firstChild);
  }

  // ===================== 注入聊天列表 hook =====================
  function hookChatList() {
    if (S.bound) return;
    // 拦截 renderDockChatList，每次调用后重新插入 AI 入口（保证不重复）
    var original = window.renderDockChatList;
    window.renderDockChatList = function() {
      var ret;
      if (typeof original === 'function') {
        try { ret = original.apply(this, arguments); } catch (e) {}
      }
      // ★ 关键：必须先 return ret，再执行 setTimeout，否则提前 return 会跳过 insertEntry
      //   普通聊天列表刷新后会清空 #dockChatListView 的子元素，覆盖 AI 入口
      //   setTimeout 0 是为了让 original 内部 DOM 操作先完成再插入，避免被原函数后续逻辑覆盖
      setTimeout(insertEntry, 0);
      return ret;
    };
    S.bound = true;
  }

  // ===================== 调试函数 =====================
  window.__debugAiClick = function() {
    try {
      var x = window.innerWidth / 2;
      var y = window.innerHeight - 80;
      var el2 = document.elementFromPoint(x, y);
      console.log('[DEBUG-AI] elementFromPoint(' + x + ', ' + y + ') =', el2);
      console.log('[DEBUG-AI] tag=' + (el2 ? el2.tagName : 'null') + ' id=' + (el2 ? el2.id : '') + ' class=' + (el2 ? el2.className : ''));
      return el2;
    } catch (e) { console.error('[DEBUG-AI]', e); }
  };

  // ===================== 暴露 API =====================
  window.__xtjAiAgent = {
    open: openAiChat,
    close: closeAiChat,
    insertEntry: insertEntry,
    getConfig: function() { return S.config; },
    getConversationId: function() { return S.conversationId; }
  };
  // 同时保留旧名字兼容
  window.__xtjOpenAiChat = openAiChat;
  window.__xtjCloseAiChat = closeAiChat;

  // ===================== 启动 =====================
  function bootstrap() {
    // 1. 拉一次 config（不阻塞）
    ensureConfig().then(function(cfg) {
      S.config = cfg;
      insertEntry();
    }).catch(function() {
      S.config = { name: '徐旭泽的小猫', avatar: '🐱', description: 'AI 智能体', welcome_message: '喵，来聊天吧。' };
      insertEntry();
    });
    // 2. hook 聊天列表
    hookChatList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
