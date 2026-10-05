(function () {
  'use strict';
  var state = null, generation = 0;
  var byId = function (id) { return document.getElementById(id); };
  function identity() { return { owner: window.currentUser || '', epoch: typeof window.__xtjGetAuthEpoch === 'function' ? window.__xtjGetAuthEpoch() : 0 }; }
  function current(s) {
    var now = identity(), modal = byId('userProfileModal');
    return state === s && s.generation === generation && s.owner === now.owner && s.epoch === now.epoch && modal && modal.classList.contains('active');
  }
  function safeUrl(value) {
    try { var url = new URL(value, location.href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (_) { return ''; }
  }
  function textOf(post) {
    try { var payload = JSON.parse(post.content); if (payload && payload.__type === '__xtj_post_v2__') return String(payload.text || ''); } catch (_) {}
    return String(post.content || '');
  }
  function media(post) { return window.XtjPostMedia ? window.XtjPostMedia.getPostMediaItems(post) : []; }
  function make(tag, className, text) {
    var node = document.createElement(tag); node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function renderRow(post, previous) {
    var date = new Date(post.created_at), valid = Number.isFinite(date.getTime());
    var day = valid ? date.toLocaleDateString('sv-SE') : '';
    var row = make('article', 'author-post-row'); row.dataset.postId = post.id;
    var stamp = make('div', 'author-post-date');
    if (day !== previous) {
      stamp.appendChild(make('span', 'author-post-day', valid ? String(date.getDate()).padStart(2, '0') : '—'));
      stamp.appendChild(make('span', 'author-post-month', valid ? (date.getMonth() + 1) + '月' : ''));
    }
    var button = make('button', 'author-post-entry'); button.type = 'button';
    button.setAttribute('aria-label', '查看动态：' + (textOf(post).slice(0, 80) || '图片动态'));
    var items = media(post).filter(function (item) { return /^(image|photo)$/.test(item.media_type) && safeUrl(item.media_url); });
    if (items.length) {
      var mosaic = make('span', 'author-post-mosaic' + (items.length === 1 ? ' is-single' : items.length === 2 ? ' is-pair' : ''));
      items.slice(0, 4).forEach(function (item, index) {
        var cell = make('span', 'author-post-thumb'), img = document.createElement('img');
        img.src = safeUrl(item.media_url); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        if (item.width && item.height) { img.width = item.width; img.height = item.height; }
        img.addEventListener('error', function () { cell.classList.add('is-unavailable'); img.hidden = true; });
        cell.appendChild(img);
        if (index === Math.min(3, items.length - 1) && items.length > 4) cell.appendChild(make('span', 'author-post-photo-count', '+' + (items.length - 4)));
        mosaic.appendChild(cell);
      });
      button.appendChild(mosaic);
    } else if (/^(video|audio)$/.test(post.media_type)) {
      button.appendChild(make('span', 'author-post-media-label', post.media_type === 'video' ? '视频' : '音频'));
    }
    var copy = make('span', 'author-post-copy');
    if (textOf(post)) copy.appendChild(make('span', 'author-post-text', textOf(post)));
    var labels = [];
    if (post.visibility === 'private') labels.push('仅自己可见');
    if (post.location_name) labels.push(post.location_name);
    if (labels.length) copy.appendChild(make('span', 'author-post-meta', labels.join(' · ')));
    if (copy.childNodes.length) button.appendChild(copy);
    button.addEventListener('click', function () { if (state && current(state) && typeof window.openPostDetail === 'function') window.openPostDetail(post.id); });
    row.append(stamp, button);
    return { row: row, day: day };
  }
  function render(s) {
    if (!current(s)) return;
    var list = byId('authorPostsList'), frag = document.createDocumentFragment(), previous = '', year = '';
    s.posts.forEach(function (post) {
      var nextYear = new Date(post.created_at).getFullYear();
      if (Number.isFinite(nextYear) && String(nextYear) !== year) { year = String(nextYear); frag.appendChild(make('h4', 'author-post-year', year)); previous = ''; }
      var rendered = renderRow(post, previous); previous = rendered.day; frag.appendChild(rendered.row);
    });
    list.replaceChildren(frag);
    var cover = byId('authorPostsCover'); cover.replaceChildren();
    var coverItem;
    if (s.profile && safeUrl(s.profile.cover_url)) coverItem = {media_url:s.profile.cover_url};
    if (!coverItem && !s.profile) s.posts.some(function (post) { coverItem = media(post).find(function (item) { return /^(image|photo)$/.test(item.media_type) && safeUrl(item.media_url); }); return !!coverItem; });
    var signature = byId('authorPostsSignature');
    if (!signature) { signature=make('div','author-post-signature'); signature.id='authorPostsSignature'; byId('upcName').insertAdjacentElement('afterend',signature); }
    signature.textContent = s.profile && s.profile.signature || '';
    if (coverItem) {
      var img = document.createElement('img'); img.alt = ''; img.src = safeUrl(coverItem.media_url); img.decoding = 'async';
      img.addEventListener('error', function () { img.remove(); }); cover.appendChild(img);
    }
  }
  function status(s, label, retry) {
    if (!current(s)) return;
    var host = byId('authorPostsStatus'); host.replaceChildren(); host.setAttribute('aria-busy', s.loading ? 'true' : 'false');
    if (label) host.appendChild(make('span', 'author-post-status-text', label));
    if (retry || s.hasMore) {
      var button = make('button', 'author-post-load-more', retry ? '重试' : '加载更多'); button.type = 'button'; button.disabled = s.loading;
      button.addEventListener('click', function () { load(s); }); host.appendChild(button);
    }
  }
  async function load(s) {
    if (!current(s) || s.loading) return;
    s.loading = true; status(s, '正在加载动态…');
    var controller = new AbortController(); s.controller = controller;
    var query = new URLSearchParams({ limit: '20' });
    if (s.cursor) { query.set('before_at', s.cursor.at); query.set('before_id', s.cursor.id); }
    try {
      var path = '/api/profile/posts/' + encodeURIComponent(s.author) + '?' + query;
      var response = await window.xtjOptionalAuthFetch(path, { timeoutMs: 18000, signal: controller.signal, authOwner: s.owner, authEpoch: s.epoch });
      var data = await response.json();
      if (!current(s)) return;
      if (!response.ok || !data.ok || !Array.isArray(data.posts)) throw Error(data.error || '动态加载失败');
      var seen = new Set(s.posts.map(function (post) { return String(post.id); }));
      data.posts.forEach(function (post) { if (post.user_name === s.author && !seen.has(String(post.id))) { s.posts.push(post); seen.add(String(post.id)); } });
      s.profile = data.profile || s.profile; s.restricted = !!data.restricted;
      if (s.restricted) s.posts = [];
      s.cursor = data.next_cursor; s.hasMore = !!data.has_more && !!s.cursor; s.loading = false;
      render(s); status(s, s.restricted ? '对方已关闭个人动态页访问' : !s.posts.length ? '还没有可查看的动态' : s.hasMore ? '' : '已显示全部动态');
    } catch (error) {
      if (!current(s)) return;
      s.loading = false; status(s, error.message || '动态暂时无法加载', true);
    } finally { if (s.controller === controller) s.controller = null; }
  }
  window.__xtjCloseAuthorPosts = function () {
    generation++;
    if (state && state.controller) state.controller.abort();
    state = null;
    ['authorPostsList', 'authorPostsCover', 'authorPostsStatus', 'authorPostsSignature'].forEach(function (id) { var node = byId(id); if (node) node.replaceChildren(); });
  };
  window.__xtjOpenAuthorPosts = function (author) {
    var detail = byId('postDetailModal');
    if (detail && detail.classList.contains('active') && typeof window.closeModal === 'function') window.closeModal('postDetailModal');
    window.__xtjCloseAuthorPosts();
    if (!byId('authorPostsList')) return;
    var owner = identity(); state = { author: author, owner: owner.owner, epoch: owner.epoch, generation: generation, posts: [], hasMore: false, loading: false, cursor: null };
    var scroll = byId('authorPostsScroll'); if (scroll) scroll.scrollTop = 0;
    load(state);
  };
  window.__xtjUpdateAuthorPost = function (post) {
    if (!state || !current(state) || !post || post.user_name !== state.author) return;
    state.posts = state.posts.map(function (old) { return String(old.id)===String(post.id) ? Object.assign({}, old, post) : old; });
    render(state);
  };
  window.__xtjRemoveAuthorPost = function (id) {
    if (!state || !current(state)) return;
    state.posts = state.posts.filter(function (post) { return String(post.id) !== String(id); }); render(state);
    status(state, state.posts.length ? '' : '还没有可查看的动态');
  };
  window.addEventListener('xtj:profile-settings-saved', function(event) { if(state && current(state) && state.author===event.detail.owner) { state.profile=event.detail.settings; render(state); } });
  window.addEventListener('auth-ready', function () {
    if (!state || current(state)) return;
    window.__xtjCloseAuthorPosts();
    if (typeof window.closeModal === 'function') window.closeModal('userProfileModal');
  });
})();
