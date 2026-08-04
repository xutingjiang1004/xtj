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
  // 事件处理属性：必须覆盖紧贴引号/斜杠/标签边界的情况（如 <img src="x"onerror="alert(1)">，
  // HTML 解析会把引号后的 onerror 当作独立属性，原正则要求属性名前有空白导致漏删）
  var BLOCKED_ATTRS_RE = /(^|[\s"'>\/])on[a-z0-9_]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>\/=]+)/gi;
  // 实体编码的事件属性名（onerror → &#111;nerror）
  var BLOCKED_ATTRS_ENTITY_RE = /(^|[\s"'>\/])((?:&#x?[0-9a-f]+;)+)[a-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>\/=]+)/gi;

  // 危险协议检测（对属性值先解码 HTML 实体，再剥离空白，最后校验 scheme）：
  // 覆盖 jav&#x61;script:、java&#x09;script:、data:text/html 等实体编码/空白分隔绕过。
  var DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|livescript|mocha)\s*[:\\]|^data\s*:\s*(?:text\/html|text\/javascript|application\/xhtml\+xml|image\/svg)/i;
  function decodeHtmlEntities(str) {
    return String(str)
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
  }
  // DSML / tool_calls / reasoning_content — never show raw protocol to user
  var DSML_RE = /<[|\uff5c]DSML[|\uff5c][\s\S]*?<[|\uff5c]\/DSML[|\uff5c]>/gi;
  var TOOL_CALLS_RAW_RE = /\{"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/g;
  var REASONING_RAW_RE = /"reasoning_content"\s*:\s*"[^"]*"/gi;

  function sanitizeHtml(html) {
    if (!html) return '';
    var s = String(html);
    // Strip dangerous tags
    s = s.replace(BLOCKED_TAGS_RE, '');
    // Strip event handlers (quoted and unquoted values, incl. no-space boundary)
    s = s.replace(BLOCKED_ATTRS_RE, '');
    // Strip entity-encoded event handler attribute names
    s = s.replace(BLOCKED_ATTRS_ENTITY_RE, '');
    // 统一校验 href/src 值：先解码 HTML 实体（&#x61; → a），再剥离空白
    // （java&#x09;script → javascript），命中危险 scheme 一律降级为 '#'
    s = s.replace(/(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, function (match, attr, dq, sq, unq) {
      var rawVal = dq !== undefined ? dq : (sq !== undefined ? sq : (unq || ''));
      var decoded = decodeHtmlEntities(rawVal).replace(/[\t\r\n ]/g, '');
      if (DANGEROUS_SCHEME_RE.test(decoded)) return attr + '="#"';
      return match;
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
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      var idx = codeBlocks.length;
      var escaped = _escapeHtml(code.replace(/\n$/, ''));
      codeBlocks.push('<pre><code class="language-' + _escapeHtml(lang || '') + '">' + escaped + '</code></pre>');
      return '\x00CODE' + idx + '\x00';
    });

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
      if (!scheme) return { ok: true, url: u }; // 相对路径/无协议
      var s = scheme.toLowerCase();
      if (s === 'http' || s === 'https' || s === 'mailto') return { ok: true, url: u };
      if (allowDataImage && s === 'data' && /^data:image\//i.test(u)) return { ok: true, url: u };
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
        var cells = row.split('|').filter(function (c) { return c.trim(); });
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

    // 11. Unordered lists
    s = s.replace(/^[\*\-]\s+(.+)$/gm, function (_, t) { return '<li>' + _escapeHtml(t) + '</li>'; });
    s = s.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // 12. Ordered lists
    s = s.replace(/^\d+\.\s+(.+)$/gm, function (_, t) { return '<li>' + _escapeHtml(t) + '</li>'; });
    // Fix: wrap ordered lists that weren't already caught by unordered
    s = s.replace(/<li>([\s\S]*?)<\/li>/g, function (match) {
      // Only wrap if not already inside a list
      return match;
    });

    // 13. Paragraphs: double newlines
    var paragraphs = s.split(/\n\n+/);
    s = paragraphs.map(function (p) {
      p = p.trim();
      if (!p) return '';
      // Skip if already wrapped in a block element
      if (/^<(h[1-6]|ul|ol|li|table|blockquote|pre|hr|div)/.test(p)) return p;
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
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