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
    replyTimer: null,
    streamCleanup: null,
    abortController: null,
    clientRequestId: 0,
    currentStreamAborted: false,
    conversations: [],
    conversationsEl: null,
    showingHistory: false,
    headerButtonsCleanup: null
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

  function setupBubbleCopy(bubbleEl, containerEl) {
    if (!bubbleEl || !bubbleEl.parentNode) return;
    var _longPressTimer = null;
    var _longPressStarted = false;

    function getBubbleText() {
      return (bubbleEl.textContent || '').trim();
    }

    function showCopyMenu(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var text = getBubbleText();
      if (!text) return;
      closeCopyMenu();
      var rect = bubbleEl.getBoundingClientRect();
      var menu = el('div', { class: 'ai-copy-menu' });
      menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-card,#fff);border:1px solid var(--border,rgba(140,196,158,0.30));border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.12);padding:4px 0;min-width:60px;';
      var btn = el('button', {
        type: 'button',
        class: 'ai-copy-btn',
        text: '复制'
      });
      btn.style.cssText = 'display:block;width:100%;padding:8px 16px;text-align:left;background:none;border:none;font-size:12px;color:var(--text,#1d1d24);cursor:pointer;';
      btn.addEventListener('mouseenter', function() { btn.style.background = 'rgba(46,148,101,0.06)'; });
      btn.addEventListener('mouseleave', function() { btn.style.background = 'none'; });
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
    if (avatarUrl) {
      target.innerHTML = '<span class="ai-avatar-image-wrapper"><img class="ai-avatar-image" src="' + avatarUrl + (avatarVersion ? '?v=' + avatarVersion : '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'' + buildCatAvatarMarkup('') + '\'"></span>';
    } else {
      target.innerHTML = buildCatAvatarMarkup('');
    }
  }

  function renderCatAvatarNode(target, extraClass, avatarUrl, avatarVersion) {
    if (!target) return;
    if (avatarUrl) {
      target.innerHTML = '<span class="ai-avatar-image-wrapper"><img class="ai-avatar-image" src="' + avatarUrl + (avatarVersion ? '?v=' + avatarVersion : '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'' + buildCatAvatarMarkup(extraClass || '') + '\'"></span>';
    } else {
      target.innerHTML = buildCatAvatarMarkup(extraClass || '');
    }
  }

  function isCompactAiHeader() {
    return window.innerWidth <= 640;
  }

  function getThinkButtonText(label) {
    return isCompactAiHeader() ? label : ('思考 ' + label);
  }

  function getNewButtonText() {
    return isCompactAiHeader() ? '新' : '新对话';
  }

  function getHistoryButtonText(showingHistory) {
    if (showingHistory) return isCompactAiHeader() ? '返回' : '返回聊天';
    return '历史';
  }

  function syncAiHeaderButtons(thinkBtn, histBtn, newBtn) {
    if (!thinkBtn || !histBtn || !newBtn) return;
    var label = thinkBtn.getAttribute('data-short-label') || '关';
    thinkBtn.textContent = getThinkButtonText(label);
    histBtn.textContent = getHistoryButtonText(!!S.showingHistory);
    newBtn.textContent = getNewButtonText();
  }

  function bindAiHeaderButtons(thinkBtn, histBtn, newBtn) {
    function onResize() {
      syncAiHeaderButtons(thinkBtn, histBtn, newBtn);
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
    S.currentStreamAborted = true;
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
    if (usage.thinking_mode && usage.thinking_mode !== 'off') {
      parts.push('思考 ' + usage.thinking_mode);
      if (typeof usage.reasoning_length === 'number' && usage.reasoning_length === 0) {
        parts.push('当前模型未返回思考内容');
      }
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
    if (totalSeconds < 60) return totalSeconds + '秒';
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return seconds > 0 ? (minutes + '分' + seconds + '秒') : (minutes + '分钟');
  }

  function setThinkingStatus(node, text) {
    if (!node || !node.querySelector) return;
    var status = node.querySelector('.ai-thinking-status');
    if (!status) return;
    status.textContent = text || '';
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
        update('思考中', 0);
        intervalId = setInterval(function() {
          if (!reasoningNode || !reasoningNode.isConnected) return;
          update('思考中', Date.now() - startedAt);
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

  function buildReasoningNode(reasoning, messagesEl) {
    var container = el('div', { class: 'ai-thinking' });
    var toggle = el('button', {
      type: 'button',
      class: 'ai-thinking-toggle',
      'aria-expanded': 'false',
      'aria-label': '思考过程'
    });
    var label = el('span', { class: 'ai-thinking-label' });
    label.appendChild(el('span', { text: '思考' }));
    toggle.appendChild(label);
    toggle.appendChild(el('span', { class: 'ai-thinking-status', text: '' }));
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

  function buildMessageNode(msg, messagesEl) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    var node = el('div', { class: 'ai-msg ' + role + ' entering' });
    if (role === 'assistant' && shouldRenderReasoning(msg)) {
      node.appendChild(buildReasoningNode(msg.reasoning, messagesEl));
    }
    var bubble = el('div', { class: 'ai-msg-bubble', text: msg.content || '' });
    setupBubbleCopy(bubble, messagesEl);
    node.appendChild(bubble);
    if (role === 'assistant' && msg.usage) {
      var line = buildUsageLine(msg.usage);
      if (line) node.appendChild(el('div', { class: 'ai-msg-usage', text: line }));
    }
    if (msg.created_at) node.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
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
    var minChunk = Math.max(1, options && options.minChunk || 4);
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
    var streamClass = options.streamClass || 'ai-streaming-soft';
    var requestFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(cb) { return setTimeout(cb, 16); };
    var cancelFrame = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;

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
        var frameBudget = pending.length > 160 ? 24 : (pending.length > 72 ? 16 : 10);
        while (pending && next.length < frameBudget) {
          var chunk = takeSmoothTextChunk(pending, options);
          if (!chunk) break;
          next += chunk;
          pending = pending.slice(chunk.length);
        }
      }
      if (!next) return;
      rendered += next;
      targetEl.textContent = rendered;
      if (typeof options.onRender === 'function') {
        try { options.onRender(rendered); } catch (e2) {}
      }
      if (!pending) {
        targetEl.classList.remove(streamClass);
      }
    }

    function tick() {
      rafId = 0;
      if (cancelled) return;
      emitText(false);
      if (pending) schedule();
    }

    function schedule() {
      if (cancelled || !pending || rafId) return;
      if (reducedMotion) {
        emitText(true);
        return;
      }
      rafId = requestFrame(tick);
    }

    return {
      append: function(text) {
        if (cancelled || !targetEl || !text) return;
        pending += String(text);
        schedule();
      },
      flush: function() {
        if (cancelled || !targetEl) return;
        clearFrame();
        emitText(true);
      },
      finish: function(finalText) {
        if (cancelled || !targetEl) return;
        clearFrame();
        pending = '';
        rendered = String(finalText || '');
        targetEl.textContent = rendered;
        targetEl.classList.remove(streamClass);
        if (typeof options.onRender === 'function') {
          try { options.onRender(rendered); } catch (e3) {}
        }
      },
      cancel: function() {
        cancelled = true;
        clearFrame();
        pending = '';
        if (targetEl) targetEl.classList.remove(streamClass);
      }
    };
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
    var text = String(input.value || '').trim();
    if (!text) return;
    
    var originalText = text;
    
    function restoreInputText() {
      input.value = originalText;
      input.style.height = 'auto';
      try {
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        input.focus();
      } catch (e) {}
      updateInputMetrics();
    }
    
    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) return;
    
    // 如果有正在进行的请求，中断它
    if (S.sending) {
      abortCurrentRequest();
      // 等待上一个 typing 清理
      try { await new Promise(function(resolve) { setTimeout(resolve, 100); }); } catch (e) {}
    }
    
    S.clientRequestId++;
    var reqId = 'cr_' + S.clientRequestId + '_' + Date.now();
    S.sending = true;
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
    try { input.focus(); } catch (e2) {}
    
    var aborted = false;
    var myReqId = reqId;
    
    // 创建 AbortController
    var controller = new AbortController();
    S.abortController = controller;
    S.currentStreamAborted = false;
    
    var url = API_BASE + '/chat/stream';
    var auth = await getUserAuthPayload({ forceNoToken: false });
    var headers = auth.headers || {};
    
    var fetchBody = JSON.stringify({
      message: text,
      thinking_mode: S.thinkingMode,
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
            if (myReqId !== reqId) return;
            try { typingNode.remove(); } catch (e) {}
            notify(errJson.error);
          }
        } catch(e) {}
        S.sending = false;
        S.abortController = null;
        return;
      }
      
      if (!resp.body) {
        try { typingNode.remove(); } catch (e) {}
        notify('AI 没有响应');
        S.sending = false;
        S.abortController = null;
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
        if (contentRenderer) contentRenderer.finish(content || '');
        cleanupRenderers();
        if (node) {
          node.classList.remove('generating');
        }
        if (aiBubble) aiBubble.classList.remove('ai-typing');
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
        
        var aiMsg = {
          role: 'assistant',
          content: content,
          reasoning: (finalThinkingMode !== 'off' ? thinking : ''),
          created_at: new Date().toISOString(),
          thinking_mode: finalThinkingMode,
          usage: Object.assign({}, usageResult || {}, {
            model: finalModel,
            thinking_mode: finalThinkingMode
          })
        };
        S.messages.push(aiMsg);
        
        if (usageResult || finalModel || finalThinkingMode) {
          var usageLine = buildUsageLine(aiMsg.usage);
          if (usageLine && node) node.appendChild(el('div', { class: 'ai-msg-usage', text: usageLine }));
        }
        if (aiMsg.created_at && node) node.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(aiMsg.created_at) }));
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
            maxChunk: 12,
            onRender: function() {
              scrollToBottom(messagesEl, false);
            }
          });
        }
        return aiBubble;
      }
      
      while (true) {
        if (myReqId !== reqId || controller.signal.aborted) {
          aborted = true;
          if (reader) try { reader.cancel(); } catch (e) {}
          break;
        }
        
        var readResult;
        try { readResult = await reader.read(); } catch (e) { break; }
        if (readResult.done) break;
        
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
          if (myReqId !== reqId) { aborted = true; break; }
          
          if (evt.type === 'meta') {
            streamConvId = evt.conversation_id;
            if (streamConvId) {
              S.conversationId = streamConvId;
              writeConvId(streamConvId);
            }
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
            if (searchCount > 0) {
              searchBar.textContent = '已联网搜索 · ' + searchCount + ' 条结果';
            } else {
              searchBar.textContent = '联网搜索完成 · 没有找到相关结果';
            }
            // 显示使用的 provider
            if (searchDiag && searchDiag.provider_results && searchDiag.provider_results.length) {
              var firstProv = searchDiag.provider_results[0];
              if (firstProv && firstProv.provider) {
                searchBar.textContent += ' (' + firstProv.provider + ')';
              }
            }
            // 3 秒后自动消失
            clearTimeout(searchBar._hideTimer);
            searchBar._hideTimer = setTimeout(function() {
              try { searchBar.remove(); } catch (e) {}
            }, 3000);
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
            // 5 秒后自动消失
            clearTimeout(searchBar2._hideTimer);
            searchBar2._hideTimer = setTimeout(function() {
              try { searchBar2.remove(); } catch (e) {}
            }, 5000);
            continue;
          }
          
          if (evt.type === 'error') {
            try { typingNode.remove(); } catch (e) {}
            var errMsg = evt.error || 'AI 调用失败';
            
            if (aiContent) {
              // 已有部分回复，保留内容并追加错误提示
              var errNote = el('div', { class: 'ai-error-note', style: 'font-size:11px;color:#c44;margin-top:4px;text-align:left;' }, errMsg);
              try { aiNode.appendChild(errNote); } catch (e) {}
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else {
              // 没有内容，回滚
              notify(errMsg);
              S.messages.pop();
              removeLastUserMessage(messagesEl);
              restoreInputText();
            }
            
            S.sending = false;
            S.abortController = null;
            if (reader) try { reader.cancel(); } catch (e) {}
            aborted = true;
            break;
          }
          
          // 兼容旧错误格式（无 type 但有 error）
          if (evt.error && !evt.type) {
            try { typingNode.remove(); } catch (e) {}
            var errMsg2 = evt.error || 'AI 调用失败';
            
            if (aiContent) {
              var errNote2 = el('div', { class: 'ai-error-note', style: 'font-size:11px;color:#c44;margin-top:4px;text-align:left;' }, errMsg2);
              try { aiNode.appendChild(errNote2); } catch (e) {}
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else {
              notify(errMsg2);
              restoreInputText();
            }
            
            S.sending = false;
            S.abortController = null;
            if (reader) try { reader.cancel(); } catch (e) {}
            aborted = true;
            break;
          }
          
          if (evt.type === 'reasoning_start' && !reasoningStarted) {
            reasoningStarted = true;
            if ((finalThinkingMode && finalThinkingMode !== 'off') || (!finalThinkingMode && S.thinkingMode !== 'off')) {
              ensureReasoningNode();
              ensureThinkingTimer();
            }
            continue;
          }
          
          if (evt.type === 'reasoning') {
            aiReasoning += evt.text || '';
            if ((finalThinkingMode && finalThinkingMode !== 'off') || (!finalThinkingMode && S.thinkingMode !== 'off')) {
              var rn = ensureReasoningNode();
              var body = rn.querySelector('.ai-thinking-body');
              if (body) {
                if (!reasoningRenderer) {
                  body.textContent = '';
                  reasoningRenderer = createSmoothTextRenderer(body, {
                    minChunk: 4,
                    maxChunk: 12,
                    onRender: function() {
                      if (rn.classList.contains('expanded')) scrollToBottom(messagesEl, false);
                    }
                  });
                }
                reasoningRenderer.append(evt.text || '');
              }
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
            S.abortController = null;
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
            if (evt.sanitized_content && aiBubble) {
              // 替换气泡中已输出的原始内容为清洗后正文
              if (contentRenderer) {
                try { contentRenderer.cancel(); } catch (e) {}
                contentRenderer = null;
              }
              aiBubble.textContent = '';
              // 重新逐字渲染清洗后内容（立即完成）
              aiBubble.textContent = evt.sanitized_content;
            }
            
            // 标记流是否完成
            var streamInterrupted = evt.interrupted === true;
            var streamComplete = evt.complete === true;
            var streamSaved = evt.saved === true;
            
            if (aiContent) {
              // 有内容就显示
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else if (aiReasoning) {
              // 只有思考内容没有正文
              if (aiNode) aiNode.textContent = 'AI 思考过程已返回，但正文生成中断，请重试';
            }
            
            // 中断/未保存提示
            if (streamInterrupted && aiContent) {
              var interrNote = el('div', { class: 'ai-interrupt-note', style: 'font-size:11px;color:#999;margin-top:4px;text-align:left;' }, '回复中断，内容可能不完整');
              if (aiNode) aiNode.appendChild(interrNote);
            }
            if (!streamSaved && aiContent) {
              var saveNote = el('div', { class: 'ai-save-note', style: 'font-size:11px;color:#e68a2e;margin-top:2px;text-align:left;' }, '本次回复未保存，刷新后可能丢失');
              if (aiNode) aiNode.appendChild(saveNote);
            }
            
            // 显示清洗提示
            if (evt.filtered && aiContent) {
              var filteredNote = el('div', { class: 'ai-filtered-note', style: 'font-size:11px;color:#888;margin-top:2px;text-align:left;' }, '已自动清理动作描写');
              if (aiNode) aiNode.appendChild(filteredNote);
            }
            
            doneReceived = true;
            evtHandled = true;
            break;
          }
        }
        
        if (doneReceived || aborted) break;
      }
      
      if (myReqId !== reqId || aborted) {
        // 被新请求取代，删除当前创建的任何节点
        cleanupRenderers();
        if (aiNode) try { aiNode.remove(); } catch (e) {}
        try { typingNode.remove(); } catch (e) {}
        S.sending = false;
        S.abortController = null;
        return;
      }
      
      // 完成处理
      try { typingNode.remove(); } catch (e) {}
      
      if (evtHandled) {
        // 已在 done/error 事件中完成渲染
      } else if (aiNode && aiContent) {
        if (reasoningRenderer) reasoningRenderer.finish(aiReasoning || '');
        if (contentRenderer) contentRenderer.finish(aiContent || '');
        cleanupRenderers();
        aiNode.classList.remove('generating');
        if (aiBubble) aiBubble.classList.remove('ai-typing');
        setAiRootState('ai-idle');
        
        if (aiReasoning && finalThinkingMode !== 'off') {
          var reasoningNode = reasoningContainer || aiNode.querySelector('.ai-thinking');
          if (!reasoningNode) {
            reasoningNode = buildReasoningNode(aiReasoning, messagesEl);
            aiNode.insertBefore(reasoningNode, aiNode.firstChild);
          } else {
            var finalBody = reasoningNode.querySelector('.ai-thinking-body');
            if (finalBody) finalBody.textContent = aiReasoning;
          }
        } else if (reasoningContainer) {
          try { reasoningContainer.remove(); } catch (e) {}
          reasoningContainer = null;
        }
        
        var aiMsg = {
          role: 'assistant',
          content: aiContent,
          reasoning: (finalThinkingMode !== 'off' ? aiReasoning : ''),
          created_at: new Date().toISOString(),
          thinking_mode: finalThinkingMode,
          usage: Object.assign({}, usageResult || {}, {
            model: finalModel,
            thinking_mode: finalThinkingMode
          })
        };
        S.messages.push(aiMsg);
        
        if (usageResult || finalModel || finalThinkingMode) {
          var usageLine = buildUsageLine(aiMsg.usage);
          if (usageLine) aiNode.appendChild(el('div', { class: 'ai-msg-usage', text: usageLine }));
        }
        if (aiMsg.created_at) aiNode.appendChild(el('div', { class: 'ai-msg-time', text: fmtTime(aiMsg.created_at) }));
      } else if (doneReceived) {
        cleanupRenderers();
      } else if (!doneReceived) {
        cleanupRenderers();
        S.messages.pop();
        removeLastUserMessage(messagesEl);
        notify('AI 暂时没有回应，请稍后再试');
      }
    } catch (fetchErr) {
      if (myReqId !== reqId) {
        S.sending = false;
        S.abortController = null;
        return;
      }
      // 网络错误或 abort
      if (fetchErr && fetchErr.name !== 'AbortError') {
        try { typingNode.remove(); } catch (e) {}
        if (aiContent) {
          // 已有部分回复，保留并提示连接中断
          var connNote = el('div', { class: 'ai-error-note', style: 'font-size:11px;color:#c44;margin-top:4px;text-align:left;' }, '连接中断，已保留部分回复');
          try { aiNode.appendChild(connNote); } catch (e) {}
          finishAiMessage(aiNode, aiContent, aiReasoning, null);
        } else {
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          notify('网络异常，请检查连接后重试');
        }
      } else {
        try { typingNode.remove(); } catch (e) {}
        if (aiContent) {
          finishAiMessage(aiNode, aiContent, aiReasoning, null);
        } else {
          if (!aiContent) {
            S.messages.pop();
            removeLastUserMessage(messagesEl);
            restoreInputText();
          }
        }
      }
    }
    
    S.sending = false;
    S.abortController = null;
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

  // 获取会话列表
  async function fetchConversations() {
    try {
      var r = await apiRequest('GET', '/chat/conversations?limit=50');
      if (r && r.ok && r.data && Array.isArray(r.data.conversations)) {
        S.conversations = r.data.conversations;
      }
    } catch (e) {}
  }
  
  // 渲染会话列表
  function renderConversationList(container) {
    container.innerHTML = '';
    if (!S.conversations.length) {
      container.appendChild(el('div', { class: 'ai-no-history', text: '暂无聊天记录' }));
      return;
    }
    S.conversations.forEach(function(conv) {
      var item = el('div', { class: 'ai-conv-item' + (conv.conversation_id === S.conversationId ? ' active' : '') });
      item.setAttribute('data-conv-id', conv.conversation_id);
      
      var titleEl = el('div', { class: 'ai-conv-title', text: conv.title || '新对话' });
      var timeEl = el('div', { class: 'ai-conv-time', text: conv.updated_at ? fmtTime(conv.updated_at) : '' });
      item.appendChild(titleEl);
      item.appendChild(timeEl);
      
      item.addEventListener('click', function() {
        if (S.sending) return;
        var cid = this.getAttribute('data-conv-id');
        switchConversation(cid);
      });
      
      container.appendChild(item);
    });
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
    } catch (e) {}
    
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
    thinkBtn.setAttribute('data-short-label', curLvl.label);
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
        thinkBtn.setAttribute('data-short-label', level.label);
        thinkBtn.textContent = '思考 ' + level.label;
        thinkBtn.title = '思考模式：' + level.label;
        thinkBtn.classList.toggle('active', level.value !== 'off');
        syncAiHeaderButtons(thinkBtn, histBtn, newBtn);
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

    // 历史会话按钮
    var histBtn = el('button', {
      type: 'button', class: 'ai-chat-hist-btn', 'aria-label': '历史会话',
      title: '历史会话'
    }, '历史');
    histBtn.addEventListener('click', function() {
      if (S.showingHistory) {
        showChatMessages();
        syncAiHeaderButtons(thinkBtn, histBtn, newBtn);
      } else {
        fetchConversations().then(function() {
          showConversationList();
          syncAiHeaderButtons(thinkBtn, histBtn, newBtn);
        });
      }
    });
    header.appendChild(histBtn);

    // 记忆按钮
    var memoryBtn = el('button', { type: 'button', class: 'ai-chat-hist-btn', 'aria-label': 'AI 记忆', title: '查看 AI 记住了什么' }, '记忆');
    memoryBtn.addEventListener('click', async function() {
      try {
        var r = await apiRequest('GET', '/memory');
        if (r && r.ok && r.memory) {
          var memory = r.memory;
          var lines = [];
          lines.push('--- AI 长期记忆 ---');
          lines.push('');
          if (memory.display_name) lines.push('用户称呼：' + memory.display_name);
          if (memory.reply_preferences && memory.reply_preferences.tone && memory.reply_preferences.tone.length) lines.push('语气偏好：' + memory.reply_preferences.tone.join('、'));
          if (memory.reply_preferences && memory.reply_preferences.avoid && memory.reply_preferences.avoid.length) lines.push('避免：' + memory.reply_preferences.avoid.join('、'));
          if (memory.likes && memory.likes.length) lines.push('喜欢：' + memory.likes.join('、'));
          if (memory.dislikes && memory.dislikes.length) lines.push('不喜欢：' + memory.dislikes.join('、'));
          if (memory.do_not_do && memory.do_not_do.length) lines.push('项目禁区：' + memory.do_not_do.join('、'));
          if (memory.important_notes && memory.important_notes.length) lines.push('重要提醒：' + memory.important_notes.join('、'));
          if (memory.long_term_goals && memory.long_term_goals.length) lines.push('长期目标：' + memory.long_term_goals.join('、'));
          if (lines.length <= 2) {
            lines = ['--- AI 长期记忆 ---', '', '(当前没有记录任何长期记忆，多聊一聊我会记住你的偏好)', ''];
          }
          lines.push('');
          lines.push('---');
          lines.push('[清空记忆]  [关闭记忆]');
          notify(lines.join('\n'), 'info', 8000);
        } else {
          notify('无法加载记忆');
        }
      } catch (e) {
        notify('记忆加载失败');
      }
    });
    header.insertBefore(memoryBtn, histBtn.nextSibling);

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
    if (S.headerButtonsCleanup) {
      try { S.headerButtonsCleanup(); } catch (eCleanup) {}
    }
    S.headerButtonsCleanup = bindAiHeaderButtons(thinkBtn, histBtn, newBtn);
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
    if (avatarEl) renderHeaderAvatar(avatarEl);
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
  }

  function closeAiChat() {
    if (!S.active) return;
    S.active = false;
    clearReplyTimer();
    abortCurrentRequest();
    clearStreamCleanup();
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
    var listAvatar = el('span', { class: 'chat-list-avatar ai-entry-avatar' });
    renderCatAvatarNode(listAvatar, 'ai-entry-avatar-inner', cfg.avatar_url, cfg.avatar_version);
    item.appendChild(listAvatar);
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
