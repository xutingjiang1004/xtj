'use strict';
(function () {
  function authEpoch() { return window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0; }
  var pending = new Map(), owner = window.currentUser || '', epoch = authEpoch(), bytes = 0;
  function canonical(value) {
    try { var url = new URL(value, location.href); url.searchParams.delete('preview'); return url.href; }
    catch (_) { return value; }
  }
  function valid(state) { return pending.get(state.remote) === state && state.owner === window.currentUser && state.epoch === authEpoch(); }
  function release(state) {
    if (!pending.has(state.remote)) return;
    clearTimeout(state.timer); pending.delete(state.remote); bytes -= state.bytes; state.lease.release();
  }
  function clear() { Array.from(pending.values()).forEach(release); }
  function prepare(files, post) {
    if (!post || !window.XtjPostComposerMedia || !window.XtjPostMedia) return;
    window.XtjPostMedia.getPostMediaItems(post).forEach(function (item, index) {
      var file = files[index], remote = canonical(item.media_url);
      if (!file || !file.type.startsWith('image/') || pending.has(remote)) return;
      while (pending.size && (pending.size >= 18 || bytes + file.size > 100 * 1024 * 1024)) release(pending.values().next().value);
      var lease = window.XtjPostComposerMedia.retainImage(file); if (!lease) return;
      var state = { remote: remote, lease: lease, bytes: file.size, owner: window.currentUser, epoch: authEpoch(), timer: 0 };
      pending.set(remote, state); bytes += file.size;
      state.timer = setTimeout(function () { release(state); }, 180000);
      // Seed after a HEAD/version check instead of downloading the original
      // from Storage again. A failed seed leaves the local upload visible.
      if (window.xtjSeedOriginalMedia) window.xtjSeedOriginalMedia(remote, file).then(function (stored) {
        if (!stored || !valid(state)) return;
        var images = Array.from(document.images).filter(function (img) { return img.getAttribute('src') === lease.url; });
        images.forEach(function (img) { img.src = item.media_url; });
        Promise.all(images.map(function (img) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }))
          .then(function () { if (valid(state)) release(state); });
      }).catch(function () {});
    });
  }
  window.XtjPostOriginals = { prepare: prepare, displayUrl: function (value) { var state = pending.get(canonical(value)); return state && valid(state) ? state.lease.url : value; }, clear: clear };
  window.addEventListener('auth-ready', function () { if (owner !== window.currentUser || epoch !== authEpoch()) clear(); owner = window.currentUser || ''; epoch = authEpoch(); });
  window.addEventListener('pagehide', function (event) { if (!event.persisted) clear(); });
})();
