// ==================== AI Core: Stream Renderer ====================
// Extracted from createSmoothTextRenderer in ai-agent.js.
// Provides text buffering, rAF-scheduled DOM updates, and cursor management.
// Designed for both Cat AI (rich markdown) and Code workspace (plain text).
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};

  // Highlight only the newest graphemes; no spans, layout measurements or
  // second typing queue. Browsers without Custom Highlight paint text normally.
  var inkSlots = [], inkReady = false, inkUnavailable = false;
  function prepareInk() {
    if (inkReady) return true;
    if (inkUnavailable) return false;
    try {
      if (!window.CSS || !CSS.highlights || !CSS.registerProperty || !window.Highlight ||
          !window.Element || !Element.prototype.animate || !CSS.supports('color', 'color-mix(in srgb, red, transparent)')) {
        inkUnavailable = true; return false;
      }
      var rules = [];
      for (var i = 0; i < 16; i++) {
        var name = 'xtj-ai-ink-' + i, prop = '--xtj-ai-ink-phase-' + i;
        try { CSS.registerProperty({ name: prop, syntax: '<number>', inherits: true, initialValue: '1' }); } catch (_) {}
        inkSlots.push({ name: name, prop: prop, owner: null, highlight: null, animation: null });
        rules.push('::highlight(' + name + '){color:color-mix(in srgb,var(--xtj-ai-ink-color) calc(72% + 28% * var(' + prop + ',1)),transparent);' +
          'text-shadow:0 0 calc((1 - var(' + prop + ',1)) * 1.1px) color-mix(in srgb,var(--xtj-ai-ink-color) calc((1 - var(' + prop + ',1)) * 20%),transparent)}');
      }
      var style = document.createElement('style'); style.textContent = rules.join('\n'); document.head.appendChild(style);
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) inkSlots.forEach(releaseInkSlot);
      });
      window.addEventListener('pagehide', function() { inkSlots.forEach(releaseInkSlot); });
      inkReady = true; return true;
    } catch (_) { inkUnavailable = true; return false; }
  }
  function releaseInkSlot(slot) {
    if (!slot || !slot.owner) return;
    var animation = slot.animation;
    try { if (CSS.highlights.get(slot.name) === slot.highlight) CSS.highlights.delete(slot.name); } catch (_) {}
    slot.owner = null; slot.highlight = null; slot.animation = null; slot.range = null;
    if (animation) { animation.onfinish = null; animation.oncancel = null; try { animation.cancel(); } catch (_) {} }
  }
  function createInkReveal(target, options) {
    options = options || {};
    if (!target || !(options.inkReveal === true || (target.matches && target.matches('.ai-msg-bubble,.ai-reasoning-segment,.ai-think-answer')))) return null;
    var pending = [], theme = null, owner = {}, lastInkAt = -Infinity, shownChars = 0;
    function motionOff() {
      try { return document.hidden || document.documentElement.getAttribute('data-xtj-motion') === 'off' ||
        !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
      catch (_) { return true; }
    }
    function liteDevice() {
      var root = document.documentElement;
      return root.getAttribute('data-xtj-perf-profile') === 'lite' || root.getAttribute('data-perf') === 'lite' || root.classList.contains('perf-lite');
    }
    function record(node, start, end) {
      if (!node || node.nodeType !== 3 || end <= start) return;
      var parent = node.parentElement;
      if (parent && parent.closest('a,pre,code,kbd,samp')) return;
      if (pending.length >= 16) pending.shift();
      pending.push({ node: node, start: start, end: end });
    }
    function inserted(node) {
      if (!node) return;
      if (node.nodeType === 3) { record(node, 0, node.data.length); return; }
      if (node.nodeType !== 1 || node.matches('a,pre,code,kbd,samp')) return;
      Array.from(node.childNodes).forEach(inserted);
    }
    function clear() {
      pending = [];
      inkSlots.forEach(function(slot) { if (slot.owner === owner) releaseInkSlot(slot); });
    }
    function extendLiveInk(changes, lite) {
      var slot = null;
      for (var i = 0; i < inkSlots.length; i++) {
        var item = inkSlots[i];
        if (item.owner === owner && item.range && item.animation && item.animation.playState === 'running') { slot = item; break; }
      }
      if (!slot) return false;
      var last = changes[changes.length - 1], node = last && last.node;
      if (!node || node.nodeType !== 3 || !node.isConnected || !target.contains(node)) return false;
      if (!slot.range.startContainer || slot.range.startContainer.parentNode !== node.parentNode) return false;
      try {
        slot.range.setEnd(node, last.end);
        var cap = lite ? 48 : 96;
        if (slot.range.startContainer !== node || last.end - slot.range.startOffset > cap) {
          var start = Math.max(last.start, last.end - cap);
          if (start > last.start && /[\uDC00-\uDFFF]/.test(node.data.charAt(start))) start++;
          slot.range.setStart(node, start);
        }
        // Highlight ranges are live, but some engines only repaint after the
        // range is registered again. Re-adding does not restart the fade.
        try { slot.highlight.clear(); if (slot.range.toString()) slot.highlight.add(slot.range); } catch (_) {}
        return !!slot.highlight.size;
      } catch (_) { return false; }
    }
    function commit() {
      try {
      var changes = pending; pending = [];
      if (!changes.length) return;
      if (motionOff()) { clear(); return; }
      if (!prepareInk()) return;
      // One short wash stays running and simply grows to cover characters that
      // arrive while it fades. Restarting it every packet (or dropping those
      // packets for 200ms) either re-resolves the inherited ink property or
      // lets new text pop in at full strength. The text itself is never delayed.
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var lite = liteDevice();
      var isReasoning = !!(target.matches && target.matches('.ai-reasoning-segment'));
      var added = 0;
      for (var ci = 0; ci < changes.length; ci++) added += Math.max(0, changes[ci].end - changes[ci].start);
      shownChars += added;
      var maxChars = isReasoning ? (lite ? 4000 : 10000) : (lite ? 12000 : 30000);
      if (shownChars > maxChars) return;
      if (extendLiveInk(changes, lite)) return;
      if (lite && now - lastInkAt < 300) return;
      // One bounded range per changed text node is enough to create a soft
      // ink wash. Per-grapheme ranges multiply style and animation work for
      // every packet without making text arrive any sooner.
      var ranges = [];
      changes.forEach(function(change) {
        var node = change.node;
        if (!node.isConnected || !target.contains(node)) return;
        // Cap paint work per text node and keep UTF-16 surrogate pairs intact.
        var start = Math.max(change.start, change.end - (lite ? 48 : 96));
        if (start > change.start && /[\uDC00-\uDFFF]/.test(node.data.charAt(start))) start++;
        try {
          var range = document.createRange();
          range.setStart(node, start); range.setEnd(node, change.end);
          if (range.toString()) ranges.push({ range: range, parent: node.parentElement || target });
        } catch (_) {}
      });
      ranges = ranges.slice(lite ? -4 : -12);
      if (!ranges.length) return;
      // Animate the newest block element, not the whole bubble: the inherited
      // ink property then invalidates only that paragraph/list item.
      var inkTarget = ranges[ranges.length - 1].parent;
      if (!inkTarget || !target.contains(inkTarget)) inkTarget = target;
      ranges = ranges.filter(function(entry) { return entry.parent === inkTarget; });
      if (!ranges.length) return;
      var currentTheme = document.documentElement.getAttribute('data-theme') || '';
      if (theme !== currentTheme) {
        theme = currentTheme;
        target.style.setProperty('--xtj-ai-ink-color', getComputedStyle(target).color);
      }
      // Keep at most one short animation per renderer. A new packet replaces
      // that renderer's previous transient highlight instead of stacking lanes.
      var slot = inkSlots.find(function(item) { return item.owner === owner; });
      if (slot) releaseInkSlot(slot);
      slot = inkSlots.find(function(item) { return !item.owner; });
      if (!slot) return;
      slot.owner = owner; slot.highlight = new Highlight();
      slot.range = ranges[ranges.length - 1].range;
      ranges.forEach(function(entry) { try { if (slot.highlight.size < 12) slot.highlight.add(entry.range); } catch (_) {} });
      if (!slot.highlight.size) { releaseInkSlot(slot); return; }
      try {
        CSS.highlights.set(slot.name, slot.highlight);
        var from = {}, to = {}; from[slot.prop] = '0'; to[slot.prop] = '1';
        lastInkAt = now;
        slot.animation = inkTarget.animate([from, to], { duration: lite ? 60 : 90, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
        slot.animation.onfinish = function() { releaseInkSlot(slot); };
        slot.animation.oncancel = function() { releaseInkSlot(slot); };
      } catch (_) { releaseInkSlot(slot); }
      } catch (_) { clear(); }
    }
    return { begin: function() { pending = []; }, record: record, inserted: inserted, commit: commit, clear: clear };
  }
  CORE.InkReveal = { create: createInkReveal };

  // ★ 惰性读取 Markdown：脚本加载顺序不可控时优雅降级为纯文本，而非模块加载期崩溃
  function getMarkdown() {
    return CORE.Markdown;
  }
  function renderRich(content) {
    var md = getMarkdown();
    if (md && typeof md.render === 'function') {
      return md.render(content);
    }
    // 降级：纯文本节点（不注入 HTML）
    var div = document.createElement('div');
    div.textContent = content;
    return div.innerHTML;
  }

  function decodeBasicEntities(s) {
    return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  function streamContentTail(target) {
    var node = target && target.lastElementChild;
    if (node && node.classList && node.classList.contains('ai-stream-cursor')) node = node.previousElementSibling;
    return node;
  }
  function streamEditTarget(el) {
    if (!el) return null;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      var li = el.lastElementChild;
      return li && li.tagName === 'LI' ? li : el;
    }
    if (el.tagName === 'PRE') {
      var code = el.querySelector('code');
      return code || el;
    }
    return el;
  }
  function lastTextNode(el) {
    var node = el;
    while (node && node.nodeType === 1) node = node.lastChild;
    return node && node.nodeType === 3 ? node : null;
  }
  // Already-rendered Markdown grows by a text suffix or one new list item.
  // Extend that node directly so a long answer is not parsed again each frame.
  function tryExtendStreamHtml(target, prev, next, ink) {
    if (!prev || !next || next.length <= prev.length) return false;
    var i = 0, max = prev.length;
    while (i < max && prev.charCodeAt(i) === next.charCodeAt(i)) i++;
    var j = 0;
    while (j < max - i && prev.charCodeAt(max - 1 - j) === next.charCodeAt(next.length - 1 - j)) j++;
    if (!j || i + j < 4) return false;
    var delta = next.slice(i, next.length - j);
    if (!delta) return false;
    var tail = streamContentTail(target);
    if (!tail) return false;
    if (delta.charAt(0) === '<') {
      if ((tail.tagName !== 'UL' && tail.tagName !== 'OL') || !/^<li>[\s\S]*<\/li>$/.test(delta)) return false;
      var holder = document.createElement('div');
      holder.innerHTML = delta;
      if (!holder.firstChild || holder.childNodes.length !== 1 || holder.firstChild.tagName !== 'LI') return false;
      var item = holder.firstChild;
      tail.appendChild(item);
      if (ink) ink.inserted(item);
      return true;
    }
    if (/</.test(delta)) return false;
    var added = decodeBasicEntities(delta);
    if (!added) return false;
    var edit = streamEditTarget(tail);
    if (!edit) return false;
    if (next.charAt(i - 1) === '>') {
      var created = document.createTextNode(added);
      edit.appendChild(created);
      if (ink) ink.record(created, 0, created.length);
      return true;
    }
    var textNode = lastTextNode(edit);
    if (!textNode) return false;
    var start = textNode.length;
    textNode.appendData(added);
    if (ink) ink.record(textNode, start, textNode.length);
    return true;
  }

  /* Rich Markdown uses the parser + node diff path because unfinished inline
     syntax can change meaning as the answer grows. It preserves stable nodes,
     but parsing/traversal can still scale with the open block. Plain prose is
     appended directly by the bounded fast path in createStreamRenderer.
     A pure suffix or a new list item extends the existing nodes instead. */
  function patchInnerHTML(targetEl, html, ink) {
    if (!targetEl) return;
    if (targetEl.__xtjStreamHtml && tryExtendStreamHtml(targetEl, targetEl.__xtjStreamHtml, html, ink)) {
      targetEl.__xtjStreamHtml = html;
      return;
    }
    function children(parent, wanted, depth) {
      var old = Array.from(parent.childNodes).filter(function(n) { return !(n.nodeType === 1 && n.classList.contains('ai-stream-cursor')); });
      var pos = 0;
      Array.from(wanted.childNodes).forEach(function(want) {
        var have = old[pos++];
        if (!have) { var added = want.cloneNode(true); parent.insertBefore(added, parent.querySelector(':scope > .ai-stream-cursor')); if (ink) ink.inserted(added); return; }
        if (have.nodeType === want.nodeType && (want.nodeType === 3 ? have.data === want.data : have.isEqualNode(want))) return;
        if (have.nodeType === 3 && want.nodeType === 3) {
          var before = have.data;
          if (want.data.indexOf(before) === 0) { have.appendData(want.data.slice(before.length)); if (ink) ink.record(have, before.length, have.length); }
          else have.data = want.data;
          return;
        }
        var same = have.nodeType === 1 && want.nodeType === 1 && have.tagName === want.tagName && depth < 32 && have.attributes.length === want.attributes.length;
        if (same) same = Array.from(want.attributes).every(function(a) { return have.getAttribute(a.name) === a.value; });
        if (same) children(have, want, depth + 1);
        else parent.replaceChild(want.cloneNode(true), have);
      });
      for (; pos < old.length; pos++) if (old[pos].parentNode === parent) old[pos].remove();
    }
    try {
      var holder = document.createElement('div'); holder.innerHTML = html;
      children(targetEl, holder, 0);
    } catch (_) { targetEl.innerHTML = html; }
    targetEl.__xtjStreamHtml = html;
  }

  // Closed blocks stay in the caller's block cache. This only bounds the open
  // tail: a long list re-renders the current line, and a long paragraph
  // re-renders its plain suffix, once the result has matched a full render.
  function createTailAccelerator(render) {
    var listKey = '', listHtml = '', listVerified = '', frozenHead = '', frozenHtml = '';
    function reset() { listKey = ''; listHtml = ''; listVerified = ''; frozenHead = ''; frozenHtml = ''; }
    function joinHtml(base, extra) {
      if (!extra) return base || '';
      if (!base) return extra;
      var openBase = /^<(\w+)>/.exec(base), openExtra = /^<(\w+)>/.exec(extra);
      if (!openBase || !openExtra || openBase[1] !== openExtra[1]) return null;
      var tag = openBase[1], close = '</' + tag + '>';
      if (base.slice(-close.length) !== close || extra.slice(-close.length) !== close) return null;
      if (tag === 'ul' || tag === 'ol') return base.slice(0, -close.length) + extra.slice(tag.length + 2);
      if (tag === 'p') return base.slice(0, -4) + extra.slice(3, -4) + '</p>';
      return null;
    }
    function plainSuffix(text) { return !!text && text.indexOf('\n') < 0 && !/[*`#\[\]|<>]/.test(text); }
    function renderTail(tail) {
      if (!tail) return '';
      if (tail.length < 240 || /```|\||<|>/.test(tail) || /\n[ \t]*\n/.test(tail)) return render(tail);
      if (/^(?:[-*+] |\d+\. )/m.test(tail) && tail.indexOf('\n') > 0) {
        var end = tail.lastIndexOf('\n'), complete = tail.slice(0, end), partial = tail.slice(end + 1);
        var lines = complete.split('\n'), ok = true;
        for (var li = 0; li < lines.length; li++) if (lines[li] && !/^(?:[-*+] |\d+\. )/.test(lines[li])) ok = false;
        if (!ok) return render(tail);
        if (!listKey || complete.indexOf(listKey) !== 0) { listKey = ''; listHtml = ''; listVerified = ''; }
        if (complete !== listKey) {
          var built = '';
          if (listKey && listHtml && complete.indexOf(listKey + '\n') === 0) {
            built = listHtml;
            var extraLines = complete.slice(listKey.length + 1).split('\n');
            for (var ei = 0; ei < extraLines.length; ei++) {
              built = joinHtml(built, render(extraLines[ei]));
              if (!built) break;
            }
          } else built = render(complete);
          if (!built) { listKey = ''; listHtml = ''; listVerified = ''; return render(tail); }
          listHtml = built; listKey = complete;
        }
        var listed = partial ? joinHtml(listHtml, render(partial)) : listHtml;
        if (!listed) { listKey = ''; listHtml = ''; listVerified = ''; return render(tail); }
        if (listVerified !== complete) {
          if (listed !== render(tail)) { listKey = ''; listHtml = ''; listVerified = ''; return render(tail); }
          listVerified = complete;
        }
        return listed;
      }
      if (tail.indexOf('\n') >= 0 || /^(?:[-*+] |\d+\. )/.test(tail)) return render(tail);
      var restLen = frozenHead && tail.indexOf(frozenHead) === 0 ? tail.length - frozenHead.length : tail.length;
      if (!frozenHead || tail.indexOf(frozenHead) !== 0 || !plainSuffix(tail.slice(frozenHead.length)) || restLen > 220) {
        var cut = tail.length - 120;
        if (cut < 40) return render(tail);
        if (/[\uDC00-\uDFFF]/.test(tail.charAt(cut))) cut++;
        var head = tail.slice(0, cut), rest = tail.slice(cut);
        if (!plainSuffix(rest)) return render(tail);
        var headHtml = frozenHtml && frozenHead && head.indexOf(frozenHead) === 0 ? joinHtml(frozenHtml, render(head.slice(frozenHead.length))) : render(head);
        var joined = headHtml && joinHtml(headHtml, render(rest));
        if (!joined || joined !== render(tail)) return render(tail);
        frozenHead = head; frozenHtml = headHtml;
        return joined;
      }
      return joinHtml(frozenHtml, render(tail.slice(frozenHead.length))) || render(tail);
    }
    return { reset: reset, render: renderTail };
  }

  function createStreamRenderer(targetEl, options) {
    options = options || {};
    var ink = CORE.InkReveal.create(targetEl, options);
    var prefix = '', markup = '', cacheVerified = false, cacheDisabled = false, blockCache = new Map();
    var tailAccel = createTailAccelerator(renderRich);
    var cachedMarkdown = getMarkdown() && getMarkdown().render;
    function renderStreamMarkdown(text) {
      var currentMarkdown = getMarkdown() && getMarkdown().render;
      if (currentMarkdown !== cachedMarkdown) {
        cachedMarkdown = currentMarkdown; prefix = ''; markup = ''; cacheVerified = false; cacheDisabled = false; blockCache.clear(); tailAccel.reset();
      }
      if (cacheDisabled) return renderRich(text);
      if (prefix && text.indexOf(prefix) !== 0) { prefix = ''; markup = ''; cacheVerified = false; blockCache.clear(); tailAccel.reset(); }
      var tail = text.slice(prefix.length), breaks = /\n[ \t]*\n+/g, match, committed = 0;
      while ((match = breaks.exec(tail))) {
        var block = tail.slice(committed, match.index);
        if (/```|\||<|>|^[ \t]*(?:[-*+] |\d+\. )/m.test(block)) break;
        var rest = block.replace(/`[^`\n]*`/g, '').replace(/!?\[[^\]\n]*\]\([^\)\n]*\)/g, '')
          .replace(/\*\*[^*]+\*\*/g, '').replace(/\*[^*]+\*/g, '');
        if (/[`*\[\]]/.test(rest)) break;
        var html = blockCache.get(block);
        if (html === undefined) {
          html = renderRich(block);
          if (blockCache.size < 64 && block.length <= 8192) blockCache.set(block, html);
        }
        markup += html;
        committed = breaks.lastIndex;
      }
      if (committed) prefix += tail.slice(0, committed);
      var result = markup + tailAccel.render(tail.slice(committed));
      if (!cacheVerified && prefix) {
        var full = renderRich(text);
        if (result !== full) { cacheDisabled = true; prefix = ''; markup = ''; blockCache.clear(); tailAccel.reset(); return full; }
        cacheVerified = true;
      }
      return result;
    }
    var reducedMotion = (function () {
      try { return document.documentElement.getAttribute('data-xtj-motion') === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    })();
    var pending = '';
    var pendingFirstReceivedAt = 0, pendingLastReceivedAt = 0;
    var measureStream = typeof options.onStreamMetrics === 'function';
    var rendered = '';
    var lastParagraphBoundary = -1;
    var plainMarkdownMode = !options.plainStream;
    var plainMarkdownParagraph = null, plainMarkdownTextNode = null;
    var plainMarkdownNodeLimit = 768;
    var rafId = 0;
    var cancelled = false;
    var finished = false;
    var drainState = null;
    function settleDrain(ok) {
      var state = drainState; drainState = null;
      if (!state) return;
      if (state.signal) state.signal.removeEventListener('abort', state.abort);
      state.resolve(ok);
    }
    var paused = false;
    var streamClass = options.streamClass || 'ai-streaming-soft';
    var requestFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (cb) { return setTimeout(cb, 16); };
    var cancelFrame = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
    // plainStream mode: reuse single text node to avoid per-frame reflow
    var plainTextNode = null;
    var plainTextBuffer = '';
    // Cursor element
    var cursor = null;

    function ensureCursor() {
      if (finished || cancelled) return;
      if (cursor && cursor.parentNode === targetEl) return;
      cursor = null;
      try {
        cursor = document.createElement('span');
        cursor.className = 'ai-stream-cursor';
        cursor.setAttribute('aria-hidden', 'true');
        if (options.plainStream && plainTextNode && plainTextNode.parentNode === targetEl) {
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
      plainTextNode = document.createTextNode('');
      targetEl.insertBefore(plainTextNode, cursor || null);
      return plainTextNode;
    }

    function appendPlainMarkdown(next) {
      if (!plainMarkdownMode || /[\r\n`*_{}\[\]<>!|#\\+\-]/.test(next) || /\d+\./.test(next) ||
          (/\.$/.test(plainMarkdownTextNode && plainMarkdownTextNode.data || '') && /^\s/.test(next))) {
        plainMarkdownMode = false;
        return false;
      }
      if (!plainMarkdownParagraph || plainMarkdownParagraph.parentNode !== targetEl) {
        plainMarkdownParagraph = document.createElement('p');
        targetEl.insertBefore(plainMarkdownParagraph, cursor || null);
        plainMarkdownTextNode = null;
      }
      var rest = next;
      while (rest) {
        if (!plainMarkdownTextNode || plainMarkdownTextNode.length >= plainMarkdownNodeLimit) {
          plainMarkdownTextNode = document.createTextNode('');
          plainMarkdownParagraph.appendChild(plainMarkdownTextNode);
        }
        var count = Math.min(rest.length, plainMarkdownNodeLimit - plainMarkdownTextNode.length);
        if (count < rest.length && count > 0 && /[\uD800-\uDBFF]/.test(rest.charAt(count - 1)) && /[\uDC00-\uDFFF]/.test(rest.charAt(count))) count--;
        if (!count && plainMarkdownTextNode.length) { plainMarkdownTextNode = null; continue; }
        if (!count) count = Math.min(rest.length, 2);
        var part = rest.slice(0, count), start = plainMarkdownTextNode.length;
        plainMarkdownTextNode.appendData(part);
        if (ink) ink.record(plainMarkdownTextNode, start, plainMarkdownTextNode.length);
        rest = rest.slice(count);
      }
      return true;
    }

    function resumePlainMarkdownTail() {
      if (options.plainStream) return;
      var boundary = lastParagraphBoundary;
      if (boundary < 0) return;
      var tail = rendered.slice(boundary + 2);
      if (!tail || tail !== tail.trim() || /[\r\n`*_{}\[\]<>!|#\\+\-]/.test(tail) || /\d+\./.test(tail)) return;
      var paragraph = cursor && cursor.parentNode === targetEl ? cursor.previousElementSibling : targetEl.lastElementChild;
      if (!paragraph || paragraph.tagName !== 'P' || paragraph.childNodes.length !== 1 || paragraph.firstChild.nodeType !== 3 || paragraph.textContent !== tail) return;
      plainMarkdownParagraph = paragraph;
      plainMarkdownTextNode = paragraph.firstChild;
      plainMarkdownMode = true;
    }

    function takeSmoothChunk(text, opts) {
      opts = opts || {};
      var maxChunk = opts.maxChunk || 16;
      if (!text) return '';
      // Try to break at a natural boundary
      var breakChars = ['\n', '。', '！', '？', '，', '.', '!', '?', ',', ';', '；', ' '];
      if (text.length <= maxChunk) return text;
      if (/[\uD800-\uDBFF]/.test(text.charAt(maxChunk - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(maxChunk))) maxChunk++;
      var chunk = text.slice(0, maxChunk);
      for (var i = 0; i < breakChars.length; i++) {
        var idx = chunk.lastIndexOf(breakChars[i]);
        if (idx > maxChunk * 0.4) {
          return text.slice(0, idx + 1);
        }
      }
      return chunk;
    }

    function emitText() {
      if (cancelled || !targetEl) return;
      if (!pending) {
        if (streamClass) targetEl.classList.remove(streamClass);
        return;
      }
      if (streamClass) targetEl.classList.add(streamClass);
      // Coalesce arrivals into one DOM patch per display frame. The network,
      // rather than an additional typing timer, determines the display pace.
      var renderStartedAt = measureStream ? (window.performance && performance.now ? performance.now() : Date.now()) : 0;
      var next = pending;
      pending = '';
      var firstReceivedAt = pendingFirstReceivedAt, lastReceivedAt = pendingLastReceivedAt;
      pendingFirstReceivedAt = pendingLastReceivedAt = 0;
      if (!next) return;
      var priorLength = rendered.length;
      rendered += next;
      var nextBoundary = next.lastIndexOf('\n\n');
      if (nextBoundary >= 0) lastParagraphBoundary = priorLength + nextBoundary;
      else if (priorLength && next.charAt(0) === '\n' && rendered.charAt(priorLength - 1) === '\n') lastParagraphBoundary = priorLength - 1;
      if (ink) ink.begin();
      if (options.plainStream) {
        plainTextBuffer += next;
        var node = ensurePlainTextNode();
        var oldLength = node.length;
        try { node.appendData(next); if (ink) ink.record(node, oldLength, node.length); } catch (e) { node.textContent = plainTextBuffer; }
      } else {
        // The display scheduler already bounds patches to a frame. Wall-clock
        // precision or clock corrections must not suppress an accepted frame.
        if (!appendPlainMarkdown(next)) {
          patchInnerHTML(targetEl, renderStreamMarkdown(rendered), ink);
          resumePlainMarkdownTail();
        } else delete targetEl.__xtjStreamHtml;
      }
      if (ink) ink.commit();
      ensureCursor();
      if (typeof options.onRender === 'function') {
        try { options.onRender(rendered); } catch (e2) {}
      }
      if (measureStream) {
        var renderedAt = window.performance && performance.now ? performance.now() : Date.now();
        try { options.onStreamMetrics({ receivedAt: firstReceivedAt, lastReceivedAt: lastReceivedAt, renderedAt: renderedAt,
          renderMs: renderedAt - renderStartedAt, packetChars: next.length, outputChars: rendered.length }); } catch (_) {}
      }
      if (!pending) {
        // Leave the streaming class in place between frames. Adding and
        // removing it on every packet dirties style just as the scroller reads layout.
        if (finished && streamClass) targetEl.classList.remove(streamClass);
        if (finished && typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
      }
    }

    function tick() {
      rafId = 0;
      if (cancelled || paused) return;
      emitText();
      if (pending) schedule();
      else if (drainState) api.finish(drainState.finalText);
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
      append: function (text, receivedAt) {
        if (cancelled || !targetEl || !text || finished) return;
        if (measureStream) {
          var stamp = Number(receivedAt) || (window.performance && performance.now ? performance.now() : Date.now());
          if (!pending) pendingFirstReceivedAt = stamp;
          pendingLastReceivedAt = stamp;
        }
        pending += String(text);
        if (!paused) schedule();
      },
      flush: function () {
        if (cancelled || !targetEl) return;
        clearFrame();
        emitText(true);
        if (drainState) api.finish(drainState.finalText);
      },
      pause: function () {
        paused = true;
        clearFrame();
      },
      resume: function () {
        if (!paused) return;
        paused = false;
        if (pending) schedule();
      },
      isPaused: function () { return paused; },
      getRendered: function () { return rendered; },
      drain: function(finalText, signal) {
        if (cancelled || !targetEl || signal&&signal.aborted) return Promise.resolve(false);
        if (drainState) return drainState.promise;
        if (finished) return Promise.resolve(true);
        var final = typeof finalText === 'string' && finalText.length ? finalText : rendered + pending;
        // A sanitized replacement must take effect immediately. Only an unseen
        // suffix can follow the existing stream without replaying old text.
        if (final.indexOf(rendered) !== 0 || reducedMotion || !final || final.length-rendered.length>8192) {
          api.finish(final); return Promise.resolve(true);
        }
        pending = final.slice(rendered.length); paused = false;
        if (!pending) { api.finish(final); return Promise.resolve(true); }
        var state = { finalText: final, signal: signal, resolve: null, abort: function() { api.stop(); } };
        state.promise = new Promise(function(resolve) { state.resolve = resolve; });
        drainState = state;
        if (signal) {
          if (signal.aborted) { api.stop(); return state.promise; }
          signal.addEventListener('abort', state.abort, { once: true });
        }
        schedule(); return state.promise;
      },
      finish: function (finalText) {
        if (cancelled || finished || !targetEl) return;
        var hasFinal = (typeof finalText === 'string' && finalText.length > 0);
        // M60：未提供 finalText 时先刷新未刷出的缓冲，避免流式尾部内容被丢弃
        // （此处的 emitText 在 finished 置位前执行，不会重复触发 onDone）。
        if (!hasFinal && pending) {
          clearFrame();
          emitText(true);
        }
        clearFrame();
        finished = true;
        paused = false;
        if (hasFinal) rendered = finalText;
        pending = '';
        removeCursor();
        if (!rendered || rendered.trim().length === 0) {
          rendered = 'AI 暂无回复，请重试。';
          targetEl.classList.add('ai-empty-fallback');
        }
        // C-5 修复：plainStream 模式保持纯文本输出（与流式阶段一致），
        // 不统一走 Markdown.render，避免纯文本流在结束时突变为 HTML 渲染
        // 导致 XSS 面扩大与样式跳变
        if (options.plainStream) {
          var pNode = ensurePlainTextNode();
          try { if (pNode.data !== rendered) pNode.data = rendered; } catch (e3) { pNode.textContent = rendered; }
        } else {
          patchInnerHTML(targetEl, renderRich(rendered));
        }
        targetEl.classList.remove(streamClass);
        if (typeof options.onRender === 'function') {
          try { options.onRender(rendered); } catch (e) {}
        }
        if (typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
        settleDrain(true);
      },
      stop: function () {
        if (cancelled) return;
        clearFrame();
        if (pending) emitText(true);
        if (ink) ink.clear();
        // ★ 停止时补移除光标并复位状态，避免流式结束光标残留
        finished = true;
        removeCursor();
        if (streamClass && targetEl) targetEl.classList.remove(streamClass);
        settleDrain(false);
      },
      cancel: function () {
        if (cancelled) return;
        cancelled = true;
        if (ink) ink.clear();
        settleDrain(false);
        clearFrame();
        removeCursor();
        pending = '';
        if (!finished) {
          try { if (targetEl) { delete targetEl.__xtjStreamHtml; targetEl.innerHTML = ''; } } catch (e) {}
        }
        if (streamClass && targetEl) targetEl.classList.remove(streamClass);
        // ★ 保留 targetEl 引用（cancelled 标志已使 append/flush/finish 短路）
      },
      // ★ 新增：供调用方感知取消/重建实例
      isCancelled: function () { return cancelled; },
      reset: function () {
        if (ink) ink.clear();
        settleDrain(false);
        clearFrame();
        cancelled = false;
        finished = false;
        paused = false;
        pending = '';
        rendered = '';
        pendingFirstReceivedAt = pendingLastReceivedAt = 0;
        lastParagraphBoundary = -1;
        plainMarkdownMode = !options.plainStream;
        plainMarkdownParagraph = plainMarkdownTextNode = null;
        plainTextBuffer = '';
        removeCursor();
        if (targetEl) { delete targetEl.__xtjStreamHtml; targetEl.replaceChildren(); }
        plainTextNode = null;
        if (streamClass && targetEl) targetEl.classList.remove(streamClass);
      }
    };
    return api;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.StreamRenderer = {
    create: createStreamRenderer
  };

})();
