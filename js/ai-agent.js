(function() {
  'use strict';

  var ROOT_API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
  ROOT_API_BASE = String(ROOT_API_BASE || '').replace(/\/$/, '');
  var API_BASE = ROOT_API_BASE + '/api/agent';
  try { console.warn('[AI] API_BASE =', API_BASE); } catch (e) {}

  var HISTORY_PAGE_SIZE = 30;
  var CONFIG_CACHE_TTL = 5 * 60 * 1000;
  var CONV_ID_KEY = 'xtj_ai_last_conversation_id';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  var USER_NAME_KEYS = ['xtj_user', 'xtj_username', 'xtj_user_name'];
  var PW_HASH_KEYS = ['xtj_pw_hash', 'xtj_password_hash'];
  var _isTouchMobile = typeof window !== 'undefined' && 'ontouchstart' in window && 'visualViewport' in window;
  var escapeHtml = window.escapeHtml || function(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

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
    // ★ M: thinking_mode 默认从 low 改成 max
    //   用户要求: 普通聊天默认就用 max 深度思考
    //   管理员可在后台 /admin/ai-agent/config 切换为 low/medium/high/max
    //   普通用户不能在 UI 切换 (allow_user_thinking_switch: false)
    thinkingMode: 'max',
    // ★ P 新增: 深度思考专用思考程度 (从后端 config 同步, 与普通聊天分开)
    deepThinkEffort: 'max',
    deepThinkEnabled: true,    // 后端 config.deep_think.enabled
    // ★ M: 深度思考模式 toggle 状态
    //   开启后本会话所有消息走 Planner→Workers→Synthesizer 多 agent 流程
    //   持久化到 localStorage, 重开对话框后恢复
    deepThink: false,
    deepThinkJob: null,         // AbortController for current deep think request
    deepThinkProgressCard: null, // DOM node for progress card
    active: false,
    rootEl: null,
    messagesEl: null,
    inputBarEl: null,
    inputEl: null,
    sendBtnEl: null,
    pauseBtnEl: null,
    bound: false,
    autoScrollPinned: true,
    viewportCleanup: null,
    thinkMenuController: null,
    keyboardResetTimer: null,
    avatarPopTimer: null,
    statusTimer: null,
    replyTimer: null,
    streamCleanup: null,
    abortController: null,
    clientRequestId: 0,
    currentStreamAborted: false,
    paused: false,
    activeRenderers: [],
    conversations: [],
    conversationsEl: null,
    showingHistory: false,
    headerButtonsCleanup: null
  };

  function getAiStatusText() {
    return '在线';
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

  function notify(msg, type, duration) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info', duration); return; }
      if (typeof window.showNotify === 'function') { window.showNotify(msg, type); return; }
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

  var _copyMenuActive = null;

  function closeCopyMenu() {
    if (_copyMenuActive) {
      try {
        if (_copyMenuActive.parentNode) _copyMenuActive.parentNode.removeChild(_copyMenuActive);
      } catch (e) {}
      _copyMenuActive = null;
    }
  }

  // 简单 Markdown → HTML 渲染
  function renderMarkdown(txt) {
    if (!txt) return '';
    var s = String(txt);
    // HTML 转义
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 代码块（先处理，避免内部 markdown 被二次转换）
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
      return '<pre><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>';
    });
    // 行内代码
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 粗体
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 链接 (阻止 javascript:/data:/vbscript: 等危险协议)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, label, href) {
      var safe = href.replace(/^javascript:/i, 'blocked:').replace(/^data:/i, 'blocked:').replace(/^vbscript:/i, 'blocked:');
      if (safe !== href) return '<span class="ai-blocked-link" title="已屏蔽危险链接">' + label + '</span>';
      return '<a href="' + safe + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    // 无序列表
    s = s.replace(/^- (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>\n?)+/g, function(m) { return '<ul>' + m + '</ul>'; });
    // 有序列表
    s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>\n?)+/g, function(m) { return '<ol>' + m + '</ol>'; });
    // 标题
    s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // 换行转 <br>
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function setupBubbleCopy(bubbleEl, containerEl) {
    if (!bubbleEl || !bubbleEl.parentNode) return;
    var _longPressTimer = null;
    var _longPressStarted = false;

    function getBubbleText() {
      return (bubbleEl.textContent || '').trim();
    }

    function showCopyMenu(ev) {
      if (_copyMenuActive) return;
      ev.preventDefault();
      ev.stopPropagation();
      var text = getBubbleText();
      if (!text) return;
      closeCopyMenu();
      var rect = bubbleEl.getBoundingClientRect();
      var menu = el('div', { class: 'ai-copy-menu' });
      var btn = el('button', {
        type: 'button',
        class: 'ai-copy-btn',
        text: '复制'
      });
      btn.addEventListener('mouseenter', function() { btn.style.background = 'rgba(46,148,101,0.06)'; });
      btn.addEventListener('mouseleave', function() { btn.style.background = ''; });
      btn.addEventListener('click', function(ce) {
        ce.preventDefault(); ce.stopPropagation();
        doCopy(text);
        closeCopyMenu();
      });
      menu.appendChild(btn);
      document.body.appendChild(menu);
      _copyMenuActive = menu;
      var menuRect = menu.getBoundingClientRect();
      var left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
      var top = rect.bottom + 4;
      if (top + menuRect.height > window.innerHeight) top = rect.top - menuRect.height - 4;
      menu.style.left = Math.max(8, left) + 'px';
      menu.style.top = Math.max(8, top) + 'px';
      setTimeout(function() {
        document.addEventListener('click', function onDoc(ce2) {
          if (!menu.contains(ce2.target) && ce2.target !== bubbleEl) {
            closeCopyMenu();
            document.removeEventListener('click', onDoc);
          }
        }, { once: true });
      }, 0);
    }

    function startLongPress(ev) {
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
        _longPressStarted = false;
        _longPressTimer = setTimeout(function() {
          _longPressStarted = true;
          showCopyMenu(ev);
        }, 500);
      }
    }

    function cancelLongPress(ev) {
      if (_longPressTimer) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
      }
      if (ev && ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
      if (_longPressStarted) {
        ev && ev.preventDefault();
        _longPressStarted = false;
      }
    }

    bubbleEl.addEventListener('pointerdown', startLongPress);
    bubbleEl.addEventListener('pointerup', cancelLongPress);
    bubbleEl.addEventListener('pointercancel', cancelLongPress);
    bubbleEl.addEventListener('pointermove', function(ev) {
      if (_longPressTimer && ev.pointerType === 'touch') {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
      }
    });
    bubbleEl.addEventListener('contextmenu', function(ev) {
      var text = getBubbleText();
      if (text) showCopyMenu(ev);
    });
  }

  function doCopy(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          try { notify('已复制'); } catch (e) {}
        }).catch(function() {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
    } catch (e) {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      try { notify('已复制'); } catch (e) {}
    } catch (e) {
      try { notify('复制失败，请手动选择文本'); } catch (e2) {}
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

  function clearStreamCleanup() {
    if (!S.streamCleanup) return;
    try { S.streamCleanup(); } catch (e) {}
    S.streamCleanup = null;
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

  function buildCatAvatarMarkup(extraClass) {
    return (
      '<span class="ai-cat-avatar' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true">' +
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
      '</span>'
    );
  }

  function renderHeaderAvatar(target, avatarUrl, avatarVersion) {
    if (!target) return;
    target.innerHTML = '';
    if (avatarUrl) {
      var wrapper = el('span', { class: 'ai-avatar-image-wrapper' });
      var img = el('img', { class: 'ai-avatar-image', alt: '', loading: 'lazy' });
      img.src = avatarUrl + (avatarVersion ? '?v=' + avatarVersion : '');
      img.addEventListener('error', function() {
        img.style.display = 'none';
        wrapper.innerHTML = buildCatAvatarMarkup('');
      });
      wrapper.appendChild(img);
      target.appendChild(wrapper);
    } else {
      target.innerHTML = buildCatAvatarMarkup('');
    }
  }

  function renderCatAvatarNode(target, extraClass, avatarUrl, avatarVersion) {
    if (!target) return;
    target.innerHTML = '';
    if (avatarUrl) {
      var wrapper = el('span', { class: 'ai-avatar-image-wrapper' });
      var img = el('img', { class: 'ai-avatar-image', alt: '', loading: 'lazy' });
      img.src = avatarUrl + (avatarVersion ? '?v=' + avatarVersion : '');
      img.addEventListener('error', function() {
        img.style.display = 'none';
        wrapper.innerHTML = buildCatAvatarMarkup(extraClass || '');
      });
      wrapper.appendChild(img);
      target.appendChild(wrapper);
    } else {
      target.innerHTML = buildCatAvatarMarkup(extraClass || '');
    }
  }

  function isCompactAiHeader() {
    return window.innerWidth <= 640;
  }

  function getNewButtonText() {
    return isCompactAiHeader() ? '新' : '新对话';
  }

  function getHistoryButtonText(showingHistory) {
    if (showingHistory) return isCompactAiHeader() ? '返回' : '返回聊天';
    return '历史';
  }

  function syncAiHeaderButtons(histBtn, newBtn) {
    if (!histBtn || !newBtn) return;
    histBtn.textContent = getHistoryButtonText(!!S.showingHistory);
    newBtn.textContent = getNewButtonText();
  }

  function bindAiHeaderButtons(histBtn, newBtn) {
    function onResize() {
      syncAiHeaderButtons(histBtn, newBtn);
    }
    window.addEventListener('resize', onResize);
    onResize();
    return function() {
      window.removeEventListener('resize', onResize);
    };
  }

  function upgradeEmptyStateAvatar(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll('.ai-chat-empty-emoji');
    for (var i = 0; i < nodes.length; i++) {
      renderCatAvatarNode(nodes[i], 'ai-chat-empty-avatar');
    }
  }

  function appendEmptyState(container, tipText) {
    if (!container) return null;
    var node = buildEmptyState(tipText);
    container.appendChild(node);
    upgradeEmptyStateAvatar(container);
    return node;
  }

  function normalizeDateKey(dateValue) {
    if (!dateValue) return '';
    var d = new Date(dateValue);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getConversationGroupLabel(dateValue) {
    var d = new Date(dateValue || 0);
    if (isNaN(d.getTime())) return '更早';
    var now = new Date();
    var todayKey = normalizeDateKey(now);
    var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    var dateKey = normalizeDateKey(d);
    if (dateKey === todayKey) return '今天';
    if (dateKey === normalizeDateKey(yesterday)) return '昨天';
    return '更早';
  }

  function getConversationPreview(conv) {
    if (!conv) return '继续这段对话';
    var preview = conv.summary || conv.preview || conv.last_message || conv.last_message_preview || '';
    preview = String(preview || '').replace(/\s+/g, ' ').trim();
    return preview || '继续这段对话';
  }

  function getConversationCountText(conv) {
    var count = Number(conv && (conv.message_count || conv.messages_count || conv.turn_count || conv.count));
    if (!isFinite(count) || count <= 0) return '消息数未知';
    return count + ' 条消息';
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

  function generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }
  
  function abortCurrentRequest() {
    clearStreamCleanup();
    if (S.abortController) {
      try { S.abortController.abort(); } catch (e) {}
      S.abortController = null;
    }
  }
  
  function isAdminUser() {
    try {
      return !!(window.currentUser && window.ADMIN_USERNAME && window.currentUser === window.ADMIN_USERNAME);
    } catch (e) { return false; }
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
    if (S.config && now - S.configFetchedAt < CONFIG_CACHE_TTL) {
      if (S._lastConfigVersion && S.config.config_version !== S._lastConfigVersion) {
        S.configFetchedAt = 0;
        S.config = null;
      } else {
        return S.config;
      }
    }
    var r = await apiRequest('GET', '/config');
    if (r.ok && r.data && r.data.config) {
      S.config = r.data.config;
      S.configFetchedAt = now;
      S._lastConfigVersion = r.data.config.config_version || 0;
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
    var isAdmin = isAdminUser();
    if (isAdmin) {
      if (usage.prompt_tokens) parts.push('输入 ' + usage.prompt_tokens);
      if (usage.completion_tokens) parts.push('输出 ' + usage.completion_tokens);
      if (typeof usage.prompt_cache_hit_tokens === 'number' && usage.prompt_cache_hit_tokens > 0) parts.push('命中 ' + usage.prompt_cache_hit_tokens);
      if (typeof usage.prompt_cache_miss_tokens === 'number' && usage.prompt_cache_miss_tokens > 0) parts.push('未命中 ' + usage.prompt_cache_miss_tokens);
      if (typeof usage.cost === 'number' && usage.cost > 0) parts.push('¥' + usage.cost.toFixed(6) + ' ' + (usage.currency || 'CNY'));
    }
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
    appendEmptyState(messagesEl);
  }

  function setThinkingExpanded(container, expanded, messagesEl) {
    if (!container) return;
    var toggle = container.querySelector('.ai-thinking-toggle');
    var panel = container.querySelector('.ai-thinking-panel');
    var caret = container.querySelector('.ai-thinking-caret');
    if (!toggle || !panel || !caret) return;
    container.classList.toggle('expanded', !!expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    caret.textContent = '\u25be';
    if (messagesEl && expanded) {
      scrollToBottom(messagesEl, false);
    }
  }

  function formatThinkingElapsed(ms) {
    var totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (totalSeconds < 60) return totalSeconds + 's';
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return seconds > 0 ? (minutes + 'm' + seconds + 's') : (minutes + 'min');
  }

  function setThinkingStatus(node, text) {
    if (!node || !node.querySelector) return;
    var label = node.querySelector('.ai-thinking-label');
    if (!label) return;
    label.textContent = text || '思考';
  }

  function createThinkingTimer(reasoningNode) {
    var intervalId = null;
    var startedAt = 0;
    var stopped = false;

    function update(prefix, elapsedMs) {
      if (!reasoningNode || !reasoningNode.isConnected) return;
      setThinkingStatus(reasoningNode, prefix + ' ' + formatThinkingElapsed(elapsedMs));
    }

    return {
      start: function() {
        if (stopped || intervalId) return;
        startedAt = Date.now();
        update('正在思考中', 0);
        intervalId = setInterval(function() {
          if (!reasoningNode || !reasoningNode.isConnected) return;
          update('正在思考中', Date.now() - startedAt);
        }, 500);
      },
      stop: function() {
        if (intervalId) {
          try { clearInterval(intervalId); } catch (e) {}
          intervalId = null;
        }
        stopped = true;
        return startedAt ? Math.max(0, Date.now() - startedAt) : 0;
      },
      cancel: function() {
        if (intervalId) {
          try { clearInterval(intervalId); } catch (e) {}
          intervalId = null;
        }
        stopped = true;
      },
      syncFinal: function(ms) {
        if (intervalId) {
          try { clearInterval(intervalId); } catch (e) {}
          intervalId = null;
        }
        stopped = true;
        if (reasoningNode && reasoningNode.isConnected) {
          setThinkingStatus(reasoningNode, '已思考 ' + formatThinkingElapsed(ms));
        }
      }
    };
  }

  function buildReasoningNode(reasoning, messagesEl, elapsedMs) {
    var container = el('div', { class: 'ai-thinking' });
    var toggle = el('button', {
      type: 'button',
      class: 'ai-thinking-toggle',
      'aria-expanded': 'false',
      'aria-label': '思考过程'
    });
    var label = el('span', { class: 'ai-thinking-label', text: elapsedMs > 0 ? '已思考 ' + formatThinkingElapsed(elapsedMs) : '思考' });
    toggle.appendChild(label);
    toggle.appendChild(el('span', { class: 'ai-thinking-caret', text: '\u25be', 'aria-hidden': 'true' }));

    var panel = el('div', { class: 'ai-thinking-panel' });
    panel.appendChild(el('div', { class: 'ai-thinking-body', text: reasoning }));

    toggle.addEventListener('click', function() {
      setThinkingExpanded(container, !container.classList.contains('expanded'), messagesEl || S.messagesEl);
    });

    container.appendChild(toggle);
    container.appendChild(panel);
    return container;
  }

  // ★ O 修复 Bug 4: 从 history 恢复 think-card
  //   退出对话框重进后, deep_think=true 的消息渲染成 think-card
  // ★ Q 重做: 极简版 (与 handleSendDeepThink 一致结构)
  function buildThinkCardFromHistory(msg, messagesEl) {
    var thinkingLog = Array.isArray(msg.thinking_log) ? msg.thinking_log : [];
    var workerResults = Array.isArray(msg.worker_results) ? msg.worker_results : [];
    var agentCount = msg.agent_count || (workerResults.length || 0);
    var thinkDurationMs = typeof msg.think_duration_ms === 'number' ? msg.think_duration_ms : 0;
    var searchResults = Array.isArray(msg.search_results) ? msg.search_results : [];
    var finalThinkingMode = (msg.usage && msg.usage.thinking_mode) || msg.thinking_mode || 'max';

    var node = el('div', { class: 'ai-think-card collapsed' });
    node.innerHTML =
      '<div class="ai-think-header">' +
        '<span class="ai-think-icon">' + AI_THINK_ICON + '</span>' +
        '<span class="ai-think-title">已思考 ' + formatThinkDuration(thinkDurationMs) + '</span>' +
        '<span class="ai-think-meta">' + (agentCount > 0 ? (agentCount + ' agent') : '') + '</span>' +
        '<span class="ai-think-chevron">▾</span>' +
      '</div>' +
      '<div class="ai-think-body">' +
        (thinkingLog.length > 0 ?
          '<details class="ai-think-thinking">' +
            '<summary><span>查看思考过程 (' + thinkingLog.length + ' 步)</span></summary>' +
            '<div class="ai-think-thinking-body"></div>' +
          '</details>' : '') +
        (thinkingLog.length > 0 ? '<div class="ai-think-divider"></div>' : '') +
        '<div class="ai-think-answer"></div>' +
        '<div class="ai-msg-footer"></div>' +
      '</div>';

    // header 整行可点击展开/折叠
    var headerEl = node.querySelector('.ai-think-header');
    var chevronEl = node.querySelector('.ai-think-chevron');
    headerEl.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var isCollapsed = node.classList.contains('collapsed');
      if (isCollapsed) {
        node.classList.remove('collapsed');
        node.classList.add('expanded');
        if (chevronEl) chevronEl.textContent = '▴';
      } else {
        node.classList.add('collapsed');
        node.classList.remove('expanded');
        if (chevronEl) chevronEl.textContent = '▾';
      }
    });

    // 渲染 markdown + [来源N] className
    var contentForRender = msg.content || '';
    if (searchResults.length > 0) {
      contentForRender = contentForRender.replace(/\[来源(\d+)\]/g, function(m, n) {
        var idx = parseInt(n, 10);
        if (isNaN(idx) || idx < 1 || idx > searchResults.length) return m;
        var sr = searchResults[idx - 1] || {};
        if (!sr.url) return m;
        return '[来源' + n + '](' + sr.url + ')';
      });
    }
    var answerEl = node.querySelector('.ai-think-answer');
    // 兜底：历史消息可能 content 为空，避免答案区空白
    if (!contentForRender || !String(contentForRender).trim()) {
      var hasThinkingLog = thinkingLog.length > 0 || (msg.reasoning && String(msg.reasoning).trim());
      contentForRender = hasThinkingLog ? '（AI 只返回了思考过程，没有生成正文回复）' : '（AI 暂无回复）';
    }
    answerEl.innerHTML = renderMarkdown(contentForRender);
    try {
      var as = answerEl.querySelectorAll('a');
      for (var ai = 0; ai < as.length; ai++) {
        var atxt = (as[ai].textContent || '').trim();
        if (/^来源\d+$/.test(atxt)) as[ai].className = 'ai-source-link';
      }
    } catch (e) {}
    setupBubbleCopy(answerEl, messagesEl);

    // 渲染思考过程日志 (放进 <details> 内, 先合并同角色)
    if (thinkingLog.length > 0) {
      var thinkLogBox = node.querySelector('.ai-think-thinking-body');
      if (thinkLogBox) {
        var mergedLog = [];
        for (var tli = 0; tli < thinkingLog.length; tli++) {
          var mtl = thinkingLog[tli];
          var mlast = mergedLog[mergedLog.length - 1];
          if (mlast && mlast.agent_role === (mtl.agent_role || 'AI 智能体') && mlast.round === (mtl.round || 0)) {
            mlast.chunk = (mlast.chunk || '') + (mtl.chunk || '');
          } else {
            mergedLog.push({ agent_role: mtl.agent_role || 'AI 智能体', chunk: mtl.chunk || '', round: mtl.round || 0 });
          }
        }
        mergedLog.forEach(function(entry) {
          var entEl = el('div', { class: 'ai-thought-entry' });
          var roleLabel = entry.agent_role || 'AI';
          var roundLabel = entry.round ? ' · 第' + entry.round + '轮' : '';
          entEl.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + roundLabel + '</div><div class="ai-thought-chunk"></div>';
          entEl.querySelector('.ai-thought-chunk').textContent = String(entry.chunk || '').slice(0, 4000);
          thinkLogBox.appendChild(entEl);
        });
        // 更新 summary 显示合并后的步数
        var summaryEl = node.querySelector('.ai-think-thinking summary span:last-child');
        if (summaryEl) summaryEl.textContent = '查看思考过程 (' + mergedLog.length + ' 步)';
      }
    }

    // footer (时间 + 思考程度 + agent 数)
    var footer = node.querySelector('.ai-msg-footer');
    if (footer) {
      footer.innerHTML = '';
      if (msg.created_at) footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
      var badge = el('span', { class: 'ai-msg-thinking-badge' });
      badge.innerHTML = AI_THINK_ICON + ' ' + finalThinkingMode;
      footer.appendChild(badge);
      if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
      if (msg.usage) {
        var usageLine = buildUsageLine(msg.usage);
        if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
      }
    }

    return node;
  }

  // ★ O 修复 Bug 4: 格式化 think_duration_ms
  function formatThinkDuration(ms) {
    if (!ms || ms <= 0) return '0s';
    var sec = Math.round(ms / 1000);
    var min = Math.floor(sec / 60);
    var s = sec % 60;
    return min > 0 ? (min + 'm ' + s + 's') : (s + 's');
  }

  function buildMessageNode(msg, messagesEl) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    // ★ O 修复 Bug 4: deep_think 消息渲染成 ai-think-card (从 history 恢复)
    if (role === 'assistant' && msg.deep_think === true) {
      return buildThinkCardFromHistory(msg, messagesEl);
    }
    var node = el('div', { class: 'ai-msg ' + role + ' entering' });
    if (role === 'assistant' && shouldRenderReasoning(msg)) {
      node.appendChild(buildReasoningNode(msg.reasoning, messagesEl, msg.thinking_elapsed_ms));
    }
    // ★ C 关键修复：把 [来源N] 标记渲染成可点击链接
    //   AI prompt 要求引用具体事实时必须用 [来源N]（N 从 1 开始）
    //   这里把 N 替换成 [来源N](url)，让 renderMarkdown 转成 <a>
    var contentForRender = msg.content || '';
    if (role === 'assistant' && Array.isArray(msg.search_results) && msg.search_results.length > 0) {
      contentForRender = contentForRender.replace(/\[来源(\d+)\]/g, function(m, n) {
        var idx = parseInt(n, 10);
        if (isNaN(idx) || idx < 1 || idx > msg.search_results.length) return m;
        var sr = msg.search_results[idx - 1] || {};
        if (!sr.url) return m;
        return '[来源' + n + '](' + sr.url + ')';
      });
    }
    var bubble = el('div', { class: 'ai-msg-bubble' });
    // 兜底：历史消息可能 content 为空（如 AI 只返回了思考过程），避免气泡空白
    if (!contentForRender || !String(contentForRender).trim()) {
      var hasReasoning = !!(msg.reasoning && String(msg.reasoning).trim());
      contentForRender = hasReasoning ? '（AI 只返回了思考过程，没有生成正文回复）' : '（AI 暂无回复）';
    }
    bubble.innerHTML = renderMarkdown(contentForRender);
    // ★ C 关键修复：给 [来源N] 链接加专属 className
    //   链接文本是 "来源1"/"来源2"... 时加 .ai-source-link，CSS 可以加特殊样式
    try {
      var as = bubble.querySelectorAll('a');
      for (var ai = 0; ai < as.length; ai++) {
        var atxt = (as[ai].textContent || '').trim();
        if (/^来源\d+$/.test(atxt)) {
          as[ai].className = 'ai-source-link';
        }
      }
    } catch (e) {}
    setupBubbleCopy(bubble, messagesEl);
    node.appendChild(bubble);
    // 底部信息栏：时间 · 思考程度 · 用量（仅 assistant 有思考标签和用量）
    var footer = el('div', { class: 'ai-msg-footer' });
    if (msg.created_at) {
      footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
    }
    if (role === 'assistant') {
      // ★ P1 关键修复：搜索徽章
      //   - 1 天内（search_expires_at > now）：完整显示"已联网搜索 · N 条结果"+ 可展开结果列表
      //   - 1 天后：徽章保持显示，但标记"结果已过期"
      //   - 永远显示徽章（用户原话"重新进对话框显示已联网搜索 搜到多少条信息"）
      if (msg.search_count > 0) {
        var nowMs = Date.now();
        var expiresAt = typeof msg.search_expires_at === 'number' ? msg.search_expires_at : 0;
        var isExpired = expiresAt > 0 && nowMs > expiresAt;
        var searchBar = el('div', { class: 'ai-search-status' + (isExpired ? ' expired' : '') });
        var searchLabel = '已联网搜索 · ' + msg.search_count + ' 条结果';
        if (isExpired) searchLabel += '（结果已过期）';
        var queryStr = msg.search_query || '';
        if (queryStr && !isExpired) {
          searchLabel += ' · 搜索：' + queryStr;
        }
        searchBar.textContent = searchLabel;
        // 1 天内 + 有 results 数组 → 可点击展开
        if (!isExpired && Array.isArray(msg.search_results) && msg.search_results.length > 0) {
          var expandBtn = el('span', { class: 'ai-search-toggle', text: '展开' });
          searchBar.appendChild(expandBtn);
          var listEl = el('div', { class: 'ai-search-detail', style: 'display:none;' });
          for (var si = 0; si < msg.search_results.length; si++) {
            var sr = msg.search_results[si] || {};
            var item = el('a', {
              class: 'ai-search-detail-item',
              href: sr.url || '#',
              target: '_blank',
              rel: 'noopener noreferrer'
            });
            item.appendChild(el('span', { class: 'ai-search-detail-title', text: sr.title || '(无标题)' }));
            var snippet = sr.snippet || '';
            if (snippet.length > 140) snippet = snippet.slice(0, 140) + '…';
            if (snippet) item.appendChild(el('span', { class: 'ai-search-detail-snippet', text: snippet }));
            var meta = (sr.source ? sr.source : '') + (sr.published_at ? ' · ' + sr.published_at : '');
            if (meta) item.appendChild(el('span', { class: 'ai-search-detail-source', text: meta }));
            listEl.appendChild(item);
          }
          searchBar.appendChild(listEl);
          searchBar.style.cursor = 'pointer';
          searchBar.addEventListener('click', function(ev) {
            if (ev && ev.target && (ev.target.tagName === 'A' || ev.target.className === 'ai-search-detail-title')) return;
            var isShown = listEl.style.display !== 'none';
            listEl.style.display = isShown ? 'none' : 'block';
            try { expandBtn.textContent = isShown ? '展开' : '收起'; } catch (e) {}
          });
        }
        node.appendChild(searchBar);
      }
      // 搜索到此处结束
      var thinkingMode = getMessageThinkingMode(msg);
      if (thinkingMode && thinkingMode !== 'off') {
        var badgeText = msg.thinking_elapsed_ms > 0 ? '思考 ' + formatThinkingElapsed(msg.thinking_elapsed_ms) : '思考 ' + thinkingMode;
        footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: badgeText }));
      }
      if (msg.usage && isAdminUser()) {
        var parts = [];
        if (msg.usage.prompt_tokens) parts.push('输入 ' + msg.usage.prompt_tokens);
        if (msg.usage.completion_tokens) parts.push('输出 ' + msg.usage.completion_tokens);
        if (typeof msg.usage.prompt_cache_hit_tokens === 'number' && msg.usage.prompt_cache_hit_tokens > 0) parts.push('命中 ' + msg.usage.prompt_cache_hit_tokens);
        if (typeof msg.usage.prompt_cache_miss_tokens === 'number' && msg.usage.prompt_cache_miss_tokens > 0) parts.push('未命中 ' + msg.usage.prompt_cache_miss_tokens);
        if (typeof msg.usage.cost === 'number' && msg.usage.cost > 0) parts.push('¥' + msg.usage.cost.toFixed(6) + ' ' + (msg.usage.currency || 'CNY'));
        if (parts.length) footer.appendChild(el('span', { class: 'ai-msg-usage', text: parts.join(' · ') }));
      }
    }
    if (footer.children.length > 0) node.appendChild(footer);
    return node;
  }

  function buildTypingNode() {
    var node = el('div', { class: 'ai-msg assistant typing' });
    var bubble = el('div', { class: 'ai-msg-bubble ai-typing-bubble', 'aria-hidden': 'true' });
    for (var i = 0; i < 3; i++) bubble.appendChild(el('span'));
    node.appendChild(bubble);
    return node;
  }

  function buildEmptyState(tipText) {
    var cfg = S.config || {};
    var empty = el('div', { class: 'ai-chat-empty' });
    var visual = el('div', { class: 'ai-chat-empty-visual' });
    var emojiSlot = el('div', { class: 'ai-chat-empty-emoji' });
    renderCatAvatarNode(emojiSlot, 'ai-chat-empty-avatar', S.config && S.config.avatar_url, S.config && S.config.avatar_version);
    visual.appendChild(emojiSlot);
    empty.appendChild(visual);
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

  function takeSmoothTextChunk(pending, options) {
    pending = String(pending || '');
    if (!pending) return '';
    // V2: 更快节奏, minChunk=3/maxChunk=12 配合 8-20字/帧, 流畅不卡
    var minChunk = Math.max(1, options && options.minChunk || 3);
    var maxChunk = Math.max(minChunk, options && options.maxChunk || 12);
    if (pending.length <= maxChunk) return pending;

    var punctuation = /[，。！？；：、,.!?;:\n]/;
    for (var i = Math.min(maxChunk - 1, pending.length - 1); i >= minChunk - 1; i--) {
      if (punctuation.test(pending.charAt(i))) return pending.slice(0, i + 1);
    }

    if (/^[\x00-\x7F]/.test(pending)) {
      for (var j = Math.min(maxChunk, pending.length - 1); j >= minChunk; j--) {
        var ch = pending.charAt(j);
        if (/\s/.test(ch) || /[,.!?;:]/.test(ch)) return pending.slice(0, j + 1);
      }
    }

    return pending.slice(0, maxChunk);
  }

  function createSmoothTextRenderer(targetEl, options) {
    options = options || {};
    var reducedMotion = prefersReducedMotion();
    var pending = '';
    var rendered = '';
    var rafId = 0;
    var cancelled = false;
    var finished = false;
    var paused = false;
    var streamClass = options.streamClass || 'ai-streaming-soft';
    var requestFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(cb) { return setTimeout(cb, 16); };
    var cancelFrame = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
    // V3: 末尾呼吸竖线光标 (替代闪光光点)
    var cursor = null;
    function ensureCursor() {
      if (cursor || finished || cancelled) return;
      try {
        cursor = document.createElement('span');
        cursor.className = 'ai-stream-cursor';
        cursor.setAttribute('aria-hidden', 'true');
        targetEl.appendChild(cursor);
      } catch (e) {}
    }
    function removeCursor() {
      try { if (cursor && cursor.parentNode) cursor.parentNode.removeChild(cursor); } catch (e) {}
      cursor = null;
    }

    function clearFrame() {
      if (!rafId) return;
      try { cancelFrame(rafId); } catch (e) {}
      rafId = 0;
    }

    function emitText(forceAll) {
      if (cancelled || !targetEl) return;
      if (!pending) {
        targetEl.classList.remove(streamClass);
        return;
      }
      targetEl.classList.add(streamClass);
      var next = '';
      if (reducedMotion || forceAll) {
        next = pending;
        pending = '';
      } else {
        // V3: 直接渲染 markdown, 每帧 12-28 字, 快速自然
        var frameBudget = pending.length > 300 ? 28 : (pending.length > 120 ? 20 : 12);
        while (pending && next.length < frameBudget) {
          var chunk = takeSmoothTextChunk(pending, options);
          if (!chunk) break;
          next += chunk;
          pending = pending.slice(chunk.length);
        }
      }
      if (!next) return;
      rendered += next;
      try { console.log('[AI-RENDER] emitText', rendered.length, 'chars, target:', (targetEl && targetEl.className) || 'null'); } catch(_) {}
      targetEl.innerHTML = renderMarkdown(rendered);
      ensureCursor();
      if (typeof options.onRender === 'function') {
        try { options.onRender(rendered); } catch (e2) {}
      }
      if (!pending) {
        targetEl.classList.remove(streamClass);
        if (finished && typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
      }
    }

    function tick() {
      rafId = 0;
      if (cancelled || paused) return;
      emitText(false);
      if (pending) schedule();
    }

    function schedule() {
      if (cancelled || !pending || rafId || paused) return;
      if (reducedMotion) {
        emitText(true);
        return;
      }
      rafId = requestFrame(tick);
    }

    var api = {
      append: function(text) {
        if (cancelled || !targetEl || !text || finished) return;
        pending += String(text);
        if (S.activeRenderers.indexOf(api) === -1) S.activeRenderers.push(api);
        if (!paused) schedule();
      },
      flush: function() {
        if (cancelled || !targetEl) return;
        clearFrame();
        emitText(true);
      },
      pause: function() {
        paused = true;
        clearFrame();
      },
      resume: function() {
        if (!paused) return;
        paused = false;
        if (pending) schedule();
      },
      isPaused: function() { return paused; },
      finish: function(finalText) {
        var idx = S.activeRenderers.indexOf(api);
        if (idx !== -1) S.activeRenderers.splice(idx, 1);
        if (cancelled || !targetEl) return;
        clearFrame();
        finished = true;
        paused = false;
        // 只用有效内容覆盖, 避免空字符串清掉已流式渲染的文字
        if (typeof finalText === 'string' && finalText.length > 0) rendered = finalText;
        pending = '';
        removeCursor();
        // 兜底: 如果渲染完还是空的, 显示提示
        if (!rendered || rendered.trim().length === 0) {
          rendered = '（AI 暂无回复，请重试）';
          targetEl.classList.add('ai-empty-fallback');
        }
        try { console.log('[AI-RENDER] finish len:', rendered.length, 'preview:', String(rendered).slice(0,50), 'el:', targetEl.tagName, targetEl.className, 'inDOM:', !!targetEl.closest('body')); } catch(_) {}
        targetEl.innerHTML = renderMarkdown(rendered);
        targetEl.classList.remove(streamClass);
        if (typeof options.onRender === 'function') {
          try { options.onRender(rendered); } catch (e3) {}
        }
        if (typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
      },
      stop: function() {
        if (cancelled) return;
        clearFrame();
        if (pending) emitText(true);
      },
      cancel: function() {
        var idx2 = S.activeRenderers.indexOf(api);
        if (idx2 !== -1) S.activeRenderers.splice(idx2, 1);
        if (cancelled) return;
        cancelled = true;
        clearFrame();
        removeCursor();
        pending = '';
        rendered = '';
        try { if (targetEl) targetEl.innerHTML = ''; } catch (e) {}
        targetEl = null;
      }
    };
    return api;
  }

  function bindVisualViewport(messagesEl, input, inputBar) {
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
      root.classList.toggle('ai-keyboard-open', keyboardHeight > 0);

      if (_isTouchMobile) {
        // 移动端：输入栏 position:fixed 浮在键盘上方，容器不缩放
        if (keyboardHeight > 0) {
          var barRect = inputBar.getBoundingClientRect();
          var rootRect = root.getBoundingClientRect();
          inputBar.style.position = 'fixed';
          inputBar.style.bottom = keyboardHeight + 'px';
          inputBar.style.left = rootRect.left + 'px';
          inputBar.style.width = rootRect.width + 'px';
          inputBar.style.zIndex = '100';
          messagesEl.style.paddingBottom = 'calc(var(--ai-input-height, 72px) + ' + keyboardHeight + 'px + 14px)';
        } else {
          inputBar.style.position = '';
          inputBar.style.bottom = '';
          inputBar.style.left = '';
          inputBar.style.width = '';
          inputBar.style.zIndex = '';
          messagesEl.style.paddingBottom = '';
        }
      } else {
        // 桌面端：保持原有行为（缩放高度）
        updateRootVar('--ai-keyboard-offset', keyboardHeight + 'px');
        updateRootVar('--ai-viewport-height', viewportHeight ? viewportHeight + 'px' : '100%');
      }
      updateInputMetrics();
      if (keyboardHeight > 0 && isNearBottom(messagesEl, 120)) {
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
      }
    }

    function resetViewport() {
      if (_isTouchMobile) {
        inputBar.style.position = '';
        inputBar.style.bottom = '';
        inputBar.style.left = '';
        inputBar.style.width = '';
        inputBar.style.zIndex = '';
        messagesEl.style.paddingBottom = '';
      }
      root.classList.remove('ai-keyboard-open');
      updateRootVar('--ai-keyboard-offset', '0px');
      updateRootVar('--ai-viewport-height', '100%');
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
        if (!S.sending) resetViewport();
      }, 100);
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
      inputBar.style.position = '';
      inputBar.style.bottom = '';
      inputBar.style.left = '';
      inputBar.style.width = '';
      inputBar.style.zIndex = '';
      messagesEl.style.paddingBottom = '';
    };
  }

  // ===================== M: 深度思考模式 — 进度卡 / toggle / cancel =====================
  // 切换深度思考模式 (持久化到 localStorage, 重开对话框后恢复)
  function toggleDeepThink() {
    if (!S.deepThinkEnabled) {
      notify('深度思考模式已被管理员关闭');
      return;
    }
    if (S.sending && !S.deepThink) {
      notify('当前消息处理中, 请稍后再开启深度思考');
      return;
    }
    S.deepThink = !S.deepThink;
    try { localStorage.setItem('xtj_ai_deep_think', S.deepThink ? '1' : '0'); } catch (e) {}
    refreshDeepThinkToggle();
    // 关闭深度思考时, 不取消当前正在进行的深度思考请求
    // 允许用户切换模式, 后续消息用新模式发送
    // 当前深度思考继续在后台运行
  }

  function refreshDeepThinkToggle() {
    var btn = document.getElementById('aiDeepThinkToggle');
    if (btn) {
      if (S.deepThink) btn.classList.add('on');
      else btn.classList.remove('on');
      // ★ P 新增: 后端禁用时显示禁用样式
      if (!S.deepThinkEnabled) {
        btn.classList.add('disabled');
        btn.setAttribute('title', '深度思考模式已被管理员关闭');
      } else {
        btn.classList.remove('disabled');
        btn.removeAttribute('title');
      }
    }
  }

  // 从 localStorage 恢复 deepThink 状态
  function restoreDeepThinkState() {
    try {
      var saved = localStorage.getItem('xtj_ai_deep_think');
      S.deepThink = saved === '1';
    } catch (e) { S.deepThink = false; }
  }

  // 构造深度思考进度卡片 (极简风格)
  // ★ U2 重做: 4 角凹星 sparkle (ChatGPT/Claude 风格, 替代菱形)
  var AI_THINK_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" stroke="none" style="vertical-align:-2px"><path d="M8 1 L9.2 6.4 L15 8 L9.2 9.6 L8 15 L6.8 9.6 L1 8 L6.8 6.4 Z"/></svg>';

  function buildDeepThinkProgressCard() {
    var card = el('div', { class: 'ai-progress-card' });
    card.innerHTML =
      '<div class="ai-progress-header">' +
        '<span class="ai-progress-icon">' + AI_THINK_ICON + '</span>' +
        '<span class="ai-progress-title">思考中...</span>' +
        '<span class="ai-progress-elapsed">0s</span>' +
      '</div>' +
      '<div class="ai-progress-thinking-log" style="display:none"></div>' +
      '<button type="button" class="ai-progress-stop">停止思考</button>';
    card.querySelector('.ai-progress-stop').addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      cancelDeepThink();
    });
    var cardStart = Date.now();
    var cardEl = card;
    var cardTimer = setInterval(function() {
      if (S.deepThinkProgressCard !== cardEl || cardEl._done) { clearInterval(cardTimer); return; }
      var el = cardEl.querySelector('.ai-progress-elapsed');
      if (el) {
        var sec = Math.floor((Date.now() - cardStart) / 1000);
        var min = Math.floor(sec / 60);
        el.textContent = min > 0 ? (min + 'm ' + (sec % 60) + 's') : (sec + 's');
      }
    }, 1000);
    card._elapsedTimer = cardTimer;
    card._cleanupTimer = function() { try { clearInterval(cardTimer); } catch (e) {} };
    return card;
  }

  // 更新进度卡
  function updateDeepThinkProgressCard(card, evt) {
    if (!card) return;
    var titleText = card.querySelector('.ai-progress-title');

    if (evt.type === 'deep_think_stage') {
      var stageMap = { init: '准备中...', agent: '思考中...', searching: '搜索中...', error: '失败' };
      if (titleText) titleText.textContent = stageMap[evt.stage] || evt.stage;
    } else if (evt.type === 'deep_think_tool') {
      if (titleText) titleText.textContent = '搜索中...';
    } else if (evt.type === 'thinking_chunk') {
      if (!card._thinkingLog) card._thinkingLog = [];
      card._thinkingLog.push({ agent_role: evt.agent_role, chunk: evt.chunk, round: evt.round || 0 });
      var logBox = card.querySelector('.ai-progress-thinking-log');
      if (logBox) {
        if (logBox.style.display === 'none') logBox.style.display = '';
        var roleLabel = escapeHtml(evt.agent_role || 'AI');
        // 同角色累积到最后一个条目, 不每字创建新条目
        var lastEntry = logBox.lastElementChild;
        if (lastEntry && lastEntry._role === roleLabel) {
          var lastChunk = lastEntry.querySelector('.ai-thought-chunk');
          if (lastChunk) lastChunk.textContent = (lastChunk.textContent || '') + String(evt.chunk).slice(0, 4000);
        } else {
          var entry = el('div', { class: 'ai-thought-entry' });
          entry._role = roleLabel;
          entry.innerHTML = '<div class="ai-thought-role">' + roleLabel + '</div><div class="ai-thought-chunk"></div>';
          entry.querySelector('.ai-thought-chunk').textContent = String(evt.chunk).slice(0, 4000);
          logBox.appendChild(entry);
        }
        try { logBox.scrollTop = logBox.scrollHeight; } catch (e) {}
        while (logBox.children.length > 50) logBox.removeChild(logBox.firstChild);
      }
    } else if (evt.type === 'heartbeat') {
      var elapsedSec = Math.floor((evt.elapsed_ms || 0) / 1000);
      var min = Math.floor(elapsedSec / 60);
      var sec = elapsedSec % 60;
      var el = card.querySelector('.ai-progress-elapsed');
      if (el) el.textContent = min > 0 ? (min + 'm ' + sec + 's') : (sec + 's');
    } else if (evt.type === 'done') {
      if (titleText) titleText.textContent = '思考完成';
    } else if (evt.type === 'error') {
      if (titleText) titleText.textContent = '思考中断';
      card.classList.add('ai-progress-card-error');
    }
  }

  // 取消深度思考
  function cancelDeepThink() {
    if (S.deepThinkJob) {
      try { S.deepThinkJob.abort(); } catch (e) {}
    }
    // Cleanup progress card timer and state
    if (S.deepThinkProgressCard) {
      try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e) {}
      try { if (S.deepThinkProgressCard.parentNode) S.deepThinkProgressCard.parentNode.removeChild(S.deepThinkProgressCard); } catch (e) {}
    }
    // Reset sending state so user can send again
    S.sending = false;
    S.paused = false;
    S.activeRenderers = [];
    S.deepThinkJob = null;
    S.deepThinkProgressCard = null;
    S.abortController = null;
    if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
    // Fire-and-forget cancel to server
    try {
      var token = localStorage.getItem('xtj_user_token');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      fetch(API_BASE + '/chat/cancel', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ conversation_id: S.conversationId || '' })
      }).catch(function() {});
    } catch (e) {}
    notify('\u5df2\u53d6\u6d88\u601d\u8003');
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
    } catch (e) {
      try { console.warn('[AI-AUTH] ensureRealUserAuth error:', e && e.message); } catch(ee) {}
    }
    notify('登录状态异常，请尝试刷新页面后重新登录');
    return false;
  }

  // ===================== M: 深度思考模式发送 =====================
  // 独立流程: 走 /api/agent/chat (deep_think=true) SSE 长连接
  //   进度卡实时更新 (1-10 个 agent 状态)
  //   done 后渲染最终答案 + [来源N] 标注 + 搜索徽章
  async function handleSendDeepThink(text, input, sendBtn, messagesEl) {
    var originalText = text;
    function restoreInputText() {
      input.value = originalText;
      input.style.height = 'auto';
      try { input.style.height = Math.min(input.scrollHeight, 120) + 'px'; if (!_isTouchMobile) input.focus(); } catch (e) {}
      updateInputMetrics();
    }

    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) { S.sending = false; return; }

    if (S.sending) {
      abortCurrentRequest();
      try { await new Promise(function(r) { setTimeout(r, 100); }); } catch (e) {}
    }

    S.clientRequestId++;
    var reqId = 'cr_' + S.clientRequestId + '_' + Date.now();
    S._currentReqId = reqId;
    function resetSendingIfCurrent() {
      if (S._currentReqId === reqId) {
        S.sending = false;
        S.deepThinkJob = null;
        S.deepThinkProgressCard = null;
        S.abortController = null;
        S.paused = false;
        S.activeRenderers = [];
        if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
      }
    }
    S.sending = true;
    if (S.pauseBtnEl) S.pauseBtnEl.style.display = '';
    clearReplyTimer();

    // 1. 追加 user 消息
    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: text, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);
    S.autoScrollPinned = true;
    scrollToBottom(messagesEl, true);

    // 2. 创建进度卡 (而不是 typing node)
    var progressCard = buildDeepThinkProgressCard();
    S.deepThinkProgressCard = progressCard;
    messagesEl.appendChild(progressCard);
    scrollToBottom(messagesEl, true);

    // 3. 清空输入框
    input.value = '';
    input.style.height = 'auto';
    updateInputMetrics();
    if (_isTouchMobile) { try { input.blur(); } catch (e2) {} }
    else { try { input.focus(); } catch (e2) {} }

    // 4. 创建 AbortController
    var controller = new AbortController();
    S.abortController = controller;
    S.deepThinkJob = controller;
    S.currentStreamAborted = false;

    var url = API_BASE + '/chat';
    var auth = await getUserAuthPayload({ forceNoToken: false });
    var headers = auth.headers || {};
    var fetchBody = JSON.stringify({
      message: text,
      conversation_id: S.conversationId,
      client_request_id: reqId,
      deep_think: true,
      // ★ P 新增: 传思考程度给后端 runMultiAgentFlow (后端会用这个, 不用 config)
      thinking_mode: S.deepThinkEffort || 'max'
    });

    var aborted = false;
    var aiContent = '';
    var finalMeta = null;
    var finalModel = '';
    // ★ P 改: 用 S.deepThinkEffort (从后端 config 同步) 替代写死 'high'
    var finalThinkingMode = S.deepThinkEffort || 'max';
    var streamConvId = null;
    var aiNode = null;
    var aiBubble = null;
    var contentRenderer = null;
    var answerRenderer = null;  // V2: 流式答案渲染器(answer_chunk用)
    var answerStarted = false; // V2: 是否已进入回答阶段
    var doneReceived = false;
    var evtHandled = false;

    function safeRemoveProgressCard() {
      if (progressCard) {
        try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e) {}
        try { progressCard.remove(); } catch (e) {}
        try { progressCard._done = true; } catch (e) {}
      }
    }

    function ensureThinkCardNode() {
      if (aiNode) return aiNode;
      safeRemoveProgressCard()
      var node = el('div', { class: 'ai-think-card expanded' });
      node.innerHTML =
        '<div class="ai-think-header">' +
          '<span class="ai-think-icon">' + AI_THINK_ICON + '</span>' +
          '<span class="ai-think-title">思考中…</span>' +
          '<span class="ai-think-meta"></span>' +
          '<span class="ai-think-chevron">▾</span>' +
        '</div>' +
        '<div class="ai-think-body">' +
          '<details class="ai-think-thinking">' +
            '<summary><span>查看思考过程</span></summary>' +
            '<div class="ai-think-thinking-body"></div>' +
          '</details>' +
          '<div class="ai-think-divider"></div>' +
          '<div class="ai-think-answer"></div>' +
          '<div class="ai-msg-footer"></div>' +
        '</div>';
      var headerEl = node.querySelector('.ai-think-header');
      var chevronEl = node.querySelector('.ai-think-chevron');
      headerEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isCollapsed = node.classList.contains('collapsed');
        if (isCollapsed) {
          node.classList.remove('collapsed');
          node.classList.add('expanded');
          if (chevronEl) chevronEl.textContent = '▴';
        } else {
          node.classList.add('collapsed');
          node.classList.remove('expanded');
          if (chevronEl) chevronEl.textContent = '▾';
        }
      });
      messagesEl.appendChild(node);
      aiNode = node;
      S.autoScrollPinned = true;
      scrollToBottom(messagesEl, true);
      return node;
    }

    // ★ O 修复 Bug 4: 构造 think-card (取代普通 ai-msg 节点)
    //   折叠态: 头部显示 "⚡ 已思考 38s · 5 个 agent" + 折叠按钮
    //   展开态: 顶部思考过程日志 + 底部最终答案 (markdown)
    //   退出对话框重进后, think-card 从 history 恢复
    function finishThinkCard(node, content, evt) {
      if (node) node.classList.remove('generating');

      var searchCount = evt ? (evt.search_count || 0) : 0;
      var searchQuery = evt ? (evt.search_query || '') : '';
      var searchResults = evt && Array.isArray(evt.search_results) ? evt.search_results : null;
      var searchExpiresAt = evt && typeof evt.search_expires_at === 'number' ? evt.search_expires_at : 0;
      var usage = evt && evt.usage ? evt.usage : null;
      var agentCount = evt && evt.agent_count ? evt.agent_count : 0;
      var plannerInfo = evt && evt.planner ? evt.planner : null;
      var workerResults = evt && Array.isArray(evt.worker_results) ? evt.worker_results : null;
      var thinkingLog = evt && Array.isArray(evt.thinking_log) ? evt.thinking_log : [];
      var thinkDurationMs = evt && typeof evt.think_duration_ms === 'number' ? evt.think_duration_ms : 0;

      var aiMsg = {
        role: 'assistant',
        content: content,
        reasoning: '',
        created_at: new Date().toISOString(),
        // ★ P 改: 用 finalThinkingMode (后端动态) 替代写死 'max'
        thinking_mode: finalThinkingMode,
        deep_think: true,
        agent_count: agentCount,
        planner: plannerInfo,
        worker_results: workerResults,
        thinking_log: thinkingLog,
        think_duration_ms: thinkDurationMs,
        search_count: searchCount,
        search_query: searchQuery,
        search_results: searchResults,
        search_expires_at: searchExpiresAt,
        // ★ P 改: usage.thinking_mode 同步实际值
        usage: Object.assign({}, usage || {}, { model: finalModel, thinking_mode: finalThinkingMode, deep_think: true, agent_count: agentCount })
      };
      S.messages.push(aiMsg);

      if (node) {
        // [来源N] 渲染
        var contentForRender = content || '';
        if (searchResults && searchResults.length > 0) {
          contentForRender = contentForRender.replace(/\[来源(\d+)\]/g, function(m, n) {
            var idx = parseInt(n, 10);
            if (isNaN(idx) || idx < 1 || idx > searchResults.length) return m;
            var sr = searchResults[idx - 1] || {};
        if (!sr.url) return m;
        return '[来源' + n + '](' + sr.url.replace(/"/g, '%22').replace(/\)/g, '%29') + ')';
          });
        }

        // ★ Q V2: 答案区 — 若 answerRenderer 已在流式中, 直接 finish; 否则走旧逐字兜底
        var answerEl = node.querySelector('.ai-think-answer');
        function finalizeAnswer() {
          // 完成后处理来源链接 + 复制按钮
          try {
            var as = answerEl.querySelectorAll('a');
            for (var ai = 0; ai < as.length; ai++) {
              var atxt = (as[ai].textContent || '').trim();
              if (/^来源\d+$/.test(atxt)) as[ai].className = 'ai-source-link';
            }
          } catch (e) {}
          setupBubbleCopy(answerEl, messagesEl);
          var titleEl = node.querySelector('.ai-think-title');
          if (titleEl) titleEl.textContent = '已思考';
        }
        if (answerEl) {
          if (answerRenderer) {
            // V2: 流式渲染已在 answer_chunk 中进行, done 时只 finish 成 markdown
            answerRenderer.finish(contentForRender);
            answerRenderer = null;
            finalizeAnswer();
          } else {
            if (contentRenderer) { try { contentRenderer.stop && contentRenderer.stop(); } catch (e) {} }
            answerEl.innerHTML = '';
            contentRenderer = createSmoothTextRenderer(answerEl, {
              minChunk: 2, maxChunk: 6,
              onDone: function() { finalizeAnswer(); }
            });
            contentRenderer.append(contentForRender);
            contentRenderer.finish(contentForRender);
            contentRenderer = null;
          }
        }

        // 渲染思考过程日志 (放进 <details> 内, 先合并同角色连续条目)
        var thinkLogBox = node.querySelector('.ai-think-thinking-body');
        if (thinkLogBox && thinkingLog.length > 0) {
          thinkLogBox.innerHTML = '';
          // 合并同角色连续条目
          var mergedLog = [];
          for (var tli = 0; tli < thinkingLog.length; tli++) {
            var mtl = thinkingLog[tli];
            var mlast = mergedLog[mergedLog.length - 1];
            if (mlast && mlast.agent_role === (mtl.agent_role || 'AI') && mlast.round === (mtl.round || 0)) {
              mlast.chunk = (mlast.chunk || '') + (mtl.chunk || '');
            } else {
              mergedLog.push({ agent_role: mtl.agent_role || 'AI', chunk: mtl.chunk || '', round: mtl.round || 0 });
            }
          }
          mergedLog.forEach(function(entry, idx) {
            var entEl = el('div', { class: 'ai-thought-entry' });
            var roleLabel = entry.agent_role || 'AI';
            var roundLabel = entry.round ? ' · 第' + entry.round + '轮' : '';
            entEl.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + roundLabel + '</div><div class="ai-thought-chunk"></div>';
            entEl.querySelector('.ai-thought-chunk').textContent = String(entry.chunk || '').slice(0, 4000);
            thinkLogBox.appendChild(entEl);
          });
          var summaryEl = node.querySelector('.ai-think-thinking summary');
          if (summaryEl) {
            var sumSpan = summaryEl.querySelector('span:last-child');
            if (sumSpan) sumSpan.textContent = '查看思考过程 (' + mergedLog.length + ' 步)';
          }
        } else {
          // 没有思考过程, 隐藏 details
          var detailsEl = node.querySelector('.ai-think-thinking');
          if (detailsEl) detailsEl.style.display = 'none';
        }

        var footer = node.querySelector('.ai-msg-footer');
        if (footer) {
          footer.innerHTML = '';
          if (aiMsg.created_at) footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(aiMsg.created_at) }));
          // V2: 简洁模式标签, 去掉重复 sparkle
          footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: (finalThinkingMode || 'max') + ' 思考' }));
          // V2: 合并 agent 数, 避免与 header meta 重复
          if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
          if (usage || finalModel) {
            var usageLine = buildUsageLine(aiMsg.usage);
            if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
          }
        }

        // 标题 + 时间 (放 header)
        // Show search sources in think-card
        if (searchResults && searchResults.length > 0 && searchQuery) {
          var searchBox = document.createElement('div');
          searchBox.className = 'ai-search-supplement';
          var searchHtml = '🔍 搜索来源: <strong>' + escapeHtml(searchQuery) + '</strong> (' + searchResults.length + ' 条结果)<br>';
          var shownResults = searchResults.slice(0, 5);
          for (var si = 0; si < shownResults.length; si++) {
            var sr = shownResults[si];
            if (sr.title && sr.url) {
              searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(sr.url) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.title) + '</a><br>';
            } else if (sr.url) {
              searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(sr.url) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.url) + '</a><br>';
            }
          }
          if (searchResults.length > 5) {
            searchHtml += '<span style="font-size:10px;color:#999">... 还有 ' + (searchResults.length - 5) + ' 条来源</span>';
          }
          searchBox.innerHTML = searchHtml;
          var thinkBody = node.querySelector('.ai-think-body');
          if (thinkBody) {
            answerEl = node.querySelector('.ai-think-answer');
            if (answerEl) {
              thinkBody.insertBefore(searchBox, answerEl);
            } else {
              thinkBody.appendChild(searchBox);
            }
          }
        }

        var durationSec = Math.round(thinkDurationMs / 1000);
        var min = Math.floor(durationSec / 60);
        var sec = durationSec % 60;
        var durationStr = min > 0 ? (min + 'm ' + sec + 's') : (sec + 's');
        var titleEl = node.querySelector('.ai-think-title');
        var metaEl = node.querySelector('.ai-think-meta');
        // V2: 去掉重复 sparkle (footer 已有模式标签), header 只放纯文字"已思考 Xs"
        if (titleEl) titleEl.textContent = '已思考 ' + durationStr;
        // V2: 去掉重复 1 agent (footer 已有 agent-badge), header meta 留空
        if (metaEl) metaEl.textContent = '';

        // ★ Q: 完成后**自动展开**让用户直接看答案, 但思考过程仍可点击折叠
        if (node.classList.contains('collapsed')) {
          node.classList.remove('collapsed');
          node.classList.add('expanded');
          var chev = node.querySelector('.ai-think-chevron');
          if (chev) chev.textContent = '▴';
        }
      }
    }

    try {
      var resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: fetchBody,
        signal: controller.signal
      });

      if (!resp.ok) {
        try {
          var errJson = await resp.json().catch(function() { return {}; });
          if (S._currentReqId !== reqId) return;
          safeRemoveProgressCard()
          notify(String(errJson.error || ('AI 失败 (' + resp.status + ')')));
        } catch (e) {}
        resetSendingIfCurrent();
        return;
      }

      if (!resp.body) {
        safeRemoveProgressCard()
        notify('AI 没有响应');
        resetSendingIfCurrent();
        return;
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        if (S._currentReqId !== reqId || controller.signal.aborted) {
          aborted = true;
          if (reader) try { reader.cancel(); } catch (e) {}
          break;
        }
        var readResult;
        try { readResult = await reader.read(); } catch (e) { break; }
        if (readResult.done) break;
        if (!S.active) { reader.cancel().catch(function(){}); break; }

        buffer += decoder.decode(readResult.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line || !line.startsWith('data: ')) continue;
          var eventStr = line.slice(6);
          var evt;
          try { evt = JSON.parse(eventStr); } catch (e) { continue; }
          if (!evt) continue;

          if (S._currentReqId !== reqId) { aborted = true; break; }

          // 深度思考事件分流
          if (evt.type === 'meta') {
            streamConvId = evt.conversation_id;
            if (streamConvId) { S.conversationId = streamConvId; writeConvId(streamConvId); }
            continue;
          }
          if (evt.type === 'heartbeat') {
            updateDeepThinkProgressCard(progressCard, evt);
            continue;
          }
          if (evt.type === 'deep_think_stage' || evt.type === 'deep_think_planned' || evt.type === 'deep_think_worker' || evt.type === 'deep_think_tool' || evt.type === 'deep_think_init') {
            updateDeepThinkProgressCard(progressCard, evt);
            continue;
          }
          if (evt.type === 'thinking_chunk') {
            // Real thinking content arrived - create think-card, remove progress card
            if (!aiNode) ensureThinkCardNode();
            if (evt.chunk) {
              var thinkBody = aiNode.querySelector('.ai-think-thinking-body');
              var detailsEl = aiNode.querySelector('.ai-think-thinking');
              var summaryEl = aiNode.querySelector('.ai-think-thinking summary span:last-child');
              if (thinkBody) {
                var roleLabel = evt.agent_role || 'AI 智能体';
                var lastEntry = thinkBody.lastElementChild;
                var chunkText = String(evt.chunk).slice(0, 4000);
                if (lastEntry && lastEntry._role === roleLabel) {
                  var lastChunk = lastEntry.querySelector('.ai-thought-chunk');
                  if (lastChunk) lastChunk.textContent = (lastChunk.textContent || '') + chunkText;
                } else {
                  var entry = document.createElement('div');
                  entry.className = 'ai-thought-entry';
                  entry._role = roleLabel;
                  entry.innerHTML = '<div class="ai-thought-role">▸ ' + escapeHtml(roleLabel) + '</div><div class="ai-thought-chunk"></div>';
                  entry.querySelector('.ai-thought-chunk').textContent = chunkText;
                  thinkBody.appendChild(entry);
                }
                try { thinkBody.scrollTop = thinkBody.scrollHeight; } catch (e) {}
                while (thinkBody.children.length > 80) thinkBody.removeChild(thinkBody.firstChild);
              }
              if (summaryEl) {
                var entryCount = thinkBody ? thinkBody.children.length : 0;
                summaryEl.textContent = '查看思考过程 (' + entryCount + ' 步)';
              }
              if (detailsEl && !detailsEl.open) {
                detailsEl.open = true;
              }
              var titleEl = aiNode.querySelector('.ai-think-title');
              if (titleEl) titleEl.innerHTML = AI_THINK_ICON + ' 思考中…';
            }
            scrollToBottom(messagesEl, true);
            continue;
          }
          if (evt.type === 'answer_chunk') {
            // V2: 最终答案流式推送 - 立即实时渲染, 不等待 thinking 全部结束
            if (!evt.chunk) continue;
            if (!aiNode) ensureThinkCardNode();
            if (!answerStarted) {
              answerStarted = true;
              var tTitle = aiNode.querySelector('.ai-think-title');
              if (tTitle) tTitle.innerHTML = AI_THINK_ICON + ' 回答中…';
            }
            var aEl = aiNode.querySelector('.ai-think-answer');
            if (aEl && !answerRenderer) {
              aEl.innerHTML = '';
              answerRenderer = createSmoothTextRenderer(aEl, {
                minChunk: 4, maxChunk: 16
              });
            }
            aiContent += String(evt.chunk);
            if (answerRenderer) answerRenderer.append(evt.chunk);
            scrollToBottom(messagesEl, true);
            continue;
          }
          if (evt.type === 'content') {
            // 兜底: 非流式的最终 content 一次性到达
            aiContent += evt.text || '';
            ensureThinkCardNode();
            continue;
          }
          if (evt.type === 'error') {
            safeRemoveProgressCard()
            var errMsg = evt.error || 'AI 调用失败';
            if (aiContent) {
              ensureThinkCardNode();
              var errNote = el('div', { class: 'ai-error-note' }, errMsg);
              try { aiNode.appendChild(errNote); } catch (e) {}
              finishThinkCard(aiNode, aiContent, evt);
            } else {
              notify(errMsg);
              S.messages.pop();
              removeLastUserMessage(messagesEl);
              restoreInputText();
            }
            resetSendingIfCurrent();
            if (reader) try { reader.cancel(); } catch (e) {}
            aborted = true;
            break;
          }
          if (evt.type === 'done') {
            safeRemoveProgressCard()
            S.sending = false;
            S.paused = false;
            S.activeRenderers = [];
            S.abortController = null;
            S.deepThinkJob = null;
            S.deepThinkProgressCard = null;
            if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
            // ★ 标记 progress card done, 停止前端倒计时
            if (progressCard) { try { progressCard._done = true; } catch (e) {} }
            if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
            try {
              finalModel = evt.model || 'deepseek-v4-flash';
              // ★ P 改: 用 S.deepThinkEffort fallback, 不用写死 'max'
              finalThinkingMode = evt.thinking_mode || S.deepThinkEffort || 'max';
              if (evt.sanitized_content) aiContent = evt.sanitized_content;
              else if (evt.content) aiContent = evt.content;
              finalMeta = evt;
            } catch (e) {}
            if (!aiNode) ensureThinkCardNode();
            // 没有正文时给出兜底提示，避免 think-card 答案区空白
            if (!aiContent || !String(aiContent).trim()) {
              aiContent = '（AI 只返回了思考过程，没有生成正文回复）';
            }
            finishThinkCard(aiNode, aiContent, evt);
            doneReceived = true;
            evtHandled = true;
            break;
          }
        }
        if (doneReceived || aborted) break;
      }

      if (S._currentReqId !== reqId || aborted) {
        safeRemoveProgressCard()
        if (answerRenderer) { try { answerRenderer.cancel(); } catch (e) {} answerRenderer = null; }
        if (contentRenderer) { try { contentRenderer.cancel(); } catch (e) {} contentRenderer = null; }
        answerStarted = false;
        if (aiNode) try { aiNode.remove(); } catch (e) {}
        resetSendingIfCurrent();
        return;
      }

      safeRemoveProgressCard()
      if (progressCard) { try { progressCard._done = true; } catch (e) {} }
      if (evtHandled) {
        // already handled in done
      } else if (aiNode && aiContent) {
        finishThinkCard(aiNode, aiContent, finalMeta);
      } else if (!doneReceived) {
        // 流意外结束, 没有 done
        if (aiContent) {
          if (!aiNode) ensureThinkCardNode();
          finishThinkCard(aiNode, aiContent, finalMeta);
        } else {
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          notify('AI 暂时没有回应, 请稍后再试');
        }
      }
    } catch (fetchErr) {
      if (S._currentReqId !== reqId) return;
      safeRemoveProgressCard()
      if (progressCard) { try { progressCard._done = true; } catch (e) {} }
      if (fetchErr && fetchErr.name !== 'AbortError') {
        if (aiContent) {
          ensureThinkCardNode();
          var connNote = el('div', { class: 'ai-error-note' }, '连接中断, 已保留部分回复');
          try { aiNode.appendChild(connNote); } catch (e) {}
          finishThinkCard(aiNode, aiContent, finalMeta);
        } else {
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          notify('网络异常, 请检查连接后重试');
        }
      } else {
        // AbortError: 用户主动停止
        if (aiContent) {
          if (!aiNode) ensureThinkCardNode();
          finishThinkCard(aiNode, aiContent, finalMeta);
        } else {
          S.messages.pop();
          removeLastUserMessage(messagesEl);
        }
      }
    }
    resetSendingIfCurrent();
    if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
    updateInputMetrics();
    scrollToBottom(messagesEl, true);
  }

  async function handleSendMessage(input, sendBtn, messagesEl) {
    var text = String(input.value || '').trim();
    if (!text) { S.sending = false; return; }
    if (text.length > 6000) {
      notify('消息过长（最多 6000 字符），请精简后重试');
      S.sending = false;
      return;
    }

    // ★ M: 深度思考模式分支 — 走独立流程 (Planner→Workers→Synthesizer)
    if (S.deepThink) {
      return handleSendDeepThink(text, input, sendBtn, messagesEl);
    }

    var originalText = text;
    
    function restoreInputText() {
      input.value = originalText;
      input.style.height = 'auto';
      try {
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        if (!_isTouchMobile) input.focus();
      } catch (e) {}
      updateInputMetrics();
    }
    
    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) { S.sending = false; return; }
    
    // 如果有正在进行的请求，中断它
    if (S.sending) {
      abortCurrentRequest();
      try { await new Promise(function(resolve) { setTimeout(resolve, 100); }); } catch (e) {}
    }
    
    // 快速双击去重：同一秒内相同文本的请求忽略
    var msgDedupKey = text + Math.floor(Date.now() / 1000);
    if (S._lastMsgDedupKey === msgDedupKey) { S.sending = false; return; }
    S._lastMsgDedupKey = msgDedupKey;
    
    S.clientRequestId++;
    var reqId = 'cr_' + S.clientRequestId + '_' + Date.now();
    S._currentReqId = reqId;
    function resetSendingIfCurrent() {
      if (S._currentReqId === reqId) {
        S.sending = false;
        S.abortController = null;
        S.paused = false;
        S.activeRenderers = [];
        if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
      }
    }
    S.sending = true;
    if (S.pauseBtnEl) S.pauseBtnEl.style.display = '';
    clearReplyTimer();
    
    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: text, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);
    S.autoScrollPinned = true;
    scrollToBottom(messagesEl, true);
    
    var typingNode = buildTypingNode();
    messagesEl.appendChild(typingNode);
    scrollToBottom(messagesEl, true);
    
    // 清空输入框
    input.value = '';
    input.style.height = 'auto';
    updateInputMetrics();
    if (_isTouchMobile) {
      try { input.blur(); } catch (e2) {}
    } else {
      try { input.focus(); } catch (e2) {}
    }
    
    var aborted = false;
    
    // 创建 AbortController
    var controller = new AbortController();
    S.abortController = controller;
    S.currentStreamAborted = false;
    
    var url = API_BASE + '/chat/stream';
    var auth = await getUserAuthPayload({ forceNoToken: false });
    var headers = auth.headers || {};
    
    var fetchBody = JSON.stringify({
      message: text,
      conversation_id: S.conversationId,
      client_request_id: reqId
    });
    
    try {
      var resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: fetchBody,
        signal: controller.signal
      });
      
      if (!resp.ok) {
        try {
          var errJson = await resp.json().catch(function(){ return {}; });
          if (errJson && errJson.error) {
            if (S._currentReqId !== reqId) return;
            try { typingNode.remove(); } catch (e) {}
            notify(String(errJson.error));
          }
        } catch(e) {}
        resetSendingIfCurrent();
        return;
      }
      
      if (!resp.body) {
        try { typingNode.remove(); } catch (e) {}
        notify('AI 没有响应');
        resetSendingIfCurrent();
        return;
      }
      
      // 读取 SSE 流
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var aiContent = '';
      var aiReasoning = '';
      var reasoningStarted = false;
      var aiNode = null;
      var aiBubble = null;
      var reasoningContainer = null;
      var contentRenderer = null;
      var reasoningRenderer = null;
      var thinkingTimer = null;
      var thinkingStartedAt = 0;
      var finalThinkingElapsedMs = 0;
      var usageResult = null;
      var finalModel = '';
      var finalThinkingMode = '';
      var streamConvId = null;
      var doneReceived = false;
      var evtHandled = false;

      function finishAiMessage(node, content, thinking, evt) {
        if (thinkingTimer) {
          finalThinkingElapsedMs = finalThinkingElapsedMs || thinkingTimer.stop();
        }
        if (reasoningRenderer) reasoningRenderer.finish(thinking || '');

        // 判断是否有有效正文；没有时给出兜底提示，避免气泡完全空白
        var hasContent = !!(content && String(content).trim().length > 0);
        var hasThinking = !!(thinking && String(thinking).trim().length > 0);
        var fallbackText = hasThinking ? '（AI 只返回了思考过程，没有生成正文回复）' : '（AI 暂无回复，请重试）';

        if (contentRenderer) {
          if (hasContent) {
            contentRenderer.finish(content);
          } else {
            // 空内容时仍调用 finish，让渲染器内部兜底显示提示
            contentRenderer.finish(fallbackText);
          }
        }
        // 兜底: 无论渲染器状态如何, 直接往气泡写内容（保留 markdown 格式）
        if (aiBubble) {
          aiBubble.innerHTML = renderMarkdown(hasContent ? content : fallbackText);
        }
        cleanupRenderers();
        if (node) {
          node.classList.remove('generating');
        }
        if (aiBubble) {
          aiBubble.classList.remove('ai-typing');
          aiBubble.style.opacity = '1';
          aiBubble.style.display = 'block';
          aiBubble.style.visibility = 'visible';
          aiBubble.style.color = '#1f2937';
          aiBubble.style.fontSize = '14px';
        }
        setAiRootState('ai-idle');
        
        if (thinking && finalThinkingMode !== 'off') {
          var rNode = reasoningContainer || (node ? node.querySelector('.ai-thinking') : null);
          if (!rNode && node) {
            rNode = buildReasoningNode(thinking, messagesEl);
            node.insertBefore(rNode, node.firstChild);
          } else if (rNode) {
            var body = rNode.querySelector('.ai-thinking-body');
            if (body) body.textContent = thinking;
          }
          if (rNode) {
            setThinkingExpanded(rNode, !!rNode.classList.contains('expanded'), messagesEl);
            if (thinkingTimer) {
              thinkingTimer.syncFinal(finalThinkingElapsedMs);
            } else {
              setThinkingStatus(rNode, '已思考 ' + formatThinkingElapsed(finalThinkingElapsedMs));
            }
          }
        } else if (reasoningContainer) {
          if (thinkingTimer) thinkingTimer.cancel();
          try { reasoningContainer.remove(); } catch (e) {}
          reasoningContainer = null;
        }
        
        var searchCount = evt ? evt.search_count : 0;
        var searchQuery = evt ? evt.search_query : '';
        var searchResults = evt && Array.isArray(evt.search_results) ? evt.search_results : null;
        var searchExpiresAt = evt && typeof evt.search_expires_at === 'number' ? evt.search_expires_at : 0;
        var aiMsg = {
          role: 'assistant',
          content: content,
          reasoning: (finalThinkingMode !== 'off' ? thinking : ''),
          created_at: new Date().toISOString(),
          thinking_mode: finalThinkingMode,
          search_count: searchCount,
          search_query: searchQuery,
          search_results: searchResults,
          search_expires_at: searchExpiresAt,
          usage: Object.assign({}, usageResult || {}, {
            model: finalModel,
            thinking_mode: finalThinkingMode
          })
        };
        S.messages.push(aiMsg);
        
        if (node) {
          // 如果有搜索结果，把已有的搜索条移入消息节点（而非单独在 container 里）
          var liveSearchBar = null;
          if (searchCount > 0) {
            liveSearchBar = messagesEl.querySelector('.ai-search-status');
          }
          if (liveSearchBar) {
            node.appendChild(liveSearchBar);
          } else if (searchCount > 0) {
            // 没有直播搜索条（如历史重建），创建一个简版
            var sb = el('div', { class: 'ai-search-status', text: '已联网搜索 · ' + searchCount + ' 条结果' });
            var sq = searchQuery || '';
            if (sq) {
              var toggleBtn = el('span', { class: 'ai-search-toggle' }, ' ▶');
              sb.appendChild(toggleBtn);
              sb.style.cursor = 'pointer';
              var panel = el('div', { class: 'ai-search-detail', style: 'display:none;' });
              sb.appendChild(panel);
              panel.appendChild(el('div', { class: 'ai-search-detail-query', text: '搜索：' + sq }));
              sb.onclick = function(e) {
                if (e.target.tagName === 'A') return;
                var h = panel.style.display === 'none';
                panel.style.display = h ? '' : 'none';
                toggleBtn.textContent = h ? ' ▼' : ' ▶';
              };
            }
            node.appendChild(sb);
          }
          var footer = el('div', { class: 'ai-msg-footer' });
          if (aiMsg.created_at) footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(aiMsg.created_at) }));
          if (finalThinkingMode && finalThinkingMode !== 'off') {
            footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: '思考 ' + finalThinkingMode }));
          }
          if (usageResult || finalModel) {
            var usageLine = buildUsageLine(aiMsg.usage);
            if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
          }
          if (footer.children.length > 0) node.appendChild(footer);
        }
      }

      function cleanupRenderers() {
        if (thinkingTimer) {
          try { thinkingTimer.cancel(); } catch (e0) {}
          thinkingTimer = null;
        }
        if (contentRenderer) {
          try { contentRenderer.cancel(); } catch (e) {}
          contentRenderer = null;
        }
        if (reasoningRenderer) {
          try { reasoningRenderer.cancel(); } catch (e2) {}
          reasoningRenderer = null;
        }
        if (S.streamCleanup === cleanupRenderers) {
          S.streamCleanup = null;
        }
      }
      S.streamCleanup = cleanupRenderers;

      function ensureAssistantNode() {
        if (!aiNode) {
          try { typingNode.remove(); } catch (e) {}
          aiNode = el('div', { class: 'ai-msg assistant entering generating' });
          messagesEl.appendChild(aiNode);
          S.autoScrollPinned = true;
          scrollToBottom(messagesEl, true);
        }
        return aiNode;
      }

      function ensureReasoningNode() {
        ensureAssistantNode();
        if (!reasoningContainer) {
          reasoningContainer = aiNode.querySelector('.ai-thinking');
        }
        if (!reasoningContainer) {
          reasoningContainer = buildReasoningNode('思考中...', messagesEl);
          aiNode.insertBefore(reasoningContainer, aiNode.firstChild);
          setThinkingExpanded(reasoningContainer, true, messagesEl);
        }
        return reasoningContainer;
      }

      function ensureThinkingTimer() {
        var rn = ensureReasoningNode();
        if (!thinkingTimer) {
          thinkingTimer = createThinkingTimer(rn);
          thinkingStartedAt = Date.now();
          finalThinkingElapsedMs = 0;
          thinkingTimer.start();
        }
        return thinkingTimer;
      }

      function ensureAssistantBubble() {
        ensureAssistantNode();
        aiBubble = aiNode.querySelector('.ai-msg-bubble');
        if (!aiBubble) {
          aiBubble = el('div', { class: 'ai-msg-bubble ai-typing', text: '' });
          setupBubbleCopy(aiBubble, messagesEl);
          aiNode.appendChild(aiBubble);
        }
        if (!contentRenderer) {
          contentRenderer = createSmoothTextRenderer(aiBubble, {
            minChunk: 4,
            maxChunk: 16,
            streamClass: 'ai-streaming-soft',
            onRender: function() {
              scrollToBottom(messagesEl, false);
            }
          });
        }
        return aiBubble;
      }
      
      while (true) {
        if (S._currentReqId !== reqId || controller.signal.aborted) {
          aborted = true;
          if (reader) try { reader.cancel(); } catch (e) {}
          break;
        }
        
        var readResult;
        try { readResult = await reader.read(); } catch (e) { break; }
        if (readResult.done) break;
        if (!S.active) { reader.cancel().catch(function(){}); break; }
        
        buffer += decoder.decode(readResult.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line || !line.startsWith('data: ')) continue;
          
          var eventStr = line.slice(6);
          var evt;
          try { evt = JSON.parse(eventStr); } catch (e) { continue; }
          if (!evt) continue;
          
          // 检查是否被新请求取代
          if (S._currentReqId !== reqId) { aborted = true; break; }
          
          if (evt.type === 'meta') {
            streamConvId = evt.conversation_id;
            if (streamConvId) {
              S.conversationId = streamConvId;
              writeConvId(streamConvId);
            }
            continue;
          }
          
          if (evt.type === 'multi_agent') {
            var maStatus = messagesEl.querySelector('.ai-search-status');
            if (!maStatus) {
              maStatus = el('div', { class: 'ai-search-status' });
              if (aiNode && aiNode.parentElement) aiNode.parentElement.insertBefore(maStatus, aiNode);
            }
            if (evt.action === 'searching') {
              var qs = evt.queries || [];
              maStatus.textContent = '🧠 多Agent协作：正在并行搜索 ' + qs.join('、');
            }
          }

          // 思考后补充搜索：重置内容状态以接收新一轮 stream，保留已显示的思考过程
          if (evt.type === 'search_supplement') {
            var searchNote = el('div', { class: 'ai-search-supplement', text: '🔍 正在联网补充信息...' });
            if (aiNode && aiNode.parentElement) aiNode.parentElement.appendChild(searchNote);
            // 清空旧内容，让第二轮 stream 重新生成
            cleanupRenderers();
            try { typingNode.remove(); } catch (e) {}
            if (aiBubble) try { aiBubble.innerHTML = ''; } catch (e) {}
            aiContent = '';
            aiReasoning = '';
            reasoningStarted = false;
            doneReceived = false;
            finalThinkingElapsedMs = 0;
            finalThinkingMode = null;
            continue;
          }

          if (evt.type === 'search') {
            // 显示搜索状态条
            var searchCount = evt.count;
            var searchDiag = evt.diagnostics;
            var searchBar = messagesEl.querySelector('.ai-search-status');
            if (!searchBar) {
              searchBar = el('div', { class: 'ai-search-status' });
              messagesEl.appendChild(searchBar);
            }
            var summaryText = '';
            if (searchCount > 0) {
              summaryText = '已联网搜索 · ' + searchCount + ' 条结果';
            } else {
              summaryText = '联网搜索完成 · 没有找到相关结果';
            }
            // 显示使用的 provider
            if (searchDiag && searchDiag.provider_results && searchDiag.provider_results.length) {
              var firstProv = searchDiag.provider_results[0];
              if (firstProv && firstProv.provider) {
                summaryText += ' (' + firstProv.provider + ')';
              }
            }
            // 清空并重建（避免重复 append）
            searchBar.innerHTML = '';
            searchBar.textContent = summaryText;
            var resultsArr = evt.results;
            var queryStr = evt.query || '';
            if (resultsArr && resultsArr.length > 0) {
              var toggleBtn = el('span', { class: 'ai-search-toggle' }, ' ▶');
              searchBar.appendChild(toggleBtn);
              searchBar.style.cursor = 'pointer';
              var detailPanel = el('div', { class: 'ai-search-detail', style: 'display:none;' });
              searchBar.appendChild(detailPanel);
              // 显示搜索关键词
              if (queryStr) {
                detailPanel.appendChild(el('div', { class: 'ai-search-detail-query', text: '搜索：' + queryStr }));
              }
              // 列表
              for (var ri = 0; ri < resultsArr.length; ri++) {
                var r = resultsArr[ri];
                var itemEl = el('div', { class: 'ai-search-detail-item' });
                var linkEl = el('a', { class: 'ai-search-detail-title', href: r.url || '#', target: '_blank', rel: 'noopener noreferrer', text: r.title || '无标题' });
                itemEl.appendChild(linkEl);
                if (r.snippet) {
                  itemEl.appendChild(el('div', { class: 'ai-search-detail-snippet', text: r.snippet.slice(0, 200) }));
                }
                itemEl.appendChild(el('div', { class: 'ai-search-detail-source', text: (r.source || '') + ' · ' + (r.published_at || '') }));
                detailPanel.appendChild(itemEl);
              }
              searchBar.toggleFn = function() {
                var isHidden = detailPanel.style.display === 'none';
                detailPanel.style.display = isHidden ? '' : 'none';
                toggleBtn.textContent = isHidden ? ' ▼' : ' ▶';
              };
              searchBar.onclick = function(e) {
                if (e.target.tagName === 'A') return;
                if (this.toggleFn) this.toggleFn();
              };
            }
            continue;
          }
          
          if (evt.type === 'search_error') {
            var searchDiag2 = evt.diagnostics;
            var searchBar2 = messagesEl.querySelector('.ai-search-status');
            if (!searchBar2) {
              searchBar2 = el('div', { class: 'ai-search-status' });
              messagesEl.appendChild(searchBar2);
            }
            searchBar2.textContent = evt.error || '联网搜索失败';
            // 显示详细失败原因（可展开）
            if (searchDiag2) {
              var errorDetail = el('div', { style: 'font-size:10px;color:#999;margin-top:2px;max-height:60px;overflow:hidden;text-overflow:ellipsis;line-height:1.3;' });
              if (searchDiag2.provider_errors && searchDiag2.provider_errors.length) {
                errorDetail.textContent = searchDiag2.provider_errors.map(function(pe) {
                  var shortErr = (pe.error || '').slice(0, 60);
                  return pe.provider + ': ' + shortErr;
                }).join(' | ');
              } else if (searchDiag2.missing_env && searchDiag2.missing_env.length) {
                errorDetail.textContent = '未配置: ' + searchDiag2.missing_env.join(', ');
              }
              if (errorDetail.textContent) searchBar2.appendChild(errorDetail);
            }
            continue;
          }
          
          if (evt.type === 'tool_calls') {
            var toolList = evt.tools || [];
            var toolDesc = toolList.map(function(t) {
              var nameMap = { search_web: '联网搜索', get_weather: '查询天气', get_current_time: '获取时间' };
              var label = nameMap[t.name] || t.name;
              if (t.args && t.args.query) return label + ' "' + t.args.query + '"';
              if (t.args && t.args.location) return label + ' ' + t.args.location;
              return label;
            }).join('、');
            var toolBar = messagesEl.querySelector('.ai-tool-status');
            if (!toolBar) {
              toolBar = el('div', { class: 'ai-tool-status' });
              messagesEl.appendChild(toolBar);
            }
            toolBar.textContent = 'AI 正在使用：' + toolDesc;
            continue;
          }
          
          if (evt.type === 'tool_result') {
            var toolBar2 = messagesEl.querySelector('.ai-tool-status');
            if (!toolBar2) {
              toolBar2 = el('div', { class: 'ai-tool-status' });
              messagesEl.appendChild(toolBar2);
            }
            var nameMap = { search_web: '已联网搜索', get_weather: '已查询天气', get_current_time: '已获取时间' };
            var label = nameMap[evt.tool_name] || evt.tool_name;
            var summaryText = '';
            if (evt.success) {
              if (evt.count > 0) {
                summaryText = label + ' · ' + evt.count + ' 条结果' + (evt.location ? ' · ' + evt.location : '');
              } else {
                summaryText = label + ' · 完成' + (evt.location ? ' · ' + evt.location : '');
              }
            } else {
              summaryText = label + ' · 失败' + (evt.error ? ': ' + evt.error.slice(0, 80) : '');
            }
            toolBar2.innerHTML = '';
            toolBar2.textContent = summaryText;
            var itemsArr = evt.items;
            var queryStr2 = evt.query || '';
            if (itemsArr && itemsArr.length > 0) {
              var toggleBtn2 = el('span', { class: 'ai-search-toggle' }, ' ▶');
              toolBar2.appendChild(toggleBtn2);
              toolBar2.style.cursor = 'pointer';
              var detailPanel2 = el('div', { class: 'ai-search-detail', style: 'display:none;' });
              toolBar2.appendChild(detailPanel2);
              if (queryStr2) {
                detailPanel2.appendChild(el('div', { class: 'ai-search-detail-query', text: '搜索：' + queryStr2 }));
              }
              for (var ri2 = 0; ri2 < itemsArr.length; ri2++) {
                var r2 = itemsArr[ri2];
                var itemEl2 = el('div', { class: 'ai-search-detail-item' });
                var linkEl2 = el('a', { class: 'ai-search-detail-title', href: r2.url || '#', target: '_blank', text: r2.title || '无标题' });
                itemEl2.appendChild(linkEl2);
                if (r2.snippet) {
                  itemEl2.appendChild(el('div', { class: 'ai-search-detail-snippet', text: r2.snippet.slice(0, 200) }));
                }
                itemEl2.appendChild(el('div', { class: 'ai-search-detail-source', text: (r2.source || '') + ' · ' + (r2.published_at || '') }));
                detailPanel2.appendChild(itemEl2);
              }
              toolBar2.toggleFn = function() {
                var isHidden = detailPanel2.style.display === 'none';
                detailPanel2.style.display = isHidden ? '' : 'none';
                toggleBtn2.textContent = isHidden ? ' ▼' : ' ▶';
              };
              toolBar2.onclick = function(e) {
                if (e.target.tagName === 'A') return;
                if (this.toggleFn) this.toggleFn();
              };
            }
            continue;
          }
          
          if (evt.type === 'error') {
            try { typingNode.remove(); } catch (e) {}
            var errMsg = evt.error || 'AI 调用失败';
            
            if (aiContent) {
              // 已有部分回复，保留内容并追加错误提示
              var errNote = el('div', { class: 'ai-error-note' }, errMsg);
              try { aiNode.appendChild(errNote); } catch (e) {}
              ensureAssistantBubble();
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else {
              // 没有内容，回滚
              notify(errMsg);
              S.messages.pop();
              removeLastUserMessage(messagesEl);
              restoreInputText();
            }
            
            resetSendingIfCurrent();
            if (reader) try { reader.cancel(); } catch (e) {}
            aborted = true;
            break;
          }
          
          // 兼容旧错误格式（无 type 但有 error）
          if (evt.error && !evt.type) {
            try { typingNode.remove(); } catch (e) {}
            var errMsg2 = evt.error || 'AI 调用失败';
            
            if (aiContent) {
              var errNote2 = el('div', { class: 'ai-error-note' }, errMsg2);
              try { aiNode.appendChild(errNote2); } catch (e) {}
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else {
              notify(errMsg2);
              restoreInputText();
            }
            
            resetSendingIfCurrent();
            if (reader) try { reader.cancel(); } catch (e) {}
            aborted = true;
            break;
          }
          
          if (evt.type === 'reasoning_start' && !reasoningStarted) {
            reasoningStarted = true;
            ensureReasoningNode();
            ensureThinkingTimer();
            continue;
          }
          
          if (evt.type === 'reasoning') {
            aiReasoning += evt.text || '';
            // 如果 reasoning_start 事件丢失，首次收到 reasoning 也启动计时器
            if (!reasoningStarted) {
              reasoningStarted = true;
              ensureReasoningNode();
              ensureThinkingTimer();
            }
            var rn = ensureReasoningNode();
            var body = rn.querySelector('.ai-thinking-body');
            if (body) {
              if (!reasoningRenderer) {
                body.textContent = '';
                reasoningRenderer = createSmoothTextRenderer(body, {
                minChunk: 4,
                maxChunk: 16,
                onRender: function() {
                  if (rn.classList.contains('expanded')) scrollToBottom(messagesEl, false);
                }
              });
              }
              reasoningRenderer.append(evt.text || '');
            }
            continue;
          }
          
          if (evt.type === 'content') {
            aiContent += evt.text || '';
            ensureAssistantBubble();
            if (contentRenderer) contentRenderer.append(evt.text || '');
            continue;
          }
          
          if (evt.type === 'done') {
            try { typingNode.remove(); } catch (e) {}
            S.sending = false;
            S.paused = false;
            S.activeRenderers = [];
            S.abortController = null;
            if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
            if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
            if (thinkingTimer) {
              finalThinkingElapsedMs = thinkingTimer.stop();
            }
            
            // 更新 usage / done 数据
            try {
              usageResult = evt.usage || null;
              finalModel = evt.model || '';
              finalThinkingMode = evt.thinking_mode || S.thinkingMode;
              // sanitized_content 优先：后端清洗后的正文
              if (evt.sanitized_content) {
                aiContent = evt.sanitized_content;
              } else if (evt.content) {
                aiContent = evt.content;
              }
            } catch (e) {}
            
            // 如果后端做了清洗，替换已流式输出的气泡内容
            if (evt.sanitized_content && evt.sanitized_content.length > 0 && aiBubble) {
              // 替换气泡中已输出的原始内容为清洗后正文
              if (contentRenderer) {
                try { contentRenderer.cancel(); } catch (e) {}
                contentRenderer = null;
              }
              aiBubble.innerHTML = '';
              aiBubble.innerHTML = renderMarkdown(evt.sanitized_content);
            }
            
            // 标记流是否完成
            var streamInterrupted = evt.interrupted === true;
            var streamComplete = evt.complete === true;
            var streamSaved = evt.saved === true;
            
            if (aiContent) {
              ensureAssistantBubble();
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else if (aiReasoning) {
              if (!aiNode) ensureReasoningNode();
              finishAiMessage(aiNode, '', aiReasoning, evt);
            }
            
            // 中断/未保存提示
            if (streamInterrupted && aiContent) {
              var interrNote = el('div', { class: 'ai-interrupt-note' }, '回复中断，内容可能不完整');
              if (aiNode) aiNode.appendChild(interrNote);
            }
            if (!streamSaved && aiContent) {
              var saveNote = el('div', { class: 'ai-save-note' }, '本次回复未保存，刷新后可能丢失');
              if (aiNode) aiNode.appendChild(saveNote);
            }
            
            // 显示清洗提示
            if (evt.filtered && aiContent) {
              var filteredNote = el('div', { class: 'ai-filtered-note' }, '已自动清理动作描写');
              if (aiNode) aiNode.appendChild(filteredNote);
            }
            
            doneReceived = true;
            evtHandled = true;
            break;
          }
        }
        
        if (doneReceived || aborted) break;
      }
      
      if (S._currentReqId !== reqId || aborted) {
        // 被新请求取代，删除当前创建的任何节点
        cleanupRenderers();
        if (aiNode) try { aiNode.remove(); } catch (e) {}
        try { typingNode.remove(); } catch (e) {}
        resetSendingIfCurrent();
        return;
      }
      
      // 完成处理
      try { typingNode.remove(); } catch (e) {}
      
      if (evtHandled) {
        // 已在 done/error 事件中完成渲染
      } else if (aiNode && (aiContent || aiReasoning)) {
        finishAiMessage(aiNode, aiContent, aiReasoning, null);
      } else if (doneReceived) {
        cleanupRenderers();
      } else if (!doneReceived) {
        cleanupRenderers();
        S.messages.pop();
        removeLastUserMessage(messagesEl);
        notify('AI 暂时没有回应，请稍后再试');
      }
    } catch (fetchErr) {
      if (S._currentReqId !== reqId) return;
      // 网络错误或 abort
      if (fetchErr && fetchErr.name !== 'AbortError') {
        try { typingNode.remove(); } catch (e) {}
        if (aiContent) {
          // 已有部分回复，保留并提示连接中断
          var connNote = el('div', { class: 'ai-error-note' }, '连接中断，已保留部分回复');
          try { aiNode.appendChild(connNote); } catch (e) {}
          finishAiMessage(aiNode, aiContent, aiReasoning, null);
        } else {
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          notify('网络异常，请检查连接后重试');
        }
      } else {
        // AbortError: 用户主动停止
        if (aiContent) {
          finishAiMessage(aiNode, aiContent, aiReasoning, null);
        } else {
          try { typingNode.remove(); } catch (e) {}
          S.messages.pop();
          removeLastUserMessage(messagesEl);
        }
      }
    }
    
    resetSendingIfCurrent();
    if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
    updateInputMetrics();
    scrollToBottom(messagesEl, true);
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
        appendEmptyState(messagesEl);
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
        var frag = document.createDocumentFragment();
        for (var mi = 0; mi < msgs.length; mi++) {
          frag.appendChild(buildMessageNode(msgs[mi], messagesEl));
        }
        messagesEl.insertBefore(frag, messagesEl.firstChild);
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

  // 获取会话列表
  async function fetchConversations() {
    try {
      var r = await apiRequest('GET', '/chat/conversations?limit=50');
      if (r && r.ok && r.data && Array.isArray(r.data.conversations)) {
        S.conversations = r.data.conversations;
      }
    } catch (e) {
      try { console.warn('[AI-CONV] fetchConversations error:', e && e.message); } catch(ee) {}
    }
  }
  
  // 切换会话
  function renderConversationListStyled(container) {
    container.innerHTML = '';
    if (!S.conversations.length) {
      container.appendChild(el('div', { class: 'ai-no-history', text: '暂无聊天记录' }));
      return;
    }
    var groups = {};
    var ordered = [];
    S.conversations.forEach(function(conv) {
      var key = getConversationGroupLabel(conv.updated_at || conv.created_at || '');
      if (!groups[key]) {
        groups[key] = [];
        ordered.push(key);
      }
      groups[key].push(conv);
    });
    ordered.forEach(function(groupLabel) {
      var section = el('section', { class: 'ai-conv-group' });
      section.appendChild(el('div', { class: 'ai-conv-group-title', text: groupLabel }));
      (groups[groupLabel] || []).forEach(function(conv) {
        var item = el('button', {
          type: 'button',
          class: 'ai-conv-item' + (conv.conversation_id === S.conversationId ? ' active' : ''),
          'data-conv-id': conv.conversation_id
        });
        item.appendChild(el('div', { class: 'ai-conv-title', text: conv.title || '新对话' }));
        item.appendChild(el('div', { class: 'ai-conv-time', text: conv.updated_at ? fmtTime(conv.updated_at) : '' }));
        item.appendChild(el('div', { class: 'ai-conv-preview', text: getConversationPreview(conv) }));
        var meta = el('div', { class: 'ai-conv-meta' });
        meta.appendChild(el('span', { class: 'ai-conv-count', text: getConversationCountText(conv) }));
        // 删除按钮
        var delBtn = el('span', { class: 'ai-conv-del', title: '删除此对话', 'aria-label': '删除对话' }, '✕');
        (function(cid, elRef) {
          delBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            if (!confirm('确定删除此对话吗？删除后不可恢复。')) return;
            deleteConversation(cid, elRef);
          });
        })(conv.conversation_id, item);
        meta.appendChild(delBtn);
        item.appendChild(meta);
        item.addEventListener('click', function() {
          if (S.sending) return;
          var cid = this.getAttribute('data-conv-id');
          switchConversation(cid);
        });
        section.appendChild(item);
      });
      container.appendChild(section);
    });
  }

  async function deleteConversation(cid, itemEl) {
    if (!cid) return;
    try {
      var r = await apiRequest('POST', '/chat/delete', { conversation_id: cid });
      if (r && r.ok) {
        if (itemEl && itemEl.parentElement) itemEl.remove();
        // 从 S.conversations 中移除
        S.conversations = (S.conversations || []).filter(function(c) { return c.conversation_id !== cid; });
        // 如果删除的是当前对话，重置
        if (cid === S.conversationId) {
          S.conversationId = null;
          S.messages = [];
          S.oldestCursor = null;
          S.hasMore = false;
          if (S.messagesEl) S.messagesEl.innerHTML = '';
          setAiRootState('ai-empty');
        }
        showConversationList();
      } else {
        notify('删除失败');
      }
    } catch (e) {
      notify('删除失败');
    }
  }

  async function switchConversation(cid) {
    if (!cid || cid === S.conversationId) return;
    if (S.sending) {
      abortCurrentRequest();
      await new Promise(function(resolve) { setTimeout(resolve, 100); });
    }
    
    S.conversationId = cid;
    writeConvId(cid);
    S.messages = [];
    S.oldestCursor = null;
    S.hasMore = false;
    if (S.messagesEl) S.messagesEl.innerHTML = '';
    setAiRootState('ai-loading');
    
    try {
      var r = await apiRequest('GET', '/chat/history?conversation_id=' + encodeURIComponent(cid) + '&limit=' + HISTORY_PAGE_SIZE);
      if (r && r.ok && r.data && r.data.messages) {
        S.messages = r.data.messages;
        S.hasMore = r.data.has_more;
        S.oldestCursor = r.data.oldest || null;
      }
    } catch (e) {
      try { console.warn('[AI-CONV] switchConversation error:', e && e.message); } catch(ee) {}
      notify('加载对话历史失败');
    }
    
    if (S.messagesEl) {
      S.messagesEl.innerHTML = '';
      if (S.messages.length) {
        S.messages.forEach(function(msg) {
          appendMessage(S.messagesEl, msg);
        });
      } else {
        appendEmptyState(S.messagesEl);
      }
      scrollToBottom(S.messagesEl, true);
    }
    setAiRootState('ai-idle');
    showChatMessages();
  }
  
function showChatMessages() {
    if (S.conversationsEl) S.conversationsEl.style.display = 'none';
    if (S.messagesEl) S.messagesEl.style.display = '';
    var infoBar = document.getElementById('aiChatHistoryInfo');
    if (infoBar) infoBar.style.display = 'none';
    var inputBar = document.getElementById('aiChatInputBar');
    if (inputBar) inputBar.style.display = '';
    S.showingHistory = false;
    var root = getAiRoot();
    if (root) root.classList.remove('showing-history');
  }
  
  function showConversationList() {
    if (S.messagesEl) S.messagesEl.style.display = 'none';
    if (S.conversationsEl) {
      S.conversationsEl.style.display = '';
      renderConversationListStyled(S.conversationsEl);
    }
    var infoBar = document.getElementById('aiChatHistoryInfo');
    if (infoBar) infoBar.style.display = '';
    var inputBar = document.getElementById('aiChatInputBar');
    if (inputBar) inputBar.style.display = 'none';
    S.showingHistory = true;
    var root = getAiRoot();
    if (root) root.classList.add('showing-history');
  }

  function renderAiRoot() {
    var old = document.getElementById('aiChatRoot');
    if (old) {
      if (S.statusTimer) { try { clearInterval(S.statusTimer); } catch (e) {} S.statusTimer = null; }
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
    renderHeaderAvatar(avatarEl, S.config && S.config.avatar_url, S.config && S.config.avatar_version);
    header.appendChild(avatarEl);

    var info = el('div', { class: 'ai-chat-header-info' });
    info.appendChild(el('div', { class: 'ai-chat-header-name', id: 'aiChatHeaderName', text: '徐旭泽的小猫' }));
    info.appendChild(el('div', { class: 'ai-chat-header-status', id: 'aiChatHeaderStatus', text: getAiStatusText() }));
    header.appendChild(info);

    // 深度思考 toggle 按钮 (M: 在历史按钮左边)
    var deepThinkBtn = el('button', {
      type: 'button',
      class: 'ai-deep-think-toggle' + (S.deepThink ? ' on' : ''),
      'aria-label': '深度思考模式',
      title: '深度思考模式 — AI 会深度分析后再回答, 耗时较长但更准确',
      id: 'aiDeepThinkToggle'
    });
    var dtIcon = el('span', { class: 'ai-deep-think-icon' });
    dtIcon.innerHTML = AI_THINK_ICON;
    deepThinkBtn.appendChild(dtIcon);
    deepThinkBtn.appendChild(el('span', { class: 'ai-deep-think-label', text: '深度思考' }));
    deepThinkBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleDeepThink();
    });
    header.appendChild(deepThinkBtn);

    // 历史会话按钮
    var histBtn = el('button', {
      type: 'button', class: 'ai-chat-hist-btn', 'aria-label': '历史会话',
      title: '历史会话'
    }, '历史对话');
    histBtn.addEventListener('click', function() {
      if (S.showingHistory) {
        showChatMessages();
        syncAiHeaderButtons(histBtn, newBtn);
      } else {
        fetchConversations().then(function() {
          showConversationList();
          syncAiHeaderButtons(histBtn, newBtn);
        });
      }
    });
    header.appendChild(histBtn);




    // 删除当前对话按钮
    var delBtn = el('button', {
      type: 'button',
      class: 'ai-chat-del-btn',
      'aria-label': '删除当前对话',
      title: '删除当前对话'
    }, '删除');
    delBtn.addEventListener('click', async function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!S.conversationId) return;
      if (!confirm('确定删除当前对话吗？删除后不可恢复。')) return;
      delBtn.disabled = true;
      try {
        var dr = await apiRequest('POST', '/chat/delete', { conversation_id: S.conversationId });
        if (dr && dr.ok) {
          S.messages = [];
          S.oldestCursor = null;
          S.hasMore = false;
          S.conversationId = null;
          if (S.messagesEl) S.messagesEl.innerHTML = '';
          setAiRootState('ai-empty');
          // 开启新对话
          var r2 = await apiRequest('POST', '/chat/new', null);
          if (r2 && r2.ok && r2.data && r2.data.conversation_id) {
            S.conversationId = r2.data.conversation_id;
            writeConvId(r2.data.conversation_id);
            // 恢复 empty state（先清 loading 再追加）
            if (S.messagesEl) {
              S.messagesEl.innerHTML = '';
              if (typeof appendEmptyState === 'function') appendEmptyState(S.messagesEl);
            }
          } else {
            if (S.messagesEl) {
              S.messagesEl.innerHTML = '';
              if (typeof appendEmptyState === 'function') appendEmptyState(S.messagesEl);
            }
          }
        } else {
          notify('删除失败');
        }
      } catch (e) {
        notify('删除失败');
      } finally {
        delBtn.disabled = false;
      }
    });

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
            appendEmptyState(S.messagesEl);
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
    header.insertBefore(delBtn, newBtn);
    if (S.headerButtonsCleanup) {
      try { S.headerButtonsCleanup(); } catch (eCleanup) {}
    }
    S.headerButtonsCleanup = bindAiHeaderButtons(histBtn, newBtn);
    root.appendChild(header);

    var messagesEl = el('div', { class: 'ai-chat-messages', id: 'aiChatMessagesArea' });
    messagesEl.addEventListener('scroll', function() {
      S.autoScrollPinned = isNearBottom(messagesEl, 84);
      if (messagesEl.scrollTop < 60 && S.hasMore && !S.loading && !S.loadingMore && S.oldestCursor) {
        loadHistory(messagesEl, S.oldestCursor);
      }
    });
    root.appendChild(messagesEl);

    // 历史会话提示栏
    var histInfo = el('div', { id: 'aiChatHistoryInfo', style: 'display:none;padding:8px 12px;font-size:12px;color:#666;text-align:center;border-bottom:1px solid var(--border,rgba(140,196,158,0.30))' });
    histInfo.textContent = '点击下方会话继续聊天';
    histInfo.className = 'ai-chat-history-info';
    histInfo.style.cssText = 'display:none';
    root.appendChild(histInfo);
    
    // 会话列表
    var convList = el('div', { class: 'ai-conversation-list', style: 'display:none' });
    root.appendChild(convList);
    S.conversationsEl = convList;

    var inputBar = el('div', { class: 'ai-chat-input-bar' });
    inputBar.id = 'aiChatInputBar';
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
    var pauseBtn = el('button', {
      type: 'button',
      class: 'ai-chat-pause',
      id: 'aiChatPauseBtn',
      'aria-label': '暂停',
      style: 'display:none'
    }, '暂停');

    function autoresize() {
      try {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      } catch (e) {}
      updateInputMetrics();
    }

    function doSend() {
      // 移动端先收起键盘再发送，避免 viewport 闪烁
      if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
      handleSendMessage(input, sendBtn, messagesEl);
    }

    sendBtn.addEventListener('click', doSend);
    pauseBtn.addEventListener('click', function() {
      if (!S.sending) return;
      if (!S.activeRenderers || S.activeRenderers.length === 0) return;
      var anyPaused = S.activeRenderers.some(function(r) { return r.isPaused && r.isPaused(); });
      if (anyPaused) {
        S.activeRenderers.forEach(function(r) { if (r.resume) r.resume(); });
        S.paused = false;
        pauseBtn.textContent = '暂停';
      } else {
        S.activeRenderers.forEach(function(r) { if (r.pause) r.pause(); });
        S.paused = true;
        // 只暂停前端渲染, 不kill SSE, resume后继续看积累的内容
        pauseBtn.textContent = '继续';
      }
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        doSend();
      }
    });
    input.addEventListener('input', autoresize);

    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    inputBar.appendChild(pauseBtn);
    root.appendChild(inputBar);

    S.resizeTimer = setTimeout(autoresize, 0);

    // ★ M: 渲染后立刻同步深度思考 toggle 视觉
    refreshDeepThinkToggle();

    S.pauseBtnEl = pauseBtn;
    return {
      root: root,
      messagesEl: messagesEl,
      inputBar: inputBar,
      input: input,
      sendBtn: sendBtn,
      pauseBtn: pauseBtn
    };
  }

  async function openAiChat() {
    if (S.active) return;
    if (!window.currentUser) {
      notify('请先登录后再和徐旭泽的小猫聊天');
      return;
    }
    // ★ M: 恢复深度思考模式状态
    restoreDeepThinkState();
    S.active = true;
    window.__xtjAiChatActive = true;
    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) {
      S.active = false;
      window.__xtjAiChatActive = false;
      return;
    }

    S.autoScrollPinned = true;

    if (typeof window.switchDockTab === 'function') {
      try { window.switchDockTab('chat', true); } catch (e) {}
    }

    var listView = document.getElementById('dockChatListView');
    var detailView = document.getElementById('dockChatDetailView');
    var panelChat = document.getElementById('panelChat');
    if (listView) listView.classList.add('hidden');
    if (detailView) {
      detailView.classList.remove('hidden');
      detailView.classList.add('ai-mode');
      // 清理原有的聊天内容，避免与AI根节点冲突
      var oldMsg = document.getElementById('dockChatMessages');
      if (oldMsg) oldMsg.style.display = 'none';
    }
    if (panelChat) panelChat.classList.add('ai-mode');

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
    S.viewportCleanup = bindVisualViewport(r.messagesEl, r.input, r.inputBar);

    S.conversationId = readConvId();

    try {
      var cfg = await ensureConfig();
      applyConfigToUI(cfg);
    } catch (e4) {}

    await loadHistory(r.messagesEl, null);

    // fallback: localStorage 的 convId 无效（没有历史消息），尝试加载最近会话
    if (!S.messages.length && S.conversationId) {
      try {
        var convR = await apiRequest('GET', '/chat/conversations?limit=1');
        if (convR && convR.ok && convR.data && convR.data.conversations && convR.data.conversations.length) {
          var recent = convR.data.conversations[0];
          if (recent && recent.conversation_id && recent.conversation_id !== S.conversationId) {
            S.conversationId = recent.conversation_id;
            writeConvId(recent.conversation_id);
            await loadHistory(r.messagesEl, null);
          }
        }
      } catch (e5) {}
    }

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
    if (avatarEl) renderHeaderAvatar(avatarEl, cfg.avatar_url, cfg.avatar_version);
    if (nameEl) nameEl.textContent = cfg.name || '徐旭泽的小猫';
    updateAiStatus();

    var inp = document.getElementById('aiChatMsgInput');
    if (inp) inp.placeholder = '和' + (cfg.name || '徐旭泽的小猫') + '说点什么吧…';

    var empty = document.querySelector('#aiChatRoot .ai-chat-empty');
    if (empty) {
      var e1 = empty.querySelector('.ai-chat-empty-emoji');
      if (e1) renderCatAvatarNode(e1, 'ai-chat-empty-avatar', S.config && S.config.avatar_url, S.config && S.config.avatar_version);
      var e2 = empty.querySelector('.ai-chat-empty-title');
      if (e2) e2.textContent = '和 ' + (cfg.name || '徐旭泽的小猫') + ' 聊聊天';
      var e3 = empty.querySelector('.ai-chat-empty-tip');
      if (e3) e3.textContent = cfg.welcome_message || '喵，来聊天吧。';
    }

    // ★ P 新增: 同步后端深度思考子配置 (思考程度 + 启用开关)
    try {
      if (cfg.deep_think) {
        if (['low', 'medium', 'high', 'max'].indexOf(cfg.deep_think.default_thinking_mode) >= 0) {
          S.deepThinkEffort = cfg.deep_think.default_thinking_mode;
        }
        S.deepThinkEnabled = cfg.deep_think.enabled !== false;
      }
      // 普通聊天的 thinkingMode 也同步 (从 model.default_thinking_mode 读)
      if (cfg.model && ['low', 'medium', 'high', 'max', 'off'].indexOf(cfg.model.default_thinking_mode) >= 0) {
        S.thinkingMode = cfg.model.default_thinking_mode;
      }
    } catch (e) { /* 容错 */ }

    // ★ P 新增: 如果后端禁用了深度思考, 强制关闭 toggle
    if (!S.deepThinkEnabled && S.deepThink) {
    S.deepThink = false;
    try { localStorage.setItem('xtj_ai_deep_think', '0'); } catch (e) {}
      try { localStorage.setItem('xtj_ai_deep_think', '0'); } catch (e) {}
      try { refreshDeepThinkToggle(); } catch (e) {}
    }
  }

  function closeAiChat() {
    if (!S.active) return;
    S.active = false;
    window.__xtjAiChatActive = false;
    clearReplyTimer();
    abortCurrentRequest(); // 内部已调用 clearStreamCleanup
    // Clean up deep think state
    if (S.deepThinkProgressCard) {
      try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e) {}
    }
    S.deepThink = false;
    S.deepThinkJob = null;
    S.deepThinkProgressCard = null;
    // 重置所有状态，避免重开后残留
    S.sending = false;
    S.paused = false;
    S.activeRenderers = [];
    if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
    S.messages = [];
    S.oldestCursor = null;
    S.hasMore = false;
    S.loading = false;
    S.loadingMore = false;
    S.clientRequestId = 0;
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
    if (S.resizeTimer) {
      try { clearTimeout(S.resizeTimer); } catch (e6) {}
      S.resizeTimer = null;
    }
    if (S.headerButtonsCleanup) {
      try { S.headerButtonsCleanup(); } catch (e6) {}
      S.headerButtonsCleanup = null;
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

    // Clean up any active text renderers
    try { window.__xtjActiveRenderers = null; } catch (e) {}

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
    var listAvatar = el('span', { class: 'cli-avatar' });
    renderCatAvatarNode(listAvatar, '', cfg.avatar_url, cfg.avatar_version);
    item.appendChild(listAvatar);
    var meta = el('div', { class: 'cli-info' });
    meta.appendChild(el('div', { class: 'cli-name', text: name }));
    meta.appendChild(el('div', { class: 'cli-preview', text: desc }));
    item.appendChild(meta);
    var right = el('div', { class: 'cli-right' });
    right.appendChild(el('span', { class: 'cli-time', text: 'AI' }));
    item.appendChild(right);

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

  function hookAiTabVisibility() {
    if (window.__xtjAiTabVisibilityHooked) return;
    if (typeof window.switchDockTab !== 'function') return;
    var original = window.switchDockTab;
    window.switchDockTab = function(tab, skipReturn, options) {
      var result = original.apply(this, arguments);
      if (tab !== 'chat' && S.active) {
        try { closeAiChat(); } catch (e) {}
      }
      return result;
    };
    window.__xtjAiTabVisibilityHooked = true;
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
    hookAiTabVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
