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
    try { var url = new URL(window.xtjUploadDisplayUrl ? window.xtjUploadDisplayUrl(value) : value, location.href); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (_) { return ''; }
  }
  function textOf(post) {
    try { var payload = JSON.parse(post.content); if (payload && payload.__type === '__xtj_post_v2__') return String(payload.text || ''); } catch (_) {}
    return String(post.content || '');
  }
  function media(post) { return window.XtjPostMedia ? window.XtjPostMedia.getPostMediaItems(post) : []; }
  // 与首页帖子一致的歌曲卡片：个人动态页此前只输出纯文本，音乐帖会退化成一串 URL。
  var MUSIC_HOST = /^(?:(?:y\.)?music\.163\.com|163cn\.tv|(?:music|embed\.music|itunes)\.apple\.com|(?:(?:i2?|c6?)\.)?y\.qq\.com)$/i;
  function hasMusicLink(text) {
    var re = /https?:\/\/[^\s<>"'，。！？、）)\]】]+/gi, m;
    while ((m = re.exec(String(text || '')))) {
      try { var u = new URL(m[0]); if (MUSIC_HOST.test(u.hostname) && !u.username && !u.password) return true; } catch (_) {}
    }
    return false;
  }
  function make(tag, className, text) {
    var node = document.createElement(tag); node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  // 动态列表只需要 96px 缩略图：走 w=240 预览档，不和首页 1080px 大图抢同一条串行出图队列。
  // retry 时带 cache-buster，否则浏览器会复用上一次的失败结果，点了重试也还是破图。
  function sizedPreview(value, width, retry) {
    var url = safeUrl(value);
    if (!url) return '';
    try {
      var u = new URL(url, location.href);
      if (u.origin === location.origin && /^\/api\/(?:post\/[0-9a-f-]{36}\/media\/\d+|photo\/[0-9a-f-]{36}\/media|uploads\/media)$/.test(u.pathname)) {
        u.searchParams.set('preview', '1');
        u.searchParams.set('w', String(width));
        if (retry) u.searchParams.set('xtj_retry', Date.now().toString(36));
        return u.href;
      }
    } catch (_) {}
    return retry && window.xtjRetryOriginalImageUrl ? window.xtjRetryOriginalImageUrl(url) : url;
  }
  function previewSrc(item, retry) {
    var raw = item.preview_url || (window.xtjMediaPreviewUrl ? window.xtjMediaPreviewUrl(item.media_url) : item.media_url);
    return sizedPreview(raw, 240, retry) || sizedPreview(item.media_url, 240, retry);
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
    var button = make('div', 'author-post-entry'); button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.setAttribute('aria-label', '查看动态：' + (textOf(post).slice(0, 80) || '图片动态'));
    var items = media(post).filter(function (item) { return /^(image|photo)$/.test(item.media_type) && safeUrl(item.media_url); });
    if (items.length) {
      var mosaic = make('span', 'author-post-mosaic' + (items.length === 1 ? ' is-single' : items.length === 2 ? ' is-pair' : ''));
      items.slice(0, 4).forEach(function (item, index) {
        var cell = make('span', 'author-post-thumb'), img = document.createElement('img');
        var src = previewSrc(item);
        img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        if (item.width && item.height) { img.width = item.width; img.height = item.height; }
        var attempt = 0;
        img.addEventListener('load', function () { cell.classList.remove('is-unavailable'); img.hidden = false; });
        img.addEventListener('error', function () {
          // 服务端出图是串行的，首屏几张缩略图可能排在长队列后面；一次失败不代表图坏了。
          // 隔一会儿带 cache-buster 再要一次，队列消化完就能出来。
          if (attempt < 3 && cell.isConnected && !cell.classList.contains('is-unavailable')) {
            attempt++;
            setTimeout(function () { if (cell.isConnected) img.src = previewSrc(item, true); }, 900 * attempt);
            return;
          }
          // 重试 3 次仍然失败，多半是这条老帖的图片文件已经不在存储里了（接口返回 404）。
          // 文案要说清楚，别让用户一直点「点击重试」却永远转不出来。
          var failed = function () { cell.classList.add('is-unavailable', 'is-missing'); img.hidden = true; };
          if (!window.xtjRecoverMediaImage || !window.xtjRecoverMediaImage(img, img.src, failed)) failed();
        });
        cell.addEventListener('click', function (event) {
          if (!cell.classList.contains('is-unavailable')) return;
          event.preventDefault();
          event.stopPropagation();
          cell.classList.remove('is-unavailable', 'is-missing');
          img.hidden = false;
          attempt = 0;
          img.src = previewSrc(item, true);
        });
        cell.appendChild(img);
        if (index === Math.min(3, items.length - 1) && items.length > 4) cell.appendChild(make('span', 'author-post-photo-count', '+' + (items.length - 4)));
        mosaic.appendChild(cell);
      });
      button.appendChild(mosaic);
    } else if (/^(video|audio)$/.test(post.media_type)) {
      button.appendChild(make('span', 'author-post-media-label', post.media_type === 'video' ? '视频' : '音频'));
    }
    var copy = make('span', 'author-post-copy');
    var rawText = textOf(post);
    if (rawText) {
      var textNode = make('span', 'author-post-text');
      // 正文里是音乐链接时走和帖子页同一套渲染（封面 + 歌名 + 试听），
      // 纯文字仍然只输出文本，保留 3 行截断。
      if (typeof window.buildPostContentHtml === 'function' && hasMusicLink(rawText)) {
        textNode.className = 'author-post-text is-rich';
        textNode.innerHTML = window.buildPostContentHtml(rawText);
      } else {
        textNode.textContent = rawText;
      }
      copy.appendChild(textNode);
    }
    var labels = [];
    if (post.visibility === 'private') labels.push('仅自己可见');
    if (post.location_name) labels.push(post.location_name);
    if (labels.length) copy.appendChild(make('span', 'author-post-meta', labels.join(' · ')));
    if (copy.childNodes.length) button.appendChild(copy);
    button.addEventListener('click', function () { if (state && current(state) && typeof window.openPostDetail === 'function') window.openPostDetail(post.id); });
    button.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
    });
    row.append(stamp, button);
    return { row: row, day: day };
  }
  function render(s, options) {
    if (!current(s)) return;
    var list = byId('authorPostsList');
    if (!list) return;
    var appendFrom = options && Number.isInteger(options.appendFrom) ? options.appendFrom : 0;
    var frag = document.createDocumentFragment(), previous = '', year = '';
    var appendOnly = appendFrom > 0 && s._renderedCount === appendFrom;
    if (appendOnly) {
      previous = s._renderDay || '';
      year = s._renderYear || '';
      s.posts.slice(appendFrom).forEach(function (post) {
        var nextYear = new Date(post.created_at).getFullYear();
        if (Number.isFinite(nextYear) && String(nextYear) !== year) { year = String(nextYear); frag.appendChild(make('h4', 'author-post-year', year)); previous = ''; }
        var rendered = renderRow(post, previous); previous = rendered.day; frag.appendChild(rendered.row);
      });
      list.appendChild(frag);
    } else {
      s.posts.forEach(function (post) {
        var nextYear = new Date(post.created_at).getFullYear();
        if (Number.isFinite(nextYear) && String(nextYear) !== year) { year = String(nextYear); frag.appendChild(make('h4', 'author-post-year', year)); previous = ''; }
        var rendered = renderRow(post, previous); previous = rendered.day; frag.appendChild(rendered.row);
      });
      list.replaceChildren(frag);
    }
    s._renderedCount = s.posts.length;
    s._renderYear = year;
    s._renderDay = previous;
    var cover = byId('authorPostsCover');
    var coverItem;
    if (s.profile && safeUrl(s.profile.cover_url)) coverItem = {media_url:s.profile.cover_url};
    if (!coverItem) s.posts.some(function (post) { coverItem = media(post).find(function (item) { return /^(image|photo)$/.test(item.media_type) && safeUrl(item.media_url); }); return !!coverItem; });
    var coverKey = coverItem ? safeUrl(coverItem.media_url) : '';
    if (cover && s._coverKey !== coverKey) {
      cover.replaceChildren();
      if (coverItem) {
        // The cover only needs the preview-sized copy; the original loads when someone taps it to look closer.
        var coverPreview = sizedPreview(window.xtjMediaPreviewUrl ? window.xtjMediaPreviewUrl(coverKey) : coverKey, 480);
        var img = document.createElement('img'); img.alt = ''; img.src = coverPreview; img.decoding = 'async';
        img.addEventListener('error', function () { img.remove(); cover.removeAttribute('role'); cover.removeAttribute('tabindex'); cover.setAttribute('aria-hidden', 'true'); }); cover.appendChild(img);
        cover.setAttribute('data-full-src', coverKey); cover.setAttribute('data-thumb-src', coverPreview);
        cover.setAttribute('role', 'button'); cover.setAttribute('tabindex', '0'); cover.setAttribute('aria-label', '查看背景图大图'); cover.removeAttribute('aria-hidden');
        if (!cover.__xtjViewBound) {
          cover.__xtjViewBound = true;
          var openCover = function () { if (typeof window.openPostImagePreview === 'function' && cover.getAttribute('data-full-src')) window.openPostImagePreview(cover.getAttribute('data-full-src'), cover); };
          cover.addEventListener('click', openCover);
          cover.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCover(); } });
        }
      } else { cover.removeAttribute('role'); cover.removeAttribute('tabindex'); cover.removeAttribute('data-full-src'); cover.setAttribute('aria-hidden', 'true'); }
      s._coverKey = coverKey;
    }
    var signature = byId('authorPostsSignature');
    if (!signature) { signature=make('div','author-post-signature'); signature.id='authorPostsSignature'; byId('upcName').insertAdjacentElement('afterend',signature); }
    signature.textContent = s.profile && s.profile.signature || '';
    renderGuestGate(s);
    // 新插入的歌曲卡片需要触发一次解析（封面/歌名）；MutationObserver 也会兜一层。
    if (window.xtjMusicCards) { try { window.xtjMusicCards.scan(list); } catch (_) {} }
  }
  // 未登录访客只看到最近 3 条，下面用一条分隔线说明「更多内容请登录查看」。
  function renderGuestGate(s) {
    var list = byId('authorPostsList'), gate = byId('authorPostsGuestGate');
    if (!list) return;
    if (!s.guestLimited) { if (gate) gate.remove(); return; }
    if (!gate) {
      gate = make('div', 'author-post-guest-gate'); gate.id = 'authorPostsGuestGate';
      gate.appendChild(make('span', 'author-post-guest-text', '更多内容请登录查看'));
      var login = make('button', 'author-post-guest-login', '登录'); login.type = 'button';
      login.addEventListener('click', function (event) {
        event.preventDefault(); event.stopPropagation();
        if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
      });
      gate.appendChild(login);
    }
    if (!gate.isConnected || gate.previousElementSibling !== list) list.insertAdjacentElement('afterend', gate);
  }
  function status(s, label, retry) {
    if (!current(s)) return;
    var host = byId('authorPostsStatus');
    var hadFocus = !!(host && document.activeElement && host.contains(document.activeElement) && document.activeElement.classList.contains('author-post-load-more'));
    host.replaceChildren(); host.setAttribute('aria-busy', s.loading ? 'true' : 'false');
    if (label) host.appendChild(make('span', 'author-post-status-text', label));
    if ((retry && s.retryable !== false) || (!retry && s.hasMore)) {
      var button = make('button', 'author-post-load-more', retry ? '重试' : '加载更多'); button.type = 'button'; button.disabled = s.loading;
      button.addEventListener('click', function () { load(s); }); host.appendChild(button);
      if (hadFocus) { try { button.focus(); } catch (_) {} }
    }
  }
  // A personal-activity page that was just opened is kept on this device. Reopening shows it at
  // once; another person's page is not requested again for ten minutes, your own page is
  // refreshed quietly in the background. Only the first page is kept, per viewer and author.
  var CACHE_PREFIX = 'xtj_author_posts_v1:', CACHE_INDEX = CACHE_PREFIX + 'index';
  var CACHE_FRESH_MS = 10 * 60 * 1000, CACHE_MAX_AGE = 3 * 86400000, CACHE_MAX_ENTRIES = 6;
  var memoryCache = Object.create(null);
  function cacheKey(s) { return String(s.owner || '') + '|' + s.author; }
  function readCache(s) {
    var key = cacheKey(s), hit = memoryCache[key];
    if (hit) {
      // FIX CACHE-01: 退出/切号会清掉 localStorage 里的个人动态缓存，内存副本必须
      // 跟着失效，否则同一 SPA 会话内重新登录会回显上一账号内容并绕过访问限制。
      try { if (!localStorage.getItem(CACHE_PREFIX + key)) { delete memoryCache[key]; hit = null; } } catch (_) {}
    }
    if (!hit) {
      try { var raw = localStorage.getItem(CACHE_PREFIX + key); hit = raw ? JSON.parse(raw) : null; } catch (_) { hit = null; }
      if (hit) memoryCache[key] = hit;
    }
    if (!hit || !Array.isArray(hit.posts) || !(Date.now() - hit.t <= CACHE_MAX_AGE)) return null;
    return hit;
  }
  function dropCache(s) {
    var key = cacheKey(s); delete memoryCache[key];
    try {
      localStorage.removeItem(CACHE_PREFIX + key);
      var index = JSON.parse(localStorage.getItem(CACHE_INDEX) || '[]').filter(function (k) { return k !== key; });
      localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
    } catch (_) {}
  }
  function writeCache(s) {
    if (s.restricted || !s.posts.length) { dropCache(s); return; }
    var key = cacheKey(s), entry = { t: Date.now(), posts: s.posts.slice(), cursor: s.cursor || null, hasMore: !!s.hasMore, guestLimited: !!s.guestLimited, profile: s.profile || null };
    memoryCache[key] = entry;
    try {
      var index = JSON.parse(localStorage.getItem(CACHE_INDEX) || '[]').filter(function (k) { return k !== key; });
      index.push(key);
      while (index.length > CACHE_MAX_ENTRIES) { var old = index.shift(); delete memoryCache[old]; localStorage.removeItem(CACHE_PREFIX + old); }
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
      localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
    } catch (_) {}
  }
  // Fetch the first page again without any loading text and swap it in when it differs.
  async function revalidate(s) {
    var controller = new AbortController(); s.controller = controller;
    try {
      var response = await window.xtjOptionalAuthFetch('/api/profile/posts/' + encodeURIComponent(s.author) + '?limit=20', { timeoutMs: 18000, signal: controller.signal, authOwner: s.owner, authEpoch: s.epoch });
      var data = await response.json();
      if (!current(s) || s.posts.length > 20 || s.loading) return;
      if (!response.ok || !data.ok || !Array.isArray(data.posts)) return;
      s.profile = data.profile || s.profile; s.restricted = !!data.restricted; s.guestLimited = !!data.guest_limited;
      s.posts = s.restricted ? [] : data.posts.filter(function (post) { return post.user_name === s.author; });
      s.cursor = data.next_cursor; s.hasMore = !!data.has_more && !!s.cursor;
      s._renderedCount = 0; render(s);
      status(s, s.restricted ? '对方已关闭个人动态页访问' : !s.posts.length ? '还没有可查看的动态' : s.guestLimited || s.hasMore ? '' : '已显示全部动态');
      writeCache(s);
    } catch (_) { /* the saved copy stays on screen */ }
    finally { if (s.controller === controller) s.controller = null; }
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
      if (!response.ok || !data.ok || !Array.isArray(data.posts)) throw Object.assign(Error(data.error || '动态加载失败'), { retryable: data.retryable !== false });
      var seen = new Set(s.posts.map(function (post) { return String(post.id); }));
      var beforeCount = s.posts.length;
      data.posts.forEach(function (post) { if (post.user_name === s.author && !seen.has(String(post.id))) { s.posts.push(post); seen.add(String(post.id)); } });
      var appended = s.posts.length > beforeCount;
      s.profile = data.profile || s.profile; s.restricted = !!data.restricted; s.guestLimited = !!data.guest_limited;
      if (s.restricted) s.posts = [];
      s.cursor = data.next_cursor; s.hasMore = !!data.has_more && !!s.cursor; s.loading = false; s.retryable = true;
      render(s, appended && beforeCount > 0 && !s.restricted ? { appendFrom: beforeCount } : undefined);
      status(s, s.restricted ? '对方已关闭个人动态页访问' : !s.posts.length ? '还没有可查看的动态' : s.guestLimited || s.hasMore ? '' : '已显示全部动态');
      if (beforeCount === 0) writeCache(s);
    } catch (error) {
      if (!current(s)) return;
      s.loading = false; s.retryable = error.retryable !== false; status(s, error.message || '动态暂时无法加载', true);
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
    var owner = identity(); state = { author: author, owner: owner.owner, epoch: owner.epoch, generation: generation, posts: [], hasMore: false, guestLimited: false, loading: false, cursor: null, _renderedCount: 0, _renderYear: '', _renderDay: '', _coverKey: null };
    var scroll = byId('authorPostsScroll'); if (scroll) scroll.scrollTop = 0;
    var saved = readCache(state);
    if (saved) { showSaved(state, saved); return; }
    var waiting = prefetching[cacheKey(state)];
    if (waiting) {
      // A request started when the finger landed on the avatar is already on its way: wait for it instead of asking twice.
      var target = state; status(target, '正在加载动态…');
      waiting.then(function () { if (!current(target)) return; var hit = readCache(target); if (hit) showSaved(target, hit); else load(target); });
      return;
    }
    load(state);
  };
  function showSaved(s, saved) {
    // 访客身份下，旧缓存不可信：那时还没有「访客只看 3 条」的限制，
    // 直接复用会让访客看到全部动态，也看不到登录提示。
    if (!s.owner && (saved.guestLimited === undefined || saved.posts.length > 3)) {
      dropCache(s);
      load(s);
      return;
    }
    s.posts = saved.posts.slice(); s.cursor = saved.cursor; s.hasMore = !!saved.hasMore; s.guestLimited = !!saved.guestLimited; s.profile = saved.profile || s.profile;
    render(s); status(s, s.hasMore || s.guestLimited ? '' : '已显示全部动态');
    if (s.author === s.owner || !(Date.now() - saved.t < CACHE_FRESH_MS)) revalidate(s);
  }
  // Start loading someone's page the moment a finger (or pointer) lands on their avatar, ahead of the click.
  var prefetching = Object.create(null);
  window.__xtjPrefetchAuthorPosts = function (author) {
    if (!author || typeof window.xtjOptionalAuthFetch !== 'function') return;
    var owner = identity(), s = { author: author, owner: owner.owner, epoch: owner.epoch }, key = cacheKey(s);
    var hit = readCache(s);
    if (prefetching[key] || (hit && Date.now() - hit.t < CACHE_FRESH_MS)) return;
    var controller = new AbortController();
    prefetching[key] = window.xtjOptionalAuthFetch('/api/profile/posts/' + encodeURIComponent(author) + '?limit=20', { timeoutMs: 18000, signal: controller.signal, authOwner: s.owner, authEpoch: s.epoch })
      .then(function (response) { return response.json().then(function (data) { return { response: response, data: data }; }); })
      .then(function (result) {
        var data = result.data;
        if (!result.response.ok || !data.ok || !Array.isArray(data.posts) || data.restricted) return;
        var now = identity(); if (now.owner !== s.owner || now.epoch !== s.epoch) return;
        s.posts = data.posts.filter(function (post) { return post.user_name === author; }); s.cursor = data.next_cursor; s.hasMore = !!data.has_more && !!s.cursor; s.guestLimited = !!data.guest_limited; s.profile = data.profile || null; s.restricted = false;
        writeCache(s);
      })
      .catch(function () {})
      .then(function () { delete prefetching[key]; });
  };
  ['pointerdown', 'touchstart'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      var node = event.target && event.target.closest ? event.target.closest('[data-user-name][onclick*="openUserProfile"]') : null;
      if (node) window.__xtjPrefetchAuthorPosts(node.getAttribute('data-user-name'));
    }, { passive: true, capture: true });
  });
  window.__xtjUpdateAuthorPost = function (post) {
    if (!state || !current(state) || !post || post.user_name !== state.author) return;
    state.posts = state.posts.map(function (old) { return String(old.id)===String(post.id) ? Object.assign({}, old, post) : old; });
    dropCache(state);
    render(state);
  };
  // 帖子详情先用这里已有的数据立刻画出来，再等服务器的完整数据。
  window.__xtjAuthorPostLookup = function (id) {
    if (!state || !current(state)) return null;
    for (var i = 0; i < state.posts.length; i++) if (String(state.posts[i].id) === String(id)) return state.posts[i];
    return null;
  };
  window.__xtjRemoveAuthorPost = function (id) {
    if (!state || !current(state)) return;
    state.posts = state.posts.filter(function (post) { return String(post.id) !== String(id); }); dropCache(state); render(state);
    status(state, state.posts.length ? '' : '还没有可查看的动态');
  };
  window.addEventListener('xtj:profile-settings-saved', function(event) { if(state && current(state) && state.author===event.detail.owner) { state.profile=event.detail.settings; render(state); } });
  window.addEventListener('auth-ready', function () {
    if (!state || current(state)) return;
    window.__xtjCloseAuthorPosts();
    if (typeof window.closeModal === 'function') window.closeModal('userProfileModal');
  });
})();
