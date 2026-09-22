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
    var kids = targetEl.childNodes;
    if (!kids || kids.length === 0) { targetEl.innerHTML = html; return; }
    try {
      var holder = document.createElement('div');
      holder.innerHTML = html;
      var next = holder.childNodes;
      if (next.length < kids.length || next.length - kids.length > 4) {
        targetEl.innerHTML = html;
        return;
      }
      for (var i = 0; i < next.length; i++) {
        var want = next[i];
        var have = kids[i];
        if (!have) { targetEl.appendChild(want.cloneNode(true)); continue; }
        if (have.outerHTML === want.outerHTML) continue;   // 未变化：不碰
        targetEl.replaceChild(want.cloneNode(true), have);
      }
      while (targetEl.childNodes.length > next.length) {
        targetEl.removeChild(targetEl.lastChild);
      }
    } catch (e) {
      try { targetEl.innerHTML = html; } catch (e2) {}
    }
  }

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
    var charsPerMs = options.charsPerMs != null
      ? options.charsPerMs
      : 100;
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
        // ★ 2026-09-17 流动性优化：与 ai-agent.js 内实现保持同一算法
        //   （积压门槛 64 / 系数 0.62、0.40 / 3 帧追平保护），
        //   避免两条渲染路径观感不一致。
        var frameBudget = Math.max(12, Math.floor(budget || 24));
        if (pending.length > 64) frameBudget = Math.max(frameBudget, Math.floor(pending.length * 0.62));
        else if (pending.length > 32) frameBudget = Math.max(frameBudget, Math.floor(pending.length * 0.40));
        else if (pending.length > 12) frameBudget = Math.max(frameBudget, 18);
        if (pending.length / frameBudget > 3) frameBudget = Math.floor(pending.length / 3);
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
        // ★ 2026-09-22 流式卡顿修复：整体渲染 + 增量补丁落地。
        //   卡顿来自每帧重建整棵 DOM 子树（随长度线性变重），而非解析本身。
        //   改为只替换真正变化的节点后，门限可从 90/140ms 收紧到 48/64ms，
        //   文字接近逐帧渗出，得到 Siri 式的连续流淌观感。
        var now = Date.now();
        var _renderGap = rendered.length < 600 ? 48 : 64;
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
          targetEl.innerHTML = renderRich(rendered);
        }
        targetEl.classList.remove(streamClass);
        if (typeof options.onRender === 'function') {
          try { options.onRender(rendered); } catch (e) {}
        }
        if (typeof options.onDone === 'function') {
          try { options.onDone(); } catch (e) {}
        }
      },
      stop: function () {
        if (cancelled) return;
        clearFrame();
        if (pending) emitText(true);
        // ★ 停止时补移除光标并复位状态，避免流式结束光标残留
        finished = true;
        removeCursor();
        if (streamClass && targetEl) targetEl.classList.remove(streamClass);
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
        // ★ 保留 targetEl 引用（cancelled 标志已使 append/flush/finish 短路）
      },
      // ★ 新增：供调用方感知取消/重建实例
      isCancelled: function () { return cancelled; },
      reset: function () {
        cancelled = false;
        finished = false;
        paused = false;
        pending = '';
        rendered = '';
        plainTextBuffer = '';
        lastFrameTime = 0;
        removeCursor();
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