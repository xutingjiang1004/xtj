(function () {
  'use strict';
  // A stalled request does not emit error. Keep original images recoverable,
  // Bound every scheduled request, including requests scrolled out of view.
  var selector = '.post-media-cell img[data-media-url], #photoPreviewImage';
  var tracked = new Map();
  var running = 0;
  window.xtjPostImageScheduling = true;
  function release(state) { if (state.loading) { state.loading = false; running--; } }
  function activePanel(img) {
    var panel = img.closest('.dock-panel');
    return !panel || panel.classList.contains('active');
  }
  function done(img) { return img.complete && img.naturalWidth > 0; }
  function pump() {
    var waiting = Array.from(tracked.entries()).filter(function (entry) {
      // 已经加载完成的图不再参与排队：长列表滚到后面时，tracked 里会有上百个
      // 已完成的条目，每帧遍历它们会让滚动越来越卡，也挤占真正待加载图的位置。
      if (done(entry[0])) return false;
      return entry[1].visible && entry[0].isConnected && activePanel(entry[0]) && entry[0].getAttribute('data-post-src') && !entry[0].getAttribute('src');
    });
    waiting.sort(function (a, b) {
      var ar = a[0].getBoundingClientRect(), br = b[0].getBoundingClientRect();
      return Math.max(0, ar.top, -ar.bottom) - Math.max(0, br.top, -br.bottom);
    });
    // 并发从 4 提到 6：深列表里每个图片都要走一次鉴权 + Storage 签名，
    // 4 个并发时快速滚动会明显排队，用户看到的就是「下面的图一直不出来」。
    while (running < 6 && waiting.length) {
      var entry = waiting.shift(), img = entry[0], state = entry[1], source = img.getAttribute('data-post-src');
      var rect = img.getBoundingClientRect();
      state.loading = true; running++;
      img.loading = 'eager';
      img.fetchPriority = rect.top < innerHeight && rect.bottom > 0 ? 'high' : 'low';
      img.removeAttribute('data-post-src');
      img.src = source;
      arm(img, state);
    }
  }
  window.xtjRetryOriginalImageUrl = function (value) {
    try {
      var url = new URL(value, location.href);
      if (url.origin === location.origin && /^\/api\/(?:uploads\/media|post\/[0-9a-f-]+\/media\/\d+|photo\/[0-9a-f-]+\/media)$/.test(url.pathname)) {
        url.searchParams.set('xtj_retry', Date.now().toString(36)); return url.href;
      }
      var storage = new URL(window.XTJ_CONFIG.SUPABASE_URL);
      // Never modify signed/private or third-party URLs.
      if (url.origin !== storage.origin || !url.pathname.startsWith('/storage/v1/object/public/uploads/')) return value;
      url.searchParams.set('xtj_retry', Date.now().toString(36));
      return url.href;
    } catch (_) { return value; }
  };
  function stop(state) { clearTimeout(state.timer); state.timer = 0; }
  function arm(img, state) {
    stop(state);
    if ((!state.visible && !state.loading) || !img.isConnected || !img.getAttribute('src') || (img.complete && img.naturalWidth > 0)) return;
    var source = img.getAttribute('src');
    if (state.source !== source) { state.source = source; state.startedAt = Date.now(); }
    state.timer = setTimeout(function () {
      state.timer = 0;
      if (!img.isConnected || source !== img.getAttribute('src') || (img.complete && img.naturalWidth > 0)) return;
      // Abort the stalled request before freeing the slot; otherwise another
      // four requests start while the old ones are still in flight.
      try { if (img.getAttribute('src') === source) img.removeAttribute('src'); } catch (_) {}
      release(state);
      if (img.id === 'photoPreviewImage') img.dispatchEvent(new Event('xtj:image-timeout'));
      else if (window.markPostImageFailed) window.markPostImageFailed(img);
      pump();
    }, Math.max(0, 30000 - (Date.now() - state.startedAt)));
  }
  var observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var state = tracked.get(entry.target);
      if (!state) return;
      state.visible = entry.isIntersecting;
      // 已经滚得很远的图不再占着并发槽位：快速长距离滚动时，
      // 前面几十张图会一直挂着请求，导致当前视口的图排在后面迟迟不开始。
      if (!state.visible && state.loading) {
        var rect = entry.boundingClientRect, height = window.innerHeight || 0;
        if (rect.bottom < -1200 || rect.top > height + 1200) {
          var pending = entry.target.getAttribute('src');
          if (pending) { entry.target.removeAttribute('src'); entry.target.setAttribute('data-post-src', pending); }
          stop(state);
          release(state);
        }
      }
      arm(entry.target, state);
    });
    pump();
  }, { rootMargin: '600px 0px' }) : null;
  function register(img) {
    if (tracked.has(img)) return;
    var state = { timer: 0, visible: !observer };
    state.load = function () { stop(state); release(state); pump(); };
    state.error = function () {
      stop(state);
      release(state);
      if (img.id === 'photoPreviewImage' && window.xtjRecoverMediaImage) window.xtjRecoverMediaImage(img, img._ppUrl || img.getAttribute('src'));
      pump();
    };
    tracked.set(img, state);
    img.addEventListener('load', state.load);
    img.addEventListener('error', state.error);
    if (observer) observer.observe(img);
    else arm(img, state);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(selector)) register(node);
    node.querySelectorAll(selector).forEach(register);
  }
  var mutations = new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'attributes') {
        var state = tracked.get(record.target);
        if (state) {
          if (record.target.getAttribute('src')) record.target.dispatchEvent(new Event('xtj:image-request'));
          arm(record.target, state);
        }
      } else record.addedNodes.forEach(scan);
    });
    tracked.forEach(function (state, img) {
      if (img.isConnected) return;
      stop(state);
      if (observer) observer.unobserve(img);
      img.removeEventListener('load', state.load);
      img.removeEventListener('error', state.error);
      tracked.delete(img);
      release(state);
    });
    pump();
  });
  // IntersectionObserver 在键盘弹出、程序化滚动（回复框把评论顶进视野）时会滞后，图片就停在空白。
  // 滚动/窗口变化后按位置再核对一遍：在视野附近、但还被记成「不可见」的图，补上加载。
  function nearViewport(img) {
    var r = img.getBoundingClientRect(), height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    return r.width > 0 && r.height > 0 && r.bottom > -600 && r.top < height + 600;
  }
  function recheck() {
    tracked.forEach(function (state, img) {
      // 只有「还没开始加载、正等队列」的图才需要补可见性。已加载完成的图会一直留在
      // tracked 里，长列表滚动时每 120ms 为它们逐个 getBoundingClientRect 是纯浪费，
      // 而且会强制同步布局 —— 这正是滚动掉帧的主要来源之一。
      if (state.visible || done(img)) return;
      if (!img.isConnected) return;
      if (!img.getAttribute('data-post-src') || img.getAttribute('src')) return;
      if (activePanel(img) && nearViewport(img)) { state.visible = true; arm(img, state); }
    });
    pump();
  }
  var recheckTimer = 0;
  function scheduleRecheck() { clearTimeout(recheckTimer); recheckTimer = setTimeout(recheck, 120); }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('scroll', scheduleRecheck, { passive: true, capture: true });
    window.addEventListener('resize', scheduleRecheck, { passive: true });
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', scheduleRecheck, { passive: true }); window.visualViewport.addEventListener('scroll', scheduleRecheck, { passive: true }); }
  window.xtjRecheckPostImages = scheduleRecheck;
  scan(document.body);
  pump();
  // Opacity-only navigation does not generate IntersectionObserver changes.
  // Watch just the panel classes to resume their queue when they become active.
  var panels = new MutationObserver(pump);
  document.querySelectorAll('.dock-panel').forEach(function (panel) { panels.observe(panel, { attributes: true, attributeFilter: ['class'] }); });
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  window.xtjPumpPostImages = pump;
})();
