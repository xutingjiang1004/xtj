// ==================== AI Core: Stream Renderer ====================
// Extracted from createSmoothTextRenderer in ai-agent.js.
// Provides text buffering, rAF-scheduled DOM updates, and cursor management.
// Designed for both Cat AI (rich markdown) and Code workspace (plain text).
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};
  var Markdown = CORE.Markdown;

  function createStreamRenderer(targetEl, options) {
    options = options || {};
    var reducedMotion = (function () {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    })();
    var pending = '';
    var rendered = '';
    var rafId = 0;
    var cancelled = false;
    var finished = false;
    var paused = false;
    var streamClass = options.streamClass || 'ai-streaming-soft';
    var requestFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (cb) { return setTimeout(cb, 16); };
    var cancelFrame = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
    var lastFrameTime = 0;
    var charsPerMs = options.plainStream ? 0.55 : 0.7;
    // plainStream mode: reuse single text node to avoid per-frame reflow
    var plainTextNode = null;
    var plainTextBuffer = '';
    // Cursor element
    var cursor = null;

    function ensureCursor() {
      if (cursor || finished || cancelled) return;
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
      var chunk = text.slice(0, maxChunk);
      for (var i = 0; i < breakChars.length; i++) {
        var idx = chunk.lastIndexOf(breakChars[i]);
        if (idx > maxChunk * 0.4) {
          return text.slice(0, idx + 1);
        }
      }
      return chunk;
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
        var frameBudget = Math.max(1, Math.floor(budget || 16));
        while (pending && next.length < frameBudget) {
          var chunk = takeSmoothChunk(pending, Object.assign({}, options, { maxChunk: Math.min(options.maxChunk || 16, frameBudget - next.length) }));
          if (!chunk) break;
          next += chunk;
          pending = pending.slice(chunk.length);
        }
      }
      if (!next) return;
      rendered += next;
      if (options.plainStream) {
        plainTextBuffer += next;
        var node = ensurePlainTextNode();
        try { node.data = plainTextBuffer; } catch (e) { node.textContent = plainTextBuffer; }
      } else {
        var now = Date.now();
        if (!targetEl._lastRender || now - targetEl._lastRender > 50 || !pending) {
          targetEl.innerHTML = Markdown.render(rendered);
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
      append: function (text) {
        if (cancelled || !targetEl || !text || finished) return;
        pending += String(text);
        if (!paused) schedule();
      },
      flush: function () {
        if (cancelled || !targetEl) return;
        clearFrame();
        emitText(true);
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
      finish: function (finalText) {
        if (cancelled || !targetEl) return;
        clearFrame();
        finished = true;
        paused = false;
        if (typeof finalText === 'string' && finalText.length > 0) rendered = finalText;
        pending = '';
        removeCursor();
        if (!rendered || rendered.trim().length === 0) {
          rendered = 'AI 暂无回复，请重试。';
          targetEl.classList.add('ai-empty-fallback');
        }
        targetEl.innerHTML = Markdown.render(rendered);
        targetEl.classList.remove(streamClass);
        if (typeof options.onRender === 'function') {
          try { options.onRender(rendered); } catch (e3) {}
        }
        if (typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
      },
      stop: function () {
        if (cancelled) return;
        clearFrame();
        if (pending) emitText(true);
      },
      cancel: function () {
        if (cancelled) return;
        cancelled = true;
        clearFrame();
        removeCursor();
        pending = '';
        if (!finished) {
          try { if (targetEl) targetEl.innerHTML = ''; } catch (e) {}
        }
        targetEl = null;
      }
    };
    return api;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.StreamRenderer = {
    create: createStreamRenderer
  };

})();