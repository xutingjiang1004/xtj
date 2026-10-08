(function () {
  'use strict';
  // A stalled request does not emit error. Keep original images recoverable,
  // and only run the deadline for visible images (including native lazy loads).
  var selector = '.post-media-cell img[data-media-url], #photoPreviewImage';
  var tracked = new Map();
  var running = 0;
  window.xtjPostImageScheduling = true;
  function release(state) { if (state.loading) { state.loading = false; running--; } }
  function pump() {
    var waiting = Array.from(tracked.entries()).filter(function (entry) {
      return entry[1].visible && entry[0].isConnected && entry[0].getAttribute('data-post-src') && !entry[0].getAttribute('src');
    });
    waiting.sort(function (a, b) {
      var ar = a[0].getBoundingClientRect(), br = b[0].getBoundingClientRect();
      return Math.max(0, ar.top, -ar.bottom) - Math.max(0, br.top, -br.bottom);
    });
    while (running < 4 && waiting.length) {
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
      if (url.origin === location.origin && /^\/api\/(?:post\/[0-9a-f-]+\/media\/\d+|photo\/[0-9a-f-]+\/media)$/.test(url.pathname)) {
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
    if (!state.visible || !img.isConnected || !img.getAttribute('src') || (img.complete && img.naturalWidth > 0)) return;
    var source = img.getAttribute('src');
    state.timer = setTimeout(function () {
      state.timer = 0;
      if (!img.isConnected || source !== img.getAttribute('src') || (img.complete && img.naturalWidth > 0)) return;
      release(state);
      if (img.id === 'photoPreviewImage') img.dispatchEvent(new Event('xtj:image-timeout'));
      else if (window.markPostImageFailed) window.markPostImageFailed(img);
      pump();
    }, 30000);
  }
  var observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var state = tracked.get(entry.target);
      if (!state) return;
      state.visible = entry.isIntersecting;
      arm(entry.target, state);
    });
    pump();
  }, { rootMargin: '160px 0px' }) : null;
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
  scan(document.body);
  pump();
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
})();
