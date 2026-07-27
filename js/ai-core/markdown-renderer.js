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

  var BLOCKED_TAGS_RE = /<\s*(\/)?\s*(script|iframe|object|embed|form|style|link|meta|base|applet|frame|frameset|ilayer|layer|bgsound|title|head|html|body)\b/gi;
  var BLOCKED_ATTRS_RE = /\s(on\w+)\s*=\s*["'][^"']*["']/gi;
  var JS_URL_RE = /\bhref\s*=\s*["']\s*javascript\s*:/gi;
  var CSS_EXPR_RE = /\bstyle\s*=\s*["'][^"']*\bexpression\s*\(/gi;
  // DSML / tool_calls / reasoning_content — never show raw protocol to user
  var DSML_RE = /<[|\uff5c]DSML[|\uff5c][\s\S]*?<[|\uff5c]\/DSML[|\uff5c]>/gi;
  var TOOL_CALLS_RAW_RE = /\{"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/g;
  var REASONING_RAW_RE = /"reasoning_content"\s*:\s*"[^"]*"/gi;

  function sanitizeHtml(html) {
    if (!html) return '';
    var s = String(html);
    // Strip dangerous tags
    s = s.replace(BLOCKED_TAGS_RE, '');
    // Strip event handlers
    s = s.replace(BLOCKED_ATTRS_RE, '');
    // Strip javascript: URLs
    s = s.replace(JS_URL_RE, 'href="#"');
    // Strip CSS expressions
    s = s.replace(CSS_EXPR_RE, '');
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

    // 3. Bold: **text** or __text__
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // 4. Italic: *text* or _text_
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 5. Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, url) {
      var safeUrl = url.replace(/"/g, '&quot;');
      return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    });

    // 6. Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
      var safeUrl = url.replace(/"/g, '&quot;');
      var safeAlt = alt.replace(/"/g, '&quot;');
      return '<img src="' + safeUrl + '" alt="' + safeAlt + '" loading="lazy" />';
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
          html += '<' + tag + '>' + cells[j].trim() + '</' + tag + '>';
        }
        html += '</tr>';
      }
      html += '</table>';
      return html;
    });

    // 8. Blockquotes: > text
    s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/^>\s?(.+)$/gm, '<blockquote>$1</blockquote>');

    // 9. Headings: ## text
    s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 10. Horizontal rule
    s = s.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr>');

    // 11. Unordered lists
    s = s.replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // 12. Ordered lists
    s = s.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
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

    // 14. Restore code blocks
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