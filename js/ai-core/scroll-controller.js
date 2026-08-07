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

    function isNearBottom(el) {
      if (!el) return true;
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < NEAR_BOTTOM_THRESHOLD;
    }

    function scrollToBottom(force) {
      if (!container) return;
      if (force || pinned) {
        container.scrollTop = container.scrollHeight;
      }
    }

    function onScroll() {
      if (!container) return;
      if (scrollTicking) return;
      scrollTicking = true;
      var raf = window.requestAnimationFrame || function (cb) { setTimeout(cb, 16); };
      raf(function () {
        scrollTicking = false;
        if (!container) return;
        var near = isNearBottom(container);
        if (near) {
          pinned = true;
          hideBanner();
        } else {
          pinned = false;
        }
        lastScrollTop = container.scrollTop;
      });
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

    function attach() {
      if (!container) return;
      container.addEventListener('scroll', onScroll, { passive: true });
    }

    function detach() {
      if (!container) return;
      container.removeEventListener('scroll', onScroll);
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