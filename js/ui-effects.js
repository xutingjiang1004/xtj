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

  /* 全局 ripple / 中心波纹已全面关闭（用户明确不要中间固定阴影反馈） */
  function ripple() {
    return;
  }

  window.xtjHeartBurst = heartBurst;
  window.XTJEffects = {
    ripple: ripple,
    particleBurst: heartBurst,
    heartBurst: heartBurst
  };

  /* 不再绑定 pointerdown ripple；仅保留点赞心形粒子 */
})();
