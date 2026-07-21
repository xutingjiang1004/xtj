
window.throttleRAF = function(fn) {
    var ticking = false, args, ctx;
    return function() {
        args = arguments;
        ctx = this;
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(function() {
                fn.apply(ctx, args);
                ticking = false;
            });
        }
    };
};

(function() {
  'use strict';

  var ROOT_API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
  ROOT_API_BASE = (ROOT_API_BASE || '').replace(/\/$/, '');
  var API_BASE = ROOT_API_BASE + '/api/agent';
  var AI_DEBUG = (function() { try { return localStorage.getItem('xtj_ai_debug') === '1'; } catch (e) { return false; } })();
  if (AI_DEBUG) { try { console.warn('[AI] API_BASE =', API_BASE); } catch (e) {} }

  var HISTORY_PAGE_SIZE = 30;
  var CONFIG_CACHE_TTL = 5 * 60 * 1000;
  var CONFIG_REFRESH_INTERVAL = 5 * 60 * 1000; // 鈽?U3: 涓?TTL 涓€鑷? 閬垮厤姣忓垎閽熷仛鏃犵敤鍔?
  var CONV_ID_KEY = 'xtj_ai_last_conversation_id';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  var DT_CONV_KEY = 'xtj_ai_dt_conversation_id';
  var USER_NAME_KEYS = ['xtj_user', 'xtj_username', 'xtj_user_name'];
  var _isTouchMobile = typeof window !== 'undefined' && 'ontouchstart' in window && 'visualViewport' in window;
  var escapeHtml = window.escapeHtml || function(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g, '&#39;'); };

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
    // 鈽?M: thinking_mode 榛樿浠?low 改成 max
    //   鐢ㄦ埛瑕佹眰: 鏅€氳亰澶╅粯璁ゅ氨鐢?max 深度思考?
    //   绠＄悊鍛樺彲鍦ㄥ悗鍙?/admin/ai-agent/config 鍒囨崲涓?low/medium/high/max
    //   鏅€氱敤鎴蜂笉鑳藉湪 UI 切换 (allow_user_thinking_switch: false)
    thinkingMode: 'max',
    // 鈽?P 鏂板: 深度思考冧笓鐢ㄦ€濊€冪▼搴?(浠庡悗绔?config 鍚屾, 涓庢櫘閫氳亰澶╁垎寮€)
    deepThinkEffort: 'max',
    deepThinkEnabled: true,    // 后端 config.deep_think.enabled
    // 鈽?M: 深度思考冩ā寮?toggle 鐘舵€?
    //   寮€鍚悗鏈細璇濇墍鏈夋秷鎭蛋 Planner鈫扺orkers鈫扴ynthesizer 澶?agent 流程
    //   持久化到 localStorage, 重开对话框后恢复
    deepThink: false,
    deepThinkJob: null,         // AbortController for current deep think request
    deepThinkProgressCard: null, // DOM node for progress card
    dtConversationId: null,      // 深度思考冧簩绾ч〉闈㈠綋鍓嶄細璇?ID锛堜笌鏅€氳亰澶╁垎寮€锛?
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
    headerButtonsCleanup: null,
    _currentReqId: null,
    _lastMsgDedupKey: '',
    _lastDtDedupKey: '',
    _lastConfigVersion: 0,
    resizeTimer: null,
    _configRefreshTimer: null,
    historyRequestId: 0,
    conversationRequestId: 0,
    lifecycleId: 0
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
        else if (k === 'html') node.textContent = v; // 鈽?瀹夊叏: 绂佹 innerHTML, 改用 textContent
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
      var d = window.safeParseDate(iso);
      if (isNaN(d.getTime())) return '';
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) {
      return '';
    }
  }

  var _copyMenuActive = null;
  var _menuAbort = null; // 鈽?U3: 绠＄悊澶嶅埗鑿滃崟鐨?document 鐩戝惉鍣?

  function closeCopyMenu() {
    if (_copyMenuActive) {
      try {
        if (_copyMenuActive.parentNode) _copyMenuActive.parentNode.removeChild(_copyMenuActive);
      } catch (e) {}
      _copyMenuActive = null;
    }
    // 鈽?U3: 鍏抽棴鑿滃崟鏃剁珛鍗冲彇娑?pending 鐨?document 鐩戝惉鍣? 閬垮厤绱Н
    if (_menuAbort) {
      try { _menuAbort.abort(); } catch (e) {}
      _menuAbort = null;
    }
  }

  // 清理模型 reasoning 鍐呭閲屽父瑙佺殑鏁存鎷彿鍖呰９锛屾彁鍗囧彲璇绘€?
  function cleanReasoningText(txt) {
    if (!txt) return '';
    return String(txt).split('\n').map(function(line) {
      var trimmed = line.trim();
      if (!trimmed) return line;
      // 浠呭綋鏁磋浠?( 寮€澶淬€佷互 ) 缁撳熬鏃跺幓鎺夋渶澶栧眰鎷彿
      if (trimmed.charAt(0) === '(' && trimmed.charAt(trimmed.length - 1) === ')') {
        return trimmed.slice(1, -1);
      }
      return line;
    }).join('\n');
  }

  // 绠€鍗?Markdown 鈫?HTML 渲染
  function escapeAttr(val) {
    if (!val) return '';
    return String(val).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMarkdown(txt) {
    if (!txt) return '';
    var s = String(txt);
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var codeBlocks = [];
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
      return '%%%CODEBLOCK' + idx + '%%%';
    });
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 鍥剧墖: 鍙厑璁?data:image/ 协议
    s = s.replace(/!\[([^\]]*)\]\(data:image\/([^;]+);base64,([^)]+)\)/g, function(m, alt, ext, b64) {
      return '<img src="data:image/' + escapeAttr(ext) + ';base64,' + escapeAttr(b64) + '" alt="' + escapeAttr(alt) + '" class="ai-uploaded-image" loading="lazy" style="max-width:100%;max-height:300px;border-radius:8px;margin:4px 0;">';
    });
    // 链接: 使用 DOM API 闃?XSS, 鐧藉悕鍗曞崗璁? http:, https:, mailto:
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, label, href) {
      var cleanHref = String(href).trim();
      var lowerHref = cleanHref.toLowerCase();
      var allowedProtocols = ['http:', 'https:', 'mailto:'];
      var protocolOk = false;
      for (var p = 0; p < allowedProtocols.length; p++) {
        if (lowerHref.indexOf(allowedProtocols[p]) === 0) { protocolOk = true; break; }
      }
      if (!protocolOk) {
        if (lowerHref.indexOf('data:') === 0) return '<span class="ai-file-link" title="' + escapeAttr(label) + '">' + escapeHtml(label) + '</span>';
        return '<span class="ai-blocked-link" title="' + escapeAttr(label) + '">' + escapeHtml(label) + '</span>';
      }
      var a = document.createElement('a');
      a.setAttribute('href', cleanHref);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.textContent = label;
      return a.outerHTML;
    });
    s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/^- (.+)$/gm, '<li class="ul-item">$1</li>');
    s = s.replace(/(<li class="ul-item">.*<\/li>\n?)+/g, function(m) {
      return '<ul>' + m.replace(/ class="ul-item"/g, '') + '</ul>';
    });
    s = s.replace(/^\d+\. (.+)$/gm, '<li class="ol-item">$1</li>');
    s = s.replace(/(<li class="ol-item">.*<\/li>\n?)+/g, function(m) {
      return '<ol>' + m.replace(/ class="ol-item"/g, '') + '</ol>';
    });
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/%%%CODEBLOCK(\d+)%%%/g, function(m, idx) { return codeBlocks[parseInt(idx)] || ''; });
    return s;
  }

  function setupBubbleCopy(bubbleEl, containerEl) {
    if (!bubbleEl || !bubbleEl.parentNode) return;
    var _longPressTimer = null;
    var _longPressStarted = false;
    // 鈽?U3: AbortController 绠＄悊鎵€鏈夌洃鍚櫒, 杞垹闄ゆ椂鍙粺涓€娓呯悊
    var _bubbleAbort = new AbortController();

    function getBubbleText() {
      return (bubbleEl.textContent || '').trim();
    }

    function showCopyMenu(ev) {
      if (_copyMenuActive && _copyMenuActive.isConnected) return;
      if (_copyMenuActive && !_copyMenuActive.isConnected) _copyMenuActive = null;
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
      // 鈽?U3: 鐢?AbortController 关闭旧的 document 鐩戝惉鍣?
      if (_menuAbort) { try { _menuAbort.abort(); } catch (e) {} }
      _menuAbort = new AbortController();
      var currentAbort = _menuAbort;
      setTimeout(function() {
        if (!currentAbort || currentAbort.signal.aborted) return;
        document.addEventListener('click', function onDoc(ce2) {
          if (!menu.contains(ce2.target) && ce2.target !== bubbleEl) {
            closeCopyMenu();
          }
        }, { signal: _menuAbort.signal, once: true });
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

    // 鈽?U3: 鎵€鏈変簨浠剁洃鍚粺涓€閫氳繃 AbortController 管理
    bubbleEl.addEventListener('pointerdown', startLongPress, { signal: _bubbleAbort.signal });
    bubbleEl.addEventListener('pointerup', cancelLongPress, { signal: _bubbleAbort.signal });
    bubbleEl.addEventListener('pointercancel', cancelLongPress, { signal: _bubbleAbort.signal });
    bubbleEl.addEventListener('pointermove', function(ev) {
      if (_longPressTimer && ev.pointerType === 'touch') {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
      }
    }, { signal: _bubbleAbort.signal });
    bubbleEl.addEventListener('contextmenu', function(ev) {
      var text = getBubbleText();
      if (text) showCopyMenu(ev);
    }, { signal: _bubbleAbort.signal });

    // 暴露 cleanup 閽╁瓙渚涜蒋删除鏃惰皟鐢?
    bubbleEl._aiCleanupBubble = function() {
      try { _bubbleAbort.abort(); } catch (e) {}
      if (_menuAbort) { try { _menuAbort.abort(); } catch (e) {} }
      if (_longPressTimer) { try { clearTimeout(_longPressTimer); } catch (e) {} }
    };
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
    // 鈽?U3: 如果 version 鐩稿悓涓斿凡鏈夊唴瀹? 璺宠繃閲嶅缓 (閬垮厤姣忓垎閽熼噸鏂颁笅杞藉ご鍍?
    if (target._aiAvatarVersion === avatarVersion && target._aiAvatarUrl === avatarUrl && target.children.length > 0) {
      return;
    }
    target._aiAvatarVersion = avatarVersion;
    target._aiAvatarUrl = avatarUrl;
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
    var _onResizeWrapped = window.throttleRAF(onResize);
    window.addEventListener('resize', _onResizeWrapped);
    onResize();
    return function() {
      window.removeEventListener('resize', _onResizeWrapped);
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
    var d = window.safeParseDate(dateValue);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getConversationGroupLabel(dateValue) {
    var d = window.safeParseDate(dateValue || 0);
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

  
  function abortCurrentRequest() {
    clearStreamCleanup();
    // 鈽?U3 淇: 涓嶅啀瑁?sendBeacon /chat/cancel (鏃?auth 导致 401)
    // 直接前端 AbortController abort 即可, 后端 req.on('close') 会自感知
    if (S.abortController) {
      try { S.abortController.abort(); } catch (e) {}
      S.abortController = null;
    }
    if (S.deepThinkJob) {
      try { S.deepThinkJob.abort(); } catch (e) {}
      S.deepThinkJob = null;
    }
    if (S.deepThinkProgressCard) {
      try { S.deepThinkProgressCard.classList.add('ai-progress-card-done'); } catch (e) {}
      try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e) {}
      try { if (S.deepThinkProgressCard.parentNode) S.deepThinkProgressCard.parentNode.removeChild(S.deepThinkProgressCard); } catch (e) {}
      S.deepThinkProgressCard = null;
    }
    S.sending = false;
    S.paused = false;
    S.activeRenderers = [];
    if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
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
    var body = {};
    return { token: token, headers: headers, body: body, query: {}, userName: un };
  }

  async function sendOnce(method, path, body, options) {
    options = options || {};
    var url = API_BASE + path;
    try {
      var auth = await getUserAuthPayload({ forceNoToken: !!options.forceNoToken });
      var headers = auth.headers;
      var opts = { method: method, headers: headers };
      var requestController = typeof AbortController === 'function' ? new AbortController() : null;
      var requestTimer = null;
      if (requestController) {
        opts.signal = requestController.signal;
        requestTimer = setTimeout(function() {
          try { requestController.abort(); } catch (eAbort) {}
        }, Math.max(3000, Number(options.timeoutMs) || 12000));
      }

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

      var resp;
      try {
        resp = await fetch(url, opts);
      } finally {
        if (requestTimer) clearTimeout(requestTimer);
      }
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
      var errMsg = e && e.name === 'AbortError' ? '请求超时' : ((e && e.message) || '网络异常');
      try { console.warn('[AI] request exception', { method: method, url: url, error: errMsg }); } catch (e5) {}
      return { ok: false, status: 0, data: null, error: errMsg, url: url, rawText: '' };
    }
  }

  async function apiRequest(method, path, body, opts) {
    if (AI_DEBUG) { try { console.warn('[AI] apiRequest start', { method: method, path: path, apiBase: API_BASE }); } catch (e) {} }
    var first = await sendOnce(method, path, body, Object.assign({ forceNoToken: false }, opts || {}));
    if (AI_DEBUG) { try { console.warn('[AI] first response', { method: method, path: path, status: first && first.status, ok: first && first.ok, url: first && first.url }); } catch (e2) {} }
    if (first && first.status === 401) {
      if (typeof window.refreshUserToken === 'function') {
        try {
          var refreshed = await window.refreshUserToken(true);
          if (refreshed) {
            var third = await sendOnce(method, path, body, Object.assign({ forceNoToken: false, retry: true }, opts || {}));
            try { if (AI_DEBUG) console.warn('[AI] retry result (refreshed token)', { status: third && third.status, ok: third && third.ok, url: third && third.url }); } catch (e5) {}
            return third;
          }
        } catch (e6) {}
      }
      try { if (typeof window.handleProtectedAuthFailure === 'function') window.handleProtectedAuthFailure(); } catch (e7) {}
    }
    return first;
  }

  function describeError(r, fallback) {
    if (!r) return fallback || '请求失败';
    if (r.status === 401) {
      try { if (typeof window.handleProtectedAuthFailure === 'function') window.handleProtectedAuthFailure(); } catch (e) {}
      return '凭据异常，请重新登录后再和小猫聊天';
    }
    if (r.status === 403) return '当前账号没有执行此操作的权限';
    if (r.status === 404) return 'AI 接口不存在，请检查 API_BASE 或部署域名';
    if (r.status === 405) return 'AI 接口方法不允许，请检查 API_BASE 或部署域名';
    if (r.status === 429) return '小猫调用次数已达上限，请稍后再试';
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
      name: '小猫',
      avatar: '🐈',
      description: '在线',
      welcome_message: '我是小猫，徐旭泽的毒舌 AI 分身。有什么问题直接问，别绕弯子。'
    };
    return S.config;
  }

  function buildUsageLine(usage) {
    if (!usage || typeof usage !== 'object') return null;
    var parts = [];
    var isAdmin = isAdminUser();
    if (isAdmin) {
      if (typeof usage.prompt_tokens === 'number') parts.push('输入 ' + usage.prompt_tokens);
      if (typeof usage.completion_tokens === 'number') parts.push('输出 ' + usage.completion_tokens);
      if (typeof usage.prompt_cache_hit_tokens === 'number' && usage.prompt_cache_hit_tokens > 0) parts.push('命中 ' + usage.prompt_cache_hit_tokens);
      if (typeof usage.prompt_cache_miss_tokens === 'number' && usage.prompt_cache_miss_tokens > 0) parts.push('未命中 ' + usage.prompt_cache_miss_tokens);
      if (typeof usage.cost === 'number' && usage.cost > 0) {
        // 鈽?U3: 鍔ㄦ€?currency 符号
        var currency = usage.currency || 'CNY';
        var symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
        parts.push(symbol + usage.cost.toFixed(6) + ' ' + currency);
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
    var now = Date.now();
    if (!force && container._dtLastScrollTs && (now - container._dtLastScrollTs) < 80) return;
    if (container._dtScrollRaf) return;
    container._dtScrollRaf = true;
    try {
      requestAnimationFrame(function() {
        container._dtScrollRaf = false;
        container._dtLastScrollTs = Date.now();
        try { container.scrollTop = container.scrollHeight; } catch (e) {}
      });
    } catch (e2) {
      container._dtScrollRaf = false;
      container._dtLastScrollTs = Date.now();
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
    var label = el('span', { class: 'ai-thinking-label', text: elapsedMs > 0 ? ('已思考 ' + formatThinkingElapsed(elapsedMs)) : '思考中' });
    toggle.appendChild(label);
    toggle.appendChild(el('span', { class: 'ai-thinking-caret', text: '\u25be', 'aria-hidden': 'true' }));

    var panel = el('div', { class: 'ai-thinking-panel' });
    panel.appendChild(el('div', { class: 'ai-thinking-body', text: cleanReasoningText(reasoning) }));

    toggle.addEventListener('click', function() {
      setThinkingExpanded(container, !container.classList.contains('expanded'), messagesEl || S.messagesEl);
    });

    container.appendChild(toggle);
    container.appendChild(panel);
    return container;
  }

  // 鈽?O 修复 Bug 4: 浠?history 恢复 think-card
  //   閫€鍑哄璇濇閲嶈繘鍚? deep_think=true 的消息渲染成 think-card
  // 鈽?Q 閲嶅仛: 鏋佺畝鐗?(涓?handleSendDeepThink 涓€鑷寸粨鏋?
  function buildThinkCardFromHistory(msg, messagesEl, simpleMode) {
    var thinkingLog = Array.isArray(msg.thinking_log) ? msg.thinking_log : [];
    var workerResults = Array.isArray(msg.worker_results) ? msg.worker_results : [];
    var agentCount = msg.agent_count || (workerResults.length || 0);
    var thinkDurationMs = typeof msg.think_duration_ms === 'number' ? msg.think_duration_ms : 0;
    var searchResults = Array.isArray(msg.search_results) ? msg.search_results : [];
    var finalThinkingMode = (msg.usage && msg.usage.thinking_mode) || msg.thinking_mode || 'max';

    var node;
    if (simpleMode) {
      node = buildResearchCardShell({
        state: 'done',
        canToggle: true,
        expanded: false,
        durationMs: thinkDurationMs,
        agentCount: agentCount,
        searchCount: msg.search_count || 0,
        extraClass: 'ai-research-history ai-research-card--summary'
      });
      node._done = true;
      stopResearchCardAnimation(node);
    } else {
      node = el('div', { class: 'ai-think-card collapsed' });
      node.innerHTML =
        '<div class="ai-think-header">' +
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

      // header 鏁磋鍙偣鍑诲睍寮€/鎶樺彔
      var headerEl = node.querySelector('.ai-think-header');
      var chevronEl = node.querySelector('.ai-think-chevron');
      headerEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isCollapsed = node.classList.contains('collapsed');
        if (isCollapsed) {
          node.classList.remove('collapsed');
          node.classList.add('expanded');
          if (chevronEl) chevronEl.textContent = '▾';
        } else {
          node.classList.add('collapsed');
          node.classList.remove('expanded');
          if (chevronEl) chevronEl.textContent = '▸';
        }
      });
    }

    var contentForRender = msg.content || '';
    var answerEl = node.querySelector('.ai-think-answer');
    if (!contentForRender || !String(contentForRender).trim()) {
      var hasThinkingLog = thinkingLog.length > 0 || (msg.reasoning && String(msg.reasoning).trim());
      contentForRender = hasThinkingLog ? 'AI 只返回了思考过程，没有生成正文回复。' : 'AI 暂无回复。';
    }
    answerEl.innerHTML = renderMarkdown(contentForRender);
    setupBubbleCopy(answerEl, messagesEl);

    // 娓叉煋鎬濊€冭繃绋嬫棩蹇?(鏀捐繘 <details> 鍐? 鍏堝悎骞跺悓瑙掕壊)
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
          var roundLabel = entry.round ? (' · 第' + entry.round + '轮') : '';
          entEl.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + escapeHtml(roundLabel) + '</div><div class="ai-thought-chunk"></div>';
          entEl.querySelector('.ai-thought-chunk').textContent = cleanReasoningText(String(entry.chunk || '').slice(0, 4000));
          thinkLogBox.appendChild(entEl);
        });
        // 更新 summary 鏄剧ず鍚堝苟鍚庣殑步ユ暟锛堜袱绉嶆ā寮忛兘鏇存柊锛?
        var summaryTextEl = node.querySelector('.ai-thinking-summary-text');
        if (summaryTextEl) summaryTextEl.textContent = '查看思考过程 (' + mergedLog.length + ' 步)';
      }
    }

    // footer (鏃堕棿 + 鎬濊€冪▼搴?+ agent 鏁?
    var footer = node.querySelector('.ai-msg-footer');
    if (footer) {
      footer.innerHTML = '';
      if (msg.created_at) footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
      var badge = el('span', { class: 'ai-msg-thinking-badge' });
      badge.innerHTML = AI_THINK_ICON + ' ' + finalThinkingMode;
      footer.appendChild(badge);
      if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
      if (msg.search_count > 0) footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '已搜索?' + (msg.search_count || 0) }));
      if (msg.usage) {
        var usageLine = buildUsageLine(msg.usage);
        if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
      }
    }

    return node;
  }

  // 鈽?O 修复 Bug 4: 鏍煎紡鍖?think_duration_ms
  function formatThinkDuration(ms) {
    if (!ms || ms <= 0) return '0s';
    var sec = Math.round(ms / 1000);
    var min = Math.floor(sec / 60);
    var s = sec % 60;
    return min > 0 ? (min + 'm ' + s + 's') : (s + 's');
  }

  function buildMessageNode(msg, messagesEl) {
    var role = msg.role === 'assistant' ? 'assistant' : 'user';
    // 鈽?O 修复 Bug 4: deep_think 娑堟伅娓叉煋鎴?ai-think-card (浠?history 恢复)
    if (role === 'assistant' && msg.deep_think === true) {
      return buildThinkCardFromHistory(msg, messagesEl);
    }
    var node = el('div', { class: 'ai-msg ' + role + ' entering' });
    if (role === 'assistant' && shouldRenderReasoning(msg)) {
      node.appendChild(buildReasoningNode(msg.reasoning, messagesEl, msg.thinking_elapsed_ms));
    }
    var contentForRender = msg.content || '';
    var bubble = el('div', { class: 'ai-msg-bubble' });
    if (!contentForRender || !String(contentForRender).trim()) {
      var hasReasoning = !!(msg.reasoning && String(msg.reasoning).trim());
      contentForRender = hasReasoning ? 'AI 只返回了思考过程，没有生成正文回复。' : 'AI 暂无回复。';
    }
    bubble.innerHTML = renderMarkdown(contentForRender);
    setupBubbleCopy(bubble, messagesEl);
    node.appendChild(bubble);
    // 搴曢儴淇℃伅鏍忥細鏃堕棿 路 鎬濊€冪▼搴?路 鐢ㄩ噺锛堜粎 assistant 鏈夋€濊€冩爣绛惧拰鐢ㄩ噺锛?
    var footer = el('div', { class: 'ai-msg-footer' });
    if (msg.created_at) {
      footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
    }
    if (role === 'assistant') {
      // 鈽?P1 鍏抽敭淇锛氭悳绱㈠窘绔?
      //   - 1 天内（search_expires_at > now锛夛細瀹屾暣鏄剧ず"宸茶仈缃戞悳绱?路 N 条结果+ 鍙睍寮€缁撴灉鍒楄〃
      //   - 1 澶╁悗锛氬窘绔犱繚鎸佹樉绀猴紝浣嗘爣璁?缁撴灉宸茶繃鏈?
      //   - 姘歌繙鏄剧ず寰界珷锛堢敤鎴峰師璇?閲嶆柊杩涘璇濇鏄剧ず宸茶仈缃戞悳绱?鎼滃埌澶氬皯鏉′俊鎭?锛?
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
        // 1 澶╁唴 + 鏈?results 鏁扮粍 鈫?鍙偣鍑诲睍寮€
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
            if (snippet.length > 140) snippet = snippet.slice(0, 140) + '...';
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
      // 鎼滅储鍒版澶勭粨鏉?
      var thinkingMode = getMessageThinkingMode(msg);
      if (thinkingMode && thinkingMode !== 'off') {
        var badgeText = msg.thinking_elapsed_ms > 0 ? ('思考 ' + formatThinkingElapsed(msg.thinking_elapsed_ms)) : ('思考 ' + thinkingMode);
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
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和 ' + (cfg.name || '小猫') + ' 聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: tipText || (cfg.welcome_message || '嗨，来聊天吧。') }));
    return empty;
  }

  function renderHistoryUnavailable(messagesEl, status) {
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    var state = buildEmptyState(status === 0
      ? '聊天记录加载超时，你仍可发送新消息'
      : '聊天记录暂时无法加载，你仍可发送新消息');
    state.classList.add('ai-history-unavailable');
    var retry = el('button', {
      type: 'button',
      class: 'ai-history-retry',
      text: '重新加载聊天记录',
      'aria-label': '重新加载聊天记录'
    });
    retry.addEventListener('click', function() {
      loadHistory(messagesEl, null);
    });
    state.appendChild(retry);
    messagesEl.appendChild(state);
  }

  function appendMessage(messagesEl, msg) {
    if (!messagesEl) return null;
    var empty = messagesEl.querySelector('.ai-chat-empty');
    if (empty) {
      try { empty.remove(); } catch (e) {}
    }
    var node = buildMessageNode(msg, messagesEl);
    messagesEl.appendChild(node);
    if (msg && msg.role === 'assistant' && Array.isArray(msg.site_cards)) {
      msg.site_cards.forEach(function(card) {
        try { renderAiToolCard(messagesEl, card); } catch (e) {}
      });
    }
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

  function takeSmoothTextChunk(pending, options) {
    pending = String(pending || '');
    if (!pending) return '';
    // V2: 更快节奏, minChunk=3/maxChunk=12 配合 8-20瀛?甯? 娴佺晠涓嶅崱
    var minChunk = Math.max(1, options && options.minChunk || 3);
    var maxChunk = Math.max(minChunk, options && options.maxChunk || 12);
    if (pending.length <= maxChunk) return pending;

    var punctuation = /[锛屻€傦紒锛燂紱锛氥€?.!?;:\n]/;
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
    // V5: 鍩轰簬鏃堕棿鎺ㄨ繘锛岄€傞厤涓嶅悓鍒锋柊鐜囷紱plainStream 鍗曟枃鏈妭鐐?+ 寰壒娆★紝閬垮厤姣忓抚寤鸿妭鐐瑰崱椤?
    var lastFrameTime = 0;
    var charsPerMs = options.plainStream ? 0.55 : 0.7;
    // plainStream 妯″紡锛氬崟鏂囨湰鑺傜偣澶嶇敤锛岄伩鍏嶆瘡甯?createTextNode 触发 reflow
    var plainTextNode = null;
    var plainTextBuffer = '';
    // V3: 末尾呼吸竖线光标 (替代闪光光点)
    var cursor = null;
    function ensureCursor() {
      if (cursor || finished || cancelled) return;
      try {
        cursor = document.createElement('span');
        cursor.className = 'ai-stream-cursor';
        cursor.setAttribute('aria-hidden', 'true');
        if (options.plainStream && plainTextNode && plainTextNode.parentNode === targetEl) {
          // 插在 plainTextNode 之后
          if (plainTextNode.nextSibling) targetEl.insertBefore(cursor, plainTextNode.nextSibling);
          else targetEl.appendChild(cursor);
        } else {
          targetEl.appendChild(cursor);
        }
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

    function ensurePlainTextNode() {
      if (plainTextNode && plainTextNode.parentNode === targetEl) return plainTextNode;
      // 初始化时插入新文本节点（放在光标前面，光标可能尚未存在）
      plainTextNode = document.createTextNode('');
      targetEl.insertBefore(plainTextNode, cursor || null);
      return plainTextNode;
    }

    function emitText(forceAll, budget) {
      if (cancelled || !targetEl) return;
      if (!pending) {
        if (streamClass) targetEl.classList.remove(streamClass);
        return;
      }
      if (streamClass) targetEl.classList.add(streamClass);
      var next = '';
      if (reducedMotion || forceAll) {
        next = pending;
        pending = '';
      } else {
        // V5: 基于时间 budget 推进，帧率无关；plainStream 绱Н鍒扮紦鍐插尯涓€甯у彧鍐欎竴娆?
        var frameBudget = Math.max(1, Math.floor(budget || 16));
        while (pending && next.length < frameBudget) {
          var chunk = takeSmoothTextChunk(pending, Object.assign({}, options, { maxChunk: Math.min(options.maxChunk || 16, frameBudget - next.length) }));
          if (!chunk) break;
          next += chunk;
          pending = pending.slice(chunk.length);
        }
      }
      if (!next) return;
      rendered += next;
      if (options.plainStream) {
        // 流水模式：累积到 plainTextBuffer，一次写入单文本节点（不每帧建节点）
        plainTextBuffer += next;
        var node = ensurePlainTextNode();
        // 鐢?data 璁剧疆鏂囨湰锛岄珮鏁?
        try { node.data = plainTextBuffer; } catch (e) { node.textContent = plainTextBuffer; }
      } else {
        var now = Date.now();
        if (!targetEl._lastRender || now - targetEl._lastRender > 50 || !pending) {
          targetEl.innerHTML = renderMarkdown(rendered);
          targetEl._lastRender = now;
        }
      }
      ensureCursor();
      if (typeof options.onRender === 'function') {
        try { options.onRender(rendered); } catch (e2) {}
      }
      if (!pending) {
        if (streamClass) targetEl.classList.remove(streamClass);
        if (finished && typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
      }
    }

    function tick(timestamp) {
      rafId = 0;
      if (cancelled || paused) return;
      if (!lastFrameTime) lastFrameTime = timestamp;
      var elapsed = timestamp - lastFrameTime;
      lastFrameTime = timestamp;
      var budget = Math.max(1, Math.floor(elapsed * charsPerMs));
      emitText(false, budget);
      if (pending) schedule();
    }

    function schedule() {
      if (cancelled || !pending || rafId || paused) return;
      if (reducedMotion) {
        emitText(true);
        return;
      }
      lastFrameTime = 0;
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
        // 鍏滃簳: 濡傛灉娓叉煋瀹岃繕鏄┖鐨? 鏄剧ず鎻愮ず
        if (!rendered || rendered.trim().length === 0) {
          rendered = 'AI 暂无回复，请重试。';
          targetEl.classList.add('ai-empty-fallback');
        }
        try { if (AI_DEBUG) console.log('[AI-RENDER] finish len:', rendered.length, 'el:', targetEl.tagName, targetEl.className); } catch(_) {}
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
        // 如果已经 finish锛堟甯稿畬鎴愶級锛屼笉瑕佹竻空虹洰鏍囧厓绱狅紝閬垮厤鎶婃渶缁堝唴瀹规姽鎺?
        if (!finished) {
          try { if (targetEl) targetEl.innerHTML = ''; } catch (e) {}
        }
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
      // 鈽?U3: clamp keyboardHeight 闃叉鏌愪簺娴忚鍣ㄧ畻鍑哄紓甯稿€?
      var maxKb = Math.round(window.innerHeight * 0.6);
      if (keyboardHeight > maxKb) keyboardHeight = maxKb;
      root.classList.toggle('ai-keyboard-open', keyboardHeight > 0);

      if (_isTouchMobile) {
        // 绉诲姩绔細杈撳叆鏍?position:fixed 浮在键盘上方，容器不缩放
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
      vv.addEventListener('resize', window.throttleRAF(onViewportChange));
      vv.addEventListener('scroll', window.throttleRAF(onViewportChange));
    }
    window.addEventListener('resize', window.throttleRAF(onViewportChange));
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

  // ===================== M: 深度思考冩ā寮?鈥?杩涘害鍗?/ toggle / cancel =====================
  // 鍒囨崲深度思考冩ā寮忥細鏀逛负鎵撳紑鐙珛浜岀骇椤甸潰锛屼笉鍐嶅垏鎹㈡櫘閫氳亰澶╃殑 S.deepThink
  function toggleDeepThink() {
    if (!S.deepThinkEnabled) {
      notify('深度思考模式已被管理员关闭');
      return;
    }
    // 鏅€氳亰澶╀腑深度思考冨叆鍙ｇ粺涓€璧颁簩绾ч〉闈紝閬垮厤涓庢櫘閫氳亰澶╁叡鐢ㄦ皵娉￠潰鏉?
    openDeepThinkPage();
  }

  function refreshDeepThinkToggle() {
    var btn = document.getElementById('aiDeepThinkToggle');
    if (btn) {
      if (S.deepThink) btn.classList.add('on');
      else btn.classList.remove('on');
      // 鈽?P 鏂板: 鍚庣绂佺敤鏃舵樉绀虹鐢ㄦ牱寮?
      if (!S.deepThinkEnabled) {
        btn.classList.add('disabled');
        btn.setAttribute('title', '深度思考模式已被管理员关闭');
      } else {
        btn.classList.remove('disabled');
        btn.removeAttribute('title');
      }
    }
  }

  // 深度思考冨凡鏀逛负鐙珛浜岀骇椤甸潰锛屾櫘閫氳亰澶╀笉鍐嶆仮澶?deepThink 鐘舵€?
  function restoreDeepThinkState() {
    S.deepThink = false;
  }

  // 鏋勯€犳繁搴︽€濊€冭繘搴﹀崱鐗?(鏋佺畝椋庢牸)
  // 鈽?U2 重做: 4 瑙掑嚬鏄?sparkle (ChatGPT/Claude 风格, 替代菱形)
  var AI_THINK_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" stroke="none" style="vertical-align:-2px"><ellipse cx="8" cy="11.2" rx="3.4" ry="2.7"/><circle cx="4.6" cy="6.6" r="1.5"/><circle cx="8" cy="5" r="1.5"/><circle cx="11.4" cy="6.6" r="1.5"/></svg>';
  var AI_RESEARCH_STEPS = ['拆解问题', '分析信息', '组织结构', '生成回答'];
  var AI_RESEARCH_THINKING_TEXTS = ['正在拆解问题', '正在分析上下文', '正在组织思路', '正在构建回答结构'];
  var AI_RESEARCH_RESEARCH_TEXTS = ['正在检索相关信息', '正在归纳研究要点', '正在生成研究结论'];

  function isResearchCard(card) {
    return !!(card && card._researchState && card.classList && card.classList.contains('ai-research-card'));
  }

  function ensureResearchCardRefs(card) {
    if (!card) return null;
    if (!card._researchRefs) {
      card._researchRefs = {
        header: card.querySelector('.ai-research-header'),
        title: card.querySelector('.ai-research-title'),
        meta: card.querySelector('.ai-research-meta'),
        status: card.querySelector('.ai-research-status'),
        steps: Array.prototype.slice.call(card.querySelectorAll('.ai-research-steps span')),
        stop: card.querySelector('.ai-research-stop'),
        details: card.querySelector('.ai-think-thinking'),
        summaryText: card.querySelector('.ai-thinking-summary-text'),
        thinkingBody: card.querySelector('.ai-think-thinking-body'),
        answer: card.querySelector('.ai-think-answer'),
        footer: card.querySelector('.ai-msg-footer'),
        retry: card.querySelector('.ai-research-retry'),
        failureSlot: card.querySelector('.ai-research-failure-slot'),
        canvas: card.querySelector('.ai-research-particles'),
        searchBox: null
      };
    }
    return card._researchRefs;
  }

  function setResearchDisclosure(card, expanded) {
    if (!isResearchCard(card)) return;
    var refs = ensureResearchCardRefs(card);
    var state = card._researchState || {};
    var canToggle = !!state.canToggle;
    if (state.userPinnedOpen && canToggle) expanded = true;
    if (!canToggle) expanded = false;
    armResearchMotionWindow(card);
    card.classList.toggle('expanded', !!expanded && canToggle);
    card.classList.toggle('collapsed', !expanded || !canToggle);
    if (refs && refs.details) refs.details.open = !!expanded && canToggle;
    syncResearchCardAnimatorState(card);
  }

  function resetResearchCardDisclosure(root) {
    if (!root || !root.querySelectorAll) return;
    var cards = root.querySelectorAll('.ai-research-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!isResearchCard(card)) continue;
      if (card._researchState) {
        card._researchState.persistExpanded = false;
        card._researchState.userPinnedOpen = false;
      }
      setResearchDisclosure(card, false);
    }
  }

  function preserveResearchAnswer(card, content) {
    if (!isResearchCard(card) || !content) return;
    var answer = card.querySelector('.ai-think-answer');
    if (!answer || String(answer.textContent || '').trim()) return;
    try { answer.innerHTML = renderMarkdown(String(content)); } catch (e) {}
  }

  function syncResearchFailureNote(card, statusText) {
    if (!isResearchCard(card)) return;
    var refs = ensureResearchCardRefs(card);
    if (!refs || !refs.failureSlot) return;
    var note = refs.failureSlot.querySelector('.ai-research-failure-note');
    var state = card._researchState || {};
    var show = !!statusText && (state.state === 'timeout' || state.state === 'interrupted' || state.state === 'cancelled');
    if (!show) {
      if (note && note.parentNode) note.parentNode.removeChild(note);
      return;
    }
    if (!note) {
      note = el('div', { class: 'ai-error-note ai-research-failure-note' });
      refs.failureSlot.appendChild(note);
    }
    note.textContent = statusText;
  }

  function markResearchCardOutcome(card, nextState, statusText) {
    if (!isResearchCard(card)) return;
    setResearchCardState(card, nextState, { statusText: statusText });
    syncResearchFailureNote(card, statusText || '\u672c\u6b21\u6df1\u5ea6\u7814\u7a76\u672a\u5b8c\u6210\u3002');
  }

  function updateResearchProgress(card, ratio) {
    if (!isResearchCard(card)) return;
    var safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    card.style.setProperty('--ai-research-progress', (safeRatio * 100).toFixed(2) + '%');
    if (card._researchState) card._researchState.progress = safeRatio;
  }

  function setResearchSteps(card, activeIndex, doneCount) {
    var refs = ensureResearchCardRefs(card);
    if (!refs || !refs.steps) return;
    refs.steps.forEach(function(step, idx) {
      step.classList.remove('done', 'active');
      if (idx < doneCount) step.classList.add('done');
      else if (idx === activeIndex) step.classList.add('active');
    });
  }

  function stopResearchCardAnimation(card) {
    if (!isResearchCard(card)) return;
    var state = card._researchState;
    if (!state) return;
    if (state.elapsedTimer) {
      try { clearInterval(state.elapsedTimer); } catch (e) {}
      state.elapsedTimer = null;
    }
    if (state.animator) {
      try { state.animator.stop(); } catch (e2) {}
      state.animator = null;
    }
  }

  function getResearchAnimationProfile() {
    var root = document.documentElement;
    var profile = window.__xtjPerfProfile || root.getAttribute('data-xtj-perf-profile') || root.dataset.xtjPerfProfile || '';
    if (!profile && root.classList.contains('perf-lite')) profile = 'lite';
    if (!profile && root.classList.contains('perf-balanced')) profile = 'balanced';
    if (!profile) profile = 'full';
    if (profile === 'lite') return { mode: 'lite', canvas: false, minNodes: 0, maxNodes: 0, fps: 0, dpr: 1, shadowBlurBase: 0, shadowBlurBoost: 0 };
    if (profile === 'balanced') return { mode: 'balanced', canvas: true, minNodes: 32, maxNodes: 40, fps: 30, dpr: 1.35, shadowBlurBase: 5, shadowBlurBoost: 8 };
    return { mode: 'full', canvas: true, minNodes: 40, maxNodes: 56, fps: 45, dpr: 1.65, shadowBlurBase: 7, shadowBlurBoost: 10 };
  }

  function armResearchMotionWindow(card) {
    var refs = ensureResearchCardRefs(card);
    if (!refs || !refs.details) return;
    refs.details.classList.add('ai-motion-window');
    clearTimeout(refs.details._motionWindowTimer);
    refs.details._motionWindowTimer = setTimeout(function() {
      refs.details.classList.remove('ai-motion-window');
    }, 380);
  }

  function shouldResearchCardAnimate(card) {
    if (!isResearchCard(card) || !card.isConnected || document.hidden) return false;
    var state = card._researchState || {};
    if (state.state !== 'preparing' && state.state !== 'thinking' && state.state !== 'researching') return false;
    return !(state.canToggle && card.classList.contains('collapsed'));
  }

  function syncResearchCardAnimatorState(card) {
    if (!isResearchCard(card) || !card._researchState || !card._researchState.animator) return;
    if (typeof card._researchState.animator.sync === 'function') card._researchState.animator.sync();
  }

  function syncResearchElapsed(card, ms) {
    if (!isResearchCard(card)) return;
    var refs = ensureResearchCardRefs(card);
    var state = card._researchState;
    if (!refs || !refs.meta || !state) return;
    state.elapsedMs = Math.max(0, ms || 0);
    if (state.state === 'responding' || state.state === 'done' || state.state === 'timeout' || state.state === 'interrupted' || state.state === 'cancelled') {
      refs.meta.textContent = '';
      return;
    }
    refs.meta.textContent = '已思考 ' + formatThinkDuration(state.elapsedMs);
  }

  function setResearchCardState(card, nextState, opts) {
    if (!isResearchCard(card)) return;
    opts = opts || {};
    var refs = ensureResearchCardRefs(card);
    var state = card._researchState;
    if (!refs || !state) return;
    if (nextState === 'error') nextState = 'interrupted';
    if ((state.state === 'timeout' || state.state === 'interrupted' || state.state === 'cancelled') && nextState === 'done') return;
    if (typeof opts.elapsedMs === 'number') state.elapsedMs = opts.elapsedMs;
    if (typeof opts.durationMs === 'number' && opts.durationMs >= 0) state.durationMs = opts.durationMs;
    if (typeof opts.agentCount === 'number') state.agentCount = opts.agentCount;
    if (typeof opts.allowToggle === 'boolean') state.canToggle = opts.allowToggle;
    if (typeof opts.stepCount === 'number') state.stepCount = opts.stepCount;
    if (typeof opts.searchCount === 'number') state.searchCount = opts.searchCount;
    if (typeof opts.persistExpanded === 'boolean') state.persistExpanded = opts.persistExpanded;
    if (typeof opts.progress === 'number') state.progress = opts.progress;
    state.state = nextState || state.state || 'preparing';

    if (state.stepCount > 0) state.canToggle = true;

    card.setAttribute('data-research-state', state.state);
    card.classList.remove('ai-research-preparing', 'ai-research-thinking', 'ai-research-researching', 'ai-research-responding', 'ai-research-done', 'ai-research-timeout', 'ai-research-interrupted', 'ai-research-cancelled', 'ai-research-error');
    card.classList.add('ai-research-' + state.state);
    if (state.state === 'interrupted') card.classList.add('ai-research-error');
    syncResearchFailureNote(card, null);

    if (state.state === 'responding' || state.state === 'done' || state.state === 'timeout' || state.state === 'interrupted' || state.state === 'cancelled') {
      card.classList.remove('generating');
      state.canToggle = true;
      var shouldExpandTerminal = state.persistExpanded ? true : !!opts.expanded;
      if (!shouldExpandTerminal && (state.state === 'timeout' || state.state === 'interrupted' || state.state === 'cancelled')) {
        shouldExpandTerminal = true;
      }
      setResearchDisclosure(card, shouldExpandTerminal);
      stopResearchCardAnimation(card);
    } else {
      card.classList.add('generating');
      setResearchDisclosure(card, state.persistExpanded ? true : false);
    }

    if (state.state === 'preparing') {
      refs.title.textContent = '深入研究中';
      refs.status.textContent = '正在进入深度思考...';
      syncResearchElapsed(card, state.elapsedMs || 0);
      setResearchSteps(card, 0, 0);
      updateResearchProgress(card, typeof state.progress === 'number' ? state.progress : 0.08);
    } else if (state.state === 'thinking') {
      refs.title.textContent = '深入研究中';
      refs.status.textContent = opts.statusText || AI_RESEARCH_THINKING_TEXTS[state.thinkingTick % AI_RESEARCH_THINKING_TEXTS.length];
      state.thinkingTick += 1;
      syncResearchElapsed(card, state.elapsedMs || 0);
      if (state.thinkingTick <= 1) setResearchSteps(card, 0, 0);
      else if (state.thinkingTick === 2) setResearchSteps(card, 1, 1);
      else setResearchSteps(card, 2, 2);
      updateResearchProgress(card, typeof state.progress === 'number' ? state.progress : Math.min(0.62, 0.18 + state.stepCount * 0.06));
    } else if (state.state === 'researching') {
      refs.title.textContent = '深入研究中';
      refs.status.textContent = opts.statusText || AI_RESEARCH_RESEARCH_TEXTS[state.researchTick % AI_RESEARCH_RESEARCH_TEXTS.length];
      state.researchTick += 1;
      syncResearchElapsed(card, state.elapsedMs || 0);
      if (state.researchTick <= 1) setResearchSteps(card, 1, 1);
      else setResearchSteps(card, 2, 2);
      updateResearchProgress(card, typeof state.progress === 'number' ? state.progress : Math.min(0.9, 0.68 + Math.max(state.searchCount || 0, state.researchTick) * 0.04));
    } else if (state.state === 'responding') {
      refs.title.textContent = '已思考 ' + formatThinkDuration(state.durationMs || state.elapsedMs || 0) + ' · 深入研究完成';
      refs.status.textContent = '正在生成回答...';
      refs.meta.textContent = '';
      setResearchSteps(card, 3, 3);
      updateResearchProgress(card, 0.96);
    } else if (state.state === 'done') {
      refs.title.textContent = '已思考 ' + formatThinkDuration(state.durationMs || state.elapsedMs || 0) + ' · 深入研究完成';
      refs.status.textContent = '研究摘要已生成，可展开查看思考过程。';
      refs.meta.textContent = '';
      setResearchSteps(card, -1, 4);
      updateResearchProgress(card, 1);
    } else if (state.state === 'timeout') {
      refs.title.textContent = '\u8fde\u63a5\u8d85\u65f6';
      refs.status.textContent = opts.statusText || '\u8d85\u8fc7 45 \u79d2\u672a\u6536\u5230\u65b0\u6570\u636e\uff0c\u672c\u6b21\u7814\u7a76\u5df2\u505c\u6b62\u3002';
      refs.meta.textContent = '';
      updateResearchProgress(card, Math.max(0.12, state.progress || 0));
      syncResearchFailureNote(card, refs.status.textContent);
    } else if (state.state === 'interrupted') {
      refs.title.textContent = '\u8fde\u63a5\u4e2d\u65ad';
      refs.status.textContent = opts.statusText || '\u672c\u6b21\u6df1\u5ea6\u7814\u7a76\u672a\u5b8c\u6210\u3002';
      refs.meta.textContent = '';
      updateResearchProgress(card, Math.max(0.12, state.progress || 0));
      syncResearchFailureNote(card, refs.status.textContent);
    } else if (state.state === 'cancelled') {
      refs.title.textContent = '已取消';
      refs.status.textContent = '已取消本次深入研究。';
      refs.meta.textContent = '';
      updateResearchProgress(card, Math.max(0.18, state.progress || 0));
      syncResearchFailureNote(card, refs.status.textContent);
    } else if (state.state === 'error') {
      refs.title.textContent = '研究失败，请重试';
      refs.status.textContent = opts.statusText || '本次深入研究未能完成。';
      refs.meta.textContent = '';
      updateResearchProgress(card, Math.max(0.12, state.progress || 0));
    }

    syncResearchCardAnimatorState(card);
    if (refs.stop) refs.stop.style.display = (state.state === 'preparing' || state.state === 'thinking' || state.state === 'researching') ? '' : 'none';
    if (refs.retry) refs.retry.style.display = (state.state === 'timeout' || state.state === 'interrupted' || state.state === 'cancelled') ? '' : 'none';
  }

  function createResearchCardAnimator(card) {
    if (!isResearchCard(card) || prefersReducedMotion()) return null;
    var refs = ensureResearchCardRefs(card);
    var canvas = refs && refs.canvas;
    if (!canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var profile = getResearchAnimationProfile();
    var state = { running: true, paused: false, rafId: 0, nodes: [], width: 0, height: 0, dpr: 1, profile: profile, lastFrameTs: 0, isOffscreen: false, observer: null };
    card.classList.toggle('ai-research-static', !profile.canvas);

    function scheduleFrame() {
      if (!state.running || state.paused || !state.profile.canvas) return;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(draw);
    }

    function resize() {
      if (!canvas.isConnected) return;
      var rect = canvas.getBoundingClientRect();
      state.width = Math.max(10, Math.floor(rect.width));
      state.height = Math.max(10, Math.floor(rect.height));
      state.dpr = Math.min(window.devicePixelRatio || 1, state.profile.dpr);
      canvas.width = state.width * state.dpr;
      canvas.height = state.height * state.dpr;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (!state.profile.canvas) {
        ctx.clearRect(0, 0, state.width, state.height);
        return;
      }
      var baseCount = state.width < 360 ? state.profile.minNodes : Math.min(state.profile.maxNodes, state.profile.minNodes + 8);
      var targetCount = Math.max(state.profile.minNodes, Math.min(state.profile.maxNodes, baseCount + Math.floor((state.width * state.height) / 24000)));
      state.nodes = Array.from({ length: targetCount }, function() {
        return {
          x: Math.random() * state.width,
          y: Math.random() * state.height,
          vx: (Math.random() - 0.5) * 0.24,
          vy: (Math.random() - 0.5) * 0.24,
          p: Math.random() * Math.PI * 2
        };
      });
    }

    function draw(ts) {
      if (!state.running || state.paused) return;
      if (state.profile.fps && state.lastFrameTs && ts - state.lastFrameTs < (1000 / state.profile.fps)) {
        state.rafId = requestAnimationFrame(draw);
        return;
      }
      state.lastFrameTs = ts;
      ctx.clearRect(0, 0, state.width, state.height);
      var mx = state.width / 2 + Math.cos(ts * 0.00055) * state.width * 0.12;
      var my = state.height / 2 + Math.sin(ts * 0.00085) * state.height * 0.12;
      for (var i = 0; i < state.nodes.length; i++) {
        var node = state.nodes[i];
        node.x += node.vx;
        node.y += node.vy;
        node.p += 0.018;
        if (node.x < 0 || node.x > state.width) node.vx *= -1;
        if (node.y < 0 || node.y > state.height) node.vy *= -1;
      }
      var lineLimit = Math.min(122, Math.max(96, state.width * 0.22));
      for (var a = 0; a < state.nodes.length; a++) {
        for (var b = a + 1; b < state.nodes.length; b++) {
          var n1 = state.nodes[a];
          var n2 = state.nodes[b];
          var dx = n1.x - n2.x;
          var dy = n1.y - n2.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < lineLimit) {
            var alpha = (1 - dist / lineLimit) * 0.24;
            ctx.strokeStyle = 'rgba(124, 255, 227, ' + alpha.toFixed(3) + ')';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.stroke();
          }
        }
      }
      for (var j = 0; j < state.nodes.length; j++) {
        var dot = state.nodes[j];
        var glowDx = dot.x - mx;
        var glowDy = dot.y - my;
        var glow = Math.max(0, 1 - Math.sqrt(glowDx * glowDx + glowDy * glowDy) / 210);
        ctx.beginPath();
        ctx.shadowColor = 'rgba(135,255,229,0.55)';
        ctx.shadowBlur = state.profile.shadowBlurBase + glow * state.profile.shadowBlurBoost;
        ctx.fillStyle = 'rgba(' + Math.round(132 + glow * 26) + ', ' + Math.round(234 + glow * 18) + ', 236, ' + (0.22 + glow * 0.42).toFixed(3) + ')';
        ctx.arc(dot.x, dot.y, 1.4 + Math.sin(dot.p) * 0.4 + glow, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      state.rafId = requestAnimationFrame(draw);
    }

    function pause() {
      state.paused = true;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    function resume() {
      if (!state.running || !state.paused || !state.profile.canvas) return;
      state.paused = false;
      scheduleFrame();
    }

    function sync() {
      var shouldRun = shouldResearchCardAnimate(card) && !state.isOffscreen;
      if (!state.profile.canvas) {
        if (!shouldRun) pause();
        return;
      }
      if (shouldRun) {
        if (state.paused) resume();
        else if (!state.rafId) scheduleFrame();
      } else {
        pause();
      }
    }

    function stop() {
      state.running = false;
      pause();
      try { window.removeEventListener('resize', resize); } catch (e) {}
      try { document.removeEventListener('visibilitychange', handleVisibility); } catch (e2) {}
      try { if (state.observer) state.observer.disconnect(); } catch (e3) {}
      ctx.clearRect(0, 0, state.width, state.height);
    }

    function handleVisibility() {
      if (!state.running) return;
      sync();
    }

    function handleIntersection(entries) {
      if (!entries || !entries.length) return;
      state.isOffscreen = !entries[0].isIntersecting;
      sync();
    }

    resize();
    window.addEventListener('resize', window.throttleRAF(resize));
    document.addEventListener('visibilitychange', handleVisibility);
    if (window.IntersectionObserver) {
      state.observer = new IntersectionObserver(handleIntersection, { threshold: 0.08 });
      state.observer.observe(card);
    }
    state.paused = !shouldResearchCardAnimate(card);
    if (state.profile.canvas && !state.paused) scheduleFrame();
    return { stop: stop, pause: pause, resume: resume, resize: resize, sync: sync };
  }

  function buildResearchCardShell(options) {
    options = options || {};
    var card = el('div', { class: 'ai-think-card ai-progress-card ai-research-card dt-simple-card collapsed generating ' + (options.extraClass || '') });
    card.innerHTML =
      '<div class="ai-think-header ai-research-header">' +
        '<span class="ai-think-icon ai-research-icon">' + AI_THINK_ICON + '</span>' +
        '<span class="ai-think-title ai-research-title">深入研究中</span>' +
        '<span class="ai-think-meta ai-research-meta">已思考 0s</span>' +
        '<span class="ai-think-chevron ai-research-chevron">▾</span>' +
      '</div>' +
      '<div class="ai-research-visual">' +
        '<canvas class="ai-research-particles" aria-hidden="true"></canvas>' +
        '<div class="ai-research-orbit" aria-hidden="true"></div>' +
        '<div class="ai-research-status">正在进入深度思考...</div>' +
        '<div class="ai-research-scan"><i></i></div>' +
        '<div class="ai-research-steps">' +
          AI_RESEARCH_STEPS.map(function(step) { return '<span>' + step + '</span>'; }).join('') +
        '</div>' +
        '<button type="button" class="ai-research-stop">停止思考</button>' +
        '<button type="button" class="ai-progress-stop ai-research-retry" style="display:none">\u91cd\u8bd5</button>' +
      '</div>' +
      '<div class="ai-think-body">' +
        '<details class="ai-think-thinking">' +
          '<summary><span class="ai-thinking-summary-text">查看思考过程 (0 步)</span><span class="ai-thinking-chevron">▾</span></summary>' +
          '<div class="ai-think-thinking-body"></div>' +
        '</details>' +
        '<div class="ai-think-answer"></div>' +
        '<div class="ai-msg-footer"></div>' +
      '</div>';
    card._researchState = {
      state: options.state || 'preparing',
      elapsedMs: options.elapsedMs || 0,
      durationMs: options.durationMs || 0,
      agentCount: options.agentCount || 0,
      canToggle: !!options.canToggle,
      thinkingTick: 0,
      researchTick: 0,
      stepCount: options.stepCount || 0,
      searchCount: options.searchCount || 0,
      persistExpanded: !!options.expanded,
      userPinnedOpen: !!options.expanded,
      progress: typeof options.progress === 'number' ? options.progress : 0.08,
      elapsedTimer: null,
      animator: null
    };
    ensureResearchCardRefs(card);
    var refs = card._researchRefs;
    if (refs && refs.stop) {
      refs.stop.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof options.cancelFn === 'function') options.cancelFn();
        else cancelDeepThink();
      });
    }
    if (refs && refs.header) {
      refs.header.addEventListener('click', function(ev) {
        var target = ev.target;
        if (target && target.closest && target.closest('.ai-research-stop')) return;
        if (!card._researchState.canToggle) return;
        var nextExpanded = card.classList.contains('collapsed');
        card._researchState.persistExpanded = nextExpanded;
        card._researchState.userPinnedOpen = nextExpanded;
        setResearchDisclosure(card, nextExpanded);
      });
    }
    if (refs && refs.retry) {
      refs.retry.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof options.retryFn === 'function') options.retryFn();
      });
    }
    if (refs && refs.details) {
      refs.details.addEventListener('toggle', function() {
        if (!card._researchState.canToggle) return;
        armResearchMotionWindow(card);
        card._researchState.persistExpanded = !!refs.details.open;
        card._researchState.userPinnedOpen = !!refs.details.open;
        card.classList.toggle('expanded', !!refs.details.open);
        card.classList.toggle('collapsed', !refs.details.open);
        syncResearchCardAnimatorState(card);
      });
    }
    setResearchDisclosure(card, !!options.expanded && !!options.canToggle);
    setResearchCardState(card, options.state || 'preparing', options);
    return card;
  }

  function buildDeepThinkProgressCard(options) {
    options = options || {};
    if (options.variant === 'research') {
      var researchCard = buildResearchCardShell({
        state: 'preparing',
        canToggle: false,
        extraClass: 'ai-research-card--loading',
        cancelFn: options.cancelFn,
        retryFn: options.retryFn
      });
      researchCard._researchState.startedAt = Date.now();
      researchCard._researchState.elapsedTimer = setInterval(function() {
        if (researchCard._done) return;
        syncResearchElapsed(researchCard, Date.now() - researchCard._researchState.startedAt);
      }, 1000);
      researchCard._researchState.animator = createResearchCardAnimator(researchCard);
      researchCard._cleanupTimer = function() {
        stopResearchCardAnimation(researchCard);
      };
      return researchCard;
    }
    var card = el('div', { class: 'ai-progress-card' });
    card.innerHTML =
      '<div class="ai-progress-header">' +
        '<span class="ai-progress-icon">' + AI_THINK_ICON + '</span>' +
        '<span class="ai-progress-title">思考中...</span>' +
        '<span class="ai-progress-elapsed">0s</span>' +
      '</div>' +
      '<div class="ai-progress-thinking-log" style="display:none"></div>' +
      '<button type="button" class="ai-progress-stop">鍋滄鎬濊€?/button>';
    card.querySelector('.ai-progress-stop').addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof options.cancelFn === 'function') options.cancelFn();
      else cancelDeepThink();
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

  // 鏇存柊杩涘害鍗?
  function updateDeepThinkProgressCard(card, evt) {
    if (!card) return;
    if (isResearchCard(card)) {
      var research = card._researchState || {};
      if (evt.type === 'heartbeat') {
        syncResearchElapsed(card, evt.elapsed_ms || research.elapsedMs || 0);
        return;
      }
      if (evt.type === 'deep_think_stage') {
        if (evt.stage === 'init') setResearchCardState(card, 'preparing', { elapsedMs: research.elapsedMs || 0, progress: 0.08 });
        else if (evt.stage === 'agent') setResearchCardState(card, 'thinking', { elapsedMs: research.elapsedMs || 0, progress: Math.max(research.progress || 0.12, 0.22) });
        else if (evt.stage === 'searching') setResearchCardState(card, 'researching', { elapsedMs: research.elapsedMs || 0, progress: Math.max(research.progress || 0.66, 0.72) });
        else if (evt.stage === 'done') setResearchCardState(card, 'done', { durationMs: research.durationMs || research.elapsedMs || 0, expanded: false, progress: 1 });
        else if (evt.stage === 'error') setResearchCardState(card, 'interrupted', { statusText: '研究失败，请重试', expanded: false });
        return;
      }
      if (evt.type === 'deep_think_tool') {
        var nextSearchCount = Math.max((research.searchCount || 0) + 1, 1);
        setResearchCardState(card, 'researching', {
          elapsedMs: research.elapsedMs || 0,
          searchCount: nextSearchCount,
          progress: Math.min(0.9, Math.max(research.progress || 0.68, 0.68 + nextSearchCount * 0.05))
        });
        return;
      }
      if (evt.type === 'thinking_chunk') {
        if (!card._thinkingLog) card._thinkingLog = [];
        card._thinkingLog.push({ agent_role: evt.agent_role, chunk: evt.chunk, round: evt.round || 0 });
        setResearchCardState(card, 'thinking', {
          elapsedMs: research.elapsedMs || 0,
          stepCount: card._thinkingLog.length,
          allowToggle: card._thinkingLog.length > 0,
          progress: Math.min(0.62, 0.18 + card._thinkingLog.length * 0.06)
        });
        return;
      }
      if (evt.type === 'done') {
        setResearchCardState(card, 'done', {
          durationMs: evt.think_duration_ms || research.elapsedMs || 0,
          expanded: false,
          agentCount: evt.agent_count || research.agentCount || 0,
          searchCount: evt.search_count || 0,
          progress: 1
        });
        return;
      }
      if (evt.type === 'error') {
        setResearchCardState(card, 'interrupted', { statusText: evt.error || '研究失败，请重试', expanded: false });
        return;
      }
    }
    // 鈽?U3: 缓存 querySelector 结果, 避免每个事件都做 DOM 查询
    if (!card._cached) {
      card._cached = {
        titleText: card.querySelector('.ai-progress-title'),
        logBox: card.querySelector('.ai-progress-thinking-log'),
        lastEntry: null
      };
    }
    var cached = card._cached;
    var titleText = cached.titleText;

    if (evt.type === 'deep_think_stage') {
      var stageMap = { init: '准备中...', agent: '思考中...', searching: '搜索中...', error: '失败' };
      if (titleText) titleText.textContent = stageMap[evt.stage] || evt.stage;
    } else if (evt.type === 'deep_think_tool') {
      if (titleText) titleText.textContent = '搜索中...';
    } else if (evt.type === 'thinking_chunk') {
      if (!card._thinkingLog) card._thinkingLog = [];
      card._thinkingLog.push({ agent_role: evt.agent_role, chunk: evt.chunk, round: evt.round || 0 });
      var logBox = cached.logBox;
      if (logBox) {
        if (logBox.style.display === 'none') logBox.style.display = '';
        var roleLabel = escapeHtml(evt.agent_role || 'AI');
        // 鈽?U3: 鍚岃鑹茬疮绉埌鏈€鍚庝竴涓潯鐩?(缂撳瓨 lastEntry 鍔犻€?
        if (cached.lastEntry && cached.lastEntry._role === roleLabel && cached.lastEntry.parentNode === logBox) {
          var lastChunk = cached.lastEntry.querySelector('.ai-thought-chunk');
          if (lastChunk) lastChunk.textContent = cleanReasoningText((lastChunk.textContent || '') + String(evt.chunk).slice(0, 4000));
        } else {
          var entry = el('div', { class: 'ai-thought-entry' });
          entry._role = roleLabel;
          entry.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + '</div><div class="ai-thought-chunk"></div>';
          entry.querySelector('.ai-thought-chunk').textContent = cleanReasoningText(String(evt.chunk).slice(0, 4000));
          logBox.appendChild(entry);
          cached.lastEntry = entry;
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
      card.classList.add('ai-progress-card-done');
    } else if (evt.type === 'error') {
      if (titleText) titleText.textContent = '思考中断';
      card.classList.add('ai-progress-card-error');
      card.classList.add('ai-progress-card-done');
    }
  }

  // 鍙栨秷深度思考冿紙convId 鍙€夛紝浜岀骇椤甸潰浣跨敤 S.dtConversationId锛?
  function cancelDeepThink(convId) {
    if (S.deepThinkJob) {
      try { S.deepThinkJob.abort(); } catch (e) {}
    }
    // Cleanup progress card timer and state
    if (S.deepThinkProgressCard) {
      if (isResearchCard(S.deepThinkProgressCard)) {
        try {
          setResearchCardState(S.deepThinkProgressCard, 'cancelled', {
            durationMs: (S.deepThinkProgressCard._researchState && (S.deepThinkProgressCard._researchState.durationMs || S.deepThinkProgressCard._researchState.elapsedMs)) || 0,
            expanded: false
          });
        } catch (e) {}
        try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e2) {}
        try { S.deepThinkProgressCard._done = true; } catch (e3) {}
      } else {
        try { S.deepThinkProgressCard.classList.add('ai-progress-card-done'); } catch (e4) {}
        try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e5) {}
        try { if (S.deepThinkProgressCard.parentNode) S.deepThinkProgressCard.parentNode.removeChild(S.deepThinkProgressCard); } catch (e6) {}
      }
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
      var tokenPromise = typeof window.ensureUserToken === 'function'
        ? Promise.resolve(window.ensureUserToken()).catch(function() { return ''; })
        : Promise.resolve('');
      tokenPromise.then(function(token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        return fetch(API_BASE + '/chat/cancel', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({ conversation_id: convId || S.conversationId || '' })
        });
      }).catch(function() {});
    } catch (e) {}
    notify('\u5df2\u53d6\u6d88\u601d\u8003');
  }

  async function ensureUserAuthOrNotify() {
    var preflight = window.ensureProtectedOperationAuth || window.ensureRealUserAuth;
    if (typeof preflight !== 'function') return true;
    try {
      var auth = await preflight();
      if (auth && auth.ok) return true;
      var reason = auth && auth.reason;
      if (reason === 'no_user') {
        notify('请先登录后再和小猫聊天');
        return false;
      }
    } catch (e) {
      try { console.warn('[AI-AUTH] ensureRealUserAuth error:', e && e.message); } catch(ee) {}
    }
    try { if (typeof window.handleProtectedAuthFailure === 'function') window.handleProtectedAuthFailure(); } catch (e2) {}
    return false;
  }

  // ===================== 共享 SSE 处理循环 =====================
  // 琚?handleSendDeepThink 鍜?handleDeepThinkPageSend 共用
  async function processDeepThinkSSE(opts) {
    var reader = opts.reader;
    var controller = opts.controller;
    var progressCard = opts.progressCard;
    var reqId = opts.reqId;
    var aiNodeRef = opts.aiNodeRef;       // { value: null } 引用, 内部更新
    var aiContentRef = opts.aiContentRef;   // { value: '' }
    var finalMetaRef = opts.finalMetaRef;
    var finalModelRef = opts.finalModelRef;
    var finalThinkingModeRef = opts.finalThinkingModeRef;
    var answerRendererRef = opts.answerRendererRef;
    var contentRendererRef = opts.contentRendererRef;
    var answerStartedRef = opts.answerStartedRef;
    var doneReceivedRef = opts.doneReceivedRef;
    var evtHandledRef = opts.evtHandledRef;
    var streamConvIdRef = opts.streamConvIdRef;
    var abortedRef = opts.abortedRef;
    var messagesEl = opts.messagesEl;
    var scrollEl = opts.scrollEl || messagesEl;

    var decoder = new TextDecoder();
    var buffer = '';
    var timedOut = false;
    var MAX_EVENT_SIZE = 512 * 1024; // 512KB

    function safeRemoveProgressCard(removeNode) {
      if (!progressCard) return;
      if (isResearchCard(progressCard)) {
        try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e) {}
        try { progressCard._done = true; } catch (e2) {}
        if (removeNode && progressCard.parentNode) {
          try { progressCard.remove(); } catch (e3) {}
        }
        return;
      }
      try { progressCard.classList.add('ai-progress-card-done'); } catch (e4) {}
      try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e5) {}
      if (removeNode !== false) {
        try { progressCard.remove(); } catch (e6) {}
      }
      try { progressCard._done = true; } catch (e7) {}
    }

    function ensureThinkCardNode() {
      if (aiNodeRef.value) return aiNodeRef.value;
      if (isResearchCard(progressCard)) {
        aiNodeRef.value = progressCard;
        return aiNodeRef.value;
      }
      safeRemoveProgressCard();
      var node = el('div', { class: 'ai-think-card expanded generating' });
      node.innerHTML =
        '<div class="ai-think-header">' +
          '<span class="ai-think-title">思考中...</span>' +
          '<span class="ai-think-meta"></span>' +
          '<span class="ai-think-chevron">▾</span>' +
        '</div>' +
        '<div class="ai-think-body">' +
          '<details class="ai-think-thinking">' +
            '<summary><span>查看思考过程</span></summary>' +
            '<div class="ai-think-thinking-body"></div>' +
          '</details>' +
        '</div>' +
        '<div class="ai-think-answer"></div>' +
        '<div class="ai-msg-footer"></div>';
      var headerEl = node.querySelector('.ai-think-header');
      var chevronEl = node.querySelector('.ai-think-chevron');
      headerEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isCollapsed = node.classList.contains('collapsed');
        if (isCollapsed) {
          node.classList.remove('collapsed');
          node.classList.add('expanded');
          if (chevronEl) chevronEl.textContent = '▾';
        } else {
          node.classList.add('collapsed');
          node.classList.remove('expanded');
          if (chevronEl) chevronEl.textContent = '▸';
        }
      });
      messagesEl.appendChild(node);
      aiNodeRef.value = node;
      S.autoScrollPinned = true;
      scrollToBottom(scrollEl, true);
      return node;
    }

    function finishThinkCard(node, content, evt) {
      if (!node) return;
      if (isResearchCard(node) && node._researchState &&
          (node._researchState.state === 'timeout' || node._researchState.state === 'interrupted' || node._researchState.state === 'cancelled')) return;
      node.classList.remove('generating');
      node.classList.add('done');

      var searchCount = evt ? (evt.search_count || 0) : 0;
      var searchQuery = evt ? (evt.search_query || '') : '';
      var searchResults = evt && Array.isArray(evt.search_results) ? evt.search_results : null;
      var usage = evt && evt.usage ? evt.usage : null;
      var agentCount = evt && evt.agent_count ? evt.agent_count : 0;
      var thinkingLog = evt && Array.isArray(evt.thinking_log) ? evt.thinking_log : [];
      var thinkDurationMs = evt && typeof evt.think_duration_ms === 'number' ? evt.think_duration_ms : 0;
      var finalThinkingMode = finalThinkingModeRef.value || 'max';
      var answerEl = node.querySelector('.ai-think-answer');
      var detailsEl = node.querySelector('.ai-think-thinking');
      var thinkLogBox = node.querySelector('.ai-think-thinking-body');
      var summaryTextEl = node.querySelector('.ai-thinking-summary-text') || node.querySelector('.ai-think-thinking summary span');

      function finalizeAnswer() {
        if (answerEl) setupBubbleCopy(answerEl, messagesEl);
        if (!isResearchCard(node)) {
          var titleEl2 = node.querySelector('.ai-think-title');
          if (titleEl2) titleEl2.textContent = '已思考';
        }
      }

      if (answerEl) {
        var contentForRender = content || '';
        if (answerRendererRef.value) {
          answerRendererRef.value.finish(contentForRender);
          answerRendererRef.value = null;
          finalizeAnswer();
        } else {
          if (contentRendererRef.value) { try { contentRendererRef.value.stop(); } catch (e8) {} }
          answerEl.innerHTML = '';
          contentRendererRef.value = createSmoothTextRenderer(answerEl, { minChunk: 2, maxChunk: 6, onDone: function() { finalizeAnswer(); } });
          contentRendererRef.value.append(contentForRender);
          contentRendererRef.value.finish(contentForRender);
          contentRendererRef.value = null;
        }
      }

      var mergedLog = [];
      for (var tli = 0; tli < thinkingLog.length; tli++) {
        var entryRaw = thinkingLog[tli];
        var lastMerged = mergedLog[mergedLog.length - 1];
        if (lastMerged && lastMerged.agent_role === (entryRaw.agent_role || 'AI') && lastMerged.round === (entryRaw.round || 0)) {
          lastMerged.chunk = (lastMerged.chunk || '') + (entryRaw.chunk || '');
        } else {
          mergedLog.push({ agent_role: entryRaw.agent_role || 'AI', chunk: entryRaw.chunk || '', round: entryRaw.round || 0 });
        }
      }

      if (detailsEl) detailsEl.style.display = mergedLog.length ? '' : 'none';
      if (thinkLogBox && mergedLog.length > 0) {
        thinkLogBox.innerHTML = '';
        mergedLog.forEach(function(entry) {
          var entEl = el('div', { class: 'ai-thought-entry' });
          var roundLabel = entry.round ? (' · 第' + entry.round + '轮') : '';
          entEl.innerHTML = '<div class="ai-thought-role">' + escapeHtml(entry.agent_role || 'AI') + escapeHtml(roundLabel) + '</div><div class="ai-thought-chunk"></div>';
          entEl.querySelector('.ai-thought-chunk').textContent = cleanReasoningText(String(entry.chunk || '').slice(0, 4000));
          thinkLogBox.appendChild(entEl);
        });
      }
      if (summaryTextEl) summaryTextEl.textContent = '查看思考过程 (' + mergedLog.length + ' 步)';

      var footer = node.querySelector('.ai-msg-footer');
      if (footer) {
        footer.innerHTML = '';
        footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(new Date().toISOString()) }));
        footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: finalThinkingMode + ' 思考' }));
        if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
        if (searchCount > 0) footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '已研究 ' + searchCount + ' 个来源' }));
        if (usage || finalModelRef.value) {
          var usageLine = buildUsageLine(Object.assign({}, usage || {}, { model: finalModelRef.value, thinking_mode: finalThinkingMode, deep_think: true, agent_count: agentCount }));
          if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
        }
      }

      if (searchResults && searchResults.length > 0 && searchQuery) {
        var refs = isResearchCard(node) ? ensureResearchCardRefs(node) : null;
        if (refs && refs.searchBox && refs.searchBox.parentNode) {
          try { refs.searchBox.parentNode.removeChild(refs.searchBox); } catch (e9) {}
          refs.searchBox = null;
        }
        var searchBox = document.createElement('div');
        searchBox.className = 'ai-search-supplement';
        var searchHtml = '研究来源: <strong>' + escapeHtml(searchQuery) + '</strong> (' + searchResults.length + ' 条结果)<br>';
        searchResults.slice(0, 5).forEach(function(sr, si) {
          if (sr.url) searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(sr.url) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.title || sr.url) + '</a><br>';
        });
        if (searchResults.length > 5) searchHtml += '<span style="font-size:10px;color:#999">... 还有 ' + (searchResults.length - 5) + ' 条来源</span>';
        searchBox.innerHTML = searchHtml;
        var thinkBody = node.querySelector('.ai-think-body');
        if (thinkBody) {
          if (answerEl) thinkBody.insertBefore(searchBox, answerEl);
          else thinkBody.appendChild(searchBox);
        }
        if (refs) refs.searchBox = searchBox;
      }

      if (isResearchCard(node)) {
        node._researchState.durationMs = thinkDurationMs || node._researchState.elapsedMs || 0;
        node._researchState.agentCount = agentCount;
        node._researchState.searchCount = searchCount;
        setResearchCardState(node, 'done', {
          durationMs: node._researchState.durationMs,
          agentCount: agentCount,
          searchCount: searchCount,
          expanded: false
        });
        return;
      }

      var titleEl = node.querySelector('.ai-think-title');
      var metaEl = node.querySelector('.ai-think-meta');
      if (titleEl) titleEl.textContent = '已思考 ' + formatThinkDuration(thinkDurationMs);
      if (metaEl) metaEl.textContent = '';
      if (node.classList.contains('collapsed')) {
        node.classList.remove('collapsed');
        node.classList.add('expanded');
      }
    }

    var _lastDataTime = Date.now();
    var _idleCheckTimer = setInterval(function() {
      if (Date.now() - _lastDataTime > 45000) {
        timedOut = true;
        if (isResearchCard(progressCard)) {
          markResearchCardOutcome(progressCard, 'timeout', '\u8d85\u8fc7 45 \u79d2\u672a\u6536\u5230\u65b0\u6570\u636e\uff0c\u672c\u6b21\u7814\u7a76\u5df2\u505c\u6b62\u3002');
        }
        try { reader.cancel(); } catch (e) {}
        if (abortedRef) abortedRef.value = true;
      }
    }, 5000);
    function _resetIdle() { _lastDataTime = Date.now(); }

    while (true) {
      if (S._currentReqId !== reqId || controller.signal.aborted || (abortedRef && abortedRef.value)) {
        if (abortedRef) abortedRef.value = true;
        if (reader) try { reader.cancel(); } catch (e) {}
        break;
      }
      var readResult;
      try { readResult = await reader.read(); } catch (e) {
        if (!timedOut && isResearchCard(progressCard) && progressCard._researchState.state !== 'cancelled') {
          markResearchCardOutcome(progressCard, 'interrupted', '\u672c\u6b21\u6df1\u5ea6\u7814\u7a76\u4e2d\u65ad\u3002');
        }
        break;
      }
      if (readResult.done) {
        // ★ EOF: flush TextDecoder 剩余 buffer
        if (buffer) {
          buffer += decoder.decode();
          var eofLines = buffer.split('\n');
          for (var ei = 0; ei < eofLines.length; ei++) {
            var eLine = eofLines[ei];
            // 支持 CRLF
            eLine = eLine.replace(/\r$/, '');
            if (!eLine || eLine.startsWith(':')) continue;
            if (eLine.startsWith('data: ')) {
              var eEventStr = eLine.slice(6);
              if (eEventStr.length > MAX_EVENT_SIZE) continue;
              var eEvt;
              try { eEvt = JSON.parse(eEventStr); } catch (ex) { continue; }
              if (eEvt) _handleSseEvent(eEvt);
            }
          }
          buffer = '';
        }
        break;
      }
      _resetIdle();
      buffer += decoder.decode(readResult.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        // 支持 CRLF
        line = line.replace(/\r$/, '');
        // 忽略空行和注释行（heartbeat comments）
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data: ')) continue;
        var eventStr = line.slice(6);
        // 大小限制
        if (eventStr.length > MAX_EVENT_SIZE) continue;
        var evt;
        try { evt = JSON.parse(eventStr); } catch (e) {
          // Malformed JSON - 跳过，不阻塞其他事件
          continue;
        }
        if (!evt) continue;
        _handleSseEvent(evt);
      }

    // SSE 事件处理函数
    function _handleSseEvent(evt) {
      if (S._currentReqId !== reqId) { if (abortedRef) abortedRef.value = true; return; }

        if (evt.type === 'meta') {
          if (streamConvIdRef) streamConvIdRef.value = evt.conversation_id;
          return;
        }
        if (evt.type === 'heartbeat' || evt.type === 'deep_think_stage' || evt.type === 'deep_think_planned' || evt.type === 'deep_think_tool' || evt.type === 'deep_think_init') {
          updateDeepThinkProgressCard(progressCard, evt);
          return;
        }
        if (evt.type === 'thinking_chunk') {
          if (!aiNodeRef.value) ensureThinkCardNode();
          if (evt.chunk) {
            updateDeepThinkProgressCard(progressCard, evt);
            var thinkBody = aiNodeRef.value.querySelector('.ai-think-thinking-body');
            var detailsEl = aiNodeRef.value.querySelector('.ai-think-thinking');
            var summaryEl = aiNodeRef.value.querySelector('.ai-thinking-summary-text') || aiNodeRef.value.querySelector('.ai-think-thinking summary span:last-child');
            if (thinkBody) {
              var roleLabel = evt.agent_role || 'AI 智能体';
              var chunkText = String(evt.chunk).slice(0, 4000);
              var lastEntry = thinkBody.lastElementChild;
              if (lastEntry && lastEntry._role === roleLabel) {
                var lc = lastEntry.querySelector('.ai-thought-chunk');
                if (lc) lc.textContent = cleanReasoningText((lc.textContent || '') + chunkText);
              } else {
                var entry = document.createElement('div');
                entry.className = 'ai-thought-entry'; entry._role = roleLabel;
                entry.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + '</div><div class="ai-thought-chunk"></div>';
                entry.querySelector('.ai-thought-chunk').textContent = cleanReasoningText(chunkText);
                thinkBody.appendChild(entry);
              }
              try { thinkBody.scrollTop = thinkBody.scrollHeight; } catch (e) {}
              while (thinkBody.children.length > 80) thinkBody.removeChild(thinkBody.firstChild);
            }
            if (summaryEl) summaryEl.textContent = '查看思考过程 (' + (thinkBody ? thinkBody.children.length : 0) + ' 步)';
            if (detailsEl && !detailsEl.open && !isResearchCard(aiNodeRef.value)) detailsEl.open = true;
            var tTitle = aiNodeRef.value.querySelector('.ai-think-title');
            if (tTitle && !isResearchCard(aiNodeRef.value)) tTitle.textContent = '思考中...';
          }
          scrollToBottom(scrollEl, false);
          return;
        }
        if (evt.type === 'answer_chunk') {
          if (!evt.chunk) return;
          if (!aiNodeRef.value) ensureThinkCardNode();
          if (!answerStartedRef.value) {
            answerStartedRef.value = true;
            if (typeof opts.onAnswerStart === 'function') {
              try { opts.onAnswerStart(aiNodeRef.value, evt); } catch (e0) {}
            }
            var tT = aiNodeRef.value.querySelector('.ai-think-title');
            if (tT && !isResearchCard(aiNodeRef.value)) tT.textContent = '回答中...';
          }
          var aEl = aiNodeRef.value.querySelector('.ai-think-answer');
          if (aEl && !answerRendererRef.value) {
            aEl.innerHTML = '';
            answerRendererRef.value = createSmoothTextRenderer(aEl, { minChunk: 1, maxChunk: 3, plainStream: true });
          }
          aiContentRef.value += String(evt.chunk);
          if (answerRendererRef.value) answerRendererRef.value.append(evt.chunk);
          scrollToBottom(scrollEl, false);
          return;
        }
        if (evt.type === 'content') {
          aiContentRef.value += evt.text || '';
          ensureThinkCardNode();
          if (!answerStartedRef.value && evt.text) {
            answerStartedRef.value = true;
            if (typeof opts.onAnswerStart === 'function') {
              try { opts.onAnswerStart(aiNodeRef.value, evt); } catch (e10) {}
            }
          }
          return;
        }
        if (evt.type === 'error') {
          if (isResearchCard(progressCard)) {
            safeRemoveProgressCard(false);
            if (!aiNodeRef.value) ensureThinkCardNode();
            preserveResearchAnswer(progressCard, aiContentRef.value);
            markResearchCardOutcome(progressCard, 'interrupted', evt.error || '研究失败，请重试');
          } else {
            safeRemoveProgressCard();
          }
          if (aiContentRef.value && !isResearchCard(progressCard)) {
            ensureThinkCardNode();
            aiNodeRef.value.appendChild(el('div', { class: 'ai-error-note' }, evt.error || 'AI 调用失败'));
            finishThinkCard(aiNodeRef.value, aiContentRef.value, evt);
          } else {
            notify(evt.error || 'AI 调用失败');
            if (!isResearchCard(progressCard) && opts.onErrorNoContent) opts.onErrorNoContent();
          }
          if (opts.onResetSending) opts.onResetSending();
          if (reader) try { reader.cancel(); } catch (e) {}
          if (abortedRef) abortedRef.value = true;
          if (doneReceivedRef) doneReceivedRef.value = true;
          return;
        }
        if (evt.type === 'done') {
          safeRemoveProgressCard(isResearchCard(progressCard) ? false : undefined);
          S.sending = false; S.paused = false; S.activeRenderers = []; S.abortController = null; S.deepThinkJob = null; S.deepThinkProgressCard = null;
          if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
          if (progressCard) { try { progressCard._done = true; } catch (e) {} }
          try {
            finalModelRef.value = evt.model || 'deepseek-v4-flash';
            finalThinkingModeRef.value = evt.thinking_mode || opts.defaultThinkingMode || 'max';
            aiContentRef.value = evt.sanitized_content || evt.content || '';
            if (finalMetaRef) finalMetaRef.value = evt;
          } catch (e) {}
          if (!aiNodeRef.value) ensureThinkCardNode();
          if (!aiContentRef.value || !String(aiContentRef.value).trim()) aiContentRef.value = 'AI 只返回了思考过程，没有生成正文回复。';
          finishThinkCard(aiNodeRef.value, aiContentRef.value, evt);
          if (doneReceivedRef) doneReceivedRef.value = true;
          if (evtHandledRef) evtHandledRef.value = true;
          try { clearInterval(_idleCheckTimer); } catch (e) {}
          return;
        }
      }
      if (doneReceivedRef && doneReceivedRef.value) return;
      if (abortedRef && abortedRef.value) return;
    }
    try { clearInterval(_idleCheckTimer); } catch (e) {}
    return {
      aborted: abortedRef ? abortedRef.value : false,
      timedOut: timedOut,
      aiContent: aiContentRef.value,
      doneReceived: doneReceivedRef ? doneReceivedRef.value : false,
      evtHandled: evtHandledRef ? evtHandledRef.value : false
    };
  }

  // ===================== M: 深度思考冩ā寮忓彂閫?=====================
  // 鐙珛娴佺▼: 璧?/api/agent/chat (deep_think=true) SSE 闀胯繛鎺?
  //   杩涘害鍗″疄鏃舵洿鏂?(1-10 涓?agent 鐘舵€?
  //   done 鍚庢覆鏌撴渶缁堢瓟妗?+ [来源N] 标注 + 搜索徽章
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

    // 鈽?U3 P0-3 修复: 只有存在真实的旧请求时才 abort, 避免误杀自己
    if (S.abortController || S.deepThinkJob) {
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
    
    if (S.pauseBtnEl) S.pauseBtnEl.style.display = '';
    clearReplyTimer();

    // 1. 追加 user 消息
    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: text, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);
    S.autoScrollPinned = true;
    scrollToBottom(messagesEl, true);

    // 2. 鍒涘缓杩涘害鍗?(鑰屼笉鏄?typing node)
    var progressCard = buildDeepThinkProgressCard();
    progressCard.classList.add('dt-animate-in');
    S.deepThinkProgressCard = progressCard;
    messagesEl.appendChild(progressCard);
    scrollToBottom(messagesEl, true);

    // 3. 娓呯┖杈撳叆妗?
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
      chat_mode: 'normal',
      // 鈽?P 鏂板: 浼犳€濊€冪▼搴︾粰鍚庣 runMultiAgentFlow (后端会用这个, 不用 config)
      thinking_mode: S.deepThinkEffort || 'max'
    });

    var aborted = false;
    var aiContent = '';
    var finalMeta = null;
    var finalModel = '';
    // 鈽?P 鏀? 鐢?S.deepThinkEffort (浠庡悗绔?config 同步) 替代写死 'high'
    var finalThinkingMode = S.deepThinkEffort || 'max';
    var streamConvId = null;
    var aiNode = null;
    var aiBubble = null;
    var contentRenderer = null;
    var answerRenderer = null;  // V2: 娴佸紡绛旀娓叉煋鍣?answer_chunk鐢?
    var answerStarted = false; // V2: 鏄惁宸茶繘鍏ュ洖绛旈樁娈?
    var doneReceived = false;
    var evtHandled = false;

    function safeRemoveProgressCard() {
      if (progressCard) {
        try { progressCard.classList.add('ai-progress-card-done'); } catch (e) {}
        try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e) {}
        try { progressCard.remove(); } catch (e) {}
        try { progressCard._done = true; } catch (e) {}
      }
    }

    function ensureThinkCardNode() {
      if (aiNode) return aiNode;
      safeRemoveProgressCard()
      var node = el('div', { class: 'ai-think-card expanded generating' });
      node.innerHTML =
        '<div class="ai-think-header">' +
          '<span class="ai-think-title">思考中…</span>' +
          '<span class="ai-think-meta"></span>' +
          '<span class="ai-think-chevron">▾</span>' +
        '</div>' +
        '<div class="ai-think-body">' +
          '<details class="ai-think-thinking">' +
            '<summary><span>查看思考过程</span></summary>' +
            '<div class="ai-think-thinking-body"></div>' +
          '</details>' +
        '</div>' +
        '<div class="ai-think-answer"></div>' +
        '<div class="ai-msg-footer"></div>';
      var headerEl = node.querySelector('.ai-think-header');
      var chevronEl = node.querySelector('.ai-think-chevron');
      headerEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isCollapsed = node.classList.contains('collapsed');
        if (isCollapsed) {
          node.classList.remove('collapsed');
          node.classList.add('expanded');
          if (chevronEl) chevronEl.textContent = '▾';
        } else {
          node.classList.add('collapsed');
          node.classList.remove('expanded');
          if (chevronEl) chevronEl.textContent = '▸';
        }
      });
      messagesEl.appendChild(node);
      aiNode = node;
      S.autoScrollPinned = true;
      scrollToBottom(messagesEl, true);
      return node;
    }

    // 鈽?O 修复 Bug 4: 鏋勯€?think-card (鍙栦唬鏅€?ai-msg 节点)
    //   鎶樺彔鎬? 澶撮儴鏄剧ず "鈿?已思考 38s 路 5 涓?agent" + 折叠按钮
    //   灞曞紑鎬? 椤堕儴鎬濊€冭繃绋嬫棩蹇?+ 搴曢儴鏈€缁堢瓟妗?(markdown)
    //   閫€鍑哄璇濇閲嶈繘鍚? think-card 浠?history 恢复
    function finishThinkCard(node, content, evt) {
      if (isResearchCard(node) && node._researchState &&
          (node._researchState.state === 'timeout' || node._researchState.state === 'interrupted' || node._researchState.state === 'cancelled')) return;
      if (node) node.classList.remove('generating');
      if (node) node.classList.add('done');

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
        // 鈽?P 鏀? 鐢?finalThinkingMode (鍚庣鍔ㄦ€? 鏇夸唬鍐欐 'max'
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
        // 鈽?P 鏀? usage.thinking_mode 鍚屾瀹為檯鍊?
        usage: Object.assign({}, usage || {}, { model: finalModel, thinking_mode: finalThinkingMode, deep_think: true, agent_count: agentCount })
      };
      S.messages.push(aiMsg);

      if (node) {
        var contentForRender = content || '';
        var answerEl = node.querySelector('.ai-think-answer');
        function finalizeAnswer() {
          setupBubbleCopy(answerEl, messagesEl);
          var titleEl = node.querySelector('.ai-think-title');
          if (titleEl) titleEl.textContent = '已思考';
        }
        if (answerEl) {
          if (answerRenderer) {
            // V2: 流式渲染已在 answer_chunk 涓繘琛? done 时只 finish 鎴?markdown
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

        // 娓叉煋鎬濊€冭繃绋嬫棩蹇?(鏀捐繘 <details> 鍐? 鍏堝悎骞跺悓瑙掕壊杩炵画鏉＄洰)
        var thinkLogBox = node.querySelector('.ai-think-thinking-body');
        if (thinkLogBox && thinkingLog.length > 0) {
          thinkLogBox.innerHTML = '';
          // 鍚堝苟鍚岃鑹茶繛缁潯鐩?
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
            var roundLabel = entry.round ? (' · 第' + entry.round + '轮') : '';
            entEl.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + escapeHtml(roundLabel) + '</div><div class="ai-thought-chunk"></div>';
          entEl.querySelector('.ai-thought-chunk').textContent = cleanReasoningText(String(entry.chunk || '').slice(0, 4000));
            thinkLogBox.appendChild(entEl);
          });
          var summaryEl = node.querySelector('.ai-think-thinking summary');
          if (summaryEl) {
            var sumSpan = summaryEl.querySelector('span:last-child');
            if (sumSpan) sumSpan.textContent = '查看思考过程 (' + mergedLog.length + ' 步)';
          }
        } else {
          // 娌℃湁鎬濊€冭繃绋? 闅愯棌 details
          var detailsEl = node.querySelector('.ai-think-thinking');
          if (detailsEl) detailsEl.style.display = 'none';
        }

        var footer = node.querySelector('.ai-msg-footer');
        if (footer) {
          footer.innerHTML = '';
          if (aiMsg.created_at) footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(aiMsg.created_at) }));
          // V2: 绠€娲佹ā寮忔爣绛? 鍘绘帀閲嶅 sparkle
          footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: (finalThinkingMode || 'max') + ' 思考' }));
          if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
          if (searchCount > 0) footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '已研究 ' + searchCount + ' 个来源' }));
          if (usage || finalModel) {
            var usageLine = buildUsageLine(aiMsg.usage);
            if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
          }
        }

        // 鏍囬 + 鏃堕棿 (鏀?header)
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
        // V2: 去掉重复 sparkle (footer 已有模式标签), header 鍙斁绾枃瀛?已思考 Xs"
        if (titleEl) titleEl.textContent = '已思考 ' + durationStr;
        // V2: 去掉重复 1 agent (footer 已有 agent-badge), header meta 留空
        if (metaEl) metaEl.textContent = '';

        if (node.classList.contains('collapsed')) {
          node.classList.remove('collapsed');
          node.classList.add('expanded');
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
        try { var ej = await resp.json().catch(function(){}); if (S._currentReqId !== reqId) return; safeRemoveProgressCard(); notify(String((ej&&ej.error)||('AI 失败 ('+resp.status+')'))); } catch(e){}
        resetSendingIfCurrent(); return;
      }
      if (!resp.body) {
        safeRemoveProgressCard(isResearchCard(progressCard) ? false : undefined);
        if (isResearchCard(progressCard)) {
          setResearchCardState(progressCard, 'error', { statusText: '研究失败，请重试', expanded: false });
        } else {
          notify('AI 没有响应');
        }
        resetSendingIfCurrent();
        return;
      }

      var reader = resp.body.getReader();
      var r = { value: null }, c = { value: '' }, fm = {}, fmod = { value: '' }, ft = { value: S.deepThinkEffort || 'max' };
      var ar = { value: null }, cr = { value: null }, as = { value: false }, dr = { value: false }, eh = { value: false };
      var sc = { value: null }, ab = { value: false };
      var sseResult = await processDeepThinkSSE({
        reader: reader, controller: controller, progressCard: progressCard, reqId: reqId,
        aiNodeRef: r, aiContentRef: c, finalMetaRef: fm, finalModelRef: fmod, finalThinkingModeRef: ft,
        answerRendererRef: ar, contentRendererRef: cr, answerStartedRef: as, doneReceivedRef: dr, evtHandledRef: eh,
        streamConvIdRef: sc, abortedRef: ab, messagesEl: messagesEl, scrollEl: messagesEl,
        defaultThinkingMode: S.deepThinkEffort || 'max',
        onErrorNoContent: function() { S.messages.pop(); removeLastUserMessage(messagesEl); restoreInputText(); },
        onResetSending: resetSendingIfCurrent
      });
      if (sc.value) { S.conversationId = sc.value; writeConvId(sc.value); }
      if (S._currentReqId !== reqId || ab.value) {
        safeRemoveProgressCard(); if (ar.value) try { ar.value.cancel(); } catch(e){}
        if (r.value) try { r.value.remove(); } catch(e){} resetSendingIfCurrent(); return;
      }
      safeRemoveProgressCard(); S.paused = false; S.activeRenderers = [];
      if (progressCard) try { progressCard._done = true; } catch(e){}
      if (!eh.value) {
        if (r.value && c.value) { finishThinkCard(r.value, c.value, fm.value); }
        else if (!dr.value && c.value) { if (!r.value) ensureThinkCardNode(); finishThinkCard(r.value, c.value, fm.value); }
        else if (!dr.value) { S.messages.pop(); removeLastUserMessage(messagesEl); restoreInputText(); notify('AI 暂时没有回应'); }
      }
    } catch (fetchErr) {
      if (S._currentReqId !== reqId) { safeRemoveProgressCard(); return; }
      safeRemoveProgressCard(); if (progressCard) try { progressCard._done = true; } catch(e){}
      S.paused = false; S.activeRenderers = [];
      if (fetchErr && fetchErr.name !== 'AbortError') {
        if (c && c.value) { if (!r.value) ensureThinkCardNode(); r.value.appendChild(el('div',{class:'ai-error-note'},'连接中断')); finishThinkCard(r.value, c.value, fm.value); }
        else { S.messages.pop(); removeLastUserMessage(messagesEl); restoreInputText(); notify('网络异常'); }
      } else {
        if (c && c.value) { if (!r.value) ensureThinkCardNode(); finishThinkCard(r.value, c.value, fm.value); }
        else { S.messages.pop(); removeLastUserMessage(messagesEl); }
      }
    }
    resetSendingIfCurrent();
    if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
    updateInputMetrics();
    scrollToBottom(messagesEl, false);
  }

  // ===================== 深度思考冧簩绾ч〉闈?=====================

  function resetDeepThinkPageEmpty() {
    var msgs = document.getElementById('dtMessages');
    if (!msgs) return;
    msgs.innerHTML = '';
    msgs.appendChild(el('div', { class: 'dt-empty' }, [
      el('div', { class: 'dt-empty-icon', text: '🐾' }),
      el('div', { class: 'dt-empty-title', text: '深度思考' }),
      el('div', { class: 'dt-empty-desc', text: '输入复杂问题，AI 会调用多阶段分析、检索和整理流程来生成回答。' })
    ]));
  }

  var secondaryPageOwners = {};

  function updateSecondaryPageState(open, owner) {
    owner = owner || 'deep-think';
    try {
      if (window.XTJSecondaryPageState) {
        if (open && !secondaryPageOwners[owner]) {
          window.XTJSecondaryPageState.open(owner);
          secondaryPageOwners[owner] = true;
        } else if (!open && secondaryPageOwners[owner]) {
          window.XTJSecondaryPageState.close(owner);
          delete secondaryPageOwners[owner];
        }
      } else if (window.restoreMainNavigationState) {
        window.restoreMainNavigationState();
      }
    } catch (e) {}
  }

  function saveDtConvId() {
    try { if (S.dtConversationId) localStorage.setItem(DT_CONV_KEY, S.dtConversationId); else localStorage.removeItem(DT_CONV_KEY); } catch (e) {}
  }

  async function openDeepThinkPage() {
    if (!window.currentUser) {
      notify('请先登录后再使用深度思考');
      return;
    }
    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) return;

    var panel = document.getElementById('panelDeepThink');
    if (!panel) return;

    var msgs = document.getElementById('dtMessages');
    if (!msgs) return;

    // 先从 localStorage 恢复会话 ID锛堝埛鏂伴〉闈㈠悗涔熻兘鎭㈠锛?
    if (!S.dtConversationId) {
      try { var saved = localStorage.getItem(DT_CONV_KEY); if (saved) S.dtConversationId = saved; } catch (e) {}
    }

    // 宸叉湁浼氳瘽 鈫?濡傛灉娑堟伅鍖轰笉涓虹┖涓斾笉鏄〉闈㈠埛鏂帮紝鐩存帴鏄剧ず缂撳瓨鍐呭
    if (S.dtConversationId && msgs.children.length > 0 && !msgs.querySelector('.dt-empty, .dt-loading')) {
      // 宸叉湁缂撳瓨鐨?DOM 鍐呭锛岀洿鎺ユ樉绀?
    } else if (S.dtConversationId) {
      msgs.innerHTML = '';
      var loadHint = el('div', { class: 'dt-loading', style: 'padding:20px;text-align:center;color:#999;font-size:13px;', text: '加载中...' });
      msgs.appendChild(loadHint);
      try {
        var hist = await apiRequest('GET', '/chat/history?conversation_id=' + encodeURIComponent(S.dtConversationId) + '&limit=30&mode=deep_think');
        var hasMessages = hist && hist.ok && Array.isArray(hist.data && hist.data.messages) && hist.data.messages.length > 0;
        if (!hasMessages) {
          S.dtConversationId = null;
          saveDtConvId();
          resetDeepThinkPageEmpty();
          var newConversation = await apiRequest('POST', '/chat/new', null);
          if (newConversation && newConversation.ok && newConversation.data && newConversation.data.conversation_id) {
            S.dtConversationId = newConversation.data.conversation_id;
            saveDtConvId();
          }
        }
        if (hasMessages) {
          msgs.innerHTML = '';
          hist.data.messages.forEach(function(msg) {
            if (msg.role === 'user') {
              var userNode = el('div', { class: 'dt-msg user' });
              userNode.appendChild(el('div', { class: 'dt-msg-label', text: '你' }));
              userNode.appendChild(el('div', { class: 'dt-msg-content', text: msg.content || '' }));
              msgs.appendChild(userNode);
            } else if (msg.role === 'assistant') {
              var thinkNode = buildThinkCardFromHistory(msg, msgs, true);
              if (thinkNode) msgs.appendChild(thinkNode);
            }
          });
        } else {
          if (!msgs.querySelector('.dt-empty')) resetDeepThinkPageEmpty();
        }
      } catch (e) {
        if (!msgs.querySelector('.dt-empty')) resetDeepThinkPageEmpty();
      }
    } else {
      // 首次打开，创建新会话
      resetDeepThinkPageEmpty();
      try {
        var r = await apiRequest('POST', '/chat/new', null);
        if (r && r.ok && r.data && r.data.conversation_id) {
          S.dtConversationId = r.data.conversation_id;
          saveDtConvId();
        }
      } catch (e) {}
    }

    panel.classList.remove('hidden');
    panel.classList.add('active');
    updateSecondaryPageState(true);

    // 绛夊緟涓ゅ抚 + 涓€涓皬寤舵椂锛岀‘淇濇墍鏈夊瓙鍏冪礌甯冨眬瀹屾垚锛坢arkdown 娓叉煋銆佸浘鐗囩瓑锛?
    // 鐒跺悗鐢?scrollIntoView 定位到最后一条消息，scrollIntoView 兼容性比 scrollTop=scrollHeight 更好
    if (msgs) {
      var scrollToEnd = function() {
        try {
          // 找最后一条用户消息或助手消息
          var last = msgs.lastElementChild;
          if (last && last !== msgs) {
            try { last.scrollIntoView({ block: 'end', behavior: 'auto' }); } catch (e) {}
          }
          // 兜底：直接设 scrollTop
          try { msgs.scrollTop = msgs.scrollHeight; } catch (e) {}
        } catch (e) {}
      };
      requestAnimationFrame(scrollToEnd);
    }

    var input = document.getElementById('dtInput');
    if (input) {
      setTimeout(function() {
        try { input.focus(); } catch (e) {}
      }, 80);
    }
  }

  function closeDeepThinkPage() {
    var panel = document.getElementById('panelDeepThink');
    try {
      resetResearchCardDisclosure(document.getElementById('dtMessages'));
      if (panel) {
        panel.classList.add('hidden');
        panel.classList.remove('active');
      }
      // 标记 panel 为已关闭, SSE 回调可检测此标志避免写旧 DOM
      if (panel) panel._dtClosed = true;
      saveDtConvId();
      var input = document.getElementById('dtInput');
      if (input) { input.value = ''; input.style.height = 'auto'; }
    } finally {
      updateSecondaryPageState(false);
      if (window.restoreMainNavigationState) window.restoreMainNavigationState();
    }
  }

  // 鏂囦欢涓婁紶鐘舵€?(dt 页面)
  var _dtFileData = null;

  async function handleDeepThinkPageSend(text, fileData) {
    var dtMessagesEl = document.getElementById('dtMessages');
    var input = document.getElementById('dtInput');
    if (!dtMessagesEl || !input) { S.sending = false; return; }

    var originalUserText = text || '';
    var displayText = text;

    // 濡傛灉鏈夋枃浠? 鍖哄垎: UI 鏄剧ず鐢ㄥ畬鏁?data URL 鎴栨枃浠跺崰浣嶏紝鍙戦€佺粰鏈嶅姟鍣ㄧ敤绠€鐭爣璁?
    if (fileData) {
      var safeName = String(fileData.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      var isImage2 = fileData.type.startsWith('image/');
      var sizeKB2 = Math.round((fileData.dataUrl.length * 3 / 4) / 1024);
      // UI 显示
      if (isImage2) {
        displayText = (text ? text + '\n' : '') + '![' + safeName + '](' + fileData.dataUrl + ')';
      } else {
        displayText = (text ? text + '\n' : '') + '[📄 ' + safeName + ' · ' + sizeKB2 + 'KB]';
      }
      // 鍙戦€佺粰鏈嶅姟鍣? 绠€鐭爣璁?
      var serverTag2 = isImage2
        ? '[图片: ' + safeName + ' · ' + sizeKB2 + 'KB]'
        : '[文件: ' + safeName + ' · ' + sizeKB2 + 'KB]';
      text = text ? text + '\n' + serverTag2 : serverTag2;
    }
    if (text.length > 50000) { notify('消息过长，最多 50000 字符，请精简后重试'); S.sending = false; return; }

    var originalText = text;
    function restoreInputText() {
      input.value = originalUserText;
      input.style.height = 'auto';
      try { input.style.height = Math.min(input.scrollHeight, 140) + 'px'; if (!_isTouchMobile) input.focus(); } catch (e) {}
    }

    // 鈽?蹇€熷弻鍑诲幓閲嶏細鍚屼竴绉掑唴鐩稿悓鏂囨湰鐨勮姹傚拷鐣?
    var dedupKey = text + Math.floor(Date.now() / 1000);
    if (S._lastDtDedupKey === dedupKey) {
      try { notify('已发送，请勿重复点击'); } catch (e) {}
      S.sending = false;
      return;
    }
    S._lastDtDedupKey = dedupKey;

    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) { S.sending = false; return; }

    if (S.sending) {
      if (S.deepThinkJob) {
        try { S.deepThinkJob.abort(); } catch (e) {}
      }
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
        var dtPB = document.getElementById('dtPauseBtn');
        if (dtPB) { dtPB.style.display = 'none'; dtPB.textContent = '暂停'; }
      }
    }
    S.sending = true;
    clearReplyTimer();

    // 显示暂停按钮
    var dtPauseBtn = document.getElementById('dtPauseBtn');
    if (dtPauseBtn) { dtPauseBtn.style.display = ''; dtPauseBtn.textContent = '暂停'; }

    // 1. 追加 user 娑堟伅锛堟墜鍔ㄥ垱寤?.dt-msg.user锛屼笉浣跨敤姘旀场锛?
    var empty = dtMessagesEl.querySelector('.dt-empty');
    if (empty) { try { empty.remove(); } catch (e) {} }
    var userNode = el('div', { class: 'dt-msg user' });
    userNode.appendChild(el('div', { class: 'dt-msg-label', text: '你' }));
    var userContent = el('div', { class: 'dt-msg-content' });
    // 渲染 markdown (包含图片 data URL 鎴栨枃浠跺崰浣?
    var renderFn = window.renderMarkdown || renderMarkdown;
    userContent.innerHTML = renderFn(displayText);
    userNode.appendChild(userContent);
    dtMessagesEl.appendChild(userNode);
    scrollToBottom(dtMessagesEl, true);

    // 2. 鍒涘缓杩涘害鍗?
    var progressCard = buildDeepThinkProgressCard({
      variant: 'research',
      cancelFn: function() { cancelDeepThink(S.dtConversationId); },
      retryFn: function() { handleDeepThinkPageSend(originalUserText, fileData); }
    });
    progressCard.classList.add('dt-animate-in');
    S.deepThinkProgressCard = progressCard;
    dtMessagesEl.appendChild(progressCard);
    scrollToBottom(dtMessagesEl, true);

    // 3. 娓呯┖杈撳叆妗?
    input.value = '';
    input.style.height = 'auto';
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
      conversation_id: S.dtConversationId,
      client_request_id: reqId,
      deep_think: true,
      chat_mode: 'deep_think',
      thinking_mode: S.deepThinkEffort || 'max'
    });

    var aborted = false;
    var aiContent = '';
    var finalMeta = null;
    var finalModel = '';
    var finalThinkingMode = S.deepThinkEffort || 'max';
    var streamConvId = null;
    var aiNode = null;
    var contentRenderer = null;
    var answerRenderer = null;
    var answerStarted = false;
    var doneReceived = false;
    var evtHandled = false;

    function safeRemoveProgressCard(removeNode) {
      if (!progressCard) return;
      if (isResearchCard(progressCard)) {
        try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e) {}
        try { progressCard._done = true; } catch (e2) {}
        if (removeNode && progressCard.parentNode) {
          try { progressCard.remove(); } catch (e3) {}
        }
        return;
      }
      try { progressCard.classList.add('ai-progress-card-done'); } catch (e4) {}
      try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e5) {}
      if (removeNode !== false) {
        try { progressCard.remove(); } catch (e6) {}
      }
      try { progressCard._done = true; } catch (e7) {}
    }

    function removeLastDtUserMessage() {
      var nodes = dtMessagesEl.querySelectorAll('.dt-msg.user');
      if (nodes && nodes.length) {
        try { nodes[nodes.length - 1].remove(); } catch (e) {}
      }
      if (!dtMessagesEl.querySelector('.dt-msg') && !dtMessagesEl.querySelector('.ai-think-card') && !dtMessagesEl.querySelector('.ai-progress-card')) {
        resetDeepThinkPageEmpty();
      }
    }

    function ensureThinkCardNode() {
      if (aiNode) return aiNode;
      if (isResearchCard(progressCard)) {
        aiNode = progressCard;
        return aiNode;
      }
      safeRemoveProgressCard();
      var node = el('div', { class: 'ai-think-card expanded generating dt-simple-card' });
      node.innerHTML =
        '<div class="ai-think-header">' +
          '<span class="ai-think-icon">' + AI_THINK_ICON + '</span>' +
          '<span class="ai-think-title">思考中...</span>' +
          '<span class="ai-think-meta"></span>' +
        '</div>' +
        '<div class="ai-think-body">' +
          '<div class="ai-think-thinking-body"></div>' +
          '<div class="ai-think-answer"></div>' +
          '<div class="ai-msg-footer"></div>' +
        '</div>';
      dtMessagesEl.appendChild(node);
      aiNode = node;
      scrollToBottom(dtMessagesEl, true);
      return node;
    }

    function finishThinkCard(node, content, evt) {
      if (isResearchCard(node) && node._researchState &&
          (node._researchState.state === 'timeout' || node._researchState.state === 'interrupted' || node._researchState.state === 'cancelled')) return;
      if (node) node.classList.remove('generating');
      if (node) node.classList.add('done');

      var searchCount = evt ? (evt.search_count || 0) : 0;
      var searchQuery = evt ? (evt.search_query || '') : '';
      var searchResults = evt && Array.isArray(evt.search_results) ? evt.search_results : null;
      var usage = evt && evt.usage ? evt.usage : null;
      var agentCount = evt && evt.agent_count ? evt.agent_count : 0;
      var thinkingLog = evt && Array.isArray(evt.thinking_log) ? evt.thinking_log : [];
      var thinkDurationMs = evt && typeof evt.think_duration_ms === 'number' ? evt.think_duration_ms : 0;

      if (node) {
        var contentForRender = content || '';
        var answerEl = node.querySelector('.ai-think-answer');
        function finalizeAnswer() {
          setupBubbleCopy(answerEl, dtMessagesEl);
        }
        if (answerEl) {
          if (answerRenderer) {
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

        var thinkLogBox = node.querySelector('.ai-think-thinking-body');
        var detailsEl = node.querySelector('.ai-think-thinking');
        var summaryTextEl = node.querySelector('.ai-thinking-summary-text');
        if (detailsEl) detailsEl.style.display = mergedLog.length ? '' : 'none';
        if (thinkLogBox && mergedLog.length > 0) {
          thinkLogBox.innerHTML = '';
          mergedLog.forEach(function(entry) {
            var entEl = el('div', { class: 'ai-thought-entry' });
            var roleLabel = entry.agent_role || 'AI';
            var roundLabel = entry.round ? ' · 第' + entry.round + '轮' : '';
            entEl.innerHTML = '<div class="ai-thought-role">' + escapeHtml(roleLabel) + escapeHtml(roundLabel) + '</div><div class="ai-thought-chunk"></div>';
            entEl.querySelector('.ai-thought-chunk').textContent = cleanReasoningText(String(entry.chunk || '').slice(0, 4000));
            thinkLogBox.appendChild(entEl);
          });
        }
        if (summaryTextEl) summaryTextEl.textContent = '查看思考过程 (' + mergedLog.length + ' 步)';

        var footer = node.querySelector('.ai-msg-footer');
        if (footer) {
          footer.innerHTML = '';
          footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(new Date().toISOString()) }));
          footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: (finalThinkingMode || 'max') + ' 思考' }));
          if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
          if (searchCount > 0) footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '已研究 ' + searchCount + ' 个来源' }));
          if (usage || finalModel) {
            var usageLine = buildUsageLine(Object.assign({}, usage || {}, { model: finalModel, thinking_mode: finalThinkingMode, deep_think: true, agent_count: agentCount }));
            if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
          }
        }

        if (searchResults && searchResults.length > 0 && searchQuery) {
          var refs = isResearchCard(node) ? ensureResearchCardRefs(node) : null;
          if (refs && refs.searchBox && refs.searchBox.parentNode) {
            try { refs.searchBox.parentNode.removeChild(refs.searchBox); } catch (e2) {}
            refs.searchBox = null;
          }
          var searchBox = document.createElement('div');
          searchBox.className = 'ai-search-supplement';
          var searchHtml = '研究来源: <strong>' + escapeHtml(searchQuery) + '</strong> (' + searchResults.length + ' 条结果)<br>';
          var shownResults = searchResults.slice(0, 5);
          for (var si = 0; si < shownResults.length; si++) {
            var sr = shownResults[si];
            if (sr.title && sr.url) searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(sr.url) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.title) + '</a><br>';
            else if (sr.url) searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(sr.url) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.url) + '</a><br>';
          }
          if (searchResults.length > 5) searchHtml += '<span style="font-size:10px;color:#999">... 还有 ' + (searchResults.length - 5) + ' 条来源</span>';
          searchBox.innerHTML = searchHtml;
          var thinkBody = node.querySelector('.ai-think-body');
          if (thinkBody) {
            answerEl = node.querySelector('.ai-think-answer');
            if (answerEl) thinkBody.insertBefore(searchBox, answerEl);
            else thinkBody.appendChild(searchBox);
          }
          if (refs) refs.searchBox = searchBox;
        }

        if (isResearchCard(node)) {
          node._researchState.durationMs = thinkDurationMs || node._researchState.elapsedMs || 0;
          node._researchState.agentCount = agentCount;
          node._researchState.searchCount = searchCount;
          setResearchCardState(node, 'done', {
            durationMs: node._researchState.durationMs,
            agentCount: agentCount,
            searchCount: searchCount,
            expanded: false
          });
        } else {
          var durationSec = Math.round(thinkDurationMs / 1000);
          var min = Math.floor(durationSec / 60);
          var sec = durationSec % 60;
          var durationStr = min > 0 ? (min + 'm ' + sec + 's') : (sec + 's');
          var titleEl = node.querySelector('.ai-think-title');
          var metaEl = node.querySelector('.ai-think-meta');
          if (titleEl) titleEl.innerHTML = AI_THINK_ICON + ' 已思考 ' + durationStr;
          if (metaEl) metaEl.textContent = '';
          if (detailsEl) detailsEl.open = false;
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
          var ej = await resp.json().catch(function(){});
          if (S._currentReqId !== reqId) return;
          if (isResearchCard(progressCard)) markResearchCardOutcome(progressCard, 'interrupted', String((ej&&ej.error) || ('AI 失败 (' + resp.status + ')')));
          else { safeRemoveProgressCard(); notify(String((ej&&ej.error)||('AI 失败 ('+resp.status+')'))); }
        } catch(e){}
        resetSendingIfCurrent(); return;
      }
      if (!resp.body) {
        if (isResearchCard(progressCard)) markResearchCardOutcome(progressCard, 'interrupted', 'AI 没有响应');
        else { safeRemoveProgressCard(); notify('AI 没有响应'); }
        resetSendingIfCurrent(); return;
      }

      var reader = resp.body.getReader();
      var r = { value: null }, c = { value: '' }, fm = {}, fmod = { value: '' }, ft = { value: S.deepThinkEffort || 'max' };
      var ar = { value: null }, cr = { value: null }, as = { value: false }, dr = { value: false }, eh = { value: false };
      var sc = { value: null }, ab = { value: false };
      var sseResult = await processDeepThinkSSE({
        reader: reader, controller: controller, progressCard: progressCard, reqId: reqId,
        aiNodeRef: r, aiContentRef: c, finalMetaRef: fm, finalModelRef: fmod, finalThinkingModeRef: ft,
        answerRendererRef: ar, contentRendererRef: cr, answerStartedRef: as, doneReceivedRef: dr, evtHandledRef: eh,
        streamConvIdRef: sc, abortedRef: ab, messagesEl: dtMessagesEl, scrollEl: dtMessagesEl,
        defaultThinkingMode: S.deepThinkEffort || 'max',
        onAnswerStart: function(node) {
          if (!isResearchCard(node)) return;
          node._researchState.durationMs = node._researchState.elapsedMs || (Date.now() - (node._researchState.startedAt || Date.now()));
          setResearchCardState(node, 'responding', {
            durationMs: node._researchState.durationMs,
            expanded: false
          });
        },
        onErrorNoContent: function() { removeLastDtUserMessage(); restoreInputText(); },
        onResetSending: resetSendingIfCurrent
      });
      if (sc.value) { S.dtConversationId = sc.value; saveDtConvId(); }
      if (sseResult && sseResult.timedOut && isResearchCard(progressCard)) {
        safeRemoveProgressCard(false);
        preserveResearchAnswer(progressCard, c.value);
        resetSendingIfCurrent();
        return;
      }
      if (S._currentReqId !== reqId || ab.value) {
        if (ab.value && isResearchCard(progressCard)) {
          safeRemoveProgressCard(false);
          if (ar.value) try { ar.value.cancel(); } catch(e){}
          resetSendingIfCurrent();
          return;
        }
        safeRemoveProgressCard();
        if (ar.value) try { ar.value.cancel(); } catch(e){}
        if (r.value) try { r.value.remove(); } catch(e){}
        resetSendingIfCurrent();
        return;
      }
      safeRemoveProgressCard(isResearchCard(progressCard) ? false : undefined);
      if (progressCard) try { progressCard._done = true; } catch(e){}
      if (!eh.value) {
        if (r.value && c.value) { finishThinkCard(r.value, c.value, fm.value); }
        else if (!dr.value && c.value) { if (!r.value) ensureThinkCardNode(); finishThinkCard(r.value, c.value, fm.value); }
        else if (!dr.value) {
          if (isResearchCard(progressCard)) {
            preserveResearchAnswer(progressCard, c.value);
            markResearchCardOutcome(progressCard, 'interrupted', '研究失败，请重试');
          } else {
            removeLastDtUserMessage();
            restoreInputText();
            notify('AI 暂时没有回应');
          }
        }
      }
    } catch (fetchErr) {
      if (S._currentReqId !== reqId) { safeRemoveProgressCard(); return; }
      safeRemoveProgressCard(isResearchCard(progressCard) ? false : undefined);
      if (progressCard) try { progressCard._done = true; } catch(e){}
      if (fetchErr && fetchErr.name !== 'AbortError') {
        if (isResearchCard(progressCard)) {
          preserveResearchAnswer(progressCard, c.value);
          markResearchCardOutcome(progressCard, 'interrupted', '研究失败，请重试');
        }
        if (c && c.value && !isResearchCard(progressCard)) { if (!r.value) ensureThinkCardNode(); r.value.appendChild(el('div',{class:'ai-error-note'},'连接中断')); finishThinkCard(r.value, c.value, fm.value); }
        else if (!isResearchCard(progressCard)) { removeLastDtUserMessage(); restoreInputText(); notify('网络异常'); }
      } else {
        if (isResearchCard(progressCard)) {
          preserveResearchAnswer(progressCard, c.value);
          if (progressCard._researchState.state !== 'cancelled') markResearchCardOutcome(progressCard, 'interrupted', '本次研究已中断，请重试');
        } else if (c && c.value) { if (!r.value) ensureThinkCardNode(); finishThinkCard(r.value, c.value, fm.value); }
        else if (!isResearchCard(progressCard)) { removeLastDtUserMessage(); }
      }
    }
    resetSendingIfCurrent();
    if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
    updateInputMetrics();
    scrollToBottom(dtMessagesEl, false);
  }

  var _dtListeners = []; // 存储事件监听引用用于清除

  function bindDeepThinkPageEvents() {
    var backBtn = document.getElementById('dtBackBtn');
    var newBtn = document.getElementById('dtNewChatBtn');
    var delBtn = document.getElementById('dtDeleteChatBtn');
    var sendBtn = document.getElementById('dtSendBtn');
    var pauseBtn = document.getElementById('dtPauseBtn');
    var input = document.getElementById('dtInput');
    var fileBtn = document.getElementById('dtFileBtn');
    var fileInput = document.getElementById('dtFileInp');
    var filePreview = document.getElementById('dtFilePreview');

    // 清除之前的监听器（防止重复绑定泄漏）
    _dtListeners.forEach(function(fn) { try { fn(); } catch (e) {} });
    _dtListeners = [];

    function addDtListener(el, event, handler) {
      if (!el) return;
      el.addEventListener(event, handler);
      _dtListeners.push(function() { el.removeEventListener(event, handler); });
    }

    function dtDoSend() {
      var text = String(input.value || '').trim();
      var fData = _dtFileData;
      if (!text && !fData) return;
      var totalLen = text.length + (fData ? (fData.type.startsWith('image/') ? 0 : fData.dataUrl.length) : 0);
      if (totalLen > 50000) { notify('消息过长，最多 50000 字符'); return; }
      _dtFileData = null;
      if (filePreview) { filePreview.style.display = 'none'; filePreview.innerHTML = ''; }
      if (fileInput) fileInput.value = '';
      handleDeepThinkPageSend(text, fData);
    }

    // 文件上传
    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        var f = this.files && this.files[0];
        if (!f) return;
        if (f.size > 7 * 1024 * 1024) { notify('文件不能超过 7MB（data URL 编码后）?'); return; }
        var reader = new FileReader();
        reader.onload = function(e) {
          _dtFileData = { name: f.name, type: f.type, dataUrl: e.target.result };
          if (filePreview) {
            filePreview.innerHTML = '';
            var thumb = f.type.startsWith('image/')
              ? el('img', { src: e.target.result, class: 'ai-file-thumb' })
              : el('div', { class: 'ai-file-icon' }, '📄');
            var info = el('span', { class: 'ai-file-info', text: f.name + ' (' + Math.round(f.size / 1024) + 'KB)' });
            var removeBtn = el('button', { type: 'button', class: 'ai-file-remove' }, '×');
            removeBtn.addEventListener('click', function() {
              _dtFileData = null;
              filePreview.style.display = 'none';
              filePreview.innerHTML = '';
              fileInput.value = '';
            });
            filePreview.appendChild(thumb);
            filePreview.appendChild(info);
            filePreview.appendChild(removeBtn);
            filePreview.style.display = 'flex';
          }
        };
        reader.readAsDataURL(f);
      });
    }

    if (backBtn) backBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeDeepThinkPage();
    });

    if (newBtn) newBtn.addEventListener('click', async function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (S.sending) return;
      newBtn.disabled = true;
      try {
        resetResearchCardDisclosure(document.getElementById('dtMessages'));
        resetDeepThinkPageEmpty();
        var r = await apiRequest('POST', '/chat/new', null);
        if (r && r.ok && r.data && r.data.conversation_id) {
          S.dtConversationId = r.data.conversation_id;
          saveDtConvId();
        }
      } catch (e) {
        notify('创建新会话失败');
      } finally {
        newBtn.disabled = false;
      }
    });

    if (delBtn) delBtn.addEventListener('click', async function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!S.dtConversationId) return;
      if (!confirm('确定删除当前深度思考会话吗？删除后不可恢复。')) return;
      delBtn.disabled = true;
      try {
        var dr = await apiRequest('POST', '/chat/delete', { conversation_id: S.dtConversationId });
        if (dr && dr.ok) {
          S.dtConversationId = null;
          saveDtConvId();
          resetResearchCardDisclosure(document.getElementById('dtMessages'));
          resetDeepThinkPageEmpty();
          var r2 = await apiRequest('POST', '/chat/new', null);
          if (r2 && r2.ok && r2.data && r2.data.conversation_id) {
            S.dtConversationId = r2.data.conversation_id;
            saveDtConvId();
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

    if (sendBtn) sendBtn.addEventListener('click', dtDoSend);

    // 鏆傚仠鎸夐挳锛氱湡步ｄ腑步)SSE 请求 + 暂停渲染
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!S.sending) return;
        var anyPaused = S.activeRenderers && S.activeRenderers.some(function(r) { return r.isPaused && r.isPaused(); });
        if (anyPaused) {
          if (S.activeRenderers) S.activeRenderers.forEach(function(r) { if (r.resume) r.resume(); });
          S.paused = false;
          pauseBtn.textContent = '暂停';
        } else {
          try { if (S.abortController) S.abortController.abort(); } catch (e) {}
          try { if (S.deepThinkJob && S.deepThinkJob.abort) S.deepThinkJob.abort(); } catch (e) {}
          if (S.activeRenderers) S.activeRenderers.forEach(function(r) { if (r.pause) r.pause(); });
          S.paused = true;
          pauseBtn.textContent = '继续';
        }
      });
    }

    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          dtDoSend();
        }
      });
      input.addEventListener('input', function() {
        try {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        } catch (e) {}
      });
    }

    // 娣卞害鐮旂┒椤甸潰婊氬姩鐩戝惉锛氱敤鎴峰悜涓婄炕鏃跺仠步㈣嚜鍔ㄦ粴鍔?
    var dtMessagesEl = document.getElementById('dtMessages');
    if (dtMessagesEl) {
      addDtListener(dtMessagesEl, 'scroll', function() {
        S.autoScrollPinned = isNearBottom(dtMessagesEl, 84);
      });
    }
  }

  function openAiSearchTarget(item) {
    var target = item && item.jump_target || {};
    var closeSecondary = function() {
      try { closeSiteSearch(); } catch (e) {}
      try { closeAiChat(); } catch (e2) {}
    };
    if ((target.type === 'post' || target.type === 'comment') && typeof window.openPostDetail === 'function') {
      // validate: source must be posts, source_id must be valid UUID
      if (target.type === 'post' && item.source !== 'posts') {
        console.warn('[site-search] blocked invalid post result', { source: item.source, source_id: item.source_id });
        return;
      }
      if (target.type === 'post' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(target.post_id || item.source_id || ''))) {
        console.warn('[site-search] blocked invalid post_id', target.post_id || item.source_id);
        return;
      }
      closeSecondary();
      window.openPostDetail(target.post_id);
    } else if (target.type === 'photo' && target.image_url && typeof window.openPhotoPreview === 'function') {
      closeSecondary();
      window.openPhotoPreview(0, { photos: [{ id: String(target.post_id || item.source_id || 'search-photo'), cloudId: target.post_id || null, imageUrl: target.image_url, thumbUrl: target.image_url, username: target.user_name || '', timestamp: item.created_at || '', content: item.snippet || '' }] });
    } else if (target.type === 'photo' && typeof window.openPostDetail === 'function') {
      closeSecondary();
      window.openPostDetail(target.post_id);
    } else if (target.type === 'dm' && typeof window.openChat === 'function') {
      closeSecondary();
      window.openChat(target.user);
    } else if (target.type === 'ai_history' && window.__xtjAiAgent && typeof window.__xtjAiAgent.openConversation === 'function') {
      try { closeSiteSearch(); } catch (e3) {}
      window.__xtjAiAgent.openConversation(target.conversation_id, target.mode);
    } else if (target.type === 'user' && typeof window.openUserProfile === 'function') {
      closeSecondary();
      window.openUserProfile(target.user_name || item.title || '');
    }
  }

  function buildAiSearchMeta(item) {
    var meta = [];
    if (item && item.source) meta.push(String(item.source));
    if (item && item.created_at) {
      var created = window.safeParseDate(item.created_at);
      if (!isNaN(created.getTime())) meta.push(created.toLocaleString('zh-CN'));
    }
    if (item && Array.isArray(item.matched_keywords) && item.matched_keywords.length) meta.push('匹配：' + item.matched_keywords.slice(0, 3).join('、'));
    if (item && typeof item.relevance === 'number' && item.relevance > 0) meta.push('相关度 ' + Math.round(item.relevance * 100) + '%');
    return meta.join(' · ');
  }

  function renderAiToolCard(messagesEl, card) {
    if (!messagesEl || !card || card.protocol !== 'xtj.ai.ui.v1') return null;
    var cardId = String(card.id || '');
    if (!messagesEl.__xtjAiCardIds) messagesEl.__xtjAiCardIds = {};
    if (cardId && messagesEl.__xtjAiCardIds[cardId]) return null;
    if (cardId) messagesEl.__xtjAiCardIds[cardId] = true;
    var shell = el('section', { class: 'ai-tool-card ai-tool-card--' + String(card.type || 'tool_result').replace(/[^a-z_]/g, '') });
    if (cardId) shell.setAttribute('data-ai-card-id', cardId);
    shell.appendChild(el('div', { class: 'ai-tool-card-title', text: String(card.title || 'AI 工具结果') }));
    var data = card.data || {};
    if (Array.isArray(data.results)) {
      var list = el('div', { class: 'ai-tool-card-list' });
      data.results.slice(0, 20).forEach(function(item) {
        var result = el('button', { class: 'ai-tool-result', type: 'button' });
        result.appendChild(el('b', { text: String(item.title || item.source || '结果') }));
        result.appendChild(el('span', { text: String(item.snippet || '').slice(0, 180) }));
        var resultMeta = buildAiSearchMeta(item);
        if (resultMeta) result.appendChild(el('small', { class: 'ai-tool-result-meta', text: resultMeta }));
        result.addEventListener('click', function() {
          openAiSearchTarget(item);
        });
        list.appendChild(result);
      });
      shell.appendChild(list);
    } else if (data.payload && data.payload.args) {
      var args = data.payload.args;
      var summary = [];
      ['target_user', 'title', 'module', 'severity', 'status', 'content', 'body'].forEach(function(key) {
        if (args[key]) summary.push(key + '：' + String(args[key]).slice(0, 240));
      });
      if (summary.length) shell.appendChild(el('div', { class: 'ai-tool-card-summary', text: summary.join('\n') }));
    } else if (data.task || data.draft || data.message || data.announcement) {
      shell.appendChild(el('div', { class: 'ai-tool-card-summary', text: '操作已完成。' }));
    }
    if (false && data.confirmation_id) {
      var actions = el('div', { class: 'ai-tool-card-actions' });
      ['cancel', 'confirm'].forEach(function(action) {
        var button = el('button', { class: 'ai-tool-card-action ' + action, type: 'button', text: action === 'confirm' ? '确认' : '取消' });
        button.addEventListener('click', async function() {
          button.disabled = true;
          var result = await apiRequest('POST', '/actions/' + encodeURIComponent(data.confirmation_id) + '/' + action, {});
          if (!result.ok) { button.disabled = false; notify(result.error || '操作失败'); return; }
          shell.classList.add('ai-tool-card-complete');
          actions.textContent = action === 'confirm' ? '已确认并执行' : '已取消';
        });
        actions.appendChild(button);
      });
      shell.appendChild(actions);
    }
    messagesEl.appendChild(shell);
    scrollToBottom(messagesEl, false);
    return shell;
  }

  var AI_SEARCH_SOURCES = ['posts', 'comments', 'photos', 'dm', 'ai_history', 'users'];

  function closeSiteSearch() {
    var panel = document.getElementById('aiSiteSearchPanel');
    if (panel) {
      panel.classList.add('hidden');
      panel.classList.remove('active');
      panel.setAttribute('aria-hidden', 'true');
    }
    updateSecondaryPageState(false, 'site-search');
    // cancel any ongoing search request
    if (S.siteSearchCtrl) {
      try { S.siteSearchCtrl.abort(); } catch (e) {}
      S.siteSearchCtrl = null;
    }
    S.siteSearchRequestId = (S.siteSearchRequestId || 0) + 1;
    S.siteSearchLifecycleId = (S.siteSearchLifecycleId || 0) + 1;
  }

  function selectedSiteSearchSources() {
    var selected = [];
    var buttons = document.querySelectorAll('[data-ai-search-source].is-selected');
    for (var i = 0; i < buttons.length; i++) {
      var source = buttons[i].getAttribute('data-ai-search-source');
      if (AI_SEARCH_SOURCES.indexOf(source) >= 0) selected.push(source);
    }
    return selected;
  }

  function renderSiteSearchResults(results) {
    var host = document.getElementById('aiSiteSearchResults');
    if (!host) return;
    host.innerHTML = '';
    (Array.isArray(results) ? results : []).slice(0, 40).forEach(function(item) {
      var result = el('button', { type: 'button', class: 'ai-site-search-result' });
      result.appendChild(el('b', { text: String(item.title || item.source || '搜索结果') }));
      if (item.snippet) result.appendChild(el('span', { text: String(item.snippet).slice(0, 280) }));
      var meta = buildAiSearchMeta(item);
      if (meta) result.appendChild(el('small', { text: meta }));
      result.addEventListener('click', function() { openAiSearchTarget(item); });
      host.appendChild(result);
    });
  }

  function renderSiteSearchLoading() {
    var host = document.getElementById('aiSiteSearchResults');
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('is-loading');
    host.setAttribute('aria-busy', 'true');
    for (var i = 0; i < 3; i++) {
      var row = el('div', { class: 'ai-site-search-skeleton', 'aria-hidden': 'true' });
      row.appendChild(el('i'));
      row.appendChild(el('i'));
      row.appendChild(el('i'));
      host.appendChild(row);
    }
  }

  async function runSiteSearch() {
    var input = document.getElementById('aiSiteSearchInput');
    var status = document.getElementById('aiSiteSearchStatus');
    var submit = document.querySelector('#aiSiteSearchForm button[type="submit"]');
    var query = String(input && input.value || '').trim();
    var sources = selectedSiteSearchSources();
    if (!query) {
      if (status) status.textContent = '请输入要查找的关键词。';
      if (input) input.focus();
      return;
    }
    if (!sources.length) {
      if (status) status.textContent = '请至少选择一个搜索范围。';
      return;
    }
    // cancel previous search
    if (S.siteSearchCtrl) { try { S.siteSearchCtrl.abort(); } catch (e) {} }
    var controller = new AbortController();
    S.siteSearchCtrl = controller;
    S.siteSearchRequestId = (S.siteSearchRequestId || 0) + 1;
    var requestId = S.siteSearchRequestId;
    var lifecycleId = S.siteSearchLifecycleId;
    var querySnapshot = query;
    var sourcesSnapshot = sources.slice();
    if (submit) submit.disabled = true;
    renderSiteSearchLoading();
    if (status) status.textContent = '正在检索站内内容…';
    var startTime = Date.now();
    try {
      var response = await apiRequest('POST', '/site-search', { query: query, sources: sources, limit: 40 }, { signal: S.siteSearchCtrl.signal });
      // guard: check if this request is still valid
      if (requestId !== S.siteSearchRequestId || lifecycleId !== S.siteSearchLifecycleId || query !== querySnapshot || sources.join(',') !== sourcesSnapshot.join(',')) return;
      var data = response && response.data;
      if (!response || !response.ok || !data || !data.ok) throw new Error(response && response.error || data && data.error || '搜索失败');
      var elapsed = Date.now() - startTime;
      // guard again before rendering
      if (requestId !== S.siteSearchRequestId || lifecycleId !== S.siteSearchLifecycleId) return;
      renderSiteSearchResults(data.results);
      var msg = data.results && data.results.length ? '找到 ' + data.results.length + ' 条相关内容（' + elapsed + 'ms）。' : '没有找到相关内容。';
      if (data.source_errors && data.source_errors.length) {
        msg += ' 部分范围搜索失败：' + data.source_errors.map(function(e) { return e.message; }).join('；');
      }
      if (status) status.textContent = msg;
    } catch (e) {
      if (e && e.name === 'AbortError') { if (status) status.textContent = ''; return; }
      renderSiteSearchResults([]);
      var message = (e && e.message) || '';
      if (message === 'AI 工具数据表尚未迁移') message = '搜索服务正在初始化，请稍后重试。';
      if (status) status.textContent = message || '搜索暂不可用，请重试。';
    } finally {
      if (S.siteSearchCtrl && S.siteSearchCtrl === controller) S.siteSearchCtrl = null;
      var results = document.getElementById('aiSiteSearchResults');
      if (results) {
        results.classList.remove('is-loading');
        results.removeAttribute('aria-busy');
      }
      if (submit) submit.disabled = false;
    }
  }

  function bindSiteSearchPage() {
    var panel = document.getElementById('aiSiteSearchPanel');
    if (!panel || panel.__xtjAiSearchBound) return;
    panel.__xtjAiSearchBound = true;
    var form = document.getElementById('aiSiteSearchForm');
    var back = document.getElementById('aiSiteSearchBack');
    if (form) form.addEventListener('submit', function(event) { event.preventDefault(); runSiteSearch(); });
    if (back) back.addEventListener('click', closeSiteSearch);
    panel.addEventListener('click', function(event) {
      var button = event.target.closest('[data-ai-search-source]');
      if (!button) return;
      button.classList.toggle('is-selected');
    });
  }

  async function openSiteSearchPage() {
    if (!window.currentUser) {
      notify('请先登录后再使用站内搜索');
      return;
    }
    try { closeAiChat(); } catch (e) {}
    try { closeDeepThinkPage(); } catch (e2) {}
    var panel = document.getElementById('aiSiteSearchPanel');
    if (!panel) return;
    bindSiteSearchPage();
    panel.classList.remove('hidden');
    panel.classList.add('active');
    panel.setAttribute('aria-hidden', 'false');
    updateSecondaryPageState(true, 'site-search');
    var input = document.getElementById('aiSiteSearchInput');
    if (input) setTimeout(function() { try { input.focus(); } catch (e3) {} }, 50);
    // verify auth in background — don't block page visibility
    ensureUserAuthOrNotify().catch(function(e) { console.error('[site-search] auth check failed:', e && e.message); });
  }

  function bindTopAiTools() {
    var nav = document.getElementById('aiToolsNav');
    var trigger = document.getElementById('aiToolsBtn');
    var menu = document.getElementById('aiToolsMenu');
    if (!nav || !trigger || !menu || nav.__xtjAiToolsBound) return;
    nav.__xtjAiToolsBound = true;
    function setOpen(open) {
      nav.classList.toggle('is-open', !!open);
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    trigger.addEventListener('click', function(event) {
      event.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener('click', async function(event) {
      var button = event.target.closest('[data-ai-tool]');
      if (!button) return;
      setOpen(false);
      var tool = button.getAttribute('data-ai-tool');
      if (tool === 'research') {
        await openDeepThinkPage();
      } else if (tool === 'search') {
        await openSiteSearchPage();
      } else {
        await openAiChat();
      }
    });
    document.addEventListener('click', function(event) {
      if (!nav.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setOpen(false);
    });
  }

  async function handleSendMessage(input, sendBtn, messagesEl, fileData) {
    var text = String(input.value || '').trim();
    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('ai_chat', '向AI发送消息: ' + text.slice(0, 30)); } catch(e) {}
    var displayText = text;
    // 濡傛灉鏈夋枃浠? 鍖哄垎: UI 鏄剧ず鐢ㄥ畬鏁?data URL 鎴栨枃浠跺崰浣嶏紝鍙戦€佺粰鏈嶅姟鍣ㄧ敤绠€鐭爣璁?
    if (fileData) {
      var safeName = String(fileData.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      var isImage = fileData.type.startsWith('image/');
      // 估算文件大小（data URL 绾?4/3 倍原始大小）
      var sizeKB = Math.round((fileData.dataUrl.length * 3 / 4) / 1024);
      // UI 显示
      if (isImage) {
        displayText = (text ? text + '\n' : '') + '![' + safeName + '](' + fileData.dataUrl + ')';
      } else {
        displayText = (text ? text + '\n' : '') + '[📄 ' + safeName + ' · ' + sizeKB + 'KB]';
      }
      // 鍙戦€佺粰鏈嶅姟鍣? 绠€鐭爣璁帮紝涓嶅惈澶?data URL
      var serverTag = isImage
        ? '[图片: ' + safeName + ' · ' + sizeKB + 'KB]'
        : '[文件: ' + safeName + ' · ' + sizeKB + 'KB]';
      text = text ? text + '\n' + serverTag : serverTag;
    }
    if (!text) { S.sending = false; return; }
    if (text.length > 50000) {
      notify('消息过长，最多 50000 字符，请精简后重试');
      S.sending = false;
      return;
    }

    // 鈽?绔嬪嵆鏍囪鍙戦€佷腑锛岄槻步㈠苟鍙戠珵鎬?
    S.sending = true;

    // 鈽?U3: 深度思考冨凡杩佽嚦鐙珛浜岀骇椤甸潰, 鏅€氳亰澶╀笉鍐嶆湁 deepThink 分支
    // (删除 S.deepThink 步讳唬鐮? 淇濈暀 S.sending=true 防止并发)

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
    
    // 蹇€熷弻鍑诲幓閲嶏細鍚屼竴绉掑唴鐩稿悓鏂囨湰鐨勮姹傚拷鐣?
    var msgDedupKey = text + Math.floor(Date.now() / 1000);
    if (S._lastMsgDedupKey === msgDedupKey) {
      // 鈽?U3: 统一行为, 提示用户避免困惑
      try { notify('已发送，请勿重复点击'); } catch (e) {}
      S.sending = false;
      return;
    }
    S._lastMsgDedupKey = msgDedupKey;
    
    // 如果有正在进行的请求，中断它
    if (S.sending && S.abortController) {
      abortCurrentRequest();
      try { await new Promise(function(resolve) { setTimeout(resolve, 100); }); } catch (e) {}
    }
    
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
    var userMsg = { role: 'user', content: displayText, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);
    S.autoScrollPinned = true;
    scrollToBottom(messagesEl, true);
    
    var typingNode = buildTypingNode();
    messagesEl.appendChild(typingNode);
    scrollToBottom(messagesEl, true);
    
    // 娓呯┖杈撳叆妗?
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
      client_request_id: reqId,
      thinking_mode: S.thinkingMode || 'max'
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
      
      // 读取 SSE 娴?
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
        var fallbackText = hasThinking ? 'AI 只返回了思考过程，没有生成正文回复。' : 'AI 暂无回复，请重试。';

        if (contentRenderer) {
          if (hasContent) {
            contentRenderer.finish(content);
          } else {
            // 空哄唴瀹规椂浠嶈皟鐢?finish锛岃娓叉煋鍣ㄥ唴閮ㄥ厹搴曟樉绀烘彁绀?
            contentRenderer.finish(fallbackText);
          }
        }
        // 鍏滃簳: 鏃犺娓叉煋鍣ㄧ姸鎬佸浣? 鐩存帴寰€姘旀场鍐欏唴瀹癸紙淇濈暀 markdown 鏍煎紡锛?
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
            if (body) body.textContent = cleanReasoningText(thinking);
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
          // 濡傛灉鏈夋悳绱㈢粨鏋滐紝鎶婂凡鏈夌殑鎼滅储鏉＄Щ鍏ユ秷鎭妭鐐癸紙鑰岄潪鍗曠嫭鍦?container 里）
          var liveSearchBar = null;
          if (searchCount > 0) {
            liveSearchBar = messagesEl.querySelector('.ai-search-status');
          }
          if (liveSearchBar) {
            node.appendChild(liveSearchBar);
          } else if (searchCount > 0) {
            // 娌℃湁鐩存挱鎼滅储鏉★紙濡傚巻鍙查噸寤猴級锛屽垱寤轰竴涓畝鐗?
            var sb = el('div', { class: 'ai-search-status', text: '已联网搜索 · ' + searchCount + ' 条结果' });
            var sq = searchQuery || '';
            if (sq) {
              var toggleBtn = el('span', { class: 'ai-search-toggle' }, ' ▸');
              sb.appendChild(toggleBtn);
              sb.style.cursor = 'pointer';
              var panel = el('div', { class: 'ai-search-detail', style: 'display:none;' });
              sb.appendChild(panel);
              panel.appendChild(el('div', { class: 'ai-search-detail-query', text: '搜索：' + sq }));
              sb.onclick = function(e) {
                if (e.target.tagName === 'A') return;
                var h = panel.style.display === 'none';
                panel.style.display = h ? '' : 'none';
                toggleBtn.textContent = h ? ' ▾' : ' ▸';
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
            minChunk: 2,
            maxChunk: 8,
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
          
          // 妫€鏌ユ槸鍚﹁鏂拌姹傚彇浠?
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
              maStatus.textContent = '多 Agent 协作：正在并行搜索 ' + qs.join('、');
            }
          }

          // 鎬濊€冨悗琛ュ厖鎼滅储锛氶噸缃唴瀹圭姸鎬佷互鎺ユ敹鏂颁竴杞?stream锛屼繚鐣欏凡鏄剧ず鐨勬€濊€冭繃绋?
          if (evt.type === 'search_supplement') {
            var searchNote = el('div', { class: 'ai-search-supplement', text: '正在联网补充信息...' });
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
            // 鏄剧ず鎼滅储鐘舵€佹潯
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
            // 鏄剧ず浣跨敤鐨?provider
            if (searchDiag && searchDiag.provider_results && searchDiag.provider_results.length) {
              var firstProv = searchDiag.provider_results[0];
              if (firstProv && firstProv.provider) {
                summaryText += ' (' + firstProv.provider + ')';
              }
            }
            // 清空并重建（避免重复 append锛?
            searchBar.innerHTML = '';
            searchBar.textContent = summaryText;
            var resultsArr = evt.results;
            var queryStr = evt.query || '';
            if (resultsArr && resultsArr.length > 0) {
              var toggleBtn = el('span', { class: 'ai-search-toggle' }, ' ▸');
              searchBar.appendChild(toggleBtn);
              searchBar.style.cursor = 'pointer';
              var detailPanel = el('div', { class: 'ai-search-detail', style: 'display:none;' });
              searchBar.appendChild(detailPanel);
              // 鏄剧ず鎼滅储鍏抽敭璇?
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
                toggleBtn.textContent = isHidden ? ' ▾' : ' ▸';
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
            // 鏄剧ず璇︾粏失败鍘熷洜锛堝彲灞曞紑锛?
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
          
          if (evt.type === 'card') {
            try { renderAiToolCard(messagesEl, evt.card); } catch (cardErr) { notify('AI 卡片加载失败，已保留文字回复'); }
            continue;
          }

          if (evt.type === 'tool_pending') {
            var pendingBar = messagesEl.querySelector('.ai-tool-status');
            if (!pendingBar) { pendingBar = el('div', { class: 'ai-tool-status' }); messagesEl.appendChild(pendingBar); }
            pendingBar.textContent = 'AI 正在准备：' + (evt.tool_name || '站内工具');
            continue;
          }

          if (evt.type === 'tool_error') {
            notify((evt.tool_name || 'AI 工具') + '：' + (evt.error || '执行失败'));
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
                summaryText = label + ' · ' + evt.count + ' 条结果' + (evt.location ? (' · ' + evt.location) : '');
              } else {
                summaryText = label + ' · 完成' + (evt.location ? (' · ' + evt.location) : '');
              }
            } else {
              summaryText = label + ' · 失败' + (evt.error ? (': ' + evt.error.slice(0, 80)) : '');
            }
            toolBar2.innerHTML = '';
            toolBar2.textContent = summaryText;
            var itemsArr = evt.items;
            var queryStr2 = evt.query || '';
            if (itemsArr && itemsArr.length > 0) {
              var toggleBtn2 = el('span', { class: 'ai-search-toggle' }, ' ▸');
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
                toggleBtn2.textContent = isHidden ? ' ▾' : ' ▸';
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
              // 娌℃湁鍐呭锛屽洖婊?
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
          
          // 鍏煎鏃ч敊璇牸寮忥紙鏃?type 但有 error锛?
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
            // 如果 reasoning_start 浜嬩欢涓㈠け锛岄娆℃敹鍒?reasoning 也启动计时器
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
                minChunk: 2,
                maxChunk: 8,
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
              // sanitized_content 浼樺厛锛氬悗绔竻娲楀悗鐨勬鏂?
              if (evt.sanitized_content) {
                aiContent = evt.sanitized_content;
              } else if (evt.content) {
                aiContent = evt.content;
              }
            } catch (e) {}
            
            var _sanitizedRendered = false;
            if (evt.sanitized_content && evt.sanitized_content.length > 0 && aiBubble) {
              if (contentRenderer) {
                try { contentRenderer.cancel(); } catch (e) {}
                contentRenderer = null;
              }
              aiBubble.innerHTML = '';
              aiBubble.innerHTML = renderMarkdown(evt.sanitized_content);
              _sanitizedRendered = true;
            }
            
            var streamInterrupted = evt.interrupted === true;
            var streamComplete = evt.complete === true;
            var streamSaved = evt.saved === true;
            
            if (!_sanitizedRendered && aiContent) {
              ensureAssistantBubble();
              finishAiMessage(aiNode, aiContent, aiReasoning, evt);
            } else if (!_sanitizedRendered && aiReasoning) {
              if (!aiNode) ensureReasoningNode();
              finishAiMessage(aiNode, '', aiReasoning, evt);
            }
            
            // 涓柇/鏈繚瀛樻彁绀?
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
              var filteredNote = el('div', { class: 'ai-filtered-note' }, '已自动清理动作描述');
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
        // 已在 done/error 浜嬩欢涓畬鎴愭覆鏌?
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
      // 缃戠粶閿欒鎴?abort
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
          notify('缃戠粶寮傚父锛岃妫€鏌ヨ繛鎺ュ悗閲嶈瘯');
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
    var requestId = ++S.historyRequestId;
    var requestedConversationId = S.conversationId;

    if (!before && messagesEl) {
      messagesEl.setAttribute('aria-busy', 'true');
      if (!messagesEl.children.length || messagesEl.querySelector('.ai-history-unavailable')) {
        messagesEl.innerHTML = '';
        var loadingState = buildEmptyState('正在加载聊天记录…');
        loadingState.classList.add('ai-history-loading');
        messagesEl.appendChild(loadingState);
      }
    }

    try {
      var qs = '?limit=' + HISTORY_PAGE_SIZE;
      if (S.conversationId) qs += '&conversation_id=' + encodeURIComponent(S.conversationId);
      if (before) qs += '&before=' + encodeURIComponent(before);
      qs += '&mode=normal';
      var r = await apiRequest('GET', '/chat/history' + qs);

      if (requestId !== S.historyRequestId || requestedConversationId !== S.conversationId || messagesEl !== S.messagesEl || !S.active) return;

      if (!r.ok || !r.data) {
        if (!before) {
          try { console.warn('[AI] loadHistory failed:', r.status, r.error); } catch (e) {}
          renderHistoryUnavailable(messagesEl, r.status);
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
        msgs.forEach(function(m) { appendMessage(messagesEl, m); });
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
      } else {
        var oldScroll = messagesEl.scrollHeight;
        var frag = document.createDocumentFragment();
        for (var mi = 0; mi < msgs.length; mi++) {
          var node = buildMessageNode(msgs[mi], messagesEl);
          frag.appendChild(node);
        }
        messagesEl.insertBefore(frag, messagesEl.firstChild);
        try {
          requestAnimationFrame(function() {
            messagesEl.scrollTop = messagesEl.scrollHeight - oldScroll;
          });
        } catch (e2) {}
      }
    } finally {
      if (requestId === S.historyRequestId) {
        S.loading = false;
        S.loadingMore = false;
        if (!before && messagesEl) messagesEl.removeAttribute('aria-busy');
      }
    }
  }

  // 鑾峰彇浼氳瘽鍒楄〃锛堟櫘閫氳亰澶╁彧鏄剧ず鏅€氫細璇濓紝娣卞害鐮旂┒浼氳瘽鍒嗗紑绠＄悊锛?
  async function fetchConversations() {
    try {
      var r = await apiRequest('GET', '/chat/conversations?limit=50&mode=normal');
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
        var delBtn = el('span', { class: 'ai-conv-del', title: '删除此对话', 'aria-label': '删除对话' }, '×');
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
        // 浠?S.conversations 涓Щ闄?
        S.conversations = (S.conversations || []).filter(function(c) { return c.conversation_id !== cid; });
        // 濡傛灉删除鐨勬槸褰撳墠瀵硅瘽锛岄噸缃?
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
    
    var requestId = ++S.conversationRequestId;
    S.historyRequestId += 1;
    S.loading = false;
    S.loadingMore = false;
    S.conversationId = cid;
    writeConvId(cid);
    S.messages = [];
    S.oldestCursor = null;
    S.hasMore = false;
    if (S.messagesEl) S.messagesEl.innerHTML = '';
    setAiRootState('ai-loading');
    
    try {
      var r = await apiRequest('GET', '/chat/history?conversation_id=' + encodeURIComponent(cid) + '&limit=' + HISTORY_PAGE_SIZE + '&mode=normal');
      if (requestId !== S.conversationRequestId || cid !== S.conversationId || !S.active) return;
      if (r && r.ok && r.data && r.data.messages) {
        S.messages = r.data.messages;
        S.hasMore = r.data.has_more;
        S.oldestCursor = r.data.oldest || null;
      }
    } catch (e) {
      if (requestId !== S.conversationRequestId || cid !== S.conversationId || !S.active) return;
      try { console.warn('[AI-CONV] switchConversation error:', e && e.message); } catch(ee) {}
      notify('加载对话历史失败');
    }
    
    if (requestId !== S.conversationRequestId || cid !== S.conversationId || !S.active) return;
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
    info.appendChild(el('div', { class: 'ai-chat-header-name', id: 'aiChatHeaderName', text: '小猫' }));
    info.appendChild(el('div', { class: 'ai-chat-header-status', id: 'aiChatHeaderStatus', text: getAiStatusText() }));
    header.appendChild(info);

    // 深度思考?toggle 按钮
    var deepThinkBtn = el('button', {
      type: 'button',
      class: 'ai-deep-think-toggle' + (S.deepThink ? ' on' : ''),
      'aria-label': '深度思考模式',
      title: '深度思考模式 - AI 会先做更深入的分析再回答',
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
          // 寮€鍚柊瀵硅瘽
          var r2 = await apiRequest('POST', '/chat/new', null);
          if (r2 && r2.ok && r2.data && r2.data.conversation_id) {
            S.conversationId = r2.data.conversation_id;
            writeConvId(r2.data.conversation_id);
            // 恢复 empty state锛堝厛娓?loading 再追加）
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
    messagesEl.addEventListener('scroll', window.throttleRAF(function() {
      S.autoScrollPinned = isNearBottom(messagesEl, 84);
      if (messagesEl.scrollTop < 60 && S.hasMore && !S.loading && !S.loadingMore && S.oldestCursor) {
        loadHistory(messagesEl, S.oldestCursor);
      }
    }));
    root.appendChild(messagesEl);

    // 鍘嗗彶浼氳瘽鎻愮ず鏍?
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
    // 文件上传按钮 (左边)
    var fileBtn = el('button', {
      type: 'button',
      class: 'ai-chat-file-btn',
      id: 'aiChatFileBtn',
      'aria-label': '上传文件',
      title: '上传图片或文件'
    });
    fileBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
    var fileInput = el('input', { type: 'file', id: 'aiChatFileInp', accept: 'image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx', style: 'display:none' });
    // 文件预览区域
    var filePreview = el('div', { class: 'ai-chat-file-preview', id: 'aiChatFilePreview', style: 'display:none' });
    var input = el('textarea', {
      class: 'ai-chat-input',
      id: 'aiChatMsgInput',
      placeholder: '问问小猫……',
      rows: '1',
      'aria-label': '聊天输入框',
      inputmode: 'text',
      enterkeyhint: 'send',
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
      if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
      var text = String(input.value || '').trim();
      if (!text && !_aiChatFileData) return;
      var fileData = _aiChatFileData;
      _aiChatFileData = null;
      filePreview.style.display = 'none';
      filePreview.innerHTML = '';
      fileInput.value = '';
      handleSendMessage(input, sendBtn, messagesEl, fileData);
    }

    sendBtn.addEventListener('click', doSend);
    pauseBtn.addEventListener('click', function() {
      if (!S.sending) return;
      var anyPaused = S.activeRenderers && S.activeRenderers.some(function(r) { return r.isPaused && r.isPaused(); });
      if (anyPaused) {
        // 恢复
        if (S.activeRenderers) S.activeRenderers.forEach(function(r) { if (r.resume) r.resume(); });
        S.paused = false;
        pauseBtn.textContent = '暂停';
      } else {
        // 真正中止 SSE 请求 + 暂停渲染
        try { if (S.abortController) S.abortController.abort(); } catch (e) {}
        try { if (S.deepThinkJob && S.deepThinkJob.abort) S.deepThinkJob.abort(); } catch (e) {}
        if (S.activeRenderers) S.activeRenderers.forEach(function(r) { if (r.pause) r.pause(); });
        S.paused = true;
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

    // 文件上传逻辑
    var _aiChatFileData = null; // { name, type, dataUrl }
    fileBtn.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', function() {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 7 * 1024 * 1024) { notify('文件不能超过 7MB'); return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        _aiChatFileData = { name: f.name, type: f.type, dataUrl: e.target.result };
        filePreview.innerHTML = '';
        var thumb;
        if (f.type.startsWith('image/')) {
          thumb = el('img', { src: e.target.result, class: 'ai-file-thumb' });
        } else {
          thumb = el('div', { class: 'ai-file-icon' }, '📄');
        }
        var info = el('span', { class: 'ai-file-info', text: f.name + ' (' + Math.round(f.size / 1024) + 'KB)' });
        var removeBtn = el('button', { type: 'button', class: 'ai-file-remove' }, '×');
        removeBtn.addEventListener('click', function() {
          _aiChatFileData = null;
          filePreview.style.display = 'none';
          filePreview.innerHTML = '';
          fileInput.value = '';
        });
        filePreview.appendChild(thumb);
        filePreview.appendChild(info);
        filePreview.appendChild(removeBtn);
        filePreview.style.display = 'flex';
      };
      reader.readAsDataURL(f);
    });

    inputBar.appendChild(fileBtn);
    inputBar.appendChild(fileInput);
    inputBar.appendChild(filePreview);
    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    inputBar.appendChild(pauseBtn);
    root.appendChild(inputBar);

    S.resizeTimer = setTimeout(autoresize, 0);

    // 鈽?M: 娓叉煋鍚庣珛鍒诲悓步ユ繁搴︽€濊€?toggle 视觉
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
      notify('请先登录后再和小猫聊天');
      return;
    }
    // 鈽?M: 鎭㈠深度思考冩ā寮忕姸鎬?
    restoreDeepThinkState();
    S.active = true;
    var lifecycleId = ++S.lifecycleId;
    window.__xtjAiChatActive = true;
    var authOk = await ensureUserAuthOrNotify();
    if (lifecycleId !== S.lifecycleId || !S.active) return;
    if (!authOk) {
      S.active = false;
      window.__xtjAiChatActive = false;
      return;
    }

    S.autoScrollPinned = true;

    try { closeSiteSearch(); } catch (e) {}
    var aiPanel = document.getElementById('panelAiChat');
    if (!aiPanel) {
      S.active = false;
      window.__xtjAiChatActive = false;
      notify('AI 页面未加载，请刷新后重试');
      return;
    }
    aiPanel.classList.remove('hidden');
    aiPanel.classList.add('active');
    aiPanel.setAttribute('aria-hidden', 'false');
    aiPanel.removeAttribute('aria-busy');
    aiPanel.innerHTML = '';
    updateSecondaryPageState(true, 'ai-chat');

    var r = renderAiRoot();
    aiPanel.appendChild(r.root);
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
    if (S._configRefreshTimer) { try { clearInterval(S._configRefreshTimer); } catch(e) {} }
    S._configRefreshTimer = setInterval(function() { ensureConfig().then(applyConfigToUI).catch(function(){}); }, CONFIG_REFRESH_INTERVAL);

    if (S.viewportCleanup) {
      try { S.viewportCleanup(); } catch (e3) {}
    }
    S.viewportCleanup = bindVisualViewport(r.messagesEl, r.input, r.inputBar);

    S.conversationId = readConvId();

    try {
      var cfg = await ensureConfig();
      if (lifecycleId !== S.lifecycleId || !S.active) return;
      applyConfigToUI(cfg);
    } catch (e4) {}

    await loadHistory(r.messagesEl, null);
    if (lifecycleId !== S.lifecycleId || !S.active || r.messagesEl !== S.messagesEl) return;

    // fallback: localStorage 鐨?convId 鏃犳晥锛堟病鏈夊巻鍙叉秷鎭級锛屽皾璇曞姞杞芥渶杩戜細璇?
    if (!S.messages.length && S.conversationId) {
      try {
        var convR = await apiRequest('GET', '/chat/conversations?limit=1&mode=normal');
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
    if (nameEl) nameEl.textContent = cfg.name || 'AI';
    updateAiStatus();

    var inp = document.getElementById('aiChatMsgInput');
    if (inp) inp.placeholder = '和 ' + (cfg.name || '小猫') + ' 说点什么吧…';

    var empty = document.querySelector('#aiChatRoot .ai-chat-empty');
    if (empty) {
      var e1 = empty.querySelector('.ai-chat-empty-emoji');
      if (e1) renderCatAvatarNode(e1, 'ai-chat-empty-avatar', S.config && S.config.avatar_url, S.config && S.config.avatar_version);
      var e2 = empty.querySelector('.ai-chat-empty-title');
      if (e2) e2.textContent = '和 ' + (cfg.name || 'AI') + ' 聊聊天';
      var e3 = empty.querySelector('.ai-chat-empty-tip');
      if (e3) e3.textContent = cfg.welcome_message || '嗨，来聊天吧。';
    }

    // 鈽?P 鏂板: 鍚屾鍚庣深度思考冨瓙閰嶇疆 (鎬濊€冪▼搴?+ 鍚敤寮€鍏?
    try {
      if (cfg.deep_think) {
        if (['low', 'medium', 'high', 'max'].indexOf(cfg.deep_think.default_thinking_mode) >= 0) {
          S.deepThinkEffort = cfg.deep_think.default_thinking_mode;
        }
        S.deepThinkEnabled = cfg.deep_think.enabled !== false;
      }
      // 鏅€氳亰澶╃殑 thinkingMode 涔熷悓步)(浠?model.default_thinking_mode 璇?
      if (cfg.model && ['low', 'medium', 'high', 'max', 'off'].indexOf(cfg.model.default_thinking_mode) >= 0) {
        S.thinkingMode = cfg.model.default_thinking_mode;
      }
    } catch (e) { /* 容错 */ }

    // 鈽?P 鏂板: 濡傛灉鍚庣绂佺敤浜嗘繁搴︽€濊€? 寮哄埗鍏抽棴 toggle
    if (!S.deepThinkEnabled && S.deepThink) {
    S.deepThink = false;
    try { localStorage.setItem('xtj_ai_deep_think', '0'); } catch (e) {}
      try { refreshDeepThinkToggle(); } catch (e) {}
    }
  }

  function closeAiChat() {
    if (!S.active) return;
    S.active = false;
    S.lifecycleId += 1;
    S.historyRequestId += 1;
    S.conversationRequestId += 1;
    window.__xtjAiChatActive = false;
    clearReplyTimer();
    abortCurrentRequest(); // 鍐呴儴宸茶皟鐢?clearStreamCleanup
    // 鍏抽棴深度思考冧簩绾ч〉闈紝閬垮厤瀹冩畫鐣欏湪鏅€氳亰澶╀箣涓?
    // Clean up deep think state
    if (S.deepThinkProgressCard) {
      try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e) {}
    }
    // 鈽?U3 Bug 4 修复: 不再重置 S.deepThink, 淇濇寔鐢ㄦ埛鐨?toggle 偏好
    S.deepThinkJob = null;
    S.deepThinkProgressCard = null;
    // 閲嶇疆鎵€鏈夌姸鎬侊紝閬垮厤閲嶅紑鍚庢畫鐣?
    S.sending = false;
    S.paused = false;
    S.activeRenderers = [];
    if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
    S.messages = [];
    S.conversations = [];
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
    if (S._configRefreshTimer) {
      try { clearInterval(S._configRefreshTimer); } catch (e) {}
      S._configRefreshTimer = null;
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

    var aiPanel = document.getElementById('panelAiChat');
    if (aiPanel) {
      aiPanel.classList.add('hidden');
      aiPanel.classList.remove('active');
      aiPanel.setAttribute('aria-hidden', 'true');
    }
    updateSecondaryPageState(false, 'ai-chat');

    if (S.rootEl) {
      try { S.rootEl.remove(); } catch (e6) {}
    }
    S.rootEl = null;
    S.messagesEl = null;
    S.inputBarEl = null;
    S.inputEl = null;
    S.sendBtnEl = null;

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
    if (insertTimer) { try { clearTimeout(insertTimer); } catch(e) {} insertTimer = null; }
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

    var cfg = S.config || { name: '小猫', avatar: '🐈', description: '小猫 智能体' };
    var name = cfg.name || '小猫';
    var avatar = cfg.avatar || '🐈';
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
        notify('请先登录后再和' + name + ' 聊天');
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
    // AI is launched only from the homepage tools menu. This keeps cached
    // chat-list DOM from retaining the retired AI pseudo-contact.
    removeAllAiEntries();
    return;
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
      // 鍒囨崲鍑鸿亰澶?tab 鏃朵竴骞跺叧闂繁搴︽€濊€冧簩绾ч〉闈?
      if (tab !== 'chat') {
        try { closeDeepThinkPage(); } catch (e) {}
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
    getConversationId: function() { return S.conversationId; },
    openDeepThink: openDeepThinkPage,
    openSiteSearch: openSiteSearchPage,
    openConversation: async function(conversationId, mode) {
      if (!conversationId) return false;
      if (mode === 'deep_think') {
        S.dtConversationId = conversationId;
        saveDtConvId();
        await openDeepThinkPage();
        return true;
      }
      await openAiChat();
      await switchConversation(conversationId);
      return true;
    }
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
        name: '小猫',
        avatar: '🐈',
        description: 'AI 智能体',
        welcome_message: '我是小猫，徐旭泽的毒舌 AI 分身。有什么问题直接问，别绕弯子。'
      };
      scheduleInsertEntry();
    });
    bindTopAiTools();
    hookChatList();
    hookAiTabVisibility();
    bindDeepThinkPageEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
