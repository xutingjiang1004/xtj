/**
 * Harden feed boot: plain public fetch + stuck-skeleton watchdog + no silent early returns.
 */
const fs = require('fs');

function norm(s) {
  return String(s).replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function write(file, contentNorm) {
  fs.writeFileSync(file, contentNorm.replace(/\n/g, '\r\n'));
}
function patch(file, needle, rep, already) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(already)) {
    console.log('skip', already);
    return false;
  }
  const n = norm(src);
  const nn = norm(needle);
  const idx = n.indexOf(nn);
  if (idx < 0) throw new Error('needle missing: ' + already + ' in ' + file);
  write(file, n.slice(0, idx) + norm(rep) + n.slice(idx + nn.length));
  console.log('ok', already);
  return true;
}

// 1) Public feed uses plain timed fetch first (no auth refresh path).
patch(
  'js/core-parts/04-posts-interactions.js',
  `// 优先使用后端 API（支持私密帖子可见性过滤）
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
                }`,
  `// 优先使用后端 API（支持私密帖子可见性过滤）
                // 公开首屏：裸 fetch + 硬超时，避免登录态 refresh / optionalAuth 路径拖死 skeleton
                try {
                    var feedPath = '/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE;
                    var apiResp = null;
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
                } catch (apiErr) {
                    console.warn('[feed] API unavailable, fallback to Supabase:', apiErr && apiErr.message);
                }`,
  '公开首屏：裸 fetch'
);

// 2) loadFeed early-return must not leave skeleton forever
patch(
  'js/core-parts/04-posts-interactions.js',
  `var chunk = await fetchFeedPageChunk(0, requestId, true);
                    if (!chunk) return;
                    if (requestId !== feedLoadRequestId) return;`,
  `var chunk = await fetchFeedPageChunk(0, requestId, true);
                    if (!chunk || requestId !== feedLoadRequestId) {
                        // 竞态取消时不要把 HTML skeleton 永久留住
                        if (feed && !hadLiveFeed) {
                            var stillSkeleton = /xtj-loading-skeleton|xtj-skeleton-card|内容加载中/.test(feed.innerHTML || '');
                            if (stillSkeleton && requestId === feedLoadRequestId) {
                                feed.innerHTML = '<div class="loading feed-load-more-error" id="feedBootError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;">加载中断，点击重试</div>';
                                var bootErr = document.getElementById('feedBootError');
                                if (bootErr && !bootErr.__xtjBound) {
                                    bootErr.__xtjBound = true;
                                    bootErr.addEventListener('click', function() { loadFeed(true); });
                                }
                            }
                        }
                        return;
                    }`,
  'feedBootError'
);

// 3) Boot watchdog after initialLoad is scheduled
patch(
  'js/core-parts/06-chat-and-nav.js',
  `await initUI();
                normalizeReportModalStructure();
                requestAnimationFrame(function() { initialLoad(); });
                // 记录访问（用户+IP）`,
  `await initUI();
                normalizeReportModalStructure();
                requestAnimationFrame(function() {
                    Promise.resolve()
                        .then(function() { return initialLoad(); })
                        .catch(function(err) {
                            console.error('[XTJ] initialLoad failed:', err);
                            try {
                                var feedEl = document.getElementById('feed');
                                if (feedEl && /xtj-loading-skeleton|xtj-skeleton-card/.test(feedEl.innerHTML || '')) {
                                    feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;cursor:pointer;" id="feedInitError">启动加载失败，点击重试</div>';
                                    var initErr = document.getElementById('feedInitError');
                                    if (initErr) initErr.onclick = function() {
                                        if (typeof window.loadFeed === 'function') window.loadFeed(true);
                                    };
                                }
                            } catch (e2) {}
                        });
                });
                // 帖子区 skeleton 看门狗：网络/代理挂起时最多 10s 给出可点重试，不再无限转圈
                (function setupFeedBootWatchdog() {
                    if (window.__xtjFeedBootWatchdog) return;
                    window.__xtjFeedBootWatchdog = true;
                    var tries = 0;
                    var timer = setInterval(function() {
                        tries += 1;
                        var feedEl = document.getElementById('feed');
                        if (!feedEl) {
                            if (tries >= 12) clearInterval(timer);
                            return;
                        }
                        var hasPosts = !!feedEl.querySelector('.post');
                        var hasSkeleton = !!feedEl.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card, .xtj-magic-loading')
                            || /内容加载中/.test(feedEl.innerHTML || '');
                        var hasError = !!feedEl.querySelector('#feedBootError, #feedInitError, .feed-load-more-error')
                            || /加载失败|加载中断|启动加载失败/.test(feedEl.innerText || '');
                        if (hasPosts || hasError) {
                            clearInterval(timer);
                            return;
                        }
                        if (tries >= 10 && hasSkeleton) {
                            clearInterval(timer);
                            console.warn('[XTJ] feed boot watchdog: still skeleton after 10s, forcing recovery');
                            feedEl.innerHTML = '<div class="loading" id="feedWatchdogError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;padding:24px;text-align:center;">帖子加载超时（可能是系统代理/网络问题），点击重试<br><small style="opacity:.7">也可关闭系统代理 127.0.0.1:7890 后刷新</small></div>';
                            var w = document.getElementById('feedWatchdogError');
                            if (w) {
                                w.onclick = function() {
                                    if (typeof window.loadFeed === 'function') {
                                        window.loadFeed(true).catch(function() {});
                                    } else {
                                        window.location.reload();
                                    }
                                };
                            }
                            // 后台再试一次直连接口
                            try {
                                if (typeof window.loadFeed === 'function') {
                                    window.loadFeed(true).catch(function() {});
                                }
                            } catch (e3) {}
                        }
                    }, 1000);
                })();
                // 记录访问（用户+IP）`,
  'setupFeedBootWatchdog'
);

console.log('done');
