(function(){
  'use strict';

  var FALLBACK_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Cpath fill="%23c9d5cf" d="M86 285h228L248 198l-42 55-31-39-89 71Z"/%3E%3Ccircle cx="132" cy="128" r="28" fill="%23bccbc4"/%3E%3C/svg%3E';

  function esc(value){
    if (window.escapeHtml) return window.escapeHtml(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isRenderablePhoto(photo){
    if (!photo) return false;
    if (photo.mediaKind === 'video' || /^video\//i.test(photo.mimeType || '')) return false;
    return !!(photo.thumbUrl || photo.thumb || photo.imageUrl);
  }

  function getRenderablePhotoWallPhotos(list){
    return (Array.isArray(list) ? list : []).filter(isRenderablePhoto);
  }

  function formatPhotoTime(ts){
    var diff = Date.now() - (ts || Date.now());
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    var d = new Date(ts || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function sortPhotoWallData(list, key){
    var photos = getRenderablePhotoWallPhotos(list).slice();
    switch (key) {
      case 'date_asc':
        photos.sort(function(a, b){ return (a.timestamp || 0) - (b.timestamp || 0); });
        break;
      case 'name':
        photos.sort(function(a, b){ return String(a.username || a.id || '').localeCompare(String(b.username || b.id || '')); });
        break;
      case 'size':
        photos.sort(function(a, b){ return (b.fileSize || 0) - (a.fileSize || 0); });
        break;
      case 'views':
        photos.sort(function(a, b){ return (b.views || 0) - (a.views || 0); });
        break;
      default:
        photos.sort(function(a, b){ return (b.timestamp || 0) - (a.timestamp || 0); });
    }
    return photos;
  }

  function icon(type, extra){
    var cls = 'ui-icon' + (extra ? ' ' + extra : '');
    if (type === 'empty') {
      return '<span class="' + cls + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h4l2-2h4l2 2h4a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a2 2 0 0 1 2-2Z"></path><circle cx="12" cy="13" r="4"></circle></svg></span>';
    }
    if (type === 'upload') {
      return '<span class="' + cls + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 1 1 .5 6.96H15"></path><path d="M12 11v9"></path><path d="m8.5 14.5 3.5-3.5 3.5 3.5"></path></svg></span>';
    }
    return '';
  }

  function emptyHtml(){
    return '<div class="photo-wall-empty"><div class="photo-wall-empty-icon">' + icon('empty', 'photo-wall-empty-svg') + '</div><div>还没有照片</div><div class="photo-wall-empty-cta" onclick="triggerPhotoUpload()">' + icon('upload') + '<span>成为第一个分享照片的人</span></div></div>';
  }

  function applyPhotoWallAspect(img){
    var card = img && img.closest ? img.closest('.photo-wall-item') : null;
    if (!card || !img || !img.naturalWidth || !img.naturalHeight) return;
    var ratio = img.naturalWidth / img.naturalHeight;
    ratio = Math.max(3 / 4, Math.min(4 / 3, ratio));
    card.style.setProperty('--pw-aspect', String(Math.round(1000 * ratio)) + ' / 1000');
  }

  function safeUrl(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function findPhotoById(id, list){
    var key = String(id == null ? '' : id);
    var photos = Array.isArray(list) ? list : [];
    for (var i = 0; i < photos.length; i++) {
      var photo = photos[i];
      if (photo && String(photo.id == null ? '' : photo.id) === key) return photo;
    }
    return null;
  }

  function getCurrentRenderablePhotoWallPhotos(triggerEl){
    if (Array.isArray(window.pwCurrentSortedPhotos) && window.pwCurrentSortedPhotos.length) {
      return getRenderablePhotoWallPhotos(window.pwCurrentSortedPhotos).slice();
    }

    var source = getRenderablePhotoWallPhotos(window.photoWallData || []);
    var grid = document.getElementById('photoGrid');
    if (grid) {
      var cards = grid.querySelectorAll('.photo-wall-item[data-photo-id]');
      if (cards && cards.length) {
        var ordered = [];
        for (var i = 0; i < cards.length; i++) {
          var match = findPhotoById(cards[i].getAttribute('data-photo-id'), source);
          if (match) ordered.push(match);
        }
        if (ordered.length) return ordered;
      }
    }

    if (triggerEl && triggerEl.closest) {
      var card = triggerEl.closest('.photo-wall-item[data-photo-id]');
      var fallback = card ? findPhotoById(card.getAttribute('data-photo-id'), source) : null;
      if (fallback) return [fallback];
    }

    return source.slice();
  }

  function openPhotoWallPreviewAt(index, triggerEl){
    var list = getCurrentRenderablePhotoWallPhotos(triggerEl);
    var nextIndex = Number(index || 0);
    if ((!list || !list.length) && triggerEl && triggerEl.closest) {
      var card = triggerEl.closest('.photo-wall-item[data-photo-id]');
      var fallback = card ? findPhotoById(card.getAttribute('data-photo-id'), window.photoWallData || []) : null;
      if (fallback) {
        list = [fallback];
        nextIndex = 0;
      }
    }
    if (!list || !list.length) {
      if (typeof window.showToast === 'function') window.showToast('照片数据加载中，请稍后重试');
      return;
    }
    if (typeof window.openPhotoPreview !== 'function') return;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= list.length) nextIndex = list.length - 1;
    window.openPhotoPreview(nextIndex, { photos: list });
  }

  function photoCardHtml(photos, startIndex){
    var html = '';
    var base = startIndex || 0;
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      if (!isRenderablePhoto(p)) continue;
      var realUrl = p.imageUrl || p.thumbUrl || p.thumb || '';
      var username = p.username || '未知用户';
      var time = formatPhotoTime(p.timestamp);
      var index = base + i;
      var delay = Math.min(index * 30, 300);
      html += '<div class="photo-wall-item pw-stagger-enter" data-photo-id="' + esc(String(p.id)) + '" style="animation-delay:' + delay + 'ms" onclick="openPhotoWallPreviewAt(' + index + ', this)">';
      html += '<img src="' + FALLBACK_IMG + '" alt="photo" class="pw-blur-in" data-src="' + safeUrl(realUrl) + '" loading="lazy">';
      html += '<div class="pw-item-info"><div class="pw-item-name">' + esc(username) + '</div><div class="pw-item-meta"><span>' + esc(time) + '</span><span>浏览 <b class="pw-view-count">' + esc(p.views || 0) + '</b></span></div></div></div>';
    }
    return html;
  }

  function groupByDate(photos){
    var groups = [];
    var map = {};
    photos.forEach(function(photo){
      if (!photo) return;
      var d = new Date(photo.timestamp || Date.now());
      if (isNaN(d.getTime())) d = new Date();
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (!map[key]) {
        map[key] = { key:key, title:key, photos:[] };
        groups.push(map[key]);
      }
      map[key].photos.push(photo);
    });
    return groups;
  }

  function albumHtml(groups){
    if (!groups.length) return emptyHtml();
    return groups.map(function(group){
      var first = group.photos[0];
      var cover = first && (first.thumbUrl || first.thumb || first.imageUrl) || FALLBACK_IMG;
      return '<button type="button" class="pw-album-card" onclick="openPhotoAlbumGroup(\'' + esc(group.key) + '\')"><img class="pw-album-cover" src="' + safeUrl(cover) + '" alt="album"><div class="pw-album-title">' + esc(group.title) + '</div><div class="pw-album-count">' + group.photos.length + ' 张照片</div></button>';
    }).join('');
  }

  function revealCards(container){
    requestAnimationFrame(function(){
      var cards = container.querySelectorAll('.photo-wall-item.pw-stagger-enter');
      for (var i = 0; i < cards.length; i++) {
        if (i >= 12) cards[i].style.animationDelay = '0ms';
      }
      requestAnimationFrame(function(){
        for (var j = 0; j < cards.length; j++) {
          cards[j].classList.add('pw-stagger-done');
          cards[j].classList.remove('pw-stagger-enter');
        }
      });
    });
  }

  var imgObserver = null;
  var pendingImgs = [];
  var activeLoads = 0;
  var MAX_LOADS = 4;

  function finishImg(img){
    if (!img) return;
    img.classList.remove('pw-blur-in');
    img.classList.add('pw-blur-done');
    if (imgObserver) imgObserver.unobserve(img);
    applyPhotoWallAspect(img);
  }

  function pumpImages(){
    if (activeLoads >= MAX_LOADS || !pendingImgs.length) return;
    var item = pendingImgs.shift();
    if (!item || !item.target) return pumpImages();
    var img = item.target;
    var url = img.getAttribute('data-src');
    if (!url) {
      finishImg(img);
      return pumpImages();
    }
    activeLoads += 1;
    var settled = false;
    function settleImage(failed){
      if (settled) return;
      settled = true;
      activeLoads = Math.max(0, activeLoads - 1);
      img.onload = null;
      img.onerror = null;
      if (failed) img.src = FALLBACK_IMG;
      img.removeAttribute('data-src');
      finishImg(img);
      pumpImages();
    }
    img.onload = function(){
      settleImage(false);
    };
    img.onerror = function(){
      settleImage(true);
    };
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      settleImage(false);
    }
  }

  function observeImages(container){
    pendingImgs = [];
    if (imgObserver) imgObserver.disconnect();
    if (window.IntersectionObserver) {
      imgObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (entry.isIntersecting) pendingImgs.push(entry);
        });
        pumpImages();
      }, { rootMargin:'500px 0px', threshold:0.05 });
      container.querySelectorAll('.pw-blur-in').forEach(function(img){ imgObserver.observe(img); });
    } else {
      container.querySelectorAll('.pw-blur-in').forEach(function(img){ pendingImgs.push({ target:img }); });
      pumpImages();
    }
  }

  var loadMoreObserver = null;
  var loadingMore = false;

  function installLoadMoreSentinel(grid){
    if (loadMoreObserver) loadMoreObserver.disconnect();
    if (!window.hasMorePhotos || !window.loadMorePhotos || !window.IntersectionObserver) return;
    var sentinel = document.createElement('div');
    sentinel.className = 'pw-load-more-sentinel';
    sentinel.innerHTML = '<div class="pw-load-more-indicator">加载更多...</div>';
    grid.appendChild(sentinel);
    loadMoreObserver = new IntersectionObserver(async function(entries){
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting || loadingMore) continue;
        if (!window.hasMorePhotos()) {
          sentinel.querySelector('.pw-load-more-indicator').textContent = '暂无更多';
          continue;
        }
        loadingMore = true;
        sentinel.querySelector('.pw-load-more-indicator').textContent = '加载中...';
        try {
          var more = await window.loadMorePhotos();
          if (more && more.length) renderPhotoWallWithoutReload();
          else sentinel.querySelector('.pw-load-more-indicator').textContent = '暂无更多';
        } catch (_) {
          sentinel.querySelector('.pw-load-more-indicator').textContent = '加载失败';
        }
        loadingMore = false;
      }
    }, { rootMargin:'400px 0px' });
    loadMoreObserver.observe(sentinel);
  }

  function renderSorted(photos){
    var grid = document.getElementById('photoGrid');
    if (!grid) return;
    var toggle = document.getElementById('pwAlbumToggle');
    if (toggle) toggle.classList.toggle('active', !!window.pwAlbumView);

    if (!window.pwAlbumView) {
      window.pwCurrentSortedPhotos = photos.slice();
      if (!photos.length) {
        grid.innerHTML = emptyHtml();
        return;
      }
      grid.innerHTML = photoCardHtml(photos, 0);
      revealCards(grid);
      observeImages(grid);
      installLoadMoreSentinel(grid);
      return;
    }

    var groups = groupByDate(photos);
    if (!window.pwAlbumGroupKey) {
      window.pwCurrentSortedPhotos = photos.slice();
      grid.innerHTML = albumHtml(groups);
      return;
    }

    var group = groups.find(function(item){ return item.key === window.pwAlbumGroupKey; });
    if (!group) {
      window.pwAlbumGroupKey = '';
      window.pwCurrentSortedPhotos = photos.slice();
      grid.innerHTML = albumHtml(groups);
      return;
    }

    window.pwCurrentSortedPhotos = group.photos.slice();
    grid.innerHTML = '<div class="pw-album-toolbar"><button type="button" class="pw-album-back-btn" onclick="openPhotoAlbumGroup(\'\')">返回相册</button><div class="pw-album-toolbar-meta"><strong>' + esc(group.title) + '</strong><span>' + group.photos.length + ' 张照片</span></div></div>' + photoCardHtml(group.photos, 0);
    revealCards(grid);
    observeImages(grid);
  }

  var rendering = false;
  var pendingRender = false;

  async function renderPhotoWall(){
    if (rendering) {
      pendingRender = true;
      return;
    }
    rendering = true;
    var grid = document.getElementById('photoGrid');
    if (!grid) {
      rendering = false;
      return;
    }
    var skeleton = '';
    for (var i = 0; i < 9; i++) skeleton += '<div class="pw-skeleton"></div>';
    grid.innerHTML = skeleton;
    try {
      if (typeof window.loadPhotoWallData === 'function') await window.loadPhotoWallData();
      var key = window.pwSortKey || 'date_desc';
      renderSorted(sortPhotoWallData(window.photoWallData || [], key));
    } catch (err) {
      console.error('[PhotoWall] render failed', err);
      grid.innerHTML = '<div class="photo-wall-empty"><div>照片墙加载失败，请刷新重试</div></div>';
    }
    rendering = false;
    if (pendingRender) {
      pendingRender = false;
      renderPhotoWall();
    }
  }

  function renderPhotoWallWithoutReload(){
    var key = window.pwSortKey || 'date_desc';
    renderSorted(sortPhotoWallData(window.photoWallData || [], key));
  }

  window.pwAlbumView = window.pwAlbumView || false;
  window.pwAlbumGroupKey = window.pwAlbumGroupKey || '';
  window.getRenderablePhotoWallPhotos = getRenderablePhotoWallPhotos;
  window.formatPhotoTime = formatPhotoTime;
  window.sortPhotoWallData = sortPhotoWallData;
  window.applyPhotoWallAspect = applyPhotoWallAspect;
  window.getCurrentRenderablePhotoWallPhotos = getCurrentRenderablePhotoWallPhotos;
  window.openPhotoWallPreviewAt = openPhotoWallPreviewAt;
  window.renderPhotoWall = renderPhotoWall;
  window.renderPhotoWallWithoutReload = renderPhotoWallWithoutReload;
  window.openPhotoAlbumGroup = function(key){
    window.pwAlbumGroupKey = key || '';
    renderPhotoWallWithoutReload();
  };
  window.toggleAlbumView = function(){
    window.pwAlbumView = !window.pwAlbumView;
    window.pwAlbumGroupKey = '';
    renderPhotoWallWithoutReload();
  };
  window.switchPhotoWallView = function(){
    var sel = document.getElementById('pwAlbumSort');
    window.pwSortKey = sel ? sel.value : (window.pwSortKey || 'date_desc');
    renderPhotoWallWithoutReload();
  };
  window.bindPhotoWallScroll = function(){
    var header = document.querySelector('.photo-wall-header');
    if (header) header.classList.remove('pw-header-hidden');
  };
  window.updateAmbientBackground = function(url){
    var bg = document.getElementById('ppAmbientBg');
    if (bg && url) bg.style.background = 'radial-gradient(ellipse at center, rgba(100,160,140,.22) 0%, rgba(100,160,140,.06) 50%, transparent 80%)';
  };
})();
