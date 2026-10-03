// ==================== AI Core: Stream Renderer ====================
// Extracted from createSmoothTextRenderer in ai-agent.js.
// Provides text buffering, rAF-scheduled DOM updates, and cursor management.
// Designed for both Cat AI (rich markdown) and Code workspace (plain text).
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};

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
  function patchInnerHTML(targetEl, html) {
    if (!targetEl) return;
    function children(parent, wanted, depth) {
      var old = Array.from(parent.childNodes).filter(function(n) { return !(n.nodeType === 1 && n.classList.contains('ai-stream-cursor')); });
      var pos = 0;
      Array.from(wanted.childNodes).forEach(function(want) {
        var have = old[pos++];
        if (!have) { parent.insertBefore(want.cloneNode(true), parent.querySelector(':scope > .ai-stream-cursor')); return; }
        if (have.nodeType === want.nodeType && (want.nodeType === 3 ? have.data === want.data : have.isEqualNode(want))) return;
        if (have.nodeType === 3 && want.nodeType === 3) { have.data = want.data; return; }
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
    var lastFrameTime = 0;
    var charsPerMs = options.charsPerMs != null
      ? options.charsPerMs
      : 0.14;
    if (charsPerMs > 1) charsPerMs /= 1000;
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
        // Keep catch-up bounded so a large packet does not appear in one jump.
        var frameBudget = Math.min(32, Math.max(1, Math.floor(budget || 4), Math.ceil(pending.length / 20)));
        var maxChunkOpt = options.maxChunk || 48;
        while (pending && next.length < frameBudget) {
          var chunk = takeSmoothChunk(pending, Object.assign({}, options, { maxChunk: Math.min(maxChunkOpt, frameBudget - next.length) }));
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
        // Reconcile only changed nodes on each scheduled display frame.
        var now = Date.now();
        var _renderGap = 0; // requestAnimationFrame already limits each patch to a display frame.
        if (!targetEl._lastRender || now - targetEl._lastRender > _renderGap || !pending) {
          patchInnerHTML(targetEl, renderRich(rendered));
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
      var budget = Math.max(1, Math.floor(Math.min(40, elapsed || 16) * charsPerMs));
      emitText(false, budget);
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
        if (!pending) lastFrameTime = 0;
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
        if (cancelled || !targetEl) return Promise.resolve(false);
        if (drainState) return drainState.promise;
        if (finished) return Promise.resolve(true);
        var final = typeof finalText === 'string' && finalText.length ? finalText : rendered + pending;
        // A sanitized replacement must take effect immediately. Only an unseen
        // suffix can follow the existing stream without replaying old text.
        if (final.indexOf(rendered) !== 0 || reducedMotion || !final) {
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
          try { pNode.data = rendered; } catch (e3) { pNode.textContent = rendered; }
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
        // ★ 停止时补移除光标并复位状态，避免流式结束光标残留
        finished = true;
        removeCursor();
        if (streamClass && targetEl) targetEl.classList.remove(streamClass);
        settleDrain(false);
      },
      cancel: function () {
        if (cancelled) return;
        cancelled = true;
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
        settleDrain(false);
        clearFrame();
        cancelled = false;
        finished = false;
        paused = false;
        pending = '';
        rendered = '';
        plainTextBuffer = '';
        lastFrameTime = 0;
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