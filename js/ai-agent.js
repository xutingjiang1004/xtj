
// ★ 使用安全的 throttleRAF（复用 core.js 版本或添加 try/finally）
if (typeof window.throttleRAF !== 'function') window.throttleRAF = function(fn) {
    var ticking = false, args, ctx;
    return function() {
        args = arguments;
        ctx = this;
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(function() {
                try {
                    fn.apply(ctx, args);
                } finally {
                    ticking = false;
                }
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

  var AI_DISPLAY_NAME = '小猫';
  // Keep the first network payload small; older messages remain available by scrolling.
  var HISTORY_PAGE_SIZE = 10;
  var CONFIG_CACHE_TTL = 5 * 60 * 1000;
  var CONFIG_REFRESH_INTERVAL = 5 * 60 * 1000; // ★ U3: 与 TTL 保持一致，避免每分钟做无用功
  var CONV_ID_KEY = 'xtj_ai_last_conversation_id';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
  var DT_CONV_KEY = 'xtj_ai_dt_conversation_id';
  var USER_NAME_KEYS = ['xtj_user', 'xtj_username', 'xtj_user_name'];
  var _isTouchMobile = typeof window !== 'undefined' && 'ontouchstart' in window && 'visualViewport' in window;
  var escapeHtml = window.escapeHtml || function(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g, '&#39;'); };

  // ★ P0-1 修复: 唯一默认思考程度常量。状态优先级固定为
  //   后端配置 (applyConfigToUI) > localStorage > DEFAULT_THINKING_MODE
  //   之前 S 对象内出现两个 thinkingMode 字段 (low/medium)，后者静默覆盖前者，
  //   注释却又声称默认 max。此处删除重复字段，建立唯一真源。
  var DEFAULT_THINKING_MODE = 'max';
  var DEFAULT_AI_MODEL = 'deepseek-v4-flash';
  var ALLOWED_THINKING_MODES = ['off', 'low', 'medium', 'high', 'max'];
  var ALLOWED_AI_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];

  // 初始化思考程度：localStorage > 默认值（后端配置在 applyConfigToUI 中再覆盖）
  //   注意：初始化只发生一次；后端配置到达后会通过 applyConfigToUI 显式赋值，
  //   不会被这里的旧默认值再次覆盖（applyConfigToUI 在每次 config 刷新时执行）。
  function resolveInitialThinkingMode() {
    try {
      var saved = localStorage.getItem('xtj_ai_thinking_mode');
      if (saved && ALLOWED_THINKING_MODES.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    return DEFAULT_THINKING_MODE;
  }
  function resolveInitialModel() {
    try {
      var saved = localStorage.getItem('xtj_ai_model');
      if (saved && ALLOWED_AI_MODELS.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    return DEFAULT_AI_MODEL;
  }

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
    thinkingMode: resolveInitialThinkingMode(),
    // Normal chat has a bounded, tool-aware middle gear.  It is intentionally
    // separate from deep research so the latter remains a dedicated flow.
    responseProfile: 'normal',
    // ★ P 新增: 深度思考专用思考程度(从后端 config 同步, 与普通聊天分开)
    deepThinkEffort: 'max',
    deepThinkEnabled: true,    // 后端 config.deep_think.enabled
    tavilyResearchEnabled: false, // 后端 config.tavily_research.enabled (Tavily Deep Research)
    // ★ M: 深度思考模式 toggle 状态
    //   开启后本会话所有消息走 Planner→Workers→Synthesizer 多 agent 流程
    //   持久化到 localStorage, 重开对话框后恢复
    deepThink: false,
    deepThinkJob: null,         // AbortController for current deep think request
    deepThinkProgressCard: null, // DOM node for progress card
    dtConversationId: null,      // 深度思考二级页面当前会话 ID（与普通聊天分开）
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
    // ★ 修复：深度思考二级页面独立请求 ID 通道，与普通聊天 _currentReqId 隔离，
    // 避免深页流式输出期间打开普通聊天发消息导致深页 SSE 被误判"被取代"而中断。
    _dtCurrentReqId: null,
    // ★ 修复：深度思考二级页面独立 AbortController，与普通聊天 S.abortController 隔离，
    // 避免深页关闭/超时误杀普通聊天正在进行的流式请求。
    _dtAbortController: null,
    _lastMsgDedupKey: '',
    _lastDtDedupKey: '',
    _lastConfigVersion: 0,
    serviceStatus: 'checking',
    serviceStatusDetail: '',
    resizeTimer: null,
    _configRefreshTimer: null,
    historyRequestId: 0,
    conversationRequestId: 0,
    lifecycleId: 0,
    lastSendFingerprint: '',
    lastSendAt: 0,
    webSearchEnabled: false,
    selectedModel: resolveInitialModel(),
    _userPickedThinkingMode: false,
    _userPickedModel: false
  };

  function getAiStatusText() {
    if (S.serviceStatus === 'ready') return '在线';
    if (S.serviceStatus === 'degraded') return '服务暂不可用';
    if (S.serviceStatus === 'offline') return '服务离线';
    return '正在检查服务…';
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
        else if (k === 'html') node.textContent = v; // ★ 安全: 禁用 innerHTML, 改用 textContent
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
  var _menuAbort = null; // ★ U3: 管理复制菜单的 document 监听器

  function closeCopyMenu() {
    if (_copyMenuActive) {
      try {
        if (_copyMenuActive.parentNode) _copyMenuActive.parentNode.removeChild(_copyMenuActive);
      } catch (e) {}
      _copyMenuActive = null;
    }
    // ★ U3: 关闭菜单时立即取消 pending 的 document 监听器, 避免累积
    if (_menuAbort) {
      try { _menuAbort.abort(); } catch (e) {}
      _menuAbort = null;
    }
  }

  // 清理模型 reasoning 内容里常见的整段括号包裹，提升可读性
  function cleanReasoningText(txt) {
    if (!txt) return '';
    return String(txt).split('\n').map(function(line) {
      var trimmed = line.trim();
      if (!trimmed) return line;
      // 仅当整段以 ( 开头、以 ) 结尾时去掉最外层括号
      if (trimmed.charAt(0) === '(' && trimmed.charAt(trimmed.length - 1) === ')') {
        return trimmed.slice(1, -1);
      }
      return line;
    }).join('\n');
  }

  // 简单 Markdown → HTML 渲染
  function escapeAttr(val) {
    if (!val) return '';
    return String(val).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Search results are supplied by the server, but are still untrusted data.
  // Keep navigation on web URLs only; never let a malformed result become a
  // javascript:, data:, blob:, or relative navigation target.
  function safeSearchUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      var parsed = new URL(raw, window.location.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  }

  function isSupportedAiFile(file) {
    if (!file) return false;
    var name = String(file.name || '').toLowerCase();
    if (String(file.type || '').indexOf('image/') === 0) return true;
    return /\.(pdf|docx|txt|csv|xlsx)$/.test(name);
  }

  function renderMarkdown(txt) {
    if (!txt) return '';
    var s = String(txt);
    // ★ 先提取代码块，避免重复转义
    var codeBlocks = [];
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
      var idx = codeBlocks.length;
      // 代码块只转义一次
      codeBlocks.push('<pre><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
      return '%%%CODEBLOCK' + idx + '%%%';
    });
    // ★ 普通正文：HTML 转义
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 图片: 只允许 data:image/ 协议
    s = s.replace(/!\[([^\]]*)\]\(data:image\/([^;]+);base64,([^)]+)\)/g, function(m, alt, ext, b64) {
      return '<img src="data:image/' + escapeAttr(ext) + ';base64,' + escapeAttr(b64) + '" alt="' + escapeAttr(alt) + '" class="ai-uploaded-image" loading="lazy" style="max-width:100%;max-height:300px;border-radius:8px;margin:4px 0;">';
    });
    // 链接: 使用 DOM API 防 XSS, 白名单协议: http:, https:, mailto:
    // ★ 安全: 用 new URL() 解析协议而非字符串前缀匹配。前缀匹配会被
    //   实体编码 (如 java&#x09;script:) 或协议混淆 (如 https://x@javascript:)
    //   绕过,交给浏览器解析后可能执行。URL 解析后浏览器会对协议做
    //   规范化,这里再校验最终协议,双重防护。
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, label, href) {
      var cleanHref = String(href).trim();
      var protocolOk = false;
      try {
        var parsedUrl = new URL(cleanHref, window.location && window.location.origin ? window.location.origin : 'https://xtj.local');
        var proto = String(parsedUrl.protocol || '').toLowerCase();
        protocolOk = (proto === 'http:' || proto === 'https:' || proto === 'mailto:');
      } catch (_) { protocolOk = false; }
      if (!protocolOk) {
        if (cleanHref.toLowerCase().indexOf('data:') === 0) return '<span class="ai-file-link" title="' + escapeAttr(label) + '">' + escapeHtml(label) + '</span>';
        return '<span class="ai-blocked-link" title="' + escapeAttr(label) + '">' + escapeHtml(label) + '</span>';
      }
      var a = document.createElement('a');
      a.href = cleanHref;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      return a.outerHTML;
    });
    s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Markdown tables: convert only blocks with a real separator row. The
    // text has already been HTML-escaped above, so cell contents are safe to
    // place in the generated table markup.
    s = s.replace(/(?:^|\n)((?:\s*\|?[^\n]*\|[^\n]*(?:\n|$)){2,})/g, function (whole, block) {
      var lines = block.trim().split(/\n/).map(function (line) { return line.trim(); });
      if (lines.length < 2) return whole;
      var separator = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/;
      if (!separator.test(lines[1])) return whole;
      function cells(line) {
        var value = line.replace(/^\|\s*/, '').replace(/\s*\|$/, '');
        return value.split('|').map(function (cell) { return cell.trim(); });
      }
      var header = cells(lines[0]);
      var rows = lines.slice(2).map(cells);
      var html = '<table><thead><tr>' + header.map(function (cell) { return '<th>' + cell + '</th>'; }).join('') + '</tr></thead>';
      if (rows.length) {
        html += '<tbody>' + rows.map(function (row) {
          return '<tr>' + header.map(function (_, index) { return '<td>' + (row[index] || '') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody>';
      }
      return (whole.charAt(0) === '\n' ? '\n' : '') + html;
    });
    s = s.replace(/^- (.+)$/gm, '<li class="ul-item">$1</li>');
    s = s.replace(/(<li class="ul-item">.*<\/li>\n?)+/g, function(m) {
      return '<ul>' + m.replace(/ class="ul-item"/g, '') + '</ul>';
    });
    s = s.replace(/^\d+\. (.+)$/gm, '<li class="ol-item">$1</li>');
    s = s.replace(/(<li class="ol-item">.*<\/li>\n?)+/g, function(m) {
      return '<ol>' + m.replace(/ class="ol-item"/g, '') + '</ol>';
    });
    s = s.replace(/\n/g, '<br>');
    // ★ 恢复代码块
    s = s.replace(/%%%CODEBLOCK(\d+)%%%/g, function(m, idx) { return codeBlocks[parseInt(idx)] || ''; });
    return s;
  }

  function setupBubbleCopy(bubbleEl, containerEl) {
    if (!bubbleEl || !bubbleEl.parentNode) return;
    var _longPressTimer = null;
    var _longPressStarted = false;
    // L10 修复：原文为 UTF-8 被按 GBK 解读产生的乱码注释，恢复正确文案
    // ★ U3: AbortController 管理所有监听器，移除时统一清理
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
      // ★ U3: 用 AbortController 关闭旧的 document 监听器
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

    // ★ U3: 所有事件监听统一通过 AbortController 管理
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

    // 暴露 cleanup 钩子供软删除时调用
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
    // ★ U3: 如果 version 相同且已有内容，跳过重建 (避免每分钟重新下载头像)
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

  function writeConvId(v) {
    try {
      // ★ 修复：存储键并入用户名，防止同一浏览器多账号切换时串会话
      var un = readUserName();
      var key = CONV_ID_KEY + (un ? ':' + encodeURIComponent(un) : '');
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch (e) {}
  }

  function readUserName() {
    if (window.currentUser) {
      if (typeof window.currentUser === 'string' && window.currentUser.indexOf('[object Object]') === -1) return window.currentUser;
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

  function getAiHistoryCacheUserKey() {
    var un = readUserName();
    if (!un || un.indexOf('[object Object]') !== -1) return null;
    return encodeURIComponent(un);
  }

  function getAiHistoryCacheKey(cid, mode) {
    var uk = getAiHistoryCacheUserKey();
    if (!uk) return null;
    mode = mode || 'normal';
    return 'xtj_ai_history:' + uk + ':' + encodeURIComponent(mode) + ':' + encodeURIComponent(cid || 'default');
  }

  function getLegacyAiHistoryCacheKey(cid) {
    var uk = getAiHistoryCacheUserKey();
    if (!uk) return null;
    return 'xtj_ai_history:' + uk + ':' + encodeURIComponent(cid || 'default');
  }

  function extractCompleteTurns(msgs, maxTurns) {
    if (!Array.isArray(msgs) || !msgs.length) return [];
    maxTurns = maxTurns || 6;
    var turns = [];
    var currentTurn = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m) continue;
      if (m.role === 'user') {
        if (currentTurn.length > 0) {
          if (currentTurn.some(function(tm) { return tm && tm.role === 'assistant'; })) {
            turns.push(currentTurn);
          }
        }
        currentTurn = [m];
      } else {
        if (currentTurn.length > 0) {
          currentTurn.push(m);
        }
      }
    }
    if (currentTurn.length > 0 && currentTurn.some(function(tm) { return tm && tm.role === 'assistant'; })) {
      turns.push(currentTurn);
    }
    var recentTurns = turns.slice(-maxTurns);
    var resultMsgs = [];
    recentTurns.forEach(function(t) {
      resultMsgs = resultMsgs.concat(t);
    });
    return resultMsgs;
  }

  function setAiHistoryCache(cid, msgs) {
    var mode = arguments.length > 2 && arguments[2] ? String(arguments[2]) : 'normal';
    var key = getAiHistoryCacheKey(cid, mode);
    if (!key) return;
    try {
      var completeMsgs = extractCompleteTurns(msgs, 6);
      if (!completeMsgs.length) {
        sessionStorage.removeItem(key);
        return;
      }
      var cacheObj = {
        conversation_id: cid || 'default',
        messages: completeMsgs,
        partial: true,
        cached_at: Date.now()
      };
      sessionStorage.setItem(key, JSON.stringify(cacheObj));
      // The first open after a reload has not resolved a conversation id yet.
      // Keep a per-user latest alias so it can paint immediately while the server refreshes it.
      if (cid) {
        var latestKey = getAiHistoryCacheKey(null, mode);
        if (latestKey && latestKey !== key) sessionStorage.setItem(latestKey, JSON.stringify(cacheObj));
      }
    } catch (e) {}
  }

  function getAiHistoryCache(cid) {
    var mode = arguments.length > 1 && arguments[1] ? String(arguments[1]) : 'normal';
    var key = getAiHistoryCacheKey(cid, mode);
    if (!key) return null;
    try {
      var str = sessionStorage.getItem(key);
      // Read legacy normal-chat entries once for backwards compatibility, but
      // never write them again; deep/research mode can no longer collide with
      // normal history in the new key space.
      if (!str && mode === 'normal') str = sessionStorage.getItem(getLegacyAiHistoryCacheKey(cid));
      if (!str) return null;
      var obj = JSON.parse(str);
      if (!obj) return null;
      var rawMsgs = Array.isArray(obj) ? obj : (obj.messages && Array.isArray(obj.messages) ? obj.messages : null);
      if (!rawMsgs || !rawMsgs.length) return null;
      if (obj.conversation_id && cid && obj.conversation_id !== cid && obj.conversation_id !== 'default') return null;
      var validMsgs = extractCompleteTurns(rawMsgs, 6);
      if (!validMsgs.length) validMsgs = rawMsgs;
      return { conversation_id: (obj && obj.conversation_id) || cid || 'default', messages: validMsgs, partial: true, cached_at: (obj && obj.cached_at) || 0 };
    } catch (e) {}
    return null;
  }

  function clearAiHistoryCacheForUser() {
    var uk = getAiHistoryCacheUserKey();
    try {
      var keysToRemove = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var key = sessionStorage.key(i);
        if (!key) continue;
        if (uk && key.indexOf('xtj_ai_history:' + uk + ':') === 0) {
          keysToRemove.push(key);
        } else if (key.indexOf('xtj_ai_history:') === 0) {
          // If no specific user, or clearing general AI history cache
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function(k) { sessionStorage.removeItem(k); });
    } catch (e) {}
  }
  window.clearAiHistoryCacheForUser = clearAiHistoryCacheForUser;

  function abortCurrentRequest() {
    clearStreamCleanup();
    // Phase 1: Cancel shared controller in-flight request
    if (window.XtjAiCore && window.XtjAiCore.RequestController) {
      var inFlight = window.XtjAiCore.RequestController.getInFlight('cat_ai');
      if (inFlight && inFlight.isActive()) {
        try { inFlight.cancel('aborted'); } catch (e) {}
      }
      window.XtjAiCore.RequestController.unregisterInFlight('cat_ai', inFlight);
    }
    if (S.abortController) {
      try {
        S.abortController._abortReason = 'aborted';
        if (typeof S.abortController.abort === 'function') S.abortController.abort('aborted');
      } catch (e) {}
      S.abortController = null;
    }
    // ★ 修复：同时中止历史加载请求（独立 controller，避免与流式发送共用）
    if (S.historyController) {
      try {
        S.historyController._abortReason = 'aborted';
        if (typeof S.historyController.abort === 'function') S.historyController.abort('aborted');
      } catch (e) {}
      S.historyController = null;
    }
    S.sending = false;
    S.paused = false;
    S.loading = false;
    S.loadingMore = false;
    // ★ 修复：显式 cancel 所有活跃渲染器，防止未完成的 rAF 帧继续写入
    // 旧 DOM（仅清空数组会让渲染器后台继续运行，快速打断+新消息时产生
    // 交叉渲染/光标残留）
    var liveRenderers = S.activeRenderers || [];
    for (var rIdx = 0; rIdx < liveRenderers.length; rIdx++) {
      var liveR = liveRenderers[rIdx];
      if (liveR && typeof liveR.cancel === 'function') {
        try { liveR.cancel(); } catch (eCancel) {}
      }
    }
    S.activeRenderers = [];
    if (S.pauseBtnEl) { S.pauseBtnEl.style.display = 'none'; S.pauseBtnEl.textContent = '暂停'; }
  }

  // 深度思考与主聊天共用 S 状态但互为独立流程：
  // 主聊天发送新消息时不得静默取消正在进行的深度思考研究（S6），
  // 反之深度思考页发送时也不得取消主聊天回复。
  // 该函数在"页面级关闭/登出"等全局场景才完整清理两套状态。
  function abortAllAiRequests() {
    abortCurrentRequest();
    if (S.deepThinkJob) {
      try {
        S.deepThinkJob._abortReason = 'aborted';
        if (typeof S.deepThinkJob.abort === 'function') S.deepThinkJob.abort('aborted');
      } catch (e) {}
      S.deepThinkJob = null;
    }
    if (S.deepThinkProgressCard) {
      try { S.deepThinkProgressCard.classList.add('ai-progress-card-done'); } catch (e) {}
      try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e) {}
      try { if (S.deepThinkProgressCard.parentNode) S.deepThinkProgressCard.parentNode.removeChild(S.deepThinkProgressCard); } catch (e) {}
      S.deepThinkProgressCard = null;
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

  // 仅本地开发或显式开启 ai_debug 参数时挂载诊断钩子：生产环境普通用户
  // 从控制台调用会泄露 API Base 与凭据上下文
  var _isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (_isLocalDev) {
    window.__xtjAiAuthDiag = function() {
      return diagRun('manual');
    };
  }

  function clearAiUserToken() {
    clearAiHistoryCacheForUser();
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
      var externalSignal = options.signal || (options.abortController && options.abortController.signal) || null;
      var externalAbortHandler = null;
      if (requestController) {
        opts.signal = requestController.signal;
        if (externalSignal) {
          externalAbortHandler = function() {
            try {
              requestController._abortReason = 'aborted';
              try { requestController.abort(requestController._abortReason); }
              catch (eAbortReason) { requestController.abort(); }
            } catch (eExternalAbort) {}
          };
          if (externalSignal.aborted) externalAbortHandler();
          else if (typeof externalSignal.addEventListener === 'function') externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
        }
        requestTimer = setTimeout(function() {
          try {
            requestController._abortReason = 'timeout';
            if (typeof requestController.abort === 'function') requestController.abort('timeout');
          } catch (eAbort) {}
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
        if (externalSignal && externalAbortHandler && typeof externalSignal.removeEventListener === 'function') {
          try { externalSignal.removeEventListener('abort', externalAbortHandler); } catch (eRemoveAbort) {}
        }
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
      var isAbort = e && e.name === 'AbortError';
      var reason = (requestController && requestController._abortReason) || (opts && opts.signal && opts.signal.reason);
      var errCode = 'network_error';
      var errMsg = (e && e.message) || '网络异常';
      if (isAbort) {
        if (reason === 'aborted' || options.userAborted) {
          errCode = 'aborted';
          errMsg = '请求已取消';
        } else {
          errCode = 'timeout';
          errMsg = '请求超时';
        }
      }
      try { console.warn('[AI] request exception', { method: method, url: url, error: errMsg, error_code: errCode }); } catch (e5) {}
      return { ok: false, status: 0, data: null, error: errMsg, error_code: errCode, url: url, rawText: '' };
    }
  }

  async function apiRequest(method, path, body, opts) {
    if (AI_DEBUG) { try { console.warn('[AI] apiRequest start', { method: method, path: path, apiBase: API_BASE }); } catch (e) {} }
    var first = await sendOnce(method, path, body, Object.assign({ forceNoToken: false }, opts || {}));
    if (AI_DEBUG) { try { console.warn('[AI] first response', { method: method, path: path, status: first && first.status, ok: first && first.ok, url: first && first.url }); } catch (e2) {} }
    if (first && first.status === 401 && first.error_code !== 'aborted') {
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
    if (r.status === 0 || r.error_code === 'timeout' || r.error_code === 'network_error') {
      if (r.error_code === 'aborted') return '请求已取消';
      if (r.error_code === 'timeout') return '聊天记录加载超时，可继续发送消息或点击重试';
      return '聊天记录更新失败，请检查网络后重试';
    }
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
      S.serviceStatus = 'ready';
      S.serviceStatusDetail = '';
      S.configFetchedAt = now;
      S._lastConfigVersion = r.data.config.config_version || 0;
      return S.config;
    }
    S.serviceStatus = r && (r.status === 0 || r.error_code === 'timeout') ? 'offline' : 'degraded';
    S.serviceStatusDetail = describeError(r, 'AI 配置暂不可用');
    S.config = S.config || {
      name: '小猫',
      avatar: '🐈',
      description: '服务暂不可用，请稍后重试',
      welcome_message: '我是小猫，徐旭泽的毒舌 AI 分身。有什么问题直接问，别绕弯子。'
    };
    updateAiStatus();
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
        // ★ U3: 动态 currency 符号
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

  // ★ O 修复 Bug 4: 从 history 恢复 think-card
  //   閫€鍑哄璇濇閲嶈繘鍚? deep_think=true 的消息渲染成 think-card
  // ★ Q 重做: 极简版（与 handleSendDeepThink 一致结构）
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

      // header 点击可展开/折叠
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

    // 渲染思考过程日志(放进 <details> 内, 先合并同角色)
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
        // 更新 summary 显示合并后的步数（两种模式都更新）
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
      if (msg.search_count > 0) footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '已搜索：' + (msg.search_count || 0) }));
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
    var contentForRender = msg.content || '';
    var bubble = el('div', { class: 'ai-msg-bubble' });
    if (!contentForRender || !String(contentForRender).trim()) {
      var hasReasoning = !!(msg.reasoning && String(msg.reasoning).trim());
      contentForRender = hasReasoning ? 'AI 只返回了思考过程，没有生成正文回复。' : 'AI 暂无回复。';
    }
    bubble.innerHTML = renderMarkdown(contentForRender);
    setupBubbleCopy(bubble, messagesEl);
    node.appendChild(bubble);
    // 底部信息栏：时间 · 思考程度 · 用量（仅 assistant 有思考标签和用量）
    var footer = el('div', { class: 'ai-msg-footer' });
    if (msg.created_at) {
      footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(msg.created_at) }));
    }
    if (role === 'assistant') {
      // ★ P1 关键修：搜索端
      //   - 1 天内（search_expires_at > now）：完整显示"已联网搜索 · N 条结果 + 可展开结果列表"
      //   - 1 天后：端保持显示，但标记结果已过期
      //   - 永远显示端（用户原话：重新进对话才显示已联网搜索搜到多少条信息）
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
            var safeSrUrl = safeSearchUrl(sr.url);
            var item = el('a', {
              class: 'ai-search-detail-item',
              href: safeSrUrl || '#',
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
      // 搜索到此结束
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

  function buildEmptyState(tipText) {
    var cfg = S.config || {};
    var empty = el('div', { class: 'ai-chat-empty' });
    var visual = el('div', { class: 'ai-chat-empty-visual' });
    var emojiSlot = el('div', { class: 'ai-chat-empty-emoji' });
    renderCatAvatarNode(emojiSlot, 'ai-chat-empty-avatar', S.config && S.config.avatar_url, S.config && S.config.avatar_version);
    visual.appendChild(emojiSlot);
    empty.appendChild(visual);
    empty.appendChild(el('div', { class: 'ai-chat-empty-title', text: '和 ' + AI_DISPLAY_NAME + ' 聊聊天' }));
    empty.appendChild(el('div', { class: 'ai-chat-empty-tip', text: tipText || (cfg.welcome_message || '嗨，来聊天吧。') }));
    return empty;
  }

  function removeHistoryUnavailableBanner(messagesEl) {
    if (!messagesEl) return;
    var banner = messagesEl.querySelector('.ai-history-cache-banner');
    if (banner) {
      try { banner.remove(); } catch (e) {}
    }
  }

  function renderHistoryUnavailable(messagesEl, r, options) {
    if (!messagesEl) return;
    var opts = options || {};
    if (r && r.error_code === 'aborted') {
      removeHistoryUnavailableBanner(messagesEl);
      return;
    }
    
    if (opts.preserveExistingMessages) {
      var existingBanner = messagesEl.querySelector('.ai-history-cache-banner');
      if (!existingBanner) {
        existingBanner = el('div', { class: 'ai-history-cache-banner' });
        var textSpan = el('span', { class: 'ai-history-cache-banner-text', text: '当前显示缓存记录，刷新失败' });
        var retryBtn = el('button', {
          type: 'button',
          class: 'ai-history-cache-retry',
          text: '重试',
          'aria-label': '重试刷新聊天记录'
        });
        retryBtn.addEventListener('click', function(ev) {
          ev.preventDefault();
          loadHistory(messagesEl, null);
        });
        existingBanner.appendChild(textSpan);
        existingBanner.appendChild(retryBtn);
        if (messagesEl.firstChild) {
          messagesEl.insertBefore(existingBanner, messagesEl.firstChild);
        } else {
          messagesEl.appendChild(existingBanner);
        }
      }
      return;
    }
    
    removeHistoryUnavailableBanner(messagesEl);
    messagesEl.innerHTML = '';
    var isTimeout = r && (r.status === 0 || r.error_code === 'timeout');
    var isNetwork = r && r.error_code === 'network_error';
    var tip = isTimeout
      ? '聊天记录加载超时，可继续发送消息或点击重试'
      : (isNetwork ? '网络连接异常，聊天记录更新失败' : '聊天记录暂时无法加载，你仍可发送新消息');
    var state = buildEmptyState(tip);
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
    // V6: 流水跟包默认更大块，减少「一顿一顿」
    var minChunk = Math.max(1, options && options.minChunk || 6);
    var maxChunk = Math.max(minChunk, options && options.maxChunk || 48);
    if (pending.length <= maxChunk) return pending;

    var punctuation = /[，。！？；：?!.?:;\n]/;
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
    // A renderer can be created after the global pause button was pressed.
    // Inherit that state so the next streamed chunk cannot restart animation
    // until the user explicitly resumes.
    var paused = !!S.paused;
    var streamClass = options.streamClass || 'ai-streaming-soft';
    var requestFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(cb) { return setTimeout(cb, 16); };
    var cancelFrame = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;

    // P1-4: 检测用户选区是否落在目标元素内，若是则跳过 innerHTML 替换
    function isSelectionInTarget(el) {
      try {
        var sel = window.getSelection && window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
        var range = sel.getRangeAt(0);
        if (!range) return false;
        return el && el.contains(range.commonAncestorContainer);
      } catch (e) { return false; }
    }
    // V6: 流水跟包 — 高吞吐 + 积压追赶，避免打字机一顿一顿
    var lastFrameTime = 0;
    // ~180–240 字/秒量级；plain 思考略慢仍远高于旧 0.55
    var charsPerMs = options.charsPerMs != null
      ? options.charsPerMs
      : (options.plainStream ? 2.2 : 3.2);
    // plainStream 模式：单文本节点复用，避免每帧 createTextNode 触发 reflow
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
        // V6: 流水跟包 — 积压时加速追赶，接近实时；仍按自然断点切块避免生硬
        var baseBudget = Math.max(8, Math.floor(budget || 24));
        // 队列积压：尽快追上网络到达速度，避免「一个字一个字」
        if (pending.length > 120) baseBudget = Math.max(baseBudget, Math.floor(pending.length * 0.45));
        else if (pending.length > 48) baseBudget = Math.max(baseBudget, Math.floor(pending.length * 0.28));
        else if (pending.length > 16) baseBudget = Math.max(baseBudget, 20);
        var frameBudget = baseBudget;
        var maxChunkOpt = options.maxChunk || 48;
        while (pending && next.length < frameBudget) {
          var chunk = takeSmoothTextChunk(pending, Object.assign({}, options, { maxChunk: Math.min(maxChunkOpt, frameBudget - next.length) }));
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
        // 用 data 设置文本，高效
        try { node.data = plainTextBuffer; } catch (e) { node.textContent = plainTextBuffer; }
      } else {
        // P1-4 优化: Markdown 重新渲染节流从 50ms 提升到 200ms，避免长文本越来越卡
        //   且用户正在选中文本时跳过 innerHTML 替换，防止选区被破坏
        var now = Date.now();
        var shouldRender = (!targetEl._lastRender || now - targetEl._lastRender > 200 || !pending);
        if (shouldRender && !isSelectionInTarget(targetEl)) {
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
      // 下限提高：慢帧也至少吐一批，保证「流水」感
      var budget = Math.max(12, Math.floor(elapsed * charsPerMs));
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
        // 兜底: 如果渲染完还是空的, 显示提示
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
        // 如果已经 finish（正常完成），不要清空目标元素，避免把最终内容抹掉
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
      // ★ U3: clamp keyboardHeight 防某些浏览器算出异常值
      var maxKb = Math.round(window.innerHeight * 0.6);
      if (keyboardHeight > maxKb) keyboardHeight = maxKb;
      root.classList.toggle('ai-keyboard-open', keyboardHeight > 0);

      if (_isTouchMobile) {
        // 移动端：输入框 position:fixed 浮在键盘上方，容器不缩放
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

    var disposed = false;
    var onViewportChange = function() { if (!disposed) applyViewport(); };
    var viewportHandler = window.throttleRAF(onViewportChange);
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
      vv.addEventListener('resize', viewportHandler);
      vv.addEventListener('scroll', viewportHandler);
    }
    window.addEventListener('resize', viewportHandler);
    input.addEventListener('blur', onBlur);
    input.addEventListener('focus', onFocus);
    applyViewport();

    return function() {
      disposed = true;
      if (S.keyboardResetTimer) {
        try { clearTimeout(S.keyboardResetTimer); } catch (e2) {}
        S.keyboardResetTimer = null;
      }
      if (vv) {
        vv.removeEventListener('resize', viewportHandler);
        vv.removeEventListener('scroll', viewportHandler);
      }
      window.removeEventListener('resize', viewportHandler);
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

  // ===================== M: 深度思考模式 · 进度条 / toggle / cancel =====================
  // 切换深度思考模式：改为打开独立二级页面，不再切换普通聊天的 S.deepThink
  function toggleDeepThink() {
    if (!S.deepThinkEnabled) {
      notify('深度思考模式已被管理员关闭');
      return;
    }
    // 普通聊天中深度思考入口统一走二级页面，避免与普通聊天共用气泡面板
    openDeepThinkPage();
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

  // 深度思考已改为独立二级页面，普通聊天不再恢复 deepThink 状态
  function restoreDeepThinkState() {
    S.deepThink = false;
  }

  // 鏋勯€犳繁搴︽€濊€冭繘搴﹀崱鐗?(鏋佺畝椋庢牸)
  // ★ U2 重做: 4 角凸起 sparkle (ChatGPT/Claude 风格, 替代菱形)
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
    // P1-5: 降低渲染成本 — 节点数/FPS/DPR 全部降档
    if (profile === 'lite') return { mode: 'lite', canvas: false, minNodes: 0, maxNodes: 0, fps: 0, dpr: 1 };
    if (profile === 'balanced') return { mode: 'balanced', canvas: true, minNodes: 18, maxNodes: 24, fps: 24, dpr: 1 };
    return { mode: 'full', canvas: true, minNodes: 28, maxNodes: 32, fps: 30, dpr: 1.25 };
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
    var state = { running: true, paused: false, rafId: 0, nodes: [], width: 0, height: 0, dpr: 1, profile: profile, lastFrameTs: 0, isOffscreen: false, observer: null, resizeObserver: null, glowSprite: null };
    card.classList.toggle('ai-research-static', !profile.canvas);

    // P1-5: 预渲染发光粒子贴图，替代每帧每节点 shadowBlur（成本极高）
    //   离屏 canvas 绘制一次径向渐变圆点，draw 时只需 drawImage
    function buildGlowSprite() {
      try {
        var size = 24;
        var off = document.createElement('canvas');
        off.width = size; off.height = size;
        var octx = off.getContext('2d');
        if (!octx) return null;
        var cx = size / 2, cy = size / 2;
        var grad = octx.createRadialGradient(cx, cy, 0, cx, cy, cx);
        grad.addColorStop(0, 'rgba(150, 245, 232, 0.95)');
        grad.addColorStop(0.35, 'rgba(132, 234, 236, 0.55)');
        grad.addColorStop(1, 'rgba(132, 234, 236, 0)');
        octx.fillStyle = grad;
        octx.fillRect(0, 0, size, size);
        return off;
      } catch (e) { return null; }
    }
    state.glowSprite = buildGlowSprite();

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
      var targetCount = Math.max(state.profile.minNodes, Math.min(state.profile.maxNodes, state.profile.minNodes + Math.floor((state.width * state.height) / 24000)));
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

    // P1-5: 空间网格 — 每个节点只连接最近的 2-3 个邻居，替代 O(n²) 全两两连线
    function buildSpatialGrid() {
      var cellSize = Math.max(40, Math.min(state.width, state.height) / 4);
      var cols = Math.max(1, Math.ceil(state.width / cellSize));
      var rows = Math.max(1, Math.ceil(state.height / cellSize));
      var grid = [];
      for (var i = 0; i < cols * rows; i++) grid.push([]);
      for (var n = 0; n < state.nodes.length; n++) {
        var node = state.nodes[n];
        var cx = Math.max(0, Math.min(cols - 1, Math.floor(node.x / cellSize)));
        var cy = Math.max(0, Math.min(rows - 1, Math.floor(node.y / cellSize)));
        grid[cy * cols + cx].push(n);
      }
      return { grid: grid, cols: cols, rows: rows, cellSize: cellSize };
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
      // 更新节点位置
      for (var i = 0; i < state.nodes.length; i++) {
        var node = state.nodes[i];
        node.x += node.vx;
        node.y += node.vy;
        node.p += 0.018;
        if (node.x < 0 || node.x > state.width) node.vx *= -1;
        if (node.y < 0 || node.y > state.height) node.vy *= -1;
      }
      // P1-5: 空间网格邻居连线（每节点最多连 3 个最近邻居），替代 O(n²)
      var sp = buildSpatialGrid();
      var lineLimit = Math.min(122, Math.max(80, state.width * 0.2));
      var drawn = {}; // 去重 "a-b" 边
      ctx.lineWidth = 0.8;
      for (var a = 0; a < state.nodes.length; a++) {
        var n1 = state.nodes[a];
        var cx = Math.max(0, Math.min(sp.cols - 1, Math.floor(n1.x / sp.cellSize)));
        var cy = Math.max(0, Math.min(sp.rows - 1, Math.floor(n1.y / sp.cellSize)));
        // 检查 3x3 邻域单元格
        var neighbors = [];
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var ncx = cx + dx, ncy = cy + dy;
            if (ncx < 0 || ncx >= sp.cols || ncy < 0 || ncy >= sp.rows) continue;
            var cell = sp.grid[ncy * sp.cols + ncx];
            for (var ci = 0; ci < cell.length; ci++) {
              var b = cell[ci];
              if (b === a) continue;
              var n2 = state.nodes[b];
              var ddx = n1.x - n2.x, ddy = n1.y - n2.y;
              var dist = Math.sqrt(ddx * ddx + ddy * ddy);
              if (dist < lineLimit) neighbors.push({ idx: b, dist: dist });
            }
          }
        }
        // 按距离排序，只连最近 3 个
        neighbors.sort(function(p, q) { return p.dist - q.dist; });
        var maxConn = Math.min(3, neighbors.length);
        for (var k = 0; k < maxConn; k++) {
          var bIdx = neighbors[k].idx;
          var key = a < bIdx ? (a + '-' + bIdx) : (bIdx + '-' + a);
          if (drawn[key]) continue;
          drawn[key] = true;
          var n2b = state.nodes[bIdx];
          var alpha = (1 - neighbors[k].dist / lineLimit) * 0.24;
          ctx.strokeStyle = 'rgba(124, 255, 227, ' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2b.x, n2b.y);
          ctx.stroke();
        }
      }
      // P1-5: 用预渲染贴图 drawImage 绘制粒子，替代每节点 shadowBlur
      var sprite = state.glowSprite;
      for (var j = 0; j < state.nodes.length; j++) {
        var dot = state.nodes[j];
        var glowDx = dot.x - mx;
        var glowDy = dot.y - my;
        var glow = Math.max(0, 1 - Math.sqrt(glowDx * glowDx + glowDy * glowDy) / 210);
        var radius = 1.4 + Math.sin(dot.p) * 0.4 + glow;
        if (sprite) {
          // 贴图方式：根据 glow 调整尺寸和透明度
          var spriteSize = 6 + glow * 10;
          ctx.globalAlpha = 0.5 + glow * 0.5;
          ctx.drawImage(sprite, dot.x - spriteSize / 2, dot.y - spriteSize / 2, spriteSize, spriteSize);
          ctx.globalAlpha = 1;
        } else {
          // 降级：简单渐变圆点（无 shadowBlur）
          ctx.beginPath();
          ctx.fillStyle = 'rgba(' + Math.round(132 + glow * 26) + ', ' + Math.round(234 + glow * 18) + ', 236, ' + (0.4 + glow * 0.5).toFixed(3) + ')';
          ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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

    var disposed = false;
    var throttledResize = window.throttleRAF(function() {
      if (!disposed) resize();
    });

    function stop() {
      disposed = true;
      state.running = false;
      pause();
      try { window.removeEventListener('resize', throttledResize); } catch (e) {}
      try { document.removeEventListener('visibilitychange', handleVisibility); } catch (e2) {}
      try { if (state.observer) state.observer.disconnect(); } catch (e3) {}
      // P1-5: 清理 ResizeObserver
      try { if (state.resizeObserver) state.resizeObserver.disconnect(); } catch (e4) {}
      state.resizeObserver = null;
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
    window.addEventListener('resize', throttledResize);
    document.addEventListener('visibilitychange', handleVisibility);
    if (window.IntersectionObserver) {
      state.observer = new IntersectionObserver(handleIntersection, { threshold: 0.08 });
      state.observer.observe(card);
    }
    // P1-5: 用 ResizeObserver 监听卡片尺寸变化（替代仅 window resize）
    if (window.ResizeObserver) {
      try {
        state.resizeObserver = new ResizeObserver(throttledResize);
        state.resizeObserver.observe(card);
      } catch (e) {}
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
      '<button type="button" class="ai-progress-stop">\u505c\u6b62\u601d\u8003</button>';
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

  // 更新进度卡
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
    // ★ U3: 缓存 querySelector 结果, 避免每个事件都做 DOM 查询
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
        // ★ U3: 同角色累积到最后一条条目(缓存 lastEntry 加速)
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

  // 取消深度思考（convId 可选，二级页面使用 S.dtConversationId）
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
    // ★ 修复：cancelDeepThink 只清深页独立 controller，不影响普通聊天
    S._dtAbortController = null;
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
      // 其他认证失败原因也给出明确提示
      if (reason === 'expired') {
        notify('登录已失效，请重新登录');
        return false;
      }
      if (reason === 'auth_pending') {
        notify('正在验证身份，请稍后再试');
        return false;
      }
      notify('认证服务暂时不可用，请稍后重试');
      return false;
    } catch (e) {
      try { console.warn('[AI-AUTH] ensureRealUserAuth error:', e && e.message); } catch(ee) {}
    }
    try { if (typeof window.handleProtectedAuthFailure === 'function') window.handleProtectedAuthFailure(); } catch (e2) {}
    notify('认证失败，请重新登录');
    return false;
  }

  // ===================== Tavily Deep Research =====================
  // 前端集成: POST /api/agent/research/stream (SSE) → 研究报告 + 来源列表
  //   事件: research_step / research_stage / research_content(流式) / research_sources / research_done / error / heartbeat
  //   45s 无任何事件 → reject timeout; 支持取消 (promise.cancel / AbortController)

  // Tavily 来源列表: 渲染为引用链接列表 (escapeHtml 转义 + safeSearchUrl 白名单)
  function buildTavilySourcesBox(sources) {
    var list = Array.isArray(sources) ? sources : [];
    if (!list.length) return null;
    var box = document.createElement('div');
    box.className = 'ai-search-supplement ai-tavily-sources';
    var html = '📚 研究来源 (' + list.length + ' 条)<br>';
    var shown = list.slice(0, 10);
    for (var si = 0; si < shown.length; si++) {
      var item = shown[si];
      var url = '';
      var title = '';
      if (item && typeof item === 'object') {
        url = String(item.url || item.link || '');
        title = String(item.title || item.name || url);
      } else {
        url = String(item || '');
        title = url;
      }
      var safeUrl = safeSearchUrl(url);
      if (safeUrl) {
        html += '<a class="ai-search-detail-title" href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(title) + '</a><br>';
      } else {
        html += '<span class="ai-search-detail-title">[' + (si + 1) + '] ' + escapeHtml(title) + '</span><br>';
      }
    }
    if (list.length > 10) {
      html += '<span style="font-size:10px;color:#999">... 还有 ' + (list.length - 10) + ' 条来源</span>';
    }
    box.innerHTML = html;
    return box;
  }

  // ===== 深度研究二级页增强: 研究强度选择器 + 三阶段状态 + 流式渲染 + 历史回看 =====

  // 将研究结果渲染进研究卡 (Tavily 流程与历史回看共用)
  function renderTavilyResearchReport(card, answerText, sourcesList, startedAtMs, labelText, researchMode) {
    if (!isResearchCard(card)) return;
    var srcs = Array.isArray(sourcesList) ? sourcesList : [];
    var modeVal = researchMode || S.dtResearchMode || 'pro';
    var modeLabelMap = { mini: '快速模式', pro: '深度模式', auto: '自动模式' };
    var modeLabel = modeLabelMap[modeVal] || '深度模式';
    // 研究总时长：实时研究用 startedAt 计算；历史回显无 startedAt 时回退到卡片已存时长
    var durationMs = startedAtMs
      ? (Date.now() - startedAtMs)
      : ((card._researchState && card._researchState.durationMs) || 0);
    if (durationMs < 0) durationMs = 0;
    card._researchState.durationMs = durationMs;
    card._researchState.searchCount = srcs.length;

    var answerEl = card.querySelector('.ai-think-answer');
    if (answerEl && answerText) {
      try { answerEl.innerHTML = renderMarkdown(String(answerText)); } catch (e) {}
      if (!answerEl.querySelector('.ai-tavily-note')) {
        var noteEl = document.createElement('div');
        noteEl.className = 'ai-tavily-note';
        noteEl.style.cssText = 'font-size:11px;color:#999;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(127,127,127,.25);';
        // 脚注带强度档位 + 研究总时长（如 15min）
        var footnote = (labelText || '由 XTJ 多智能体深入研究生成') + ' · ' + modeLabel;
        if (durationMs > 0) footnote += ' · 用时 ' + formatThinkingElapsed(durationMs);
        noteEl.textContent = footnote;
        answerEl.appendChild(noteEl);
      }
    }

    var sourcesBox = buildTavilySourcesBox(srcs);
    if (sourcesBox) {
      var thinkBody = card.querySelector('.ai-think-body');
      var answerEl2 = card.querySelector('.ai-think-answer');
      if (thinkBody) {
        if (answerEl2) thinkBody.insertBefore(sourcesBox, answerEl2);
        else thinkBody.appendChild(sourcesBox);
      }
    }

    var footer = card.querySelector('.ai-msg-footer');
    if (footer) {
      footer.innerHTML = '';
      footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(new Date().toISOString()) }));
      footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: '深入研究' }));
      // 搜索数量：网页搜索 N（如 网页搜索 100）
      footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '网页搜索 ' + srcs.length }));
      // ★ 优化：结果不满意时可"重新研究"（后端 refresh=true 跳过 24h 缓存重新跑）
      if (card._researchRefreshFn) {
        var refreshBtn = el('button', {
          type: 'button',
          class: 'ai-msg-refresh-research',
          text: '↻ 重新研究',
          style: 'margin-left:8px;padding:2px 10px;border-radius:999px;border:1px solid rgba(140,196,158,.35);background:rgba(255,255,255,.06);color:var(--ai-text,#35544b);font-size:11px;cursor:pointer;'
        });
        refreshBtn.addEventListener('click', function() {
          if (refreshBtn.disabled) return;
          refreshBtn.disabled = true;
          refreshBtn.textContent = '研究中…';
          try { if (card._researchRefreshFn) card._researchRefreshFn(); } catch (e) {}
        });
        footer.appendChild(refreshBtn);
      }
      // 导出：复制研究报告全文
      var exportBtn = el('button', {
        type: 'button',
        class: 'ai-msg-export-research',
        text: '复制全文',
        style: 'margin-left:8px;padding:2px 10px;border-radius:999px;border:1px solid rgba(140,196,158,.35);background:rgba(255,255,255,.06);color:var(--ai-text,#35544b);font-size:11px;cursor:pointer;'
      });
      exportBtn.addEventListener('click', function() {
        var text = '';
        try {
          var ans = card.querySelector('.ai-think-answer');
          text = (ans && (ans.innerText || ans.textContent)) || String(answerText || '');
        } catch (e) {
          text = String(answerText || '');
        }
        text = String(text || '').trim();
        if (!text) {
          notify('暂无可复制内容');
          return;
        }
        function ok() {
          exportBtn.textContent = '已复制';
          setTimeout(function() { exportBtn.textContent = '复制全文'; }, 1400);
          notify('研究报告已复制');
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(ok).catch(function() {
              var ta = document.createElement('textarea');
              ta.value = text;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
              ok();
            });
          } else {
            var ta2 = document.createElement('textarea');
            ta2.value = text;
            document.body.appendChild(ta2);
            ta2.select();
            document.execCommand('copy');
            ta2.remove();
            ok();
          }
        } catch (e2) {
          notify('复制失败');
        }
      });
      footer.appendChild(exportBtn);
    }

    setResearchCardState(card, 'done', { durationMs: durationMs, searchCount: srcs.length, expanded: false, progress: 1 });
    setResearchSteps(card, -1, 4);
  }

  // 二级页研究强度选择器 (快速 mini / 深度 pro / 自动 auto), 选中值存 S.dtResearchMode
  function initDeepThinkResearchUi() {
    var panel = document.getElementById('panelDeepThink');
    if (!panel || panel._dtResearchUiReady) return;
    panel._dtResearchUiReady = true;
    if (!S.dtResearchMode) S.dtResearchMode = 'pro';

    // 历史入口按钮 (dt-title 旁 → dt-actions 首位)
    var actions = panel.querySelector('.dt-actions');
    if (actions && !panel.querySelector('.dt-research-history-btn')) {
      var histBtn = el('button', { type: 'button', class: 'dt-action-btn dt-research-history-btn', text: '历史' });
      histBtn.addEventListener('click', function() { toggleResearchHistoryPanel(); });
      actions.insertBefore(histBtn, actions.firstChild);
    }

    // 研究强度选择器 (输入框上方, 动态插入 dt-input-bar 之前)
    var inputBar = panel.querySelector('.dt-input-bar');
    if (inputBar && !panel.querySelector('.dt-research-mode-bar')) {
      var modeBar = el('div', { class: 'dt-research-mode-bar', style: 'display:flex;align-items:center;gap:8px;padding:8px 16px 0;flex:0 0 auto;' });
      modeBar.appendChild(el('span', { text: '研究强度', style: 'font-size:11px;color:rgba(100,130,120,.9);flex:0 0 auto;' }));
      var seg = el('div', { style: 'display:inline-flex;gap:2px;padding:2px;border:1px solid rgba(140,196,158,.3);border-radius:12px;background:rgba(140,196,158,.14);' });
      var modes = [
        ['mini', '快速', '约 1 分钟 · 简要结论'],
        ['pro', '深度', '约 2–3 分钟 · 多角度分析'],
        ['auto', '自动', '约 1–5 分钟 · 按问题自动调档']
      ];
      for (var mi = 0; mi < modes.length; mi++) {
        (function(modeVal, modeText, modeHint) {
          var opt = el('button', { type: 'button', class: 'dt-research-mode-opt', text: modeText, title: modeHint });
          opt._mode = modeVal;
          opt._hint = modeHint;
          opt.addEventListener('click', function() {
            S.dtResearchMode = modeVal;
            syncResearchModeUi(panel);
          });
          seg.appendChild(opt);
        })(modes[mi][0], modes[mi][1], modes[mi][2]);
      }
      modeBar.appendChild(seg);
      var hint = el('div', {
        class: 'dt-research-mode-hint',
        text: '深度：约 2–3 分钟 · 多角度分析',
        style: 'font-size:11px;color:rgba(100,130,120,.85);margin-left:4px;flex:1 1 auto;'
      });
      modeBar.appendChild(hint);
      inputBar.parentNode.insertBefore(modeBar, inputBar);
    }
    syncResearchModeUi(panel);
  }

  function syncResearchModeUi(panel) {
    if (!panel) return;
    var isDark = isDeepThinkDarkTheme();
    var opts = panel.querySelectorAll('.dt-research-mode-opt');
    var activeHint = '';
    for (var i = 0; i < opts.length; i++) {
      var active = opts[i]._mode === S.dtResearchMode;
      if (active) activeHint = opts[i]._hint || opts[i].getAttribute('title') || '';
      opts[i].style.cssText = active
        ? 'border:0;padding:5px 13px;border-radius:9px;font-size:12px;cursor:pointer;background:linear-gradient(135deg,rgba(64,167,116,.95),rgba(82,182,160,.95));color:#fff;font-weight:600;'
        : 'border:0;padding:5px 13px;border-radius:9px;font-size:12px;cursor:pointer;background:transparent;color:' + (isDark ? 'rgba(214,236,229,.92)' : 'rgba(66,95,85,.95)') + ';';
    }
    var hintEl = panel.querySelector('.dt-research-mode-hint');
    if (hintEl && activeHint) hintEl.textContent = activeHint;
  }

  function isDeepThinkDarkTheme() {
    try {
      var dtAttr = document.documentElement.getAttribute('data-theme') || '';
      return dtAttr.indexOf('dark') !== -1 || document.documentElement.classList.contains('dark');
    } catch (e) { return false; }
  }

  // ===== 历史研究回看 =====
  function toggleResearchHistoryPanel() {
    var panel = document.getElementById('panelDeepThink');
    if (!panel) return;
    if (panel.querySelector('.dt-research-history-panel')) { closeResearchHistoryPanel(); return; }
    openResearchHistoryPanel();
  }

  function openResearchHistoryPanel() {
    var panel = document.getElementById('panelDeepThink');
    if (!panel || panel.querySelector('.dt-research-history-panel')) return;
    var isDark = isDeepThinkDarkTheme();
    var wrap = el('div', { class: 'dt-research-history-panel', style: 'position:absolute;top:64px;right:16px;z-index:1200;width:min(420px,92vw);max-height:min(60vh,480px);overflow:auto;border:1px solid rgba(140,196,158,.3);border-radius:16px;background:' + (isDark ? 'rgba(20,42,36,.98)' : 'rgba(255,255,255,.98)') + ';box-shadow:0 18px 40px rgba(61,113,99,.18);padding:10px;' });
    var head = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:4px 6px 8px;font-size:13px;font-weight:700;color:' + (isDark ? 'rgba(224,241,235,.95)' : '#35544b') + ';' });
    head.appendChild(el('span', { text: '历史研究' }));
    var closeBtn = el('button', { type: 'button', text: '关闭', style: 'border:1px solid rgba(140,196,158,.32);border-radius:10px;background:rgba(255,255,255,.7);color:#46715f;font-size:11px;padding:3px 10px;cursor:pointer;' });
    closeBtn.addEventListener('click', closeResearchHistoryPanel);
    head.appendChild(closeBtn);
    wrap.appendChild(head);
    var body = el('div', { class: 'dt-research-history-body', text: '加载中...', style: 'padding:12px 8px;font-size:12px;color:' + (isDark ? 'rgba(180,206,198,.85)' : '#7a8f89') + ';text-align:center;' });
    wrap.appendChild(body);
    panel.appendChild(wrap);
    loadResearchHistoryList(body);
  }

  function loadResearchHistoryList(bodyEl) {
    var items = [];
    // ★ 修复 S1：历史研究列表同样需要鉴权头，与 /research/stream 对齐
    getUserAuthPayload({ forceNoToken: false }).then(function(authPayload) {
      var authHeaders = (authPayload && authPayload.headers) || {};
      return fetch(API_BASE + '/research/history?limit=10', { method: 'GET', credentials: 'include', headers: authHeaders });
    }).then(function(resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function(data) {
        if (Array.isArray(data)) items = data;
        else if (data && Array.isArray(data.data)) items = data.data;
        renderResearchHistoryList(bodyEl, items);
      })
      .catch(function() {
        renderResearchHistoryList(bodyEl, items);
      });
  }

  function renderResearchHistoryList(bodyEl, items) {
    if (!bodyEl || !bodyEl.isConnected) return;
    bodyEl.innerHTML = '';
    if (!items.length) {
      bodyEl.textContent = '暂无历史研究';
      return;
    }
    var isDark = isDeepThinkDarkTheme();
    for (var hi = 0; hi < items.length; hi++) {
      (function(item) {
        var row = el('button', { type: 'button', style: 'display:block;width:100%;text-align:left;border:1px solid rgba(140,196,158,.2);border-radius:12px;background:' + (isDark ? 'rgba(28,60,52,.75)' : 'rgba(248,252,250,.85)') + ';padding:9px 11px;margin-bottom:8px;cursor:pointer;font:inherit;' });
        var qText = String(item.query || '未命名研究');
        var tText = item.created_at ? fmtTime(item.created_at) : '';
        var absText = String(item.answer || '').slice(0, 60);
        row.appendChild(el('div', { text: qText, style: 'font-size:13px;font-weight:600;color:' + (isDark ? 'rgba(226,243,237,.95)' : '#2f4d44') + ';line-height:1.4;' }));
        row.appendChild(el('div', { text: (tText ? tText + ' · ' : '') + '摘要: ' + absText, style: 'font-size:11px;color:' + (isDark ? 'rgba(185,211,203,.8)' : '#7a918a') + ';margin-top:4px;line-height:1.5;' }));
        row.addEventListener('click', function() { showResearchHistoryItem(item); });
        bodyEl.appendChild(row);
      })(items[hi]);
    }
  }

  function showResearchHistoryItem(item) {
    var dtMessagesEl = document.getElementById('dtMessages');
    if (!dtMessagesEl) return;
    closeResearchHistoryPanel();
    var empty = dtMessagesEl.querySelector('.dt-empty');
    if (empty) { try { empty.remove(); } catch (e) {} }
    var card = buildDeepThinkProgressCard({ variant: 'research' });
    card.classList.add('dt-animate-in');
    dtMessagesEl.appendChild(card);
    scrollToBottom(dtMessagesEl, true);
    var label = '历史研究记录' + (item.query ? '：' + String(item.query).slice(0, 48) : '');
    renderTavilyResearchReport(card, item.answer, item.sources, null, label, item.mode || S.dtResearchMode);
    try { card._done = true; } catch (e) {}
    scrollToBottom(dtMessagesEl, true);
  }

  function closeResearchHistoryPanel() {
    var panel = document.getElementById('panelDeepThink');
    if (!panel) return;
    var hp = panel.querySelector('.dt-research-history-panel');
    if (hp) { try { hp.remove(); } catch (e) {} }
  }

  // Tavily Deep Research SSE 调用
  //   resolve({ answer, sources, message_id }); reject(Error) — err.cancelled / err.tavilyTimeout / err.networkError / err.status
  function runTavilyResearch(query, onProgress, opts) {
    // ★ 2026-08-05: 支持外部传入 controller（flow 的 S.deepThinkJob），
    //   否则 cancelDeepThink 的 abort 无法中断内部 fetch（取消链断裂）
    var controller = (opts && opts.controller) || new AbortController();
    var MAX_EVENT_SIZE = 512 * 1024;
    var settled = false;
    var idleTimer = null;
    var timedOut = false;
    var content = '';
    var sources = [];

    var resolveDone, rejectDone;
    var done = new Promise(function(res, rej) { resolveDone = res; rejectDone = rej; });

    function fail(err) {
      if (settled) return;
      settled = true;
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {} idleTimer = null; }
      try { controller.abort(); } catch (e) {}
      rejectDone(err);
    }
    function succeed(result) {
      if (settled) return;
      settled = true;
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {} idleTimer = null; }
      resolveDone(result);
    }
    function resetIdle() {
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {} }
      idleTimer = setTimeout(function() {
        if (settled) return;
        timedOut = true;
        var te = new Error('研究超时（45 秒未收到数据）');
        te.tavilyTimeout = true;
        fail(te);
      }, 45000);
    }

    // 取消支持: promise.cancel() 或外部直接 abort controller (如 cancelDeepThink)
    done.cancel = function() {
      if (settled) return;
      try { controller.abort('cancel'); } catch (e) {}
      var ce = new Error('已取消');
      ce.cancelled = true;
      fail(ce);
    };
    controller.signal.addEventListener('abort', function() {
      if (settled) return;
      if (controller._abortReason === 'timeout') {
        timedOut = true;
        var te2 = new Error('研究超时（45 秒未收到数据）');
        te2.tavilyTimeout = true;
        fail(te2);
        return;
      }
      var ce2 = new Error('已取消');
      ce2.cancelled = true;
      fail(ce2);
    });

    function handleEvent(evt) {
      if (!evt || !evt.type) return;
      if (evt.type === 'research_step') {
        if (onProgress) { try { onProgress({ step: Math.max(0, Math.min(2, Number(evt.step) || 0)) }); } catch (e) {} }
      } else if (evt.type === 'research_content') {
        var chunk = evt.content != null ? String(evt.content) : (evt.text != null ? String(evt.text) : '');
        if (chunk) content += chunk;
        if (onProgress) { try { onProgress({ content: chunk }); } catch (e) {} }
      } else if (evt.type === 'research_sources') {
        var srcs = Array.isArray(evt.sources) ? evt.sources : (Array.isArray(evt.data) ? evt.data : []);
        if (srcs.length) sources = srcs;
        if (onProgress) { try { onProgress({ sources: sources }); } catch (e) {} }
      } else if (evt.type === 'research_stage') {
        if (onProgress) { try { onProgress({ stage: String(evt.stage || ''), message: evt.message != null ? String(evt.message) : '' }); } catch (e) {} }
      } else if (evt.type === 'research_done') {
        var finalAnswer = (content && String(content).trim()) ? content : (evt.answer || '');
        succeed({ answer: finalAnswer, sources: sources, message_id: evt.message_id != null ? evt.message_id : undefined });
      } else if (evt.type === 'error') {
        var ee = new Error(evt.error || '研究失败');
        ee.tavilyError = true;
        fail(ee);
      }
      // heartbeat / 其他事件: 忽略
    }

    (async function() {
      try {
        var resp;
        try {
          // ★ 修复 S1：研究接口此前不带 Authorization 头（与全站其他 AI 请求不一致），
          // 后端若按 token 鉴权将 401，或产生鉴权模型不一致。改用统一鉴权 payload。
          var authPayload = await getUserAuthPayload({ forceNoToken: false });
          var authHeaders = (authPayload && authPayload.headers) || {};
          resp = await fetch(API_BASE + '/research/stream', {
            method: 'POST',
            headers: authHeaders,
            credentials: 'include',
            body: JSON.stringify({
              query: String(query || ''),
              model: (opts && opts.model) || 'pro',
              mode: (opts && opts.mode) || 'hybrid',
              rewrite: (opts && typeof opts.rewrite === 'boolean') ? opts.rewrite : true,
              // ★ 优化：refresh=true 时后端跳过 24h 缓存重新研究（结果不满意重试）
              refresh: !!(opts && opts.refresh === true),
              // ★ 优化：研究通道沿用深页会话 ID，让多次研究归入同一会话、
              // 历史面板可按会话聚合（此前后端每次生成新 convId，上下文不延续）。
              conversation_id: S && S.dtConversationId ? S.dtConversationId : undefined
            }),
            signal: controller.signal
          });
        } catch (e) {
          if (settled) return;
          var ne = new Error('网络错误，无法连接研究服务');
          ne.networkError = true;
          fail(ne);
          return;
        }
        if (settled) return;
        if (!resp.ok) {
          var rawErr = '';
          try { rawErr = await resp.text(); } catch (e2) {}
          var detail = 'HTTP ' + resp.status;
          try {
            var ej = JSON.parse(rawErr);
            if (ej && (ej.error || ej.detail)) detail = String(ej.error || ej.detail);
          } catch (e3) {}
          var he = new Error(detail);
          he.status = resp.status;
          he.tavilyNotConfigured = /tavily[_-]?not[_-]?configured|not[_-]?configured/i.test(rawErr + ' ' + detail);
          fail(he);
          return;
        }
        if (!resp.body) {
          var be = new Error('AI 没有响应');
          be.networkError = true;
          fail(be);
          return;
        }

        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        resetIdle();
        try {
          while (true) {
            var readResult;
            try {
              readResult = await reader.read();
            } catch (e) {
              // abort: cancel / timeout 已由 fail() 处理, 这里兜底
              if (!settled) {
                if (timedOut) { var te3 = new Error('研究超时（45 秒未收到数据）'); te3.tavilyTimeout = true; fail(te3); }
                else { var ae = new Error('研究已中断'); ae.networkError = true; fail(ae); }
              }
              break;
            }
            if (readResult.done) {
              if (buffer) {
                buffer += decoder.decode();
                var eofLines = buffer.split('\n');
                for (var ei = 0; ei < eofLines.length; ei++) {
                  var eLine = eofLines[ei].replace(/\r$/, '');
                  if (!eLine || eLine.startsWith(':') || !eLine.startsWith('data: ')) continue;
                  var eEventStr = eLine.slice(6);
                  if (eEventStr.length > MAX_EVENT_SIZE) continue;
                  var eEvt;
                  try { eEvt = JSON.parse(eEventStr); } catch (ex) { continue; }
                  if (eEvt) handleEvent(eEvt);
                  if (settled) break;
                }
              }
              buffer = '';
              break;
            }
            resetIdle();
            buffer += decoder.decode(readResult.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (var li = 0; li < lines.length; li++) {
              var line = lines[li].replace(/\r$/, '');
              if (!line || line.startsWith(':')) continue;
              if (!line.startsWith('data: ')) continue;
              var eventStr = line.slice(6);
              if (eventStr.length > MAX_EVENT_SIZE) continue;
              var evt;
              try { evt = JSON.parse(eventStr); } catch (e) { continue; }
              if (!evt) continue;
              handleEvent(evt);
              if (settled) break;
            }
            if (settled) break;
          }
        } finally {
          if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {} idleTimer = null; }
        }
        if (!settled) {
          if (content && String(content).trim()) succeed({ answer: content, sources: sources });
          else { var fe = new Error('研究未完成：未收到完整结果'); fe.networkError = true; fail(fe); }
        }
      } catch (err) {
        if (!settled) {
          var ue = new Error((err && err.message) || '研究异常');
          ue.networkError = true;
          fail(ue);
        }
      }
    })();

    return done;
  }

  // Tavily 深度研究完整流程: 研究卡状态机 + 报告/来源展示
  //   返回 'done' = 流程已终结(成功/取消/超时); 'fallback' = 回退到原有深度思考流程
  async function runTavilyResearchFlow(opts) {
    var dtMessagesEl = opts.messagesEl;
    var text = opts.text;
    var originalUserText = opts.originalUserText;
    var fileData = opts.fileData;
    var reqId = opts.reqId;
    var progressCard = null;
    var controller = null;
    var startedAt = Date.now();
    var answer = '';
    var sources = [];
    var responding = false;
    var researchModel = opts.model || 'pro';

    function setStep(stepIdx) {
      if (!isResearchCard(progressCard)) return;
      if (stepIdx === 0) {
        setResearchCardState(progressCard, 'thinking', { statusText: AI_RESEARCH_THINKING_TEXTS[0], progress: 0.25 });
      } else if (stepIdx === 1) {
        setResearchCardState(progressCard, 'researching', { statusText: AI_RESEARCH_RESEARCH_TEXTS[0], progress: 0.5 });
      } else if (stepIdx === 2) {
        setResearchCardState(progressCard, 'researching', { statusText: AI_RESEARCH_RESEARCH_TEXTS[1], progress: 0.72 });
      }
      setResearchSteps(progressCard, stepIdx, stepIdx);
    }

    function renderResearchResult() {
      renderTavilyResearchReport(progressCard, answer, sources, startedAt, undefined, researchModel);
    }

    // 三阶段状态展示 (新协议 research_stage 事件; 未知 stage 忽略, 保持原行为)
    function handleResearchStage(stage, message) {
      if (!isResearchCard(progressCard)) return;
      if (stage === 'rewrite') {
        setResearchCardState(progressCard, 'thinking', { statusText: '正在优化研究问题…', progress: 0.25 });
        setResearchSteps(progressCard, 0, 0);
      } else if (stage === 'rewrite_done') {
        setResearchCardState(progressCard, 'thinking', { statusText: '问题已优化，开始多智能体研究…', progress: 0.32 });
        setResearchSteps(progressCard, 0, 0);
      } else if (stage === 'collect') {
        if (progressCard._researchState) progressCard._researchState.researchTick = 0;
        setResearchCardState(progressCard, 'researching', { statusText: '多智能体并行研究中…', progress: 0.5 });
        setResearchSteps(progressCard, 1, 1);
      } else if (stage === 'synthesize') {
        responding = true;
        setResearchCardState(progressCard, 'responding', { durationMs: Date.now() - startedAt, expanded: false, progress: 0.96 });
        var synthStatus = progressCard.querySelector('.ai-research-status');
        if (synthStatus) synthStatus.textContent = '正在综合生成中文报告…';
        setResearchSteps(progressCard, 3, 3);
      }
    }

    // 流式渲染: research_content 小块实时追加到报告区 (纯文本; done 后整体 markdown 替换)
    function appendStreamChunk(chunk) {
      if (!chunk || !isResearchCard(progressCard)) return;
      var answerEl = progressCard.querySelector('.ai-think-answer');
      if (!answerEl) return;
      answerEl.textContent = (answerEl.textContent || '') + String(chunk);
      scrollToBottom(dtMessagesEl, false);
    }

    function removeTavilyCard() {
      if (!progressCard) return;
      try { if (progressCard._cleanupTimer) progressCard._cleanupTimer(); } catch (e) {}
      try { progressCard._done = true; } catch (e) {}
      try { progressCard.remove(); } catch (e) {}
      if (S.deepThinkProgressCard === progressCard) S.deepThinkProgressCard = null;
      if (controller && S.deepThinkJob === controller) S.deepThinkJob = null;
      if (controller && S._dtAbortController === controller) S._dtAbortController = null;
    }

    try {
      progressCard = buildDeepThinkProgressCard({
        variant: 'research',
        cancelFn: function() { cancelDeepThink(S.dtConversationId); },
        retryFn: function() { handleDeepThinkPageSend(originalUserText, fileData); }
      });
      progressCard.classList.add('dt-animate-in');
      S.deepThinkProgressCard = progressCard;
      dtMessagesEl.appendChild(progressCard);
      scrollToBottom(dtMessagesEl, true);

      // ★ 优化：结果不满意时"重新研究"（refresh=true 跳过后端 24h 缓存）
      progressCard._researchRefreshFn = function() {
        if (!isResearchCard(progressCard) || (progressCard._researchState && progressCard._researchState.state === 'researching')) return;
        // 重置卡片为研究中状态，用同一 query 强制重新研究
        answer = '';
        sources = [];
        setResearchCardState(progressCard, 'researching', { statusText: '正在重新研究…', progress: 0.2, expanded: false });
        var answerEl = progressCard.querySelector('.ai-think-answer');
        if (answerEl) { try { answerEl.innerHTML = ''; } catch (e) {} }
        var oldSourcesBox = progressCard.querySelector('.ai-tavily-sources-box');
        if (oldSourcesBox) { try { oldSourcesBox.remove(); } catch (e) {} }
        runTavilyResearch(text, function(prog) {
          if (S._dtCurrentReqId !== reqId) {
            return;
          }
          if (!prog) return;
          if (prog.stage) handleResearchStage(prog.stage, prog.message);
          if (typeof prog.step === 'number') setStep(prog.step);
          if (prog.content) {
            answer += String(prog.content);
            appendStreamChunk(String(prog.content));
            if (!responding) {
              responding = true;
              if (isResearchCard(progressCard)) {
                setResearchCardState(progressCard, 'responding', { durationMs: Date.now() - startedAt, expanded: false });
                setResearchSteps(progressCard, 3, 3);
              }
            }
          }
          if (prog.sources) sources = prog.sources;
        }, { model: researchModel, mode: opts.mode || 'hybrid', rewrite: opts.rewrite !== false, controller: controller, refresh: true }).then(function(result) {
          answer = (result && result.answer) || '';
          sources = (result && Array.isArray(result.sources)) ? result.sources : sources;
          renderResearchResult();
        }).catch(function(err) {
          console.warn('[AI] Tavily re-research failed:', err && err.message);
          if (isResearchCard(progressCard)) {
            markResearchCardOutcome(progressCard, 'error', '重新研究失败：' + ((err && err.message) || '未知错误'));
          }
        });
      };

      controller = new AbortController();
      // ★ 修复：Tavily 深页流程也走深页独立通道
      S._dtAbortController = controller;
      S.deepThinkJob = controller;
      S.currentStreamAborted = false;

      var researchPromise = runTavilyResearch(text, function(prog) {
        if (S._dtCurrentReqId !== reqId) {
          try { if (researchPromise && researchPromise.cancel) researchPromise.cancel(); } catch (e) {}
          return;
        }
        if (!prog) return;
        if (prog.stage) handleResearchStage(prog.stage, prog.message);
        if (typeof prog.step === 'number') setStep(prog.step);
        if (prog.content) {
          answer += String(prog.content);
          appendStreamChunk(String(prog.content));
          if (!responding) {
            responding = true;
            if (isResearchCard(progressCard)) {
              setResearchCardState(progressCard, 'responding', { durationMs: Date.now() - startedAt, expanded: false });
              setResearchSteps(progressCard, 3, 3);
            }
          }
        }
        if (prog.sources) sources = prog.sources;
      }, { model: researchModel, mode: opts.mode || 'hybrid', rewrite: opts.rewrite !== false, controller: controller });
      var result = await researchPromise;
      answer = (result && result.answer) || '';
      sources = (result && Array.isArray(result.sources)) ? result.sources : sources;
      renderResearchResult();
      return 'done';
    } catch (err) {
      var errMsg = (err && err.message) || '研究失败';
      var cardState = (progressCard && progressCard._researchState) ? progressCard._researchState.state : null;
      if ((err && err.cancelled) || cardState === 'cancelled') {
        // 用户点击停止/取消: 卡片已由 cancelDeepThink 置为 cancelled
        console.warn('[AI] Tavily research cancelled:', errMsg);
        return 'done';
      }
      if (err && err.tavilyTimeout) {
        console.warn('[AI] Tavily research timeout:', errMsg);
        if (isResearchCard(progressCard) && cardState !== 'cancelled') {
          markResearchCardOutcome(progressCard, 'timeout', '超过 45 秒未收到新数据，本次研究已停止。');
        }
        try { notify('研究超时，请重试'); } catch (e) {}
        return 'done';
      }
      // tavily_not_configured / 网络错误 / SSE error → 回退到原有深度思考流程
      console.warn('[AI] Tavily research 失败，回退到深度思考流程:', errMsg, (err && err.status) ? ('HTTP ' + err.status) : '');
      removeTavilyCard();
      return 'fallback';
    }
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
          contentRendererRef.value = createSmoothTextRenderer(answerEl, { minChunk: 8, maxChunk: 64, charsPerMs: 3.4, onDone: function() { finalizeAnswer(); } });
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
          var safeSrUrl = safeSearchUrl(sr.url);
          if (safeSrUrl) searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(safeSrUrl) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.title || safeSrUrl) + '</a><br>';
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

    // SSE 事件处理函数
    function _handleSseEvent(evt) {
      if (S._dtCurrentReqId !== reqId) { if (abortedRef) abortedRef.value = true; return; }

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
            answerRendererRef.value = createSmoothTextRenderer(aEl, { minChunk: 8, maxChunk: 64, charsPerMs: 3.2, plainStream: true });
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
            // ★ 修复：已保留并渲染部分回答，标记 evtHandled 防止外层
            // `S._currentReqId !== reqId || ab.value` 分支把节点删除（回答闪现后消失）
            if (evtHandledRef) evtHandledRef.value = true;
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
          S.sending = false; S.paused = false; S.activeRenderers = []; S._dtAbortController = null; S.deepThinkJob = null; S.deepThinkProgressCard = null;
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
          if (typeof opts.onSuccess === 'function') { try { opts.onSuccess(evt); } catch (eSuccess) {} }
          if (doneReceivedRef) doneReceivedRef.value = true;
          if (evtHandledRef) evtHandledRef.value = true;
          try { clearInterval(_idleCheckTimer); } catch (e) {}
          return;
        }
    }

    while (true) {
      if (S._dtCurrentReqId !== reqId || controller.signal.aborted || (abortedRef && abortedRef.value)) {
        if (abortedRef) abortedRef.value = true;
        // 120s 绝对超时中止：标记 timedOut，让循环后的兜底逻辑统一收尾
        if (controller && controller.signal.aborted && controller._abortReason === 'timeout') {
          timedOut = true;
          if (isResearchCard(progressCard) && progressCard._researchState.state !== 'cancelled') {
            markResearchCardOutcome(progressCard, 'timeout', '思考超时，请重试');
          }
        }
        if (reader) try { reader.cancel(); } catch (e) {}
        break;
      }
      var readResult;
      try { readResult = await reader.read(); } catch (e) {
        // 120s 绝对超时中止（reader.read() 被 abort 拒绝）：标记 timedOut 并给研究卡打超时状态
        if (controller && controller.signal.aborted && controller._abortReason === 'timeout') {
          timedOut = true;
          if (isResearchCard(progressCard) && progressCard._researchState.state !== 'cancelled') {
            markResearchCardOutcome(progressCard, 'timeout', '思考超时，请重试');
          }
        } else if (!timedOut && isResearchCard(progressCard) && progressCard._researchState.state !== 'cancelled') {
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

      if (doneReceivedRef && doneReceivedRef.value) return;
      if (abortedRef && abortedRef.value) return;
    }
    // H-25: 45s 无数据超时 / 120s 绝对超时 — 清理卡片、复位状态并提示，避免永久"处理中"
    // research 卡片的超时由调用方（sseResult.timedOut）专门处理，这里跳过
    if (timedOut && !isResearchCard(progressCard)) {
      var timeoutMsg = (controller && controller._abortReason === 'timeout')
        ? '思考超时（120 秒未完成），请重试'
        : 'AI 响应超时（45 秒未收到数据），请重试';
      safeRemoveProgressCard();
      if (aiContentRef.value) {
        ensureThinkCardNode();
        if (aiNodeRef.value) {
          aiNodeRef.value.appendChild(el('div', { class: 'ai-error-note' }, timeoutMsg));
        }
        finishThinkCard(aiNodeRef.value, aiContentRef.value, null);
        // 已保留并渲染部分内容，标记 evtHandled 防止外层分支删除节点
        if (evtHandledRef) evtHandledRef.value = true;
      } else {
        if (aiNodeRef.value) { try { aiNodeRef.value.remove(); } catch (e) {} }
        aiNodeRef.value = null;
      }
      if (opts.onResetSending) { try { opts.onResetSending(); } catch (e) {} }
      notify(timeoutMsg);
      try { clearInterval(_idleCheckTimer); } catch (e) {}
      return;
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

    // ★ U3 P0-3 修复: 只有存在真实的旧请求时才 abort, 避免误杀自己
    if (S.abortController || S.deepThinkJob) {
      abortCurrentRequest();
      try { await new Promise(function(r) { setTimeout(r, 100); }); } catch (e) {}
    }

    S.clientRequestId++;
    var reqId = 'cr_' + S.clientRequestId + '_' + Date.now();
    S._currentReqId = reqId;
    function resetSendingIfCurrent() {
      if (S._currentReqId === reqId) {
        if (dtFetchTimeoutTimer) { clearTimeout(dtFetchTimeoutTimer); dtFetchTimeoutTimer = null; }
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

    // 2. 创建进度卡 (而不是 typing node)
    var progressCard = buildDeepThinkProgressCard();
    progressCard.classList.add('dt-animate-in');
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
    // ★ 修复：旧版深度思考发送也走独立通道，避免覆盖普通聊天状态（此函数为历史死代码，同步保留）
    S._dtAbortController = controller;
    S.deepThinkJob = controller;
    S.currentStreamAborted = false;
    // 深度思考 fetch 无独立超时：服务端持续发 heartbeat 时 45s idle watchdog 永不触发，
    // 请求可无限挂起。这里加 120s 绝对超时兜底（超时只 abort 本次，不清理全局状态）。
    var dtFetchTimeoutTimer = setTimeout(function() {
      if (S._dtCurrentReqId !== reqId) return;
      try { controller.abort('timeout'); } catch (e) {}
      controller._abortReason = 'timeout';
    }, 120000);
    if (dtFetchTimeoutTimer && dtFetchTimeoutTimer.unref) dtFetchTimeoutTimer.unref();

    var url = API_BASE + '/chat';
    var auth = await getUserAuthPayload({ forceNoToken: false });
    var headers = auth.headers || {};
    var fetchBody = JSON.stringify({
      message: text,
      conversation_id: S.conversationId,
      client_request_id: reqId,
      deep_think: true,
      chat_mode: 'normal',
      // ★ P 新增: 传思考程度给后端 runMultiAgentFlow (后端会用这个, 不用 config)
      thinking_mode: S.deepThinkEffort || 'max',
      web_search: S.webSearchEnabled,
      model: S.selectedModel
    });

    var aborted = false;
    var aiContent = '';
    var finalMeta = null;
    var finalModel = '';
    // ★ P 改: 用 S.deepThinkEffort (从后端 config 同步) 替代写死 high
    var finalThinkingMode = S.deepThinkEffort || 'max';
    var streamConvId = null;
    // P5: using assistantNode (single DOM node)
    // P5: using assistantBubble (single DOM node)
    var contentRenderer = null;
    var answerRenderer = null;  // V2: 流式答案渲染器 answer_chunk 用
    var answerStarted = false; // V2: 是否已进入回答阶段
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
      if (aiNodeRef.value) return aiNodeRef.value;
      if (isResearchCard(progressCard)) {
        aiNodeRef.value = progressCard;
        return aiNodeRef.value;
      }
      safeRemoveProgressCard();
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
      aiNodeRef.value = node;
      S.autoScrollPinned = true;
      scrollToBottom(messagesEl, true);
      return node;
    }

    // ★ O 修复 Bug 4: 构建 think-card (取代旧的 ai-msg 节点)
    //   折叠性: 头部显示 "● 已思考 38s · 5 个 agent" + 折叠按钮
    //   展开式: 顶部思考过程日志 + 底部最终答案(markdown)
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
        // ★ P 改: 用 finalThinkingMode (后端动态) 替代写死 max
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
        var contentForRender = content || '';
        var answerEl = node.querySelector('.ai-think-answer');
        function finalizeAnswer() {
          setupBubbleCopy(answerEl, messagesEl);
          var titleEl = node.querySelector('.ai-think-title');
          if (titleEl) titleEl.textContent = '已思考';
        }
        if (answerEl) {
          if (answerRenderer) {
            // V2: 流式渲染已在 answer_chunk 进行，done 时只 finish 成 markdown
            answerRenderer.finish(contentForRender);
            answerRenderer = null;
            finalizeAnswer();
          } else {
            if (contentRenderer) { try { contentRenderer.stop && contentRenderer.stop(); } catch (e) {} }
            answerEl.innerHTML = '';
            contentRenderer = createSmoothTextRenderer(answerEl, {
              minChunk: 8, maxChunk: 64, charsPerMs: 3.4,
              onDone: function() { finalizeAnswer(); }
            });
            contentRenderer.append(contentForRender);
            contentRenderer.finish(contentForRender);
            contentRenderer = null;
          }
        }

        // 渲染思考过程日志(放进 <details> 内, 先合并同角色连续条目)
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
          // 没有思考过程, 隐藏 details
          var detailsEl = node.querySelector('.ai-think-thinking');
          if (detailsEl) detailsEl.style.display = 'none';
        }

        var footer = node.querySelector('.ai-msg-footer');
        if (footer) {
          footer.innerHTML = '';
          if (aiMsg.created_at) footer.appendChild(el('span', { class: 'ai-msg-time', text: fmtTime(aiMsg.created_at) }));
          // V2: 简洁模式标签，去掉重复 sparkle
          footer.appendChild(el('span', { class: 'ai-msg-thinking-badge', text: (finalThinkingMode || 'max') + ' 思考' }));
          if (agentCount > 0) footer.appendChild(el('span', { class: 'ai-msg-agent-badge', text: agentCount + ' agent' }));
          if (searchCount > 0) footer.appendChild(el('span', { class: 'ai-msg-search-badge', text: '已研究 ' + searchCount + ' 个来源' }));
          if (usage || finalModel) {
            var usageLine = buildUsageLine(aiMsg.usage);
            if (usageLine) footer.appendChild(el('span', { class: 'ai-msg-usage', text: usageLine }));
          }
        }

        // 标签 + 时间 (放 header)
        // Show search sources in think-card
        if (searchResults && searchResults.length > 0 && searchQuery) {
          var searchBox = document.createElement('div');
          searchBox.className = 'ai-search-supplement';
          var searchHtml = '🔍 搜索来源: <strong>' + escapeHtml(searchQuery) + '</strong> (' + searchResults.length + ' 条结果)<br>';
          var shownResults = searchResults.slice(0, 5);
          for (var si = 0; si < shownResults.length; si++) {
            var sr = shownResults[si];
            var safeSrUrl = safeSearchUrl(sr.url);
            if (safeSrUrl && sr.title) {
              searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(safeSrUrl) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.title) + '</a><br>';
            } else if (safeSrUrl) {
              searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(safeSrUrl) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(safeSrUrl) + '</a><br>';
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
        try {
          var rawErrText = await resp.text().catch(function(){ return ''; });
          var ej = null;
          if (rawErrText) {
            try { ej = JSON.parse(rawErrText); } catch (parseErr) {
              console.warn('[AI] Non-JSON error response', { status: resp.status, contentType: resp.headers.get('content-type'), bodyPreview: rawErrText.slice(0, 200) });
            }
          }
          if (S._currentReqId !== reqId) return;
          safeRemoveProgressCard();
          notify(String((ej&&ej.error)||('AI 失败 ('+resp.status+')')));
        } catch(e){}
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
      if ((S._currentReqId !== reqId || ab.value) && !eh.value) {
        // ★ 修复：error 事件已渲染部分回答（evtHandledRef=true）时不得删除节点，
        // 否则已完成的思考卡片会闪现后消失（服务端也未保存）。
        if (controller && controller._abortReason === 'timeout' && !isResearchCard(progressCard)) {
          notify('思考超时，请重试');
        }
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
      var dtTimeoutAbort = !!(controller && controller._abortReason === 'timeout');
      if (fetchErr && fetchErr.name !== 'AbortError') {
        if (c && c.value) { if (!r.value) ensureThinkCardNode(); r.value.appendChild(el('div',{class:'ai-error-note'},'连接中断')); finishThinkCard(r.value, c.value, fm.value); }
        else { S.messages.pop(); removeLastUserMessage(messagesEl); restoreInputText(); notify('网络异常'); }
      } else {
        // 120s 绝对超时（fetch 阶段被 abort）：给用户可见提示并正确收尾
        if (dtTimeoutAbort) notify('思考超时，请重试');
        if (c && c.value) { if (!r.value) ensureThinkCardNode(); finishThinkCard(r.value, c.value, fm.value); }
        else {
          S.messages.pop(); removeLastUserMessage(messagesEl);
          if (dtTimeoutAbort) restoreInputText();
        }
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
    var panel = document.getElementById('panelDeepThink');
    if (!panel) return;

    var msgs = document.getElementById('dtMessages');
    if (!msgs) return;

    // A reopened panel belongs to a new lifecycle.  This prevents a late
    // history/SSE callback from writing into the next session's DOM.
    panel._dtClosed = false;
    S.lifecycleId++;
    var pageLifecycle = S.lifecycleId;

    // Enter the research surface immediately; auth and history can complete in the background.
    panel.classList.remove('hidden');
    panel.classList.add('active');
    updateSecondaryPageState(true);
    initDeepThinkResearchUi();

    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) return;
    if (S.lifecycleId !== pageLifecycle || panel._dtClosed) return;

    // 先从 localStorage 恢复会话 ID（刷新页面后也能恢复）
    if (!S.dtConversationId) {
      try { var saved = localStorage.getItem(DT_CONV_KEY); if (saved) S.dtConversationId = saved; } catch (e) {}
    }

    // 已有会话 → 如果消息区不为空且不是页面刷新，直接显示缓存内容
    if (S.dtConversationId && msgs.children.length > 0 && !msgs.querySelector('.dt-empty, .dt-loading')) {
      // 已有缓存的 DOM 内容，直接显示
    } else if (S.dtConversationId) {
      msgs.innerHTML = '';
      var loadHint = el('div', { class: 'dt-loading', style: 'padding:20px;text-align:center;color:#999;font-size:13px;', text: '加载中...' });
      msgs.appendChild(loadHint);
      try {
        var hist = await apiRequest('GET', '/chat/history?conversation_id=' + encodeURIComponent(S.dtConversationId) + '&limit=30&mode=deep_think', null, { timeoutMs: 8000 });
        if (S.lifecycleId !== pageLifecycle || panel._dtClosed) return;
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
        if (S.lifecycleId !== pageLifecycle || panel._dtClosed) return;
        if (r && r.ok && r.data && r.data.conversation_id) {
          S.dtConversationId = r.data.conversation_id;
          saveDtConvId();
        }
      } catch (e) {}
    }

    // 等待两帧 + 一个小延时，确保所有子元素布局完成（markdown 渲染、图片等）
    // 然后用 scrollIntoView 定位到最后一条消息，scrollIntoView 兼容性比 scrollTop=scrollHeight 更好
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
      // Invalidate every callback first, then abort the actual network
      // controllers.  Hiding the panel alone leaves a DeepSeek stream alive.
      S.lifecycleId++;
      S.clientRequestId++;
      // ★ 修复：只清深页独立请求通道，不动普通聊天的 _currentReqId，
      // 避免关闭深页时误杀正在进行的普通聊天流。
      S._dtCurrentReqId = null;
      // ★ 修复：只 abort 深页自己的 controller（_dtAbortController / deepThinkJob），
      // 不再触碰普通聊天共享的 S.abortController。
      var dtControllers = [S._dtAbortController, S.deepThinkJob];
      dtControllers.forEach(function(c) {
        if (!c) return;
        try {
          c._abortReason = 'aborted';
          try { c.abort('aborted'); } catch (eAbortReason) { c.abort(); }
        } catch (eAbort) {}
      });
      S._dtAbortController = null;
      S.deepThinkJob = null;
      S.sending = false;
      // A file selected in the research composer is session-scoped.  Never
      // carry it into a later conversation after the page is closed.
      _dtFileData = null;
      var closedFileInput = document.getElementById('dtFileInp');
      if (closedFileInput) closedFileInput.value = '';
      var closedFilePreview = document.getElementById('dtFilePreview');
      if (closedFilePreview) { closedFilePreview.style.display = 'none'; closedFilePreview.innerHTML = ''; }
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

  // 文件上传状态 (dt 页面)
  var _dtFileData = null;

  function consumeAiAttachment(fileData) {
    if (!fileData || typeof fileData.onSuccess !== 'function') return;
    try { fileData.onSuccess(); } catch (e) {}
  }

  async function handleDeepThinkPageSend(text, fileData) {
    var dtMessagesEl = document.getElementById('dtMessages');
    var input = document.getElementById('dtInput');
    if (!dtMessagesEl || !input) { S.sending = false; return; }

    var originalUserText = text || '';
    var displayText = text;
    var attachmentPayload = null;

    // 如果有文件: 区分: UI 显示用完整 data URL 或文件占位，发送给服务器用简短标记
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
      // 发送给服务器: 简短标记
      var serverTag2 = isImage2
        ? '[图片: ' + safeName + ' · ' + sizeKB2 + 'KB]'
        : '[文件: ' + safeName + ' · ' + sizeKB2 + 'KB]';
      text = text ? text + '\n' + serverTag2 : serverTag2;
      attachmentPayload = [{ name: safeName, type: fileData.type || 'application/octet-stream', data_url: fileData.dataUrl }];
    }
    if (text.length > 50000) { notify('消息过长，最多 50000 字符，请精简后重试'); S.sending = false; return; }

    var originalText = text;
    function restoreInputText() {
      input.value = originalUserText;
      input.style.height = 'auto';
      try { input.style.height = Math.min(input.scrollHeight, 140) + 'px'; if (!_isTouchMobile) input.focus(); } catch (e) {}
    }

    // ★ 快速防抖去重：同一秒内相同文本的请求忽略
    // H-28: 双发送守卫 — 上一请求仍在进行时拒绝新发送，避免双 Enter
    // 追加第二条用户消息并中止第一个请求。锁在首个 await 之前同步设置。
    if (S.sending) {
      try { notify('AI 正在生成回复，请稍候'); } catch (e) {}
      return;
    }
    S.sending = true;

    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) { S.sending = false; return; }

    S.clientRequestId++;
    var reqId = 'cr_' + S.clientRequestId + '_' + Date.now();
    // ★ 修复：深页请求 ID 写入独立通道，不覆盖普通聊天的 _currentReqId
    S._dtCurrentReqId = reqId;
    function resetSendingIfCurrent() {
      if (S._dtCurrentReqId === reqId) {
        if (dtFetchTimeoutTimer) { clearTimeout(dtFetchTimeoutTimer); dtFetchTimeoutTimer = null; }
        S.sending = false;
        S.deepThinkJob = null;
        S.deepThinkProgressCard = null;
        S._dtAbortController = null;
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

    // 1. 追加 user 消息（手动创建 .dt-msg.user，不使用气泡）
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

    // 2. 创建进度卡

    // ===== Tavily Deep Research: 研究型问题优先走 Tavily 多 agent 深度研究 =====
    // 后端已启用 Tavily (config.tavily_research.enabled) 且消息长度 >= 6 时,
    // 优先走 /api/agent/research/stream SSE 研究流程; 失败时回退到下方原有 deep think 流程。
    // 注: S.deepThink 在独立二级页面架构下恒为 false (深度思考已迁至独立页面, 见 toggleDeepThink),
    //     此处位于深度思考页发送函数内, 即代表深度思考模式。
    if (S.tavilyResearchEnabled && !fileData && originalUserText.length >= 6) {
      // 3a. 清空输入框 (Tavily 流程先行; 回退时下方 step 3 会再清一次, 无副作用)
      input.value = '';
      input.style.height = 'auto';
      if (_isTouchMobile) { try { input.blur(); } catch (e2) {} }
      else { try { input.focus(); } catch (e2) {} }

      var tavilyOutcome;
      try {
        tavilyOutcome = await runTavilyResearchFlow({
          messagesEl: dtMessagesEl,
          text: text,
          originalUserText: originalUserText,
          fileData: fileData,
          reqId: reqId,
          model: S.dtResearchMode || 'pro',
          mode: 'hybrid',
          rewrite: true
        });
      } catch (eTavily) {
        console.warn('[AI] Tavily research flow error, fallback to deep think:', eTavily && eTavily.message);
        tavilyOutcome = 'fallback';
      }
      if (tavilyOutcome !== 'fallback') {
        // 成功 / 取消 / 超时: Tavily 流程已收尾, 结束本次发送
        resetSendingIfCurrent();
        if (_isTouchMobile) { try { input.blur(); } catch (e) {} }
        updateInputMetrics();
        scrollToBottom(dtMessagesEl, false);
        return;
      }
      // 回退: Tavily 研究卡已移除, 继续下方原有 deep think 流程 (step 2 会新建进度卡)
    }

    var progressCard = buildDeepThinkProgressCard({
      variant: 'research',
      cancelFn: function() { cancelDeepThink(S.dtConversationId); },
      retryFn: function() { handleDeepThinkPageSend(originalUserText, fileData); }
    });
    progressCard.classList.add('dt-animate-in');
    S.deepThinkProgressCard = progressCard;
    dtMessagesEl.appendChild(progressCard);
    scrollToBottom(dtMessagesEl, true);

    // 3. 清空输入框
    input.value = '';
    input.style.height = 'auto';
    if (_isTouchMobile) { try { input.blur(); } catch (e2) {} }
    else { try { input.focus(); } catch (e2) {} }

    // 4. 创建 AbortController
    var controller = new AbortController();
    // ★ 修复：深页 controller 存独立通道，不再覆盖普通聊天的 S.abortController
    S._dtAbortController = controller;
    S.deepThinkJob = controller;
    S.currentStreamAborted = false;
    // 深度思考 fetch 无独立超时：服务端持续发 heartbeat 时 45s idle watchdog 永不触发，
    // 请求可无限挂起。这里加 300s 绝对超时兜底（后端最长 5 分钟思考，
    // 此前 120s 会在后端完成前被前端掐断。超时只 abort 本次，不清理全局状态）。
    var dtFetchTimeoutTimer = setTimeout(function() {
      if (S._dtCurrentReqId !== reqId) return;
      try { controller.abort('timeout'); } catch (e) {}
      controller._abortReason = 'timeout';
    }, 300000);
    if (dtFetchTimeoutTimer && dtFetchTimeoutTimer.unref) dtFetchTimeoutTimer.unref();

    var url = API_BASE + '/chat';
    var auth = await getUserAuthPayload({ forceNoToken: false });
    var headers = auth.headers || {};
    var fetchBody = JSON.stringify({
      message: text,
      conversation_id: S.dtConversationId,
      client_request_id: reqId,
      deep_think: true,
      chat_mode: 'deep_think',
      thinking_mode: S.deepThinkEffort || 'max',
      // Omit the field for ordinary messages so the server's response cache
      // remains eligible; an empty attachments array is truthy in JS.
      attachments: attachmentPayload || undefined,
      web_search: S.webSearchEnabled,
      model: S.selectedModel
    });

    var aborted = false;
    var aiContent = '';
    var finalMeta = null;
    var finalModel = '';
    var finalThinkingMode = S.deepThinkEffort || 'max';
    var streamConvId = null;
    // P5: using assistantNode (single DOM node)
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
      if (r && r.value) return r.value;
      if (isResearchCard(progressCard)) {
        if (r) r.value = progressCard;
        return progressCard;
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
      if (r) r.value = node;
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
              minChunk: 8, maxChunk: 64, charsPerMs: 3.4,
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
            var safeSrUrl2 = safeSearchUrl(sr.url);
            if (safeSrUrl2 && sr.title) searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(safeSrUrl2) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(sr.title) + '</a><br>';
            else if (safeSrUrl2) searchHtml += '<a class="ai-search-detail-title" href="' + escapeHtml(safeSrUrl2) + '" target="_blank" rel="noopener">[' + (si + 1) + '] ' + escapeHtml(safeSrUrl2) + '</a><br>';
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
          var rawErrText = await resp.text().catch(function(){ return ''; });
          var ej = null;
          if (rawErrText) {
            try { ej = JSON.parse(rawErrText); } catch (parseErr) {
              console.warn('[AI] Non-JSON error response', { status: resp.status, contentType: resp.headers.get('content-type'), bodyPreview: rawErrText.slice(0, 200) });
            }
          }
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
        onSuccess: function() { consumeAiAttachment(fileData); },
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
          // ★ 修复：120s 绝对超时中止时标记卡片状态，避免卡在"深入研究中"
          if (controller && controller._abortReason === 'timeout' && progressCard._researchState.state !== 'cancelled') {
            markResearchCardOutcome(progressCard, 'timeout', '思考超时，请重试');
          }
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
        // 120s 绝对超时（fetch 阶段被 abort）：标记超时状态并提示
        var dtTimeoutAbort = !!(controller && controller._abortReason === 'timeout');
        if (isResearchCard(progressCard)) {
          preserveResearchAnswer(progressCard, c.value);
          if (progressCard._researchState.state !== 'cancelled') {
            markResearchCardOutcome(progressCard, dtTimeoutAbort ? 'timeout' : 'interrupted', dtTimeoutAbort ? '思考超时，请重试' : '本次研究已中断，请重试');
          }
        } else if (c && c.value) { if (!r.value) ensureThinkCardNode(); finishThinkCard(r.value, c.value, fm.value); }
        else if (!isResearchCard(progressCard)) { removeLastDtUserMessage(); }
        if (dtTimeoutAbort) notify('思考超时，请重试');
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
      if (fData) {
        fData.onSuccess = function() {
          if (_dtFileData !== fData) return;
          _dtFileData = null;
          if (filePreview) { filePreview.style.display = 'none'; filePreview.innerHTML = ''; }
          if (fileInput) fileInput.value = '';
        };
      }
      handleDeepThinkPageSend(text, fData);
    }

    // 文件上传
    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        var f = this.files && this.files[0];
        if (!f) return;
        if (!isSupportedAiFile(f)) { notify('仅支持图片、PDF、DOCX、TXT、CSV 和 XLSX 文件'); this.value = ''; return; }
        if (f.size > 7 * 1024 * 1024) { notify('文件不能超过 7MB（data URL 编码后）'); return; }
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
        // A new research conversation must not inherit a pending attachment
        // from the previous one.
        _dtFileData = null;
        if (filePreview) { filePreview.style.display = 'none'; filePreview.innerHTML = ''; }
        if (fileInput) fileInput.value = '';
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

    // 暂停按钮：真正中止（取消）SSE 请求 + 暂停渲染
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!S.sending && !S.paused) return;
        var anyPaused = S.activeRenderers && S.activeRenderers.some(function(r) { return r.isPaused && r.isPaused(); });
        if (anyPaused) {
          if (S.activeRenderers) S.activeRenderers.forEach(function(r) { if (r.resume) r.resume(); });
          S.paused = false;
          pauseBtn.textContent = '暂停';
        } else {
          // H-24: 只暂停渲染器，不中止 SSE 请求 / deepThinkJob（中止会永久丢失回复）
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

    // 深度研究页面滚动监听：用户向上翻时停止自动滚动
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
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if ((target.type === 'post' || target.type === 'comment') && typeof window.openPostDetail === 'function') {
      // validate: source must be posts, source_id must be valid UUID
      if (item.source !== 'posts') {
        console.warn('[site-search] blocked invalid post result', { source: item.source, source_id: item.source_id });
        return;
      }
      // ★ 修复：comment 类型同样要求 posts 来源 + UUID，防止伪造跳转目标越权打开任意帖子详情
      var postId = String(target.post_id || item.source_id || '');
      if (!UUID_RE.test(postId)) {
        console.warn('[site-search] blocked invalid post_id', postId);
        return;
      }
      closeSecondary();
      window.openPostDetail(postId);
    } else if (target.type === 'photo' && target.image_url && typeof window.openPhotoPreview === 'function') {
      // ★ 修复：photo 类型校验来源与 id 格式，避免越权预览
      var photoId = String(target.post_id || item.source_id || '');
      if ((item.source !== 'posts' && item.source !== 'photos') || !photoId) {
        console.warn('[site-search] blocked invalid photo result', { source: item.source, source_id: photoId });
        return;
      }
      closeSecondary();
      window.openPhotoPreview(0, { photos: [{ id: photoId, cloudId: target.post_id || null, imageUrl: target.image_url, thumbUrl: target.image_url, username: target.user_name || '', timestamp: item.created_at || '', content: item.snippet || '' }] });
    } else if (target.type === 'photo' && typeof window.openPostDetail === 'function') {
      var photoPostId = String(target.post_id || item.source_id || '');
      if (item.source !== 'posts' || !UUID_RE.test(photoPostId)) {
        console.warn('[site-search] blocked invalid photo post result', { source: item.source, source_id: photoPostId });
        return;
      }
      closeSecondary();
      window.openPostDetail(photoPostId);
    } else if (target.type === 'dm' && typeof window.openChat === 'function') {
      // ★ 修复：dm 跳转必须有明确的会话对象，空 user 直接拦截
      if (!target.user || typeof target.user !== 'string') {
        console.warn('[site-search] blocked invalid dm target', target);
        return;
      }
      closeSecondary();
      window.openChat(target.user);
    } else if (target.type === 'ai_history' && window.__xtjAiAgent && typeof window.__xtjAiAgent.openConversation === 'function') {
      if (!target.conversation_id) {
        console.warn('[site-search] blocked invalid ai_history target', target);
        return;
      }
      try { closeSiteSearch(); } catch (e3) {}
      window.__xtjAiAgent.openConversation(target.conversation_id, target.mode);
    } else if (target.type === 'user' && typeof window.openUserProfile === 'function') {
      var userName = target.user_name || item.title || '';
      if (!userName || typeof userName !== 'string') {
        console.warn('[site-search] blocked invalid user target', target);
        return;
      }
      closeSecondary();
      window.openUserProfile(userName);
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

  function renderAiToolCard(messagesEl, card, insertBeforeNode) {
    if (!messagesEl || !card || card.protocol !== 'xtj.ai.ui.v1') return null;
    var cardId = String(card.id || '');
    if (!messagesEl.__xtjAiCardIds) messagesEl.__xtjAiCardIds = {};
    if (cardId && messagesEl.__xtjAiCardIds[cardId]) return null;
    if (cardId) messagesEl.__xtjAiCardIds[cardId] = true;
    var type = String(card.type || 'tool_result').replace(/[^a-z_]/g, '');
    var shell = el('section', { class: 'ai-tool-card ai-tool-card--' + type });
    if (cardId) shell.setAttribute('data-ai-card-id', cardId);
    shell.appendChild(el('div', { class: 'ai-tool-card-title', text: String(card.title || 'AI 工具结果') }));
    var data = card.data || {};

    function appendKvGrid(pairs) {
      var grid = el('div', { class: 'ai-tool-card-kv' });
      pairs.forEach(function(pair) {
        if (pair[1] === undefined || pair[1] === null || pair[1] === '') return;
        var row = el('div', { class: 'ai-tool-card-kv-row' });
        row.appendChild(el('span', { class: 'ai-tool-card-kv-k', text: pair[0] }));
        row.appendChild(el('span', { class: 'ai-tool-card-kv-v', text: String(pair[1]) }));
        grid.appendChild(row);
      });
      if (grid.childNodes.length) shell.appendChild(grid);
    }

    if (type === 'weather') {
      var tempLine = el('div', { class: 'ai-tool-card-hero' });
      tempLine.appendChild(el('span', { class: 'ai-tool-card-hero-main', text: (data.temperature_c != null ? data.temperature_c + '°C' : '—') }));
      tempLine.appendChild(el('span', { class: 'ai-tool-card-hero-sub', text: String(data.condition || data.city || '') }));
      shell.appendChild(tempLine);
      appendKvGrid([
        ['地点', data.city],
        ['湿度', data.humidity != null ? data.humidity + '%' : ''],
        ['风速', data.wind_kmh != null ? data.wind_kmh + ' km/h' : ''],
        ['今日最高', data.high_c != null ? data.high_c + '°C' : ''],
        ['今日最低', data.low_c != null ? data.low_c + '°C' : ''],
        ['降雨概率', data.precip_prob != null ? data.precip_prob + '%' : ''],
        ['更新', data.queried_at]
      ]);
    } else if (type === 'exchange_rate') {
      var rateHero = el('div', { class: 'ai-tool-card-hero' });
      rateHero.appendChild(el('span', { class: 'ai-tool-card-hero-main', text: data.rate != null ? Number(data.rate).toFixed(4) : '—' }));
      rateHero.appendChild(el('span', { class: 'ai-tool-card-hero-sub', text: (data.from || '') + ' → ' + (data.to || '') }));
      shell.appendChild(rateHero);
      appendKvGrid([
        ['换算', (data.amount != null ? data.amount : 1) + ' ' + (data.from || '') + ' ≈ ' + (data.converted != null ? data.converted : '—') + ' ' + (data.to || '')],
        ['更新', data.updated_at]
      ]);
    } else if (type === 'stock_quote') {
      var stockHero = el('div', { class: 'ai-tool-card-hero' });
      stockHero.appendChild(el('span', { class: 'ai-tool-card-hero-main', text: String(data.price != null ? data.price : '—') }));
      var chg = String(data.change || '');
      var chgPct = String(data.change_pct || '');
      var chgText = (chg ? chg : '') + (chgPct ? ' (' + chgPct + '%)' : '');
      var chgClass = 'ai-tool-card-hero-sub';
      if (/^-/.test(chg) || /^-/.test(chgPct)) chgClass += ' is-down';
      else if (chg && chg !== '0' && chg !== '0.00') chgClass += ' is-up';
      stockHero.appendChild(el('span', { class: chgClass, text: chgText || String(data.symbol || '') }));
      shell.appendChild(stockHero);
      appendKvGrid([
        ['名称', data.name],
        ['代码', data.symbol],
        ['今开', data.open],
        ['最高', data.high],
        ['最低', data.low],
        ['昨收', data.prev_close],
        ['时间', data.time]
      ]);
    } else if (type === 'time') {
      appendKvGrid([
        ['北京时间', data.beijing_time],
        ['星期', data.weekday],
        ['时区', data.timezone]
      ]);
    } else if (type === 'page_read') {
      var pageTitle = el('div', { class: 'ai-tool-card-page-title', text: String(data.title || '网页') });
      shell.appendChild(pageTitle);
      if (data.url) {
        var safeHref = '';
        try {
          var u = new URL(String(data.url));
          if (u.protocol === 'https:' || u.protocol === 'http:') safeHref = u.toString();
        } catch (e) {}
        if (safeHref) {
          var link = el('a', {
            class: 'ai-tool-card-link',
            href: safeHref,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: safeHref.length > 72 ? safeHref.slice(0, 72) + '…' : safeHref
          });
          shell.appendChild(link);
        }
      }
      if (data.error && !data.snippet) {
        shell.appendChild(el('div', { class: 'ai-tool-card-summary ai-tool-card-summary--warn', text: String(data.error).slice(0, 200) }));
      } else if (data.snippet) {
        shell.appendChild(el('div', { class: 'ai-tool-card-summary', text: String(data.snippet).slice(0, 360) }));
      }
      var pageMeta = [];
      if (data.via_jina) pageMeta.push('增强阅读');
      if (data.truncated) pageMeta.push('正文已截断');
      if (data.bytes) pageMeta.push((data.bytes > 1024 ? (data.bytes / 1024).toFixed(1) + ' KB' : data.bytes + ' B'));
      if (pageMeta.length) shell.appendChild(el('div', { class: 'ai-tool-card-meta', text: pageMeta.join(' · ') }));
    } else if (type === 'image_ocr') {
      if (data.error && !data.text) {
        shell.appendChild(el('div', { class: 'ai-tool-card-summary ai-tool-card-summary--warn', text: '未识别到文字：' + String(data.error).slice(0, 200) }));
      } else {
        var ocrBody = el('div', { class: 'ai-tool-card-ocr-text' });
        ocrBody.textContent = String(data.text || '').slice(0, 1200) || '（无文字）';
        shell.appendChild(ocrBody);
      }
      var ocrMeta = el('div', { class: 'ai-tool-card-meta ai-tool-card-ocr-meta' });
      var metaBits = [];
      if (data.file_name) metaBits.push(String(data.file_name).slice(0, 48));
      if (data.chars != null) metaBits.push(data.chars + ' 字');
      if (data.provider) metaBits.push(String(data.provider));
      ocrMeta.textContent = metaBits.join(' · ');
      if (metaBits.length) shell.appendChild(ocrMeta);
    } else if (type === 'web_search' && Array.isArray(data.results)) {
      if (data.query) {
        shell.appendChild(el('div', { class: 'ai-tool-card-meta', text: '搜索：' + String(data.query).slice(0, 120) }));
      }
      var webList = el('div', { class: 'ai-tool-card-list' });
      data.results.slice(0, 12).forEach(function(item) {
        var row = el('div', { class: 'ai-tool-result ai-tool-result--link' });
        var href = '';
        try {
          var wu = new URL(String(item.url || ''));
          if (wu.protocol === 'https:' || wu.protocol === 'http:') href = wu.toString();
        } catch (e2) {}
        if (href) {
          row.appendChild(el('a', {
            class: 'ai-tool-result-title-link',
            href: href,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: String(item.title || item.url || '结果').slice(0, 120)
          }));
        } else {
          row.appendChild(el('b', { text: String(item.title || '结果').slice(0, 120) }));
        }
        if (item.snippet) row.appendChild(el('span', { text: String(item.snippet).slice(0, 180) }));
        if (item.source) row.appendChild(el('small', { class: 'ai-tool-result-meta', text: String(item.source) }));
        webList.appendChild(row);
      });
      shell.appendChild(webList);
    } else if (Array.isArray(data.results)) {
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

    if (insertBeforeNode && insertBeforeNode.parentNode) {
      insertBeforeNode.parentNode.insertBefore(shell, insertBeforeNode);
    } else if (messagesEl) {
      messagesEl.appendChild(shell);
    }
    try {
      var scroller = messagesEl && messagesEl.classList && messagesEl.classList.contains('ai-messages')
        ? messagesEl
        : (messagesEl && messagesEl.closest && messagesEl.closest('.ai-messages'));
      if (scroller) scrollToBottom(scroller, false);
    } catch (eScroll) {}
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
    // 顶栏 AI 工具已由 core bootstrap 绑定自定义菜单；仅未绑定时兜底
    var nav = document.getElementById('aiToolsNav');
    var trigger = document.getElementById('aiToolsBtn');
    var menu = document.getElementById('aiToolsMenu');
    if (!nav || !trigger || !menu || nav.__xtjAiToolsBound) return;
    nav.__xtjAiToolsBound = true;

    var legacySelect = document.getElementById('aiToolsNativeSelect');
    if (legacySelect && legacySelect.parentNode) {
      try { legacySelect.parentNode.removeChild(legacySelect); } catch (eRem) {}
    }

    var open = false;
    function setOpen(next) {
      open = !!next;
      menu.hidden = !open;
      menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      nav.classList.toggle('is-open', open);
    }

    trigger.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(!open);
    });
    menu.addEventListener('click', async function(event) {
      event.stopPropagation();
      var btn = event.target && event.target.closest ? event.target.closest('[data-ai-tool]') : null;
      if (!btn) return;
      var tool = btn.getAttribute('data-ai-tool');
      if (!tool) return;
      setOpen(false);
      if (tool === 'research') await openDeepThinkPage();
      else if (tool === 'search') await openSiteSearchPage();
      else await openAiChat();
    });
    document.addEventListener('click', function(event) {
      if (!open) return;
      if (nav.contains(event.target)) return;
      setOpen(false);
    });
  }

  async function handleSendMessage(input, sendBtn, messagesEl, fileData) {
    var text = String(input.value || '').trim();
    var originalUserText = text;
    var sendFingerprint = originalUserText + '\u0000' + (fileData ? String(fileData.name || '') + ':' + String(fileData.dataUrl || '').length : '');
    if (S.sending && S.lastSendFingerprint === sendFingerprint && Date.now() - S.lastSendAt < 1500) {
      try { notify('已发送，请勿重复点击'); } catch (eDuplicate) {}
      return;
    }
    S.lastSendFingerprint = sendFingerprint;
    S.lastSendAt = Date.now();
    // Lock synchronously before the first await (auth/token acquisition), so
    // two clicks in the same event loop cannot create two streams.
    S.sending = true;
    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('ai_chat', '向AI发送消息: ' + text.slice(0, 30)); } catch(e) {}
    var displayText = text;
    var attachmentPayload = null;
    // 如果有文件: 区分: UI 显示用完整 data URL 或文件占位，发送给服务器用简短标记
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
      // 发送给服务器: 简短标记，不含大 data URL
      var serverTag = isImage
        ? '[图片: ' + safeName + ' · ' + sizeKB + 'KB]'
        : '[文件: ' + safeName + ' · ' + sizeKB + 'KB]';
      text = text ? text + '\n' + serverTag : serverTag;
      attachmentPayload = [{ name: safeName, type: fileData.type || 'application/octet-stream', data_url: fileData.dataUrl }];
    }
    if (!text) { S.sending = false; return; }
    if (text.length > 50000) {
      notify('消息过长，最多 50000 字符，请精简后重试');
      S.sending = false;
      return;
    }

    // ★ 立即标记发送中，防止并发竞态
    // P1: UI立即显示，认证异步执行
    S.sending = true;
    if (S.pauseBtnEl) S.pauseBtnEl.style.display = '';
    clearReplyTimer();

    // P1: 如果有正在进行的请求，中断它
    if (S.abortController) {
      abortCurrentRequest();
      try { await new Promise(function(resolve) { setTimeout(resolve, 50); }); } catch (e) {}
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

    var originalText = originalUserText;
    function restoreInputText() {
      input.value = originalText;
      input.style.height = 'auto';
      try {
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        if (!_isTouchMobile) input.focus();
      } catch (e) {}
      updateInputMetrics();
    }

    // ============================================================
    // P1 修复: 立即显示用户消息和助手等待节点 (<=100ms)
    // 认证和Token获取异步进行，不阻塞UI反馈
    // ============================================================
    var nowIso = new Date().toISOString();
    var userMsg = { role: 'user', content: displayText, created_at: nowIso };
    S.messages.push(userMsg);
    appendMessage(messagesEl, userMsg);
    S.autoScrollPinned = true;
    scrollToBottom(messagesEl, true);

    // P5 修复: 创建单一助手节点，typing dots 放在节点内部
    // 从发送到完成，始终使用同一个 DOM 节点
    // ★ 优化：发送后立刻展示「思考中」占位，不等服务端首包（降低感知延迟）
    var assistantNode = el('div', { class: 'ai-msg assistant entering generating' });
    var assistantBubble = el('div', { class: 'ai-msg-bubble' });
    // 气泡先隐藏，等 content 到达再显示；思考占位单独可见
    assistantBubble.style.display = 'none';
    assistantNode.appendChild(assistantBubble);
    // 思考模式开启时：立即插入思考节点，用户一点发送就看到反馈
    var _earlyThinkingShown = false;
    if (S.thinkingMode && S.thinkingMode !== 'off') {
      try {
        // 发送后立刻展示思考节点，并默认展开，保证流式思考过程可见
        var earlyRn = buildReasoningNode('', messagesEl);
        var earlyLabel = earlyRn.querySelector('.ai-thinking-label');
        if (earlyLabel) earlyLabel.textContent = '思考中';
        setThinkingExpanded(earlyRn, true, messagesEl);
        assistantNode.insertBefore(earlyRn, assistantNode.firstChild);
        _earlyThinkingShown = true;
      } catch (eEarly) {}
    } else {
      // 关闭思考时给轻量「准备中」占位，避免空白等太久
      try {
        assistantBubble.style.display = 'block';
        assistantBubble.classList.add('ai-reply-pending');
        assistantBubble.textContent = '正在回复…';
      } catch (ePending) {}
    }
    messagesEl.appendChild(assistantNode);
    scrollToBottom(messagesEl, true);

    // Available before fetch() returns an HTTP error, so a rejected request
    // cannot leave the temporary typing bubble on screen.
    function hideAssistantTyping() {
      try {
        assistantBubble.classList.remove('ai-typing-bubble');
        if (assistantBubble.classList.contains('ai-reply-pending') && assistantBubble.textContent === '正在回复…') {
          assistantBubble.textContent = '';
        }
        assistantBubble.classList.add('ai-reply-pending');
      } catch (e) {}
    }

    // 清空输入框
    input.value = '';
    input.style.height = 'auto';
    updateInputMetrics();
    if (_isTouchMobile) {
      try { input.blur(); } catch (e2) {}
    } else {
      try { input.focus(); } catch (e2) {}
    }

    // ============================================================
    // P1 修复: 认证异步执行，失败时恢复UI
    // ============================================================
    var authOk = await ensureUserAuthOrNotify();
    if (!authOk) {
      // 认证失败 => 清理UI，恢复状态
      try { assistantNode.remove(); } catch (e) {}
      S.messages.pop();
      removeLastUserMessage(messagesEl);
      restoreInputText();
      resetSendingIfCurrent();
      return;
    }

    var aborted = false;

    // 创建 AbortController
    var controller = new AbortController();
    S.abortController = controller;
    S.currentStreamAborted = false;

    // Phase 1: Shared request controller + telemetry (feature-flagged)
    var sharedCtrl = null;
    var telemetry = null;
    if (window.XtjAiCore && window.XtjAiCore.RequestController && window.XtjAiCore.RequestController.FEATURE_FLAG) {
      sharedCtrl = window.XtjAiCore.RequestController.create({
        requestId: reqId,
        clientRequestId: 'cr_' + S.clientRequestId,
        // ★ 优化：后端深度思考/长思考最长 5 分钟，前端 120s 会提前掐断，
        // 对齐为 300s（SSE idle 看门狗 45s/120s 仍负责真正的假死检测）。
        timeoutMs: 300000
      });
      sharedCtrl.start();
      window.XtjAiCore.RequestController.registerInFlight('cat_ai', sharedCtrl);
      if (window.XtjAiCore.Telemetry) {
        telemetry = window.XtjAiCore.Telemetry.create();
        telemetry.start(reqId, 'cr_' + S.clientRequestId);
      }
    }

    var url = API_BASE + '/chat/stream';
    var auth = await getUserAuthPayload({ forceNoToken: false });
    var headers = auth.headers || {};

    var fetchBody = JSON.stringify({
      message: text,
      conversation_id: S.conversationId,
      client_request_id: reqId,
      thinking_mode: S.thinkingMode || 'max',
      response_profile: S.responseProfile === 'enhanced' ? 'enhanced' : 'normal',
      attachments: attachmentPayload || undefined,
      web_search: S.webSearchEnabled,
      model: S.selectedModel
    });
    
    try {
      var resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: fetchBody,
        signal: sharedCtrl ? sharedCtrl.signal : controller.signal
      });
      
      if (!resp.ok) {
        var responseMessage = 'AI 服务暂时不可用，请稍后重试';
        var errorCode = '';
        try {
          var rawErrText = await resp.text().catch(function(){ return ''; });
          var errJson = null;
          if (rawErrText) {
            try { errJson = JSON.parse(rawErrText); } catch (parseErr) {
              console.warn('[AI] Non-JSON error response', { status: resp.status, contentType: resp.headers.get('content-type'), bodyPreview: rawErrText.slice(0, 200) });
            }
          }
          if (errJson && errJson.error) responseMessage = String(errJson.error);
          if (errJson && errJson.code) errorCode = String(errJson.code);
        } catch(e) {}
        // Phase 3: Use shared error classification when enabled
        if (window.XtjAiCore && window.XtjAiCore.Errors && window.XtjAiCore.RequestController && window.XtjAiCore.RequestController.FEATURE_FLAG) {
          var classified = window.XtjAiCore.Errors.classify(new Error(responseMessage), {
            httpStatus: resp.status,
            requestId: reqId,
            phase: 'http_response'
          });
          responseMessage = classified.message;
          errorCode = classified.code;
        }
        if (S._currentReqId !== reqId) return;
        if (sharedCtrl) {
          sharedCtrl.error('http_' + (resp.status || 0));
          if (telemetry) { telemetry.finalize('error', { code: errorCode, phase: 'http_response', message: responseMessage }); }
        }
        hideAssistantTyping();
        try { assistantNode.remove(); } catch (e) {}
        S.messages.pop();
        removeLastUserMessage(messagesEl);
        restoreInputText();
        notify(errorCode ? '[' + errorCode + '] ' + responseMessage : responseMessage);
        resetSendingIfCurrent();
        return;
      }
      
      if (!resp.body) {
        hideAssistantTyping();
        try { assistantNode.remove(); } catch (e) {}
        S.messages.pop();
        removeLastUserMessage(messagesEl);
        restoreInputText();
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
      // P5: using assistantNode (single DOM node)
      // P5: using assistantBubble (single DOM node)
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
      var _finalized = false;

      function clearAssistantTransientStatus(node) {
        var target = node || assistantNode;
        if (!target) return;
        var statuses = target.querySelectorAll('.ai-enhanced-status, .ai-tool-status, .ai-search-supplement');
        for (var statusIndex = 0; statusIndex < statuses.length; statusIndex++) {
          try { statuses[statusIndex].remove(); } catch (eStatus) {}
        }
      }

      function attachContinueGenerateBtn(node, msgHost) {
        if (!node || node.querySelector('.ai-continue-btn')) return;
        var btn = el('button', { type: 'button', class: 'ai-continue-btn', text: '继续生成' });
        btn.addEventListener('click', function() {
          if (S.sending) {
            notify('正在回复中，请稍候');
            return;
          }
          var lastUser = '';
          for (var i = S.messages.length - 1; i >= 0; i--) {
            if (S.messages[i] && S.messages[i].role === 'user') {
              lastUser = String(S.messages[i].content || '');
              break;
            }
          }
          if (!lastUser) {
            notify('没有可继续的消息');
            return;
          }
          btn.disabled = true;
          btn.textContent = '继续中…';
          var inputEl = S.inputEl || document.getElementById('aiChatInput');
          var sendEl = S.sendBtnEl || document.getElementById('aiChatSend');
          var host = msgHost || S.messagesEl || document.getElementById('aiChatMessages');
          if (inputEl) inputEl.value = '请在上文基础上继续写完，不要重复已说内容。';
          try {
            if (typeof handleSendMessage === 'function') handleSendMessage(inputEl, sendEl, host, null);
            else notify('无法继续，请手动重发');
          } catch (eSend) {
            notify('继续失败，请手动重发');
            btn.disabled = false;
            btn.textContent = '继续生成';
          }
        });
        node.appendChild(btn);
      }

      function finishAiMessage(node, content, thinking, evt) {
        // P4 修复: 防止重复 finalize
        if (_finalized) return;
        _finalized = true;
        // A stage is only a live progress indicator. Keeping it after the
        // answer is rendered makes a completed answer look permanently stuck.
        clearAssistantTransientStatus(node);
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
            contentRenderer.finish(fallbackText);
          }
        } else {
          // P4 修复: 仅在无 contentRenderer 时才直接覆盖 innerHTML
          if (assistantBubble) {
            assistantBubble.innerHTML = renderMarkdown(hasContent ? content : fallbackText);
          }
        }
        cleanupRenderers();
        if (node) {
          node.classList.remove('generating');
        }
        if (assistantBubble) {
          assistantBubble.classList.remove('ai-typing');
          assistantBubble.style.opacity = '1';
          assistantBubble.style.display = 'block';
          assistantBubble.style.visibility = 'visible';
          assistantBubble.style.color = '#1f2937';
          assistantBubble.style.fontSize = '14px';
        }
        setAiRootState('ai-idle');
        
        if (thinking && finalThinkingMode !== 'off' && S.thinkingMode !== 'off') {
          // ★ 修复：优先用 reasoningContainer（流式期间创建的），但必须验证节点仍在 DOM 中。
          //   C 修复：额外用用户意图 S.thinkingMode 判断——即便后端未 Honor 'off' 仍回 reasoning，
          //   只要用户关了思考，收尾也强制不渲染思考节点（走下方 else 分支移除）。
          //   此前若 reasoningContainer 持有脱离 DOM 的陈旧引用（search_supplement 重置、
          //   sanitized_content 替换 innerHTML 等场景），代码误以为按钮已存在而跳过创建，
          //   导致"已思考"折叠按钮消失。现在双重校验：变量非空 + 节点仍连接在文档中。
          var rNode = (reasoningContainer && reasoningContainer.isConnected) ? reasoningContainer : (node ? node.querySelector('.ai-thinking') : null);
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
          // 如果有搜索结果，把已有的搜索条移入消息节点（而非单独在 container 里）
          var liveSearchBar = null;
          if (searchCount > 0) {
            liveSearchBar = node.querySelector('.ai-search-status');
          }
          if (liveSearchBar) {
            node.appendChild(liveSearchBar);
          } else if (searchCount > 0) {
            // 没有直播搜索条（如历史重建），创建一个简版
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

      function ensureAssistantReady() {
        hideAssistantTyping();
        return assistantNode;
      }

      function ensureReasoningNode() {
        ensureAssistantReady();
        if (!reasoningContainer) {
          reasoningContainer = assistantNode.querySelector('.ai-thinking');
        }
        if (!reasoningContainer) {
          reasoningContainer = buildReasoningNode('思考中...', messagesEl);
          assistantNode.insertBefore(reasoningContainer, assistantNode.firstChild);
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

      function ensureAssistantBubbleReady() {
        hideAssistantTyping();
        assistantBubble.classList.remove('ai-reply-pending');
        // 清掉发送后占位文案，避免和流式内容拼在一起
        if (assistantBubble.textContent === '正在回复…' && !contentRenderer) {
          try { assistantBubble.textContent = ''; } catch (eClr) {}
        }
        assistantBubble.style.display = 'block';
        assistantBubble.style.visibility = 'visible';
        if (!assistantBubble.classList.contains('ai-typing')) {
          assistantBubble.classList.add('ai-typing');
        }
        if (!contentRenderer) {
          contentRenderer = createSmoothTextRenderer(assistantBubble, {
            minChunk: 8,
            maxChunk: 64,
            charsPerMs: 3.4,
            streamClass: 'ai-streaming-soft',
            onRender: function() {
              scrollToBottom(messagesEl, false);
            }
          });
          // P4 修复: 设置复制事件监听器
          setupBubbleCopy(assistantBubble, messagesEl);
        }
        return assistantBubble;
      }
      
      // H-25: 普通对话 idle 看门狗 — 无数据视为超时，中止等待并清理，
      // 避免服务端/provider 挂起时界面永久停在"处理中"。
      // B 修复：收到首个数据块前用 45s（防连接假死）；一旦收到任何事件（含 reasoning/content），
      // 说明连接存活、AI 正在工作，放宽到 120s，容忍慢模型在思考阶段的静默，避免误判"AI中断"。
      var _lastDataTime = Date.now();
      var timedOut = false;
      var _receivedAny = false;
      var _idleCheckTimer = setInterval(function() {
        if (timedOut || !S.active) return;
        var idleThreshold = _receivedAny ? 120000 : 45000;
        if (Date.now() - _lastDataTime > idleThreshold) {
          timedOut = true;
          if (controller && controller.abort) { try { controller.abort(); } catch (e) {} }
          if (reader) { try { reader.cancel(); } catch (e) {} }
        }
      }, 5000);

      while (true) {
        if (S._currentReqId !== reqId || controller.signal.aborted) {
          aborted = true;
          if (reader) try { reader.cancel(); } catch (e) {}
          break;
        }
        
        var readResult;
        try { readResult = await reader.read(); } catch (e) { throw e; }
        if (readResult.done) break;
        if (!S.active) {
          // ★ 修复 M10：break 前必须置 aborted，否则下方 `S._currentReqId !== reqId || aborted`
          // 判定可能走"完成处理"分支保留半成品节点（回答闪现后消失）。
          aborted = true;
          reader.cancel().catch(function(){});
          break;
        }
        
        buffer += decoder.decode(readResult.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        _lastDataTime = Date.now();
        _receivedAny = true; // B 修复：已收到任意数据，放宽 idle 阈值到 120s
        
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
          
          // 服务端心跳保活事件：仅用于保持连接与重置 idle 看门狗，无 UI 副作用
          if (evt.type === 'heartbeat') {
            continue;
          }
          
          if (evt.type === 'multi_agent') {
            var maStatus = assistantNode.querySelector('.ai-search-status');
            if (!maStatus) {
              maStatus = el('div', { class: 'ai-search-status' });
              assistantNode.insertBefore(maStatus, assistantBubble);
            }
            if (evt.action === 'searching') {
              var qs = evt.queries || [];
              maStatus.textContent = '多 Agent 协作：正在并行搜索 ' + qs.join('、');
              // ★ 优化：把拆解的查询词同步展示进思考过程，让用户看到
              // "拆了哪些词、搜了什么"，而不是只看一个状态条。
              try {
                if (qs.length) {
                  var maThink = ensureReasoningNode();
                  var maBody = maThink && maThink.querySelector('.ai-thinking-body');
                  if (maBody) {
                    var maEntry = el('div', { class: 'ai-thought-entry' });
                    maEntry.innerHTML = '<div class="ai-thought-role">🔍 多 Agent 拆解搜索词</div><div class="ai-thought-chunk"></div>';
                    maEntry.querySelector('.ai-thought-chunk').textContent = qs.map(function(q, qi) { return (qi + 1) + '. ' + q; }).join('\n');
                    maBody.appendChild(maEntry);
                    try { maBody.scrollTop = maBody.scrollHeight; } catch (e) {}
                  }
                  if (maThink) setThinkingExpanded(maThink, true, messagesEl);
                }
              } catch (eMa) {}
            }
          }

          // 思考后补充搜索：重置内容状态以接收新一轮 stream，保留已显示的思考过程
          if (evt.type === 'search_supplement') {
            var searchNote = el('div', { class: 'ai-search-supplement', text: '正在联网补充信息...' });
            if (assistantNode) assistantNode.insertBefore(searchNote, assistantBubble);
            // 清空旧内容，让第二轮 stream 重新生成
            cleanupRenderers();
            hideAssistantTyping();
            if (assistantBubble) try { assistantBubble.innerHTML = ''; } catch (e) {}
            // ★ 修复：reasoning 节点引用一并失效。旧节点可能已随 supplement 被清理/脱管，
            // 若继续复用脱离 DOM 的节点，新一轮 thinking 内容会插入已 detached 节点而不显示。
            reasoningContainer = null;
            if (reasoningRenderer) { try { reasoningRenderer.cancel(); } catch (eR) {} reasoningRenderer = null; }
            aiContent = '';
            aiReasoning = '';
            reasoningStarted = false;
            doneReceived = false;
            finalThinkingElapsedMs = 0;
            finalThinkingMode = null;
            continue;
          }

          if (evt.type === 'search_status') {
            // DeepSeek 内置 web_search 状态（黑盒：结果不外吐，仅提示状态）
            var stBar = assistantNode.querySelector('.ai-search-status');
            if (!stBar) {
              stBar = el('div', { class: 'ai-search-status' });
              assistantNode.insertBefore(stBar, assistantBubble);
            }
            if (evt.status === 'searching') {
              stBar.textContent = '正在联网搜索…';
            } else if (evt.status === 'completed') {
              stBar.textContent = '已联网（内置搜索）';
            }
            continue;
          }

          if (evt.type === 'search') {
            // 显示搜索状态条
            var searchCount = evt.count;
            var searchDiag = evt.diagnostics;
            var searchBar = assistantNode.querySelector('.ai-search-status');
            if (!searchBar) {
              searchBar = el('div', { class: 'ai-search-status' });
              assistantNode.insertBefore(searchBar, assistantBubble);
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
              var toggleBtn = el('span', { class: 'ai-search-toggle' }, ' ▸');
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
                var linkEl = el('a', { class: 'ai-search-detail-title', href: safeSearchUrl(r.url) || '#', target: '_blank', rel: 'noopener noreferrer', text: r.title || '无标题' });
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
            var searchBar2 = assistantNode.querySelector('.ai-search-status');
            if (!searchBar2) {
              searchBar2 = el('div', { class: 'ai-search-status' });
              assistantNode.insertBefore(searchBar2, assistantBubble);
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
            var nameMapCall = {
              search_web: '联网搜索', tavily_search: 'Tavily搜索', read_web_page: '阅读网页',
              get_weather: '查询天气', get_current_time: '获取时间',
              get_exchange_rate: '查询汇率', get_stock_quote: '查询行情'
            };
            var timeline = assistantNode.querySelector('.ai-tool-timeline');
            if (!timeline) {
              timeline = el('div', { class: 'ai-tool-timeline ai-tool-status', role: 'status', 'aria-live': 'polite' });
              assistantNode.insertBefore(timeline, assistantBubble);
            }
            toolList.forEach(function(t) {
              var label = nameMapCall[t.name] || t.name || '工具';
              var detail = '';
              if (t.args && t.args.query) detail = String(t.args.query);
              else if (t.args && t.args.url) detail = String(t.args.url).slice(0, 80);
              else if (t.args && t.args.location) detail = String(t.args.location);
              else if (t.args && t.args.symbol) detail = String(t.args.symbol);
              else if (t.args && t.args.from && t.args.to) detail = String(t.args.from) + '→' + String(t.args.to);
              var stepId = 'tool-step-' + String(t.name || 'tool') + '-' + String(detail).slice(0, 24);
              var existing = timeline.querySelector('[data-tool-step="' + stepId.replace(/"/g, '') + '"]');
              if (existing) {
                existing.classList.add('is-running');
                existing.classList.remove('is-done', 'is-error');
                var st = existing.querySelector('.ai-tool-step-status');
                if (st) st.textContent = '进行中';
                return;
              }
              var step = el('div', { class: 'ai-tool-step is-running' });
              step.setAttribute('data-tool-step', stepId);
              step.setAttribute('data-tool-name', String(t.name || ''));
              step.appendChild(el('span', { class: 'ai-tool-step-icon', text: '🔧' }));
              var body = el('div', { class: 'ai-tool-step-body' });
              body.appendChild(el('div', { class: 'ai-tool-step-title', text: label }));
              if (detail) body.appendChild(el('div', { class: 'ai-tool-step-detail', text: detail }));
              body.appendChild(el('div', { class: 'ai-tool-step-status', text: '进行中' }));
              step.appendChild(body);
              timeline.appendChild(step);
            });
            continue;
          }

          if (evt.type === 'enhanced_stage') {
            var stageLabel = evt.message || ({ understand: '正在梳理问题与回答结构…', verify: '正在查证必要信息…', answer: '正在组织回答…' }[evt.stage] || '正在增强思考…');
            var enhancedBar = assistantNode.querySelector('.ai-enhanced-status');
            if (!enhancedBar) {
              enhancedBar = el('div', { class: 'ai-enhanced-status', role: 'status', 'aria-live': 'polite' });
              assistantNode.insertBefore(enhancedBar, assistantBubble);
            }
            enhancedBar.textContent = stageLabel;
            enhancedBar.setAttribute('data-stage', evt.stage || 'working');
            continue;
          }
          
          if (evt.type === 'card') {
            try {
              // Prefer placing cards inside the assistant turn (before bubble),
              // fall back to transcript end for early attachment OCR cards.
              if (assistantNode && assistantBubble) {
                renderAiToolCard(assistantNode, evt.card, assistantBubble);
              } else {
                renderAiToolCard(messagesEl, evt.card);
              }
            } catch (cardErr) { notify('AI 卡片加载失败，已保留文字回复'); }
            continue;
          }

          if (evt.type === 'tool_pending') {
            var pendingBar = assistantNode.querySelector('.ai-tool-timeline') || assistantNode.querySelector('.ai-tool-status');
            if (!pendingBar) {
              pendingBar = el('div', { class: 'ai-tool-timeline ai-tool-status', role: 'status' });
              assistantNode.insertBefore(pendingBar, assistantBubble);
            }
            var pendStep = el('div', { class: 'ai-tool-step is-running' });
            pendStep.appendChild(el('span', { class: 'ai-tool-step-icon', text: '⏳' }));
            var pendBody = el('div', { class: 'ai-tool-step-body' });
            pendBody.appendChild(el('div', { class: 'ai-tool-step-title', text: '准备工具' }));
            pendBody.appendChild(el('div', { class: 'ai-tool-step-detail', text: evt.tool_name || '站内工具' }));
            pendBody.appendChild(el('div', { class: 'ai-tool-step-status', text: '进行中' }));
            pendStep.appendChild(pendBody);
            pendingBar.appendChild(pendStep);
            continue;
          }

          if (evt.type === 'tool_error') {
            notify((evt.tool_name || 'AI 工具') + '：' + (evt.error || '执行失败'));
            var errTimeline = assistantNode.querySelector('.ai-tool-timeline');
            if (errTimeline) {
              var errStep = el('div', { class: 'ai-tool-step is-error' });
              errStep.appendChild(el('span', { class: 'ai-tool-step-icon', text: '⚠️' }));
              var errBody = el('div', { class: 'ai-tool-step-body' });
              errBody.appendChild(el('div', { class: 'ai-tool-step-title', text: evt.tool_name || '工具' }));
              errBody.appendChild(el('div', { class: 'ai-tool-step-status', text: '失败' }));
              if (evt.error) errBody.appendChild(el('div', { class: 'ai-tool-step-detail', text: String(evt.error).slice(0, 120) }));
              errStep.appendChild(errBody);
              errTimeline.appendChild(errStep);
            }
            continue;
          }

          if (evt.type === 'tool_result') {
            var toolBar2 = assistantNode.querySelector('.ai-tool-timeline') || assistantNode.querySelector('.ai-tool-status');
            if (!toolBar2) {
              toolBar2 = el('div', { class: 'ai-tool-timeline ai-tool-status' });
              assistantNode.insertBefore(toolBar2, assistantBubble);
            }
            var nameMap = {
              search_web: '联网搜索', tavily_search: 'Tavily搜索', read_web_page: '阅读网页',
              get_weather: '查询天气', get_current_time: '获取时间',
              get_exchange_rate: '查询汇率', get_stock_quote: '查询行情'
            };
            var label = nameMap[evt.tool_name] || evt.tool_name || '工具';
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
            // Update timeline step + keep expandable result card below
            var matchStep = null;
            var steps = toolBar2.querySelectorAll('.ai-tool-step');
            for (var si = steps.length - 1; si >= 0; si--) {
              if ((steps[si].getAttribute('data-tool-name') || '') === String(evt.tool_name || '')) {
                matchStep = steps[si];
                break;
              }
            }
            if (!matchStep) {
              matchStep = el('div', { class: 'ai-tool-step' });
              matchStep.setAttribute('data-tool-name', String(evt.tool_name || ''));
              matchStep.appendChild(el('span', { class: 'ai-tool-step-icon', text: evt.success ? '✅' : '⚠️' }));
              var mbody = el('div', { class: 'ai-tool-step-body' });
              mbody.appendChild(el('div', { class: 'ai-tool-step-title', text: label }));
              mbody.appendChild(el('div', { class: 'ai-tool-step-status', text: evt.success ? '完成' : '失败' }));
              matchStep.appendChild(mbody);
              toolBar2.appendChild(matchStep);
            } else {
              matchStep.classList.remove('is-running');
              matchStep.classList.add(evt.success ? 'is-done' : 'is-error');
              var iconEl = matchStep.querySelector('.ai-tool-step-icon');
              if (iconEl) iconEl.textContent = evt.success ? '✅' : '⚠️';
              var stEl = matchStep.querySelector('.ai-tool-step-status');
              if (stEl) stEl.textContent = evt.success ? '完成' : '失败';
            }
            var resultCard = el('div', { class: 'ai-tool-result-card' });
            resultCard.appendChild(el('div', { class: 'ai-tool-result-card-title', text: summaryText }));
            toolBar2.appendChild(resultCard);
            // Expandable result list attaches to the result card
            toolBar2 = resultCard;
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
                var linkEl2 = el('a', { class: 'ai-search-detail-title', href: safeSearchUrl(r2.url) || '#', target: '_blank', rel: 'noopener noreferrer', text: r2.title || '无标题' });
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
            hideAssistantTyping();
            var errMsg = evt.error || 'AI 调用失败';
            
            if (aiContent) {
              // 已有部分回复，保留内容并追加错误提示
              var errNote = el('div', { class: 'ai-error-note' }, errMsg);
              try { assistantNode.appendChild(errNote); } catch (e) {}
              ensureAssistantBubbleReady();
              finishAiMessage(assistantNode, aiContent, aiReasoning, evt);
            } else {
              // 没有内容，回退
              notify(errMsg);
              try { assistantNode.remove(); } catch (e) {}
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
            hideAssistantTyping();
            var errMsg2 = evt.error || 'AI 调用失败';
            
            if (aiContent) {
              var errNote2 = el('div', { class: 'ai-error-note' }, errMsg2);
              try { assistantNode.appendChild(errNote2); } catch (e) {}
              finishAiMessage(assistantNode, aiContent, aiReasoning, evt);
            } else {
              notify(errMsg2);
              try { assistantNode.remove(); } catch (e) {}
              S.messages.pop();
              removeLastUserMessage(messagesEl);
              restoreInputText();
            }
            
            resetSendingIfCurrent();
            if (reader) try { reader.cancel(); } catch (e) {}
            aborted = true;
            break;
          }
          
          if (evt.type === 'reasoning_start' && !reasoningStarted) {
            reasoningStarted = true;
            // C 修复：用户关闭思考时，仅记录状态、不创建/渲染思考节点
            if (S.thinkingMode === 'off') continue;
            var rnStart = ensureReasoningNode();
            if (rnStart) setThinkingExpanded(rnStart, true, messagesEl);
            ensureThinkingTimer();
            continue;
          }
          
          if (evt.type === 'reasoning') {
            // ★ 修复 M8：思考文本无限累积会导致内存膨胀与收尾一次性渲染卡顿。
            // 设 200k 字符上限（深页已有 4000/次切片与上限，普通聊天此前无上限）。
            var chunkText = String(evt.text || '');
            if (aiReasoning.length < 200000) {
              var room = 200000 - aiReasoning.length;
              aiReasoning += room > 0 ? chunkText.slice(0, room) : '';
            }
            // C 修复：用户关闭思考时，跳过流式渲染（仅静默累积，收尾由 finishAiMessage 统一隐藏）
            if (S.thinkingMode === 'off') continue;
            // 如果 reasoning_start 事件丢失，首次收到 reasoning 也启动计时器
            if (!reasoningStarted) {
              reasoningStarted = true;
              ensureReasoningNode();
              ensureThinkingTimer();
            }
            var rn = ensureReasoningNode();
            // 流式思考过程中强制展开，避免「只见标题、要等回复结束才能看内容」
            if (rn && !rn.classList.contains('expanded')) {
              setThinkingExpanded(rn, true, messagesEl);
            }
            var body = rn.querySelector('.ai-thinking-body');
            if (body) {
              if (!reasoningRenderer) {
                body.textContent = '';
                reasoningRenderer = createSmoothTextRenderer(body, {
                minChunk: 6,
                maxChunk: 48,
                charsPerMs: 2.6,
                plainStream: true,
                onRender: function() {
                  scrollToBottom(messagesEl, false);
                }
              });
              }
              reasoningRenderer.append(evt.text || '');
            }
            continue;
          }
          
          if (evt.type === 'content') {
            if (S.responseProfile === 'enhanced') {
              var answerStage = assistantNode.querySelector('.ai-enhanced-status');
              if (answerStage) { answerStage.textContent = '正在组织回答…'; answerStage.setAttribute('data-stage', 'answer'); }
            }
            var contentChunk = evt.text || '';
            if (!contentChunk) continue;
            aiContent += contentChunk;
            ensureAssistantBubbleReady();
            if (contentRenderer) contentRenderer.append(contentChunk);
            continue;
          }
          
          if (evt.type === 'done') {
            hideAssistantTyping();
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
              finalThinkingMode = evt.thinking_mode || evt.applied_thinking_mode || S.thinkingMode;
              // sanitized_content 优先：后端清洗后的正文
              if (evt.sanitized_content) {
                aiContent = evt.sanitized_content;
              } else if (evt.content) {
                aiContent = evt.content;
              }
              // 搜索路径若流式 reasoning 丢失，done 包里仍可能带完整 reasoning
              if ((!aiReasoning || !String(aiReasoning).trim()) && evt.reasoning) {
                aiReasoning = String(evt.reasoning);
              }
            } catch (e) {}
            
            var _sanitizedRendered = false;
            if (evt.sanitized_content && evt.sanitized_content.length > 0 && assistantBubble) {
              // P4 修复: 只有当 sanitized_content 与当前内容不同时才重绘
              var currentText = (assistantBubble.textContent || '').trim();
              var sanitizedTrimmed = (evt.sanitized_content || '').trim();
              if (currentText !== sanitizedTrimmed) {
                if (contentRenderer) {
                  try { contentRenderer.cancel(); } catch (e) {}
                  contentRenderer = null;
                }
                // 使用 DocumentFragment 避免空白闪烁
                var frag = document.createDocumentFragment();
                var tmpDiv = el('div');
                tmpDiv.innerHTML = renderMarkdown(evt.sanitized_content);
                while (tmpDiv.firstChild) frag.appendChild(tmpDiv.firstChild);
                assistantBubble.innerHTML = '';
                assistantBubble.appendChild(frag);
                _sanitizedRendered = true;
              }
            }
            
            var streamInterrupted = evt.interrupted === true;
            var streamComplete = evt.complete === true;
            var streamSaved = evt.saved === true;
            
            if (assistantNode) {
              ensureAssistantBubbleReady();
              finishAiMessage(assistantNode, aiContent, aiReasoning, evt);
            }
            // Attachments are single-use: remove the preview only after a
            // successful terminal event; errors and aborts remain retryable.
            consumeAiAttachment(fileData);
            
            // 中断/未保存提示
            if (streamInterrupted && aiContent) {
              var interrNote = el('div', { class: 'ai-interrupt-note' }, '回复中断，内容可能不完整');
              if (assistantNode) {
                assistantNode.appendChild(interrNote);
                try { attachContinueGenerateBtn(assistantNode, messagesEl); } catch (eCont) {}
              }
            }
            if (!streamSaved && aiContent) {
              var saveNote = el('div', { class: 'ai-save-note' }, '本次回复未保存，刷新后可能丢失');
              if (assistantNode) assistantNode.appendChild(saveNote);
            }
            
            // 显示清洗提示
            if (evt.filtered && aiContent) {
              var filteredNote = el('div', { class: 'ai-filtered-note' }, '已自动清理动作描述');
              if (assistantNode) assistantNode.appendChild(filteredNote);
            }
            
            doneReceived = true;
            evtHandled = true;
            if (sharedCtrl) {
              sharedCtrl.done();
              if (telemetry) {
                if (evt.usage) telemetry.recordUsage(evt.usage);
                telemetry.finalize('done');
              }
            }
            break;
          }
        }
        
        if (doneReceived || aborted) break;
      }
      
      try { clearInterval(_idleCheckTimer); } catch (e) {}

      // H-25: 45s 无数据超时 — 清理节点、复位状态并提示，避免永久"处理中"
      if (timedOut) {
        cleanupRenderers();
        hideAssistantTyping();
        if (aiContent) {
          var timeoutNote = el('div', { class: 'ai-error-note' }, '响应超时（45 秒未收到数据），已保留部分回复');
          try { assistantNode.appendChild(timeoutNote); } catch (e) {}
          finishAiMessage(assistantNode, aiContent, aiReasoning, null);
          try { attachContinueGenerateBtn(assistantNode, messagesEl); } catch (eC1) {}
        } else {
          try { assistantNode.remove(); } catch (e) {}
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          notify('AI 响应超时（45 秒未收到数据），请重试');
        }
        resetSendingIfCurrent();
        return;
      }

      if ((S._currentReqId !== reqId || aborted) && !_finalized) {
        // 被新请求取代，删除当前创建的任何节点
        // ★ 修复：若 error 事件已 finishAiMessage（_finalized=true，部分回复已保留并写入
        // S.messages），不得再删除节点，否则已渲染的回复会闪现后消失且服务端未保存。
        cleanupRenderers();
        if (assistantNode) try { assistantNode.remove(); } catch (e) {}
        hideAssistantTyping();
        resetSendingIfCurrent();
        return;
      }
      
      // 完成处理
      hideAssistantTyping();
      
      if (evtHandled) {
        // 已在 done/error 事件中完成渲染
      } else if (assistantNode && (aiContent || aiReasoning)) {
        finishAiMessage(assistantNode, aiContent, aiReasoning, null);
      } else if (doneReceived) {
        cleanupRenderers();
      } else if (!doneReceived) {
        cleanupRenderers();
        try { assistantNode.remove(); } catch (e) {}
        S.messages.pop();
        removeLastUserMessage(messagesEl);
        restoreInputText();
        // 流意外结束且未收到任何内容：多半是连接被代理/网络切断（而非 AI 拒绝回答）。
        // 用户消息已回填输入框，可直接重发。
        notify('AI 连接中断或长时间未响应，请重试');
      }
    } catch (fetchErr) {
      if (S._currentReqId !== reqId) { try { clearInterval(_idleCheckTimer); } catch (e) {} return; }
      try { clearInterval(_idleCheckTimer); } catch (e) {}
      // H-25: 超时中止触发的 AbortError 也走超时清理，避免被误判为"用户主动停止"
      if (timedOut) {
        cleanupRenderers();
        hideAssistantTyping();
        if (aiContent) {
          var timeoutNote2 = el('div', { class: 'ai-error-note' }, '响应超时（45 秒未收到数据），已保留部分回复');
          try { assistantNode.appendChild(timeoutNote2); } catch (e) {}
          finishAiMessage(assistantNode, aiContent, aiReasoning, null);
        } else {
          try { assistantNode.remove(); } catch (e) {}
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          notify('AI 响应超时（45 秒未收到数据），请重试');
        }
        resetSendingIfCurrent();
        return;
      }
      // 网络错误或 abort
      if (fetchErr && fetchErr.name !== 'AbortError') {
        hideAssistantTyping();
        if (aiContent) {
          // 已有部分回复，保留并提示连接中断
          var connNote = el('div', { class: 'ai-error-note' }, '连接中断，已保留部分回复');
          try { assistantNode.appendChild(connNote); } catch (e) {}
          finishAiMessage(assistantNode, aiContent, aiReasoning, null);
          try { attachContinueGenerateBtn(assistantNode, messagesEl); } catch (eC2) {}
        } else {
          try { assistantNode.remove(); } catch (e) {}
          S.messages.pop();
          removeLastUserMessage(messagesEl);
          restoreInputText();
          // Phase 3: Use shared error classification
          var netErrMsg = '网络连接异常，请检查网络后重试';
          if (window.XtjAiCore && window.XtjAiCore.Errors && window.XtjAiCore.RequestController && window.XtjAiCore.RequestController.FEATURE_FLAG) {
            var netClassified = window.XtjAiCore.Errors.classify(fetchErr, { phase: 'stream_read', requestId: reqId });
            netErrMsg = netClassified.message;
          }
          notify(netErrMsg);
        }
        if (sharedCtrl) {
          sharedCtrl.error('stream_read_error');
          if (telemetry) { telemetry.finalize('error', { code: 'STREAM_INTERRUPTED', phase: 'stream_read', message: String(fetchErr && fetchErr.message || '') }); }
        }
      } else {
        // AbortError: 用户主动停止
        if (sharedCtrl) {
          sharedCtrl.cancel('user_cancelled');
          if (telemetry) { telemetry.finalize('cancelled', { code: 'REQUEST_CANCELLED', phase: 'stream_read', message: '用户取消' }); }
        }
        if (aiContent) {
          finishAiMessage(assistantNode, aiContent, aiReasoning, null);
        } else {
          hideAssistantTyping();
          try { if (assistantNode) assistantNode.remove(); } catch (eAbortNode) {}
          S.messages.pop();
          removeLastUserMessage(messagesEl);
        }
      }
    }
    
    if (sharedCtrl) {
      window.XtjAiCore.RequestController.unregisterInFlight('cat_ai', sharedCtrl);
      sharedCtrl.dispose();
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
    var loadController = typeof AbortController === 'function' ? new AbortController() : null;
    // ★ 修复：历史加载使用独立 controller，不得覆盖 S.abortController——
    // 否则流式发送中滚动加载历史会把发送请求的停止能力（停止按钮）指向已完成的加载请求。
    S.historyController = loadController;

    var hasCache = false;
    if (!before && messagesEl) {
      messagesEl.setAttribute('aria-busy', 'true');
      var cachedData = getAiHistoryCache(S.conversationId);
      var cachedMsgs = cachedData && cachedData.messages;
      
      if (cachedMsgs && Array.isArray(cachedMsgs) && cachedMsgs.length > 0) {
        hasCache = true;
        S.messages = cachedMsgs;
        messagesEl.innerHTML = '';
        var frag = document.createDocumentFragment();
        cachedMsgs.forEach(function(m) { frag.appendChild(buildMessageNode(m, messagesEl)); });
        messagesEl.appendChild(frag);
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
      } else if (!messagesEl.children.length || messagesEl.querySelector('.ai-history-unavailable')) {
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
      // 历史接口偶发慢/弱网：超时放宽并做一次静默重试，减少「缓存记录，刷新失败」误报
      var r = await apiRequest('GET', '/chat/history' + qs, null, { timeoutMs: 15000, abortController: loadController });
      if ((!r.ok || !r.data) && !before && r && r.error_code !== 'aborted') {
        var canRetry = r.status === 0 || r.error_code === 'timeout' || r.error_code === 'network_error' || (r.status >= 500);
        if (canRetry && requestId === S.historyRequestId) {
          try {
            await new Promise(function(resolve) { setTimeout(resolve, 400); });
            if (requestId === S.historyRequestId && (!loadController || !loadController.signal || !loadController.signal.aborted)) {
              r = await apiRequest('GET', '/chat/history' + qs, null, { timeoutMs: 18000, abortController: loadController });
            }
          } catch (eRetry) {}
        }
      }

      if (requestId !== S.historyRequestId || requestedConversationId !== S.conversationId || messagesEl !== S.messagesEl || !S.active) return;

      if (!r.ok || !r.data) {
        if (!before) {
          try { console.warn('[AI] loadHistory failed:', r.status, r.error, r.error_code); } catch (e) {}
          // 已有缓存时：仅在真正失败后提示；中止请求不刷横幅
          if (r.error_code === 'aborted') {
            removeHistoryUnavailableBanner(messagesEl);
          } else {
            renderHistoryUnavailable(messagesEl, r, { preserveExistingMessages: hasCache });
          }
        }
        return;
      }

      removeHistoryUnavailableBanner(messagesEl);

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
        var remKey = getAiHistoryCacheKey(S.conversationId);
        if (remKey) { try { sessionStorage.removeItem(remKey); } catch (e) {} }
        return;
      }

      if (!before) {
        S.messages = msgs;
        messagesEl.innerHTML = '';
        var frag = document.createDocumentFragment();
        msgs.forEach(function(m) { frag.appendChild(buildMessageNode(m, messagesEl)); });
        messagesEl.appendChild(frag);
        S.autoScrollPinned = true;
        scrollToBottom(messagesEl, true);
        try {
          setAiHistoryCache(S.conversationId, msgs);
        } catch (e) {}
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
      S.loading = false;
      S.loadingMore = false;
      if (S.historyController === loadController) S.historyController = null;
      if (!before && messagesEl) messagesEl.removeAttribute('aria-busy');
    }
  }

  // 获取会话列表（普通聊天只显示普通会话，深度研究会话分开管理）
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
          // ★ 修复：同步清除本地记录的上次会话 id，避免刷新后
          // 用已软删除的旧会话继续发消息（写入被删会话）
          if (typeof writeConvId === 'function') { try { writeConvId(null); } catch (_) {} }
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
    if (!cid) return;
    if (cid === S.conversationId && S.messages.length > 0) return;
    abortCurrentRequest();
    removeHistoryUnavailableBanner(S.messagesEl);
    
    S.historyRequestId += 1;
    S.loading = false;
    S.loadingMore = false;
    S.conversationId = cid;
    writeConvId(cid);
    S.messages = [];
    S.oldestCursor = null;
    S.hasMore = false;
    if (S.messagesEl) {
      S.messagesEl.innerHTML = '';
      removeHistoryUnavailableBanner(S.messagesEl);
    }
    showChatMessages();
    if (S.messagesEl) {
      S.loading = false;
      S.loadingMore = false;
      await loadHistory(S.messagesEl, null);
    }
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
        // Pending attachments belong to the current conversation only.
        _aiChatFileData = null;
        if (filePreview) { filePreview.style.display = 'none'; filePreview.innerHTML = ''; }
        if (fileInput) fileInput.value = '';
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
      // ★ 修复 M2：历史会话列表页（messagesEl display:none）或 hasMore 残留时
      // 不得触发历史分页加载，避免拼接错乱/误拉取。offsetParent 为 null 表示元素不可见。
      if (S.showingHistory || !messagesEl.offsetParent) return;
      if (messagesEl.scrollTop < 60 && S.hasMore && !S.loading && !S.loadingMore && S.oldestCursor) {
        loadHistory(messagesEl, S.oldestCursor);
      }
    }));
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

    // ★ P0-1 修复: 状态初始化已在 S 对象声明时通过 resolveInitial* 完成一次。
    //   此处仅恢复 web_search（因其默认 false 且未在 S 声明中读取 localStorage）。
    //   不再重复赋值 selectedModel / thinkingMode，避免后端 config 到达前的二次覆盖。
    //   后端配置优先级由 applyConfigToUI 保证。
    try {
      var savedWebSearch = localStorage.getItem('xtj_ai_web_search');
      S.webSearchEnabled = savedWebSearch === 'true';
    } catch (e) {}

    // + 菜单：自定义一级面板
    // - Win 原生 <select> 会空弹/闪退；系统列表也无法「选完不关」
    // - 全部选项平铺在一页：上传 / 模型 / 思考程度 / 网页搜索
    // - 模型、思考、搜索切换后菜单保持打开，方便连续设置
    var modelLabels = {
      'deepseek-v4-flash': 'V4 Flash',
      'deepseek-v4-pro': 'V4 Pro'
    };
    var thinkLabels = { off: '关闭', low: '轻度', medium: '中度', high: '深度', max: '极致' };

    var plusBtn = el('button', {
      type: 'button',
      class: 'ai-plus-btn',
      id: 'aiPlusBtn',
      'aria-label': '更多选项',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-controls': 'aiPlusPanelShell',
      title: '上传文件、模型、思考程度、网页搜索'
    });
    plusBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    var panelShell = el('div', {
      class: 'ai-plus-panel-shell',
      id: 'aiPlusPanelShell',
      role: 'menu',
      'aria-label': '更多选项'
    });
    panelShell.innerHTML =
      '<div class="ai-plus-panel-content">' +
        '<div class="ai-panel-page is-active" id="aiPanelPrimary" data-page="primary">' +
          '<button type="button" class="ai-panel-option" role="menuitem" data-action="upload">' +
            '<span class="ai-panel-option-icon" aria-hidden="true">📎</span>' +
            '<span class="ai-panel-option-text">上传文件</span>' +
          '</button>' +
          '<div class="ai-panel-separator" role="separator"></div>' +
          '<div class="ai-panel-section-label">模型</div>' +
          '<div class="ai-panel-options-group" role="radiogroup" aria-label="选择模型">' +
            '<button type="button" class="ai-panel-option" role="radio" data-model="deepseek-v4-flash" aria-checked="false">' +
              '<span class="ai-panel-option-body">' +
                '<span class="ai-panel-option-label">DeepSeek V4 Flash</span>' +
                '<span class="ai-panel-option-desc">速度更快，适合日常聊天</span>' +
              '</span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-model="deepseek-v4-pro" aria-checked="false">' +
              '<span class="ai-panel-option-body">' +
                '<span class="ai-panel-option-label">DeepSeek V4 Pro</span>' +
                '<span class="ai-panel-option-desc">能力更强，适合复杂任务</span>' +
              '</span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
          '</div>' +
          '<div class="ai-panel-separator" role="separator"></div>' +
          '<div class="ai-panel-section-label">思考程度（同页直选，无二级菜单）</div>' +
          '<div class="ai-panel-options-group" role="radiogroup" aria-label="选择思考程度">' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="off" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">关闭</span><span class="ai-panel-option-desc">不展示思考过程，回复更快</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="low" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">轻度</span><span class="ai-panel-option-desc">简单推理</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="medium" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">中度</span><span class="ai-panel-option-desc">日常问题默认推荐</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="high" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">深度</span><span class="ai-panel-option-desc">更仔细的分析</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="max" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">极致</span><span class="ai-panel-option-desc">最强推理，耗时更长</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
          '</div>' +
          '<div class="ai-panel-separator" role="separator"></div>' +
          '<button type="button" class="ai-panel-option ai-panel-option-toggle" role="menuitemcheckbox" data-action="search" aria-checked="false">' +
            '<span class="ai-panel-option-icon" aria-hidden="true">🌐</span>' +
            '<span class="ai-panel-option-text">网页搜索</span>' +
            '<span class="ai-search-status" id="aiSearchStatus">关</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    var panelOpen = false;
    var panelClosing = false;
    var closeTimer = null;

    function updateModelUI() {
      var radios = panelShell.querySelectorAll('[data-model]');
      for (var i = 0; i < radios.length; i++) {
        var on = radios[i].getAttribute('data-model') === S.selectedModel;
        radios[i].setAttribute('aria-checked', on ? 'true' : 'false');
        radios[i].classList.toggle('is-selected', on);
      }
    }
    function updateThinkUI() {
      var radios = panelShell.querySelectorAll('[data-think]');
      for (var i = 0; i < radios.length; i++) {
        var on = radios[i].getAttribute('data-think') === S.thinkingMode;
        radios[i].setAttribute('aria-checked', on ? 'true' : 'false');
        radios[i].classList.toggle('is-selected', on);
      }
    }
    function updateSearchStatus() {
      var st = panelShell.querySelector('#aiSearchStatus');
      var btn = panelShell.querySelector('[data-action="search"]');
      if (st) {
        st.textContent = S.webSearchEnabled ? '开' : '关';
        st.classList.toggle('on', !!S.webSearchEnabled);
      }
      if (btn) {
        btn.setAttribute('aria-checked', S.webSearchEnabled ? 'true' : 'false');
        btn.classList.toggle('is-selected', !!S.webSearchEnabled);
      }
      if (plusBtn) {
        if (S.webSearchEnabled) plusBtn.classList.add('ws-on');
        else plusBtn.classList.remove('ws-on');
      }
    }

    function positionPanel() {
      if (!plusBtn || !panelShell || !panelShell.parentNode) return;
      var btnRect = plusBtn.getBoundingClientRect();
      var bar = panelShell.parentNode.getBoundingClientRect();
      var panelW = Math.min(288, Math.max(240, bar.width - 16));
      panelShell.style.width = panelW + 'px';
      var left = btnRect.left - bar.left + btnRect.width / 2 - 24;
      var maxLeft = Math.max(8, bar.width - panelW - 8);
      if (left > maxLeft) left = maxLeft;
      if (left < 8) left = 8;
      panelShell.style.left = left + 'px';
      panelShell.style.right = 'auto';
      var originX = Math.round(btnRect.left + btnRect.width / 2 - bar.left - left);
      panelShell.style.transformOrigin = originX + 'px 100%';
    }

    function openPanel() {
      if (panelOpen || panelClosing) return;
      panelOpen = true;
      updateModelUI();
      updateThinkUI();
      updateSearchStatus();
      positionPanel();
      panelShell.classList.remove('is-closing', 'open');
      panelShell.classList.add('is-opening');
      plusBtn.classList.add('active');
      plusBtn.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (!panelOpen) return;
          panelShell.classList.add('open');
        });
      });
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(function() {
        panelShell.classList.remove('is-opening');
        closeTimer = null;
      }, 320);
    }

    function closePanel(animate) {
      if (!panelOpen || panelClosing) return;
      panelClosing = true;
      panelOpen = false;
      panelShell.classList.remove('is-opening');
      panelShell.classList.add('is-closing');
      panelShell.classList.remove('open');
      plusBtn.classList.remove('active');
      plusBtn.setAttribute('aria-expanded', 'false');
      if (animate === false) {
        panelShell.classList.remove('is-closing');
        panelClosing = false;
        return;
      }
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(function() {
        panelShell.classList.remove('is-closing');
        panelClosing = false;
        closeTimer = null;
      }, 280);
    }

    plusBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (panelOpen) closePanel();
      else openPanel();
    });

    panelShell.addEventListener('click', function(e) {
      e.stopPropagation();
      var t = e.target.closest('[data-action], [data-model], [data-think]');
      if (!t) return;

      var action = t.getAttribute('data-action');
      if (action === 'upload') {
        closePanel();
        setTimeout(function() {
          var fi = document.getElementById('aiChatFileInp');
          if (fi) fi.click();
        }, 50);
        return;
      }
      if (action === 'search') {
        S.webSearchEnabled = !S.webSearchEnabled;
        try { localStorage.setItem('xtj_ai_web_search', S.webSearchEnabled ? 'true' : 'false'); } catch (err) {}
        updateSearchStatus();
        notify(S.webSearchEnabled ? '网页搜索已开启' : '网页搜索已关闭');
        // 保持菜单打开，方便继续改模型/思考
        return;
      }

      var model = t.getAttribute('data-model');
      if (model) {
        if (model !== S.selectedModel) {
          S.selectedModel = model;
          S._userPickedModel = true;
          try { localStorage.setItem('xtj_ai_model', model); } catch (err) {}
          notify('模型：' + (modelLabels[model] || model));
        }
        updateModelUI();
        return;
      }

      var think = t.getAttribute('data-think');
      if (think) {
        if (think !== S.thinkingMode) {
          S.thinkingMode = think;
          S._userPickedThinkingMode = true;
          try { localStorage.setItem('xtj_ai_thinking_mode', think); } catch (err) {}
          notify('思考程度：' + (thinkLabels[think] || think));
        }
        updateThinkUI();
      }
    });

    var panelAbortController = new AbortController();
    document.addEventListener('click', function(e) {
      if (!panelOpen) return;
      if (panelShell.contains(e.target) || plusBtn.contains(e.target) || e.target === plusBtn) return;
      closePanel();
    }, { signal: panelAbortController.signal });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelOpen) closePanel();
    }, { signal: panelAbortController.signal });
    window.addEventListener('resize', function() {
      if (panelOpen) positionPanel();
    }, { signal: panelAbortController.signal, passive: true });

    S._panelAbortController = panelAbortController;
    S._panelCleanup = function() {
      try { panelAbortController.abort(); } catch (e) {}
      if (closeTimer) clearTimeout(closeTimer);
      panelOpen = false;
      panelClosing = false;
    };

    updateModelUI();
    updateThinkUI();
    updateSearchStatus();
    var inputBar = el('div', { class: 'ai-chat-input-bar' });
    inputBar.id = 'aiChatInputBar';
    // 文件上传按钮 (隐藏，通过 + 面板触发)
    var fileBtn = el('button', {
      type: 'button',
      class: 'ai-chat-file-btn',
      id: 'aiChatFileBtn',
      'aria-label': '上传文件',
      title: '上传图片或文件',
      style: 'display:none'
    });
    fileBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
    var fileInput = el('input', { type: 'file', id: 'aiChatFileInp', accept: 'image/*,.pdf,.docx,.txt,.csv,.xlsx', style: 'display:none' });
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
      if (fileData) {
        fileData.onSuccess = function() {
          if (_aiChatFileData !== fileData) return;
          _aiChatFileData = null;
          filePreview.style.display = 'none';
          filePreview.innerHTML = '';
          fileInput.value = '';
        };
      }
            handleSendMessage(input, sendBtn, messagesEl, fileData);
    }
    sendBtn.addEventListener('click', doSend);
    pauseBtn.addEventListener('click', function() {
      if (!S.sending && !S.paused) return;
      var anyPaused = S.activeRenderers && S.activeRenderers.some(function(r) { return r.isPaused && r.isPaused(); });
      if (anyPaused) {
        // 恢复渲染
        if (S.activeRenderers) S.activeRenderers.forEach(function(r) { if (r.resume) r.resume(); });
        S.paused = false;
        pauseBtn.textContent = '暂停';
      } else {
        // H-24: 真"暂停" — 只暂停渲染器，不中止 SSE 请求。
        // 旧逻辑在此 abort 请求会永久丢失 AI 回复，且 S.sending 置 false 后"继续"按钮被卡死。
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
      if (!isSupportedAiFile(f)) { notify('仅支持图片、PDF、DOCX、TXT、CSV 和 XLSX 文件'); this.value = ''; return; }
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

    inputBar.appendChild(plusBtn);
    inputBar.appendChild(panelShell);
    inputBar.appendChild(fileBtn);
    inputBar.appendChild(fileInput);
    inputBar.appendChild(filePreview);
    inputBar.appendChild(input);
    inputBar.appendChild(sendBtn);
    inputBar.appendChild(pauseBtn);
    root.appendChild(inputBar);

    S.resizeTimer = setTimeout(autoresize, 0);

    // ★ M: 渲染后立即同步深度思考 toggle 视觉
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
    // ★ M: 恢复深度思考模式状态
    restoreDeepThinkState();
    S.active = true;
    var lifecycleId = ++S.lifecycleId;
    window.__xtjAiChatActive = true;
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

    // Do not make opening the chat wait for an auth refresh. The shell is useful immediately.
    ensureUserAuthOrNotify().then(function(authOk) {
      if (lifecycleId !== S.lifecycleId || !S.active) return null;
      if (!authOk) {
        S.active = false;
        window.__xtjAiChatActive = false;
        renderHistoryUnavailable(r.messagesEl, { status: 401, error_code: 'auth' });
        return null;
      }
      return Promise.allSettled([
        ensureConfig().then(function(cfg) {
          if (lifecycleId === S.lifecycleId && S.active) applyConfigToUI(cfg);
        }),
        loadHistory(r.messagesEl, null),
        // 打开面板时预拉取会话列表，修复"历史对话"点开后才加载、易误判为列表消失的问题
        fetchConversations().catch(function(e) {
          try { console.warn('[AI-CONV] 预拉取会话列表失败:', e && e.message); } catch (ee) {}
        })
      ]);
    }).then(function() {
      if (lifecycleId !== S.lifecycleId || !S.active || r.messagesEl !== S.messagesEl) return;
      setTimeout(function() {
        try { r.input.focus(); } catch (e) {}
        updateInputMetrics();
      }, 80);
    });
  }

  function applyConfigToUI(cfg) {
    if (!cfg) return;
    var avatarEl = document.getElementById('aiChatHeaderAvatar');
    var nameEl = document.getElementById('aiChatHeaderName');
    if (avatarEl) renderHeaderAvatar(avatarEl, cfg.avatar_url, cfg.avatar_version);
    if (nameEl) nameEl.textContent = AI_DISPLAY_NAME;
    updateAiStatus();

    var inp = document.getElementById('aiChatMsgInput');
    if (inp) inp.placeholder = '和 ' + AI_DISPLAY_NAME + ' 说点什么吧…';

    var empty = document.querySelector('#aiChatRoot .ai-chat-empty');
    if (empty) {
      var e1 = empty.querySelector('.ai-chat-empty-emoji');
      if (e1) renderCatAvatarNode(e1, 'ai-chat-empty-avatar', S.config && S.config.avatar_url, S.config && S.config.avatar_version);
      var e2 = empty.querySelector('.ai-chat-empty-title');
      if (e2) e2.textContent = '和 ' + AI_DISPLAY_NAME + ' 聊聊天';
      var e3 = empty.querySelector('.ai-chat-empty-tip');
      if (e3) e3.textContent = cfg.welcome_message || '嗨，来聊天吧。';
    }

    // ★ P0-1 修复: 同步后端思考程度配置。
    //   优先级：后端配置 > localStorage > 默认值（仅作用于"首次加载"或"配置版本变更"）。
    //   一旦用户通过 UI 显式选择思考程度，则用户选择优先，避免 config 定时刷新
    //   把用户选择重置回后端默认值。
    try {
      if (cfg.deep_think) {
        if (['low', 'medium', 'high', 'max'].indexOf(cfg.deep_think.default_thinking_mode) >= 0) {
          S.deepThinkEffort = cfg.deep_think.default_thinking_mode;
        }
        S.deepThinkEnabled = cfg.deep_think.enabled !== false;
        // ★ Tavily Deep Research: 同步后端配置 (config.tavily_research.enabled)
        S.tavilyResearchEnabled = !!(cfg.tavily_research && cfg.tavily_research.enabled);
      }
      var cfgVer = (cfg && cfg.config_version) || 0;
      var backendDefaultMode = cfg.model && cfg.model.default_thinking_mode;
      var backendModeValid = backendDefaultMode && ALLOWED_THINKING_MODES.indexOf(backendDefaultMode) >= 0;
      // 仅在 (a) 首次应用配置 或 (b) 配置版本变化 且 用户未在本轮显式选择 时，才用后端默认覆盖
      if (backendModeValid && cfgVer !== S._lastConfigVersion && !S._userPickedThinkingMode) {
        S.thinkingMode = backendDefaultMode;
        try { localStorage.setItem('xtj_ai_thinking_mode', backendDefaultMode); } catch (e3) {}
      }
    } catch (e) { /* 容错 */ }

    // ★ P 新增: 如果后端禁用了深度思考，强制关闭 toggle
    if (!S.deepThinkEnabled && S.deepThink) {
    S.deepThink = false;
    try { localStorage.setItem('xtj_ai_deep_think', '0'); } catch (e) {}
      try { refreshDeepThinkToggle(); } catch (e) {}
    }
  }

  function closeAiChat() {
    var activePanel = document.getElementById('panelAiChat');
    var panelIsVisible = !!(activePanel && activePanel.classList.contains('active') && !activePanel.classList.contains('hidden'));
    if (!S.active && !panelIsVisible) return;
    S.active = false;
    S.lifecycleId += 1;
    S.historyRequestId += 1;
    S.conversationRequestId += 1;
    window.__xtjAiChatActive = false;
    clearReplyTimer();
    // 页面级关闭：完整清理主聊天 + 深度思考两套状态
    abortAllAiRequests();
    // 关闭深度思考二级页面，避免它残留在普通聊天之中
    // Clean up deep think state
    if (S.deepThinkProgressCard) {
      try { if (S.deepThinkProgressCard._cleanupTimer) S.deepThinkProgressCard._cleanupTimer(); } catch (e) {}
    }
    // ★ U3 Bug 4 修复: 不再重置 S.deepThink, 保持用户的 toggle 偏好
    S.deepThinkJob = null;
    S.deepThinkProgressCard = null;
    // 重置所有状态，避免重开后残留
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
    // P0-4: 释放加号面板的所有 document/window/visualViewport 监听与计时器
    if (S._panelCleanup) {
      try { S._panelCleanup(); } catch (ePanel) {}
      S._panelCleanup = null;
      S._panelAbortController = null;
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

    var cfg = S.config || { avatar: '🐈', description: '小猫 智能体' };
    var name = AI_DISPLAY_NAME;
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

  function scheduleInsertEntry() {
    // AI is launched only from the homepage tools menu. This keeps cached
    // chat-list DOM from retaining the retired AI pseudo-contact.
    removeAllAiEntries();
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
      // 切换出聊天 tab 时一并关闭深度思考二级页面
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
