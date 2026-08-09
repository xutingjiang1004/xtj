/**
 * One-shot patch: add hard network timeouts for VPN/proxy hangs.
 * Run: node scripts/patch-network-timeouts.js
 */
const fs = require('fs');

function norm(s) {
  return String(s).replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function writeLfAsCrlf(filePath, contentNorm) {
  fs.writeFileSync(filePath, contentNorm.replace(/\n/g, '\r\n'));
}

function patchOnce(filePath, needle, replacement, alreadyMarker) {
  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(alreadyMarker)) {
    console.log('skip (already):', alreadyMarker);
    return false;
  }
  const nsrc = norm(src);
  const nneedle = norm(needle);
  const idx = nsrc.indexOf(nneedle);
  if (idx < 0) {
    throw new Error('needle not found in ' + filePath + ' (' + alreadyMarker + ')');
  }
  const next = nsrc.slice(0, idx) + norm(replacement) + nsrc.slice(idx + nneedle.length);
  writeLfAsCrlf(filePath, next);
  console.log('patched:', alreadyMarker);
  return true;
}

function insertAfter(filePath, afterNeedle, inject, alreadyMarker) {
  const src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(alreadyMarker)) {
    console.log('skip (already):', alreadyMarker);
    return false;
  }
  const nsrc = norm(src);
  const na = norm(afterNeedle);
  const idx = nsrc.indexOf(na);
  if (idx < 0) {
    throw new Error('insert point not found in ' + filePath);
  }
  const at = idx + na.length;
  const next = nsrc.slice(0, at) + '\n' + norm(inject) + nsrc.slice(at);
  writeLfAsCrlf(filePath, next);
  console.log('patched:', alreadyMarker);
  return true;
}

const utilsInject = `
/**
 * Network resilience helpers.
 * VPN/TUN/proxy (Clash etc.) can leave TCP half-open so fetch never settles;
 * without a timeout the feed skeleton spins forever.
 */
window.xtjCreateTimeoutSignal = function(timeoutMs) {
    var ms = Math.max(1000, Number(timeoutMs) || 15000);
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        try { return AbortSignal.timeout(ms); } catch (e) {}
    }
    var controller = new AbortController();
    var timer = setTimeout(function() {
        try { controller.abort(); } catch (e) {}
    }, ms);
    if (controller.signal && typeof controller.signal.addEventListener === 'function') {
        controller.signal.addEventListener('abort', function() {
            clearTimeout(timer);
        }, { once: true });
    }
    return controller.signal;
};

window.xtjMergeAbortSignals = function(primary, secondary) {
    if (!primary) return secondary || null;
    if (!secondary) return primary;
    if (primary.aborted) return primary;
    if (secondary.aborted) return secondary;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        try { return AbortSignal.any([primary, secondary]); } catch (e) {}
    }
    var controller = new AbortController();
    var abortBoth = function() {
        try { controller.abort(); } catch (e) {}
    };
    primary.addEventListener('abort', abortBoth, { once: true });
    secondary.addEventListener('abort', abortBoth, { once: true });
    return controller.signal;
};

/**
 * fetch with a hard timeout. Preserves caller AbortSignal when provided.
 */
window.xtjFetch = function(url, options, timeoutMs) {
    options = options || {};
    var ms = timeoutMs == null ? 15000 : timeoutMs;
    var timeoutSignal = window.xtjCreateTimeoutSignal(ms);
    var signal = window.xtjMergeAbortSignals(options.signal, timeoutSignal);
    return fetch(url, Object.assign({}, options, { signal: signal }));
};

/**
 * Race a promise against a timeout; reject with a named Error on timeout.
 */
window.xtjWithTimeout = function(promise, timeoutMs, label) {
    var ms = Math.max(1000, Number(timeoutMs) || 15000);
    var settled = false;
    return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() {
            if (settled) return;
            settled = true;
            var err = new Error((label || 'request') + ' timeout after ' + ms + 'ms');
            err.name = 'TimeoutError';
            err.code = 'timeout';
            reject(err);
        }, ms);
        Promise.resolve(promise).then(function(value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, function(err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
    });
};
`;

insertAfter(
  'js/core-utils.js',
  `    remove: function(key) {
        try { localStorage.removeItem(key); } catch(e) { console.warn('Storage remove failed', e); }
    }
};`,
  utilsInject,
  'window.xtjFetch'
);

patchOnce(
  'js/core-parts/01-bootstrap.js',
  `var res = await fetch(API_BASE + '/api/user/refresh', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' }
                        });`,
  `// VPN/代理下无超时的 refresh 会卡住 ensureUserToken → feed 永久 skeleton
                        var refreshFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        var res = await refreshFetch(API_BASE + '/api/user/refresh', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' }
                        }, 10000);`,
  'refreshFetch'
);

patchOnce(
  'js/core-parts/01-bootstrap.js',
  `window.xtjProtectedFetch = async function(path, options) {
                options = options || {};
                var auth = await window.ensureProtectedOperationAuth();
                if (!auth.ok) {
                    var authError = new Error(auth.reason === 'expired' ? '登录已失效' : '认证服务暂时不可用');
                    authError.code = auth.reason || 'auth_unavailable';
                    authError.status = auth.status || 0;
                    throw authError;
                }
                async function send(token) {
                    var headers = Object.assign({}, options.headers || {});
                    var isFormData = options.body instanceof FormData;
                    if (!isFormData && !headers['Content-Type'] && options.body != null) {
                        headers['Content-Type'] = 'application/json';
                    }
                    headers.Authorization = 'Bearer ' + token;
                    return fetch((window.API_BASE || '') + path, Object.assign({}, options, {
                        credentials: 'include',
                        headers: headers
                    }));
                }
                var response = await send(auth.token);
                if (response.status === 401) {
                    var renewed = await window.refreshUserToken(true);
                    if (renewed) response = await send(renewed);
                }
                if (response.status === 401) {
                    window.handleProtectedAuthFailure();
                }
                return response;
            };

            // Public feed endpoints may use identity when available, but must never force login.
            window.xtjOptionalAuthFetch = async function(path, options) {
                options = options || {};
                var knownUser = String(currentUser || window.safeStorage.get('xtj_user') || '').trim();

                async function send(token) {
                    var headers = Object.assign({}, options.headers || {});
                    if (token) headers.Authorization = 'Bearer ' + token;
                    return fetch((window.API_BASE || '') + path, Object.assign({}, options, {
                        credentials: 'include',
                        headers: headers
                    }));
                }

                var token = getUserToken();
                if (!token && knownUser) token = await ensureUserToken();
                var response = await send(token);
                if (token && response.status === 401) {
                    var renewed = await window.refreshUserToken(true);
                    response = await send(renewed || '');
                }
                return response;
            };`,
  `window.xtjProtectedFetch = async function(path, options) {
                options = options || {};
                var timeoutMs = options.timeoutMs != null ? options.timeoutMs : 15000;
                var auth = await window.ensureProtectedOperationAuth();
                if (!auth.ok) {
                    var authError = new Error(auth.reason === 'expired' ? '登录已失效' : '认证服务暂时不可用');
                    authError.code = auth.reason || 'auth_unavailable';
                    authError.status = auth.status || 0;
                    throw authError;
                }
                async function send(token) {
                    var headers = Object.assign({}, options.headers || {});
                    var isFormData = options.body instanceof FormData;
                    if (!isFormData && !headers['Content-Type'] && options.body != null) {
                        headers['Content-Type'] = 'application/json';
                    }
                    headers.Authorization = 'Bearer ' + token;
                    var fetchOpts = Object.assign({}, options, {
                        credentials: 'include',
                        headers: headers
                    });
                    delete fetchOpts.timeoutMs;
                    var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                    return doFetch((window.API_BASE || '') + path, fetchOpts, timeoutMs);
                }
                var response = await send(auth.token);
                if (response.status === 401) {
                    var renewed = await window.refreshUserToken(true);
                    if (renewed) response = await send(renewed);
                }
                if (response.status === 401) {
                    window.handleProtectedAuthFailure();
                }
                return response;
            };

            // Public feed endpoints may use identity when available, but must never force login.
            window.xtjOptionalAuthFetch = async function(path, options) {
                options = options || {};
                var timeoutMs = options.timeoutMs != null ? options.timeoutMs : 15000;
                var knownUser = String(currentUser || window.safeStorage.get('xtj_user') || '').trim();

                async function send(token) {
                    var headers = Object.assign({}, options.headers || {});
                    if (token) headers.Authorization = 'Bearer ' + token;
                    var fetchOpts = Object.assign({}, options, {
                        credentials: 'include',
                        headers: headers
                    });
                    delete fetchOpts.timeoutMs;
                    var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                    return doFetch((window.API_BASE || '') + path, fetchOpts, timeoutMs);
                }

                var token = getUserToken();
                // 已登录但无 access token 时 refresh 可能因 VPN 挂起；ensureUserToken 内已有超时
                if (!token && knownUser) {
                    try {
                        token = await ensureUserToken();
                    } catch (tokenErr) {
                        console.warn('[XTJ] optional-auth token refresh failed:', tokenErr && tokenErr.message);
                        token = '';
                    }
                }
                var response = await send(token);
                if (token && response.status === 401) {
                    var renewed = await window.refreshUserToken(true);
                    response = await send(renewed || '');
                }
                return response;
            };`,
  'options.timeoutMs != null'
);

patchOnce(
  'js/core-parts/04-posts-interactions.js',
  `async function fetchFeedPageChunk(offset, requestId, deferRelated) {
                var start = Math.max(0, Number(offset) || 0);
                var page = Math.floor(start / FEED_PAGE_SIZE);
                var posts = [];
                var comments = [];
                var likes = [];
                var endReached = false;
                var usedApi = false;

                // 优先使用后端 API（支持私密帖子可见性过滤）
                try {
                    var apiResp = await window.xtjOptionalAuthFetch('/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE);
                    if (apiResp.ok) {
                        var apiData = await apiResp.json();
                        if (apiData && apiData.ok) {
                            posts = normalizePosts(apiData.posts || []);
                            comments = apiData.comments || [];
                            likes = apiData.likes || [];
                            endReached = apiData.endReached || false;
                            if (typeof apiData.total_post_count === 'number') window._xtjTotalPostCount = apiData.total_post_count;
                            // 使用服务器返回的 next_offset，不自行计算
                            start = apiData.next_offset != null ? apiData.next_offset : start + posts.length;
                            usedApi = true;
                        }
                    }
                } catch (apiErr) {
                    console.warn('[feed] API unavailable, fallback to Supabase:', apiErr && apiErr.message);
                }

                if (!usedApi) {
                    // 回退：Supabase 直连（RLS 仅返回公开帖子）
                    var end = start + FEED_PAGE_SIZE - 1;
                    var postRes = await getFeedBasePostQuery().range(start, end);
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (postRes.error) throw postRes.error;
                    posts = normalizePosts(postRes.data || []);
                    endReached = posts.length < FEED_PAGE_SIZE;
                    try {
                        var countRes = await applyVisiblePostQueryFilters(sb.from('posts').select('id', { count: 'exact', head: true }));
                        if (countRes.count !== null) window._xtjTotalPostCount = countRes.count;
                    } catch(e) {}
                }`,
  `async function fetchFeedPageChunk(offset, requestId, deferRelated) {
                var start = Math.max(0, Number(offset) || 0);
                var page = Math.floor(start / FEED_PAGE_SIZE);
                var posts = [];
                var comments = [];
                var likes = [];
                var endReached = false;
                var usedApi = false;
                var FEED_NET_TIMEOUT_MS = 18000;
                var withTimeout = (typeof window.xtjWithTimeout === 'function')
                    ? window.xtjWithTimeout
                    : function(p) { return p; };

                // 优先使用后端 API（支持私密帖子可见性过滤）
                try {
                    var apiResp = await window.xtjOptionalAuthFetch('/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE, {
                        timeoutMs: FEED_NET_TIMEOUT_MS
                    });
                    if (apiResp.ok) {
                        var apiData = await apiResp.json();
                        if (apiData && apiData.ok) {
                            posts = normalizePosts(apiData.posts || []);
                            comments = apiData.comments || [];
                            likes = apiData.likes || [];
                            endReached = apiData.endReached || false;
                            if (typeof apiData.total_post_count === 'number') window._xtjTotalPostCount = apiData.total_post_count;
                            // 使用服务器返回的 next_offset，不自行计算
                            start = apiData.next_offset != null ? apiData.next_offset : start + posts.length;
                            usedApi = true;
                        }
                    }
                } catch (apiErr) {
                    console.warn('[feed] API unavailable, fallback to Supabase:', apiErr && apiErr.message);
                }

                if (!usedApi) {
                    // 回退：Supabase 直连（RLS 仅返回公开帖子）
                    // VPN 下 supabase.co 也可能半开连接，必须有硬超时，否则永久转圈
                    var end = start + FEED_PAGE_SIZE - 1;
                    var postRes = await withTimeout(
                        getFeedBasePostQuery().range(start, end),
                        FEED_NET_TIMEOUT_MS,
                        'feed-supabase'
                    );
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (postRes.error) throw postRes.error;
                    posts = normalizePosts(postRes.data || []);
                    endReached = posts.length < FEED_PAGE_SIZE;
                    try {
                        var countRes = await withTimeout(
                            applyVisiblePostQueryFilters(sb.from('posts').select('id', { count: 'exact', head: true })),
                            Math.min(FEED_NET_TIMEOUT_MS, 8000),
                            'feed-count'
                        );
                        if (countRes.count !== null) window._xtjTotalPostCount = countRes.count;
                    } catch(e) {}
                }`,
  'FEED_NET_TIMEOUT_MS'
);

console.log('done');
