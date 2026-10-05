(function () {
  'use strict';
  // Keep the SDK's multipart request, headers, RLS and original File intact.
  // Its custom fetch transport supplies actual upload bytes through XHR.
  window.XtjPostPublishProgress = {
    begin: function (button, files, isCurrent) {
      var loaded = files.map(function () { return 0; }), total = files.reduce(function (sum, file) { return sum + file.size; }, 0);
      var requests = new Set(), percent = 0, stopped = false;
      var host = document.createElement('span'); host.className = 'post-publish-progress';
      var copy = document.createElement('span'); copy.className = 'post-publish-progress-copy';
      var label = document.createElement('span'); label.className = 'post-publish-progress-label';
      var track = document.createElement('span'); track.className = 'post-publish-progress-track';
      track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', '帖子发布进度'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
      var fill = document.createElement('span'); track.appendChild(fill); copy.append(label, track); host.appendChild(copy); button.replaceChildren(host);
      function update(value, stage) {
        if (stopped || !isCurrent()) return;
        percent = Math.max(percent, Math.min(100, Math.floor(value)));
        label.textContent = stage + (total ? ' ' + percent + '%' : '');
        fill.style.transform = 'scaleX(' + percent / 100 + ')';
        track.setAttribute('aria-valuenow', String(percent)); track.setAttribute('aria-valuetext', label.textContent);
      }
      update(0, total ? '上传中' : '发布中');
      function abortError() { return new DOMException('上传已停止', 'AbortError'); }
      function transport(index, input, options) {
        options = options || {};
        if (stopped || !isCurrent()) return Promise.reject(abortError());
        if (String(options.method || 'GET').toUpperCase() !== 'POST' || !String(input).includes('/storage/v1/object/')) return fetch(input, options);
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest(), settled = false;
          function finish(error, response) {
            if (settled) return; settled = true; requests.delete(xhr);
            xhr.upload.onprogress = xhr.upload.onload = null;
            xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
            if (error) reject(error); else resolve(response);
          }
          xhr.open('POST', String(input), true); xhr.timeout = 10 * 60 * 1000;
          new Headers(options.headers || {}).forEach(function (value, key) { xhr.setRequestHeader(key, value); });
          function progress(bytes) {
            if (stopped || !isCurrent()) { xhr.abort(); return; }
            loaded[index] = Math.max(loaded[index], Math.min(files[index].size, bytes));
            update(total ? loaded.reduce(function (sum, value) { return sum + value; }, 0) / total * 90 : 0, '上传中');
          }
          xhr.upload.onprogress = function (event) { if (event.lengthComputable && event.total) progress(files[index].size * event.loaded / event.total); };
          xhr.upload.onload = function () { progress(files[index].size); };
          xhr.onload = function () {
            if (stopped || !isCurrent()) { finish(abortError()); return; }
            var headers = new Headers();
            xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(function (line) { var colon = line.indexOf(':'); if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim()); });
            try { finish(null, new Response(xhr.responseText, { status: xhr.status, headers: headers })); } catch (error) { finish(error); }
          };
          xhr.onerror = function () { finish(new Error('上传网络异常，请重试')); };
          xhr.ontimeout = function () { finish(new Error('上传超时，请重试')); };
          xhr.onabort = function () { finish(abortError()); };
          requests.add(xhr); xhr.send(options.body);
        });
      }
      return {
        upload: async function (client, path, file, index) {
          var uploader = client;
          var config = window.XTJ_CONFIG;
          if (typeof XMLHttpRequest === 'function' && window.supabase && config && config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
            // XTJ uses its own signed identity at prepare/create. Browser storage
            // already uses this same public Supabase role, with no Supabase login.
            uploader = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
              auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
              global: { fetch: function (input, options) { return transport(index, input, options); } }
            });
          }
          var result = await uploader.storage.from('uploads').upload(path, file, { upsert: false });
          if (!result.error) { loaded[index] = file.size; update(total ? loaded.reduce(function (sum, value) { return sum + value; }, 0) / total * 90 : 0, '上传中'); }
          return result;
        },
        saving: function () { update(total ? 95 : 0, '发布中'); },
        confirmed: function () { update(100, '已发布'); },
        cancel: function () { stopped = true; Array.from(requests).forEach(function (xhr) { xhr.abort(); }); requests.clear(); }
      };
    }
  };
})();
