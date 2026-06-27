(function() {
  'use strict';

  var ROOT_API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
  ROOT_API_BASE = String(ROOT_API_BASE || '').replace(/\/$/, '');
  var API_BASE = ROOT_API_BASE + '/api/agent';
  try { console.warn('[AI] API_BASE =', API_BASE); } catch (e) {}

  var HISTORY_PAGE_SIZE = 30;
  var CONFIG_CACHE_TTL = 5 * 60 * 1000;
  var CONV_ID_KEY = 'xtj_ai_last_conversation_id';
  var THINKING_MODE_KEY = 'xtj_ai_thinking_mode';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  var USER_NAME_KEYS = ['xtj_user', 'xtj_username', 'xtj_user_name'];
  var PW_HASH_KEYS = ['xtj_pw_hash', 'xtj_password_hash'];
  var THINKING_LEVELS = [
    { value: 'off', label: '关', icon: '' },
    { value: 'low', label: '低', icon: '·' },
    { value: 'medium', label: '中', icon: '◌' },
    { value: 'high', label: '高', icon: '✦' }
  ];

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
      try { return localStorage.getItem(THINKING_MODE_KEY) || 'off'; }
      catch (e) { return 'off'; }
    })(),
    active: false,
    rootEl: null,
    messagesEl: null,
    inputBarEl: null,
    inputEl: null,
    sendBtnEl: null,
    bound: false,
    autoScrollPinned: true,
    viewportCleanup: null,
    thinkMenuController: null,
    keyboardResetTimer: null,
    avatarPopTimer: null,
    statusTimer: null,
    replyTimer: null
  };

  function getAiStatusText() {
    var hr = new Date().getHours();
    if (hr >= 5 && hr < 12) return '懒得理人但在线';
    if (hr >= 12 && hr < 18) return '盯着你';
    if (hr >= 18 && hr < 24) return '精神上班';
    return '阴间营业';
  }

  function updateAiStatus() {
    var el = document.getElementById('aiChatHeaderStatus');
    if (el) el.textContent = getAiStatusText();
  }

  function prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches); }
    catch (e) { return false; }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
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
          if (!c) return;
          node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
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
    } catch (e) {
      return '';
    }
  }

  function getAiRoot() {
    return S.rootEl || document.getElementById('aiChatRoot');
  }

  function updateRootVar(name, value) {
    var root = getAiRoot();
    if (root) root.style.setProperty(name, value);
  }

  function clearReplyTimer() {
    if (!S.replyTimer) return;
    try { clearTimeout(S.replyTimer); } catch (e) {}
    S.replyTimer = null;
  }

  function triggerAvatarPop() {
    var root = getAiRoot();
    if (!root) return;
    root.classList.remove('ai-avatar-pop');
    try { void root.offsetWidth; } catch (e) {}
    root.classList.add('ai-avatar-pop');
    if (S.avatarPopTimer) {
      try { clearTimeout(S.avatarPopTimer); } catch (e2) {}
    }
    S.avatarPopTimer = setTimeout(function() {
      var root2 = getAiRoot();
      if (root2) root2.classList.remove('ai-avatar-pop');
      S.avatarPopTimer = null;
    }, 240);
  }

  function setAiRootState(state) {
    var root = getAiRoot();
    if (!root) return;
    root.classList.remove('ai-idle', 'ai-thinking', 'ai-replying');
    root.classList.add(state || 'ai-idle');
    if (state === 'ai-replying') triggerAvatarPop();
  }

  function renderHeaderAvatar(target) {
    if (!target) return;
    target.innerHTML =
      '<span class="ai-cat-avatar" aria-hidden="true">' +
        '<span class="ai-cat-aura"></span>' +
        '<span class="ai-cat-ring"></span>' +
        '<svg class="ai-cat-svg" viewBox="0 0 72 72" focusable="false" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="aiCatFaceGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#fffaf2"></stop>' +
              '<stop offset="55%" stop-color="#f0f8ef"></stop>' +
              '<stop offset="100%" stop-color="#dff3ef"></stop>' +
            '</linearGradient>' +
          '</defs>' +
          '<path class="ai-cat-head" d="M21 23 L28 12 C29 10 31 9 33 10 L36 15 L39 10 C41 9 43 10 44 12 L51 23 C56 27 59 33 59 40 C59 52 49 61 36 61 C23 61 13 52 13 40 C13 33 16 27 21 23 Z"></path>' +
          '<path class="ai-cat-inner-ear" d="M27.8 21.4 L31.2 14.8 L34.2 22.2 Z"></path>' +
          '<path class="ai-cat-inner-ear" d="M44.2 21.4 L40.8 14.8 L37.8 22.2 Z"></path>' +
          '<path class="ai-cat-brow" d="M26.4 31.6 C28 30.4 29.6 30 31.2 30.4"></path>' +
          '<path class="ai-cat-brow" d="M40.8 30.4 C42.4 30 44 30.4 45.6 31.6"></path>' +
          '<ellipse class="ai-cat-eye" cx="29.6" cy="35.8" rx="2.2" ry="3.2"></ellipse>' +
          '<ellipse class="ai-cat-eye" cx="42.4" cy="35.8" rx="2.2" ry="3.2"></ellipse>' +
          '<path class="ai-cat-mouth" d="M33.8 41.6 C35.2 43.1 36.8 43.1 38.2 41.6"></path>' +
          '<path class="ai-cat-mouth" d="M36 39.2 L36 42.4"></path>' +
          '<path class="ai-cat-mouth" d="M28.6 43.8 C31.1 44.6 33 44.7 34.8 44.2"></path>' +
          '<path class="ai-cat-mouth" d="M43.4 43.8 C40.9 44.6 39 44.7 37.2 44.2"></path>' +
        '</svg>' +
      '</span>';
  }

  function readConvId() {
    try { return localStorage.getItem(CONV_ID_KEY) || null; }
    catch (e) { return null; }
  }

  function writeConvId(v) {
    try {
      if (v) localStorage.setItem(CONV_ID_KEY, v);
      else localStorage.removeItem(CONV_ID_KEY);
    } catch (e) {}
  }

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
        var sv = sessionStorage.getItem(USER_NAME_KEYS[i]);
        if (sv) return sv;
      } catch (e2) {}
    }
    return '';
  }

  function readPwHash() {
    for (var i = 0; i < PW_HASH_KEYS.length; i++) {
      try {
        var sv = sessionStorage.getItem(PW_HASH_KEYS[i]);
        if (sv) return sv;
      } catch (e) {}
      try {
        var lv = localStorage.getItem(PW_HASH_KEYS[i]);
        if (lv) return lv;
      } catch (e2) {}
    }
    return '';
  }

  function diagCollectContext() {
    return {
      apiBase: API_BASE,
      locationOrigin: typeof location !== 'undefined' ? location.origin : '',
      hasXtjConfig: !!window.XTJ_CONFIG,
      xtjConfigApiBase: window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE,
      hasCurrentUser: !!window.currentUser,
      currentUserName: readUserName() || null,
      hasPwHash: !!readPwHash(),
      hasUserToken: !!(function() {
        try { return sessionStorage.getItem('xtj_user_token') || localStorage.getItem('xtj_user_token'); }
        catch (e) { return ''; }
      })(),
      hasEnsureUserToken: typeof window.ensureUserToken === 'function',
      hasRefreshUserToken: typeof window.refreshUserToken === 'function',
      hasClearUserToken: typeof window.clearUserToken === 'function',
      scriptSrc: (function() {
        try {
          var ss = document.getElementsByTagName('script');
          for (var i = 0; i < ss.length; i++) {
            var src = ss[i].getAttribute('src') || '';
            if (src.indexOf('ai-agent.js') >= 0) return src;
          }
        } catch (e) {}
        return null;
      })()
    };
  }

  function diagPrintContext(label) {
    try {
      var ctx = diagCollectContext();
      console.warn('[AI-DIAG' + (label ? '/' + label : '') + ']', ctx);
      return ctx;
    } catch (e) {
      return null;
    }
  }

  async function diagRun(label) {
    try {
      var ctx = diagPrintContext(label);
      if (!ctx) return null;
      console.warn('[AI-DIAG] test /api/agent/config ...');
      var r = await sendOnce('GET', '/config', null, { forceNoToken: false });
      console.warn('[AI-DIAG] /config result', { status: r && r.status, ok: r && r.ok, url: r && r.url });
      return ctx;
    } catch (e) {
      return null;
    }
  }

  window.__xtjAiAuthDiag = function() {
    return diagRun('manual');
  };

  function clearAiUserToken() {
    try { if (typeof window.clearUserToken === 'function') window.clearUserToken(); } catch (e) {}
    try { localStorage.removeItem('xtj_user_token'); } catch (e2) {}
    try { sessionStorage.removeItem('xtj_user_token'); } catch (e3) {}
    try { localStorage.removeItem('xtj_user_token_ts'); } catch (e4) {}
  }

  function hasLocalPasswordHash() {
    return !!(readUserName() && readPwHash());
  }

  async function getUserAuthPayload(options) {
    options = options || {};
    var forceNoToken = !!options.forceNoToken;
    var token = '';
    if (!forceNoToken) {
      try {
        if (typeof window.ensureUserToken === 'function') token = await window.ensureUserToken();
      } catch (e) {
        token = '';
      }
    }
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

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

  async function sendOnce(method, path, body, options) {
    options = options || {};
    var url = API_BASE + path;
    try {
      var auth = await getUserAuthPayload({ forceNoToken: !!options.forceNoToken });
      var headers = auth.headers;
      var opts = { method: method, headers: headers };

      if (method === 'GET') {
        var extra = [];
        for (var qk in auth.query) {
          if (Object.prototype.hasOwnProperty.call(auth.query, qk) && auth.query[qk] !== undefined && auth.query[qk] !== null) {
            extra.push(encodeURIComponent(qk) + '=' + encodeURIComponent(auth.query[qk]));
          }
        }
        if (extra.length) url += (path.indexOf('?') >= 0 ? '&' : '?') + extra.join('&');
      } else {
        var merged = {};
        var src = body || {};
        for (var bk in src) {
          if (Object.prototype.hasOwnProperty.call(src, bk)) merged[bk] = src[bk];
        }
        for (var ak in auth.body) {
          if (Object.prototype.hasOwnProperty.call(auth.body, ak) && merged[ak] === undefined) merged[ak] = auth.body[ak];
        }
        if (Object.keys(merged).length) opts.body = JSON.stringify(merged);
      }

      var resp = await fetch(url, opts);
      var rawText = '';
      try { rawText = await resp.text(); } catch (e2) {}
      var data = null;
      if (rawText) {
        try { data = JSON.parse(rawText); } catch (e3) {}
      }
      if (!resp.ok && !options.retry) {
        try { console.warn('[AI] request failed', { method: method, url: url, status: resp.status, data: data }); } catch (e4) {}
      }
      return {
        ok: resp.ok,
        status: resp.status,
        data: data,
        error: data && data.error ? data.error : null,
        url: url,
        rawText: rawText ? String(rawText).slice(0, 300) : ''
      };
    } catch (e) {
      var errMsg = (e && e.message) || '网络异常';
      try { console.warn('[AI] request exception', { method: method, url: url, error: errMsg }); } catch (e5) {}
      return { ok: false, status: 0, data: null, error: errMsg, url: url, rawText: '' };
    }
  }

  async function apiRequest(method, path, body) {
    try { console.warn('[AI] apiRequest start', { method: method, path: path, apiBase: API_BASE }); } catch (e) {}
    var first = await sendOnce(method, path, body, { forceNoToken: false });
    try { console.warn('[AI] first response', { method: method, path: path, status: first && first.status, ok: first && first.ok, url: first && first.url }); } catch (e2) {}
    if (first && (first.status === 401 || first.status === 403)) {
      var hasPw = hasLocalPasswordHash();
      try { console.warn('[AI] auth failed, hasLocalPasswordHash =', hasPw); } catch (e3) {}
      if (hasPw) {
        clearAiUserToken();
        var second = await sendOnce(method, path, body, { forceNoToken: true, retry: true });
        try { console.warn('[AI] retry result (pw_hash)', { status: second && second.status, ok: second && second.ok, url: second && second.url }); } catch (e4) {}
        return second;
      }
      if (typeof window.refreshUserToken === 'function') {
        try {
          var refreshed = await window.refreshUserToken(true);
          if (refreshed) {
            var third = await sendOnce(method, path, body, { forceNoToken: false, retry: true });
            try { console.warn('[AI] retry result (refreshed token)', { status: third && third.status, ok: third && third.ok, url: third && third.url }); } catch (e5) {}
            return third;
          }
        } catch (e6) {}
      }
    }
    return first;
  }

  function describeError(r, fallback) {
    if (!r) return fallback || '请求失败';
    if (r.status === 401 || r.status === 403) {
      var hasPw = false;
      var hasTok = false;
      try { hasPw = !!(sessionStorage.getItem('xtj_pw_hash') || localStorage.getItem('xtj_pw_hash')); } catch (e) {}
      try { hasTok = !!(sessionStorage.getItem('xtj_user_token') || localStorage.getItem('xtj_user_token')); } catch (e2) {}
      if (!hasPw && !hasTok && window.currentUser && typeof window.refreshUserToken === 'function') {
        try { window.refreshUserToken(true).catch(function() {}); } catch (e3) {}
      }
      return '凭据异常，请重新登录后再使用 AI 聊天';
    }
    if (r.status === 404) return 'AI 接口不存在，请检查 API_BASE 或部署域名';
    if (r.status === 405) return 'AI 接口方法不允许，请检查 API_BASE 或部署域名';
    if (r.status === 429) return 'AI 聊天次数已达上限，请稍后再试';
    if (r.status === 502) return 'AI 服务调用失败，请检查配置或服务日志';
    if (r.status === 500) return '服务端错误，请稍后再试';
    if (r.status === 0) return '网络异常，请检查连接';
    if (r.error) return r.error;
    return fallback || '请求失败';
  }

  async function ensureConfig() {
    var now = Date.now();
    if (S.config && now - S.configFetchedAt < CONFIG_CACHE_TTL) return S.config;
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

  function buildUsageLine(usage) {
    if (!usage || typeof usage !== 'object') return null;
    var parts = [];
    if (usage.prompt_tokens) parts.push('输入 ' + usage.prompt_tokens);
    if (usage.completion_tokens) parts.push('输出 ' + usage.completion_tokens);
    if (typeof usage.prompt_cache_hit_tokens === 'number' && usage.prompt_cache_hit_tokens > 0) parts.push('命中 ' + usage.prompt_cache_hit_tokens);
    if (typeof usage.prompt_cache_miss_tokens === 'number' && usage.prompt_cache_miss_tokens > 0) parts.push('未命中 ' + usage.prompt_cache_miss_tokens);
    if (typeof usage.cost === 'number' && usage.cost > 0) parts.push('¥' + usage.cost.toFixed(6) + ' ' + (usage.currency || 'CNY'));
    if (usage.thinking_mode && usage.thinking_mode !== 'off') parts.push('思考 ' + usage.thinking_mode);
    if (usage.model) parts.push(usage.model);
    return parts.length ? parts.join(' · ') : null;
  }

  function getMessageThinkingMode(msg) {
    if (!msg) return 'off';
    if (msg.usage && msg.usage.thinking_mode) return msg.usage.thinking_mode;
    if (msg.thinking_mode) return msg.thinking_mode;
    return msg.reasoning ? 'medium' : 'off';
  }

  function shouldRenderReasoning(msg) {
    return !!(msg && msg.reasoning && getMessageThinkingMode(msg) !== 'off');
  }

  function isNearBottom(container, threshold) {
    if (!container) return true;
    var gap = Math.max(24, threshold || 72);
    return container.scrollHeight - container.scrollTop - container.clientHeight <= gap;
  }

  function scrollToBottom(container, force) {
    if (!container) return;
    if (!force && !S.autoScrollPinned) return;
    try {
      requestAnimationFrame(function() {
        try { container.scrollTop = container.scrollHeight; } catch (e) {}
      });
    } catch (e2) {
      try { container.scrollTop = container.scrollHeight; } catch (e3) {}
    }
  }

  function updateInputMetrics() {
    var root = getAiRoot();
    var bar = S.inputBarEl;
    if (!root || !bar) return;
    root.style.setProperty('--ai-input-height', Math.max(64, bar.offsetHeight || 0) + 'px');
  }

  function maybeRestoreEmptyState(messagesEl) {
    if (!messagesEl) return;
    if (messagesEl.querySelector('.ai-msg')) return;
    if (messagesEl.querySelector('.ai-chat-empty')) return;
    messagesEl.innerHTML = '';
    messagesEl.appendChild(buildEmptyState());
  }

  function setThinkingExpanded(container, expanded, messagesEl) {
    if (!container) return;
    var toggle = container.querySelector('.ai-thinking-toggle');
    var panel = container.querySelector('.ai-thinking-panel');
    var caret = container.querySelector('.ai-thinking-caret');
    if (!toggle || !panel || !caret) return;
    container.classList.toggle('expanded', !!expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    caret.textContent = expanded ? '收起' : '展开';
    if (expanded) {
      panel.style.maxHeight = panel.scrollHeight + 'px';
      panel.style.opacity = '1';
      if (messagesEl) scrollToBottom(messagesEl, false);
    } else {
      panel.style.maxHeight = '0px';
      panel.style.opacity = '0';
    }
  }

  function buildReasoningNode(reasoning, messagesEl) {
    var container = el('div', { class: 'ai-thinking' });
    var toggle = el('button', {
      type: 'button',
      class: 'ai-thinking-toggle',
      'aria-expanded': 'false'
    });
    var label = el('span', { class: 'ai-thinking-label' });
    label.appendChild(el('span', { class: 'ai-thinking-icon', text: '✦' }));
    label.appendChild(el('span', { text: '思考过程' }));
    toggle.appendChild(label);
    toggle.appendChild(el('span', { class: 'ai-thinking-caret', text: '展开' }));

    var panel = el('div', { class: 'ai-thinking-panel' });
    panel.style.maxHeight = '0px';
    panel.style.opacity = '0';
    panel.appendChild(el('div', { class: 'ai-thinking-body', text: reasoning }));

    toggle.addEventListener('click', function() {
      setThinkingExpanded(container, !container.classList.contains('expanded'), messagesEl || S.messagesEl);
    });

    container.appendChild(toggle);
    container.appendChild(panel);
    return container;
  }

  function buildMessageNode(msg, messagesEl) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    var node = el('div', { class: 'ai-msg ' + role + ' entering' });
    if (role === 'assistant' && shouldRenderReasoning(msg)) {
      node.appendChild(buildReasoningNode(msg.reasoning, messagesEl));
    }
    node.appendChild(el('div', { class: 'ai-msg-bubble', text: msg.content || '' }));
    if (role === 'assistant' && msg.usage) {
      var line = buildUsageLine(msg.usage);
      if (line) node.appendChild(el('div', { class: 'ai-msg-usage', text: line }));
    }
    if (msg.created_at) node.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
    return node;
  }

  function buildTypingNode() {
    var node = el('div', { class: 'ai-msg assistant typing entering' });
    var bubble = el('div', { class: 'ai-msg-bubble' });
    for (var i = 0; i < 3; i++) bubble.appendChild(el('span'));
    node.appendChild(bubble);
    return node;
  }

  function buildEmptyState(tipText) {
    var cfg = S.config || {};
    var empty = el('div', { class: 'ai-chat-empty' });
    empty.appendChild(el('div', { class: 'ai-chat-empty-emoji', text: cfg.avatar || '😼' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和 ' + (cfg.name || '徐旭泽的小猫') + ' 聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: tipText || (cfg.welcome_message || '喵，来聊天吧。') }));
    return empty;
  }

  function appendMessage(messagesEl, msg) {
    if (!messagesEl) return null;
    var empty = messagesEl.querySelector('.ai-chat-empty');
    if (empty) {
      try { empty.remove(); } catch (e) {}
    }
    var node = buildMessageNode(msg, messagesEl);
    messagesEl.appendChild(node);
    return node;
  }

  function removeLastUserMessage(messagesEl) {
    if (!messagesEl) return;
    var nodes = messagesEl.querySelectorAll('.ai-msg.user');
    if (nodes && nodes.length) {
      try { nodes[nodes.length - 1].remove(); } catch (e) {}
    }
    maybeRestoreEmptyState(messagesEl);
  }

  function buildLongReplySegments(text) {
    var normalized = String(text || '').replace(/\r\n/g, '\n');
    var blocks = normalized.split(/\n{2,}/);
    var segments = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block) continue;
      if (segments.length) segments.push('\n\n');
      if (block.length <= 180) {
        segments.push(block);
        continue;
      }
      var parts = block.match(/[^。！？!?；;\n]+[。！？!?；;]?\s*/g) || [block];
      var buf = '';
      for (var j = 0; j < parts.length; j++) {
        var next = parts[j];
        if (buf && (buf + next).length > 150) {
          segments.push(buf);
          buf = next;
        } else {
          buf += next;
        }
      }
      if (buf) segments.push(buf);
    }
    return segments.length ? segments : [normalized];
  }

  function finalizeAssistantNode(aiNode, aiBubble, payload, messagesEl) {
    aiNode.classList.remove('generating');
    aiBubble.classList.remove('ai-typing');
    if (payload.usage) {
      var usageLine = buildUsageLine(payload.usage);
      if (usageLine) aiNode.appendChild(el('div', { class: 'ai-msg-usage', text: usageLine }));
    }
    if (payload.created_at) aiNode.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(payload.created_at) }));
    setAiRootState('ai-idle');
    scrollToBottom(messagesEl, false);
    clearReplyTimer();
  }

  function startAssistantReply(aiNode, aiBubble, fullText, payload, messagesEl) {
    clearReplyTimer();
    setAiRootState('ai-replying');
    aiNode.classList.add('generating');
    aiBubble.classList.add('ai-typing');

    if (prefersReducedMotion()) {
      aiBubble.textContent = fullText;
      finalizeAssistantNode(aiNode, aiBubble, payload, messagesEl);
      return;
    }

    if (fullText.length > 800) {
      var segments = buildLongReplySegments(fullText);
      var index = 0;
      var rendered = '';
      (function renderSegment() {
        rendered += segments[index] || '';
        aiBubble.textContent = rendered;
        scrollToBottom(messagesEl, false);
        index += 1;
        if (index >= segments.length) {
          finalizeAssistantNode(aiNode, aiBubble, payload, messagesEl);
          return;
        }
        S.replyTimer = setTimeout(renderSegment, 8);
      })();
      return;
    }

    var charsPerTick = fullText.length > 360 ? 10 : 5;
    var pos = 0;
    (function typeTick() {
      pos = Math.min(fullText.length, pos + charsPerTick);
      aiBubble.textContent = fullText.slice(0, pos);
      scrollToBottom(messagesEl, false);
      if (pos >= fullText.length) {
        finalizeAssistantNode(aiNode, aiBubble, payload, messagesEl);
        return;
      }
      S.replyTimer = setTimeout(typeTick, 8);
    })();
  }

  function getOverflowClipRect(node) {
    var current = node && node.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      var style = window.getComputedStyle(current);
      var ox = style.overflowX;
      var oy = style.overflowY;
      if ((ox && ox !== 'visible') || (oy && oy !== 'visible')) {
        return current.getBoundingClientRect();
      }
      current = current.parentElement;
    }
    return null;
  }

  function menuNeedsFixed(menu, wrap) {
    if (!menu || !wrap) return false;
    var rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8 || rect.right > window.innerWidth - 8 || rect.left < 8 || rect.top < 0) return true;
    var clipRect = getOverflowClipRect(wrap);
    if (!clipRect) return false;
    return rect.bottom > clipRect.bottom - 4 || rect.top < clipRect.top + 4 || rect.right > clipRect.right - 4 || rect.left < clipRect.left + 4;
  }

  function createThinkMenuController(thinkWrap, thinkBtn, thinkMenu) {
    var cleanup = null;

    function detachObservers() {
      if (!cleanup) return;
      try { cleanup(); } catch (e) {}
      cleanup = null;
    }

    function positionThinkMenu() {
      if (!thinkMenu.classList.contains('open')) return;
      thinkMenu.classList.remove('is-fixed');
      thinkMenu.style.left = '';
      thinkMenu.style.top = '';
      thinkMenu.style.minWidth = '';
      if (!menuNeedsFixed(thinkMenu, thinkWrap)) return;
      var btnRect = thinkBtn.getBoundingClientRect();
      var menuRect = thinkMenu.getBoundingClientRect();
      var width = Math.max(132, btnRect.width, menuRect.width);
      var left = Math.min(window.innerWidth - width - 12, Math.max(12, btnRect.right - width));
      thinkMenu.classList.add('is-fixed');
      thinkMenu.style.left = Math.round(left) + 'px';
      thinkMenu.style.top = Math.round(btnRect.bottom + 6) + 'px';
      thinkMenu.style.minWidth = Math.round(Math.max(btnRect.width, 132)) + 'px';
    }

    function closeThinkMenu() {
      thinkMenu.classList.remove('open', 'is-fixed');
      thinkBtn.classList.remove('menu-open');
      thinkMenu.style.left = '';
      thinkMenu.style.top = '';
      thinkMenu.style.minWidth = '';
      detachObservers();
    }

    function openThinkMenu() {
      thinkMenu.classList.add('open');
      thinkBtn.classList.add('menu-open');
      positionThinkMenu();
      var onPointerDown = function(ev) {
        if (!thinkWrap.contains(ev.target)) closeThinkMenu();
      };
      var onKeyDown = function(ev) {
        if (ev.key === 'Escape') closeThinkMenu();
      };
      var onWindowChange = function() {
        positionThinkMenu();
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('resize', onWindowChange, true);
      window.addEventListener('scroll', onWindowChange, true);
      var vv = window.visualViewport;
      if (vv) {
        vv.addEventListener('resize', onWindowChange);
        vv.addEventListener('scroll', onWindowChange);
      }
      cleanup = function() {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onWindowChange, true);
        window.removeEventListener('scroll', onWindowChange, true);
        if (vv) {
          vv.removeEventListener('resize', onWindowChange);
          vv.removeEventListener('scroll', onWindowChange);
        }
      };
    }

    function toggleThinkMenu() {
      if (thinkMenu.classList.contains('open')) closeThinkMenu();
      else openThinkMenu();
    }

    thinkBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleThinkMenu();
    });

    return {
      open: openThinkMenu,
      close: closeThinkMenu,
      toggle: toggleThinkMenu,
      reposition: positionThinkMenu
    };
  }

  function bindVisualViewport(messagesEl, input) {
    var root = getAiRoot();
    if (!root) return function() {};

    function applyViewport() {
      if (!S.active) return;
      var vv = window.visualViewport;
      var keyboardHeight = 0;
      var viewportHeight = null;
      if (vv) {
        keyboardHeight = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        viewportHeight = Math.max(280, Math.round(vv.height));
      }
      updateRootVar('--ai-keyboard-offset', keyboardHeight + 'px');
      updateRootVar('--ai-viewport-height', viewportHeight ? viewportHeight + 'px' : '100%');
      root.classList.toggle('ai-keyboard-open', keyboardHeight > 0);
      updateInputMetrics();
      if (keyboardHeight > 0 && isNearBottom(messagesEl, 120)) {
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
      }
    }

    function resetViewport() {
      var root2 = getAiRoot();
      if (!root2) return;
      updateRootVar('--ai-keyboard-offset', '0px');
      updateRootVar('--ai-viewport-height', '100%');
      root2.classList.remove('ai-keyboard-open');
      updateInputMetrics();
      if (isNearBottom(messagesEl, 120)) {
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
      }
    }

    var onViewportChange = function() { applyViewport(); };
    var onBlur = function() {
      if (S.keyboardResetTimer) {
        try { clearTimeout(S.keyboardResetTimer); } catch (e) {}
      }
      S.keyboardResetTimer = setTimeout(function() {
        S.keyboardResetTimer = null;
        resetViewport();
      }, 150);
    };
    var onFocus = function() {
      applyViewport();
    };

    var vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', onViewportChange);
      vv.addEventListener('scroll', onViewportChange);
    }
    window.addEventListener('resize', onViewportChange);
    input.addEventListener('blur', onBlur);
    input.addEventListener('focus', onFocus);
    applyViewport();

    return function() {
      if (S.keyboardResetTimer) {
        try { clearTimeout(S.keyboardResetTimer); } catch (e2) {}
        S.keyboardResetTimer = null;
      }
      if (vv) {
        vv.removeEventListener('resize', onViewportChange);
        vv.removeEventListener('scroll', onViewportChange);
      }
      window.removeEventListener('resize', onViewportChange);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('focus', onFocus);
    };
  }

  async function ensureUserAuthOrNotify() {
    if (typeof window.ensureRealUserAuth !== 'function') return true;
    try {
      var auth = await window.ensureRealUserAuth();
      if (auth && auth.ok) return true;
      var reason = auth && auth.reason;
      if (reason === 'missing_auth_credentials' || reason === 'refresh_failed') {
        notify('鉴权凭据缺失，请退出后重新登录再使用 AI 聊天');
        return false;
      }
      if (reason === 'no_user') {
        notify('请先登录后再使用 AI 聊天');
        return false;
      }
    } catch (e) {}
    return true;
  }

  async function handleSendMessage(input, sendBtn, messagesEl) {
    if (S.sending) return;
    var text = String(input.value || '').trim();
    if (!text) return;

    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) return;

    S.sending = true;
    clearReplyTimer();
    setAiRootState('ai-thinking');
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中…';
    var oldPlaceholder = input.placeholder;
    input.disabled = true;

    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: text, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);
    S.autoScrollPinned = true;
    scrollToBottom(messagesEl, true);

    var typingNode = buildTypingNode();
    messagesEl.appendChild(typingNode);
    scrollToBottom(messagesEl, true);

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
        reasoning: d.reasoning || '',
        created_at: d.created_at || new Date().toISOString(),
        thinking_mode: d.thinking_mode || 'off',
        usage: Object.assign({}, d.usage || {}, {
          model: d.model || '',
          thinking_mode: d.thinking_mode || 'off'
        })
      };
      S.messages.push(aiMsg);

      var aiNode = el('div', { class: 'ai-msg assistant entering generating' });
      if (shouldRenderReasoning(aiMsg)) aiNode.appendChild(buildReasoningNode(aiMsg.reasoning, messagesEl));
      var aiBubble = el('div', { class: 'ai-msg-bubble ai-typing', text: '' });
      aiNode.appendChild(aiBubble);
      messagesEl.appendChild(aiNode);
      S.autoScrollPinned = true;
      scrollToBottom(messagesEl, true);
      startAssistantReply(aiNode, aiBubble, d.reply, aiMsg, messagesEl);
    } else {
      S.messages.pop();
      removeLastUserMessage(messagesEl);
      setAiRootState('ai-idle');
      notify(describeError(r, 'AI 暂时没有回应，请稍后再试'));
    }

    S.sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
    input.disabled = false;
    input.value = '';
    input.style.height = 'auto';
    input.placeholder = oldPlaceholder;
    updateInputMetrics();
    try { input.focus(); } catch (e2) {}
  }

  async function loadHistory(messagesEl, before) {
    if (S.loading || S.loadingMore) return;
    if (before) S.loadingMore = true;
    else S.loading = true;

    try {
      var qs = '?limit=' + HISTORY_PAGE_SIZE;
      if (S.conversationId) qs += '&conversation_id=' + encodeURIComponent(S.conversationId);
      if (before) qs += '&before=' + encodeURIComponent(before);
      var r = await apiRequest('GET', '/chat/history' + qs);

      if (!r.ok || !r.data) {
        if (!before) {
          try { console.warn('[AI] loadHistory failed:', r.status, r.error); } catch (e) {}
          if (messagesEl.children.length === 0) {
            messagesEl.innerHTML = '';
            messagesEl.appendChild(buildEmptyState('聊天历史加载失败（' + (r.status || '?') + '），但你仍可发送新消息'));
          } else {
            messagesEl.appendChild(el('div', {
              class: 'ai-msg-warn',
              text: '聊天历史加载失败（' + (r.status || '?') + '），但你仍可发送新消息'
            }));
          }
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
        msgs.forEach(function(m) { messagesEl.appendChild(buildMessageNode(m, messagesEl)); });
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
      } else {
        var oldScroll = messagesEl.scrollHeight;
        msgs.forEach(function(m) { messagesEl.insertBefore(buildMessageNode(m, messagesEl), messagesEl.firstChild); });
        try {
          requestAnimationFrame(function() {
            messagesEl.scrollTop = messagesEl.scrollHeight - oldScroll;
          });
        } catch (e2) {}
      }
    } finally {
      S.loading = false;
      S.loadingMore = false;
    }
  }

  function renderAiRoot() {
    var old = document.getElementById('aiChatRoot');
    if (old) {
      try { old.remove(); } catch (e) {}
    }

    var root = el('div', { id: 'aiChatRoot', class: 'ai-chat-root ai-idle' });

    var header = el('div', { class: 'ai-chat-header' });
    var backBtn = el('button', { type: 'button', class: 'ai-chat-back', 'aria-label': '返回', text: '‹' });
    backBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeAiChat();
    });
    header.appendChild(backBtn);

    var avatarEl = el('div', { class: 'ai-chat-header-avatar', id: 'aiChatHeaderAvatar' });
    renderHeaderAvatar(avatarEl);
    header.appendChild(avatarEl);

    var info = el('div', { class: 'ai-chat-header-info' });
    info.appendChild(el('div', { class: 'ai-chat-header-name', id: 'aiChatHeaderName', text: '徐旭泽的小猫' }));
    info.appendChild(el('div', { class: 'ai-chat-header-status', id: 'aiChatHeaderStatus', text: getAiStatusText() }));
    header.appendChild(info);

    function getLevelMeta(v) {
      for (var i = 0; i < THINKING_LEVELS.length; i++) {
        if (THINKING_LEVELS[i].value === v) return THINKING_LEVELS[i];
      }
      return THINKING_LEVELS[0];
    }

    var thinkWrap = el('div', { class: 'ai-chat-think-wrap' });
    var curLvl = getLevelMeta(S.thinkingMode);
    var thinkBtn = el('button', {
      type: 'button',
      class: 'ai-chat-think-btn' + (S.thinkingMode !== 'off' ? ' active' : ''),
      'aria-label': '思考模式',
      title: '思考模式：' + curLvl.label
    }, '思考 ' + curLvl.label);
    var thinkMenu = el('div', { class: 'ai-chat-think-menu' });
    THINKING_LEVELS.forEach(function(level) {
      var opt = el('button', {
        type: 'button',
        class: 'ai-chat-think-opt' + (level.value === S.thinkingMode ? ' selected' : ''),
        'data-value': level.value
      }, level.label);
      opt.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        S.thinkingMode = level.value;
        try { localStorage.setItem(THINKING_MODE_KEY, level.value); } catch (e) {}
        thinkBtn.textContent = '思考 ' + level.label;
        thinkBtn.title = '思考模式：' + level.label;
        thinkBtn.classList.toggle('active', level.value !== 'off');
        var opts = thinkMenu.querySelectorAll('.ai-chat-think-opt');
        for (var i = 0; i < opts.length; i++) {
          opts[i].classList.toggle('selected', opts[i].getAttribute('data-value') === level.value);
        }
        if (S.thinkMenuController) S.thinkMenuController.close();
      });
      thinkMenu.appendChild(opt);
    });
    thinkWrap.appendChild(thinkBtn);
    thinkWrap.appendChild(thinkMenu);
    header.appendChild(thinkWrap);

    var newBtn = el('button', {
      type: 'button',
      class: 'ai-chat-new-btn',
      'aria-label': '新对话',
      title: '开始新对话（不删除历史）'
    }, '新对话');
    newBtn.addEventListener('click', async function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
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
          if (S.messagesEl) {
            S.messagesEl.innerHTML = '';
            S.messagesEl.appendChild(buildEmptyState());
          }
          setAiRootState('ai-idle');
          notify('已开始新对话，旧对话仍保留在历史中');
        } else {
          notify(describeError(r, '创建新对话失败'));
        }
      } finally {
        newBtn.disabled = false;
      }
    });
    header.appendChild(newBtn);
    root.appendChild(header);

    var messagesEl = el('div', { class: 'ai-chat-messages', id: 'aiChatMessagesArea' });
    messagesEl.addEventListener('scroll', function() {
      S.autoScrollPinned = isNearBottom(messagesEl, 84);
      if (messagesEl.scrollTop < 60 && S.hasMore && !S.loading && !S.loadingMore && S.oldestCursor) {
        loadHistory(messagesEl, S.oldestCursor);
      }
    });
    root.appendChild(messagesEl);

    var inputBar = el('div', { class: 'ai-chat-input-bar' });
    var input = el('textarea', {
      class: 'ai-chat-input',
      id: 'aiChatMsgInput',
      placeholder: '和徐旭泽的小猫说点什么吧…',
      rows: '1',
      'aria-label': '聊天输入框',
      autocapitalize: 'sentences',
      autocorrect: 'on',
      spellcheck: 'true'
    });
    var sendBtn = el('button', {
      type: 'button',
      class: 'ai-chat-send',
      id: 'aiChatSendBtn',
      'aria-label': '发送'
    }, '发送');

    function autoresize() {
      try {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      } catch (e) {}
      updateInputMetrics();
    }

    function doSend() {
      handleSendMessage(input, sendBtn, messagesEl);
    }

    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    input.addEventListener('input', autoresize);

    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    root.appendChild(inputBar);

    S.thinkMenuController = createThinkMenuController(thinkWrap, thinkBtn, thinkMenu);
    setTimeout(autoresize, 0);

    return {
      root: root,
      messagesEl: messagesEl,
      inputBar: inputBar,
      input: input,
      sendBtn: sendBtn
    };
  }

  async function openAiChat() {
    if (S.active) return;
    if (!window.currentUser) {
      notify('请先登录后再和徐旭泽的小猫聊天');
      return;
    }
    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) return;

    S.active = true;
    S.autoScrollPinned = true;

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
    S.messagesEl = r.messagesEl;
    S.inputBarEl = r.inputBar;
    S.inputEl = r.input;
    S.sendBtnEl = r.sendBtn;
    updateInputMetrics();
    setAiRootState('ai-idle');

    if (S.statusTimer) {
      try { clearInterval(S.statusTimer); } catch (e2) {}
    }
    S.statusTimer = setInterval(updateAiStatus, 60000);

    if (S.viewportCleanup) {
      try { S.viewportCleanup(); } catch (e3) {}
    }
    S.viewportCleanup = bindVisualViewport(r.messagesEl, r.input);

    S.conversationId = readConvId();

    try {
      var cfg = await ensureConfig();
      applyConfigToUI(cfg);
    } catch (e4) {}

    await loadHistory(r.messagesEl, null);

    try {
      var hdr = document.querySelector('#dockChatContainer .chat-header');
      if (hdr) hdr.style.display = 'none';
      var ina = document.querySelector('#dockChatDetailView .chat-input-area');
      if (ina) ina.style.display = 'none';
      var dcm = document.getElementById('dockChatMessages');
      if (dcm) dcm.style.display = 'none';
    } catch (e5) {}

    if (typeof window.stopDMPolling === 'function') {
      try { window.stopDMPolling(); } catch (e6) {}
    }

    setTimeout(function() {
      try { r.input.focus(); } catch (e) {}
      updateInputMetrics();
    }, 80);
  }

  function applyConfigToUI(cfg) {
    if (!cfg) return;
    var avatarEl = document.getElementById('aiChatHeaderAvatar');
    var nameEl = document.getElementById('aiChatHeaderName');
    if (avatarEl) renderHeaderAvatar(avatarEl);
    if (nameEl) nameEl.textContent = cfg.name || '徐旭泽的小猫';
    updateAiStatus();

    var inp = document.getElementById('aiChatMsgInput');
    if (inp) inp.placeholder = '和' + (cfg.name || '徐旭泽的小猫') + '说点什么吧…';

    var empty = document.querySelector('#aiChatRoot .ai-chat-empty');
    if (empty) {
      var e1 = empty.querySelector('.ai-chat-empty-emoji');
      if (e1) e1.textContent = cfg.avatar || '😼';
      var e2 = empty.querySelector('.ai-chat-empty-title');
      if (e2) e2.textContent = '和 ' + (cfg.name || '徐旭泽的小猫') + ' 聊聊天';
      var e3 = empty.querySelector('.ai-chat-empty-tip');
      if (e3) e3.textContent = cfg.welcome_message || '喵，来聊天吧。';
    }
  }

  function closeAiChat() {
    if (!S.active) return;
    S.active = false;
    clearReplyTimer();
    if (S.thinkMenuController) {
      try { S.thinkMenuController.close(); } catch (e) {}
      S.thinkMenuController = null;
    }
    if (S.viewportCleanup) {
      try { S.viewportCleanup(); } catch (e2) {}
      S.viewportCleanup = null;
    }
    if (S.statusTimer) {
      try { clearInterval(S.statusTimer); } catch (e3) {}
      S.statusTimer = null;
    }
    if (S.keyboardResetTimer) {
      try { clearTimeout(S.keyboardResetTimer); } catch (e4) {}
      S.keyboardResetTimer = null;
    }
    if (S.avatarPopTimer) {
      try { clearTimeout(S.avatarPopTimer); } catch (e5) {}
      S.avatarPopTimer = null;
    }

    var panelChat = document.getElementById('panelChat');
    var detailView = document.getElementById('dockChatDetailView');
    if (panelChat) panelChat.classList.remove('ai-mode');
    if (detailView) detailView.classList.remove('ai-mode');

    if (S.rootEl) {
      try { S.rootEl.remove(); } catch (e6) {}
    }
    S.rootEl = null;
    S.messagesEl = null;
    S.inputBarEl = null;
    S.inputEl = null;
    S.sendBtnEl = null;

    try {
      var hdr = document.querySelector('#dockChatContainer .chat-header');
      if (hdr) hdr.style.display = '';
      var ina = document.querySelector('#dockChatDetailView .chat-input-area');
      if (ina) ina.style.display = '';
      var dcm = document.getElementById('dockChatMessages');
      if (dcm) dcm.style.display = '';
    } catch (e7) {}

    if (detailView) detailView.classList.add('hidden');
    var listView = document.getElementById('dockChatListView');
    if (listView) listView.classList.remove('hidden');

    var titleEl = document.getElementById('dockChatTitle');
    if (titleEl) titleEl.textContent = '消息';

    try {
      if (typeof window.renderDockChatList === 'function') {
        var refreshResult = window.renderDockChatList();
        if (refreshResult && typeof refreshResult.then === 'function') {
          try { refreshResult.catch(function() { scheduleInsertEntry(); }); } catch (e8) { scheduleInsertEntry(); }
        }
      } else {
        scheduleInsertEntry();
      }
    } catch (e9) {
      scheduleInsertEntry();
    }
  }

  function removeAllAiEntries() {
    try {
      var panel = document.getElementById('panelChat') || document.body || document;
      if (!panel || !panel.querySelectorAll) return;
      var olds = panel.querySelectorAll('[data-chat-user="__ai_agent__"], .ai-agent-entry');
      for (var i = 0; i < olds.length; i++) {
        try { olds[i].remove(); } catch (e) {}
      }
    } catch (e2) {}
  }

  function insertEntry() {
    var list = document.getElementById('dockChatList');
    if (!list) return;
    removeAllAiEntries();

    var cfg = S.config || { name: '徐旭泽的小猫', avatar: '🐱', description: 'AI 智能体' };
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
        notify('请先登录后再和 ' + name + ' 聊天');
        return;
      }
      openAiChat();
    }

    item.addEventListener('click', onActivate);
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });
    list.insertBefore(item, list.firstChild);
  }

  var insertTimer = null;
  function scheduleInsertEntry() {
    if (insertTimer) {
      try { clearTimeout(insertTimer); } catch (e) {}
    }
    insertTimer = setTimeout(function() {
      insertTimer = null;
      try { insertEntry(); } catch (e2) {}
    }, 0);
  }

  function hookChatList() {
    if (S.bound) return;
    var original = window.renderDockChatList;
    window.renderDockChatList = function() {
      var ret;
      if (typeof original === 'function') {
        try { ret = original.apply(this, arguments); } catch (e) {}
      }
      if (ret && typeof ret.finally === 'function') {
        try { ret.finally(function() { scheduleInsertEntry(); }); } catch (e2) { scheduleInsertEntry(); }
      } else {
        scheduleInsertEntry();
      }
      return ret;
    };
    S.bound = true;
  }

  window.__debugAiClick = function() {
    try {
      var x = window.innerWidth / 2;
      var y = window.innerHeight - 80;
      var node = document.elementFromPoint(x, y);
      try { console.log('[DEBUG-AI] elementFromPoint(' + x + ', ' + y + ') =', node); } catch (e) {}
      return node;
    } catch (e2) {
      return null;
    }
  };

  window.__xtjAiAgent = {
    open: openAiChat,
    close: closeAiChat,
    insertEntry: insertEntry,
    getConfig: function() { return S.config; },
    getConversationId: function() { return S.conversationId; }
  };
  window.__xtjOpenAiChat = openAiChat;
  window.__xtjCloseAiChat = closeAiChat;

  function bootstrap() {
    try { diagPrintContext('boot'); } catch (e) {}
    ensureConfig().then(function(cfg) {
      S.config = cfg;
      scheduleInsertEntry();
    }).catch(function() {
      S.config = {
        name: '徐旭泽的小猫',
        avatar: '🐱',
        description: 'AI 智能体',
        welcome_message: '喵，来聊天吧。'
      };
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
