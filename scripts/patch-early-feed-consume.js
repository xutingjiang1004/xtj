const fs = require('fs');
function norm(s) {
  return String(s).replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function write(file, content) {
  fs.writeFileSync(file, content.replace(/\n/g, '\r\n'));
}
function patch(file, needle, rep, already) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(already)) {
    console.log('skip', already);
    return;
  }
  const n = norm(src);
  const nn = norm(needle);
  const idx = n.indexOf(nn);
  if (idx < 0) throw new Error('missing ' + already);
  write(file, n.slice(0, idx) + norm(rep) + n.slice(idx + nn.length));
  console.log('ok', already);
}

// Consume early feed in fetchFeedPageChunk for first page
patch(
  'js/core-parts/04-posts-interactions.js',
  `// 优先使用后端 API（支持私密帖子可见性过滤）
                // 公开首屏：裸 fetch + 硬超时，避免登录态 refresh / optionalAuth 路径拖死 skeleton
                try {
                    var feedPath = '/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE;`,
  `// 优先使用后端 API（支持私密帖子可见性过滤）
                // 公开首屏：裸 fetch + 硬超时，避免登录态 refresh / optionalAuth 路径拖死 skeleton
                try {
                    // 复用 early-feed.js 已发起的首屏请求，避免重复等待
                    if (page === 0 && !usedApi && window.__xtjEarlyFeed && window.__xtjEarlyFeed.status === 'ok' && window.__xtjEarlyFeed.data) {
                        var early = window.__xtjEarlyFeed.data;
                        posts = normalizePosts(early.posts || []);
                        comments = early.comments || [];
                        likes = early.likes || [];
                        endReached = early.endReached || false;
                        if (typeof early.total_post_count === 'number') window._xtjTotalPostCount = early.total_post_count;
                        start = early.next_offset != null ? early.next_offset : start + posts.length;
                        usedApi = true;
                    } else if (page === 0 && !usedApi && window.__xtjEarlyFeedPromise) {
                        try {
                            var early2 = await (typeof window.xtjWithTimeout === 'function'
                                ? window.xtjWithTimeout(window.__xtjEarlyFeedPromise, Math.min(FEED_NET_TIMEOUT_MS, 12000), 'early-feed')
                                : window.__xtjEarlyFeedPromise);
                            if (early2 && early2.ok) {
                                posts = normalizePosts(early2.posts || []);
                                comments = early2.comments || [];
                                likes = early2.likes || [];
                                endReached = early2.endReached || false;
                                if (typeof early2.total_post_count === 'number') window._xtjTotalPostCount = early2.total_post_count;
                                start = early2.next_offset != null ? early2.next_offset : start + posts.length;
                                usedApi = true;
                            }
                        } catch (earlyErr) {
                            console.warn('[feed] early-feed unavailable:', earlyErr && earlyErr.message);
                        }
                    }
                    var feedPath = '/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE;`,
  '复用 early-feed.js'
);

// Only hit network if early feed did not fill page 0
patch(
  'js/core-parts/04-posts-interactions.js',
  `var knownUser = '';
                    try {
                        knownUser = String((typeof currentUser === 'string' ? currentUser : '') || (window.safeStorage && window.safeStorage.get('xtj_user')) || '').trim();
                    } catch (eUser) { knownUser = ''; }
                    var hasToken = false;
                    try { hasToken = !!(typeof getUserToken === 'function' && getUserToken()); } catch (eTok) { hasToken = false; }

                    if (!knownUser && !hasToken) {
                        var feedUrl = (window.API_BASE || (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin || '').replace(/\\/$/, '') + feedPath;
                        var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch(feedUrl, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }, FEED_NET_TIMEOUT_MS);
                    } else if (typeof window.xtjOptionalAuthFetch === 'function') {
                        apiResp = await window.xtjOptionalAuthFetch(feedPath, { timeoutMs: FEED_NET_TIMEOUT_MS });
                    } else {
                        var feedUrl2 = (window.API_BASE || window.location.origin || '').replace(/\\/$/, '') + feedPath;
                        var doFetch2 = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch2(feedUrl2, { method: 'GET', credentials: 'include' }, FEED_NET_TIMEOUT_MS);
                    }

                    if (apiResp && apiResp.ok) {
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
                    }`,
  `if (!usedApi) {
                    var knownUser = '';
                    try {
                        knownUser = String((typeof currentUser === 'string' ? currentUser : '') || (window.safeStorage && window.safeStorage.get('xtj_user')) || '').trim();
                    } catch (eUser) { knownUser = ''; }
                    var hasToken = false;
                    try { hasToken = !!(typeof getUserToken === 'function' && getUserToken()); } catch (eTok) { hasToken = false; }

                    if (!knownUser && !hasToken) {
                        var feedUrl = (window.API_BASE || (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin || '').replace(/\\/$/, '') + feedPath;
                        var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch(feedUrl, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }, FEED_NET_TIMEOUT_MS);
                    } else if (typeof window.xtjOptionalAuthFetch === 'function') {
                        apiResp = await window.xtjOptionalAuthFetch(feedPath, { timeoutMs: FEED_NET_TIMEOUT_MS });
                    } else {
                        var feedUrl2 = (window.API_BASE || window.location.origin || '').replace(/\\/$/, '') + feedPath;
                        var doFetch2 = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch2(feedUrl2, { method: 'GET', credentials: 'include' }, FEED_NET_TIMEOUT_MS);
                    }

                    if (apiResp && apiResp.ok) {
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
                    }`,
  'if (!usedApi) {\n                    var knownUser'
);

// Mark core feed ready after loadFeed success path starts rendering
patch(
  'js/core-parts/04-posts-interactions.js',
  `await renderFeedFromMemoryState();
                    setupFeedInfiniteScroll();
                    hydrateDeferredFeedRelations(chunk, requestId).then(function() {`,
  `window.__xtjCoreFeedReady = true;
                    await renderFeedFromMemoryState();
                    setupFeedInfiniteScroll();
                    hydrateDeferredFeedRelations(chunk, requestId).then(function() {`,
  '__xtjCoreFeedReady = true'
);

console.log('done');
