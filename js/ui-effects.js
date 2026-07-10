/* ============================================================
   XTJ UI Effects Suite
   Click ripples, particle bursts,
   heart effects, and refined interaction animations.
   ============================================================ */
(function () {
  'use strict';

  var isDockTab = function (el) {
    return el && (el.classList.contains('dock-tab') || el.closest('.dock-tab'));
  };

  var rippleButtonSelector = '.btn-primary, .send-btn, .publish-btn, .auth-btn, .photo-wall-upload-btn, .load-more-btn, .view-all-btn';
  var rippleSkipSelector = '.announcement-btn, .report-btn';

  function getPerfMode() {
    var root = document.documentElement;
    if (!root) return 'full';
    if (root.classList.contains('perf-lite')) return 'lite';
    if (root.classList.contains('perf-balanced')) return 'balanced';
    return 'full';
  }

  function motionReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function spawnRipple() {
    return;
  }

  function createParticleBurst() {
    return;
  }

  /* ==========================================================
     4. Enhanced Heart Effect for Like Buttons
     ========================================================== */
  window.xtjHeartBurst = function () {
    return;
  };

  /* ==========================================================
     5. Enhanced Post Entry (IntersectionObserver refinement)
     ========================================================== */
  // Also is already handled in core.js's getPostVisibilityObserver
  // but we enhance with better timing

  /* ==========================================================
     8. Expose API
     ========================================================== */
  window.XTJEffects = {
    ripple: function (el) {
      if (!el || isDockTab(el) || (el.closest && el.closest(rippleSkipSelector))) return;
      spawnRipple(el);
    },
    particleBurst: createParticleBurst,
    heartBurst: window.xtjHeartBurst
  };

})();
