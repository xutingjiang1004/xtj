// ==================== AI Core: Markdown Renderer ====================
// Shared safe Markdown rendering for both Cat AI and Code workspace.
// Blocks: script, iframe, object, embed, form, onclick/onerror/onload, style injection, javascript: links.
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};

  // ── HTML Sanitization ──────────────────────────────────────────────────
  var _escapeHtml = window.escapeHtml || function (s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  var BLOCKED_TAGS_RE = /<\s*(\/)?\s*(script|iframe|object|embed|form|input|button|select|textarea|keygen|style|link|meta|base|applet|frame|frameset|ilayer|layer|bgsound|title|head|html|body|svg|math|details|summary|video|audio|source|template|noscript|xmp|plaintext|noembed|noframes)\b/gi;
  var BLOCKED_TAGS_SET = { script:1, iframe:1, object:1, embed:1, form:1, input:1, button:1, select:1, textarea:1, keygen:1, style:1, link:1, meta:1, base:1, applet:1, frame:1, frameset:1, ilayer:1, layer:1, bgsound:1, title:1, head:1, html:1, body:1, svg:1, math:1, details:1, summary:1, video:1, audio:1, source:1, template:1, noscript:1, xmp:1, plaintext:1, noembed:1, noframes:1 };
  // 事件处理属性 + style + srcdoc/formaction（防全屏钓鱼与零点击 XSS）；首组捕获保留边界字符；
  // 未引号属性值放开 /、=、&，防止 onerror=/**/alert(1)// 等绕过。
  var BLOCKED_ATTRS_RE = /(^|[\s"'>\/])(?:on[a-z0-9_]*|style|srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+)/gi;
  // 实体编码的事件属性名（onerror → &#111;nerror）
  var BLOCKED_ATTRS_ENTITY_RE = /(^|[\s"'>\/])((?:&#x?[0-9a-f]+;)+)[a-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+)/gi;

  // 危险协议检测由 sanitizeHtml 中对解码后 URL 用 new URL(...).protocol 白名单判定
  // （http/https/mailto，另放行 data:image 非 svg），覆盖 jav&#x61;script:、
  // java&#x09;script:、data:text/html 等实体编码/空白分隔绕过。
  var _decodeTa = null;
  function decodeHtmlEntities(str) {
    if (!str) return '';
    var input = String(str);
    // 走浏览器原生解码：完整支持数字/命名实体（&#x61;、&colon; 等），RCDATA 下不执行标签
    try {
      if (!_decodeTa && typeof document !== 'undefined' && document.createElement) {
        _decodeTa = document.createElement('textarea');
      }
      if (_decodeTa) {
        _decodeTa.innerHTML = input;
        if (typeof _decodeTa.value === 'string') return _decodeTa.value;
      }
    } catch (_) {}
    return input
      .replace(/&#x([0-9a-f]+);?/gi, function (_, hex) {
        var cp = parseInt(hex, 16);
        return (cp >= 0 && cp <= 0x10ffff) ? String.fromCodePoint(cp) : '';
      })
      .replace(/&#([0-9]+);?/g, function (_, dec) {
        var cp = parseInt(dec, 10);
        return (cp >= 0 && cp <= 0x10ffff) ? String.fromCodePoint(cp) : '';
      })
      .replace(/&(colon|amp|lt|gt|quot|apos|nbsp|tab|newline);/gi, function (m, name) {
        var map = { colon: ':', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', tab: '\t', newline: '\n' };
        return map[name.toLowerCase()] || m;
      });
  }
  // DSML / tool_calls / reasoning_content — never show raw protocol to user
  var DSML_RE = /<[|\uff5c]DSML[|\uff5c][\s\S]*?<[|\uff5c]\/DSML[|\uff5c]>/gi;
  var TOOL_CALLS_RAW_RE = /\{"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/g;
  var REASONING_RAW_RE = /"reasoning_content"\s*:\s*"[^"]*"/gi;

  // ── M58：块级“短路透传”收敛 ──────────────────────────────────
  // 原先以块级标签(h1/ul/ol/table/blockquote/div…)开头的段落会被“原样透传”，
  // 安全完全押在 sanitizeHtml 正则上；AI 输出不可信，正则一旦被绕过即 XSS。
  // 现改为：经 <template> 惰性解析（不执行脚本/不加载外部资源）后按白名单重建——
  // 仅保留本渲染管线及常见文本结构标签 + 白名单属性，其余标签整棵丢弃；
  // 文本节点一律以“解析后解码值”重新转义，消除原样透传路径。
  var PASSTHROUGH_TAGS = { h1:1, h2:1, h3:1, h4:1, h5:1, h6:1, p:1, ul:1, ol:1, li:1, table:1, thead:1, tbody:1, tfoot:1, tr:1, th:1, td:1, blockquote:1, pre:1, code:1, div:1, span:1, strong:1, em:1, b:1, i:1, u:1, s:1, del:1, small:1, sub:1, sup:1, mark:1, br:1, hr:1, a:1, img:1 };
  var PASSTHROUGH_VOID = { br:1, hr:1, img:1 };
  var PASSTHROUGH_ATTRS = {
    a: { href:1, title:1, target:1, rel:1 },
    img: { src:1, alt:1, title:1, loading:1, class:1 },
    code: { class:1 },
    span: { title:1 }
  };
  var _passthroughTpl = null;
  var _passthroughNonceSeq = 0;
  function makePassthroughNonce() {
    _passthroughNonceSeq = (_passthroughNonceSeq + 1) % 1000000000;
    return 'XTJPH_' + Math.random().toString(36).slice(2) + '_' + _passthroughNonceSeq + '_';
  }
  function hasRealTemplateDom() {
    if (typeof document === 'undefined' || !document.createElement) return false;
    try {
      if (!_passthroughTpl) _passthroughTpl = document.createElement('template');
      return !!(_passthroughTpl && _passthroughTpl.content && typeof _passthroughTpl.content.childNodes === 'object');
    } catch (_) {
      return false;
    }
  }
  function safeOrigin() {
    try {
      if (typeof location !== 'undefined' && location.origin && location.origin !== 'null') {
        return location.origin;
      }
    } catch (_) {}
    return 'https://xtj.local';
  }
  function passthroughUrlValue(rawVal, allowDataImage) {
    var decoded = decodeHtmlEntities(rawVal).replace(/[\x00-\x1f\x7f\s]+/g, '');
    if (/^\/\//.test(decoded)) return '#';
    var protocol = '';
    try { protocol = new URL(decoded, safeOrigin()).protocol.toLowerCase(); } catch (e) { protocol = ''; }
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return decoded;
    if (protocol === 'data:' && allowDataImage && /^data:image\/(?!svg\b)/i.test(decoded)) return decoded;
    if (/^(\/(?!\/)|\.\/|\.\.\/|#|\?)/.test(decoded)) return decoded;
    return '#';
  }
  function walkPassthrough(node, out, unmaskRe) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) { // 文本：以解码后的值重新转义，仅在文本节点中还原内部占位符
        var text = _escapeHtml(String(n.nodeValue == null ? '' : n.nodeValue));
        if (unmaskRe) {
          text = text.replace(unmaskRe, function (_, t, idx) {
            return '\x00' + t + idx + '\x00';
          });
        }
        out.push(text);
      } else if (n.nodeType === 1) { // 元素
        var tag = String(n.tagName || '').toLowerCase();
        if (!PASSTHROUGH_TAGS[tag]) continue; // 非白名单标签：整棵丢弃
        out.push('<' + tag);
        var allow = PASSTHROUGH_ATTRS[tag] || {};
        var attrs = n.attributes;
        for (var ai = 0; ai < attrs.length; ai++) {
          var attrName = String(attrs[ai].name || '').toLowerCase();
          if (!allow[attrName]) continue;
          var rawVal = String(attrs[ai].value == null ? '' : attrs[ai].value);
          // 绝不允许占位符出现在属性值内（阻断 &#1;INLINE0&#1; / 嵌套链接破出属性引号 XSS）
          if (unmaskRe) rawVal = rawVal.replace(unmaskRe, '');
          var v = (attrName === 'href') ? passthroughUrlValue(rawVal, false)
                : (attrName === 'src') ? passthroughUrlValue(rawVal, true)
                : (attrName === 'class') ? rawVal.replace(/[^A-Za-z0-9 _-]/g, '')
                : rawVal;
          out.push(' ' + attrName + '="' + _escapeHtml(v) + '"');
        }
        out.push('>');
        if (!PASSTHROUGH_VOID[tag]) {
          walkPassthrough(n, out, unmaskRe);
          out.push('</' + tag + '>');
        }
      }
      // 注释/文档节点：忽略
    }
  }
  function cleanPassthroughHtml(p) {
    try {
      if (!hasRealTemplateDom()) return _escapeHtml(String(p == null ? '' : p));
      // NUL 占位符（\x00INLINE..\x00 / \x00CODE..\x00 / \x00PH..\x00）会被
      // template 解析丢弃，先换成每次随机不可猜的 nonce 掩码，仅在文本节点中还原。
      var nonce = makePassthroughNonce();
      var masked = String(p).replace(/\x00(INLINE|CODE|PH)(\d+)\x00/g, function (m, t, idx) {
        return nonce + t + '_' + idx + '_END';
      });
      var unmaskRe = new RegExp(nonce + '(INLINE|CODE|PH)_(\\d+)_END', 'g');
      _passthroughTpl.innerHTML = masked;
      var out = [];
      walkPassthrough(_passthroughTpl.content, out, unmaskRe);
      _passthroughTpl.innerHTML = '';
      return out.join('');
    } catch (e) {
      // 解析异常时最保守降级：整段按纯文本转义
      return _escapeHtml(String(p == null ? '' : p));
    }
  }

  function sanitizeDomTree(root) {
    var kids = Array.prototype.slice.call(root.childNodes || []);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 1) {
        var tag = String(n.tagName || '').toLowerCase();
        if (BLOCKED_TAGS_SET[tag]) {
          if (n.parentNode) n.parentNode.removeChild(n);
          continue;
        }
        var attrs = Array.prototype.slice.call(n.attributes || []);
        for (var ai = 0; ai < attrs.length; ai++) {
          var attrName = String(attrs[ai].name || '').toLowerCase();
          var attrVal = String(attrs[ai].value == null ? '' : attrs[ai].value);
          if (!/^[a-z][a-z0-9:-]*$/i.test(attrName) || /^(?:on[a-z0-9_]*|style|srcdoc|formaction)$/i.test(attrName)) {
            n.removeAttribute(attrs[ai].name);
            continue;
          }
          if (attrName === 'href' || attrName === 'src' || attrName === 'action' || attrName === 'xlink:href') {
            var safeVal = passthroughUrlValue(attrVal, attrName === 'src');
            if (safeVal !== attrVal) n.setAttribute(attrs[ai].name, safeVal);
          }
        }
        sanitizeDomTree(n);
      } else if (n.nodeType === 8) {
        if (n.parentNode) n.parentNode.removeChild(n);
      }
    }
  }

  function sanitizeTagMarkup(tagMarkup) {
    var prev;
    var s = tagMarkup;
    do { prev = s; s = s.replace(BLOCKED_ATTRS_RE, function (m, p1) { return (p1 || '') + ' '; }); } while (s !== prev);
    do { prev = s; s = s.replace(BLOCKED_ATTRS_ENTITY_RE, function (m, p1) { return (p1 || '') + ' '; }); } while (s !== prev);
    s = s.replace(/(href|src|action|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, function (match, attr, dq, sq, unq) {
      var rawVal = dq !== undefined ? dq : (sq !== undefined ? sq : (unq || ''));
      var decoded = decodeHtmlEntities(rawVal).replace(/[\x00-\x1f\x7f\s]+/g, '');
      if (/^\/\//.test(decoded)) return attr + '="#"';
      var protocol = '';
      try { protocol = new URL(decoded, safeOrigin()).protocol.toLowerCase(); } catch (e) { protocol = ''; }
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return match;
      if (attr.toLowerCase() === 'src' && protocol === 'data:' && /^data:image\/(?!svg\b)/i.test(decoded)) return match;
      if (/^(\/(?!\/)|\.\/|\.\.\/|#|\?)/.test(decoded)) return match;
      return attr + '="#"';
    });
    return s;
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    var s = String(html);
    // 先剥离内联协议帧/工具调用/推理原文——避免攻击者用 {"tool_calls":[]}、<|DSML|>
    // 把敏感标签或事件属性拆开，待过滤完成后再被拼接还原成可执行代码（先剥后滤）。
    s = s.replace(DSML_RE, '');
    s = s.replace(TOOL_CALLS_RAW_RE, '');
    s = s.replace(REASONING_RAW_RE, '');
    // 浏览器环境优先走 <template> DOM 树净化：彻底避免正则解析差异绕过，
    // 且不会误删正文或代码块中的合法文本（如 one=1、online=true、style=dashed、expression(）。
    if (hasRealTemplateDom()) {
      try {
        var tpl = document.createElement('template');
        tpl.innerHTML = s;
        sanitizeDomTree(tpl.content);
        return tpl.innerHTML;
      } catch (_) {}
    }
    // 无完整 DOM（如轻量单测 VM）时回退至标签级收敛正则净化：
    // 先按含引号感知的标签匹配剥离黑名单属性与危险协议，再剥离黑名单标签开头，
    // 防止属性值内嵌 '>' 或黑名单标签剥离后残留属性逃逸。
    var prev;
    do {
      prev = s;
      s = s.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>?/g, sanitizeTagMarkup);
      s = s.replace(BLOCKED_TAGS_RE, '');
    } while (s !== prev);
    return s;
  }

  // ── Lightweight Markdown → HTML ────────────────────────────────────────
  // Supports: headings, lists, code blocks, inline code, tables, links, blockquotes, bold/italic
  function renderMarkdown(text) {
    if (!text) return '';
    // 入口即清除 NUL/SOH：阻断 \x00INLINE 自引用占位符注入与 \x01javascript: 控制字符绕过
    var s = String(text).replace(/[\x00\x01]/g, '');

    // 1. Fenced code blocks: ```lang ... ```
    var codeBlocks = [];
    function fencedCodeToPlaceholder(_, lang, code) {
      var idx = codeBlocks.length;
      var escaped = _escapeHtml(code.replace(/\n$/, ''));
      codeBlocks.push('<pre><code class="language-' + _escapeHtml(lang || '') + '">' + escaped + '</code></pre>');
      return '\x00CODE' + idx + '\x00';
    }
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, fencedCodeToPlaceholder);
    // 流式场景：围栏未闭合（仍在输出中的代码块）同样转义后放入 codeBlocks，
    // 避免"正在输出的代码块"内容原样注入 HTML；要求 ``` 后紧跟换行，
    // 防止正文中孤立 ``` 吞掉后续整段（子代理修复）
    s = s.replace(/```(\w*)\n([\s\S]*)$/g, fencedCodeToPlaceholder);
      var inlineStore = [];
    function stashInline(html) { var idx = inlineStore.length; inlineStore.push(html); return '\x00INLINE' + idx + '\x00'; }
    
    // 2. Inline code: `code`
    s = s.replace(/`([^`]+)`/g, function (_, code) {
      return stashInline('<code>' + _escapeHtml(code) + '</code>');
    });
  /// 5. Links: [text](url)
    function safeHref(rawUrl, allowDataImage) {
      var u = decodeHtmlEntities(rawUrl).replace(/[\x00-\x1f\x7f\s]+/g, '');
      if (/^\/\//.test(u)) return { ok: false, url: '#' };
      var protocol = '';
      try { protocol = new URL(u, safeOrigin()).protocol.toLowerCase(); } catch (e) { protocol = ''; }
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return { ok: true, url: u };
      if (allowDataImage && protocol === 'data:' && /^data:image\/(?!svg\b)/i.test(u)) return { ok: true, url: u };
      if (/^(\/(?!\/)|\.\/|\.\.\/|#|\?)/.test(u)) return { ok: true, url: u };
      return { ok: false, url: '#' };
    }
    // 6. Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) { var h = safeHref(url, true); if (!h.ok) return _escapeHtml(alt || '图片'); return stashInline('<img class="ai-md-img" src="' + _escapeHtml(h.url) + '" alt="' + _escapeHtml(alt).replace(/"/g, '&quot;') + '" loading="lazy" />'); });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, url) { var h = safeHref(url, false); if (!h.ok) return stashInline('<span title="' + _escapeHtml(h.url) + '">' + _escapeHtml(text) + '</span>'); return stashInline('<a href="' + _escapeHtml(h.url) + '" target="_blank" rel="noopener noreferrer">' + _escapeHtml(text) + '</a>'); });
    
    // 3. Bold: **text** / __text__；Italic: *text* / _text_；Bold+Italic: ***text*** / ___text___
    // ★ 修复（AI 回复出现字面量 </strong>）：加粗/斜体先替换成占位符、最后统一还原，
    //   避免斜体步骤把加粗步骤产出的 <strong> 当作内容再次转义（例如 ***重要***
    //   会被渲染成字面量 <strong>重要</strong>，界面上出现 </strong> 残留）。
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, function (_, t) { return stashInline('<strong><em>' + _escapeHtml(t) + '</em></strong>'); });
    s = s.replace(/___([^_]+)___/g, function (_, t) { return stashInline('<strong><em>' + _escapeHtml(t) + '</em></strong>'); });
    s = s.replace(/\*\*([^*]+)\*\*/g, function (_, t) { return stashInline('<strong>' + _escapeHtml(t) + '</strong>'); });
    s = s.replace(/__([^_]+)__/g, function (_, t) { return stashInline('<strong>' + _escapeHtml(t) + '</strong>'); });
    s = s.replace(/\*([^*]+)\*/g, function (_, t) { return stashInline('<em>' + _escapeHtml(t) + '</em>'); });
    s = s.replace(/_([^_]+)_/g, function (_, t) { return stashInline('<em>' + _escapeHtml(t) + '</em>'); });


    // 7. Tables: | col1 | col2 |
    s = s.replace(/(^\|.+\|$\n^\|[-: |]+\|$\n(?:^\|.+\|$\n?)+)/gm, function (table) {
      var rows = table.trim().split('\n');
      var html = '<table>';
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i].trim();
        if (/^\|[-: |]+\|$/.test(row)) continue; // separator row
        // 只裁掉首尾管道符，保留中间空单元格，避免 |a||b| 列错位
        var cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|');
        var tag = i === 0 ? 'th' : 'td';
        html += '<tr>';
        for (var j = 0; j < cells.length; j++) {
          html += '<' + tag + '>' + _escapeHtml(cells[j].trim()) + '</' + tag + '>';
        }
        html += '</tr>';
      }
      html += '</table>';
      return html;
    });

    // 8. Blockquotes: > text
    s = s.replace(/^&gt;\s?(.+)$/gm, function (_, t) { return '<blockquote>' + _escapeHtml(t) + '</blockquote>'; });
    s = s.replace(/^>\s?(.+)$/gm, function (_, t) { return '<blockquote>' + _escapeHtml(t) + '</blockquote>'; });

    // 9. Headings: ## text
    s = s.replace(/^####\s+(.+)$/gm, function (_, t) { return '<h4>' + _escapeHtml(t) + '</h4>'; });
    s = s.replace(/^###\s+(.+)$/gm, function (_, t) { return '<h3>' + _escapeHtml(t) + '</h3>'; });
    s = s.replace(/^##\s+(.+)$/gm, function (_, t) { return '<h2>' + _escapeHtml(t) + '</h2>'; });
    s = s.replace(/^#\s+(.+)$/gm, function (_, t) { return '<h1>' + _escapeHtml(t) + '</h1>'; });

    // 10. Horizontal rule
    s = s.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr>');

    // 11/12. Lists — 先统一生成项（有序项打 data-ol 标记），
    // 全部生成完后再分别包裹 <ul>/<ol>，最后去掉标记
    s = s.replace(/^[\*\-]\s+(.+)$/gm, function (_, t) { return '<li>' + _escapeHtml(t) + '</li>'; });
    s = s.replace(/^\d+\.\s+(.+)$/gm, function (_, t) { return '<li data-ol="1">' + _escapeHtml(t) + '</li>'; });
    s = s.replace(/(<li>.*<\/li>(?:\n+(?=<li>)|\n)?)+/g, function(list) { return '<ul>' + list.replace(/\n+/g, '') + '</ul>'; });
    s = s.replace(/(<li data-ol="1">.*<\/li>(?:\n+(?=<li data-ol="1">)|\n)?)+/g, function(list) { return '<ol>' + list.replace(/\n+/g, '') + '</ol>'; });
    s = s.replace(/<li data-ol="1">/g, '<li>');

    // 13. Paragraphs: double newlines
    // ★ 修复（XSS）：p 必须先 _escapeHtml 再拼入，防止把用户文本当 HTML 解析。
    //   段落内已生成的 <code>/<a>/<img>/<strong> 等内联与块级 HTML 先临时收纳为占位符，
    //   转义后再还原，既堵住注入又不破坏已有渲染。
    var paragraphHtmlStore = [];
    function stashParagraphHtml(m) {
      var idx = paragraphHtmlStore.length;
      // 段落内透传的 HTML 片断一律先经 <template> 白名单重建再入占位表，
      // 堵死以 text/非块级标签开头的段落绕过 cleanPassthroughHtml 的路径。
      paragraphHtmlStore.push(cleanPassthroughHtml(m));
      return '\x00PH' + idx + '\x00';
    }
    var PARAGRAPH_HTML_RE = /<h[1-6]>[\s\S]*?<\/h[1-6]>|<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<li>[\s\S]*?<\/li>|<table>[\s\S]*?<\/table>|<pre>[\s\S]*?<\/pre>|<div>[\s\S]*?<\/div>|<code>[\s\S]*?<\/code>|<a\b[^>]*>[\s\S]*?<\/a>|<span\b[^>]*>[\s\S]*?<\/span>|<img\b[^>]*\/?>|<hr\b[^>]*>/gi;
    var paragraphs = s.split(/\n\n+/);
    s = paragraphs.map(function (p) {
      p = p.trim();
      if (!p) return '';
      // Skip if already wrapped in a block element
      if (/^<(h[1-6]|ul|ol|li|table|blockquote|pre|hr|div)\b/.test(p)) {
        // 修复(bug3)：仅对「整段都是块级标签」的段落做 cleanPassthroughHtml 透传。
        // 若块级标签后用单换行紧跟普通文本（如 `Array<string>` / `<URL>` / 中文说明），
        // 整段喂给 template 会把尖括号文本解析成未知标签，walkPassthrough 命中
        // `!PASSTHROUGH_TAGS[tag]` 后整棵子树丢弃 → 后半句凭空消失且丢换行。
        // 段内按单换行切行，只要存在「非块级开头的普通文本行」，就走下方的
        // stash + _escapeHtml + <br> 流程，让普通文本里的尖括号被安全转义。
        var _lines = String(p).split('\n');
        var _allBlock = _lines.every(function (ln) {
          var _t = String(ln).trim();
          return !_t || /^<\/?(h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|blockquote|pre|hr|div|p)\b/i.test(_t);
        });
        if (_allBlock) {
          // M58：纯块级段落先做白名单重建再放行，
          // 使这类内容同样经过本文件的转义/清理管线，安全不再只押在 sanitizeHtml 正则上。
          return cleanPassthroughHtml(p);
        }
        // 混合段落（块级标签 + 普通文本行）：落到下方通用流程处理。
      }
      p = p.replace(PARAGRAPH_HTML_RE, stashParagraphHtml);
      p = _escapeHtml(p).replace(/\n/g, '<br>');
      p = p.replace(/\x00PH(\d+)\x00/g, function (_, idx) { return paragraphHtmlStore[parseInt(idx, 10)] || ''; });
      return '<p>' + p + '</p>';
    }).join('\n');

    // 14. Restore inline (bold/italic) placeholders — 先于代码块还原，
    //     以便内联占位符中嵌套的代码块占位符（如 **```js```**）也能被还原。
    //     使用迭代还原，处理 *a**b**c* 这类斜体包裹加粗的嵌套场景。
    var inlinePasses = 0;
    var _restoreBudget = 2000000; // 展开总长度上限，防自引用占位符指数膨胀致 OOM
    while (/\x00INLINE(\d+)\x00/.test(s) && inlinePasses < 10 && _restoreBudget > 0) {
      s = s.replace(/\x00INLINE(\d+)\x00/g, function (_, idx) {
        var piece = inlineStore[parseInt(idx, 10)] || '';
        _restoreBudget -= piece.length;
        return _restoreBudget > 0 ? piece : '';
      });
      inlinePasses++;
    }

    // 14b. Restore code blocks
    s = s.replace(/\x00CODE(\d+)\x00/g, function (_, idx) {
      return codeBlocks[parseInt(idx, 10)] || '';
    });

    // 15. Final sanitization
    s = sanitizeHtml(s);

    return s;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.Markdown = {
    render: renderMarkdown,
    sanitize: sanitizeHtml,
    escapeHtml: _escapeHtml
  };

})();
