(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  var registering = navigator.serviceWorker.register('/chat-notifications-sw.js', { scope: '/', updateViaCache: 'none' }).catch(function () { return null; });
  window.xtjObserveServiceResponse = function (response) {
    if (response.headers.get('X-XTJ-Service-Status') === 'egress_quota_exceeded') window.__xtjServiceRestrictedUntil = Date.now() + 60000;
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
