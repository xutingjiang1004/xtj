(function() {
  'use strict';

  // ===================== 配置 =====================
  // ★ 关键修复：API_BASE 不能再写死为 /api/agent
  //   - 前端可能部署在 Vercel/Netlify/静态站
  //   - 后端在 Render
  //   - 相对路径 /api/agent 会打到前端域名导致 404/405
  //   - 统一从 window.XTJ_CONFIG.API_BASE 读，缺省才回落到 window.location.origin
  var ROOT_API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
  ROOT_API_BASE = String(ROOT_API_BASE || '').replace(/\/$/, '');
  var API_BASE = ROOT_API_BASE + '/api/agent';
  try { console.warn('[AI] API_BASE =', API_BASE); } catch (e) {}
  var HISTORY_PAGE_SIZE = 30;
  var CONFIG_CACHE_TTL = 5 * 60 * 1000;
  var CONV_ID_KEY = 'xtj_ai_last_conversation_id';
  var THINKING_MODE_KEY = 'xtj_ai_thinking_mode';
  // 兼容多种旧 localStorage key
  var USER_NAME_KEYS = ['xtj_user', 'xtj_username', 'xtj_user_name'];
  var PW_HASH_KEYS = ['xtj_pw_hash', 'xtj_password_hash'];
  var THINKING_LEVELS = [
    { value: 'off',    label: '关', icon: ''  },
    { value: 'low',    label: '低', icon: '⚡' },
    { value: 'medium', label: '中', icon: '🧠' },
    { value: 'high',   label: '高', icon: '🔥' }
  ];

  // ===================== 状态 =====================
  var S = {
    config: null,
    configFetchedAt: 0,
    conversationId: null,
    messages: [],
    oldestCursor: null,
    hasMore: false,
    sending: false,
    loading: false,
    loadingMore: false,
    thinkingMode: (function() {
      try { return localStorage.getItem(THINKING_MODE_KEY) || 'off'; } catch (e) { return 'off'; }
    })(),
    active: false,
    rootEl: null,
    bound: false
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
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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

  // ===================== 鉴权兜底（双层 fallback）=====================
  // 1. 优先 Bearer token
  // 2. 没有 token 时自动用 user_name + password_hash 兜底
  // 3. 同时从 localStorage / sessionStorage 多种 key 读取兼容老数据
  function readUserName() {
    if (window.currentUser) {
      if (typeof window.currentUser === 'string') return window.currentUser;
      if (window.currentUser.user_name) return window.currentUser.user_name;
      if (window.currentUser.name) return window.currentUser.name;
    }
    for (var i = 0; i < USER_NAME_KEYS.length; i++) {
      try {
        var v = localStorage.getItem(USER_NAME_KEYS[i]);
        if (v) return v;
      } catch (e) {}
      try {
        var s = sessionStorage.getItem(USER_NAME_KEYS[i]);
        if (s) return s;
      } catch (e) {}
    }
    return '';
  }
  function readPwHash() {
    for (var i = 0; i < PW_HASH_KEYS.length; i++) {
      try {
        var v = sessionStorage.getItem(PW_HASH_KEYS[i]);
        if (v) return v;
      } catch (e) {}
      try {
        var l = localStorage.getItem(PW_HASH_KEYS[i]);
        if (l) return l;
      } catch (e) {}
    }
    return '';
  }

  // 返回 { token, headers, body, query, userName, passwordHash }
  // options.forceNoToken = true 时强制不走 token（重试 401/403 后用）
  // 注意：即使无 token，也总是返回 userName/passwordHash（用于日志/重试判断）
  async function getUserAuthPayload(options) {
    options = options || {};
    var forceNoToken = !!options.forceNoToken;

    // 1. 优先 token（重试模式下不读旧 token）
    var token = '';
    if (!forceNoToken) {
      try {
        if (typeof window.ensureUserToken === 'function') {
          token = await window.ensureUserToken();
        }
      } catch (e) {
        token = '';
      }
    }

    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // 2. 读取 user_name / password_hash（任何模式都读，用于重试兜底）
    var un = readUserName();
    var pw = readPwHash();

    var body = {};
    var query = {};
    if (!token && un && pw) {
      body.user_name = un;
      body.password_hash = pw;
      query.user_name = un;
      query.password_hash = pw;
    }
    return { token: token, headers: headers, body: body, query: query, userName: un, passwordHash: pw };
  }

  // ===================== 清理 AI 模块的 user token =====================
  function clearAiUserToken() {
    try { if (typeof window.clearUserToken === 'function') window.clearUserToken(); } catch (e) {}
    try { localStorage.removeItem('xtj_user_token'); } catch (e) {}
    try { sessionStorage.removeItem('xtj_user_token'); } catch (e) {}
    try { localStorage.removeItem('xtj_user_token_ts'); } catch (e) {}
  }

  // ===================== 是否有本地 password_hash 兜底 =====================
  function hasLocalPasswordHash() {
    return !!(readUserName() && readPwHash());
  }

  // ===================== API（统一封装）=====================
  // 返回 { ok, status, data, error, url, rawText }
  // 失败时 console.warn 打印真实状态码/响应体，便于排查
  // ★ 401/403 后自动清理旧 token 并用 password_hash 兜底重试一次
  async function apiRequest(method, path, body) {
    var first = await sendOnce(method, path, body, { forceNoToken: false });
    if (first && (first.status === 401 || first.status === 403)) {
      // 仅在有本地 password_hash 兜底时才重试，避免无谓请求
      if (hasLocalPasswordHash()) {
        try { console.warn('[AI] auth failed, retrying with password_hash fallback'); } catch (e) {}
        clearAiUserToken();
        var second = await sendOnce(method, path, body, { forceNoToken: true, retry: true });
        try { console.warn('[AI] retry result', { status: second && second.status, ok: second && second.ok }); } catch (e) {}
        return second;
      } else {
        // 没有任何兜底，尝试主动 refreshUserToken
        if (typeof window.refreshUserToken === 'function') {
          try {
            var refreshed = await window.refreshUserToken(true);
            if (refreshed) {
              try { console.warn('[AI] auth failed, retried with refreshed token'); } catch (e) {}
              var third = await sendOnce(method, path, body, { forceNoToken: false, retry: true });
              try { console.warn('[AI] retry result', { status: third && third.status, ok: third && third.ok }); } catch (e) {}
              return third;
            }
          } catch (e) {}
        }
      }
    }
    return first;
  }

  // ===================== 实际发起一次请求 =====================
  // options.forceNoToken = true 时强制不带 Authorization（用 password_hash 兜底）
  async function sendOnce(method, path, body, options) {
    options = options || {};
    var auth = null;
    var url = API_BASE + path;
    try {
      auth = await getUserAuthPayload({ forceNoToken: !!options.forceNoToken });
      var headers = auth.headers;
      var opts = { method: method, headers: headers };

      if (method === 'GET') {
        // GET：把兜底鉴权加到 query
        var extra = [];
        for (var k in auth.query) {
          if (auth.query.hasOwnProperty(k) && auth.query[k] !== undefined && auth.query[k] !== null) {
            extra.push(encodeURIComponent(k) + '=' + encodeURIComponent(auth.query[k]));
          }
        }
        if (extra.length) {
          var sep = path.indexOf('?') >= 0 ? '&' : '?';
          url = API_BASE + path + sep + extra.join('&');
        }
      } else {
        // POST：把兜底鉴权合并到 body
        var merged = {};
        for (var bk in (body || {})) {
          if ((body || {}).hasOwnProperty(bk)) merged[bk] = (body || {})[bk];
        }
        for (var ak in auth.body) {
          if (auth.body.hasOwnProperty(ak) && merged[ak] === undefined) {
            merged[ak] = auth.body[ak];
          }
        }
        if (Object.keys(merged).length > 0) {
          opts.body = JSON.stringify(merged);
        }
      }

      var resp = await fetch(url, opts);
      var rawText = '';
      try { rawText = await resp.text(); } catch (e) { rawText = ''; }
      var data = null;
      if (rawText) {
        try { data = JSON.parse(rawText); } catch (e) { data = null; }
      }
      var result = {
        ok: resp.ok,
        status: resp.status,
        data: data,
        error: data && data.error ? data.error : null,
        url: url,
        rawText: rawText ? String(rawText).slice(0, 300) : ''
      };
      if (!result.ok && !options.retry) {
        try {
          console.warn('[AI] request failed', {
            method: method,
            url: url,
            status: resp.status,
            data: data,
            error: result.error,
            rawText: result.rawText
          });
        } catch (e) {}
      }
      return result;
    } catch (e) {
      var errMsg = (e && e.message) || '网络异常';
      try { console.warn('[AI] request exception', { method: method, url: url, error: errMsg }); } catch (e2) {}
      return { ok: false, status: 0, data: null, error: errMsg, url: url, rawText: '' };
    }
  }

  function describeError(r, fallback) {
    if (!r) return fallback || '请求失败';
    if (r.status === 401 || r.status === 403) return '登录状态失效，请重新登录';
    if (r.status === 404) return 'AI 后端接口不存在，请检查 API_BASE / 部署域名';
    if (r.status === 405) return 'AI 后端方法不允许，请检查 API_BASE / 部署域名';
    if (r.status === 429) return 'AI 聊天次数已达上限，休息一下再来吧';
    if (r.status === 502) return 'AI 服务调用失败，请检查 DeepSeek API Key / 模型名 / Render Logs';
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
    if (msg.created_at) node.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
    return node;
  }
  function buildTypingNode() {
    var node = el('div', { class: 'ai-msg assistant typing' });
    var bubble = el('div', { class: 'ai-msg-bubble' });
    for (var i = 0; i < 3; i++) bubble.appendChild(el('span'));
    node.appendChild(bubble);
    return node;
  }
  function buildEmptyState(tipText) {
    var cfg = S.config || {};
    var empty = el('div', { class: 'ai-chat-empty' });
    empty.appendChild(el('div', { class: 'ai-chat-empty-emoji', text: cfg.avatar || '🐱' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和' + (cfg.name || '徐旭泽的小猫') + '聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: tipText || (cfg.welcome_message || '喵，来聊天吧。') }));
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

  // ===================== 加载历史（500 不阻塞输入框）=====================
  async function loadHistory(messagesEl, before) {
    if (S.loading || S.loadingMore) return;
    if (before) S.loadingMore = true; else S.loading = true;
    try {
      var qs = '?limit=' + HISTORY_PAGE_SIZE;
      if (S.conversationId) qs += '&conversation_id=' + encodeURIComponent(S.conversationId);
      if (before) qs += '&before=' + encodeURIComponent(before);
      var r = await apiRequest('GET', '/chat/history' + qs);

      if (!r.ok || !r.data) {
        if (!before) {
          // ★ 关键：500 不阻塞输入框
          //   - 控制台 warn（让开发者能看到）
          //   - 显示空状态 + 友好提示
          //   - 不清空 messagesEl（如果已有内容）
          try { console.warn('[AI] loadHistory failed:', r.status, r.error); } catch (e) {}
          if (messagesEl.children.length === 0) {
            messagesEl.innerHTML = '';
            messagesEl.appendChild(buildEmptyState('聊天历史加载失败（' + (r.status || '?') + '），但你仍可发送新消息'));
          } else {
            // 已有内容时，仅在头部追加一个小提示
            var warnEl = el('div', { class: 'ai-msg-warn', text: '聊天历史加载失败（' + (r.status || '?') + '），但你仍可发送新消息' });
            messagesEl.appendChild(warnEl);
          }
          // 不 throw、不弹窗阻塞 UI
        }
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
        S.messages = [];
        messagesEl.innerHTML = '';
        messagesEl.appendChild(buildEmptyState());
        return;
      }
      if (!before) {
        S.messages = msgs;
        messagesEl.innerHTML = '';
        msgs.forEach(function(m) { messagesEl.appendChild(buildMessageNode(m)); });
        scrollToBottom(messagesEl);
      } else {
        var oldScroll = messagesEl.scrollHeight;
        msgs.forEach(function(m) { messagesEl.insertBefore(buildMessageNode(m), messagesEl.firstChild); });
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

  // ===================== 渲染 AI 聊天页（独立 #aiChatRoot）=====================
  function renderAiRoot() {
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

    if (typeof window.switchDockTab === 'function') {
      try { window.switchDockTab('chat', true); } catch (e) {}
    }

    var listView = document.getElementById('dockChatListView');
    var detailView = document.getElementById('dockChatDetailView');
    var panelChat = document.getElementById('panelChat');
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');
    if (panelChat) panelChat.classList.add('ai-mode');
    if (detailView) detailView.classList.add('ai-mode');

    var r = renderAiRoot();
    if (detailView) detailView.appendChild(r.root);
    S.rootEl = r.root;

    S.conversationId = readConvId();

    try {
      var cfg = await ensureConfig();
      applyConfigToUI(cfg);
    } catch (e) {}

    await loadHistory(r.messagesEl, null);

    // 防御性 inline 隐藏
    try {
      var hdr = document.querySelector('#dockChatContainer .chat-header');
      if (hdr) hdr.style.display = 'none';
      var ina = document.querySelector('#dockChatDetailView .chat-input-area');
      if (ina) ina.style.display = 'none';
      var dcm = document.getElementById('dockChatMessages');
      if (dcm) dcm.style.display = 'none';
    } catch (e) {}

    if (typeof window.stopDMPolling === 'function') {
      try { window.stopDMPolling(); } catch (e) {}
    }

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

  // ===================== 关闭 AI 聊天（重写恢复顺序）=====================
  function closeAiChat() {
    if (!S.active) return;
    S.active = false;

    // 1. 移除 .ai-mode class
    var panelChat = document.getElementById('panelChat');
    var detailView = document.getElementById('dockChatDetailView');
    if (panelChat) panelChat.classList.remove('ai-mode');
    if (detailView) detailView.classList.remove('ai-mode');

    // 2. 删除 #aiChatRoot
    if (S.rootEl) { try { S.rootEl.remove(); } catch (e) {} S.rootEl = null; }

    // 3. 恢复 dock 元素显示（防御性 inline 恢复）
    try {
      var hdr = document.querySelector('#dockChatContainer .chat-header');
      if (hdr) hdr.style.display = '';
      var ina = document.querySelector('#dockChatDetailView .chat-input-area');
      if (ina) ina.style.display = '';
      var dcm = document.getElementById('dockChatMessages');
      if (dcm) dcm.style.display = '';
    } catch (e) {}

    // 4. 切回 list view（不调用未声明的变量）
    if (detailView) detailView.classList.add('hidden');
    var listView = document.getElementById('dockChatListView');
    if (listView) listView.classList.remove('hidden');

    // 5. 恢复 dock title
    var titleEl = document.getElementById('dockChatTitle');
    if (titleEl) titleEl.textContent = '消息';

    // 6. 触发列表刷新 + AI 入口
    //    ★ 不论 renderDockChatList 是否存在、是否抛错、是否异步，最终都要保证 AI 入口在
    //    ★ 统一走 scheduleInsertEntry（防抖），避免和 hook 重复插入
    try {
      if (typeof window.renderDockChatList === 'function') {
        var refreshResult = window.renderDockChatList();
        if (refreshResult && typeof refreshResult.then === 'function') {
          // 异步：hook 里 ret.finally 会调用 scheduleInsertEntry，这里不重复调
          // 但 Promise 失败时要兜底再排一次
          try { refreshResult.catch(function() { scheduleInsertEntry(); }); } catch (e) {
            scheduleInsertEntry();
          }
        }
        // 同步：hook 里已 scheduleInsertEntry，不重复
      } else {
        // 没有 renderDockChatList 时直接 schedule
        scheduleInsertEntry();
      }
    } catch (e) {
      // 兜底
      scheduleInsertEntry();
    }
  }

  // ===================== 全局清理 AI 入口（防重复）=====================
  // ★ 老版本错误地插到 #dockChatListView，必须全局清理 #panelChat 内所有 AI 入口
  //   避免新版本插入 #dockChatList 时老版本残留造成"两个小猫"
  function removeAllAiEntries() {
    try {
      var panel = document.getElementById('panelChat') || document.body || document;
      if (!panel || !panel.querySelectorAll) return;
      var olds = panel.querySelectorAll('[data-chat-user="__ai_agent__"], .ai-agent-entry');
      for (var i = 0; i < olds.length; i++) {
        try { olds[i].remove(); } catch (e) {}
      }
    } catch (e) {}
  }

  // ===================== 插入 AI 入口到聊天列表 =====================
  // ★ 关键修复：
  //   1. 容器只允许是 #dockChatList（删除 fallback 到 #dockChatListView 的逻辑）
  //   2. 每次插入前全局清理整个 #panelChat 内所有 AI 入口
  function insertEntry() {
    var list = document.getElementById('dockChatList');
    if (!list) return;

    // 全局清理：避免老版本残留造成"两个小猫"
    removeAllAiEntries();

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
    list.insertBefore(item, list.firstChild);
  }

  // ===================== 防抖：所有插入统一走 scheduleInsertEntry =====================
  var insertTimer = null;
  function scheduleInsertEntry() {
    if (insertTimer) {
      try { clearTimeout(insertTimer); } catch (e) {}
    }
    insertTimer = setTimeout(function() {
      insertTimer = null;
      try { insertEntry(); } catch (e) {}
    }, 0);
  }

  // ===================== 注入聊天列表 hook（兼容 Promise + 防抖）=====================
  function hookChatList() {
    if (S.bound) return;
    var original = window.renderDockChatList;
    window.renderDockChatList = function() {
      var ret;
      if (typeof original === 'function') {
        try { ret = original.apply(this, arguments); } catch (e) {}
      }
      // ★ 兼容异步：如果 ret 是 Promise，等 finally 再 scheduleInsertEntry
      if (ret && typeof ret.finally === 'function') {
        try {
          ret.finally(function() { scheduleInsertEntry(); });
        } catch (e) {
          scheduleInsertEntry();
        }
      } else {
        scheduleInsertEntry();
      }
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
      try { console.log('[DEBUG-AI] elementFromPoint(' + x + ', ' + y + ') =', el2); } catch (e) {}
      return el2;
    } catch (e) {}
  };

  // ===================== 暴露 API =====================
  window.__xtjAiAgent = {
    open: openAiChat,
    close: closeAiChat,
    insertEntry: insertEntry,
    getConfig: function() { return S.config; },
    getConversationId: function() { return S.conversationId; }
  };
  window.__xtjOpenAiChat = openAiChat;
  window.__xtjCloseAiChat = closeAiChat;

  // ===================== 启动 =====================
  function bootstrap() {
    ensureConfig().then(function(cfg) {
      S.config = cfg;
      scheduleInsertEntry();
    }).catch(function() {
      S.config = { name: '徐旭泽的小猫', avatar: '🐱', description: 'AI 智能体', welcome_message: '喵，来聊天吧。' };
      scheduleInsertEntry();
    });
    hookChatList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
