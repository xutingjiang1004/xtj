/**
 * Early feed bootstrap — loads in parallel with the heavy core.js chain.
 * Does not depend on XTJ_CONFIG / supabase / loadFeed.
 * Paints a minimal readable list if core is still loading after data arrives.
 */
(function () {
  'use strict';
  if (window.__xtjEarlyFeedBooted) return;
  window.__xtjEarlyFeedBooted = true;

  var FEED_LIMIT = 20;
  var TIMEOUT_MS = 12000;
  var state = {
    status: 'loading', // loading | ok | error
    data: null,
    error: null,
    painted: false,
  };
  window.__xtjEarlyFeed = state;

  // ★ 2026-09-13 修复（S-1）：bfcache 安全网。
  // 本模块有 4 处游离的 setTimeout 延迟回调（0ms / 2500ms / 300ms / 8000ms），
  // 它们会按 stillSkeleton 判断决定是否 paintMinimal / showError。进入 bfcache 时
  // 这些计时器不会随页面卸载而取消，返回后若 DOM 已被浏览器恢复为真实内容、
  // 或仍处于骨架态，回调可能在错误的时机写入 innerHTML，造成"返回后 feed 闪回
  // 骨架/错误页"。这里用一个 pagehide 标记让所有延迟回调在页面离开后直接跳过。
  //
  // 用标记而非逐个 clearTimeout：这些回调分散在 3 个函数中，逐个持有句柄容易漏；
  // 且 0ms 回调可能在标记置位前已入队，标记判断能覆盖这种边界。
  var pageHidden = false;
  window.addEventListener('pagehide', function () { pageHidden = true; });
  window.addEventListener('pageshow', function (e) {
    // 从 bfcache 恢复时复位，让页面重新可见后的正常流程不受影响
    if (e && e.persisted) pageHidden = false;
  });

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'); // L 级加固：单引号同样转义，防止拼接进单引号属性时逃逸
  }

  function postText(content) {
    var raw = String(content == null ? '' : content);
    try {
      var j = JSON.parse(raw);
      if (j && (j.__type === '__xtj_post_v2__' || j.text != null)) {
        return String(j.text || '');
      }
    } catch (e) {}
    return raw;
  }

  function feedEl() {
    return document.getElementById('feed');
  }

  function stillSkeleton(el) {
    if (!el) return false;
    if (el.querySelector('.post')) return false;
    return !!(
      el.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card, .xtj-magic-loading') ||
      /内容加载中|xtj-loading-skeleton/.test(el.innerHTML || '')
    );
  }

  // Reuse the photo wall's own garden so both places stay visually consistent.
  // The SVG is part of the page, never data returned by a user or an API.
  window.xtjFeedLoadingHtml = function (message, compact) {
    var garden = document.getElementById('pwUploadGarden');
    if (!garden || !garden.querySelector('svg')) return '';
    return '<div class="feed-garden-loading' + (compact ? ' feed-garden-loading--compact' : ' xtj-loading-skeleton') +
      '" role="status" aria-live="polite"><div class="pw-garden is-growing" aria-hidden="true">' +
      garden.innerHTML + '</div><span>' + esc(message || '正在加载帖子') + '</span></div>';
  };
  if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', function () {
    var el = feedEl();
    if (!el || !stillSkeleton(el)) return;
    var garden = window.xtjFeedLoadingHtml('正在加载帖子');
    if (garden) el.innerHTML = garden;
  }, { once: true });

  function showError(error) {
    var el = feedEl();
    if (!el || el.querySelector('.post')) return;
    var retryable = !error || error.retryable !== false;
    var msg = error && error.publicMessage || (error && error.name === 'AbortError' ? '帖子加载超时，请重新加载' : '帖子暂时加载失败，请稍后重试');
    el.innerHTML =
      '<div class="loading" id="xtjEarlyFeedError" role="' + (retryable ? 'button' : 'status') + '"' + (retryable ? ' tabindex="0"' : '') + ' style="color:#ff3b60;padding:24px;text-align:center;line-height:1.6;">' +
      esc(msg) + (retryable ? '<br><small style="opacity:.75;color:inherit">点击重新加载</small>' : '') + '</div>';
    var node = document.getElementById('xtjEarlyFeedError');
    if (retryable && node && !node.__bound) {
      node.__bound = true;
      node.onclick = function () {
        window.location.reload();
      };
      node.onkeydown = function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.onclick(); }
      };
    }
  }

  function paintMinimal(data) {
    var el = feedEl();
    if (!el) return false;
    // Core already rendered real feed — do not clobber.
    if (el.querySelector('.post') && !stillSkeleton(el)) {
      state.painted = true;
      return true;
    }
    if (typeof window.loadFeed === 'function' && window.__xtjCoreFeedReady) {
      return false;
    }
    var posts = (data && data.posts) || [];
    if (!posts.length) {
      el.innerHTML = '<div class="loading">快来发布第一条动态吧~</div>';
      state.painted = true;
      return true;
    }
    var html = posts
      .map(function (p) {
        var name = esc(p.user_name || '用户');
        var text = esc(postText(p.content)).replace(/\n/g, '<br>');
        var time = '';
        try {
          time = p.created_at ? new Date(p.created_at).toLocaleString() : '';
        } catch (e) {}
        var mediaSpace = '';
        if (window.XtjPostMedia) {
          var items = window.XtjPostMedia.getPostMediaItems(p);
          if (items.length && items[0].media_type === 'image') {
            mediaSpace = '<div class="media post-media-grid' + (items.length === 1 ? ' post-media-grid--single' : '') + '" aria-hidden="true" style="--post-grid-columns:' + window.XtjPostMedia.gridColumns(items.length) + '">' +
              items.slice(0, 9).map(function(item) {
                var w = Number(item.width), h = Number(item.height);
                var ratio = w > 0 && h > 0 && w <= 20000 && h <= 20000 ? w + ' / ' + h : '4 / 3';
                return '<span class="post-media-cell" style="--post-image-ratio:' + ratio + ';--post-single-max-width:' + ((w > 0 && h > 0 ? w / h : 4 / 3) * 520) + 'px;--post-single-viewport-width:' + ((w > 0 && h > 0 ? w / h : 4 / 3) * 65) + 'vh"></span>';
              }).join('') + '</div>';
          }
        }
        return (
          '<div class="post post-feed-item visible" data-post-id="' +
          esc(p.id) +
          '" data-early="1">' +
          '<div class="post-header"><span class="avatar">' +
          name.charAt(0).toUpperCase() +
          '</span><div class="user-info"><span class="user-name">' +
          name +
          '</span><span class="post-time">' +
          esc(time) +
          '</span></div></div>' +
          '<div class="content">' +
          (text || '&nbsp;') +
          '</div>' + mediaSpace + '</div>'
        );
      })
      .join('');
    el.innerHTML = html;
    state.painted = true;
    try {
      var sp = document.getElementById('sPosts');
      if (sp && typeof data.total_post_count === 'number') sp.textContent = String(data.total_post_count);
      else if (sp) sp.textContent = String(posts.length);
    } catch (e2) {}
    return true;
  }

  function applyToCoreIfReady() {
    if (!state.data || state.status !== 'ok') return;
    // (死钩子已删：core 实际消费路径为 window.__xtjEarlyFeed，见 __xtjEarlyFeedPromise)
  }

  var resolveEarly;
  var rejectEarly;
  window.__xtjEarlyFeedPromise = new Promise(function (resolve, reject) {
    resolveEarly = resolve;
    rejectEarly = reject;
  });

  // Authenticated boot can bypass the anonymous promise. Mark its rejection
  // handled while preserving the original rejection for callers that await it.
  window.__xtjEarlyFeedPromise.catch(function () {});

  function finishOk(data) {
    state.status = 'ok';
    state.data = data;
    // Start only the first public album while core prepares the full cards.
    // The normal media endpoint still checks current visibility; never preload
    // a raw Storage URL or a whole feed of large originals.
    try {
      var first = data.posts && data.posts[0];
      var restoredTab = localStorage.getItem('xtj_current_tab');
      if (restoredTab && restoredTab !== 'posts') first = null;
      if (first && window.XtjPostMedia) window.XtjPostMedia.getPostMediaItems(first).slice(0,3).forEach(function (item) {
        var url = new URL(item.media_url, location.href);
        if (item.media_type !== 'image' || url.origin !== location.origin || !/^\/api\/post\/[0-9a-f-]{36}\/media\/\d+$/.test(url.pathname)) return;
        var link = document.createElement('link');
        link.rel = 'preload'; link.as = 'image'; link.href = url.href; link.fetchPriority = 'high';
        document.head.appendChild(link);
      });
    } catch (_) {}
    try {
      resolveEarly(data);
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('xtj:early-feed', { detail: data }));
    } catch (e2) {}
    // Paint soon if core is slow; core can replace with full cards later.
    setTimeout(function () {
      if (pageHidden) return; // S-1：页面已进入 bfcache/卸载，不得再改写 DOM
      if (state.status !== 'ok' || state.data !== data) return;
      if (stillSkeleton(feedEl()) || !feedEl() || !feedEl().querySelector('.post')) {
        paintMinimal(data);
      }
      applyToCoreIfReady();
    }, 0);
    // Second chance after core should have loaded
    setTimeout(function () {
      if (pageHidden) return; // S-1
      if (state.status !== 'ok' || state.data !== data) return;
      var el = feedEl();
      if (stillSkeleton(el) || (el && !el.querySelector('.post') && !String(el.textContent || '').trim() && !window.__xtjCoreFeedReady)) paintMinimal(data);
      applyToCoreIfReady();
    }, 2500);
  }

  function finishErr(err) {
    state.status = 'error';
    state.error = err;
    try {
      rejectEarly(err);
    } catch (e) {}
    setTimeout(function () {
      if (pageHidden) return; // S-1
      if (state.status !== 'error' || state.error !== err) return;
      if (stillSkeleton(feedEl())) {
        showError(err);
      }
    }, 300);
    setTimeout(function () {
      if (pageHidden) return; // S-1
      if (state.status !== 'error' || state.error !== err) return;
      if (stillSkeleton(feedEl())) {
        showError(err);
      }
    }, 8000);
  }

  // Kick off immediately — do not wait for DOMContentLoaded / core.js
  try {
    var url = (window.location && window.location.origin ? window.location.origin : '') + '/api/feed?page=0&limit=' + FEED_LIMIT;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (e) {}
    }, TIMEOUT_MS);

    fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(async function (res) {
        var json = await res.json().catch(function () { return null; });
        if (window.xtjObserveServiceResponse) window.xtjObserveServiceResponse(res, json);
        if (!res.ok || !json || !json.ok) {
          var error = new Error('feed_failed');
          error.status = res.status; error.code = json && json.code || '';
          error.retryable = !(json && json.retryable === false);
          error.publicMessage = json && typeof json.error === 'string' ? json.error : '';
          throw error;
        }
        return json;
      })
      .then(function (json) {
        clearTimeout(timer);
        if (!json || !json.ok) throw new Error((json && json.error) || 'feed_not_ok');
        finishOk(json);
      })
      .catch(function (err) {
        clearTimeout(timer);
        finishErr(err || new Error('feed_failed'));
      });
  } catch (bootErr) {
    finishErr(bootErr);
  }
})();
