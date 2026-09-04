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

  var BLOCKED_TAGS_RE = /<\s*(\/)?\s*(script|iframe|object|embed|form|style|link|meta|base|applet|frame|frameset|ilayer|layer|bgsound|title|head|html|body|svg|math|details|summary|video|audio|source)\b/gi;
  // 事件处理属性 + style（防 style="position:fixed" 全屏钓鱼）；首组捕获保留边界字符
  var BLOCKED_ATTRS_RE = /(^|[\s"'>\/])(?:on[a-z0-9_]+|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>&\/=]+)/gi;
  // 实体编码的事件属性名（onerror → &#111;nerror）
  var BLOCKED_ATTRS_ENTITY_RE = /(^|[\s"'>\/])((?:&#x?[0-9a-f]+;)+)[a-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>&\/=]+)/gi;

  // 危险协议检测由 sanitizeHtml 中对解码后 URL 用 new URL(...).protocol 白名单判定
  // （http/https/mailto，另放行 data:image 非 svg），覆盖 jav&#x61;script:、
  // java&#x09;script:、data:text/html 等实体编码/空白分隔绕过。
  var _decodeTa = null;
  function decodeHtmlEntities(str) {
    if (!str) return '';
    // 走浏览器原生解码：完整支持数字/命名实体（&#x61;、&colon; 等），RCDATA 下不执行标签
    if (!_decodeTa) _decodeTa = document.createElement('textarea');
    _decodeTa.innerHTML = String(str);
    return _decodeTa.value;
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
    img: { src:1, alt:1, title:1, loading:1 },
    code: { class:1 },
    span: { title:1 }
  };
  var _passthroughTpl = null;
  function passthroughUrlValue(rawVal, allowDataImage) {
    var decoded = decodeHtmlEntities(rawVal).replace(/[\t\r\n ]/g, '');
    var protocol = '';
    try { protocol = new URL(decoded, location.origin).protocol.toLowerCase(); } catch (e) { protocol = ''; }
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return decoded;
    if (protocol === 'data:' && allowDataImage && /^data:image\/(?!svg\b)/i.test(decoded)) return decoded;
    // 无显式协议：允许相对路径/锚点；拒绝协议相对 URL（//host）
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return (/^\/\//.test(decoded) ? '#' : decoded);
    return '#';
  }
  function walkPassthrough(node, out) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) { // 文本：以解码后的值重新转义
        out.push(_escapeHtml(String(n.nodeValue == null ? '' : n.nodeValue)));
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
          var v = (attrName === 'href') ? passthroughUrlValue(rawVal, false)
                : (attrName === 'src') ? passthroughUrlValue(rawVal, true)
                : rawVal;
          out.push(' ' + attrName + '="' + _escapeHtml(v) + '"');
        }
        out.push('>');
        if (!PASSTHROUGH_VOID[tag]) {
          walkPassthrough(n, out);
          out.push('</' + tag + '>');
        }
      }
      // 注释/文档节点：忽略
    }
  }
  function cleanPassthroughHtml(p) {
    try {
      if (!_passthroughTpl) _passthroughTpl = document.createElement('template');
      // NUL 占位符（\x00INLINE..\x00 / \x00CODE..\x00 / \x00PH..\x00）会被
      // template 解析丢弃，先换成 \x01 掩码文本，重建完成后再还原。
      var masked = String(p).replace(/\x00(INLINE|CODE|PH)(\d+)\x00/g, function (m, t, idx) {
        return '\x01' + t + idx + '\x01';
      });
      _passthroughTpl.innerHTML = masked;
      var out = [];
      walkPassthrough(_passthroughTpl.content, out);
      return out.join('').replace(/\x01(INLINE|CODE|PH)(\d+)\x01/g, function (m, t, idx) {
        return '\x00' + t + idx + '\x00';
      });
    } catch (e) {
      // 解析异常时最保守降级：整段按纯文本转义
      return _escapeHtml(String(p == null ? '' : p));
    }
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    var s = String(html);
    // Strip dangerous tags
    s = s.replace(BLOCKED_TAGS_RE, '');
    // Strip event handlers / style attrs (quoted and unquoted values, incl. no-space boundary)
    // 保留边界字符：避免 <img src="x"onerror="a"onload="b"> 时连边界一起删导致相邻属性存活
    s = s.replace(BLOCKED_ATTRS_RE, function (m, p1) { return p1 || ''; });
    // Strip entity-encoded event handler attribute names（同样保留边界字符）
    s = s.replace(BLOCKED_ATTRS_ENTITY_RE, function (m, p1) { return p1 || ''; });
    // 统一校验 href/src 值：先解码 HTML 实体（&#x61; → a），再剥离空白
    // （java&#x09;script → javascript），最后用 new URL 取 protocol 做白名单判定，
    // 非 http/https/mailto（及 data:image 非 svg）一律降级为 '#'
    s = s.replace(/(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, function (match, attr, dq, sq, unq) {
      var rawVal = dq !== undefined ? dq : (sq !== undefined ? sq : (unq || ''));
      var decoded = decodeHtmlEntities(rawVal).replace(/[\t\r\n ]/g, '');
      var protocol = '';
      try { protocol = new URL(decoded, location.origin).protocol.toLowerCase(); } catch (e) { protocol = ''; }
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return match;
      if (protocol === 'data:' && /^data:image\/(?!svg\b)/i.test(decoded)) return match;
      // 无显式协议（相对路径/锚点）视为安全
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return match;
      return attr + '="#"';
    });
    // Strip CSS expressions（防 style 内 expression() 历史漏洞）
    s = s.replace(/\bexpression\s*\(/gi, '');
    // Strip DSML protocol frames
    s = s.replace(DSML_RE, '');
    // Strip raw tool_calls JSON
    s = s.replace(TOOL_CALLS_RAW_RE, '');
    // Strip reasoning_content
    s = s.replace(REASONING_RAW_RE, '');
    return s;
  }

  // ── Lightweight Markdown → HTML ────────────────────────────────────────
  // Supports: headings, lists, code blocks, inline code, tables, links, blockquotes, bold/italic
  function renderMarkdown(text) {
    if (!text) return '';
    var s = String(text);

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

    // 2. Inline code: `code`
    s = s.replace(/`([^`]+)`/g, function (_, code) {
      return '<code>' + _escapeHtml(code) + '</code>';
    });

    // 3. Bold: **text** / __text__；Italic: *text* / _text_；Bold+Italic: ***text*** / ___text___
    // ★ 修复（AI 回复出现字面量 </strong>）：加粗/斜体先替换成占位符、最后统一还原，
    //   避免斜体步骤把加粗步骤产出的 <strong> 当作内容再次转义（例如 ***重要***
    //   会被渲染成字面量 <strong>重要</strong>，界面上出现 </strong> 残留）。
    var inlineStore = [];
    function stashInline(html) {
      var idx = inlineStore.length;
      inlineStore.push(html);
      return '\x00INLINE' + idx + '\x00';
    }
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, function (_, t) { return stashInline('<strong><em>' + _escapeHtml(t) + '</em></strong>'); });
    s = s.replace(/___([^_]+)___/g, function (_, t) { return stashInline('<strong><em>' + _escapeHtml(t) + '</em></strong>'); });
    s = s.replace(/\*\*([^*]+)\*\*/g, function (_, t) { return stashInline('<strong>' + _escapeHtml(t) + '</strong>'); });
    s = s.replace(/__([^_]+)__/g, function (_, t) { return stashInline('<strong>' + _escapeHtml(t) + '</strong>'); });
    s = s.replace(/\*([^*]+)\*/g, function (_, t) { return stashInline('<em>' + _escapeHtml(t) + '</em>'); });
    s = s.replace(/_([^_]+)_/g, function (_, t) { return stashInline('<em>' + _escapeHtml(t) + '</em>'); });

    // 5. Links: [text](url)
    // ★ 修复（XSS）：协议白名单 + 实体转义。原实现只转义双引号，`[x](jav&#x61;script:alert(1))`
    // 这类实体编码协议可绕过 sanitizeHtml 的 JS_URL_RE（仅匹配字面 javascript/vbscript），
    // 浏览器解析实体后点击即执行。此处统一校验 scheme，非 http/https/mailto 一律降级为纯文本。
    function safeHref(rawUrl, allowDataImage) {
      var u = String(rawUrl || '').trim();
      var scheme = (u.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1];
      if (!scheme) {
        // 相对路径/锚点放行；但协议相对 URL（//evil.com）会跳到外部站点，收紧拒绝
        if (/^\/\//.test(u)) return { ok: false, url: u };
        return { ok: true, url: u };
      }
      var s = scheme.toLowerCase();
      if (s === 'http' || s === 'https' || s === 'mailto') return { ok: true, url: u };
      // data: 仅放行非 SVG 的图片（SVG 可内嵌脚本/外链，收紧）
      if (allowDataImage && s === 'data' && /^data:image\/(?!svg\b)/i.test(u)) return { ok: true, url: u };
      return { ok: false, url: u };
    }
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, url) {
      var h = safeHref(url, false);
      if (!h.ok) return '<span title="' + _escapeHtml(h.url) + '">' + _escapeHtml(text) + '</span>';
      return '<a href="' + _escapeHtml(h.url) + '" target="_blank" rel="noopener noreferrer">' + _escapeHtml(text) + '</a>';
    });

    // 6. Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
      var h = safeHref(url, true);
      if (!h.ok) return _escapeHtml(alt || '图片');
      return '<img src="' + _escapeHtml(h.url) + '" alt="' + _escapeHtml(alt).replace(/"/g, '&quot;') + '" loading="lazy" />';
    });

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
    s = s.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    s = s.replace(/(<li data-ol="1">.*<\/li>\n?)+/g, '<ol>$&</ol>');
    s = s.replace(/<li data-ol="1">/g, '<li>');

    // 13. Paragraphs: double newlines
    // ★ 修复（XSS）：p 必须先 _escapeHtml 再拼入，防止把用户文本当 HTML 解析。
    //   段落内已生成的 <code>/<a>/<img>/<strong> 等内联与块级 HTML 先临时收纳为占位符，
    //   转义后再还原，既堵住注入又不破坏已有渲染。
    var paragraphHtmlStore = [];
    function stashParagraphHtml(m) {
      var idx = paragraphHtmlStore.length;
      paragraphHtmlStore.push(m);
      return '\x00PH' + idx + '\x00';
    }
    var PARAGRAPH_HTML_RE = /<h[1-6]>[\s\S]*?<\/h[1-6]>|<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<li>[\s\S]*?<\/li>|<table>[\s\S]*?<\/table>|<pre>[\s\S]*?<\/pre>|<div>[\s\S]*?<\/div>|<code>[\s\S]*?<\/code>|<a\b[^>]*>[\s\S]*?<\/a>|<span\b[^>]*>[\s\S]*?<\/span>|<img\b[^>]*\/?>|<hr\b[^>]*>/gi;
    var paragraphs = s.split(/\n\n+/);
    s = paragraphs.map(function (p) {
      p = p.trim();
      if (!p) return '';
      // Skip if already wrapped in a block element
      if (/^<(h[1-6]|ul|ol|li|table|blockquote|pre|hr|div)\b/.test(p)) {
        // M58：块级段落不再“原样短路透传”，先做白名单重建再放行，
        // 使这类内容同样经过本文件的转义/清理管线，安全不再只押在 sanitizeHtml 正则上。
        return cleanPassthroughHtml(p);
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
    while (/\x00INLINE(\d+)\x00/.test(s) && inlinePasses < 10) {
      s = s.replace(/\x00INLINE(\d+)\x00/g, function (_, idx) {
        return inlineStore[parseInt(idx, 10)] || '';
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