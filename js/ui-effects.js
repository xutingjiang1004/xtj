/**
 * UI micro-effects: button ripple + heart particle burst.
 * Respects perf-lite and prefers-reduced-motion. Does not touch dock.
 */
(function () {
  'use strict';

  function reduced() {
    try {
      if (window.__xtjPerfProfile === 'lite') return true;
      if (document.documentElement.classList.contains('perf-lite')) return true;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch (e) {}
    return false;
  }

  function isDock(target) {
    return !!(target && target.closest && target.closest('#dockBar, .dock-bar, .dock-tab'));
  }

  function heartBurst(originEl, options) {
    if (reduced() || !originEl) return;
    options = options || {};
    var count = options.count || (window.__xtjPerfProfile === 'balanced' ? 6 : 10);
    var rect = originEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var layer = document.createElement('div');
    layer.className = 'xtj-heart-burst-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99990;overflow:hidden;';
    document.body.appendChild(layer);
    var colors = ['#ff6b8a', '#ff8fab', '#ffb3c6', '#ff4d6d', '#f72585'];
    for (var i = 0; i < count; i++) {
      var heart = document.createElement('span');
      heart.className = 'xtj-heart-particle';
      heart.textContent = '❤';
      var angle = (Math.PI * 2 * i) / count + (Math.random() * 0.4 - 0.2);
      var dist = 28 + Math.random() * 42;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist - 18;
      heart.style.cssText = [
        'position:fixed',
        'left:' + cx + 'px',
        'top:' + cy + 'px',
        'color:' + colors[i % colors.length],
        'font-size:' + (11 + Math.random() * 8) + 'px',
        'transform:translate(-50%,-50%) scale(0.3)',
        'opacity:1',
        'pointer-events:none',
        'transition:transform 0.7s cubic-bezier(.18,.89,.32,1.2), opacity 0.7s ease',
        'will-change:transform,opacity'
      ].join(';');
      layer.appendChild(heart);
      (function (node, x, y) {
        requestAnimationFrame(function () {
          node.style.transform = 'translate(calc(-50% + ' + x + 'px), calc(-50% + ' + y + 'px)) scale(1)';
          node.style.opacity = '0';
        });
      })(heart, dx, dy);
    }
    setTimeout(function () {
      if (layer.parentNode) layer.remove();
    }, 820);
  }

  function ripple(target, event) {
    if (reduced() || !target || isDock(target)) return;
    var btn = target.closest
      ? target.closest('button, .btn, .action-btn, .send-btn, .desktop-nav-item, .profile-setting-item, .ai-chat-send, .dt-action-btn')
      : null;
    if (!btn || isDock(btn)) return;
    var style = window.getComputedStyle(btn);
    if (style.position === 'static') btn.style.position = 'relative';
    if (style.overflow === 'visible') btn.style.overflow = 'hidden';
    var rect = btn.getBoundingClientRect();
    var x = (event && event.clientX != null ? event.clientX : rect.left + rect.width / 2) - rect.left;
    var y = (event && event.clientY != null ? event.clientY : rect.top + rect.height / 2) - rect.top;
    var size = Math.max(rect.width, rect.height) * 1.4;
    var wave = document.createElement('span');
    wave.className = 'xtj-ripple-wave';
    wave.style.cssText = [
      'position:absolute',
      'left:' + (x - size / 2) + 'px',
      'top:' + (y - size / 2) + 'px',
      'width:' + size + 'px',
      'height:' + size + 'px',
      'border-radius:50%',
      'background:rgba(255,255,255,.35)',
      'transform:scale(0)',
      'opacity:.7',
      'pointer-events:none',
      'transition:transform .45s ease, opacity .45s ease'
    ].join(';');
    btn.appendChild(wave);
    requestAnimationFrame(function () {
      wave.style.transform = 'scale(1)';
      wave.style.opacity = '0';
    });
    setTimeout(function () {
      if (wave.parentNode) wave.remove();
    }, 480);
  }

  window.xtjHeartBurst = heartBurst;
  window.XTJEffects = {
    ripple: ripple,
    particleBurst: heartBurst,
    heartBurst: heartBurst
  };

  if (!window.__xtjUiEffectsBound) {
    window.__xtjUiEffectsBound = true;
    document.addEventListener(
      'pointerdown',
      function (e) {
        if (!e.target) return;
        if (isDock(e.target)) return;
        try {
          ripple(e.target, e);
        } catch (err) {}
      },
      true
    );
  }
})();
