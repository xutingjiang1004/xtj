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

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function showError(msg) {
    var el = feedEl();
    if (!el || el.querySelector('.post')) return;
    el.innerHTML =
      '<div class="loading" id="xtjEarlyFeedError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;padding:24px;text-align:center;line-height:1.6;">' +
      esc(msg || '帖子加载失败，点击重试') +
      '<br><small style="opacity:.75;color:inherit">若一直失败：完全退出 Clash/FlClash，关闭系统代理 127.0.0.1:7890 后 Ctrl+F5</small></div>';
    var node = document.getElementById('xtjEarlyFeedError');
    if (node && !node.__bound) {
      node.__bound = true;
      node.onclick = function () {
        window.location.reload();
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
        return (
          '<div class="post glass" data-post-id="' +
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
          '</div></div>'
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
    if (typeof window.loadFeed === 'function' && window.__xtjConsumeEarlyFeed) {
      try {
        window.__xtjConsumeEarlyFeed(state.data);
      } catch (e) {}
    }
  }

  var resolveEarly;
  var rejectEarly;
  window.__xtjEarlyFeedPromise = new Promise(function (resolve, reject) {
    resolveEarly = resolve;
    rejectEarly = reject;
  });

  function finishOk(data) {
    state.status = 'ok';
    state.data = data;
    try {
      resolveEarly(data);
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('xtj:early-feed', { detail: data }));
    } catch (e2) {}
    // Paint soon if core is slow; core can replace with full cards later.
    setTimeout(function () {
      if (stillSkeleton(feedEl()) || !feedEl() || !feedEl().querySelector('.post')) {
        paintMinimal(data);
      }
      applyToCoreIfReady();
    }, 0);
    // Second chance after core should have loaded
    setTimeout(function () {
      if (stillSkeleton(feedEl())) paintMinimal(data);
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
      if (stillSkeleton(feedEl())) {
        showError('帖子加载超时/失败，点击刷新重试');
      }
    }, 300);
    setTimeout(function () {
      if (stillSkeleton(feedEl())) {
        showError('帖子加载超时/失败，点击刷新重试');
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
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
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
