(function(){
  'use strict';

  var initialized = false;
  var initializingPromise = null;
  var warmTimer = null;
  // ★ 初始化 generation，用于防止并发竞态
  var _initGeneration = 0;

  function warmVisibleImages(){
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = setTimeout(function(){
      warmTimer = null;
      var schedule = window.requestIdleCallback || window.requestAnimationFrame;
      schedule(function(){
        if (typeof window.loadVisiblePhotoWallImages === 'function') {
          window.loadVisiblePhotoWallImages(document.getElementById('photoGrid'), 6);
        }
      });
    }, 80);
  }

  window.initPhotoWall = function(force) {
    if (initialized && !force) {
      if (typeof window.renderPhotoWallWithoutReload === 'function') {
        window.renderPhotoWallWithoutReload();
      }
      warmVisibleImages();
      return Promise.resolve(true);
    }

    if (initializingPromise && !force) return initializingPromise;

    // ★ 强制刷新时，增加 generation 废弃旧任务
    _initGeneration++;
    var currentGen = _initGeneration;

    initializingPromise = Promise.resolve().then(async function() {
      // ★ 检查 generation，旧任务直接返回
      if (currentGen !== _initGeneration) return true;

      var grid = document.getElementById('photoGrid');
      if (!grid) throw new Error('photo_grid_missing');

      if (typeof window.renderPhotoWall !== 'function') {
        throw new Error('photo_renderer_not_loaded');
      }

      await window.renderPhotoWall();

      // ★ 再次检查 generation
      if (currentGen !== _initGeneration) return true;

      initialized = true;

      if (!grid.children.length) {
        throw new Error('photo_grid_not_rendered');
      }

      if (typeof window.bindPhotoWallScroll === 'function') {
        window.bindPhotoWallScroll();
      }

      warmVisibleImages();
      return true;
    }).catch(function(error) {
      // ★ 旧 generation 的错误不处理
      if (currentGen !== _initGeneration) return false;

      initialized = false;

      var grid = document.getElementById('photoGrid');
      if (grid) {
        grid.innerHTML =
          '<div class="photo-wall-empty">' +
          '<div>照片墙加载失败</div>' +
          '<button type="button" onclick="window.initPhotoWall(true)">重新加载</button>' +
          '</div>';
      }

      console.error('[PhotoWall] initialization failed:', error && error.message ? error.message : error);
      throw error;
    }).finally(function() {
      // ★ 只有最新 generation 的任务才清除 promise
      if (currentGen === _initGeneration) {
        initializingPromise = null;
      }
    });

    return initializingPromise;
  };

  // ★ 照片墙强制同步函数（供桌面导航双击刷新调用）
  window.__xtjPhotoWallForceSync = async function() {
    // ★ 增加 generation 废弃旧任务，但不手动清空 initializingPromise
    _initGeneration++;
    initialized = false;
    try {
      await window.initPhotoWall(true);
    } catch (e) {
      console.error('[PhotoWall] force sync failed', e);
    }
  };

  function wrapRender(name){
    var original = window[name];
    if (typeof original !== 'function' || original.__xtjPhotoWarmWrapped) return;
    var wrapped = function(){
      var result = original.apply(this, arguments);
      return Promise.resolve(result).then(function(value){ warmVisibleImages(); return value; });
    };
    wrapped.__xtjPhotoWarmWrapped = true;
    window[name] = wrapped;
  }

  wrapRender('renderPhotoWall');
  wrapRender('renderPhotoWallWithoutReload');
})();