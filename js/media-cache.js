(function () {
  'use strict';
  window.xtjMediaSaveData = function () {
    try { return localStorage.getItem('xtj_media_save_data') !== 'off' || !!(navigator.connection && navigator.connection.saveData); }
    catch (_) { return true; }
  };
  window.xtjMediaPreviewUrl = function (value) {
    try {
      var url = new URL(value, location.href);
      if (url.origin !== location.origin || !/^\/api\/(?:photo\/(?:[0-9a-f-]{36}|shared\/[A-Za-z0-9_-]+\/[0-9a-f-]{36})\/media|post\/[0-9a-f-]{36}\/media\/\d+)$/.test(url.pathname)) return value;
      url.searchParams.set('preview', '1'); return url.href;
    } catch (_) { return value; }
  };
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  var registering = navigator.serviceWorker.register('/chat-notifications-sw.js', { scope: '/', updateViaCache: 'none' }).catch(function () { return null; });
  window.xtjSeedOriginalMedia = async function (url, blob) {
    var registration = await registering;
    var worker = navigator.serviceWorker.controller || registration && registration.active;
    if (!worker) return false;
    return new Promise(function (resolve) {
      var channel = new MessageChannel(), timer = setTimeout(done, 30000), settled = false;
      function done(ok) { if (settled) return; settled = true; clearTimeout(timer); channel.port1.close(); resolve(ok === true); }
      channel.port1.onmessage = function (event) { done(event.data && event.data.ok); };
      try { worker.postMessage({ type: 'XTJ_SEED_ORIGINAL_MEDIA', url: url, blob: blob }, [channel.port2]); }
      catch (_) { channel.port2.close(); done(false); }
    });
  };
  window.xtjObserveServiceResponse = function (response, payload) {
    var status = response && response.headers && typeof response.headers.get === 'function' ? response.headers.get('X-XTJ-Service-Status') : '';
    if (status === 'egress_quota_exceeded' || payload && payload.code === 'egress_quota_exceeded') window.__xtjServiceRestrictedUntil = Date.now() + 60000;
  };
  window.xtjClearOriginalMediaCache = async function () {
    var registration = await registering;
    var worker = navigator.serviceWorker.controller || registration && registration.active;
    if (worker) await new Promise(function (resolve) {
      var channel = new MessageChannel(), timer = setTimeout(done, 3000);
      function done() { clearTimeout(timer); channel.port1.close(); resolve(); }
      channel.port1.onmessage = done;
      try { worker.postMessage({ type: 'XTJ_CLEAR_ORIGINAL_MEDIA' }, [channel.port2]); }
      catch (_) { channel.port2.close(); done(); }
    });
    if ('caches' in window) await caches.delete('xtj-original-media-v1').catch(function () {});
  };
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'XTJ_SERVICE_RESTRICTED') window.__xtjServiceRestrictedUntil = Date.now() + 60000;
  });
})();
