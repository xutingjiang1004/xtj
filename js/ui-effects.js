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

  function ensureRippleLayer(btn) {
    if (!btn || !btn.ownerDocument) return null;
    var cs;
    try { cs = window.getComputedStyle(btn); } catch (e) { return null; }
    if (cs.position === 'static') btn.style.position = 'relative';

    var layer = btn.__xtjRippleLayer;
    if (layer && layer.parentNode === btn) return layer;

    layer = document.createElement('span');
    layer.className = 'xtj-ripple-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.position = 'absolute';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.right = '0';
    layer.style.bottom = '0';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.borderRadius = 'inherit';
    btn.appendChild(layer);
    btn.__xtjRippleLayer = layer;
    return layer;
  }

  function spawnRipple(btn, clientX, clientY) {
    if (getPerfMode() === 'lite' || motionReduced()) return;
    if (!btn || !btn.getBoundingClientRect) return;
    var rect;
    try { rect = btn.getBoundingClientRect(); } catch (e) { return; }
    var size = Math.max(rect.width, rect.height);
    var x = (typeof clientX === 'number' ? clientX : rect.left + rect.width / 2) - rect.left - size / 2;
    var y = (typeof clientY === 'number' ? clientY : rect.top + rect.height / 2) - rect.top - size / 2;
    var layer = ensureRippleLayer(btn);

    var ripple = document.createElement('span');
    ripple.className = 'xtj-ripple';
    ripple.style.position = 'absolute';
    ripple.style.pointerEvents = 'none';
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    layer.appendChild(ripple);

    setTimeout(function () {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 700);
  }

  /* ==========================================================
     1. Click Ripple Effect (excludes dock-tab buttons)
     ========================================================== */
  document.addEventListener('click', function (e) {
    if (getPerfMode() === 'lite' || motionReduced()) return;
    var target = e.target;
    if (isDockTab(target)) return;
    if (target.closest('#themeToggle, .theme-toggle-btn')) return;
    if (target.closest(rippleSkipSelector)) return;

    var btn = target.closest(rippleButtonSelector);
    if (!btn) return;

    spawnRipple(btn, e.clientX, e.clientY);
  }, true);

  /* ==========================================================
     3. Particle Burst on Primary Buttons
     ========================================================== */
  function createParticleBurst(clientX, clientY, colorSet) {
    if (motionReduced()) return;
    var perfMode = getPerfMode();
    if (perfMode === 'lite' || perfMode === 'balanced') return;
    var container = document.createElement('div');
    container.className = 'xtj-particle-burst';
    container.style.left = clientX + 'px';
    container.style.top = clientY + 'px';
    document.body.appendChild(container);

    var colors = colorSet || ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'];

    for (var i = 0; i < 6; i++) {
      var p = document.createElement('div');
      p.className = 'xtj-particle';
      var angle = Math.random() * Math.PI * 2;
      var dist = 30 + Math.random() * 60;
      p.style.setProperty('--px', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--py', Math.sin(angle) * dist + 'px');
      p.style.width = (3 + Math.random() * 5) + 'px';
      p.style.height = p.style.width;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      container.appendChild(p);
    }

    var removeBurst = function () {
      if (container.parentNode) container.parentNode.removeChild(container);
    };
    container.addEventListener('animationend', removeBurst, { once: true });
    setTimeout(removeBurst, 1000);
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (isDockTab(target)) return;
    var btn = target.closest('.btn-primary, .send-btn');
    if (!btn) return;
    createParticleBurst(e.clientX, e.clientY);
  }, true);

  /* ==========================================================
     4. Enhanced Heart Effect for Like Buttons
     ========================================================== */
  window.xtjHeartBurst = function (el) {
    if (!el || isDockTab(el)) return;
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top;

    var container = document.createElement('div');
    container.className = 'xtj-heart-burst';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'fixed';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '9999';
    document.body.appendChild(container);

    var heartSymbols = ['♥', '❤', '💚', '💙', '💜', '🧡', '💗', '❤️‍🔥'];
    for (var i = 0; i < 8; i++) {
      var heart = document.createElement('div');
      heart.className = 'xtj-heart-particle';
      heart.textContent = heartSymbols[i % heartSymbols.length];

      var a1 = Math.random() * Math.PI * 2;
      var d1 = 20 + Math.random() * 30;
      var a2 = Math.random() * Math.PI * 2;
      var d2 = 40 + Math.random() * 60;

      heart.style.setProperty('--hx1', Math.cos(a1) * d1 + 'px');
      heart.style.setProperty('--hy1', -d1 + 'px');
      heart.style.setProperty('--hx2', Math.cos(a2) * d2 + 'px');
      heart.style.setProperty('--hy2', -(20 + Math.random() * 50) + 'px');
      heart.style.left = (cx - 8) + 'px';
      heart.style.top = (cy - 8) + 'px';

      var hue = (i * 40 + Math.random() * 30) % 360;
      heart.style.color = 'hsl(' + hue + ', 80%, 60%)';
      heart.style.textShadow = '0 0 6px hsla(' + hue + ', 80%, 60%, 0.5)';
      container.appendChild(heart);
    }

    setTimeout(function () {
      if (container.parentNode) container.parentNode.removeChild(container);
    }, 1300);
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
