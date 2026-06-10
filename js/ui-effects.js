/* ============================================================
   XTJ UI Effects Suite
   Algorithmic loading screen, click ripples, particle bursts,
   heart effects, and refined interaction animations.
   ============================================================ */
(function () {
  'use strict';

  var isDockTab = function (el) {
    return el && (el.classList.contains('dock-tab') || el.closest('.dock-tab'));
  };

  /* ==========================================================
     1. Loading Overlay with Algorithmic Flow-Field Particles
     ========================================================== */
  var loadingOverlay = null;
  var loadingCanvas = null;
  var loadingCtx = null;
  var lParticles = [];
  var lAnimId = null;
  var loadingResolve = null;

  var LPARTICLE_COUNT = 80;
  var L_Z_OFF = 0;

  function initLoadingCanvas() {
    loadingCanvas = document.createElement('canvas');
    loadingCanvas.className = 'xtj-loading-canvas';
    loadingCtx = loadingCanvas.getContext('2d');
    resizeLoadingCanvas();
    window.addEventListener('resize', resizeLoadingCanvas);
  }

  function resizeLoadingCanvas() {
    if (!loadingCanvas) return;
    loadingCanvas.width = window.innerWidth;
    loadingCanvas.height = window.innerHeight;
  }

  function createLParticles() {
    lParticles = [];
    for (var i = 0; i < LPARTICLE_COUNT; i++) {
      lParticles.push({
        x: Math.random() * loadingCanvas.width,
        y: Math.random() * loadingCanvas.height,
        vx: 0,
        vy: 0,
        size: 1.5 + Math.random() * 3,
        life: Math.random() * Math.PI * 2,
        baseHue: 140 + Math.random() * 80,
        trail: []
      });
    }
    L_Z_OFF = Math.random() * 1000;
  }

  function perlin3D(x, y, z) {
    var n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
    return n - Math.floor(n);
  }

  function flowAngle(x, y, t) {
    var n = 0;
    var amp = 1;
    var freq = 0.001 + (1 / (loadingCanvas ? Math.max(loadingCanvas.width, loadingCanvas.height) : 1000)) * 2.5;
    for (var o = 0; o < 3; o++) {
      n += amp * perlin3D(x * freq, y * freq, t + o * 100);
      freq *= 2.1;
      amp *= 0.5;
    }
    return n * Math.PI * 4;
  }

  function drawLoadingFrame(t) {
    if (!loadingCtx || !loadingCanvas) return;
    var w = loadingCanvas.width;
    var h = loadingCanvas.height;
    if (w === 0 || h === 0) return;

    loadingCtx.clearRect(0, 0, w, h);

    var cx = w / 2;
    var cy = h / 2;

    // draw flow-field trails
    for (var i = 0; i < lParticles.length; i++) {
      var p = lParticles[i];
      if (!p) continue;

      // soft reset if out of bounds
      if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) {
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.trail = [];
      }

      var angle = flowAngle(p.x, p.y, t * 0.00015 + L_Z_OFF);
      var speed = 0.4 + 0.15 * perlin3D(p.x * 0.003, p.y * 0.003, t * 0.0001);
      p.vx += Math.cos(angle) * speed * 0.04;
      p.vy += Math.sin(angle) * speed * 0.04;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.x += p.vx;
      p.y += p.vy;

      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 12) p.trail.shift();

      // draw trail
      var hue = (p.baseHue + t * 0.02) % 360;
      for (var j = 0; j < p.trail.length; j++) {
        var alpha = (j / p.trail.length) * 0.6;
        var trailSize = p.size * (0.3 + 0.7 * (j / p.trail.length));
        loadingCtx.beginPath();
        loadingCtx.arc(p.trail[j].x, p.trail[j].y, trailSize, 0, Math.PI * 2);
        loadingCtx.fillStyle = 'hsla(' + hue + ', 70%, 60%, ' + alpha + ')';
        loadingCtx.fill();
      }
    }

    // subtle radial glow at center
    var grad = loadingCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.4);
    grad.addColorStop(0, 'rgba(52, 211, 153, 0.04)');
    grad.addColorStop(0.5, 'rgba(96, 165, 250, 0.02)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    loadingCtx.fillStyle = grad;
    loadingCtx.fillRect(0, 0, w, h);

    // scattered ambient dots
    for (var k = 0; k < 8; k++) {
      var dx = cx + Math.cos(t * 0.0003 + k * 0.8) * Math.min(w, h) * 0.15;
      var dy = cy + Math.sin(t * 0.0004 + k * 0.8) * Math.min(w, h) * 0.15;
      var dotSize = 1 + perlin3D(dx * 0.01, dy * 0.01, t * 0.0001) * 2;
      loadingCtx.beginPath();
      loadingCtx.arc(dx, dy, dotSize, 0, Math.PI * 2);
      loadingCtx.fillStyle = 'hsla(' + ((160 + k * 30 + t * 0.01) % 360) + ', 60%, 70%, 0.08)';
      loadingCtx.fill();
    }
  }

  function startLoadingAnimation() {
    createLParticles();
    var start = performance.now();
    function frame(now) {
      var elapsed = now - start;
      drawLoadingFrame(elapsed);
      lAnimId = requestAnimationFrame(frame);
    }
    lAnimId = requestAnimationFrame(frame);
  }

  function stopLoadingAnimation() {
    if (lAnimId) {
      cancelAnimationFrame(lAnimId);
      lAnimId = null;
    }
    lParticles = [];
  }

  function createLoadingOverlay() {
    if (document.getElementById('xtj-loading-overlay')) return;
    initLoadingCanvas();

    var overlay = document.createElement('div');
    overlay.id = 'xtj-loading-overlay';
    overlay.className = 'xtj-loading-overlay';

    var content = document.createElement('div');
    content.className = 'xtj-loading-content';

    var title = document.createElement('h1');
    title.className = 'xtj-loading-title';
    title.textContent = 'XTJ';

    var sub = document.createElement('div');
    sub.className = 'xtj-loading-sub';
    sub.textContent = 'loading experience';

    var bar = document.createElement('div');
    bar.className = 'xtj-loading-bar';
    var fill = document.createElement('div');
    fill.className = 'xtj-loading-bar-fill';
    bar.appendChild(fill);

    content.appendChild(title);
    content.appendChild(sub);
    content.appendChild(bar);
    overlay.appendChild(loadingCanvas);
    overlay.appendChild(content);
    document.body.insertBefore(overlay, document.body.firstChild);

    loadingOverlay = overlay;
    startLoadingAnimation();
  }

  function dismissLoadingOverlay() {
    if (!loadingOverlay) return;
    stopLoadingAnimation();
    loadingOverlay.classList.add('is-done');
    setTimeout(function () {
      if (loadingOverlay && loadingOverlay.parentNode) {
        loadingOverlay.parentNode.removeChild(loadingOverlay);
      }
      loadingOverlay = null;
      loadingCanvas = null;
      loadingCtx = null;
      if (window.removeEventListener) {
        window.removeEventListener('resize', resizeLoadingCanvas);
      }
    }, 900);
  }

  // Auto-dismiss when body is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      createLoadingOverlay();
      // dismiss after a graceful minimum display time
      setTimeout(dismissLoadingOverlay, 2500);
    });
  } else {
    createLoadingOverlay();
    setTimeout(dismissLoadingOverlay, 2500);
  }

  /* ==========================================================
     2. Click Ripple Effect (excludes dock-tab buttons)
     ========================================================== */
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (isDockTab(target)) return;

    var btn = target.closest('.btn, .af-btn, .send-btn, .photo-wall-upload-btn, .theme-toggle-btn, .publish-btn, .filter-btn, .view-all-btn, .load-more-btn, .report-submit-btn, .auth-btn, .profile-action-btn, .post-action-btn, .chat-action-btn, .announcement-btn, .close-modal-btn, .modal-close-btn');
    if (!btn) return;

    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height);
    var x = e.clientX - rect.left - size / 2;
    var y = e.clientY - rect.top - size / 2;

    var ripple = document.createElement('span');
    ripple.className = 'xtj-ripple';
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    btn.style.position = btn.style.position || 'relative';
    btn.style.overflow = btn.style.overflow || 'hidden';
    btn.appendChild(ripple);

    // If btn doesn't have relative, apply it
    var cs = window.getComputedStyle(btn);
    if (cs.position === 'static') btn.style.position = 'relative';
    if (cs.overflow === 'visible') btn.style.overflow = 'hidden';

    setTimeout(function () {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 700);
  }, true);

  /* ==========================================================
     3. Particle Burst on Primary Buttons
     ========================================================== */
  function createParticleBurst(clientX, clientY, colorSet) {
    var container = document.createElement('div');
    container.className = 'xtj-particle-burst';
    container.style.left = clientX + 'px';
    container.style.top = clientY + 'px';
    document.body.appendChild(container);

    var colors = colorSet || ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'];

    for (var i = 0; i < 10; i++) {
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

    setTimeout(function () {
      if (container.parentNode) container.parentNode.removeChild(container);
    }, 1000);
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (isDockTab(target)) return;
    var btn = target.closest('.btn-primary, .report-submit-btn, .send-btn, .auth-btn');
    if (!btn) return;
    // spawn burst
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
     6. Global Performance: Will-Change Strategy
     ========================================================== */
  document.addEventListener('DOMContentLoaded', function () {
    // Add will-change hints to elements that animate
    var animatedEls = document.querySelectorAll('.post.visible, .modal-box.active, .toast');
    for (var i = 0; i < animatedEls.length; i++) {
      if (!animatedEls[i].style.willChange) {
        animatedEls[i].style.willChange = 'transform, opacity';
      }
    }
  });

  /* ==========================================================
     7. Theme Toggle Button Enhancement
     ========================================================== */
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('#themeToggle, .theme-toggle-btn');
    if (!toggle || isDockTab(e.target)) return;
    var orb = toggle.querySelector('.theme-toggle-orb');
    if (orb) {
      orb.style.transition = 'transform 0.4s cubic-bezier(0.18, 1.3, 0.28, 1), background 0.4s ease';
    }
  }, true);

  /* ==========================================================
     8. Expose API
     ========================================================== */
  window.XTJEffects = {
    dismissLoading: dismissLoadingOverlay,
    ripple: function (el) {
      // manual trigger if needed
    },
    particleBurst: createParticleBurst,
    heartBurst: window.xtjHeartBurst
  };

})();
