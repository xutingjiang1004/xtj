(function(){
  'use strict';

  var FALLBACK_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Cpath fill="%23c9d5cf" d="M86 285h228L248 198l-42 55-31-39-89 71Z"/%3E%3Ccircle cx="132" cy="128" r="28" fill="%23bccbc4"/%3E%3C/svg%3E';
  // P6: 加载超时后的内置占位图（"加载失败 / 点击重试"），点击卡片可重试原 URL
  var ERROR_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Cg text-anchor="middle" font-family="sans-serif"%3E%3Ctext x="200" y="190" font-size="26" fill="%23c0392b"%3E%E5%8A%A0%E8%BD%BD%E5%A4%B1%E8%B4%A5%3C/text%3E%3Ctext x="200" y="230" font-size="16" fill="%2395a5a0"%3E%E7%82%B9%E5%87%BB%E9%87%8D%E8%AF%95%3C/text%3E%3C/g%3E%3C/svg%3E';
  // P6: DOM 卡片数量上限 — 超过后不再 append 新卡片，避免数组/DOM 无限增长
  var MAX_DOM_PHOTOS = 500;

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
    return '<div class="photo-wall-empty"><div class="photo-wall-empty-icon">' + icon('empty', 'photo-wall-empty-svg') + '</div><div>还没有照片</div><div class="photo-wall-empty-cta" data-xtj-trigger-upload>' + icon('upload') + '<span>成为第一个分享照片的人</span></div></div>';
  }

  function applyPhotoWallAspect(img){
    var card = img && img.closest ? img.closest('.photo-wall-item') : null;
    if (!card || !img || !img.naturalWidth || !img.naturalHeight) return;
    var ratio = img.naturalWidth / img.naturalHeight;
    ratio = Math.max(3 / 4, Math.min(4 / 3, ratio));
    card.style.setProperty('--pw-aspect', String(Math.round(1000 * ratio)) + ' / 1000');
  }

  function safeUrl(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '&#92;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
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
    // ★ 修复：浏览统计接线——syncPhotoViewCount 此前定义了却从未被调用，
    // 照片"浏览"数永远停留在初始值。打开预览时统计一次
    //（函数内部有 5 分钟节流 + RPC 失败回滚，无副作用）。
    var previewTarget = list[nextIndex];
    if (previewTarget && typeof window.syncPhotoViewCount === 'function') {
      try { window.syncPhotoViewCount(previewTarget); } catch (_) {}
    }
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
  // ★ 每次 render 的 generation ID，用于防止旧加载任务修改新页面
  var _pwRenderGeneration = 0;

  function finishImg(img){
    if (!img) return;
    img._pwQueued = false;
    img.classList.remove('pw-blur-in');
    img.classList.add('pw-blur-done');
    img.classList.remove('pw-load-timeout');
    if (imgObserver) imgObserver.unobserve(img);
    applyPhotoWallAspect(img);
  }

  // P6: 点击加载失败的占位图，重新加载原 URL
  function retryImageLoad(img){
    if (!img || !img.isConnected) return;
    var url = img.getAttribute('data-src');
    if (!url) return;
    img._pwLoadFailed = false;
    img._pwQueued = false;
    img.classList.remove('pw-load-error', 'pw-load-timeout');
    img.style.cursor = '';
    img.onclick = null;
    queueImage(img);
    pumpImages();
  }

  function pumpImages(){
    if (activeLoads >= MAX_LOADS || !pendingImgs.length) return;
    var item = pendingImgs.shift();
    if (!item || !item.target) return pumpImages();
    var img = item.target;
    // ★ 检查 img 是否还在 DOM 中，且属于当前 generation
    if (!img.isConnected || img._pwGeneration !== _pwRenderGeneration) {
      // 释放计数
      if (img._pwActiveLoad && img._pwActiveLoad === _pwRenderGeneration) {
        activeLoads = Math.max(0, activeLoads - 1);
        img._pwActiveLoad = 0;
      }
      img._pwQueued = false;
      return pumpImages();
    }
    var url = img.getAttribute('data-src');
    if (!url) {
      finishImg(img);
      return pumpImages();
    }
    activeLoads += 1;
    img._pwActiveLoad = _pwRenderGeneration;
    var settled = false;
    var fallbackTimer = setTimeout(function(){
      if (!settled && img && img.isConnected) {
        if (!img.getAttribute('data-src')) {
          img.classList.add('pw-load-timeout');
          return;
        }
        // P6: 超时后释放加载槽，换成内置占位图，支持点击重试原 URL
        if (img._pwActiveLoad === _pwRenderGeneration) {
          activeLoads = Math.max(0, activeLoads - 1);
          img._pwActiveLoad = 0;
        }
        img._pwQueued = false;
        if (imgObserver) imgObserver.unobserve(img);
        img._pwLoadFailed = true;
        img.classList.add('pw-load-timeout', 'pw-load-error');
        img.style.cursor = 'pointer';
        img.src = ERROR_IMG;
        img.onclick = function(ev){
          if (ev && ev.stopPropagation) ev.stopPropagation();
          retryImageLoad(img);
        };
      }
    }, 10000);
    function settleImage(failed){
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      // ★ 只有当前 generation 的加载才更新状态
      if (img._pwActiveLoad === _pwRenderGeneration) {
        activeLoads = Math.max(0, activeLoads - 1);
        img._pwActiveLoad = 0;
      }
      img.onload = null;
      img.onerror = null;
      img.onclick = null;
      img.style.cursor = '';
      if (failed) img.src = FALLBACK_IMG;
      img.removeAttribute('data-src');
      // ★ 只有 img 还在 DOM 中且属于当前 generation 才完成
      if (img.isConnected && img._pwGeneration === _pwRenderGeneration) {
        finishImg(img);
      }
      pumpImages();
    }
    img.onload = function(){
      // 占位图自身加载完成不进入正常结算流程
      if (img._pwLoadFailed) return;
      settleImage(false);
    };
    img.onerror = function(){
      if (img._pwLoadFailed) return;
      settleImage(true);
    };
    img.src = url;
    if (img.complete) {
      settleImage(img.naturalWidth === 0);
    }
  }

  function queueImage(img){
    if (!img || img._pwQueued || !img.getAttribute('data-src')) return;
    img._pwQueued = true;
    img._pwGeneration = _pwRenderGeneration;
    pendingImgs.push({ target:img });
  }

  function loadVisiblePhotoWallImages(container, limit){
    container = container || document.getElementById('photoGrid');
    if (!container) return;
    var images = container.querySelectorAll('.photo-wall-item img[data-src]');
    var max = Math.min(images.length, Number(limit) || 6);
    var viewportLimit = Math.max(window.innerHeight * 1.5, 900);
    for (var i = 0; i < max; i++) {
      var img = images[i];
      var rect = img.getBoundingClientRect();
      if (rect.top > viewportLimit || rect.bottom < -120) continue;
      queueImage(img);
    }
    pumpImages();
  }

  function observeImages(container){
    // ★ 清理旧加载任务
    pendingImgs = [];
    // 清空旧 generation 的 activeLoads 计数
    activeLoads = 0;
    // 清空旧图片的加载状态
    try {
      var allImgs = container.querySelectorAll('img');
      for (var i = 0; i < allImgs.length; i++) {
        var img = allImgs[i];
        img._pwQueued = false;
        img._pwActiveLoad = 0;
        img._pwObserved = false;
        img._pwGeneration = _pwRenderGeneration;
        if (img.onload) img.onload = null;
        if (img.onerror) img.onerror = null;
      }
    } catch(e) {}
    if (imgObserver) imgObserver.disconnect();
    if (window.IntersectionObserver) {
      imgObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (entry.isIntersecting) queueImage(entry.target);
        });
        pumpImages();
      }, { rootMargin:'500px 0px', threshold:0.05 });
      container.querySelectorAll('.pw-blur-in').forEach(function(img){
        img._pwObserved = true;
        imgObserver.observe(img);
      });
    } else {
      container.querySelectorAll('.pw-blur-in').forEach(function(img){
        img._pwObserved = true;
        queueImage(img);
      });
      pumpImages();
    }
  }

  var loadMoreObserver = null;
  var loadingMore = false;
  // ★ 修复：防级联防抖——渲染重建哨兵后若仍在视口（例如分组视图下新页照片
  // 都不属于当前分组，网格高度不变），300ms 内不自动加载，改为点击触发，
  // 避免"IO 立即回调 → 再翻页 → 再重建 → 再回调"的无限翻页循环。
  var _lastMoreLoadAt = 0;

  function installLoadMoreSentinel(grid){
    if (loadMoreObserver) loadMoreObserver.disconnect();
    if (!window.hasMorePhotos || !window.loadMorePhotos || !window.IntersectionObserver) return;
    var sentinel = document.createElement('div');
    sentinel.className = 'pw-load-more-sentinel';
    sentinel.innerHTML = '<div class="pw-load-more-indicator">加载更多...</div>';
    grid.appendChild(sentinel);

    function setSentinelText(text, retryable){
      var ind = sentinel.querySelector('.pw-load-more-indicator');
      if (ind) ind.textContent = text;
      sentinel.classList.toggle('pw-load-more-error', !!retryable);
      sentinel.onclick = retryable ? doLoadMore : null;
    }

    function doLoadMore(){
      if (loadingMore) return;
      loadingMore = true;
      setSentinelText('加载中...', false);
      Promise.resolve(window.loadMorePhotos()).then(function(more){
        if (more && more.length) {
          // ★ 修复：判断"新加载的照片里是否包含当前分组日期的照片"。
          // 之前用 groupByDate(more) 判断——groupByDate 把新页照片按各自日期分组，
          // 其组 key 几乎不可能等于当前 pwAlbumGroupKey（除非新页恰好全是同一天），
          // 导致永远命中"当前分组暂无更多照片"，分组页加载更多永久中断。
          // 正确做法：逐张检查 more 的日期 key 是否等于当前分组 key。
          if (window.pwAlbumGroupKey) {
            var hasGroupPhoto = false;
            for (var mi = 0; mi < more.length; mi++) {
              var mp = more[mi];
              if (!mp) continue;
              var md = new Date(mp.timestamp || Date.now());
              if (isNaN(md.getTime())) md = new Date();
              var mKey = md.getFullYear() + '-' + String(md.getMonth() + 1).padStart(2, '0') + '-' + String(md.getDate()).padStart(2, '0');
              if (mKey === window.pwAlbumGroupKey) { hasGroupPhoto = true; break; }
            }
            if (!hasGroupPhoto) {
              // 新页没有当前分组的照片：不销毁哨兵，提示后等待用户继续滚动/点击，
              // 若服务端还有更多（hasMorePhotos 仍为 true），后续加载仍可能带出本组照片。
              setSentinelText('当前分组暂无更多照片', true);
              return;
            }
          }
          // P6: 增量追加新卡片（不动旧节点/不重放 stagger/不重建观察器）
          appendPhotoWallMore();
        } else {
          setSentinelText('暂无更多', false);
        }
      }).catch(function(err){
        var isAbort = !!(err && (err.name === 'AbortError' || /abort/i.test(String(err && err.code || '')) || /abort/i.test(String(err && err.message || ''))));
        if (isAbort) {
          // 被刷新/视图切换/新请求取代：静默恢复，不误报"加载失败"
          setSentinelText('加载更多...', false);
        } else {
          // ★ 修复：真实失败给出可点击重试入口（此前只有一行"加载失败"文案，
          // 且哨兵若仍在视口 IO 不会再次触发，用户无法恢复加载）
          setSentinelText('加载失败，点击重试', true);
        }
      }).finally(function(){
        loadingMore = false;
      });
    }

    loadMoreObserver = new IntersectionObserver(function(entries){
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting || loadingMore) continue;
        if (!window.hasMorePhotos()) {
          setSentinelText('暂无更多', false);
          continue;
        }
        var now = Date.now();
        if (now - _lastMoreLoadAt < 300) { setSentinelText('点击加载更多', false); continue; }
        _lastMoreLoadAt = now;
        doLoadMore();
      }
    }, { rootMargin:'400px 0px' });
    loadMoreObserver.observe(sentinel);
  }

  // ★ P6: loadMore 增量追加 — 只 append 本次新增的照片卡片，
  // 不动已渲染节点、不重放 stagger 动画、不重建 IntersectionObserver。
  function collectDomPhotoIds(grid){
    var ids = [];
    var cards = grid.querySelectorAll('.photo-wall-item[data-photo-id]');
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-photo-id');
      if (id != null) ids.push(id);
    }
    return ids;
  }

  // 校验 DOM 中已有卡片与排序列表前缀一致；不一致（如非日期排序下新项插入中间）
  // 时增量追加不安全，回退全量重建。
  function sortedPrefixMatches(list, domIds){
    if (domIds.length > list.length) return false;
    for (var i = 0; i < domIds.length; i++) {
      var item = list[i];
      var id = item ? String(item.id == null ? '' : item.id) : '';
      if (id !== domIds[i]) return false;
    }
    return true;
  }

  function resetSentinelText(grid, text, retryable){
    var sent = grid && grid.querySelector('.pw-load-more-sentinel');
    if (!sent) return;
    var ind = sent.querySelector('.pw-load-more-indicator');
    if (ind) ind.textContent = text;
    sent.classList.toggle('pw-load-more-error', !!retryable);
  }

  function observeAppendedImages(grid){
    if (!grid) return;
    var imgs = grid.querySelectorAll('.photo-wall-item img.pw-blur-in[data-src]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img._pwObserved) continue;
      img._pwObserved = true;
      if (imgObserver) imgObserver.observe(img);
      else queueImage(img);
    }
    pumpImages();
  }

  function appendNewPhotoCards(grid, list, domIds){
    var existingCount = domIds.length;
    var newOnes = list.slice(existingCount);
    if (!newOnes.length) { resetSentinelText(grid, '加载更多...', false); return; }
    var html = photoCardHtml(newOnes, existingCount);
    var sentinel = grid.querySelector('.pw-load-more-sentinel');
    if (sentinel && sentinel.parentNode === grid) {
      sentinel.insertAdjacentHTML('beforebegin', html);
    } else {
      grid.insertAdjacentHTML('beforeend', html);
    }
    // 不重放 stagger 动画：立即结算新增卡片（移除 enter 类，避免插入即播放动画）
    var newCards = grid.querySelectorAll('.photo-wall-item.pw-stagger-enter');
    for (var k = 0; k < newCards.length; k++) {
      newCards[k].classList.add('pw-stagger-done');
      newCards[k].classList.remove('pw-stagger-enter');
    }
    observeAppendedImages(grid);
    resetSentinelText(grid, '加载更多...', false);
  }

  function appendPhotoWallMore(){
    var grid = document.getElementById('photoGrid');
    if (!grid) return;
    var domIds = collectDomPhotoIds(grid);
    // P6: DOM 数量上限 — 达到后不再追加新卡片，标记已到末尾
    if (domIds.length >= MAX_DOM_PHOTOS) {
      resetSentinelText(grid, '暂无更多', false);
      if (loadMoreObserver) loadMoreObserver.disconnect();
      return;
    }
    var key = window.pwSortKey || 'date_desc';
    var sortedAll = sortPhotoWallData(window.photoWallData || [], key);

    if (!window.pwAlbumView) {
      if (!sortedPrefixMatches(sortedAll, domIds)) { renderSorted(sortedAll); return; }
      window.pwCurrentSortedPhotos = sortedAll.slice();
      appendNewPhotoCards(grid, sortedAll, domIds);
      return;
    }
    if (window.pwAlbumGroupKey) {
      var groups = groupByDate(sortedAll);
      var group = groups.find(function(g){ return g.key === window.pwAlbumGroupKey; });
      if (!group || !sortedPrefixMatches(group.photos, domIds)) { renderSorted(sortedAll); return; }
      window.pwCurrentSortedPhotos = group.photos.slice();
      appendNewPhotoCards(grid, group.photos, domIds);
      return;
    }
    // 相册视图：新照片可能构成新相册组，走全量重建（相册卡片数量远小于照片卡片）
    renderSorted(sortedAll);
  }

  function renderSorted(photos){
    var grid = document.getElementById('photoGrid');
    if (!grid) return;
    // ★ 修复 C3：每次重渲染复位 loadingMore，避免分组切换/返回相册后
    // 旧哨兵的 loadingMore=true 残留，导致新分组哨兵首次 intersect 不触发加载。
    loadingMore = false;
    var toggle = document.getElementById('pwAlbumToggle');
    if (toggle) toggle.classList.toggle('active', !!window.pwAlbumView);

    if (!window.pwAlbumView) {
      window.pwCurrentSortedPhotos = photos.slice();
      if (!photos.length) {
        var syncWrap = document.getElementById('pwSyncStatus') || document.getElementById('photoSyncStatus');
        var isError = syncWrap && syncWrap.classList.contains('is-error');
        grid.innerHTML = isError
          ? '<div class="photo-wall-empty"><div>照片墙加载失败，请重试</div><button type="button" onclick="window.initPhotoWall(true)">重新加载</button></div>'
          : emptyHtml();
        return;
      }
      grid.innerHTML = photoCardHtml(photos.slice(0, MAX_DOM_PHOTOS), 0);
      revealCards(grid);
      observeImages(grid);
      installLoadMoreSentinel(grid);
      return;
    }

    var groups = groupByDate(photos);
    if (!window.pwAlbumGroupKey) {
      window.pwCurrentSortedPhotos = photos.slice();
      grid.innerHTML = albumHtml(groups);
      // H-33: 相册分组视图也要安装加载哨兵，否则分页失效，只能看到首屏/缓存上限
      installLoadMoreSentinel(grid);
      return;
    }

    var group = groups.find(function(item){ return item.key === window.pwAlbumGroupKey; });
    if (!group) {
      window.pwAlbumGroupKey = '';
      window.pwCurrentSortedPhotos = photos.slice();
      grid.innerHTML = albumHtml(groups);
      // H-33: 同上，回到相册视图后重新挂载哨兵
      installLoadMoreSentinel(grid);
      return;
    }

    window.pwCurrentSortedPhotos = group.photos.slice();
    grid.innerHTML = '<div class="pw-album-toolbar"><button type="button" class="pw-album-back-btn" onclick="openPhotoAlbumGroup(\'\')">返回相册</button><div class="pw-album-toolbar-meta"><strong>' + esc(group.title) + '</strong><span>' + group.photos.length + ' 张照片</span></div></div>' + photoCardHtml(group.photos.slice(0, MAX_DOM_PHOTOS), 0);
    revealCards(grid);
    observeImages(grid);
    // H-33: 相册分组详情页同样需要哨兵，滚动到底继续加载更多照片
    installLoadMoreSentinel(grid);
  }

  var rendering = false;
  var pendingRender = false;
  var _renderPromise = null;

  async function renderPhotoWall(){
    if (rendering) {
      pendingRender = true;
      // ★ 返回当前渲染的 Promise，让调用者可以等待
      return _renderPromise;
    }
    rendering = true;
    // ★ 递增 generation ID，废弃旧加载任务
    _pwRenderGeneration += 1;
    var currentGen = _pwRenderGeneration;

    _renderPromise = (async function() {
      var grid = document.getElementById('photoGrid');
      if (!grid) {
        rendering = false;
        _renderPromise = null;
        return;
      }
      var skeleton = '';
      for (var i = 0; i < 9; i++) skeleton += '<div class="pw-skeleton"></div>';
      grid.innerHTML = skeleton;
      try {
        if (typeof window.loadPhotoWallData === 'function') await window.loadPhotoWallData();
        // ★ 检查 generation，旧数据不覆盖
        if (currentGen !== _pwRenderGeneration) {
          rendering = false;
          _renderPromise = null;
          return;
        }
        var key = window.pwSortKey || 'date_desc';
        renderSorted(sortPhotoWallData(window.photoWallData || [], key));
      } catch (err) {
        console.error('[PhotoWall] render failed', err);
        if (currentGen === _pwRenderGeneration) {
          grid.innerHTML = '<div class="photo-wall-empty"><div>照片墙加载失败，请刷新重试</div><button type="button" onclick="window.initPhotoWall(true)">重新加载</button></div>';
        }
      }
      rendering = false;
      _renderPromise = null;
      if (pendingRender) {
        pendingRender = false;
        renderPhotoWall();
      }
    })();

    return _renderPromise;
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
  window.loadVisiblePhotoWallImages = loadVisiblePhotoWallImages;
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
    // L8 修复：url 参数此前被忽略。改为安全版本——仅调整渐变强度作为预览切换的视觉反馈；
    // 不使用 background url()（用户可控 URL 含 ) 或引号会破坏 CSS 值，有注入风险）。
    var bg = document.getElementById('ppAmbientBg');
    if (!bg) return;
    if (url) {
      bg.style.background = 'radial-gradient(ellipse at center, rgba(100,160,140,.30) 0%, rgba(100,160,140,.08) 55%, transparent 80%)';
    } else {
      bg.style.background = 'radial-gradient(ellipse at center, rgba(100,160,140,.22) 0%, rgba(100,160,140,.06) 50%, transparent 80%)';
    }
  };
})();
