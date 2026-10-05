'use strict';
(function () {
  // Keep local originals separate from the persisted post and its public URLs.
  // This works even when motion is disabled or the selection is off screen.
  function authEpoch() { return window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0; }
  var pending = new Map(), owner = window.currentUser || '', epoch = authEpoch(), running = 0;
  function next() {
    var state = Array.from(pending.values()).find(function (item) { return item.queued && valid(item); });
    if (state && running < 2) load(state);
  }
  function finishLoad(state) {
    if (state.loading) { state.loading = false; running--; }
    next();
  }
  function valid(state) {
    return pending.get(state.remote) === state && state.owner === window.currentUser && state.epoch === authEpoch();
  }
  function release(state) {
    clearTimeout(state.timer);
    state.loader.onload = state.loader.onerror = null;
    pending.delete(state.remote);
    state.lease.release();
    finishLoad(state);
  }
  function clear() { Array.from(pending.values()).forEach(release); }
  function load(state) {
    if (!valid(state) || state.loading) return;
    if (Date.now() - state.started > 60000 && state.used && !Array.from(document.images).some(function (img) { return img.getAttribute('src') === state.lease.url; })) { release(state); return; }
    if (running >= 2) { state.queued = true; return; }
    state.queued = false; state.loading = true; running++;
    var generation = ++state.generation;
    function failed() {
      if (!valid(state) || state.generation !== generation) return;
      clearTimeout(state.timer); state.loader.onload = state.loader.onerror = null;
      finishLoad(state);
      // Failure never replaces a perfectly usable local original with a blank.
      state.attempts++;
      state.timer = setTimeout(function () { load(state); }, state.attempts < 3 ? 1000 * state.attempts : 60000);
    }
    state.loader.onload = function () {
      var decoded = state.loader.decode ? state.loader.decode() : Promise.resolve();
      decoded.then(function () {
        if (!valid(state) || state.generation !== generation || !state.loader.naturalWidth) return;
        clearTimeout(state.timer); finishLoad(state);
        // The canonical original is already downloaded and decoded before the swap.
        var images = Array.from(document.images).filter(function (img) { return img.getAttribute('src') === state.lease.url; });
        images.forEach(function (img) { img.src = state.loader.src; });
        Promise.all(images.map(function (img) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }))
          .then(function () { if (valid(state)) release(state); });
      }, failed);
    };
    state.loader.onerror = failed;
    state.timer = setTimeout(failed, 15000);
    state.loader.src = state.attempts && window.xtjRetryOriginalImageUrl ? window.xtjRetryOriginalImageUrl(state.remote) : state.remote;
  }
  function prepare(files, post) {
    if (!post || !window.XtjPostComposerMedia || !window.XtjPostMedia) return;
    var items = window.XtjPostMedia.getPostMediaItems(post);
    items.forEach(function (item, index) {
      var file = files[index];
      if (!file || !file.type.startsWith('image/') || pending.has(item.media_url)) return;
      var lease = window.XtjPostComposerMedia.retainImage(file);
      if (!lease) return;
      var state = { remote: item.media_url, lease: lease, owner: window.currentUser, epoch: authEpoch(),
        loader: new Image(), loading: false, attempts: 0, generation: 0, timer: 0, started: Date.now(), used: false };
      pending.set(state.remote, state); load(state);
    });
  }
  function displayUrl(remote) {
    var state = pending.get(remote);
    if (state && valid(state)) state.used = true;
    return state && valid(state) ? state.lease.url : remote;
  }
  window.XtjPostOriginals = { prepare: prepare, displayUrl: displayUrl, clear: clear };
  window.addEventListener('auth-ready', function () {
    if (owner !== window.currentUser || epoch !== authEpoch()) clear();
    owner = window.currentUser || ''; epoch = authEpoch();
  });
  window.addEventListener('online', function () { pending.forEach(function (state) { if (!state.loading) { clearTimeout(state.timer); load(state); } }); });
  window.addEventListener('pagehide', function (event) { if (!event.persisted) clear(); });
})();
