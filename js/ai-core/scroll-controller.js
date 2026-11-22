// ==================== AI Core: Scroll Controller ====================
// Unified auto-scroll: follows bottom when user is there, pauses when user scrolls up,
// shows "new messages" banner, scrolls on click. Does NOT hijack page scroll.
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};

  var NEAR_BOTTOM_THRESHOLD = 80; // px

  function createScrollController(container, options) {
    options = options || {};
    // ★ 复用缓存实例：重复 create 不再重复挂 scroll 监听与 banner DOM
    if (container && container._xtjScrollCtrl) return container._xtjScrollCtrl;
    var pinned = true; // user is at bottom, auto-scroll active
    var newContentBanner = null;
    var bannerVisible = false;
    var scrollHandler = null;
    var lastScrollTop = 0;
    var scrollTicking = false;
    var programmaticScroll = false; // 程序自身滚动标志，避免 scrollToBottom 被当成用户上滑

    function isNearBottom(el) {
      if (!el) return true;
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < NEAR_BOTTOM_THRESHOLD;
    }

    function scrollToBottom(force) {
      if (!container) return;
      if (force || pinned) {
        programmaticScroll = true;
        container.scrollTop = container.scrollHeight;
        lastScrollTop = container.scrollTop;
        // 用 rAF 复位，确保本次 programmatic scroll 事件已被消费
        var rafReset = window.requestAnimationFrame || function (cb) { setTimeout(cb, 16); };
        rafReset(function () { programmaticScroll = false; });
      }
    }

    function onScroll() {
      if (!container) return;
      // ★ 修复(F1)：同步阶段立即判定"用户上滑"并解钉。原实现把 pinned 更新推迟到
      //   rAF，同帧内 onNewContent() 抢先 scrollToBottom() 把用户强行拉回底部。
      var currentTop = container.scrollTop;
      if (!programmaticScroll) {
        // 用户主动向上滚动（top 减小）或明显不在底部 → 立即解钉
        if (currentTop < lastScrollTop - 1 || !isNearBottom(container)) {
          pinned = false;
        } else if (isNearBottom(container)) {
          pinned = true;
          hideBanner();
        }
        lastScrollTop = currentTop;
      } else {
        lastScrollTop = currentTop;
      }
    }

    function ensureBanner() {
      if (newContentBanner && newContentBanner.parentNode) return newContentBanner;
      newContentBanner = document.createElement('div');
      newContentBanner.className = 'ai-new-content-banner';
      newContentBanner.textContent = '有新回复';
      newContentBanner.style.cssText =
        'position:sticky;bottom:8px;margin:0 auto;display:none;text-align:center;' +
        'cursor:pointer;padding:6px 16px;border-radius:16px;background:var(--ai-accent,#3b82f6);' +
        'color:#fff;font-size:13px;z-index:5;width:fit-content;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
      newContentBanner.addEventListener('click', function () {
        pinned = true;
        scrollToBottom(true);
        hideBanner();
      });
      if (container) container.appendChild(newContentBanner);
      return newContentBanner;
    }

    function showBanner() {
      if (bannerVisible) return;
      bannerVisible = true;
      var banner = ensureBanner();
      banner.style.display = 'block';
    }

    function hideBanner() {
      bannerVisible = false;
      if (newContentBanner) {
        newContentBanner.style.display = 'none';
      }
    }

    function onNewContent() {
      if (pinned) {
        scrollToBottom(false);
      } else {
        showBanner();
      }
    }

    // ★ 修复(F2)：wheel/touch 主动上滑时立即解钉，抢在流式 onNewContent 之前，
    //   避免"轻滑上滚被下一帧拉回底部"。均为 passive，仅读不拦默认行为。
    function onWheel(e) {
      if (!e || typeof e.deltaY !== 'number') return;
      if (e.deltaY < 0) { pinned = false; }
    }
    function onTouchStart(e) {
      if (!e || !e.touches || !e.touches.length) return;
      onTouchStart._y = e.touches[0].clientY;
    }
    function onTouchMove(e) {
      if (!e || !e.touches || !e.touches.length) return;
      var prevY = onTouchStart._y;
      if (typeof prevY === 'number' && e.touches[0].clientY > prevY) {
        pinned = false; // 手指向下滑 = 看历史消息
      }
      onTouchStart._y = e.touches[0].clientY;
    }

    function attach() {
      if (!container) return;
      container.addEventListener('scroll', onScroll, { passive: true });
      container.addEventListener('wheel', onWheel, { passive: true });
      container.addEventListener('touchstart', onTouchStart, { passive: true });
      container.addEventListener('touchmove', onTouchMove, { passive: true });
    }

    function detach() {
      if (!container) return;
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      hideBanner();
      if (newContentBanner && newContentBanner.parentNode) {
        try { newContentBanner.parentNode.removeChild(newContentBanner); } catch (e) {}
      }
      newContentBanner = null;
      // ★ 清理缓存引用，允许后续重新创建
      if (container._xtjScrollCtrl === api) container._xtjScrollCtrl = null;
      container = null;
    }

    function reset() {
      pinned = true;
      hideBanner();
      scrollToBottom(true);
    }

    function isPinned() { return pinned; }

    // Auto-attach
    attach();

    var api = {
      scrollToBottom: scrollToBottom,
      onNewContent: onNewContent,
      isPinned: isPinned,
      reset: reset,
      detach: detach,
      isNearBottom: function () { return isNearBottom(container); }
    };
    // ★ 缓存实例供重复 create 复用
    if (container) container._xtjScrollCtrl = api;
    return api;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.Scroll = {
    create: createScrollController,
    NEAR_BOTTOM_THRESHOLD: NEAR_BOTTOM_THRESHOLD
  };

})();