(function () {
  'use strict';
  var readyOwner = '', readyEpoch = -1, readyAt = 0, lastForcedAt = 0, pending = null;
  function epoch() { return window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0; }
  function current(owner, generation) { return owner === String(window.currentUser || '') && generation === epoch() && !window.__xtjLogoutPending; }
  if (typeof window.addEventListener === 'function') window.addEventListener('auth-ready', function (event) {
    var detail = event && event.detail, owner = String(window.currentUser || '');
    // Login/register/refresh issue the scoped HttpOnly cookies with the access
    // token. Avoid immediately rotating that same session a second time.
    if (detail && detail.media_session_ready === true && owner && detail.user_name === owner && !window.__xtjLogoutPending) {
      readyOwner = owner; readyEpoch = epoch(); readyAt = Date.now();
    }
  });
  function mediaUrl(value) {
    try {
      var url = new URL(value, location.href), api = new URL(window.API_BASE || location.origin, location.href);
      if (url.origin !== api.origin || !/^\/api\/(?:uploads\/media|photo\/[0-9a-f-]{36}\/media|post\/[0-9a-f-]{36}\/media\/(?:0|[1-9]\d?))$/i.test(url.pathname)) return null;
      return url;
    } catch (_) { return null; }
  }
  window.xtjEnsureMediaSession = function (value, options) {
    var url = mediaUrl(value);
    if (!url) return Promise.resolve(true);
    var owner = String(window.currentUser || ''), generation = epoch();
    if (!owner || window.__xtjLogoutPending) return Promise.resolve(!url.pathname.startsWith('/api/photo/'));
    if (!(options && options.force) && readyOwner === owner && readyEpoch === generation && Date.now() - readyAt < 12 * 60000) return Promise.resolve(true);
    if (pending && pending.owner === owner && pending.epoch === generation) return pending.promise;
    // Staggered failures from one grid must not rotate the same login session
    // for every image or exhaust the refresh endpoint's rate limit.
    if (options && options.force && readyOwner === owner && readyEpoch === generation && lastForcedAt && Date.now() - lastForcedAt < 5000) return Promise.resolve(true);
    if (typeof window.refreshUserToken !== 'function') return Promise.resolve(false);
    var request = { owner: owner, epoch: generation, promise: null };
    request.promise = Promise.resolve().then(function () {
      if (!current(owner, generation)) return '';
      // The existing locked refresh renews both the login and scoped image
      // cookies. A valid in-memory token alone does not authenticate <img>.
      return window.refreshUserToken(true);
    }).then(function (token) {
      if (!token || !current(owner, generation)) return false;
      readyOwner = owner; readyEpoch = generation; readyAt = Date.now();
      lastForcedAt = options && options.force ? readyAt : 0;
      return true;
    }).catch(function () { return false; }).finally(function () { if (pending === request) pending = null; });
    pending = request;
    return request.promise;
  };
  window.xtjRecoverMediaImage = function (img, value, failed) {
    var url = mediaUrl(value), owner = String(window.currentUser || ''), generation = epoch();
    if (!url || !owner || !img || !img.isConnected || window.__xtjLogoutPending) return false;
    // A failed retry calls us with the current src, including our nonce. It is
    // still the same resource, not another chance to renew and download it.
    url.searchParams.delete('xtj_retry');
    url.searchParams.sort();
    var key = owner + ':' + generation + ':' + url.pathname + url.search, source = img.getAttribute('src');
    if (window.__xtjServiceRestrictedUntil > Date.now()) return false;
    if (img._xtjMediaAuthRetry === key && (img._xtjMediaAuthRetrySrc === source || Date.now() - img._xtjMediaAuthRetryAt < 60000)) return false;
    img._xtjMediaAuthRetry = key;
    img._xtjMediaAuthRetryAt = Date.now();
    // An <img> error is not proof of an expired session: deleted/private media
    // returns 404 and a decode failure also lands here. Probe first and only
    // rotate the session for 401/403.
    var authCheck = Promise.resolve(null);
    try {
      if (typeof fetch === 'function') {
        authCheck = fetch(url.href, { method: 'HEAD', credentials: 'include', cache: 'no-store' }).catch(function () { return null; });
      }
    } catch (_) {}
    authCheck.then(function (resp) {
      if (!resp || (resp.status !== 401 && resp.status !== 403)) {
        if (failed) failed();
        return false;
      }
      return window.xtjEnsureMediaSession(url.href, { force: true });
    }).then(function (ready) {
      if (!current(owner, generation) || !img.isConnected || img.getAttribute('src') !== source) return;
      if (!ready) { if (failed) failed(); return; }
      url.searchParams.set('xtj_retry', Date.now().toString(36));
      var retrySource = url.href;
      img._xtjMediaAuthRetrySrc = retrySource;
      if (typeof img.addEventListener === 'function') {
        function finished(event) {
          img.removeEventListener('load', finished); img.removeEventListener('error', finished);
          // A successfully loaded image may need another repair after a later
          // cookie expiry. A slow failed repair must never reset its own budget.
          if (event.type === 'load' && img.getAttribute('src') === retrySource && img.naturalWidth > 0) img._xtjMediaAuthRetrySrc = '';
        }
        img.addEventListener('load', finished); img.addEventListener('error', finished);
      }
      img.src = url.href;
    });
    return true;
  };
})();
