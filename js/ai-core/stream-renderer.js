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
    slot.owner = null; slot.highlight = null; slot.animation = null;
    if (animation) { animation.onfinish = null; animation.oncancel = null; try { animation.cancel(); } catch (_) {} }
  }
  function createInkReveal(target, options) {
    options = options || {};
    if (!target || !(options.inkReveal === true || (target.matches && target.matches('.ai-msg-bubble,.ai-reasoning-segment,.ai-think-answer')))) return null;
    var pending = [], theme = null, owner = {};
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
    function commit() {
      try {
      var changes = pending; pending = [];
      if (!changes.length) return;
      if (motionOff()) { clear(); return; }
      if (!prepareInk()) return;
      var graphemes = [];
      changes.forEach(function(change) {
        var node = change.node;
        if (!node.isConnected || !target.contains(node)) return;
        // Limit work per frame for a large packet. Text itself is never delayed.
        var start = Math.max(change.start, change.end - 128), text = node.data.slice(start, change.end);
        if (start > change.start && /[\uDC00-\uDFFF]/.test(text.charAt(0))) { start++; text = text.slice(1); }
        if (window.Intl && Intl.Segmenter) {
          var segmenter = createInkReveal.segmenter || (createInkReveal.segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }));
          for (var item of segmenter.segment(text)) graphemes.push({ node: node, start: start + item.index, end: start + item.index + item.segment.length });
        } else {
          var offset = start;
          Array.from(text).forEach(function(character) { graphemes.push({ node: node, start: offset, end: offset + character.length }); offset += character.length; });
        }
      });
      var lite = liteDevice();
      graphemes = graphemes.slice(lite ? -12 : -48);
      if (!graphemes.length) return;
      var currentTheme = document.documentElement.getAttribute('data-theme') || '';
      if (theme !== currentTheme) {
        theme = currentTheme;
        target.style.setProperty('--xtj-ai-ink-color', getComputedStyle(target).color);
      }
      var free = inkSlots.filter(function(slot) { return !slot.owner; });
      // Larger received groups ripple in two or four short cohorts. Small
      // packets animate together as they arrive from the network.
      var lanes = !lite && graphemes.length >= 8 && free.length >= 4 ? 4 : !lite && graphemes.length >= 4 && free.length >= 2 ? 2 : 1;
      var selected = free.slice(0, lanes);
      if (!selected.length) {
        var active = inkSlots.find(function(slot) { return slot.owner === owner && slot.highlight && slot.highlight.size < 64; });
        if (active) selected = [active];
      }
      if (!selected.length) return;
      var fresh = [];
      selected.forEach(function(slot) {
        if (!slot.owner) { slot.owner = owner; slot.highlight = new Highlight(); fresh.push(slot); }
      });
      graphemes.forEach(function(part, index) {
        var slot = selected[Math.min(selected.length - 1, Math.floor(index * selected.length / graphemes.length))];
        if (slot.highlight.size >= 64) return;
        try { var range = document.createRange(); range.setStart(part.node, part.start); range.setEnd(part.node, part.end); slot.highlight.add(range); } catch (_) {}
      });
      fresh.forEach(function(slot, index) {
        try {
          CSS.highlights.set(slot.name, slot.highlight);
          var from = {}, to = {}; from[slot.prop] = '0'; to[slot.prop] = '1';
          slot.animation = target.animate([from, to], { duration: 120, delay: index * 18, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
          slot.animation.onfinish = function() { releaseInkSlot(slot); };
          slot.animation.oncancel = function() { releaseInkSlot(slot); };
        } catch (_) { releaseInkSlot(slot); }
      });
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

  /* ── 流式落地的增量补丁（2026-09-22）──────────────────────────────────
     卡顿根因不是 Markdown 解析（实测 12000 字符仅 0.33ms），而是
     `innerHTML = html` 每帧重建整棵 DOM 子树 —— 正文越长节点越多，每帧
     成本线性增长。这里把整体渲染结果放进游离容器解析，与现有子节点逐位
     比对，只替换真正变化的部分，前面未变的节点浏览器完全不碰。
     任何异常都回退整段替换，正确性优先。 */
  function patchInnerHTML(targetEl, html, ink) {
    if (!targetEl) return;
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
  }

  function createStreamRenderer(targetEl, options) {
    options = options || {};
    var ink = CORE.InkReveal.create(targetEl, options);
    var prefix = '', markup = '', cacheVerified = false, cacheDisabled = false, blockCache = new Map();
    var cachedMarkdown = getMarkdown() && getMarkdown().render;
    function renderStreamMarkdown(text) {
      var currentMarkdown = getMarkdown() && getMarkdown().render;
      if (currentMarkdown !== cachedMarkdown) {
        cachedMarkdown = currentMarkdown; prefix = ''; markup = ''; cacheVerified = false; cacheDisabled = false; blockCache.clear();
      }
      if (cacheDisabled) return renderRich(text);
      if (prefix && text.indexOf(prefix) !== 0) { prefix = ''; markup = ''; cacheVerified = false; blockCache.clear(); }
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
      var result = markup + renderRich(tail.slice(committed));
      if (!cacheVerified && prefix) {
        var full = renderRich(text);
        if (result !== full) { cacheDisabled = true; prefix = ''; markup = ''; blockCache.clear(); return full; }
        cacheVerified = true;
      }
      return result;
    }
    var reducedMotion = (function () {
      try { return document.documentElement.getAttribute('data-xtj-motion') === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    })();
    var pending = '';
    var rendered = '';
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
      var next = pending;
      pending = '';
      if (!next) return;
      rendered += next;
      if (ink) ink.begin();
      if (options.plainStream) {
        plainTextBuffer += next;
        var node = ensurePlainTextNode();
        var oldLength = node.length;
        try { node.appendData(next); if (ink) ink.record(node, oldLength, node.length); } catch (e) { node.textContent = plainTextBuffer; }
      } else {
        // The display scheduler already bounds patches to a frame. Wall-clock
        // precision or clock corrections must not suppress an accepted frame.
        patchInnerHTML(targetEl, renderStreamMarkdown(rendered), ink);
      }
      if (ink) ink.commit();
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
      append: function (text) {
        if (cancelled || !targetEl || !text || finished) return;
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
          try { if (targetEl) targetEl.innerHTML = ''; } catch (e) {}
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
        plainTextBuffer = '';
        removeCursor();
        if (targetEl) targetEl.replaceChildren();
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
